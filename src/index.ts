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
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { CRUD_JAVA_TYPES, CRUD_PROFILES, generateCrud } from "./crud.js";
import {
  downloadVerifiedCatalogArchive,
  syncCatalog,
  type ArchiveInspection,
  type CatalogSourceMetadata,
  type CatalogSyncOptions,
  type CatalogSyncResult,
} from "./catalog-sync.js";

export { CRUD_JAVA_TYPES, CRUD_PROFILES, generateCrud } from "./crud.js";
export type { CrudFieldInput, GenerateCrudOptions, GenerateCrudResult } from "./crud.js";
export { inspectCatalogArchive, syncCatalog } from "./catalog-sync.js";
export type { ArchiveInspection, CatalogSyncOptions, CatalogSyncResult } from "./catalog-sync.js";

/** 템플릿 다운로드 제한 시간(ms) — 무응답 시 무한 대기를 방지한다. */
export const DOWNLOAD_TIMEOUT_MS = 30_000;

/** 지원 템플릿 목록 (공식 eGovFramework 조직 저장소) */
export const TEMPLATES: Record<
  string,
  { repo: string; branch: string; description: string; multiProject?: boolean }
> = {
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
  "simple-homepage": {
    repo: "eGovFramework/egovframe-simple-homepage-template",
    branch: "main",
    description: "심플홈페이지 템플릿 (Spring MVC + JSP 올인원, DATABASE/ 초기화 스크립트 포함)",
  },
  "portal-site": {
    repo: "eGovFramework/egovframe-portal-site-template",
    branch: "main",
    description: "포털사이트 템플릿 (Spring MVC + JSP, 포털 구성 기능, DATABASE/ 스크립트 포함)",
  },
  "enterprise-business": {
    repo: "eGovFramework/egovframe-enterprise-business-template",
    branch: "main",
    description: "엔터프라이즈 비즈니스 템플릿 (Spring MVC + JSP, Docker/컨테이너 지원 포함)",
  },
  "web-sample": {
    repo: "eGovFramework/egovframe-web-sample",
    branch: "main",
    description: "웹 기반 심플 게시판 샘플 (XML 설정, Docker/k8s 예시 포함)",
  },
  "msa-edu": {
    repo: "eGovFramework/egovframe-msa-edu",
    branch: "main",
    description: "MSA 템플릿 (클라우드 네이티브 — backend/frontend/k8s/docker-compose 멀티 프로젝트, 좌표·DB 자동 적용 없음)",
    multiProject: true,
  },
};

/** 레거시 템플릿의 DB 설정 파일 경로 */
export const GLOBALS_PROPS_REL = "src/main/resources/egovframework/egovProps/globals.properties";

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

export function customizePomCoordinates(pom: string, groupId: string, projectName: string): string {
  const parents: string[] = [];
  let masked = pom.replace(/<parent\b[^>]*>[\s\S]*?<\/parent>/g, (block) => {
    const token = `@@EGOV_PARENT_${parents.length}@@`;
    parents.push(block);
    return token;
  });

  const artifactLine = /^([ \t]*)<artifactId>[^<]+<\/artifactId>/m.exec(masked);
  if (!artifactLine || artifactLine.index === undefined)
    throw new Error("pom.xml에서 프로젝트 artifactId를 찾지 못했습니다");
  const indent = artifactLine[1];
  const beforeArtifact = masked.slice(0, artifactLine.index);
  const groupMatches = [...beforeArtifact.matchAll(/^([ \t]*)<groupId>[^<]+<\/groupId>/gm)];
  const directGroup = groupMatches.at(-1);
  if (directGroup?.index !== undefined) {
    const start = directGroup.index;
    masked = masked.slice(0, start) + `${directGroup[1]}<groupId>${groupId}</groupId>` + masked.slice(start + directGroup[0].length);
  } else {
    masked = masked.slice(0, artifactLine.index) + `${indent}<groupId>${groupId}</groupId>\n` + masked.slice(artifactLine.index);
  }

  masked = masked.replace(/^([ \t]*)<artifactId>[^<]+<\/artifactId>/m, `$1<artifactId>${projectName}</artifactId>`);
  if (/^([ \t]*)<name>[^<]*<\/name>/m.test(masked)) {
    masked = masked.replace(/^([ \t]*)<name>[^<]*<\/name>/m, `$1<name>${projectName}</name>`);
  } else {
    masked = masked.replace(
      /^([ \t]*)<artifactId>[^<]+<\/artifactId>/m,
      `$&\n${indent}<name>${projectName}</name>`,
    );
  }

  return parents.reduce((result, block, index) => result.replace(`@@EGOV_PARENT_${index}@@`, block), masked);
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
    const hasGlobals = entries.some((e) => rel(e.entryName) === GLOBALS_PROPS_REL);
    if (tpl.multiProject) {
      customized.push("멀티 프로젝트 템플릿 — 좌표/DB 설정 자동 적용 없음 (하위 프로젝트별 README 참조)");
    } else {
      if (hasPom) customized.push(`pom.xml (groupId=${opts.groupId}, artifactId/name=${opts.projectName}) — 적용 예정`);
      if (hasProps) customized.push(`src/main/resources/application.properties (Globals.DbType=${opts.database}) — 적용 예정`);
      if (hasGlobals) customized.push(`${GLOBALS_PROPS_REL} (Globals.DbType=${opts.database}) — 적용 예정`);
      if (hasPkg) customized.push(`package.json (name=${opts.projectName}) — 적용 예정`);
    }
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

  // 4) pom.xml: 프로젝트 좌표 적용 (parent 좌표는 유지) — 멀티 프로젝트 템플릿은 건너뜀
  const pomPath = path.join(projectPath, "pom.xml");
  if (!tpl.multiProject && fs.existsSync(pomPath)) {
    let pom = fs.readFileSync(pomPath, "utf-8");
    pom = customizePomCoordinates(pom, opts.groupId, opts.projectName);
    fs.writeFileSync(pomPath, pom);
    customized.push(`pom.xml (groupId=${opts.groupId}, artifactId/name=${opts.projectName})`);
  }

  // 5) application.properties: DB 타입 적용
  const appProps = path.join(projectPath, "src/main/resources/application.properties");
  if (!tpl.multiProject && fs.existsSync(appProps)) {
    let props = fs.readFileSync(appProps, "utf-8");
    if (/^Globals\.DbType=.*$/m.test(props)) {
      props = props.replace(/^Globals\.DbType=.*$/m, `Globals.DbType=${opts.database}`);
      fs.writeFileSync(appProps, props);
      customized.push(`src/main/resources/application.properties (Globals.DbType=${opts.database})`);
    }
  }

  // 5b) 레거시 템플릿(egovProps/globals.properties): DB 타입 적용
  const globalsProps = path.join(projectPath, GLOBALS_PROPS_REL);
  if (!tpl.multiProject && fs.existsSync(globalsProps)) {
    let props = fs.readFileSync(globalsProps, "utf-8");
    if (/^Globals\.DbType\s*=.*$/m.test(props)) {
      props = props.replace(/^Globals\.DbType\s*=.*$/m, `Globals.DbType = ${opts.database}`);
      fs.writeFileSync(globalsProps, props);
      customized.push(`${GLOBALS_PROPS_REL} (Globals.DbType=${opts.database})`);
    }
  }

  // 6) package.json: 프론트엔드 템플릿의 프로젝트명 적용
  const pkgPath = path.join(projectPath, "package.json");
  if (!tpl.multiProject && fs.existsSync(pkgPath)) {
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

  if (tpl.multiProject)
    customized.push("멀티 프로젝트 템플릿 — 좌표/DB 설정 자동 적용 없음 (하위 프로젝트별 README 참조)");

  const buildStep = tpl.multiProject
    ? "README.md 참조 — backend/frontend/k8s/docker-compose 하위 프로젝트별 기동 안내"
    : opts.template === "simple-react"
      ? "npm install && npm start"
      : opts.template === "simple-backend"
        ? "mvn -B verify   # 빌드/테스트 (JDK 17, hsql 외 DB는 접속정보를 application-*.properties에 설정)"
        : "mvn -B package   # WAR 빌드 (DB 초기화는 DATABASE/ 또는 README의 스크립트 참조)";
  const nextSteps = [
    `cd ${projectPath}`,
    buildStep,
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
  /** 그룹 항목: 설치 시 이 리프 컴포넌트들로 확장된다 (자체 파일 없음) */
  children?: string[];
  /** 컴포넌트 메시지 번들(.properties) */
  messageBundles?: string[];
  /** ID 생성기 Spring context */
  idgnContexts?: string[];
  /** 스케줄러 Spring context */
  schedulingContexts?: string[];
  /** CSS·JS·이미지·HTML 등 웹 정적 자산 */
  webAssets?: string[];
  /** 공통 Spring·Spring MVC 설정 조각 */
  webFragments?: string[];
  /** 소스 import 분석으로 탐지한 Maven 좌표 */
  mavenDependencies?: string[];
}

export interface Catalog {
  schemaVersion: number;
  source: CatalogSourceMetadata & { repo: string; branch: string; surveyedAt: string };
  sqlNote: string;
  components: CatalogComponent[];
}

const CATALOG_URL = new URL("../catalog/components.json", import.meta.url);

/** 카탈로그 로드 + 무결성 검증(id 중복, 의존 대상 존재) */
export function loadCatalog(): Catalog {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_URL, "utf-8")) as Catalog;
  if (![1, 2].includes(catalog.schemaVersion)) throw new Error(`지원하지 않는 카탈로그 schemaVersion: ${catalog.schemaVersion}`);
  if (catalog.schemaVersion >= 2) {
    if (!catalog.source.repository || !catalog.source.tag || !/^[0-9a-f]{40}$/.test(catalog.source.commit ?? ""))
      throw new Error("카탈로그 오류: schemaVersion 2는 source.repository/tag/commit이 필요합니다");
    const archive = catalog.source.archive;
    if (!archive || !/^[0-9a-f]{64}$/.test(archive.sha256) || archive.bytes <= 0 || archive.files <= 0)
      throw new Error("카탈로그 오류: source.archive 무결성 메타데이터가 올바르지 않습니다");
  }
  const ids = new Set<string>();
  for (const c of catalog.components) {
    if (ids.has(c.id)) throw new Error(`카탈로그 오류: 중복 id '${c.id}'`);
    ids.add(c.id);
  }
  for (const c of catalog.components) {
    for (const d of c.dependsOn)
      if (!ids.has(d)) throw new Error(`카탈로그 오류: '${c.id}'가 의존하는 '${d}'가 카탈로그에 없습니다`);
    for (const ch of c.children ?? [])
      if (!ids.has(ch)) throw new Error(`카탈로그 오류: '${c.id}'의 children '${ch}'가 카탈로그에 없습니다`);
    for (const field of COMPONENT_ASSET_FIELDS)
      for (const asset of c[field] ?? []) {
        const normalized = asset.replace(/\\/g, "/");
        if (normalized.startsWith("/") || normalized.split("/").includes(".."))
          throw new Error(`카탈로그 오류: '${c.id}.${field}'에 안전하지 않은 경로가 있습니다: ${asset}`);
      }
  }
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
  // 그룹(children 보유·자체 파일 없음) → 리프로 확장
  const expanded: string[] = [];
  const expand = (id: string, depth: number) => {
    if (depth > 3) throw new Error(`카탈로그 오류: 그룹 중첩이 너무 깊습니다: '${id}'`);
    const c = byId.get(id)!;
    if (c.children?.length && c.pathPrefixes.length === 0) for (const ch of c.children) expand(ch, depth + 1);
    else expanded.push(id);
  };
  for (const id of ids) expand(id, 0);
  ids = [...new Set(expanded)];
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

async function downloadComponentsZip(source: CatalogSourceMetadata & { repo: string; branch: string }): Promise<{ zip: AdmZip; inspection: ArchiveInspection }> {
  const repository = source.repository ?? source.repo;
  const ref = source.commit ?? source.tag ?? source.branch;
  const key = `${repository}@${ref}`;
  if (eccZipCache && eccZipCache.key === key) return eccZipCache;
  const verified = await downloadVerifiedCatalogArchive(source);
  eccZipCache = { key, ...verified };
  return eccZipCache;
}

const COMPONENT_ASSET_FIELDS = [
  "messageBundles", "idgnContexts", "schedulingContexts", "webAssets", "webFragments",
] as const;
type ComponentAssetField = (typeof COMPONENT_ASSET_FIELDS)[number];

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

  // 전체 사전 충돌 검사 — 하나라도 충돌하면 아무것도 쓰지 않음
  const conflicts: string[] = [];
  const reusedFiles = new Set<string>();
  for (const item of [...plan, ...sqlPlan]) {
    const dest = path.resolve(projectDir, item.relPath);
    if (!dest.startsWith(projectDir + path.sep)) throw new Error(`프로젝트 밖 자산 경로를 거부합니다: ${item.relPath}`);
    if (fs.existsSync(dest)) {
      const incoming = "entry" in item ? item.entry.getData() : item.content;
      const current = fs.readFileSync(dest);
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

  // 복사 실행 — 쓰기 실패 시 이번 호출에서 생성한 파일을 롤백한다.
  const countBy = new Map<string, number>();
  const hashesBy = new Map<string, Record<string, { hash: string; srcHash: string }>>();
  const sqlScripts: string[] = [];
  const sqlBy = new Map<string, string[]>();
  const createdFiles: string[] = [];
  try {
    for (const { entry, relPath, componentId } of plan) {
      if (reusedFiles.has(relPath)) continue;
      const dest = path.resolve(projectDir, relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const data = entry.getData();
      fs.writeFileSync(dest, data, { flag: "wx" });
      createdFiles.push(dest);
      countBy.set(componentId, (countBy.get(componentId) ?? 0) + 1);
      const h = "sha256:" + createHash("sha256").update(data).digest("hex");
      if (!hashesBy.has(componentId)) hashesBy.set(componentId, {});
      hashesBy.get(componentId)![relPath] = { hash: h, srcHash: h };
    }
    for (const { relPath, content, componentId } of sqlPlan) {
      if (reusedFiles.has(relPath)) continue;
      const dest = path.resolve(projectDir, relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, { flag: "wx" });
      createdFiles.push(dest);
      sqlScripts.push(relPath);
      if (!sqlBy.has(componentId)) sqlBy.set(componentId, []);
      sqlBy.get(componentId)!.push(relPath);
      const h = "sha256:" + createHash("sha256").update(content).digest("hex");
      if (!hashesBy.has(componentId)) hashesBy.set(componentId, {});
      hashesBy.get(componentId)![relPath] = { hash: h, srcHash: h };
    }
  } catch (error) {
    for (const file of createdFiles.reverse()) {
      try { fs.rmSync(file, { force: true }); } catch { /* 원래 오류를 보존한다 */ }
    }
    throw error;
  }

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

  // 설치 매니페스트 기록 (제거·검증 지원)
  const manifest: Manifest = readManifest(projectDir) ?? {
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
  const manifestPath = path.join(projectDir, MANIFEST_FILE);
  const previousManifest = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : null;
  try {
    writeManifest(projectDir, manifest);
  } catch (error) {
    for (const file of [...createdFiles].reverse()) {
      try { fs.rmSync(file, { force: true }); } catch { /* 원래 오류를 보존한다 */ }
    }
    try {
      if (previousManifest) fs.writeFileSync(manifestPath, previousManifest);
      else fs.rmSync(manifestPath, { force: true });
    } catch { /* 원래 오류를 보존한다 */ }
    throw error;
  }

  const assets = componentAssetCounts(order);
  assets.reusedFiles = reusedFiles.size;

  return {
    projectDir,
    requested: opts.components,
    installOrder: order.map((c) => ({ id: c.id, name: c.name, files: countBy.get(c.id) ?? 0 })),
    totalFiles: createdFiles.length,
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
  /** 파일별 기준선 해시(설치·갱신 시점) — upgrade의 3-way 판정용 (스키마 v2) */
  hashes?: Record<string, { hash: string; srcHash: string }>;
  sqlScripts: string[];
  /** AI 컴포넌트가 pom에 삽입한 내역 (제거 시 마커 구간 정리용) */
  pom?: { backup: string; addedDeps: string[]; addedProps: string[] };
}

export interface Manifest {
  schemaVersion: number;
  source: CatalogSourceMetadata & { repo: string; branch: string };
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
function resolveTrackedFile(projectDir: string, realProjectDir: string, relPath: string): string {
  if (path.isAbsolute(relPath))
    throw new Error(`매니페스트의 절대경로를 거부합니다: ${relPath}`);
  const target = path.resolve(projectDir, relPath);
  const relative = path.relative(projectDir, target);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw new Error(`매니페스트의 프로젝트 밖 경로를 거부합니다: ${relPath}`);
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
    schemaVersion: 3,
    source: { repo: catalog.source.repo, branch: catalog.source.branch },
    components: {},
  };
  const hashes = Object.fromEntries(plan.map((f) => {
    const h = sha256(f.entry.getData());
    return [f.destRel, { hash: h, srcHash: h }];
  }));
  manifest.components[comp.id] = {
    installedAt: new Date().toISOString(),
    files: plan.map((f) => f.destRel),
    hashes,
    sqlScripts: [],
    pom: pomChanged
      ? { backup: AI_POM_BACKUP, addedDeps: p.toAddDeps.map((d) => d.artifactId), addedProps: Object.keys(p.toAddProps) }
      : undefined,
  };
  manifest.schemaVersion = 3;
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
// ── 레시피 (v0.13.0) ─────────────────────────────────────
export interface Recipe {
  id: string;
  name: string;
  description: string;
  template: keyof typeof TEMPLATES;
  components: string[];
  database?: (typeof ECC_DB_TYPES)[number];
  ai?: { stack: (typeof AI_STACKS)[number] };
}

const RECIPES_URL = new URL("../catalog/recipes.json", import.meta.url);
let _recipes: Recipe[] | null = null;

/** catalog/recipes.json 로드 (오프라인, 1회 캐시). */
export function loadRecipes(): Recipe[] {
  if (_recipes) return _recipes;
  const raw = JSON.parse(fs.readFileSync(RECIPES_URL, "utf-8")) as { recipes: Recipe[] };
  _recipes = raw.recipes;
  return _recipes;
}

// ── 프로젝트 진단 (v0.14.0) ─────────────────────────────
export interface DiagnoseResult {
  projectDir: string;
  isEgovProject: boolean;
  buildSystem: "maven" | "gradle" | "unknown";
  egovVersion: string | null;
  database: string | null;
  detectedComponents: { id: string; name: string; matchedPrefix: string }[];
  aiLayer: boolean;
  hasManifest: boolean;
  issues: string[];
  suggestions: string[];
}

/** 기존 프로젝트를 읽기 전용으로 스캔해 구성·설치 컴포넌트·설정 문제를 진단한다. (디스크 변경 없음) */
export function diagnoseProject(opts: { projectDir: string }): DiagnoseResult {
  const dir = opts.projectDir;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
    throw new Error(`프로젝트 디렉터리가 없습니다: ${dir}`);

  const readIf = (p: string): string | null => {
    try { return fs.readFileSync(path.join(dir, p), "utf-8"); } catch { return null; }
  };
  const existsRel = (p: string): boolean => fs.existsSync(path.join(dir, p));

  const pom = readIf("pom.xml");
  const gradle = readIf("build.gradle") ?? readIf("build.gradle.kts");
  const buildSystem: DiagnoseResult["buildSystem"] = pom ? "maven" : gradle ? "gradle" : "unknown";
  const buildText = pom ?? gradle ?? "";
  const isEgovProject = /egovframe/i.test(buildText);

  // eGovFrame RTE 버전 추정 (best-effort)
  let egovVersion: string | null = null;
  const vpats: RegExp[] = [
    /<(?:org\.egovframe\.rte\.version|egovframe[.\w]*version|version\.egovframe[.\w]*)>\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i,
    /org\.egovframe\.rte[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i,
    /egovframe[^\n]*?rte[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i,
  ];
  for (const re of vpats) { const m = buildText.match(re); if (m) { egovVersion = m[1]; break; } }

  // Globals.DbType 탐지
  let database: string | null = null;
  const dbFiles = [
    "src/main/resources/application.properties",
    "src/main/resources/globals.properties",
    "src/main/resources/egovframework/egovProps/globals.properties",
    "src/main/resources/application.yml",
    "src/main/resources/application.yaml",
  ];
  for (const f of dbFiles) {
    const t = readIf(f);
    if (t) { const m = t.match(/Globals\.DbType\s*[:=]\s*["']?([A-Za-z]+)/); if (m) { database = m[1]; break; } }
  }

  // 카탈로그 pathPrefixes 지문으로 설치 컴포넌트 감지
  const catalog = loadCatalog();
  const detectedComponents: DiagnoseResult["detectedComponents"] = [];
  const detectedIds = new Set<string>();
  for (const c of catalog.components) {
    const prefix = c.pathPrefixes.find((p) => p.includes("/java/")) ?? c.pathPrefixes[0];
    if (!prefix || !existsRel(prefix)) continue;
    try {
      if (fs.readdirSync(path.join(dir, prefix)).length > 0) {
        detectedComponents.push({ id: c.id, name: c.name, matchedPrefix: prefix });
        detectedIds.add(c.id);
      }
    } catch { /* skip unreadable */ }
  }

  const aiLayer = existsRel("src/main/resources/application-ai.yml") || existsRel("src/main/resources/egovframework/ai");
  const hasManifest = existsRel(".egovframe-components.json");

  const issues: string[] = [];
  const suggestions: string[] = [];
  if (buildSystem === "unknown") issues.push("빌드 파일(pom.xml·build.gradle)을 찾지 못했습니다 — eGovFrame 프로젝트가 아닐 수 있습니다.");
  else if (!isEgovProject) issues.push("빌드 파일에서 egovframe 좌표를 찾지 못했습니다.");
  if (isEgovProject && !egovVersion) issues.push("eGovFrame(RTE) 버전을 자동 검출하지 못했습니다 — pom/gradle 수동 확인 권장.");
  if (detectedComponents.length > 0 && !database) issues.push("공통컴포넌트가 감지됐으나 Globals.DbType이 설정되어 있지 않습니다.");
  for (const c of catalog.components) {
    if (!detectedIds.has(c.id)) continue;
    for (const dep of c.dependsOn) {
      if (!detectedIds.has(dep)) issues.push(`컴포넌트 '${c.id}'가 의존하는 '${dep}'가 감지되지 않았습니다.`);
    }
  }
  const uniqIssues = [...new Set(issues)];

  if (!hasManifest && detectedComponents.length > 0)
    suggestions.push("스캐폴딩 매니페스트(.egovframe-components.json)가 없어 remove/validate 수명주기 도구는 쓸 수 없습니다. 신규 조립은 add_egovframe_components를 사용하세요.");
  if (detectedComponents.length === 0 && buildSystem !== "unknown")
    suggestions.push("감지된 공통컴포넌트가 없습니다. list_egovframe_components로 목록 확인 후 add_egovframe_components로 조립할 수 있습니다.");
  if (uniqIssues.length === 0) suggestions.push("특이사항 없음 — 구성 정상.");

  return {
    projectDir: dir, isEgovProject, buildSystem, egovVersion, database,
    detectedComponents, aiLayer, hasManifest, issues: uniqIssues, suggestions,
  };
}

// ── 가이드 문서 검색 (v0.15.0) ──────────────────────────
export interface DocHit {
  title: string;
  path: string;
  url: string;
  componentId: string;
  componentName: string;
  category: string;
  score: number;
}

/** 카탈로그 가이드 매핑(제목·경로·연계 컴포넌트)을 키워드로 검색한다. 오프라인. */
export function searchDocs(opts: { query: string; limit?: number }): DocHit[] {
  const terms = opts.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const catalog = loadCatalog();
  const best = new Map<string, DocHit>(); // path 기준 중복 제거(최고 점수 유지)
  for (const c of catalog.components) {
    for (const d of c.docs ?? []) {
      const title = d.title.toLowerCase();
      const name = c.name.toLowerCase();
      const hay = [d.title, d.path, c.name, c.description, c.category, c.id].join(" ").toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 3;
        if (name.includes(t)) score += 2;
        if (hay.includes(t)) score += 1;
      }
      if (score <= 0) continue;
      const hit: DocHit = {
        title: d.title, path: d.path,
        url: `https://github.com/${DOCS_REPO}/blob/main/${d.path}`,
        componentId: c.id, componentName: c.name, category: c.category, score,
      };
      const prev = best.get(d.path);
      if (!prev || score > prev.score) best.set(d.path, hit);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 10);
}

// ── 프로젝트 리포트 (v0.16.0) ───────────────────────────
/** 프로젝트를 스캔해 설치 컴포넌트·테이블·가이드·이슈를 Markdown 리포트로 생성한다. (읽기 전용) */
export function generateReport(opts: { projectDir: string }): string {
  const d = diagnoseProject({ projectDir: opts.projectDir });
  const catalog = loadCatalog();
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  const L: string[] = [];
  L.push(`# eGovFrame 프로젝트 리포트`);
  L.push(``);
  L.push(`- 경로: ${d.projectDir}`);
  L.push(`- 빌드: ${d.buildSystem}${d.isEgovProject ? " (egovframe)" : ""} · RTE ${d.egovVersion ?? "미검출"} · DbType ${d.database ?? "미설정"}`);
  L.push(`- AI 계층: ${d.aiLayer ? "있음" : "없음"} · 매니페스트: ${d.hasManifest ? "있음" : "없음"}`);
  L.push(``);
  L.push(`## 설치 공통컴포넌트 (${d.detectedComponents.length})`);
  L.push(``);
  if (d.detectedComponents.length) {
    L.push(`| id | 이름 | 카테고리 | 테이블 | 가이드 |`);
    L.push(`|---|---|---|---|---|`);
    for (const dc of d.detectedComponents) {
      const c = byId.get(dc.id);
      const tables = c?.tables?.length ?? 0;
      const guide = c?.docs?.length ? `${c.docs.length}건` : "-";
      L.push(`| ${dc.id} | ${dc.name} | ${c?.category ?? "-"} | ${tables} | ${guide} |`);
    }
  } else {
    L.push(`(감지된 컴포넌트 없음)`);
  }
  const tableSet = new Set<string>();
  for (const dc of d.detectedComponents) for (const t of byId.get(dc.id)?.tables ?? []) tableSet.add(t);
  if (tableSet.size) {
    L.push(``, `## 참조 테이블 (${tableSet.size})`, ``, [...tableSet].sort().join(", "));
  }
  const docLines: string[] = [];
  for (const dc of d.detectedComponents) {
    const c = byId.get(dc.id);
    for (const doc of c?.docs ?? [])
      docLines.push(`- [${doc.title}](https://github.com/${DOCS_REPO}/blob/main/${doc.path}) — ${dc.id}`);
  }
  if (docLines.length) L.push(``, `## 가이드 문서`, ``, ...docLines);
  if (d.issues.length) L.push(``, `## 이슈`, ``, ...d.issues.map((i) => `- ${i}`));
  if (d.suggestions.length) L.push(``, `## 제안`, ``, ...d.suggestions.map((s) => `- ${s}`));
  return L.join("\n");
}

// ── 업그레이드 (v0.17.0) ────────────────────────────────
function sha256(buf: Buffer | string): string {
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}

export type UpgradeClass = "unchanged" | "update" | "conflict" | "user-modified" | "added" | "removed";

/** 순수 판정: 기준선(설치시 hash/srcHash)·현재 디스크·upstream 신규 해시로 분류. (오프라인 테스트 대상) */
export function classifyUpgrade(x: {
  baselineHash?: string; baselineSrcHash?: string; currentHash?: string; upstreamHash?: string;
}): UpgradeClass {
  const { baselineHash, baselineSrcHash, currentHash, upstreamHash } = x;
  if (upstreamHash === undefined) return "removed";
  if (currentHash === undefined) return "added";
  if (baselineHash === undefined) return currentHash === upstreamHash ? "unchanged" : "conflict";
  const userModified = currentHash !== baselineHash;
  const upstreamChanged = upstreamHash !== baselineSrcHash;
  if (!userModified && !upstreamChanged) return "unchanged";
  if (!userModified && upstreamChanged) return "update";
  if (userModified && !upstreamChanged) return "user-modified";
  return "conflict";
}

export interface UpgradeItem { componentId: string; relPath: string; cls: UpgradeClass; }
export interface UpgradeResult {
  projectDir: string; dryRun: boolean; force: boolean;
  summary: Record<UpgradeClass, number>;
  items: UpgradeItem[];
  backupDir?: string;
  applied?: { updated: number; added: number; forced: number };
}

export async function upgradeProject(opts: {
  projectDir: string; components?: string[]; dryRun?: boolean; force?: boolean;
}): Promise<UpgradeResult> {
  const projectDir = path.resolve(opts.projectDir);
  const dryRun = opts.dryRun !== false;
  const force = opts.force === true;
  const manifest = readManifest(projectDir);
  if (!manifest)
    throw new Error(`매니페스트(.egovframe-components.json)가 없습니다: ${projectDir} — 이 도구로 설치된 프로젝트만 업그레이드할 수 있습니다.`);

  const targetIds = opts.components && opts.components.length ? opts.components : Object.keys(manifest.components);
  const unknown = targetIds.filter((id) => !manifest.components[id]);
  if (unknown.length)
    throw new Error(`매니페스트에 없는 컴포넌트: ${unknown.join(", ")} — 설치됨: ${Object.keys(manifest.components).join(", ") || "(없음)"}`);

  const catalog = loadCatalog();
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  const { zip } = await downloadComponentsZip(manifest.source);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  const rel = (name: string) => (name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name);

  const items: UpgradeItem[] = [];
  const dataFor = new Map<string, Buffer>();
  for (const id of targetIds) {
    const c = byId.get(id);
    const entry = manifest.components[id];
    const upstream = new Map<string, Buffer>();
    if (c)
      for (const e of entries) {
        const r = rel(e.entryName);
        if (r && c.pathPrefixes.some((p) => r.startsWith(p))) upstream.set(r, e.getData());
      }
    const relPaths = new Set<string>([...upstream.keys(), ...entry.files]);
    for (const r of relPaths) {
      const upData = upstream.get(r);
      const upstreamHash = upData ? sha256(upData) : undefined;
      const abs = path.join(projectDir, r);
      const currentHash = fs.existsSync(abs) ? sha256(fs.readFileSync(abs)) : undefined;
      const base = entry.hashes?.[r];
      const cls = classifyUpgrade({ baselineHash: base?.hash, baselineSrcHash: base?.srcHash, currentHash, upstreamHash });
      items.push({ componentId: id, relPath: r, cls });
      if (upData && (cls === "update" || cls === "added" || cls === "conflict")) dataFor.set(r, upData);
    }
  }

  const summary: Record<UpgradeClass, number> = { unchanged: 0, update: 0, conflict: 0, "user-modified": 0, added: 0, removed: 0 };
  for (const it of items) summary[it.cls]++;

  if (dryRun) return { projectDir, dryRun: true, force, summary, items };

  const hardConflicts = items.filter((i) => i.cls === "conflict");
  if (hardConflicts.length && !force)
    throw new Error(`충돌 ${hardConflicts.length}건(사용자 수정 + upstream 변경)으로 중단합니다. dryRun으로 확인 후 force=true로 강제하거나 해당 파일을 정리하세요. 아무것도 쓰지 않았습니다.`);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(projectDir, "upgrade-backup", ts);
  let updated = 0, added = 0, forced = 0;
  const writeFile = (relPath: string, data: Buffer, backup: boolean) => {
    const abs = path.join(projectDir, relPath);
    if (!abs.startsWith(projectDir + path.sep)) return;
    if (backup && fs.existsSync(abs)) {
      const b = path.join(backupDir, relPath);
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.copyFileSync(abs, b);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  };
  for (const it of items) {
    const upData = dataFor.get(it.relPath);
    if (it.cls === "update" && upData) { writeFile(it.relPath, upData, true); updated++; }
    else if (it.cls === "added" && upData) { writeFile(it.relPath, upData, false); added++; }
    else if (it.cls === "conflict" && force && upData) { writeFile(it.relPath, upData, true); forced++; }
  }

  for (const id of targetIds) {
    const entry = manifest.components[id];
    entry.hashes = entry.hashes ?? {};
    for (const it of items) {
      if (it.componentId !== id) continue;
      const upData = dataFor.get(it.relPath);
      if (upData && (it.cls === "update" || it.cls === "added" || (it.cls === "conflict" && force))) {
        const h = sha256(upData);
        entry.hashes[it.relPath] = { hash: h, srcHash: h };
        if (!entry.files.includes(it.relPath)) entry.files.push(it.relPath);
      }
    }
  }
  manifest.schemaVersion = 2;
  writeManifest(projectDir, manifest);

  return { projectDir, dryRun: false, force, summary, items, backupDir: updated + forced > 0 ? backupDir : undefined, applied: { updated, added, forced } };
}

// ── 컴포넌트 상세 설명 (v0.18.0) ────────────────────────
export interface ComponentExplain {
  id: string; name: string; category: string; description: string;
  dependsOn: string[]; transitiveDeps: string[]; dependents: string[];
  tables: string[]; docs: { title: string; url: string }[]; approxFiles: number; installHint: string;
}

/** 컴포넌트 하나의 상세(설명·의존성·역의존·테이블·가이드·설치 힌트)를 계산한다. (읽기 전용) */
export function explainComponent(id: string): ComponentExplain {
  const catalog = loadCatalog();
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  const c = byId.get(id);
  if (!c) throw new Error(`알 수 없는 컴포넌트 id: ${id} — list_egovframe_components로 확인하세요.`);

  const seen = new Set<string>();
  const stack = [...c.dependsOn];
  while (stack.length) {
    const d = stack.pop()!;
    if (seen.has(d)) continue;
    seen.add(d);
    const dc = byId.get(d);
    if (dc) stack.push(...dc.dependsOn);
  }
  const transitiveDeps = [...seen];
  const dependents = catalog.components.filter((x) => x.dependsOn.includes(id)).map((x) => x.id);
  const docs = (c.docs ?? []).map((d) => ({ title: d.title, url: `https://github.com/${DOCS_REPO}/blob/main/${d.path}` }));
  return {
    id: c.id, name: c.name, category: c.category, description: c.description,
    dependsOn: c.dependsOn, transitiveDeps, dependents, tables: c.tables ?? [], docs, approxFiles: c.approxFiles,
    installHint: `add_egovframe_components(projectDir="...", components=["${c.id}"]) — 의존성 ${transitiveDeps.length ? transitiveDeps.join(", ") : "없음"} 포함`,
  };
}

// ── CI 설정 생성 + 문서 스니펫 (v0.19.0) ────────────────
function detectBuildTool(projectDir: string): "maven" | "gradle" {
  if (fs.existsSync(path.join(projectDir, "pom.xml"))) return "maven";
  if (fs.existsSync(path.join(projectDir, "build.gradle")) || fs.existsSync(path.join(projectDir, "build.gradle.kts"))) return "gradle";
  throw new Error(`빌드 파일(pom.xml·build.gradle)을 찾지 못했습니다: ${projectDir}`);
}

export function generateCiYaml(buildTool: "maven" | "gradle", jdk: string): string {
  const buildStep = buildTool === "maven"
    ? "      - run: mvn -B verify"
    : "      - run: chmod +x ./gradlew\n      - run: ./gradlew build --no-daemon";
  return [
    "name: CI",
    "on:",
    "  push:",
    "  pull_request:",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-java@v4",
    "        with:",
    "          distribution: temurin",
    `          java-version: '${jdk}'`,
    `          cache: ${buildTool}`,
    buildStep,
    "",
  ].join("\n");
}

export interface CiResult { projectDir: string; buildTool: "maven" | "gradle"; path: string; dryRun: boolean; content: string; }

export function generateCiConfig(opts: { projectDir: string; jdk?: string; dryRun?: boolean }): CiResult {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const buildTool = detectBuildTool(projectDir);
  const content = generateCiYaml(buildTool, opts.jdk ?? "17");
  const rel = ".github/workflows/egovframe-ci.yml";
  const dryRun = opts.dryRun === true;
  if (!dryRun) {
    const dest = path.join(projectDir, rel);
    if (fs.existsSync(dest)) throw new Error(`이미 존재합니다: ${rel} — 덮어쓰지 않습니다(수동 확인).`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  return { projectDir, buildTool, path: rel, dryRun, content };
}

/** deep 검색용: 본문에서 질의어 주변 스니펫 추출 */
function extractDocSnippet(body: string, terms: string[]): string {
  const text = body.replace(/\s+/g, " ").trim();
  const low = text.toLowerCase();
  let idx = -1;
  for (const t of terms) { const i = low.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
  if (idx < 0) return text.slice(0, 160);
  const start = Math.max(0, idx - 60);
  return (start > 0 ? "…" : "") + text.slice(start, start + 200) + (start + 200 < text.length ? "…" : "");
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "egovframe-scaffold-mcp", version: "0.21.0" });

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
    "sync_egovframe_catalog",
    "공식 egovframe-common-components 태그·commit·아카이브 무결성을 검증하고, 고정 카탈로그 대비 upstream 변경과 sec.security 보안 패키지를 점검합니다.",
    {
      ref: z.string().optional().describe("확인할 태그·브랜치·commit. 미지정 시 카탈로그의 공식 고정 태그 사용"),
    },
    async (args) => {
      const result = await syncCatalog(args as CatalogSyncOptions);
      const text = [
        result.upToDate ? "✅ 공통컴포넌트 카탈로그가 고정 upstream과 일치합니다." : "⚠️ 공통컴포넌트 upstream 변경이 감지됐습니다.",
        `- 저장소: ${result.repository}`,
        `- 요청 ref: ${result.requestedRef}`,
        `- resolved commit: ${result.resolvedCommit}`,
        `- pinned commit: ${result.pinnedCommit ?? "없음"}`,
        `- 아카이브: ${result.archive.files}개 파일, ${result.archive.bytes} bytes, sha256:${result.archive.sha256}`,
        `- sec.security: ${result.archive.securityPaths.length}개 파일`,
        `- 미매핑 경로: ${result.archive.unmappedComponentPaths.length}건`,
        ...result.warnings.map((warning) => `- 경고: ${warning}`),
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
                  assets: {
                    messageBundles: c.messageBundles?.length ?? 0,
                    idgnContexts: c.idgnContexts?.length ?? 0,
                    schedulingContexts: c.schedulingContexts?.length ?? 0,
                    webAssets: c.webAssets?.length ?? 0,
                    webFragments: c.webFragments?.length ?? 0,
                  },
                  mavenDependencies: c.mavenDependencies ?? [],
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
        `- 추가 자산: 메시지 ${r.assets.messageBundles}, ID 생성기 ${r.assets.idgnContexts}, 스케줄러 ${r.assets.schedulingContexts}, 웹 자산 ${r.assets.webAssets}, 설정 조각 ${r.assets.webFragments}`,
        ...(r.assets.reusedFiles ? [`- 동일 파일 재사용: ${r.assets.reusedFiles}개`] : []),
        ...(r.mavenDependencies.length ? [`- 감지된 Maven 좌표: ${r.mavenDependencies.length}건`, ...r.mavenDependencies.map((dependency) => `  · ${dependency}`)] : []),
        ...(r.sourceVerification ? [`- upstream 검증: ${r.sourceVerification.files}개 파일, sha256:${r.sourceVerification.sha256}`] : []),
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
      "다른 설치 컴포넌트가 의존하거나 설치 시점 hash와 달라진 파일은 기본 거부합니다. " +
      "force=true는 remove-backup/에 사본을 만든 뒤 트랜잭션 제거하며, dryRun 미리보기를 지원합니다.",
    {
      projectDir: z.string().describe("대상 프로젝트 디렉터리"),
      components: z.array(z.string()).min(1).describe("제거할 컴포넌트 id 목록"),
      dryRun: z.boolean().default(false).describe("true면 삭제 없이 대상만 미리보기"),
      force: z.boolean().default(false).describe("사용자 수정·hash 미검증 파일도 remove-backup/에 백업한 뒤 제거"),
    },
    async (args) => {
      const r = await removeComponents(args as RemoveOptions);
      const head = r.dryRun ? `🔍 제거 미리보기(dryRun): ${r.projectDir}` : `🗑️ 컴포넌트 제거 완료: ${r.projectDir}`;
      const text = [head,
        ...r.removed.map((c) => `  - ${c.id}: 파일 ${c.files}개${c.sqlScripts ? `, DB 스크립트 ${c.sqlScripts}개` : ""}`),
        `- 현재 파일: 정상 ${r.summary.unchanged} · 수정 ${r.summary.modified} · hash 미검증 ${r.summary.unverified} · 누락 ${r.summary.missing}`,
        `- 총 ${r.dryRun ? "삭제 가능" : "삭제"} 파일: ${r.totalFiles}개`,
        ...(r.backupDir ? [`- 강제 제거 백업: ${r.backupDir}`] : []),
        ...(r.dryRun && r.blocked
          ? ["", "⚠️ 수정·hash 미검증 파일이 있어 기본 제거는 중단됩니다. 직접 보존하거나 force=true로 백업 후 제거하세요."]
          : r.dryRun ? ["", "실제 제거하려면 dryRun 없이 다시 호출하세요."] : []),
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

  // ── 레시피 도구 (v0.13.0) ──────────────────────────────
  server.tool(
    "list_egovframe_recipes",
    "큐레이션된 레시피(템플릿+컴포넌트 번들) 목록을 반환합니다. apply_egovframe_recipe로 한 번에 조립할 수 있습니다.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify({ recipes: loadRecipes() }, null, 2) }],
    }),
  );

  server.tool(
    "apply_egovframe_recipe",
    "레시피 하나를 골라 프로젝트 생성 → 공통컴포넌트(필요 시 AI 계층) 조립까지 순차 실행합니다. dryRun=true로 전체 계획을 먼저 미리볼 수 있습니다.",
    {
      recipeId: z.string().describe("list_egovframe_recipes의 id. 예: board-login"),
      projectName: z.string().describe("프로젝트명(artifactId). 소문자·숫자·하이픈"),
      groupId: z.string().default("egovframework.example").describe("자바 groupId"),
      outputDir: z.string().describe("생성할 상위 디렉터리(절대경로 권장)"),
      database: z.enum(ECC_DB_TYPES).optional().describe("DB 스크립트 대상(미지정 시 레시피 기본값)"),
      dryRun: z.boolean().default(false).describe("true면 디스크 변경 없이 전체 계획만 미리보기"),
    },
    async (args) => {
      const recipe = loadRecipes().find((r) => r.id === args.recipeId);
      if (!recipe) {
        return { content: [{ type: "text", text: `❌ 알 수 없는 recipeId: ${args.recipeId}` }] };
      }
      const steps: string[] = [];
      const eccDb = args.database ?? recipe.database;
      const createDb = (DB_TYPES as readonly string[]).includes(eccDb ?? "")
        ? (eccDb as (typeof DB_TYPES)[number])
        : "hsql";

      const proj = await createProject({
        projectName: args.projectName,
        groupId: args.groupId,
        database: createDb,
        template: recipe.template,
        outputDir: args.outputDir,
        dryRun: args.dryRun,
      });
      steps.push(`① 생성: ${proj.projectPath} (${proj.dryRun ? "예정" : "추출"} ${proj.filesExtracted}파일, ref ${proj.ref})`);

      if (recipe.components.length) {
        const add = await addComponents({
          projectDir: proj.projectPath,
          components: recipe.components,
          includeDependencies: true,
          database: eccDb,
          dryRun: args.dryRun,
        });
        steps.push(
          `② 컴포넌트(${add.requested.join(", ")}) — ${add.dryRun ? "예정 " : ""}${add.totalFiles}파일` +
            (add.sqlScripts.length ? `, SQL ${add.sqlScripts.length}건` : ""),
        );
      }

      if (recipe.ai) {
        const ai = await addAiComponents({
          projectDir: proj.projectPath,
          stack: recipe.ai.stack,
          dryRun: args.dryRun,
        });
        steps.push(
          `③ AI(${recipe.ai.stack}) — ${args.dryRun ? "예정 " : ""}${ai.copiedFiles}파일` +
            (ai.pomChanged ? ", pom 병합" : ""),
        );
      }

      const head = args.dryRun
        ? `🔍 레시피 미리보기(dryRun): ${recipe.name}`
        : `✅ 레시피 적용 완료: ${recipe.name}`;
      const text = [
        head,
        `- recipe: ${recipe.id}`,
        ...steps,
        ``,
        `다음 단계: validate_egovframe_project(projectDir="${proj.projectPath}")로 무결성 확인`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  // ── 리소스 (v0.13.0) ───────────────────────────────────
  server.resource(
    "components-catalog",
    "egovframe://catalog/components",
    { mimeType: "application/json", description: "공통컴포넌트 카탈로그(요약)" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            loadCatalog().components.map((c) => ({
              id: c.id, name: c.name, category: c.category, dependsOn: c.dependsOn,
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.resource(
    "templates-catalog",
    "egovframe://catalog/templates",
    { mimeType: "application/json", description: "프로젝트 템플릿·지원 DB" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ templates: TEMPLATES, databases: DB_TYPES }, null, 2) }],
    }),
  );

  server.resource(
    "recipes-catalog",
    "egovframe://catalog/recipes",
    { mimeType: "application/json", description: "레시피 목록" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ recipes: loadRecipes() }, null, 2) }],
    }),
  );

  server.resource(
    "component-detail",
    new ResourceTemplate("egovframe://catalog/components/{id}", { list: undefined }),
    { mimeType: "application/json", description: "단일 공통컴포넌트 상세" },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : (variables.id as string);
      const c = loadCatalog().components.find((x) => x.id === id);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(c ?? { error: `unknown id: ${id}` }, null, 2) }],
      };
    },
  );

  // ── 프롬프트 (v0.13.0) ─────────────────────────────────
  server.prompt(
    "scaffold_board_login",
    "게시판+로그인 최소 구성을 만드는 절차를 안내합니다.",
    { projectName: z.string(), database: z.string().optional() },
    ({ projectName, database }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `표준프레임워크로 '${projectName}' 프로젝트를 만들고 게시판+로그인을 붙여줘. ` +
              `apply_egovframe_recipe(recipeId="board-login", projectName="${projectName}"` +
              `${database ? `, database="${database}"` : ""}) 실행 후 validate_egovframe_project로 확인.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "scaffold_ai_chatbot",
    "백엔드에 RAG 챗봇(AI 계층)을 붙이는 절차를 안내합니다.",
    { projectName: z.string(), stack: z.enum(AI_STACKS).default("spring-ai") },
    ({ projectName, stack }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `'${projectName}' 백엔드를 만들고 ${stack} 기반 AI 챗봇을 붙여줘. ` +
              `apply_egovframe_recipe(recipeId="ai-chatbot-backend", projectName="${projectName}") 실행 후 ` +
              `validate_egovframe_project의 aiChecks로 실행 전제를 확인.`,
          },
        },
      ],
    }),
  );
  // ── 진단 도구 (v0.14.0) ────────────────────────────────
  server.tool(
    "diagnose_egovframe_project",
    "기존(스캐폴딩 도구로 만들지 않은 것 포함) 전자정부 표준프레임워크 프로젝트를 스캔해 빌드시스템·RTE 버전·DbType·설치된 공통컴포넌트(카탈로그 pathPrefixes 지문)·설정 문제를 진단합니다. 디스크를 변경하지 않는 읽기 전용입니다.",
    {
      projectDir: z.string().describe("진단할 프로젝트 디렉터리(절대경로 권장)"),
    },
    async (args) => {
      const r = diagnoseProject({ projectDir: args.projectDir });
      const lines = [
        `📋 진단: ${r.projectDir}`,
        `- 빌드: ${r.buildSystem}${r.isEgovProject ? " · egovframe 좌표 감지" : ""}`,
        `- RTE 버전: ${r.egovVersion ?? "미검출"}`,
        `- DbType: ${r.database ?? "미설정"}`,
        `- 감지 컴포넌트(${r.detectedComponents.length}): ${r.detectedComponents.map((c) => c.id).join(", ") || "없음"}`,
        `- AI 계층: ${r.aiLayer ? "있음" : "없음"} / 매니페스트: ${r.hasManifest ? "있음" : "없음"}`,
      ];
      if (r.issues.length) lines.push(``, `⚠️ 이슈:`, ...r.issues.map((i) => ` · ${i}`));
      if (r.suggestions.length) lines.push(``, `💡 제안:`, ...r.suggestions.map((s) => ` · ${s}`));
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
  // ── 문서 검색 도구 (v0.15.0) ───────────────────────────
  server.tool(
    "search_egovframe_docs",
    "공식 가이드 문서(egovframe-docs) 인덱스를 키워드로 검색합니다. 기본은 오프라인 인덱스 검색(제목·경로·연계 컴포넌트·카테고리 점수순)이며, fetchTop>0이면 상위 결과의 문서 본문을 내려받아 스니펫도 함께 제공합니다.",
    {
      query: z.string().describe("검색어. 예: \"로그인\", \"게시판 권한\""),
      limit: z.number().int().min(1).max(30).default(10).describe("최대 결과 수 (기본 10)"),
      fetchTop: z.number().int().min(0).max(5).default(0).describe("본문을 내려받아 스니펫을 붙일 상위 결과 수 (0=오프라인, 최대 5)"),
    },
    async (args) => {
      const hits = searchDocs({ query: args.query, limit: args.limit });
      if (hits.length === 0)
        return { content: [{ type: "text", text: `🔎 "${args.query}" — 검색 결과 없음` }] };
      const terms = args.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const snippets = new Map<string, string>();
      const n = Math.min(args.fetchTop ?? 0, hits.length);
      for (let i = 0; i < n; i++) {
        const h = hits[i];
        try {
          const res = await fetchWithTimeout(`https://raw.githubusercontent.com/${DOCS_REPO}/main/${h.path}`, DOWNLOAD_TIMEOUT_MS);
          if (res.ok) snippets.set(h.path, extractDocSnippet(await res.text(), terms));
        } catch { /* 네트워크 실패 시 스니펫 생략 */ }
      }
      const lines = [
        `🔎 "${args.query}" — ${hits.length}건${n ? ` (상위 ${n}건 본문 스니펫)` : ""}`,
        ...hits.map((h, i) => {
          const base = `${i + 1}. ${h.title} [${h.category}] · 컴포넌트 ${h.componentId}\n   ${h.url}`;
          const s = snippets.get(h.path);
          return s ? `${base}\n   ▷ ${s}` : base;
        }),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
  // ── 리포트 도구 (v0.16.0) ──────────────────────────────
  server.tool(
    "generate_egovframe_report",
    "프로젝트를 스캔해 설치 공통컴포넌트·참조 테이블·가이드 문서 링크·이슈를 Markdown 리포트로 생성합니다. (읽기 전용) 조립 결과 문서화나 README 첨부에 적합합니다.",
    {
      projectDir: z.string().describe("리포트를 만들 프로젝트 디렉터리(절대경로 권장)"),
    },
    async (args) => ({
      content: [{ type: "text", text: generateReport({ projectDir: args.projectDir }) }],
    }),
  );
  // ── 업그레이드 도구 (v0.17.0) ──────────────────────────
  server.tool(
    "upgrade_egovframe_project",
    "매니페스트에 기록된 설치 공통컴포넌트를 upstream 최신본과 비교해 갱신합니다. 사용자가 수정한 파일은 force 없이는 보존하며, dryRun(기본)으로 변경 계획을 먼저 확인합니다. 덮어쓰기 전 upgrade-backup/에 백업하고, 하드 충돌 시 아무것도 쓰지 않고 거부합니다.",
    {
      projectDir: z.string().describe("업그레이드할 프로젝트 디렉터리(절대경로 권장)"),
      components: z.array(z.string()).optional().describe("대상 컴포넌트 id (미지정 시 매니페스트 전체)"),
      dryRun: z.boolean().default(true).describe("true(기본)면 계획만 미리보기, 디스크 변경 없음"),
      force: z.boolean().default(false).describe("사용자 수정 파일(충돌)도 백업 후 덮어쓸지"),
    },
    async (args) => {
      const r = await upgradeProject(args);
      const s = r.summary;
      const head = r.dryRun ? `🔍 업그레이드 미리보기(dryRun): ${r.projectDir}` : `✅ 업그레이드 적용: ${r.projectDir}`;
      const lines = [
        head,
        `- 불변 ${s.unchanged} · 갱신 ${s.update} · 추가 ${s.added} · 사용자수정(보존) ${s["user-modified"]} · 충돌 ${s.conflict} · upstream삭제 ${s.removed}`,
      ];
      if (r.dryRun) {
        const changing = r.items.filter((i) => i.cls === "update" || i.cls === "added" || i.cls === "conflict").slice(0, 20);
        if (changing.length) lines.push(``, `변경 예정:`, ...changing.map((i) => ` · [${i.cls}] ${i.relPath}`));
        lines.push(``, s.conflict ? `⚠️ 충돌 ${s.conflict}건 — force=true라야 덮어씁니다.` : `적용하려면 dryRun=false로 다시 호출하세요.`);
      } else {
        lines.push(`- 적용: 갱신 ${r.applied?.updated} · 추가 ${r.applied?.added} · 강제 ${r.applied?.forced}`);
        if (r.backupDir) lines.push(`- 백업: ${r.backupDir}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
  // ── 컴포넌트 설명 도구 (v0.18.0) ───────────────────────
  server.tool(
    "explain_egovframe_component",
    "공통컴포넌트 하나의 상세(설명·직접/전이 의존성·이 컴포넌트에 의존하는 컴포넌트·참조 테이블·가이드 문서 링크·설치 명령)를 한 번에 반환합니다. (읽기 전용)",
    {
      id: z.string().describe("컴포넌트 id. 예: bbs"),
    },
    async (args) => {
      const e = explainComponent(args.id);
      const L = [
        `# ${e.name} (${e.id}) · ${e.category}`,
        ``,
        e.description,
        ``,
        `- 직접 의존: ${e.dependsOn.join(", ") || "없음"}`,
        `- 전이 의존: ${e.transitiveDeps.join(", ") || "없음"}`,
        `- 이 컴포넌트에 의존: ${e.dependents.join(", ") || "없음"}`,
        `- 참조 테이블(${e.tables.length}): ${e.tables.join(", ") || "-"}`,
        `- 예상 파일: ${e.approxFiles}`,
        ``,
        `설치: ${e.installHint}`,
      ];
      if (e.docs.length) L.push(``, `가이드:`, ...e.docs.map((d) => `- [${d.title}](${d.url})`));
      return { content: [{ type: "text", text: L.join("\n") }] };
    },
  );

  // ── 리소스·프롬프트 확장 (v0.18.0) ─────────────────────
  server.resource(
    "ai-catalog",
    "egovframe://catalog/ai-components",
    { mimeType: "application/json", description: "AI 컴포넌트 카탈로그(스택 정의)" },
    async (uri) => {
      let text = "{}";
      try { text = JSON.stringify(loadAiCatalog(), null, 2); } catch { /* AI 카탈로그 없으면 빈 객체 */ }
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    },
  );

  server.prompt(
    "scaffold_portal",
    "포털사이트 최소 구성(공통·게시판·로그인)을 만드는 절차를 안내합니다.",
    { projectName: z.string(), database: z.string().optional() },
    ({ projectName, database }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `포털 백엔드 '${projectName}'를 만들어줘. ` +
              `apply_egovframe_recipe(recipeId="standard-portal", projectName="${projectName}"` +
              `${database ? `, database="${database}"` : ""}) 실행 후 validate_egovframe_project로 확인.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "maintain_existing",
    "기존 프로젝트를 진단→리포트→업그레이드로 점검하는 유지보수 절차를 안내합니다.",
    { projectDir: z.string() },
    ({ projectDir }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `기존 표준프레임워크 프로젝트 '${projectDir}'를 점검해줘. ` +
              `1) diagnose_egovframe_project 2) generate_egovframe_report ` +
              `3) upgrade_egovframe_project(dryRun=true)로 갱신 계획을 확인.`,
          },
        },
      ],
    }),
  );
  server.tool(
    "generate_egovframe_crud",
    "eGovFrame Development의 공식 CRUD wizard 입력 체계에 맞춰 VO·Mapper(XML)·Service·Controller·JSP(선택)·JUnit 5 테스트(선택) 골격을 생성합니다. Classic XML과 Boot REST 프로필을 지원하며, 전체 파일 충돌을 먼저 검사해 하나라도 존재하면 아무것도 쓰지 않습니다.",
    {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장, pom.xml 또는 build.gradle 필요)"),
      tableName: z.string().describe("CRUD 대상 테이블명. 단일 SQL 식별자, 예: SAMPLE_BOARD"),
      entityName: z.string().optional().describe("생성 클래스명. 미지정 시 tableName에서 PascalCase로 생성"),
      basePackage: z.string().describe("기본 자바 패키지. 예: egovframework.example.board"),
      fields: z.array(z.object({
        columnName: z.string().describe("DB 컬럼명. 예: BOARD_ID"),
        propertyName: z.string().optional().describe("자바 프로퍼티명. 미지정 시 columnName에서 camelCase로 생성"),
        javaType: z.enum(CRUD_JAVA_TYPES).default("String").describe("자바 타입"),
        jdbcType: z.string().optional().describe("MyBatis JDBC 타입. 미지정 시 javaType에서 추론"),
        primaryKey: z.boolean().default(false).describe("기본키 여부. 안전한 update/delete를 위해 최소 1개 필수"),
        generated: z.boolean().default(false).describe("DB 생성키 여부. 단일 기본키에서만 지원"),
        nullable: z.boolean().default(true).describe("NULL 허용 여부(메타데이터·후속 검증용)"),
        label: z.string().optional().describe("Javadoc/JSP 표시명"),
      })).min(1).max(100).describe("테이블 컬럼 정의"),
      profile: z.enum(CRUD_PROFILES).default("classic").describe("classic=Spring MVC+JSP, boot=REST Controller"),
      author: z.string().default("egovframe-scaffold-mcp").describe("공식 wizard의 author"),
      createDate: z.string().optional().describe("공식 wizard의 createDate. 미지정 시 오늘 날짜"),
      mapperFolder: z.string().optional().describe("프로젝트 기준 Mapper XML 폴더"),
      mapperPackage: z.string().optional().describe("Mapper 인터페이스 패키지"),
      voPackage: z.string().optional().describe("VO 패키지"),
      servicePackage: z.string().optional().describe("Service 패키지"),
      implPackage: z.string().optional().describe("ServiceImpl 패키지"),
      controllerPackage: z.string().optional().describe("Controller 패키지"),
      jspFolder: z.string().optional().describe("프로젝트 기준 JSP 폴더"),
      checkDataAccess: z.boolean().default(true).describe("공식 wizard DataAccess 그룹 생성 여부"),
      checkService: z.boolean().default(true).describe("공식 wizard Service 그룹 생성 여부"),
      checkWeb: z.boolean().default(true).describe("공식 wizard Web 그룹 생성 여부"),
      includeJsp: z.boolean().optional().describe("classic 프로필의 JSP 2종 생성 여부(기본 true)"),
      withTest: z.boolean().default(false).describe("JUnit 5 서비스 계약 테스트 골격 생성"),
      dryRun: z.boolean().default(false).describe("true면 파일을 쓰지 않고 생성 계획만 반환"),
    },
    async (args) => {
      const r = generateCrud(args);
      const head = r.dryRun
        ? `🔍 CRUD 생성 미리보기(dryRun): ${r.entityName} ← ${r.tableName}`
        : `✅ CRUD 생성 완료: ${r.entityName} ← ${r.tableName}`;
      const componentCounts = new Map<string, number>();
      for (const file of r.files) componentCounts.set(file.component, (componentCounts.get(file.component) ?? 0) + 1);
      const lines = [
        head,
        `- 프로젝트: ${r.projectDir}`,
        `- 프로필: ${r.profile}`,
        `- 파일: ${r.files.length}개 (${[...componentCounts].map(([name, count]) => `${name} ${count}`).join(" · ")})`,
        ...r.files.map((file) => `  · ${file.path} (${file.bytes} bytes)`),
      ];
      if (r.warnings.length) lines.push(``, `확인 사항:`, ...r.warnings.map((warning) => `  ! ${warning}`));
      if (r.dryRun) lines.push(``, `실제 생성하려면 dryRun=false로 다시 호출하세요.`);
      else lines.push(``, `다음 단계: 생성 프로젝트에서 컴파일·테스트를 실행해 의존성과 설정을 확인하세요.`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
  // ── CI 설정 생성 도구 (v0.19.0) ────────────────────────
  server.tool(
    "generate_egovframe_ci",
    "프로젝트에 GitHub Actions CI 워크플로(빌드·테스트)를 생성합니다. 빌드도구(maven/gradle) 자동 감지, JDK 지정. dryRun으로 내용만 미리볼 수 있고, 실제 생성 시 기존 파일이 있으면 덮어쓰지 않고 거부합니다.",
    {
      projectDir: z.string().describe("프로젝트 디렉터리(절대경로 권장)"),
      jdk: z.string().default("17").describe("JDK 버전 (기본 17)"),
      dryRun: z.boolean().default(false).describe("true면 파일 생성 없이 내용만 반환"),
    },
    async (args) => {
      const r = generateCiConfig(args);
      const head = r.dryRun
        ? `🔍 CI 설정 미리보기(dryRun): ${r.path} (${r.buildTool})`
        : `✅ CI 설정 생성: ${r.path} (${r.buildTool})`;
      return { content: [{ type: "text", text: `${head}\n\n\`\`\`yaml\n${r.content}\`\`\`` }] };
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
