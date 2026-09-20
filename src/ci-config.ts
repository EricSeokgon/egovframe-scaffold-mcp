// GitHub Actions CI 워크플로 생성 (generate_egovframe_ci).
import * as fs from "node:fs";
import * as path from "node:path";

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

export function generateCiYaml(buildTool: "maven" | "gradle", jdkInput: string): string {
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
    "",
  ].join("\n");
}

export interface CiResult { projectDir: string; buildTool: "maven" | "gradle"; path: string; dryRun: boolean; content: string; }

export function generateCiConfig(opts: { projectDir: string; jdk?: string; dryRun?: boolean }): CiResult {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const buildTool = detectBuildTool(projectDir);
  const content = generateCiYaml(buildTool, opts.jdk ?? "17");
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
