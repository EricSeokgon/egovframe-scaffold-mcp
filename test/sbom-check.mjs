// node test/sbom-check.mjs — SBOM 운영(v0.40) 오프라인 검증: 최소 요소·purl 재판정·가짜 OSV·비교·VEX 생성/보존·스키마
//   고정물 test/fixtures/sbom-egov-web-plugin.cdx.json 은 공식 egovframe-web 템플릿(Initializr f8f5725)에 cyclonedx-maven-plugin 2.9.3 을
//   실제로 실행한 출력(2026-10-07, component 67)이다.
import { loadSbomRules, valuesAt, parseMavenPurl, coordinateOf, supplierFor, checkMinimumElements, recheckSbom, diffSboms, bomLink, mergeVex, checkSbom, renderSbomCheckMarkdown, applySbomMetadata, fillComponentSuppliers, pomIdentity, OUTPUT_SCHEMAS, DEFAULT_VEX_PATH, SERVER_VERSION } from "../dist/index.js";
import { validateCycloneDx } from "./cdx-schema.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
const fixtureText = readFileSync(new URL("./fixtures/sbom-egov-web-plugin.cdx.json", import.meta.url), "utf8");
const fresh = () => JSON.parse(fixtureText);
const T = () => Date.UTC(2026, 9, 7, 9, 0, 0);

// ── 규칙·경로·purl ───────────────────────────────────────
const rules = loadSbomRules();
assert(rules.elements.map((e) => e.id).join(",") === "supplier,name,version,identifier,dependencies,author,timestamp" && rules.elements.filter((e) => e.level === "document").length === 2, "규칙: 최소 요소 7종(문서 2·component 5)");
assert(rules.sources.some((s) => /NTIA/.test(s.name)) && rules.sources.some((s) => /가이드라인 1\.0/.test(s.name)) && rules.suppliers.every((s) => s.name && s.basis && s.groupIdPrefix), "규칙: 출처(NTIA·국내 가이드라인)·공급자 표 근거");
assert(valuesAt({ a: { b: [{ c: "x" }, { c: "" }, {}] } }, "a.b[].c").join() === "x" && valuesAt({ metadata: { timestamp: "t" } }, "metadata.timestamp")[0] === "t" && valuesAt({}, "x.y").length === 0 && valuesAt({ v: 3 }, "v")[0] === "3", "valuesAt: 배열·빈 값 제외·숫자");
const pu = parseMavenPurl("pkg:maven/org.egovframe.rte/egovframe-rte-ptl-mvc@5.0.0?type=jar");
assert(pu.groupId === "org.egovframe.rte" && pu.artifactId === "egovframe-rte-ptl-mvc" && pu.version === "5.0.0" && pu.type === "jar", "purl 해석");
assert(parseMavenPurl("pkg:maven/g%2Ex/a@1.0%2B1")?.version === "1.0+1" && parseMavenPurl("pkg:npm/x@1") === null && parseMavenPurl(undefined) === null && parseMavenPurl("pkg:maven/g/a").version === null, "purl: 디코딩·비 Maven·버전 없음");
assert(coordinateOf({ type: "library", name: "a", group: "g", version: "1" }).groupId === "g" && coordinateOf({ type: "library", name: "x" }) === null, "coordinateOf: purl 없으면 group·name");
assert(supplierFor("org.egovframe.rte").name === "eGovFramework" && supplierFor("org.hibernate.validator").name === "Red Hat, Inc." && supplierFor("org.egovframework") === null && supplierFor("com.example") === null, "공급자 표: 접두어 경계 일치");

// ── (1) 최소 요소: 실제 플러그인 출력 ──────────────────────
const raw = fresh();
const m0 = checkMinimumElements(raw);
const el = (r, id) => r.elements.find((e) => e.id === id);
assert(m0.verdict === "needs-work" && m0.components === 68 && raw.components.length === 67, `공식 web 템플릿 SBOM: 보완 필요(component 67 + 주 1)`);
assert(!el(m0, "supplier").ok && el(m0, "supplier").satisfied === 50 && el(m0, "supplier").missing[0].startsWith("(주) egovframework.example:example") && el(m0, "supplier").missing.some((x) => x.startsWith("org.egovframe.rte:egovframe-rte-ptl-mvc")), "공급자: 50/68 — 주 component·RTE 등 publisher 없는 18종");
assert(!el(m0, "author").ok && el(m0, "author").missing[0] === "metadata" && el(m0, "timestamp").ok, "작성자 없음(도구만 있음) · 생성 시각 있음");
assert(["name", "version", "identifier", "dependencies"].every((id) => el(m0, id).ok && el(m0, id).satisfied === 68), "구성요소명·버전·고유식별자·의존관계 68/68");
assert(m0.componentsWithGaps === 18 && m0.supplierFromCatalog === 0, "요소가 빠진 component 18");
// 빠진 항목별
const broken = fresh();
delete broken.metadata.timestamp; delete broken.components[0].purl; delete broken.components[1].version; broken.dependencies = broken.dependencies.filter((d) => d.ref !== broken.components[2]["bom-ref"]); broken.components[3].name = "";
const m1 = checkMinimumElements(broken);
assert(!el(m1, "timestamp").ok && el(m1, "identifier").satisfied === 67 && el(m1, "version").satisfied === 67 && el(m1, "dependencies").satisfied === 67 && el(m1, "name").satisfied === 67, "빠진 항목별 감지: 시각·purl·버전·의존관계·이름");
const badTs = fresh(); badTs.metadata.timestamp = "어제";
assert(!el(checkMinimumElements(badTs), "timestamp").ok, "생성 시각: 날짜가 아니면 미충족");
const cpe = fresh(); delete cpe.components[0].purl; cpe.components[0].cpe = "cpe:2.3:a:x:y:1:*:*:*:*:*:*:*";
assert(el(checkMinimumElements(cpe), "identifier").ok, "고유식별자: cpe 도 인정");

// 보강: 메타데이터 + 공급자 표
const fixed = fresh();
applySbomMetadata(fixed, { supplier: "예시 기관", author: "예시 SI" });
const filled = fillComponentSuppliers(fixed);
const m2 = checkMinimumElements(fixed);
assert(filled === 17 && m2.verdict === "ready" && m2.componentsWithGaps === 0 && m2.supplierFromCatalog === 17, `보강 후 제출 가능(공급자 표 17종)`);
const rte = fixed.components.find((c) => c.name === "egovframe-rte-ptl-mvc");
assert(rte.supplier.name === "eGovFramework" && rte.supplier.url[0] === "https://www.egovframe.go.kr" && rte.properties.some((p) => p.name === "egovframe:supplierBasis" && p.value === "catalog") && fixed.metadata.supplier.name === "예시 기관" && fixed.metadata.component.supplier.name === "예시 기관" && fixed.metadata.authors[0].name === "예시 SI", "보강: component supplier(근거 속성)·문서 supplier·authors");
const spring = fixed.components.find((c) => c.name === "spring-webmvc");
assert(!spring.supplier && spring.publisher, "publisher 가 있는 component 는 건드리지 않음");
assert(fillComponentSuppliers(fixed) === 0 && fixed.metadata.lifecycles.length === 1, "재실행: 추가 보완 없음, 플러그인 lifecycles 유지");
const md = fresh(); delete md.metadata.lifecycles; applySbomMetadata(md, { componentName: "업무시스템", componentVersion: "2.0.0" });
assert(md.metadata.lifecycles[0].phase === "build" && md.metadata.component.name === "업무시스템" && md.metadata.component.version === "2.0.0" && md.metadata.component["bom-ref"].includes("example@1.0.0") && !md.metadata.supplier, "주 component 이름·버전 덮어쓰기(bom-ref 유지)·lifecycles 기본");
assert(validateCycloneDx(fixed) === null && validateCycloneDx(raw) === null, "보강 문서·원본 모두 CycloneDX 1.6 공식 스키마 통과");

// pom 메타데이터
const pp = mkdtempSync(path.join(tmpdir(), "egovsbomck-pom-"));
write(pp, "pom.xml", `<project><parent><groupId>p</groupId><artifactId>q</artifactId><version>9</version><name>부모</name></parent><groupId>g</groupId><artifactId>a</artifactId><version>1.2.3</version><name>업무 시스템</name><!-- <organization><name>주석</name></organization> --><organization><name>예시 기관</name><url>https://example.go.kr</url></organization><developers><developer><name>개발자</name></developer></developers></project>`);
const pid = pomIdentity(pp);
assert(pid.organization === "예시 기관" && pid.name === "업무 시스템" && pid.version === "1.2.3", "pomIdentity: organization·name·version(parent·주석·developers 제외)");
write(pp, "pom.xml", `<project><artifactId>a</artifactId><version>\${revision}</version></project>`);
assert(Object.keys(pomIdentity(pp)).length === 0 && Object.keys(pomIdentity(path.join(pp, "none"))).length === 0, "pomIdentity: 속성 버전·pom 없음 → 비움");
rmSync(pp, { recursive: true, force: true });

// ── (2) 재판정·OSV ───────────────────────────────────────
const enriched = fresh();
for (const c of enriched.components) c.properties = [{ name: "egovframe:status", value: c.name === "spring-webmvc" ? "ok" : c.name === "log4j-core" ? "outdated" : "ok" }];
enriched.vulnerabilities = [{ id: "GHSA-old", "bom-ref": "vuln:GHSA-old", source: { name: "OSV" }, affects: [{ ref: enriched.components.find((c) => c.name === "spring-core")["bom-ref"] }] }];
const calls = [];
const fakeOsv = async (q) => { calls.push(q.length); return { results: q.map((x) => (x.package.name === "org.springframework:spring-webmvc" ? { vulns: [{ id: "GHSA-new" }, { id: "GHSA-new" }] } : x.package.name === "org.springframework:spring-core" ? { vulns: [{ id: "GHSA-core" }] } : {})) }; };
const rc = await recheckSbom(enriched, { offline: false, osvQuery: fakeOsv, parentKind: "none" });
assert(rc.components === 67 && Object.values(rc.summary).reduce((a, b) => a + b, 0) === 67 && rc.unrecorded === 0 && calls.join() === "67", "재판정: purl 67종 판정, OSV 한 번(100개 단위)");
const ptlChange = rc.changed.find((c) => c.component.startsWith("org.egovframe.rte:egovframe-rte-ptl-mvc@5.0.0"));
assert(ptlChange && ptlChange.from === "ok" && ptlChange.to === "outdated" && ptlChange.baseline === "5.0.2", "판정 변화: 기록 ok → 지금 outdated(기준 5.0.2)");
assert(rc.osv.queried && rc.osv.recorded && rc.osv.ids === 2 && rc.osv.newIds.join() === "GHSA-core,GHSA-new" && rc.osv.goneIds.join() === "GHSA-old" && rc.osv.items.find((i) => i.component.startsWith("org.springframework:spring-webmvc")).ids.join() === "GHSA-new", "OSV: 새 ID·사라진 ID·중복 제거");
const rcOff = await recheckSbom(fresh());
assert(!rcOff.osv.queried && rcOff.unrecorded === 67 && rcOff.changed.length === 0 && !rcOff.osv.recorded, "offline: 조회 안 함 · 판정 기록 없는 SBOM 은 변화 비교 제외");
const rcErr = await recheckSbom(fresh(), { offline: false, osvQuery: async () => { throw new Error("timeout"); } });
assert(!rcErr.osv.queried && /OSV 조회 실패: timeout/.test(rcErr.osv.error), "OSV 실패는 오류 문자열로");

// ── (3) 비교 ─────────────────────────────────────────────
const before = fresh(), after = fresh();
after.components = after.components.filter((c) => c.name !== "json-simple");
const sw = after.components.find((c) => c.name === "spring-webmvc"); sw.version = "6.2.12"; sw.purl = sw.purl.replace("6.2.11", "6.2.12");
after.components.push({ type: "library", "bom-ref": "pkg:maven/com.example/new-lib@1.0?type=jar", group: "com.example", name: "new-lib", version: "1.0", purl: "pkg:maven/com.example/new-lib@1.0?type=jar" });
before.components.find((c) => c.name === "h2" || c.name === "hsqldb" || c.name === "commons-lang3")?.properties?.push?.({});
const bLog = before.components.find((c) => c.name === "log4j-core"), aLog = after.components.find((c) => c.name === "log4j-core");
bLog.properties = [{ name: "egovframe:status", value: "ok" }]; aLog.properties = [{ name: "egovframe:status", value: "outdated" }];
before.vulnerabilities = [{ id: "GHSA-gone", affects: [{ ref: bLog["bom-ref"] }] }];
after.vulnerabilities = [{ id: "GHSA-x", affects: [{ ref: aLog["bom-ref"] }] }];
const df = diffSboms(after, before, "sbom/old.cdx.json", { queried: true, recorded: true, ids: 1, newIds: [], goneIds: [], items: [{ component: "org.springframework:spring-webmvc@6.2.12", ref: sw["bom-ref"], ids: ["GHSA-y"] }] });
assert(df.added.length === 1 && df.added[0].component === "com.example:new-lib" && df.removed.length === 1 && df.removed[0].component === "com.googlecode.json-simple:json-simple" && df.removed[0].version === "1.1.1", "비교: 추가·제거");
assert(df.versionChanged.length === 1 && df.versionChanged[0].component === "org.springframework:spring-webmvc" && df.versionChanged[0].from === "6.2.11" && df.versionChanged[0].to === "6.2.12", "비교: 버전 변경");
assert(df.statusChanged.length === 1 && df.statusChanged[0].to === "outdated" && df.newVulnerabilities.map((v) => v.id).join() === "GHSA-x,GHSA-y" && df.resolvedVulnerabilities.join() === "GHSA-gone" && df.unchanged === 64 && df.baselineTimestamp === "2026-10-07T06:14:20Z", "비교: 판정 변화·새 취약점(SBOM+재조회)·사라진 취약점·같음 64");
const same = diffSboms(fresh(), fresh(), "x");
assert(same.added.length + same.removed.length + same.versionChanged.length + same.statusChanged.length + same.newVulnerabilities.length === 0 && same.unchanged === 67, "같은 SBOM 비교: 차이 0");

// ── (4) VEX ──────────────────────────────────────────────
const bomForVex = fresh();
const r0 = bomForVex.components[0]["bom-ref"], r1 = bomForVex.components[1]["bom-ref"], r2 = bomForVex.components[2]["bom-ref"];
assert(bomLink(bomForVex, r0) === `urn:cdx:eeb29158-fdf6-38a8-a164-84278dda6a87/1#${encodeURIComponent(r0)}` && bomLink({ ...bomForVex, serialNumber: "x" }, r0) === null, "BOM-Link: urn:cdx:<serial>/<version>#<인코딩된 bom-ref>");
const det = new Map([["GHSA-b", new Set([r1])], ["GHSA-a", new Set([r0, r1])]]);
const v1 = mergeVex(bomForVex, det, null, T);
assert(v1.created && v1.added === 2 && v1.doc.version === 1 && v1.doc.vulnerabilities.map((v) => v.id).join() === "GHSA-a,GHSA-b" && v1.doc.vulnerabilities.every((v) => v.analysis.state === "in_triage" && v.affects.every((a) => a.ref.startsWith("urn:cdx:eeb29158"))) && v1.doc.metadata.timestamp === "2026-10-07T09:00:00.000Z" && v1.doc.metadata.tools.components[0].version === SERVER_VERSION, "VEX 생성: ID 정렬·in_triage·BOM-Link·도구");
assert(validateCycloneDx(v1.doc) === null, "VEX 가 CycloneDX 1.6 공식 스키마 통과");
// 사람이 판단을 적음
const human = JSON.parse(JSON.stringify(v1.doc));
human.vulnerabilities[0].analysis = { state: "not_affected", justification: "code_not_reachable", detail: "호출 경로 없음(2026-10-07 검토)" };
human.vulnerabilities[0].custom = "keep";
const det2 = new Map([["GHSA-a", new Set([r0, r1, r2])], ["GHSA-b", new Set([r1, r2])], ["GHSA-c", new Set([r2])]]);
const v2 = mergeVex(bomForVex, det2, human, T);
const a = v2.doc.vulnerabilities.filter((v) => v.id === "GHSA-a");
assert(v2.doc.version === 2 && v2.preserved === 2 && a[0].analysis.state === "not_affected" && a[0].analysis.detail.includes("호출 경로 없음") && a[0].custom === "keep" && a[0].affects.length === 2, "재실행: 사람이 적은 판단·임의 필드 그대로");
assert(a.length === 2 && a[1]["bom-ref"] === "vex:GHSA-a:2" && a[1].analysis.state === "in_triage" && a[1].affects.length === 1, "판단 끝난 ID 에 새 영향 component → 같은 ID 의 새 in_triage 항목");
const b = v2.doc.vulnerabilities.find((v) => v.id === "GHSA-b");
assert(b.affects.length === 2 && v2.extended === 1 && v2.added === 2 && v2.doc.vulnerabilities.some((v) => v.id === "GHSA-c"), "in_triage 항목은 affects 를 덧붙임 · 새 ID 추가");
const v3 = mergeVex(bomForVex, new Map([["GHSA-c", new Set([r2])]]), v2.doc, T);
assert(v3.added === 0 && v3.extended === 0 && v3.notDetected.join() === "GHSA-a,GHSA-b" && v3.doc.vulnerabilities.length === 4 && v3.states.not_affected === 1 && v3.states.in_triage === 3, "더 이상 탐지 안 됨: 지우지 않고 알림·상태 집계");
const v2copy = JSON.parse(JSON.stringify(v2.doc)); delete v2copy.vulnerabilities[0].custom; // 임의 필드는 스키마 밖(보존 확인용)
assert(validateCycloneDx(v2copy) === null, "갱신된 VEX 도 스키마 통과");

// ── checkSbom: 파일 단위 ─────────────────────────────────
const proj = mkdtempSync(path.join(tmpdir(), "egovsbomck-"));
write(proj, "pom.xml", `<project><groupId>egovframework.example</groupId><artifactId>example</artifactId><version>1.0.0</version><parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.0</version></parent></project>`);
let threw = "";
try { await checkSbom({ projectDir: proj }); } catch (e) { threw = e.message; }
assert(/SBOM 이 없습니다: sbom\/bom\.cdx\.json — generate_egovframe_sbom/.test(threw), "SBOM 없음 → 안내 오류");
write(proj, "sbom/spdx.json", JSON.stringify({ spdxVersion: "SPDX-2.3" }));
threw = ""; try { await checkSbom({ projectDir: proj, sbomPath: "sbom/spdx.json" }); } catch (e) { threw = e.message; }
assert(/CycloneDX 문서가 아닙니다.*SPDX 는 지원하지 않습니다/.test(threw), "SPDX 등 비 CycloneDX 거부");
threw = ""; try { await checkSbom({ projectDir: proj, sbomPath: "../x.json" }); } catch (e) { threw = e.message; }
assert(/프로젝트 내부의 상대 경로/.test(threw), "프로젝트 밖 경로 거부");

write(proj, "sbom/bom.cdx.json", JSON.stringify(enriched, null, 2));
write(proj, "sbom/old.cdx.json", JSON.stringify(fresh(), null, 2));
const sbomBytes = readFileSync(path.join(proj, "sbom/bom.cdx.json"));
const c1 = await checkSbom({ projectDir: proj, baselinePath: "sbom/old.cdx.json", offline: false, osvQuery: fakeOsv });
assert(c1.document.components === 67 && c1.document.tools[0] === "cyclonedx-maven-plugin 2.9.3" && c1.document.vulnerabilities === 1 && c1.minimum.verdict === "needs-work" && c1.recheck.osv.newIds.length === 2 && c1.diff.newVulnerabilities.length === 3 && !c1.vex, "checkSbom: 문서 요약·최소 요소·재조회·비교(VEX 없음)");
assert(OUTPUT_SCHEMAS.check_egovframe_sbom.safeParse(c1).success, "결과가 outputSchema 통과");
assert(c1.recheck.changed.some((c) => c.to === "outdated") && readFileSync(path.join(proj, "sbom/bom.cdx.json")).equals(sbomBytes) && !existsSync(path.join(proj, DEFAULT_VEX_PATH)), "web parent(5.0.0) 기준으로 판정 · SBOM 파일 불변 · vex=false 면 VEX 없음");
const mdText = renderSbomCheckMarkdown(c1);
assert(mdText.includes("**최소 요소: ⚠️ 보완 필요**") && mdText.includes("| ⚠️ 공급자 | component | 50/68 |") && mdText.includes("생성 이후 새로 알려진 것 2건") && mdText.includes("## 3. 이전 SBOM 과 비교 (sbom/old.cdx.json") && !mdText.includes("VEX ("), "Markdown: 표·재조회·비교");

const dry = await checkSbom({ projectDir: proj, offline: false, osvQuery: fakeOsv, vex: true, dryRun: true });
assert(dry.vex.dryRun && !dry.vex.written && dry.vex.added === 3 && !existsSync(path.join(proj, DEFAULT_VEX_PATH)), "vex dryRun: 미리보기만(SBOM 의 1건 + 재조회 2건)");
const w1 = await checkSbom({ projectDir: proj, offline: false, osvQuery: fakeOsv, vex: true, now: T });
const vexDoc = JSON.parse(readFileSync(path.join(proj, DEFAULT_VEX_PATH), "utf8"));
assert(w1.vex.written && w1.vex.created && w1.vex.vulnerabilities === 3 && vexDoc.vulnerabilities.length === 3 && validateCycloneDx(vexDoc) === null && renderSbomCheckMarkdown(w1).includes("## 3. VEX (sbom/vex.cdx.json)"), "vex=true: 새 파일·스키마 통과·Markdown 절");
vexDoc.vulnerabilities[0].analysis = { state: "exploitable", response: ["update"], detail: "다음 배포에서 6.2.12 로" };
writeFileSync(path.join(proj, DEFAULT_VEX_PATH), JSON.stringify(vexDoc, null, 2));
const mtime = statSync(path.join(proj, DEFAULT_VEX_PATH)).mtimeMs;
const w2 = await checkSbom({ projectDir: proj, offline: false, osvQuery: fakeOsv, vex: true });
assert(!w2.vex.written && w2.vex.added === 0 && statSync(path.join(proj, DEFAULT_VEX_PATH)).mtimeMs === mtime && w2.notes.some((x) => x.includes("바꾸지 않았습니다")) && w2.vex.states.exploitable === 1, "새 취약점이 없으면 VEX 파일을 건드리지 않음(판단 그대로)");
const moreOsv = async (q) => ({ results: q.map((x) => (x.package.name === "org.apache.logging.log4j:log4j-core" ? { vulns: [{ id: "GHSA-log" }] } : x.package.name === "org.springframework:spring-webmvc" ? { vulns: [{ id: "GHSA-new" }] } : {})) });
const w3 = await checkSbom({ projectDir: proj, offline: false, osvQuery: moreOsv, vex: true });
const vex3 = JSON.parse(readFileSync(path.join(proj, DEFAULT_VEX_PATH), "utf8"));
assert(w3.vex.written && !w3.vex.created && w3.vex.added === 1 && vex3.version === 2 && vex3.vulnerabilities[0].analysis.state === "exploitable" && vex3.vulnerabilities[0].analysis.detail.includes("6.2.12") && vex3.vulnerabilities.some((v) => v.id === "GHSA-log") && w3.vex.notDetected.includes("GHSA-core"), "새 취약점만 추가·version 증가·사람 판단 보존·사라진 ID 알림");
writeFileSync(path.join(proj, DEFAULT_VEX_PATH), "{ 깨진");
threw = ""; try { await checkSbom({ projectDir: proj, vex: true }); } catch (e) { threw = e.message; }
assert(/사람이 적은 판단을 잃지 않도록 중단/.test(threw) && readFileSync(path.join(proj, DEFAULT_VEX_PATH), "utf8") === "{ 깨진", "깨진 VEX 는 덮어쓰지 않고 중단");
threw = ""; try { await checkSbom({ projectDir: proj, vex: true, vexPath: "sbom/bom.cdx.json" }); } catch (e) { threw = e.message; }
assert(/vexPath 가 sbomPath 와 같습니다/.test(threw), "vexPath = sbomPath 거부");
const noSerial = { ...enriched, serialNumber: undefined };
write(proj, "sbom/ns.cdx.json", JSON.stringify(noSerial));
const w4 = await checkSbom({ projectDir: proj, sbomPath: "sbom/ns.cdx.json", vex: true, vexPath: "sbom/ns-vex.cdx.json" });
const vex4 = JSON.parse(readFileSync(path.join(proj, "sbom/ns-vex.cdx.json"), "utf8"));
assert(!w4.vex.usedBomLink && vex4.vulnerabilities[0].affects[0].ref.startsWith("pkg:maven/") && w4.notes.some((x) => x.includes("BOM-Link 대신")), "serialNumber 없으면 bom-ref 그대로 + 안내");
rmSync(proj, { recursive: true, force: true });

if (process.exitCode) console.error(`sbom-check FAIL (${n} assertions)`); else console.log(`sbom-check OK (${n} assertions)`);
