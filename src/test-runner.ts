// test-runner: eGovFrame 프로젝트의 테스트를 실제로 실행하고, JUnit XML 리포트를 읽어
// 스위트·케이스 단위로 결과를 구조화한다. (build_egovframe_project 의 후속 — v0.23 로드맵)
//
// 설계 원칙은 build-runner 와 같다: 순수 헬퍼(명령 구성·리포트 파싱·집계)는 프로세스 실행 없이
// 단위 테스트가 가능하고, 실제 실행은 주입 가능한 runner 로 분리한다.
// 결과의 1차 근거는 로그가 아니라 빌드도구가 쓰는 JUnit XML 리포트다
// (maven-surefire: target/surefire-reports, gradle: build/test-results/test).
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type BuildError,
  type BuildTool,
  type ResolvedCommand,
  type Runner,
  capOutput,
  defaultRunner,
  detectBuildToolAt,
  parseBuildErrors,
  resolveCommand,
} from "./build-runner.js";

export type TestOutcome = "passed" | "failed" | "error" | "skipped";

export interface TestCaseResult {
  suite: string;
  name: string;
  outcome: TestOutcome;
  timeSec?: number;
  /** 실패·오류 메시지(assertion 메시지 또는 예외 메시지) */
  message?: string;
  /** 예외 타입(예: org.opentest4j.AssertionFailedError) */
  type?: string;
  /** 스택트레이스에서 찾은, 테스트 클래스 자신의 첫 프레임(파일·라인) */
  file?: string;
  line?: number;
}

export interface TestSuiteResult {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  timeSec?: number;
  reportFile: string;
}

export interface TestSummary {
  suites: number;
  tests: number;
  passed: number;
  failures: number;
  errors: number;
  skipped: number;
}

export interface TestRunResult {
  buildTool: BuildTool;
  command: string;
  cwd: string;
  usedWrapper: boolean;
  dryRun: boolean;
  /** 리포트를 읽은 디렉터리(프로젝트 기준 상대경로) */
  reportDir: string;
  success?: boolean;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  /** 리포트 파일이 하나라도 있었는지. 없으면 컴파일 실패·필터 불일치·테스트 없음 등을 의심한다. */
  reportsFound?: boolean;
  summary?: TestSummary;
  suites?: TestSuiteResult[];
  /** 실패·오류 케이스(최대 maxFailures) */
  failures?: TestCaseResult[];
  failuresTruncated?: boolean;
  /** 테스트 이전 단계(컴파일)에서 난 오류 — 로그에서 파싱 */
  compileErrors?: BuildError[];
  logTail?: string;
  logTruncated?: boolean;
  totalLogLines?: number;
}

/** 빌드도구별 JUnit XML 리포트 디렉터리(프로젝트 기준 상대경로). */
export function reportDirFor(buildTool: BuildTool): string {
  return buildTool === "maven"
    ? path.join("target", "surefire-reports")
    : path.join("build", "test-results", "test");
}

/**
 * 테스트 실행 인자를 구성한다.
 * - maven: `-B -e test` + 필터 시 `-Dtest=<filter> -Dsurefire.failIfNoSpecifiedTests=false`
 * - gradle: `--console=plain test` + 필터 시 `--tests <filter>`
 * 필터 문법은 각 빌드도구 규칙을 그대로 따른다(예: `FooTest`, `FooTest#bar`, `com.acme.*Test`).
 */
export function resolveTestArgs(buildTool: BuildTool, filter?: string): string[] {
  const f = filter?.trim();
  if (buildTool === "maven") {
    const args = ["-B", "-e", "test"];
    if (f) args.push(`-Dtest=${f}`, "-Dsurefire.failIfNoSpecifiedTests=false");
    return args;
  }
  const args = ["--console=plain", "test"];
  if (f) args.push("--tests", f);
  return args;
}

/**
 * 필터 문자열을 검증한다. 셸을 거치지 않고 spawn 인자로 넘기지만, 빌드도구 속성 문법을 깨는
 * 문자(공백·따옴표·`=`·`;`·`&`·`|`)는 거부해 예상 밖 인자 해석을 막는다.
 */
export function validateTestFilter(filter?: string): string | undefined {
  const f = filter?.trim();
  if (!f) return undefined;
  if (!/^[A-Za-z0-9_.$#*+,?\[\]!-]+$/.test(f)) {
    throw new Error(
      `testFilter 에 허용되지 않는 문자가 있습니다: ${JSON.stringify(f)} — 클래스/메서드 패턴만 지정하세요(예: FooTest, FooTest#bar, com.acme.*Test)`,
    );
  }
  return f;
}

// ── JUnit XML 파싱 (외부 의존성 없이 리포트 형식만 다룬다) ─────────────────────

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) out[m[1]] = decodeXml(m[3] ?? m[4] ?? "");
  return out;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/**
 * 스택트레이스에서 테스트 클래스 자신의 첫 프레임을 찾아 파일·라인을 돌려준다.
 * 예) at com.acme.FooTest.bar(FooTest.java:42)
 */
export function locateInStack(stack: string | undefined, className: string): { file?: string; line?: number } {
  if (!stack) return {};
  const simple = className.split(".").pop() ?? className;
  const re = new RegExp(`at\\s+${className.replace(/[.$]/g, "\\$&")}[\\w$]*\\.[\\w$<>]+\\(([^:)]+):(\\d+)\\)`);
  const m = re.exec(stack);
  if (m) return { file: m[1], line: Number(m[2]) };
  const re2 = new RegExp(`\\((${simple}\\.(?:java|kt)):(\\d+)\\)`);
  const m2 = re2.exec(stack);
  if (m2) return { file: m2[1], line: Number(m2[2]) };
  return {};
}

export interface ParsedReport {
  suite: TestSuiteResult;
  cases: TestCaseResult[];
}

/** JUnit XML(surefire/gradle 공통 형식) 문자열 하나를 파싱한다. testsuite 가 없으면 null. */
export function parseJUnitXml(xml: string, reportFile: string): ParsedReport | null {
  const suiteTag = /<testsuite\b([^>]*)>/.exec(xml);
  if (!suiteTag) return null;
  const sa = attrs(suiteTag[1]);
  const name = sa.name ?? path.basename(reportFile, ".xml").replace(/^TEST-/, "");
  const cases: TestCaseResult[] = [];
  const bodyStart = suiteTag.index + suiteTag[0].length;
  const body = xml.slice(bodyStart);

  // <testcase .../> 또는 <testcase ...> ... </testcase>
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(body)) !== null) {
    const ca = attrs(m[1]);
    const inner = m[3] ?? "";
    const cls = ca.classname ?? name;
    const tc: TestCaseResult = {
      suite: cls,
      name: ca.name ?? "(unnamed)",
      outcome: "passed",
      timeSec: ca.time !== undefined ? Number(ca.time) : undefined,
    };
    const fail = /<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/.exec(inner);
    if (fail) {
      const fa = attrs(fail[2]);
      const stack = decodeXml(stripCdata(fail[4] ?? "")).trim();
      tc.outcome = fail[1] === "failure" ? "failed" : "error";
      tc.message = (fa.message ?? stack.split("\n")[0] ?? "").trim();
      tc.type = fa.type;
      Object.assign(tc, locateInStack(stack, cls));
    } else if (/<skipped\b/.test(inner)) {
      tc.outcome = "skipped";
      const sk = /<skipped\b([^>]*)/.exec(inner);
      const skm = sk ? attrs(sk[1]).message : undefined;
      if (skm) tc.message = skm;
    }
    cases.push(tc);
  }

  const count = (o: TestOutcome) => cases.filter((c) => c.outcome === o).length;
  const suite: TestSuiteResult = {
    name,
    tests: sa.tests !== undefined ? Number(sa.tests) : cases.length,
    failures: sa.failures !== undefined ? Number(sa.failures) : count("failed"),
    errors: sa.errors !== undefined ? Number(sa.errors) : count("error"),
    skipped: sa.skipped !== undefined ? Number(sa.skipped) : count("skipped"),
    timeSec: sa.time !== undefined ? Number(sa.time) : undefined,
    reportFile,
  };
  return { suite, cases };
}

/** 리포트 디렉터리의 현재 XML 파일과 mtime 스냅샷(실행 전 상태 기록용). */
export function snapshotReports(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".xml")) continue;
    try {
      const st = fs.statSync(path.join(dir, f));
      if (st.isFile()) out.set(f, st.mtimeMs);
    } catch {
      // 사라진 파일은 무시
    }
  }
  return out;
}

/**
 * 리포트 디렉터리의 JUnit XML 을 모두 읽는다.
 * - `newerThanMs`(숫자): 그 시각보다 오래된 파일 제외.
 * - `previous`(스냅샷): 실행 전에 있던 파일은 mtime 이 그때보다 커진(다시 쓰인) 경우에만 포함 —
 *   연속 실행처럼 시각 기준으로는 구분하기 어려운 이전 실행 결과가 섞이는 것을 막는다.
 */
export function readJUnitReports(
  dir: string,
  filter?: number | { newerThanMs?: number; previous?: Map<string, number> },
): ParsedReport[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const newerThanMs = typeof filter === "number" ? filter : filter?.newerThanMs;
  const previous = typeof filter === "object" ? filter.previous : undefined;
  const out: ParsedReport[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".xml")) continue;
    const full = path.join(dir, f);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      if (newerThanMs !== undefined && st.mtimeMs < newerThanMs) continue;
      const prevMtime = previous?.get(f);
      if (prevMtime !== undefined && st.mtimeMs <= prevMtime) continue;
      const parsed = parseJUnitXml(fs.readFileSync(full, "utf8"), f);
      if (parsed) out.push(parsed);
    } catch {
      // 손상된 리포트는 건너뛴다(로그 tail 로 원인 확인 가능)
    }
  }
  return out;
}

/** 리포트 집합을 요약·실패 목록으로 집계한다. */
export function summarizeReports(
  reports: ParsedReport[],
  maxFailures = 50,
): { summary: TestSummary; suites: TestSuiteResult[]; failures: TestCaseResult[]; failuresTruncated: boolean } {
  const suites = reports.map((r) => r.suite);
  const summary: TestSummary = { suites: suites.length, tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0 };
  for (const s of suites) {
    summary.tests += s.tests;
    summary.failures += s.failures;
    summary.errors += s.errors;
    summary.skipped += s.skipped;
  }
  summary.passed = Math.max(0, summary.tests - summary.failures - summary.errors - summary.skipped);
  const all = reports.flatMap((r) => r.cases).filter((c) => c.outcome === "failed" || c.outcome === "error");
  return { summary, suites, failures: all.slice(0, maxFailures), failuresTruncated: all.length > maxFailures };
}

/**
 * 테스트를 실행한다. dryRun 이면 실행 없이 명령·리포트 위치만 반환한다.
 * runner 를 주입하면(테스트) 실제 프로세스 없이 검증할 수 있다.
 */
export async function runTests(opts: {
  projectDir: string;
  testFilter?: string;
  timeoutMs?: number;
  maxLogLines?: number;
  maxFailures?: number;
  dryRun?: boolean;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  now?: () => number;
}): Promise<TestRunResult> {
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
  const filter = validateTestFilter(opts.testFilter);
  const base = resolveCommand(projectDir, buildTool, "test", { platform: opts.platform });
  const resolved: ResolvedCommand = { ...base, args: resolveTestArgs(buildTool, filter) };
  const command = [resolved.command, ...resolved.args].join(" ");
  const reportDirRel = reportDirFor(buildTool);
  const reportDirAbs = path.join(projectDir, reportDirRel);

  if (opts.dryRun) {
    return {
      buildTool,
      command,
      cwd: resolved.cwd,
      usedWrapper: resolved.usedWrapper,
      dryRun: true,
      reportDir: reportDirRel,
    };
  }

  const runner = opts.runner ?? defaultRunner;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  let buffer = "";
  // 실행 전 리포트 스냅샷: 이번 실행이 새로 쓰거나 다시 쓴 리포트만 결과에 넣는다.
  const previous = snapshotReports(reportDirAbs);
  const started = now();
  const result = await runner(resolved, { timeoutMs, onData: (chunk) => (buffer += chunk) });
  const durationMs = now() - started;

  // 이번 실행이 쓴 리포트만 읽는다(실행 전 스냅샷 대비 새 파일 또는 mtime 이 커진 파일).
  const reports = readJUnitReports(reportDirAbs, { previous });
  const agg = summarizeReports(reports, opts.maxFailures ?? 50);
  const compileErrors = parseBuildErrors(buildTool, buffer);
  const capped = capOutput(buffer, opts.maxLogLines ?? 200);
  const success =
    result.exitCode === 0 && !result.timedOut && agg.summary.failures === 0 && agg.summary.errors === 0;

  return {
    buildTool,
    command,
    cwd: resolved.cwd,
    usedWrapper: resolved.usedWrapper,
    dryRun: false,
    reportDir: reportDirRel,
    success,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs,
    reportsFound: reports.length > 0,
    summary: agg.summary,
    suites: agg.suites,
    failures: agg.failures,
    failuresTruncated: agg.failuresTruncated,
    compileErrors,
    logTail: capped.text,
    logTruncated: capped.truncated,
    totalLogLines: capped.totalLines,
  };
}
