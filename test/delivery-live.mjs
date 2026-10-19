// node test/delivery-live.mjs — 납품 패키지(v1.1) 실자산 검증 (CI 통합: 네트워크·Maven·JDK 17)
//   공식 web 템플릿으로 (1) 패키지 생성(OSV 포함) → manifest 재검증 (2) 같은 입력 2차 → 차이 0 (3) 의존성 하나를 내린 사본 → 그 차이만
//   (4) 파일 하나 수정 → verify 실패 (5) CLI deliver --write / --verify / --fail-on (6) 오프라인 번들(OSV 덤프)만으로 fetch 없이 OSV 포함 생성
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egovdlv-live-"));
const realFetch = globalThis.fetch;
const t = () => Date.now();

try {
  const c = await m.createProject({ template: "web", projectName: "dl-web", groupId: "egovframework.example", outputDir: root, database: "mysql" });
  const proj = c.projectPath;

  // (1) 1차 패키지
  let t0 = t();
  const out1 = path.join(root, "d1");
  const r1 = await m.prepareDelivery({ projectDir: proj, outputDir: out1, dryRun: false, offline: false, supplier: "eGovFrame Delivery Live" });
  const st1 = Object.fromEntries(r1.items.map((i) => [i.id, i.status]));
  assert(r1.written && r1.items.every((i) => i.status === "ok"), `1차 패키지 ${Math.round((t() - t0) / 1000)}초 — 항목 ${JSON.stringify(st1)} · 파일 ${r1.files} · rootHash ${r1.rootHash.slice(0, 16)}…`);
  const sbom1 = JSON.parse(readFileSync(path.join(out1, "sbom/bom.cdx.json"), "utf8"));
  const sc1 = JSON.parse(readFileSync(path.join(out1, "sbom-check/sbom-check.json"), "utf8"));
  const as1 = JSON.parse(readFileSync(path.join(out1, "assessment/assessment.json"), "utf8"));
  assert(sbom1.components.length > 50 && sbom1.metadata.supplier?.name === "eGovFrame Delivery Live" && sc1.minimum.verdict === "ready" && ["A", "B", "C", "D"].includes(as1.grades.supplyChain.grade), `SBOM component ${sbom1.components.length} · 취약점 ${sbom1.vulnerabilities?.length ?? 0} · 최소 요소 ${sc1.minimum.verdict} · 등급 전환 ${as1.grades.migration.grade}/공급망 ${as1.grades.supplyChain.grade}`);
  info(`항목 요약: ${JSON.stringify(Object.fromEntries(r1.items.map((i) => [i.id, i.summary])))}`);
  const v1 = m.verifyDelivery(out1);
  assert(v1.ok && v1.verified === v1.manifest.files && v1.extra.length === 0, `verify: 파일 ${v1.verified}개 전부 일치, rootHash 일치`);
  assert(!existsSync(path.join(proj, "sbom")) && !existsSync(path.join(proj, "Dockerfile")), "프로젝트는 읽기만(sbom/·Dockerfile 을 만들지 않음)");

  // (2) 같은 입력 2차
  t0 = t();
  const out2 = path.join(root, "d2");
  const r2 = await m.prepareDelivery({ projectDir: proj, outputDir: out2, dryRun: false, offline: false, supplier: "eGovFrame Delivery Live", previousDelivery: out1 });
  assert(r2.diff && !r2.diff.changed && r2.diff.skipped.length === 0, `같은 입력 2차 ${Math.round((t() - t0) / 1000)}초 — 이전 차수와 차이 없음(SBOM 추가 ${r2.diff.sbom.added.length}·버전 ${r2.diff.sbom.versionChanged.length}·새 취약점 ${r2.diff.sbom.newVulnerabilities.length}·보안약점 ${r2.diff.secureCoding.added}/${r2.diff.secureCoding.resolved})`);

  // (3) hsqldb 를 2.5.1 로 내린 사본 → 그 차이만
  const proj2 = path.join(root, "dl-web-down");
  cpSync(proj, proj2, { recursive: true });
  const pomPath = path.join(proj2, "pom.xml");
  const pom = readFileSync(pomPath, "utf8");
  const down = pom.replace(/(<artifactId>hsqldb<\/artifactId>)/, "$1\n\t\t\t<version>2.5.1</version>");
  assert(down !== pom, "사본 pom 의 hsqldb 에 2.5.1 고정");
  writeFileSync(pomPath, down);
  const out3 = path.join(root, "d3");
  const r3 = await m.prepareDelivery({ projectDir: proj2, outputDir: out3, dryRun: false, offline: false, supplier: "eGovFrame Delivery Live", previousDelivery: out2, zip: true });
  const d3 = r3.diff;
  assert(d3.changed && d3.sbom.versionChanged.length === 1 && /hsqldb/.test(d3.sbom.versionChanged[0].component) && d3.sbom.versionChanged[0].to === "2.5.1" && d3.sbom.added.length === 0 && d3.sbom.removed.length === 0 && d3.secureCoding.added === 0 && d3.secureCoding.resolved === 0, `내린 사본 diff: hsqldb ${d3.sbom.versionChanged[0]?.from} → ${d3.sbom.versionChanged[0]?.to} 만 (새 취약점 ${d3.sbom.newVulnerabilities.length}, 등급 ${d3.grades.supplyChain.from} → ${d3.grades.supplyChain.to})`);
  assert(existsSync(r3.zipPath) && readFileSync(path.join(out3, "diff.md"), "utf8").includes("2.5.1"), "zip 생성 · diff.md 에 버전 변경");

  // (4) 변조
  const idx = path.join(out3, "sbom/bom.cdx.json");
  writeFileSync(idx, readFileSync(idx, "utf8").replace("2.5.1", "2.7.4"));
  const v3 = m.verifyDelivery(out3);
  assert(!v3.ok && v3.mismatched.length === 1 && v3.mismatched[0].path === "sbom/bom.cdx.json" && v3.rootHashMatches === false, "SBOM 한 줄 수정 → verify 불일치(rootHash 도 다름)");

  // (5) CLI
  const io = (cwd) => { const out = [], err = []; return { cwd, stdout: (s) => out.push(s), stderr: (s) => err.push(s), out, err }; };
  const i1 = io(proj);
  const code1 = await m.runCli(["deliver", "--output-dir", path.join(root, "d4"), "--write", "--supplier", "eGovFrame Delivery Live", "--fail-on", "failed", "--json"], i1);
  const j1 = JSON.parse(i1.out.join(""));
  assert(code1 === 0 && j1.mode === "prepare" && j1.written && j1.items.every((i) => i.status === "ok") && /납품 패키지/.test(i1.err.join("")), `CLI deliver --write --fail-on failed → 0 (${i1.err.join("").trim().split("\n").pop()})`);
  const i2 = io(proj);
  const code2 = await m.runCli(["deliver", "--output-dir", path.join(root, "d4"), "--verify", "--fail-on", "invalid"], i2);
  assert(code2 === 0 && /일치/.test(i2.out.join("")), "CLI deliver --verify → 0");
  const i3 = io(proj);
  const code3 = await m.runCli(["deliver", "--output-dir", out3, "--verify", "--fail-on", "invalid"], i3);
  assert(code3 === 2 && /불일치/.test(i3.out.join("")), "CLI deliver --verify(변조본) --fail-on invalid → 2");
  const i4 = io(proj);
  const code4 = await m.runCli(["deliver", "--output-dir", path.join(root, "d5")], i4);
  assert(code4 === 0 && !existsSync(path.join(root, "d5")) && /계획만/.test(i4.err.join("")), "CLI deliver(--write 없음) → 계획만");

  // (6) 오프라인 번들 — OSV 덤프만 담고 fetch 를 막은 채 offline=false 생성 → 번들 OSV 로 취약점 포함
  t0 = t();
  const bundle = path.join(root, "bundle");
  await m.prepareEgovframeOfflineBundle({ outputDir: bundle, include: ["osv"], dryRun: false });
  process.env.EGOVFRAME_OFFLINE_BUNDLE = bundle;
  m.resetBundleCache();
  globalThis.fetch = async (url) => { throw new Error(`fetch 차단(폐쇄망 흉내): ${String(url).slice(0, 60)}`); };
  try {
    const out6 = path.join(root, "d6");
    const r6 = await m.prepareDelivery({ projectDir: proj, outputDir: out6, dryRun: false, offline: false, supplier: "eGovFrame Delivery Live", previousDelivery: out2 });
    const sbom6 = JSON.parse(readFileSync(path.join(out6, "sbom/bom.cdx.json"), "utf8"));
    assert(r6.items.every((i) => i.status === "ok") && !r6.items.find((i) => i.id === "sbom").summary.osvError && (sbom6.vulnerabilities?.length ?? 0) === (sbom1.vulnerabilities?.length ?? 0) && r6.diff && !r6.diff.changed, `오프라인 번들(OSV 덤프) ${Math.round((t() - t0) / 1000)}초 — fetch 없이 취약점 ${sbom6.vulnerabilities?.length ?? 0}건(온라인과 같음) · 2차와 차이 없음`);
  } finally { globalThis.fetch = realFetch; delete process.env.EGOVFRAME_OFFLINE_BUNDLE; m.resetBundleCache(); }
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`delivery-live FAIL (${n} assertions)`); else console.log(`delivery-live OK (${n} assertions)`);
