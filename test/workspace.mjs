// node test/workspace.mjs — 멀티 모듈·다중 서비스 작업공간(v0.47) 게이트 (오프라인, 플랫폼 중립)
//   작업공간 탐지(Maven <modules>·Gradle include·독립 프로젝트·단일) · YAML 평탄화 · localhost 참조 치환 ·
//   의존성 점검(모듈별·모듈 parent·Gradle 변수·BOM parent) · 5.x 최신 유지(Gradle 버전 변수 auto/manual·모듈 요약) ·
//   다중 서비스 배포(compose 공식 스키마·환경 변수·설정 저장소 사본·기동 순서·-pl 빌드·k8s 중복 없음) · SBOM 합본 · 보안약점·평가서 모듈 표
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectWorkspace, isMultiModule, moduleOf, flattenYaml, gradleVariables, checkDependencies, updateProject, applyUpdate, generateDeploy, renderDeployMarkdown,
  rewriteLocal, springEnvName, planWorkspaceDeploy, mergeModuleBoms, checkSecureCoding, assessProject, renderAssessmentMarkdown, generateSbom, OUTPUT_SCHEMAS,
} from "../dist/index.js";
import { validateCompose, parseYaml } from "./spec-schemas.mjs";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
const root = mkdtempSync(path.join(tmpdir(), "egovws-"));
const docs = (yaml) => yaml.split(/^---$/m).slice(1).map((d) => parseYaml(d));

const egovParent = (v) => `<parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>${v}</version></parent>`;
const bootPom = (a, extra = "", parent = egovParent("5.0.1")) => `<project>${parent}<groupId>egov.msa</groupId><artifactId>${a}</artifactId><version>1.0.0</version><dependencies>${extra}<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-actuator</artifactId></dependency></dependencies><build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>`;
const dep = (g, a, v) => `<dependency><groupId>${g}</groupId><artifactId>${a}</artifactId>${v ? `<version>${v}</version>` : ""}</dependency>`;

try {
  // ── Maven 멀티 모듈(공식 msa-common-components 모양) ──
  const mvn = path.join(root, "msa");
  write(mvn, "pom.xml", `<project><groupId>egov.msa</groupId><artifactId>egov-msa</artifactId><version>5.0.4</version><packaging>pom</packaging><modules><module>ConfigServer</module><module>EurekaServer</module><module>EgovBoard</module><module>CommonLib</module><module>Child</module></modules></project>`);
  write(mvn, "ConfigServer/pom.xml", bootPom("ConfigServer", dep("org.springframework.cloud", "spring-cloud-config-server")));
  write(mvn, "ConfigServer/src/main/resources/application.yml", "server:\n  port: 8888\nspring:\n  profiles:\n    active: native\n  cloud:\n    config:\n      server:\n        native:\n          search-locations: classpath:/config # 설정\n");
  write(mvn, "ConfigServer/src/main/resources/config/application-local.yml", "datasource:\n  url: jdbc:mysql://localhost:3306/com\n  username: com\n  password: com01\n");
  write(mvn, "EurekaServer/pom.xml", bootPom("EurekaServer", dep("org.springframework.cloud", "spring-cloud-starter-netflix-eureka-server")));
  write(mvn, "EurekaServer/src/main/resources/application.yml", "server:\n  port: 8761\n");
  write(mvn, "EgovBoard/pom.xml", bootPom("EgovBoard", dep("org.springframework.boot", "spring-boot-starter-web") + dep("org.jsoup", "jsoup", "1.17.2"), egovParent("5.0.0")));
  write(mvn, "EgovBoard/src/main/resources/application.yml", [
    "server:", "  port: 0 # random", "spring:", "  config:", "    import: optional:configserver:http://localhost:8888", "  datasource:", "    url: ${datasource.url:jdbc:mysql://localhost:3306/com}",
    "  rabbitmq:", "    host: localhost", "    port: 5672", "    username: guest", "eureka:", "  client:", "    serviceUrl:", "      defaultZone: http://localhost:8761/eureka/", "info:", "  docs: http://localhost:9999/x", ""].join("\n"));
  write(mvn, "EgovBoard/src/main/java/egov/A.java", "class A { void f() { e.printStackTrace(); } }\n");
  write(mvn, "CommonLib/pom.xml", `<project>${egovParent("5.0.1")}<groupId>egov.msa</groupId><artifactId>CommonLib</artifactId><version>1.0.0</version></project>`);
  write(mvn, "Child/pom.xml", bootPom("Child", dep("org.springframework.boot", "spring-boot-starter-web"), `<parent><groupId>egov.msa</groupId><artifactId>egov-msa</artifactId><version>5.0.4</version></parent>`));
  write(mvn, "Child/src/main/resources/application.properties", "server.port=8085\n");

  const w = detectWorkspace(mvn);
  assert(w.kind === "maven-modules" && w.modules.length === 5 && isMultiModule(w), `Maven 멀티 모듈 ${w.modules.length}개`);
  assert(w.modules.find((m) => m.name === "CommonLib").library && !w.modules.find((m) => m.name === "EgovBoard").library && w.modules.find((m) => m.name === "ConfigServer").web, "라이브러리 jar 구분 · Spring Cloud 서버는 웹");
  assert(w.modules.find((m) => m.name === "Child").inheritsFrom === "" && w.modules.find((m) => m.name === "EgovBoard").inheritsFrom === null, "작업공간 안 parent(집계 pom)를 상속하는 모듈 표시");
  assert(moduleOf(w, "EgovBoard/src/main/java/egov/A.java").name === "EgovBoard" && moduleOf(w, "pom.xml") === null, "moduleOf: 가장 긴 접두 경로");

  // ── Gradle 독립 프로젝트(공식 msa-edu 모양) ──
  const gr = path.join(root, "edu");
  const gbuild = (extra) => `plugins {\n  id 'org.springframework.boot' version '3.5.6'\n  id 'io.spring.dependency-management' version '1.1.0'\n  id 'java'\n}\next {\n    set('egovframeBootParentVersion', '5.0.0')\n}\ndependencies {\n${extra}  implementation 'org.springframework.boot:spring-boot-starter-web'\n  implementation 'io.jsonwebtoken:jjwt-api:0.12.6'\n}\ndependencyManagement {\n  imports {\n    mavenBom "org.egovframe.boot:egovframe-boot-starter-parent:\${egovframeBootParentVersion}"\n  }\n}\n`;
  write(gr, "backend/config/build.gradle", gbuild(""));
  write(gr, "backend/config/Dockerfile", "FROM eclipse-temurin:17-jre\nCOPY build/libs/*.jar app.jar\n");
  write(gr, "backend/config/src/main/resources/application.yml", "server:\n  port: 8888\n");
  write(gr, "backend/board-service/build.gradle", gbuild(`  implementation("org.egovframe.cloud:egovframe-cloud-module-common:\${egovframeBootParentVersion}")\n  implementation("org.egovframe.rte:egovframe-rte-fdl-cmmn:\${egovframeBootParentVersion}")\n`));
  write(gr, "backend/board-service/Dockerfile", "FROM eclipse-temurin:17-jre\nCOPY build/libs/*.jar app.jar\n");
  write(gr, "backend/board-service/src/main/resources/bootstrap.yml", "spring:\n  cloud:\n    config:\n      uri: http://localhost:8888\n");
  write(gr, "backend/module-common/build.gradle", "plugins {\n  id 'org.springframework.boot' version '3.5.6'\n  id 'java'\n}\nbootJar {\n  enabled = false\n}\n");
  const wg = detectWorkspace(gr);
  assert(wg.kind === "independent" && wg.modules.length === 3 && wg.modules.find((m) => m.name === "module-common").library && wg.modules.every((m) => m.dir.startsWith("backend/")), "Gradle 독립 프로젝트 3개 · bootJar 끈 공통 모듈은 라이브러리");
  const gi = path.join(root, "gi");
  write(gi, "settings.gradle", "rootProject.name = 'gi'\ninclude 'api', ':batch'\n");
  write(gi, "build.gradle", "");
  write(gi, "api/build.gradle", gbuild(""));
  write(gi, "batch/build.gradle", "plugins { id 'java' }\n");
  const wi = detectWorkspace(gi);
  assert(wi.kind === "gradle-include" && wi.modules.map((m) => m.dir).join() === "api,batch" && wi.modules[1].library, "Gradle include 2개");
  assert(detectWorkspace(path.join(mvn, "EgovBoard")).kind === "single" && !isMultiModule(detectWorkspace(path.join(mvn, "EgovBoard"))), "모듈 디렉터리 자체는 single");
  assert(detectWorkspace(path.join(root, "empty-none")).kind === "none", "빌드 파일 없음 → none");

  // ── 도우미 ──
  const y = flattenYaml("a:\n  b: 1 # c\n  c:\n    - x\n  d:\n    e: 'q'\n---\na:\n  b: 2\n");
  assert(y.get("a.b").value === "2" && y.get("a.d.e").value === "q" && !y.has("a.c"), "flattenYaml: 중첩·주석·따옴표·리스트 건너뜀·뒤 문서 우선");
  const ports = new Map([[8888, { host: "configserver", kind: "service" }], [3306, { host: "db", kind: "db" }]]);
  assert(rewriteLocal("optional:configserver:http://localhost:8888", ports).value === "optional:configserver:http://configserver:8888" && rewriteLocal("${x:jdbc:mysql://127.0.0.1:3306/c}", ports).value === "${x:jdbc:mysql://db:3306/c}" && rewriteLocal("http://example.com", ports) === null && rewriteLocal("http://localhost:9999", ports).unknown[0] === 9999, "rewriteLocal: 포트로 대상 찾기·모르는 포트 보고");
  assert(springEnvName("spring.cloud.config.server.native.search-locations") === "SPRING_CLOUD_CONFIG_SERVER_NATIVE_SEARCHLOCATIONS" && springEnvName("eureka.client.serviceUrl.defaultZone") === "EUREKA_CLIENT_SERVICEURL_DEFAULTZONE", "Spring 완화 바인딩 환경 변수 이름");
  const gv = gradleVariables("ext {\n  set('a', '1.0')\n  b = '2.0'\n}\ndef c = '3'\nversion = '9'\n", "d=4\n");
  assert(gv.get("a") === "1.0" && gv.get("b") === "2.0" && gv.get("c") === "3" && gv.get("d") === "4" && !gv.has("version"), "Gradle 변수: set()·ext·def·gradle.properties (version 제외)");

  // ── 의존성 점검 ──
  const dm = await checkDependencies({ projectDir: mvn });
  assert(dm.workspace?.modules.length === 5 && dm.findings.filter((f) => f.module === "EgovBoard").length > 0, "Maven: 모듈별 요약·항목에 모듈");
  assert(dm.summary.unversioned === 0 && dm.findings.find((f) => f.artifactId === "spring-boot-starter-web" && f.module === "EgovBoard").status === "managed", "모듈 parent(공식)로 버전 없는 좌표는 parent 관리(루트에 parent 없어도)");
  assert(dm.parent.artifactId === "egovframe-boot-starter-parent" && dm.parent.version === "5.0.0" && dm.parent.status === "outdated", "루트 parent 없음 → 가장 낮은 모듈 parent 를 대표로");
  const dg = await checkDependencies({ projectDir: gr });
  assert(dg.buildSystem === "gradle" && dg.findings.length >= 6 && dg.workspace?.modules.length === 3, `Gradle 독립: 빌드 도구 인식·의존성 ${dg.findings.length}건(전에는 0)`);
  assert(dg.findings.find((f) => f.artifactId === "egovframe-rte-fdl-cmmn").resolvedVersion === "5.0.0" && dg.findings.find((f) => f.artifactId === "spring-boot-starter-web").status === "managed" && !dg.findings.some((f) => f.artifactId === "egovframe-boot-starter-parent"), "Gradle 변수 풀기·BOM 관리·BOM import 줄 제외");
  assert(dg.parent.version === "5.0.0" && dg.parent.kind === "boot", "Gradle mavenBom 공식 parent → parent 5.0.0");
  assert(OUTPUT_SCHEMAS.check_egovframe_dependencies.safeParse(dg).success, "의존성 결과 outputSchema");

  // ── 5.x 최신 유지 ──
  const ug = updateProject({ projectDir: gr });
  const cfgItem = ug.items.find((i) => i.file === "backend/config/build.gradle");
  const boardItem = ug.items.find((i) => i.file === "backend/board-service/build.gradle");
  assert(cfgItem?.action === "auto" && cfgItem.kind === "parent-version" && cfgItem.from === "egovframeBootParentVersion = 5.0.0", "Gradle 변수가 공식 parent BOM 에만 쓰이면 auto");
  assert(boardItem?.action === "manual" && boardItem.reason.includes("egovframe-cloud-module-common"), "다른 좌표(직접 배포한 공통 모듈)에도 쓰이면 manual + 그 좌표 안내");
  assert(ug.update.from === "5.0.0" && ug.update.parent?.version === "5.0.0" && ug.update.modules?.length === 3, "실효 버전·parent·모듈 요약");
  const um = updateProject({ projectDir: mvn });
  assert(um.items.filter((i) => i.kind === "parent-version").length === 4 && um.update.parent?.version === "5.0.0", `Maven 모듈 parent ${um.items.filter((i) => i.kind === "parent-version").length}건 auto · 대표 parent 5.0.0`);
  const grCopy = path.join(root, "edu-apply");
  for (const f of ["backend/config/build.gradle", "backend/board-service/build.gradle"]) write(grCopy, f, readFileSync(path.join(gr, f), "utf8"));
  const ap = await applyUpdate({ projectDir: grCopy, dryRun: false });
  assert(readFileSync(path.join(grCopy, "backend/config/build.gradle"), "utf8").includes("set('egovframeBootParentVersion', '5.0.2')") && readFileSync(path.join(grCopy, "backend/board-service/build.gradle"), "utf8").includes("'5.0.0'") && ap.remaining.auto === 0, "적용: auto 만 바뀌고 manual 은 그대로");

  // ── 다중 서비스 배포 ──
  const plan = planWorkspaceDeploy(mvn);
  const svc = (nm) => plan.services.find((s) => s.name === nm);
  assert(plan.services.map((s) => s.name).sort().join() === "child,configserver,egovboard,eurekaserver" && plan.skipped.some((x) => x.module === "CommonLib"), "서비스 4개 · 라이브러리 제외");
  const b = svc("egovboard");
  const envOf = (s) => Object.fromEntries(s.env.map((e) => [e.name, e.value]));
  assert(envOf(b).SPRING_CONFIG_IMPORT === "optional:configserver:http://configserver:8888" && envOf(b).EUREKA_CLIENT_SERVICEURL_DEFAULTZONE === "http://eurekaserver:8761/eureka/" && envOf(b).SPRING_RABBITMQ_HOST === "rabbitmq" && envOf(b).SERVER_PORT === "8080", "모듈 설정의 localhost 참조 → 환경 변수(설정 서버·디스커버리·브로커·임의 포트 고정)");
  assert(envOf(b).SPRING_RABBITMQ_USERNAME === "egov" && b.env.find((e) => e.name === "SPRING_RABBITMQ_PASSWORD").secret, "브로커 계정은 guest 대신 만든 계정");
  assert(b.dependsOn.sort().join() === "configserver,db,eurekaserver,rabbitmq" && plan.infra.map((i) => i.name).sort().join() === "db,rabbitmq", "기동 순서·인프라(DB·브로커)");
  assert(plan.unresolved.some((u) => u.value.includes("9999")), "모르는 포트(9999)는 보고");
  const cs = svc("configserver");
  assert(cs.configRepo?.files[0].content.includes("jdbc:mysql://db:3306/com") && envOf(cs).SPRING_CLOUD_CONFIG_SERVER_NATIVE_SEARCHLOCATIONS === "file:/config-repo/", "설정 서버 저장소 사본(localhost → db) · 위치 환경 변수");
  const db = plan.infra.find((i) => i.name === "db");
  assert(db.env.MYSQL_USER === "com" && db.env.MYSQL_DATABASE === "com" && db.env.MYSQL_PASSWORD === "${DB_PASSWORD:-com01}", "DB 컨테이너 계정·DB 이름·비밀번호 기본값을 설정과 같게");
  assert(svc("child").context === "" && svc("child").dockerfile === "Child/Dockerfile", "작업공간 parent 상속 모듈은 루트 컨텍스트");

  const r = await generateDeploy({ projectDir: mvn, buildInImage: false });
  const fl = (p) => r.files.find((f) => f.path === p)?.content;
  assert(r.supported && r.dryRun && r.workspace?.services.length === 4 && !existsSync(path.join(mvn, "deploy")), "generateDeploy: 다중 서비스 dryRun 무기록");
  const compose = fl("deploy/docker-compose.yml");
  assert(validateCompose(compose) === null, `docker-compose: 공식 Compose 스키마 통과${validateCompose(compose) ? `: ${validateCompose(compose)}` : ""}`);
  const cd = parseYaml(compose);
  assert(cd.services.egovboard.environment.SPRING_DATASOURCE_URL === "$${datasource.url:jdbc:mysql://db:3306/com}", "Spring 자리표시자는 $$ 로 막아 compose 가 치환하지 않음");
  assert(cd.services.egovboard.depends_on.configserver.condition === "service_healthy" && cd.services.egovboard.depends_on.rabbitmq.condition === "service_healthy" && !cd.services.egovboard.ports && cd.services.configserver.ports[0].endsWith(":8888"), "depends_on healthy · 임의 포트 서비스는 발행 안 함·고정 포트만 발행");
  assert(cd.services.configserver.volumes[0] === "./config-repo:/config-repo:ro" && fl("deploy/config-repo/application-local.yml").includes("db:3306"), "설정 저장소 볼륨·사본 파일");
  assert(cd.services.child.build.context === ".." && cd.services.child.build.dockerfile === "Child/Dockerfile" && fl("Child/Dockerfile").includes("COPY Child/target/") && fl("Child/Dockerfile.dockerignore").includes("!Child/target/"), "루트 컨텍스트 모듈: Dockerfile·dockerignore 경로");
  assert(fl("EgovBoard/Dockerfile").includes("EXPOSE 8080") && fl("EgovBoard/.dockerignore").includes("!target/") && cd.services.egovboard.build.context === "../EgovBoard", "모듈 컨텍스트: Dockerfile·dockerignore");
  const r2 = await generateDeploy({ projectDir: mvn, buildInImage: true });
  assert(r2.files.find((f) => f.path === "Child/Dockerfile").content.includes("-pl Child -am package"), "이미지 안 빌드: 루트 컨텍스트 모듈은 mvn -pl <모듈> -am");
  const kb = docs(fl("deploy/k8s/egovboard.yaml"));
  const cm = kb.find((d) => d.kind === "ConfigMap");
  assert(cm.data.SPRING_RABBITMQ_HOST === "CHANGE_ME_RABBITMQ_HOST" && cm.data.EUREKA_CLIENT_SERVICEURL_DEFAULTZONE === "http://eurekaserver:8761/eureka/" && kb.find((d) => d.kind === "Secret").stringData.SPRING_RABBITMQ_PASSWORD === "CHANGE_ME", "k8s: 서비스는 Service DNS, 인프라는 CHANGE_ME, 비밀은 Secret");
  const keys = fl("deploy/k8s/egovboard.yaml").split("\n").filter((l) => /^  [A-Z_]+:/.test(l)).map((l) => l.trim().split(":")[0]);
  assert(keys.length === new Set(keys).size, "k8s ConfigMap·Secret 키 중복 없음");
  const kcs = docs(fl("deploy/k8s/configserver.yaml"));
  assert(kcs.find((d) => d.kind === "Deployment").spec.template.spec.volumes[0].configMap.name === "egov-msa-config-repo" && docs(fl("deploy/k8s/egov-msa-config-repo.yaml"))[0].data["application-local.yml"].includes("CHANGE_ME_DB_HOST:3306"), "k8s: 설정 저장소 ConfigMap 마운트(DB 호스트 자리표시자)");
  assert(fl("deploy/.env.example").includes("DB_PASSWORD=com01") && fl("deploy/.env.example").includes("RABBITMQ_PASSWORD=CHANGE_ME"), ".env.example");
  assert(OUTPUT_SCHEMAS.generate_egovframe_deploy.safeParse({ ...r, files: r.files.map(({ content: _c, ...x }) => x) }).success, "배포 결과 outputSchema");
  assert(renderDeployMarkdown(r).includes("| egovboard | EgovBoard |"), "Markdown 서비스 표");
  const rg = await generateDeploy({ projectDir: gr });
  assert(rg.workspace.services.length === 2 && rg.workspace.services.every((s) => s.ownDockerfile) && !rg.files.some((f) => f.path.endsWith("/Dockerfile")) && parseYaml(rg.files.find((f) => f.path === "deploy/docker-compose.yml").content).services["board-service"].environment.SPRING_CLOUD_CONFIG_URI === "http://config:8888", "자체 Dockerfile 은 그대로 · bootstrap.yml 참조도 치환");
  const rm = await generateDeploy({ projectDir: mvn, modules: ["EgovBoard"] });
  assert(rm.workspace.services.map((x) => x.name).sort().join() === "configserver,egovboard,eurekaserver" && rm.workspace.infra.map((i) => i.name).sort().join() === "db,rabbitmq" && validateCompose(rm.files.find((f) => f.path === "deploy/docker-compose.yml").content) === null, "modules=[EgovBoard]: 먼저 뜰 서비스·인프라를 함께 넣음(compose 스키마 통과)");
  let badMod = null;
  try { await generateDeploy({ projectDir: mvn, modules: ["Nope"] }); } catch (e) { badMod = e.message; }
  assert(badMod?.includes("작업공간에 없는"), "없는 모듈은 거부");
  const rw = await generateDeploy({ projectDir: mvn, dryRun: false, buildInImage: false });
  assert(rw.written && existsSync(path.join(mvn, "deploy/docker-compose.yml")) && existsSync(path.join(mvn, "EgovBoard/Dockerfile")), "적용: 파일 생성");
  let refused = null;
  try { await generateDeploy({ projectDir: mvn, dryRun: false }); } catch (e) { refused = e.message; }
  assert(refused?.includes("덮어쓰지 않습니다"), "다시 만들면 거부(새 파일만)");

  // ── SBOM 합본 ──
  const part = (nm, comps) => ({ name: nm, dir: `backend/${nm}`, bom: { bomFormat: "CycloneDX", specVersion: "1.6", metadata: { component: { type: "application", name: nm, "bom-ref": `pkg:maven/x/${nm}@1` } }, components: comps.map((c) => ({ type: "library", name: c, version: "1", "bom-ref": `pkg:maven/g/${c}@1`, purl: `pkg:maven/g/${c}@1` })), dependencies: [{ ref: `pkg:maven/x/${nm}@1`, dependsOn: comps.map((c) => `pkg:maven/g/${c}@1`) }] } });
  const mb = mergeModuleBoms("edu", [part("a", ["x", "y"]), part("b", ["y", "z"])], () => Date.parse("2026-10-16T00:00:00Z"));
  assert(mb.metadata.component.name === "edu" && mb.components.length === 5 && mb.dependencies[0].dependsOn.length === 2 && mb.metadata.timestamp === "2026-10-16T00:00:00Z", "SBOM 합본: 작업공간 주 component · 모듈 2 + 라이브러리 3(중복 제거) · 의존관계");
  const sd = await generateSbom({ projectDir: gr });
  assert(sd.dryRun && sd.command.startsWith("(프로젝트별 3개"), "루트 빌드 파일 없는 작업공간도 SBOM 계획(전에는 오류)");

  // ── 보안약점·평가서 ──
  const sc = await checkSecureCoding({ projectDir: mvn });
  assert(sc.byModule?.length === 5 && sc.byModule.find((m) => m.module === "EgovBoard").low === 1 && sc.byModule.find((m) => m.module === "ConfigServer").total === 1 && sc.byModule.reduce((n, m) => n + m.total, 0) <= sc.summary.total, "보안약점 모듈별 건수(모듈 밖 파일은 합계에만)");
  const a = await assessProject({ projectDir: mvn });
  assert(a.modules?.length === 5 && a.modules.find((m) => m.name === "EgovBoard").updateAuto === 1 && renderAssessmentMarkdown(a).includes("### 모듈 (5개"), "평가서 모듈 표(의존성·최신 유지·보안약점)");
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`workspace FAIL (${n} assertions)`); else console.log(`workspace OK (${n} assertions)`);
