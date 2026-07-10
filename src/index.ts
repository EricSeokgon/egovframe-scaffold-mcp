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
    if (hasPom) customized.push(`pom.xml (groupId=${opts.groupId}, artifactId/name=${opts.projectName}) — 적용 예정`);
    if (hasProps) customized.push(`src/main/resources/application.properties (Globals.DbType=${opts.database}) — 적용 예정`);
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
/* MCP 서버                                                             */
/* ------------------------------------------------------------------ */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "egovframe-scaffold-mcp", version: "0.2.0" });

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

  return server;
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("egovframe-scaffold-mcp: stdio에서 대기 중");
}
