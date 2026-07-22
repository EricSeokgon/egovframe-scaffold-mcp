import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectCatalogArchive, loadCatalog } from "../dist/index.js";

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
assert.equal(catalog.source.tag, "v5.0.6");
assert.equal(catalog.source.commit, "23d01889e01fcfa486d28d7a2ec4adb51fbaf3ad");
assert.match(catalog.source.archive.sha256, /^[0-9a-f]{64}$/);
assert.ok(catalog.source.archive.bytes > 40_000_000);
console.log("catalog-sync OK");
