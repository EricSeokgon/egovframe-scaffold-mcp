// M2 통합 테스트 — 실제 공통컴포넌트 저장소를 내려받아 조립 (네트워크 필요)
import { addComponents } from "../dist/index.js";
import * as fs from "node:fs";

const proj = "/tmp/scaffold-comp-test";
fs.rmSync(proj, { recursive: true, force: true });
fs.mkdirSync(proj, { recursive: true });

// 1) 실제 조립: bbs + login (+의존 cmm), mysql 스크립트 포함
const r = await addComponents({ projectDir: proj, components: ["bbs", "login"], database: "mysql" });
console.log("order:", r.installOrder.map((c) => c.id).join(","));
console.log("copied total:", r.totalFiles, "| by:", r.installOrder.map((c) => `${c.id}=${c.files}`).join(" "));
console.log("java copied:", fs.existsSync(proj + "/src/main/java/egovframework/com/cop/bbs/service/Board.java"));
console.log("mapper copied:", fs.existsSync(proj + "/src/main/resources/egovframework/mapper/com/uat/uia/EgovLoginUsr_SQL_mysql.xml"));
console.log("jsp copied:", fs.existsSync(proj + "/src/main/webapp/WEB-INF/jsp/egovframework/com/cop/bbs/EgovArticleList.jsp"));
console.log("sql copied:", r.sqlScripts.length > 0 && fs.existsSync(proj + "/scripts/egovframe-components/mysql/ddl/com_DDL_mysql.sql"));

// 2) 충돌 시 전체 거부 (재실행 → 기존 파일 존재)
try { await addComponents({ projectDir: proj, components: ["bbs"] }); console.log("conflict-guard: FAIL"); }
catch (e) { console.log("conflict-guard: OK (", String(e.message).split("\n")[0], ")"); }

// 3) 없는 프로젝트 디렉터리 거부
try { await addComponents({ projectDir: "/tmp/no-such-dir-xyz", components: ["bbs"] }); console.log("dir-guard: FAIL"); }
catch { console.log("dir-guard: OK"); }
