// node test/baseline.mjs — 점검 기준선(v1.26) 게이트 (오프라인, 플랫폼 중립)
//   지문 안정성(위에 줄 삽입·공백 변경 → 같은 지문, 이름 변경 → 해결 1·새 항목 1, 응답 언어와 무관, 같은 키의 순번) ·
//   기준선 읽기(없는 파일·JSON 아님·다른 도구의 결과·지문 없는 옛 결과·잘린 결과) · 운영·개인정보·접근 통제·매퍼·정합성의 isNew/new/resolved ·
//   baselinePath 없으면 new=null·baseline 없음 · 보안약점 점검의 기존 지문 값 불변 · CLI(--baseline-path, --fail-on "new>0") ·
//   생성 CI(baselineDir, 세 플랫폼) · 평가서(baselineDir) · 포트폴리오 · 납품 패키지 차수 비교 · MCP 출력 스키마
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fingerprintOf, assignFingerprints, readCheckBaseline, applyBaseline, baselineKindOf, opsSubject,
  checkOperations, checkPrivacy, checkAccess, validateProject, checkSecureCoding, renderOperationsMarkdown, renderAccessMarkdown, renderPrivacyMarkdown,
  assessProject, renderAssessmentMarkdown, newFindingsOf, rowFromAssessment, diffDeliveries, renderDeliveryDiffMarkdown,
  supplyChainCommands, generateCiYaml, generateGitlabCi, generateJenkinsfile, generateCiConfig, baselineCommands, CI_BASELINE_DIR_RE,
  runCli, buildServer, OUTPUT_SCHEMAS, SERVER_VERSION, setLang,
} from "../dist/index.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const root = mkdtempSync(path.join(tmpdir(), "egov-baseline-"));
let k = 0;
const project = (files) => { const d = path.join(root, `p${++k}`); for (const [rel, text] of Object.entries(files)) { const f = path.join(d, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); } return d; };
const put = (dir, rel, text) => { const f = path.join(dir, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, typeof text === "string" ? text : JSON.stringify(text, null, 2)); return rel; };

const J = "src/main/java/kr/go/sample";
const M = "src/main/resources/egovframework/mapper/sample";
const BOOT_POM = `<project><parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>5.0.2</version></parent><artifactId>b</artifactId><version>1</version><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>`;
const APP = "server.port=8080\nspring.jpa.show-sql=true\nlogging.level.root=DEBUG\n";
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">\n';
const COND = (f, c) => `<if test="${f} != null and ${f} != ''">AND A.${c} = #{${f}}</if>`;
const noticeMapper = (countConds) => `${HEAD}<mapper namespace="noticeDAO">
  <select id="selectNoticeList" parameterType="NoticeVO" resultType="NoticeVO">
    SELECT A.NOTICE_ID FROM TB_NOTICE A WHERE 1=1
    ${COND("searchUseAt", "USE_AT")}
    ${COND("searchCode", "NOTICE_CODE")}
  </select>
  <select id="selectNoticeListTotCnt" parameterType="NoticeVO" resultType="int">
    SELECT COUNT(*) FROM TB_NOTICE A WHERE 1=1
    ${countConds}
  </select>
  <insert id="insertMember">INSERT INTO MEMBER (MBER_ID, IHIDNUM) VALUES (#{mberId}, #{ihidnum})</insert>
  <delete id="deleteNotice">DELETE FROM TB_NOTICE WHERE NOTICE_ID = #{noticeId}</delete>
</mapper>
`;
const DAO = (extra = "") => `package kr.go.sample;
@Repository("noticeDAO")
public class NoticeDAO extends EgovAbstractMapper {
  public Object list(Object v) { return selectList("noticeDAO.selectNoticeList", v); }
  public void insertMember(MemberVO v) { insert("noticeDAO.insertMember", v); }
  public void del(Object v) { delete("noticeDAO.deleteNotice", v); }
  public void ghost(Object v) { update("noticeDAO.ghostStatement", v); }
${extra}}
`;
const CONTROLLER = (extra = "", deleteName = "deleteNotice") => `package kr.go.sample;

@Controller
@RequestMapping("/notice")
public class NoticeController {
	@Resource(name = "noticeService") private NoticeService noticeService;

	@PostMapping("/update.do")
	public String updateNotice(NoticeVO vo) {
		if (!EgovUserDetailsHelper.isAuthenticated()) return "redirect:/login.do";
		noticeService.updateNotice(vo);
		return "redirect:/notice/list.do";
	}

	@PostMapping("/delete.do")
	public String ${deleteName}(NoticeVO vo) {
		noticeService.deleteNotice(vo);
		return "redirect:/notice/list.do";
	}
${extra}}
`;
const FILES = (o = {}) => ({
  "pom.xml": BOOT_POM,
  "src/main/resources/application.properties": o.app ?? APP,
  "scripts/ddl/mysql/ddl.sql": "CREATE TABLE MEMBER (\n  MBER_ID VARCHAR(20) NOT NULL,\n  IHIDNUM VARCHAR(200),\n  PRIMARY KEY (MBER_ID)\n);\nCREATE TABLE TB_NOTICE ( NOTICE_ID VARCHAR(20) NOT NULL, USE_AT CHAR(1), NOTICE_CODE VARCHAR(10) );\n",
  [`${M}/Notice_SQL_mysql.xml`]: noticeMapper(o.countConds ?? COND("searchUseAt", "USE_AT")),
  [`${J}/NoticeDAO.java`]: DAO(o.daoExtra),
  [`${J}/NoticeServiceImpl.java`]: 'package kr.go.sample;\n@Service("noticeService")\npublic class NoticeServiceImpl {\n  @Resource(name = "noticeDAO") private NoticeDAO noticeDAO;\n  public void insertMember(MemberVO vo) { noticeDAO.insertMember(vo); }\n  public void deleteNotice(NoticeVO vo) { noticeDAO.del(vo); }\n  public void updateNotice(NoticeVO vo) { }\n}\n',
  [`${J}/MemberVO.java`]: "package kr.go.sample;\npublic class MemberVO { private String ihidnum; private String mberId; }\n",
  [`${J}/NoticeController.java`]: o.controller ?? CONTROLLER(),
});
const B = ".egovframe/baseline";
const fps = (xs) => xs.map((f) => f.fingerprint).sort().join(",");

try {
  // ── 지문 ──
  {
    const a = fingerprintOf("access", ["unprotected-write", "a/B.java", "B", "deleteX", "/x/delete.do"]);
    assert(/^[0-9a-f]{32}$/.test(a) && a === fingerprintOf("access", ["unprotected-write", "a/B.java", "B", "deleteX", "/x/delete.do"], 1) && a === createHash("sha256").update("access|unprotected-write|a/B.java|B|deleteX|/x/delete.do|1").digest("hex").slice(0, 32), "지문 = sha256(점검|부분들|순번) 앞 32자 — 계산식 고정(바꾸면 기존 기준선이 전부 새 항목이 됨)");
    assert(a !== fingerprintOf("privacy", ["unprotected-write", "a/B.java", "B", "deleteX", "/x/delete.do"]) && a !== fingerprintOf("access", ["unprotected-write", "a/B.java", "B", "deleteX", "/x/delete.do"], 2) && fingerprintOf("ops", ["r", "  a   b "]) === fingerprintOf("ops", ["r", "a b"]), "점검 종류·순번이 다르면 다른 지문, 공백 차이는 같은 지문");
    const items = assignFingerprints("mapper", [{ k: "x" }, { k: "y" }, { k: "x" }], (i) => [i.k]);
    assert(items[0].fingerprint !== items[2].fingerprint && items[0].fingerprint === fingerprintOf("mapper", ["x"], 1) && items[2].fingerprint === fingerprintOf("mapper", ["x"], 2), "같은 키가 여러 번이면 나온 순서대로 순번");
    assert(opsSubject("spring.jpa.show-sql=true") === "spring.jpa.show-sql" && opsSubject("  logging.level.root: DEBUG") === "logging.level.root" && opsSubject('<session-timeout>600</session-timeout>') === "<session-timeout>" && opsSubject("업로드 상한 키 없음") === "" && opsSubject("no upload limit key") === "", "운영 점검의 대상 = 설정 키(값 제외)·XML 태그, 번역되는 문구는 빈 값(규칙·파일로만 구분)");
  }

  // ── 네 점검: 기준선 없이 ──
  const d1 = project(FILES());
  const ops1 = await checkOperations({ projectDir: d1 }), pv1 = checkPrivacy({ projectDir: d1 }), ac1 = checkAccess({ projectDir: d1 }), va1 = await validateProject({ projectDir: d1 });
  {
    assert(ops1.findings.length >= 2 && pv1.findings.length >= 1 && ac1.findings.length >= 1 && va1.mapper.issues.length >= 1 && va1.consistency.issues.length >= 1, `표본 프로젝트에 다섯 갈래 모두 항목이 있음(운영 ${ops1.findings.length}·개인정보 ${pv1.findings.length}·접근 통제 ${ac1.findings.length}·매퍼 ${va1.mapper.issues.length}·정합성 ${va1.consistency.issues.length})`);
    const all = [...ops1.findings, ...pv1.findings, ...ac1.findings, ...va1.mapper.issues, ...va1.consistency.issues];
    assert(all.every((f) => /^[0-9a-f]{32}$/.test(f.fingerprint)) && new Set(all.map((f) => f.fingerprint)).size === all.length && all.every((f) => f.isNew === undefined), "모든 항목에 지문(서로 다름), baselinePath 가 없으면 isNew 없음");
    assert(ops1.summary.new === null && pv1.summary.new === null && ac1.summary.new === null && va1.mapper.summary.new === null && va1.consistency.summary.new === null && !ops1.baseline && !pv1.baseline && !ac1.baseline && !va1.mapper.baseline && !va1.consistency.baseline, "baselinePath 없으면 summary.new = null, baseline 없음");
    const a = ac1.findings[0];
    assert(a.fingerprint === fingerprintOf("access", [a.kind, a.file, a.controller, a.method, a.url]), `접근 통제 지문 = 종류·파일·컨트롤러·메서드·URL(${a.kind} ${a.method} ${a.url})`);
    const c = va1.consistency.issues[0], mi = va1.mapper.issues[0], p = pv1.findings.find((f) => f.table);
    assert(c.fingerprint === fingerprintOf("consistency", [c.kind, c.file, c.subject]) && mi.fingerprint === fingerprintOf("mapper", [mi.kind, mi.file, mi.ref]) && p && p.fingerprint === fingerprintOf("privacy", [p.kind, p.item, p.file, `${p.table}.${p.column}`.toUpperCase()]), "정합성 = 종류·파일·대상, 매퍼 = 종류·파일·문장 ID, 개인정보 = 종류·항목·파일·테이블.컬럼");
    setLang("en");
    const en = [(await checkOperations({ projectDir: d1 })).findings, checkPrivacy({ projectDir: d1 }).findings, checkAccess({ projectDir: d1 }).findings, (await validateProject({ projectDir: d1 })).consistency.issues];
    setLang("ko");
    assert(fps(en[0]) === fps(ops1.findings) && fps(en[1]) === fps(pv1.findings) && fps(en[2]) === fps(ac1.findings) && fps(en[3]) === fps(va1.consistency.issues), "응답 언어(ko/en)가 달라도 지문은 같음");
  }
  // 기준선 저장
  put(d1, `${B}/ops.json`, ops1); put(d1, `${B}/privacy.json`, pv1); put(d1, `${B}/access.json`, ac1); put(d1, `${B}/validate.json`, va1);

  // ── 같은 코드: 새 항목 0 ──
  {
    const o = await checkOperations({ projectDir: d1, baselinePath: `${B}/ops.json` }), p = checkPrivacy({ projectDir: d1, baselinePath: `${B}/privacy.json` }), a = checkAccess({ projectDir: d1, baselinePath: `${B}/access.json` }), v = await validateProject({ projectDir: d1, baselinePath: `${B}/validate.json` });
    assert([o.summary.new, p.summary.new, a.summary.new, v.mapper.summary.new, v.consistency.summary.new].every((x) => x === 0) && [o, p, a, v.mapper, v.consistency].every((r) => r.baseline.resolved === 0 && r.baseline.path.endsWith(".json")), "같은 코드를 기준선과 비교 → 다섯 갈래 모두 새 항목 0·해결 0");
    assert(o.baseline.findings === ops1.findings.length && a.baseline.findings === ac1.findings.length && [...o.findings, ...a.findings, ...p.findings, ...v.mapper.issues, ...v.consistency.issues].every((f) => f.isNew === false), "baseline.findings = 이전 건수, 모든 항목 isNew=false");
    assert(JSON.stringify({ ...a, durationMs: 0, baseline: undefined, summary: { ...a.summary, new: null }, findings: a.findings.map(({ isNew, ...f }) => f) }) === JSON.stringify({ ...ac1, durationMs: 0 }), "기준선을 줘도 나머지 출력은 그대로(isNew·new·baseline 만 더해짐)");
    assert(existsSync(path.join(d1, B, "access.json")) && checkAccess({ projectDir: d1 }).handlers.length === ac1.handlers.length && (await checkOperations({ projectDir: d1 })).filesScanned === ops1.filesScanned, "기준선 디렉터리(.egovframe/)는 점검 대상이 아님");
  }

  // ── 줄만 밀림 → 같은 지문 ──
  {
    const pad = "// 머리말\n".repeat(20);
    const d = project({ ...FILES(), [`${J}/NoticeController.java`]: CONTROLLER().replace("@Controller", `${pad}@Controller`), [`${J}/NoticeDAO.java`]: pad + DAO(), "src/main/resources/application.properties": `# 주석\n# 주석 2\n\n${APP}`, [`${M}/Notice_SQL_mysql.xml`]: noticeMapper(COND("searchUseAt", "USE_AT")).replace("<mapper", "<!-- 머리말 -->\n\n\n<mapper"), "scripts/ddl/mysql/ddl.sql": `-- 머리말\n\n${FILES()["scripts/ddl/mysql/ddl.sql"]}` });
    for (const f of ["ops", "privacy", "access", "validate"]) put(d, `${B}/${f}.json`, readFileSync(path.join(d1, B, `${f}.json`), "utf8"));
    const o = await checkOperations({ projectDir: d, baselinePath: `${B}/ops.json` }), p = checkPrivacy({ projectDir: d, baselinePath: `${B}/privacy.json` }), a = checkAccess({ projectDir: d, baselinePath: `${B}/access.json` }), v = await validateProject({ projectDir: d, baselinePath: `${B}/validate.json` });
    assert(a.findings[0].line === ac1.findings[0].line + 20 && o.findings.some((f, i) => f.line !== ops1.findings[i].line), "(전제) 줄 번호는 실제로 밀렸음");
    assert([o.summary.new, p.summary.new, a.summary.new, v.mapper.summary.new, v.consistency.summary.new].every((x) => x === 0) && [o, p, a, v.mapper, v.consistency].every((r) => r.baseline.resolved === 0), "위에 줄을 끼워 넣어도 새 항목 0·해결 0(지문이 줄 번호에 묶이지 않음)");
  }

  // ── 새 항목이 생김 ──
  const NEW_HANDLER = `\n\t@PostMapping("/purge.do")\n\tpublic String deleteAllNotice(NoticeVO vo) {\n\t\tnoticeService.deleteNotice(vo);\n\t\treturn "redirect:/notice/list.do";\n\t}\n`;
  const d2 = project(FILES({ controller: CONTROLLER(NEW_HANDLER), app: `${APP}spring.devtools.restart.enabled=true\nmanagement.endpoints.web.exposure.include=*\n`, countConds: "", daoExtra: '  public void ghost2(Object v) { update("noticeDAO.ghostTwo", v); }\n' }));
  for (const f of ["ops", "privacy", "access", "validate"]) put(d2, `${B}/${f}.json`, readFileSync(path.join(d1, B, `${f}.json`), "utf8"));
  {
    const a = checkAccess({ projectDir: d2, baselinePath: `${B}/access.json` });
    const nw = a.findings.filter((f) => f.isNew);
    assert(a.summary.new === 1 && nw.length === 1 && nw[0].method === "deleteAllNotice" && nw[0].url === "/notice/purge.do" && a.baseline.resolved === 0 && a.findings.length === ac1.findings.length + 1, `검증 없는 변경 핸들러 하나 추가 → 접근 통제 새 항목 1(${nw[0]?.method} ${nw[0]?.url}), 원래 있던 것은 그대로`);
    assert(renderAccessMarkdown(a).includes(`- 비교: ${B}/access.json(이전 ${ac1.findings.length}건) — 새 항목 1건 · 해결 0건`) && renderAccessMarkdown(a).includes("| 🆕 "), "Markdown: 비교 한 줄과 새 항목 표시");
    const o = await checkOperations({ projectDir: d2, baselinePath: `${B}/ops.json` });
    assert(o.summary.new >= 1 && o.findings.filter((f) => f.isNew).every((f) => /devtools|exposure/.test(f.code)) && o.baseline.resolved === 0 && renderOperationsMarkdown(o).includes("새 항목"), `운영: 새로 넣은 설정만 새 항목(${o.findings.filter((f) => f.isNew).map((f) => f.rule).join(", ")})`);
    const v = await validateProject({ projectDir: d2, baselinePath: `${B}/validate.json` });
    const mNew = v.mapper.issues.filter((i) => i.isNew);
    assert(v.mapper.summary.new === 1 && mNew[0].ref === "noticeDAO.ghostTwo" && v.mapper.baseline.resolved === 0, "매퍼: 없는 문장을 부르는 호출 하나 추가 → 새 항목 1");
    assert(v.consistency.baseline.findings === va1.consistency.issues.length && v.consistency.summary.new === 0 && v.consistency.baseline.resolved === 0, "정합성: 같은 목록·건수 쌍이 여전히 어긋나면(조건이 더 빠져도) 같은 항목 — 새 항목 0");
    const p = checkPrivacy({ projectDir: d2, baselinePath: `${B}/privacy.json` });
    assert(p.summary.new === 0 && p.baseline.resolved === 0 && !renderPrivacyMarkdown(p).includes("🆕"), "개인정보: 바뀐 것이 없으면 새 항목 0");
  }
  // ── 이름을 바꾸면 해결 1 + 새 항목 1, 고치면 해결 ──
  {
    const d = project(FILES({ controller: CONTROLLER("", "removeNotice") }));
    put(d, `${B}/access.json`, ac1);
    const a = checkAccess({ projectDir: d, baselinePath: `${B}/access.json` });
    assert(a.summary.new === 1 && a.baseline.resolved === 1 && a.findings.find((f) => f.isNew).method === "removeNotice", "메서드 이름을 바꾸면 해결 1 + 새 항목 1(지문은 대상의 이름을 따름 — 문서에 적은 동작)");
    const fixed = project(FILES({ controller: CONTROLLER().replace("\t\tnoticeService.deleteNotice(vo);", '\t\tif (!EgovUserDetailsHelper.isAuthenticated()) return "redirect:/login.do";\n\t\tnoticeService.deleteNotice(vo);'), app: "server.port=8080\n" }));
    put(fixed, `${B}/access.json`, ac1); put(fixed, `${B}/ops.json`, ops1);
    const fa = checkAccess({ projectDir: fixed, baselinePath: `${B}/access.json` }), fo = await checkOperations({ projectDir: fixed, baselinePath: `${B}/ops.json` });
    put(fixed, `${B}/validate.json`, va1);
    const okCount = project(FILES({ countConds: `${COND("searchUseAt", "USE_AT")}\n    ${COND("searchCode", "NOTICE_CODE")}` }));
    put(okCount, `${B}/validate.json`, va1);
    const fv = await validateProject({ projectDir: okCount, baselinePath: `${B}/validate.json` });
    assert(fv.consistency.issues.length === 0 && fv.consistency.summary.new === 0 && fv.consistency.baseline.resolved === 1 && fv.mapper.baseline.resolved === 0, "정합성: 건수 쿼리에 빠진 조건을 넣으면 해결 1");
    assert(fa.summary.new === 0 && fa.baseline.resolved >= 1 && fo.summary.new === 0 && fo.baseline.resolved >= 2, `고치면 새 항목 0·해결로 셈(접근 통제 해결 ${fa.baseline.resolved}, 운영 해결 ${fo.baseline.resolved})`);
  }

  // ── 기준선 읽기 오류 ──
  {
    const err = (fn) => { try { fn(); return ""; } catch (e) { return e.message; } };
    assert(/baseline 이 없습니다: \.egovframe\/baseline\/none\.json/.test(err(() => checkAccess({ projectDir: d1, baselinePath: `${B}/none.json` }))), "없는 파일 → 오류");
    put(d1, `${B}/broken.json`, "{ not json");
    assert(/JSON 해석 실패/.test(err(() => checkAccess({ projectDir: d1, baselinePath: `${B}/broken.json` }))), "JSON 이 아니면 오류");
    const wrong = err(() => checkAccess({ projectDir: d1, baselinePath: `${B}/ops.json` }));
    assert(/check_egovframe_operations 의 결과입니다/.test(wrong) && /check_egovframe_access 의 format=json 결과/.test(wrong), `다른 도구의 결과를 주면 조용히 '전부 새 항목'이 되지 않고 오류(${wrong.slice(0, 60)}…)`);
    put(d1, `${B}/misc.json`, { hello: 1 });
    assert(/이 도구의 JSON 결과가 아닙니다/.test(err(() => checkPrivacy({ projectDir: d1, baselinePath: `${B}/misc.json` }))), "어느 도구의 결과도 아니면 오류");
    put(d1, `${B}/old.json`, { ...ac1, findings: ac1.findings.map(({ fingerprint, ...f }) => f) });
    assert(/지문\(fingerprint\)이 없습니다 — v1\.26\.0 이상/.test(err(() => checkAccess({ projectDir: d1, baselinePath: `${B}/old.json` }))), "지문 없는 옛 결과(v1.25 이하) → 다시 만들라는 오류");
    assert(/baselinePath/.test(err(() => checkAccess({ projectDir: d1, baselinePath: "../outside.json" }))), "프로젝트 밖 경로는 거부(오류 문구는 baselinePath)");
    const noMapper = await validateProject({ projectDir: d1, mapper: false });
    put(d1, `${B}/validate-nomapper.json`, noMapper);
    let msg = ""; try { await validateProject({ projectDir: d1, baselinePath: `${B}/validate-nomapper.json` }); } catch (e) { msg = e.message; }
    assert(/mapper 결과가 없습니다/.test(msg), "validate 기준선에 mapper 절이 없으면 오류");
    assert(baselineKindOf(ops1) === "operations" && baselineKindOf(pv1) === "privacy" && baselineKindOf(ac1) === "access" && baselineKindOf(va1) === "validate" && baselineKindOf({ runs: [] }) === "sarif" && baselineKindOf([]) === null, "결과 종류 판별");
    // 잘린 기준선
    const cut = await validateProject({ projectDir: d2, maxIssues: 1 });
    put(d2, `${B}/validate-cut.json`, cut);
    const vc = await validateProject({ projectDir: d2, baselinePath: `${B}/validate-cut.json` });
    assert(cut.mapper.truncated === true && cut.mapper.issues.length === 1 && vc.mapper.notes.some((x) => x.includes("잘린 결과")) && vc.mapper.summary.new === 1, "잘린 결과(maxIssues)를 기준선으로 주면 알림 — 잘린 뒤 항목이 새 항목으로 보임");
    const full = readCheckBaseline(d1, `${B}/access.json`, "access");
    assert(full.fingerprints.size === ac1.findings.length && full.truncated === false && applyBaseline([{ fingerprint: "x" }], full).newCount === 1, "readCheckBaseline·applyBaseline 직접 호출");
  }

  // ── 보안약점 점검(v0.44)의 지문 값은 그대로 ──
  {
    const d = project({ "pom.xml": "<project><artifactId>a</artifactId></project>", [`${J}/A.java`]: 'package kr.go.sample;\npublic class A {\n  void run(String cmd) throws Exception { Runtime.getRuntime().exec(cmd); }\n}\n' });
    const r = await checkSecureCoding({ projectDir: d });
    const f = r.findings[0];
    const expect = createHash("sha256").update(`${f.rule}|${f.file}|${f.code.replace(/\s+/g, " ")}|1`).digest("hex").slice(0, 32);
    assert(r.findings.length >= 1 && f.fingerprint === expect, `보안약점 지문 계산식 불변(${f.rule}) — 이미 커밋된 기준선·SARIF 가 그대로 맞음`);
    put(d, "base.json", r);
    const again = await checkSecureCoding({ projectDir: d, baselinePath: "base.json" });
    assert(again.summary.new === 0 && again.baseline.resolved === 0, "보안약점 기준선 동작 그대로");
  }

  // ── CLI ──
  {
    const run = async (argv) => { let out = "", err = ""; const code = await runCli(argv, { stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, cwd: root, env: {} }); return { code, out, err }; };
    const ok = await run(["access", "--project", d1, "--baseline-path", `${B}/access.json`, "--fail-on", "new>0"]);
    assert(ok.code === 0 && /새 항목 0 · 해결 0/.test(ok.err), `CLI access: 새 항목이 없으면 종료 코드 0(${ok.err.trim().slice(-60)})`);
    const bad = await run(["access", "--project", d2, "--baseline-path", `${B}/access.json`, "--fail-on", "new>0"]);
    assert(bad.code === 2 && /새 항목 1/.test(bad.err), "CLI access: 새 항목 1 → 종료 코드 2");
    const high = await run(["access", "--project", d1, "--fail-on", "high>0"]);
    assert(high.code === (ac1.summary.high > 0 ? 2 : 0), "기준선 없이 high>0 은 예전 그대로");
    const v = await run(["validate", "--project", d2, "--baseline-path", `${B}/validate.json`, "--fail-on", "new>0", "--json"]);
    assert(v.code === 2 && JSON.parse(v.out).mapper.summary.new === 1 && /새 항목 \d+ · 해결 \d+/.test(v.err), "CLI validate: mapper·consistency 새 항목 합계로 게이트(new = mapperNew + consistencyNew)");
    const o = await run(["ops", "--project", d2, "--baseline-path", `${B}/ops.json`, "--fail-on", "new>0"]);
    const p = await run(["privacy", "--project", d2, "--baseline-path", `${B}/privacy.json`, "--fail-on", "new>0"]);
    assert(o.code === 2 && p.code === 0, "CLI ops(새 항목 있음 → 2)·privacy(없음 → 0)");
    const jo = await run(["access", "--project", d2, "--json-out", path.join(d2, B, "access.json")]);
    const after = await run(["access", "--project", d2, "--baseline-path", `${B}/access.json`, "--fail-on", "new>0"]);
    assert(jo.code === 0 && after.code === 0, "--json-out 으로 기준선을 다시 만들면 그 뒤로는 통과");
    const wrong = await run(["access", "--project", d1, "--baseline-path", `${B}/ops.json`]);
    assert(wrong.code === 3 && /check_egovframe_operations/.test(wrong.err), "다른 도구의 결과를 주면 실행 실패(3)");
    const help = await run(["--help"]);
    assert(help.out.includes("--baseline-path"), "도움말에 --baseline-path");
  }

  // ── 생성 CI ──
  {
    const npx = `npx -y egovframe-scaffold-mcp@${SERVER_VERSION}`;
    const base = supplyChainCommands({ secureCoding: true }, true);
    const cmds = supplyChainCommands({ secureCoding: true, baselineDir: ".egovframe/baseline" }, true);
    assert(base.map((c) => c.id).join() === "sbom,sbom-check,secure,assess" && base[2].command.endsWith("--fail-on high"), "baselineDir 가 없으면 게이트는 예전 그대로");
    assert(cmds.map((c) => c.id).join() === "sbom,sbom-check,secure,ops,privacy,access,validate,assess", `baselineDir → 점검 단계 4개 추가(${cmds.map((c) => c.id).join()})`);
    assert(cmds[2].command.endsWith(`--baseline-path .egovframe/baseline/secure.json --fail-on "new>0"`) && cmds[5].command === `${npx} access --project . --baseline-path .egovframe/baseline/access.json --out egovframe-access.md --step-summary --fail-on "new>0"` && cmds[6].command.includes("validate --project . --max-issues 5000 --baseline-path .egovframe/baseline/validate.json"), "단계 명령: 기준선 경로·--fail-on \"new>0\"(validate 는 잘리지 않게 --max-issues)");
    assert(supplyChainCommands({ baselineDir: "./ci/base/" }).find((c) => c.id === "ops").command.includes("--baseline-path ci/base/ops.json") && !supplyChainCommands({ baselineDir: "b" }).some((c) => c.id === "secure"), "경로 정리(./·끝 /), secureCoding 이 없으면 보안약점 단계 없음");
    for (const bad of ["../x", "/abs/x", "a b", "a;rm", "a/../b", '"x"', "$(x)"]) { let threw = false; try { supplyChainCommands({ baselineDir: bad }); } catch { threw = true; } assert(threw && !CI_BASELINE_DIR_RE.test(bad), `baselineDir 거부: ${JSON.stringify(bad)}`); }
    const gh = generateCiYaml("maven", "17", { baselineDir: ".egovframe/baseline" }), gl = generateGitlabCi("gradle", "21", { baselineDir: ".egovframe/baseline" }), jf = generateJenkinsfile("maven", "17", { baselineDir: ".egovframe/baseline" });
    assert(gh.includes(`        run: ${npx} access --project . --baseline-path .egovframe/baseline/access.json`) && gh.includes("            egovframe-access.md") && gl.includes(`--fail-on "new>0"`) && gl.includes("      - egovframe-validate.md") && jf.includes("stage('Access control (new)')") && jf.includes('--fail-on "new>0"'), "세 플랫폼(GitHub·GitLab·Jenkins)에 단계와 보관 파일");
    assert(JSON.stringify(baselineCommands()) === JSON.stringify(["secure", "ops", "privacy", "access"].map((c) => `${npx} ${c} --project . --json-out .egovframe/baseline/${c}.json`).concat(`${npx} validate --project . --max-issues 5000 --json-out .egovframe/baseline/validate.json`)), "기준선을 만드는 명령(점검마다 --json-out)");
    const r = generateCiConfig({ projectDir: d1, supplyChain: true, baselineDir: B, supplier: "예시 기관", dryRun: true });
    assert(r.notes.some((x) => x.includes("새 항목만 실패") && x.includes(`${npx} access --project . --json-out ${B}/access.json`)) && !r.notes.some((x) => x.includes("아직 없습니다")), "generate_egovframe_ci: 기준선 만드는 명령을 안내(파일이 다 있으면 누락 안내 없음)");
    const r2 = generateCiConfig({ projectDir: d1, supplyChain: true, secureCoding: true, baselineDir: B, supplier: "예시 기관", dryRun: true });
    assert(r2.notes.some((x) => x.includes(`기준선 파일이 아직 없습니다: ${B}/secure.json`)), "없는 기준선 파일을 알림");
    let threw = ""; try { generateCiConfig({ projectDir: d1, baselineDir: B, dryRun: true }); } catch (e) { threw = e.message; }
    assert(/supplyChain=true/.test(threw), "baselineDir 은 supplyChain=true 와 함께");
  }

  // ── 평가서·포트폴리오 ──
  {
    const plain = await assessProject({ projectDir: d2 });
    assert(!plain.access.baseline && !plain.operations.baseline && newFindingsOf(plain) === null && !("newFindings" in rowFromAssessment("p", d2, "project", plain)), "baselineDir 가 없으면 평가서·포트폴리오 행은 예전 그대로");
    const a = await assessProject({ projectDir: d2, baselineDir: B });
    assert(a.operations.baseline?.new >= 1 && a.mapper.baseline?.new === 1 && a.privacy.baseline?.new === 0 && a.access.baseline && a.consistency.baseline && !a.secureCoding.baseline, `평가서: 기준선 파일이 있는 점검만 비교(운영 새 항목 ${a.operations.baseline?.new}·매퍼 ${a.mapper.baseline?.new}), secure.json 이 없는 보안약점은 비교 없음`);
    const md = renderAssessmentMarkdown(a);
    assert(md.includes(`- 기준선(${B}/ops.json, 이전 ${ops1.findings.length}건) 대비: **새 항목 ${a.operations.baseline.new}**`) && (md.match(/- 기준선\(/g) ?? []).length === 5, "평가서 Markdown: 점검 절마다 새 항목·해결·그대로");
    const total = [a.operations, a.privacy, a.access, a.mapper, a.consistency].reduce((s, x) => s + x.baseline.new, 0);
    assert(newFindingsOf(a) === total && rowFromAssessment("p", d2, "project", a).newFindings === total, `포트폴리오 행: newFindings = 점검 전체 새 항목 합계(${total})`);
  }

  // ── 납품 패키지 차수 비교 ──
  {
    const prev = { manifest: null, sbom: null, assessment: null, secure: null, dependencies: null, privacy: pv1, access: ac1 };
    const cur = { manifest: null, sbom: null, assessment: null, secure: null, dependencies: null, privacy: checkPrivacy({ projectDir: d2 }), access: checkAccess({ projectDir: d2 }) };
    const df = diffDeliveries("r1", prev, cur);
    assert(df.checks.access.added === 1 && df.checks.access.resolved === 0 && df.checks.access.from === ac1.findings.length && df.checks.privacy.added === 0 && df.changed === true, "납품 패키지 차수 비교: 접근 통제 새 항목 1 → changed");
    assert(renderDeliveryDiffMarkdown(df).includes("## 접근 통제") && renderDeliveryDiffMarkdown(df).includes("새 항목 1 · 해소 0"), "diff.md 에 접근 통제·개인정보 절");
    const same = diffDeliveries("r1", prev, { ...prev });
    assert(same.checks.access.added === 0 && same.checks.access.resolved === 0, "같은 결과면 차이 없음");
    const old = diffDeliveries("r1", { ...prev, access: { findings: ac1.findings.map(({ fingerprint, ...f }) => f) } }, cur);
    assert(!old.checks?.access && old.skipped.some((x) => x.includes("지문이 없음")), "이전 패키지가 v1.26 이전이면 건너뛰고 이유를 남김");
    assert(!diffDeliveries("r1", { ...prev, privacy: null, access: null }, cur).checks, "선택 항목이 한쪽에 없으면 비교하지 않음");
  }

  // ── MCP: 파라미터·출력 스키마 ──
  {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = buildServer(); await server.connect(st);
    const client = new Client({ name: "t", version: "1" }); await client.connect(ct);
    const tools = (await client.listTools()).tools;
    const has = (name, prop) => !!tools.find((t) => t.name === name)?.inputSchema.properties[prop];
    assert(["check_egovframe_operations", "check_egovframe_privacy", "check_egovframe_access", "validate_egovframe_project", "check_egovframe_secure_coding"].every((t) => has(t, "baselinePath")) && has("generate_egovframe_ci", "baselineDir") && has("generate_egovframe_report", "baselineDir") && has("validate_egovframe_project", "maxIssues"), "도구 파라미터: 점검 5종 baselinePath, CI·평가서 baselineDir");
    const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return r; };
    const a = await call("check_egovframe_access", { projectDir: d2, baselinePath: `${B}/validate.json`, format: "json" });
    assert(a.isError === true, "MCP: 다른 도구의 기준선 → isError");
    for (const [name, args, pick] of [["check_egovframe_operations", { projectDir: d2, baselinePath: `${B}/ops.json` }, (s) => s], ["check_egovframe_privacy", { projectDir: d2, baselinePath: `${B}/privacy.json` }, (s) => s], ["validate_egovframe_project", { projectDir: d2, baselinePath: `${B}/validate.json` }, (s) => s.mapper]]) {
      const r = await call(name, args);
      const parsed = OUTPUT_SCHEMAS[name].safeParse(r.structuredContent);
      assert(!r.isError && parsed.success && pick(r.structuredContent).baseline && typeof pick(r.structuredContent).summary.new === "number", `MCP ${name}: 구조화 출력이 스키마를 통과하고 baseline·summary.new 포함`);
    }
    await client.close(); await server.close();
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`baseline FAIL (${n} assertions)`); else console.log(`baseline OK (${n} assertions)`);
