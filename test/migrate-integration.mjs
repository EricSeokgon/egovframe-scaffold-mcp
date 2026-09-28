// node test/migrate-integration.mjs — 전환 적용 후 실제 컴파일 (네트워크·JDK 17·Maven 필요, CI integration 전용)
// 3.10 좌표·javax 를 쓰는 작은 Maven 프로젝트를 만들고, migrate_egovframe_project 2단계(apply)로 치환한 뒤
// JDK 17 로 `mvn compile` 이 통과하는지 확인한다. 치환 전 프로젝트는 Java 17 + Spring 6 환경에서 컴파일될 수 없으므로
// (javax.servlet / egovframework.rte 3.10 이 Spring 4 기준) 통과 자체가 좌표·패키지·Jakarta 치환의 정합성 증거다.
import { applyMigration, migrateProject } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };

const mavenCommand = process.env.MAVEN_CMD || (process.platform === "win32" ? "mvn.cmd" : "mvn");
const mavenArgs = ["-q", "-B", "-DskipTests", "compile"];
const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : mavenCommand;
const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", mavenCommand, ...mavenArgs] : mavenArgs;

const root = mkdtempSync(path.join(tmpdir(), "egov-migrate-compile-"));
write(root, "pom.xml", `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>egovframework.example</groupId>
  <artifactId>legacy-migrate-smoke</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
  <properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <egovframework.rte.version>3.10.0</egovframework.rte.version>
  </properties>
  <repositories>
    <repository>
      <id>egovframe</id>
      <url>http://maven.egovframe.go.kr/maven/</url>
      <releases><enabled>true</enabled></releases>
      <snapshots><enabled>false</enabled></snapshots>
    </repository>
  </repositories>
  <dependencies>
    <dependency>
      <groupId>egovframework.rte</groupId>
      <artifactId>egovframework.rte.fdl.cmmn</artifactId>
      <version>\${egovframework.rte.version}</version>
    </dependency>
    <dependency>
      <groupId>egovframework.rte</groupId>
      <artifactId>egovframework.rte.psl.dataaccess</artifactId>
      <version>\${egovframework.rte.version}</version>
    </dependency>
    <dependency>
      <groupId>egovframework.rte</groupId>
      <artifactId>egovframework.rte.ptl.mvc</artifactId>
      <version>\${egovframework.rte.version}</version>
    </dependency>
    <dependency>
      <groupId>javax.servlet</groupId>
      <artifactId>javax.servlet-api</artifactId>
      <version>3.1.0</version>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>javax.annotation</groupId>
      <artifactId>javax.annotation-api</artifactId>
      <version>1.3.2</version>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
        <configuration>
          <source>1.8</source>
          <target>1.8</target>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
`);
write(root, "src/main/java/egovframework/example/sample/service/SampleService.java", `package egovframework.example.sample.service;

import java.util.List;
import egovframework.rte.psl.dataaccess.util.EgovMap;

public interface SampleService {
  List<EgovMap> selectSampleList(String keyword) throws Exception;
}
`);
write(root, "src/main/java/egovframework/example/sample/service/impl/SampleServiceImpl.java", `package egovframework.example.sample.service.impl;

import java.util.ArrayList;
import java.util.List;
import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import egovframework.rte.fdl.cmmn.EgovAbstractServiceImpl;
import egovframework.rte.fdl.cmmn.exception.EgovBizException;
import egovframework.rte.psl.dataaccess.util.EgovMap;
import egovframework.rte.ptl.mvc.tags.ui.pagination.PaginationInfo;
import egovframework.example.sample.service.SampleService;
import org.springframework.stereotype.Service;

@Service("sampleService")
public class SampleServiceImpl extends EgovAbstractServiceImpl implements SampleService {

  @Resource(name = "sampleService")
  private SampleService self;

  @Override
  public List<EgovMap> selectSampleList(String keyword) throws Exception {
    if (keyword == null) throw new EgovBizException("keyword is required");
    List<EgovMap> list = new ArrayList<EgovMap>();
    EgovMap row = new EgovMap();
    row.put("keyword", keyword);
    list.add(row);
    return list;
  }

  public PaginationInfo paging(HttpServletRequest request) {
    PaginationInfo info = new PaginationInfo();
    info.setCurrentPageNo(request.getParameter("pageIndex") == null ? 1 : Integer.parseInt(request.getParameter("pageIndex")));
    info.setRecordCountPerPage(10);
    info.setPageSize(10);
    return info;
  }
}
`);

try {
  const before = migrateProject({ projectDir: root });
  assert(before.sourceEra === "3.x" && before.summary.auto >= 8, `치환 전 진단: 3.x, auto ${before.summary.auto}건`);
  assert(before.items.every((i) => i.action === "auto" || i.kind === "parent"), `픽스처는 auto 항목(+parent 권고)만 가진다 (manual: ${before.items.filter((i) => i.action === "manual").map((i) => i.kind).join(",")})`);

  const r = await applyMigration({ projectDir: root, dryRun: false });
  assert(r.applied.files === 3 && r.remaining?.auto === 0 && r.remaining?.manual === 1, `적용 파일 3개(pom·java 2), 재진단 auto 0·manual 1(parent 권고) (got files ${r.applied.files}, auto ${r.remaining?.auto}, manual ${r.remaining?.manual})`);
  const pom = readFileSync(path.join(root, "pom.xml"), "utf8");
  assert(pom.includes("<artifactId>egovframe-rte-fdl-cmmn</artifactId>") && pom.includes("<org.egovframe.rte.version>5.0.2</org.egovframe.rte.version>") && pom.includes("jakarta.servlet-api") && pom.includes("<source>17</source>"), "pom 치환 내용");
  assert(existsSync(r.backupDir) && existsSync(r.planPath), "백업 디렉터리·migration-plan.json");

  const compiled = spawnSync(executable, commandArgs, { cwd: root, encoding: "utf-8", timeout: 600_000 });
  if (compiled.error || compiled.status !== 0) {
    console.error(compiled.stdout || "", compiled.stderr || compiled.error || "");
  }
  assert(!compiled.error && compiled.status === 0, "치환된 프로젝트 JDK 17 `mvn compile` 통과");
  assert(existsSync(path.join(root, "target/classes/egovframework/example/sample/service/impl/SampleServiceImpl.class")), "SampleServiceImpl.class 생성");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`migrate-integration FAIL (${n} assertions)`); else console.log(`migrate-integration OK (${n} assertions)`);
