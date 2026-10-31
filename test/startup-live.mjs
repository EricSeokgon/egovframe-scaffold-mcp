// node test/startup-live.mjs — 기동 검증(v1.11) 실자산 검증 (CI 통합: 네트워크·Maven·JDK 17)
//   (1) 공식 템플릿 7종을 내장 HSQL 로 실제 기동 — web·simple-homepage·portal-site·enterprise-business·mobile-web(Classic war → Tomcat 10.1),
//       boot-web·simple-backend(Spring Boot) — 각 2분 이내, HTTP 5xx 아님
//   (2) 일부러 깨뜨린 사본의 원인 분류 — 매퍼 XML 태그 오류(파일·줄), 없는 설정 XML import, 없는 빈 클래스(실패한 빈·정의 파일),
//       DB 를 mysql 로 바꿔 접속 거부(기동 뒤 health 503), oracle 로 바꿔 드라이버 없음
//   (3) batch-db-web 템플릿은 hsqlManager 빈이 GUI 창을 띄워 화면 없는 환경에서 실패 — 그 원인으로 분류되는지(upstream 템플릿 특성)
//   포털·업무 템플릿은 v1.11 의 create_egovframe_project(database="hsql") 가 Globals.Hsql.AutoInit 을 켜야 뜬다(그 회귀도 함께).
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-startup-live-"));
const mk = (template, name = template) => m.createProject({ template, projectName: `st-${name}`, groupId: "egovframework.example", outputDir: root, database: "hsql" }).then((c) => c.projectPath);
const show = (r) => `${r.success ? "기동" : "실패"} · ${Math.round(r.durationMs / 1000)}초${r.http ? ` · HTTP ${r.http.status}` : ""}${r.cause ? ` · ${r.cause.kind}: ${r.cause.summary.slice(0, 160)}` : ""}`;
const edit = (dir, rel, f) => { const p = path.join(dir, rel); writeFileSync(p, f(readFileSync(p, "utf8"))); };
const copy = async (template, name) => mk(template, name);

try {
  for (const [template, runtime] of [["web", "tomcat"], ["boot-web", "boot"], ["simple-backend", "boot"], ["simple-homepage", "tomcat"], ["portal-site", "tomcat"], ["enterprise-business", "tomcat"], ["mobile-web", "tomcat"]]) {
    const dir = await mk(template);
    const r = await m.verifyStartup({ projectDir: dir, timeoutMs: 600_000 });
    info(`${template}: ${show(r)}`);
    assert(r.success && r.runtime === runtime && r.started, `${template}: 내장 HSQL 로 기동 (${runtime}${r.startedInMs ? `, ${(r.startedInMs / 1000).toFixed(1)}초` : ""})${r.success ? "" : `\n${r.cause?.hint ?? ""}\n${r.logTail}`}`);
    // 의존성 캐시가 데워진 뒤의 기동 시간(첫 템플릿은 다운로드 포함이라 단언 제외)
    if (template !== "web" && template !== "boot-web") assert(r.durationMs < 120_000, `${template}: 2분 이내 (${Math.round(r.durationMs / 1000)}초)`);
  }

  // 일부러 깨뜨린 사본
  const mapper = await copy("web", "mapper");
  const mdir = path.join(mapper, "src/main/resources/egovframework/sqlmap/example/mappers");
  const mfile = readdirSync(mdir).find((f) => f.endsWith(".xml"));
  edit(mapper, `src/main/resources/egovframework/sqlmap/example/mappers/${mfile}`, (t) => t.replace("</select>", "</selectX>"));
  const r1 = await m.verifyStartup({ projectDir: mapper });
  info(`매퍼 XML: ${show(r1)}`);
  assert(!r1.success && r1.cause?.kind === "mapper-xml" && r1.cause.resource === `src/main/resources/egovframework/sqlmap/example/mappers/${mfile}` && r1.cause.line > 0, `매퍼 XML 오류 → 원본 경로·줄 (${r1.cause?.resource}:${r1.cause?.line})`);

  const cfg = await copy("web", "config");
  edit(cfg, "src/main/resources/egovframework/spring/context-common.xml", (t) => t.replace("</beans>", '    <import resource="classpath:/egovframework/spring/missing/context-nothing.xml"/>\n</beans>'));
  const r2 = await m.verifyStartup({ projectDir: cfg });
  info(`설정 누락: ${show(r2)}`);
  assert(!r2.success && r2.cause?.kind === "config-missing" && r2.cause.resource === "egovframework/spring/missing/context-nothing.xml", "없는 설정 XML import → config-missing");

  const bean = await copy("web", "bean");
  edit(bean, "src/main/resources/egovframework/spring/context-common.xml", (t) => t.replace('class="org.egovframe.rte.fdl.cmmn.trace.LeaveaTrace"', 'class="org.egovframe.rte.fdl.cmmn.trace.LeaveaTraceMissing"'));
  const r3 = await m.verifyStartup({ projectDir: bean });
  info(`빈 클래스: ${show(r3)}`);
  assert(!r3.success && r3.cause?.kind === "bean-creation" && r3.cause.bean === "leaveaTrace" && r3.cause.resource === "src/main/resources/egovframework/spring/context-common.xml", "없는 빈 클래스 → 실패한 빈·정의 파일");

  const db = await copy("simple-backend", "db");
  edit(db, "src/main/resources/application.properties", (t) => t.replace(/^Globals\.DbType=hsql/m, "Globals.DbType=mysql"));
  const r4 = await m.verifyStartup({ projectDir: db });
  info(`DB 접속: ${show(r4)}`);
  assert(!r4.success && r4.cause?.kind === "db-connection" && /mysql/.test(r4.cause.jdbcUrl ?? "") && /prepare_egovframe_database/.test(r4.cause.hint), "mysql 로 바꿔 DB 없음 → db-connection·JDBC URL·DB 준비 처방");

  const drv = await copy("simple-backend", "driver");
  edit(drv, "src/main/resources/application.properties", (t) => t.replace(/^Globals\.DbType=hsql/m, "Globals.DbType=oracle"));
  const r5 = await m.verifyStartup({ projectDir: drv });
  info(`드라이버: ${show(r5)}`);
  assert(!r5.success && r5.cause?.kind === "driver-missing" && /oracle/i.test(r5.cause.driver ?? "") && r5.cause.hint.includes("ojdbc11"), "oracle 로 바꿔 드라이버 없음 → 좌표 처방");

  const batch = await mk("batch-db-web");
  const r6 = await m.verifyStartup({ projectDir: batch });
  info(`batch-db-web: ${show(r6)}`);
  if (r6.success) info("batch-db-web 이 기동했습니다 — 템플릿의 hsqlManager(GUI) 빈이 바뀐 것 같습니다. 이 단언을 기동 성공으로 바꾸세요");
  else assert(r6.cause?.kind === "bean-creation" && r6.cause.bean === "hsqlManager" && /GUI/.test(r6.cause.hint), "batch-db-web: GUI 빈(hsqlManager) → 화면 없는 환경 처방");
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`startup-live FAIL (${n} assertions)`); else console.log(`startup-live OK (${n} assertions)`);
