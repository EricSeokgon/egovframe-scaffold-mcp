// node test/consistency.mjs — 화면–쿼리–DB 정합성(v1.25) 게이트 (오프라인, 플랫폼 중립)
//   목록·건수 짝 찾기 · 동적 조건 비교(순서 무관, 정렬·페이징·순번 조건 제외, include 조각 펼침, DB 사본 묶음, 컬럼만 다르면 경고) ·
//   필드–컬럼 짝(INSERT 자리·UPDATE SET) · 입력 길이 3자 대조(@Size > DDL, maxlength > @Size, maxlength > DDL) · 날짜 관용 제외 ·
//   validate 연결(ok 와 무관)·평가서·CLI·MCP · 생성 CRUD 는 통과
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkConsistency, renderConsistencyMarkdown, listPartnerOf, dynamicConditions, fieldColumnPairs, parseMapperForConsistency, validateProject, assessProject, renderAssessmentMarkdown, runCli, buildServer, OUTPUT_SCHEMAS, generateCrud } from "../dist/index.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const root = mkdtempSync(path.join(tmpdir(), "egov-consistency-"));
let k = 0;
const w = (dir, rel, text) => { const f = path.join(dir, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
const POM = "<project><modelVersion>4.0.0</modelVersion><groupId>kr.go</groupId><artifactId>sample</artifactId><version>1.0.0</version></project>\n";
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">\n';
const mapper = (ns, body) => `${HEAD}<mapper namespace="${ns}">\n${body}\n</mapper>\n`;
const COND_A = '<if test="searchKeyword != null and searchKeyword != \'\'">AND A.NOTICE_SJ LIKE CONCAT(\'%\', #{searchKeyword}, \'%\')</if>';
const COND_USE = '<if test="searchUseAt != null and searchUseAt != \'\'">AND A.USE_AT = #{searchUseAt}</if>';
const COND_CODE = '<if test="searchCode != null and searchCode != \'\'">AND A.NOTICE_CODE = #{searchCode}</if>';
const PAGING = '<if test="recordCountPerPage != null">LIMIT #{recordCountPerPage} OFFSET #{firstIndex}</if>\n<if test="sortOrder != null">ORDER BY A.NOTICE_ID DESC</if>';
const noticeMapper = (countConds, extra = "") => mapper("noticeDAO", `
  <sql id="where"><where>1=1 ${COND_A}</where></sql>
  <select id="selectNoticeList" parameterType="NoticeVO" resultType="NoticeVO">
    SELECT A.NOTICE_ID, A.NOTICE_SJ FROM TB_NOTICE A WHERE 1=1
    ${COND_USE}
    ${COND_A}
    ${PAGING}
  </select>
  <select id="selectNoticeListTotCnt" parameterType="NoticeVO" resultType="int">
    SELECT COUNT(*) FROM TB_NOTICE A WHERE 1=1
    ${countConds}
  </select>
  <insert id="insertNotice" parameterType="kr.go.sample.NoticeVO">
    <selectKey keyProperty="noticeId" resultType="string" order="BEFORE">SELECT NEXT_ID FROM IDS</selectKey>
    INSERT INTO TB_NOTICE (NOTICE_ID, NOTICE_SJ, NOTICE_CN, WRITER_NM, REG_DT, NOTICE_DE)
    VALUES (#{noticeId}, #{noticeSj}, #{noticeCn}, #{writerNm, jdbcType=VARCHAR}, NOW(), REPLACE(#{noticeDe}, '-', ''))
  </insert>
  <update id="updateNotice" parameterType="NoticeVO">
    UPDATE TB_NOTICE A SET NOTICE_SJ = #{noticeSj}, A.MEMO = #{memo} WHERE NOTICE_ID = #{noticeId}
  </update>
  ${extra}`);
const VO = `package kr.go.sample;

public class NoticeVO {
	private String noticeId;
	/** @Size(max=9999) 는 주석 */
	@Size(max = 200)
	@NotBlank
	private String noticeSj;
	@Size(min = 1, max = 4000, message = "{notice.cn}")
	private String noticeCn;
	@Length(max = 300)
	private String memo;
	@Size(max = 10)
	private String noticeDe;
	private String writerNm;
}
`;
const DDL = `-- 공지
CREATE TABLE TB_NOTICE (
  NOTICE_ID CHAR(20) NOT NULL,
  NOTICE_SJ VARCHAR(100) NOT NULL, -- 제목
  NOTICE_CN VARCHAR(4000),
  MEMO VARCHAR2(300 BYTE),
  WRITER_NM VARCHAR(20),
  NOTICE_DE CHAR(8),
  REG_DT DATETIME,
  AMOUNT DECIMAL(10,2),
  PRIMARY KEY (NOTICE_ID)
);
`;
const JSP = `<%@ page contentType="text/html; charset=utf-8" %>
<form:form modelAttribute="noticeVO" action="insert.do">
  <%-- <form:input path="noticeSj" maxlength="999"/> --%>
  <form:input path="noticeSj" maxlength="255" title="제목"/>
  <form:textarea path="noticeCn" maxlength="4000"/>
  <form:input path="writerNm" size="20" maxlength="60"/>
  <form:input path="noticeDe" maxlength="10"/>
  <form:hidden path="noticeId" maxlength="99"/>
  <input type="text" name="keyword" maxlength="500"/>
</form:form>
<form:form modelAttribute="searchVO"><form:input path="noticeSj" maxlength="999"/></form:form>
`;
const project = (o = {}) => {
  const d = path.join(root, `p${k++}`);
  w(d, "pom.xml", POM);
  w(d, "src/main/resources/mapper/Notice_SQL_mysql.xml", noticeMapper(o.count ?? `${COND_A}\n${COND_USE}`, o.extra));
  if (o.variants !== false) for (const db of ["oracle", "postgres"]) w(d, `src/main/resources/mapper/Notice_SQL_${db}.xml`, noticeMapper(o.count ?? `${COND_A}\n${COND_USE}`, o.extra));
  w(d, "src/main/java/kr/go/sample/NoticeVO.java", o.vo ?? VO);
  w(d, "src/main/resources/db/schema-ddl.sql", o.ddl ?? DDL);
  w(d, "src/main/webapp/WEB-INF/jsp/notice/NoticeRegist.jsp", o.jsp ?? JSP);
  return d;
};
const K = (r, kind) => r.issues.filter((i) => i.kind === kind);

try {
  // ── 짝 찾기 · 조건 추출 ──
  const ids = new Set(["selectNoticeList", "selectNotice", "selectFaqs", "selectUserListTotCnt", "selectUserList"]);
  assert(listPartnerOf("selectNoticeListTotCnt", ids) === "selectNoticeList" && listPartnerOf("selectNoticeListCnt", ids) === "selectNoticeList" && listPartnerOf("selectNoticeCnt", ids) === "selectNotice" && listPartnerOf("selectFaqCount", ids) === "selectFaqs" && listPartnerOf("selectNoticeCount", ids) === "selectNotice" && listPartnerOf("selectOrphanTotCnt", ids) === null && listPartnerOf("selectNoticeList", ids) === null, "짝 찾기: …ListTotCnt·ListCnt·Cnt·Count → 목록 문장(없으면 null)");
  const dc = dynamicConditions(`WHERE 1=1 ${COND_USE} ${COND_A} ${PAGING} <if test="searchCnd == 5"> AND RN &lt;= 5</if> <choose><when test="searchCondition == 1">AND B.USER_NM LIKE #{kw}</when><otherwise>AND 1=1</otherwise></choose>`);
  assert(dc.length === 3 && dc.map((c) => c.columns.join()).join("|") === "USE_AT|NOTICE_SJ|USER_NM" && dc[0].test === 'searchUseAt!=nullandsearchUseAt!=""' && dc[2].test === "searchCondition==1", "동적 조건: <if>·<when> 의 test 와 거르는 컬럼(별칭 제외) — 정렬·페이징·순번(RN) 조건은 뺌");
  assert(JSON.stringify(fieldColumnPairs("insert", "INSERT INTO T (A, B_NM, C) VALUES (#{a}, CONCAT(#{bNm}, 'x', 'y'), NOW())")) === JSON.stringify([{ table: "T", column: "A", field: "a" }, { table: "T", column: "B_NM", field: "bNm" }]) && fieldColumnPairs("update", "UPDATE T X SET X.A = #{vo.a}, B = NOW(), C = #{c,jdbcType=VARCHAR} WHERE ID = #{id}").map((p) => `${p.column}=${p.field}`).join() === "A=a,C=c" && fieldColumnPairs("insert", "INSERT INTO T (A, B) VALUES (#{a})").length === 0, "필드–컬럼 짝: INSERT 는 같은 자리(함수 인자의 쉼표 제외), UPDATE 는 SET, 개수가 안 맞으면 짝짓지 않음");
  const pm = parseMapperForConsistency("m/Notice_SQL_oracle.xml", noticeMapper(""));
  assert(pm.namespace === "noticeDAO" && pm.db === "oracle" && pm.stmts.get("insertNotice").param === "kr.go.sample.NoticeVO" && !/NEXT_ID/.test(pm.stmts.get("insertNotice").body) && parseMapperForConsistency("x.xml", "<beans/>") === null, "매퍼 해석: namespace·DB 접미사·parameterType, selectKey 는 본문에서 제외");

  // ── 목록·건수 ──
  const ok = checkConsistency({ projectDir: project() });
  assert(ok.summary.countPairs === 3 && ok.summary.pairsCompared === 3 && K(ok, "count-condition-mismatch").length === 0, "조건이 같으면(순서만 다름) 통과 — DB 사본 3개 모두 비교");
  const miss = checkConsistency({ projectDir: project({ count: `${COND_A}\n${COND_CODE}` }) });
  const cm = K(miss, "count-condition-mismatch")[0];
  assert(K(miss, "count-condition-mismatch").length === 1 && cm.severity === "error" && cm.variants === 3 && cm.subject === "noticeDAO.selectNoticeList ↔ selectNoticeListTotCnt" && cm.detail.onlyInList.join().includes("USE_AT") && cm.detail.onlyInCount.join().includes("NOTICE_CODE") && cm.message.includes("페이지 수") && cm.file.endsWith("Notice_SQL_mysql.xml") && cm.line > 5, "건수 문장의 조건이 다르면 오류 1건(목록에만·건수에만), DB 사본 3개는 한 건으로");
  const none = checkConsistency({ projectDir: project({ count: "" }) });
  assert(K(none, "count-condition-mismatch").length === 1 && K(none, "count-condition-mismatch")[0].detail.onlyInCount.length === 0 && K(none, "count-condition-mismatch")[0].detail.onlyInList.length === 2, "건수 문장에 조건이 하나도 없어도 보고");
  const inc = checkConsistency({ projectDir: project({ count: `<include refid="where"/>\n${COND_USE}` }) });
  assert(K(inc, "count-condition-mismatch").length === 0, "<include refid> 조각은 펼쳐서 비교");
  const colOnly = checkConsistency({ projectDir: project({ count: `${COND_USE}\n<if test="searchKeyword != null and searchKeyword != ''">AND A.NOTICE_CN LIKE CONCAT('%', #{searchKeyword}, '%')</if>` }) });
  assert(K(colOnly, "count-condition-mismatch").length === 1 && K(colOnly, "count-condition-mismatch")[0].severity === "warning", "test 식은 같고 거르는 컬럼만 다르면 경고");
  const diffDb = project({ count: `${COND_A}\n${COND_USE}` });
  w(diffDb, "src/main/resources/mapper/Notice_SQL_oracle.xml", noticeMapper(COND_A));
  const dd = checkConsistency({ projectDir: diffDb });
  assert(K(dd, "count-condition-mismatch").length === 1 && K(dd, "count-condition-mismatch")[0].file.endsWith("_oracle.xml") && (K(dd, "count-condition-mismatch")[0].variants ?? 1) === 1, "한 DB 사본에서만 어긋나면 그 파일로 보고");

  // ── 입력 길이 ──
  const len = K(ok, "length-exceeds-column"), mx = K(ok, "maxlength-exceeds-size");
  assert(ok.summary.sizedFields === 4 && ok.summary.columnsWithLength === 6 && ok.summary.fieldsLinked === 4 && ok.summary.maxlengthInputs === 6, `집계: @Size 필드 4(주석 제외)·길이 있는 컬럼 6(DECIMAL·DATETIME 제외)·연결 4·maxlength 입력 6(hidden·JSP 주석 제외)`);
  assert(len.some((i) => i.subject === "NoticeVO.noticeSj" && i.file.endsWith("NoticeVO.java") && i.detail.size === 200 && i.detail.columnLength === 100 && i.detail.column === "TB_NOTICE.NOTICE_SJ" && i.severity === "error") && !len.some((i) => i.subject === "NoticeVO.noticeCn") && !len.some((i) => i.subject === "NoticeVO.memo"), "@Size(max=200) > VARCHAR(100) 오류 — 같거나 작으면 통과");
  assert(mx.length === 1 && mx[0].subject === "NoticeVO.noticeSj" && mx[0].severity === "warning" && mx[0].detail.maxlength === 255 && mx[0].detail.size === 200 && mx[0].file.endsWith("NoticeRegist.jsp") && mx[0].line === 4, "maxlength=255 > @Size(max=200) 경고(파일·줄) — 다른 폼(searchVO)·일반 input 은 보지 않음");
  assert(len.some((i) => i.subject === "NoticeVO.writerNm" && i.file.endsWith(".jsp") && i.detail.maxlength === 60 && i.detail.columnLength === 20 && i.message.includes("@Size 도 없어")) && !len.some((i) => i.subject === "NoticeVO.noticeDe") && len.length === 2, "VO 제약 없이 maxlength=60 > VARCHAR(20) 오류 · 날짜 10자 → CHAR(8) 관용은 제외");
  assert(ok.notes.some((x) => x.includes("바이트")) && ok.summary.errors === 2 && ok.summary.warnings === 1 && ok.summary.byKind["length-exceeds-column"] === 2, "바이트 단위 컬럼 안내, 집계(오류 2·경고 1)");
  const noDdl = checkConsistency({ projectDir: project({ ddl: "INSERT INTO X VALUES (1);\n" }) });
  assert(K(noDdl, "length-exceeds-column").length === 0 && K(noDdl, "maxlength-exceeds-size").length === 1 && noDdl.summary.columnsWithLength === 0, "DDL 이 없으면 컬럼 대조는 건너뛰고 화면–VO 만");

  // ── 출력·연결 ──
  const md = renderConsistencyMarkdown(miss);
  assert(md.includes("### 화면–쿼리–DB 정합성") && md.includes("count-condition-mismatch") && md.includes("외 DB 사본 2") && md.includes("NoticeVO.noticeSj") && OUTPUT_SCHEMAS.validate_egovframe_project.safeParse(await validateProject({ projectDir: miss.projectDir })).success, "Markdown(DB 사본 수)·validate 구조화 출력 스키마 통과");
  const v = await validateProject({ projectDir: miss.projectDir }), v0 = await validateProject({ projectDir: miss.projectDir, consistency: false });
  assert(v.ok === v0.ok && v.warnings.length === v0.warnings.length && !v.warnings.some((x) => /정합성|consistency/.test(x)) && v.consistency.summary.errors === 3 && v0.consistency === undefined, "validate: consistency 검사 기본 켬 — ok(조립 무결성) 판정에는 넣지 않음, consistency=false 면 생략");
  const a = await assessProject({ projectDir: miss.projectDir }), aClean = await assessProject({ projectDir: project({ vo: "package kr.go.sample;\npublic class NoticeVO { }\n", jsp: "<html/>" }) });
  assert(a.consistency.errors === 3 && a.consistency.byKind["count-condition-mismatch"] === 1 && renderAssessmentMarkdown(a).includes("### 화면–쿼리–DB 정합성") && aClean.consistency.errors === 0 && !renderAssessmentMarkdown(aClean).includes("화면–쿼리–DB 정합성"), "평가서: 건수와 절(문제가 없으면 절을 넣지 않음)");
  const io = () => { const o = [], e = []; return { o, e, io: { cwd: miss.projectDir, stdout: (s) => o.push(s), stderr: (s) => e.push(s), env: {} } }; };
  const c1 = io(), c2 = io();
  assert(await runCli(["validate", "--project", ".", "--fail-on", "consistencyErrors>0"], c1.io) === 2 && c1.e.join("").includes("정합성 오류 3") && await runCli(["validate", "--project", ".", "--no-consistency", "--fail-on", "consistencyErrors>0"], c2.io) === 0, "CLI validate: --fail-on consistencyErrors>0(종료 코드 2), --no-consistency");
  const tool = buildServer()._registeredTools.validate_egovframe_project;
  assert(tool.inputSchema.safeParse({ projectDir: "/x" }).data.consistency === true && tool.outputSchema, "MCP: consistency 파라미터(기본 true)");

  // ── 생성 CRUD 는 통과 ──
  {
    const d = path.join(root, "crud");
    w(d, "pom.xml", "<project><modelVersion>4.0.0</modelVersion><parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>5.0.2</version></parent><groupId>kr.go</groupId><artifactId>c</artifactId><version>1</version><dependencies></dependencies></project>\n");
    const DDL2 = "CREATE TABLE SAMPLE_FAQ (FAQ_ID INT NOT NULL, QUESTION VARCHAR(200), ANSWER VARCHAR(2000), USE_AT CHAR(1), PRIMARY KEY (FAQ_ID))";
    w(d, "src/main/resources/db/schema-ddl.sql", `${DDL2};\n`);
    let total = 0;
    for (const profile of ["classic", "boot"]) {
      const g = await generateCrud({ projectDir: d, basePackage: `kr.go.${profile}.faq`, profile, ddl: DDL2, search: ["QUESTION", "USE_AT"], paging: true, pageUnit: 10, dialect: "mysql" });
      total += g.files.length;
    }
    const r = checkConsistency({ projectDir: d });
    assert(total >= 12 && r.summary.countPairs >= 1 && r.summary.errors === 0 && r.summary.warnings === 0, `생성 CRUD(classic·boot, 검색·페이징, 파일 ${total}개): 목록·건수 쌍 ${r.summary.countPairs}개·길이 대조 모두 통과`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`consistency FAIL (${n} assertions)`); else console.log(`consistency OK (${n} assertions)`);
