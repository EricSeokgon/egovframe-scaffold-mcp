// CLI 모드 (v0.39) — `npx egovframe-scaffold-mcp <command> [options]`.
//   인자가 없으면 지금처럼 MCP stdio 서버로 뜨고(index.ts), 명령이 있으면 그 도구 하나를 실행하고 종료한다.
//   도구 호출은 SDK 의 InMemoryTransport 로 같은 서버에 붙은 클라이언트가 한다 — MCP 로 부를 때와 같은 입력 검증·허용 root·
//   outputSchema 검증을 거치므로 `--json` 출력은 MCP 의 structuredContent 와 같은 객체다.
//   명령은 읽기 전용이거나 dryRun 이 기본인 도구로 한정한다(프로젝트 생성·조립·적용은 사람이 결과를 보는 MCP 경로로).
import { setLang, langFromEnv, L } from "./lang.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./server.js";
import { SERVER_VERSION } from "./version.js";

export const EXIT = { ok: 0, failOn: 2, error: 3, usage: 64 } as const;

interface CommandDef {
  tool: string;
  summary: string;
  /** summary 의 영문(v1.2) */
  summaryEn: string;
  /** 도구 인자 고정값(사용자가 바꿀 수 없음) */
  fixed?: Record<string, unknown>;
  /** CLI 기본값(사용자가 바꿀 수 있음) */
  defaults?: Record<string, unknown>;
  /** CLI 에서 막는 도구 인자 */
  blocked?: string[];
  /** --fail-on 이 볼 지표 */
  metrics: (s: Record<string, unknown>) => Record<string, number>;
  /** stderr 한 줄 요약 */
  line: (s: Record<string, unknown>) => string;
}

const GRADES = ["A", "B", "C", "D"];
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export const COMMANDS: Record<string, CommandDef> = {
  assess: {
    tool: "generate_egovframe_report", summary: "5.x 전환 준비도 평가서(등급·산식)", summaryEn: "5.x migration readiness assessment (grades, formulas)", fixed: { sections: ["assessment"] }, blocked: ["outputPath", "dryRun", "sections"],
    metrics: (s) => {
      const a = rec(s.assessment), g = rec(a.grades), d = rec(a.dependencies), v = rec(d.vulnerabilities), m = rec(a.migration);
      return {
        migration: GRADES.indexOf(String(rec(g.migration).grade)), supplyChain: GRADES.indexOf(String(rec(g.supplyChain).grade)),
        manual: num(m.manual), reassemble: Array.isArray(m.reassemble) ? m.reassemble.length : 0, vulnerabilities: num(v.dependencies),
        outdated: num(rec(d.summary).outdated), legacy: num(rec(d.summary).legacy), replace: num(rec(d.summary).replace), securityMissing: num(rec(a.security).missing),
      };
    },
    line: (s) => { const g = rec(rec(s.assessment).grades); return L(`전환 난이도 ${rec(g.migration).grade ?? "?"} · 공급망 상태 ${rec(g.supplyChain).grade ?? "?"}`, `Migration difficulty ${rec(g.migration).grade ?? "?"} · supply chain status ${rec(g.supplyChain).grade ?? "?"}`); },
  },
  check: {
    tool: "check_egovframe_dependencies", summary: "의존성 점검(기준·OSV·보안 설정)", summaryEn: "Dependency check (baseline, OSV, security settings)",
    metrics: (s) => { const sm = rec(s.summary); return { ok: num(sm.ok), outdated: num(sm.outdated), legacy: num(sm.legacy), replace: num(sm.replace), unknown: num(sm.unknown), unversioned: num(sm.unversioned), vulnerabilities: Array.isArray(s.vulnerabilities) ? s.vulnerabilities.length : 0, securityMissing: Array.isArray(s.checks) ? s.checks.filter((c) => rec(c).status === "missing").length : 0 }; },
    line: (s) => { const sm = rec(s.summary); return L(`의존성 ${Array.isArray(s.findings) ? s.findings.length : 0}건 — 기준 미만 ${num(sm.outdated)} · 전환 대상 ${num(sm.legacy)} · 교체 필요 ${num(sm.replace)} · 취약 ${Array.isArray(s.vulnerabilities) ? s.vulnerabilities.length : "미조회"}`, `${Array.isArray(s.findings) ? s.findings.length : 0} dependencies — below baseline ${num(sm.outdated)} · to migrate ${num(sm.legacy)} · to replace ${num(sm.replace)} · vulnerable ${Array.isArray(s.vulnerabilities) ? s.vulnerabilities.length : "not queried"}`); },
  },
  sbom: {
    tool: "generate_egovframe_sbom", summary: "SBOM — CycloneDX 1.6(기본)·SPDX 2.3(--bom-format spdx-json), --write 없으면 계획만", summaryEn: "SBOM — CycloneDX 1.6 (default) or SPDX 2.3 (--bom-format spdx-json); plan only without --write", defaults: { dryRun: true }, blocked: ["dryRun"],
    metrics: (s) => ({ components: num(s.components), vulnerabilities: num(s.vulnerabilities), unknown: num(rec(s.statuses).unknown), outdated: num(rec(s.statuses).outdated) }),
    line: (s) => (s.written ? L(`SBOM ${s.outputPath} — component ${num(s.components)} · 취약점 ${num(s.vulnerabilities)}`, `SBOM ${s.outputPath} — components ${num(s.components)} · vulnerabilities ${num(s.vulnerabilities)}`) : L(`SBOM 계획만(dryRun) — ${s.outputPath}`, `SBOM plan only (dryRun) — ${s.outputPath}`)),
  },
  "sbom-check": {
    tool: "check_egovframe_sbom", summary: "SBOM 점검(CycloneDX·SPDX, 최소 요소·재점검·비교, --write 면 VEX)", summaryEn: "SBOM check (CycloneDX/SPDX: minimum elements, recheck, diff; VEX with --write)", blocked: ["vex", "dryRun"],
    metrics: (s) => {
      const m = rec(s.minimum), rc = rec(s.recheck), o = rec(rc.osv), df = rec(s.diff), vx = rec(s.vex);
      const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
      return {
        minimum: m.verdict === "needs-work" ? 1 : 0, gaps: num(m.componentsWithGaps), changed: len(rc.changed),
        vulnerabilities: o.queried ? num(o.ids) : num(rec(s.document).vulnerabilities), newVulns: len(o.newIds),
        added: len(df.added), removed: len(df.removed), versionChanged: len(df.versionChanged), diffVulns: len(df.newVulnerabilities),
        triage: num(rec(vx.states).in_triage),
      };
    },
    line: (s) => {
      const m = rec(s.minimum), o = rec(rec(s.recheck).osv), df = s.diff ? rec(s.diff) : null, vx = s.vex ? rec(s.vex) : null;
      return L(`${s.sbomPath} — 최소 요소 ${m.verdict === "ready" ? "제출 가능" : "보완 필요"}${o.queried ? ` · 새 취약점 ${Array.isArray(o.newIds) ? o.newIds.length : 0}` : ""}${df ? ` · 비교 +${Array.isArray(df.added) ? df.added.length : 0}/-${Array.isArray(df.removed) ? df.removed.length : 0}/버전 ${Array.isArray(df.versionChanged) ? df.versionChanged.length : 0}` : ""}${vx ? ` · VEX ${vx.written ? "기록" : "미기록"} in_triage ${num(rec(vx.states).in_triage)}` : ""}`, `${s.sbomPath} — minimum elements ${m.verdict === "ready" ? "ready to submit" : "needs work"}${o.queried ? ` · new vulnerabilities ${Array.isArray(o.newIds) ? o.newIds.length : 0}` : ""}${df ? ` · diff +${Array.isArray(df.added) ? df.added.length : 0}/-${Array.isArray(df.removed) ? df.removed.length : 0}/version ${Array.isArray(df.versionChanged) ? df.versionChanged.length : 0}` : ""}${vx ? ` · VEX ${vx.written ? "written" : "not written"} in_triage ${num(rec(vx.states).in_triage)}` : ""}`);
    },
  },
  secure: {
    tool: "check_egovframe_secure_coding", summary: "보안약점 점검(개발보안 가이드 구현단계, --sarif-path 로 SARIF)", summaryEn: "Secure coding check (implementation-phase guide; SARIF via --sarif-path)",
    metrics: (s) => { const sm = rec(s.summary); return { high: num(sm.high), medium: num(sm.medium), low: num(sm.low), total: num(sm.total), new: num(sm.new) }; },
    line: (s) => { const sm = rec(s.summary); return L(`보안약점 높음 ${num(sm.high)} · 중간 ${num(sm.medium)} · 낮음 ${num(sm.low)}${sm.new !== null && sm.new !== undefined ? ` · 새로 생김 ${num(sm.new)}` : ""}${s.sarif ? ` · SARIF ${rec(s.sarif).path}` : ""}`, `Weaknesses high ${num(sm.high)} · medium ${num(sm.medium)} · low ${num(sm.low)}${sm.new !== null && sm.new !== undefined ? ` · new ${num(sm.new)}` : ""}${s.sarif ? ` · SARIF ${rec(s.sarif).path}` : ""}`); },
  },
  fix: {
    tool: "fix_egovframe_secure_coding", summary: "보안약점 자동 조치(--write 없으면 계획·재점검만)", summaryEn: "Fix secure coding findings (plan and re-check only without --write)", defaults: { dryRun: true }, blocked: ["dryRun"],
    metrics: (s) => { const sm = rec(s.summary); return { fixed: num(sm.fixed), manual: num(sm.manual), excluded: num(sm.excluded), files: num(sm.files), unverified: rec(s.verify).ok === false ? 1 : 0 }; },
    line: (s) => { const sm = rec(s.summary); return L(`보안약점 ${s.dryRun ? "조치 계획" : "조치"} — 고침 ${num(sm.fixed)} · 수동 ${num(sm.manual)} · 제외 ${num(sm.excluded)} · 파일 ${num(sm.files)}${rec(s.verify).ok === false ? " · ⚠️ 재점검 불일치" : ""}`, `Secure coding ${s.dryRun ? "fix plan" : "fix"} — fixed ${num(sm.fixed)} · manual ${num(sm.manual)} · excluded ${num(sm.excluded)} · files ${num(sm.files)}${rec(s.verify).ok === false ? " · ⚠️ re-check mismatch" : ""}`); },
  },
  rehearse: {
    tool: "rehearse_egovframe_migration", summary: "전환 리허설(사본에서 재조립·적용·컴파일, 원본 불변)", summaryEn: "Migration rehearsal (reassemble, apply, compile on a copy; original untouched)",
    metrics: (s) => {
      const ph = (p: unknown) => { const x = rec(p); return x.ran ? (x.success ? 0 : num(rec(x.analysis).errors)) : null; };
      const a = ph(s.afterAutomation), b = ph(s.afterPomAlignment);
      const last = rec(rec(s.afterPomAlignment).ran ? rec(s.afterPomAlignment).analysis : rec(s.afterAutomation).analysis);
      return { errors: b ?? a ?? 0, automation: a ?? 0, aligned: b ?? 0, files: num(last.files), unlinked: num(rec(last.linked).unlinked), failedSteps: Array.isArray(s.steps) ? s.steps.filter((x) => rec(x).ran && !rec(x).ok).length : 0 };
    },
    line: (s) => {
      const ph = (p: unknown) => { const x = rec(p); return !x.ran ? "—" : x.success ? "0" : String(num(rec(x.analysis).errors)); };
      return L(`리허설 — 자동 단계 후 오류 ${ph(s.afterAutomation)} → pom 맞춤 후 ${ph(s.afterPomAlignment)} · 원본 ${rec(s.original).unchanged ? "불변" : "변경됨"}`, `Rehearsal — errors after automation ${ph(s.afterAutomation)} → after pom alignment ${ph(s.afterPomAlignment)} · original ${rec(s.original).unchanged ? "unchanged" : "modified"}`);
    },
  },
  bundle: {
    tool: "prepare_egovframe_offline_bundle", summary: "폐쇄망 오프라인 번들(--write 없으면 목록만)", summaryEn: "Air-gapped offline bundle (list only without --write)", defaults: { dryRun: true }, blocked: ["dryRun"],
    metrics: (s) => ({ files: Array.isArray(s.items) ? s.items.length : 0, bytes: num(s.totalBytes) }),
    line: (s) => (s.written ? L(`번들 ${s.outputDir} — 파일 ${Array.isArray(s.items) ? s.items.length : 0}개 + 원본 미러, ${(num(s.totalBytes) / 1048576).toFixed(1)}MB`, `Bundle ${s.outputDir} — ${Array.isArray(s.items) ? s.items.length : 0} files + source mirror, ${(num(s.totalBytes) / 1048576).toFixed(1)}MB`) : L(`번들 계획만(dryRun) — ${s.outputDir}`, `Bundle plan only (dryRun) — ${s.outputDir}`)),
  },
  deliver: {
    tool: "prepare_egovframe_delivery", summary: "납품 패키지(--write 없으면 계획만, --verify 면 받은 패키지 검증)", summaryEn: "Delivery package (plan only without --write; --verify checks a received package)", defaults: { dryRun: true }, blocked: ["dryRun"],
    metrics: (s) => { const items = Array.isArray(s.items) ? s.items : []; const v = rec(s.verify); return { failed: items.filter((i) => rec(i).status === "failed").length, items: items.length, files: num(s.files), mismatched: Array.isArray(v.mismatched) ? v.mismatched.length : 0, missing: Array.isArray(v.missing) ? v.missing.length : 0, invalid: v.ok === false ? 1 : 0 }; },
    line: (s) => { if (s.mode === "verify") { const v = rec(s.verify); return L(`검증 ${v.ok ? "일치" : "불일치"} — 지문 일치 ${num(v.verified)} · 불일치 ${Array.isArray(v.mismatched) ? v.mismatched.length : 0} · 누락 ${Array.isArray(v.missing) ? v.missing.length : 0}`, `Verification ${v.ok ? "matched" : "mismatched"} — fingerprints matched ${num(v.verified)} · mismatched ${Array.isArray(v.mismatched) ? v.mismatched.length : 0} · missing ${Array.isArray(v.missing) ? v.missing.length : 0}`); } const items = Array.isArray(s.items) ? s.items : []; return s.written ? L(`납품 패키지 ${s.outputDir} — 항목 ${items.filter((i) => rec(i).status === "ok").length}/${items.length} · 파일 ${num(s.files)}개 · rootHash ${String(s.rootHash ?? "").slice(0, 16)}…`, `Delivery package ${s.outputDir} — items ${items.filter((i) => rec(i).status === "ok").length}/${items.length} · ${num(s.files)} files · rootHash ${String(s.rootHash ?? "").slice(0, 16)}…`) : L(`납품 패키지 계획만(dryRun) — ${s.outputDir}`, `Delivery package plan only (dryRun) — ${s.outputDir}`); },
  },
  migrate: {
    tool: "migrate_egovframe_project", summary: "5.x 전환 진단(읽기 전용)", summaryEn: "5.x migration diagnosis (read-only)", fixed: { apply: false, verify: false }, blocked: ["apply", "verify", "dryRun", "skipComponents"],
    metrics: (s) => { const sm = rec(s.summary); return { items: Array.isArray(s.items) ? s.items.length : 0, auto: num(sm.auto), manual: num(sm.manual), files: num(sm.files) }; },
    line: (s) => { const sm = rec(s.summary); return L(`전환 항목 ${Array.isArray(s.items) ? s.items.length : 0}건 = 자동 ${num(sm.auto)} + 수동 ${num(sm.manual)} (${s.sourceEra})`, `${Array.isArray(s.items) ? s.items.length : 0} migration items = auto ${num(sm.auto)} + manual ${num(sm.manual)} (${s.sourceEra})`); },
  },
  validate: {
    tool: "validate_egovframe_project", summary: "조립 프로젝트 무결성 검증", summaryEn: "Assembled project integrity validation",
    metrics: (s) => ({ invalid: s.ok === false ? 1 : 0, missing: Array.isArray(s.components) ? s.components.reduce((n: number, c) => n + num(rec(c).missing), 0) : 0, warnings: Array.isArray(s.warnings) ? s.warnings.length : 0 }),
    line: (s) => L(`검증 ${s.ok ? "통과" : "실패"}`, `Validation ${s.ok ? "passed" : "failed"}`),
  },
  diagnose: {
    tool: "diagnose_egovframe_project", summary: "프로젝트 진단(빌드·RTE·컴포넌트)", summaryEn: "Project diagnosis (build, RTE, components)",
    metrics: (s) => ({ issues: Array.isArray(s.issues) ? s.issues.length : 0, components: Array.isArray(s.detectedComponents) ? s.detectedComponents.length : 0 }),
    line: (s) => L(`RTE ${s.egovVersion ?? "미검출"} · 컴포넌트 ${Array.isArray(s.detectedComponents) ? s.detectedComponents.length : 0}종 · 이슈 ${Array.isArray(s.issues) ? s.issues.length : 0}건`, `RTE ${s.egovVersion ?? "not detected"} · ${Array.isArray(s.detectedComponents) ? s.detectedComponents.length : 0} components · ${Array.isArray(s.issues) ? s.issues.length : 0} issues`),
  },
  network: {
    tool: "diagnose_egovframe_network", summary: "외부 호스트 접속 진단", summaryEn: "External host connectivity diagnosis",
    metrics: (s) => ({ failed: num(rec(s.summary).failed), ok: num(rec(s.summary).ok) }),
    line: (s) => L(`호스트 도달 ${num(rec(s.summary).ok)} · 실패 ${num(rec(s.summary).failed)}`, `Hosts reachable ${num(rec(s.summary).ok)} · failed ${num(rec(s.summary).failed)}`),
  },
};

const CLI_FLAGS = new Set(["project", "json", "out", "fail-on", "step-summary", "write", "lang", "help", "h"]);

export interface ParsedArgs { command: string | null; options: Record<string, string | boolean>; positional: string[] }

/** `--key value`·`--key=value`·`--flag`·`--no-flag` 를 읽는다(순수 함수). */
export function parseArgs(argv: string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") { options.help = true; continue; }
    if (a.startsWith("--")) {
      const body = a.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) { options[body.slice(0, eq)] = body.slice(eq + 1); continue; }
      if (body.startsWith("no-")) { options[body.slice(3)] = false; continue; }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { options[body] = next; i++; } else options[body] = true;
      continue;
    }
    if (command === null) command = a; else positional.push(a);
  }
  return { command, options, positional };
}

export const kebabToCamel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** 도구 inputSchema(JSON Schema)의 타입에 맞춰 문자열 옵션을 값으로 바꾼다. */
export function coerceArgs(options: Record<string, string | boolean>, schema: { properties?: Record<string, { type?: string | string[]; items?: { type?: string } }> }): { args: Record<string, unknown>; unknown: string[] } {
  const props = schema.properties ?? {};
  const args: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const [rawKey, raw] of Object.entries(options)) {
    if (CLI_FLAGS.has(rawKey)) continue;
    const key = kebabToCamel(rawKey);
    const p = props[key];
    if (!p) { unknown.push(`--${rawKey}`); continue; }
    const type = Array.isArray(p.type) ? p.type.find((t) => t !== "null") : p.type;
    if (type === "boolean") args[key] = raw === true || raw === "true" || raw === "1" ? true : raw === false || raw === "false" || raw === "0" ? false : raw;
    else if (type === "number" || type === "integer") args[key] = typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    else if (type === "array") args[key] = typeof raw === "string" ? raw.split(",").map((x) => x.trim()).filter(Boolean) : raw;
    else args[key] = raw;
  }
  return { args, unknown };
}

export interface FailCondition { metric: string; op: ">" | ">=" ; value: number; text: string }
/** `--fail-on` 식: `metric`(>0)·`metric>N`·`metric>=N`·`grade:C`(C 이상), 쉼표로 여러 개. */
export function parseFailOn(expr: string, metricNames: string[], gradeMetrics: string[] = []): FailCondition[] {
  const out: FailCondition[] = [];
  for (const raw of expr.split(",").map((x) => x.trim()).filter(Boolean)) {
    let m = raw.match(/^([A-Za-z]+):([ABCD])$/);
    if (m) {
      if (!gradeMetrics.includes(m[1])) throw new Error(L(`--fail-on: 등급 조건을 쓸 수 없는 지표: ${m[1]} (등급 지표: ${gradeMetrics.join(", ") || "없음"})`, `--fail-on: grade condition not allowed for metric ${m[1]} (grade metrics: ${gradeMetrics.join(", ") || "none"})`));
      out.push({ metric: m[1], op: ">=", value: GRADES.indexOf(m[2]), text: raw });
      continue;
    }
    m = raw.match(/^([A-Za-z]+)(?:(>=|>)(\d+))?$/);
    if (!m) throw new Error(L(`--fail-on 형식 오류: ${raw} (예: supplyChain:C, vulnerabilities, manual>20)`, `--fail-on: invalid expression ${raw} (e.g. supplyChain:C, vulnerabilities, manual>20)`));
    if (!metricNames.includes(m[1])) throw new Error(L(`--fail-on: 알 수 없는 지표 ${m[1]} (가능: ${metricNames.join(", ")})`, `--fail-on: unknown metric ${m[1]} (available: ${metricNames.join(", ")})`));
    if (gradeMetrics.includes(m[1]) && !m[2]) throw new Error(L(`--fail-on: ${m[1]} 은 등급 지표입니다 — ${m[1]}:C 처럼 쓰세요`, `--fail-on: ${m[1]} is a grade metric — write it as ${m[1]}:C`));
    out.push({ metric: m[1], op: (m[2] as ">" | ">=") ?? ">", value: m[3] !== undefined ? Number(m[3]) : 0, text: raw });
  }
  return out;
}
export function evaluateFailOn(conds: FailCondition[], metrics: Record<string, number>): FailCondition[] {
  return conds.filter((c) => (c.op === ">" ? metrics[c.metric] > c.value : metrics[c.metric] >= c.value));
}

export function usage(): string {
  const lines = [
    `egovframe-scaffold-mcp ${SERVER_VERSION}`,
    ``,
    L(`사용법:`, `Usage:`),
    L(`  npx egovframe-scaffold-mcp                       MCP stdio 서버(AI 클라이언트용, 기존 동작)`, `  npx egovframe-scaffold-mcp                       MCP stdio server (for AI clients, default behavior)`),
    L(`  npx egovframe-scaffold-mcp <명령> [옵션]          도구 하나를 실행하고 종료(CI·배치용)`, `  npx egovframe-scaffold-mcp <command> [options]   Run one tool and exit (for CI and batch)`),
    ``,
    L(`명령:`, `Commands:`),
    ...Object.entries(COMMANDS).map(([k, c]) => `  ${k.padEnd(10)} ${L(c.summary, c.summaryEn)}  (${c.tool})`),
    ``,
    L(`공통 옵션:`, `Common options:`),
    L(`  --project <dir>       대상 프로젝트(기본 현재 디렉터리)`, `  --project <dir>       Target project (default: current directory)`),
    L(`  --json                structuredContent(JSON) 출력 — MCP 결과와 같은 객체`, `  --json                Print structuredContent (JSON) — the same object as the MCP result`),
    L(`  --out <file>          출력을 파일로도 저장`, `  --out <file>          Also save the output to a file`),
    L(`  --step-summary        Markdown 을 $GITHUB_STEP_SUMMARY 에 덧붙임`, `  --step-summary        Append the Markdown to $GITHUB_STEP_SUMMARY`),
    L(`  --fail-on <식>        기준을 넘으면 종료 코드 2 — 예: supplyChain:C · migration:D · vulnerabilities · manual>20`, `  --fail-on <expr>      Exit code 2 when a threshold is exceeded — e.g. supplyChain:C · migration:D · vulnerabilities · manual>20`),
    L(`  --lang ko|en          응답 언어(기본 EGOVFRAME_LANG, 없으면 ko) — Markdown 본문과 문장 필드가 영문으로`, `  --lang ko|en          Response language (default EGOVFRAME_LANG, else ko) — Markdown body and sentence fields in English`),
    L(`  --write               sbom: 실제로 파일을 씀(기본은 계획만) · sbom-check: VEX 초안 작성·갱신(판단 보존) · bundle: 번들 내려받기 · deliver: 패키지 만들기 · fix: 고친 내용을 씀(원본은 migration-backup/)`, `  --write               sbom: actually write the file (default: plan only) · sbom-check: create/update VEX draft (keeps decisions) · bundle: download the bundle · deliver: build the package · fix: write the fixes (originals in migration-backup/)`),
    L(`  --verify              deliver: 받은 패키지(--output-dir)의 manifest 지문 재검증`, `  --verify              deliver: re-verify manifest fingerprints of a received package (--output-dir)`),
    L(`  그 밖의 옵션은 도구 파라미터와 같은 이름(kebab-case 가능): --resolve --offline=false --resolve-scope all --top-n 10 …`, `  Other options use the tool parameter names (kebab-case allowed): --resolve --offline=false --resolve-scope all --top-n 10 …`),
    ``,
    L(`종료 코드: 0 통과 · 2 --fail-on 기준 초과 · 3 실행 실패 · 64 사용법 오류`, `Exit codes: 0 passed · 2 --fail-on threshold exceeded · 3 execution failed · 64 usage error`),
  ];
  return lines.join("\n");
}

export interface CliIo { stdout: (s: string) => void; stderr: (s: string) => void; env: NodeJS.ProcessEnv; cwd: string }
const defaultIo = (): CliIo => ({ stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), env: process.env, cwd: process.cwd() });

/** CLI 실행. 종료 코드를 돌려준다(process.exit 은 호출자가). */
export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  let parsed: ParsedArgs;
  try { parsed = parseArgs(argv); } catch (e) { io.stderr(`${(e as Error).message}\n`); return EXIT.usage; }
  const { command, options } = parsed;
  // v1.2: 응답 언어 — --lang 이 EGOVFRAME_LANG 보다 우선. usage·오류 출력보다 먼저 정하고, 같은 프로세스(테스트·임베드)를 위해 끝나면 되돌린다
  const prevLang = setLang(options.lang === "en" || options.lang === "ko" ? options.lang : langFromEnv(io.env));
  try {
    if (options.lang !== undefined && options.lang !== "ko" && options.lang !== "en") { io.stderr(L(`--lang 은 ko 또는 en 이어야 합니다: ${String(options.lang)}\n`, `--lang must be ko or en: ${String(options.lang)}\n`)); return EXIT.usage; }
    if (command === "--version" || options.version === true) { io.stdout(`${SERVER_VERSION}\n`); return EXIT.ok; }
    if (!command || command === "help" || options.help) { io.stdout(`${usage()}\n`); return command && command !== "help" && !COMMANDS[command] ? EXIT.usage : EXIT.ok; }
    const def = COMMANDS[command];
    if (!def) { io.stderr(L(`알 수 없는 명령: ${command}\n\n${usage()}\n`, `Unknown command: ${command}\n\n${usage()}\n`)); return EXIT.usage; }
    if (parsed.positional.length) { io.stderr(L(`알 수 없는 인자: ${parsed.positional.join(" ")}\n`, `Unknown argument: ${parsed.positional.join(" ")}\n`)); return EXIT.usage; }
    return await runCommand(command, def, options, io);
  } finally {
    setLang(prevLang);
  }
}

async function runCommand(command: string, def: CommandDef, options: Record<string, string | boolean>, io: CliIo): Promise<number> {
  const server = buildServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "egovframe-scaffold-mcp-cli", version: SERVER_VERSION });
  try {
    await server.connect(serverT);
    await client.connect(clientT);
    const tool = (await client.listTools()).tools.find((t) => t.name === def.tool);
    if (!tool) { io.stderr(L(`도구를 찾지 못했습니다: ${def.tool}\n`, `Tool not found: ${def.tool}\n`)); return EXIT.error; }
    const { args, unknown } = coerceArgs(options, tool.inputSchema as never);
    if (unknown.length) { io.stderr(L(`${command}: 알 수 없는 옵션 ${unknown.join(", ")} — 도구 파라미터: ${Object.keys((tool.inputSchema as { properties?: object }).properties ?? {}).join(", ")}\n`, `${command}: unknown option ${unknown.join(", ")} — tool parameters: ${Object.keys((tool.inputSchema as { properties?: object }).properties ?? {}).join(", ")}\n`)); return EXIT.usage; }
    const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const blocked = (def.blocked ?? []).filter((k) => k in args);
    if (blocked.length) { io.stderr(L(`${command}: CLI 에서 쓸 수 없는 옵션 ${blocked.join(", ")} (쓰기 작업은 MCP 경로로)\n`, `${command}: option not available in the CLI ${blocked.join(", ")} (use the MCP path for write operations)\n`)); return EXIT.usage; }
    const pick = (o: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(o).filter(([k]) => k in props));
    const finalArgs: Record<string, unknown> = { ...pick(def.defaults), ...args, ...pick(def.fixed) };
    if ("projectDir" in props) finalArgs.projectDir = path.resolve(io.cwd, typeof options.project === "string" ? options.project : ".");
    if ("format" in props) finalArgs.format = "markdown";
    if (command === "sbom" && options.write === true) finalArgs.dryRun = false;
    if (command === "sbom-check" && options.write === true) finalArgs.vex = true;
    if (command === "bundle" && options.write === true) finalArgs.dryRun = false;
    if (command === "bundle" && typeof finalArgs.outputDir === "string") finalArgs.outputDir = path.resolve(io.cwd, finalArgs.outputDir);
    if (command === "deliver" && options.write === true) finalArgs.dryRun = false;
    if (command === "fix" && options.write === true) finalArgs.dryRun = false;
    if (command === "deliver" && options.verify === true) finalArgs.verify = true;
    if (command === "deliver" && typeof finalArgs.outputDir === "string") finalArgs.outputDir = path.resolve(io.cwd, finalArgs.outputDir);
    if (command === "deliver" && typeof finalArgs.previousDelivery === "string") finalArgs.previousDelivery = path.resolve(io.cwd, finalArgs.previousDelivery);
    let conds: FailCondition[] = [];
    if (options["fail-on"] !== undefined) {
      if (typeof options["fail-on"] !== "string") { io.stderr(L(`--fail-on 에 식이 필요합니다\n`, `--fail-on requires an expression\n`)); return EXIT.usage; }
      const sample = def.metrics({});
      try { conds = parseFailOn(options["fail-on"], Object.keys(sample), command === "assess" ? ["migration", "supplyChain"] : []); }
      catch (e) { io.stderr(`${(e as Error).message}\n`); return EXIT.usage; }
    }

    const res = await client.callTool({ name: def.tool, arguments: finalArgs });
    const text = Array.isArray(res.content) ? res.content.filter((c) => (c as { type: string }).type === "text").map((c) => (c as { text: string }).text).join("\n") : "";
    if (res.isError) { io.stderr(`${command}: ${text}\n`); return EXIT.error; }
    const structured = (res.structuredContent ?? {}) as Record<string, unknown>;
    const body = options.json === true ? `${JSON.stringify(structured, null, 2)}\n` : `${text}\n`;
    io.stdout(body);
    if (typeof options.out === "string") { const p = path.resolve(io.cwd, options.out); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); }
    if (options["step-summary"] === true && io.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(io.env.GITHUB_STEP_SUMMARY, `${text}\n\n`);
    const metrics = def.metrics(structured);
    const failed = evaluateFailOn(conds, metrics);
    io.stderr(`egovframe-scaffold-mcp ${command}: ${def.line(structured)}${conds.length ? ` — fail-on ${conds.map((c) => c.text).join(",")}: ${failed.length ? L(`초과(${failed.map((c) => c.text).join(", ")})`, `exceeded (${failed.map((c) => c.text).join(", ")})`) : L("통과", "passed")}` : ""}\n`);
    return failed.length ? EXIT.failOn : EXIT.ok;
  } catch (e) {
    io.stderr(`${command}: ${(e as Error).message}\n`);
    return EXIT.error;
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
