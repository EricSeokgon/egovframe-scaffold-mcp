// 프로젝트 생성 — 공식 템플릿 다운로드, 좌표·DB 타입 적용 (create_egovframe_project).
import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";
import { withDirectoryTransaction } from "./file-transaction.js";
import { createHash } from "node:crypto";
import { COMPONENTS_DOWNLOAD_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "./shared.js";

/**
 * 저장소 아카이브가 아니라 "고정된 zip 파일"로 조달하는 템플릿의 출처.
 *
 * 공식 eGovFrame VSCode Initializr 는 단독 저장소가 없는 프로젝트(배치·모바일·빈 골격 등)를
 * `templates/projects/examples/*.zip`(Git LFS)로 배포한다. 브랜치는 움직이므로 commit 과
 * LFS 포인터의 sha256·크기를 함께 고정해, 내려받은 바이트가 조사 시점과 같은지 검증한다.
 */
export interface TemplateArchive {
  kind: "initializr-zip";
  /** 조사 시점의 Initializr 저장소 commit (다운로드 URL 을 이 commit 으로 고정) */
  commit: string;
  /** 저장소 내 zip 경로 */
  path: string;
  /** LFS 포인터의 oid — 내려받은 zip 의 SHA-256 */
  sha256: string;
  /** LFS 포인터의 size(bytes) */
  bytes: number;
}

export interface TemplateDefinition {
  repo: string;
  branch: string;
  description: string;
  multiProject?: boolean;
  /** 있으면 codeload 저장소 아카이브 대신 이 zip 을 내려받는다. */
  archive?: TemplateArchive;
}

export const INITIALIZR_REPO = "eGovFramework/egovframe-vscode-initializr";
/** zip 지문을 조사한 Initializr commit (2026-09-18). 갱신 절차: docs/design-initializr-zip-templates.md */
export const INITIALIZR_COMMIT = "f8f572596e0c19d7992b132298992d5ce56ea819";

/** Git LFS 객체를 commit 기준으로 내려받는 URL. */
export function archiveDownloadUrl(repo: string, ref: string, filePath: string): string {
  return `https://media.githubusercontent.com/media/${repo}/${ref}/${filePath}`;
}

/** 지원 템플릿 목록 (공식 eGovFramework 조직 저장소) */
export const TEMPLATES: Record<string, TemplateDefinition> = {
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
  // ── Initializr zip 조달 (v0.27.0) — 단독 저장소가 없는 공식 프로젝트 ──
  "web": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "웹 프로젝트 빈 골격 (Spring MVC + JSP, 공통 설정만 포함 — 게시판 샘플이 필요하면 web-sample)",
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-web.zip",
      sha256: "13674f6f76e74e6d70478b7e9ad0689b0f84b5ffc9828a49f8b511dc2b3d6b69",
      bytes: 15547491,
    },
  },
  "boot-web": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "Boot 웹 프로젝트 빈 골격 (Spring Boot 기반)",
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-boot-web.zip",
      sha256: "1284019f991f0676683dc1b19e9133318e50f18092505e0c1635ef1336bd1f6c",
      bytes: 15551650,
    },
  },
  "batch-file-scheduler": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "Boot 배치 템플릿 — 파일(SAM) 기반, 스케줄러 실행",
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-boot-batch-file-scheduler.zip",
      sha256: "407b09f3c678f8bd96c5da7aa38fe574622a1b507a676d3937c1a8cafafb95d1",
      bytes: 714016,
    },
  },
  "batch-file-commandline": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "Boot 배치 템플릿 — 파일(SAM) 기반, 커맨드라인 실행",
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-boot-batch-file-commandline.zip",
      sha256: "c51352a2b4ce41ed64f0a0f543c5319164dcc16ac32f853bac44f1ee166535cc",
      bytes: 713252,
    },
  },
  "batch-file-web": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "Boot 배치 템플릿 — 파일(SAM) 기반, 웹 실행",
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-boot-batch-file-web.zip",
      sha256: "15b75e445cfd9dd0162dbf23034937acb6cac4cd25af45cc162b55ef91a7a1c8",
      bytes: 1465409,
    },
  },
  "batch-db-scheduler": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "Boot 배치 템플릿 — DB 기반, 스케줄러 실행",
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-boot-batch-db-scheduler.zip",
      sha256: "b0cb160b252325eb6c29c93d978a5026913d377339e15c5551f615ca0cd2b7e7",
      bytes: 712628,
    },
  },
  "batch-db-commandline": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "Boot 배치 템플릿 — DB 기반, 커맨드라인 실행",
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-boot-batch-db-commandline.zip",
      sha256: "0de452a317f939f37867f66d293d8e6879fd868aa89c3ad1cc7a07c2b1c0ffd9",
      bytes: 1440218,
    },
  },
  "batch-db-web": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "Boot 배치 템플릿 — DB 기반, 웹 실행",
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-boot-batch-db-web.zip",
      sha256: "e229849102dee90fe7605107d9a4122425b67ddf2aa1bbc41b01af42bbc9e0c9",
      bytes: 1470738,
    },
  },
  "mobile-web": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "모바일 웹 프로젝트 빈 골격",
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-mobile-web.zip",
      sha256: "b1ebcf172a775fada2418509a61b51914709eeb803ca6d03ef1bba766c9bc57b",
      bytes: 359099,
    },
  },
  "mobile-common-components": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "모바일 공통컴포넌트 올인원 프로젝트",
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-mobile-common-components.zip",
      sha256: "0c0abe6922042e940221ea05f94868dac293ba4d2315d17fdc16d26ef23b42c0",
      bytes: 10696748,
    },
  },
  "msa-portal-backend": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "MSA 포털 백엔드 (apigateway·config·discovery·서비스별 Gradle 멀티 프로젝트, 좌표·DB 자동 적용 없음)",
    multiProject: true,
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-msa-portal-backend.zip",
      sha256: "dd8e7563c6eb981c4ad6641f68bf9473badccac10164f51c8357b217c64fdd1d",
      bytes: 1101491,
    },
  },
  "msa-portal-frontend": {
    repo: INITIALIZR_REPO,
    branch: "main",
    description: "MSA 포털 프론트엔드 (portal·admin 멀티 프로젝트, 좌표·DB 자동 적용 없음)",
    multiProject: true,
    archive: {
      kind: "initializr-zip",
      commit: INITIALIZR_COMMIT,
      path: "templates/projects/examples/egovframe-msa-portal-frontend.zip",
      sha256: "022b3615d7140f05361f09ce54024284b3be072a0f6f355ecd6738c71bb9e8e0",
      bytes: 6562922,
    },
  },
};

/** Initializr zip 의 pom.xml 이 쓰는 자리표시자. */
const POM_PLACEHOLDER_RE = /###(GROUP_ID|ARTIFACT_ID|NAME|VERSION|URL)###/g;

/** Initializr 방식 pom 자리표시자(###GROUP_ID### 등)를 실제 값으로 바꾼다. 자리표시자가 없으면 원문 그대로. */
export function applyPomPlaceholders(pom: string, groupId: string, projectName: string): { pom: string; replaced: number } {
  const values: Record<string, string> = {
    GROUP_ID: groupId,
    ARTIFACT_ID: projectName,
    NAME: projectName,
    VERSION: "1.0.0",
    URL: "https://www.egovframe.go.kr",
  };
  let replaced = 0;
  const out = pom.replace(POM_PLACEHOLDER_RE, (_m, key: string) => {
    replaced++;
    return values[key];
  });
  return { pom: out, replaced };
}

/** zip 항목 중 DbType 설정을 가진 globals.properties 후보(템플릿마다 경로가 다르다). */
export function isGlobalsPropertiesPath(relPath: string): boolean {
  return /^src\/main\/resources\/.+\/globals\.properties$/.test(relPath);
}

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
  /** zip 조달 템플릿: 고정 지문(sha256·크기) 검증 결과. ref 를 직접 지정하면 검증을 건너뛰어 false. */
  archiveVerified?: boolean;
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

  // 1) 공식 템플릿 다운로드
  //    - 저장소 템플릿: codeload 아카이브 (branch/tag/SHA 모두 허용)
  //    - zip 조달 템플릿: 고정 commit 의 LFS 객체 + sha256·크기 검증 (ref 를 직접 주면 검증 생략)
  const archive = tpl.archive;
  const effectiveRef = archive ? (opts.ref ? ref : archive.commit) : ref;
  const zipUrl = archive
    ? archiveDownloadUrl(tpl.repo, effectiveRef, archive.path)
    : `https://codeload.github.com/${tpl.repo}/zip/${ref}`;
  const res = await fetchWithTimeout(zipUrl, archive ? COMPONENTS_DOWNLOAD_TIMEOUT_MS : DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) throw new Error(`템플릿 다운로드 실패 (${res.status}) — ref='${effectiveRef}'가 존재하는지 확인하세요: ${zipUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const customized: string[] = [];
  let archiveVerified: boolean | undefined;
  if (archive) {
    if (opts.ref) {
      archiveVerified = false;
      customized.push(`⚠️ ref='${effectiveRef}' 지정 — 고정 지문(sha256) 검증을 건너뜁니다`);
    } else {
      // shared.sha256() 은 매니페스트용 "sha256:" 접두 표기라, LFS oid 와 비교할 순수 hex 를 따로 계산한다.
      const actual = createHash("sha256").update(buf).digest("hex");
      if (buf.length !== archive.bytes || actual !== archive.sha256)
        throw new Error(
          `템플릿 zip 지문이 고정값과 다릅니다 (${opts.template}) — 크기 ${buf.length}/${archive.bytes}, sha256 ${actual.slice(0, 12)}…/${archive.sha256.slice(0, 12)}…\n` +
            `upstream 이 바뀌었는지 sync_egovframe_templates 로 확인하세요: ${zipUrl}`,
        );
      archiveVerified = true;
    }
  }

  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error(`템플릿 zip 이 비어 있습니다: ${zipUrl}`);
  // codeload 아카이브는 `<repo>-<ref>/` 최상위 폴더가 있지만, Initializr zip 은 프로젝트 루트가 곧 zip 루트다.
  const rootPrefix = archive ? "" : entries[0].entryName.split("/")[0] + "/";
  const rel = (name: string) => (rootPrefix && name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name);

  // 2) 미리보기(dryRun): 쓰지 않고 수행 예정 내용만 계산
  if (dryRun) {
    const fileCount = entries.filter((e) => !e.isDirectory && rel(e.entryName)).length;
    const hasPom = entries.some((e) => rel(e.entryName) === "pom.xml");
    const hasProps = entries.some((e) => rel(e.entryName) === "src/main/resources/application.properties");
    const hasPkg = entries.some((e) => rel(e.entryName) === "package.json");
    const hasGlobals = entries.some((e) => rel(e.entryName) === GLOBALS_PROPS_REL);
    const extraGlobals = archive
      ? entries.map((e) => rel(e.entryName)).filter((r) => r !== GLOBALS_PROPS_REL && isGlobalsPropertiesPath(r))
      : [];
    if (archive && archiveVerified) customized.push(`zip 지문 검증 통과 (sha256 ${archive.sha256.slice(0, 12)}…, ${archive.bytes} bytes)`);
    if (tpl.multiProject) {
      customized.push("멀티 프로젝트 템플릿 — 좌표/DB 설정 자동 적용 없음 (하위 프로젝트별 README 참조)");
    } else {
      if (hasPom) customized.push(`pom.xml (groupId=${opts.groupId}, artifactId/name=${opts.projectName}) — 적용 예정`);
      if (hasProps) customized.push(`src/main/resources/application.properties (Globals.DbType=${opts.database}) — 적용 예정`);
      if (hasGlobals) customized.push(`${GLOBALS_PROPS_REL} (Globals.DbType=${opts.database}) — 적용 예정`);
      for (const g of extraGlobals) customized.push(`${g} (Globals.DbType=${opts.database}) — 파일에 설정이 있으면 적용 예정`);
      if (hasPkg) customized.push(`package.json (name=${opts.projectName}) — 적용 예정`);
    }
    return {
      projectPath,
      filesExtracted: fileCount,
      customized,
      ref: effectiveRef,
      dryRun: true,
      archiveVerified,
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
      // Initializr zip 은 좌표가 ###GROUP_ID### 같은 자리표시자다 — 먼저 채운 뒤 공통 좌표 적용을 거친다.
      const filled = applyPomPlaceholders(pom, opts.groupId, opts.projectName);
      pom = customizePomCoordinates(filled.pom, opts.groupId, opts.projectName);
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

    // 5c) zip 조달 템플릿: globals.properties 위치가 템플릿마다 다르다(batch/properties 등)
    if (archive && !tpl.multiProject) {
      for (const e of entries) {
        if (e.isDirectory) continue;
        const r = rel(e.entryName);
        if (r === GLOBALS_PROPS_REL || !isGlobalsPropertiesPath(r)) continue;
        const target = path.join(stagingPath, r);
        if (!target.startsWith(stagingPath + path.sep) || !fs.existsSync(target)) continue;
        const props = fs.readFileSync(target, "utf-8");
        if (!/^Globals\.DbType\s*=.*$/m.test(props)) continue;
        fs.writeFileSync(target, props.replace(/^Globals\.DbType\s*=.*$/m, `Globals.DbType = ${opts.database}`));
        customized.push(`${r} (Globals.DbType=${opts.database})`);
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

  if (archive && archiveVerified) customized.unshift(`zip 지문 검증 통과 (sha256 ${archive.sha256.slice(0, 12)}…, ${archive.bytes} bytes)`);

  const buildStep = tpl.multiProject
    ? "README.md 참조 — backend/frontend/k8s/docker-compose 하위 프로젝트별 기동 안내"
    : opts.template === "simple-react"
      ? "npm install && npm start"
      : archive
        ? "mvn -B package   # 빌드 (실행 방식·DB 준비는 프로젝트의 readme·DATABASE/·설정 파일 참조)"
      : opts.template === "simple-backend"
        ? "mvn -B verify   # 빌드/테스트 (JDK 17, hsql 외 DB는 접속정보를 application-*.properties에 설정)"
        : "mvn -B package   # WAR 빌드 (DB 초기화는 DATABASE/ 또는 README의 스크립트 참조)";
  const nextSteps = [
    `cd ${projectPath}`,
    buildStep,
    "자바 패키지 구조 변경(groupId에 맞춘 소스 이동)은 PoC 범위 밖입니다 — IDE의 rename refactoring 사용을 권장합니다.",
  ];

  return { projectPath, filesExtracted: count, customized, nextSteps, ref: effectiveRef, dryRun: false, archiveVerified };
}

/** 템플릿 zip 다운로드 → 압축 해제 → 사용자 값 적용 (dryRun이면 미리보기만) */
export async function createProject(opts: CreateOptions): Promise<CreateResult> {
  return createProjectInternal(opts);
}
