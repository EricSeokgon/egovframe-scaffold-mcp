// 동봉 규칙·기준 카탈로그의 upstream drift 감시 (v0.34, sync_egovframe_templates 의 한 절 — 읽기 전용).
// (1) migration-rules.json 의 근거 태그(egovframe-runtime toTag, egovframe-common-components toTag)보다 새 태그가 있는지,
// (2) dependency-baseline.json 의 parent 2종보다 새 버전이 저장소에 있는지(표준프레임워크 저장소는 maven-metadata.xml 과 디렉터리 목록을
//     막아 두어 다음 patch·minor·major 후보를 HEAD 로 탐침한다), (3) 고정한 parent pom·Spring Boot BOM pom 의 sha256 이 바뀌었는지를 보고한다.
// 파일은 고치지 않는다. 변화가 있으면 README 의 갱신 절차를 결과에 붙인다.
import { createHash } from "node:crypto";
import { loadDependencyBaseline, type DependencyBaseline } from "./dependencies.js";
import { loadMigrationRules, versionBelow, type MigrationRules } from "./migrate.js";

export const DRIFT_TIMEOUT_MS = 20_000;
const UA = { "User-Agent": "egovframe-scaffold-mcp" };

export type FetchTextFn = (url: string, timeoutMs: number) => Promise<string>;
export type FetchStatusFn = (url: string, timeoutMs: number) => Promise<number>;

export interface TagDrift {
  repository: string;
  pinnedTag: string;
  pinnedCommit: string;
  /** 고정 태그보다 새 태그(버전 내림차순) */
  newerTags: string[];
  /** 조회한 태그 수 */
  seen: number;
  /** 태그 목록 출처: GitHub API 또는 태그 페이지(HTML) */
  source: "api" | "html" | null;
  error?: string;
}
export interface ParentDrift {
  kind: string;
  groupId: string;
  artifactId: string;
  pinnedVersion: string;
  /** 탐침한 후보 버전 */
  probed: string[];
  /** 저장소에 존재하는 더 새로운 버전 */
  newerVersions: string[];
  /** 고정 pom 의 sha256 이 바뀌었는지(조회 실패면 null) */
  sha256Changed: boolean | null;
  error?: string;
}
export interface BomDrift { groupId: string; artifactId: string; version: string; sha256Changed: boolean | null; error?: string }
export interface CatalogDriftResult {
  migrationRules: { surveyedAt: string; runtime: TagDrift; components: TagDrift | null };
  dependencyBaseline: { surveyedAt: string; parents: ParentDrift[]; bootBom: BomDrift | null };
  /** 새 태그·새 parent 버전·sha256 변화가 하나도 없음(조회 실패는 drift 로 치지 않는다) */
  upToDate: boolean;
  /** 조회 실패 항목 수 */
  errors: number;
  warnings: string[];
  /** 변화가 있을 때 사람이 따라갈 갱신 절차(README 와 같은 내용) */
  procedure: string[];
}

export interface CatalogDriftDeps {
  fetchText?: FetchTextFn;
  fetchStatus?: FetchStatusFn;
  rules?: MigrationRules;
  baseline?: DependencyBaseline;
  /** GitHub API 토큰(선택, 비인증 한도 60회/시간 회피) — 기본은 process.env.GITHUB_TOKEN */
  githubToken?: string | null;
}

/** 일시적 네트워크 오류("fetch failed"·연결 재설정)는 1초·2초 뒤 두 번 더 시도한다. HTTP 상태 오류·시간 초과는 그대로 던진다. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (error) {
      const transient = error instanceof TypeError || /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(String((error as Error)?.message) + String((error as { cause?: unknown })?.cause ?? ""));
      if (!transient || i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}
async function defaultFetchText(url: string, timeoutMs: number): Promise<string> {
  return withRetry(() => fetchTextOnce(url, timeoutMs));
}
async function defaultFetchStatus(url: string, timeoutMs: number): Promise<number> {
  return withRetry(() => fetchStatusOnce(url, timeoutMs));
}
async function fetchTextOnce(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: UA });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    return await res.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`시간 초과(${timeoutMs}ms): ${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function fetchStatusOnce(url: string, timeoutMs: number): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal, headers: UA, redirect: "follow" });
    return res.status;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`시간 초과(${timeoutMs}ms): ${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** 태그 이름에서 버전 숫자를 뽑는다(v5.0.2-Final → 5.0.2). 숫자가 없으면 null. */
export function tagVersion(tag: string): string | null {
  return tag.match(/\d+(?:\.\d+)+/)?.[0] ?? null;
}

/** GitHub API 응답(JSON 배열) 또는 태그 페이지(HTML)에서 태그 이름을 뽑는다. */
export function parseTagList(text: string, repository: string): { tags: string[]; source: "api" | "html" } | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (Array.isArray(arr)) {
        const tags = arr.map((t) => (t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string" ? (t as { name: string }).name : null)).filter((t): t is string => !!t);
        if (tags.length) return { tags, source: "api" };
      }
    } catch { /* HTML 로 다시 시도 */ }
  }
  const re = new RegExp(`/${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/releases/tag/([^"'<>\\s/?#]+)`, "g");
  const tags = [...text.matchAll(re)].map((m) => decodeURIComponent(m[1]));
  const uniq = [...new Set(tags)];
  return uniq.length ? { tags: uniq, source: "html" } : null;
}

/** 고정 태그보다 새 태그를 버전 내림차순으로 고른다(버전 숫자가 없는 태그는 무시). */
export function newerTagsThan(tags: string[], pinnedTag: string): string[] {
  const pv = tagVersion(pinnedTag);
  if (!pv) return [];
  return tags
    .filter((t) => { const v = tagVersion(t); return v !== null && versionBelow(pv, v) === true; })
    .sort((a, b) => (versionBelow(tagVersion(a)!, tagVersion(b)!) ? 1 : -1));
}

async function checkTags(repository: string, pinnedTag: string, pinnedCommit: string, fetchText: FetchTextFn, token: string | null): Promise<TagDrift> {
  const base: TagDrift = { repository, pinnedTag, pinnedCommit, newerTags: [], seen: 0, source: null };
  const attempts: { url: string; headers?: Record<string, string> }[] = [
    { url: `https://api.github.com/repos/${repository}/tags?per_page=100`, headers: token ? { Authorization: `Bearer ${token}` } : undefined },
    { url: `https://github.com/${repository}/tags` },
  ];
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      // 주입된 fetchText 는 헤더를 받지 않는다(토큰은 기본 구현에서만 쓴다)
      const text = a.headers && fetchText === defaultFetchText ? await fetchWithHeaders(a.url, a.headers) : await fetchText(a.url, DRIFT_TIMEOUT_MS);
      const parsed = parseTagList(text, repository);
      if (!parsed) { errors.push(`${a.url}: 태그 목록을 해석하지 못함`); continue; }
      return { ...base, newerTags: newerTagsThan(parsed.tags, pinnedTag), seen: parsed.tags.length, source: parsed.source };
    } catch (error) {
      errors.push(`${a.url}: ${(error as Error).message}`);
    }
  }
  return { ...base, error: errors.join(" / ") };
}
async function fetchWithHeaders(url: string, headers: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRIFT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { ...UA, Accept: "application/vnd.github+json", ...headers } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 고정 버전 X.Y.Z 의 후보: patch +1..+3, minor +1, major +1 */
export function candidateVersions(version: string): string[] {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return [];
  const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return [`${x}.${y}.${z + 1}`, `${x}.${y}.${z + 2}`, `${x}.${y}.${z + 3}`, `${x}.${y + 1}.0`, `${x + 1}.0.0`];
}
const pomUrlOf = (repo: string, groupId: string, artifactId: string, version: string) => `${repo}${groupId.replace(/\./g, "/")}/${artifactId}/${version}/${artifactId}-${version}.pom`;

async function checkParent(src: DependencyBaseline["sources"][number], repo: string, fetchText: FetchTextFn, fetchStatus: FetchStatusFn): Promise<ParentDrift> {
  const probed = candidateVersions(src.version);
  const out: ParentDrift = { kind: src.kind, groupId: src.groupId, artifactId: src.artifactId, pinnedVersion: src.version, probed, newerVersions: [], sha256Changed: null };
  const errors: string[] = [];
  await Promise.all(probed.map(async (v) => {
    try {
      const status = await fetchStatus(pomUrlOf(repo, src.groupId, src.artifactId, v), DRIFT_TIMEOUT_MS);
      if (status >= 200 && status < 300) out.newerVersions.push(v);
    } catch (error) { errors.push(`${v}: ${(error as Error).message}`); }
  }));
  out.newerVersions.sort((a, b) => (versionBelow(a, b) ? 1 : -1));
  try {
    out.sha256Changed = sha256(await fetchText(src.url, DRIFT_TIMEOUT_MS)) !== src.sha256;
  } catch (error) { errors.push(`pom: ${(error as Error).message}`); }
  if (errors.length) out.error = errors.join(" / ");
  return out;
}

/** 규칙·기준 카탈로그의 drift 를 조사한다(네트워크, 읽기 전용). 조회 실패는 항목별 error 로 남기고 예외를 던지지 않는다. */
export async function checkCatalogDrift(deps: CatalogDriftDeps = {}): Promise<CatalogDriftResult> {
  const rules = deps.rules ?? loadMigrationRules();
  const baseline = deps.baseline ?? loadDependencyBaseline();
  const fetchText = deps.fetchText ?? defaultFetchText;
  const fetchStatus = deps.fetchStatus ?? defaultFetchStatus;
  const token = deps.githubToken === undefined ? (process.env.GITHUB_TOKEN ?? null) : deps.githubToken;

  const [runtime, components, parents, bootBom] = await Promise.all([
    checkTags(rules.source.repository, rules.source.toTag, rules.source.toCommit, fetchText, token),
    rules.source.components ? checkTags(rules.source.components.repository, rules.source.components.toTag, rules.source.components.toCommit, fetchText, token) : Promise.resolve(null),
    Promise.all(baseline.sources.map((s) => checkParent(s, baseline.repository, fetchText, fetchStatus))),
    (async (): Promise<BomDrift | null> => {
      if (!baseline.boot) return null;
      const b = baseline.boot.bom;
      const out: BomDrift = { groupId: b.groupId, artifactId: b.artifactId, version: b.version, sha256Changed: null };
      try { out.sha256Changed = sha256(await fetchText(b.url, DRIFT_TIMEOUT_MS)) !== b.sha256; } catch (error) { out.error = (error as Error).message; }
      return out;
    })(),
  ]);

  const warnings: string[] = [];
  const procedure: string[] = [];
  if (runtime.newerTags.length) {
    warnings.push(`egovframe-runtime 에 규칙 근거(${runtime.pinnedTag})보다 새 태그가 있습니다: ${runtime.newerTags.join(", ")} — 전환 규칙·목표 RTE 버전이 뒤처질 수 있습니다`);
    procedure.push(`catalog/migration-mapping.json 의 runtime.toTag 를 ${runtime.newerTags[0]} 로 올리고 \`node scripts/generate-migration-rules.mjs --runtime-dir <clone> --components-dir <clone>\` 로 규칙을 다시 생성(제거 클래스에 새 사유가 필요하면 생성기가 멈춥니다) → \`npm run test:migration-rules\``);
  }
  if (components?.newerTags.length) {
    warnings.push(`egovframe-common-components 에 대응표 근거(${components.pinnedTag})보다 새 태그가 있습니다: ${components.newerTags.join(", ")}`);
    procedure.push(`catalog/migration-mapping.json 의 components.toTag 를 ${components.newerTags[0]} 로 올리고 규칙을 다시 생성(공통컴포넌트 카탈로그 generate:catalog 도 같은 태그로 갱신)`);
  }
  const parentFlags: string[] = [];
  for (const p of parents) {
    if (p.newerVersions.length) {
      warnings.push(`${p.artifactId} ${p.pinnedVersion} 보다 새 버전이 저장소에 있습니다: ${p.newerVersions.join(", ")}`);
      parentFlags.push(`--${p.kind} ${p.newerVersions[0]}`);
    }
    if (p.sha256Changed) warnings.push(`${p.artifactId} ${p.pinnedVersion} pom 의 sha256 이 고정값과 다릅니다 — 같은 버전이 다시 배포됐습니다. 기준을 다시 생성해 차이를 확인하세요`);
  }
  if (parentFlags.length) procedure.push(`\`node scripts/generate-dependency-baseline.mjs ${parentFlags.join(" ")}\` 로 기준을 다시 생성(scripts 의 PARENTS 기본값도 올림) → \`npm run test:dependencies\``);
  if (bootBom?.sha256Changed) warnings.push(`spring-boot-dependencies ${bootBom.version} pom 의 sha256 이 고정값과 다릅니다(Maven Central 재배포) — 기준을 다시 생성해 확인하세요`);
  if (warnings.length) procedure.push("README 의 '변경 이력' 에 갱신 내용을 적고 버전을 올려 릴리스");
  const errors = [runtime, components, ...parents, bootBom].filter((x) => x && x.error).length;
  const upToDate = !runtime.newerTags.length && !(components?.newerTags.length) && parents.every((p) => !p.newerVersions.length && !p.sha256Changed) && !bootBom?.sha256Changed;
  return {
    migrationRules: { surveyedAt: rules.surveyedAt, runtime, components },
    dependencyBaseline: { surveyedAt: baseline.surveyedAt, parents, bootBom },
    upToDate,
    errors,
    warnings,
    procedure: [...new Set(procedure)],
  };
}

/** sync_egovframe_templates 응답에 붙일 요약 줄. */
export function renderCatalogDriftLines(r: CatalogDriftResult): string[] {
  const L: string[] = [];
  const tagLine = (label: string, t: TagDrift | null) => {
    if (!t) return;
    if (t.error) L.push(`  - ${label}: 확인 실패 (${t.error})`);
    else L.push(`  - ${label}: 고정 ${t.pinnedTag}(${t.pinnedCommit.slice(0, 7)}) · 조회 ${t.seen}개(${t.source}) · 새 태그 ${t.newerTags.length ? t.newerTags.join(", ") : "없음"}`);
  };
  L.push(`- 규칙 카탈로그(migration-rules, 조사일 ${r.migrationRules.surveyedAt})`);
  tagLine("egovframe-runtime", r.migrationRules.runtime);
  tagLine("egovframe-common-components", r.migrationRules.components);
  L.push(`- 의존성 기준(dependency-baseline, 조사일 ${r.dependencyBaseline.surveyedAt})`);
  for (const p of r.dependencyBaseline.parents) {
    L.push(`  - ${p.artifactId} ${p.pinnedVersion}: 새 버전 ${p.newerVersions.length ? p.newerVersions.join(", ") : "없음"}(탐침 ${p.probed.join("·")}) · pom sha256 ${p.sha256Changed === null ? "확인 실패" : p.sha256Changed ? "변경됨" : "동일"}${p.error ? ` · 오류: ${p.error}` : ""}`);
  }
  if (r.dependencyBaseline.bootBom) {
    const b = r.dependencyBaseline.bootBom;
    L.push(`  - ${b.artifactId} ${b.version}: pom sha256 ${b.sha256Changed === null ? "확인 실패" : b.sha256Changed ? "변경됨" : "동일"}${b.error ? ` · 오류: ${b.error}` : ""}`);
  }
  L.push(`- 카탈로그 drift: ${r.upToDate ? "없음" : "있음"}${r.errors ? ` (확인 실패 ${r.errors}건)` : ""}`);
  for (const w of r.warnings) L.push(`- 경고: ${w}`);
  if (r.procedure.length) { L.push(`- 갱신 절차:`); r.procedure.forEach((p, i) => L.push(`  ${i + 1}. ${p}`)); }
  return L;
}
