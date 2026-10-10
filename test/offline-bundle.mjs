// node test/offline-bundle.mjs — 폐쇄망 오프라인 번들(v0.42) 오프라인 검증: Maven 버전 비교·OSV 범위·로컬 덤프 질의·번들 만들기(가짜 다운로드·로컬 git)·
// 번들 읽기(지문 검증·변조 거부)·fetch 훅·원본 미러·OSV 출처 노트·의존성 점검 연동
import { compareMavenVersions, inOsvRange, buildOsvIndex, queryOsvIndex, bundleSources, prepareOfflineBundle, renderBundleMarkdown, loadBundle, resetBundleCache, bundleResponseFor, bundleOriginDir, bundleOsvQuery, osvProvenanceNote, fetchWithTimeout, defaultOsvQuery, GitOriginSource, checkDependencies, bundleTemplateList, OUTPUT_SCHEMAS, BUNDLE_ENV, OSV_MAVEN_DUMP_URL, diagnoseNetwork } from "../dist/index.js";
import AdmZip from "adm-zip";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
async function rejects(fn, re, msg) { try { await fn(); assert(false, `${msg} (예외 없음)`); } catch (e) { assert(re.test(e.message), `${msg} (${e.message.slice(0, 100)})`); } }
const sha = (b) => createHash("sha256").update(b).digest("hex");
const root = mkdtempSync(path.join(tmpdir(), "egovbundle-"));

// ── Maven 버전 비교 ─────────────────────────────────────
const lt = [["1.0", "1.1"], ["1.0-alpha", "1.0"], ["1.0-beta", "1.0-rc1"], ["1.0-rc1", "1.0-SNAPSHOT"], ["1.0-SNAPSHOT", "1.0"], ["1.0", "1.0-sp1"], ["2.9.8", "2.9.10"], ["5.3.37", "6.0.0"], ["6.2.11", "6.2.12"], ["1.0.0.Final", "1.0.1"], ["2.25.3", "2.25.10"], ["1.0-M1", "1.0-RC1"], ["9", "10"]];
assert(lt.every(([a, b]) => compareMavenVersions(a, b) < 0 && compareMavenVersions(b, a) > 0), `Maven 버전 순서 ${lt.length}쌍(숫자·alpha<beta<milestone<rc<snapshot<release<sp)`);
assert(["1.0=1", "1.0.0=1", "1.0-ga=1.0", "1.0.Final=1.0", "1.0-final=1.0.0", "1.0-cr1=1.0-rc1", "2.0.0.RELEASE=2.0.0"].every((p) => { const [a, b] = p.split("="); return compareMavenVersions(a, b) === 0; }), "같은 버전으로 보는 표기(0 꼬리·ga·final·release·cr=rc)");

// ── OSV 범위 ───────────────────────────────────────────
const R = [{ introduced: "0" }, { fixed: "2.15.0" }, { introduced: "2.16.0" }, { fixed: "2.17.1" }];
assert(inOsvRange("2.14.1", R) && !inOsvRange("2.15.0", R) && !inOsvRange("2.15.5", R) && inOsvRange("2.16.0", R) && !inOsvRange("2.17.1", R) && !inOsvRange("3.0", R), "ECOSYSTEM 범위: 여러 구간·fixed 배타");
assert(inOsvRange("1.2", [{ introduced: "1.0" }, { last_affected: "1.2" }]) && !inOsvRange("1.2.1", [{ introduced: "1.0" }, { last_affected: "1.2" }]) && !inOsvRange("0.9", [{ introduced: "1.0" }]) && inOsvRange("9.9", [{ introduced: "1.0" }]), "last_affected 포함·introduced 만 있으면 이후 전부");

// ── 로컬 덤프 질의 ─────────────────────────────────────
const dump = new AdmZip();
const rec = (id, affected, extra = {}) => dump.addFile(`${id}.json`, Buffer.from(JSON.stringify({ id, affected, ...extra })));
rec("GHSA-list", [{ package: { ecosystem: "Maven", name: "org.springframework:spring-webmvc" }, versions: ["6.2.11", "6.2.10"] }]);
rec("GHSA-range", [{ package: { ecosystem: "Maven", name: "org.apache.logging.log4j:log4j-core" }, ranges: [{ type: "ECOSYSTEM", events: R }] }]);
rec("GHSA-gone", [{ package: { ecosystem: "Maven", name: "org.springframework:spring-webmvc" }, versions: ["6.2.11"] }], { withdrawn: "2026-01-01T00:00:00Z" });
rec("PYSEC-x", [{ package: { ecosystem: "PyPI", name: "org.springframework:spring-webmvc" }, versions: ["6.2.11"] }]);
rec("GHSA-git", [{ package: { ecosystem: "Maven", name: "org.springframework:spring-webmvc" }, ranges: [{ type: "GIT", events: [{ introduced: "0" }] }] }]);
dump.addFile("README.txt", Buffer.from("x"));
const dumpBuf = dump.toBuffer();
const { index, records } = buildOsvIndex(dumpBuf);
assert(records === 5 && index.get("org.springframework:spring-webmvc").length === 2 && !index.has("x"), "색인: Maven 만·철회(withdrawn) 제외·GIT 범위 무시");
const q = queryOsvIndex(index, [{ package: { name: "org.springframework:spring-webmvc" }, version: "6.2.11" }, { package: { name: "org.apache.logging.log4j:log4j-core" }, version: "2.14.1" }, { package: { name: "org.apache.logging.log4j:log4j-core" }, version: "2.17.1" }, { package: { name: "none:none" }, version: "1" }]);
assert(q.results[0].vulns.map((v) => v.id).join() === "GHSA-list" && q.results[1].vulns[0].id === "GHSA-range" && !q.results[2].vulns && !q.results[3].vulns, "질의: 버전 목록·범위로 판정, querybatch 와 같은 모양");

// ── 번들 만들기(가짜 다운로드·로컬 git 원본) ───────────────
const origin = path.join(root, "origin-src");
mkdirSync(origin);
const g = (...a) => execFileSync("git", a, { cwd: origin, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
g("init", "-q"); writeFileSync(path.join(origin, "A.java"), "class A {}\n"); g("add", "."); g("commit", "-q", "-m", "a"); g("tag", "v4.3.2");
writeFileSync(path.join(origin, "A.java"), "class A { /* 5 */ }\n"); g("commit", "-qam", "b"); g("tag", "v5.0.7");
const archiveBuf = Buffer.from("PK-archive"), tplBuf = Buffer.from("PK-template");
const catalog = { repository: "eGovFramework/egovframe-common-components", tag: "v5.0.7", commit: "7912e13ca5a064a4dc81d5772582f928e985e653", archive: { sha256: sha(archiveBuf), bytes: archiveBuf.length } };
const tpls = [{ id: "web", url: "https://media.githubusercontent.com/media/x/web.zip", archive: { sha256: sha(tplBuf), bytes: tplBuf.length } }, { id: "repo-tpl", url: "https://codeload.github.com/x/y/zip/main" }];
const srcs = bundleSources(catalog, tpls, ["osv", "components", "templates"]);
assert(srcs.map((s) => s.path).join() === "osv/Maven-all.zip,archives/eGovFramework_egovframe-common-components-7912e13ca5a0.zip,templates/web.zip,templates/repo-tpl.zip" && srcs[0].url === OSV_MAVEN_DUMP_URL && srcs[1].url.endsWith("/zip/7912e13ca5a064a4dc81d5772582f928e985e653") && srcs[1].expected.sha256 === sha(archiveBuf) && !srcs[3].expected, "받을 목록: OSV·커밋 고정 아카이브(지문)·템플릿(고정 지문 있으면 검증)");
const urls = { [OSV_MAVEN_DUMP_URL]: dumpBuf, [srcs[1].url]: archiveBuf, [tpls[0].url]: tplBuf, [tpls[1].url]: Buffer.from("PK-repo") };
const fetched = [];
const download = async (u) => { fetched.push(u); if (!urls[u]) throw new Error("404 " + u); return { buffer: urls[u], lastModified: "2026-10-08T22:32:43.000Z" }; };
const now = () => Date.UTC(2026, 9, 10);
const base = { catalog, templateList: tpls, serverVersion: "0.42.0", download, originUrl: origin, now };
const out = path.join(root, "bundle");
const plan = await prepareOfflineBundle({ ...base, outputDir: out });
assert(plan.dryRun && !plan.written && !existsSync(out) && fetched.length === 0 && plan.items.length === 4 && plan.origin.tags === 0 && OUTPUT_SCHEMAS.prepare_egovframe_offline_bundle.safeParse(plan).success, "dryRun(기본): 받지 않고 목록만");
const made = await prepareOfflineBundle({ ...base, outputDir: out, dryRun: false });
const mf = JSON.parse(readFileSync(path.join(out, "bundle-manifest.json"), "utf8"));
assert(made.written && fetched.length === 4 && mf.schemaVersion === 1 && mf.files.length === 4 && mf.files.every((f) => f.sha256 === sha(readFileSync(path.join(out, f.path))) && f.bytes > 0) && mf.catalog.commit === catalog.commit && mf.serverVersion === "0.42.0", "생성: 파일별 sha256·크기·출처 URL 이 manifest 와 일치");
assert(mf.files[0].records === 5 && mf.files[0].lastModified === "2026-10-08T22:32:43.000Z" && made.items[1].verified === true && made.items[3].verified === null, "OSV 레코드 수·원본 갱신 시각, 고정 지문 검증 표시");
assert(mf.origin.tags.join() === "v4.3.2,v5.0.7" && existsSync(path.join(out, mf.origin.path, "HEAD")) && !readdirSync(root).some((x) => x.includes(".partial-")), "원본 태그 미러(내용 포함)·임시 디렉터리 정리");
assert(OUTPUT_SCHEMAS.prepare_egovframe_offline_bundle.safeParse(made).success && renderBundleMarkdown(made).includes("| components | eGovFramework/egovframe-common-components@v5.0.7 |") && renderBundleMarkdown(made).includes("EGOVFRAME_OFFLINE_BUNDLE"), "outputSchema·Markdown(사용법)");
await rejects(() => prepareOfflineBundle({ ...base, outputDir: out, dryRun: false }), /비어 있지 않습니다/, "기존 번들 디렉터리는 덮어쓰지 않음");
const bad = path.join(root, "bad");
await rejects(() => prepareOfflineBundle({ ...base, outputDir: bad, dryRun: false, include: ["components"], download: async () => ({ buffer: Buffer.from("tampered"), lastModified: null }) }), /고정 지문과 다릅니다/, "고정 지문이 다른 아카이브는 거부");
assert(!existsSync(bad) && !readdirSync(root).some((x) => x.includes(".partial-")), "실패하면 아무것도 남기지 않음");
assert(bundleTemplateList().length === 12 && bundleTemplateList().every((t) => t.archive && t.url.startsWith("https://media.githubusercontent.com/")) && bundleTemplateList(["simple-backend"])[0].url === "https://codeload.github.com/eGovFramework/egovframe-template-simple-backend/zip/main", "기본 템플릿: 고정 지문 Initializr zip 12종, 저장소 템플릿은 지정 시 codeload");

// ── 번들 읽기(폐쇄망 쪽) ─────────────────────────────────
process.env[BUNDLE_ENV] = out; resetBundleCache();
const realFetch = globalThis.fetch;
let netCalls = 0;
globalThis.fetch = async (u) => { netCalls++; throw new Error(`네트워크 차단(테스트): ${u}`); };
try {
  const res = await fetchWithTimeout(srcs[1].url, 1000);
  assert(res.ok && Buffer.from(await res.arrayBuffer()).equals(archiveBuf) && res.headers.get("x-egovframe-offline-bundle") === srcs[1].path, "fetchWithTimeout: 번들의 같은 URL 을 네트워크 없이 돌려줌");
  assert(bundleResponseFor("https://example.com/none") === null && (await fetchWithTimeout("https://example.com/none", 1000).then(() => false, () => true)) && netCalls === 1, "번들에 없는 URL 은 네트워크로(차단 환경이면 실패)");
  await rejects(() => fetchWithTimeout(srcs[1].url, 1000, { method: "POST" }), /네트워크 차단/, "GET 이 아니면 번들을 쓰지 않음");
  const osv = await defaultOsvQuery([{ package: { name: "org.springframework:spring-webmvc", ecosystem: "Maven" }, version: "6.2.11" }]);
  assert(osv.results[0].vulns[0].id === "GHSA-list" && bundleOsvQuery([{ package: { name: "a:b" }, version: "1" }]).results[0].vulns === undefined, "defaultOsvQuery: 번들 덤프로 판정(네트워크 없음)");
  assert(/오프라인 번들 스냅숏\(2026-10-08 기준, 5건\)/.test(osvProvenanceNote(now)) && !osvProvenanceNote(now).includes("⚠️") && /⚠️ 41일 지났습니다\(기준 30일\)/.test(osvProvenanceNote(() => Date.UTC(2026, 10, 19))), "OSV 출처 노트: 스냅숏 기준일·30일 넘으면 경고");
  const proj = path.join(root, "proj");
  mkdirSync(proj);
  writeFileSync(path.join(proj, "pom.xml"), `<project><dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId><version>6.2.11</version></dependency></dependencies></project>`);
  const dep = await checkDependencies({ projectDir: proj, offline: false });
  assert(dep.vulnerabilities.length === 1 && dep.vulnerabilities[0].ids.join() === "GHSA-list" && dep.notes.some((x) => x.includes("오프라인 번들 스냅숏")), "check_egovframe_dependencies(offline=false): 번들 OSV + 출처 노트");
  const gos = new GitOriginSource({ cacheDir: path.join(root, "unused-cache") });
  assert(gos.offline && gos.dir === path.join(out, mf.origin.path) && bundleOriginDir("eGovFramework/egovframe-common-components") === gos.dir && bundleOriginDir("other/repo") === null, "재조립 원본: 번들 미러를 씀(캐시 디렉터리 무시)");
  assert((await gos.listTags()).join() === "v4.3.2,v5.0.7" && /^[0-9a-f]{40}$/.test(await gos.resolveCommit("v5.0.7")) && (await gos.listBlobs("v4.3.2", ["A.java"])).size === 1 && (await gos.readBlob((await gos.listBlobs("v5.0.7", ["A.java"])).get("A.java"))).toString() === "class A { /* 5 */ }\n", "미러: 태그 목록·커밋·트리·blob 내용(원격 조회 없음)");
  await rejects(() => gos.resolveCommit("v9.9.9"), /번들의 원본 미러에 태그 v9\.9\.9 가 없습니다/, "번들에 없는 태그는 안내 오류");
  assert(!existsSync(path.join(root, "unused-cache")) && netCalls === 2, "캐시 디렉터리를 쓰지 않고, 네트워크 시도는 번들에 없는 URL·POST 2건뿐");
  const net = await diagnoseNetwork({ env: {}, nodeVersion: "v22.0.0", envProxySupported: true, probe: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); }, lookup: async () => [{ address: "1.2.3.4", family: 4 }] });
  assert(net.prescriptions.some((p) => p.id === "offline-bundle" && p.commands.some((c) => c.command.includes("bundle --output-dir"))) && net.notes.some((x) => x.includes("오프라인 번들 사용 중")), "네트워크 진단: 실패 시 오프라인 번들 처방·사용 중 표시");
  // 변조
  writeFileSync(path.join(out, srcs[1].path), "tampered!!");
  resetBundleCache();
  await rejects(() => fetchWithTimeout(srcs[1].url, 1000), /지문 불일치 — 거부/, "변조된 번들 파일은 거부");
  writeFileSync(path.join(out, "bundle-manifest.json"), "{}");
  resetBundleCache();
  let threw = ""; try { loadBundle(); } catch (e) { threw = e.message; }
  assert(/형식이 올바르지 않습니다/.test(threw), "깨진 manifest 거부");
  process.env[BUNDLE_ENV] = path.join(root, "nowhere"); resetBundleCache();
  threw = ""; try { loadBundle(); } catch (e) { threw = e.message; }
  assert(/bundle-manifest\.json 가 없습니다/.test(threw), "manifest 없는 경로 안내");
} finally {
  globalThis.fetch = realFetch;
  delete process.env[BUNDLE_ENV]; resetBundleCache();
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`offline-bundle FAIL (${n} assertions)`); else console.log(`offline-bundle OK (${n} assertions)`);
