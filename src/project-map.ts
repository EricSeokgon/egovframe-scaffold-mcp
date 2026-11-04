// 프로젝트 구조 지도·변경 영향 (map_egovframe_project, v1.14.0) — 읽기 전용, 정적 해석.
//   테이블 → 매퍼 XML(네임스페이스 단위, DB 별 사본은 하나로) → DAO/Mapper 인터페이스 → Service → Controller → URL → 화면(JSP·Thymeleaf)의
//   노드·간선을 파일·정규식·간단한 심볼 테이블로 만든다. 런타임 추적은 없다.
//   표준프레임워크 규약(EgovComAbstractDAO 의 "네임스페이스.id" 문자열, @Resource(name=…), *ServiceImpl)과 Spring 어노테이션(@Mapper·@Autowired·@GetMapping)을 둘 다 읽는다.
//   동적 SQL 의 ${…} 테이블 이름은 해석하지 않고 unresolved 로 센다.
import * as fs from "node:fs";
import * as path from "node:path";
import { loadCatalog } from "./catalog.js";
import { readManifest } from "./manifest.js";
import { L } from "./lang.js";

export type MapNodeType = "table" | "mapper" | "class" | "url" | "view";
export type ClassRole = "controller" | "service" | "service-impl" | "dao" | "mapper-interface" | "other";
export type EdgeKind = "reads" | "writes" | "calls" | "injects" | "implements" | "maps" | "renders" | "links";
export interface MapNode {
  id: string;
  type: MapNodeType;
  /** 표시 이름(테이블명·네임스페이스·FQN·URL·뷰 이름) */
  name: string;
  /** 프로젝트 상대 파일(테이블·미해석 뷰는 없음) */
  file?: string;
  files?: string[];
  role?: ClassRole;
  /** 공통컴포넌트 id(카탈로그 경로 접두어) */
  component?: string;
  /** 멀티 모듈의 모듈 디렉터리 */
  module?: string;
  /** mapper: 문장 수 / class: 메서드 수 등 */
  count?: number;
}
export interface MapEdge { from: string; to: string; kind: EdgeKind; /** reads/writes: 문장 id, maps: HTTP 메서드, calls: 문장 id 수 */ detail?: string }
export interface MapperStatement { namespace: string; id: string; kind: "select" | "insert" | "update" | "delete"; tables: string[]; unresolved: number; file: string; line: number }
export interface ImpactResult {
  start: MapNode;
  direction: "upstream" | "downstream" | "both";
  nodes: { node: MapNode; distance: number; via: string }[];
  byType: Record<MapNodeType, number>;
}
export interface ProjectMap {
  projectDir: string;
  generatedAt: string;
  durationMs: number;
  nodes: MapNode[];
  edges: MapEdge[];
  statements: MapperStatement[];
  summary: {
    files: { java: number; mapperXml: number; views: number };
    tables: number; mappers: number; statements: number; classes: Record<ClassRole, number>; urls: number; views: number;
    unresolvedStatements: number; unresolvedViews: number;
    orphanMappers: number; orphanStatements: number; controllersWithoutUrl: number; unreferencedTables: number;
    /** 해석 실패율 = (미해석 문장 + 미해석 뷰) / (문장 + 뷰 참조) */
    unresolvedRate: number;
    modules: string[];
  };
  orphans: { mappers: string[]; statements: string[]; controllersWithoutUrl: string[]; unreferencedTables: string[] };
  /** 카탈로그가 아는 설치 컴포넌트의 테이블(참조 여부) */
  componentTables: { component: string; tables: number; referenced: number }[];
  impact?: ImpactResult;
  notes: string[];
}
export interface MapOptions {
  projectDir: string;
  /** 공통컴포넌트 id 로 범위를 좁힘(그 접두어 아래 파일 + 거기서 닿는 테이블·URL) */
  components?: string[];
  /** 영향 조회 — 한 가지만 */
  impact?: { table?: string; url?: string; class?: string; view?: string };
  maxFiles?: number;
}

const SKIP_DIRS = new Set(["target", "build", "node_modules", ".git", "migration-backup", "deploy", "sbom", "bin", "out", ".idea", ".settings", "test"]);
const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");
const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const SQL_KEYWORDS = new Set(["SELECT", "WHERE", "SET", "VALUES", "DUAL", "AND", "OR", "ON", "AS", "ORDER", "GROUP", "BY", "LEFT", "RIGHT", "INNER", "OUTER", "JOIN", "NOT", "EXISTS", "IN", "CASE", "WHEN", "THEN", "ELSE", "END", "NULL", "DISTINCT", "UNION", "ALL", "TOP", "LIMIT", "OFFSET", "SYSDATE", "NOW", "CURRENT_TIMESTAMP", "ROWNUM", "IF", "COUNT", "WAIT", "NOWAIT", "SKIP", "LOCKED", "ONLY", "FETCH", "FIRST", "NEXT", "ROWS", "START", "WITH", "USING", "VALUE", "LATERAL", "UNNEST"]);

function walk(root: string, max: number, out: string[] = []): string[] {
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(p); continue; }
      if (e.isFile()) out.push(p);
    }
  }
  return out.sort();
}
const stripXmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
const stripJavaComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
const lineOf = (text: string, idx: number) => text.slice(0, idx).split("\n").length;

/** SQL 본문에서 테이블 이름 — FROM/JOIN/UPDATE/INTO/DELETE FROM 뒤 식별자, 서브쿼리 괄호·${} 는 미해석 */
export function tablesInSql(sql: string): { tables: string[]; unresolved: number } {
  const tables = new Set<string>();
  let unresolved = 0;
  const body = sql.replace(/<!\[CDATA\[|\]\]>/g, " ").replace(/<[^>]+>/g, " ");
  const re = /\b(FROM|JOIN|UPDATE|INTO|TABLE)\s+(\(|\$\{[^}]*\}|#\{[^}]*\}|[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const kw = m[1].toUpperCase(); const t = m[2];
    if (t === "(") continue; // 서브쿼리
    if (t.startsWith("${") || t.startsWith("#{")) { unresolved++; continue; }
    const name = t.includes(".") ? t.split(".").pop()! : t;
    const up = name.toUpperCase();
    if (SQL_KEYWORDS.has(up) || (kw === "TABLE" && !/^(CREATE|DROP|ALTER|TRUNCATE)/i.test(body.slice(Math.max(0, m.index - 12), m.index)))) continue;
    if (kw === "FROM" && /^(DUAL|SYSIBM)/.test(up)) continue;
    tables.add(up);
  }
  // FROM A, B 형태의 추가 테이블
  const from = /\bFROM\s+([A-Za-z_][\w$.]*)(?:\s+(?!WHERE\b|JOIN\b|ON\b|LEFT\b|RIGHT\b|INNER\b|OUTER\b|ORDER\b|GROUP\b|UNION\b|FOR\b|LIMIT\b)[A-Za-z_]\w*)?((?:\s*,\s*[A-Za-z_][\w$.]*(?:\s+(?!WHERE\b|JOIN\b|ON\b|ORDER\b|GROUP\b|FOR\b|LIMIT\b)[A-Za-z_]\w*)?)+)/gi;
  while ((m = from.exec(body))) for (const part of m[2].split(",").slice(1)) { const t = part.trim().split(/\s+/)[0]; if (t) { const up = (t.includes(".") ? t.split(".").pop()! : t).toUpperCase(); if (!SQL_KEYWORDS.has(up)) tables.add(up); } }
  return { tables: [...tables].sort(), unresolved };
}

interface JavaInfo {
  file: string; pkg: string; name: string; fqn: string; isInterface: boolean;
  role: ClassRole; beanName: string | null; extendsName: string | null; implementsNames: string[];
  /** 주입 필드: 타입 단순명·빈 이름 */
  injects: { type: string; bean: string | null }[];
  /** "네임스페이스.문장id" 문자열 호출 */
  statementRefs: string[];
  /** 클래스·메서드 매핑 URL */
  urls: { url: string; method: string; line: number }[];
  views: { name: string; line: number }[];
  methods: number;
}
const ANNOT_NAME = (s: string, a: string) => { const m = s.match(new RegExp(`@${a}\\s*\\(\\s*(?:value\\s*=\\s*)?"([^"]*)"`)); return m ? m[1] : null; };
function parseJava(file: string, text: string): JavaInfo | null {
  const src = stripJavaComments(text);
  const pkg = src.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? "";
  const decl = src.match(/^\s*(?:public\s+|abstract\s+|final\s+)*(class|interface|enum|record)\s+(\w+)(?:<[^>{]*>)?(?:\s+extends\s+([\w.<>,\s]+?))?(?:\s+implements\s+([\w.<>,\s]+?))?\s*\{/m);
  if (!decl) return null;
  const name = decl[2];
  const isInterface = decl[1] === "interface";
  const head = src.slice(0, decl.index);
  const extendsName = decl[3]?.trim().split(/\s*,\s*/)[0]?.replace(/<.*$/, "") ?? null;
  const implementsNames = (decl[4] ?? "").split(/\s*,\s*/).map((x) => x.replace(/<.*$/, "").trim()).filter(Boolean);
  const annots: string[] = head.match(/@\w+/g) ?? [];
  const has = (a: string) => annots.includes(`@${a}`);
  let role: ClassRole = "other";
  if (has("Controller") || has("RestController")) role = "controller";
  else if (has("Mapper") || (isInterface && /Mapper$/.test(name))) role = "mapper-interface";
  else if (has("Repository") || /DAO$/i.test(name) || /AbstractDAO|AbstractMapper/.test(extendsName ?? "")) role = "dao";
  else if (has("Service") && !isInterface) role = "service-impl";
  else if (/ServiceImpl$/.test(name)) role = "service-impl";
  else if (isInterface && /Service$/.test(name)) role = "service";
  const beanName = ANNOT_NAME(head, "Service") ?? ANNOT_NAME(head, "Repository") ?? ANNOT_NAME(head, "Controller") ?? ANNOT_NAME(head, "Component") ?? ANNOT_NAME(head, "Mapper");
  const body = src.slice(decl.index! + decl[0].length);
  const injects: JavaInfo["injects"] = [];
  const fieldRe = /@(Resource|Autowired|Inject)(\s*\(\s*(?:name\s*=\s*)?"([^"]*)"\s*\))?[\s\S]{0,80}?(?:private|protected|public)?\s*(?:final\s+)?([A-Z]\w*)(?:<[^>]*>)?\s+\w+\s*[;=]/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(body))) injects.push({ type: m[4], bean: m[3] ?? null });
  // 생성자 주입(final 필드)
  const ctorRe = new RegExp(`\\b${name}\\s*\\(([^)]*)\\)\\s*\\{`, "g");
  while ((m = ctorRe.exec(body))) for (const p of m[1].split(",")) { const t = p.trim().match(/^(?:final\s+)?(?:@\w+(?:\([^)]*\))?\s+)*([A-Z]\w*)(?:<[^>]*>)?\s+\w+$/); if (t && /(Service|DAO|Dao|Mapper|Repository)$/.test(t[1])) injects.push({ type: t[1], bean: null }); }
  const statementRefs = [...body.matchAll(/\b(?:selectList|selectOne|selectByPk|select|insert|update|delete|list|queryForList|queryForObject|selectMap)\s*\(\s*"([\w$.]+\.[\w$]+)"/g)].map((x) => x[1]);
  const urls: JavaInfo["urls"] = [];
  const classUrl = ANNOT_NAME(head, "RequestMapping") ?? "";
  const mapRe = /@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\b(?:\s*\(([^)]*)\))?/g;
  while ((m = mapRe.exec(body))) {
    const inner = m[2] ?? "";
    const vals = [...inner.matchAll(/"([^"]*)"/g)].map((x) => x[1]).filter((v) => v.startsWith("/") || !/method|produces|consumes|headers|params/.test(inner));
    const method = m[1] === "RequestMapping" ? (inner.match(/RequestMethod\.(\w+)/)?.[1] ?? "ANY") : m[1].replace("Mapping", "").toUpperCase();
    const line = lineOf(src, decl.index! + decl[0].length + m.index);
    for (const v of vals.length ? vals : [""]) urls.push({ url: joinUrl(classUrl, v), method, line });
  }
  const views: { name: string; line: number }[] = [];
  const viewRe = /return\s+"([^"\n]+)"\s*;|new\s+ModelAndView\s*\(\s*"([^"\n]+)"|setViewName\s*\(\s*"([^"\n]+)"/g;
  while ((m = viewRe.exec(body))) { const v = (m[1] ?? m[2] ?? m[3]).trim(); if (v && !/\s/.test(v) && v.includes("/") && !/^(forward|redirect):/.test(v) && !/\.(do|json)$/.test(v) && !/^https?:/.test(v)) views.push({ name: v, line: lineOf(src, decl.index! + decl[0].length + m.index) }); }
  const redirects = [...body.matchAll(/"(?:forward|redirect):([^"?\s]+)/g)].map((x) => x[1]);
  for (const r of redirects) if (r.startsWith("/")) urls.push({ url: r, method: "FORWARD", line: 0 });
  const methods = (body.match(/^\s*(?:public|protected|private)\s+(?:static\s+)?[\w<>\[\],\s.?]+\s+\w+\s*\([^;{]*\)\s*(?:throws [\w.,\s]+)?\s*\{/gm) ?? []).length;
  return { file, pkg, name, fqn: pkg ? `${pkg}.${name}` : name, isInterface, role, beanName, extendsName, implementsNames, injects, statementRefs, urls, views, methods };
}
const joinUrl = (a: string, b: string) => { const u = `${a.replace(/\/+$/, "")}/${b.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/"); return u === "" ? "/" : u.length > 1 ? u.replace(/\/$/, "") || "/" : u; };

interface MapperXml { file: string; namespace: string; statements: MapperStatement[] }
function parseMapperXml(file: string, text: string): MapperXml | null {
  const src = stripXmlComments(text);
  const ns = src.match(/<(?:mapper|sqlMap)\s+[^>]*namespace\s*=\s*"([^"]*)"/)?.[1];
  if (ns === undefined) return null;
  const statements: MapperStatement[] = [];
  const re = /<(select|insert|update|delete)\s+([^>]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const id = m[2].match(/\bid\s*=\s*"([^"]*)"/)?.[1];
    if (!id) continue;
    const { tables, unresolved } = tablesInSql(m[3]);
    statements.push({ namespace: ns, id, kind: m[1] as MapperStatement["kind"], tables, unresolved, file, line: lineOf(src, m.index) });
  }
  return { file, namespace: ns, statements };
}

const URL_IN_VIEW = /(?:["'(=]|@\{)\s*((?:\/[\w\-.]+)+\.(?:do|json|html)|\/[\w\-./]*)(?=["')}?#\s])/g;
function urlsInView(text: string): string[] {
  const out = new Set<string>();
  const src = text.replace(/<%--[\s\S]*?--%>/g, " ").replace(/<!--[\s\S]*?-->/g, " ");
  let m: RegExpExecArray | null;
  while ((m = URL_IN_VIEW.exec(src))) { const u = m[1]; if (/\.(do|json)$/.test(u) || (/^\/[a-z][\w\-/]*$/i.test(u) && !/\.(css|js|png|gif|jpg|svg|ico|woff2?|ttf|map)$/i.test(u) && !/^\/(css|js|images?|img|static|fonts?|webjars|resources)\b/.test(u) && u.length > 1)) out.add(u); }
  return [...out];
}

export function buildProjectMap(opts: MapOptions): ProjectMap {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const t0 = Date.now();
  const notes: string[] = [];
  const catalog = loadCatalog();
  const compOf = (r: string): string | undefined => { for (const c of catalog.components) if (c.pathPrefixes.some((p) => r.startsWith(p))) return c.id; return undefined; };
  const files = walk(projectDir, opts.maxFiles ?? 30_000).map((p) => ({ abs: p, rel: rel(projectDir, p) })).filter((f) => !/(^|\/)src\/test\//.test(f.rel));
  const modules = (() => {
    const pom = read(path.join(projectDir, "pom.xml"));
    return [...stripXmlComments(pom).matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)].map((m) => m[1].replace(/^\.\//, ""));
  })();
  const moduleOf = (r: string) => modules.find((m) => r.startsWith(`${m}/`));
  const scope = opts.components?.length ? catalog.components.filter((c) => opts.components!.includes(c.id)).flatMap((c) => c.pathPrefixes) : null;
  if (opts.components?.length && !scope?.length) throw new Error(L(`알 수 없는 컴포넌트: ${opts.components.join(", ")}`, `Unknown components: ${opts.components.join(", ")}`));
  const inScope = (r: string) => !scope || scope.some((p) => r.startsWith(p));

  const javas: JavaInfo[] = [];
  const mappers = new Map<string, { namespace: string; files: string[]; statements: MapperStatement[] }>();
  const viewFiles: { rel: string; urls: string[] }[] = [];
  let javaCount = 0, mapperXmlCount = 0;
  for (const f of files) {
    if (!inScope(f.rel) && !(scope && /\.(jsp|html)$/.test(f.rel))) continue;
    if (f.rel.endsWith(".java")) { javaCount++; const j = parseJava(f.rel, read(f.abs)); if (j) javas.push(j); }
    else if (f.rel.endsWith(".xml") && /mapper|sqlmap|sql/i.test(f.rel) && !/pom\.xml$|sql-mapper-config|sql-map-config|context-/.test(f.rel)) {
      const x = parseMapperXml(f.rel, read(f.abs));
      if (!x) continue;
      mapperXmlCount++;
      const e = mappers.get(x.namespace) ?? { namespace: x.namespace, files: [], statements: [] };
      e.files.push(x.file);
      for (const s of x.statements) { const prev = e.statements.find((p) => p.id === s.id); if (prev) { for (const t of s.tables) if (!prev.tables.includes(t)) prev.tables.push(t); prev.unresolved = Math.max(prev.unresolved, s.unresolved); } else e.statements.push(s); }
      mappers.set(x.namespace, e);
    } else if (/\.(jsp|jspf|html)$/.test(f.rel) && /(WEB-INF|templates|webapp)/.test(f.rel) && !/node_modules|\/static\//.test(f.rel)) {
      if (scope && !inScope(f.rel)) continue;
      viewFiles.push({ rel: f.rel, urls: urlsInView(read(f.abs)) });
    }
  }

  // ── 노드 ──
  const nodes = new Map<string, MapNode>();
  const edges: MapEdge[] = [];
  const edgeSet = new Set<string>();
  const addNode = (n: MapNode) => { const prev = nodes.get(n.id); if (prev) return prev; nodes.set(n.id, n); return n; };
  const addEdge = (from: string, to: string, kind: EdgeKind, detail?: string) => { const k = `${from}|${to}|${kind}`; if (edgeSet.has(k)) { if (detail) { const e = edges.find((x) => `${x.from}|${x.to}|${x.kind}` === k)!; if (e.detail && !e.detail.split(",").includes(detail)) e.detail += `,${detail}`; } return; } edgeSet.add(k); edges.push({ from, to, kind, ...(detail ? { detail } : {}) }); };
  const tableId = (t: string) => `table:${t}`, mapperId = (ns: string) => `mapper:${ns}`, classId = (fqn: string) => `class:${fqn}`, urlId = (u: string) => `url:${u}`, viewId = (v: string) => `view:${v}`;

  const statements: MapperStatement[] = [];
  for (const m of mappers.values()) {
    addNode({ id: mapperId(m.namespace), type: "mapper", name: m.namespace, file: m.files[0], files: m.files, count: m.statements.length, component: compOf(m.files[0]), module: moduleOf(m.files[0]) });
    for (const s of m.statements) {
      statements.push(s);
      for (const t of s.tables) { addNode({ id: tableId(t), type: "table", name: t }); addEdge(mapperId(m.namespace), tableId(t), s.kind === "select" ? "reads" : "writes", s.id); }
    }
  }
  const bySimple = new Map<string, JavaInfo[]>(), byBean = new Map<string, JavaInfo>(), byFqn = new Map<string, JavaInfo>();
  for (const j of javas) { bySimple.set(j.name, [...(bySimple.get(j.name) ?? []), j]); if (j.beanName) byBean.set(j.beanName, j); byFqn.set(j.fqn, j); }
  const impls = new Map<string, JavaInfo[]>();
  for (const j of javas) for (const i of j.implementsNames) impls.set(i, [...(impls.get(i) ?? []), j]);
  for (const j of javas) addNode({ id: classId(j.fqn), type: "class", name: j.fqn, file: j.file, role: j.role, count: j.methods, component: compOf(j.file), module: moduleOf(j.file) });
  const nsIndex = new Map<string, string>(); // 단순명·FQN → 네임스페이스
  for (const ns of mappers.keys()) { nsIndex.set(ns, ns); nsIndex.set(ns.split(".").pop()!, ns); }
  for (const j of javas) {
    // 구현 관계
    for (const i of j.implementsNames) { const target = bySimple.get(i)?.[0]; if (target) addEdge(classId(j.fqn), classId(target.fqn), "implements"); }
    // Mapper 인터페이스 ↔ XML 네임스페이스(FQN 또는 단순명)
    if (j.role === "mapper-interface") { const ns = nsIndex.get(j.fqn) ?? nsIndex.get(j.name); if (ns) addEdge(classId(j.fqn), mapperId(ns), "calls", "namespace"); }
    // "네임스페이스.id" 문자열 호출
    for (const ref of j.statementRefs) {
      const idx = ref.lastIndexOf("."); const nsRaw = ref.slice(0, idx), sid = ref.slice(idx + 1);
      const ns = nsIndex.get(nsRaw) ?? nsIndex.get(nsRaw.split(".").pop()!);
      if (ns) addEdge(classId(j.fqn), mapperId(ns), "calls", sid);
    }
    // 주입: 빈 이름 → 타입(인터페이스면 구현체도)
    for (const inj of j.injects) {
      let target = (inj.bean && byBean.get(inj.bean)) || bySimple.get(inj.type)?.[0];
      // 인터페이스 타입으로 주입하면 구현체가 하나일 때 구현체로(인터페이스 노드는 implements 간선으로 이어짐)
      if (target?.isInterface && target.role !== "mapper-interface" && impls.get(target.name)?.length === 1) target = impls.get(target.name)![0];
      if (!target || target.fqn === j.fqn) continue;
      addEdge(classId(j.fqn), classId(target.fqn), "injects");
    }
    for (const u of j.urls) { addNode({ id: urlId(u.url), type: "url", name: u.url }); if (u.method === "FORWARD") addEdge(classId(j.fqn), urlId(u.url), "links", "forward"); else addEdge(urlId(u.url), classId(j.fqn), "maps", u.method); }
  }
  // 뷰: 이름 → 파일(접미 일치)
  const viewByName = new Map<string, string>();
  for (const v of viewFiles) { const noExt = v.rel.replace(/\.(jsp|jspf|html)$/, ""); viewByName.set(noExt, v.rel); }
  const resolveView = (name: string): string | null => { const n = name.replace(/^\//, ""); for (const [k, f] of viewByName) if (k === n || k.endsWith(`/${n}`)) return f; return null; };
  let unresolvedViews = 0, viewRefs = 0;
  for (const j of javas) for (const v of j.views) {
    viewRefs++;
    const f = resolveView(v.name);
    if (!f) unresolvedViews++;
    const id = viewId(f ?? v.name);
    addNode({ id, type: "view", name: f ?? v.name, ...(f ? { file: f, component: compOf(f), module: moduleOf(f) } : {}) });
    addEdge(classId(j.fqn), id, "renders");
  }
  for (const v of viewFiles) {
    const id = viewId(v.rel);
    const known = v.urls.filter((u) => nodes.has(urlId(u)));
    if (!known.length && !nodes.has(id)) continue; // 아무 데도 닿지 않는 화면(조각·정적)은 노드로 두지 않음
    addNode({ id, type: "view", name: v.rel, file: v.rel, component: compOf(v.rel), module: moduleOf(v.rel) });
    for (const u of known) addEdge(id, urlId(u), "links");
  }

  // ── 고아·미참조 ──
  const consumed = new Set<string>(); // mapper id 가 Java 에서 호출됨
  const consumedStatements = new Set<string>();
  for (const e of edges) if (e.kind === "calls") { consumed.add(e.to); if (e.detail && e.detail !== "namespace") for (const d of e.detail.split(",")) consumedStatements.add(`${e.to}|${d}`); }
  const mapperInterfaceNs = new Set(edges.filter((e) => e.kind === "calls" && e.detail === "namespace").map((e) => e.to));
  const orphanMappers = [...mappers.values()].filter((m) => !consumed.has(mapperId(m.namespace))).map((m) => m.namespace).sort();
  const shortId = (s: MapperStatement) => (s.id.startsWith(`${s.namespace}.`) ? s.id.slice(s.namespace.length + 1) : s.id);
  const orphanStatements = statements.filter((s) => consumed.has(mapperId(s.namespace)) && !mapperInterfaceNs.has(mapperId(s.namespace)) && !consumedStatements.has(`${mapperId(s.namespace)}|${shortId(s)}`) && !consumedStatements.has(`${mapperId(s.namespace)}|${s.id}`)).map((s) => `${s.namespace}.${shortId(s)}`).sort();
  const controllersWithoutUrl = javas.filter((j) => j.role === "controller" && !j.urls.some((u) => u.method !== "FORWARD")).map((j) => j.fqn).sort();
  const installed = (() => { try { return Object.keys(readManifest(projectDir)?.components ?? {}); } catch { return []; } })();
  const detected = new Set<string>([...installed, ...[...nodes.values()].map((n) => n.component).filter((x): x is string => !!x)]);
  const componentTables = [...detected].sort().map((id) => { const c = catalog.components.find((x) => x.id === id); const ts = c?.tables ?? []; return { component: id, tables: ts.length, referenced: ts.filter((t) => nodes.has(tableId(t))).length }; }).filter((x) => x.tables);
  const unreferencedTables = [...new Set(componentTables.flatMap((x) => (catalog.components.find((c) => c.id === x.component)?.tables ?? []).filter((t) => !nodes.has(tableId(t)))))].sort();

  const roles: Record<ClassRole, number> = { controller: 0, service: 0, "service-impl": 0, dao: 0, "mapper-interface": 0, other: 0 };
  for (const j of javas) roles[j.role]++;
  const unresolvedStatements = statements.filter((s) => s.unresolved > 0).length;
  const denom = statements.length + viewRefs;
  const summary: ProjectMap["summary"] = {
    files: { java: javaCount, mapperXml: mapperXmlCount, views: viewFiles.length },
    tables: [...nodes.values()].filter((n) => n.type === "table").length, mappers: mappers.size, statements: statements.length, classes: roles,
    urls: [...nodes.values()].filter((n) => n.type === "url").length, views: [...nodes.values()].filter((n) => n.type === "view").length,
    unresolvedStatements, unresolvedViews, orphanMappers: orphanMappers.length, orphanStatements: orphanStatements.length, controllersWithoutUrl: controllersWithoutUrl.length, unreferencedTables: unreferencedTables.length,
    unresolvedRate: denom ? Math.round(((unresolvedStatements + unresolvedViews) / denom) * 1000) / 1000 : 0,
    modules,
  };
  if (unresolvedStatements) notes.push(L(`동적 SQL(\${…} 테이블 이름) 문장 ${unresolvedStatements}개는 테이블을 해석하지 않았습니다 — 해당 매퍼의 영향은 과소평가될 수 있습니다.`, `${unresolvedStatements} statements with dynamic SQL (\${…} table names) were not resolved — the impact of those mappers may be underestimated.`));
  if (scope) notes.push(L(`범위: 컴포넌트 ${opts.components!.join(", ")} 의 경로 아래 파일(+ 거기에 닿는 화면)`, `Scope: files under the paths of components ${opts.components!.join(", ")} (+ views reaching them)`));
  const result: ProjectMap = { projectDir, generatedAt: new Date().toISOString(), durationMs: Date.now() - t0, nodes: [...nodes.values()], edges, statements, summary, orphans: { mappers: orphanMappers, statements: orphanStatements, controllersWithoutUrl, unreferencedTables }, componentTables, notes };
  if (opts.impact) result.impact = impactOf(result, opts.impact);
  result.durationMs = Date.now() - t0;
  return result;
}

/** 영향 조회: 테이블은 위로(사용하는 쪽), URL·화면은 아래로(사용하는 것)와 위로(링크하는 화면), 클래스는 양쪽 */
export function impactOf(map: ProjectMap, q: NonNullable<MapOptions["impact"]>): ImpactResult {
  const keys = Object.entries(q).filter(([, v]) => v);
  if (keys.length !== 1) throw new Error(L("impact 는 table·url·class·view 중 하나만 지정합니다", "impact takes exactly one of table, url, class or view"));
  const [kind, value] = keys[0] as [string, string];
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const find = (): MapNode | undefined => {
    if (kind === "table") return byId.get(`table:${value.toUpperCase()}`);
    if (kind === "url") return byId.get(`url:${value}`) ?? map.nodes.find((n) => n.type === "url" && n.name.endsWith(value));
    if (kind === "class") return byId.get(`class:${value}`) ?? map.nodes.find((n) => n.type === "class" && (n.name.endsWith(`.${value}`) || n.name === value));
    return byId.get(`view:${value}`) ?? map.nodes.find((n) => n.type === "view" && (n.name.endsWith(value) || n.name.endsWith(`${value}.jsp`) || n.name.endsWith(`${value}.html`)));
  };
  const start = find();
  if (!start) throw new Error(L(`지도에 없는 ${kind}: ${value}`, `Not in the map — ${kind}: ${value}`));
  // 방향: "사용" 간선은 위 → 아래(view→url→class→mapper→table). maps 는 url→class, 나머지는 from 이 사용자.
  type Adj = { to: string; kind: EdgeKind; detail?: string };
  const down = new Map<string, Adj[]>(), up = new Map<string, Adj[]>();
  for (const e of map.edges) { (down.get(e.from) ?? down.set(e.from, []).get(e.from)!).push({ to: e.to, kind: e.kind, detail: e.detail }); (up.get(e.to) ?? up.set(e.to, []).get(e.to)!).push({ to: e.from, kind: e.kind, detail: e.detail }); }
  const direction: ImpactResult["direction"] = kind === "table" ? "upstream" : "both";
  // URL·화면은 위로는 한 단계만(링크하는 화면 / 렌더링하는 Controller) — 화면 하나가 링크하는 모든 URL 로 번지지 않게
  const upLimit = kind === "url" || kind === "view" ? 1 : Infinity;
  const seen = new Map<string, { distance: number; via: string }>([[start.id, { distance: 0, via: "" }]]);
  // 매퍼는 문장 단위로 좁힌다: 테이블에서 위로 갈 때는 그 테이블을 읽고 쓰는 문장을 부르는 클래스만, 클래스에서 아래로 갈 때는 부른 문장의 테이블만
  const stmtsByNs = new Map<string, MapperStatement[]>();
  for (const st of map.statements) (stmtsByNs.get(st.namespace) ?? stmtsByNs.set(st.namespace, []).get(st.namespace)!).push(st);
  const shortId = (st: MapperStatement) => (st.id.startsWith(`${st.namespace}.`) ? st.id.slice(st.namespace.length + 1) : st.id);
  const allowed = new Map<string, Set<string> | null>(); // mapper id → 문장 id 집합(null = 전체)
  const allow = (mapper: string, ids: string[] | null) => { if (ids === null) { allowed.set(mapper, null); return; } const cur = allowed.get(mapper); if (cur === null) return; const set = cur ?? new Set<string>(); for (const x of ids) set.add(x); allowed.set(mapper, set); };
  const queue: { id: string; d: number; dir: "up" | "down" }[] = [{ id: start.id, d: 0, dir: "up" }];
  if (direction === "both") queue.push({ id: start.id, d: 0, dir: "down" });
  // 같은 노드라도 방향이 다르면 다시 펼친다(URL 에서 Controller 로 "위로" 먼저 닿아도 "아래로" 탐색은 계속)
  const expanded = new Set<string>([`${start.id}|up`, `${start.id}|down`]);
  const visit = (to: string, d: number, via: EdgeKind, dir: "up" | "down", expand = true) => {
    const node = byId.get(to); if (!node) return;
    if (!seen.has(to)) seen.set(to, { distance: d, via });
    if (!expand || node.type === "table" || expanded.has(`${to}|${dir}`)) return; // 테이블은 끝점 — 다른 매퍼로 번지지 않음
    expanded.add(`${to}|${dir}`);
    queue.push({ id: to, d, dir });
  };
  if (start.type === "mapper") allow(start.id, null);
  while (queue.length) {
    const { id, d, dir } = queue.shift()!;
    const cur = byId.get(id)!;
    if (dir === "up" && d >= upLimit) continue;
    const viewLinks = dir === "down" && id !== start.id && cur.type === "view"; // 아래로 갈 때 화면의 링크는 시작 화면에서만
    for (const n of (dir === "up" ? up : down).get(id) ?? []) {
      if (n.kind === "implements" || (viewLinks && n.kind === "links")) continue;
      const target = byId.get(n.to); if (!target) continue;
      if (cur.type === "table" && target.type === "mapper") { allow(n.to, n.detail ? n.detail.split(",") : null); visit(n.to, d + 1, n.kind, dir); continue; }
      if (cur.type === "mapper" && n.kind === "calls" && dir === "up") {
        // 문장을 부르는 클래스만(인터페이스 매핑 "namespace" 은 전체)
        const set = allowed.get(id);
        if (set && n.detail && n.detail !== "namespace" && !n.detail.split(",").some((x) => set.has(x))) continue;
        visit(n.to, d + 1, n.kind, dir); continue;
      }
      if (cur.type === "class" && target.type === "mapper" && dir === "down") { allow(n.to, n.detail && n.detail !== "namespace" ? n.detail.split(",") : null); visit(n.to, d + 1, n.kind, dir); continue; }
      if (cur.type === "mapper" && target.type === "table" && dir === "down") {
        const set = allowed.get(id);
        if (set) { const ids = n.detail?.split(",") ?? []; const ok = (stmtsByNs.get(cur.name) ?? []).some((st) => ids.includes(st.id) && (set.has(st.id) || set.has(shortId(st)))); if (!ok) continue; }
        visit(n.to, d + 1, n.kind, dir); continue;
      }
      visit(n.to, d + 1, n.kind, dir);
    }
    // 위로 갈 때 Controller 에 닿으면 그 화면(renders)도 영향(펼치지는 않음)
    if (dir === "up" && cur.type === "class") for (const n of down.get(id) ?? []) if (n.kind === "renders") visit(n.to, d + 1, "renders", dir, false);
    // 인터페이스 ↔ 구현체는 방향과 무관하게 같은 층으로 본다(거리 +1)
    for (const n of [...(up.get(id) ?? []), ...(down.get(id) ?? [])]) if (n.kind === "implements") visit(n.to, d + 1, "implements", dir);
  }
  seen.delete(start.id);
  const nodesOut = [...seen.entries()].map(([id, v]) => ({ node: byId.get(id)!, distance: v.distance, via: v.via })).sort((a, b) => a.distance - b.distance || a.node.type.localeCompare(b.node.type) || a.node.name.localeCompare(b.node.name));
  const byType: Record<MapNodeType, number> = { table: 0, mapper: 0, class: 0, url: 0, view: 0 };
  for (const n of nodesOut) byType[n.node.type]++;
  return { start, direction, nodes: nodesOut, byType };
}

// ── 인수인계 표 ──
export interface HandoverTables {
  screens: { url: string; method: string; controller: string; views: string[]; component?: string }[];
  programs: { controller: string; services: string[]; daos: string[]; mappers: string[]; component?: string }[];
  dbAccess: { table: string; C: string[]; R: string[]; U: string[]; D: string[] }[];
}
export function handoverTables(map: ProjectMap): HandoverTables {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const out = new Map<string, MapEdge[]>(), inc = new Map<string, MapEdge[]>();
  for (const e of map.edges) { (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e); (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push(e); }
  const screens: HandoverTables["screens"] = [];
  for (const n of map.nodes.filter((n) => n.type === "url")) for (const e of out.get(n.id)?.filter((e) => e.kind === "maps") ?? []) {
    const c = byId.get(e.to)!;
    screens.push({ url: n.name, method: e.detail ?? "ANY", controller: c.name, views: (out.get(c.id) ?? []).filter((x) => x.kind === "renders").map((x) => byId.get(x.to)!.name).sort(), ...(c.component ? { component: c.component } : {}) });
  }
  screens.sort((a, b) => a.url.localeCompare(b.url));
  const programs: HandoverTables["programs"] = [];
  const reach = (id: string, role: ClassRole[], depth = 4): Set<string> => { const s = new Set<string>(); const q = [{ id, d: 0 }]; const seen = new Set([id]); while (q.length) { const { id: cur, d } = q.shift()!; for (const e of out.get(cur) ?? []) { if (e.kind !== "injects" && e.kind !== "implements") continue; const n = byId.get(e.to)!; if (seen.has(n.id)) continue; seen.add(n.id); if (n.role && role.includes(n.role)) s.add(n.name); if (d < depth) q.push({ id: n.id, d: d + 1 }); } } return s; };
  for (const c of map.nodes.filter((n) => n.type === "class" && n.role === "controller")) {
    const services = reach(c.id, ["service", "service-impl"]), daos = reach(c.id, ["dao", "mapper-interface"]);
    const mappers = new Set<string>();
    for (const d of [c.id, ...[...daos].map((x) => `class:${x}`), ...[...services].map((x) => `class:${x}`)]) for (const e of out.get(d) ?? []) if (e.kind === "calls") mappers.add(byId.get(e.to)!.name);
    programs.push({ controller: c.name, services: [...services].sort(), daos: [...daos].sort(), mappers: [...mappers].sort(), ...(c.component ? { component: c.component } : {}) });
  }
  programs.sort((a, b) => a.controller.localeCompare(b.controller));
  const dbAccess: HandoverTables["dbAccess"] = [];
  for (const t of map.nodes.filter((n) => n.type === "table").sort((a, b) => a.name.localeCompare(b.name))) {
    const row = { table: t.name, C: [] as string[], R: [] as string[], U: [] as string[], D: [] as string[] };
    for (const s of map.statements) if (s.tables.includes(t.name)) { const k = s.kind === "insert" ? "C" : s.kind === "select" ? "R" : s.kind === "update" ? "U" : "D"; if (!row[k].includes(s.namespace)) row[k].push(s.namespace); }
    dbAccess.push(row);
  }
  return { screens, programs, dbAccess };
}

export function renderMermaid(map: ProjectMap, maxNodes = 200): string {
  const nodes = map.impact ? [map.impact.start, ...map.impact.nodes.map((n) => n.node)] : map.nodes;
  if (nodes.length > maxNodes) throw new Error(L(`Mermaid 는 ${maxNodes} 노드까지입니다(지금 ${nodes.length}) — components 또는 impact 로 범위를 좁히세요`, `Mermaid is limited to ${maxNodes} nodes (now ${nodes.length}) — narrow the scope with components or impact`));
  const ids = new Set(nodes.map((n) => n.id));
  const safe = (s: string) => s.replace(/[^\w]/g, "_");
  const label = (n: MapNode) => n.type === "class" ? n.name.split(".").pop()! : n.name;
  const shape = (n: MapNode) => n.type === "table" ? `[(${label(n)})]` : n.type === "url" ? `([${label(n)}])` : n.type === "view" ? `[/${label(n).split("/").pop()}/]` : n.type === "mapper" ? `[[${label(n)}]]` : `[${label(n)}]`;
  const out = ["flowchart LR"];
  for (const n of nodes) out.push(`  ${safe(n.id)}${shape(n)}`);
  for (const e of map.edges) if (ids.has(e.from) && ids.has(e.to)) out.push(`  ${safe(e.from)} -->|${e.kind}| ${safe(e.to)}`);
  return out.join("\n") + "\n";
}

export function renderProjectMapMarkdown(map: ProjectMap, topN = 30): string {
  const s = map.summary;
  const out: string[] = [];
  out.push(L(`# 프로젝트 구조 지도 — ${map.projectDir}`, `# Project structure map — ${map.projectDir}`), ``);
  out.push(L(`파일: Java ${s.files.java} · 매퍼 XML ${s.files.mapperXml} · 화면 ${s.files.views} (${Math.round(map.durationMs / 100) / 10}초)`, `Files: Java ${s.files.java} · mapper XML ${s.files.mapperXml} · views ${s.files.views} (${Math.round(map.durationMs / 100) / 10}s)`));
  out.push(L(`노드: 테이블 ${s.tables} · 매퍼(네임스페이스) ${s.mappers}(문장 ${s.statements}) · Controller ${s.classes.controller} · Service ${s.classes.service + s.classes["service-impl"]} · DAO/Mapper 인터페이스 ${s.classes.dao + s.classes["mapper-interface"]} · URL ${s.urls} · 화면 ${s.views}`, `Nodes: tables ${s.tables} · mappers (namespaces) ${s.mappers} (${s.statements} statements) · controllers ${s.classes.controller} · services ${s.classes.service + s.classes["service-impl"]} · DAO/mapper interfaces ${s.classes.dao + s.classes["mapper-interface"]} · URLs ${s.urls} · views ${s.views}`));
  out.push(L(`해석 실패율 ${(s.unresolvedRate * 100).toFixed(1)}% (동적 SQL 문장 ${s.unresolvedStatements} · 찾지 못한 뷰 ${s.unresolvedViews}) · 고아 매퍼 ${s.orphanMappers} · 호출 없는 문장 ${s.orphanStatements} · URL 없는 Controller ${s.controllersWithoutUrl} · 미참조 컴포넌트 테이블 ${s.unreferencedTables}${s.modules.length ? ` · 모듈 ${s.modules.join(", ")}` : ""}`, `Unresolved rate ${(s.unresolvedRate * 100).toFixed(1)}% (dynamic-SQL statements ${s.unresolvedStatements} · views not found ${s.unresolvedViews}) · orphan mappers ${s.orphanMappers} · uncalled statements ${s.orphanStatements} · controllers without URL ${s.controllersWithoutUrl} · unreferenced component tables ${s.unreferencedTables}${s.modules.length ? ` · modules ${s.modules.join(", ")}` : ""}`), ``);
  if (map.impact) {
    const i = map.impact;
    out.push(L(`## 영향: ${i.start.type} \`${i.start.name}\` (${i.direction === "upstream" ? "사용하는 쪽" : i.direction === "downstream" ? "사용하는 것" : "양방향"}, ${i.nodes.length}개)`, `## Impact: ${i.start.type} \`${i.start.name}\` (${i.direction}, ${i.nodes.length})`), ``);
    out.push(L(`테이블 ${i.byType.table} · 매퍼 ${i.byType.mapper} · 클래스 ${i.byType.class} · URL ${i.byType.url} · 화면 ${i.byType.view}`, `tables ${i.byType.table} · mappers ${i.byType.mapper} · classes ${i.byType.class} · URLs ${i.byType.url} · views ${i.byType.view}`), ``);
    out.push(L("| 거리 | 종류 | 이름 | 경유 |", "| Distance | Type | Name | Via |"), "|---|---|---|---|");
    for (const n of i.nodes.slice(0, Math.max(topN, 50))) out.push(`| ${n.distance} | ${n.node.type}${n.node.role ? `(${n.node.role})` : ""} | \`${n.node.name}\` | ${n.via} |`);
    if (i.nodes.length > Math.max(topN, 50)) out.push(L(`| … | | ${i.nodes.length - Math.max(topN, 50)}개 더 | |`, `| … | | ${i.nodes.length - Math.max(topN, 50)} more | |`));
    out.push(``);
  }
  const h = handoverTables(map);
  out.push(L(`## 화면 목록 (URL ${h.screens.length})`, `## Screen list (${h.screens.length} URLs)`), ``, L("| URL | 메서드 | Controller | 화면 |", "| URL | Method | Controller | Views |"), "|---|---|---|---|");
  for (const x of h.screens.slice(0, topN)) out.push(`| \`${x.url}\` | ${x.method} | \`${x.controller.split(".").pop()}\` | ${x.views.map((v) => `\`${v.split("/").pop()}\``).join(", ") || "—"} |`);
  if (h.screens.length > topN) out.push(L(`| … | | ${h.screens.length - topN}개 더(format=json) | |`, `| … | | ${h.screens.length - topN} more (format=json) | |`));
  out.push(``, L(`## 프로그램 목록 (Controller ${h.programs.length})`, `## Program list (${h.programs.length} controllers)`), ``, L("| Controller | Service | DAO/Mapper | 매퍼 네임스페이스 |", "| Controller | Services | DAO/Mapper | Mapper namespaces |"), "|---|---|---|---|");
  for (const x of h.programs.slice(0, topN)) out.push(`| \`${x.controller.split(".").pop()}\` | ${x.services.map((v) => `\`${v.split(".").pop()}\``).join(", ") || "—"} | ${x.daos.map((v) => `\`${v.split(".").pop()}\``).join(", ") || "—"} | ${x.mappers.map((v) => `\`${v}\``).join(", ") || "—"} |`);
  if (h.programs.length > topN) out.push(L(`| … | ${h.programs.length - topN}개 더 | | |`, `| … | ${h.programs.length - topN} more | | |`));
  out.push(``, L(`## DB 접근 표 (테이블 ${h.dbAccess.length})`, `## DB access table (${h.dbAccess.length} tables)`), ``, L("| 테이블 | C | R | U | D |", "| Table | C | R | U | D |"), "|---|---|---|---|---|");
  const cell = (a: string[]) => a.length ? a.map((v) => `\`${v}\``).join(", ") : "—";
  for (const x of h.dbAccess.slice(0, topN)) out.push(`| ${x.table} | ${cell(x.C)} | ${cell(x.R)} | ${cell(x.U)} | ${cell(x.D)} |`);
  if (h.dbAccess.length > topN) out.push(L(`| … | ${h.dbAccess.length - topN}개 더 | | | |`, `| … | ${h.dbAccess.length - topN} more | | | |`));
  out.push(``);
  if (map.componentTables.length) out.push(L(`공통컴포넌트 테이블(카탈로그): ${map.componentTables.map((c) => `${c.component} ${c.referenced}/${c.tables}`).join(" · ")}`, `Component tables (catalog): ${map.componentTables.map((c) => `${c.component} ${c.referenced}/${c.tables}`).join(" · ")}`), ``);
  if (map.orphans.mappers.length || map.orphans.statements.length || map.orphans.controllersWithoutUrl.length) {
    out.push(L("## 고아", "## Orphans"), ``);
    if (map.orphans.mappers.length) out.push(L(`- 호출하는 Java 가 없는 매퍼 네임스페이스 ${map.orphans.mappers.length}: ${map.orphans.mappers.slice(0, 10).join(", ")}${map.orphans.mappers.length > 10 ? " …" : ""}`, `- Mapper namespaces no Java calls (${map.orphans.mappers.length}): ${map.orphans.mappers.slice(0, 10).join(", ")}${map.orphans.mappers.length > 10 ? " …" : ""}`));
    if (map.orphans.statements.length) out.push(L(`- 호출 없는 문장 ${map.orphans.statements.length}: ${map.orphans.statements.slice(0, 10).join(", ")}${map.orphans.statements.length > 10 ? " …" : ""}`, `- Uncalled statements (${map.orphans.statements.length}): ${map.orphans.statements.slice(0, 10).join(", ")}${map.orphans.statements.length > 10 ? " …" : ""}`));
    if (map.orphans.controllersWithoutUrl.length) out.push(L(`- URL 매핑 없는 Controller ${map.orphans.controllersWithoutUrl.length}: ${map.orphans.controllersWithoutUrl.slice(0, 5).map((c) => c.split(".").pop()).join(", ")}`, `- Controllers without URL mapping (${map.orphans.controllersWithoutUrl.length}): ${map.orphans.controllersWithoutUrl.slice(0, 5).map((c) => c.split(".").pop()).join(", ")}`));
    out.push(``);
  }
  for (const n of map.notes) out.push(`- ${n}`);
  out.push(``, L("정적 해석입니다(파일·정규식). 런타임 호출·동적 SQL 의 테이블 이름·리플렉션은 보지 않습니다.", "Static analysis (files and regular expressions). Runtime calls, dynamic-SQL table names and reflection are not covered."));
  return out.join("\n");
}
