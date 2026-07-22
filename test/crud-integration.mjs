import { createProject, generateCrud } from "../dist/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(path.join(tmpdir(), "egov-crud-compile-"));
const fields = [
  { columnName: "BOARD_ID", javaType: "Long", jdbcType: "BIGINT", primaryKey: true, generated: true, nullable: false },
  { columnName: "TITLE", javaType: "String", jdbcType: "VARCHAR", nullable: false },
  { columnName: "CREATED_AT", javaType: "LocalDateTime", jdbcType: "TIMESTAMP" },
];

const mavenCommand = process.env.MAVEN_CMD || (process.platform === "win32" ? "mvn.cmd" : "mvn");
const mavenArgs = ["-q", "-DskipTests", "compile"];
const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : mavenCommand;
const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", mavenCommand, ...mavenArgs] : mavenArgs;

async function compileTemplate({ projectName, template, profile, expectedFiles }) {
  const created = await createProject({
    projectName,
    groupId: "egovframework.example",
    database: "hsql",
    template,
    outputDir: root,
  });

  const generated = generateCrud({
    projectDir: created.projectPath,
    tableName: "SAMPLE_BOARD",
    entityName: "Board",
    basePackage: "egovframework.example.board",
    profile,
    fields,
  });

  const compiled = spawnSync(executable, commandArgs, {
    cwd: created.projectPath,
    encoding: "utf-8",
    timeout: 300_000,
  });
  if (compiled.error || compiled.status !== 0) {
    throw new Error(
      `${template}/${profile} Maven compile failed\n${compiled.stdout || ""}\n${compiled.stderr || compiled.error || ""}`,
    );
  }
  if (generated.files.length !== expectedFiles)
    throw new Error(`${template}/${profile} generated ${generated.files.length} files, expected ${expectedFiles}`);
  console.log(`crud compile OK: ${generated.files.length} files on ${template}/${profile} (${created.filesExtracted} template files)`);
}

try {
  await compileTemplate({ projectName: "crud-boot-smoke", template: "simple-backend", profile: "boot", expectedFiles: 7 });
  await compileTemplate({ projectName: "crud-classic-smoke", template: "web-sample", profile: "classic", expectedFiles: 9 });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
