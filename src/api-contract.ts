// 공개 API 계약 (v1.0) — 버전 정책(docs/versioning.md)이 지키는 것을 기계적으로 뽑고 비교한다.
//   계약: MCP 도구 이름·입력 파라미터(타입·필수·기본값·허용값·범위)·구조화 출력 스키마, CLI 명령(→ 도구)·종료 코드,
//   환경 변수, 지원 Node 최소 버전. 설명·제목·annotations·Markdown 문구는 계약이 아니다.
//   비교 결과는 변경마다 minor(호환 추가)·major(호환 깨짐)로 분류하고, 버전 증가 폭이 그에 맞는지 검사한다.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./server.js";
import { COMMANDS, EXIT } from "./cli.js";
import { NODE_ENGINES } from "./version.js";
import { DEPRECATED_PARAMS } from "./deprecations.js";

export type ChangeLevel = "none" | "minor" | "major";
export interface ContractChange { level: Exclude<ChangeLevel, "none">; path: string; what: string }
type Schema = Record<string, unknown>;

export interface ApiContract {
  tools: Record<string, { input: Schema; output: Schema | null; deprecated: Record<string, string> }>;
  cli: { commands: Record<string, string>; exitCodes: Record<string, number> };
  env: string[];
  node: string;
}

/** 공개 환경 변수(README 「보안 설정」·「폐쇄망」·CLI 절에 문서화된 것) */
export const PUBLIC_ENV = ["EGOVFRAME_ALLOWED_ROOTS", "EGOVFRAME_BUNDLE_MAX_AGE_DAYS", "EGOVFRAME_CACHE_DIR", "EGOVFRAME_LANG", "EGOVFRAME_MAVEN_MIRROR", "EGOVFRAME_OFFLINE_BUNDLE"];

const KEEP = ["type", "enum", "const", "default", "required", "properties", "items", "anyOf", "oneOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern"];

/** JSON Schema 에서 계약에 해당하는 키만 남기고 정렬(설명·제목·$schema 등 제거) */
export function normalizeSchema(s: unknown): Schema {
  if (!s || typeof s !== "object" || Array.isArray(s)) return {};
  const src = s as Schema, out: Schema = {};
  for (const k of KEEP) {
    if (!(k in src)) continue;
    const v = src[k];
    if (k === "properties") out[k] = Object.fromEntries(Object.keys(v as Schema).sort().map((p) => [p, normalizeSchema((v as Schema)[p])]));
    else if (k === "items") out[k] = normalizeSchema(v);
    else if (k === "anyOf" || k === "oneOf") out[k] = (v as unknown[]).map(normalizeSchema);
    else if (k === "required" || k === "enum") out[k] = [...(v as unknown[])].map(String).sort();
    // v1.6: zod 4 는 .int() 에 안전 정수 범위(±2^53-1)를 적는다 — 실질 제약이 아니므로 계약에서 뺀다(zod 3 스냅샷과 같게)
    else if ((k === "maximum" && v === Number.MAX_SAFE_INTEGER) || (k === "minimum" && v === Number.MIN_SAFE_INTEGER)) continue;
    else out[k] = v;
  }
  return out;
}

/** 지금 코드의 공개 API 계약 */
export async function buildApiContract(): Promise<ApiContract> {
  const server = buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "api-contract", version: "0" });
  await server.connect(st);
  await client.connect(ct);
  try {
    const { tools } = await client.listTools();
    const out: ApiContract["tools"] = {};
    for (const t of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
      out[t.name] = { input: normalizeSchema(t.inputSchema), output: t.outputSchema ? normalizeSchema(t.outputSchema) : null, deprecated: Object.fromEntries(Object.entries(DEPRECATED_PARAMS[t.name] ?? {}).map(([k, v]) => [k, v.use])) };
    }
    return {
      tools: out,
      cli: { commands: Object.fromEntries(Object.keys(COMMANDS).sort().map((k) => [k, COMMANDS[k].tool])), exitCodes: { ...EXIT } },
      env: [...PUBLIC_ENV].sort(),
      node: NODE_ENGINES,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

/**
 * 입력 pattern 을 넓히기만 한 변경(옛 값이 모두 계속 허용됨). 사람이 검토해 적고, test/api-contract.mjs 가 samples 로
 * "옛 pattern 에 맞는 값은 새 pattern 에도 맞음"을 단언한다.
 */
export const PATTERN_WIDENINGS: { at: string; from: string; to: string; since: string; samples: string[] }[] = [
  // v1.3.0: migrate_egovframe_project target 에 5.1.0(5.y.z) 허용
  { at: "migrate_egovframe_project.target", from: "^(5\\.x|5\\.0\\.\\d+)$", to: "^(5\\.x|5\\.\\d+\\.\\d+)$", since: "1.3.0", samples: ["5.x", "5.0.0", "5.0.1", "5.0.2", "5.0.10"] },
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nodeMin = (range: string) => { const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range); return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : [0, 0, 0]; };
const cmp3 = (a: number[], b: number[]) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

/** 스키마 비교. input: 호출자가 보내는 쪽(좁히면 major), output: 받는 쪽(빼거나 선택으로 바꾸면 major) */
function compareSchema(a: Schema, b: Schema, mode: "input" | "output", at: string, out: ContractChange[]): void {
  const add = (level: ContractChange["level"], what: string) => out.push({ level, path: at, what });
  // v1.6: 출력에서 제약 없던 스키마({} — 예: zod 3 변환의 $ref 를 계약에서 뺀 자리)가 구체화되면 받는 쪽 호환(minor)
  if (mode === "output" && Object.keys(a).length === 0) { if (Object.keys(b).length) add("minor", "스키마 구체화(제약 없음 → 명시)"); return; }
  if (!same(a.type, b.type)) add("major", `타입 ${JSON.stringify(a.type)} → ${JSON.stringify(b.type)}`);
  for (const k of ["anyOf", "oneOf", "const"] as const) if (!same(a[k], b[k])) add(mode === "input" ? "major" : "minor", `${k} 변경`);
  if (!same(a.pattern, b.pattern)) {
    // 입력 pattern 은 기본 major. 검토해 넓히기만 한 것(PATTERN_WIDENINGS)은 minor — 옛 pattern 의 값이 모두 새 pattern 에도 맞음
    const widened = mode === "input" && PATTERN_WIDENINGS.some((w) => w.from === a.pattern && w.to === b.pattern);
    add(mode === "input" && !widened ? "major" : "minor", widened ? "pattern 확장(검토됨)" : "pattern 변경");
  }
  if (a.enum || b.enum) {
    const ea = (a.enum as string[] | undefined) ?? [], eb = (b.enum as string[] | undefined) ?? [];
    const removed = ea.filter((x) => !eb.includes(x)), added = eb.filter((x) => !ea.includes(x));
    if (!b.enum && a.enum) add("minor", "허용값 제한 해제");
    else if (removed.length) add(mode === "input" ? "major" : "minor", `허용값 제거 ${removed.join(",")}`);
    if (added.length && a.enum) add("minor", `허용값 추가 ${added.join(",")}`);
    if (b.enum && !a.enum) add(mode === "input" ? "major" : "minor", "허용값 제한 추가");
  }
  if (mode === "input") {
    if (!same(a.default, b.default)) add("major", `기본값 ${JSON.stringify(a.default)} → ${JSON.stringify(b.default)}`);
    for (const k of ["minimum", "exclusiveMinimum", "minLength", "minItems"] as const) {
      if (same(a[k], b[k])) continue;
      const wider = b[k] === undefined || (a[k] !== undefined && (b[k] as number) < (a[k] as number));
      add(wider ? "minor" : "major", `${k} ${a[k] ?? "-"} → ${b[k] ?? "-"}`);
    }
    for (const k of ["maximum", "exclusiveMaximum", "maxLength", "maxItems"] as const) {
      if (same(a[k], b[k])) continue;
      const wider = b[k] === undefined || (a[k] !== undefined && (b[k] as number) > (a[k] as number));
      add(wider ? "minor" : "major", `${k} ${a[k] ?? "-"} → ${b[k] ?? "-"}`);
    }
  }
  const pa = (a.properties as Record<string, Schema> | undefined) ?? {}, pb = (b.properties as Record<string, Schema> | undefined) ?? {};
  const ra = (a.required as string[] | undefined) ?? [], rb = (b.required as string[] | undefined) ?? [];
  for (const p of Object.keys(pa)) {
    if (!(p in pb)) { add("major", `${mode === "input" ? "파라미터" : "필드"} 제거 ${p}`); continue; }
    compareSchema(pa[p], pb[p], mode, `${at}.${p}`, out);
    if (ra.includes(p) && !rb.includes(p)) add(mode === "input" ? "minor" : "major", `${p} 필수 → 선택`);
    if (!ra.includes(p) && rb.includes(p)) add(mode === "input" ? "major" : "minor", `${p} 선택 → 필수`);
  }
  for (const p of Object.keys(pb)) if (!(p in pa)) add(mode === "input" && rb.includes(p) ? "major" : "minor", `${mode === "input" ? (rb.includes(p) ? "필수 파라미터" : "선택 파라미터") : "필드"} 추가 ${p}`);
  if (a.items || b.items) compareSchema((a.items as Schema) ?? {}, (b.items as Schema) ?? {}, mode, `${at}[]`, out);
}

/** 두 계약의 차이와 그 등급 */
export function compareContracts(a: ApiContract, b: ApiContract): { level: ChangeLevel; changes: ContractChange[] } {
  const out: ContractChange[] = [];
  for (const name of Object.keys(a.tools)) {
    const ta = a.tools[name], tb = b.tools[name];
    if (!tb) { out.push({ level: "major", path: name, what: "도구 제거" }); continue; }
    compareSchema(ta.input, tb.input, "input", `${name}(입력)`, out);
    if (ta.output && !tb.output) out.push({ level: "major", path: name, what: "구조화 출력 제거" });
    else if (!ta.output && tb.output) out.push({ level: "minor", path: name, what: "구조화 출력 추가" });
    else if (ta.output && tb.output) compareSchema(ta.output, tb.output, "output", `${name}(출력)`, out);
    for (const [p, use] of Object.entries(tb.deprecated ?? {})) if (!(ta.deprecated ?? {})[p]) out.push({ level: "minor", path: `${name}.${p}`, what: `deprecated(대신 ${use})` });
  }
  for (const name of Object.keys(b.tools)) if (!a.tools[name]) out.push({ level: "minor", path: name, what: "도구 추가" });
  for (const [c, tool] of Object.entries(a.cli.commands)) {
    if (!(c in b.cli.commands)) out.push({ level: "major", path: `cli ${c}`, what: "명령 제거" });
    else if (b.cli.commands[c] !== tool) out.push({ level: "major", path: `cli ${c}`, what: `도구 ${tool} → ${b.cli.commands[c]}` });
  }
  for (const c of Object.keys(b.cli.commands)) if (!(c in a.cli.commands)) out.push({ level: "minor", path: `cli ${c}`, what: "명령 추가" });
  for (const [k, v] of Object.entries(a.cli.exitCodes)) if (b.cli.exitCodes[k] !== v) out.push({ level: "major", path: `cli exit ${k}`, what: `${v} → ${b.cli.exitCodes[k] ?? "없음"}` });
  for (const k of Object.keys(b.cli.exitCodes)) if (!(k in a.cli.exitCodes)) out.push({ level: "minor", path: `cli exit ${k}`, what: "종료 코드 추가" });
  for (const e of a.env) if (!b.env.includes(e)) out.push({ level: "major", path: e, what: "환경 변수 제거" });
  for (const e of b.env) if (!a.env.includes(e)) out.push({ level: "minor", path: e, what: "환경 변수 추가" });
  const c = cmp3(nodeMin(b.node), nodeMin(a.node));
  if (c > 0) out.push({ level: "major", path: "engines.node", what: `${a.node} → ${b.node}` });
  else if (c < 0) out.push({ level: "minor", path: "engines.node", what: `${a.node} → ${b.node}` });
  const level: ChangeLevel = out.some((x) => x.level === "major") ? "major" : out.length ? "minor" : "none";
  return { level, changes: out };
}

export const maxLevel = (a: ChangeLevel, b: ChangeLevel): ChangeLevel => (a === "major" || b === "major" ? "major" : a === "minor" || b === "minor" ? "minor" : "none");

const semver = (v: string) => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v); if (!m) throw new Error(`SemVer 가 아님: ${v}`); return [Number(m[1]), Number(m[2]), Number(m[3])]; };

/** 기준 릴리스(base)에서 version 으로 올릴 때 계약 변경 등급(level)에 맞는 증가 폭인지. 0.x 는 MINOR 증가로 MAJOR 변경을 허용(SemVer §4) */
export function checkVersionBump(base: string, version: string, level: ChangeLevel): { ok: boolean; need: string } {
  const [bM, bm] = semver(base), [vM, vm] = semver(version);
  const up = cmp3(semver(version), semver(base)) > 0;
  if (level === "none") return { ok: true, need: "제한 없음" };
  if (level === "major") {
    if (bM === 0) return { ok: up && (vM > 0 || vm > bm), need: `${bM}.${bm + 1}.0 이상(0.x) 또는 1.0.0` };
    return { ok: vM > bM, need: `${bM + 1}.0.0 이상` };
  }
  return { ok: vM > bM || (vM === bM && vm > bm), need: `${bM}.${bm + 1}.0 이상` };
}
