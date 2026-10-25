// node test/secure-flow.mjs — 보안약점 점검의 메서드 안 데이터 흐름 (v1.5, 오프라인)
//   (1) analyzeJavaFlows 단위: 소스(요청 파라미터·헤더·Spring 바인딩·업로드 파일명) → 대입·결합·append·for → 위험 호출, 정화 함수, 상수
//   (2) 사람이 판정한 표본(TP: 실제 취약, FP: 안전)으로 흐름 분석 전후의 정밀도·재현율을 수치로 비교
//   (3) SARIF codeFlows·지문 유지·dataFlow=false
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateSarif } from "./spec-schemas.mjs";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");

// ── (1) 단위 ─────────────────────────────────────────
const unit = (body, header = "public String a(@RequestParam(\"id\") String id, HttpServletRequest request, Model model) throws Exception") =>
  m.analyzeJavaFlows(`@Controller\nclass C {\n  ${header} {\n${body}\n    return null;\n  }\n}\n`);
const st = (flows, line) => flows.find((f) => f.line === line)?.status ?? "none";
{
  const f = unit([
    `    String sql = "select * from t where id = '" + id + "'";`,  // 4
    `    stmt.executeQuery(sql);`,                                       // 5 tainted(파라미터 → 대입)
    `    stmt.executeQuery("select * from " + TABLE + " where x = 1");`, // 6 constant(상수만)
    `    String f = request.getParameter("f");`,                        // 7
    `    new File("/data/" + f);`,                                       // 8 tainted
    `    new File(EgovWebUtil.filePathBlackList(request.getParameter("g")));`, // 9 정화 → unknown
    `    int no = Integer.parseInt(request.getParameter("no"));`,       // 10
    `    stmt.executeQuery("select * from t limit " + no);`,             // 11 숫자 변환 → tainted 아님
    `    StringBuilder sb = new StringBuilder("rm ");`,                 // 12
    `    sb.append(request.getHeader("x-path"));`,                      // 13
    `    Runtime.getRuntime().exec(sb.toString());`,                     // 14 tainted(append)
    `    for (String p : request.getParameterValues("p")) { new File(p); }`, // 15 tainted(for)
    `    response.sendRedirect("/main.do");`,                           // 16 constant
    `    String name = file.getOriginalFilename();`,                    // 17
    `    Files.write(Paths.get(uploadDir, name), bytes);`,              // 18 tainted(업로드 파일명)
  ].join("\n"));
  assert(st(f, 5) === "tainted" && f.find((x) => x.line === 5).path.map((p) => p.line).join(",") === "3,4,5", `파라미터(@RequestParam) → 대입 → executeQuery: tainted, 경로 L3→L4→L5`);
  assert(st(f, 6) === "constant", "상수(TABLE)만 결합한 SQL: constant");
  assert(st(f, 8) === "tainted" && st(f, 9) === "unknown", "request.getParameter → 변수 → new File: tainted / EgovWebUtil.filePathBlackList 로 정화: unknown");
  assert(st(f, 11) === "unknown", "Integer.parseInt 로 바꾼 값: tainted 아님");
  assert(st(f, 14) === "tainted" && st(f, 15) === "tainted", "StringBuilder.append → exec, for-each 요청 값 → new File: tainted");
  assert(st(f, 16) === "constant" && st(f, 18) === "tainted", "고정 리다이렉트: constant / 업로드 파일명 → Paths.get: tainted");
}
{
  // 컨트롤러가 아니면 바인딩 파라미터는 소스가 아님(메서드 간 흐름은 보지 않음)
  const f = m.analyzeJavaFlows(`class Svc {\n  void a(String path) {\n    new File(path);\n  }\n}\n`);
  assert(st(f, 3) === "unknown", "서비스 메서드의 파라미터 → new File: unknown(메서드 간 흐름은 판단 불가)");
  const g = m.analyzeJavaFlows(`@RestController\nclass R {\n  @PostMapping("/x")\n  public void a(SearchVO vo) throws Exception {\n    String sql = "select * from t order by " + vo.getSortColumn();\n    jdbcTemplate.queryForList(sql);\n  }\n}\n`);
  assert(st(g, 6) === "tainted", "@RestController 매핑 메서드의 VO 파라미터 getter → jdbcTemplate.queryForList: tainted");
  const h = m.analyzeJavaFlows(`class A {\n  void a() {\n    if (x) {\n      run(() -> { new File(base); });\n    }\n  }\n}\n`);
  assert(h.every((x) => x.status !== "tainted"), "람다·if 블록 안: 소스 없으면 tainted 아님");
}

// ── (2) 표본 정밀도 ────────────────────────────────────
// TP: 외부 입력이 실제로 위험 호출에 들어감, FP: 안전(상수·정화). 줄 끝 주석 //TP · //FP 가 정답
const SAMPLE = `package egovframework.example.web;
@Controller
public class SampleController {
  private static final String TABLE = "COMTNBOARD";
  @GetMapping("/a.do")
  public String a(@RequestParam("id") String id, @RequestParam("sort") String sort, HttpServletRequest request, HttpServletResponse response) throws Exception {
    stmt.executeQuery("select * from " + TABLE + " where use_at = 'Y'"); //FP
    stmt.executeQuery("select * from t where id = '" + id + "'"); //TP
    String q = "select * from t order by " + sort;
    stmt.executeQuery(q); //TP
    String q2 = "select count(*) from " + TABLE;
    stmt.executeQuery(q2); //FP
    new ProcessBuilder("df", "-h").start(); //FP
    Runtime.getRuntime().exec("ls -al /var/log"); //FP
    String target = request.getParameter("dir");
    Runtime.getRuntime().exec(new String[] { "ls", target }); //TP
    String f = request.getParameter("file");
    java.io.File file = new java.io.File("/upload/" + f); //TP
    String back = request.getParameter("returnUrl");
    response.sendRedirect(back); //TP
    stmt.executeUpdate("delete from " + TABLE + " where reg_dt < sysdate - 30"); //FP
    String cmd = "uptime";
    Runtime.getRuntime().exec(cmd); //FP
    return "ok";
  }
}
`;
const root = mkdtempSync(path.join(tmpdir(), "egov-secure-flow-"));
try {
  const dir = path.join(root, "src/main/java/egovframework/example/web");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SampleController.java"), SAMPLE);
  writeFileSync(path.join(root, "pom.xml"), "<project/>");
  const lines = SAMPLE.split("\n");
  const label = new Map(lines.map((l, i) => [i + 1, /\/\/TP\s*$/.test(l) ? "TP" : /\/\/FP\s*$/.test(l) ? "FP" : null]).filter(([, v]) => v));
  const RULES = ["sql-jdbc-concat", "os-command", "path-traversal", "open-redirect"];
  const measure = (r) => {
    const f = r.findings.filter((x) => RULES.includes(x.rule));
    const high = f.filter((x) => x.severity === "high");
    const reported = f.filter((x) => x.severity !== "low");
    const tpAll = [...label.values()].filter((v) => v === "TP").length;
    const tpHigh = high.filter((x) => label.get(x.line) === "TP").length;
    const tpFound = new Set(reported.filter((x) => label.get(x.line) === "TP").map((x) => x.line)).size;
    return { high: high.length, precisionHigh: high.length ? tpHigh / high.length : 1, recall: tpFound / tpAll, fpReported: reported.filter((x) => label.get(x.line) === "FP").length };
  };
  const before = measure(await m.checkSecureCoding({ projectDir: root, rules: RULES, dataFlow: false }));
  const afterR = await m.checkSecureCoding({ projectDir: root, rules: RULES });
  const after = measure(afterR);
  const fmt = (x) => `high ${x.high} · 정밀도(high) ${(x.precisionHigh * 100).toFixed(0)}% · 재현율(medium 이상) ${(x.recall * 100).toFixed(0)}% · 중간 이상 오탐 ${x.fpReported}`;
  console.log(`  흐름 전: ${fmt(before)}\n  흐름 후: ${fmt(after)}`);
  assert(after.precisionHigh === 1 && after.precisionHigh > before.precisionHigh, `표본 정밀도(high): ${(before.precisionHigh * 100).toFixed(0)}% → ${(after.precisionHigh * 100).toFixed(0)}%`);
  assert(after.recall === 1 && after.recall > before.recall, `표본 재현율: ${(before.recall * 100).toFixed(0)}% → ${(after.recall * 100).toFixed(0)}% (변수를 거친 요청 값)`);
  assert(after.fpReported === 0 && after.fpReported < before.fpReported, `중간 이상 오탐: ${before.fpReported} → ${after.fpReported} (상수만 결합 → 낮음)`);
  assert(afterR.dataFlow.enabled && afterR.dataFlow.detected >= 2 && afterR.findings.filter((f) => f.flow?.detected).every((f) => /데이터 흐름으로 찾음/.test(f.note)), `패턴 밖에서 흐름으로 찾은 항목 ${afterR.dataFlow.detected}건(note 에 경로)`);

  // (3) SARIF codeFlows, 지문, markdown
  const sarif = m.toSarif(afterR);
  const withFlow = sarif.runs[0].results.filter((x) => x.codeFlows);
  assert(validateSarif(sarif) === null, `codeFlows 를 담은 SARIF 가 공식 SARIF 2.1.0 스키마 통과${validateSarif(sarif) ? `: ${validateSarif(sarif)}` : ""}`);
  assert(withFlow.length === afterR.dataFlow.tainted && withFlow.every((x) => x.codeFlows[0].threadFlows[0].locations.length >= 2 && x.properties.dataFlow === "tainted"), `SARIF: tainted ${withFlow.length}건에 codeFlows(소스 → 위험 호출)`);
  const md = m.renderSecureCodingMarkdown(afterR);
  assert(/데이터 흐름\(메서드 안\): 요청 값 확인 \d+건/.test(md), "Markdown: 데이터 흐름 요약 줄");
  const beforeR = await m.checkSecureCoding({ projectDir: root, rules: RULES, dataFlow: false });
  const fpAfter = new Set(afterR.findings.map((f) => f.fingerprint));
  assert(beforeR.findings.every((f) => fpAfter.has(f.fingerprint)), "흐름 분석 전 항목의 지문은 모두 그대로(등급 변화만)");
  assert(m.OUTPUT_SCHEMAS.check_egovframe_secure_coding.safeParse(afterR).success, "결과가 outputSchema 통과(flow·dataFlow)");
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`secure-flow FAIL (${n} assertions)`); else console.log(`secure-flow OK (${n} assertions)`);
