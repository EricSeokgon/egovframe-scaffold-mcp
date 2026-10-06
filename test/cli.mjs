// node test/cli.mjs — CLI 모드(v0.39) 오프라인 검증: 인자 해석·형 변환·--fail-on·종료 코드·JSON 동일성·파일 출력·실제 프로세스.
import { parseArgs, kebabToCamel, coerceArgs, parseFailOn, evaluateFailOn, runCli, CLI_EXIT, CLI_COMMANDS, cliUsage, checkDependencies, SERVER_VERSION } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
const io = (cwd, env = {}) => { const o = { out: "", err: "" }; return { o, io: { stdout: (s) => { o.out += s; }, stderr: (s) => { o.err += s; }, env, cwd } }; };

// ── 순수 함수 ──────────────────────────────────────────
const p = parseArgs(["assess", "--project", "x", "--json", "--offline=false", "--no-resolve", "--top-n", "5", "--fail-on", "supplyChain:C"]);
assert(p.command === "assess" && p.options.project === "x" && p.options.json === true && p.options.offline === "false" && p.options.resolve === false && p.options["top-n"] === "5" && p.options["fail-on"] === "supplyChain:C", "parseArgs: 값·=·플래그·--no-");
assert(parseArgs(["check", "--json", "--resolve"]).options.resolve === true && parseArgs(["a", "b"]).positional[0] === "b" && parseArgs([]).command === null, "parseArgs: 끝 플래그·위치 인자·빈 인자");
assert(kebabToCamel("resolve-scope") === "resolveScope" && kebabToCamel("top-n") === "topN" && kebabToCamel("offline") === "offline", "kebab → camel");
const schema = { properties: { offline: { type: "boolean" }, topN: { type: "integer" }, sections: { type: "array", items: { type: "string" } }, resolveScope: { type: "string" } } };
const c = coerceArgs({ offline: "false", "top-n": "7", sections: "components,assessment", "resolve-scope": "all", json: true, project: "x", bogus: "1" }, schema);
assert(c.args.offline === false && c.args.topN === 7 && c.args.sections.join("|") === "components|assessment" && c.args.resolveScope === "all" && !("json" in c.args) && !("project" in c.args) && c.unknown.join() === "--bogus", "coerceArgs: 스키마 형으로 변환·CLI 플래그 제외·모르는 옵션 보고");
assert(coerceArgs({ topN: "abc" }, schema).args.topN === "abc", "숫자가 아니면 그대로(도구 검증이 거부)");
const conds = parseFailOn("supplyChain:C,manual>20,vulnerabilities", ["migration", "supplyChain", "manual", "vulnerabilities"], ["migration", "supplyChain"]);
assert(conds.length === 3 && conds[0].op === ">=" && conds[0].value === 2 && conds[1].value === 20 && conds[2].op === ">" && conds[2].value === 0, "parseFailOn: 등급(C=2 이상)·임계값·존재");
assert(evaluateFailOn(conds, { supplyChain: 1, manual: 21, vulnerabilities: 0 }).map((x) => x.text).join() === "manual>20" && evaluateFailOn(conds, { supplyChain: 3, manual: 0, vulnerabilities: 2 }).length === 2, "evaluateFailOn");
for (const [bad, re] of [["nope", /알 수 없는 지표/], ["supplyChain", /등급 지표/], ["manual:C", /등급 조건/], ["manual>>3", /형식 오류/]]) {
  let msg = ""; try { parseFailOn(bad, ["supplyChain", "manual"], ["supplyChain"]); } catch (e) { msg = e.message; }
  assert(re.test(msg), `parseFailOn 거부: ${bad}`);
}
assert(Object.keys(CLI_COMMANDS).join(",") === "assess,check,sbom,migrate,validate,diagnose,network" && cliUsage().includes("종료 코드: 0 통과 · 2 --fail-on 기준 초과 · 3 실행 실패 · 64 사용법 오류"), "명령 7종·사용법");

// ── runCli (같은 프로세스) ────────────────────────────────
const proj = mkdtempSync(path.join(tmpdir(), "egovcli-"));
write(proj, "pom.xml", `<project><properties><egovframework.rte.version>3.10.0</egovframework.rte.version></properties>
<repositories><repository><id>e</id><url>http://maven.egovframe.go.kr/maven/</url></repository></repositories><dependencies>
<dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.ptl.mvc</artifactId><version>\${egovframework.rte.version}</version></dependency>
<dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>3.1.0</version></dependency>
<dependency><groupId>commons-dbcp</groupId><artifactId>commons-dbcp</artifactId><version>1.4</version></dependency>
</dependencies></project>\n`);
write(proj, "src/main/java/egovframework/com/cmm/Svc.java", "import javax.servlet.http.HttpServletRequest;\nimport egovframework.rte.psl.dataaccess.mapper.Mapper;\nclass Svc {}\n");

let t = io(proj);
assert((await runCli(["--help"], t.io)) === CLI_EXIT.ok && t.o.out.includes("명령:"), "--help → 0");
t = io(proj); assert((await runCli(["--version"], t.io)) === 0 && t.o.out.trim() === SERVER_VERSION, "--version");
t = io(proj); assert((await runCli(["bogus"], t.io)) === CLI_EXIT.usage && t.o.err.includes("알 수 없는 명령"), "알 수 없는 명령 → 64");
t = io(proj); assert((await runCli(["check", "--nope"], t.io)) === 64 && t.o.err.includes("--nope"), "모르는 옵션 → 64");
t = io(proj); assert((await runCli(["migrate", "--apply"], t.io)) === 64 && t.o.err.includes("apply"), "쓰기 옵션(migrate --apply) 차단 → 64");
t = io(proj); assert((await runCli(["check", "--fail-on", "nope"], t.io)) === 64, "잘못된 --fail-on → 64");
t = io(proj); assert((await runCli(["check", "extra"], t.io)) === 64, "위치 인자 → 64");

t = io(proj);
const codeCheck = await runCli(["check", "--json"], t.io);
const direct = await checkDependencies({ projectDir: proj });
assert(codeCheck === 0 && JSON.stringify(JSON.parse(t.o.out)) === JSON.stringify(JSON.parse(JSON.stringify(direct))), "check --json = 라이브러리 결과(=MCP structuredContent)");
assert(/egovframe-scaffold-mcp check: 의존성 \d+건/.test(t.o.err) && !t.o.err.includes("\n\n"), "stderr 한 줄 요약");

t = io(proj);
assert((await runCli(["assess", "--fail-on", "migration:B"], t.io)) === CLI_EXIT.failOn && t.o.out.includes("# 표준프레임워크 5.x 전환 준비도 평가서") && t.o.err.includes("초과(migration:B)"), "assess --fail-on migration:B → 2 (기본 --project 는 현재 디렉터리)");
t = io(proj);
assert((await runCli(["assess", "--fail-on", "migration:D", "--json"], t.io)) === 0 && JSON.parse(t.o.out).assessment.grades.migration.grade !== "D" && !("markdown" in JSON.parse(t.o.out)), "assess --json(markdown 제외), 기준 미달이면 0");
const summary = path.join(proj, "summary.md");
t = io(proj, { GITHUB_STEP_SUMMARY: summary });
assert((await runCli(["assess", "--out", "out/assess.md", "--step-summary", "--top-n", "3"], t.io)) === 0 && readFileSync(path.join(proj, "out/assess.md"), "utf8") === t.o.out && readFileSync(summary, "utf8").includes("## 6. 등급과 근거"), "--out 파일·--step-summary 덧붙임·도구 옵션(--top-n)");
t = io(proj);
assert((await runCli(["migrate", "--json", "--fail-on", "manual"], t.io)) === 2 && JSON.parse(t.o.out).sourceEra === "3.x", "migrate 진단 --fail-on manual → 2");
t = io(proj);
assert((await runCli(["sbom"], t.io)) === 0 && t.o.err.includes("계획만(dryRun)") && !existsSync(path.join(proj, "sbom")), "sbom 은 --write 없으면 계획만");
t = io(proj);
assert((await runCli(["sbom", "--dry-run=false"], t.io)) === 64, "sbom --dry-run 직접 지정 차단(→ --write)");
t = io(proj);
assert((await runCli(["diagnose", "--project", path.join(proj, "missing")], t.io)) === CLI_EXIT.error, "실행 실패(없는 디렉터리) → 3");
t = io(proj);
assert((await runCli(["validate", "--fail-on", "invalid"], t.io)) === 2, "validate --fail-on invalid(매니페스트 없음) → 2");

// ── 실제 프로세스: 인자 없으면 서버, 있으면 CLI ─────────────
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const v = spawnSync(process.execPath, [entry, "--version"], { encoding: "utf8" });
assert(v.status === 0 && v.stdout.trim() === SERVER_VERSION, "프로세스: --version → 0");
const a = spawnSync(process.execPath, [entry, "assess", "--project", proj, "--fail-on", "supplyChain:A"], { encoding: "utf8" });
assert(a.status === 2 && a.stdout.includes("전환 준비도 평가서") && a.stderr.includes("fail-on supplyChain:A: 초과"), `프로세스: assess --fail-on supplyChain:A → 2 (${a.status})`);
const u = spawnSync(process.execPath, [entry, "nope"], { encoding: "utf8" });
assert(u.status === 64, "프로세스: 알 수 없는 명령 → 64");

rmSync(proj, { recursive: true, force: true });
if (process.exitCode) console.error(`cli FAIL (${n} assertions)`); else console.log(`cli OK (${n} assertions)`);
