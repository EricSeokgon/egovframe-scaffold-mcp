// node test/secure-coding.mjs — 보안약점 점검(v0.44) 오프라인 검증: 규칙마다 양성·음성 픽스처(오탐 방지 사례 포함), 주석 무시,
//   출처(매니페스트 원본·수정본·매니페스트 없음·프로젝트·테스트), 예외 파일(사유·검토자), baseline(JSON·SARIF), SARIF 2.1.0 공식 스키마, 출력 스키마.
import { checkSecureCoding, renderSecureCodingMarkdown, loadSecureRules, compileRulePattern, stripJavaComments, stripMarkupComments, targetOf, toSarif, IGNORE_FILE, OUTPUT_SCHEMAS, SERVER_VERSION } from "../dist/index.js";
import { validateSarif } from "./spec-schemas.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
const sha = (t) => "sha256:" + createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");

// ── 규칙 데이터 ─────────────────────────────────────────
const rules = loadSecureRules();
assert(rules.schemaVersion === 1 && rules.rules.length >= 18 && new Set(rules.rules.map((r) => r.id)).size === rules.rules.length, `규칙 ${rules.rules.length}종, id 중복 없음`);
assert(rules.categories.length === 7 && rules.rules.every((r) => rules.categories.some((c) => c.id === r.category)) && rules.rules.every((r) => r.guideItem && r.cwe > 0 && ["high", "medium", "low"].includes(r.severity) && r.message && r.fix && r.targets.length), "가이드 7개 유형·항목 이름·CWE·등급·조치가 모든 규칙에");
assert(/개발보안 가이드/.test(rules.sources[0].name) && /49개/.test(rules.sources[0].name) && /대체하지 않습니다/.test(rules.disclaimer), "출처(개발보안 가이드 2021, 구현단계 49개)·진단 보조 고지");
let compiles = true; for (const r of rules.rules) for (const p of [r.pattern, r.unless, r.fileHas, r.fileLacks, r.downgrade?.near, r.escalate?.near, r.requireNear?.near].filter(Boolean)) { try { compileRulePattern(p); } catch { compiles = false; } }
assert(compiles && compileRulePattern("(?i)abc").test("ABC") && !compileRulePattern("abc").test("ABC"), "모든 패턴 컴파일·(?i) 는 대소문자 무시 플래그로");

// ── 주석 지우기·대상 판별 ─────────────────────────────────
const jsrc = 'String a = "// not comment"; // MessageDigest.getInstance("MD5")\n/* new Random()\n */ char c = \'"\'; String b = """\n /* keep */ """;';
const js = stripJavaComments(jsrc);
assert(js.split("\n").length === jsrc.split("\n").length && js.includes('"// not comment"') && !js.includes("MD5") && !js.includes("new Random") && js.includes("/* keep */") && js.length === jsrc.length, "Java 주석 제거: 문자열·문자·텍스트 블록 보존, 줄 수·길이 유지");
assert(!stripMarkupComments("<!-- ${x} -->\n<select>").includes("${x}") && stripMarkupComments("<!-- ${param.x} --><%-- ${param.y} --%>", true).includes("${param.x}") && !stripMarkupComments("<%-- ${param.y} --%>", true).includes("param.y"), "XML 은 <!-- --> 제거, JSP 는 <%-- --%> 만 제거(HTML 주석 안 EL 은 실행되어 남김)");
assert(targetOf("a/X.java", "") === "java" && targetOf("a/x.jsp", "") === "jsp" && targetOf("m/A_SQL_mysql.xml", "<mapper namespace=") === "mapper" && targetOf("m/a.xml", "<sqlMap namespace=") === "sqlmap" && targetOf("c/context.xml", "<beans>") === null && targetOf("p/globals.properties", "") === "config" && targetOf("p/message/com/message_ko.properties", "") === null && targetOf("docker-compose.yml", "") === "config", "대상 판별: java·jsp·mapper·sqlmap·config(메시지 번들 제외)");

// ── 픽스처 프로젝트 ──────────────────────────────────────
const proj = mkdtempSync(path.join(tmpdir(), "egovsecure-"));
write(proj, "pom.xml", "<project/>");
const J = "src/main/java/egovframework/example/";
write(proj, `${J}Sql.java`, [
  "class Sql {",
  "  void a(java.sql.Statement st, String id) throws Exception {",
  '    st.executeQuery("SELECT * FROM T WHERE ID = \'" + id + "\'");',          // 3 양성
  '    st.executeQuery("SELECT 1");',                                            // 4 음성
  '    con.prepareStatement("SELECT * FROM T WHERE ID = ?");',                   // 5 음성
  '    // st.executeQuery("x" + id);',                                           // 6 주석 — 음성
  "  }",
  "}",
].join("\n"));
write(proj, `${J}Web.java`, [
  "class Web {",
  "  void a(javax.servlet.http.HttpServletRequest request, javax.servlet.http.HttpServletResponse response) throws Exception {",
  '    java.io.File f = new java.io.File("/data/" + request.getParameter("name"));',   // 3 경로 조작 high
  '    response.sendRedirect(request.getParameter("returnUrl"));',                    // 4 리다이렉트 medium
  '    response.sendRedirect("/main.do");',                                             // 5 음성
  '    Runtime.getRuntime().exec(new String[]{"ls", request.getParameter("dir")});',  // 6 명령 high(escalate)
  '    new ProcessBuilder("df", "-h").start();',                                        // 7 명령 medium
  '    System.out.println("debug");',                                                   // 8 디버그 low
  "    try { x(); } catch (Exception e) { e.printStackTrace(); }",                        // 9 printStackTrace
  "    try { x(); } catch (Exception e) {}",                                              // 10 빈 catch
  "    try { x(); } catch (Exception e) {",                                               // 11 빈 catch(여러 줄, 주석만)
  "      // 무시",
  "    }",
  "    try { x(); } catch (Exception e) { log.error(e); }",                               // 14 음성
  "  }",
  "}",
].join("\n"));
write(proj, `${J}Crypto.java`, [
  "class Crypto {",
  '  java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");',    // 2 weak-hash
  '  java.security.MessageDigest ok = java.security.MessageDigest.getInstance("SHA-256");', // 3 음성
  '  javax.crypto.Cipher c1 = javax.crypto.Cipher.getInstance("DES/CBC/PKCS5Padding");',  // 4 weak-cipher
  '  javax.crypto.Cipher c2 = javax.crypto.Cipher.getInstance("AES");',                    // 5 weak-cipher(ECB 기본)
  '  javax.crypto.Cipher c3 = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");',      // 6 음성
  "  String token() { return String.valueOf(new java.util.Random().nextLong()); }",        // 7 insecure-random(문맥 token)
  "  int dice() {",
  "    int n = 3;",
  "    return n;",
  "  }",
  "  int roll() { return new java.util.Random().nextInt(6); }",                             // 12 음성(보안 문맥 아님)
  "  int a1() { return 1; }",
  "  int a2() { return 2; }",
  "  int a3() { return 3; }",
  '  private static final String DB_PASSWORD = "s3cr3t!pw";',                                // 16 hardcoded-secret high
  '  private static final String PASSWORD_PARAM = "password";',                               // 17 음성(파라미터 이름)
  '  private String password = "${db.password}";',                                           // 18 음성(자리표시자)
  '  private static final String PWD_CHANGE_URL = "/uss/pwd/change.do";',                     // 19 음성(경로)
  "}",
].join("\n"));
write(proj, `${J}Xml.java`, ["class Xml {", "  Object f = javax.xml.parsers.DocumentBuilderFactory.newInstance();", "}"].join("\n"));
write(proj, `${J}XmlSafe.java`, ["class XmlSafe {", "  void a() { var f = javax.xml.parsers.DocumentBuilderFactory.newInstance();", '    f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true); }', "}"].join("\n"));
write(proj, `${J}Cookie1.java`, ["class Cookie1 {", '  Object c = new javax.servlet.http.Cookie("a", "b");', "}"].join("\n"));
write(proj, `${J}Cookie2.java`, ["class Cookie2 {", '  void a() { var c = new jakarta.servlet.http.Cookie("a", "b"); c.setHttpOnly(true); c.setSecure(true); }', "}"].join("\n"));
write(proj, `${J}Deser.java`, ["class Deser {", "  Object a(java.io.InputStream in) throws Exception { return new java.io.ObjectInputStream(in).readObject(); }", "}"].join("\n"));
write(proj, `${J}NotDeser.java`, ["class NotDeser {", "  Object a(Reader r) { return r.readObject(); }", "}"].join("\n"));
const M = "src/main/resources/egovframework/mapper/example/";
write(proj, `${M}Board_SQL_mysql.xml`, [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<mapper namespace="Board">',
  "  <!-- ${searchKeyword} 를 #{searchKeyword} 로 변경 -->",            // 3 주석 — 음성
  "  <select id=\"list\">",
  "    SELECT * FROM BOARD WHERE TITLE LIKE CONCAT('%', ${searchKeyword}, '%')", // 5 high
  "    AND ID = #{id}",                                                      // 6 음성
  "    ORDER BY",
  "      ${sortColumn}",                                                     // 8 medium(정렬)
  "  </select>",
  "</mapper>",
].join("\n"));
write(proj, `${M}Old_SQL.xml`, ['<sqlMap namespace="Old">', "  <select id=\"a\">SELECT * FROM T WHERE NM = '$name$' AND ID = #id#</select>", "</sqlMap>"].join("\n"));
write(proj, "src/main/resources/egovframework/spring/context-common.xml", '<beans><property name="url" value="${Globals.Url}"/></beans>');  // 매퍼 아님 — 음성
const P = "src/main/webapp/WEB-INF/jsp/egovframework/example/";
write(proj, `${P}view.jsp`, [
  '<%@ page contentType="text/html; charset=utf-8" %>',
  '<p><%= request.getParameter("q") %></p>',                                  // 2 high
  '<p>${param.q}</p>',                                                          // 3 high
  '<p><c:out value="${param.q}"/></p>',                                         // 4 음성
  '<c:if test="${!empty param.msg}">alert("<spring:message code="${param.msg}"/>");</c:if>', // 5 음성(태그 속성)
  '<input type="hidden" value="${param.searchKeyword}">',                       // 6 high(HTML 속성은 출력됨)
  '<p>${fn:escapeXml(param.q)}</p>',                                            // 7 음성
  '<c:out value="${fn:replace(result.nttCn, crlf, \'<br/>\')}" escapeXml="false" />', // 8 medium(따옴표 안 > 처리)
  '<c:out value="</tr>" escapeXml="false"/>',                                   // 9 음성(상수)
  "<%-- ${param.q} --%>",                                                       // 10 음성(JSP 주석)
  "<!-- ${param.debug} -->",                                                    // 11 high(HTML 주석 안 EL 은 출력됨)
].join("\n"));
write(proj, "src/main/resources/egovframework/egovProps/globals.properties", [
  "# DB",
  "Globals.mysql.Password = com01",          // 2 medium
  "Globals.oracle.Password = ENC(abcd)",     // 3 음성
  "Globals.ExpirePwdDay = 180",              // 4 음성(숫자)
  "Globals.secret = ******",                 // 5 음성(가림)
  "Sns.naver.clientSecret=YOUR_CLIENT_SECRET", // 6 음성(자리표시자)
  "#Globals.tibero.Password = old",          // 7 음성(주석)
  "Globals.DbType = mysql",                  // 8 음성
].join("\n"));
write(proj, "src/main/resources/egovframework/message/com/message_ko.properties", "comUatUia.password=비밀번호 = abc\nx.password=abcd1234");
write(proj, "docker-compose.yml", "services:\n  db:\n    environment:\n      MYSQL_PASSWORD: pst01\n      MYSQL_ROOT_PASSWORD: ${ROOT_PW}\n");
write(proj, "src/test/java/egovframework/example/SqlTest.java", ["class SqlTest {", '  void a(java.sql.Statement st, String t) throws Exception { st.execute("DELETE FROM " + t); }', '  String password = "testpass";', "}"].join("\n"));
write(proj, "target/classes/Gen.java", 'class Gen { void a() { System.out.println("x"); } }');   // 빌드 산출물 — 제외
write(proj, "node_modules/x/a.jsp", "<%= request.getParameter(\"q\") %>");                      // 제외

const r = await checkSecureCoding({ projectDir: proj });
const at = (file, line) => r.findings.filter((f) => f.file.endsWith(file) && f.line === line);
const one = (file, line, rule, sev) => { const xs = at(file, line).filter((f) => f.rule === rule); return xs.length === 1 && (!sev || xs[0].severity === sev); };
const none = (file, line) => at(file, line).length === 0;
assert(one("Sql.java", 3, "sql-jdbc-concat", "high") && none("Sql.java", 4) && none("Sql.java", 5) && none("Sql.java", 6), "SQL 삽입(JDBC 연결): 양성 1·상수·? 바인딩·주석은 음성");
assert(one("Board_SQL_mysql.xml", 5, "sql-mybatis-dollar", "high") && none("Board_SQL_mysql.xml", 3) && none("Board_SQL_mysql.xml", 6), "SQL 삽입(MyBatis ${}): 양성 high·주석 안 ${}·#{} 음성");
assert(one("Board_SQL_mysql.xml", 8, "sql-mybatis-dollar", "medium") && at("Board_SQL_mysql.xml", 8)[0].note.includes("허용 목록"), "ORDER BY 다음 줄의 ${} 는 medium + 허용 목록 안내");
assert(one("Old_SQL.xml", 2, "sql-ibatis-dollar", "high") && !r.findings.some((f) => f.file.endsWith("context-common.xml")), "iBATIS $name$ 양성, 스프링 설정의 ${Globals…} 는 매퍼가 아니라 음성");
assert(one("view.jsp", 2, "xss-jsp-request", "high") && one("view.jsp", 3, "xss-jsp-el-param", "high") && one("view.jsp", 6, "xss-jsp-el-param") && one("view.jsp", 11, "xss-jsp-el-param"), "XSS: <%= request %>·${param} 본문·HTML 속성·HTML 주석 안 EL 양성");
assert(none("view.jsp", 4) && none("view.jsp", 5) && none("view.jsp", 7) && none("view.jsp", 9) && none("view.jsp", 10), "XSS 음성: <c:out>·커스텀 태그 속성(c:if test·spring:message code)·fn:escapeXml·상수 c:out·JSP 주석");
assert(one("view.jsp", 8, "xss-cout-unescaped", "medium"), "<c:out escapeXml=\"false\">(값 안의 '<br/>' 포함) medium");
assert(one("Web.java", 3, "path-traversal", "high") && one("Web.java", 4, "open-redirect", "medium") && none("Web.java", 5), "경로 조작 high·리다이렉트 medium·고정 경로 음성");
{
  const r0 = await checkSecureCoding({ projectDir: proj, dataFlow: false });
  const w = (ln) => r0.findings.filter((f) => f.file.endsWith("Web.java") && f.line === ln);
  assert(w(6)[0]?.severity === "high" && w(6)[0].note.includes("요청 파라미터") && w(7)[0]?.severity === "medium" && r0.findings.every((f) => !f.flow), "dataFlow=false: v1.4 까지와 같은 패턴 판정(흐름 필드 없음)");
  assert(r0.findings.length === r.findings.length && r0.findings.map((f) => f.fingerprint).sort().join() === r.findings.map((f) => f.fingerprint).sort().join(), "흐름 분석은 지문을 바꾸지 않음(등급·note 만)");
}
// v1.5: 데이터 흐름 — 요청 값이 인자로 들어가면 high(경로를 note·flow 에), 상수만이면 low
assert(one("Web.java", 6, "os-command", "high") && at("Web.java", 6)[0].flow?.status === "tainted" && at("Web.java", 6)[0].note.includes("request.getParameter") && one("Web.java", 7, "os-command", "low") && at("Web.java", 7)[0].flow?.status === "constant", "명령 실행: 요청 값이 들어가면 high(흐름 확인), 상수만이면 low");
assert(one("Web.java", 8, "debug-code", "low") && one("Web.java", 9, "print-stack-trace", "low") && one("Web.java", 10, "empty-catch", "low") && one("Web.java", 11, "empty-catch", "low") && none("Web.java", 14), "디버그 출력·printStackTrace·빈 catch(한 줄·주석만 있는 여러 줄)·로그 처리 음성");
assert(one("Crypto.java", 2, "weak-hash") && none("Crypto.java", 3) && one("Crypto.java", 4, "weak-cipher") && one("Crypto.java", 5, "weak-cipher") && none("Crypto.java", 6), "약한 해시(MD5)·암호(DES·AES 단독=ECB) 양성, SHA-256·AES/GCM 음성");
assert(one("Crypto.java", 7, "insecure-random") && none("Crypto.java", 12), "난수: 보안 문맥(token)만 양성");
assert(one("Crypto.java", 16, "hardcoded-secret", "high") && none("Crypto.java", 17) && none("Crypto.java", 18) && none("Crypto.java", 19), "하드코드 비밀번호 양성, 파라미터 이름·자리표시자·경로 상수 음성");
assert(one("Xml.java", 2, "xxe") && !r.findings.some((f) => f.file.endsWith("XmlSafe.java")), "XXE: 보호 설정 없는 파서만");
assert(one("Cookie1.java", 2, "cookie-flags") && !r.findings.some((f) => f.file.endsWith("Cookie2.java")), "쿠키: HttpOnly·Secure 없는 파일만");
assert(one("Deser.java", 2, "deserialization") && !r.findings.some((f) => f.file.endsWith("NotDeser.java")), "역직렬화: ObjectInputStream 이 있는 파일만");
assert(one("globals.properties", 2, "hardcoded-config-password", "medium") && [3, 4, 5, 6, 7, 8].every((l) => none("globals.properties", l)) && !r.findings.some((f) => f.file.includes("/message/")), "설정 파일 비밀번호: 평문 양성, ENC()·숫자·가림·자리표시자·주석·메시지 번들 음성");
assert(one("docker-compose.yml", 4, "hardcoded-config-password") && none("docker-compose.yml", 5), "docker-compose(yml) 비밀번호 양성·${변수} 음성");
const tf = r.findings.filter((f) => f.file.startsWith("src/test/"));
assert(tf.length === 2 && tf.every((f) => f.severity === "low" && f.origin === "test" && f.note.includes("테스트")), "테스트 코드는 등급 낮음·출처 test");
assert(!r.findings.some((f) => f.file.startsWith("target/") || f.file.startsWith("node_modules/")), "빌드 산출물·node_modules 제외");
assert(r.summary.total === r.findings.length && r.summary.high + r.summary.medium + r.summary.low === r.summary.total && r.summary.high === 10, `요약 일치 — 높음 ${r.summary.high}·중간 ${r.summary.medium}·낮음 ${r.summary.low}`);
assert(r.findings.every((f, i, a) => i === 0 || ({ high: 0, medium: 1, low: 2 })[a[i - 1].severity] <= ({ high: 0, medium: 1, low: 2 })[f.severity]) && r.byRule[0].severity === "high", "등급순 정렬");
assert(r.findings.every((f) => f.origin === "project" || f.origin === "test") && r.summary.new === null && r.summary.suppressed === 0, "출처 project(매니페스트·공통컴포넌트 경로 없음), baseline 없으면 new=null");
assert(OUTPUT_SCHEMAS.check_egovframe_secure_coding.safeParse(r).success, "결과가 outputSchema 통과");
const md = renderSecureCodingMarkdown(r, 5);
assert(md.startsWith("# 보안약점 점검") && md.includes("| SQL 삽입 | `sql-jdbc-concat` | 높음 | 2 |") && md.includes(`외 ${r.findings.length - 5}건`) && md.includes(IGNORE_FILE) && md.includes("대체하지 않습니다"), "Markdown: 항목별 표·상위 N·예외 안내·고지");

// ── 좁히기·옵션 ──────────────────────────────────────────
const only = await checkSecureCoding({ projectDir: proj, rules: ["xxe", "weak-hash"] });
assert(only.byRule.map((b) => b.rule).sort().join() === "weak-hash,xxe" && only.rulesVersion.rules === 2, "rules 로 규칙 좁히기");
const pth = await checkSecureCoding({ projectDir: proj, paths: ["src/main/webapp/"] });
assert(pth.findings.every((f) => f.file.startsWith("src/main/webapp/")) && pth.findings.length > 0, "paths 로 경로 좁히기");
const noTest = await checkSecureCoding({ projectDir: proj, includeTests: false });
assert(noTest.summary.total === r.summary.total - 2 && noTest.byOrigin.test === 0, "includeTests=false 면 src/test 제외");
const trunc = await checkSecureCoding({ projectDir: proj, maxFindings: 3 });
assert(trunc.findings.length === 3 && trunc.truncated && trunc.summary.total === r.summary.total, "maxFindings 는 응답만 자르고 요약은 전체");
let threw = ""; try { await checkSecureCoding({ projectDir: proj, rules: ["nope"] }); } catch (e) { threw = e.message; }
assert(/알 수 없는 규칙: nope/.test(threw), "모르는 규칙 거부");

// ── 출처: 매니페스트 ─────────────────────────────────────
const C = "src/main/java/egovframework/com/cop/bbs/";
const pristine = 'class A { void a() { System.out.println("x"); } }';
write(proj, `${C}A.java`, pristine);
write(proj, `${C}B.java`, 'class B { void a() { System.out.println("changed"); } }');
write(proj, "src/main/java/egovframework/com/uss/C.java", 'class C { void a() { System.out.println("x"); } }');
write(proj, ".egovframe-components.json", JSON.stringify({ schemaVersion: 3, source: {}, components: { bbs: { installedAt: "2026-10-13", files: [`${C}A.java`, `${C}B.java`], hashes: { [`${C}A.java`]: { hash: sha(pristine), srcHash: sha(pristine) }, [`${C}B.java`]: { hash: sha("original"), srcHash: sha("original") } }, sqlScripts: [] } } }));
const ro = await checkSecureCoding({ projectDir: proj, rules: ["debug-code"] });
const of = (f) => ro.findings.find((x) => x.file.endsWith(f));
assert(of("bbs/A.java").origin === "component" && of("bbs/A.java").component === "bbs" && of("bbs/B.java").origin === "component-modified" && of("uss/C.java").origin === "component-unmanaged" && of("Web.java").origin === "project", "출처: 매니페스트 해시 일치=원본·불일치=수정본·공통컴포넌트 경로(매니페스트 없음)·프로젝트");
assert(ro.notes.some((x) => x.includes("공통컴포넌트 원본")) && ro.notes.some((x) => x.includes("reassemble_egovframe_components")), "출처별 안내(업그레이드·예외·upstream / 재조립)");

// ── 예외 파일 ────────────────────────────────────────────
write(proj, IGNORE_FILE, JSON.stringify({ ignores: [
  { rule: "debug-code", path: "src/main/java/egovframework/com/**", reason: "upstream 공통컴포넌트 — 업그레이드 대기", reviewer: "홍길동" },
  { rule: "weak-hash", path: "src/main/java/**/Crypto.java", line: 2, reason: "레거시 호환 해시, 2027 교체", reviewer: "보안 담당" },
  { rule: "sql-jdbc-concat", path: "**/Sql.java", reason: "", reviewer: "x" },
  { rule: "xxe", path: "**/Xml.java", reason: "내부 파일만 읽음" },
] }));
const ig = await checkSecureCoding({ projectDir: proj });
assert(ig.summary.suppressed === 4 && !ig.findings.some((f) => f.rule === "weak-hash") && !ig.findings.some((f) => f.file.includes("/com/") && f.rule === "debug-code"), "예외: glob 경로·라인 지정 적용(4건)");
assert(ig.suppressions.invalid.length === 2 && ig.findings.some((f) => f.rule === "sql-jdbc-concat") && ig.findings.some((f) => f.rule === "xxe") && ig.notes.some((x) => x.includes("사유·검토자가 없어")), "사유·검토자 없는 예외는 적용 안 함(+안내)");
write(proj, IGNORE_FILE, "{broken");
threw = ""; try { await checkSecureCoding({ projectDir: proj }); } catch (e) { threw = e.message; }
assert(/JSON 해석 실패/.test(threw), "깨진 예외 파일은 오류");
rmSync(path.join(proj, IGNORE_FILE));

// ── SARIF·baseline ──────────────────────────────────────
const w = await checkSecureCoding({ projectDir: proj, sarifPath: "reports/egovframe-secure.sarif" });
const sarif = JSON.parse(readFileSync(path.join(proj, "reports/egovframe-secure.sarif"), "utf8"));
assert(w.sarif.written && !w.sarif.overwritten && w.sarif.results === w.summary.total && validateSarif(sarif) === null, `SARIF 2.1.0 기록·OASIS 공식 스키마 통과(결과 ${sarif.runs[0].results.length})`);
const run = sarif.runs[0];
const res0 = run.results.find((x) => x.ruleId === "sql-jdbc-concat");
assert(run.tool.driver.name === "egovframe-scaffold-mcp" && run.tool.driver.version === SERVER_VERSION && run.tool.driver.rules.length === rules.rules.length && run.tool.driver.rules[res0.ruleIndex].id === "sql-jdbc-concat", "SARIF: 도구·규칙 목록·ruleIndex");
assert(res0.level === "error" && res0.locations[0].physicalLocation.artifactLocation.uri.endsWith("Sql.java") && res0.locations[0].physicalLocation.region.startLine === 3 && res0.partialFingerprints["egovframe/v1"] && run.tool.driver.rules[res0.ruleIndex].properties["security-severity"] === "8.0" && run.tool.driver.rules[res0.ruleIndex].properties.tags.includes("external/cwe/cwe-89"), "SARIF 결과: level·위치·지문·security-severity·CWE 태그(code scanning)");
threw = ""; try { await checkSecureCoding({ projectDir: proj, sarifPath: "reports/egovframe-secure.sarif" }); } catch (e) { threw = e.message; }
assert(/이미 있습니다.*overwrite=true/.test(threw), "SARIF 기존 파일은 overwrite 없이 거부");
threw = ""; try { await checkSecureCoding({ projectDir: proj, sarifPath: "../out.sarif" }); } catch (e) { threw = e.message; }
assert(/프로젝트 내부의 상대 경로/.test(threw), "프로젝트 밖 경로 거부");
write(proj, "reports/prev.json", JSON.stringify(r));
// 코드 한 줄을 위로 밀고(줄 이동) 새 보안약점 하나 추가
write(proj, `${J}Sql.java`, readFileSync(path.join(proj, `${J}Sql.java`), "utf8").replace("class Sql {", "// moved\nclass Sql {").replace('st.executeQuery("SELECT 1");', 'st.executeQuery("SELECT 1"); st.executeUpdate("DELETE FROM T WHERE ID=" + id);'));
const b1 = await checkSecureCoding({ projectDir: proj, baselinePath: "reports/prev.json", rules: ["sql-jdbc-concat"] });
assert(b1.summary.new === 1 && b1.findings.filter((f) => f.isNew).length === 1 && b1.findings.find((f) => f.isNew).line === 5 && b1.findings.find((f) => !f.isNew && f.file.endsWith("Sql.java")).line === 4, "baseline(JSON): 줄이 밀려도 같은 항목, 새 항목만 isNew");
const b2 = await checkSecureCoding({ projectDir: proj, baselinePath: "reports/egovframe-secure.sarif", sarifPath: "reports/egovframe-secure.sarif", overwrite: true });
assert(b2.summary.new === 1 && b2.sarif.overwritten && b2.baseline.findings === w.summary.total, "baseline(SARIF partialFingerprints)·같은 파일 덮어쓰기");
const sarif2 = JSON.parse(readFileSync(path.join(proj, "reports/egovframe-secure.sarif"), "utf8"));
assert(validateSarif(sarif2) === null && sarif2.runs[0].results.filter((x) => x.properties.isNew).length === 1, "덮어쓴 SARIF 도 스키마 통과·isNew 속성");
threw = ""; try { await checkSecureCoding({ projectDir: proj, baselinePath: "pom.xml" }); } catch (e) { threw = e.message; }
assert(/JSON 해석 실패|SARIF 가 아닙니다/.test(threw), "baseline 형식 오류 거부");
assert(validateSarif(toSarif({ findings: [] })) === null, "결과 0건 SARIF 도 스키마 통과");

rmSync(proj, { recursive: true, force: true });
if (process.exitCode) console.error(`secure-coding FAIL (${n} assertions)`); else console.log(`secure-coding OK (${n} assertions)`);
