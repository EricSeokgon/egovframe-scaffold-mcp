// node test/ci.mjs — 오프라인 CI 생성 검증
import { generateCiConfig, generateCiYaml, generateGitlabCi, generateJenkinsfile, supplyChainCommands, jdkMajor, ciEnvEntries, validateCiJdk, supplyChainJobYaml, CI_FAIL_ON_RE, CI_PATHS, SERVER_VERSION } from "../dist/index.js";
import { validateGitlabCi, parseYaml } from "./spec-schemas.mjs";
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

// ── v0.39 공급망 게이트 job ──
const sc = generateCiYaml("maven", "17", {});
assert(!generateCiYaml("maven", "17").includes("supply-chain") && sc.includes("  supply-chain:\n") && sc.includes("mvn -B verify"), "supplyChain 옵션일 때만 게이트 job 추가(빌드 job 유지)");
assert(sc.includes(`npx -y egovframe-scaffold-mcp@${SERVER_VERSION} sbom --project . --write --overwrite --offline=false`) && sc.includes(`npx -y egovframe-scaffold-mcp@${SERVER_VERSION} assess --project . --offline=false --out egovframe-assessment.md --step-summary --fail-on supplyChain:D`), "현재 버전 고정 npx 로 SBOM·평가서, 기본 fail-on supplyChain:D");
assert(sc.includes("actions/setup-node@v4") && sc.includes("actions/upload-artifact@v4") && sc.includes("if: always()") && sc.includes("sbom/bom.cdx.json"), "Node·아티팩트(실패해도 업로드)");
const noOsv = supplyChainJobYaml("gradle", "21", { osv: false, sbom: false, failOn: "migration:C,vulnerabilities>0" }).join("\n");
assert(!noOsv.includes("--offline=false") && !noOsv.includes(" sbom ") && noOsv.includes("--fail-on migration:C,vulnerabilities>0") && noOsv.includes("cache: gradle"), "osv·sbom 끄기, 사용자 fail-on");
for (const bad of ["supplyChain:E", "x; rm -rf /", "a b", "supplyChain:C\n      - run: id", "${{ secrets.X }}", ""]) {
  let rejected = false; try { generateCiYaml("maven", "17", { failOn: bad }); } catch { rejected = true; }
  assert(rejected && !CI_FAIL_ON_RE.test(bad), `failOn 주입 거부: ${JSON.stringify(bad)}`);
}
for (const good of ["supplyChain:D", "migration:C,supplyChain:B", "vulnerabilities", "manual>=20,outdated>3"]) assert(CI_FAIL_ON_RE.test(good), `failOn 허용: ${good}`);

const mv = mkdtempSync(path.join(tmpdir(), "ci-mvn-"));
writeFileSync(path.join(mv, "pom.xml"), "<project/>");
const r = generateCiConfig({ projectDir: mv, dryRun: true });
assert(r.buildTool === "maven", "maven 감지");
assert(r.path === ".github/workflows/egovframe-ci.yml", "경로");
assert(!existsSync(path.join(mv, r.path)), "dryRun 미기록");
assert(generateCiConfig({ projectDir: mv, dryRun: true, supplyChain: true, failOn: "migration:C" }).content.includes("--fail-on migration:C"), "generateCiConfig supplyChain·failOn 전달");
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
// ── v0.43: 게이트에 sbom-check, GitLab CI·Jenkins ──
const npx = `npx -y egovframe-scaffold-mcp@${SERVER_VERSION}`;
const cmds = supplyChainCommands({ supplier: "행정안전부 (예시)" });
assert(cmds.map((c) => c.id).join() === "sbom,sbom-check,assess" && cmds[1].command === `${npx} sbom-check --project . --out egovframe-sbom-check.md --fail-on minimum` && cmds[0].command.endsWith(`--supplier "행정안전부 (예시)"`), "공통 게이트 명령: sbom → sbom-check --fail-on minimum → assess, supplier 전달");
assert(supplyChainCommands({ sbom: false }).map((c) => c.id).join() === "assess" && supplyChainCommands({}, true).every((c) => c.id === "sbom" || c.command.includes("--step-summary")), "sbom 끄면 점검도 생략·GitHub 만 step-summary");
assert(sc.includes(`run: ${npx} sbom-check --project . --out egovframe-sbom-check.md --step-summary --fail-on minimum`) && sc.indexOf(" sbom --project") < sc.indexOf(" sbom-check ") && sc.indexOf(" sbom-check ") < sc.indexOf(" assess ") && sc.includes("egovframe-sbom-check.md"), "GitHub 게이트에도 sbom-check 단계(순서·아티팩트)");
for (const bad of [{ supplier: 'x" && rm -rf / #' }, { supplier: "a\nb" }, { supplier: "" }]) { let r = false; try { supplyChainCommands(bad); } catch { r = true; } assert(r, `supplier 주입 거부: ${JSON.stringify(bad.supplier)}`); }
assert(ciEnvEntries({ npmRegistry: "https://nexus.example.go.kr/repository/npm-group/", offlineBundle: "/opt/egov-bundle" }).map(([k]) => k).join() === "NPM_CONFIG_REGISTRY,EGOVFRAME_OFFLINE_BUNDLE" && ciEnvEntries({ offlineBundle: "D:\\egov bundle" }).length === 1, "환경 변수: 사내 npm 레지스트리·오프라인 번들(Windows 경로 포함)");
for (const bad of [{ npmRegistry: "ftp://x" }, { npmRegistry: "https://x/'; id #" }, { npmRegistry: "https://x/$(id)" }, { offlineBundle: "relative/path" }, { offlineBundle: "/opt/b'; id" }, { offlineBundle: "/opt/$HOME" }, { offlineBundle: "/opt/b\nx" }]) { let r = false; try { ciEnvEntries(bad); } catch { r = true; } assert(r, `환경 변수 주입 거부: ${JSON.stringify(bad)}`); }
assert(jdkMajor("1.8") === "8" && jdkMajor("17.0.9") === "17" && jdkMajor("21") === "21", "이미지 태그용 JDK 주 버전");
assert(JSON.stringify(CI_PATHS) === JSON.stringify({ github: ".github/workflows/egovframe-ci.yml", gitlab: ".gitlab-ci.yml", jenkins: "Jenkinsfile" }), "플랫폼별 경로");

// GitLab: 공식 CI JSON 스키마(gitlab v19.4.1-ee)
const env = { npmRegistry: "https://nexus.example.go.kr/repository/npm/", offlineBundle: "/opt/egov-bundle" };
const gl = generateGitlabCi("maven", "17", { supplier: "예시 기관" }, env);
const glDoc = parseYaml(gl);
assert(validateGitlabCi(gl) === null, `GitLab: 생성 .gitlab-ci.yml(maven·게이트·환경 변수) 공식 스키마 통과${validateGitlabCi(gl) ? `: ${validateGitlabCi(gl)}` : ""}`);
for (const [bt, j, s2, e2] of [["gradle", "21", false, {}], ["maven", "1.8", { osv: false, sbom: false, failOn: "migration:C" }, {}], ["gradle", "17", {}, { offlineBundle: "C:\\egov\\bundle" }]]) {
  const t = generateGitlabCi(bt, j, s2, e2);
  assert(validateGitlabCi(t) === null, `GitLab 스키마 통과: ${bt} jdk ${j} ${s2 ? "게이트" : "빌드만"}${validateGitlabCi(t) ? `: ${validateGitlabCi(t)}` : ""}`);
}
assert(validateGitlabCi("build:\n  scriptx: [a]\n") !== null, "GitLab 스키마 검증이 실제로 동작(알 수 없는 키 거부)");
assert(glDoc.stages.join() === "build,supply-chain" && glDoc.default.image === "maven:3.9-eclipse-temurin-17" && glDoc.build.script[0] === "mvn -B verify" && glDoc.build.artifacts.reports.junit[0] === "target/surefire-reports/TEST-*.xml" && glDoc.build.cache.paths[0] === ".m2/repository", "GitLab build job: 이미지·mvn -B verify·JUnit 리포트·Maven 캐시");
assert(glDoc.variables.NPM_CONFIG_REGISTRY === env.npmRegistry && glDoc.variables.EGOVFRAME_OFFLINE_BUNDLE === env.offlineBundle && glDoc.variables.MAVEN_OPTS.includes("$CI_PROJECT_DIR/.m2/repository"), "GitLab 변수: 사내 레지스트리·오프라인 번들·로컬 저장소");
const job = glDoc["supply-chain"];
assert(job.script.length === 3 && job.script[0].includes(" sbom --project . --write --overwrite --offline=false --supplier \"예시 기관\"") && job.script[1].endsWith("sbom-check --project . --out egovframe-sbom-check.md --fail-on minimum") && job.script[2].endsWith("--fail-on supplyChain:D") && !gl.includes("--step-summary"), "GitLab 게이트: 같은 CLI 명령(step-summary 없음)");
assert(job.artifacts.when === "always" && job.artifacts.paths.includes("sbom/bom.cdx.json") && job.artifacts.reports.cyclonedx[0] === "sbom/bom.cdx.json" && job.before_script[0].includes(">= 22") && job.before_script[0].includes("npm install -g -s node@22"), "GitLab 게이트: 항상 보관·CycloneDX 리포트·Node 22 이상 준비(v1.0)");
const glGr = parseYaml(generateGitlabCi("gradle", "1.8", false));
assert(glGr.default.image === "eclipse-temurin:8" && glGr.build.script.join(" && ") === "chmod +x ./gradlew && ./gradlew build --no-daemon" && glGr.variables.GRADLE_USER_HOME && !("supply-chain" in glGr) && glGr.stages.join() === "build", "GitLab gradle·빌드만");
for (const bad of ["17'\n  - id", "latest"]) { let r = false; try { generateGitlabCi("maven", bad, false); } catch { r = true; } assert(r, `GitLab jdk 주입 거부: ${JSON.stringify(bad)}`); }

// Jenkins: Declarative 구조 단언(실제 Jenkins 실행은 보류)
const jf = generateJenkinsfile("maven", "17", { supplier: "예시 기관" }, { ...env, offlineBundle: "D:\\egov bundle" });
const bodyNoStrings = jf.replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/^\s*\/\/.*$/gm, "");
const balance = (open, close) => [...bodyNoStrings].reduce((a, ch) => a + (ch === open) - (ch === close), 0);
assert(balance("{", "}") === 0 && balance("(", ")") === 0, "Jenkinsfile: 중괄호·괄호 짝(문자열 밖)");
assert(/^pipeline \{$/m.test(jf) && /^  agent any$/m.test(jf) && /^  stages \{$/m.test(jf) && /^  post \{\n    always \{/m.test(jf) && /^  options \{\n    buildDiscarder\(logRotator\(numToKeepStr: '20'\)\)\n    timeout\(time: 60, unit: 'MINUTES'\)/m.test(jf), "Jenkinsfile: Declarative 구조(pipeline·agent·options·stages·post)");
assert([...jf.matchAll(/^    stage\('([^']+)'\) \{\n      steps \{\n        script \{/gm)].map((x) => x[1]).join() === "Build,SBOM,SBOM check,Assessment", "Jenkinsfile: 단계 Build → SBOM → SBOM check → Assessment(각 steps·script)");
assert(jf.includes("def run(String cmd) {\n  if (isUnix()) { sh cmd } else { bat cmd }\n}") && jf.includes("run('mvn -B verify')") && jf.includes(`run('${npx} sbom-check --project . --out egovframe-sbom-check.md --fail-on minimum')`), "Jenkinsfile: Linux(sh)·Windows(bat) 공용 실행·같은 CLI 명령");
assert(jf.includes(`    EGOVFRAME_OFFLINE_BUNDLE = 'D:\\\\egov bundle'`) && jf.includes(`    NPM_CONFIG_REGISTRY = '${env.npmRegistry}'`) && jf.includes("archiveArtifacts artifacts: 'egovframe-assessment.md, egovframe-sbom-check.md, sbom/bom.cdx.json', allowEmptyArchive: true"), "Jenkinsfile: environment(역슬래시 이스케이프)·항상 보관");
const jg = generateJenkinsfile("gradle", "21", false);
assert(jg.includes("bat 'gradlew.bat build --no-daemon'") && jg.includes("sh 'chmod +x ./gradlew && ./gradlew build --no-daemon'") && !jg.includes("environment {") && !jg.includes("stage('SBOM')") && jg.includes("build/test-results/test/*.xml"), "Jenkinsfile gradle·빌드만(환경 변수 없음)");

// generateCiConfig: platform
const pf = mkdtempSync(path.join(tmpdir(), "ci-pf-"));
writeFileSync(path.join(pf, "pom.xml"), "<project/>");
const rg = generateCiConfig({ projectDir: pf, platform: "gitlab", supplyChain: true, npmRegistry: env.npmRegistry });
const rj = generateCiConfig({ projectDir: pf, platform: "jenkins", supplyChain: true, failOn: "migration:C", offlineBundle: "/opt/b" });
assert(rg.platform === "gitlab" && rg.path === ".gitlab-ci.yml" && existsSync(path.join(pf, ".gitlab-ci.yml")) && validateGitlabCi(rg.content) === null && rj.path === "Jenkinsfile" && existsSync(path.join(pf, "Jenkinsfile")) && rj.content.includes("--fail-on migration:C"), "generateCiConfig: gitlab·jenkins 파일 생성(같은 프로젝트에 공존)");
let threwG = false; try { generateCiConfig({ projectDir: pf, platform: "gitlab" }); } catch (e) { threwG = /이미 존재합니다: \.gitlab-ci\.yml/.test(e.message); }
assert(threwG, "gitlab: 기존 파일 덮어쓰기 거부");
let threwE = false; try { generateCiConfig({ projectDir: pf, platform: "github", supplyChain: true, offlineBundle: "rel/x", dryRun: true }); } catch { threwE = true; }
assert(threwE && !existsSync(path.join(pf, ".github")), "잘못된 환경 변수면 생성하지 않음");
assert(generateCiConfig({ projectDir: pf, dryRun: true }).platform === "github", "기본 platform = github");
assert(rg.notes.some((x) => x.includes("sbom-check --fail-on minimum 단계가 실패")) && generateCiConfig({ projectDir: pf, dryRun: true, supplyChain: true, supplier: "예시 기관" }).notes.length === 0 && generateCiConfig({ projectDir: pf, dryRun: true }).notes.length === 0, "공급자 단서(supplier·pom <organization>)가 없으면 게이트 실패 예고");
writeFileSync(path.join(pf, "pom.xml"), "<project><organization><name>예시 기관</name></organization></project>");
assert(generateCiConfig({ projectDir: pf, dryRun: true, supplyChain: true }).notes.length === 0, "pom <organization> 이 있으면 예고 없음");
// v0.44: 게이트에 보안약점 점검(SARIF)
const sec = supplyChainCommands({ secureCoding: true }, true);
assert(sec.map((c) => c.id).join() === "sbom,sbom-check,secure,assess" && sec[2].command === `${npx} secure --project . --sarif-path egovframe-secure.sarif --overwrite --out egovframe-secure.md --step-summary --fail-on high`, "secureCoding: sbom-check 다음·assess 앞에 secure --fail-on high(SARIF)");
const ghSec = generateCiYaml("maven", "17", { secureCoding: true });
const ghDoc = parseYaml(ghSec);
const scJob = ghDoc.jobs["supply-chain"];
const up = scJob.steps.find((x) => x.uses === "github/codeql-action/upload-sarif@v3");
assert(scJob.permissions["security-events"] === "write" && scJob.permissions.contents === "read" && up && up["continue-on-error"] === true && up.if.startsWith("always()") && up.with.sarif_file === "egovframe-secure.sarif" && scJob.steps.at(-1).with.path.includes("egovframe-secure.sarif"), "GitHub: security-events 권한·SARIF 업로드(실패해도 게이트 판정 밖)·아티팩트");
assert(!generateCiYaml("maven", "17", {}).includes("upload-sarif") && !generateCiYaml("maven", "17", {}).includes("permissions:"), "secureCoding 이 없으면 업로드·권한 없음(기존 출력 그대로)");
const glSec = generateGitlabCi("gradle", "21", { secureCoding: true });
assert(validateGitlabCi(glSec) === null && parseYaml(glSec)["supply-chain"].script.some((x) => x.includes(" secure --project . --sarif-path egovframe-secure.sarif")) && parseYaml(glSec)["supply-chain"].artifacts.paths.includes("egovframe-secure.sarif"), "GitLab: secure 단계·SARIF 보관·공식 스키마 통과");
const jfSec = generateJenkinsfile("maven", "17", { secureCoding: true });
assert([...jfSec.matchAll(/^    stage\('([^']+)'\)/gm)].map((x) => x[1]).join() === "Build,SBOM,SBOM check,Secure coding,Assessment" && jfSec.includes("egovframe-secure.sarif") && jfSec.includes("egovframe-secure.md"), "Jenkins: Secure coding 단계·보관");
// v1.1: delivery=true — 게이트 끝에 납품 패키지 단계
const dl = supplyChainCommands({ secureCoding: true, delivery: true, supplier: "예시 기관" }, true);
assert(dl.map((c) => c.id).join() === "sbom,sbom-check,secure,assess,deliver" && dl[4].command === `${npx} deliver --project . --output-dir egovframe-delivery --write --offline=false --supplier "예시 기관" --fail-on failed`, "delivery: assess 다음에 deliver --write(--fail-on failed)");
const ghDl = parseYaml(generateCiYaml("maven", "17", { delivery: true }));
assert(ghDl.jobs["supply-chain"].steps.some((x) => typeof x.run === "string" && x.run.includes(" deliver --project . --output-dir egovframe-delivery --write")) && ghDl.jobs["supply-chain"].steps.at(-1).with.path.includes("egovframe-delivery/**"), "GitHub: deliver 단계·패키지 아티팩트");
const glDl = generateGitlabCi("maven", "17", { delivery: true });
assert(validateGitlabCi(glDl) === null && parseYaml(glDl)["supply-chain"].artifacts.paths.includes("egovframe-delivery/**"), "GitLab: 패키지 보관·공식 스키마 통과");
const jfDl = generateJenkinsfile("gradle", "21", { delivery: true });
assert([...jfDl.matchAll(/^    stage\('([^']+)'\)/gm)].map((x) => x[1]).join() === "Build,SBOM,SBOM check,Assessment,Delivery package" && jfDl.includes("egovframe-delivery/**"), "Jenkins: Delivery package 단계·보관");
assert(!generateCiYaml("maven", "17", { secureCoding: true }).includes("deliver "), "delivery 가 없으면 단계 없음");
const pf2 = mkdtempSync(path.join(tmpdir(), "ci-sec-"));
writeFileSync(path.join(pf2, "pom.xml"), "<project/>");
assert(generateCiConfig({ projectDir: pf2, dryRun: true, platform: "jenkins", supplyChain: true, secureCoding: true }).content.includes("stage('Secure coding')"), "generateCiConfig secureCoding 전달");
let threwS = false; try { generateCiConfig({ projectDir: pf2, dryRun: true, secureCoding: true }); } catch (e) { threwS = /supplyChain=true 와 함께/.test(e.message); }
let threwD = false; try { generateCiConfig({ projectDir: pf2, dryRun: true, delivery: true }); } catch (e) { threwD = /supplyChain=true 와 함께/.test(e.message); }
assert(threwD && generateCiConfig({ projectDir: pf2, dryRun: true, platform: "github", supplyChain: true, delivery: true }).content.includes("egovframe-delivery"), "generateCiConfig delivery 전달·supplyChain 없이 거부");
assert(threwS, "supplyChain 없이 secureCoding 만 주면 거부");
rmSync(pf2, { recursive: true, force: true });

rmSync(pf, { recursive: true, force: true });

if (process.exitCode) console.error("ci FAIL"); else console.log("ci OK");
