// 포트폴리오(기관 단위) 현황 (summarize_egovframe_portfolio / CLI portfolio, v1.17.0) — 읽기 전용.
//   여러 프로젝트의 평가서(전환 준비도·공급망·보안약점·운영 준비)를 한 표로 모은다. 새 분석 없이 모으기·비교·표.
//   입력 세 가지(자동 판별): 프로젝트 디렉터리(평가서를 실행) · 납품 패키지(assessment/assessment.json 을 읽기만) · CI 아티팩트(egovframe-assessment.json 또는 egovframe-delivery/).
import * as fs from "node:fs";
import * as path from "node:path";
import { assessProject, type AssessmentResult } from "./assessment.js";
import { throwIfAborted, type Progress } from "./progress.js";
import { L } from "./lang.js";

export type PortfolioSource = "project" | "delivery" | "ci-artifact";
export const GRADE_ORDER = ["A", "B", "C", "D"] as const;
export interface PortfolioRow {
  name: string;
  input: string;
  source: PortfolioSource | null;
  /** 평가 시각(평가서 generatedAt) */
  assessedAt: string | null;
  owner?: string;
  rteVersion: string | null;
  era: string | null;
  buildSystem: string | null;
  migration: string | null;
  supplyChain: string | null;
  operations: string | null;
  manual: number | null;
  vulnerableDependencies: number | null;
  vulnerabilityIds: number | null;
  outdated: number | null;
  secureHigh: number | null;
  secureMedium: number | null;
  components: number | null;
  /** 이전 portfolio 대비(있을 때) */
  change?: { migration?: string; supplyChain?: string; operations?: string; vulnerabilityIds?: number; new?: boolean };
  error?: string;
}
export interface PortfolioOptions {
  /** 프로젝트·납품 패키지·CI 아티팩트 디렉터리(끝이 /* 면 그 아래 디렉터리 전부) */
  inputs: string[];
  /** 프로젝트 디렉터리면 평가서를 실행(기본 true). false 면 기존 산출물만 읽음 */
  run?: boolean;
  /** 평가서 실행 시 OSV 조회 안 함(기본 true) */
  offline?: boolean;
  /** 동시에 평가할 프로젝트 수(기본 2, 최대 8) */
  jobs?: number;
  /** 이전 portfolio.json(비교) */
  previous?: string;
  sort?: "name" | "migration" | "supplyChain" | "operations" | "vulnerabilities";
  /** 필터: 'migration:C'(C 이하), 'supplyChain:D', 'operations:C', 'vulnerabilities>0', 'secure>0', 'era:4.x' — 쉼표로 여러 개(모두 만족) */
  only?: string;
  org?: string;
  /** 프로젝트 → 담당 CSV(name,owner) */
  ownerMap?: string;
  topN?: number;
  progress?: Progress;
  /** 테스트 주입 */
  assess?: (projectDir: string) => Promise<AssessmentResult>;
}
export interface PortfolioResult {
  org: string | null;
  generatedAt: string;
  rows: PortfolioRow[];
  summary: {
    projects: number; failed: number;
    bySource: Record<string, number>;
    era: Record<string, number>;
    migration: Record<string, number>; supplyChain: Record<string, number>; operations: Record<string, number>;
    vulnerableProjects: number; vulnerabilityIds: number; secureHigh: number;
  };
  /** 기관이 먼저 손댈 것 */
  top: {
    vulnerableCoordinates: { dependency: string; projects: number; ids: string[] }[];
    secureRules: { rule: string; guideItem: string; projects: number; findings: number }[];
    operationsRules: { rule: string; title: string; projects: number }[];
  };
  filter: string | null;
  previous: { path: string; generatedAt: string | null; removed: string[] } | null;
  notes: string[];
}

const exists = (p: string) => { try { return fs.existsSync(p); } catch { return false; } };
const readJson = <T>(p: string): T | null => { try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; } catch { return null; } };
/** CLI --json 출력({ assessment }) 이든 평가서 자체든 */
const unwrap = (j: unknown): AssessmentResult | null => { const o = j as Record<string, unknown> | null; if (!o) return null; const a = (o.assessment ?? o) as Record<string, unknown>; return a && typeof a === "object" && "grades" in a && "overview" in a ? (a as unknown as AssessmentResult) : null; };

/** 입력 디렉터리 하나를 판별 — 평가서 JSON 경로 또는 프로젝트 */
export function classifyPortfolioInput(dir: string): { source: PortfolioSource; assessmentJson?: string } | null {
  if (exists(path.join(dir, "delivery-manifest.json"))) return { source: "delivery", assessmentJson: path.join(dir, "assessment", "assessment.json") };
  if (exists(path.join(dir, "egovframe-assessment.json"))) return { source: "ci-artifact", assessmentJson: path.join(dir, "egovframe-assessment.json") };
  if (exists(path.join(dir, "egovframe-delivery", "delivery-manifest.json"))) return { source: "ci-artifact", assessmentJson: path.join(dir, "egovframe-delivery", "assessment", "assessment.json") };
  if (["pom.xml", "build.gradle", "build.gradle.kts"].some((f) => exists(path.join(dir, f)))) return { source: "project" };
  return null;
}
export function expandPortfolioInputs(inputs: string[], cwd = process.cwd()): string[] {
  const out: string[] = [];
  for (const raw of inputs) {
    const p = path.resolve(cwd, raw.replace(/[\\/]\*$/, ""));
    if (/[\\/]\*$/.test(raw)) {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { /* 없는 디렉터리는 아래에서 실패 행 */ }
      for (const e of entries.filter((x) => x.isDirectory() && !x.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name))) out.push(path.join(p, e.name));
    } else out.push(p);
  }
  return [...new Set(out)];
}
function readOwnerMap(file: string): Map<string, string> {
  const m = new Map<string, string>();
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2 || !cells[0] || (i === 0 && /^(name|project|프로젝트)$/i.test(cells[0]))) continue;
    m.set(cells[0], cells[1]);
  }
  return m;
}
export function rowFromAssessment(name: string, input: string, source: PortfolioSource, a: AssessmentResult): PortfolioRow {
  return {
    name, input, source, assessedAt: a.generatedAt ?? null,
    rteVersion: a.overview.rteVersion ?? a.overview.parent?.version ?? null, era: a.overview.sourceEra, buildSystem: a.overview.buildSystem,
    migration: a.grades.migration.grade, supplyChain: a.grades.supplyChain.grade, operations: a.operations && !a.operations.error ? a.operations.grade : null,
    manual: a.migration.manual, vulnerableDependencies: a.dependencies.vulnerabilities.queried ? a.dependencies.vulnerabilities.dependencies : null, vulnerabilityIds: a.dependencies.vulnerabilities.queried ? a.dependencies.vulnerabilities.ids : null,
    outdated: a.dependencies.summary.outdated ?? 0, secureHigh: a.secureCoding.error ? null : a.secureCoding.high, secureMedium: a.secureCoding.error ? null : a.secureCoding.medium,
    components: a.overview.components.count,
  };
}
const emptyRow = (name: string, input: string, source: PortfolioSource | null, error: string): PortfolioRow => ({ name, input, source, assessedAt: null, rteVersion: null, era: null, buildSystem: null, migration: null, supplyChain: null, operations: null, manual: null, vulnerableDependencies: null, vulnerabilityIds: null, outdated: null, secureHigh: null, secureMedium: null, components: null, error });
const gradeIdx = (g: string | null) => (g ? GRADE_ORDER.indexOf(g as (typeof GRADE_ORDER)[number]) : -1);

/** 필터 식 → 술어 */
export function parsePortfolioFilter(expr: string): (r: PortfolioRow) => boolean {
  const preds: ((r: PortfolioRow) => boolean)[] = [];
  for (const raw of expr.split(",").map((x) => x.trim()).filter(Boolean)) {
    let m = raw.match(/^(migration|supplyChain|operations):([ABCD])$/);
    if (m) { const k = m[1] as "migration" | "supplyChain" | "operations", g = gradeIdx(m[2]); preds.push((r) => gradeIdx(r[k]) >= g); continue; }
    m = raw.match(/^(vulnerabilities|secure|manual|outdated)\s*(>=|>)\s*(\d+)$/);
    if (m) { const pick = (r: PortfolioRow) => (m![1] === "vulnerabilities" ? r.vulnerabilityIds : m![1] === "secure" ? r.secureHigh : m![1] === "manual" ? r.manual : r.outdated) ?? 0; const v = Number(m[3]); preds.push(m[2] === ">" ? (r) => pick(r) > v : (r) => pick(r) >= v); continue; }
    m = raw.match(/^era:(3\.x|4\.x|5\.x|unknown)$/);
    if (m) { const e = m[1]; preds.push((r) => r.era === e); continue; }
    if (raw === "failed") { preds.push((r) => !!r.error); continue; }
    throw new Error(L(`only 식을 해석할 수 없습니다: ${raw} (예: migration:C, supplyChain:D, operations:C, vulnerabilities>0, secure>0, era:4.x, failed)`, `Cannot parse the only expression: ${raw} (e.g. migration:C, supplyChain:D, operations:C, vulnerabilities>0, secure>0, era:4.x, failed)`));
  }
  return (r) => preds.every((p) => p(r));
}

export async function summarizePortfolio(opts: PortfolioOptions): Promise<PortfolioResult> {
  throwIfAborted(opts.progress?.signal);
  if (!opts.inputs?.length) throw new Error(L("inputs 가 비어 있습니다 — 프로젝트·납품 패키지·CI 아티팩트 디렉터리를 주세요", "inputs is empty — give project, delivery package or CI artifact directories"));
  const run = opts.run !== false;
  const jobs = Math.min(8, Math.max(1, opts.jobs ?? 2));
  const notes: string[] = [];
  const dirs = expandPortfolioInputs(opts.inputs);
  if (dirs.length > 500) throw new Error(L(`입력이 너무 많습니다(${dirs.length}개, 최대 500)`, `Too many inputs (${dirs.length}, max 500)`));
  const owners = opts.ownerMap ? readOwnerMap(path.resolve(opts.ownerMap)) : null;
  const filter = opts.only ? parsePortfolioFilter(opts.only) : null;
  const assess = opts.assess ?? ((projectDir: string) => assessProject({ projectDir, offline: opts.offline !== false }));
  const nameCount = new Map<string, number>();
  const nameOf = (dir: string) => { const b = path.basename(dir); const n = (nameCount.get(b) ?? 0) + 1; nameCount.set(b, n); return n === 1 ? b : `${b}#${n}`; };
  const named = dirs.map((d) => ({ dir: d, name: nameOf(d) }));
  const rows: PortfolioRow[] = new Array(named.length);
  /** Top N 집계용 — 입력 경로 → 평가서 */
  const assessments = new Map<string, AssessmentResult>();
  let done = 0;
  const work = async (i: number) => {
    const { dir, name } = named[i];
    try {
      if (!exists(dir) || !fs.statSync(dir).isDirectory()) { rows[i] = emptyRow(name, dir, null, L("디렉터리가 없습니다", "Directory not found")); return; }
      const c = classifyPortfolioInput(dir);
      if (!c) { rows[i] = emptyRow(name, dir, null, L("프로젝트·납품 패키지·CI 아티팩트로 보이지 않습니다(pom.xml·delivery-manifest.json·egovframe-assessment.json 없음)", "Not a project, delivery package or CI artifact (no pom.xml, delivery-manifest.json or egovframe-assessment.json)")); return; }
      if (c.source === "project") {
        if (!run) { rows[i] = emptyRow(name, dir, "project", L("run=false — 프로젝트는 평가서를 실행해야 합니다", "run=false — a project needs the assessment to be run")); return; }
        const a = await assess(dir);
        assessments.set(dir, a);
        rows[i] = rowFromAssessment(name, dir, "project", a);
      } else {
        const a = unwrap(readJson(c.assessmentJson!));
        if (a) assessments.set(dir, a);
        rows[i] = a ? rowFromAssessment(name, dir, c.source, a) : emptyRow(name, dir, c.source, L(`평가서 JSON 을 읽지 못했습니다: ${path.relative(dir, c.assessmentJson!) || c.assessmentJson}`, `Could not read the assessment JSON: ${path.relative(dir, c.assessmentJson!) || c.assessmentJson}`));
      }
    } catch (e) {
      rows[i] = emptyRow(name, dir, classifyPortfolioInput(dir)?.source ?? null, e instanceof Error ? e.message.split("\n")[0].slice(0, 300) : String(e));
    } finally {
      done++;
      opts.progress?.report(`portfolio: ${name}`, done, named.length);
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, named.length) }, async () => { while (next < named.length) { throwIfAborted(opts.progress?.signal); const i = next++; await work(i); } }));
  if (owners) for (const r of rows) { const o = owners.get(r.name) ?? owners.get(r.input); if (o) r.owner = o; }

  // 이전 비교
  let previous: PortfolioResult["previous"] = null;
  if (opts.previous) {
    const prev = readJson<PortfolioResult>(path.resolve(opts.previous));
    if (!prev || !Array.isArray(prev.rows)) throw new Error(L(`previous 를 읽지 못했습니다: ${opts.previous}`, `Could not read previous: ${opts.previous}`));
    const byName = new Map(prev.rows.map((r) => [r.name, r] as const));
    for (const r of rows) {
      const p = byName.get(r.name);
      if (!p) { r.change = { new: true }; continue; }
      const ch: NonNullable<PortfolioRow["change"]> = {};
      for (const k of ["migration", "supplyChain", "operations"] as const) if (p[k] && r[k] && p[k] !== r[k]) ch[k] = `${p[k]}→${r[k]}`;
      if (p.vulnerabilityIds !== null && r.vulnerabilityIds !== null && p.vulnerabilityIds !== r.vulnerabilityIds) ch.vulnerabilityIds = r.vulnerabilityIds - p.vulnerabilityIds;
      if (Object.keys(ch).length) r.change = ch;
    }
    previous = { path: path.resolve(opts.previous), generatedAt: prev.generatedAt ?? null, removed: prev.rows.map((r) => r.name).filter((nm) => !rows.some((r) => r.name === nm)) };
  }

  // 집계(필터 전 전체)
  const ok = rows.filter((r) => !r.error);
  const dist = (k: "migration" | "supplyChain" | "operations") => { const d: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 }; for (const r of ok) if (r[k]) d[r[k]!] = (d[r[k]!] ?? 0) + 1; return d; };
  const era: Record<string, number> = {}; for (const r of ok) era[r.era ?? "unknown"] = (era[r.era ?? "unknown"] ?? 0) + 1;
  const bySource: Record<string, number> = {}; for (const r of rows) bySource[r.source ?? "unknown"] = (bySource[r.source ?? "unknown"] ?? 0) + 1;
  // Top N — 행을 만든 평가서에서
  const topN = opts.topN ?? 10;
  const vc = new Map<string, { projects: Set<string>; ids: Set<string> }>(), sr = new Map<string, { guideItem: string; projects: Set<string>; findings: number }>(), orr = new Map<string, { title: string; projects: Set<string> }>();
  for (const r of rows) {
    const a = assessments.get(r.input);
    if (!a) continue;
    for (const v of a.dependencies.vulnerabilities.items ?? []) { const key = v.dependency; const e = vc.get(key) ?? { projects: new Set(), ids: new Set() }; e.projects.add(r.name); for (const id of v.ids ?? []) e.ids.add(id); vc.set(key, e); }
    for (const b of a.secureCoding.byRule ?? []) { const e = sr.get(b.rule) ?? { guideItem: b.guideItem, projects: new Set(), findings: 0 }; e.projects.add(r.name); e.findings += b.count; sr.set(b.rule, e); }
    for (const f of a.operations?.failed ?? []) { const e = orr.get(f.rule) ?? { title: f.title, projects: new Set() }; e.projects.add(r.name); orr.set(f.rule, e); }
  }
  const top: PortfolioResult["top"] = {
    vulnerableCoordinates: [...vc.entries()].map(([dependency, e]) => ({ dependency, projects: e.projects.size, ids: [...e.ids].sort() })).sort((a, b) => b.projects - a.projects || b.ids.length - a.ids.length || a.dependency.localeCompare(b.dependency)).slice(0, topN),
    secureRules: [...sr.entries()].map(([rule, e]) => ({ rule, guideItem: e.guideItem, projects: e.projects.size, findings: e.findings })).sort((a, b) => b.projects - a.projects || b.findings - a.findings || a.rule.localeCompare(b.rule)).slice(0, topN),
    operationsRules: [...orr.entries()].map(([rule, e]) => ({ rule, title: e.title, projects: e.projects.size })).sort((a, b) => b.projects - a.projects || a.rule.localeCompare(b.rule)).slice(0, topN),
  };
  const summary: PortfolioResult["summary"] = {
    projects: rows.length, failed: rows.length - ok.length, bySource, era,
    migration: dist("migration"), supplyChain: dist("supplyChain"), operations: dist("operations"),
    vulnerableProjects: ok.filter((r) => (r.vulnerabilityIds ?? 0) > 0).length, vulnerabilityIds: ok.reduce((s, r) => s + (r.vulnerabilityIds ?? 0), 0), secureHigh: ok.reduce((s, r) => s + (r.secureHigh ?? 0), 0),
  };
  if (ok.some((r) => r.vulnerabilityIds === null)) notes.push(L("OSV 를 조회하지 않은 평가서가 있어 취약점 열이 비어 있습니다 — offline=false 로 평가하거나 offline=false 로 만든 납품 패키지를 쓰세요.", "Some assessments did not query OSV, so the vulnerability columns are empty — assess with offline=false or use delivery packages made with offline=false."));
  if (ok.some((r) => r.operations === null)) notes.push(L("운영 준비 등급이 없는 평가서가 있습니다(v1.15 이전 산출물) — 다시 평가하면 채워집니다.", "Some assessments have no operations grade (made before v1.15) — re-assess to fill it in."));
  // 정렬·필터
  const sort = opts.sort ?? "name";
  const key = (r: PortfolioRow) => sort === "vulnerabilities" ? -(r.vulnerabilityIds ?? -1) : sort === "name" ? 0 : -gradeIdx(r[sort]);
  let out = [...rows].sort((a, b) => (Number(!!a.error) - Number(!!b.error)) || key(a) - key(b) || a.name.localeCompare(b.name));
  if (filter) out = out.filter(filter);
  return { org: opts.org ?? null, generatedAt: new Date().toISOString(), rows: out, summary, top, filter: opts.only ?? null, previous, notes };
}

const cell = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : String(v));
export function renderPortfolioMarkdown(r: PortfolioResult, topN = 10): string {
  const s = r.summary;
  const out: string[] = [];
  out.push(L(`# 전자정부 표준프레임워크 포트폴리오 현황${r.org ? ` — ${r.org}` : ""}`, `# eGovFrame portfolio status${r.org ? ` — ${r.org}` : ""}`), ``);
  out.push(L(`기준 ${r.generatedAt.slice(0, 10)} · 프로젝트 ${s.projects}(실패 ${s.failed}) · 입력 ${Object.entries(s.bySource).map(([k, n]) => `${k} ${n}`).join(" · ")}${r.filter ? ` · 필터 \`${r.filter}\` → ${r.rows.length}행` : ""}`, `As of ${r.generatedAt.slice(0, 10)} · projects ${s.projects} (failed ${s.failed}) · inputs ${Object.entries(s.bySource).map(([k, n]) => `${k} ${n}`).join(" · ")}${r.filter ? ` · filter \`${r.filter}\` → ${r.rows.length} rows` : ""}`), ``);
  const d = (x: Record<string, number>) => GRADE_ORDER.map((g) => `${g} ${x[g] ?? 0}`).join(" · ");
  out.push(L("## 분포", "## Distribution"), ``);
  out.push(L(`- 세대: ${Object.entries(s.era).sort().map(([k, n]) => `${k} ${n}`).join(" · ") || "—"}`, `- Generation: ${Object.entries(s.era).sort().map(([k, n]) => `${k} ${n}`).join(" · ") || "—"}`));
  out.push(L(`- 전환 난이도: ${d(s.migration)}`, `- Migration difficulty: ${d(s.migration)}`), L(`- 공급망 상태: ${d(s.supplyChain)}`, `- Supply chain status: ${d(s.supplyChain)}`), L(`- 운영 준비: ${d(s.operations)}`, `- Operations readiness: ${d(s.operations)}`));
  out.push(L(`- 취약 의존성이 있는 프로젝트 ${s.vulnerableProjects} · 권고 ID 합계 ${s.vulnerabilityIds} · 보안약점 높음 합계 ${s.secureHigh}`, `- Projects with vulnerable dependencies ${s.vulnerableProjects} · advisory IDs in total ${s.vulnerabilityIds} · high-severity weaknesses in total ${s.secureHigh}`), ``);
  const changeCol = !!r.previous;
  out.push(L("## 프로젝트", "## Projects"), ``);
  out.push(L(`| 프로젝트 | 담당 | RTE | 전환 | 공급망 | 운영 | 수동 | 취약 의존성(ID) | 노후 | 보안약점 높음/중간 | 컴포넌트 | 평가일${changeCol ? " | 변화" : ""} |`, `| Project | Owner | RTE | Migration | Supply chain | Ops | Manual | Vulnerable deps (IDs) | Outdated | Weaknesses high/medium | Components | Assessed${changeCol ? " | Change" : ""} |`));
  out.push(`|---|---|---|---|---|---|---|---|---|---|---|---|${changeCol ? "---|" : ""}`);
  for (const x of r.rows) {
    if (x.error) { out.push(`| ${x.name} | ${cell(x.owner)} | ❌ ${x.error.replace(/\|/g, "/")} |||||||||${changeCol ? "|" : ""}`); continue; }
    const ch = x.change ? (x.change.new ? L("신규", "new") : [x.change.migration && L(`전환 ${x.change.migration}`, `migration ${x.change.migration}`), x.change.supplyChain && L(`공급망 ${x.change.supplyChain}`, `supply ${x.change.supplyChain}`), x.change.operations && L(`운영 ${x.change.operations}`, `ops ${x.change.operations}`), x.change.vulnerabilityIds !== undefined && `ID ${x.change.vulnerabilityIds > 0 ? "+" : ""}${x.change.vulnerabilityIds}`].filter(Boolean).join(", ")) : "";
    out.push(`| ${x.name} | ${cell(x.owner)} | ${cell(x.rteVersion)} (${cell(x.era)}) | ${cell(x.migration)} | ${cell(x.supplyChain)} | ${cell(x.operations)} | ${cell(x.manual)} | ${x.vulnerableDependencies === null ? "—" : `${x.vulnerableDependencies}(${x.vulnerabilityIds})`} | ${cell(x.outdated)} | ${x.secureHigh === null ? "—" : `${x.secureHigh}/${x.secureMedium}`} | ${cell(x.components)} | ${x.assessedAt ? x.assessedAt.slice(0, 10) : "—"}${changeCol ? ` | ${ch}` : ""} |`);
  }
  out.push(``);
  if (r.previous?.removed.length) out.push(L(`이전 대비 빠진 프로젝트: ${r.previous.removed.join(", ")}`, `Projects removed since the previous run: ${r.previous.removed.join(", ")}`), ``);
  out.push(L("## 먼저 손댈 것", "## Where to start"), ``);
  if (r.top.vulnerableCoordinates.length) { out.push(L("**여러 프로젝트에 걸친 취약 의존성**", "**Vulnerable dependencies across projects**"), ``); for (const v of r.top.vulnerableCoordinates.slice(0, topN)) out.push(L(`- \`${v.dependency}\` — 프로젝트 ${v.projects} · ${v.ids.slice(0, 4).join(", ")}${v.ids.length > 4 ? " …" : ""}`, `- \`${v.dependency}\` — ${v.projects} projects · ${v.ids.slice(0, 4).join(", ")}${v.ids.length > 4 ? " …" : ""}`)); out.push(``); }
  if (r.top.secureRules.length) { out.push(L("**많은 보안약점 규칙**", "**Most common weakness rules**"), ``); for (const v of r.top.secureRules.slice(0, topN)) out.push(L(`- ${v.guideItem} \`${v.rule}\` — 프로젝트 ${v.projects} · ${v.findings}건`, `- ${v.guideItem} \`${v.rule}\` — ${v.projects} projects · ${v.findings} findings`)); out.push(``); }
  if (r.top.operationsRules.length) { out.push(L("**많은 운영 준비 미달 규칙**", "**Most common operations readiness failures**"), ``); for (const v of r.top.operationsRules.slice(0, topN)) out.push(L(`- ${v.title} \`${v.rule}\` — 프로젝트 ${v.projects}`, `- ${v.title} \`${v.rule}\` — ${v.projects} projects`)); out.push(``); }
  for (const n of r.notes) out.push(`- ${n}`);
  out.push(``, L("등급은 프로젝트마다의 평가서(generate_egovframe_report)·운영 준비 점검(check_egovframe_operations)과 같은 산식입니다. 이 표는 읽기 전용 집계입니다.", "Grades use the same formulas as each project's assessment (generate_egovframe_report) and operations check (check_egovframe_operations). This table is a read-only aggregation."));
  return out.join("\n");
}
export function renderPortfolioCsv(r: PortfolioResult): string {
  const head = ["name", "owner", "source", "input", "rteVersion", "era", "migration", "supplyChain", "operations", "manual", "vulnerableDependencies", "vulnerabilityIds", "outdated", "secureHigh", "secureMedium", "components", "assessedAt", "change", "error"];
  const q = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = r.rows.map((x) => [x.name, x.owner, x.source, x.input, x.rteVersion, x.era, x.migration, x.supplyChain, x.operations, x.manual, x.vulnerableDependencies, x.vulnerabilityIds, x.outdated, x.secureHigh, x.secureMedium, x.components, x.assessedAt, x.change ? JSON.stringify(x.change) : "", x.error].map(q).join(","));
  return `﻿${[head.join(","), ...rows].join("\r\n")}\r\n`;
}
