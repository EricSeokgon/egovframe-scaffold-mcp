// DB 준비·검증 (prepare_egovframe_database, v1.10.0)
//   공통컴포넌트는 테이블 수백 개가 있어야 뜨는데, 지금까지는 조립 때 DbType 별 DDL·DML 을 선별해 두기만 하고 적재는 사용자가 했다.
//   upstream 의 열린 이슈 두 건이 모두 이 적재 문제다 — MySQL 8 Docker 초기화 스크립트의 한글 이중 인코딩(#1386),
//   latin1 클라이언트로 적재한 뒤 로그인 조회의 Illegal mix of collations(#1387). 이 모듈은
//   (1) 프로젝트의 스크립트(조립 선별본 scripts/egovframe-components/<db>/ · 공통컴포넌트 전체 script/ddl|dml/<db>/ · 지정 파일)를
//       문장 단위로 나눠 스키마·데이터로 가르고, 중복을 지우고, 외래키 순서로 테이블을 정렬하고,
//   (2) MySQL·MariaDB 는 테이블 문자셋(utf8mb4/utf8mb4_unicode_ci)과 SET NAMES 를, PostgreSQL 은 client_encoding 을 넣어
//       어느 클라이언트 문자셋으로 넣어도 같은 결과가 되게 하고,
//   (3) scripts/egovframe-db/<db>/01-schema.sql·02-data.sql 과 개발·테스트용 docker-compose.db.yml, 적재 명령(bash·cmd)을 만들며,
//   (4) run=true 면 Docker 로 DB 를 띄워 넣고 테이블 수·필수 행·한글 왕복을 확인한다(컨테이너는 keep=true 가 아니면 지움).
//   기존 파일은 덮어쓰지 않는다(같은 내용이면 그대로, 다르면 거부) — 비파괴 도구.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { withFileTransaction } from "./file-transaction.js";
import { readManifest } from "./manifest.js";
import { analyzeDeploy, loadDeployRules, DEPLOY_IMAGE_REGISTRY_RE } from "./deploy.js";
import { detectDbType } from "./crud.js";
import { loadCatalog } from "./catalog.js";
import { downloadComponentsZip } from "./components.js";
import { throwIfAborted, type Progress } from "./progress.js";
import { L } from "./lang.js";

export const DATABASE_TYPES = ["mysql", "maria", "postgres", "oracle", "tibero", "altibase", "cubrid", "goldilocks"] as const;
export type DbType = (typeof DATABASE_TYPES)[number];
/** Docker 로 띄워 확인할 수 있는 DB(공개 이미지 규칙이 있는 것) */
export const CONTAINER_DBS: DbType[] = ["mysql", "maria", "postgres"];
const ALIASES: Record<string, DbType> = { mariadb: "maria", postgresql: "postgres", pgsql: "postgres" };
export const normalizeDbType = (v: string): string => ALIASES[v.toLowerCase()] ?? v.toLowerCase();
export const MYSQL_CHARSET = "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
export const DB_OUTPUT_DIR = "scripts/egovframe-db";

// ── SQL 문장 ─────────────────────────────────────────
export interface SqlStatement { text: string; kind: "schema" | "data" | "other"; verb: string; table: string | null; references: string[]; source: string }

/** 따옴표('…', "…", `…`)·주석(--, #, /* *\/)을 지키며 ; 로 나눈다. PostgreSQL 의 $$…$$ 본문도 건너뛴다. */
export function splitSql(text: string): string[] {
  const out: string[] = [];
  let cur = "", i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === "-" && d === "-") { const e = text.indexOf("\n", i); const end = e < 0 ? n : e; cur += text.slice(i, end); i = end; continue; }
    if (c === "/" && d === "*") { const e = text.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; cur += text.slice(i, end); i = end; continue; }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < n) { if (text[j] === "\\" && c === "'" && j + 1 < n) { j += 2; continue; } if (text[j] === c) { if (text[j + 1] === c) { j += 2; continue; } break; } j++; }
      cur += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "$") { const m = text.slice(i).match(/^\$[A-Za-z_]*\$/); if (m) { const e = text.indexOf(m[0], i + m[0].length); const end = e < 0 ? n : e + m[0].length; cur += text.slice(i, end); i = end; continue; } }
    if (c === ";") { out.push(cur); cur = ""; i++; continue; }
    cur += c; i++;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => stripSqlComments(s).trim() !== "");
}
export const stripSqlComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*(--|#).*$/gm, " ");
const ident = (s: string) => s.replace(/[`"\[\]]/g, "").split(".").pop()!.toUpperCase();

export function classifyStatement(text: string, source = ""): SqlStatement {
  const body = stripSqlComments(text).trim().replace(/\s+/g, " ");
  const up = body.toUpperCase();
  const verb = up.match(/^(CREATE (?:OR REPLACE )?(?:UNIQUE |GLOBAL TEMPORARY )?(?:TABLE|INDEX|VIEW|SEQUENCE|TRIGGER|FUNCTION|PROCEDURE)|ALTER TABLE|COMMENT ON|DROP \w+|INSERT INTO|UPDATE|DELETE FROM|MERGE INTO|SET|COMMIT|GRANT)/)?.[1] ?? up.split(" ")[0];
  const kind: SqlStatement["kind"] = /^(CREATE|ALTER|COMMENT|DROP|GRANT)/.test(verb) ? "schema" : /^(INSERT|UPDATE|DELETE|MERGE)/.test(verb) ? "data" : "other";
  let table: string | null = null;
  let m: RegExpMatchArray | null;
  if ((m = body.match(/^CREATE (?:GLOBAL TEMPORARY )?TABLE (?:IF NOT EXISTS )?([\w.`"\[\]]+)/i))) table = ident(m[1]);
  else if ((m = body.match(/^CREATE (?:OR REPLACE )?VIEW ([\w.`"\[\]]+)/i))) table = ident(m[1]);
  else if ((m = body.match(/^CREATE (?:UNIQUE )?INDEX [\w.`"]+ ON ([\w.`"\[\]]+)/i))) table = ident(m[1]);
  else if ((m = body.match(/^(?:ALTER TABLE|INSERT INTO|UPDATE|DELETE FROM|MERGE INTO) ([\w.`"\[\]]+)/i))) table = ident(m[1]);
  else if ((m = body.match(/^COMMENT ON (?:TABLE|COLUMN) ([\w.`"\[\]]+)/i))) table = verb === "COMMENT ON" && /COLUMN/i.test(body.slice(0, 20)) ? ident(m[1].split(".").slice(0, -1).join(".") || m[1]) : ident(m[1]);
  const references = [...body.matchAll(/\bREFERENCES\s+([\w.`"\[\]]+)/gi)].map((x) => ident(x[1])).filter((x) => x !== table);
  // 뷰는 FROM 대상 테이블 뒤에
  if (/^CREATE (?:OR REPLACE )?VIEW/i.test(body)) for (const x of body.matchAll(/\b(?:FROM|JOIN)\s+([\w.`"\[\]]+)/gi)) { const t = ident(x[1]); if (t !== table && /^[A-Z_]\w*$/.test(t) && !references.includes(t)) references.push(t); }
  return { text, kind, verb, table, references, source };
}

/** 테이블(뷰 포함)을 참조 순서로 — 원래 순서를 지키되 참조 대상이 먼저 오게(순환은 원래 순서) */
export function orderByReferences(stmts: SqlStatement[]): SqlStatement[] {
  const creates = stmts.filter((s) => /^CREATE (?:GLOBAL TEMPORARY )?TABLE|^CREATE (?:OR REPLACE )?VIEW/.test(s.verb) && s.table);
  const byTable = new Map(creates.map((s) => [s.table!, s]));
  const done = new Set<SqlStatement>(), visiting = new Set<SqlStatement>();
  const out: SqlStatement[] = [];
  const visit = (s: SqlStatement) => {
    if (done.has(s) || visiting.has(s)) return;
    visiting.add(s);
    for (const r of s.references) { const t = byTable.get(r); if (t) visit(t); }
    visiting.delete(s); done.add(s); out.push(s);
  };
  for (const s of creates) visit(s);
  return out;
}

export interface PreparedScripts { schema: string; data: string; comment?: string; tables: string[]; views: string[]; statements: { schema: number; data: number; comment: number; duplicates: number; skipped: number }; charsetFixed: number; dataTables: Record<string, number> }

/** 문장 모음 → 적재용 스키마·데이터 본문(헤더·문자셋·순서·중복 제거) */
export function buildScripts(db: DbType, sources: { path: string; text: string; role?: "comment" }[], opts: { header?: string } = {}): PreparedScripts {
  const seen = new Set<string>();
  let duplicates = 0, skipped = 0, charsetFixed = 0;
  const all: SqlStatement[] = [];
  const comments: SqlStatement[] = [];
  for (const s of sources) for (const t of splitSql(s.text)) {
    const st = classifyStatement(t, s.path);
    const key = stripSqlComments(t).replace(/\s+/g, " ").trim().toUpperCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    if (st.kind === "other" && /^(SET|COMMIT|USE)$/.test(st.verb)) { skipped++; continue; } // 우리가 머리말에 넣는다
    (s.role === "comment" ? comments : all).push(st);
  }
  const schema = all.filter((s) => s.kind === "schema");
  const data = all.filter((s) => s.kind !== "schema");
  // 테이블·뷰는 참조 순서, 나머지 스키마 문장(인덱스·ALTER·COMMENT)은 테이블 뒤 원래 순서
  const ordered = orderByReferences(schema);
  const tableOrder = new Map(ordered.map((s, i) => [s.table!, i]));
  const rest = schema.filter((s) => !ordered.includes(s));
  const views = ordered.filter((s) => /VIEW/.test(s.verb)).map((s) => s.table!);
  const tables = ordered.filter((s) => !/VIEW/.test(s.verb)).map((s) => s.table!);
  // 데이터는 대상 테이블 순서로(같은 테이블 안은 원래 순서) — 부모 행이 먼저
  const dataOrdered = data.map((s, i) => ({ s, i })).sort((a, b) => (tableOrder.get(a.s.table ?? "") ?? 1e9) - (tableOrder.get(b.s.table ?? "") ?? 1e9) || a.i - b.i).map((x) => x.s);
  const fix = (s: SqlStatement): string => {
    if (!(db === "mysql" || db === "maria") || !/^CREATE (?:GLOBAL TEMPORARY )?TABLE/.test(s.verb)) return s.text;
    const close = s.text.lastIndexOf(")");
    if (close < 0) return s.text;
    const tail = s.text.slice(close + 1);
    if (/utf8mb4/i.test(tail) && /COLLATE/i.test(tail)) return s.text;
    charsetFixed++;
    const cleaned = tail.replace(/\b(?:DEFAULT\s+)?(?:CHARSET|CHARACTER\s+SET)\s*=?\s*\w+/gi, "").replace(/\bCOLLATE\s*=?\s*\w+/gi, "").replace(/\s+/g, " ").trim();
    return `${s.text.slice(0, close + 1)}${cleaned ? ` ${cleaned}` : ""} ${MYSQL_CHARSET}`;
  };
  const head = (kind: string): string[] => {
    const h = [`-- ${opts.header ?? "egovframe-scaffold-mcp prepare_egovframe_database"} — ${db} ${kind}`];
    if (db === "mysql" || db === "maria") h.push("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;", "SET FOREIGN_KEY_CHECKS = 0;");
    else if (db === "postgres") h.push("SET client_encoding = 'UTF8';");
    return h;
  };
  const foot = db === "mysql" || db === "maria" ? ["SET FOREIGN_KEY_CHECKS = 1;"] : [];
  const commit = db === "oracle" || db === "tibero" || db === "altibase" || db === "cubrid" || db === "goldilocks" ? ["COMMIT;"] : [];
  const body = (list: string[]) => list.map((t) => `${t.replace(/\s+$/, "")};`).join("\n\n");
  const known = new Set([...tables, ...views]);
  const usableComments = comments.filter((c) => !c.table || known.has(c.table));
  skipped += comments.length - usableComments.length;
  const dataTables: Record<string, number> = {};
  for (const s of dataOrdered) if (s.table && s.kind === "data") dataTables[s.table] = (dataTables[s.table] ?? 0) + 1;
  return {
    schema: [...head("schema"), "", body([...ordered, ...rest].map(fix)), "", ...foot].join("\n").replace(/\n{3,}/g, "\n\n") + "\n",
    data: [...head("data"), "", body(dataOrdered.map((s) => s.text)), "", ...commit, ...foot].join("\n").replace(/\n{3,}/g, "\n\n") + "\n",
    ...(comments.length ? { comment: [...head("comment"), "", body(usableComments.map((s) => s.text)), "", ...commit].join("\n").replace(/\n{3,}/g, "\n\n") + "\n" } : {}),
    tables, views,
    statements: { schema: ordered.length + rest.length, data: dataOrdered.length, comment: usableComments.length, duplicates, skipped },
    charsetFixed, dataTables,
  };
}

// ── INSERT 해석(한글 왕복 확인용) ─────────────────────
/** INSERT INTO t (c1, c2) VALUES (v1, v2) 의 첫 행 — 따옴표·괄호(함수 호출)를 지켜 나눈다 */
export function parseInsert(text: string): { table: string; columns: string[]; values: string[] } | null {
  const m = stripSqlComments(text).match(/^\s*INSERT\s+INTO\s+([\w.`"]+)\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)\s*$/i);
  if (!m) return null;
  const columns = m[2].split(",").map((c) => ident(c.trim()));
  const values: string[] = [];
  let cur = "", depth = 0, q = false;
  const s = m[3];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === "'" && s[i + 1] === "'") { cur += "'"; i++; } else if (c === "'") q = false; continue; }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === "(") depth++;
    if (c === ")") { if (depth === 0) break; depth--; }
    if (c === "," && depth === 0) { values.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  values.push(cur.trim());
  return values.length === columns.length ? { table: ident(m[1]), columns, values } : null;
}
const unquote = (v: string): string | null => (/^'[\s\S]*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : null);
const HANGUL = /[가-힣]/;
/** 데이터 본문에서 한글 왕복 확인 대상(키 열이 문자열이고 한글 값이 있는 첫 INSERT) */
export function hangulProbe(data: string): { table: string; keyColumn: string; key: string; column: string; expected: string } | null {
  for (const t of splitSql(data)) {
    if (!/^\s*INSERT/i.test(stripSqlComments(t))) continue;
    const p = parseInsert(t);
    if (!p) continue;
    const key = unquote(p.values[0]);
    if (key === null || HANGUL.test(key)) continue;
    const i = p.values.findIndex((v, j) => j > 0 && (unquote(v) ?? "") !== "" && HANGUL.test(unquote(v)!) && !/\\/.test(v));
    if (i > 0) return { table: p.table, keyColumn: p.columns[0], key, column: p.columns[i], expected: unquote(p.values[i])! };
  }
  return null;
}

// ── 프로젝트 → 원본 스크립트 ──────────────────────────
const SKIP = new Set([".git", "node_modules", "target", "build", "dist", ".gradle", ".idea", "migration-backup", "upgrade-backup", "remove-backup"]);
function walkSql(root: string, max = 5000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const d = stack.pop()!;
    let es: fs.Dirent[];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) stack.push(p); } else if (e.isFile() && e.name.toLowerCase().endsWith(".sql")) out.push(p);
    }
  }
  return out.sort();
}
export interface DbSourceFile { path: string; kind: "components" | "full" | "listed" | "found"; role?: "comment" }
function findSources(projectDir: string, db: DbType, opts: { scripts?: string[]; includeComments?: boolean }): { files: DbSourceFile[]; notes: string[] } {
  const notes: string[] = [];
  const rel = (abs: string) => path.relative(projectDir, abs).split(path.sep).join("/");
  const exists = (r: string) => fs.existsSync(path.join(projectDir, r));
  const listSql = (dir: string) => { try { return fs.readdirSync(path.join(projectDir, dir)).filter((f) => f.toLowerCase().endsWith(".sql")).map((f) => `${dir}/${f}`).sort(); } catch { return []; } };
  if (opts.scripts?.length) {
    for (const s of opts.scripts) if (!exists(s) || path.isAbsolute(s) || s.split(/[\\/]/).includes("..")) throw new Error(L(`scripts 의 파일이 없거나 프로젝트 밖입니다: ${s}`, `Script not found or outside the project: ${s}`));
    return { files: opts.scripts.map((p) => ({ path: p.split(path.sep).join("/"), kind: "listed" as const })), notes };
  }
  const files: DbSourceFile[] = [];
  // (1) 조립 선별본 — 매니페스트의 설치 순서(의존 컴포넌트가 앞)
  const order = Object.keys(readManifest(projectDir)?.components ?? {});
  const rank = (p: string) => { const i = order.indexOf(path.posix.basename(p, ".sql")); return i < 0 ? 1e6 : i; };
  for (const kind of ["ddl", "dml"]) for (const p of listSql(`scripts/egovframe-components/${db}/${kind}`).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) files.push({ path: p, kind: "components" });
  // (2) 공통컴포넌트 전체 프로젝트(script/ddl·dml/<db>/)
  if (!files.length) for (const kind of ["ddl", "dml"]) for (const p of listSql(`script/${kind}/${db}`)) files.push({ path: p, kind: "full" });
  if (opts.includeComments) {
    const cm = listSql(`script/comment/${db}`);
    if (cm.length) for (const p of cm) files.push({ path: p, kind: "full", role: "comment" });
    else notes.push(L(`script/comment/${db}/ 가 없어 주석 스크립트는 넣지 않습니다.`, `No script/comment/${db}/ — comment scripts are not included.`));
  }
  // (3) 그 밖의 *.sql 중 경로에 DB 이름이 있고 이름이 ddl·schema·create / dml·data·insert 인 것(배포 산출물과 같은 규칙)
  if (!files.filter((f) => !f.role).length) {
    const re = new RegExp(`(^|[_\\-./])${db === "maria" ? "(maria|mariadb|mysql)" : db === "postgres" ? "(postgres|postgresql|pgsql)" : db}([_\\-./]|$)`, "i");
    const all = walkSql(projectDir).map(rel).filter((f) => !f.startsWith(`${DB_OUTPUT_DIR}/`) && re.test(f.toLowerCase()));
    const pick = (k: RegExp) => all.filter((f) => k.test(path.posix.basename(f).toLowerCase())).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    for (const p of [...pick(/ddl|schema|create/), ...pick(/dml|data|insert/)]) if (!files.some((f) => f.path === p)) files.push({ path: p, kind: "found" });
  }
  return { files, notes };
}

// ── 참조 테이블 보완 ──────────────────────────────────
/** 선별본의 CREATE TABLE 이 참조하는(외래키·뷰) 테이블 중 원본에 없는 것 — 이름 목록 */
export function missingReferences(sources: { text: string; role?: string }[]): string[] {
  const created = new Set<string>(), refs = new Set<string>();
  for (const s of sources) if (!s.role) for (const t of splitSql(s.text)) { const st = classifyStatement(t); if (/^CREATE (?:GLOBAL TEMPORARY )?TABLE|^CREATE (?:OR REPLACE )?VIEW/.test(st.verb) && st.table) { created.add(st.table); for (const r of st.references) refs.add(r); } }
  return [...refs].filter((r) => !created.has(r)).sort();
}
/**
 * 공통컴포넌트 통합 스크립트(script/ddl·dml/<db>/)에서 빠진 참조 테이블의 CREATE·인덱스·INSERT 를 (그 테이블이 다시 참조하는 것까지) 꺼낸다.
 * 컴포넌트 카탈로그의 테이블 목록이 참조 대상(예: COMTCCMMNDETAILCODE → COMTCCMMNCODE → COMTCCMMNCLCODE)을 빠뜨린 경우의 보완 —
 * MySQL 은 FOREIGN_KEY_CHECKS=0 으로 넘어가지만 PostgreSQL·Oracle 은 테이블이 없으면 CREATE 가 실패한다.
 */
export function supplementFrom(full: { ddl: string[]; dml: string[] }, missing: string[]): { text: string; tables: string[] } {
  const ddl = full.ddl.flatMap((t) => splitSql(t)).map((t) => classifyStatement(t));
  const want = new Set<string>();
  const queue = [...missing];
  while (queue.length) {
    const t = queue.shift()!;
    if (want.has(t)) continue;
    const c = ddl.find((s) => s.table === t && /^CREATE (?:GLOBAL TEMPORARY )?TABLE|^CREATE (?:OR REPLACE )?VIEW/.test(s.verb));
    if (!c) continue;
    want.add(t);
    for (const r of c.references) if (!want.has(r)) queue.push(r);
  }
  const parts = ddl.filter((s) => s.table && want.has(s.table) && s.kind === "schema").map((s) => s.text);
  for (const t of full.dml) for (const x of splitSql(t)) { const st = classifyStatement(x); if (st.kind === "data" && st.table && want.has(st.table)) parts.push(x); }
  return { text: parts.map((x) => `${x};`).join("\n\n"), tables: [...want].sort() };
}
async function loadFullScripts(projectDir: string, db: DbType, offline: boolean): Promise<{ ddl: string[]; dml: string[]; from: string } | null> {
  const read = (dir: string) => { try { return fs.readdirSync(path.join(projectDir, dir)).filter((f) => f.endsWith(".sql")).sort().map((f) => fs.readFileSync(path.join(projectDir, dir, f), "utf8")); } catch { return []; } };
  const local = { ddl: read(`script/ddl/${db}`), dml: read(`script/dml/${db}`) };
  if (local.ddl.length) return { ...local, from: `script/ddl/${db}/` };
  if (offline) return null;
  const src = readManifest(projectDir)?.source ?? loadCatalog().source;
  const { zip } = await downloadComponentsZip(src as never);
  const pick = (kind: string) => zip.getEntries().filter((e) => !e.isDirectory && new RegExp(`^[^/]+/script/${kind}/${db}/[^/]+\\.sql$`).test(e.entryName)).sort((a, b) => a.entryName.localeCompare(b.entryName)).map((e) => e.getData().toString("utf8"));
  return { ddl: pick("ddl"), dml: pick("dml"), from: `${(src as { repository?: string; repo?: string }).repository ?? (src as { repo?: string }).repo}@${(src as { tag?: string }).tag ?? (src as { commit?: string }).commit ?? ""} script/ddl/${db}/` };
}

// ── 적재 명령·compose ─────────────────────────────────
export interface DbConnection { database: string; user: string; passwordKey: string | null; port: number; host: string | null; source: string | null }
function connectionOf(projectDir: string, db: DbType): DbConnection {
  const rules = loadDeployRules();
  const svc = rules.databases[db];
  let a: ReturnType<typeof analyzeDeploy> | null = null;
  try { a = analyzeDeploy(projectDir); } catch { a = null; }
  const d = a?.profile?.db && normalizeDbType(a.profile.db.type) === db ? a.profile.db : null;
  return { database: d?.database ?? "com", user: d?.user ?? svc?.rootUser ?? "com", passwordKey: d?.keys.password ?? null, port: d?.port ?? svc?.port ?? DEFAULT_PORT[db] ?? 0, host: d?.host ?? null, source: d?.file ?? null };
}
const DEFAULT_PORT: Record<string, number> = { mysql: 3306, maria: 3306, postgres: 5432, oracle: 1521, tibero: 8629, altibase: 20300, cubrid: 33000, goldilocks: 22581 };

export function renderDbCompose(db: DbType, c: DbConnection, imageRegistry = "docker.io/library"): string | null {
  const svc = loadDeployRules().databases[db];
  if (!svc) return null;
  const y = (v: string) => (/^[\w.\-]+$/.test(v) ? v : JSON.stringify(v)); // 설정 값이 YAML 구조를 깨지 않게
  const need = `\${DB_PASSWORD:?${L("DB_PASSWORD 를 설정하세요", "set DB_PASSWORD")}}`;
  // postgres 는 POSTGRES_USER 가 곧 관리자, mysql·mariadb 는 root 와 앱 계정이 따로(앱 계정이 root 면 root 만)
  const envLines = db === "postgres"
    ? [`      POSTGRES_USER: ${y(c.user)}`, `      POSTGRES_PASSWORD: ${need}`, `      POSTGRES_DB: ${y(c.database)}`, "      POSTGRES_INITDB_ARGS: --encoding=UTF8 --locale=C.UTF-8"]
    : [`      ${svc.env.rootPassword}: \${DB_ROOT_PASSWORD:-${need}}`, `      ${svc.env.database}: ${y(c.database)}`, ...(c.user === svc.rootUser ? [] : [`      ${svc.env.user}: ${y(c.user)}`, `      ${svc.env.password}: ${need}`])];
  return [
    L(`# 개발·테스트용 DB — egovframe-scaffold-mcp prepare_egovframe_database`, `# Development/test DB — egovframe-scaffold-mcp prepare_egovframe_database`),
    L(`# 실행: DB_PASSWORD=<${c.source ?? "설정 파일"} 의 비밀번호> docker compose -f ${DB_OUTPUT_DIR}/docker-compose.db.yml up -d`, `# Run: DB_PASSWORD=<password from ${c.source ?? "your config"}> docker compose -f ${DB_OUTPUT_DIR}/docker-compose.db.yml up -d`),
    L(`# 초기화 스크립트(./${db}/)는 데이터 볼륨이 비었을 때 한 번만 실행됩니다. 다시 넣으려면 down -v 후 up.`, `# The init scripts (./${db}/) run once, when the data volume is empty. To reload, run down -v and then up.`),
    "services:",
    "  db:",
    `    image: \${DB_REGISTRY:-${imageRegistry}}/${svc.image}`,
    "    environment:",
    ...envLines,
    ...(svc.command.length ? ["    command:", ...svc.command.map((x) => `      - "${x}"`)] : []),
    "    ports:",
    `      - "127.0.0.1:\${DB_PORT:-${c.port || svc.port}}:${svc.port}"`,
    "    volumes:",
    `      - ./${db}:${svc.initdb}:ro`,
    `      - egovframe-db-data:${svc.data}`,
    "    healthcheck:",
    `      test: ["CMD-SHELL", ${JSON.stringify(svc.healthcheck)}]`,
    "      interval: 5s",
    "      timeout: 5s",
    "      retries: 60",
    "volumes:",
    "  egovframe-db-data: {}",
    "",
  ].join("\n");
}

export function loadCommands(db: DbType, c: DbConnection, files: string[]): { bash: string[]; cmd: string[] } {
  const host = c.host && c.host !== "localhost" ? c.host : "127.0.0.1";
  const f = (shell: "bash" | "cmd", p: string) => (shell === "cmd" ? p.replace(/\//g, "\\") : p);
  const per = (shell: "bash" | "cmd") => files.map((p) => {
    const q = f(shell, p);
    switch (db) {
      case "mysql": case "maria": return `${db === "maria" ? "mariadb" : "mysql"} --default-character-set=utf8mb4 -h ${host} -P ${c.port} -u ${c.user} -p ${c.database} < ${q}`;
      case "postgres": return `psql -v ON_ERROR_STOP=1 -h ${host} -p ${c.port} -U ${c.user} -d ${c.database} -f ${q}`;
      case "oracle": return `sqlplus ${c.user}@//${host}:${c.port}/${c.database} @${q}`;
      case "tibero": return `tbsql ${c.user}@${c.database} @${q}`;
      case "altibase": return `isql -s ${host} -port ${c.port} -u ${c.user} -f ${q}`;
      case "cubrid": return `csql -u ${c.user} -i ${q} ${c.database}`;
      case "goldilocks": return `gsql ${c.user} -i ${q}`;
    }
  });
  const pre = (shell: "bash" | "cmd"): string[] => (db === "oracle" || db === "tibero" ? [shell === "bash" ? "export NLS_LANG=KOREAN_KOREA.AL32UTF8" : "set NLS_LANG=KOREAN_KOREA.AL32UTF8"] : db === "postgres" ? [shell === "bash" ? "export PGCLIENTENCODING=UTF8" : "set PGCLIENTENCODING=UTF8"] : []);
  const compose = CONTAINER_DBS.includes(db) ? { bash: [`DB_PASSWORD='<password>' docker compose -f ${DB_OUTPUT_DIR}/docker-compose.db.yml up -d`], cmd: [`set DB_PASSWORD=<password>`, `docker compose -f ${DB_OUTPUT_DIR.replace(/\//g, "\\")}\\docker-compose.db.yml up -d`] } : { bash: [], cmd: [] };
  return { bash: [...compose.bash, ...(compose.bash.length ? [L("# 또는 이미 있는 DB 에:", "# or into an existing DB:")] : []), ...pre("bash"), ...per("bash")], cmd: [...compose.cmd, ...(compose.cmd.length ? [L("REM 또는 이미 있는 DB 에:", "REM or into an existing DB:")] : []), ...pre("cmd"), ...per("cmd")] };
}

// ── Docker 확인 ───────────────────────────────────────
export type DockerExec = (args: string[], opts?: { timeoutMs?: number; input?: string }) => Promise<{ code: number | null; out: string }>;
export const defaultDocker: DockerExec = (args, opts = {}) => new Promise((resolve) => {
  let out = "";
  let child;
  try { child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] }); } catch (e) { resolve({ code: null, out: String(e) }); return; }
  const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 120_000);
  child.stdout.on("data", (d) => { out += d.toString("utf8"); });
  child.stderr.on("data", (d) => { out += d.toString("utf8"); });
  child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out: out + String(e) }); });
  child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  if (opts.input !== undefined) child.stdin.end(opts.input); else child.stdin.end();
});

export interface DbRunResult {
  ran: boolean; ok: boolean; image?: string; container?: string; kept?: boolean; port?: number; durationMs?: number;
  /** 초기화 중 오류 줄(있으면 실패) */
  errors: string[];
  tables?: { expected: number; actual: number };
  rows?: { table: string; expected: number; actual: number }[];
  hangul?: { table: string; column: string; key: string; expected: string; ok: boolean; actualHex?: string };
  reason?: string;
  logTail?: string;
}
const READY: Record<string, RegExp> = { mysql: /MySQL init process done\. Ready for start up\./, maria: /MariaDB init process done\. Ready for start up\./, postgres: /PostgreSQL init process complete; ready for start up\./ };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex").toUpperCase();

async function runInContainer(db: DbType, c: DbConnection, files: { name: string; content: string }[], prepared: PreparedScripts, o: { docker: DockerExec; imageRegistry: string; keep: boolean; timeoutMs: number; signal?: AbortSignal }): Promise<DbRunResult> {
  const svc = loadDeployRules().databases[db];
  if (!svc) return { ran: false, ok: false, errors: [], reason: L(`${db} 는 공개 이미지 규칙이 없어 컨테이너로 확인하지 않습니다 — 스크립트·명령만 만듭니다.`, `${db} has no public image rule, so it is not checked in a container — scripts and commands only.`) };
  const v = await o.docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 20_000 });
  if (v.code !== 0) return { ran: false, ok: false, errors: [], reason: L(`Docker 데몬에 연결하지 못했습니다: ${v.out.trim().split("\n").pop() ?? ""}`, `Could not reach the Docker daemon: ${v.out.trim().split("\n").pop() ?? ""}`) };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "egov-db-init-"));
  for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.content);
  fs.chmodSync(dir, 0o755);
  for (const f of files) fs.chmodSync(path.join(dir, f.name), 0o644);
  const name = `egovframe-db-${randomUUID().slice(0, 8)}`;
  const image = `${o.imageRegistry.replace(/\/+$/, "")}/${svc.image}`;
  const pw = `Egov${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const root = c.user === svc.rootUser;
  const env = db === "postgres"
    ? { POSTGRES_USER: c.user, POSTGRES_PASSWORD: pw, POSTGRES_DB: c.database, POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C.UTF-8" }
    : { [svc.env.rootPassword]: pw, [svc.env.database]: c.database, ...(root ? {} : { [svc.env.user]: c.user, [svc.env.password]: pw }) };
  const started = Date.now();
  const result: DbRunResult = { ran: true, ok: false, image, container: name, errors: [] };
  try {
    const run = await o.docker(["run", "-d", "--name", name, ...Object.entries(env).flatMap(([k, val]) => ["-e", `${k}=${val}`]), "-p", `127.0.0.1::${svc.port}`, "-v", `${dir}:${svc.initdb}:ro`, image, ...svc.command], { timeoutMs: 600_000 });
    if (run.code !== 0) { result.reason = L(`컨테이너를 시작하지 못했습니다: ${run.out.trim().split("\n").slice(-2).join(" ")}`, `Could not start the container: ${run.out.trim().split("\n").slice(-2).join(" ")}`); return result; }
    let logs = "";
    for (;;) {
      throwIfAborted(o.signal);
      await sleep(2000);
      logs = (await o.docker(["logs", name], { timeoutMs: 30_000 })).out;
      if (READY[db].test(logs)) break;
      const st = (await o.docker(["inspect", "-f", "{{.State.Running}}", name], { timeoutMs: 20_000 })).out.trim();
      if (st === "false") break;
      if (Date.now() - started > o.timeoutMs) { result.reason = L(`초기화가 ${Math.round(o.timeoutMs / 1000)}초 안에 끝나지 않았습니다`, `Initialization did not finish within ${Math.round(o.timeoutMs / 1000)}s`); break; }
    }
    result.errors = logs.split(/\r?\n/).filter((l) => /^ERROR\b|^ERROR \d+|\[ERROR\].*(?:at line|Table|syntax)|psql:.*ERROR:|^\s*ERROR:/.test(l.trim())).slice(0, 20);
    result.logTail = logs.trim().split(/\r?\n/).slice(-30).join("\n");
    if (!READY[db].test(logs)) { result.reason ??= L("초기화 스크립트 실행 중 DB 가 멈췄습니다(오류 줄 확인)", "The DB stopped while running the init scripts (see the error lines)"); return result; }
    // 서버가 재시작해 연결을 받을 때까지
    const q = async (sql: string): Promise<string | null> => {
      for (let i = 0; i < 30; i++) {
        const args = db === "postgres"
          ? ["exec", "-e", "PGCLIENTENCODING=UTF8", name, "psql", "-U", c.user, "-d", c.database, "-At", "-c", sql]
          : ["exec", "-e", `MYSQL_PWD=${pw}`, name, db === "maria" ? "mariadb" : "mysql", "-uroot", "--default-character-set=utf8mb4", "-N", "-B", c.database, "-e", sql];
        const r = await o.docker(args, { timeoutMs: 60_000 });
        if (r.code === 0) return r.out.replace(/^.*(?:Using a password|\[Warning\]).*\n/gm, "").trim();
        if (/ERROR \d+ \(42|syntax|does not exist|doesn't exist/i.test(r.out)) return null;
        await sleep(2000);
      }
      return null;
    };
    const schemaFilter = db === "postgres" ? "table_schema = current_schema() AND table_type = 'BASE TABLE'" : `table_schema = DATABASE() AND table_type = 'BASE TABLE'`;
    const n = Number(await q(`SELECT COUNT(*) FROM information_schema.tables WHERE ${schemaFilter}`));
    result.tables = { expected: prepared.tables.length, actual: Number.isFinite(n) ? n : -1 };
    // 필수 행: 관리자 계정·메뉴·공통코드처럼 데이터가 있어야 화면이 뜨는 표 — 데이터 본문에 INSERT 가 있는 것만
    const want = ["COMTNEMPLYRINFO", "COMTNMENUINFO", "COMTCCMMNCODE", "COMTECOPSEQ", "COMTNAUTHORINFO"].filter((t) => prepared.dataTables[t]);
    result.rows = [];
    for (const t of want) { const r = await q(`SELECT COUNT(*) FROM ${db === "postgres" ? t.toLowerCase() : t}`); result.rows.push({ table: t, expected: prepared.dataTables[t], actual: r === null ? -1 : Number(r) }); }
    const probe = hangulProbe(prepared.data);
    if (probe) {
      const col = db === "postgres" ? `upper(encode(convert_to(${probe.column.toLowerCase()}, 'UTF8'), 'hex'))` : `HEX(${probe.column})`;
      const r = await q(`SELECT ${col} FROM ${db === "postgres" ? probe.table.toLowerCase() : probe.table} WHERE ${db === "postgres" ? probe.keyColumn.toLowerCase() : probe.keyColumn} = '${probe.key.replace(/'/g, "''")}'`);
      result.hangul = { table: probe.table, column: probe.column, key: probe.key, expected: probe.expected, ok: (r ?? "").split("\n")[0] === hex(probe.expected), ...(r ? { actualHex: r.split("\n")[0].slice(0, 80) } : {}) };
    }
    const rowsOk = result.rows.every((r) => r.actual >= r.expected);
    result.ok = result.errors.length === 0 && result.tables.actual >= result.tables.expected && rowsOk && (result.hangul?.ok ?? true);
    if (o.keep) { const p = (await o.docker(["port", name, String(svc.port)], { timeoutMs: 20_000 })).out.match(/:(\d+)\s*$/m)?.[1]; result.kept = true; if (p) result.port = Number(p); }
    return result;
  } finally {
    result.durationMs = Date.now() - started;
    if (!o.keep) await o.docker(["rm", "-f", "-v", name], { timeoutMs: 60_000 });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── 진입점 ────────────────────────────────────────────
export interface PrepareDatabaseOptions {
  projectDir: string;
  /** DB 종류(기본: 프로젝트 Globals.DbType·JDBC URL) */
  database?: string;
  /** 직접 고를 원본 스크립트(프로젝트 상대, 순서대로). 없으면 자동(조립 선별본 → 공통컴포넌트 전체 → 이름 규칙) */
  scripts?: string[];
  /** 공통컴포넌트 전체의 주석 스크립트(script/comment/<db>/)도 넣음 */
  includeComments?: boolean;
  /** true 면 빠진 참조 테이블 보완에 공통컴포넌트 저장소를 내려받지 않음 */
  offline?: boolean;
  /** 기본 true — 파일을 쓰지 않음 */
  dryRun?: boolean;
  /** Docker 로 DB 를 띄워 적재·확인(mysql·maria·postgres) */
  run?: boolean;
  /** run=true 뒤 컨테이너를 남김(기본 false) */
  keep?: boolean;
  imageRegistry?: string;
  timeoutMs?: number;
  docker?: DockerExec;
  progress?: Progress;
}
export interface PrepareDatabaseResult {
  projectDir: string;
  database: string;
  dryRun: boolean;
  /** dbType 을 어디서 정했는지 */
  databaseFrom: "parameter" | "project";
  sources: DbSourceFile[];
  /** 선별본이 참조하지만 빠져 통합 스크립트에서 보완한 테이블 */
  supplemented: string[];
  outputs: { path: string; bytes: number; status: "create" | "same" | "written" }[];
  statements: PreparedScripts["statements"];
  tables: number; views: number; charsetFixed: number;
  connection: DbConnection;
  commands: { bash: string[]; cmd: string[] };
  run?: DbRunResult;
  notes: string[];
}

export async function prepareDatabase(opts: PrepareDatabaseOptions): Promise<PrepareDatabaseResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const dryRun = opts.dryRun ?? true;
  const notes: string[] = [];
  const registry = (opts.imageRegistry ?? "docker.io/library").replace(/\/+$/, "");
  if (!DEPLOY_IMAGE_REGISTRY_RE.test(registry)) throw new Error(L(`imageRegistry 형식 오류(예: docker.io/library, mirror.gcr.io/library): ${JSON.stringify(opts.imageRegistry)}`, `Invalid imageRegistry format (e.g. docker.io/library, mirror.gcr.io/library): ${JSON.stringify(opts.imageRegistry)}`));
  let databaseFrom: PrepareDatabaseResult["databaseFrom"] = "parameter";
  let raw = opts.database;
  if (!raw) {
    raw = detectDbType(projectDir) ?? undefined;
    if (!raw) { try { raw = analyzeDeploy(projectDir).profile?.db?.type; } catch { raw = undefined; } }
    databaseFrom = "project";
  }
  if (!raw) throw new Error(L("DB 종류를 정하지 못했습니다 — database 파라미터(mysql·maria·postgres·oracle·tibero·altibase·cubrid·goldilocks)를 주거나 Globals.DbType 을 설정하세요.", "Could not determine the database type — pass database (mysql, maria, postgres, oracle, tibero, altibase, cubrid, goldilocks) or set Globals.DbType."));
  const db = normalizeDbType(raw);
  if (db === "hsql") throw new Error(L("HSQL 은 내장(메모리) DB 라 준비할 것이 없습니다 — 앱이 기동 때 스크립트를 넣습니다.", "HSQL is an embedded (in-memory) DB, so there is nothing to prepare — the app loads its scripts at startup."));
  if (!DATABASE_TYPES.includes(db as DbType)) throw new Error(L(`지원하지 않는 DB: ${raw} (${DATABASE_TYPES.join("·")})`, `Unsupported database: ${raw} (${DATABASE_TYPES.join(", ")})`));
  const dbt = db as DbType;
  const { files, notes: srcNotes } = findSources(projectDir, dbt, opts);
  notes.push(...srcNotes);
  if (!files.filter((f) => !f.role).length) throw new Error(L(`${dbt} 스크립트를 찾지 못했습니다 — add_egovframe_components(database="${dbt}") 로 조립하거나 scripts 로 파일을 지정하세요.`, `No ${dbt} scripts found — assemble with add_egovframe_components(database="${dbt}") or pass files with scripts.`));
  opts.progress?.report("database: scripts", 0, opts.run ? 3 : 2);
  const srcTexts = files.map((f) => ({ path: f.path, text: fs.readFileSync(path.join(projectDir, f.path), "utf8").replace(/^\uFEFF/, ""), role: f.role }));
  // 선별본이 참조하는데 빠진 테이블(외래키 부모·뷰 대상)을 공통컴포넌트 통합 스크립트에서 보완
  const missing = missingReferences(srcTexts);
  let supplemented: string[] = [];
  if (missing.length) {
    let full: Awaited<ReturnType<typeof loadFullScripts>> = null;
    try { full = await loadFullScripts(projectDir, dbt, opts.offline ?? false); } catch (e) { notes.push(L(`공통컴포넌트 통합 스크립트를 받지 못했습니다(${e instanceof Error ? e.message : String(e)})`, `Could not fetch the common-component combined scripts (${e instanceof Error ? e.message : String(e)})`)); }
    const sup = full ? supplementFrom(full, missing) : null;
    if (sup?.tables.length) {
      supplemented = sup.tables;
      srcTexts.unshift({ path: `(${full!.from})`, text: sup.text, role: undefined });
      notes.push(L(`선별본이 참조하지만 빠진 테이블 ${sup.tables.length}개(${sup.tables.slice(0, 8).join(", ")}${sup.tables.length > 8 ? " …" : ""})를 ${full!.from} 에서 보완했습니다(정의·인덱스·기본 데이터).`, `${sup.tables.length} table(s) referenced by the extracts but missing (${sup.tables.slice(0, 8).join(", ")}${sup.tables.length > 8 ? " …" : ""}) were added from ${full!.from} (definition, indexes, seed data).`));
    }
    const still = missing.filter((t) => !supplemented.includes(t));
    if (still.length) notes.push(L(`참조 테이블 ${still.join(", ")} 의 정의를 찾지 못했습니다 — ${dbt === "mysql" || dbt === "maria" ? "MySQL·MariaDB 는 외래키 검사를 끄고 넣으므로 적재는 되지만" : "외래키가 있는 CREATE 가 실패할 수 있고"} 그 테이블을 쓰는 화면은 동작하지 않습니다.`, `No definition found for referenced table(s) ${still.join(", ")} — ${dbt === "mysql" || dbt === "maria" ? "MySQL/MariaDB load with foreign key checks off, so loading works, but" : "CREATE statements with foreign keys may fail and"} screens using them will not work.`));
  }
  const prepared = buildScripts(dbt, srcTexts);
  const conn = connectionOf(projectDir, dbt);
  const outDir = `${DB_OUTPUT_DIR}/${dbt}`;
  const out: { path: string; content: string }[] = [
    { path: `${outDir}/01-schema.sql`, content: prepared.schema },
    ...(prepared.statements.data ? [{ path: `${outDir}/02-data.sql`, content: prepared.data }] : []),
    ...(prepared.comment ? [{ path: `${outDir}/03-comment.sql`, content: prepared.comment }] : []),
  ];
  const compose = renderDbCompose(dbt, conn, registry);
  if (compose) out.push({ path: `${DB_OUTPUT_DIR}/docker-compose.db.yml`, content: compose });
  else notes.push(L(`${dbt} 는 공개 컨테이너 이미지 규칙이 없어 compose 를 만들지 않습니다 — 아래 명령으로 기관 DB 에 넣으세요.`, `${dbt} has no public container image rule, so no compose file is generated — load into your DB with the commands below.`));
  const outputs: PrepareDatabaseResult["outputs"] = [];
  const conflicts: string[] = [];
  for (const o of out) {
    const abs = path.join(projectDir, o.path);
    const cur = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    outputs.push({ path: o.path, bytes: Buffer.byteLength(o.content), status: cur === null ? "create" : cur === o.content ? "same" : "create" });
    if (cur !== null && cur !== o.content) conflicts.push(o.path);
  }
  if (conflicts.length && !dryRun) throw new Error(L(`이미 다른 내용의 파일이 있어 덮어쓰지 않습니다: ${conflicts.join(", ")} — 지우거나 옮긴 뒤 다시 실행하세요.`, `Refusing to overwrite existing files with different content: ${conflicts.join(", ")} — remove or move them and run again.`));
  if (conflicts.length) notes.push(L(`이미 다른 내용의 파일이 있습니다(적용하면 거부): ${conflicts.join(", ")}`, `Existing files differ (applying would be refused): ${conflicts.join(", ")}`));
  if (dbt === "mysql" || dbt === "maria") notes.push(L(`MySQL·MariaDB: 테이블 ${prepared.charsetFixed}개에 ${MYSQL_CHARSET} 를 넣고 스크립트 첫 줄에 SET NAMES utf8mb4 를 두었습니다 — 클라이언트 문자셋(latin1 등)과 무관하게 한글이 같게 저장되고(upstream #1386) 열 정렬 규칙이 섞이지 않습니다(#1387).`, `MySQL/MariaDB: ${MYSQL_CHARSET} was added to ${prepared.charsetFixed} table(s) and SET NAMES utf8mb4 heads each script — Korean text is stored the same whatever the client charset (latin1 etc., upstream #1386) and collations do not mix (#1387).`));
  if (dbt === "oracle" || dbt === "tibero") notes.push(L("Oracle·Tibero: 클라이언트 NLS_LANG 를 KOREAN_KOREA.AL32UTF8 로 두고 넣으세요(명령에 포함).", "Oracle/Tibero: set the client NLS_LANG to KOREAN_KOREA.AL32UTF8 before loading (included in the commands)."));
  if (prepared.statements.duplicates) notes.push(L(`같은 문장 ${prepared.statements.duplicates}개는 한 번만 넣습니다(컴포넌트 선별본이 공유 테이블을 겹쳐 담음).`, `${prepared.statements.duplicates} duplicate statement(s) are included once (component extracts overlap on shared tables).`));
  const commands = loadCommands(dbt, conn, out.filter((o) => o.path.endsWith(".sql")).map((o) => o.path));
  const result: PrepareDatabaseResult = { projectDir, database: dbt, dryRun, databaseFrom, sources: files, supplemented, outputs, statements: prepared.statements, tables: prepared.tables.length, views: prepared.views.length, charsetFixed: prepared.charsetFixed, connection: conn, commands, notes };

  if (!dryRun) {
    const todo = out.filter((o, i) => outputs[i].status === "create");
    if (todo.length) await withFileTransaction(projectDir, L("DB 스크립트 준비", "prepare DB scripts"), (tx) => { for (const o of todo) tx.writeFile(o.path, o.content, { mustNotExist: true }); });
    for (const o of outputs) if (o.status === "create") o.status = "written";
  } else notes.push(L(`dryRun — 쓰지 않았습니다. dryRun=false 로 ${outDir}/ 와 compose 를 만듭니다.`, `dryRun — nothing written. dryRun=false creates ${outDir}/ and the compose file.`));
  if (opts.run) {
    opts.progress?.report("database: container load", 1, 3);
    result.run = await runInContainer(dbt, conn, out.filter((o) => o.path.startsWith(`${outDir}/`)).map((o) => ({ name: path.posix.basename(o.path), content: o.content })), prepared, { docker: opts.docker ?? defaultDocker, imageRegistry: registry, keep: opts.keep ?? false, timeoutMs: opts.timeoutMs ?? 600_000, signal: opts.progress?.signal });
    opts.progress?.report("database: done", 3, 3);
  }
  return result;
}

/** diagnose 용: 프로젝트의 DB 준비 상태(스크립트·준비본·compose) */
export function databaseReadiness(projectDir: string, dbType: string | null): { database: string | null; componentScripts: number; prepared: boolean; compose: boolean } {
  const db = dbType ? normalizeDbType(dbType) : null;
  const count = (d: string) => { try { return fs.readdirSync(path.join(projectDir, d)).filter((f) => f.endsWith(".sql")).length; } catch { return 0; } };
  return {
    database: db,
    componentScripts: db ? count(`scripts/egovframe-components/${db}/ddl`) + count(`scripts/egovframe-components/${db}/dml`) : 0,
    prepared: !!db && fs.existsSync(path.join(projectDir, `${DB_OUTPUT_DIR}/${db}/01-schema.sql`)),
    compose: fs.existsSync(path.join(projectDir, `${DB_OUTPUT_DIR}/docker-compose.db.yml`)),
  };
}

export function renderDatabaseMarkdown(r: PrepareDatabaseResult): string {
  const out: string[] = [];
  out.push(L(`# DB 준비 ${r.dryRun ? "계획(dryRun)" : "결과"} — ${r.database}`, `# Database preparation ${r.dryRun ? "plan (dryRun)" : "result"} — ${r.database}`), "");
  out.push(L(`- 경로: ${r.projectDir} · DB ${r.database}(${r.databaseFrom === "parameter" ? "지정" : "프로젝트 설정"}) · 접속 ${r.connection.user}@${r.connection.host ?? "127.0.0.1"}:${r.connection.port}/${r.connection.database}${r.connection.source ? ` (${r.connection.source})` : ""}`, `- Path: ${r.projectDir} · DB ${r.database} (${r.databaseFrom === "parameter" ? "given" : "from project settings"}) · connection ${r.connection.user}@${r.connection.host ?? "127.0.0.1"}:${r.connection.port}/${r.connection.database}${r.connection.source ? ` (${r.connection.source})` : ""}`));
  out.push(L(`- 원본 ${r.sources.length}개 → 테이블 ${r.tables} · 뷰 ${r.views} · 스키마 문장 ${r.statements.schema} · 데이터 문장 ${r.statements.data}${r.statements.comment ? ` · 주석 ${r.statements.comment}` : ""} · 중복 제거 ${r.statements.duplicates}${r.charsetFixed ? ` · 문자셋 교정 ${r.charsetFixed}` : ""}`, `- ${r.sources.length} source file(s) → ${r.tables} tables · ${r.views} views · ${r.statements.schema} schema statements · ${r.statements.data} data statements${r.statements.comment ? ` · ${r.statements.comment} comments` : ""} · ${r.statements.duplicates} duplicates removed${r.charsetFixed ? ` · charset fixed ${r.charsetFixed}` : ""}`));
  for (const n of r.notes) out.push(`- ${n}`);
  out.push("", L("## 원본", "## Sources"), "");
  for (const s of r.sources.slice(0, 30)) out.push(`- ${s.path} (${s.kind}${s.role ? `, ${s.role}` : ""})`);
  if (r.sources.length > 30) out.push(L(`- … 외 ${r.sources.length - 30}개`, `- … ${r.sources.length - 30} more`));
  out.push("", L("## 만드는 파일", "## Files"), "", L("| 파일 | 크기 | 상태 |", "| File | Size | Status |"), "|---|---|---|");
  for (const o of r.outputs) out.push(`| ${o.path} | ${(o.bytes / 1024).toFixed(1)}KB | ${o.status} |`);
  out.push("", L("## 적재 명령", "## Load commands"), "", "```bash", ...r.commands.bash, "```", "", "```bat", ...r.commands.cmd, "```");
  if (r.run) {
    const x = r.run;
    out.push("", L("## 컨테이너 적재·확인", "## Container load and check"), "");
    if (!x.ran) out.push(`- ${x.reason ?? ""}`);
    else {
      out.push(L(`- ${x.ok ? "✅ 통과" : "❌ 실패"} · ${x.image} · ${Math.round((x.durationMs ?? 0) / 1000)}초${x.kept ? ` · 컨테이너 ${x.container} 유지(127.0.0.1:${x.port ?? "?"})` : ""}`, `- ${x.ok ? "✅ passed" : "❌ failed"} · ${x.image} · ${Math.round((x.durationMs ?? 0) / 1000)}s${x.kept ? ` · container ${x.container} kept (127.0.0.1:${x.port ?? "?"})` : ""}`));
      if (x.reason) out.push(`- ${x.reason}`);
      if (x.tables) out.push(L(`- 테이블 ${x.tables.actual} / 기대 ${x.tables.expected}`, `- tables ${x.tables.actual} / expected ${x.tables.expected}`));
      for (const rw of x.rows ?? []) out.push(L(`- ${rw.table} 행 ${rw.actual} / 기대 ${rw.expected}`, `- ${rw.table} rows ${rw.actual} / expected ${rw.expected}`));
      if (x.hangul) out.push(L(`- 한글 왕복 ${x.hangul.ok ? "✅" : "❌"} ${x.hangul.table}.${x.hangul.column}(${x.hangul.key}) = '${x.hangul.expected}'`, `- Korean round trip ${x.hangul.ok ? "✅" : "❌"} ${x.hangul.table}.${x.hangul.column} (${x.hangul.key}) = '${x.hangul.expected}'`));
      for (const e of x.errors.slice(0, 10)) out.push(`- ⚠️ ${e}`);
    }
  }
  return out.join("\n");
}
