// node test/observability-live.mjs — 관측 내보내기(v1.16) 실자산 검증 (CI 통합: 네트워크·Docker·Maven·JDK 17)
//   공식 boot-web(Boot jar)·web(Classic war → Tomcat)을 generate_egovframe_deploy(observability="otel", buildInImage=false)로 만들어
//   docker compose 로 앱 + 수집기를 띄우고 HTTP 요청 1건 뒤 수집기 debug 출력에 trace(span)·metric·log 가 도착하는지,
//   에이전트 기동 시간이 에이전트 없을 때의 2배 이내인지(같은 이미지, JAVA_TOOL_OPTIONS 만 다름), hadolint·kubeconform(있으면) 통과를 본다.
//   web 은 deploy/otel/ 에 jar 를 미리 둔 폐쇄망 경로, boot-web 은 OTEL_AGENT_URL 경로(OBS_LIVE_AGENT_URL 로 미러 지정 가능).
//   OBS_LIVE_REGISTRY 로 기반 이미지 레지스트리(예: mirror.gcr.io/library), OBS_LIVE_COLLECTOR_IMAGE 로 수집기 이미지.
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900_000, cwd: opts.cwd, env: { ...process.env, DOCKER_BUILDKIT: "1", ...(opts.env ?? {}) } }); return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (sh("docker", ["info"], { timeout: 30_000 }).code !== 0) { console.log("skip: Docker 데몬 없음"); process.exit(0); }
const rules = m.loadDeployRules().observability;
const registry = process.env.OBS_LIVE_REGISTRY || "docker.io/library";
const agentUrl = process.env.OBS_LIVE_AGENT_URL || rules.agent.url;
const root = mkdtempSync(path.join(tmpdir(), "egov-obs-live-"));
const mvn = process.platform === "win32" ? "mvn.cmd" : "mvn";
const projects = [];

// 폐쇄망 경로용 jar 한 번 받기(지문 확인)
const agentJar = path.join(root, "opentelemetry-javaagent.jar");
{
  const res = await fetch(agentUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(buf).digest("hex");
  assert(res.ok && sha === rules.agent.sha256, `에이전트 ${rules.agent.version} 내려받기·sha256 일치 (${res.status}, ${sha.slice(0, 12)}…)`);
  writeFileSync(agentJar, buf);
}

try {
  let port = 18280;
  for (const [template, airGapped] of [["boot-web", false], ["web", true]]) {
    const c = await m.createProject({ template, projectName: `obs-${template}`, groupId: "egovframework.example", outputDir: root, database: "hsql" });
    const dir = c.projectPath;
    const b = sh(mvn, ["-B", "-q", "-DskipTests", "package"], { cwd: dir });
    assert(b.code === 0, `${template}: 호스트 mvn package${b.code ? `\n${b.out.slice(-1500)}` : ""}`);
    const r = await m.generateDeploy({ projectDir: dir, observability: "otel", buildInImage: false, dryRun: false });
    assert(r.written && r.files.some((f) => f.path === "deploy/otel/collector.yaml"), `${template}: 관측 산출물 ${r.files.length}개`);
    if (process.env.HADOLINT) { const h = sh(process.env.HADOLINT, ["Dockerfile"], { cwd: dir }); assert(h.code === 0, `${template}: hadolint 경고 0${h.code ? `\n${h.out}` : ""}`); }
    if (process.env.KUBECONFORM) { const k = sh(process.env.KUBECONFORM, ["-strict", "-summary", "-kubernetes-version", "1.31.0", `deploy/k8s/${r.profile.appName}.yaml`], { cwd: dir, timeout: 120_000 }); assert(k.code === 0, `${template}: kubeconform(수집기 ConfigMap·Deployment·Service 포함)${k.code ? `\n${k.out}` : ""}`); }
    if (airGapped) copyFileSync(agentJar, path.join(dir, "deploy/otel/opentelemetry-javaagent.jar"));
    const env = readFileSync(path.join(dir, "deploy/.env.example"), "utf8")
      .replace(/^BASE_REGISTRY=.*$/m, `BASE_REGISTRY=${registry}`)
      .replace(/^APP_PORT=.*$/m, `APP_PORT=${port}`)
      .replace(/^OTEL_METRIC_EXPORT_INTERVAL=.*$/m, "OTEL_METRIC_EXPORT_INTERVAL=5000")
      .replace(/^OTEL_COLLECTOR_IMAGE=.*$/m, `OTEL_COLLECTOR_IMAGE=${process.env.OBS_LIVE_COLLECTOR_IMAGE || `${rules.collector.image}:${rules.collector.version}`}`)
      .replace(/^# OTEL_AGENT_URL=.*$/m, airGapped ? "OTEL_AGENT_URL=http://127.0.0.1:9/unreachable.jar" : `OTEL_AGENT_URL=${agentUrl}`);
    writeFileSync(path.join(dir, "deploy/.env"), env);
    const deployDir = path.join(dir, "deploy");
    projects.push(deployDir);
    const t0 = Date.now();
    const up = sh("docker", ["compose", "up", "-d", "--build"], { cwd: deployDir });
    assert(up.code === 0, `${template}: docker compose up --build(${airGapped ? "deploy/otel/ 의 jar — 다운로드 주소는 닿지 않는 곳" : "OTEL_AGENT_URL 에서 받음"}) ${Math.round((Date.now() - t0) / 1000)}초${up.code ? `\n${up.out.slice(-3000)}` : ""}`);
    if (up.code !== 0) continue;
    const startRe = r.profile.runtime === "boot" ? /Started \S+ in ([\d.]+) seconds/ : /Server startup in \[?([\d,]+)\]? ?(?:ms|milliseconds)/;
    let logs = "";
    for (let i = 0; i < 100 && !startRe.test(logs); i++) { await sleep(3000); logs = sh("docker", ["compose", "logs", "app"], { cwd: deployDir }).out; }
    const started = logs.match(startRe);
    assert(started && /opentelemetry-javaagent - version: /.test(logs), `${template}: 에이전트(${rules.agent.version})를 붙여 기동${started ? "" : `\n${logs.slice(-3000)}`}`);
    const withAgentSec = started ? (r.profile.runtime === "boot" ? Number(started[1]) : Number(started[1].replace(/,/g, "")) / 1000) : NaN;
    let status = 0;
    for (let i = 0; i < 20 && !(status >= 200 && status < 400); i++) { try { status = (await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" })).status; } catch { /* 기동 중 */ } if (!(status >= 200 && status < 400)) await sleep(3000); }
    assert(status >= 200 && status < 400, `${template}: HTTP ${status}`);
    // 수집기 debug 출력: trace·metric·log
    let col = "", spans = 0, metrics = 0, logRecords = 0;
    for (let i = 0; i < 20 && !(spans && metrics && logRecords); i++) {
      await sleep(3000);
      col = sh("docker", ["compose", "logs", "otel-collector"], { cwd: deployDir }).out;
      spans = [...col.matchAll(/"spans": (\d+)/g)].reduce((s, x) => s + Number(x[1]), 0);
      metrics = [...col.matchAll(/"metrics": (\d+)/g)].reduce((s, x) => s + Number(x[1]), 0);
      logRecords = [...col.matchAll(/"log records": (\d+)/g)].reduce((s, x) => s + Number(x[1]), 0);
    }
    info(`${template}: 수집기 수신 span ${spans} · metric ${metrics} · log ${logRecords}`);
    assert(spans > 0 && metrics > 0 && logRecords > 0, `${template}: 수집기에 trace·metric·log 도착${spans && metrics && logRecords ? "" : `\n${col.slice(-2000)}`}`);
    // 같은 이미지를 에이전트 없이(JAVA_TOOL_OPTIONS 없음) 띄워 기동 시간 비교
    const image = r.files.length && sh("docker", ["compose", "config", "--images"], { cwd: deployDir }).out.split("\n").find((x) => x.includes(r.profile.appName))?.trim();
    const name = `egov-obs-noagent-${template}`;
    sh("docker", ["rm", "-f", name]);
    const run = sh("docker", ["run", "-d", "--name", name, image]);
    let plain = "";
    for (let i = 0; i < 100 && run.code === 0 && !startRe.test(plain); i++) { await sleep(3000); plain = sh("docker", ["logs", name]).out; }
    const p = plain.match(startRe);
    const noAgentSec = p ? (r.profile.runtime === "boot" ? Number(p[1]) : Number(p[1].replace(/,/g, "")) / 1000) : NaN;
    sh("docker", ["rm", "-f", name]);
    info(`${template}: 기동 ${withAgentSec}s(에이전트) / ${noAgentSec}s(없음)`);
    assert(p && !/opentelemetry-javaagent/.test(plain) && withAgentSec <= Math.max(noAgentSec * 2, noAgentSec + 10), `${template}: JAVA_TOOL_OPTIONS 없으면 에이전트가 붙지 않고, 붙여도 기동 시간 2배 이내(작은 앱은 +10초 여유) (${withAgentSec}s / ${noAgentSec}s)`);
    port++;
  }
} finally {
  for (const d of projects) sh("docker", ["compose", "down", "-v", "--rmi", "local"], { cwd: d, timeout: 120_000 });
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`observability-live FAIL (${n} assertions)`); else console.log(`observability-live OK (${n} assertions)`);
