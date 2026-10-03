// node test/dependencies.mjs — 의존성 점검 (오프라인 픽스처 + 기준 카탈로그 정합)
import { OUTPUT_SCHEMAS, checkDependencies, classifyDependency, renderDependencyMarkdown, loadDependencyBaseline, loadMigrationRules, versionBelow, parseMavenCoord, parseMavenTree, parseGradleTree, dedupeArtifacts, treeCommand, resolveDependencyTree } from "../dist/index.js";
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
assert(b.schemaVersion === 2 && /^\d{4}-\d{2}-\d{2}$/.test(b.surveyedAt) && b.repository === "https://maven.egovframe.go.kr/maven/", "baseline 스키마 2·출처");
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
assert(b.families.every((f) => typeof f.matchSubgroups === "boolean") && b.families.find((f) => f.groupIdPrefix === "com.fasterxml.jackson")?.matchSubgroups === true && b.families.find((f) => f.groupIdPrefix === "org.springframework")?.matchSubgroups === false, "계열의 하위 groupId 적용 여부: jackson 만 true");
assert(!b.families.some((f) => /^\d{4}\./.test(f.version)) && Array.isArray(b.releaseTrains) && b.releaseTrains.every((t) => /^\d{4}\./.test(t.version)), `달력형 릴리스 트레인은 계열이 아님 (${b.releaseTrains.map((t) => `${t.artifactId}:${t.version}`).join(", ")})`);

// ── v0.34: Spring Boot BOM 전체 · RTE 전이 ─────────────────
const bootKeys = Object.keys(b.boot.managed);
assert(b.boot.bom.artifactId === "spring-boot-dependencies" && b.boot.bom.version === b.spring.boot && /^[0-9a-f]{64}$/.test(b.boot.bom.sha256) && b.boot.bom.url.startsWith("https://repo1.maven.org/maven2/"), "Boot BOM 출처: spring-boot-dependencies(Maven Central, sha256)");
assert(b.boot.imports.length >= 30 && b.boot.imports.every((i) => /^[0-9a-f]{64}$/.test(i.sha256) && i.members > 0 && !i.unresolved) && b.boot.bom.imports === b.boot.imports.length, `BOM import ${b.boot.imports.length}종 전부 풀림(sha256 고정)`);
assert(bootKeys.length >= 1000 && bootKeys.every((k) => /^[\w.\-]+:[\w.\-]+$/.test(k) && /^\d/.test(b.boot.managed[k])), `Boot BOM 좌표 ${bootKeys.length}종 형식`);
for (const must of ["com.h2database:h2", "org.springframework.data:spring-data-jpa", "io.projectreactor:reactor-core", "io.micrometer:micrometer-tracing", "com.oracle.database.jdbc:ojdbc11", "com.mysql:mysql-connector-j"]) assert(bootKeys.includes(must), `Boot BOM 포함: ${must}`);
assert(b.boot.managed["io.projectreactor:reactor-core"] !== b.boot.managed["io.projectreactor.netty:reactor-netty-core"] && b.boot.managed["io.micrometer:micrometer-core"] !== b.boot.managed["io.micrometer:micrometer-tracing"], "릴리스 트레인·동일 groupId 다른 버전이 artifact 단위로 풀림(reactor·micrometer)");
assert(!bootKeys.some((k) => k.startsWith("javax.servlet:")), "Boot BOM 에 javax.servlet 없음");
const rteKeys = Object.keys(b.rteTransitive.managed);
assert(b.rteTransitive.version === rules.target.runtimeVersion && b.rteTransitive.modules.length === rules.coordinates.length && b.rteTransitive.modules.every((m) => /^[0-9a-f]{64}$/.test(m.sha256) && m.url.startsWith(b.repository)) && /^[0-9a-f]{64}$/.test(b.rteTransitive.root.sha256), `RTE 전이: 모듈 ${b.rteTransitive.modules.length}종 pom sha256 고정`);
assert(rteKeys.length >= 40 && rteKeys.every((k) => { const v = b.rteTransitive.managed[k]; return /^\d/.test(v.version) && ["compile", "runtime", "provided"].includes(v.scope) && v.via.length > 0; }), `RTE 전이 좌표 ${rteKeys.length}종 형식(test 제외)`);
assert(b.rteTransitive.managed["org.mybatis:mybatis"]?.via.includes("psl-dataaccess") && b.rteTransitive.managed["org.apache.poi:poi"]?.via.includes("fdl-excel") && !rteKeys.some((k) => k.startsWith("org.egovframe.rte:")), "RTE 전이: mybatis(psl-dataaccess)·poi(fdl-excel), RTE 자체 좌표 제외");
assert(statSync(new URL("../catalog/dependency-baseline.json", import.meta.url)).size <= 200 * 1024, "기준 파일 200KB 이하");

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
assert(cls("com.example", "internal-lib", "1.0").status === "unknown" && cls("com.example", "internal-lib", "1.0").basis === null, "기준 밖 좌표 → unknown(basis null)");
// v0.34: 출처 표시·Boot BOM·RTE 전이·vendor
const ctxBoot = { baseline: b, rules, parentKind: "boot" };
assert(cls("org.egovframe.rte", "egovframe-rte-fdl-cmmn", "5.0.2").basis === "parent" && cls("org.springframework", "spring-webmvc", b.spring.framework).basis === "family" && cls("egovframework.rte", "egovframework.rte.fdl.cmmn", "3.10.0").basis === "migration-rules", "basis: parent 직접·계열·전환 규칙");
assert(cls("com.h2database", "h2", "1.4.180").status === "outdated" && cls("com.h2database", "h2", "1.4.180").basis === "boot-bom" && cls("com.h2database", "h2", b.boot.managed["com.h2database:h2"]).status === "ok", "Boot BOM 기준: h2 1.4 → outdated, 기준 버전 → ok");
const my = cls("org.mybatis", "mybatis", "3.1.1");
assert(my.status === "outdated" && my.basis === "rte-transitive" && /psl-dataaccess/.test(my.note) && /충돌/.test(my.note) && cls("org.mybatis", "mybatis", b.rteTransitive.managed["org.mybatis:mybatis"].version).status === "ok", "RTE 전이 기준: mybatis 3.1 → outdated(충돌 안내), 전이 버전 → ok");
assert(cls("org.hibernate.orm", "hibernate-core", "6.6.12.Final", ctxNone).basis === "rte-transitive" && cls("org.hibernate.orm", "hibernate-core", "6.6.12.Final", ctxBoot).basis === "boot-bom", "Boot parent 는 Boot BOM 우선, 그 밖은 RTE 전이 우선(hibernate-core)");
assert(cls("com.h2database", "h2", null, ctxBoot).status === "managed" && cls("com.h2database", "h2", null, ctxBoot).baseline === b.boot.managed["com.h2database:h2"] && cls("com.h2database", "h2", null, ctxBoot).basis === "boot-bom", "Boot parent + 버전 없음 → managed 에 Boot BOM 기준 버전");
assert(cls("org.springframework.social", "spring-social-facebook", "2.0.3.RELEASE").status === "replace", "org.springframework.social 은 계열(org.springframework)이 아니라 교체 규칙");
assert(cls("org.springframework.ldap", "spring-ldap-core", "2.4.4").basis === "parent" && cls("com.fasterxml.jackson.dataformat", "jackson-dataformat-yaml", "2.18.2").basis === "family", "하위 groupId: spring.ldap 는 parent 직접, jackson.dataformat 은 jackson 계열");
const vend = cls("com.tmax.tibero", "tibero-jdbc", "5.0");
assert(vend.status === "vendor" && vend.basis === null && /Tibero/.test(vend.note) && cls("kr.go.gpki", "gpkisecureweb", "1.0.4.9").status === "vendor" && cls("kr.go.other", "x", "1").status === "vendor", "국내 벤더·기관 배포 좌표 → vendor + 사유(접두 kr.go 포함)");
for (const [g, a] of [["mysql", "mysql-connector-java"], ["ojdbc", "ojdbc"], ["org.codehaus.jackson", "jackson-mapper-asl"], ["xmlbeans", "xbean"], ["net.sf.ehcache", "ehcache-core"], ["org.apache.httpcomponents", "httpclient"], ["org.antlr", "antlr"]]) assert(cls(g, a, "1.0").status === "replace" && cls(g, a, "1.0").basis === "migration-rules", `EOL·이전 좌표 교체 규칙: ${g}:${a}`);
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
assert(byA["mybatis"].status === "outdated" && byA["mybatis"].basis === "rte-transitive" && byA["mybatis"].baseline === b.rteTransitive.managed["org.mybatis:mybatis"].version, "mybatis 3.5.6 은 RTE 전이 버전 미만 → outdated(v0.33 까지는 unknown)");
assert(byA["internal"].status === "unknown" && byA["commons-lang3"].status === "unversioned" && byA["commons-lang3"].basis === "parent", "기준 밖 unknown · 버전 없음 unversioned(기준은 parent)");
assert(r.summary.legacy === 2 && r.summary.replace === 2 && r.summary.unknown === 1 && r.summary.unversioned === 1 && r.summary.outdated === 1 && r.summary.vendor === 0, `요약 ${JSON.stringify(r.summary)}`);
const chk = Object.fromEntries(r.checks.map((c) => [c.id, c]));
assert(chk["https-repositories"].status === "missing" && chk["https-repositories"].evidence[0].file === "pom.xml" && chk["https-repositories"].evidence[0].line === 3, "http 저장소 → missing + 근거 L3");
assert(chk["xss-filter"].status === "ok" && chk["xss-filter"].evidence[0].file.endsWith("web.xml"), "HTMLTagFilter → xss ok + 근거");
assert(chk["csrf"].status === "missing" && chk["security-headers"].status === "missing" && chk["sec-security-component"].status === "missing", "CSRF·헤더·sec.security → missing");
assert(r.vulnerabilities === undefined, "오프라인이면 취약점 조회 없음");
const md = renderDependencyMarkdown(r);
assert(md.startsWith("# 의존성 점검") && md.includes("## 조치 필요") && md.includes("## 보안 설정 점검") && md.includes("egovframe-rte-ptl-mvc"), "Markdown 렌더링");
assert(md.includes("- 기준 출처: ") && md.includes("| 출처 |") && md.includes("| RTE 전이 |") && md.includes("Boot BOM ") && md.includes("RTE 전이 ") , "Markdown 에 기준 출처 열·요약");

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

// ── 픽스처: 5.x Boot parent — 공식 egovframe-boot-web 템플릿 pom 과 같은 꼴(버전 없는 starter + 명시 버전 몇 개) → unknown 0 (v0.34 검증 기준)
const bootProj = mkdtempSync(path.join(tmpdir(), "egovdepboot-"));
write(bootProj, "pom.xml", `<project>
  <parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>${b.sources.find((s) => s.kind === "boot").version}</version></parent>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-thymeleaf</artifactId></dependency>
    <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-mvc</artifactId></dependency>
    <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-psl-dataaccess</artifactId></dependency>
    <dependency><groupId>org.apache.commons</groupId><artifactId>commons-dbcp2</artifactId><version>2.13.0</version></dependency>
    <dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId><scope>runtime</scope></dependency>
    <dependency><groupId>org.projectlombok</groupId><artifactId>lombok</artifactId><optional>true</optional></dependency>
    <dependency><groupId>jakarta.servlet</groupId><artifactId>jakarta.servlet-api</artifactId><scope>provided</scope></dependency>
    <dependency><groupId>org.apache.tomcat.embed</groupId><artifactId>tomcat-embed-jasper</artifactId><scope>provided</scope></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
    <dependency><groupId>jakarta.xml.bind</groupId><artifactId>jakarta.xml.bind-api</artifactId><version>4.0.2</version></dependency>
  </dependencies>
</project>
`);
const rb = await checkDependencies({ projectDir: bootProj });
assert(rb.parent.kind === "boot" && rb.parent.status === "ok" && rb.summary.unknown === 0 && rb.summary.vendor === 0, `Boot 템플릿형 pom: unknown 0 (요약 ${JSON.stringify(rb.summary)})`);
const rbA = Object.fromEntries(rb.findings.map((f) => [f.artifactId, f]));
assert(rbA["h2"].status === "managed" && rbA["h2"].basis === "boot-bom" && rbA["h2"].baseline === b.boot.managed["com.h2database:h2"] && rbA["spring-boot-starter-web"].status === "managed" && rbA["spring-boot-starter-web"].basis === "family" && rbA["egovframe-rte-ptl-mvc"].basis === "parent" && rbA["tomcat-embed-jasper"].basis === "boot-bom", "버전 없는 h2·tomcat-embed-jasper → Boot BOM 기준 버전 표시, starter-web 는 Boot 계열, RTE 는 parent 직접");
assert(rbA["commons-dbcp2"].status === "ok" && rbA["commons-dbcp2"].basis === "parent" && rbA["jakarta.xml.bind-api"].status === "ok" && rbA["jakarta.xml.bind-api"].basis === "boot-bom", "명시 버전은 parent·Boot BOM 기준과 대조");

// gradle
const gradle = mkdtempSync(path.join(tmpdir(), "egovdepgr-"));
write(gradle, "build.gradle", `plugins { id 'java' }\nsourceCompatibility = 17\nrepositories { maven { url 'http://maven.egovframe.go.kr/maven/' } }\ndependencies {\n  implementation 'org.egovframe.rte:egovframe-rte-fdl-cmmn:5.0.2'\n  implementation 'log4j:log4j:1.2.17'\n}\n`);
const rg = await checkDependencies({ projectDir: gradle });
assert(rg.buildSystem === "gradle" && rg.java.value === "17" && rg.findings.length === 2 && rg.findings.find((f) => f.artifactId === "log4j").status === "replace" && rg.findings.find((f) => f.artifactId === "egovframe-rte-fdl-cmmn").status === "ok", "gradle: 좌표 2건(ok·replace), Java 17");
assert(rg.checks.find((c) => c.id === "https-repositories").status === "missing", "gradle http 저장소 → missing");

// ── v0.36: 해석된 의존성 트리 ─────────────────────────
const mavenTreeText = readFileSync(new URL("./fixtures/maven-tree-egovframe-web.txt", import.meta.url), "utf8");
const gradleTreeText = readFileSync(new URL("./fixtures/gradle-tree-sample.txt", import.meta.url), "utf8");
assert(JSON.stringify(parseMavenCoord("org.egovframe.rte:egovframe-rte-ptl-mvc:jar:5.0.0:compile")) === JSON.stringify({ groupId: "org.egovframe.rte", artifactId: "egovframe-rte-ptl-mvc", type: "jar", version: "5.0.0", scope: "compile" }) && parseMavenCoord("g:a:jar:cls:1.0:test").classifier === "cls" && parseMavenCoord("g:a:jar:1.0").scope === null && parseMavenCoord("g:a") === null, "parseMavenCoord: 4·5·6 토큰");
const mt = parseMavenTree(mavenTreeText);
assert(mt.roots.length === 1 && mt.roots[0].artifactId === "example" && mt.nodes.length === 65, `Maven 트리: 루트 1·노드 ${mt.nodes.length}`);
const ptl = mt.nodes.find((n) => n.artifactId === "egovframe-rte-ptl-mvc"), ctxs = mt.nodes.find((n) => n.artifactId === "spring-context-support");
assert(ptl.depth === 1 && ptl.via.length === 0 && ptl.scope === "compile" && ctxs.depth === 3 && ctxs.via.join(">") === "egovframe-rte-ptl-mvc>egovframe-rte-fdl-cmmn", "Maven 트리: 깊이·경로·scope");
assert(mt.nodes.some((n) => n.depth >= 4 && n.via.length === n.depth - 1), "Maven 트리: 깊은 노드의 경로 길이 = 깊이-1");
const mtInfo = parseMavenTree(mavenTreeText.split("\n").map((l) => `[INFO] ${l}`).join("\n"));
assert(mtInfo.nodes.length === 65 && mtInfo.roots.length === 1, "Maven 트리: [INFO] 접두(stdout 형태)도 동일");
const gt = parseGradleTree(gradleTreeText);
assert(gt.configuration === "runtimeClasspath" && gt.roots[0].artifactId === "egov-gradle-sample" && gt.nodes.length === 92 && dedupeArtifacts(gt.nodes).length === 46, `Gradle 트리: configuration·루트·노드 ${gt.nodes.length}·중복 제거 ${dedupeArtifacts(gt.nodes).length}`);
const lang3 = gt.nodes.find((n) => n.artifactId === "commons-lang3" && n.requestedVersion);
assert(lang3 && lang3.version === "3.18.0" && lang3.requestedVersion === "3.17.0" && lang3.scope === "runtimeClasspath" && lang3.via.join(">") === "egovframe-rte-ptl-mvc>egovframe-rte-fdl-filehandling>commons-vfs2", "Gradle 트리: `a:b:1.0 -> 1.2` 는 해석 버전 1.2 + 요청 버전 기록");
assert(!gt.nodes.some((n) => /\(\*\)|\(c\)|\(n\)/.test(n.version)) && gt.nodes.every((n) => n.depth >= 1 && n.via.length === n.depth - 1), "Gradle 트리: 표식 제거·깊이와 경로 일치");
const gtMulti = parseGradleTree("Root project 'r'\n\nruntimeClasspath - x\n+--- project :core\n|    \\--- g:a:1.0\n+--- g:b:2.0 (c)\n\\--- g:c -> 3.0\n");
assert(gtMulti.nodes.length === 2 && gtMulti.nodes[0].artifactId === "a" && gtMulti.nodes[0].via.length === 0 && gtMulti.nodes[1].artifactId === "c" && gtMulti.nodes[1].version === "3.0", "Gradle 트리: project 노드 제외(경로에서도 제외), (c) 제약 제외, 버전 없이 -> 해석");
const dd = dedupeArtifacts([{ groupId: "g", artifactId: "a", version: "1", depth: 3, via: ["x", "y"] }, { groupId: "g", artifactId: "a", version: "1", depth: 1, via: [] }]);
assert(dd.length === 1 && dd[0].depth === 1, "dedupeArtifacts: 가장 얕은 경로 유지");
const tcM = treeCommand(legacy, "maven", "runtime", "/tmp/out.txt", "linux"), tcA = treeCommand(legacy, "maven", "all", "/tmp/out.txt", "linux"), tcG = treeCommand(legacy, "gradle", "runtime", "", "win32");
assert(tcM.command === "mvn" && tcM.args.includes("org.apache.maven.plugins:maven-dependency-plugin:3.8.1:tree") && tcM.args.includes("-Dscope=runtime") && tcM.args.includes("-DappendOutput=true") && !tcA.args.includes("-Dscope=runtime") && tcG.command === "gradle.bat" && tcG.args.join(" ") === "dependencies --configuration runtimeClasspath -q --console=plain", "treeCommand: Maven 좌표 완전 표기·scope, Gradle configuration·Windows 래퍼");
// 가짜 runner: Maven 은 outputFile 에 트리를 쓰고, Gradle 은 stdout 으로 낸다
const fakeMaven = async (cmd, o) => { const out = cmd.args.find((a) => a.startsWith("-DoutputFile=")).slice("-DoutputFile=".length); writeFileSync(out, mavenTreeText); o.onData("[INFO] BUILD SUCCESS\n"); return { exitCode: 0, timedOut: false }; };
const treeProj = mkdtempSync(path.join(tmpdir(), "egovdeptree-"));
write(treeProj, "pom.xml", `<project>
  <parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.0</version></parent>
  <dependencies>
    <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-mvc</artifactId></dependency>
    <dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId><version>6.2.10</version></dependency>
    <dependency><groupId>com.example</groupId><artifactId>not-in-tree</artifactId><version>1.0</version></dependency>
  </dependencies>
</project>
`);
const tr = await resolveDependencyTree({ projectDir: treeProj, runner: fakeMaven, platform: "linux" });
assert(tr.ran && tr.success && tr.buildTool === "maven" && tr.artifacts.length === 65 && tr.roots[0].artifactId === "example" && tr.nodes === 65, "resolveDependencyTree(가짜 Maven): 성공·65 artifact");
const rr = await checkDependencies({ projectDir: treeProj, resolve: true, runner: fakeMaven, platform: "linux" });
assert(rr.resolution && rr.resolution.success && rr.resolution.artifacts === 65 && rr.resolution.direct === 14 && rr.resolution.transitive === 63 && rr.resolution.scope === "runtime", `resolve=true: 해석 65·직접 14·선언에 없던 전이 63 (got ${JSON.stringify(rr.resolution && { a: rr.resolution.artifacts, d: rr.resolution.direct, t: rr.resolution.transitive })})`);
const declaredF = rr.findings.filter((f) => f.origin === "declared"), transF = rr.findings.filter((f) => f.origin === "transitive");
assert(declaredF.length === 3 && transF.length === 63 && rr.findings.length === 66 && rr.findings.slice(0, 3).every((f) => f.origin === "declared"), "findings: 선언 3 + 전이 63, 선언이 앞");
const webmvc = declaredF.find((f) => f.artifactId === "spring-webmvc"), ptlF = declaredF.find((f) => f.artifactId === "egovframe-rte-ptl-mvc");
assert(webmvc.treeVersion === "6.2.11" && rr.resolution.differs.length === 1 && rr.resolution.differs[0].artifactId === "spring-webmvc" && rr.resolution.differs[0].declared === "6.2.10" && rr.resolution.differs[0].resolved === "6.2.11", "선언 6.2.10 ↔ 해석 6.2.11 → differs + treeVersion");
assert(ptlF.status === "managed" && ptlF.treeVersion === "5.0.0" && /parent 가 정한 해석 버전 5.0.0/.test(ptlF.note) && ptlF.depth === 1, "parent 관리 좌표가 기준 미만 버전으로 해석되면 비고에 안내");
const classmate = transF.find((f) => f.artifactId === "classmate");
assert(classmate && classmate.file === "pom.xml" && classmate.line === 0 && classmate.via.join(">") === "hibernate-validator" && classmate.depth === 2 && classmate.status === "outdated" && classmate.basis === "boot-bom" && classmate.resolvedVersion === "1.5.1", "전이 항목: 경로·깊이·판정(classmate 1.5.1 < Boot BOM 1.7.0)");
assert(rr.summary.unknown === 1 + rr.resolution.summary.unknown && rr.resolution.summary.ok >= 40, `요약: 선언 unknown(not-in-tree) + 해석 unknown (${rr.resolution.summary.unknown})`);
assert(Object.keys(rr).every((k) => k in OUTPUT_SCHEMAS.check_egovframe_dependencies.shape) && OUTPUT_SCHEMAS.check_egovframe_dependencies.safeParse(rr).success, "resolve 결과의 최상위 키 전부 outputSchema 에 선언(SDK 는 additionalProperties 거부)");
const rmd = renderDependencyMarkdown(rr);
assert(rmd.includes("- 해석된 트리(runtime") && rmd.includes("선언과 다르게 해석된 좌표 1건") && rmd.includes("| (전이) hibernate-validator |"), "Markdown: 해석 요약·차이·전이 경로 열");
const rrOsv = await checkDependencies({ projectDir: treeProj, resolve: true, runner: fakeMaven, platform: "linux", offline: false, osvQuery: async (q) => ({ results: q.map((x) => (x.package.name === "com.fasterxml:classmate" ? { vulns: [{ id: "GHSA-fake-1" }] } : {})) }) });
assert(rrOsv.vulnerabilities.length === 1 && rrOsv.vulnerabilities[0].dependency === "com.fasterxml:classmate", "OSV 조회가 전이 의존성까지 포함");
const failRunner = async (_cmd, o) => { o.onData("[ERROR] boom\n"); return { exitCode: 1, timedOut: false }; };
const rf = await checkDependencies({ projectDir: treeProj, resolve: true, runner: failRunner, platform: "linux" });
assert(rf.resolution && rf.resolution.ran && !rf.resolution.success && /종료 코드 1/.test(rf.resolution.error) && rf.findings.length === 3 && rf.notes.some((n) => /해석 실패/.test(n)), "해석 실패 → 선언만 판정 + 안내");
const rTimeout = await checkDependencies({ projectDir: treeProj, resolve: true, runner: async () => ({ exitCode: null, timedOut: true }), platform: "linux", resolveTimeoutMs: 12_000 });
assert(!rTimeout.resolution.success && /시간 초과\(12000ms\)/.test(rTimeout.resolution.error), "해석 시간 초과 표기");
const rOff = await checkDependencies({ projectDir: treeProj, runner: failRunner });
assert(rOff.resolution === undefined && rOff.findings.every((f) => f.origin === "declared"), "resolve 기본 false 면 실행 없음·origin declared");
const gradleTreeProj = mkdtempSync(path.join(tmpdir(), "egovdeptreeg-"));
write(gradleTreeProj, "settings.gradle", "rootProject.name = 'egov-gradle-sample'\n");
write(gradleTreeProj, "build.gradle", "plugins { id 'java' }\ndependencies {\n  implementation 'org.egovframe.rte:egovframe-rte-ptl-mvc:5.0.2'\n  implementation 'com.h2database:h2:2.3.232'\n}\n");
const fakeGradle = async (cmd, o) => { o.onData(gradleTreeText); return { exitCode: 0, timedOut: false }; };
const rg2 = await checkDependencies({ projectDir: gradleTreeProj, resolve: true, resolveScope: "all", runner: fakeGradle, platform: "linux" });
assert(rg2.resolution.success && rg2.resolution.command.includes("--configuration testRuntimeClasspath") && rg2.resolution.artifacts === 46 && rg2.findings.filter((f) => f.origin === "transitive").every((f) => f.file === "build.gradle" && f.scope === "runtimeClasspath"), `Gradle resolve: all → testRuntimeClasspath, 46 artifact, 전이는 build.gradle 기준`);
rmSync(treeProj, { recursive: true, force: true }); rmSync(gradleTreeProj, { recursive: true, force: true });

// 빈 디렉터리
const empty = mkdtempSync(path.join(tmpdir(), "egovdepempty-"));
const re = await checkDependencies({ projectDir: empty });
assert(re.buildSystem === "unknown" && re.findings.length === 0 && re.notes.length > 0, "빌드 파일 없음 → 결과 비어 있음 + 안내");

for (const d of [legacy, modern, bootProj, gradle, empty]) rmSync(d, { recursive: true, force: true });
if (process.exitCode) console.error(`dependencies FAIL (${n} assertions)`); else console.log(`dependencies OK (${n} assertions)`);
