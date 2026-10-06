// 공통컴포넌트 재조립 (reassemble_egovframe_components, v0.38).
//   3.x/4.x(또는 이전 5.x) 프로젝트에 복사돼 있는 공통컴포넌트 소스를 카탈로그 고정 버전(5.0.7)으로 다시 조립한다.
//   (1) 원본 태그 식별 — 프로젝트 파일의 git blob id 를 공식 저장소 후보 태그(세대별)의 같은 경로와 대조해 일치가 가장 많은 태그를 고른다.
//   (2) 3-way 분류 — 원본(식별한 태그)·현재·목표(5.0.7)로 파일마다 상태를 정한다(upgrade 의 classifyUpgrade 와 같은 원칙, 기준선이 매니페스트 대신 원본 태그).
//   (3) 조립 — 목표 파일을 쓰고, 5.x 에 없는 원본 파일은 백업 후 지우고, 사용자 수정은 unified diff 패치로 보존하며 매니페스트를 기록한다(이후 upgrade·validate·remove 적용).
//   모든 변경은 하나의 transaction, 원본은 migration-backup/<ts>-reassemble/ 에. 사용자 패치의 자동 재적용은 하지 않는다(작업 목록으로).
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { COMPONENT_ASSET_FIELDS, loadCatalog, type CatalogComponent, type ComponentAssetField } from "./catalog.js";
import { blobIdsOf, compareTags, gitBlobId, GitOriginSource, type OriginSource } from "./component-origin.js";
import { buildComponentSqlPlan, downloadComponentsZip, ECC_DB_TYPES } from "./components.js";
import { diagnoseProject } from "./diagnose.js";
import { withFileTransaction } from "./file-transaction.js";
import { MANIFEST_FILE, readManifest, type Manifest } from "./manifest.js";
import { migrateProject, type SourceEra } from "./migrate.js";
import { runBuild, type BuildError, type Runner } from "./build-runner.js";

export type ReassembleState =
  | "identical" // 현재 = 목표 → 그대로
  | "unchanged" // 현재 = 원본 ≠ 목표 → 목표로 교체
  | "user-modified" // 현재 ≠ 원본, 목표 있음 → 소스는 교체 + 패치 보존, 설정·자산은 유지 + 목표본 참고 저장
  | "unverified" // 원본에 없는 경로인데 현재·목표 모두 있음 → 소스는 백업 후 교체, 설정·자산은 유지
  | "new" // 목표에만 있음 → 추가
  | "removed-unchanged" // 원본 = 현재, 목표에 없음 → 백업 후 삭제
  | "removed-modified" // 원본 ≠ 현재, 목표에 없음 → 백업 + 패치 후 삭제
  | "user-added"; // 원본·목표 모두 없음(사용자 파일) → 그대로
export type ReassembleAction = "keep" | "replace" | "add" | "delete" | "keep-reference";
export const REASSEMBLE_STATES: ReassembleState[] = ["identical", "unchanged", "user-modified", "unverified", "new", "removed-unchanged", "removed-modified", "user-added"];
export const REASSEMBLE_STATE_LABEL: Record<ReassembleState, string> = {
  identical: "목표와 같음", unchanged: "원본 그대로(교체)", "user-modified": "사용자 수정", unverified: "원본 미확인", new: "5.x 신규",
  "removed-unchanged": "5.x 에서 제거(원본 그대로)", "removed-modified": "5.x 에서 제거(사용자 수정)", "user-added": "사용자 추가 파일",
};

export interface ReassembleFile {
  componentId: string;
  path: string;
  asset: "source" | ComponentAssetField;
  state: ReassembleState;
  action: ReassembleAction;
  /** 사용자 변경 패치(원본 → 현재)의 프로젝트 상대 경로 — 적용 시에만 */
  patch?: string;
}
export interface ReassembleWorkItem {
  componentId: string;
  path: string;
  kind: "reapply-patch" | "removed-in-5x" | "review-config" | "unverified-replaced";
  detail: string;
  patch?: string;
  /** verify=true 일 때 이 파일에서 난 컴파일 오류 수 */
  errors?: number;
}
export interface ReassembleOptions {
  projectDir: string;
  /** 대상 컴포넌트 id(미지정 시 감지된 컴포넌트 중 목표와 다른 파일이 있는 것 전부) */
  components?: string[];
  /** 원본 태그(기본 "auto" = 식별) */
  sourceTag?: string;
  database?: (typeof ECC_DB_TYPES)[number];
  /** 기본 true — 분류·계획만(파일 내용은 내려받지 않음) */
  dryRun?: boolean;
  verify?: boolean;
  timeoutMs?: number;
  /** 테스트용 주입 */
  origin?: OriginSource;
  /** 목표 파일 내용 공급(기본: 카탈로그 고정 아카이브를 sha256 검증 후 사용) */
  readTarget?: (paths: string[]) => Promise<Map<string, Buffer>>;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  faultInjection?: "after-files";
}
export interface ReassembleResult {
  projectDir: string;
  dryRun: boolean;
  target: { tag: string; commit: string | null };
  sourceEra: SourceEra;
  origin: { tag: string | null; mode: "auto" | "fixed"; candidates: { tag: string; matched: number; total: number; ratio: number }[] };
  components: { id: string; name: string; files: number; summary: Record<ReassembleState, number> }[];
  summary: Record<ReassembleState, number>;
  actions: Record<ReassembleAction, number>;
  files: ReassembleFile[];
  worklist: ReassembleWorkItem[];
  sql: string[];
  manifestUpdated: boolean;
  backupDir?: string;
  planPath?: string;
  verify?: { ran: boolean; success: boolean | null; command?: string; durationMs?: number; errors: number; inReassembled: number; reason?: string };
  notes: string[];
}

const emptyStates = (): Record<ReassembleState, number> => Object.fromEntries(REASSEMBLE_STATES.map((s) => [s, 0])) as Record<ReassembleState, number>;
const emptyActions = (): Record<ReassembleAction, number> => ({ keep: 0, replace: 0, add: 0, delete: 0, "keep-reference": 0 });
const SKIP_DIRS = new Set([".git", "target", "build", "node_modules", "migration-backup", "upgrade-backup", "remove-backup"]);
const ERA_MAJOR: Record<SourceEra, string | null> = { "3.x": "3", "4.x": "4", "5.x": "5", unknown: null };

function walkUnder(projectDir: string, prefix: string): string[] {
  const root = path.join(projectDir, prefix);
  const out: string[] = [];
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return out;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(path.relative(projectDir, p).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out;
}

/** 경로의 소유 컴포넌트 = 접두어가 가장 긴 리프(카탈로그 전체 기준). */
function ownerOf(rel: string, leaves: CatalogComponent[]): CatalogComponent | null {
  let best: CatalogComponent | null = null, len = -1;
  for (const c of leaves) for (const p of c.pathPrefixes) if (rel.startsWith(p) && p.length > len) { best = c; len = p.length; }
  return best;
}

/** 원본 → 현재 unified diff(git diff --no-index). 바이트를 보존한다(EUC-KR 등 원문 인코딩 그대로). 차이가 없으면 빈 Buffer. */
export async function unifiedPatch(rel: string, before: Buffer, after: Buffer): Promise<Buffer> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "egov-patch-"));
  try {
    const a = path.join(tmp, "a"), b = path.join(tmp, "b");
    fs.writeFileSync(a, before); fs.writeFileSync(b, after);
    const out = await new Promise<string>((resolve, reject) => {
      execFile("git", ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "diff", "--no-index", "--no-color", "--text", "-U3", "a", "b"], { cwd: tmp, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        if (error && (error as { code?: number }).code !== 1) reject(new Error(`git diff 실패: ${error.message}`));
        else resolve((stdout as Buffer).toString("latin1"));
      });
    });
    if (!out) return Buffer.alloc(0);
    // 내용은 latin1 로 왕복해 바이트를 그대로 두고, 헤더의 경로만 바꾼다(경로는 UTF-8)
    const relLatin1 = Buffer.from(rel, "utf8").toString("latin1");
    return Buffer.from(out
      .replace(/^diff --git a\/a b\/b$/m, `diff --git a/${relLatin1} b/${relLatin1}`)
      .replace(/^--- a\/a$/m, `--- a/${relLatin1}`)
      .replace(/^\+\+\+ b\/b$/m, `+++ b/${relLatin1}`), "latin1");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 재조립 계획(및 적용). */
export async function reassembleComponents(opts: ReassembleOptions): Promise<ReassembleResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  if (opts.database && !ECC_DB_TYPES.includes(opts.database)) throw new Error(`database는 ${ECC_DB_TYPES.join("|")} 중 하나여야 합니다: ${opts.database}`);
  const dryRun = opts.dryRun !== false;
  const catalog = loadCatalog();
  const targetTag = catalog.source.tag ?? "main";
  const leaves = catalog.components.filter((c) => c.pathPrefixes.length > 0);
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  const notes: string[] = [];
  const origin = opts.origin ?? new GitOriginSource();

  // ── 대상 컴포넌트 ──
  const diag = diagnoseProject({ projectDir });
  const detected = diag.detectedComponents.map((d) => d.id).filter((id) => byId.get(id)?.pathPrefixes.length);
  let selected: CatalogComponent[];
  if (opts.components?.length) {
    const ids = new Set<string>();
    for (const id of opts.components) {
      const c = byId.get(id);
      if (!c) throw new Error(`카탈로그에 없는 컴포넌트 id: ${id}`);
      for (const child of c.children?.length ? c.children : [c.id]) ids.add(child);
    }
    selected = [...ids].map((id) => byId.get(id)!).filter((c) => c.pathPrefixes.length);
    const missing = selected.filter((c) => !detected.includes(c.id)).map((c) => c.id);
    if (missing.length) notes.push(`프로젝트에서 감지되지 않은 컴포넌트도 요청에 있어 새로 조립합니다: ${missing.join(", ")}`);
  } else selected = detected.map((id) => byId.get(id)!);
  const manifest = readManifest(projectDir);
  const managed = selected.filter((c) => manifest?.components[c.id]).map((c) => c.id);
  if (managed.length) throw new Error(`이미 매니페스트(${MANIFEST_FILE})로 관리되는 컴포넌트가 있습니다: ${managed.join(", ")} — 재조립 대신 upgrade_egovframe_project 를 쓰세요`);
  const sourceEra = migrateProject({ projectDir }).sourceEra;
  const target = { tag: targetTag, commit: catalog.source.commit ?? null };
  const base = (): ReassembleResult => ({ projectDir, dryRun, target, sourceEra, origin: { tag: null, mode: opts.sourceTag && opts.sourceTag !== "auto" ? "fixed" : "auto", candidates: [] }, components: [], summary: emptyStates(), actions: emptyActions(), files: [], worklist: [], sql: [], manifestUpdated: false, notes });
  if (selected.length === 0) { notes.push("재조립할 공통컴포넌트를 찾지 못했습니다(감지된 컴포넌트 없음)."); return base(); }

  // ── 경로 수집: 프로젝트(소스 접두어 아래) · 목표(접두어 + 자산 경로) ──
  const selectedIds = new Set(selected.map((c) => c.id));
  const assetOwner = new Map<string, { id: string; asset: ComponentAssetField }>();
  for (const c of selected) for (const f of COMPONENT_ASSET_FIELDS) for (const p of c[f] ?? []) if (!assetOwner.has(p)) assetOwner.set(p, { id: c.id, asset: f });
  const projectFiles = new Map<string, string>(); // rel → componentId
  for (const c of selected) for (const p of c.pathPrefixes) for (const rel of walkUnder(projectDir, p)) { const o = ownerOf(rel, leaves); if (o && selectedIds.has(o.id)) projectFiles.set(rel, o.id); }
  for (const [p, o] of assetOwner) if (fs.existsSync(path.join(projectDir, p))) projectFiles.set(p, o.id);
  const queryPaths = [...selected.flatMap((c) => c.pathPrefixes), ...assetOwner.keys()];
  const currentIds = new Map<string, string[]>();
  const readCurrent = (rel: string) => fs.readFileSync(path.join(projectDir, rel));
  for (const rel of projectFiles.keys()) currentIds.set(rel, blobIdsOf(readCurrent(rel)));
  const sourceFiles = [...projectFiles.keys()].filter((rel) => !assetOwner.has(rel));

  // ── 원본 태그 ──
  let originTag: string | null = null;
  const result = base();
  const tags = await origin.listTags();
  if (!tags.includes(targetTag)) throw new Error(`목표 태그 ${targetTag} 가 공통컴포넌트 저장소에 없습니다`);
  if (opts.sourceTag && opts.sourceTag !== "auto") {
    if (!tags.includes(opts.sourceTag)) throw new Error(`원본 태그 ${opts.sourceTag} 가 저장소에 없습니다(있는 태그: ${tags.join(", ")})`);
    originTag = opts.sourceTag;
  } else if (sourceFiles.length) {
    const major = ERA_MAJOR[sourceEra];
    const candidates = tags.filter((t) => /^v?\d/.test(t) && (!major || String(tagVersionMajor(t)) === major) && compareTags(t, targetTag) <= 0);
    for (const t of candidates) {
      const blobs = await origin.listBlobs(t, queryPaths);
      let matched = 0;
      for (const rel of sourceFiles) { const id = blobs.get(rel); if (id && currentIds.get(rel)!.includes(id)) matched++; }
      result.origin.candidates.push({ tag: t, matched, total: sourceFiles.length, ratio: sourceFiles.length ? Math.round((matched / sourceFiles.length) * 1000) / 1000 : 0 });
    }
    result.origin.candidates.sort((a, b) => b.matched - a.matched || compareTags(b.tag, a.tag) || a.tag.length - b.tag.length);
    const best = result.origin.candidates[0];
    if (best && best.matched > 0) originTag = best.tag;
    else notes.push(`원본 태그를 식별하지 못했습니다(후보 ${candidates.join(", ") || "없음"} 와 일치하는 파일 0) — 기존 파일은 모두 '원본 미확인'으로 다룹니다. sourceTag 로 지정할 수 있습니다.`);
    result.origin.candidates = result.origin.candidates.slice(0, 5);
  }
  result.origin.tag = originTag;
  if (originTag && result.origin.candidates[0] && result.origin.candidates[0].ratio < 0.5) notes.push(`원본 태그 ${originTag} 와의 일치율이 ${Math.round(result.origin.candidates[0].ratio * 100)}% 입니다 — 소스를 많이 고쳤거나 다른 버전일 수 있으니 sourceTag 지정을 검토하세요.`);
  const originBlobs = originTag ? await origin.listBlobs(originTag, queryPaths) : new Map<string, string>();
  const targetBlobs = await origin.listBlobs(targetTag, queryPaths);
  try { target.commit = await origin.resolveCommit(targetTag); } catch { /* 고정 커밋 유지 */ }
  if (catalog.source.commit && target.commit && target.commit !== catalog.source.commit) throw new Error(`목표 태그 ${targetTag} 의 커밋(${target.commit.slice(0, 7)})이 카탈로그 고정 커밋(${catalog.source.commit.slice(0, 7)})과 다릅니다(태그 이동)`);

  // ── 3-way 분류 ──
  const all = new Set<string>([...projectFiles.keys()]);
  for (const rel of targetBlobs.keys()) {
    const asset = assetOwner.get(rel);
    if (asset) { all.add(rel); continue; }
    const o = ownerOf(rel, leaves);
    if (o && selectedIds.has(o.id)) all.add(rel);
  }
  const files: ReassembleFile[] = [];
  for (const rel of [...all].sort()) {
    const asset = assetOwner.get(rel);
    const componentId = projectFiles.get(rel) ?? asset?.id ?? ownerOf(rel, leaves)!.id;
    const kind: ReassembleFile["asset"] = asset ? asset.asset : "source";
    const cur = currentIds.get(rel);
    const o = originBlobs.get(rel), t = targetBlobs.get(rel);
    let state: ReassembleState;
    if (!cur) { if (!t) continue; state = "new"; }
    else if (t && cur.includes(t)) state = "identical";
    else if (t) state = o ? (cur.includes(o) ? "unchanged" : "user-modified") : "unverified";
    else if (kind !== "source") continue; // 자산 경로인데 목표에 없음 — 카탈로그와 어긋남은 아래에서 오류
    else state = o ? (cur.includes(o) ? "removed-unchanged" : "removed-modified") : "user-added";
    const isConfig = kind !== "source";
    const action: ReassembleAction =
      state === "identical" || state === "user-added" ? "keep"
        : state === "new" ? "add"
          : state === "removed-unchanged" || state === "removed-modified" ? "delete"
            : (state === "user-modified" || state === "unverified") && isConfig ? "keep-reference"
              : "replace";
    files.push({ componentId, path: rel, asset: kind, state, action });
  }
  for (const [p] of assetOwner) if (!targetBlobs.has(p)) throw new Error(`카탈로그 자산이 목표 태그 ${targetTag} 에 없습니다: ${p}`);

  // ── 요약·작업 목록 ──
  const perComp = new Map<string, Record<ReassembleState, number>>();
  for (const f of files) {
    result.summary[f.state]++; result.actions[f.action]++;
    (perComp.get(f.componentId) ?? perComp.set(f.componentId, emptyStates()).get(f.componentId)!)[f.state]++;
  }
  result.components = selected.map((c) => ({ id: c.id, name: c.name, files: files.filter((f) => f.componentId === c.id).length, summary: perComp.get(c.id) ?? emptyStates() }));
  // 목표와 완전히 같은 컴포넌트는 자동 선택에서 뺀다(요청으로 지정한 경우는 매니페스트만 기록)
  if (!opts.components?.length) {
    const same = result.components.filter((c) => c.files > 0 && Object.entries(c.summary).every(([s, n]) => s === "identical" || s === "user-added" || n === 0)).map((c) => c.id);
    if (same.length) notes.push(`목표 ${targetTag} 와 이미 같은 컴포넌트 ${same.length}종은 매니페스트만 기록합니다: ${same.slice(0, 10).join(", ")}${same.length > 10 ? " …" : ""}`);
  }
  for (const f of files) {
    if (f.state === "user-modified") result.worklist.push({ componentId: f.componentId, path: f.path, kind: f.asset === "source" ? "reapply-patch" : "review-config", detail: f.asset === "source" ? `${targetTag} 파일로 교체됨 — 사용자 변경(원본 ${originTag} 대비)을 패치로 보존했으니 필요한 부분을 다시 반영` : `설정·자산 파일은 사용자 수정본을 유지 — ${targetTag} 버전과 비교해 반영(참고본 저장)` });
    else if (f.state === "removed-modified" || f.state === "removed-unchanged") result.worklist.push({ componentId: f.componentId, path: f.path, kind: "removed-in-5x", detail: `${targetTag} 에 없는 파일 — 백업 후 삭제${f.state === "removed-modified" ? "(사용자 변경은 패치로 보존)" : ""}. 이 클래스를 쓰는 코드는 5.x 대응 기능으로 옮기세요` });
    else if (f.state === "unverified") result.worklist.push({ componentId: f.componentId, path: f.path, kind: f.asset === "source" ? "unverified-replaced" : "review-config", detail: f.asset === "source" ? `원본 태그에 없는 경로라 변경 여부를 판정할 수 없음 — ${targetTag} 파일로 교체하고 현재본을 백업` : `원본 미확인 설정·자산 파일 — 유지하고 ${targetTag} 참고본 저장` });
  }
  result.worklist.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.path.localeCompare(b.path));
  result.files = files;
  if (dryRun) {
    notes.push(`dryRun — 파일을 쓰지 않았습니다. dryRun=false 로 ${result.actions.replace + result.actions.add}개 파일을 ${targetTag} 로 쓰고 ${result.actions.delete}개를 백업 후 지웁니다.`);
    return result;
  }

  // ── 적용 ──
  const writePaths = files.filter((f) => f.action === "replace" || f.action === "add" || f.action === "keep-reference" || f.state === "identical").map((f) => f.path);
  let sqlPlan: { relPath: string; content: Buffer; componentId: string }[] = [];
  let targetContent: Map<string, Buffer>;
  if (opts.readTarget) targetContent = await opts.readTarget(writePaths);
  else {
    const { zip } = await downloadComponentsZip(catalog.source);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    const rootPrefix = entries[0].entryName.split("/")[0] + "/";
    const rel = (n: string) => (n.startsWith(rootPrefix) ? n.slice(rootPrefix.length) : n);
    const want = new Set(writePaths);
    targetContent = new Map();
    for (const e of entries) { const r = rel(e.entryName); if (want.has(r)) targetContent.set(r, e.getData()); }
    if (opts.database) sqlPlan = buildComponentSqlPlan(entries.map((e) => ({ relPath: rel(e.entryName), read: () => e.getData() })), selected, opts.database, (id) => files.some((f) => f.componentId === id && f.path.startsWith("src/main/resources/egovframework/mapper/")));
  }
  for (const p of writePaths) {
    const buf = targetContent.get(p);
    if (!buf) throw new Error(`목표 파일 내용을 받지 못했습니다: ${p}`);
    if (gitBlobId(buf) !== targetBlobs.get(p)) throw new Error(`목표 파일 내용이 태그 ${targetTag} 의 blob 과 다릅니다(아카이브 불일치): ${p}`);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRel = `migration-backup/${ts}-reassemble-${randomUUID().slice(0, 8)}`;
  const patchFor = new Map<string, Buffer>();
  for (const f of files) {
    if (f.state !== "user-modified" && f.state !== "removed-modified") continue;
    const o = originBlobs.get(f.path);
    if (!o) continue;
    const patch = await unifiedPatch(f.path, await origin.readBlob(o), readCurrent(f.path));
    if (!patch.length) continue;
    const rel = `${backupRel}/patches/${f.componentId}/${f.path}.patch`;
    patchFor.set(f.path, patch);
    f.patch = rel;
    const w = result.worklist.find((x) => x.path === f.path);
    if (w) w.patch = rel;
  }
  const hashOf = (b: Buffer) => "sha256:" + createHash("sha256").update(b).digest("hex");
  await withFileTransaction(projectDir, "공통컴포넌트 재조립", async (tx) => {
    for (const f of files) {
      if (f.action === "keep" && f.state !== "identical") continue;
      const current = tx.readFile(f.path);
      if (current && (f.action === "replace" || f.action === "delete" || f.action === "keep-reference")) {
        const ids = blobIdsOf(current);
        if (!ids.some((id) => currentIds.get(f.path)?.includes(id))) throw new Error(`분류 이후 파일이 바뀌어 중단합니다: ${f.path}`);
        if (f.action !== "keep-reference") tx.writeFile(`${backupRel}/originals/${f.path}`, current, { mustNotExist: true });
      }
      if (f.action === "replace" || f.action === "add") tx.writeFile(f.path, targetContent.get(f.path)!);
      else if (f.action === "delete") tx.removeFile(f.path);
      else if (f.action === "keep-reference") tx.writeFile(`${backupRel}/reference/${f.path}`, targetContent.get(f.path)!, { mustNotExist: true });
      const patch = patchFor.get(f.path);
      if (patch && f.patch) tx.writeFile(f.patch, patch, { mustNotExist: true });
    }
    for (const s of sqlPlan) {
      const cur = tx.readFile(s.relPath);
      if (cur && !cur.equals(s.content)) { notes.push(`기존 SQL 스크립트와 달라 유지했습니다: ${s.relPath}`); continue; }
      if (!cur) tx.writeFile(s.relPath, s.content);
      result.sql.push(s.relPath);
    }
    if (opts.faultInjection === "after-files") throw new Error("reassemble fault injection: after-files");
    const m: Manifest = manifest ?? { schemaVersion: 3, source: { ...catalog.source }, components: {} };
    m.source = { ...m.source, ...catalog.source };
    const now = new Date().toISOString();
    for (const c of selected) {
      const mine = files.filter((f) => f.componentId === c.id && f.action !== "delete" && f.state !== "user-added");
      const hashes: Record<string, { hash: string; srcHash: string }> = {};
      for (const f of mine) {
        const t = targetContent.get(f.path)!;
        const written = f.action === "keep-reference" ? readCurrent(f.path) : t;
        hashes[f.path] = { hash: hashOf(written), srcHash: hashOf(t) };
      }
      m.components[c.id] = { installedAt: now, files: mine.map((f) => f.path), hashes, sqlScripts: result.sql.filter((s) => sqlPlan.find((x) => x.relPath === s)?.componentId === c.id) };
    }
    m.schemaVersion = 3;
    tx.writeFile(MANIFEST_FILE, JSON.stringify(m, null, 2) + "\n");
    const planDoc = {
      createdAt: now, tool: "reassemble_egovframe_components", target, origin: result.origin, sourceEra,
      summary: result.summary, actions: result.actions, worklist: result.worklist, files: files.map(({ componentId, path: p, asset, state, action, patch }) => ({ componentId, path: p, asset, state, action, ...(patch ? { patch } : {}) })),
    };
    tx.writeFile(`${backupRel}/reassemble-plan.json`, JSON.stringify(planDoc, null, 2) + "\n", { mustNotExist: true });
  });
  result.manifestUpdated = true;
  result.backupDir = path.join(projectDir, backupRel);
  result.planPath = path.join(projectDir, backupRel, "reassemble-plan.json");

  if (opts.verify) {
    const b = await runBuild({ projectDir, goal: "compile", timeoutMs: opts.timeoutMs ?? 300_000, runner: opts.runner, platform: opts.platform }).catch((e: Error) => ({ ran: false, error: e.message }) as never);
    const errs: BuildError[] = (b as { errors?: BuildError[] }).errors ?? [];
    const relOf = (f: string) => { const r = path.isAbsolute(f) ? path.relative(projectDir, f) : f; return r.split(path.sep).join("/").replace(/^\.\//, ""); };
    const inFiles = new Map<string, number>();
    for (const e of errs) { const r = relOf(e.file); inFiles.set(r, (inFiles.get(r) ?? 0) + 1); }
    for (const w of result.worklist) { const n = inFiles.get(w.path); if (n) w.errors = n; }
    const reassembled = new Set(files.map((f) => f.path));
    result.verify = (b as { command?: string }).command
      ? { ran: true, success: (b as { success?: boolean }).success ?? null, command: (b as { command?: string }).command, durationMs: (b as { durationMs?: number }).durationMs, errors: errs.length, inReassembled: errs.filter((e) => reassembled.has(relOf(e.file))).length }
      : { ran: false, success: null, errors: 0, inReassembled: 0, reason: (b as { error?: string }).error ?? "빌드를 실행하지 못했습니다" };
  }
  return result;
}

function tagVersionMajor(tag: string): number { return Number(tag.match(/\d+/)?.[0] ?? 0); }
function kindOrder(k: ReassembleWorkItem["kind"]): number { return { "reapply-patch": 0, "removed-in-5x": 1, "unverified-replaced": 2, "review-config": 3 }[k]; }

/** 결과 Markdown. */
export function renderReassembleMarkdown(r: ReassembleResult): string {
  const L: string[] = [];
  L.push(`# 공통컴포넌트 재조립${r.dryRun ? " (미리보기)" : ""}`, ``);
  L.push(`- 경로: ${r.projectDir}`);
  L.push(`- 원본: ${r.origin.tag ?? "식별 실패"}${r.origin.mode === "fixed" ? " (지정)" : ""} → 목표: ${r.target.tag}${r.target.commit ? ` (${r.target.commit.slice(0, 7)})` : ""} · 좌표 세대 ${r.sourceEra}`);
  if (r.origin.candidates.length) L.push(`- 원본 태그 후보: ${r.origin.candidates.map((c) => `${c.tag} ${c.matched}/${c.total}(${Math.round(c.ratio * 100)}%)`).join(" · ")}`);
  L.push(`- 컴포넌트 ${r.components.length}종 · 파일 ${r.files.length}개 — ${REASSEMBLE_STATES.filter((s) => r.summary[s]).map((s) => `${REASSEMBLE_STATE_LABEL[s]} ${r.summary[s]}`).join(" · ") || "변경 없음"}`);
  L.push(`- 처리: 교체 ${r.actions.replace} · 추가 ${r.actions.add} · 삭제(백업) ${r.actions.delete} · 유지 ${r.actions.keep} · 유지+참고본 ${r.actions["keep-reference"]}`);
  if (r.backupDir) L.push(`- 백업·패치·계획: ${r.backupDir}`);
  if (r.sql.length) L.push(`- DB 스크립트 ${r.sql.length}개: ${r.sql.slice(0, 4).join(", ")}${r.sql.length > 4 ? " …" : ""}`);
  if (r.verify) L.push(`- 컴파일 검증: ${r.verify.ran ? `${r.verify.success ? "성공" : "실패"} · 오류 ${r.verify.errors}건(재조립 파일 ${r.verify.inReassembled}건)` : `건너뜀 — ${r.verify.reason}`}`);
  for (const n of r.notes) L.push(`- ${n}`);
  if (r.components.length) {
    L.push(``, `## 컴포넌트별`, ``, `| id | 이름 | 파일 | 같음 | 교체 | 사용자 수정 | 신규 | 5.x 제거 | 원본 미확인 |`, `|---|---|---|---|---|---|---|---|---|`);
    for (const c of r.components) { const s = c.summary; L.push(`| ${c.id} | ${c.name} | ${c.files} | ${s.identical} | ${s.unchanged} | ${s["user-modified"]} | ${s.new} | ${s["removed-unchanged"] + s["removed-modified"]} | ${s.unverified} |`); }
  }
  if (r.worklist.length) {
    const label: Record<ReassembleWorkItem["kind"], string> = { "reapply-patch": "사용자 변경 다시 반영", "removed-in-5x": "5.x 에서 제거된 파일", "unverified-replaced": "원본 미확인 교체", "review-config": "설정·자산 비교" };
    L.push(``, `## 작업 목록 (${r.worklist.length})`, ``);
    for (const w of r.worklist.slice(0, 60)) L.push(`- [${label[w.kind]}] \`${w.path}\`${w.errors ? ` — 컴파일 오류 ${w.errors}건` : ""}${w.patch ? ` — 패치 \`${w.patch}\`` : ""}`);
    if (r.worklist.length > 60) L.push(`- … 외 ${r.worklist.length - 60}건(format=json 또는 reassemble-plan.json)`);
  }
  L.push(``, `---`, r.dryRun ? `미리보기입니다. dryRun=false 로 적용하면 모든 변경이 하나의 transaction 으로 반영되고 매니페스트가 생겨 upgrade_egovframe_project·validate_egovframe_project 를 쓸 수 있습니다.` : `다음: migrate_egovframe_project(apply=true) 로 나머지 자동 항목을 치환하고, verify=true 로 컴파일 오류와 작업 목록을 확인하세요.`);
  return L.join("\n");
}
