// node test/sbom-live.mjs — 실제 Maven·Gradle 로 해석된 의존성 트리와 CycloneDX SBOM (네트워크·JDK 17·Maven·Gradle 필요, CI integration 전용)
// 공식 egovframe-web 템플릿 pom(Initializr 고정 commit, 자리표시자만 채움)과 작은 Gradle 프로젝트로 v0.36 검증 기준을 확인한다.
import { checkDependencies, generateSbom, loadTemplateCatalog } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
async function fetchText(url) { const r = await fetch(url, { headers: { "User-Agent": "egovframe-scaffold-mcp" } }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }
const hasGradle = (() => { const r = spawnSync(process.platform === "win32" ? "gradle.bat" : "gradle", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }); return r.status === 0; })();

const root = mkdtempSync(path.join(tmpdir(), "egovsbomlive-"));
try {
  // ── Maven: 공식 egovframe-web 템플릿 ──
  const catalog = loadTemplateCatalog();
  const p = catalog.projects.find((x) => x.id === "egov-web");
  const mvnDir = path.join(root, "web");
  mkdirSync(mvnDir, { recursive: true });
  const pom = (await fetchText(`https://raw.githubusercontent.com/${p.mcp.repository}/${p.mcp.archive.commit}/templates/projects/pom/${p.initializr.pomFile}`))
    .replace(/###GROUP_ID###/g, "egovframework.example").replace(/###ARTIFACT_ID###/g, "example").replace(/###NAME###/g, "example").replace(/###VERSION###/g, "1.0.0").replace(/###URL###/g, "http://example.com");
  writeFileSync(path.join(mvnDir, "pom.xml"), pom);

  const r = await checkDependencies({ projectDir: mvnDir, resolve: true, resolveTimeoutMs: 900_000 });
  assert(r.resolution && r.resolution.success && r.resolution.artifacts >= 60, `resolve=true: 해석 artifact ${r.resolution?.artifacts ?? 0}종 ≥ 60 (${r.resolution?.error ?? "ok"})`);
  const transitive = r.findings.filter((f) => f.origin === "transitive");
  assert(transitive.length >= 40 && transitive.every((f) => f.via.length >= 1 && f.depth >= 2) && r.findings.filter((f) => f.origin === "declared").length === 19, `전이 ${transitive.length}건 전부 경로 있음, 선언 19건`);
  assert(r.resolution.summary.outdated >= 5 && r.resolution.summary.ok >= 30, `해석 집합 판정: ok ${r.resolution.summary.ok} · outdated ${r.resolution.summary.outdated} · unknown ${r.resolution.summary.unknown}`);

  const s = await generateSbom({ projectDir: mvnDir, dryRun: false, offline: false, timeoutMs: 900_000 });
  assert(s.written && s.generator === "cyclonedx-maven-plugin" && s.components >= 60 && existsSync(s.absolutePath), `Maven SBOM: component ${s.components}종 ≥ 60, ${s.bytes} bytes, ${s.durationMs}ms`);
  const bom = JSON.parse(readFileSync(s.absolutePath, "utf8"));
  assert(bom.bomFormat === "CycloneDX" && bom.specVersion === "1.6" && bom.components.every((c) => /^pkg:maven\//.test(c.purl) && c.properties?.some((pp) => pp.name === "egovframe:status")), "CycloneDX 1.6 · 모든 component 에 purl·egovframe:status");
  assert(bom.components.some((c) => c.hashes?.length) && bom.components.some((c) => c.licenses?.length) && bom.metadata.tools.components.some((t) => t.name === "egovframe-scaffold-mcp"), "플러그인 해시·라이선스 보존 + 도구 목록");
  assert(Array.isArray(bom.vulnerabilities) && bom.vulnerabilities.length === s.vulnerabilities && bom.vulnerabilities.every((v) => v.id && v.affects.length >= 1 && v.source.name === "OSV"), `OSV 취약점 ${s.vulnerabilities}건이 vulnerabilities[] 로 (affects 참조)`);
  assert(s.vulnerabilities >= 1, "공식 web 템플릿 해석 집합에는 OSV 권고가 붙는 component 가 있다(선행 조사 8종)");

  // ── Gradle: 작은 프로젝트 ──
  if (hasGradle) {
    const gDir = path.join(root, "gr");
    mkdirSync(gDir, { recursive: true });
    writeFileSync(path.join(gDir, "settings.gradle"), "rootProject.name = 'egov-gradle-sample'\n");
    writeFileSync(path.join(gDir, "build.gradle"), `plugins { id 'java' }\ngroup = 'egovframework.example'\nversion = '1.0.0'\nrepositories {\n  mavenCentral()\n  maven { url 'https://maven.egovframe.go.kr/maven/' }\n}\ndependencies {\n  implementation 'org.egovframe.rte:egovframe-rte-ptl-mvc:5.0.2'\n  implementation 'com.h2database:h2:2.3.232'\n  testImplementation 'org.junit.jupiter:junit-jupiter:5.12.2'\n}\n`);
    const gr = await checkDependencies({ projectDir: gDir, resolve: true, resolveTimeoutMs: 900_000 });
    assert(gr.resolution && gr.resolution.success && gr.resolution.artifacts >= 30 && gr.resolution.direct === 2, `Gradle resolve: artifact ${gr.resolution?.artifacts ?? 0}종, 직접 2 (${gr.resolution?.error ?? "ok"})`);
    const gs = await generateSbom({ projectDir: gDir, dryRun: false, timeoutMs: 900_000 });
    const gbom = JSON.parse(readFileSync(gs.absolutePath, "utf8"));
    assert(gs.written && gs.generator === "egovframe-scaffold-mcp" && gs.components >= 30 && gbom.specVersion === "1.6" && gbom.dependencies.length === gbom.components.length + 1, `Gradle SBOM: component ${gs.components}종, 의존 그래프 ${gbom.dependencies.length}`);
  } else console.log("skip: gradle 없음 — Gradle 경로는 건너뜀");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`sbom-live FAIL (${n} assertions)`); else console.log(`sbom-live OK (${n} assertions)`);
