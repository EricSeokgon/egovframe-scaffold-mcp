// removeComponents 안전 제거 회귀 — 네트워크 불필요
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MANIFEST_FILE, removeComponents } from "../dist/index.js";

const hash = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
const source = { repo: "eGovFramework/egovframe-common-components", branch: "main" };
const writeFixture = (projectDir, component) => {
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, MANIFEST_FILE),
    JSON.stringify({
      schemaVersion: 3,
      source,
      components: { bbs: { installedAt: "2026-07-24T00:00:00.000Z", ...component } },
    }, null, 2) + "\n",
  );
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "safe-remove-"));

// 1) dryRun 분류 + 기본 거부 + force 백업
const project = path.join(tmp, "project");
const contents = {
  "src/safe.txt": "safe\n",
  "src/modified.txt": "user edit\n",
  "src/legacy.txt": "legacy without baseline\n",
  "scripts/bbs.sql": "create table bbs;\n",
};
for (const [relPath, content] of Object.entries(contents)) {
  const target = path.join(project, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
writeFixture(project, {
  files: ["src/safe.txt", "src/modified.txt", "src/legacy.txt", "src/missing.txt"],
  sqlScripts: ["scripts/bbs.sql"],
  hashes: {
    "src/safe.txt": { hash: hash(contents["src/safe.txt"]), srcHash: hash(contents["src/safe.txt"]) },
    "src/modified.txt": { hash: hash("original\n"), srcHash: hash("original\n") },
    "scripts/bbs.sql": { hash: hash(contents["scripts/bbs.sql"]), srcHash: hash(contents["scripts/bbs.sql"]) },
  },
});

const preview = await removeComponents({ projectDir: project, components: ["bbs"], dryRun: true });
assert.equal(preview.blocked, true, "수정·미검증 파일이 있으면 기본 제거가 차단되어야 한다");
assert.deepEqual(
  preview.summary,
  { unchanged: 2, modified: 1, unverified: 1, missing: 1 },
  "파일 상태를 설치 hash 기준으로 분류해야 한다",
);
assert.equal(preview.totalFiles, 4, "실제 존재하는 파일만 삭제 가능 수에 포함해야 한다");
assert.ok(fs.existsSync(path.join(project, "src/safe.txt")), "dryRun은 파일을 삭제하면 안 된다");

const manifestBeforeReject = fs.readFileSync(path.join(project, MANIFEST_FILE), "utf-8");
await assert.rejects(
  () => removeComponents({ projectDir: project, components: ["bbs"] }),
  /사용자 수정 또는 기준선 hash가 없는 파일 2건/,
  "force 없는 실제 제거는 수정·미검증 파일 때문에 실패해야 한다",
);
assert.equal(fs.readFileSync(path.join(project, MANIFEST_FILE), "utf-8"), manifestBeforeReject, "거부 시 매니페스트가 불변이어야 한다");
assert.equal(fs.readFileSync(path.join(project, "src/modified.txt"), "utf-8"), "user edit\n", "거부 시 사용자 파일을 보존해야 한다");

// 2) staging 이후 fault injection → 파일·매니페스트 전체 롤백
const rollbackProject = path.join(tmp, "rollback");
const rollbackContent = "transaction-safe\n";
fs.mkdirSync(path.join(rollbackProject, "src"), { recursive: true });
fs.writeFileSync(path.join(rollbackProject, "src/file.txt"), rollbackContent);
writeFixture(rollbackProject, {
  files: ["src/file.txt"],
  sqlScripts: [],
  hashes: { "src/file.txt": { hash: hash(rollbackContent), srcHash: hash(rollbackContent) } },
});
const rollbackManifest = fs.readFileSync(path.join(rollbackProject, MANIFEST_FILE), "utf-8");
await assert.rejects(
  () => removeComponents({
    projectDir: rollbackProject,
    components: ["bbs"],
    faultInjection: "after-stage",
  }),
  /작업 전 상태로 롤백했습니다/,
  "staging 이후 실패는 전체 롤백되어야 한다",
);
assert.equal(fs.readFileSync(path.join(rollbackProject, "src/file.txt"), "utf-8"), rollbackContent, "롤백이 파일을 복원해야 한다");
assert.equal(fs.readFileSync(path.join(rollbackProject, MANIFEST_FILE), "utf-8"), rollbackManifest, "롤백이 매니페스트를 보존해야 한다");
assert.equal(
  fs.readdirSync(rollbackProject).filter((name) => name.startsWith(".egovframe-remove-txn-")).length,
  0,
  "롤백 후 staging 디렉터리가 남으면 안 된다",
);

// 3) 매니페스트 경로 이탈은 dryRun에서도 거부
const traversalProject = path.join(tmp, "traversal-project");
const outside = path.join(tmp, "outside.txt");
fs.writeFileSync(outside, "outside\n");
writeFixture(traversalProject, {
  files: ["../outside.txt"],
  sqlScripts: [],
  hashes: { "../outside.txt": { hash: hash("outside\n"), srcHash: hash("outside\n") } },
});
await assert.rejects(
  () => removeComponents({ projectDir: traversalProject, components: ["bbs"], dryRun: true }),
  /프로젝트 밖 경로/,
  "매니페스트 경로로 프로젝트 밖 파일을 제거할 수 없어야 한다",
);
assert.equal(fs.readFileSync(outside, "utf-8"), "outside\n", "프로젝트 밖 파일은 불변이어야 한다");

// 4) 절대경로와 symlink 상위 경로를 통한 프로젝트 이탈도 거부
const absoluteProject = path.join(tmp, "absolute-project");
const absoluteTarget = path.join(absoluteProject, "inside.txt");
fs.mkdirSync(absoluteProject, { recursive: true });
fs.writeFileSync(absoluteTarget, "inside\n");
writeFixture(absoluteProject, {
  files: [absoluteTarget],
  sqlScripts: [],
  hashes: { [absoluteTarget]: { hash: hash("inside\n"), srcHash: hash("inside\n") } },
});
await assert.rejects(
  () => removeComponents({ projectDir: absoluteProject, components: ["bbs"], dryRun: true }),
  /절대경로/,
  "프로젝트 내부를 가리켜도 매니페스트 절대경로는 거부해야 한다",
);

const symlinkProject = path.join(tmp, "symlink-project");
const symlinkOutside = path.join(tmp, "symlink-outside");
fs.mkdirSync(symlinkProject, { recursive: true });
fs.mkdirSync(symlinkOutside, { recursive: true });
fs.writeFileSync(path.join(symlinkOutside, "outside.txt"), "outside through link\n");
fs.symlinkSync(symlinkOutside, path.join(symlinkProject, "linked"), process.platform === "win32" ? "junction" : "dir");
writeFixture(symlinkProject, {
  files: ["linked/outside.txt"],
  sqlScripts: [],
  hashes: { "linked/outside.txt": { hash: hash("outside through link\n"), srcHash: hash("outside through link\n") } },
});
await assert.rejects(
  () => removeComponents({ projectDir: symlinkProject, components: ["bbs"], dryRun: true }),
  /symlink를 통해 프로젝트 밖/,
  "상위 symlink를 통해 프로젝트 밖 파일에 도달할 수 없어야 한다",
);
assert.equal(
  fs.readFileSync(path.join(symlinkOutside, "outside.txt"), "utf-8"),
  "outside through link\n",
  "symlink 밖 파일은 불변이어야 한다",
);

// 5) force는 기존 파일 전부를 보존한 뒤 제거
const forced = await removeComponents({ projectDir: project, components: ["bbs"], force: true });
assert.equal(forced.blocked, false, "force 제거는 백업 후 진행되어야 한다");
assert.ok(forced.backupDir && fs.existsSync(forced.backupDir), "force 제거 백업 디렉터리를 반환해야 한다");
for (const relPath of Object.keys(contents)) {
  assert.ok(!fs.existsSync(path.join(project, relPath)), `원본 파일을 제거해야 한다: ${relPath}`);
  assert.equal(
    fs.readFileSync(path.join(forced.backupDir, relPath), "utf-8"),
    contents[relPath],
    `force 백업이 원본 바이트를 보존해야 한다: ${relPath}`,
  );
}
assert.ok(fs.existsSync(path.join(forced.backupDir, "remove-plan.json")), "force 백업에 제거 계획을 기록해야 한다");
assert.ok(!fs.existsSync(path.join(project, MANIFEST_FILE)), "마지막 컴포넌트 제거 후 매니페스트를 삭제해야 한다");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("remove OK");
