// node test/deploy-live.mjs — 컨테이너·배포 산출물(v0.45) 실자산 검증(CI 통합: 네트워크·Docker 필요).
//   공식 템플릿을 실제로 만들고 generate_egovframe_deploy(기본: 이미지 안에서 빌드)로 —
//   (1) egov web(Classic war)·boot-web(Boot jar): hadolint 경고 0·kubeconform(1.31) 통과 → docker build → 컨테이너 기동 → HTTP 200·HEALTHCHECK healthy·비루트
//   (2) simple-backend(Boot + MySQL): docker compose up --build → actuator readiness UP → MySQL 초기화 데이터가 API 응답에 나옴
//   HADOLINT·KUBECONFORM 환경 변수에 실행 파일 경로가 있으면 린트도 돈다(CI 단계가 내려받음).
//   DEPLOY_LIVE_PREBUILT=1 이면 호스트에서 mvn package 후 buildInImage=false 로 만든다(컨테이너 안에서 Maven 저장소에 닿지 않는 환경).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900_000, cwd: opts.cwd, env: { ...process.env, DOCKER_BUILDKIT: "1" } }); return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, okFn, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const res = await fetch(url, { redirect: "manual" }); const body = await res.text(); if (okFn(res.status, body)) return { status: res.status, body, secs: i * 3 }; } catch { /* 기동 중 */ }
    await sleep(3000);
  }
  return null;
}
const prebuilt = process.env.DEPLOY_LIVE_PREBUILT === "1";
const mvn = process.platform === "win32" ? "mvn.cmd" : "mvn";
const prebuild = (dir) => { const r = sh(mvn, ["-B", "-q", "-DskipTests", "package"], { cwd: dir }); assert(r.code === 0, `호스트 mvn package(${path.basename(dir)})${r.code ? `\n${r.out.slice(-2000)}` : ""}`); };
const hasDocker = sh("docker", ["info"], { timeout: 30_000 }).code === 0;
const root = mkdtempSync(path.join(tmpdir(), "egovdeploy-live-"));
try {
  if (!hasDocker) { console.log("skip: Docker 데몬 없음"); process.exit(0); }
  let port = 18180;
  for (const [template, expectRuntime] of [["web", "tomcat"], ["boot-web", "boot"]]) {
    const c = await m.createProject({ template, projectName: `d-${template}`, groupId: "egovframework.example", outputDir: root, database: "mysql" });
    if (prebuilt) prebuild(c.projectPath);
    const r = await m.generateDeploy({ projectDir: c.projectPath, dryRun: false, buildInImage: !prebuilt });
    assert(r.written && r.profile.runtime === expectRuntime, `${template}: 배포 산출물 ${r.files.length}개(${r.profile.packaging} → ${r.profile.runtime})`);
    if (process.env.HADOLINT) { const h = sh(process.env.HADOLINT, ["Dockerfile"], { cwd: c.projectPath }); assert(h.code === 0, `${template}: hadolint 경고 0${h.code ? `\n${h.out}` : ""}`); }
    if (process.env.KUBECONFORM) { const k = sh(process.env.KUBECONFORM, ["-strict", "-summary", "-kubernetes-version", "1.31.0", `deploy/k8s/${r.profile.appName}.yaml`], { cwd: c.projectPath, timeout: 120_000 }); assert(k.code === 0, `${template}: kubeconform(쿠버네티스 1.31) — ${k.out.trim().split("\n").pop()}`); }
    const tag = `egov-deploy-live/${template}:test`;
    const t0 = Date.now();
    const b = sh("docker", ["build", "-q", "-t", tag, "."], { cwd: c.projectPath });
    assert(b.code === 0, `${template}: docker build(${prebuilt ? "미리 빌드한 산출물" : "이미지 안에서 Maven 빌드"}) ${Math.round((Date.now() - t0) / 1000)}초${b.code ? `\n${b.out.slice(-3000)}` : ""}`);
    if (b.code !== 0) continue;
    const name = `egov-deploy-live-${template}`;
    sh("docker", ["rm", "-f", name]);
    const run = sh("docker", ["run", "-d", "--name", name, "-p", `${port}:${r.profile.port}`, tag]);
    const ok = run.code === 0 ? await waitHttp(`http://127.0.0.1:${port}${r.profile.contextPath || "/"}`, (s) => s >= 200 && s < 400) : null;
    assert(ok, `${template}: 컨테이너 기동 → HTTP ${ok?.status ?? "응답 없음"}${ok ? `(${ok.secs}초)` : `\n${sh("docker", ["logs", "--tail", "80", name]).out}`}`);
    let health = "";
    for (let i = 0; i < 40 && health !== "healthy"; i++) { health = sh("docker", ["inspect", "-f", "{{.State.Health.Status}}", name]).out.trim(); if (health !== "healthy") await sleep(3000); }
    const uid = sh("docker", ["exec", name, "id", "-u"]).out.trim();
    assert(health === "healthy" && uid === "10001", `${template}: HEALTHCHECK ${health} · 실행 사용자 uid ${uid}`);
    sh("docker", ["rm", "-f", name]);
    port++;
  }

  // (2) Boot + MySQL compose — 공식 simple-backend 는 자체 Dockerfile 이 있어 deploy/ 아래에 만든다
  const sb = await m.createProject({ template: "simple-backend", projectName: "d-simple-backend", groupId: "egovframework.example", outputDir: root, database: "mysql" });
  if (prebuilt) prebuild(sb.projectPath);
  const rs = await m.generateDeploy({ projectDir: sb.projectPath, dryRun: false, dockerfilePath: "deploy/Dockerfile", buildInImage: !prebuilt });
  assert(rs.written && rs.profile.db?.type === "mysql" && rs.profile.db.inject === "env" && rs.profile.db.initScripts.length === 2 && rs.profile.readiness.endsWith("/actuator/health/readiness"), `simple-backend: MySQL·환경 변수 주입·초기화 ${rs.profile.db?.initScripts.join(", ")}`);
  const deployDir = path.join(sb.projectPath, "deploy");
  sh("cp", [".env.example", ".env"], { cwd: deployDir });
  const up = sh("docker", ["compose", "up", "-d", "--build"], { cwd: deployDir, timeout: 1_200_000 });
  assert(up.code === 0, `simple-backend: docker compose up --build${up.code ? `\n${up.out.slice(-3000)}` : ""}`);
  if (up.code === 0) {
    const ready = await waitHttp(`http://127.0.0.1:${rs.profile.port}${rs.profile.readiness}`, (s, body) => s === 200 && body.includes("UP"), 80);
    assert(ready, `simple-backend: readiness UP${ready ? `(${ready.secs}초)` : `\n${sh("docker", ["compose", "logs", "--tail", "80"], { cwd: deployDir }).out}`}`);
    const main = ready ? await waitHttp(`http://127.0.0.1:${rs.profile.port}/mainPage`, (s) => s === 200, 10) : null;
    assert(main && /"resultCode"\s*:\s*200/.test(main.body) && main.body.includes("nttSj"), "simple-backend: /mainPage 가 MySQL 초기화 데이터(게시물)를 돌려줌 — 환경 변수로 DB 연결");
  }
  sh("docker", ["compose", "down", "-v"], { cwd: deployDir, timeout: 180_000 });
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`deploy-live FAIL (${n} assertions)`); else console.log(`deploy-live OK (${n} assertions)`);
