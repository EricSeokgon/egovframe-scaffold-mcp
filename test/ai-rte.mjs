// node test/ai-rte.mjs — AI 조립(5.1.0 AI 모듈 기준, v1.20) 게이트 (오프라인, 플랫폼 중립)
//   base 판정(auto·명시) · parent 게이트 · 패키지 탐지 · 계획(dryRun 무기록)·형식별 의존성 · 조립(파일·pom 마커·매니페스트 hash) ·
//   충돌 거부·배타·fault-injection 롤백 · 제거 원복 · 생성 코드 불변식(환경 변수만, 가드·한도·마스킹 연결) · 보안약점 AI 규칙 3종
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addAiComponents, removeComponents, resolveAiBase, bootParentVersion, findBootApplicationPackage, readManifest, checkSecureCoding, loadSecureRules, AI_RTE_FORMATS, AI_RTE_COMPONENT_IDS, AI_POM_BACKUP } from "../dist/index.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const root = mkdtempSync(path.join(tmpdir(), "egov-ai-rte-"));
let k = 0;
const POM = (v, extra = "") => `<project>\n    <parent>\n        <groupId>org.egovframe.boot</groupId>\n        <artifactId>egovframe-boot-starter-parent</artifactId>\n        <version>${v}</version>\n    </parent>\n    <artifactId>a</artifactId>\n    <dependencies>\n        <dependency>\n            <groupId>org.springframework.boot</groupId>\n            <artifactId>spring-boot-starter-web</artifactId>\n        </dependency>${extra}\n    </dependencies>\n</project>\n`;
const project = (version = "5.1.0", extra = "", app = true) => {
  const d = path.join(root, `p${k++}`);
  mkdirSync(path.join(d, "src/main/java/kr/go/sample"), { recursive: true });
  writeFileSync(path.join(d, "pom.xml"), POM(version, extra));
  if (app) writeFileSync(path.join(d, "src/main/java/kr/go/sample/App.java"), "package kr.go.sample;\n\n// @SpringBootApplication 주석\n@SpringBootApplication\npublic class App {}\n");
  return d;
};
const threw = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
const AI_DIR = "src/main/java/kr/go/sample/ai";

try {
  // ── 판정 ──
  {
    assert(bootParentVersion(POM("5.1.0")) === "5.1.0" && bootParentVersion("<project><parent><artifactId>egovframe-web-config-parent</artifactId><version>5.1.0</version></parent></project>") === null && bootParentVersion("<project/>") === null, "bootParentVersion: Boot parent 만");
    const p51 = project("5.1.0"), p502 = project("5.0.2"), p52 = project("5.2.1");
    assert(resolveAiBase(p51, undefined) === "rte-ai" && resolveAiBase(p51, "auto") === "rte-ai" && resolveAiBase(p52, "auto") === "rte-ai" && resolveAiBase(p502, "auto") === "sample" && resolveAiBase(p502, "rte-ai") === "rte-ai" && resolveAiBase(p51, "sample") === "sample" && resolveAiBase(path.join(root, "none"), "auto") === "sample", "base: auto 는 Boot parent 5.1.0 이상이면 rte-ai, 아니면 sample · 명시가 우선");
    assert(findBootApplicationPackage(p51) === "kr.go.sample" && findBootApplicationPackage(project("5.1.0", "", false)) === null, "@SpringBootApplication 패키지 탐지(주석 제외)");
    const e1 = await threw(() => addAiComponents({ projectDir: p502, stack: "spring-ai", base: "rte-ai" }));
    const dry502 = await addAiComponents({ projectDir: p502, stack: "spring-ai", base: "rte-ai", dryRun: true });
    assert(/5\.1\.0 이상이 필요/.test(e1 ?? "") && /migrate_egovframe_project/.test(e1) && dry502.compatibility.parentOk === false && dry502.compatibility.warnings.length === 1, "parent 5.0.2 에 rte-ai 명시 → 거부(올리는 방법 안내), dryRun 은 경고로");
    const sample = await addAiComponents({ projectDir: p502, stack: "langchain4j", dryRun: true });
    assert(sample.component.id === "ai-rag-langchain4j", "parent 5.0.2 + auto → 기존 샘플 조립 계획(동작 그대로)");
    const e2 = await threw(() => addAiComponents({ projectDir: project("5.1.0", "", false), stack: "spring-ai" }));
    assert(/@SpringBootApplication/.test(e2 ?? ""), "Boot 애플리케이션 클래스가 없으면 거부");
  }

  // ── 계획·형식 ──
  {
    const d = project("5.1.0", "\n        <dependency>\n            <groupId>org.postgresql</groupId>\n            <artifactId>postgresql</artifactId>\n        </dependency>");
    const before = readFileSync(path.join(d, "pom.xml"), "utf8");
    const all = await addAiComponents({ projectDir: d, stack: "spring-ai", dryRun: true });
    const none = await addAiComponents({ projectDir: d, stack: "langchain4j", formats: [], dryRun: true });
    const pdf = await addAiComponents({ projectDir: d, stack: "langchain4j", formats: ["pdf", "docx"], dryRun: true });
    assert(all.dryRun && all.component.id === AI_RTE_COMPONENT_IDS["spring-ai"] && all.component.vectorStore.includes("PGVector") && all.totalFiles === 4 && all.copyPlan.map((g) => `${g.group}:${g.files}`).join() === "source:3,docs:1" && readFileSync(path.join(d, "pom.xml"), "utf8") === before && !existsSync(path.join(d, AI_DIR)), "dryRun: 계획만(파일 4 = 소스 3 + 문서 1), 아무것도 쓰지 않음");
    const arts = (r) => r.dependencyChanges.toAdd.map((x) => x.split(":")[1]).sort().join();
    assert(arts(all) === "commons-compress,egovframe-rte-ai-springai,hwplib,hwpxlib,pdfbox,poi-ooxml,spring-ai-openai,spring-ai-pgvector-store" && all.dependencyChanges.alreadyPresent.join() === "org.postgresql:postgresql", `spring-ai 기본: 어댑터·모델·저장소 + 파서 5(이미 있는 postgresql 은 빼고) (${arts(all)})`);
    assert(arts(none) === "egovframe-rte-ai-langchain4j,langchain4j-open-ai,langchain4j-pgvector" && arts(pdf) === "commons-compress,egovframe-rte-ai-langchain4j,langchain4j-open-ai,langchain4j-pgvector,pdfbox,poi-ooxml", "formats: [] 이면 파서 없음(Markdown 만), 고른 형식의 라이브러리만");
    assert(/formats/.test((await threw(() => addAiComponents({ projectDir: d, stack: "spring-ai", formats: ["xls"], dryRun: true }))) ?? "") && AI_RTE_FORMATS.join() === "hwp,hwpx,docx,pdf", "모르는 형식 거부");
  }

  // ── 조립·불변식·제거 ──
  for (const stack of ["spring-ai", "langchain4j"]) {
    const d = project("5.1.0");
    const pomBefore = readFileSync(path.join(d, "pom.xml"), "utf8");
    const r = await addAiComponents({ projectDir: d, stack });
    const id = AI_RTE_COMPONENT_IDS[stack];
    const files = readdirSync(path.join(d, AI_DIR)).sort().join();
    const pom = readFileSync(path.join(d, "pom.xml"), "utf8");
    const man = readManifest(d);
    assert(!r.dryRun && r.copiedFiles === 4 && files === "EgovAiConfig.java,EgovAiController.java,EgovAiRagService.java" && existsSync(path.join(d, "EGOV-AI.md")) && readFileSync(path.join(d, AI_POM_BACKUP), "utf8") === pomBefore, `${stack}: 파일 4개 생성(앱 패키지 아래 .ai), pom 백업`);
    assert(pom.includes(`<!-- egovframe-scaffold-mcp:ai:${id}:deps:start -->`) && pom.includes(`<!-- egovframe-scaffold-mcp:ai:${id}:deps:end -->`) && !/<version>/.test(pom.slice(pom.indexOf(":deps:start"), pom.indexOf(":deps:end"))) && pom.indexOf(":deps:end") < pom.lastIndexOf("</dependencies>"), `${stack}: pom 마커 구간에 의존성(버전은 parent 가 관리 — 리터럴 버전 없음)`);
    assert(man.components[id].files.length === 4 && Object.values(man.components[id].hashes).every((h) => /^sha256:[0-9a-f]{64}$/.test(h.hash) && h.hash === h.srcHash) && man.components[id].pom.addedDeps.length === r.dependencyChanges.toAdd.length, `${stack}: 매니페스트(파일·hash·pom 추가분)`);
    const java = ["EgovAiConfig", "EgovAiRagService", "EgovAiController"].map((f) => readFileSync(path.join(d, AI_DIR, `${f}.java`), "utf8"));
    const [cfg, svc, ctl] = java;
    assert(java.every((t) => t.startsWith("package kr.go.sample.ai;") && !t.includes("__PKG__") && !t.includes("egovframework.example")), `${stack}: 패키지 치환`);
    assert(cfg.includes("${EGOV_AI_API_KEY:none}") && cfg.includes("${EGOV_AI_PGVECTOR_PASSWORD:}") && !/apiKey\s*\(\s*"/.test(cfg) && !/setPassword\s*\(\s*"|password\s*=\s*"[^$]/i.test(cfg) && cfg.includes("EgovExtractionBudget.defaults()") && (cfg.match(/@Lazy/g) ?? []).length >= 3, `${stack}: 접속 정보는 환경 변수 자리표시자만(리터럴 없음), 추출 한도 기본값, 모델·저장소는 @Lazy`);
    assert(svc.indexOf("guard.inspect(question)") > 0 && svc.indexOf("guard.inspect(question)") < svc.search(/similaritySearch|\.search\(/) && /EgovPiiMaskingTransformer/.test(svc) && /EgovKoreanSentenceSplitter/.test(svc) && /EgovNormalizingTransformer/.test(svc) && /Egov(VectorStore|EmbeddingStore)Writer/.test(svc) && svc.includes("stableName(fileName)"), `${stack}: 질의는 가드가 검색보다 먼저, 색인은 정규화·청킹·마스킹·재색인 라이터, 임시 파일은 해시 이름`);
    assert(ctl.includes('@RequestMapping("/ai")') && ctl.includes("catch (IllegalArgumentException e)") && ctl.includes("서버 로그를 확인하세요"), `${stack}: 컨트롤러는 JSON 으로 400/500(내부 오류 상세는 로그에만)`);
    const sc = await checkSecureCoding({ projectDir: d });
    assert(sc.findings.length === 0, `${stack}: 생성물 보안약점 0건 (${sc.findings.map((f) => f.rule).join(",")})`);
    // 다시 조립·배타
    assert(/이미 설치/.test((await threw(() => addAiComponents({ projectDir: d, stack }))) ?? "") && /다른 AI 조립물/.test((await threw(() => addAiComponents({ projectDir: d, stack: stack === "spring-ai" ? "langchain4j" : "spring-ai" }))) ?? "") && /다른 AI 조립물/.test((await threw(() => addAiComponents({ projectDir: d, stack, base: "sample", dryRun: true }))) ?? ""), `${stack}: 재조립·다른 스택 거부`);
    // 제거
    await removeComponents({ projectDir: d, components: [id] });
    assert(!existsSync(path.join(d, AI_DIR, "EgovAiConfig.java")) && !existsSync(path.join(d, "EGOV-AI.md")) && readFileSync(path.join(d, "pom.xml"), "utf8") === pomBefore && !existsSync(path.join(d, AI_POM_BACKUP)), `${stack}: remove → 파일 삭제, pom 바이트 원복`);
  }

  // ── 충돌·롤백 ──
  {
    const d = project("5.1.0");
    mkdirSync(path.join(d, AI_DIR), { recursive: true });
    writeFileSync(path.join(d, AI_DIR, "EgovAiConfig.java"), "// 내 파일\n");
    const pomBefore = readFileSync(path.join(d, "pom.xml"), "utf8");
    const e = await threw(() => addAiComponents({ projectDir: d, stack: "spring-ai" }));
    assert(/충돌/.test(e ?? "") && readFileSync(path.join(d, "pom.xml"), "utf8") === pomBefore && readdirSync(path.join(d, AI_DIR)).join() === "EgovAiConfig.java" && readManifest(d) === null, "기존 파일과 충돌하면 아무것도 쓰지 않음");
    for (const fault of ["after-files", "after-pom"]) {
      const f = project("5.1.0");
      const before = readFileSync(path.join(f, "pom.xml"), "utf8");
      const err = await threw(() => addAiComponents({ projectDir: f, stack: "langchain4j", faultInjection: fault }));
      assert(/fault injection/.test(err ?? "") && readFileSync(path.join(f, "pom.xml"), "utf8") === before && !existsSync(path.join(f, AI_DIR)) && !existsSync(path.join(f, "EGOV-AI.md")) && !existsSync(path.join(f, AI_POM_BACKUP)) && readManifest(f) === null, `중간 실패(${fault}) → 작업 전 상태로`);
    }
  }

  // ── 보안약점 AI 규칙 3종 ──
  {
    const rules = loadSecureRules();
    const ai = rules.rules.filter((r) => r.id.startsWith("ai-"));
    assert(ai.map((r) => r.id).join() === "ai-extraction-unlimited,ai-prompt-without-guard,ai-api-key-literal" && ai.every((r) => r.message_en && r.fix_en && r.guideItem_en && r.cwe), "AI 규칙 3종(ko/en·CWE)");
    const d = path.join(root, "sc");
    const w = (rel, t) => { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); };
    const keyLiteral = ["sk", "live", "0123456789abcdef"].join("-"); // 규칙 양성용 값은 실행 중에 만든다
    w("pom.xml", "<project><artifactId>s</artifactId></project>");
    w("src/main/java/a/Bad.java", `package a;\nclass Bad {\n  Object a = EgovTextExtractors.defaults(EgovExtractionBudget.unlimited());\n  Object b = OpenAiApi.builder().apiKey("${keyLiteral}").build();\n  String c(ChatClient chat, String question) { return chat.prompt().user(question).call().content(); }\n  Object d(String q) { return UserMessage.from(q); }\n}\n`);
    w("src/main/java/a/Good.java", 'package a;\nclass Good {\n  EgovPromptInjectionGuard guard;\n  Object a = EgovTextExtractors.defaults(EgovExtractionBudget.defaults());\n  Object b(String key) { return OpenAiApi.builder().apiKey(key).build(); }\n  String c(ChatClient chat, String question) { return chat.prompt().user(question).call().content(); }\n  Object d = chat.prompt().user("고정 문구").call();\n  // EgovExtractionBudget.unlimited()\n}\n');
    const sc = await checkSecureCoding({ projectDir: d, rules: ["ai-extraction-unlimited", "ai-prompt-without-guard", "ai-api-key-literal"] });
    const got = sc.findings.map((f) => `${f.rule}:${f.file.split("/").pop()}:${f.line}`).sort().join(" ");
    assert(got === "ai-api-key-literal:Bad.java:4 ai-extraction-unlimited:Bad.java:3 ai-prompt-without-guard:Bad.java:5 ai-prompt-without-guard:Bad.java:6", `양성 4(한도 해제·키 리터럴·가드 없는 프롬프트 2), 가드가 있는 파일·변수 키·리터럴 문구·주석은 제외 (${got})`);
    assert(sc.findings.find((f) => f.rule === "ai-api-key-literal").severity === "high" && !JSON.stringify(sc.findings.filter((f) => f.rule !== "ai-api-key-literal")).includes(keyLiteral), "키 리터럴은 높음");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`ai-rte FAIL (${n} assertions)`); else console.log(`ai-rte OK (${n} assertions)`);
