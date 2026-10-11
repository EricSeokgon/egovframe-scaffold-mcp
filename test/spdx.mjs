// node test/spdx.mjs — SPDX 2.3 (v0.43) 오프라인 검증: CycloneDX → SPDX 변환(공식 spdx-spec v2.3 스키마), SPDX → 점검 모양,
//   최소 요소 7종 판정 보존, generate_egovframe_sbom(bomFormat=spdx-json)·check_egovframe_sbom 의 SPDX 입력.
//   고정물 test/fixtures/sbom-egov-web-plugin.cdx.json 은 공식 egovframe-web 템플릿에 cyclonedx-maven-plugin 2.9.3 을 실행한 출력(component 67).
import { cdxToSpdx, spdxToCdx, isSpdxDocument, spdxAgent, spdxTimestamp, checkMinimumElements, applySbomMetadata, fillComponentSuppliers, enrichBom, generateSbom, renderSbomMarkdown, checkSbom, renderSbomCheckMarkdown, OUTPUT_SCHEMAS, SERVER_VERSION } from "../dist/index.js";
import { validateSpdx } from "./spec-schemas.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
const fixtureText = readFileSync(new URL("./fixtures/sbom-egov-web-plugin.cdx.json", import.meta.url), "utf8");
const fresh = () => JSON.parse(fixtureText);
const T = () => Date.UTC(2026, 9, 11, 9, 0, 0);
const elementsOf = (r) => r.elements.map((e) => `${e.id}:${e.satisfied}/${e.total}`).join(" ");
const edgesOfCdx = (b) => new Set((b.dependencies ?? []).flatMap((d) => (d.dependsOn ?? []).map((t) => `${d.ref}>${t}`)));

// ── 도우미 ───────────────────────────────────────────────
assert(spdxTimestamp("2026-10-07T06:14:20.123Z") === "2026-10-07T06:14:20Z" && spdxTimestamp("2026-10-07T15:14:20+09:00") === "2026-10-07T06:14:20Z" && spdxTimestamp("x") === null && spdxTimestamp(undefined) === null, "created 형식(밀리초 제거·UTC)·해석 불가 null");
assert(JSON.stringify(spdxAgent("Organization: 행정안전부 (a@b.kr)")) === JSON.stringify({ kind: "Organization", name: "행정안전부", email: "a@b.kr" }) && spdxAgent("Tool: x-1.0").kind === "Tool" && spdxAgent("NOASSERTION") === null && spdxAgent("bogus") === null, "Person·Organization·Tool 해석, NOASSERTION 은 없음");
assert(isSpdxDocument({ spdxVersion: "SPDX-2.3" }) && isSpdxDocument({ spdxVersion: "SPDX-2.2" }) && !isSpdxDocument({ spdxVersion: "SPDX-3.0" }) && !isSpdxDocument({ bomFormat: "CycloneDX" }), "SPDX 2.x 판별(3.0 제외)");

// ── CycloneDX → SPDX: 실제 플러그인 출력 ────────────────────
const raw = fresh();
const { doc, notes } = cdxToSpdx(raw, { now: T });
assert(validateSpdx(doc) === null, `공식 SPDX 2.3 스키마 통과${validateSpdx(doc) ? `: ${validateSpdx(doc)}` : ""}`);
assert(doc.spdxVersion === "SPDX-2.3" && doc.dataLicense === "CC0-1.0" && doc.SPDXID === "SPDXRef-DOCUMENT" && doc.creationInfo.created === "2026-10-07T06:14:20Z" && notes.length === 0, "문서 머리: 2.3·CC0-1.0·created = CycloneDX timestamp");
assert(doc.documentNamespace.endsWith("eeb29158-fdf6-38a8-a164-84278dda6a87") && cdxToSpdx(fresh(), { now: T }).doc.documentNamespace === doc.documentNamespace, "documentNamespace 는 serialNumber UUID — 다시 변환해도 같음");
assert(doc.creationInfo.creators.includes(`Tool: egovframe-scaffold-mcp-${SERVER_VERSION}`) && doc.creationInfo.creators.some((c) => /^Tool: cyclonedx-maven-plugin-2\.9\.3$/.test(c)) && !doc.creationInfo.creators.some((c) => /^(Person|Organization):/.test(c)), "creators: 생성 도구만(원본에 작성자 없음)");
assert(doc.packages.length === raw.components.length + 1 && doc.packages[0].primaryPackagePurpose === "APPLICATION" && doc.packages.slice(1).every((p) => p.primaryPackagePurpose === "LIBRARY"), `패키지 ${doc.packages.length} = component 67 + 주 component`);
assert(new Set(doc.packages.map((p) => p.SPDXID)).size === doc.packages.length && doc.packages.every((p) => /^SPDXRef-[A-Za-z0-9.-]+$/.test(p.SPDXID)), "SPDXID 고유·허용 문자");
assert(doc.packages.filter((p) => p.externalRefs?.some((r) => r.referenceType === "purl" && r.referenceCategory === "PACKAGE-MANAGER")).length === 68, "purl externalRefs 68");
const describes = doc.relationships.filter((r) => r.relationshipType === "DESCRIBES");
assert(describes.length === 1 && describes[0].spdxElementId === "SPDXRef-DOCUMENT" && describes[0].relatedSpdxElement === doc.packages[0].SPDXID && doc.documentDescribes[0] === doc.packages[0].SPDXID, "DESCRIBES: 문서 → 주 패키지");
const realEdges = doc.relationships.filter((r) => r.relationshipType === "DEPENDS_ON" && r.relatedSpdxElement !== "NONE");
const noneEdges = doc.relationships.filter((r) => r.relationshipType === "DEPENDS_ON" && r.relatedSpdxElement === "NONE");
assert(realEdges.length === edgesOfCdx(raw).size && noneEdges.length === raw.dependencies.filter((d) => !d.dependsOn?.length).length, `DEPENDS_ON ${realEdges.length}(= CycloneDX 의존 간선) + 의존 없음 NONE ${noneEdges.length}`);
const mvc = doc.packages.find((p) => p.name === "egovframe-rte-ptl-mvc");
assert(mvc.versionInfo === "5.0.0" && mvc.supplier === "NOASSERTION" && mvc.downloadLocation === "NOASSERTION" && mvc.filesAnalyzed === false && mvc.checksums.length === 8 && mvc.checksums.some((c) => c.algorithm === "SHA1") && mvc.checksums.some((c) => c.algorithm === "SHA3-512") && mvc.licenseDeclared === "Apache-2.0", "패키지 필드: 버전·공급자 없음(NOASSERTION)·체크섬 8종(SHA-1→SHA1)·선언 라이선스");
const named = doc.packages.filter((p) => /LicenseRef-/.test(p.licenseDeclared));
assert(named.length > 0 && doc.hasExtractedLicensingInfos.length > 0 && named.every((p) => p.licenseDeclared.split(" OR ").every((id) => !id.startsWith("LicenseRef-") || doc.hasExtractedLicensingInfos.some((x) => x.licenseId === id))), `이름만 있는 라이선스 → LicenseRef + hasExtractedLicensingInfos(${doc.hasExtractedLicensingInfos.length}종)`);
const broken = structuredClone(doc); delete broken.packages[1].name;
assert(validateSpdx(broken) !== null, "스키마 검증이 실제로 동작(패키지 name 삭제 시 실패)");

// ── 왕복: 최소 요소 판정 보존 ─────────────────────────────
const back = spdxToCdx(doc);
assert(elementsOf(checkMinimumElements(back.bom)) === elementsOf(checkMinimumElements(raw)) && checkMinimumElements(back.bom).verdict === "needs-work", `원본(공급자·작성자 없음): 요소별 충족 수 동일 — ${elementsOf(checkMinimumElements(raw))}`);
const filled = fresh(); applySbomMetadata(filled, { supplier: "행정안전부", author: "예시 SI" }); fillComponentSuppliers(filled); enrichBom(filled, "egovframe-boot");
filled.vulnerabilities = [{ id: "GHSA-test-0001", source: { name: "OSV", url: "https://osv.dev/vulnerability/GHSA-test-0001" }, affects: [{ ref: filled.components[1]["bom-ref"] }, { ref: filled.components[2]["bom-ref"] }] }];
const fdoc = cdxToSpdx(filled, { now: T }).doc;
assert(validateSpdx(fdoc) === null && fdoc.packages[0].supplier === "Organization: 행정안전부" && fdoc.creationInfo.creators.includes("Organization: 예시 SI"), "공급자·작성자 채운 문서: 스키마 통과, 주 패키지 supplier·creators Organization");
const fback = spdxToCdx(fdoc).bom;
assert(checkMinimumElements(filled).verdict === "ready" && elementsOf(checkMinimumElements(fback)) === elementsOf(checkMinimumElements(filled)), "채운 문서: 판정 ready 와 요소별 충족 수 동일");
assert(fback.components.length === filled.components.length && fback.metadata.component.name === "example" && fback.metadata.authors[0].name === "예시 SI" && fback.metadata.supplier.name === "행정안전부", "되읽기: component 수·주 component·작성자·공급자");
const purls = (b) => new Set(b.components.map((c) => c.purl));
assert([...purls(filled)].every((p) => purls(fback).has(p)) && fback.components.find((c) => c.name === "egovframe-rte-ptl-mvc").group === "org.egovframe.rte", "되읽기: purl 집합 동일·purl 에서 group");
const idToPurl = new Map([...fback.components, fback.metadata.component].map((c) => [c["bom-ref"], c.purl]));
const edgesBack = new Set(fback.dependencies.flatMap((d) => d.dependsOn.map((t) => `${idToPurl.get(d.ref)}>${idToPurl.get(t)}`)));
assert(edgesBack.size === edgesOfCdx(filled).size && [...edgesOfCdx(filled)].every((e) => edgesBack.has(e)), `되읽기: 의존 간선 ${edgesBack.size} 동일`);
const st = (b) => b.components.map((c) => c.properties?.find((p) => p.name === "egovframe:status")?.value).join();
assert(st(fback) === st(filled) && fdoc.packages[1].annotations.some((a) => a.annotationType === "OTHER" && /^egovframe:status=/.test(a.comment)), "기준 판정(egovframe:*)은 annotations 로 보존");
assert(fback.vulnerabilities.length === 1 && fback.vulnerabilities[0].id === "GHSA-test-0001" && fback.vulnerabilities[0].affects.length === 2 && fdoc.packages[2].externalRefs.some((r) => r.referenceType === "advisory" && r.referenceCategory === "SECURITY"), "취약점은 SECURITY advisory externalRefs 로 보존");

// 빠진 요소도 같은 결과(생성 시각은 SPDX 필수라 예외 — 안내)
const gappy = structuredClone(filled); delete gappy.components[0].purl; delete gappy.components[1].version; delete gappy.components[3].supplier; gappy.dependencies = gappy.dependencies.slice(0, 30);
assert(elementsOf(checkMinimumElements(spdxToCdx(cdxToSpdx(gappy, { now: T }).doc).bom)) === elementsOf(checkMinimumElements(gappy)), `빠진 요소(purl·버전·공급자·의존관계): 요소별 결과 동일 — ${elementsOf(checkMinimumElements(gappy))}`);
const noTs = structuredClone(filled); delete noTs.metadata.timestamp;
const noTsConv = cdxToSpdx(noTs, { now: T });
assert(noTsConv.doc.creationInfo.created === "2026-10-11T09:00:00Z" && noTsConv.notes.some((x) => x.includes("변환 시각")) && validateSpdx(noTsConv.doc) === null, "timestamp 없음: created 필수라 변환 시각 + 안내");

// ── 다른 도구가 만든 SPDX 모양 ───────────────────────────
const ext = { spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: "ext", documentNamespace: "https://example.com/ext-1", creationInfo: { created: "2026-10-01T00:00:00Z", creators: ["Tool: syft-1.20.0", "Person: 홍길동 (hong@example.kr)"] },
  packages: [
    { SPDXID: "SPDXRef-app", name: "app", versionInfo: "1.0", downloadLocation: "NOASSERTION", supplier: "Organization: 예시기관" },
    { SPDXID: "SPDXRef-a", name: "a", versionInfo: "1", downloadLocation: "NOASSERTION", originator: "Person: Kim", externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:maven/g/a@1" }] },
    { SPDXID: "SPDXRef-b", name: "b", versionInfo: "2", downloadLocation: "NOASSERTION", supplier: "NOASSERTION", externalRefs: [{ referenceCategory: "SECURITY", referenceType: "cpe23Type", referenceLocator: "cpe:2.3:a:x:b:2:*:*:*:*:*:*:*" }] },
    { SPDXID: "SPDXRef-c", name: "c", downloadLocation: "NOASSERTION" },
    { SPDXID: "SPDXRef-other", name: "other", downloadLocation: "NOASSERTION" },
  ],
  relationships: [
    { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: "SPDXRef-app" },
    { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: "SPDXRef-other" },
    { spdxElementId: "SPDXRef-app", relationshipType: "DEPENDS_ON", relatedSpdxElement: "SPDXRef-a" },
    { spdxElementId: "SPDXRef-b", relationshipType: "DEPENDENCY_OF", relatedSpdxElement: "SPDXRef-app" },
    { spdxElementId: "SPDXRef-a", relationshipType: "DEPENDS_ON", relatedSpdxElement: "NONE" },
    { spdxElementId: "SPDXRef-c", relationshipType: "DEPENDS_ON", relatedSpdxElement: "NOASSERTION" },
  ] };
assert(validateSpdx(ext) === null, "외부 모양 SPDX 예시도 스키마 통과");
const er = spdxToCdx(ext);
const erm = checkMinimumElements(er.bom);
const get = (id) => erm.elements.find((e) => e.id === id);
assert(er.bom.metadata.component.name === "app" && er.notes.some((x) => x.includes("DESCRIBES 대상이 2개")) && er.notes.some((x) => x.includes("NOASSERTION 1건")), "주 component = 첫 DESCRIBES, 여럿·NOASSERTION 안내");
assert(er.bom.dependencies.find((d) => d.ref === "SPDXRef-app").dependsOn.sort().join() === "SPDXRef-a,SPDXRef-b" && er.bom.dependencies.find((d) => d.ref === "SPDXRef-a").dependsOn.length === 0 && !er.bom.dependencies.some((d) => d.ref === "SPDXRef-c"), "DEPENDENCY_OF 뒤집기·NONE = 의존 없음·NOASSERTION = 모름");
assert(get("supplier").satisfied === 2 && get("identifier").satisfied === 2 && get("version").satisfied === 3 && get("dependencies").satisfied === 2 && get("author").ok && er.bom.metadata.authors[0].email === "hong@example.kr" && er.bom.metadata.tools.components[0].version === "1.20.0", `SPDX 필드 대응: 공급자(supplier·originator) 2·식별자(purl·cpe) 2·버전 3·의존 2/5·작성자(Person)·도구`);

// ── generate_egovframe_sbom(bomFormat=spdx-json) ──────────
const proj = mkdtempSync(path.join(tmpdir(), "egovspdx-"));
write(proj, "pom.xml", `<project><groupId>egovframework.example</groupId><artifactId>example</artifactId><version>1.0.0</version><organization><name>예시 기관</name></organization><parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>5.0.0</version></parent></project>`);
const fakePlugin = async (cmd, o) => { const dir = cmd.args.find((a) => a.startsWith("-DoutputDirectory=")).slice("-DoutputDirectory=".length); writeFileSync(path.join(dir, "bom.json"), fixtureText); o.onData("[INFO] BUILD SUCCESS\n"); return { exitCode: 0, timedOut: false }; };
const plan = await generateSbom({ projectDir: proj, format: "spdx-json", platform: "linux" });
assert(plan.dryRun && plan.outputPath === "sbom/bom.spdx.json" && plan.specVersion === "SPDX-2.3" && /SPDX 2\.3 JSON/.test(plan.notes[0]) && !existsSync(path.join(proj, "sbom")), "dryRun: 기본 경로 sbom/bom.spdx.json·계획만");
const g = await generateSbom({ projectDir: proj, format: "spdx-json", dryRun: false, runner: fakePlugin, platform: "linux", now: T, offline: false, osvQuery: async (q) => ({ results: q.map((x) => (x.package.name === "org.springframework:spring-webmvc" ? { vulns: [{ id: "GHSA-spdx-0001" }] } : {})) }) });
const gdoc = JSON.parse(readFileSync(path.join(proj, "sbom/bom.spdx.json"), "utf8"));
assert(g.written && g.format === "spdx-json" && g.components === 67 && isSpdxDocument(gdoc) && validateSpdx(gdoc) === null && gdoc.packages.length === 68, `생성: SPDX 2.3 파일(패키지 68) 스키마 통과 (${g.bytes} bytes)`);
assert(g.minimum.verdict === "ready" && gdoc.packages[0].supplier === "Organization: 예시 기관" && gdoc.creationInfo.creators.includes("Organization: 예시 기관") && g.vulnerabilities === 1 && gdoc.packages.some((p) => p.externalRefs?.some((r) => r.comment === "GHSA-spdx-0001")), "pom <organization> 으로 최소 요소 ready·OSV 결과는 advisory 로");
assert(g.notes.some((x) => /SPDX 2\.3 으로 변환했습니다 — 패키지 68/.test(x)) && renderSbomMarkdown(g).startsWith("# SBOM 생성 (SPDX 2.3 JSON)"), "안내·Markdown 제목");
const { bom: _b, spdx: _s, ...gs } = g;
assert(OUTPUT_SCHEMAS.generate_egovframe_sbom.safeParse(gs).success && OUTPUT_SCHEMAS.generate_egovframe_sbom.safeParse(plan).success, "생성 결과가 outputSchema 통과");
const c1 = await generateSbom({ projectDir: proj, dryRun: false, runner: fakePlugin, platform: "linux", now: T });
assert(c1.outputPath === "sbom/bom.cdx.json" && JSON.parse(readFileSync(c1.absolutePath, "utf8")).bomFormat === "CycloneDX", "기본 형식은 그대로 CycloneDX(sbom/bom.cdx.json)");

// ── check_egovframe_sbom: SPDX 입력 ──────────────────────
const cs = await checkSbom({ projectDir: proj, sbomPath: "sbom/bom.spdx.json" });
const cc = await checkSbom({ projectDir: proj, sbomPath: "sbom/bom.cdx.json" });
assert(cs.document.format === "spdx" && cs.document.specVersion === "SPDX-2.3" && cs.document.components === 67 && cc.document.format === "cyclonedx", "형식 자동 판별(spdx·cyclonedx)");
assert(elementsOf(cs.minimum) === elementsOf(cc.minimum) && cs.minimum.verdict === cc.minimum.verdict && cs.minimum.verdict === "ready", `같은 프로젝트의 SPDX·CycloneDX 점검: 최소 요소 판정 동일(${cs.minimum.verdict})`);
assert(JSON.stringify(cs.recheck.summary) === JSON.stringify(cc.recheck.summary) && cs.recheck.changed.length === 0 && cs.recheck.unrecorded === 0, "purl 재판정 집계 동일·판정 annotations 로 비교 가능(미기록 0)");
assert(cs.notes.some((x) => x.includes("SPDX-2.3 문서입니다")) && renderSbomCheckMarkdown(cs).includes("- SPDX-2.3 · component 67종"), "안내·Markdown 머리");
const dx = await checkSbom({ projectDir: proj, sbomPath: "sbom/bom.spdx.json", baselinePath: "sbom/bom.cdx.json" });
assert(dx.diff.added.length === 0 && dx.diff.removed.length === 0 && dx.diff.versionChanged.length === 0 && dx.diff.unchanged === 67 && dx.notes.some((x) => x.includes("좌표(purl) 기준으로 비교")), "SPDX ↔ CycloneDX 비교: 차이 0·unchanged 67");
const osv = await checkSbom({ projectDir: proj, sbomPath: "sbom/bom.spdx.json", offline: false, osvQuery: async (q) => ({ results: q.map((x) => (x.package.name === "org.springframework:spring-webmvc" ? { vulns: [{ id: "GHSA-spdx-0001" }, { id: "GHSA-new-0002" }] } : {})) }) });
assert(osv.recheck.osv.queried && osv.recheck.osv.recorded && osv.recheck.osv.newIds.join() === "GHSA-new-0002", "SPDX 의 advisory 를 기록으로 보고 새 취약점만 newIds");
let threw = ""; try { await checkSbom({ projectDir: proj, sbomPath: "sbom/bom.spdx.json", vex: true }); } catch (e) { threw = e.message; }
assert(/VEX 초안은 CycloneDX SBOM 에서만/.test(threw) && !existsSync(path.join(proj, "sbom/vex.cdx.json")), "SPDX 입력의 vex=true 는 거부(파일 없음)");
assert(OUTPUT_SCHEMAS.check_egovframe_sbom.safeParse(cs).success && OUTPUT_SCHEMAS.check_egovframe_sbom.safeParse(dx).success, "점검 결과가 outputSchema 통과");
rmSync(proj, { recursive: true, force: true });

if (process.exitCode) console.error(`spdx FAIL (${n} assertions)`); else console.log(`spdx OK (${n} assertions)`);
