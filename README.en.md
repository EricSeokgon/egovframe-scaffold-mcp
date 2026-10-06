# egovframe-scaffold-mcp

[![CI](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/egovframe-scaffold-mcp)](https://www.npmjs.com/package/egovframe-scaffold-mcp)

An **MCP (Model Context Protocol) server** that scaffolds, assembles, diagnoses and migrates projects built on the Korean **eGovFrame** (전자정부 표준프레임워크, the e-Government Standard Framework) — a community proof of concept for [eGovFramework/egovframe-common-components#1120](https://github.com/eGovFramework/egovframe-common-components/issues/1120).

The full documentation, design notes and change log are in Korean: [README.md](README.md). This page is a condensed English overview. Tool **responses** (reports, diagnoses) are in Korean; set `EGOVFRAME_LANG=en` to get English tool **descriptions** in `tools/list` so any MCP client or model can pick tools without reading Korean.

## What it does

From an AI tool that speaks MCP (Claude, VS Code Copilot, Cursor, …) you can, in one conversation:

- create a project from one of the **22 official templates** (repository or Initializr zip, pinned by commit and sha256),
- assemble **common components** (190 catalog entries from the official v5.0.7 release) with sources, mappers, JSPs, messages, Spring/web fragments and per-database DDL/DML,
- generate CRUD code (official Development wizard inputs), Spring configuration (21 official Initializr templates, offline) and a GitHub Actions workflow,
- build and test with Maven/Gradle and get compiler errors and JUnit results structured by file and line,
- diagnose an existing project, **migrate 3.x/4.x code to 5.x (Jakarta EE, Spring 6, Java 17)** — diagnosis first, then transactional apply, then compile-and-link verification —, check declared or fully resolved dependencies against the official 5.x parents, the full Spring Boot BOM and the RTE transitive versions (optionally with OSV), **generate a CycloneDX SBOM**, produce a one-call **migration readiness assessment** with A–D grades and the printed scoring formula, diagnose network/proxy problems, and generate `AGENTS.md` for AI coding tools.

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

## Tools (29)

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
| `diagnose_egovframe_project` / `generate_egovframe_report` | Scan any existing project; Markdown report — `sections=["assessment"]` adds the 5.x migration readiness assessment (overview, migration scope, dependency actions, security settings, SBOM summary, two A–D grades with the formula printed), `format=json`, optional `outputPath` (new file only) |
| `get_egovframe_guide` / `search_egovframe_docs` | Official guide documents (151 mappings) and offline keyword search |
| `migrate_egovframe_project` | **5.x migration**: diagnose RTE coordinates, package/class renames and removals (runtime and common components), javax→jakarta, web.xml, removed XML namespaces, libraries to replace (auto/manual with file:line); `apply=true` rewrites auto items in one transaction with backups; `verify=true` compiles and links compiler errors to the remaining manual items as a prioritised worklist |
| `check_egovframe_dependencies` | Compare dependencies (declared, or with `resolve=true` the whole tree resolved by Maven/Gradle — transitive artifacts with their path, declared-vs-resolved differences) with the official 5.x parent baseline (139 coordinates + BOM families), the full Spring Boot BOM (1,473 coordinates) and the transitive dependencies of the 18 RTE modules (58): ok / outdated / parent-managed / legacy / replace / vendor / unknown, each with the basis it was compared against; security-config presence checks; optional OSV lookup |
| `reassemble_egovframe_components` | Reassemble the common-component sources copied into a 3.x/4.x project onto v5.0.7: identifies the original tag by git blob ids (no downloads), three-way classifies every file, keeps user changes as patches plus a worklist, backs up and removes files 5.x dropped, writes the manifest (then upgrade/validate/remove work); dryRun by default, one transaction, optional compile verify |
| `generate_egovframe_sbom` | CycloneDX 1.6 JSON SBOM without touching build files — Maven via cyclonedx-maven-plugin (hashes, licenses), Gradle from the resolved tree; baseline verdict per component (`egovframe:*` properties), optional OSV `vulnerabilities[]`; writes inside the project only, `dryRun` by default |
| `diagnose_egovframe_network` | Probe the hosts the server downloads from, classify failures (DNS, timeout, TLS, proxy auth) and prescribe environment settings as bash/cmd/PowerShell commands |
| `generate_agents_md` | `AGENTS.md` for AI coding tools: build/test commands, RTE and migration status, components, rules, available MCP tools (ko/en) |

Resources: `egovframe://catalog/components`, `…/components/{id}`, `…/templates`, `…/recipes`, `…/ai-components`, `…/config-templates`, `…/migration-rules`, `…/dependency-baseline`. Prompts: `scaffold_board_login`, `scaffold_ai_chatbot`, `scaffold_portal`, `maintain_existing`.

## How it stays trustworthy

- **Pinned sources**: component catalog (official v5.0.7 tag, commit, archive sha256), Initializr zip templates (commit, sha256, size), config templates (commit, per-file sha256, CRLF-safe), migration rules derived from `egovframe-runtime` tags v3.10.0 / v4.3.0-Final / v5.0.2-Final and `egovframe-common-components` v3.10.0 / v5.0.7, dependency baseline extracted from the official 5.x parent poms (5.0.2), `spring-boot-dependencies` 3.5.6 and the RTE 5.0.2 module poms — every pom with url and sha256. `sync_egovframe_templates` reports when any of these drifts upstream.
- **Release gate**: `npm run prepublishOnly` runs the build and ~28 offline suites (over 1,300 assertions) on ubuntu and windows × Node 18/20/22; an integration job downloads real upstream assets, compiles generated CRUD and a migrated 3.10 project with JDK 17, checks that every migration target coordinate exists in the Maven repositories, watches upstream drift of the bundled rules and baseline, and validates `server.json` against the MCP Registry.
- **Automated releases** (v0.35+): once a PR is merged and CI passes on `main`, `release.yml` publishes to npm with OIDC trusted publishing (provenance attached, no tokens), tags the verified commit, creates the GitHub Release from the changelog and publishes to the MCP Registry with GitHub OIDC — only when the version in `package.json`, `server.json` and the changelog agree and the version is not released yet.
- **Protocol metadata**: every tool carries ko/en `title` and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`); the five diagnostic tools, the SBOM generator and the report tool also declare `outputSchema` and return `structuredContent`.
- **Regression corpus** (v0.37): CI runs diagnosis, dry-run apply, the dependency check and the assessment against the official `egovframe-common-components` **v3.10.0 and v4.3.2** source trees (pinned commits, sparse partial clones) and asserts the counts in `catalog/migration-corpus.json` within ±1% — so a rule or baseline change that moves real-world results is caught, and the 4.x→5.x path is verified on real assets.
- **Resumable releases**: `release-check` looks at npm (including the published `gitHead`), the tag, the GitHub Release and the MCP Registry and runs only the missing steps, so an interrupted release continues on the next merge instead of needing manual tags.
- **Safety**: transactions with structured rollback reports, `dryRun` everywhere, allowed roots with realpath checks, zip-slip guards, process-tree kill on build timeouts.

## Migration to 5.x in two calls

```text
migrate_egovframe_project(projectDir="/work/legacy-app")                    # diagnose (read-only)
migrate_egovframe_project(projectDir="/work/legacy-app", apply=true)        # preview the edits
migrate_egovframe_project(projectDir="/work/legacy-app", apply=true, dryRun=false)  # apply
migrate_egovframe_project(projectDir="/work/legacy-app", verify=true)              # compile and link errors to the remaining manual items
```

Auto items (coordinates, package prefixes and renames, javax→jakarta packages and artifacts, repository URLs, Java 17, web.xml schema) are rewritten from the exact text offsets the diagnosis recorded; manual items (removed classes with their replacements, removed `egov-*` XML namespaces, libraries such as DBCP 1.x or Log4j 1.x, Spring < 6) stay in the report with reasons. Details: [docs/design-migration.md](docs/design-migration.md) (Korean).

## Dependencies and SBOM

```text
check_egovframe_dependencies(projectDir="/work/legacy-app", resolve=true, offline=false)   # resolved tree + OSV
generate_egovframe_sbom(projectDir="/work/legacy-app", dryRun=false, offline=false)         # sbom/bom.cdx.json (CycloneDX 1.6)
```

The official `egovframe-web` template declares 19 dependencies and looks clean; resolving the tree shows 65 artifacts, 11 below the baseline and 24 OSV advisories. The SBOM carries the same verdict per component (`egovframe:status`, `egovframe:basis`, `egovframe:baseline`) and the OSV findings as `vulnerabilities[]`.

## Reassembling copied common components

```text
reassemble_egovframe_components(projectDir="/work/legacy-app")                 # preview: original tag, per-file verdicts
reassemble_egovframe_components(projectDir="/work/legacy-app", dryRun=false)    # v5.0.7 + patches + worklist + manifest
```

Most manual migration work in 3.x/4.x projects sits inside common-component sources that were copied from the official repository. The tool finds the tag they were copied from by matching git blob ids against a blobless mirror of the official tags (`EGOVFRAME_CACHE_DIR`, a few hundred KB per tag; needs `git`), so it can tell untouched files from user edits. Untouched files are replaced, user-edited sources are replaced while their changes are saved as unified-diff patches (config and asset files keep the user copy and store the target copy for reference), and files 5.x dropped are backed up and removed. Patches are not re-applied automatically. Design notes: [docs/design-migration.md](docs/design-migration.md) (Korean).

## Migration readiness assessment in one call

```text
generate_egovframe_report(projectDir="/work/legacy-app", sections=["assessment"])
generate_egovframe_report(projectDir="/work/legacy-app", sections=["assessment"], offline=false, resolve=true, outputPath="docs/assessment.md")
```

Six sections: overview (build tool, RTE generation, parent, Java, components), migration scope (auto/manual by kind, reassembly advice, top manual work items grouped by kind and target), dependencies (verdict counts, an action list, transitive artifacts with `resolve=true`, OSV with `offline=false`), security settings, SBOM summary (if `sbom/bom.cdx.json` exists), and **grades with evidence**. Two grades — *migration difficulty* (manual items, components to reassemble, removed-API references, coordinate generation) and *supply-chain state* (below-baseline, legacy/replace, known vulnerabilities, missing security settings, parent/Java) — are sums of banded factor points, A=0 · B≤3 · C≤7 · D>7, and the full formula is printed in the report so anyone can recompute it (the tests do). The official 5.x template grades A for migration; the full common-components trees (v3.10.0, v4.3.2) grade D on both axes. No cost or effort estimates. Design notes: [docs/design-assessment-report.md](docs/design-assessment-report.md) (Korean).

## MCP Registry

The server is described for the [MCP Registry](https://registry.modelcontextprotocol.io) by `server.json` (`io.github.EricSeokgon/egovframe-scaffold-mcp`) and the matching `mcpName` in `package.json`. CI publishes it right after the npm release (`mcp-publisher login github-oidc && mcp-publisher publish`); `mcp-publisher validate` runs in CI on every change.

## License

Apache License 2.0
