// 취약 의존성 자동 조치 (fix_egovframe_dependencies, v1.9.0)
//   check_egovframe_dependencies 가 찾기만 하던 것을 규칙으로 정할 수 있는 만큼 고친다. 순서대로 같은 메모리 사본에 적용한다.
//   1) parent 상향: 공식 parent 5.x 를 target(기본: 권장 버전)으로 — migrate_egovframe_project(target) 의 자동 항목(planPomUpdate) 그대로
//   2) 고정 해제: parent(또는 Boot parent 가 상속한 Boot BOM)가 관리하는 좌표에 그보다 낮은 버전을 직접 적은 것 → <version> 을 지워 parent 에 맡김
//      (프로젝트의 dependencyManagement 항목이면 그 항목을 지움 — dependencyManagement 에는 버전이 있어야 하므로)
//   3) 좌표 교체: 전환 규칙의 교체 대상 중 좌표만 바뀌고 Java 패키지가 같은 것(mysql-connector-java·ojdbc·xbean)만 자동
//   4) 취약 버전 상향: 직접 적은 버전(리터럴 또는 같은 계열 좌표만 쓰는 버전 속성)이 OSV 에 걸리면 범위의 fixed 중
//      모든 권고를 피하는 가장 낮은 버전으로 — major 가 바뀌면 수동(API 변경 가능), 수정 버전이 없으면 수동
//   parent 가 관리하는 버전(버전을 적지 않은 좌표)·전이 의존성의 취약점은 계열 버전이 엇갈릴 수 있어 고치지 않고 보고한다.
//   적용(dryRun=false)은 pom.xml(·build.gradle)만 원문 오프셋 편집, 파일 트랜잭션·백업(migration-backup/<시각>-deps-fix-…/)이고
//   기본으로 compile 을 돌려 실패하면 전부 되돌린다. 전·후 취약점 수는 선언 좌표(버전 없는 좌표는 parent 기준 버전)로 센다.
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { diagnoseProject } from "./diagnose.js";
import { withFileTransaction, TransactionError } from "./file-transaction.js";
import { detectBuildToolAt, failureSummary, runBuild, type Runner } from "./build-runner.js";
import type { FailureKind } from "./maven-resilience.js";
import { loadDependencyBaseline, isEgovRebuild, osvVersion, type DependencyBaseline } from "./dependencies.js";
import { applyTextEdits, lineAt, parsePomDeps, parsePomProperties, resolveProp, walkProjectFiles, type ApplyFilePlan, type PomDep, type TextEdit } from "./migrate.js";
import { planPomUpdate, loadUpdateRules, recommendedVersion } from "./update.js";
import { bundleOsvDetails, compareMavenVersions, inOsvRange } from "./offline-bundle.js";
import { DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "./shared.js";
import { throwIfAborted, type Progress } from "./progress.js";
import { L } from "./lang.js";

export const DEPS_FIX_KINDS = ["parent", "unpin", "coordinate", "cve-bump"] as const;
export type DepsFixKind = (typeof DEPS_FIX_KINDS)[number];

/** 좌표만 바뀌고 Java 패키지가 같은 교체(전환 규칙 libraries 중) — 이 밖의 교체는 패키지·API 가 바뀌어 수동 */
export const COORDINATE_SWAPS: { from: { groupId: string; artifactId: string }; to: { groupId: string; artifactId: string }; note: string; note_en: string }[] = [
  { from: { groupId: "mysql", artifactId: "mysql-connector-java" }, to: { groupId: "com.mysql", artifactId: "mysql-connector-j" }, note: "8.0.31 부터 좌표만 바뀜(패키지 com.mysql.cj 동일)", note_en: "Only the coordinate changed in 8.0.31 (package com.mysql.cj unchanged)" },
  { from: { groupId: "ojdbc", artifactId: "ojdbc" }, to: { groupId: "com.oracle.database.jdbc", artifactId: "ojdbc11" }, note: "Maven Central 공식 좌표(패키지 oracle.jdbc 동일, Java 11+)", note_en: "Official Maven Central coordinate (package oracle.jdbc unchanged, Java 11+)" },
  { from: { groupId: "xmlbeans", artifactId: "xbean" }, to: { groupId: "org.apache.xmlbeans", artifactId: "xmlbeans" }, note: "XMLBeans 의 현재 좌표(패키지 org.apache.xmlbeans 동일)", note_en: "Current XMLBeans coordinate (package org.apache.xmlbeans unchanged)" },
];

export interface OsvAdvisory { id: string; ranges: Record<string, string>[][] }
/** 질의(좌표·버전)마다 그 버전에 해당하는 권고와 그 좌표의 범위(ECOSYSTEM events) */
export type OsvDetailsQuery = (queries: { name: string; version: string }[]) => Promise<OsvAdvisory[][]>;

export interface DepsFixAction { kind: DepsFixKind; file: string; line: number; coordinate: string; from: string; to: string | null; reason: string; ids?: string[]; module?: string }
export interface DepsFixManual { kind: DepsFixKind | "managed-vulnerable"; file: string; line: number; coordinate: string; version: string | null; reason: string; ids?: string[] }
export interface VulnCount { coordinates: number; ids: number; declarations: number }
export interface DepsFixResult {
  projectDir: string;
  dryRun: boolean;
  buildSystem: "maven" | "gradle" | "unknown";
  kinds: DepsFixKind[];
  /** parent 상향 목표(상향하지 않으면 null) */
  target: string | null;
  summary: { actions: number; manual: number; files: number; byKind: Record<DepsFixKind, number> };
  actions: DepsFixAction[];
  manual: DepsFixManual[];
  files: ApplyFilePlan[];
  /** 선언 좌표 기준 전·후 취약점(offline 이면 없음). dryRun 이면 after 는 예측 */
  vulnerabilities?: { before: VulnCount; after: VulnCount; predicted: boolean; remaining: { dependency: string; version: string; ids: string[] }[] };
  osvError?: string;
  build?: { ran: boolean; success: boolean | null; command?: string; durationMs?: number; errors: number; timedOut?: boolean; reason?: string; failureKind?: FailureKind; failureHint?: string; attempts?: number; firstErrors?: string[]; logTail?: string };
  /** compile 실패 등으로 적용을 되돌렸으면 true */
  rolledBack?: boolean;
  backupDir?: string;
  planPath?: string;
  notes: string[];
}
export interface DepsFixOptions {
  projectDir: string;
  /** 기본 true — 파일을 쓰지 않음 */
  dryRun?: boolean;
  /** 적용할 조치 종류(기본 전부) */
  kinds?: DepsFixKind[];
  /** parent 상향 목표 5.x(기본: 권장 버전) */
  target?: string;
  /** true 면 OSV 를 조회하지 않음(취약 버전 상향·전후 집계 생략). 기본 false — 오프라인 번들이 있으면 그것을 씀 */
  offline?: boolean;
  /** dryRun=false 일 때 compile 로 확인(기본 true). 실패하면 되돌림 */
  verify?: boolean;
  timeoutMs?: number;
  /** 테스트용 */
  osvDetails?: OsvDetailsQuery;
  /** 테스트용 — 배포 버전 목록(기본: 미러 또는 Maven Central 의 maven-metadata.xml) */
  mavenVersions?: MavenVersionsQuery | null;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  progress?: Progress;
  faultInjection?: "after-files";
}

// ── 순수 함수(테스트 대상) ──────────────────────────────
const cmp = compareMavenVersions;
const majorOf = (v: string): string => v.match(/^\d+/)?.[0] ?? v;
const isPlainVersion = (v: string | null | undefined): v is string => !!v && /^\d/.test(v) && !/[\[\]()$,]/.test(v);

/** 숫자 부분을 뺀 꼬리(-jre·.Final 등) — 같은 꼬리의 릴리스만 고른다 */
export const versionFlavor = (v: string): string => v.replace(/^\d+(?:\.\d+)*/, "");
const PRERELEASE = /(?:^|[.\-])(?:alpha|beta|a|b|rc|cr|m|milestone|snapshot|preview|ea)[.\-]?\d*(?:$|[.\-])/i;

/**
 * 현재 버전에 해당하는 권고를 모두 피하는 가장 낮은 버전을 고른다.
 * 권고마다 현재 버전을 포함한 범위의 fixed 중 가장 낮은 것이 필요 버전이고, 그 최댓값에서 시작해 (현재 버전과 무관했던 권고를 포함해) 다른 권고 범위에 들면 다음 fixed 로 올린다.
 * floor(parent 기준 버전)가 같은 major 이고 더 높으면 그것부터 본다.
 * available(저장소에 실제로 있는 버전)을 주면 그중 같은 꼬리(-jre·.Final)·정식 릴리스이면서 권고 범위에 들지 않는 가장 낮은 것을 고른다 —
 * OSV 의 fixed 문자열이 배포 버전과 다를 수 있다(guava 33.7.2 ↔ 33.7.2-jre, 건너뛴 tomcat 10.1.58).
 */
export function pickFixVersion(current: string, advisories: OsvAdvisory[], floor?: string | null, available?: string[] | null): { status: "fix" | "major" | "no-fix" | "no-release"; version: string | null; unfixed: string[] } {
  const needs: string[] = [];
  const unfixed: string[] = [];
  const contains = (v: string, a: OsvAdvisory) => a.ranges.some((r) => inOsvRange(v, r));
  const nextFix = (v: string, a: OsvAdvisory): string | null => {
    const fixes = a.ranges.filter((r) => inOsvRange(v, r)).flatMap((r) => r.filter((e) => e.fixed !== undefined && cmp(e.fixed, v) > 0).map((e) => e.fixed));
    return fixes.sort(cmp)[0] ?? null;
  };
  for (const a of advisories) { if (!contains(current, a) && a.ranges.length) continue; const f = nextFix(current, a); if (f) needs.push(f); else unfixed.push(a.id); }
  if (!needs.length) return { status: "no-fix", version: null, unfixed };
  let cand = needs.sort(cmp)[needs.length - 1];
  if (floor && isPlainVersion(floor) && majorOf(floor) === majorOf(current) && cmp(floor, cand) > 0) cand = floor;
  for (let i = 0; i < 20; i++) {
    const still = advisories.filter((a) => !unfixed.includes(a.id) && contains(cand, a));
    if (!still.length) break;
    const ups = still.map((a) => nextFix(cand, a)).filter((x): x is string => !!x);
    if (ups.length < still.length) { for (const a of still) if (!nextFix(cand, a)) unfixed.push(a.id); if (!ups.length) break; }
    cand = ups.sort(cmp)[ups.length - 1];
  }
  if (available) {
    const flavor = versionFlavor(current);
    const pre = PRERELEASE.test(flavor);
    const ok = available.filter((v) => /^\d/.test(v) && versionFlavor(v) === flavor && (pre || !PRERELEASE.test(versionFlavor(v))) && majorOf(v) === majorOf(current) && cmp(v, cand) >= 0
      && !advisories.some((a) => !unfixed.includes(a.id) && contains(v, a))).sort(cmp);
    if (!ok.length) return { status: majorOf(cand) === majorOf(current) ? "no-release" : "major", version: cand, unfixed };
    cand = ok[0];
  }
  return { status: majorOf(cand) === majorOf(current) ? "fix" : "major", version: cand, unfixed };
}

/** 공식 parent(kind)가 관리하는 버전 — web: parent 직접 → import BOM(선언 순서), boot: parent 직접 → 상속한 Boot BOM → import BOM */
export function parentManagedVersion(baseline: DependencyBaseline, kind: "web" | "boot", groupId: string, artifactId: string): string | null {
  const key = `${groupId}:${artifactId}`;
  const exact = baseline.managed.find((x) => x.groupId === groupId && x.artifactId === artifactId && x.sources.includes(kind));
  if (exact) return exact.versionBySource?.[kind] ?? exact.version;
  if (kind === "boot" && baseline.boot?.managed[key]) return baseline.boot.managed[key];
  const member = (baseline.bomMembers ?? []).filter((b) => b.sources.includes(kind) && key in b.members).sort((a, b) => (a.order[kind] ?? 99) - (b.order[kind] ?? 99))[0];
  return member ? member.members[key] : null;
}

/** 한 줄 전체가 그 요소뿐이면 줄째로 지우는 편집 범위 */
function elementRemoval(text: string, start: number, end: number): TextEdit {
  const ls = text.lastIndexOf("\n", start - 1) + 1;
  const le = text.indexOf("\n", end);
  const lineEnd = le < 0 ? text.length : le;
  if (/^[ \t]*$/.test(text.slice(ls, start)) && /^[ \t\r]*$/.test(text.slice(end, lineEnd))) return { start: ls, end: le < 0 ? text.length : le + 1, replacement: "" };
  return { start, end, replacement: "" };
}
/** <version> 요소 전체의 범위(vSpan 은 값만) */
function versionElement(text: string, d: PomDep): { start: number; end: number } | null {
  if (!d.vSpan) return null;
  const s = text.lastIndexOf("<version>", d.vSpan.start);
  const e = text.indexOf("</version>", d.vSpan.end);
  return s >= d.block.start && e >= 0 && e < d.block.end ? { start: s, end: e + "</version>".length } : null;
}
/** dependencyManagement 구간들 */
function dmRanges(text: string): { start: number; end: number }[] {
  return [...text.matchAll(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}
const inRanges = (rs: { start: number; end: number }[], at: number) => rs.some((r) => at >= r.start && at < r.end);
const isImportBom = (text: string, d: PomDep) => /<scope>\s*import\s*<\/scope>/.test(text.slice(d.block.start, d.block.end));
/** 계열 확인: 가장 짧은 groupId 와 같거나 그 하위 groupId 만 */
export function sameFamily(groupIds: string[]): boolean {
  const base = [...groupIds].sort((a, b) => a.length - b.length)[0];
  return groupIds.every((g) => g === base || g.startsWith(`${base}.`));
}

// ── OSV ──────────────────────────────────────────────
const OSV_BATCH = "https://api.osv.dev/v1/querybatch";
const OSV_QUERY = "https://api.osv.dev/v1/query";
interface OsvVuln { id: string; withdrawn?: string; affected?: { package?: { name?: string; ecosystem?: string }; ranges?: { type: string; events: Record<string, string>[] }[] }[] }
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`OSV ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
/** 기본 조회: 오프라인 번들 → (없으면) querybatch 로 걸리는 좌표를 고른 뒤 /v1/query 로 범위를 받는다 */
export const defaultOsvDetails: OsvDetailsQuery = async (queries) => {
  const local = bundleOsvDetails(queries);
  if (local) return local;
  const out: OsvAdvisory[][] = queries.map(() => []);
  const hit: number[] = [];
  for (let i = 0; i < queries.length; i += 500) {
    const chunk = queries.slice(i, i + 500);
    const r = await postJson<{ results: { vulns?: { id: string }[] }[] }>(OSV_BATCH, { queries: chunk.map((q) => ({ package: { name: q.name, ecosystem: "Maven" }, version: q.version })) });
    r.results.forEach((x, j) => { if (x.vulns?.length) hit.push(i + j); });
  }
  let next = 0;
  const worker = async () => {
    while (next < hit.length) {
      const i = hit[next++];
      const q = queries[i];
      let token: string | undefined;
      do {
        const r = await postJson<{ vulns?: OsvVuln[]; next_page_token?: string }>(OSV_QUERY, { package: { name: q.name, ecosystem: "Maven" }, version: q.version, ...(token ? { page_token: token } : {}) });
        for (const v of r.vulns ?? []) {
          if (v.withdrawn) continue;
          const ranges = (v.affected ?? []).filter((a) => a.package?.ecosystem === "Maven" && a.package.name === q.name).flatMap((a) => (a.ranges ?? []).filter((x) => x.type === "ECOSYSTEM").map((x) => x.events));
          out[i].push({ id: v.id, ranges });
        }
        token = r.next_page_token;
      } while (token);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, hit.length) }, worker));
  return out;
};

/** name@version → 권고 캐시 */
class OsvCache {
  private m = new Map<string, OsvAdvisory[]>();
  constructor(private q: OsvDetailsQuery) {}
  async load(list: { name: string; version: string }[]): Promise<void> {
    const need = [...new Map(list.filter((x) => !this.m.has(`${x.name}@${x.version}`)).map((x) => [`${x.name}@${x.version}`, x])).values()];
    if (!need.length) return;
    const r = await this.q(need);
    need.forEach((x, i) => this.m.set(`${x.name}@${x.version}`, r[i] ?? []));
  }
  get(name: string, version: string): OsvAdvisory[] { return this.m.get(`${name}@${version}`) ?? []; }
}

/** 좌표의 배포 버전 목록(없거나 못 읽으면 null) */
export type MavenVersionsQuery = (groupId: string, artifactId: string) => Promise<string[] | null>;
/** 기본: 사내 미러(EGOVFRAME_MAVEN_MIRROR) 또는 Maven Central 의 maven-metadata.xml */
export const defaultMavenVersions: MavenVersionsQuery = async (g, a) => {
  const base = (process.env.EGOVFRAME_MAVEN_MIRROR?.trim() || "https://repo1.maven.org/maven2").replace(/\/+$/, "");
  try {
    const res = await fetchWithTimeout(`${base}/${g.replace(/\./g, "/")}/${a}/maven-metadata.xml`, DOWNLOAD_TIMEOUT_MS);
    if (!res.ok) return null;
    const xml = await res.text();
    const vs = [...xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)].map((m) => m[1]);
    return vs.length ? vs : null;
  } catch { return null; }
};
class VersionsCache {
  private m = new Map<string, Promise<string[] | null>>();
  constructor(private q: MavenVersionsQuery | null) {}
  get(g: string, a: string): Promise<string[] | null> {
    if (!this.q) return Promise.resolve(null);
    const k = `${g}:${a}`;
    if (!this.m.has(k)) this.m.set(k, this.q(g, a).catch(() => null));
    return this.m.get(k)!;
  }
  /** 모든 좌표에 공통으로 있는 버전(목록을 못 읽은 좌표는 빼고, 하나도 못 읽으면 null) */
  async common(coords: string[][]): Promise<string[] | null> {
    const lists = (await Promise.all([...new Map(coords.map((c) => [c.join(":"), c])).values()].map(([g, a]) => this.get(g, a)))).filter((x): x is string[] => !!x);
    if (!lists.length) return null;
    return lists.reduce((acc, l) => acc.filter((v) => l.includes(v)));
  }
}

// ── 프로젝트 모델 ──────────────────────────────────────
interface PomModel { rel: string; text: string }
interface ParentRef { kind: "web" | "boot"; version: string }
/** 이 pom 의 공식 parent(자기 것이 아니면 루트 것) */
function officialParent(rel: string, texts: Map<string, string>): ParentRef | null {
  const sources = loadDependencyBaseline().sources;
  const own = (t: string | undefined): ParentRef | null => {
    const p = t?.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
    if (!p) return null;
    const g = p.match(/<groupId>\s*([^<\s]+)/)?.[1], a = p.match(/<artifactId>\s*([^<\s]+)/)?.[1], v = p.match(/<version>\s*([^<\s]+)/)?.[1];
    const s = sources.find((x) => x.groupId === g && x.artifactId === a);
    return s && v && /^5\./.test(v) ? { kind: s.kind, version: v } : null;
  };
  return own(texts.get(rel)) ?? (rel !== "pom.xml" ? own(texts.get("pom.xml")) : null);
}
/** 루트 속성 + 자기 속성 */
function propsOf(rel: string, texts: Map<string, string>): Map<string, string> {
  return new Map([...(rel !== "pom.xml" ? parsePomProperties(texts.get("pom.xml") ?? "") : []), ...parsePomProperties(texts.get(rel) ?? "")]);
}
/** 속성 정의 위치(자기 pom 우선, 없으면 루트) */
function propDefinition(rel: string, name: string, texts: Map<string, string>): { rel: string; start: number; end: number; value: string } | null {
  for (const r of rel === "pom.xml" ? ["pom.xml"] : [rel, "pom.xml"]) {
    const t = texts.get(r);
    const block = t?.match(/<properties>([\s\S]*?)<\/properties>/);
    if (!t || !block) continue;
    const base = (block.index ?? 0) + "<properties>".length;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = block[1].match(new RegExp(`<${esc}>(\\s*)([^<]*?)\\s*</${esc}>`));
    if (m) { const start = base + (m.index ?? 0) + name.length + 2 + m[1].length; return { rel: r, start, end: start + m[2].length, value: m[2] }; }
  }
  return null;
}

interface DeclaredDep { rel: string; dep: PomDep; inDm: boolean; resolved: string | null; parent: ParentRef | null; managed: string | null }
function declared(texts: Map<string, string>): DeclaredDep[] {
  const out: DeclaredDep[] = [];
  for (const [rel, text] of texts) {
    const parent = officialParent(rel, texts);
    const baseline = parent ? loadDependencyBaseline(parent.version) : null;
    const props = propsOf(rel, texts);
    const dms = dmRanges(text);
    for (const d of parsePomDeps(text)) {
      if (isImportBom(text, d)) continue;
      const r = resolveProp(d.version, props);
      out.push({ rel, dep: d, inDm: inRanges(dms, d.block.start), resolved: r && !/\$\{/.test(r) ? r : null, parent, managed: parent && baseline ? parentManagedVersion(baseline, parent.kind, d.groupId, d.artifactId) : null });
    }
  }
  return out;
}
/** 실효 버전: 적은 버전, 없으면 parent 기준 버전 */
const effective = (d: DeclaredDep): string | null => (d.dep.version ? (isPlainVersion(d.resolved) ? d.resolved : null) : d.managed);

async function countVulns(texts: Map<string, string>, cache: OsvCache): Promise<{ count: VulnCount; remaining: { dependency: string; version: string; ids: string[] }[] }> {
  const ds = declared(texts).map((d) => ({ d, v: effective(d) })).filter((x): x is { d: DeclaredDep; v: string } => !!x.v);
  await cache.load(ds.map((x) => ({ name: `${x.d.dep.groupId}:${x.d.dep.artifactId}`, version: osvVersion(x.v) })));
  const coords = new Map<string, string[]>();
  let declarations = 0;
  for (const { d, v } of ds) {
    const ids = cache.get(`${d.dep.groupId}:${d.dep.artifactId}`, osvVersion(v)).map((a) => a.id);
    if (!ids.length) continue;
    declarations++;
    coords.set(`${d.dep.groupId}:${d.dep.artifactId}@${v}`, ids);
  }
  const ids = new Set([...coords.values()].flat());
  return { count: { coordinates: coords.size, ids: ids.size, declarations }, remaining: [...coords].map(([k, v]) => { const at = k.lastIndexOf("@"); return { dependency: k.slice(0, at), version: k.slice(at + 1), ids: v }; }).sort((a, b) => b.ids.length - a.ids.length || a.dependency.localeCompare(b.dependency)) };
}

// ── 단계 ─────────────────────────────────────────────
interface StepOut { edits: Map<string, TextEdit[]>; actions: DepsFixAction[]; manual: DepsFixManual[] }
const newStep = (): StepOut => ({ edits: new Map(), actions: [], manual: [] });
const addEdit = (s: StepOut, rel: string, e: TextEdit) => (s.edits.get(rel) ?? s.edits.set(rel, []).get(rel)!).push(e);
function applyStep(texts: Map<string, string>, s: StepOut, conflicts: string[]): void {
  for (const [rel, edits] of s.edits) {
    const r = applyTextEdits(texts.get(rel)!, edits);
    for (const sk of r.skipped) conflicts.push(`${rel}@${sk.start}`);
    texts.set(rel, r.text);
  }
}

function stepParent(texts: Map<string, string>, target: string): StepOut {
  const s = newStep();
  for (const [rel, text] of texts) {
    const plan = planPomUpdate(rel, text, target);
    for (const it of plan.items) {
      if (it.action !== "auto" || !it.edits?.length || !["parent-version", "rte-version", "parent-property", "duplicate-dependency"].includes(it.kind)) continue;
      for (const e of it.edits) addEdit(s, rel, e);
      // 중복 선언(같은 내용)은 버전과 무관하지만 일부 Maven 이 "must be unique" 로 빌드를 거부해 compile 확인이 깨지므로 함께 지운다
      s.actions.push({ kind: "parent", file: rel, line: it.line, coordinate: it.kind === "parent-version" ? it.from.split(":").slice(0, 2).join(":") : it.from, from: it.from, to: it.to, reason: it.reason });
    }
  }
  return s;
}

async function stepUnpin(texts: Map<string, string>, cache: OsvCache | null): Promise<StepOut> {
  const s = newStep();
  const all = declared(texts);
  // parent 관리 버전에 권고가 있으면 고정을 풀지 않는다 — 풀면 더 취약해질 수 있고, 취약 버전 상향이 고정 버전을 올린다
  if (cache) await cache.load(all.filter((d) => d.dep.version && d.managed).map((d) => ({ name: `${d.dep.groupId}:${d.dep.artifactId}`, version: osvVersion(d.managed!) })));
  for (const d of all) {
    const { dep, rel } = d;
    if (!dep.version || !d.parent || !d.managed || !isPlainVersion(d.resolved) || isEgovRebuild(d.resolved) || cmp(d.resolved, d.managed) >= 0) continue;
    const text = texts.get(rel)!;
    if (/<(classifier|type)>/.test(text.slice(dep.block.start, dep.block.end))) continue; // 관리 키(type·classifier)가 다를 수 있음
    const coord = `${dep.groupId}:${dep.artifactId}`;
    const prop = dep.version.match(/^\$\{([\w.\-]+)\}$/)?.[1];
    if (cache && cache.get(`${dep.groupId}:${dep.artifactId}`, osvVersion(d.managed)).length) continue;
    if (majorOf(d.resolved) !== majorOf(d.managed)) { s.manual.push({ kind: "unpin", file: rel, line: dep.line, coordinate: coord, version: d.resolved, reason: L(`parent ${d.parent.version} 이 관리하는 ${d.managed} 와 major 가 달라(${d.resolved}) 고정을 의도했을 수 있음 — 호환성을 확인하고 <version> 을 지우세요`, `parent ${d.parent.version} manages ${d.managed}, a different major from ${d.resolved}, so the pin may be intentional — check compatibility and remove <version>`) }); continue; }
    const why = L(`parent ${d.parent.version} 이 ${d.managed} 로 관리하는데 ${d.resolved}${prop ? `(\${${prop}})` : ""} 로 낮게 고정`, `parent ${d.parent.version} manages ${d.managed} but it is pinned lower to ${d.resolved}${prop ? ` (\${${prop}})` : ""}`);
    if (d.inDm) {
      addEdit(s, rel, elementRemoval(text, dep.block.start, dep.block.end));
      s.actions.push({ kind: "unpin", file: rel, line: dep.line, coordinate: coord, from: d.resolved, to: d.managed, reason: L(`${why} — dependencyManagement 항목을 지워 parent 에 맡김`, `${why} — removed the dependencyManagement entry so the parent manages it`) });
    } else {
      const el = versionElement(text, dep);
      if (!el) continue;
      addEdit(s, rel, elementRemoval(text, el.start, el.end));
      s.actions.push({ kind: "unpin", file: rel, line: dep.line, coordinate: coord, from: d.resolved, to: d.managed, reason: L(`${why} — <version> 을 지워 parent 에 맡김`, `${why} — removed <version> so the parent manages it`) });
    }
  }
  return s;
}

function stepCoordinate(texts: Map<string, string>): StepOut {
  const s = newStep();
  for (const d of declared(texts)) {
    const { dep, rel } = d;
    const sw = COORDINATE_SWAPS.find((x) => x.from.groupId === dep.groupId && x.from.artifactId === dep.artifactId);
    if (!sw) continue;
    const text = texts.get(rel)!;
    const to = `${sw.to.groupId}:${sw.to.artifactId}`;
    const already = parsePomDeps(text).some((o) => o.groupId === sw.to.groupId && o.artifactId === sw.to.artifactId);
    if (already) { s.manual.push({ kind: "coordinate", file: rel, line: dep.line, coordinate: `${dep.groupId}:${dep.artifactId}`, version: d.resolved, reason: L(`${to} 도 이미 선언돼 있음 — 옛 좌표를 지우세요`, `${to} is already declared — remove the old coordinate`) }); continue; }
    const baseline = loadDependencyBaseline(d.parent?.version);
    const managed = d.parent ? parentManagedVersion(baseline, d.parent.kind, sw.to.groupId, sw.to.artifactId) : null;
    const known = managed ?? baseline.managed.find((x) => x.groupId === sw.to.groupId && x.artifactId === sw.to.artifactId)?.version ?? baseline.boot?.managed[to] ?? null;
    if (managed && isPlainVersion(d.resolved) && majorOf(d.resolved) !== majorOf(managed)) { s.manual.push({ kind: "coordinate", file: rel, line: dep.line, coordinate: `${dep.groupId}:${dep.artifactId}`, version: d.resolved, reason: L(`${to} 로 바꾸면 parent 관리 버전 ${managed} 로 major 가 바뀜 — 호환성을 확인하고 교체하세요`, `Switching to ${to} moves to the parent-managed ${managed}, a different major — check compatibility and replace it`) }); continue; }
    if (!managed && !known) { s.manual.push({ kind: "coordinate", file: rel, line: dep.line, coordinate: `${dep.groupId}:${dep.artifactId}`, version: d.resolved, reason: L(`${to} 의 기준 버전이 없음 — 버전을 정해 교체하세요`, `No baseline version for ${to} — choose a version and replace it`) }); continue; }
    addEdit(s, rel, { start: dep.gSpan.start, end: dep.gSpan.end, replacement: sw.to.groupId });
    addEdit(s, rel, { start: dep.aSpan.start, end: dep.aSpan.end, replacement: sw.to.artifactId });
    const el = versionElement(text, dep);
    if (managed && el && !d.inDm) addEdit(s, rel, elementRemoval(text, el.start, el.end));
    else if (dep.vSpan) addEdit(s, rel, { start: dep.vSpan.start, end: dep.vSpan.end, replacement: managed ?? known! });
    s.actions.push({ kind: "coordinate", file: rel, line: dep.line, coordinate: `${dep.groupId}:${dep.artifactId}`, from: `${dep.groupId}:${dep.artifactId}:${d.resolved ?? dep.version ?? ""}`.replace(/:$/, ""), to: `${to}${managed && !d.inDm ? L(" (parent 관리)", " (managed by parent)") : `:${managed ?? known}`}`, reason: L(sw.note, sw.note_en) });
  }
  return s;
}

async function stepCveBump(texts: Map<string, string>, cache: OsvCache, versions: VersionsCache): Promise<StepOut> {
  const s = newStep();
  const all = declared(texts);
  const explicit = all.filter((d) => d.dep.version && isPlainVersion(d.resolved));
  await cache.load(explicit.map((d) => ({ name: `${d.dep.groupId}:${d.dep.artifactId}`, version: osvVersion(d.resolved!) })));
  // 버전 출처(리터럴 위치 또는 속성 정의)별로 묶는다
  const groups = new Map<string, { def: { rel: string; start: number; end: number; value: string; prop?: string }; users: DeclaredDep[] }>();
  for (const d of explicit) {
    const prop = d.dep.version!.match(/^\$\{([\w.\-]+)\}$/)?.[1];
    if (prop) {
      const def = propDefinition(d.rel, prop, texts);
      if (!def || !isPlainVersion(def.value)) continue;
      const k = `${def.rel}#${prop}`;
      (groups.get(k) ?? groups.set(k, { def: { ...def, prop }, users: [] }).get(k)!).users.push(d);
    } else if (d.dep.vSpan && d.dep.version === d.resolved) {
      groups.set(`${d.rel}@${d.dep.vSpan.start}`, { def: { rel: d.rel, start: d.dep.vSpan.start, end: d.dep.vSpan.end, value: d.resolved! }, users: [d] });
    }
  }
  for (const { def, users } of groups.values()) {
    const name = (d: DeclaredDep) => `${d.dep.groupId}:${d.dep.artifactId}`;
    const vulnerable = users.filter((u) => cache.get(name(u), osvVersion(def.value)).length);
    if (!vulnerable.length) continue;
    const ids = [...new Set(vulnerable.flatMap((u) => cache.get(name(u), osvVersion(def.value)).map((a) => a.id)))].sort();
    const first = vulnerable[0];
    const manual = (reason: string) => { for (const u of vulnerable) s.manual.push({ kind: "cve-bump", file: u.rel, line: u.dep.line, coordinate: name(u), version: def.value, reason, ids: cache.get(name(u), osvVersion(def.value)).map((a) => a.id) }); };
    if (isEgovRebuild(def.value)) { manual(L("표준프레임워크 재빌드 좌표 — 패치 반영 여부는 공급자 확인", "eGovFrame rebuild coordinate — confirm the patch status with the supplier")); continue; }
    if (def.prop) {
      const famOk = sameFamily(users.map((u) => u.dep.groupId));
      // 속성이 의존성 버전 말고 다른 곳(플러그인 등)에도 쓰이면 건드리지 않는다
      const scope = [...texts.keys()].filter((r) => r === def.rel || (def.rel === "pom.xml" && propDefinition(r, def.prop!, texts)?.rel === "pom.xml"));
      const refs = scope.reduce((n, r) => n + (texts.get(r)!.split(`\${${def.prop}}`).length - 1), 0);
      if (!famOk || refs !== users.length) { manual(L(`버전 속성 \${${def.prop}} 이 다른 계열 좌표·설정에도 쓰임(${[...new Set(users.map((u) => u.dep.groupId))].join(", ")}) — 이 좌표용 속성을 따로 두고 올리세요`, `Version property \${${def.prop}} is shared with other coordinates or settings (${[...new Set(users.map((u) => u.dep.groupId))].join(", ")}) — give this coordinate its own property and raise it`)); continue; }
    }
    // 모든 사용 좌표의 권고를 피하는 버전, 그 버전으로 다시 조회해 새 권고가 있으면 한 번 더(최대 3회)
    let advisories = vulnerable.flatMap((u) => cache.get(name(u), osvVersion(def.value)));
    const floor = users.map((u) => u.managed).filter((x): x is string => !!x).sort(cmp).pop() ?? null;
    const available = await versions.common(users.map((u) => [u.dep.groupId, u.dep.artifactId]));
    let pick = pickFixVersion(osvVersion(def.value), advisories, floor, available);
    for (let round = 0; round < 3 && pick.status === "fix" && pick.version; round++) {
      await cache.load(users.map((u) => ({ name: name(u), version: pick.version! })));
      const extra = users.flatMap((u) => cache.get(name(u), pick.version!)).filter((a) => !advisories.some((b) => b.id === a.id));
      if (!extra.length) break;
      advisories = [...advisories, ...extra];
      pick = pickFixVersion(osvVersion(def.value), advisories, floor, available);
    }
    if (pick.status === "no-release") { manual(L(`권고를 피하는 같은 major 정식 릴리스를 저장소에서 찾지 못함(필요: ${pick.version} 이상) — 직접 확인`, `No same-major release that avoids the advisories was found in the repository (needs ${pick.version} or later) — verify manually`)); continue; }
    if (pick.status === "no-fix") { manual(L(`수정 버전이 없는 권고(${pick.unfixed.join(", ")}) — 대체 라이브러리 또는 VEX 로 판단`, `Advisories with no fixed version (${pick.unfixed.join(", ")}) — consider an alternative library or a VEX statement`)); continue; }
    if (pick.status === "major") { manual(L(`수정 버전 ${pick.version} 은 major 가 달라 API 가 바뀔 수 있음 — 직접 올리고 확인`, `Fixed version ${pick.version} is a different major and may change the API — raise it manually and verify`)); continue; }
    addEdit(s, def.rel, { start: def.start, end: def.end, replacement: pick.version! });
    const partial = pick.unfixed.length ? L(` · 수정 버전 없는 권고 ${pick.unfixed.join(", ")} 는 남음`, ` · advisories without a fix remain: ${pick.unfixed.join(", ")}`) : "";
    const names = [...new Set(users.map(name))].join(", ");
    const where = def.prop ? L(`버전 속성 \${${def.prop}}(${names})`, `version property \${${def.prop}} (${names})`) : L("직접 적은 버전", "explicit version");
    s.actions.push({ kind: "cve-bump", file: def.rel, line: lineAt(texts.get(def.rel)!, def.start), coordinate: def.prop ? `\${${def.prop}}` : name(first), from: def.value, to: pick.version!, reason: L(`${where} — 권고 ${ids.length}건을 피하는 가장 낮은 같은 major 릴리스${available ? "" : "(저장소 목록 미확인)"}${partial}`, `${where} — lowest same-major release that avoids ${ids.length} advisor${ids.length === 1 ? "y" : "ies"}${available ? "" : " (repository listing not checked)"}${partial}`), ids });
  }
  return s;
}

/** parent 관리 버전(버전을 적지 않은 좌표)에 걸린 권고 — 고치지 않고 보고 */
function managedVulnerable(texts: Map<string, string>, cache: OsvCache): DepsFixManual[] {
  const seen = new Set<string>();
  const out: DepsFixManual[] = [];
  for (const d of declared(texts)) {
    if (d.dep.version || !d.managed) continue;
    const coord = `${d.dep.groupId}:${d.dep.artifactId}`;
    const ids = cache.get(coord, osvVersion(d.managed)).map((a) => a.id);
    if (!ids.length || seen.has(`${coord}@${d.managed}`)) continue;
    seen.add(`${coord}@${d.managed}`);
    out.push({ kind: "managed-vulnerable", file: d.rel, line: d.dep.line, coordinate: coord, version: d.managed, ids, reason: L(`parent ${d.parent!.version} 이 관리하는 버전에 권고 ${ids.length}건 — 더 새 parent 로 올리거나, 같은 계열 좌표를 함께 dependencyManagement 로 고정할지 검토`, `${ids.length} advisor${ids.length === 1 ? "y" : "ies"} on the version managed by parent ${d.parent!.version} — raise the parent further, or consider pinning the whole family in dependencyManagement`) });
  }
  return out;
}

// ── Gradle(고정 해제·취약 버전 상향만, 리터럴 'g:a:v') ─────────
async function gradleSteps(rels: string[], texts: Map<string, string>, kinds: DepsFixKind[], cache: OsvCache | null, versions: VersionsCache): Promise<StepOut> {
  const s = newStep();
  const bl = loadDependencyBaseline();
  for (const rel of rels) {
    const text = texts.get(rel)!;
    const bom = text.match(/mavenBom\s*\(?\s*["']org\.egovframe\.boot:egovframe-boot-starter-parent:(5\.[^"']+)["']/)?.[1];
    const baseline = bom ? loadDependencyBaseline(bom) : bl;
    const boot = !!bom || (/org\.springframework\.boot/.test(text) && /io\.spring\.dependency-management/.test(text));
    const lits = [...text.matchAll(/(["'])([\w.\-]+):([\w.\-]+):(\d[^"':\s$]*)\1/g)].filter((m) => !/mavenBom/.test(text.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0)) && !/^(org\.egovframe\.)/.test(m[2]));
    if (cache && kinds.includes("cve-bump")) await cache.load(lits.map((m) => ({ name: `${m[2]}:${m[3]}`, version: osvVersion(m[4]) })));
    for (const m of lits) {
      const [g, a, v] = [m[2], m[3], m[4]];
      const vStart = (m.index ?? 0) + 1 + g.length + 1 + a.length + 1;
      const managed = boot ? parentManagedVersion(baseline, "boot", g, a) : null;
      const line = lineAt(text, m.index ?? 0);
      if (kinds.includes("unpin") && managed && cmp(v, managed) < 0) {
        addEdit(s, rel, { start: vStart - 1, end: vStart + v.length, replacement: "" });
        s.actions.push({ kind: "unpin", file: rel, line, coordinate: `${g}:${a}`, from: v, to: managed, reason: L(`Boot BOM 이 ${managed} 로 관리하는데 ${v} 로 낮게 고정 — 버전을 지워 BOM 에 맡김`, `The Boot BOM manages ${managed} but it is pinned lower to ${v} — removed the version so the BOM manages it`) });
        continue;
      }
      if (!cache || !kinds.includes("cve-bump")) continue;
      let adv = cache.get(`${g}:${a}`, osvVersion(v));
      if (!adv.length) continue;
      const available = await versions.get(g, a);
      let pick = pickFixVersion(osvVersion(v), adv, managed, available);
      if (pick.status === "fix") { await cache.load([{ name: `${g}:${a}`, version: pick.version! }]); const extra = cache.get(`${g}:${a}`, pick.version!); if (extra.length) { adv = [...adv, ...extra.filter((x) => !adv.some((y) => y.id === x.id))]; pick = pickFixVersion(osvVersion(v), adv, managed, available); } }
      const ids = adv.map((x) => x.id);
      if (pick.status !== "fix") { s.manual.push({ kind: "cve-bump", file: rel, line, coordinate: `${g}:${a}`, version: v, ids, reason: pick.status === "major" ? L(`수정 버전 ${pick.version} 은 major 가 다름 — 직접 확인`, `Fixed version ${pick.version} is a different major — verify manually`) : pick.status === "no-release" ? L(`권고를 피하는 같은 major 정식 릴리스를 저장소에서 찾지 못함(${pick.version} 이상)`, `No same-major release avoiding the advisories found in the repository (${pick.version} or later)`) : L("수정 버전이 없는 권고", "Advisories with no fixed version") }); continue; }
      addEdit(s, rel, { start: vStart, end: vStart + v.length, replacement: pick.version! });
      s.actions.push({ kind: "cve-bump", file: rel, line, coordinate: `${g}:${a}`, from: v, to: pick.version!, ids, reason: L(`권고 ${ids.length}건을 피하는 가장 낮은 같은 major 버전`, `Lowest same-major version that avoids ${ids.length} advisor${ids.length === 1 ? "y" : "ies"}`) });
    }
  }
  return s;
}

// ── 진입점 ────────────────────────────────────────────
/** 줄 단위 미리보기 — 같은 줄을 맞춰 가며 지운 줄·바뀐 줄·더한 줄을 보인다(최대 40줄) */
export function previewChanges(before: string, after: string): ApplyFilePlan["preview"] {
  const a = before.split("\n"), b = after.split("\n");
  const out: ApplyFilePlan["preview"] = [];
  let i = 0, j = 0;
  while ((i < a.length || j < b.length) && out.length < 40) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; continue; }
    const del = a.slice(i + 1, i + 8).indexOf(b[j]);
    const ins = b.slice(j + 1, j + 8).indexOf(a[i]);
    if (j >= b.length || (del >= 0 && (ins < 0 || del <= ins))) { for (let k = 0; k <= (j >= b.length ? 0 : del); k++) out.push({ line: i + k + 1, before: (a[i + k] ?? "").trimEnd(), after: "" }); i += j >= b.length ? 1 : del + 1; continue; }
    if (i >= a.length || ins >= 0) { for (let k = 0; k <= (i >= a.length ? 0 : ins); k++) out.push({ line: i + 1, before: "", after: (b[j + k] ?? "").trimEnd() }); j += i >= a.length ? 1 : ins + 1; continue; }
    out.push({ line: i + 1, before: a[i].trimEnd(), after: b[j].trimEnd() }); i++; j++;
  }
  return out;
}

export async function fixDependencies(opts: DepsFixOptions): Promise<DepsFixResult> {
  const dir = path.resolve(opts.projectDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${dir}`, `Project directory not found: ${dir}`));
  const dryRun = opts.dryRun ?? true;
  const kinds = (opts.kinds?.length ? opts.kinds : [...DEPS_FIX_KINDS]).filter((k) => DEPS_FIX_KINDS.includes(k));
  for (const k of opts.kinds ?? []) if (!DEPS_FIX_KINDS.includes(k)) throw new Error(L(`알 수 없는 조치 종류: ${k} (${DEPS_FIX_KINDS.join("·")})`, `Unknown fix kind: ${k} (${DEPS_FIX_KINDS.join(", ")})`));
  const rules = loadUpdateRules();
  const target = opts.target ?? recommendedVersion(rules);
  if (!rules.versions.includes(target)) throw new Error(L(`지원하지 않는 target: ${target} (${rules.versions.join("·")})`, `Unsupported target: ${target} (${rules.versions.join(", ")})`));
  const offline = opts.offline ?? false;
  const notes: string[] = [];
  const diag = diagnoseProject({ projectDir: dir });
  const files = walkProjectFiles(dir, 20_000).map((f) => path.relative(dir, f).split(path.sep).join("/"));
  const poms = files.filter((f) => path.posix.basename(f) === "pom.xml");
  const gradles = files.filter((f) => /(^|\/)build\.gradle(\.kts)?$/.test(f));
  const buildSystem: DepsFixResult["buildSystem"] = poms.length ? "maven" : gradles.length ? "gradle" : "unknown";
  const rels = buildSystem === "maven" ? poms : gradles;
  const original = new Map(rels.map((r) => [r, fs.readFileSync(path.join(dir, r), "utf8")]));
  const texts = new Map(original);
  const cache = offline ? null : new OsvCache(opts.osvDetails ?? defaultOsvDetails);
  // 오프라인 번들(폐쇄망)이면 저장소 목록도 보지 않는다 — 미러가 있으면 미러로
  const versions = new VersionsCache(offline ? null : opts.mavenVersions !== undefined ? opts.mavenVersions : defaultMavenVersions);
  let osvError: string | undefined;
  const actions: DepsFixAction[] = [];
  const manual: DepsFixManual[] = [];
  const conflicts: string[] = [];
  let before: Awaited<ReturnType<typeof countVulns>> | null = null;
  const osv = async <T>(f: () => Promise<T>): Promise<T | null> => { if (!cache || osvError) return null; try { return await f(); } catch (e) { osvError = L(`OSV 조회 실패: ${e instanceof Error ? e.message : String(e)}`, `OSV query failed: ${e instanceof Error ? e.message : String(e)}`); return null; } };
  let usedTarget: string | null = null;

  if (buildSystem === "maven") {
    opts.progress?.report("deps-fix: before", 0, 5);
    before = await osv(() => countVulns(texts, cache!));
    const run = async (kind: DepsFixKind, i: number, f: () => StepOut | Promise<StepOut>) => {
      throwIfAborted(opts.progress?.signal);
      opts.progress?.report(`deps-fix: ${kind}`, i, 5);
      if (!kinds.includes(kind)) return;
      const s = await f();
      applyStep(texts, s, conflicts);
      actions.push(...s.actions); manual.push(...s.manual);
    };
    await run("parent", 1, () => stepParent(texts, target));
    if (actions.some((a) => a.kind === "parent")) usedTarget = target;
    await run("unpin", 2, async () => (await osv(() => stepUnpin(texts, cache))) ?? stepUnpin(texts, null));
    await run("coordinate", 3, () => stepCoordinate(texts));
    if (kinds.includes("cve-bump") && cache) await run("cve-bump", 4, async () => (await osv(() => stepCveBump(texts, cache!, versions))) ?? newStep());
    if (cache && !osvError) await osv(async () => { await cache!.load(declared(texts).filter((d) => !d.dep.version && d.managed).map((d) => ({ name: `${d.dep.groupId}:${d.dep.artifactId}`, version: osvVersion(d.managed!) }))); manual.push(...managedVulnerable(texts, cache!)); });
    if (diag.egovVersion && /^[34]\./.test(diag.egovVersion)) notes.push(L("3.x/4.x 좌표 프로젝트입니다 — 먼저 migrate_egovframe_project(target=\"5.x\") 로 전환하세요. parent 기준 조치는 5.x parent 가 있어야 합니다.", "This project uses 3.x/4.x coordinates — migrate it first with migrate_egovframe_project(target=\"5.x\"). Parent-based fixes need a 5.x parent."));
  } else if (buildSystem === "gradle") {
    before = await osv(() => countVulnsGradle(texts, cache!));
    const s = await gradleSteps(rels, texts, kinds, cache && !osvError ? cache : null, versions);
    applyStep(texts, s, conflicts);
    actions.push(...s.actions); manual.push(...s.manual);
    if (kinds.includes("parent") || kinds.includes("coordinate")) notes.push(L("Gradle 은 고정 해제·취약 버전 상향만 자동입니다 — parent BOM 상향은 migrate_egovframe_project(target), 좌표 교체는 직접 하세요.", "For Gradle only unpinning and vulnerable-version bumps are automatic — raise the parent BOM with migrate_egovframe_project(target) and replace coordinates by hand."));
  } else notes.push(L("빌드 파일(pom.xml·build.gradle)이 없습니다.", "No build file (pom.xml/build.gradle) found."));
  if (offline) notes.push(L("offline=true — 취약 버전 상향과 전·후 집계를 건너뛰었습니다.", "offline=true — vulnerable-version bumps and before/after counts were skipped."));
  if (conflicts.length) notes.push(L(`겹치는 편집 ${conflicts.length}건을 건너뛰었습니다: ${conflicts.slice(0, 5).join(", ")}`, `${conflicts.length} overlapping edit(s) skipped: ${conflicts.slice(0, 5).join(", ")}`));

  const after = before ? await osv(() => (buildSystem === "maven" ? countVulns(texts, cache!) : countVulnsGradle(texts, cache!))) : null;
  const changed = [...texts].filter(([r, t]) => original.get(r) !== t);
  const filePlans: ApplyFilePlan[] = changed.map(([r, t]) => ({ file: r, items: actions.filter((a) => a.file === r).length, edits: actions.filter((a) => a.file === r).length, preview: previewChanges(original.get(r)!, t) }));
  const byKind = Object.fromEntries(DEPS_FIX_KINDS.map((k) => [k, actions.filter((a) => a.kind === k).length])) as Record<DepsFixKind, number>;
  actions.sort((a, b) => DEPS_FIX_KINDS.indexOf(a.kind) - DEPS_FIX_KINDS.indexOf(b.kind) || a.file.localeCompare(b.file) || a.line - b.line);
  manual.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const result: DepsFixResult = {
    projectDir: dir, dryRun, buildSystem, kinds, target: usedTarget,
    summary: { actions: actions.length, manual: manual.length, files: changed.length, byKind },
    actions, manual, files: filePlans,
    ...(before && after ? { vulnerabilities: { before: before.count, after: after.count, predicted: dryRun, remaining: after.remaining.slice(0, 50) } } : {}),
    ...(osvError ? { osvError } : {}),
    notes,
  };
  if (dryRun || !changed.length) {
    if (dryRun && changed.length) notes.push(L("적용하려면 dryRun=false 로 다시 호출하세요. 원본은 migration-backup/ 에 보관하고 compile 이 실패하면 되돌립니다.", "To apply, call again with dryRun=false. Originals are kept in migration-backup/ and the change is rolled back if compile fails."));
    return result;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRel = path.posix.join("migration-backup", `${ts}-deps-fix-${randomUUID()}`);
  const planRel = path.posix.join(backupRel, "deps-fix-plan.json");
  const verify = opts.verify ?? true;
  const st: { build?: DepsFixResult["build"] } = {};
  try {
    await withFileTransaction(dir, L("취약 의존성 조치", "dependency fix"), async (tx) => {
      for (const [rel] of changed) {
        const cur = tx.readFile(rel);
        if (cur === null || cur.toString("utf8") !== original.get(rel)) throw new Error(L(`점검 이후 파일이 바뀌어 적용을 중단합니다: ${rel}`, `File changed since the check; aborting: ${rel}`));
      }
      for (const [rel, t] of changed) { tx.writeFile(path.posix.join(backupRel, rel), original.get(rel)!, { mustNotExist: true }); tx.writeFile(rel, t); }
      const plan = { createdAt: new Date().toISOString(), tool: "fix_egovframe_dependencies", target: usedTarget, summary: result.summary, vulnerabilities: result.vulnerabilities ? { before: result.vulnerabilities.before, after: result.vulnerabilities.after } : null, actions, manual };
      tx.writeFile(planRel, `${JSON.stringify(plan, null, 2)}\n`, { mustNotExist: true });
      if (opts.faultInjection === "after-files") throw new Error("deps-fix fault injection: after-files");
      if (!verify) return;
      if (!detectBuildToolAt(dir)) { st.build = { ran: false, success: null, errors: 0, reason: L("루트에 빌드 파일이 없어 compile 확인을 건너뜀", "No build file at the root; compile check skipped") }; return; }
      opts.progress?.report("deps-fix: compile", 4, 5);
      const b = await runBuild({ projectDir: dir, goal: "compile", timeoutMs: opts.timeoutMs ?? 600_000, runner: opts.runner, platform: opts.platform });
      st.build = { ran: true, success: b.success ?? null, command: b.command, durationMs: b.durationMs, errors: b.errors?.length ?? 0, timedOut: b.timedOut, ...failureSummary(b), ...(!b.success && b.logTail ? { logTail: b.logTail.split("\n").slice(-40).join("\n") } : {}), ...(!b.success && b.errors?.length ? { firstErrors: b.errors.slice(0, 5).map((e) => `${e.file ?? ""}${e.line ? `:${e.line}` : ""} ${e.message}`.trim()) } : {}) };
      if (!b.success) throw new Error("compile failed");
    });
  } catch (e) {
    const build = st.build;
    if (e instanceof TransactionError && build && build.ran && !build.success) {
      notes.push(build.failureKind === "repository-unavailable"
        ? L(`원격 저장소 장애로 compile 을 확인하지 못해 되돌렸습니다 — 잠시 뒤 다시 실행하세요. ${build.failureHint ?? ""}`.trim(), `Rolled back because compile could not be checked (remote repository unavailable) — retry later. ${build.failureHint ?? ""}`.trim())
        : L("compile 이 실패해 모든 조치를 되돌렸습니다 — dryRun 결과의 조치를 kinds 로 나눠 적용하거나 오류를 보고 수동으로 진행하세요.", "Compile failed, so all fixes were rolled back — apply them in smaller sets with kinds, or proceed manually from the errors."));
      return { ...result, build, rolledBack: true };
    }
    throw e;
  }
  return { ...result, ...(st.build ? { build: st.build } : {}), backupDir: path.join(dir, backupRel), planPath: path.join(dir, planRel) };
}

async function countVulnsGradle(texts: Map<string, string>, cache: OsvCache): Promise<{ count: VulnCount; remaining: { dependency: string; version: string; ids: string[] }[] }> {
  const ds: { name: string; v: string }[] = [];
  for (const t of texts.values()) for (const m of t.matchAll(/(["'])([\w.\-]+):([\w.\-]+):(\d[^"':\s$]*)\1/g)) ds.push({ name: `${m[2]}:${m[3]}`, v: m[4] });
  await cache.load(ds.map((d) => ({ name: d.name, version: osvVersion(d.v) })));
  const coords = new Map<string, string[]>();
  let declarations = 0;
  for (const d of ds) { const ids = cache.get(d.name, osvVersion(d.v)).map((a) => a.id); if (ids.length) { declarations++; coords.set(`${d.name}@${d.v}`, ids); } }
  return { count: { coordinates: coords.size, ids: new Set([...coords.values()].flat()).size, declarations }, remaining: [...coords].map(([k, v]) => { const at = k.lastIndexOf("@"); return { dependency: k.slice(0, at), version: k.slice(at + 1), ids: v }; }) };
}

// ── 렌더링 ────────────────────────────────────────────
const KIND_LABEL: Record<string, () => string> = {
  parent: () => L("parent 상향", "parent bump"), unpin: () => L("고정 해제", "unpin"), coordinate: () => L("좌표 교체", "coordinate swap"), "cve-bump": () => L("취약 버전 상향", "vulnerable-version bump"), "managed-vulnerable": () => L("parent 관리 버전 취약", "vulnerable parent-managed version"),
};
export const depsFixKindLabel = (k: string): string => KIND_LABEL[k]?.() ?? k;

export function renderDepsFixMarkdown(r: DepsFixResult, top = 40): string {
  const out: string[] = [];
  out.push(L(`# 취약 의존성 조치 ${r.dryRun ? "계획(dryRun)" : r.rolledBack ? "결과(되돌림)" : "결과"}`, `# Dependency fix ${r.dryRun ? "plan (dryRun)" : r.rolledBack ? "result (rolled back)" : "result"}`), "");
  out.push(L(`- 경로: ${r.projectDir} (${r.buildSystem})`, `- Path: ${r.projectDir} (${r.buildSystem})`));
  out.push(L(`- 조치 ${r.summary.actions}건(${DEPS_FIX_KINDS.map((k) => `${depsFixKindLabel(k)} ${r.summary.byKind[k]}`).join(" · ")}) · 수동 ${r.summary.manual}건 · 파일 ${r.summary.files}개${r.target ? ` · parent → ${r.target}` : ""}`, `- ${r.summary.actions} fix(es) (${DEPS_FIX_KINDS.map((k) => `${depsFixKindLabel(k)} ${r.summary.byKind[k]}`).join(" · ")}) · ${r.summary.manual} manual · ${r.summary.files} file(s)${r.target ? ` · parent → ${r.target}` : ""}`));
  if (r.vulnerabilities) { const { before: b, after: a } = r.vulnerabilities; out.push(L(`- 취약점(선언 좌표 기준${r.vulnerabilities.predicted ? ", 조치 뒤는 예측" : ""}): 좌표 ${b.coordinates} → ${a.coordinates} · 권고 ${b.ids} → ${a.ids} · 선언 ${b.declarations} → ${a.declarations}`, `- Vulnerabilities (declared coordinates${r.vulnerabilities.predicted ? ", after = predicted" : ""}): coordinates ${b.coordinates} → ${a.coordinates} · advisories ${b.ids} → ${a.ids} · declarations ${b.declarations} → ${a.declarations}`)); }
  if (r.osvError) out.push(`- ⚠️ ${r.osvError}`);
  if (r.build) out.push(L(`- compile: ${r.build.ran ? (r.build.success ? "✅ 통과" : `❌ 실패(오류 ${r.build.errors}${r.build.failureKind ? `, ${r.build.failureKind}` : ""})`) : `건너뜀 — ${r.build.reason ?? ""}`}${r.build.command ? ` · ${r.build.command}` : ""}`, `- compile: ${r.build.ran ? (r.build.success ? "✅ passed" : `❌ failed (${r.build.errors} error(s)${r.build.failureKind ? `, ${r.build.failureKind}` : ""})`) : `skipped — ${r.build.reason ?? ""}`}${r.build.command ? ` · ${r.build.command}` : ""}`));
  if (r.backupDir) out.push(L(`- 백업: ${r.backupDir} (원본 + deps-fix-plan.json)`, `- Backup: ${r.backupDir} (originals + deps-fix-plan.json)`));
  for (const n of r.notes) out.push(`- ${n}`);
  if (r.actions.length) {
    out.push("", L(`## 조치 (${r.actions.length}건)`, `## Fixes (${r.actions.length})`), "", L("| 종류 | 위치 | 좌표 | 전 → 후 | 사유 |", "| Kind | Location | Coordinate | Before → After | Reason |"), "|---|---|---|---|---|");
    for (const a of r.actions.slice(0, top)) out.push(`| ${depsFixKindLabel(a.kind)} | ${a.file}:${a.line} | \`${a.coordinate}\` | ${a.from} → ${a.to ?? "-"} | ${a.reason.replace(/\|/g, "\\|")} |`);
    if (r.actions.length > top) out.push(L(`| … | 외 ${r.actions.length - top}건 | | | |`, `| … | ${r.actions.length - top} more | | | |`));
  }
  if (r.manual.length) {
    out.push("", L(`## 수동 (${r.manual.length}건)`, `## Manual (${r.manual.length})`), "");
    for (const m of r.manual.slice(0, top)) out.push(`- [${depsFixKindLabel(m.kind)}] ${m.file}:${m.line} \`${m.coordinate}${m.version ? `:${m.version}` : ""}\` — ${m.reason}${m.ids?.length ? ` (${m.ids.slice(0, 4).join(", ")}${m.ids.length > 4 ? L(` 외 ${m.ids.length - 4}건`, ` +${m.ids.length - 4}`) : ""})` : ""}`);
    if (r.manual.length > top) out.push(L(`- … 외 ${r.manual.length - top}건`, `- … ${r.manual.length - top} more`));
  }
  if (r.vulnerabilities?.remaining.length) {
    out.push("", L(`## 남는 취약 좌표 (${r.vulnerabilities.after.coordinates}개)`, `## Remaining vulnerable coordinates (${r.vulnerabilities.after.coordinates})`), "");
    for (const v of r.vulnerabilities.remaining.slice(0, 15)) out.push(`- ${v.dependency}:${v.version} — ${v.ids.slice(0, 4).join(", ")}${v.ids.length > 4 ? L(` 외 ${v.ids.length - 4}건`, ` +${v.ids.length - 4}`) : ""}`);
  }
  if (r.files.length && r.dryRun) {
    out.push("", L("## 변경 미리보기", "## Change preview"));
    for (const f of r.files.slice(0, 10)) {
      out.push("", `### ${f.file}`, "", "```diff");
      for (const p of f.preview.slice(0, 12)) { if (p.before) out.push(`- ${p.before}`); if (p.after) out.push(`+ ${p.after}`); }
      out.push("```");
    }
  }
  return out.join("\n");
}
