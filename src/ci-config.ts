// CI 설정 생성 (generate_egovframe_ci) — GitHub Actions(v0.19)·GitLab CI·Jenkins Declarative(v0.43).
//   세 플랫폼 모두 같은 빌드(mvn -B verify / ./gradlew build)와 같은 공급망 게이트 명령을 쓴다:
//   sbom --write → sbom-check --fail-on minimum → assess --fail-on <failOn>. CLI 의 종료 코드 2(기준 초과)·3(실행 실패)는 job 실패.
import * as fs from "node:fs";
import * as path from "node:path";
import { SERVER_VERSION } from "./version.js";
import { pomIdentity } from "./sbom.js";

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
}
/** v0.43: 실행 환경 변수(세 플랫폼 공통) */
export interface CiEnvOptions { npmRegistry?: string; offlineBundle?: string }

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
  return out;
}

/** 공급망 게이트의 CLI 명령(플랫폼 공통). stepSummary 는 GitHub 에서만. */
export type GateStepId = "sbom" | "sbom-check" | "secure" | "assess";
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
  return out;
}
const reportFiles = (opts: CiSupplyChainOptions) => ["egovframe-assessment.md", ...(opts.sbom !== false ? ["egovframe-sbom-check.md", "sbom/bom.cdx.json"] : []), ...(opts.secureCoding ? ["egovframe-secure.md", SECURE_SARIF] : [])];

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
  const buildStep = buildTool === "maven"
    ? "      - run: mvn -B verify"
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
    ...(maven ? [`    - ${yq("mvn -B verify")}`] : [`    - ${yq("chmod +x ./gradlew")}`, `    - ${yq("./gradlew build --no-daemon")}`]),
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
    ? [`run(${gq("mvn -B verify")})`]
    : ["if (isUnix()) {", `  sh ${gq("chmod +x ./gradlew && ./gradlew build --no-daemon")}`, "} else {", `  bat ${gq("gradlew.bat build --no-daemon")}`, "}"];
  const L = [
    `// eGovFrame CI — egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_ci(platform=jenkins)`,
    `// 에이전트 준비물: ${[`JDK ${jdk}`, ...(buildTool === "maven" ? ["Maven"] : []), ...(supplyChain ? ["Node.js 22 이상"] : [])].join(", ")}. Pipeline 기본 단계(sh·bat·archiveArtifacts)만 씁니다.`,
    "def run(String cmd) {",
    "  if (isUnix()) { sh cmd } else { bat cmd }",
    "}",
    "",
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
    const names: Record<string, string> = { "sbom": "SBOM", "sbom-check": "SBOM check", "secure": "Secure coding", "assess": "Assessment" };
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
  const sc: CiSupplyChainOptions | false = opts.supplyChain ? { failOn: opts.failOn, osv: opts.osv, ...(opts.supplier ? { supplier: opts.supplier } : {}), ...(opts.secureCoding ? { secureCoding: true } : {}) } : false;
  if (opts.secureCoding && !opts.supplyChain) throw new Error("secureCoding 은 supplyChain=true 게이트의 단계입니다 — supplyChain=true 와 함께 쓰세요.");
  const env: CiEnvOptions = { ...(opts.npmRegistry ? { npmRegistry: opts.npmRegistry } : {}), ...(opts.offlineBundle ? { offlineBundle: opts.offlineBundle } : {}) };
  const jdk = opts.jdk ?? "17";
  const content = platform === "gitlab" ? generateGitlabCi(buildTool, jdk, sc, env) : platform === "jenkins" ? generateJenkinsfile(buildTool, jdk, sc, env) : generateCiYaml(buildTool, jdk, sc, env);
  const rel = CI_PATHS[platform];
  const dryRun = opts.dryRun === true;
  const notes: string[] = [];
  if (sc && !opts.supplier && !(buildTool === "maven" && pomIdentity(projectDir).organization))
    notes.push("supplier 미지정이고 pom <organization><name> 도 없어 SBOM 의 공급자(주 component)·작성자가 비므로 sbom-check --fail-on minimum 단계가 실패합니다 — supplier 를 지정하거나 pom 에 <organization> 을 넣으세요.");
  if (!dryRun) {
    const dest = path.join(projectDir, rel);
    if (fs.existsSync(dest)) throw new Error(`이미 존재합니다: ${rel} — 덮어쓰지 않습니다(수동 확인).`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  return { projectDir, platform, buildTool, path: rel, dryRun, content, notes };
}
