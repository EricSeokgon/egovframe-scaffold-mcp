// GitHub Actions CI 워크플로 생성 (generate_egovframe_ci).
import * as fs from "node:fs";
import * as path from "node:path";
import { SERVER_VERSION } from "./version.js";

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

/** v0.39: 공급망 게이트의 --fail-on 식(YAML 에 들어가므로 형식을 제한) */
export const CI_FAIL_ON_RE = /^(?:(?:migration|supplyChain):[ABCD]|[A-Za-z]+(?:>=?\d+)?)(?:,(?:(?:migration|supplyChain):[ABCD]|[A-Za-z]+(?:>=?\d+)?))*$/;
export interface CiSupplyChainOptions { failOn?: string; osv?: boolean; sbom?: boolean; version?: string }

/** 공급망 게이트 job(v0.39): SBOM 생성 → 평가서(등급을 PR 요약에) → 아티팩트. --fail-on 기준을 넘으면 job 이 실패한다. */
export function supplyChainJobYaml(buildTool: "maven" | "gradle", jdk: string, opts: CiSupplyChainOptions = {}): string[] {
  const failOn = opts.failOn ?? "supplyChain:D";
  if (!CI_FAIL_ON_RE.test(failOn)) throw new Error(`failOn 형식 오류: ${JSON.stringify(failOn)} (예: supplyChain:D, migration:C,vulnerabilities)`);
  const pkg = `egovframe-scaffold-mcp@${opts.version ?? SERVER_VERSION}`;
  const offline = opts.osv === false ? "" : " --offline=false";
  const lines = [
    "  supply-chain:",
    "    name: supply-chain gate (eGovFrame)",
    "    runs-on: ubuntu-latest",
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
  if (opts.sbom !== false) lines.push(
    "      - name: SBOM (CycloneDX 1.6)",
    `        run: npx -y ${pkg} sbom --project . --write --overwrite${offline}`,
  );
  lines.push(
    "      - name: Migration readiness and supply-chain grades",
    `        run: npx -y ${pkg} assess --project .${offline} --out egovframe-assessment.md --step-summary --fail-on ${failOn}`,
    "      - uses: actions/upload-artifact@v4",
    "        if: always()",
    "        with:",
    "          name: egovframe-supply-chain",
    "          path: |",
    "            egovframe-assessment.md",
    ...(opts.sbom !== false ? ["            sbom/bom.cdx.json"] : []),
    "          if-no-files-found: ignore",
  );
  return lines;
}

export function generateCiYaml(buildTool: "maven" | "gradle", jdkInput: string, supplyChain?: CiSupplyChainOptions | false): string {
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
    ...(supplyChain ? supplyChainJobYaml(buildTool, jdk, supplyChain) : []),
    "",
  ].join("\n");
}

export interface CiResult { projectDir: string; buildTool: "maven" | "gradle"; path: string; dryRun: boolean; content: string; }

export function generateCiConfig(opts: { projectDir: string; jdk?: string; dryRun?: boolean; supplyChain?: boolean; failOn?: string; osv?: boolean }): CiResult {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const buildTool = detectBuildTool(projectDir);
  const content = generateCiYaml(buildTool, opts.jdk ?? "17", opts.supplyChain ? { failOn: opts.failOn, osv: opts.osv } : false);
  const rel = ".github/workflows/egovframe-ci.yml";
  const dryRun = opts.dryRun === true;
  if (!dryRun) {
    const dest = path.join(projectDir, rel);
    if (fs.existsSync(dest)) throw new Error(`이미 존재합니다: ${rel} — 덮어쓰지 않습니다(수동 확인).`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  return { projectDir, buildTool, path: rel, dryRun, content };
}
