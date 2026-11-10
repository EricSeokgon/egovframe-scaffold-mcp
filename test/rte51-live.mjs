// node test/rte51-live.mjs — 5.1.0 대응 2단계(v1.18) 실자산 검증 (CI 통합: 네트워크·Maven·JDK 17)
//   (1) 공식 boot-web·simple-backend 를 rteVersion="5.1.0" 으로 만들어 기동(verify_egovframe_startup) — simple-backend 테스트는 JUnit 6 MediaType 보정이 있어야 컴파일됨
//       공식 simple-backend(5.0.1)를 5.1.0 으로 갱신(applyUpdate) 뒤 기동
//   (2) boot-web 사본에 egovframe-boot-starter-security 만 추가 → 기동은 되지만 HTTP 401(Spring Boot 기본 보안) + 운영 점검 default-chain 높음 + 갱신 항목(boot-starter-autoconfig)
//       Globals.Auth=security + 보호자원 '/**'(PathPattern) + request-matcher-type 기본(regex) → 기동 실패(PatternSyntaxException) + matcher-type 높음
//       request-matcher-type=url → 기동·HTTP 200, 운영 점검 통과
//   (3) 공통컴포넌트 v5.0.7 의 AuthenticInterceptor 는 AntPathRequestMatcher(변수 패턴) → manual 1, upstream main(10-27 #1396 반영)은 0
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-rte51-live-"));
const show = (r) => `${r.success ? "기동" : "실패"} · ${Math.round(r.durationMs / 1000)}초${r.http ? ` · HTTP ${r.http.status}` : ""}${r.cause ? ` · ${r.cause.kind}: ${r.cause.summary.slice(0, 200)}` : ""}`;
const edit = (dir, rel, f) => { const p = path.join(dir, rel); writeFileSync(p, f(readFileSync(p, "utf8"))); };
const SEC = (r) => r.rules.filter((x) => x.rule.startsWith("egov-security")).map((x) => `${x.rule.replace("egov-security-", "")}:${x.status}`).join(" ");

try {
  // (1) 5.1.0 으로 생성·기동
  const dirs = {};
  for (const t of ["boot-web", "simple-backend"]) {
    const c = await m.createProject({ template: t, projectName: `r51-${t}`, groupId: "egovframework.example", outputDir: root, database: "hsql", rteVersion: "5.1.0" });
    dirs[t] = c.projectPath;
    const pom = readFileSync(path.join(c.projectPath, "pom.xml"), "utf8");
    assert(/<artifactId>egovframe-boot-starter-parent<\/artifactId>\s*<version>5\.1\.0<\/version>/.test(pom) && c.customized.some((x) => x.includes("태그·공식 공지 전")) && (t !== "simple-backend" || c.customized.some((x) => x.includes("MediaType 단일 import"))), `${t}: parent 5.1.0 으로 생성, 태그 전 버전 안내${t === "simple-backend" ? ", JUnit 6 MediaType 보정" : ""}`);
    const r = await m.verifyStartup({ projectDir: c.projectPath, timeoutMs: 600_000 });
    info(`${t} 5.1.0: ${show(r)}`);
    assert(r.success && r.started, `${t}: 5.1.0 parent 로 기동${r.success ? "" : `\n${r.cause?.hint ?? ""}`}`);
  }

  // (1-b) 공식 simple-backend(5.0.1)를 5.1.0 으로 갱신 — JUnit 6 MediaType 모호성은 auto, 적용 뒤 기동
  {
    const c = await m.createProject({ template: "simple-backend", projectName: "r51-sb-upgrade", groupId: "egovframework.example", outputDir: root, database: "hsql" });
    const plan = m.updateProject({ projectDir: c.projectPath, target: "5.1.0" });
    const lib = plan.items.filter((i) => i.kind === "library-change");
    assert(lib.length === 1 && lib[0].action === "auto" && /EgovLoginApiControllerTest/.test(lib[0].file) && plan.notes.some((x) => x.includes("JUnit Jupiter")), `simple-backend 5.0.1 → 5.1.0 진단: JUnit 6 MediaType auto 1 (${lib.map((i) => `${i.file.split("/").pop()}:${i.line}`).join()})`);
    const a = await m.applyUpdate({ projectDir: c.projectPath, target: "5.1.0", dryRun: false });
    const r = await m.verifyStartup({ projectDir: c.projectPath, timeoutMs: 600_000 });
    info(`simple-backend 갱신 뒤: ${show(r)}`);
    assert(a.applied.items >= 2 && r.success, `갱신 적용(parent·MediaType ${a.applied.items}) 뒤 기동${r.success ? "" : `\n${r.cause?.hint ?? ""}`}`);
  }

  // (2) 보안 스타터
  const d = dirs["boot-web"];
  edit(d, "pom.xml", (s) => s.replace("<dependencies>", "<dependencies>\n\t\t<dependency>\n\t\t\t<groupId>org.egovframe.boot</groupId>\n\t\t\t<artifactId>egovframe-boot-starter-security</artifactId>\n\t\t</dependency>"));
  const o1 = await m.checkOperations({ projectDir: d });
  const s1 = await m.verifyStartup({ projectDir: d, timeoutMs: 600_000 });
  info(`스타터 + Globals.Auth 없음: ${show(s1)} · ${SEC(o1)}`);
  assert(s1.success && s1.http?.status === 401 && o1.rules.find((x) => x.rule === "egov-security-default-chain").status === "fail", `스타터만 추가 → 기동은 되지만 HTTP 401, 운영 점검 default-chain 높음 (HTTP ${s1.http?.status})`);
  // Globals.Auth=security + PathPattern 보호자원 + regex(기본)
  edit(d, "src/main/resources/application.properties", (s) => `${s.replace(/\s*$/, "")}\nGlobals.Auth=security\n`);
  edit(d, "src/main/resources/db/sampledb.sql", (s) => s.replace("SET SCHEMA PUBLIC", [
    "CREATE MEMORY TABLE USERS(USER_ID VARCHAR(50) NOT NULL PRIMARY KEY,PASSWORD VARCHAR(255) NOT NULL,ENABLED INTEGER DEFAULT 1,USER_NAME VARCHAR(100),BIRTH_DAY VARCHAR(8),SSN VARCHAR(13))",
    "CREATE MEMORY TABLE AUTHORITIES(USER_ID VARCHAR(50) NOT NULL,AUTHORITY VARCHAR(50) NOT NULL,PRIMARY KEY(USER_ID,AUTHORITY))",
    "CREATE MEMORY TABLE SECURED_RESOURCES(RESOURCE_ID VARCHAR(50) NOT NULL PRIMARY KEY,RESOURCE_PATTERN VARCHAR(500) NOT NULL,RESOURCE_TYPE VARCHAR(20) NOT NULL,SORT_ORDER INTEGER DEFAULT 0)",
    "CREATE MEMORY TABLE SECURED_RESOURCES_ROLE(RESOURCE_ID VARCHAR(50) NOT NULL,AUTHORITY VARCHAR(50) NOT NULL,PRIMARY KEY(RESOURCE_ID,AUTHORITY))",
    "INSERT INTO SECURED_RESOURCES VALUES('web-000001','/**','url',1)",
    "INSERT INTO SECURED_RESOURCES_ROLE VALUES('web-000001','IS_AUTHENTICATED_ANONYMOUSLY')",
    "SET SCHEMA PUBLIC",
  ].join("\n")));
  const o2 = await m.checkOperations({ projectDir: d });
  const s2 = await m.verifyStartup({ projectDir: d, timeoutMs: 600_000 });
  info(`Globals.Auth=security + '/**' + regex: ${show(s2)} · ${SEC(o2)}`);
  assert(!s2.success && /PatternSyntax|Dangling meta character/.test(JSON.stringify(s2.cause ?? {}) + (s2.logTail ?? "")) && o2.rules.find((x) => x.rule === "egov-security-matcher-type").status === "fail" && o2.rules.find((x) => x.rule === "egov-security-default-chain").status === "pass", `regex(기본) + PathPattern 보호자원 → 기동 실패(정규식 오류), 운영 점검 matcher-type 높음 (${s2.cause?.kind})`);
  edit(d, "src/main/resources/application.properties", (s) => `${s}org.egovframe.security.request-matcher-type=url\n`);
  const o3 = await m.checkOperations({ projectDir: d });
  const s3 = await m.verifyStartup({ projectDir: d, timeoutMs: 600_000 });
  info(`request-matcher-type=url: ${show(s3)} · ${SEC(o3)}`);
  assert(s3.success && s3.http?.status === 200 && o3.rules.filter((x) => x.rule.startsWith("egov-security")).every((x) => x.status === "pass"), `url 로 바꾸면 기동·HTTP 200, 운영 점검 통과 (HTTP ${s3.http?.status})`);

  // (3) 공통컴포넌트 AuthenticInterceptor: v5.0.7 → manual 1, main → 0
  const REL = "src/main/java/egovframework/com/cmm/interceptor/AuthenticInterceptor.java";
  const cc = path.join(root, "cc");
  execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", "https://github.com/eGovFramework/egovframe-common-components.git", cc], { stdio: "inherit", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const at = (ref) => execFileSync("git", ["show", `${ref}:${REL}`], { cwd: cc, encoding: "utf8" });
  const i507 = m.planRequestMatcherItems(REL, at("v5.0.7"));
  const iMain = m.planRequestMatcherItems(REL, at("origin/main"));
  info(`AuthenticInterceptor: v5.0.7 ${i507.map((i) => `${i.action}:${i.line}`).join(",")} / main ${iMain.length}`);
  assert(i507.length >= 1 && i507.every((i) => i.action === "manual") && iMain.length === 0, `공통컴포넌트 v5.0.7 AuthenticInterceptor → manual(변수 패턴), main(#1396 반영) → 0`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`rte51-live FAIL (${n} assertions)`); else console.log(`rte51-live OK (${n} assertions)`);
