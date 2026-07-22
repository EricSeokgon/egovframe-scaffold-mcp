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
console.log("java copied:", fs.existsSync(proj + "/src/main/java/egovframework/com/cop/bbs/service/Board.java"));
console.log("mapper copied:", fs.existsSync(proj + "/src/main/resources/egovframework/mapper/com/uat/uia/EgovLoginUsr_SQL_mysql.xml"));
console.log("jsp copied:", fs.existsSync(proj + "/src/main/webapp/WEB-INF/jsp/egovframework/com/cop/bbs/EgovArticleList.jsp"));
console.log("message copied:", fs.existsSync(proj + "/src/main/resources/egovframework/message/com/cop/bbs/message_ko.properties"));
console.log("idgn copied:", fs.existsSync(proj + "/src/main/resources/egovframework/spring/com/idgn/context-idgn-bbs.xml"));
console.log("web asset copied:", fs.existsSync(proj + "/src/main/webapp/images/egovframework/com/cop/bbs/icon_write.png"));
console.log("web fragment copied:", fs.existsSync(proj + "/src/main/webapp/WEB-INF/jsp/egovframework/com/EgovMainView.jsp"));
console.log("security copied:", fs.existsSync(proj + "/src/main/java/egovframework/com/sec/security/filter/EgovCsrfSecurityConfig.java"));
console.log("archive verified:", r.sourceVerification?.sha256 && r.sourceVerification.files > 6000);
console.log("asset summary:", r.assets.messageBundles > 0 && r.assets.idgnContexts > 0 && r.assets.webAssets > 0 && r.assets.webFragments > 0);
console.log("maven deps detected:", r.mavenDependencies.includes("org.egovframe.rte:egovframe-rte-fdl-security"));
console.log("sql selective:", r.sqlScripts.length > 0 && fs.existsSync(proj + "/scripts/egovframe-components/mysql/ddl/bbs.sql"));
const bbsDdl = fs.readFileSync(proj + "/scripts/egovframe-components/mysql/ddl/bbs.sql", "utf8");
console.log("bbs ddl has COMTNBBS:", /CREATE TABLE COMTNBBS\b/.test(bbsDdl) && bbsDdl.includes("COMTNBBSMASTER"));
console.log("no integrated fallback:", !fs.existsSync(proj + "/scripts/egovframe-components/mysql/ddl/com_DDL_mysql.sql"));
assert.ok(fs.existsSync(proj + "/src/main/resources/egovframework/message/com/cop/bbs/message_ko.properties"));
assert.ok(fs.existsSync(proj + "/src/main/resources/egovframework/spring/com/idgn/context-idgn-bbs.xml"));
assert.ok(fs.existsSync(proj + "/src/main/webapp/images/egovframework/com/cop/bbs/icon_write.png"));
assert.ok(fs.existsSync(proj + "/src/main/java/egovframework/com/sec/security/filter/EgovCsrfSecurityConfig.java"));
assert.equal(r.sourceVerification.sha256.length, 64);
assert.ok(r.assets.messageBundles > 0 && r.assets.idgnContexts > 0 && r.assets.webAssets > 0 && r.assets.webFragments > 0);
assert.ok(r.mavenDependencies.includes("org.egovframe.rte:egovframe-rte-fdl-security"));
assert.ok(!fs.existsSync(proj + "/scripts/egovframe-components/mysql/ddl/com_DDL_mysql.sql"));

// 2) 충돌 시 전체 거부 (재실행 → 기존 파일 존재)
try { await addComponents({ projectDir: proj, components: ["bbs"] }); console.log("conflict-guard: FAIL"); }
catch (e) { console.log("conflict-guard: OK (", String(e.message).split("\n")[0], ")"); }

// 3) 없는 프로젝트 디렉터리 거부
try { await addComponents({ projectDir: "/tmp/no-such-dir-xyz", components: ["bbs"] }); console.log("dir-guard: FAIL"); }
catch { console.log("dir-guard: OK"); }

// 4) 매니페스트 기록 (v0.5.0)
const mf = readManifest(proj);
console.log("manifest written:", mf !== null && Object.keys(mf.components).sort().join(",") === "bbs,cmm,login,sec.security");
console.log("manifest v3 source:", mf.schemaVersion === 3 && mf.source.tag === "v5.0.6" && mf.source.commit === "23d01889e01fcfa486d28d7a2ec4adb51fbaf3ad");
console.log("manifest files:", mf.components.bbs.files.length >= 88);

// 5) 중복 설치 거부 (매니페스트 기준)
try { await addComponents({ projectDir: proj, components: ["bbs"] }); console.log("dup-install guard: FAIL"); }
catch (e) { console.log("dup-install guard: OK"); }

// 6) 검증: 정상
let v = await validateProject({ projectDir: proj });
console.log("validate ok:", v.ok === true && v.manifestFound && v.components.length === 4);

// 7) 검증: 파일 누락 감지
fs.rmSync(proj + "/src/main/java/egovframework/com/cop/bbs/service/Board.java");
v = await validateProject({ projectDir: proj });
console.log("validate detects missing:", v.ok === false && v.components.find((c) => c.id === "bbs").missing === 1);

// 8) 의존 컴포넌트 제거 거부 (cmm은 bbs·login이 의존)
try { await removeComponents({ projectDir: proj, components: ["cmm"] }); console.log("dep-guard: FAIL"); }
catch { console.log("dep-guard: OK"); }

// 9) 제거 dryRun → 실제 제거 → 매니페스트 갱신
const rd = await removeComponents({ projectDir: proj, components: ["login"], dryRun: true });
console.log("remove dryRun:", rd.dryRun && rd.totalFiles >= 31 && fs.existsSync(proj + "/src/main/java/egovframework/com/uat/uia/service/EgovLoginService.java"));
const rr = await removeComponents({ projectDir: proj, components: ["login"] });
console.log("remove real:", rr.totalFiles >= 31 && !fs.existsSync(proj + "/src/main/java/egovframework/com/uat/uia") && readManifest(proj).components.login === undefined);
console.log("login sql removed:", !fs.existsSync(proj + "/scripts/egovframe-components/mysql/ddl/login.sql"));

// 10) 전체 제거 시 매니페스트 삭제
await removeComponents({ projectDir: proj, components: ["bbs", "sec.security", "cmm"] });
console.log("manifest cleaned:", !fs.existsSync(proj + "/" + MANIFEST_FILE));
