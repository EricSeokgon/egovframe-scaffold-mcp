// node test/crud-ddl.mjs — DDL 기반 CRUD·검색 조건 (v1.4, 오프라인)
//   (1) parseCreateTable: 공식 Initializr v5.0.7 의 DDL 파서 테스트(webview-ui/src/utils/__tests__/ddlParser.spec.ts)와 같은 입력에서 같은 컬럼·PK
//   (2) 방언별 타입·자동 증가·COMMENT ON COLUMN, 거부 경계
//   (3) generateCrud(ddl, search): fields 와 같은 결과, 방언 중립 LIKE(<bind>), 검색 필드 이스케이프, 생성물 보안약점 0건
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const cols = (d, o) => m.parseCreateTable(d, o).fields.map((f) => f.columnName).join(",");
const pks = (d) => m.parseCreateTable(d).fields.filter((f) => f.primaryKey).map((f) => f.columnName).join(",");
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

// ── (1) 공식 Initializr v5.0.7 DDL 파서 테스트와 같은 입력 ─────────────
const OFFICIAL = [
  ["MySQL 기본 컬럼·인라인 PK", `CREATE TABLE users (\n id INT PRIMARY KEY AUTO_INCREMENT,\n user_nm VARCHAR(50) NOT NULL\n);`, "id,user_nm", "id"],
  ["COMMENT 안 콤마로 나누지 않음", `CREATE TABLE users (\n user_id VARCHAR(20) NOT NULL COMMENT '사용자 ID, 기본키',\n user_nm VARCHAR(50) NOT NULL COMMENT '사용자 이름',\n PRIMARY KEY (user_id)\n);`, "user_id,user_nm", "user_id"],
  ["DEFAULT 안 콤마·'' 이스케이프", `CREATE TABLE codes (\n code_id VARCHAR(10) PRIMARY KEY,\n code_nm VARCHAR(50) DEFAULT 'A,B' COMMENT 'user''s code, label',\n use_yn CHAR(1) DEFAULT 'Y'\n);`, "code_id,code_nm,use_yn", "code_id"],
  ["COMMENT 의 primary key 문구는 PK 아님", `CREATE TABLE notes (\n id INT PRIMARY KEY,\n note VARCHAR(200) COMMENT 'this is the primary key column'\n);`, "id,note", "id"],
  ["문자열 안 여는 괄호", `CREATE TABLE notices (\n notice_id INT PRIMARY KEY COMMENT '공지 ID (필수',\n title VARCHAR(200) COMMENT '제목'\n);`, "notice_id,title", "notice_id"],
  ["문자열 안 닫는 괄호", `CREATE TABLE remarks (\n remark_id INT PRIMARY KEY COMMENT '비고 ID)',\n remark_ct VARCHAR(200) COMMENT '내용'\n);`, "remark_id,remark_ct", "remark_id"],
  ["\\' 이스케이프(MySQL)", `CREATE TABLE users (\n user_id VARCHAR(20) NOT NULL COMMENT 'user\\'s id',\n user_nm VARCHAR(50) NOT NULL\n);`, "user_id,user_nm", ""],
  ["큰따옴표 DEFAULT 안 아포스트로피", `CREATE TABLE users (\n user_id VARCHAR(20) NOT NULL DEFAULT "it's",\n user_nm VARCHAR(50) NOT NULL\n);`, "user_id,user_nm", ""],
  ["끝이 백슬래시인 DEFAULT", `CREATE TABLE files (\n path VARCHAR(50) DEFAULT 'C:\\',\n nm VARCHAR(10)\n);`, "path,nm", ""],
  ["끝 백슬래시 뒤 COMMENT 들", `CREATE TABLE t (\n p VARCHAR(50) DEFAULT 'C:\\',\n amt DECIMAL(10,2) COMMENT '금액(원), 세금',\n nm VARCHAR(10) COMMENT '이름, 별칭'\n);`, "p,amt,nm", ""],
  ["끝 백슬래시 + 줄 주석 아포스트로피", `CREATE TABLE a (\n p VARCHAR(50) DEFAULT 'C:\\',\n id INT -- owner's\n);`, "p,id", ""],
  ["줄 주석 안 아포스트로피", `CREATE TABLE t (\n id INT PRIMARY KEY, -- user's id\n nm VARCHAR(10)\n);`, "id,nm", "id"],
];
for (const [name, ddl, c, p] of OFFICIAL) {
  const got = (() => { try { return [cols(ddl), pks(ddl)]; } catch (e) { return [`ERR ${e.message}`, ""]; } })();
  assert(got[0] === c && got[1] === p, `공식 경계: ${name} → [${got[0]}] PK [${got[1]}]`);
}
assert(JSON.stringify(m.splitTopLevel("a DECIMAL(10,2), CHECK (a IN ('Y','N')), b INT")) === JSON.stringify(["a DECIMAL(10,2)", "CHECK (a IN ('Y','N'))", "b INT"]), "splitTopLevel: 최상위 콤마만");
assert(JSON.stringify(m.splitTopLevel("id INT COMMENT 'a''b, c', nm VARCHAR(10)")) === JSON.stringify(["id INT COMMENT 'a''b, c'", "nm VARCHAR(10)"]), "splitTopLevel: '' 안 콤마 유지");
assert(JSON.stringify(m.splitTopLevel("id INT COMMENT 'a\\', b', nm VARCHAR(10)")) === JSON.stringify(["id INT COMMENT 'a\\', b'", "nm VARCHAR(10)"]), "splitTopLevel: \\' 안 콤마 유지");
assert(JSON.stringify(m.splitTopLevel("`a,b` INT, c INT")) === JSON.stringify(["`a,b` INT", "c INT"]), "splitTopLevel: 백틱 식별자 안 콤마 유지");
assert(JSON.stringify(m.splitTopLevel("path VARCHAR(50) DEFAULT 'C:\\', nm VARCHAR(10)")) === JSON.stringify(["path VARCHAR(50) DEFAULT 'C:\\'", "nm VARCHAR(10)"]), "splitTopLevel: 끝 백슬래시를 이스케이프로 보지 않음");
assert(JSON.stringify(m.splitTopLevel("id INT COMMENT 'oops, nm VARCHAR(10)")) === JSON.stringify(["id INT COMMENT 'oops", "nm VARCHAR(10)"]), "splitTopLevel: 따옴표가 열린 채면 따옴표 무시");
assert(m.splitTopLevel(" , , ").length === 0 && m.splitTopLevel("").length === 0, "splitTopLevel: 빈 정의 제거");
assert(/비어/.test(throws(() => m.parseCreateTable(""))) && /CREATE TABLE/.test(throws(() => m.parseCreateTable("SELECT * FROM users;"))) && /닫히지/.test(throws(() => m.parseCreateTable("CREATE TABLE sample (id INT"))), "거부: 빈 입력·CREATE TABLE 아님·괄호 안 닫힘");

// ── (2) 방언·타입 ─────────────────────────────────────
const my = m.parseCreateTable(`CREATE TABLE IF NOT EXISTS \`board\` (
  BOARD_ID BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '게시물 ID',
  TITLE VARCHAR(200) NOT NULL COMMENT '제목',
  AMOUNT DECIMAL(12,2), CNT INT, RATE DOUBLE, OK TINYINT(1), FLAG BIT(1), BODY LONGTEXT, FILE_DATA LONGBLOB, REG_DT DATETIME DEFAULT CURRENT_TIMESTAMP, BIRTH DATE,
  PRIMARY KEY (BOARD_ID), KEY idx_title (TITLE), CONSTRAINT fk_x FOREIGN KEY (CNT) REFERENCES other(id)
) ENGINE=InnoDB COMMENT='board';`);
const ty = (r, c) => { const f = r.fields.find((x) => x.columnName === c); return f ? `${f.javaType}/${f.jdbcType}` : "?"; };
assert(my.tableName === "board" && my.fields.length === 11 && my.fields[0].generated && my.fields[0].primaryKey && !my.fields[0].nullable && my.fields[0].label === "게시물 ID", "MySQL: 백틱 테이블명·AUTO_INCREMENT·테이블 PK·COMMENT 라벨");
assert(ty(my, "BOARD_ID") === "Long/BIGINT" && ty(my, "AMOUNT") === "BigDecimal/DECIMAL" && ty(my, "CNT") === "Integer/INTEGER" && ty(my, "RATE") === "Double/DOUBLE" && ty(my, "FLAG") === "Boolean/BOOLEAN" && ty(my, "BODY") === "String/VARCHAR" && ty(my, "FILE_DATA") === "byte[]/BLOB" && ty(my, "REG_DT") === "LocalDateTime/TIMESTAMP" && ty(my, "BIRTH") === "LocalDate/DATE", "MySQL 타입 매핑");
assert(my.warnings.some((w) => /FOREIGN KEY/.test(w)) && !my.warnings.some((w) => /idx_title/.test(w)), "FOREIGN KEY 는 경고, 인덱스는 조용히 무시");
const pg = m.parseCreateTable(`CREATE TABLE public.member (id BIGSERIAL PRIMARY KEY, email CITEXT NOT NULL UNIQUE, joined TIMESTAMPTZ, meta JSONB, photo BYTEA, active BOOLEAN DEFAULT true, seq INTEGER GENERATED BY DEFAULT AS IDENTITY);
COMMENT ON COLUMN public.member.email IS '이메일 주소';`);
assert(pg.schema === "public" && pg.tableName === "member" && ty(pg, "id") === "Long/BIGINT" && pg.fields[0].generated && ty(pg, "joined") === "Instant/TIMESTAMP_WITH_TIMEZONE" && ty(pg, "photo") === "byte[]/BLOB" && ty(pg, "active") === "Boolean/BOOLEAN" && pg.fields.find((f) => f.columnName === "seq").generated && pg.fields.find((f) => f.columnName === "email").label === "이메일 주소", "PostgreSQL: BIGSERIAL·IDENTITY·TIMESTAMPTZ·BYTEA·COMMENT ON COLUMN");
const ora = m.parseCreateTable(`CREATE TABLE APP.ORDERS (ORDER_NO NUMBER(10) CONSTRAINT PK_O PRIMARY KEY, QTY NUMBER(5), PRICE NUMBER(12,2), BIG NUMBER, ORDER_DT DATE NOT NULL, MEMO CLOB, NM VARCHAR2(100 CHAR), RAWV RAW(16), TS TIMESTAMP(6) WITH TIME ZONE);
COMMENT ON COLUMN APP.ORDERS.ORDER_DT IS '주문 일시';`, { dialect: "oracle" });
assert(ty(ora, "ORDER_NO") === "Long/BIGINT" && ora.fields[0].primaryKey && ty(ora, "QTY") === "Integer/INTEGER" && ty(ora, "PRICE") === "BigDecimal/NUMERIC" && ty(ora, "BIG") === "BigDecimal/NUMERIC" && ty(ora, "ORDER_DT") === "LocalDateTime/TIMESTAMP" && ty(ora, "MEMO") === "String/CLOB" && ty(ora, "NM") === "String/VARCHAR" && ty(ora, "RAWV") === "byte[]/BINARY" && ty(ora, "TS") === "Instant/TIMESTAMP_WITH_TIMEZONE", "Oracle: NUMBER(p,s)·DATE(시각 포함)·CLOB·VARCHAR2·RAW·TIMESTAMP WITH TIME ZONE");
assert(ty(m.parseCreateTable("CREATE TABLE X (D DATE)", { dialect: "mysql" }), "D") === "LocalDate/DATE", "Oracle 이 아니면 DATE → LocalDate");
const hs = m.parseCreateTable("CREATE CACHED TABLE SAMPLE (ID INTEGER GENERATED BY DEFAULT AS IDENTITY (START WITH 1) PRIMARY KEY, NAME VARCHAR(50), GEO GEOMETRY)");
assert(hs.fields[0].generated && hs.fields[0].primaryKey && hs.warnings.some((w) => /GEO/.test(w) && /알 수 없는 타입/.test(w)), "HSQL: CACHED TABLE·IDENTITY, 알 수 없는 타입은 String + 경고");
assert(m.parseCreateTable("CREATE TABLE NOPK (A VARCHAR(10))").warnings.some((w) => /기본키가 없습니다/.test(w)), "기본키 없음 → 경고");

// ── (3) generateCrud(ddl, search) ─────────────────────
const roots = [];
const project = (p) => { const d = mkdtempSync(path.join(tmpdir(), p)); writeFileSync(path.join(d, "pom.xml"), "<project/>"); roots.push(d); return d; };
const DDL = `CREATE TABLE SAMPLE_BOARD (
  BOARD_ID BIGINT NOT NULL AUTO_INCREMENT COMMENT '게시글 ID, 기본키',
  TITLE VARCHAR(200) NOT NULL COMMENT '제목 (필수)',
  WRITER VARCHAR(50) DEFAULT 'anon, (guest)' COMMENT 'this is not the primary key',
  CREATED_AT DATETIME COMMENT '등록일시',
  PRIMARY KEY (BOARD_ID)
);`;
try {
  const d1 = project("egov-crud-ddl-");
  const r = m.generateCrud({ projectDir: d1, basePackage: "egovframework.example.board", ddl: DDL, search: ["TITLE", "WRITER"], dryRun: false, withTest: true });
  assert(r.tableName === "SAMPLE_BOARD" && r.entityName === "SampleBoard" && r.fieldsFromDdl === 4 && r.search.join(",") === "TITLE,WRITER" && r.files.length === 10, `ddl → 테이블·엔티티·컬럼 4·검색 2·파일 ${r.files.length}`);
  const read = (rel) => readFileSync(path.join(d1, rel), "utf8");
  const mapper = read(r.files.find((f) => f.path.endsWith("_mapper.xml")).path);
  assert(mapper.includes(`<bind name="searchKeywordLike" value="'%' + searchKeyword + '%'" />`) && (mapper.match(/<bind /g) ?? []).length === 2 && !/\|\||CONCAT\(/i.test(mapper), "Mapper: 목록·건수 모두 <bind> LIKE, || · CONCAT 없음(방언 중립)");
  assert(mapper.includes(`<when test="searchCondition == 'TITLE'">TITLE LIKE #{searchKeywordLike}</when>`) && mapper.includes("<otherwise>(TITLE LIKE #{searchKeywordLike} OR WRITER LIKE #{searchKeywordLike})</otherwise>") && /WHERE\n\s+BOARD_ID = #\{boardId,jdbcType=BIGINT\}/.test(mapper) && !/WRITER = #\{writer/.test(mapper.split("<update")[1].split("WHERE")[1]), "Mapper: searchCondition 분기·전체 OR, 수정 WHERE 는 PK(BOARD_ID)만(COMMENT 문구에 속지 않음)");
  const vo = read(r.files.find((f) => f.path.endsWith("SampleBoardVO.java")).path);
  assert(/private Long boardId;/.test(vo) && /private LocalDateTime createdAt;/.test(vo) && vo.includes("/** 제목 (필수) */") && mapper.includes('useGeneratedKeys="true" keyProperty="boardId"'), "VO: DDL 타입·COMMENT 라벨, 자동 증가 → useGeneratedKeys");
  const list = read(r.files.find((f) => f.path.endsWith("List.jsp")).path), reg = read(r.files.find((f) => f.path.endsWith("Register.jsp")).path);
  assert(list.includes(`<form:select path="searchCondition">`) && list.includes(`<form:option value="WRITER">this is not the primary key</form:option>`) && reg.includes(`<form:hidden path="searchKeyword" />`) && !/\$\{param\./.test(list + reg), "JSP: 검색 조건 select, 등록 화면 검색 hidden(form 태그 = 이스케이프), param 직접 출력 없음");
  const sc = await m.checkSecureCoding({ projectDir: d1 });
  assert(sc.findings.length === 0, `생성 CRUD 보안약점 0건 (got ${sc.findings.map((f) => f.rule).join(", ") || 0})`);

  // fields 로 준 것과 같은 결과(검색 없음 = 기존 출력 그대로)
  const d2 = project("egov-crud-ddl2-"), d3 = project("egov-crud-fields-");
  const opts = { basePackage: "egovframework.example.board", createDate: "2026-10-23", dryRun: false };
  const fromDdl = m.generateCrud({ projectDir: d2, ddl: DDL, ...opts });
  const fields = m.parseCreateTable(DDL).fields;
  const fromFields = m.generateCrud({ projectDir: d3, tableName: "SAMPLE_BOARD", fields, ...opts });
  assert(fromDdl.files.length === fromFields.files.length && fromDdl.files.every((f, i) => readFileSync(path.join(d2, f.path), "utf8") === readFileSync(path.join(d3, fromFields.files[i].path), "utf8")), "ddl 생성물 = 같은 필드를 fields 로 준 생성물(바이트 동일)");
  assert(!readFileSync(path.join(d2, fromDdl.files.find((f) => f.path.endsWith("_mapper.xml")).path), "utf8").includes("<where>"), "search 없으면 목록 조회에 WHERE 없음(기존 출력 유지)");

  // 거부
  const d4 = project("egov-crud-ddl-bad-");
  assert(/함께 줄 수 없/.test(throws(() => m.generateCrud({ projectDir: d4, basePackage: "a.b", ddl: DDL, fields }))), "ddl + fields 거부");
  assert(/다릅니다/.test(throws(() => m.generateCrud({ projectDir: d4, basePackage: "a.b", ddl: DDL, tableName: "OTHER" }))), "tableName 이 DDL 과 다르면 거부");
  assert(/문자열 컬럼만/.test(throws(() => m.generateCrud({ projectDir: d4, basePackage: "a.b", ddl: DDL, search: ["BOARD_ID"] }))) && /fields 에 없습니다/.test(throws(() => m.generateCrud({ projectDir: d4, basePackage: "a.b", ddl: DDL, search: ["NOPE"] }))), "search: 문자열 아닌 컬럼·없는 컬럼 거부");
  assert(/tableName 이 필요/.test(throws(() => m.generateCrud({ projectDir: d4, basePackage: "a.b", fields }))), "ddl 도 tableName 도 없으면 거부");
  assert(/primaryKey=true/.test(throws(() => m.generateCrud({ projectDir: d4, basePackage: "a.b", ddl: "CREATE TABLE NOPK (A VARCHAR(10), B VARCHAR(10))" }))), "DDL 에 기본키가 없으면 생성 거부");
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
}
if (process.exitCode) console.error(`crud-ddl FAIL (${n} assertions)`); else console.log(`crud-ddl OK (${n} assertions)`);
