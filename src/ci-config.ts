// CI 설정 생성 (generate_egovframe_ci) — GitHub Actions(v0.19)·GitLab CI·Jenkins Declarative(v0.43).
//   세 플랫폼 모두 같은 빌드(mvn -B verify / ./gradlew build)와 같은 공급망 게이트 명령을 쓴다:
//   sbom --write → sbom-check --fail-on minimum → assess --fail-on <failOn>. CLI 의 종료 코드 2(기준 초과)·3(실행 실패)는 job 실패.
import * as fs from "node:fs";
import * as path from "node:path";
import { SERVER_VERSION } from "./version.js";
import { pomIdentity } from "./sbom.js";
import { CI_MIRROR_SETTINGS, MAVEN_MIRROR_ENV, MAVEN_RETRY_FLAGS, TRANSIENT_CAUSE, TRANSIENT_CONTEXT, mavenMirrorSettings, shellTransientTest, validateMavenMirror } from "./maven-resilience.js";

// ── CI 설정 생성 + 문서 스니펫 (v0.19.0) ────────────────
function detectBuildTool(projectDir: string): "maven" | "gradle" {
  if (fs.existsSync(path.join(projectDir, "pom.xml"))) return "maven";
  if (fs.existsSync(path.join(projectDir, "build.gradle")) || fs.existsSync(path.join(projectDir, "build.gradle.kts"))) return "gradle";
  throw new Error(`빌드 파일(pom.xml·build.gradle)을 찾지 못했습니다: ${projectDir}`);
}

/** setup-java 의 java-version 으로 허용하는 형식: 8, 17, 21, 1.8, 17.0.9 등 숫자·점만. */
export const CI_JDK_RE = /^[0-9]{1,2}(\.[0-9]{1,3}){0,2}$/;

/** YAML 에 그대로 삽입되는 값이므로 따옴표·줄바꿈 등 구조를 깨는 입력을 거부한다. */
export function validateCiJdk(jdk: string): string {
  const v = jdk.trim();
  if (!CI_JDK_RE.test(v))
    throw new Error(`jdk 는 숫자와 점으로 된 버전이어야 합니다 (예: 17, 21, 1.8): ${JSON.stringify(jdk)}`);
  return v;
}

/** v0.39: 공급망 게이트의 --fail-on 식(YAML·Groovy 에 들어가므로 형식을 제한) */
export const CI_FAIL_ON_RE = /^(?:(?:migration|supplyChain):[ABCD]|[A-Za-z]+(?:>=?\d+)?)(?:,(?:(?:migration|supplyChain):[ABCD]|[A-Za-z]+(?:>=?\d+)?))*$/;
/** v0.43: 사내 npm 레지스트리 URL — 따옴표·공백·$·백틱 등 구조를 깨는 문자 금지 */
export const CI_NPM_REGISTRY_RE = /^https?:\/\/[A-Za-z0-9.\-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~%\-\/]*)?$/;
/** v0.43: 러너·에이전트에서 본 오프라인 번들 경로(절대 경로, 영문·숫자·._-/\\: 와 공백만) */
export const CI_BUNDLE_PATH_RE = /^(?:\/|[A-Za-z]:[\\/])[A-Za-z0-9_.\/\\: -]{0,250}$/;
/** v0.43: SBOM 공급자 이름(명령줄에 큰따옴표로 들어감) */
export const CI_SUPPLIER_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,&()_-]{0,99}$/u;

export type CiPlatform = "github" | "gitlab" | "jenkins";
export const CI_PATHS: Record<CiPlatform, string> = { github: ".github/workflows/egovframe-ci.yml", gitlab: ".gitlab-ci.yml", jenkins: "Jenkinsfile" };

export interface CiSupplyChainOptions {
  failOn?: string;
  osv?: boolean;
  sbom?: boolean;
  version?: string;
  /** v0.43: SBOM 공급자(pom <organization><name> 이 없을 때 최소 요소 '공급자' 충족용) */
  supplier?: string;
  /** v0.44: 보안약점 점검 단계(secure --fail-on high, SARIF) */
  secureCoding?: boolean;
  /** v1.1: 납품 패키지 단계(deliver --write → egovframe-delivery/, 아티팩트로 보관) */
  delivery?: boolean;
}
/** v0.43: 실행 환경 변수(세 플랫폼 공통) */
export interface CiEnvOptions { npmRegistry?: string; offlineBundle?: string; /** v1.6: 사내 Maven 미러(Nexus·Artifactory 프록시) — 빌드는 -gs settings, 게이트의 CLI 는 EGOVFRAME_MAVEN_MIRROR */ mavenMirror?: string }

function checkSupplyChain(opts: CiSupplyChainOptions): void {
  const failOn = opts.failOn ?? "supplyChain:D";
  if (!CI_FAIL_ON_RE.test(failOn)) throw new Error(`failOn 형식 오류: ${JSON.stringify(failOn)} (예: supplyChain:D, migration:C,vulnerabilities)`);
  if (opts.supplier !== undefined && !CI_SUPPLIER_RE.test(opts.supplier)) throw new Error(`supplier 는 문자·숫자·공백·.,&()_- 로 된 100자 이하여야 합니다: ${JSON.stringify(opts.supplier)}`);
}
/** 환경 변수 값을 검증해 [이름, 값] 목록으로. */
export function ciEnvEntries(env: CiEnvOptions = {}): [string, string][] {
  const out: [string, string][] = [];
  if (env.npmRegistry !== undefined) {
    if (!CI_NPM_REGISTRY_RE.test(env.npmRegistry)) throw new Error(`npmRegistry 는 http(s) URL 이어야 합니다(따옴표·공백 불가): ${JSON.stringify(env.npmRegistry)}`);
    out.push(["NPM_CONFIG_REGISTRY", env.npmRegistry]);
  }
  if (env.offlineBundle !== undefined) {
    if (!CI_BUNDLE_PATH_RE.test(env.offlineBundle)) throw new Error(`offlineBundle 은 러너에서 본 절대 경로여야 합니다(영문·숫자·._-/\\: 와 공백만): ${JSON.stringify(env.offlineBundle)}`);
    out.push(["EGOVFRAME_OFFLINE_BUNDLE", env.offlineBundle]);
  }
  if (env.mavenMirror !== undefined) out.push([MAVEN_MIRROR_ENV, validateMavenMirror(env.mavenMirror)]);
  return out;
}

// ── v1.6: Maven 빌드 단계의 일시 장애 내성 ───────────────
//   (1) 요청 단위 재시도(MAVEN_RETRY_FLAGS) (2) 명령 단위 재시도: 실패 로그가 "저장소 실패 문맥 + 일시 장애 원인"일 때만
//   30초·60초 뒤 -U 를 붙여 다시(최대 3회). 컴파일·테스트 실패는 다시 실행하지 않는다. (3) mavenMirror 면 -gs settings.
export const CI_MAVEN_LOG = ".egovframe-mvn.log";
export const CI_MAVEN_ATTEMPTS = 3;
/** 빌드 단계의 Maven 인자(mvn 다음) */
export const ciMavenGoals = (mirror: boolean) => ["-B", "verify", ...MAVEN_RETRY_FLAGS, ...(mirror ? ["-gs", CI_MIRROR_SETTINGS] : [])].join(" ");
/** 미러 settings 를 작업 디렉터리에 쓰는 POSIX 셸 명령 */
export const ciMirrorWriteCommand = (url: string) => `printf '%s\\n' '${mavenMirrorSettings(url)}' > ${CI_MIRROR_SETTINGS}`;
/** GitHub(bash, pipefail): 로그를 흘려 보내며 재시도 */
export function ciMavenBashRetry(mirror: boolean): string[] {
  return [
    `for i in ${Array.from({ length: CI_MAVEN_ATTEMPTS }, (_, k) => k + 1).join(" ")}; do`,
    // shellcheck SC2046 회피: 갱신 인자는 변수에 담아 따옴표 확장(빈 값이면 인자 없음)
    '  refresh=""; [ "$i" -gt 1 ] && refresh="-U"',
    `  if mvn ${ciMavenGoals(mirror)} \${refresh:+"$refresh"} 2>&1 | tee ${CI_MAVEN_LOG}; then exit 0; fi`,
    `  if [ "$i" -lt ${CI_MAVEN_ATTEMPTS} ] && ${shellTransientTest(CI_MAVEN_LOG)}; then`,
    `    echo "::warning::Maven repository unavailable - retrying in $((i * 30))s ($((i + 1))/${CI_MAVEN_ATTEMPTS})"; sleep $((i * 30))`,
    "  else exit 1; fi",
    "done",
  ];
}
/** GitLab(sh, set -e 에서도 안전한 한 줄): 실행 뒤 로그를 출력 */
export function ciMavenShRetry(mirror: boolean): string {
  return `i=1; while :; do refresh=""; [ "$i" -gt 1 ] && refresh="-U"; mvn ${ciMavenGoals(mirror)} \${refresh:+"$refresh"} > ${CI_MAVEN_LOG} 2>&1 && s=0 || s=$?; cat ${CI_MAVEN_LOG}; [ "$s" -eq 0 ] && break; if [ "$i" -lt ${CI_MAVEN_ATTEMPTS} ] && ${shellTransientTest(CI_MAVEN_LOG)}; then echo "Maven repository unavailable - retrying in $((i * 30))s ($((i + 1))/${CI_MAVEN_ATTEMPTS})"; sleep $((i * 30)); i=$((i + 1)); else exit "$s"; fi; done`;
}
/** Jenkins(Groovy, sh·bat 공용): readFile 로 로그를 읽어 판정 — 샌드박스에서 허용된 String 메서드와 기본 단계만 쓴다 */
export function jenkinsMavenRetryFunction(): string[] {
  const list = (xs: string[]) => `[${xs.map((x) => `'${x}'`).join(", ")}]`;
  return [
    "def mvnResilient(String goals) {",
    `  def context = ${list(TRANSIENT_CONTEXT)}`,
    `  def causes = ${list(TRANSIENT_CAUSE)}`,
    `  for (int i = 1; i <= ${CI_MAVEN_ATTEMPTS}; i++) {`,
    `    String cmd = 'mvn ' + goals + (i > 1 ? ' -U' : '') + ' > ${CI_MAVEN_LOG} 2>&1'`,
    "    int status = isUnix() ? sh(script: cmd, returnStatus: true) : bat(script: cmd, returnStatus: true)",
    `    String log = readFile('${CI_MAVEN_LOG}')`,
    "    echo log",
    "    if (status == 0) { return }",
    "    String low = log.toLowerCase()",
    "    boolean hasContext = false",
    "    boolean hasCause = false",
    "    for (String c : context) { if (low.contains(c)) { hasContext = true } }",
    "    for (String c : causes) { if (low.contains(c)) { hasCause = true } }",
    `    if (i == ${CI_MAVEN_ATTEMPTS} || !(hasContext && hasCause)) { error('mvn ' + goals + ' failed (exit ' + status + ')') }`,
    `    echo 'Maven repository unavailable - retrying in ' + (i * 30) + 's (' + (i + 1) + '/${CI_MAVEN_ATTEMPTS})'`,
    "    sleep(time: i * 30, unit: 'SECONDS')",
    "  }",
    "}",
  ];
}

/** 공급망 게이트의 CLI 명령(플랫폼 공통). stepSummary 는 GitHub 에서만. */
export type GateStepId = "sbom" | "sbom-check" | "secure" | "assess" | "deliver";
export const DELIVERY_DIR = "egovframe-delivery";
export const SECURE_SARIF = "egovframe-secure.sarif";
export function supplyChainCommands(opts: CiSupplyChainOptions = {}, stepSummary = false): { id: GateStepId; name: string; command: string }[] {
  checkSupplyChain(opts);
  const failOn = opts.failOn ?? "supplyChain:D";
  const npx = `npx -y egovframe-scaffold-mcp@${opts.version ?? SERVER_VERSION}`;
  const offline = opts.osv === false ? "" : " --offline=false";
  const out: { id: GateStepId; name: string; command: string }[] = [];
  if (opts.sbom !== false) {
    out.push({ id: "sbom", name: "SBOM (CycloneDX 1.6)", command: `${npx} sbom --project . --write --overwrite${offline}${opts.supplier ? ` --supplier "${opts.supplier}"` : ""}` });
    out.push({ id: "sbom-check", name: "SBOM minimum elements (7)", command: `${npx} sbom-check --project . --out egovframe-sbom-check.md${stepSummary ? " --step-summary" : ""} --fail-on minimum` });
  }
  if (opts.secureCoding) out.push({ id: "secure", name: "Secure coding weaknesses (SARIF)", command: `${npx} secure --project . --sarif-path ${SECURE_SARIF} --overwrite --out egovframe-secure.md${stepSummary ? " --step-summary" : ""} --fail-on high` });
  out.push({ id: "assess", name: "Migration readiness and supply-chain grades", command: `${npx} assess --project .${offline} --out egovframe-assessment.md${stepSummary ? " --step-summary" : ""} --fail-on ${failOn}` });
  // v1.1: 납품 패키지 — 게이트가 통과한 뒤 같은 입력으로 묶는다(실패 항목은 패키지 목차에 남고 --fail-on failed 로 단계도 실패)
  if (opts.delivery) out.push({ id: "deliver", name: "Delivery package (manifest, SBOM, VEX, SARIF, assessment)", command: `${npx} deliver --project . --output-dir ${DELIVERY_DIR} --write${offline}${opts.supplier ? ` --supplier "${opts.supplier}"` : ""} --fail-on failed` });
  return out;
}
const reportFiles = (opts: CiSupplyChainOptions) => ["egovframe-assessment.md", ...(opts.sbom !== false ? ["egovframe-sbom-check.md", "sbom/bom.cdx.json"] : []), ...(opts.secureCoding ? ["egovframe-secure.md", SECURE_SARIF] : []), ...(opts.delivery ? [`${DELIVERY_DIR}/**`] : [])];

/** GitLab supply-chain job 준비: Node 22 이상 보장(v1.0, engines >=22) */
export const NODE22_ENSURE = `node -e "process.exit(+process.versions.node.split('.')[0] >= 22 ? 0 : 1)" 2>/dev/null || ((command -v npm >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq nodejs npm)) && npm install -g -s node@22)`;

// ── GitHub Actions ───────────────────────────────────────
/** 공급망 게이트 job(v0.39, v0.43 에 sbom-check 단계): SBOM 생성 → 최소 요소 점검 → 평가서(등급을 PR 요약에) → 아티팩트. */
export function supplyChainJobYaml(buildTool: "maven" | "gradle", jdk: string, opts: CiSupplyChainOptions = {}, env: CiEnvOptions = {}): string[] {
  const cmds = supplyChainCommands(opts, true);
  const envs = ciEnvEntries(env);
  const lines = [
    "  supply-chain:",
    "    name: supply-chain gate (eGovFrame)",
    "    runs-on: ubuntu-latest",
    ...(opts.secureCoding ? ["    permissions:", "      contents: read", "      security-events: write"] : []),
    ...(envs.length ? ["    env:", ...envs.map(([k, v]) => `      ${k}: '${v}'`)] : []),
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-java@v4",
    "        with:",
    "          distribution: temurin",
    `          java-version: '${jdk}'`,
    `          cache: ${buildTool}`,
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: '22'",
  ];
  for (const c of cmds) lines.push(`      - name: ${c.name}`, `        run: ${c.command}`);
  // v0.44: code scanning 업로드 — Advanced Security 가 없는 비공개 저장소에서는 실패하므로 게이트 판정에 넣지 않는다
  if (opts.secureCoding) lines.push(
    "      - uses: github/codeql-action/upload-sarif@v3",
    "        if: always() && hashFiles('egovframe-secure.sarif') != ''",
    "        continue-on-error: true",
    "        with:",
    `          sarif_file: ${SECURE_SARIF}`,
    "          category: egovframe-secure-coding",
  );
  lines.push(
    "      - uses: actions/upload-artifact@v4",
    "        if: always()",
    "        with:",
    "          name: egovframe-supply-chain",
    "          path: |",
    ...reportFiles(opts).map((f) => `            ${f}`),
    "          if-no-files-found: ignore",
  );
  return lines;
}

export function generateCiYaml(buildTool: "maven" | "gradle", jdkInput: string, supplyChain?: CiSupplyChainOptions | false, env: CiEnvOptions = {}): string {
  const jdk = validateCiJdk(jdkInput);
  const mirror = env.mavenMirror !== undefined ? validateMavenMirror(env.mavenMirror) : undefined;
  const buildStep = buildTool === "maven"
    ? [
      ...(mirror ? ["      - name: Maven mirror settings", `        run: ${yq(ciMirrorWriteCommand(mirror))}`] : []),
      "      - name: Build (mvn -B verify, retried on transient repository outages)",
      "        shell: bash",
      "        run: |",
      ...ciMavenBashRetry(!!mirror).map((l) => `          ${l}`),
    ].join("\n")
    : "      - run: chmod +x ./gradlew\n      - run: ./gradlew build --no-daemon";
  return [
    "name: CI",
    "on:",
    "  push:",
    "  pull_request:",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-java@v4",
    "        with:",
    "          distribution: temurin",
    `          java-version: '${jdk}'`,
    `          cache: ${buildTool}`,
    buildStep,
    ...(supplyChain ? supplyChainJobYaml(buildTool, jdk, supplyChain, env) : []),
    "",
  ].join("\n");
}

// ── GitLab CI (v0.43) ────────────────────────────────────
/** 1.8 → 8, 17.0.9 → 17 (컨테이너 이미지 태그용 주 버전) */
export const jdkMajor = (jdk: string) => { const v = validateCiJdk(jdk); return v.startsWith("1.") ? v.split(".")[1] : v.split(".")[0]; };
const yq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** `.gitlab-ci.yml` — build(+JUnit 리포트) 와 supply-chain(SBOM·최소 요소·평가서, CycloneDX 리포트) job. */
export function generateGitlabCi(buildTool: "maven" | "gradle", jdkInput: string, supplyChain?: CiSupplyChainOptions | false, env: CiEnvOptions = {}): string {
  const major = jdkMajor(jdkInput);
  const envs = ciEnvEntries(env);
  const maven = buildTool === "maven";
  const image = maven ? `maven:3.9-eclipse-temurin-${major}` : `eclipse-temurin:${major}`;
  const cachePath = maven ? ".m2/repository" : ".gradle";
  const cache = ["  cache:", `    key: ${buildTool}`, "    paths:", `      - ${cachePath}`];
  const L = [
    `# eGovFrame CI — egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_ci(platform=gitlab)`,
    `# 이미지는 공개 Docker Hub 기준입니다. 폐쇄망이면 사내 레지스트리의 같은 이미지(JDK ${major}${supplyChain ? " + Node.js 22 이상" : ""})로 바꾸세요.`,
    "stages:",
    "  - build",
    ...(supplyChain ? ["  - supply-chain"] : []),
    "variables:",
    maven ? `  MAVEN_OPTS: ${yq("-Dmaven.repo.local=$CI_PROJECT_DIR/.m2/repository")}` : `  GRADLE_USER_HOME: ${yq("$CI_PROJECT_DIR/.gradle")}`,
    ...envs.map(([k, v]) => `  ${k}: ${yq(v)}`),
    "default:",
    `  image: ${image}`,
    "build:",
    "  stage: build",
    ...cache,
    "  script:",
    ...(maven ? [...(env.mavenMirror !== undefined ? [`    - ${yq(ciMirrorWriteCommand(env.mavenMirror))}`] : []), `    - ${yq(ciMavenShRetry(env.mavenMirror !== undefined))}`] : [`    - ${yq("chmod +x ./gradlew")}`, `    - ${yq("./gradlew build --no-daemon")}`]),
    "  artifacts:",
    "    when: always",
    "    reports:",
    "      junit:",
    `        - ${maven ? "target/surefire-reports/TEST-*.xml" : "build/test-results/test/TEST-*.xml"}`,
  ];
  if (supplyChain) {
    const cmds = supplyChainCommands(supplyChain, false);
    L.push(
      "supply-chain:",
      "  stage: supply-chain",
      "  needs: []",
      ...cache,
      "  before_script:",
      // v1.0: Node 22 이상 — 이미지의 배포판 nodejs 가 그보다 낮으면 npm 레지스트리의 node@22 를 전역으로 받아 PATH 앞에 둔다(npx 의 #!/usr/bin/env node 가 그것을 씀)
      `    - ${yq(NODE22_ENSURE)}`,
      "  script:",
      ...cmds.map((c) => `    - ${yq(c.command)}`),
      "  artifacts:",
      "    when: always",
      "    expire_in: 30 days",
      "    paths:",
      ...reportFiles(supplyChain).map((f) => `      - ${f}`),
      ...(supplyChain.sbom !== false ? ["    reports:", "      cyclonedx:", "        - sbom/bom.cdx.json"] : []),
    );
  }
  L.push("");
  return L.join("\n");
}

// ── Jenkins Declarative (v0.43) ──────────────────────────
const gq = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** `Jenkinsfile`(Declarative) — Build·SBOM·SBOM check·Assessment 단계, 항상 보고서 보관. Linux(sh)·Windows(bat) 에이전트 모두. */
export function generateJenkinsfile(buildTool: "maven" | "gradle", jdkInput: string, supplyChain?: CiSupplyChainOptions | false, env: CiEnvOptions = {}): string {
  const jdk = validateCiJdk(jdkInput);
  const envs = ciEnvEntries(env);
  const stage = (name: string, body: string[]) => [`    stage(${gq(name)}) {`, "      steps {", "        script {", ...body.map((b) => `          ${b}`), "        }", "      }", "    }"];
  const build = buildTool === "maven"
    ? [...(env.mavenMirror !== undefined ? [`writeFile file: ${gq(CI_MIRROR_SETTINGS)}, text: ${gq(mavenMirrorSettings(env.mavenMirror))}`] : []), `mvnResilient(${gq(ciMavenGoals(env.mavenMirror !== undefined))})`]
    : ["if (isUnix()) {", `  sh ${gq("chmod +x ./gradlew && ./gradlew build --no-daemon")}`, "} else {", `  bat ${gq("gradlew.bat build --no-daemon")}`, "}"];
  const L = [
    `// eGovFrame CI — egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_ci(platform=jenkins)`,
    `// 에이전트 준비물: ${[`JDK ${jdk}`, ...(buildTool === "maven" ? ["Maven"] : []), ...(supplyChain ? ["Node.js 22 이상"] : [])].join(", ")}. Pipeline 기본 단계(sh·bat·archiveArtifacts)만 씁니다.`,
    "def run(String cmd) {",
    "  if (isUnix()) { sh cmd } else { bat cmd }",
    "}",
    "",
    ...(buildTool === "maven" ? [...jenkinsMavenRetryFunction(), ""] : []),
    "pipeline {",
    "  agent any",
    "  options {",
    "    buildDiscarder(logRotator(numToKeepStr: '20'))",
    "    timeout(time: 60, unit: 'MINUTES')",
    "  }",
    ...(envs.length ? ["  environment {", ...envs.map(([k, v]) => `    ${k} = ${gq(v)}`), "  }"] : []),
    "  stages {",
    ...stage("Build", build),
  ];
  if (supplyChain) {
    const names: Record<string, string> = { "sbom": "SBOM", "sbom-check": "SBOM check", "secure": "Secure coding", "assess": "Assessment", "deliver": "Delivery package" };
    for (const c of supplyChainCommands(supplyChain, false)) L.push(...stage(names[c.id], [`run(${gq(c.command)})`]));
  }
  L.push("  }", "  post {", "    always {");
  L.push(supplyChain
    ? `      archiveArtifacts artifacts: ${gq(reportFiles(supplyChain).join(", "))}, allowEmptyArchive: true`
    : `      archiveArtifacts artifacts: ${gq(buildTool === "maven" ? "target/surefire-reports/*.xml" : "build/test-results/test/*.xml")}, allowEmptyArchive: true`);
  L.push("    }", "  }", "}", "");
  return L.join("\n");
}

// ── 파일 생성 ────────────────────────────────────────────
export interface CiResult { projectDir: string; platform: CiPlatform; buildTool: "maven" | "gradle"; path: string; dryRun: boolean; content: string; notes: string[] }

export interface GenerateCiOptions extends CiEnvOptions {
  /** v0.44: 게이트에 보안약점 점검 단계(SARIF) */
  secureCoding?: boolean;
  /** v1.1: 게이트 끝에 납품 패키지 단계 */
  delivery?: boolean;
  projectDir: string;
  platform?: CiPlatform;
  jdk?: string;
  dryRun?: boolean;
  supplyChain?: boolean;
  failOn?: string;
  osv?: boolean;
  supplier?: string;
}

export function generateCiConfig(opts: GenerateCiOptions): CiResult {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const platform = opts.platform ?? "github";
  if (!(platform in CI_PATHS)) throw new Error(`지원하지 않는 platform: ${platform} (github·gitlab·jenkins)`);
  const buildTool = detectBuildTool(projectDir);
  const sc: CiSupplyChainOptions | false = opts.supplyChain ? { failOn: opts.failOn, osv: opts.osv, ...(opts.supplier ? { supplier: opts.supplier } : {}), ...(opts.secureCoding ? { secureCoding: true } : {}), ...(opts.delivery ? { delivery: true } : {}) } : false;
  if (opts.secureCoding && !opts.supplyChain) throw new Error("secureCoding 은 supplyChain=true 게이트의 단계입니다 — supplyChain=true 와 함께 쓰세요.");
  if (opts.delivery && !opts.supplyChain) throw new Error("delivery 는 supplyChain=true 게이트의 단계입니다 — supplyChain=true 와 함께 쓰세요.");
  const env: CiEnvOptions = { ...(opts.npmRegistry ? { npmRegistry: opts.npmRegistry } : {}), ...(opts.offlineBundle ? { offlineBundle: opts.offlineBundle } : {}), ...(opts.mavenMirror ? { mavenMirror: opts.mavenMirror } : {}) };
  const jdk = opts.jdk ?? "17";
  const content = platform === "gitlab" ? generateGitlabCi(buildTool, jdk, sc, env) : platform === "jenkins" ? generateJenkinsfile(buildTool, jdk, sc, env) : generateCiYaml(buildTool, jdk, sc, env);
  const rel = CI_PATHS[platform];
  const dryRun = opts.dryRun === true;
  const notes: string[] = [];
  if (sc && !opts.supplier && !(buildTool === "maven" && pomIdentity(projectDir).organization))
    notes.push("supplier 미지정이고 pom <organization><name> 도 없어 SBOM 의 공급자(주 component)·작성자가 비므로 sbom-check --fail-on minimum 단계가 실패합니다 — supplier 를 지정하거나 pom 에 <organization> 을 넣으세요.");
  if (opts.mavenMirror && buildTool === "gradle")
    notes.push("mavenMirror 는 Maven 빌드에만 적용됩니다 — Gradle 은 settings.gradle 의 repositories(또는 init 스크립트)에 미러를 지정하세요. 게이트 단계의 CLI 는 EGOVFRAME_MAVEN_MIRROR 를 받지만 Gradle 실행에는 쓰지 않습니다.");
  if (!dryRun) {
    const dest = path.join(projectDir, rel);
    if (fs.existsSync(dest)) throw new Error(`이미 존재합니다: ${rel} — 덮어쓰지 않습니다(수동 확인).`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  return { projectDir, platform, buildTool, path: rel, dryRun, content, notes };
}
