// 전환 준비도 평가서 (generate_egovframe_report sections=["assessment"], v0.37).
//   지금까지의 분석(진단 → 전환 진단 → 의존성 점검·보안 설정 → SBOM 확인)을 한 번에 돌려 한 장의 평가서로 묶는다.
//   등급은 두 축(전환 난이도·공급망 상태)을 A–D 로 매기되, 산식(요인·구간·점수)을 결과와 리포트 안에 그대로 적어
//   사람이 같은 숫자로 다시 계산할 수 있게 한다. 구간은 공식 공통컴포넌트 3.10.0·4.3.2 코퍼스(catalog/migration-corpus.json)와
//   공식 5.x 템플릿의 결과를 양 끝으로 삼아 정했다(docs/design-assessment-report.md).
//   비용·공수는 산정하지 않는다 — 건수와 등급까지만.
import * as fs from "node:fs";
import * as path from "node:path";
import { diagnoseProject } from "./diagnose.js";
import { migrateProject, type MigrateResult, type MigrationItem, type MigrationKind, type SourceEra } from "./migrate.js";
import { checkDependencies, STATUS_LABEL, BASIS_LABEL, type CheckDependenciesResult, type DependencyFinding, type DependencyStatus, type OsvQuery, type ParentInfo, type SecurityCheck, type Vulnerability } from "./dependencies.js";
import { DEFAULT_SBOM_PATH, type SbomDocument } from "./sbom.js";
import { checkMinimumElements, DEFAULT_VEX_PATH, type VexDocument } from "./sbom-check.js";
import { readRehearsalRecord } from "./rehearse.js";
import type { ResolveScope } from "./dependency-tree.js";
import type { Runner } from "./build-runner.js";
import { SERVER_VERSION } from "./version.js";
import { checkSecureCoding } from "./secure-coding.js";
import { updateProject, type UpdateInfo } from "./update.js";
import { L, tr } from "./lang.js";
const SECURE_ORIGIN_KO: Record<string, string> = { get component() { return L("공통컴포넌트 원본", "common component (original)"); }, get "component-modified"() { return L("공통컴포넌트 수정본", "common component (modified)"); }, get "component-unmanaged"() { return L("공통컴포넌트(매니페스트 없음)", "common component (no manifest)"); }, get project() { return L("프로젝트 코드", "project code"); }, get test() { return L("테스트", "test"); } };

// ── 등급 산식 (데이터) ─────────────────────────────────
export type Grade = "A" | "B" | "C" | "D";
/** 구간: 값이 upTo 이하이면 points. 마지막 구간의 upTo 는 null(무한). */
export interface Band { upTo: number | null; points: number }
export interface RubricFactor { id: string; label: string; bands: Band[]; /** 값을 어디서 세는지 */ source: string }
export interface Rubric { id: "migration" | "supplyChain"; title: string; factors: RubricFactor[]; /** 점수 합 → 등급: score ≤ upTo */ grades: { upTo: number | null; grade: Grade }[] }

const COUNT_BANDS = (a: number, b: number): Band[] => [{ upTo: 0, points: 0 }, { upTo: a, points: 1 }, { upTo: b, points: 2 }, { upTo: null, points: 3 }];
/** 제거된 API 참조로 세는 전환 항목 종류 */
export const REMOVED_API_KINDS: MigrationKind[] = ["class-removed", "component-class-removed", "removed-module", "xml-namespace"];
export const ERA_POINTS: Record<SourceEra, number> = { "5.x": 0, "4.x": 1, "3.x": 2, unknown: 1 };

export const MIGRATION_RUBRIC: Rubric = {
  id: "migration", get title() { return L("전환 난이도", "Migration difficulty"); },
  factors: [
    { id: "manual", get label() { return L("수동 전환 항목 수", "Manual migration items"); }, bands: COUNT_BANDS(20, 100), get source() { return L("migrate_egovframe_project 진단의 action=manual 항목 수", "count of action=manual items in the migrate_egovframe_project diagnosis"); } },
    { id: "reassemble", get label() { return L("재조립 권고 공통컴포넌트 수", "Common components recommended for reassembly"); }, bands: COUNT_BANDS(5, 20), get source() { return L("kind=component-reassemble 항목 수(컴포넌트 단위)", "count of kind=component-reassemble items (per component)"); } },
    { id: "removedApi", get label() { return L("제거된 API 참조 수", "Removed API references"); }, bands: COUNT_BANDS(10, 100), get source() { return L(`kind ∈ {${REMOVED_API_KINDS.join(", ")}} 항목 수`, `count of items with kind ∈ {${REMOVED_API_KINDS.join(", ")}}`); } },
    { id: "era", get label() { return L("현재 좌표 세대", "Current coordinate generation"); }, bands: [{ upTo: 0, points: 0 }, { upTo: 1, points: 1 }, { upTo: null, points: 2 }], get source() { return L("sourceEra: 5.x=0 · 4.x=1 · unknown=1 · 3.x=2 (값 자체가 점수)", "sourceEra: 5.x=0 · 4.x=1 · unknown=1 · 3.x=2 (the value is the score)"); } },
  ],
  grades: [{ upTo: 0, grade: "A" }, { upTo: 3, grade: "B" }, { upTo: 7, grade: "C" }, { upTo: null, grade: "D" }],
};

export const SUPPLY_CHAIN_RUBRIC: Rubric = {
  id: "supplyChain", get title() { return L("공급망 상태", "Supply-chain status"); },
  factors: [
    { id: "outdated", get label() { return L("기준 미만 의존성 수", "Dependencies below baseline"); }, bands: COUNT_BANDS(3, 10), get source() { return L("check_egovframe_dependencies status=outdated (resolve=true 면 전이 포함)", "check_egovframe_dependencies status=outdated (includes transitive when resolve=true)"); } },
    { id: "legacyReplace", get label() { return L("전환 대상·교체 필요 의존성 수", "Dependencies that are migration targets or need replacement"); }, bands: COUNT_BANDS(3, 10), source: "status ∈ {legacy, replace}" },
    { id: "vulnerabilities", get label() { return L("알려진 취약점이 있는 의존성 수", "Dependencies with known vulnerabilities"); }, bands: COUNT_BANDS(2, 9), get source() { return L("OSV 조회 결과(offline=false 일 때만; 미조회면 0점으로 계산하고 표시)", "OSV query result (only when offline=false; counted as 0 points and flagged when not queried)"); } },
    { id: "securityMissing", get label() { return L("보안 설정 누락 수", "Missing security configurations"); }, bands: [{ upTo: 0, points: 0 }, { upTo: 2, points: 1 }, { upTo: null, points: 2 }], get source() { return L("보안 설정 점검 status=missing 수(sec.security·CSRF·XSS 필터·보안 헤더·HTTPS 저장소)", "count of security checks with status=missing (sec.security, CSRF, XSS filter, security headers, HTTPS repositories)"); } },
    { id: "platform", get label() { return L("5.x parent·Java 기준", "5.x parent and Java baseline"); }, bands: [{ upTo: 0, points: 0 }, { upTo: 1, points: 1 }, { upTo: null, points: 2 }], get source() { return L("5.x parent 미사용·구버전이면 +1, Java 가 기준 미만·미검출이면 +1 (값 자체가 점수)", "+1 if the 5.x parent is missing or outdated, +1 if Java is below baseline or not detected (the value is the score)"); } },
  ],
  grades: [{ upTo: 0, grade: "A" }, { upTo: 3, grade: "B" }, { upTo: 7, grade: "C" }, { upTo: null, grade: "D" }],
};

export interface GradeFactorResult { id: string; label: string; value: number; points: number; band: string; note?: string }
export interface GradeResult { grade: Grade; score: number; max: number; factors: GradeFactorResult[]; /** 등급 구간 설명(예: "A=0 · B≤3 · C≤7 · D>7") */ scale: string; caveats: string[] }

export function pointsFor(bands: Band[], value: number): { points: number; band: string } {
  let lower = 0;
  for (const b of bands) {
    if (b.upTo === null || value <= b.upTo) {
      const band = b.upTo === null ? `${lower}+` : lower === b.upTo ? `${b.upTo}` : `${lower}–${b.upTo}`;
      return { points: b.points, band };
    }
    lower = b.upTo + 1;
  }
  return { points: bands[bands.length - 1].points, band: `${lower}+` };
}
export function gradeFor(rubric: Rubric, score: number): Grade {
  for (const g of rubric.grades) if (g.upTo === null || score <= g.upTo) return g.grade;
  return "D";
}
export function describeScale(rubric: Rubric): string {
  return rubric.grades.map((g, i) => (i === 0 ? `${g.grade}=${g.upTo}` : g.upTo === null ? `${g.grade}>${rubric.grades[i - 1].upTo}` : `${g.grade}≤${g.upTo}`)).join(" · ");
}
/** 요인 값 → 점수·등급 (순수 함수; 테스트가 리포트의 숫자로 재계산한다). */
export function computeGrade(rubric: Rubric, values: Record<string, number>, notes: Record<string, string> = {}, caveats: string[] = []): GradeResult {
  const factors: GradeFactorResult[] = rubric.factors.map((f) => {
    const value = values[f.id] ?? 0;
    const { points, band } = pointsFor(f.bands, value);
    return { id: f.id, label: f.label, value, points, band, ...(notes[f.id] ? { note: notes[f.id] } : {}) };
  });
  const score = factors.reduce((s, f) => s + f.points, 0);
  const max = rubric.factors.reduce((s, f) => s + Math.max(...f.bands.map((b) => b.points)), 0);
  return { grade: gradeFor(rubric, score), score, max, factors, scale: describeScale(rubric), caveats };
}

// ── 평가서 ─────────────────────────────────────────────
export interface AssessmentOptions {
  projectDir: string;
  /** 의존성: 빌드 도구로 전이까지 해석(기본 false) */
  resolve?: boolean;
  resolveScope?: ResolveScope;
  resolveTimeoutMs?: number;
  /** false 면 OSV 로 알려진 취약점 조회(기본 true = 조회 안 함) */
  offline?: boolean;
  osvQuery?: OsvQuery;
  /** 확인할 SBOM 경로(프로젝트 상대, 기본 sbom/bom.cdx.json) — 평가서는 SBOM 을 만들지 않고 있으면 요약만 한다 */
  sbomPath?: string;
  /** 수동 작업 목록 상위 N(기본 20) */
  topN?: number;
  maxFiles?: number;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  now?: () => number;
}

export interface AssessmentAction { groupId: string; artifactId: string; version: string | null; status: DependencyStatus; baseline: string | null; basis: string | null; origin: "declared" | "transitive"; file: string; line: number; action: string }
export interface AssessmentResult {
  projectDir: string;
  generatedAt: string;
  tool: { name: string; version: string; rulesTag: string; rulesSurveyedAt: string; baselineSurveyedAt: string; targetRuntime: string };
  overview: {
    buildSystem: "maven" | "gradle" | "unknown"; isEgovProject: boolean; rteVersion: string | null; sourceEra: SourceEra;
    parent: ParentInfo; java: CheckDependenciesResult["java"]; database: string | null;
    components: { count: number; ids: string[] }; aiLayer: boolean; hasManifest: boolean; filesScanned: number;
  };
  migration: {
    items: number; auto: number; manual: number; files: number; byKind: Record<string, number>; manualByKind: Record<string, number>;
    reassemble: string[]; removedApiRefs: number;
    /** 수동 작업 상위 N — 같은 (종류, from) 묶음의 건수 순 */
    manualTop: { kind: string; from: string; to: string | null; count: number; files: number; example: string; reason: string }[];
    manualTotalGroups: number;
    notes: string[];
    /** v0.46: 이미 5.x 인 프로젝트의 최신 유지(migrate_egovframe_project target=최신 5.0.x) 요약 — 등급 산식에는 넣지 않는다 */
    update?: { from: string | null; to: string; parentVersion: string | null; auto: number; manual: number; changes: UpdateInfo["changes"]; components: UpdateInfo["components"]; modules?: UpdateInfo["modules"] };
  };
  dependencies: {
    offline: boolean; findings: number; declared: number; transitive: number; summary: Record<DependencyStatus, number>;
    actions: AssessmentAction[];
    unknown: string[]; vendor: string[];
    resolution?: { ran: boolean; success: boolean; scope: ResolveScope; artifacts: number; direct: number; transitive: number; differs: number; error?: string };
    vulnerabilities: { queried: boolean; dependencies: number; ids: number; items: Vulnerability[] };
    osvError?: string;
    notes: string[];
  };
  security: { ok: number; missing: number; na: number; checks: SecurityCheck[] };
  /** v0.44: 보안약점 점검(check_egovframe_secure_coding) 요약 — 등급 산식에는 넣지 않는다 */
  secureCoding: { total: number; high: number; medium: number; low: number; byOrigin: Record<string, number>; byRule: { rule: string; guideItem: string; severity: string; count: number }[]; suppressed: number; error?: string };
  sbom: {
    present: boolean; path: string; components?: number; specVersion?: string; timestamp?: string; vulnerabilities?: number;
    /** v0.40: 최소 요소 7종 */
    minimum?: { verdict: "ready" | "needs-work"; missing: string[] };
    /** v0.40: VEX(같은 디렉터리의 vex.cdx.json) — timestamp 는 마지막 점검(check_egovframe_sbom vex=true) 시각 */
    vex?: { path: string; present: boolean; timestamp?: string; vulnerabilities?: number; states?: Record<string, number> };
    note: string;
  };
  grades: { migration: GradeResult; supplyChain: GradeResult };
  /** v0.47: 멀티 모듈 작업공간이면 모듈별 요약(등급은 전체 합산) */
  modules?: { name: string; dir: string; buildTool: string; dependencies: number; outdated: number; legacyReplace: number; updateAuto: number; updateManual: number; secure: number }[];
  /** v0.41: 최근 리허설(rehearse_egovframe_migration) 실측 — 등급 산식에는 넣지 않는다 */
  rehearsal?: { at: string; afterAutomation: number | null; afterPomAlignment: number | null; projectUnchanged: boolean; origin: string | null };
  notes: string[];
}

const MANUAL_KIND_LABEL: Record<string, [ko: string, en: string]> = {
  coordinate: ["RTE Maven 좌표", "RTE Maven coordinate"], "coordinate-unknown": ["알 수 없는 RTE 좌표", "Unknown RTE coordinate"], "rte-version": ["RTE 버전", "RTE version"], parent: ["5.x parent", "5.x parent"], repository: ["Maven 저장소 URL", "Maven repository URL"],
  "removed-module": ["제거된 RTE 모듈", "Removed RTE module"], "jakarta-artifact": ["Jakarta 의존성 좌표", "Jakarta dependency coordinate"], library: ["교체 필요 라이브러리", "Library needing replacement"], "java-release": ["Java 버전", "Java version"], "spring-version": ["Spring 버전", "Spring version"],
  package: ["RTE 패키지 접두어", "RTE package prefix"], "package-renamed": ["RTE 패키지 이름 변경", "Renamed RTE package"], "class-moved": ["RTE 클래스 이동", "Moved RTE class"], "class-removed": ["제거된 RTE 클래스", "Removed RTE class"], "class-unknown": ["확인 필요 클래스", "Class needing verification"],
  "jakarta-package": ["javax → jakarta 패키지", "javax → jakarta package"], "web-xml": ["web.xml 스키마", "web.xml schema"], "xml-namespace": ["제거된 XML 네임스페이스", "Removed XML namespace"],
  "component-class-removed": ["제거된 공통컴포넌트 클래스", "Removed common-component class"], "component-class-moved": ["이동한 공통컴포넌트 클래스", "Moved common-component class"], "component-reassemble": ["공통컴포넌트 재조립 권고", "Common component reassembly recommended"],
};
export const kindLabel = (k: string): string => { const l = MANUAL_KIND_LABEL[k]; return l ? L(l[0], l[1]) : k; };

/** 수동 항목을 (종류, from) 으로 묶어 건수 순 상위 N 을 만든다. */
export function groupManualItems(items: MigrationItem[], topN: number): { top: AssessmentResult["migration"]["manualTop"]; groups: number } {
  const g = new Map<string, { kind: string; from: string; to: string | null; count: number; files: Set<string>; example: string; reason: string }>();
  for (const i of items) {
    if (i.action !== "manual") continue;
    const k = `${i.kind}\u0000${i.from}`;
    const cur = g.get(k);
    if (cur) { cur.count++; cur.files.add(i.file); continue; }
    g.set(k, { kind: i.kind, from: i.from, to: i.to, count: 1, files: new Set([i.file]), example: `${i.file}:${i.line}`, reason: i.reason });
  }
  const sorted = [...g.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from));
  return { top: sorted.slice(0, topN).map((x) => ({ kind: x.kind, from: x.from, to: x.to, count: x.count, files: x.files.size, example: x.example, reason: x.reason })), groups: sorted.length };
}

/** 조치 문구: 판정과 기준으로 사람이 할 일을 한 줄로. */
export function actionFor(f: DependencyFinding): string {
  switch (f.status) {
    case "outdated": return (f.note?.includes("parent 가 정한") || f.note?.includes("set by the parent")) ? f.note : L(`${f.baseline ?? "기준"} 이상으로 올림${f.note ? ` (${f.note})` : ""}`, `Raise to ${f.baseline ?? "baseline"} or higher${f.note ? ` (${f.note})` : ""}`);
    case "legacy": return f.baseline ? L(`${f.baseline} 로 전환${f.note ? ` — ${f.note}` : ""}`, `Migrate to ${f.baseline}${f.note ? ` — ${f.note}` : ""}`) : (f.note ?? L("5.x 좌표로 전환", "Migrate to the 5.x coordinate"));
    case "replace": return f.baseline ? L(`${f.baseline} 로 교체${f.note ? ` — ${f.note}` : ""}`, `Replace with ${f.baseline}${f.note ? ` — ${f.note}` : ""}`) : L(`제거${f.note ? ` — ${f.note}` : ""}`, `Remove${f.note ? ` — ${f.note}` : ""}`);
    case "unversioned": return L("버전을 명시하거나 5.x parent 로 관리", "Specify a version or manage it via the 5.x parent");
    default: return f.note ?? "";
  }
}

function readVex(projectDir: string, rel: string): NonNullable<AssessmentResult["sbom"]["vex"]> {
  const abs = path.resolve(projectDir, rel);
  if (!fs.existsSync(abs)) return { path: rel, present: false };
  try {
    const v = JSON.parse(fs.readFileSync(abs, "utf8")) as VexDocument;
    const states: Record<string, number> = {};
    for (const x of v.vulnerabilities ?? []) { const s = x.analysis?.state ?? "in_triage"; states[s] = (states[s] ?? 0) + 1; }
    return { path: rel, present: true, ...(v.metadata?.timestamp ? { timestamp: v.metadata.timestamp } : {}), vulnerabilities: (v.vulnerabilities ?? []).length, states };
  } catch { return { path: rel, present: false }; }
}

function readSbom(projectDir: string, rel: string): AssessmentResult["sbom"] {
  const abs = path.resolve(projectDir, rel);
  if (!fs.existsSync(abs)) return { present: false, path: rel, note: L(`SBOM 없음 — generate_egovframe_sbom(dryRun=false) 으로 ${rel} 에 CycloneDX 문서를 만들 수 있습니다.`, `No SBOM — generate_egovframe_sbom(dryRun=false) can create a CycloneDX document at ${rel}.`) };
  try {
    const doc = JSON.parse(fs.readFileSync(abs, "utf8")) as SbomDocument & { vulnerabilities?: unknown[] };
    if (doc.bomFormat !== "CycloneDX") return { present: false, path: rel, note: L(`${rel} 은 CycloneDX 문서가 아닙니다(bomFormat=${String(doc.bomFormat)}).`, `${rel} is not a CycloneDX document (bomFormat=${String(doc.bomFormat)}).`) };
    const m = checkMinimumElements(doc);
    const minimum = { verdict: m.verdict, missing: m.elements.filter((e) => !e.ok).map((e) => e.label) };
    const vexRel = path.posix.join(path.posix.dirname(rel), path.posix.basename(DEFAULT_VEX_PATH));
    const vex = readVex(projectDir, vexRel);
    return { present: true, path: rel, components: (doc.components ?? []).length, specVersion: doc.specVersion, timestamp: doc.metadata?.timestamp, vulnerabilities: Array.isArray(doc.vulnerabilities) ? doc.vulnerabilities.length : 0, minimum, vex, note: L(`CycloneDX ${doc.specVersion} · component ${(doc.components ?? []).length}종${doc.metadata?.timestamp ? ` · 생성 ${doc.metadata.timestamp}` : ""}`, `CycloneDX ${doc.specVersion} · ${(doc.components ?? []).length} components${doc.metadata?.timestamp ? ` · generated ${doc.metadata.timestamp}` : ""}`) };
  } catch (e) {
    return { present: false, path: rel, note: L(`${rel} 을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, `Could not read ${rel}: ${e instanceof Error ? e.message : String(e)}`) };
  }
}

/** 평가서를 만든다. 디스크를 바꾸지 않는다(resolve=true 면 빌드 도구가 로컬 저장소에 내려받을 수는 있다). */
export async function assessProject(opts: AssessmentOptions): Promise<AssessmentResult> {
  const projectDir = path.resolve(opts.projectDir);
  const now = opts.now ?? Date.now;
  const diag = diagnoseProject({ projectDir });
  const mig: MigrateResult = migrateProject({ projectDir, maxFiles: opts.maxFiles });
  const dep = await checkDependencies({ projectDir, offline: opts.offline ?? true, osvQuery: opts.osvQuery, maxFiles: opts.maxFiles, resolve: opts.resolve, resolveScope: opts.resolveScope, resolveTimeoutMs: opts.resolveTimeoutMs, runner: opts.runner, platform: opts.platform });
  const topN = opts.topN ?? 20;
  const notes: string[] = [];

  // 전환 범위
  const manualByKind: Record<string, number> = {};
  for (const i of mig.items) if (i.action === "manual") manualByKind[i.kind] = (manualByKind[i.kind] ?? 0) + 1;
  const reassemble = mig.items.filter((i) => i.kind === "component-reassemble").map((i) => i.from.replace(/\s.*$/, ""));
  const removedApiRefs = mig.items.filter((i) => REMOVED_API_KINDS.includes(i.kind)).length;
  const { top: manualTop, groups } = groupManualItems(mig.items, topN);
  let update: AssessmentResult["migration"]["update"];
  if (mig.sourceEra === "5.x" || (mig.sourceEra === "unknown" && (dep.parent.kind === "web" || dep.parent.kind === "boot"))) {
    try {
      const u = updateProject({ projectDir, maxFiles: opts.maxFiles });
      update = { from: u.update.from, to: u.update.to, parentVersion: u.update.parent?.version ?? null, auto: u.summary.auto, manual: u.summary.manual, changes: u.update.changes, components: u.update.components, ...(u.update.modules ? { modules: u.update.modules } : {}) };
    } catch (e) { notes.push(L(`5.x 최신 유지 점검 실패: ${e instanceof Error ? e.message : String(e)}`, `5.x keep-current check failed: ${e instanceof Error ? e.message : String(e)}`)); }
  }

  // 의존성
  const actions: AssessmentAction[] = dep.findings
    .filter((f) => f.status === "outdated" || f.status === "legacy" || f.status === "replace" || f.status === "unversioned")
    .map((f) => ({ groupId: f.groupId, artifactId: f.artifactId, version: f.resolvedVersion ?? f.version, status: f.status, baseline: f.baseline, basis: f.basis ? BASIS_LABEL[f.basis] : null, origin: f.origin, file: f.file, line: f.line, action: actionFor(f) }));
  const coord = (f: DependencyFinding) => `${f.groupId}:${f.artifactId}${f.resolvedVersion ? `:${f.resolvedVersion}` : ""}`;
  const vulnQueried = dep.offline === false && !dep.osvError;
  const vulns = dep.vulnerabilities ?? [];
  const resolution = dep.resolution ? { ran: dep.resolution.ran, success: dep.resolution.success, scope: dep.resolution.scope, artifacts: dep.resolution.artifacts, direct: dep.resolution.direct, transitive: dep.resolution.transitive, differs: dep.resolution.differs.length, ...(dep.resolution.error ? { error: dep.resolution.error } : {}) } : undefined;
  if (opts.resolve && dep.buildSystem === "unknown") notes.push(L("resolve=true 이지만 빌드 파일이 없어 전이 의존성은 해석하지 않았습니다.", "resolve=true but no build file was found, so transitive dependencies were not resolved."));

  // 보안
  const security = { ok: dep.checks.filter((c) => c.status === "ok").length, missing: dep.checks.filter((c) => c.status === "missing").length, na: dep.checks.filter((c) => c.status === "n/a").length, checks: dep.checks };
  // v0.44: 보안약점(패턴) — 실패해도 평가서는 계속
  let secureCoding: AssessmentResult["secureCoding"];
  let secureByModule: { module: string; total: number }[] | undefined;
  try {
    const sc = await checkSecureCoding({ projectDir, maxFindings: 1, maxFiles: opts.maxFiles });
    secureByModule = sc.byModule;
    secureCoding = { total: sc.summary.total, high: sc.summary.high, medium: sc.summary.medium, low: sc.summary.low, byOrigin: Object.fromEntries(Object.entries(sc.byOrigin).filter(([, n]) => n)), byRule: sc.byRule, suppressed: sc.summary.suppressed };
  } catch (e) {
    secureCoding = { total: 0, high: 0, medium: 0, low: 0, byOrigin: {}, byRule: [], suppressed: 0, error: e instanceof Error ? e.message : String(e) };
  }
  // SBOM
  const sbom = readSbom(projectDir, (opts.sbomPath ?? DEFAULT_SBOM_PATH).replace(/\\/g, "/"));

  // 등급
  const migration = computeGrade(MIGRATION_RUBRIC, { manual: mig.summary.manual, reassemble: reassemble.length, removedApi: removedApiRefs, era: ERA_POINTS[mig.sourceEra] }, { era: `sourceEra=${mig.sourceEra}` });
  const platformPoints = (dep.parent.kind === "web" || dep.parent.kind === "boot" ? (dep.parent.status === "ok" ? 0 : 1) : 1) + (dep.java.status === "ok" ? 0 : 1);
  const scCaveats: string[] = [];
  if (!vulnQueried) scCaveats.push(dep.osvError ? L(`취약점 조회 실패(${dep.osvError}) — 취약점 요인은 0점으로 계산`, `Vulnerability query failed (${dep.osvError}) — the vulnerability factor is counted as 0 points`) : L("알려진 취약점을 조회하지 않았습니다(offline=true) — 취약점 요인은 0점으로 계산. offline=false 로 조회해야 확정 등급입니다", "Known vulnerabilities were not queried (offline=true) — the vulnerability factor is counted as 0 points. Query with offline=false for a final grade"));
  if (dep.resolution && !dep.resolution.success) scCaveats.push(L(`전이 의존성 해석 실패(${dep.resolution.error ?? "원인 미상"}) — 선언된 의존성만 반영`, `Transitive dependency resolution failed (${dep.resolution.error ?? "unknown cause"}) — only declared dependencies are reflected`));
  const supplyChain = computeGrade(SUPPLY_CHAIN_RUBRIC, {
    outdated: dep.summary.outdated, legacyReplace: dep.summary.legacy + dep.summary.replace, vulnerabilities: vulnQueried ? vulns.length : 0, securityMissing: security.missing, platform: platformPoints,
  }, {
    vulnerabilities: vulnQueried ? L(`OSV 조회 ${new Date(now()).toISOString().slice(0, 10)}`, `OSV queried ${new Date(now()).toISOString().slice(0, 10)}`) : L("미조회", "not queried"),
    platform: L(`parent ${dep.parent.kind === "none" ? "없음" : `${dep.parent.kind}/${dep.parent.status}`} · Java ${dep.java.value ?? "미검출"}/${dep.java.status}`, `parent ${dep.parent.kind === "none" ? "none" : `${dep.parent.kind}/${dep.parent.status}`} · Java ${dep.java.value ?? "not detected"}/${dep.java.status}`),
  }, scCaveats);

  return {
    projectDir, generatedAt: new Date(now()).toISOString(),
    tool: { name: "egovframe-scaffold-mcp", version: SERVER_VERSION, rulesTag: mig.rules.toTag, rulesSurveyedAt: mig.rules.surveyedAt, baselineSurveyedAt: dep.baseline.surveyedAt, targetRuntime: mig.rules.runtimeVersion },
    overview: {
      buildSystem: diag.buildSystem, isEgovProject: diag.isEgovProject, rteVersion: mig.rteVersion, sourceEra: mig.sourceEra, parent: dep.parent, java: dep.java, database: diag.database,
      components: { count: diag.detectedComponents.length, ids: diag.detectedComponents.map((c) => c.id) }, aiLayer: diag.aiLayer, hasManifest: diag.hasManifest, filesScanned: mig.filesScanned,
    },
    migration: { items: mig.items.length, auto: mig.summary.auto, manual: mig.summary.manual, files: mig.summary.files, byKind: mig.summary.byKind, manualByKind, reassemble, removedApiRefs, manualTop, manualTotalGroups: groups, notes: mig.notes, ...(update ? { update } : {}) },
    dependencies: {
      offline: dep.offline, findings: dep.findings.length, declared: dep.findings.filter((f) => f.origin === "declared").length, transitive: dep.findings.filter((f) => f.origin === "transitive").length, summary: dep.summary,
      actions, unknown: dep.findings.filter((f) => f.status === "unknown").map(coord), vendor: dep.findings.filter((f) => f.status === "vendor").map(coord),
      ...(resolution ? { resolution } : {}),
      vulnerabilities: { queried: vulnQueried, dependencies: vulns.length, ids: vulns.reduce((s, v) => s + v.ids.length, 0), items: vulns },
      ...(dep.osvError ? { osvError: dep.osvError } : {}),
      notes: dep.notes,
    },
    security, secureCoding, sbom,
    grades: { migration, supplyChain },
    ...(dep.workspace ? { modules: dep.workspace.modules.map((m) => {
      const u = update?.modules?.find((x) => x.name === m.name);
      return { name: m.name, dir: m.dir, buildTool: m.buildTool, dependencies: m.findings, outdated: m.summary.outdated, legacyReplace: m.summary.legacy + m.summary.replace, updateAuto: u?.auto ?? 0, updateManual: u?.manual ?? 0, secure: secureByModule?.find((x) => x.module === m.dir)?.total ?? 0 };
    }) } : {}),
    ...(() => {
      const rec = readRehearsalRecord(projectDir);
      if (!rec) return {};
      const cnt = (p?: { ran: boolean; success: boolean | null; analysis?: { errors: number } }) => (p?.ran ? (p.success ? 0 : p.analysis?.errors ?? null) : null);
      return { rehearsal: { at: rec.startedAt, afterAutomation: cnt(rec.afterAutomation), afterPomAlignment: cnt(rec.afterPomAlignment), projectUnchanged: rec.original.unchanged, origin: rec.reassemble?.origin ?? null } };
    })(),
    notes,
  };
}

function renderGrade(out: string[], title: string, g: GradeResult): void {
  out.push(L(`### ${title}: **${g.grade}** (${g.score}/${g.max}점, ${g.scale})`, `### ${title}: Grade **${g.grade}** (${g.score}/${g.max} points, ${g.scale})`), ``, L(`| 요인 | 값 | 구간 | 점수 | 비고 |`, `| Factor | Value | Band | Points | Note |`), `|---|---|---|---|---|`);
  for (const f of g.factors) out.push(`| ${f.label} | ${f.value} | ${f.band} | ${f.points} | ${f.note ?? ""} |`);
  for (const c of g.caveats) out.push(`- ⚠️ ${c}`);
  out.push(``);
}
function renderFormula(out: string[], rubric: Rubric): void {
  out.push(L(`**${rubric.title} 산식** — 요인별 점수를 더한 합계로 등급을 정합니다(${describeScale(rubric)}).`, `**${rubric.title} formula** — the grade is the sum of per-factor points (${describeScale(rubric)}).`), ``);
  for (const f of rubric.factors) {
    let lower = 0;
    const bands = f.bands.map((b) => { const s = b.upTo === null ? `${lower}+→${b.points}` : lower === b.upTo ? `${b.upTo}→${b.points}` : `${lower}–${b.upTo}→${b.points}`; lower = (b.upTo ?? 0) + 1; return s; });
    out.push(`- ${f.label}: ${bands.join(", ")} — ${f.source}`);
  }
  out.push(``);
}

/** 평가서 Markdown. */
export function renderAssessmentMarkdown(r: AssessmentResult): string {
  const out: string[] = [];
  const o = r.overview;
  out.push(L(`# 표준프레임워크 5.x 전환 준비도 평가서`, `# eGovFrame 5.x migration readiness assessment`), ``);
  out.push(L(`- 경로: ${r.projectDir}`, `- Path: ${r.projectDir}`));
  out.push(L(`- 생성: ${r.generatedAt} · ${r.tool.name} ${r.tool.version} · 전환 규칙 ${r.tool.rulesTag}(조사 ${r.tool.rulesSurveyedAt}) · 의존성 기준 조사 ${r.tool.baselineSurveyedAt}`, `- Generated: ${r.generatedAt} · ${r.tool.name} ${r.tool.version} · migration rules ${r.tool.rulesTag} (surveyed ${r.tool.rulesSurveyedAt}) · dependency baseline surveyed ${r.tool.baselineSurveyedAt}`));
  out.push(L(`- **전환 난이도 ${r.grades.migration.grade} · 공급망 상태 ${r.grades.supplyChain.grade}** (산식은 6절)`, `- **Migration difficulty ${r.grades.migration.grade} · Supply-chain status ${r.grades.supplyChain.grade}** (formula in section 6)`));
  for (const n of r.notes) out.push(`- ${n}`);
  out.push(``, L(`## 1. 프로젝트 개요`, `## 1. Project overview`), ``);
  out.push(L(`| 항목 | 값 |`, `| Item | Value |`), `|---|---|`);
  out.push(L(`| 빌드 도구 | ${o.buildSystem}${o.isEgovProject ? " (egovframe 좌표 있음)" : ""} |`, `| Build tool | ${o.buildSystem}${o.isEgovProject ? " (egovframe coordinates present)" : ""} |`));
  out.push(L(`| RTE | ${o.rteVersion ?? "미검출"} (${o.sourceEra} 좌표) → 목표 ${r.tool.targetRuntime} |`, `| RTE | ${o.rteVersion ?? "not detected"} (${o.sourceEra} coordinates) → target ${r.tool.targetRuntime} |`));
  out.push(L(`| parent | ${o.parent.kind === "none" ? "없음" : `${o.parent.groupId}:${o.parent.artifactId}:${o.parent.version ?? "?"} (${o.parent.kind}, ${o.parent.status})`} |`, `| parent | ${o.parent.kind === "none" ? "none" : `${o.parent.groupId}:${o.parent.artifactId}:${o.parent.version ?? "?"} (${o.parent.kind}, ${o.parent.status})`} |`));
  out.push(L(`| Java | ${o.java.value ?? "미검출"} (${o.java.status}) |`, `| Java | ${o.java.value ?? "not detected"} (${o.java.status}) |`));
  out.push(L(`| DbType | ${o.database ?? "미설정"} |`, `| DbType | ${o.database ?? "not set"} |`));
  out.push(L(`| 공통컴포넌트 | ${o.components.count}종${o.components.count ? `: ${o.components.ids.slice(0, 12).join(", ")}${o.components.count > 12 ? " …" : ""}` : ""} |`, `| Common components | ${o.components.count}${o.components.count ? `: ${o.components.ids.slice(0, 12).join(", ")}${o.components.count > 12 ? " …" : ""}` : ""} |`));
  out.push(L(`| AI 계층 / 매니페스트 | ${o.aiLayer ? "있음" : "없음"} / ${o.hasManifest ? "있음" : "없음"} |`, `| AI layer / manifest | ${o.aiLayer ? "yes" : "no"} / ${o.hasManifest ? "yes" : "no"} |`));
  out.push(L(`| 스캔 파일 | ${o.filesScanned}개 |`, `| Files scanned | ${o.filesScanned} |`));
  if (r.modules?.length) {
    out.push(``, L(`### 모듈 (${r.modules.length}개 — 등급은 전체 합산)`, `### Modules (${r.modules.length} — grades are aggregated over all)`), ``, L(`| 모듈 | 빌드 | 의존성 | 기준 미만 | 전환·교체 | 최신 유지 자동/수동 | 보안약점 |`, `| Module | Build | Dependencies | Below baseline | Migrate/replace | Keep-current auto/manual | Security weaknesses |`), `|---|---|---|---|---|---|---|`);
    for (const m of r.modules) out.push(`| ${m.dir || m.name} | ${m.buildTool} | ${m.dependencies} | ${m.outdated} | ${m.legacyReplace} | ${m.updateAuto}/${m.updateManual} | ${m.secure} |`);
  }

  const m = r.migration;
  out.push(``, L(`## 2. 전환 범위`, `## 2. Migration scope`), ``);
  if (m.items === 0) out.push(L(`전환 항목 없음 — 5.x 기준을 이미 만족합니다.`, `No migration items — the project already meets the 5.x baseline.`));
  else {
    out.push(L(`- 항목 ${m.items}건 = 자동 치환 ${m.auto} + 수동 ${m.manual} · 대상 파일 ${m.files}개`, `- Items ${m.items} = auto-rewrite ${m.auto} + manual ${m.manual} · ${m.files} files affected`));
    out.push(L(`- 재조립 권고 공통컴포넌트 ${m.reassemble.length}종${m.reassemble.length ? `: ${m.reassemble.slice(0, 12).join(", ")}${m.reassemble.length > 12 ? " …" : ""}` : ""}`, `- Common components recommended for reassembly ${m.reassemble.length}${m.reassemble.length ? `: ${m.reassemble.slice(0, 12).join(", ")}${m.reassemble.length > 12 ? " …" : ""}` : ""}`));
    out.push(L(`- 제거된 API 참조 ${m.removedApiRefs}건 (${REMOVED_API_KINDS.map(kindLabel).join(" · ")})`, `- Removed API references ${m.removedApiRefs} (${REMOVED_API_KINDS.map(kindLabel).join(" · ")})`));
    for (const n of m.notes) out.push(`- ${n}`);
    out.push(``, L(`| 종류 | 건수 | 처리 |`, `| Kind | Count | Handling |`), `|---|---|---|`);
    for (const [k, n] of Object.entries(m.byKind).sort((a, b) => b[1] - a[1])) out.push(`| ${kindLabel(k)} | ${n} | ${m.manualByKind[k] ? (m.manualByKind[k] === n ? L("수동", "manual") : L(`수동 ${m.manualByKind[k]} · 자동 ${n - m.manualByKind[k]}`, `manual ${m.manualByKind[k]} · auto ${n - m.manualByKind[k]}`)) : L("자동 치환 가능", "auto-rewritable")} |`);
    if (m.manualTop.length) {
      out.push(``, L(`### 예상 수동 작업 (상위 ${m.manualTop.length} / ${m.manualTotalGroups}묶음)`, `### Expected manual work (top ${m.manualTop.length} of ${m.manualTotalGroups} groups)`), ``, L(`| 종류 | 대상 | 건수 | 파일 | 대체 | 예 |`, `| Kind | Target | Count | Files | Replacement | Example |`), `|---|---|---|---|---|---|`);
      for (const t of m.manualTop) out.push(`| ${kindLabel(t.kind)} | \`${t.from}\` | ${t.count} | ${t.files} | ${t.to ? `\`${t.to}\`` : L("(대체 없음)", "(no replacement)")} | ${t.example} |`);
    }
  }

  const d = r.dependencies;
  const s = d.summary;
  if (m.update) {
    const u = m.update;
    out.push(``, L(`### 5.x 최신 유지 (\`migrate_egovframe_project(target="${u.to}")\`)`, `### 5.x keep-current (\`migrate_egovframe_project(target="${u.to}")\`)`), ``);
    if (u.auto === 0 && u.manual === 0) out.push(L(`- RTE ${u.from ?? "미검출"}${u.parentVersion ? ` · parent ${u.parentVersion}` : ""} — ${u.to} 기준을 만족합니다.`, `- RTE ${u.from ?? "not detected"}${u.parentVersion ? ` · parent ${u.parentVersion}` : ""} — meets the ${u.to} baseline.`));
    else {
      out.push(L(`- RTE ${u.from ?? "미검출"}${u.parentVersion ? ` · parent ${u.parentVersion}` : ""} → ${u.to}: 자동 갱신 ${u.auto} · 확인할 항목 ${u.manual}`, `- RTE ${u.from ?? "not detected"}${u.parentVersion ? ` · parent ${u.parentVersion}` : ""} → ${u.to}: auto-update ${u.auto} · items to review ${u.manual}`));
      for (const c of u.changes) out.push(L(`- [${c.since} ${c.kind === "api" ? "API" : "동작"}] ${tr(c, "summary")} — 참조 파일 ${c.files}개`, `- [${c.since} ${c.kind === "api" ? "API" : "behavior"}] ${tr(c, "summary")} — ${c.files} referencing files`));
      if (u.components?.tool) out.push(L(`- 공통컴포넌트 ${u.components.detected}종 → \`${u.components.tool}\` 로 ${u.components.catalogTag} 기준 맞춤`, `- Common components ${u.components.detected} → align to ${u.components.catalogTag} with \`${u.components.tool}\``));
    }
  }
  out.push(``, L(`## 3. 의존성`, `## 3. Dependencies`), ``);
  out.push(L(`- 의존성 ${d.findings}건(선언 ${d.declared}${d.transitive ? ` + 전이 ${d.transitive}` : ""}): 기준 충족 ${s.ok} · 기준 미만 ${s.outdated} · parent 관리 ${s.managed} · 전환 대상 ${s.legacy} · 교체 필요 ${s.replace} · 벤더 배포 ${s.vendor} · 기준 없음 ${s.unknown} · 버전 없음 ${s.unversioned}`, `- Dependencies ${d.findings} (declared ${d.declared}${d.transitive ? ` + transitive ${d.transitive}` : ""}): meets baseline ${s.ok} · below baseline ${s.outdated} · managed by parent ${s.managed} · migration target ${s.legacy} · needs replacement ${s.replace} · vendor ${s.vendor} · no baseline ${s.unknown} · unversioned ${s.unversioned}`));
  if (d.resolution) out.push(d.resolution.success ? L(`- 해석된 트리(${d.resolution.scope}): artifact ${d.resolution.artifacts}종 = 직접 ${d.resolution.direct} + 전이 ${d.resolution.artifacts - d.resolution.direct} · 선언과 다르게 해석 ${d.resolution.differs}건`, `- Resolved tree (${d.resolution.scope}): ${d.resolution.artifacts} artifacts = direct ${d.resolution.direct} + transitive ${d.resolution.artifacts - d.resolution.direct} · resolved differently from declaration ${d.resolution.differs}`) : L(`- 해석된 트리: 실패 (${d.resolution.error ?? "원인 미상"}) — 선언만 판정`, `- Resolved tree: failed (${d.resolution.error ?? "unknown cause"}) — declared only`));
  out.push(L(`- 알려진 취약점: ${d.vulnerabilities.queried ? `${d.vulnerabilities.dependencies}개 의존성 · ${d.vulnerabilities.ids}건 (OSV)` : d.osvError ? `조회 실패 — ${d.osvError}` : "미조회(offline=true)"}`, `- Known vulnerabilities: ${d.vulnerabilities.queried ? `${d.vulnerabilities.dependencies} dependencies · ${d.vulnerabilities.ids} advisories (OSV)` : d.osvError ? `query failed — ${d.osvError}` : "not queried (offline=true)"}`));
  for (const n of d.notes) out.push(`- ${n}`);
  if (d.actions.length) {
    out.push(``, L(`### 조치 목록 (${d.actions.length})`, `### Action list (${d.actions.length})`), ``, L(`| 좌표 | 현재 | 상태 | 조치 | 위치 |`, `| Coordinate | Current | Status | Action | Location |`), `|---|---|---|---|---|`);
    for (const a of d.actions) out.push(`| ${a.groupId}:${a.artifactId} | ${a.version ?? "-"} | ${STATUS_LABEL[a.status]} | ${a.action} | ${a.origin === "transitive" ? L("(전이)", "(transitive)") : `${a.file}:${a.line}`} |`);
  }
  if (d.vulnerabilities.items.length) {
    out.push(``, L(`### 알려진 취약점 (${d.vulnerabilities.items.length})`, `### Known vulnerabilities (${d.vulnerabilities.items.length})`), ``);
    for (const v of d.vulnerabilities.items) out.push(`- ${v.dependency}:${v.version} — ${v.ids.slice(0, 6).join(", ")}${v.ids.length > 6 ? L(` 외 ${v.ids.length - 6}건`, ` and ${v.ids.length - 6} more`) : ""}`);
  }
  if (d.vendor.length) out.push(``, L(`벤더·기관 배포(기준 없음, 등급 미반영) ${d.vendor.length}건: ${d.vendor.join(", ")}`, `Vendor/agency distributed (no baseline, not graded) ${d.vendor.length}: ${d.vendor.join(", ")}`));
  if (d.unknown.length) out.push(``, L(`기준 없음(판단 보류, 등급 미반영) ${d.unknown.length}건: ${d.unknown.join(", ")}`, `No baseline (no verdict, not graded) ${d.unknown.length}: ${d.unknown.join(", ")}`));

  out.push(``, L(`## 4. 보안 설정 점검`, `## 4. Security configuration checks`), ``, L(`- 충족 ${r.security.ok} · 누락 ${r.security.missing} · 해당 없음 ${r.security.na}`, `- ok ${r.security.ok} · missing ${r.security.missing} · n/a ${r.security.na}`), ``);
  for (const c of r.security.checks) {
    const mark = c.status === "ok" ? "✅" : c.status === "missing" ? "⚠️" : "➖";
    out.push(`- ${mark} ${c.title}: ${c.status}${c.hint ? ` — ${c.hint}` : ""}`);
    for (const e of c.evidence.slice(0, 2)) out.push(`  - ${e.file}${e.line ? `:${e.line}` : ""} \`${e.text}\``);
  }

  const sc = r.secureCoding;
  out.push(``, L(`### 보안약점 패턴 (개발보안 가이드 구현단계, \`check_egovframe_secure_coding\`)`, `### Security weakness patterns (Secure Coding Guide implementation phase, \`check_egovframe_secure_coding\`)`), ``);
  if (sc.error) out.push(L(`- 점검 실패: ${sc.error}`, `- Check failed: ${sc.error}`));
  else {
    out.push(L(`- 높음 ${sc.high} · 중간 ${sc.medium} · 낮음 ${sc.low} (합계 ${sc.total}${sc.suppressed ? ` · 예외 처리 ${sc.suppressed}` : ""})${Object.keys(sc.byOrigin).length ? ` — 출처 ${Object.entries(sc.byOrigin).map(([k, n]) => `${SECURE_ORIGIN_KO[k] ?? k} ${n}`).join(" · ")}` : ""}`, `- High ${sc.high} · medium ${sc.medium} · low ${sc.low} (total ${sc.total}${sc.suppressed ? ` · suppressed ${sc.suppressed}` : ""})${Object.keys(sc.byOrigin).length ? ` — origin ${Object.entries(sc.byOrigin).map(([k, n]) => `${SECURE_ORIGIN_KO[k] ?? k} ${n}`).join(" · ")}` : ""}`));
    for (const b of sc.byRule.slice(0, 6)) out.push(L(`  - ${b.guideItem} \`${b.rule}\` ${b.count}건`, `  - ${b.guideItem} \`${b.rule}\` ${b.count}`));
    out.push(L(`- 등급 산식에는 넣지 않습니다(패턴 기반 진단 보조). 파일·라인·조치는 check_egovframe_secure_coding, CI 는 SARIF 로.`, `- Not part of the grade formula (pattern-based diagnostic aid). File/line/remediation via check_egovframe_secure_coding; SARIF for CI.`));
  }

  out.push(``, `## 5. SBOM`, ``, `- ${r.sbom.present ? `✅ ${r.sbom.path}: ${r.sbom.note}${r.sbom.vulnerabilities ? L(` · vulnerabilities ${r.sbom.vulnerabilities}건`, ` · vulnerabilities ${r.sbom.vulnerabilities}`) : ""}` : `➖ ${r.sbom.note}`}`);
  if (r.sbom.minimum) out.push(L(`- 최소 요소 7종: ${r.sbom.minimum.verdict === "ready" ? "✅ 제출 가능" : `⚠️ 보완 필요(${r.sbom.minimum.missing.join("·")})`} — 상세는 \`check_egovframe_sbom\``, `- Minimum elements (7): ${r.sbom.minimum.verdict === "ready" ? "✅ ready to submit" : `⚠️ needs work (${r.sbom.minimum.missing.join("·")})`} — details via \`check_egovframe_sbom\``));
  if (r.sbom.vex) out.push(L(`- VEX: ${r.sbom.vex.present ? `${r.sbom.vex.path} · 항목 ${r.sbom.vex.vulnerabilities ?? 0}건(${Object.entries(r.sbom.vex.states ?? {}).map(([k, n]) => `${k} ${n}`).join(" · ") || "없음"})${r.sbom.vex.timestamp ? ` · 마지막 점검 ${r.sbom.vex.timestamp}` : ""}` : `없음 — check_egovframe_sbom(vex=true) 로 취약점별 판단 기록(${r.sbom.vex.path})을 시작할 수 있습니다`}`, `- VEX: ${r.sbom.vex.present ? `${r.sbom.vex.path} · ${r.sbom.vex.vulnerabilities ?? 0} entries (${Object.entries(r.sbom.vex.states ?? {}).map(([k, n]) => `${k} ${n}`).join(" · ") || "none"})${r.sbom.vex.timestamp ? ` · last checked ${r.sbom.vex.timestamp}` : ""}` : `none — check_egovframe_sbom(vex=true) can start a per-vulnerability analysis record (${r.sbom.vex.path})`}`));

  out.push(``, L(`## 6. 등급과 근거`, `## 6. Grades and evidence`), ``);
  renderGrade(out, L("전환 난이도", "Migration difficulty"), r.grades.migration);
  renderGrade(out, L("공급망 상태", "Supply-chain status"), r.grades.supplyChain);
  if (r.rehearsal) out.push(L(`**실측(리허설 ${r.rehearsal.at})**: 재조립·전환 적용 후 컴파일 오류 ${r.rehearsal.afterAutomation ?? "—"}건 → pom 맞춤 후 ${r.rehearsal.afterPomAlignment ?? "—"}건${r.rehearsal.origin ? ` · 원본 태그 ${r.rehearsal.origin}` : ""} — 등급 산식과 별개로 rehearse_egovframe_migration 이 프로젝트 사본에서 잰 값입니다.`, `**Measured (rehearsal ${r.rehearsal.at})**: compile errors after reassembly and migration ${r.rehearsal.afterAutomation ?? "—"} → after pom alignment ${r.rehearsal.afterPomAlignment ?? "—"}${r.rehearsal.origin ? ` · origin tag ${r.rehearsal.origin}` : ""} — measured by rehearse_egovframe_migration on a copy of the project, independent of the grade formula.`), ``);
  else out.push(L(`실측 없음 — \`rehearse_egovframe_migration\` 으로 프로젝트 사본에서 자동 단계 후 남는 컴파일 오류를 잴 수 있습니다.`, `No measurement — \`rehearse_egovframe_migration\` can measure the compile errors remaining after the automated steps on a copy of the project.`), ``);
  renderFormula(out, MIGRATION_RUBRIC);
  renderFormula(out, SUPPLY_CHAIN_RUBRIC);
  out.push(L(`벤더 배포·기준 없음·버전 없음 의존성과 공통컴포넌트 수 자체는 등급에 넣지 않습니다. 비용·공수는 산정하지 않습니다 — 건수와 등급까지가 이 평가서의 범위입니다.`, `Vendor, no-baseline and unversioned dependencies and the number of common components are not graded. Cost and effort are not estimated — counts and grades are the scope of this assessment.`));
  out.push(``, `---`, L(`읽기 전용 분석입니다. 리허설은 \`rehearse_egovframe_migration\`, 재조립은 \`reassemble_egovframe_components\`(전환 적용보다 먼저), 자동 항목은 \`migrate_egovframe_project\`(apply), SBOM 은 \`generate_egovframe_sbom\` 으로 진행합니다.`, `This is a read-only analysis. Rehearse with \`rehearse_egovframe_migration\`, reassemble with \`reassemble_egovframe_components\` (before applying the migration), apply automatic items with \`migrate_egovframe_project\` (apply), and generate the SBOM with \`generate_egovframe_sbom\`.`));
  return out.join("\n");
}
