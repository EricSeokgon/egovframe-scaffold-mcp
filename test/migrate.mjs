// node test/migrate.mjs — 5.x 전환 진단 (오프라인 픽스처)
// 3.10 스타일 프로젝트(pom·java·xml·jsp·web.xml)에서 항목 분류(auto/manual)·라인·대응 좌표를 단언하고,
// 5.x 스타일 프로젝트에서는 항목 0건(거짓 양성 없음)을 단언한다. 진단 전후 디스크가 바뀌지 않는지도 확인한다.
import { migrateProject, renderMigrationMarkdown, classifyRteToken, classifyJavaxPackage, versionBelow, loadMigrationRules } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
function snapshot(root) {
  const out = new Map();
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.set(path.relative(root, p), `${statSync(p).mtimeMs}:${createHash("sha256").update(readFileSync(p)).digest("hex")}`); } };
  walk(root);
  return out;
}
const find = (r, pred) => r.items.filter(pred);
const one = (r, pred, label) => { const hits = find(r, pred); assert(hits.length === 1, `${label} (got ${hits.length})`); return hits[0]; };

// ── 순수 함수 ─────────────────────────────────────────
assert(versionBelow("3.10.0", "5.0.2") === true && versionBelow("5.0.2", "5.0.2") === false && versionBelow("5.1", "5.0.2") === false, "versionBelow 숫자 비교");
assert(versionBelow("4.3.25.RELEASE", "6.0.0") === true && versionBelow("${x}", "6") === null, "versionBelow 접미사·미해결 속성");

const rules = loadMigrationRules();
{
  const c = classifyRteToken("egovframework.rte.fdl.cmmn.EgovAbstractServiceImpl", rules);
  assert(c?.kind === "package" && c.action === "auto" && c.to === "org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl", "접두어 변경만 → package/auto");
  assert(classifyRteToken("org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl", rules) === null, "이미 5.x 클래스 → 변화 없음");
  const rm = classifyRteToken("egovframework.rte.psl.dataaccess.mapper.Mapper", rules);
  assert(rm?.kind === "class-removed" && rm.action === "manual" && rm.to === "org.egovframe.rte.psl.dataaccess.mapper.EgovMapper", "Mapper → EgovMapper (제거/manual)");
  const rm4 = classifyRteToken("org.egovframe.rte.fdl.cmmn.AbstractServiceImpl", rules);
  assert(rm4?.kind === "class-removed" && rm4.to === "org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl", "4.x 이름으로 참조한 제거 클래스도 판정");
  const rn = classifyRteToken("egovframework.rte.fdl.cryptography.EgovPasswordEncoder", rules);
  assert(rn?.kind === "package-renamed" && rn.action === "auto" && rn.to === "org.egovframe.rte.fdl.crypto.EgovPasswordEncoder", "cryptography → crypto 패키지 이름 변경");
  const rnRemoved = classifyRteToken("egovframework.rte.fdl.cryptography.config.EgovCryptoNameHandler", rules);
  assert(rnRemoved?.kind === "class-removed" && rnRemoved.action === "manual", "이름 바뀐 패키지 안의 제거 클래스는 제거가 우선");
  const wild = classifyRteToken("egovframework.rte.fdl.cmmn.exception.", rules);
  assert(wild?.kind === "package" && wild.to === "org.egovframe.rte.fdl.cmmn.exception", "와일드카드 import(패키지 토큰)");
  const inner = classifyRteToken("egovframework.rte.ptl.mvc.tags.ui.pagination.PaginationInfo.DEFAULT", rules);
  assert(inner?.kind === "package" && inner.to === "org.egovframe.rte.ptl.mvc.tags.ui.pagination.PaginationInfo.DEFAULT", "정적 멤버/내부 참조는 앞 세그먼트로 조회");
  const unk = classifyRteToken("egovframework.rte.fdl.cmmn.NoSuchClassXyz", rules);
  assert(unk?.kind === "class-unknown" && unk.action === "manual", "5.x 트리에 없는 클래스 → class-unknown/manual");
  const sec = classifyRteToken("egovframework.rte.fdl.security.securedobject.impl.SecuredObjectDAO", rules);
  assert(sec?.to === "org.egovframe.rte.fdl.security.secureobject.impl.SecuredObjectDAO" && sec.action === "auto", "securedobject → secureobject");
  assert(classifyRteToken("egovframework.com.cmm.EgovMessageSource", rules) === null, "RTE 아닌 패키지는 무시");
}
{
  assert(classifyJavaxPackage("javax.servlet.http", rules) === "jakarta.servlet.http", "javax.servlet.http → jakarta");
  assert(classifyJavaxPackage("javax.validation.constraints", rules) === "jakarta.validation.constraints", "javax.validation → jakarta");
  for (const jdk of ["javax.sql", "javax.xml.parsers", "javax.crypto", "javax.naming", "javax.net.ssl", "javax.swing", "javax.imageio", "javax.management", "javax.annotation.processing", "javax.transaction.xa", "javax.security.auth", "javax.script"])
    assert(classifyJavaxPackage(jdk, rules) === null, `JDK 내장 ${jdk} 는 대상 아님`);
  assert(classifyJavaxPackage("javax.annotation", rules) === "jakarta.annotation" && classifyJavaxPackage("javax.transaction", rules) === "jakarta.transaction", "javax.annotation·transaction 은 대상(하위 processing·xa 만 제외)");
}

// ── 3.10 스타일 픽스처 ────────────────────────────────
const legacy = mkdtempSync(path.join(tmpdir(), "egovmig310-"));
write(legacy, "pom.xml", `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>egovframework</groupId><artifactId>legacy</artifactId><version>1.0</version><packaging>war</packaging>
  <properties>
    <spring.maven.artifact.version>4.3.25.RELEASE</spring.maven.artifact.version>
    <egovframework.rte.version>3.10.0</egovframework.rte.version>
    <java.version>1.8</java.version>
  </properties>
  <repositories>
    <repository><id>egovframe</id><url>http://maven.egovframe.go.kr/maven/</url></repository>
    <repository><id>mvn2s</id><url>https://repo1.maven.org/maven2/</url></repository>
  </repositories>
  <dependencies>
    <dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.ptl.mvc</artifactId><version>\${egovframework.rte.version}</version>
      <exclusions><exclusion><groupId>commons-logging</groupId><artifactId>commons-logging</artifactId></exclusion></exclusions></dependency>
    <dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.psl.dataaccess</artifactId><version>3.10.0</version></dependency>
    <dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.fdl.crypto</artifactId><version>\${egovframework.rte.version}</version></dependency>
    <dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.fdl.nosuch</artifactId><version>3.10.0</version></dependency>
    <dependency><groupId>egovframework.rte</groupId><artifactId>spring-modules-validation</artifactId><version>0.9</version></dependency>
    <dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>3.1.0</version><scope>provided</scope></dependency>
    <dependency><groupId>javax.servlet</groupId><artifactId>jstl</artifactId><version>1.2</version></dependency>
    <dependency><groupId>javax.validation</groupId><artifactId>validation-api</artifactId><version>1.1.0.Final</version></dependency>
    <dependency><groupId>commons-dbcp</groupId><artifactId>commons-dbcp</artifactId><version>1.4</version></dependency>
    <dependency><groupId>log4j</groupId><artifactId>log4j</artifactId><version>1.2.17</version></dependency>
    <dependency><groupId>org.springframework</groupId><artifactId>spring-test</artifactId><version>\${spring.maven.artifact.version}</version><scope>test</scope></dependency>
    <dependency><groupId>org.hibernate</groupId><artifactId>hibernate-validator</artifactId><version>5.4.3.Final</version></dependency>
    <dependency><groupId>org.mybatis</groupId><artifactId>mybatis</artifactId><version>3.5.6</version></dependency>
    <dependency><groupId>org.apache.tiles</groupId><artifactId>tiles-jsp</artifactId><version>3.0.8</version></dependency>
  </dependencies>
  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId>
    <configuration><source>\${java.version}</source><target>1.8</target></configuration></plugin></plugins></build>
</project>
`);
write(legacy, "src/main/java/egovframework/example/sample/service/impl/SampleServiceImpl.java", `package egovframework.example.sample.service.impl;

import java.util.List;
import javax.annotation.Resource;
import javax.sql.DataSource;
import egovframework.rte.fdl.cmmn.EgovAbstractServiceImpl;
import egovframework.rte.fdl.cmmn.exception.*;
import egovframework.rte.fdl.idgnr.EgovIdGnrService;
import egovframework.rte.fdl.cryptography.EgovPasswordEncoder;
import egovframework.rte.psl.dataaccess.util.EgovMap;
import org.springframework.stereotype.Service;

@Service("sampleService")
public class SampleServiceImpl extends EgovAbstractServiceImpl implements SampleService {
  @Resource(name = "egovIdGnrService") private EgovIdGnrService idgen;
  private DataSource ds;
}
`);
write(legacy, "src/main/java/egovframework/example/sample/service/impl/SampleMapper.java", `package egovframework.example.sample.service.impl;

import egovframework.rte.psl.dataaccess.mapper.Mapper;
import egovframework.rte.fdl.cmmn.AbstractServiceImpl;

@Mapper("sampleMapper")
public interface SampleMapper {}
`);
write(legacy, "src/main/java/egovframework/example/web/SampleController.java", `package egovframework.example.web;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.validation.Valid;
import javax.annotation.processing.Generated;
import egovframework.rte.ptl.mvc.bind.annotation.CommandMap;
import egovframework.rte.ptl.mvc.tags.ui.pagination.PaginationInfo;
import egovframework.rte.fdl.cmmn.NoSuchClassXyz;

public class SampleController {}
`);
write(legacy, "src/main/java/egovframework/example/web/Already5.java", `package egovframework.example.web;

import jakarta.servlet.http.HttpServletRequest;
import org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl;
import org.egovframe.rte.psl.dataaccess.mapper.EgovMapper;

public class Already5 {}
`);
write(legacy, "src/main/resources/egovframework/spring/context-common.xml", `<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans"
  xmlns:egov-security="http://maven.egovframe.go.kr/schema/egov-security"
  xsi:schemaLocation="http://maven.egovframe.go.kr/schema/egov-security http://maven.egovframe.go.kr/schema/egov-security/egov-security-3.10.0.xsd">
  <bean id="leaveaTrace" class="egovframework.rte.fdl.cmmn.trace.LeaveaTrace"/>
  <bean class="egovframework.rte.psl.dataaccess.mapper.MapperConfigurer">
    <property name="annotationClass" value="egovframework.rte.psl.dataaccess.mapper.Mapper"/>
  </bean>
  <bean class="egovframework.rte.fdl.security.securedobject.impl.SecuredObjectDAO"/>
  <egov-security:config id="securityConfig" loginUrl="/login.do"/>
</beans>
`);
write(legacy, "src/main/resources/egovframework/mapper/sample_SQL.xml", `<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="Sample">
  <select id="selectList" resultType="egovframework.rte.psl.dataaccess.util.EgovMap">SELECT 1</select>
</mapper>
`);
write(legacy, "src/main/webapp/WEB-INF/web.xml", `<?xml version="1.0" encoding="UTF-8"?>
<web-app id="WebApp_ID" version="3.1" xmlns="http://xmlns.jcp.org/xml/ns/javaee"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <filter><filter-name>HTMLTagFilter</filter-name><filter-class>egovframework.rte.ptl.mvc.filter.HTMLTagFilter</filter-class></filter>
</web-app>
`);
write(legacy, "src/main/webapp/WEB-INF/jsp/sample.jsp", `<%@ page language="java" contentType="text/html; charset=utf-8" pageEncoding="utf-8"%>
<%@ page import="java.util.*, javax.servlet.http.HttpSession" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core"%>
<html><body>ok</body></html>
`);
write(legacy, "target/classes/Generated.java", `import javax.servlet.Filter; import egovframework.rte.fdl.cmmn.EgovAbstractServiceImpl;`);
write(legacy, "build.gradle", `dependencies {
  implementation 'egovframework.rte:egovframework.rte.fdl.property:3.10.0'
  implementation "javax.inject:javax.inject:1"
  implementation 'commons-dbcp:commons-dbcp:1.4'
}
repositories { maven { url 'http://maven.egovframe.go.kr/maven/' } }
sourceCompatibility = 1.8
`);

const before = snapshot(legacy);
const r = migrateProject({ projectDir: legacy });
assert(JSON.stringify([...snapshot(legacy)]) === JSON.stringify([...before]), "진단 후 디스크 불변(읽기 전용)");
assert(r.sourceEra === "3.x" && r.buildSystem === "maven" && r.rteVersion === "3.10.0", `3.x·maven·3.10.0 감지 (got ${r.sourceEra}/${r.buildSystem}/${r.rteVersion})`);
assert(!r.items.some((i) => i.file.startsWith("target/")), "target/ 은 스캔 제외");
assert(r.items.every((i) => Number.isInteger(i.line) && i.line >= 1 && typeof i.reason === "string" && i.reason.length > 0 && ["auto", "manual"].includes(i.action)), "모든 항목에 line·reason·action");
assert(r.summary.auto + r.summary.manual === r.items.length, "요약 합계 일치");

// pom
const coord = one(r, (i) => i.kind === "coordinate" && i.from.startsWith("egovframework.rte:egovframework.rte.ptl.mvc"), "ptl.mvc 좌표");
assert(coord.to === "org.egovframe.rte:egovframe-rte-ptl-mvc:5.0.2" && coord.action === "auto" && coord.line === 14, `ptl.mvc → egovframe-rte-ptl-mvc:5.0.2 @L14 (got ${coord.to} L${coord.line})`);
one(r, (i) => i.kind === "coordinate" && i.from === "egovframework.rte:egovframework.rte.psl.dataaccess:3.10.0" && i.to === "org.egovframe.rte:egovframe-rte-psl-dataaccess:5.0.2", "리터럴 버전 좌표");
one(r, (i) => i.kind === "coordinate" && i.to.endsWith("egovframe-rte-fdl-crypto:5.0.2"), "fdl.crypto 좌표(모듈명은 crypto 그대로)");
one(r, (i) => i.kind === "coordinate-unknown" && i.action === "manual" && i.from.includes("fdl.nosuch"), "알 수 없는 RTE 모듈 → manual");
one(r, (i) => i.kind === "removed-module" && i.action === "manual" && i.from.includes("spring-modules-validation"), "spring-modules-validation → 제거 모듈");
const rv = one(r, (i) => i.kind === "rte-version" && i.file === "pom.xml", "RTE 버전 속성");
assert(rv.line === 6 && rv.to.includes("5.0.2"), `RTE 버전 속성 L6 → 5.0.2 (got L${rv.line})`);
one(r, (i) => i.kind === "repository" && i.file === "pom.xml" && i.line === 10 && i.to === "https://maven.egovframe.go.kr/maven/", "저장소 http → https @L10");
assert(!r.items.some((i) => i.kind === "repository" && i.from.includes("repo1")), "Maven Central 저장소는 무시");
one(r, (i) => i.kind === "jakarta-artifact" && i.from.startsWith("javax.servlet:javax.servlet-api") && i.to.startsWith("jakarta.servlet:jakarta.servlet-api:6.0.0"), "servlet-api → jakarta");
one(r, (i) => i.kind === "jakarta-artifact" && i.from.startsWith("javax.servlet:jstl") && i.to.includes("org.glassfish.web:jakarta.servlet.jsp.jstl"), "jstl → API+구현");
one(r, (i) => i.kind === "jakarta-artifact" && i.from.startsWith("javax.validation:validation-api"), "validation-api → jakarta.validation-api");
one(r, (i) => i.file === "pom.xml" && i.kind === "library" && i.from.startsWith("commons-dbcp:") && i.to.includes("commons-dbcp2") && i.action === "manual", "commons-dbcp → dbcp2 (manual)");
one(r, (i) => i.kind === "library" && i.from.startsWith("log4j:log4j"), "log4j 1.x (manual)");
one(r, (i) => i.kind === "library" && i.from.startsWith("org.springframework:spring-test") && i.file === "pom.xml", "spring-test 4.3(속성 해석) → manual");
one(r, (i) => i.kind === "library" && i.from.startsWith("org.hibernate:hibernate-validator:5"), "hibernate-validator 5 → manual");
one(r, (i) => i.kind === "library" && i.from.startsWith("org.apache.tiles:tiles-jsp"), "tiles-* glob 매칭");
assert(!r.items.some((i) => i.from.startsWith("org.mybatis:mybatis:")), "mybatis 3.5 는 항목 아님");
one(r, (i) => i.kind === "spring-version" && i.action === "manual" && i.from.includes("4.3.25.RELEASE"), "Spring 4.3 속성 → manual");
const jr = find(r, (i) => i.kind === "java-release" && i.file === "pom.xml");
assert(jr.length === 3 && jr.some((i) => i.from.includes("java.version")) && jr.some((i) => i.from === "<target>1.8</target>") && jr.some((i) => i.from === "<source>${java.version}</source>"), `Java 1.8 → 17 (속성·source·target) (got ${jr.length})`);
one(r, (i) => i.kind === "parent" && i.action === "manual" && i.file === "pom.xml", "5.x parent 권고");

// gradle
one(r, (i) => i.file === "build.gradle" && i.kind === "coordinate" && i.to === "org.egovframe.rte:egovframe-rte-fdl-property:5.0.2", "gradle 좌표");
one(r, (i) => i.file === "build.gradle" && i.kind === "jakarta-artifact" && i.from === "javax.inject:javax.inject:1", "gradle javax.inject");
one(r, (i) => i.file === "build.gradle" && i.kind === "library" && i.from.startsWith("commons-dbcp"), "gradle commons-dbcp");
one(r, (i) => i.file === "build.gradle" && i.kind === "repository" && i.line === 6, "gradle 저장소 URL @L6");
one(r, (i) => i.file === "build.gradle" && i.kind === "java-release" && i.from.startsWith("sourceCompatibility"), "gradle sourceCompatibility 1.8");

// java
const svc = "src/main/java/egovframework/example/sample/service/impl/SampleServiceImpl.java";
one(r, (i) => i.file === svc && i.line === 4 && i.kind === "jakarta-package" && i.from === "javax.annotation" && i.to === "jakarta.annotation", "javax.annotation.Resource → jakarta @L4");
assert(!r.items.some((i) => i.file === svc && i.from === "javax.sql"), "javax.sql(JDK) 무시");
one(r, (i) => i.file === svc && i.line === 6 && i.kind === "package" && i.to === "org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl", "EgovAbstractServiceImpl 접두어 변경 @L6");
one(r, (i) => i.file === svc && i.line === 7 && i.kind === "package" && i.from === "egovframework.rte.fdl.cmmn.exception", "와일드카드 import @L7");
one(r, (i) => i.file === svc && i.line === 9 && i.kind === "package-renamed" && i.to === "org.egovframe.rte.fdl.crypto.EgovPasswordEncoder", "cryptography → crypto @L9");
assert(find(r, (i) => i.file === svc).length === 6, `SampleServiceImpl 항목 6건 (got ${find(r, (i) => i.file === svc).length})`);
const mapper = "src/main/java/egovframework/example/sample/service/impl/SampleMapper.java";
one(r, (i) => i.file === mapper && i.line === 3 && i.kind === "class-removed" && i.action === "manual" && i.to === "org.egovframe.rte.psl.dataaccess.mapper.EgovMapper", "@Mapper import → EgovMapper manual");
one(r, (i) => i.file === mapper && i.line === 4 && i.kind === "class-removed" && i.to === "org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl", "AbstractServiceImpl → EgovAbstractServiceImpl manual");
const ctl = "src/main/java/egovframework/example/web/SampleController.java";
assert(find(r, (i) => i.file === ctl && i.kind === "jakarta-package").length === 3, "Controller: servlet×2·validation → jakarta(3건), annotation.processing 제외");
one(r, (i) => i.file === ctl && i.kind === "class-removed" && i.from.endsWith("CommandMap") && i.to === null, "@CommandMap 제거(대체 없음)");
one(r, (i) => i.file === ctl && i.kind === "class-unknown" && i.from.endsWith("NoSuchClassXyz"), "알 수 없는 RTE 클래스");
assert(find(r, (i) => i.file === "src/main/java/egovframework/example/web/Already5.java").length === 0, "이미 5.x 소스는 항목 없음");

// xml / web.xml / jsp
const ctxXml = "src/main/resources/egovframework/spring/context-common.xml";
assert(find(r, (i) => i.file === ctxXml && i.kind === "xml-namespace").length === 2 && find(r, (i) => i.file === ctxXml && i.kind === "xml-namespace")[0].action === "manual", "egov-security 네임스페이스 2줄 manual");
one(r, (i) => i.file === ctxXml && i.line === 5 && i.kind === "package" && i.to === "org.egovframe.rte.fdl.cmmn.trace.LeaveaTrace", "bean class 접두어 @L5");
one(r, (i) => i.file === ctxXml && i.line === 7 && i.kind === "class-removed" && i.to.endsWith("EgovMapper"), "annotationClass Mapper → EgovMapper");
one(r, (i) => i.file === ctxXml && i.line === 9 && i.kind === "package-renamed" && i.to.includes("secureobject"), "securedobject bean → secureobject");
one(r, (i) => i.file === "src/main/resources/egovframework/mapper/sample_SQL.xml" && i.kind === "package" && i.to.endsWith("EgovMap"), "MyBatis resultType 접두어");
const wx = "src/main/webapp/WEB-INF/web.xml";
one(r, (i) => i.file === wx && i.kind === "web-xml" && i.line === 2 && i.action === "auto" && i.to.includes("jakarta.ee/xml/ns/jakartaee"), "web.xml 스키마 → jakartaee");
one(r, (i) => i.file === wx && i.kind === "package" && i.to === "org.egovframe.rte.ptl.mvc.filter.HTMLTagFilter", "web.xml filter-class 접두어");
one(r, (i) => i.file === "src/main/webapp/WEB-INF/jsp/sample.jsp" && i.line === 2 && i.kind === "jakarta-package" && i.from === "javax.servlet.http", "JSP page import javax.servlet.http");

// markdown
const md = renderMigrationMarkdown(r);
assert(md.startsWith("# 표준프레임워크 5.x 전환 진단") && md.includes("## 수동 전환 항목") && md.includes("## 자동 치환 가능 항목") && md.includes("egovframe-rte-ptl-mvc:5.0.2"), "Markdown 렌더링");
assert(md.includes(`| RTE Maven 좌표 |`) && md.includes("파일을 수정하지 않았습니다"), "Markdown 요약 표·읽기 전용 문구");

// ── 5.x 스타일 픽스처: 항목 0건 ───────────────────────
const modern = mkdtempSync(path.join(tmpdir(), "egovmig5-"));
write(modern, "pom.xml", `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>egovframework</groupId><artifactId>modern</artifactId><version>1.0</version><packaging>war</packaging>
  <parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.1</version></parent>
  <repositories><repository><id>egovframe</id><url>https://maven.egovframe.go.kr/maven/</url></repository></repositories>
  <dependencies>
    <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-mvc</artifactId></dependency>
    <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-psl-dataaccess</artifactId></dependency>
    <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-reactive</artifactId></dependency>
    <dependency><groupId>jakarta.servlet</groupId><artifactId>jakarta.servlet-api</artifactId><scope>provided</scope></dependency>
    <dependency><groupId>jakarta.servlet.jsp.jstl</groupId><artifactId>jakarta.servlet.jsp.jstl-api</artifactId></dependency>
    <dependency><groupId>org.glassfish.web</groupId><artifactId>jakarta.servlet.jsp.jstl</artifactId></dependency>
    <dependency><groupId>org.hibernate.validator</groupId><artifactId>hibernate-validator</artifactId><version>8.0.1.Final</version></dependency>
    <dependency><groupId>org.springframework</groupId><artifactId>spring-test</artifactId><scope>test</scope></dependency>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter-api</artifactId><scope>test</scope></dependency>
  </dependencies>
  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId>
    <configuration><release>\${java.version}</release></configuration></plugin></plugins></build>
</project>
`);
write(modern, "src/main/java/egovframework/example/sample/service/impl/SampleServiceImpl.java", `package egovframework.example.sample.service.impl;

import jakarta.annotation.Resource;
import javax.sql.DataSource;
import org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl;
import org.egovframe.rte.fdl.cmmn.exception.EgovBizException;
import org.egovframe.rte.psl.dataaccess.mapper.EgovMapper;
import org.egovframe.rte.psl.dataaccess.util.EgovMap;
import org.egovframe.rte.ptl.mvc.tags.ui.pagination.PaginationInfo;
import org.egovframe.rte.fdl.crypto.EgovPasswordEncoder;
import org.egovframe.rte.fdl.security.secureobject.impl.SecuredObjectDAO;

public class SampleServiceImpl extends EgovAbstractServiceImpl {}
`);
write(modern, "src/main/resources/egovframework/spring/context-common.xml", `<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans">
  <bean id="leaveaTrace" class="org.egovframe.rte.fdl.cmmn.trace.LeaveaTrace"/>
  <bean class="org.egovframe.rte.psl.dataaccess.mapper.MapperConfigurer">
    <property name="annotationClass" value="org.egovframe.rte.psl.dataaccess.mapper.EgovMapper"/>
  </bean>
</beans>
`);
write(modern, "src/main/webapp/WEB-INF/web.xml", `<?xml version="1.0" encoding="UTF-8"?>
<web-app id="WebApp_ID" version="5.0" xmlns="https://jakarta.ee/xml/ns/jakartaee"
  xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/web-app_5_0.xsd">
  <filter><filter-name>HTMLTagFilter</filter-name><filter-class>org.egovframe.rte.ptl.mvc.filter.HTMLTagFilter</filter-class></filter>
</web-app>
`);
write(modern, "src/main/webapp/WEB-INF/jsp/sample.jsp", `<%@ page import="java.util.*, jakarta.servlet.http.HttpSession" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core"%>
`);
const r5 = migrateProject({ projectDir: modern });
assert(r5.sourceEra === "5.x" && r5.items.length === 0, `5.x 픽스처 항목 0건 (got ${r5.items.length}: ${r5.items.map((i) => `${i.kind}:${i.from}`).join(", ")})`);
assert(renderMigrationMarkdown(r5).includes("전환 항목 없음"), "5.x → '전환 항목 없음'");

// ── 오류·경계 ─────────────────────────────────────────
let threw = false;
try { migrateProject({ projectDir: path.join(legacy, "no-such-dir") }); } catch { threw = true; }
assert(threw, "없는 디렉터리 → 예외");
threw = false;
try { migrateProject({ projectDir: legacy, target: "6.x" }); } catch { threw = true; }
assert(threw, "지원하지 않는 target → 예외");
const rj = JSON.parse(JSON.stringify(r));
assert(Array.isArray(rj.items) && rj.rules.toTag === "v5.0.2-Final" && typeof rj.summary.byKind === "object", "JSON 직렬화 가능한 결과");

rmSync(legacy, { recursive: true, force: true });
rmSync(modern, { recursive: true, force: true });
if (process.exitCode) console.error(`migrate FAIL (${n} assertions)`); else console.log(`migrate OK (${n} assertions)`);
