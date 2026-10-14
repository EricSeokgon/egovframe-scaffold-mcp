// node test/deploy.mjs — 컨테이너·배포 산출물(v0.45) 오프라인 검증: 프로젝트 분석(Classic·Boot·Gradle·DB 종류·지원 안 함),
//   Dockerfile 구조(멀티 스테이지·미리 빌드·비루트·HEALTHCHECK·Tomcat 10.1/11), docker-compose(공식 Compose 스키마), Kubernetes(구조·보안 설정),
//   설정 주입(Boot 환경 변수·Classic 설정 파일), 입력 검증·새 파일만·dryRun. 실제 빌드·기동은 CI 통합 test:deploy-live.
import { analyzeDeploy, generateDeploy, renderDeployMarkdown, parseProperties, parseJdbcUrl, envNameOf, loadDeployRules, OUTPUT_SCHEMAS, SERVER_VERSION } from "../dist/index.js";
import { validateCompose, parseYaml } from "./spec-schemas.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
const root = mkdtempSync(path.join(tmpdir(), "egovdeploy-"));
const mk = (name, files) => { const d = path.join(root, name); for (const [k, v] of Object.entries(files)) write(d, k, v); return d; };
const docs = (yaml) => yaml.split(/^---$/m).slice(1).map((d) => parseYaml(d));

// ── 규칙·도우미 ──────────────────────────────────────────
const rules = loadDeployRules();
assert(rules.jdks.join() === "17,21" && rules.images.tomcat.includes("10.1") && rules.images.tomcat11.includes("11.0") && rules.databases.mysql && rules.databases.maria && rules.databases.postgres && rules.externalDatabases.oracle && rules.unsupported.length === 3, "규칙: JDK 17·21, Tomcat 10.1/11, DB 3종 컨테이너·상용 DB 외부, 지원 안 함 3종");
const pp = parseProperties("# c\nGlobals.DbType = mysql\nGlobals.mysql.Url=jdbc:log4jdbc:mysql://127.0.0.1:3306/sht\n!x\nA:b\n");
assert(pp.get("Globals.DbType").value === "mysql" && pp.get("Globals.mysql.Url").line === 3 && pp.get("A").value === "b" && !pp.has("# c"), "properties 해석(주석·= ·:)");
assert(JSON.stringify(parseJdbcUrl("jdbc:log4jdbc:mysql://127.0.0.1:3306/sht")) === JSON.stringify({ host: "127.0.0.1", port: 3306, database: "sht" }) && parseJdbcUrl("jdbc:postgresql://pg/egov?x=1").database === "egov" && parseJdbcUrl("jdbc:oracle:thin:@h:1521:xe") === null, "jdbc URL 해석(log4jdbc 접두어, Oracle thin 은 미해석)");
assert(envNameOf("Globals.mysql.Url") === "GLOBALS_MYSQL_URL" && envNameOf("spring.datasource.url") === "SPRING_DATASOURCE_URL", "Spring 환경 변수 이름");

// ── 픽스처 ───────────────────────────────────────────────
const classic = mk("classic", {
  "pom.xml": `<project><parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.2</version></parent><artifactId>egov-portal</artifactId><version>1.2.0</version><packaging>war</packaging><dependencies><dependency><artifactId>jakarta.servlet-api</artifactId></dependency></dependencies></project>`,
  "src/main/resources/egovframework/egovProps/globals.properties": "# DB\nGlobals.DbType = mysql\nGlobals.UserName = pst\nGlobals.Password = pst01\nGlobals.DriverClassName = net.sf.log4jdbc.DriverSpy\nGlobals.Url = jdbc:log4jdbc:mysql://127.0.0.1:3306/pst\n#Globals.Url=jdbc:oracle:thin:@127.0.0.1:1521:xe\nGlobals.MainPage = /main.do\n",
  "DATABASE/mysql/all_pst_ddl_mysql.sql": "create table a(x int);", "DATABASE/mysql/all_pst_data_mysql.sql": "insert into a values(1);", "DATABASE/oracle/all_pst_ddl_oracle.sql": "--",
});
const boot = mk("boot", {
  "pom.xml": `<project><parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>5.0.2</version></parent><artifactId>Simple_Backend</artifactId><version>5.0.2</version><packaging>jar</packaging><dependencies><dependency><artifactId>spring-boot-starter-actuator</artifactId></dependency><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>`,
  "src/main/resources/application.properties": "server.port=8081\nserver.servlet.context-path=/api\nmanagement.endpoint.health.probes.enabled=true\nGlobals.DbType=maria\nGlobals.maria.DriverClassName=org.mariadb.jdbc.Driver\nGlobals.maria.Url=jdbc:mariadb://127.0.0.1:3306/sht\nGlobals.maria.UserName=egov\nGlobals.maria.Password=\n",
  "src/main/resources/db/sht_ddl_maria.sql": "--", "src/main/resources/db/sht_data_maria.sql": "--",
});
const gradle = mk("gradle", {
  "settings.gradle": "rootProject.name = 'g-batch'\n", "gradlew": "#!/bin/sh\n",
  "build.gradle": "plugins { id 'java'\n id 'org.springframework.boot' version '3.5.6' }\nversion = '0.9.0'\ndependencies { implementation 'org.springframework.boot:spring-boot-starter-batch' }\n",
});
const pg = mk("pg", {
  "pom.xml": `<project><parent><artifactId>spring-boot-starter-parent</artifactId><version>3.5.6</version></parent><artifactId>pg-app</artifactId><version>1.0</version><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>`,
  "src/main/resources/application.properties": "spring.datasource.url=jdbc:postgresql://localhost:5432/egov\nspring.datasource.username=egov\n",
});
const ora = mk("ora", {
  "pom.xml": `<project><artifactId>ora-web</artifactId><version>1.0</version><packaging>war</packaging><dependencies><dependency><groupId>jakarta.servlet</groupId><artifactId>jakarta.servlet-api</artifactId><version>6.1.0</version></dependency></dependencies></project>`,
  "src/main/resources/egovframework/egovProps/globals.properties": "Globals.DbType = oracle\nGlobals.oracle.Url=jdbc:oracle:thin:@10.0.0.5:1521:egov\nGlobals.oracle.UserName=egov\nGlobals.oracle.Password=x\n",
});
const hsql = mk("hsql", { "pom.xml": `<project><artifactId>hsql-web</artifactId><version>1.0</version><packaging>war</packaging></project>`, "src/main/resources/egovframework/egovProps/globals.properties": "Globals.DbType = hsql\n" });
const multi = mk("multi", { "pom.xml": "<project><artifactId>m</artifactId><modules><module>a</module></modules></project>" });
const lib = mk("lib", { "pom.xml": "<project><artifactId>lib</artifactId><version>1</version></project>" });
const front = mk("front", { "package.json": "{}" });

// ── 분석 ─────────────────────────────────────────────────
const ac = analyzeDeploy(classic).profile;
assert(ac.packaging === "war" && ac.runtime === "tomcat" && ac.tomcat === "10.1" && ac.web && ac.port === 8080 && ac.liveness === "/" && ac.appName === "egov-portal" && ac.version === "1.2.0", "Classic war → Tomcat 10.1, 포트 8080, 헬스 /");
assert(ac.db.type === "mysql" && ac.db.inject === "file" && ac.db.keys.url === "Globals.Url" && ac.db.user === "pst" && ac.db.database === "pst" && ac.db.service === "container" && ac.db.initScripts.join() === "DATABASE/mysql/all_pst_ddl_mysql.sql,DATABASE/mysql/all_pst_data_mysql.sql", "Classic DB: Globals.Url 형식, 설정 파일 덮어쓰기, ddl→data 초기화(다른 DB 스크립트 제외)");
const ab = analyzeDeploy(boot).profile;
assert(ab.runtime === "boot" && ab.actuator && ab.port === 8081 && ab.contextPath === "/api" && ab.liveness === "/api/actuator/health/liveness" && ab.readiness === "/api/actuator/health/readiness" && ab.appName === "simple-backend", "Boot: server.port·context-path·actuator 프로브, 앱 이름 소문자화");
assert(ab.db.type === "maria" && ab.db.inject === "env" && ab.db.keys.url === "Globals.maria.Url" && ab.db.user === "egov" && ab.db.initScripts.length === 2, "Boot DB: Globals.<type>.Url 형식, 환경 변수 주입, maria 별칭·초기화");
const ag = analyzeDeploy(gradle).profile;
assert(ag.buildTool === "gradle" && ag.wrapper && ag.packaging === "jar" && !ag.web && ag.appName === "g-batch" && ag.version === "0.9.0" && ag.db === null, "Gradle Boot 배치: 래퍼·웹 없음·DB 없음");
const ap = analyzeDeploy(pg).profile;
assert(ap.db.type === "postgres" && ap.db.inject === "env" && ap.db.keys.url === "spring.datasource.url" && ap.db.service === "container" && ap.liveness === "/", "spring.datasource.url(PostgreSQL) — 환경 변수, actuator 없으면 헬스 /");
const ao = analyzeDeploy(ora).profile;
assert(ao.tomcat === "11.0" && ao.db.type === "oracle" && ao.db.service === "external" && ao.db.host === null, "Servlet 6.1 직접 선언 → Tomcat 11, Oracle 은 외부 DB");
assert(analyzeDeploy(hsql).profile.db.inject === "none", "HSQL(내장) 은 덮어쓸 것 없음");
for (const [d, id] of [[multi, "multi-module"], [lib, "not-runnable"], [front, "no-build-file"]]) { const a = analyzeDeploy(d); assert(a.profile === null && a.unsupported.id === id && a.unsupported.reason.length > 10, `지원 안 함: ${id}`); }

// ── Classic 생성(dryRun) ─────────────────────────────────
const rc = await generateDeploy({ projectDir: classic });
assert(rc.supported && rc.dryRun && !rc.written && rc.files.map((f) => f.path).join() === "Dockerfile,.dockerignore,deploy/docker-compose.yml,deploy/.env.example,deploy/config/globals.properties,deploy/k8s/egov-portal.yaml" && !existsSync(path.join(classic, "Dockerfile")), "Classic dryRun: 6개 파일(설정 사본 포함)·무기록");
const fc = (p) => rc.files.find((f) => f.path === p).content;
const df = fc("Dockerfile");
assert(!df.includes("# syntax=") && df.includes("BuildKit") && /^ARG BASE_REGISTRY=docker\.io\/library$/m.test(df) && /^FROM \$\{BASE_REGISTRY\}\/maven:3\.9-eclipse-temurin-17 AS build$/m.test(df) && df.includes("--mount=type=cache,target=/root/.m2 mvn -B -q -DskipTests") && df.includes("retryHandler.serviceUnavailable=429,500,502,503,504"), "Dockerfile: 멀티 스테이지 Maven(캐시 마운트·5xx 재시도), BASE_REGISTRY");
assert(df.includes("RUN jar xf /workspace/app.war && test -d WEB-INF") && /^FROM \$\{BASE_REGISTRY\}\/tomcat:10\.1-jdk17-temurin$/m.test(df) && df.includes("COPY --from=build --chown=app:app /workspace/ROOT /usr/local/tomcat/webapps/ROOT") && /^USER 10001$/m.test(df) && df.includes("HEALTHCHECK") && df.includes("http://127.0.0.1:8080/ ") && df.includes("TZ=Asia/Seoul") && df.includes("-Dfile.encoding=UTF-8"), "Classic: WAR 를 ROOT 로 풀고 Tomcat 10.1·비루트·HEALTHCHECK·시간대·인코딩");
assert(fc(".dockerignore").split("\n").includes("target") && fc(".dockerignore").split("\n").includes("deploy"), ".dockerignore: 빌드 산출물·deploy 제외");
const cc = fc("deploy/docker-compose.yml");
assert(validateCompose(cc) === null, `docker-compose: 공식 Compose 스키마 통과${validateCompose(cc) ? `: ${validateCompose(cc)}` : ""}`);
const ccd = parseYaml(cc);
assert(ccd.name === "egov-portal" && ccd.services.app.build.context === ".." && ccd.services.app.build.dockerfile === "Dockerfile" && ccd.services.app.depends_on.db.condition === "service_healthy" && ccd.services.app.volumes[0] === "./config/globals.properties:/usr/local/tomcat/webapps/ROOT/WEB-INF/classes/egovframework/egovProps/globals.properties:ro", "compose app: 빌드·DB 준비 후 기동·설정 파일 볼륨(ROOT 아래 경로)");
assert(ccd.services.db.image === "${BASE_REGISTRY:-docker.io/library}/mysql:8.4" && ccd.services.db.environment.MYSQL_USER === "pst" && ccd.services.db.environment.MYSQL_DATABASE === "pst" && ccd.services.db.command.includes("--lower-case-table-names=1") && ccd.services.db.volumes.includes("../DATABASE/mysql/all_pst_ddl_mysql.sql:/docker-entrypoint-initdb.d/01-all_pst_ddl_mysql.sql:ro") && ccd.services.db.healthcheck.test[0] === "CMD-SHELL" && ccd.volumes["db-data"], "compose db: mysql 8.4(레지스트리 변수)·사용자·DB·대소문자·초기화 순서·헬스체크·볼륨");
const cfg = fc("deploy/config/globals.properties");
assert(cfg.includes("Globals.Url = jdbc:log4jdbc:mysql://db:3306/pst") && cfg.includes("Globals.Password = CHANGE_ME") && !cfg.includes("pst01") && cfg.includes("#Globals.Url=jdbc:oracle") && cfg.includes("Globals.MainPage = /main.do"), "Classic 설정 사본: DB 호스트·비밀번호만 바꾸고 나머지(주석 포함) 그대로");
const kc = docs(fc("deploy/k8s/egov-portal.yaml"));
assert(kc.map((d) => d.kind).join() === "ConfigMap,Secret,Deployment,Service", "Kubernetes: ConfigMap·Secret·Deployment·Service");
const dep = kc.find((d) => d.kind === "Deployment");
const ctr = dep.spec.template.spec.containers[0];
assert(dep.spec.template.spec.securityContext.runAsNonRoot === true && dep.spec.template.spec.securityContext.runAsUser === 10001 && dep.spec.template.spec.securityContext.seccompProfile.type === "RuntimeDefault" && ctr.securityContext.allowPrivilegeEscalation === false && ctr.securityContext.capabilities.drop[0] === "ALL" && ctr.resources.limits.memory && ctr.startupProbe.httpGet.path === "/" && ctr.readinessProbe && ctr.livenessProbe && ctr.image === "egov-portal:1.2.0", "Deployment: 비루트·seccomp·권한 상승 금지·capabilities drop·리소스·startup/readiness/liveness 프로브·이미지");
const sec = kc.find((d) => d.kind === "Secret");
assert(sec.stringData["globals.properties"].includes("jdbc:log4jdbc:mysql://CHANGE_ME_DB_HOST:3306/pst") && ctr.volumeMounts[0].mountPath.endsWith("WEB-INF/classes/egovframework/egovProps/globals.properties") && ctr.volumeMounts[0].subPath === "globals.properties" && dep.spec.template.spec.volumes[0].secret.secretName === "egov-portal-secret", "Classic Kubernetes: 설정 파일을 Secret 으로 subPath 마운트(DB 호스트 자리표시자)");
assert(kc.find((d) => d.kind === "Service").spec.ports[0].targetPort === "http" && rc.usage.some((u) => u.startsWith("docker build -t egov-portal:1.2.0 .")) && rc.usage.some((u) => u.includes("docker compose up --build")), "Service·사용법");
assert(OUTPUT_SCHEMAS.generate_egovframe_deploy.safeParse(rc).success && renderDeployMarkdown(rc).includes("### Dockerfile") && renderDeployMarkdown(rc).includes("Tomcat 10.1(ROOT)"), "outputSchema·Markdown(dryRun 은 내용 포함)");

// ── Boot(maria·context-path·환경 변수) ────────────────────
const rb = await generateDeploy({ projectDir: boot, imageRegistry: "harbor.example.go.kr/dockerhub", ingressHost: "egov.example.go.kr", jdk: "21" });
const fb = (p) => rb.files.find((f) => f.path === p).content;
const bdf = fb("Dockerfile");
assert(/^ARG BASE_REGISTRY=harbor\.example\.go\.kr\/dockerhub$/m.test(bdf) && bdf.includes("maven:3.9-eclipse-temurin-21") && /^FROM \$\{BASE_REGISTRY\}\/eclipse-temurin:21-jre$/m.test(bdf) && bdf.includes("cp {} /workspace/app.jar") && bdf.includes("! -name '*-plain.jar'") && bdf.includes('ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]') && bdf.includes("EXPOSE 8081") && bdf.includes("http://127.0.0.1:8081/api/actuator/health/liveness"), "Boot: JDK 21·사내 레지스트리·실행 jar(plain 제외)·exec java·포트·컨텍스트 경로 헬스");
const bc = parseYaml(fb("deploy/docker-compose.yml"));
assert(validateCompose(fb("deploy/docker-compose.yml")) === null && bc.services.app.environment.GLOBALS_MARIA_URL === "jdbc:mariadb://db:3306/sht" && bc.services.app.environment.GLOBALS_MARIA_PASSWORD === "${DB_PASSWORD:-CHANGE_ME}" && bc.services.app.environment.GLOBALS_DBTYPE === "maria" && !bc.services.app.volumes, "Boot compose: Spring 환경 변수로 DB 덮어쓰기(호스트 db, 비밀번호는 .env)·스키마 통과");
assert(bc.services.db.image.endsWith("/mariadb:11.4") && bc.services.db.environment.MARIADB_USER === "egov" && bc.services.db.healthcheck.test[1].includes("healthcheck.sh"), "maria: mariadb 11.4·사용자·헬스체크");
const kb = docs(fb("deploy/k8s/simple-backend.yaml"));
const cm = kb.find((d) => d.kind === "ConfigMap"), bs = kb.find((d) => d.kind === "Secret"), bd = kb.find((d) => d.kind === "Deployment"), ing = kb.find((d) => d.kind === "Ingress");
assert(cm.data.GLOBALS_MARIA_URL === "jdbc:mariadb://CHANGE_ME_DB_HOST:3306/sht" && !("GLOBALS_MARIA_PASSWORD" in cm.data) && bs.stringData.GLOBALS_MARIA_PASSWORD === "CHANGE_ME" && bd.spec.template.spec.containers[0].envFrom.length === 2, "Boot Kubernetes: 비밀번호만 Secret, 나머지 ConfigMap(envFrom)");
assert(bd.spec.template.spec.containers[0].readinessProbe.httpGet.path === "/api/actuator/health/readiness" && ing.spec.rules[0].host === "egov.example.go.kr" && ing.spec.rules[0].http.paths[0].path === "/api", "actuator readiness·Ingress(호스트·컨텍스트 경로)");

// ── 미리 빌드한 산출물·Gradle·외부 DB ────────────────────
const rp = await generateDeploy({ projectDir: classic, buildInImage: false, targets: ["docker"] });
const pdf = rp.files.find((f) => f.path === "Dockerfile").content;
assert(rp.files.length === 2 && !pdf.includes("maven:") && pdf.includes("FROM ${BASE_REGISTRY}/eclipse-temurin:17-jdk AS build") && pdf.includes("COPY target/ /workspace/target/") && rp.files.find((f) => f.path === ".dockerignore").content.split("\n").includes("!target/*.war") && rp.notes.some((x) => x.includes("buildInImage=false")), "buildInImage=false: 미리 빌드한 war 만 보내는 Dockerfile·.dockerignore");
const rg = await generateDeploy({ projectDir: gradle });
const gdf = rg.files.find((f) => f.path === "Dockerfile").content;
assert(gdf.includes("eclipse-temurin:17-jdk AS build") && gdf.includes("--mount=type=cache,target=/root/.gradle chmod +x ./gradlew && ./gradlew") && gdf.includes("find build/libs") && !gdf.includes("EXPOSE") && !gdf.includes("HEALTHCHECK") && !docs(rg.files.find((f) => f.path.startsWith("deploy/k8s/")).content).some((d) => d.kind === "Service") && rg.notes.some((x) => x.includes("Job·CronJob")), "Gradle 배치: 래퍼 빌드·포트·헬스체크·Service 없음 + Job 안내");
assert(validateCompose(rg.files.find((f) => f.path === "deploy/docker-compose.yml").content) === null && !parseYaml(rg.files.find((f) => f.path === "deploy/docker-compose.yml").content).services.app.ports, "배치 compose: 포트 없음·스키마 통과");
const ro = await generateDeploy({ projectDir: ora });
const oc = parseYaml(ro.files.find((f) => f.path === "deploy/docker-compose.yml").content);
assert(!oc.services.db && ro.files.find((f) => f.path === "Dockerfile").content.includes("tomcat:11.0-jdk17-temurin") && ro.files.find((f) => f.path === "deploy/config/globals.properties").content.includes("@10.0.0.5:1521") && ro.notes.some((x) => x.includes("라이선스")), "Oracle: DB 컨테이너 없이 앱만·Tomcat 11·연결 정보 유지");
const rh = await generateDeploy({ projectDir: hsql });
assert(!parseYaml(rh.files.find((f) => f.path === "deploy/docker-compose.yml").content).services.db && !rh.files.some((f) => f.path.startsWith("deploy/config/")), "HSQL: DB·설정 사본 없음");
const ru = await generateDeploy({ projectDir: multi, dryRun: false });
assert(!ru.supported && ru.unsupported.id === "multi-module" && ru.files.length === 0 && !existsSync(path.join(multi, "Dockerfile")) && renderDeployMarkdown(ru).includes("지원하지 않는 구조"), "지원 안 함: 파일 없이 이유만");

// ── 입력 검증·쓰기 ───────────────────────────────────────
for (const [o, re] of [[{ jdk: "11" }, /17·21/], [{ imageRegistry: "evil.io/x; rm -rf /" }, /imageRegistry 형식/], [{ ingressHost: "a b" }, /ingressHost/], [{ image: "UPPER:1" }, /image 형식/], [{ appName: "Bad_Name" }, /appName/], [{ dockerfilePath: "../Dockerfile" }, /dockerfilePath/]]) {
  let msg = ""; try { await generateDeploy({ projectDir: boot, ...o }); } catch (e) { msg = e.message; }
  assert(re.test(msg), `입력 거부: ${JSON.stringify(o)}`);
}
const w = await generateDeploy({ projectDir: boot, dryRun: false });
assert(w.written && !w.dryRun && w.files.every((f) => !f.content && existsSync(path.join(boot, f.path))) && readFileSync(path.join(boot, "Dockerfile"), "utf8").includes(SERVER_VERSION), "dryRun=false: 파일 기록(응답엔 내용 없음)");
let again = ""; try { await generateDeploy({ projectDir: boot, dryRun: false }); } catch (e) { again = e.message; }
assert(/이미 있는 파일은 덮어쓰지 않습니다: Dockerfile/.test(again), "기존 파일 거부");
const alt = await generateDeploy({ projectDir: boot, dryRun: false, dockerfilePath: "deploy/Dockerfile", targets: ["docker"] });
assert(alt.files.map((f) => f.path).join() === "deploy/Dockerfile,deploy/Dockerfile.dockerignore" && existsSync(path.join(boot, "deploy/Dockerfile.dockerignore")) && alt.usage[0].includes("-f deploy/Dockerfile .") && alt.notes.some((x) => x.includes("이미 배포 구성")), "dockerfilePath: 다른 경로·<경로>.dockerignore(BuildKit)·기존 구성 안내");
const partial = mk("partial", { "pom.xml": `<project><artifactId>p</artifactId><version>1</version><packaging>war</packaging></project>`, "deploy/docker-compose.yml": "x" });
let pm = ""; try { await generateDeploy({ projectDir: partial, dryRun: false }); } catch (e) { pm = e.message; }
assert(/deploy\/docker-compose\.yml/.test(pm) && !existsSync(path.join(partial, "Dockerfile")), "일부라도 이미 있으면 아무것도 쓰지 않음(transaction)");

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`deploy FAIL (${n} assertions)`); else console.log(`deploy OK (${n} assertions)`);
