// node test/recipe-transaction.mjs — 공식 템플릿·공통컴포넌트를 사용한 recipe rollback 통합 검증
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyRecipe, readManifest, validateProject } from "../dist/index.js";

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
        /recipe fault injection: after-components/,
        "컴포넌트 조립 성공 뒤 fault injection으로 실패해야 한다",
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

  const success = await applyRecipe({
    recipeId: "board-login",
    projectName: "recipe-success-app",
    groupId: "egovframework.example",
    outputDir: path.join(sandbox, "success-output"),
    database: "mysql",
  });
  assert.match(success.steps.join("\n"), /템플릿 제공 cmm 보존·확인/);
  assert.match(success.steps.join("\n"), /추가 bbs, login — 133파일, SQL 4건/);
  assert.equal(fs.existsSync(success.project.projectPath), true, "성공한 recipe는 최종 프로젝트를 공개해야 한다");

  const manifest = readManifest(success.project.projectPath);
  assert.ok(manifest, "성공한 recipe는 설치 매니페스트를 기록해야 한다");
  assert.equal(manifest.components.cmm, undefined, "템플릿 제공 cmm을 도구 소유 파일로 기록하면 안 된다");
  assert.deepEqual(Object.keys(manifest.components).sort(), ["bbs", "login"]);
  assert.equal(manifest.components.bbs.files.length, 88);
  assert.equal(manifest.components.login.files.length, 41);

  const validation = await validateProject({ projectDir: success.project.projectPath });
  assert.equal(validation.ok, true, validation.warnings.join("\n"));
  assert.deepEqual(validation.components.map((component) => component.id).sort(), ["bbs", "login"]);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log("recipe transaction OK");
