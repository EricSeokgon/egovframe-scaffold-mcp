// 원격 저장소 일시 장애 내성 (v1.6.0).
//   표준프레임워크 Maven 저장소(maven.egovframe.go.kr)의 503·연결 끊김이 빌드를 깨뜨리는 일이 잦다.
//   (1) Maven 요청 재시도 인자, (2) 사내 미러 settings, (3) 빌드 출력에서 "저장소 일시 장애"를 가려내는 판정을
//   빌드 도구 실행(build-runner·test-runner·SBOM·의존성 트리)과 생성 CI(GitHub·GitLab·Jenkins)가 함께 쓴다.
//   판정 문구는 scripts/mvn-retry.sh(이 저장소 CI)와 같은 것을 쓴다 — 바꾸면 두 곳을 함께 고친다.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { L } from "./lang.js";

/** Maven 3.9(Resolver 1.9) HTTP 전송의 요청 단위 재시도 — 429·5xx 를 10초 간격으로 5회. 모르는 Maven 은 무시한다. */
export const MAVEN_RETRY_FLAGS = [
  "-Daether.connector.http.retryHandler.count=5",
  "-Daether.connector.http.retryHandler.interval=10000",
  "-Daether.connector.http.retryHandler.serviceUnavailable=429,500,502,503,504",
];

/** 사내 미러 URL(http/https). settings.xml·명령줄·YAML·Groovy 에 들어가므로 구조를 깨는 문자를 막는다. */
export const MAVEN_MIRROR_RE = /^https?:\/\/[A-Za-z0-9.\-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~%\-\/]*)?$/;
export const MAVEN_MIRROR_ENV = "EGOVFRAME_MAVEN_MIRROR";

export function validateMavenMirror(url: string): string {
  const v = url.trim();
  if (!MAVEN_MIRROR_RE.test(v)) throw new Error(L(
    `mavenMirror 는 http(s) URL 이어야 합니다(따옴표·공백·& 불가): ${JSON.stringify(url)}`,
    `mavenMirror must be an http(s) URL (no quotes, spaces or &): ${JSON.stringify(url)}`));
  return v;
}

/** 모든 저장소(`*`)를 미러로 보내는 settings.xml. 한 줄(생성 CI 의 printf·writeFile 에 그대로 넣음). */
export function mavenMirrorSettings(url: string): string {
  const u = validateMavenMirror(url);
  return `<settings xmlns="http://maven.apache.org/SETTINGS/1.2.0"><mirrors><mirror><id>egovframe-mirror</id><name>egovframe-scaffold-mcp mirror</name><mirrorOf>*</mirrorOf><url>${u}</url></mirror></mirrors></settings>`;
}

/** 생성 CI 가 작업 디렉터리에 쓰는 미러 settings 파일(-gs: 사용자 settings 의 인증·미러를 지우지 않고 합침) */
export const CI_MIRROR_SETTINGS = ".egovframe-ci-settings.xml";

/** 빌드 출력에서 원격 저장소 실패임을 나타내는 문맥(소문자 부분 문자열) */
export const TRANSIENT_CONTEXT = ["could not transfer", "transfer failed", "non-resolvable", "could not resolve", "failed to read artifact descriptor", "could not be resolved", "could not get resource", "could not download"];
/** 그 실패가 일시 장애임을 나타내는 원인(소문자 부분 문자열). 404·401 같은 영구 실패는 넣지 않는다. */
export const TRANSIENT_CAUSE = ["status: 5", "status code: 5", "status code 5", "connection reset", "timed out", "remote host terminated the handshake", "service unavailable", "bad gateway", "gateway timeout", "gateway time-out"];

export type FailureKind = "compile" | "test" | "repository-unavailable" | "timeout" | "other";
export interface RepositoryFailure { url?: string; status?: number; line: string }

/** 출력에 원격 저장소 일시 장애가 있으면 그 줄·URL·상태 코드를, 없으면 null. */
export function findRepositoryFailure(output: string): RepositoryFailure | null {
  const low = output.toLowerCase();
  if (!TRANSIENT_CONTEXT.some((c) => low.includes(c)) || !TRANSIENT_CAUSE.some((c) => low.includes(c))) return null;
  const lines = output.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (!TRANSIENT_CAUSE.some((c) => l.includes(c))) continue;
    // 원인 줄 또는 바로 위 몇 줄에서 URL 을 찾는다(Gradle 은 "Could not GET 'url'" 다음 줄에 상태가 온다)
    // 원인 바로 앞의 URL(Maven: "from/to egovframe (저장소) … transfer failed for <파일 URL>, status: 503")
    const URL_RE = /https?:\/\/[^\s'"`,)\]]+/g;
    const at = Math.min(...TRANSIENT_CAUSE.map((c) => l.indexOf(c)).filter((x) => x >= 0));
    const inLine = [...lines[i].matchAll(URL_RE)];
    let url: string | undefined = (inLine.filter((u) => (u.index ?? 0) < at).pop() ?? inLine[0])?.[0];
    for (let j = i - 1; j >= Math.max(0, i - 3) && !url; j--) url = [...lines[j].matchAll(URL_RE)].pop()?.[0];
    const st = lines[i].match(/status(?: code)?:?\s*(5\d\d)/i)?.[1];
    return { ...(url ? { url: url.replace(/[.,;:]+$/, "") } : {}), ...(st ? { status: Number(st) } : {}), line: lines[i].replace(/^\s*\[(ERROR|FATAL|WARNING)\]\s*/, "").trim().slice(0, 300) };
  }
  return null;
}

/** 실패 종류 판정. 컴파일 오류가 있으면 저장소 문구가 섞여 있어도 compile(코드 문제가 먼저). */
export function classifyFailure(input: { output: string; timedOut?: boolean; compileErrors?: number; testFailures?: number; goal?: string }): { kind: FailureKind; repository?: RepositoryFailure } {
  if (input.timedOut) return { kind: "timeout" };
  if ((input.compileErrors ?? 0) > 0) return { kind: "compile" };
  const repo = findRepositoryFailure(input.output);
  if (repo) return { kind: "repository-unavailable", repository: repo };
  if ((input.testFailures ?? 0) > 0 || (input.goal === "test" && /There are test failures|Tests run:.*Failures: [1-9]|Tests run:.*Errors: [1-9]|tests completed, \d+ failed/.test(input.output))) return { kind: "test" };
  return { kind: "other" };
}

/** repository-unavailable 일 때 사용자에게 보일 안내 */
export function repositoryFailureHint(repo: RepositoryFailure | undefined, attempts: number): string {
  const where = repo?.url ? `${repo.url}${repo.status ? ` (HTTP ${repo.status})` : ""}` : L("원격 저장소", "a remote repository");
  return L(
    `${where} 가 응답하지 않아 빌드하지 못했습니다(시도 ${attempts}회) — 코드 문제가 아닙니다. 잠시 뒤 다시 실행하거나 diagnose_egovframe_network 로 확인하고, 사내 미러(Nexus·Artifactory)가 있으면 ${MAVEN_MIRROR_ENV} 로 지정하세요.`,
    `The build could not reach ${where} (${attempts} attempt(s)) — this is not a code problem. Retry later or run diagnose_egovframe_network; if you have an internal mirror (Nexus, Artifactory), set ${MAVEN_MIRROR_ENV}.`);
}

/** 미러 settings 를 임시 파일로(내용이 같으면 재사용). */
function mirrorSettingsFile(url: string): string {
  const content = mavenMirrorSettings(url);
  const file = path.join(os.tmpdir(), `egovframe-mirror-${Buffer.from(url).toString("hex").slice(0, 40)}.xml`);
  try { if (fs.readFileSync(file, "utf8") === content) return file; } catch { /* 없음 */ }
  fs.writeFileSync(file, content);
  return file;
}

/**
 * Maven 실행 환경의 MAVEN_ARGS(Maven 3.9 가 명령줄 앞에 붙이는 인자)에 재시도 인자와 미러(-gs)를 더한다.
 * 이미 재시도 설정이 있으면(사용자·CI 가 지정) 그대로 둔다. 명령 문자열은 바꾸지 않는다.
 */
export function mavenResilienceEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const base = (env.MAVEN_ARGS ?? "").trim();
  const parts = base ? [base] : [];
  if (!/retryHandler\.count/.test(base)) parts.push(...MAVEN_RETRY_FLAGS);
  const mirror = env[MAVEN_MIRROR_ENV]?.trim();
  if (mirror && !/(^|\s)-gs(\s|=)|--global-settings/.test(base)) {
    const file = mirrorSettingsFile(mirror);
    // MAVEN_ARGS 는 공백으로 나뉘므로 공백 있는 임시 경로(Windows 사용자 이름 등)는 쓸 수 없다 — 그때는 미러 없이 진행
    if (!/\s/.test(file)) parts.push("-gs", file);
  }
  return { MAVEN_ARGS: parts.join(" ") };
}

/** 생성 CI 셸(bash·sh)용 판정: 두 grep 이 모두 맞아야 일시 장애. */
export function shellTransientTest(logFile: string): string {
  const g = (xs: string[]) => `grep -Fiq ${xs.map((x) => `-e '${x}'`).join(" ")} ${logFile}`;
  return `${g(TRANSIENT_CONTEXT)} && ${g(TRANSIENT_CAUSE)}`;
}
