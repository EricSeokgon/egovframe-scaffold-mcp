// node test/startup.mjs — 기동 검증(v1.11, 게이트, 오프라인·가짜 runner)
//   로그 분석: 실제 실행에서 받은 고정물(test/fixtures/startup — Boot 3·Tomcat 10.1 성공, DB 접속 거부, 드라이버 없음, 포트 사용 중,
//   매퍼 XML, 설정 누락, 빈 클래스 없음)과 합성 로그(javax·placeholder), 경로 되돌리기, CATALINA_BASE 준비, Tomcat 캐시·sha256 거부,
//   verifyStartup 흐름(Boot 성공·실패·기동 뒤 503 의 DB 원인, Classic war 패키징→Tomcat, 패키징 실패, 시간 초과, 멀티 모듈 거부), MCP·CLI
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const fx = (f) => readFileSync(new URL(`./fixtures/startup/${f}.txt`, import.meta.url), "utf8");
const root = mkdtempSync(path.join(tmpdir(), "egov-startup-test-"));

// ── 로그 분석(실측 고정물) ────────────────────────────
{
  const ok = m.analyzeStartupLog(fx("boot-ok"), "boot");
  assert(ok.started && ok.startedInMs > 0 && !ok.failed && ok.cause === null, `Boot 성공: Started … in ${ok.startedInMs}ms`);
  const tc = m.analyzeStartupLog(fx("tomcat-ok"), "tomcat");
  assert(tc.started && tc.startedInMs > 0 && tc.cause === null, `Tomcat 성공: Server startup in ${tc.startedInMs}ms`);
  const db = m.analyzeStartupLog(fx("boot-db-refused"), "boot", { afterStart: true });
  assert(db.started && db.cause?.kind === "db-connection" && /Connection refused|Communications link failure/.test(db.cause.summary), `기동 뒤 DB 접속 거부(헬스 체크) → db-connection (${db.cause?.summary})`);
  assert(m.analyzeStartupLog(fx("boot-db-refused"), "boot").cause === null, "afterStart 가 아니면 기동 성공 로그의 늦은 오류는 원인으로 보지 않음");
  const dr = m.analyzeStartupLog(fx("boot-driver-missing"), "boot");
  assert(!dr.started && dr.cause?.kind === "driver-missing" && dr.cause.driver === "oracle.jdbc.driver.OracleDriver" && dr.cause.hint.includes("com.oracle.database.jdbc:ojdbc11"), "드라이버 없음 → 좌표 처방");
  const pt = m.analyzeStartupLog(fx("boot-port-in-use"), "boot");
  assert(pt.cause?.kind === "port-in-use" && /Port \d+ was already in use/.test(pt.cause.summary), "포트 사용 중");
  const mx = m.analyzeStartupLog(fx("tomcat-mapper-xml"), "tomcat");
  assert(mx.failed && mx.cause?.kind === "mapper-xml" && mx.cause.resource === "src/main/resources/egovframework/sqlmap/example/mappers/EgovSample_Sample_SQL.xml" && mx.cause.line === 54 && /SAXParseException/.test(mx.cause.summary), "매퍼 XML: 원본 경로·줄·SAX 원인");
  const cf = m.analyzeStartupLog(fx("tomcat-config-missing"), "tomcat");
  assert(cf.cause?.kind === "config-missing" && cf.cause.resource === "egovframework/spring/missing/context-nothing.xml", "설정 누락: import 한 XML");
  const bc = m.analyzeStartupLog(fx("tomcat-bean-class"), "tomcat");
  assert(bc.cause?.kind === "bean-creation" && bc.cause.bean === "leaveaTrace" && bc.cause.resource === "src/main/resources/egovframework/spring/context-common.xml" && /LeaveaTraceMissing/.test(bc.cause.summary), "빈 생성: 바깥 빈(sampleService)이 아니라 실제로 실패한 빈과 정의 파일");
  assert(bc.chain.length > 1 && bc.chain.some((x) => x.startsWith("org.springframework.beans.factory.BeanCreationException")), `예외 사슬 ${bc.chain.length}개`);
}
// ── 합성 로그 ─────────────────────────────────────────
{
  const jx = m.analyzeStartupLog("ERROR Context initialization failed\njava.lang.NoClassDefFoundError: javax/servlet/http/HttpServlet\nCaused by: java.lang.ClassNotFoundException: javax.servlet.http.HttpServlet\n", "tomcat");
  assert(jx.cause?.kind === "javax-namespace" && /migrate_egovframe_project/.test(jx.cause.hint), "javax 네임스페이스 → 전환 처방");
  const ph = m.analyzeStartupLog("APPLICATION FAILED TO START\njava.lang.IllegalArgumentException: Could not resolve placeholder 'Globals.DbType' in value \"${Globals.DbType}\"\n", "boot");
  assert(ph.cause?.kind === "config-missing" && /Globals\.DbType/.test(ph.cause.hint), "placeholder 누락 → 설정 처방");
  const unknownDb = m.analyzeStartupLog("APPLICATION FAILED TO START\nCaused by: java.sql.SQLSyntaxErrorException: Unknown database 'comdb'\nurl=jdbc:mysql://127.0.0.1:3306/comdb\n", "boot");
  assert(unknownDb.cause?.kind === "db-connection" && unknownDb.cause.jdbcUrl === "jdbc:mysql://127.0.0.1:3306/comdb" && /prepare_egovframe_database/.test(unknownDb.cause.hint), "없는 DB → JDBC URL 과 DB 준비 처방");
  assert(m.normalizeResource("/w/egov-startup/webapps/ROOT/WEB-INF/classes/egovframework/x.xml") === "src/main/resources/egovframework/x.xml" && m.normalizeResource("/p/target/classes/egovframework/com/A$B.class") === "src/main/java/egovframework/com/A.java" && m.normalizeResource("/proj/src/main/resources/a.xml", "/proj") === "src/main/resources/a.xml" && m.normalizeResource("C:\\w\\webapps\\ROOT\\WEB-INF\\web.xml") === "src/main/webapp/WEB-INF/web.xml", "배포 사본·빌드 경로 → 프로젝트 경로(Windows 경로 포함)");
}

// ── Tomcat 준비 ──────────────────────────────────────
const fakeTomcat = (dir) => {
  mkdirSync(path.join(dir, "bin"), { recursive: true }); mkdirSync(path.join(dir, "conf"), { recursive: true });
  writeFileSync(path.join(dir, "bin/bootstrap.jar"), ""); writeFileSync(path.join(dir, "bin/tomcat-juli.jar"), "");
  writeFileSync(path.join(dir, "conf/server.xml"), `<Server port="8005" shutdown="SHUTDOWN">\n  <Service name="Catalina">\n    <Connector port="8080" protocol="HTTP/1.1"\n               connectionTimeout="20000"\n               redirectPort="8443" />\n    <Connector protocol="AJP/1.3" address="::1" port="8009" redirectPort="8443" />\n  </Service>\n</Server>\n`);
  writeFileSync(path.join(dir, "conf/logging.properties"), "handlers=x\n");
  writeFileSync(path.join(dir, "RELEASE-NOTES"), "                     Apache Tomcat Version 10.1.61\n");
  return dir;
};
{
  const home = fakeTomcat(path.join(root, "tc-home"));
  writeFileSync(path.join(root, "app.war"), "WAR");
  const base = m.prepareCatalinaBase(home, path.join(root, "app.war"), 18099, path.join(root, "base"));
  const xml = readFileSync(path.join(base, "conf/server.xml"), "utf8");
  assert(xml.includes('<Server port="-1"') && xml.includes('<Connector port="18099" protocol="HTTP/1.1" address="127.0.0.1"') && !xml.includes("AJP") && readFileSync(path.join(base, "webapps/ROOT.war"), "utf8") === "WAR" && existsSync(path.join(base, "logs")), "CATALINA_BASE: HTTP 포트·127.0.0.1·셧다운 포트 끔·AJP 제거·ROOT.war");
  const cache = path.join(root, "cache");
  fakeTomcat(path.join(cache, "tomcat", "apache-tomcat-10.1.61"));
  const hit = await m.ensureTomcat("10.1", { cacheDir: cache, download: async () => { throw new Error("must not download"); } });
  assert(!hit.downloaded && hit.version === "10.1.61", "캐시에 있으면 내려받지 않음");
  const z = new AdmZip(); z.addFile("apache-tomcat-11.0.27/bin/bootstrap.jar", Buffer.from("x"));
  const urls = [];
  let e = ""; try { await m.ensureTomcat("11.0", { cacheDir: cache, download: async (u) => { urls.push(u); return z.toBuffer(); } }); } catch (x) { e = x.message; }
  assert(/sha256 불일치/.test(e) && urls.length === 2 && urls[0].startsWith("https://repo1.maven.org/maven2/org/apache/tomcat/tomcat/11.0.27/") && urls[1].startsWith("https://archive.apache.org/") && !existsSync(path.join(cache, "tomcat", "apache-tomcat-11.0.27")), "sha256 이 다르면 거부(Maven Central → archive.apache.org 순서, 캐시에 남기지 않음)");
}

// ── verifyStartup(가짜 runner) ───────────────────────
let k = 0;
const project = (files) => { const d = path.join(root, `p${k++}`); for (const [rel, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); } return d; };
const BOOT_POM = "<project><parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>5.0.2</version></parent><artifactId>bootapp</artifactId><version>1.0</version><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>";
const WAR_POM = "<project><parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.2</version></parent><artifactId>webapp</artifactId><version>1.0</version><packaging>war</packaging></project>";
// 로그를 내보낸 뒤 신호(abort)가 오면 끝나는 가짜 프로세스
const proc = (log, opt = {}) => async (cmd, o) => {
  o.onData(log);
  if (opt.exit !== undefined) return { exitCode: opt.exit, timedOut: false };
  if (opt.timeout) return { exitCode: null, timedOut: true };
  await new Promise((r) => { if (o.signal?.aborted) r(); else o.signal?.addEventListener("abort", r, { once: true }); });
  return { exitCode: null, timedOut: false, aborted: true };
};
{
  const d = project({ "pom.xml": BOOT_POM, "src/main/resources/application.properties": "server.port=8080\n" });
  const calls = [];
  const ok = await m.verifyStartup({ projectDir: d, port: 18123, platform: "linux", runner: async (c, o) => { calls.push(c); return proc(fx("boot-ok"))(c, o); }, httpProbe: async (u) => (u === "http://127.0.0.1:18123/" ? 200 : 404) });
  assert(ok.success && ok.started && ok.runtime === "boot" && ok.http.status === 200 && !ok.cause && calls[0].args.join(" ") === "-B spring-boot:run -Dspring-boot.run.arguments=--server.port=18123 -Dspring-boot.run.jvmArguments=-Djava.awt.headless=true" && ok.command.startsWith("mvn "), "Boot: spring-boot:run·포트 주입·HTTP 200 → 성공, 프로세스 끝냄");
  const bad = await m.verifyStartup({ projectDir: d, port: 18124, platform: "linux", runner: proc(fx("boot-driver-missing"), { exit: 1 }), httpProbe: async () => 200 });
  assert(!bad.success && bad.cause.kind === "driver-missing" && bad.logTail.length > 0, "Boot 실패: 드라이버 없음");
  const d2 = project({ "pom.xml": BOOT_POM.replace("</dependencies>", "<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-actuator</artifactId></dependency></dependencies>"), "src/main/resources/application.properties": "Globals.DbType=mysql\nGlobals.mysql.Url=jdbc:log4jdbc:mysql://127.0.0.1:3306/sht\n" });
  const late = await m.verifyStartup({ projectDir: d2, port: 18125, platform: "linux", runner: proc(fx("boot-db-refused")), httpProbe: async () => 503 });
  assert(!late.success && late.started && late.url.endsWith("/actuator/health") && late.cause.kind === "db-connection" && late.cause.jdbcUrl === "jdbc:log4jdbc:mysql://127.0.0.1:3306/sht" && late.notes.some((x) => x.includes("503")), "기동 뒤 health 503 → 로그의 DB 원인·설정의 JDBC URL");
  const to = await m.verifyStartup({ projectDir: d, port: 18126, platform: "linux", runner: proc("[INFO] Scanning for projects...\n", { timeout: true }), timeoutMs: 30_000 });
  assert(!to.success && to.cause.kind === "timeout", "시간 초과");
  const bf = await m.verifyStartup({ projectDir: d, port: 18127, platform: "linux", runner: proc("[ERROR] /x/src/main/java/A.java:[3,8] cannot find symbol\n[INFO] BUILD FAILURE\n", { exit: 1 }) });
  assert(!bf.success && bf.cause.kind === "build" && /A\.java/.test(bf.cause.summary), "기동 전 빌드 실패");
  const hp = await m.verifyStartup({ projectDir: d, port: 18128, path: "/login", platform: "linux", runner: proc(fx("boot-ok")), httpProbe: async () => 500 });
  assert(!hp.success && hp.http.url === "http://127.0.0.1:18128/login" && hp.cause.kind === "http-error", "path 지정·HTTP 500 → http-error");
}
{
  const home = fakeTomcat(path.join(root, "tc-home2"));
  const d = project({ "pom.xml": WAR_POM });
  const calls = [];
  const runner = async (c, o) => {
    calls.push(c);
    if (c.args.includes("package")) { mkdirSync(path.join(d, "target"), { recursive: true }); writeFileSync(path.join(d, "target/webapp-1.0.war"), "WAR"); o.onData("[INFO] BUILD SUCCESS\n"); return { exitCode: 0, timedOut: false }; }
    return proc(fx("tomcat-ok"))(c, o);
  };
  const r = await m.verifyStartup({ projectDir: d, port: 18130, platform: "linux", tomcatHome: home, runner, httpProbe: async () => 302 });
  const tcCall = calls[1];
  assert(r.success && r.runtime === "tomcat" && r.tomcat.version === "10.1.61" && r.http.status === 302 && r.build.success === true, "Classic war: 패키징 → Tomcat(ROOT) → HTTP 302 도 기동");
  assert(tcCall.args.at(-3) === "-Djava.awt.headless=true" && tcCall.args.at(-2) === "org.apache.catalina.startup.Bootstrap" && tcCall.args.at(-1) === "start" && tcCall.args.some((a) => a.startsWith("-Dcatalina.base=")) && tcCall.args.some((a) => a === `-Dcatalina.home=${home}`) && !existsSync(tcCall.cwd), "Bootstrap 직접 실행·임시 CATALINA_BASE(끝나면 지움)");
  const pf = await m.verifyStartup({ projectDir: project({ "pom.xml": WAR_POM }), port: 18131, platform: "linux", tomcatHome: home, runner: proc("[ERROR] Failed to execute goal ... BUILD FAILURE\n", { exit: 1 }) });
  assert(!pf.success && pf.cause.kind === "build" && pf.build.success === false, "war 패키징 실패 → build");
  let e = ""; try { await m.verifyStartup({ projectDir: project({ "pom.xml": "<project><modules><module>a</module></modules></project>" }) }); } catch (x) { e = x.message; }
  assert(/모듈 디렉터리를 projectDir 로/.test(e), "멀티 모듈 루트는 거부(모듈을 지정)");
  const md = m.renderStartupMarkdown(r);
  const md2 = m.renderStartupMarkdown(m.analyzeStartupLog ? { ...r, success: false, cause: m.analyzeStartupLog(fx("tomcat-bean-class"), "tomcat").cause, chain: ["a.B: x"] } : r);
  assert(md.includes("✅ 기동") && md2.includes("원인: 빈 생성 실패") && md2.includes("`leaveaTrace`") && md2.includes("처방"), "Markdown");
}

// MCP·CLI
{
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  const tools = (await client.listTools()).tools;
  const t = tools.find((x) => x.name === "verify_egovframe_startup");
  assert(t && t.outputSchema && !t.annotations.readOnlyHint && !t.annotations.destructiveHint && t.annotations.openWorldHint, "MCP: outputSchema·annotations");
  const bad = await client.callTool({ name: "verify_egovframe_startup", arguments: { projectDir: root, path: "no-slash" } });
  assert(bad.isError, "path 는 / 로 시작해야 함(입력 검증)");
  const nb = await client.callTool({ name: "verify_egovframe_startup", arguments: { projectDir: project({ "README.md": "x" }) } });
  assert(nb.isError && /기동할 수 없는 프로젝트/.test(nb.content[0].text), "빌드 파일 없음 → 오류");
  await client.close(); await server.close();
  const io = { cwd: root, env: {}, stdout: () => {}, stderr: () => {} };
  assert(await m.runCli(["startup", "--project", project({ "README.md": "x" })], io) === 3, "CLI startup: 실행할 수 없으면 종료 코드 3");
}

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`startup FAIL (${n} assertions)`); else console.log(`startup OK (${n} assertions)`);
