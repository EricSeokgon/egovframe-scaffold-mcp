// node test/portfolio.mjs — 포트폴리오(기관 단위) 현황(v1.17, 게이트, 오프라인)
//   입력 판별(프로젝트·납품 패키지·CI 아티팩트 두 형태·아님), /* 펼치기, 세 입력에서 같은 행, 결측 열(OSV·운영 등급), 실패 행, 이름 중복,
//   정렬·필터 식, 이전 비교(등급·ID 변화·신규·빠짐), 담당 CSV, 집계·Top N, 병렬 상한, Markdown·CSV(BOM), outputDir(새 디렉터리만),
//   CLI portfolio(--inputs, --write, --json-out)·assess --json-out, 생성 CI 가 egovframe-assessment.json 을 남김, MCP
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-portfolio-"));
const mk = (rel, files) => { const d = path.join(root, rel); mkdirSync(d, { recursive: true }); for (const [r, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, r)), { recursive: true }); writeFileSync(path.join(d, r), typeof t === "string" ? t : JSON.stringify(t)); } return d; };

// 평가서 고정물(필요한 필드만 — 실제 평가서와 같은 모양)
const A = (o) => ({
  projectDir: "/x", generatedAt: o.at ?? "2026-11-01T00:00:00.000Z",
  overview: { buildSystem: "maven", isEgovProject: true, rteVersion: o.rte ?? null, sourceEra: o.era, parent: { version: o.parent ?? null }, components: { count: o.comps ?? 0, ids: [] } },
  migration: { manual: o.manual ?? 0 },
  dependencies: { summary: { outdated: o.outdated ?? 0 }, vulnerabilities: { queried: o.osv !== false, dependencies: o.vulnDeps ?? 0, ids: (o.vulns ?? []).flatMap((v) => v.ids).length, items: o.vulns ?? [] } },
  secureCoding: { high: o.high ?? 0, medium: o.medium ?? 0, byRule: o.rules ?? [] },
  ...(o.ops === undefined ? {} : { operations: { grade: o.ops, failed: o.opsFailed ?? [] } }),
  grades: { migration: { grade: o.mg }, supplyChain: { grade: o.sc } },
});
const log4j = { dependency: "org.apache.logging.log4j:log4j-core", version: "2.14.1", ids: ["GHSA-jfh8-c2jp-5v3q", "GHSA-7rjr-3q55-vv33"] };
const a1 = A({ era: "3.x", rte: "3.10.0", mg: "D", sc: "D", ops: "C", manual: 700, vulnDeps: 2, vulns: [log4j, { dependency: "commons-fileupload:commons-fileupload", version: "1.3.1", ids: ["GHSA-hfrx-6qgj-fp6c"] }], high: 3, medium: 10, comps: 40, rules: [{ rule: "xss-cout-unescaped", guideItem: "XSS", count: 30 }], opsFailed: [{ rule: "sql-logging-driver", title: "SQL 로깅", severity: "high", findings: 2 }] });
const a2 = A({ era: "4.x", rte: "4.3.0", mg: "C", sc: "C", ops: "B", manual: 120, vulnDeps: 1, vulns: [log4j], high: 1, medium: 2, comps: 10, rules: [{ rule: "xss-cout-unescaped", guideItem: "XSS", count: 4 }, { rule: "print-stack-trace", guideItem: "오류 메시지", count: 2 }], opsFailed: [{ rule: "sql-logging-driver", title: "SQL 로깅", severity: "high", findings: 1 }, { rule: "session-timeout", title: "세션", severity: "medium", findings: 1 }] });
const a3 = A({ era: "5.x", parent: "5.0.2", mg: "A", sc: "B", osv: false });

// ── 입력 판별 ────────────────────────────────────────
const proj = mk("org/proj-a", { "pom.xml": "<project/>" });
const deliv = mk("org/deliv-b", { "delivery-manifest.json": { schemaVersion: 1 }, "assessment/assessment.json": a2 });
const ciJson = mk("org/ci-c", { "egovframe-assessment.json": { assessment: a3 }, "egovframe-assessment.md": "# x" });
const ciDeliv = mk("ci-d", { "egovframe-delivery/delivery-manifest.json": {}, "egovframe-delivery/assessment/assessment.json": a1 });
const junk = mk("org/z-junk", { "README.md": "x" });
assert(m.classifyPortfolioInput(proj).source === "project" && m.classifyPortfolioInput(deliv).source === "delivery" && m.classifyPortfolioInput(ciJson).source === "ci-artifact" && m.classifyPortfolioInput(ciDeliv).source === "ci-artifact" && m.classifyPortfolioInput(ciDeliv).assessmentJson.endsWith(path.join("egovframe-delivery", "assessment", "assessment.json")) && m.classifyPortfolioInput(junk) === null, "입력 판별: 프로젝트·납품 패키지·CI(JSON)·CI(delivery)·아님");
assert(m.expandPortfolioInputs([path.join(root, "org", "*"), ciDeliv, ciDeliv]).map((p) => path.basename(p)).join() === "ci-c,deliv-b,proj-a,z-junk,ci-d", "/* 펼치기(이름순)·중복 제거");

// ── 요약 ─────────────────────────────────────────────
const fakeAssess = async (dir) => { await new Promise((r) => setTimeout(r, 5)); return a1; };
{
  let inflight = 0, peak = 0;
  const counting = async (dir) => { inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 30)); inflight--; return a1; };
  const many = Array.from({ length: 5 }, (_, i) => mk(`many/p${i}`, { "pom.xml": "<project/>" }));
  const rp = await m.summarizePortfolio({ inputs: many, jobs: 2, assess: counting });
  assert(rp.rows.length === 5 && peak === 2, `병렬 상한 jobs=2 (최대 동시 ${peak})`);
}
const r = await m.summarizePortfolio({ inputs: [path.join(root, "org", "*"), ciDeliv, path.join(root, "nope")], assess: fakeAssess, org: "○○기관", sort: "migration" });
const row = (nm) => r.rows.find((x) => x.name === nm);
assert(r.rows.length === 6 && r.summary.projects === 6 && r.summary.failed === 2 && r.summary.bySource.project === 1 && r.summary.bySource.delivery === 1 && r.summary["bySource"]["ci-artifact"] === 2, `행 6(실패 2) · 입력 종류별 (${JSON.stringify(r.summary.bySource)})`);
assert(row("proj-a").source === "project" && row("proj-a").migration === "D" && row("deliv-b").migration === "C" && row("deliv-b").rteVersion === "4.3.0" && row("ci-c").rteVersion === "5.0.2" && row("ci-c").supplyChain === "B" && row("ci-d").era === "3.x", "프로젝트(실행)·납품 패키지·CI(JSON 래퍼)·CI(delivery) 행, RTE 없으면 parent 버전");
assert(row("ci-c").vulnerabilityIds === null && row("ci-c").operations === null && row("deliv-b").vulnerabilityIds === 2 && row("proj-a").vulnerabilityIds === 3 && r.notes.length === 2, "결측: OSV 미조회 → null, 운영 등급 없음(v1.15 이전) → null, 안내 2");
assert(row("z-junk").error.includes("보이지 않습니다") && row("nope").error.includes("디렉터리가 없습니다") && r.rows.slice(-2).every((x) => x.error), "실패 행은 사유와 함께 맨 뒤");
assert(r.rows.slice(0, 4).map((x) => x.migration).join() === "D,D,C,A", `sort=migration: 나쁜 순 (${r.rows.map((x) => x.migration).join()})`);
assert(JSON.stringify(r.summary.migration) === JSON.stringify({ A: 1, B: 0, C: 1, D: 2 }) && r.summary.era["3.x"] === 2 && r.summary.era["5.x"] === 1 && r.summary.vulnerableProjects === 3 && r.summary.vulnerabilityIds === 8 && r.summary.secureHigh === 7, `분포·합계 (${JSON.stringify(r.summary.migration)}, 취약 ${r.summary.vulnerableProjects}·ID ${r.summary.vulnerabilityIds})`);
assert(r.top.vulnerableCoordinates[0].dependency === "org.apache.logging.log4j:log4j-core" && r.top.vulnerableCoordinates[0].projects === 3 && r.top.vulnerableCoordinates[0].ids.length === 2 && r.top.secureRules[0].rule === "xss-cout-unescaped" && r.top.secureRules[0].projects === 3 && r.top.secureRules[0].findings === 64 && r.top.operationsRules[0].rule === "sql-logging-driver" && r.top.operationsRules[0].projects === 3, "먼저 손댈 것: 여러 프로젝트의 취약 좌표·보안약점 규칙·운영 미달 규칙");
// 이름 중복
const dupA = mk("x1/app", { "egovframe-assessment.json": a3 }), dupB = mk("x2/app", { "egovframe-assessment.json": a3 });
assert((await m.summarizePortfolio({ inputs: [dupA, dupB] })).rows.map((x) => x.name).join() === "app,app#2", "같은 디렉터리 이름은 #2");
// 필터
assert((await m.summarizePortfolio({ inputs: [path.join(root, "org", "*"), ciDeliv], assess: fakeAssess, only: "migration:C" })).rows.map((x) => x.name).sort().join() === "ci-d,deliv-b,proj-a", "only=migration:C → C 이하");
assert((await m.summarizePortfolio({ inputs: [path.join(root, "org", "*"), ciDeliv], assess: fakeAssess, only: "vulnerabilities>2,era:3.x" })).rows.length === 2, "only 여러 조건(모두 만족)");
assert((await m.summarizePortfolio({ inputs: [path.join(root, "org", "*")], assess: fakeAssess, only: "failed" })).rows.map((x) => x.name).join() === "z-junk", "only=failed");
let threw = null; try { m.parsePortfolioFilter("grade>3"); } catch (e) { threw = e.message; }
assert(/해석할 수 없습니다/.test(threw ?? ""), "모르는 필터 식은 오류");
assert((await m.summarizePortfolio({ inputs: [proj], run: false })).rows[0].error.includes("run=false"), "run=false 면 프로젝트는 실패 행(읽기만)");
// 담당·이전 비교
const owners = path.join(root, "owners.csv");
writeFileSync(owners, "﻿name,owner\nproj-a,정보화팀\ndeliv-b,\"민원과\"\n");
const prevPath = path.join(root, "prev.json");
writeFileSync(prevPath, JSON.stringify({ generatedAt: "2026-10-01T00:00:00.000Z", rows: [{ name: "proj-a", migration: "D", supplyChain: "C", operations: "D", vulnerabilityIds: 5 }, { name: "deliv-b", migration: "C", supplyChain: "C", operations: "B", vulnerabilityIds: 2 }, { name: "gone", migration: "B" }] }));
const rc = await m.summarizePortfolio({ inputs: [proj, deliv, ciJson], assess: fakeAssess, ownerMap: owners, previous: prevPath });
const c = (nm) => rc.rows.find((x) => x.name === nm);
assert(c("proj-a").owner === "정보화팀" && c("deliv-b").owner === "민원과" && !c("ci-c").owner, "담당 CSV(BOM·따옴표)");
assert(JSON.stringify(c("proj-a").change) === JSON.stringify({ supplyChain: "C→D", operations: "D→C", vulnerabilityIds: -2 }) && !c("deliv-b").change && c("ci-c").change.new === true && rc.previous.removed.join() === "gone" && rc.previous.generatedAt.startsWith("2026-10-01"), "이전 비교: 등급·ID 변화, 변화 없음, 신규, 빠진 프로젝트");
// 렌더
const md = m.renderPortfolioMarkdown(rc);
assert(md.includes("# 전자정부 표준프레임워크 포트폴리오 현황") && md.includes("| proj-a | 정보화팀 | 3.10.0 (3.x) | D | D | C | 700 | 2(3) | 0 | 3/10 | 40 | 2026-11-01 | 공급망 C→D, 운영 D→C, ID -2 |") && md.includes("| ci-c | — | 5.0.2 (5.x) | A | B | — | 0 | — |") && md.includes("| 신규 |") && md.includes("이전 대비 빠진 프로젝트: gone") && md.includes("## 먼저 손댈 것") && md.includes("`org.apache.logging.log4j:log4j-core` — 프로젝트 2"), "Markdown: 표·변화 열·빠진 프로젝트·먼저 손댈 것");
const csv = m.renderPortfolioCsv(rc);
assert(csv.startsWith("﻿name,owner,source,input,") && csv.split("\r\n").length === 5 && csv.includes(",정보화팀,project,") && csv.includes('"{""supplyChain"":""C→D""'), "CSV: BOM·CRLF·따옴표 이스케이프");
await (async () => { let t = null; try { await m.summarizePortfolio({ inputs: [] }); } catch (e) { t = e.message; } assert(/비어 있습니다/.test(t ?? ""), "inputs 없음은 오류"); })();

// ── MCP·CLI·생성 CI ──────────────────────────────────
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  const tools = (await client.listTools()).tools;
  const t = tools.find((x) => x.name === "summarize_egovframe_portfolio");
  assert(t && t.annotations.destructiveHint === false && t.annotations.readOnlyHint === false && t.inputSchema.properties.format.enum.join() === "markdown,json,csv" && t.outputSchema && tools.length === 43, "MCP: 43종, 파괴 아님(새 디렉터리에만 씀), outputSchema");
  const out = path.join(root, "pf-out");
  const res = await client.callTool({ name: "summarize_egovframe_portfolio", arguments: { inputs: [deliv, ciJson], outputDir: out, format: "json" } });
  assert(!res.isError && res.structuredContent.rows.length === 2 && res.structuredContent.written.length === 3 && existsSync(path.join(out, "portfolio.csv")) && JSON.parse(readFileSync(path.join(out, "portfolio.json"), "utf8")).rows.length === 2, "MCP outputDir: portfolio.md·csv·json");
  const again = await client.callTool({ name: "summarize_egovframe_portfolio", arguments: { inputs: [deliv], outputDir: out } });
  assert(again.isError && /비어 있지 않습니다/.test(again.content[0].text), "outputDir 가 비어 있지 않으면 거부(덮어쓰지 않음)");
  const res2 = await client.callTool({ name: "summarize_egovframe_portfolio", arguments: { inputs: [deliv, ciJson], previous: path.join(out, "portfolio.json") } });
  assert(!res2.isError && res2.structuredContent.rows.every((x) => !x.change) && res2.structuredContent.previous.removed.length === 0, "직전 portfolio.json 을 previous 로 — 변화 없음");
  await client.close(); await server.close();
  // CLI
  const io = (cwd) => { const o = [], e = []; return { cwd, env: {}, stdout: (s) => o.push(s), stderr: (s) => e.push(s), o, e }; };
  const i1 = io(root);
  const code = await m.runCli(["portfolio", "--inputs", "org/deliv-b,org/ci-c", "--json", "--fail-on", "migrationD>0"], i1);
  assert(code === 0 && JSON.parse(i1.o.join("")).rows.length === 2 && i1.e.join("").includes("포트폴리오 2개"), `CLI portfolio --inputs(상대 경로) --json (종료 ${code})`);
  const i2 = io(root);
  const code2 = await m.runCli(["portfolio", "--inputs", "org/deliv-b,ci-d", "--fail-on", "migrationD>0", "--output-dir", "cli-out"], i2);
  assert(code2 === 2 && !existsSync(path.join(root, "cli-out")), "CLI --fail-on migrationD>0 → 2, --write 없으면 outputDir 무시");
  const i3 = io(root);
  const code3 = await m.runCli(["portfolio", "--inputs", "org/deliv-b", "--output-dir", "cli-out", "--write"], i3);
  assert(code3 === 0 && existsSync(path.join(root, "cli-out", "portfolio.md")), "CLI --write 면 outputDir 에 기록");
  // assess --json-out → 포트폴리오 입력
  const p5 = mk("cli-proj", { "pom.xml": "<project><parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>5.0.2</version></parent><artifactId>x</artifactId><version>1</version></project>" });
  const i4 = io(p5);
  const code4 = await m.runCli(["assess", "--project", ".", "--out", "egovframe-assessment.md", "--json-out", "art/egovframe-assessment.json"], i4);
  const j = JSON.parse(readFileSync(path.join(p5, "art", "egovframe-assessment.json"), "utf8"));
  if (code4 !== 0) console.error(i4.e.join(""));
  assert(code4 === 0 && j.assessment.grades && m.classifyPortfolioInput(path.join(p5, "art")).source === "ci-artifact" && (await m.summarizePortfolio({ inputs: [path.join(p5, "art")] })).rows[0].rteVersion === "5.0.2", "assess --json-out 이 포트폴리오 CI 입력이 됨");
  assert(m.CLI_COMMANDS.portfolio.tool === "summarize_egovframe_portfolio", "CLI portfolio 정의");
  const wf = m.generateCiYaml("maven", "17", {});
  assert(wf.includes("--out egovframe-assessment.md --json-out egovframe-assessment.json") && wf.includes("egovframe-assessment.json"), "생성 CI: 평가서 JSON 도 아티팩트로(포트폴리오 입력)");
}

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`portfolio FAIL (${n} assertions)`); else console.log(`portfolio OK (${n} assertions)`);
