// 화면–쿼리–DB 정합성 (v1.25) — 컴파일·기동·기능 시험이 모두 통과하는데 운영에서 드러나는 불일치. 읽기 전용.
//   1) 목록·건수 쌍: selectXList ↔ selectXListCnt(TotCnt·Count)의 동적 조건(<if test>·<when test>)이 다르면 페이지 수가 어긋난다
//   2) 입력 길이 3자 대조: JSP maxlength · VO @Size(max)/@Length(max) · DDL 컬럼 길이 — 화면·VO 가 DB 보다 길면 저장 때 잘리거나 오류
//   필드 → 컬럼은 매퍼의 INSERT·UPDATE 문장(#{field} 와 짝이 되는 컬럼)에서 읽는다. 이름 추측을 하지 않는다.
import * as fs from "node:fs";
import * as path from "node:path";
import { L } from "./lang.js";

export type ConsistencyKind = "count-condition-mismatch" | "length-exceeds-column" | "maxlength-exceeds-size";
export interface ConsistencyIssue {
  kind: ConsistencyKind; severity: "error" | "warning";
  file: string; line: number;
  /** 대상(문장 id 쌍 또는 VO.field) */
  subject: string;
  message: string; fix: string;
  /** 비교한 양쪽 값 */
  detail?: Record<string, string | number | string[]>;
  /** DB 별 매퍼 사본 수(같은 불일치가 여러 사본에 있을 때) */
  variants?: number;
}
export interface ConsistencyResult {
  projectDir: string;
  durationMs: number;
  summary: {
    mapperFiles: number; countPairs: number; pairsCompared: number;
    sizedFields: number; maxlengthInputs: number; columnsWithLength: number; fieldsLinked: number;
    errors: number; warnings: number;
    byKind: Record<string, number>;
  };
  issues: ConsistencyIssue[];
  truncated: boolean;
  notes: string[];
}
export interface ConsistencyOptions { projectDir: string; maxFiles?: number; maxIssues?: number }

const SKIP_DIRS = new Set(["target", "build", "node_modules", ".git", "migration-backup", "deploy", "sbom", "bin", "out", ".idea", ".settings", "test"]);
const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");
const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const lineOf = (text: string, idx: number) => { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };
const blank = (m: string) => m.replace(/[^\n]/g, " ");
const stripXmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, blank);
function walk(root: string, max: number): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(p); continue; }
      if (e.isFile() && /\.(java|xml|jsp|jspf|html|sql)$/.test(e.name)) out.push(p);
    }
  }
  return out.sort();
}

// ── 매퍼 ──
interface Stmt { id: string; kind: "select" | "insert" | "update" | "delete"; body: string; line: number; param: string | null }
interface MapperFile { rel: string; namespace: string; db: string | null; stmts: Map<string, Stmt> }
const DB_SUFFIX = /_(mysql|maria|mariadb|oracle|postgres|postgresql|altibase|tibero|cubrid|hsql|hsqldb|mssql|goldilocks|db2)\.xml$/i;
export function parseMapperForConsistency(file: string, raw: string): MapperFile | null {
  if (!/<mapper\b/.test(raw)) return null;
  const text = stripXmlComments(raw);
  const ns = /<mapper\b[^>]*\bnamespace\s*=\s*"([^"]+)"/.exec(text)?.[1];
  if (!ns) return null;
  const fragments = new Map<string, string>();
  for (const m of text.matchAll(/<sql\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/sql>/g)) fragments.set(m[1], m[2]);
  const expand = (body: string, depth = 0): string => (depth > 4 ? body : body.replace(/<include\b[^>]*\brefid\s*=\s*"([^"]+)"[^>]*\/?>(?:\s*<\/include>)?/g, (_m, id: string) => { const f = fragments.get(id) ?? fragments.get(id.split(".").pop()!); return f ? expand(f, depth + 1) : " "; }));
  const stmts = new Map<string, Stmt>();
  for (const m of text.matchAll(/<(select|insert|update|delete)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const id = /\bid\s*=\s*"([^"]+)"/.exec(m[2])?.[1];
    if (!id) continue;
    const short = id.startsWith(`${ns}.`) ? id.slice(ns.length + 1) : id;
    const param = /\bparameterType\s*=\s*"([^"]+)"/.exec(m[2])?.[1] ?? null;
    stmts.set(short, { id: short, kind: m[1] as Stmt["kind"], body: expand(m[3].replace(/<selectKey\b[\s\S]*?<\/selectKey>/g, " ")), line: lineOf(text, m.index!), param });
  }
  return { rel: file, namespace: ns, db: DB_SUFFIX.exec(file)?.[1].toLowerCase() ?? null, stmts };
}

const COUNT_SUFFIX = /(ListTotCnt|ListTotalCount|ListTotalCnt|ListCnt|ListCount|TotCnt|TotalCnt|TotalCount|Cnt|Count)$/;
/** 건수 문장 id → 목록 문장 id 후보(있는 것 중 첫 번째) */
export function listPartnerOf(countId: string, ids: Set<string>): string | null {
  const m = COUNT_SUFFIX.exec(countId);
  if (!m) return null;
  const stem = countId.slice(0, m.index);
  const hadList = m[1].startsWith("List");
  const cands = hadList ? [`${stem}List`, stem] : [stem, `${stem}List`, `${stem}s`];
  for (const c of cands) if (c !== countId && ids.has(c)) return c;
  return null;
}
const PAGING_ONLY = /^\s*(?:ORDER\s+BY\b|LIMIT\b|OFFSET\b|\)\s*(?:TB|T|A|ALL_LIST)?\s*\)?\s*WHERE\s+R(?:OW)?NUM\b|FETCH\b)/i;
interface Cond { test: string; columns: string[]; raw: string }
/** 동적 조건: test 식(공백 제거)과 그 안에서 거르는 컬럼. 정렬·페이징만 하는 조건은 뺀다 */
export function dynamicConditions(body: string): Cond[] {
  const out: Cond[] = [];
  for (const m of body.matchAll(/<(if|when)\b[^>]*\btest\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const inner = m[3].replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    if (PAGING_ONLY.test(inner) || !/[=<>]|\bLIKE\b|\bIN\b|\bBETWEEN\b/i.test(inner)) continue;
    if (/\b(firstIndex|recordCountPerPage|pageIndex|pageUnit|lastIndex|firstRecordIndex|lastRecordIndex)\b/.test(inner) && !/\bAND\b|\bOR\b/i.test(inner.replace(/BETWEEN[\s\S]*?AND/gi, ""))) continue;
    const test = m[2].replace(/\s+/g, "").replace(/'/g, '"');
    // 조건이 거르는 컬럼: 연산자 왼쪽의 식별자(함수 인자 포함) — 별칭 접두는 뗀다
    const cols = [...inner.replace(/#\{[^}]*\}|\$\{[^}]*\}|'[^']*'/g, " ").matchAll(/\b(?:[A-Za-z_]\w*\.)?([A-Za-z_][A-Za-z0-9_]*)\b\s*\)*\s*(?:=|<>|!=|<=|>=|<|>|\bLIKE\b|\bIN\b|\bBETWEEN\b|\bIS\b)/gi)].map((x) => x[1].toUpperCase()).filter((c) => !/^(AND|OR|NOT|WHERE|ON|CONCAT|BINARY|UPPER|LOWER|TRIM|NVL|COALESCE|IFNULL|TO_CHAR|TO_DATE|SUBSTR|SUBSTRING|REPLACE|CAST)$/.test(c));
    const columns = [...new Set(cols)].sort();
    // 순번(RN·ROWNUM)만 거르는 조건은 상위 N건·페이징이다
    if (columns.length && columns.every((c) => /^(RN|RNUM|ROWNUM|ROW_NUM|RNUM_)$/.test(c))) continue;
    out.push({ test, columns, raw: m[2].trim().replace(/\s+/g, " ") });
  }
  return out;
}

// ── VO · JSP · DDL ──
interface SizedField { cls: string; field: string; max: number; file: string; line: number }
function parseSizedFields(file: string, raw: string): SizedField[] {
  if (!/@(Size|Length)\b/.test(raw)) return [];
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:"])\/\/[^\n]*/g, (m, a: string) => a + " ".repeat(m.length - a.length));
  const cls = /\bclass\s+(\w+)/.exec(text)?.[1];
  if (!cls) return [];
  const out: SizedField[] = [];
  for (const m of text.matchAll(/@(?:Size|Length)\s*\(([^)]*)\)((?:\s*@\w+(?:\s*\((?:[^()]|\([^()]*\))*\))?)*)\s*(?:private|protected|public)?\s*(?:final\s+)?[\w<>\[\],.?\s]+?\s+(\w+)\s*(?:=|;)/g)) {
    const max = /\bmax\s*=\s*(\d+)/.exec(m[1])?.[1];
    if (max) out.push({ cls, field: m[3], max: Number(max), file, line: lineOf(text, m.index!) });
  }
  return out;
}
interface JspInput { model: string | null; field: string; max: number; file: string; line: number }
function parseJspInputs(file: string, raw: string): JspInput[] {
  if (!/maxlength/i.test(raw)) return [];
  const text = raw.replace(/<!--[\s\S]*?-->/g, blank).replace(/<%--[\s\S]*?--%>/g, blank);
  // 폼마다 modelAttribute(commandName) — 폼 범위 안의 입력에 그 이름을 붙인다
  const forms = [...text.matchAll(/<form:form\b([^>]*)>/g)].map((m) => ({ at: m.index!, model: /\b(?:modelAttribute|commandName)\s*=\s*"([^"]+)"/.exec(m[1])?.[1] ?? null }));
  const ends = [...text.matchAll(/<\/form:form>/g)].map((m) => m.index!);
  const modelAt = (idx: number) => { let cur: string | null = null; for (const f of forms) { if (f.at > idx) break; const end = ends.find((e) => e > f.at); if (end === undefined || end > idx) cur = f.model; } return cur; };
  const out: JspInput[] = [];
  for (const m of text.matchAll(/<(form:input|form:textarea|form:password|input|textarea)\b([^>]*)>/gi)) {
    const max = /\bmaxlength\s*=\s*"(\d+)"/i.exec(m[2])?.[1];
    const field = (/\bpath\s*=\s*"([\w.]+)"/.exec(m[2]) ?? /\bname\s*=\s*"([\w.]+)"/.exec(m[2]))?.[1];
    if (!max || !field || /\btype\s*=\s*"(hidden|checkbox|radio|file|button|submit)"/i.test(m[2])) continue;
    out.push({ model: m[1].toLowerCase().startsWith("form:") ? modelAt(m.index!) : null, field: field.split(".").pop()!, max: Number(max), file, line: lineOf(text, m.index!) });
  }
  return out;
}
interface ColumnLength { table: string; column: string; length: number; unit: "char" | "byte" | null; file: string; line: number }
function parseDdlLengths(file: string, raw: string): ColumnLength[] {
  if (!/CREATE\s+TABLE/i.test(raw)) return [];
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/--[^\n]*/g, blank);
  // 줄 번호: 줄 시작 위치를 한 번 만들어 이진 탐색(컬럼마다 처음부터 세면 큰 스크립트에서 제곱 시간)
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const lineAt = (idx: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
  const out: ColumnLength[] = [];
  for (const t of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"\[]?(?:\w+\.)?(\w+)[`"\]]?\s*\(/gi)) {
    let depth = 0, end = -1;
    for (let i = t.index! + t[0].length - 1; i < text.length; i++) { const c = text[i]; if (c === "(") depth++; else if (c === ")") { depth--; if (depth === 0) { end = i; break; } } }
    if (end < 0) continue;
    const bodyStart = t.index! + t[0].length;
    const body = text.slice(bodyStart, end);
    // 최상위 쉼표로 컬럼 정의를 나눈 뒤 한 조각씩 본다(긴 스크립트에서 정규식 역추적을 피한다)
    let d2 = 0, segStart = 0;
    const seg = (from: number, to: number): void => {
      const piece = body.slice(from, to);
      const c = /^\s*[`"\[]?(\w+)[`"\]]?\s+(?:N?VARCHAR2?|N?CHAR|CHARACTER(?:\s+VARYING)?)\s*\(\s*(\d+)\s*(BYTE|CHAR)?\s*\)/i.exec(piece);
      if (!c || /^(PRIMARY|CONSTRAINT|FOREIGN|UNIQUE|KEY|INDEX|CHECK)$/i.test(c[1])) return;
      out.push({ table: t[1].toUpperCase(), column: c[1].toUpperCase(), length: Number(c[2]), unit: c[3] ? (c[3].toUpperCase() === "BYTE" ? "byte" : "char") : null, file, line: lineAt(bodyStart + from + (piece.length - piece.trimStart().length)) });
    };
    for (let k = 0; k < body.length; k++) { const ch = body[k]; if (ch === "(") d2++; else if (ch === ")") d2--; else if (ch === "," && d2 === 0) { seg(segStart, k); segStart = k + 1; } }
    seg(segStart, body.length);
  }
  return out;
}
/** INSERT·UPDATE 문장에서 #{field} ↔ 컬럼 짝. INSERT 는 컬럼 목록과 VALUES 의 같은 자리, UPDATE 는 COL = #{field} */
export function fieldColumnPairs(kind: "insert" | "update", body: string): { table: string; column: string; field: string }[] {
  const sql = body.replace(/<[^>]+>/g, " ");
  const out: { table: string; column: string; field: string }[] = [];
  const fieldOf = (expr: string) => /#\{\s*([\w.]+)/.exec(expr)?.[1].split(".").pop() ?? null;
  if (kind === "insert") {
    const m = /INSERT\s+INTO\s+[`"]?(?:\w+\.)?(\w+)[`"]?\s*\(([^)]*)\)\s*VALUES\s*\(/i.exec(sql);
    if (!m) return out;
    const cols = m[2].split(",").map((c) => c.trim().replace(/[`"]/g, "").toUpperCase());
    // VALUES 괄호 안을 최상위 쉼표로 나눈다(함수 호출의 쉼표 제외)
    const start = m.index + m[0].length;
    const vals: string[] = []; let depth = 0, cur = "";
    for (let i = start; i < sql.length; i++) { const c = sql[i]; if (c === "(" || c === "{") depth++; else if (c === "}") depth--; else if (c === ")") { if (depth === 0) { vals.push(cur); break; } depth--; } if (c === "," && depth === 0) { vals.push(cur); cur = ""; } else cur += c; }
    if (cols.length !== vals.length) return out;
    cols.forEach((col, i) => { const f = fieldOf(vals[i]); if (f && /^\w+$/.test(col)) out.push({ table: m[1].toUpperCase(), column: col, field: f }); });
  } else {
    const t = /UPDATE\s+[`"]?(?:\w+\.)?(\w+)[`"]?\s+(?:\w+\s+)?SET\b/i.exec(sql);
    if (!t) return out;
    const setPart = sql.slice(t.index + t[0].length).split(/\bWHERE\b/i)[0];
    for (const m of setPart.matchAll(/(?:^|,)\s*(?:\w+\.)?[`"]?(\w+)[`"]?\s*=\s*([^,]*)/g)) { const f = fieldOf(m[2]); if (f) out.push({ table: t[1].toUpperCase(), column: m[1].toUpperCase(), field: f }); }
  }
  return out;
}

/** 날짜 입력(2026-11-23, 10자)을 구분자 없이 CHAR(8) 로 저장하는 관용 — 컨트롤러가 구분자를 떼므로 길이 차이가 아니다 */
const dateFormatted = (field: string, max: number, col: number) => col === 8 && max === 10 && /(De|Date|Dt|Ymd|Day)$/.test(field);

export function checkConsistency(opts: ConsistencyOptions): ConsistencyResult {
  const t0 = Date.now();
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const files = walk(projectDir, opts.maxFiles ?? 30_000).map((p) => ({ abs: p, rel: rel(projectDir, p) })).filter((f) => !/(^|\/)src\/test\//.test(f.rel));
  const notes: string[] = [];
  const issues: ConsistencyIssue[] = [];
  const mappers: MapperFile[] = [];
  const sized: SizedField[] = [], inputs: JspInput[] = [], ddl: ColumnLength[] = [];
  for (const f of files) {
    if (f.rel.endsWith(".xml")) { if (/mapper|sqlmap|sql/i.test(f.rel) && !/pom\.xml$/.test(f.rel)) { const m = parseMapperForConsistency(f.rel, read(f.abs)); if (m) mappers.push(m); } }
    else if (f.rel.endsWith(".java")) sized.push(...parseSizedFields(f.rel, read(f.abs)));
    else if (/\.(jsp|jspf|html)$/.test(f.rel)) inputs.push(...parseJspInputs(f.rel, read(f.abs)));
  }
  // DDL: 이름에 ddl·schema·create 가 있는 스크립트가 있으면 그것만(공통컴포넌트는 적재 데이터 스크립트가 150MB), 없으면 5MB 이하의 .sql 전부
  const sqlFiles = files.filter((f) => f.rel.endsWith(".sql") && !/(^|\/)(dml|data)(\/|[_-])|_DML_|(^|\/)data[^/]*\.sql$/i.test(f.rel));
  const named = sqlFiles.filter((f) => /ddl|schema|create/i.test(f.rel));
  for (const f of named.length ? named : sqlFiles) { try { if (fs.statSync(f.abs).size > 5 * 1024 * 1024) continue; } catch { continue; } ddl.push(...parseDdlLengths(f.rel, read(f.abs))); }

  // ── 1) 목록·건수 쌍 ──
  let countPairs = 0, pairsCompared = 0;
  const seenPair = new Map<string, ConsistencyIssue>();
  for (const mf of mappers) {
    const ids = new Set(mf.stmts.keys());
    for (const c of mf.stmts.values()) {
      if (c.kind !== "select" || !COUNT_SUFFIX.test(c.id) || !/\bCOUNT\s*\(/i.test(c.body)) continue;
      const lid = listPartnerOf(c.id, ids);
      if (!lid) continue;
      const l = mf.stmts.get(lid)!;
      if (l.kind !== "select") continue;
      countPairs++;
      const lc = dynamicConditions(l.body), cc = dynamicConditions(c.body);
      if (!lc.length && !cc.length) continue;
      pairsCompared++;
      const key = (x: Cond) => `${x.test}|${x.columns.join(",")}`;
      const lk = new Set(lc.map(key)), ck = new Set(cc.map(key));
      const onlyList = lc.filter((x) => !ck.has(key(x))), onlyCount = cc.filter((x) => !lk.has(key(x)));
      if (!onlyList.length && !onlyCount.length) continue;
      const show = (xs: Cond[]) => xs.map((x) => `${x.raw}${x.columns.length ? ` → ${x.columns.join(",")}` : ""}`);
      const sig = `${mf.namespace}|${c.id}|${onlyList.map(key).join(";")}|${onlyCount.map(key).join(";")}`;
      const prev = seenPair.get(sig);
      if (prev) { prev.variants = (prev.variants ?? 1) + 1; continue; }
      // test 식은 양쪽에 다 있고 거르는 컬럼만 다르면(별칭·조인 차이일 수 있음) 경고
      const lt = new Set(lc.map((x) => x.test)), ct = new Set(cc.map((x) => x.test));
      const columnsOnly = onlyList.every((x) => ct.has(x.test)) && onlyCount.every((x) => lt.has(x.test));
      const issue: ConsistencyIssue = {
        kind: "count-condition-mismatch", severity: columnsOnly ? "warning" : "error", file: mf.rel, line: c.line, subject: `${mf.namespace}.${lid} ↔ ${c.id}`,
        message: L(`목록(${lid})과 건수(${c.id})의 검색조건이 다릅니다 — 페이지 수가 실제 목록과 맞지 않습니다${onlyList.length ? ` · 목록에만: ${show(onlyList).join(" / ")}` : ""}${onlyCount.length ? ` · 건수에만: ${show(onlyCount).join(" / ")}` : ""}`, `The list (${lid}) and count (${c.id}) statements filter differently — the page count will not match the list${onlyList.length ? ` · only in list: ${show(onlyList).join(" / ")}` : ""}${onlyCount.length ? ` · only in count: ${show(onlyCount).join(" / ")}` : ""}`),
        fix: L("두 문장의 WHERE 동적 조건을 같게 맞추세요(공통 조건을 <sql> 조각으로 빼 양쪽에서 include 하면 다시 어긋나지 않습니다)", "Make the dynamic WHERE conditions identical (extract them into a shared <sql> fragment and include it in both)"),
        detail: { list: lid, count: c.id, onlyInList: show(onlyList), onlyInCount: show(onlyCount) },
      };
      seenPair.set(sig, issue); issues.push(issue);
    }
  }

  // ── 2) 입력 길이 ──
  // VO 단순 이름 → 필드 → @Size
  const sizeOf = new Map<string, SizedField>();
  for (const s of sized) sizeOf.set(`${s.cls}.${s.field}`, s);
  const classByLower = new Map<string, string>();
  for (const s of sized) classByLower.set(s.cls.toLowerCase(), s.cls);
  // DDL: 컬럼 길이(같은 테이블·컬럼이 DB 별 스크립트에 여러 번이면 가장 짧은 것 — 가장 먼저 넘친다)
  const colLen = new Map<string, ColumnLength>();
  for (const c of ddl) { const k = `${c.table}.${c.column}`; const p = colLen.get(k); if (!p || c.length < p.length) colLen.set(k, c); }
  // 매퍼: VO(parameterType 단순 이름).field → 컬럼
  const link = new Map<string, { table: string; column: string; mapper: string; line: number }>();
  for (const mf of mappers) for (const s of mf.stmts.values()) {
    if ((s.kind !== "insert" && s.kind !== "update") || !s.param) continue;
    const cls = s.param.split(".").pop()!;
    for (const p of fieldColumnPairs(s.kind, s.body)) { const k = `${cls.toLowerCase()}.${p.field}`; if (!link.has(k)) link.set(k, { table: p.table, column: p.column, mapper: mf.rel, line: s.line }); }
  }
  let fieldsLinked = 0;
  const seenLen = new Set<string>();
  // (a) VO @Size > DDL
  for (const s of sized) {
    const lk = link.get(`${s.cls.toLowerCase()}.${s.field}`);
    if (!lk) continue;
    const col = colLen.get(`${lk.table}.${lk.column}`);
    if (!col) continue;
    fieldsLinked++;
    if (s.max > col.length && !dateFormatted(s.field, s.max, col.length)) issues.push({ kind: "length-exceeds-column", severity: "error", file: s.file, line: s.line, subject: `${s.cls}.${s.field}`, message: L(`${s.cls}.${s.field} 의 @Size(max=${s.max}) 가 ${col.table}.${col.column} 길이 ${col.length}${col.unit === "byte" ? "바이트" : ""} 보다 깁니다 — 검증을 통과한 값이 저장 때 잘리거나 오류가 납니다`, `@Size(max=${s.max}) on ${s.cls}.${s.field} is longer than ${col.table}.${col.column} (${col.length}${col.unit === "byte" ? " bytes" : ""}) — a value that passes validation is truncated or fails on save`), fix: L(`@Size(max) 를 ${col.length} 이하로 줄이거나 컬럼을 늘리세요`, `Lower @Size(max) to ${col.length} or widen the column`), detail: { size: s.max, column: `${col.table}.${col.column}`, columnLength: col.length, ddl: `${col.file}:${col.line}` } });
  }
  // (b) JSP maxlength > @Size, (c) JSP maxlength > DDL
  for (const i of inputs) {
    const cls = i.model ? classByLower.get(i.model.toLowerCase()) ?? i.model : null;
    if (!cls) continue;
    const key = `${i.file}|${cls}.${i.field}|${i.max}`;
    if (seenLen.has(key)) continue;
    seenLen.add(key);
    const s = sizeOf.get(`${cls}.${i.field}`);
    if (s && i.max > s.max) issues.push({ kind: "maxlength-exceeds-size", severity: "warning", file: i.file, line: i.line, subject: `${cls}.${i.field}`, message: L(`화면의 maxlength=${i.max} 가 ${cls}.${i.field} 의 @Size(max=${s.max}) 보다 깁니다 — 입력은 되는데 서버 검증에서 거부됩니다`, `maxlength=${i.max} on the form is longer than @Size(max=${s.max}) on ${cls}.${i.field} — the browser accepts input that server validation rejects`), fix: L(`maxlength 를 ${s.max} 이하로 맞추세요`, `Set maxlength to ${s.max} or less`), detail: { maxlength: i.max, size: s.max, vo: `${s.file}:${s.line}` } });
    const lk = link.get(`${cls.toLowerCase()}.${i.field}`);
    const col = lk ? colLen.get(`${lk.table}.${lk.column}`) : undefined;
    if (col && i.max > col.length && !s && !dateFormatted(i.field, i.max, col.length)) issues.push({ kind: "length-exceeds-column", severity: "error", file: i.file, line: i.line, subject: `${cls}.${i.field}`, message: L(`화면의 maxlength=${i.max} 가 ${col.table}.${col.column} 길이 ${col.length}${col.unit === "byte" ? "바이트" : ""} 보다 길고 VO 에 @Size 도 없어 서버가 막지 않습니다 — 저장 때 잘리거나 오류가 납니다`, `maxlength=${i.max} on the form is longer than ${col.table}.${col.column} (${col.length}${col.unit === "byte" ? " bytes" : ""}) and the server does not stop it (no @Size on the VO) — the value is truncated or fails on save`), fix: L(`maxlength 를 ${col.length} 이하로 줄이고 VO 에 @Size(max=${col.length}) 를 두세요`, `Lower maxlength to ${col.length} and add @Size(max=${col.length}) to the VO`), detail: { maxlength: i.max, column: `${col.table}.${col.column}`, columnLength: col.length, ddl: `${col.file}:${col.line}` } });
  }

  const SEV = { error: 0, warning: 1 } as const;
  issues.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || a.line - b.line);
  const byKind: Record<string, number> = {};
  for (const i of issues) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  if ([...colLen.values()].some((c) => c.unit === "byte" || /oracle|tibero|altibase/i.test(c.file))) notes.push(L("바이트 단위 컬럼(Oracle·Tibero 의 VARCHAR2(n) 기본값)은 한글 한 글자가 2–3바이트입니다 — 글자 수 기준의 maxlength·@Size 가 길이 이하여도 한글 입력은 넘칠 수 있습니다.", "Byte-length columns (the default for VARCHAR2(n) in Oracle and Tibero) store a Korean character in 2–3 bytes — Korean input can overflow even when maxlength and @Size are within the length."));
  if (sized.length && !fieldsLinked) notes.push(L("@Size 필드와 DDL 컬럼을 잇지 못했습니다 — 매퍼의 INSERT·UPDATE 가 parameterType 으로 VO 를 받는 경우에만 필드와 컬럼을 짝지습니다.", "No @Size field could be linked to a DDL column — fields are paired with columns only through mapper INSERT/UPDATE statements whose parameterType is the VO."));
  notes.push(L("목록·건수는 동적 조건(<if>·<when>)만 비교합니다 — 고정 WHERE·조인의 차이는 보지 않습니다. 화면 입력은 form:form 의 modelAttribute 로 VO 를 찾습니다.", "List/count pairs are compared on dynamic conditions (<if>, <when>) only — differences in static WHERE clauses or joins are not checked. Form inputs are linked to a VO through the modelAttribute of form:form."));
  const maxIssues = opts.maxIssues ?? 500;
  return {
    projectDir, durationMs: Date.now() - t0,
    summary: { mapperFiles: mappers.length, countPairs, pairsCompared, sizedFields: sized.length, maxlengthInputs: inputs.length, columnsWithLength: colLen.size, fieldsLinked, errors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length, byKind },
    issues: issues.slice(0, maxIssues), truncated: issues.length > maxIssues, notes,
  };
}

export function renderConsistencyMarkdown(r: ConsistencyResult, topN = 20): string {
  const s = r.summary;
  const out: string[] = [L("### 화면–쿼리–DB 정합성", "### Screen–query–DB consistency"), ""];
  out.push(L(`- 목록·건수 쌍 ${s.countPairs}개(동적 조건 비교 ${s.pairsCompared}) · @Size 필드 ${s.sizedFields} · maxlength 입력 ${s.maxlengthInputs} · 길이 있는 컬럼 ${s.columnsWithLength} · 필드–컬럼 연결 ${s.fieldsLinked}`, `- ${s.countPairs} list/count pairs (${s.pairsCompared} compared on dynamic conditions) · ${s.sizedFields} @Size fields · ${s.maxlengthInputs} maxlength inputs · ${s.columnsWithLength} columns with a length · ${s.fieldsLinked} field–column links`));
  out.push(L(`- **오류 ${s.errors} · 경고 ${s.warnings}**${Object.keys(s.byKind).length ? ` (${Object.entries(s.byKind).map(([k, v]) => `${k} ${v}`).join(" · ")})` : ""}`, `- **${s.errors} errors · ${s.warnings} warnings**${Object.keys(s.byKind).length ? ` (${Object.entries(s.byKind).map(([k, v]) => `${k} ${v}`).join(" · ")})` : ""}`));
  if (r.issues.length) {
    out.push("", L("| 등급 | 종류 | 대상 | 위치 | 내용 |", "| Severity | Kind | Subject | Location | Detail |"), "|---|---|---|---|---|");
    for (const i of r.issues.slice(0, topN)) out.push(`| ${i.severity} | ${i.kind} | ${i.subject} | \`${i.file}:${i.line}\`${i.variants && i.variants > 1 ? L(` 외 DB 사본 ${i.variants - 1}`, ` +${i.variants - 1} DB copies`) : ""} | ${i.message.replace(/\|/g, "\\|")} |`);
    if (r.issues.length > topN) out.push("", L(`… ${r.issues.length - topN}건 더(format=json 또는 topN)`, `… ${r.issues.length - topN} more (format=json or topN)`));
  }
  for (const n of r.notes) out.push(`- ${n}`);
  return out.join("\n");
}
