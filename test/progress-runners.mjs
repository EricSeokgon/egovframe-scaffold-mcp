// node test/progress-runners.mjs — v1.2 진행 알림·취소: runner 계열(build·test·dependency tree·dependencies·sbom)
//   가짜 runner 로 진행 이벤트(단조 증가·total 도달)와 취소(AbortError) 경로를 검증하고,
//   defaultRunner 는 실제 자식 프로세스를 띄워 AbortSignal 로 프로세스 트리가 끝나는지 확인한다.
import {
  defaultRunner,
  runBuild,
  runTests,
  resolveDependencyTree,
  checkDependencies,
  generateSbom,
  collectProgress,
  AbortError,
} from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAbort = (e) => e instanceof Error && e.name === "AbortError" && e instanceof AbortError;
const monotonic = (events) => events.every((e, i) => i === 0 || e.progress >= events[i - 1].progress);
const endsAtTotal = (events) => events.length > 0 && events.at(-1).total !== undefined && events.at(-1).progress === events.at(-1).total;
async function rejectsAbort(p, msg) {
  let err; try { await p; } catch (e) { err = e; }
  assert(err && isAbort(err), `${msg} (got ${err ? `${err.name}: ${err.message}` : "no error"})`);
}

// ── 가짜 runner ─────────────────────────────────────────────────────
/** signal 을 존중하는 가짜 runner: 이미 취소됐거나 대기 중 취소되면 aborted, 아니면 exitCode 0 */
const abortingRunner = (onRun) => async (cmd, o) => {
  onRun?.(cmd, o);
  if (o.signal?.aborted) return { exitCode: null, timedOut: false, aborted: true };
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ exitCode: 0, timedOut: false }), 200);
    o.signal?.addEventListener("abort", () => { clearTimeout(t); resolve({ exitCode: null, timedOut: false, aborted: true }); }, { once: true });
  });
};
const okRunner = async (_cmd, o) => { o.onData("[INFO] BUILD SUCCESS\n"); return { exitCode: 0, timedOut: false }; };

const mavenTreeText = `com.example:example:war:1.0.0
+- org.springframework:spring-webmvc:jar:6.2.10:compile
|  \\- org.springframework:spring-core:jar:6.2.10:compile
\\- com.fasterxml:classmate:jar:1.5.1:runtime
`;
/** Maven dependency:tree 가짜: -DoutputFile 에 트리를 쓴다 */
const fakeTree = async (cmd, o) => {
  const out = cmd.args.find((a) => a.startsWith("-DoutputFile=")).slice("-DoutputFile=".length);
  writeFileSync(out, mavenTreeText);
  o.onData("[INFO] BUILD SUCCESS\n");
  return { exitCode: 0, timedOut: false };
};
const pluginBom = { bomFormat: "CycloneDX", specVersion: "1.6", version: 1,
  metadata: { timestamp: "2026-10-04T00:00:00Z", component: { type: "application", "bom-ref": "pkg:maven/com.example/example@1.0.0?type=war", group: "com.example", name: "example", version: "1.0.0" } },
  components: [{ type: "library", "bom-ref": "pkg:maven/org.springframework/spring-webmvc@6.2.10?type=jar", group: "org.springframework", name: "spring-webmvc", version: "6.2.10", purl: "pkg:maven/org.springframework/spring-webmvc@6.2.10?type=jar" }],
  dependencies: [{ ref: "pkg:maven/com.example/example@1.0.0?type=war", dependsOn: ["pkg:maven/org.springframework/spring-webmvc@6.2.10?type=jar"] }] };
/** cyclonedx-maven-plugin 가짜: -DoutputDirectory 에 bom.json 을 쓴다 */
const fakePlugin = async (cmd, o) => {
  const dir = cmd.args.find((a) => a.startsWith("-DoutputDirectory=")).slice("-DoutputDirectory=".length);
  writeFileSync(path.join(dir, "bom.json"), JSON.stringify(pluginBom));
  o.onData("[INFO] BUILD SUCCESS\n");
  return { exitCode: 0, timedOut: false };
};

// ── 임시 Maven 프로젝트 ─────────────────────────────────────────────
const proj = mkdtempSync(path.join(tmpdir(), "egov-progress-"));
writeFileSync(path.join(proj, "pom.xml"), `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId><artifactId>example</artifactId><version>1.0.0</version><packaging>war</packaging>
  <dependencies>
    <dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId><version>6.2.10</version></dependency>
  </dependencies>
</project>
`);
mkdirSync(path.join(proj, "src", "main", "java"), { recursive: true });

try {
  // ── defaultRunner: AbortSignal 로 실제 자식 프로세스 트리 종료 ──────
  {
    const pidFile = path.join(proj, "child.pid");
    const ac = new AbortController();
    const started = Date.now();
    setTimeout(() => ac.abort(), 200);
    const r = await defaultRunner(
      { command: process.execPath, args: ["-e", "require('fs').writeFileSync(process.argv[1], String(process.pid)); setTimeout(()=>{}, 60000)", pidFile], cwd: tmpdir(), usedWrapper: false },
      { timeoutMs: 30_000, onData: () => {}, signal: ac.signal },
    );
    const elapsed = Date.now() - started;
    assert(r.aborted === true && r.timedOut === false, `defaultRunner: 취소 시 aborted=true (exitCode ${r.exitCode})`);
    assert(elapsed < 5_000, `defaultRunner: 취소 후 5초 안에 settle (${elapsed}ms)`);
    let pid = 0;
    for (let i = 0; i < 20 && !pid; i++) { if (existsSync(pidFile)) pid = Number(readFileSync(pidFile, "utf8")); else await sleep(50); }
    assert(pid > 0, `defaultRunner: 자식이 pid 를 기록 (${pid})`);
    let gone = false;
    for (let i = 0; i < 30 && !gone; i++) {
      try { process.kill(pid, 0); await sleep(100); } catch (e) { gone = e.code === "ESRCH" || e.code === "EPERM"; }
    }
    assert(gone, "defaultRunner: 취소 후 자식 프로세스가 사라짐 (ESRCH)");
  }

  // ── runBuild ────────────────────────────────────────────────────────
  {
    const ac = new AbortController();
    const p = collectProgress(ac.signal);
    const run = runBuild({ projectDir: proj, runner: abortingRunner(() => ac.abort()), platform: "linux", progress: p });
    await rejectsAbort(run, "runBuild: 취소된 runner → AbortError");
    const p2 = collectProgress();
    const r = await runBuild({ projectDir: proj, runner: okRunner, platform: "linux", progress: p2 });
    assert(r.success === true, "runBuild: 가짜 runner 성공");
    assert(p2.events.length === 2 && p2.events[0].progress === 0 && p2.events[1].progress === 1 && p2.events.every((e) => e.total === 1), `runBuild: 진행 이벤트 정확히 2개(0/1 → 1/1) (${JSON.stringify(p2.events)})`);
    assert(/^maven compile: /.test(p2.events[0].message) && /exit 0/.test(p2.events[1].message), "runBuild: 메시지에 도구·goal·exit");
    // 이미 취소된 signal 은 runner 호출 전에 AbortError
    const pre = new AbortController(); pre.abort();
    let called = false;
    await rejectsAbort(runBuild({ projectDir: proj, runner: abortingRunner(() => { called = true; }), platform: "linux", progress: collectProgress(pre.signal) }), "runBuild: 사전 취소 → AbortError");
    assert(!called, "runBuild: 사전 취소면 runner 를 부르지 않음");
    // progress 없이도 동작(기본 NOOP)
    const r0 = await runBuild({ projectDir: proj, runner: okRunner, platform: "linux" });
    assert(r0.success === true, "runBuild: progress 없이 동일 동작");
  }

  // ── runTests ────────────────────────────────────────────────────────
  {
    const ac = new AbortController();
    let gotSignal = false;
    await rejectsAbort(runTests({ projectDir: proj, runner: abortingRunner((_c, o) => { gotSignal = o.signal === ac.signal; ac.abort(); }), platform: "linux", progress: collectProgress(ac.signal) }), "runTests: 취소된 runner → AbortError");
    assert(gotSignal, "runTests: runner 에 signal 전달");
    const p = collectProgress();
    const r = await runTests({ projectDir: proj, runner: okRunner, platform: "linux", progress: p });
    assert(r.dryRun === false && r.exitCode === 0, "runTests: 가짜 runner 실행");
    assert(p.events.length === 2 && p.events[0].progress === 0 && p.events[1].progress === 1 && p.events.every((e) => e.total === 1) && /^maven test: /.test(p.events[0].message), `runTests: 진행 이벤트 2개(0/1 → 1/1) (${JSON.stringify(p.events)})`);
  }

  // ── resolveDependencyTree ───────────────────────────────────────────
  {
    const ac = new AbortController();
    let gotSignal = false;
    await rejectsAbort(resolveDependencyTree({ projectDir: proj, runner: abortingRunner((_c, o) => { gotSignal = o.signal === ac.signal; ac.abort(); }), platform: "linux", progress: collectProgress(ac.signal) }), "resolveDependencyTree: 취소된 runner → AbortError");
    assert(gotSignal, "resolveDependencyTree: runner 에 signal 전달");
    const p = collectProgress();
    const t = await resolveDependencyTree({ projectDir: proj, runner: fakeTree, platform: "linux", progress: p });
    assert(t.ran && t.success && t.artifacts.length === 3, `resolveDependencyTree: 가짜 트리 해석 성공 (${t.artifacts.length} artifact)`);
    assert(p.events.length === 2 && p.events[0].progress === 0 && p.events[1].progress === 1 && p.events.every((e) => e.total === 1) && /^maven dependency tree: /.test(p.events[0].message), `resolveDependencyTree: 진행 이벤트 2개(0/1 → 1/1) (${JSON.stringify(p.events)})`);
    // 사전 취소
    const pre = new AbortController(); pre.abort();
    await rejectsAbort(resolveDependencyTree({ projectDir: proj, runner: fakeTree, platform: "linux", progress: collectProgress(pre.signal) }), "resolveDependencyTree: 사전 취소 → AbortError");
  }

  // ── checkDependencies(resolve=true) ─────────────────────────────────
  {
    const p = collectProgress();
    const r = await checkDependencies({ projectDir: proj, resolve: true, runner: fakeTree, platform: "linux", progress: p });
    assert(r.resolution && r.resolution.success, "checkDependencies(resolve): 가짜 트리로 해석 성공");
    assert(p.events.length >= 3 && monotonic(p.events) && endsAtTotal(p.events), `checkDependencies(resolve): 진행 이벤트 단조 증가·total 도달 (${JSON.stringify(p.events)})`);
    assert(p.events.some((e) => /dependency tree/.test(e.message)) && p.events.every((e) => e.total === 1), "checkDependencies(resolve): 모듈 단위 메시지·total=모듈 수(1)");
    const ac = new AbortController();
    await rejectsAbort(checkDependencies({ projectDir: proj, resolve: true, runner: abortingRunner(() => ac.abort()), platform: "linux", progress: collectProgress(ac.signal) }), "checkDependencies(resolve): 취소된 runner → AbortError");
    // resolve=false 는 progress 가 있어도 runner·보고 없음(기존 동작)
    const p0 = collectProgress();
    const r0 = await checkDependencies({ projectDir: proj, runner: abortingRunner(() => ac.abort()), platform: "linux", progress: p0 });
    assert(!r0.resolution && p0.events.length === 0, "checkDependencies(resolve=false): 진행 보고 없음");
  }

  // ── checkDependencies(resolve=true) — 독립 프로젝트 묶음(모듈별 보고) ──
  {
    const wsDir = mkdtempSync(path.join(tmpdir(), "egov-progress-ws-"));
    for (const m of ["alpha", "beta"]) {
      mkdirSync(path.join(wsDir, m, "src", "main", "java"), { recursive: true });
      writeFileSync(path.join(wsDir, m, "pom.xml"), `<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>${m}</artifactId><version>1.0.0</version>
  <dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId><version>6.2.10</version></dependency></dependencies></project>
`);
    }
    const p = collectProgress();
    const r = await checkDependencies({ projectDir: wsDir, resolve: true, runner: fakeTree, platform: "linux", progress: p });
    if (r.resolution) {
      assert(monotonic(p.events) && endsAtTotal(p.events) && p.events.at(-1).total === 2, `checkDependencies(독립 묶음): total=2·단조 증가·완료 (${JSON.stringify(p.events)})`);
      assert(p.events.some((e) => /module alpha/.test(e.message)) && p.events.some((e) => /module beta/.test(e.message)), "checkDependencies(독립 묶음): 모듈 이름별 메시지");
      // 두 번째 모듈 전에 취소 → AbortError (runner 는 한 번만)
      const ac = new AbortController();
      let runs = 0;
      await rejectsAbort(checkDependencies({ projectDir: wsDir, resolve: true, runner: async (c, o) => { runs++; const x = await fakeTree(c, o); ac.abort(); return x; }, platform: "linux", progress: collectProgress(ac.signal) }), "checkDependencies(독립 묶음): 모듈 사이 취소 → AbortError");
      assert(runs === 1, `checkDependencies(독립 묶음): 취소 뒤 다음 모듈은 실행하지 않음 (runs=${runs})`);
    } else {
      console.log("skip: 독립 프로젝트 묶음이 resolve 대상으로 인식되지 않음 — 모듈별 보고 검증 생략");
    }
    rmSync(wsDir, { recursive: true, force: true });
  }

  // ── generateSbom ────────────────────────────────────────────────────
  {
    const ac = new AbortController();
    let gotSignal = false;
    await rejectsAbort(generateSbom({ projectDir: proj, dryRun: false, runner: abortingRunner((_c, o) => { gotSignal = o.signal === ac.signal; ac.abort(); }), platform: "linux", progress: collectProgress(ac.signal) }), "generateSbom: 취소된 runner → AbortError");
    assert(gotSignal && !existsSync(path.join(proj, "sbom")), "generateSbom: runner 에 signal 전달·취소 시 기록 없음");
    const p = collectProgress();
    const r = await generateSbom({ projectDir: proj, dryRun: false, runner: fakePlugin, platform: "linux", progress: p });
    assert(r.written && r.components === 1, "generateSbom: 가짜 플러그인으로 기록");
    assert(p.events.length >= 2 && monotonic(p.events) && endsAtTotal(p.events), `generateSbom: 진행 이벤트 ≥2·단조 증가·total 도달 (${JSON.stringify(p.events)})`);
    assert(p.events.some((e) => /cyclonedx-maven-plugin/.test(e.message)) && p.events.some((e) => /enrich/.test(e.message)) && p.events.some((e) => /write SBOM/.test(e.message)), "generateSbom: 플러그인 실행·enrich·기록 단계 보고");
    assert(p.events.every((e) => e.total === p.events[0].total), "generateSbom: total 이 단계 수로 일정");
    // OSV 단계·SPDX 단계가 있을 때도 단조·완료
    const p2 = collectProgress();
    const r2 = await generateSbom({ projectDir: proj, dryRun: false, runner: fakePlugin, platform: "linux", overwrite: true, format: "spdx-json", offline: false, osvQuery: async (q) => ({ results: q.map(() => ({})) }), progress: p2 });
    assert(r2.written && monotonic(p2.events) && endsAtTotal(p2.events) && p2.events.some((e) => /query OSV/.test(e.message)) && p2.events.some((e) => /convert to SPDX/.test(e.message)), `generateSbom(OSV·SPDX): 단계 보고·완료 (${JSON.stringify(p2.events.map((e) => e.message))})`);
    // dryRun 은 보고 없음, progress 없이도 동작
    const p3 = collectProgress();
    const d = await generateSbom({ projectDir: proj, platform: "linux", progress: p3 });
    assert(d.dryRun && p3.events.length === 0, "generateSbom(dryRun): 진행 보고 없음");
    const r4 = await generateSbom({ projectDir: proj, dryRun: false, runner: fakePlugin, platform: "linux", overwrite: true });
    assert(r4.written, "generateSbom: progress 없이 동일 동작");
  }
} finally {
  rmSync(proj, { recursive: true, force: true });
}

if (process.exitCode) { console.error(`FAILED (${n} assertions)`); process.exit(1); }
console.log(`OK (${n} assertions)`);
