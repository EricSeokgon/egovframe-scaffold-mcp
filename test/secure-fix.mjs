// node test/secure-fix.mjs — 보안약점 자동 조치(v1.7, 게이트, 오프라인)
//   (1) 줄 단위 조치: c:out(줄바꿈 치환·단순 값·본문 필드·식·한 줄 여러 태그), 로거 찾기, printStackTrace·println(정적 문맥)
//   (2) 픽스처 프로젝트: dryRun 무기록 → 적용(백업·계획 파일) → 재점검(고친 항목만 사라짐·다른 규칙 그대로) → 두 번째 실행 0건(멱등)
//       fault-injection 롤백, CRLF 보존, 같은 줄이 여럿인 파일의 일부만 고침, 공통컴포넌트·테스트 제외, HTMLTagFilter
//   (3) 고친 Java 를 로거 스텁과 함께 javac 로 컴파일(javac 가 있을 때), MCP 호출의 outputSchema, CLI fix
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-secfix-"));
const write = (dir, rel, text) => { const p = path.join(dir, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); };
const hashTree = (dir) => { const h = createHash("sha256"); const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else h.update(p).update(readFileSync(p)); } }; walk(dir); return h.digest("hex"); };

// ── (1) 줄 단위 ─────────────────────────────────────────
const cl = (s) => m.fixCoutLine(s);
let r = cl(`<td><c:out value="\${fn:replace(result.nttCn , crlf , '<br/>')}" escapeXml="false" /></td>`);
assert(r.after === `<td><c:out value="\${fn:replace(fn:escapeXml(result.nttCn) , crlf , '<br/>')}" escapeXml="false" /></td>`, `줄바꿈 치환 값은 fn:escapeXml 로 먼저 감쌈(escapeXml="false" 유지) — ${r.after ?? r.manual}`);
r = cl(`<c:out value="\${articleVO.nttSj}" escapeXml="false" />`);
assert(r.after === `<c:out value="\${articleVO.nttSj}" />`, "단순 값 → escapeXml 제거");
r = cl(`<textarea><c:out value='\${vo.vcatnResn}' escapeXml='false'/></textarea>`);
assert(r.after === `<textarea><c:out value='\${vo.vcatnResn}'/></textarea>`, "작은따옴표 속성");
r = cl(`<c:out value="\${result.ntceBgnde} ~ \${result.ntceEndde}" escapeXml="false" />`);
assert(r.after === `<c:out value="\${result.ntceBgnde} ~ \${result.ntceEndde}" />`, "단순 값 둘과 일반 글자");
r = cl(`<c:out value="\${result.nttCn}" escapeXml="false" />`);
assert(r.manual?.includes("nttCn"), "본문 필드(…Cn)는 수동");
r = cl(`<c:out value="\${empty a ? b : c}" escapeXml="false" />`);
assert(r.manual && !r.after, "식은 수동");
r = cl(`<c:out value="\${a.title}" escapeXml="false" /> <c:out value="\${a.memo}" escapeXml="false" />`);
assert(r.manual?.includes("줄 전체"), "한 줄에 고칠 수 없는 태그가 섞이면 줄 전체 수동(항목이 줄 단위)");
r = cl(`<c:out value="\${a.title}" escapeXml="false" /> <c:out value="\${a.name}" escapeXml="false"/>`);
assert(r.after === `<c:out value="\${a.title}" /> <c:out value="\${a.name}"/>`, "한 줄의 여러 태그를 함께");

const SLF = `import org.slf4j.Logger;\nimport org.slf4j.LoggerFactory;\nclass A { private static final Logger LOGGER = LoggerFactory.getLogger(A.class); }`;
assert(JSON.stringify(m.findLogger(SLF)) === JSON.stringify({ name: "LOGGER", isStatic: true, kind: "slf4j" }), "SLF4J static 로거");
assert(m.findLogger(`import org.apache.commons.logging.Log;\nclass A { protected Log log = LogFactory.getLog(getClass()); }`)?.isStatic === false, "Commons Log 인스턴스 로거");
assert(m.findLogger(`import org.apache.logging.log4j.Logger;\nclass A { static Logger logger = LogManager.getLogger(); }`)?.kind === "log4j2", "Log4j 2");
assert(m.findLogger(`import java.util.logging.Logger;\nclass A { static Logger L = Logger.getLogger("a"); }`) === null, "java.util.logging 은 error 가 없어 제외");
assert(m.findLogger(`@Slf4j\nclass A {}`)?.name === "log", "Lombok @Slf4j → log");
const lg = { name: "LOGGER", isStatic: true, kind: "slf4j" }, ilg = { name: "log", isStatic: false, kind: "commons" };
assert(m.fixJavaLine("print-stack-trace", "\t\t\te.printStackTrace();", lg, false).after === "\t\t\tLOGGER.error(e.getMessage(), e);", "printStackTrace → error(메시지, 예외), 들여쓰기 유지");
assert(m.fixJavaLine("debug-code", `    System.out.println("count=" + n); // dbg`, lg, false).after === `    LOGGER.debug("count=" + n); // dbg`, "문자열 println → debug, 줄 끝 주석 유지");
assert(m.fixJavaLine("debug-code", "System.out.println(vo);", lg, false).after === "LOGGER.debug(String.valueOf(vo));", "객체 println → String.valueOf");
assert(m.fixJavaLine("debug-code", "System.err.println(msg);", lg, false).after === "LOGGER.error(String.valueOf(msg));", "System.err → error");
assert(m.fixJavaLine("debug-code", `System.out.printf("%d", n);`, lg, false).manual, "printf 는 수동");
assert(m.fixJavaLine("debug-code", "System.out.println(a, b);", lg, false).manual && m.fixJavaLine("debug-code", "System.out.println(foo(", lg, false).manual, "인자 둘·여러 줄은 수동");
assert(m.fixJavaLine("print-stack-trace", "e.printStackTrace();", null, false).manual?.includes("로거"), "로거가 없으면 수동");
assert(m.fixJavaLine("print-stack-trace", "e.printStackTrace();", ilg, true).manual?.includes("정적"), "정적 문맥의 인스턴스 로거는 수동");
assert(m.fixJavaLine("print-stack-trace", "getCause().printStackTrace();", lg, false).manual, "식의 printStackTrace 는 수동");

// ── (2) 픽스처 프로젝트 ─────────────────────────────────
const proj = path.join(root, "app");
write(proj, "pom.xml", "<project/>");
const JSP = [
  `<%@ taglib prefix="c" uri="jakarta.tags.core" %>`,
  `<%@ taglib prefix="fn" uri="jakarta.tags.functions" %>`,
  `<p><c:out value="\${vo.title}" escapeXml="false" /></p>`,
  `<p><c:out value="\${fn:replace(vo.body , crlf , '<br/>')}" escapeXml="false" /></p>`,
  `<p><c:out value="\${vo.contentsCn}" escapeXml="false" /></p>`,
  `<a href="\${param.url}">x</a>`,
].join("\r\n") + "\r\n";
write(proj, "src/main/webapp/WEB-INF/jsp/board/view.jsp", JSP);
const JAVA = `package x.y;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class BoardService {
  private final Logger log = LoggerFactory.getLogger(BoardService.class);
  private static final String PASSWORD = "secret1234";

  public void a() {
    try { work(); } catch (Exception e) {
      e.printStackTrace();
    }
    System.out.println("done");
  }

  public static void b() {
    try { work(); } catch (Exception e) {
      e.printStackTrace();
    }
  }

  static void work() throws Exception {}
}
`;
write(proj, "src/main/java/x/y/BoardService.java", JAVA);
write(proj, "src/main/java/x/y/Cookies.java", `package x.y;\nimport jakarta.servlet.http.Cookie;\nclass Cookies { Cookie make() { Cookie c = new Cookie("k", "v"); return c; } }\n`);
write(proj, "src/main/java/egovframework/com/cmm/Util.java", `package egovframework.com.cmm;\nclass Util { void a() { System.out.println("x"); } }\n`);
write(proj, "src/test/java/x/y/T.java", `package x.y;\nclass T { void a() { System.out.println("t"); } }\n`);

const before = hashTree(proj);
const allBefore = await m.checkSecureCoding({ projectDir: proj, dataFlow: false });
const dry = await m.fixSecureCoding({ projectDir: proj });
assert(dry.dryRun && hashTree(proj) === before, "dryRun 무기록");
const by = Object.fromEntries(dry.byRule.map((b) => [b.rule, b]));
assert(by["xss-cout-unescaped"].fixed === 2 && by["xss-cout-unescaped"].manual === 1, `c:out 고침 2·수동 1(본문) — ${JSON.stringify(by["xss-cout-unescaped"])}`);
assert(by["print-stack-trace"].fixed === 1 && by["print-stack-trace"].manual === 1, "printStackTrace 고침 1·정적 메서드의 인스턴스 로거 1 수동");
assert(by["debug-code"].fixed === 1 && by["debug-code"].excluded === 2, "println 고침 1 · 공통컴포넌트 경로·테스트 2건 제외");
assert(by["cookie-flags"].manual === 1 && dry.manual.find((x) => x.rule === "cookie-flags")?.suggestion === "c.setHttpOnly(true);\nc.setSecure(true);", "쿠키는 제안만");
assert(dry.verify.ok && dry.verify.removed === 4 && dry.verify.expectedRemoved === 4 && dry.verify.otherRulesUnchanged, `재점검: 고친 4건만 사라지고 다른 규칙 그대로 — ${JSON.stringify(dry.verify)}`);
const jspChange = dry.files.find((f) => f.path.endsWith("view.jsp"));
assert(jspChange?.changes.length === 2 && jspChange.changes.every((c) => !c.after.endsWith("\r")), "변경 줄(줄 끝 CR 은 보존하되 비교 줄에는 넣지 않음)");

const ap = await m.fixSecureCoding({ projectDir: proj, dryRun: false });
const jsp = readFileSync(path.join(proj, "src/main/webapp/WEB-INF/jsp/board/view.jsp"), "utf8");
assert(!ap.dryRun && jsp.includes(`<c:out value="\${vo.title}" /></p>\r\n`) && jsp.includes("fn:escapeXml(vo.body)") && jsp.split("\r\n").length === JSP.split("\r\n").length, "적용: JSP 고침, CRLF 유지");
const java = readFileSync(path.join(proj, "src/main/java/x/y/BoardService.java"), "utf8");
assert(java.includes("      log.error(e.getMessage(), e);") && java.includes(`    log.debug("done");`) && java.split("e.printStackTrace();").length === 2, "적용: Java 로거로, 정적 메서드는 그대로");
assert(existsSync(ap.backupDir) && existsSync(ap.planPath) && readFileSync(path.join(ap.backupDir, "src/main/java/x/y/BoardService.java"), "utf8") === JAVA, "백업(원본)·계획 파일");
const allAfter = await m.checkSecureCoding({ projectDir: proj, dataFlow: false });
const keyset = (r, rules) => r.findings.filter((f) => rules.includes(f.rule)).map((f) => f.fingerprint).sort().join();
const others = allBefore.byRule.map((b) => b.rule).filter((x) => !m.FIXABLE_RULES.includes(x));
assert(others.length > 0 && keyset(allBefore, others) === keyset(allAfter, others), `다른 규칙(${others.join(", ")}) 지문 그대로`);
assert(allAfter.summary.total === allBefore.summary.total - 4, `프로젝트 전체 ${allBefore.summary.total} → ${allAfter.summary.total}`);
const again = await m.fixSecureCoding({ projectDir: proj });
assert(again.summary.fixed === 0 && again.files.length === 0, "두 번째 실행 고칠 것 0(멱등)");

// fault-injection 롤백
const proj2 = path.join(root, "app2");
write(proj2, "pom.xml", "<project/>");
write(proj2, "src/main/webapp/a.jsp", JSP);
const h2 = hashTree(proj2);
let fault = null;
try { await m.fixSecureCoding({ projectDir: proj2, dryRun: false, faultInjection: "after-files" }); } catch (e) { fault = e; }
assert(fault && /fault injection/.test(fault.message) && hashTree(proj2) === h2, "fault-injection: 작업 전 상태로 롤백(백업 포함 새 파일 없음)");

// 같은 줄이 여럿: 일부만 고쳐도(순번 변화) 재점검이 맞음
const proj3 = path.join(root, "app3");
write(proj3, "src/main/java/x/Dup.java", `package x;\nimport org.slf4j.Logger;\nclass Dup {\n  private final Logger log = null;\n  static void s() { try { } catch (Exception e) {\n    e.printStackTrace();\n  } }\n  void i() { try { } catch (Exception e) {\n    e.printStackTrace();\n  } }\n}\n`);
const d3 = await m.fixSecureCoding({ projectDir: proj3 });
assert(d3.summary.fixed === 1 && d3.summary.manual === 1 && d3.verify.ok, `같은 줄 둘 중 하나만 고쳐도 재점검 일치 — ${JSON.stringify(d3.verify)}`);

// includeComponents
const comp = await m.fixSecureCoding({ projectDir: proj, includeComponents: true, rules: ["debug-code"] });
assert(comp.byRule[0].fixed === 0 && comp.manual.some((x) => x.file.includes("egovframework/com") && x.reason.includes("로거")), "includeComponents: 공통컴포넌트 경로도 대상(로거 없으면 수동)");

// HTMLTagFilter
const proj4 = path.join(root, "app4");
write(proj4, "src/main/webapp/WEB-INF/web.xml", `<web-app><filter><filter-name>htmlTagFilter</filter-name><filter-class>egovframework.com.cmm.filter.HTMLTagFilter</filter-class></filter></web-app>`);
write(proj4, "src/main/webapp/WEB-INF/jsp/a.jsp", `<c:out value="\${vo.title}" escapeXml="false" />\n`);
const chk4 = await m.checkSecureCoding({ projectDir: proj4 });
const f4 = chk4.findings.find((f) => f.rule === "xss-cout-unescaped");
assert(chk4.htmlTagFilter === "src/main/webapp/WEB-INF/web.xml" && f4?.severity === "low" && f4.note?.includes("HTMLTagFilter"), "점검: HTMLTagFilter 가 있으면 c:out 은 낮음 + 사유");
const fx4 = await m.fixSecureCoding({ projectDir: proj4 });
assert(fx4.summary.fixed === 0 && fx4.manual[0]?.reason.includes("HTMLTagFilter") && fx4.htmlTagFilter, "조치: HTMLTagFilter 가 있으면 c:out 은 수동");
const fx4b = await m.fixSecureCoding({ projectDir: proj4, ignoreHtmlTagFilter: true });
assert(fx4b.summary.fixed === 1 && fx4b.notes.some((x) => x.includes("ignoreHtmlTagFilter")), "ignoreHtmlTagFilter=true 면 고침(필터 제거 안내)");
const commented = path.join(root, "app5");
write(commented, "src/main/webapp/WEB-INF/web.xml", `<web-app><!-- <filter-class>egovframework.com.cmm.filter.HTMLTagFilter</filter-class> --></web-app>`);
assert(m.findHtmlTagFilter(commented) === null, "주석 처리된 필터는 등록이 아님");

// ── (3) 컴파일·MCP·CLI ──────────────────────────────────
const javac = spawnSync(process.platform === "win32" ? "javac.exe" : "javac", ["-version"], { encoding: "utf8" });
if (javac.status === 0) {
  const stub = path.join(root, "stub");
  write(stub, "org/slf4j/Logger.java", "package org.slf4j;\npublic interface Logger { void debug(String m); void error(String m); void error(String m, Throwable t); }\n");
  write(stub, "org/slf4j/LoggerFactory.java", "package org.slf4j;\npublic class LoggerFactory { public static Logger getLogger(Class<?> c) { return null; } }\n");
  const out = path.join(root, "classes");
  const c = spawnSync(process.platform === "win32" ? "javac.exe" : "javac", ["-d", out, path.join(stub, "org/slf4j/Logger.java"), path.join(stub, "org/slf4j/LoggerFactory.java"), path.join(proj, "src/main/java/x/y/BoardService.java")], { encoding: "utf8" });
  assert(c.status === 0, `고친 Java 를 javac 로 컴파일${c.status === 0 ? "" : `: ${c.stderr}`}`);
} else console.log("skip: javac 없음");

const server = m.buildServer();
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "t", version: "0" });
await server.connect(st); await client.connect(ct);
const call = await client.callTool({ name: "fix_egovframe_secure_coding", arguments: { projectDir: proj3, format: "json" } });
assert(!call.isError && call.structuredContent?.summary?.fixed === 1 && call.structuredContent.dryRun === true, "MCP 호출: outputSchema 통과·기본 dryRun");
const bad = await client.callTool({ name: "fix_egovframe_secure_coding", arguments: { projectDir: proj3, rules: ["sql-mybatis-dollar"] } });
assert(bad.isError, "조치가 없는 규칙은 입력 검증에서 거부");
await client.close(); await server.close();

const io = () => { const o = [], e = []; return { cwd: proj3, env: {}, stdout: (s) => o.push(s), stderr: (s) => e.push(s), o, e }; };
const i1 = io();
assert(await m.runCli(["fix", "--project", proj3], i1) === 0 && i1.e.join("").includes("조치 계획") && readFileSync(path.join(proj3, "src/main/java/x/Dup.java"), "utf8").includes("    e.printStackTrace();\n  } }\n}"), "CLI fix: 기본은 계획만");
const i2 = io();
assert(await m.runCli(["fix", "--project", proj3, "--write", "--fail-on", "manual"], i2) === 2 && readFileSync(path.join(proj3, "src/main/java/x/Dup.java"), "utf8").includes("log.error(e.getMessage(), e);"), "CLI fix --write: 고치고, 수동 항목이 남으면 --fail-on manual 로 2");

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`secure-fix FAIL (${n} assertions)`); else console.log(`secure-fix OK (${n} assertions)`);
