// node test/operations-live.mjs — 운영 준비 점검(v1.15) 실자산 검증 (CI 통합: 네트워크·Maven·JDK 17)
//   (1) 공식 템플릿 6종의 점검 결과가 선행 조사 실측 기대값과 같음(규칙별 미달/통과)
//   (2) portal-site 사본에 제안을 적용(실제 드라이버·INFO 로그·풀 타임아웃·세션 30·업로드 50MB·AutoInit 유지)해도 verify_egovframe_startup 으로 여전히 뜸,
//       점검 등급이 C → A/B 로 올라감
//   (3) 공통컴포넌트 코퍼스 4.3.2 점검표 수치(정보)
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCorpus, materializeEntry } from "../scripts/corpus-lib.mjs";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-ops-live-"));
const mk = (template) => m.createProject({ template, projectName: `ops-${template}`, groupId: "egovframework.example", outputDir: root, database: "hsql" }).then((c) => c.projectPath);
const failed = (r) => r.rules.filter((x) => x.status === "fail").map((x) => x.rule).sort().join(",");

try {
  // (1) 템플릿 기대값(2026-11-04 실측)
  const expect = {
    web: { grade: "C", fail: "console-only-logging,cookie-flags,debug-log-level,embedded-db-in-production,session-timeout" },
    "boot-web": { grade: "B", fail: "console-only-logging,devtools-dependency,no-production-profile,session-timeout" },
    "simple-backend": { grade: "C", fail: "devtools-dependency,egov-dev-flags,embedded-db-in-production,pool-size-missing,pool-timeouts-missing,sql-logging-driver,upload-path" },
    "simple-homepage": { grade: "C", fail: "debug-log-level,egov-dev-flags,embedded-db-in-production,pool-timeouts-missing,sql-logging-driver,upload-limits" },
    "portal-site": { grade: "C", fail: "debug-log-level,egov-dev-flags,embedded-db-in-production,hardcoded-secret-config,pool-timeouts-missing,sql-logging-driver,upload-limits" },
    "enterprise-business": { grade: "C", fail: "debug-log-level,egov-dev-flags,embedded-db-in-production,hardcoded-secret-config,pool-timeouts-missing,sql-logging-driver,upload-limits" },
  };
  const dirs = {};
  for (const [t, e] of Object.entries(expect)) {
    const d = await mk(t); dirs[t] = d;
    const r = await m.checkOperations({ projectDir: d });
    info(`${t}: ${r.grade.grade} · ${JSON.stringify(r.summary)} · 미달 ${failed(r)}`);
    assert(r.grade.grade === e.grade && failed(r) === e.fail, `${t}: 등급 ${e.grade} · 미달 규칙 = 실측 기대값${failed(r) === e.fail ? "" : ` (got ${failed(r)})`}`);
  }

  // (2) portal-site: 제안 적용 사본이 뜸
  const p = dirs["portal-site"];
  const edit = (rel, f) => { const q = path.join(p, rel); writeFileSync(q, f(readFileSync(q, "utf8"))); };
  const G = "src/main/resources/egovframework/egovProps/globals.properties";
  edit(G, (t) => t
    .replace(/^Globals\.DriverClassName = .*$/m, "Globals.DriverClassName = com.mysql.cj.jdbc.Driver")
    .replace(/^Globals\.Url = jdbc:log4jdbc:/m, "Globals.Url = jdbc:")
    .replace(/^Globals\.hsql\.DriverClassName = .*$/m, "Globals.hsql.DriverClassName = org.hsqldb.jdbcDriver")
    .replace(/^Globals\.hsql\.Url = jdbc:log4jdbc:/m, "Globals.hsql.Url = jdbc:")
    .replace(/^Globals\.LocalIp = .*$/m, "Globals.LocalIp = 10.0.0.10")
    .replace(/^Globals\.fileUpload\.maxRequestSize = .*$/m, "Globals.fileUpload.maxRequestSize = 52428800")
    .replace(/^(Globals\.Password = )(.*)$/m, (_m, k, v) => `${k}\${EGOV_PASSWORD:${v}}`)); // 템플릿의 원래 값을 기본값으로(리터럴을 테스트에 두지 않음)
  edit("src/main/resources/log4j2.xml", (t) => t.replace(/level="DEBUG"/g, 'level="INFO"'));
  edit("src/main/resources/egovframework/spring/com/context-datasource.xml", (t) => t.replace(/<property name="maximumPoolSize" value="10"\/>/g, '<property name="maximumPoolSize" value="10"/>\n        <property name="connectionTimeout" value="5000"/>\n        <property name="maxLifetime" value="1200000"/>'));
  edit("src/main/webapp/WEB-INF/web.xml", (t) => t.replace(/<session-timeout>60<\/session-timeout>/, "<session-timeout>30</session-timeout>"));
  const after = await m.checkOperations({ projectDir: p });
  info(`portal-site 제안 적용 뒤: ${after.grade.grade} · 미달 ${failed(after)}`);
  assert(["A", "B"].includes(after.grade.grade) && !failed(after).includes("sql-logging-driver") && !failed(after).includes("debug-log-level") && !failed(after).includes("pool-timeouts-missing") && !failed(after).includes("upload-limits"), `제안 적용 뒤 등급 ${after.grade.grade}(내장 HSQL 은 테스트 기동을 위해 남겨 둠 — embedded-db·AutoInit 만 남음)`);
  const t0 = Date.now();
  const st = await m.verifyStartup({ projectDir: p, timeoutMs: 600_000 });
  info(`portal-site 기동: ${st.success ? "성공" : `실패 ${st.cause?.kind}: ${st.cause?.summary?.slice(0, 160)}`} · ${Math.round((Date.now() - t0) / 1000)}초`);
  assert(st.success && st.started, `제안을 적용한 사본이 내장 HSQL 로 여전히 기동${st.success ? "" : `\n${st.cause?.hint ?? ""}\n${st.logTail}`}`);

  // (3) 코퍼스
  const corpus = loadCorpus();
  const { dir } = materializeEntry(corpus, corpus.entries.find((x) => x.id === "cc-4.3.2"));
  const c = await m.checkOperations({ projectDir: dir });
  info(`cc-4.3.2: ${c.grade.grade} · ${JSON.stringify(c.summary)} · 미달 ${failed(c)}`);
  assert(c.rules.length === 17 && failed(c).includes("sql-logging-driver"), "코퍼스 4.3.2: 공통컴포넌트 globals 도 log4jdbc 기본");
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`operations-live FAIL (${n} assertions)`); else console.log(`operations-live OK (${n} assertions)`);
