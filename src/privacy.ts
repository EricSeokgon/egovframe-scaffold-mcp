// 개인정보 흐름·보호조치 점검 (check_egovframe_privacy, v1.21.0) — 읽기 전용, 정적 해석.
//   1) 개인정보 컬럼: 컬럼 이름 사전(catalog/privacy-rules.json)으로 DDL(CREATE TABLE)과 매퍼 XML 의 SQL 에서 찾는다 → 개인정보 파일(테이블 × 항목 × 등급)
//   2) 흐름표: v1.14 구조 지도로 테이블 → 매퍼 문장(읽기/쓰기) → DAO → Service → Controller → URL → 화면
//   3) 보호조치 누락(휴리스틱 — 근거를 함께 보인다):
//      plaintext-storage(높음): 암호화 대상 등급(고유식별·비밀번호·금융) 컬럼에 쓰는 문장인데, SQL 에 DB 암호화 함수가 없고
//        그 문장을 부르는 DAO·Service·Controller 소스에 "그 필드와 암호화 호출이 같은 구문에 있는 줄"이 없음
//        (파일 단위 판정 — 같은 파일의 다른 메서드에서 그 필드를 암호화하면 통과로 본다: 놓칠 수 있으나 오탐을 줄이는 쪽)
//      screen-exposure(중간): 화면이 고유식별정보 필드를 마스킹 없이 출력 / log-exposure(중간): 고유식별·비밀번호·금융 필드를 로그로 출력
//   법 해석·실제 데이터 스캔·자동 암호화는 하지 않는다. 값을 고치지 않는다.
import * as fs from "node:fs";
import * as path from "node:path";
import { buildProjectMap, tablesInSql, type ProjectMap } from "./project-map.js";
import { readIgnoreFile, type SecureIgnore } from "./secure-coding.js";
import { L, getLang } from "./lang.js";

export type PrivacyGrade = "unique-id" | "credential" | "financial" | "general";
export interface PrivacyItemRule { id: string; grade: PrivacyGrade; label: string; label_en?: string; columns: string }
export interface PrivacyRules {
  schemaVersion: number; surveyedAt: string; sources: { name: string; name_en?: string }[];
  grades: { id: PrivacyGrade; label: string; label_en?: string; encryptAtRest: boolean }[];
  items: PrivacyItemRule[];
  cryptoCalls: string; sqlCryptoFunctions: string; maskCalls: string; logCalls: string;
}
const RULES_URL = new URL("../catalog/privacy-rules.json", import.meta.url);
let cached: PrivacyRules | null = null;
export function loadPrivacyRules(): PrivacyRules { if (!cached) cached = JSON.parse(fs.readFileSync(RULES_URL, "utf8")) as PrivacyRules; return cached; }
const tr = (o: { [k: string]: unknown }, k: string): string => (getLang() === "en" && typeof o[`${k}_en`] === "string" ? (o[`${k}_en`] as string) : (o[k] as string));

export interface PrivacyColumn { table: string; column: string; item: string; label: string; grade: PrivacyGrade; source: "ddl" | "mapper"; file: string; line: number }
export interface PrivacyFlow {
  table: string; items: string[]; grades: PrivacyGrade[];
  read: number; write: number;
  daos: string[]; services: string[]; controllers: string[]; urls: string[]; views: string[];
}
export interface PrivacyFinding {
  kind: "plaintext-storage" | "screen-exposure" | "log-exposure";
  severity: "high" | "medium";
  item: string; label: string; grade: PrivacyGrade;
  file: string; line: number; code: string;
  message: string;
  /** 판정 근거(확인한 소스·없던 것) */
  evidence: string;
  table?: string; column?: string;
  /** plaintext-storage: 같은 문장을 가진 DB 별 매퍼 사본 수(2 이상일 때) */
  variants?: number;
}
export interface PrivacyOptions { projectDir: string; maxFiles?: number; rules?: PrivacyRules }
export interface PrivacyResult {
  projectDir: string;
  rulesVersion: { surveyedAt: string; items: number };
  durationMs: number;
  columns: PrivacyColumn[];
  flows: PrivacyFlow[];
  findings: PrivacyFinding[];
  summary: { tables: number; columns: number; items: number; byGrade: Record<string, number>; uniqueIdTables: number; high: number; medium: number; suppressed: number; ddlFiles: number; mapperStatements: number };
  ignoreFile: string | null;
  invalidIgnores: string[];
  notes: string[];
}
export const PRIVACY_IGNORE_FILE = ".egovframe-privacy-ignore.json";

const SKIP_DIRS = new Set(["target", "build", "node_modules", ".git", "migration-backup", "upgrade-backup", "remove-backup", "deploy", "sbom", "bin", "out", ".idea", ".settings", ".gradle"]);
const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");
const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const lineOf = (text: string, idx: number) => { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };
const stripXmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
const stripSqlComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
const stripJavaComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"])\/\/[^\n]*/g, (m, a: string) => a + " ".repeat(m.length - a.length));
/** IHIDNUM → ihidnum, EMAIL_ADRES → emailAdres */
export const camelOf = (col: string) => col.toLowerCase().replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
const norm = (s: string) => s.toLowerCase().replace(/[_\s]/g, "");

function walk(root: string, max: number): string[] {
  const out: string[] = []; const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(p); continue; }
      if (e.isFile() && /\.(java|xml|sql|jsp|jspf|html)$/i.test(e.name)) out.push(p);
    }
  }
  return out.sort();
}

/** 컬럼 이름 → 개인정보 항목(없으면 null). 정규식은 이름 전체에 대조 */
export function classifyPrivacyColumn(column: string, rules: PrivacyRules = loadPrivacyRules()): PrivacyItemRule | null {
  const c = column.replace(/[`"[\]]/g, "");
  for (const it of rules.items) if (new RegExp(`^(?:${it.columns})$`, "i").test(c)) return it;
  return null;
}

interface Stmt { ns: string; id: string; kind: "select" | "insert" | "update" | "delete"; sql: string; file: string; line: number; tables: string[] }

export function checkPrivacy(opts: PrivacyOptions): PrivacyResult {
  const t0 = Date.now();
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const rules = opts.rules ?? loadPrivacyRules();
  const gradeOf = new Map(rules.grades.map((g) => [g.id, g]));
  const notes: string[] = [];
  const files = walk(projectDir, opts.maxFiles ?? 40_000).map((abs) => ({ abs, rel: rel(projectDir, abs) })).filter((f) => !/(^|\/)src\/test\//.test(f.rel));

  // ── 1) DDL ──
  const columns = new Map<string, PrivacyColumn>(); // TABLE.COLUMN
  const ddlColumns = new Map<string, Set<string>>(); // TABLE → 모든 컬럼
  let ddlFiles = 0;
  // 적재용 스크립트(dml 디렉터리·*_DML_*·data.sql)는 CREATE TABLE 이 없으므로 읽지 않는다(공통컴포넌트는 1,900개 중 절반)
  for (const f of files.filter((x) => /\.sql$/i.test(x.rel) && !/(^|\/)dml\/|_DML_|(^|\/)data[\w-]*\.sql$/i.test(x.rel))) {
    const raw = read(f.abs);
    if (!/CREATE\s+(?:MEMORY\s+|CACHED\s+|GLOBAL\s+TEMPORARY\s+)?TABLE/i.test(raw)) continue;
    ddlFiles++;
    const src = stripSqlComments(raw);
    const re = /CREATE\s+(?:MEMORY\s+|CACHED\s+|GLOBAL\s+TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const table = m[1].replace(/[`"[\]]/g, "").split(".").pop()!.toUpperCase();
      // 짝 괄호까지
      let depth = 1, i = m.index + m[0].length;
      for (; i < src.length && depth > 0; i++) { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; }
      const bodyStart = m.index + m[0].length, body = src.slice(bodyStart, i - 1);
      // 최상위 쉼표로 나눈 정의의 첫 식별자
      let d = 0, start = 0;
      const defs: { text: string; at: number }[] = [];
      for (let k = 0; k <= body.length; k++) { const ch = body[k]; if (ch === "(") d++; else if (ch === ")") d--; if ((ch === "," && d === 0) || k === body.length) { defs.push({ text: body.slice(start, k), at: start }); start = k + 1; } }
      const set = ddlColumns.get(table) ?? new Set<string>();
      for (const def of defs) {
        const cm = def.text.match(/^\s*([`"[]?[A-Za-z_][\w$]*[`"\]]?)\s+[A-Za-z]/);
        if (!cm) continue;
        const col = cm[1].replace(/[`"[\]]/g, "").toUpperCase();
        if (/^(PRIMARY|CONSTRAINT|FOREIGN|UNIQUE|KEY|INDEX|CHECK|FULLTEXT)$/.test(col)) continue;
        set.add(col);
        const it = classifyPrivacyColumn(col, rules);
        if (it && !columns.has(`${table}.${col}`)) columns.set(`${table}.${col}`, { table, column: col, item: it.id, label: tr(it as unknown as Record<string, unknown>, "label"), grade: it.grade, source: "ddl", file: f.rel, line: lineOf(src, bodyStart + def.at + (def.text.length - def.text.trimStart().length)) });
      }
      ddlColumns.set(table, set);
    }
  }

  // ── 2) 매퍼 문장 ──
  const stmts: Stmt[] = [];
  for (const f of files.filter((x) => x.rel.endsWith(".xml"))) {
    const raw = read(f.abs);
    if (!/<mapper\b/.test(raw)) continue;
    const src = stripXmlComments(raw);
    const ns = src.match(/<mapper\s+[^>]*namespace\s*=\s*"([^"]*)"/)?.[1];
    if (ns === undefined) continue;
    const re = /<(select|insert|update|delete)\b([^>]*)>([\s\S]*?)<\/\1>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const rawId = m[2].match(/\bid\s*=\s*"([^"]*)"/)?.[1];
      if (!rawId) continue;
      const id = rawId.startsWith(`${ns}.`) ? rawId.slice(ns.length + 1) : rawId;
      const sql = m[3].replace(/<selectKey\b[\s\S]*?<\/selectKey>/g, (x) => x.replace(/[^\n]/g, " ")).replace(/<!\[CDATA\[|\]\]>/g, " ");
      stmts.push({ ns, id, kind: m[1] as Stmt["kind"], sql, file: f.rel, line: lineOf(src, m.index), tables: tablesInSql(sql).tables });
    }
  }
  // 문장 안의 개인정보 컬럼(식별자 토큰). DDL 이 그 테이블의 컬럼을 알면 그 테이블로, 모르면 문장의 테이블로
  const stmtCols = new Map<Stmt, { table: string; column: string; item: PrivacyItemRule }[]>();
  const tokenCache = new Map<string, PrivacyItemRule | null>();
  for (const s of stmts) {
    const body = s.sql.replace(/<[^>]+>/g, " ").replace(/#\{[^}]*\}|\$\{[^}]*\}/g, " ").replace(/'[^']*'/g, " ");
    const hits: { table: string; column: string; item: PrivacyItemRule }[] = [];
    const seen = new Set<string>();
    for (const tk of body.match(/[A-Za-z_][\w$]*/g) ?? []) {
      const up = tk.toUpperCase();
      if (seen.has(up)) continue;
      seen.add(up);
      let it = tokenCache.get(up);
      if (it === undefined) { it = /^[A-Z][A-Z0-9_]*$/.test(tk) || tk.includes("_") || ddlColumnsHas(up) ? classifyPrivacyColumn(up, rules) : null; tokenCache.set(up, it); }
      if (!it) continue;
      const owners = s.tables.filter((t) => ddlColumns.get(t)?.has(up));
      const tables = owners.length ? owners : s.tables.filter((t) => !ddlColumns.has(t));
      for (const table of tables) {
        hits.push({ table, column: up, item: it });
        if (!columns.has(`${table}.${up}`)) columns.set(`${table}.${up}`, { table, column: up, item: it.id, label: tr(it as unknown as Record<string, unknown>, "label"), grade: it.grade, source: "mapper", file: s.file, line: s.line });
      }
    }
    if (hits.length) stmtCols.set(s, hits);
  }
  function ddlColumnsHas(up: string): boolean { for (const set of ddlColumns.values()) if (set.has(up)) return true; return false; }
  if (!ddlFiles && !stmts.length) notes.push(L("DDL(CREATE TABLE)과 MyBatis 매퍼 XML 을 찾지 못했습니다 — JPA 엔티티만 쓰는 프로젝트는 아직 보지 않습니다", "No DDL (CREATE TABLE) or MyBatis mapper XML found — JPA-entity-only projects are not covered yet"));

  // ── 3) 구조 지도로 흐름 ──
  let map: ProjectMap | null = null;
  try { map = buildProjectMap({ projectDir, maxFiles: opts.maxFiles }); } catch (e) { notes.push(L(`구조 지도 생성 실패 — 흐름표 없이 진행: ${e instanceof Error ? e.message : String(e)}`, `Project map failed — continuing without flows: ${e instanceof Error ? e.message : String(e)}`)); }
  const nodeById = new Map((map?.nodes ?? []).map((n) => [n.id, n]));
  const incoming = new Map<string, { from: string; kind: string; detail?: string }[]>();
  const outgoing = new Map<string, { to: string; kind: string }[]>();
  for (const e of map?.edges ?? []) { incoming.set(e.to, [...(incoming.get(e.to) ?? []), { from: e.from, kind: e.kind, detail: e.detail }]); outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), { to: e.to, kind: e.kind }]); }
  const mapperIds = [...nodeById.keys()].filter((k) => k.startsWith("mapper:"));
  const nsCache = new Map<string, string>();
  const nsNode = (ns: string) => { let v = nsCache.get(ns); if (v === undefined) { v = nodeById.has(`mapper:${ns}`) ? `mapper:${ns}` : mapperIds.find((k) => k.split(".").pop() === ns.split(".").pop()) ?? `mapper:${ns}`; nsCache.set(ns, v); } return v; };
  const callerCache = new Map<string, { daos: string[]; upstream: string[] }>();
  /** 문장을 부르는 클래스(DAO·Mapper 인터페이스) → 위로 주입하는 클래스들 */
  const callersOf = (s: Stmt): { daos: string[]; upstream: string[] } => {
    const ck = `${s.ns}|${s.id}`;
    const hit = callerCache.get(ck);
    if (hit) return hit;
    const daos = (incoming.get(nsNode(s.ns)) ?? []).filter((e) => e.kind === "calls" && (e.detail === "namespace" || (e.detail ?? "").split(",").includes(s.id))).map((e) => e.from);
    const up = new Set<string>(); const queue = [...daos];
    for (let depth = 0; queue.length && depth < 4000; depth++) {
      const cur = queue.shift()!;
      for (const e of incoming.get(cur) ?? []) if ((e.kind === "injects" || e.kind === "implements") && !up.has(e.from) && !daos.includes(e.from)) { up.add(e.from); queue.push(e.from); }
      for (const e of outgoing.get(cur) ?? []) if (e.kind === "implements" && !up.has(e.to) && !daos.includes(e.to)) { up.add(e.to); queue.push(e.to); }
    }
    const res = { daos: [...new Set(daos)], upstream: [...up] };
    callerCache.set(ck, res);
    return res;
  };
  const role = (id: string) => nodeById.get(id)?.role;
  const nameOf = (id: string) => nodeById.get(id)?.name ?? id.replace(/^\w+:/, "");
  const fileOf = (id: string) => nodeById.get(id)?.file;

  const flowByTable = new Map<string, { read: number; write: number; daos: Set<string>; services: Set<string>; controllers: Set<string>; urls: Set<string>; views: Set<string> }>();
  const stmtCallers = new Map<Stmt, { daos: string[]; upstream: string[] }>();
  const counted = new Set<string>(); // DB 별 매퍼 사본의 같은 문장은 한 번만 센다
  for (const [s, hits] of stmtCols) {
    const c = callersOf(s);
    stmtCallers.set(s, c);
    for (const table of new Set(hits.map((h) => h.table))) {
      const f = flowByTable.get(table) ?? { read: 0, write: 0, daos: new Set(), services: new Set(), controllers: new Set(), urls: new Set(), views: new Set() };
      const ck = `${table}|${s.ns}|${s.id}`;
      if (!counted.has(ck)) { counted.add(ck); if (s.kind === "select") f.read++; else f.write++; }
      for (const d of c.daos) f.daos.add(nameOf(d));
      for (const u of c.upstream) {
        const r = role(u);
        if (r === "controller") {
          f.controllers.add(nameOf(u));
          for (const e of incoming.get(u) ?? []) if (e.kind === "maps") f.urls.add(nameOf(e.from));
          for (const e of outgoing.get(u) ?? []) if (e.kind === "renders") f.views.add(nameOf(e.to));
        } else if (r === "service" || r === "service-impl") f.services.add(nameOf(u));
      }
      flowByTable.set(table, f);
    }
  }
  const cols = [...columns.values()].sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
  const tables = [...new Set(cols.map((c) => c.table))];
  const flows: PrivacyFlow[] = tables.map((table) => {
    const f = flowByTable.get(table);
    const mine = cols.filter((c) => c.table === table);
    return { table, items: [...new Set(mine.map((c) => c.item))], grades: [...new Set(mine.map((c) => c.grade))], read: f?.read ?? 0, write: f?.write ?? 0, daos: [...(f?.daos ?? [])].sort(), services: [...(f?.services ?? [])].sort(), controllers: [...(f?.controllers ?? [])].sort(), urls: [...(f?.urls ?? [])].sort(), views: [...(f?.views ?? [])].sort() };
  });

  // ── 4) 보호조치 ──
  const findings: PrivacyFinding[] = [];
  const cryptoRe = new RegExp(rules.cryptoCalls), sqlCryptoRe = new RegExp(rules.sqlCryptoFunctions, "i"), maskRe = new RegExp(rules.maskCalls), logRe = new RegExp(rules.logCalls);
  const javaText = new Map<string, string>();
  const java = (r: string) => { let t = javaText.get(r); if (t === undefined) { t = stripJavaComments(read(path.join(projectDir, r))); javaText.set(r, t); } return t; };
  const labelOf = (it: PrivacyItemRule) => tr(it as unknown as Record<string, unknown>, "label");
  const refCache = new Map<string, string[]>();
  const referrersOf = (simple: string): string[] => { let v = refCache.get(simple); if (!v) { const re = new RegExp(`\\b${simple}\\b`); v = files.filter((x) => x.rel.endsWith(".java") && re.test(java(x.rel))).map((x) => x.rel); refCache.set(simple, v); } return v; };
  // 4-a) 평문 저장
  const reported = new Set<string>();
  for (const [s, hits] of stmtCols) {
    if (s.kind !== "insert" && s.kind !== "update") continue;
    for (const h of hits) {
      if (!gradeOf.get(h.item.grade)?.encryptAtRest) continue;
      // 이 컬럼에 실제로 값을 쓰는가: INSERT 의 컬럼 목록 또는 UPDATE 의 SET 대상
      const sqlFlat = s.sql.replace(/<[^>]+>/g, " ");
      const writes = s.kind === "insert" ? new RegExp(`\\b${h.column}\\b`, "i").test(sqlFlat.split(/\bVALUES\b|\bSELECT\b/i)[0]) : new RegExp(`\\b${h.column}\\b\\s*=`, "i").test(sqlFlat.split(/\bWHERE\b/i)[0]);
      if (!writes) continue;
      const key = `${s.ns}|${s.id}|${h.table}|${h.column}`;
      if (reported.has(key)) { const prev = findings.find((f) => f.kind === "plaintext-storage" && f.code === `${s.kind.toUpperCase()} ${s.ns}.${s.id} → ${h.table}.${h.column}`); if (prev) prev.variants = (prev.variants ?? 1) + 1; continue; }
      // 그 컬럼에 대응하는 #{param}
      const params = [...new Set([...sqlFlat.matchAll(/#\{\s*([\w.]+)/g)].map((x) => x[1].split(".").pop()!).filter((p) => norm(p) === norm(h.column) || norm(p).endsWith(norm(h.column))))];
      const fields = [...new Set([camelOf(h.column), ...params])];
      // SQL 안 암호화 함수가 그 값에 적용되는가
      const sqlProtected = fields.some((f) => new RegExp(`(?:${rules.sqlCryptoFunctions})[^,]*#\\{\\s*(?:[\\w.]+\\.)?${f}\\b`, "i").test(sqlFlat)) || (sqlCryptoRe.test(sqlFlat) && new RegExp(`\\b${h.column}\\b\\s*=\\s*(?:${rules.sqlCryptoFunctions})`, "i").test(sqlFlat));
      if (sqlProtected) continue;
      const c = stmtCallers.get(s) ?? callersOf(s);
      const classIds = [...c.daos, ...c.upstream];
      const srcFiles = [...new Set(classIds.map(fileOf).filter((x): x is string => !!x && x.endsWith(".java")))];
      // 생성자 주입(final 필드 + Lombok)처럼 지도가 주입 관계를 못 읽은 경우: DAO 단순 이름을 쓰는 Java 파일을 호출 경로에 더한다
      if (!c.upstream.some((u) => { const r = role(u); return r === "service" || r === "service-impl" || r === "controller"; })) for (const d of c.daos) for (const jf of referrersOf(nameOf(d).split(".").pop()!)) if (!srcFiles.includes(jf)) srcFiles.push(jf);
      // 같은 구문(줄 ±1)에 필드 접근과 암호화 호출
      const fieldRe = new RegExp(`\\b(?:[gs]et)?(?:${fields.map((f) => `${f[0].toUpperCase()}${f.slice(1)}|${f}`).join("|")})\\b`);
      let protectedAt: string | null = null;
      for (const jf of srcFiles) {
        const lines = java(jf).split("\n");
        for (let i = 0; i < lines.length && !protectedAt; i++) {
          if (!fieldRe.test(lines[i])) continue;
          const win = `${lines[i - 1] ?? ""}\n${lines[i]}\n${lines[i + 1] ?? ""}`;
          if (cryptoRe.test(win)) protectedAt = `${jf}:${i + 1}`;
        }
        if (protectedAt) break;
      }
      if (protectedAt) continue;
      reported.add(key);
      findings.push({
        kind: "plaintext-storage", severity: "high", item: h.item.id, label: labelOf(h.item), grade: h.item.grade, table: h.table, column: h.column,
        file: s.file, line: s.line, code: `${s.kind.toUpperCase()} ${s.ns}.${s.id} → ${h.table}.${h.column}`,
        message: L(`${labelOf(h.item)}(${h.column})를 암호화 없이 저장하는 것으로 보입니다 — 저장 시 암호화 대상입니다`, `${labelOf(h.item)} (${h.column}) appears to be stored without encryption — it must be encrypted at rest`),
        evidence: srcFiles.length
          ? L(`SQL 에 DB 암호화 함수 없음 · 호출 경로 ${srcFiles.length}개 파일(${srcFiles.slice(0, 3).map((x) => x.split("/").pop()).join(", ")}${srcFiles.length > 3 ? " …" : ""})에 필드 ${fields.join("/")} 와 암호화 호출이 함께 있는 줄 없음`, `No DB crypto function in the SQL · no line combining field ${fields.join("/")} with a crypto call in ${srcFiles.length} files on the call path (${srcFiles.slice(0, 3).map((x) => x.split("/").pop()).join(", ")}${srcFiles.length > 3 ? " …" : ""})`)
          : L("SQL 에 DB 암호화 함수 없음 · 이 문장을 부르는 Java 를 찾지 못함(호출 경로 미확인)", "No DB crypto function in the SQL · no Java caller found for this statement (call path unknown)"),
      });
    }
  }
  // 4-b) 화면 노출 · 4-c) 로그
  const sensitive = rules.items.filter((it) => it.grade !== "general");
  const presentItems = new Set(cols.map((c) => c.item));
  const fieldNamesOf = (it: PrivacyItemRule) => [...new Set(cols.filter((c) => c.item === it.id).map((c) => camelOf(c.column)))];
  const uniqueFields = sensitive.filter((it) => it.grade === "unique-id" && presentItems.has(it.id)).flatMap((it) => fieldNamesOf(it).map((f) => ({ f, it })));
  if (uniqueFields.length) {
    for (const vf of files.filter((x) => /\.(jsp|jspf|html)$/i.test(x.rel) && /(WEB-INF|templates|webapp)/.test(x.rel))) {
      const text = read(vf.abs).replace(/<%--[\s\S]*?--%>/g, (m) => m.replace(/[^\n]/g, " ")).replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
      text.split("\n").forEach((ln, i) => {
        for (const { f, it } of uniqueFields) {
          // 출력 식: ${x.field} (EL·Thymeleaf). 입력 폼의 value·path 는 수집이므로 제외
          if (!new RegExp(`\\$\\{[^}]*\\b${f}\\b[^}]*\\}`).test(ln)) continue;
          if (/<input\b|<textarea\b|<form:(input|password|hidden|textarea)|th:field|th:value/.test(ln) || maskRe.test(ln)) continue;
          findings.push({ kind: "screen-exposure", severity: "medium", item: it.id, label: labelOf(it), grade: it.grade, file: vf.rel, line: i + 1, code: ln.trim().slice(0, 160), message: L(`화면이 ${labelOf(it)}를 마스킹 없이 출력합니다`, `The view prints ${labelOf(it)} without masking`), evidence: L(`출력 식에 필드 ${f}, 같은 줄에 마스킹 호출 없음`, `Output expression with field ${f}, no masking call on the line`) });
        }
      });
    }
  }
  const logFields = sensitive.filter((it) => presentItems.has(it.id)).flatMap((it) => fieldNamesOf(it).map((f) => ({ f, it })));
  if (logFields.length) {
    for (const jf of files.filter((x) => x.rel.endsWith(".java"))) {
      const text = java(jf.rel);
      if (!logRe.test(text)) continue;
      text.split("\n").forEach((ln, i) => {
        if (!logRe.test(ln)) return;
        for (const { f, it } of logFields) {
          if (!new RegExp(`\\bget${f[0].toUpperCase()}${f.slice(1)}\\s*\\(`).test(ln)) continue;
          findings.push({ kind: "log-exposure", severity: "medium", item: it.id, label: labelOf(it), grade: it.grade, file: jf.rel, line: i + 1, code: ln.trim().slice(0, 160).replace(/"[^"]*"/g, '"…"'), message: L(`${labelOf(it)}를 로그로 출력합니다`, `${labelOf(it)} is written to the log`), evidence: L(`로그 호출 줄에 get${f[0].toUpperCase()}${f.slice(1)}()`, `get${f[0].toUpperCase()}${f.slice(1)}() on a logging line`) });
        }
      });
    }
  }

  // ── 예외 파일 ──
  const ig = readIgnoreFile(projectDir, PRIVACY_IGNORE_FILE);
  let suppressed = 0;
  const kept = findings.filter((f) => { const hit = ig.list.some((x: SecureIgnore) => x.rule === f.kind && (x.path === f.file || f.file.startsWith(x.path.endsWith("/") ? x.path : `${x.path}/`)) && (x.line === undefined || x.line === f.line)); if (hit) suppressed++; return !hit; });
  kept.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1) || a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || a.line - b.line);
  const byGrade: Record<string, number> = {};
  for (const c of cols) byGrade[c.grade] = (byGrade[c.grade] ?? 0) + 1;
  if (cols.length && !cols.some((c) => c.source === "ddl")) notes.push(L("DDL 을 찾지 못해 매퍼 SQL 에 나온 컬럼만으로 만들었습니다 — 조회·저장하지 않는 컬럼은 빠질 수 있습니다", "No DDL found; built from columns seen in mapper SQL only — columns never read or written may be missing"));
  return {
    projectDir, rulesVersion: { surveyedAt: rules.surveyedAt, items: rules.items.length }, durationMs: Date.now() - t0,
    columns: cols, flows, findings: kept,
    summary: { tables: tables.length, columns: cols.length, items: new Set(cols.map((c) => c.item)).size, byGrade, uniqueIdTables: new Set(cols.filter((c) => c.grade === "unique-id").map((c) => c.table)).size, high: kept.filter((f) => f.severity === "high").length, medium: kept.filter((f) => f.severity === "medium").length, suppressed, ddlFiles, mapperStatements: new Set([...stmtCols.keys()].map((x) => `${x.ns}|${x.id}`)).size },
    ignoreFile: ig.file, invalidIgnores: ig.invalid, notes,
  };
}

const gradeLabel = (g: PrivacyGrade, rules = loadPrivacyRules()) => { const x = rules.grades.find((y) => y.id === g); return x ? tr(x as unknown as Record<string, unknown>, "label") : g; };

export function renderPrivacyMarkdown(r: PrivacyResult, topN = 30): string {
  const out: string[] = [];
  out.push(L(`# 개인정보 흐름·보호조치 점검 (${r.projectDir})`, `# Personal data flow and safeguards (${r.projectDir})`), "");
  out.push(L(`- 개인정보 테이블 ${r.summary.tables}개 · 컬럼 ${r.summary.columns}개 · 항목 ${r.summary.items}종 (${Object.entries(r.summary.byGrade).map(([g, n]) => `${gradeLabel(g as PrivacyGrade)} ${n}`).join(" · ") || "없음"})`, `- ${r.summary.tables} tables · ${r.summary.columns} columns · ${r.summary.items} item types (${Object.entries(r.summary.byGrade).map(([g, n]) => `${gradeLabel(g as PrivacyGrade)} ${n}`).join(" · ") || "none"})`));
  out.push(L(`- 보호조치 누락 의심: 높음 ${r.summary.high} · 중간 ${r.summary.medium}${r.summary.suppressed ? ` · 예외 ${r.summary.suppressed}` : ""} — 이름·호출 패턴 기반의 정적 판정입니다. 근거를 확인하고 판단하세요.`, `- Suspected missing safeguards: ${r.summary.high} high · ${r.summary.medium} medium${r.summary.suppressed ? ` · ${r.summary.suppressed} suppressed` : ""} — static, name- and call-pattern based. Check the evidence before deciding.`), "");
  if (r.findings.length) {
    out.push(L("## 보호조치 누락 의심", "## Suspected missing safeguards"), "", L("| 심각도 | 종류 | 항목 | 위치 | 대상 | 근거 |", "| Severity | Kind | Item | Location | Target | Evidence |"), "|---|---|---|---|---|---|");
    for (const f of r.findings.slice(0, topN)) out.push(`| ${f.severity} | ${f.kind} | ${f.label} | \`${f.file}:${f.line}\` | \`${f.code.replace(/\|/g, "\\|")}\` | ${f.evidence.replace(/\|/g, "\\|")} |`);
    if (r.findings.length > topN) out.push("", L(`… ${r.findings.length - topN}건 더(format=json)`, `… ${r.findings.length - topN} more (format=json)`));
    out.push("");
  }
  if (r.columns.length) {
    out.push(L("## 개인정보 파일 (테이블 × 항목)", "## Personal data files (table × item)"), "", L("| 테이블 | 컬럼 | 항목 | 등급 | 출처 |", "| Table | Column | Item | Grade | Source |"), "|---|---|---|---|---|");
    for (const c of r.columns.slice(0, topN * 4)) out.push(`| ${c.table} | ${c.column} | ${c.label} | ${gradeLabel(c.grade)} | ${c.source} \`${c.file}:${c.line}\` |`);
    if (r.columns.length > topN * 4) out.push("", L(`… ${r.columns.length - topN * 4}개 더(format=csv·json)`, `… ${r.columns.length - topN * 4} more (format=csv/json)`));
    out.push("", L("## 처리 흐름 (테이블 → 화면)", "## Processing flow (table → screens)"), "", L("| 테이블 | 항목 | 읽기/쓰기 문장 | DAO | Service | Controller | URL | 화면 |", "| Table | Items | Read/write statements | DAO | Service | Controller | URL | Views |"), "|---|---|---|---|---|---|---|---|");
    const short = (xs: string[], n = 3) => (xs.length ? `${xs.slice(0, n).map((x) => x.split(".").pop()!.split("/").pop()).join(", ")}${xs.length > n ? ` 외 ${xs.length - n}` : ""}` : "—");
    for (const f of r.flows.slice(0, topN)) out.push(`| ${f.table} | ${f.items.join(", ")} | ${f.read}/${f.write} | ${short(f.daos)} | ${short(f.services)} | ${short(f.controllers)} | ${f.urls.length ? `${f.urls.slice(0, 3).join(", ")}${f.urls.length > 3 ? ` 외 ${f.urls.length - 3}` : ""}` : "—"} | ${short(f.views)} |`);
    out.push("");
  }
  for (const n of r.notes) out.push(`> ${n}`);
  if (r.findings.length) out.push(L(`> 확인해서 문제가 없으면 \`${PRIVACY_IGNORE_FILE}\` 에 사유·검토자와 함께 예외로 등록할 수 있습니다(rule = 종류).`, `> If a finding is acceptable after review, register it in \`${PRIVACY_IGNORE_FILE}\` with a reason and reviewer (rule = kind).`));
  return out.join("\n");
}

/** 개인정보 파일 대장 CSV(UTF-8 BOM·CRLF — 엑셀): 테이블·컬럼·항목·등급·읽기/쓰기 문장 수·URL 수·화면 수 */
export function renderPrivacyCsv(r: PrivacyResult): string {
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const flow = new Map(r.flows.map((f) => [f.table, f]));
  const rows = [["table", "column", "item", "grade", "source", "file", "readStatements", "writeStatements", "controllers", "urls", "views"].map(q).join(",")];
  for (const c of r.columns) { const f = flow.get(c.table); rows.push([c.table, c.column, c.label, gradeLabel(c.grade), c.source, `${c.file}:${c.line}`, f?.read ?? 0, f?.write ?? 0, f?.controllers.length ?? 0, f?.urls.length ?? 0, f?.views.length ?? 0].map(q).join(",")); }
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}
