// MCP 서버 구성 — tools·resources·prompts 등록.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs";
import { CRUD_JAVA_TYPES, CRUD_PROFILES, generateCrud } from "./crud.js";
import { enforceAllowedRoots } from "./allowed-roots.js";
import { runBuild } from "./build-runner.js";
import { runTests } from "./test-runner.js";
import { syncCatalog, type CatalogSyncOptions } from "./catalog-sync.js";
import { DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "./shared.js";
import { DB_TYPES, TEMPLATES, createProject, type CreateOptions } from "./project.js";
import { loadCatalog, searchComponents } from "./catalog.js";
import { AI_STACKS, addAiComponents, loadAiCatalog, type AddAiComponentsOptions, type AiCatalog } from "./ai.js";
import { ECC_DB_TYPES, addComponents, removeComponents, type AddComponentsOptions, type RemoveOptions } from "./components.js";
import { validateProject } from "./validate.js";
import { DOCS_REPO, GUIDE_MAX_CHARS, extractDocSnippet, getGuide, searchDocs } from "./guide.js";
import { applyRecipe, loadRecipes, type ApplyRecipeOptions } from "./recipes.js";
import { diagnoseProject, generateReport } from "./diagnose.js";
import { upgradeProject } from "./upgrade.js";
import { explainComponent } from "./explain.js";
import { CI_JDK_RE, generateCiConfig } from "./ci-config.js";

/** MCP handshake 에 알리는 서버 버전 — package.json 을 단일 출처로 사용한다. */
export const SERVER_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export function buildServer(): McpServer {
  const server = new McpServer({ name: "egovframe-scaffold-mcp", version: SERVER_VERSION });

  server.tool(
    "list_egovframe_templates",
    "사용 가능한 전자정부 표준프레임워크 프로젝트 템플릿 목록을 반환합니다.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ templates: TEMPLATES, databases: DB_TYPES }, null, 2),
        },
      ],
    }),
  );

  server.tool(
    "create_egovframe_project",
    "전자정부 표준프레임워크 공식 템플릿으로 새 프로젝트 골격을 생성합니다. " +
      "공식 GitHub 템플릿을 내려받아 projectName/groupId/DB 타입을 적용합니다. " +
      "dryRun=true로 먼저 미리보기할 수 있습니다.",
    {
      projectName: z.string().describe("프로젝트명(artifactId). 소문자·숫자·하이픈, 예: my-egov-app"),
      groupId: z.string().describe("자바 groupId. 예: egovframework.example"),
      database: z.enum(DB_TYPES).default("hsql").describe("DB 타입 (템플릿 지원: hsql|mysql|oracle|altibase|tibero)"),
      template: z.enum(Object.keys(TEMPLATES) as [string, ...string[]]).default("simple-backend").describe("템플릿 종류"),
      outputDir: z.string().describe("프로젝트를 생성할 상위 디렉터리(절대경로 권장)"),
      ref: z.string().optional().describe("내려받을 브랜치/태그(미지정 시 템플릿 기본 브랜치). 예: main, v4.3.0"),
      dryRun: z.boolean().default(false).describe("true면 디스크에 쓰지 않고 생성 예정 내용만 미리보기"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const result = await createProject(args as CreateOptions);
      const head = result.dryRun
        ? `🔍 미리보기(dryRun): ${result.projectPath}`
        : `✅ 프로젝트 생성 완료: ${result.projectPath}`;
      const text = [
        head,
        `- 템플릿 ref: ${result.ref}`,
        `- ${result.dryRun ? "생성 예정" : "추출"} 파일: ${result.filesExtracted}개`,
        `- ${result.dryRun ? "적용 예정 설정" : "적용된 설정"}:`,
        ...result.customized.map((c) => `  · ${c}`),
        ``,
        `다음 단계:`,
        ...result.nextSteps.map((s, i) => `  ${i + 1}. ${s}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );


  server.tool(
    "sync_egovframe_catalog",
    "공식 egovframe-common-components 태그·commit·아카이브 무결성을 검증하고, 고정 카탈로그 대비 upstream 변경과 sec.security 보안 패키지를 점검합니다.",
    {
      ref: z.string().optional().describe("확인할 태그·브랜치·commit. 미지정 시 카탈로그의 공식 고정 태그 사용"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const result = await syncCatalog(args as CatalogSyncOptions);
      const text = [
        result.upToDate ? "✅ 공통컴포넌트 카탈로그가 고정 upstream과 일치합니다." : "⚠️ 공통컴포넌트 upstream 변경이 감지됐습니다.",
        `- 저장소: ${result.repository}`,
        `- 요청 ref: ${result.requestedRef}`,
        `- resolved commit: ${result.resolvedCommit}`,
        `- pinned commit: ${result.pinnedCommit ?? "없음"}`,
        `- 아카이브: ${result.archive.files}개 파일, ${result.archive.bytes} bytes, sha256:${result.archive.sha256}`,
        `- sec.security: ${result.archive.securityPaths.length}개 파일`,
        `- 미매핑 경로: ${result.archive.unmappedComponentPaths.length}건`,
        ...result.warnings.map((warning) => `- 경고: ${warning}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "list_egovframe_components",
    "선택 설치를 지원하는 공통컴포넌트 카탈로그를 반환합니다 (저장소 스캔으로 자동 생성, scripts/generate-catalog.mjs).",
    {},
    async () => {
      const catalog = loadCatalog();
      let ai: { source: AiCatalog["source"]; components: { id: string; stack: string; name: string; description: string; approxFiles: number }[] } | undefined;
      try {
        const aiCat = loadAiCatalog();
        ai = {
          source: aiCat.source,
          components: aiCat.components.map((c) => ({
            id: c.id, stack: c.stack, name: c.name, description: c.description, approxFiles: c.approxFiles,
          })),
        };
      } catch { /* AI 카탈로그가 없어도 기본 목록은 동작 */ }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                source: catalog.source,
                sqlNote: catalog.sqlNote,
                aiComponents: ai,
                components: catalog.components.map((c) => ({
                  id: c.id, name: c.name, category: c.category,
                  description: c.description, dependsOn: c.dependsOn, approxFiles: c.approxFiles,
                  assets: {
                    messageBundles: c.messageBundles?.length ?? 0,
                    idgnContexts: c.idgnContexts?.length ?? 0,
                    schedulingContexts: c.schedulingContexts?.length ?? 0,
                    webAssets: c.webAssets?.length ?? 0,
                    webFragments: c.webFragments?.length ?? 0,
                  },
                  mavenDependencies: c.mavenDependencies ?? [],
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "add_egovframe_components",
    "공통컴포넌트를 골라 기존 프로젝트에 조립합니다. 의존 컴포넌트를 포함해 소스·매퍼·JSP를 복사하고, " +
      "database 지정 시 DB DDL·DML 스크립트도 복사합니다. 기존 파일과 충돌하면 아무것도 쓰지 않고 거부합니다. " +
      "dryRun=true로 먼저 미리볼 수 있습니다.",
    {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장). 먼저 create_egovframe_project로 생성"),
      components: z.array(z.string()).min(1).describe("컴포넌트 id 목록. 예: [\"bbs\", \"login\"]"),
      includeDependencies: z.boolean().default(true).describe("의존 컴포넌트 자동 포함 여부"),
      database: z.enum(ECC_DB_TYPES).optional().describe("DB 스크립트 복사 대상 DB (altibase|cubrid|goldilocks|maria|mysql|oracle|postgres|tibero)"),
      dryRun: z.boolean().default(false).describe("true면 복사 없이 설치 순서·규모만 미리보기(네트워크 불필요)"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await addComponents(args as AddComponentsOptions);
      const head = r.dryRun
        ? `🔍 컴포넌트 조립 미리보기(dryRun): ${r.projectDir}`
        : `✅ 컴포넌트 조립 완료: ${r.projectDir}`;
      const text = [
        head,
        `- 요청: ${r.requested.join(", ")}`,
        `- 설치 순서(의존성 포함):`,
        ...r.installOrder.map((c, i) => `  ${i + 1}. ${c.id} — ${c.name} (${r.dryRun ? "약 " : ""}${c.files}개 파일)`),
        `- 총 ${r.dryRun ? "예상 " : ""}복사 파일: ${r.totalFiles}개`,
        `- 추가 자산: 메시지 ${r.assets.messageBundles}, ID 생성기 ${r.assets.idgnContexts}, 스케줄러 ${r.assets.schedulingContexts}, 웹 자산 ${r.assets.webAssets}, 설정 조각 ${r.assets.webFragments}`,
        ...(r.assets.reusedFiles ? [`- 동일 파일 재사용: ${r.assets.reusedFiles}개`] : []),
        ...(r.mavenDependencies.length ? [`- 감지된 Maven 좌표: ${r.mavenDependencies.length}건`, ...r.mavenDependencies.map((dependency) => `  · ${dependency}`)] : []),
        ...(r.sourceVerification ? [`- upstream 검증: ${r.sourceVerification.files}개 파일, sha256:${r.sourceVerification.sha256}`] : []),
        ...(r.sqlScripts.length ? [`- DB 스크립트: ${r.sqlScripts.length}개 복사`] : []),
        `- 참고: ${r.sqlNote}`,
        ``,
        `다음 단계:`,
        ...r.nextSteps.map((s, i) => `  ${i + 1}. ${s}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "search_egovframe_components",
    "키워드로 공통컴포넌트를 검색합니다 (id·이름·설명·카테고리 부분 일치, 점수순 상위 10건).",
    {
      query: z.string().describe("검색어. 예: 게시판, bbs, 로그인"),
      category: z.string().optional().describe("카테고리 필터 (cmm|cop|uss|sym|sec|utl|dam|ext|ssi|sts|uat)"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const results = searchComponents(loadCatalog(), args.query as string, args.category as string | undefined);
      const text = results.length === 0
        ? `'${args.query}'에 해당하는 컴포넌트가 없습니다 — list_egovframe_components로 전체 목록을 확인하세요`
        : [`🔎 '${args.query}' 검색 결과 (${results.length}건):`,
           ...results.map((r, i) => `  ${i + 1}. ${r.id} — ${r.name} [${r.category}] (${r.approxFiles}개 파일${r.dependsOn.length ? ", 의존: " + r.dependsOn.join(",") : ""})`)].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "remove_egovframe_components",
    "add_egovframe_components로 조립한 컴포넌트를 제거합니다. 설치 매니페스트에 기록된 파일만 삭제하며, " +
      "다른 설치 컴포넌트가 의존하거나 설치 시점 hash와 달라진 파일은 기본 거부합니다. " +
      "force=true는 remove-backup/에 사본을 만든 뒤 트랜잭션 제거하며, dryRun 미리보기를 지원합니다.",
    {
      projectDir: z.string().describe("대상 프로젝트 디렉터리"),
      components: z.array(z.string()).min(1).describe("제거할 컴포넌트 id 목록"),
      dryRun: z.boolean().default(false).describe("true면 삭제 없이 대상만 미리보기"),
      force: z.boolean().default(false).describe("사용자 수정·hash 미검증 파일도 remove-backup/에 백업한 뒤 제거"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await removeComponents(args as RemoveOptions);
      const head = r.dryRun ? `🔍 제거 미리보기(dryRun): ${r.projectDir}` : `🗑️ 컴포넌트 제거 완료: ${r.projectDir}`;
      const text = [head,
        ...r.removed.map((c) => `  - ${c.id}: 파일 ${c.files}개${c.sqlScripts ? `, DB 스크립트 ${c.sqlScripts}개` : ""}`),
        `- 현재 파일: 정상 ${r.summary.unchanged} · 수정 ${r.summary.modified} · hash 미검증 ${r.summary.unverified} · 누락 ${r.summary.missing}`,
        `- 총 ${r.dryRun ? "삭제 가능" : "삭제"} 파일: ${r.totalFiles}개`,
        ...(r.backupDir ? [`- 강제 제거 백업: ${r.backupDir}`] : []),
        ...(r.dryRun && r.blocked
          ? ["", "⚠️ 수정·hash 미검증 파일이 있어 기본 제거는 중단됩니다. 직접 보존하거나 force=true로 백업 후 제거하세요."]
          : r.dryRun ? ["", "실제 제거하려면 dryRun 없이 다시 호출하세요."] : []),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "validate_egovframe_project",
    "조립된 프로젝트의 무결성을 진단합니다: 설치 매니페스트 기준 파일 존재 확인, Globals.DbType과 복사된 DB 스크립트 일치 확인.",
    {
      projectDir: z.string().describe("검증할 프로젝트 디렉터리"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await validateProject(args as { projectDir: string });
      const text = [
        r.ok ? `✅ 검증 통과: ${r.projectDir}` : `⚠️ 경고 ${r.warnings.length}건: ${r.projectDir}`,
        `- 매니페스트: ${r.manifestFound ? "있음" : "없음"}`,
        ...(r.components.length
          ? [`- 설치 컴포넌트:`, ...r.components.map((c) => `  · ${c.id}: ${c.files}개 파일${c.missing ? ` (누락 ${c.missing}개: ${c.missingSamples.join(", ")})` : " (정상)"}`)]
          : []),
        `- Globals.DbType: ${r.dbType ?? "(미검출)"}` + (r.dbScriptDirs.length ? ` / DB 스크립트: ${r.dbScriptDirs.join(", ")}` : ""),
        ...(r.aiChecks.length
          ? ["- AI 실행 전제 진단:", ...r.aiChecks.map((c) => `  ${c.exists ? "✓" : "✗"} ${c.note}: ${c.file}${c.exists ? "" : " (준비 필요)"}`)]
          : []),
        ...(r.warnings.length ? ["", "경고:", ...r.warnings.map((w) => `  ! ${w}`)] : []),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "get_egovframe_guide",
    "컴포넌트의 공식 가이드 문서(표준프레임워크 포털 egovframe-docs)를 가져옵니다. " +
      "문서가 여러 건이면 목록을 함께 반환하며 docIndex로 선택할 수 있습니다.",
    {
      component: z.string().describe("컴포넌트 id. 예: bbs, login, cop.cmy"),
      docIndex: z.number().int().min(0).default(0).describe("문서가 여러 건일 때 선택 (0부터, 기본 0)"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await getGuide(args.component as string, args.docIndex as number);
      if (!r.selected)
        return { content: [{ type: "text", text: `'${r.componentId}'에 매핑된 가이드 문서가 없습니다. list_egovframe_components로 다른 컴포넌트를 확인하세요.` }] };
      const head = [
        `📘 ${r.selected.title} — ${r.componentId}`,
        `문서: https://github.com/${DOCS_REPO}/blob/main/${r.selected.path}`,
        r.docs.length > 1 ? `관련 문서 ${r.docs.length}건: ` + r.docs.map((d, i) => `[${i}] ${d.title}`).join(", ") : "",
        r.truncated ? `(본문이 길어 ${GUIDE_MAX_CHARS}자로 잘렸습니다 — 전문은 링크 참조)` : "",
        "", "---", "",
      ].filter((l, i) => l !== "" || i >= 4).join("\n");
      return { content: [{ type: "text", text: head + r.content }] };
    },
  );


  server.tool(
    "add_ai_components",
    "공식 egovframe-ai-rag 샘플 기반 AI RAG 챗봇(문서 업로드→임베딩→하이브리드 검색→LLM 응답)을 기존 Boot 프로젝트에 조립합니다. " +
      "소스·설정(application-ai.yml 프로필)·UI·인프라를 복사하고 pom에 누락 의존성만 마커 구간으로 삽입합니다(백업 생성, 제거 시 원복). " +
      "기존 파일과 충돌하면 아무것도 쓰지 않고 거부합니다. dryRun=true로 먼저 미리볼 수 있습니다.",
    {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장). egovframe-boot-starter-parent 기반 Boot 프로젝트"),
      stack: z.enum(AI_STACKS).describe("AI 스택: spring-ai(Redis Stack) | langchain4j(PGVector). 상호 배타"),
      includeInfra: z.boolean().default(true).describe("docker-compose.ai.yml·Dockerfile.ai·k8s/ai 복사"),
      includeUi: z.boolean().default(true).describe("채팅 UI(chat.html·static) 복사"),
      includeTests: z.boolean().default(false).describe("샘플 테스트 복사"),
      ref: z.string().optional().describe("egovframe-ai-rag 브랜치/태그 (기본: 카탈로그 기준 브랜치)"),
      dryRun: z.boolean().default(false).describe("true면 복사·병합 없이 계획만 미리보기(네트워크 불필요)"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await addAiComponents(args as AddAiComponentsOptions);
      const c = r.compatibility;
      const head = r.dryRun
        ? `🔍 AI 컴포넌트 조립 미리보기(dryRun): ${r.projectDir}`
        : `✅ AI 컴포넌트 조립 완료: ${r.projectDir}`;
      const text = [
        head,
        `- 컴포넌트: ${r.component.id} — ${r.component.name}`,
        `- 호환성: 부모 POM ${c.parentOk === true ? "일치" : c.parentOk === false ? "불일치" : "미확인"}` +
          ` (요구 ${c.required}${c.parentFound ? ", 발견 " + c.parentFound : ""})`,
        ...(c.warnings.length ? c.warnings.map((w) => `  ! ${w}`) : []),
        `- pom 의존성: ${r.dryRun ? "추가 예정" : "추가됨"} ${r.dependencyChanges.toAdd.length}건` +
          (r.dependencyChanges.alreadyPresent.length ? `, 이미 존재 ${r.dependencyChanges.alreadyPresent.length}건` : "") +
          (r.pomBackup ? ` (백업: ${r.pomBackup})` : ""),
        ...r.dependencyChanges.toAdd.slice(0, 8).map((d) => `  + ${d}`),
        ...(r.dependencyChanges.toAdd.length > 8 ? [`  + … 외 ${r.dependencyChanges.toAdd.length - 8}건`] : []),
        `- ${r.dryRun ? "복사 계획" : "복사 완료"} (총 ${r.totalFiles}개 파일):`,
        ...r.copyPlan.map((g) => `  · ${g.group}: ${g.files}개`),
        `- 실행 전제: ${r.prerequisites.join(", ")}`,
        ``,
        `다음 단계:`,
        ...r.nextSteps.map((s, i) => `  ${i + 1}. ${s}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  // ── 레시피 도구 (v0.13.0) ──────────────────────────────
  server.tool(
    "list_egovframe_recipes",
    "큐레이션된 레시피(템플릿+컴포넌트 번들) 목록을 반환합니다. apply_egovframe_recipe로 한 번에 조립할 수 있습니다.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify({ recipes: loadRecipes() }, null, 2) }],
    }),
  );

  server.tool(
    "apply_egovframe_recipe",
    "레시피 하나를 골라 프로젝트 생성 → 공통컴포넌트(필요 시 AI 계층) 조립까지 순차 실행합니다. dryRun=true로 전체 계획을 먼저 미리볼 수 있습니다.",
    {
      recipeId: z.string().describe("list_egovframe_recipes의 id. 예: board-login"),
      projectName: z.string().describe("프로젝트명(artifactId). 소문자·숫자·하이픈"),
      groupId: z.string().default("egovframework.example").describe("자바 groupId"),
      outputDir: z.string().describe("생성할 상위 디렉터리(절대경로 권장)"),
      database: z.enum(ECC_DB_TYPES).optional().describe("DB 스크립트 대상(미지정 시 레시피 기본값)"),
      dryRun: z.boolean().default(false).describe("true면 디스크 변경 없이 전체 계획만 미리보기"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const recipe = loadRecipes().find((r) => r.id === args.recipeId);
      if (!recipe) {
        return { content: [{ type: "text", text: `❌ 알 수 없는 recipeId: ${args.recipeId}` }] };
      }
      const result = await applyRecipe(args as ApplyRecipeOptions);

      const head = args.dryRun
        ? `🔍 레시피 미리보기(dryRun): ${recipe.name}`
        : `✅ 레시피 적용 완료: ${recipe.name}`;
      const text = [
        head,
        `- recipe: ${recipe.id}`,
        ...result.steps,
        ``,
        `다음 단계: validate_egovframe_project(projectDir="${result.project.projectPath}")로 무결성 확인`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  // ── 리소스 (v0.13.0) ───────────────────────────────────
  server.resource(
    "components-catalog",
    "egovframe://catalog/components",
    { mimeType: "application/json", description: "공통컴포넌트 카탈로그(요약)" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            loadCatalog().components.map((c) => ({
              id: c.id, name: c.name, category: c.category, dependsOn: c.dependsOn,
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.resource(
    "templates-catalog",
    "egovframe://catalog/templates",
    { mimeType: "application/json", description: "프로젝트 템플릿·지원 DB" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ templates: TEMPLATES, databases: DB_TYPES }, null, 2) }],
    }),
  );

  server.resource(
    "recipes-catalog",
    "egovframe://catalog/recipes",
    { mimeType: "application/json", description: "레시피 목록" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ recipes: loadRecipes() }, null, 2) }],
    }),
  );

  server.resource(
    "component-detail",
    new ResourceTemplate("egovframe://catalog/components/{id}", { list: undefined }),
    { mimeType: "application/json", description: "단일 공통컴포넌트 상세" },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : (variables.id as string);
      const c = loadCatalog().components.find((x) => x.id === id);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(c ?? { error: `unknown id: ${id}` }, null, 2) }],
      };
    },
  );

  // ── 프롬프트 (v0.13.0) ─────────────────────────────────
  server.prompt(
    "scaffold_board_login",
    "게시판+로그인 최소 구성을 만드는 절차를 안내합니다.",
    { projectName: z.string(), database: z.string().optional() },
    ({ projectName, database }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `표준프레임워크로 '${projectName}' 프로젝트를 만들고 게시판+로그인을 붙여줘. ` +
              `apply_egovframe_recipe(recipeId="board-login", projectName="${projectName}"` +
              `${database ? `, database="${database}"` : ""}) 실행 후 validate_egovframe_project로 확인.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "scaffold_ai_chatbot",
    "백엔드에 RAG 챗봇(AI 계층)을 붙이는 절차를 안내합니다.",
    { projectName: z.string(), stack: z.enum(AI_STACKS).default("spring-ai") },
    ({ projectName, stack }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `'${projectName}' 백엔드를 만들고 ${stack} 기반 AI 챗봇을 붙여줘. ` +
              `apply_egovframe_recipe(recipeId="ai-chatbot-backend", projectName="${projectName}") 실행 후 ` +
              `validate_egovframe_project의 aiChecks로 실행 전제를 확인.`,
          },
        },
      ],
    }),
  );
  // ── 진단 도구 (v0.14.0) ────────────────────────────────
  server.tool(
    "diagnose_egovframe_project",
    "기존(스캐폴딩 도구로 만들지 않은 것 포함) 전자정부 표준프레임워크 프로젝트를 스캔해 빌드시스템·RTE 버전·DbType·설치된 공통컴포넌트(카탈로그 pathPrefixes 지문)·설정 문제를 진단합니다. 디스크를 변경하지 않는 읽기 전용입니다.",
    {
      projectDir: z.string().describe("진단할 프로젝트 디렉터리(절대경로 권장)"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = diagnoseProject({ projectDir: args.projectDir });
      const lines = [
        `📋 진단: ${r.projectDir}`,
        `- 빌드: ${r.buildSystem}${r.isEgovProject ? " · egovframe 좌표 감지" : ""}`,
        `- RTE 버전: ${r.egovVersion ?? "미검출"}`,
        `- DbType: ${r.database ?? "미설정"}`,
        `- 감지 컴포넌트(${r.detectedComponents.length}): ${r.detectedComponents.map((c) => c.id).join(", ") || "없음"}`,
        `- AI 계층: ${r.aiLayer ? "있음" : "없음"} / 매니페스트: ${r.hasManifest ? "있음" : "없음"}`,
      ];
      if (r.issues.length) lines.push(``, `⚠️ 이슈:`, ...r.issues.map((i) => ` · ${i}`));
      if (r.suggestions.length) lines.push(``, `💡 제안:`, ...r.suggestions.map((s) => ` · ${s}`));
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
  // ── 문서 검색 도구 (v0.15.0) ───────────────────────────
  server.tool(
    "search_egovframe_docs",
    "공식 가이드 문서(egovframe-docs) 인덱스를 키워드로 검색합니다. 기본은 오프라인 인덱스 검색(제목·경로·연계 컴포넌트·카테고리 점수순)이며, fetchTop>0이면 상위 결과의 문서 본문을 내려받아 스니펫도 함께 제공합니다.",
    {
      query: z.string().describe("검색어. 예: \"로그인\", \"게시판 권한\""),
      limit: z.number().int().min(1).max(30).default(10).describe("최대 결과 수 (기본 10)"),
      fetchTop: z.number().int().min(0).max(5).default(0).describe("본문을 내려받아 스니펫을 붙일 상위 결과 수 (0=오프라인, 최대 5)"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const hits = searchDocs({ query: args.query, limit: args.limit });
      if (hits.length === 0)
        return { content: [{ type: "text", text: `🔎 "${args.query}" — 검색 결과 없음` }] };
      const terms = args.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const snippets = new Map<string, string>();
      const n = Math.min(args.fetchTop ?? 0, hits.length);
      for (let i = 0; i < n; i++) {
        const h = hits[i];
        try {
          const res = await fetchWithTimeout(`https://raw.githubusercontent.com/${DOCS_REPO}/main/${h.path}`, DOWNLOAD_TIMEOUT_MS);
          if (res.ok) snippets.set(h.path, extractDocSnippet(await res.text(), terms));
        } catch { /* 네트워크 실패 시 스니펫 생략 */ }
      }
      const lines = [
        `🔎 "${args.query}" — ${hits.length}건${n ? ` (상위 ${n}건 본문 스니펫)` : ""}`,
        ...hits.map((h, i) => {
          const base = `${i + 1}. ${h.title} [${h.category}] · 컴포넌트 ${h.componentId}\n   ${h.url}`;
          const s = snippets.get(h.path);
          return s ? `${base}\n   ▷ ${s}` : base;
        }),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
  // ── 리포트 도구 (v0.16.0) ──────────────────────────────
  server.tool(
    "generate_egovframe_report",
    "프로젝트를 스캔해 설치 공통컴포넌트·참조 테이블·가이드 문서 링크·이슈를 Markdown 리포트로 생성합니다. (읽기 전용) 조립 결과 문서화나 README 첨부에 적합합니다.",
    {
      projectDir: z.string().describe("리포트를 만들 프로젝트 디렉터리(절대경로 권장)"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      return {
        content: [{ type: "text", text: generateReport({ projectDir: args.projectDir }) }],
      };
    },
  );
  // ── 업그레이드 도구 (v0.17.0) ──────────────────────────
  server.tool(
    "upgrade_egovframe_project",
    "매니페스트에 기록된 설치 공통컴포넌트를 upstream 최신본과 비교해 갱신합니다. 사용자가 수정한 파일은 force 없이는 보존하며, dryRun(기본)으로 변경 계획을 먼저 확인합니다. 덮어쓰기 전 upgrade-backup/에 백업하고, 하드 충돌 시 아무것도 쓰지 않고 거부합니다.",
    {
      projectDir: z.string().describe("업그레이드할 프로젝트 디렉터리(절대경로 권장)"),
      components: z.array(z.string()).optional().describe("대상 컴포넌트 id (미지정 시 매니페스트 전체)"),
      dryRun: z.boolean().default(true).describe("true(기본)면 계획만 미리보기, 디스크 변경 없음"),
      force: z.boolean().default(false).describe("사용자 수정 파일(충돌)도 백업 후 덮어쓸지"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await upgradeProject(args);
      const s = r.summary;
      const head = r.dryRun ? `🔍 업그레이드 미리보기(dryRun): ${r.projectDir}` : `✅ 업그레이드 적용: ${r.projectDir}`;
      const lines = [
        head,
        `- 불변 ${s.unchanged} · 갱신 ${s.update} · 추가 ${s.added} · 사용자수정(보존) ${s["user-modified"]} · 충돌 ${s.conflict} · upstream삭제 ${s.removed}`,
      ];
      if (r.dryRun) {
        const changing = r.items.filter((i) => i.cls === "update" || i.cls === "added" || i.cls === "conflict").slice(0, 20);
        if (changing.length) lines.push(``, `변경 예정:`, ...changing.map((i) => ` · [${i.cls}] ${i.relPath}`));
        lines.push(``, s.conflict ? `⚠️ 충돌 ${s.conflict}건 — force=true라야 덮어씁니다.` : `적용하려면 dryRun=false로 다시 호출하세요.`);
      } else {
        lines.push(`- 적용: 갱신 ${r.applied?.updated} · 추가 ${r.applied?.added} · 강제 ${r.applied?.forced}`);
        if (r.backupDir) lines.push(`- 백업: ${r.backupDir}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
  // ── 컴포넌트 설명 도구 (v0.18.0) ───────────────────────
  server.tool(
    "explain_egovframe_component",
    "공통컴포넌트 하나의 상세(설명·직접/전이 의존성·이 컴포넌트에 의존하는 컴포넌트·참조 테이블·가이드 문서 링크·설치 명령)를 한 번에 반환합니다. (읽기 전용)",
    {
      id: z.string().describe("컴포넌트 id. 예: bbs"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const e = explainComponent(args.id);
      const L = [
        `# ${e.name} (${e.id}) · ${e.category}`,
        ``,
        e.description,
        ``,
        `- 직접 의존: ${e.dependsOn.join(", ") || "없음"}`,
        `- 전이 의존: ${e.transitiveDeps.join(", ") || "없음"}`,
        `- 이 컴포넌트에 의존: ${e.dependents.join(", ") || "없음"}`,
        `- 참조 테이블(${e.tables.length}): ${e.tables.join(", ") || "-"}`,
        `- 예상 파일: ${e.approxFiles}`,
        ``,
        `설치: ${e.installHint}`,
      ];
      if (e.docs.length) L.push(``, `가이드:`, ...e.docs.map((d) => `- [${d.title}](${d.url})`));
      return { content: [{ type: "text", text: L.join("\n") }] };
    },
  );

  // ── 리소스·프롬프트 확장 (v0.18.0) ─────────────────────
  server.resource(
    "ai-catalog",
    "egovframe://catalog/ai-components",
    { mimeType: "application/json", description: "AI 컴포넌트 카탈로그(스택 정의)" },
    async (uri) => {
      let text = "{}";
      try { text = JSON.stringify(loadAiCatalog(), null, 2); } catch { /* AI 카탈로그 없으면 빈 객체 */ }
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    },
  );

  server.prompt(
    "scaffold_portal",
    "포털사이트 최소 구성(공통·게시판·로그인)을 만드는 절차를 안내합니다.",
    { projectName: z.string(), database: z.string().optional() },
    ({ projectName, database }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `포털 백엔드 '${projectName}'를 만들어줘. ` +
              `apply_egovframe_recipe(recipeId="standard-portal", projectName="${projectName}"` +
              `${database ? `, database="${database}"` : ""}) 실행 후 validate_egovframe_project로 확인.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "maintain_existing",
    "기존 프로젝트를 진단→리포트→업그레이드로 점검하는 유지보수 절차를 안내합니다.",
    { projectDir: z.string() },
    ({ projectDir }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `기존 표준프레임워크 프로젝트 '${projectDir}'를 점검해줘. ` +
              `1) diagnose_egovframe_project 2) generate_egovframe_report ` +
              `3) upgrade_egovframe_project(dryRun=true)로 갱신 계획을 확인.`,
          },
        },
      ],
    }),
  );
  server.tool(
    "generate_egovframe_crud",
    "eGovFrame Development의 공식 CRUD wizard 입력 체계에 맞춰 VO·Mapper(XML)·Service·Controller·JSP(선택)·JUnit 5 테스트(선택) 골격을 생성합니다. Classic XML과 Boot REST 프로필을 지원하며, 전체 파일 충돌을 먼저 검사해 하나라도 존재하면 아무것도 쓰지 않습니다.",
    {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장, pom.xml 또는 build.gradle 필요)"),
      tableName: z.string().describe("CRUD 대상 테이블명. 단일 SQL 식별자, 예: SAMPLE_BOARD"),
      entityName: z.string().optional().describe("생성 클래스명. 미지정 시 tableName에서 PascalCase로 생성"),
      basePackage: z.string().describe("기본 자바 패키지. 예: egovframework.example.board"),
      fields: z.array(z.object({
        columnName: z.string().describe("DB 컬럼명. 예: BOARD_ID"),
        propertyName: z.string().optional().describe("자바 프로퍼티명. 미지정 시 columnName에서 camelCase로 생성"),
        javaType: z.enum(CRUD_JAVA_TYPES).default("String").describe("자바 타입"),
        jdbcType: z.string().optional().describe("MyBatis JDBC 타입. 미지정 시 javaType에서 추론"),
        primaryKey: z.boolean().default(false).describe("기본키 여부. 안전한 update/delete를 위해 최소 1개 필수"),
        generated: z.boolean().default(false).describe("DB 생성키 여부. 단일 기본키에서만 지원"),
        nullable: z.boolean().default(true).describe("NULL 허용 여부(메타데이터·후속 검증용)"),
        label: z.string().optional().describe("Javadoc/JSP 표시명"),
      })).min(1).max(100).describe("테이블 컬럼 정의"),
      profile: z.enum(CRUD_PROFILES).default("classic").describe("classic=Spring MVC+JSP, boot=REST Controller"),
      author: z.string().default("egovframe-scaffold-mcp").describe("공식 wizard의 author"),
      createDate: z.string().optional().describe("공식 wizard의 createDate. 미지정 시 오늘 날짜"),
      mapperFolder: z.string().optional().describe("프로젝트 기준 Mapper XML 폴더"),
      mapperPackage: z.string().optional().describe("Mapper 인터페이스 패키지"),
      voPackage: z.string().optional().describe("VO 패키지"),
      servicePackage: z.string().optional().describe("Service 패키지"),
      implPackage: z.string().optional().describe("ServiceImpl 패키지"),
      controllerPackage: z.string().optional().describe("Controller 패키지"),
      jspFolder: z.string().optional().describe("프로젝트 기준 JSP 폴더"),
      checkDataAccess: z.boolean().default(true).describe("공식 wizard DataAccess 그룹 생성 여부"),
      checkService: z.boolean().default(true).describe("공식 wizard Service 그룹 생성 여부"),
      checkWeb: z.boolean().default(true).describe("공식 wizard Web 그룹 생성 여부"),
      includeJsp: z.boolean().optional().describe("classic 프로필의 JSP 2종 생성 여부(기본 true)"),
      withTest: z.boolean().default(false).describe("JUnit 5 서비스 계약 테스트 골격 생성"),
      dryRun: z.boolean().default(false).describe("true면 파일을 쓰지 않고 생성 계획만 반환"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = generateCrud(args);
      const head = r.dryRun
        ? `🔍 CRUD 생성 미리보기(dryRun): ${r.entityName} ← ${r.tableName}`
        : `✅ CRUD 생성 완료: ${r.entityName} ← ${r.tableName}`;
      const componentCounts = new Map<string, number>();
      for (const file of r.files) componentCounts.set(file.component, (componentCounts.get(file.component) ?? 0) + 1);
      const lines = [
        head,
        `- 프로젝트: ${r.projectDir}`,
        `- 프로필: ${r.profile}`,
        `- 파일: ${r.files.length}개 (${[...componentCounts].map(([name, count]) => `${name} ${count}`).join(" · ")})`,
        ...r.files.map((file) => `  · ${file.path} (${file.bytes} bytes)`),
      ];
      if (r.warnings.length) lines.push(``, `확인 사항:`, ...r.warnings.map((warning) => `  ! ${warning}`));
      if (r.dryRun) lines.push(``, `실제 생성하려면 dryRun=false로 다시 호출하세요.`);
      else lines.push(``, `다음 단계: 생성 프로젝트에서 컴파일·테스트를 실행해 의존성과 설정을 확인하세요.`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
  // ── CI 설정 생성 도구 (v0.19.0) ────────────────────────
  server.tool(
    "generate_egovframe_ci",
    "프로젝트에 GitHub Actions CI 워크플로(빌드·테스트)를 생성합니다. 빌드도구(maven/gradle) 자동 감지, JDK 지정. dryRun으로 내용만 미리볼 수 있고, 실제 생성 시 기존 파일이 있으면 덮어쓰지 않고 거부합니다.",
    {
      projectDir: z.string().describe("프로젝트 디렉터리(절대경로 권장)"),
      jdk: z.string().regex(CI_JDK_RE, "숫자와 점으로 된 버전만 허용 (예: 17, 21, 1.8)").default("17").describe("JDK 버전 (기본 17, 숫자·점만 허용)"),
      dryRun: z.boolean().default(false).describe("true면 파일 생성 없이 내용만 반환"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = generateCiConfig(args);
      const head = r.dryRun
        ? `🔍 CI 설정 미리보기(dryRun): ${r.path} (${r.buildTool})`
        : `✅ CI 설정 생성: ${r.path} (${r.buildTool})`;
      return { content: [{ type: "text", text: `${head}\n\n\`\`\`yaml\n${r.content}\`\`\`` }] };
    },
  );
  // ── 프로젝트 빌드 실행 도구 (v0.23.0) ────────────────────────
  // generate_egovframe_ci가 CI '설정'만 만들던 한계를 보완: 생성한 프로젝트를 실제로
  // 컴파일·테스트하고, 오류를 파일·라인 단위로 구조화해 생성→검증 루프를 닫는다.
  server.tool(
    "build_egovframe_project",
    "생성한 eGovFrame 프로젝트를 실제로 빌드(컴파일·테스트·패키지)하고 결과를 구조화해 반환합니다. 빌드도구(maven/gradle)와 래퍼(mvnw/gradlew)를 자동 감지하고, 컴파일·테스트 오류를 파일·라인 단위로 파싱합니다. dryRun으로 실행 예정 명령만 미리볼 수 있습니다. (생성→검증 루프 완성)",
    {
      projectDir: z.string().describe("빌드할 프로젝트 루트 디렉터리(pom.xml 또는 build.gradle 위치, 절대경로 권장)"),
      goal: z
        .enum(["compile", "test", "package"])
        .default("compile")
        .describe("빌드 작업: compile(컴파일만), test(테스트까지), package(패키징, 테스트 생략). 기본 compile"),
      timeoutSeconds: z
        .number()
        .int()
        .positive()
        .max(3600)
        .default(300)
        .describe("빌드 타임아웃(초). 초과 시 중단. 기본 300초"),
      maxLogLines: z
        .number()
        .int()
        .positive()
        .max(5000)
        .default(200)
        .describe("반환 로그의 최대 줄 수(마지막 N줄). 기본 200줄"),
      dryRun: z.boolean().default(false).describe("true면 실행 없이 감지된 빌드도구·명령만 반환"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await runBuild({
        projectDir: args.projectDir,
        goal: args.goal,
        timeoutMs: args.timeoutSeconds * 1000,
        maxLogLines: args.maxLogLines,
        dryRun: args.dryRun,
      });

      if (r.dryRun) {
        const text = [
          `🔍 빌드 미리보기(dryRun)`,
          `- 빌드도구: ${r.buildTool}${r.usedWrapper ? " (wrapper)" : ""}`,
          `- 작업(goal): ${r.goal}`,
          `- 실행 예정 명령: ${r.command}`,
          `- 작업 디렉터리: ${r.cwd}`,
          ``,
          `실제 실행하려면 dryRun=false로 다시 호출하세요.`,
        ].join("\n");
        return { content: [{ type: "text", text }] };
      }

      const secs = ((r.durationMs ?? 0) / 1000).toFixed(1);
      const head = r.success
        ? `✅ 빌드 성공: ${r.goal} (${r.buildTool}${r.usedWrapper ? ", wrapper" : ""}) — ${secs}s`
        : r.timedOut
          ? `⏱️ 빌드 시간 초과: ${r.goal} (${r.buildTool}) — ${secs}s 후 중단`
          : `❌ 빌드 실패: ${r.goal} (${r.buildTool}) — exit=${r.exitCode}, ${secs}s`;
      const lines = [head, `- 명령: ${r.command}`, `- 디렉터리: ${r.cwd}`];
      if (r.errors && r.errors.length) {
        lines.push(``, `발견된 오류 ${r.errors.length}개:`);
        for (const e of r.errors.slice(0, 50)) {
          lines.push(`  · ${e.file}:${e.line}${e.column ? ":" + e.column : ""} — ${e.message}`);
        }
        if (r.errors.length > 50) lines.push(`  … 외 ${r.errors.length - 50}개`);
      } else if (!r.success) {
        lines.push(``, `구조화된 오류를 추출하지 못했습니다. 아래 로그를 확인하세요.`);
      }
      if (r.logTail) {
        const label = r.logTruncated ? `마지막 ${args.maxLogLines}/${r.totalLogLines}줄` : `전체 ${r.totalLogLines}줄`;
        lines.push(``, `로그(${label}):`, "```", r.logTail, "```");
      }
      return { content: [{ type: "text", text: lines.join("\n") }], isError: !r.success };
    },
  );

  // ── 테스트 실행 도구 (v0.25.0) ────────────────────────────────
  // build_egovframe_project(goal=test)는 종료 코드와 로그만 돌려줬다. 이 도구는 빌드도구가 남기는
  // JUnit XML 리포트를 읽어 스위트·케이스 단위로 결과를 구조화하고, 실패 케이스의 메시지와
  // 테스트 클래스 내 파일·라인까지 제공해 "어느 테스트가 왜 깨졌는가"에 바로 답한다.
  server.tool(
    "test_egovframe_project",
    "eGovFrame 프로젝트의 테스트를 실제로 실행하고 JUnit XML 리포트(surefire/gradle)를 읽어 결과를 구조화합니다. 스위트별 통과·실패·오류·건너뜀 수와, 실패 케이스의 메시지·예외 타입·테스트 파일/라인을 반환합니다. testFilter로 특정 클래스/메서드만 실행할 수 있고, dryRun으로 실행 예정 명령을 미리볼 수 있습니다. (build_egovframe_project 의 테스트 후속)",
    {
      projectDir: z.string().describe("테스트할 프로젝트 루트 디렉터리(pom.xml 또는 build.gradle 위치, 절대경로 권장)"),
      testFilter: z
        .string()
        .optional()
        .describe("실행할 테스트 패턴(빌드도구 문법 그대로). maven: `FooTest`, `FooTest#bar`, `com.acme.*Test` / gradle: `com.acme.FooTest`, `*FooTest.bar`. 생략 시 전체"),
      timeoutSeconds: z
        .number()
        .int()
        .positive()
        .max(3600)
        .default(600)
        .describe("테스트 타임아웃(초). 초과 시 중단. 기본 600초"),
      maxLogLines: z
        .number()
        .int()
        .positive()
        .max(5000)
        .default(200)
        .describe("반환 로그의 최대 줄 수(마지막 N줄). 기본 200줄"),
      maxFailures: z
        .number()
        .int()
        .positive()
        .max(500)
        .default(50)
        .describe("반환할 실패·오류 케이스 최대 수. 기본 50"),
      dryRun: z.boolean().default(false).describe("true면 실행 없이 감지된 빌드도구·명령·리포트 위치만 반환"),
    },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await runTests({
        projectDir: args.projectDir,
        testFilter: args.testFilter,
        timeoutMs: args.timeoutSeconds * 1000,
        maxLogLines: args.maxLogLines,
        maxFailures: args.maxFailures,
        dryRun: args.dryRun,
      });

      if (r.dryRun) {
        const text = [
          `🔍 테스트 미리보기(dryRun)`,
          `- 빌드도구: ${r.buildTool}${r.usedWrapper ? " (wrapper)" : ""}`,
          `- 실행 예정 명령: ${r.command}`,
          `- 작업 디렉터리: ${r.cwd}`,
          `- 리포트 위치: ${r.reportDir}`,
          ``,
          `실제 실행하려면 dryRun=false로 다시 호출하세요.`,
        ].join("\n");
        return { content: [{ type: "text", text }] };
      }

      const secs = ((r.durationMs ?? 0) / 1000).toFixed(1);
      const s = r.summary!;
      const counts = `${s.tests}건: 통과 ${s.passed} · 실패 ${s.failures} · 오류 ${s.errors} · 건너뜀 ${s.skipped} (스위트 ${s.suites})`;
      const head = r.success
        ? `✅ 테스트 통과 — ${counts} — ${secs}s`
        : r.timedOut
          ? `⏱️ 테스트 시간 초과 — ${secs}s 후 중단 — 집계 ${counts}`
          : `❌ 테스트 실패 — ${counts} — exit=${r.exitCode}, ${secs}s`;
      const lines = [head, `- 명령: ${r.command}`, `- 디렉터리: ${r.cwd}`, `- 리포트: ${r.reportDir}${r.reportsFound ? "" : " (리포트 없음)"}`];

      if (r.failures && r.failures.length) {
        lines.push(``, `실패·오류 케이스 ${r.failures.length}${r.failuresTruncated ? "+" : ""}개:`);
        for (const f of r.failures) {
          const where = f.file ? ` @ ${f.file}${f.line ? ":" + f.line : ""}` : "";
          const type = f.type ? ` [${f.type.split(".").pop()}]` : "";
          lines.push(`  · ${f.suite}#${f.name}${type}${where}${f.message ? " — " + f.message.split("\n")[0].slice(0, 300) : ""}`);
        }
        if (r.failuresTruncated) lines.push(`  … maxFailures(${args.maxFailures}) 초과분은 ${r.reportDir} 리포트에서 확인`);
      }
      if (r.suites && r.suites.length) {
        const bad = r.suites.filter((x) => x.failures || x.errors);
        const shown = (bad.length ? bad : r.suites).slice(0, 30);
        lines.push(``, bad.length ? `문제 스위트 ${bad.length}개:` : `스위트 ${r.suites.length}개:`);
        for (const x of shown) lines.push(`  · ${x.name} — ${x.tests}건 (실패 ${x.failures}, 오류 ${x.errors}, 건너뜀 ${x.skipped})`);
        if ((bad.length ? bad : r.suites).length > 30) lines.push(`  … 외 ${(bad.length ? bad : r.suites).length - 30}개`);
      }
      if (r.compileErrors && r.compileErrors.length) {
        lines.push(``, `컴파일 오류 ${r.compileErrors.length}개(테스트 이전 단계):`);
        for (const e of r.compileErrors.slice(0, 30)) {
          lines.push(`  · ${e.file}:${e.line}${e.column ? ":" + e.column : ""} — ${e.message}`);
        }
      }
      if (!r.success && !r.reportsFound && !(r.compileErrors && r.compileErrors.length)) {
        lines.push(``, `리포트가 생성되지 않았습니다 — 컴파일 실패, testFilter 불일치, 테스트 없음, 또는 DB 등 외부 의존성 오류일 수 있습니다. 아래 로그를 확인하세요.`);
      }
      if (r.logTail) {
        const label = r.logTruncated ? `마지막 ${args.maxLogLines}/${r.totalLogLines}줄` : `전체 ${r.totalLogLines}줄`;
        lines.push(``, `로그(${label}):`, "```", r.logTail, "```");
      }
      return { content: [{ type: "text", text: lines.join("\n") }], isError: !r.success };
    },
  );
  return server;
}
