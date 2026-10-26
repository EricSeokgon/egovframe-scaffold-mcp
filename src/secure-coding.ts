// 보안약점 점검 (check_egovframe_secure_coding, v0.44) — 행정안전부·KISA 소프트웨어 개발보안 가이드(2021) 구현단계 보안약점 중
// 정적 패턴으로 오탐을 통제할 수 있는 항목을 소스에서 찾는다. 규칙은 catalog/secure-coding-rules.json 데이터.
//   - 주석(Java·XML·JSP)은 줄 수를 유지한 채 공백으로 지운 뒤 찾는다(공통컴포넌트 매퍼는 "${…} 를 #{…} 로 바꿨다"는 주석이 많다)
//   - 항목마다 출처: 공통컴포넌트 원본(매니페스트 해시 일치)·수정본·매니페스트 없는 공통컴포넌트 경로·프로젝트 코드·테스트
//   - 예외 파일(.egovframe-secure-ignore.json)은 사유·검토자가 있는 항목만 적용, baseline(이전 결과 JSON·SARIF)과 비교해 새 항목 표시
//   - SARIF 2.1.0 출력(GitHub code scanning 등). 패턴 기반 진단 보조이며 공인 진단을 대체하지 않는다.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { readManifest } from "./manifest.js";
import { sha256 } from "./shared.js";
import { withFileTransaction } from "./file-transaction.js";
import { resolveOutputPath } from "./sbom.js";
import { SERVER_VERSION } from "./version.js";
import { detectWorkspace, isMultiModule, moduleOf } from "./workspace.js";
import { L, tr } from "./lang.js";
import { analyzeJavaFlows, type FlowSink, type SinkFlow } from "./java-flow.js";

export type SecureSeverity = "high" | "medium" | "low";
export type SecureTarget = "java" | "jsp" | "mapper" | "sqlmap" | "config";
export type SecureOrigin = "component" | "component-modified" | "component-unmanaged" | "project" | "test";

interface NearRule { near: string; window: number; severity?: SecureSeverity; note?: string }
export type SecureRule = {
  id: string; guideItem: string; category: string; cwe: number; severity: SecureSeverity; targets: SecureTarget[];
  pattern: string; unless?: string; fileHas?: string; fileLacks?: string; scope?: "line" | "file";
  /** JSP: 접두어가 있는 태그(<c:if test=…>·<spring:message code=…> 등)를 지운 뒤 찾는다 — 속성 안의 EL 은 출력되지 않음 */
  stripCustomTags?: boolean;
  downgrade?: NearRule; escalate?: NearRule; requireNear?: NearRule;
  /** v1.5: 메서드 안 데이터 흐름 — 위험 호출 인자가 요청 값에서 왔으면 tainted 등급, 상수만이면 constant 등급, detect 면 패턴이 놓친 흐름도 보고 */
  flow?: { sink: FlowSink; tainted?: SecureSeverity; constant?: SecureSeverity; detect?: boolean };
  message: string; fix: string;
};
export type SecureRules = {
  schemaVersion: number; surveyedAt: string; sources: { name: string; url?: string }[]; disclaimer: string;
  categories: { id: string; label: string; labelEn: string }[]; rules: SecureRule[];
};

const RULES_URL = new URL("../catalog/secure-coding-rules.json", import.meta.url);
let cachedRules: SecureRules | null = null;
export function loadSecureRules(): SecureRules {
  if (!cachedRules) cachedRules = JSON.parse(fs.readFileSync(RULES_URL, "utf8")) as SecureRules;
  return cachedRules;
}
/** 규칙 문자열 → RegExp. 앞의 `(?i)` 는 대소문자 무시 플래그로 바꾼다(JS 는 인라인 플래그 미지원). */
export function compileRulePattern(src: string, extra = ""): RegExp {
  const ci = src.startsWith("(?i)");
  return new RegExp(ci ? src.slice(4) : src, `${ci ? "i" : ""}${extra}`);
}

// ── 주석 지우기(줄 수 유지) ──────────────────────────────
const blank = (s: string) => s.replace(/[^\n]/g, " ");
/** Java: //·/* *\/ 주석을 지운다. 문자열·문자 리터럴·텍스트 블록은 그대로 둔다. */
export function stripJavaComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? n : e; out += blank(src.slice(i, end)); i = end; continue; }
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; out += blank(src.slice(i, end)); i = end; continue; }
    if (c === '"' && src.startsWith('"""', i)) { const e = src.indexOf('"""', i + 3); const end = e < 0 ? n : e + 3; out += src.slice(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, Math.min(j + 1, n)); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}
/** XML: <!-- --> 를 지운다. JSP: JSP 주석 <%-- --%> 만 지운다 — HTML 주석 <!-- --> 안의 JSTL·EL 은 서버에서 실행되어 응답에 그대로 나가므로 남긴다. */
export function stripMarkupComments(src: string, jsp = false): string {
  return jsp ? src.replace(/<%--[\s\S]*?--%>/g, blank) : src.replace(/<!--[\s\S]*?-->/g, blank);
}

// ── 대상 파일 ────────────────────────────────────────────
/** 접두어가 있는 JSP 태그(JSTL·Spring·사용자 태그) — 속성 값의 따옴표 안 `>` 도 처리 */
const CUSTOM_TAG = /<\/?[A-Za-z][\w-]*:[\w-]+(?:[^>"']|"[^"]*"|'[^']*')*\/?>/g;
const SKIP_DIRS = new Set([".git", "node_modules", "target", "build", "dist", "out", "bin", ".gradle", ".idea", ".vscode", ".settings", "migration-backup", ".egov-cache", ".corpus-cache"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
export function targetOf(rel: string, head: string): SecureTarget | null {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".java")) return "java";
  if (/\.(jsp|jspf|tag|tagx)$/.test(lower)) return "jsp";
  if (lower.endsWith(".xml")) return /<mapper[\s>]/.test(head) ? "mapper" : /<sqlMap[\s>]/.test(head) ? "sqlmap" : null;
  if (/\.(properties|ya?ml)$/.test(lower)) return /(^|\/)(message|messages|i18n)[\/_]|message[_\w]*\.properties$/.test(lower) ? null : "config";
  return null;
}
function walk(root: string, dir: string, out: string[], limit: number): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.isSymbolicLink()) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".egov")) walk(root, abs, out, limit); }
    else if (e.isFile()) out.push(path.relative(root, abs).split(path.sep).join("/"));
  }
}

/** v1.7: HTMLTagFilter 등록 위치(web.xml filter-class·WebApplicationInitializer·FilterRegistrationBean). 테스트 코드는 보지 않는다. */
export function findHtmlTagFilter(projectDir: string): string | null {
  const re = /filter-class>\s*[\w.]*HTMLTagFilter\s*<|new\s+[\w.]*HTMLTagFilter\s*\(|[\w.]*HTMLTagFilter\.class/;
  const stack = [projectDir];
  let seen = 0;
  while (stack.length && seen < 20_000) {
    const d = stack.pop()!;
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^(\.|target$|build$|node_modules$|migration-backup$|test$)/.test(e.name)) stack.push(p); continue; }
      if (!/\.(java|xml)$/.test(e.name)) continue;
      seen++;
      let t: string;
      try { t = fs.readFileSync(p, "utf8"); } catch { continue; }
      if (!t.includes("HTMLTagFilter")) continue;
      const clean = e.name.endsWith(".java") ? stripJavaComments(t) : t.replace(/<!--[\s\S]*?-->/g, "");
      if (re.test(clean)) return path.relative(projectDir, p).split(path.sep).join("/");
    }
  }
  return null;
}

// ── 결과 ─────────────────────────────────────────────────
export interface SecureFinding {
  rule: string; guideItem: string; category: string; cwe: number; severity: SecureSeverity;
  file: string; line: number; column: number; code: string; message: string; fix: string; note?: string;
  origin: SecureOrigin; component?: string;
  /** 줄 이동에 강한 지문(규칙·파일·정규화한 코드 줄·같은 줄 순번) */
  fingerprint: string;
  /** v1.5: 메서드 안 데이터 흐름 판정(흐름 규칙만). tainted 면 소스 → 위험 호출 경로 */
  flow?: { status: SinkFlow["status"]; method: string; path: { line: number; code: string; step: string }[]; detected?: boolean };
  isNew?: boolean;
}
export interface SecureIgnore { rule: string; path: string; line?: number; reason: string; reviewer: string }
export interface SecureCodingOptions {
  projectDir: string;
  rules?: string[];
  /** 프로젝트 상대 경로 접두어로 좁히기 */
  paths?: string[];
  /** 이전 결과(format=json 의 findings 또는 SARIF) — 새로 생긴 항목만 isNew */
  baselinePath?: string;
  /** SARIF 2.1.0 을 쓸 프로젝트 상대 경로 */
  sarifPath?: string;
  overwrite?: boolean;
  includeTests?: boolean;
  maxFiles?: number;
  maxFindings?: number;
  /** v1.5: 메서드 안 데이터 흐름 분석(기본 true) — false 면 v1.4 까지의 패턴 판정만 */
  dataFlow?: boolean;
}
export interface SecureCodingResult {
  projectDir: string;
  rulesVersion: { surveyedAt: string; rules: number; source: string };
  filesScanned: number;
  byTarget: Record<string, number>;
  summary: { total: number; high: number; medium: number; low: number; new: number | null; suppressed: number };
  byRule: { rule: string; guideItem: string; severity: SecureSeverity; count: number }[];
  byOrigin: Record<SecureOrigin, number>;
  /** v0.47: 멀티 모듈 작업공간이면 모듈별 건수 */
  byModule?: { module: string; high: number; medium: number; low: number; total: number }[];
  findings: SecureFinding[];
  truncated: boolean;
  suppressions: { applied: number; invalid: string[]; file: string | null };
  baseline?: { path: string; findings: number; resolved: number };
  sarif?: { path: string; written: boolean; overwritten: boolean; results: number };
  /** v1.5: 데이터 흐름 판정 집계(흐름 규칙의 항목) */
  dataFlow?: { enabled: boolean; tainted: number; constant: number; unknown: number; detected: number };
  /** v1.7: 등록된 HTMLTagFilter 위치(c:out 규칙을 볼 때만, 없으면 null) */
  htmlTagFilter?: string | null;
  notes: string[];
  disclaimer: string;
}

export const IGNORE_FILE = ".egovframe-secure-ignore.json";
const SEV_ORDER: Record<SecureSeverity, number> = { high: 0, medium: 1, low: 2 };
const globToRe = (g: string) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*")}$`);

function readIgnores(projectDir: string): { list: SecureIgnore[]; invalid: string[]; file: string | null } {
  const p = path.join(projectDir, IGNORE_FILE);
  if (!fs.existsSync(p)) return { list: [], invalid: [], file: null };
  let doc: { ignores?: unknown };
  try { doc = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { throw new Error(L(`${IGNORE_FILE} JSON 해석 실패: ${e instanceof Error ? e.message : String(e)}`, `${IGNORE_FILE}: failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`)); }
  const list: SecureIgnore[] = [], invalid: string[] = [];
  for (const [i, raw] of (Array.isArray(doc.ignores) ? doc.ignores : []).entries()) {
    const it = raw as Partial<SecureIgnore>;
    if (!it || typeof it.rule !== "string" || typeof it.path !== "string") { invalid.push(L(`#${i + 1}: rule·path 필요`, `#${i + 1}: rule and path are required`)); continue; }
    if (typeof it.reason !== "string" || it.reason.trim().length < 5) { invalid.push(L(`#${i + 1} ${it.rule} ${it.path}: 사유(reason, 5자 이상)가 없어 적용하지 않음`, `#${i + 1} ${it.rule} ${it.path}: not applied — reason (at least 5 characters) is missing`)); continue; }
    if (typeof it.reviewer !== "string" || !it.reviewer.trim()) { invalid.push(L(`#${i + 1} ${it.rule} ${it.path}: 검토자(reviewer)가 없어 적용하지 않음`, `#${i + 1} ${it.rule} ${it.path}: not applied — reviewer is missing`)); continue; }
    list.push({ rule: it.rule, path: it.path, ...(typeof it.line === "number" ? { line: it.line } : {}), reason: it.reason, reviewer: it.reviewer });
  }
  return { list, invalid, file: IGNORE_FILE };
}

/** 공용 경로 검증 오류의 'outputPath' 를 실제 파라미터 이름으로 바꾼다. */
function relabel<T>(name: string, fn: () => T): T {
  try { return fn(); } catch (e) { throw new Error((e instanceof Error ? e.message : String(e)).replace(/outputPath/g, name)); }
}
function readBaseline(projectDir: string, rel: string): { relPath: string; fingerprints: Set<string> } {
  const { relPath, absolutePath } = relabel("baselinePath", () => resolveOutputPath(projectDir, rel));
  if (!fs.existsSync(absolutePath)) throw new Error(L(`baseline 이 없습니다: ${relPath}`, `baseline not found: ${relPath}`));
  let doc: { findings?: { fingerprint?: string }[]; runs?: { results?: { partialFingerprints?: Record<string, string> }[] }[] };
  try { doc = JSON.parse(fs.readFileSync(absolutePath, "utf8")); } catch (e) { throw new Error(L(`baseline(${relPath}) JSON 해석 실패: ${e instanceof Error ? e.message : String(e)}`, `baseline (${relPath}): failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`)); }
  const fps = new Set<string>();
  if (Array.isArray(doc.findings)) for (const f of doc.findings) if (f.fingerprint) fps.add(f.fingerprint);
  if (Array.isArray(doc.runs)) for (const r of doc.runs) for (const x of r.results ?? []) { const fp = x.partialFingerprints?.["egovframe/v1"]; if (fp) fps.add(fp); }
  if (!Array.isArray(doc.findings) && !Array.isArray(doc.runs)) throw new Error(L(`baseline(${relPath}) 이 이 도구의 JSON 결과나 SARIF 가 아닙니다`, `baseline (${relPath}) is neither this tool's JSON result nor SARIF`));
  return { relPath, fingerprints: fps };
}

/** 프로젝트 코드에서 보안약점 패턴을 찾는다(읽기 전용, sarifPath 가 있을 때만 그 파일을 쓴다). */
export async function checkSecureCoding(opts: SecureCodingOptions): Promise<SecureCodingResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const all = loadSecureRules();
  const unknown = (opts.rules ?? []).filter((r) => !all.rules.some((x) => x.id === r));
  if (unknown.length) throw new Error(L(`알 수 없는 규칙: ${unknown.join(", ")} (사용 가능: ${all.rules.map((r) => r.id).join(", ")})`, `Unknown rule: ${unknown.join(", ")} (available: ${all.rules.map((r) => r.id).join(", ")})`));
  const rules = opts.rules?.length ? all.rules.filter((r) => opts.rules!.includes(r.id)) : all.rules;
  const compiled = rules.map((r) => ({
    r, re: compileRulePattern(r.pattern, r.scope === "file" ? "g" : ""), unless: r.unless ? compileRulePattern(r.unless) : null,
    fileHas: r.fileHas ? compileRulePattern(r.fileHas) : null, fileLacks: r.fileLacks ? compileRulePattern(r.fileLacks) : null,
    down: r.downgrade ? { ...r.downgrade, re: compileRulePattern(r.downgrade.near) } : null,
    up: r.escalate ? { ...r.escalate, re: compileRulePattern(r.escalate.near) } : null,
    req: r.requireNear ? { ...r.requireNear, re: compileRulePattern(r.requireNear.near) } : null,
  }));
  const notes: string[] = [];
  const maxFiles = opts.maxFiles ?? 50_000;
  const files: string[] = [];
  walk(projectDir, projectDir, files, maxFiles + 1);
  if (files.length > maxFiles) { files.length = maxFiles; notes.push(L(`파일이 ${maxFiles}개를 넘어 앞의 ${maxFiles}개만 봤습니다(maxFiles).`, `More than ${maxFiles} files — only the first ${maxFiles} were scanned (maxFiles).`)); }
  const prefixes = (opts.paths ?? []).map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""));

  // 출처: 매니페스트(파일 → 컴포넌트·해시)
  const manifest = (() => { try { return readManifest(projectDir); } catch { return null; } })();
  const owned = new Map<string, { component: string; hash?: string }>();
  for (const [id, e] of Object.entries(manifest?.components ?? {})) for (const f of e.files) owned.set(f, { component: id, hash: e.hashes?.[f]?.hash });
  const originOf = (rel: string, buf: Buffer): { origin: SecureOrigin; component?: string } => {
    if (/(^|\/)src\/test\//.test(rel)) return { origin: "test" };
    const o = owned.get(rel);
    if (o) return { origin: o.hash && o.hash !== sha256(buf) ? "component-modified" : "component", component: o.component };
    if (/(^|\/)egovframework\/com\//.test(rel)) return { origin: "component-unmanaged" };
    return { origin: "project" };
  };

  // v1.7: HTMLTagFilter(요청 값을 엔티티로 바꿔 저장)가 등록돼 있으면 c:out escapeXml="false" 는 두 번 escape 를 피하려는 설계 — 등급을 낮추고 사유를 적는다
  const tagFilter = rules.some((r) => r.id === "xss-cout-unescaped") ? findHtmlTagFilter(projectDir) : null;
  const byTarget: Record<string, number> = {};
  const raw: SecureFinding[] = [];
  let scanned = 0;
  for (const rel of files) {
    if (prefixes.length && !prefixes.some((p) => rel.startsWith(p))) continue;
    const isTest = /(^|\/)src\/test\//.test(rel);
    if (isTest && opts.includeTests === false) continue;
    const abs = path.join(projectDir, rel);
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { continue; }
    if (st.size > MAX_FILE_BYTES) continue;
    const lower = rel.toLowerCase();
    if (!/\.(java|jsp|jspf|tag|tagx|xml|properties|ya?ml)$/.test(lower)) continue;
    const buf = fs.readFileSync(abs);
    const text = buf.toString("utf8");
    const target = targetOf(rel, text.slice(0, 4096));
    if (!target) continue;
    const mine = compiled.filter((c) => c.r.targets.includes(target));
    if (!mine.length) continue;
    scanned++;
    byTarget[target] = (byTarget[target] ?? 0) + 1;
    const clean = target === "java" ? stripJavaComments(text) : target === "jsp" ? stripMarkupComments(text, true) : target === "mapper" || target === "sqlmap" ? stripMarkupComments(text) : text.replace(/^\s*[#!].*$/gm, blank);
    const lines = clean.split("\n");
    const origLines = text.split("\n");
    const { origin, component } = originOf(rel, buf);
    // v1.5: 흐름 규칙이 있는 Java 파일만 한 번 분석
    let flows: SinkFlow[] | null = null;
    const flowsOf = () => (flows ??= analyzeJavaFlows(clean));
    const near = (i: number, re: RegExp, w: number) => { for (let k = Math.max(0, i - w); k <= Math.min(lines.length - 1, i + w); k++) if (re.test(lines[k])) return true; return false; };
    for (const c of mine) {
      if (c.fileHas && !c.fileHas.test(clean)) continue;
      if (c.fileLacks && c.fileLacks.test(clean)) continue;
      const hits: { line: number; col: number }[] = [];
      if (c.r.scope === "file") {
        c.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = c.re.exec(clean))) { const before = clean.slice(0, m.index); const ln = before.split("\n").length - 1; hits.push({ line: ln, col: m.index - before.lastIndexOf("\n") }); if (m[0].length === 0) c.re.lastIndex++; }
      } else {
        lines.forEach((raw, i) => { const l = c.r.stripCustomTags ? raw.replace(CUSTOM_TAG, (t) => " ".repeat(t.length)) : raw; const m = c.re.exec(l); if (m && !(c.unless && c.unless.test(l))) hits.push({ line: i, col: m.index + 1 }); });
      }
      const seen = new Map<string, number>();
      const flowRule = target === "java" && opts.dataFlow !== false ? c.r.flow : undefined;
      const flowAt = (line1: number): SinkFlow | undefined => flowsOf().find((f) => f.sink === flowRule!.sink && f.line === line1) ?? flowsOf().find((f) => f.sink === flowRule!.sink && f.line > line1 && f.line <= line1 + 2);
      const usedFlows = new Set<SinkFlow>();
      const push = (h: { line: number; col: number }, severity: SecureSeverity, note: string | undefined, flow?: SecureFinding["flow"]) => {
        if (isTest) { severity = "low"; note = [note, L("테스트 코드 — 등급을 낮춤", "test code — severity lowered")].filter(Boolean).join(" · "); }
        if (tagFilter && c.r.id === "xss-cout-unescaped") { severity = "low"; note = [note, L(`HTMLTagFilter(${tagFilter})가 요청 값을 엔티티로 바꿔 저장 — 필터가 덮지 않는 경로(URL 패턴 밖·REST·배치·DB 직접 입력)로 들어온 값만 위험`, `HTMLTagFilter (${tagFilter}) stores request values as entities — only values entering outside the filter (other URL patterns, REST, batch, direct DB input) are at risk`)].filter(Boolean).join(" · "); }
        const code = (origLines[h.line] ?? "").trim().slice(0, 240);
        const key = `${c.r.id}|${rel}|${code.replace(/\s+/g, " ")}`;
        const nth = (seen.get(key) ?? 0) + 1; seen.set(key, nth);
        const fingerprint = createHash("sha256").update(`${key}|${nth}`).digest("hex").slice(0, 32);
        raw.push({ rule: c.r.id, guideItem: tr(c.r, "guideItem"), category: tr(c.r, "category"), cwe: c.r.cwe, severity, file: rel, line: h.line + 1, column: h.col, code, message: tr(c.r, "message"), fix: tr(c.r, "fix"), ...(note ? { note } : {}), origin, ...(component ? { component } : {}), fingerprint, ...(flow ? { flow } : {}) });
      };
      const pathText = (f: SinkFlow) => f.path.map((p) => `L${p.line} ${p.step}`).join(" → ");
      for (const h of hits) {
        if (c.req && !near(h.line, c.req.re, c.req.window)) continue;
        let severity = c.r.severity;
        let note: string | undefined;
        if (c.up && near(h.line, c.up.re, c.up.window)) { severity = c.up.severity ?? severity; note = c.up.note ? tr(c.up, "note") : undefined; }
        else if (c.down && near(h.line, c.down.re, c.down.window)) { severity = c.down.severity ?? severity; note = c.down.note ? tr(c.down, "note") : undefined; }
        let flow: SecureFinding["flow"];
        const f = flowRule ? flowAt(h.line + 1) : undefined;
        if (f) {
          usedFlows.add(f);
          flow = { status: f.status, method: f.method, path: f.path };
          if (f.status === "tainted" && flowRule!.tainted) { severity = flowRule!.tainted; note = L(`데이터 흐름 확인(${f.method}): ${pathText(f)}`, `data flow confirmed (${f.method}): ${pathText(f)}`); }
          else if (f.status === "constant" && flowRule!.constant) { severity = flowRule!.constant; note = L(`상수만 결합 — 메서드 안에서 외부 입력이 들어가지 않음(${f.method})`, `constants only — no external input reaches it inside the method (${f.method})`); }
        }
        push(h, severity, note, flow);
      }
      // v1.5: 패턴이 놓친 흐름(변수를 거쳐 들어온 요청 값)
      if (flowRule?.detect) for (const f of flowsOf()) {
        if (f.sink !== flowRule.sink || f.status !== "tainted" || usedFlows.has(f) || hits.some((h) => h.line + 1 === f.line)) continue;
        push({ line: f.line - 1, col: f.column }, flowRule.tainted ?? c.r.severity, L(`데이터 흐름으로 찾음(${f.method}) — 변수를 거쳐 들어온 요청 값: ${pathText(f)}`, `found by data flow (${f.method}) — request value passed through variables: ${pathText(f)}`), { status: f.status, method: f.method, path: f.path, detected: true });
      }
    }
  }

  // 예외
  const ign = readIgnores(projectDir);
  const ignRes = ign.list.map((x) => ({ ...x, re: globToRe(x.path.replace(/\\/g, "/")) }));
  let suppressed = 0;
  const kept = raw.filter((f) => { const hit = ignRes.some((x) => (x.rule === f.rule || x.rule === "*") && x.re.test(f.file) && (x.line === undefined || x.line === f.line)); if (hit) suppressed++; return !hit; });
  if (ign.invalid.length) notes.push(L(`${IGNORE_FILE} 의 항목 ${ign.invalid.length}건은 사유·검토자가 없어 적용하지 않았습니다.`, `${ign.invalid.length} entries in ${IGNORE_FILE} were not applied because reason or reviewer is missing.`));

  // baseline
  let baseline: SecureCodingResult["baseline"];
  if (opts.baselinePath) {
    const b = readBaseline(projectDir, opts.baselinePath);
    for (const f of kept) f.isNew = !b.fingerprints.has(f.fingerprint);
    const now = new Set(kept.map((f) => f.fingerprint));
    baseline = { path: b.relPath, findings: b.fingerprints.size, resolved: [...b.fingerprints].filter((x) => !now.has(x)).length };
  }

  kept.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  const count = (s: SecureSeverity) => kept.filter((f) => f.severity === s).length;
  const byRuleMap = new Map<string, SecureCodingResult["byRule"][number]>();
  for (const f of kept) {
    const r = byRuleMap.get(f.rule) ?? { rule: f.rule, guideItem: f.guideItem, severity: rules.find((x) => x.id === f.rule)!.severity, count: 0 };
    r.count++; byRuleMap.set(f.rule, r);
  }
  const byOrigin: Record<SecureOrigin, number> = { component: 0, "component-modified": 0, "component-unmanaged": 0, project: 0, test: 0 };
  for (const f of kept) byOrigin[f.origin]++;
  if (byOrigin.component) notes.push(L(`공통컴포넌트 원본(매니페스트 해시 일치) ${byOrigin.component}건 — upstream 에도 있는 패턴입니다. 공통컴포넌트 업그레이드로 해결되는지 확인하고, 아니면 사유를 남겨 예외 처리하거나 upstream 에 보고하세요.`, `${byOrigin.component} findings in original common components (manifest hash matches) — the pattern also exists upstream. Check whether a common-component upgrade resolves it; otherwise suppress it with a documented reason or report it upstream.`));
  if (byOrigin["component-unmanaged"]) notes.push(L(`매니페스트 없는 공통컴포넌트 경로(egovframework/com) ${byOrigin["component-unmanaged"]}건 — 원본 그대로인지 알 수 없습니다. reassemble_egovframe_components 로 재조립하면 원본·수정본이 구분됩니다.`, `${byOrigin["component-unmanaged"]} findings in unmanaged common-component paths (egovframework/com, no manifest) — cannot tell whether they are unmodified. Reassembling with reassemble_egovframe_components distinguishes original from modified files.`));

  const coutLow = tagFilter ? kept.filter((f) => f.rule === "xss-cout-unescaped").length : 0;
  if (coutLow) notes.push(L(`HTMLTagFilter 가 등록돼 있어(${tagFilter}) c:out escapeXml="false" ${coutLow}건을 낮음으로 봤습니다 — 요청 값이 엔티티로 저장되므로 escape 하면 두 번 바뀝니다. 필터가 덮지 않는 입력 경로가 있는지 확인하세요.`, `HTMLTagFilter is registered (${tagFilter}), so ${coutLow} c:out escapeXml="false" findings are rated low — request values are stored as entities and escaping again would double them. Check for input paths the filter does not cover.`));
  const maxFindings = opts.maxFindings ?? 2000;
  const ws = detectWorkspace(projectDir);
  const byModule = isMultiModule(ws) && ws.kind !== "single" ? ws.modules.map((m) => {
    const mine = kept.filter((f) => moduleOf(ws, f.file)?.name === m.name);
    return { module: m.dir, high: mine.filter((f) => f.severity === "high").length, medium: mine.filter((f) => f.severity === "medium").length, low: mine.filter((f) => f.severity === "low").length, total: mine.length };
  }) : undefined;
  const result: SecureCodingResult = {
    projectDir,
    rulesVersion: { surveyedAt: all.surveyedAt, rules: rules.length, source: all.sources[0] ? tr(all.sources[0], "name") : "" },
    filesScanned: scanned, byTarget,
    summary: { total: kept.length, high: count("high"), medium: count("medium"), low: count("low"), new: baseline ? kept.filter((f) => f.isNew).length : null, suppressed },
    byRule: [...byRuleMap.values()].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.count - a.count || a.rule.localeCompare(b.rule)),
    byOrigin,
    ...(byModule ? { byModule } : {}),
    findings: kept.slice(0, maxFindings),
    truncated: kept.length > maxFindings,
    suppressions: { applied: suppressed, invalid: ign.invalid, file: ign.file },
    ...(baseline ? { baseline } : {}),
    ...(rules.some((r) => r.id === "xss-cout-unescaped") ? { htmlTagFilter: tagFilter } : {}),
    dataFlow: { enabled: opts.dataFlow !== false, tainted: kept.filter((f) => f.flow?.status === "tainted").length, constant: kept.filter((f) => f.flow?.status === "constant").length, unknown: kept.filter((f) => f.flow?.status === "unknown").length, detected: kept.filter((f) => f.flow?.detected).length },
    notes, disclaimer: tr(all, "disclaimer"),
  };

  if (opts.sarifPath) {
    const { relPath, absolutePath } = relabel("sarifPath", () => resolveOutputPath(projectDir, opts.sarifPath!));
    const exists = fs.existsSync(absolutePath);
    if (exists && !opts.overwrite) throw new Error(L(`${relPath} 이 이미 있습니다. 덮어쓰려면 overwrite=true 를 쓰세요.`, `${relPath} already exists. Use overwrite=true to replace it.`));
    const sarif = toSarif({ ...result, findings: kept }, rules);
    await withFileTransaction(projectDir, L("SARIF 기록", "SARIF write"), (tx) => { tx.writeFile(relPath, `${JSON.stringify(sarif, null, 2)}\n`, { mustNotExist: !exists }); });
    result.sarif = { path: relPath, written: true, overwritten: exists, results: kept.length };
  }
  return result;
}

// ── SARIF 2.1.0 ──────────────────────────────────────────
const SARIF_LEVEL: Record<SecureSeverity, "error" | "warning" | "note"> = { high: "error", medium: "warning", low: "note" };
const SECURITY_SEVERITY: Record<SecureSeverity, string> = { high: "8.0", medium: "5.0", low: "2.0" };
export function toSarif(r: Pick<SecureCodingResult, "findings">, rules: SecureRule[] = loadSecureRules().rules): Record<string, unknown> {
  const cat = new Map(loadSecureRules().categories.map((c) => [c.id, c]));
  const used = rules;
  const index = new Map(used.map((x, i) => [x.id, i]));
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: "egovframe-scaffold-mcp", version: SERVER_VERSION, semanticVersion: SERVER_VERSION,
          informationUri: "https://github.com/EricSeokgon/egovframe-scaffold-mcp",
          rules: used.map((x) => ({
            id: x.id, name: x.id.replace(/(^|-)(\w)/g, (_, _d, ch: string) => ch.toUpperCase()),
            shortDescription: { text: `${tr(x, "guideItem")}: ${tr(x, "message")}` },
            fullDescription: { text: L(`${tr(x, "message")}. 조치: ${tr(x, "fix")}`, `${tr(x, "message")}. Fix: ${tr(x, "fix")}`) },
            help: { text: tr(x, "fix"), markdown: L(`**${tr(x, "guideItem")}** (${cat.get(x.category)?.label ?? x.category}, CWE-${x.cwe})\n\n${tr(x, "message")}\n\n조치: ${tr(x, "fix")}`, `**${tr(x, "guideItem")}** (${cat.get(x.category)?.labelEn ?? x.category}, CWE-${x.cwe})\n\n${tr(x, "message")}\n\nFix: ${tr(x, "fix")}`) },
            defaultConfiguration: { level: SARIF_LEVEL[x.severity] },
            properties: { tags: ["security", `external/cwe/cwe-${x.cwe}`, `egovframe/${x.category}`], "security-severity": SECURITY_SEVERITY[x.severity], precision: "medium", guideItem: tr(x, "guideItem") },
            relationships: [{ target: { id: String(x.cwe), toolComponent: { name: "CWE" } }, kinds: ["relevant"] }],
          })),
        },
      },
      taxonomies: [{ name: "CWE", organization: "MITRE", informationUri: "https://cwe.mitre.org/", isComprehensive: false, taxa: [...new Set(used.map((x) => x.cwe))].sort((a, b) => a - b).map((c) => ({ id: String(c) })) }],
      results: r.findings.map((f) => ({
        ruleId: f.rule, ruleIndex: index.get(f.rule) ?? 0, level: SARIF_LEVEL[f.severity],
        message: { text: `${f.guideItem}: ${f.message}${f.note ? ` (${f.note})` : ""}` },
        locations: [{ physicalLocation: { artifactLocation: { uri: f.file, uriBaseId: "%SRCROOT%" }, region: { startLine: f.line, startColumn: Math.max(1, f.column), snippet: { text: f.code } } } }],
        partialFingerprints: { "egovframe/v1": f.fingerprint },
        // v1.5: 메서드 안 데이터 흐름(소스 → 위험 호출) — GitHub code scanning 이 경로로 보여 준다
        ...(f.flow?.status === "tainted" && f.flow.path.length ? { codeFlows: [{ message: { text: f.flow.method }, threadFlows: [{ locations: f.flow.path.map((p) => ({ location: { physicalLocation: { artifactLocation: { uri: f.file, uriBaseId: "%SRCROOT%" }, region: { startLine: p.line, snippet: { text: p.code } } }, message: { text: p.step } } })) }] }] } : {}),
        properties: { origin: f.origin, ...(f.component ? { component: f.component } : {}), severity: f.severity, ...(f.isNew !== undefined ? { isNew: f.isNew } : {}), ...(f.flow ? { dataFlow: f.flow.status, ...(f.flow.detected ? { detectedByFlow: true } : {}) } : {}) },
      })),
      originalUriBaseIds: { "%SRCROOT%": { description: { text: L("프로젝트 루트", "project root") } } },
    }],
  };
}

const ORIGIN_KO: Record<SecureOrigin, string> = { component: "공통컴포넌트 원본", "component-modified": "공통컴포넌트 수정본", "component-unmanaged": "공통컴포넌트(매니페스트 없음)", project: "프로젝트 코드", test: "테스트" };
const ORIGIN_EN: Record<SecureOrigin, string> = { component: "original", "component-modified": "modified", "component-unmanaged": "unmanaged", project: "project", test: "test" };
const SEV_KO: Record<SecureSeverity, string> = { high: "높음", medium: "중간", low: "낮음" };
const SEV_EN: Record<SecureSeverity, string> = { high: "high", medium: "medium", low: "low" };
const originLabel = (o: SecureOrigin) => L(ORIGIN_KO[o], ORIGIN_EN[o]);
const sevLabel = (s: SecureSeverity) => L(SEV_KO[s], SEV_EN[s]);

/** 결과 Markdown. */
export function renderSecureCodingMarkdown(r: SecureCodingResult, top = 40): string {
  const out: string[] = [];
  const s = r.summary;
  out.push(L(`# 보안약점 점검 (${r.projectDir})`, `# Secure coding weakness scan (${r.projectDir})`), ``);
  out.push(L(`- 기준: ${r.rulesVersion.source} — 규칙 ${r.rulesVersion.rules}종(${r.rulesVersion.surveyedAt})`, `- Basis: ${r.rulesVersion.source} — ${r.rulesVersion.rules} rules (${r.rulesVersion.surveyedAt})`));
  out.push(L(`- 파일 ${r.filesScanned}개(${Object.entries(r.byTarget).map(([k, n]) => `${k} ${n}`).join(" · ") || "없음"})`, `- ${r.filesScanned} files (${Object.entries(r.byTarget).map(([k, n]) => `${k} ${n}`).join(" · ") || "none"})`));
  out.push(L(`- **높음 ${s.high} · 중간 ${s.medium} · 낮음 ${s.low}** (합계 ${s.total}${s.new !== null ? ` · 새로 생김 ${s.new}` : ""}${s.suppressed ? ` · 예외 처리 ${s.suppressed}` : ""})`, `- **high ${s.high} · medium ${s.medium} · low ${s.low}** (total ${s.total}${s.new !== null ? ` · new ${s.new}` : ""}${s.suppressed ? ` · suppressed ${s.suppressed}` : ""})`));
  const o = Object.entries(r.byOrigin).filter(([, n]) => n);
  if (o.length) out.push(L(`- 출처: ${o.map(([k, n]) => `${originLabel(k as SecureOrigin)} ${n}`).join(" · ")}`, `- Origin: ${o.map(([k, n]) => `${originLabel(k as SecureOrigin)} ${n}`).join(" · ")}`));
  const df = r.dataFlow;
  if (df?.enabled && df.tainted + df.constant + df.detected > 0) out.push(L(`- 데이터 흐름(메서드 안): 요청 값 확인 ${df.tainted}건${df.detected ? `(그중 패턴 밖에서 찾음 ${df.detected})` : ""} · 상수만 ${df.constant}건 · 판단 불가 ${df.unknown}건`, `- Data flow (intra-method): request value confirmed ${df.tainted}${df.detected ? ` (${df.detected} found beyond the patterns)` : ""} · constants only ${df.constant} · undetermined ${df.unknown}`));
  if (r.baseline) out.push(L(`- 비교: ${r.baseline.path}(이전 ${r.baseline.findings}건) — 해결 ${r.baseline.resolved}건`, `- Baseline: ${r.baseline.path} (${r.baseline.findings} previous findings) — ${r.baseline.resolved} resolved`));
  if (r.sarif) out.push(L(`- SARIF: ${r.sarif.path}(결과 ${r.sarif.results}건${r.sarif.overwritten ? ", 덮어씀" : ""})`, `- SARIF: ${r.sarif.path} (${r.sarif.results} results${r.sarif.overwritten ? ", overwritten" : ""})`));
  if (r.byModule?.length) {
    out.push(``, L(`## 모듈별`, `## By module`), ``, L(`| 모듈 | 높음 | 중간 | 낮음 | 합계 |`, `| Module | High | Medium | Low | Total |`), `|---|---|---|---|---|`);
    for (const m of r.byModule) out.push(`| ${m.module} | ${m.high} | ${m.medium} | ${m.low} | ${m.total} |`);
  }
  if (r.byRule.length) {
    out.push(``, L(`## 항목별`, `## By item`), ``, L(`| 보안약점(가이드 항목) | 규칙 | 기본 등급 | 건수 |`, `| Weakness (guide item) | Rule | Default severity | Count |`), `|---|---|---|---|`);
    for (const b of r.byRule) out.push(`| ${b.guideItem} | \`${b.rule}\` | ${sevLabel(b.severity)} | ${b.count} |`);
  }
  if (r.findings.length) {
    out.push(``, L(`## 상세 (등급순 상위 ${Math.min(top, r.findings.length)}건)`, `## Details (top ${Math.min(top, r.findings.length)} by severity)`), ``);
    for (const f of r.findings.slice(0, top)) {
      out.push(`- [${sevLabel(f.severity)}] ${f.guideItem} — \`${f.file}:${f.line}\`${f.isNew ? " 🆕" : ""} (${originLabel(f.origin)}${f.component ? ` ${f.component}` : ""})`);
      out.push(`  - \`${f.code.replace(/`/g, "'")}\``);
      out.push(L(`  - ${f.message}${f.note ? ` — ${f.note}` : ""}. 조치: ${f.fix}`, `  - ${f.message}${f.note ? ` — ${f.note}` : ""}. Fix: ${f.fix}`));
    }
    if (r.findings.length > top) out.push(``, L(`… 외 ${r.findings.length - top}건 — format=json 또는 sarifPath 로 전체를 받으세요.`, `… and ${r.findings.length - top} more — use format=json or sarifPath for the full list.`));
  } else out.push(``, L(`찾은 보안약점 패턴이 없습니다.`, `No weakness patterns found.`));
  if (r.suppressions.invalid.length) { out.push(``, L(`### 적용하지 않은 예외(${IGNORE_FILE})`, `### Suppressions not applied (${IGNORE_FILE})`)); for (const x of r.suppressions.invalid) out.push(`- ${x}`); }
  for (const n of r.notes) out.push(`- ${n}`);
  out.push(``, `---`, r.disclaimer, L(`예외는 ${IGNORE_FILE} 에 {"ignores":[{"rule":"규칙 id","path":"경로(glob)","line":선택,"reason":"사유","reviewer":"검토자"}]} 로 남깁니다(사유·검토자가 없으면 적용하지 않음).`, `Record suppressions in ${IGNORE_FILE} as {"ignores":[{"rule":"rule id","path":"path (glob)","line":optional,"reason":"reason","reviewer":"reviewer"}]} (entries without reason and reviewer are not applied).`));
  return out.join("\n");
}
