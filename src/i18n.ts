// 도구 설명 언어 (v0.31.0). EGOVFRAME_LANG=en 이면 tools/list 의 description 을 영어로 내보낸다.
// 도구의 응답 본문(진단 결과·리포트)은 한국어 그대로다 — 영문 설명은 도구를 고르는 단계(클라이언트·모델)를 위한 것이다.
export const LANG_ENV = "EGOVFRAME_LANG";
export type ToolLang = "ko" | "en";

export function resolveToolLang(env: NodeJS.ProcessEnv = process.env): ToolLang {
  return (env[LANG_ENV] ?? "").trim().toLowerCase() === "en" ? "en" : "ko";
}

/** 영문 도구 설명 — 한국어 설명의 요약 번역. 모든 도구에 항목이 있어야 한다(test:handshake 가 확인). */
export const TOOL_DESCRIPTIONS_EN: Record<string, string> = {
  list_egovframe_templates: "List the official eGovFrame project templates (22, including Initializr zip-sourced ones) with coverage summary of the unified template catalog.",
  create_egovframe_project: "Create a new eGovFrame project from an official template: downloads the pinned repository/zip archive (sha256-verified for zip templates), applies projectName (artifactId), groupId and database type. Refuses existing directories; dryRun previews.",
  sync_egovframe_catalog: "Verify the bundled common-components catalog against upstream: tag→commit, archive sha256/size/file count, sec.security handling and unmapped upstream paths. Read-only; needs network.",
  sync_egovframe_templates: "Compare the unified template catalog (Initializr, MCP, Development) with upstream: added/removed/changed projects, MCP coverage gaps, pinned zip fingerprints and bundled config template drift. Read-only; needs network.",
  list_egovframe_components: "List installable common components from the pinned official catalog (v5.0.6: 176 leaf + 14 group ids).",
  add_egovframe_components: "Assemble common components into a project: sources, mappers, JSPs, messages, ID generation, scheduling, static assets, Spring/web fragments, Maven coordinate detection and per-component DDL/DML for the database. Archive verified, conflicts rejected as a whole, rollback on write failure, dryRun.",
  search_egovframe_components: "Search common components by keyword (id, name, description; top 10 by score).",
  remove_egovframe_components: "Remove installed components transactionally using the install manifest: protects dependents and user-modified files, dryRun classification, force backs up to remove-backup/ before deleting.",
  validate_egovframe_project: "Validate an assembled project: file presence, DbType vs DB scripts, AI layer prerequisites. Read-only.",
  get_egovframe_guide: "Fetch the official guide document for a component (egovframe-docs, 151 mappings).",
  add_ai_components: "Add an AI RAG chatbot layer from the official egovframe-ai-rag sample: Spring AI (Redis Stack) or LangChain4j (PGVector), sources/config/UI/infra copied, only missing pom dependencies inserted in a marked block (backup kept). Conflicts rejected; dryRun.",
  list_egovframe_recipes: "List curated recipes (template + component bundles).",
  apply_egovframe_recipe: "Apply a recipe end to end (create project → components → optional AI layer) with a single atomic commit to the final path; template-provided base components are preserved. dryRun supported.",
  diagnose_egovframe_project: "Scan an existing project (any origin) for build system, RTE version, DbType, installed common components (path fingerprints) and configuration issues. Read-only.",
  migrate_egovframe_project: "Migrate an eGovFrame 3.x/4.x project to 5.x (Jakarta EE 9+, Spring 6, Java 17). Diagnose (default, read-only): RTE Maven coordinates, package renames, removed/moved classes, javax→jakarta packages and artifacts, web.xml schema, removed egov-* XML namespaces, libraries needing replacement — each item auto/manual with file:line and reason. Apply (apply=true): rewrites auto items in one transaction, dryRun by default, originals kept in migration-backup/, migration-plan.json written, rollback on failure. Verify (verify=true): compiles the project and links compiler errors to manual items, producing a worklist ordered by errors resolved; recommends re-assembling 3.x common-component sources (skipComponents excludes them from rewriting).",
  check_egovframe_dependencies: "Compare project dependencies with the baseline extracted from the official 5.x parents (139 managed coordinates + BOM families): ok / outdated / parent-managed / legacy (3.x, 4.x RTE, javax) / replace (DBCP 1.x, Log4j 1.x, …) / unknown. Also 5.x parent and Java checks and security-config presence checks (sec.security, CSRF, XSS filter, security headers, HTTPS repositories) with file:line evidence. Offline by default; offline=false queries OSV for known vulnerabilities.",
  diagnose_egovframe_network: "Probe the hosts this server downloads from (codeload.github.com, raw/media.githubusercontent.com, maven.egovframe.go.kr, repo1.maven.org, registry.npmjs.org, api.osv.dev) with DNS lookup and HEAD requests; classify failures (DNS, timeout, TLS, proxy auth, refused) and prescribe environment settings (HTTPS_PROXY + NODE_USE_ENV_PROXY=1, NODE_OPTIONS=--dns-result-order=ipv4first, NODE_EXTRA_CA_CERTS) as bash/cmd/PowerShell commands. Run first when downloads time out.",
  generate_agents_md: "Generate AGENTS.md for AI coding tools from project diagnosis: build/test commands (wrapper-aware), RTE version and 5.x migration status, DbType, base packages and config directories, installed components, rules (coordinates, backup dirs, secrets, dependency baseline) and available MCP tools. Refuses existing files unless overwrite=true; dryRun returns content only; ko/en.",
  search_egovframe_docs: "Search the official guide index by keyword (offline; fetchTop>0 downloads snippets).",
  generate_egovframe_report: "Generate a Markdown report of installed components, referenced tables, guide links and issues. Read-only.",
  upgrade_egovframe_project: "Upgrade installed components against upstream with 3-way comparison: preserves user modifications, dryRun by default, re-verifies before applying, single transaction for files, backup and manifest.",
  explain_egovframe_component: "Explain one component: description, direct/transitive dependencies, dependents, tables, guide links and install command. Read-only.",
  generate_egovframe_config: "Generate Spring configuration files from the 21 official Initializr config templates bundled offline (datasource, transaction, cache, logging, scheduling, idGeneration, property) as xml/javaConfig/yaml/properties with Initializr's field names and defaults. Existing files are never overwritten; dryRun.",
  generate_egovframe_crud: "Generate CRUD code following the official Development wizard inputs: VO, Mapper XML, Service, Controller, optional JSP and JUnit 5; Classic/Boot profiles; all conflicts checked before writing.",
  generate_egovframe_ci: "Generate a GitHub Actions CI workflow (build and test) with maven/gradle auto-detection; dryRun; existing files protected.",
  build_egovframe_project: "Build the project (compile/test/package) with maven/gradle or their wrappers; timeout, log cap, compiler errors structured by file/line; dryRun.",
  test_egovframe_project: "Run tests and structure JUnit XML reports (surefire, gradle): per-suite pass/fail/error/skip, failing case messages, exception types and test file/line; testFilter; stale reports excluded; dryRun.",
};

/** 등록 시 쓰는 설명 선택자 — 영문이 없으면 한국어 설명을 그대로 쓴다. */
export function toolDescription(name: string, ko: string, lang: ToolLang = resolveToolLang()): string {
  if (lang === "en") return TOOL_DESCRIPTIONS_EN[name] ?? ko;
  return ko;
}
