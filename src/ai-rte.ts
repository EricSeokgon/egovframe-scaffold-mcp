// AI 조립 — 표준프레임워크 5.1.0 AI 모듈 기준 (add_ai_components base="rte-ai", v1.20.0)
//   공식 샘플(egovframe-ai-rag, Spring AI 1.0.1)을 복사하는 대신 5.1.0 실행환경의 AI 모듈(egovframe-rte-ai-core + 어댑터)을 쓰는
//   작은 RAG 조립물을 프로젝트 패키지에 생성한다: 문서 업로드 → 추출(HWP·HWPX·DOCX·PDF·Markdown, 추출 한도) → 정규화 →
//   한국어 문장 경계 청킹 → 색인 단계 개인정보 마스킹 → PGVector 재색인 / 질문 → 프롬프트 인젝션 가드 → 검색 → OpenAI 호환 모델 응답.
//   모델·저장소 접속 정보는 환경 변수(EGOV_AI_*)로만 읽는다. 생성 코드는 catalog/ai-rte/ 의 템플릿(실측: 공식 boot-web 5.1.0 에서
//   두 스택 모두 컴파일·기동·질의 왕복).
import * as fs from "node:fs";
import * as path from "node:path";
import { withFileTransaction } from "./file-transaction.js";
import { sha256 } from "./shared.js";
import { MANIFEST_FILE, readManifest, type Manifest } from "./manifest.js";
import { versionBelow } from "./migrate.js";
import { AI_POM_BACKUP, AI_POM_MARKER, depCoord, depToXml, findProjectDependenciesClose, type AddAiComponentsOptions, type AddAiResult, type AiMavenDependency } from "./ai.js";

export const AI_RTE_MIN_PARENT = "5.1.0";
export const AI_RTE_FORMATS = ["hwp", "hwpx", "docx", "pdf"] as const;
export type AiRteFormat = (typeof AI_RTE_FORMATS)[number];
export const AI_RTE_COMPONENT_IDS = { "spring-ai": "ai-rte-spring-ai", langchain4j: "ai-rte-langchain4j" } as const;
const SAMPLE_COMPONENT_IDS = ["ai-rag-spring-ai", "ai-rag-langchain4j"];
const TEMPLATE_ROOT = new URL("../catalog/ai-rte/", import.meta.url);
const README_FILE = "EGOV-AI.md";

const STACK_DEPS: Record<"spring-ai" | "langchain4j", AiMavenDependency[]> = {
  "spring-ai": [
    { groupId: "org.egovframe.rte", artifactId: "egovframe-rte-ai-springai" },
    { groupId: "org.springframework.ai", artifactId: "spring-ai-openai" },
    { groupId: "org.springframework.ai", artifactId: "spring-ai-pgvector-store" },
    { groupId: "org.postgresql", artifactId: "postgresql" },
  ],
  langchain4j: [
    { groupId: "org.egovframe.rte", artifactId: "egovframe-rte-ai-langchain4j" },
    { groupId: "dev.langchain4j", artifactId: "langchain4j-open-ai" },
    { groupId: "dev.langchain4j", artifactId: "langchain4j-pgvector" },
    { groupId: "org.postgresql", artifactId: "postgresql" },
  ],
};
/** 문서 형식별 optional 라이브러리(버전은 egovframe-rte-root 5.1.0 이 관리). Markdown 은 라이브러리가 필요 없다 */
const FORMAT_DEPS: Record<AiRteFormat, AiMavenDependency[]> = {
  hwp: [{ groupId: "kr.dogfoot", artifactId: "hwplib" }],
  hwpx: [{ groupId: "kr.dogfoot", artifactId: "hwpxlib" }, { groupId: "org.apache.commons", artifactId: "commons-compress" }],
  docx: [{ groupId: "org.apache.poi", artifactId: "poi-ooxml" }, { groupId: "org.apache.commons", artifactId: "commons-compress" }],
  pdf: [{ groupId: "org.apache.pdfbox", artifactId: "pdfbox" }],
};
const NAMES = { "spring-ai": "AI RAG (5.1.0 AI 모듈 + Spring AI + PGVector)", langchain4j: "AI RAG (5.1.0 AI 모듈 + LangChain4j + PGVector)" } as const;

export interface AiRteOptions extends AddAiComponentsOptions { formats?: AiRteFormat[] }

const readTpl = (rel: string) => fs.readFileSync(new URL(rel, TEMPLATE_ROOT), "utf8");

/** pom 의 egovframe-boot-starter-parent 버전(없으면 null) */
export function bootParentVersion(pom: string): string | null {
  const pm = pom.replace(/<!--[\s\S]*?-->/g, "").match(/<parent>[\s\S]*?<\/parent>/)?.[0];
  if (!pm || !/<artifactId>\s*egovframe-boot-starter-parent\s*<\/artifactId>/.test(pm)) return null;
  return pm.match(/<version>\s*([^<\s]+)\s*<\/version>/)?.[1] ?? null;
}
/** base="auto" 판정: Boot parent 가 5.1.0 이상이면 rte-ai, 아니면 sample */
export function resolveAiBase(projectDir: string, base: "auto" | "sample" | "rte-ai" | undefined): "sample" | "rte-ai" {
  if (base === "sample" || base === "rte-ai") return base;
  const pomPath = path.join(path.resolve(projectDir), "pom.xml");
  if (!fs.existsSync(pomPath)) return "sample";
  const v = bootParentVersion(fs.readFileSync(pomPath, "utf8"));
  return v && versionBelow(v, AI_RTE_MIN_PARENT) === false ? "rte-ai" : "sample";
}

/** @SpringBootApplication 클래스의 패키지(src/main/java 아래 첫 번째) */
export function findBootApplicationPackage(projectDir: string): string | null {
  const root = path.join(projectDir, "src", "main", "java");
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < 20_000) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!e.name.endsWith(".java")) continue;
      seen++;
      const t = fs.readFileSync(p, "utf8");
      if (!/@SpringBootApplication\b/.test(t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""))) continue;
      return t.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? null;
    }
  }
  return null;
}

function renderReadme(stack: "spring-ai" | "langchain4j", pkg: string, formats: AiRteFormat[]): string {
  const table = stack === "spring-ai" ? "egov_ai_vector" : "egov_ai_segment";
  return `# AI RAG 조립물 (표준프레임워크 5.1.0 AI 모듈 · ${stack === "spring-ai" ? "Spring AI" : "LangChain4j"} · PGVector)

egovframe-scaffold-mcp 의 \`add_ai_components(base="rte-ai")\` 가 만들었습니다. 코드는 \`${pkg}\` 패키지의 세 클래스입니다.

| 클래스 | 하는 일 |
|---|---|
| \`EgovAiConfig\` | 추출기·인젝션 가드, OpenAI 호환 모델 클라이언트, PGVector 저장소(첫 사용 때 연결 — 저장소가 없어도 앱은 뜹니다) |
| \`EgovAiRagService\` | 색인: 추출 → 정규화 → 문장 경계 청킹 → 개인정보 마스킹 → 재색인 / 질의: 가드 → 검색 → 응답 |
| \`EgovAiController\` | \`POST /ai/documents\`(multipart \`file\`) · \`POST /ai/ask\`(\`{"question":"…"}\`) |

지원 형식: Markdown${formats.length ? ` · ${formats.map((f) => f.toUpperCase()).join(" · ")}` : ""}(pom 에 넣은 파서만). 다른 형식을 더하려면 해당 라이브러리(hwplib·hwpxlib·poi-ooxml·pdfbox)를 pom 에 추가하세요 — 버전은 parent 가 관리합니다.

## 설정 (환경 변수)

값은 소스·설정 파일에 적지 말고 환경 변수(또는 k8s Secret)로 넣습니다. 같은 이름의 \`egov.ai.*\` 속성으로도 줄 수 있습니다.

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| \`EGOV_AI_BASE_URL\` | \`http://localhost:11434\` | OpenAI 호환 서버 루트(\`/v1\` 은 붙이지 않음) — Ollama·vLLM·사내 게이트웨이 |
| \`EGOV_AI_API_KEY\` | \`none\` | API 키(필요 없는 서버는 그대로) |
| \`EGOV_AI_CHAT_MODEL\` | (없음 — 필수) | 대화 모델 이름 |
| \`EGOV_AI_EMBEDDING_MODEL\` | (없음 — 필수) | 임베딩 모델 이름 |
| \`EGOV_AI_EMBEDDING_DIMENSIONS\` | \`1024\` | 임베딩 차원 — 모델과 같아야 하며, 바꾸면 표(\`${table}\`)를 다시 만들어야 합니다 |
| \`EGOV_AI_PGVECTOR_URL\` | \`jdbc:postgresql://localhost:5432/egovai\` | PGVector(PostgreSQL + vector 확장) JDBC URL |
| \`EGOV_AI_PGVECTOR_USERNAME\` · \`EGOV_AI_PGVECTOR_PASSWORD\` | (없음) | 저장소 계정 |
| \`EGOV_AI_GUARD_POLICY\` | \`block\` | 프롬프트 인젝션 가드 — \`block\`(거부) 또는 \`log\`(허용하고 기록) |
| \`EGOV_AI_CHUNK_SIZE\` · \`EGOV_AI_TOP_K\` | \`800\` · \`4\` | 청크 크기(글자) · 검색 조각 수 |

표 \`${table}\` 은 첫 사용 때 만들어집니다(계정에 \`CREATE EXTENSION vector\` 권한이 없으면 DBA 가 확장을 먼저 설치).

## 운영 전에 확인할 것

- **접근 통제**: \`/ai/**\` 는 인증·권한 설정이 없습니다. 프로젝트의 보안 설정(Spring Security·인터셉터)에 넣으세요.
- **문서 식별자**: 같은 파일 이름으로 다시 올리면 이전 색인을 지우고 다시 넣습니다. 여러 사용자·부서가 한 저장소를 쓰면 남의 문서를 같은 이름으로 덮어쓸 수 있으니(CWE-639) 이름 앞에 소유자·부서를 붙이거나 저장소를 나누세요.
- **업로드 크기**: 추출 한도(파일 크기·PDF 쪽수·추출 글자 수·zip 폭탄)는 실행환경 기본값입니다. 서블릿 업로드 상한(\`spring.servlet.multipart.max-file-size\`)도 함께 정하세요.
- **개인정보**: 색인 단계에서 주민등록번호·카드번호·계좌번호·비밀값을 토큰으로 바꿉니다(\`EGOV_AI_AUDIT\` 로그에 건수). 이름·주소 같은 다른 개인정보는 바꾸지 않습니다.
- **감사 로그**: 가드 판정·마스킹 건수는 로거 \`EGOV_AI_AUDIT\` 로 남습니다(질의 원문은 남기지 않음). 운영 로그 설정에서 이 로거를 파일로 보내세요.
- **검색**: 밀집(벡터) 검색만 연결했습니다. 어휘 검색(pg_trgm)과 RRF 융합은 어댑터의 \`EgovHybrid${stack === "spring-ai" ? "DocumentRetriever" : "ContentRetriever"}\` 로 더할 수 있습니다.
`;
}

interface RtePlan {
  projectDir: string; stack: "spring-ai" | "langchain4j"; id: string; pkg: string | null; formats: AiRteFormat[];
  compatibility: AddAiResult["compatibility"]; toAdd: AiMavenDependency[]; alreadyPresent: string[];
  files: { rel: string; content: string }[];
}

function computeRtePlan(opts: AiRteOptions): RtePlan {
  const projectDir = path.resolve(opts.projectDir);
  const stack = opts.stack;
  const id = AI_RTE_COMPONENT_IDS[stack];
  const formats = [...new Set(opts.formats ?? [...AI_RTE_FORMATS])];
  const bad = formats.filter((f) => !AI_RTE_FORMATS.includes(f));
  if (bad.length) throw new Error(`formats 는 ${AI_RTE_FORMATS.join("|")} 중에서 고릅니다: ${bad.join(", ")}`);
  const manifest = readManifest(projectDir);
  if (manifest) {
    if (manifest.components[id]) throw new Error(`'${id}'가 이미 설치되어 있습니다 (매니페스트 기준)`);
    for (const x of [...Object.values(AI_RTE_COMPONENT_IDS), ...SAMPLE_COMPONENT_IDS]) if (x !== id && manifest.components[x]) throw new Error(`다른 AI 조립물 '${x}'가 이미 설치되어 있습니다 — 먼저 remove_egovframe_components 로 제거하세요`);
  }
  const warnings: string[] = [];
  const pomPath = path.join(projectDir, "pom.xml");
  const pomFound = fs.existsSync(pomPath);
  const required = `egovframe-boot-starter-parent:${AI_RTE_MIN_PARENT}+`;
  let parentFound: string | null = null, parentOk: boolean | null = null;
  const toAdd: AiMavenDependency[] = [], alreadyPresent: string[] = [];
  if (pomFound) {
    const pom = fs.readFileSync(pomPath, "utf8");
    const v = bootParentVersion(pom);
    parentFound = v ? `egovframe-boot-starter-parent:${v}` : null;
    parentOk = !!v && versionBelow(v, AI_RTE_MIN_PARENT) === false;
    if (!parentOk) warnings.push(`5.1.0 AI 모듈 조립은 egovframe-boot-starter-parent ${AI_RTE_MIN_PARENT} 이상이 필요합니다(발견: ${parentFound ?? "없음"}) — migrate_egovframe_project(target="5.1.0") 로 올리거나 base="sample" 을 쓰세요`);
    const seen = new Set<string>();
    for (const d of [...STACK_DEPS[stack], ...formats.flatMap((f) => FORMAT_DEPS[f])]) {
      if (seen.has(d.artifactId)) continue;
      seen.add(d.artifactId);
      if (new RegExp(`<artifactId>\\s*${d.artifactId}\\s*</artifactId>`).test(pom)) alreadyPresent.push(depCoord(d)); else toAdd.push(d);
    }
  } else warnings.push("pom.xml이 없습니다 — Boot 프로젝트 루트 경로인지 확인하세요");
  const appPkg = fs.existsSync(projectDir) ? findBootApplicationPackage(projectDir) : null;
  if (pomFound && !appPkg) warnings.push("@SpringBootApplication 클래스를 찾지 못했습니다 — 생성 코드를 둘 패키지를 정할 수 없습니다");
  const pkg = appPkg ? `${appPkg}.ai` : null;
  const files: RtePlan["files"] = [];
  if (pkg) {
    const dir = `src/main/java/${pkg.split(".").join("/")}`;
    const fill = (t: string) => t.replace(/__PKG__/g, pkg);
    files.push({ rel: `${dir}/EgovAiConfig.java`, content: fill(readTpl(`${stack}/EgovAiConfig.java.tpl`)) });
    files.push({ rel: `${dir}/EgovAiRagService.java`, content: fill(readTpl(`${stack}/EgovAiRagService.java.tpl`)) });
    files.push({ rel: `${dir}/EgovAiController.java`, content: fill(readTpl("common/EgovAiController.java.tpl")) });
    files.push({ rel: README_FILE, content: renderReadme(stack, pkg, formats) });
  }
  return { projectDir, stack, id, pkg, formats, compatibility: { pomFound, required, parentFound, parentOk, warnings }, toAdd, alreadyPresent, files };
}

const PREREQUISITES = ["OpenAI 호환 모델 서버(대화·임베딩 모델)", "PostgreSQL + pgvector 확장", "환경 변수 EGOV_AI_*(EGOV-AI.md)"];

/** 5.1.0 AI 모듈 기준 조립(생성). dryRun 이면 계획만 */
export async function addRteAiComponents(opts: AiRteOptions): Promise<AddAiResult> {
  const p = computeRtePlan(opts);
  const copyPlan = [{ group: "source", files: p.files.filter((f) => f.rel.endsWith(".java")).length, paths: p.files.filter((f) => f.rel.endsWith(".java")).map((f) => f.rel) }, { group: "docs", files: p.files.filter((f) => !f.rel.endsWith(".java")).length, paths: p.files.filter((f) => !f.rel.endsWith(".java")).map((f) => f.rel) }];
  const base = {
    projectDir: p.projectDir,
    component: { id: p.id, name: NAMES[p.stack], vectorStore: "PostgreSQL (PGVector)" },
    compatibility: p.compatibility,
    dependencyChanges: { toAdd: p.toAdd.map(depCoord), alreadyPresent: p.alreadyPresent },
    copyPlan, totalFiles: p.files.length, prerequisites: PREREQUISITES,
  };
  if (opts.dryRun === true) return { ...base, nextSteps: ["미리보기 모드입니다. 실제 조립하려면 dryRun 없이 다시 호출하세요."], dryRun: true, copiedFiles: 0, pomChanged: false, pomBackup: null };

  if (!fs.existsSync(p.projectDir) || !fs.statSync(p.projectDir).isDirectory()) throw new Error(`대상 프로젝트 디렉터리가 없습니다: ${p.projectDir} — 먼저 create_egovframe_project로 생성하세요`);
  if (!p.compatibility.pomFound) throw new Error(`pom.xml이 없습니다: ${p.projectDir} — Boot 프로젝트 루트에서 실행하세요`);
  if (p.compatibility.parentOk !== true) throw new Error(p.compatibility.warnings[0]);
  if (!p.pkg) throw new Error("@SpringBootApplication 클래스를 찾지 못했습니다 — Boot 프로젝트만 지원합니다");
  const conflicts = p.files.filter((f) => fs.existsSync(path.join(p.projectDir, f.rel))).map((f) => f.rel);
  if (conflicts.length) throw new Error(`기존 파일과 충돌하여 조립을 거부합니다 (${conflicts.length}개): ${conflicts.join(", ")} — 아무 파일도 쓰지 않았습니다`);
  const pomPath = path.join(p.projectDir, "pom.xml");
  if (p.toAdd.length && fs.existsSync(path.join(p.projectDir, AI_POM_BACKUP))) throw new Error(`pom 백업(${AI_POM_BACKUP})이 이미 있습니다 — 이전 조립 잔여물을 정리한 뒤 다시 시도하세요`);
  const pomBefore = fs.readFileSync(pomPath, "utf8");
  let nextPom = pomBefore;
  const pomChanged = p.toAdd.length > 0;
  if (pomChanged) {
    const close = findProjectDependenciesClose(nextPom);
    if (close < 0) throw new Error("pom.xml에서 <dependencies> 블록을 찾지 못했습니다");
    const block = [`        ${AI_POM_MARKER(p.id, "deps", "start")}`, ...p.toAdd.map((d) => depToXml(d)), `        ${AI_POM_MARKER(p.id, "deps", "end")}`, "    "].join("\n");
    nextPom = nextPom.slice(0, close) + block + nextPom.slice(close);
  }
  const manifest: Manifest = readManifest(p.projectDir) ?? { schemaVersion: 3, source: { repo: "eGovFramework/egovframe-runtime", branch: "5.1.x" }, components: {} };
  manifest.components[p.id] = {
    installedAt: new Date().toISOString(),
    files: p.files.map((f) => f.rel),
    hashes: Object.fromEntries(p.files.map((f) => { const h = sha256(f.content); return [f.rel, { hash: h, srcHash: h }]; })),
    sqlScripts: [],
    pom: pomChanged ? { backup: AI_POM_BACKUP, addedDeps: p.toAdd.map((d) => d.artifactId), addedProps: [] } : undefined,
  };
  manifest.schemaVersion = 3;
  await withFileTransaction(p.projectDir, "AI 조립(5.1.0 AI 모듈)", async (tx) => {
    for (const f of p.files) tx.writeFile(f.rel, f.content, { mustNotExist: true });
    if (opts.faultInjection === "after-files") throw new Error("AI assembly fault injection: after-files");
    if (pomChanged) { tx.writeFile(AI_POM_BACKUP, pomBefore, { mustNotExist: true }); tx.writeFile("pom.xml", nextPom); }
    if (opts.faultInjection === "after-pom") throw new Error("AI assembly fault injection: after-pom");
    tx.writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  });
  return {
    ...base, copiedFiles: p.files.length, pomChanged, pomBackup: pomChanged ? AI_POM_BACKUP : null, dryRun: false,
    nextSteps: [
      `${README_FILE} 의 환경 변수(EGOV_AI_BASE_URL·EGOV_AI_CHAT_MODEL·EGOV_AI_EMBEDDING_MODEL·EGOV_AI_EMBEDDING_DIMENSIONS·EGOV_AI_PGVECTOR_*)를 정합니다 — 값은 소스에 적지 않습니다`,
      "PostgreSQL 에 pgvector 확장을 준비합니다(표는 첫 사용 때 생성)",
      "빌드·기동 뒤 POST /ai/documents(multipart file) 로 문서를 올리고 POST /ai/ask 로 질의합니다",
      "/ai/** 에 인증·권한을 붙이고(프로젝트 보안 설정), 운영 로그에 EGOV_AI_AUDIT 로거를 남깁니다",
      "check_egovframe_secure_coding 으로 AI 규칙(추출 한도·가드·API 키)을 확인합니다",
    ],
  };
}
