// node test/transaction.mjs — 공통 파일 transaction 오프라인 회귀
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectFileTransaction, withDirectoryTransaction, withFileTransaction } from "../dist/index.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "file-transaction-"));
const project = path.join(tmp, "project");
fs.mkdirSync(path.join(project, "config"), { recursive: true });
fs.mkdirSync(path.join(project, "preserved-empty"), { recursive: true });
fs.writeFileSync(path.join(project, "config/existing.txt"), "original\n");

// 1) 중간 실패 시 기존 파일·신규 파일·staging 디렉터리를 모두 원복한다.
await assert.rejects(
  () => withFileTransaction(project, "rollback-test", (transaction) => {
    transaction.writeFile("config/existing.txt", "changed\n");
    transaction.writeFile("generated/new.txt", "new\n", { mustNotExist: true });
    transaction.writeFile("preserved-empty/new.txt", "new\n", { mustNotExist: true });
    throw new Error("fault injection");
  }),
  /작업 전 상태로 롤백했습니다/,
  "중간 실패는 transaction 전체를 롤백해야 한다",
);
assert.equal(fs.readFileSync(path.join(project, "config/existing.txt"), "utf-8"), "original\n", "기존 파일을 복원해야 한다");
assert.equal(fs.existsSync(path.join(project, "generated/new.txt")), false, "신규 파일을 제거해야 한다");
assert.equal(fs.existsSync(path.join(project, "generated")), false, "롤백 후 빈 디렉터리를 정리해야 한다");
assert.equal(fs.existsSync(path.join(project, "preserved-empty")), true, "transaction 전부터 있던 빈 디렉터리는 보존해야 한다");
assert.equal(
  fs.readdirSync(project).filter((name) => name.startsWith(".egovframe-write-txn-")).length,
  0,
  "롤백 후 staging 디렉터리가 남으면 안 된다",
);

// 2) commit은 새 내용만 남기고 staging을 제거한다.
await withFileTransaction(project, "commit-test", (transaction) => {
  transaction.writeFile("config/existing.txt", "committed\n");
  transaction.writeFile("generated/new.txt", "committed new\n", { mustNotExist: true });
});
assert.equal(fs.readFileSync(path.join(project, "config/existing.txt"), "utf-8"), "committed\n", "commit이 기존 파일 갱신을 보존해야 한다");
assert.equal(fs.readFileSync(path.join(project, "generated/new.txt"), "utf-8"), "committed new\n", "commit이 신규 파일을 보존해야 한다");
assert.equal(
  fs.readdirSync(project).filter((name) => name.startsWith(".egovframe-write-txn-")).length,
  0,
  "commit 후 staging 디렉터리가 남으면 안 된다",
);

// 3) 절대·상대 이탈과 symlink 상위 경로를 쓰기 전에 거부한다.
const boundary = new ProjectFileTransaction(project, "boundary-test");
assert.throws(() => boundary.writeFile(path.join(tmp, "absolute.txt"), "x"), /절대·빈 경로/, "절대경로를 거부해야 한다");
assert.throws(() => boundary.writeFile("../outside.txt", "x"), /프로젝트 밖 경로/, "상대경로 이탈을 거부해야 한다");
assert.throws(
  () => boundary.writeFile(path.relative(project, path.join(boundary.stagingDir, "internal.txt")), "x"),
  /staging 내부 경로/,
  "transaction 자체 staging 경로 쓰기를 거부해야 한다",
);
assert.deepEqual(boundary.rollback(), [], "쓰기 전 경로 거부는 깨끗하게 종료되어야 한다");

const outside = path.join(tmp, "outside");
fs.mkdirSync(outside, { recursive: true });
const linked = path.join(project, "linked");
fs.symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
const symlinkBoundary = new ProjectFileTransaction(project, "symlink-test");
assert.throws(
  () => symlinkBoundary.writeFile("linked/escaped.txt", "x"),
  /symlink를 통해 프로젝트 밖/,
  "symlink 상위 경로를 통한 프로젝트 이탈을 거부해야 한다",
);
assert.deepEqual(symlinkBoundary.rollback(), [], "symlink 경로 거부는 깨끗하게 종료되어야 한다");
assert.equal(fs.existsSync(path.join(outside, "escaped.txt")), false, "프로젝트 밖 파일을 만들면 안 된다");

// 4) 신규 디렉터리는 sibling staging에서 완성한 뒤 commit하고 실패 시 흔적을 제거한다.
const directoryParent = path.join(tmp, "directory-parent");
const directoryResult = await withDirectoryTransaction(directoryParent, "created-project", "directory-commit", (stagingDir) => {
  assert.match(path.basename(stagingDir), /^\.egovframe-dir-txn-/, "최종 경로와 구분되는 staging을 사용해야 한다");
  fs.mkdirSync(path.join(stagingDir, "nested"), { recursive: true });
  fs.writeFileSync(path.join(stagingDir, "nested/file.txt"), "committed\n");
  return 7;
});
assert.equal(directoryResult, 7, "directory transaction action 결과를 보존해야 한다");
assert.equal(
  fs.readFileSync(path.join(directoryParent, "created-project/nested/file.txt"), "utf-8"),
  "committed\n",
  "완성한 staging 디렉터리를 최종 경로로 commit해야 한다",
);
assert.equal(
  fs.readdirSync(directoryParent).filter((name) => name.startsWith(".egovframe-dir-txn-")).length,
  0,
  "directory commit 후 staging이 남으면 안 된다",
);

const rollbackParent = path.join(tmp, "new-parent", "nested-output");
await assert.rejects(
  () => withDirectoryTransaction(rollbackParent, "failed-project", "directory-rollback", (stagingDir) => {
    fs.writeFileSync(path.join(stagingDir, "partial.txt"), "partial\n");
    throw new Error("directory fault injection");
  }),
  /작업 전 상태로 롤백했습니다/,
  "신규 디렉터리 생성 실패는 staging과 새 상위 디렉터리를 롤백해야 한다",
);
assert.equal(fs.existsSync(path.join(rollbackParent, "failed-project")), false, "실패한 최종 디렉터리를 남기면 안 된다");
assert.equal(fs.existsSync(path.join(tmp, "new-parent")), false, "transaction이 만든 빈 상위 디렉터리를 제거해야 한다");

fs.mkdirSync(path.join(directoryParent, "existing-project"));
await assert.rejects(
  () => withDirectoryTransaction(directoryParent, "existing-project", "directory-conflict", () => undefined),
  /대상이 이미 존재/,
  "기존 최종 디렉터리를 덮어쓰면 안 된다",
);

const racedProject = path.join(directoryParent, "raced-project");
await assert.rejects(
  () => withDirectoryTransaction(directoryParent, "raced-project", "directory-race", (stagingDir) => {
    fs.writeFileSync(path.join(stagingDir, "planned.txt"), "planned\n");
    fs.mkdirSync(racedProject);
    fs.writeFileSync(path.join(racedProject, "external.txt"), "external\n");
  }),
  /commit 직전 대상 디렉터리가 생성/,
  "commit 직전에 생긴 최종 디렉터리를 덮어쓰면 안 된다",
);
assert.equal(
  fs.readFileSync(path.join(racedProject, "external.txt"), "utf-8"),
  "external\n",
  "경합으로 생긴 외부 디렉터리 내용을 보존해야 한다",
);
assert.equal(
  fs.readdirSync(directoryParent).filter((name) => name.startsWith(".egovframe-dir-txn-")).length,
  0,
  "경합 거부 후 staging이 남으면 안 된다",
);
await assert.rejects(
  () => withDirectoryTransaction(directoryParent, "../escape", "directory-boundary", () => undefined),
  /최종 이름이 안전하지 않습니다/,
  "최종 디렉터리 이름의 상대경로 이탈을 거부해야 한다",
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("transaction OK");
