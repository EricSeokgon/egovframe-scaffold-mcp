// node test/build-runner.mjs — 오프라인 빌드 러너 검증 (실제 프로세스 없이 가짜 runner 주입)
import {
  detectBuildToolAt,
  resolveGoals,
  resolveCommand,
  parseBuildErrors,
  capOutput,
  runBuild,
} from "../dist/index.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function assert(c, m) { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); }
const mkdir = (p) => mkdtempSync(path.join(tmpdir(), p));

// ── detectBuildToolAt ──────────────────────────────
const mv = mkdir("br-mvn-"); writeFileSync(path.join(mv, "pom.xml"), "<project/>");
const gr = mkdir("br-gr-"); writeFileSync(path.join(gr, "build.gradle"), "");
const grk = mkdir("br-grk-"); writeFileSync(path.join(grk, "build.gradle.kts"), "");
const empty = mkdir("br-empty-");
assert(detectBuildToolAt(mv) === "maven", "pom.xml → maven 감지");
assert(detectBuildToolAt(gr) === "gradle", "build.gradle → gradle 감지");
assert(detectBuildToolAt(grk) === "gradle", "build.gradle.kts → gradle 감지");
assert(detectBuildToolAt(empty) === null, "빌드파일 없으면 null");

// ── resolveGoals ───────────────────────────────────
assert(resolveGoals("maven", "compile").join(" ") === "-B -e compile", "maven compile goals");
assert(resolveGoals("maven", "test").join(" ") === "-B -e test", "maven test goals");
assert(resolveGoals("maven", "package").includes("-DskipTests"), "maven package는 테스트 생략");
assert(resolveGoals("gradle", "compile").join(" ") === "--console=plain compileJava", "gradle compile goals");
assert(resolveGoals("gradle", "test").join(" ") === "--console=plain test", "gradle test goals");
assert(resolveGoals("gradle", "package").join(" ") === "--console=plain assemble", "gradle package→assemble");

// ── resolveCommand (래퍼 감지 + 플랫폼) ─────────────
const cMvnSys = resolveCommand(mv, "maven", "compile", { platform: "linux" });
assert(cMvnSys.command === "mvn" && !cMvnSys.usedWrapper, "래퍼 없으면 시스템 mvn");
assert(cMvnSys.args.includes("compile") && cMvnSys.cwd === mv, "명령 인자·cwd 반영");
const mvw = mkdir("br-mvnw-"); writeFileSync(path.join(mvw, "pom.xml"), "<project/>"); writeFileSync(path.join(mvw, "mvnw"), "#!/bin/sh");
const cMvnW = resolveCommand(mvw, "maven", "compile", { platform: "linux" });
assert(cMvnW.command === "./mvnw" && cMvnW.usedWrapper, "mvnw 있으면 래퍼 우선");
const cMvnWin = resolveCommand(mv, "maven", "compile", { platform: "win32" });
assert(cMvnWin.command === "mvn.cmd", "win32 시스템 mvn.cmd");
const mvwWin = mkdir("br-mvnw-win-"); writeFileSync(path.join(mvwWin, "pom.xml"), "<project/>"); writeFileSync(path.join(mvwWin, "mvnw.cmd"), "");
assert(resolveCommand(mvwWin, "maven", "compile", { platform: "win32" }).command === "mvnw.cmd", "win32 mvnw.cmd 래퍼");
const cGrSys = resolveCommand(gr, "gradle", "compile", { platform: "linux" });
assert(cGrSys.command === "gradle" && !cGrSys.usedWrapper, "래퍼 없으면 시스템 gradle");
const grw = mkdir("br-grw-"); writeFileSync(path.join(grw, "build.gradle"), ""); writeFileSync(path.join(grw, "gradlew"), "#!/bin/sh");
assert(resolveCommand(grw, "gradle", "test", { platform: "linux" }).command === "./gradlew", "gradlew 있으면 래퍼 우선");
const grwWin = mkdir("br-grw-win-"); writeFileSync(path.join(grwWin, "build.gradle"), ""); writeFileSync(path.join(grwWin, "gradlew.bat"), "");
assert(resolveCommand(grwWin, "gradle", "compile", { platform: "win32" }).command === "gradlew.bat", "win32 gradlew.bat 래퍼");

// ── parseBuildErrors ───────────────────────────────
const mvnOut = [
  "[INFO] BUILD start",
  "[ERROR] /proj/src/main/java/com/Foo.java:[12,5] cannot find symbol",
  "[ERROR] /proj/src/main/java/com/Foo.java:[12,5] cannot find symbol", // 중복
  "/proj/src/main/java/com/Bar.java:[3,17] ';' 필요",
  "[INFO] BUILD FAILURE",
].join("\n");
const mvnErrs = parseBuildErrors("maven", mvnOut);
assert(mvnErrs.length === 2, `maven 오류 2개(중복 제거) — 실제 ${mvnErrs.length}`);
assert(mvnErrs[0].file.endsWith("Foo.java") && mvnErrs[0].line === 12 && mvnErrs[0].column === 5, "maven 파일·라인·컬럼 파싱");
assert(mvnErrs[0].message.includes("cannot find symbol"), "maven 메시지 파싱");
const grOut = [
  "> Task :compileJava",
  "/proj/src/main/java/com/Bar.java:34: error: ';' expected",
  "/proj/src/main/java/com/Baz.java:7: error: cannot find symbol",
  "BUILD FAILED",
].join("\n");
const grErrs = parseBuildErrors("gradle", grOut);
assert(grErrs.length === 2, `gradle 오류 2개 — 실제 ${grErrs.length}`);
assert(grErrs[0].file.endsWith("Bar.java") && grErrs[0].line === 34, "gradle 파일·라인 파싱");
assert(parseBuildErrors("maven", "[INFO] BUILD SUCCESS").length === 0, "성공 로그는 오류 0개");

// ── capOutput ──────────────────────────────────────
const cap1 = capOutput("a\nb\nc", 5);
assert(!cap1.truncated && cap1.totalLines === 3, "한도 이내면 미절단");
const cap2 = capOutput("a\nb\nc\nd\ne", 2);
assert(cap2.truncated && cap2.text === "d\ne" && cap2.totalLines === 5, "초과 시 마지막 N줄만");

// ── runBuild: dryRun ───────────────────────────────
const dry = await runBuild({ projectDir: mv, goal: "compile", dryRun: true, platform: "linux" });
assert(dry.dryRun && dry.buildTool === "maven" && dry.command === "mvn -B -e compile", "dryRun 명령 반환");
assert(dry.success === undefined, "dryRun은 실행 결과 없음");

// ── runBuild: 가짜 runner 주입 (성공) ───────────────
let seenTimeout = null, seenArgs = null;
const nowSeq = (() => { let vals = [1000, 1500]; let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; })();
const okRunner = async (cmd, opts) => {
  seenTimeout = opts.timeoutMs; seenArgs = cmd.args;
  opts.onData("[INFO] Building demo\n");
  opts.onData("[INFO] BUILD SUCCESS\n");
  return { exitCode: 0, timedOut: false };
};
const okRes = await runBuild({ projectDir: mv, goal: "compile", timeoutMs: 12345, runner: okRunner, now: nowSeq, platform: "linux" });
assert(okRes.success === true && okRes.exitCode === 0, "성공 시 success=true");
assert(okRes.durationMs === 500, `durationMs 주입 계산=500 — 실제 ${okRes.durationMs}`);
assert(seenTimeout === 12345, "timeoutMs가 runner로 전달됨");
assert(seenArgs.includes("compile"), "resolved 명령이 runner에 전달됨");
assert(okRes.errors.length === 0, "성공 시 오류 0개");

// ── runBuild: 가짜 runner 주입 (실패, 오류 파싱) ────
const failRunner = async (cmd, opts) => {
  opts.onData("[ERROR] /proj/src/main/java/com/Foo.java:[9,1] cannot find symbol\n");
  opts.onData("[ERROR] BUILD FAILURE\n");
  return { exitCode: 1, timedOut: false };
};
const failRes = await runBuild({ projectDir: mv, goal: "test", runner: failRunner, platform: "linux" });
assert(failRes.success === false && failRes.exitCode === 1, "실패 시 success=false");
assert(failRes.errors.length === 1 && failRes.errors[0].line === 9, "실패 로그에서 오류 파싱");

// ── runBuild: 타임아웃 ─────────────────────────────
const toRunner = async () => ({ exitCode: null, timedOut: true });
const toRes = await runBuild({ projectDir: gr, goal: "compile", runner: toRunner, platform: "linux" });
assert(toRes.timedOut === true && toRes.success === false, "타임아웃 시 success=false");

// ── runBuild: 로그 상한 ────────────────────────────
const manyRunner = async (cmd, opts) => { for (let i = 0; i < 50; i++) opts.onData(`line${i}\n`); return { exitCode: 0, timedOut: false }; };
const capRes = await runBuild({ projectDir: mv, goal: "compile", maxLogLines: 10, runner: manyRunner, platform: "linux" });
assert(capRes.logTruncated === true && capRes.logTail.split("\n").length === 10, "로그가 maxLogLines로 절단");

// ── runBuild: 예외 (없는 디렉터리 / 빌드파일 없음) ──
let threwDir = false; try { await runBuild({ projectDir: path.join(tmpdir(), "br-nope-does-not-exist-xyz") }); } catch { threwDir = true; }
assert(threwDir, "없는 디렉터리면 예외");
let threwNoBuild = false; try { await runBuild({ projectDir: empty }); } catch { threwNoBuild = true; }
assert(threwNoBuild, "빌드파일 없으면 예외");

// ── 정리 ───────────────────────────────────────────
for (const d of [mv, gr, grk, empty, mvw, mvwWin, grw, grwWin]) rmSync(d, { recursive: true, force: true });
if (process.exitCode) console.error("build-runner FAIL"); else console.log("build-runner OK");
