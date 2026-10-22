// node test/update.mjs — 5.x 안의 갱신(migrate_egovframe_project target=5.0.x, v0.46) 게이트 (오프라인, 플랫폼 중립)
//   규칙 데이터 정합 · pom/gradle 계획(순수 함수) · 변경 클래스 참조 탐지 · 진단(구간·전환 대상 구분) · dryRun 무기록 · 적용·백업·재진단 ·
//   fault-injection 롤백 · 검증(가짜 runner) · create alignParent(alignPom) · 평가서 2절 · MCP tools/call(outputSchema 검증 포함)
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadUpdateRules, isUpdateTarget, planPomUpdate, planGradleUpdate, findClassReference, updateProject, applyUpdate, verifyUpdate, renderUpdateMarkdown,
  alignPom, assessProject, OUTPUT_SCHEMAS,
} from "../dist/index.js";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
const root = mkdtempSync(path.join(tmpdir(), "egovupdate-"));

try {
  // ── 규칙 데이터 ─────────────────────────────────────
  const rules = loadUpdateRules();
  // v1.3: 5.1.0 은 GitHub 태그 없이 저장소에 배포된 버전 — latest 지만 기본 목표(recommended)는 5.0.2
  assert(rules.versions.join(",") === "5.0.0,5.0.1,5.0.2,5.1.0" && rules.latest === "5.1.0" && rules.recommended === "5.0.2", `버전 목록 ${rules.versions.join("·")} · 최신 ${rules.latest} · 기본 ${rules.recommended}`);
  const ms = rules.source.mavenSteps?.[0];
  assert(rules.provisional?.length === 1 && rules.provisional[0].version === "5.1.0" && rules.provisional[0].kind === "maven-sources" && ms?.from === "5.0.2" && /^[0-9a-f]{64}$/.test(ms.bom.sha256) && ms.modules.length >= 25 && ms.modules.every((x) => /^[0-9a-f]{64}$/.test(x.to.sha256) && (x.from === null || /^[0-9a-f]{64}$/.test(x.from.sha256))), `5.1.0 근거: 저장소 sources jar ${ms?.modules.length}종(sha256 고정, 새 모듈 ${ms?.modules.filter((x) => x.from === null).length})`);
  assert(rules.stepClassCounts["5.1.0"] > 100 && ms.modules.filter((x) => x.from === null).map((x) => x.artifactId).sort().join(",") === "egovframe-rte-ai-core,egovframe-rte-ai-langchain4j,egovframe-rte-ai-springai", "5.1.0 단계: 새 AI 모듈 3종 포함");
  assert(rules.source.tags.length === 3 && rules.source.tags.every((t) => /^v5\.0\.\d+-Final$/.test(t.tag) && /^[0-9a-f]{40}$/.test(t.commit)), "근거 태그·commit 고정");
  assert(rules.parents.length === 2 && rules.parents.every((p) => rules.versions.every((v) => p.versions[v]?.properties["egovframe.rte.version"] === v)), "공식 parent 2종 × 4버전: egovframe.rte.version 이 parent 버전과 같음");
  assert(rules.parents.find((p) => p.kind === "boot").versions["5.1.0"].bootParent === "3.5.16", "boot parent 5.1.0 → Spring Boot 3.5.16");
  assert(rules.parents.find((p) => p.kind === "boot").versions["5.0.2"].bootParent === "3.5.6", "boot parent 5.0.2 → Spring Boot 3.5.6");
  assert(rules.changes.length >= 10 && rules.changes.every((c) => c.action === "manual" && rules.versions.slice(1).includes(c.since) && c.classes.length && c.reason.length > 30 && (c.since === "5.1.0" ? c.evidence.kind === "maven-sources" && c.evidence.to === "5.1.0" : c.evidence.toTag === `v${c.since}-Final`)), `변경 ${rules.changes.length}건: since·클래스·사유·근거(태그 또는 sources jar)`);
  assert(new Set(rules.changes.map((c) => c.id)).size === rules.changes.length, "변경 id 중복 없음");
  assert(isUpdateTarget("5.0.2") && isUpdateTarget("5.0.1") && isUpdateTarget("5.1.0") && !isUpdateTarget("5.x") && !isUpdateTarget(undefined) && !isUpdateTarget("4.3.0"), "isUpdateTarget: 5.y.z(5.x·4.x 제외)");

  // ── pom 계획(순수) ──────────────────────────────────
  const webPom = `<project>\n  <parent>\n    <groupId>org.egovframe.web</groupId>\n    <artifactId>egovframe-web-config-parent</artifactId>\n    <version>5.0.0</version>\n  </parent>\n  <properties>\n    <egovframe.rte.version>5.0.0</egovframe.rte.version>\n  </properties>\n  <dependencies>\n    <dependency>\n      <groupId>org.egovframe.rte</groupId>\n      <artifactId>egovframe-rte-fdl-cmmn</artifactId>\n      <version>5.0.1</version>\n    </dependency>\n    <dependency>\n      <groupId>org.egovframe.rte</groupId>\n      <artifactId>egovframe-rte-ptl-mvc</artifactId>\n      <version>\${egovframe.rte.version}</version>\n    </dependency>\n    <dependency>\n      <groupId>org.example</groupId>\n      <artifactId>lib</artifactId>\n      <version>5.0.0</version>\n    </dependency>\n  </dependencies>\n</project>\n`;
  const p1 = planPomUpdate("pom.xml", webPom, "5.0.2");
  const kinds = p1.items.map((i) => i.kind).sort().join(",");
  assert(kinds === "parent-version,rte-version,rte-version", `pom 계획: parent·버전 속성·리터럴 RTE 의존성 (got ${kinds})`);
  assert(p1.parent?.kind === "web" && p1.parent.version === "5.0.0" && p1.effective === "5.0.0", "parent web 5.0.0 · 실효 버전은 속성(5.0.0)");
  assert(!p1.items.some((i) => i.from.includes("org.example") || i.from.includes("ptl-mvc")), "비 RTE 좌표·속성 참조(${…}) 의존성은 건드리지 않음");
  const parentItem = p1.items.find((i) => i.kind === "parent-version");
  assert(parentItem.line === 5 && webPom.slice(parentItem.edits[0].start, parentItem.edits[0].end) === "5.0.0", "parent 편집 오프셋이 <parent> 안의 <version>");
  const p1b = planPomUpdate("pom.xml", webPom, "5.0.1");
  assert(p1b.items.length === 2 && !p1b.items.some((i) => i.from.endsWith(":5.0.1")), "target 5.0.1: 이미 5.0.1 인 리터럴은 그대로");
  const latestPom = webPom.replace(/5\.0\.[01]/g, "5.0.2");
  assert(planPomUpdate("pom.xml", latestPom, "5.0.2").items.length === 0, "이미 최신이면 항목 없음");
  const bootPom = `<project><parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>5.0.1</version></parent></project>`;
  const p2 = planPomUpdate("pom.xml", bootPom, "5.0.2");
  assert(p2.parent?.kind === "boot" && p2.items.length === 1 && p2.effective === "5.0.1", "boot parent 5.0.1 → 5.0.2, 실효 버전은 parent");
  const otherParent = `<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.5.6</version></parent></project>`;
  assert(planPomUpdate("pom.xml", otherParent, "5.0.2").parent === null, "egov parent 가 아니면 parent 없음");
  // parent 관리 속성: 예전 parent 의 기본값 그대로 덮어쓴 것만 auto (합성 규칙)
  const synth = JSON.parse(JSON.stringify(rules));
  const wp = synth.parents.find((p) => p.kind === "web");
  wp.versions["5.0.0"].properties["spring.version"] = "6.2.10";
  wp.versions["5.0.2"].properties["spring.version"] = "6.2.11";
  const overridePom = webPom.replace("<properties>", "<properties>\n    <spring.version>6.2.10</spring.version>\n    <jackson.version>9.9.9</jackson.version>");
  const p3 = planPomUpdate("pom.xml", overridePom, "5.0.2", synth);
  const prop = p3.items.find((i) => i.kind === "parent-property");
  assert(prop && prop.to === "<spring.version>6.2.11</spring.version>" && p3.items.filter((i) => i.kind === "parent-property").length === 1, "parent-property: 예전 기본값(6.2.10) 그대로면 새 기본값으로, 의도한 값은 그대로");
  const intentional = planPomUpdate("pom.xml", overridePom.replace("6.2.10", "6.2.9"), "5.0.2", synth);
  assert(!intentional.items.some((i) => i.kind === "parent-property"), "parent-property: 예전 기본값과 다른 고정값은 건드리지 않음");

  // ── gradle ─────────────────────────────────────────
  const g = planGradleUpdate("build.gradle", `dependencies {\n  implementation 'org.egovframe.rte:egovframe-rte-fdl-cmmn:5.0.0'\n  implementation "org.egovframe.rte:egovframe-rte-ptl-mvc:5.0.2"\n}\n`, "5.0.2");
  assert(g.items.length === 1 && g.effective === "5.0.0" && g.items[0].line === 2, "gradle: 5.0.0 리터럴 1건, 실효 5.0.0");

  // ── 클래스 참조 탐지 ────────────────────────────────
  const F = "org.egovframe.rte.fdl.string.EgovStringUtil";
  assert(findClassReference(`a\nimport ${F};\nclass X {}`, F) === 2, "import FQN");
  assert(findClassReference(`<bean class="org.egovframe.rte.ptl.mvc.filter.HTMLTagFilter"/>`, "org.egovframe.rte.ptl.mvc.filter.HTMLTagFilter") === 1, "XML class 속성 FQN");
  assert(findClassReference(`import ${F}Ext;\n`, F) === null, "접두어만 같은 다른 클래스는 아님");
  assert(findClassReference(`import org.egovframe.rte.fdl.string.*;\n\nclass X { void f() { EgovStringUtil.isEmpty(""); } }`, F) === 3, "와일드카드 import + 단순 이름");
  assert(findClassReference(`import org.egovframe.rte.fdl.string.*;\nclass X {}`, F) === null, "와일드카드 import 만 있고 사용 없으면 아님");

  // ── 진단 ───────────────────────────────────────────
  const web = path.join(root, "web");
  write(web, "pom.xml", webPom);
  write(web, "src/main/java/egovframework/example/A.java", `package egovframework.example;\nimport org.egovframe.rte.fdl.string.EgovStringUtil;\nimport org.egovframe.rte.fdl.excel.util.AbstractExcelView;\nclass A {}\n`);
  write(web, "src/main/resources/egovframework/spring/context-idgen.xml", `<beans>\n<bean class="org.egovframe.rte.fdl.idgnr.impl.EgovTableIdGnrServiceImpl"/>\n</beans>\n`);
  write(web, "src/main/webapp/WEB-INF/web.xml", `<web-app><filter><filter-class>org.egovframe.rte.ptl.mvc.filter.HTMLTagFilter</filter-class></filter></web-app>\n`);
  const r = updateProject({ projectDir: web });
  assert(r.target === "5.0.2" && r.update.from === "5.0.0" && r.update.to === "5.0.2" && r.sourceEra === "5.x", `진단: ${r.update.from} → ${r.update.to}`);
  const ids = r.update.changes.map((c) => c.id).sort().join(",");
  assert(ids === "excel-formula-injection,html-tag-filter,idgnr-table-lock,string-util-tokens", `참조하는 변경 4건(got ${ids})`);
  assert(r.items.filter((i) => i.kind === "rte-change").length === 4 && r.items.filter((i) => i.kind === "rte-change").every((i) => i.action === "manual" && i.to === null && /^\[5\.0\.[12] (API|동작) 변경\]/.test(i.reason)), "rte-change: manual · 사유에 버전·종류");
  assert(r.items.find((i) => i.kind === "rte-change" && i.file === "src/main/java/egovframework/example/A.java")?.line === 2, "A.java 는 파일당 1건, 첫 참조 줄(2)");
  assert(r.update.unreferencedChanges === rules.changes.filter((c) => c.since !== "5.1.0").length - 4, `참조하지 않는 변경 ${r.update.unreferencedChanges}건 별도 집계(5.1.0 변경은 구간 밖)`);
  assert(r.notes.some((n) => n.includes("5.1.0") && n.includes("GitHub 태그 없음")), "기본 목표 5.0.2 — 저장소의 5.1.0 을 안내");
  // v1.3: target 5.1.0 — parent·RTE 를 5.1.0 으로, 5.1.0 변경도 구간에 들어가고 근거를 안내
  write(web, "src/main/java/egovframework/example/S.java", `package egovframework.example;
import org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl;
class S extends EgovAbstractServiceImpl {}
`);
  const r51 = updateProject({ projectDir: web, target: "5.1.0" });
  const ids51 = r51.update.changes.map((c) => c.id).sort().join(",");
  assert(r51.update.to === "5.1.0" && r51.items.some((i) => i.kind === "parent-version" && i.to.endsWith(":5.1.0") && i.reason.includes("GitHub 태그 없음")), "target 5.1.0: parent 5.1.0 (저장소 배포 안내)");
  assert(ids51.includes("excel-content-disposition") && ids51.includes("service-biz-exception-helpers") && ids51.includes("excel-formula-injection"), `target 5.1.0: 5.0.x + 5.1.0 변경 참조(${ids51})`);
  assert(r51.notes.some((n) => n.includes("sources jar")), "target 5.1.0: 근거가 저장소 sources jar 임을 알림");
  rmSync(path.join(web, "src/main/java/egovframework/example/S.java"));
  assert(r.summary.auto === 3 && r.summary.manual === 4, `요약 자동 ${r.summary.auto} · 수동 ${r.summary.manual}`);
  const r501 = updateProject({ projectDir: web, target: "5.0.1" });
  assert(r501.update.changes.every((c) => c.since === "5.0.1") && r501.update.changes.length === 2, "target 5.0.1: 5.0.1 변경만(엑셀 수식·ID 생성)");
  // from 5.0.1 이면 5.0.1 변경은 구간 밖
  const mid = path.join(root, "mid");
  write(mid, "pom.xml", bootPom);
  write(mid, "src/main/java/B.java", `import org.egovframe.rte.fdl.excel.util.AbstractExcelView;\nimport org.egovframe.rte.fdl.excel.impl.EgovExcelServiceImpl;\n`);
  const rm = updateProject({ projectDir: mid });
  assert(rm.update.from === "5.0.1" && rm.update.changes.map((c) => c.id).join(",") === "excel-batch-insert", "from 5.0.1: 5.0.1 변경(수식 주입)은 구간 밖, 5.0.2 변경(일괄 등록)만");
  let threw = null;
  try { updateProject({ projectDir: web, target: "5.0.9" }); } catch (e) { threw = e.message; }
  assert(threw && threw.includes("5.0.0·5.0.1·5.0.2·5.1.0"), "지원하지 않는 target 은 거부하고 지원 목록을 알림");
  // 3.x 프로젝트는 갱신이 아니라 전환
  const legacy = path.join(root, "legacy");
  write(legacy, "pom.xml", `<project><properties><egovframework.rte.version>3.10.0</egovframework.rte.version></properties><dependencies><dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.ptl.mvc</artifactId><version>\${egovframework.rte.version}</version></dependency></dependencies></project>`);
  const rl = updateProject({ projectDir: legacy });
  assert(rl.items.length === 0 && rl.notes.some((x) => x.includes('target="5.x"')) && rl.sourceEra === "3.x", "3.x 프로젝트: 항목 없이 target=5.x 전환 안내");
  const md = renderUpdateMarkdown(r);
  assert(md.includes("5.x 최신 유지 진단") && md.includes("RTE 5.0.0 → 5.0.2") && md.includes("[바뀐 RTE API·동작]") && md.includes("파일을 수정하지 않았습니다"), "Markdown 진단");

  // ── 적용 ───────────────────────────────────────────
  const before = readFileSync(path.join(web, "pom.xml"), "utf8");
  const dry = await applyUpdate({ projectDir: web });
  assert(dry.dryRun && dry.applied.items === 3 && dry.applied.files === 1 && readFileSync(path.join(web, "pom.xml"), "utf8") === before && !existsSync(path.join(web, "migration-backup")), "dryRun: 계획만(3항목·1파일), 디스크 무변경");
  let fault = null;
  try { await applyUpdate({ projectDir: web, dryRun: false, faultInjection: "after-files" }); } catch (e) { fault = e; }
  assert(fault && readFileSync(path.join(web, "pom.xml"), "utf8") === before && (!existsSync(path.join(web, "migration-backup")) || readdirSync(path.join(web, "migration-backup")).length === 0), "fault-injection: 롤백(pom 원본·백업 없음)");
  const ap = await applyUpdate({ projectDir: web, dryRun: false });
  const after = readFileSync(path.join(web, "pom.xml"), "utf8");
  assert(!ap.dryRun && ap.applied.edits === 3 && /<version>5\.0\.2<\/version>\s*<\/parent>/.test(after) && after.includes("<egovframe.rte.version>5.0.2</egovframe.rte.version>") && !after.includes("5.0.1</version>") && after.includes("<version>5.0.0</version>\n    </dependency>\n  </dependencies>"), "적용: parent·속성·리터럴만 5.0.2, 비 RTE 좌표 그대로");
  assert(ap.backupDir && readFileSync(path.join(ap.backupDir, "pom.xml"), "utf8") === before && JSON.parse(readFileSync(ap.planPath, "utf8")).mode === "update", "백업 원본 + update-plan.json(mode=update)");
  assert(ap.remaining && ap.remaining.auto === 0, `재진단 자동 ${ap.remaining?.auto}`);
  const again = updateProject({ projectDir: web });
  assert(again.update.from === "5.0.2" && again.summary.auto === 0 && again.summary.manual === 0, "적용 뒤: 최신 — 항목 없음(구간이 비어 바뀐 API 참조도 보고하지 않음)");

  // ── 검증(가짜 runner) ───────────────────────────────
  const vproj = path.join(root, "verify");
  write(vproj, "pom.xml", webPom);
  const aAbs = path.join(vproj, "src/main/java/A.java");
  write(vproj, "src/main/java/A.java", `import org.egovframe.rte.fdl.security.config.EgovSecurityConfiguration;\nclass A extends EgovSecurityConfiguration {\n  void f() { authenticationManager(null); }\n}\n`);
  const runner = async (_cmd, o) => { o.onData(`[ERROR] ${aAbs}:[3,14] method authenticationManager in class org.egovframe.rte.fdl.security.config.EgovSecurityConfiguration cannot be applied to given types;\n`); return { exitCode: 1, timedOut: false }; };
  const v = await verifyUpdate({ projectDir: vproj, runner, platform: "linux" });
  assert(v.mode === "verify" && v.build.ran && v.build.success === false && v.build.errors === 1, "verify: 컴파일 실패 1건");
  assert(v.worklist[0]?.errors === 1 && v.worklist[0].item.kind === "rte-change" && v.worklist[0].item.from.endsWith("EgovSecurityConfiguration"), "verify: 오류가 바뀐 API 항목(보안 설정 Bean)에 연결");
  const okRunner = async () => ({ exitCode: 0, timedOut: false });
  const v2 = await verifyUpdate({ projectDir: vproj, runner: okRunner, platform: "linux" });
  assert(v2.build.success === true && v2.links.length === 0, "verify: 통과");

  // ── create alignParent ──────────────────────────────
  const al = alignPom(webPom);
  assert(al.aligned.length === 3 && al.text.includes("<version>5.0.2</version>\n  </parent>") && planPomUpdate("pom.xml", al.text, "5.0.2").items.length === 0, "alignPom: 3곳을 최신으로, 다시 계획하면 0건");
  assert(alignPom(latestPom).aligned.length === 0 && alignPom(latestPom).text === latestPom, "alignPom: 최신이면 그대로");

  // ── 평가서 2절 ─────────────────────────────────────
  const asm = path.join(root, "assess");
  write(asm, "pom.xml", webPom.replace("<properties>\n    <egovframe.rte.version>5.0.0</egovframe.rte.version>\n  </properties>\n", ""));
  write(asm, "src/main/resources/egovframework/spring/context-idgen.xml", `<bean class="org.egovframe.rte.fdl.idgnr.impl.EgovTableIdGnrServiceImpl"/>\n`);
  const a = await assessProject({ projectDir: asm });
  assert(a.migration.update && a.migration.update.from === "5.0.0" && a.migration.update.auto === 2 && a.migration.update.changes.some((c) => c.id === "idgnr-table-lock"), `평가서: 5.x 최신 유지 요약(자동 ${a.migration.update?.auto} · 변경 ${a.migration.update?.changes.length})`);
  const { renderAssessmentMarkdown } = await import("../dist/index.js");
  assert(renderAssessmentMarkdown(a).includes('### 5.x 최신 유지 (`migrate_egovframe_project(target="5.0.2")`)'), "평가서 Markdown 2절에 5.x 최신 유지");
  const al3 = await assessProject({ projectDir: legacy });
  assert(al3.migration.update === undefined, "3.x 프로젝트 평가서에는 최신 유지 절 없음");

  // ── 구조화 출력 스키마 ──────────────────────────────
  const schema = OUTPUT_SCHEMAS.migrate_egovframe_project;
  const strip = (x) => ({ ...x, items: x.items.map(({ edits: _e, ...rest }) => rest) });
  for (const [label, value] of [["진단", r], ["dryRun", dry], ["적용", ap], ["검증", v]]) {
    const ok = schema.safeParse(strip(value)).success && Object.keys(value).every((k) => k in schema.shape);
    assert(ok, `outputSchema 통과: ${label}`);
  }

  // ── MCP tools/call (서버 경로 · SDK 의 outputSchema 검증) ─
  const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, EGOVFRAME_ALLOWED_ROOTS: "" } });
  const responses = new Map();
  let buf = "";
  child.stdout.on("data", (d) => { buf += d.toString(); let nl; while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (line) try { const m = JSON.parse(line); if (m.id !== undefined) responses.set(m.id, m); } catch { /* 로그 */ } } });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  const wait = async (id) => { for (let i = 0; i < 300 && !responses.has(id); i++) await new Promise((res) => setTimeout(res, 50)); return responses.get(id); };
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "update-test", version: "0" } } });
  await wait(1);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "migrate_egovframe_project", arguments: { projectDir: mid, target: "5.0.2", format: "json" } } });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "migrate_egovframe_project", arguments: { projectDir: mid, target: "6.0" } } });
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "migrate_egovframe_project", arguments: { projectDir: legacy } } });
  const c2 = await wait(2), c3 = await wait(3), c4 = await wait(4);
  child.kill();
  const sc = c2?.result?.structuredContent;
  assert(!c2?.result?.isError && sc?.target === "5.0.2" && sc.update?.from === "5.0.1" && sc.items.every((i) => !("edits" in i)), "tools/call target=5.0.2: 갱신 모드 structuredContent(편집 오프셋 제외)");
  assert(c3?.result?.isError || c3?.error, "tools/call target=6.0: 입력 검증 거부");
  assert(!c4?.result?.isError && c4?.result?.structuredContent?.target === "5.x" && c4.result.structuredContent.items.length > 0, "tools/call 기본 target=5.x: 기존 전환 진단 그대로");
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
// ── 중복 의존성 선언(v0.47: 공식 msa-common-components EgovQuestionnaire — CI 의 Maven 이 "must be unique" 오류로 거부) ──
{
  const { duplicateDependencyItems, applyTextEdits } = await import("../dist/index.js");
  const dep = (g, a, extra = "") => `        <dependency>\n            <groupId>${g}</groupId>\n            <artifactId>${a}</artifactId>${extra}\n        </dependency>\n`;
  const V = "\n            <version>$" + "{commons-lang3.version}</version>";
  const pom = `<project>\n    <dependencyManagement>\n        <dependencies>\n${dep("x", "managed")}${dep("x", "managed")}        </dependencies>\n    </dependencyManagement>\n    <dependencies>\n${dep("org.apache.commons", "commons-lang3", V)}${dep("a", "b")}        <!-- CVE 보완용 -->\n${dep("org.apache.commons", "commons-lang3", V)}${dep("a", "b", "\n            <scope>test</scope>")}${dep("a", "b", "\n            <classifier>tests</classifier>")}    </dependencies>\n    <build><plugins><plugin><dependencies>\n${dep("a", "b")}        </dependencies></plugin></plugins></build>\n</project>\n`;
  const items = duplicateDependencyItems("pom.xml", pom);
  assert(items.length === 2 && items[0].action === "auto" && /commons-lang3/.test(items[0].from) && items[1].action === "manual" && /a:b:jar/.test(items[1].from), `중복 선언: 같은 내용 auto 1·scope 다른 것 manual 1, classifier 다르면 별개·dependencyManagement·plugin 의존성 제외 (${items.map((i) => `${i.action} ${i.from}`).join(" / ")})`);
  const fixed = applyTextEdits(pom, items.filter((i) => i.action === "auto").flatMap((i) => i.edits)).text;
  assert((fixed.match(/<artifactId>commons-lang3</g) ?? []).length === 1 && fixed.includes("<!-- CVE 보완용 -->") && !/\n\s*\n\s*<dependency>/.test(fixed.split("<dependencies>")[2]) && duplicateDependencyItems("pom.xml", fixed).filter((i) => i.action === "auto").length === 0, "적용: 뒤 선언 블록과 그 줄만 지움(주석·다른 선언 유지, 빈 줄 없음), 다시 계획하면 auto 0");
}
if (process.exitCode) console.error(`update FAIL (${n} assertions)`); else console.log(`update OK (${n} assertions)`);
