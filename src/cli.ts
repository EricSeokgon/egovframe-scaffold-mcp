// CLI 모드 (v0.39) — `npx egovframe-scaffold-mcp <command> [options]`.
//   인자가 없으면 지금처럼 MCP stdio 서버로 뜨고(index.ts), 명령이 있으면 그 도구 하나를 실행하고 종료한다.
//   도구 호출은 SDK 의 InMemoryTransport 로 같은 서버에 붙은 클라이언트가 한다 — MCP 로 부를 때와 같은 입력 검증·허용 root·
//   outputSchema 검증을 거치므로 `--json` 출력은 MCP 의 structuredContent 와 같은 객체다.
//   명령은 읽기 전용이거나 dryRun 이 기본인 도구로 한정한다(프로젝트 생성·조립·적용은 사람이 결과를 보는 MCP 경로로).
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
    tool: "generate_egovframe_report", summary: "5.x 전환 준비도 평가서(등급·산식)", fixed: { sections: ["assessment"] }, blocked: ["outputPath", "dryRun", "sections"],
    metrics: (s) => {
      const a = rec(s.assessment), g = rec(a.grades), d = rec(a.dependencies), v = rec(d.vulnerabilities), m = rec(a.migration);
      return {
        migration: GRADES.indexOf(String(rec(g.migration).grade)), supplyChain: GRADES.indexOf(String(rec(g.supplyChain).grade)),
        manual: num(m.manual), reassemble: Array.isArray(m.reassemble) ? m.reassemble.length : 0, vulnerabilities: num(v.dependencies),
        outdated: num(rec(d.summary).outdated), legacy: num(rec(d.summary).legacy), replace: num(rec(d.summary).replace), securityMissing: num(rec(a.security).missing),
      };
    },
    line: (s) => { const g = rec(rec(s.assessment).grades); return `전환 난이도 ${rec(g.migration).grade ?? "?"} · 공급망 상태 ${rec(g.supplyChain).grade ?? "?"}`; },
  },
  check: {
    tool: "check_egovframe_dependencies", summary: "의존성 점검(기준·OSV·보안 설정)",
    metrics: (s) => { const sm = rec(s.summary); return { ok: num(sm.ok), outdated: num(sm.outdated), legacy: num(sm.legacy), replace: num(sm.replace), unknown: num(sm.unknown), unversioned: num(sm.unversioned), vulnerabilities: Array.isArray(s.vulnerabilities) ? s.vulnerabilities.length : 0, securityMissing: Array.isArray(s.checks) ? s.checks.filter((c) => rec(c).status === "missing").length : 0 }; },
    line: (s) => { const sm = rec(s.summary); return `의존성 ${Array.isArray(s.findings) ? s.findings.length : 0}건 — 기준 미만 ${num(sm.outdated)} · 전환 대상 ${num(sm.legacy)} · 교체 필요 ${num(sm.replace)} · 취약 ${Array.isArray(s.vulnerabilities) ? s.vulnerabilities.length : "미조회"}`; },
  },
  sbom: {
    tool: "generate_egovframe_sbom", summary: "CycloneDX 1.6 SBOM(--write 없으면 계획만)", defaults: { dryRun: true }, blocked: ["dryRun"],
    metrics: (s) => ({ components: num(s.components), vulnerabilities: num(s.vulnerabilities), unknown: num(rec(s.statuses).unknown), outdated: num(rec(s.statuses).outdated) }),
    line: (s) => (s.written ? `SBOM ${s.outputPath} — component ${num(s.components)} · 취약점 ${num(s.vulnerabilities)}` : `SBOM 계획만(dryRun) — ${s.outputPath}`),
  },
  migrate: {
    tool: "migrate_egovframe_project", summary: "5.x 전환 진단(읽기 전용)", fixed: { apply: false, verify: false }, blocked: ["apply", "verify", "dryRun", "skipComponents"],
    metrics: (s) => { const sm = rec(s.summary); return { items: Array.isArray(s.items) ? s.items.length : 0, auto: num(sm.auto), manual: num(sm.manual), files: num(sm.files) }; },
    line: (s) => { const sm = rec(s.summary); return `전환 항목 ${Array.isArray(s.items) ? s.items.length : 0}건 = 자동 ${num(sm.auto)} + 수동 ${num(sm.manual)} (${s.sourceEra})`; },
  },
  validate: {
    tool: "validate_egovframe_project", summary: "조립 프로젝트 무결성 검증",
    metrics: (s) => ({ invalid: s.ok === false ? 1 : 0, missing: Array.isArray(s.components) ? s.components.reduce((n: number, c) => n + num(rec(c).missing), 0) : 0, warnings: Array.isArray(s.warnings) ? s.warnings.length : 0 }),
    line: (s) => `검증 ${s.ok ? "통과" : "실패"}`,
  },
  diagnose: {
    tool: "diagnose_egovframe_project", summary: "프로젝트 진단(빌드·RTE·컴포넌트)",
    metrics: (s) => ({ issues: Array.isArray(s.issues) ? s.issues.length : 0, components: Array.isArray(s.detectedComponents) ? s.detectedComponents.length : 0 }),
    line: (s) => `RTE ${s.egovVersion ?? "미검출"} · 컴포넌트 ${Array.isArray(s.detectedComponents) ? s.detectedComponents.length : 0}종 · 이슈 ${Array.isArray(s.issues) ? s.issues.length : 0}건`,
  },
  network: {
    tool: "diagnose_egovframe_network", summary: "외부 호스트 접속 진단",
    metrics: (s) => ({ failed: num(rec(s.summary).failed), ok: num(rec(s.summary).ok) }),
    line: (s) => `호스트 도달 ${num(rec(s.summary).ok)} · 실패 ${num(rec(s.summary).failed)}`,
  },
};

const CLI_FLAGS = new Set(["project", "json", "out", "fail-on", "step-summary", "write", "help", "h"]);

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
      if (!gradeMetrics.includes(m[1])) throw new Error(`--fail-on: 등급 조건을 쓸 수 없는 지표: ${m[1]} (등급 지표: ${gradeMetrics.join(", ") || "없음"})`);
      out.push({ metric: m[1], op: ">=", value: GRADES.indexOf(m[2]), text: raw });
      continue;
    }
    m = raw.match(/^([A-Za-z]+)(?:(>=|>)(\d+))?$/);
    if (!m) throw new Error(`--fail-on 형식 오류: ${raw} (예: supplyChain:C, vulnerabilities, manual>20)`);
    if (!metricNames.includes(m[1])) throw new Error(`--fail-on: 알 수 없는 지표 ${m[1]} (가능: ${metricNames.join(", ")})`);
    if (gradeMetrics.includes(m[1]) && !m[2]) throw new Error(`--fail-on: ${m[1]} 은 등급 지표입니다 — ${m[1]}:C 처럼 쓰세요`);
    out.push({ metric: m[1], op: (m[2] as ">" | ">=") ?? ">", value: m[3] !== undefined ? Number(m[3]) : 0, text: raw });
  }
  return out;
}
export function evaluateFailOn(conds: FailCondition[], metrics: Record<string, number>): FailCondition[] {
  return conds.filter((c) => (c.op === ">" ? metrics[c.metric] > c.value : metrics[c.metric] >= c.value));
}

export function usage(): string {
  const L = [
    `egovframe-scaffold-mcp ${SERVER_VERSION}`,
    ``,
    `사용법:`,
    `  npx egovframe-scaffold-mcp                       MCP stdio 서버(AI 클라이언트용, 기존 동작)`,
    `  npx egovframe-scaffold-mcp <명령> [옵션]          도구 하나를 실행하고 종료(CI·배치용)`,
    ``,
    `명령:`,
    ...Object.entries(COMMANDS).map(([k, c]) => `  ${k.padEnd(9)} ${c.summary}  (${c.tool})`),
    ``,
    `공통 옵션:`,
    `  --project <dir>       대상 프로젝트(기본 현재 디렉터리)`,
    `  --json                structuredContent(JSON) 출력 — MCP 결과와 같은 객체`,
    `  --out <file>          출력을 파일로도 저장`,
    `  --step-summary        Markdown 을 $GITHUB_STEP_SUMMARY 에 덧붙임`,
    `  --fail-on <식>        기준을 넘으면 종료 코드 2 — 예: supplyChain:C · migration:D · vulnerabilities · manual>20`,
    `  --write               sbom: 실제로 파일을 씀(기본은 계획만)`,
    `  그 밖의 옵션은 도구 파라미터와 같은 이름(kebab-case 가능): --resolve --offline=false --resolve-scope all --top-n 10 …`,
    ``,
    `종료 코드: 0 통과 · 2 --fail-on 기준 초과 · 3 실행 실패 · 64 사용법 오류`,
  ];
  return L.join("\n");
}

export interface CliIo { stdout: (s: string) => void; stderr: (s: string) => void; env: NodeJS.ProcessEnv; cwd: string }
const defaultIo = (): CliIo => ({ stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), env: process.env, cwd: process.cwd() });

/** CLI 실행. 종료 코드를 돌려준다(process.exit 은 호출자가). */
export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  let parsed: ParsedArgs;
  try { parsed = parseArgs(argv); } catch (e) { io.stderr(`${(e as Error).message}\n`); return EXIT.usage; }
  const { command, options } = parsed;
  if (command === "--version" || options.version === true) { io.stdout(`${SERVER_VERSION}\n`); return EXIT.ok; }
  if (!command || command === "help" || options.help) { io.stdout(`${usage()}\n`); return command && command !== "help" && !COMMANDS[command] ? EXIT.usage : EXIT.ok; }
  const def = COMMANDS[command];
  if (!def) { io.stderr(`알 수 없는 명령: ${command}\n\n${usage()}\n`); return EXIT.usage; }
  if (parsed.positional.length) { io.stderr(`알 수 없는 인자: ${parsed.positional.join(" ")}\n`); return EXIT.usage; }

  const server = buildServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "egovframe-scaffold-mcp-cli", version: SERVER_VERSION });
  try {
    await server.connect(serverT);
    await client.connect(clientT);
    const tool = (await client.listTools()).tools.find((t) => t.name === def.tool);
    if (!tool) { io.stderr(`도구를 찾지 못했습니다: ${def.tool}\n`); return EXIT.error; }
    const { args, unknown } = coerceArgs(options, tool.inputSchema as never);
    if (unknown.length) { io.stderr(`${command}: 알 수 없는 옵션 ${unknown.join(", ")} — 도구 파라미터: ${Object.keys((tool.inputSchema as { properties?: object }).properties ?? {}).join(", ")}\n`); return EXIT.usage; }
    const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const blocked = (def.blocked ?? []).filter((k) => k in args);
    if (blocked.length) { io.stderr(`${command}: CLI 에서 쓸 수 없는 옵션 ${blocked.join(", ")} (쓰기 작업은 MCP 경로로)\n`); return EXIT.usage; }
    const pick = (o: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(o).filter(([k]) => k in props));
    const finalArgs: Record<string, unknown> = { ...pick(def.defaults), ...args, ...pick(def.fixed) };
    if ("projectDir" in props) finalArgs.projectDir = path.resolve(io.cwd, typeof options.project === "string" ? options.project : ".");
    if ("format" in props) finalArgs.format = "markdown";
    if (command === "sbom" && options.write === true) finalArgs.dryRun = false;
    let conds: FailCondition[] = [];
    if (options["fail-on"] !== undefined) {
      if (typeof options["fail-on"] !== "string") { io.stderr(`--fail-on 에 식이 필요합니다\n`); return EXIT.usage; }
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
    io.stderr(`egovframe-scaffold-mcp ${command}: ${def.line(structured)}${conds.length ? ` — fail-on ${conds.map((c) => c.text).join(",")}: ${failed.length ? `초과(${failed.map((c) => c.text).join(", ")})` : "통과"}` : ""}\n`);
    return failed.length ? EXIT.failOn : EXIT.ok;
  } catch (e) {
    io.stderr(`${command}: ${(e as Error).message}\n`);
    return EXIT.error;
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
