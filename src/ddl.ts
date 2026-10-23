// CREATE TABLE 문 해석 → CRUD 필드 (v1.4, generate_egovframe_crud 의 ddl 입력)
//   공식 Initializr v5.0.7 이 고친 경계를 같은 방식으로 다룬다:
//   - COMMENT·DEFAULT 문자열 안의 콤마·괄호로 컬럼 분리가 깨지지 않게 따옴표·괄호 깊이를 보며 최상위 콤마로만 나눈다
//   - COMMENT 본문에 "primary key" 문구가 있어도 PK 로 보지 않는다(키워드 판정은 문자열 리터럴을 지운 뒤에 한다)
//   방언: MySQL·MariaDB·PostgreSQL·Oracle·Tibero·Altibase·CUBRID·HSQL(공통 문법 + 각자의 자동 증가·COMMENT ON 표기)
import type { CrudFieldInput, CrudJavaType } from "./crud.js";

export interface ParsedDdl {
  tableName: string;
  /** schema.table 이면 schema */
  schema: string | null;
  fields: CrudFieldInput[];
  /** 해석은 했지만 사람이 확인해야 할 것(알 수 없는 타입·무시한 제약 등) */
  warnings: string[];
}

/**
 * 백슬래시 이스케이프(\') 해석 여부 — MySQL 은 해석하고 표준 SQL 은 하지 않는다. 표준 해석(백슬래시는 보통 문자)으로
 * 따옴표 짝이 맞으면 그쪽을 쓰고, 맞지 않을 때만 MySQL 식으로 해석한다. 'C:\' 처럼 끝이 백슬래시인 리터럴과
 * 'user\'s' 같은 MySQL 이스케이프를 모두 받는다(공식 Initializr v5.0.7 의 DDL 파서 테스트와 같은 결과).
 */
export function chooseBackslashMode(sql: string): boolean {
  return !quotesBalanced(sql, false) && quotesBalanced(sql, true);
}
function quotesBalanced(sql: string, bs: boolean): boolean {
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (c === "'" || c === '"' || c === "`") { const end = closingQuote(sql, i, bs); if (end < 0) return false; i = end; }
    else if (c === "-" && n === "-") { while (i < sql.length && sql[i] !== "\n") i++; }
    else if (c === "/" && n === "*") { const end = sql.indexOf("*/", i + 2); if (end < 0) return false; i = end + 1; }
  }
  return true;
}

/** 블록·줄 주석을 지운다(문자열 리터럴 안은 보존). */
export function stripSqlComments(sql: string, bs = chooseBackslashMode(sql)): string {
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (c === "'" || c === '"' || c === "`") {
      const end = closingQuote(sql, i, bs) < 0 ? sql.length - 1 : closingQuote(sql, i, bs);
      out += sql.slice(i, end + 1);
      i = end;
    } else if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 1;
      out += " ";
    } else out += c;
  }
  return out;
}

/** i 의 따옴표와 짝이 되는 닫는 따옴표 위치(두 번 쓰기 '' 와, bs 면 \' 이스케이프를 건넌다). 없으면 -1 */
function closingQuote(s: string, i: number, bs = true): number {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (bs && s[j] === "\\" && q !== "`") { j++; continue; }
    if (s[j] === q) { if (s[j + 1] === q) { j++; continue; } return j; }
  }
  return -1;
}

/** 최상위(괄호 깊이 0, 따옴표 밖) 콤마로 나눈다. 따옴표가 끝내 열린 채면 따옴표를 무시하고 나눈다. */
export function splitTopLevel(body: string, bs = chooseBackslashMode(body)): string[] {
  const balanced = quotesBalanced(body, bs);
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (balanced && (c === "'" || c === '"' || c === "`")) { i = closingQuote(body, i, bs); continue; }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** 문자열 리터럴을 같은 길이의 빈 리터럴로 바꾼다 — 키워드·괄호 판정이 COMMENT·DEFAULT 본문에 속지 않게(식별자 따옴표 "…"·`…` 는 그대로) */
function blankLiterals(s: string, bs = true): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      let end = closingQuote(s, i, bs);
      if (end < 0) end = s.length - 1;
      // 작은따옴표는 문자열, 큰따옴표는 DEFAULT·COMMENT 뒤면 문자열(MySQL)이고 그 밖은 식별자라 그대로 둔다
      const literal = c === "'" || (c === '"' && /\b(DEFAULT|COMMENT)\s*$/i.test(out));
      out += literal ? `${c}${" ".repeat(Math.max(0, end - i - 1))}${c}` : s.slice(i, end + 1);
      i = end;
    } else out += c;
  }
  return out;
}

const unquote = (id: string): string => id.trim().replace(/^[`"[]|[`"\]]$/g, "");
const literalValue = (lit: string, bs = true): string => { const v = lit.slice(1, -1).replace(/''/g, "'"); return bs ? v.replace(/\\'/g, "'") : v; };

/** 컬럼 타입 → 자바 타입·JDBC 타입 */
export function mapSqlType(rawType: string, opts: { oracleDate?: boolean } = {}): { javaType: CrudJavaType; jdbcType: string; known: boolean } {
  const t = rawType.toUpperCase().replace(/\s+/g, " ").trim();
  const base = t.replace(/\(.*$/, "").replace(/ UNSIGNED$| ZEROFILL$/g, "").trim();
  const nums = (t.match(/\(([^)]*)\)/)?.[1] ?? "").split(",").map((x) => Number.parseInt(x.trim(), 10));
  const [p, s] = [nums[0], nums[1]];
  if (/^(N?VARCHAR2?|N?CHAR|CHARACTER( VARYING)?|VARCHAR_IGNORECASE|TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|STRING|UUID|ENUM|SET|JSON|JSONB|XML|CITEXT|LONG VARCHAR)$/.test(base)) return { javaType: "String", jdbcType: /CHAR$/.test(base) && !/VAR/.test(base) ? "CHAR" : "VARCHAR", known: true };
  if (/^(N?CLOB|LONG)$/.test(base)) return { javaType: "String", jdbcType: "CLOB", known: true };
  if (/^(BIGINT|INT8|BIGSERIAL|SERIAL8)$/.test(base)) return { javaType: "Long", jdbcType: "BIGINT", known: true };
  if (/^(INT|INTEGER|INT4|INT2|SMALLINT|TINYINT|MEDIUMINT|SERIAL|SERIAL4|SMALLSERIAL|SHORT)$/.test(base)) return { javaType: "Integer", jdbcType: "INTEGER", known: true };
  if (/^(NUMBER|NUMERIC|DECIMAL|DEC)$/.test(base)) {
    if (Number.isFinite(p) && (!Number.isFinite(s) || s === 0)) return p <= 9 ? { javaType: "Integer", jdbcType: "INTEGER", known: true } : p <= 18 ? { javaType: "Long", jdbcType: "BIGINT", known: true } : { javaType: "BigDecimal", jdbcType: "DECIMAL", known: true };
    return { javaType: "BigDecimal", jdbcType: base === "NUMBER" ? "NUMERIC" : "DECIMAL", known: true };
  }
  if (/^(FLOAT|FLOAT4|FLOAT8|DOUBLE|DOUBLE PRECISION|REAL|BINARY_FLOAT|BINARY_DOUBLE|MONETARY)$/.test(base)) return { javaType: "Double", jdbcType: "DOUBLE", known: true };
  if (/^(BOOLEAN|BOOL)$/.test(base) || (base === "BIT" && (!Number.isFinite(p) || p === 1))) return { javaType: "Boolean", jdbcType: "BOOLEAN", known: true };
  if (base === "DATE") return opts.oracleDate ? { javaType: "LocalDateTime", jdbcType: "TIMESTAMP", known: true } : { javaType: "LocalDate", jdbcType: "DATE", known: true };
  if (/^TIMESTAMP( ?\(\d+\))? WITH( LOCAL)? TIME ZONE$/.test(t.replace(/\(\d+\)/, "")) || /^TIMESTAMPTZ$/.test(base)) return { javaType: "Instant", jdbcType: "TIMESTAMP_WITH_TIMEZONE", known: true };
  if (/^(DATETIME|DATETIME2|TIMESTAMP|SMALLDATETIME)/.test(base)) return { javaType: "LocalDateTime", jdbcType: "TIMESTAMP", known: true };
  if (/^(BLOB|LONGBLOB|MEDIUMBLOB|TINYBLOB|BYTEA|IMAGE)$/.test(base)) return { javaType: "byte[]", jdbcType: "BLOB", known: true };
  if (/^(BINARY|VARBINARY|RAW|LONG RAW|BIT VARYING|VARBIT)$/.test(base) || base === "BIT") return { javaType: "byte[]", jdbcType: "BINARY", known: true };
  return { javaType: "String", jdbcType: "VARCHAR", known: false };
}

const CONSTRAINT_RE = /^(CONSTRAINT\s+\S+\s+)?(PRIMARY\s+KEY|UNIQUE(\s+(KEY|INDEX))?|KEY|INDEX|FULLTEXT|SPATIAL|FOREIGN\s+KEY|CHECK|EXCLUDE)\b/i;
const TYPE_RE = /^((?:DOUBLE\s+PRECISION|CHARACTER\s+VARYING|LONG\s+RAW|LONG\s+VARCHAR|BIT\s+VARYING|TIMESTAMP(?:\s*\(\s*\d+\s*\))?\s+WITH(?:\s+LOCAL)?\s+TIME\s+ZONE|[A-Za-z_][\w]*)(?:\s*\([^)]*\))?(?:\s+(?:UNSIGNED|ZEROFILL))*)/i;

/**
 * CREATE TABLE 문 하나를 해석한다. `COMMENT ON COLUMN t.c IS '...'`(Oracle·PostgreSQL·Tibero)도 같은 입력 안에 있으면 라벨로 쓴다.
 * dialect 를 주면 Oracle·Tibero 의 DATE 를 날짜+시각(LocalDateTime)으로 본다.
 */
export function parseCreateTable(ddl: string, opts: { dialect?: string } = {}): ParsedDdl {
  if (typeof ddl !== "string" || !ddl.trim()) throw new Error("ddl 이 비어 있습니다");
  if (ddl.length > 200_000) throw new Error("ddl 이 너무 깁니다(200,000자 초과)");
  const bs = chooseBackslashMode(ddl);
  const sql = stripSqlComments(ddl, bs);
  const blanked = blankLiterals(sql, bs);
  const head = /\bCREATE\s+(?:GLOBAL\s+TEMPORARY\s+|TEMPORARY\s+|TEMP\s+|CACHED\s+|MEMORY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:[`"[]?[\w$#]+[`"\]]?\s*\.\s*)?[`"[]?[\w$#]+[`"\]]?)\s*\(/i.exec(blanked);
  if (!head) throw new Error("CREATE TABLE 문을 찾지 못했습니다");
  const qualified = head[1].split(".").map(unquote);
  const tableName = qualified[qualified.length - 1];
  const schema = qualified.length > 1 ? qualified[0] : null;
  // 여는 괄호와 짝인 닫는 괄호(따옴표 안 괄호는 blanked 에서 이미 지워짐)
  const open = head.index + head[0].length - 1;
  let depth = 0, close = -1;
  for (let i = open; i < blanked.length; i++) {
    if (blanked[i] === "(") depth++;
    else if (blanked[i] === ")" && --depth === 0) { close = i; break; }
  }
  if (close < 0) throw new Error("CREATE TABLE 의 괄호가 닫히지 않았습니다");
  const body = sql.slice(open + 1, close);
  const oracleDate = /^(oracle|tibero)$/i.test(opts.dialect ?? "");
  const warnings: string[] = [];
  const fields: CrudFieldInput[] = [];
  const tablePk: string[] = [];
  for (const part of splitTopLevel(body, bs)) {
    const bl = blankLiterals(part, bs);
    if (CONSTRAINT_RE.test(bl)) {
      const pk = /PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(bl);
      if (pk) tablePk.push(...pk[1].split(",").map((c) => unquote(c.replace(/\s+(ASC|DESC)$/i, "")).toLowerCase()));
      else if (!/^(CONSTRAINT\s+\S+\s+)?(UNIQUE|KEY|INDEX|FULLTEXT|SPATIAL)/i.test(bl)) warnings.push(`제약 무시: ${part.replace(/\s+/g, " ").slice(0, 80)}`);
      continue;
    }
    const nameMatch = /^([`"[][^`"\]]+[`"\]]|[\w$#]+)\s+/.exec(part);
    if (!nameMatch) { warnings.push(`해석하지 못한 정의: ${part.replace(/\s+/g, " ").slice(0, 80)}`); continue; }
    const columnName = unquote(nameMatch[1]);
    const rest = part.slice(nameMatch[0].length);
    const typeMatch = TYPE_RE.exec(rest);
    if (!typeMatch) { warnings.push(`${columnName}: 타입을 읽지 못함`); continue; }
    const rawType = typeMatch[1];
    const mods = blankLiterals(rest.slice(typeMatch[0].length), bs);
    const mapped = mapSqlType(rawType, { oracleDate });
    if (!mapped.known) warnings.push(`${columnName}: 알 수 없는 타입 ${rawType} → String(VARCHAR)로 생성 — javaType 을 확인하세요`);
    const baseType = rawType.toUpperCase().replace(/\(.*$/, "").trim();
    const generated = /\bAUTO_INCREMENT\b|\bAUTOINCREMENT\b|\bIDENTITY\b|\bGENERATED\b[\s\S]*\bAS\s+IDENTITY\b|\bGENERATED\s+(ALWAYS|BY\s+DEFAULT)\b/i.test(mods) || /^(SERIAL|BIGSERIAL|SMALLSERIAL|SERIAL4|SERIAL8)$/.test(baseType);
    const primaryKey = /\bPRIMARY\s+KEY\b/i.test(mods);
    const nullable = !/\bNOT\s+NULL\b/i.test(mods) && !primaryKey;
    // COMMENT 'x' (MySQL·MariaDB·CUBRID) — 원문(rest)에서 리터럴을 읽는다
    const cm = (bs ? /\bCOMMENT\s+('(?:[^'\\]|\\.|'')*')/i : /\bCOMMENT\s+('(?:[^']|'')*')/i).exec(rest.slice(typeMatch[0].length));
    const field: CrudFieldInput = { columnName, javaType: mapped.javaType, jdbcType: mapped.jdbcType, primaryKey, generated, nullable };
    if (cm) field.label = cleanLabel(literalValue(cm[1], bs));
    fields.push(field);
  }
  for (const pk of tablePk) {
    const f = fields.find((x) => x.columnName.toLowerCase() === pk);
    if (f) { f.primaryKey = true; f.nullable = false; } else warnings.push(`PRIMARY KEY 의 컬럼 ${pk} 가 정의에 없습니다`);
  }
  // COMMENT ON COLUMN [schema.]table.col IS '...'
  for (const m of sql.matchAll(/\bCOMMENT\s+ON\s+COLUMN\s+((?:[`"]?[\w$#]+[`"]?\s*\.\s*){1,2})([`"]?[\w$#]+[`"]?)\s+IS\s+('(?:[^']|'')*')/gi)) {
    const owner = m[1].split(".").map((x) => unquote(x)).filter(Boolean);
    if (owner[owner.length - 1].toLowerCase() !== tableName.toLowerCase()) continue;
    const f = fields.find((x) => x.columnName.toLowerCase() === unquote(m[2]).toLowerCase());
    if (f) f.label = cleanLabel(literalValue(m[3]));
  }
  if (!fields.length) throw new Error(`${tableName}: 컬럼을 찾지 못했습니다`);
  if (!fields.some((f) => f.primaryKey)) warnings.push(`${tableName}: 기본키가 없습니다 — CRUD 생성에는 기본키가 필요합니다(fields 로 primaryKey 를 지정하거나 DDL 에 PRIMARY KEY 를 추가)`);
  return { tableName, schema, fields, warnings };
}

/** 라벨: 줄바꿈·제어문자 제거, 100자 */
function cleanLabel(s: string): string | undefined {
  const v = s.replace(/[\r\n\t\0]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return v || undefined;
}
