// node test/baseline-live.mjs — 점검 기준선(v1.26) 실자산 검증 (CI 통합: 네트워크)
//   표본: 공식 공통컴포넌트 v5.0.6(이전) → v5.0.7(지금, 카탈로그가 고정한 커밋 7912e13). 두 태그 사이에 upstream 이 접근 통제·입력 길이·목록/건수 쿼리를 고쳤다.
//   (1) v5.0.6 결과를 기준선으로 v5.0.7 을 점검 → 점검별 새 항목·해결 건수 = 지문을 쓰지 않고 항목의 원래 필드로 독립 계산한 집합 차
//   (2) v5.0.7 의 모든 Java·매퍼 XML·설정 파일 위에 줄을 끼워 넣은 사본 → 자기 자신의 기준선 대비 새 항목 0·해결 0(실제 코드에서 지문 안정)
//   (3) 검증 없는 변경 핸들러 하나를 넣은 사본 → 접근 통제 새 항목 1, 생성 CI 의 게이트 명령이 넣기 전 0·넣은 뒤 2 로 끝남
//   (4) 기준선 비교로 늘어나는 시간
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clonePinned } from "./pinned-upstream.mjs";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-baseline-live-"));
const B = ".egovframe/baseline";
try {
  // 태그가 아니라 고정 커밋으로 받는다 — upstream 이 2026-11-25 에 v5.0.7 태그를 옮겼다(test/pinned-upstream.mjs)
  const clone = (tag) => { const d = clonePinned(path.join(root, tag), tag); rmSync(path.join(d, ".git"), { recursive: true, force: true }); return d; };
  const d506 = clone("v5.0.6"), d507 = clone("v5.0.7");
  const save = (dir, name, r) => { const f = path.join(dir, B, `${name}.json`); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(r)); return `${B}/${name}.json`; };
  const runAll = async (dir, base) => ({
    ops: await m.checkOperations({ projectDir: dir, ...(base ? { baselinePath: `${B}/ops.json` } : {}) }),
    privacy: m.checkPrivacy({ projectDir: dir, ...(base ? { baselinePath: `${B}/privacy.json` } : {}) }),
    access: m.checkAccess({ projectDir: dir, ...(base ? { baselinePath: `${B}/access.json` } : {}) }),
    validate: await m.validateProject({ projectDir: dir, maxIssues: 5000, ...(base ? { baselinePath: `${B}/validate.json` } : {}) }),
  });
  const saveAll = (dir, r) => { for (const k of ["ops", "privacy", "access", "validate"]) save(dir, k, r[k]); };

  // ── (1) v5.0.6 을 기준선으로 v5.0.7 ──
  const before = await runAll(d506, false);
  saveAll(d507, before);
  const after = await runAll(d507, true);
  // 독립 계산: 지문이 아니라 항목의 원래 필드(줄 번호 제외)로 만든 키의 다중집합 차
  const multiset = (xs, key) => { const mp = new Map(); for (const x of xs) { const kk = key(x); mp.set(kk, (mp.get(kk) ?? 0) + 1); } return mp; };
  const diff = (prev, cur, key) => { const a = multiset(prev, key), b = multiset(cur, key); let added = 0, resolved = 0; for (const [kk, c] of b) added += Math.max(0, c - (a.get(kk) ?? 0)); for (const [kk, c] of a) resolved += Math.max(0, c - (b.get(kk) ?? 0)); return { added, resolved }; };
  const KEYS = {
    ops: [(r) => r.findings, (f) => [f.rule, f.file, m.opsSubject(f.code)].join("\u0001")],
    privacy: [(r) => r.findings, (f) => [f.kind, f.item, f.file, f.table && f.column ? `${f.table}.${f.column}`.toUpperCase() : f.code].join("\u0001")],
    access: [(r) => r.findings, (f) => [f.kind, f.file, f.controller, f.method, f.url].join("\u0001")],
    mapper: [(r) => r.mapper.issues, (i) => [i.kind, i.file, i.ref].join("\u0001")],
    consistency: [(r) => r.consistency.issues, (i) => [i.kind, i.file, i.subject].join("\u0001")],
  };
  const pick = { ops: (x) => x.ops, privacy: (x) => x.privacy, access: (x) => x.access, mapper: (x) => x.validate, consistency: (x) => x.validate };
  const sect = { ops: (x) => x.ops, privacy: (x) => x.privacy, access: (x) => x.access, mapper: (x) => x.validate.mapper, consistency: (x) => x.validate.consistency };
  const table = {};
  for (const k of Object.keys(KEYS)) {
    const [list, key] = KEYS[k];
    const exp = diff(list(pick[k](before)), list(pick[k](after)), key);
    const got = sect[k](after);
    table[k] = { previous: got.baseline.findings, now: list(pick[k](after)).length, new: got.summary.new, resolved: got.baseline.resolved };
    assert(got.summary.new === exp.added && got.baseline.resolved === exp.resolved && got.baseline.findings === list(pick[k](before)).length, `${k}: v5.0.6(${got.baseline.findings}건) 기준선 대비 v5.0.7(${table[k].now}건) — 새 항목 ${got.summary.new}·해결 ${got.baseline.resolved} = 독립 계산(${exp.added}·${exp.resolved})`);
    assert(list(pick[k](after)).filter((f) => f.isNew).length === exp.added, `${k}: isNew 인 항목 수 = 새 항목 수`);
  }
  info(`v5.0.6 → v5.0.7: ${JSON.stringify(table)}`);
  assert(table.access.resolved >= 80 && table.consistency.resolved >= 40 && table.access.previous > 300, `upstream 이 고친 것이 해결로 잡힘(접근 통제 해결 ${table.access.resolved}, 정합성 해결 ${table.consistency.resolved})`);
  assert(after.validate.mapper.truncated === false && after.validate.consistency.truncated === false, "기준선·결과가 잘리지 않음(maxIssues 5000)");
  // 종류가 바뀐 항목은 새 항목(등급이 오른 재분류) — 문서에 적은 동작을 수치로
  const prevByMethod = new Map(before.access.findings.map((f) => [`${f.file}#${f.method}`, f]));
  const reclass = after.access.findings.filter((f) => f.isNew && prevByMethod.has(`${f.file}#${f.method}`));
  info(`접근 통제 새 항목 ${table.access.new}건 중 같은 메서드가 다른 종류로 다시 분류된 것 ${reclass.length}건(예: ${reclass.slice(0, 2).map((f) => `${f.method} ${prevByMethod.get(`${f.file}#${f.method}`).kind}→${f.kind}`).join(", ")})`);

  // ── (2) 실제 코드에서 줄 밀림 ──
  const self = await runAll(d507, false);
  const shifted = path.join(root, "shifted");
  cpSync(d507, shifted, { recursive: true });
  saveAll(shifted, self);
  let touched = 0;
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (!e.name.startsWith(".")) walk(p); continue; }
    if (/\.java$/.test(e.name)) { writeFileSync(p, `${"// 줄 밀기\n".repeat(17)}${readFileSync(p, "utf8")}`); touched++; }
    else if (/\.xml$/.test(e.name)) { const t = readFileSync(p, "utf8"); const at = t.search(/<(?:mapper|beans|web-app|sqlMap|configuration)\b/); if (at >= 0) { writeFileSync(p, `${t.slice(0, at)}${"<!-- 줄 밀기 -->\n".repeat(11)}${t.slice(at)}`); touched++; } }
    else if (/\.properties$/.test(e.name) && !/message/.test(p)) { writeFileSync(p, `${"# 줄 밀기\n".repeat(7)}${readFileSync(p, "utf8")}`); touched++; }
    else if (/\.sql$/.test(e.name)) { writeFileSync(p, `${"-- 줄 밀기\n".repeat(5)}${readFileSync(p, "utf8")}`); touched++; }
  } };
  walk(path.join(shifted, "src")); walk(path.join(shifted, "script"));
  const sh = await runAll(shifted, true);
  const moved = sh.access.findings.filter((f, i) => f.line !== self.access.findings[i]?.line).length;
  assert(touched > 4000 && moved === sh.access.findings.length && sh.access.findings.length === self.access.findings.length, `(전제) 파일 ${touched}개 위에 줄을 끼워 넣어 접근 통제 항목 ${moved}건의 줄 번호가 모두 바뀜`);
  for (const k of Object.keys(KEYS)) assert(sect[k](sh).summary.new === 0 && sect[k](sh).baseline.resolved === 0 && sect[k](sh).baseline.findings === KEYS[k][0](pick[k](self)).length, `${k}: 줄만 밀린 사본 → 새 항목 0·해결 0(${sect[k](sh).baseline.findings}건 모두 같은 지문)`);

  // ── (3) 새 핸들러 하나 + 생성 CI 의 게이트 명령 ──
  const proj = path.join(root, "proj");
  cpSync(d507, proj, { recursive: true });
  saveAll(proj, self);
  const io = () => { const o = { out: "", err: "" }; return { o, io: { stdout: (s) => { o.out += s; }, stderr: (s) => { o.err += s; }, cwd: proj, env: {} } }; };
  const gate = m.supplyChainCommands({ baselineDir: B }, false).filter((c) => ["ops", "privacy", "access", "validate"].includes(c.id));
  const argvOf = (command) => { const parts = command.match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, "")); return parts.slice(parts.indexOf(`egovframe-scaffold-mcp@${m.SERVER_VERSION}`) + 1).filter((x, i, a) => !(x === "--out" || a[i - 1] === "--out")); };
  assert(gate.length === 4 && gate.every((c) => c.command.includes(`--fail-on "new>0"`)) && JSON.stringify(argvOf(gate[2].command)) === JSON.stringify(["access", "--project", ".", "--baseline-path", `${B}/access.json`, "--fail-on", "new>0"]), "생성 CI 의 게이트 명령 4개(운영·개인정보·접근 통제·정합성)를 그대로 실행");
  const runGate = async () => { const codes = {}; for (const c of gate) { const x = io(); codes[c.id] = await m.runCli(argvOf(c.command).map((a) => (a === "." ? proj : a)), x.io); } return codes; };
  const c0 = await runGate();
  assert(Object.values(c0).every((x) => x === 0), `손대지 않은 공식 코드: 기준선이 있으면 게이트 네 단계 모두 통과(${JSON.stringify(c0)}) — 기준선 없이 high>0 이면 접근 통제 높음 ${self.access.summary.high}건으로 첫날부터 실패`);
  const x0 = io(); const noBase = await m.runCli(["access", "--project", proj, "--fail-on", "high>0"], x0.io);
  assert(noBase === 2, "(대조) 같은 코드에 기준선 없이 --fail-on high>0 → 종료 코드 2");
  const NEWC = path.join(proj, "src/main/java/egovframework/com/sample/web/SampleNoticeController.java");
  mkdirSync(path.dirname(NEWC), { recursive: true });
  writeFileSync(NEWC, `package egovframework.com.sample.web;\n\n@Controller\npublic class SampleNoticeController {\n\t@Resource(name = "sampleNoticeService") private SampleNoticeService sampleNoticeService;\n\n\t@RequestMapping("/cop/xnt/updateSampleNotice.do")\n\tpublic String updateSampleNotice(SampleNoticeVO vo) throws Exception {\n\t\tSampleNoticeVO found = sampleNoticeService.selectSampleNotice(vo);\n\t\tEgovAuthorizationHelper.assertOwner(found.getFrstRegisterId());\n\t\tsampleNoticeService.updateSampleNotice(vo);\n\t\treturn "forward:/cop/xnt/list.do";\n\t}\n\n\t@RequestMapping("/cop/xnt/deleteSampleNotice.do")\n\tpublic String deleteSampleNotice(SampleNoticeVO vo) throws Exception {\n\t\tsampleNoticeService.deleteSampleNotice(vo);\n\t\treturn "forward:/cop/xnt/list.do";\n\t}\n}\n`);
  const ac = m.checkAccess({ projectDir: proj, baselinePath: `${B}/access.json` });
  const nw = ac.findings.filter((f) => f.isNew);
  assert(ac.summary.new === 1 && nw[0].method === "deleteSampleNotice" && nw[0].url === "/cop/xnt/deleteSampleNotice.do" && ac.baseline.resolved === 0 && ac.findings.length === self.access.findings.length + 1, `검증 없는 삭제 핸들러 하나 추가 → 항목 ${ac.findings.length}건 중 새 항목은 그 1건(${nw[0]?.kind} ${nw[0]?.url})`);
  const c1 = await runGate();
  assert(c1.access === 2 && c1.ops === 0 && c1.privacy === 0 && c1.validate === 0, `게이트: 접근 통제 단계만 종료 코드 2(${JSON.stringify(c1)})`);
  // 기준선을 다시 만들면 통과(받아들인 경우의 절차)
  const reb = io();
  const cmd = m.baselineCommands(B, false).find((c) => c.includes(" access "));
  await m.runCli(cmd.split(/\s+/).slice(cmd.split(/\s+/).indexOf("access")).map((a) => (a === "." ? proj : a === `${B}/access.json` ? path.join(proj, B, "access.json") : a)), reb.io);
  const c2 = await runGate();
  assert(c2.access === 0, "안내한 명령으로 기준선을 다시 만들면 통과");

  // ── (4) 시간 ──
  const time = (fn) => { let best = Infinity; for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); fn(); best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6); } return best; };
  const t0 = time(() => m.checkAccess({ projectDir: d507 })), t1 = time(() => m.checkAccess({ projectDir: d507, baselinePath: `${B}/access.json` }));
  const size = statSync(path.join(d507, B, "access.json")).size;
  info(`접근 통제(핸들러 ${self.access.summary.handlers}개): 기준선 없이 ${t0.toFixed(0)}ms · 기준선(${(size / 1024).toFixed(0)}KB) 비교 ${t1.toFixed(0)}ms`);
  assert(t1 - t0 < 200, `기준선 비교로 늘어나는 시간 ${(t1 - t0).toFixed(0)}ms (< 200ms)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`baseline-live FAIL (${n} assertions)`); else console.log(`baseline-live OK (${n} assertions)`);
