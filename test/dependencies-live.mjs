// node test/dependencies-live.mjs — OSV 조회 경로 + 공식 자산 기준 (네트워크, CI integration 전용)
// (1) 알려진 취약 버전(log4j 1.2.17)이 포함된 픽스처를 offline=false 로 점검해 OSV 결과가 붙는지,
// (2) v0.34 검증 기준: 공식 5.x 템플릿 pom(Initializr 고정 commit) 에서 '기준 없음' 0건, 공식 공통컴포넌트 v3.10.0 pom 에서 5건 이하인지 확인한다.
import { checkDependencies, loadTemplateCatalog, assessProject } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
async function fetchText(url) { const r = await fetch(url, { headers: { "User-Agent": "egovframe-scaffold-mcp" } }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }
const unknownOf = (r) => r.findings.filter((f) => f.status === "unknown").map((f) => `${f.groupId}:${f.artifactId}`);

// ── 공식 자산 ─────────────────────────────────────────
const official = mkdtempSync(path.join(tmpdir(), "egovdepofficial-"));
try {
  const catalog = loadTemplateCatalog();
  for (const id of ["egov-boot-web", "egov-web"]) {
    const p = catalog.projects.find((x) => x.id === id);
    const dir = path.join(official, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "pom.xml"), await fetchText(`https://raw.githubusercontent.com/${p.mcp.repository}/${p.mcp.archive.commit}/templates/projects/pom/${p.initializr.pomFile}`));
    const r = await checkDependencies({ projectDir: dir });
    assert(r.parent.kind === (id === "egov-boot-web" ? "boot" : "web") && r.summary.unknown === 0 && r.summary.unversioned === 0, `${id} 템플릿 pom: 5.x parent, 기준 없음 0 (요약 ${JSON.stringify(r.summary)}; unknown: ${unknownOf(r).join(", ") || "-"})`);
    // v0.37 검증 기준: 공식 5.x 템플릿은 전환 범위 0·전환 난이도 A. 공급망은 B 이상 — pom 만 있어 보안 설정 3건이 누락으로 잡히고(2점),
    // Initializr 고정 commit 의 parent 가 5.0.0 이라 기준(5.0.2) 미만으로 1점 — 둘 다 사실이므로 A 를 요구하지 않는다.
    const a = await assessProject({ projectDir: dir });
    const platform = a.grades.supplyChain.factors.find((f) => f.id === "platform");
    assert(a.migration.items === 0 && a.grades.migration.grade === "A" && a.grades.migration.score === 0 && ["A", "B"].includes(a.grades.supplyChain.grade) && platform.value <= 1 && a.grades.supplyChain.factors.find((f) => f.id === "outdated").value === 0, `${id} 평가서: 전환 범위 0·전환 난이도 A, 공급망 ${a.grades.supplyChain.grade}(${a.grades.supplyChain.score}점; ${platform.note})`);
  }
  const cc = path.join(official, "cc310");
  mkdirSync(cc, { recursive: true });
  writeFileSync(path.join(cc, "pom.xml"), await fetchText("https://raw.githubusercontent.com/eGovFramework/egovframe-common-components/v3.10.0/pom.xml"));
  const rc = await checkDependencies({ projectDir: cc });
  assert(rc.findings.length >= 50 && rc.summary.legacy >= 10 && rc.summary.unknown <= 5, `공통컴포넌트 v3.10.0 pom: 의존성 ${rc.findings.length}건, 기준 없음 ${rc.summary.unknown}건 ≤ 5 (unknown: ${unknownOf(rc).join(", ") || "-"})`);
  assert(rc.summary.vendor >= 4 && rc.findings.filter((f) => f.basis === "rte-transitive").length >= 1 && rc.findings.filter((f) => f.basis === "boot-bom").length >= 1, `벤더 ${rc.summary.vendor}건 · RTE 전이·Boot BOM 기준 적용`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(official, { recursive: true, force: true });
}

// ── OSV ───────────────────────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "egovdeplive-"));
mkdirSync(root, { recursive: true });
writeFileSync(path.join(root, "pom.xml"), `<project><dependencies>
  <dependency><groupId>log4j</groupId><artifactId>log4j</artifactId><version>1.2.17</version></dependency>
  <dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>6.2.11</version></dependency>
</dependencies></project>\n`);
try {
  const r = await checkDependencies({ projectDir: root, offline: false });
  assert(!r.osvError, `OSV 조회 성공 (${r.osvError ?? "ok"})`);
  const log4j = r.vulnerabilities?.find((v) => v.dependency === "log4j:log4j");
  assert(log4j && log4j.ids.length >= 1, `log4j 1.2.17 취약점 ${log4j?.ids.length ?? 0}건 (예: ${log4j?.ids[0] ?? "-"})`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`dependencies-live FAIL (${n})`); else console.log(`dependencies-live OK (${n})`);
