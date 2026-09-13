// node test/test-runner.mjs — 오프라인 테스트 러너 검증 (실제 프로세스 없이 가짜 runner 주입, JUnit XML 픽스처)
import {
  reportDirFor,
  resolveTestArgs,
  validateTestFilter,
  locateInStack,
  parseJUnitXml,
  snapshotReports,
  readJUnitReports,
  summarizeReports,
  runTests,
} from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function assert(c, m) { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); }
const mkdir = (p) => mkdtempSync(path.join(tmpdir(), p));

// ── reportDirFor / resolveTestArgs / validateTestFilter ─────────────
assert(reportDirFor("maven") === path.join("target", "surefire-reports"), "maven 리포트 디렉터리");
assert(reportDirFor("gradle") === path.join("build", "test-results", "test"), "gradle 리포트 디렉터리");
assert(resolveTestArgs("maven").join(" ") === "-B -e test", "maven 전체 테스트 인자");
assert(resolveTestArgs("maven", "FooTest#bar").join(" ") === "-B -e test -Dtest=FooTest#bar -Dsurefire.failIfNoSpecifiedTests=false", "maven 필터 인자(-Dtest + failIfNoSpecifiedTests=false)");
assert(resolveTestArgs("gradle").join(" ") === "--console=plain test", "gradle 전체 테스트 인자");
assert(resolveTestArgs("gradle", "com.acme.FooTest").join(" ") === "--console=plain test --tests com.acme.FooTest", "gradle --tests 필터");
assert(validateTestFilter("  ") === undefined && validateTestFilter(undefined) === undefined, "빈 필터는 undefined");
assert(validateTestFilter("com.acme.*Test,Bar#baz") === "com.acme.*Test,Bar#baz", "허용 문자 필터 통과");
for (const bad of ["Foo Test", "Foo;rm", "a=b", "x\"y", "a|b", "a&b"]) {
  let threw = false; try { validateTestFilter(bad); } catch { threw = true; }
  assert(threw, `위험 문자 필터 거부: ${JSON.stringify(bad)}`);
}

// ── locateInStack ───────────────────────────────────────────────────
const stack = [
  "org.opentest4j.AssertionFailedError: expected: <1> but was: <2>",
  "\tat org.junit.jupiter.api.AssertionUtils.fail(AssertionUtils.java:38)",
  "\tat org.junit.jupiter.api.Assertions.assertEquals(Assertions.java:150)",
  "\tat egovframework.example.sample.FooTest.bar(FooTest.java:42)",
  "\tat java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)",
].join("\n");
const loc = locateInStack(stack, "egovframework.example.sample.FooTest");
assert(loc.file === "FooTest.java" && loc.line === 42, `스택에서 테스트 클래스 프레임(파일:라인) 추출 — 실제 ${JSON.stringify(loc)}`);
assert(Object.keys(locateInStack(undefined, "X")).length === 0, "스택 없으면 빈 객체");
const loc2 = locateInStack("\tat com.acme.Inner$Nested.t(Inner.java:9)", "com.acme.Inner$Nested");
assert(loc2.file === "Inner.java" && loc2.line === 9, "중첩 클래스($) 프레임도 추출");

// ── parseJUnitXml: surefire 형식(실패·오류·건너뜀·CDATA·엔티티) ────────
const surefire = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="egovframework.example.sample.FooTest" time="0.412" tests="4" errors="1" skipped="1" failures="1">
  <properties><property name="java.version" value="17"/></properties>
  <testcase name="ok" classname="egovframework.example.sample.FooTest" time="0.01"/>
  <testcase name="bar" classname="egovframework.example.sample.FooTest" time="0.2">
    <failure message="expected: &lt;1&gt; but was: &lt;2&gt;" type="org.opentest4j.AssertionFailedError"><![CDATA[org.opentest4j.AssertionFailedError: expected: <1> but was: <2>
\tat org.junit.jupiter.api.Assertions.assertEquals(Assertions.java:150)
\tat egovframework.example.sample.FooTest.bar(FooTest.java:42)
]]></failure>
  </testcase>
  <testcase name="boom" classname="egovframework.example.sample.FooTest" time="0.1">
    <error message="DB 연결 실패 &amp; 재시도 없음" type="java.lang.IllegalStateException">java.lang.IllegalStateException: DB 연결 실패
\tat egovframework.example.sample.FooTest.boom(FooTest.java:57)
</error>
    <system-out><![CDATA[some output]]></system-out>
  </testcase>
  <testcase name="later" classname="egovframework.example.sample.FooTest" time="0">
    <skipped message="not yet"/>
  </testcase>
</testsuite>`;
const p1 = parseJUnitXml(surefire, "TEST-egovframework.example.sample.FooTest.xml");
assert(p1 && p1.suite.name === "egovframework.example.sample.FooTest", "surefire suite 이름");
assert(p1.suite.tests === 4 && p1.suite.failures === 1 && p1.suite.errors === 1 && p1.suite.skipped === 1 && p1.suite.timeSec === 0.412, "surefire suite 집계 속성");
assert(p1.cases.length === 4, `케이스 4개 — 실제 ${p1.cases.length}`);
const byName = Object.fromEntries(p1.cases.map((c) => [c.name, c]));
assert(byName.ok.outcome === "passed" && byName.ok.timeSec === 0.01, "통과 케이스");
assert(byName.bar.outcome === "failed" && byName.bar.message === "expected: <1> but was: <2>", `실패 메시지 엔티티 디코드 — 실제 ${byName.bar.message}`);
assert(byName.bar.type === "org.opentest4j.AssertionFailedError" && byName.bar.file === "FooTest.java" && byName.bar.line === 42, "실패 타입·CDATA 스택에서 파일:라인");
assert(byName.boom.outcome === "error" && byName.boom.message === "DB 연결 실패 & 재시도 없음" && byName.boom.line === 57, "오류 케이스(&amp; 디코드, 라인)");
assert(byName.later.outcome === "skipped" && byName.later.message === "not yet", "건너뜀 케이스 메시지");

// ── parseJUnitXml: gradle 형식(self-closing testcase, 속성 없는 suite 집계) ──
const gradleXml = `<?xml version="1.1" encoding="UTF-8"?>
<testsuite name="com.acme.BarTest" tests="2" skipped="0" failures="1" errors="0" timestamp="2026-09-12T10:00:00" hostname="ci" time="0.05">
  <testcase name="a()" classname="com.acme.BarTest" time="0.01"/>
  <testcase name="b()" classname="com.acme.BarTest" time="0.04">
    <failure message="boom" type="java.lang.AssertionError">java.lang.AssertionError: boom
\tat com.acme.BarTest.b(BarTest.java:21)
</failure>
  </testcase>
  <system-out><![CDATA[]]></system-out>
  <system-err><![CDATA[]]></system-err>
</testsuite>`;
const p2 = parseJUnitXml(gradleXml, "TEST-com.acme.BarTest.xml");
assert(p2.suite.tests === 2 && p2.suite.failures === 1 && p2.cases[1].outcome === "failed" && p2.cases[1].line === 21, "gradle 형식 파싱");
const noAttr = parseJUnitXml(`<testsuite name="X"><testcase name="t" classname="X"/><testcase name="u" classname="X"><skipped/></testcase></testsuite>`, "TEST-X.xml");
assert(noAttr.suite.tests === 2 && noAttr.suite.skipped === 1 && noAttr.suite.failures === 0, "집계 속성 없으면 케이스에서 계산");
assert(parseJUnitXml("<html>not junit</html>", "x.xml") === null, "testsuite 없으면 null");

// ── readJUnitReports: 디렉터리 스캔 + 오래된 리포트 제외 ──────────────
const rep = mkdir("tr-rep-");
writeFileSync(path.join(rep, "TEST-a.xml"), surefire);
writeFileSync(path.join(rep, "TEST-b.xml"), gradleXml);
writeFileSync(path.join(rep, "a.txt"), "not xml");
writeFileSync(path.join(rep, "broken.xml"), "<testsuite name='x'"); // 손상 — 건너뜀
const old = path.join(rep, "TEST-old.xml");
writeFileSync(old, gradleXml);
utimesSync(old, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
const all = readJUnitReports(rep);
assert(all.length === 3, `xml 전부 읽기(손상 제외) — 실제 ${all.length}`);
const fresh = readJUnitReports(rep, Date.now() - 60_000);
assert(fresh.length === 2, `1분 이내 리포트만 — 실제 ${fresh.length}`);
assert(readJUnitReports(path.join(rep, "nope")).length === 0, "없는 디렉터리는 빈 배열");
const snap = snapshotReports(rep);
assert(snap.size === 4 && snap.has("TEST-old.xml") && !snap.has("a.txt"), `스냅샷은 xml 파일·mtime — 실제 ${snap.size}`);
assert(readJUnitReports(rep, { previous: snap }).length === 0, "스냅샷 이후 변화 없으면 0건");
writeFileSync(path.join(rep, "TEST-c.xml"), gradleXml); // 새 파일
utimesSync(path.join(rep, "TEST-a.xml"), new Date(), new Date(Date.now() + 5000)); // 다시 쓰임(mtime 증가)
const after = readJUnitReports(rep, { previous: snap });
assert(after.length === 2 && after.map((r) => r.suite.reportFile).sort().join(",") === "TEST-a.xml,TEST-c.xml", `새 파일·다시 쓰인 파일만 — 실제 ${after.map((r) => r.suite.reportFile)}`);
assert(snapshotReports(path.join(rep, "nope")).size === 0, "없는 디렉터리 스냅샷은 비어 있음");

// ── summarizeReports ────────────────────────────────────────────────
const agg = summarizeReports(all, 2);
assert(agg.summary.suites === 3 && agg.summary.tests === 8 && agg.summary.failures === 3 && agg.summary.errors === 1 && agg.summary.skipped === 1 && agg.summary.passed === 3,
  `집계 — 실제 ${JSON.stringify(agg.summary)}`);
assert(agg.failures.length === 2 && agg.failuresTruncated === true, "maxFailures 절단");
assert(summarizeReports([]).summary.tests === 0 && summarizeReports([]).failures.length === 0, "빈 리포트 집계");

// ── runTests: dryRun ────────────────────────────────────────────────
const mv = mkdir("tr-mvn-"); writeFileSync(path.join(mv, "pom.xml"), "<project/>");
const dry = await runTests({ projectDir: mv, testFilter: "FooTest", dryRun: true, platform: "linux" });
assert(dry.dryRun && dry.buildTool === "maven" && dry.command === "mvn -B -e test -Dtest=FooTest -Dsurefire.failIfNoSpecifiedTests=false", `dryRun 명령 — 실제 ${dry.command}`);
assert(dry.reportDir === path.join("target", "surefire-reports") && dry.success === undefined, "dryRun 리포트 위치·실행 결과 없음");

// ── runTests: 가짜 runner — 실행 중 리포트를 쓰는 성공 케이스 ──────────
let seen = null;
const okRunner = async (cmd, opts) => {
  seen = { args: cmd.args, timeoutMs: opts.timeoutMs, cwd: cmd.cwd };
  const dir = path.join(cmd.cwd, "target", "surefire-reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "TEST-ok.xml"), `<testsuite name="OkTest" tests="2" failures="0" errors="0" skipped="0"><testcase name="a" classname="OkTest"/><testcase name="b" classname="OkTest"/></testsuite>`);
  opts.onData("[INFO] Tests run: 2, Failures: 0, Errors: 0, Skipped: 0\n[INFO] BUILD SUCCESS\n");
  return { exitCode: 0, timedOut: false };
};
const nowSeq = (() => { const v = [1000, 1700]; let i = 0; return () => v[Math.min(i++, v.length - 1)]; })();
const ok = await runTests({ projectDir: mv, timeoutMs: 4242, runner: okRunner, now: nowSeq, platform: "linux" });
assert(ok.success === true && ok.exitCode === 0 && ok.reportsFound === true, "성공: exit 0 + 리포트 실패 0");
assert(ok.summary.tests === 2 && ok.summary.passed === 2 && ok.suites.length === 1, "성공 집계");
assert(ok.durationMs === 700 && seen.timeoutMs === 4242 && seen.cwd === mv && seen.args.join(" ") === "-B -e test", "runner 전달값·duration");

// ── runTests: 이전 실행의 오래된 리포트는 무시된다 ──────────────────
const staleDir = path.join(mv, "target", "surefire-reports");
const stale = path.join(staleDir, "TEST-stale.xml");
writeFileSync(stale, `<testsuite name="StaleTest" tests="1" failures="1" errors="0" skipped="0"><testcase name="x" classname="StaleTest"><failure message="old"/></testcase></testsuite>`);
utimesSync(stale, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
const ok2 = await runTests({ projectDir: mv, runner: okRunner, platform: "linux" });
assert(ok2.success === true && ok2.suites.every((s) => s.name !== "StaleTest"), "오래된 리포트(1시간 전) 제외");

// ── runTests: 연속 실행 — 직전 실행이 방금 남긴 리포트를 다시 쓰지 않으면 제외 ──
writeFileSync(path.join(staleDir, "TEST-recent.xml"), `<testsuite name="RecentTest" tests="1" failures="1" errors="0" skipped="0"><testcase name="x" classname="RecentTest"><failure message="just now"/></testcase></testsuite>`);
const onlyProbe = async (cmd, opts) => {
  writeFileSync(path.join(staleDir, "TEST-ok.xml"), `<testsuite name="OkTest" tests="1" failures="0" errors="0" skipped="0"><testcase name="a" classname="OkTest"/></testsuite>`);
  opts.onData("[INFO] BUILD SUCCESS\n");
  return { exitCode: 0, timedOut: false };
};
const ok3 = await runTests({ projectDir: mv, testFilter: "OkTest", runner: onlyProbe, platform: "linux" });
assert(ok3.success === true && ok3.suites.length === 1 && ok3.suites[0].name === "OkTest", `같은 시각의 이전 리포트(RecentTest)는 제외 — 실제 ${ok3.suites.map((s) => s.name)}`);

// ── runTests: exit 0 이어도 리포트에 실패가 있으면 실패 ─────────────
const liar = async (cmd, opts) => {
  const dir = path.join(cmd.cwd, "target", "surefire-reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "TEST-f.xml"), surefire);
  opts.onData("[INFO] BUILD SUCCESS\n");
  return { exitCode: 0, timedOut: false };
};
const lr = await runTests({ projectDir: mv, runner: liar, platform: "linux" });
assert(lr.success === false && lr.summary.failures === 1 && lr.summary.errors === 1, "리포트 실패가 있으면 exit 0 이어도 success=false(testFailureIgnore 대비)");
assert(lr.failures.length === 2 && lr.failures[0].name === "bar" && lr.failures[0].line === 42, "실패 케이스 목록·위치");

// ── runTests: 컴파일 실패(리포트 없음) ──────────────────────────────
const gr = mkdir("tr-gr-"); writeFileSync(path.join(gr, "build.gradle"), "");
const compileFail = async (cmd, opts) => {
  opts.onData("> Task :compileTestJava FAILED\n/proj/src/test/java/com/FooTest.java:12: error: cannot find symbol\nBUILD FAILED\n");
  return { exitCode: 1, timedOut: false };
};
const cf = await runTests({ projectDir: gr, runner: compileFail, platform: "linux" });
assert(cf.success === false && cf.reportsFound === false && cf.summary.tests === 0, "컴파일 실패: 리포트 없음");
assert(cf.compileErrors.length === 1 && cf.compileErrors[0].line === 12, "컴파일 오류 로그 파싱");
assert(cf.command === "gradle --console=plain test" && cf.reportDir === path.join("build", "test-results", "test"), "gradle 명령·리포트 위치");

// ── runTests: 타임아웃 / 로그 상한 / 예외 ───────────────────────────
const to = await runTests({ projectDir: mv, runner: async () => ({ exitCode: null, timedOut: true }), platform: "linux" });
assert(to.timedOut === true && to.success === false, "타임아웃");
const many = async (cmd, opts) => { for (let i = 0; i < 40; i++) opts.onData(`l${i}\n`); return { exitCode: 0, timedOut: false }; };
const capR = await runTests({ projectDir: mv, runner: many, maxLogLines: 5, platform: "linux" });
assert(capR.logTruncated === true && capR.logTail.split("\n").length === 5, "로그 상한");
let threw = false; try { await runTests({ projectDir: mv, testFilter: "a b", runner: many }); } catch { threw = true; }
assert(threw, "위험 필터는 실행 전에 거부");
const empty = mkdir("tr-empty-");
threw = false; try { await runTests({ projectDir: empty }); } catch { threw = true; }
assert(threw, "빌드파일 없으면 예외");

// ── 정리 ────────────────────────────────────────────────────────────
for (const d of [rep, mv, gr, empty]) rmSync(d, { recursive: true, force: true });
if (process.exitCode) console.error("test-runner FAIL"); else console.log("test-runner OK");
