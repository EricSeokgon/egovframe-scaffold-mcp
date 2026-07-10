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

  // DB 스크립트 수집
  const sqlPlan: { entry: AdmZip.IZipEntry; relPath: string }[] = [];
  if (opts.database) {
    for (const e of entries) {
      const r = rel(e.entryName);
      for (const kind of ["ddl", "dml"]) {
        const prefix = `script/${kind}/${opts.database}/`;
        if (r.startsWith(prefix))
          sqlPlan.push({ entry: e, relPath: `scripts/egovframe-components/${opts.database}/${kind}/` + r.slice(prefix.length) });
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
  for (const { entry, relPath } of sqlPlan) {
    const dest = path.join(projectDir, relPath);
    if (!dest.startsWith(projectDir + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
    sqlScripts.push(relPath);
  }

  const nextSteps = [
    opts.database
      ? `scripts/egovframe-components/${opts.database}/ 의 DDL·DML에서 설치한 컴포넌트 관련 테이블을 선별해 DB에 적용하세요 (통합 스크립트입니다).`
      : "database 파라미터를 지정하면 DB DDL·DML 스크립트도 함께 복사됩니다.",
    "복사된 소스는 egovframework.com.* 원본 패키지를 유지합니다 (eGovFrame IDE 마법사와 동일).",
    "빈 스캐너/설정에 egovframework.com 패키지 스캔이 포함되어 있는지 확인 후 mvn compile로 빌드를 검증하세요.",
    "일부 컴포넌트는 web.xml·필터·스케줄러 등 수동 설정이 필요할 수 있습니다 (공통컴포넌트 가이드 참조).",
  ];

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
/* MCP 서버                                                             */
/* ------------------------------------------------------------------ */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "egovframe-scaffold-mcp", version: "0.4.0" });

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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                source: catalog.source,
                sqlNote: catalog.sqlNote,
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

  return server;
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("egovframe-scaffold-mcp: stdio에서 대기 중");
}
