// node test/agents-md.mjs — AGENTS.md 생성 (오프라인 픽스처)
import { collectAgentsFacts, renderAgentsMd, generateAgentsMd } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };

// ── 5.x 프로젝트(매니페스트·래퍼·컴포넌트) ───────────────
const root = mkdtempSync(path.join(tmpdir(), "egovagents-"));
write(root, "pom.xml", `<project><parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.1</version></parent>
<dependencies><dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-mvc</artifactId><version>5.0.2</version></dependency></dependencies></project>`);
write(root, "mvnw", "#!/bin/sh\n"); write(root, "mvnw.cmd", "@echo off\n");
write(root, "src/main/resources/application.properties", "Globals.DbType=mysql\n");
write(root, "src/main/java/egovframework/com/cmm/Placeholder.java", "class Placeholder {}");
write(root, "src/main/java/egovframework/com/cop/bbs/Placeholder.java", "class Placeholder {}");
write(root, "src/main/java/kr/go/sample/App.java", "class App {}");
write(root, "src/main/resources/egovframework/spring/context-common.xml", "<beans/>");
write(root, "src/main/webapp/WEB-INF/jsp/index.jsp", "<html/>");
write(root, ".egovframe-components.json", JSON.stringify({ schemaVersion: 3, source: {}, components: { cmm: { installedAt: "x", files: [], sqlScripts: [] } } }));
mkdirSync(path.join(root, "upgrade-backup"), { recursive: true });

const facts = collectAgentsFacts(root);
// 래퍼 명령은 플랫폼에 따라 ./mvnw(POSIX) 또는 mvnw.cmd(Windows)
assert(facts.buildSystem === "maven" && facts.wrapper === true && /^(\.\/mvnw|mvnw\.cmd) -B -e compile$/.test(facts.commands.compile) && facts.commands.package.includes("-DskipTests"), `maven + 래퍼 명령 (${facts.commands.compile})`);
assert(facts.rteVersion === "5.0.2" && facts.sourceEra === "5.x" && facts.parent === "org.egovframe.web:egovframe-web-config-parent:5.0.1" && facts.database === "mysql", "RTE·era·parent·DbType");
assert(JSON.stringify(facts.basePackages) === JSON.stringify(["egovframework.com", "kr.go"]), `기본 패키지 (${facts.basePackages})`);
assert(facts.components.map((c) => `${c.id}:${c.managed}`).sort().join() === "bbs:false,cmm:true", `컴포넌트·매니페스트 관리 여부 (${facts.components.map((c) => `${c.id}:${c.managed}`)})`);
assert(facts.configDirs.includes("src/main/resources/egovframework/spring") && facts.configDirs.includes("src/main/webapp/WEB-INF/jsp") && !facts.configDirs.includes("src/main/resources/egovframework/mapper"), "존재하는 설정 디렉터리만");
assert(facts.migration && facts.migration.auto === 0 && facts.migration.manual === 0 && facts.manifest && facts.backupDirs.join() === "upgrade-backup", "5.x 전환 0건, 매니페스트, 백업 디렉터리 감지");

const md = renderAgentsMd(facts, { projectName: "demo", lang: "ko", date: "2026-09-30" });
assert(md.startsWith("# AGENTS.md — demo") && md.includes("## 빌드·테스트 명령") && md.includes(`${facts.commands.compile}   # 컴파일`) && md.includes("| cmm |") && md.includes("매니페스트 관리") && md.includes("5.x 기준을 만족") && md.includes("upgrade-backup") && md.includes("_생성: 2026-09-30"), "한국어 렌더링");
assert(md.includes("`org.egovframe.rte.*`(실행환경)와 `jakarta.*` 네임스페이스만") , "5.x 프로젝트 규칙: jakarta 만 사용");
const en = renderAgentsMd(facts, { projectName: "demo", lang: "en", date: "2026-09-30" });
assert(en.includes("## Build and test commands") && en.includes("Already on the 5.x baseline") && en.includes("manifest-managed") && !en.includes("컴파일"), "영어 렌더링");

// 생성·거부·덮어쓰기·dryRun
const r1 = await generateAgentsMd({ projectDir: root, dryRun: true });
assert(r1.dryRun && !r1.written && !existsSync(path.join(root, "AGENTS.md")) && r1.content === renderAgentsMd(facts, { projectName: path.basename(root), lang: "ko", date: r1.content.match(/_생성: (\d{4}-\d{2}-\d{2})/)[1] }), "dryRun 무기록, 내용 동일");
const r2 = await generateAgentsMd({ projectDir: root });
assert(r2.written && !r2.overwritten && readFileSync(r2.filePath, "utf8") === r2.content && r2.fileName === "AGENTS.md", "AGENTS.md 생성");
let threw = false;
try { await generateAgentsMd({ projectDir: root }); } catch (e) { threw = /이미 있습니다/.test(e.message); }
assert(threw, "기존 파일 → overwrite 없이는 거부");
const r3 = await generateAgentsMd({ projectDir: root, overwrite: true, lang: "en" });
assert(r3.overwritten && readFileSync(r3.filePath, "utf8").includes("## Rules"), "overwrite=true 로 영어판 덮어쓰기");
const r4 = await generateAgentsMd({ projectDir: root, fileName: "CLAUDE.md" });
assert(r4.written && existsSync(path.join(root, "CLAUDE.md")), "파일명 변경(CLAUDE.md)");
for (const bad of ["../x.md", "a/b.md", "notes.txt", ""]) {
  let t = false;
  try { await generateAgentsMd({ projectDir: root, fileName: bad, dryRun: true }); } catch { t = true; }
  assert(t, `잘못된 파일명 거부: ${JSON.stringify(bad)}`);
}
assert(!readdirSync(root).some((f) => f.startsWith(".egovframe-write-txn")), "transaction staging 정리");

// ── 3.x 프로젝트(gradle, 컴포넌트 없음) ──────────────────
const legacy = mkdtempSync(path.join(tmpdir(), "egovagents3-"));
write(legacy, "build.gradle", "dependencies { implementation 'egovframework.rte:egovframework.rte.ptl.mvc:3.10.0' }\n");
write(legacy, "src/main/java/egovframework/example/App.java", "import javax.servlet.http.HttpServletRequest; class App {}");
const f3 = collectAgentsFacts(legacy);
assert(f3.buildSystem === "gradle" && f3.commands.compile.match(/gradle(\.bat)? --console=plain compileJava$/) && f3.sourceEra === "3.x" && f3.migration.auto >= 2 && f3.components.length === 0 && !f3.manifest, `gradle 3.x: era ${f3.sourceEra}, auto ${f3.migration.auto}`);
const md3 = renderAgentsMd(f3, { projectName: "legacy", lang: "ko" });
assert(md3.includes("5.x 전환 대상") && md3.includes("migrate_egovframe_project(apply=true)") && md3.includes("감지된 공통컴포넌트가 없습니다") && md3.includes("5.x 에도 있는 API"), "3.x 프로젝트 안내");

// 빈 디렉터리
const empty = mkdtempSync(path.join(tmpdir(), "egovagentsE-"));
const fe = collectAgentsFacts(empty);
assert(fe.buildSystem === "unknown" && fe.commands === null && renderAgentsMd(fe, { projectName: "e", lang: "ko" }).includes("빌드 파일(pom.xml·build.gradle)을 찾지 못했습니다"), "빌드 파일 없음");

for (const d of [root, legacy, empty]) rmSync(d, { recursive: true, force: true });
if (process.exitCode) console.error(`agents-md FAIL (${n} assertions)`); else console.log(`agents-md OK (${n} assertions)`);
