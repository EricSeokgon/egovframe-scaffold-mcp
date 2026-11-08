// node test/portfolio-live.mjs — 포트폴리오(v1.17) 실자산 검증 (CI 통합: 네트워크)
//   공식 템플릿 6종 + 공통컴포넌트 코퍼스 3.10.0·4.3.2 = 8 프로젝트: 세대 분포(3.x 1·4.x 1·5.x 6), 행의 등급이 개별 평가서와 같음,
//   같은 프로젝트를 납품 패키지·CI 아티팩트(assess --json-out)로 넣어도 같은 행, 소요 시간
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCorpus, materializeEntry } from "../scripts/corpus-lib.mjs";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-portfolio-live-"));
try {
  const dirs = [];
  for (const t of ["web", "boot-web", "simple-backend", "simple-homepage", "portal-site", "enterprise-business"]) dirs.push((await m.createProject({ template: t, projectName: `pf-${t}`, groupId: "egovframework.example", outputDir: root, database: "hsql" })).projectPath);
  const corpus = loadCorpus();
  for (const id of ["cc-3.10.0", "cc-4.3.2"]) dirs.push(materializeEntry(corpus, corpus.entries.find((x) => x.id === id)).dir);
  const t0 = Date.now();
  const r = await m.summarizePortfolio({ inputs: dirs, jobs: 4, org: "포트폴리오 실측", sort: "migration" });
  const secs = Math.round((Date.now() - t0) / 1000);
  info(`8 프로젝트 ${secs}초 · 세대 ${JSON.stringify(r.summary.era)} · 전환 ${JSON.stringify(r.summary.migration)} · 공급망 ${JSON.stringify(r.summary.supplyChain)} · 운영 ${JSON.stringify(r.summary.operations)}`);
  assert(r.rows.length === 8 && r.summary.failed === 0, `8 프로젝트 실패 0 (${r.rows.filter((x) => x.error).map((x) => `${x.name}: ${x.error}`).join("; ")})`);
  assert(r.summary.era["3.x"] === 1 && r.summary.era["4.x"] === 1 && r.summary.era["5.x"] === 6, `세대 분포 3.x 1 · 4.x 1 · 5.x 6 (${JSON.stringify(r.summary.era)})`);
  // 개별 평가서와 같은 등급
  let same = 0;
  for (const d of dirs) {
    const a = await m.assessProject({ projectDir: d, offline: true });
    const row = r.rows.find((x) => x.input === d);
    if (row && row.migration === a.grades.migration.grade && row.supplyChain === a.grades.supplyChain.grade && row.operations === a.operations.grade && row.manual === a.migration.manual) same++;
  }
  assert(same === 8, `행의 등급·수동 항목이 개별 평가서와 같음 (${same}/8)`);
  assert(r.rows[0].era === "3.x" || r.rows[0].era === "4.x", `sort=migration: 가장 어려운 프로젝트가 맨 위(${r.rows[0].name} ${r.rows[0].migration})`);
  assert(r.top.operationsRules.length > 0 && r.top.operationsRules[0].projects >= 4 && r.top.secureRules.length > 0, `먼저 손댈 것: 운영 미달 ${r.top.operationsRules[0]?.rule}(${r.top.operationsRules[0]?.projects}) · 보안약점 ${r.top.secureRules[0]?.rule}(${r.top.secureRules[0]?.projects})`);
  // 같은 프로젝트를 납품 패키지·CI 아티팩트로
  const portal = dirs[4];
  const deliv = path.join(root, "deliv-portal");
  const dv = await m.prepareDelivery({ projectDir: portal, outputDir: deliv, dryRun: false, include: ["assessment"] });
  assert(dv.items[0].status === "ok", "portal-site 납품 패키지(assessment)");
  const art = path.join(root, "ci-portal");
  mkdirSync(art);
  const io = { cwd: portal, env: {}, stdout: () => {}, stderr: () => {} };
  assert(await m.runCli(["assess", "--project", ".", "--json-out", path.join(art, "egovframe-assessment.json")], io) === 0, "portal-site assess --json-out(CI 아티팩트 모양)");
  const r3 = await m.summarizePortfolio({ inputs: [portal, deliv, art] });
  const keys = ["rteVersion", "era", "migration", "supplyChain", "operations", "manual", "outdated", "secureHigh", "secureMedium", "components"];
  const sig = (x) => keys.map((k) => x[k]).join("|");
  assert(r3.rows.map((x) => x.source).sort().join() === "ci-artifact,delivery,project" && new Set(r3.rows.map(sig)).size === 1, `디렉터리·납품 패키지·CI 아티팩트 입력의 행이 같음 (${r3.rows.map(sig).join(" / ")})`);
  const md = m.renderPortfolioMarkdown(r);
  assert(md.includes("| cc-4.3.2 |") && md.includes("## 먼저 손댈 것"), "Markdown 한 장");
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`portfolio-live FAIL (${n} assertions)`); else console.log(`portfolio-live OK (${n} assertions)`);
