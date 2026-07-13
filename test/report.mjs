// node test/report.mjs — 오프라인 리포트 생성 검증(diagnose 픽스처 재사용)
import { generateReport } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
function assert(c, m) { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); }

const root = mkdtempSync(path.join(tmpdir(), "egovrep-"));
writeFileSync(path.join(root, "pom.xml"),
  `<project><dependencies><dependency><groupId>org.egovframe.rte</groupId>` +
  `<artifactId>org.egovframe.rte.ptl.mvc</artifactId><version>4.3.0</version></dependency></dependencies></project>`);
mkdirSync(path.join(root, "src/main/resources"), { recursive: true });
writeFileSync(path.join(root, "src/main/resources/application.properties"), "Globals.DbType=mysql\n");
for (const p of ["src/main/java/egovframework/com/cmm", "src/main/java/egovframework/com/cop/bbs"]) {
  mkdirSync(path.join(root, p), { recursive: true });
  writeFileSync(path.join(root, p, "P.java"), "class P {}");
}

const md = generateReport({ projectDir: root });
assert(md.includes("# eGovFrame 프로젝트 리포트"), "제목");
assert(md.includes("## 설치 공통컴포넌트 (2)"), "컴포넌트 2건");
assert(md.includes("bbs") && md.includes("게시판"), "bbs·게시판 포함");
assert(md.includes("## 참조 테이블"), "테이블 섹션");
assert(md.includes("egovframe-docs/blob/main/"), "가이드 문서 링크");
assert(md.includes("Globals.DbType") === false, "본문에 원문설정 노출 안함(요약만)");

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error("report FAIL"); else console.log("report OK");
