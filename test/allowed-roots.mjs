// node test/allowed-roots.mjs — 전 도구 공통 허용 root 가드 오프라인 회귀
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ALLOWED_ROOTS_ENV,
  AllowedRootsError,
  assertPathAllowed,
  enforceAllowedRoots,
  loadAllowedRoots,
} from "../dist/index.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "allowed-roots-"));
const inside = path.join(tmp, "workspace");
const outside = path.join(tmp, "elsewhere");
fs.mkdirSync(inside, { recursive: true });
fs.mkdirSync(outside, { recursive: true });

// 1) 미설정이면 제한이 없다 (하위 호환).
delete process.env[ALLOWED_ROOTS_ENV];
assert.equal(loadAllowedRoots(), null, "미설정이면 null이어야 한다");
assert.equal(assertPathAllowed("projectDir", outside), path.resolve(outside), "미설정이면 어떤 경로든 통과해야 한다");

// 2) 설정하면 내부는 통과, 외부는 구조화된 오류로 거부한다.
process.env[ALLOWED_ROOTS_ENV] = inside;
assert.deepEqual(loadAllowedRoots(), [fs.realpathSync(inside)], "설정한 root를 realpath로 읽어야 한다");
assert.equal(
  assertPathAllowed("projectDir", path.join(inside, "app")),
  path.resolve(inside, "app"),
  "root 내부(미존재 하위 포함)는 통과해야 한다",
);
assert.equal(assertPathAllowed("projectDir", inside), path.resolve(inside), "root 자신도 통과해야 한다");
assert.throws(
  () => assertPathAllowed("projectDir", outside),
  (error) => {
    assert.ok(error instanceof AllowedRootsError, "AllowedRootsError여야 한다");
    assert.equal(error.violation.argument, "projectDir");
    assert.deepEqual(error.violation.allowedRoots, [fs.realpathSync(inside)]);
    assert.match(error.message, /allowed-roots: \[/, "허용 root 목록을 메시지에 담아야 한다");
    return true;
  },
  "root 밖 경로는 거부해야 한다",
);

// 3) `..` 이탈과 symlink 우회를 거부한다.
assert.throws(
  () => assertPathAllowed("projectDir", path.join(inside, "..", "elsewhere")),
  AllowedRootsError,
  "상대 이탈을 거부해야 한다",
);
const link = path.join(inside, "leak");
try {
  fs.symlinkSync(outside, link, "dir");
  assert.throws(
    () => assertPathAllowed("projectDir", path.join(link, "app")),
    AllowedRootsError,
    "symlink를 통한 root 밖 경로를 거부해야 한다",
  );
} catch (error) {
  if (error?.code !== "EPERM") throw error; // 권한상 symlink 불가 환경(Windows 등)은 건너뜀
}

// 4) enforceAllowedRoots는 알려진 디렉터리 인자만 검사하고 나머지는 건드리지 않는다.
const okArgs = { projectDir: path.join(inside, "proj"), components: ["bbs"] };
assert.equal(enforceAllowedRoots(okArgs), okArgs, "통과 시 인자 객체를 그대로 돌려줘야 한다");
assert.throws(
  () => enforceAllowedRoots({ outputDir: outside }),
  AllowedRootsError,
  "outputDir도 동일하게 검사해야 한다",
);
assert.doesNotThrow(
  () => enforceAllowedRoots({ query: "board", limit: 3 }),
  "디렉터리 인자가 없는 도구 인자는 무해해야 한다",
);

// 5) 여러 root와 공백 항목 처리.
process.env[ALLOWED_ROOTS_ENV] = [" ", inside, outside].join(path.delimiter);
assert.equal(loadAllowedRoots().length, 2, "공백 항목은 무시하고 두 root를 읽어야 한다");
assert.doesNotThrow(() => assertPathAllowed("projectDir", outside), "두 번째 root도 허용해야 한다");

delete process.env[ALLOWED_ROOTS_ENV];
console.log("allowed-roots 회귀 통과");
