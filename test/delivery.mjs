// node test/delivery.mjs — 납품 패키지 prepare_egovframe_delivery (오프라인: 가짜 Maven 플러그인 runner, OSV 주입)
import { prepareDelivery, verifyDelivery, diffDeliveries, readDeliveryData, projectFingerprint, rootHashOf, renderDeliveryMarkdown, renderVerifyMarkdown, renderDeliveryDiffMarkdown, purlOf, OUTPUT_SCHEMAS, DELIVERY_DEFAULT_INCLUDE, CLI_COMMANDS, buildServer } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
const root = mkdtempSync(path.join(tmpdir(), "egovdlv-"));
const proj = path.join(root, "proj");

// ── 픽스처: 공식 web parent 5.0.0 Maven 프로젝트 + 보안약점 1건 + Boot 아님(Classic war) ──
write(proj, "pom.xml", `<project><modelVersion>4.0.0</modelVersion><groupId>egovframework.example</groupId><artifactId>sample</artifactId><version>1.2.3</version><packaging>war</packaging><name>sample</name><organization><name>예시 기관</name></organization>
<parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.0</version></parent>
<dependencies><dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-mvc</artifactId></dependency><dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId><version>6.2.11</version></dependency></dependencies></project>`);
write(proj, "src/main/java/egovframework/example/A.java", "package egovframework.example;\npublic class A { void a() { try { } catch (Exception e) { e.printStackTrace(); } } }\n");
write(proj, "src/main/webapp/WEB-INF/web.xml", "<web-app/>");
write(proj, "src/main/resources/egovframework/egovProps/globals.properties", "Globals.DbType=mysql\nGlobals.mysql.Url=jdbc:mysql://localhost:3306/com\nGlobals.mysql.UserName=com\nGlobals.mysql.Password=com01\n");
const pluginBom = (rteVersion) => ({ bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: "urn:uuid:11111111-1111-1111-1111-111111111111", version: 1,
  metadata: { timestamp: "2026-10-04T00:00:00Z", tools: { components: [{ type: "application", group: "org.cyclonedx", name: "cyclonedx-maven-plugin", version: "2.9.3" }] }, component: { type: "application", "bom-ref": "pkg:maven/egovframework.example/sample@1.2.3?type=war", group: "egovframework.example", name: "sample", version: "1.2.3", purl: "pkg:maven/egovframework.example/sample@1.2.3?type=war" } },
  components: [
    { type: "library", "bom-ref": purlOf("org.egovframe.rte", "egovframe-rte-ptl-mvc", rteVersion), group: "org.egovframe.rte", name: "egovframe-rte-ptl-mvc", version: rteVersion, purl: purlOf("org.egovframe.rte", "egovframe-rte-ptl-mvc", rteVersion) },
    { type: "library", "bom-ref": purlOf("org.springframework", "spring-webmvc", "6.2.11"), group: "org.springframework", name: "spring-webmvc", version: "6.2.11", purl: purlOf("org.springframework", "spring-webmvc", "6.2.11") },
  ],
  dependencies: [{ ref: "pkg:maven/egovframework.example/sample@1.2.3?type=war", dependsOn: [purlOf("org.egovframe.rte", "egovframe-rte-ptl-mvc", rteVersion), purlOf("org.springframework", "spring-webmvc", "6.2.11")] }] });
let rte = "5.0.0";
const runner = async (cmd, o) => { const dir = cmd.args.find((a) => a.startsWith("-DoutputDirectory=")).slice("-DoutputDirectory=".length); writeFileSync(path.join(dir, "bom.json"), JSON.stringify(pluginBom(rte))); o.onData("[INFO] BUILD SUCCESS\n"); return { exitCode: 0, timedOut: false }; };
let osvIds = ["GHSA-x"];
const osvQuery = async (q) => ({ results: q.map((x) => (x.package.name === "org.springframework:spring-webmvc" ? { vulns: osvIds.map((id) => ({ id })) } : {})) });
const fixedNow = () => Date.UTC(2026, 9, 19, 1, 2, 3);
const listFiles = (d) => { const out = []; const walk = (x) => { for (const e of readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(d, p).split(path.sep).join("/")); } }; walk(d); return out.sort(); };

try {
  // ── 순수 함수 ──
  const fp1 = projectFingerprint(proj), fp2 = projectFingerprint(proj);
  assert(fp1.sha256 === fp2.sha256 && fp1.files === 4 && /^[0-9a-f]{64}$/.test(fp1.sha256), `입력 지문: 결정적, 빌드 파일 + src 4개 (${fp1.files})`);
  write(proj, "src/main/java/egovframework/example/B.java", "package egovframework.example;\npublic class B {}\n");
  assert(projectFingerprint(proj).sha256 !== fp1.sha256, "입력 지문: 소스가 바뀌면 달라짐");
  assert(rootHashOf([{ path: "b", sha256: "2", bytes: 1 }, { path: "a", sha256: "1", bytes: 1 }]) === rootHashOf([{ path: "a", sha256: "1", bytes: 1 }, { path: "b", sha256: "2", bytes: 1 }]), "rootHash: 순서 무관");

  // ── dryRun ──
  const out1 = path.join(root, "delivery-1");
  const plan = await prepareDelivery({ projectDir: proj, outputDir: out1, runner, now: fixedNow });
  assert(plan.dryRun && !plan.written && !existsSync(out1) && plan.include.join() === DELIVERY_DEFAULT_INCLUDE.join() && plan.items.every((i) => i.status === "skipped") && /dryRun/.test(plan.notes[0]), "dryRun(기본): 계획만, 디렉터리 없음, 기본 6항목(build 제외)");
  assert(OUTPUT_SCHEMAS.prepare_egovframe_delivery.safeParse({ mode: "prepare", ...plan }).success && renderDeliveryMarkdown(plan).includes("(dryRun — 계획)"), "dryRun 결과 outputSchema·Markdown");
  for (const [bad, re] of [[{ outputDir: path.join(proj, "out") }, /프로젝트 밖/], [{ include: ["sbom-check"] }, /sbom 항목/], [{ include: ["nope"] }, /알 수 없는 항목/], [{ previousDelivery: root }, /previousDelivery/]]) {
    let threw = false; try { await prepareDelivery({ projectDir: proj, outputDir: out1, dryRun: false, runner, ...bad }); } catch (e) { threw = re.test(e.message); }
    assert(threw, `거부: ${JSON.stringify(bad).slice(0, 60)}`);
  }

  // ── 1차 패키지 ──
  const r1 = await prepareDelivery({ projectDir: proj, outputDir: out1, dryRun: false, offline: false, osvQuery, runner, now: fixedNow, supplier: "예시 기관" });
  assert(r1.written && r1.items.every((i) => i.status === "ok") && r1.rootHash && existsSync(path.join(out1, "delivery-manifest.json")) && existsSync(path.join(out1, "index.md")), `1차 패키지 생성: 항목 ${r1.items.length} 전부 ok · 파일 ${r1.files}`);
  const files1 = listFiles(out1);
  for (const f of ["assessment/assessment.md", "assessment/assessment.json", "dependencies/dependencies.md", "dependencies/dependencies.json", "sbom/bom.cdx.json", "sbom/bom.spdx.json", "sbom/vex.cdx.json", "sbom-check/sbom-check.md", "sbom-check/sbom-check.json", "secure-coding/secure-coding.md", "secure-coding/egovframe-secure.sarif", "deploy/Dockerfile", "deploy/deploy/docker-compose.yml", "deploy/deploy.md", "index.md", "delivery-manifest.json"]) assert(files1.includes(f), `패키지 파일: ${f}`);
  assert(!existsSync(path.join(proj, "sbom")) && listFiles(proj).length === 5, "프로젝트는 읽기만(SBOM·VEX 를 프로젝트에 쓰지 않음)");
  const m1 = JSON.parse(readFileSync(path.join(out1, "delivery-manifest.json"), "utf8"));
  assert(m1.schemaVersion === 1 && m1.createdAt === "2026-10-19T01:02:03.000Z" && m1.project.fingerprint === projectFingerprint(proj).sha256 && m1.files.length === files1.length - 1 && m1.rootHash === r1.rootHash && m1.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && f.bytes > 0), "manifest: 시각·입력 지문·파일 지문·rootHash");
  const sbom1 = JSON.parse(readFileSync(path.join(out1, "sbom/bom.cdx.json"), "utf8"));
  assert(sbom1.metadata.supplier?.name === "예시 기관" && sbom1.vulnerabilities?.length === 1 && sbom1.vulnerabilities[0].id === "GHSA-x", "SBOM: 공급자·OSV 취약점 포함");
  const sc1 = JSON.parse(readFileSync(path.join(out1, "sbom-check/sbom-check.json"), "utf8"));
  assert(["ready", "needs-work"].includes(sc1.minimum.verdict) && sc1.vex.written && sc1.vex.vulnerabilities === 1 && sc1.vex.path === "sbom/vex.cdx.json", "SBOM 점검: 최소 요소 제출 가능 · VEX 초안 1건");
  const idx1 = readFileSync(path.join(out1, "index.md"), "utf8");
  assert(idx1.includes("✅ 생성") && !idx1.includes("❌") && idx1.includes("deliver --verify") && m1.items.find((i) => i.id === "secure-coding").summary.total === 2, "목차: 항목 표·검증 안내 · 보안약점 2건(printStackTrace·설정의 평문 비밀번호)");
  assert(OUTPUT_SCHEMAS.prepare_egovframe_delivery.safeParse({ mode: "prepare", ...r1 }).success, "생성 결과 outputSchema");

  // ── verify ──
  const v1 = verifyDelivery(out1);
  assert(v1.ok && v1.verified === m1.files.length && v1.mismatched.length === 0 && v1.missing.length === 0 && v1.rootHashMatches === true && renderVerifyMarkdown(v1).includes("✅ 일치"), "verify: 만든 직후 전부 일치");
  const tampered = path.join(root, "tampered");
  const copy = (src, dst) => { mkdirSync(dst, { recursive: true }); for (const e of readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name); if (e.isDirectory()) copy(s, d); else writeFileSync(d, readFileSync(s)); } };
  copy(out1, tampered);
  writeFileSync(path.join(tampered, "assessment/assessment.md"), readFileSync(path.join(tampered, "assessment/assessment.md"), "utf8").replace("# ", "# (수정) "));
  rmSync(path.join(tampered, "sbom/bom.spdx.json"));
  writeFileSync(path.join(tampered, "extra.txt"), "x");
  const v2 = verifyDelivery(tampered);
  assert(!v2.ok && v2.mismatched.length === 1 && v2.mismatched[0].path === "assessment/assessment.md" && v2.missing.join() === "sbom/bom.spdx.json" && v2.extra.join() === "extra.txt" && v2.rootHashMatches === null, "verify: 파일 하나 수정 → 불일치, 삭제 → 누락, 추가 → manifest 밖");
  assert(!verifyDelivery(root).ok && /manifest/.test(verifyDelivery(root).notes[0]), "verify: manifest 없는 디렉터리 거부");

  // ── 같은 입력으로 다시 → 차이 없음(시각·serialNumber 는 비교 대상 아님) ──
  const out2 = path.join(root, "delivery-2");
  const r2 = await prepareDelivery({ projectDir: proj, outputDir: out2, dryRun: false, offline: false, osvQuery, runner, previousDelivery: out1 });
  assert(r2.written && r2.diff && !r2.diff.changed && r2.diff.skipped.length === 0 && r2.diff.sbom.added.length === 0 && r2.diff.sbom.versionChanged.length === 0 && r2.diff.secureCoding.added === 0 && r2.diff.vulnerabilities.added.length === 0, "같은 입력 2차: 이전 차수와 차이 0");
  assert(existsSync(path.join(out2, "diff.md")) && readFileSync(path.join(out2, "diff.md"), "utf8").includes("달라진 점 없음") && JSON.parse(readFileSync(path.join(out2, "delivery-manifest.json"), "utf8")).previous.rootHash === r1.rootHash, "2차 manifest 에 이전 rootHash · diff.md");
  const vex2 = JSON.parse(readFileSync(path.join(out2, "sbom/vex.cdx.json"), "utf8"));
  assert(vex2.vulnerabilities.length === 1 && vex2.serialNumber === JSON.parse(readFileSync(path.join(out1, "sbom/vex.cdx.json"), "utf8")).serialNumber, "VEX: 이전 차수 문서를 이어 씀(serialNumber 유지)");

  // ── 입력이 바뀐 3차: RTE 올림 + 취약점 하나 추가 + 보안약점 해소 → 그 차이만 ──
  rte = "5.0.2"; osvIds = ["GHSA-x", "GHSA-new"];
  write(proj, "src/main/java/egovframework/example/A.java", "package egovframework.example;\npublic class A { void a() { try { } catch (Exception e) { throw new RuntimeException(e); } } }\n");
  const prevVex = JSON.parse(readFileSync(path.join(out2, "sbom/vex.cdx.json"), "utf8"));
  prevVex.vulnerabilities[0].analysis = { state: "not_affected", justification: "code_not_reachable", detail: "검토자 홍길동" };
  writeFileSync(path.join(out2, "sbom/vex.cdx.json"), JSON.stringify(prevVex, null, 2));
  const out3 = path.join(root, "delivery-3");
  const r3 = await prepareDelivery({ projectDir: proj, outputDir: out3, dryRun: false, offline: false, osvQuery, runner, previousDelivery: out2, zip: true });
  const d3 = r3.diff;
  assert(d3.changed && d3.sbom.versionChanged.length === 1 && d3.sbom.versionChanged[0].from === "5.0.0" && d3.sbom.versionChanged[0].to === "5.0.2" && d3.sbom.added.length === 0 && d3.sbom.removed.length === 0, "3차 diff: SBOM 버전 변경 1건만");
  assert(d3.vulnerabilities.added.join() === "GHSA-new" && d3.vulnerabilities.resolved.length === 0 && d3.sbom.newVulnerabilities.some((v) => v.id === "GHSA-new"), "3차 diff: 새 취약점 GHSA-new");
  assert(d3.secureCoding.resolved === 1 && d3.secureCoding.added === 0 && d3.secureCoding.from === 2 && d3.secureCoding.to === 1, "3차 diff: 보안약점 1건 해소(2 → 1)");
  assert(d3.grades && d3.grades.migration.from === d3.grades.migration.to, "3차 diff: 등급 비교 존재");
  const vex3 = JSON.parse(readFileSync(path.join(out3, "sbom/vex.cdx.json"), "utf8"));
  assert(vex3.vulnerabilities.find((v) => v.id === "GHSA-x").analysis.state === "not_affected" && vex3.vulnerabilities.some((v) => v.id === "GHSA-new" && v.analysis.state === "in_triage"), "VEX: 이전 차수의 사람 판단 보존 + 새 취약점 in_triage");
  const md3 = renderDeliveryDiffMarkdown(d3);
  assert(md3.includes("달라진 점 있음") && md3.includes("5.0.0 → 5.0.2") && md3.includes("GHSA-new") && renderDeliveryMarkdown(r3).includes("이전 차수와 비교"), "diff Markdown");
  assert(r3.zipPath === `${out3}.zip` && existsSync(r3.zipPath) && new AdmZip(r3.zipPath).getEntries().some((e) => e.entryName === "delivery-3/delivery-manifest.json"), "zip=true: <outputDir>.zip 에 디렉터리 이름으로 담김");
  assert(verifyDelivery(out3).ok, "3차 verify 일치");

  // ── 실패 항목은 목차에 남고 나머지는 생성 ──
  const out4 = path.join(root, "delivery-4");
  const failing = async (cmd, o) => { o.onData("[ERROR] BUILD FAILURE\n"); return { exitCode: 1, timedOut: false }; };
  const r4 = await prepareDelivery({ projectDir: proj, outputDir: out4, dryRun: false, runner: failing, include: ["sbom", "sbom-check", "secure-coding"] });
  const st = Object.fromEntries(r4.items.map((i) => [i.id, i.status]));
  assert(r4.written && st.sbom === "failed" && st["sbom-check"] === "failed" && st["secure-coding"] === "ok" && !existsSync(path.join(out4, "sbom")) && readFileSync(path.join(out4, "index.md"), "utf8").includes("❌ 실패") && r4.notes.some((x) => /2개 항목 실패/.test(x)), "실패 항목: 파일 없이 목차에 이유, 나머지는 생성");
  assert(verifyDelivery(out4).ok, "실패 항목이 있어도 manifest 는 일관");

  // ── 비어 있지 않은 outputDir 거부 · 중간 실패 무흔적 ──
  let threw = false; try { await prepareDelivery({ projectDir: proj, outputDir: out1, dryRun: false, runner }); } catch (e) { threw = /비어 있지 않습니다/.test(e.message); }
  assert(threw && verifyDelivery(out1).ok, "기존 패키지 디렉터리 거부(덮어쓰지 않음)");
  assert(!readdirSync(root).some((x) => x.includes(".partial-")), "스테이징 잔여물 없음");

  // ── CLI 정의 · MCP 도구 ──
  assert(CLI_COMMANDS.deliver && CLI_COMMANDS.deliver.tool === "prepare_egovframe_delivery" && CLI_COMMANDS.deliver.blocked.includes("dryRun"), "CLI deliver → prepare_egovframe_delivery(dryRun 차단, --write 로 생성)");
  assert(CLI_COMMANDS.deliver.metrics({ items: r4.items, files: 3 }).failed === 2 && CLI_COMMANDS.deliver.metrics({ mode: "verify", verify: v2 }).invalid === 1 && /불일치/.test(CLI_COMMANDS.deliver.line({ mode: "verify", verify: v2 })), "CLI 지표: failed·invalid, 한 줄 요약");
  const server = buildServer();
  const [ct, stt] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(stt); await client.connect(ct);
  const tool = (await client.listTools()).tools.find((t) => t.name === "prepare_egovframe_delivery");
  assert(tool && tool.outputSchema && tool.annotations.readOnlyHint === false && tool.annotations.destructiveHint === false && tool.inputSchema.properties.include.default.length === 6, "MCP 도구 등록: 구조화 출력·비파괴·기본 include 6");
  const vres = await client.callTool({ name: "prepare_egovframe_delivery", arguments: { projectDir: proj, outputDir: out3, verify: true } });
  assert(vres.structuredContent.mode === "verify" && vres.structuredContent.verify.ok === true && vres.content[0].text.includes("✅ 일치"), "MCP verify=true 호출");
  const pres = await client.callTool({ name: "prepare_egovframe_delivery", arguments: { projectDir: proj, outputDir: path.join(root, "delivery-5") } });
  assert(pres.structuredContent.mode === "prepare" && pres.structuredContent.dryRun === true && !existsSync(path.join(root, "delivery-5")), "MCP dryRun 기본 호출");
  await client.close(); await server.close();
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`delivery FAIL (${n} assertions)`); else console.log(`delivery OK (${n} assertions)`);
