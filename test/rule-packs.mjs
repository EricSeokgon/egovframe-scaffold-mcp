// node test/rule-packs.mjs — 기관 규칙 팩(v1.23) 게이트 (오프라인, 플랫폼 중립)
//   팩 없음 = 결과에 rulePacks 없음(기존과 같은 값) · 보안약점/운영/의존성/개인정보의 추가·덮어쓰기·등급 조정·끄기·임계값 · 출처 표시 ·
//   여러 팩의 우선순위(뒤가 이김) · 잘못된 팩 거부(사유 전부) · 파일로 가리킨 절 · 허용 루트 밖 거부 · 환경 변수 · 평가서·포트폴리오 · 규칙 목록·CLI · CI 옵션 · MCP
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadRulePack, loadRulePacks, resolveRulePackPaths, rulePackInfo, listRules, renderRuleListMarkdown, RulePackError, RULE_PACKS_ENV, checkSecureCoding, checkOperations, checkDependencies, checkPrivacy, assessProject, renderAssessmentMarkdown, summarizePortfolio, generateCiConfig, runCli, buildServer, OUTPUT_SCHEMAS, loadSecureRules, loadOperationsRules } from "../dist/index.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const root = mkdtempSync(path.join(tmpdir(), "egov-rule-packs-"));
let k = 0;
const w = (dir, rel, text) => { const f = path.join(dir, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, typeof text === "string" ? text : JSON.stringify(text, null, 2)); };
const pack = (name, body, files = {}) => { const d = path.join(root, `pack${k++}-${name}`); w(d, "rule-pack.json", { schemaVersion: 1, name, version: "2026.11", ...body }); for (const [f, t] of Object.entries(files)) w(d, f, t); return d; };
const reasons = (f) => { try { f(); return null; } catch (e) { return e instanceof RulePackError ? e.problems : [`(다른 오류) ${e.message}`]; } };
const threw = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const savedEnv = process.env[RULE_PACKS_ENV];
delete process.env[RULE_PACKS_ENV];

// 표본 프로젝트: Boot + 사내 금지 라이브러리 + 세션 45분 + 사번 컬럼 + 사내 암호화 호출
const project = () => {
  const d = path.join(root, `proj${k++}`);
  w(d, "pom.xml", `<project>\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>org.egovframe.boot</groupId>\n    <artifactId>egovframe-boot-starter-parent</artifactId>\n    <version>5.0.2</version>\n  </parent>\n  <groupId>kr.go</groupId>\n  <artifactId>sample</artifactId>\n  <version>1.0.0</version>\n  <dependencies>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>com.alibaba</groupId>\n      <artifactId>fastjson</artifactId>\n      <version>1.2.83</version>\n    </dependency>\n    <dependency>\n      <groupId>org.apache.commons</groupId>\n      <artifactId>commons-text</artifactId>\n      <version>1.9</version>\n    </dependency>\n  </dependencies>\n</project>\n`);
  w(d, "src/main/resources/application.properties", "server.servlet.session.timeout=45m\nspring.jpa.open-in-view=true\nserver.servlet.session.cookie.http-only=true\nserver.servlet.session.cookie.secure=true\n");
  w(d, "src/main/java/kr/go/sample/App.java", "package kr.go.sample;\n\n@SpringBootApplication\npublic class App {\n  void run() throws Exception {\n    Runtime.getRuntime().halt(1);\n    try { run(); } catch (Exception e) { e.printStackTrace(); }\n  }\n}\n");
  w(d, "src/main/resources/db/schema.sql", "CREATE TABLE TB_STAFF (\n  STAFF_ID VARCHAR(20) NOT NULL,\n  EMPL_NO VARCHAR(20),\n  IHIDNUM VARCHAR(200),\n  PRIMARY KEY (STAFF_ID)\n);\n");
  w(d, "src/main/resources/mapper/Staff_SQL.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">\n<mapper namespace="staffDAO">\n  <insert id="insertStaff">\n    INSERT INTO TB_STAFF (STAFF_ID, EMPL_NO, IHIDNUM) VALUES (#{staffId}, #{emplNo}, #{ihidnum})\n  </insert>\n</mapper>\n`);
  w(d, "src/main/java/kr/go/sample/StaffDAO.java", "package kr.go.sample;\n\n@Repository(\"staffDAO\")\npublic class StaffDAO extends EgovAbstractMapper {\n  public void insertStaff(StaffVO vo) { insert(\"staffDAO.insertStaff\", vo); }\n}\n");
  w(d, "src/main/java/kr/go/sample/StaffService.java", "package kr.go.sample;\n\n@Service\npublic class StaffService {\n  @Resource(name = \"staffDAO\") private StaffDAO staffDAO;\n  public void add(StaffVO vo) {\n    vo.setIhidnum(OrgCipher.seal(vo.getIhidnum()));\n    staffDAO.insertStaff(vo);\n  }\n}\n");
  return d;
};
const SECURE_RULE = { id: "org-runtime-halt", guideItem: "기관 금지 API(Runtime.halt)", category: "api", cwe: 382, severity: "high", targets: ["java"], pattern: "Runtime\\.getRuntime\\(\\)\\.halt\\(", message: "Runtime.halt 는 종료 훅을 건너뜁니다", fix: "정상 종료 경로를 쓰세요" };
const OPS_RULE = { id: "org-open-in-view", category: "database", severity: "medium", title: "JPA open-in-view 켜짐", check: { kind: "line", targets: ["properties", "yaml"], pattern: "(?i)^\\s*spring\\.jpa\\.open-in-view\\s*[=:]\\s*true", unless: "^\\s*#" }, message: "open-in-view 가 켜져 있습니다", fix: "spring.jpa.open-in-view=false", basis: "기관 표준 3.2" };
const FULL = {
  description: "표본 기관 기준",
  secureCoding: { rules: [SECURE_RULE], severity: { "print-stack-trace": "high" }, disable: ["debug-code"] },
  operations: { rules: [OPS_RULE], thresholds: { "session-timeout": { maxMinutes: 30 } }, disable: ["no-production-profile"] },
  dependencies: { banned: [{ groupId: "com.alibaba", artifactId: "fastjson", reason: "기관 금지 라이브러리", replacement: "com.fasterxml.jackson.core:jackson-databind" }], minimum: [{ groupId: "org.apache.commons", artifactId: "commons-text", version: "1.10.0", reason: "CVE-2022-42889" }] },
  privacy: { items: [{ id: "employee-no", grade: "general", label: "사번", columns: "EMPL_NO|EMP_NO" }], cryptoCalls: ["OrgCipher\\s*\\.\\s*seal"] },
};

try {
  // ── 경로 해석 ──
  assert(resolveRulePackPaths(undefined, "") .length === 0 && resolveRulePackPaths(undefined, ["/a", " /b ", "/a"].join(path.delimiter)).join() === "/a,/b" && resolveRulePackPaths(["/p"], "/env").join() === "/p" && resolveRulePackPaths([], "/env").join() === "/env", "경로: 파라미터가 환경 변수보다 먼저, 구분자·중복·공백 정리");

  const proj = project();
  const P = pack("org-standard", FULL);

  // ── 팩 없음 = 그대로 ──
  const s0 = await checkSecureCoding({ projectDir: proj }), o0 = await checkOperations({ projectDir: proj }), d0 = await checkDependencies({ projectDir: proj }), p0 = checkPrivacy({ projectDir: proj });
  assert([s0, o0, d0, p0].every((r) => !("rulePacks" in r)) && !JSON.stringify([s0.findings, o0.findings, o0.rules, d0.findings, p0.columns]).includes('"source":"org') && s0.rulesVersion.rules === loadSecureRules().rules.length && o0.rulesVersion.rules === loadOperationsRules().rules.length, "팩 없음: 결과에 rulePacks·출처 필드 없음, 규칙 수는 동봉 그대로");

  // ── 로드·지문 ──
  const lp = loadRulePack(P);
  const info = rulePackInfo([lp])[0];
  assert(lp.name === "org-standard" && /^[0-9a-f]{64}$/.test(lp.sha256) && info.sections.join() === "secureCoding,operations,dependencies,privacy" && !("dir" in info) && loadRulePack(P).sha256 === lp.sha256, "로드: 이름·버전·절 목록·sha256(결과에는 경로를 넣지 않음)");
  const crlf = pack("org-standard", {});
  writeFileSync(path.join(crlf, "rule-pack.json"), JSON.stringify({ schemaVersion: 1, name: "org-standard", version: "2026.11", ...FULL }, null, 2).replace(/\n/g, "\r\n"));
  assert(loadRulePack(crlf).sha256 === lp.sha256, "지문은 줄바꿈 방식(CRLF)과 무관");

  // ── 보안약점 ──
  const s1 = await checkSecureCoding({ projectDir: proj, rulePacks: [P] });
  const halt = s1.findings.find((f) => f.rule === "org-runtime-halt"), pst = s1.findings.find((f) => f.rule === "print-stack-trace");
  assert(halt && halt.source === "org-standard" && halt.severity === "high" && halt.file.endsWith("App.java") && halt.line === 6 && s1.byRule.find((r) => r.rule === "org-runtime-halt").source === "org-standard", "보안약점: 팩 규칙의 항목이 출처와 함께(파일·줄)");
  assert(pst && pst.severity === "high" && pst.source === "org-standard" && s0.findings.find((f) => f.rule === "print-stack-trace").severity !== "high" && s1.rulesVersion.rules === s0.rulesVersion.rules + 1 - 1, "보안약점: 등급 조정(print-stack-trace → high), 규칙 수 = 동봉 + 1 − 끈 1");
  assert(await threw(() => checkSecureCoding({ projectDir: proj, rulePacks: [P], rules: ["debug-code"] })) && s1.rulePacks[0].sha256 === lp.sha256 && s1.notes.some((x) => x.includes("org-standard 2026.11") && x.includes("debug-code")) && OUTPUT_SCHEMAS.check_egovframe_secure_coding.safeParse(s1).success, "보안약점: 끈 규칙은 없는 규칙, 결과에 rulePacks(이름·버전·sha256)·끈 규칙 안내, 출력 스키마 통과");

  // ── 운영 점검 ──
  const o1 = await checkOperations({ projectDir: proj, rulePacks: [P] });
  const st0 = o0.rules.find((r) => r.rule === "session-timeout"), st1 = o1.rules.find((r) => r.rule === "session-timeout");
  assert(st0.status === "pass" && st1.status === "fail" && st1.source === "org-standard" && o1.findings.find((f) => f.rule === "session-timeout").source === "org-standard", "운영: 임계값 조정(세션 45분 — 동봉 60분은 통과, 팩 30분은 미달)");
  assert(o1.rules.find((r) => r.rule === "org-open-in-view")?.status === "fail" && o1.findings.find((f) => f.rule === "org-open-in-view").line === 2 && !o1.rules.some((r) => r.rule === "no-production-profile") && o0.rules.some((r) => r.rule === "no-production-profile") && OUTPUT_SCHEMAS.check_egovframe_operations.safeParse(o1).success, "운영: 팩 규칙(line) 추가, 끈 규칙은 점검표에서 빠짐");

  // ── 의존성 ──
  const d1 = await checkDependencies({ projectDir: proj, rulePacks: [P] });
  const fj = d1.findings.find((f) => f.artifactId === "fastjson"), ct = d1.findings.find((f) => f.artifactId === "commons-text"), web = d1.findings.find((f) => f.artifactId === "spring-boot-starter-web");
  assert(fj.status === "replace" && fj.source === "org-standard" && fj.baseline === "com.fasterxml.jackson.core:jackson-databind" && fj.note.includes("기관 금지 라이브러리") && d0.findings.find((f) => f.artifactId === "fastjson").status !== "replace", "의존성: 금지 좌표 → replace(대체 안내·사유·출처)");
  assert(ct.status === "outdated" && ct.baseline === "1.10.0" && ct.source === "org-standard" && ct.note.includes("CVE-2022-42889") && !web.source && d1.summary.replace === d0.summary.replace + 1 && OUTPUT_SCHEMAS.check_egovframe_dependencies.safeParse(d1).success, "의존성: 최소 버전 미만 → outdated, 팩과 무관한 좌표는 그대로, 집계 반영");
  const verOnly = pack("ver-only", { dependencies: { banned: [{ groupId: "com.alibaba", artifactId: "fastjson", versionBelow: "1.2.80", reason: "취약 버전" }] } });
  assert((await checkDependencies({ projectDir: proj, rulePacks: [verOnly] })).findings.find((f) => f.artifactId === "fastjson").source === undefined, "의존성: versionBelow 금지는 그 버전 이상이면 걸리지 않음");

  // ── 개인정보 ──
  const p1 = checkPrivacy({ projectDir: proj, rulePacks: [P] });
  const emp = p1.columns.find((c) => c.column === "EMPL_NO");
  assert(!p0.columns.some((c) => c.column === "EMPL_NO") && emp && emp.item === "employee-no" && emp.label === "사번" && emp.rulePack === "org-standard", "개인정보: 팩 컬럼 사전(사번)으로 찾은 컬럼에 출처");
  assert(p0.findings.some((f) => f.kind === "plaintext-storage" && f.column === "IHIDNUM") && !p1.findings.some((f) => f.column === "IHIDNUM") && OUTPUT_SCHEMAS.check_egovframe_privacy.safeParse(p1).success, "개인정보: 팩 암호화 호출 사전(OrgCipher.seal)이 평문 저장 판정을 해소");

  // ── 여러 팩: 뒤가 이김 ──
  const later = pack("project-override", { secureCoding: { severity: { "org-runtime-halt": "low", "print-stack-trace": "low" } }, operations: { thresholds: { "session-timeout": { maxMinutes: 50 } } } });
  const s2 = await checkSecureCoding({ projectDir: proj, rulePacks: [P, later] }), o2 = await checkOperations({ projectDir: proj, rulePacks: [P, later] });
  assert(s2.findings.find((f) => f.rule === "org-runtime-halt").severity === "low" && s2.findings.find((f) => f.rule === "org-runtime-halt").source === "project-override" && o2.rules.find((r) => r.rule === "session-timeout").status === "pass" && s2.rulePacks.map((x) => x.name).join() === "org-standard,project-override", "여러 팩: 뒤 팩이 이김(등급·임계값), 출처는 마지막으로 정한 팩");
  assert(reasons(() => loadRulePacks([later, P]))?.some((x) => x.includes("org-runtime-halt")) && reasons(() => loadRulePacks([P, crlf]))?.some((x) => x.includes("두 번")), "순서가 바뀌어 없는 규칙을 가리키면 거부, 같은 이름의 팩 두 번도 거부");

  // ── 파일로 가리킨 절 ──
  const split = pack("split", { secureCoding: "secure-coding.json", privacy: "privacy.json" }, { "secure-coding.json": { rules: [SECURE_RULE] }, "privacy.json": { items: FULL.privacy.items } });
  const sp = loadRulePack(split);
  assert(sp.files.join() === "rule-pack.json,secure-coding.json,privacy.json" && sp.secureCoding.rules.length === 1 && sp.privacy.items.length === 1 && sp.sha256 !== lp.sha256, "절을 같은 디렉터리의 JSON 파일로 — 지문은 파일 전부");

  // ── 잘못된 팩 거부 ──
  const bad = pack("bad", {
    secureCoding: { rules: [{ ...SECURE_RULE, pattern: "(unclosed", category: "nope", targets: ["python"] }, { ...SECURE_RULE }, { ...SECURE_RULE, flow: { sink: "exec" } }], severity: { "no-such-rule": "high" }, disable: ["also-missing"] },
    operations: { rules: [{ ...OPS_RULE, check: { kind: "session-timeout" } }, { ...OPS_RULE, id: "Bad Id" }], thresholds: { "debug-log-level": { maxMinutes: 10 }, "session-timeout": { maxMinutes: -1 } } },
    dependencies: { banned: [{ groupId: "a b", reason: "" }], minimum: [{ groupId: "g", artifactId: "a", version: "latest" }] },
    privacy: { items: [{ id: "x", grade: "secret", label: "", columns: "[" }], cryptoCalls: ["("] },
    extra: true,
  });
  const br = reasons(() => loadRulePack(bad)) ?? [];
  const has = (...parts) => br.some((x) => parts.every((p) => x.includes(p)));
  assert(br.length >= 14 && has("secureCoding.rules[0].pattern", "컴파일") && has("secureCoding.rules[0].category") && has("secureCoding.rules[0].targets") && has("secureCoding.rules[1].id", "겹칩니다") && has("secureCoding.rules[2]", "알 수 없는 키", "flow") && has("없는 규칙 id", "no-such-rule") && has("없는 규칙 id", "also-missing"), `잘못된 팩: 사유를 한 번에 전부(${br.length}건) — 정규식·분류·대상·id 중복·허용하지 않는 키·없는 규칙`);
  assert(has("operations.rules[0].check.kind", "알 수 없는 check 종류", "session-timeout") && has("operations.rules[1].id") && has("operations.thresholds.debug-log-level.maxMinutes", "임계값이 있는 동봉 규칙이 아닙니다") && has("operations.thresholds.session-timeout.maxMinutes", "양수") && has("dependencies.banned[0].groupId") && has("dependencies.banned[0].reason") && has("dependencies.minimum[0].version") && has("privacy.items[0].grade") && has("privacy.items[0].columns") && has("privacy.cryptoCalls[0]") && has("알 수 없는 키", "extra"), "잘못된 팩: 알 수 없는 check 종류·임계값·좌표·버전·등급·최상위 키");
  const rs = (body, files) => reasons(() => loadRulePack(pack("x", body, files))) ?? [];
  assert(rs({ schemaVersion: 2, secureCoding: { rules: [SECURE_RULE] } }).some((x) => x.includes("schemaVersion")) && rs({}).some((x) => x.includes("규칙 절이 하나도 없습니다")) && rs({ secureCoding: "../outside.json" }).some((x) => x.includes(".json 파일 이름")) && rs({ secureCoding: "missing.json" }).some((x) => x.includes("읽지 못했습니다")) && reasons(() => loadRulePack(path.join(root, "nope")))?.[0].includes("디렉터리가 없습니다") && reasons(() => { const d = path.join(root, "empty"); mkdirSync(d); loadRulePack(d); })?.[0].includes("rule-pack.json"), "잘못된 팩: schemaVersion·빈 팩·디렉터리 밖 파일·없는 파일·없는 디렉터리·rule-pack.json 없음");
  const badJson = path.join(root, "badjson"); w(badJson, "rule-pack.json", "{ not json");
  assert(reasons(() => loadRulePack(badJson))?.[0].includes("JSON 이 아닙니다") && (await threw(() => checkSecureCoding({ projectDir: proj, rulePacks: [bad] }))) instanceof RulePackError, "JSON 오류는 사유로, 잘못된 팩이면 점검 도구도 실행하지 않고 거부");

  // ── 허용 루트 ──
  {
    const saved = process.env.EGOVFRAME_ALLOWED_ROOTS;
    process.env.EGOVFRAME_ALLOWED_ROOTS = proj;
    const e = await threw(() => checkOperations({ projectDir: proj, rulePacks: [P] }));
    if (saved === undefined) delete process.env.EGOVFRAME_ALLOWED_ROOTS; else process.env.EGOVFRAME_ALLOWED_ROOTS = saved;
    assert(e && e.name === "AllowedRootsError" && /rulePacks/.test(e.message), "허용 루트(EGOVFRAME_ALLOWED_ROOTS) 밖의 팩 경로는 거부");
  }

  // ── 환경 변수 · 평가서 · 포트폴리오 ──
  {
    process.env[RULE_PACKS_ENV] = P;
    const s = await checkSecureCoding({ projectDir: proj });
    const a = await assessProject({ projectDir: proj });
    const md = renderAssessmentMarkdown(a);
    const pf = await summarizePortfolio({ inputs: [proj] });
    delete process.env[RULE_PACKS_ENV];
    const a0 = await assessProject({ projectDir: proj });
    assert(s.findings.some((f) => f.source === "org-standard") && a.rulePacks?.[0].name === "org-standard" && md.includes("규칙 팩: org-standard 2026.11") && a.secureCoding.high === a0.secureCoding.high + 2 && a.dependencies.summary.replace === a0.dependencies.summary.replace + 1 && a0.rulePacks === undefined && !renderAssessmentMarkdown(a0).includes("규칙 팩") && OUTPUT_SCHEMAS.generate_egovframe_report.safeParse({ projectDir: proj, sections: ["assessment"], dryRun: true, written: false, bytes: 1, outputPath: "x.md", assessment: a, notes: [] }).success, "환경 변수로 지정한 팩이 평가서의 네 점검에 함께 적용되고 평가서에 팩 이름·지문");
    assert(pf.rows[0].rulePacks?.join() === "org-standard 2026.11" && pf.notes.some((x) => x.includes("org-standard 2026.11") && x.includes("같은 기준")) && OUTPUT_SCHEMAS.summarize_egovframe_portfolio.safeParse(pf).success, "포트폴리오: 행에 팩 이름, 모든 프로젝트가 같은 기준인지 안내");
    const mixed = await summarizePortfolio({ inputs: [proj, project()], assess: async (dir) => assessProject({ projectDir: dir, rulePacks: dir === proj ? [P] : undefined }) });
    assert(mixed.notes.some((x) => x.includes("규칙 팩이 다릅니다")), "포트폴리오: 프로젝트마다 팩이 다르면 비교 전에 경고");
  }

  // ── 규칙 목록 · CLI ──
  {
    const l0 = listRules(), l1 = listRules({ rulePacks: [P] });
    assert(l0.rulePacks.length === 0 && l0.summary.fromPacks === 0 && l0.summary.total === l0.summary.bundled && l0.notes.some((x) => x.includes(RULE_PACKS_ENV)) && l1.summary.disabled === 2 && l1.rules.find((r) => r.id === "org-runtime-halt").source === "org-standard" && l1.rules.find((r) => r.id === "debug-code").status === "disabled" && l1.rules.find((r) => r.id === "session-timeout").source === "org-standard" && l1.rules.some((r) => r.tool === "dependencies" && r.id === "banned:com.alibaba:fastjson") && l1.rules.some((r) => r.id === "minimum:org.apache.commons:commons-text:1.10.0") && l1.rules.find((r) => r.id === "employee-no").tool === "privacy" && OUTPUT_SCHEMAS.list_egovframe_rules.safeParse(l1).success, `규칙 목록: 동봉 ${l0.summary.total} → 팩 적용 ${l1.summary.total}(팩 ${l1.summary.fromPacks} · 끔 ${l1.summary.disabled}), 규칙마다 출처`);
    const md = renderRuleListMarkdown(l1);
    assert(md.includes("| org-standard | 2026.11 |") && md.indexOf("`org-runtime-halt`") > 0 && md.indexOf("`org-runtime-halt`") < md.indexOf(`\`${loadSecureRules().rules.find((r) => !["print-stack-trace", "debug-code"].includes(r.id)).id}\``) && listRules({ rulePacks: [P], tools: ["operations"] }).rules.every((r) => r.tool === "operations"), "규칙 목록 Markdown: 팩 표·팩이 정한 규칙 먼저, tools 로 좁히기");
    const io = () => { const o = [], e = []; return { o, e, io: { cwd: proj, stdout: (s) => o.push(s), stderr: (s) => e.push(s), env: {} } }; };
    const c1 = io(), c2 = io(), c3 = io(), c4 = io();
    const x1 = await runCli(["rules", "--rule-packs", P, "--json"], c1.io);
    const x2 = await runCli(["rules", "--rule-packs", bad], c2.io);
    const x3 = await runCli(["secure", "--project", ".", "--rule-packs", P, "--fail-on", "high>0"], c3.io);
    const x4 = await runCli(["rules", "--fail-on", "fromPacks>0"], c4.io);
    assert(x1 === 0 && JSON.parse(c1.o.join("")).rulePacks[0].name === "org-standard" && x2 === 3 && c2.e.join("").includes("알 수 없는 check 종류") && x3 === 2 && x4 === 0 && c4.e.join("").includes("규칙 팩 0개"), "CLI: rules(--json·검증 실패는 종료 코드 3 과 사유) · 다른 명령의 --rule-packs");
  }

  // ── 생성 CI ──
  {
    const gh = generateCiConfig({ projectDir: proj, dryRun: true, supplyChain: true, rulePacks: ".egovframe/rule-pack" });
    const gl = generateCiConfig({ projectDir: proj, dryRun: true, platform: "gitlab", supplyChain: true, rulePacks: "/opt/egov/rule-pack" });
    const none = generateCiConfig({ projectDir: proj, dryRun: true, supplyChain: true });
    const e = await threw(async () => generateCiConfig({ projectDir: proj, dryRun: true, supplyChain: true, rulePacks: "../other; rm -rf /" }));
    assert(gh.content.includes("EGOVFRAME_RULE_PACKS: .egovframe/rule-pack") || gh.content.includes('EGOVFRAME_RULE_PACKS: ".egovframe/rule-pack"') || gh.content.includes("EGOVFRAME_RULE_PACKS: '.egovframe/rule-pack'"), "생성 CI(GitHub): 게이트에 EGOVFRAME_RULE_PACKS");
    assert(/EGOVFRAME_RULE_PACKS.*\/opt\/egov\/rule-pack/.test(gl.content) && !none.content.includes("EGOVFRAME_RULE_PACKS") && e && /rulePacks/.test(e.message), "생성 CI(GitLab)·옵션이 없으면 그대로·경로 형식 검증");
  }

  // ── MCP ──
  {
    const tools = buildServer()._registeredTools;
    const t = tools.list_egovframe_rules;
    const withParam = ["check_egovframe_dependencies", "check_egovframe_secure_coding", "check_egovframe_operations", "check_egovframe_privacy", "generate_egovframe_report", "summarize_egovframe_portfolio", "list_egovframe_rules"].filter((nm) => tools[nm].inputSchema.safeParse({ projectDir: "/x", inputs: ["/x"], rulePacks: ["/p"] }).success);
    assert(t && t.annotations.readOnlyHint === true && t.outputSchema && withParam.length === 7 && tools.generate_egovframe_ci.inputSchema.safeParse({ projectDir: "/x", rulePacks: ".egovframe/rule-pack" }).success && !tools.generate_egovframe_ci.inputSchema.safeParse({ projectDir: "/x", rulePacks: "a b" }).success, "MCP: list_egovframe_rules(읽기 전용·outputSchema), rulePacks 파라미터 7개 도구, CI 옵션");
  }
} finally {
  if (savedEnv === undefined) delete process.env[RULE_PACKS_ENV]; else process.env[RULE_PACKS_ENV] = savedEnv;
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`rule-packs FAIL (${n} assertions)`); else console.log(`rule-packs OK (${n} assertions)`);
