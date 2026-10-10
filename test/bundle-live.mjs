// node test/bundle-live.mjs — 폐쇄망 오프라인 번들(v0.42) 실자산 검증(CI 통합, 네트워크·git 필요):
// (1) 인터넷 쪽: 실제 번들(OSV Maven 덤프·고정 공통컴포넌트 아카이브·web 템플릿·원본 태그 미러)을 만든다
// (2) 같은 날 받은 덤프의 로컬 OSV 판정이 온라인 querybatch 와 같은지(공식 web 템플릿 SBOM 67 component + 옛 버전 표본)
// (3) 폐쇄망 쪽: fetch 를 막고(git 은 file 프로토콜만) 생성·조립·재조립 미리보기·SBOM 재점검이 번들만으로 되는지
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egovbundle-live-"));
const realFetch = globalThis.fetch;
try {
  // (1) 번들 만들기
  const out = path.join(root, "bundle");
  const t0 = Date.now();
  const made = await m.prepareEgovframeOfflineBundle({ outputDir: out, templates: ["web"], dryRun: false });
  const mf = JSON.parse(readFileSync(path.join(out, "bundle-manifest.json"), "utf8"));
  assert(made.written && mf.files.length === 3 && made.items.find((i) => i.kind === "components").verified === true && made.items.find((i) => i.id === "web").verified === true, `번들: OSV·아카이브(고정 지문 일치)·web 템플릿(고정 지문 일치), ${(made.totalBytes / 1048576).toFixed(1)}MB, ${Math.round((Date.now() - t0) / 1000)}초`);
  const osvFile = mf.files.find((f) => f.kind === "osv");
  assert(osvFile.records > 5000 && osvFile.bytes > 5_000_000, `OSV Maven 덤프 레코드 ${osvFile.records}건, ${(osvFile.bytes / 1048576).toFixed(1)}MB, 원본 갱신 ${osvFile.lastModified}`);
  assert(mf.origin && mf.origin.tags.includes("v5.0.7") && mf.origin.tags.includes("v4.3.2") && mf.origin.tags.includes("v3.10.0"), `원본 태그 미러 ${mf.origin?.tags.length}개(내용 포함, ${((mf.origin?.bytes ?? 0) / 1048576).toFixed(1)}MB)`);

  // (2) 로컬 OSV = 온라인 OSV
  const bom = JSON.parse(readFileSync(path.join(here, "fixtures/sbom-egov-web-plugin.cdx.json"), "utf8"));
  const extra = [["org.apache.logging.log4j:log4j-core", "2.14.1"], ["log4j:log4j", "1.2.17"], ["org.springframework:spring-webmvc", "5.3.37"], ["com.fasterxml.jackson.core:jackson-databind", "2.9.8"], ["commons-fileupload:commons-fileupload", "1.3.3"], ["mysql:mysql-connector-java", "5.1.38"]];
  const qs = [...bom.components.map((c) => ({ package: { name: `${c.group}:${c.name}`, ecosystem: "Maven" }, version: c.version })), ...extra.map(([name, version]) => ({ package: { name, ecosystem: "Maven" }, version }))];
  const { index } = m.buildOsvIndex(readFileSync(path.join(out, osvFile.path)));
  const local = m.queryOsvIndex(index, qs);
  const online = await (await realFetch("https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queries: qs }) })).json();
  const diffs = qs.map((q, i) => [`${q.package.name}@${q.version}`, (local.results[i].vulns ?? []).map((v) => v.id).sort().join(), (online.results[i].vulns ?? []).map((v) => v.id).sort().join()]).filter(([, a, b]) => a !== b);
  for (const d of diffs) console.log("diff:", JSON.stringify(d));
  const ids = (r) => r.results.reduce((s, x) => s + (x.vulns?.length ?? 0), 0);
  // 덤프(하루 1회 갱신)와 온라인 사이 몇 시간 차이로 막 공개된 권고가 갈릴 수 있어 질의의 97% 이상 일치를 요구하고 차이는 로그로 남긴다
  assert((qs.length - diffs.length) / qs.length >= 0.97 && ids(local) > 50, `로컬 OSV = 온라인 querybatch: 질의 ${qs.length - diffs.length}/${qs.length} 일치, ID ${ids(local)} / ${ids(online)}`);

  // (3) 폐쇄망 흉내: fetch 차단, git 은 file 프로토콜만
  process.env.EGOVFRAME_OFFLINE_BUNDLE = out; m.resetBundleCache();
  process.env.GIT_ALLOW_PROTOCOL = "file";
  let netCalls = 0;
  globalThis.fetch = async (u) => { netCalls++; throw new Error(`네트워크 차단(테스트): ${u}`); };
  const work = path.join(root, "work");
  mkdirSync(work);
  const c = await m.createProject({ template: "web", projectName: "offweb", groupId: "egovframework.example", outputDir: work, database: "mysql" });
  assert(existsSync(path.join(work, "offweb", "pom.xml")) && JSON.stringify(c).includes("지문 검증 통과"), "폐쇄망: web 템플릿 프로젝트 생성(번들 zip, 지문 검증)");
  const a = await m.addComponents({ projectDir: path.join(work, "offweb"), components: ["bbs"] });
  assert(a.totalFiles > 50 && existsSync(path.join(work, "offweb", "src/main/java/egovframework/com/cop/bbs")), `폐쇄망: 공통컴포넌트 bbs 조립(번들 아카이브) ${a.totalFiles}파일`);
  const corpus = path.resolve(here, "..", ".corpus-cache", "cc-4.3.2");
  if (existsSync(path.join(corpus, "pom.xml"))) {
    const r = await m.reassembleComponents({ projectDir: corpus, components: ["bbs", "cmm"] });
    assert(r.origin.tag === "v4.3.2" && r.actions.replace > 0, `폐쇄망: 재조립 미리보기 원본 ${r.origin.tag}(번들 미러), 교체 ${r.actions.replace}`);
  } else console.log("skip: 코퍼스 트리(.corpus-cache/cc-4.3.2) 없음 — 재조립 미리보기 건너뜀");
  const sb = path.join(work, "sb");
  mkdirSync(path.join(sb, "sbom"), { recursive: true });
  writeFileSync(path.join(sb, "pom.xml"), "<project/>");
  writeFileSync(path.join(sb, "sbom/bom.cdx.json"), readFileSync(path.join(here, "fixtures/sbom-egov-web-plugin.cdx.json")));
  const s = await m.checkSbom({ projectDir: sb, offline: false });
  assert(s.recheck.osv.queried && s.recheck.osv.ids > 10 && s.notes.some((x) => x.includes("오프라인 번들 스냅숏")), `폐쇄망: SBOM 재점검 OSV ${s.recheck.osv.ids}건(번들 덤프, 기준일 표시)`);
  assert(netCalls === 0, `폐쇄망 단계의 네트워크 시도 ${netCalls}건`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  delete process.env.EGOVFRAME_OFFLINE_BUNDLE; delete process.env.GIT_ALLOW_PROTOCOL;
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`bundle-live FAIL (${n} assertions)`); else console.log(`bundle-live OK (${n} assertions)`);
