import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 전 도구 공통 허용 root 가드.
 *
 * 환경변수 `EGOVFRAME_ALLOWED_ROOTS`(경로 구분자 `path.delimiter`로 구분)가
 * 설정되면, 도구 인자로 들어오는 모든 디렉터리 경로는 허용 root 중 하나의
 * 내부(또는 root 자신)여야 한다. 설정하지 않으면 기존과 동일하게 제한이 없다.
 *
 * 검사는 파일시스템 실경로(realpath) 기준으로 수행해, 존재하는 상위 경로의
 * symlink를 통한 우회를 file-transaction과 같은 방식으로 차단한다.
 */

export const ALLOWED_ROOTS_ENV = "EGOVFRAME_ALLOWED_ROOTS";

/** 도구 인자 중 허용 root 검사를 적용할 디렉터리 인자 이름. */
const GUARDED_ARG_KEYS = ["outputDir", "projectDir"] as const;

export interface AllowedRootsViolation {
  argument: string;
  input: string;
  resolved: string;
  allowedRoots: string[];
}

/** 허용 root 위반을 구조화된 정보와 함께 전달하는 오류. */
export class AllowedRootsError extends Error {
  readonly violation: AllowedRootsViolation;

  constructor(violation: AllowedRootsViolation) {
    super(
      `허용 root 밖 경로를 거부합니다 (${violation.argument}): ${violation.input}\n` +
        `allowed-roots: ${JSON.stringify(violation.allowedRoots)}`,
    );
    this.name = "AllowedRootsError";
    this.violation = violation;
  }
}

function isOutside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative);
}

/** 존재하는 가장 가까운 상위를 realpath로 바꿔, symlink를 통과한 실제 위치를 계산한다. */
function realCandidate(target: string): string {
  let existingParent = target;
  while (!fs.existsSync(existingParent)) {
    const parent = path.dirname(existingParent);
    if (parent === existingParent) break;
    existingParent = parent;
  }
  const realParent = fs.realpathSync(existingParent);
  return path.resolve(realParent, path.relative(existingParent, target));
}

let cachedEnvValue: string | undefined;
let cachedRoots: string[] | null = null;

/** 허용 root 목록을 읽는다. 미설정·빈 값이면 null(제한 없음). */
export function loadAllowedRoots(envValue = process.env[ALLOWED_ROOTS_ENV]): string[] | null {
  if (envValue === cachedEnvValue) return cachedRoots;
  cachedEnvValue = envValue;
  if (!envValue || !envValue.trim()) {
    cachedRoots = null;
    return cachedRoots;
  }
  const roots: string[] = [];
  for (const raw of envValue.split(path.delimiter)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    roots.push(fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved);
  }
  cachedRoots = roots.length > 0 ? roots : null;
  return cachedRoots;
}

/** 진단·도구 설명용 현재 상태 문자열. */
export function describeAllowedRoots(): string {
  const roots = loadAllowedRoots();
  return roots ? `허용 root ${roots.length}곳: ${roots.join(path.delimiter)}` : "허용 root 제한 없음";
}

/**
 * 단일 경로를 검사한다. 통과하면 resolve된 경로를 반환하고,
 * 위반이면 {@link AllowedRootsError}를 던진다.
 */
export function assertPathAllowed(argument: string, input: string): string {
  const roots = loadAllowedRoots();
  const resolved = path.resolve(input);
  if (!roots) return resolved;
  const real = realCandidate(resolved);
  for (const root of roots) {
    if (real === root || !isOutside(root, real)) return resolved;
  }
  throw new AllowedRootsError({ argument, input, resolved, allowedRoots: roots });
}

/**
 * 도구 인자 객체에서 디렉터리 인자(outputDir·projectDir)를 찾아 일괄 검사한다.
 * 인자가 없으면 아무것도 하지 않으므로 모든 도구 진입점에 안전하게 둘 수 있다.
 */
export function enforceAllowedRoots<T>(args: T): T {
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    for (const key of GUARDED_ARG_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) assertPathAllowed(key, value);
    }
  }
  return args;
}
