// node test/crud-paging.mjs — CRUD 목록 페이징(v1.8, 게이트, 오프라인)
//   방언별 SQL(LIMIT/OFFSET·ROWNUM 감싸기), 방언 결정(dialect > Globals.DbType), classic 의 PaginationInfo·<ui:pagination>, boot 의 page·size,
//   페이지 크기 기본값, 범위 제한 코드, 생성물 보안약점 0건, paging 생략 시 v1.7 과 같은 출력(페이징 단어 없음), 거부 경계
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-crud-paging-"));
const DDL = "CREATE TABLE BOARD (ID INT NOT NULL, TITLE VARCHAR(50), WRITER VARCHAR(50), PRIMARY KEY (ID))";
let k = 0;
const project = (globals) => {
  const d = path.join(root, `p${k++}`);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, "pom.xml"), "<project/>");
  if (globals) { mkdirSync(path.join(d, "src/main/resources/egovframework/egovProps"), { recursive: true }); writeFileSync(path.join(d, "src/main/resources/egovframework/egovProps/globals.properties"), globals); }
  return d;
};
const walk = (d, o = {}, base = d) => { for (const e of readdirSync(d)) { const p = path.join(d, e); if (statSync(p).isDirectory()) walk(p, o, base); else o[path.relative(base, p).split(path.sep).join("/")] = readFileSync(p, "utf8"); } return o; };
const gen = (opts, globals) => { const d = project(globals); const r = m.generateCrud({ projectDir: d, basePackage: "x.y", entityName: "Board", ddl: DDL, createDate: "2026-01-01", search: ["TITLE", "WRITER"], ...opts }); return { r, files: walk(d), d }; };
const pick = (files, suffix) => Object.entries(files).find(([p]) => p.endsWith(suffix))?.[1] ?? "";
const listSql = (xml) => xml.slice(xml.indexOf('<select id="selectBoardList"'), xml.indexOf('<select id="selectBoardListTotCnt"'));

// 방언별 SQL
for (const d of ["mysql", "mariadb", "postgresql", "hsql"]) {
  const { r, files } = gen({ paging: true, dialect: d });
  const sql = listSql(pick(files, "_mapper.xml"));
  assert(r.paging?.style === "limit" && /ORDER BY ID\n\s+LIMIT #\{recordCountPerPage\} OFFSET #\{firstIndex\}\n\s+<\/select>/.test(sql) && !/rownum/i.test(sql), `${d}: ORDER BY 뒤 LIMIT/OFFSET`);
}
for (const d of ["oracle", "tibero", "altibase", "cubrid"]) {
  const { r, files } = gen({ paging: true, dialect: d });
  const sql = listSql(pick(files, "_mapper.xml"));
  assert(r.paging?.style === "rownum" && sql.includes("SELECT * FROM ( SELECT rownum rn, TB.* FROM (") && /ORDER BY ID\n\s+\) TB \) Z WHERE rn BETWEEN #\{firstIndex\} \+ 1 AND #\{firstIndex\} \+ #\{recordCountPerPage\}/.test(sql) && !/LIMIT/.test(sql), `${d}: 공통컴포넌트와 같은 ROWNUM 감싸기(정렬 안쪽)`);
}
const cnt = pick(gen({ paging: true, dialect: "oracle" }).files, "_mapper.xml");
assert(/<select id="selectBoardListTotCnt"[\s\S]*?SELECT COUNT\(\*\)[\s\S]*?<bind name="searchKeywordLike"/.test(cnt) && !/rownum|LIMIT/i.test(cnt.slice(cnt.indexOf("selectBoardListTotCnt"))), "건수 쿼리는 페이징 없이 같은 검색 조건");

// 방언 결정: dialect > Globals.DbType(별칭) > 오류
const g1 = gen({ paging: true }, "Globals.DbType = maria\n");
assert(g1.r.paging?.dialect === "mariadb" && g1.r.paging.dialectFrom === "globals", "Globals.DbType=maria → mariadb(설정에서)");
assert(gen({ paging: true, dialect: "oracle" }, "Globals.DbType = mysql\n").r.paging?.dialect === "oracle", "dialect 가 Globals.DbType 보다 우선");
// Globals.DbType 이 없으면 설정 파일의 JDBC URL(한 방언일 때)·Spring 내장 HSQL
const jd = (files) => { const d = project(); for (const [rel, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); } return d; };
assert(m.detectJdbcDialect(jd({ "src/main/resources/application.properties": "spring.datasource.url=jdbc:log4jdbc:oracle:thin:@db:1521:XE\n" })) === "oracle", "JDBC URL(log4jdbc 포함) → oracle");
assert(m.detectJdbcDialect(jd({ "src/main/resources/ctx.xml": `<jdbc:embedded-database id="ds" type="HSQL"/>` })) === "hsql", "Spring 내장 HSQL → hsql");
assert(m.detectJdbcDialect(jd({ "src/main/resources/a.xml": `<!-- <property name="url" value="jdbc:mysql://x/db"/> -->`, "src/main/resources/b.properties": "url=jdbc:cubrid:x:33000:db:::\n" })) === "cubrid", "주석 안 URL 은 보지 않음");
assert(m.detectJdbcDialect(jd({ "src/main/resources/a.properties": "a=jdbc:mysql://x/db\nb=jdbc:oracle:thin:@y:1521:z\n" })) === null, "방언이 둘이면 정하지 않음");
const gj = m.generateCrud({ projectDir: jd({ "src/main/resources/application.yml": "spring:\n  datasource:\n    url: jdbc:postgresql://h/db\n" }), basePackage: "x.y", entityName: "Board", ddl: DDL, paging: true, dryRun: true });
assert(gj.paging?.dialect === "postgresql" && gj.paging.dialectFrom === "jdbc-url", "generateCrud: JDBC URL 로 방언 결정");
let e1 = ""; try { gen({ paging: true }); } catch (e) { e1 = e.message; }
assert(/DB 방언이 필요/.test(e1), "방언을 알 수 없으면 거부");
let e2 = ""; try { gen({ paging: true }, "Globals.DbType = sqlite\n"); } catch (e) { e2 = e.message; }
assert(/알 수 없는 방언: sqlite/.test(e2), "모르는 DbType 거부");
for (const [opts, re, label] of [[{ pageUnit: 5 }, /paging=true 일 때만/, "paging 없이 pageUnit 거부"], [{ paging: true, dialect: "mysql", pageUnit: 0 }, /pageUnit/, "pageUnit 0 거부"], [{ paging: true, dialect: "mysql", pageSize: 21 }, /pageSize/, "pageSize 21 거부"]]) {
  let msg = ""; try { gen(opts); } catch (e) { msg = e.message; }
  assert(re.test(msg), label);
}

// classic: PaginationInfo·범위 제한·JSP
const c = gen({ paging: true, dialect: "mysql", pageUnit: 20, pageSize: 5 });
const ctl = pick(c.files, "web/BoardController.java"), jsp = pick(c.files, "boardList.jsp"), dvo = pick(c.files, "BoardDefaultVO.java");
assert(ctl.includes("import org.egovframe.rte.ptl.mvc.tags.ui.pagination.PaginationInfo;") && ctl.includes("paginationInfo.setTotalRecordCount(totCnt);") && ctl.includes(`model.addAttribute("paginationInfo", paginationInfo);`) && ctl.includes("vo.setFirstIndex(paginationInfo.getFirstRecordIndex());"), "classic: PaginationInfo 로 firstIndex·전체 건수");
assert(ctl.includes("vo.setPageIndex(Math.max(vo.getPageIndex(), 1));") && ctl.includes("vo.setPageUnit(Math.min(Math.max(vo.getPageUnit(), 1), 100));") && ctl.includes("vo.setPageSize(Math.min(Math.max(vo.getPageSize(), 1), 20));"), "classic: 요청 값의 페이지 번호·크기 범위 제한");
assert(jsp.includes(`<%@ taglib prefix="ui" uri="http://egovframework.gov/ctl/ui" %>`) && jsp.includes(`<ui:pagination paginationInfo="\${paginationInfo}" type="text" jsFunction="fn_egov_link_page" />`) && jsp.includes(`<form:hidden path="pageIndex" />`) && jsp.includes(`id="listForm"`) && jsp.includes("function fn_egov_link_page(pageNo)"), "classic JSP: <ui:pagination>·pageIndex hidden·이동 함수");
assert(dvo.includes("private int pageUnit = 20;") && dvo.includes("private int pageSize = 5;") && dvo.includes("private int recordCountPerPage = 20;"), "pageUnit·pageSize 기본값이 DefaultVO 에");
// boot
const b = gen({ paging: true, dialect: "postgresql", profile: "boot", pageUnit: 15 });
const bctl = pick(b.files, "web/BoardController.java");
assert(bctl.includes(`@RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "15") int size`) && bctl.includes("int s = Math.min(Math.max(size, 1), 100);") && bctl.includes(`result.put("totalCount"`) && bctl.includes("vo.setFirstIndex((p - 1) * s);") && bctl.includes("import java.util.LinkedHashMap;") && !bctl.includes("import java.util.List;"), "boot: page·size(1–100)·{content, totalCount, page, size}");

// 생성물 보안약점 0건(SQL·화면)
const sec = await m.checkSecureCoding({ projectDir: c.d });
assert(sec.summary.total === 0, `생성물 보안약점 0건 (${sec.summary.total})`);
const secR = await m.checkSecureCoding({ projectDir: gen({ paging: true, dialect: "oracle" }).d });
assert(secR.summary.total === 0, "ROWNUM 방식도 0건");

// paging 생략: 페이징 흔적 없음(v1.7 과 같은 출력은 별도 대조로 확인 — 여기서는 단어 없음과 기존 기본값)
const plain = gen({});
const all = Object.values(plain.files).join("\n");
assert(!/PaginationInfo|ui:pagination|LIMIT|rownum|pageIndex" \/>/.test(all) && plain.r.paging === undefined && pick(plain.files, "BoardDefaultVO.java").includes("private int pageUnit = 10;"), "paging 생략 → 페이징 코드 없음(기존 출력)");

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`crud-paging FAIL (${n} assertions)`); else console.log(`crud-paging OK (${n} assertions)`);
