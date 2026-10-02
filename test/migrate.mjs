// node test/migrate.mjs — 5.x 전환 진단 (오프라인 픽스처)
// 3.10 스타일 프로젝트(pom·java·xml·jsp·web.xml)에서 항목 분류(auto/manual)·라인·대응 좌표를 단언하고,
// 5.x 스타일 프로젝트에서는 항목 0건(거짓 양성 없음)을 단언한다. 진단 전후 디스크가 바뀌지 않는지도 확인한다.
import { migrateProject, renderMigrationMarkdown, classifyRteToken, classifyComponentToken, classifyJavaxPackage, versionBelow, loadMigrationRules, applyTextEdits, applyMigration, renderMigrationApplyMarkdown, linkBuildError, verifyMigration, renderMigrationVerifyMarkdown, parseBuildErrors } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
function snapshot(root) {
  const out = new Map();
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.set(path.relative(root, p).split(path.sep).join("/"), `${statSync(p).mtimeMs}:${createHash("sha256").update(readFileSync(p)).digest("hex")}`); } };
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
assert(jr.length === 2 && jr.some((i) => i.from.includes("java.version")) && jr.some((i) => i.from === "<target>1.8</target>") && !jr.some((i) => i.from.includes("<source>")), `Java 1.8 → 17 (속성·target; <source>\${속성}</source> 은 속성 항목이 담당) (got ${jr.length})`);
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


// ── 2단계: 적용 ────────────────────────────────────────
{
  const t = applyTextEdits("abcdef", [{ start: 1, end: 2, replacement: "XX" }, { start: 4, end: 5, replacement: "" }, { start: 6, end: 6, replacement: "+" }]);
  assert(t.text === "aXXcdf+" && t.applied === 3 && t.skipped.length === 0, "applyTextEdits: 치환·삭제·삽입을 뒤에서부터 적용");
  const o = applyTextEdits("abcdef", [{ start: 1, end: 4, replacement: "1" }, { start: 2, end: 3, replacement: "2" }]);
  assert(o.applied === 1 && o.skipped.length === 1 && o.text === "ab2def", "applyTextEdits: 겹치는 편집은 하나만 적용하고 나머지는 skipped");
  const bad = applyTextEdits("abc", [{ start: 2, end: 9, replacement: "x" }]);
  assert(bad.applied === 0 && bad.skipped.length === 1, "applyTextEdits: 범위 밖 편집 거부");
}
// 모든 auto 항목에 edits 가 있고, edits 가 가리키는 원문이 from 과 일치하는지(토큰 종류)
{
  const texts = new Map();
  const readRel = (f) => texts.get(f) ?? (texts.set(f, readFileSync(path.join(legacy, f), "utf8")), texts.get(f));
  const autos = r.items.filter((i) => i.action === "auto");
  assert(autos.every((i) => Array.isArray(i.edits) && i.edits.length > 0), "auto 항목은 모두 edits 를 가진다");
  assert(r.items.filter((i) => i.action === "manual").every((i) => !i.edits), "manual 항목은 edits 가 없다");
  const tokenKinds = new Set(["package", "package-renamed", "class-moved", "jakarta-package", "repository"]);
  let mismatched = 0;
  for (const i of autos) if (tokenKinds.has(i.kind)) for (const e of i.edits) if (readRel(i.file).slice(e.start, e.end) !== i.from) mismatched++;
  assert(mismatched === 0, `토큰 편집의 원문 구간이 from 과 일치 (불일치 ${mismatched})`);
  const inserts = autos.filter((i) => i.kind === "jakarta-artifact" && i.edits.some((e) => e.start === e.end));
  assert(inserts.length === 1 && inserts[0].from.startsWith("javax.servlet:jstl"), "JSTL 은 구현 의존성 삽입 편집을 하나 가진다");
}
// dryRun: 미리보기만, 디스크 불변
const dry = await applyMigration({ projectDir: legacy });
assert(dry.mode === "apply" && dry.dryRun === true && dry.applied.items === r.summary.auto && dry.skippedManual === r.summary.manual, `dryRun 계획: auto ${dry.applied.items}항목 전부, manual ${dry.skippedManual} 유지`);
assert(dry.conflicts.length === 0, "겹치는 편집 없음");
assert(dry.files.length === new Set(r.items.filter((i) => i.action === "auto").map((i) => i.file)).size && dry.files.every((f) => f.preview.length > 0), `파일별 계획 ${dry.files.length}개 + 미리보기`);
assert(JSON.stringify([...snapshot(legacy)]) === JSON.stringify([...before]), "dryRun 후 디스크 불변");
assert(!existsSync(path.join(legacy, "migration-backup")), "dryRun 은 백업을 만들지 않음");
const dryMd = renderMigrationApplyMarkdown(dry);
assert(dryMd.includes("적용 계획(dryRun)") && dryMd.includes("## 파일별 변경 미리보기") && dryMd.includes("dryRun=false"), "dryRun Markdown");

// fault injection: 파일을 쓴 뒤 실패 → 전부 원복, 백업 디렉터리도 남지 않음
let txErr = null;
try { await applyMigration({ projectDir: legacy, dryRun: false, faultInjection: "after-files" }); } catch (e) { txErr = e; }
assert(txErr && /fault injection/.test(txErr.message) && /롤백했습니다/.test(txErr.message), "fault injection → TransactionError + 롤백 보고");
assert(JSON.stringify([...snapshot(legacy)]) === JSON.stringify([...before]), "롤백 후 디스크 불변(내용·mtime)");
assert(!existsSync(path.join(legacy, "migration-backup")), "롤백 후 백업 디렉터리 없음");

// 실제 적용
const applied = await applyMigration({ projectDir: legacy, dryRun: false });
assert(applied.dryRun === false && applied.applied.items === dry.applied.items && applied.applied.files === dry.files.length, "적용 수가 dryRun 계획과 일치");
assert(applied.remaining && applied.remaining.auto === 0 && applied.remaining.manual === r.summary.manual, `적용 후 재진단 auto 0 · manual ${applied.remaining?.manual} 유지`);
assert(applied.backupDir && existsSync(applied.backupDir) && existsSync(applied.planPath), "백업 디렉터리·migration-plan.json 생성");
const plan = JSON.parse(readFileSync(applied.planPath, "utf8"));
assert(plan.tool === "migrate_egovframe_project" && plan.items.length === r.items.length && plan.files.length === applied.applied.files && !plan.items.some((i) => i.edits), "계획 파일: 항목 전체(edits 제외)·파일 목록");
for (const f of applied.files) {
  const backup = path.join(applied.backupDir, f.file);
  const original = readFileSync(path.join(legacy, f.file), "utf8");
  assert(existsSync(backup) && readFileSync(backup, "utf8") !== original && before.has(f.file), `백업 원본 존재·현재 파일과 다름: ${f.file}`);
}
const pomAfter = readFileSync(path.join(legacy, "pom.xml"), "utf8");
assert(pomAfter.includes("<org.egovframe.rte.version>5.0.2</org.egovframe.rte.version>") && !pomAfter.includes("egovframework.rte.version"), "RTE 버전 속성 이름·값 치환, 레거시 속성 참조 0건");
assert(pomAfter.includes("<artifactId>egovframe-rte-ptl-mvc</artifactId>") && pomAfter.includes("<version>${org.egovframe.rte.version}</version>"), "좌표 + ${속성} 참조 치환");
assert(/<artifactId>egovframe-rte-psl-dataaccess<\/artifactId><version>5\.0\.2<\/version>/.test(pomAfter), "리터럴 버전 → 5.0.2");
assert(pomAfter.includes("<url>https://maven.egovframe.go.kr/maven/</url>") && !pomAfter.includes("http://maven.egovframe"), "저장소 URL https");
assert(pomAfter.includes("<groupId>jakarta.servlet</groupId><artifactId>jakarta.servlet-api</artifactId><version>6.0.0</version><scope>provided</scope>"), "servlet-api → jakarta 6.0.0, scope 보존");
assert(pomAfter.includes("<artifactId>jakarta.servlet.jsp.jstl-api</artifactId><version>3.0.2</version>") && (pomAfter.match(/<artifactId>jakarta\.servlet\.jsp\.jstl<\/artifactId>/g) ?? []).length === 1 && pomAfter.includes("<groupId>org.glassfish.web</groupId>"), "JSTL API 치환 + glassfish 구현 1회 삽입");
assert(pomAfter.includes("<java.version>17</java.version>") && pomAfter.includes("<target>17</target>") && pomAfter.includes("<source>${java.version}</source>"), "Java 17 (속성·target; ${속성} 참조는 그대로)");
assert(pomAfter.includes("<artifactId>egovframework.rte.fdl.nosuch</artifactId>") && pomAfter.includes("spring-modules-validation") && pomAfter.includes("commons-dbcp") && pomAfter.includes("4.3.25.RELEASE"), "manual 항목(미지 모듈·제거 모듈·라이브러리·Spring 속성)은 그대로");
const svcAfter = readFileSync(path.join(legacy, svc), "utf8");
assert(svcAfter.includes("import jakarta.annotation.Resource;") && svcAfter.includes("import javax.sql.DataSource;") && svcAfter.includes("import org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl;") && svcAfter.includes("import org.egovframe.rte.fdl.cmmn.exception.*;") && svcAfter.includes("import org.egovframe.rte.fdl.crypto.EgovPasswordEncoder;"), "java: jakarta·접두어·와일드카드·패키지 이름 변경 치환, javax.sql 유지");
const mapperAfter = readFileSync(path.join(legacy, mapper), "utf8");
assert(mapperAfter.includes("import egovframework.rte.psl.dataaccess.mapper.Mapper;") && mapperAfter.includes("import egovframework.rte.fdl.cmmn.AbstractServiceImpl;"), "제거 클래스(manual) import 는 건드리지 않음");
const ctxAfter = readFileSync(path.join(legacy, ctxXml), "utf8");
assert(ctxAfter.includes('class="org.egovframe.rte.fdl.cmmn.trace.LeaveaTrace"') && ctxAfter.includes('value="egovframework.rte.psl.dataaccess.mapper.Mapper"') && ctxAfter.includes("org.egovframe.rte.fdl.security.secureobject.impl.SecuredObjectDAO") && ctxAfter.includes('xmlns:egov-security="http://maven.egovframe.go.kr/schema/egov-security"'), "XML: bean class 치환, 제거 클래스·네임스페이스 유지");
const wxAfter = readFileSync(path.join(legacy, wx), "utf8");
assert(wxAfter.includes('version="5.0" xmlns="https://jakarta.ee/xml/ns/jakartaee"') && wxAfter.includes("org.egovframe.rte.ptl.mvc.filter.HTMLTagFilter"), "web.xml 스키마·filter-class 치환");
const gradleAfter = readFileSync(path.join(legacy, "build.gradle"), "utf8");
assert(gradleAfter.includes("'org.egovframe.rte:egovframe-rte-fdl-property:5.0.2'") && gradleAfter.includes('"jakarta.inject:jakarta.inject-api:2.0.1"') && gradleAfter.includes("https://maven.egovframe.go.kr/maven/") && gradleAfter.includes("sourceCompatibility = 17") && gradleAfter.includes("commons-dbcp:commons-dbcp:1.4"), "gradle 치환(좌표·jakarta·저장소·Java), manual 유지");
const jspAfter = readFileSync(path.join(legacy, "src/main/webapp/WEB-INF/jsp/sample.jsp"), "utf8");
assert(jspAfter.includes("jakarta.servlet.http.HttpSession") && jspAfter.includes("http://java.sun.com/jsp/jstl/core"), "JSP import 치환, JSTL uri 유지");
assert(readFileSync(path.join(legacy, "target/classes/Generated.java"), "utf8").includes("javax.servlet.Filter"), "target/ 은 건드리지 않음");
// 두 번째 적용: 바꿀 것이 없으면 아무것도 쓰지 않음
const again = await applyMigration({ projectDir: legacy, dryRun: false });
assert(again.applied.items === 0 && again.files.length === 0 && again.backupDir === undefined, "재적용 시 auto 0 → 무기록");
const afterMd = renderMigrationApplyMarkdown(applied);
assert(afterMd.includes("적용 결과") && afterMd.includes("## 남은 수동 항목") && afterMd.includes("build_egovframe_project"), "적용 Markdown");


// ── 3단계: 공통컴포넌트 대응표·재조립 권고·검증 (v0.33) ──
{
  const c = rules.packages.components;
  assert(c && c.prefix === "egovframework.com." && c.removed.length >= 50 && c.moves.length >= 4 && c.evidence.from > 1000, `공통컴포넌트 대응표(제거 ${c?.removed.length}·이동 ${c?.moves.length})`);
  const rm = classifyComponentToken("egovframework.com.cmm.util.EgovMybaitsUtil", rules);
  assert(rm?.kind === "component-class-removed" && rm.action === "manual" && rm.to === "egovframework.com.cmm.util.EgovMybatisUtil", "EgovMybaitsUtil → 수동 대응(오타 정정)");
  const mv = classifyComponentToken("egovframework.com.utl.sys.fsm.service.FileSystemUtils", rules);
  assert(mv?.kind === "component-class-moved" && mv.action === "auto" && mv.to === "egovframework.com.cmm.service.FileSystemUtils", "FileSystemUtils 이동 → 자동");
  assert(classifyComponentToken("egovframework.com.cmm.MyOwnClass", rules) === null && classifyComponentToken("egovframework.com.cmm.service.EgovProperties", rules) === null, "대응표에 없는 공통컴포넌트·사용자 클래스는 보고하지 않음");
  assert(classifyComponentToken("egovframework.rte.fdl.cmmn.X", rules) === null, "RTE 토큰은 컴포넌트 분류 대상 아님");
}
const comp = mkdtempSync(path.join(tmpdir(), "egovmigcomp-"));
write(comp, "pom.xml", `<project><dependencies><dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.ptl.mvc</artifactId><version>3.10.0</version></dependency></dependencies></project>`);
write(comp, "src/main/java/egovframework/com/cmm/EgovComUtil.java", "import javax.servlet.http.HttpServletRequest;\nimport egovframework.rte.fdl.cmmn.EgovAbstractServiceImpl;\nclass EgovComUtil {}\n");
write(comp, "src/main/java/egovframework/com/cmm/Other.java", "import egovframework.com.utl.sys.fsm.service.FileSystemUtils;\nimport egovframework.com.cmm.util.EgovMybaitsUtil;\nclass Other {}\n");
write(comp, "src/main/java/egovframework/example/App.java", "import egovframework.rte.fdl.cmmn.EgovAbstractServiceImpl;\nclass App {}\n");
const rc = migrateProject({ projectDir: comp });
const reasm = rc.items.filter((i) => i.kind === "component-reassemble");
assert(reasm.length === 1 && reasm[0].file === "src/main/java/egovframework/com/cmm/" && reasm[0].from.startsWith("cmm") && reasm[0].action === "manual" && reasm[0].to.includes('add_egovframe_components(componentIds=["cmm"])'), "cmm 디렉터리에 3.x 항목 → 재조립 권고 1건");
one(rc, (i) => i.kind === "component-class-removed" && i.from.endsWith("EgovMybaitsUtil") && i.action === "manual", "제거 공통컴포넌트 클래스 참조 → manual");
one(rc, (i) => i.kind === "component-class-moved" && i.action === "auto" && i.edits?.length === 1, "이동 공통컴포넌트 클래스 → auto 편집");
const rcSkip = migrateProject({ projectDir: comp, skipComponents: true });
assert(rcSkip.items.filter((i) => i.file.startsWith("src/main/java/egovframework/com/cmm/") && i.action === "auto").length === 0 && rcSkip.items.filter((i) => i.file.startsWith("src/main/java/egovframework/com/cmm/") && i.action === "manual" && !i.edits).length >= 4 && rcSkip.notes.some((x) => x.includes("skipComponents")), "skipComponents: 컴포넌트 디렉터리 auto → manual, edits 제거");
assert(rcSkip.items.find((i) => i.file === "src/main/java/egovframework/example/App.java").action === "auto", "skipComponents 는 컴포넌트 밖 항목에 영향 없음");
const dryC = await applyMigration({ projectDir: comp, skipComponents: true });
assert(dryC.files.every((f) => !f.file.startsWith("src/main/java/egovframework/com/cmm/")) && dryC.files.some((f) => f.file === "src/main/java/egovframework/example/App.java"), "skipComponents 적용 계획은 컴포넌트 밖 파일만");
const mdC = renderMigrationMarkdown(rc);
assert(mdC.includes("공통컴포넌트 재조립 권고") && mdC.includes("제거된 공통컴포넌트 클래스"), "Markdown 에 컴포넌트 항목 라벨");

// linkBuildError (순수)
{
  const items = [
    { file: "src/main/java/a/Svc.java", line: 3, kind: "class-removed", from: "egovframework.rte.psl.dataaccess.mapper.Mapper", to: "x", action: "manual", reason: "r" },
    { file: "src/main/java/a/Svc.java", line: 10, kind: "package", from: "egovframework.rte.fdl.cmmn.EgovAbstractServiceImpl", to: "y", action: "auto", reason: "r" },
    { file: "src/main/java/a/Svc.java", line: 20, kind: "xml-namespace", from: "http://x", to: "z", action: "manual", reason: "r" },
    { file: "src/main/java/b/B.java", line: 1, kind: "class-removed", from: "egovframework.rte.ptl.mvc.bind.annotation.CommandMap", to: null, action: "manual", reason: "r" },
  ];
  const dir = "/proj";
  const L = (e) => linkBuildError(e, items, rules, dir);
  assert(L({ file: "/proj/src/main/java/a/Svc.java", line: 30, message: "cannot find symbol", symbol: "class Mapper", location: "package egovframework.rte.psl.dataaccess.mapper" }).itemIndex === 0, "symbol 일치 → 같은 파일의 수동 항목(라인 무관)");
  assert(L({ file: "src/main/java/a/Svc.java", line: 30, message: "package egovframework.rte.psl.dataaccess.mapper does not exist" }).itemIndex === 0, "package does not exist → 패키지 접두 일치, 상대 경로 입력");
  assert(L({ file: "/proj/src/main/java/a/Svc.java", line: 11, message: "cannot find symbol", symbol: "class EgovAbstractServiceImpl" }).itemIndex === 1, "자동 항목도 심볼이 맞으면 연결(수동 우선)");
  const near = L({ file: "/proj/src/main/java/a/Svc.java", line: 22, message: "incompatible types" });
  assert(near.itemIndex === 2 && near.how === "same-file-line", "심볼 없으면 ±3 라인의 수동 항목");
  const rulesOnly = L({ file: "/proj/src/main/java/c/C.java", line: 5, message: "cannot find symbol", symbol: "class CommandMap" });
  assert(rulesOnly.itemIndex === null && rulesOnly.how === "rules-symbol" && rulesOnly.note.includes("CommandMap"), "다른 파일의 제거 클래스 심볼 → 규칙으로 설명");
  const comp2 = L({ file: "/proj/src/main/java/c/C.java", line: 5, message: "cannot find symbol", symbol: "class EgovMybaitsUtil" });
  assert(comp2.how === "rules-symbol" && comp2.note.includes("EgovMybatisUtil"), "공통컴포넌트 제거 클래스 심볼도 규칙으로 설명");
  const pkgOnly = L({ file: "/proj/src/main/java/c/C.java", line: 5, message: "package javax.servlet.http does not exist" });
  assert(pkgOnly.how === "rules-symbol" && pkgOnly.note.includes("jakarta"), "javax 패키지 부재 → 적용 미완 안내");
  assert(L({ file: "/proj/src/main/java/c/C.java", line: 5, message: "';' expected" }).how === "unlinked", "무관한 오류 → unlinked");
}
// parseBuildErrors 의 symbol/location 캡처
{
  const errs = parseBuildErrors("maven", "[ERROR] /p/A.java:[3,41] cannot find symbol\n[ERROR]   symbol:   class Mapper\n[ERROR]   location: package egovframework.rte.psl.dataaccess.mapper\n[ERROR] /p/A.java:[5,1] package egovframework.rte.fdl.cmmn does not exist\n");
  assert(errs.length === 2 && errs[0].symbol === "class Mapper" && errs[0].location === "package egovframework.rte.psl.dataaccess.mapper" && errs[1].symbol === undefined, "maven symbol/location 캡처, 다음 오류로 번지지 않음");
  const g = parseBuildErrors("gradle", "/p/A.java:3: error: cannot find symbol\n  symbol:   class Mapper\n  location: package x\n");
  assert(g[0].symbol === "class Mapper" && g[0].location === "package x", "gradle(javac) symbol/location 캡처");
}
// verifyMigration (가짜 runner)
{
  const vproj = mkdtempSync(path.join(tmpdir(), "egovmigverify-"));
  write(vproj, "pom.xml", `<project><dependencies><dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-mvc</artifactId></dependency></dependencies></project>`);
  write(vproj, "src/main/java/a/Svc.java", "import egovframework.rte.psl.dataaccess.mapper.Mapper;\nimport egovframework.rte.fdl.cmmn.AbstractServiceImpl;\nclass Svc {}\n");
  const abs = path.join(vproj, "src/main/java/a/Svc.java");
  const runner = async (cmd, o) => { o.onData(`[ERROR] ${abs}:[1,45] cannot find symbol\n[ERROR]   symbol:   class Mapper\n[ERROR]   location: package egovframework.rte.psl.dataaccess.mapper\n[ERROR] ${abs}:[2,36] package egovframework.rte.fdl.cmmn does not exist\n[ERROR] ${abs}:[9,1] ';' expected\n`); return { exitCode: 1, timedOut: false }; };
  const v = await verifyMigration({ projectDir: vproj, runner, platform: "linux" });
  assert(v.mode === "verify" && v.build.ran && v.build.success === false && v.build.errors === 3 && v.build.command === "mvn -B -e compile", `verify: 빌드 실행·오류 3건 (${v.build.command})`);
  assert(v.links.filter((l) => l.itemIndex !== null).length === 2 && v.unlinked.length === 1 && v.unlinked[0].line === 9, "오류 2건 연결, 1건 분류 불가");
  assert(v.worklist.length === 3 && v.worklist[0].errors === 1 && v.worklist.filter((w) => w.errors === 0).length === 1 && v.worklist.every((w) => w.item.action === "manual" || w.errors > 0), "작업 목록: 연결된 항목 + 오류 없는 수동 항목(parent 권고)");
  const vmd = renderMigrationVerifyMarkdown(v);
  assert(vmd.includes("## 작업 목록 (오류 해결 수 순)") && vmd.includes("## 분류되지 않은 오류 (1)") && vmd.includes("';' expected") && !vmd.includes("자동 항목이 남아 있습니다"), `검증 Markdown (auto ${v.summary.auto}: 경고 없음)`);
  write(vproj, "src/main/java/a/Auto.java", "import javax.servlet.http.HttpServletRequest;\nclass Auto {}\n");
  const vAuto = await verifyMigration({ projectDir: vproj, runner, platform: "linux" });
  assert(vAuto.summary.auto === 1 && renderMigrationVerifyMarkdown(vAuto).includes("자동 항목이 남아 있습니다"), "자동 항목이 남아 있으면 적용 먼저 하라는 경고");
  const okRunner = async () => ({ exitCode: 0, timedOut: false });
  const v2 = await verifyMigration({ projectDir: vproj, runner: okRunner, platform: "linux" });
  assert(v2.build.success === true && v2.links.length === 0 && v2.worklist.length === v2.summary.manual, "컴파일 통과 시 작업 목록은 수동 항목만");
  const nobuild = mkdtempSync(path.join(tmpdir(), "egovmignb-"));
  const v3 = await verifyMigration({ projectDir: nobuild, runner: okRunner });
  assert(v3.build.ran === false && v3.build.reason.includes("빌드 파일") && v3.worklist.length === 0, "빌드 파일 없으면 검증 건너뜀");
  assert(JSON.parse(JSON.stringify(v)).links[0].error.file.length > 0, "JSON 직렬화");
  rmSync(vproj, { recursive: true, force: true }); rmSync(nobuild, { recursive: true, force: true });
}
rmSync(comp, { recursive: true, force: true });

rmSync(legacy, { recursive: true, force: true });
rmSync(modern, { recursive: true, force: true });
if (process.exitCode) console.error(`migrate FAIL (${n} assertions)`); else console.log(`migrate OK (${n} assertions)`);
