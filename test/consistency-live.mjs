// node test/consistency-live.mjs — 화면–쿼리–DB 정합성(v1.25) 실자산 검증 (CI 통합: 네트워크)
//   정답: 공통컴포넌트가 v5.0.6 → v5.0.7 사이에 고친 것 — 목록·건수 쿼리의 조건 불일치(당직체크·RSS태그·DB모니터링·송수신모니터링)와
//   화면 maxlength 가 VO @Size 를 넘는 입력(컴포넌트마다 대조 테스트를 붙이며 수정)
//   (1) 수정 전(v5.0.6)에 보고하고 수정 뒤(v5.0.7)에는 보고하지 않음
//   (2) 독립 확인: 그 건수 문장의 원문이 두 태그 사이에 실제로 바뀌었고, 줄어든 maxlength 항목은 v5.0.7 JSP 의 값이 @Size 이하
//   (3) 전체 3초 이내, 공식 템플릿 6종 수치
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-consistency-live-"));
try {
  const clone = (tag) => { const d = path.join(root, tag); execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", tag, "https://github.com/eGovFramework/egovframe-common-components.git", d], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }); return d; };
  const d506 = clone("v5.0.6"), d507 = clone("v5.0.7");
  const before = m.checkConsistency({ projectDir: d506, maxIssues: 5000 }), after = m.checkConsistency({ projectDir: d507, maxIssues: 5000 });
  info(`v5.0.6: ${before.durationMs}ms · ${JSON.stringify(before.summary)}`);
  info(`v5.0.7: ${after.durationMs}ms · ${JSON.stringify(after.summary)}`);
  const K = (r, kind) => r.issues.filter((i) => i.kind === kind);
  const pairs = (r) => new Set(K(r, "count-condition-mismatch").map((i) => i.subject));
  const pb = pairs(before), pa = pairs(after);
  const fixed = [...pb].filter((s) => !pa.has(s)).sort();
  info(`목록·건수 불일치: v5.0.6 ${pb.size}쌍 → v5.0.7 ${pa.size}쌍 · upstream 이 고친 쌍 ${fixed.length}: ${fixed.join(" | ")}`);
  const EXPECT = ["DbMntrngDao.selectDbMntrngList ↔ selectDbMntrngListCnt", "RssTagManage.selectRssTagManage ↔ selectRssTagManageCnt", "TrsmrcvMntrngDao.selectTrsmrcvMntrngList ↔ selectTrsmrcvMntrngListCnt", "bndtManageDAO.selectBndtCeckManageList ↔ selectBndtCeckManageListTotCnt"];
  assert(before.summary.countPairs >= 1400 && before.summary.mapperFiles === 1224 && EXPECT.every((s) => pb.has(s)), `수정 전(v5.0.6): 목록·건수 쌍 ${before.summary.countPairs}개 중 upstream 이 고친 4쌍(당직체크·RSS태그·DB모니터링·송수신모니터링)을 모두 보고`);
  assert(EXPECT.every((s) => !pa.has(s)) && [...pa].every((s) => pb.has(s)), `수정 뒤(v5.0.7): 그 4쌍은 보고하지 않고, 새로 생긴 보고도 없음(남은 ${pa.size}쌍은 v5.0.6 에도 있던 것)`);
  // 독립 확인 — 점검 도구의 조건 해석을 쓰지 않고, 건수 문장의 원문이 두 태그 사이에 바뀌었는지
  const stmtText = (dir, file, id) => { const t = readFileSync(path.join(dir, file), "utf8"); const mm = new RegExp(`<select[^>]*\\bid="${id}"[\\s\\S]*?</select>`).exec(t); return mm ? mm[0].replace(/\s+/g, " ") : null; };
  const changed = EXPECT.filter((s) => { const i = K(before, "count-condition-mismatch").find((x) => x.subject === s); const [, l, c] = /\.(\w+) ↔ (\w+)$/.exec(s); return stmtText(d506, i.file, c) !== stmtText(d507, i.file, c) || stmtText(d506, i.file, l) !== stmtText(d507, i.file, l); });
  assert(changed.length === EXPECT.length, `독립 확인: 4쌍 모두 v5.0.6 과 v5.0.7 의 문장 원문이 실제로 다름(${changed.length}/4)`);
  // 입력 길이
  const mb = K(before, "maxlength-exceeds-size"), ma = K(after, "maxlength-exceeds-size");
  const keyOf = (i) => `${i.file}|${i.subject}`;
  const stillKeys = new Set(ma.map(keyOf));
  const resolved = mb.filter((i) => !stillKeys.has(keyOf(i)));
  info(`maxlength > @Size: v5.0.6 ${mb.length}건 → v5.0.7 ${ma.length}건 · upstream 이 고친 것 ${resolved.length}건`);
  const sizeMax = (dir, vo, field) => { const [file] = vo.split(":"); const t = readFileSync(path.join(dir, file), "utf8"); const mm = new RegExp(`@Size\\s*\\(([^)]*)\\)[^;]*?\\b${field}\\s*[=;]`).exec(t); return mm ? Number(/max\s*=\s*(\d+)/.exec(mm[1])?.[1]) : null; };
  const jspMax = (dir, file, field) => { const t = readFileSync(path.join(dir, file), "utf8").replace(/<!--[\s\S]*?-->/g, ""); const all = [...t.matchAll(new RegExp(`path="${field}"[^>]*maxlength="(\\d+)"`, "g"))].map((x) => Number(x[1])); return all.length ? Math.max(...all) : null; };
  const confirmed = resolved.filter((i) => { const field = i.subject.split(".").pop(); const j = jspMax(d507, i.file, field), s = sizeMax(d507, i.detail.vo, field); return j === null || s === null ? false : j <= s; });
  assert(mb.length >= 50 && ma.length <= 15 && resolved.length >= 40, `화면 maxlength 가 @Size 를 넘는 입력: ${mb.length} → ${ma.length}건(upstream 수정 ${resolved.length}건을 수정 전에 보고)`);
  assert(confirmed.length >= resolved.length * 0.9, `독립 확인: 고쳐진 ${resolved.length}건 중 ${confirmed.length}건은 v5.0.7 JSP 의 maxlength 가 VO @Size 이하(소스에서 직접 읽음)`);
  const lb = K(before, "length-exceeds-column"), la = K(after, "length-exceeds-column");
  info(`길이 > 컬럼: v5.0.6 ${lb.length}건 → v5.0.7 ${la.length}건 — ${la.map((i) => `${i.subject}(${i.detail.size ?? i.detail.maxlength}>${i.detail.columnLength})`).join(", ")}`);
  assert(la.length >= 3 && la.length <= 12 && la.every((i) => Number(i.detail.size ?? i.detail.maxlength) > Number(i.detail.columnLength)) && la.some((i) => i.subject === "ServerEqpmn.hdDisk" && i.detail.size === 1000 && i.detail.columnLength === 18), `VO·화면이 DB 컬럼보다 긴 것 ${la.length}건(예: ServerEqpmn.hdDisk @Size 1000 > 컬럼 18) — v5.0.7 에 남아 있음`);
  assert(before.durationMs < 3000 && after.durationMs < 3000 && after.summary.fieldsLinked >= 100 && after.summary.columnsWithLength >= 1000, `공통컴포넌트 전체 ${before.durationMs}·${after.durationMs}ms(3초 이내) · 필드–컬럼 연결 ${after.summary.fieldsLinked}`);
  const v = await m.validateProject({ projectDir: d507 });
  assert(v.consistency?.summary.errors === after.summary.errors && m.OUTPUT_SCHEMAS.validate_egovframe_project.safeParse(v).success, "validate_egovframe_project 결과에 포함 · 구조화 출력 스키마 통과");

  // 공식 템플릿
  const expected = { web: [0, 0], "boot-web": [0, 0], "simple-backend": [0, 0], "simple-homepage": [0, 0], "portal-site": [3, 10], "enterprise-business": [3, 0] }; // 실측(2026-11-23) — 포털·업무 템플릿은 공통컴포넌트 옛 버전의 사본이라 불일치가 남아 있다
  for (const [t, [errors, warnings]] of Object.entries(expected)) {
    const c = await m.createProject({ template: t, projectName: `cs-${t}`, groupId: "egovframework.example", outputDir: root, database: "hsql" });
    const r = m.checkConsistency({ projectDir: c.projectPath });
    info(`${t}: ${JSON.stringify(r.summary)}${r.issues.length ? ` — ${r.issues.map((i) => `${i.kind}:${i.subject}`).join(", ")}` : ""}`);
    assert(r.summary.errors === errors && r.summary.warnings === warnings, `${t}: 오류 ${r.summary.errors}(기대 ${errors}) · 경고 ${r.summary.warnings}(기대 ${warnings}) · 목록·건수 쌍 ${r.summary.countPairs}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`consistency-live FAIL (${n} assertions)`); else console.log(`consistency-live OK (${n} assertions)`);
