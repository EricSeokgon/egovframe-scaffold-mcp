// 응답 영문화(v1.2) 검증용 고정 프로젝트 — 3.x 레거시(전환 진단·의존성)와 5.x 프로젝트(평가서·최신 유지·보안약점·배포·SBOM 점검)
//   test/i18n.mjs 가 ko 출력을 goldens 와 바이트 비교하고 en 출력에 한글이 없는지 본다. 바꾸면 goldens 도 다시 만들어야 한다(npm run i18n:golden).
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };

export function makeLegacy(dir) {
  write(dir, "pom.xml", `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>egovframework</groupId><artifactId>legacy</artifactId><version>1.0</version><packaging>war</packaging>
  <properties>
    <spring.maven.artifact.version>4.3.25.RELEASE</spring.maven.artifact.version>
    <egovframework.rte.version>3.10.0</egovframework.rte.version>
    <java.version>1.8</java.version>
  </properties>
  <repositories>
    <repository><id>egovframe</id><url>http://maven.egovframe.go.kr/maven/</url></repository>
  </repositories>
  <dependencies>
    <dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.ptl.mvc</artifactId><version>\${egovframework.rte.version}</version></dependency>
    <dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.psl.dataaccess</artifactId><version>3.10.0</version></dependency>
    <dependency><groupId>egovframework.rte</groupId><artifactId>spring-modules-validation</artifactId><version>0.9</version></dependency>
    <dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>3.1.0</version><scope>provided</scope></dependency>
    <dependency><groupId>javax.servlet</groupId><artifactId>jstl</artifactId><version>1.2</version></dependency>
    <dependency><groupId>commons-dbcp</groupId><artifactId>commons-dbcp</artifactId><version>1.4</version></dependency>
    <dependency><groupId>log4j</groupId><artifactId>log4j</artifactId><version>1.2.17</version></dependency>
    <dependency><groupId>org.hibernate</groupId><artifactId>hibernate-validator</artifactId><version>5.4.3.Final</version></dependency>
    <dependency><groupId>org.mybatis</groupId><artifactId>mybatis</artifactId><version>3.5.6</version></dependency>
    <dependency><groupId>org.apache.tiles</groupId><artifactId>tiles-jsp</artifactId><version>3.0.8</version></dependency>
  </dependencies>
  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId>
    <configuration><source>\${java.version}</source><target>1.8</target></configuration></plugin></plugins></build>
</project>
`);
  write(dir, "src/main/java/egovframework/example/sample/service/impl/SampleServiceImpl.java", `package egovframework.example.sample.service.impl;

import javax.annotation.Resource;
import egovframework.rte.fdl.cmmn.EgovAbstractServiceImpl;
import egovframework.rte.fdl.idgnr.EgovIdGnrService;
import egovframework.rte.fdl.cryptography.EgovPasswordEncoder;
import egovframework.rte.psl.dataaccess.util.EgovMap;

public class SampleServiceImpl extends EgovAbstractServiceImpl {
  @Resource(name = "egovIdGnrService") private EgovIdGnrService idgen;
}
`);
  write(dir, "src/main/java/egovframework/example/web/SampleController.java", `package egovframework.example.web;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import egovframework.rte.ptl.mvc.bind.annotation.CommandMap;
import egovframework.rte.ptl.mvc.tags.ui.pagination.PaginationInfo;
import egovframework.rte.fdl.cmmn.NoSuchClassXyz;

public class SampleController {}
`);
  write(dir, "src/main/java/egovframework/com/cmm/EgovComUtil.java", "package egovframework.com.cmm;\nimport egovframework.com.utl.sys.fsm.service.FileSystemUtils;\nclass EgovComUtil {}\n");
  write(dir, "src/main/resources/egovframework/spring/context-common.xml", `<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans"
  xmlns:egov-security="http://maven.egovframe.go.kr/schema/egov-security"
  xsi:schemaLocation="http://maven.egovframe.go.kr/schema/egov-security http://maven.egovframe.go.kr/schema/egov-security/egov-security-3.10.0.xsd">
  <bean id="leaveaTrace" class="egovframework.rte.fdl.cmmn.trace.LeaveaTrace"/>
  <bean class="egovframework.rte.psl.dataaccess.mapper.MapperConfigurer"/>
  <egov-security:config id="securityConfig" loginUrl="/login.do"/>
</beans>
`);
  write(dir, "src/main/webapp/WEB-INF/web.xml", `<?xml version="1.0" encoding="UTF-8"?>
<web-app id="WebApp_ID" version="3.1" xmlns="http://xmlns.jcp.org/xml/ns/javaee">
  <filter><filter-name>HTMLTagFilter</filter-name><filter-class>egovframework.rte.ptl.mvc.filter.HTMLTagFilter</filter-class></filter>
</web-app>
`);
  write(dir, "src/main/webapp/WEB-INF/jsp/sample.jsp", `<%@ page import="java.util.*, javax.servlet.http.HttpSession" %>\n<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core"%>\n<html><body>\${param.q}</body></html>\n`);
  return dir;
}

export function makeModern(dir) {
  write(dir, "pom.xml", `<project><modelVersion>4.0.0</modelVersion><groupId>egovframework.example</groupId><artifactId>modern</artifactId><version>1.2.3</version><packaging>war</packaging><name>modern</name><organization><name>Example Agency</name></organization>
<parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.0</version></parent>
<properties><spring.version>6.2.10</spring.version></properties>
<dependencies>
  <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-mvc</artifactId></dependency>
  <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-fdl-crypto</artifactId><version>5.0.0</version></dependency>
  <dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId><version>6.2.11</version></dependency>
  <dependency><groupId>commons-io</groupId><artifactId>commons-io</artifactId><version>2.11.0</version></dependency>
  <dependency><groupId>org.hsqldb</groupId><artifactId>hsqldb</artifactId><version>2.5.1</version></dependency>
</dependencies></project>`);
  write(dir, "src/main/java/egovframework/example/A.java", `package egovframework.example;
import org.egovframe.rte.fdl.security.config.internal.ErrorIfMaximumExceededFactoryBean;
public class A {
  void a(javax.servlet.http.HttpServletRequest req) {
    try { Runtime.getRuntime().exec("ls " + req.getParameter("f")); } catch (Exception e) { e.printStackTrace(); }
  }
}
`);
  write(dir, "src/main/webapp/WEB-INF/web.xml", "<web-app version=\"6.0\"/>");
  write(dir, "src/main/webapp/WEB-INF/jsp/x.jsp", "<%= request.getParameter(\"q\") %>\n");
  write(dir, "src/main/resources/egovframework/egovProps/globals.properties", "Globals.DbType=mysql\nGlobals.mysql.Url=jdbc:mysql://localhost:3306/com\nGlobals.mysql.UserName=com\nGlobals.mysql.Password=com01\n");
  mkdirSync(path.join(dir, "sbom"), { recursive: true });
  copyFileSync(path.join(here, "sbom-egov-web-plugin.cdx.json"), path.join(dir, "sbom", "bom.cdx.json"));
  return dir;
}
