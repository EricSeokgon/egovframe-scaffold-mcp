// 의존성 점검 (check_egovframe_dependencies, v0.30.0 — 읽기 전용).
// 프로젝트의 Maven/Gradle 의존성을 공식 5.x parent 가 관리하는 기준 버전(catalog/dependency-baseline.json)과 대조하고,
// 보안 설정의 존재 여부를 파일·라인 근거와 함께 보고한다. 기본은 오프라인이며 offline=false 일 때만 OSV 로 알려진 취약점을 조회한다.
// v0.34: 기준 출처를 parent 직접 → 계열(BOM import·버전 속성) → Spring Boot BOM 전체 → RTE 모듈 전이 순으로 넓혀 '기준 없음'을 줄이고,
//        항목마다 basis 로 어느 기준과 대조했는지 적는다. Boot parent 프로젝트는 Boot BOM 을, 그 밖은 RTE 전이를 먼저 본다.
import * as fs from "node:fs";
import * as path from "node:path";
import { diagnoseProject } from "./diagnose.js";
import { DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "./shared.js";
import { lineAt, loadMigrationRules, parsePomDeps, parsePomProperties, resolveProp, versionBelow, walkProjectFiles, type MigrationRules } from "./migrate.js";
import { resolveDependencyTree, type DependencyTreeResult, type ResolveScope } from "./dependency-tree.js";
import type { Runner } from "./build-runner.js";

export interface BaselineManaged { groupId: string; artifactId: string; version: string; scope?: string; type?: string; sources: ("web" | "boot")[]; versionBySource?: Record<string, string>; parentVersion?: string }
export interface DependencyBaseline {
  schemaVersion: number;
  surveyedAt: string;
  repository: string;
  sources: { kind: "web" | "boot"; groupId: string; artifactId: string; version: string; url: string; sha256: string; managed: number; parent?: { groupId: string; artifactId: string; version: string } }[];
  java: number;
  rte: { version: string; parentManaged: Record<string, string | null> };
  spring: { framework: string | null; boot: string | null; security: string | null };
  properties: { web: Record<string, string>; boot: Record<string, string> };
  managed: BaselineManaged[];
  /** BOM import·버전 속성이 정하는 groupId 계열 기준(개별 artifact 가 managed 에 없어도 적용) */
  families: { groupIdPrefix: string; version: string; via: string; matchSubgroups?: boolean }[];
  /** 달력형 릴리스 트레인 BOM(구성 artifact 버전이 달라 계열 규칙으로 쓰지 않음) — schemaVersion 2 */
  releaseTrains?: { groupId: string; artifactId: string; version: string; sources: string[] }[];
  /** Spring Boot BOM 전체(직접 항목 + import 한 단계) — schemaVersion 2 */
  boot?: {
    bom: { groupId: string; artifactId: string; version: string; url: string; sha256: string; direct: number; imports: number };
    imports: { groupId: string; artifactId: string; version: string; url: string; sha256: string; members: number; unresolved?: number }[];
    conflicts: number;
    /** "groupId:artifactId" → version */
    managed: Record<string, string>;
  };
  /** RTE 모듈 18종이 끌어오는 전이 의존성 — schemaVersion 2 */
  rteTransitive?: {
    version: string;
    root: { artifactId: string; url: string; sha256: string };
    modules: { artifactId: string; url: string; sha256: string; dependencies: number }[];
    /** "groupId:artifactId" → { version, scope, via: 모듈 약칭(fdl-cmmn …) } */
    managed: Record<string, { version: string; scope: string; via: string[] }>;
  };
}

const BASELINE_URL = new URL("../catalog/dependency-baseline.json", import.meta.url);
let cached: DependencyBaseline | null = null;
export function loadDependencyBaseline(): DependencyBaseline {
  if (!cached) cached = JSON.parse(fs.readFileSync(BASELINE_URL, "utf8")) as DependencyBaseline;
  return cached;
}

export type DependencyStatus = "ok" | "outdated" | "managed" | "legacy" | "replace" | "vendor" | "unknown" | "unversioned";
/** 어느 기준과 대조했는지 (v0.34) */
export type DependencyBasis = "parent" | "family" | "boot-bom" | "rte-transitive" | "migration-rules";
export const BASIS_LABEL: Record<DependencyBasis, string> = { parent: "parent 직접", family: "계열", "boot-bom": "Boot BOM", "rte-transitive": "RTE 전이", "migration-rules": "전환 규칙" };
export interface DependencyFinding {
  file: string; line: number;
  groupId: string; artifactId: string;
  /** pom 에 적힌 그대로(속성 참조 포함), 없으면 null */
  version: string | null;
  /** 속성을 푼 버전, 못 풀면 null */
  resolvedVersion: string | null;
  scope: string | null;
  status: DependencyStatus;
  /** 기준 버전(baseline 에 있을 때) */
  baseline: string | null;
  /** 기준 출처(기준이 없으면 null) */
  basis: DependencyBasis | null;
  /** 빌드 파일에 적힌 의존성(declared) 인지, resolve=true 로 해석한 트리에서만 나온 전이 의존성(transitive) 인지 (v0.36) */
  origin: "declared" | "transitive";
  /** 전이 의존성의 트리 경로(루트에서 이 artifact 까지의 artifactId, 자신 제외) */
  via?: string[];
  /** 트리 깊이(1 = 직접) — 해석 결과가 있을 때 */
  depth?: number;
  /** 해석된 트리의 버전이 선언과 다를 때 트리 버전 */
  treeVersion?: string;
  note?: string;
}
export interface SecurityCheck { id: string; title: string; status: "ok" | "missing" | "n/a"; evidence: { file: string; line: number; text: string }[]; hint: string }
export interface Vulnerability { dependency: string; version: string; ids: string[] }
export interface ParentInfo { groupId: string | null; artifactId: string | null; version: string | null; kind: "web" | "boot" | "other" | "none"; status: "ok" | "outdated" | "n/a" }
export interface CheckDependenciesResult {
  projectDir: string;
  buildSystem: "maven" | "gradle" | "unknown";
  offline: boolean;
  baseline: { surveyedAt: string; rte: string; springFramework: string | null; springBoot: string | null; java: number; bootBom?: number; rteTransitive?: number };
  parent: ParentInfo;
  java: { value: string | null; status: "ok" | "outdated" | "unknown" };
  findings: DependencyFinding[];
  summary: Record<DependencyStatus, number>;
  checks: SecurityCheck[];
  vulnerabilities?: Vulnerability[];
  osvError?: string;
  /** resolve=true 의 해석 결과 요약 (v0.36) */
  resolution?: {
    ran: boolean; success: boolean; scope: ResolveScope; command: string; durationMs?: number;
    /** 해석된 artifact 수(중복 제거) · 그중 직접(깊이 1) · 선언에 없던 전이 */
    artifacts: number; direct: number; transitive: number;
    /** 선언 버전과 해석 버전이 다른 좌표(가까운 선언이 이긴 결과) */
    differs: { groupId: string; artifactId: string; declared: string; resolved: string }[];
    /** 해석된 집합의 판정 집계 */
    summary: Record<DependencyStatus, number>;
    error?: string;
  };
  notes: string[];
}
export type OsvQuery = (queries: { package: { name: string; ecosystem: "Maven" }; version: string }[]) => Promise<{ results: { vulns?: { id: string }[] }[] }>;
export interface CheckDependenciesOptions {
  projectDir: string; offline?: boolean; osvQuery?: OsvQuery; maxFiles?: number;
  /** v0.36: 빌드 도구로 전이 의존성까지 해석해 함께 판정한다(기본 false — 선언만) */
  resolve?: boolean;
  /** runtime(기본: compile+runtime) | all(test·provided 포함) */
  resolveScope?: ResolveScope;
  resolveTimeoutMs?: number;
  /** 테스트용 가짜 runner·플랫폼 */
  runner?: Runner;
  platform?: NodeJS.Platform | string;
}

const OSV_URL = "https://api.osv.dev/v1/querybatch";
export const defaultOsvQuery: OsvQuery = async (queries) => {
  const res = await fetchWithTimeout(OSV_URL, DOWNLOAD_TIMEOUT_MS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queries }) });
  if (!res.ok) throw new Error(`OSV ${res.status} ${res.statusText}`);
  return (await res.json()) as { results: { vulns?: { id: string }[] }[] };
};

const SKIP_SCOPES = new Set<string>(); // 모든 scope 를 본다(test 도 취약점 대상)

/** 좌표 하나를 분류한다(순수 함수, 테스트 대상). */
export function classifyDependency(
  dep: { groupId: string; artifactId: string; version: string | null; resolvedVersion: string | null },
  ctx: { baseline: DependencyBaseline; rules: MigrationRules; parentKind: ParentInfo["kind"] },
): { status: DependencyStatus; baseline: string | null; basis: DependencyBasis | null; note?: string } {
  const key = `${dep.groupId}:${dep.artifactId}`;
  const { baseline, rules } = ctx;
  // 1) 3.x/4.x RTE 좌표·javax 좌표 → 전환 대상
  for (const c of rules.coordinates) if (c.from.some((f) => `${f.groupId}:${f.artifactId}` === key))
    return { status: "legacy", baseline: `${c.to.groupId}:${c.to.artifactId}:${rules.target.runtimeVersion}`, basis: "migration-rules", note: `${rules.source.fromTag.replace(/^v/, "")} 계열 RTE 좌표 — migrate_egovframe_project 로 5.x 좌표로 전환` };
  if (rules.removedModules.some((m) => m.fromArtifactId === dep.artifactId && /^(egovframework\.rte|org\.egovframe\.rte)$/.test(dep.groupId)))
    return { status: "replace", baseline: null, basis: "migration-rules", note: rules.removedModules.find((m) => m.fromArtifactId === dep.artifactId)!.reason };
  const jk = rules.jakarta.artifacts.find((a) => `${a.from.groupId}:${a.from.artifactId}` === key);
  if (jk) return { status: "legacy", baseline: `${jk.to.groupId}:${jk.to.artifactId}:${jk.toVersion}`, basis: "migration-rules", note: "javax 좌표 — Jakarta 좌표로 전환(migrate_egovframe_project)" };
  // 2) 교체 필요 라이브러리
  for (const lib of rules.libraries) {
    if (lib.match.groupId !== dep.groupId) continue;
    const re = new RegExp(`^${lib.match.artifactId.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    if (!re.test(dep.artifactId)) continue;
    if (lib.match.versionBelow) {
      if (!dep.resolvedVersion) continue;
      if (versionBelow(dep.resolvedVersion, lib.match.versionBelow) !== true) continue;
    }
    return { status: "replace", baseline: lib.replacement, basis: "migration-rules", note: lib.reason };
  }
  // 3) 기준 목록: parent 직접 → 계열 → (Boot parent 면 Boot BOM → RTE 전이, 아니면 RTE 전이 → Boot BOM)
  const exact = baseline.managed.find((x) => x.groupId === dep.groupId && x.artifactId === dep.artifactId);
  // 계열은 groupId 가 정확히 같을 때 적용하고, matchSubgroups 인 계열(jackson)만 하위 groupId 도 받는다. schemaVersion 1 기준(필드 없음)은 예전처럼 접두 일치.
  const family = exact ? null : [...baseline.families].filter((f) => dep.groupId === f.groupIdPrefix || ((f.matchSubgroups ?? baseline.schemaVersion < 2) && dep.groupId.startsWith(`${f.groupIdPrefix}.`))).sort((a, b) => b.groupIdPrefix.length - a.groupIdPrefix.length)[0] ?? null;
  const bootV = baseline.boot?.managed[key];
  const rte = baseline.rteTransitive?.managed[key];
  let m: { version: string; basis: DependencyBasis; note?: string } | null = null;
  if (exact) m = { version: exact.version, basis: "parent" };
  else if (family) m = { version: family.version, basis: "family", note: `계열 기준: ${family.via}` };
  else {
    const boot = bootV ? { version: bootV, basis: "boot-bom" as const, note: `Spring Boot ${baseline.boot!.bom.version} BOM 기준` } : null;
    const rt = rte ? { version: rte.version, basis: "rte-transitive" as const, note: `RTE ${baseline.rteTransitive!.version} ${rte.via.join("·")} 의 전이 버전` } : null;
    m = ctx.parentKind === "boot" ? (boot ?? rt) : (rt ?? boot);
  }
  const withNote = (r: { status: DependencyStatus; baseline: string | null; basis: DependencyBasis | null }, note?: string) => (note ? { ...r, note } : r);
  if (!dep.version) {
    if (ctx.parentKind === "web" || ctx.parentKind === "boot")
      return withNote({ status: "managed", baseline: m?.version ?? null, basis: m?.basis ?? null }, m ? (m.basis === "parent" ? undefined : m.note) : (ctx.parentKind === "boot" ? "Spring Boot BOM 에도 없는 좌표 — 버전 출처 확인" : "parent 에 없는 좌표 — 버전 출처 확인"));
    return withNote({ status: "unversioned", baseline: m?.version ?? null, basis: m?.basis ?? null }, "버전이 없고 5.x parent 도 없음 — dependencyManagement 또는 명시 버전 필요");
  }
  if (!m) {
    const vendor = (rules.vendorCoordinates ?? []).filter((v) => dep.groupId === v.groupIdPrefix || dep.groupId.startsWith(`${v.groupIdPrefix}.`)).sort((a, b) => b.groupIdPrefix.length - a.groupIdPrefix.length)[0];
    if (vendor) return { status: "vendor", baseline: null, basis: null, note: vendor.note };
    return { status: "unknown", baseline: null, basis: null, note: "기준 목록(공식 5.x parent·Spring Boot BOM·RTE 전이)에 없는 좌표 — 판단 보류" };
  }
  if (!dep.resolvedVersion) return withNote({ status: "unknown", baseline: m.version, basis: m.basis }, `버전 속성을 풀지 못함: ${dep.version}`);
  const below = versionBelow(dep.resolvedVersion, m.version);
  if (below === null) return withNote({ status: "unknown", baseline: m.version, basis: m.basis }, `버전을 비교할 수 없음: ${dep.resolvedVersion}`);
  if (below && m.basis === "rte-transitive") return { status: "outdated", baseline: m.version, basis: m.basis, note: `${m.note} — 명시 버전이 더 낮아 전이 버전과 충돌할 수 있음(Maven 은 가까운 선언을 택함)` };
  return withNote({ status: below ? "outdated" : "ok", baseline: m.version, basis: m.basis }, m.note);
}

interface RawDep { file: string; line: number; groupId: string; artifactId: string; version: string | null; resolvedVersion: string | null; scope: string | null }

function collectMaven(dir: string, files: string[], baseline: DependencyBaseline): { deps: RawDep[]; parent: ParentInfo; java: string | null; repoIssues: { file: string; line: number; text: string }[] } {
  const deps: RawDep[] = [];
  const repoIssues: { file: string; line: number; text: string }[] = [];
  let parent: ParentInfo = { groupId: null, artifactId: null, version: null, kind: "none", status: "n/a" };
  let java: string | null = null;
  const poms = files.filter((f) => path.basename(f) === "pom.xml").sort((a, b) => a.length - b.length);
  const rootProps = new Map<string, string>();
  for (const abs of poms) {
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    const text = fs.readFileSync(abs, "utf8");
    const props = new Map([...rootProps, ...parsePomProperties(text)]);
    if (rel === "pom.xml") {
      for (const [k, v] of props) rootProps.set(k, v);
      const p = text.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
      if (p) {
        const g = p.match(/<groupId>\s*([^<\s]+)/)?.[1] ?? null, a = p.match(/<artifactId>\s*([^<\s]+)/)?.[1] ?? null, v = p.match(/<version>\s*([^<\s]+)/)?.[1] ?? null;
        const src = baseline.sources.find((s) => s.groupId === g && s.artifactId === a);
        const status: ParentInfo["status"] = src && v ? (versionBelow(v, src.version) ? "outdated" : "ok") : "n/a";
        parent = { groupId: g, artifactId: a, version: v, kind: src ? src.kind : "other", status };
      }
      java = resolveProp(props.get("java.version") ?? props.get("maven.compiler.release") ?? props.get("maven.compiler.source") ?? props.get("maven.compiler.target") ?? null, props);
      if (!java) { const m = text.match(/<(?:release|source)>\s*([^<\s]+)\s*<\/(?:release|source)>/); java = m ? resolveProp(m[1], props) : null; }
      if (java && /\$\{/.test(java)) java = null; // parent 가 정의하는 속성 → 아래에서 parent 기준으로 판정
    }
    for (const m of text.matchAll(/<repository>[\s\S]*?<url>\s*(http:\/\/[^<\s]+)\s*<\/url>[\s\S]*?<\/repository>/g))
      repoIssues.push({ file: rel, line: lineAt(text, (m.index ?? 0) + m[0].indexOf(m[1])), text: m[1] });
    // dependencyManagement 안의 항목은 프로젝트가 직접 쓰는 의존성이 아닐 수 있으나 버전 결정에는 관여하므로 함께 본다
    for (const d of parsePomDeps(text)) {
      const resolved = resolveProp(d.version, props);
      deps.push({ file: rel, line: d.line, groupId: d.groupId, artifactId: d.artifactId, version: d.version, resolvedVersion: resolved && !/\$\{/.test(resolved) ? resolved : null, scope: d.scope });
    }
  }
  return { deps, parent, java, repoIssues };
}

function collectGradle(dir: string, files: string[]): { deps: RawDep[]; java: string | null; repoIssues: { file: string; line: number; text: string }[] } {
  const deps: RawDep[] = [];
  const repoIssues: { file: string; line: number; text: string }[] = [];
  let java: string | null = null;
  for (const abs of files.filter((f) => /^(build\.gradle|build\.gradle\.kts)$/.test(path.basename(f)))) {
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    const text = fs.readFileSync(abs, "utf8");
    for (const m of text.matchAll(/["']([\w.\-]+):([\w.\-]+)(?::([^"':\s]+))?["']/g))
      deps.push({ file: rel, line: lineAt(text, m.index ?? 0), groupId: m[1], artifactId: m[2], version: m[3] ?? null, resolvedVersion: m[3] && !/\$/.test(m[3]) ? m[3] : null, scope: null });
    for (const m of text.matchAll(/(http:\/\/[^\s"']+)/g)) repoIssues.push({ file: rel, line: lineAt(text, m.index ?? 0), text: m[1] });
    const src = text.match(/sourceCompatibility\s*=?\s*["']?(?:JavaVersion\.VERSION_)?(1_8|1\.8|[0-9]+)/) ?? text.match(/languageVersion\s*=?\s*JavaLanguageVersion\.of\((\d+)\)/);
    if (src) java = src[1].replace("1_8", "1.8");
  }
  return { deps, java, repoIssues };
}

const CHECK_EXT = new Set([".xml", ".java", ".properties", ".yml", ".yaml"]);
function grepEvidence(dir: string, files: string[], re: RegExp, filter?: (rel: string) => boolean, cap = 5): SecurityCheck["evidence"] {
  const out: SecurityCheck["evidence"] = [];
  for (const abs of files) {
    if (!CHECK_EXT.has(path.extname(abs))) continue;
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    if (filter && !filter(rel)) continue;
    let text: string;
    try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
    if (!re.test(text)) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && out.length < cap; i++) if (re.test(lines[i])) out.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 160) });
    if (out.length >= cap) break;
  }
  return out;
}

/** 프로젝트 의존성을 기준 버전과 대조하고 보안 설정 존재 여부를 점검한다. (읽기 전용) */
export async function checkDependencies(opts: CheckDependenciesOptions): Promise<CheckDependenciesResult> {
  const baseline = loadDependencyBaseline();
  const rules = loadMigrationRules();
  const offline = opts.offline ?? true;
  const dir = path.resolve(opts.projectDir);
  const diag = diagnoseProject({ projectDir: dir });
  const files = walkProjectFiles(dir, opts.maxFiles ?? 20_000);
  const notes: string[] = [];

  let raw: RawDep[] = [];
  let parent: ParentInfo = { groupId: null, artifactId: null, version: null, kind: "none", status: "n/a" };
  let javaValue: string | null = null;
  let repoIssues: { file: string; line: number; text: string }[] = [];
  if (diag.buildSystem === "maven") ({ deps: raw, parent, java: javaValue, repoIssues } = collectMaven(dir, files, baseline));
  else if (diag.buildSystem === "gradle") ({ deps: raw, java: javaValue, repoIssues } = collectGradle(dir, files));
  else notes.push("빌드 파일(pom.xml·build.gradle)을 찾지 못해 의존성 대조를 건너뜁니다.");

  const findings: DependencyFinding[] = [];
  const seen = new Set<string>();
  for (const d of raw) {
    if (SKIP_SCOPES.has(d.scope ?? "")) continue;
    const key = `${d.file}\u0000${d.groupId}:${d.artifactId}\u0000${d.version ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = classifyDependency(d, { baseline, rules, parentKind: parent.kind });
    findings.push({ file: d.file, line: d.line, groupId: d.groupId, artifactId: d.artifactId, version: d.version, resolvedVersion: d.resolvedVersion, scope: d.scope, status: c.status, baseline: c.baseline, basis: c.basis, origin: "declared", ...(c.note ? { note: c.note } : {}) });
  }

  // ── v0.36: 해석된 트리 — 선언에 없는 artifact 는 transitive 로 추가하고, 선언과 다른 버전으로 풀린 좌표는 differs 로 ──
  let resolution: CheckDependenciesResult["resolution"];
  if (opts.resolve && diag.buildSystem !== "unknown") {
    const tree: DependencyTreeResult = await resolveDependencyTree({ projectDir: dir, scope: opts.resolveScope ?? "runtime", timeoutMs: opts.resolveTimeoutMs, runner: opts.runner, platform: opts.platform });
    const buildFile = diag.buildSystem === "maven" ? "pom.xml" : (files.find((f) => /build\.gradle(\.kts)?$/.test(f)) ? path.relative(dir, files.find((f) => /build\.gradle(\.kts)?$/.test(f))!).split(path.sep).join("/") : "build.gradle");
    const declaredByKey = new Map<string, DependencyFinding>();
    for (const f of findings) { const k = `${f.groupId}:${f.artifactId}`; if (!declaredByKey.has(k)) declaredByKey.set(k, f); }
    const differs: NonNullable<CheckDependenciesResult["resolution"]>["differs"] = [];
    const rsum: Record<DependencyStatus, number> = { ok: 0, outdated: 0, managed: 0, legacy: 0, replace: 0, vendor: 0, unknown: 0, unversioned: 0 };
    let transitive = 0;
    for (const a of tree.artifacts) {
      const key = `${a.groupId}:${a.artifactId}`;
      const declared = declaredByKey.get(key);
      if (declared) {
        declared.depth = a.depth;
        if (declared.resolvedVersion && declared.resolvedVersion !== a.version) { declared.treeVersion = a.version; differs.push({ groupId: a.groupId, artifactId: a.artifactId, declared: declared.resolvedVersion, resolved: a.version }); }
        else if (!declared.resolvedVersion) declared.treeVersion = a.version;
        const cls = classifyDependency({ groupId: a.groupId, artifactId: a.artifactId, version: a.version, resolvedVersion: a.version }, { baseline, rules, parentKind: parent.kind });
        rsum[cls.status]++;
        if (declared.status === "managed" && cls.status === "outdated") declared.note = `parent 가 정한 해석 버전 ${a.version} 은 기준 ${cls.baseline} 미만 — parent 버전을 올리면 해결`;
        continue;
      }
      const c = classifyDependency({ groupId: a.groupId, artifactId: a.artifactId, version: a.version, resolvedVersion: a.version }, { baseline, rules, parentKind: parent.kind });
      rsum[c.status]++;
      transitive++;
      findings.push({ file: buildFile, line: 0, groupId: a.groupId, artifactId: a.artifactId, version: a.version, resolvedVersion: a.version, scope: a.scope, status: c.status, baseline: c.baseline, basis: c.basis, origin: "transitive", via: a.via, depth: a.depth, ...(c.note ? { note: c.note } : {}) });
    }
    resolution = { ran: tree.ran, success: tree.success, scope: tree.scope, command: tree.command, durationMs: tree.durationMs, artifacts: tree.artifacts.length, direct: tree.artifacts.filter((a) => a.depth === 1).length, transitive, differs, summary: rsum, ...(tree.error ? { error: tree.error } : {}) };
    if (!tree.success) notes.push(`의존성 트리 해석 실패(${tree.error ?? "원인 미상"}) — 선언된 의존성만 판정했습니다. 명령: ${tree.command}`);
  } else if (opts.resolve) notes.push("빌드 파일이 없어 의존성 트리를 해석하지 않았습니다.");

  findings.sort((a, b) => (a.origin === b.origin ? 0 : a.origin === "declared" ? -1 : 1) || a.file.localeCompare(b.file) || a.line - b.line || (a.depth ?? 0) - (b.depth ?? 0) || `${a.groupId}:${a.artifactId}`.localeCompare(`${b.groupId}:${b.artifactId}`));
  const summary: Record<DependencyStatus, number> = { ok: 0, outdated: 0, managed: 0, legacy: 0, replace: 0, vendor: 0, unknown: 0, unversioned: 0 };
  for (const f of findings) summary[f.status]++;

  // Java
  let javaStatus: CheckDependenciesResult["java"]["status"] = "unknown";
  if (javaValue) {
    const num = javaValue.startsWith("1.") ? Number(javaValue.slice(2)) : Number.parseInt(javaValue, 10);
    if (Number.isFinite(num)) javaStatus = num >= baseline.java ? "ok" : "outdated";
  } else if (parent.kind === "web" || parent.kind === "boot") { javaValue = String(baseline.java); javaStatus = "ok"; notes.push("java.version 은 5.x parent 가 관리합니다(17)."); }

  // 보안 설정 점검 — 존재 여부만 판정하고 근거를 남긴다
  const checks: SecurityCheck[] = [];
  const secComponents = diag.detectedComponents.filter((c) => c.id === "sec.security" || c.id.startsWith("sec.security."));
  checks.push({
    id: "sec-security-component", title: "공통컴포넌트 sec.security(인증·인가 기반) 설치",
    status: secComponents.length ? "ok" : diag.detectedComponents.length ? "missing" : "n/a",
    evidence: secComponents.map((c) => ({ file: c.matchedPrefix, line: 0, text: c.id })),
    hint: secComponents.length ? "" : "add_egovframe_components(componentIds=[\"sec.security\"]) 로 설치하거나, 자체 Spring Security 설정을 쓰는 경우 아래 CSRF·헤더 항목으로 확인",
  });
  const csrf = grepEvidence(dir, files, /<csrf\b|\.csrf\(|CsrfFilter|CsrfTokenRepository|csrfAccessDeniedUrl|_csrf|egov-security:config[^>]*csrf/i, (rel) => !rel.includes("/test/"));
  checks.push({ id: "csrf", title: "CSRF 보호 설정", status: csrf.length ? "ok" : "missing", evidence: csrf, hint: csrf.length ? "" : "Spring Security 의 csrf() 또는 <csrf/> 설정(EgovSecurityConfig 의 csrf 속성)을 켜세요" });
  const xss = grepEvidence(dir, files, /HTMLTagFilter|XssFilter|XSSFilter|xss-?filter|EgovXssFilter|Lucy|XssEscapeServletFilter/i, (rel) => /web\.xml$|\.java$|\.xml$/.test(rel) && !rel.includes("/test/"));
  checks.push({ id: "xss-filter", title: "XSS 방어 필터(HTMLTagFilter 등)", status: xss.length ? "ok" : "missing", evidence: xss, hint: xss.length ? "" : "web.xml 에 org.egovframe.rte.ptl.mvc.filter.HTMLTagFilter 를 등록하거나 Lucy-XSS 등 필터를 적용하세요" });
  const headers = grepEvidence(dir, files, /HeaderWriterFilter|X-Frame-Options|Content-Security-Policy|X-Content-Type-Options|Strict-Transport-Security|\.headers\(|<headers\b|frameOptions|contentSecurityPolicy/i, (rel) => !rel.includes("/test/"));
  checks.push({ id: "security-headers", title: "보안 응답 헤더(X-Frame-Options·CSP·HSTS 등)", status: headers.length ? "ok" : "missing", evidence: headers, hint: headers.length ? "" : "Spring Security headers() 또는 web.xml 필터로 X-Frame-Options·Content-Security-Policy 등을 설정하세요" });
  checks.push({ id: "https-repositories", title: "Maven 저장소 URL HTTPS", status: repoIssues.length ? "missing" : (diag.buildSystem === "unknown" ? "n/a" : "ok"), evidence: repoIssues, hint: repoIssues.length ? "http:// 저장소는 중간자 변조에 노출됩니다. https://maven.egovframe.go.kr/maven/ 등 HTTPS 로 바꾸세요(migrate_egovframe_project 가 자동 치환)" : "" });

  const result: CheckDependenciesResult = {
    projectDir: dir, buildSystem: diag.buildSystem, offline,
    baseline: { surveyedAt: baseline.surveyedAt, rte: baseline.rte.version, springFramework: baseline.spring.framework, springBoot: baseline.spring.boot, java: baseline.java, bootBom: baseline.boot ? Object.keys(baseline.boot.managed).length : 0, rteTransitive: baseline.rteTransitive ? Object.keys(baseline.rteTransitive.managed).length : 0 },
    parent, java: { value: javaValue, status: javaStatus }, findings, summary, checks, ...(resolution ? { resolution } : {}), notes,
  };

  if (!offline) {
    const targets = findings.filter((f) => f.resolvedVersion);
    const query = opts.osvQuery ?? defaultOsvQuery;
    const vulns: Vulnerability[] = [];
    try {
      for (let i = 0; i < targets.length; i += 100) {
        const chunk = targets.slice(i, i + 100);
        const res = await query(chunk.map((f) => ({ package: { name: `${f.groupId}:${f.artifactId}`, ecosystem: "Maven" as const }, version: f.resolvedVersion! })));
        res.results.forEach((r, j) => {
          const ids = (r.vulns ?? []).map((v) => v.id);
          if (ids.length) vulns.push({ dependency: `${chunk[j].groupId}:${chunk[j].artifactId}`, version: chunk[j].resolvedVersion!, ids });
        });
      }
      result.vulnerabilities = vulns;
    } catch (e) {
      result.osvError = `OSV 조회 실패: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return result;
}

const STATUS_LABEL: Record<DependencyStatus, string> = { ok: "기준 충족", outdated: "기준 미만", managed: "parent 관리", legacy: "전환 대상", replace: "교체 필요", vendor: "벤더 배포", unknown: "기준 없음", unversioned: "버전 없음" };

/** 점검 결과를 Markdown 으로 렌더링한다. */
export function renderDependencyMarkdown(r: CheckDependenciesResult): string {
  const L: string[] = [];
  L.push(`# 의존성 점검`, ``);
  L.push(`- 경로: ${r.projectDir} · 빌드 ${r.buildSystem} · ${r.offline ? "오프라인" : "OSV 조회 포함"}`);
  L.push(`- 기준: 공식 5.x parent(조사일 ${r.baseline.surveyedAt}) — RTE ${r.baseline.rte}, Spring ${r.baseline.springFramework ?? "-"}, Boot ${r.baseline.springBoot ?? "-"}, Java ${r.baseline.java}${r.baseline.bootBom ? ` · Boot BOM ${r.baseline.bootBom}종 · RTE 전이 ${r.baseline.rteTransitive ?? 0}종` : ""}`);
  L.push(`- parent: ${r.parent.kind === "none" ? "없음" : `${r.parent.groupId}:${r.parent.artifactId}:${r.parent.version ?? "?"} (${r.parent.kind}, ${r.parent.status})`}`);
  L.push(`- Java: ${r.java.value ?? "미검출"} (${r.java.status})`);
  const s = r.summary;
  L.push(`- 의존성 ${r.findings.length}건: 기준 충족 ${s.ok} · 기준 미만 ${s.outdated} · parent 관리 ${s.managed} · 전환 대상 ${s.legacy} · 교체 필요 ${s.replace} · 벤더 배포 ${s.vendor ?? 0} · 기준 없음 ${s.unknown} · 버전 없음 ${s.unversioned}`);
  const basisCount = new Map<DependencyBasis, number>();
  for (const f of r.findings) if (f.basis) basisCount.set(f.basis, (basisCount.get(f.basis) ?? 0) + 1);
  if (basisCount.size) L.push(`- 기준 출처: ${[...basisCount.entries()].map(([k, v]) => `${BASIS_LABEL[k]} ${v}`).join(" · ")}`);
  if (r.resolution) {
    const x = r.resolution;
    if (x.success) {
      const rs = x.summary;
      L.push(`- 해석된 트리(${x.scope}, ${x.durationMs ?? "?"}ms): artifact ${x.artifacts}종 = 직접 ${x.direct} + 전이 ${x.artifacts - x.direct} (선언에 없던 전이 ${x.transitive}) — 기준 충족 ${rs.ok} · 기준 미만 ${rs.outdated} · 전환 대상 ${rs.legacy} · 교체 필요 ${rs.replace} · 벤더 ${rs.vendor} · 기준 없음 ${rs.unknown}`);
      if (x.differs.length) L.push(`- 선언과 다르게 해석된 좌표 ${x.differs.length}건(가까운 선언이 이김): ${x.differs.slice(0, 8).map((d) => `${d.artifactId} ${d.declared}→${d.resolved}`).join(", ")}${x.differs.length > 8 ? " …" : ""}`);
    } else L.push(`- 해석된 트리: 실패 (${x.error ?? "원인 미상"}) — 선언만 판정`);
  }
  for (const n of r.notes) L.push(`- ${n}`);
  const attention = r.findings.filter((f) => f.status === "outdated" || f.status === "legacy" || f.status === "replace" || f.status === "unversioned");
  if (attention.length) {
    L.push(``, `## 조치 필요 (${attention.length})`, ``, `| 파일:라인 | 좌표 | 현재 | 기준/대체 | 상태 | 출처 | 비고 |`, `|---|---|---|---|---|---|---|`);
    for (const f of attention) L.push(`| ${f.origin === "transitive" ? `(전이) ${f.via?.length ? f.via.join(" → ") : "-"}` : `${f.file}:${f.line}`} | ${f.groupId}:${f.artifactId} | ${f.resolvedVersion ?? f.version ?? "-"} | ${f.baseline ?? "-"} | ${STATUS_LABEL[f.status]} | ${f.basis ? BASIS_LABEL[f.basis] : "-"} | ${f.note ?? ""} |`);
  }
  const vendor = r.findings.filter((f) => f.status === "vendor");
  if (vendor.length) L.push(``, `## 벤더·기관 배포 (${vendor.length}) — 공개 저장소 기준 없음`, ``, ...vendor.map((f) => `- ${f.groupId}:${f.artifactId}${f.resolvedVersion ? `:${f.resolvedVersion}` : ""} — ${f.note ?? ""}`));
  const unknown = r.findings.filter((f) => f.status === "unknown");
  if (unknown.length) L.push(``, `## 기준 없음 (${unknown.length}) — 판단 보류`, ``, unknown.map((f) => `${f.groupId}:${f.artifactId}${f.resolvedVersion ? `:${f.resolvedVersion}` : ""}`).join(", "));
  L.push(``, `## 보안 설정 점검`, ``);
  for (const c of r.checks) {
    const mark = c.status === "ok" ? "✅" : c.status === "missing" ? "⚠️" : "➖";
    L.push(`- ${mark} ${c.title}: ${c.status}${c.hint ? ` — ${c.hint}` : ""}`);
    for (const e of c.evidence.slice(0, 3)) L.push(`  - ${e.file}${e.line ? `:${e.line}` : ""} \`${e.text}\``);
  }
  if (r.vulnerabilities) {
    L.push(``, `## 알려진 취약점 (OSV, ${r.vulnerabilities.length}건)`, ``);
    if (r.vulnerabilities.length === 0) L.push(`조회한 의존성에 등록된 취약점이 없습니다.`);
    for (const v of r.vulnerabilities) L.push(`- ${v.dependency}:${v.version} — ${v.ids.slice(0, 6).join(", ")}${v.ids.length > 6 ? ` 외 ${v.ids.length - 6}건` : ""} (https://osv.dev/vulnerability/${v.ids[0]})`);
  }
  if (r.osvError) L.push(``, `⚠️ ${r.osvError}`);
  L.push(``, `---`, `읽기 전용 점검입니다. 전환 대상은 migrate_egovframe_project, 공통컴포넌트 갱신은 upgrade_egovframe_project 로 처리합니다.`);
  return L.join("\n");
}
