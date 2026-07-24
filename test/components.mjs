// M2 통합 테스트 — 실제 공통컴포넌트 저장소를 내려받아 조립 (네트워크 필요)
import { addComponents, removeComponents, validateProject, readManifest, MANIFEST_FILE } from "../dist/index.js";
import assert from "node:assert/strict";
import * as fs from "node:fs";

const proj = "/tmp/scaffold-comp-test";
fs.rmSync(proj, { recursive: true, force: true });
fs.mkdirSync(proj, { recursive: true });

// 1) 실제 조립: bbs + login + security (+의존 cmm), mysql 스크립트·실행 자산 포함
const r = await addComponents({ projectDir: proj, components: ["bbs", "login", "sec.security"], database: "mysql" });
console.log("order:", r.installOrder.map((c) => c.id).join(","));
console.log("copied total:", r.totalFiles, "| by:", r.installOrder.map((c) => `${c.id}=${c.files}`).join(" "));
assert.ok(fs.existsSync(proj + "/src/main/java/egovframework/com/cop/bbs/service/Board.java"), "bbs Java 소스를 복사해야 한다");
assert.ok(
  fs.existsSync(proj + "/src/main/resources/egovframework/mapper/com/uat/uia/EgovLoginUsr_SQL_mysql.xml"),
  "login MyBatis 매퍼를 복사해야 한다",
);
assert.ok(
  fs.existsSync(proj + "/src/main/webapp/WEB-INF/jsp/egovframework/com/cop/bbs/EgovArticleList.jsp"),
  "bbs JSP를 복사해야 한다",
);
assert.ok(
  fs.existsSync(proj + "/src/main/resources/egovframework/message/com/cop/bbs/message_ko.properties"),
  "bbs 메시지 번들을 복사해야 한다",
);
assert.ok(
  fs.existsSync(proj + "/src/main/resources/egovframework/spring/com/idgn/context-idgn-bbs.xml"),
  "bbs ID 생성 설정을 복사해야 한다",
);
assert.ok(
  fs.existsSync(proj + "/src/main/webapp/images/egovframework/com/cop/bbs/icon_write.png"),
  "bbs 웹 자산을 복사해야 한다",
);
assert.ok(
  fs.existsSync(proj + "/src/main/webapp/WEB-INF/jsp/egovframework/com/EgovMainView.jsp"),
  "공통 웹 프래그먼트를 복사해야 한다",
);
assert.ok(
  fs.existsSync(proj + "/src/main/java/egovframework/com/sec/security/filter/EgovCsrfSecurityConfig.java"),
  "security 소스를 복사해야 한다",
);
assert.ok(r.sourceVerification?.sha256 && r.sourceVerification.files > 6000, "공식 아카이브를 검증해야 한다");
assert.ok(
  r.assets.messageBundles > 0 && r.assets.idgnContexts > 0 && r.assets.webAssets > 0 && r.assets.webFragments > 0,
  "실행 자산 요약에 모든 범주가 있어야 한다",
);
assert.ok(
  r.mavenDependencies.includes("org.egovframe.rte:egovframe-rte-fdl-security"),
  "security Maven 의존성을 탐지해야 한다",
);
assert.ok(
  r.sqlScripts.length > 0 && fs.existsSync(proj + "/scripts/egovframe-components/mysql/ddl/bbs.sql"),
  "선택한 DB의 bbs SQL만 복사해야 한다",
);
const bbsDdl = fs.readFileSync(proj + "/scripts/egovframe-components/mysql/ddl/bbs.sql", "utf8");
assert.ok(/CREATE TABLE COMTNBBS\b/.test(bbsDdl) && bbsDdl.includes("COMTNBBSMASTER"), "bbs DDL에 필수 테이블이 있어야 한다");
assert.ok(
  !fs.existsSync(proj + "/scripts/egovframe-components/mysql/ddl/com_DDL_mysql.sql"),
  "통합 SQL fallback을 복사하면 안 된다",
);
assert.equal(r.sourceVerification.sha256.length, 64);

// 2) 충돌 시 전체 거부 (재실행 → 기존 파일 존재)
await assert.rejects(() => addComponents({ projectDir: proj, components: ["bbs"] }), "기존 파일 충돌 시 전체 조립을 거부해야 한다");

// 3) 없는 프로젝트 디렉터리 거부
await assert.rejects(
  () => addComponents({ projectDir: "/tmp/no-such-dir-xyz", components: ["bbs"] }),
  "존재하지 않는 프로젝트 디렉터리를 거부해야 한다",
);

// 4) 매니페스트 기록 (v0.5.0)
const mf = readManifest(proj);
assert.ok(mf !== null, "조립 매니페스트를 기록해야 한다");
assert.deepEqual(Object.keys(mf.components).sort(), ["bbs", "cmm", "login", "sec.security"], "설치 컴포넌트를 기록해야 한다");
assert.ok(
  mf.schemaVersion === 3 &&
    mf.source.tag === "v5.0.6" &&
    mf.source.commit === "23d01889e01fcfa486d28d7a2ec4adb51fbaf3ad",
  "매니페스트에 공식 소스 provenance를 기록해야 한다",
);
assert.ok(mf.components.bbs.files.length >= 88, "bbs 설치 파일 목록을 기록해야 한다");
assert.equal(
  Object.keys(mf.components.bbs.hashes ?? {}).length,
  mf.components.bbs.files.length + mf.components.bbs.sqlScripts.length,
  "bbs 소스·실행 자산·SQL의 설치 hash를 모두 기록해야 한다",
);

// 5) 중복 설치 거부 (매니페스트 기준)
await assert.rejects(() => addComponents({ projectDir: proj, components: ["bbs"] }), "매니페스트 기준 중복 설치를 거부해야 한다");

// 6) 검증: 정상
let v = await validateProject({ projectDir: proj });
assert.ok(v.ok === true && v.manifestFound && v.components.length === 4, "정상 설치 검증을 통과해야 한다");

// 7) 검증: 파일 누락 감지
fs.rmSync(proj + "/src/main/java/egovframework/com/cop/bbs/service/Board.java");
v = await validateProject({ projectDir: proj });
assert.ok(
  v.ok === false && v.components.find((c) => c.id === "bbs")?.missing === 1,
  "누락 파일을 탐지해야 한다",
);

// 8) 의존 컴포넌트 제거 거부 (cmm은 bbs·login이 의존)
await assert.rejects(() => removeComponents({ projectDir: proj, components: ["cmm"] }), "사용 중인 의존 컴포넌트 제거를 거부해야 한다");

// 9) 제거 dryRun → 실제 제거 → 매니페스트 갱신
const rd = await removeComponents({ projectDir: proj, components: ["login"], dryRun: true });
assert.ok(
  rd.dryRun &&
    !rd.blocked &&
    rd.summary.modified === 0 &&
    rd.summary.unverified === 0 &&
    rd.totalFiles >= 31 &&
    fs.existsSync(proj + "/src/main/java/egovframework/com/uat/uia/service/EgovLoginService.java"),
  "제거 dryRun은 파일을 유지하며 대상을 계산해야 한다",
);
const rr = await removeComponents({ projectDir: proj, components: ["login"] });
assert.ok(
  rr.totalFiles >= 31 &&
    !fs.existsSync(proj + "/src/main/java/egovframework/com/uat/uia") &&
    readManifest(proj).components.login === undefined,
  "login 파일과 매니페스트 항목을 제거해야 한다",
);
assert.ok(!fs.existsSync(proj + "/scripts/egovframe-components/mysql/ddl/login.sql"), "login SQL을 제거해야 한다");

// 10) 전체 제거 시 매니페스트 삭제
await removeComponents({ projectDir: proj, components: ["bbs", "sec.security", "cmm"] });
assert.ok(!fs.existsSync(proj + "/" + MANIFEST_FILE), "전체 제거 후 매니페스트를 삭제해야 한다");
console.log("components OK");
