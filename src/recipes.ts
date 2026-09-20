// 레시피 — 템플릿+컴포넌트(+AI) 번들 조립 (apply_egovframe_recipe).
import * as fs from "node:fs";
import * as path from "node:path";
import { withDirectoryTransaction } from "./file-transaction.js";
import { DB_TYPES, TEMPLATES, createProjectInternal, type CreateResult } from "./project.js";
import { loadCatalog } from "./catalog.js";
import { AI_STACKS, addAiComponents } from "./ai.js";
import { ECC_DB_TYPES, addComponents } from "./components.js";

/* ------------------------------------------------------------------ */
/* MCP 서버                                                             */
/* ------------------------------------------------------------------ */
// ── 레시피 (v0.13.0) ─────────────────────────────────────
export interface Recipe {
  id: string;
  name: string;
  description: string;
  template: keyof typeof TEMPLATES;
  components: string[];
  /** 공식 템플릿이 이미 제공하므로 다시 복사하지 않는 의존 컴포넌트. */
  providedComponents?: string[];
  database?: (typeof ECC_DB_TYPES)[number];
  ai?: { stack: (typeof AI_STACKS)[number] };
}

const RECIPES_URL = new URL("../catalog/recipes.json", import.meta.url);

let _recipes: Recipe[] | null = null;

/** catalog/recipes.json 로드 (오프라인, 1회 캐시). */
export function loadRecipes(): Recipe[] {
  if (_recipes) return _recipes;
  const raw = JSON.parse(fs.readFileSync(RECIPES_URL, "utf-8")) as { recipes: Recipe[] };
  _recipes = raw.recipes;
  return _recipes;
}

export interface ApplyRecipeOptions {
  recipeId: string;
  projectName: string;
  groupId: string;
  outputDir: string;
  database?: (typeof ECC_DB_TYPES)[number];
  dryRun?: boolean;
  /** fault-injection 회귀 테스트 전용. MCP 스키마에는 노출하지 않는다. */
  faultInjection?: "after-create" | "after-components" | "after-ai";
}

export interface ApplyRecipeResult {
  recipe: Recipe;
  project: CreateResult;
  steps: string[];
}

/** 프로젝트 생성과 공통·AI 컴포넌트 조립을 하나의 신규 디렉터리 transaction으로 실행한다. */
export async function applyRecipe(opts: ApplyRecipeOptions): Promise<ApplyRecipeResult> {
  const recipe = loadRecipes().find((candidate) => candidate.id === opts.recipeId);
  if (!recipe) throw new Error(`알 수 없는 recipeId: ${opts.recipeId}`);

  const dryRun = opts.dryRun === true;
  const eccDb = opts.database ?? recipe.database;
  const createDb = (DB_TYPES as readonly string[]).includes(eccDb ?? "")
    ? (eccDb as (typeof DB_TYPES)[number])
    : "hsql";

  const execute = async (transactionStagingPath?: string): Promise<ApplyRecipeResult> => {
    const project = await createProjectInternal({
      projectName: opts.projectName,
      groupId: opts.groupId,
      database: createDb,
      template: recipe.template,
      outputDir: opts.outputDir,
      dryRun,
    }, transactionStagingPath);
    const workingProjectPath = transactionStagingPath ?? project.projectPath;
    const steps = [
      `① 생성: ${project.projectPath} (${project.dryRun ? "예정" : "추출"} ${project.filesExtracted}파일, ref ${project.ref})`,
    ];

    if (!dryRun && opts.faultInjection === "after-create")
      throw new Error("recipe fault injection: after-create");

    if (recipe.components.length) {
      const provided = [...new Set(recipe.providedComponents ?? [])];
      const unknownProvided = provided.filter((id) => !recipe.components.includes(id));
      if (unknownProvided.length)
        throw new Error(`레시피 카탈로그 오류: providedComponents가 components에 없습니다: ${unknownProvided.join(", ")}`);

      if (!dryRun && provided.length) {
        const catalogById = new Map(loadCatalog().components.map((component) => [component.id, component]));
        for (const id of provided) {
          const component = catalogById.get(id);
          if (!component)
            throw new Error(`레시피 카탈로그 오류: 템플릿 제공 컴포넌트 '${id}'가 카탈로그에 없습니다`);
          const found = component.pathPrefixes.some((prefix) => fs.existsSync(path.resolve(workingProjectPath, prefix)));
          if (!found)
            throw new Error(`템플릿 제공 컴포넌트 '${id}'를 생성된 프로젝트에서 확인할 수 없습니다 — template/ref 호환성을 확인하세요`);
        }
      }

      const providedSet = new Set(provided);
      const installComponents = recipe.components.filter((id) => !providedSet.has(id));
      const componentSteps: string[] = [];
      if (provided.length)
        componentSteps.push(`템플릿 제공 ${provided.join(", ")} 보존${dryRun ? " 예정" : "·확인"}`);
      if (installComponents.length) {
        const add = await addComponents({
          projectDir: workingProjectPath,
          components: installComponents,
          // recipe.components가 전체 의존성을 열거하고 providedComponents는 템플릿이 충족한다.
          includeDependencies: false,
          database: eccDb,
          dryRun,
        });
        componentSteps.push(
          `추가 ${add.requested.join(", ")} — ${add.dryRun ? "예정 " : ""}${add.totalFiles}파일` +
            (add.sqlScripts.length ? `, SQL ${add.sqlScripts.length}건` : ""),
        );
      }
      steps.push(`② 컴포넌트 — ${componentSteps.join("; ")}`);
    }

    if (!dryRun && opts.faultInjection === "after-components")
      throw new Error("recipe fault injection: after-components");

    if (recipe.ai) {
      const ai = await addAiComponents({
        projectDir: workingProjectPath,
        stack: recipe.ai.stack,
        dryRun,
      });
      steps.push(
        `③ AI(${recipe.ai.stack}) — ${dryRun ? "예정 " : ""}${ai.copiedFiles}파일` +
          (ai.pomChanged ? ", pom 병합" : ""),
      );
      if (!dryRun && opts.faultInjection === "after-ai")
        throw new Error("recipe fault injection: after-ai");
    }

    return { recipe, project, steps };
  };

  if (dryRun) return execute();
  return withDirectoryTransaction(
    path.resolve(opts.outputDir),
    opts.projectName,
    "레시피 적용",
    execute,
  );
}
