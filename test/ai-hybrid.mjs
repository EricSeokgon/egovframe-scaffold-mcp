// node test/ai-hybrid.mjs — AI 조립 보강(v1.22) 게이트 (오프라인, 플랫폼 중립)
//   search 기본값(dense)은 v1.20 과 같은 설정 클래스(해시 고정)·하이브리드 부품 없음 · hybrid 생성 코드 불변식(어휘 검색·RRF 검색기·메타데이터 id·환경 변수) ·
//   추출 실패는 400 사유(임시 경로 없음) · 접근 통제 조각(보안 방식 4가지) · 배포 산출물의 PGVector·EGOV_AI_* 블록(조립물이 없으면 그대로) · MCP 파라미터
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { addAiComponents, removeComponents, detectAiAccessControl, detectAiAssembly, generateDeploy, loadDeployRules, checkSecureCoding, buildServer, AI_RTE_SEARCH } from "../dist/index.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const root = mkdtempSync(path.join(tmpdir(), "egov-ai-hybrid-"));
let k = 0;
const POM = (extra = "") => `<project>\n    <modelVersion>4.0.0</modelVersion>\n    <parent>\n        <groupId>org.egovframe.boot</groupId>\n        <artifactId>egovframe-boot-starter-parent</artifactId>\n        <version>5.1.0</version>\n    </parent>\n    <groupId>kr.go</groupId>\n    <artifactId>sample</artifactId>\n    <version>1.0.0</version>\n    <dependencies>\n        <dependency>\n            <groupId>org.springframework.boot</groupId>\n            <artifactId>spring-boot-starter-web</artifactId>\n        </dependency>\n${extra}    </dependencies>\n</project>\n`;
const dep = (a, g = "org.springframework.boot") => `        <dependency>\n            <groupId>${g}</groupId>\n            <artifactId>${a}</artifactId>\n        </dependency>\n`;
const project = (extra = "", files = {}) => {
  const d = path.join(root, `p${k++}`);
  mkdirSync(path.join(d, "src/main/java/kr/go/sample"), { recursive: true });
  writeFileSync(path.join(d, "pom.xml"), POM(extra));
  writeFileSync(path.join(d, "src/main/java/kr/go/sample/App.java"), "package kr.go.sample;\n\n@SpringBootApplication\npublic class App {}\n");
  for (const [rel, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), text); }
  return d;
};
const AI = "src/main/java/kr/go/sample/ai";
const sha = (t) => createHash("sha256").update(t).digest("hex");
const threw = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
// v1.20(327f438) 템플릿으로 만든 EgovAiConfig.java(패키지 kr.go.sample.ai)의 sha256
const V120_CONFIG = { "spring-ai": "71305f0348b1192493434eb0411c0cd1f6d214d620d62eb1ec48efaa4ab59335", langchain4j: "0f518c0caf37a4f8c75afe12e1fa6af5e07ad1178151b53b5221133938510406" };

try {
  assert(AI_RTE_SEARCH.join() === "dense,hybrid", "search 값: dense·hybrid");
  for (const stack of ["spring-ai", "langchain4j"]) {
    // ── dense(기본) ──
    const d = project();
    const r = await addAiComponents({ projectDir: d, stack });
    const cfg = readFileSync(path.join(d, AI, "EgovAiConfig.java"), "utf8"), svc = readFileSync(path.join(d, AI, "EgovAiRagService.java"), "utf8");
    assert(r.search === "dense" && sha(cfg) === V120_CONFIG[stack] && !/Hybrid|PgTrgm|pg_trgm/.test(cfg + svc) && !r.dependencyChanges.toAdd.some((x) => x.includes("spring-jdbc")) && !r.prerequisites.some((x) => x.includes("pg_trgm")), `${stack}: search 기본값은 dense — 설정 클래스가 v1.20 과 바이트 동일, 하이브리드 부품·의존성 없음`);
    assert(/if \((read|loaded)\.documents\(\)\.isEmpty\(\) && !failures\.isEmpty\(\)\)/.test(svc) && svc.includes("throw new IllegalArgumentException(\"문서를 읽지 못했습니다: \"") && svc.includes(".replace(file.getFileName().toString(), fileName)") && !svc.includes("map(Object::toString)"), `${stack}: 추출 실패(한도 초과·손상)는 400 사유로 — 임시 경로·예외 클래스 대신 올린 파일 이름`);
    const readme = readFileSync(path.join(d, "EGOV-AI.md"), "utf8");
    assert(!readme.includes("## 하이브리드 검색") && readme.includes('add_ai_components(search="hybrid")') && readme.includes("## 접근 통제 연결") && !readme.includes("EGOV_AI_LEXICAL"), `${stack}: dense 안내서 — 하이브리드로 조립하는 방법, 접근 통제 조각`);

    // ── hybrid ──
    const h = project();
    const dry = await addAiComponents({ projectDir: h, stack, search: "hybrid", dryRun: true });
    assert(dry.dryRun && dry.search === "hybrid" && !existsSync(path.join(h, AI)) && dry.prerequisites.some((x) => x.includes("pg_trgm")), `${stack}: hybrid dryRun — 쓰지 않음, 실행 전제에 pg_trgm`);
    const rh = await addAiComponents({ projectDir: h, stack, search: "hybrid" });
    const hc = readFileSync(path.join(h, AI, "EgovAiConfig.java"), "utf8"), hs = readFileSync(path.join(h, AI, "EgovAiRagService.java"), "utf8");
    const table = stack === "spring-ai" ? "egov_ai_vector" : "egov_ai_segment", col = stack === "spring-ai" ? "content" : "text";
    assert(hc.includes("new EgovPgTrgmLexicalSearch(") && new RegExp(`EgovHybrid${stack === "spring-ai" ? "Document" : "Content"}Retriever\\.builder\\(\\)`).test(hc) && /\.(documentLookup|segmentLookup)\(/.test(hc) && !/rerankOnly/.test(hc) && hc.includes("new DataSourceTransactionManager(ds)") && hc.includes(`CREATE INDEX IF NOT EXISTS ${table}_trgm ON ${table} USING gin (${col} gin_trgm_ops)`) && /if \(lexicalInit\)/.test(hc), `${stack}: hybrid 설정 — 어휘 검색(pg_trgm)·RRF 검색기·어휘 단독 조각 본문 조회, 색인 생성은 끌 수 있음`);
    assert(["EGOV_AI_LEXICAL_THRESHOLD:0.3", "EGOV_AI_LEXICAL_WEIGHT:1.0", "EGOV_AI_LEXICAL_INIT:true", "EGOV_AI_TOP_K:4"].every((x) => hc.includes(x)) && /retriever\.getObject\(\)\.retrieve\(/.test(hs) && !/similaritySearch|EmbeddingSearchRequest/.test(hs) && hs.indexOf("guard.inspect(question)") < hs.indexOf("retriever.getObject()") && (stack === "langchain4j" || hs.includes('d.getMetadata().put("id", d.getId())')), `${stack}: hybrid 서비스 — 가드 뒤에 검색기 호출, 임계값·가중치는 환경 변수${stack === "spring-ai" ? ", 색인 때 메타데이터 id" : ""}`);
    assert((stack === "langchain4j") === rh.dependencyChanges.toAdd.some((x) => x.includes("spring-jdbc")) && !/"\?, "\.repeat|\+ *question|\+ *query/.test(hs) && !/(password|apiKey)\s*=\s*"[^"$]/i.test(hc), `${stack}: 의존성(${stack === "langchain4j" ? "spring-jdbc 추가" : "추가 없음"}), 질의 문자열을 SQL 에 잇지 않음, 비밀값 리터럴 없음`);
    const hr = readFileSync(path.join(h, "EGOV-AI.md"), "utf8");
    assert(hr.includes("## 하이브리드 검색") && hr.includes(`CREATE INDEX IF NOT EXISTS ${table}_trgm ON ${table} USING gin (${col} gin_trgm_ops);`) && hr.includes("LC_CTYPE") && hr.includes("EGOV_AI_LEXICAL_INIT") && !hr.includes("밀집(벡터) 검색만 연결"), `${stack}: hybrid 안내서 — DBA 용 SQL·로캘 주의·환경 변수`);
    const sc = await checkSecureCoding({ projectDir: h });
    assert(sc.findings.filter((f) => f.file.includes("/ai/")).length === 0, `${stack}: hybrid 생성물 보안약점 0건 (${sc.findings.filter((f) => f.file.includes("/ai/")).map((f) => f.rule).join(",") || "없음"})`);

    // ── 배포 산출물 ──
    const before = await generateDeploy({ projectDir: project(), dryRun: true });
    const dp = await generateDeploy({ projectDir: h, dryRun: true });
    const compose = dp.files.find((f) => f.path === "deploy/docker-compose.yml").content, env = dp.files.find((f) => f.path === "deploy/.env.example").content, k8s = dp.files.find((f) => f.path.startsWith("deploy/k8s/")).content;
    const pg = loadDeployRules().ai.pgvector;
    assert(JSON.stringify(detectAiAssembly(h)) === JSON.stringify({ stack, search: "hybrid" }) && detectAiAssembly(d).search === "dense" && before.profile.ai === undefined && !/ai-db|EGOV_AI/.test(before.files.map((f) => f.content).join("")), `${stack}: 조립물 감지(검색 방식까지) — 조립물이 없으면 배포 산출물 그대로`);
    assert(compose.includes(`  ai-db:\n    image: \${AI_PGVECTOR_IMAGE:-${pg.image}:${pg.version}}`) && compose.includes(`EGOV_AI_PGVECTOR_URL: "jdbc:postgresql://ai-db:${pg.port}/${pg.database}"`) && compose.includes('EGOV_AI_PGVECTOR_PASSWORD: "${EGOV_AI_PGVECTOR_PASSWORD:-CHANGE_ME}"') && /depends_on:\n\s+ai-db:\n\s+condition: service_healthy/.test(compose) && compose.includes("host.docker.internal:host-gateway") && compose.trimEnd().endsWith("volumes:\n  ai-db-data: {}") && compose.includes("pg_trgm"), `${stack}: compose — ai-db(PGVector, 헬스체크·볼륨)·EGOV_AI_* 치환·모델 서버는 호스트`);
    assert(["EGOV_AI_BASE_URL=", "EGOV_AI_CHAT_MODEL=CHANGE_ME", "EGOV_AI_PGVECTOR_PASSWORD=CHANGE_ME", `AI_PGVECTOR_IMAGE=${pg.image}:${pg.version}`].every((x) => env.includes(x)) && k8s.split("kind: Secret")[0].includes("EGOV_AI_PGVECTOR_URL: 'jdbc:postgresql://CHANGE_ME_PGVECTOR_HOST:") && !k8s.split("kind: Secret")[0].includes("EGOV_AI_PGVECTOR_PASSWORD") && /kind: Secret[\s\S]*EGOV_AI_PGVECTOR_PASSWORD: 'CHANGE_ME'[\s\S]*EGOV_AI_API_KEY: 'CHANGE_ME'/.test(k8s) && dp.notes.some((x) => x.includes("AI 조립물")), `${stack}: .env.example·Kubernetes — 비밀값은 Secret 에만, 저장소 호스트는 자리표시자`);
    const rm = await removeComponents({ projectDir: h, components: [`ai-rte-${stack}`] });
    assert(!existsSync(path.join(h, AI)) && readFileSync(path.join(h, "pom.xml"), "utf8") === POM() && detectAiAssembly(h) === undefined, `${stack}: remove 로 pom 바이트 원복(${rm.removedFiles ?? "?"})`);
  }

  // ── 접근 통제 조각 ──
  {
    const none = project();
    const chain = project(dep("spring-boot-starter-security"), { "src/main/java/kr/go/sample/config/SecurityConfig.java": "package kr.go.sample.config;\n@Configuration\npublic class SecurityConfig {\n  @Bean\n  SecurityFilterChain chain(HttpSecurity http) throws Exception { return http.build(); }\n}\n" });
    const starterOnly = project(dep("spring-boot-starter-security"));
    const egov = project(dep("egovframe-boot-starter-security", "org.egovframe.boot"));
    const inter = project("", { "src/main/java/kr/go/sample/config/EgovLoginInterceptor.java": "package kr.go.sample.config;\npublic class EgovLoginInterceptor implements HandlerInterceptor {}\n", "src/main/java/kr/go/sample/config/WebConfig.java": "package kr.go.sample.config;\npublic class WebConfig implements WebMvcConfigurer {\n  public void addInterceptors(InterceptorRegistry r) {}\n}\n", "src/main/java/kr/go/sample/Commented.java": "package kr.go.sample;\n// SecurityFilterChain @Bean\nclass Commented {}\n" });
    const a = [none, chain, starterOnly, egov, inter].map((p) => detectAiAccessControl(p));
    assert(a.map((x) => x.kind).join() === "none,spring-security,spring-security,egov-security,interceptor" && a[1].evidence === "src/main/java/kr/go/sample/config/SecurityConfig.java" && a[2].evidence.startsWith("pom.xml") && a[4].evidence.endsWith("EgovLoginInterceptor.java"), `보안 방식 판정: ${a.map((x) => x.kind).join(" · ")}(주석 안 문자열 제외)`);
    assert(a.every((x) => x.snippet.includes("/ai/")) && a[1].snippet.includes('requestMatchers("/ai/**").authenticated()') && a[1].snippet.includes("SecurityConfig.java") && a[3].snippet.includes("request-matcher-type") && a[4].snippet.includes("new EgovLoginInterceptor()") && a[4].snippet.includes("WebConfig.java") && a[0].snippet.includes("spring-boot-starter-security"), "조각: 프로젝트의 설정 파일·클래스 이름을 가리킴");
    const r = await addAiComponents({ projectDir: inter, stack: "spring-ai" });
    const readme = readFileSync(path.join(inter, "EGOV-AI.md"), "utf8");
    const before = readFileSync(path.join(inter, "src/main/java/kr/go/sample/config/WebConfig.java"), "utf8");
    assert(r.accessControl.kind === "interceptor" && readme.includes("**인증 인터셉터**") && readme.includes('addPathPatterns("/ai/**")') && r.nextSteps.some((s) => s.includes("접근 통제 연결")) && before.includes("addInterceptors(InterceptorRegistry r) {}"), "조립 결과·안내서에 조각 — 프로젝트의 보안 설정 파일은 고치지 않음");
    assert(/search 는 dense\|hybrid/.test(await threw(() => addAiComponents({ projectDir: project(), stack: "spring-ai", search: "bm25" })) ?? ""), "모르는 search 값은 거부");
  }

  // ── MCP ──
  {
    const tool = buildServer()._registeredTools.add_ai_components;
    const shape = tool.inputSchema.shape ?? tool.inputSchema._def?.shape?.();
    const parsed = tool.inputSchema.safeParse({ projectDir: "/x", stack: "spring-ai" });
    assert(parsed.success && parsed.data.search === "dense" && tool.inputSchema.safeParse({ projectDir: "/x", stack: "spring-ai", search: "hybrid" }).success && !tool.inputSchema.safeParse({ projectDir: "/x", stack: "spring-ai", search: "x" }).success && !!shape, "MCP: search 파라미터(기본 dense, enum)");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`ai-hybrid FAIL (${n} assertions)`); else console.log(`ai-hybrid OK (${n} assertions)`);
