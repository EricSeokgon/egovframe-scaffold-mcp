#!/usr/bin/env node
/**
 * egovframe-scaffold-mcp — 전자정부 표준프레임워크 프로젝트 스캐폴딩·조립·진단 MCP 서버
 *
 * eGovFramework/egovframe-common-components#1120 제안의 개념 증명 구현입니다.
 *
 * 이 파일은 (1) 실행 진입점(stdio 서버 기동)과 (2) 라이브러리 공개 API 재수출만 담당합니다.
 * 구현은 도메인별 모듈에 있습니다.
 *
 *   server.ts      MCP tools·resources·prompts 등록
 *   project.ts     프로젝트 생성           components.ts  공통컴포넌트 조립·제거
 *   catalog.ts     카탈로그 로드·검색      manifest.ts    설치 매니페스트
 *   ai.ts          AI RAG 계층 조립        recipes.ts     레시피 조립
 *   validate.ts    무결성 진단             diagnose.ts    기존 프로젝트 진단·리포트
 *   upgrade.ts     3-way 업그레이드        explain.ts     컴포넌트 설명
 *   guide.ts       가이드 문서 조회·검색   ci-config.ts   CI 워크플로 생성
 *   crud.ts · catalog-sync.ts · build-runner.ts · test-runner.ts
 *   file-transaction.ts · allowed-roots.ts · shared.ts
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { buildServer } from "./server.js";

// ── 공개 API — 모듈 분리 전과 동일한 표면을 유지한다 ──
export { DOWNLOAD_TIMEOUT_MS, COMPONENTS_DOWNLOAD_TIMEOUT_MS } from "./shared.js";
export { TEMPLATES, GLOBALS_PROPS_REL, DB_TYPES, customizePomCoordinates, createProject } from "./project.js";
export type { CreateOptions, CreateResult } from "./project.js";
export { loadCatalog, resolveComponents, searchComponents } from "./catalog.js";
export type { CatalogComponent, Catalog, SearchResult } from "./catalog.js";
export { MANIFEST_FILE, readManifest } from "./manifest.js";
export type { ManifestEntry, Manifest } from "./manifest.js";
export { AI_STACKS, loadAiCatalog, planAiComponents, findProjectDependenciesClose, AI_POM_BACKUP, addAiComponents, stripAiPomAdditions } from "./ai.js";
export type { AiMavenDependency, AiCopyGroup, AiComponent, AiCatalog, AddAiComponentsOptions, AiPlanResult, AddAiResult } from "./ai.js";
export { ECC_DB_TYPES, addComponents, removeComponents } from "./components.js";
export type { AddComponentsOptions, AddComponentsResult, RemoveOptions, RemoveFileState, RemoveFilePlan, RemoveResult } from "./components.js";
export { resolveConfigPlaceholders, collectAiChecks, validateProject } from "./validate.js";
export type { ValidateResult } from "./validate.js";
export { DOCS_REPO, GUIDE_MAX_CHARS, getGuide, searchDocs } from "./guide.js";
export type { GuideResult, DocHit } from "./guide.js";
export { loadRecipes, applyRecipe } from "./recipes.js";
export type { Recipe, ApplyRecipeOptions, ApplyRecipeResult } from "./recipes.js";
export { diagnoseProject, generateReport } from "./diagnose.js";
export type { DiagnoseResult } from "./diagnose.js";
export { classifyUpgrade, upgradeProject } from "./upgrade.js";
export type { UpgradeClass, UpgradeItem, UpgradeResult, UpgradeOptions } from "./upgrade.js";
export { explainComponent } from "./explain.js";
export type { ComponentExplain } from "./explain.js";
export { CI_JDK_RE, validateCiJdk, generateCiYaml, generateCiConfig } from "./ci-config.js";
export type { CiResult } from "./ci-config.js";
export { SERVER_VERSION, buildServer } from "./server.js";
export { CRUD_JAVA_TYPES, CRUD_PROFILES, generateCrud } from "./crud.js";
export type { CrudFieldInput, GenerateCrudOptions, GenerateCrudResult } from "./crud.js";
export { inspectCatalogArchive, syncCatalog } from "./catalog-sync.js";
export type { ArchiveInspection, CatalogSyncOptions, CatalogSyncResult } from "./catalog-sync.js";
export { ProjectFileTransaction, TransactionError, withDirectoryTransaction, withFileTransaction } from "./file-transaction.js";
export type { RollbackFailure, RollbackReport } from "./file-transaction.js";
export { ALLOWED_ROOTS_ENV, AllowedRootsError, assertPathAllowed, describeAllowedRoots, enforceAllowedRoots, loadAllowedRoots } from "./allowed-roots.js";
export { detectBuildToolAt, resolveGoals, resolveCommand, parseBuildErrors, capOutput, defaultRunner, killProcessTree, KILL_GRACE_MS, runBuild } from "./build-runner.js";
export type { BuildTool, BuildGoal, BuildError, ResolvedCommand, Runner, RunnerResult, BuildRunResult } from "./build-runner.js";
export { reportDirFor, resolveTestArgs, validateTestFilter, locateInStack, parseJUnitXml, snapshotReports, readJUnitReports, summarizeReports, runTests } from "./test-runner.js";
export type { TestOutcome, TestCaseResult, TestSuiteResult, TestSummary, TestRunResult, ParsedReport } from "./test-runner.js";

/**
 * 이 파일이 실행 진입점인지 판정한다.
 *
 * POSIX 에서 npm 은 bin 을 `node_modules/.bin/egovframe-scaffold-mcp → dist/index.js` symlink 로 만들기 때문에
 * `process.argv[1]` 은 symlink 경로(확장자·파일명이 다름)다. 파일명 끝을 비교하면 `npx egovframe-scaffold-mcp`
 * 실행 시 진입점이 아니라고 판단해 서버를 띄우지 않고 조용히 종료하므로, 양쪽 모두 realpath 로 풀어 비교한다.
 */
export function isMainModule(argv1: string | undefined = process.argv[1], moduleUrl: string = import.meta.url): boolean {
  if (!argv1) return false;
  try {
    const entry = fs.realpathSync(argv1);
    const self = fs.realpathSync(fileURLToPath(moduleUrl));
    return process.platform === "win32" ? entry.toLowerCase() === self.toLowerCase() : entry === self;
  } catch {
    return false;
  }
}

const isMain = isMainModule();
if (isMain) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("egovframe-scaffold-mcp: stdio에서 대기 중");
}
