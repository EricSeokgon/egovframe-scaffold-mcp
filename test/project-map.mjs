// node test/project-map.mjs — 프로젝트 구조 지도·변경 영향(v1.14, 게이트, 오프라인)
//   SQL 테이블 추출(FROM·JOIN·INTO·UPDATE·서브쿼리·${} 미해석·키워드 제외), 픽스처 프로젝트(표준프레임워크 규약 DAO + Boot Mapper 인터페이스 + 공통컴포넌트 경로)의
//   노드·간선 기대값, impact 세 방향(테이블 위로·URL 아래로+링크 화면 한 단계·클래스 양쪽), 고아(매퍼·문장·Controller), 미참조 컴포넌트 테이블, 인수인계 표 3종,
//   Mermaid(범위 제한), CRUD 생성물(classic·boot)이 테이블 → URL 까지 끊김 없음, 멀티 모듈 표시, 납품 패키지 map 항목, 진단 요약 줄, MCP·CLI
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-map-"));
let k = 0;
const project = (files) => { const d = path.join(root, `p${k++}`); for (const [rel, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); } return d; };

// ── tablesInSql ──────────────────────────────────────
{
  const t = (sql) => m.tablesInSql(sql);
  assert(t("SELECT A.X FROM COMTNBBS A LEFT OUTER JOIN COMTNBBSMASTER B ON A.BBS_ID = B.BBS_ID WHERE A.X IN (SELECT Y FROM COMTNFILE)").tables.join() === "COMTNBBS,COMTNBBSMASTER,COMTNFILE", "FROM·JOIN·서브쿼리 FROM");
  assert(t("INSERT INTO COMTNBBS (A) VALUES (#{a})").tables.join() === "COMTNBBS" && t("UPDATE COMTNBBS SET A = 1").tables.join() === "COMTNBBS" && t("DELETE FROM COMTNBBS WHERE 1=1").tables.join() === "COMTNBBS", "INTO·UPDATE·DELETE FROM");
  assert(t("SELECT * FROM (SELECT * FROM COMTNBBS) T").tables.join() === "COMTNBBS", "괄호 서브쿼리는 건너뜀");
  const dyn = t("SELECT * FROM ${tableName} WHERE X = #{x}");
  assert(dyn.tables.length === 0 && dyn.unresolved === 1, "${} 테이블 이름은 미해석");
  assert(t("SELECT SYSDATE FROM DUAL").tables.length === 0 && t("SELECT * FROM COMTNBBS A, COMTNBBSMASTER B WHERE A.ID=B.ID").tables.join() === "COMTNBBS,COMTNBBSMASTER" && t("SELECT * FROM SCHEMA1.COMTNBBS FOR UPDATE WAIT 5").tables.join() === "COMTNBBS", "DUAL 제외·쉼표 조인·스키마 접두어·WAIT 키워드");
  assert(t("<![CDATA[ SELECT * FROM COMTNBBS WHERE A < 3 ]]> <if test=\"x\"> AND B = 1 </if>").tables.join() === "COMTNBBS", "CDATA·동적 태그 안");
}

// ── 픽스처 프로젝트 ─────────────────────────────────
const J = "src/main/java/egovframework/com/cop/bbs/", X = "src/main/resources/egovframework/mapper/com/cop/bbs/", V = "src/main/webapp/WEB-INF/jsp/egovframework/com/cop/bbs/";
const MAPPER = (db) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">\n<mapper namespace="BBSArticle">\n  <select id="selectArticleList" resultType="map">\n    SELECT A.* FROM COMTNBBS A LEFT JOIN COMTNBBSMASTER B ON A.BBS_ID = B.BBS_ID ${db === "oracle" ? "WHERE ROWNUM < 10" : "LIMIT 10"}\n  </select>\n  <insert id="insertArticle">\n    INSERT INTO COMTNBBS (NTT_ID) VALUES (#{nttId})\n  </insert>\n  <update id="updateArticle">UPDATE COMTNBBS SET X = 1</update>\n  <select id="selectDynamic" resultType="map">SELECT * FROM \${tbl}</select>\n  <select id="selectNeverCalled" resultType="map">SELECT * FROM COMTNBBSUSE</select>\n</mapper>\n`;
const FIX = {
  "pom.xml": "<project><artifactId>fx</artifactId><version>1</version><packaging>war</packaging></project>",
  [`${X}EgovArticle_SQL_mysql.xml`]: MAPPER("mysql"),
  [`${X}EgovArticle_SQL_oracle.xml`]: MAPPER("oracle"),
  [`${X}Orphan_SQL_mysql.xml`]: '<mapper namespace="OrphanMapper"><select id="s" resultType="map">SELECT * FROM COMTNORPHAN</select></mapper>',
  [`${J}service/impl/EgovArticleDAO.java`]: 'package egovframework.com.cop.bbs.service.impl;\n@Repository("EgovArticleDAO")\npublic class EgovArticleDAO extends EgovComAbstractDAO {\n  public List<?> selectArticleList(BoardVO vo) { return selectList("BBSArticle.selectArticleList", vo); }\n  public void insertArticle(Board b) { insert("BBSArticle.insertArticle", b); }\n  public void updateArticle(Board b) { update("BBSArticle.updateArticle", b); }\n  public List<?> dyn(Map m) { return selectList("BBSArticle.selectDynamic", m); }\n}\n',
  [`${J}service/EgovArticleService.java`]: "package egovframework.com.cop.bbs.service;\npublic interface EgovArticleService { List<?> selectArticleList(BoardVO vo); }\n",
  [`${J}service/impl/EgovArticleServiceImpl.java`]: 'package egovframework.com.cop.bbs.service.impl;\n@Service("EgovArticleService")\npublic class EgovArticleServiceImpl extends EgovAbstractServiceImpl implements EgovArticleService {\n  @Resource(name = "EgovArticleDAO")\n  private EgovArticleDAO egovArticleDao;\n  public List<?> selectArticleList(BoardVO vo) { return egovArticleDao.selectArticleList(vo); }\n}\n',
  [`${J}web/EgovArticleController.java`]: 'package egovframework.com.cop.bbs.web;\n@Controller\npublic class EgovArticleController {\n  @Resource(name = "EgovArticleService")\n  private EgovArticleService egovArticleService;\n  /* @RequestMapping("/commented/out.do") */\n  @RequestMapping("/cop/bbs/selectArticleList.do")\n  public String selectArticleList(ModelMap model) {\n    if (x) return "redirect:/uat/uia/egovLoginUsr.do";\n    return "egovframework/com/cop/bbs/EgovArticleList";\n  }\n  @RequestMapping(value = "/cop/bbs/insertArticle.do", method = RequestMethod.POST)\n  public String insertArticle() { return "forward:/cop/bbs/selectArticleList.do"; }\n  @RequestMapping("/cop/bbs/missingView.do")\n  public ModelAndView missing() { return new ModelAndView("egovframework/com/cop/bbs/NoSuchJsp"); }\n}\n',
  [`${J}web/EgovNoUrlController.java`]: "package egovframework.com.cop.bbs.web;\n@Controller\npublic class EgovNoUrlController { public String x() { return \"ab\"; } }\n",
  [`${V}EgovArticleList.jsp`]: '<%@ page %>\n<%-- <a href="/cop/bbs/commented.do"> --%>\n<form action="<c:url value=\'/cop/bbs/insertArticle.do\'/>">\n<a href="<c:url value=\'/cop/bbs/selectArticleList.do\'/>">list</a>\n<link href="/css/a.css"/>\n',
  [`${V}EgovStandalone.jsp`]: "<%@ page %>\n<p>no links</p>\n",
  // Boot 스타일 Mapper 인터페이스(다른 패키지, 프로젝트 코드)
  "src/main/java/egovframework/example/sample/service/impl/SampleMapper.java": "package egovframework.example.sample.service.impl;\n@Mapper\npublic interface SampleMapper { List<?> selectSampleList(SampleVO vo); }\n",
  "src/main/java/egovframework/example/sample/service/impl/SampleServiceImpl.java": "package egovframework.example.sample.service.impl;\n@Service\npublic class SampleServiceImpl implements SampleService {\n  private final SampleMapper sampleMapper;\n  public SampleServiceImpl(SampleMapper sampleMapper) { this.sampleMapper = sampleMapper; }\n}\n",
  "src/main/java/egovframework/example/sample/service/SampleService.java": "package egovframework.example.sample.service;\npublic interface SampleService {}\n",
  "src/main/java/egovframework/example/sample/web/SampleController.java": "package egovframework.example.sample.web;\n@RestController\n@RequestMapping(\"/api/sample\")\npublic class SampleController {\n  @Autowired\n  private SampleService sampleService;\n  @GetMapping\n  public List<?> list() { return null; }\n  @GetMapping(\"/{id}\")\n  public Object one() { return null; }\n}\n",
  "src/main/resources/egovframework/sqlmap/example/mappers/EgovSample_Sample_SQL.xml": '<mapper namespace="egovframework.example.sample.service.impl.SampleMapper"><select id="selectSampleList" resultType="map">SELECT * FROM SAMPLE</select></mapper>',
  "src/main/resources/templates/thymeleaf/sample/egovSampleList.html": '<html><a th:href="@{/api/sample}">x</a><script th:src="@{/js/a.js}"></script></html>',
  "src/test/java/egovframework/Ignored.java": "package egovframework;\n@Controller public class Ignored { @RequestMapping(\"/test/only.do\") public String a() { return \"x/y\"; } }\n",
};
{
  const d = project(FIX);
  const r = m.buildProjectMap({ projectDir: d });
  const node = (id) => r.nodes.find((x) => x.id === id);
  const edge = (from, to, kind) => r.edges.find((e) => e.from === from && e.to === to && (!kind || e.kind === kind));
  assert(r.summary.files.java === 9 && r.summary.files.mapperXml === 4 && r.summary.files.views === 3 && r.summary.mappers === 3 && r.summary.statements === 7, `파일·매퍼(DB 사본 2 → 네임스페이스 1)·문장(중복 제거) (${JSON.stringify(r.summary.files)}, 매퍼 ${r.summary.mappers}, 문장 ${r.summary.statements})`);
  assert(node("mapper:BBSArticle").files.length === 2 && node("mapper:BBSArticle").component === "bbs" && node("mapper:BBSArticle").count === 5, "매퍼 노드: 파일 2(DB 사본), 컴포넌트 bbs, 문장 5");
  assert(r.summary.tables === 5 && edge("mapper:BBSArticle", "table:COMTNBBS", "reads").detail === "selectArticleList" && edge("mapper:BBSArticle", "table:COMTNBBS", "writes").detail === "insertArticle,updateArticle" && edge("mapper:BBSArticle", "table:COMTNBBSMASTER", "reads"), "테이블 간선: reads/writes 에 문장 id");
  assert(r.summary.unresolvedStatements === 1 && r.statements.find((s) => s.id === "selectDynamic").unresolved === 1 && r.notes.some((x) => /동적 SQL/.test(x)), "동적 SQL 문장 미해석 표시·안내");
  assert(edge("class:egovframework.com.cop.bbs.service.impl.EgovArticleDAO", "mapper:BBSArticle", "calls").detail.split(",").sort().join() === "insertArticle,selectArticleList,selectDynamic,updateArticle", "DAO → 매퍼: 문자열 호출 문장 목록");
  assert(edge("class:egovframework.com.cop.bbs.service.impl.EgovArticleServiceImpl", "class:egovframework.com.cop.bbs.service.impl.EgovArticleDAO", "injects") && edge("class:egovframework.com.cop.bbs.web.EgovArticleController", "class:egovframework.com.cop.bbs.service.impl.EgovArticleServiceImpl", "injects") && edge("class:egovframework.com.cop.bbs.service.impl.EgovArticleServiceImpl", "class:egovframework.com.cop.bbs.service.EgovArticleService", "implements"), "주입: @Resource(name) 는 빈 이름으로 구현체에, implements 간선");
  assert(node("class:egovframework.com.cop.bbs.web.EgovArticleController").role === "controller" && node("class:egovframework.com.cop.bbs.service.impl.EgovArticleServiceImpl").role === "service-impl" && node("class:egovframework.com.cop.bbs.service.EgovArticleService").role === "service" && node("class:egovframework.com.cop.bbs.service.impl.EgovArticleDAO").role === "dao" && node("class:egovframework.example.sample.service.impl.SampleMapper").role === "mapper-interface", "역할 분류");
  assert(edge("url:/cop/bbs/selectArticleList.do", "class:egovframework.com.cop.bbs.web.EgovArticleController", "maps").detail === "ANY" && edge("url:/cop/bbs/insertArticle.do", "class:egovframework.com.cop.bbs.web.EgovArticleController", "maps").detail === "POST" && !node("url:/commented/out.do") && !node("url:/test/only.do"), "URL 매핑(메서드), 주석·테스트 제외");
  assert(edge("class:egovframework.com.cop.bbs.web.EgovArticleController", "url:/cop/bbs/selectArticleList.do", "links").detail === "forward" && node("url:/uat/uia/egovLoginUsr.do"), "forward·redirect 는 링크 간선");
  assert(edge("class:egovframework.com.cop.bbs.web.EgovArticleController", `view:${V}EgovArticleList.jsp`, "renders") && node("view:egovframework/com/cop/bbs/NoSuchJsp") && !node("view:egovframework/com/cop/bbs/NoSuchJsp").file && r.summary.unresolvedViews === 1, "뷰: 이름 → JSP 파일(접미 일치), 없는 뷰는 미해석 노드");
  assert(edge(`view:${V}EgovArticleList.jsp`, "url:/cop/bbs/insertArticle.do", "links") && !node(`view:${V}EgovStandalone.jsp`) && !r.nodes.some((x) => x.type === "url" && /commented/.test(x.name)), "화면 → URL 링크(c:url·form action), 주석 제외, 아무 데도 닿지 않는 JSP 는 노드 아님");
  assert(edge("class:egovframework.example.sample.service.impl.SampleMapper", "mapper:egovframework.example.sample.service.impl.SampleMapper", "calls").detail === "namespace" && edge("class:egovframework.example.sample.service.impl.SampleServiceImpl", "class:egovframework.example.sample.service.impl.SampleMapper", "injects") && edge("class:egovframework.example.sample.web.SampleController", "class:egovframework.example.sample.service.impl.SampleServiceImpl", "injects"), "Boot: @Mapper 인터페이스 ↔ 네임스페이스 FQN, 생성자 주입, @Autowired 인터페이스 → 구현체");
  assert(node("url:/api/sample") && node("url:/api/sample/{id}") && edge("url:/api/sample", "class:egovframework.example.sample.web.SampleController").detail === "GET" && edge("view:src/main/resources/templates/thymeleaf/sample/egovSampleList.html", "url:/api/sample", "links"), "클래스 @RequestMapping + 괄호 없는 @GetMapping, Thymeleaf @{…} 링크");
  assert(r.orphans.mappers.join() === "OrphanMapper" && r.orphans.statements.join() === "BBSArticle.selectNeverCalled" && r.orphans.controllersWithoutUrl.join() === "egovframework.com.cop.bbs.web.EgovNoUrlController", `고아: 매퍼·문장·Controller (${JSON.stringify(r.orphans)})`);
  const bbsTables = m.loadCatalog().components.find((c) => c.id === "bbs").tables.length;
  assert(r.componentTables.length === 1 && r.componentTables[0].component === "bbs" && r.componentTables[0].tables === bbsTables && r.componentTables[0].referenced === 3 && r.orphans.unreferencedTables.length === bbsTables - 3 && r.orphans.unreferencedTables.includes("COMTNBLOG"), `공통컴포넌트 테이블(카탈로그): bbs ${bbsTables} 중 참조 3, 미참조 목록`);
  assert(Math.abs(r.summary.unresolvedRate - 2 / 9) < 0.001, `해석 실패율 = (문장 1 + 뷰 1) / (문장 7 + 뷰 참조 2) (${r.summary.unresolvedRate})`);
  // impact
  const it = m.impactOf(r, { table: "comtnbbs" });
  const names = (i) => i.nodes.map((x) => `${x.distance}:${x.node.type}:${x.node.type === "class" ? x.node.name.split(".").pop() : x.node.name.split("/").pop()}`);
  assert(it.direction === "upstream" && it.start.id === "table:COMTNBBS" && names(it).join() === "1:mapper:BBSArticle,2:class:EgovArticleDAO,3:class:EgovArticleServiceImpl,4:class:EgovArticleService,4:class:EgovArticleController,5:url:insertArticle.do,5:url:missingView.do,5:url:selectArticleList.do,5:view:NoSuchJsp,5:view:EgovArticleList.jsp" && it.byType.table === 0, `impact(table): 위로 거리순(Controller 의 화면 포함), 대소문자 무시 (${names(it).join(" ")})`);
  assert(m.impactOf(r, { table: "COMTNBBSUSE" }).nodes.length === 1, "문장 단위: 부르는 곳 없는 문장만 쓰는 테이블은 매퍼까지만");
  const iu = m.impactOf(r, { url: "/cop/bbs/selectArticleList.do" });
  assert(iu.direction === "both" && iu.nodes.some((x) => x.node.id === "table:COMTNBBS") && iu.nodes.some((x) => x.node.id === "table:COMTNBBSMASTER") && iu.byType.table === 2 && iu.nodes.some((x) => x.node.id === `view:${V}EgovArticleList.jsp` && x.distance === 1) && !iu.nodes.some((x) => x.node.id === "url:/api/sample"), "impact(url): 아래로 테이블까지(2) + 링크하는 화면 한 단계, 화면의 다른 링크로 번지지 않음");
  const ic = m.impactOf(r, { class: "EgovArticleServiceImpl" });
  assert(ic.direction === "both" && ic.byType.table === 2 && ic.nodes.some((x) => x.node.name.endsWith("EgovArticleController")) && ic.nodes.some((x) => x.node.type === "url"), "impact(class 단순명): 양쪽");
  const iv = m.impactOf(r, { view: "EgovArticleList" });
  assert(iv.nodes.some((x) => x.node.id === "table:COMTNBBS") && iv.nodes.some((x) => x.node.name.endsWith("EgovArticleController") && x.distance === 1), "impact(view): 링크 URL 아래로 + 렌더링하는 Controller");
  let threw = null; try { m.impactOf(r, { table: "NOPE" }); } catch (e) { threw = e.message; }
  assert(/지도에 없는/.test(threw ?? ""), "없는 노드는 오류");
  try { m.impactOf(r, { table: "COMTNBBS", url: "/x" }); threw = null; } catch (e) { threw = e.message; }
  assert(/하나만/.test(threw ?? ""), "impact 는 하나만");
  // 인수인계 표
  const h = m.handoverTables(r);
  assert(h.screens.length === 5 && h.screens.find((s) => s.url === "/cop/bbs/selectArticleList.do").views.join() === `${V}EgovArticleList.jsp` && h.screens.find((s) => s.url === "/cop/bbs/insertArticle.do").method === "POST" && h.screens[0].component === undefined || h.screens.find((s) => s.url === "/cop/bbs/insertArticle.do").component === "bbs", "화면 목록: URL·메서드·Controller·화면·컴포넌트");
  const prog = h.programs.find((p) => p.controller.endsWith("EgovArticleController"));
  assert(h.programs.length === 3 && prog.services.join() === "egovframework.com.cop.bbs.service.EgovArticleService,egovframework.com.cop.bbs.service.impl.EgovArticleServiceImpl" && prog.daos.join() === "egovframework.com.cop.bbs.service.impl.EgovArticleDAO" && prog.mappers.join() === "BBSArticle", "프로그램 목록: Controller → Service → DAO → 매퍼");
  const db = h.dbAccess.find((x) => x.table === "COMTNBBS");
  assert(db.C.join() === "BBSArticle" && db.R.join() === "BBSArticle" && db.U.join() === "BBSArticle" && db.D.length === 0 && h.dbAccess.find((x) => x.table === "COMTNORPHAN").R.join() === "OrphanMapper", "DB 접근 표: 테이블 × CRUD × 매퍼");
  // Markdown·Mermaid
  const md = m.renderProjectMapMarkdown(m.buildProjectMap({ projectDir: d, impact: { table: "COMTNBBS" } }), 4);
  assert(md.includes("## 영향: table `COMTNBBS`") && md.includes("## 화면 목록 (URL 5)") && md.includes("## 프로그램 목록 (Controller 3)") && md.includes("## DB 접근 표 (테이블 5)") && md.includes("| … | | 1개 더(format=json) | |") && md.includes("## 고아") && md.includes("OrphanMapper"), "Markdown: 영향·표 3종(topN)·고아");
  const mer = m.renderMermaid(m.buildProjectMap({ projectDir: d, impact: { table: "COMTNBBS" } }));
  assert(mer.startsWith("flowchart LR") && mer.includes("[(COMTNBBS)]") && mer.includes("-->|reads|") && !mer.includes("SampleMapper"), "Mermaid: impact 범위만");
  try { m.renderMermaid(r, 3); threw = null; } catch (e) { threw = e.message; }
  assert(/노드까지/.test(threw ?? ""), "Mermaid 노드 상한");
  const scoped = m.buildProjectMap({ projectDir: d, components: ["bbs"] });
  assert(scoped.summary.files.java === 5 && scoped.summary.files.mapperXml === 3 && scoped.summary.mappers === 2 && !scoped.nodes.some((x) => x.id === "table:SAMPLE") && scoped.notes.some((x) => /범위/.test(x)), "components 범위: 그 경로 아래만");
  try { m.buildProjectMap({ projectDir: d, components: ["nope"] }); threw = null; } catch (e) { threw = e.message; }
  assert(/알 수 없는 컴포넌트/.test(threw ?? ""), "모르는 컴포넌트는 오류");
  assert(!JSON.stringify(r).includes("src/test/java"), "src/test 는 지도에 없음");
  rmSync(d, { recursive: true, force: true });
}

// ── 멀티 모듈 ────────────────────────────────────────
{
  const d = project({ "pom.xml": "<project><modules><module>core</module><module>web</module></modules></project>", "core/pom.xml": "<project/>", "web/pom.xml": "<project/>",
    "core/src/main/java/a/core/service/impl/CoreDAO.java": 'package a.core.service.impl;\n@Repository("CoreDAO")\npublic class CoreDAO extends EgovComAbstractDAO { public Object s() { return selectOne("Core.selectOne", null); } }\n',
    "core/src/main/resources/mapper/Core_SQL.xml": '<mapper namespace="Core"><select id="selectOne" resultType="map">SELECT 1 FROM T_CORE</select></mapper>',
    "web/src/main/java/a/web/WebController.java": 'package a.web;\n@Controller\npublic class WebController { @Resource(name = "CoreDAO") private CoreDAO dao; @RequestMapping("/w.do") public String w() { return "w/x"; } }\n' });
  const r = m.buildProjectMap({ projectDir: d });
  assert(r.summary.modules.join() === "core,web" && r.nodes.find((x) => x.id === "class:a.web.WebController").module === "web" && r.nodes.find((x) => x.id === "mapper:Core").module === "core" && m.impactOf(r, { table: "T_CORE" }).nodes.some((x) => x.node.module === "web"), "멀티 모듈: 노드에 모듈, 영향이 모듈 경계를 넘음");
  rmSync(d, { recursive: true, force: true });
}

// ── CRUD 생성물: 테이블 → URL 끊김 없음 ──────────────
for (const profile of ["classic", "boot"]) {
  const d = project({ "pom.xml": "<project/>" });
  m.generateCrud({ projectDir: d, tableName: "SAMPLE_BOARD", entityName: "Board", basePackage: "egovframework.example.board", fields: [{ columnName: "BOARD_ID", javaType: "Long", jdbcType: "BIGINT", primaryKey: true, generated: true, nullable: false }, { columnName: "TITLE", javaType: "String" }], profile });
  const r = m.buildProjectMap({ projectDir: d, impact: { table: "SAMPLE_BOARD" } });
  const types = r.impact.nodes.map((x) => x.node.type);
  assert(r.summary.orphanMappers === 0 && r.summary.orphanStatements === 0 && r.summary.controllersWithoutUrl === 0 && types.includes("mapper") && types.includes("class") && types.includes("url") && r.impact.nodes.filter((x) => x.node.type === "url").length >= (profile === "classic" ? 6 : 2) && (profile === "boot" || types.includes("view")), `CRUD ${profile}: 테이블 → 매퍼 → 클래스 → URL${profile === "classic" ? " → JSP" : ""} 끊김 없음, 고아 0 (${JSON.stringify(r.impact.byType)})`);
  rmSync(d, { recursive: true, force: true });
}

// ── 납품 패키지 map 항목·진단 요약·MCP·CLI ───────────
{
  const d = project(FIX);
  const out = path.join(root, "delivery-out");
  const r = await m.prepareDelivery({ projectDir: d, outputDir: out, dryRun: false, include: ["map"] });
  const item = r.items.find((i) => i.id === "map");
  assert(item.status === "ok" && item.files.sort().join() === "map/db-access.csv,map/programs.csv,map/project-map.json,map/project-map.md,map/screens.csv" && item.summary.tables === 5 && existsSync(path.join(out, "map/screens.csv")) && readFileSync(path.join(out, "map/screens.csv"), "utf8").includes('"/cop/bbs/selectArticleList.do","ANY"') && JSON.parse(readFileSync(path.join(out, "map/project-map.json"), "utf8")).handover.programs.length === 3, "납품 패키지 map 항목: md·json(handover 포함)·CSV 3종");
  assert(m.DELIVERY_ITEMS.includes("map") && !m.DELIVERY_DEFAULT_INCLUDE.includes("map"), "map 은 선택 항목(기본 포함 아님)");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  const tools = (await client.listTools()).tools;
  const t = tools.find((x) => x.name === "map_egovframe_project");
  assert(t && t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false && t.inputSchema.properties.impactTable && t.inputSchema.properties.format.enum.join() === "markdown,json,mermaid" && t.outputSchema && tools.length >= 41, "MCP: 등록됨, 읽기 전용, impact 파라미터 4종, mermaid 형식");
  const res = await client.callTool({ name: "map_egovframe_project", arguments: { projectDir: d, impactUrl: "/cop/bbs/selectArticleList.do", format: "json" } });
  assert(!res.isError && res.structuredContent.impact.byType.table === 2 && res.structuredContent.handover.screens.length === 5 && res.structuredContent.summary.tables === 5, "MCP 호출: 구조화 출력에 impact·handover");
  const mer = await client.callTool({ name: "map_egovframe_project", arguments: { projectDir: d, components: ["bbs"], format: "mermaid" } });
  assert(!mer.isError && mer.content[0].text.startsWith("flowchart LR"), "MCP mermaid");
  const diag = await client.callTool({ name: "diagnose_egovframe_project", arguments: { projectDir: d } });
  assert(!diag.isError && /- 구조 지도: 테이블 5 · URL 6 · 화면 \d+ · 고아 매퍼 1/.test(diag.content[0].text) && diag.structuredContent.projectMap.tables === 5, "진단에 지도 요약 한 줄·projectMap");
  await client.close(); await server.close();
  assert(m.CLI_COMMANDS.map && m.CLI_COMMANDS.map.tool === "map_egovframe_project" && !m.CLI_COMMANDS.map.blocked, "CLI map");
  rmSync(d, { recursive: true, force: true });
}

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`project-map FAIL (${n} assertions)`); else console.log(`project-map OK (${n} assertions)`);
