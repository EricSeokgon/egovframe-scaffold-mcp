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
import { loadTemplateCatalog, syncTemplateCatalog } from "./template-catalog.js";
import { renderCatalogDriftLines } from "./catalog-drift.js";
import { CONFIG_FORMATS, describeConfigTemplates, generateConfig, loadConfigCatalog } from "./config-generator.js";
import { applyMigration, loadMigrationRules, migrateProject, renderMigrationApplyMarkdown, renderMigrationMarkdown, renderMigrationVerifyMarkdown, verifyMigration, type MigrateResult } from "./migrate.js";
import { checkDependencies, loadDependencyBaseline, renderDependencyMarkdown } from "./dependencies.js";
import { NETWORK_HOSTS, diagnoseNetwork, renderNetworkMarkdown } from "./network.js";
import { generateAgentsMd } from "./agents-md.js";
import { generateSbom, renderSbomMarkdown } from "./sbom.js";
import { resolveToolLang, toolDescription } from "./i18n.js";
import { toolAnnotations, toolTitle } from "./tool-meta.js";
import { OUTPUT_SCHEMAS } from "./output-schemas.js";

/** MCP handshake 에 알리는 서버 버전 — package.json 을 단일 출처로 사용한다. */
export { SERVER_VERSION } from "./version.js";
import { SERVER_VERSION } from "./version.js";

/** 통합 템플릿 카탈로그 요약 — 카탈로그 파일이 없어도 기본 목록은 계속 동작한다. */
function unifiedTemplateSummary():
  | { coverage: ReturnType<typeof loadTemplateCatalog>["coverage"]; uncovered: Array<{ id: string; category: string; displayName: string }>; mcpOnly: string[] }
  | undefined {
  try {
    const catalog = loadTemplateCatalog();
    return {
      coverage: catalog.coverage,
      uncovered: catalog.projects
        .filter((project) => !project.mcpTemplate)
        .map((project) => ({ id: project.id, category: project.category, displayName: project.displayName })),
      mcpOnly: catalog.mcpOnly.map((template) => template.id),
    };
  } catch {
    return undefined;
  }
}

/** structuredContent 용: 편집 오프셋(edits)은 적용 내부용이라 구조화 출력에서 뺀다 (json text 에는 그대로 남음) */
function stripEdits(r: MigrateResult): Record<string, unknown> {
  return { ...r, items: r.items.map(({ edits: _e, ...rest }) => rest) } as unknown as Record<string, unknown>;
}

export function buildServer(opts: { lang?: "ko" | "en" } = {}): McpServer {
  const server = new McpServer({ name: "egovframe-scaffold-mcp", version: SERVER_VERSION });
  const lang = opts.lang ?? resolveToolLang();
  const d = (name: string, ko: string) => toolDescription(name, ko, lang);
  const t = (name: string) => toolTitle(name, lang);

  server.registerTool(
    "list_egovframe_templates",
    { title: t("list_egovframe_templates"), description: d("list_egovframe_templates", "사용 가능한 전자정부 표준프레임워크 프로젝트 템플릿 목록을 반환합니다."), inputSchema: {}, annotations: toolAnnotations("list_egovframe_templates") },
        async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ templates: TEMPLATES, databases: DB_TYPES, unified: unifiedTemplateSummary() }, null, 2),
        },
      ],
    }),
  );

  server.registerTool(
    "create_egovframe_project",
    { title: t("create_egovframe_project"), description: d("create_egovframe_project", "전자정부 표준프레임워크 공식 템플릿으로 새 프로젝트 골격을 생성합니다. " +
      "공식 GitHub 템플릿을 내려받아 projectName/groupId/DB 타입을 적용합니다. " +
      "dryRun=true로 먼저 미리보기할 수 있습니다."), inputSchema: {
      projectName: z.string().describe("프로젝트명(artifactId). 소문자·숫자·하이픈, 예: my-egov-app"),
      groupId: z.string().describe("자바 groupId. 예: egovframework.example"),
      database: z.enum(DB_TYPES).default("hsql").describe("DB 타입 (템플릿 지원: hsql|mysql|oracle|altibase|tibero)"),
      template: z.enum(Object.keys(TEMPLATES) as [string, ...string[]]).default("simple-backend").describe("템플릿 종류"),
      outputDir: z.string().describe("프로젝트를 생성할 상위 디렉터리(절대경로 권장)"),
      ref: z.string().optional().describe("내려받을 브랜치/태그(미지정 시 템플릿 기본 브랜치). 예: main, v4.3.0"),
      dryRun: z.boolean().default(false).describe("true면 디스크에 쓰지 않고 생성 예정 내용만 미리보기"),
    }, annotations: toolAnnotations("create_egovframe_project") },
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


  server.registerTool(
    "sync_egovframe_catalog",
    { title: t("sync_egovframe_catalog"), description: d("sync_egovframe_catalog", "공식 egovframe-common-components 태그·commit·아카이브 무결성을 검증하고, 고정 카탈로그 대비 upstream 변경과 sec.security 보안 패키지를 점검합니다."), inputSchema: {
      ref: z.string().optional().describe("확인할 태그·브랜치·commit. 미지정 시 카탈로그의 공식 고정 태그 사용"),
    }, annotations: toolAnnotations("sync_egovframe_catalog") },
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

  server.registerTool(
    "sync_egovframe_templates",
    { title: t("sync_egovframe_templates"), description: d("sync_egovframe_templates", "공식 프로젝트 템플릿 통합 카탈로그(Initializr·MCP·Development)를 upstream 과 대조해 추가·삭제·변경과 MCP 커버리지 격차를 보고하고, 동봉한 5.x 전환 규칙·의존성 기준 카탈로그의 drift(egovframe-runtime·공통컴포넌트의 새 태그, 공식 parent 의 새 버전, 고정 pom sha256 변화)도 함께 보고합니다. 파일은 고치지 않습니다."), inputSchema: {
      ref: z.string().optional().describe("확인할 Initializr 저장소의 브랜치·태그·commit. 미지정 시 고정 카탈로그의 branch 사용"),
    }, annotations: toolAnnotations("sync_egovframe_templates") },
    async (args) => {
      enforceAllowedRoots(args);
      const result = await syncTemplateCatalog(args as { ref?: string });
      const driftLines =
        result.drift.length === 0
          ? ["- 차이: 없음"]
          : result.drift.map((entry) =>
              entry.kind === "changed"
                ? `- 변경: ${entry.id} (${entry.fields?.join(", ")})`
                : entry.kind === "added"
                  ? `- 추가: ${entry.id}`
                  : `- 삭제: ${entry.id}`,
            );
      const text = [
        result.upToDate
          ? "✅ 템플릿 카탈로그가 upstream 과 일치합니다."
          : "⚠️ 템플릿 카탈로그와 upstream 사이에 차이가 있습니다.",
        `- 출처: ${result.repository}/${result.path} @ ${result.requestedRef}`,
        `- 고정 sha256: ${result.pinnedSha256 ?? "없음"}`,
        `- upstream sha256: ${result.upstreamSha256}`,
        `- 프로젝트 수: 고정 ${result.pinnedProjects} / upstream ${result.upstreamProjects}`,
        ...driftLines,
        `- MCP 커버리지: ${result.coverage.coveredByMcp}/${result.coverage.initializrProjects} (미커버 ${result.coverage.uncovered}종, MCP 단독 ${result.coverage.mcpOnly}종)`,
        ...(result.uncovered.length > 0
          ? [`- 미커버 목록: ${result.uncovered.map((project) => `${project.id}(${project.category})`).join(", ")}`]
          : []),
        `- zip 조달 템플릿 지문: ${result.archivesChecked}종 대조, 차이 ${result.archiveDrift.length}건`,
        `- 동봉 설정 템플릿: ${result.configTemplates.checked}개 대조(commit ${result.configTemplates.commit.slice(0, 12)}), 차이 ${result.configTemplates.drift.length}건`,
        ...result.configTemplates.drift.map((d) => (d.error ? `  - ${d.file}: 확인 실패 (${d.error})` : `  - ${d.file}: ${d.pinnedSha256.slice(0, 12)}… → ${d.upstreamSha256}`)),
        ...result.archiveDrift.map((d) =>
          d.error
            ? `  - ${d.template}: 확인 실패 (${d.error})`
            : `  - ${d.template}: sha256 ${d.pinnedSha256.slice(0, 12)}… → ${d.upstreamSha256} (${d.pinnedBytes} → ${d.upstreamBytes} bytes)`,
        ),
        ...result.warnings.map((warning) => `- 경고: ${warning}`),
        ...(result.catalogs ? ["", "규칙·의존성 기준 카탈로그 drift:", ...renderCatalogDriftLines(result.catalogs)] : []),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "list_egovframe_components",
    { title: t("list_egovframe_components"), description: d("list_egovframe_components", "선택 설치를 지원하는 공통컴포넌트 카탈로그를 반환합니다 (저장소 스캔으로 자동 생성, scripts/generate-catalog.mjs)."), inputSchema: {}, annotations: toolAnnotations("list_egovframe_components") },
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

  server.registerTool(
    "add_egovframe_components",
    { title: t("add_egovframe_components"), description: d("add_egovframe_components", "공통컴포넌트를 골라 기존 프로젝트에 조립합니다. 의존 컴포넌트를 포함해 소스·매퍼·JSP를 복사하고, " +
      "database 지정 시 DB DDL·DML 스크립트도 복사합니다. 기존 파일과 충돌하면 아무것도 쓰지 않고 거부합니다. " +
      "dryRun=true로 먼저 미리볼 수 있습니다."), inputSchema: {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장). 먼저 create_egovframe_project로 생성"),
      components: z.array(z.string()).min(1).describe("컴포넌트 id 목록. 예: [\"bbs\", \"login\"]"),
      includeDependencies: z.boolean().default(true).describe("의존 컴포넌트 자동 포함 여부"),
      database: z.enum(ECC_DB_TYPES).optional().describe("DB 스크립트 복사 대상 DB (altibase|cubrid|goldilocks|maria|mysql|oracle|postgres|tibero)"),
      dryRun: z.boolean().default(false).describe("true면 복사 없이 설치 순서·규모만 미리보기(네트워크 불필요)"),
    }, annotations: toolAnnotations("add_egovframe_components") },
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

  server.registerTool(
    "search_egovframe_components",
    { title: t("search_egovframe_components"), description: d("search_egovframe_components", "키워드로 공통컴포넌트를 검색합니다 (id·이름·설명·카테고리 부분 일치, 점수순 상위 10건)."), inputSchema: {
      query: z.string().describe("검색어. 예: 게시판, bbs, 로그인"),
      category: z.string().optional().describe("카테고리 필터 (cmm|cop|uss|sym|sec|utl|dam|ext|ssi|sts|uat)"),
    }, annotations: toolAnnotations("search_egovframe_components") },
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

  server.registerTool(
    "remove_egovframe_components",
    { title: t("remove_egovframe_components"), description: d("remove_egovframe_components", "add_egovframe_components로 조립한 컴포넌트를 제거합니다. 설치 매니페스트에 기록된 파일만 삭제하며, " +
      "다른 설치 컴포넌트가 의존하거나 설치 시점 hash와 달라진 파일은 기본 거부합니다. " +
      "force=true는 remove-backup/에 사본을 만든 뒤 트랜잭션 제거하며, dryRun 미리보기를 지원합니다."), inputSchema: {
      projectDir: z.string().describe("대상 프로젝트 디렉터리"),
      components: z.array(z.string()).min(1).describe("제거할 컴포넌트 id 목록"),
      dryRun: z.boolean().default(false).describe("true면 삭제 없이 대상만 미리보기"),
      force: z.boolean().default(false).describe("사용자 수정·hash 미검증 파일도 remove-backup/에 백업한 뒤 제거"),
    }, annotations: toolAnnotations("remove_egovframe_components") },
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

  server.registerTool(
    "validate_egovframe_project",
    { title: t("validate_egovframe_project"), description: d("validate_egovframe_project", "조립된 프로젝트의 무결성을 진단합니다: 설치 매니페스트 기준 파일 존재 확인, Globals.DbType과 복사된 DB 스크립트 일치 확인."), inputSchema: {
      projectDir: z.string().describe("검증할 프로젝트 디렉터리"),
    }, outputSchema: OUTPUT_SCHEMAS.validate_egovframe_project.shape, annotations: toolAnnotations("validate_egovframe_project") },
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
      return { content: [{ type: "text", text }], structuredContent: r as unknown as Record<string, unknown> };
    },
  );

  server.registerTool(
    "get_egovframe_guide",
    { title: t("get_egovframe_guide"), description: d("get_egovframe_guide", "컴포넌트의 공식 가이드 문서(표준프레임워크 포털 egovframe-docs)를 가져옵니다. " +
      "문서가 여러 건이면 목록을 함께 반환하며 docIndex로 선택할 수 있습니다."), inputSchema: {
      component: z.string().describe("컴포넌트 id. 예: bbs, login, cop.cmy"),
      docIndex: z.number().int().min(0).default(0).describe("문서가 여러 건일 때 선택 (0부터, 기본 0)"),
    }, annotations: toolAnnotations("get_egovframe_guide") },
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


  server.registerTool(
    "add_ai_components",
    { title: t("add_ai_components"), description: d("add_ai_components", "공식 egovframe-ai-rag 샘플 기반 AI RAG 챗봇(문서 업로드→임베딩→하이브리드 검색→LLM 응답)을 기존 Boot 프로젝트에 조립합니다. " +
      "소스·설정(application-ai.yml 프로필)·UI·인프라를 복사하고 pom에 누락 의존성만 마커 구간으로 삽입합니다(백업 생성, 제거 시 원복). " +
      "기존 파일과 충돌하면 아무것도 쓰지 않고 거부합니다. dryRun=true로 먼저 미리볼 수 있습니다."), inputSchema: {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장). egovframe-boot-starter-parent 기반 Boot 프로젝트"),
      stack: z.enum(AI_STACKS).describe("AI 스택: spring-ai(Redis Stack) | langchain4j(PGVector). 상호 배타"),
      includeInfra: z.boolean().default(true).describe("docker-compose.ai.yml·Dockerfile.ai·k8s/ai 복사"),
      includeUi: z.boolean().default(true).describe("채팅 UI(chat.html·static) 복사"),
      includeTests: z.boolean().default(false).describe("샘플 테스트 복사"),
      ref: z.string().optional().describe("egovframe-ai-rag 브랜치/태그 (기본: 카탈로그 기준 브랜치)"),
      dryRun: z.boolean().default(false).describe("true면 복사·병합 없이 계획만 미리보기(네트워크 불필요)"),
    }, annotations: toolAnnotations("add_ai_components") },
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
  server.registerTool(
    "list_egovframe_recipes",
    { title: t("list_egovframe_recipes"), description: d("list_egovframe_recipes", "큐레이션된 레시피(템플릿+컴포넌트 번들) 목록을 반환합니다. apply_egovframe_recipe로 한 번에 조립할 수 있습니다."), inputSchema: {}, annotations: toolAnnotations("list_egovframe_recipes") },
        async () => ({
      content: [{ type: "text", text: JSON.stringify({ recipes: loadRecipes() }, null, 2) }],
    }),
  );

  server.registerTool(
    "apply_egovframe_recipe",
    { title: t("apply_egovframe_recipe"), description: d("apply_egovframe_recipe", "레시피 하나를 골라 프로젝트 생성 → 공통컴포넌트(필요 시 AI 계층) 조립까지 순차 실행합니다. dryRun=true로 전체 계획을 먼저 미리볼 수 있습니다."), inputSchema: {
      recipeId: z.string().describe("list_egovframe_recipes의 id. 예: board-login"),
      projectName: z.string().describe("프로젝트명(artifactId). 소문자·숫자·하이픈"),
      groupId: z.string().default("egovframework.example").describe("자바 groupId"),
      outputDir: z.string().describe("생성할 상위 디렉터리(절대경로 권장)"),
      database: z.enum(ECC_DB_TYPES).optional().describe("DB 스크립트 대상(미지정 시 레시피 기본값)"),
      dryRun: z.boolean().default(false).describe("true면 디스크 변경 없이 전체 계획만 미리보기"),
    }, annotations: toolAnnotations("apply_egovframe_recipe") },
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
  server.registerTool(
    "diagnose_egovframe_project",
    { title: t("diagnose_egovframe_project"), description: d("diagnose_egovframe_project", "기존(스캐폴딩 도구로 만들지 않은 것 포함) 전자정부 표준프레임워크 프로젝트를 스캔해 빌드시스템·RTE 버전·DbType·설치된 공통컴포넌트(카탈로그 pathPrefixes 지문)·설정 문제를 진단합니다. 디스크를 변경하지 않는 읽기 전용입니다."), inputSchema: {
      projectDir: z.string().describe("진단할 프로젝트 디렉터리(절대경로 권장)"),
    }, outputSchema: OUTPUT_SCHEMAS.diagnose_egovframe_project.shape, annotations: toolAnnotations("diagnose_egovframe_project") },
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
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: r as unknown as Record<string, unknown> };
    },
  );
  // ── 5.x 전환 진단 도구 (v0.29.0, 1단계 읽기 전용) ──────
  server.registerTool(
    "migrate_egovframe_project",
    { title: t("migrate_egovframe_project"), description: d("migrate_egovframe_project", "표준프레임워크 3.x/4.x 프로젝트를 5.x(Jakarta EE 9+, Spring 6, Java 17) 로 옮기기 위해 바꿔야 할 것을 파일·라인 단위로 진단하고(1단계), apply=true 이면 auto 항목을 실제로 치환합니다(2단계). 진단: RTE Maven 좌표(egovframework.rte → org.egovframe.rte:egovframe-rte-*)·패키지(egovframework.rte.* → org.egovframe.rte.*)·5.x 에서 이름이 바뀌거나 제거된 클래스·javax→jakarta 패키지와 의존성·web.xml 스키마·제거된 egov-* XML 네임스페이스·교체 필요 라이브러리, 항목마다 auto(기계 치환 가능)/manual(코드 수정 필요). 적용: apply=true 는 dryRun=true(기본)면 파일별 변경 미리보기만 돌려주고, dryRun=false 면 auto 항목을 하나의 transaction 으로 치환하며 원본을 migration-backup/<시각>/ 에 보관하고 migration-plan.json 을 남깁니다(중간 실패 시 작업 전 상태로 복구). manual 항목은 건드리지 않고 결과에 남깁니다. verify=true 는 3단계(검증): 적용 뒤 compile 을 실행해 컴파일 오류를 수동 항목과 연결하고 \"이 항목을 처리하면 해결될 오류 수\" 순으로 작업 목록을 만듭니다. 3.x 공통컴포넌트 소스가 섞여 있으면 컴포넌트 단위 재조립 권고를 내고 skipComponents 로 치환에서 뺄 수 있습니다. 규칙은 egovframe-runtime·egovframe-common-components 태그 비교로 만든 동봉 카탈로그(catalog/migration-rules.json)에서 읽습니다."), inputSchema: {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장)"),
      target: z.enum(["5.x"]).default("5.x").describe("전환 목표 (현재 5.x 만 지원)"),
      format: z.enum(["markdown", "json"]).default("markdown").describe("출력 형식. markdown=사람이 읽는 요약, json=항목 배열 그대로"),
      apply: z.boolean().default(false).describe("true 면 2단계(적용). false(기본)면 진단만"),
      dryRun: z.boolean().default(true).describe("apply=true 일 때만 의미. true(기본)면 파일별 변경 미리보기만, false 면 실제로 치환(백업 생성)"),
      verify: z.boolean().default(false).describe("true 면 3단계(검증): 진단 후 compile 을 실행해 컴파일 오류를 수동 항목과 연결한 작업 목록을 반환(apply 와 함께 쓰지 않음, 빌드 도구 필요)"),
      skipComponents: z.boolean().default(false).describe("true 면 3.x 공통컴포넌트 디렉터리(재조립 권고 대상)의 자동 항목을 치환하지 않고 수동으로 남김"),
    }, outputSchema: OUTPUT_SCHEMAS.migrate_egovframe_project.shape, annotations: toolAnnotations("migrate_egovframe_project") },
    async (args) => {
      enforceAllowedRoots(args);
      if (args.verify) {
        const r = await verifyMigration({ projectDir: args.projectDir, target: args.target, skipComponents: args.skipComponents });
        const text = args.format === "json" ? JSON.stringify(stripEdits(r), null, 2) : renderMigrationVerifyMarkdown(r);
        return { content: [{ type: "text", text }], structuredContent: stripEdits(r) };
      }
      if (args.apply) {
        const r = await applyMigration({ projectDir: args.projectDir, target: args.target, dryRun: args.dryRun, skipComponents: args.skipComponents });
        const text = args.format === "json" ? JSON.stringify(r, null, 2) : renderMigrationApplyMarkdown(r);
        return { content: [{ type: "text", text }], structuredContent: stripEdits(r) };
      }
      const r = migrateProject({ projectDir: args.projectDir, target: args.target, skipComponents: args.skipComponents });
      const text = args.format === "json" ? JSON.stringify(r, null, 2) : renderMigrationMarkdown(r);
      return { content: [{ type: "text", text }], structuredContent: stripEdits(r) };
    },
  );
  // ── 의존성 점검 도구 (v0.30.0, 읽기 전용) ──────────────
  server.registerTool(
    "check_egovframe_dependencies",
    { title: t("check_egovframe_dependencies"), description: d("check_egovframe_dependencies", "프로젝트의 Maven/Gradle 의존성(resolve=true 면 빌드 도구로 해석한 전이 의존성까지, 트리 경로와 선언·해석 버전 차이 포함)을 공식 5.x parent(egovframe-web-config-parent·egovframe-boot-starter-parent)가 관리하는 기준 버전, Spring Boot BOM 전체(spring-boot-dependencies + import 한 단계), RTE 모듈 18종의 전이 의존성과 대조해 기준 충족/기준 미만/parent 관리/전환 대상(3.x·4.x RTE, javax 좌표)/교체 필요(DBCP 1.x·Log4j 1.x·Jackson 1·Ehcache 2 등)/벤더 배포(국내 DBMS·GPKI 등)/기준 없음 으로 분류하고 항목마다 기준 출처(parent 직접·계열·Boot BOM·RTE 전이)를 적으며, 5.x parent 사용 여부와 Java 버전, 보안 설정 존재 여부(sec.security 컴포넌트·CSRF·XSS 필터·보안 헤더·HTTPS 저장소)를 파일·라인 근거와 함께 보고합니다. 기본은 오프라인(동봉 기준 catalog/dependency-baseline.json)이며 offline=false 일 때만 OSV(api.osv.dev)로 알려진 취약점을 조회합니다. 디스크를 변경하지 않습니다."), inputSchema: {
      projectDir: z.string().describe("점검할 프로젝트 디렉터리(절대경로 권장)"),
      offline: z.boolean().default(true).describe("true(기본)면 네트워크 없이 기준 대조만, false 면 OSV 취약점 조회 추가"),
      resolve: z.boolean().default(false).describe("true 면 빌드 도구(Maven dependency:tree / Gradle dependencies)로 전이 의존성까지 해석해 함께 판정(빌드 도구·저장소 접근 필요, 수십 초)"),
      resolveScope: z.enum(["runtime", "all"]).default("runtime").describe("resolve 범위: runtime(compile+runtime, 기본) | all(test·provided 포함)"),
      resolveTimeoutMs: z.number().int().min(10_000).max(1_800_000).default(300_000).describe("해석 명령 타임아웃(ms)"),
      format: z.enum(["markdown", "json"]).default("markdown").describe("출력 형식"),
    }, outputSchema: OUTPUT_SCHEMAS.check_egovframe_dependencies.shape, annotations: toolAnnotations("check_egovframe_dependencies") },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await checkDependencies({ projectDir: args.projectDir, offline: args.offline, resolve: args.resolve, resolveScope: args.resolveScope, resolveTimeoutMs: args.resolveTimeoutMs });
      const text = args.format === "json" ? JSON.stringify(r, null, 2) : renderDependencyMarkdown(r);
      return { content: [{ type: "text", text }], structuredContent: r as unknown as Record<string, unknown> };
    },
  );
  // ── 네트워크 진단 도구 (v0.31.0) ──────────────────────
  server.registerTool(
    "diagnose_egovframe_network",
    { title: t("diagnose_egovframe_network"), description: d("diagnose_egovframe_network", "이 서버의 도구들이 내려받는 외부 호스트(codeload.github.com·raw.githubusercontent.com·media.githubusercontent.com·maven.egovframe.go.kr·repo1.maven.org·registry.npmjs.org·api.osv.dev)에 DNS 조회와 HEAD 요청을 실제로 보내 접속 가능 여부·소요 시간·실패 종류(DNS·타임아웃·TLS·프록시 인증·거부)를 보고하고, 환경에 맞는 처방(HTTPS_PROXY+NODE_USE_ENV_PROXY=1, NODE_OPTIONS=--dns-result-order=ipv4first, NODE_EXTRA_CA_CERTS)을 bash/cmd/PowerShell 명령으로 안내합니다. 프로젝트 생성·컴포넌트 조립이 타임아웃으로 실패할 때 먼저 실행하세요. 파일을 쓰지 않으며 프로젝트 디렉터리도 필요 없습니다."), inputSchema: {
      hosts: z.array(z.enum(NETWORK_HOSTS.map((h) => h.host) as [string, ...string[]])).optional().describe("점검할 호스트(기본: 전부)"),
      timeoutMs: z.number().int().min(1000).max(60_000).default(10_000).describe("호스트당 제한 시간(ms, 기본 10000)"),
      format: z.enum(["markdown", "json"]).default("markdown").describe("출력 형식"),
    }, outputSchema: OUTPUT_SCHEMAS.diagnose_egovframe_network.shape, annotations: toolAnnotations("diagnose_egovframe_network") },
    async (args) => {
      const r = await diagnoseNetwork({ hosts: args.hosts, timeoutMs: args.timeoutMs });
      const text = args.format === "json" ? JSON.stringify(r, null, 2) : renderNetworkMarkdown(r);
      return { content: [{ type: "text", text }], structuredContent: r as unknown as Record<string, unknown> };
    },
  );
  // ── AGENTS.md 생성 도구 (v0.31.0) ─────────────────────
  server.registerTool(
    "generate_agents_md",
    { title: t("generate_agents_md"), description: d("generate_agents_md", "프로젝트를 진단해 AI 코딩 도구(Claude Code·Copilot·Cursor 등)용 AGENTS.md 를 생성합니다 — 빌드·테스트 명령(래퍼 감지), RTE 버전과 5.x 전환 상태, DbType, 기본 패키지·설정 디렉터리, 설치 공통컴포넌트(매니페스트 관리 여부), 지켜야 할 규칙(좌표·백업 디렉터리·비밀 정보·의존성 기준), 사용할 수 있는 MCP 도구. 기존 파일은 overwrite=true 가 아니면 거부하고, dryRun=true 면 내용만 돌려줍니다. 한국어(기본)·영어."), inputSchema: {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장)"),
      fileName: z.string().regex(/^[A-Za-z0-9_.-]{1,64}\.md$/).default("AGENTS.md").describe("파일명(프로젝트 루트 기준, 기본 AGENTS.md — CLAUDE.md 등으로 바꿀 수 있음)"),
      lang: z.enum(["ko", "en"]).default("ko").describe("문서 언어"),
      overwrite: z.boolean().default(false).describe("기존 파일 덮어쓰기(transaction, 실패 시 원복)"),
      dryRun: z.boolean().default(false).describe("true 면 파일을 쓰지 않고 내용만 반환"),
    }, annotations: toolAnnotations("generate_agents_md") },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await generateAgentsMd({ projectDir: args.projectDir, fileName: args.fileName, lang: args.lang, overwrite: args.overwrite, dryRun: args.dryRun });
      const head = r.dryRun ? `📝 dryRun — ${r.fileName} 미리보기 (기록 없음)` : `✅ ${r.filePath} ${r.overwritten ? "덮어씀" : "생성"}`;
      return { content: [{ type: "text", text: `${head}\n\n${r.content}` }] };
    },
  );

  server.registerTool(
    "generate_egovframe_sbom",
    { title: t("generate_egovframe_sbom"), description: d("generate_egovframe_sbom", "Maven/Gradle 프로젝트의 SBOM 을 CycloneDX 1.6 JSON 으로 만듭니다(빌드 파일 변경 없음). Maven 은 cyclonedx-maven-plugin(makeAggregateBom, 해시·라이선스 포함), Gradle 은 해석된 의존성 트리로 문서를 구성합니다. enrich=true(기본)면 component 마다 기준 판정(egovframe:status·basis·baseline)을 properties 로 붙이고, offline=false 면 OSV 로 알려진 취약점을 vulnerabilities[] 로 넣습니다. 출력은 프로젝트 안 경로(기본 sbom/bom.cdx.json)만 허용하고 기존 파일은 overwrite=true 가 아니면 거부하며, dryRun(기본)은 실행 없이 계획만 돌려줍니다. 2027년부터 단계화되는 공공기관 SBOM 등록·제출에 쓸 수 있는 표준 형식입니다."), inputSchema: {
      projectDir: z.string().describe("프로젝트 디렉터리(절대경로 권장)"),
      outputPath: z.string().default("sbom/bom.cdx.json").describe("프로젝트 상대 출력 경로"),
      bomFormat: z.enum(["cyclonedx-json"]).default("cyclonedx-json").describe("SBOM 형식(현재 CycloneDX JSON)"),
      scope: z.enum(["runtime", "all"]).default("runtime").describe("runtime(compile+runtime, 기본) | all(test·provided 포함)"),
      enrich: z.boolean().default(true).describe("component 마다 기준 판정 속성 부착"),
      offline: z.boolean().default(true).describe("false 면 OSV 조회 결과를 vulnerabilities[] 로 포함"),
      overwrite: z.boolean().default(false).describe("기존 출력 파일 덮어쓰기 허용"),
      dryRun: z.boolean().default(true).describe("true(기본)면 실행 없이 명령·출력 경로만 보고"),
      timeoutMs: z.number().int().min(10_000).max(1_800_000).default(600_000).describe("생성 명령 타임아웃(ms)"),
      format: z.enum(["markdown", "json"]).default("markdown").describe("응답 형식"),
    }, outputSchema: OUTPUT_SCHEMAS.generate_egovframe_sbom.shape, annotations: toolAnnotations("generate_egovframe_sbom") },
    async (args) => {
      enforceAllowedRoots(args);
      const r = await generateSbom({ projectDir: args.projectDir, outputPath: args.outputPath, format: args.bomFormat, scope: args.scope, enrich: args.enrich, offline: args.offline, overwrite: args.overwrite, dryRun: args.dryRun, timeoutMs: args.timeoutMs });
      const { bom: _bom, ...structured } = r; // 문서 전체는 파일에 있으므로 구조화 출력에서 제외
      const text = args.format === "json" ? JSON.stringify(structured, null, 2) : renderSbomMarkdown(r);
      return { content: [{ type: "text", text }], structuredContent: structured as unknown as Record<string, unknown> };
    },
  );
  // ── 문서 검색 도구 (v0.15.0) ───────────────────────────
  server.registerTool(
    "search_egovframe_docs",
    { title: t("search_egovframe_docs"), description: d("search_egovframe_docs", "공식 가이드 문서(egovframe-docs) 인덱스를 키워드로 검색합니다. 기본은 오프라인 인덱스 검색(제목·경로·연계 컴포넌트·카테고리 점수순)이며, fetchTop>0이면 상위 결과의 문서 본문을 내려받아 스니펫도 함께 제공합니다."), inputSchema: {
      query: z.string().describe("검색어. 예: \"로그인\", \"게시판 권한\""),
      limit: z.number().int().min(1).max(30).default(10).describe("최대 결과 수 (기본 10)"),
      fetchTop: z.number().int().min(0).max(5).default(0).describe("본문을 내려받아 스니펫을 붙일 상위 결과 수 (0=오프라인, 최대 5)"),
    }, annotations: toolAnnotations("search_egovframe_docs") },
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
  server.registerTool(
    "generate_egovframe_report",
    { title: t("generate_egovframe_report"), description: d("generate_egovframe_report", "프로젝트를 스캔해 설치 공통컴포넌트·참조 테이블·가이드 문서 링크·이슈를 Markdown 리포트로 생성합니다. (읽기 전용) 조립 결과 문서화나 README 첨부에 적합합니다."), inputSchema: {
      projectDir: z.string().describe("리포트를 만들 프로젝트 디렉터리(절대경로 권장)"),
    }, annotations: toolAnnotations("generate_egovframe_report") },
    async (args) => {
      enforceAllowedRoots(args);
      return {
        content: [{ type: "text", text: generateReport({ projectDir: args.projectDir }) }],
      };
    },
  );
  // ── 업그레이드 도구 (v0.17.0) ──────────────────────────
  server.registerTool(
    "upgrade_egovframe_project",
    { title: t("upgrade_egovframe_project"), description: d("upgrade_egovframe_project", "매니페스트에 기록된 설치 공통컴포넌트를 upstream 최신본과 비교해 갱신합니다. 사용자가 수정한 파일은 force 없이는 보존하며, dryRun(기본)으로 변경 계획을 먼저 확인합니다. 덮어쓰기 전 upgrade-backup/에 백업하고, 하드 충돌 시 아무것도 쓰지 않고 거부합니다."), inputSchema: {
      projectDir: z.string().describe("업그레이드할 프로젝트 디렉터리(절대경로 권장)"),
      components: z.array(z.string()).optional().describe("대상 컴포넌트 id (미지정 시 매니페스트 전체)"),
      dryRun: z.boolean().default(true).describe("true(기본)면 계획만 미리보기, 디스크 변경 없음"),
      force: z.boolean().default(false).describe("사용자 수정 파일(충돌)도 백업 후 덮어쓸지"),
    }, annotations: toolAnnotations("upgrade_egovframe_project") },
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
  server.registerTool(
    "explain_egovframe_component",
    { title: t("explain_egovframe_component"), description: d("explain_egovframe_component", "공통컴포넌트 하나의 상세(설명·직접/전이 의존성·이 컴포넌트에 의존하는 컴포넌트·참조 테이블·가이드 문서 링크·설치 명령)를 한 번에 반환합니다. (읽기 전용)"), inputSchema: {
      id: z.string().describe("컴포넌트 id. 예: bbs"),
    }, annotations: toolAnnotations("explain_egovframe_component") },
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
  // ── 설정 파일 생성 도구 (v0.28.0) ────────────────────────
  server.registerTool(
    "generate_egovframe_config",
    { title: t("generate_egovframe_config"), description: d("generate_egovframe_config", "공식 eGovFrame Initializr 설정 템플릿(21종, 오프라인 동봉)으로 Spring 설정 파일을 생성합니다 — datasource(DBCP/C3P0/JDBC·JNDI), transaction(datasource/JPA/JTA), cache(Ehcache), logging(log4j2 console/file/rolling/time-rolling/jdbc), scheduling(Quartz job/trigger/scheduler), idGeneration(sequence/table/uuid), property. " +
      "형식은 xml(Spring XML)·javaConfig(@Configuration 클래스)·yaml·properties(logging 만). 필드를 생략하면 Initializr 웹뷰 폼과 같은 기본값을 쓰고, 기존 파일이 있으면 덮어쓰지 않고 거부합니다. " +
      "템플릿별 필드·기본값·선택지는 리소스 egovframe://catalog/config-templates 에서 확인하거나 dryRun 결과의 context 로 볼 수 있습니다."), inputSchema: {
      projectDir: z.string().describe("대상 프로젝트 디렉터리(절대경로 권장)"),
      configId: z.enum(loadConfigCatalog().entries.map((e) => e.id) as [string, ...string[]]).describe("설정 템플릿 id (예: datasource, transaction-datasource, logging-rolling-file, scheduling-cron-trigger)"),
      format: z.enum(CONFIG_FORMATS).default("xml").describe("xml | javaConfig | yaml | properties (yaml·properties 는 logging 계열만)"),
      fields: z.record(z.union([z.string(), z.boolean()])).optional().describe("템플릿 변수 덮어쓰기 (예: { txtDatasourceName: 'dataSource', rdoType: 'DBCP', txtUrl: 'jdbc:mysql://…', txtConfigPackage: 'kr.go.sample.config' }). 템플릿에 없는 필드는 거부"),
      fileName: z.string().optional().describe("파일명(확장자 제외) 또는 JavaConfig 클래스명. 미지정 시 Initializr 기본값(예: context-datasource, EgovDataSourceConfig)"),
      outputDir: z.string().optional().describe("프로젝트 상대 출력 디렉터리. 미지정 시 xml→src/main/resources/egovframework/spring(logging 은 src/main/resources), javaConfig→src/main/java/<패키지>"),
      dryRun: z.boolean().default(false).describe("true면 파일을 쓰지 않고 내용·경로·컨텍스트만 반환"),
    }, annotations: toolAnnotations("generate_egovframe_config") },
    async (args) => {
      enforceAllowedRoots(args);
      const r = generateConfig({
        projectDir: args.projectDir,
        configId: args.configId,
        format: args.format,
        fields: args.fields,
        fileName: args.fileName,
        outputDir: args.outputDir,
        dryRun: args.dryRun,
      });
      const head = r.dryRun ? `🔍 설정 미리보기(dryRun): ${r.path}` : `✅ 설정 파일 생성: ${r.path}`;
      const lang = r.format === "javaConfig" ? "java" : r.format;
      const text = [
        head,
        `- 템플릿: ${r.configId} (${r.format})`,
        `- 덮어쓴 필드: ${r.overridden.length ? r.overridden.join(", ") : "없음(기본값)"}`,
        `- 컨텍스트: ${JSON.stringify(r.context)}`,
        "",
        `\`\`\`${lang}`,
        r.content.trimEnd(),
        "\`\`\`",
        "",
        "다음 단계: 템플릿 본문 주석의 의존성(pom.xml/gradle)을 프로젝트에 추가하고, XML 은 web.xml/애플리케이션 컨텍스트 로딩 경로에 포함하세요.",
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.resource(
    "config-templates-catalog",
    "egovframe://catalog/config-templates",
    { mimeType: "application/json", description: "설정 템플릿 카탈로그 — id·형식·필드·기본값·선택지 (generate_egovframe_config 용)" },
    async (uri) => {
      const catalog = loadConfigCatalog();
      const text = JSON.stringify({ source: catalog.source, outputDirs: catalog.outputDirs, templates: describeConfigTemplates() }, null, 2);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    },
  );

  server.resource(
    "migration-rules",
    "egovframe://catalog/migration-rules",
    { mimeType: "application/json", description: "3.x/4.x → 5.x 전환 규칙 — RTE 좌표 대응표·패키지 변경·제거 클래스·javax→jakarta·라이브러리 (migrate_egovframe_project 용; 5.x 클래스 전체 목록은 제외)" },
    async (uri) => {
      const { evidence, ...rest } = loadMigrationRules();
      const text = JSON.stringify({ ...rest, evidence: { classes: evidence.classes } }, null, 2);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    },
  );

  server.resource(
    "dependency-baseline",
    "egovframe://catalog/dependency-baseline",
    { mimeType: "application/json", description: "의존성 기준 버전 — 공식 5.x parent 의 properties·dependencyManagement + Spring Boot BOM 전체 + RTE 모듈 전이 의존성 (check_egovframe_dependencies 용)" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(loadDependencyBaseline(), null, 2) }] }),
  );

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
  server.registerTool(
    "generate_egovframe_crud",
    { title: t("generate_egovframe_crud"), description: d("generate_egovframe_crud", "eGovFrame Development의 공식 CRUD wizard 입력 체계에 맞춰 VO·Mapper(XML)·Service·Controller·JSP(선택)·JUnit 5 테스트(선택) 골격을 생성합니다. Classic XML과 Boot REST 프로필을 지원하며, 전체 파일 충돌을 먼저 검사해 하나라도 존재하면 아무것도 쓰지 않습니다."), inputSchema: {
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
    }, annotations: toolAnnotations("generate_egovframe_crud") },
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
  server.registerTool(
    "generate_egovframe_ci",
    { title: t("generate_egovframe_ci"), description: d("generate_egovframe_ci", "프로젝트에 GitHub Actions CI 워크플로(빌드·테스트)를 생성합니다. 빌드도구(maven/gradle) 자동 감지, JDK 지정. dryRun으로 내용만 미리볼 수 있고, 실제 생성 시 기존 파일이 있으면 덮어쓰지 않고 거부합니다."), inputSchema: {
      projectDir: z.string().describe("프로젝트 디렉터리(절대경로 권장)"),
      jdk: z.string().regex(CI_JDK_RE, "숫자와 점으로 된 버전만 허용 (예: 17, 21, 1.8)").default("17").describe("JDK 버전 (기본 17, 숫자·점만 허용)"),
      dryRun: z.boolean().default(false).describe("true면 파일 생성 없이 내용만 반환"),
    }, annotations: toolAnnotations("generate_egovframe_ci") },
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
  server.registerTool(
    "build_egovframe_project",
    { title: t("build_egovframe_project"), description: d("build_egovframe_project", "생성한 eGovFrame 프로젝트를 실제로 빌드(컴파일·테스트·패키지)하고 결과를 구조화해 반환합니다. 빌드도구(maven/gradle)와 래퍼(mvnw/gradlew)를 자동 감지하고, 컴파일·테스트 오류를 파일·라인 단위로 파싱합니다. dryRun으로 실행 예정 명령만 미리볼 수 있습니다. (생성→검증 루프 완성)"), inputSchema: {
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
    }, annotations: toolAnnotations("build_egovframe_project") },
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
  server.registerTool(
    "test_egovframe_project",
    { title: t("test_egovframe_project"), description: d("test_egovframe_project", "eGovFrame 프로젝트의 테스트를 실제로 실행하고 JUnit XML 리포트(surefire/gradle)를 읽어 결과를 구조화합니다. 스위트별 통과·실패·오류·건너뜀 수와, 실패 케이스의 메시지·예외 타입·테스트 파일/라인을 반환합니다. testFilter로 특정 클래스/메서드만 실행할 수 있고, dryRun으로 실행 예정 명령을 미리볼 수 있습니다. (build_egovframe_project 의 테스트 후속)"), inputSchema: {
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
    }, annotations: toolAnnotations("test_egovframe_project") },
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
