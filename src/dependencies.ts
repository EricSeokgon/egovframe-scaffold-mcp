// 의존성 점검 (check_egovframe_dependencies, v0.30.0 — 읽기 전용).
// 프로젝트의 Maven/Gradle 의존성을 공식 5.x parent 가 관리하는 기준 버전(catalog/dependency-baseline.json)과 대조하고,
// 보안 설정의 존재 여부를 파일·라인 근거와 함께 보고한다. 기본은 오프라인이며 offline=false 일 때만 OSV 로 알려진 취약점을 조회한다.
// v0.34: 기준 출처를 parent 직접 → 계열(BOM import·버전 속성) → Spring Boot BOM 전체 → RTE 모듈 전이 순으로 넓혀 '기준 없음'을 줄이고,
//        항목마다 basis 로 어느 기준과 대조했는지 적는다. Boot parent 프로젝트는 Boot BOM 을, 그 밖은 RTE 전이를 먼저 본다.
import * as fs from "node:fs";
import * as path from "node:path";
import { diagnoseProject } from "./diagnose.js";
import { DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "./shared.js";
import { bundleOsvQuery, osvProvenanceNote } from "./offline-bundle.js";
import { detectWorkspace, isMultiModule, moduleOf, type Workspace } from "./workspace.js";
import { lineAt, loadMigrationRules, parsePomDeps, parsePomProperties, resolveProp, versionBelow, walkProjectFiles, type MigrationRules } from "./migrate.js";
import { resolveDependencyTree, type DependencyTreeResult, type ResolveScope } from "./dependency-tree.js";
import type { Runner } from "./build-runner.js";
import { subProgress, throwIfAborted, type Progress } from "./progress.js";
import { L, tr } from "./lang.js";

export interface BaselineManaged { groupId: string; artifactId: string; version: string; scope?: string; type?: string; sources: ("web" | "boot")[]; versionBySource?: Record<string, string>; parentVersion?: string }
export interface DependencyBaseline {
  schemaVersion: number;
  surveyedAt: string;
  repository: string;
  sources: { kind: "web" | "boot"; groupId: string; artifactId: string; version: string; url: string; sha256: string; managed: number; parent?: { groupId: string; artifactId: string; version: string } }[];
  java: number;
  rte: { version: string; parentManaged: Record<string, string | null>; /** v1.3: parent 가 import 하는 RTE BOM(egovframe-rte-root) */ bom?: { artifactId: string; version: string; url: string; sha256: string; managed: number } };
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

// v1.3: parent 버전별 기준 — 기본(catalog/dependency-baseline.json)은 전환 목표(5.0.2) 기준이고,
// 5.1.0 처럼 새 parent 를 쓰는 프로젝트는 그 버전의 기준(catalog/dependency-baseline-5.1.json)으로 판정한다.
const BASELINE_URL = new URL("../catalog/dependency-baseline.json", import.meta.url);
/** 기본 기준보다 새 parent 계열의 기준 파일(major.minor → 파일) */
export const BASELINE_FILES: Record<string, string> = { "5.1": "dependency-baseline-5.1.json" };
const cache = new Map<string, DependencyBaseline>();
const minorOf = (v: string | null | undefined): string | null => v?.match(/^(\d+)\.(\d+)\./)?.slice(1, 3).join(".") ?? null;
/** version(parent 또는 RTE 버전)을 주면 그 계열의 기준을, 없거나 기본 계열 이하면 기본 기준을 돌려준다. */
export function loadDependencyBaseline(version?: string | null): DependencyBaseline {
  const minor = minorOf(version);
  const file = minor ? BASELINE_FILES[minor] : undefined;
  const key = file ?? "default";
  let b = cache.get(key);
  if (!b) { b = JSON.parse(fs.readFileSync(file ? new URL(`../catalog/${file}`, import.meta.url) : BASELINE_URL, "utf8")) as DependencyBaseline; cache.set(key, b); }
  return b;
}
/** v1.3: 기본 기준보다 새 기준(parent 계열) 목록 — 안내용 */
export function newerBaselines(than: DependencyBaseline = loadDependencyBaseline()): DependencyBaseline[] {
  return Object.keys(BASELINE_FILES).map((m) => loadDependencyBaseline(`${m}.0`)).filter((b) => versionBelow(than.rte.version, b.rte.version) === true);
}

export type DependencyStatus = "ok" | "outdated" | "managed" | "legacy" | "replace" | "vendor" | "unknown" | "unversioned";
/** 어느 기준과 대조했는지 (v0.34) */
export type DependencyBasis = "parent" | "family" | "boot-bom" | "rte-transitive" | "migration-rules";
export const BASIS_LABEL: Record<DependencyBasis, string> = { get parent() { return L("parent 직접", "parent (direct)"); }, get family() { return L("계열", "family"); }, get "boot-bom"() { return "Boot BOM"; }, get "rte-transitive"() { return L("RTE 전이", "RTE transitive"); }, get "migration-rules"() { return L("전환 규칙", "migration rules"); } };
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
  /** v0.47: 멀티 모듈 작업공간이면 이 항목이 속한 모듈 */
  module?: string;
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
  /** v0.47: 멀티 모듈·다중 프로젝트 작업공간이면 모듈별 요약 */
  workspace?: { kind: string; modules: { name: string; dir: string; buildTool: string; findings: number; summary: Record<DependencyStatus, number> }[] };
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
  /** v1.2: 진행 알림·취소(signal) — resolve=true 일 때 모듈별 트리 해석을 보고하고, 취소되면 AbortError 를 던진다 */
  progress?: Progress;
}

// v1.3: 표준프레임워크가 다시 빌드해 자체 저장소에만 올린 좌표(예: spring-security 6.5.11-egov.1)
export const EGOV_REBUILD_RE = /-egov\.\d+$/;
export const isEgovRebuild = (version: string | null | undefined): boolean => !!version && EGOV_REBUILD_RE.test(version);
/** OSV 는 원 버전으로 조회한다(6.5.11-egov.1 → 6.5.11) — 재빌드의 패치 반영 여부는 공급자 확인 대상 */
export const osvVersion = (version: string): string => version.replace(EGOV_REBUILD_RE, "");

const OSV_URL = "https://api.osv.dev/v1/querybatch";
export const defaultOsvQuery: OsvQuery = async (queries) => {
  // v0.42: 오프라인 번들에 OSV 덤프가 있으면 로컬로 판정(querybatch 와 같은 모양)
  const local = bundleOsvQuery(queries);
  if (local) return local;
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
    return { status: "legacy", baseline: `${c.to.groupId}:${c.to.artifactId}:${rules.target.runtimeVersion}`, basis: "migration-rules", note: L(`${rules.source.fromTag.replace(/^v/, "")} 계열 RTE 좌표 — migrate_egovframe_project 로 5.x 좌표로 전환`, `${rules.source.fromTag.replace(/^v/, "")}-line RTE coordinate — migrate to the 5.x coordinate with migrate_egovframe_project`) };
  if (rules.removedModules.some((m) => m.fromArtifactId === dep.artifactId && /^(egovframework\.rte|org\.egovframe\.rte)$/.test(dep.groupId)))
    return { status: "replace", baseline: null, basis: "migration-rules", note: tr(rules.removedModules.find((m) => m.fromArtifactId === dep.artifactId)!, "reason") };
  const jk = rules.jakarta.artifacts.find((a) => `${a.from.groupId}:${a.from.artifactId}` === key);
  if (jk) return { status: "legacy", baseline: `${jk.to.groupId}:${jk.to.artifactId}:${jk.toVersion}`, basis: "migration-rules", note: L("javax 좌표 — Jakarta 좌표로 전환(migrate_egovframe_project)", "javax coordinate — migrate to the Jakarta coordinate (migrate_egovframe_project)") };
  // 2) 교체 필요 라이브러리
  for (const lib of rules.libraries) {
    if (lib.match.groupId !== dep.groupId) continue;
    const re = new RegExp(`^${lib.match.artifactId.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    if (!re.test(dep.artifactId)) continue;
    if (lib.match.versionBelow) {
      if (!dep.resolvedVersion) continue;
      if (versionBelow(dep.resolvedVersion, lib.match.versionBelow) !== true) continue;
    }
    return { status: "replace", baseline: lib.replacement != null ? tr(lib, "replacement") : null, basis: "migration-rules", note: tr(lib, "reason") };
  }
  // 3) 기준 목록: parent 직접 → 계열 → (Boot parent 면 Boot BOM → RTE 전이, 아니면 RTE 전이 → Boot BOM)
  const exact = baseline.managed.find((x) => x.groupId === dep.groupId && x.artifactId === dep.artifactId);
  // 계열은 groupId 가 정확히 같을 때 적용하고, matchSubgroups 인 계열(jackson)만 하위 groupId 도 받는다. schemaVersion 1 기준(필드 없음)은 예전처럼 접두 일치.
  const family = exact ? null : [...baseline.families].filter((f) => dep.groupId === f.groupIdPrefix || ((f.matchSubgroups ?? baseline.schemaVersion < 2) && dep.groupId.startsWith(`${f.groupIdPrefix}.`))).sort((a, b) => b.groupIdPrefix.length - a.groupIdPrefix.length)[0] ?? null;
  const bootV = baseline.boot?.managed[key];
  const rte = baseline.rteTransitive?.managed[key];
  let m: { version: string; basis: DependencyBasis; note?: string } | null = null;
  if (exact) m = { version: exact.version, basis: "parent" };
  else if (family) m = { version: family.version, basis: "family", note: L(`계열 기준: ${family.via}`, `family baseline: ${family.via}`) };
  else {
    const boot = bootV ? { version: bootV, basis: "boot-bom" as const, note: L(`Spring Boot ${baseline.boot!.bom.version} BOM 기준`, `Spring Boot ${baseline.boot!.bom.version} BOM baseline`) } : null;
    const rt = rte ? { version: rte.version, basis: "rte-transitive" as const, note: L(`RTE ${baseline.rteTransitive!.version} ${rte.via.join("·")} 의 전이 버전`, `transitive version from RTE ${baseline.rteTransitive!.version} ${rte.via.join("·")}`) } : null;
    m = ctx.parentKind === "boot" ? (boot ?? rt) : (rt ?? boot);
  }
  const withNote = (r: { status: DependencyStatus; baseline: string | null; basis: DependencyBasis | null }, note?: string) => (note ? { ...r, note } : r);
  if (!dep.version) {
    if (ctx.parentKind === "web" || ctx.parentKind === "boot")
      return withNote({ status: "managed", baseline: m?.version ?? null, basis: m?.basis ?? null }, m ? (m.basis === "parent" ? undefined : m.note) : (ctx.parentKind === "boot" ? L("Spring Boot BOM 에도 없는 좌표 — 버전 출처 확인", "Coordinate not in the Spring Boot BOM either — verify where the version comes from") : L("parent 에 없는 좌표 — 버전 출처 확인", "Coordinate not managed by the parent — verify where the version comes from")));
    return withNote({ status: "unversioned", baseline: m?.version ?? null, basis: m?.basis ?? null }, L("버전이 없고 5.x parent 도 없음 — dependencyManagement 또는 명시 버전 필요", "No version and no 5.x parent — needs dependencyManagement or an explicit version"));
  }
  if (!m) {
    const vendor = (rules.vendorCoordinates ?? []).filter((v) => dep.groupId === v.groupIdPrefix || dep.groupId.startsWith(`${v.groupIdPrefix}.`)).sort((a, b) => b.groupIdPrefix.length - a.groupIdPrefix.length)[0];
    if (vendor) return { status: "vendor", baseline: null, basis: null, note: tr(vendor, "note") };
    return { status: "unknown", baseline: null, basis: null, note: L("기준 목록(공식 5.x parent·Spring Boot BOM·RTE 전이)에 없는 좌표 — 판단 보류", "Coordinate not in any baseline (official 5.x parent, Spring Boot BOM, RTE transitive) — no verdict") };
  }
  if (!dep.resolvedVersion) return withNote({ status: "unknown", baseline: m.version, basis: m.basis }, L(`버전 속성을 풀지 못함: ${dep.version}`, `Could not resolve version property: ${dep.version}`));
  const below = versionBelow(dep.resolvedVersion, m.version);
  if (below === null) return withNote({ status: "unknown", baseline: m.version, basis: m.basis }, L(`버전을 비교할 수 없음: ${dep.resolvedVersion}`, `Cannot compare version: ${dep.resolvedVersion}`));
  if (below && m.basis === "rte-transitive") return { status: "outdated", baseline: m.version, basis: m.basis, note: L(`${m.note} — 명시 버전이 더 낮아 전이 버전과 충돌할 수 있음(Maven 은 가까운 선언을 택함)`, `${m.note} — the explicit version is lower and may conflict with the transitive one (Maven picks the nearest declaration)`) };
  const rebuild = isEgovRebuild(dep.resolvedVersion) ? L(`표준프레임워크 재빌드(${dep.resolvedVersion}) — 원 버전 ${osvVersion(dep.resolvedVersion)} 기준으로 비교·OSV 조회`, `eGovFrame rebuild (${dep.resolvedVersion}) — compared and queried in OSV as ${osvVersion(dep.resolvedVersion)}`) : undefined;
  return withNote({ status: below ? "outdated" : "ok", baseline: m.version, basis: m.basis }, [m.note, rebuild].filter(Boolean).join(" · ") || undefined);
}

interface RawDep { file: string; line: number; groupId: string; artifactId: string; version: string | null; resolvedVersion: string | null; scope: string | null; /** v0.47: 이 빌드 파일의 parent 종류(모듈마다 다를 수 있음) */ parentKind?: ParentInfo["kind"] }

function collectMaven(dir: string, files: string[], baseline: DependencyBaseline): { deps: RawDep[]; parent: ParentInfo; java: string | null; repoIssues: { file: string; line: number; text: string }[] } {
  const deps: RawDep[] = [];
  const repoIssues: { file: string; line: number; text: string }[] = [];
  let parent: ParentInfo = { groupId: null, artifactId: null, version: null, kind: "none", status: "n/a" };
  let java: string | null = null;
  const poms = files.filter((f) => path.basename(f) === "pom.xml").sort((a, b) => a.length - b.length);
  const rootProps = new Map<string, string>();
  const moduleParents: ParentInfo[] = [];
  const parentOf = (text: string): ParentInfo | null => {
    const p = text.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
    if (!p) return null;
    const g = p.match(/<groupId>\s*([^<\s]+)/)?.[1] ?? null, a = p.match(/<artifactId>\s*([^<\s]+)/)?.[1] ?? null, v = p.match(/<version>\s*([^<\s]+)/)?.[1] ?? null;
    const src = baseline.sources.find((s) => s.groupId === g && s.artifactId === a);
    return { groupId: g, artifactId: a, version: v, kind: src ? src.kind : "other", status: src && v ? (versionBelow(v, src.version) ? "outdated" : "ok") : "n/a" };
  };
  for (const abs of poms) {
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    const text = fs.readFileSync(abs, "utf8");
    const props = new Map([...rootProps, ...parsePomProperties(text)]);
    // v0.47: 모듈 pom 은 자기 parent 로 판정(공식 parent 가 아니면 루트의 것)
    const own = rel === "pom.xml" ? null : parentOf(text);
    if (own && (own.kind === "web" || own.kind === "boot")) moduleParents.push(own);
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
      deps.push({ file: rel, line: d.line, groupId: d.groupId, artifactId: d.artifactId, version: d.version, resolvedVersion: resolved && !/\$\{/.test(resolved) ? resolved : null, scope: d.scope, parentKind: own && (own.kind === "web" || own.kind === "boot") ? own.kind : undefined });
    }
  }
  // 루트에 공식 parent 가 없고 모듈들이 공식 parent 를 쓰면 가장 낮은 모듈 parent 를 대표로(평가서 platform 요인)
  if (parent.kind === "none" && moduleParents.length) {
    parent = [...moduleParents].sort((a, b) => (versionBelow(a.version ?? "0", b.version ?? "0") ? -1 : 1))[0];
  }
  return { deps, parent, java, repoIssues };
}

const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
/** v0.47: Gradle 빌드 스크립트의 버전 변수 — ext { set('x', 'v') } · ext.x = 'v' · x = 'v'(ext 블록) · def x = 'v' · gradle.properties */
export function gradleVariables(build: string, properties = ""): Map<string, string> {
  const vars = new Map<string, string>();
  for (const l of properties.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*[=:]\s*(\S+)\s*$/); if (m) vars.set(m[1], m[2]); }
  for (const m of build.matchAll(/\bset\(\s*['"](\w+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g)) vars.set(m[1], m[2]);
  for (const m of build.matchAll(/^\s*(?:ext\.|def\s+|val\s+)?(\w+)\s*=\s*['"]([^'"$]+)['"]\s*$/gm)) if (!/^(version|group|sourceCompatibility|targetCompatibility|description)$/.test(m[1])) vars.set(m[1], m[2]);
  return vars;
}

function collectGradle(dir: string, files: string[], baseline: DependencyBaseline): { deps: RawDep[]; java: string | null; repoIssues: { file: string; line: number; text: string }[]; parent: ParentInfo } {
  let parent: ParentInfo = { groupId: null, artifactId: null, version: null, kind: "none", status: "n/a" };
  const deps: RawDep[] = [];
  const repoIssues: { file: string; line: number; text: string }[] = [];
  let java: string | null = null;
  for (const abs of files.filter((f) => /^(build\.gradle|build\.gradle\.kts)$/.test(path.basename(f)))) {
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    const text = fs.readFileSync(abs, "utf8");
    // v0.47: ext 변수(set('x','v') · x = 'v' · def x = 'v')와 gradle.properties 로 ${x}·$x 를 푼다
    const vars = gradleVariables(text, read(path.join(path.dirname(abs), "gradle.properties")));
    const resolve = (v: string | undefined) => (v ? v.replace(/\$\{(\w+)\}|\$(\w+)/g, (all, a, b) => vars.get(a ?? b) ?? all) : v);
    // Boot 플러그인 + dependency-management 또는 공식 parent BOM(mavenBom) → 버전 없는 좌표는 BOM 관리
    // v0.47: 공식 parent 를 BOM 으로 가져오면(mavenBom) 그 버전을 parent 로 본다(여러 파일이면 가장 낮은 것)
    const bom = text.match(/mavenBom\s*\(?\s*["']org\.egovframe\.boot:egovframe-boot-starter-parent:([^"']+)["']/);
    if (bom) {
      const v = resolve(bom[1]) ?? null;
      const src = baseline.sources.find((x) => x.groupId === "org.egovframe.boot" && x.artifactId === "egovframe-boot-starter-parent");
      if (v && !/\$/.test(v) && (parent.version === null || versionBelow(v, parent.version) === true))
        parent = { groupId: "org.egovframe.boot", artifactId: "egovframe-boot-starter-parent", version: v, kind: "boot", status: src ? (versionBelow(v, src.version) ? "outdated" : "ok") : "n/a" };
    }
    const kind: ParentInfo["kind"] | undefined = /mavenBom\s*\(?\s*["']org\.egovframe\.boot:egovframe-boot-starter-parent/.test(text) || (/org\.springframework\.boot/.test(text) && /io\.spring\.dependency-management/.test(text)) ? "boot" : undefined;
    for (const m of text.matchAll(/["']([\w.\-]+):([\w.\-]+)(?::([^"':\s]+))?(?::[\w.\-]+)?["']/g)) {
      if (/^(org\.egovframe\.boot:egovframe-boot-starter-parent|org\.springframework\.cloud:spring-cloud-dependencies)$/.test(`${m[1]}:${m[2]}`) && /mavenBom/.test(text.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0))) continue; // BOM import 줄
      const v = resolve(m[3]);
      deps.push({ file: rel, line: lineAt(text, m.index ?? 0), groupId: m[1], artifactId: m[2], version: m[3] ?? null, resolvedVersion: v && !/\$/.test(v) ? v : null, scope: null, parentKind: kind });
    }
    for (const m of text.matchAll(/(http:\/\/[^\s"']+)/g)) repoIssues.push({ file: rel, line: lineAt(text, m.index ?? 0), text: m[1] });
    const src = text.match(/sourceCompatibility\s*=?\s*["']?(?:JavaVersion\.VERSION_)?(1_8|1\.8|[0-9]+)/) ?? text.match(/languageVersion\s*=?\s*JavaLanguageVersion\.of\((\d+)\)/);
    if (src) java = src[1].replace("1_8", "1.8");
  }
  return { deps, java, repoIssues, parent };
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
  let baseline = loadDependencyBaseline();
  const rules = loadMigrationRules();
  const offline = opts.offline ?? true;
  const dir = path.resolve(opts.projectDir);
  const diag = diagnoseProject({ projectDir: dir });
  const files = walkProjectFiles(dir, opts.maxFiles ?? 20_000);
  const notes: string[] = [];
  const ws: Workspace = detectWorkspace(dir);
  const multi = isMultiModule(ws);
  // v0.47: 루트에 빌드 파일이 없어도 하위 독립 프로젝트가 있으면 그 빌드 도구로
  const buildSystem: CheckDependenciesResult["buildSystem"] = diag.buildSystem !== "unknown" ? diag.buildSystem : ((ws.modules[0] as typeof ws.modules[number] | undefined)?.buildTool ?? "unknown") as CheckDependenciesResult["buildSystem"];
  if (multi) notes.push(L(`작업공간(${ws.kind}) 모듈 ${ws.modules.length}개를 모듈별로 판정합니다${ws.notes.length ? ` — ${ws.notes.join(" ")}` : ""}.`, `Workspace (${ws.kind}): ${ws.modules.length} modules are assessed per module${ws.notes.length ? ` — ${ws.notes.join(" ")}` : ""}.`));

  let raw: RawDep[] = [];
  let parent: ParentInfo = { groupId: null, artifactId: null, version: null, kind: "none", status: "n/a" };
  let javaValue: string | null = null;
  let repoIssues: { file: string; line: number; text: string }[] = [];
  if (buildSystem === "maven") ({ deps: raw, parent, java: javaValue, repoIssues } = collectMaven(dir, files, baseline));
  else if (buildSystem === "gradle") ({ deps: raw, java: javaValue, repoIssues, parent } = collectGradle(dir, files, baseline));
  else notes.push(L("빌드 파일(pom.xml·build.gradle)을 찾지 못해 의존성 대조를 건너뜁니다.", "No build file (pom.xml/build.gradle) found — dependency comparison skipped."));
  // v1.3: 5.1.0 처럼 기본보다 새 parent(또는 RTE)를 쓰면 그 계열의 기준으로 판정한다
  {
    const used = (parent.kind === "web" || parent.kind === "boot") ? parent.version : diag.egovVersion;
    const picked = loadDependencyBaseline(used);
    if (picked !== baseline) { baseline = picked; notes.push(L(`${used} 프로젝트 — 의존성 기준을 표준프레임워크 ${picked.rte.version} 기준(조사일 ${picked.surveyedAt}${picked.rte.bom ? `, BOM ${picked.rte.bom.artifactId}` : ""})으로 바꿔 판정합니다.`, `${used} project — dependencies are assessed against the eGovFrame ${picked.rte.version} baseline (surveyed ${picked.surveyedAt}${picked.rte.bom ? `, BOM ${picked.rte.bom.artifactId}` : ""}).`)); }
    else if (parent.kind === "web" || parent.kind === "boot") for (const n of newerBaselines(baseline)) notes.push(L(`표준프레임워크 ${n.rte.version} parent 가 저장소에 배포돼 있습니다(GitHub 태그 없음) — migrate_egovframe_project(target="${n.rte.version}") 로 갱신 항목을 볼 수 있습니다.`, `The eGovFrame ${n.rte.version} parent is published to the repository (no GitHub tag) — migrate_egovframe_project(target="${n.rte.version}") shows the update items.`));
  }
  if (parent.kind !== "none" && multi && !fs.existsSync(path.join(dir, "pom.xml")) === false && !/<parent>/.test(read(path.join(dir, "pom.xml")))) notes.push(L(`루트 pom 에 parent 가 없어 모듈 parent(${parent.artifactId}:${parent.version})를 대표로 봅니다.`, `The root pom has no parent; the module parent (${parent.artifactId}:${parent.version}) is used as representative.`));

  const findings: DependencyFinding[] = [];
  const seen = new Set<string>();
  for (const d of raw) {
    if (SKIP_SCOPES.has(d.scope ?? "")) continue;
    const key = `${d.file}\u0000${d.groupId}:${d.artifactId}\u0000${d.version ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = classifyDependency(d, { baseline, rules, parentKind: d.parentKind ?? parent.kind });
    const mod = multi ? moduleOf(ws, d.file) : null;
    findings.push({ file: d.file, line: d.line, groupId: d.groupId, artifactId: d.artifactId, version: d.version, resolvedVersion: d.resolvedVersion, scope: d.scope, status: c.status, baseline: c.baseline, basis: c.basis, origin: "declared", ...(mod ? { module: mod.name } : {}), ...(c.note ? { note: c.note } : {}) });
  }

  // ── v0.36: 해석된 트리 — 선언에 없는 artifact 는 transitive 로 추가하고, 선언과 다른 버전으로 풀린 좌표는 differs 로 ──
  let resolution: CheckDependenciesResult["resolution"];
  if (opts.resolve && buildSystem !== "unknown") {
    // v0.47: 루트 빌드 파일이 없는 독립 프로젝트 묶음은 프로젝트마다 해석해 합친다
    const targets = diag.buildSystem === "unknown" && ws.kind === "independent" ? ws.modules.map((m) => ({ dir: path.join(dir, m.dir), name: m.name, file: `${m.dir}/${m.buildTool === "maven" ? "pom.xml" : "build.gradle"}` })) : [{ dir, name: null as string | null, file: "" }];
    const trees: (DependencyTreeResult & { module: string | null; file: string })[] = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      throwIfAborted(opts.progress?.signal);
      const label = t.name ? `dependency tree (module ${t.name})` : "dependency tree";
      opts.progress?.report(label, i, targets.length);
      const sub = subProgress(opts.progress, i, i + 1, targets.length, label);
      trees.push({ ...(await resolveDependencyTree({ projectDir: t.dir, scope: opts.resolveScope ?? "runtime", timeoutMs: opts.resolveTimeoutMs, runner: opts.runner, platform: opts.platform, ...(opts.progress ? { progress: sub } : {}) })), module: t.name, file: t.file });
    }
    opts.progress?.report("dependency tree: done", targets.length, targets.length);
    const byArt = new Map<string, DependencyTreeResult["artifacts"][number] & { module: string | null; file: string }>();
    for (const t of trees) for (const a of t.artifacts) { const k = `${a.groupId}:${a.artifactId}:${a.version}`; if (!byArt.has(k)) byArt.set(k, { ...a, module: t.module, file: t.file }); }
    const tree = { ran: trees.every((t) => t.ran), success: trees.every((t) => t.success), scope: trees[0].scope, command: [...new Set(trees.map((t) => t.command))].join(" · "), durationMs: trees.reduce((n, t) => n + (t.durationMs ?? 0), 0), artifacts: [...byArt.values()], error: trees.filter((t) => t.error).map((t) => `${t.module ?? "."}: ${t.error}`).join("; ") || undefined } as DependencyTreeResult & { artifacts: (DependencyTreeResult["artifacts"][number] & { module: string | null; file: string })[] };
    const buildFileDefault = buildSystem === "maven" ? "pom.xml" : (files.find((f) => /build\.gradle(\.kts)?$/.test(f)) ? path.relative(dir, files.find((f) => /build\.gradle(\.kts)?$/.test(f))!).split(path.sep).join("/") : "build.gradle");
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
        if (declared.status === "managed" && cls.status === "outdated") declared.note = L(`parent 가 정한 해석 버전 ${a.version} 은 기준 ${cls.baseline} 미만 — parent 버전을 올리면 해결`, `Resolved version ${a.version} set by the parent is below baseline ${cls.baseline} — fixed by raising the parent version`);
        continue;
      }
      const c = classifyDependency({ groupId: a.groupId, artifactId: a.artifactId, version: a.version, resolvedVersion: a.version }, { baseline, rules, parentKind: parent.kind });
      rsum[c.status]++;
      transitive++;
      findings.push({ file: a.file || buildFileDefault, line: 0, groupId: a.groupId, artifactId: a.artifactId, version: a.version, resolvedVersion: a.version, scope: a.scope, status: c.status, baseline: c.baseline, basis: c.basis, origin: "transitive", via: a.via, depth: a.depth, ...(a.module ? { module: a.module } : {}), ...(c.note ? { note: c.note } : {}) });
    }
    resolution = { ran: tree.ran, success: tree.success, scope: tree.scope, command: tree.command, durationMs: tree.durationMs, artifacts: tree.artifacts.length, direct: tree.artifacts.filter((a) => a.depth === 1).length, transitive, differs, summary: rsum, ...(tree.error ? { error: tree.error } : {}) };
    if (!tree.success) notes.push(L(`의존성 트리 해석 실패(${tree.error ?? "원인 미상"}) — 선언된 의존성만 판정했습니다. 명령: ${tree.command}`, `Dependency tree resolution failed (${tree.error ?? "unknown cause"}) — only declared dependencies were assessed. Command: ${tree.command}`));
  } else if (opts.resolve) notes.push(L("빌드 파일이 없어 의존성 트리를 해석하지 않았습니다.", "No build file — dependency tree was not resolved."));

  findings.sort((a, b) => (a.origin === b.origin ? 0 : a.origin === "declared" ? -1 : 1) || a.file.localeCompare(b.file) || a.line - b.line || (a.depth ?? 0) - (b.depth ?? 0) || `${a.groupId}:${a.artifactId}`.localeCompare(`${b.groupId}:${b.artifactId}`));
  const summary: Record<DependencyStatus, number> = { ok: 0, outdated: 0, managed: 0, legacy: 0, replace: 0, vendor: 0, unknown: 0, unversioned: 0 };
  for (const f of findings) summary[f.status]++;

  // Java
  let javaStatus: CheckDependenciesResult["java"]["status"] = "unknown";
  if (javaValue) {
    const num = javaValue.startsWith("1.") ? Number(javaValue.slice(2)) : Number.parseInt(javaValue, 10);
    if (Number.isFinite(num)) javaStatus = num >= baseline.java ? "ok" : "outdated";
  } else if (parent.kind === "web" || parent.kind === "boot") { javaValue = String(baseline.java); javaStatus = "ok"; notes.push(L("java.version 은 5.x parent 가 관리합니다(17).", "java.version is managed by the 5.x parent (17).")); }

  // 보안 설정 점검 — 존재 여부만 판정하고 근거를 남긴다
  const checks: SecurityCheck[] = [];
  const secComponents = diag.detectedComponents.filter((c) => c.id === "sec.security" || c.id.startsWith("sec.security."));
  checks.push({
    id: "sec-security-component", title: L("공통컴포넌트 sec.security(인증·인가 기반) 설치", "Common component sec.security (authentication/authorization base) installed"),
    status: secComponents.length ? "ok" : diag.detectedComponents.length ? "missing" : "n/a",
    evidence: secComponents.map((c) => ({ file: c.matchedPrefix, line: 0, text: c.id })),
    hint: secComponents.length ? "" : L("add_egovframe_components(componentIds=[\"sec.security\"]) 로 설치하거나, 자체 Spring Security 설정을 쓰는 경우 아래 CSRF·헤더 항목으로 확인", "Install with add_egovframe_components(componentIds=[\"sec.security\"]), or if you use your own Spring Security configuration, verify via the CSRF and header checks below"),
  });
  const csrf = grepEvidence(dir, files, /<csrf\b|\.csrf\(|CsrfFilter|CsrfTokenRepository|csrfAccessDeniedUrl|_csrf|egov-security:config[^>]*csrf/i, (rel) => !rel.includes("/test/"));
  checks.push({ id: "csrf", title: L("CSRF 보호 설정", "CSRF protection configured"), status: csrf.length ? "ok" : "missing", evidence: csrf, hint: csrf.length ? "" : L("Spring Security 의 csrf() 또는 <csrf/> 설정(EgovSecurityConfig 의 csrf 속성)을 켜세요", "Enable Spring Security csrf() or the <csrf/> setting (csrf attribute of EgovSecurityConfig)") });
  const xss = grepEvidence(dir, files, /HTMLTagFilter|XssFilter|XSSFilter|xss-?filter|EgovXssFilter|Lucy|XssEscapeServletFilter/i, (rel) => /web\.xml$|\.java$|\.xml$/.test(rel) && !rel.includes("/test/"));
  checks.push({ id: "xss-filter", title: L("XSS 방어 필터(HTMLTagFilter 등)", "XSS defense filter (HTMLTagFilter etc.)"), status: xss.length ? "ok" : "missing", evidence: xss, hint: xss.length ? "" : L("web.xml 에 org.egovframe.rte.ptl.mvc.filter.HTMLTagFilter 를 등록하거나 Lucy-XSS 등 필터를 적용하세요", "Register org.egovframe.rte.ptl.mvc.filter.HTMLTagFilter in web.xml or apply a filter such as Lucy-XSS") });
  const headers = grepEvidence(dir, files, /HeaderWriterFilter|X-Frame-Options|Content-Security-Policy|X-Content-Type-Options|Strict-Transport-Security|\.headers\(|<headers\b|frameOptions|contentSecurityPolicy/i, (rel) => !rel.includes("/test/"));
  checks.push({ id: "security-headers", title: L("보안 응답 헤더(X-Frame-Options·CSP·HSTS 등)", "Security response headers (X-Frame-Options, CSP, HSTS, etc.)"), status: headers.length ? "ok" : "missing", evidence: headers, hint: headers.length ? "" : L("Spring Security headers() 또는 web.xml 필터로 X-Frame-Options·Content-Security-Policy 등을 설정하세요", "Set X-Frame-Options, Content-Security-Policy, etc. via Spring Security headers() or a web.xml filter") });
  checks.push({ id: "https-repositories", title: L("Maven 저장소 URL HTTPS", "Maven repository URLs use HTTPS"), status: repoIssues.length ? "missing" : (buildSystem === "unknown" ? "n/a" : "ok"), evidence: repoIssues, hint: repoIssues.length ? L("http:// 저장소는 중간자 변조에 노출됩니다. https://maven.egovframe.go.kr/maven/ 등 HTTPS 로 바꾸세요(migrate_egovframe_project 가 자동 치환)", "http:// repositories are exposed to man-in-the-middle tampering. Switch to HTTPS such as https://maven.egovframe.go.kr/maven/ (migrate_egovframe_project rewrites this automatically)") : "" });

  const result: CheckDependenciesResult = {
    projectDir: dir, buildSystem, offline,
    baseline: { surveyedAt: baseline.surveyedAt, rte: baseline.rte.version, springFramework: baseline.spring.framework, springBoot: baseline.spring.boot, java: baseline.java, bootBom: baseline.boot ? Object.keys(baseline.boot.managed).length : 0, rteTransitive: baseline.rteTransitive ? Object.keys(baseline.rteTransitive.managed).length : 0 },
    parent, java: { value: javaValue, status: javaStatus }, findings, summary, checks, ...(resolution ? { resolution } : {}), notes,
    ...(multi ? { workspace: { kind: ws.kind, modules: ws.modules.map((m) => {
      const fs_ = findings.filter((f) => f.module === m.name);
      const sm: Record<DependencyStatus, number> = { ok: 0, outdated: 0, managed: 0, legacy: 0, replace: 0, vendor: 0, unknown: 0, unversioned: 0 };
      for (const f of fs_) sm[f.status]++;
      return { name: m.name, dir: m.dir, buildTool: m.buildTool, findings: fs_.length, summary: sm };
    }) } } : {}),
  };

  if (!offline) {
    const effectiveVersion = (f: DependencyFinding): string | null => f.treeVersion ?? f.resolvedVersion;
    const targets = findings.filter((f) => effectiveVersion(f));
    const skipped = findings.length - targets.length;
    const query = opts.osvQuery ?? defaultOsvQuery;
    const vulns: Vulnerability[] = [];
    try {
      for (let i = 0; i < targets.length; i += 100) {
        const chunk = targets.slice(i, i + 100);
        const res = await query(chunk.map((f) => ({ package: { name: `${f.groupId}:${f.artifactId}`, ecosystem: "Maven" as const }, version: osvVersion(effectiveVersion(f)!) })));
        res.results.forEach((r, j) => {
          const ids = (r.vulns ?? []).map((v) => v.id);
          if (ids.length) vulns.push({ dependency: `${chunk[j].groupId}:${chunk[j].artifactId}`, version: effectiveVersion(chunk[j])!, ids });
        });
      }
      result.vulnerabilities = vulns;
      if (skipped > 0) result.notes.push(L(`버전을 확정하지 못한 의존성 ${skipped}건은 OSV 조회에서 제외했습니다 — 이 항목들의 취약점 유무는 확인되지 않았습니다(resolve=true 로 트리를 해석하면 관리되는 버전을 조회할 수 있음).`, `${skipped} dependenc${skipped === 1 ? "y" : "ies"} with no determined version were excluded from the OSV query — their vulnerability status is unverified (resolving the tree with resolve=true can supply managed versions).`));
      if (!opts.osvQuery) { const note = osvProvenanceNote(); if (note) result.notes.push(note); }
    } catch (e) {
      result.osvError = L(`OSV 조회 실패: ${e instanceof Error ? e.message : String(e)}`, `OSV query failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

export const STATUS_LABEL: Record<DependencyStatus, string> = { get ok() { return L("기준 충족", "meets baseline"); }, get outdated() { return L("기준 미만", "below baseline"); }, get managed() { return L("parent 관리", "managed by parent"); }, get legacy() { return L("전환 대상", "migration target"); }, get replace() { return L("교체 필요", "needs replacement"); }, get vendor() { return L("벤더 배포", "vendor"); }, get unknown() { return L("기준 없음", "no baseline"); }, get unversioned() { return L("버전 없음", "unversioned"); } };

/** 점검 결과를 Markdown 으로 렌더링한다. */
export function renderDependencyMarkdown(r: CheckDependenciesResult): string {
  const out: string[] = [];
  out.push(L(`# 의존성 점검`, `# Dependency check`), ``);
  out.push(L(`- 경로: ${r.projectDir} · 빌드 ${r.buildSystem} · ${r.offline ? "오프라인" : "OSV 조회 포함"}`, `- Path: ${r.projectDir} · build ${r.buildSystem} · ${r.offline ? "offline" : "with OSV query"}`));
  out.push(L(`- 기준: 공식 5.x parent(조사일 ${r.baseline.surveyedAt}) — RTE ${r.baseline.rte}, Spring ${r.baseline.springFramework ?? "-"}, Boot ${r.baseline.springBoot ?? "-"}, Java ${r.baseline.java}${r.baseline.bootBom ? ` · Boot BOM ${r.baseline.bootBom}종 · RTE 전이 ${r.baseline.rteTransitive ?? 0}종` : ""}`, `- Baseline: official 5.x parent (surveyed ${r.baseline.surveyedAt}) — RTE ${r.baseline.rte}, Spring ${r.baseline.springFramework ?? "-"}, Boot ${r.baseline.springBoot ?? "-"}, Java ${r.baseline.java}${r.baseline.bootBom ? ` · Boot BOM ${r.baseline.bootBom} entries · RTE transitive ${r.baseline.rteTransitive ?? 0} entries` : ""}`));
  out.push(L(`- parent: ${r.parent.kind === "none" ? "없음" : `${r.parent.groupId}:${r.parent.artifactId}:${r.parent.version ?? "?"} (${r.parent.kind}, ${r.parent.status})`}`, `- parent: ${r.parent.kind === "none" ? "none" : `${r.parent.groupId}:${r.parent.artifactId}:${r.parent.version ?? "?"} (${r.parent.kind}, ${r.parent.status})`}`));
  out.push(L(`- Java: ${r.java.value ?? "미검출"} (${r.java.status})`, `- Java: ${r.java.value ?? "not detected"} (${r.java.status})`));
  const s = r.summary;
  out.push(L(`- 의존성 ${r.findings.length}건: 기준 충족 ${s.ok} · 기준 미만 ${s.outdated} · parent 관리 ${s.managed} · 전환 대상 ${s.legacy} · 교체 필요 ${s.replace} · 벤더 배포 ${s.vendor ?? 0} · 기준 없음 ${s.unknown} · 버전 없음 ${s.unversioned}`, `- Dependencies ${r.findings.length}: meets baseline ${s.ok} · below baseline ${s.outdated} · managed by parent ${s.managed} · migration target ${s.legacy} · needs replacement ${s.replace} · vendor ${s.vendor ?? 0} · no baseline ${s.unknown} · unversioned ${s.unversioned}`));
  const basisCount = new Map<DependencyBasis, number>();
  for (const f of r.findings) if (f.basis) basisCount.set(f.basis, (basisCount.get(f.basis) ?? 0) + 1);
  if (basisCount.size) out.push(L(`- 기준 출처: ${[...basisCount.entries()].map(([k, v]) => `${BASIS_LABEL[k]} ${v}`).join(" · ")}`, `- Baseline sources: ${[...basisCount.entries()].map(([k, v]) => `${BASIS_LABEL[k]} ${v}`).join(" · ")}`));
  if (r.resolution) {
    const x = r.resolution;
    if (x.success) {
      const rs = x.summary;
      out.push(L(`- 해석된 트리(${x.scope}, ${x.durationMs ?? "?"}ms): artifact ${x.artifacts}종 = 직접 ${x.direct} + 전이 ${x.artifacts - x.direct} (선언에 없던 전이 ${x.transitive}) — 기준 충족 ${rs.ok} · 기준 미만 ${rs.outdated} · 전환 대상 ${rs.legacy} · 교체 필요 ${rs.replace} · 벤더 ${rs.vendor} · 기준 없음 ${rs.unknown}`, `- Resolved tree (${x.scope}, ${x.durationMs ?? "?"}ms): ${x.artifacts} artifacts = direct ${x.direct} + transitive ${x.artifacts - x.direct} (undeclared transitive ${x.transitive}) — meets baseline ${rs.ok} · below baseline ${rs.outdated} · migration target ${rs.legacy} · needs replacement ${rs.replace} · vendor ${rs.vendor} · no baseline ${rs.unknown}`));
      if (x.differs.length) out.push(L(`- 선언과 다르게 해석된 좌표 ${x.differs.length}건(가까운 선언이 이김): ${x.differs.slice(0, 8).map((d) => `${d.artifactId} ${d.declared}→${d.resolved}`).join(", ")}${x.differs.length > 8 ? " …" : ""}`, `- Coordinates resolved differently from declaration ${x.differs.length} (nearest declaration wins): ${x.differs.slice(0, 8).map((d) => `${d.artifactId} ${d.declared}→${d.resolved}`).join(", ")}${x.differs.length > 8 ? " …" : ""}`));
    } else out.push(L(`- 해석된 트리: 실패 (${x.error ?? "원인 미상"}) — 선언만 판정`, `- Resolved tree: failed (${x.error ?? "unknown cause"}) — declared only`));
  }
  for (const n of r.notes) out.push(`- ${n}`);
  if (r.workspace) {
    out.push(``, L(`## 모듈별 (${r.workspace.kind}, ${r.workspace.modules.length}개)`, `## By module (${r.workspace.kind}, ${r.workspace.modules.length})`), ``, L(`| 모듈 | 빌드 | 의존성 | 기준 충족 | 기준 미만 | 관리 | 전환·교체 | 기준 없음 | 버전 없음 |`, `| Module | Build | Dependencies | Meets baseline | Below baseline | Managed | Migrate/replace | No baseline | Unversioned |`), `|---|---|---|---|---|---|---|---|---|`);
    for (const m of r.workspace.modules) out.push(`| ${m.dir || m.name} | ${m.buildTool} | ${m.findings} | ${m.summary.ok} | ${m.summary.outdated} | ${m.summary.managed} | ${m.summary.legacy + m.summary.replace} | ${m.summary.unknown} | ${m.summary.unversioned} |`);
  }
  const attention = r.findings.filter((f) => f.status === "outdated" || f.status === "legacy" || f.status === "replace" || f.status === "unversioned");
  if (attention.length) {
    out.push(``, L(`## 조치 필요 (${attention.length})`, `## Action required (${attention.length})`), ``, L(`| 파일:라인 | 좌표 | 현재 | 기준/대체 | 상태 | 출처 | 비고 |`, `| File:line | Coordinate | Current | Baseline/replacement | Status | Source | Note |`), `|---|---|---|---|---|---|---|`);
    for (const f of attention) out.push(`| ${f.origin === "transitive" ? L(`(전이) ${f.via?.length ? f.via.join(" → ") : "-"}`, `(transitive) ${f.via?.length ? f.via.join(" → ") : "-"}`) : `${f.file}:${f.line}`} | ${f.groupId}:${f.artifactId} | ${f.resolvedVersion ?? f.version ?? "-"} | ${f.baseline ?? "-"} | ${STATUS_LABEL[f.status]} | ${f.basis ? BASIS_LABEL[f.basis] : "-"} | ${f.note ?? ""} |`);
  }
  const vendor = r.findings.filter((f) => f.status === "vendor");
  if (vendor.length) out.push(``, L(`## 벤더·기관 배포 (${vendor.length}) — 공개 저장소 기준 없음`, `## Vendor/agency distributed (${vendor.length}) — no public repository baseline`), ``, ...vendor.map((f) => `- ${f.groupId}:${f.artifactId}${f.resolvedVersion ? `:${f.resolvedVersion}` : ""} — ${f.note ?? ""}`));
  const unknown = r.findings.filter((f) => f.status === "unknown");
  if (unknown.length) out.push(``, L(`## 기준 없음 (${unknown.length}) — 판단 보류`, `## No baseline (${unknown.length}) — no verdict`), ``, unknown.map((f) => `${f.groupId}:${f.artifactId}${f.resolvedVersion ? `:${f.resolvedVersion}` : ""}`).join(", "));
  out.push(``, L(`## 보안 설정 점검`, `## Security configuration checks`), ``);
  for (const c of r.checks) {
    const mark = c.status === "ok" ? "✅" : c.status === "missing" ? "⚠️" : "➖";
    out.push(`- ${mark} ${c.title}: ${c.status}${c.hint ? ` — ${c.hint}` : ""}`);
    for (const e of c.evidence.slice(0, 3)) out.push(`  - ${e.file}${e.line ? `:${e.line}` : ""} \`${e.text}\``);
  }
  if (r.vulnerabilities) {
    out.push(``, L(`## 알려진 취약점 (OSV, ${r.vulnerabilities.length}건)`, `## Known vulnerabilities (OSV, ${r.vulnerabilities.length})`), ``);
    if (r.vulnerabilities.length === 0) out.push(r.findings.some((f) => f.treeVersion ?? f.resolvedVersion)
      ? L(`조회한 의존성에 등록된 취약점이 없습니다.`, `No vulnerabilities are registered for the queried dependencies.`)
      : L(`버전을 확정한 의존성이 없어 OSV 조회를 수행하지 않았습니다.`, `No OSV query was performed because no dependency version could be determined.`));
    for (const v of r.vulnerabilities) out.push(`- ${v.dependency}:${v.version} — ${v.ids.slice(0, 6).join(", ")}${v.ids.length > 6 ? L(` 외 ${v.ids.length - 6}건`, ` and ${v.ids.length - 6} more`) : ""} (https://osv.dev/vulnerability/${v.ids[0]})`);
  }
  if (r.osvError) out.push(``, `⚠️ ${r.osvError}`);
  out.push(``, `---`, L(`읽기 전용 점검입니다. 전환 대상은 migrate_egovframe_project, 공통컴포넌트 갱신은 upgrade_egovframe_project 로 처리합니다.`, `This is a read-only check. Handle migration targets with migrate_egovframe_project and common-component updates with upgrade_egovframe_project.`));
  return out.join("\n");
}
