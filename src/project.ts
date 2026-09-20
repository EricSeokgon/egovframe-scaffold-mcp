// 프로젝트 생성 — 공식 템플릿 다운로드, 좌표·DB 타입 적용 (create_egovframe_project).
import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";
import { withDirectoryTransaction } from "./file-transaction.js";
import { DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "./shared.js";

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
  "msa-common-components": {
    repo: "eGovFramework/egovframe-msa-common-components",
    branch: "main",
    description: "MSA 공통컴포넌트 (KRDS — 게시판·로그인·권한·코드 등 서비스별 멀티 프로젝트, 좌표·DB 자동 적용 없음)",
    multiProject: true,
  },
  "mobile-device-api": {
    repo: "eGovFramework/egovframe-mobile-device-api",
    branch: "main",
    description: "모바일 디바이스 API (device-api-web + device-api-app 멀티 프로젝트, 좌표·DB 자동 적용 없음)",
    multiProject: true,
  },
  "ai-rag": {
    repo: "eGovFramework/egovframe-ai-rag",
    branch: "main",
    description: "AI RAG 예제 (Spring AI · LangChain4j 2종 멀티 프로젝트, 좌표·DB 자동 적용 없음)",
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
  /** fault-injection 회귀 테스트 전용. MCP 스키마에는 노출하지 않는다. */
  faultInjection?: "after-extract" | "after-customize";
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

/** 템플릿 zip 다운로드 → 지정 staging에 압축 해제 → 사용자 값 적용. */
export async function createProjectInternal(opts: CreateOptions, transactionStagingPath?: string): Promise<CreateResult> {
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

  const populate = async (stagingPath: string): Promise<number> => {
    // 3) 최상위 폴더를 제거하며 sibling staging에 압축 해제
    let extracted = 0;
    for (const e of entries) {
      if (e.isDirectory) continue;
      const r = rel(e.entryName);
      if (!r) continue;
      const dest = path.join(stagingPath, r);
      // zip slip 방지
      if (!dest.startsWith(stagingPath + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
      extracted++;
    }

    if (opts.faultInjection === "after-extract")
      throw new Error("createProject fault injection: after-extract");

    // 4) pom.xml: 프로젝트 좌표 적용 (parent 좌표는 유지) — 멀티 프로젝트 템플릿은 건너뜀
    const pomPath = path.join(stagingPath, "pom.xml");
    if (!tpl.multiProject && fs.existsSync(pomPath)) {
      let pom = fs.readFileSync(pomPath, "utf-8");
      pom = customizePomCoordinates(pom, opts.groupId, opts.projectName);
      fs.writeFileSync(pomPath, pom);
      customized.push(`pom.xml (groupId=${opts.groupId}, artifactId/name=${opts.projectName})`);
    }

    // 5) application.properties: DB 타입 적용
    const appProps = path.join(stagingPath, "src/main/resources/application.properties");
    if (!tpl.multiProject && fs.existsSync(appProps)) {
      let props = fs.readFileSync(appProps, "utf-8");
      if (/^Globals\.DbType=.*$/m.test(props)) {
        props = props.replace(/^Globals\.DbType=.*$/m, `Globals.DbType=${opts.database}`);
        fs.writeFileSync(appProps, props);
        customized.push(`src/main/resources/application.properties (Globals.DbType=${opts.database})`);
      }
    }

    // 5b) 레거시 템플릿(egovProps/globals.properties): DB 타입 적용
    const globalsProps = path.join(stagingPath, GLOBALS_PROPS_REL);
    if (!tpl.multiProject && fs.existsSync(globalsProps)) {
      let props = fs.readFileSync(globalsProps, "utf-8");
      if (/^Globals\.DbType\s*=.*$/m.test(props)) {
        props = props.replace(/^Globals\.DbType\s*=.*$/m, `Globals.DbType = ${opts.database}`);
        fs.writeFileSync(globalsProps, props);
        customized.push(`${GLOBALS_PROPS_REL} (Globals.DbType=${opts.database})`);
      }
    }

    // 6) package.json: 프론트엔드 템플릿의 프로젝트명 적용
    const pkgPath = path.join(stagingPath, "package.json");
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

    if (opts.faultInjection === "after-customize")
      throw new Error("createProject fault injection: after-customize");

    return extracted;
  };

  let count: number;
  if (transactionStagingPath !== undefined) {
    const stagingPath = path.resolve(transactionStagingPath);
    if (!fs.existsSync(stagingPath) || !fs.statSync(stagingPath).isDirectory())
      throw new Error(`내부 staging 디렉터리가 없습니다: ${stagingPath}`);
    if (fs.readdirSync(stagingPath).length > 0)
      throw new Error(`내부 staging 디렉터리가 비어 있지 않습니다: ${stagingPath}`);
    count = await populate(stagingPath);
  } else {
    count = await withDirectoryTransaction(
      path.resolve(opts.outputDir),
      opts.projectName,
      "프로젝트 생성",
      populate,
    );
  }

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

/** 템플릿 zip 다운로드 → 압축 해제 → 사용자 값 적용 (dryRun이면 미리보기만) */
export async function createProject(opts: CreateOptions): Promise<CreateResult> {
  return createProjectInternal(opts);
}
