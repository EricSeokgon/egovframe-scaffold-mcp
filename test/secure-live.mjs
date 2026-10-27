// node test/secure-live.mjs — 보안약점 점검(v0.44) 실자산 검증(CI 통합, 네트워크 필요): 공식 템플릿을 실제로 만들어 규칙별 건수를
// catalog/migration-corpus.json 의 secureTemplates 와 대조한다. Initializr 고정 commit 템플릿(pinned)은 단언, 저장소 브랜치 템플릿은
// upstream 이 바뀔 수 있어 차이를 로그로 남긴다(drift 감시). 그리고 SARIF 를 써서 공식 스키마로 검증한다.
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateSarif } from "./spec-schemas.mjs";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const lib = await import("../scripts/corpus-lib.mjs");
const corpus = lib.loadCorpus();
const expected = corpus.secureTemplates.entries;
const root = mkdtempSync(path.join(tmpdir(), "egovsecure-live-"));
let tFlow = 0, tPlain = 0;
try {
  for (const [id, exp] of Object.entries(expected)) {
    const c = await m.createProject({ template: id, projectName: `s-${id}`, groupId: "egovframework.example", outputDir: root, database: "mysql" });
    const r = await m.checkSecureCoding({ projectDir: c.projectPath, sarifPath: "egovframe-secure.sarif" });
    const actual = { total: r.summary.total, high: r.summary.high, medium: r.summary.medium, low: r.summary.low, byRule: Object.fromEntries(r.byRule.map((b) => [b.rule, b.count]).sort()) };
    const { pinned, ...want } = exp;
    const diffs = lib.compareEntry(want, actual, corpus.tolerance);
    const label = `${id}: 파일 ${r.filesScanned} · 높음 ${actual.high} · 중간 ${actual.medium} · 낮음 ${actual.low} (${Object.entries(actual.byRule).map(([k, v]) => `${k} ${v}`).join(", ") || "없음"})`;
    if (pinned) assert(diffs.length === 0, `${label} = 기대값${diffs.length ? `\n  - ${diffs.join("\n  - ")}` : ""}`);
    else if (diffs.length) console.log(`info: ${label} — 기대값과 다름(저장소 브랜치 템플릿, upstream 변경 가능): ${diffs.join(" / ")}`);
    else console.log(`ok-info: ${label} = 기대값`);
    // v1.7: 자동 조치 계획(공통컴포넌트 포함) — 재점검이 계획과 일치하고 원본은 그대로
    const fx = await m.fixSecureCoding({ projectDir: c.projectPath, includeComponents: true });
    assert(fx.dryRun && fx.verify.ok, `${id}: 자동 조치 계획 — 고침 ${fx.summary.fixed} · 수동 ${fx.summary.manual}${fx.htmlTagFilter ? ` (HTMLTagFilter ${fx.htmlTagFilter})` : ""} · 재점검 ${fx.verify.ok ? "일치" : `불일치 ${fx.verify.unexpected.slice(0, 3).join("; ")}`}`);
    // v1.5: 데이터 흐름은 기존 항목의 지문을 바꾸지 않고(등급·note 만), 걸린 시간을 흐름 없이와 비교
    let t0 = Date.now(); const plain = await m.checkSecureCoding({ projectDir: c.projectPath, dataFlow: false }); tPlain += Date.now() - t0;
    t0 = Date.now(); await m.checkSecureCoding({ projectDir: c.projectPath }); tFlow += Date.now() - t0;
    const fps = new Set(r.findings.map((f) => f.fingerprint));
    assert(plain.findings.every((f) => fps.has(f.fingerprint)), `${id}: 데이터 흐름 전 항목 ${plain.findings.length}건의 지문 유지 · 흐름 ${JSON.stringify(r.dataFlow)}`);
    const sarif = JSON.parse(readFileSync(path.join(c.projectPath, "egovframe-secure.sarif"), "utf8"));
    assert(validateSarif(sarif) === null && sarif.runs[0].results.length === r.summary.total, `${id}: SARIF 2.1.0 공식 스키마 통과·결과 ${sarif.runs[0].results.length}건`);
  }
  assert(tFlow <= Math.max(tPlain * 2, tPlain + 2000), `데이터 흐름 분석 시간: 흐름 없이 ${tPlain}ms → 흐름 ${tFlow}ms (2배 이내 또는 +2초 이내)`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`secure-live FAIL (${n} assertions)`); else console.log(`secure-live OK (${n} assertions)`);
