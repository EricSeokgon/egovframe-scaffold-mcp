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

export type SecureSeverity = "high" | "medium" | "low";
export type SecureTarget = "java" | "jsp" | "mapper" | "sqlmap" | "config";
export type SecureOrigin = "component" | "component-modified" | "component-unmanaged" | "project" | "test";

interface NearRule { near: string; window: number; severity?: SecureSeverity; note?: string }
export interface SecureRule {
  id: string; guideItem: string; category: string; cwe: number; severity: SecureSeverity; targets: SecureTarget[];
  pattern: string; unless?: string; fileHas?: string; fileLacks?: string; scope?: "line" | "file";
  /** JSP: 접두어가 있는 태그(<c:if test=…>·<spring:message code=…> 등)를 지운 뒤 찾는다 — 속성 안의 EL 은 출력되지 않음 */
  stripCustomTags?: boolean;
  downgrade?: NearRule; escalate?: NearRule; requireNear?: NearRule;
  message: string; fix: string;
}
export interface SecureRules {
  schemaVersion: number; surveyedAt: string; sources: { name: string; url?: string }[]; disclaimer: string;
  categories: { id: string; label: string; labelEn: string }[]; rules: SecureRule[];
}

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

// ── 결과 ─────────────────────────────────────────────────
export interface SecureFinding {
  rule: string; guideItem: string; category: string; cwe: number; severity: SecureSeverity;
  file: string; line: number; column: number; code: string; message: string; fix: string; note?: string;
  origin: SecureOrigin; component?: string;
  /** 줄 이동에 강한 지문(규칙·파일·정규화한 코드 줄·같은 줄 순번) */
  fingerprint: string;
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
  try { doc = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { throw new Error(`${IGNORE_FILE} JSON 해석 실패: ${e instanceof Error ? e.message : String(e)}`); }
  const list: SecureIgnore[] = [], invalid: string[] = [];
  for (const [i, raw] of (Array.isArray(doc.ignores) ? doc.ignores : []).entries()) {
    const it = raw as Partial<SecureIgnore>;
    if (!it || typeof it.rule !== "string" || typeof it.path !== "string") { invalid.push(`#${i + 1}: rule·path 필요`); continue; }
    if (typeof it.reason !== "string" || it.reason.trim().length < 5) { invalid.push(`#${i + 1} ${it.rule} ${it.path}: 사유(reason, 5자 이상)가 없어 적용하지 않음`); continue; }
    if (typeof it.reviewer !== "string" || !it.reviewer.trim()) { invalid.push(`#${i + 1} ${it.rule} ${it.path}: 검토자(reviewer)가 없어 적용하지 않음`); continue; }
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
  if (!fs.existsSync(absolutePath)) throw new Error(`baseline 이 없습니다: ${relPath}`);
  let doc: { findings?: { fingerprint?: string }[]; runs?: { results?: { partialFingerprints?: Record<string, string> }[] }[] };
  try { doc = JSON.parse(fs.readFileSync(absolutePath, "utf8")); } catch (e) { throw new Error(`baseline(${relPath}) JSON 해석 실패: ${e instanceof Error ? e.message : String(e)}`); }
  const fps = new Set<string>();
  if (Array.isArray(doc.findings)) for (const f of doc.findings) if (f.fingerprint) fps.add(f.fingerprint);
  if (Array.isArray(doc.runs)) for (const r of doc.runs) for (const x of r.results ?? []) { const fp = x.partialFingerprints?.["egovframe/v1"]; if (fp) fps.add(fp); }
  if (!Array.isArray(doc.findings) && !Array.isArray(doc.runs)) throw new Error(`baseline(${relPath}) 이 이 도구의 JSON 결과나 SARIF 가 아닙니다`);
  return { relPath, fingerprints: fps };
}

/** 프로젝트 코드에서 보안약점 패턴을 찾는다(읽기 전용, sarifPath 가 있을 때만 그 파일을 쓴다). */
export async function checkSecureCoding(opts: SecureCodingOptions): Promise<SecureCodingResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const all = loadSecureRules();
  const unknown = (opts.rules ?? []).filter((r) => !all.rules.some((x) => x.id === r));
  if (unknown.length) throw new Error(`알 수 없는 규칙: ${unknown.join(", ")} (사용 가능: ${all.rules.map((r) => r.id).join(", ")})`);
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
  if (files.length > maxFiles) { files.length = maxFiles; notes.push(`파일이 ${maxFiles}개를 넘어 앞의 ${maxFiles}개만 봤습니다(maxFiles).`); }
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
      for (const h of hits) {
        if (c.req && !near(h.line, c.req.re, c.req.window)) continue;
        let severity = c.r.severity;
        let note: string | undefined;
        if (c.up && near(h.line, c.up.re, c.up.window)) { severity = c.up.severity ?? severity; note = c.up.note; }
        else if (c.down && near(h.line, c.down.re, c.down.window)) { severity = c.down.severity ?? severity; note = c.down.note; }
        if (isTest) { severity = "low"; note = [note, "테스트 코드 — 등급을 낮춤"].filter(Boolean).join(" · "); }
        const code = (origLines[h.line] ?? "").trim().slice(0, 240);
        const key = `${c.r.id}|${rel}|${code.replace(/\s+/g, " ")}`;
        const nth = (seen.get(key) ?? 0) + 1; seen.set(key, nth);
        const fingerprint = createHash("sha256").update(`${key}|${nth}`).digest("hex").slice(0, 32);
        raw.push({ rule: c.r.id, guideItem: c.r.guideItem, category: c.r.category, cwe: c.r.cwe, severity, file: rel, line: h.line + 1, column: h.col, code, message: c.r.message, fix: c.r.fix, ...(note ? { note } : {}), origin, ...(component ? { component } : {}), fingerprint });
      }
    }
  }

  // 예외
  const ign = readIgnores(projectDir);
  const ignRes = ign.list.map((x) => ({ ...x, re: globToRe(x.path.replace(/\\/g, "/")) }));
  let suppressed = 0;
  const kept = raw.filter((f) => { const hit = ignRes.some((x) => (x.rule === f.rule || x.rule === "*") && x.re.test(f.file) && (x.line === undefined || x.line === f.line)); if (hit) suppressed++; return !hit; });
  if (ign.invalid.length) notes.push(`${IGNORE_FILE} 의 항목 ${ign.invalid.length}건은 사유·검토자가 없어 적용하지 않았습니다.`);

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
  if (byOrigin.component) notes.push(`공통컴포넌트 원본(매니페스트 해시 일치) ${byOrigin.component}건 — upstream 에도 있는 패턴입니다. 공통컴포넌트 업그레이드로 해결되는지 확인하고, 아니면 사유를 남겨 예외 처리하거나 upstream 에 보고하세요.`);
  if (byOrigin["component-unmanaged"]) notes.push(`매니페스트 없는 공통컴포넌트 경로(egovframework/com) ${byOrigin["component-unmanaged"]}건 — 원본 그대로인지 알 수 없습니다. reassemble_egovframe_components 로 재조립하면 원본·수정본이 구분됩니다.`);

  const maxFindings = opts.maxFindings ?? 2000;
  const ws = detectWorkspace(projectDir);
  const byModule = isMultiModule(ws) && ws.kind !== "single" ? ws.modules.map((m) => {
    const mine = kept.filter((f) => moduleOf(ws, f.file)?.name === m.name);
    return { module: m.dir, high: mine.filter((f) => f.severity === "high").length, medium: mine.filter((f) => f.severity === "medium").length, low: mine.filter((f) => f.severity === "low").length, total: mine.length };
  }) : undefined;
  const result: SecureCodingResult = {
    projectDir,
    rulesVersion: { surveyedAt: all.surveyedAt, rules: rules.length, source: all.sources[0]?.name ?? "" },
    filesScanned: scanned, byTarget,
    summary: { total: kept.length, high: count("high"), medium: count("medium"), low: count("low"), new: baseline ? kept.filter((f) => f.isNew).length : null, suppressed },
    byRule: [...byRuleMap.values()].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.count - a.count || a.rule.localeCompare(b.rule)),
    byOrigin,
    ...(byModule ? { byModule } : {}),
    findings: kept.slice(0, maxFindings),
    truncated: kept.length > maxFindings,
    suppressions: { applied: suppressed, invalid: ign.invalid, file: ign.file },
    ...(baseline ? { baseline } : {}),
    notes, disclaimer: all.disclaimer,
  };

  if (opts.sarifPath) {
    const { relPath, absolutePath } = relabel("sarifPath", () => resolveOutputPath(projectDir, opts.sarifPath!));
    const exists = fs.existsSync(absolutePath);
    if (exists && !opts.overwrite) throw new Error(`${relPath} 이 이미 있습니다. 덮어쓰려면 overwrite=true 를 쓰세요.`);
    const sarif = toSarif({ ...result, findings: kept }, rules);
    await withFileTransaction(projectDir, "SARIF 기록", (tx) => { tx.writeFile(relPath, `${JSON.stringify(sarif, null, 2)}\n`, { mustNotExist: !exists }); });
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
            shortDescription: { text: `${x.guideItem}: ${x.message}` },
            fullDescription: { text: `${x.message}. 조치: ${x.fix}` },
            help: { text: x.fix, markdown: `**${x.guideItem}** (${cat.get(x.category)?.label ?? x.category}, CWE-${x.cwe})\n\n${x.message}\n\n조치: ${x.fix}` },
            defaultConfiguration: { level: SARIF_LEVEL[x.severity] },
            properties: { tags: ["security", `external/cwe/cwe-${x.cwe}`, `egovframe/${x.category}`], "security-severity": SECURITY_SEVERITY[x.severity], precision: "medium", guideItem: x.guideItem },
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
        properties: { origin: f.origin, ...(f.component ? { component: f.component } : {}), severity: f.severity, ...(f.isNew !== undefined ? { isNew: f.isNew } : {}) },
      })),
      originalUriBaseIds: { "%SRCROOT%": { description: { text: "프로젝트 루트" } } },
    }],
  };
}

const ORIGIN_KO: Record<SecureOrigin, string> = { component: "공통컴포넌트 원본", "component-modified": "공통컴포넌트 수정본", "component-unmanaged": "공통컴포넌트(매니페스트 없음)", project: "프로젝트 코드", test: "테스트" };
const SEV_KO: Record<SecureSeverity, string> = { high: "높음", medium: "중간", low: "낮음" };

/** 결과 Markdown. */
export function renderSecureCodingMarkdown(r: SecureCodingResult, top = 40): string {
  const L: string[] = [];
  const s = r.summary;
  L.push(`# 보안약점 점검 (${r.projectDir})`, ``);
  L.push(`- 기준: ${r.rulesVersion.source} — 규칙 ${r.rulesVersion.rules}종(${r.rulesVersion.surveyedAt})`);
  L.push(`- 파일 ${r.filesScanned}개(${Object.entries(r.byTarget).map(([k, n]) => `${k} ${n}`).join(" · ") || "없음"})`);
  L.push(`- **높음 ${s.high} · 중간 ${s.medium} · 낮음 ${s.low}** (합계 ${s.total}${s.new !== null ? ` · 새로 생김 ${s.new}` : ""}${s.suppressed ? ` · 예외 처리 ${s.suppressed}` : ""})`);
  const o = Object.entries(r.byOrigin).filter(([, n]) => n);
  if (o.length) L.push(`- 출처: ${o.map(([k, n]) => `${ORIGIN_KO[k as SecureOrigin]} ${n}`).join(" · ")}`);
  if (r.baseline) L.push(`- 비교: ${r.baseline.path}(이전 ${r.baseline.findings}건) — 해결 ${r.baseline.resolved}건`);
  if (r.sarif) L.push(`- SARIF: ${r.sarif.path}(결과 ${r.sarif.results}건${r.sarif.overwritten ? ", 덮어씀" : ""})`);
  if (r.byModule?.length) {
    L.push(``, `## 모듈별`, ``, `| 모듈 | 높음 | 중간 | 낮음 | 합계 |`, `|---|---|---|---|---|`);
    for (const m of r.byModule) L.push(`| ${m.module} | ${m.high} | ${m.medium} | ${m.low} | ${m.total} |`);
  }
  if (r.byRule.length) {
    L.push(``, `## 항목별`, ``, `| 보안약점(가이드 항목) | 규칙 | 기본 등급 | 건수 |`, `|---|---|---|---|`);
    for (const b of r.byRule) L.push(`| ${b.guideItem} | \`${b.rule}\` | ${SEV_KO[b.severity]} | ${b.count} |`);
  }
  if (r.findings.length) {
    L.push(``, `## 상세 (등급순 상위 ${Math.min(top, r.findings.length)}건)`, ``);
    for (const f of r.findings.slice(0, top)) {
      L.push(`- [${SEV_KO[f.severity]}] ${f.guideItem} — \`${f.file}:${f.line}\`${f.isNew ? " 🆕" : ""} (${ORIGIN_KO[f.origin]}${f.component ? ` ${f.component}` : ""})`);
      L.push(`  - \`${f.code.replace(/`/g, "'")}\``);
      L.push(`  - ${f.message}${f.note ? ` — ${f.note}` : ""}. 조치: ${f.fix}`);
    }
    if (r.findings.length > top) L.push(``, `… 외 ${r.findings.length - top}건 — format=json 또는 sarifPath 로 전체를 받으세요.`);
  } else L.push(``, `찾은 보안약점 패턴이 없습니다.`);
  if (r.suppressions.invalid.length) { L.push(``, `### 적용하지 않은 예외(${IGNORE_FILE})`); for (const x of r.suppressions.invalid) L.push(`- ${x}`); }
  for (const n of r.notes) L.push(`- ${n}`);
  L.push(``, `---`, r.disclaimer, `예외는 ${IGNORE_FILE} 에 {"ignores":[{"rule":"규칙 id","path":"경로(glob)","line":선택,"reason":"사유","reviewer":"검토자"}]} 로 남깁니다(사유·검토자가 없으면 적용하지 않음).`);
  return L.join("\n");
}
