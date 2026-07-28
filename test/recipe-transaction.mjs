// node test/recipe-transaction.mjs — 공식 템플릿·공통컴포넌트를 사용한 recipe rollback 통합 검증
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyRecipe } from "../dist/index.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-transaction-"));
const outputDir = path.join(sandbox, "new-parent", "output");
const projectName = "recipe-rollback-app";

try {
  await assert.rejects(
    () => applyRecipe({
      recipeId: "board-login",
      projectName,
      groupId: "egovframework.example",
      outputDir,
      database: "mysql",
      faultInjection: "after-components",
    }),
    (error) => {
      assert.match(
        String(error),
        /recipe fault injection: after-components|기존 파일과 충돌하여 중단합니다/,
        "현재 템플릿 충돌 또는 향후 충돌 해소 뒤 fault injection으로 컴포넌트 단계 이후 실패해야 한다",
      );
      assert.match(String(error), /작업 전 상태로 롤백했습니다/);
      return true;
    },
    "컴포넌트 조립 뒤 실패는 recipe 전체를 롤백해야 한다",
  );

  assert.equal(
    fs.existsSync(path.join(outputDir, projectName)),
    false,
    "실패한 recipe의 최종 프로젝트 디렉터리를 노출하면 안 된다",
  );
  assert.equal(
    fs.existsSync(path.join(sandbox, "new-parent")),
    false,
    "recipe transaction이 만든 빈 상위 디렉터리를 제거해야 한다",
  );
  assert.equal(
    fs.readdirSync(sandbox).some((name) => name.startsWith(".egovframe-dir-txn-")),
    false,
    "recipe rollback 후 staging이 남으면 안 된다",
  );
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log("recipe transaction OK");
