# egovframe-scaffold-mcp

[![CI](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/egovframe-scaffold-mcp)](https://www.npmjs.com/package/egovframe-scaffold-mcp)

An **MCP (Model Context Protocol) server** that scaffolds, assembles, diagnoses and migrates projects built on the Korean **eGovFrame** (전자정부 표준프레임워크, the e-Government Standard Framework) — a community proof of concept for [eGovFramework/egovframe-common-components#1120](https://github.com/eGovFramework/egovframe-common-components/issues/1120).

The full documentation, design notes and change log are in Korean: [README.md](README.md). This page is a condensed English overview. Tool **responses** (reports, diagnoses) are in Korean; set `EGOVFRAME_LANG=en` to get English tool **descriptions** in `tools/list` so any MCP client or model can pick tools without reading Korean.

## What it does

From an AI tool that speaks MCP (Claude, VS Code Copilot, Cursor, …) you can, in one conversation:

- create a project from one of the **22 official templates** (repository or Initializr zip, pinned by commit and sha256),
- assemble **common components** (190 catalog entries from the official v5.0.6 release) with sources, mappers, JSPs, messages, Spring/web fragments and per-database DDL/DML,
- generate CRUD code (official Development wizard inputs), Spring configuration (21 official Initializr templates, offline) and a GitHub Actions workflow,
- build and test with Maven/Gradle and get compiler errors and JUnit results structured by file and line,
- diagnose an existing project, **migrate 3.x/4.x code to 5.x (Jakarta EE, Spring 6, Java 17)** — diagnosis first, then transactional apply, then compile-and-link verification —, check dependencies against the official 5.x parents, the full Spring Boot BOM and the RTE transitive versions (optionally with OSV), diagnose network/proxy problems, and generate `AGENTS.md` for AI coding tools.

Every write tool offers `dryRun`, runs inside a file transaction (rollback on failure), never overwrites user files silently, and honours an optional allowed-roots sandbox.

## Install

Published on npm; no installation needed:

```json
{
  "mcpServers": {
    "egovframe-scaffold": {
      "command": "npx",
      "args": ["-y", "egovframe-scaffold-mcp"],
      "env": { "EGOVFRAME_LANG": "en" }
    }
  }
}
```

Requires Node.js 18+. Downloads go to `codeload.github.com`, `raw.githubusercontent.com`, `media.githubusercontent.com` (Git LFS zips) and, for builds, `maven.egovframe.go.kr` and Maven Central. Behind a corporate proxy set `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1` (Node's built-in fetch ignores the proxy otherwise); `diagnose_egovframe_network` tells you exactly what is wrong.

### Environment variables

| Variable | Purpose |
|---|---|
| `EGOVFRAME_ALLOWED_ROOTS` | Optional sandbox: every directory argument (`projectDir`, `outputDir`) must be inside one of these roots (path-separator-delimited, realpath-checked). |
| `EGOVFRAME_LANG` | `en` → English tool descriptions in `tools/list`. Responses stay Korean. |

## Tools (27)

| Tool | What it does |
|---|---|
| `create_egovframe_project` | New project from an official template with projectName/groupId/database applied; zip templates are sha256-verified |
| `list_egovframe_templates` | Official templates and unified-catalog coverage |
| `sync_egovframe_catalog` | Verify the pinned common-components catalog against upstream (tag, commit, archive fingerprint, unmapped paths) |
| `sync_egovframe_templates` | Compare the unified template catalog (Initializr, MCP, Development) with upstream; zip fingerprint and bundled config-template drift; drift of the bundled migration rules and dependency baseline (newer runtime/common-components tags, newer official parents, changed pinned pom sha256) with the update procedure |
| `list_egovframe_components` / `search_egovframe_components` / `explain_egovframe_component` | Browse the component catalog (176 leaf + 14 group ids), search, explain dependencies/tables/guides |
| `add_egovframe_components` | Full assembly of components incl. resources, fragments, Maven coordinates and DB scripts; conflicts rejected as a whole, rollback on failure |
| `remove_egovframe_components` | Transactional removal using the install manifest; protects dependents and user-modified files |
| `upgrade_egovframe_project` | 3-way upgrade of installed components (user changes preserved, dryRun default, backup) |
| `validate_egovframe_project` | Integrity checks (files, DbType vs scripts, AI prerequisites) |
| `add_ai_components` | AI RAG chatbot layer from the official egovframe-ai-rag sample (Spring AI / LangChain4j) |
| `list_egovframe_recipes` / `apply_egovframe_recipe` | Curated bundles: project → components → AI layer with one atomic commit |
| `generate_egovframe_crud` | VO, Mapper XML, Service, Controller, optional JSP and JUnit 5 following the official CRUD wizard |
| `generate_egovframe_config` | Spring configuration from the 21 official Initializr templates (xml/javaConfig/yaml/properties), offline |
| `generate_egovframe_ci` | GitHub Actions workflow (Maven/Gradle auto-detected) |
| `build_egovframe_project` / `test_egovframe_project` | Run builds and tests; compiler errors and JUnit XML structured by file/line |
| `diagnose_egovframe_project` / `generate_egovframe_report` | Scan any existing project; Markdown report |
| `get_egovframe_guide` / `search_egovframe_docs` | Official guide documents (151 mappings) and offline keyword search |
| `migrate_egovframe_project` | **5.x migration**: diagnose RTE coordinates, package/class renames and removals (runtime and common components), javax→jakarta, web.xml, removed XML namespaces, libraries to replace (auto/manual with file:line); `apply=true` rewrites auto items in one transaction with backups; `verify=true` compiles and links compiler errors to the remaining manual items as a prioritised worklist |
| `check_egovframe_dependencies` | Compare dependencies with the official 5.x parent baseline (139 coordinates + BOM families), the full Spring Boot BOM (1,473 coordinates) and the transitive dependencies of the 18 RTE modules (58): ok / outdated / parent-managed / legacy / replace / vendor / unknown, each with the basis it was compared against; security-config presence checks; optional OSV lookup |
| `diagnose_egovframe_network` | Probe the hosts the server downloads from, classify failures (DNS, timeout, TLS, proxy auth) and prescribe environment settings as bash/cmd/PowerShell commands |
| `generate_agents_md` | `AGENTS.md` for AI coding tools: build/test commands, RTE and migration status, components, rules, available MCP tools (ko/en) |

Resources: `egovframe://catalog/components`, `…/components/{id}`, `…/templates`, `…/recipes`, `…/ai-components`, `…/config-templates`, `…/migration-rules`, `…/dependency-baseline`. Prompts: `scaffold_board_login`, `scaffold_ai_chatbot`, `scaffold_portal`, `maintain_existing`.

## How it stays trustworthy

- **Pinned sources**: component catalog (official v5.0.6 tag, commit, archive sha256), Initializr zip templates (commit, sha256, size), config templates (commit, per-file sha256, CRLF-safe), migration rules derived from `egovframe-runtime` tags v3.10.0 / v4.3.0-Final / v5.0.2-Final and `egovframe-common-components` v3.10.0 / v5.0.6, dependency baseline extracted from the official 5.x parent poms (5.0.2), `spring-boot-dependencies` 3.5.6 and the RTE 5.0.2 module poms — every pom with url and sha256. `sync_egovframe_templates` reports when any of these drifts upstream.
- **Release gate**: `npm run prepublishOnly` runs the build and ~25 offline suites (over 1,100 assertions) on ubuntu and windows × Node 18/20/22; an integration job downloads real upstream assets, compiles generated CRUD and a migrated 3.10 project with JDK 17, and checks that every migration target coordinate exists in the Maven repositories.
- **Protocol metadata**: every tool carries ko/en `title` and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`); the five diagnostic tools also declare `outputSchema` and return `structuredContent`.
- **Safety**: transactions with structured rollback reports, `dryRun` everywhere, allowed roots with realpath checks, zip-slip guards, process-tree kill on build timeouts.

## Migration to 5.x in two calls

```text
migrate_egovframe_project(projectDir="/work/legacy-app")                    # diagnose (read-only)
migrate_egovframe_project(projectDir="/work/legacy-app", apply=true)        # preview the edits
migrate_egovframe_project(projectDir="/work/legacy-app", apply=true, dryRun=false)  # apply
migrate_egovframe_project(projectDir="/work/legacy-app", verify=true)              # compile and link errors to the remaining manual items
```

Auto items (coordinates, package prefixes and renames, javax→jakarta packages and artifacts, repository URLs, Java 17, web.xml schema) are rewritten from the exact text offsets the diagnosis recorded; manual items (removed classes with their replacements, removed `egov-*` XML namespaces, libraries such as DBCP 1.x or Log4j 1.x, Spring < 6) stay in the report with reasons. Details: [docs/design-migration.md](docs/design-migration.md) (Korean).

## MCP Registry

The server is described for the [MCP Registry](https://registry.modelcontextprotocol.io) by `server.json` (`io.github.EricSeokgon/egovframe-scaffold-mcp`) and the matching `mcpName` in `package.json`. Publishing happens after the npm release with `mcp-publisher login github && mcp-publisher publish`.

## License

Apache License 2.0
