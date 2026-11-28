// node test/rule-packs-live.mjs — 기관 규칙 팩(v1.23) 실자산 검증 (CI 통합: 네트워크)
//   예시 팩(금지 좌표 1·보안 규칙 1·운영 임계값 1)을 공식 템플릿 6종에 적용 →
//   (1) 팩 규칙의 항목이 결과에 출처(팩 이름)와 함께, 팩 없이 본 결과와의 차이가 정확히 팩 규칙만큼
//   (2) 보고한 줄을 원본 파일에서 다시 읽어 독립 확인
//   (3) 포트폴리오: 여섯 프로젝트 행에 팩 이름·같은 기준 안내, 평가서에 팩 지문
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-rule-packs-live-"));
const saved = process.env[m.RULE_PACKS_ENV];
delete process.env[m.RULE_PACKS_ENV];
try {
  const pack = path.join(root, "org-pack");
  mkdirSync(pack);
  writeFileSync(path.join(pack, "rule-pack.json"), JSON.stringify({
    schemaVersion: 1, name: "sample-org", version: "2026.11", description: "예시 기관 기준(테스트용)",
    secureCoding: { rules: [{ id: "org-catch-generic-exception", guideItem: "포괄 예외 처리(기관 기준)", category: "error", cwe: 396, severity: "low", targets: ["java"], pattern: "catch\\s*\\(\\s*(final\\s+)?Exception\\s+\\w+\\s*\\)", message: "Exception 을 통째로 잡으면 처리해야 할 예외가 묻힙니다", fix: "구체적인 예외 형식으로 나눠 잡으세요" }] },
    operations: { thresholds: { "session-timeout": { maxMinutes: 30 } } },
    dependencies: { banned: [{ groupId: "org.hsqldb", artifactId: "hsqldb", reason: "운영 배포본에 내장 DB 금지(기관 기준)", replacement: "기관 표준 DBMS 드라이버" }] },
  }, null, 2));
  const lp = m.loadRulePack(pack);
  const list = m.listRules({ rulePacks: [pack] });
  assert(lp.name === "sample-org" && list.summary.fromPacks === 3 && list.rules.filter((r) => r.source === "sample-org").map((r) => r.id).sort().join() === "banned:org.hsqldb:hsqldb,org-catch-generic-exception,session-timeout", `예시 팩 로드 — 팩이 정한 규칙 3(보안 규칙 1·운영 임계값 1·금지 좌표 1), 지문 ${lp.sha256.slice(0, 12)}`);

  const dirs = [];
  // 실측(2026-11-16): [팩 보안 규칙 건수, 세션 규칙 상태(팩 없음→팩), 금지 좌표 건수] — web·boot-web 은 세션 설정이 없어 원래 미달, simple-homepage 는 30분이라 통과
  // 보안 규칙 건수는 고정하지 않는다 — 템플릿 저장소는 기본 브랜치로 받아 upstream 이 고칠 때마다 달라진다
  // (2026-11-27 공식 템플릿의 5.1.0 갱신으로 enterprise-business 10 → 11). 소스에서 직접 센 값과 대조한다.
  const CATCH_RE = /catch\s*\(\s*(final\s+)?Exception\s+\w+\s*\)/;
  // 주석·문자열을 지운 코드만 남기는 작은 어휘 분석("/css/**" 같은 문자열 안의 주석 기호에 속지 않게) — 점검 도구의 구현과 따로 쓴 것
  const codeOnly = (src) => { let out = "", st = "code"; for (let i = 0; i < src.length; i++) { const ch = src[i], nx = src[i + 1];
    if (st === "code") { if (ch === "/" && nx === "/") { st = "line"; i++; } else if (ch === "/" && nx === "*") { st = "block"; i++; } else if (ch === '"') { st = "str"; out += " "; } else if (ch === "'") { st = "chr"; out += " "; } else out += ch; }
    else if (st === "line") { if (ch === "\n") { st = "code"; out += ch; } }
    else if (st === "block") { if (ch === "*" && nx === "/") { st = "code"; i++; } else if (ch === "\n") out += ch; }
    else { if (ch === "\\") i++; else if ((st === "str" && ch === '"') || (st === "chr" && ch === "'")) st = "code"; else if (ch === "\n") { st = "code"; out += ch; } } }
    return out; };
  const countCatch = (dir) => { let c = 0; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["target", "build", "node_modules"].includes(e.name) && !e.name.startsWith(".")) walk(p); } else if (e.name.endsWith(".java")) for (const ln of codeOnly(readFileSync(p, "utf8")).split(/\r?\n/)) if (CATCH_RE.test(ln)) c++; } }; walk(dir); return c; };
  const expected = { web: [null, "fail→fail", 1], "boot-web": [null, "fail→fail", 1], "simple-backend": [null, "pass→fail", 1], "simple-homepage": [null, "pass→pass", 1], "portal-site": [null, "pass→fail", 1], "enterprise-business": [null, "pass→fail", 1] };
  for (const t of Object.keys(expected)) {
    const c = await m.createProject({ template: t, projectName: `rp-${t}`, groupId: "egovframework.example", outputDir: root, database: "hsql" });
    const dir = c.projectPath; dirs.push(dir);
    const s0 = await m.checkSecureCoding({ projectDir: dir }), s1 = await m.checkSecureCoding({ projectDir: dir, rulePacks: [pack] });
    const o0 = await m.checkOperations({ projectDir: dir }), o1 = await m.checkOperations({ projectDir: dir, rulePacks: [pack] });
    const d0 = await m.checkDependencies({ projectDir: dir }), d1 = await m.checkDependencies({ projectDir: dir, rulePacks: [pack] });
    const mine = s1.findings.filter((f) => f.source === "sample-org");
    const st = (r) => r.rules.find((x) => x.rule === "session-timeout")?.status ?? "없음";
    const banned = d1.findings.filter((f) => f.source === "sample-org");
    info(`${t}: 보안 ${s0.summary.total} → ${s1.summary.total}(팩 ${mine.length}) · 세션 ${st(o0)}→${st(o1)} · 운영 등급 ${o0.grade.grade}→${o1.grade.grade} · 금지 좌표 ${banned.length} · replace ${d0.summary.replace}→${d1.summary.replace}`);
    const [, expSession, expBanned] = expected[t];
    const expCatch = countCatch(dir);
    assert(mine.length === expCatch && s1.summary.total === s0.summary.total + mine.length && mine.every((f) => f.rule === "org-catch-generic-exception" && f.severity === "low") && s1.rulePacks[0].sha256 === lp.sha256, `${t}: 보안약점 — 팩 규칙 ${mine.length}건(소스에서 직접 센 ${expCatch}건과 같음)이 출처와 함께, 동봉 규칙의 결과는 그대로`);
    // 독립 확인: 보고한 줄에 실제로 catch (Exception …) 가 있다
    assert(mine.every((f) => /catch\s*\(\s*(final\s+)?Exception\s+\w+\s*\)/.test(readFileSync(path.join(dir, f.file), "utf8").split(/\r?\n/)[f.line - 1] ?? "")), `${t}: 독립 확인 — 보고한 ${mine.length}줄에 catch (Exception …)`);
    assert(`${st(o0)}→${st(o1)}` === expSession && (st(o1) !== "fail" || (o1.rules.find((x) => x.rule === "session-timeout").source === "sample-org" && o1.findings.some((f) => f.rule === "session-timeout" && f.source === "sample-org"))) && o1.rules.length === o0.rules.length, `${t}: 운영 — 세션 임계값 30분: ${st(o0)}→${st(o1)}(기대 ${expSession})`);
    assert(banned.length === expBanned && banned.every((f) => f.artifactId === "hsqldb" && f.status === "replace" && f.note.includes("[sample-org]")) && d1.summary.replace === d0.summary.replace + banned.filter((f) => d0.findings.find((x) => x.file === f.file && x.artifactId === f.artifactId && x.line === f.line)?.status !== "replace").length, `${t}: 의존성 — 금지 좌표 hsqldb ${banned.length}건 → replace(출처·사유)`);
  }

  // (3) 포트폴리오·평가서 — 환경 변수로
  process.env[m.RULE_PACKS_ENV] = pack;
  const pf = await m.summarizePortfolio({ inputs: dirs, jobs: 2 });
  const a = await m.assessProject({ projectDir: dirs[2] });
  delete process.env[m.RULE_PACKS_ENV];
  const pf0 = await m.summarizePortfolio({ inputs: dirs, jobs: 2 });
  assert(pf.rows.length === 6 && pf.rows.every((r) => r.rulePacks?.join() === "sample-org 2026.11") && pf.notes.some((x) => x.includes("sample-org 2026.11")) && pf0.rows.every((r) => !r.rulePacks) && !pf0.notes.some((x) => x.includes("규칙 팩")), "포트폴리오: 여섯 행 모두 팩 이름·같은 기준 안내, 팩이 없으면 표시 없음");
  info(`운영 등급(팩 없음 → 팩): ${pf0.rows.map((r, i) => `${r.name} ${r.operations}→${pf.rows[i].operations}`).join(" · ")}`);
  assert(a.rulePacks?.[0].sha256 === lp.sha256 && m.renderAssessmentMarkdown(a).includes(`규칙 팩: sample-org 2026.11(\`${lp.sha256.slice(0, 12)}\`)`) && a.dependencies.summary.replace >= 1, "평가서: 어떤 기준으로 봤는지(팩 이름·버전·지문)");
} finally {
  if (saved === undefined) delete process.env[m.RULE_PACKS_ENV]; else process.env[m.RULE_PACKS_ENV] = saved;
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`rule-packs-live FAIL (${n} assertions)`); else console.log(`rule-packs-live OK (${n} assertions)`);
