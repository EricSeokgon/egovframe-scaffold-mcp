import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectCatalogArchive, loadCatalog, syncCatalog } from "../dist/index.js";

const zip = new AdmZip();
zip.addFile("fixture/src/main/java/egovframework/com/sec/security/filter/TestFilter.java", Buffer.from("class TestFilter {}"));
zip.addFile("fixture/src/main/java/egovframework/com/cop/newpkg/Test.java", Buffer.from("class Test {}"));
const buffer = zip.toBuffer();
const fixtureCatalog = {
  source: {},
  components: [{ pathPrefixes: ["src/main/java/egovframework/com/sec/security/"], messageBundles: [], idgnContexts: [], schedulingContexts: [], webAssets: [], webFragments: [] }],
};
const inspected = inspectCatalogArchive(buffer, fixtureCatalog);
assert.equal(inspected.sha256, createHash("sha256").update(buffer).digest("hex"));
assert.equal(inspected.files, 2);
assert.equal(inspected.rootPrefix, "fixture/");
assert.equal(inspected.securityPaths.length, 1);
assert.equal(inspected.unmappedComponentPaths.length, 1);
assert.match(inspected.unmappedComponentPaths[0], /cop\/newpkg/);

const catalog = loadCatalog();
assert.equal(catalog.source.tag, "v5.0.7");
assert.equal(catalog.source.commit, "36abd0d5bcb22e58b366f8d5f1e8ccdccfe7d6da");
assert.match(catalog.source.archive.sha256, /^[0-9a-f]{64}$/);
assert.ok(catalog.source.archive.bytes > 40_000_000);

// v1.26: upstream 이 고정 태그를 옮긴 경우 — 실패하지 않고 고정 커밋의 아카이브로 무결성을 검증한다
{
  const MOVED = "0123456789abcdef0123456789abcdef01234567";
  const realFetch = globalThis.fetch;
  const seen = [];
  const tiny = new AdmZip(); tiny.addFile("fixture/README.md", Buffer.from("x"));
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (String(url).startsWith("https://api.github.com/")) return new Response(JSON.stringify({ sha: MOVED }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(tiny.toBuffer(), { status: 200 });
  };
  let message = "";
  try { await syncCatalog(); } catch (e) { message = e.message; } finally { globalThis.fetch = realFetch; }
  assert.ok(seen.some((u) => u.endsWith(`/zip/${catalog.source.commit}`)) && !seen.some((u) => u.includes(MOVED)), "태그가 옮겨져도 내려받아 검증하는 것은 카탈로그 고정 커밋의 아카이브");
  assert.match(message, /고정 아카이브 무결성 불일치/, "고정 커밋 아카이브의 sha256·크기 검증은 그대로(가짜 아카이브는 거부)");
  assert.doesNotMatch(message, /공식 태그와 고정 commit이 일치하지 않습니다/, "태그 이동 자체는 오류가 아님");
}
console.log("catalog-sync OK");
