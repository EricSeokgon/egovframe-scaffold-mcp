// node test/privacy-live.mjs — 개인정보 흐름·보호조치 점검(v1.21) 실자산 검증 (CI 통합: 네트워크)
//   (1) 공통컴포넌트 v5.0.7: 개인정보 테이블·고유식별정보 테이블 수, 사용자 관리(uss.umt)의 주민등록번호 평문 저장 4건(직원·회원 × insert·update)과
//       게시물·댓글 비밀번호 3건 = 높음 7, 사용자 비밀번호(encryptPassword)는 통과, DB 사본 8개는 한 건으로
//   (2) 독립 확인: 보고한 문장의 SQL 에 그 컬럼과 #{…} 가 실제로 있고, 사용자 관리 서비스 소스에 ihidnum 과 encrypt 가 같은 줄에 없음
//   (3) 공식 템플릿 6종 수치(web·boot-web 0), 흐름표가 URL·화면까지 이어짐
//   (4) 공통컴포넌트 전체 10초 이내(로컬 실측 3.2초 — DDL 스크립트 945개)
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-privacy-live-"));
try {
  const cc = path.join(root, "cc-507");
  execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", "v5.0.7", "https://github.com/eGovFramework/egovframe-common-components.git", cc], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const r = m.checkPrivacy({ projectDir: cc });
  info(`v5.0.7: ${r.durationMs}ms · ${JSON.stringify(r.summary)}`);
  const codes = r.findings.map((f) => f.code.replace(/^(\w+) \S+ → /, "$1 ")).sort();
  info(codes.join(" | "));
  assert(r.summary.tables >= 25 && r.summary.uniqueIdTables === 2 && r.columns.some((c) => c.table === "COMTNEMPLYRINFO" && c.column === "IHIDNUM" && c.grade === "unique-id") && r.columns.some((c) => c.table === "COMTNGNRLMBER" && c.column === "IHIDNUM"), `개인정보 테이블 ${r.summary.tables} · 고유식별정보 테이블 2(COMTNEMPLYRINFO·COMTNGNRLMBER)`);
  assert(JSON.stringify(codes) === JSON.stringify(["INSERT COMTNBBS.PASSWORD", "INSERT COMTNBBS.PASSWORD", "INSERT COMTNCOMMENT.PASSWORD", "INSERT COMTNEMPLYRINFO.IHIDNUM", "INSERT COMTNGNRLMBER.IHIDNUM", "UPDATE COMTNEMPLYRINFO.IHIDNUM", "UPDATE COMTNGNRLMBER.IHIDNUM"]) && r.summary.high === 7, `높음 7 = 주민등록번호 4(직원·회원 × insert·update) + 게시물·댓글 비밀번호 3`);
  assert(!r.findings.some((f) => f.column === "PASSWORD" && /EMPLYRINFO|GNRLMBER|ENTRPRSMBER/.test(f.table)) && r.findings.every((f) => (f.variants ?? 1) === 8), "사용자 비밀번호는 통과(EgovFileScrty.encryptPassword), DB 사본 8개는 한 건으로");
  // (2) 독립 확인
  let confirmed = 0;
  for (const f of r.findings) {
    const xmlText = readFileSync(path.join(cc, f.file), "utf8");
    const id = f.code.split(" ")[1].split(".").pop();
    const body = xmlText.match(new RegExp(`<(insert|update)\\s[^>]*id="${id}"[\\s\\S]*?</\\1>`))?.[0] ?? "";
    if (new RegExp(`\\b${f.column}\\b`).test(body) && /#\{/.test(body) && !/AES_ENCRYPT|SHA2?\(|ENC_/i.test(body)) confirmed++;
  }
  const umt = ["EgovEmplyrManageServiceImpl", "EgovMberManageServiceImpl"].map((c) => readFileSync(path.join(cc, `src/main/java/egovframework/com/uss/umt/service/impl/${c}.java`), "utf8"));
  assert(confirmed === r.findings.length && umt.every((t) => /encryptPassword\([^)]*getPassword/.test(t) && !t.split("\n").some((ln) => /ihidnum/i.test(ln) && /encrypt/i.test(ln))), `독립 확인: 문장 ${confirmed}/${r.findings.length} 에 컬럼·바인딩이 있고 SQL 암호화 없음, 사용자 관리 서비스는 비밀번호만 암호화`);
  const emp = r.flows.find((f) => f.table === "COMTNGNRLMBER");
  assert(emp.write >= 2 && emp.services.length > 0 && emp.controllers.length > 0 && emp.urls.length > 0 && emp.views.length > 0, `흐름표: COMTNGNRLMBER 쓰기 ${emp.write} → Service ${emp.services.length} · Controller ${emp.controllers.length} · URL ${emp.urls.length} · 화면 ${emp.views.length}`);
  assert(r.durationMs < 10_000, `공통컴포넌트 전체 ${r.durationMs}ms(10초 이내)`);
  const csv = m.renderPrivacyCsv(r);
  assert(csv.split("\r\n").length === r.columns.length + 2, `개인정보 파일 대장 CSV ${r.columns.length}행`);
  // (3) 공식 템플릿
  for (const [t, high] of [["web", 0], ["boot-web", 0], ["simple-backend", 5], ["simple-homepage", 3], ["portal-site", 2], ["enterprise-business", 5]]) {
    const c = await m.createProject({ template: t, projectName: `pv-${t}`, groupId: "egovframework.example", outputDir: root, database: "hsql" });
    const x = m.checkPrivacy({ projectDir: c.projectPath });
    info(`${t}: ${JSON.stringify(x.summary)}`);
    assert(x.summary.high === high && (high === 0 ? x.summary.columns === 0 : x.summary.uniqueIdTables >= 1), `${t}: 높음 ${x.summary.high}(기대 ${high}) · 개인정보 테이블 ${x.summary.tables}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`privacy-live FAIL (${n} assertions)`); else console.log(`privacy-live OK (${n} assertions)`);
