// build-runner: eGovFrame 프로젝트를 실제로 빌드(컴파일·테스트)하고 결과를 구조화한다.
//
// 순수 헬퍼(빌드도구 감지·명령 구성·오류 파싱·로그 상한)는 프로세스 실행 없이 단위 테스트가 가능하며,
// 실제 실행은 주입 가능한 runner(기본: child_process.spawn)로 분리한다.
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

export type BuildTool = "maven" | "gradle";
export type BuildGoal = "compile" | "test" | "package";

export interface BuildError {
  file: string;
  line: number;
  column?: number;
  message: string;
}

export interface ResolvedCommand {
  command: string;
  args: string[];
  cwd: string;
  usedWrapper: boolean;
}

export interface RunnerResult {
  exitCode: number | null;
  timedOut: boolean;
}

/** 실제 실행 추상화. 테스트에서는 가짜 runner를 주입한다. */
export type Runner = (
  cmd: ResolvedCommand,
  opts: { timeoutMs: number; onData: (chunk: string) => void },
) => Promise<RunnerResult>;

export interface BuildRunResult {
  buildTool: BuildTool;
  goal: BuildGoal;
  command: string;
  cwd: string;
  usedWrapper: boolean;
  dryRun: boolean;
  success?: boolean;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  errors?: BuildError[];
  logTail?: string;
  logTruncated?: boolean;
  totalLogLines?: number;
}

/** pom.xml → maven, build.gradle(.kts) → gradle, 없으면 null. */
export function detectBuildToolAt(projectDir: string): BuildTool | null {
  if (fs.existsSync(path.join(projectDir, "pom.xml"))) return "maven";
  if (
    fs.existsSync(path.join(projectDir, "build.gradle")) ||
    fs.existsSync(path.join(projectDir, "build.gradle.kts"))
  ) {
    return "gradle";
  }
  return null;
}

/** 논리적 goal을 빌드도구별 인자로 매핑한다. */
export function resolveGoals(buildTool: BuildTool, goal: BuildGoal): string[] {
  if (buildTool === "maven") {
    if (goal === "compile") return ["-B", "-e", "compile"];
    if (goal === "test") return ["-B", "-e", "test"];
    return ["-B", "-e", "package", "-DskipTests"];
  }
  // gradle
  if (goal === "compile") return ["--console=plain", "compileJava"];
  if (goal === "test") return ["--console=plain", "test"];
  return ["--console=plain", "assemble"];
}

/**
 * 실행 명령을 구성한다. 래퍼(mvnw/gradlew)가 있으면 우선 사용하고, 없으면 시스템 mvn/gradle을 쓴다.
 * Windows(win32)에서는 .cmd/.bat 래퍼와 확장자를 사용한다.
 */
export function resolveCommand(
  projectDir: string,
  buildTool: BuildTool,
  goal: BuildGoal,
  opts?: { platform?: NodeJS.Platform | string },
): ResolvedCommand {
  const platform = opts?.platform ?? process.platform;
  const isWin = platform === "win32";
  const args = resolveGoals(buildTool, goal);

  if (buildTool === "maven") {
    const wrapperName = isWin ? "mvnw.cmd" : "mvnw";
    const hasWrapper = fs.existsSync(path.join(projectDir, wrapperName));
    const command = hasWrapper
      ? isWin
        ? wrapperName
        : "./" + wrapperName
      : isWin
        ? "mvn.cmd"
        : "mvn";
    return { command, args, cwd: projectDir, usedWrapper: hasWrapper };
  }

  const wrapperName = isWin ? "gradlew.bat" : "gradlew";
  const hasWrapper = fs.existsSync(path.join(projectDir, wrapperName));
  const command = hasWrapper
    ? isWin
      ? wrapperName
      : "./" + wrapperName
    : isWin
      ? "gradle.bat"
      : "gradle";
  return { command, args, cwd: projectDir, usedWrapper: hasWrapper };
}

/** 컴파일·테스트 오류를 파일·라인 단위로 파싱한다(중복 제거). */
export function parseBuildErrors(buildTool: BuildTool, output: string): BuildError[] {
  const errors: BuildError[] = [];
  const seen = new Set<string>();

  if (buildTool === "maven") {
    // 예) [ERROR] /abs/Foo.java:[12,5] cannot find symbol
    //     /abs/Foo.java:[12,5] cannot find symbol
    const re = /(?:\[ERROR\]\s*)?([^\s\[][^:\n]*?\.(?:java|kt|xml)):\[(\d+)(?:,(\d+))?\]\s*(.+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output)) !== null) {
      const key = `${m[1]}:${m[2]}:${m[3] ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({
        file: m[1].trim(),
        line: Number(m[2]),
        column: m[3] ? Number(m[3]) : undefined,
        message: m[4].trim(),
      });
    }
  } else {
    // 예) /abs/Foo.java:12: error: cannot find symbol  (gradle/javac)
    const re = /([^\s][^:\n]*?\.(?:java|kt)):(\d+):\s*(?:error:)?\s*(.+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output)) !== null) {
      const key = `${m[1]}:${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({ file: m[1].trim(), line: Number(m[2]), message: m[3].trim() });
    }
  }
  return errors;
}

/** 출력이 maxLines를 넘으면 마지막 maxLines줄만 남긴다(응답·메모리 상한). */
export function capOutput(
  output: string,
  maxLines: number,
): { text: string; truncated: boolean; totalLines: number } {
  const lines = output.split(/\r?\n/);
  if (lines.length <= maxLines) return { text: output, truncated: false, totalLines: lines.length };
  return { text: lines.slice(lines.length - maxLines).join("\n"), truncated: true, totalLines: lines.length };
}

/** child_process.spawn 기반 기본 runner(타임아웃·스트리밍). */
export const defaultRunner: Runner = (cmd, opts) =>
  new Promise<RunnerResult>((resolve) => {
    const child = spawn(cmd.command, cmd.args, {
      cwd: cmd.cwd,
      shell: process.platform === "win32",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout?.on("data", (d) => opts.onData(d.toString()));
    child.stderr?.on("data", (d) => opts.onData(d.toString()));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut });
    });
  });

/**
 * 프로젝트를 빌드한다. dryRun이면 실행 없이 감지된 명령만 반환한다.
 * runner를 주입하면(테스트) 실제 프로세스 없이 검증할 수 있다.
 */
export async function runBuild(opts: {
  projectDir: string;
  goal?: BuildGoal;
  timeoutMs?: number;
  maxLogLines?: number;
  dryRun?: boolean;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  now?: () => number;
}): Promise<BuildRunResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  }
  const buildTool = detectBuildToolAt(projectDir);
  if (!buildTool) {
    throw new Error(
      `빌드 파일(pom.xml·build.gradle)을 찾지 못했습니다: ${projectDir} — eGovFrame 프로젝트 루트인지 확인하세요.`,
    );
  }
  const goal: BuildGoal = opts.goal ?? "compile";
  const resolved = resolveCommand(projectDir, buildTool, goal, { platform: opts.platform });
  const command = [resolved.command, ...resolved.args].join(" ");

  if (opts.dryRun) {
    return { buildTool, goal, command, cwd: resolved.cwd, usedWrapper: resolved.usedWrapper, dryRun: true };
  }

  const runner = opts.runner ?? defaultRunner;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 300_000;
  let buffer = "";
  const started = now();
  const result = await runner(resolved, { timeoutMs, onData: (chunk) => (buffer += chunk) });
  const durationMs = now() - started;

  const errors = parseBuildErrors(buildTool, buffer);
  const capped = capOutput(buffer, opts.maxLogLines ?? 200);

  return {
    buildTool,
    goal,
    command,
    cwd: resolved.cwd,
    usedWrapper: resolved.usedWrapper,
    dryRun: false,
    success: result.exitCode === 0 && !result.timedOut,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs,
    errors,
    logTail: capped.text,
    logTruncated: capped.truncated,
    totalLogLines: capped.totalLines,
  };
}
