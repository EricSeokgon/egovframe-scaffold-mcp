// node test/mapper-check.mjs — 매퍼·DAO 정합성(v1.19) 게이트 (오프라인, 플랫폼 중립)
//   없는 문장(문자열 ID·Mapper 인터페이스)·후보 순서 · namespace 접두 id · 이어 만든 ID · DB 별 차이와 Globals.DbType · include·resultMap ·
//   같은 DB 로 올라가는 파일 사이 id 중복 · 프로젝트 클래스 없음 · 주석·CDATA·테스트 제외 · iBATIS 제외 · validate·CLI·평가서 연결
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkMappers, renderMapperCheckMarkdown, similarIds, editDistance, validateProject, assessProject, renderAssessmentMarkdown, runCli } from "../dist/index.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const root = mkdtempSync(path.join(tmpdir(), "egov-mapper-check-"));
let k = 0;
const project = (files) => { const d = path.join(root, `p${k++}`); for (const [rel, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); } return d; };
const M = "src/main/resources/egovframework/mapper";
const J = "src/main/java/egovframework/x";
const xml = (ns, body) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">\n<mapper namespace="${ns}">\n${body}\n</mapper>\n`;
const kinds = (r) => r.issues.map((i) => `${i.kind}:${i.ref}`).sort();

try {
  // ── 후보 ──
  assert(editDistance("kitten", "sitting") === 3 && editDistance("a", "a") === 0, "편집 거리");
  assert(similarIds("selectAdministCodeList", ["selectAdministCodeDetail", "selectAdministCodeRecptnList", "deleteAdministCode"])[0] === "selectAdministCodeRecptnList" && similarIds("selectCnsltAnswerListDetail", ["selectCnsltAnswerList", "selectCnsltAnswerDetail"])[0] === "selectCnsltAnswerDetail", "후보: 글자를 끼우거나 뺀 이름(부분열)을 먼저 — upstream 수정 2건의 정답이 1순위");
  assert(similarIds("insertFoo", ["deleteBarBaz", "selectQux"]).length === 0, "먼 이름은 후보 아님");

  // ── 문자열 ID 호출 ──
  {
    const d = project({
      [`${M}/a/EgovA_SQL_mysql.xml`]: xml("ADAO", '  <select id="selectA" resultType="egovMap">SELECT 1</select>\n  <insert id="ADAO.insertA">INSERT INTO A VALUES (1)</insert>\n  <!-- <delete id="deleteA">x</delete> -->\n  <update id="updateA"><![CDATA[ UPDATE A SET X = 1 <delete id="ghost"> ]]></update>\n  <select id="selectLoginA">x</select><select id="selectLoginB">x</select>'),
      [`${J}/ADAO.java`]: 'package egovframework.x;\npublic class ADAO extends EgovAbstractMapper {\n  public Object a(Object v) { return selectOne("ADAO.selectA", v); }\n  public void b(Object v) { insert("ADAO.insertA", v); }\n  public void c(Object v) { delete("ADAO.deleteA", v); }\n  // selectOne("ADAO.commented", v);\n  public void d(Object v) { update("ADAO.ghost", v); }\n  public void e(Object v, String t) { update("ADAO.selectLogin" + t, v); }\n  public void f(Object v, String t) { update("ADAO.nothing" + t, v); }\n  public void g(Object v) { selectList("NoSuchDAO.selectX", v); }\n}\n',
      "src/test/java/egovframework/x/ADAOTest.java": 'class T { void t() { selectOne("ADAO.onlyInTest", null); } }\n',
    });
    const r = checkMappers({ projectDir: d });
    assert(JSON.stringify(kinds(r)) === JSON.stringify(["dynamic-unmatched:ADAO.nothing…", "missing-namespace:NoSuchDAO.selectX", "missing-statement:ADAO.deleteA", "missing-statement:ADAO.ghost"].sort()), `없는 문장 2(주석·CDATA 안 태그는 문장 아님)·없는 namespace 1·이어 만든 ID 불일치 1, "ADAO.insertA" 형 id·주석 호출·테스트 제외 (${kinds(r).join(" / ")})`);
    const del = r.issues.find((i) => i.ref === "ADAO.deleteA");
    assert(del.severity === "error" && del.file === `${J}/ADAO.java` && del.line === 5 && del.message.includes("Mapped Statements collection does not contain value"), `위치·메시지 (${del.file}:${del.line}, 후보 ${JSON.stringify(del.candidates)})`);
    assert(r.counts.stringCalls === 5 && r.counts.dynamicCalls === 2 && r.summary.dynamicMatched === 1 && r.summary.missing === 3 && r.summary.errors === 3 && r.summary.warnings === 1, `건수 (${JSON.stringify(r.counts)} ${JSON.stringify(r.summary)})`);
    const md = renderMapperCheckMarkdown(r);
    assert(md.includes("### 매퍼·DAO 정합성") && md.includes("| error | missing-statement | `src/main/java/egovframework/x/ADAO.java:5` | `ADAO.deleteA` |"), "Markdown 표");
  }

  // ── Mapper 인터페이스 ──
  {
    const d = project({
      [`${M}/s/Sample_SQL.xml`]: xml("egovframework.x.SampleMapper", '  <resultMap id="sample" type="egovframework.x.SampleVO"/>\n  <select id="selectSample" resultMap="sample">x</select>\n  <insert id="insertSample">x</insert>'),
      [`${J}/SampleMapper.java`]: 'package egovframework.x;\n\nimport java.util.List;\n\n@EgovMapper("sampleMapper")\npublic interface SampleMapper {\n\tSampleVO selectSample(SampleVO vo) throws Exception;\n\n\tvoid insertSample(SampleVO vo) throws Exception;\n\n\tList<?> selectSampleList(SampleVO vo);\n\n\t@Select("SELECT 1")\n\tint countAnnotated();\n\n\tdefault int helper() { return 1; }\n}\n',
      [`${J}/SampleVO.java`]: "package egovframework.x;\npublic class SampleVO {}\n",
      [`${J}/Other.java`]: "package egovframework.x;\npublic interface Other { void notAMapper(); }\n",
    });
    const r = checkMappers({ projectDir: d });
    assert(JSON.stringify(kinds(r)) === JSON.stringify(["missing-statement:egovframework.x.SampleMapper.selectSampleList"]) && r.counts.interfaceMethods === 3 && r.issues[0].line === 11 && r.issues[0].message.includes("BindingException") && r.issues[0].candidates[0] === "selectSample", `인터페이스: XML 없는 메서드 1(@Select·default 제외, namespace 가 아닌 인터페이스 무시) (${kinds(r).join()} · 줄 ${r.issues[0]?.line})`);
  }

  // ── DB 별 차이 · Globals.DbType ──
  {
    const files = {
      "src/main/resources/egovframework/egovProps/globals.properties": "Globals.DbType = oracle\n",
      [`${J}/BDAO.java`]: 'package egovframework.x;\nclass BDAO { void a() { selectList("BDAO.selectB", null); selectList("BDAO.onlyMysql", null); } }\n',
    };
    for (const db of ["mysql", "oracle", "tibero"]) files[`${M}/b/EgovB_SQL_${db}.xml`] = xml("BDAO", `  <select id="selectB">x</select>${db === "mysql" ? '\n  <select id="onlyMysql">x</select>' : ""}${db !== "tibero" ? '\n  <select id="notTibero">x</select>' : ""}`);
    const d = project(files);
    const r = checkMappers({ projectDir: d });
    const v = r.issues.filter((i) => i.kind === "db-variant");
    assert(r.dbType === "oracle" && v.length === 2 && r.summary.variantGaps === 2, `DB 별 차이 2 (${v.map((i) => `${i.ref}:${i.missingIn.join("/")}`).join(", ")})`);
    const only = v.find((i) => i.ref === "BDAO.onlyMysql"), nt = v.find((i) => i.ref === "BDAO.notTibero");
    assert(only.severity === "error" && only.missingIn.join() === "oracle,tibero" && only.presentIn.join() === "mysql" && nt.severity === "warning" && nt.missingIn.join() === "tibero", "Globals.DbType=oracle 에서 빠진 것은 오류, 아닌 DB 만 빠지면 경고");
    assert(!r.issues.some((i) => i.kind === "missing-statement"), "다른 DB 사본에 있으면 '없는 문장'은 아님(DB 별 차이로만)");
    const r2 = checkMappers({ projectDir: d, dbType: "mysql" });
    assert(r2.issues.filter((i) => i.severity === "error").length === 0, "dbType=mysql 이면 오류 없음");
  }

  // ── XML 안 참조·id 중복·클래스 ──
  {
    const d = project({
      [`${M}/c/C_SQL.xml`]: xml("CDAO", '  <sql id="cols">A, B</sql>\n  <resultMap id="rm" type="egovframework.x.CVO"/>\n  <select id="s1" resultMap="rm"><include refid="cols"/></select>\n  <select id="s2" resultMap="rmx"><include refid="colz"/></select>\n  <select id="s3" resultMap="OtherDAO.orm"><include refid="OtherDAO.ocols"/></select>\n  <select id="s1">dup</select>\n  <select id="s4" parameterType="egovframework.x.GoneVO" resultType="egovframework.rte.Whatever">x</select>\n  <select id="s5" parameterType="java.util.Map" resultType="egovMap">x</select>'),
      [`${M}/c/Other_SQL.xml`]: xml("OtherDAO", '  <sql id="ocols">A</sql>\n  <resultMap id="orm" type="egovframework.x.CVO"/>'),
      [`${M}/c/C2_SQL.xml`]: xml("CDAO", '  <select id="s2">other file same namespace</select>\n  <select id="s9">x</select>'),
      [`${J}/CVO.java`]: "package egovframework.x;\npublic class CVO {}\n",
    });
    const r = checkMappers({ projectDir: d });
    const ks = kinds(r);
    assert(ks.includes("resultmap-missing:rmx") && ks.includes("include-missing:colz") && !ks.some((x) => /OtherDAO/.test(x)) && r.issues.find((i) => i.ref === "rmx").candidates[0] === "rm", `include·resultMap 대상 없음(다른 namespace 참조는 해석) (${ks.join(" / ")})`);
    assert(r.issues.filter((i) => i.kind === "duplicate-id").map((i) => `${i.file.split("/").pop()}:${i.ref}`).sort().join() === "C2_SQL.xml:CDAO.s2,C_SQL.xml:CDAO.s1", "id 중복: 같은 파일 안 1 + 같은 namespace 다른 파일 1");
    assert(ks.includes("type-missing:egovframework.x.GoneVO") && !ks.some((x) => /rte\.Whatever|java\.util|egovMap|CVO/.test(x)) && r.issues.find((i) => i.kind === "type-missing").severity === "warning", "프로젝트 패키지 클래스만 확인(경고) — 의존성·별칭·있는 클래스 제외");
  }

  // ── iBATIS·매퍼 없음 ──
  {
    const d = project({
      "src/main/resources/sqlmap/A_SQL.xml": '<sqlMap namespace="ADAO"><select id="a">x</select></sqlMap>',
      [`${J}/ADAO.java`]: 'class ADAO { void a() { list("ADAO.zzz", null); } }\n',
    });
    const r = checkMappers({ projectDir: d });
    assert(r.issues.length === 0 && r.counts.ibatisFiles === 1 && r.notes.some((x) => x.includes("iBATIS")) && r.notes.some((x) => x.includes("매퍼 XML 이 없습니다")), "iBATIS sqlMap 은 범위 밖, MyBatis 매퍼가 없으면 문자열 호출을 보고하지 않음");
  }

  // ── validate·CLI·평가서 ──
  {
    const d = project({
      "pom.xml": "<project><artifactId>a</artifactId></project>",
      [`${M}/a/A_SQL.xml`]: xml("ADAO", '  <select id="selectA">x</select>'),
      [`${J}/ADAO.java`]: 'package egovframework.x;\nclass ADAO { void a() { selectOne("ADAO.selectAA", null); } }\n',
    });
    const v = await validateProject({ projectDir: d });
    const v0 = await validateProject({ projectDir: d, mapper: false });
    assert(v.ok === v0.ok && v.mapper.summary.errors === 1 && v.mapper.issues[0].candidates[0] === "selectA" && v0.mapper === undefined, "validate: mapper 결과는 따로(ok 는 조립 무결성 그대로), mapper=false 면 건너뜀");
    const out = [];
    const io = { cwd: d, env: {}, stdout: (s) => out.push(s), stderr: (s) => out.push(s) };
    const code = await runCli(["validate", "--project", ".", "--fail-on", "mapperMissing>0"], io);
    assert(code === 2 && out.join("").includes("매퍼 오류 1(없는 문장 1)"), `CLI validate --fail-on mapperMissing>0 → 2 (${code})`);
    const a = await assessProject({ projectDir: d, offline: true });
    assert(a.mapper.errors === 1 && a.mapper.missing === 1 && a.mapper.namespaces === 1 && renderAssessmentMarkdown(a).includes("### 매퍼·DAO 정합성"), "평가서: 매퍼 건수와 절");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`mapper-check FAIL (${n} assertions)`); else console.log(`mapper-check OK (${n} assertions)`);
