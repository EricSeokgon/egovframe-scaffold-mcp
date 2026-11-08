// node test/operations.mjs — 운영 준비 점검(v1.15, 게이트, 오프라인)
//   규칙 데이터 정합(출처·조치·영문 필수, id 중복 없음, check 종류), 규칙마다 미달·통과 쌍, 운영 프로파일 선택(prod 만, dev 제외, profile 지정),
//   주석·자리표시자 제외, 예외 파일(사유·검토자), 등급 산식, Markdown, 평가서 「운영 준비」, MCP(읽기 전용·42종)·CLI ops(--fail-on ops:C)
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-ops-"));
let k = 0;
const project = (files) => { const d = path.join(root, `p${k++}`); for (const [rel, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); } return d; };
const WAR_POM = "<project><parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.2</version></parent><artifactId>w</artifactId><version>1</version><packaging>war</packaging></project>";
const BOOT_POM = (extra = "") => `<project><parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>5.0.2</version></parent><artifactId>b</artifactId><version>1</version><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>${extra}</dependencies></project>`;
const status = (r, id) => r.rules.find((x) => x.rule === id).status;
const find = (r, id) => r.findings.filter((f) => f.rule === id);

// ── 규칙 데이터 ──────────────────────────────────────
{
  const rules = m.loadOperationsRules();
  const ids = rules.rules.map((r) => r.id);
  assert(rules.rules.length === 17 && new Set(ids).size === ids.length && rules.sources.length >= 3 && rules.categories.length === 6, `규칙 17종, id 중복 없음, 출처·분류`);
  assert(rules.rules.every((r) => r.title && r.title_en && r.message && r.message_en && r.fix && r.fix_en && r.basis && r.basis_en && ["high", "medium", "low"].includes(r.severity) && rules.categories.some((c) => c.id === r.category) && ["line", "lacks", "pom", "session-timeout", "upload", "profile", "secrets"].includes(r.check.kind)), "규칙마다 제목·설명·조치·근거(ko/en)·심각도·분류·check 종류");
  assert(m.classifyOpsFile("src/main/resources/egovframework/egovProps/globals.properties") === "properties" && m.classifyOpsFile("src/main/webapp/WEB-INF/web.xml") === "web-xml" && m.classifyOpsFile("src/main/resources/log4j2.xml") === "log4j2" && m.classifyOpsFile("src/main/resources/logback-spring.xml") === "logback" && m.classifyOpsFile("pom.xml") === "pom" && m.classifyOpsFile("src/main/resources/application-prod.yml") === "yaml" && m.classifyOpsFile("src/main/resources/egovframework/spring/com/context-datasource.xml") === "xml", "파일 분류");
  assert(m.classifyOpsFile("src/main/resources/egovframework/message/com/message-common.properties") === null && m.classifyOpsFile("src/main/resources/egovframework/mapper/com/cop/bbs/EgovArticle_SQL_mysql.xml") === null && m.classifyOpsFile("src/test/resources/application.properties") === null && m.classifyOpsFile("src/main/resources/egovframework/validator/validator-rules.xml") === null, "메시지 번들·매퍼·테스트·validator 제외");
}

// ── Classic: 미달 전부 ───────────────────────────────
{
  const G = "src/main/resources/egovframework/egovProps/globals.properties";
  const d = project({
    "pom.xml": WAR_POM,
    [G]: "Globals.DbType = hsql\nGlobals.LocalIp = 127.0.0.1\nGlobals.DriverClassName = net.sf.log4jdbc.DriverSpy\nGlobals.Url = jdbc:log4jdbc:mysql://127.0.0.1:3306/pst\nGlobals.Password = pst01\nGlobals.fileUpload.maxRequestSize = 104857600\nGlobals.posblAtchFileSize = 10485760\nGlobals.fileStorePath = ./files\nGlobals.Hsql.AutoInit = true\n# Globals.Debug = true\n",
    "src/main/resources/egovframework/spring/com/context-datasource.xml": '<beans>\n  <bean id="dataSource" class="com.zaxxer.hikari.HikariDataSource">\n    <property name="jdbcUrl" value="${Globals.Url}"/>\n    <!-- <property name="driverClassName" value="net.sf.log4jdbc.DriverSpy"/> -->\n  </bean>\n</beans>\n',
    "src/main/resources/log4j2.xml": '<Configuration>\n  <Appenders>\n    <Console name="console"/>\n  </Appenders>\n  <Loggers>\n    <Logger name="egovframework" level="DEBUG"/>\n    <!-- <Logger name="x" level="TRACE"/> -->\n    <Root level="INFO"/>\n  </Loggers>\n</Configuration>\n',
    "src/main/webapp/WEB-INF/web.xml": '<web-app>\n  <session-config>\n    <session-timeout>120</session-timeout>\n  </session-config>\n</web-app>\n',
    "src/main/resources/egovframework/message/com/message-common.properties": "fail.password=틀림\n",
  });
  const r = await m.checkOperations({ projectDir: d });
  assert(r.runtime === "classic" && r.configSet.profile === null && r.filesScanned === 5, `Classic: 파일 5(메시지 번들 제외) (${r.filesScanned})`);
  for (const id of ["sql-logging-driver", "debug-log-level", "console-only-logging", "embedded-db-in-production", "pool-size-missing", "pool-timeouts-missing", "session-timeout", "cookie-flags", "upload-limits", "upload-path", "error-page-missing", "egov-dev-flags", "hardcoded-secret-config"]) assert(status(r, id) === "fail", `미달: ${id} (${find(r, id).map((f) => `${f.file.split("/").pop()}:${f.line}`).join(",")})`);
  for (const id of ["devtools-dependency", "error-exposure", "actuator-exposure"]) assert(status(r, id) === "pass", `${id}: ${status(r, id)}`);
  assert(status(r, "no-production-profile") === "n/a", "Classic 은 운영 프로파일 규칙 해당 없음");
  assert(find(r, "sql-logging-driver").length === 2 && find(r, "sql-logging-driver").every((f) => f.file === G), "SQL 로깅 드라이버: globals 2줄, XML 주석 안은 제외");
  assert(find(r, "debug-log-level").length === 1 && find(r, "debug-log-level")[0].line === 6, "DEBUG 로거 1(주석 제외)");
  assert(find(r, "session-timeout")[0].code === "<session-timeout>120</session-timeout>" && find(r, "session-timeout")[0].suggestion === "<session-timeout>30</session-timeout>", "세션 120분 → 제안 30");
  assert(find(r, "upload-limits").length === 2 && find(r, "upload-limits").some((f) => /maxRequestSize = 104857600/.test(f.code) && f.suggestion.includes("52428800")) && find(r, "upload-limits").some((f) => /Extensions/.test(f.code)), "업로드: 100MB 상한 + 확장자 없음");
  assert(find(r, "egov-dev-flags").length === 2 && find(r, "hardcoded-secret-config")[0].code.includes("ps***") && !JSON.stringify(r).includes("pst01"), "개발 플래그 2(주석 제외), 비밀값은 가림");
  assert(find(r, "pool-timeouts-missing").length === 1 && find(r, "pool-timeouts-missing")[0].file.endsWith("context-datasource.xml"), "풀 타임아웃: XML 에서 1건(properties 중복 없음)");
  assert(r.grade.grade === "C" && r.summary.fail === 13 && r.summary.pass === 3 && r.summary.na === 1 && r.summary.high === 4, `등급 C(높음 규칙 3·항목 4) · 미달 13 (${r.grade.grade}, ${JSON.stringify(r.summary)})`);
  const md = m.renderOperationsMarkdown(r, 10);
  assert(md.includes("등급 **C**") && md.includes("| SQL 로깅 프록시 드라이버가 운영 설정에 남음 `sql-logging-driver` | high | ⚠️ fail | 2 |") && md.includes("## 미달 항목") && md.includes("→ 제안 `<session-timeout>30</session-timeout>`") && md.includes("건 더(format=json)") && md.includes(".egovframe-ops-ignore.json"), "Markdown: 점검표·미달·제안·topN·예외 안내");
  // 예외 파일
  writeFileSync(path.join(d, ".egovframe-ops-ignore.json"), JSON.stringify({ ignores: [{ rule: "console-only-logging", path: "src/main/resources/log4j2.xml", reason: "컨테이너 표준 출력을 플랫폼이 수집", reviewer: "운영팀" }, { rule: "egov-dev-flags", path: "src/main/resources/", reason: "짧음" }, { rule: "sql-logging-driver", path: G, line: 3, reason: "개발 프로파일로 분리 예정", reviewer: "DBA" }] }));
  const r2 = await m.checkOperations({ projectDir: d });
  assert(status(r2, "console-only-logging") === "pass" && r2.summary.suppressed === 2 && find(r2, "sql-logging-driver").length === 1 && find(r2, "sql-logging-driver")[0].line === 4 && r2.invalidIgnores.length === 1 && r2.ignoreFile === ".egovframe-ops-ignore.json" && r2.grade.grade === "C", "예외 파일: 사유·검토자 있는 항목만(디렉터리 접두어·줄 지정), 규칙 전체 예외면 통과로");
  const r3 = await m.checkOperations({ projectDir: d, rules: ["session-timeout", "cookie-flags"] });
  assert(r3.rules.length === 2 && r3.summary.fail === 2, "rules 로 좁히기");
  let threw = null; try { await m.checkOperations({ projectDir: d, rules: ["nope"] }); } catch (e) { threw = e.message; }
  assert(/알 수 없는 규칙/.test(threw ?? ""), "모르는 규칙은 오류");
  rmSync(d, { recursive: true, force: true });
}

// ── Classic: 통과 ────────────────────────────────────
{
  const d = project({
    "pom.xml": WAR_POM,
    "src/main/resources/egovframework/egovProps/globals.properties": "Globals.DbType = mysql\nGlobals.LocalIp = 10.1.2.3\nGlobals.DriverClassName = com.mysql.cj.jdbc.Driver\nGlobals.Url = jdbc:mysql://db.internal:3306/pst\nGlobals.Password = ${EGOV_PASSWORD}\nGlobals.fileUpload.maxRequestSize = 52428800\nGlobals.posblAtchFileSize = 10485760\nGlobals.fileUpload.Extensions = .gif,.jpg,.pdf\nGlobals.fileStorePath = /data/upload\nGlobals.Hsql.AutoInit = false\n",
    "src/main/resources/egovframework/spring/com/context-datasource.xml": '<beans>\n  <bean id="dataSource" class="com.zaxxer.hikari.HikariDataSource">\n    <property name="maximumPoolSize" value="20"/>\n    <property name="connectionTimeout" value="5000"/>\n    <property name="maxLifetime" value="1200000"/>\n  </bean>\n</beans>\n',
    "src/main/resources/log4j2.xml": '<Configuration>\n  <Appenders>\n    <Console name="console"/>\n    <RollingFile name="file" fileName="/logs/app.log" filePattern="/logs/app-%d.log.gz"/>\n  </Appenders>\n  <Loggers>\n    <Logger name="egovframework" level="INFO"/>\n    <Root level="INFO"/>\n  </Loggers>\n</Configuration>\n',
    "src/main/webapp/WEB-INF/web.xml": '<web-app>\n  <session-config>\n    <session-timeout>30</session-timeout>\n    <cookie-config><http-only>true</http-only><secure>true</secure></cookie-config>\n  </session-config>\n  <error-page><error-code>404</error-code><location>/error.jsp</location></error-page>\n</web-app>\n',
  });
  const r = await m.checkOperations({ projectDir: d });
  assert(r.summary.fail === 0 && r.summary.total === 0 && r.grade.grade === "A" && r.summary.na === 1, `통과 프로젝트: 미달 0 · A (${JSON.stringify(r.rules.filter((x) => x.status === "fail").map((x) => x.rule))})`);
  rmSync(d, { recursive: true, force: true });
}

// ── Boot: 프로파일 ───────────────────────────────────
{
  const files = {
    "pom.xml": BOOT_POM("<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-devtools</artifactId><optional>true</optional></dependency>"),
    "src/main/resources/application.properties": "server.port=8080\nspring.datasource.url=jdbc:log4jdbc:mysql://127.0.0.1:3306/app\nspring.datasource.driver-class-name=net.sf.log4jdbc.DriverSpy\nspring.jpa.show-sql=true\nmanagement.endpoints.web.exposure.include=*\nlogging.level.egovframework=DEBUG\nserver.servlet.session.timeout=3h\n",
    "src/main/resources/application-dev.properties": "spring.h2.console.enabled=true\n",
    "src/main/resources/application-prod.properties": "spring.datasource.url=jdbc:mysql://db:3306/app\nspring.datasource.hikari.maximum-pool-size=20\nspring.datasource.hikari.connection-timeout=5000\nmanagement.endpoints.web.exposure.include=health,info\nserver.error.include-stacktrace=never\nserver.servlet.session.timeout=30m\nspring.servlet.multipart.max-file-size=10MB\n",
    "src/main/resources/logback-spring.xml": '<configuration>\n  <appender name="C" class="ch.qos.logback.core.ConsoleAppender"/>\n  <root level="INFO"><appender-ref ref="C"/></root>\n</configuration>\n',
  };
  const d = project(files);
  const r = await m.checkOperations({ projectDir: d });
  assert(r.runtime === "boot" && r.configSet.profile === "prod" && r.configSet.excludedProfiles.join() === "dev" && r.configSet.properties.length === 2 && !r.findings.some((f) => f.file.includes("application-dev")), "Boot: application + application-prod 가 운영 세트, dev 제외");
  assert(status(r, "devtools-dependency") === "fail" && /optional/.test(find(r, "devtools-dependency")[0].suggestion) && status(r, "console-only-logging") === "fail" && status(r, "no-production-profile") === "pass", "devtools(optional 안내)·콘솔 전용 logback 미달, 운영 프로파일 있음");
  assert(status(r, "sql-logging-driver") === "fail" && find(r, "sql-logging-driver").length === 1 && /driver-class-name/.test(find(r, "sql-logging-driver")[0].code) && status(r, "error-exposure") === "fail" && status(r, "actuator-exposure") === "pass" && status(r, "debug-log-level") === "fail" && status(r, "session-timeout") === "pass", "기본 파일 값 중 prod 가 덮는 키(url·actuator·세션)는 빼고, 덮지 않는 키(driver-class-name·show-sql·DEBUG)는 미달");
  assert(status(r, "pool-size-missing") === "pass" && status(r, "pool-timeouts-missing") === "pass" && status(r, "embedded-db-in-production") === "pass" && status(r, "upload-limits") === "pass", "풀·내장 DB·업로드 통과");
  assert(r.grade.grade === "C", `등급 C(높음 규칙 3: 드라이버·DEBUG·오류 노출) (${r.grade.grade})`);
  const r2 = await m.checkOperations({ projectDir: d, profile: "dev" });
  assert(r2.configSet.profile === "dev" && status(r2, "embedded-db-in-production") === "fail", "profile=dev 지정 → dev 파일이 세트(H2 콘솔 미달)");
  rmSync(d, { recursive: true, force: true });
  const d2 = project({ "pom.xml": BOOT_POM(), "src/main/resources/application.properties": "server.port=8080\n", "src/main/resources/application-local.properties": "x=1\n" });
  const r3 = await m.checkOperations({ projectDir: d2 });
  assert(status(r3, "no-production-profile") === "fail" && /local/.test(find(r3, "no-production-profile")[0].code) && r3.configSet.excludedProfiles.join() === "local" && r3.notes.some((x) => /운영 프로파일을 찾지 못해/.test(x)), "운영 프로파일 없음(local 만) → 미달·안내");
  assert(status(r3, "session-timeout") === "fail" && find(r3, "session-timeout")[0].suggestion === "server.servlet.session.timeout=30m" && status(r3, "upload-limits") === "n/a" && status(r3, "cookie-flags") === "n/a", "Boot 세션 타임아웃 없음 → 제안, egov 키 없으면 업로드·web.xml 없으면 쿠키는 해당 없음");
  rmSync(d2, { recursive: true, force: true });
}

// ── 평가서·MCP·CLI ───────────────────────────────────
{
  const d = project({ "pom.xml": BOOT_POM(), "src/main/resources/application.properties": "server.port=8080\nspring.datasource.url=jdbc:log4jdbc:mysql://127.0.0.1:3306/app\nspring.jpa.show-sql=true\nlogging.level.root=DEBUG\n" });
  const a = await m.assessProject({ projectDir: d, offline: true });
  assert(a.operations && a.operations.grade === "C" && a.operations.failed.some((f) => f.rule === "sql-logging-driver") && a.operations.fail >= 2, `평가서 operations (${JSON.stringify(a.operations).slice(0, 120)})`);
  assert(m.renderAssessmentMarkdown(a).includes("### 운영 준비 점검 (`check_egovframe_operations`)") && m.renderAssessmentMarkdown(a).includes("등급 **C**"), "평가서 Markdown 「운영 준비」절");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  const tools = (await client.listTools()).tools;
  const t = tools.find((x) => x.name === "check_egovframe_operations");
  assert(t && t.annotations.readOnlyHint === true && t.inputSchema.properties.rules.items.enum.length === 17 && t.outputSchema && tools.length >= 42, "MCP: 등록됨, 읽기 전용, 규칙 enum 17, outputSchema");
  const res = await client.callTool({ name: "check_egovframe_operations", arguments: { projectDir: d, format: "json" } });
  assert(!res.isError && res.structuredContent.grade.grade === "C" && res.structuredContent.rules.length === 17, "MCP 호출: 구조화 출력");
  await client.close(); await server.close();
  // CLI
  const io = () => { const out = [], err = []; return { cwd: d, env: {}, stdout: (s) => out.push(s), stderr: (s) => err.push(s), out, err }; };
  const i1 = io();
  const c1 = await m.runCli(["ops", "--project", d, "--json", "--fail-on", "ops:C"], i1);
  assert(c1 === 2 && JSON.parse(i1.out.join("")).grade.grade === "C" && i1.err.join("").includes("운영 준비 C"), `CLI ops --fail-on ops:C → 종료 2 (${c1})`);
  const i2 = io();
  const c2 = await m.runCli(["ops", "--project", d, "--fail-on", "ops:D"], i2);
  assert(c2 === 0 && i2.out.join("").includes("# 운영 준비 점검"), "CLI ops --fail-on ops:D → 0, Markdown");
  const i3 = io();
  const c3 = await m.runCli(["ops", "--project", d, "--fail-on", "high>0"], i3);
  assert(c3 === 2, "CLI ops --fail-on high>0 → 2");
  assert(m.CLI_COMMANDS.ops.tool === "check_egovframe_operations" && m.CLI_COMMANDS.ops.gradeMetrics.join() === "ops", "CLI ops 정의");
  rmSync(d, { recursive: true, force: true });
}

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`operations FAIL (${n} assertions)`); else console.log(`operations OK (${n} assertions)`);
