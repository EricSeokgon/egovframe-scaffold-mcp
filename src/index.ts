#!/usr/bin/env node
/**
 * egovframe-scaffold-mcp — 전자정부 표준프레임워크 프로젝트 스캐폴딩 MCP 서버 (PoC)
 *
 * eGovFramework/egovframe-common-components#1120 제안의 개념 증명 구현입니다.
 * 공식 템플릿 저장소를 내려받아 프로젝트명·groupId·DB 타입을 적용한
 * 새 프로젝트 골격을 생성합니다.
 *
 * 제공 도구:
 *  - list_egovframe_templates : 사용 가능한 공식 템플릿 목록
 *  - create_egovframe_project : 템플릿으로 새 프로젝트 생성 (dryRun 미리보기 지원)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** 템플릿 다운로드 제한 시간(ms) — 무응답 시 무한 대기를 방지한다. */
export const DOWNLOAD_TIMEOUT_MS = 30_000;

/** 지원 템플릿 목록 (공식 eGovFramework 조직 저장소) */
export const TEMPLATES: Record<string, { repo: string; branch: string; description: string }> = {
  "simple-backend": {
    repo: "eGovFramework/egovframe-template-simple-backend",
    branch: "main",
    description: "심플홈페이지 백엔드 (Spring Boot 기반, REST API + 게시판/로그인 예제)",
  },
  "simple-react": {
    repo: "eGovFramework/egovframe-template-simple-react",
    branch: "main",
    description: "심플홈페이지 프론트엔드 (React)",
  },
};

/** 템플릿의 application.properties가 지원하는 DB 타입 */
export const DB_TYPES = ["hsql", "mysql", "oracle", "altibase", "tibero"] as const;

const NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;
const GROUP_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
// 브랜치/태그 이름에 허용할 안전 문자 (경로 주입·URL 오염 방지)
const REF_RE = /^[A-Za-z0-9._\/-]{1,128}$/;

export interface CreateOptions {
  projectName: string;
  groupId: string;
  database: (typeof DB_TYPES)[number];
  template: keyof typeof TEMPLATES;
  outputDir: string;
  /** 내려받을 브랜치 또는 태그(미지정 시 템플릿 기본 브랜치). 예: "main", "v4.3.0" */
  ref?: string;
  /** true면 디스크에 쓰지 않고 수행 예정 내용만 미리보기로 반환한다. */
  dryRun?: boolean;
}

export interface CreateResult {
  projectPath: string;
  filesExtracted: number;
  customized: string[];
  nextSteps: string[];
  ref: string;
  dryRun: boolean;
}

/** 제한 시간이 적용된 fetch. AbortError를 사람이 읽을 수 있는 메시지로 바꾼다. */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError")
      throw new Error(`템플릿 다운로드 시간 초과(${timeoutMs}ms): ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 템플릿 zip 다운로드 → 압축 해제 → 사용자 값 적용 (dryRun이면 미리보기만) */
export async function createProject(opts: CreateOptions): Promise<CreateResult> {
  const tpl = TEMPLATES[opts.template];
  if (!tpl) throw new Error(`알 수 없는 템플릿: ${opts.template}`);
  if (!NAME_RE.test(opts.projectName))
    throw new Error(`projectName은 소문자/숫자/하이픈 2~64자여야 합니다: ${opts.projectName}`);
  if (!GROUP_RE.test(opts.groupId))
    throw new Error(`groupId는 자바 패키지 형식이어야 합니다 (예: egovframework.example): ${opts.groupId}`);
  if (!DB_TYPES.includes(opts.database))
    throw new Error(`database는 ${DB_TYPES.join("|")} 중 하나여야 합니다: ${opts.database}`);

  const ref = (opts.ref ?? tpl.branch).trim();
  if (!REF_RE.test(ref))
    throw new Error(`ref(브랜치/태그)에 허용되지 않는 문자가 있습니다: ${ref}`);
  const dryRun = opts.dryRun === true;

  const projectPath = path.resolve(opts.outputDir, opts.projectName);
  if (!dryRun && fs.existsSync(projectPath))
    throw new Error(`대상 디렉터리가 이미 존재합니다: ${projectPath}`);

  // 1) 공식 템플릿 다운로드 (branch/tag/SHA 모두 허용)
  const zipUrl = `https://codeload.github.com/${tpl.repo}/zip/${ref}`;
  const res = await fetchWithTimeout(zipUrl, DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) throw new Error(`템플릿 다운로드 실패 (${res.status}) — ref='${ref}'가 존재하는지 확인하세요: ${zipUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  const rel = (name: string) => (name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name);

  const customized: string[] = [];

  // 2) 미리보기(dryRun): 쓰지 않고 수행 예정 내용만 계산
  if (dryRun) {
    const fileCount = entries.filter((e) => !e.isDirectory && rel(e.entryName)).length;
    const hasPom = entries.some((e) => rel(e.entryName) === "pom.xml");
    const hasProps = entries.some((e) => rel(e.entryName) === "src/main/resources/application.properties");
    const hasPkg = entries.some((e) => rel(e.entryName) === "package.json");
    if (hasPom) customized.push(`pom.xml (groupId=${opts.groupId}, artifactId/name=${opts.projectName}) — 적용 예정`);
    if (hasProps) customized.push(`src/main/resources/application.properties (Globals.DbType=${opts.database}) — 적용 예정`);
    if (hasPkg) customized.push(`package.json (name=${opts.projectName}) — 적용 예정`);
    return {
      projectPath,
      filesExtracted: fileCount,
      customized,
      ref,
      dryRun: true,
      nextSteps: [`미리보기 모드입니다. 실제 생성하려면 dryRun 없이 다시 호출하세요.`],
    };
  }

  // 3) 최상위 폴더를 제거하며 압축 해제
  let count = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const r = rel(e.entryName);
    if (!r) continue;
    const dest = path.join(projectPath, r);
    // zip slip 방지
    if (!dest.startsWith(projectPath + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
    count++;
  }

  // 4) pom.xml: 프로젝트 좌표 적용 (parent 좌표는 유지)
  const pomPath = path.join(projectPath, "pom.xml");
  if (fs.existsSync(pomPath)) {
    let pom = fs.readFileSync(pomPath, "utf-8");
    const artifactMatch = pom.match(/<artifactId>([^<]+)<\/artifactId>/);
    const oldArtifact = artifactMatch ? artifactMatch[1] : null;
    // 프로젝트 자신의 groupId(첫 번째 <groupId>)만 교체
    pom = pom.replace(/<groupId>[^<]+<\/groupId>/, `<groupId>${opts.groupId}</groupId>`);
    if (oldArtifact) pom = pom.split(oldArtifact).join(opts.projectName);
    fs.writeFileSync(pomPath, pom);
    customized.push(`pom.xml (groupId=${opts.groupId}, artifactId/name=${opts.projectName})`);
  }

  // 5) application.properties: DB 타입 적용
  const appProps = path.join(projectPath, "src/main/resources/application.properties");
  if (fs.existsSync(appProps)) {
    let props = fs.readFileSync(appProps, "utf-8");
    if (/^Globals\.DbType=.*$/m.test(props)) {
      props = props.replace(/^Globals\.DbType=.*$/m, `Globals.DbType=${opts.database}`);
      fs.writeFileSync(appProps, props);
      customized.push(`src/main/resources/application.properties (Globals.DbType=${opts.database})`);
    }
  }

  // 6) package.json: 프론트엔드 템플릿의 프로젝트명 적용
  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (typeof pkg.name === "string") {
        pkg.name = opts.projectName;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
        customized.push(`package.json (name=${opts.projectName})`);
      }
    } catch {
      // package.json 파싱 실패 시 건너뜀 (원본 유지)
    }
  }

  const nextSteps = [
    `cd ${projectPath}`,
    opts.template === "simple-backend"
      ? "mvn -B verify   # 빌드/테스트 (JDK 17, hsql 외 DB는 접속정보를 application-*.properties에 설정)"
      : "npm install && npm start",
    "자바 패키지 구조 변경(groupId에 맞춘 소스 이동)은 PoC 범위 밖입니다 — IDE의 rename refactoring 사용을 권장합니다.",
  ];

  return { projectPath, filesExtracted: count, customized, nextSteps, ref, dryRun: false };
}


/* ------------------------------------------------------------------ */
/* 컴포넌트 카탈로그 (M1) — 로드맵 '공통컴포넌트 선택 설치'의 1단계       */
/* 설계: docs/design-components-parameter.md                            */
/* ------------------------------------------------------------------ */

export interface CatalogComponent {
  id: string;
  name: string;
  category: string;
  description: string;
  /** 공통컴포넌트 저장소 루트 기준 경로 프리픽스(startsWith 매칭) */
  pathPrefixes: string[];
  dependsOn: string[];
  /** surveyedAt 시점의 파일 수(안내용 근사치) */
  approxFiles: number;
  /** 컴포넌트 매퍼가 참조하는 DB 테이블 (선별 DDL 추출용) */
  tables?: string[];
  /** 관련 공식 가이드 문서 (egovframe-docs 저장소 상대 경로) */
  docs?: { path: string; title: string }[];
}

export interface Catalog {
  schemaVersion: number;
  source: { repo: string; branch: string; surveyedAt: string };
  sqlNote: string;
  components: CatalogComponent[];
}

const CATALOG_URL = new URL("../catalog/components.json", import.meta.url);

/** 카탈로그 로드 + 무결성 검증(id 중복, 의존 대상 존재) */
export function loadCatalog(): Catalog {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_URL, "utf-8")) as Catalog;
  const ids = new Set<string>();
  for (const c of catalog.components) {
    if (ids.has(c.id)) throw new Error(`카탈로그 오류: 중복 id '${c.id}'`);
    ids.add(c.id);
  }
  for (const c of catalog.components)
    for (const d of c.dependsOn)
      if (!ids.has(d)) throw new Error(`카탈로그 오류: '${c.id}'가 의존하는 '${d}'가 카탈로그에 없습니다`);
  return catalog;
}

/** 요청 컴포넌트 → 의존성 포함 설치 순서(위상 정렬). 순환 의존 시 오류 */
export function resolveComponents(
  catalog: Catalog,
  ids: string[],
  includeDependencies = true,
): CatalogComponent[] {
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  for (const id of ids)
    if (!byId.has(id))
      throw new Error(`알 수 없는 컴포넌트 id: '${id}' — list_egovframe_components로 목록을 확인하세요`);
  const order: CatalogComponent[] = [];
  const state = new Map<string, 1 | 2>(); // 1=방문 중, 2=완료
  const visit = (id: string, stack: string[]) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) throw new Error(`카탈로그 오류: 순환 의존 감지 ${[...stack, id].join(" → ")}`);
    state.set(id, 1);
    if (includeDependencies) for (const d of byId.get(id)!.dependsOn) visit(d, [...stack, id]);
    state.set(id, 2);
    order.push(byId.get(id)!);
  };
  for (const id of ids) visit(id, []);
  return order;
}

export interface AddComponentsOptions {
  projectDir: string;
  components: string[];
  includeDependencies?: boolean;
  /** DB 스크립트를 함께 복사할 DB 종류 (공통컴포넌트 저장소 script/ 기준) */
  database?: (typeof ECC_DB_TYPES)[number];
  dryRun?: boolean;
}

/** 공통컴포넌트 저장소 script/ 디렉터리가 제공하는 DB 종류 */
export const ECC_DB_TYPES = [
  "altibase", "cubrid", "goldilocks", "maria", "mysql", "oracle", "postgres", "tibero",
] as const;

/** 공통컴포넌트 저장소 zip 다운로드 제한 시간(ms) — 템플릿보다 커서 별도 값 사용 */
export const COMPONENTS_DOWNLOAD_TIMEOUT_MS = 120_000;

export interface AddComponentsResult {
  projectDir: string;
  requested: string[];
  installOrder: { id: string; name: string; files: number }[];
  totalFiles: number;
  sqlScripts: string[];
  sqlNote: string;
  nextSteps: string[];
  dryRun: boolean;
}

/** 프로세스 수명 동안 공통컴포넌트 zip을 1회만 내려받기 위한 캐시 */
let eccZipCache: { key: string; zip: AdmZip } | null = null;

async function downloadComponentsZip(repo: string, branch: string): Promise<AdmZip> {
  const key = `${repo}@${branch}`;
  if (eccZipCache && eccZipCache.key === key) return eccZipCache.zip;
  const zipUrl = `https://codeload.github.com/${repo}/zip/${branch}`;
  const res = await fetchWithTimeout(zipUrl, COMPONENTS_DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) throw new Error(`공통컴포넌트 저장소 다운로드 실패 (${res.status}): ${zipUrl}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  eccZipCache = { key, zip };
  return zip;
}

/**
 * 공통컴포넌트 선택 조립 (M2).
 * - dryRun=true : 네트워크 없이 카탈로그 메타데이터로 설치 순서·규모 미리보기
 * - dryRun=false: 공통컴포넌트 저장소를 내려받아 선택 컴포넌트 파일을 대상 프로젝트에 복사.
 *   기존 파일과 충돌하면 아무것도 쓰지 않고 거부한다(전체 사전 검사).
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

  const zip = await downloadComponentsZip(catalog.source.repo, catalog.source.branch);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  const rel = (name: string) => (name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name);

  // 컴포넌트별 대상 파일 수집
  const plan: { entry: AdmZip.IZipEntry; relPath: string; componentId: string }[] = [];
  for (const c of order)
    for (const e of entries) {
      const r = rel(e.entryName);
      if (r && c.pathPrefixes.some((p) => r.startsWith(p))) plan.push({ entry: e, relPath: r, componentId: c.id });
    }
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
      if (!c.tables || c.tables.length === 0) { noTables.push(c); continue; }
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

  // 전체 사전 충돌 검사 — 하나라도 충돌하면 아무것도 쓰지 않음
  const conflicts: string[] = [];
  for (const { relPath } of [...plan, ...sqlPlan]) {
    const dest = path.join(projectDir, relPath);
    if (!dest.startsWith(projectDir + path.sep)) continue; // zip slip 방지
    if (fs.existsSync(dest)) conflicts.push(relPath);
  }
  if (conflicts.length > 0)
    throw new Error(
      `기존 파일과 충돌하여 중단합니다(총 ${conflicts.length}건, 아무것도 쓰지 않았습니다):\n` +
        conflicts.slice(0, 10).map((c) => `  - ${c}`).join("\n") +
        (conflicts.length > 10 ? `\n  … 외 ${conflicts.length - 10}건` : ""),
    );

  // 복사 실행
  const countBy = new Map<string, number>();
  for (const { entry, relPath, componentId } of plan) {
    const dest = path.join(projectDir, relPath);
    if (!dest.startsWith(projectDir + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
    countBy.set(componentId, (countBy.get(componentId) ?? 0) + 1);
  }
  const sqlScripts: string[] = [];
  const sqlBy = new Map<string, string[]>();
  for (const { relPath, content, componentId } of sqlPlan) {
    const dest = path.join(projectDir, relPath);
    if (!dest.startsWith(projectDir + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    sqlScripts.push(relPath);
    if (!sqlBy.has(componentId)) sqlBy.set(componentId, []);
    sqlBy.get(componentId)!.push(relPath);
  }

  const nextSteps = [
    opts.database
      ? `scripts/egovframe-components/${opts.database}/ddl|dml/<컴포넌트id>.sql — 컴포넌트별로 선별 추출된 스크립트를 순서대로 DB에 적용하세요.`
      : "database 파라미터를 지정하면 컴포넌트별로 선별 추출된 DDL·DML 스크립트도 함께 생성됩니다.",
    "복사된 소스는 egovframework.com.* 원본 패키지를 유지합니다 (eGovFrame IDE 마법사와 동일).",
    "빈 스캐너/설정에 egovframework.com 패키지 스캔이 포함되어 있는지 확인 후 mvn compile로 빌드를 검증하세요.",
    "일부 컴포넌트는 web.xml·필터·스케줄러 등 수동 설정이 필요할 수 있습니다 (공통컴포넌트 가이드 참조).",
  ];

  // 설치 매니페스트 기록 (제거·검증 지원)
  const manifest: Manifest = readManifest(projectDir) ?? {
    schemaVersion: 1,
    source: { repo: catalog.source.repo, branch: catalog.source.branch },
    components: {},
  };
  const now = new Date().toISOString();
  const filesBy = new Map<string, string[]>();
  for (const { relPath, componentId } of plan) {
    if (!filesBy.has(componentId)) filesBy.set(componentId, []);
    filesBy.get(componentId)!.push(relPath);
  }
  for (const c of order)
    manifest.components[c.id] = {
      installedAt: now,
      files: filesBy.get(c.id) ?? [],
      sqlScripts: sqlBy.get(c.id) ?? [],
    };
  writeManifest(projectDir, manifest);

  return {
    projectDir,
    requested: opts.components,
    installOrder: order.map((c) => ({ id: c.id, name: c.name, files: countBy.get(c.id) ?? 0 })),
    totalFiles: plan.length,
    sqlScripts,
    sqlNote: catalog.sqlNote,
    nextSteps,
    dryRun: false,
  };
}


/* ------------------------------------------------------------------ */
/* 컴포넌트 검색 (v0.5.0)                                               */
/* ------------------------------------------------------------------ */

export interface SearchResult {
  id: string;
  name: string;
  category: string;
  description: string;
  dependsOn: string[];
  approxFiles: number;
  score: number;
}

/** 카탈로그에서 키워드로 컴포넌트를 검색한다 (id·이름·설명·카테고리 부분 일치, 점수순). */
export function searchComponents(catalog: Catalog, query: string, category?: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) throw new Error("query가 비어 있습니다");
  const results: SearchResult[] = [];
  for (const c of catalog.components) {
    if (category && c.category !== category) continue;
    let score = 0;
    const id = c.id.toLowerCase();
    const name = c.name.toLowerCase();
    const desc = c.description.toLowerCase();
    if (id === q) score += 100;
    else if (id.includes(q)) score += 50;
    if (name.includes(q)) score += 40;
    if (desc.includes(q)) score += 20;
    if (c.category.toLowerCase() === q) score += 10;
    if (score > 0)
      results.push({ id: c.id, name: c.name, category: c.category, description: c.description,
        dependsOn: c.dependsOn, approxFiles: c.approxFiles, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* 설치 매니페스트 (v0.5.0) — 조립 내역 기록으로 제거·검증을 가능하게 함   */
/* ------------------------------------------------------------------ */

export const MANIFEST_FILE = ".egovframe-components.json";

export interface ManifestEntry {
  installedAt: string;
  files: string[];
  sqlScripts: string[];
  /** AI 컴포넌트가 pom에 삽입한 내역 (제거 시 마커 구간 정리용) */
  pom?: { backup: string; addedDeps: string[]; addedProps: string[] };
}

export interface Manifest {
  schemaVersion: number;
  source: { repo: string; branch: string };
  components: Record<string, ManifestEntry>;
}

export function readManifest(projectDir: string): Manifest | null {
  const p = path.join(projectDir, MANIFEST_FILE);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Manifest;
}

function writeManifest(projectDir: string, manifest: Manifest): void {
  fs.writeFileSync(path.join(projectDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
}

/* ------------------------------------------------------------------ */
/* 컴포넌트 제거 (v0.5.0)                                               */
/* ------------------------------------------------------------------ */

export interface RemoveOptions {
  projectDir: string;
  components: string[];
  dryRun?: boolean;
}

export interface RemoveResult {
  projectDir: string;
  removed: { id: string; files: number; sqlScripts: number }[];
  totalFiles: number;
  dryRun: boolean;
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

/**
 * 매니페스트에 기록된 파일만 삭제하여 컴포넌트를 제거한다.
 * 다른 설치 컴포넌트가 의존하는 컴포넌트는 제거를 거부한다.
 */
export async function removeComponents(opts: RemoveOptions): Promise<RemoveResult> {
  const projectDir = path.resolve(opts.projectDir);
  const manifest = readManifest(projectDir);
  if (!manifest)
    throw new Error(`설치 매니페스트(${MANIFEST_FILE})가 없습니다 — add_egovframe_components(v0.5.0 이상)로 조립한 프로젝트만 제거를 지원합니다`);

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
  const removed: RemoveResult["removed"] = [];
  let totalFiles = 0;
  for (const id of opts.components) {
    const entry = manifest.components[id];
    const all = [...entry.files, ...entry.sqlScripts];
    if (!dryRun) {
      for (const rel of all) {
        const target = path.join(projectDir, rel);
        if (!target.startsWith(projectDir + path.sep)) continue;
        if (fs.existsSync(target)) fs.unlinkSync(target);
        pruneEmptyDirs(path.dirname(target), projectDir);
      }
      if (entry.pom) stripAiPomAdditions(projectDir, id);
      delete manifest.components[id];
    }
    removed.push({ id, files: entry.files.length, sqlScripts: entry.sqlScripts.length });
    totalFiles += all.length;
  }
  if (!dryRun) {
    if (Object.keys(manifest.components).length === 0)
      fs.unlinkSync(path.join(projectDir, MANIFEST_FILE));
    else writeManifest(projectDir, manifest);
  }
  return { projectDir, removed, totalFiles, dryRun };
}

/* ------------------------------------------------------------------ */
/* 프로젝트 검증 (v0.5.0)                                               */
/* ------------------------------------------------------------------ */

export interface ValidateResult {
  projectDir: string;
  ok: boolean;
  manifestFound: boolean;
  components: { id: string; files: number; missing: number; missingSamples: string[] }[];
  dbType: string | null;
  dbScriptDirs: string[];
  /** AI 컴포넌트 실행 전제 진단 (경고와 별도 — ok 판정에 영향 없음) */
  aiChecks: { componentId: string; file: string; exists: boolean; note: string }[];
  warnings: string[];
}

/** \${user.home}·\${ENV:default} 플레이스홀더를 해석한다 (AI 설정 진단용) */
export function resolveConfigPlaceholders(value: string): string {
  let v = value;
  for (let i = 0; i < 5 && v.includes("${"); i++) {
    v = v.replace(/\$\{([^:}]+)(?::([^}]*))?\}/g, (_, name: string, def?: string) => {
      if (name === "user.home") return os.homedir();
      return process.env[name] ?? def ?? "";
    });
  }
  return v;
}

/** application-ai.yml에서 외부 파일 경로(file: URI·embedding-config-path)를 추출해 존재를 진단한다 */
export function collectAiChecks(projectDir: string, componentId: string): ValidateResult["aiChecks"] {
  const checks: ValidateResult["aiChecks"] = [];
  const ymlPath = path.join(projectDir, "src/main/resources/application-ai.yml");
  if (!fs.existsSync(ymlPath)) return checks;
  const yml = fs.readFileSync(ymlPath, "utf-8");
  const candidates = new Map<string, string>(); // raw → note
  for (const m of yml.matchAll(/file:([^\s"']+)/g)) candidates.set(m[1], "ONNX 모델/토크나이저");
  const ec = yml.match(/embedding-config-path:\s*(\S+)/);
  if (ec) candidates.set(ec[1], "임베딩 설정(JSON)");
  for (const [raw, note] of candidates) {
    const resolved = resolveConfigPlaceholders(raw);
    if (!resolved || resolved.includes("${")) continue;
    const abs = path.isAbsolute(resolved) ? resolved : path.join(projectDir, resolved);
    checks.push({ componentId, file: abs, exists: fs.existsSync(abs), note });
  }
  const compose = path.join(projectDir, "docker-compose.ai.yml");
  if (fs.existsSync(compose))
    checks.push({ componentId, file: compose, exists: true, note: "벡터 저장소 docker compose (기동: docker compose -f docker-compose.ai.yml up -d)" });
  return checks;
}

/** 조립된 프로젝트의 무결성을 진단한다 (파일 존재·DbType↔DDL 일치). */
export async function validateProject(opts: { projectDir: string }): Promise<ValidateResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const warnings: string[] = [];
  const manifest = readManifest(projectDir);

  const aiChecks: ValidateResult["aiChecks"] = [];
  const components: ValidateResult["components"] = [];
  if (manifest) {
    for (const [id, entry] of Object.entries(manifest.components)) {
      const missing = entry.files.filter((rel) => !fs.existsSync(path.join(projectDir, rel)));
      if (missing.length > 0)
        warnings.push(`컴포넌트 '${id}'의 파일 ${missing.length}개가 없습니다 (수동 삭제 또는 이동 가능성)`);
      components.push({ id, files: entry.files.length, missing: missing.length, missingSamples: missing.slice(0, 5) });
      if (entry.pom) {
        const pomPath = path.join(projectDir, "pom.xml");
        const pomText = fs.existsSync(pomPath) ? fs.readFileSync(pomPath, "utf-8") : "";
        if (!pomText.includes(`egovframe-scaffold-mcp:ai:${id}:deps:start`) && entry.pom.addedDeps.length > 0)
          warnings.push(`컴포넌트 '${id}'의 pom 삽입 마커가 없습니다 (수동 편집 가능성) — 의존성 ${entry.pom.addedDeps.length}건 확인 필요`);
      }
      if (entry.pom) aiChecks.push(...collectAiChecks(projectDir, id));
    }
  } else {
    warnings.push(`설치 매니페스트(${MANIFEST_FILE})가 없습니다 — v0.5.0 이전 조립이거나 컴포넌트 미설치 프로젝트입니다`);
  }

  // Globals.DbType ↔ 복사된 DB 스크립트 일치 확인
  let dbType: string | null = null;
  const propsPath = path.join(projectDir, "src/main/resources/application.properties");
  if (fs.existsSync(propsPath)) {
    const m = fs.readFileSync(propsPath, "utf-8").match(/^Globals\.DbType=(.*)$/m);
    if (m) dbType = m[1].trim();
  }
  const scriptsRoot = path.join(projectDir, "scripts/egovframe-components");
  const dbScriptDirs = fs.existsSync(scriptsRoot) ? fs.readdirSync(scriptsRoot) : [];
  if (dbType && dbScriptDirs.length > 0) {
    // 템플릿 DbType(예: mysql)과 스크립트 DB(예: mysql|maria)가 다르면 경고
    const matched = dbScriptDirs.some((d) => d === dbType || (dbType === "mysql" && d === "maria"));
    if (!matched)
      warnings.push(`Globals.DbType='${dbType}'인데 복사된 DB 스크립트(${dbScriptDirs.join(", ")})와 일치하지 않습니다`);
  }

  return { projectDir, ok: warnings.length === 0, manifestFound: manifest !== null, components, dbType, dbScriptDirs, aiChecks, warnings };
}


/* ------------------------------------------------------------------ */
/* 가이드 문서 조회 (v0.7.0)                                            */
/* ------------------------------------------------------------------ */

export const DOCS_REPO = "eGovFramework/egovframe-docs";
export const GUIDE_MAX_CHARS = 15_000;

export interface GuideResult {
  componentId: string;
  docs: { path: string; title: string }[];
  selected: { path: string; title: string } | null;
  content: string | null;
  truncated: boolean;
}

/** 컴포넌트의 공식 가이드 문서를 egovframe-docs에서 가져온다. */
export async function getGuide(componentId: string, docIndex = 0): Promise<GuideResult> {
  const catalog = loadCatalog();
  const comp = catalog.components.find((c) => c.id === componentId);
  if (!comp)
    throw new Error(`알 수 없는 컴포넌트 id: '${componentId}' — search_egovframe_components로 검색해 보세요`);
  const docs = comp.docs ?? [];
  if (docs.length === 0)
    return { componentId, docs: [], selected: null, content: null, truncated: false };
  if (docIndex < 0 || docIndex >= docs.length)
    throw new Error(`docIndex는 0~${docs.length - 1} 범위여야 합니다 (문서 ${docs.length}건)`);
  const sel = docs[docIndex];
  const url = `https://raw.githubusercontent.com/${DOCS_REPO}/main/${sel.path}`;
  const res = await fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) throw new Error(`가이드 문서 다운로드 실패 (${res.status}): ${url}`);
  let content = await res.text();
  const truncated = content.length > GUIDE_MAX_CHARS;
  if (truncated) content = content.slice(0, GUIDE_MAX_CHARS);
  return { componentId, docs, selected: sel, content, truncated };
}

/* ------------------------------------------------------------------ */
/* AI 컴포넌트 조립 (M1 미리보기 + M2 실조립) — 설계: docs/design-ai-components.md */
/* 소스: eGovFramework/egovframe-ai-rag (Spring AI·LangChain4j RAG 샘플)   */
/* ------------------------------------------------------------------ */

export const AI_STACKS = ["spring-ai", "langchain4j"] as const;

export interface AiMavenDependency {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: string;
  optional?: boolean;
  exclusions?: { groupId: string; artifactId: string }[];
}

export interface AiCopyGroup {
  /** 모듈 상대 경로. "a -> b"는 조립 시 이름 변경 복사 */
  paths: string[];
  files: number;
}

export interface AiComponent {
  id: string;
  stack: (typeof AI_STACKS)[number];
  kind: "ai";
  name: string;
  description: string;
  modulePath: string;
  vectorStore: string;
  conflictsWith: string[];
  requires: { java: string; parent: string };
  copyGroups: Record<"source" | "config" | "ui" | "infra" | "tests", AiCopyGroup>;
  approxFiles: number;
  mavenDependencies: AiMavenDependency[];
  mavenProperties: Record<string, string>;
  prerequisites: string[];
}

export interface AiCatalog {
  schemaVersion: number;
  source: { repo: string; branch: string; surveyedAt: string };
  note: string;
  components: AiComponent[];
}

const AI_CATALOG_URL = new URL("../catalog/ai-components.json", import.meta.url);

/** AI 카탈로그 로드 + 무결성 검증 (id 중복, conflictsWith 대상 존재, stack 유일) */
export function loadAiCatalog(): AiCatalog {
  const catalog = JSON.parse(fs.readFileSync(AI_CATALOG_URL, "utf-8")) as AiCatalog;
  const ids = new Set<string>();
  const stacks = new Set<string>();
  for (const c of catalog.components) {
    if (ids.has(c.id)) throw new Error(`AI 카탈로그 오류: 중복 id '${c.id}'`);
    ids.add(c.id);
    if (stacks.has(c.stack)) throw new Error(`AI 카탈로그 오류: 중복 stack '${c.stack}'`);
    stacks.add(c.stack);
  }
  for (const c of catalog.components)
    for (const x of c.conflictsWith)
      if (!ids.has(x)) throw new Error(`AI 카탈로그 오류: '${c.id}'의 conflictsWith '${x}'가 카탈로그에 없습니다`);
  return catalog;
}

export interface AddAiComponentsOptions {
  projectDir: string;
  stack: (typeof AI_STACKS)[number];
  includeInfra?: boolean;
  includeUi?: boolean;
  includeTests?: boolean;
  ref?: string;
  dryRun?: boolean;
}

export interface AiPlanResult {
  projectDir: string;
  component: { id: string; name: string; vectorStore: string };
  compatibility: {
    pomFound: boolean;
    required: string;
    parentFound: string | null;
    parentOk: boolean | null;
    warnings: string[];
  };
  dependencyChanges: { toAdd: string[]; alreadyPresent: string[] };
  copyPlan: { group: string; files: number; paths: string[] }[];
  totalFiles: number;
  prerequisites: string[];
  nextSteps: string[];
  dryRun: boolean;
}

/** pom 마커 주석 — 제거 시 이 구간만 걷어내 원복한다 */
const AI_POM_MARKER = (id: string, kind: "deps" | "props", pos: "start" | "end") =>
  `<!-- egovframe-scaffold-mcp:ai:${id}:${kind}:${pos} -->`;

interface AiPlanInternal {
  comp: AiComponent;
  projectDir: string;
  compatibility: AiPlanResult["compatibility"];
  toAddDeps: AiMavenDependency[];
  alreadyPresent: string[];
  toAddProps: Record<string, string>;
  groups: (keyof AiComponent["copyGroups"])[];
}

const depCoord = (d: AiMavenDependency) =>
  `${d.groupId}:${d.artifactId}${d.version ? ":" + d.version : ""}${d.scope ? " (" + d.scope + ")" : ""}`;

/** 공통 게이트·의존성 diff·복사 그룹 계산 (dryRun/실조립 공용) */
function computeAiPlan(opts: AddAiComponentsOptions): AiPlanInternal {
  if (!AI_STACKS.includes(opts.stack))
    throw new Error(`stack은 ${AI_STACKS.join("|")} 중 하나여야 합니다: ${String(opts.stack)}`);

  const catalog = loadAiCatalog();
  const comp = catalog.components.find((c) => c.stack === opts.stack)!;
  const projectDir = path.resolve(opts.projectDir);

  // 매니페스트 게이트: 동일/배타 스택 설치 여부
  const manifest = readManifest(projectDir);
  if (manifest) {
    if (manifest.components[comp.id])
      throw new Error(`'${comp.id}'가 이미 설치되어 있습니다 (매니페스트 기준)`);
    for (const x of comp.conflictsWith)
      if (manifest.components[x])
        throw new Error(
          `상호 배타 컴포넌트 '${x}'가 이미 설치되어 있습니다 — 두 AI 스택은 같은 패키지(com.example.chat)·UI 경로를 사용합니다. 먼저 remove_egovframe_components로 제거하세요`,
        );
  }

  // 호환성 게이트: 부모 POM 좌표 확인 + 의존성/프로퍼티 diff
  const warnings: string[] = [];
  const pomPath = path.join(projectDir, "pom.xml");
  const pomFound = fs.existsSync(pomPath);
  let parentFound: string | null = null;
  let parentOk: boolean | null = null;
  const toAddDeps: AiMavenDependency[] = [];
  const alreadyPresent: string[] = [];
  const toAddProps: Record<string, string> = {};
  if (pomFound) {
    const pom = fs.readFileSync(pomPath, "utf-8");
    const pm = pom.match(/<parent>[\s\S]*?<\/parent>/);
    if (pm) {
      const a = pm[0].match(/<artifactId>([^<]*)<\/artifactId>/)?.[1]?.trim();
      const v = pm[0].match(/<version>([^<]*)<\/version>/)?.[1]?.trim();
      parentFound = a ? `${a}:${v ?? "?"}` : null;
    }
    const [reqA, reqV] = comp.requires.parent.split(":");
    parentOk = parentFound !== null && parentFound.startsWith(`${reqA}:`);
    if (!parentOk)
      warnings.push(
        `부모 POM이 '${comp.requires.parent}'가 아닙니다(발견: ${parentFound ?? "없음"}) — Boot 기반 템플릿(simple-backend)에서 지원합니다`,
      );
    else if (parentFound !== comp.requires.parent)
      warnings.push(`부모 POM 버전이 다릅니다(요구 ${reqV}, 발견 ${parentFound}) — BOM 관리 버전 차이를 확인하세요`);
    for (const d of comp.mavenDependencies) {
      if (pom.includes(`<artifactId>${d.artifactId}</artifactId>`)) alreadyPresent.push(depCoord(d));
      else toAddDeps.push(d);
    }
    for (const [k, v] of Object.entries(comp.mavenProperties))
      if (!pom.includes(`<${k}>`)) toAddProps[k] = v;
  } else {
    warnings.push("pom.xml이 없습니다 — Boot 백엔드 프로젝트 루트 경로인지 확인하세요");
  }

  // 복사 그룹: source·config 필수, ui/infra/tests는 옵션
  const groups: (keyof AiComponent["copyGroups"])[] = ["source", "config"];
  if (opts.includeUi !== false) groups.push("ui");
  if (opts.includeInfra !== false) groups.push("infra");
  if (opts.includeTests === true) groups.push("tests");

  return {
    comp,
    projectDir,
    compatibility: { pomFound, required: comp.requires.parent, parentFound, parentOk, warnings },
    toAddDeps,
    alreadyPresent,
    toAddProps,
    groups,
  };
}

/** AI 컴포넌트 조립 계획 — dryRun 미리보기 (네트워크 불필요) */
export async function planAiComponents(opts: AddAiComponentsOptions): Promise<AiPlanResult> {
  const p = computeAiPlan(opts);
  const copyPlan = p.groups.map((g) => ({
    group: g,
    files: p.comp.copyGroups[g].files,
    paths: p.comp.copyGroups[g].paths,
  }));
  return {
    projectDir: p.projectDir,
    component: { id: p.comp.id, name: p.comp.name, vectorStore: p.comp.vectorStore },
    compatibility: p.compatibility,
    dependencyChanges: { toAdd: p.toAddDeps.map(depCoord), alreadyPresent: p.alreadyPresent },
    copyPlan,
    totalFiles: copyPlan.reduce((n, g) => n + g.files, 0),
    prerequisites: p.comp.prerequisites,
    nextSteps: ["미리보기 모드입니다. 실제 조립하려면 dryRun 없이 다시 호출하세요."],
    dryRun: true,
  };
}

/** 프로세스 수명 동안 AI 샘플 zip을 1회만 내려받기 위한 캐시 */
let aiZipCache: { key: string; zip: AdmZip } | null = null;

async function downloadAiZip(repo: string, branch: string): Promise<AdmZip> {
  const key = `${repo}@${branch}`;
  if (aiZipCache && aiZipCache.key === key) return aiZipCache.zip;
  const zipUrl = `https://codeload.github.com/${repo}/zip/${branch}`;
  const res = await fetchWithTimeout(zipUrl, COMPONENTS_DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) throw new Error(`AI 샘플 저장소 다운로드 실패 (${res.status}): ${zipUrl}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  aiZipCache = { key, zip };
  return zip;
}

/** copyGroups 경로("src" 또는 "src -> dest")를 zip 상대경로 → 대상 상대경로 매핑으로 해석 */
function mapAiEntry(relInModule: string, groupPaths: string[]): string | null {
  for (const spec of groupPaths) {
    const [src, dest] = spec.split("->").map((s) => s.trim());
    const target = dest ?? src;
    if (src.endsWith("/")) {
      if (relInModule.startsWith(src)) return target + relInModule.slice(src.length);
    } else if (relInModule === src) {
      return target;
    }
  }
  return null;
}

/** XML 의존성 블록 직렬화 (exclusions·scope·optional 보존) */
function depToXml(d: AiMavenDependency, indent = "        "): string {
  const i2 = indent + "    ";
  const lines = [`${indent}<dependency>`, `${i2}<groupId>${d.groupId}</groupId>`, `${i2}<artifactId>${d.artifactId}</artifactId>`];
  if (d.version) lines.push(`${i2}<version>${d.version}</version>`);
  if (d.scope) lines.push(`${i2}<scope>${d.scope}</scope>`);
  if (d.optional) lines.push(`${i2}<optional>true</optional>`);
  if (d.exclusions?.length) {
    lines.push(`${i2}<exclusions>`);
    for (const e of d.exclusions)
      lines.push(`${i2}    <exclusion>`, `${i2}        <groupId>${e.groupId}</groupId>`, `${i2}        <artifactId>${e.artifactId}</artifactId>`, `${i2}    </exclusion>`);
    lines.push(`${i2}</exclusions>`);
  }
  lines.push(`${indent}</dependency>`);
  return lines.join("\n");
}

/** dependencyManagement 밖의 프로젝트 직속 </dependencies> 위치를 찾는다 */
export function findProjectDependenciesClose(pom: string): number {
  const dmStart = pom.indexOf("<dependencyManagement>");
  const dmEnd = pom.indexOf("</dependencyManagement>");
  let idx = -1;
  const re = /<\/dependencies>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pom)) !== null) {
    if (dmStart >= 0 && m.index > dmStart && m.index < dmEnd + 24) continue; // dependencyManagement 내부
    idx = m.index;
    break;
  }
  return idx;
}

export interface AddAiResult extends AiPlanResult {
  copiedFiles: number;
  pomChanged: boolean;
  pomBackup: string | null;
}

export const AI_POM_BACKUP = "pom.xml.bak-ai";

/**
 * AI 컴포넌트 실조립 (M2).
 * - 파일 복사: 전체 사전 충돌 검사 후 하나라도 충돌하면 아무것도 쓰지 않고 거부 (원자적)
 * - pom 병합: 누락 좌표만 마커 주석 구간으로 삽입(기존 항목 불변), 병합 전 pom.xml.bak-ai 백업
 * - 설정 프로필화: application.yml → application-ai.yml 복사 (기존 설정 파일은 수정하지 않음)
 * - 매니페스트 기록: remove_egovframe_components가 파일과 pom 삽입분을 함께 정리
 */
export async function addAiComponents(opts: AddAiComponentsOptions): Promise<AddAiResult> {
  if (opts.dryRun === true) {
    const plan = await planAiComponents(opts);
    return { ...plan, copiedFiles: 0, pomChanged: false, pomBackup: null };
  }

  const p = computeAiPlan(opts);
  const { comp, projectDir } = p;

  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`대상 프로젝트 디렉터리가 없습니다: ${projectDir} — 먼저 create_egovframe_project로 생성하세요`);
  if (!p.compatibility.pomFound)
    throw new Error(`pom.xml이 없습니다: ${projectDir} — Boot 백엔드 프로젝트 루트에서 실행하세요`);
  if (p.compatibility.parentOk === false)
    throw new Error(
      `부모 POM 불일치: 요구 '${comp.requires.parent}', 발견 '${p.compatibility.parentFound ?? "없음"}' — egovframe-boot-starter-parent 기반 Boot 프로젝트만 지원합니다 (dryRun으로 진단 가능)`,
    );

  // ---- 다운로드 & 파일 계획 ----
  const catalog = loadAiCatalog();
  const zip = await downloadAiZip(catalog.source.repo, opts.ref ?? catalog.source.branch);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  const modPrefix = rootPrefix + comp.modulePath + "/";

  const plan: { entry: AdmZip.IZipEntry; destRel: string; group: string }[] = [];
  for (const e of entries) {
    if (!e.entryName.startsWith(modPrefix)) continue;
    const relInModule = e.entryName.slice(modPrefix.length);
    for (const g of p.groups) {
      const destRel = mapAiEntry(relInModule, comp.copyGroups[g].paths);
      if (destRel !== null) {
        plan.push({ entry: e, destRel, group: g });
        break;
      }
    }
  }
  if (plan.length === 0)
    throw new Error(`조립할 파일을 찾지 못했습니다 — 카탈로그(${catalog.source.surveyedAt})와 저장소 구조가 달라졌을 수 있습니다. npm run generate:ai-catalog로 재생성하세요`);

  // ---- 전체 사전 충돌 검사 (원자적 거부) ----
  const conflicts = plan.filter((f) => fs.existsSync(path.join(projectDir, f.destRel))).map((f) => f.destRel);
  if (conflicts.length > 0)
    throw new Error(
      `기존 파일과 충돌하여 조립을 거부합니다 (${conflicts.length}개): ${conflicts.slice(0, 10).join(", ")}${conflicts.length > 10 ? " 외" : ""} — 아무 파일도 쓰지 않았습니다`,
    );
  const pomPath = path.join(projectDir, "pom.xml");
  const backupPath = path.join(projectDir, AI_POM_BACKUP);
  if ((p.toAddDeps.length > 0 || Object.keys(p.toAddProps).length > 0) && fs.existsSync(backupPath))
    throw new Error(`pom 백업(${AI_POM_BACKUP})이 이미 있습니다 — 이전 조립 잔여물을 정리한 뒤 다시 시도하세요`);

  // ---- 파일 복사 ----
  for (const f of plan) {
    const target = path.join(projectDir, f.destRel);
    if (!target.startsWith(projectDir + path.sep)) throw new Error(`경로 이탈 감지: ${f.destRel}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.entry.getData());
  }

  // ---- pom 병합 (마커 구간 삽입) ----
  let pomChanged = false;
  if (p.toAddDeps.length > 0 || Object.keys(p.toAddProps).length > 0) {
    let pom = fs.readFileSync(pomPath, "utf-8");
    fs.writeFileSync(backupPath, pom);
    if (p.toAddDeps.length > 0) {
      const close = findProjectDependenciesClose(pom);
      if (close < 0) throw new Error("pom.xml에서 <dependencies> 블록을 찾지 못했습니다");
      const block = [
        `        ${AI_POM_MARKER(comp.id, "deps", "start")}`,
        ...p.toAddDeps.map((d) => depToXml(d)),
        `        ${AI_POM_MARKER(comp.id, "deps", "end")}`,
        "    ",
      ].join("\n");
      pom = pom.slice(0, close) + block + pom.slice(close);
    }
    if (Object.keys(p.toAddProps).length > 0) {
      const pClose = pom.indexOf("</properties>");
      if (pClose < 0) throw new Error("pom.xml에서 <properties> 블록을 찾지 못했습니다");
      const block = [
        `        ${AI_POM_MARKER(comp.id, "props", "start")}`,
        ...Object.entries(p.toAddProps).map(([k, v]) => `        <${k}>${v}</${k}>`),
        `        ${AI_POM_MARKER(comp.id, "props", "end")}`,
        "    ",
      ].join("\n");
      pom = pom.slice(0, pClose) + block + pom.slice(pClose);
    }
    fs.writeFileSync(pomPath, pom);
    pomChanged = true;
  }

  // ---- 매니페스트 기록 ----
  const manifest: Manifest = readManifest(projectDir) ?? {
    schemaVersion: 1,
    source: { repo: catalog.source.repo, branch: catalog.source.branch },
    components: {},
  };
  manifest.components[comp.id] = {
    installedAt: new Date().toISOString(),
    files: plan.map((f) => f.destRel),
    sqlScripts: [],
    pom: pomChanged
      ? { backup: AI_POM_BACKUP, addedDeps: p.toAddDeps.map((d) => d.artifactId), addedProps: Object.keys(p.toAddProps) }
      : undefined,
  };
  writeManifest(projectDir, manifest);

  const copyPlan = p.groups.map((g) => ({
    group: g as string,
    files: plan.filter((f) => f.group === g).length,
    paths: comp.copyGroups[g].paths,
  }));
  return {
    projectDir,
    component: { id: comp.id, name: comp.name, vectorStore: comp.vectorStore },
    compatibility: p.compatibility,
    dependencyChanges: { toAdd: p.toAddDeps.map(depCoord), alreadyPresent: p.alreadyPresent },
    copyPlan,
    totalFiles: plan.length,
    copiedFiles: plan.length,
    pomChanged,
    pomBackup: pomChanged ? AI_POM_BACKUP : null,
    prerequisites: comp.prerequisites,
    nextSteps: [
      "Ollama(>=0.17.1) 설치 및 LLM 모델 준비 (폐쇄망 절차는 egovframe-ai-rag README 참조)",
      "ONNX 임베딩 모델 익스포트·배치",
      `docker compose -f docker-compose.ai.yml up -d 로 벡터 저장소(${comp.vectorStore}) 기동`,
      "spring.profiles.active=ai 로 애플리케이션 실행 (application-ai.yml 사용)",
      "브라우저에서 채팅 UI 접속 (경로·포트는 application-ai.yml 참조)",
    ],
    dryRun: false,
  };
}

/** AI 컴포넌트의 pom 삽입분(마커 구간)을 걷어낸다 — remove 시 호출 */
export function stripAiPomAdditions(projectDir: string, componentId: string): boolean {
  const pomPath = path.join(projectDir, "pom.xml");
  if (!fs.existsSync(pomPath)) return false;
  let pom = fs.readFileSync(pomPath, "utf-8");
  let changed = false;
  for (const kind of ["deps", "props"] as const) {
    const start = pom.indexOf(AI_POM_MARKER(componentId, kind, "start"));
    const endMark = AI_POM_MARKER(componentId, kind, "end");
    const end = pom.indexOf(endMark);
    if (start >= 0 && end > start) {
      // 마커 라인 앞 들여쓰기부터 end 마커 라인 끝(개행 포함)까지 제거
      const lineStart = pom.lastIndexOf("\n", start) + 1;
      let lineEnd = end + endMark.length;
      while (lineEnd < pom.length && pom[lineEnd] !== "\n") lineEnd++;
      lineEnd++; // 개행 포함
      pom = pom.slice(0, lineStart) + pom.slice(lineEnd);
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(pomPath, pom);
  const backup = path.join(projectDir, AI_POM_BACKUP);
  if (fs.existsSync(backup)) fs.unlinkSync(backup);
  return changed;
}

/* ------------------------------------------------------------------ */
/* MCP 서버                                                             */
/* ------------------------------------------------------------------ */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "egovframe-scaffold-mcp", version: "0.10.0" });

  server.tool(
    "list_egovframe_templates",
    "사용 가능한 전자정부 표준프레임워크 프로젝트 템플릿 목록을 반환합니다.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ templates: TEMPLATES, databases: DB_TYPES }, null, 2),
        },
      ],
    }),
  );

  server.tool(
    "create_egovframe_project",
    "전자정부 표준프레임워크 공식 템플릿으로 새 프로젝트 골격을 생성합니다. " +
      "공식 GitHub 템플릿을 내려받아 projectName/groupId/DB 타입을 적용합니다. " +
      "dryRun=true로 먼저 미리보기할 수 있습니다.",
    {
      projectName: z.string().describe("프로젝트명(artifactId). 소문자·숫자·하이픈, 예: my-egov-app"),
      groupId: z.string().describe("자바 groupId. 예: egovframework.example"),
      database: z.enum(DB_TYPES).default("hsql").describe("DB 타입 (템플릿 지원: hsql|mysql|oracle|altibase|tibero)"),
      template: z.enum(Object.keys(TEMPLATES) as [string, ...string[]]).default("simple-backend").describe("템플릿 종류"),
      outputDir: z.string().describe("프로젝트를 생성할 상위 디렉터리(절대경로 권장)"),
      ref: z.string().optional().describe("내려받을 브랜치/태그(미지정 시 템플릿 기본 브랜치). 예: main, v4.3.0"),
      dryRun: z.boolean().default(false).describe("true면 디스크에 쓰지 않고 생성 예정 내용만 미리보기"),
    },
    async (args) => {
      const result = await createProject(args as CreateOptions);
      const head = result.dryRun
        ? `🔍 미리보기(dryRun): ${result.projectPath}`
        : `✅ 프로젝트 생성 완료: ${result.projectPath}`;
      const text = [
        head,
        `- 템플릿 ref: ${result.ref}`,
        `- ${result.dryRun ? "생성 예정" : "추출"} 파일: ${result.filesExtracted}개`,
        `- ${result.dryRun ? "적용 예정 설정" : "적용된 설정"}:`,
        ...result.customized.map((c) => `  · ${c}`),
        ``,
        `다음 단계:`,
        ...result.nextSteps.map((s, i) => `  ${i + 1}. ${s}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );


  server.tool(
    "list_egovframe_components",
    "선택 설치를 지원하는 공통컴포넌트 카탈로그를 반환합니다 (저장소 스캔으로 자동 생성, scripts/generate-catalog.mjs).",
    {},
    async () => {
      const catalog = loadCatalog();
      let ai: { source: AiCatalog["source"]; components: { id: string; stack: string; name: string; description: string; approxFiles: number }[] } | undefined;
      try {
        const aiCat = loadAiCatalog();
        ai = {
          source: aiCat.source,
          components: aiCat.components.map((c) => ({
            id: c.id, stack: c.stack, name: c.name, description: c.description, approxFiles: c.approxFiles,
          })),
        };
      } catch { /* AI 카탈로그가 없어도 기본 목록은 동작 */ }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                source: catalog.source,
                sqlNote: catalog.sqlNote,
                aiComponents: ai,
                components: catalog.components.map((c) => ({
                  id: c.id, name: c.name, category: c.category,
                  description: c.description, dependsOn: c.dependsOn, approxFiles: c.approxFiles,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "add_egovframe_components",
    "공통컴포넌트를 골라 기존 프로젝트에 조립합니다. 의존 컴포넌트를 포함해 소스·매퍼·JSP를 복사하고, " +
      "database 지정 시 DB DDL·DML 스크립트도 복사합니다. 기존 파일과 충돌하면 아무것도 쓰지 않고 거부합니다. " +
      "dryRun=true로 먼저 미리볼 수 있습니다.",
    {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장). 먼저 create_egovframe_project로 생성"),
      components: z.array(z.string()).min(1).describe("컴포넌트 id 목록. 예: [\"bbs\", \"login\"]"),
      includeDependencies: z.boolean().default(true).describe("의존 컴포넌트 자동 포함 여부"),
      database: z.enum(ECC_DB_TYPES).optional().describe("DB 스크립트 복사 대상 DB (altibase|cubrid|goldilocks|maria|mysql|oracle|postgres|tibero)"),
      dryRun: z.boolean().default(false).describe("true면 복사 없이 설치 순서·규모만 미리보기(네트워크 불필요)"),
    },
    async (args) => {
      const r = await addComponents(args as AddComponentsOptions);
      const head = r.dryRun
        ? `🔍 컴포넌트 조립 미리보기(dryRun): ${r.projectDir}`
        : `✅ 컴포넌트 조립 완료: ${r.projectDir}`;
      const text = [
        head,
        `- 요청: ${r.requested.join(", ")}`,
        `- 설치 순서(의존성 포함):`,
        ...r.installOrder.map((c, i) => `  ${i + 1}. ${c.id} — ${c.name} (${r.dryRun ? "약 " : ""}${c.files}개 파일)`),
        `- 총 ${r.dryRun ? "예상 " : ""}복사 파일: ${r.totalFiles}개`,
        ...(r.sqlScripts.length ? [`- DB 스크립트: ${r.sqlScripts.length}개 복사`] : []),
        `- 참고: ${r.sqlNote}`,
        ``,
        `다음 단계:`,
        ...r.nextSteps.map((s, i) => `  ${i + 1}. ${s}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "search_egovframe_components",
    "키워드로 공통컴포넌트를 검색합니다 (id·이름·설명·카테고리 부분 일치, 점수순 상위 10건).",
    {
      query: z.string().describe("검색어. 예: 게시판, bbs, 로그인"),
      category: z.string().optional().describe("카테고리 필터 (cmm|cop|uss|sym|sec|utl|dam|ext|ssi|sts|uat)"),
    },
    async (args) => {
      const results = searchComponents(loadCatalog(), args.query as string, args.category as string | undefined);
      const text = results.length === 0
        ? `'${args.query}'에 해당하는 컴포넌트가 없습니다 — list_egovframe_components로 전체 목록을 확인하세요`
        : [`🔎 '${args.query}' 검색 결과 (${results.length}건):`,
           ...results.map((r, i) => `  ${i + 1}. ${r.id} — ${r.name} [${r.category}] (${r.approxFiles}개 파일${r.dependsOn.length ? ", 의존: " + r.dependsOn.join(",") : ""})`)].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "remove_egovframe_components",
    "add_egovframe_components로 조립한 컴포넌트를 제거합니다. 설치 매니페스트에 기록된 파일만 삭제하며, " +
      "다른 설치 컴포넌트가 의존하는 컴포넌트는 거부합니다. dryRun 미리보기를 지원합니다.",
    {
      projectDir: z.string().describe("대상 프로젝트 디렉터리"),
      components: z.array(z.string()).min(1).describe("제거할 컴포넌트 id 목록"),
      dryRun: z.boolean().default(false).describe("true면 삭제 없이 대상만 미리보기"),
    },
    async (args) => {
      const r = await removeComponents(args as RemoveOptions);
      const head = r.dryRun ? `🔍 제거 미리보기(dryRun): ${r.projectDir}` : `🗑️ 컴포넌트 제거 완료: ${r.projectDir}`;
      const text = [head,
        ...r.removed.map((c) => `  - ${c.id}: 파일 ${c.files}개${c.sqlScripts ? `, DB 스크립트 ${c.sqlScripts}개` : ""}`),
        `- 총 ${r.dryRun ? "삭제 예정" : "삭제"} 파일: ${r.totalFiles}개`,
        ...(r.dryRun ? ["", "실제 제거하려면 dryRun 없이 다시 호출하세요."] : []),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "validate_egovframe_project",
    "조립된 프로젝트의 무결성을 진단합니다: 설치 매니페스트 기준 파일 존재 확인, Globals.DbType과 복사된 DB 스크립트 일치 확인.",
    {
      projectDir: z.string().describe("검증할 프로젝트 디렉터리"),
    },
    async (args) => {
      const r = await validateProject(args as { projectDir: string });
      const text = [
        r.ok ? `✅ 검증 통과: ${r.projectDir}` : `⚠️ 경고 ${r.warnings.length}건: ${r.projectDir}`,
        `- 매니페스트: ${r.manifestFound ? "있음" : "없음"}`,
        ...(r.components.length
          ? [`- 설치 컴포넌트:`, ...r.components.map((c) => `  · ${c.id}: ${c.files}개 파일${c.missing ? ` (누락 ${c.missing}개: ${c.missingSamples.join(", ")})` : " (정상)"}`)]
          : []),
        `- Globals.DbType: ${r.dbType ?? "(미검출)"}` + (r.dbScriptDirs.length ? ` / DB 스크립트: ${r.dbScriptDirs.join(", ")}` : ""),
        ...(r.aiChecks.length
          ? ["- AI 실행 전제 진단:", ...r.aiChecks.map((c) => `  ${c.exists ? "✓" : "✗"} ${c.note}: ${c.file}${c.exists ? "" : " (준비 필요)"}`)]
          : []),
        ...(r.warnings.length ? ["", "경고:", ...r.warnings.map((w) => `  ! ${w}`)] : []),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "get_egovframe_guide",
    "컴포넌트의 공식 가이드 문서(표준프레임워크 포털 egovframe-docs)를 가져옵니다. " +
      "문서가 여러 건이면 목록을 함께 반환하며 docIndex로 선택할 수 있습니다.",
    {
      component: z.string().describe("컴포넌트 id. 예: bbs, login, cop.cmy"),
      docIndex: z.number().int().min(0).default(0).describe("문서가 여러 건일 때 선택 (0부터, 기본 0)"),
    },
    async (args) => {
      const r = await getGuide(args.component as string, args.docIndex as number);
      if (!r.selected)
        return { content: [{ type: "text", text: `'${r.componentId}'에 매핑된 가이드 문서가 없습니다. list_egovframe_components로 다른 컴포넌트를 확인하세요.` }] };
      const head = [
        `📘 ${r.selected.title} — ${r.componentId}`,
        `문서: https://github.com/${DOCS_REPO}/blob/main/${r.selected.path}`,
        r.docs.length > 1 ? `관련 문서 ${r.docs.length}건: ` + r.docs.map((d, i) => `[${i}] ${d.title}`).join(", ") : "",
        r.truncated ? `(본문이 길어 ${GUIDE_MAX_CHARS}자로 잘렸습니다 — 전문은 링크 참조)` : "",
        "", "---", "",
      ].filter((l, i) => l !== "" || i >= 4).join("\n");
      return { content: [{ type: "text", text: head + r.content }] };
    },
  );


  server.tool(
    "add_ai_components",
    "공식 egovframe-ai-rag 샘플 기반 AI RAG 챗봇(문서 업로드→임베딩→하이브리드 검색→LLM 응답)을 기존 Boot 프로젝트에 조립합니다. " +
      "소스·설정(application-ai.yml 프로필)·UI·인프라를 복사하고 pom에 누락 의존성만 마커 구간으로 삽입합니다(백업 생성, 제거 시 원복). " +
      "기존 파일과 충돌하면 아무것도 쓰지 않고 거부합니다. dryRun=true로 먼저 미리볼 수 있습니다.",
    {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장). egovframe-boot-starter-parent 기반 Boot 프로젝트"),
      stack: z.enum(AI_STACKS).describe("AI 스택: spring-ai(Redis Stack) | langchain4j(PGVector). 상호 배타"),
      includeInfra: z.boolean().default(true).describe("docker-compose.ai.yml·Dockerfile.ai·k8s/ai 복사"),
      includeUi: z.boolean().default(true).describe("채팅 UI(chat.html·static) 복사"),
      includeTests: z.boolean().default(false).describe("샘플 테스트 복사"),
      ref: z.string().optional().describe("egovframe-ai-rag 브랜치/태그 (기본: 카탈로그 기준 브랜치)"),
      dryRun: z.boolean().default(false).describe("true면 복사·병합 없이 계획만 미리보기(네트워크 불필요)"),
    },
    async (args) => {
      const r = await addAiComponents(args as AddAiComponentsOptions);
      const c = r.compatibility;
      const head = r.dryRun
        ? `🔍 AI 컴포넌트 조립 미리보기(dryRun): ${r.projectDir}`
        : `✅ AI 컴포넌트 조립 완료: ${r.projectDir}`;
      const text = [
        head,
        `- 컴포넌트: ${r.component.id} — ${r.component.name}`,
        `- 호환성: 부모 POM ${c.parentOk === true ? "일치" : c.parentOk === false ? "불일치" : "미확인"}` +
          ` (요구 ${c.required}${c.parentFound ? ", 발견 " + c.parentFound : ""})`,
        ...(c.warnings.length ? c.warnings.map((w) => `  ! ${w}`) : []),
        `- pom 의존성: ${r.dryRun ? "추가 예정" : "추가됨"} ${r.dependencyChanges.toAdd.length}건` +
          (r.dependencyChanges.alreadyPresent.length ? `, 이미 존재 ${r.dependencyChanges.alreadyPresent.length}건` : "") +
          (r.pomBackup ? ` (백업: ${r.pomBackup})` : ""),
        ...r.dependencyChanges.toAdd.slice(0, 8).map((d) => `  + ${d}`),
        ...(r.dependencyChanges.toAdd.length > 8 ? [`  + … 외 ${r.dependencyChanges.toAdd.length - 8}건`] : []),
        `- ${r.dryRun ? "복사 계획" : "복사 완료"} (총 ${r.totalFiles}개 파일):`,
        ...r.copyPlan.map((g) => `  · ${g.group}: ${g.files}개`),
        `- 실행 전제: ${r.prerequisites.join(", ")}`,
        ``,
        `다음 단계:`,
        ...r.nextSteps.map((s, i) => `  ${i + 1}. ${s}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  return server;
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("egovframe-scaffold-mcp: stdio에서 대기 중");
}
