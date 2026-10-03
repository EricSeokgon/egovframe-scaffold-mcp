// node test/sbom.mjs — SBOM 생성 (오프라인: 가짜 runner 로 Maven 플러그인 출력·Gradle 트리를 흉내 낸다)
import { generateSbom, renderSbomMarkdown, resolveSbomOutputPath, sbomCommand, purlOf, buildBomFromTree, enrichBom, attachVulnerabilities, parseGradleTree, dedupeArtifacts, OUTPUT_SCHEMAS, SERVER_VERSION } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
const gradleTreeText = readFileSync(new URL("./fixtures/gradle-tree-sample.txt", import.meta.url), "utf8");

// ── 순수 함수 ──────────────────────────────────────────
assert(purlOf("org.egovframe.rte", "egovframe-rte-ptl-mvc", "5.0.2") === "pkg:maven/org.egovframe.rte/egovframe-rte-ptl-mvc@5.0.2?type=jar" && purlOf("g", "a", "1.0.0.Final", "war").endsWith("@1.0.0.Final?type=war"), "purl 형식");
const tree = dedupeArtifacts(parseGradleTree(gradleTreeText).nodes);
const bom = buildBomFromTree({ name: "egov-gradle-sample", group: "egovframework.example", version: "1.0.0" }, tree, () => Date.UTC(2026, 9, 4));
assert(bom.bomFormat === "CycloneDX" && bom.specVersion === "1.6" && /^urn:uuid:[0-9a-f-]{36}$/.test(bom.serialNumber) && bom.version === 1 && bom.metadata.timestamp === "2026-10-04T00:00:00.000Z", "buildBomFromTree: 머리말");
assert(bom.metadata.tools.components[0].name === "egovframe-scaffold-mcp" && bom.metadata.tools.components[0].version === SERVER_VERSION && bom.metadata.component["bom-ref"] === purlOf("egovframework.example", "egov-gradle-sample", "1.0.0"), "buildBomFromTree: 도구·루트 component");
assert(bom.components.length === 46 && bom.components.every((c) => c.type === "library" && c.purl === c["bom-ref"] && c.group && c.name && c.version), "buildBomFromTree: component 46·purl=bom-ref");
const rootDeps = bom.dependencies.find((d) => d.ref === bom.metadata.component["bom-ref"]);
assert(rootDeps && rootDeps.dependsOn.length === 3 && bom.dependencies.length === 47 && bom.dependencies.every((d) => d.dependsOn.every((r) => bom.components.some((c) => c["bom-ref"] === r))), "buildBomFromTree: 의존 그래프(루트 직접 3, 모든 참조가 component)");
const ptlDeps = bom.dependencies.find((d) => d.ref === purlOf("org.egovframe.rte", "egovframe-rte-ptl-mvc", "5.0.2"));
assert(ptlDeps && ptlDeps.dependsOn.includes(purlOf("org.egovframe.rte", "egovframe-rte-fdl-cmmn", "5.0.2")), "buildBomFromTree: 전이 관계(ptl-mvc → fdl-cmmn)");
const statuses = enrichBom(bom, "none");
assert(Object.values(statuses).reduce((a, b) => a + b, 0) === 46 && statuses.ok >= 40 && bom.components.every((c) => c.properties.some((p) => p.name === "egovframe:status")), `enrichBom: 46 전부 판정(ok ${statuses.ok}, outdated ${statuses.outdated}, unknown ${statuses.unknown})`);
const h2 = bom.components.find((c) => c.name === "h2");
assert(h2.properties.find((p) => p.name === "egovframe:basis").value === "boot-bom" && h2.properties.find((p) => p.name === "egovframe:baseline").value === "2.3.232", "enrichBom: h2 는 Boot BOM 기준");
h2.properties.push({ name: "custom:keep", value: "1" });
enrichBom(bom, "none");
assert(h2.properties.filter((p) => p.name === "egovframe:status").length === 1 && h2.properties.some((p) => p.name === "custom:keep"), "enrichBom 재실행: egovframe:* 갱신, 다른 속성 유지");
const vulnCount = await attachVulnerabilities(bom, async (q) => ({ results: q.map((x) => (x.package.name === "org.springframework:spring-webmvc" ? { vulns: [{ id: "GHSA-b" }, { id: "GHSA-a" }] } : x.package.name === "org.springframework:spring-core" ? { vulns: [{ id: "GHSA-a" }] } : {})) }));
assert(vulnCount === 2 && bom.vulnerabilities[0].id === "GHSA-a" && bom.vulnerabilities[0].affects.length === 2 && bom.vulnerabilities[0].source.url === "https://osv.dev/vulnerability/GHSA-a" && bom.vulnerabilities[1].affects[0].ref === purlOf("org.springframework", "spring-webmvc", "6.2.11"), "attachVulnerabilities: ID 정렬·같은 ID 는 affects 로 합침·OSV 출처");

// ── 출력 경로 검증 ─────────────────────────────────────
const proj = mkdtempSync(path.join(tmpdir(), "egovsbom-"));
write(proj, "pom.xml", `<project><groupId>egovframework.example</groupId><artifactId>sample</artifactId><version>1.2.3</version><parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.2</version></parent></project>`);
assert(resolveSbomOutputPath(proj, "sbom/bom.cdx.json").relPath === "sbom/bom.cdx.json" && resolveSbomOutputPath(proj, "./target\\bom.json").relPath === "target/bom.json", "상대 경로 정규화");
for (const bad of ["../bom.json", "/abs/bom.json", "a/../../b.json", "C:\\x\\bom.json"]) { let threw = false; try { resolveSbomOutputPath(proj, bad); } catch { threw = true; } assert(threw, `거부: ${bad}`); }
if (process.platform !== "win32") { // portability: ok — symlink 검사는 POSIX 에서만 만든다
  const outside = mkdtempSync(path.join(tmpdir(), "egovsbom-out-"));
  symlinkSync(outside, path.join(proj, "link"));
  let threw = false; try { resolveSbomOutputPath(proj, "link/bom.json"); } catch (e) { threw = /symlink/.test(e.message); }
  assert(threw, "symlink 로 프로젝트 밖을 가리키는 경로 거부");
  rmSync(outside, { recursive: true, force: true });
}

// ── 명령 ─────────────────────────────────────────────
const cm = sbomCommand(proj, "maven", "runtime", "/tmp/out", "linux"), ca = sbomCommand(proj, "maven", "all", "/tmp/out", "win32"), cg = sbomCommand(proj, "gradle", "runtime", "", "linux");
assert(cm.command === "mvn" && cm.args[1] === "org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom" && cm.args.includes("-DoutputDirectory=/tmp/out") && cm.args.includes("-DschemaVersion=1.6") && cm.args.includes("-DincludeTestScope=false") && cm.args.includes("-DincludeProvidedScope=false"), "Maven 명령: 플러그인 좌표 완전 표기·runtime 범위");
assert(ca.command === "mvn.cmd" && ca.args.includes("-DincludeTestScope=true") && ca.args.includes("-DincludeProvidedScope=true") && cg.args.join(" ") === "dependencies --configuration runtimeClasspath -q --console=plain", "all 범위·Windows 래퍼·Gradle 트리 명령");

// ── generateSbom: dryRun ───────────────────────────────
const d = await generateSbom({ projectDir: proj, platform: "linux" }); // 명령 문자열 단언은 플랫폼을 고정(Windows 는 mvn.cmd)
assert(d.dryRun && !d.written && d.outputPath === "sbom/bom.cdx.json" && d.buildTool === "maven" && d.generator === "cyclonedx-maven-plugin" && d.components === 0 && /dryRun/.test(d.notes[0]) && !existsSync(path.join(proj, "sbom")), "dryRun(기본): 실행·기록 없음, 계획만");
assert(OUTPUT_SCHEMAS.generate_egovframe_sbom.safeParse(d).success, "dryRun 결과가 outputSchema 통과");
assert(renderSbomMarkdown(d).includes("(dryRun — 쓰지 않음)") && renderSbomMarkdown(d).includes("`mvn -B org.cyclonedx"), "dryRun Markdown");
const dWin = await generateSbom({ projectDir: proj, platform: "win32" });
assert(dWin.dryRun && dWin.command.startsWith("mvn.cmd -B org.cyclonedx"), "dryRun(win32): mvn.cmd 래퍼 이름");

// ── generateSbom: Maven(가짜 플러그인 출력) ────────────
const pluginBom = { bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: "urn:uuid:11111111-1111-1111-1111-111111111111", version: 1,
  metadata: { timestamp: "2026-10-04T00:00:00Z", tools: { components: [{ type: "application", group: "org.cyclonedx", name: "cyclonedx-maven-plugin", version: "2.9.3" }] }, component: { type: "application", "bom-ref": "pkg:maven/egovframework.example/sample@1.2.3?type=war", group: "egovframework.example", name: "sample", version: "1.2.3", purl: "pkg:maven/egovframework.example/sample@1.2.3?type=war" } },
  components: [
    { type: "library", "bom-ref": purlOf("org.egovframe.rte", "egovframe-rte-ptl-mvc", "5.0.0"), group: "org.egovframe.rte", name: "egovframe-rte-ptl-mvc", version: "5.0.0", purl: purlOf("org.egovframe.rte", "egovframe-rte-ptl-mvc", "5.0.0"), hashes: [{ alg: "SHA-256", content: "ab" }], licenses: [{ license: { id: "Apache-2.0" } }] },
    { type: "library", "bom-ref": purlOf("org.springframework", "spring-webmvc", "6.2.11"), group: "org.springframework", name: "spring-webmvc", version: "6.2.11", purl: purlOf("org.springframework", "spring-webmvc", "6.2.11") },
    { type: "library", "bom-ref": purlOf("com.fasterxml", "classmate", "1.5.1"), group: "com.fasterxml", name: "classmate", version: "1.5.1", purl: purlOf("com.fasterxml", "classmate", "1.5.1") },
  ],
  dependencies: [
    { ref: "pkg:maven/egovframework.example/sample@1.2.3?type=war", dependsOn: [purlOf("org.egovframe.rte", "egovframe-rte-ptl-mvc", "5.0.0")] },
    { ref: purlOf("org.egovframe.rte", "egovframe-rte-ptl-mvc", "5.0.0"), dependsOn: [purlOf("org.springframework", "spring-webmvc", "6.2.11"), purlOf("com.fasterxml", "classmate", "1.5.1")] },
  ] };
const calls = [];
const fakePlugin = async (cmd, o) => { calls.push(cmd); const dir = cmd.args.find((a) => a.startsWith("-DoutputDirectory=")).slice("-DoutputDirectory=".length); writeFileSync(path.join(dir, "bom.json"), JSON.stringify(pluginBom)); o.onData("[INFO] BUILD SUCCESS\n"); return { exitCode: 0, timedOut: false }; };
const m = await generateSbom({ projectDir: proj, dryRun: false, runner: fakePlugin, platform: "linux", offline: false, osvQuery: async (q) => ({ results: q.map((x) => (x.package.name === "org.springframework:spring-webmvc" ? { vulns: [{ id: "GHSA-x" }] } : {})) }) });
assert(m.written && !m.overwritten && m.components === 3 && m.direct === 1 && m.transitive === 2 && m.generator === "cyclonedx-maven-plugin" && m.vulnerabilities === 1 && m.bytes > 500 && existsSync(m.absolutePath), `Maven: 기록·component 3(직접 1)·취약점 1 (${m.bytes} bytes)`);
const written = JSON.parse(readFileSync(path.join(proj, "sbom/bom.cdx.json"), "utf8"));
assert(written.metadata.tools.components.length === 2 && written.metadata.tools.components[1].name === "egovframe-scaffold-mcp" && written.components[0].hashes && written.components[0].licenses, "플러그인 문서 보존(해시·라이선스) + 도구 목록에 이 서버 추가");
const ptl = written.components.find((c) => c.name === "egovframe-rte-ptl-mvc");
assert(ptl.properties.find((p) => p.name === "egovframe:status").value === "outdated" && ptl.properties.find((p) => p.name === "egovframe:basis").value === "parent" && ptl.properties.find((p) => p.name === "egovframe:baseline").value === "5.0.2", "enrich: RTE 5.0.0 → outdated(parent 기준 5.0.2)");
assert(written.vulnerabilities.length === 1 && written.vulnerabilities[0].id === "GHSA-x" && written.vulnerabilities[0].affects[0].ref === purlOf("org.springframework", "spring-webmvc", "6.2.11"), "vulnerabilities[] 기록");
const { bom: _b, ...mStruct } = m;
assert(m.statuses.outdated === 2 && m.statuses.ok === 1 && OUTPUT_SCHEMAS.generate_egovframe_sbom.safeParse(m).success && Object.keys(mStruct).every((k) => k in OUTPUT_SCHEMAS.generate_egovframe_sbom.shape), `판정 집계·outputSchema 통과·구조화 출력 키 전부 선언 (${Object.keys(mStruct).filter((k) => !(k in OUTPUT_SCHEMAS.generate_egovframe_sbom.shape)).join(",") || "-"})`);
const md = renderSbomMarkdown(m);
assert(md.includes("component 3종 = 직접 1 + 전이 2") && md.includes("- 취약점(vulnerabilities[]): 1") && md.includes("GHSA-x: org.springframework/spring-webmvc@6.2.11"), "Markdown: 요약·취약점 목록");
let threw = false; try { await generateSbom({ projectDir: proj, dryRun: false, runner: fakePlugin, platform: "linux" }); } catch (e) { threw = /이미 있습니다/.test(e.message); }
assert(threw, "기존 파일은 overwrite=true 없이 거부");
const m2 = await generateSbom({ projectDir: proj, dryRun: false, runner: fakePlugin, platform: "linux", overwrite: true, enrich: false, scope: "all" });
assert(m2.written && m2.overwritten && Object.values(m2.statuses).every((v) => v === 0) && m2.vulnerabilities === 0 && calls[calls.length - 1].args.includes("-DincludeTestScope=true"), "overwrite·enrich=false·scope=all");
const m2w = JSON.parse(readFileSync(path.join(proj, "sbom/bom.cdx.json"), "utf8"));
assert(!m2w.components.some((c) => c.properties) && m2w.vulnerabilities === undefined, "enrich=false·offline 이면 속성·취약점 없음");
const mOsvFail = await generateSbom({ projectDir: proj, outputPath: "target/bom2.json", dryRun: false, runner: fakePlugin, platform: "linux", offline: false, osvQuery: async () => { throw new Error("network down"); } });
assert(mOsvFail.written && /network down/.test(mOsvFail.osvError) && mOsvFail.vulnerabilities === 0, "OSV 실패는 osvError 로만 기록하고 파일은 씀");
threw = false; try { await generateSbom({ projectDir: proj, outputPath: "target/fail.json", dryRun: false, runner: async (_c, o) => { o.onData("[ERROR] no plugin\n"); return { exitCode: 1, timedOut: false }; }, platform: "linux" }); } catch (e) { threw = /cyclonedx-maven-plugin 실패\(종료 코드 1\)/.test(e.message) && /no plugin/.test(e.message); }
assert(threw && !existsSync(path.join(proj, "target/fail.json")), "플러그인 실패 → 예외(로그 끝 포함), 파일 없음");
threw = false; try { await generateSbom({ projectDir: proj, outputPath: "target/t.json", dryRun: false, runner: async () => ({ exitCode: null, timedOut: true }), platform: "linux", timeoutMs: 15_000 }); } catch (e) { threw = /시간 초과\(15000ms\)/.test(e.message); }
assert(threw, "시간 초과 → 예외");

// ── generateSbom: Gradle(가짜 트리) ───────────────────
const gproj = mkdtempSync(path.join(tmpdir(), "egovsbomg-"));
write(gproj, "settings.gradle", "rootProject.name = 'egov-gradle-sample'\n");
write(gproj, "build.gradle", "plugins { id 'java' }\ngroup = 'egovframework.example'\nversion = '1.0.0'\n");
const g = await generateSbom({ projectDir: gproj, dryRun: false, runner: async (_c, o) => { o.onData(gradleTreeText); return { exitCode: 0, timedOut: false }; }, platform: "linux" });
assert(g.written && g.generator === "egovframe-scaffold-mcp" && g.components === 46 && g.direct === 3 && g.transitive === 43 && g.notes.some((x) => /해시·라이선스/.test(x)) && g.bom.metadata.component.name === "egov-gradle-sample" && g.bom.metadata.component.group === "egovframework.example", "Gradle: 트리로 문서 구성(46, 직접 3), 루트 좌표 settings/build 에서");
assert(g.bom.components.every((c) => c.properties?.some((p) => p.name === "egovframe:status")) && g.statuses.ok >= 40, "Gradle 문서도 enrich");
threw = false; try { await generateSbom({ projectDir: mkdtempSync(path.join(tmpdir(), "egovsbomempty-")), dryRun: false }); } catch (e) { threw = /빌드 파일/.test(e.message); }
assert(threw, "빌드 파일 없으면 예외");

for (const dd of [proj, gproj]) rmSync(dd, { recursive: true, force: true });
if (process.exitCode) console.error(`sbom FAIL (${n} assertions)`); else console.log(`sbom OK (${n} assertions)`);
