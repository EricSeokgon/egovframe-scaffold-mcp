// node test/upgrade.mjs — 오프라인: 3-way 판정 + transaction 적용·rollback·경로 경계
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { classifyUpgrade, upgradeProject } from "../dist/index.js";

const H = "sha256:a", H2 = "sha256:b", H3 = "sha256:c";
assert.equal(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: H, upstreamHash: H }), "unchanged");
assert.equal(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: H, upstreamHash: H2 }), "update");
assert.equal(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: H2, upstreamHash: H }), "user-modified");
assert.equal(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: H2, upstreamHash: H3 }), "conflict");
assert.equal(classifyUpgrade({ currentHash: H, upstreamHash: H }), "unchanged");
assert.equal(classifyUpgrade({ currentHash: H, upstreamHash: H2 }), "conflict");
assert.equal(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: undefined, upstreamHash: H }), "added");
assert.equal(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: H, upstreamHash: undefined }), "removed");

const hash = (data) => "sha256:" + createHash("sha256").update(data).digest("hex");
const relPath = "src/main/java/egovframework/com/cmm/UpgradeFixture.java";
const addedRelPath = "src/main/java/egovframework/com/cmm/upgrade/AddedFixture.java";
const oldData = Buffer.from("old component\n");
const newData = Buffer.from("new component\n");
const addedData = Buffer.from("added component\n");

function archiveWith(data) {
  const zip = new AdmZip();
  zip.addFile(`fixture-main/${relPath}`, data);
  zip.addFile(`fixture-main/${addedRelPath}`, addedData);
  return zip.toBuffer();
}

function createProject(prefix) {
  const projectDir = mkdtempSync(path.join(tmpdir(), prefix));
  const target = path.join(projectDir, relPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, oldData);
  const manifest = {
    schemaVersion: 2,
    source: { repository: "fixture/repo", repo: "fixture/repo", branch: "main" },
    components: {
      cmm: {
        installedAt: "2026-07-26T00:00:00.000Z",
        files: [relPath],
        hashes: { [relPath]: { hash: hash(oldData), srcHash: hash(oldData) } },
        sqlScripts: [],
      },
    },
  };
  writeFileSync(path.join(projectDir, ".egovframe-components.json"), JSON.stringify(manifest, null, 2) + "\n");
  return projectDir;
}

function transactionArtifacts(projectDir) {
  return readdirSync(projectDir).filter((name) => name.startsWith(".egovframe-write-txn-"));
}

const missingManifestDir = mkdtempSync(path.join(tmpdir(), "eu-missing-"));
await assert.rejects(
  upgradeProject({ projectDir: missingManifestDir, archiveData: archiveWith(newData) }),
  /매니페스트/,
);
rmSync(missingManifestDir, { recursive: true, force: true });

const successDir = createProject("eu-success-");
const result = await upgradeProject({ projectDir: successDir, dryRun: false, archiveData: archiveWith(newData) });
assert.deepEqual(result.applied, { updated: 1, added: 1, forced: 0 });
assert.equal(readFileSync(path.join(successDir, relPath), "utf8"), newData.toString());
assert.equal(readFileSync(path.join(successDir, addedRelPath), "utf8"), addedData.toString());
assert.ok(result.backupDir);
assert.equal(readFileSync(path.join(result.backupDir, relPath), "utf8"), oldData.toString());
assert.ok(existsSync(path.join(result.backupDir, "upgrade-plan.json")));
const updatedManifest = JSON.parse(readFileSync(path.join(successDir, ".egovframe-components.json"), "utf8"));
assert.equal(updatedManifest.schemaVersion, 3);
assert.equal(updatedManifest.components.cmm.hashes[relPath].hash, hash(newData));
assert.equal(updatedManifest.components.cmm.hashes[addedRelPath].hash, hash(addedData));
assert.ok(updatedManifest.components.cmm.files.includes(addedRelPath));
assert.deepEqual(transactionArtifacts(successDir), []);
rmSync(successDir, { recursive: true, force: true });

for (const faultInjection of ["after-files", "after-manifest"]) {
  const projectDir = createProject(`eu-${faultInjection}-`);
  const manifestPath = path.join(projectDir, ".egovframe-components.json");
  const manifestBefore = readFileSync(manifestPath);
  await assert.rejects(
    upgradeProject({ projectDir, dryRun: false, archiveData: archiveWith(newData), faultInjection }),
    new RegExp(`upgrade fault injection: ${faultInjection}[\\s\\S]*작업 전 상태로 롤백했습니다`),
  );
  assert.equal(readFileSync(path.join(projectDir, relPath), "utf8"), oldData.toString());
  assert.equal(existsSync(path.join(projectDir, addedRelPath)), false);
  assert.equal(existsSync(path.dirname(path.join(projectDir, addedRelPath))), false);
  assert.deepEqual(readFileSync(manifestPath), manifestBefore);
  assert.equal(existsSync(path.join(projectDir, "upgrade-backup")), false);
  assert.deepEqual(transactionArtifacts(projectDir), []);
  rmSync(projectDir, { recursive: true, force: true });
}

const outsideDir = mkdtempSync(path.join(tmpdir(), "eu-outside-"));
const symlinkDir = mkdtempSync(path.join(tmpdir(), "eu-symlink-"));
const outsideTarget = path.join(outsideDir, "main/java/egovframework/com/cmm/UpgradeFixture.java");
mkdirSync(path.dirname(outsideTarget), { recursive: true });
writeFileSync(outsideTarget, oldData);
const srcLink = path.join(symlinkDir, "src");
symlinkSync(outsideDir, srcLink, process.platform === "win32" ? "junction" : "dir");
const symlinkManifest = {
  schemaVersion: 2,
  source: { repository: "fixture/repo", repo: "fixture/repo", branch: "main" },
  components: {
    cmm: {
      installedAt: "2026-07-26T00:00:00.000Z",
      files: [relPath],
      hashes: { [relPath]: { hash: hash(oldData), srcHash: hash(oldData) } },
      sqlScripts: [],
    },
  },
};
const symlinkManifestPath = path.join(symlinkDir, ".egovframe-components.json");
writeFileSync(symlinkManifestPath, JSON.stringify(symlinkManifest, null, 2) + "\n");
const symlinkManifestBefore = readFileSync(symlinkManifestPath);
await assert.rejects(
  upgradeProject({ projectDir: symlinkDir, dryRun: false, archiveData: archiveWith(newData) }),
  /symlink를 통해 프로젝트 밖/,
);
assert.equal(readFileSync(outsideTarget, "utf8"), oldData.toString());
assert.deepEqual(readFileSync(symlinkManifestPath), symlinkManifestBefore);
assert.deepEqual(transactionArtifacts(symlinkDir), []);
unlinkSync(srcLink);
rmSync(symlinkDir, { recursive: true, force: true });
rmSync(outsideDir, { recursive: true, force: true });

console.log("upgrade OK");
