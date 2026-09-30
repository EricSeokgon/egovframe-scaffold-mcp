// AGENTS.md 생성 (generate_agents_md, v0.31.0).
// 프로젝트 진단(빌드 도구·RTE·DbType·설치 컴포넌트·매니페스트·5.x 전환 상태)을 AI 코딩 도구용 작업 지침 파일로 만든다.
// 내용은 진단에서 나온 사실만 적고, 규칙은 이 서버의 도구가 지키는 원칙(사용자 파일 보호·백업 디렉터리·좌표 규칙)을 그대로 옮긴다.
import * as fs from "node:fs";
import * as path from "node:path";
import { diagnoseProject } from "./diagnose.js";
import { detectBuildToolAt, resolveCommand, type BuildGoal } from "./build-runner.js";
import { MANIFEST_FILE, readManifest } from "./manifest.js";
import { loadCatalog } from "./catalog.js";
import { migrateProject } from "./migrate.js";
import { withFileTransaction } from "./file-transaction.js";
import { SERVER_VERSION } from "./version.js";

export type AgentsLang = "ko" | "en";
export interface AgentsMdOptions { projectDir: string; fileName?: string; lang?: AgentsLang; overwrite?: boolean; dryRun?: boolean }
export interface AgentsMdResult {
  projectDir: string;
  filePath: string;
  fileName: string;
  lang: AgentsLang;
  dryRun: boolean;
  written: boolean;
  overwritten: boolean;
  content: string;
  facts: AgentsFacts;
}
export interface AgentsFacts {
  buildSystem: "maven" | "gradle" | "unknown";
  wrapper: boolean;
  commands: Record<BuildGoal, string> | null;
  rteVersion: string | null;
  sourceEra: string;
  parent: string | null;
  database: string | null;
  basePackages: string[];
  components: { id: string; name: string; path: string; managed: boolean }[];
  manifest: boolean;
  aiLayer: boolean;
  configDirs: string[];
  migration: { auto: number; manual: number } | null;
  backupDirs: string[];
}

const FILE_NAME_RE = /^[A-Za-z0-9_.-]{1,64}\.md$/;

function listIf(dir: string, rel: string): string[] {
  try { return fs.readdirSync(path.join(dir, rel)); } catch { return []; }
}
function existsRel(dir: string, rel: string): boolean { return fs.existsSync(path.join(dir, rel)); }

/** 진단으로 사실을 모은다(순수 읽기). */
export function collectAgentsFacts(projectDir: string): AgentsFacts {
  const dir = path.resolve(projectDir);
  const diag = diagnoseProject({ projectDir: dir });
  const buildTool = detectBuildToolAt(dir);
  let commands: AgentsFacts["commands"] = null;
  let wrapper = false;
  if (buildTool) {
    commands = { compile: "", test: "", package: "" };
    for (const goal of ["compile", "test", "package"] as BuildGoal[]) {
      const c = resolveCommand(dir, buildTool, goal);
      wrapper = wrapper || c.usedWrapper;
      commands[goal] = [c.command, ...c.args].join(" ");
    }
  }
  const manifest = readManifest(dir);
  const catalog = loadCatalog();
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  const components = diag.detectedComponents.map((c) => ({ id: c.id, name: byId.get(c.id)?.name ?? c.name, path: c.matchedPrefix, managed: !!manifest?.components[c.id] }));
  const basePackages = new Set<string>();
  for (const top of listIf(dir, "src/main/java")) {
    if (!/^[a-z][a-z0-9_]*$/.test(top)) continue;
    const second = listIf(dir, `src/main/java/${top}`).filter((s) => /^[a-z][a-z0-9_]*$/.test(s));
    if (second.length === 0) basePackages.add(top);
    for (const s of second) basePackages.add(`${top}.${s}`);
  }
  const configDirs = ["src/main/resources/egovframework/spring", "src/main/resources/egovframework/mapper", "src/main/resources/egovframework/sqlmap", "src/main/resources/egovframework/egovProps", "src/main/resources/egovframework/message", "src/main/webapp/WEB-INF/config", "src/main/webapp/WEB-INF/jsp", "src/main/resources/egovframework/batch"].filter((r) => existsRel(dir, r));
  let migration: AgentsFacts["migration"] = null;
  let sourceEra = "unknown";
  try { const m = migrateProject({ projectDir: dir, maxFiles: 5000 }); migration = { auto: m.summary.auto, manual: m.summary.manual }; sourceEra = m.sourceEra; } catch { /* 진단 불가 시 생략 */ }
  let parent: string | null = null;
  try {
    const pomText = fs.readFileSync(path.join(dir, "pom.xml"), "utf8");
    const p = pomText.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
    if (p) parent = `${p.match(/<groupId>\s*([^<\s]+)/)?.[1] ?? "?"}:${p.match(/<artifactId>\s*([^<\s]+)/)?.[1] ?? "?"}:${p.match(/<version>\s*([^<\s]+)/)?.[1] ?? "?"}`;
  } catch { /* gradle 등 */ }
  const backupDirs = ["migration-backup", "upgrade-backup", "remove-backup"].filter((r) => existsRel(dir, r));
  return {
    buildSystem: diag.buildSystem, wrapper, commands, rteVersion: diag.egovVersion, sourceEra, parent, database: diag.database,
    basePackages: [...basePackages].sort(), components, manifest: diag.hasManifest, aiLayer: diag.aiLayer, configDirs, migration, backupDirs,
  };
}

const T = {
  ko: {
    title: (name: string) => `# AGENTS.md — ${name}`,
    intro: "이 파일은 AI 코딩 도구(Claude Code·Copilot·Cursor 등)가 이 전자정부 표준프레임워크(eGovFrame) 프로젝트에서 작업할 때 지켜야 할 사실과 규칙입니다. `egovframe-scaffold-mcp` 의 `generate_agents_md` 가 프로젝트를 진단해 만들었으며, 사실 항목은 진단 결과이고 규칙 항목은 이 프로젝트의 도구가 보장하는 원칙입니다.",
    overview: "## 프로젝트 개요", build: "빌드", rte: "표준프레임워크 실행환경(RTE)", parent: "parent", db: "DbType", pkg: "기본 패키지", none: "미검출", noneP: "없음",
    era: (e: string) => e === "5.x" ? "5.x(Jakarta EE·Spring 6·Java 17) 좌표" : e === "unknown" ? "RTE 좌표 미검출" : `${e} 좌표 — 5.x 전환 대상`,
    commands: "## 빌드·테스트 명령", wrapperNote: (w: boolean) => w ? "프로젝트 래퍼(mvnw/gradlew)를 사용합니다." : "시스템에 설치된 빌드 도구를 사용합니다(래퍼 없음).", noBuild: "빌드 파일(pom.xml·build.gradle)을 찾지 못했습니다.",
    compile: "컴파일", test: "테스트", pkg2: "패키징",
    layout: "## 디렉터리 구조", layoutNote: "표준프레임워크 관례상 설정·매퍼·JSP 위치는 아래와 같습니다. 새 파일도 같은 위치 규칙을 따릅니다.",
    components: "## 설치된 공통컴포넌트", noComponents: "감지된 공통컴포넌트가 없습니다. 필요하면 `add_egovframe_components` 로 조립합니다.", managed: "매니페스트 관리", unmanaged: "매니페스트 없음",
    componentsNote: (m: boolean) => m ? `\`${MANIFEST_FILE}\` 이 설치 파일과 기준 해시를 기록합니다. 이 목록의 소스는 upstream 과 3-way 로 갱신되므로 직접 고친 파일은 \`upgrade_egovframe_project\` 가 보존합니다(사용자 수정으로 분류).` : `설치 매니페스트가 없어 remove/upgrade 수명주기 도구는 쓸 수 없습니다. 이 소스는 직접 수정해도 되지만 upstream 갱신은 수동입니다.`,
    migration: "## 5.x 전환 상태", migrationNone: "5.x 기준을 만족합니다(전환 항목 0건).", migrationNeeded: (a: number, m: number) => `전환 항목 ${a + m}건(자동 ${a} · 수동 ${m}). \`migrate_egovframe_project(apply=true)\` 로 자동 항목을 적용하고 수동 항목은 사유에 따라 고칩니다. 새 코드는 \`org.egovframe.rte.*\`·\`jakarta.*\` 만 사용합니다.`,
    rules: "## 규칙", rulesList: (f: AgentsFacts) => [
      `빌드가 통과하는 상태를 유지합니다. 변경 후 \`${f.commands?.compile ?? "빌드 명령"}\` 로 컴파일을, \`${f.commands?.test ?? "테스트 명령"}\` 로 테스트를 확인합니다(또는 \`build_egovframe_project\`·\`test_egovframe_project\`).`,
      f.sourceEra === "5.x" ? "새 코드는 `org.egovframe.rte.*`(실행환경)와 `jakarta.*` 네임스페이스만 사용합니다. `egovframework.rte.*`·`javax.servlet`·`javax.validation` 은 쓰지 않습니다." : "전환이 끝나기 전에는 기존 코드의 좌표 체계를 따르되, 새로 만드는 코드는 5.x 전환을 고려해 `EgovAbstractServiceImpl`·`EgovMap`·`@EgovMapper` 같은 5.x 에도 있는 API 를 씁니다.",
      "공통컴포넌트 소스(`egovframework.com.*`)는 upstream 에서 가져온 것입니다. 기능을 바꿔야 하면 해당 파일을 고치되 그 사실을 커밋 메시지에 남기고, 갱신은 `upgrade_egovframe_project` 로 합니다.",
      "`Globals.DbType` 과 DB 스크립트는 함께 움직입니다. DB 를 바꾸면 `validate_egovframe_project` 로 정합을 확인합니다.",
      "설정 파일은 `generate_egovframe_config` 가 만드는 위치와 형식(xml/javaConfig/yaml/properties)을 따르고, 기존 파일은 덮어쓰지 않습니다.",
      "`migration-backup/`·`upgrade-backup/`·`remove-backup/` 은 도구가 남긴 원본 백업입니다. 커밋하지 않고(`.gitignore`), 복구가 끝나면 지웁니다.",
      "비밀번호·키는 소스와 설정에 직접 적지 않습니다. `globals.properties` 의 자격 증명은 환경별 파일이나 환경변수로 분리합니다.",
      "의존성 버전을 올릴 때는 `check_egovframe_dependencies` 로 공식 5.x parent 기준과 대조하고, parent 가 관리하는 좌표에는 `<version>` 을 적지 않습니다.",
    ],
    tools: "## 사용할 수 있는 MCP 도구", toolsNote: `이 프로젝트는 \`egovframe-scaffold-mcp\`(v${SERVER_VERSION}) 로 관리할 수 있습니다. 진단·검증은 읽기 전용이고, 쓰기 도구는 dryRun 과 transaction(실패 시 복구)을 제공합니다.`,
    toolRows: ["`diagnose_egovframe_project` · `validate_egovframe_project` · `generate_egovframe_report` — 진단·검증·리포트", "`add_egovframe_components` · `remove_egovframe_components` · `upgrade_egovframe_project` — 공통컴포넌트 수명주기", "`generate_egovframe_crud` · `generate_egovframe_config` · `generate_egovframe_ci` — 코드·설정·CI 생성", "`build_egovframe_project` · `test_egovframe_project` — 빌드·테스트 실행과 오류 구조화", "`migrate_egovframe_project` · `check_egovframe_dependencies` — 5.x 전환·의존성 점검", "`diagnose_egovframe_network` — 다운로드 실패 시 네트워크 진단"],
    generated: (d: string) => `_생성: ${d} · egovframe-scaffold-mcp generate_agents_md. 프로젝트가 바뀌면 다시 생성하세요._`,
    backups: (dirs: string[]) => `현재 백업 디렉터리가 있습니다: ${dirs.join(", ")}`,
  },
  en: {
    title: (name: string) => `# AGENTS.md — ${name}`,
    intro: "Facts and rules for AI coding tools (Claude Code, Copilot, Cursor, …) working on this eGovFrame (Korean e-Government Standard Framework) project. Generated by `generate_agents_md` of `egovframe-scaffold-mcp`: fact sections come from project diagnosis, rule sections restate the guarantees the project tooling relies on.",
    overview: "## Project overview", build: "Build", rte: "eGovFrame runtime (RTE)", parent: "parent", db: "DbType", pkg: "Base packages", none: "not detected", noneP: "none",
    era: (e: string) => e === "5.x" ? "5.x coordinates (Jakarta EE, Spring 6, Java 17)" : e === "unknown" ? "RTE coordinates not detected" : `${e} coordinates — migration to 5.x pending`,
    commands: "## Build and test commands", wrapperNote: (w: boolean) => w ? "Uses the project wrapper (mvnw/gradlew)." : "Uses the build tool installed on the system (no wrapper).", noBuild: "No build file (pom.xml / build.gradle) found.",
    compile: "Compile", test: "Test", pkg2: "Package",
    layout: "## Directory layout", layoutNote: "eGovFrame convention places configuration, mappers and JSPs as follows. New files follow the same locations.",
    components: "## Installed common components", noComponents: "No common components detected. Assemble them with `add_egovframe_components` when needed.", managed: "manifest-managed", unmanaged: "no manifest",
    componentsNote: (m: boolean) => m ? `\`${MANIFEST_FILE}\` records installed files and baseline hashes. These sources are updated 3-way against upstream, so files you edit are preserved by \`upgrade_egovframe_project\` (classified as user-modified).` : `No install manifest — remove/upgrade lifecycle tools are unavailable. You may edit these sources, but upstream updates are manual.`,
    migration: "## 5.x migration status", migrationNone: "Already on the 5.x baseline (0 migration items).", migrationNeeded: (a: number, m: number) => `${a + m} migration items (${a} auto, ${m} manual). Apply auto items with \`migrate_egovframe_project(apply=true)\` and fix manual items per their reasons. New code uses only \`org.egovframe.rte.*\` and \`jakarta.*\`.`,
    rules: "## Rules", rulesList: (f: AgentsFacts) => [
      `Keep the build green. After changes run \`${f.commands?.compile ?? "the build command"}\` to compile and \`${f.commands?.test ?? "the test command"}\` to test (or use \`build_egovframe_project\` / \`test_egovframe_project\`).`,
      f.sourceEra === "5.x" ? "New code uses only the `org.egovframe.rte.*` runtime and `jakarta.*` namespaces. Never `egovframework.rte.*`, `javax.servlet` or `javax.validation`." : "Until migration is complete, follow the existing coordinate scheme, but write new code against APIs that also exist in 5.x (`EgovAbstractServiceImpl`, `EgovMap`, `@EgovMapper`).",
      "Common-component sources (`egovframework.com.*`) come from upstream. If you must change behaviour, edit the file and say so in the commit message; updates go through `upgrade_egovframe_project`.",
      "`Globals.DbType` and the DB scripts move together. After changing the database run `validate_egovframe_project`.",
      "Configuration files follow the locations and formats (xml/javaConfig/yaml/properties) produced by `generate_egovframe_config`; existing files are never overwritten.",
      "`migration-backup/`, `upgrade-backup/` and `remove-backup/` are tool-made backups of originals. Do not commit them (`.gitignore`); delete them once recovery is no longer needed.",
      "Never hard-code passwords or keys in sources or configuration. Split credentials in `globals.properties` into per-environment files or environment variables.",
      "When bumping dependency versions, compare against the official 5.x parent baseline with `check_egovframe_dependencies`; do not write `<version>` for coordinates the parent manages.",
    ],
    tools: "## Available MCP tools", toolsNote: `This project can be managed with \`egovframe-scaffold-mcp\` (v${SERVER_VERSION}). Diagnosis and validation are read-only; write tools offer dryRun and transactions (rollback on failure).`,
    toolRows: ["`diagnose_egovframe_project` · `validate_egovframe_project` · `generate_egovframe_report` — diagnosis, validation, report", "`add_egovframe_components` · `remove_egovframe_components` · `upgrade_egovframe_project` — common-component lifecycle", "`generate_egovframe_crud` · `generate_egovframe_config` · `generate_egovframe_ci` — code, configuration and CI generation", "`build_egovframe_project` · `test_egovframe_project` — build/test execution with structured errors", "`migrate_egovframe_project` · `check_egovframe_dependencies` — 5.x migration and dependency check", "`diagnose_egovframe_network` — network diagnosis when downloads fail"],
    generated: (d: string) => `_Generated ${d} by egovframe-scaffold-mcp generate_agents_md. Regenerate when the project changes._`,
    backups: (dirs: string[]) => `Backup directories currently present: ${dirs.join(", ")}`,
  },
};

/** 사실 → Markdown (순수). */
export function renderAgentsMd(facts: AgentsFacts, opts: { projectName: string; lang: AgentsLang; date?: string }): string {
  const t = T[opts.lang];
  const L: string[] = [];
  L.push(t.title(opts.projectName), ``, t.intro, ``);
  L.push(t.overview, ``);
  L.push(`- ${t.build}: ${facts.buildSystem}${facts.parent ? ` · ${t.parent} \`${facts.parent}\`` : ""}`);
  L.push(`- ${t.rte}: ${facts.rteVersion ?? t.none} — ${t.era(facts.sourceEra)}`);
  L.push(`- ${t.db}: ${facts.database ?? t.none}${facts.aiLayer ? " · AI layer" : ""}`);
  L.push(`- ${t.pkg}: ${facts.basePackages.length ? facts.basePackages.map((p) => `\`${p}\``).join(", ") : t.noneP}`);
  L.push(``, t.commands, ``);
  if (facts.commands) {
    L.push(t.wrapperNote(facts.wrapper), ``, "```bash", `${facts.commands.compile}   # ${t.compile}`, `${facts.commands.test}   # ${t.test}`, `${facts.commands.package}   # ${t.pkg2}`, "```");
  } else L.push(t.noBuild);
  L.push(``, t.layout, ``, t.layoutNote, ``);
  const layout = [
    ...facts.basePackages.map((p) => `- \`src/main/java/${p.replace(/\./g, "/")}/\``),
    ...facts.configDirs.map((d) => `- \`${d}/\``),
  ];
  L.push(...(layout.length ? layout : [`- \`src/main/java/\``]));
  L.push(``, t.components, ``);
  if (facts.components.length) {
    L.push(t.componentsNote(facts.manifest), ``, `| id | name | path | |`, `|---|---|---|---|`);
    for (const c of facts.components) L.push(`| ${c.id} | ${c.name} | \`${c.path}\` | ${c.managed ? t.managed : t.unmanaged} |`);
  } else L.push(t.noComponents);
  L.push(``, t.migration, ``);
  if (facts.migration) L.push(facts.migration.auto + facts.migration.manual === 0 ? t.migrationNone : t.migrationNeeded(facts.migration.auto, facts.migration.manual));
  else L.push(t.era(facts.sourceEra));
  if (facts.backupDirs.length) L.push(``, t.backups(facts.backupDirs));
  L.push(``, t.rules, ``);
  for (const r of t.rulesList(facts)) L.push(`- ${r}`);
  L.push(``, t.tools, ``, t.toolsNote, ``);
  for (const r of t.toolRows) L.push(`- ${r}`);
  L.push(``, t.generated(opts.date ?? new Date().toISOString().slice(0, 10)), ``);
  return L.join("\n");
}

/** AGENTS.md 를 생성한다. 기존 파일은 overwrite=true 가 아니면 거부하며, dryRun 이면 내용만 돌려준다. */
export async function generateAgentsMd(opts: AgentsMdOptions): Promise<AgentsMdResult> {
  const dir = path.resolve(opts.projectDir);
  const fileName = opts.fileName ?? "AGENTS.md";
  if (!FILE_NAME_RE.test(fileName) || fileName.includes("..")) throw new Error(`파일명은 영숫자·._- 로 된 .md 파일이어야 합니다: ${fileName}`);
  const lang: AgentsLang = opts.lang ?? "ko";
  const facts = collectAgentsFacts(dir);
  const content = renderAgentsMd(facts, { projectName: path.basename(dir), lang });
  const filePath = path.join(dir, fileName);
  const exists = fs.existsSync(filePath);
  const base: AgentsMdResult = { projectDir: dir, filePath, fileName, lang, dryRun: !!opts.dryRun, written: false, overwritten: false, content, facts };
  if (opts.dryRun) return base;
  if (exists && !opts.overwrite) throw new Error(`${fileName} 이 이미 있습니다. 덮어쓰려면 overwrite=true, 내용만 보려면 dryRun=true 를 쓰세요.`);
  await withFileTransaction(dir, "AGENTS.md 생성", (tx) => { tx.writeFile(fileName, content, { mustNotExist: !exists }); });
  return { ...base, written: true, overwritten: exists };
}
