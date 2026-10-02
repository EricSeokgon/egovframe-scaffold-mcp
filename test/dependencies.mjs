// node test/dependencies.mjs — 의존성 점검 (오프라인 픽스처 + 기준 카탈로그 정합)
import { checkDependencies, classifyDependency, renderDependencyMarkdown, loadDependencyBaseline, loadMigrationRules, versionBelow } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
function snapshot(root) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(`${path.relative(root, p).split(path.sep).join("/")}:${statSync(p).mtimeMs}:${createHash("sha256").update(readFileSync(p)).digest("hex")}`); } };
  walk(root);
  return out.sort().join("\n");
}

// ── 기준 카탈로그 정합 ────────────────────────────────
const b = loadDependencyBaseline();
const rules = loadMigrationRules();
assert(b.schemaVersion === 1 && /^\d{4}-\d{2}-\d{2}$/.test(b.surveyedAt) && b.repository === "https://maven.egovframe.go.kr/maven/", "baseline 스키마·출처");
assert(b.sources.length === 2 && b.sources.every((s) => /^[0-9a-f]{64}$/.test(s.sha256) && s.url.startsWith(b.repository) && s.managed > 0), "출처 parent 2종 + sha256 + url");
assert(b.sources.find((s) => s.kind === "boot")?.parent?.artifactId === "spring-boot-starter-parent", "boot parent 의 상위 spring-boot-starter-parent 기록");
assert(b.java === 17 && b.rte.version === rules.target.runtimeVersion && b.spring.framework && versionBelow(b.spring.framework, "6.0.0") === false, `Java 17 · RTE ${b.rte.version} · Spring ${b.spring.framework}`);
assert(b.managed.length >= 100 && b.managed.every((m) => m.groupId && m.artifactId && /^\d/.test(m.version) && m.sources.length > 0), `관리 좌표 ${b.managed.length}종 형식`);
const keys = b.managed.map((m) => `${m.groupId}:${m.artifactId}`);
assert(new Set(keys).size === keys.length, "관리 좌표 중복 없음");
for (const c of rules.coordinates) assert(b.managed.some((m) => m.groupId === c.to.groupId && m.artifactId === c.to.artifactId && m.version === rules.target.runtimeVersion), `RTE 5.x 모듈이 기준에 있고 ${rules.target.runtimeVersion}: ${c.to.artifactId}`);
for (const must of ["org.springframework:spring-test", "jakarta.servlet:jakarta.servlet-api", "org.apache.commons:commons-dbcp2", "org.apache.logging.log4j:log4j-core", "org.hibernate.validator:hibernate-validator"])
  assert(keys.includes(must), `기준 포함: ${must}`);
assert(!keys.some((k) => k.startsWith("javax.servlet") || k.startsWith("egovframework.rte:")), "기준에 javax.servlet·3.x 좌표 없음");
assert(b.families.length >= 4 && b.families.some((f) => f.groupIdPrefix === "org.springframework" && f.version === b.spring.framework) && b.families.some((f) => f.groupIdPrefix === "org.springframework.security") && b.families.some((f) => f.groupIdPrefix === "org.springframework.boot"), "계열 기준: spring·security·boot");

// ── classifyDependency (순수) ─────────────────────────
const ctxNone = { baseline: b, rules, parentKind: "none" };
const ctxWeb = { baseline: b, rules, parentKind: "web" };
const cls = (g, a, v, ctx = ctxNone) => classifyDependency({ groupId: g, artifactId: a, version: v, resolvedVersion: v && !/\$/.test(v) ? v : null }, ctx);
assert(cls("egovframework.rte", "egovframework.rte.fdl.cmmn", "3.10.0").status === "legacy", "3.x RTE 좌표 → legacy");
assert(cls("org.egovframe.rte", "org.egovframe.rte.fdl.cmmn", "4.3.0").status === "legacy", "4.x RTE 좌표 → legacy");
assert(cls("org.egovframe.rte", "egovframe-rte-fdl-cmmn", "5.0.1").status === "outdated" && cls("org.egovframe.rte", "egovframe-rte-fdl-cmmn", "5.0.2").status === "ok", "5.x RTE 5.0.1 → outdated, 5.0.2 → ok");
assert(cls("javax.servlet", "javax.servlet-api", "4.0.1").status === "legacy", "javax 좌표 → legacy");
assert(cls("commons-dbcp", "commons-dbcp", "1.4").status === "replace" && cls("log4j", "log4j", "1.2.17").status === "replace", "DBCP1·Log4j1 → replace");
assert(cls("org.springframework", "spring-webmvc", "5.3.39").status === "replace" && cls("org.springframework", "spring-webmvc", b.spring.framework).status === "ok", "Spring 5 → replace(6 미만), 기준 버전 → ok");
assert(cls("org.springframework", "spring-webmvc", "6.1.0").status === "outdated" && /계열 기준/.test(cls("org.springframework", "spring-webmvc", "6.1.0").note), "Spring 6.1 → 기준 미만(계열 기준)");
assert(cls("org.springframework.security", "spring-security-web", "6.0.0").status === "outdated" && cls("org.springframework.security", "spring-security-web", b.spring.security).status === "ok", "Spring Security 계열 기준");
assert(cls("org.springframework.boot", "spring-boot-starter-web", "3.2.0").status === "outdated", "Spring Boot 계열 기준");
assert(cls("org.springframework", "spring-webmvc", null, ctxWeb).status === "managed", "web parent + 버전 없음 → managed");
assert(cls("org.springframework", "spring-webmvc", null).status === "unversioned", "parent 없음 + 버전 없음 → unversioned");
assert(cls("com.example", "internal-lib", "1.0").status === "unknown", "기준 밖 좌표 → unknown");
assert(cls("org.springframework", "spring-webmvc", "${spring.version}").status === "unknown", "풀리지 않은 속성 → unknown");
assert(cls("egovframework.rte", "spring-modules-validation", "0.9").status === "replace", "spring-modules-validation → replace");

// ── 픽스처: 3.10 스타일 ───────────────────────────────
const legacy = mkdtempSync(path.join(tmpdir(), "egovdep310-"));
write(legacy, "pom.xml", `<project>
  <properties><spring.maven.artifact.version>4.3.25.RELEASE</spring.maven.artifact.version><egovframework.rte.version>3.10.0</egovframework.rte.version><java.version>1.8</java.version></properties>
  <repositories><repository><id>egovframe</id><url>http://maven.egovframe.go.kr/maven/</url></repository></repositories>
  <dependencies>
    <dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.ptl.mvc</artifactId><version>\${egovframework.rte.version}</version></dependency>
    <dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>3.1.0</version><scope>provided</scope></dependency>
    <dependency><groupId>commons-dbcp</groupId><artifactId>commons-dbcp</artifactId><version>1.4</version></dependency>
    <dependency><groupId>org.springframework</groupId><artifactId>spring-test</artifactId><version>\${spring.maven.artifact.version}</version><scope>test</scope></dependency>
    <dependency><groupId>org.mybatis</groupId><artifactId>mybatis</artifactId><version>3.5.6</version></dependency>
    <dependency><groupId>com.example</groupId><artifactId>internal</artifactId><version>1.0</version></dependency>
    <dependency><groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId></dependency>
  </dependencies>
</project>
`);
write(legacy, "src/main/webapp/WEB-INF/web.xml", `<web-app><filter><filter-name>HTMLTagFilter</filter-name><filter-class>egovframework.rte.ptl.mvc.filter.HTMLTagFilter</filter-class></filter></web-app>\n`);
write(legacy, "src/main/java/egovframework/com/cmm/Placeholder.java", "class Placeholder {}");
const before = snapshot(legacy);
const r = await checkDependencies({ projectDir: legacy });
assert(snapshot(legacy) === before, "점검 후 디스크 불변");
assert(r.buildSystem === "maven" && r.offline === true && r.parent.kind === "none" && r.java.value === "1.8" && r.java.status === "outdated", `maven · parent 없음 · Java 1.8 outdated (got ${r.java.value}/${r.java.status})`);
const byA = Object.fromEntries(r.findings.map((f) => [f.artifactId, f]));
assert(byA["egovframework.rte.ptl.mvc"].status === "legacy" && byA["egovframework.rte.ptl.mvc"].resolvedVersion === "3.10.0" && byA["egovframework.rte.ptl.mvc"].line === 5, "RTE 3.x legacy, 속성 해석 3.10.0, L5");
assert(byA["javax.servlet-api"].status === "legacy" && byA["javax.servlet-api"].scope === "provided", "javax legacy + scope");
assert(byA["commons-dbcp"].status === "replace" && byA["spring-test"].status === "replace" && byA["spring-test"].resolvedVersion === "4.3.25.RELEASE", "DBCP1·Spring 4 → replace");
assert(byA["mybatis"].status === "unknown", "mybatis 는 parent 가 관리하지 않음 → unknown(RTE 가 전이 관리)");
assert(byA["internal"].status === "unknown" && byA["commons-lang3"].status === "unversioned", "기준 밖 unknown · 버전 없음 unversioned");
assert(r.summary.legacy === 2 && r.summary.replace === 2 && r.summary.unknown === 2 && r.summary.unversioned === 1, `요약 ${JSON.stringify(r.summary)}`);
const chk = Object.fromEntries(r.checks.map((c) => [c.id, c]));
assert(chk["https-repositories"].status === "missing" && chk["https-repositories"].evidence[0].file === "pom.xml" && chk["https-repositories"].evidence[0].line === 3, "http 저장소 → missing + 근거 L3");
assert(chk["xss-filter"].status === "ok" && chk["xss-filter"].evidence[0].file.endsWith("web.xml"), "HTMLTagFilter → xss ok + 근거");
assert(chk["csrf"].status === "missing" && chk["security-headers"].status === "missing" && chk["sec-security-component"].status === "missing", "CSRF·헤더·sec.security → missing");
assert(r.vulnerabilities === undefined, "오프라인이면 취약점 조회 없음");
const md = renderDependencyMarkdown(r);
assert(md.startsWith("# 의존성 점검") && md.includes("## 조치 필요") && md.includes("## 보안 설정 점검") && md.includes("egovframe-rte-ptl-mvc"), "Markdown 렌더링");

// OSV mock
const calls = [];
const r2 = await checkDependencies({ projectDir: legacy, offline: false, osvQuery: async (queries) => { calls.push(queries); return { results: queries.map((q) => (q.package.name === "commons-dbcp:commons-dbcp" ? { vulns: [{ id: "GHSA-test-0001" }, { id: "CVE-2024-0000" }] } : {})) }; } });
assert(calls.length === 1 && calls[0].every((q) => q.package.ecosystem === "Maven" && q.version) && calls[0].length === r2.findings.filter((f) => f.resolvedVersion).length, "OSV 질의: 버전 있는 의존성만, Maven 생태계");
assert(r2.vulnerabilities.length === 1 && r2.vulnerabilities[0].dependency === "commons-dbcp:commons-dbcp" && r2.vulnerabilities[0].ids.length === 2, "OSV 결과 매핑");
assert(renderDependencyMarkdown(r2).includes("GHSA-test-0001") && renderDependencyMarkdown(r2).includes("osv.dev/vulnerability"), "취약점 Markdown");
const r3 = await checkDependencies({ projectDir: legacy, offline: false, osvQuery: async () => { throw new Error("network down"); } });
assert(r3.osvError && /network down/.test(r3.osvError) && r3.findings.length === r.findings.length, "OSV 실패 시 오류만 기록하고 나머지 결과 유지");

// ── 픽스처: 5.x parent ────────────────────────────────
const modern = mkdtempSync(path.join(tmpdir(), "egovdep5-"));
write(modern, "pom.xml", `<project>
  <parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>${b.sources.find((s) => s.kind === "web").version}</version></parent>
  <repositories><repository><id>egovframe</id><url>https://maven.egovframe.go.kr/maven/</url></repository></repositories>
  <dependencies>
    <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-mvc</artifactId></dependency>
    <dependency><groupId>jakarta.servlet</groupId><artifactId>jakarta.servlet-api</artifactId><scope>provided</scope></dependency>
    <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-fdl-cmmn</artifactId><version>5.0.1</version></dependency>
  </dependencies>
</project>
`);
write(modern, "src/main/java/egovframework/example/config/EgovSecurityConfig.java", `package egovframework.example.config;
public class EgovSecurityConfig { void configure(Object http) { /* http.csrf(Customizer.withDefaults()); http.headers(h -> h.frameOptions(f -> f.sameOrigin())); */ } }
`);
write(modern, "src/main/java/egovframework/com/sec/security/Placeholder.java", "class Placeholder {}");
const r5 = await checkDependencies({ projectDir: modern });
assert(r5.parent.kind === "web" && r5.parent.status === "ok" && r5.java.value === "17" && r5.java.status === "ok", `5.x parent ok · Java 17(parent 관리) (got ${JSON.stringify(r5.parent)} ${JSON.stringify(r5.java)})`);
assert(r5.summary.managed === 2 && r5.summary.outdated === 1 && r5.findings.find((f) => f.artifactId === "egovframe-rte-fdl-cmmn").baseline === rules.target.runtimeVersion, "parent 관리 2 · 명시 5.0.1 → outdated(기준 5.0.2)");
const chk5 = Object.fromEntries(r5.checks.map((c) => [c.id, c]));
assert(chk5["sec-security-component"].status === "ok" && chk5["csrf"].status === "ok" && chk5["security-headers"].status === "ok" && chk5["https-repositories"].status === "ok" && chk5["xss-filter"].status === "missing", "5.x 픽스처 보안 점검(sec.security·csrf·headers·https ok, xss missing)");

// gradle
const gradle = mkdtempSync(path.join(tmpdir(), "egovdepgr-"));
write(gradle, "build.gradle", `plugins { id 'java' }\nsourceCompatibility = 17\nrepositories { maven { url 'http://maven.egovframe.go.kr/maven/' } }\ndependencies {\n  implementation 'org.egovframe.rte:egovframe-rte-fdl-cmmn:5.0.2'\n  implementation 'log4j:log4j:1.2.17'\n}\n`);
const rg = await checkDependencies({ projectDir: gradle });
assert(rg.buildSystem === "gradle" && rg.java.value === "17" && rg.findings.length === 2 && rg.findings.find((f) => f.artifactId === "log4j").status === "replace" && rg.findings.find((f) => f.artifactId === "egovframe-rte-fdl-cmmn").status === "ok", "gradle: 좌표 2건(ok·replace), Java 17");
assert(rg.checks.find((c) => c.id === "https-repositories").status === "missing", "gradle http 저장소 → missing");

// 빈 디렉터리
const empty = mkdtempSync(path.join(tmpdir(), "egovdepempty-"));
const re = await checkDependencies({ projectDir: empty });
assert(re.buildSystem === "unknown" && re.findings.length === 0 && re.notes.length > 0, "빌드 파일 없음 → 결과 비어 있음 + 안내");

for (const d of [legacy, modern, gradle, empty]) rmSync(d, { recursive: true, force: true });
if (process.exitCode) console.error(`dependencies FAIL (${n} assertions)`); else console.log(`dependencies OK (${n} assertions)`);
