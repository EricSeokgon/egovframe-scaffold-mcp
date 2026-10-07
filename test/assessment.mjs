// node test/assessment.mjs — 전환 준비도 평가서(v0.37) 오프라인 검증: 등급 산식 재계산, 픽스처 3종(3.x·4.x·5.x), 리포트 조립·저장.
import { MIGRATION_RUBRIC, SUPPLY_CHAIN_RUBRIC, ERA_POINTS, REMOVED_API_KINDS, pointsFor, gradeFor, describeScale, computeGrade, groupManualItems, actionFor, assessProject, renderAssessmentMarkdown, generateProjectReport, generateReport, OUTPUT_SCHEMAS } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
async function rejects(fn, re, msg) { try { await fn(); assert(false, `${msg} (예외 없음)`); } catch (e) { assert(re.test(e.message), `${msg} (${e.message.slice(0, 80)})`); } }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };

// ── 산식(순수 함수) ───────────────────────────────────
assert(pointsFor([{ upTo: 0, points: 0 }, { upTo: 20, points: 1 }, { upTo: 100, points: 2 }, { upTo: null, points: 3 }], 0).points === 0, "구간 0 → 0점");
assert(pointsFor(MIGRATION_RUBRIC.factors[0].bands, 20).points === 1 && pointsFor(MIGRATION_RUBRIC.factors[0].bands, 21).points === 2 && pointsFor(MIGRATION_RUBRIC.factors[0].bands, 101).points === 3, "수동 항목 경계 20/21/101");
assert(pointsFor(MIGRATION_RUBRIC.factors[0].bands, 21).band === "21–100" && pointsFor(MIGRATION_RUBRIC.factors[0].bands, 500).band === "101+", "구간 표시 문자열");
assert(gradeFor(MIGRATION_RUBRIC, 0) === "A" && gradeFor(MIGRATION_RUBRIC, 3) === "B" && gradeFor(MIGRATION_RUBRIC, 4) === "C" && gradeFor(MIGRATION_RUBRIC, 7) === "C" && gradeFor(MIGRATION_RUBRIC, 8) === "D", "등급 경계 0/3/7");
assert(describeScale(SUPPLY_CHAIN_RUBRIC) === "A=0 · B≤3 · C≤7 · D>7", `등급 구간 설명 (${describeScale(SUPPLY_CHAIN_RUBRIC)})`);
const g = computeGrade(MIGRATION_RUBRIC, { manual: 30, reassemble: 2, removedApi: 0, era: ERA_POINTS["4.x"] });
assert(g.score === 4 && g.grade === "C" && g.max === 11 && g.factors.length === 4, `중간 사례: 수동 30·재조립 2·4.x → 4점 C (got ${g.score} ${g.grade})`);
assert(computeGrade(MIGRATION_RUBRIC, {}).grade === "A" && computeGrade(SUPPLY_CHAIN_RUBRIC, {}).grade === "A", "요인 전부 0 → A");
assert(computeGrade(SUPPLY_CHAIN_RUBRIC, { outdated: 100, legacyReplace: 100, vulnerabilities: 100, securityMissing: 5, platform: 2 }).score === 13, "공급망 최대 13점");
assert(ERA_POINTS["5.x"] === 0 && ERA_POINTS["3.x"] === 2 && REMOVED_API_KINDS.includes("component-class-removed"), "세대 점수·제거 API 종류");
assert(actionFor({ status: "outdated", baseline: "2.0", note: undefined }).includes("2.0 이상") && actionFor({ status: "replace", baseline: null, note: "제거됨" }).startsWith("제거") && actionFor({ status: "legacy", baseline: "a:b:5", note: "x" }).includes("a:b:5 로 전환"), "조치 문구");
const grouped = groupManualItems([
  { file: "a.xml", line: 1, kind: "class-removed", from: "X", to: null, action: "manual", reason: "r" },
  { file: "b.xml", line: 2, kind: "class-removed", from: "X", to: null, action: "manual", reason: "r" },
  { file: "a.xml", line: 3, kind: "library", from: "Y", to: "Z", action: "manual", reason: "r2" },
  { file: "a.xml", line: 4, kind: "package", from: "P", to: "Q", action: "auto", reason: "" },
], 1);
assert(grouped.groups === 2 && grouped.top.length === 1 && grouped.top[0].from === "X" && grouped.top[0].count === 2 && grouped.top[0].files === 2 && grouped.top[0].example === "a.xml:1", "수동 항목 묶기(종류·대상, 건수 순, 상위 N)");

// 리포트의 숫자로 등급을 다시 계산하면 같아야 한다
function recompute(rubric, gr) {
  const score = gr.factors.reduce((s, f) => s + pointsFor(rubric.factors.find((x) => x.id === f.id).bands, f.value).points, 0);
  return { score, grade: gradeFor(rubric, score) };
}

// ── 픽스처 1: 3.x 프로젝트(공통컴포넌트 소스 + 교체 라이브러리) ─────────
const p3 = mkdtempSync(path.join(tmpdir(), "egovassess3-"));
write(p3, "pom.xml", `<project><properties><egovframework.rte.version>3.10.0</egovframework.rte.version><java.version>1.8</java.version></properties>
<repositories><repository><id>egovframe</id><url>http://maven.egovframe.go.kr/maven/</url></repository></repositories>
<dependencies>
<dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.ptl.mvc</artifactId><version>\${egovframework.rte.version}</version></dependency>
<dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.psl.dataaccess</artifactId><version>\${egovframework.rte.version}</version></dependency>
<dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>3.1.0</version></dependency>
<dependency><groupId>commons-dbcp</groupId><artifactId>commons-dbcp</artifactId><version>1.4</version></dependency>
<dependency><groupId>log4j</groupId><artifactId>log4j</artifactId><version>1.2.17</version></dependency>
<dependency><groupId>org.mybatis</groupId><artifactId>mybatis</artifactId><version>3.1.1</version></dependency>
<dependency><groupId>com.altibase</groupId><artifactId>altibase-jdbc</artifactId><version>7.1</version></dependency>
</dependencies></project>\n`);
write(p3, "src/main/java/egovframework/com/cmm/Svc.java", "import javax.servlet.http.HttpServletRequest;\nimport egovframework.rte.psl.dataaccess.mapper.Mapper;\nimport egovframework.rte.fdl.idgnr.impl.EgovTableIdGnrService;\nclass Svc {}\n");
write(p3, "src/main/java/egovframework/com/cop/bbs/B.java", "import egovframework.rte.ptl.mvc.validation.RteFieldChecks;\nclass B {}\n");
write(p3, "src/main/resources/application.properties", "Globals.DbType=mysql\n");
const a3 = await assessProject({ projectDir: p3 });
assert(a3.overview.sourceEra === "3.x" && a3.overview.rteVersion === "3.10.0" && a3.overview.components.count === 2 && a3.overview.parent.kind === "none", `3.x 개요(세대 ${a3.overview.sourceEra}, 컴포넌트 ${a3.overview.components.count})`);
assert(a3.migration.manual > 0 && a3.migration.auto > 0 && a3.migration.reassemble.length === 2 && a3.migration.removedApiRefs >= 2, `전환 범위: 수동 ${a3.migration.manual} 자동 ${a3.migration.auto} 재조립 ${a3.migration.reassemble.join(",")} 제거 API ${a3.migration.removedApiRefs}`);
assert(a3.migration.manualTop.length >= 1 && a3.migration.manualTop.every((t) => t.count >= 1 && t.example.includes(":")) && a3.migration.manualTotalGroups >= a3.migration.manualTop.length, "예상 수동 작업 상위 목록");
assert(a3.dependencies.summary.legacy >= 3 && a3.dependencies.summary.replace >= 1 && a3.dependencies.vendor.length === 1 && a3.dependencies.actions.length >= 4 && a3.dependencies.actions.every((x) => x.action.length > 0), `의존성 조치 ${a3.dependencies.actions.length}건 · 벤더 ${a3.dependencies.vendor.join(",")}`);
assert(a3.security.checks.length === 5 && a3.security.missing >= 1 && a3.security.checks.some((c) => c.id === "https-repositories" && c.status === "missing"), `보안 점검: 누락 ${a3.security.missing} (http 저장소)`);
assert(a3.sbom.present === false && a3.sbom.path === "sbom/bom.cdx.json" && a3.sbom.note.includes("generate_egovframe_sbom"), "SBOM 없음 안내");
assert(a3.grades.migration.grade !== "A" && a3.grades.supplyChain.grade !== "A" && a3.grades.supplyChain.caveats.some((c) => c.includes("offline=true")), `3.x 등급 ${a3.grades.migration.grade}/${a3.grades.supplyChain.grade}, 취약점 미조회 주의`);
assert(a3.grades.migration.factors.find((f) => f.id === "era").value === 2 && a3.grades.supplyChain.factors.find((f) => f.id === "platform").value === 2, "세대 2점(3.x)·parent 없음+Java 1.8 → 2점");
for (const [rub, gr] of [[MIGRATION_RUBRIC, a3.grades.migration], [SUPPLY_CHAIN_RUBRIC, a3.grades.supplyChain]]) {
  const rc = recompute(rub, gr);
  assert(rc.score === gr.score && rc.grade === gr.grade, `${rub.title}: 리포트 숫자로 재계산 = ${gr.score}점 ${gr.grade}`);
}
const md3 = renderAssessmentMarkdown(a3);
for (const h of ["## 1. 프로젝트 개요", "## 2. 전환 범위", "## 3. 의존성", "## 4. 보안 설정 점검", "## 5. SBOM", "## 6. 등급과 근거", "### 예상 수동 작업", "### 조치 목록", "**전환 난이도 산식**", "**공급망 상태 산식**"]) assert(md3.includes(h), `Markdown: ${h}`);
assert(md3.includes("1–20→1, 21–100→2, 101+→3") && md3.includes("A=0 · B≤3 · C≤7 · D>7") && md3.includes("비용·공수는 산정하지 않습니다"), "산식 구간·등급 경계·범위 문구가 본문에 있음");
// OSV 조회(가짜) → 취약점 요인 반영, 주의 문구 없음
const a3v = await assessProject({ projectDir: p3, offline: false, osvQuery: async (q) => ({ results: q.map((x) => ({ vulns: x.package.name === "log4j:log4j" ? [{ id: "GHSA-1" }, { id: "CVE-2" }] : [] })) }) });
assert(a3v.dependencies.vulnerabilities.queried && a3v.dependencies.vulnerabilities.dependencies === 1 && a3v.dependencies.vulnerabilities.ids === 2 && a3v.grades.supplyChain.factors.find((f) => f.id === "vulnerabilities").points === 1 && a3v.grades.supplyChain.caveats.length === 0, "OSV 조회 시 취약점 1개 의존성 → 1점, 주의 없음");
assert(a3v.grades.supplyChain.score === a3.grades.supplyChain.score + 1, "취약점 1점만큼 공급망 점수 증가");
// OSV 실패 → 주의 문구, 0점
const a3e = await assessProject({ projectDir: p3, offline: false, osvQuery: async () => { throw new Error("boom"); } });
assert(!a3e.dependencies.vulnerabilities.queried && a3e.osvError === undefined && a3e.dependencies.osvError?.includes("boom") && a3e.grades.supplyChain.caveats.some((c) => c.includes("조회 실패")), "OSV 실패는 주의로 남기고 0점");

// ── 픽스처 2: 4.x(공통컴포넌트 없음, javax 몇 개) → B 또는 C ───────────
const p4 = mkdtempSync(path.join(tmpdir(), "egovassess4-"));
write(p4, "pom.xml", `<project><properties><org.egovframe.rte.version>4.3.0</org.egovframe.rte.version></properties><dependencies>
<dependency><groupId>org.egovframe.rte</groupId><artifactId>org.egovframe.rte.ptl.mvc</artifactId><version>\${org.egovframe.rte.version}</version></dependency>
<dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>4.0.1</version></dependency>
</dependencies></project>\n`);
write(p4, "src/main/java/kr/go/app/A.java", "import javax.servlet.http.HttpServletRequest;\nclass A {}\n");
const a4 = await assessProject({ projectDir: p4 });
assert(a4.overview.sourceEra === "4.x" && a4.migration.reassemble.length === 0 && a4.migration.removedApiRefs === 0, "4.x 소형 프로젝트: 재조립·제거 API 0");
assert(["B", "C"].includes(a4.grades.migration.grade) && a4.grades.migration.factors.find((f) => f.id === "manual").value === a4.migration.manual, `4.x 소형 전환 등급 ${a4.grades.migration.grade}(수동 ${a4.migration.manual})`);

// ── 픽스처 3: 5.x parent 프로젝트 → 전환 A ───────────────────────────
const p5 = mkdtempSync(path.join(tmpdir(), "egovassess5-"));
write(p5, "pom.xml", `<project><parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.2</version></parent>
<dependencies><dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-mvc</artifactId></dependency></dependencies></project>\n`);
write(p5, "src/main/java/kr/go/app/A.java", "import jakarta.servlet.http.HttpServletRequest;\nclass A {}\n");
write(p5, "sbom/bom.cdx.json", JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1, metadata: { timestamp: "2026-10-04T00:00:00Z" }, components: [{ type: "library", name: "x" }, { type: "library", name: "y" }], vulnerabilities: [{ id: "V" }] }));
const a5 = await assessProject({ projectDir: p5 });
assert(a5.migration.items === 0 && a5.grades.migration.grade === "A" && a5.grades.migration.score === 0, `5.x parent 프로젝트: 전환 범위 0·등급 A (${a5.grades.migration.grade})`);
assert(a5.overview.parent.kind === "web" && a5.grades.supplyChain.factors.find((f) => f.id === "platform").value === 0, "5.x parent 최신·Java 관리 → 플랫폼 0점");
assert(a5.sbom.present && a5.sbom.components === 2 && a5.sbom.specVersion === "1.6" && a5.sbom.vulnerabilities === 1 && a5.sbom.timestamp === "2026-10-04T00:00:00Z", "SBOM 요약(component 2·취약점 1)");
assert(renderAssessmentMarkdown(a5).includes("전환 항목 없음") && renderAssessmentMarkdown(a5).includes("✅ sbom/bom.cdx.json"), "5.x Markdown: 전환 없음·SBOM 표시");
// v0.40: 5절에 최소 요소·VEX
assert(a5.sbom.minimum.verdict === "needs-work" && a5.sbom.minimum.missing.join() === "공급자,버전,고유식별자,의존관계,작성자" && !a5.sbom.vex.present && renderAssessmentMarkdown(a5).includes("최소 요소 7종: ⚠️ 보완 필요(공급자·버전·고유식별자·의존관계·작성자)") && renderAssessmentMarkdown(a5).includes("VEX: 없음 — check_egovframe_sbom(vex=true)"), "5절: 최소 요소 보완 필요·VEX 없음 안내");
write(p5, "sbom/vex.cdx.json", JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", version: 2, metadata: { timestamp: "2026-10-07T00:00:00Z" }, vulnerabilities: [{ id: "V", analysis: { state: "not_affected" }, affects: [] }, { id: "W", affects: [] }] }));
const a5v = await assessProject({ projectDir: p5 });
assert(a5v.sbom.vex.present && a5v.sbom.vex.vulnerabilities === 2 && a5v.sbom.vex.states.not_affected === 1 && a5v.sbom.vex.states.in_triage === 1 && renderAssessmentMarkdown(a5v).includes("마지막 점검 2026-10-07T00:00:00Z"), "5절: VEX 상태 집계·마지막 점검 시각");
const a5s = await assessProject({ projectDir: p5, sbomPath: "other\\bom.json" });
assert(!a5s.sbom.present && a5s.sbom.path === "other/bom.json", "sbomPath 지정(역슬래시 정규화)·없음");
write(p5, "bad.json", "{not json");
assert((await assessProject({ projectDir: p5, sbomPath: "bad.json" })).sbom.note.includes("읽지 못했습니다"), "깨진 SBOM 은 읽기 실패로 표시");

// ── 리포트 조립·저장 ───────────────────────────────────
const r0 = await generateProjectReport({ projectDir: p3 });
assert(r0.sections.length === 1 && r0.sections[0] === "components" && r0.markdown.startsWith("# eGovFrame 프로젝트 리포트") && !r0.markdown.includes("평가서") && !r0.assessment && !r0.written && r0.bytes === Buffer.byteLength(r0.markdown), "기본 sections=components: v0.16 리포트 그대로, 평가서 없음");
assert(r0.markdown.trimEnd() === generateReport({ projectDir: p3 }).trimEnd(), "기존 generateReport 와 같은 본문");
const r2 = await generateProjectReport({ projectDir: p3, sections: ["components", "assessment", "assessment"] });
assert(r2.sections.length === 2 && r2.markdown.includes("# eGovFrame 프로젝트 리포트") && r2.markdown.includes("# 표준프레임워크 5.x 전환 준비도 평가서") && r2.markdown.includes("\n\n---\n\n") && r2.assessment?.grades.migration.grade === a3.grades.migration.grade, "두 절 이어 붙임(중복 제거)·assessment 데이터 포함");
await rejects(() => generateProjectReport({ projectDir: p3, sections: ["bogus"] }), /알 수 없는 section/, "알 수 없는 section 거부");
const dry = await generateProjectReport({ projectDir: p3, sections: ["assessment"], outputPath: "docs/assessment.md", dryRun: true });
assert(dry.dryRun && !dry.written && dry.outputPath === "docs/assessment.md" && dry.absolutePath === path.join(p3, "docs", "assessment.md") && !existsSync(dry.absolutePath) && dry.notes.some((x) => x.includes("dryRun")), "dryRun: 경로만 확인, 파일 없음");
const saved = await generateProjectReport({ projectDir: p3, sections: ["assessment"], outputPath: "./docs/assessment.md" });
assert(saved.written && existsSync(saved.absolutePath) && readFileSync(saved.absolutePath, "utf8") === saved.markdown && saved.outputPath === "docs/assessment.md", "저장: 새 파일 생성(transaction)");
await rejects(() => generateProjectReport({ projectDir: p3, sections: ["assessment"], outputPath: "docs/assessment.md" }), /이미 있습니다/, "기존 파일은 거부(덮어쓰기 없음)");
await rejects(() => generateProjectReport({ projectDir: p3, outputPath: "../x.md" }), /상대 경로|프로젝트 밖/, "프로젝트 밖 경로 거부");
await rejects(() => generateProjectReport({ projectDir: p3, outputPath: "/tmp/x.md" }), /상대 경로/, "절대 경로 거부"); // portability: ok 절대 경로 거부를 확인하는 입력(어느 OS 에서도 절대 경로로 판정됨)
await rejects(() => generateProjectReport({ projectDir: p3, outputPath: "report.html" }), /\.md/, ".md 가 아니면 거부");
if (process.platform !== "win32") {
  mkdirSync(path.join(p3, "out"), { recursive: true });
  const outside = mkdtempSync(path.join(tmpdir(), "egovassess-out-"));
  symlinkSync(outside, path.join(p3, "out", "link"));
  await rejects(() => generateProjectReport({ projectDir: p3, outputPath: "out/link/r.md" }), /symlink/, "symlink 로 프로젝트 밖 거부");
  rmSync(outside, { recursive: true, force: true });
}
const strip = ({ markdown, ...rest }) => rest;
const sc = OUTPUT_SCHEMAS.generate_egovframe_report.safeParse(strip(saved));
assert(sc.success && Object.keys(strip(saved)).every((k) => k in OUTPUT_SCHEMAS.generate_egovframe_report.shape), "structuredContent(markdown 제외)가 outputSchema 통과, 미선언 키 없음");

rmSync(p3, { recursive: true, force: true }); rmSync(p4, { recursive: true, force: true }); rmSync(p5, { recursive: true, force: true });
if (process.exitCode) console.error(`assessment FAIL (${n} assertions)`); else console.log(`assessment OK (${n} assertions)`);
