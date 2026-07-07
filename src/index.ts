#!/usr/bin/env node
/**
 * egovframe-scaffold-mcp — 전자정부 표준프레임워크 프로젝트 스캐폴딩 MCP 서버 (PoC)
 *
 * eGovFramework/egovframe-common-components#1120 제안의 개념 증명 구현입니다.
 * 공식 템플릿 저장소를 내려받아 프로젝트명·groupId·DB 타입을 적용한
 * 새 프로젝트 골격을 생성하는 단일 도구(create_egovframe_project)를 제공합니다.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";

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

export interface CreateOptions {
  projectName: string;
  groupId: string;
  database: (typeof DB_TYPES)[number];
  template: keyof typeof TEMPLATES;
  outputDir: string;
}

export interface CreateResult {
  projectPath: string;
  filesExtracted: number;
  customized: string[];
  nextSteps: string[];
}

/** 템플릿 zip 다운로드 → 압축 해제 → 사용자 값 적용 */
export async function createProject(opts: CreateOptions): Promise<CreateResult> {
  const tpl = TEMPLATES[opts.template];
  if (!tpl) throw new Error(`알 수 없는 템플릿: ${opts.template}`);
  if (!NAME_RE.test(opts.projectName))
    throw new Error(`projectName은 소문자/숫자/하이픈 2~64자여야 합니다: ${opts.projectName}`);
  if (!GROUP_RE.test(opts.groupId))
    throw new Error(`groupId는 자바 패키지 형식이어야 합니다 (예: egovframework.example): ${opts.groupId}`);
  if (!DB_TYPES.includes(opts.database))
    throw new Error(`database는 ${DB_TYPES.join("|")} 중 하나여야 합니다: ${opts.database}`);

  const projectPath = path.resolve(opts.outputDir, opts.projectName);
  if (fs.existsSync(projectPath))
    throw new Error(`대상 디렉터리가 이미 존재합니다: ${projectPath}`);

  // 1) 공식 템플릿 다운로드
  const zipUrl = `https://codeload.github.com/${tpl.repo}/zip/refs/heads/${tpl.branch}`;
  const res = await fetch(zipUrl);
  if (!res.ok) throw new Error(`템플릿 다운로드 실패 (${res.status}): ${zipUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // 2) 최상위 폴더를 제거하며 압축 해제
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  let count = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const rel = e.entryName.startsWith(rootPrefix)
      ? e.entryName.slice(rootPrefix.length)
      : e.entryName;
    if (!rel) continue;
    const dest = path.join(projectPath, rel);
    // zip slip 방지
    if (!dest.startsWith(projectPath + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
    count++;
  }

  const customized: string[] = [];

  // 3) pom.xml: 프로젝트 좌표 적용 (parent 좌표는 유지)
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

  // 4) application.properties: DB 타입 적용
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

  return { projectPath, filesExtracted: count, customized, nextSteps };
}

/* ------------------------------------------------------------------ */
/* MCP 서버                                                             */
/* ------------------------------------------------------------------ */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "egovframe-scaffold-mcp", version: "0.1.0" });

  server.tool(
    "list_egovframe_templates",
    "사용 가능한 전자정부 표준프레임워크 프로젝트 템플릿 목록을 반환합니다.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(TEMPLATES, null, 2) }],
    }),
  );

  server.tool(
    "create_egovframe_project",
    "전자정부 표준프레임워크 공식 템플릿으로 새 프로젝트 골격을 생성합니다. " +
      "공식 GitHub 템플릿을 내려받아 projectName/groupId/DB 타입을 적용합니다.",
    {
      projectName: z.string().describe("프로젝트명(artifactId). 소문자·숫자·하이픈, 예: my-egov-app"),
      groupId: z.string().describe("자바 groupId. 예: egovframework.example"),
      database: z.enum(DB_TYPES).default("hsql").describe("DB 타입 (템플릿 지원: hsql|mysql|oracle|altibase|tibero)"),
      template: z.enum(Object.keys(TEMPLATES) as [string, ...string[]]).default("simple-backend").describe("템플릿 종류"),
      outputDir: z.string().describe("프로젝트를 생성할 상위 디렉터리(절대경로 권장)"),
    },
    async (args) => {
      const result = await createProject(args as CreateOptions);
      const text = [
        `✅ 프로젝트 생성 완료: ${result.projectPath}`,
        `- 추출 파일: ${result.filesExtracted}개`,
        `- 적용된 설정:`,
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
