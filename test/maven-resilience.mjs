// node test/maven-resilience.mjs — 원격 저장소 일시 장애 내성 (v1.6, 게이트)
//   (1) 판정: 실측 로그(Maven 3.9 Jenkins 503·옛 형식·Gradle·연결 끊김)는 repository-unavailable, 컴파일 오류·404 는 아님
//   (2) runBuild·runTests: 일시 장애만 -U / --refresh-dependencies 로 다시 실행, 컴파일 실패는 1회
//   (3) 실제 Maven 장애 주입: 처음 N 번 503 을 내는 로컬 저장소를 EGOVFRAME_MAVEN_MIRROR 로 두고 mvn 을 돌린다(mvn 이 없으면 건너뜀)
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";

let n = 0;
function assert(c, m) { n++; if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); }
const m = await import("../dist/index.js");
const tmp = (p) => mkdtempSync(path.join(tmpdir(), p));

// ── (1) 판정 ─────────────────────────────────────────────
const JENKINS_503 = `[ERROR] [ERROR] Some problems were encountered while processing the POMs:
[FATAL] Non-resolvable parent POM for egovframework.example:ci-jenkins:1.0.0: The following artifacts could not be resolved: org.egovframe.web:egovframe-web-config-parent:pom:5.0.0 (absent): Could not transfer artifact org.egovframe.web:egovframe-web-config-parent:pom:5.0.0 from/to egovframe (https://maven.egovframe.go.kr/maven/): transfer failed for https://maven.egovframe.go.kr/maven/org/egovframe/web/egovframe-web-config-parent/5.0.0/egovframe-web-config-parent-5.0.0.pom, status: 503 Service Unavailable and 'parent.relativePath' points at wrong local POM @ line 20, column 10`;
const r1 = m.classifyFailure({ output: JENKINS_503 });
assert(r1.kind === "repository-unavailable" && r1.repository.status === 503 && r1.repository.url === "https://maven.egovframe.go.kr/maven/org/egovframe/web/egovframe-web-config-parent/5.0.0/egovframe-web-config-parent-5.0.0.pom", `Maven 3.9 "transfer failed for <url>, status: 503" → 저장소 장애 + URL·상태 (${JSON.stringify(r1.repository)})`);
const OLD = "[ERROR] Failed to execute goal on project x: Could not resolve dependencies for project x:x:jar:1: Failed to collect dependencies at a:b:jar:1: Failed to read artifact descriptor for a:b:jar:1: Could not transfer artifact a:b:pom:1 from/to central (https://repo.maven.apache.org/maven2): status code: 502, reason phrase: Bad Gateway (502)";
assert(m.classifyFailure({ output: OLD }).kind === "repository-unavailable" && m.classifyFailure({ output: OLD }).repository.status === 502, "옛 형식 status code: 502 → 저장소 장애");
const GRADLE = "> Could not resolve org.egovframe.rte:egovframe-rte-fdl-cmmn:5.0.2.\n   > Could not get resource 'https://maven.egovframe.go.kr/maven/org/egovframe/rte/egovframe-rte-fdl-cmmn/5.0.2/egovframe-rte-fdl-cmmn-5.0.2.pom'.\n      > Could not GET 'https://maven.egovframe.go.kr/maven/org/egovframe/rte/egovframe-rte-fdl-cmmn/5.0.2/egovframe-rte-fdl-cmmn-5.0.2.pom'. Received status code 503 from server: Service Unavailable";
const rg = m.classifyFailure({ output: GRADLE });
assert(rg.kind === "repository-unavailable" && rg.repository.status === 503 && rg.repository.url.startsWith("https://maven.egovframe.go.kr/"), "Gradle Received status code 503 → 저장소 장애");
const RESET = "[ERROR] Failed to execute goal ... Could not transfer artifact x:y:jar:1 from/to egovframe (https://maven.egovframe.go.kr/maven/): Connection reset";
assert(m.classifyFailure({ output: RESET }).kind === "repository-unavailable", "Connection reset → 저장소 장애");
const NOTFOUND = "[ERROR] Failed to execute goal on project x: Could not resolve dependencies for project x:x:jar:1: Could not find artifact a:b:jar:9 in central (https://repo.maven.apache.org/maven2)";
assert(m.classifyFailure({ output: NOTFOUND }).kind === "other", "없는 좌표(404 계열)는 일시 장애가 아님 — 다시 실행하지 않음");
const STATUS404 = "Could not transfer artifact a:b:pom:1 from/to x (https://h/): status code: 404, reason phrase: Not Found (404)";
assert(m.classifyFailure({ output: STATUS404 }).kind === "other", "status code: 404 → 일시 장애 아님");
const COMPILE = `${OLD}\n[ERROR] /p/src/main/java/A.java:[3,8] cannot find symbol`;
assert(m.classifyFailure({ output: COMPILE, compileErrors: 1 }).kind === "compile", "컴파일 오류가 있으면 compile 우선");
assert(m.classifyFailure({ output: "x", timedOut: true }).kind === "timeout", "시간 초과 → timeout");
assert(m.classifyFailure({ output: "[ERROR] There are test failures.", goal: "test" }).kind === "test", "test goal 의 테스트 실패 → test");
assert(m.classifyFailure({ output: "Tests run: 3, Failures: 1, Errors: 0, Skipped: 0\nThe build failed: Connection reset by peer in test" }).kind !== "repository-unavailable", "저장소 문맥 없이 원인 문구만 있으면(테스트 로그) 저장소 장애가 아님");
assert(m.repositoryFailureHint(r1.repository, 2).includes("EGOVFRAME_MAVEN_MIRROR") && m.repositoryFailureHint(r1.repository, 2).includes("HTTP 503"), "안내에 상태·미러 변수");

// 미러 settings·검증
assert(m.mavenMirrorSettings("https://nexus.example.com/repository/maven-public/").includes("<mirrorOf>*</mirrorOf><url>https://nexus.example.com/repository/maven-public/</url>"), "미러 settings: 모든 저장소(*)");
for (const bad of ["ftp://x", "https://x/a b", "https://x/'$(id)'", "https://x/?a=1&b=2", "https://x/\"><x>"]) {
  let threw = false; try { m.validateMavenMirror(bad); } catch { threw = true; }
  assert(threw, `미러 URL 거부: ${JSON.stringify(bad)}`);
}
// MAVEN_ARGS 합치기
const e1 = m.mavenResilienceEnv({});
assert(m.MAVEN_RETRY_FLAGS.every((f) => e1.MAVEN_ARGS.includes(f)) && !e1.MAVEN_ARGS.includes("-gs"), "MAVEN_ARGS 에 요청 재시도(5xx·429)");
const e2 = m.mavenResilienceEnv({ MAVEN_ARGS: "-s /p/settings.xml -Daether.connector.http.retryHandler.count=9" });
assert(e2.MAVEN_ARGS === "-s /p/settings.xml -Daether.connector.http.retryHandler.count=9", "사용자가 재시도를 지정했으면 그대로");
const e3 = m.mavenResilienceEnv({ MAVEN_ARGS: "-s /p/settings.xml", EGOVFRAME_MAVEN_MIRROR: "https://nexus.example.com/m/" });
const gs = e3.MAVEN_ARGS.split(" ");
assert(gs[0] === "-s" && gs.includes("-gs") && readFileSync(gs[gs.indexOf("-gs") + 1], "utf8").includes("https://nexus.example.com/m/"), "EGOVFRAME_MAVEN_MIRROR → -gs(사용자 -s 는 유지)");
const mvnDir = tmp("mr-cmd-"); writeFileSync(path.join(mvnDir, "pom.xml"), "<project/>");
assert(m.resolveCommand(mvnDir, "maven", "compile", { platform: "linux" }).env?.MAVEN_ARGS?.includes("retryHandler.count=5"), "resolveCommand(maven) 의 env 에 재시도 — 명령 문자열은 그대로");
assert(m.resolveCommand(mvnDir, "maven", "compile", { platform: "linux" }).args.join(" ") === "-B -e compile", "명령 인자 불변");

// ── (2) runBuild·runTests 재시도 (가짜 runner) ──────────
const fake = (outputs) => {
  const calls = [];
  const runner = async (cmd, o) => { const i = calls.length; calls.push(cmd); const [code, out] = outputs[Math.min(i, outputs.length - 1)]; o.onData(out); return { exitCode: code, timedOut: false }; };
  return { runner, calls };
};
let f = fake([[1, JENKINS_503], [0, "[INFO] BUILD SUCCESS"]]);
let b = await m.runBuild({ projectDir: mvnDir, runner: f.runner, retryDelayMs: 0 });
assert(b.success && b.attempts === 2 && f.calls.length === 2 && !f.calls[0].args.includes("-U") && f.calls[1].args.includes("-U") && !b.failureKind, "503 → -U 로 다시 실행해 성공(attempts 2)");
f = fake([[1, JENKINS_503]]);
b = await m.runBuild({ projectDir: mvnDir, runner: f.runner, retryDelayMs: 0, retryTransient: 2 });
assert(!b.success && b.attempts === 3 && b.failureKind === "repository-unavailable" && b.repository.status === 503 && b.failureHint.includes("시도 3회"), "계속 503 → 한도(retryTransient 2 → 3회) 뒤 repository-unavailable + 안내");
f = fake([[1, COMPILE]]);
b = await m.runBuild({ projectDir: mvnDir, runner: f.runner, retryDelayMs: 0 });
assert(!b.success && f.calls.length === 1 && b.failureKind === "compile" && b.attempts === 1, "컴파일 오류는 다시 실행하지 않음(1회)");
f = fake([[1, JENKINS_503]]);
b = await m.runBuild({ projectDir: mvnDir, runner: f.runner, retryDelayMs: 0, retryTransient: 0 });
assert(f.calls.length === 1 && b.failureKind === "repository-unavailable", "retryTransient 0 → 1회, 판정만");
const grDir = tmp("mr-gr-"); writeFileSync(path.join(grDir, "build.gradle"), "");
f = fake([[1, GRADLE], [0, "BUILD SUCCESSFUL"]]);
b = await m.runBuild({ projectDir: grDir, runner: f.runner, retryDelayMs: 0 });
assert(b.success && f.calls[1].args.includes("--refresh-dependencies"), "Gradle 은 --refresh-dependencies 로 다시");
f = fake([[1, JENKINS_503], [0, "[INFO] BUILD SUCCESS"]]);
const tr = await m.runTests({ projectDir: mvnDir, runner: f.runner, retryDelayMs: 0 });
assert(tr.attempts === 2 && f.calls[1].args.includes("-U"), "runTests 도 일시 장애만 다시 실행");
f = fake([[1, JENKINS_503]]);
const tr2 = await m.runTests({ projectDir: mvnDir, runner: f.runner, retryDelayMs: 0 });
assert(!tr2.success && tr2.failureKind === "repository-unavailable" && tr2.attempts === 2, "runTests: 계속 실패 → repository-unavailable");
// 취소 중 대기는 바로 끝난다
const ac = new AbortController();
f = fake([[1, JENKINS_503]]);
const t0 = Date.now();
setTimeout(() => ac.abort(), 50);
const aborted = await m.runBuild({ projectDir: mvnDir, runner: f.runner, retryDelayMs: 60_000, progress: { report() {}, signal: ac.signal } }).then(() => "done", (e) => e.name);
assert(aborted === "AbortError" && Date.now() - t0 < 5_000, `재시도 대기 중 취소 → 바로 AbortError (${aborted})`);

// ── (3) 실제 Maven 장애 주입 ─────────────────────────────
const isWin = process.platform === "win32";
const mvnCmd = process.env.MAVEN_CMD || (isWin ? "mvn.cmd" : "mvn");
const hasMvn = spawnSync(isWin ? (process.env.ComSpec || "cmd.exe") : mvnCmd, isWin ? ["/d", "/s", "/c", mvnCmd, "-v"] : ["-v"], { encoding: "utf8" }).status === 0;
if (!hasMvn) {
  console.log("skip: mvn 이 없어 실제 장애 주입은 건너뜀(CI gate 러너에는 있음)");
} else {
  const PARENT = `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>x.egov</groupId><artifactId>flaky-parent</artifactId><version>1</version><packaging>pom</packaging></project>`;
  let failFirst = 0, parentHits = 0;
  const server = http.createServer((req, res) => {
    if (req.url.endsWith("/x/egov/flaky-parent/1/flaky-parent-1.pom")) {
      parentHits++;
      if (parentHits <= failFirst) { res.writeHead(503, { "Content-Type": "text/plain" }); res.end("Service Unavailable"); return; }
      res.writeHead(200, { "Content-Type": "application/xml" }); res.end(PARENT); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/repo/`;
  const proj = tmp("mr-proj-");
  // packaging pom: compile 단계에 묶인 플러그인이 없어 parent 해석만 한다(네트워크·플러그인 다운로드 없음)
  writeFileSync(path.join(proj, "pom.xml"), `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>x.egov</groupId><artifactId>flaky-parent</artifactId><version>1</version><relativePath/></parent><artifactId>child</artifactId><packaging>pom</packaging></project>`);
  const saved = { MAVEN_ARGS: process.env.MAVEN_ARGS, MIRROR: process.env.EGOVFRAME_MAVEN_MIRROR };
  // 요청 재시도 간격은 테스트에서만 0.1초(지정하면 서버는 자기 값을 덧붙이지 않는다), 로컬 저장소는 격리
  const repoLocal = (k) => path.join(proj, `.m2-${k}`);
  const fast = (k) => `-Dmaven.repo.local=${repoLocal(k)} -Daether.connector.http.retryHandler.count=2 -Daether.connector.http.retryHandler.interval=100 -Daether.connector.http.retryHandler.serviceUnavailable=429,500,502,503,504`;
  try {
    process.env.EGOVFRAME_MAVEN_MIRROR = url;
    // A: 503 두 번 → 한 번의 mvn 실행 안에서 요청 재시도로 성공(미러가 실제로 쓰였는지: 서버가 요청을 받음)
    failFirst = 2; parentHits = 0; process.env.MAVEN_ARGS = fast("a");
    let r = await m.runBuild({ projectDir: proj, retryDelayMs: 0, timeoutMs: 120_000 });
    assert(r.success && (r.attempts ?? 1) === 1 && parentHits >= 3, `요청 재시도: 503 ×2 뒤 성공, mvn 1회 (요청 ${parentHits}회, 미러 경유)`);
    // B: 503 다섯 번 → 첫 mvn 은 실패(요청 3회), -U 로 다시 실행해 성공
    failFirst = 5; parentHits = 0; process.env.MAVEN_ARGS = fast("b");
    r = await m.runBuild({ projectDir: proj, retryDelayMs: 0, timeoutMs: 120_000 });
    assert(r.success && r.attempts === 2, `명령 재시도: 첫 실행 실패 뒤 -U 로 성공 (attempts ${r.attempts}, 요청 ${parentHits}회)${r.success ? "" : `\n${r.logTail}`}`);
    // C: 계속 503 → repository-unavailable, URL 은 미러 주소
    failFirst = 1e9; parentHits = 0; process.env.MAVEN_ARGS = fast("c");
    r = await m.runBuild({ projectDir: proj, retryDelayMs: 0, timeoutMs: 120_000 });
    assert(!r.success && r.failureKind === "repository-unavailable" && r.attempts === 2 && (r.repository?.url ?? "").startsWith(url) && r.repository?.status === 503, `계속 503 → repository-unavailable·미러 URL·HTTP 503 (${JSON.stringify(r.repository)})`);
  } finally {
    if (saved.MAVEN_ARGS === undefined) delete process.env.MAVEN_ARGS; else process.env.MAVEN_ARGS = saved.MAVEN_ARGS;
    if (saved.MIRROR === undefined) delete process.env.EGOVFRAME_MAVEN_MIRROR; else process.env.EGOVFRAME_MAVEN_MIRROR = saved.MIRROR;
    server.close();
    rmSync(proj, { recursive: true, force: true });
  }
}
rmSync(mvnDir, { recursive: true, force: true });
rmSync(grDir, { recursive: true, force: true });
if (process.exitCode) console.error(`maven-resilience FAIL (${n} assertions)`); else console.log(`maven-resilience OK (${n} assertions)`);
