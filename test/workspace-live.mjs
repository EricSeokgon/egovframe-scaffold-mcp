// node test/workspace-live.mjs — 멀티 모듈·MSA 작업공간(v0.47) 실자산 검증 (CI 통합: 네트워크·Maven·JDK 17·Docker)
//   공식 MSA 템플릿 3종(msa-common-components: Maven 11 모듈 · msa-edu: Gradle 독립 10 · msa-portal-backend: Gradle 독립 9)으로
//   (1) 작업공간 탐지·모듈별 의존성 점검(예전 0건이던 Gradle 두 템플릿 포함)·5.x 최신 유지(Gradle 버전 변수)·보안약점 모듈 표·평가서
//   (2) 다중 서비스 배포 산출물: 공식 Compose 스키마·docker compose config·kubeconform(KUBECONFORM)·hadolint(HADOLINT)
//   (3) msa-common-components 를 5.0.2 로 갱신 → 루트 mvn package → compose 로 ConfigServer·EurekaServer·GatewayServer·EgovBoard(+MySQL·RabbitMQ) 기동
//       → 컨테이너 healthy · Eureka 에 GATEWAYSERVER·EGOVBOARD UP · Gateway health UP
//   저장소(브랜치 기준) 템플릿이라 건수는 로그로 남기고, 구조(모듈 수·라이브러리·서비스)와 0 이 아님만 단언한다.
//   DEPLOY_LIVE_BASE_REGISTRY 가 있으면 기반 이미지를 그 레지스트리에서 받는다(Docker Hub 요청 한도 회피).
import { mkdtempSync, rmSync, copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateCompose } from "./spec-schemas.mjs";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: opts.timeout ?? 1_200_000, cwd: opts.cwd, env: { ...process.env, DOCKER_BUILDKIT: "1" } }); return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = mkdtempSync(path.join(tmpdir(), "egovws-live-"));
const registry = process.env.DEPLOY_LIVE_BASE_REGISTRY || "docker.io/library";
const EXPECT = { "msa-common-components": { kind: "maven-modules", modules: 11, libraries: 0 }, "msa-edu": { kind: "independent", modules: 10, libraries: 1 }, "msa-portal-backend": { kind: "independent", modules: 9, libraries: 0 } };
let composeDir = null;

try {
  const dirs = {};
  for (const [template, exp] of Object.entries(EXPECT)) {
    const c = await m.createProject({ template, projectName: `ws-${template}`, groupId: "egovframework.example", outputDir: root, database: "mysql" });
    const dir = dirs[template] = c.projectPath;
    const ws = m.detectWorkspace(dir);
    assert(ws.kind === exp.kind && ws.modules.length === exp.modules && ws.modules.filter((x) => x.library).length === exp.libraries, `${template}: 작업공간 ${ws.kind} · 모듈 ${ws.modules.length} · 라이브러리 ${ws.modules.filter((x) => x.library).length}`);
    const dep = await m.checkDependencies({ projectDir: dir });
    assert(dep.findings.length > 0 && dep.workspace?.modules.length === exp.modules && dep.summary.unversioned === 0 && dep.parent.kind === "boot", `${template}: 모듈별 의존성 ${dep.findings.length}건 · 버전 없음 0 · parent ${dep.parent.version}`);
    info(`${template} 의존성 ${JSON.stringify(dep.summary)}`);
    const up = m.updateProject({ projectDir: dir });
    assert(up.summary.auto > 0 && up.update.from && up.update.modules?.length === exp.modules, `${template}: 5.x 최신 유지 ${up.update.from} → ${up.update.to} · 자동 ${up.summary.auto} · 수동 ${up.summary.manual}`);
    const sc = await m.checkSecureCoding({ projectDir: dir, maxFindings: 1 });
    assert(sc.byModule?.length === exp.modules, `${template}: 보안약점 모듈 표 ${sc.byModule?.length}행 (합계 ${sc.summary.total})`);
    const a = await m.assessProject({ projectDir: dir });
    assert(a.modules?.length === exp.modules, `${template}: 평가서 모듈 표 · 전환 ${a.grades.migration.grade} · 공급망 ${a.grades.supplyChain.grade}`);

    const g = await m.generateDeploy({ projectDir: dir, buildInImage: false, imageRegistry: registry });
    const compose = g.files.find((f) => f.path === "deploy/docker-compose.yml")?.content;
    const services = g.workspace?.services.length ?? 0;
    assert(g.supported && services === exp.modules - exp.libraries && compose && validateCompose(compose) === null, `${template}: 서비스 ${services}개 · 인프라 ${g.workspace?.infra.map((i) => i.name).join("·") || "없음"} · compose 공식 스키마`);
    // SLF4J 공급자 고정: msa-common-components 는 log4j-slf4j2-impl + spring-boot-starter-logging(10개 서비스), Gradle 두 템플릿은 fdl-logging 을 빼 두어 0
    const pinned = g.workspace.services.filter((x) => x.env.includes("JAVA_TOOL_OPTIONS")).map((x) => x.name);
    assert(template === "msa-common-components" ? pinned.includes("configserver") && pinned.length === 10 && compose.includes("-Dslf4j.provider=ch.qos.logback.classic.spi.LogbackServiceProvider") : pinned.length === 0, `${template}: SLF4J 공급자 logback 고정 ${pinned.length}개 서비스`);
    const w = await m.generateDeploy({ projectDir: dir, buildInImage: false, imageRegistry: registry, dryRun: false });
    copyFileSync(path.join(dir, "deploy/.env.example"), path.join(dir, "deploy/.env"));
    const cfg = sh("docker", ["compose", "config", "-q"], { cwd: path.join(dir, "deploy"), timeout: 60_000 });
    assert(w.written && cfg.code === 0, `${template}: docker compose config${cfg.code ? `\n${cfg.out}` : ""}`);
    if (process.env.KUBECONFORM) { const k = sh(process.env.KUBECONFORM, ["-strict", "-summary", "-kubernetes-version", "1.31.0", "deploy/k8s"], { cwd: dir, timeout: 180_000 }); assert(k.code === 0, `${template}: kubeconform — ${k.out.trim().split("\n").pop()}`); }
    if (process.env.HADOLINT) for (const s of g.workspace.services.filter((x) => !x.ownDockerfile).slice(0, 3)) { const h = sh(process.env.HADOLINT, [path.join(s.module, "Dockerfile")], { cwd: dir }); assert(h.code === 0, `${template}: hadolint ${s.module}/Dockerfile${h.code ? `\n${h.out}` : ""}`); }
  }

  // (3) msa-common-components 실제 기동
  const dir = dirs["msa-common-components"];
  if (sh("docker", ["info"], { timeout: 30_000 }).code !== 0) { info("Docker 데몬 없음 — 기동 검증 건너뜀"); }
  else {
    const ap = await m.applyUpdate({ projectDir: dir, dryRun: false });
    // 모듈 parent 11곳 + EgovQuestionnaire 의 중복 의존성 선언 2건(commons-configuration2·commons-lang3 — CI 의 Maven 은 "must be unique" 오류로 거부)
    assert(ap.applied.items === 13 && ap.remaining.auto === 0, `msa-common-components: 자동 ${ap.applied.items}건 적용(모듈 parent 11곳 5.0.2 · 중복 선언 2건 제거)`);
    info(sh(process.platform === "win32" ? "mvn.cmd" : "mvn", ["-v"], { timeout: 60_000 }).out.split("\n").find((l) => /Apache Maven/.test(l)) ?? "mvn -v 실패");
    const mvn = sh(process.platform === "win32" ? "mvn.cmd" : "mvn", ["-B", "-q", "-DskipTests", "-Dproject.build.sourceEncoding=UTF-8", "package"], { cwd: dir, timeout: 1_500_000 });
    assert(mvn.code === 0 && existsSync(path.join(dir, "EgovBoard/target")), `msa-common-components: 루트 mvn package(11 모듈, parent 5.0.2)${mvn.code ? `\n${mvn.out.slice(-3000)}` : ""}`);
    if (mvn.code === 0) {
      composeDir = path.join(dir, "deploy");
      const env = readFileSync(path.join(composeDir, ".env"), "utf8").replace(/^BASE_REGISTRY=.*$/m, `BASE_REGISTRY=${registry}`);
      writeFileSync(path.join(composeDir, ".env"), env);
      const t0 = Date.now();
      const upc = sh("docker", ["compose", "up", "-d", "--build", "--wait", "--wait-timeout", "600", "configserver", "eurekaserver", "gatewayserver", "egovboard"], { cwd: composeDir, timeout: 1_500_000 });
      const ps = sh("docker", ["compose", "ps", "-a", "--format", "{{.Service}} {{.Health}}"], { cwd: composeDir }).out.trim();
      if (upc.code) info(sh("docker", ["compose", "ps", "-a", "--format", "{{.Service}} {{.State}} {{.Status}}"], { cwd: composeDir }).out.trim());
      assert(upc.code === 0 && ["configserver", "eurekaserver", "gatewayserver", "egovboard", "db", "rabbitmq"].every((s) => new RegExp(`^${s} healthy$`, "m").test(ps)), `compose 기동 ${Math.round((Date.now() - t0) / 1000)}초 — ${ps.replace(/\n/g, " · ")}${upc.code ? `\n${upc.out.slice(-3000)}` : ""}`);
      let apps = [];
      for (let i = 0; i < 40; i++) {
        try { const r = await fetch("http://127.0.0.1:8761/eureka/apps", { headers: { Accept: "application/json" } }); const j = await r.json(); apps = (j.applications?.application ?? []).map((x) => `${x.name}:${x.instance?.[0]?.status}`); } catch { /* 기동 중 */ }
        if (apps.includes("GATEWAYSERVER:UP") && apps.includes("EGOVBOARD:UP")) break;
        await sleep(3000);
      }
      assert(apps.includes("GATEWAYSERVER:UP") && apps.includes("EGOVBOARD:UP"), `Eureka 등록: ${apps.join(", ") || "없음"} (설정 서버·DB 사본·브로커 계정이 맞아야 EgovBoard 가 뜸)`);
      const gw = await fetch("http://127.0.0.1:9000/actuator/health").then((r) => r.json()).catch(() => null);
      assert(gw?.status === "UP", `Gateway health ${gw?.status ?? "응답 없음"}`);
      if (process.exitCode) info(sh("docker", ["compose", "logs", "--tail", "40", "egovboard", "configserver", "rabbitmq"], { cwd: composeDir }).out.slice(-6000));
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  if (composeDir) sh("docker", ["compose", "down", "-v"], { cwd: composeDir, timeout: 180_000 });
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`workspace-live FAIL (${n} assertions)`); else console.log(`workspace-live OK (${n} assertions)`);
