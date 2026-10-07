// SBOM 운영 (check_egovframe_sbom, v0.40) — 이미 있는 CycloneDX SBOM 을 제출물로서 점검한다.
//   (1) 최소 요소 7종(catalog/sbom-rules.json: 공급자·구성요소명·버전·고유식별자·의존관계·작성자·생성 시각) 충족 여부
//   (2) 빌드 도구 없이 purl 만으로 기준 판정(v0.34 분류기)과 OSV 재조회 — 생성 이후 바뀐 판정·새로 알려진 취약점
//   (3) 이전 SBOM(baselinePath)과 비교 — 추가·제거·버전 변경·판정 변화·새 취약점
//   (4) vex=true 면 CycloneDX VEX 초안(sbom/vex.cdx.json) — 새 취약점은 analysis.state=in_triage, 사람이 적은 판단은 보존
//   SBOM 자체는 바꾸지 않는다. VEX 만 transaction 으로 쓴다(dryRun=true 면 미리보기).
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { classifyDependency, defaultOsvQuery, loadDependencyBaseline, type DependencyStatus, type OsvQuery, type ParentInfo } from "./dependencies.js";
import { loadMigrationRules } from "./migrate.js";
import { withFileTransaction } from "./file-transaction.js";
import { CYCLONEDX_SPEC_VERSION, DEFAULT_SBOM_PATH, parentKindOf, resolveOutputPath, type SbomComponent, type SbomDocument } from "./sbom.js";
import { SERVER_VERSION } from "./version.js";

export const DEFAULT_VEX_PATH = "sbom/vex.cdx.json";

// ── 규칙(데이터) ──────────────────────────────────────────
export interface SbomElementRule {
  id: string;
  level: "document" | "component";
  label: string;
  labelEn: string;
  /** 하나라도 비어 있지 않으면 충족(점 경로, `[]` 는 배열 원소 중 하나) */
  fields?: string[];
  /** 주 component(metadata.component)에서 추가로 인정하는 문서 경로 */
  primaryFields?: string[];
  /** 특수 검사: dependency-ref(dependencies[] 에 bom-ref 항목) · timestamp(ISO 날짜) */
  check?: "dependency-ref" | "timestamp";
  hint: string;
}
export interface SbomSupplierEntry { groupIdPrefix: string; name: string; url?: string; basis: string }
export interface SbomRules { schemaVersion: number; surveyedAt: string; sources: { name: string; url?: string }[]; elements: SbomElementRule[]; suppliers: SbomSupplierEntry[] }

const RULES_URL = new URL("../catalog/sbom-rules.json", import.meta.url);
let cachedRules: SbomRules | null = null;
export function loadSbomRules(): SbomRules {
  if (!cachedRules) cachedRules = JSON.parse(fs.readFileSync(RULES_URL, "utf8")) as SbomRules;
  return cachedRules;
}

/** 점 경로 값 목록(`a.b[].c`). 비어 있지 않은 문자열·숫자만 돌려준다. */
export function valuesAt(obj: unknown, dotted: string): string[] {
  let cur: unknown[] = [obj];
  for (const raw of dotted.split(".")) {
    const isArr = raw.endsWith("[]");
    const key = isArr ? raw.slice(0, -2) : raw;
    const next: unknown[] = [];
    for (const o of cur) {
      if (!o || typeof o !== "object") continue;
      const v = (o as Record<string, unknown>)[key];
      if (isArr) { if (Array.isArray(v)) next.push(...v); } else if (v !== undefined && v !== null) next.push(v);
    }
    cur = next;
  }
  return cur.filter((v) => (typeof v === "string" && v.trim() !== "") || typeof v === "number").map(String);
}

// ── purl ─────────────────────────────────────────────────
export interface MavenCoordinate { groupId: string; artifactId: string; version: string | null; type?: string }
/** `pkg:maven/<groupId>/<artifactId>@<version>?type=jar` → 좌표(Maven 이 아니면 null). */
export function parseMavenPurl(purl: string | undefined): MavenCoordinate | null {
  if (!purl) return null;
  const m = purl.match(/^pkg:maven\/([^/@?#]+)\/([^/@?#]+)(?:@([^?#]+))?(?:\?([^#]*))?/);
  if (!m) return null;
  const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  const type = m[4]?.split("&").map((kv) => kv.split("=")).find(([k]) => k === "type")?.[1];
  return { groupId: dec(m[1]), artifactId: dec(m[2]), version: m[3] ? dec(m[3]) : null, ...(type ? { type: dec(type) } : {}) };
}
/** component 의 좌표(purl 우선, 없으면 group·name·version). */
export function coordinateOf(c: SbomComponent): MavenCoordinate | null {
  const p = parseMavenPurl(c.purl);
  if (p) return p;
  if (c.group && c.name) return { groupId: c.group, artifactId: c.name, version: c.version ?? null };
  return null;
}
const keyOf = (c: MavenCoordinate) => `${c.groupId}:${c.artifactId}`;
const labelOf = (c: SbomComponent) => { const k = coordinateOf(c); return k ? `${keyOf(k)}${k.version ? `@${k.version}` : ""}` : (c.name || c["bom-ref"] || "(이름 없음)"); };

/** 공급자 카탈로그에서 groupId 에 맞는 항목(가장 긴 접두어). */
export function supplierFor(groupId: string, rules: SbomRules = loadSbomRules()): SbomSupplierEntry | null {
  return rules.suppliers.filter((s) => groupId === s.groupIdPrefix || groupId.startsWith(`${s.groupIdPrefix}.`)).sort((a, b) => b.groupIdPrefix.length - a.groupIdPrefix.length)[0] ?? null;
}

// ── (1) 최소 요소 ─────────────────────────────────────────
export interface MinimumElementResult {
  id: string; label: string; labelEn: string; level: "document" | "component";
  satisfied: number; total: number; ok: boolean;
  /** 빠진 component(최대 20) 또는 문서 요소면 ["metadata"] */
  missing: string[];
  hint: string;
}
export interface MinimumElementsReport {
  verdict: "ready" | "needs-work";
  elements: MinimumElementResult[];
  /** 요소가 하나라도 빠진 component 수(주 component 포함) */
  componentsWithGaps: number;
  /** 점검한 component 수(주 component 포함) */
  components: number;
  /** 카탈로그로 채운 공급자 수(egovframe:supplierBasis=catalog) */
  supplierFromCatalog: number;
}

/** 최소 요소 점검(순수 함수). 주 component(metadata.component)도 component 로 센다. */
export function checkMinimumElements(bom: SbomDocument, rules: SbomRules = loadSbomRules()): MinimumElementsReport {
  const primary = bom.metadata?.component;
  const comps: { c: SbomComponent; primary: boolean }[] = [...(primary ? [{ c: primary, primary: true }] : []), ...(bom.components ?? []).map((c) => ({ c, primary: false }))];
  const depRefs = new Set((bom.dependencies ?? []).map((d) => d.ref));
  const gaps = new Set<number>();
  const elements: MinimumElementResult[] = [];
  for (const r of rules.elements) {
    if (r.level === "document") {
      let ok: boolean;
      if (r.check === "timestamp") { const v = valuesAt(bom, "metadata.timestamp")[0]; ok = !!v && !Number.isNaN(Date.parse(v)); }
      else ok = (r.fields ?? []).some((f) => valuesAt(bom, f).length > 0);
      elements.push({ id: r.id, label: r.label, labelEn: r.labelEn, level: r.level, satisfied: ok ? 1 : 0, total: 1, ok, missing: ok ? [] : ["metadata"], hint: r.hint });
      continue;
    }
    const missing: string[] = [];
    let satisfied = 0;
    comps.forEach(({ c, primary: isPrimary }, i) => {
      let ok: boolean;
      if (r.check === "dependency-ref") ok = !!c["bom-ref"] && depRefs.has(c["bom-ref"]);
      else ok = (r.fields ?? []).some((f) => valuesAt(c, f).length > 0) || (isPrimary && (r.primaryFields ?? []).some((f) => valuesAt(bom, f).length > 0));
      if (ok) satisfied++; else { gaps.add(i); missing.push(`${isPrimary ? "(주) " : ""}${labelOf(c)}`); }
    });
    elements.push({ id: r.id, label: r.label, labelEn: r.labelEn, level: r.level, satisfied, total: comps.length, ok: satisfied === comps.length, missing: missing.slice(0, 20), hint: r.hint });
  }
  const supplierFromCatalog = comps.filter(({ c }) => (c.properties ?? []).some((p) => p.name === "egovframe:supplierBasis" && p.value === "catalog")).length;
  return { verdict: elements.every((e) => e.ok) ? "ready" : "needs-work", elements, componentsWithGaps: gaps.size, components: comps.length, supplierFromCatalog };
}

// ── (2) 재판정·OSV ────────────────────────────────────────
export interface RecheckResult {
  /** 판정 대상(Maven 좌표가 있는 component) */
  components: number;
  summary: Record<DependencyStatus, number>;
  /** SBOM 의 egovframe:status 와 지금 판정이 다른 component */
  changed: { component: string; from: string; to: DependencyStatus; baseline: string | null }[];
  /** egovframe:status 가 없던 component 수(enrich=false 로 만든 SBOM 등) */
  unrecorded: number;
  osv: {
    queried: boolean;
    /** SBOM 에 vulnerabilities[] 가 있었는지(없으면 offline 생성 — newIds 는 "기록되지 않은 것") */
    recorded: boolean;
    error?: string;
    /** 지금 OSV 가 알려 주는 취약점 ID 수 */
    ids: number;
    /** SBOM 의 vulnerabilities[] 에 없던 ID — 생성 이후 새로 알려진 것 */
    newIds: string[];
    /** SBOM 에는 있지만 지금 조회에 나오지 않는 ID(철회·범위 수정 등) */
    goneIds: string[];
    items: { component: string; ref: string; ids: string[] }[];
  };
}

const emptyStatuses = (): Record<DependencyStatus, number> => ({ ok: 0, outdated: 0, managed: 0, legacy: 0, replace: 0, vendor: 0, unknown: 0, unversioned: 0 });
const propOf = (c: SbomComponent, name: string) => (c.properties ?? []).find((p) => p.name === name)?.value;

/** purl 만으로 기준 판정·OSV 를 다시 한다(빌드 도구 불필요). */
export async function recheckSbom(bom: SbomDocument, opts: { parentKind?: ParentInfo["kind"]; offline?: boolean; osvQuery?: OsvQuery } = {}): Promise<RecheckResult> {
  const baseline = loadDependencyBaseline();
  const rules = loadMigrationRules();
  const summary = emptyStatuses();
  const changed: RecheckResult["changed"] = [];
  let unrecorded = 0;
  const targets: { c: SbomComponent; k: MavenCoordinate }[] = [];
  for (const c of bom.components ?? []) {
    const k = coordinateOf(c);
    if (!k || !k.version) continue;
    targets.push({ c, k });
    const r = classifyDependency({ groupId: k.groupId, artifactId: k.artifactId, version: k.version, resolvedVersion: k.version }, { baseline, rules, parentKind: opts.parentKind ?? "none" });
    summary[r.status]++;
    const before = propOf(c, "egovframe:status");
    if (before === undefined) unrecorded++;
    else if (before !== r.status) changed.push({ component: labelOf(c), from: before, to: r.status, baseline: r.baseline });
  }
  const recorded = new Set((bom.vulnerabilities ?? []).map((v) => v.id));
  const osv: RecheckResult["osv"] = { queried: false, recorded: Array.isArray(bom.vulnerabilities), ids: 0, newIds: [], goneIds: [], items: [] };
  if (opts.offline === false) {
    const query = opts.osvQuery ?? defaultOsvQuery;
    try {
      const found = new Set<string>();
      for (let i = 0; i < targets.length; i += 100) {
        const chunk = targets.slice(i, i + 100);
        const res = await query(chunk.map(({ k }) => ({ package: { name: keyOf(k), ecosystem: "Maven" as const }, version: k.version! })));
        res.results.forEach((r, j) => {
          const ids = [...new Set((r.vulns ?? []).map((v) => v.id))].sort();
          if (!ids.length) return;
          ids.forEach((id) => found.add(id));
          osv.items.push({ component: labelOf(chunk[j].c), ref: chunk[j].c["bom-ref"] ?? labelOf(chunk[j].c), ids });
        });
      }
      osv.queried = true;
      osv.ids = found.size;
      osv.newIds = [...found].filter((id) => !recorded.has(id)).sort();
      osv.goneIds = [...recorded].filter((id) => !found.has(id)).sort();
    } catch (e) {
      osv.error = `OSV 조회 실패: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { components: targets.length, summary, changed, unrecorded, osv };
}

// ── (3) 비교 ─────────────────────────────────────────────
export interface SbomDiff {
  baselinePath: string;
  baselineTimestamp: string | null;
  added: { component: string; version: string | null }[];
  removed: { component: string; version: string | null }[];
  versionChanged: { component: string; from: string; to: string }[];
  statusChanged: { component: string; from: string; to: string }[];
  /** 지금 SBOM(또는 재조회)에 있고 이전 SBOM 에 없던 취약점 */
  newVulnerabilities: { id: string; components: string[] }[];
  /** 이전 SBOM 에 있고 지금은 없는 취약점 */
  resolvedVulnerabilities: string[];
  unchanged: number;
}

function indexComponents(bom: SbomDocument): Map<string, { versions: string[]; status?: string }> {
  const out = new Map<string, { versions: string[]; status?: string }>();
  for (const c of bom.components ?? []) {
    const k = coordinateOf(c);
    const key = k ? keyOf(k) : c.name;
    if (!key) continue;
    const e = out.get(key) ?? { versions: [] };
    const v = k?.version ?? c.version;
    if (v && !e.versions.includes(v)) e.versions.push(v);
    e.status ??= propOf(c, "egovframe:status");
    out.set(key, e);
  }
  for (const e of out.values()) e.versions.sort();
  return out;
}
/** 취약점 ID → 영향 component 라벨 */
function vulnMap(bom: SbomDocument, extra?: RecheckResult["osv"]): Map<string, Set<string>> {
  const byRef = new Map((bom.components ?? []).map((c) => [c["bom-ref"], c] as const));
  const out = new Map<string, Set<string>>();
  const add = (id: string, label: string) => { if (!out.has(id)) out.set(id, new Set()); out.get(id)!.add(label); };
  for (const v of bom.vulnerabilities ?? []) for (const a of v.affects ?? []) { const c = byRef.get(a.ref); add(v.id, c ? labelOf(c) : a.ref); }
  if (extra?.queried) for (const it of extra.items) for (const id of it.ids) add(id, it.component);
  return out;
}

/** 두 SBOM 의 component·취약점 차이(순수 함수). current 쪽 취약점에는 재조회 결과를 합칠 수 있다. */
export function diffSboms(current: SbomDocument, baseline: SbomDocument, baselinePath: string, currentOsv?: RecheckResult["osv"]): SbomDiff {
  const a = indexComponents(baseline), b = indexComponents(current);
  const added: SbomDiff["added"] = [], removed: SbomDiff["removed"] = [], versionChanged: SbomDiff["versionChanged"] = [], statusChanged: SbomDiff["statusChanged"] = [];
  let unchanged = 0;
  for (const [key, cur] of b) {
    const prev = a.get(key);
    if (!prev) { added.push({ component: key, version: cur.versions.join(",") || null }); continue; }
    const pv = prev.versions.join(","), cv = cur.versions.join(",");
    if (pv !== cv) versionChanged.push({ component: key, from: pv || "(없음)", to: cv || "(없음)" });
    if (prev.status && cur.status && prev.status !== cur.status) statusChanged.push({ component: key, from: prev.status, to: cur.status });
    if (pv === cv && (!prev.status || !cur.status || prev.status === cur.status)) unchanged++;
  }
  for (const [key, prev] of a) if (!b.has(key)) removed.push({ component: key, version: prev.versions.join(",") || null });
  const va = vulnMap(baseline), vb = vulnMap(current, currentOsv);
  const newVulnerabilities = [...vb.entries()].filter(([id]) => !va.has(id)).map(([id, cs]) => ({ id, components: [...cs].sort() })).sort((x, y) => x.id.localeCompare(y.id));
  const resolvedVulnerabilities = [...va.keys()].filter((id) => !vb.has(id)).sort();
  const sortBy = <T extends { component: string }>(xs: T[]) => xs.sort((x, y) => x.component.localeCompare(y.component));
  return { baselinePath, baselineTimestamp: baseline.metadata?.timestamp ?? null, added: sortBy(added), removed: sortBy(removed), versionChanged: sortBy(versionChanged), statusChanged: sortBy(statusChanged), newVulnerabilities, resolvedVulnerabilities, unchanged };
}

// ── (4) VEX ──────────────────────────────────────────────
export type VexState = "resolved" | "resolved_with_pedigree" | "exploitable" | "in_triage" | "false_positive" | "not_affected";
export interface VexVulnerability {
  id: string;
  "bom-ref"?: string;
  source?: { name: string; url?: string };
  analysis?: { state?: VexState; justification?: string; response?: string[]; detail?: string; firstIssued?: string; lastUpdated?: string; [k: string]: unknown };
  affects: { ref: string }[];
  [k: string]: unknown;
}
export interface VexDocument { bomFormat: "CycloneDX"; specVersion: string; serialNumber: string; version: number; metadata: { timestamp: string; tools?: unknown; [k: string]: unknown }; vulnerabilities: VexVulnerability[]; [k: string]: unknown }

/** BOM-Link(urn:cdx:<serial>/<version>#<bom-ref>) — serialNumber 가 urn:uuid 가 아니면 null. */
export function bomLink(bom: SbomDocument, ref: string): string | null {
  const m = (bom.serialNumber ?? "").match(/^urn:uuid:([0-9a-fA-F-]{36})$/);
  return m ? `urn:cdx:${m[1].toLowerCase()}/${bom.version ?? 1}#${encodeURIComponent(ref)}` : null;
}

export interface VexMergeResult { doc: VexDocument; created: boolean; added: number; extended: number; preserved: number; notDetected: string[]; states: Record<string, number>; usedBomLink: boolean }

/**
 * 탐지된 취약점(id → 영향 bom-ref)으로 VEX 를 만들거나 기존 VEX 에 합친다(순수 함수).
 * - 기존 항목의 analysis(사람의 판단)는 절대 바꾸지 않는다.
 * - 같은 ID 에 새 영향 component 가 생기면: 기존 항목이 in_triage 면 affects 에 덧붙이고, 판단이 끝난 항목이면 같은 ID 의 새 in_triage 항목을 따로 만든다.
 * - 더 이상 탐지되지 않는 ID 는 지우지 않고 notDetected 로 알린다.
 */
export function mergeVex(bom: SbomDocument, detected: Map<string, Set<string>>, existing: VexDocument | null, now: () => number = Date.now): VexMergeResult {
  const ts = new Date(now()).toISOString();
  const link = (ref: string) => bomLink(bom, ref) ?? ref;
  const usedBomLink = bomLink(bom, "x") !== null;
  const doc: VexDocument = existing
    ? { ...existing, version: (existing.version ?? 1) + 1, metadata: { ...existing.metadata, timestamp: ts }, vulnerabilities: [...(existing.vulnerabilities ?? [])] }
    : { bomFormat: "CycloneDX", specVersion: CYCLONEDX_SPEC_VERSION, serialNumber: `urn:uuid:${randomUUID()}`, version: 1, metadata: { timestamp: ts, tools: { components: [{ type: "application", name: "egovframe-scaffold-mcp", version: SERVER_VERSION }] } }, vulnerabilities: [] };
  let added = 0, extended = 0;
  const preserved = doc.vulnerabilities.length;
  for (const [id, refs] of [...detected.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const wanted = [...refs].sort().map(link);
    const entries = doc.vulnerabilities.filter((v) => v.id === id);
    const covered = new Set(entries.flatMap((v) => (v.affects ?? []).map((a) => a.ref)));
    const fresh = wanted.filter((r) => !covered.has(r));
    if (!fresh.length) continue;
    const triage = entries.find((v) => (v.analysis?.state ?? "in_triage") === "in_triage");
    if (triage) { triage.affects = [...(triage.affects ?? []), ...fresh.map((ref) => ({ ref }))]; extended++; continue; }
    const n = entries.length;
    doc.vulnerabilities.push({
      id, "bom-ref": `vex:${id}${n ? `:${n + 1}` : ""}`,
      source: { name: "OSV", url: `https://osv.dev/vulnerability/${id}` },
      analysis: { state: "in_triage", detail: "egovframe-scaffold-mcp 가 탐지해 추가한 초안 — 영향 여부(not_affected·exploitable 등)와 근거는 담당자가 채웁니다.", firstIssued: ts },
      affects: fresh.map((ref) => ({ ref })),
    });
    added++;
  }
  const notDetected = [...new Set(doc.vulnerabilities.map((v) => v.id))].filter((id) => !detected.has(id)).sort();
  const states: Record<string, number> = {};
  for (const v of doc.vulnerabilities) { const s = v.analysis?.state ?? "in_triage"; states[s] = (states[s] ?? 0) + 1; }
  return { doc, created: !existing, added, extended, preserved, notDetected, states, usedBomLink };
}

// ── 도구 ─────────────────────────────────────────────────
export interface CheckSbomOptions {
  projectDir: string;
  sbomPath?: string;
  baselinePath?: string;
  /** false 면 OSV 재조회(기본 true = 조회 안 함) */
  offline?: boolean;
  /** VEX 초안 작성·갱신 */
  vex?: boolean;
  vexPath?: string;
  /** vex=true 일 때 쓰지 않고 미리보기 */
  dryRun?: boolean;
  osvQuery?: OsvQuery;
  now?: () => number;
}
export interface CheckSbomResult {
  projectDir: string;
  sbomPath: string;
  absolutePath: string;
  document: { specVersion: string; serialNumber: string | null; version: number; timestamp: string | null; components: number; tools: string[]; vulnerabilities: number };
  minimum: MinimumElementsReport;
  recheck: RecheckResult;
  diff?: SbomDiff;
  vex?: { path: string; dryRun: boolean; written: boolean; created: boolean; added: number; extended: number; preserved: number; notDetected: string[]; states: Record<string, number>; usedBomLink: boolean; vulnerabilities: number };
  notes: string[];
}

function readBom(projectDir: string, rel: string, what: string): { relPath: string; absolutePath: string; bom: SbomDocument } {
  const { relPath, absolutePath } = resolveOutputPath(projectDir, rel);
  if (!fs.existsSync(absolutePath)) throw new Error(`${what} 이 없습니다: ${relPath}${what === "SBOM" ? " — generate_egovframe_sbom(dryRun=false) 으로 먼저 만드세요." : ""}`);
  let bom: SbomDocument;
  try { bom = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as SbomDocument; } catch (e) { throw new Error(`${what}(${relPath}) JSON 해석 실패: ${e instanceof Error ? e.message : String(e)}`); }
  if (bom.bomFormat !== "CycloneDX") throw new Error(`${what}(${relPath}) 이 CycloneDX 문서가 아닙니다(bomFormat=${String(bom.bomFormat)}). SPDX 는 지원하지 않습니다.`);
  return { relPath, absolutePath, bom };
}
const toolNames = (bom: SbomDocument): string[] => {
  const t = bom.metadata?.tools as { components?: { name?: string; version?: string }[] } | { name?: string; version?: string }[] | undefined;
  const list = Array.isArray(t) ? t : t?.components ?? [];
  return list.map((x) => `${x.name ?? "?"}${x.version ? ` ${x.version}` : ""}`);
};

/** SBOM 을 점검한다. SBOM 은 바꾸지 않고, vex=true(dryRun=false)일 때만 VEX 파일을 쓴다. */
export async function checkSbom(opts: CheckSbomOptions): Promise<CheckSbomResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const { relPath, absolutePath, bom } = readBom(projectDir, opts.sbomPath ?? DEFAULT_SBOM_PATH, "SBOM");
  const notes: string[] = [];
  const minimum = checkMinimumElements(bom);
  const parentKind = fs.existsSync(path.join(projectDir, "pom.xml")) ? parentKindOf(projectDir, "maven") : "none";
  const recheck = await recheckSbom(bom, { parentKind, offline: opts.offline ?? true, osvQuery: opts.osvQuery });
  if (opts.offline !== false) notes.push("offline — OSV 재조회 안 함(offline=false 로 생성 이후 새로 알려진 취약점 확인)");
  if (recheck.unrecorded) notes.push(`egovframe:status 가 없는 component ${recheck.unrecorded}종 — 판정 변화 비교에서 제외(enrich=false 로 만든 SBOM 이거나 다른 생성기 출력)`);

  let diff: SbomDiff | undefined;
  if (opts.baselinePath) {
    const base = readBom(projectDir, opts.baselinePath, "이전 SBOM");
    if (base.absolutePath === absolutePath) notes.push("baselinePath 가 sbomPath 와 같아 차이가 없습니다.");
    diff = diffSboms(bom, base.bom, base.relPath, recheck.osv);
  }

  let vex: CheckSbomResult["vex"];
  if (opts.vex) {
    const { relPath: vexRel, absolutePath: vexAbs } = resolveOutputPath(projectDir, opts.vexPath ?? DEFAULT_VEX_PATH);
    if (vexAbs === absolutePath) throw new Error("vexPath 가 sbomPath 와 같습니다 — VEX 는 별도 파일로 둡니다.");
    let existing: VexDocument | null = null;
    if (fs.existsSync(vexAbs)) {
      try { existing = JSON.parse(fs.readFileSync(vexAbs, "utf8")) as VexDocument; } catch (e) { throw new Error(`기존 VEX(${vexRel}) JSON 해석 실패 — 사람이 적은 판단을 잃지 않도록 중단합니다: ${e instanceof Error ? e.message : String(e)}`); }
      if (existing.bomFormat !== "CycloneDX" || !Array.isArray(existing.vulnerabilities)) throw new Error(`기존 ${vexRel} 이 CycloneDX VEX 문서가 아닙니다 — 중단합니다.`);
    }
    // 탐지 집합: SBOM 의 vulnerabilities[] + (조회했다면) OSV 재조회
    const detected = new Map<string, Set<string>>();
    const add = (id: string, ref: string) => { if (!detected.has(id)) detected.set(id, new Set()); detected.get(id)!.add(ref); };
    for (const v of bom.vulnerabilities ?? []) for (const a of v.affects ?? []) add(v.id, a.ref);
    for (const it of recheck.osv.items) for (const id of it.ids) add(id, it.ref);
    const merged = mergeVex(bom, detected, existing, opts.now);
    if (!merged.usedBomLink) notes.push("SBOM 의 serialNumber 가 urn:uuid 형식이 아니어서 VEX affects 에 BOM-Link 대신 bom-ref 를 그대로 적었습니다.");
    const dryRun = opts.dryRun === true;
    const changed = merged.created || merged.added > 0 || merged.extended > 0;
    let written = false;
    if (!dryRun && changed) {
      const json = `${JSON.stringify(merged.doc, null, 2)}\n`;
      await withFileTransaction(projectDir, "VEX 갱신", (tx) => { tx.writeFile(vexRel, json, { mustNotExist: !existing }); });
      written = true;
    } else if (!dryRun && !changed) notes.push(`VEX(${vexRel}) 에 추가할 취약점이 없어 파일을 바꾸지 않았습니다.`);
    vex = { path: vexRel, dryRun, written, created: merged.created, added: merged.added, extended: merged.extended, preserved: merged.preserved, notDetected: merged.notDetected, states: merged.states, usedBomLink: merged.usedBomLink, vulnerabilities: merged.doc.vulnerabilities.length };
  }

  return {
    projectDir, sbomPath: relPath, absolutePath,
    document: { specVersion: bom.specVersion, serialNumber: bom.serialNumber ?? null, version: bom.version ?? 1, timestamp: bom.metadata?.timestamp ?? null, components: (bom.components ?? []).length, tools: toolNames(bom), vulnerabilities: (bom.vulnerabilities ?? []).length },
    minimum, recheck, ...(diff ? { diff } : {}), ...(vex ? { vex } : {}), notes,
  };
}

const STATUS_KO: Record<string, string> = { ok: "기준 충족", outdated: "기준 미만", managed: "parent 관리", legacy: "전환 대상", replace: "교체 필요", vendor: "벤더", unknown: "기준 없음", unversioned: "버전 없음" };

/** 결과 Markdown. */
export function renderSbomCheckMarkdown(r: CheckSbomResult): string {
  const L: string[] = [];
  const d = r.document;
  L.push(`# SBOM 점검 (${r.sbomPath})`, ``);
  L.push(`- CycloneDX ${d.specVersion} · component ${d.components}종 · 생성 ${d.timestamp ?? "(시각 없음)"} · 도구 ${d.tools.join(", ") || "(없음)"}`);
  L.push(`- **최소 요소: ${r.minimum.verdict === "ready" ? "✅ 제출 가능" : "⚠️ 보완 필요"}** — 요소가 빠진 component ${r.minimum.componentsWithGaps}/${r.minimum.components}${r.minimum.supplierFromCatalog ? ` · 공급자 카탈로그 보완 ${r.minimum.supplierFromCatalog}종` : ""}`);
  L.push(``, `## 1. 최소 요소 7종`, ``, `| 요소 | 대상 | 충족 | 빠진 항목(최대 20) |`, `|---|---|---|---|`);
  for (const e of r.minimum.elements) L.push(`| ${e.ok ? "✅" : "⚠️"} ${e.label} | ${e.level === "document" ? "문서" : "component"} | ${e.satisfied}/${e.total} | ${e.missing.length ? e.missing.slice(0, 8).join(", ") + (e.missing.length > 8 ? ` 외 ${e.missing.length - 8}` : "") : "—"} |`);
  const gapsHint = r.minimum.elements.filter((e) => !e.ok);
  if (gapsHint.length) { L.push(``); for (const e of gapsHint) L.push(`- ${e.label}: ${e.hint}`); }

  const rc = r.recheck;
  L.push(``, `## 2. 재점검 (빌드 도구 없이 purl 로)`, ``);
  L.push(`- 기준 판정 ${rc.components}종: ${Object.entries(rc.summary).filter(([, n]) => n).map(([k, n]) => `${STATUS_KO[k] ?? k} ${n}`).join(" · ") || "없음"}`);
  if (rc.changed.length) { L.push(`- 생성 당시와 판정이 달라진 component ${rc.changed.length}종:`); for (const c of rc.changed.slice(0, 15)) L.push(`  - ${c.component}: ${STATUS_KO[c.from] ?? c.from} → ${STATUS_KO[c.to] ?? c.to}${c.baseline ? ` (기준 ${c.baseline})` : ""}`); }
  else L.push(`- 생성 당시와 판정이 달라진 component 없음`);
  if (rc.osv.error) L.push(`- OSV: ${rc.osv.error}`);
  else if (rc.osv.queried) {
    L.push(`- OSV 재조회: 취약점 ${rc.osv.ids}건(영향 component ${rc.osv.items.length}종) · ${rc.osv.recorded ? `**생성 이후 새로 알려진 것 ${rc.osv.newIds.length}건**` : `SBOM 에 취약점 기록이 없어(offline 생성) 전부 미기록 ${rc.osv.newIds.length}건`}${rc.osv.goneIds.length ? ` · SBOM 에 있으나 지금 조회되지 않음 ${rc.osv.goneIds.length}건` : ""}`);
    if (rc.osv.newIds.length) L.push(`  - 새 ID: ${rc.osv.newIds.slice(0, 20).join(", ")}${rc.osv.newIds.length > 20 ? " …" : ""}`);
  } else L.push(`- OSV: 조회 안 함(offline)`);

  if (r.diff) {
    const df = r.diff;
    L.push(``, `## 3. 이전 SBOM 과 비교 (${df.baselinePath}${df.baselineTimestamp ? `, ${df.baselineTimestamp}` : ""})`, ``);
    L.push(`- 추가 ${df.added.length} · 제거 ${df.removed.length} · 버전 변경 ${df.versionChanged.length} · 판정 변화 ${df.statusChanged.length} · 같음 ${df.unchanged} · 새 취약점 ${df.newVulnerabilities.length} · 사라진 취약점 ${df.resolvedVulnerabilities.length}`);
    if (df.added.length) L.push(`- 추가: ${df.added.slice(0, 20).map((x) => `${x.component}@${x.version}`).join(", ")}`);
    if (df.removed.length) L.push(`- 제거: ${df.removed.slice(0, 20).map((x) => `${x.component}@${x.version}`).join(", ")}`);
    for (const x of df.versionChanged.slice(0, 20)) L.push(`- 버전: ${x.component} ${x.from} → ${x.to}`);
    for (const x of df.statusChanged.slice(0, 20)) L.push(`- 판정: ${x.component} ${STATUS_KO[x.from] ?? x.from} → ${STATUS_KO[x.to] ?? x.to}`);
    for (const x of df.newVulnerabilities.slice(0, 20)) L.push(`- 새 취약점 ${x.id}: ${x.components.join(", ")}`);
    if (df.resolvedVulnerabilities.length) L.push(`- 사라진 취약점: ${df.resolvedVulnerabilities.slice(0, 20).join(", ")}`);
  }
  if (r.vex) {
    const v = r.vex;
    L.push(``, `## ${r.diff ? 4 : 3}. VEX (${v.path})`, ``);
    L.push(`- ${v.dryRun ? "미리보기(dryRun — 쓰지 않음)" : v.written ? (v.created ? "새로 만듦" : "갱신") : "변경 없음"} · 항목 ${v.vulnerabilities}건 = 기존 ${v.preserved}(판단 보존) + 새 항목 ${v.added}${v.extended ? ` · 영향 component 추가 ${v.extended}` : ""}`);
    L.push(`- 상태: ${Object.entries(v.states).map(([k, n]) => `${k} ${n}`).join(" · ") || "없음"}${v.notDetected.length ? ` · 지금 탐지되지 않는 ID ${v.notDetected.length}건(지우지 않음): ${v.notDetected.slice(0, 10).join(", ")}` : ""}`);
    L.push(`- \`analysis.state\` 가 \`in_triage\` 인 항목은 담당자가 \`not_affected\`(+justification)·\`exploitable\`·\`resolved\` 등으로 판단을 적습니다. 다음 실행은 적힌 판단을 그대로 두고 새 취약점만 추가합니다.`);
  }
  for (const n of r.notes) L.push(`- ${n}`);
  L.push(``, `---`, `최소 요소는 NTIA 최소 요소 7종(국내 SW 공급망 보안 가이드라인 1.0 의 핵심 구성요소와 같음)을 catalog/sbom-rules.json 데이터로 점검합니다. SBOM 파일은 바꾸지 않습니다.`);
  return L.join("\n");
}
