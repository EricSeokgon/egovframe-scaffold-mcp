// node test/privacy.mjs — 개인정보 흐름·보호조치 점검(v1.21) 게이트 (오프라인, 플랫폼 중립)
//   규칙 데이터 · 컬럼 사전(양성·음성) · DDL·매퍼에서 컬럼 찾기 · 흐름표(DAO·Service·Controller·URL·화면) ·
//   plaintext-storage(자바 암호화 호출·SQL 암호화 함수·필드 단위 판정·selectKey·DB 사본 합치기) · screen/log-exposure · 예외 파일 ·
//   Markdown·CSV · 평가서 · 납품 패키지 항목 · MCP·CLI
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPrivacyRules, classifyPrivacyColumn, checkPrivacy, renderPrivacyMarkdown, renderPrivacyCsv, camelOf, PRIVACY_IGNORE_FILE, assessProject, renderAssessmentMarkdown, prepareDelivery, runCli, buildServer, OUTPUT_SCHEMAS } from "../dist/index.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const root = mkdtempSync(path.join(tmpdir(), "egov-privacy-"));
let k = 0;
const project = (files) => { const d = path.join(root, `p${k++}`); for (const [rel, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); } return d; };
const xml = (ns, body) => `<?xml version="1.0" encoding="UTF-8"?>\n<mapper namespace="${ns}">\n${body}\n</mapper>\n`;
const M = "src/main/resources/egovframework/mapper", J = "src/main/java/egovframework/x", V = "src/main/webapp/WEB-INF/jsp/x";

try {
  // ── 규칙·사전 ──
  {
    const r = loadPrivacyRules();
    assert(r.items.length >= 12 && new Set(r.items.map((i) => i.id)).size === r.items.length && r.items.every((i) => i.label && i.label_en && r.grades.some((g) => g.id === i.grade) && new RegExp(`^(?:${i.columns})$`, "i")) && r.sources.length >= 2 && ["cryptoCalls", "sqlCryptoFunctions", "maskCalls", "logCalls"].every((key) => new RegExp(r[key])), `규칙 데이터: 항목 ${r.items.length}종(ko/en·등급·정규식 컴파일), 출처, 호출 사전`);
    assert(r.grades.filter((g) => g.encryptAtRest).map((g) => g.id).join() === "unique-id,credential,financial", "저장 시 암호화 대상 등급: 고유식별·비밀번호·금융");
    const id = (c) => classifyPrivacyColumn(c)?.id ?? null;
    assert(id("IHIDNUM") === "rrn" && id("jumin_no") === "rrn" && id("PASSPORT_NO") === "passport" && id("PASSWORD") === "password" && id("USER_PW") === "password" && id("ACNUT_NO") === "account" && id("CARD_NO") === "card" && id("MBTLNUM") === "mobile" && id("HOUSE_MIDDLE_TELNO") === "phone" && id("EMAIL_ADRES") === "email" && id("DETAIL_ADRES") === "address" && id("BRTHDY") === "birth" && id("MBER_NM") === "name" && id("BIZRNO") === "business-no", "컬럼 사전 양성(표준 용어·변형)");
    assert([ "PASSWORD_HINT", "PASSWORD_CNSR", "BBS_NM", "CODE_NM", "FILE_NM", "ZIP", "AREA_NO", "ORDER_NO", "IP_ADDRESS_X", "MENU_NM", "USE_AT", "NTT_ID", "BIRTHPLACE_CODE" ].every((c) => id(c) === null), "음성: 비밀번호 힌트·게시판명·코드명·우편번호 등은 개인정보 항목이 아님");
    assert(camelOf("EMAIL_ADRES") === "emailAdres" && camelOf("IHIDNUM") === "ihidnum", "컬럼 → 필드 이름");
  }

  // ── 흐름·평문 저장 ──
  {
    const DDL = "CREATE TABLE MEMBER (\n  MBER_ID VARCHAR(20) NOT NULL,\n  MBER_NM VARCHAR(50),\n  PASSWORD VARCHAR(200) NOT NULL, -- 주석 IHIDNUM\n  IHIDNUM VARCHAR(200),\n  ACNUT_NO VARCHAR(40),\n  CARD_NO VARCHAR(40),\n  MBTLNUM VARCHAR(20),\n  PASSWORD_HINT VARCHAR(100),\n  PRIMARY KEY (MBER_ID)\n);\nCREATE TABLE BBS ( NTT_ID NUMERIC(20) NOT NULL, NTT_SJ VARCHAR(200) );\n";
    const sqlFor = (db) => xml("MemberDAO", `  <select id="selectMember" resultType="egovMap">SELECT MBER_ID, MBER_NM, IHIDNUM, MBTLNUM FROM MEMBER WHERE MBER_ID = #{mberId}</select>\n  <insert id="insertMember">\n    <selectKey keyProperty="seq" resultType="int" order="BEFORE">SELECT 1 FROM DUAL</selectKey>\n    INSERT INTO MEMBER (MBER_ID, MBER_NM, PASSWORD, IHIDNUM, ACNUT_NO, CARD_NO, MBTLNUM)\n    VALUES (#{mberId}, #{mberNm}, #{password}, #{ihidnum}, #{acnutNo}, ${db === "mysql" ? "HEX(AES_ENCRYPT(#{cardNo}, 'k'))" : "XX1.ENC_VARCHAR2_INS(#{cardNo})"}, #{mbtlnum})\n  </insert>\n  <update id="updateMember">UPDATE MEMBER SET MBER_NM = #{mberNm}, MBTLNUM = #{mbtlnum} WHERE MBER_ID = #{mberId} AND PASSWORD = #{password}</update>\n  <update id="updatePassword">UPDATE MEMBER SET PASSWORD = #{password} WHERE MBER_ID = #{mberId}</update>`);
    const d = project({
      "pom.xml": "<project><artifactId>a</artifactId></project>",
      "scripts/ddl/mysql/ddl.sql": DDL,
      "scripts/dml/mysql/data.sql": "CREATE TABLE IGNORED_DML ( JUMIN_NO VARCHAR(13) );",
      [`${M}/x/Member_SQL_mysql.xml`]: sqlFor("mysql"),
      [`${M}/x/Member_SQL_oracle.xml`]: sqlFor("oracle"),
      [`${J}/MemberDAO.java`]: 'package egovframework.x;\n@Repository("memberDAO")\npublic class MemberDAO extends EgovAbstractMapper {\n  public Object selectMember(Object v) { return selectOne("MemberDAO.selectMember", v); }\n  public void insertMember(MemberVO v) { insert("MemberDAO.insertMember", v); }\n  public void updateMember(MemberVO v) { update("MemberDAO.updateMember", v); }\n  public void updatePassword(MemberVO v) { update("MemberDAO.updatePassword", v); }\n}\n',
      [`${J}/MemberServiceImpl.java`]: 'package egovframework.x;\n@Service("memberService")\npublic class MemberServiceImpl implements MemberService {\n  @Resource(name = "memberDAO") private MemberDAO memberDAO;\n  public void insertMember(MemberVO vo) {\n    // vo.setIhidnum(cryptoService.encrypt(vo.getIhidnum()));  주석은 세지 않는다\n    String pass = EgovFileScrty.encryptPassword(vo.getPassword(), vo.getMberId());\n    vo.setPassword(pass);\n    LOGGER.debug("member {}", vo.getMberId());\n    memberDAO.insertMember(vo);\n  }\n  public void updatePassword(MemberVO vo) { memberDAO.updatePassword(vo); }\n  public void trace(MemberVO vo) { LOGGER.info("rrn=" + vo.getIhidnum()); int h = vo.hashCode(); }\n}\n',
      [`${J}/MemberService.java`]: "package egovframework.x;\npublic interface MemberService { void insertMember(MemberVO vo); }\n",
      [`${J}/MemberController.java`]: 'package egovframework.x;\n@Controller\npublic class MemberController {\n  @Resource(name = "memberService") private MemberService memberService;\n  @RequestMapping("/x/insertMember.do")\n  public String insert(MemberVO vo) { memberService.insertMember(vo); return "x/MemberDetail"; }\n}\n',
      [`${J}/MemberVO.java`]: "package egovframework.x;\npublic class MemberVO { private String ihidnum; }\n",
      [`${V}/MemberDetail.jsp`]: '<html><body>\n<%-- <c:out value="${member.ihidnum}"/> --%>\n<td><c:out value="${member.ihidnum}"/></td>\n<td><c:out value="${fn:substring(member.ihidnum, 0, 6)}"/>-*******</td>\n<input type="text" name="ihidnum" value="${member.ihidnum}"/>\n<td>${member.mbtlnum}</td>\n</body></html>\n',
    });
    const r = checkPrivacy({ projectDir: d });
    const cols = r.columns.map((c) => `${c.table}.${c.column}:${c.item}`).join(" ");
    assert(cols === "MEMBER.ACNUT_NO:account MEMBER.CARD_NO:card MEMBER.IHIDNUM:rrn MEMBER.MBER_NM:name MEMBER.MBTLNUM:mobile MEMBER.PASSWORD:password" && r.columns.every((c) => c.source === "ddl") && r.columns.find((c) => c.column === "IHIDNUM").line === 5, `DDL 에서 개인정보 컬럼 6(힌트·주석·dml 스크립트 제외, 줄 번호) (${cols})`);
    assert(r.summary.tables === 1 && r.summary.uniqueIdTables === 1 && r.summary.byGrade["unique-id"] === 1 && r.summary.byGrade.financial === 2 && r.summary.mapperStatements === 4, `요약 (${JSON.stringify(r.summary)})`);
    const f = r.flows[0];
    assert(f.table === "MEMBER" && f.read === 1 && f.write === 3 && f.daos.join() === "egovframework.x.MemberDAO" && f.services.includes("egovframework.x.MemberServiceImpl") && f.controllers.join() === "egovframework.x.MemberController" && f.urls.join() === "/x/insertMember.do" && f.views.some((v) => v.endsWith("MemberDetail.jsp")), `흐름표: 문장 1/3(DB 사본은 한 번) → DAO → Service → Controller → URL → 화면 (${JSON.stringify(f)})`);
    const ps = r.findings.filter((x) => x.kind === "plaintext-storage").map((x) => `${x.code.split("→ ")[1]}@${x.code.split(" ")[1].split(".").pop()}x${x.variants ?? 1}`).sort().join(" ");
    assert(ps === "MEMBER.ACNUT_NO@insertMemberx2 MEMBER.IHIDNUM@insertMemberx2", `평문 저장: 주민번호·계좌 — 비밀번호는 호출 경로 파일의 encryptPassword(…getPassword…) 로(파일 단위 판정), 카드는 SQL 암호화 함수로 통과, WHERE 의 PASSWORD 는 쓰기가 아님, 주석 속 암호화는 무효, DB 사본 2개는 한 건 (${ps})`);
    const rrn = r.findings.find((x) => x.kind === "plaintext-storage" && x.column === "IHIDNUM");
    assert(rrn.severity === "high" && rrn.file.endsWith("Member_SQL_mysql.xml") && rrn.line === 4 && /호출 경로 \d+개 파일/.test(rrn.evidence) && rrn.evidence.includes("ihidnum") && rrn.grade === "unique-id", `근거: 위치·확인한 파일 수·필드 (${rrn.evidence})`);
    const se = r.findings.filter((x) => x.kind === "screen-exposure");
    assert(se.length === 1 && se[0].line === 3 && se[0].severity === "medium", `화면 노출 1: 마스킹(fn:substring)·입력 value·JSP 주석·일반 등급(휴대전화)은 제외 (${se.map((x) => x.line).join()})`);
    const le = r.findings.filter((x) => x.kind === "log-exposure");
    assert(le.length === 1 && le[0].file.endsWith("MemberServiceImpl.java") && le[0].line === 13 && !le[0].code.includes("rrn="), `로그 노출 1(문자열 내용은 가림) (${le.map((x) => `${x.line}:${x.code}`).join()})`);
    assert(r.summary.high === 2 && r.summary.medium === 2, "높음 2 · 중간 2");
    const md = renderPrivacyMarkdown(r);
    assert(md.includes("## 보호조치 누락 의심") && md.includes("## 개인정보 파일 (테이블 × 항목)") && md.includes("## 처리 흐름 (테이블 → 화면)") && md.includes("| MEMBER | IHIDNUM | 주민등록번호 | 고유식별정보 |") && md.includes(PRIVACY_IGNORE_FILE), "Markdown: 누락·개인정보 파일·흐름·예외 안내");
    const csv = renderPrivacyCsv(r);
    assert(csv.startsWith("﻿\"table\"") && csv.includes("\r\n") && csv.split("\r\n").length === 8 && csv.includes('"MEMBER","IHIDNUM","주민등록번호","고유식별정보","ddl"'), "CSV: BOM·CRLF, 컬럼마다 한 줄");
    // 예외
    writeFileSync(path.join(d, PRIVACY_IGNORE_FILE), JSON.stringify({ ignores: [{ rule: "log-exposure", path: `${J}/MemberServiceImpl.java`, line: 13, reason: "개발 프로파일 전용 로그로 분리 예정", reviewer: "보안담당" }, { rule: "plaintext-storage", path: `${M}/x/`, reason: "짧" }] }));
    const r2 = checkPrivacy({ projectDir: d });
    assert(r2.summary.suppressed === 1 && r2.findings.filter((x) => x.kind === "log-exposure").length === 0 && r2.summary.high === 2 && r2.invalidIgnores.length === 1 && r2.ignoreFile === PRIVACY_IGNORE_FILE, "예외 파일: 사유·검토자 있는 항목만");
    // 평가서·납품 패키지
    const a = await assessProject({ projectDir: d, offline: true });
    assert(a.privacy.tables === 1 && a.privacy.high === 2 && renderAssessmentMarkdown(a).includes("### 개인정보 (`check_egovframe_privacy`)"), "평가서: 개인정보 건수와 절");
    const out = path.join(root, "delivery");
    const dv = await prepareDelivery({ projectDir: d, outputDir: out, dryRun: false, include: ["privacy"] });
    assert(dv.items[0].id === "privacy" && dv.items[0].status === "ok" && ["privacy/privacy.md", "privacy/privacy.json", "privacy/personal-data-files.csv"].every((p) => existsSync(path.join(out, p))) && dv.items[0].summary.high === 2 && JSON.parse(readFileSync(path.join(out, "privacy/privacy.json"), "utf8")).columns.length === 6, "납품 패키지 선택 항목 privacy(md·json·csv)");
    // CLI
    const io = () => { const o = []; return { cwd: d, env: {}, stdout: (s) => o.push(s), stderr: (s) => o.push(s), o }; };
    const i1 = io(), i2 = io();
    assert(await runCli(["privacy", "--project", ".", "--fail-on", "high>0"], i1) === 2 && i1.o.join("").includes("보호조치 누락 의심 높음 2") && await runCli(["privacy", "--project", ".", "--format", "csv"], i2) === 0, "CLI privacy: --fail-on high>0 → 2");
  }

  // ── DDL 없이 매퍼만 · 생성자 주입(지도가 주입을 못 읽는 경우) ──
  {
    const d = project({
      [`${M}/u/User_SQL.xml`]: xml("UserDAO", '  <insert id="insertUser">INSERT INTO TB_USER (USER_ID, JUMIN_NO, USER_NM) VALUES (#{userId}, #{juminNo}, #{userNm})</insert>'),
      [`${J}/UserDAO.java`]: 'package egovframework.x;\npublic class UserDAO { void insertUser(Object v) { insert("UserDAO.insertUser", v); } }\n',
      [`${J}/UserServiceImpl.java`]: "package egovframework.x;\n@RequiredArgsConstructor\npublic class UserServiceImpl {\n  private final UserDAO userDAO;\n  private final EgovCryptoService cryptoService;\n  void save(UserVO vo) {\n    vo.setJuminNo(cryptoService.encrypt(vo.getJuminNo()));\n    userDAO.insertUser(vo);\n  }\n}\n",
    });
    const r = checkPrivacy({ projectDir: d });
    assert(r.columns.map((c) => `${c.table}.${c.column}:${c.source}`).join() === "TB_USER.JUMIN_NO:mapper,TB_USER.USER_NM:mapper" && r.notes.some((x) => x.includes("DDL 을 찾지 못해")), "DDL 이 없으면 매퍼 SQL 의 컬럼으로(안내)");
    assert(r.findings.length === 0, `생성자 주입이어도 DAO 이름을 쓰는 서비스의 암호화 호출을 찾아 통과 (${r.findings.map((x) => x.code).join()})`);
    writeFileSync(path.join(d, `${J}/UserServiceImpl.java`), "package egovframework.x;\npublic class UserServiceImpl { private final UserDAO userDAO; void save(UserVO vo) { userDAO.insertUser(vo); } }\n");
    const r2 = checkPrivacy({ projectDir: d });
    assert(r2.findings.length === 1 && r2.findings[0].column === "JUMIN_NO" && r2.findings[0].evidence.includes("juminNo"), "암호화 호출을 빼면 평문 저장 1");
    const empty = checkPrivacy({ projectDir: project({ "pom.xml": "<project/>" }) });
    assert(empty.columns.length === 0 && empty.notes.some((x) => x.includes("찾지 못했습니다")) && renderPrivacyMarkdown(empty).includes("없음"), "DDL·매퍼가 없으면 빈 결과와 안내");
  }

  // ── MCP ──
  {
    const server = buildServer();
    const tool = server._registeredTools.check_egovframe_privacy;
    assert(tool && tool.annotations.readOnlyHint === true && tool.outputSchema && OUTPUT_SCHEMAS.check_egovframe_privacy, "MCP: 등록됨·읽기 전용·outputSchema");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`privacy FAIL (${n} assertions)`); else console.log(`privacy OK (${n} assertions)`);
