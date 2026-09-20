// 공통컴포넌트 조립·제거 (add_egovframe_components, remove_egovframe_components).
import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { withFileTransaction } from "./file-transaction.js";
import { downloadVerifiedCatalogArchive, type ArchiveInspection, type CatalogSourceMetadata } from "./catalog-sync.js";
import { sha256 } from "./shared.js";
import { COMPONENT_ASSET_FIELDS, loadCatalog, resolveComponents, type CatalogComponent, type ComponentAssetField } from "./catalog.js";
import { MANIFEST_FILE, readManifest, type Manifest } from "./manifest.js";
import { AI_POM_BACKUP, stripAiPomAdditions } from "./ai.js";

export interface AddComponentsOptions {
  projectDir: string;
  components: string[];
  includeDependencies?: boolean;
  /** DB 스크립트를 함께 복사할 DB 종류 (공통컴포넌트 저장소 script/ 기준) */
  database?: (typeof ECC_DB_TYPES)[number];
  dryRun?: boolean;
  /** fault-injection 회귀 테스트 전용. MCP 스키마에는 노출하지 않는다. */
  faultInjection?: "after-files" | "after-manifest";
}

/** 공통컴포넌트 저장소 script/ 디렉터리가 제공하는 DB 종류 */
export const ECC_DB_TYPES = [
  "altibase", "cubrid", "goldilocks", "maria", "mysql", "oracle", "postgres", "tibero",
] as const;

export interface AddComponentsResult {
  projectDir: string;
  requested: string[];
  installOrder: { id: string; name: string; files: number }[];
  totalFiles: number;
  sqlScripts: string[];
  assets: {
    messageBundles: number;
    idgnContexts: number;
    schedulingContexts: number;
    webAssets: number;
    webFragments: number;
    reusedFiles: number;
  };
  mavenDependencies: string[];
  sourceVerification?: ArchiveInspection;
  sqlNote: string;
  nextSteps: string[];
  dryRun: boolean;
}

/** 프로세스 수명 동안 공통컴포넌트 zip을 1회만 내려받기 위한 캐시 */
let eccZipCache: { key: string; zip: AdmZip; inspection: ArchiveInspection } | null = null;

export async function downloadComponentsZip(source: CatalogSourceMetadata & { repo: string; branch: string }): Promise<{ zip: AdmZip; inspection: ArchiveInspection }> {
  const repository = source.repository ?? source.repo;
  const ref = source.commit ?? source.tag ?? source.branch;
  const key = `${repository}@${ref}`;
  if (eccZipCache && eccZipCache.key === key) return eccZipCache;
  const verified = await downloadVerifiedCatalogArchive(source);
  eccZipCache = { key, ...verified };
  return eccZipCache;
}

function componentAssetCounts(components: CatalogComponent[]): AddComponentsResult["assets"] {
  const count = (field: ComponentAssetField) => new Set(components.flatMap((component) => component[field] ?? [])).size;
  return {
    messageBundles: count("messageBundles"),
    idgnContexts: count("idgnContexts"),
    schedulingContexts: count("schedulingContexts"),
    webAssets: count("webAssets"),
    webFragments: count("webFragments"),
    reusedFiles: 0,
  };
}

function componentMavenDependencies(components: CatalogComponent[]): string[] {
  return [...new Set(components.flatMap((component) => component.mavenDependencies ?? []))].sort();
}

/**
 * 공통컴포넌트 선택 조립 (M2).
 * - dryRun=true : 네트워크 없이 카탈로그 메타데이터로 설치 순서·규모 미리보기
 * - dryRun=false: 공통컴포넌트 저장소를 내려받아 선택 컴포넌트 파일을 대상 프로젝트에 복사.
 *   기존 파일과 충돌하면 아무것도 쓰지 않고 거부하며 파일·SQL·매니페스트를 하나의 transaction으로 반영한다.
 *   database 지정 시 script/ddl·dml/<db>/ 스크립트를 scripts/egovframe-components/<db>/로 복사한다.
 */
export async function addComponents(opts: AddComponentsOptions): Promise<AddComponentsResult> {
  const catalog = loadCatalog();
  const order = resolveComponents(catalog, opts.components, opts.includeDependencies !== false);
  const projectDir = path.resolve(opts.projectDir);

  if (opts.database && !ECC_DB_TYPES.includes(opts.database))
    throw new Error(`database는 ${ECC_DB_TYPES.join("|")} 중 하나여야 합니다: ${opts.database}`);

  // ---- 미리보기 모드: 네트워크 없이 카탈로그 근사치 사용 ----
  if (opts.dryRun === true) {
    return {
      projectDir,
      requested: opts.components,
      installOrder: order.map((c) => ({ id: c.id, name: c.name, files: c.approxFiles })),
      totalFiles: order.reduce((n, c) => n + c.approxFiles, 0),
      sqlScripts: opts.database ? [`script/ddl|dml/${opts.database}/ → scripts/egovframe-components/${opts.database}/ (복사 예정)`] : [],
      assets: componentAssetCounts(order),
      mavenDependencies: componentMavenDependencies(order),
      sqlNote: catalog.sqlNote,
      nextSteps: ["미리보기 모드입니다. 실제 조립하려면 dryRun 없이 다시 호출하세요."],
      dryRun: true,
    };
  }

  // ---- 실제 조립 ----
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`대상 프로젝트 디렉터리가 없습니다: ${projectDir} — 먼저 create_egovframe_project로 생성하세요`);

  // 이미 설치된 컴포넌트는 제외 (매니페스트 기준)
  const existing = readManifest(projectDir);
  if (existing) {
    const dup = order.filter((c) => existing.components[c.id]).map((c) => c.id);
    if (dup.length === order.length)
      throw new Error(`요청한 컴포넌트가 모두 이미 설치되어 있습니다: ${dup.join(", ")}`);
    if (dup.length > 0)
      throw new Error(`이미 설치된 컴포넌트가 포함되어 있습니다: ${dup.join(", ")} — 해당 id를 빼고 다시 호출하세요`);
  }

  const { zip, inspection: sourceVerification } = await downloadComponentsZip(catalog.source);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  const rel = (name: string) => (name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name);
  const entryByPath = new Map(entries.map((entry) => [rel(entry.entryName), entry]));

  // 컴포넌트별 대상 파일 수집
  const planByPath = new Map<string, { entry: AdmZip.IZipEntry; relPath: string; componentId: string; asset: "source" | ComponentAssetField }>();
  for (const c of order) {
    for (const e of entries) {
      const r = rel(e.entryName);
      if (r && c.pathPrefixes.some((p) => r.startsWith(p)) && !planByPath.has(r))
        planByPath.set(r, { entry: e, relPath: r, componentId: c.id, asset: "source" });
    }
    for (const asset of COMPONENT_ASSET_FIELDS)
      for (const r of c[asset] ?? []) {
        const entry = entryByPath.get(r);
        if (!entry) throw new Error(`고정 카탈로그 자산이 upstream 아카이브에 없습니다: ${c.id}.${asset} → ${r}`);
        if (!planByPath.has(r)) planByPath.set(r, { entry, relPath: r, componentId: c.id, asset });
      }
  }
  const plan = [...planByPath.values()];
  if (plan.length === 0) throw new Error("복사할 파일이 없습니다 — 카탈로그 pathPrefixes를 확인하세요");

  // DB 스크립트 수집 — 컴포넌트별 테이블 선별 추출 (M4)
  const sqlPlan: { relPath: string; content: Buffer; componentId: string }[] = [];
  if (opts.database) {
    const db = opts.database;
    // 통합 스크립트 본문 로드 (ddl·dml)
    const scriptText = new Map<string, string>();
    for (const e of entries) {
      const r = rel(e.entryName);
      for (const kind of ["ddl", "dml"]) {
        if (r.startsWith(`script/${kind}/${db}/`))
          scriptText.set(kind + ":" + r, e.getData().toString("utf8"));
      }
    }
    /** 통합 스크립트에서 특정 테이블 관련 구문만 추출 */
    const extractFor = (tables: string[], kind: string): string => {
      const re = new RegExp("\\b(" + tables.join("|") + ")\\b");
      const parts: string[] = [];
      for (const [key, text] of scriptText) {
        if (!key.startsWith(kind + ":")) continue;
        for (const stmt of text.split(/;\s*(?:\r?\n|$)/)) {
          const t = stmt.trim();
          if (t && re.test(t)) parts.push(t + ";");
        }
      }
      return parts.join("\n\n");
    };
    const noTables: CatalogComponent[] = [];
    for (const c of order) {
      if (!c.tables || c.tables.length === 0) {
        const hasMapper = plan.some((item) => item.componentId === c.id && item.relPath.startsWith("src/main/resources/egovframework/mapper/"));
        if (hasMapper) noTables.push(c);
        continue;
      }
      for (const kind of ["ddl", "dml"]) {
        const sql = extractFor(c.tables, kind);
        if (sql)
          sqlPlan.push({
            relPath: `scripts/egovframe-components/${db}/${kind}/${c.id}.sql`,
            content: Buffer.from(`-- ${c.id} (${c.name}) — ${kind.toUpperCase()} 선별 추출: ${c.tables.join(", ")}\n\n` + sql + "\n", "utf8"),
            componentId: c.id,
          });
      }
    }
    // 테이블 정보가 없는 컴포넌트가 있으면 통합본을 함께 복사 (폴백)
    if (noTables.length > 0) {
      for (const [key, text] of scriptText) {
        const [kind, r] = [key.slice(0, 3), key.slice(4)];
        sqlPlan.push({
          relPath: `scripts/egovframe-components/${db}/${kind}/` + r.split("/").pop()!,
          content: Buffer.from(text, "utf8"),
          componentId: noTables[0].id,
        });
      }
    }
  }

  // 파일·SQL·매니페스트를 하나의 공통 transaction으로 반영한다.
  const reusedFiles = new Set<string>();
  const countBy = new Map<string, number>();
  const hashesBy = new Map<string, Record<string, { hash: string; srcHash: string }>>();
  const sqlScripts: string[] = [];
  const sqlBy = new Map<string, string[]>();
  const writtenFiles: string[] = [];
  await withFileTransaction(projectDir, "공통컴포넌트 조립", async (transaction) => {
    // 전체 사전 충돌·경계 검사 — 하나라도 실패하면 transaction staging 외에는 쓰지 않음
    const conflicts: string[] = [];
    for (const item of [...plan, ...sqlPlan]) {
      const incoming = "entry" in item ? item.entry.getData() : item.content;
      const current = transaction.readFile(item.relPath);
      if (current !== null) {
        if (current.equals(incoming)) reusedFiles.add(item.relPath);
        else conflicts.push(item.relPath);
      }
    }
    if (conflicts.length > 0)
      throw new Error(
        `기존 파일과 충돌하여 중단합니다(총 ${conflicts.length}건, 아무것도 쓰지 않았습니다):\n` +
          conflicts.slice(0, 10).map((c) => `  - ${c}`).join("\n") +
          (conflicts.length > 10 ? `\n  … 외 ${conflicts.length - 10}건` : ""),
      );

    for (const { entry, relPath, componentId } of plan) {
      if (reusedFiles.has(relPath)) continue;
      const data = entry.getData();
      transaction.writeFile(relPath, data, { mustNotExist: true });
      writtenFiles.push(relPath);
      countBy.set(componentId, (countBy.get(componentId) ?? 0) + 1);
      const h = "sha256:" + createHash("sha256").update(data).digest("hex");
      if (!hashesBy.has(componentId)) hashesBy.set(componentId, {});
      hashesBy.get(componentId)![relPath] = { hash: h, srcHash: h };
    }
    for (const { relPath, content, componentId } of sqlPlan) {
      if (reusedFiles.has(relPath)) continue;
      transaction.writeFile(relPath, content, { mustNotExist: true });
      writtenFiles.push(relPath);
      sqlScripts.push(relPath);
      if (!sqlBy.has(componentId)) sqlBy.set(componentId, []);
      sqlBy.get(componentId)!.push(relPath);
      const h = "sha256:" + createHash("sha256").update(content).digest("hex");
      if (!hashesBy.has(componentId)) hashesBy.set(componentId, {});
      hashesBy.get(componentId)![relPath] = { hash: h, srcHash: h };
    }

    if (opts.faultInjection === "after-files")
      throw new Error("component assembly fault injection: after-files");

    // 설치 매니페스트 기록 (제거·검증 지원)
    const manifest: Manifest = existing ?? {
      schemaVersion: 3,
      source: { ...catalog.source },
      components: {},
    };
    manifest.source = { ...manifest.source, ...catalog.source };
    const now = new Date().toISOString();
    const filesBy = new Map<string, string[]>();
    for (const { relPath, componentId } of plan) {
      if (reusedFiles.has(relPath)) continue;
      if (!filesBy.has(componentId)) filesBy.set(componentId, []);
      filesBy.get(componentId)!.push(relPath);
    }
    for (const c of order)
      manifest.components[c.id] = {
        installedAt: now,
        files: filesBy.get(c.id) ?? [],
        hashes: hashesBy.get(c.id) ?? {},
        sqlScripts: sqlBy.get(c.id) ?? [],
      };
    manifest.schemaVersion = 3;
    transaction.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");

    if (opts.faultInjection === "after-manifest")
      throw new Error("component assembly fault injection: after-manifest");
  });

  const nextSteps = [
    opts.database
      ? `scripts/egovframe-components/${opts.database}/ddl|dml/<컴포넌트id>.sql — 컴포넌트별로 선별 추출된 스크립트를 순서대로 DB에 적용하세요.`
      : "database 파라미터를 지정하면 컴포넌트별로 선별 추출된 DDL·DML 스크립트도 함께 생성됩니다.",
    "복사된 소스는 egovframework.com.* 원본 패키지를 유지합니다 (eGovFrame IDE 마법사와 동일).",
    "빈 스캐너/설정에 egovframework.com 패키지 스캔이 포함되어 있는지 확인 후 mvn compile로 빌드를 검증하세요.",
    ...(componentMavenDependencies(order).length
      ? [`필요 Maven 좌표 ${componentMavenDependencies(order).length}건을 확인해 대상 pom.xml의 dependencyManagement 또는 dependencies에 반영하세요.`]
      : []),
    "web.xml 노드 병합은 대상 프로젝트 구조에 따라 달라 자동 수정하지 않습니다. 공식 가이드와 webFragments 목록을 확인하세요.",
  ];

  const assets = componentAssetCounts(order);
  assets.reusedFiles = reusedFiles.size;

  return {
    projectDir,
    requested: opts.components,
    installOrder: order.map((c) => ({ id: c.id, name: c.name, files: countBy.get(c.id) ?? 0 })),
    totalFiles: writtenFiles.length,
    sqlScripts,
    assets,
    mavenDependencies: componentMavenDependencies(order),
    sourceVerification,
    sqlNote: catalog.sqlNote,
    nextSteps,
    dryRun: false,
  };
}

/* ------------------------------------------------------------------ */
/* 컴포넌트 제거 (v0.5.0)                                               */
/* ------------------------------------------------------------------ */

export interface RemoveOptions {
  projectDir: string;
  components: string[];
  dryRun?: boolean;
  /** 사용자 수정 또는 기준선 hash가 없는 파일도 백업 후 제거 */
  force?: boolean;
  /** fault-injection 회귀 테스트 전용. MCP 스키마에는 노출하지 않는다. */
  faultInjection?: "after-stage";
}

export type RemoveFileState = "unchanged" | "modified" | "unverified" | "missing";

export interface RemoveFilePlan {
  componentId: string;
  relPath: string;
  state: RemoveFileState;
  expectedHash?: string;
  currentHash?: string;
}

export interface RemoveResult {
  projectDir: string;
  removed: { id: string; files: number; sqlScripts: number }[];
  totalFiles: number;
  dryRun: boolean;
  force: boolean;
  blocked: boolean;
  summary: Record<RemoveFileState, number>;
  files: RemoveFilePlan[];
  backupDir?: string;
}

/** 빈 상위 디렉터리를 projectDir까지 거슬러 올라가며 정리한다. */
function pruneEmptyDirs(startDir: string, rootDir: string): void {
  let dir = startDir;
  while (dir.startsWith(rootDir + path.sep) && dir !== rootDir) {
    if (!fs.existsSync(dir)) { dir = path.dirname(dir); continue; }
    if (fs.readdirSync(dir).length > 0) break;
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

/** 매니페스트 상대경로를 프로젝트 내부의 일반 파일 후보로만 해석한다. */
export function resolveTrackedFile(projectDir: string, realProjectDir: string, relPath: string): string {
  if (path.isAbsolute(relPath))
    throw new Error(`매니페스트의 절대경로를 거부합니다: ${relPath}`);
  const target = path.resolve(projectDir, relPath);
  const relative = path.relative(projectDir, target);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw new Error(`매니페스트의 프로젝트 밖 경로를 거부합니다: ${relPath}`);

  let existingParent = path.dirname(target);
  while (!fs.existsSync(existingParent)) {
    const parent = path.dirname(existingParent);
    if (parent === existingParent) break;
    existingParent = parent;
  }
  const realParent = fs.realpathSync(existingParent);
  const realCandidate = path.resolve(realParent, path.relative(existingParent, target));
  const candidateRelative = path.relative(realProjectDir, realCandidate);
  if (candidateRelative === ".." || candidateRelative.startsWith(".." + path.sep) || path.isAbsolute(candidateRelative))
    throw new Error(`매니페스트 경로가 symlink를 통해 프로젝트 밖을 가리킵니다: ${relPath}`);

  if (fs.existsSync(target)) {
    const realTarget = fs.realpathSync(target);
    const realRelative = path.relative(realProjectDir, realTarget);
    if (!realRelative || realRelative === ".." || realRelative.startsWith(".." + path.sep) || path.isAbsolute(realRelative))
      throw new Error(`매니페스트 경로가 symlink를 통해 프로젝트 밖을 가리킵니다: ${relPath}`);
  }
  return target;
}

/**
 * 매니페스트에 기록된 파일만 삭제하여 컴포넌트를 제거한다.
 * 다른 설치 컴포넌트가 의존하는 컴포넌트는 제거를 거부한다.
 * 설치·갱신 시점 hash와 현재 파일이 다르면 기본 거부하고, force=true일 때만
 * remove-backup/에 사본을 만든 뒤 같은 파일시스템 staging으로 트랜잭션 제거한다.
 */
export async function removeComponents(opts: RemoveOptions): Promise<RemoveResult> {
  const projectDir = path.resolve(opts.projectDir);
  const manifest = readManifest(projectDir);
  if (!manifest)
    throw new Error(`설치 매니페스트(${MANIFEST_FILE})가 없습니다 — add_egovframe_components(v0.5.0 이상)로 조립한 프로젝트만 제거를 지원합니다`);
  if (new Set(opts.components).size !== opts.components.length)
    throw new Error("제거할 컴포넌트 id가 중복되었습니다");

  const catalog = loadCatalog();
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  for (const id of opts.components) {
    if (!manifest.components[id])
      throw new Error(`'${id}'는 매니페스트에 설치 기록이 없습니다. 설치됨: ${Object.keys(manifest.components).join(", ") || "(없음)"}`);
  }
  // 의존성 보호: 남게 될 컴포넌트가 제거 대상에 의존하면 거부
  const removing = new Set(opts.components);
  for (const installedId of Object.keys(manifest.components)) {
    if (removing.has(installedId)) continue;
    const deps = byId.get(installedId)?.dependsOn ?? [];
    for (const d of deps)
      if (removing.has(d))
        throw new Error(`'${d}'는 설치된 '${installedId}'가 의존하므로 제거할 수 없습니다 — '${installedId}'를 먼저(또는 함께) 제거하세요`);
  }

  const dryRun = opts.dryRun === true;
  const force = opts.force === true;
  const removed: RemoveResult["removed"] = [];
  const files: RemoveFilePlan[] = [];
  const targetByRel = new Map<string, string>();
  const ownerByTarget = new Map<string, string>();
  const realProjectDir = fs.realpathSync(projectDir);
  for (const id of opts.components) {
    const entry = manifest.components[id];
    const all = [...new Set([...entry.files, ...entry.sqlScripts])];
    for (const relPath of all) {
      const target = resolveTrackedFile(projectDir, realProjectDir, relPath);
      const targetKey = process.platform === "win32" ? target.toLowerCase() : target;
      const previousOwner = ownerByTarget.get(targetKey);
      if (previousOwner)
        throw new Error(`매니페스트 오류: 정규화한 '${relPath}' 대상이 '${previousOwner}' 항목과 중복됩니다 — 자동 제거를 거부합니다`);
      ownerByTarget.set(targetKey, `${id}:${relPath}`);
      targetByRel.set(relPath, target);
      const expectedHash = entry.hashes?.[relPath]?.hash;
      if (!fs.existsSync(target)) {
        files.push({ componentId: id, relPath, state: "missing", expectedHash });
        continue;
      }
      const stat = fs.lstatSync(target);
      if (!stat.isFile())
        throw new Error(`매니페스트 파일이 일반 파일이 아닙니다(디렉터리·symlink 제거 거부): ${relPath}`);
      const currentHash = sha256(fs.readFileSync(target));
      const state: RemoveFileState = expectedHash === undefined
        ? "unverified"
        : currentHash === expectedHash ? "unchanged" : "modified";
      files.push({ componentId: id, relPath, state, expectedHash, currentHash });
    }
    removed.push({ id, files: entry.files.length, sqlScripts: entry.sqlScripts.length });
  }

  const summary: Record<RemoveFileState, number> = { unchanged: 0, modified: 0, unverified: 0, missing: 0 };
  for (const file of files) summary[file.state]++;
  const risky = files.filter((file) => file.state === "modified" || file.state === "unverified");
  const blocked = risky.length > 0 && !force;
  const existing = files.filter((file) => file.state !== "missing");
  const baseResult = {
    projectDir,
    removed,
    totalFiles: existing.length,
    force,
    blocked,
    summary,
    files,
  };
  if (dryRun) return { ...baseResult, dryRun: true };

  if (blocked)
    throw new Error(
      `사용자 수정 또는 기준선 hash가 없는 파일 ${risky.length}건으로 제거를 중단합니다(아무것도 삭제하지 않았습니다):\n` +
        risky.slice(0, 10).map((file) => `  - [${file.state}] ${file.relPath}`).join("\n") +
        (risky.length > 10 ? `\n  … 외 ${risky.length - 10}건` : "") +
        "\ndryRun으로 전체 분류를 확인하고, 보존이 필요하면 직접 정리하거나 force=true로 백업 후 제거하세요.",
    );

  let backupDir: string | undefined;
  if (force && risky.length > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupRoot = path.join(projectDir, "remove-backup");
    fs.mkdirSync(backupRoot, { recursive: true });
    backupDir = fs.mkdtempSync(path.join(backupRoot, `${ts}-`));
    for (const file of existing) {
      const source = targetByRel.get(file.relPath)!;
      const backup = path.join(backupDir, file.relPath);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(source, backup);
    }
    fs.writeFileSync(
      path.join(backupDir, "remove-plan.json"),
      JSON.stringify({ createdAt: new Date().toISOString(), components: opts.components, summary, files }, null, 2) + "\n",
    );
  }

  const manifestPath = path.join(projectDir, MANIFEST_FILE);
  const txnDir = fs.mkdtempSync(path.join(projectDir, ".egovframe-remove-txn-"));
  const stagedManifest = path.join(txnDir, MANIFEST_FILE);
  const moved: { relPath: string; target: string; staged: string }[] = [];
  const pomEntries = opts.components.filter((id) => manifest.components[id].pom);
  const pomPath = path.join(projectDir, "pom.xml");
  const aiBackupPath = path.join(projectDir, AI_POM_BACKUP);
  const pomBefore = pomEntries.length > 0 && fs.existsSync(pomPath) ? fs.readFileSync(pomPath) : null;
  const aiBackupBefore = pomEntries.length > 0 && fs.existsSync(aiBackupPath) ? fs.readFileSync(aiBackupPath) : null;
  let pomTouched = false;
  let manifestStaged = false;

  try {
    for (const file of existing) {
      const target = targetByRel.get(file.relPath)!;
      const staged = path.join(txnDir, "files", file.relPath);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.renameSync(target, staged);
      moved.push({ relPath: file.relPath, target, staged });
    }

    if (opts.faultInjection === "after-stage")
      throw new Error("remove fault injection: after-stage");

    for (const id of pomEntries) {
      pomTouched = true;
      stripAiPomAdditions(projectDir, id);
    }
    for (const id of opts.components) delete manifest.components[id];

    fs.renameSync(manifestPath, stagedManifest);
    manifestStaged = true;
    if (Object.keys(manifest.components).length > 0)
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });

    fs.rmSync(txnDir, { recursive: true, force: true });
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (manifestStaged) {
      try {
        fs.rmSync(manifestPath, { force: true });
        if (fs.existsSync(stagedManifest)) fs.renameSync(stagedManifest, manifestPath);
      } catch (rollbackError) {
        rollbackErrors.push(`manifest: ${String(rollbackError)}`);
      }
    }
    if (pomTouched) {
      try {
        if (pomBefore) fs.writeFileSync(pomPath, pomBefore);
        else fs.rmSync(pomPath, { force: true });
        if (aiBackupBefore) fs.writeFileSync(aiBackupPath, aiBackupBefore);
        else fs.rmSync(aiBackupPath, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(`pom: ${String(rollbackError)}`);
      }
    }
    for (const file of [...moved].reverse()) {
      try {
        if (!fs.existsSync(file.staged)) continue;
        fs.mkdirSync(path.dirname(file.target), { recursive: true });
        fs.renameSync(file.staged, file.target);
      } catch (rollbackError) {
        rollbackErrors.push(`${file.relPath}: ${String(rollbackError)}`);
      }
    }
    try { fs.rmSync(txnDir, { recursive: true, force: true }); }
    catch (rollbackError) { rollbackErrors.push(`staging: ${String(rollbackError)}`); }
    const suffix = rollbackErrors.length
      ? `\n롤백 실패 ${rollbackErrors.length}건:\n${rollbackErrors.map((message) => `  - ${message}`).join("\n")}`
      : "\n작업 전 상태로 롤백했습니다.";
    throw new Error(`컴포넌트 제거 트랜잭션 실패: ${error instanceof Error ? error.message : String(error)}${suffix}`);
  }

  for (const file of existing) {
    const target = targetByRel.get(file.relPath)!;
    try { pruneEmptyDirs(path.dirname(target), projectDir); } catch { /* 제거 성공 후 빈 디렉터리 정리는 best-effort */ }
  }
  return { ...baseResult, dryRun: false, blocked: false, backupDir };
}
