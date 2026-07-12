#!/usr/bin/env node
/**
 * AI 컴포넌트 카탈로그 생성기 — catalog/ai-components.json
 *
 * 공식 eGovFramework/egovframe-ai-rag 저장소의 샘플 모듈을 스캔해
 * add_ai_components가 사용하는 카탈로그를 생성한다.
 * 설계: docs/design-ai-components.md
 *
 * 사용법:
 *   node scripts/generate-ai-catalog.mjs                 # zip 다운로드 후 생성
 *   node scripts/generate-ai-catalog.mjs --src <경로>     # 로컬 체크아웃으로 생성(오프라인)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import AdmZip from "adm-zip";
import { fileURLToPath } from "node:url";

const AI_REPO = "eGovFramework/egovframe-ai-rag";
const AI_BRANCH = "main";
const OUT = fileURLToPath(new URL("../catalog/ai-components.json", import.meta.url));

/** 모듈 정의 — id·이름·스택 매핑 (구조 변화 시 여기와 설계 문서를 함께 갱신) */
const MODULES = [
  {
    id: "ai-rag-spring-ai",
    stack: "spring-ai",
    name: "AI RAG 챗봇 (Spring AI + Redis Stack)",
    description:
      "Spring AI 기반 RAG 질의응답 — 문서 업로드(PDF·DOCX·HWP·HWPX·MD)→임베딩→Redis Stack 하이브리드 검색→Ollama LLM 응답, 채팅 UI 포함",
    modulePath: "spring-ai-rag-redis-stack",
    vectorStore: "Redis Stack",
  },
  {
    id: "ai-rag-langchain4j",
    stack: "langchain4j",
    name: "AI RAG 챗봇 (LangChain4j + PGVector)",
    description:
      "LangChain4j 기반 RAG 질의응답 — 문서 업로드(PDF·DOCX·HWP·HWPX·MD)→임베딩→PostgreSQL(PGVector) 하이브리드 검색→Ollama LLM 응답, 채팅 UI 포함",
    modulePath: "langchain4j-ai-rag-postgre",
    vectorStore: "PostgreSQL (PGVector)",
  },
];

/** 두 스택 공통 실행 전제 */
const PREREQUISITES = ["ollama>=0.17.1", "onnx-embedding-model", "docker"];

function parseArgs() {
  const i = process.argv.indexOf("--src");
  return { src: i >= 0 ? process.argv[i + 1] : null };
}

/** 저장소를 로컬 디렉터리로 준비 (zip 다운로드 또는 --src) */
async function prepareSource(src) {
  if (src) {
    if (!fs.existsSync(path.join(src, MODULES[0].modulePath)))
      throw new Error(`--src에 egovframe-ai-rag 체크아웃이 없습니다: ${src}`);
    return { dir: src, cleanup: () => {} };
  }
  const url = `https://codeload.github.com/${AI_REPO}/zip/${AI_BRANCH}`;
  console.error(`다운로드: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패 (${res.status}): ${url}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-rag-"));
  zip.extractAllTo(tmp, true);
  const root = fs.readdirSync(tmp).find((d) => d.includes("ai-rag"));
  return { dir: path.join(tmp, root), cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/** pom.xml에서 최상위 <dependencies> 블록의 의존성을 exclusions 포함해 추출 */
function parsePomDependencies(pomText) {
  // <dependencyManagement>·<build> 내부를 제외한 프로젝트 직속 dependencies만
  const stripped = pomText
    .replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, "")
    .replace(/<build>[\s\S]*?<\/build>/g, "");
  const m = stripped.match(/<dependencies>([\s\S]*?)<\/dependencies>/);
  if (!m) return [];
  const deps = [];
  for (const dm of m[1].matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const block = dm[1];
    const tag = (t) => (block.replace(/<exclusions>[\s\S]*?<\/exclusions>/g, "").match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1]?.trim();
    const dep = { groupId: tag("groupId"), artifactId: tag("artifactId") };
    const version = tag("version");
    const scope = tag("scope");
    const optional = tag("optional");
    if (version) dep.version = version;
    if (scope) dep.scope = scope;
    if (optional === "true") dep.optional = true;
    const ex = block.match(/<exclusions>([\s\S]*?)<\/exclusions>/);
    if (ex) {
      dep.exclusions = [...ex[1].matchAll(/<exclusion>([\s\S]*?)<\/exclusion>/g)].map((e) => ({
        groupId: (e[1].match(/<groupId>([^<]*)<\/groupId>/) || [])[1]?.trim(),
        artifactId: (e[1].match(/<artifactId>([^<]*)<\/artifactId>/) || [])[1]?.trim(),
      }));
    }
    deps.push(dep);
  }
  return deps;
}

/** pom.xml <properties>에서 java.version·인코딩류를 제외한 버전 프로퍼티 추출 */
function parsePomProperties(pomText) {
  const m = pomText.match(/<properties>([\s\S]*?)<\/properties>/);
  if (!m) return {};
  const props = {};
  for (const p of m[1].matchAll(/<([\w.-]+)>([^<]*)<\/\1>/g)) {
    if (/^(java\.version|maven\.compiler|project\.)/.test(p[1])) continue;
    props[p[1]] = p[2].trim();
  }
  return props;
}

/** pom.xml <parent> 좌표 */
function parsePomParent(pomText) {
  const m = pomText.match(/<parent>([\s\S]*?)<\/parent>/);
  if (!m) return null;
  const tag = (t) => (m[1].match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1]?.trim();
  return { groupId: tag("groupId"), artifactId: tag("artifactId"), version: tag("version") };
}

function countFiles(root, rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return 0;
  if (fs.statSync(p).isFile()) return 1;
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true }))
    n += e.isDirectory() ? countFiles(root, path.join(rel, e.name)) : 1;
  return n;
}

/** 모듈 상대 경로 기준 복사 그룹 — 대상 경로 변환(→)은 조립 시 적용 */
function buildCopyGroups(moduleDir) {
  const c = (rel) => countFiles(moduleDir, rel);
  return {
    source: { paths: ["src/main/java/com/example/chat/"], files: c("src/main/java/com/example/chat") },
    config: {
      paths: [
        "src/main/resources/application.yml -> src/main/resources/application-ai.yml",
        "src/main/resources/log4j2-spring.xml -> src/main/resources/log4j2-ai.xml",
      ],
      files: c("src/main/resources/application.yml") + c("src/main/resources/log4j2-spring.xml"),
    },
    ui: {
      paths: ["src/main/resources/templates/", "src/main/resources/static/"],
      files: c("src/main/resources/templates") + c("src/main/resources/static"),
    },
    infra: {
      paths: [
        "docker-compose.yml -> docker-compose.ai.yml",
        "Dockerfile -> Dockerfile.ai",
        "k8s/ -> k8s/ai/",
        ...(fs.existsSync(path.join(moduleDir, "init-scripts")) ? ["init-scripts/ -> init-scripts/ai/"] : []),
      ],
      files: c("docker-compose.yml") + c("Dockerfile") + c("k8s") + c("init-scripts"),
    },
    tests: { paths: ["src/test/"], files: c("src/test") },
  };
}

async function main() {
  const { src } = parseArgs();
  const { dir, cleanup } = await prepareSource(src);
  try {
    const components = MODULES.map((mod) => {
      const moduleDir = path.join(dir, mod.modulePath);
      const pomText = fs.readFileSync(path.join(moduleDir, "pom.xml"), "utf-8");
      const parent = parsePomParent(pomText);
      if (!parent) throw new Error(`${mod.modulePath}/pom.xml에서 <parent>를 찾지 못했습니다`);
      const copyGroups = buildCopyGroups(moduleDir);
      return {
        id: mod.id,
        stack: mod.stack,
        kind: "ai",
        name: mod.name,
        description: mod.description,
        modulePath: mod.modulePath,
        vectorStore: mod.vectorStore,
        conflictsWith: MODULES.filter((m) => m.id !== mod.id).map((m) => m.id),
        requires: { java: "17", parent: `${parent.artifactId}:${parent.version}` },
        copyGroups,
        approxFiles:
          copyGroups.source.files + copyGroups.config.files + copyGroups.ui.files + copyGroups.infra.files,
        mavenDependencies: parsePomDependencies(pomText),
        mavenProperties: parsePomProperties(pomText),
        prerequisites: PREREQUISITES,
      };
    });
    const catalog = {
      schemaVersion: 1,
      source: { repo: AI_REPO, branch: AI_BRANCH, surveyedAt: new Date().toISOString().slice(0, 10) },
      note:
        "add_ai_components용 카탈로그 — 조립 대상은 egovframe-boot-starter-parent 기반 Boot 프로젝트. " +
        "두 스택은 같은 패키지(com.example.chat)·UI 경로를 사용하므로 상호 배타(conflictsWith).",
      components,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + "\n");
    console.error(
      `생성 완료: ${OUT} — ${components.map((c) => `${c.id}(deps ${c.mavenDependencies.length}, files ~${c.approxFiles})`).join(", ")}`,
    );
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
