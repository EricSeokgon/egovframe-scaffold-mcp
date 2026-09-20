// node test/ci.mjs — 오프라인 CI 생성 검증
import { generateCiConfig, generateCiYaml, validateCiJdk } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
function assert(c, m) { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); }

assert(generateCiYaml("maven", "17").includes("mvn -B verify"), "maven yaml");
assert(generateCiYaml("gradle", "21").includes("./gradlew build"), "gradle yaml");
assert(generateCiYaml("maven", "21").includes("java-version: '21'"), "jdk 반영");
assert(generateCiYaml("maven", "1.8").includes("java-version: '1.8'"), "jdk 점 표기 허용");
assert(validateCiJdk(" 17 ") === "17", "jdk 공백 정리");
for (const bad of ["17'\n      - run: echo injected #", "17\n18", "'17'", "latest", "", "17; rm -rf /", "${{ secrets.X }}"]) {
  let rejected = false; try { generateCiYaml("maven", bad); } catch { rejected = true; }
  assert(rejected, `jdk 주입 거부: ${JSON.stringify(bad)}`);
}

const mv = mkdtempSync(path.join(tmpdir(), "ci-mvn-"));
writeFileSync(path.join(mv, "pom.xml"), "<project/>");
const r = generateCiConfig({ projectDir: mv, dryRun: true });
assert(r.buildTool === "maven", "maven 감지");
assert(r.path === ".github/workflows/egovframe-ci.yml", "경로");
assert(!existsSync(path.join(mv, r.path)), "dryRun 미기록");
const r2 = generateCiConfig({ projectDir: mv });
assert(existsSync(path.join(mv, r2.path)), "실제 생성됨");
const inj = mkdtempSync(path.join(tmpdir(), "ci-inj-"));
writeFileSync(path.join(inj, "pom.xml"), "<project/>");
let threwInj = false; try { generateCiConfig({ projectDir: inj, jdk: "17'\n      - run: id #" }); } catch { threwInj = true; }
assert(threwInj && !existsSync(path.join(inj, ".github")), "jdk 주입 시 파일 미생성");
rmSync(inj, { recursive: true, force: true });
let threw = false; try { generateCiConfig({ projectDir: mv }); } catch { threw = true; }
assert(threw, "기존 파일 존재 시 거부");

const gr = mkdtempSync(path.join(tmpdir(), "ci-gr-"));
writeFileSync(path.join(gr, "build.gradle"), "");
assert(generateCiConfig({ projectDir: gr, dryRun: true }).buildTool === "gradle", "gradle 감지");

const empty = mkdtempSync(path.join(tmpdir(), "ci-empty-"));
let threw2 = false; try { generateCiConfig({ projectDir: empty, dryRun: true }); } catch { threw2 = true; }
assert(threw2, "빌드파일 없으면 예외");

rmSync(mv, { recursive: true, force: true }); rmSync(gr, { recursive: true, force: true }); rmSync(empty, { recursive: true, force: true });
if (process.exitCode) console.error("ci FAIL"); else console.log("ci OK");
