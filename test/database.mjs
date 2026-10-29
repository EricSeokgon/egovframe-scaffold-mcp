// node test/database.mjs — DB 준비·검증(v1.10, 게이트, 오프라인·가짜 docker)
//   문장 나누기(따옴표·주석·$$)·분류·외래키/뷰 순서·중복 제거·MySQL 문자셋 교정(없음·utf8·utf8mb4 유지)·PostgreSQL 머리말,
//   INSERT 해석·한글 확인 대상, 빠진 참조 테이블 보완(연쇄), 프로젝트 원본 선택(매니페스트 순서·전체·지정)과 DbType 결정,
//   산출물(compose·명령)·dryRun 무기록·같은 내용 재실행·다른 내용 거부, Oracle(compose 없음·NLS_LANG·COMMIT), 거부 경계,
//   run=true(가짜 docker: 데몬 없음·통과·초기화 오류·keep), diagnose 의 DB 준비 줄, MCP·CLI
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-db-"));
let k = 0;
const project = (files) => { const d = path.join(root, `p${k++}`); for (const [rel, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); } return d; };

// ── 문장 나누기·분류 ──────────────────────────────────
{
  const s = m.splitSql("INSERT INTO A (X) VALUES ('a;b');\n-- 주석; 끝\nINSERT INTO A (X) VALUES ('it''s');\n/* 블록; */ CREATE TABLE B (Y INT)\n;\nCREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;\n");
  assert(s.length === 4 && s[0].endsWith("'a;b')") && s[1].includes("it''s") && s[3].includes("RETURN 1; END;"), `따옴표·주석·$$ 안의 ; 는 나누지 않음 (${s.length})`);
  const c = m.classifyStatement("CREATE TABLE COMTNBBS (\n  NTT_ID NUMERIC(20),\n  FOREIGN KEY (BBS_ID) REFERENCES COMTNBBSMASTER(BBS_ID)\n)");
  assert(c.kind === "schema" && c.table === "COMTNBBS" && c.references.join() === "COMTNBBSMASTER", "CREATE TABLE: 테이블·참조");
  const v = m.classifyStatement("CREATE VIEW COMVNUSERMASTER (A) AS SELECT A FROM COMTNGNRLMBER UNION ALL SELECT B FROM `COMTNEMPLYRINFO`");
  assert(v.table === "COMVNUSERMASTER" && v.references.join() === "COMTNGNRLMBER,COMTNEMPLYRINFO", "뷰: FROM 대상이 참조");
  assert(m.classifyStatement("insert into comtnbbs (a) values (1)").table === "COMTNBBS" && m.classifyStatement("insert into x values (1)").kind === "data" && m.classifyStatement("COMMIT").kind === "other", "INSERT 는 data, 이름은 대문자");
  const o = m.orderByReferences(["CREATE TABLE C (A INT, FOREIGN KEY (A) REFERENCES B(A))", "CREATE VIEW V AS SELECT * FROM C", "CREATE TABLE B (A INT, FOREIGN KEY (A) REFERENCES A1(A))", "CREATE TABLE A1 (A INT)"].map((t) => m.classifyStatement(t)));
  assert(o.map((x) => x.table).join() === "A1,B,C,V", `참조 순서 A1 → B → C → V (${o.map((x) => x.table).join()})`);
}

// ── 적재 본문 ─────────────────────────────────────────
{
  const ddl = "CREATE TABLE CHILD (\n  ID INT,\n  FOREIGN KEY (ID) REFERENCES PARENT(ID)\n)\n;\nCREATE UNIQUE INDEX CHILD_PK ON CHILD (ID);\nCREATE TABLE PARENT (ID INT, NM VARCHAR(10)) ENGINE=InnoDB DEFAULT CHARSET=utf8;\nCREATE TABLE OK4 (ID INT) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\nSET NAMES latin1;\n";
  const dml = "INSERT INTO CHILD (ID) VALUES (1);\nINSERT INTO PARENT (ID, NM) VALUES (1, '부모');\nCOMMIT;\n";
  const b = m.buildScripts("mysql", [{ path: "a.sql", text: ddl }, { path: "b.sql", text: dml }, { path: "a-again.sql", text: "CREATE TABLE PARENT (ID INT, NM VARCHAR(10)) ENGINE=InnoDB DEFAULT CHARSET=utf8;" }, { path: "c.sql", role: "comment", text: "ALTER TABLE PARENT COMMENT = '부모';\nALTER TABLE NOPE COMMENT = '없음';" }]);
  assert(b.tables.join() === "PARENT,CHILD,OK4" && b.schema.indexOf("CREATE TABLE PARENT") < b.schema.indexOf("CREATE TABLE CHILD") && b.schema.indexOf("CREATE TABLE CHILD") < b.schema.indexOf("CREATE UNIQUE INDEX"), "스키마: 부모 테이블 먼저, 인덱스는 테이블 뒤");
  assert(b.schema.startsWith("-- egovframe-scaffold-mcp prepare_egovframe_database — mysql schema\nSET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;\nSET FOREIGN_KEY_CHECKS = 0;") && b.schema.trimEnd().endsWith("SET FOREIGN_KEY_CHECKS = 1;") && !b.schema.includes("latin1"), "MySQL 머리말: SET NAMES utf8mb4·외래키 검사 끔(원본 SET NAMES latin1 은 뺌)");
  assert(b.charsetFixed === 2 && b.schema.includes("REFERENCES PARENT(ID)\n) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;") && b.schema.includes("(ID INT, NM VARCHAR(10)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;") && b.schema.includes("OK4 (ID INT) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;"), "문자셋: 없으면 붙이고, utf8 은 utf8mb4 로, utf8mb4+COLLATE 는 그대로");
  assert(b.data.indexOf("INSERT INTO PARENT") < b.data.indexOf("INSERT INTO CHILD") && !/^COMMIT;/m.test(b.data), "데이터: 부모 행 먼저, MySQL 은 COMMIT 없음");
  assert(b.statements.duplicates === 1 && b.statements.skipped === 3 && b.comment.includes("PARENT COMMENT") && !b.comment.includes("NOPE") && b.statements.comment === 1, "중복 1·SET/COMMIT 2 와 없는 테이블 주석 1 건너뜀");
  assert(b.dataTables.PARENT === 1 && b.dataTables.CHILD === 1, "테이블별 INSERT 수");
  const pg = m.buildScripts("postgres", [{ path: "a", text: ddl }]);
  assert(pg.schema.includes("SET client_encoding = 'UTF8';") && pg.charsetFixed === 0 && !pg.schema.includes("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4") && !pg.schema.includes("FOREIGN_KEY_CHECKS"), "PostgreSQL: client_encoding, MySQL 문자셋 교정 없음");
  const ora = m.buildScripts("oracle", [{ path: "a", text: dml }]);
  assert(ora.data.includes("\nCOMMIT;\n") && !ora.data.includes("SET "), "Oracle: 데이터 끝 COMMIT");
}

// ── INSERT·한글 확인 대상 ─────────────────────────────
{
  const p = m.parseInsert("INSERT INTO COMTNEMPLYRINFO (EMPLYR_ID, USER_NM, SBSCRB_DE, MEMO) VALUES ('webmaster','웹마스터',SYSDATE(),'a,b(c)')");
  assert(p && p.table === "COMTNEMPLYRINFO" && p.values.length === 4 && p.values[2] === "SYSDATE()" && p.values[3] === "'a,b(c)'", "INSERT 해석: 함수 호출·따옴표 안 쉼표");
  const h = m.hangulProbe("INSERT INTO T (ID, NM) VALUES (1, '숫자키');\nINSERT INTO T2 (ID, NM) VALUES ('한글키', '값');\nINSERT INTO T3 (ID, CD, NM) VALUES ('K1', 'X', '권한''관리');\n");
  assert(h && h.table === "T3" && h.key === "K1" && h.column === "NM" && h.expected === "권한'관리", "한글 확인: 키가 문자열·영문이고 한글 값이 있는 첫 행");
}

// ── 빠진 참조 보완 ────────────────────────────────────
{
  const sub = "CREATE TABLE COMTCCMMNDETAILCODE (CODE_ID VARCHAR(6), FOREIGN KEY (CODE_ID) REFERENCES COMTCCMMNCODE(CODE_ID));";
  assert(m.missingReferences([{ text: sub }]).join() === "COMTCCMMNCODE", "빠진 참조 테이블");
  const full = { ddl: ["CREATE TABLE COMTCCMMNCLCODE (CL_CODE CHAR(3));\nCREATE TABLE COMTCCMMNCODE (CODE_ID VARCHAR(6), CL_CODE CHAR(3), FOREIGN KEY (CL_CODE) REFERENCES COMTCCMMNCLCODE(CL_CODE));\nCREATE UNIQUE INDEX COMTCCMMNCODE_PK ON COMTCCMMNCODE (CODE_ID);\nCREATE TABLE UNRELATED (A INT);"], dml: ["INSERT INTO COMTCCMMNCLCODE (CL_CODE) VALUES ('EFC');\nINSERT INTO COMTCCMMNCODE (CODE_ID, CL_CODE) VALUES ('COM001','EFC');\nINSERT INTO UNRELATED (A) VALUES (1);"] };
  const s = m.supplementFrom(full, ["COMTCCMMNCODE"]);
  assert(s.tables.join() === "COMTCCMMNCLCODE,COMTCCMMNCODE" && s.text.includes("COMTCCMMNCODE_PK") && s.text.includes("VALUES ('EFC')") && !s.text.includes("UNRELATED"), "보완: 연쇄 참조(분류 코드)까지 정의·인덱스·기본 데이터");
}

// ── 프로젝트 ──────────────────────────────────────────
const GLOBALS = (db, user = "com") => `Globals.DbType = ${db}\nGlobals.${db}.DriverClassName=x\nGlobals.${db}.Url=jdbc:${db === "postgres" ? "postgresql" : db}://127.0.0.1:${db === "postgres" ? 5432 : 3307}/comdb\nGlobals.${db}.UserName=${user}\nGlobals.${db}.Password=secret\n`;
const comp = (db) => ({
  "pom.xml": "<project><groupId>x</groupId><artifactId>app</artifactId><version>1</version><packaging>war</packaging></project>",
  "src/main/resources/egovframework/egovProps/globals.properties": GLOBALS(db),
  ".egovframe-components.json": JSON.stringify({ schemaVersion: 2, source: { repo: "x/y", branch: "main" }, components: { cmm: { installedAt: "", files: [], sqlScripts: [] }, bbs: { installedAt: "", files: [], sqlScripts: [] } } }),
  [`scripts/egovframe-components/${db}/ddl/bbs.sql`]: "CREATE TABLE COMTNBBS (NTT_ID INT, USER_ID VARCHAR(20), FOREIGN KEY (USER_ID) REFERENCES COMTNEMPLYRINFO(EMPLYR_ID));\nCREATE TABLE COMTCCMMNDETAILCODE (CODE_ID VARCHAR(6), FOREIGN KEY (CODE_ID) REFERENCES COMTCCMMNCODE(CODE_ID));\n",
  [`scripts/egovframe-components/${db}/ddl/cmm.sql`]: "CREATE TABLE COMTNEMPLYRINFO (EMPLYR_ID VARCHAR(20), USER_NM VARCHAR(60));\nCREATE TABLE COMTCCMMNDETAILCODE (CODE_ID VARCHAR(6), FOREIGN KEY (CODE_ID) REFERENCES COMTCCMMNCODE(CODE_ID));\n",
  [`scripts/egovframe-components/${db}/dml/cmm.sql`]: "INSERT INTO COMTNEMPLYRINFO (EMPLYR_ID, USER_NM) VALUES ('webmaster', '웹마스터');\n",
  [`script/ddl/${db}/com_DDL.sql`]: "CREATE TABLE COMTCCMMNCLCODE (CL_CODE CHAR(3));\nCREATE TABLE COMTCCMMNCODE (CODE_ID VARCHAR(6), CL_CODE CHAR(3), FOREIGN KEY (CL_CODE) REFERENCES COMTCCMMNCLCODE(CL_CODE));\n",
  [`script/dml/${db}/com_DML.sql`]: "INSERT INTO COMTCCMMNCODE (CODE_ID, CL_CODE) VALUES ('COM001', 'EFC');\n",
});
{
  const d = project(comp("mysql"));
  const r = await m.prepareDatabase({ projectDir: d, offline: true });
  assert(r.database === "mysql" && r.databaseFrom === "project" && r.dryRun && !existsSync(path.join(d, "scripts/egovframe-db")), "DbType 은 Globals.DbType, dryRun 은 쓰지 않음");
  assert(r.sources.filter((s) => s.kind === "components").map((s) => path.posix.basename(s.path)).join() === "cmm.sql,bbs.sql,cmm.sql", "원본: 조립 선별본(매니페스트 설치 순서 cmm → bbs, ddl → dml)");
  assert(r.supplemented.join() === "COMTCCMMNCLCODE,COMTCCMMNCODE" && r.notes.some((x) => x.includes("script/ddl/mysql/")), "선별본이 빠뜨린 참조 테이블을 프로젝트의 통합 스크립트에서 보완(offline)");
  assert(r.tables === 5 && r.statements.duplicates === 1 && r.connection.database === "comdb" && r.connection.user === "com" && r.connection.port === 3307 && r.connection.passwordKey === "Globals.mysql.Password", `테이블 5·중복 1·접속 정보는 globals.properties (${r.tables}, ${JSON.stringify(r.connection)})`);
  assert(r.outputs.map((o) => `${o.path}:${o.status}`).join() === "scripts/egovframe-db/mysql/01-schema.sql:create,scripts/egovframe-db/mysql/02-data.sql:create,scripts/egovframe-db/docker-compose.db.yml:create", "산출물 3개");
  assert(r.commands.bash.some((c) => c.startsWith("mysql --default-character-set=utf8mb4 -h 127.0.0.1 -P 3307 -u com -p comdb < scripts/egovframe-db/mysql/01-schema.sql")) && r.commands.cmd.some((c) => c.endsWith("scripts\\egovframe-db\\mysql\\02-data.sql")) && r.commands.bash[0].includes("docker compose -f scripts/egovframe-db/docker-compose.db.yml up -d"), "적재 명령 bash·cmd");
  const w = await m.prepareDatabase({ projectDir: d, offline: true, dryRun: false, imageRegistry: "mirror.gcr.io/library" });
  const schema = readFileSync(path.join(d, "scripts/egovframe-db/mysql/01-schema.sql"), "utf8");
  const compose = readFileSync(path.join(d, "scripts/egovframe-db/docker-compose.db.yml"), "utf8");
  assert(w.outputs.every((o) => o.status === "written") && schema.indexOf("CREATE TABLE COMTCCMMNCLCODE") < schema.indexOf("CREATE TABLE COMTCCMMNCODE") && schema.indexOf("CREATE TABLE COMTCCMMNCODE") < schema.indexOf("CREATE TABLE COMTCCMMNDETAILCODE") && schema.indexOf("CREATE TABLE COMTNEMPLYRINFO") < schema.indexOf("CREATE TABLE COMTNBBS"), "적재 순서: 보완한 부모 → 선별본 자식");
  assert(compose.includes("image: ${DB_REGISTRY:-mirror.gcr.io/library}/mysql:8.4") && compose.includes("MYSQL_DATABASE: comdb") && compose.includes("MYSQL_USER: com") && compose.includes("MYSQL_PASSWORD: ${DB_PASSWORD:?") && compose.includes(`"127.0.0.1:\${DB_PORT:-3307}:3306"`) && compose.includes("./mysql:/docker-entrypoint-initdb.d:ro") && compose.includes('"--character-set-server=utf8mb4"') && !compose.includes("secret"), "compose: 레지스트리·DB·계정·포트(설정 파일 값)·초기화 마운트·문자셋, 비밀번호는 쓰지 않음");
  const again = await m.prepareDatabase({ projectDir: d, offline: true, dryRun: false, imageRegistry: "mirror.gcr.io/library" });
  assert(again.outputs.every((o) => o.status === "same"), "같은 내용이면 그대로(재실행 무변경)");
  writeFileSync(path.join(d, "scripts/egovframe-db/mysql/01-schema.sql"), schema + "-- 사용자 수정\n");
  let e = ""; try { await m.prepareDatabase({ projectDir: d, offline: true, dryRun: false, imageRegistry: "mirror.gcr.io/library" }); } catch (x) { e = x.message; }
  const dr = await m.prepareDatabase({ projectDir: d, offline: true, imageRegistry: "mirror.gcr.io/library" });
  assert(/덮어쓰지 않습니다: scripts\/egovframe-db\/mysql\/01-schema.sql/.test(e) && readFileSync(path.join(d, "scripts/egovframe-db/mysql/01-schema.sql"), "utf8").endsWith("-- 사용자 수정\n") && dr.notes.some((x) => x.includes("적용하면 거부")), "다른 내용의 기존 파일은 덮어쓰지 않음(dryRun 은 안내)");
  const dg = m.diagnoseProject({ projectDir: d });
  assert(dg.dbScripts.componentScripts === 3 && dg.dbScripts.prepared.join() === "mysql" && dg.dbScripts.compose, "diagnose: DB 준비 상태");
  const dg2 = m.diagnoseProject({ projectDir: project(comp("mysql")) });
  assert(dg2.dbScripts.prepared.length === 0 && dg2.suggestions.some((x) => x.includes("prepare_egovframe_database")), "diagnose: 준비 전이면 제안");
}
{
  // root 계정 → MYSQL_USER 없음, 이상한 DB 이름은 따옴표
  const files = comp("mysql");
  files["src/main/resources/egovframework/egovProps/globals.properties"] = "Globals.DbType = mysql\nGlobals.mysql.Url=jdbc:mysql://h:3306/com db\nGlobals.mysql.UserName=root\n";
  const r = await m.prepareDatabase({ projectDir: project(files), offline: true });
  const yml = m.renderDbCompose("mysql", r.connection);
  assert(!yml.includes("MYSQL_USER") && /MYSQL_DATABASE: (com|"com db")\n/.test(yml), "root 계정이면 앱 계정 없이 root 만");
  const pg = m.renderDbCompose("postgres", { database: "comdb", user: "com", passwordKey: null, port: 5432, host: null, source: null });
  assert(pg.includes("POSTGRES_USER: com") && pg.includes("POSTGRES_DB: comdb") && pg.includes("--encoding=UTF8") && pg.includes("postgres:16"), "PostgreSQL compose: 사용자·DB·UTF8");
  assert(m.renderDbCompose("oracle", r.connection) === null, "Oracle 은 compose 없음");
}
{
  // Oracle·지정 스크립트·이름 규칙
  const d = project({ "pom.xml": "<project/>", "src/main/resources/egovframework/egovProps/globals.properties": "Globals.DbType = oracle\n", "db/oracle/app_ddl_oracle.sql": "CREATE TABLE A (ID NUMBER);\n", "db/oracle/app_data_oracle.sql": "INSERT INTO A (ID) VALUES (1);\n" });
  const o = await m.prepareDatabase({ projectDir: d, offline: true });
  assert(o.sources.map((s) => `${s.path}:${s.kind}`).join() === "db/oracle/app_ddl_oracle.sql:found,db/oracle/app_data_oracle.sql:found" && !o.outputs.some((x) => x.path.endsWith(".yml")) && o.commands.bash[0] === "export NLS_LANG=KOREAN_KOREA.AL32UTF8" && o.commands.cmd[0] === "set NLS_LANG=KOREAN_KOREA.AL32UTF8", "Oracle: 이름 규칙 원본·compose 없음·NLS_LANG");
  const l = await m.prepareDatabase({ projectDir: d, offline: true, database: "postgresql", scripts: ["db/oracle/app_ddl_oracle.sql"] });
  assert(l.database === "postgres" && l.databaseFrom === "parameter" && l.sources.length === 1 && l.sources[0].kind === "listed", "database 별칭(postgresql → postgres)·scripts 지정");
}
for (const [opts, re, label] of [
  [{ database: "hsql" }, /HSQL 은 내장/, "hsql 거부"],
  [{ database: "sqlite" }, /지원하지 않는 DB: sqlite/, "모르는 DB 거부"],
  [{ database: "mysql", scripts: ["../x.sql"] }, /프로젝트 밖/, "프로젝트 밖 스크립트 거부"],
  [{ database: "tibero" }, /tibero 스크립트를 찾지 못했습니다/, "스크립트 없음 거부"],
  [{ database: "mysql", imageRegistry: "evil registry/x" }, /imageRegistry 형식/, "이미지 레지스트리 형식"],
  [{}, /DB 종류를 정하지 못했습니다/, "DbType 없음 거부"],
]) {
  let e = ""; try { await m.prepareDatabase({ projectDir: project({ "pom.xml": "<project/>", "x.sql": "" }), offline: true, ...opts }); } catch (x) { e = x.message; }
  assert(re.test(e), label);
}

// ── run=true (가짜 docker) ────────────────────────────
{
  const d = project(comp("mysql"));
  const calls = [];
  const fake = (mode) => async (args) => {
    calls.push(args.join(" "));
    if (args[0] === "version") return mode === "nodaemon" ? { code: 1, out: "Cannot connect to the Docker daemon" } : { code: 0, out: "29.0\n" };
    if (args[0] === "run") return { code: 0, out: "cid\n" };
    if (args[0] === "logs") return { code: 0, out: mode === "error" ? "running /docker-entrypoint-initdb.d/01-schema.sql\nERROR 1064 (42000) at line 3: You have an error in your SQL syntax\n" : "MySQL init process done. Ready for start up.\n" };
    if (args[0] === "inspect") return { code: 0, out: mode === "error" ? "false\n" : "true\n" };
    if (args[0] === "exec") {
      const sql = args[args.length - 1];
      if (/information_schema/.test(sql)) return { code: 0, out: "5\n" };
      if (/COUNT\(\*\) FROM (COMTNEMPLYRINFO|COMTCCMMNCODE)/.test(sql)) return { code: 0, out: "1\n" };
      if (/HEX\(USER_NM\)/.test(sql)) return { code: 0, out: `${Buffer.from("웹마스터").toString("hex").toUpperCase()}\n` };
      return { code: 0, out: "0\n" };
    }
    if (args[0] === "port") return { code: 0, out: "127.0.0.1:49153\n" };
    return { code: 0, out: "" };
  };
  const nd = await m.prepareDatabase({ projectDir: d, offline: true, run: true, docker: fake("nodaemon") });
  assert(nd.run.ran === false && /Docker 데몬/.test(nd.run.reason), "run: Docker 데몬이 없으면 건너뜀(사유)");
  calls.length = 0;
  const ok = await m.prepareDatabase({ projectDir: d, offline: true, run: true, docker: fake("ok"), timeoutMs: 60_000 });
  const runCall = calls.find((c) => c.startsWith("run "));
  assert(ok.run.ok && ok.run.tables.actual === 5 && ok.run.rows.find((x) => x.table === "COMTNEMPLYRINFO").actual === 1 && ok.run.hangul.ok && ok.run.hangul.expected === "웹마스터", "run 통과: 테이블 수·필수 행·한글 왕복");
  assert(runCall.includes("-e MYSQL_DATABASE=comdb") && runCall.includes("-e MYSQL_USER=com") && runCall.includes("docker.io/library/mysql:8.4 --character-set-server=utf8mb4") && runCall.includes(":/docker-entrypoint-initdb.d:ro") && calls.some((c) => c.startsWith("rm -f -v egovframe-db-")) && !existsSync(path.join(d, "scripts/egovframe-db")), "run: 공식 이미지·초기화 마운트, 끝나면 컨테이너 삭제, dryRun 이면 프로젝트에 쓰지 않음");
  calls.length = 0;
  const bad = await m.prepareDatabase({ projectDir: d, offline: true, run: true, docker: fake("error"), timeoutMs: 60_000 });
  assert(!bad.run.ok && bad.run.errors[0].startsWith("ERROR 1064") && /멈췄습니다/.test(bad.run.reason) && calls.some((c) => c.startsWith("rm -f")), "run 실패: 초기화 오류 줄·사유, 컨테이너 삭제");
  calls.length = 0;
  const kept = await m.prepareDatabase({ projectDir: d, offline: true, run: true, keep: true, docker: fake("ok"), timeoutMs: 60_000 });
  assert(kept.run.kept && kept.run.port === 49153 && !calls.some((c) => c.startsWith("rm ")), "keep=true: 컨테이너 유지·포트");
  const md = m.renderDatabaseMarkdown(ok);
  assert(md.includes("DB 준비 계획(dryRun) — mysql") && md.includes("✅ 통과") && md.includes("한글 왕복 ✅"), "Markdown");
  const ora = await m.prepareDatabase({ projectDir: project({ "pom.xml": "<project/>", "a_ddl_oracle.sql": "CREATE TABLE A (ID NUMBER);" }), database: "oracle", offline: true, run: true, docker: fake("ok") });
  assert(ora.run.ran === false && /공개 이미지 규칙이 없어/.test(ora.run.reason), "run: Oracle 은 컨테이너 확인 안 함");
}

// MCP·CLI
{
  const d = project(comp("postgres"));
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  const call = await client.callTool({ name: "prepare_egovframe_database", arguments: { projectDir: d, offline: true, format: "json" } });
  assert(!call.isError && call.structuredContent?.database === "postgres" && call.structuredContent.dryRun === true && call.structuredContent.tables === 5, "MCP 호출: outputSchema 통과·기본 dryRun");
  const bad = await client.callTool({ name: "prepare_egovframe_database", arguments: { projectDir: d, database: "sqlite" } });
  assert(bad.isError, "모르는 database 는 입력 검증에서 거부");
  const dg = await client.callTool({ name: "diagnose_egovframe_project", arguments: { projectDir: d } });
  assert(!dg.isError && dg.content[0].text.includes("DB 준비: 조립 스크립트 3개"), "diagnose 응답에 DB 준비 줄");
  await client.close(); await server.close();
  const io = () => { const o = [], e = []; return { cwd: d, env: {}, stdout: (x) => o.push(x), stderr: (x) => e.push(x), o, e }; };
  const i1 = io();
  assert(await m.runCli(["db", "--project", d, "--offline"], i1) === 0 && i1.e.join("").includes("준비 계획") && !existsSync(path.join(d, "scripts/egovframe-db")), "CLI db: 기본은 계획만");
  const i2 = io();
  assert(await m.runCli(["db", "--project", d, "--offline", "--write"], i2) === 0 && existsSync(path.join(d, "scripts/egovframe-db/postgres/01-schema.sql")) && readFileSync(path.join(d, "scripts/egovframe-db/postgres/01-schema.sql"), "utf8").includes("SET client_encoding = 'UTF8';"), "CLI db --write: 파일 기록");
}

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`database FAIL (${n} assertions)`); else console.log(`database OK (${n} assertions)`);
