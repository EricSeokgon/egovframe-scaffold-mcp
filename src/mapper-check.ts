// 매퍼·DAO 정합성 점검 (validate_egovframe_project 의 mapper 검사, v1.19.0) — 읽기 전용, 정적 해석.
//   문자열 ID 로 매퍼 문장을 부르는 코드("NS.id")와 Mapper 인터페이스 메서드는 ID 가 틀려도 컴파일·기동이 통과하고
//   그 화면을 누를 때 "Mapped Statements collection does not contain value" 로 실패한다. 그런 곳을 미리 찾는다.
//   1) 없는 문장: DAO 의 문자열 호출·Mapper 인터페이스 메서드 → namespace.id 가 XML 에 없음(비슷한 이름 후보 첨부)
//   2) DB 종류별 차이: 같은 namespace 의 *_SQL_<db>.xml 사이 문장 ID 집합 차이(Globals.DbType 의 DB 에서 빠지면 오류)
//   3) XML 안 참조: <include refid>·resultMap 대상 없음, 같은 namespace·같은 DB 로 함께 올라가는 파일 사이 ID 중복
//      parameterType·resultType·resultMap type 의 프로젝트 패키지 클래스가 소스에 없음(경고)
//   iBATIS(sqlMap)·애노테이션 SQL(@Select 등) 본문은 보지 않는다. 고치지 않는다 — 후보만.
import * as fs from "node:fs";
import * as path from "node:path";
import { L } from "./lang.js";

export type MapperIssueKind = "missing-statement" | "missing-namespace" | "dynamic-unmatched" | "db-variant" | "include-missing" | "resultmap-missing" | "duplicate-id" | "type-missing";
export interface MapperIssue {
  kind: MapperIssueKind;
  severity: "error" | "warning";
  file: string;
  line: number;
  /** 문제의 대상(namespace.id·refid·클래스 이름) */
  ref: string;
  message: string;
  /** 비슷한 이름의 문장(편집 거리 순, 최대 3) */
  candidates?: string[];
  /** db-variant: 문장이 있는 DB·없는 DB */
  presentIn?: string[];
  missingIn?: string[];
}
export interface MapperCheckResult {
  projectDir: string;
  durationMs: number;
  dbType: string | null;
  counts: { mapperFiles: number; namespaces: number; statements: number; stringCalls: number; interfaceMethods: number; dynamicCalls: number; ibatisFiles: number };
  summary: { errors: number; warnings: number; missing: number; dynamicMatched: number; variantGaps: number; byKind: Record<string, number> };
  issues: MapperIssue[];
  notes: string[];
}
export interface MapperCheckOptions { projectDir: string; maxFiles?: number; /** 기본: Globals.DbType 값 */ dbType?: string | null; maxIssues?: number }

const SKIP_DIRS = new Set(["target", "build", "node_modules", ".git", "migration-backup", "upgrade-backup", "remove-backup", "deploy", "sbom", "bin", "out", ".idea", ".settings", ".gradle"]);
const DBS = ["altibase", "cubrid", "goldilocks", "maria", "mariadb", "mysql", "oracle", "postgres", "postgresql", "tibero", "hsql", "hsqldb", "h2", "mssql", "sqlserver", "db2", "dm", "kingbase"];
const VARIANT_RE = new RegExp(`^(.*?)[_-](${DBS.join("|")})\\.xml$`, "i");
const CALL_METHODS = "selectList|selectOne|selectMap|selectCursor|selectByPk|select|insert|update|delete|list|listWithPaging|selectPagingList|queryForList|queryForObject|queryForMap";
const KNOWN_ALIASES = new Set(["egovmap", "map", "hashmap", "list", "arraylist", "string", "int", "integer", "long", "short", "byte", "double", "float", "boolean", "date", "decimal", "bigdecimal", "object", "collection", "iterator", "_int", "_long", "_boolean", "_double", "_float", "_short", "_byte"]);

const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");
const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const lineOf = (text: string, idx: number) => { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };
const stripXmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " ")).replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (m) => m.replace(/[^\n]/g, " "));
const stripJavaComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"])\/\/[^\n]*/g, (m, a: string) => a + " ".repeat(m.length - a.length));

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
      if (e.isFile() && /\.(java|xml|properties|ya?ml)$/.test(e.name)) out.push(p);
    }
  }
  return out.sort();
}

/** 편집 거리(Levenshtein) — 짧은 ID 비교용 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
/** 비슷한 이름 후보 — 편집 거리 ≤ max(3, 길이의 40%), 또는 한쪽이 다른 쪽을 포함(접두·접미 차이) */
export function similarIds(id: string, pool: string[], limit = 3): string[] {
  const lower = id.toLowerCase();
  const subseq = (a: string, b: string) => { let i = 0; for (const c of b) if (c === a[i]) i++; return i === a.length; };
  return pool
    .map((p) => { const pl = p.toLowerCase(); return { p, d: editDistance(lower, pl), sub: subseq(lower, pl) || subseq(pl, lower) }; })
    .filter((x) => x.p !== id && (x.d <= Math.max(3, Math.floor(id.length * 0.4)) || (x.sub && Math.abs(x.p.length - id.length) <= 12)))
    // 한쪽이 다른 쪽의 부분열(글자를 끼우거나 뺀 이름 — upstream 수정의 정답 유형)을 먼저, 그다음 편집 거리
    .sort((a, b) => Number(b.sub) - Number(a.sub) || a.d - b.d || a.p.localeCompare(b.p))
    .slice(0, limit)
    .map((x) => x.p);
}

interface XmlFile { rel: string; text: string; namespace: string; db: string | null; group: string; ids: Map<string, number>; sqlIds: Map<string, number>; resultMaps: Map<string, number> }

export function checkMappers(opts: MapperCheckOptions): MapperCheckResult {
  const t0 = Date.now();
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const files = walk(projectDir, opts.maxFiles ?? 40_000).map((abs) => ({ abs, rel: rel(projectDir, abs) })).filter((f) => !/(^|\/)src\/test\//.test(f.rel));
  const notes: string[] = [];
  const issues: MapperIssue[] = [];

  // DbType
  let dbType = opts.dbType === undefined ? null : opts.dbType;
  if (opts.dbType === undefined) for (const f of files.filter((x) => /\.(properties|ya?ml)$/.test(x.rel))) { const m = read(f.abs).match(/^\s*Globals\.DbType\s*[=:]\s*([\w-]+)/m) ?? read(f.abs).match(/^\s*DbType\s*:\s*([\w-]+)/m); if (m) { dbType = m[1].toLowerCase(); break; } }

  // ── 매퍼 XML ──
  const xmls: XmlFile[] = [];
  let ibatisFiles = 0;
  for (const f of files.filter((x) => x.rel.endsWith(".xml"))) {
    const raw = read(f.abs);
    if (!/<mapper\b|<sqlMap\b/.test(raw)) continue;
    const src = stripXmlComments(raw);
    if (/<sqlMap\b[^>]*namespace\s*=/.test(src) && !/<mapper\b/.test(src)) { ibatisFiles++; continue; }
    const ns = src.match(/<mapper\s+[^>]*namespace\s*=\s*"([^"]*)"/)?.[1];
    if (ns === undefined) continue;
    const base = f.rel.split("/").pop()!;
    const vm = base.match(VARIANT_RE);
    const dirDb = f.rel.split("/").slice(0, -1).reverse().find((seg) => DBS.includes(seg.toLowerCase()))?.toLowerCase() ?? null;
    const db = vm ? vm[2].toLowerCase() : dirDb;
    const group = vm ? `${f.rel.slice(0, -base.length)}${vm[1]}` : dirDb ? f.rel.replace(new RegExp(`/${dirDb}/`, "i"), "/{db}/") : f.rel;
    const ids = new Map<string, number>(), sqlIds = new Map<string, number>(), resultMaps = new Map<string, number>();
    const re = /<(select|insert|update|delete|sql|resultMap)\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const rawId = m[2].match(/\bid\s*=\s*"([^"]*)"/)?.[1];
      if (!rawId) continue;
      // MyBatis 는 "namespace." 로 시작하는 id 를 그대로 쓴다(applyCurrentNamespace) — 짧은 id 로 맞춘다
      const id = rawId.startsWith(`${ns}.`) ? rawId.slice(ns.length + 1) : rawId;
      const line = lineOf(src, m.index);
      const map = m[1] === "sql" ? sqlIds : m[1] === "resultMap" ? resultMaps : ids;
      if (map.has(id) || (m[1] !== "sql" && m[1] !== "resultMap" && sqlIds.has(id))) issues.push({ kind: "duplicate-id", severity: "error", file: f.rel, line, ref: `${ns}.${id}`, message: L(`같은 매퍼 파일에 id="${id}" 가 둘 이상 — MyBatis 가 기동 때 실패`, `id="${id}" appears more than once in this mapper file — MyBatis fails at startup`) });
      else map.set(id, line);
    }
    xmls.push({ rel: f.rel, text: src, namespace: ns, db, group, ids, sqlIds, resultMaps });
  }
  if (ibatisFiles) notes.push(L(`iBATIS sqlMap ${ibatisFiles}개는 보지 않았습니다(범위 밖)`, `${ibatisFiles} iBATIS sqlMap file(s) were not checked (out of scope)`));

  // namespace → 파일들, 문장 ID 합집합(DB 별 사본 포함)
  const byNs = new Map<string, XmlFile[]>();
  for (const x of xmls) byNs.set(x.namespace, [...(byNs.get(x.namespace) ?? []), x]);
  const nsIds = new Map<string, Set<string>>();
  for (const [ns, list] of byNs) nsIds.set(ns, new Set(list.flatMap((x) => [...x.ids.keys()])));
  const nsBySimple = new Map<string, string[]>();
  for (const ns of byNs.keys()) { const s = ns.split(".").pop()!; nsBySimple.set(s, [...(nsBySimple.get(s) ?? []), ns]); }
  const resolveNs = (raw: string): string | null => byNs.has(raw) ? raw : (nsBySimple.get(raw.split(".").pop()!)?.length === 1 ? nsBySimple.get(raw.split(".").pop()!)![0] : null);
  // 같은 namespace 를 여러 파일이 나눠 선언하는 것은 MyBatis 가 허용한다(공통컴포넌트 menuManageDAO 등). 같은 DB 로 함께 올라가는 파일끼리
  // 같은 id 가 겹치면 "Mapped Statements collection already contains value" 로 기동 실패
  for (const [ns, list] of byNs) {
    if (list.length < 2) continue;
    const seen = new Map<string, string>();
    for (const x of [...list].sort((a, b) => a.rel.localeCompare(b.rel))) for (const [id, line] of x.ids) {
      const key = `${x.db ?? "*"}|${id}`;
      const prev = seen.get(key) ?? (x.db ? seen.get(`*|${id}`) : [...seen.entries()].find(([k]) => k.endsWith(`|${id}`))?.[1]);
      if (prev && prev !== x.rel) issues.push({ kind: "duplicate-id", severity: "error", file: x.rel, line, ref: `${ns}.${id}`, message: L(`같은 namespace 의 다른 매퍼(${prev})에도 id="${id}" — 함께 올라가면 기동 실패`, `id="${id}" is also in ${prev} with the same namespace — fails at startup when both load`) });
      else seen.set(key, x.rel);
    }
  }

  // ── DB 종류별 차이 ──
  let variantGaps = 0;
  for (const [ns, list] of byNs) {
    const dbFiles = list.filter((x) => x.db);
    const dbs = [...new Set(dbFiles.map((x) => x.db!))].sort();
    if (dbs.length < 2) continue;
    const all = new Set(dbFiles.flatMap((x) => [...x.ids.keys()]));
    for (const id of [...all].sort()) {
      const present = dbs.filter((d) => dbFiles.some((x) => x.db === d && x.ids.has(id)));
      if (present.length === dbs.length) continue;
      variantGaps++;
      const missingIn = dbs.filter((d) => !present.includes(d));
      const hit = dbType && missingIn.some((d) => d === dbType || (dbType === "maria" && d === "mysql") || (dbType === "mysql" && d === "maria"));
      const where = dbFiles.find((x) => x.db === present[0] && x.ids.has(id))!;
      issues.push({ kind: "db-variant", severity: hit ? "error" : "warning", file: where.rel, line: where.ids.get(id)!, ref: `${ns}.${id}`, presentIn: present, missingIn, message: hit ? L(`Globals.DbType=${dbType} 의 매퍼에 이 문장이 없음 — 호출하면 실패`, `The ${dbType} mapper (Globals.DbType) lacks this statement — calling it fails`) : L(`DB 별 매퍼 사이에 문장이 다름(없는 DB: ${missingIn.join(", ")})`, `Statement differs between DB-specific mappers (missing in: ${missingIn.join(", ")})`) });
    }
  }

  // ── XML 안 참조 ──
  const allSql = (ns: string) => new Set((byNs.get(ns) ?? []).flatMap((x) => [...x.sqlIds.keys()]));
  const allRm = (ns: string) => new Set((byNs.get(ns) ?? []).flatMap((x) => [...x.resultMaps.keys()]));
  const javaClasses = new Set<string>();
  const javaFiles = files.filter((x) => x.rel.endsWith(".java"));
  const javaTexts = new Map<string, string>();
  for (const f of javaFiles) { const t = read(f.abs); javaTexts.set(f.rel, t); const pkg = t.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1]; for (const c of t.matchAll(/\b(?:class|interface|enum|record)\s+(\w+)/g)) javaClasses.add(pkg ? `${pkg}.${c[1]}` : c[1]); }
  const pkgRoots = new Set([...javaClasses].map((c) => c.split(".").slice(0, 2).join(".")).filter((r) => r.includes(".")));
  const aliases = new Set<string>();
  for (const f of files.filter((x) => x.rel.endsWith(".xml"))) for (const a of read(f.abs).matchAll(/<typeAlias\b[^>]*\balias\s*=\s*"([^"]+)"/g)) aliases.add(a[1].toLowerCase());
  for (const x of xmls) {
    for (const m of x.text.matchAll(/<include\b[^>]*\brefid\s*=\s*"([^"$]+)"/g)) {
      const r = m[1]; const dot = r.lastIndexOf(".");
      const [ns, id] = dot > 0 ? [resolveNs(r.slice(0, dot)), r.slice(dot + 1)] : [x.namespace, r];
      if (!ns || !allSql(ns).has(id)) issues.push({ kind: "include-missing", severity: "error", file: x.rel, line: lineOf(x.text, m.index!), ref: r, message: L(`<include refid="${r}"> 의 <sql> 조각이 없음`, `<sql> fragment for <include refid="${r}"> not found`), candidates: ns ? similarIds(id, [...allSql(ns)]) : [] });
    }
    for (const m of x.text.matchAll(/\bresultMap\s*=\s*"([^"$]+)"/g)) {
      for (const r of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        const dot = r.lastIndexOf(".");
        const [ns, id] = dot > 0 ? [resolveNs(r.slice(0, dot)), r.slice(dot + 1)] : [x.namespace, r];
        if (!ns || !allRm(ns).has(id)) issues.push({ kind: "resultmap-missing", severity: "error", file: x.rel, line: lineOf(x.text, m.index!), ref: r, message: L(`resultMap="${r}" 대상이 없음 — 기동 때 실패`, `resultMap="${r}" not found — fails at startup`), candidates: ns ? similarIds(id, [...allRm(ns)]) : [] });
      }
    }
    for (const m of x.text.matchAll(/\b(parameterType|resultType|type|ofType|javaType)\s*=\s*"([\w.$]+)"/g)) {
      const t = m[2];
      if (!t.includes(".") || KNOWN_ALIASES.has(t.toLowerCase()) || aliases.has(t.toLowerCase())) continue;
      const root = t.split(".").slice(0, 2).join(".");
      if (!pkgRoots.has(root) || javaClasses.has(t.replace(/\$/g, "."))) continue;
      issues.push({ kind: "type-missing", severity: "warning", file: x.rel, line: lineOf(x.text, m.index!), ref: t, message: L(`${m[1]}="${t}" 클래스가 프로젝트 소스에 없음(옮겨졌거나 지워졌으면 기동 실패)`, `${m[1]}="${t}" class not found in project sources (startup fails if it was moved or removed)`), candidates: [...javaClasses].filter((c) => c.endsWith(`.${t.split(".").pop()}`)).slice(0, 3) });
    }
  }

  // ── Java: 문자열 ID 호출·Mapper 인터페이스 ──
  let stringCalls = 0, interfaceMethods = 0, dynamicCalls = 0, dynamicMatched = 0;
  const callRe = new RegExp(`\\b(?:${CALL_METHODS})\\s*\\(\\s*"([\\w$.]+)"\\s*(\\+)?`, "g");
  for (const [file, raw] of javaTexts) {
    const src = stripJavaComments(raw);
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(src))) {
      const ref = m[1]; const dynamic = !!m[2];
      if (!ref.includes(".") && !dynamic) continue;
      const line = lineOf(src, m.index);
      if (dynamic) {
        dynamicCalls++;
        const dot = ref.lastIndexOf(".");
        if (dot < 0) continue;
        const ns = resolveNs(ref.slice(0, dot)), prefix = ref.slice(dot + 1);
        const hits = ns ? [...nsIds.get(ns)!].filter((id) => id.startsWith(prefix)) : [];
        if (hits.length) dynamicMatched++;
        else if (ns || byNs.size) issues.push({ kind: "dynamic-unmatched", severity: "warning", file, line, ref: `${ref}…`, message: L(`문자열을 이어 만든 ID 의 앞부분 "${ref}" 로 시작하는 문장이 없음`, `No statement starts with "${ref}", the fixed part of a concatenated ID`) });
        continue;
      }
      stringCalls++;
      const dot = ref.lastIndexOf(".");
      const nsRaw = ref.slice(0, dot), id = ref.slice(dot + 1);
      const ns = resolveNs(nsRaw);
      if (!ns) { if (byNs.size) issues.push({ kind: "missing-namespace", severity: "error", file, line, ref, message: L(`namespace "${nsRaw}" 매퍼가 없음`, `No mapper with namespace "${nsRaw}"`), candidates: similarIds(nsRaw.split(".").pop()!, [...byNs.keys()].map((n) => n.split(".").pop()!)) }); continue; }
      if (!nsIds.get(ns)!.has(id)) issues.push({ kind: "missing-statement", severity: "error", file, line, ref, message: L(`매퍼 ${ns} 에 id="${id}" 문장이 없음 — 호출하면 "Mapped Statements collection does not contain value"`, `Mapper ${ns} has no statement id="${id}" — calling it fails with "Mapped Statements collection does not contain value"`), candidates: similarIds(id, [...nsIds.get(ns)!]) });
    }
    // Mapper 인터페이스: FQN 이 XML namespace 와 같은 인터페이스의 추상 메서드
    const pkg = src.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
    const im = src.match(/\binterface\s+(\w+)[^{]*\{/);
    if (!im) continue;
    const fqn = pkg ? `${pkg}.${im[1]}` : im[1];
    if (!byNs.has(fqn)) continue;
    const body = src.slice(im.index! + im[0].length);
    const methodRe = /((?:@\w+(?:\([^)]*\))?\s*)*)(?:public\s+|abstract\s+)*(?:<[^>]+>\s*)?[\w.<>?,\s[\]]+?\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?;/g;
    while ((m = methodRe.exec(body))) {
      const annots = m[1] ?? "";
      if (/@(Select|Insert|Update|Delete|SelectProvider|InsertProvider|UpdateProvider|DeleteProvider|Flush)\b/.test(annots)) continue;
      if (/\b(default|static)\b/.test(m[0].split("(")[0])) continue;
      interfaceMethods++;
      const id = m[2];
      if (!nsIds.get(fqn)!.has(id)) issues.push({ kind: "missing-statement", severity: "error", file, line: lineOf(src, im.index! + im[0].length + m.index + m[0].search(new RegExp(`\\b${id}\\s*\\(`))), ref: `${fqn}.${id}`, message: L(`Mapper 인터페이스 메서드 ${id} 의 XML 문장이 없음 — 호출하면 BindingException(Invalid bound statement)`, `No XML statement for mapper interface method ${id} — calling it throws BindingException (Invalid bound statement)`), candidates: similarIds(id, [...nsIds.get(fqn)!]) });
    }
  }
  if (!xmls.length) notes.push(L("MyBatis 매퍼 XML 이 없습니다 — 문자열 ID 호출은 의존성 jar 의 매퍼일 수 있어 보고하지 않습니다", "No MyBatis mapper XML found — string-ID calls may target mappers inside dependency jars, so they are not reported"));

  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1) || a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || a.line - b.line);
  const byKind: Record<string, number> = {};
  for (const i of issues) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  const errors = issues.filter((i) => i.severity === "error").length;
  const max = opts.maxIssues ?? 500;
  if (issues.length > max) notes.push(L(`항목 ${issues.length}건 중 ${max}건만 담았습니다(maxIssues)`, `Only ${max} of ${issues.length} issues included (maxIssues)`));
  return {
    projectDir, durationMs: Date.now() - t0, dbType,
    counts: { mapperFiles: xmls.length, namespaces: byNs.size, statements: [...nsIds.values()].reduce((s, x) => s + x.size, 0), stringCalls, interfaceMethods, dynamicCalls, ibatisFiles },
    summary: { errors, warnings: issues.length - errors, missing: (byKind["missing-statement"] ?? 0) + (byKind["missing-namespace"] ?? 0), dynamicMatched, variantGaps, byKind },
    issues: issues.slice(0, max),
    notes,
  };
}

export function renderMapperCheckMarkdown(r: MapperCheckResult, topN = 20): string {
  const out: string[] = [];
  out.push(L("### 매퍼·DAO 정합성", "### Mapper/DAO consistency"), "");
  out.push(L(`- 매퍼 XML ${r.counts.mapperFiles}개(namespace ${r.counts.namespaces}·문장 ${r.counts.statements}) · 문자열 ID 호출 ${r.counts.stringCalls} · 인터페이스 메서드 ${r.counts.interfaceMethods} · 이어 만든 ID ${r.counts.dynamicCalls}(맞는 문장 있음 ${r.summary.dynamicMatched})${r.dbType ? ` · Globals.DbType=${r.dbType}` : ""}`, `- ${r.counts.mapperFiles} mapper XML (${r.counts.namespaces} namespaces, ${r.counts.statements} statements) · ${r.counts.stringCalls} string-ID calls · ${r.counts.interfaceMethods} interface methods · ${r.counts.dynamicCalls} concatenated IDs (${r.summary.dynamicMatched} matched)${r.dbType ? ` · Globals.DbType=${r.dbType}` : ""}`));
  out.push(L(`- 오류 ${r.summary.errors} · 경고 ${r.summary.warnings} — 없는 문장 ${r.summary.missing} · DB 별 차이 ${r.summary.variantGaps}`, `- ${r.summary.errors} errors · ${r.summary.warnings} warnings — ${r.summary.missing} missing statements · ${r.summary.variantGaps} DB-variant gaps`), "");
  if (r.issues.length) {
    out.push(L("| 심각도 | 종류 | 위치 | 대상 | 후보 |", "| Severity | Kind | Location | Target | Candidates |"), "|---|---|---|---|---|");
    for (const i of r.issues.slice(0, topN)) out.push(`| ${i.severity} | ${i.kind} | \`${i.file}:${i.line}\` | \`${i.ref}\`${i.missingIn ? ` (${L("없음", "missing")}: ${i.missingIn.join(", ")})` : ""} | ${(i.candidates ?? []).map((c) => `\`${c}\``).join(", ") || "—"} |`);
    if (r.issues.length > topN) out.push("", L(`… ${r.issues.length - topN}건 더(format=json)`, `… ${r.issues.length - topN} more (format=json)`));
    out.push("");
  }
  for (const n of r.notes) out.push(`> ${n}`);
  return out.join("\n");
}
