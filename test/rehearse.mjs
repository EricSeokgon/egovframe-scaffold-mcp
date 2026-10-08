// node test/rehearse.mjs — 전환 리허설(v0.41) 오프라인 검증: pom 맞춤(순수 함수)·오류 분석·사본·원본 불변·단계 순서·가짜 빌드·기록·평가서
import { alignPomToReference, mainDependencies, packageHint, analyzeErrors, fingerprintTree, copyProject, rehearseMigration, renderRehearsalMarkdown, readRehearsalRecord, rehearsalRecordPath, REHEARSAL_STEPS, JAVAC_MAX_ERRORS, MemoryOriginSource, loadCatalog, assessProject, renderAssessmentMarkdown, OUTPUT_SCHEMAS, parseBuildErrors } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
async function rejects(fn, re, msg) { try { await fn(); assert(false, `${msg} (예외 없음)`); } catch (e) { assert(re.test(e.message), `${msg} (${e.message.slice(0, 90)})`); } }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text); };
const cache = mkdtempSync(path.join(tmpdir(), "egovreh-cache-"));
process.env.EGOVFRAME_CACHE_DIR = cache;

// ── pom 맞춤(순수 함수) ─────────────────────────────────
const REF = `<?xml version="1.0"?>
<project>
	<modelVersion>4.0.0</modelVersion>
	<parent>
		<groupId>org.egovframe.web</groupId>
		<artifactId>egovframe-web-config-parent</artifactId>
		<version>5.0.2</version>
	</parent>
	<properties>
		<skipTests>true</skipTests>
		<jsoup.version>1.18.3</jsoup.version>
	</properties>
	<dependencies>
		<dependency>
			<groupId>org.springframework</groupId>
			<artifactId>spring-webmvc</artifactId>
			<version>\${spring.maven.artifact.version}</version>
		</dependency>
		<dependency>
			<groupId>org.jsoup</groupId>
			<artifactId>jsoup</artifactId>
			<version>\${jsoup.version}</version>
		</dependency>
		<dependency>
			<groupId>jakarta.annotation</groupId>
			<artifactId>jakarta.annotation-api</artifactId>
		</dependency>
		<dependency>
			<groupId>org.apache.commons</groupId>
			<artifactId>commons-fileupload2-jakarta-servlet6</artifactId>
		</dependency>
		<dependency>
			<groupId>org.junit.jupiter</groupId>
			<artifactId>junit-jupiter-api</artifactId>
			<scope>test</scope>
		</dependency>
	</dependencies>
	<build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId><dependencies><dependency><groupId>x</groupId><artifactId>in-plugin</artifactId></dependency></dependencies></plugin></plugins></build>
</project>
`;
const PRJ = `<project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>egovframework.com</groupId>
    <artifactId>sample</artifactId>
    <properties>
        <spring.maven.artifact.version>5.3.37</spring.maven.artifact.version>
        <jsoup.version>1.15.0</jsoup.version>
    </properties>
    <dependencies>
        <!-- <dependency><groupId>c</groupId><artifactId>commented</artifactId></dependency> -->
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-webmvc</artifactId>
            <version>\${spring.maven.artifact.version}</version>
        </dependency>
        <dependency>
            <groupId>jakarta.annotation</groupId>
            <artifactId>jakarta.annotation-api</artifactId>
            <version>2.1.1</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>com.gpki</groupId>
            <artifactId>gpkiapi</artifactId>
            <version>1.0</version>
            <scope>system</scope>
        </dependency>
    </dependencies>
    <dependencyManagement><dependencies><dependency><groupId>m</groupId><artifactId>managed</artifactId><version>1</version></dependency></dependencies></dependencyManagement>
</project>
`;
assert(mainDependencies(REF).map((d) => d.artifactId).join() === "spring-webmvc,jsoup,jakarta.annotation-api,commons-fileupload2-jakarta-servlet6,junit-jupiter-api" && mainDependencies(PRJ).map((d) => d.artifactId).join() === "spring-webmvc,jakarta.annotation-api,gpkiapi", "mainDependencies: 주석·dependencyManagement·plugin 의존성 제외");
const al = alignPomToReference(PRJ, REF);
const deps = mainDependencies(al.text);
const dep = (a) => deps.find((d) => d.artifactId === a);
assert(al.parent === "org.egovframe.web:egovframe-web-config-parent:5.0.2 (추가)" && /<\/modelVersion>\s*<parent>\s*<groupId>org\.egovframe\.web<\/groupId>/.test(al.text), "parent 없음 → 기준 parent 를 modelVersion 뒤에 추가");
assert(al.propertiesRemoved.join() === "spring.maven.artifact.version=5.3.37" && !al.text.includes("5.3.37") && al.propertiesSet.join() === "jsoup.version=1.18.3" && al.text.includes("<jsoup.version>1.18.3</jsoup.version>"), "parent 가 정의하는 속성(spring)은 지우고, 기준 pom 이 정의한 속성(jsoup)은 기준 값으로");
assert(al.added.join() === "org.jsoup:jsoup:${jsoup.version},org.apache.commons:commons-fileupload2-jakarta-servlet6" && dep("jsoup") && dep("commons-fileupload2-jakarta-servlet6") && !dep("junit-jupiter-api") && !deps.some((d) => d.artifactId === "in-plugin"), "없는 좌표 추가(test 범위·plugin 의존성 제외)");
const ja = dep("jakarta.annotation-api");
assert(ja.version === null && ja.scope === null && al.versionsChanged.includes("jakarta.annotation:jakarta.annotation-api: 2.1.1 → (parent 관리)") && al.scopesChanged.join() === "jakarta.annotation:jakarta.annotation-api: test → compile", "있는 좌표: 기준에 버전 없으면 <version> 제거(parent 관리), scope 를 기준과 같게");
assert(dep("gpkiapi").scope === "system" && dep("gpkiapi").version === "1.0" && al.text.includes("<artifactId>managed</artifactId><version>1</version>") && al.text.includes("commented"), "기준에 없는 좌표·dependencyManagement·주석은 그대로");
const again = alignPomToReference(al.text, REF);
assert(again.parent === null && again.added.length === 0 && again.versionsChanged.length === 0 && again.scopesChanged.length === 0 && again.propertiesRemoved.length === 0 && again.text === al.text, "맞춘 pom 에 다시 적용하면 변화 없음(멱등)");
const withParent = alignPomToReference(`<project><modelVersion>4.0.0</modelVersion><parent><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.root</artifactId><version>3.10.0</version></parent><dependencies></dependencies></project>`, REF);
assert(/기존 egovframework\.rte:egovframework\.rte\.root:3\.10\.0 교체/.test(withParent.parent) && !withParent.text.includes("egovframework.rte.root") && withParent.text.includes("<properties>") && mainDependencies(withParent.text).length === 4, "3.x parent 교체·properties 블록 생성·빈 dependencies 에 추가");
const noDeps = alignPomToReference(`<project><modelVersion>4.0.0</modelVersion></project>`, REF);
assert(mainDependencies(noDeps.text).length === 4 && noDeps.text.trim().endsWith("</project>"), "dependencies 블록이 없으면 새로 만듦");

// ── 오류 분석 ───────────────────────────────────────────
const refDeps = mainDependencies(REF);
assert(packageHint("org.jsoup.nodes", refDeps) === "org.jsoup:jsoup" && packageHint("jakarta.annotation", refDeps) === "jakarta.annotation:jakarta.annotation-api" && packageHint("jakarta.websocket", refDeps).startsWith("Jakarta EE API") && packageHint("org.apache.commons.fileupload2.core", refDeps) === "org.apache.commons:commons-fileupload2-jakarta-servlet6" && packageHint("com.gpki.gpkiapi", refDeps) === null, "누락 패키지 → 후보 좌표(groupId 접두어·artifactId 토큰), 없으면 null");
const W = "/ws";
const errs = [
  { file: `${W}/src/main/java/a/A.java`, line: 3, message: "package org.jsoup does not exist" },
  { file: `${W}/src/main/java/a/A.java`, line: 4, message: "package jakarta.annotation does not exist" },
  { file: `${W}/src/main/java/a/A.java`, line: 10, message: "cannot find symbol", symbol: "class Jsoup" },
  { file: `${W}/src/main/java/a/A.java`, line: 11, message: "cannot find symbol", symbol: "class PostConstruct" },
  { file: `${W}/src/main/java/b/B.java`, line: 7, message: "cannot find symbol", symbol: "class EgovAbstractDAO", location: "class B" },
  { file: `${W}/src/main/java/b/C.java`, line: 2, message: "incompatible types: int cannot be converted to String" },
];
const items = [{ file: "src/main/java/b/B.java", line: 7, kind: "class-removed", from: "egovframework.rte.psl.dataaccess.EgovAbstractDAO", to: null, action: "manual", reason: "제거" }];
const an = analyzeErrors(errs, W, items, refDeps, false);
assert(an.errors === 6 && an.files === 3 && an.missingPackage === 2 && an.cascade === 2 && an.other === 2, "분석: 누락 패키지 2 · 같은 파일 연쇄 2 · 기타 2");
assert(an.missingPackages[0].package === "org.jsoup" && an.missingPackages[0].errors === 3 && an.missingPackages[0].cascade === 2 && an.missingPackages[0].hint === "org.jsoup:jsoup" && an.missingPackages[1].errors === 1, "연쇄는 그 파일의 첫 누락 패키지(라인 순)에 귀속");
assert(an.linked.manual === 1 && an.linked.unlinked === 1 && an.topFiles.map((f) => f.file).join() === "src/main/java/b/B.java,src/main/java/b/C.java" && an.byDirectory[0].dir === "src/main/java/a", "기타 오류는 수동 항목과 연결, 상위 파일은 코드 작업(누락·연쇄 제외)만");

// ── 빌드 오류 파서(v0.41 수정) ─────────────────────────────
const out = ["[INFO] Compiling 3 source files with javac [forked debug target 17]", "[WARNING] /w/A.java:[3,1] [removal] X has been deprecated", "/w/A.java:[4,2] [removal] Y has been deprecated", "[ERROR] /w/B.java:[5,6] error: cannot find symbol", "  symbol:   class Z", "  location: class B", "/w/B.java:[5,6] error: cannot find symbol", "[ERROR] /w/C.java:[1,1] error: package a.b does not exist", "[ERROR] /w/C.java:[1,1] package a.b does not exist"].join("\n");
const pe = parseBuildErrors("maven", out);
assert(pe.length === 2 && pe[0].message === "cannot find symbol" && pe[0].symbol === "class Z" && pe[0].location === "class B" && pe[1].message === "package a.b does not exist", "Maven fork 형식(error: 접두) 파싱·[WARNING]·린트 경고 제외·중복 제거");

// ── 리허설 전 과정(메모리 원본·가짜 빌드) ─────────────────────
const catalog = loadCatalog();
const bbs = catalog.components.find((c) => c.id === "bbs");
const J = "src/main/java/egovframework/com/cop/bbs/";
const assets = Object.fromEntries(["messageBundles", "idgnContexts", "schedulingContexts", "webAssets", "webFragments"].flatMap((f) => bbs[f] ?? []).map((p) => [p, `5.0.7 asset ${p}\n`]));
const v432 = { [`${J}A.java`]: "package egovframework.com.cop.bbs;\nimport javax.annotation.Resource;\nclass A { /* 4.3.2 */ }\n", [`${J}B.java`]: "class B { /* 4.3.2 */ }\n" };
const v507 = { ...assets, [`${J}A.java`]: "package egovframework.com.cop.bbs;\nimport jakarta.annotation.Resource;\nclass A { /* 5.0.7 */ }\n", [`${J}B.java`]: "class B { /* 5.0.7 */ }\n", [`${J}N.java`]: "class N { /* new */ }\n" };
const origin = new MemoryOriginSource({ "v4.3.2": v432, "v5.0.7": v507 }, { "v5.0.7": catalog.source.commit });
const readTarget = async (paths) => new Map(paths.map((p) => [p, origin.contentOf("v5.0.7", p)]).filter(([, b]) => b));
function makeProject() {
  const root = mkdtempSync(path.join(tmpdir(), "egovreh-"));
  write(root, "pom.xml", PRJ.replace("<dependencies>", `<dependencies>
        <dependency><groupId>org.egovframe.rte</groupId><artifactId>egovframe-rte-ptl-mvc</artifactId><version>4.3.0</version></dependency>
        <dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>3.1.0</version><scope>provided</scope></dependency>`));
  for (const [p, c] of Object.entries(v432)) write(root, p, c);
  write(root, "src/main/java/egovframework/app/Main.java", "package egovframework.app;\nimport javax.servlet.http.HttpServletRequest;\nclass Main {}\n");
  write(root, "target/classes/Old.class", "x");
  write(root, ".git/HEAD", "ref: refs/heads/main\n");
  write(root, "migration-backup/old/x.txt", "x");
  return root;
}
const proj = makeProject();
const before = fingerprintTree(proj);
assert(before.files === 4 && /^[0-9a-f]{64}$/.test(before.sha256), "지문: target·.git·migration-backup 제외 4개 파일");
const cp = mkdtempSync(path.join(tmpdir(), "egovreh-cp-"));
const c = copyProject(proj, path.join(cp, "x"));
assert(c.files === 4 && existsSync(path.join(cp, "x", "pom.xml")) && !existsSync(path.join(cp, "x", "target")) && !existsSync(path.join(cp, "x", ".git")) && !existsSync(path.join(cp, "x", "migration-backup")), "사본: 빌드 산출물·VCS·백업 제외");
rmSync(cp, { recursive: true, force: true });

const calls = [];
const runner = async (cmd, o) => {
  const ws = cmd.cwd;
  const pom = readFileSync(path.join(ws, "pom.xml"), "utf8");
  calls.push({ args: cmd.args, env: cmd.env, aligned: pom.includes("egovframe-web-config-parent"), mainAfterApply: readFileSync(path.join(ws, "src/main/java/egovframework/app/Main.java"), "utf8"), a: readFileSync(path.join(ws, `${J}A.java`), "utf8"), n: existsSync(path.join(ws, `${J}N.java`)) });
  const lines = calls.length === 1
    ? [`[ERROR] ${ws}/${J}A.java:[2,1] error: package jakarta.annotation does not exist`, `[ERROR] ${ws}/${J}A.java:[3,9] error: cannot find symbol`, "  symbol:   class Resource", `[ERROR] ${ws}/src/main/java/egovframework/app/Main.java:[2,1] error: package jakarta.servlet.http does not exist`, `[ERROR] ${ws}/src/main/java/egovframework/app/Other.java:[9,1] error: incompatible types`]
    : [`[ERROR] ${ws}/src/main/java/egovframework/app/Other.java:[9,1] error: incompatible types`];
  o.onData(lines.join("\n") + "\n[INFO] BUILD FAILURE\n");
  return { exitCode: 1, timedOut: false };
};
const r = await rehearseMigration({ projectDir: proj, origin, readTarget, referencePom: async () => REF, runner, platform: "linux", now: (() => { let t = Date.UTC(2026, 9, 8); return () => (t += 1000); })() });
assert(r.original.unchanged && fingerprintTree(proj).sha256 === before.sha256 && readFileSync(path.join(proj, `${J}A.java`), "utf8").includes("4.3.2") && !existsSync(path.join(proj, "egovframe-components.json")), "원본 불변(지문 같음, 컴포넌트 소스 4.3.2 그대로, 매니페스트 없음)");
assert(r.workspace.path === null && readdirSync(path.join(cache, "rehearsal")).filter((x) => x !== "records").length === 0 && r.workspace.files === 4, "keepWorkspace=false: 사본 삭제");
assert(r.steps.map((s) => `${s.step}:${s.ran}:${s.ok}`).join() === "reassemble:true:true,migrate:true:true,verify:true:true,align-pom:true:true", `단계 4개 모두 성공 (${r.steps.filter((s) => !s.ok).map((s) => s.error).join(" / ")})`);
assert(r.reassemble.origin === "v4.3.2" && r.reassemble.actions.replace === 2 && r.reassemble.actions.add >= 1, "재조립을 먼저 해 원본 v4.3.2 식별(적용 전 지문)");
assert(calls.length === 2 && calls[0].a.includes("5.0.7") && calls[0].n && calls[0].mainAfterApply.includes("jakarta.servlet.http") && !calls[0].aligned && calls[1].aligned, "순서: 재조립 → 적용(javax→jakarta) → 컴파일 → pom 맞춤 → 컴파일");
assert(calls.every((x) => x.args.includes("-Dmaven.compiler.fork=true") && x.env.JDK_JAVAC_OPTIONS === `-Xmaxerrs ${JAVAC_MAX_ERRORS}`), "Maven: javac fork + -Xmaxerrs(오류 100개 상한 해제)");
const A = r.afterAutomation.analysis, B = r.afterPomAlignment.analysis;
assert(A.errors === 4 && A.missingPackage === 2 && A.cascade === 1 && A.other === 1 && B.errors === 1 && B.other === 1, "자동 단계 후 4건(누락 2·연쇄 1·기타 1) → pom 맞춤 후 1건");
assert(r.afterPomAlignment.parent.startsWith("org.egovframe.web:egovframe-web-config-parent:5.0.2") && r.afterPomAlignment.added.some((x) => x.startsWith("org.jsoup:jsoup")) && r.afterPomAlignment.patch.includes("+++ b/pom.xml") && r.afterPomAlignment.patch.includes("+\t\t<groupId>org.egovframe.web</groupId>"), "pom 맞춤 내역·사본 패치");
assert(r.worklist[0].kind === "align-pom" && r.worklist[0].errors === 3 && r.worklist.some((w) => w.kind === "file" && w.title.endsWith("Other.java")), "작업 목록: pom 맞춤(오류 3건 해소) 먼저, 남은 파일");
assert(r.notes.some((x) => x.includes("재조립을 전환 적용보다 먼저")) && r.notes.some((x) => x.includes("-Xmaxerrs")), "노트: 순서 이유·오류 상한");
assert(OUTPUT_SCHEMAS.rehearse_egovframe_migration.safeParse(r).success, "결과가 outputSchema 통과");
const md = renderRehearsalMarkdown(r);
assert(md.includes("| 자동 단계 후(재조립·전환 적용) | ❌ 4건 / 파일 3 |") && md.includes("| pom 맞춤 후 | ❌ 1건 / 파일 1 |") && md.includes("4건 중 3건(75%)은 pom 의존성 문제") && md.includes("✅ 변경 없음"), "Markdown: 두 시점·비율·원본 불변");

// 기록과 평가서
const recPath = rehearsalRecordPath(proj);
assert(r.savedTo === recPath && existsSync(recPath) && readRehearsalRecord(proj).afterPomAlignment.patch === undefined && readRehearsalRecord(proj).afterAutomation.analysis.errors === 4, "최근 결과는 캐시 디렉터리에(프로젝트 밖, 패치 본문 제외)");
const as = await assessProject({ projectDir: proj });
assert(as.rehearsal && as.rehearsal.afterAutomation === 4 && as.rehearsal.afterPomAlignment === 1 && as.rehearsal.origin === "v4.3.2" && renderAssessmentMarkdown(as).includes("재조립·전환 적용 후 컴파일 오류 4건 → pom 맞춤 후 1건"), "평가서 6절: 리허설 실측 표시");
const fresh = makeProject();
const as2 = await assessProject({ projectDir: fresh });
assert(!as2.rehearsal && renderAssessmentMarkdown(as2).includes("실측 없음 — `rehearse_egovframe_migration`"), "리허설 기록이 없으면 안내만");

// 단계 선택·실패·유지·거부
const keep = await rehearseMigration({ projectDir: fresh, steps: ["migrate", "verify"], keepWorkspace: true, runner: async (cmd, o) => { o.onData("[INFO] BUILD SUCCESS\n"); return { exitCode: 0, timedOut: false }; }, referencePom: async () => REF, platform: "linux" });
assert(keep.workspace.kept && existsSync(keep.workspace.path) && existsSync(path.join(keep.workspace.path, "migration-backup")) && keep.steps.find((s) => s.step === "reassemble").ran === false && keep.afterAutomation.success === true && !keep.afterPomAlignment, "steps 선택·keepWorkspace(사본 경로 반환)·컴파일 통과");
rmSync(keep.workspace.path, { recursive: true, force: true });
const failing = await rehearseMigration({ projectDir: fresh, steps: ["reassemble", "verify"], origin: { listTags: async () => { throw new Error("git 실행 파일을 찾지 못했습니다"); } }, runner: async (cmd, o) => { o.onData("[INFO] BUILD SUCCESS\n"); return { exitCode: 0, timedOut: false }; }, referencePom: async () => REF, platform: "linux" });
assert(failing.steps[0].ran && !failing.steps[0].ok && /git 실행 파일/.test(failing.steps[0].error) && failing.afterAutomation.success === true && failing.original.unchanged, "단계 실패는 기록하고 다음 단계 계속");
await rejects(() => rehearseMigration({ projectDir: fresh, workspaceRoot: path.join(fresh, "ws") }), /프로젝트 안에 있습니다/, "작업 디렉터리가 프로젝트 안이면 거부(재귀 복사 방지)");
await rejects(() => rehearseMigration({ projectDir: fresh, steps: ["bogus"] }), /알 수 없는 단계/, "알 수 없는 단계 거부");
await rejects(() => rehearseMigration({ projectDir: path.join(fresh, "none") }), /프로젝트 디렉터리가 없습니다/, "없는 디렉터리 거부");
assert(REHEARSAL_STEPS.join() === "reassemble,migrate,verify,align-pom", "단계 순서 고정");
const noBuild = mkdtempSync(path.join(tmpdir(), "egovreh-nob-"));
write(noBuild, "src/x.txt", "x");
const nb = await rehearseMigration({ projectDir: noBuild, steps: ["verify", "align-pom"] });
assert(nb.buildTool === null && nb.afterAutomation.ran === false && /빌드 파일/.test(nb.afterAutomation.reason) && nb.afterPomAlignment.ran === false, "빌드 파일 없으면 컴파일·pom 맞춤 건너뜀");

for (const d of [proj, fresh, noBuild, cache]) rmSync(d, { recursive: true, force: true });
if (process.exitCode) console.error(`rehearse FAIL (${n} assertions)`); else console.log(`rehearse OK (${n} assertions)`);
