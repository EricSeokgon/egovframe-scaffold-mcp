// node test/crud-search-live.mjs — 생성 Mapper 의 검색 SQL 실행 검증 (v1.4, CI 통합: JDK 17·Maven·네트워크)
//   generate_egovframe_crud(ddl, search) 가 만든 Mapper XML 을 MyBatis 3.5.19 로 읽어 HSQLDB 의 MySQL·PostgreSQL·Oracle 문법 모드에서
//   같은 데이터에 같은 검색을 실행하고 결과 건수가 모드마다 같은지(방언 중립 <bind> LIKE) 확인한다.
//   공식 Initializr v5.0.7 이 고친 문제: LIKE 패턴을 || 로 결합하면 MySQL 기본 설정에서 || 가 논리 OR 라 검색어와 무관하게 전체 행이 나온다.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-crud-search-"));
const isWin = process.platform === "win32";
const run = (cmd, args, cwd) => spawnSync(isWin ? (process.env.ComSpec || "cmd.exe") : cmd, isWin ? ["/d", "/s", "/c", cmd, ...args] : args, { cwd, encoding: "utf8", timeout: 600_000 });
const find = (dir, re) => { for (const e of readdirSync(dir)) { const p = path.join(dir, e); if (statSync(p).isDirectory()) { const r = find(p, re); if (r) return r; } else if (re.test(e)) return p; } return null; };

try {
  const gen = path.join(root, "gen");
  spawnSync(process.execPath, ["-e", `require("fs").mkdirSync(${JSON.stringify(gen)});require("fs").writeFileSync(${JSON.stringify(path.join(gen, "pom.xml"))}, "<project/>")`]);
  m.generateCrud({ projectDir: gen, basePackage: "x.y", entityName: "Board", ddl: "CREATE TABLE BOARD (ID INT NOT NULL, TITLE VARCHAR(50) COMMENT '제목, 검색', WRITER VARCHAR(50), PRIMARY KEY (ID))", search: ["TITLE", "WRITER"], checkService: false, checkWeb: false });
  const mapper = find(gen, /_mapper\.xml$/);
  writeFileSync(path.join(root, "mapper.xml"), readFileSync(mapper, "utf8"));
  // v1.8: 페이징 Mapper 두 방식 — LIMIT/OFFSET(MySQL·PostgreSQL 문법 모드에서), ROWNUM 감싸기(Oracle 문법 모드에서)
  for (const [dialect, file] of [["mysql", "mapper-limit.xml"], ["oracle", "mapper-rownum.xml"]]) {
    const g = path.join(root, `gen-${dialect}`);
    spawnSync(process.execPath, ["-e", `require("fs").mkdirSync(${JSON.stringify(g)});require("fs").writeFileSync(${JSON.stringify(path.join(g, "pom.xml"))}, "<project/>")`]);
    m.generateCrud({ projectDir: g, basePackage: "x.y", entityName: "Board", ddl: "CREATE TABLE BOARD (ID INT NOT NULL, TITLE VARCHAR(50), WRITER VARCHAR(50), PRIMARY KEY (ID))", search: ["TITLE", "WRITER"], paging: true, dialect, checkService: false, checkWeb: false });
    writeFileSync(path.join(root, file), readFileSync(find(g, /_mapper\.xml$/), "utf8"));
  }
  writeFileSync(path.join(root, "pom.xml"), `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>x</groupId><artifactId>search</artifactId><version>1</version>
<dependencies><dependency><groupId>org.mybatis</groupId><artifactId>mybatis</artifactId><version>3.5.19</version></dependency><dependency><groupId>org.hsqldb</groupId><artifactId>hsqldb</artifactId><version>2.7.4</version></dependency></dependencies></project>`);
  const cpRun = run(process.env.MAVEN_CMD || (isWin ? "mvn.cmd" : "mvn"), ["-q", "dependency:build-classpath", "-Dmdep.outputFile=cp.txt"], root);
  assert(cpRun.status === 0, `MyBatis·HSQLDB 클래스패스 준비${cpRun.status === 0 ? "" : `: ${cpRun.stderr || cpRun.stdout}`}`);
  writeFileSync(path.join(root, "Run.java"), `import java.util.*;
import org.apache.ibatis.session.*;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
public class Run {
  public static void main(String[] a) throws Exception {
    for (String mode : new String[]{"MYS", "PGS", "ORA"}) {
      run(mode, "mapper.xml", false);
      run(mode, "ORA".equals(mode) ? "mapper-rownum.xml" : "mapper-limit.xml", true);
    }
  }
  static String ids(List<Map<String,Object>> rows) { StringBuilder b = new StringBuilder(); for (Map<String,Object> r : rows) { Object v = r.get("ID"); if (v == null) v = r.get("id"); b.append(b.length() > 0 ? "," : "").append(v); } return "[" + b + "]"; }
  static void run(String mode, String file, boolean paging) throws Exception {
    {
      UnpooledDataSource ds = new UnpooledDataSource("org.hsqldb.jdbc.JDBCDriver", "jdbc:hsqldb:mem:" + mode + (paging ? "p" : "") + ";sql.syntax_" + mode.toLowerCase() + "=true", "SA", "");
      Configuration c = new Configuration(new Environment("e", new JdbcTransactionFactory(), ds));
      String xml = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(file)), "UTF-8")
        .replaceAll("parameterType=\\"[^\\"]+\\"", "parameterType=\\"map\\"").replaceAll("resultMap=\\"[^\\"]+\\"", "resultType=\\"map\\"").replaceAll("(?s)<resultMap.*?</resultMap>", "");
      new XMLMapperBuilder(new java.io.ByteArrayInputStream(xml.getBytes("UTF-8")), c, "m", c.getSqlFragments()).parse();
      try (SqlSession s = new SqlSessionFactoryBuilder().build(c).openSession(true)) {
        s.getConnection().createStatement().execute("CREATE TABLE BOARD (ID INT PRIMARY KEY, TITLE VARCHAR(50), WRITER VARCHAR(50))");
        s.getConnection().createStatement().execute("INSERT INTO BOARD VALUES (1,'hello world','kim'),(2,'bye','lee'),(3,'other','hello')");
        String ns = "x.y.service.impl.BoardMapper.";
        Map<String,Object> p = new HashMap<>();
        if (paging) { p.put("recordCountPerPage", 100); p.put("firstIndex", 0); }
        StringBuilder out = new StringBuilder(mode).append(" all=").append(s.selectList(ns + "selectBoardList", p).size());
        p.put("searchKeyword", "hello"); out.append(" any=").append(s.selectList(ns + "selectBoardList", p).size());
        p.put("searchCondition", "TITLE"); out.append(" title=").append(s.selectList(ns + "selectBoardList", p).size());
        p.put("searchCondition", "WRITER"); out.append(" writer=").append(s.selectList(ns + "selectBoardList", p).size()).append(" cnt=").append((Object) s.selectOne(ns + "selectBoardListTotCnt", p));
        p.put("searchKeyword", "%"); p.remove("searchCondition"); out.append(" pct=").append(s.selectList(ns + "selectBoardList", p).size());
        if (paging) {
          // 페이지(크기 2): 1쪽 [1,2] · 2쪽 [3], 검색 hello(크기 1): 1쪽 [1] · 2쪽 [3]
          Map<String,Object> q = new HashMap<>();
          q.put("recordCountPerPage", 2); q.put("firstIndex", 0); out.append(" p1=").append(ids(s.selectList(ns + "selectBoardList", q)));
          q.put("firstIndex", 2); out.append(" p2=").append(ids(s.selectList(ns + "selectBoardList", q)));
          q.put("searchKeyword", "hello"); q.put("recordCountPerPage", 1); q.put("firstIndex", 0); out.append(" s1=").append(ids(s.selectList(ns + "selectBoardList", q)));
          q.put("firstIndex", 1); out.append(" s2=").append(ids(s.selectList(ns + "selectBoardList", q)));
          out.append(" scnt=").append((Object) s.selectOne(ns + "selectBoardListTotCnt", q));
          System.out.println("PAGED " + out);
        } else System.out.println(out);
      }
    }
  }
}
`);
  const cp = readFileSync(path.join(root, "cp.txt"), "utf8").trim();
  const j = spawnSync("java", ["-cp", cp, "Run.java"], { cwd: root, encoding: "utf8", timeout: 300_000 });
  const lines = (j.stdout || "").trim().split(/\r?\n/).filter((l) => /^(MYS|PGS|ORA) /.test(l));
  const paged = (j.stdout || "").trim().split(/\r?\n/).filter((l) => /^PAGED (MYS|PGS|ORA) /.test(l));
  console.log(lines.join("\n"));
  assert(j.status === 0 && lines.length === 3, `Mapper 를 MyBatis 로 읽고 3개 문법 모드에서 실행${j.status === 0 ? "" : `: ${(j.stderr || "").slice(0, 400)}`}`);
  const expect = "all=3 any=2 title=1 writer=1 cnt=1 pct=3";
  assert(lines.every((l) => l.endsWith(expect)), `MySQL·PostgreSQL·Oracle 모드 결과 동일(${expect}) — 검색어와 무관한 전체 행 반환 없음`);
  console.log(paged.join("\n"));
  const pexp = `${expect} p1=[1,2] p2=[3] s1=[1] s2=[3] scnt=2`;
  assert(paged.length === 3 && paged.every((l) => l.endsWith(pexp)), `v1.8 페이징: LIMIT/OFFSET(MySQL·PostgreSQL 모드)·ROWNUM(Oracle 모드) 결과 동일(${pexp}) — 정렬된 페이지·검색과 함께`);
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`crud-search-live FAIL (${n} assertions)`); else console.log(`crud-search-live OK (${n} assertions)`);
