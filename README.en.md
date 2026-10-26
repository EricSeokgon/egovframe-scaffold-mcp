# egovframe-scaffold-mcp

[![CI](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/egovframe-scaffold-mcp)](https://www.npmjs.com/package/egovframe-scaffold-mcp)

An **MCP (Model Context Protocol) server** that scaffolds, assembles, diagnoses and migrates projects built on the Korean **eGovFrame** (전자정부 표준프레임워크, the e-Government Standard Framework) — a community proof of concept for [eGovFramework/egovframe-common-components#1120](https://github.com/eGovFramework/egovframe-common-components/issues/1120).

This page is a condensed English overview. The Korean documentation covers more: [README.md](README.md) (usage scenarios), [docs/tools.md](docs/tools.md) (every tool's parameters), [docs/versioning.md](docs/versioning.md), [CHANGELOG.md](CHANGELOG.md) and the design notes under `docs/`. Tool **responses** (reports, diagnoses) are in Korean; set `EGOVFRAME_LANG=en` to get English tool descriptions in `tools/list`.

## What it does

From an AI tool that speaks MCP (Claude, VS Code Copilot, Cursor, …) you can, in one conversation:

- create a project from one of the **22 official templates** (repository or Initializr zip, pinned by commit and sha256),
- assemble **common components** (190 catalog entries from the official v5.0.7 release) with sources, mappers, JSPs, messages, Spring/web fragments and per-database DDL/DML,
- generate CRUD code (official Development wizard inputs), Spring configuration (21 official Initializr templates, offline) and CI configuration for GitHub Actions, GitLab CI or Jenkins,
- build and test with Maven/Gradle and get compiler errors and JUnit results structured by file and line,
- diagnose an existing project, **migrate 3.x/4.x code to 5.x (Jakarta EE, Spring 6, Java 17)** — diagnosis first, then transactional apply, then compile-and-link verification — and keep a 5.x project on the latest 5.0.x, check declared or fully resolved dependencies against the official 5.x parents, the full Spring Boot BOM and the RTE transitive versions (optionally with OSV), **generate a CycloneDX or SPDX 2.3 SBOM and check it as a submission artifact** (minimum elements, diff against a previous SBOM, VEX draft), produce a one-call **migration readiness assessment** with A–D grades and the printed scoring formula, diagnose network/proxy problems, and generate `AGENTS.md` for AI coding tools.

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

Requires Node.js 22+ (since 1.0.0; Node 18 and 20 are end-of-life). Downloads go to `codeload.github.com`, `raw.githubusercontent.com`, `media.githubusercontent.com` (Git LFS zips) and, for builds, `maven.egovframe.go.kr` and Maven Central. Behind a corporate proxy set `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1` (Node's built-in fetch ignores the proxy otherwise); `diagnose_egovframe_network` tells you exactly what is wrong.

### Environment variables

| Variable | Purpose |
|---|---|
| `EGOVFRAME_ALLOWED_ROOTS` | Optional sandbox: every directory argument (`projectDir`, `outputDir`) must be inside one of these roots (path-separator-delimited, realpath-checked). |
| `EGOVFRAME_MAVEN_MIRROR` | Internal Maven mirror URL (Nexus, Artifactory proxy): every Maven request from build, test, SBOM and dependency-tree runs goes there (v1.6). Useful when the eGovFrame repository keeps returning 503. |
| `EGOVFRAME_LANG` | `en` → English tool descriptions in `tools/list` **and English responses** (v1.2): the Markdown body and sentence fields of the assessment, migration, dependency, SBOM, secure-coding, deployment and delivery results. The CLI takes `--lang en` (overrides the variable). |

With `EGOVFRAME_LANG=en` a response looks like this (`check_egovframe_secure_coding`, or `npx -y egovframe-scaffold-mcp secure --project . --lang en`):

```markdown
# Secure coding weakness scan (/work/app)

- Basis: Ministry of the Interior and Safety / KISA, Software Development Security Guide … 2021 revision — 20 rules (2026-10-13)
- 3 files (java 1 · config 1 · jsp 1)
- **high 1 · medium 2 · low 1** (total 4)

## By item

| Weakness (guide item) | Rule | Default severity | Count |
|---|---|---|---|
| Cross-site scripting | `xss-jsp-request` | high | 1 |
| Hard-coded sensitive information | `hardcoded-config-password` | medium | 1 |
| OS command injection | `os-command` | medium | 1 |
| Information exposure through error messages | `print-stack-trace` | low | 1 |
```

Structured output (`structuredContent`, `--json`) keeps the same keys in both languages; only sentence fields such as `reason`, `message`, `fix` and `note` follow the language. Text quoted from the project and official document search results stay as they are. Long-running tools (`rehearse_egovframe_migration`, `prepare_egovframe_offline_bundle`, `generate_egovframe_sbom`, `check_egovframe_dependencies(resolve=true)`, `build_egovframe_project`, `test_egovframe_project`, `reassemble_egovframe_components`, `prepare_egovframe_delivery`) send `notifications/progress` when the client passes a `progressToken`, and `notifications/cancelled` stops the child process tree and rolls back files (v1.2, [docs/design-i18n.md](docs/design-i18n.md)).

## Tools (35)

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
| `generate_egovframe_crud` | VO, Mapper XML, Service, Controller, optional JSP and JUnit 5 following the official CRUD wizard; v1.4: from a `CREATE TABLE` statement (`ddl`) with dialect-neutral LIKE search (`search`) |
| `generate_egovframe_config` | Spring configuration from the 21 official Initializr templates (xml/javaConfig/yaml/properties), offline |
| `generate_egovframe_ci` | CI configuration for `platform` github (default), gitlab (`.gitlab-ci.yml`) or jenkins (Declarative `Jenkinsfile`), Maven/Gradle auto-detected; `supplyChain=true` adds the SBOM → minimum-elements → assessment gate |
| `build_egovframe_project` / `test_egovframe_project` | Run builds and tests; compiler errors and JUnit XML structured by file/line |
| `diagnose_egovframe_project` / `generate_egovframe_report` | Scan any existing project; Markdown report — `sections=["assessment"]` adds the 5.x migration readiness assessment (overview, migration scope, dependency actions, security settings, SBOM summary, two A–D grades with the formula printed), `format=json`, optional `outputPath` (new file only) |
| `get_egovframe_guide` / `search_egovframe_docs` | Official guide documents (151 mappings) and offline keyword search |
| `migrate_egovframe_project` | **5.x migration**: diagnose RTE coordinates, package/class renames and removals (runtime and common components), javax→jakarta, web.xml, removed XML namespaces, libraries to replace (auto/manual with file:line); `apply=true` rewrites auto items in one transaction with backups; `verify=true` compiles and links compiler errors to the remaining manual items as a prioritised worklist |
| `check_egovframe_dependencies` | Compare dependencies (declared, or with `resolve=true` the whole tree resolved by Maven/Gradle — transitive artifacts with their path, declared-vs-resolved differences) with the official 5.x parent baseline (139 coordinates + BOM families), the full Spring Boot BOM (1,473 coordinates) and the transitive dependencies of the 18 RTE modules (58): ok / outdated / parent-managed / legacy / replace / vendor / unknown, each with the basis it was compared against; security-config presence checks; optional OSV lookup |
| `reassemble_egovframe_components` | Reassemble the common-component sources copied into a 3.x/4.x project onto v5.0.7: identifies the original tag by git blob ids (no downloads), three-way classifies every file, keeps user changes as patches plus a worklist, backs up and removes files 5.x dropped, writes the manifest (then upgrade/validate/remove work); dryRun by default, one transaction, optional compile verify |
| `rehearse_egovframe_migration` | Rehearse the 5.x migration on a copy without touching the project: reassemble components (first, so the origin tag is still recognisable), apply the automatic items, compile (every javac error, no 100-error cap), align the copy's pom to the official common-components pom of the pinned tag, compile again. Reports both error counts, missing packages with candidate coordinates, cascade errors, remaining files, a worklist and the pom patch; the original is fingerprinted before and after. The official v4.3.2 tree goes from 6,003 errors (JDK 17; 6,335 on JDK 21) to 1 |
| `prepare_egovframe_delivery` | **Delivery package** (v1.1): assembles the assessment, dependency action list, SBOM (CycloneDX and SPDX), SBOM check with a VEX draft, secure-coding findings with SARIF and the deployment files in one new directory with `delivery-manifest.json` (sha256 per file, input fingerprint, rootHash) and an `index.md`; failed items stay in the index with the reason. `previousDelivery` adds a diff (grades, SBOM, new or resolved vulnerabilities and weaknesses) and preserves VEX judgements; `verify=true` re-checks a received package. CLI `deliver --write` / `deliver --verify` |
| `prepare_egovframe_offline_bundle` | For air-gapped (network-separated) environments: on an internet PC, bundle the full OSV Maven dump, the pinned common-components archive, the Initializr zip templates and a mirror of the official common-components tags with a sha256 manifest. On the air-gapped PC set `EGOVFRAME_OFFLINE_BUNDLE`: downloads are served from the bundle after fingerprint checks, OSV lookups use the local dump (snapshot date noted, warning after 30 days) and reassembly uses the mirror. The local dump matched online OSV on 73/73 queries |
| `generate_egovframe_sbom` | CycloneDX 1.6 JSON (default) or SPDX 2.3 JSON (`bomFormat="spdx-json"`) SBOM without touching build files — Maven via cyclonedx-maven-plugin (hashes, licenses), Gradle from the resolved tree; baseline verdict per component (`egovframe:*` properties), optional OSV `vulnerabilities[]`; writes inside the project only, `dryRun` by default |
| `check_egovframe_sbom` | Check an existing CycloneDX or SPDX 2.x SBOM (format detected) without changing it: the 7 minimum elements (supplier, name, version, unique identifier, dependency relationship, author, timestamp) per component with a ready / needs-work verdict, a purl-only re-check (changed baseline verdicts, OSV findings published since generation), a diff against `baselinePath`, and with `vex=true` a CycloneDX VEX draft (`in_triage`, BOM-Link) that keeps human decisions |
| `check_egovframe_secure_coding` | Scan sources for security weaknesses from the implementation-stage list of the Korean secure coding guide (MOIS/KISA 2021) that static patterns can find: SQL injection, XSS, path traversal, open redirect, OS commands, XXE, weak crypto, insecure random, hard-coded secrets, cookies, error exposure, empty catch, deserialization, debug code — file, line, CWE, severity, fix and origin (common component original/modified/unmanaged, project, test); exceptions need a reason and reviewer; baseline diff; SARIF 2.1.0. A pattern-based aid, not a certified diagnosis v1.5: an intra-method data-flow pass raises severity when request values reach SQL, file paths, OS commands or redirects (path in SARIF `codeFlows`) and lowers it for constants only |
| `generate_egovframe_deploy` | Container and deployment files from the project diagnosis: multi-stage Dockerfile (Classic war unpacked as ROOT on Tomcat 10.1 or 11.0, Boot jar on the Temurin JRE; non-root, HEALTHCHECK; or a prebuilt artifact), `.dockerignore`, `deploy/docker-compose.yml` with a mysql/mariadb/postgres container initialised from the template SQL, and Kubernetes manifests (Deployment with probes and a hardened securityContext, Service, ConfigMap, Secret, optional Ingress). Database settings via Spring environment variables (Boot) or an overridden `globals.properties` (Classic); `imageRegistry` for air-gapped registries. New files only, `dryRun` by default |
| `diagnose_egovframe_network` | Probe the hosts the server downloads from, classify failures (DNS, timeout, TLS, proxy auth) and prescribe environment settings as bash/cmd/PowerShell commands |
| `generate_agents_md` | `AGENTS.md` for AI coding tools: build/test commands, RTE and migration status, components, rules, available MCP tools (ko/en) |

Resources: `egovframe://catalog/components`, `…/components/{id}`, `…/templates`, `…/recipes`, `…/ai-components`, `…/config-templates`, `…/migration-rules`, `…/dependency-baseline`. Prompts: `scaffold_board_login`, `scaffold_ai_chatbot`, `scaffold_portal`, `maintain_existing`.

## How it stays trustworthy

- **Pinned sources**: component catalog (official v5.0.7 tag, commit, archive sha256), Initializr zip templates (commit, sha256, size), config templates (commit, per-file sha256, CRLF-safe), migration rules derived from `egovframe-runtime` tags v3.10.0 / v4.3.0-Final / v5.0.2-Final and `egovframe-common-components` v3.10.0 / v5.0.7, dependency baseline extracted from the official 5.x parent poms (5.0.2), `spring-boot-dependencies` 3.5.6 and the RTE 5.0.2 module poms — every pom with url and sha256. `sync_egovframe_templates` reports when any of these drifts upstream.
- **Release gate**: `npm run prepublishOnly` runs the build and ~28 offline suites (over 1,300 assertions) on ubuntu and windows × Node 22/24; an integration job downloads real upstream assets, compiles generated CRUD and a migrated 3.10 project with JDK 17, checks that every migration target coordinate exists in the Maven repositories, watches upstream drift of the bundled rules and baseline, and validates `server.json` against the MCP Registry.
- **Automated releases** (v0.35+): once a PR is merged and CI passes on `main`, `release.yml` publishes to npm with OIDC trusted publishing (provenance attached, no tokens), tags the verified commit, creates the GitHub Release from the changelog and publishes to the MCP Registry with GitHub OIDC — only when the version in `package.json`, `server.json` and the changelog agree and the version is not released yet.
- **Protocol metadata**: every tool carries ko/en `title` and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`); the five diagnostic tools, the SBOM generator and checker, the report tool, the reassembly tool, the rehearsal tool and the bundle tool also declare `outputSchema` and return `structuredContent`.
- **Regression corpus** (v0.37): CI runs diagnosis, dry-run apply, the dependency check and the assessment against the official `egovframe-common-components` **v3.10.0 and v4.3.2** source trees (pinned commits, sparse partial clones) and asserts the counts in `catalog/migration-corpus.json` within ±1% — so a rule or baseline change that moves real-world results is caught, and the 4.x→5.x path is verified on real assets.
- **Resumable releases**: `release-check` looks at npm (including the published `gitHead`), the tag, the GitHub Release and the MCP Registry and runs only the missing steps, so an interrupted release continues on the next merge instead of needing manual tags.
- **Safety**: transactions with structured rollback reports, `dryRun` everywhere, allowed roots with realpath checks, zip-slip guards, process-tree kill on build timeouts.

## Migration to 5.x in two calls

```text
migrate_egovframe_project(projectDir="/work/legacy-app")                    # diagnose (read-only)
migrate_egovframe_project(projectDir="/work/legacy-app", apply=true)        # preview the edits
migrate_egovframe_project(projectDir="/work/legacy-app", apply=true, dryRun=false)  # apply
migrate_egovframe_project(projectDir="/work/legacy-app", verify=true)              # compile and link errors to the remaining manual items
migrate_egovframe_project(projectDir="/work/my-5x-app", target="5.0.2")           # keep a 5.x project current (diagnose)
migrate_egovframe_project(projectDir="/work/my-5x-app", target="5.1.0")           # up to 5.1.0 (repository-published, v1.3)
```

**Keeping 5.x current (v0.46)**: official Initializr templates still ship parent 5.0.0 or 5.0.1 while the latest official parent is 5.0.2. With `target="5.0.2"` the parent version, RTE version properties and literal RTE dependency versions are auto items; references to RTE APIs or behaviour changed after the project's effective RTE version (security configuration bean signatures, Excel formula-injection guard, XML XXE blocking, row locking in table ID generation and 7 more, generated from the `egovframe-runtime` 5.0.0/5.0.1/5.0.2 tags into `catalog/update-rules.json`) are manual items, together with a pointer to `upgrade`/`reassemble` for common components. `create_egovframe_project(alignParent=true)` applies the same update right after creation. On the official web and boot-web templates the update compiles with JDK 17, drops the dependencies below the baseline from 6 to 4 and from 3 to 1, and moves the supply-chain grade from C to B.

**eGovFrame 5.1.0 (v1.3)**: 5.1.0 is published to the official Maven repository but has no GitHub tag or announcement yet. `target="5.1.0"` updates a 5.x project to it with change evidence taken from the repository sources jars (noted in the result), and projects on the 5.1.0 parent are assessed against a separate 5.1 dependency baseline (BOM `egovframe-rte-root`, Spring Boot 3.5.16, `-egov.N` rebuilds compared by their upstream version). The default target stays 5.0.2 until the tag appears.

Auto items (coordinates, package prefixes and renames, javax→jakarta packages and artifacts, repository URLs, Java 17, web.xml schema) are rewritten from the exact text offsets the diagnosis recorded; manual items (removed classes with their replacements, removed `egov-*` XML namespaces, libraries such as DBCP 1.x or Log4j 1.x, Spring < 6) stay in the report with reasons. Details: [docs/design-migration.md](docs/design-migration.md) (Korean).

## Dependencies and SBOM

```text
check_egovframe_dependencies(projectDir="/work/legacy-app", resolve=true, offline=false)   # resolved tree + OSV
generate_egovframe_sbom(projectDir="/work/legacy-app", dryRun=false, offline=false, supplier="Agency", author="Vendor")  # sbom/bom.cdx.json (CycloneDX 1.6)
check_egovframe_sbom(projectDir="/work/legacy-app", offline=false, vex=true)                  # minimum elements + new OSV findings + sbom/vex.cdx.json
check_egovframe_sbom(projectDir="/work/legacy-app", baselinePath="sbom/bom-prev.cdx.json")   # diff against the previous submission
generate_egovframe_sbom(projectDir="/work/legacy-app", dryRun=false, bomFormat="spdx-json", supplier="Agency")  # sbom/bom.spdx.json (SPDX 2.3)
check_egovframe_sbom(projectDir="/work/legacy-app", sbomPath="sbom/bom.spdx.json")            # same checks on SPDX
```

The official `egovframe-web` template declares 19 dependencies and looks clean; resolving the tree shows 65 artifacts, 11 below the baseline and 24 OSV advisories. The SBOM carries the same verdict per component (`egovframe:status`, `egovframe:basis`, `egovframe:baseline`) and the OSV findings as `vulnerabilities[]`.

Public-sector SBOM submission in Korea is to be institutionalised by 2027. `check_egovframe_sbom` checks the 7 minimum elements (rules as data in `catalog/sbom-rules.json`, NTIA minimum elements = the Korean SW supply-chain security guideline 1.0 core elements). The plugin output for the official web template misses the supplier on 18 of 68 components (no `<organization>` in their poms) and the SBOM author; `generate_egovframe_sbom(supplier, author)` plus a small supplier table with per-entry evidence (marked `egovframe:supplierBasis=catalog`) makes it pass. The VEX draft marks new findings `in_triage`; people record `not_affected`/`exploitable`/… and later runs keep those decisions and only add new findings. Generated SBOMs and VEX documents validate against the official CycloneDX 1.6.1 JSON schema in the tests.

When SPDX is required, `bomFormat="spdx-json"` writes the same content as SPDX 2.3 JSON: packages, `DESCRIBES` and `DEPENDS_ON` relationships (`NONE` for "no dependencies", so it differs from "unknown"), purl/cpe/swid external refs, supplier/originator, creators and created, checksums, declared licenses, OSV advisories (`SECURITY`/`advisory`) and the baseline verdicts (`egovframe:*` annotations). `check_egovframe_sbom` reads SPDX by mapping it onto the same checks (supplier = `PackageSupplier`/`PackageOriginator`, dependency relationship = `DEPENDS_ON` with the package as subject, author = `Person`/`Organization` creators). For the official web template built with real Maven, the SPDX document passes the official spdx-spec v2.3 schema and checks exactly like the CycloneDX one (67 components, same per-element counts, diff 0). VEX stays CycloneDX-only.

## Secure coding weaknesses before delivery

```text
check_egovframe_secure_coding(projectDir)                                                   # summary by severity, rule and origin
check_egovframe_secure_coding(projectDir, sarifPath="egovframe-secure.sarif", overwrite=true) # SARIF 2.1.0 for code scanning
check_egovframe_secure_coding(projectDir, baselinePath="reports/secure-prev.json")          # only new findings
```

Projects subject to information-system audits in Korea follow the MOIS/KISA software development security guide (2021: 20 design-stage requirements, 49 implementation-stage weaknesses). The tool checks the 14 implementation-stage items that static patterns can find with controlled false positives (20 rules as data in `catalog/secure-coding-rules.json`). Comments are stripped first — all 96 MyBatis `${…}` occurrences in the official common components v4.3.2 turned out to be comments saying they were changed to `#{…}` — and EL inside custom-tag attributes, `<c:out>`, placeholders and `ENC(…)` values are not reported. With the same rules the official common components drop from 516 findings (v4.3.2) to 38 (v5.0.7), and the official web and boot-web templates have none. Exceptions go into `.egovframe-secure-ignore.json` with a reason and reviewer. `generate_egovframe_ci(supplyChain=true, secureCoding=true)` adds a `secure --fail-on high` gate step and uploads the SARIF to GitHub code scanning. Design notes: [docs/design-secure-coding.md](docs/design-secure-coding.md).

## Container and deployment files

```text
generate_egovframe_deploy(projectDir, dryRun=false)
generate_egovframe_deploy(projectDir, dryRun=false, imageRegistry="harbor.example.go.kr/dockerhub", buildInImage=false)
```

The tool writes a Dockerfile, `.dockerignore`, `deploy/docker-compose.yml` and `deploy/k8s/<app>.yaml` from the project diagnosis. Classic projects read `globals.properties` directly, so their WAR is unpacked into the image and a copy of that file (database host and password replaced) is mounted as a volume or Secret; Boot projects read settings through Spring's `Environment`, so `GLOBALS_MYSQL_URL`-style environment variables are enough. In CI, the official web (Classic) and boot-web (Boot) templates pass hadolint and kubeconform, build, start, answer HTTP 200 and report healthy as uid 10001; the official simple-backend starts with MySQL through `docker compose up` and serves the initialised data. Design notes: [docs/design-deploy.md](docs/design-deploy.md).

**Multi-module and MSA projects (v0.47)**: Maven `<modules>`, Gradle `include` and repositories of independent projects without a root build file (the official `msa-edu` `backend/*`) are detected as a workspace. Dependency checks, keeping 5.x current, SBOM, secure-coding and the assessment report per-module results next to the totals; on the official MSA templates dependency findings go from 0 to 280 (`msa-edu`) and 256 (`msa-portal-backend`). A Gradle version variable is an auto item only when it is used for the official parent or RTE alone. For a workspace, `generate_egovframe_deploy` writes one image per service module (reusing the module's own Dockerfile), one `deploy/docker-compose.yml` and one Kubernetes manifest per service, rewrites `localhost:<port>` references to service, database, RabbitMQ and Redis names (Spring environment variables for module settings, a copy of the config server's native repository in `deploy/config-repo`), and takes an optional `modules` list. The integration job builds the official `msa-common-components` and brings up ConfigServer, EurekaServer, GatewayServer and EgovBoard with compose until Eureka and the gateway report UP. Design notes: [docs/design-workspace.md](docs/design-workspace.md) (Korean).

## Running in CI (CLI mode)

```bash
npx -y egovframe-scaffold-mcp assess --project . --offline=false --out assessment.md --fail-on supplyChain:C
npx -y egovframe-scaffold-mcp check --project . --resolve --json --fail-on "vulnerabilities,outdated>10"
npx -y egovframe-scaffold-mcp sbom --project . --write
npx -y egovframe-scaffold-mcp sbom-check --project . --offline=false --fail-on "minimum,newVulns"
```

With no arguments the package starts the MCP stdio server as before; with a command (`assess`, `check`, `sbom`, `sbom-check`, `secure`, `rehearse`, `bundle`, `migrate`, `validate`, `diagnose`, `network`) it runs that one tool through an in-memory MCP client and exits. Options use the tool parameter names (kebab-case allowed); `--json` prints the same object as MCP `structuredContent`; `--step-summary` appends the Markdown to `$GITHUB_STEP_SUMMARY`; `--fail-on` takes grade (`supplyChain:C`) or count (`vulnerabilities`, `manual>20`) conditions. Exit codes: 0 pass, 2 over the `--fail-on` threshold, 3 execution failure, 64 usage error. Write tools are not exposed. `generate_egovframe_ci(platform, supplyChain=true)` adds the same gate on GitHub Actions, GitLab CI (JUnit and CycloneDX reports, validated against the official GitLab CI schema in the tests) or Jenkins (Declarative, `sh` on Linux and `bat` on Windows agents): SBOM → `sbom-check --fail-on minimum` → assessment above `failOn` fails, with the reports and SBOM kept as artifacts; `npmRegistry` and `offlineBundle` become `NPM_CONFIG_REGISTRY` and `EGOVFRAME_OFFLINE_BUNDLE`. Since v0.46 the integration job runs the generated files for real: the `Jenkinsfile` passes the declarative linter and runs to SUCCESS on the official Jenkins LTS image with 56 pinned plugins (all stages, archived reports and CycloneDX SBOM), and the `.gitlab-ci.yml` runs its build and supply-chain jobs with gitlab-ci-local. Design notes: [docs/design-cli.md](docs/design-cli.md) (Korean).

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

## Versioning

Since 1.0.0 the package follows [SemVer 2.0](https://semver.org/). The public API is defined as:

- tool names and input parameters (name, type, required, default, allowed values, ranges);
- the structured output of the 13 tools with an output schema;
- CLI commands and exit codes (0/2/3/64);
- the five `EGOVFRAME_*` environment variables;
- the supported Node range (`>=22`).

Markdown response wording, catalog and rule data, and internal modules are not part of it. Breaking changes need a MAJOR release. Deprecated parameters keep working with a warning until the next MAJOR; for example, `check_egovframe_secure_coding(top)` is now `topN` and `top` will be removed in 2.0.0.

The gate test `test:api-contract` compares the code against a contract snapshot and classifies every change as minor or major. `test:release` fails when the version bump is too small. Details: [docs/versioning.md](docs/versioning.md) (Korean).

## MCP Registry

The server is described for the [MCP Registry](https://registry.modelcontextprotocol.io) by `server.json` (`io.github.EricSeokgon/egovframe-scaffold-mcp`) and the matching `mcpName` in `package.json`. CI publishes it right after the npm release (`mcp-publisher login github-oidc && mcp-publisher publish`); `mcp-publisher validate` runs in CI on every change.

## Documentation

| Document | Contents |
|---|---|
| [README.md](README.md) | Usage scenarios for AI-tool users, CI/DevOps and auditors (Korean) |
| [docs/tools.md](docs/tools.md) | Parameters, behaviour and examples of all 35 tools; MCP resources and prompts |
| [docs/design-i18n.md](docs/design-i18n.md) | English responses (`L(ko, en)`, `_en` rule fields, byte-identical Korean goldens) and progress notifications / cancellation (v1.2, Korean) |
| [docs/versioning.md](docs/versioning.md) | Versioning policy, public API surface, deprecation process |
| [CHANGELOG.md](CHANGELOG.md) | Per-release change log |
| [docs/development.md](docs/development.md) | Local development, test suites, release procedure (contributors) |
| [docs/planning.md](docs/planning.md) | Planning records per version with outcomes (repository only, not in the npm package) |

## License

Apache License 2.0
