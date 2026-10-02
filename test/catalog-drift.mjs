// node test/catalog-drift.mjs — 규칙·의존성 기준 카탈로그 drift 감시 (오프라인, 네트워크 주입)
import { checkCatalogDrift, renderCatalogDriftLines, parseTagList, tagVersion, newerTagsThan, candidateVersions, syncTemplateCatalog, loadTemplateCatalog, loadMigrationRules, loadDependencyBaseline } from "../dist/index.js";
import { createHash } from "node:crypto";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const rules = loadMigrationRules();
const baseline = loadDependencyBaseline();
const RT = rules.source.repository, CC = rules.source.components.repository;

// ── 순수 함수 ──────────────────────────────────────────
assert(tagVersion("v5.0.2-Final") === "5.0.2" && tagVersion("v3.10.0") === "3.10.0" && tagVersion("release-2024") === null && tagVersion("v5.1.0-RC1") === "5.1.0", "tagVersion: 숫자 추출, 없으면 null");
const api = JSON.stringify([{ name: "v5.1.0-Final", commit: { sha: "a" } }, { name: "v5.0.2-Final" }, { name: "latest" }, { bogus: 1 }]);
assert(JSON.stringify(parseTagList(api, RT)) === JSON.stringify({ tags: ["v5.1.0-Final", "v5.0.2-Final", "latest"], source: "api" }), "parseTagList: GitHub API JSON(name 없는 항목 제외)");
const html = `<a href="/${RT}/releases/tag/v5.0.2-Final">v5.0.2-Final</a> <a href="/${RT}/releases/tag/v5.0.1-Final">x</a> <a href="/${RT}/releases/tag/v5.0.2-Final">dup</a> <a href="/other/repo/releases/tag/v9.9.9">no</a>`;
assert(JSON.stringify(parseTagList(html, RT)) === JSON.stringify({ tags: ["v5.0.2-Final", "v5.0.1-Final"], source: "html" }), "parseTagList: 태그 페이지 HTML(중복 제거, 다른 저장소 제외)");
assert(parseTagList("[]", RT) === null && parseTagList("<html>no tags</html>", RT) === null && parseTagList(JSON.stringify([{ id: 1 }]), RT) === null, "parseTagList: 태그 없음 → null");
assert(JSON.stringify(newerTagsThan(["v5.0.1-Final", "v5.1.0-Final", "v5.0.2-Final", "v5.0.3-Final", "latest", "v4.3.0-Final"], "v5.0.2-Final")) === JSON.stringify(["v5.1.0-Final", "v5.0.3-Final"]), "newerTagsThan: 고정보다 새 태그만 내림차순(숫자 없는 태그 무시)");
assert(newerTagsThan(["v5.0.2-Final"], "v5.0.2-Final").length === 0 && newerTagsThan(["v9"], "latest").length === 0, "newerTagsThan: 같은 버전·숫자 없는 고정 태그");
assert(JSON.stringify(candidateVersions("5.0.2")) === JSON.stringify(["5.0.3", "5.0.4", "5.0.5", "5.1.0", "6.0.0"]) && candidateVersions("5.0") .length === 0, "candidateVersions: patch 3개·minor·major");

// ── checkCatalogDrift (주입) ───────────────────────────
const webSrc = baseline.sources.find((s) => s.kind === "web"), bootSrc = baseline.sources.find((s) => s.kind === "boot");
const pomUrl = (src, v) => `${baseline.repository}${src.groupId.replace(/\./g, "/")}/${src.artifactId}/${v}/${src.artifactId}-${v}.pom`;
// 고정 pom 본문: sha256 이 기준과 같은 텍스트를 만들 수 없으므로 "같은 sha" 는 fetchText 가 기준 sha 를 가진 가짜 본문을 돌려주도록 매핑한다
const pomBody = new Map(); // url → text
const sameShaText = (pinnedSha) => `<!-- ${pinnedSha} -->`;
function makeFetch({ tagsApi = {}, tagsHtml = {}, poms = {}, existing = new Set() }) {
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    for (const [repo, v] of Object.entries(tagsApi)) if (url === `https://api.github.com/repos/${repo}/tags?per_page=100`) { if (v instanceof Error) throw v; return v; }
    for (const [repo, v] of Object.entries(tagsHtml)) if (url === `https://github.com/${repo}/tags`) { if (v instanceof Error) throw v; return v; }
    if (url in poms) { if (poms[url] instanceof Error) throw poms[url]; return poms[url]; }
    throw new Error(`unexpected GET ${url}`);
  };
  const fetchStatus = async (url) => { calls.push(`HEAD ${url}`); return existing.has(url) ? 200 : 404; };
  return { fetchText, fetchStatus, calls };
}
const apiTags = (names) => JSON.stringify(names.map((name) => ({ name })));
// sha 가 같다고 보이게: checkCatalogDrift 는 본문 sha256 과 기준 sha256 을 비교하므로, 기준 sha256 을 가진 본문을 만들 수 없다 → 기준을 복제해 sha 를 가짜 본문의 sha 로 바꾼다
const fakeBaseline = structuredClone(baseline);
for (const s of fakeBaseline.sources) { const text = sameShaText(s.sha256); s.sha256 = sha256(text); pomBody.set(s.url, text); }
{ const text = "<!-- boot bom -->"; fakeBaseline.boot.bom.sha256 = sha256(text); pomBody.set(fakeBaseline.boot.bom.url, text); }
const pomsSame = Object.fromEntries(pomBody);

// 1) 최신 상태
{
  const f = makeFetch({ tagsApi: { [RT]: apiTags([rules.source.toTag, "v4.3.0-Final"]), [CC]: apiTags([rules.source.components.toTag, "v3.10.0"]) }, poms: pomsSame });
  const r = await checkCatalogDrift({ fetchText: f.fetchText, fetchStatus: f.fetchStatus, rules, baseline: fakeBaseline, githubToken: null });
  assert(r.upToDate === true && r.errors === 0 && r.warnings.length === 0 && r.procedure.length === 0, "최신: drift 없음·오류 없음");
  assert(r.migrationRules.runtime.source === "api" && r.migrationRules.runtime.seen === 2 && r.migrationRules.components.source === "api", "태그 출처 api");
  assert(r.dependencyBaseline.parents.length === 2 && r.dependencyBaseline.parents.every((p) => p.sha256Changed === false && p.newerVersions.length === 0 && p.probed.length === 5) && r.dependencyBaseline.bootBom.sha256Changed === false, "parent 2종 sha 동일·새 버전 없음, Boot BOM sha 동일");
  assert(f.calls.filter((c) => c.startsWith("HEAD ")).length === 10 && !f.calls.some((c) => c.includes("github.com/" + RT + "/tags")), "HEAD 탐침 10회(parent 2 × 후보 5), API 성공이면 HTML 미조회");
  const lines = renderCatalogDriftLines(r);
  assert(lines.some((l) => l.includes("카탈로그 drift: 없음")) && lines.some((l) => l.includes(`고정 ${rules.source.toTag}`)) && !lines.some((l) => l.includes("갱신 절차")), "렌더링: drift 없음");
}
// 2) 새 태그(API 실패 → HTML 대체) + 새 parent 버전 + Boot BOM sha 변경
{
  const htmlRt = `<a href="/${RT}/releases/tag/v5.1.0-Final">a</a><a href="/${RT}/releases/tag/${rules.source.toTag}">b</a>`;
  const existing = new Set([pomUrl(webSrc, candidateVersions(webSrc.version)[0]), pomUrl(bootSrc, candidateVersions(bootSrc.version)[3])]);
  const poms = { ...pomsSame, [fakeBaseline.boot.bom.url]: "<!-- republished -->" };
  const f = makeFetch({ tagsApi: { [RT]: new Error("403 rate limited"), [CC]: apiTags([rules.source.components.toTag]) }, tagsHtml: { [RT]: htmlRt }, poms, existing });
  const r = await checkCatalogDrift({ fetchText: f.fetchText, fetchStatus: f.fetchStatus, rules, baseline: fakeBaseline, githubToken: null });
  assert(r.upToDate === false && r.errors === 0, "drift 있음·오류 없음(API 실패는 HTML 로 대체)");
  assert(r.migrationRules.runtime.source === "html" && JSON.stringify(r.migrationRules.runtime.newerTags) === JSON.stringify(["v5.1.0-Final"]) && r.migrationRules.components.newerTags.length === 0, "runtime 새 태그 v5.1.0-Final(html), components 없음");
  const web = r.dependencyBaseline.parents.find((p) => p.kind === "web"), boot = r.dependencyBaseline.parents.find((p) => p.kind === "boot");
  assert(JSON.stringify(web.newerVersions) === JSON.stringify([candidateVersions(webSrc.version)[0]]) && JSON.stringify(boot.newerVersions) === JSON.stringify([candidateVersions(bootSrc.version)[3]]), `parent 새 버전: web ${web.newerVersions}, boot ${boot.newerVersions}`);
  assert(r.dependencyBaseline.bootBom.sha256Changed === true, "Boot BOM pom sha256 변경 감지");
  assert(r.warnings.length === 4 && r.warnings.some((w) => /v5.1.0-Final/.test(w)) && r.warnings.some((w) => /spring-boot-dependencies/.test(w)), `경고 4건 (${r.warnings.length})`);
  assert(r.procedure.length === 3 && /runtime.toTag 를 v5.1.0-Final/.test(r.procedure[0]) && new RegExp(`--web ${candidateVersions(webSrc.version)[0]} --boot ${candidateVersions(bootSrc.version)[3]}`).test(r.procedure[1]) && /변경 이력/.test(r.procedure[2]), `갱신 절차 3단계 (${r.procedure.length})`);
  const lines = renderCatalogDriftLines(r);
  assert(lines.some((l) => l.includes("카탈로그 drift: 있음")) && lines.some((l) => l.startsWith("- 갱신 절차:")) && lines.some((l) => /pom sha256 변경됨/.test(l)), "렌더링: 경고·절차·sha 변경");
}
// 3) 조회 실패는 항목별 error 로, 예외 없이
{
  const f = makeFetch({ tagsApi: { [RT]: new Error("api down"), [CC]: new Error("api down") }, tagsHtml: { [RT]: new Error("html down"), [CC]: "<html>none</html>" }, poms: {} });
  const r = await checkCatalogDrift({ fetchText: f.fetchText, fetchStatus: async () => { throw new Error("no network"); }, rules, baseline: fakeBaseline, githubToken: null });
  assert(r.upToDate === true && r.errors === 5 && r.warnings.length === 0, `실패는 drift 가 아님: 오류 ${r.errors}건(태그 2·parent 2·BOM 1)`);
  assert(/api down/.test(r.migrationRules.runtime.error) && /html down/.test(r.migrationRules.runtime.error) && /해석하지 못함/.test(r.migrationRules.components.error), "태그 오류 메시지에 두 출처 사유");
  assert(r.dependencyBaseline.parents.every((p) => p.sha256Changed === null && p.newerVersions.length === 0 && /no network/.test(p.error)) && r.dependencyBaseline.bootBom.sha256Changed === null, "parent·BOM 조회 실패 → null + error");
  const lines = renderCatalogDriftLines(r);
  assert(lines.some((l) => /확인 실패 \(.*api down/.test(l)) && lines.some((l) => /확인 실패 5건/.test(l)), "렌더링: 확인 실패 표시");
}
// 4) 토큰 없는 주입 fetch 에는 Authorization 을 넘기지 않는다(주입 함수는 헤더를 받지 않음) — 토큰이 있어도 주입 경로는 그대로
{
  const f = makeFetch({ tagsApi: { [RT]: apiTags([rules.source.toTag]), [CC]: apiTags([rules.source.components.toTag]) }, poms: pomsSame });
  const r = await checkCatalogDrift({ fetchText: f.fetchText, fetchStatus: f.fetchStatus, rules, baseline: fakeBaseline, githubToken: "ghp_test" });
  assert(r.errors === 0 && r.migrationRules.runtime.source === "api", "토큰이 있어도 주입 fetch 경로 동작");
}
// 5) syncTemplateCatalog 통합: catalogs 절이 붙고, catalogDrift=false 면 null
{
  const catalog = loadTemplateCatalog();
  const f = makeFetch({ tagsApi: { [RT]: apiTags([rules.source.toTag]), [CC]: apiTags([rules.source.components.toTag]) }, poms: pomsSame });
  const fetchText = async (url, ms) => { try { return await f.fetchText(url, ms); } catch { return "[]"; } }; // 템플릿·zip·hbs 요청은 빈 배열(실패 경로)
  let r;
  try { r = await syncTemplateCatalog({}, { catalog, fetchText, fetchStatus: f.fetchStatus }); } catch (e) { r = null; console.error(e.message); }
  assert(r && r.catalogs && typeof r.catalogs.upToDate === "boolean" && r.catalogs.migrationRules.runtime.source === "api", "syncTemplateCatalog 결과에 catalogs 절");
  const off = await syncTemplateCatalog({}, { catalog, fetchText, catalogDrift: false });
  assert(off.catalogs === null, "catalogDrift=false → null");
}

if (process.exitCode) console.error(`catalog-drift FAIL (${n} assertions)`); else console.log(`catalog-drift OK (${n} assertions)`);
