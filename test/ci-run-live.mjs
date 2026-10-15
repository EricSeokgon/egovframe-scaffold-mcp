// node test/ci-run-live.mjs — 생성 CI 설정의 실제 실행 검증 (v0.46, CI 통합: 네트워크·Docker 필요)
//   공식 web 템플릿(Classic war)에 generate_egovframe_ci(supplyChain·secureCoding·supplier) 로 만든 파일을 실제 빌드 서버에서 돌린다.
//   (1) Jenkins — 공식 jenkins/jenkins LTS 이미지 + 고정 플러그인(test/fixtures/jenkins/plugins.txt, 의존성까지 버전 고정)
//       선언형 문법 검증(pipeline-model-converter/validate) → Pipeline from SCM(file:///repo) 실행 →
//       결과 SUCCESS · Build/SBOM/SBOM check/Secure coding/Assessment 단계 · 보관 산출물
//   (2) GitLab — gitlab-ci-local(고정 버전)으로 생성 .gitlab-ci.yml 의 build·supply-chain job 을 Docker 실행기로 실행 →
//       두 job 성공 · 산출물(평가서·SBOM 점검·CycloneDX·SARIF)
//   아직 배포되지 않은 이 버전을 쓰도록 생성 파일의 `npx -y egovframe-scaffold-mcp@<버전>` 만 같은 버전의 npm pack 산출물 경로로 바꾼다(그 밖의 내용은 생성 그대로).
//   CI_RUN_LIVE=jenkins|gitlab 으로 하나만 돌릴 수 있다. 프록시 뒤라면 HTTPS_PROXY 와 CI_RUN_LIVE_CA(프록시 CA PEM)를 주면 이미지·작업에 전달한다.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const REPO = fileURLToPath(new URL("..", import.meta.url));
const JENKINS_IMAGE = "jenkins/jenkins:2.580.1-lts-jdk21";
const GITLAB_CI_LOCAL = "gitlab-ci-local@4.76.1";
const PORT = 18090;
const only = process.env.CI_RUN_LIVE;
const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: opts.timeout ?? 1_800_000, cwd: opts.cwd, input: opts.input, env: { ...process.env, ...(opts.env ?? {}) } }); return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tail = (s, k = 4000) => s.slice(-k);

// 프록시(선택)
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const proxyCa = process.env.CI_RUN_LIVE_CA && existsSync(process.env.CI_RUN_LIVE_CA) ? process.env.CI_RUN_LIVE_CA : null;
const proxy = proxyUrl && proxyCa ? new URL(proxyUrl) : null;
const proxyEnv = proxy ? { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, https_proxy: proxyUrl, http_proxy: proxyUrl, NO_PROXY: "localhost,127.0.0.1", no_proxy: "localhost,127.0.0.1" } : {};
const mavenSettings = proxy ? `<settings><proxies><proxy><id>p</id><active>true</active><protocol>http</protocol><host>${proxy.hostname}</host><port>${proxy.port}</port><nonProxyHosts>localhost|127.0.0.1</nonProxyHosts></proxy></proxies></settings>\n` : null;

const root = mkdtempSync(path.join(tmpdir(), "egov-ci-run-"));
const cleanup = [];
try {
  if (sh("docker", ["info"], { timeout: 30_000 }).code !== 0) { console.log("skip: Docker 데몬 없음"); process.exit(0); }

  // 이 버전의 패키지(npx 로 실행할 것)
  const pack = sh("npm", ["pack", "--silent", "--pack-destination", root], { cwd: REPO, timeout: 300_000 });
  const tgzName = pack.out.trim().split("\n").pop();
  assert(pack.code === 0 && existsSync(path.join(root, tgzName)), `npm pack → ${tgzName}`);

  /** 공식 web 템플릿 + 생성 CI 파일 + git 저장소 */
  const prepare = async (platform) => {
    const c = await m.createProject({ template: "web", projectName: `ci-${platform}`, groupId: "egovframework.example", outputDir: path.join(root, platform), database: "hsql" });
    const dir = c.projectPath;
    const ci = m.generateCiConfig({ projectDir: dir, platform, supplyChain: true, secureCoding: true, supplier: "eGovFrame CI Live", dryRun: false });
    const file = path.join(dir, ci.path);
    const generated = readFileSync(file, "utf8");
    const pinned = generated.match(/egovframe-scaffold-mcp@[0-9][\w.\-]*/g) ?? [];
    mkdirSync(path.join(dir, ".egov-ci"), { recursive: true });
    copyFileSync(path.join(root, tgzName), path.join(dir, ".egov-ci", "egovframe-scaffold-mcp.tgz"));
    writeFileSync(file, generated.replace(/egovframe-scaffold-mcp@[0-9][\w.\-]*/g, "./.egov-ci/egovframe-scaffold-mcp.tgz"));
    assert(pinned.length >= 4 && pinned.every((p) => p === `egovframe-scaffold-mcp@${m.SERVER_VERSION}`), `${platform}: 생성 ${ci.path} — 고정 패키지 ${pinned.length}곳(${m.SERVER_VERSION})을 npm pack 산출물로만 바꿈`);
    const git = (...a) => sh("git", a, { cwd: dir, timeout: 120_000 });
    git("init", "-q", "-b", "main");
    git("-c", "user.name=ci", "-c", "user.email=ci@example.invalid", "add", "-A");
    const commit = git("-c", "user.name=ci", "-c", "user.email=ci@example.invalid", "commit", "-q", "-m", "ci live");
    git("remote", "add", "origin", "https://gitlab.example.invalid/egov/ci-live.git");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"); // gitlab-ci-local 의 기본 브랜치 조회
    // 생성 디렉터리는 staging(mkdtemp, 0700)을 옮긴 것이라 컨테이너 사용자(jenkins uid 1000)가 읽도록 연다
    sh("chmod", ["-R", "a+rX", dir]);
    assert(commit.code === 0, `${platform}: git 저장소(main)`);
    return { dir, ci, generated };
  };

  // ── (1) Jenkins ──────────────────────────────────────
  if (!only || only === "jenkins") {
    const { dir, generated } = await prepare("jenkins");
    const img = path.join(root, "jenkins-image");
    mkdirSync(img, { recursive: true });
    copyFileSync(path.join(REPO, "test/fixtures/jenkins/plugins.txt"), path.join(img, "plugins.txt"));
    copyFileSync(path.join(REPO, "test/fixtures/jenkins/egov-job.groovy"), path.join(img, "egov-job.groovy"));
    writeFileSync(path.join(img, "ca.crt"), proxyCa ? readFileSync(proxyCa) : "");
    writeFileSync(path.join(img, "settings.xml"), mavenSettings ?? "<settings/>\n");
    const cliJava = proxy ? `-Dhttps.proxyHost=${proxy.hostname} -Dhttps.proxyPort=${proxy.port} -Dhttp.proxyHost=${proxy.hostname} -Dhttp.proxyPort=${proxy.port}` : "";
    writeFileSync(path.join(img, "Dockerfile"), [
      `FROM ${JENKINS_IMAGE}`,
      `USER root`,
      `COPY ca.crt /tmp/proxy-ca.crt`,
      // 에이전트 준비물(생성 Jenkinsfile 머리말): JDK(이미지 동봉 21 — release 17 로 컴파일), Maven, Node.js 18 이상
      // 프록시 CA 가 있으면(HTTPS CONNECT 만 받는 프록시 포함) 신뢰 저장소에 넣고 apt 원본을 https 로
      `RUN if [ -s /tmp/proxy-ca.crt ]; then cp /tmp/proxy-ca.crt /usr/local/share/ca-certificates/proxy-ca.crt && update-ca-certificates && keytool -importcert -noprompt -cacerts -storepass changeit -alias proxyca -file /tmp/proxy-ca.crt && sed -i 's#http://#https://#g' /etc/apt/sources.list.d/*.sources; fi \\`,
      ` && apt-get update -qq && apt-get install -y -qq --no-install-recommends maven nodejs npm > /dev/null && rm -rf /var/lib/apt/lists/* \\`,
      ` && git config --system safe.directory '*'`,
      `USER jenkins`,
      `COPY --chown=jenkins:jenkins settings.xml /var/jenkins_home/.m2/settings.xml`,
      `COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt`,
      `ARG CLI_JAVA_OPTS=""`,
      `RUN JAVA_OPTS="$CLI_JAVA_OPTS" jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt`,
      `COPY --chown=jenkins:jenkins egov-job.groovy /usr/share/jenkins/ref/init.groovy.d/egov-job.groovy`,
      `ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false -Dhudson.plugins.git.GitSCM.ALLOW_LOCAL_CHECKOUT=true -Dhudson.security.csrf.GlobalCrumbIssuerConfiguration.DISABLE_CSRF_PROTECTION=true"`,
      ``,
    ].join("\n"));
    const tag = "egov-ci-live/jenkins:test";
    const net = proxy ? ["--network", "host"] : [];
    const buildArgs = proxy ? Object.entries(proxyEnv).flatMap(([k, v]) => ["--build-arg", `${k}=${v}`]) : [];
    const t0 = Date.now();
    const b = sh("docker", ["build", "-q", ...net, ...buildArgs, "--build-arg", `CLI_JAVA_OPTS=${cliJava}`, "-t", tag, img], { timeout: 1_800_000 });
    assert(b.code === 0, `Jenkins 이미지(${JENKINS_IMAGE} + 플러그인 ${readFileSync(path.join(img, "plugins.txt"), "utf8").trim().split("\n").length}종 고정) ${Math.round((Date.now() - t0) / 1000)}초${b.code ? `\n${tail(b.out)}` : ""}`);
    if (b.code === 0) {
      const name = "egov-ci-live-jenkins";
      sh("docker", ["rm", "-f", name]);
      cleanup.push(() => sh("docker", ["rm", "-f", name]));
      const envArgs = Object.entries({ ...proxyEnv, ...(proxyCa ? { NODE_EXTRA_CA_CERTS: "/usr/local/share/ca-certificates/proxy-ca.crt" } : {}), ...(process.env.MAVEN_ARGS ? { MAVEN_ARGS: process.env.MAVEN_ARGS } : {}), JENKINS_OPTS: `--httpPort=${PORT}` }).flatMap(([k, v]) => ["-e", `${k}=${v}`]); // portability: ok 컨테이너 안(Linux) 경로
      const run = sh("docker", ["run", "-d", "--name", name, ...net, ...(proxy ? [] : ["-p", `${PORT}:${PORT}`]), ...envArgs, "-v", `${dir}:/repo:ro`, tag]);
      assert(run.code === 0, `Jenkins 컨트롤러 기동${run.code ? `\n${run.out}` : ""}`);
      const base = `http://127.0.0.1:${PORT}`;
      let up = false;
      for (let i = 0; i < 100 && !up; i++) { try { const r = await fetch(`${base}/job/egov-ci/api/json`); up = r.status === 200; } catch { /* 기동 중 */ } if (!up) await sleep(3000); }
      assert(up, `Jenkins 준비 · 작업 egov-ci 생성(init.groovy.d)${up ? "" : `\n${tail(sh("docker", ["logs", "--tail", "60", name]).out)}`}`);
      if (up) {
        // 선언형 문법 검증 — 바꾸기 전 생성 원문과 실행본 둘 다
        for (const [label, text] of [["생성 원문", generated], ["실행본", readFileSync(path.join(dir, "Jenkinsfile"), "utf8")]]) {
          const res = await fetch(`${base}/pipeline-model-converter/validate`, { method: "POST", body: new URLSearchParams({ jenkinsfile: text }) });
          const body = await res.text();
          assert(res.status === 200 && body.includes("Jenkinsfile successfully validated."), `Jenkins 선언형 문법 검증(${label}): ${body.trim().split("\n")[0]}`);
        }
        const trig = await fetch(`${base}/job/egov-ci/build`, { method: "POST" });
        assert(trig.status === 201 || trig.status === 200, `빌드 요청 HTTP ${trig.status}`);
        let info = null;
        const tb = Date.now();
        for (let i = 0; i < 600; i++) {
          try { const r = await fetch(`${base}/job/egov-ci/1/api/json`); if (r.status === 200) { const j = await r.json(); if (!j.building && j.result) { info = j; break; } } } catch { /* 대기 */ }
          await sleep(3000);
        }
        const log = await (await fetch(`${base}/job/egov-ci/1/consoleText`)).text().catch(() => "");
        assert(info?.result === "SUCCESS", `Jenkins 실행 결과 ${info?.result ?? "시간 초과"} (${Math.round((Date.now() - tb) / 1000)}초)${info?.result === "SUCCESS" ? "" : `\n${tail(log, 6000)}`}`);
        const stages = ["Build", "SBOM", "SBOM check", "Secure coding", "Assessment"];
        const ran = stages.filter((s) => log.includes(`[Pipeline] { (${s})`));
        assert(ran.length === stages.length && !/skipped due to earlier failure/.test(log), `단계 실행: ${ran.join(" → ")}`);
        const arts = (info?.artifacts ?? []).map((a) => a.relativePath).sort();
        assert(["egovframe-assessment.md", "egovframe-sbom-check.md", "sbom/bom.cdx.json"].every((a) => arts.includes(a)), `보관 산출물: ${arts.join(", ")}`);
        const bom = await (await fetch(`${base}/job/egov-ci/1/artifact/sbom/bom.cdx.json`)).json().catch(() => null);
        assert(bom?.bomFormat === "CycloneDX" && (bom.components ?? []).length > 20, `보관 SBOM: CycloneDX ${bom?.specVersion} · component ${(bom?.components ?? []).length}종`);
      }
    }
  }

  // ── (2) GitLab (gitlab-ci-local) ─────────────────────
  if (!only || only === "gitlab") {
    assert(sh("rsync", ["--version"], { timeout: 30_000 }).code === 0, "rsync 있음(gitlab-ci-local 이 작업 디렉터리를 복사할 때 씀)");
    const { dir } = await prepare("gitlab");
    const vars = [];
    const vols = [];
    if (proxy) {
      for (const [k, v] of Object.entries(proxyEnv)) vars.push("--variable", `${k}=${v}`);
      writeFileSync(path.join(root, "gl-settings.xml"), mavenSettings);
      // 러너 컨테이너용 신뢰 저장소(JDK cacerts + 프록시 CA)
      const jks = path.join(root, "gl-cacerts");
      const javaHome = sh("bash", ["-lc", "dirname $(dirname $(readlink -f $(which java)))"]).out.trim();
      copyFileSync(path.join(javaHome, "lib/security/cacerts"), jks);
      sh("keytool", ["-importcert", "-noprompt", "-keystore", jks, "-storepass", "changeit", "-alias", "proxyca", "-file", proxyCa]);
      // HTTPS CONNECT 만 받는 프록시: 러너 이미지(Ubuntu)의 apt 원본을 https 로, 프록시 CA 를 apt 에 알림
      writeFileSync(path.join(root, "gl-ubuntu.sources"), "Types: deb\nURIs: https://archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates noble-backports\nComponents: main universe restricted multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: https://security.ubuntu.com/ubuntu/\nSuites: noble-security\nComponents: main universe restricted multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n");
      writeFileSync(path.join(root, "gl-apt-ca.conf"), 'Acquire::https::CaInfo "/egov-proxy/ca.crt";\n');
      vols.push("--volume", `${root}/gl-ubuntu.sources:/etc/apt/sources.list.d/ubuntu.sources:ro`, "--volume", `${root}/gl-apt-ca.conf:/etc/apt/apt.conf.d/99egov-proxy-ca:ro`);
      vols.push("--volume", `${root}/gl-settings.xml:/egov-proxy/settings.xml:ro`, "--volume", `${jks}:/egov-proxy/cacerts:ro`, "--volume", `${proxyCa}:/egov-proxy/ca.crt:ro`);
      vars.push("--variable", "MAVEN_ARGS=-s /egov-proxy/settings.xml", "--variable", "JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStore=/egov-proxy/cacerts -Djavax.net.ssl.trustStorePassword=changeit", "--variable", "NODE_EXTRA_CA_CERTS=/egov-proxy/ca.crt", "--variable", "SSL_CERT_FILE=/egov-proxy/ca.crt");
    }
    if (process.env.MAVEN_ARGS && !proxy) vars.push("--variable", `MAVEN_ARGS=${process.env.MAVEN_ARGS}`);
    const t0 = Date.now();
    // gitlab-ci-local 4.7x 는 Node 22 의 Set.prototype.union 을 쓴다 — CI 통합 job(Node 20)에서도 돌도록 같은 npx 안에 node@22 를 함께 받아 그 node 로 실행
    const r = sh("npx", ["-y", "-p", "node@22", "-p", GITLAB_CI_LOCAL, "--", "gitlab-ci-local", "--no-color", ...(proxy ? ["--network", "host"] : []), ...vars, ...vols], { cwd: dir, timeout: 2_400_000 });
    const out = r.out;
    assert(r.code === 0, `gitlab-ci-local(${GITLAB_CI_LOCAL.split("@")[1]}) 실행 ${Math.round((Date.now() - t0) / 1000)}초${r.code ? `\n${tail(out, 6000)}` : ""}`);
    // 끝의 요약 표: " PASS  build" · " FAIL  supply-chain"
    for (const job of ["build", "supply-chain"]) assert(new RegExp(`^\\s*PASS\\s+${job}\\s*$`, "m").test(out), `GitLab job ${job} 성공`);
    const need = ["egovframe-assessment.md", "egovframe-sbom-check.md", "sbom/bom.cdx.json", "egovframe-secure.sarif"];
    const found = need.filter((f) => existsSync(path.join(dir, f)));
    assert(found.length === need.length, `GitLab 산출물(artifacts → 작업 디렉터리): ${found.join(", ")}${found.length === need.length ? "" : ` · 없음 ${need.filter((f) => !found.includes(f)).join(", ")} · ${readdirSync(dir).join(" ")}`}`);
    if (found.length === need.length) {
      const sarif = JSON.parse(readFileSync(path.join(dir, "egovframe-secure.sarif"), "utf8"));
      assert(sarif.version === "2.1.0" && readFileSync(path.join(dir, "egovframe-sbom-check.md"), "utf8").includes("제출 가능"), "SARIF 2.1.0 · SBOM 최소 요소 제출 가능(supplier 지정)");
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  for (const f of cleanup) f();
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`ci-run-live FAIL (${n} assertions)`); else console.log(`ci-run-live OK (${n} assertions)`);
