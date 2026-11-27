// node test/access-live.mjs — 접근 통제 점검(v1.24) 실자산 검증 (CI 통합: 네트워크)
//   정답: 공통컴포넌트가 v5.0.6 → v5.0.7 사이에 검증을 올린 핸들러(같은 파일·메서드의 검증 수준이 올라간 것 — upstream 이 손으로 고친 접근 통제 결함)
//   (1) 수정 전(v5.0.6)에 그 핸들러를 누락 의심으로 보고하는 비율(재현율) — 변경(등록·수정·삭제) 핸들러 기준과 전체 기준
//   (2) 수정 뒤(v5.0.7)에는 그 핸들러를 다시 보고하지 않음
//   (3) 독립 확인: 정답 핸들러의 v5.0.7 소스에 실제로 EgovAuthorizationHelper·EgovUserDetailsHelper 호출이 있고 v5.0.6 의 같은 메서드에는 그 호출이 없음
//   (4) 전역 보호 판정(표준프레임워크 보호자원), 전체 5초 이내, 공식 템플릿 6종 수치
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clonePinned } from "./pinned-upstream.mjs";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-access-live-"));
const LO = { none: 0, login: 1, role: 2, owner: 3 };
const WRITE = new Set(["create", "update", "delete"]);
try {
  // 태그가 아니라 고정 커밋으로 받는다 — upstream 이 2026-11-25 에 v5.0.7 태그를 옮겼다(test/pinned-upstream.mjs)
  const clone = (tag) => clonePinned(path.join(root, tag), tag);
  const d506 = clone("v5.0.6"), d507 = clone("v5.0.7");
  const before = m.checkAccess({ projectDir: d506 }), after = m.checkAccess({ projectDir: d507 });
  info(`v5.0.6: ${before.durationMs}ms · ${JSON.stringify(before.summary)}`);
  info(`v5.0.7: ${after.durationMs}ms · ${JSON.stringify(after.summary)}`);
  const key = (h) => `${h.file}#${h.method}`;
  const b = new Map(before.handlers.map((h) => [key(h), h]));
  const fb = new Set(before.findings.map((f) => `${f.file}#${f.method}`)), fa = new Set(after.findings.map((f) => `${f.file}#${f.method}`));
  const raised = after.handlers.filter((h) => b.has(key(h)) && LO[h.level] > LO[b.get(key(h)).level]);
  const raisedWrites = raised.filter((h) => WRITE.has(h.action));
  const hit = raised.filter((h) => fb.has(key(h))), hitWrites = raisedWrites.filter((h) => fb.has(key(h)));
  const still = raised.filter((h) => fa.has(key(h)));
  const pct = (a, c) => `${a}/${c} = ${(a / c * 100).toFixed(1)}%`;
  info(`upstream 이 검증을 올린 핸들러 ${raised.length}(변경 ${raisedWrites.length}) — 수정 전 보고: 전체 ${pct(hit.length, raised.length)}, 변경 ${pct(hitWrites.length, raisedWrites.length)} · 수정 뒤에도 보고 ${still.length}`);
  assert(before.summary.handlers === 1206 && after.summary.handlers === 1206 && before.summary.controllers === 164 && after.summary.byLevel.owner > before.summary.byLevel.owner * 4 && after.summary.byLevel.none < before.summary.byLevel.none, `핸들러 1,206개(컨트롤러 164) — 소유권 검증 ${before.summary.byLevel.owner} → ${after.summary.byLevel.owner}, 검증 없음 ${before.summary.byLevel.none} → ${after.summary.byLevel.none}`);
  assert(raised.length === 152 && raisedWrites.length === 96, `정답: 검증 수준이 올라간 핸들러 ${raised.length}(변경 ${raisedWrites.length})`);
  assert(hitWrites.length >= 70 && hit.length >= 74, `재현율 — 변경 핸들러 ${pct(hitWrites.length, raisedWrites.length)}(실측 73), 전체 ${pct(hit.length, raised.length)}(실측 77 — 조회 핸들러는 형제 근거가 있을 때만 보고)`);
  assert(still.length <= 2, `수정 뒤(v5.0.7)에는 정답 핸들러를 다시 보고하지 않음(${still.length}건${still.length ? `: ${still.map(key).join(", ")}` : ""})`);
  // (3) 독립 확인 — 점검 도구의 판정을 쓰지 않고 소스 본문에서
  const bodyOf = (dir, h) => { const src = readFileSync(path.join(dir, h.file), "utf8"); const i = src.search(new RegExp(`\\b${h.method}\\s*\\(`)); return i < 0 ? "" : src.slice(i, i + 6000).split(/\n\t(?:@RequestMapping|@PostMapping|@GetMapping)/)[0]; };
  const CALL = /EgovAuthorizationHelper\s*\.\s*\w+\s*\(|EgovUserDetailsHelper\s*\.\s*(isAuthenticated|getAuthorities)\s*\(/g;
  const sample = raisedWrites.filter((h) => fb.has(key(h)));
  const confirmed = sample.filter((h) => (bodyOf(d507, h).match(CALL) ?? []).length > (bodyOf(d506, h).match(CALL) ?? []).length);
  assert(confirmed.length >= sample.length * 0.9, `독립 확인: 보고한 변경 핸들러 ${sample.length}건 중 ${confirmed.length}건은 v5.0.7 소스에 검증 호출이 실제로 더 많음`);
  const kinds = (r) => { const o = {}; for (const f of r.findings) o[`${f.severity}:${f.kind}`] = (o[`${f.severity}:${f.kind}`] ?? 0) + 1; return o; };
  info(`v5.0.6 누락 의심 ${JSON.stringify(kinds(before))}`);
  info(`v5.0.7 누락 의심 ${JSON.stringify(kinds(after))}`);
  assert(before.global.kind === "egov-security" && after.global.kind === "egov-security" && after.findings.filter((f) => f.kind === "unprotected-write").every((f) => f.severity === "medium") && after.findings.filter((f) => f.kind === "sibling-mismatch").every((f) => f.severity === "high" && f.sibling) && after.summary.high < 80, `전역 보호: 표준프레임워크 보호자원(Globals.Auth=security) → 검증 없는 변경은 중간, 높음은 형제 근거가 있는 ${after.summary.high}건`);
  assert(before.durationMs < 5000 && after.durationMs < 5000, `공통컴포넌트 전체 ${before.durationMs}·${after.durationMs}ms(5초 이내)`);
  const csv = m.renderAccessCsv(after);
  assert(csv.split("\r\n").length === after.handlers.length + 2 && m.OUTPUT_SCHEMAS.check_egovframe_access.safeParse(after).success, `URL 권한 표 CSV ${after.handlers.length}행 · 구조화 출력 스키마 통과`);

  // (4) 공식 템플릿
  const expected = { web: [6, "none", 3], "boot-web": [7, "none", 3], "simple-backend": [51, "spring-security", 2], "simple-homepage": [55, "interceptor", 3], "portal-site": [275, "none", 57], "enterprise-business": [219, "none", 33] };
  for (const [t, [handlers, global, high]] of Object.entries(expected)) {
    const c = await m.createProject({ template: t, projectName: `ac-${t}`, groupId: "egovframework.example", outputDir: root, database: "hsql" });
    const r = m.checkAccess({ projectDir: c.projectPath });
    info(`${t}: ${JSON.stringify({ ...r.summary, global: r.global.kind, file: r.global.file })}`);
    assert(r.summary.handlers === handlers && r.global.kind === global && r.summary.high === high, `${t}: 핸들러 ${r.summary.handlers}(기대 ${handlers}) · 전역 보호 ${r.global.kind}(기대 ${global}) · 높음 ${r.summary.high}(기대 ${high})`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`access-live FAIL (${n} assertions)`); else console.log(`access-live OK (${n} assertions)`);
