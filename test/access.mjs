// node test/access.mjs — 접근 통제 점검(v1.24) 게이트 (오프라인, 플랫폼 중립)
//   핸들러 해석(클래스·메서드 매핑, 주석·문자열 제외) · 하는 일(C·R·U·D) · 검증 수준(없음<로그인<역할<소유권) · 전역 보호(Spring Security·인터셉터·
//   표준프레임워크 보호자원) · 누락 의심 4종(검증 없는 변경·형제 불일치·소유권·상세) · 예외 파일 · CSV · 규칙 팩 · 평가서·납품·CLI·MCP
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAccessRules, checkAccess, renderAccessMarkdown, renderAccessCsv, parseControllerHandlers, detectGlobalAccess, antToRegExp, maskJava, ACCESS_IGNORE_FILE, assessProject, renderAssessmentMarkdown, prepareDelivery, runCli, buildServer, OUTPUT_SCHEMAS, listRules } from "../dist/index.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const root = mkdtempSync(path.join(tmpdir(), "egov-access-"));
let k = 0;
const w = (dir, rel, text) => { const f = path.join(dir, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, typeof text === "string" ? text : JSON.stringify(text, null, 2)); };
const POM = "<project><modelVersion>4.0.0</modelVersion><groupId>kr.go</groupId><artifactId>sample</artifactId><version>1.0.0</version></project>\n";
const J = "src/main/java/kr/go/sample";
const NOTICE = `package kr.go.sample;

@Controller
@RequestMapping("/notice")
public class NoticeController {
	@Resource(name = "noticeService") private NoticeService noticeService;

	/** 목록 — isAuthenticated() 는 주석 안에만 있다 */
	@GetMapping("/list.do")
	public String selectNoticeList(ModelMap model) {
		model.addAttribute("list", noticeService.selectNoticeList());
		return "notice/list";
	}

	@RequestMapping(value = "/detail.do", method = RequestMethod.GET)
	public String selectNoticeDetail(NoticeVO vo, ModelMap model) {
		NoticeVO found = noticeService.selectNotice(vo);
		EgovAuthorizationHelper.assertOwner(found.getFrstRegisterId());
		model.addAttribute("result", found);
		return "notice/detail";
	}

	@RequestMapping("/view.do")
	public String selectNoticeView(NoticeVO vo, ModelMap model) {
		String hint = "assertOwner(";
		NoticeVO found = noticeService.selectNotice(vo);
		model.addAttribute("owner", found.getFrstRegisterId());
		return "notice/view";
	}

	@PostMapping("/insert.do")
	public String insertNotice(NoticeVO vo) {
		if (!EgovUserDetailsHelper.isAuthenticated()) { return "redirect:/login.do"; }
		noticeService.insertNotice(vo);
		return "forward:/notice/list.do";
	}

	@PostMapping({"/update.do", "/modify.do"})
	public String updateNotice(NoticeVO vo) {
		if (!EgovUserDetailsHelper.isAuthenticated()) { return "redirect:/login.do"; }
		noticeService.updateNotice(vo);
		return "forward:/notice/list.do";
	}

	@PostMapping("/delete.do")
	public String deleteNotice(NoticeVO vo) {
		LoginVO user = (LoginVO) EgovUserDetailsHelper.getAuthenticatedUser();
		NoticeVO found = noticeService.selectNotice(vo);
		if (!found.getFrstRegisterId().equals(user.getUniqId())) { throw new IllegalStateException("권한 없음"); }
		noticeService.deleteNotice(vo);
		return "forward:/notice/list.do";
	}

	@PostMapping("/purge.do")
	public String removeAll() {
		noticeService.deleteAllNotice();
		return "forward:/notice/list.do";
	}

	@GetMapping("/insertView.do")
	public String insertNoticeView() { return "notice/regist"; }
}
`;
const ADMIN = `package kr.go.sample;

@RestController
public class CodeController {
	private final CodeService codeService;
	public CodeController(CodeService codeService) { this.codeService = codeService; }

	@PreAuthorize("hasRole('ADMIN')")
	@PostMapping("/admin/code")
	public void saveCode(@RequestBody CodeVO vo) { codeService.insertCode(vo); }

	@PutMapping("/admin/code/{id}")
	public void changeCode(@PathVariable String id, @RequestBody CodeVO vo) { codeService.updateCode(vo); }

	@DeleteMapping("/admin/code/{id}")
	public void dropCode(@PathVariable String id) {
		java.util.List<String> auth = EgovUserDetailsHelper.getAuthorities();
		if (auth == null || !auth.contains("ROLE_ADMIN")) { throw new IllegalStateException("권한 없음"); }
		codeService.deleteCode(id);
	}

	@GetMapping(value = "/admin/code", produces = "application/json")
	public java.util.List<CodeVO> codes() { return codeService.selectCodeList(); }
}
`;
const project = (extra = {}) => { const d = path.join(root, `p${k++}`); w(d, "pom.xml", POM); w(d, `${J}/NoticeController.java`, NOTICE); w(d, `${J}/CodeController.java`, ADMIN); w(d, `${J}/NoticeService.java`, "package kr.go.sample;\npublic interface NoticeService { }\n"); for (const [f, t] of Object.entries(extra)) w(d, f, t); return d; };
const H = (r, m) => r.handlers.find((h) => h.method === m);
const F = (r, m) => r.findings.find((f) => f.method === m);

try {
  // ── 규칙 데이터·보조 함수 ──
  const rules = loadAccessRules();
  assert(rules.schemaVersion === 1 && rules.sources.length >= 3 && ["loginCalls", "roleCalls", "ownerCalls", "ownerFields", "serviceReceivers", "authInterceptors"].every((x) => typeof rules[x] === "string" && rules[x].length > 10) && Object.keys(rules.verbs).join() === "create,update,delete,read" && rules.publicUrlPatterns.length >= 5 && typeof rules.note_en === "string", "규칙 데이터: 호출 사전 3종·동사·공개 경로·출처(ko/en)");
  assert(maskJava('a(); // x "y"\nString s = "isAuthenticated()"; /* z */ b();') === 'a();         \nString s = "                 ";         b();' && maskJava('@X("/a")', true) === '@X("/a")' && antToRegExp("/admin/**").test("/admin/a/b.do") && antToRegExp("/**/*.do").test("/a/b.do") && antToRegExp("/**/*.do").test("/b.do") && !antToRegExp("/cop/*.do").test("/cop/a/b.do") && antToRegExp("/cop/bbs/*Master*.do").test("/cop/bbs/selectMasterList.do"), "주석·문자열 가리기(줄·길이 보존), Ant 패턴(**·*)");

  // ── 핸들러 해석 ──
  const hs = parseControllerHandlers("NoticeController.java", NOTICE);
  assert(hs.length === 8 && hs.map((h) => h.method).join() === "selectNoticeList,selectNoticeDetail,selectNoticeView,insertNotice,updateNotice,deleteNotice,removeAll,insertNoticeView" && hs[0].urls.join() === "/notice/list.do" && hs[4].urls.join() === "/notice/update.do,/notice/modify.do" && hs[1].http.join() === "GET" && hs[3].http.join() === "POST" && hs[0].line === 9 && parseControllerHandlers("X.java", "public class X { @GetMapping(\"/a\") public void a() {} }").length === 0, "핸들러 해석: 클래스 접두 + 메서드 경로(배열), HTTP 메서드, 줄 번호, @Controller 가 아니면 없음");
  const ah = parseControllerHandlers("CodeController.java", ADMIN);
  assert(ah.length === 4 && ah[3].urls.join() === "/admin/code" && ah[1].http.join() === "PUT" && ah[0].annotations.includes("@PreAuthorize"), "REST 매핑(@Put·@Delete), produces 의 문자열은 경로가 아님, 메서드 어노테이션 수집");

  // ── 수준·하는 일 ──
  const p = project();
  const r = checkAccess({ projectDir: p });
  const lv = (m) => `${H(r, m).action}/${H(r, m).level}`;
  assert(lv("selectNoticeList") === "read/none" && lv("selectNoticeDetail") === "read/owner" && lv("selectNoticeView") === "read/none" && lv("insertNotice") === "create/login" && lv("updateNotice") === "update/login" && lv("deleteNotice") === "delete/owner" && lv("removeAll") === "delete/none" && lv("insertNoticeView") === "read/none", "검증 수준·하는 일: 주석·문자열 안의 호출은 세지 않음, 등록자 비교는 소유권, *View 는 읽기");
  assert(lv("saveCode") === "create/role" && lv("changeCode") === "update/none" && lv("dropCode") === "delete/role" && lv("codes") === "read/none" && H(r, "saveCode").evidence.some((e) => e.includes("@PreAuthorize")) && H(r, "dropCode").evidence.some((e) => e.includes("getAuthorities")), "어노테이션(@PreAuthorize)·getAuthorities 는 역할, 근거 기록");
  assert(r.summary.controllers === 2 && r.summary.handlers === 12 && r.summary.writes === 7 && r.summary.writesWithoutCheck === 2 && r.summary.byLevel.owner === 2 && r.global.kind === "none" && H(r, "updateNotice").ownerData === true, `집계: 컨트롤러 2·핸들러 12·변경 7(검증 없음 2), 전역 보호 없음`);

  // ── 누락 의심 ──
  assert(F(r, "removeAll")?.kind === "sibling-mismatch" && F(r, "removeAll").severity === "high" && F(r, "removeAll").sibling.method === "deleteNotice" && F(r, "updateNotice")?.kind === "sibling-mismatch" && F(r, "updateNotice").sibling.level === "owner", "형제 불일치(높음): 같은 컨트롤러의 삭제는 소유권을 확인 — 근거로 형제 메서드");
  assert(!F(r, "insertNotice") && F(r, "changeCode")?.kind === "sibling-mismatch" && F(r, "changeCode").sibling.level === "role" && !F(r, "saveCode") && !F(r, "dropCode") && !F(r, "codes"), "등록은 형제가 소유권이어도 로그인이면 통과, 역할 형제보다 낮은 수정은 보고");
  assert(F(r, "selectNoticeView")?.kind === "unprotected-detail" && F(r, "selectNoticeView").severity === "low" && !F(r, "selectNoticeList") && !F(r, "insertNoticeView"), "상세 조회(낮음): 형제 상세는 소유권 확인 — 목록·등록 화면은 제외");
  const solo = project();
  w(solo, `${J}/NoticeController.java`, NOTICE.replace(/\t@PostMapping\("\/delete\.do"\)[\s\S]*?\n\t}\n\n/, "").replace("EgovAuthorizationHelper.assertOwner(found.getFrstRegisterId());", ""));
  w(solo, `${J}/CodeController.java`, ADMIN.replace('@PreAuthorize("hasRole(\'ADMIN\')")\n', "").replace(/java\.util\.List<String> auth[\s\S]*?권한 없음"\); }\n/, ""));
  const rs = checkAccess({ projectDir: solo });
  assert(F(rs, "updateNotice")?.kind === "missing-ownership" && F(rs, "updateNotice").severity === "medium" && /CWE-639/.test(F(rs, "updateNotice").message) && F(rs, "removeAll")?.kind === "unprotected-write" && F(rs, "saveCode")?.kind === "unprotected-write" && F(rs, "saveCode").severity === "high" && F(rs, "dropCode")?.severity === "high", "소유권 누락(중간): 로그인만 확인하는 수정 · 검증 없는 변경(높음, 전역 보호 없음)");

  // ── 전역 보호 ──
  const sec = project({ [`${J}/SecurityConfig.java`]: 'package kr.go.sample;\n@Configuration\npublic class SecurityConfig {\n  @Bean\n  SecurityFilterChain chain(HttpSecurity http) throws Exception {\n    http.authorizeHttpRequests(a -> a.requestMatchers("/notice/list.do", "/login.do").permitAll().requestMatchers("/admin/**").hasRole("ADMIN").anyRequest().authenticated());\n    return http.build();\n  }\n}\n' });
  w(sec, `${J}/CodeController.java`, ADMIN.replace('@PreAuthorize("hasRole(\'ADMIN\')")\n', "").replace(/java\.util\.List<String> auth[\s\S]*?권한 없음"\); }\n/, ""));
  const rg = checkAccess({ projectDir: sec });
  assert(rg.global.kind === "spring-security" && rg.global.file.endsWith("SecurityConfig.java") && rg.global.protect.join() === "/admin/**,/**" && rg.global.exclude.join() === "/notice/list.do,/login.do" && H(rg, "selectNoticeList").globalLogin === false && H(rg, "saveCode").globalLogin === true && F(rg, "saveCode").severity === "medium" && F(rg, "saveCode").message.includes("SecurityConfig.java"), "Spring Security: permitAll 은 제외·나머지는 보호 — 전역 로그인으로 막힌 검증 없는 변경은 중간");
  const xml = project({ "src/main/webapp/WEB-INF/config/springmvc/dispatcher-servlet.xml": '<beans>\n<!-- <mvc:interceptor><mvc:mapping path="/old/**"/><bean class="a.AuthenticInterceptor"/></mvc:interceptor> -->\n<mvc:interceptors>\n<mvc:interceptor>\n<mvc:mapping path="/**/*.do"/>\n<mvc:exclude-mapping path="/notice/list.do"/>\n<bean class="kr.go.sample.AuthenticInterceptor"/>\n</mvc:interceptor>\n<mvc:interceptor><mvc:mapping path="/**"/><bean class="kr.go.sample.LocaleInterceptor"/></mvc:interceptor>\n</mvc:interceptors>\n</beans>\n' });
  const rx = checkAccess({ projectDir: xml });
  assert(rx.global.kind === "interceptor" && rx.global.protect.join() === "/**/*.do" && rx.global.exclude.join() === "/notice/list.do" && H(rx, "removeAll").globalLogin === true && H(rx, "saveCode").globalLogin === false, "인증 인터셉터(XML): 주석 처리된 것·인증이 아닌 인터셉터는 제외, .do 가 아닌 REST 경로는 범위 밖");
  const egov = project({ "src/main/resources/egovframework/egovProps/globals.properties": "Globals.DbType = mysql\nGlobals.Auth = security\n" });
  w(egov, `${J}/CodeController.java`, ADMIN.replace('@PreAuthorize("hasRole(\'ADMIN\')")\n', "").replace(/java\.util\.List<String> auth[\s\S]*?권한 없음"\); }\n/, ""));
  const re = checkAccess({ projectDir: egov });
  assert(re.global.kind === "egov-security" && re.global.file.endsWith("globals.properties") && H(re, "saveCode").globalLogin === null && F(re, "saveCode").severity === "medium" && F(re, "saveCode").message.includes("보호자원") && F(re, "removeAll").severity === "high" && re.notes.some((x) => x.includes("보호자원")), "표준프레임워크 보안(Globals.Auth=security): 역할–URL 은 DB — 검증 없는 변경은 '확인 필요'(중간), 형제 불일치는 그대로 높음");
  // v1.26.1: 5.1.0 실행환경 보안(fdl-security Java Configuration) — 공식 템플릿이 2026-11-27 부터 쓰는 방식
  const e51 = project({ "src/main/resources/egovframework/egovProps/conf/egov-security-config.properties": "loginUrl = /login.do\npermitAllList = /, /css/**\nsqlRolesAndUrl = SELECT A.ROLE_PTTRN AS url, B.AUTHOR_CODE AS authority FROM ROLEINFO A, AUTHORROLE B\n" });
  w(e51, `${J}/CodeController.java`, ADMIN.replace('@PreAuthorize("hasRole(\'ADMIN\')")\n', "").replace(/java\.util\.List<String> auth[\s\S]*?권한 없음"\); }\n/, ""));
  const r51 = checkAccess({ projectDir: e51 });
  assert(r51.global.kind === "egov-security" && r51.global.file.endsWith("egov-security-config.properties") && F(r51, "saveCode").severity === "medium", "5.1.0 실행환경 보안(egov-security-config.properties 의 sqlRolesAndUrl): 보호자원 방식으로 인식 — 검증 없는 변경은 중간");
  const bean = project({ "src/main/resources/egovframework/spring/com/context-security.xml": '<beans>\n\t<bean class="org.egovframe.rte.fdl.security.config.EgovSecurityConfiguration"/>\n</beans>\n' });
  const off = project({ "src/main/resources/egovframework/spring/com/context-security.xml": '<beans>\n\t<!-- <bean class="org.egovframe.rte.fdl.security.config.EgovSecurityConfiguration"/> -->\n</beans>\n', "src/main/resources/egovframework/egovProps/conf/egov-security-config.properties": "# sqlRolesAndUrl = SELECT 1\nloginUrl = /login.do\n" });
  const imp = project({ [`${J}/SecConfig.java`]: "package kr.go.sample;\nimport org.egovframe.rte.fdl.security.config.EgovSecurityConfiguration;\n@Configuration\n@Import(EgovSecurityConfiguration.class)\npublic class SecConfig {}\n" });
  assert(checkAccess({ projectDir: bean }).global.kind === "egov-security" && checkAccess({ projectDir: imp }).global.kind === "egov-security" && checkAccess({ projectDir: off }).global.kind === "none", "EgovSecurityConfiguration 빈(XML)·@Import(Java)도 인식, 주석 처리된 빈·설정 키는 아님");
  const csrf = detectGlobalAccess([{ rel: "A.java", abs: (() => { const f = path.join(root, "A.java"); writeFileSync(f, "@Configuration class A { @Bean SecurityFilterChain c(HttpSecurity h) { h.csrf(x -> x.disable()); return h.build(); } }"); return f; })() }], rules);
  assert(csrf.kind === "none", "URL 규칙이 없는 SecurityFilterChain(CSRF 전용)은 전역 보호로 보지 않음");

  // ── 공개 경로 · 예외 파일 ──
  const pub = project({ [`${J}/LoginController.java`]: 'package kr.go.sample;\n@Controller\npublic class LoginController {\n  private LoginService loginService;\n  @PostMapping("/uat/uia/actionLogin.do")\n  public String actionLogin(LoginVO vo) { loginService.insertLoginLog(vo); return "main"; }\n  @PostMapping("/join/insertMember.do")\n  public String insertMember(MemberVO vo) { loginService.insertMember(vo); return "main"; }\n}\n' });
  const rp = checkAccess({ projectDir: pub });
  assert(!F(rp, "actionLogin") && F(rp, "insertMember")?.kind === "unprotected-write", "공개 경로 사전(로그인)은 누락 의심에서 제외, 회원 가입 같은 의도된 공개는 예외 파일로");
  w(pub, ACCESS_IGNORE_FILE, { ignores: [{ rule: "unprotected-write", path: `${J}/LoginController.java`, reason: "회원 가입은 로그인 없이 호출", reviewer: "보안담당" }, { rule: "sibling-mismatch", path: `${J}/NoticeController.java`, line: 50, reason: "x", reviewer: "y" }] });
  const ri = checkAccess({ projectDir: pub });
  assert(!F(ri, "insertMember") && ri.summary.suppressed === 1 && ri.ignoreFile === ACCESS_IGNORE_FILE && ri.invalidIgnores.length === 1 && ri.summary.high === rp.summary.high - 1, "예외 파일: 사유·검토자가 있는 항목만 적용(사유가 짧으면 무효로 보고)");

  // ── 출력 ──
  const md = renderAccessMarkdown(r), csv = renderAccessCsv(r);
  assert(md.includes("## URL 권한 표") && md.includes("## 누락 의심") && md.includes("`/notice/purge.do`") && md.includes("(형제 deleteNotice:") && md.includes(ACCESS_IGNORE_FILE) && csv.startsWith("﻿") && csv.split("\r\n").length === r.handlers.length + 2 && csv.includes("/notice/update.do /notice/modify.do,POST,update,login") && csv.includes("high:sibling-mismatch"), "Markdown(누락 의심·URL 권한 표)·CSV(BOM·핸들러마다 한 줄·누락 표시)");
  assert(OUTPUT_SCHEMAS.check_egovframe_access.safeParse(r).success && OUTPUT_SCHEMAS.check_egovframe_access.safeParse(rg).success && typeof r.durationMs === "number" && !("rulePacks" in r), "구조화 출력 스키마 통과, 팩이 없으면 rulePacks 없음");

  // ── 규칙 팩(access 절) ──
  {
    const custom = project({ [`${J}/OrgController.java`]: 'package kr.go.sample;\n@Controller\npublic class OrgController {\n  private OrgService orgService;\n  @PostMapping("/org/update.do")\n  public String updateOrg(OrgVO vo) { OrgGuard.requireManager(); orgService.updateOrg(vo); return "x"; }\n  @PostMapping("/open/apply.do")\n  public String insertApply(OrgVO vo) { orgService.insertApply(vo); return "x"; }\n}\n' });
    const pk = path.join(root, "pack");
    w(pk, "rule-pack.json", { schemaVersion: 1, name: "org-access", version: "1", access: { roleCalls: ["OrgGuard\\s*\\.\\s*requireManager\\s*\\("], publicUrlPatterns: ["/open/**"] } });
    const a0 = checkAccess({ projectDir: custom }), a1 = checkAccess({ projectDir: custom, rulePacks: [pk] });
    const bad = path.join(root, "badpack");
    w(bad, "rule-pack.json", { schemaVersion: 1, name: "bad", version: "1", access: { ownerCalls: ["("], publicUrlPatterns: ["open/**"], extra: 1 } });
    let msg = ""; try { checkAccess({ projectDir: custom, rulePacks: [bad] }); } catch (e) { msg = e.message; }
    assert(H(a0, "updateOrg").level === "none" && H(a1, "updateOrg").level === "role" && F(a0, "insertApply") && !F(a1, "insertApply") && a1.rulePacks[0].sections.join() === "access" && listRules({ rulePacks: [pk], tools: ["access"] }).rules.length === 2 && msg.includes("access.ownerCalls[0]") && msg.includes("publicUrlPatterns") && msg.includes("extra"), "규칙 팩 access 절: 기관의 검증 호출·공개 경로를 얹음, 잘못된 팩은 사유와 함께 거부");
  }

  // ── 평가서 · 납품 · CLI · MCP ──
  {
    const a = await assessProject({ projectDir: p });
    assert(a.access.handlers === 12 && a.access.writes === 7 && a.access.high === r.summary.high && renderAssessmentMarkdown(a).includes("### 접근 통제 (`check_egovframe_access`)"), "평가서: 접근 통제 건수와 절");
    const out = path.join(root, "delivery");
    const dv = await prepareDelivery({ projectDir: p, outputDir: out, dryRun: false, include: ["access"] });
    assert(dv.items[0].id === "access" && dv.items[0].status === "ok" && ["access/access.md", "access/access.json", "access/url-permissions.csv"].every((f) => existsSync(path.join(out, f))) && readFileSync(path.join(out, "access/url-permissions.csv"), "utf8").includes("/notice/purge.do") && OUTPUT_SCHEMAS.prepare_egovframe_delivery.safeParse({ mode: "prepare", ...dv }).success && (await prepareDelivery({ projectDir: p, outputDir: path.join(root, "d2"), dryRun: true })).items.every((x) => x.id !== "access"), "납품 패키지 선택 항목 access(md·json·URL 권한 표 CSV) — 기본 include 는 그대로");
    const io = () => { const o = [], e = []; return { o, e, io: { cwd: p, stdout: (s) => o.push(s), stderr: (s) => e.push(s), env: {} } }; };
    const c1 = io(), c2 = io(), c3 = io();
    assert(await runCli(["access", "--project", ".", "--fail-on", "high>0"], c1.io) === 2 && c1.e.join("").includes("누락 의심 높음") && await runCli(["access", "--project", ".", "--fail-on", "high>99"], c2.io) === 0 && await runCli(["access", "--project", ".", "--format", "csv"], c3.io) === 0 && c3.o.join("").includes("/notice/list.do"), "CLI access: --fail-on high>0(종료 코드 2)·--format csv");
    const tool = buildServer()._registeredTools.check_egovframe_access;
    assert(tool && tool.annotations.readOnlyHint === true && tool.outputSchema && tool.inputSchema.safeParse({ projectDir: "/x" }).data.format === "markdown" && !tool.inputSchema.safeParse({ projectDir: "/x", format: "xml" }).success, "MCP: 등록됨·읽기 전용·outputSchema·format enum");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`access FAIL (${n} assertions)`); else console.log(`access OK (${n} assertions)`);
