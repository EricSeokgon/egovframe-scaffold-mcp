// 컨테이너·배포 산출물 (generate_egovframe_deploy, v0.45) — 진단 결과(빌드 도구·패키징·DbType·설정 파일)로
//   Dockerfile(멀티 스테이지 또는 미리 빌드한 산출물)·.dockerignore·docker-compose(DbType 별 DB)·Kubernetes 매니페스트를 만든다.
//   규칙(기반 이미지·DB 서비스·지원하지 않는 구조)은 catalog/deploy-rules.json 데이터. 새 파일만 쓰고(기존 파일 거부) dryRun 이 기본.
//   설정 주입: Boot 는 Spring Environment 의 환경 변수 매핑(Globals.mysql.Url → GLOBALS_MYSQL_URL), Classic 은 WAR 를 풀어 배포하고
//   DB 설정 파일(globals.properties)을 볼륨(compose)·Secret(Kubernetes)으로 덮어쓴다.
import * as fs from "node:fs";
import * as path from "node:path";
import { withFileTransaction } from "./file-transaction.js";
import { SERVER_VERSION } from "./version.js";
import { detectWorkspace, flattenYaml, isMultiModule } from "./workspace.js";
import { planWorkspaceDeploy, workspaceDeployFiles } from "./deploy-workspace.js";
import { L, tr, isEn } from "./lang.js";

export type DeployTarget = "docker" | "compose" | "k8s";
export interface DeployRules {
  schemaVersion: number; surveyedAt: string; jdks: string[];
  images: { maven: string; jdk: string; tomcat: string; tomcat11: string; jre: string };
  runtime: Record<"tomcat" | "boot", { port: number; webapps?: string; note: string }>;
  user: { uid: number; name: string }; timezone: string;
  databases: Record<string, { image: string; port: number; rootUser: string; env: { rootPassword: string; database: string; user: string; password: string }; command: string[]; healthcheck: string; data: string; initdb: string }>;
  dbAliases: Record<string, string>;
  externalDatabases: Record<string, string>;
  externalDatabases_en?: Record<string, string>;
  unsupported: { id: string; reason: string; reason_en?: string }[];
  /** v0.47: 멀티 모듈 작업공간이 localhost 로 참조하는 메시지 브로커·캐시 */
  infra?: Record<string, { image: string; port: number; healthcheck: string; user?: string; env?: { user: string; password: string }; note: string }>;
  /** v1.10: verify_egovframe_startup 이 Classic war 를 띄우는 Tomcat(버전·sha256·내려받을 곳) */
  startup?: { note: string; tomcat: Record<"10.1" | "11.0", { version: string; sha256: string; maven: string; archive: string }> };
}
const RULES_URL = new URL("../catalog/deploy-rules.json", import.meta.url);
let cached: DeployRules | null = null;
export function loadDeployRules(): DeployRules {
  if (!cached) cached = JSON.parse(fs.readFileSync(RULES_URL, "utf8")) as DeployRules;
  return cached;
}

export interface DeployDb {
  type: string;
  /** env: Boot Environment 환경 변수 / file: 설정 파일 덮어쓰기(Classic) / none: 내장 DB 등 덮어쓸 것 없음 */
  inject: "env" | "file" | "none";
  /** 설정 파일(프로젝트 상대) */
  file: string;
  /** 설정 키 */
  keys: { dbType?: string; driver?: string; url?: string; user?: string; password?: string };
  url: string | null; user: string | null;
  host: string | null; port: number | null; database: string | null;
  /** compose 에 DB 컨테이너를 띄우는지(external 이면 연결 정보만) */
  service: "container" | "external";
  serviceNote?: string;
  initScripts: string[];
}
export interface DeployProfile {
  appName: string; version: string;
  buildTool: "maven" | "gradle"; wrapper: boolean;
  packaging: "war" | "jar"; runtime: "tomcat" | "boot"; web: boolean; actuator: boolean;
  /** Classic: Servlet 6.1 이상을 직접 선언하면 Tomcat 11 */
  tomcat: "10.1" | "11.0";
  port: number; contextPath: string;
  liveness: string; readiness: string;
  db: DeployDb | null;
}
export interface DeployAnalysis { profile: DeployProfile | null; unsupported: { id: string; reason: string } | null; notes: string[] }

const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const stripXmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "egov-app";
/** .properties 를 키→{값, 줄} 로(주석·빈 줄 무시, 마지막 값 우선) */
export function parseProperties(text: string): Map<string, { value: string; line: number }> {
  const out = new Map<string, { value: string; line: number }>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith("#") || l.startsWith("!")) return;
    const m = l.match(/^([^=:\s]+)\s*[=:]\s*(.*)$/) ?? l.match(/^(\S+)\s+(.*)$/);
    if (m) out.set(m[1], { value: m[2].trim(), line: i + 1 });
  });
  return out;
}
/** jdbc URL 에서 호스트·포트·DB 이름(log4jdbc 접두어 포함). */
export function parseJdbcUrl(url: string): { host: string; port: number | null; database: string | null } | null {
  const m = url.match(/^jdbc:(?:log4jdbc:)?(\w+):\/\/([^/:?;]+)(?::(\d+))?(?:\/([^?;]*))?/);
  if (!m) return null;
  return { host: m[2], port: m[3] ? Number(m[3]) : null, database: m[4] ? m[4] : null };
}
const replaceJdbcHost = (url: string, host: string) => url.replace(/^(jdbc:(?:log4jdbc:)?\w+:\/\/)[^/:?;]+/, `$1${host}`);
/** Spring Environment 가 시스템 환경 변수에서 찾는 이름(Globals.mysql.Url → GLOBALS_MYSQL_URL) */
export const envNameOf = (key: string) => key.replace(/[.-]/g, "_").toUpperCase();

function walkFiles(root: string, rel: string, out: string[], depth: number): void {
  if (depth > 8 || out.length > 5000) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!/^(\.|node_modules$|target$|build$|migration-backup$)/.test(e.name)) walkFiles(root, r, out, depth + 1); }
    else if (e.isFile()) out.push(r);
  }
}

/** 프로젝트를 읽어 배포 프로필을 만든다(읽기 전용). */
export function analyzeDeploy(projectDir: string): DeployAnalysis {
  const rules = loadDeployRules();
  const notes: string[] = [];
  const un = (id: string) => { const u = rules.unsupported.find((x) => x.id === id)!; return { profile: null, unsupported: { id: u.id, reason: tr(u, "reason") }, notes }; };
  const pomPath = path.join(projectDir, "pom.xml");
  const gradlePath = ["build.gradle", "build.gradle.kts"].map((f) => path.join(projectDir, f)).find((p) => fs.existsSync(p));
  const isMaven = fs.existsSync(pomPath);
  if (!isMaven && !gradlePath) return un("no-build-file");
  let servlet: string | null = null;
  let packaging: "war" | "jar"; let boot: boolean; let web: boolean; let actuator: boolean; let artifactId: string; let version: string; let wrapper: boolean;
  if (isMaven) {
    const pom = stripXmlComments(read(pomPath));
    if (/<modules>\s*<module>/.test(pom)) return un("multi-module");
    const self = pom.replace(/<parent>[\s\S]*?<\/parent>/, "").replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/, "").replace(/<dependencies>[\s\S]*?<\/dependencies>/, "").replace(/<build>[\s\S]*?<\/build>/, "").replace(/<profiles>[\s\S]*?<\/profiles>/, "");
    packaging = /<packaging>\s*war\s*<\/packaging>/.test(self) ? "war" : "jar";
    const parentArt = pom.match(/<parent>[\s\S]*?<artifactId>\s*([^<\s]+)\s*<\/artifactId>[\s\S]*?<\/parent>/)?.[1] ?? "";
    boot = /spring-boot-starter-parent|egovframe-boot-starter-parent/.test(parentArt) || /spring-boot-maven-plugin/.test(pom);
    // Spring Cloud 서버(config-server·eureka-server·gateway)도 웹 서버를 띄운다(v0.47)
    web = packaging === "war" || /<artifactId>\s*(spring-boot-starter-(web|webflux|thymeleaf)|spring-cloud-config-server|spring-cloud-starter-netflix-eureka-server|spring-cloud-starter-gateway[\w-]*)\s*<\/artifactId>/.test(pom);
    actuator = /<artifactId>\s*spring-boot-starter-actuator\s*<\/artifactId>/.test(pom);
    artifactId = self.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1] ?? path.basename(projectDir);
    version = self.match(/<version>\s*([^<\s$]+)\s*<\/version>/)?.[1] ?? "1.0.0";
    wrapper = fs.existsSync(path.join(projectDir, "mvnw"));
    servlet = pom.match(/<artifactId>\s*jakarta\.servlet-api\s*<\/artifactId>\s*<version>\s*([\d.]+)/)?.[1] ?? null;
  } else {
    const g = read(gradlePath!);
    const settings = read(path.join(projectDir, "settings.gradle")) + read(path.join(projectDir, "settings.gradle.kts"));
    if (/^\s*include\s*[\s(]/m.test(settings)) return un("multi-module");
    boot = /org\.springframework\.boot/.test(g);
    packaging = /id\s*\(?\s*['"]war['"]|apply\s+plugin\s*:\s*['"]war['"]|\bwar\s*\{/.test(g) ? "war" : "jar";
    web = packaging === "war" || /spring-boot-starter-(web|webflux|thymeleaf)|spring-cloud-config-server|spring-cloud-starter-netflix-eureka-server|spring-cloud-starter-gateway/.test(g);
    actuator = /spring-boot-starter-actuator/.test(g);
    artifactId = settings.match(/rootProject\.name\s*=\s*["']([^"']+)["']/)?.[1] ?? path.basename(projectDir);
    version = g.match(/^\s*version\s*=?\s*["']([^"']+)["']/m)?.[1] ?? "1.0.0";
    wrapper = fs.existsSync(path.join(projectDir, "gradlew"));
    servlet = g.match(/jakarta\.servlet:jakarta\.servlet-api:([\d.]+)/)?.[1] ?? null;
  }
  const tomcat: "10.1" | "11.0" = servlet && /^(6\.[1-9]|[7-9]\.)/.test(servlet) ? "11.0" : "10.1";
  if (packaging === "jar" && !boot) return un("not-runnable");
  const runtime: "tomcat" | "boot" = packaging === "war" ? "tomcat" : "boot";
  if (packaging === "war" && boot) notes.push(L("Spring Boot 의 war 패키징 — 외부 Tomcat 에 배포하는 구성으로 만듭니다(SpringBootServletInitializer 가 있어야 함).", "Spring Boot with war packaging — generated for deployment to an external Tomcat (SpringBootServletInitializer is required)."));

  // 설정: Boot application.properties·yml / Classic globals.properties
  const files: string[] = [];
  walkFiles(projectDir, "src/main/resources", files, 0);
  const appProps = files.find((f) => /(^|\/)application\.properties$/.test(f) && f.split("/").length === 4);
  // v0.47: application.yml 도 읽는다(같은 키는 properties 가 이김)
  const appYml = files.find((f) => /(^|\/)application\.ya?ml$/.test(f) && f.split("/").length === 4);
  const props = new Map([...(appYml ? flattenYaml(read(path.join(projectDir, appYml))) : new Map()), ...(appProps ? parseProperties(read(path.join(projectDir, appProps))) : new Map())]);
  const appConfig = appProps ?? appYml;
  let port = rules.runtime[runtime].port;
  let contextPath = "";
  if (runtime === "boot") {
    const p = props.get("server.port")?.value;
    if (p && /^\d+$/.test(p) && p !== "0") port = Number(p);
    if (p === "0") notes.push(L("server.port=0(임의 포트) — 컨테이너에서는 SERVER_PORT 로 고정 포트(8080)를 줍니다.", "server.port=0 (random port) — the container pins a fixed port (8080) via SERVER_PORT."));
    const cp = props.get("server.servlet.context-path")?.value;
    if (cp && /^\/[\w\-/]*$/.test(cp)) contextPath = cp.replace(/\/+$/, "");
  }
  const actuatorProbes = runtime === "boot" && actuator && (props.get("management.endpoint.health.probes.enabled")?.value === "true");
  const liveness = `${contextPath}${actuatorProbes ? "/actuator/health/liveness" : actuator ? "/actuator/health" : "/"}`;
  const readiness = `${contextPath}${actuatorProbes ? "/actuator/health/readiness" : actuator ? "/actuator/health" : "/"}`;

  // DB
  let db: DeployDb | null = null;
  const dbSource = runtime === "boot" && props.has("Globals.DbType") ? { file: appConfig!, props }
    : (() => {
      const f = files.filter((x) => /globals\.properties$/i.test(x)).sort((a, b) => a.length - b.length)[0];
      return f ? { file: f, props: parseProperties(read(path.join(projectDir, f))) } : null;
    })();
  if (dbSource && dbSource.props.has("Globals.DbType")) {
    const rawType = dbSource.props.get("Globals.DbType")!.value.trim();
    // Boot 템플릿은 Globals.<DbType>.Url, Classic 템플릿은 Globals.Url 형식 — 앞의 것을 먼저 찾는다
    const pfx = (k: string) => [...dbSource.props.keys()].find((x) => x.toLowerCase() === `globals.${rawType.toLowerCase()}.${k}`) ?? [...dbSource.props.keys()].find((x) => x.toLowerCase() === `globals.${k}`);
    const keys = { dbType: "Globals.DbType", driver: pfx("driverclassname"), url: pfx("url"), user: pfx("username"), password: pfx("password") };
    const url = keys.url ? dbSource.props.get(keys.url)!.value : null;
    const parsed = url ? parseJdbcUrl(url) : null;
    const type = rules.dbAliases[rawType.toLowerCase()] ?? rawType.toLowerCase();
    const svc = rules.databases[type];
    db = {
      type, inject: type === "hsql" ? "none" : runtime === "boot" ? "env" : "file", file: dbSource.file, keys,
      url, user: keys.user ? dbSource.props.get(keys.user)!.value || null : null,
      host: parsed?.host ?? null, port: parsed?.port ?? null, database: parsed?.database ?? null,
      service: svc ? "container" : "external", ...(svc ? {} : { serviceNote: (isEn() ? rules.externalDatabases_en?.[type] : undefined) ?? rules.externalDatabases[type] ?? L("공개 이미지 규칙이 없는 DB — 연결 정보로만 연결", "DB without a public image rule — connected via connection settings only") }),
      initScripts: [],
    };
    if (svc) {
      const all: string[] = [];
      walkFiles(projectDir, "", all, 0);
      const sql = all.filter((f) => f.toLowerCase().endsWith(".sql") && new RegExp(`(^|[_\\-./])${type === "maria" ? "(maria|mariadb|mysql)" : type}([_\\-./]|$)`, "i").test(f.toLowerCase()));
      const pick = (kind: RegExp) => sql.filter((f) => kind.test(path.basename(f).toLowerCase())).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];
      const ddl = pick(/ddl/), data = pick(/data|dml/);
      db.initScripts = [ddl, data].filter((x): x is string => !!x);
      if (!db.initScripts.length) notes.push(L(`${type} 초기화 SQL(ddl·data)을 찾지 못해 빈 DB 로 띄웁니다.`, `No ${type} init SQL (ddl/data) found — the DB starts empty.`));
    }
    if (!url) notes.push(L(`${dbSource.file} 에 Globals.${rawType}.Url·Globals.Url 이 없어 DB 연결 정보를 덮어쓰지 않습니다.`, `${dbSource.file} has neither Globals.${rawType}.Url nor Globals.Url — DB connection settings are not overridden.`));
  } else if (props.has("spring.datasource.url")) {
    // ${datasource.url:jdbc:mysql://…} 처럼 자리표시자의 기본값이면 그 기본값으로 판정
    const url = props.get("spring.datasource.url")!.value.replace(/^\$\{[\w.\-]+:(.*)\}$/, "$1");
    const parsed = parseJdbcUrl(url);
    const type = parsed ? (rules.dbAliases[url.match(/^jdbc:(?:log4jdbc:)?(\w+):/)?.[1] ?? ""] ?? url.match(/^jdbc:(?:log4jdbc:)?(\w+):/)?.[1] ?? "unknown") : "unknown";
    db = { type, inject: "env", file: appConfig!, keys: { url: "spring.datasource.url", user: props.has("spring.datasource.username") ? "spring.datasource.username" : undefined, password: "spring.datasource.password", driver: props.has("spring.datasource.driver-class-name") ? "spring.datasource.driver-class-name" : undefined }, url, user: props.get("spring.datasource.username")?.value ?? null, host: parsed?.host ?? null, port: parsed?.port ?? null, database: parsed?.database ?? null, service: rules.databases[type] ? "container" : "external", initScripts: [] };
  }
  const appName = slug(artifactId);
  return { profile: { appName, version, buildTool: isMaven ? "maven" : "gradle", wrapper, packaging, runtime, web, actuator, tomcat, port, contextPath, liveness, readiness, db }, unsupported: null, notes };
}

// ── 렌더러 ───────────────────────────────────────────────
export interface DeployRenderOptions { jdk: string; imageRegistry: string; buildInImage: boolean; image: string; ingressHost?: string; /** 프로젝트 상대 Dockerfile 경로(기본 Dockerfile) */ dockerfile?: string;
  /** v0.47: 빌드 컨텍스트가 작업공간 루트이고 이 모듈만 빌드할 때(Maven -pl) 모듈 경로 */ moduleDir?: string }
const img = (tpl: string, jdk: string) => tpl.replace("{jdk}", jdk);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function renderDockerfile(p: DeployProfile, o: DeployRenderOptions): string {
  const r = loadDeployRules();
  const u = r.user;
  const javaOpts = `-Dfile.encoding=UTF-8 -Duser.timezone=${r.timezone} -XX:MaxRAMPercentage=75`;
  const out: string[] = [
    L(`# eGovFrame ${p.runtime === "tomcat" ? `Classic(war → Tomcat ${p.tomcat})` : "Boot(실행 jar)"} — egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_deploy`, `# eGovFrame ${p.runtime === "tomcat" ? `Classic(war → Tomcat ${p.tomcat})` : "Boot(executable jar)"} — egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_deploy`),
    L(`# 폐쇄망: docker build --build-arg BASE_REGISTRY=<사내 레지스트리>/library . (기반 이미지를 사내 레지스트리에서)`, `# Air-gapped: docker build --build-arg BASE_REGISTRY=<internal registry>/library . (pull base images from the internal registry)`),
    L(`# BuildKit(Docker 23 이상 기본)이 필요합니다(RUN --mount=type=cache). # syntax 지시어는 쓰지 않습니다 — 폐쇄망에서 docker/dockerfile 이미지를 받지 않도록`, `# Requires BuildKit (default since Docker 23) for RUN --mount=type=cache. No # syntax directive — so air-gapped builds do not pull the docker/dockerfile image`),
    `ARG BASE_REGISTRY=${o.imageRegistry}`,
  ];
  const art = p.packaging;
  const modPfx = o.moduleDir ? `${o.moduleDir}/` : "";
  const outDir = `${modPfx}${p.buildTool === "maven" ? "target" : "build/libs"}`;
  if (o.buildInImage) {
    const buildImage = p.buildTool === "maven" || !p.wrapper ? (p.buildTool === "maven" ? img(r.images.maven, o.jdk) : "gradle:8-jdk" + o.jdk) : img(r.images.jdk, o.jdk);
    const cache = p.buildTool === "maven" ? "/root/.m2" : "/root/.gradle";
    // 원격 저장소(maven.egovframe.go.kr 등)의 일시 5xx 를 재시도(Maven 3.9 기본은 429·503 만)
    const cmd = p.buildTool === "maven" ? `mvn -B -q -DskipTests -Daether.connector.http.retryHandler.serviceUnavailable=429,500,502,503,504 -Daether.connector.http.retryHandler.count=5${o.moduleDir ? ` -pl ${o.moduleDir} -am` : ""} package` : p.wrapper ? "chmod +x ./gradlew && ./gradlew --no-daemon -q -x test build" : "gradle --no-daemon -q -x test build";
    out.push(``, `FROM \${BASE_REGISTRY}/${buildImage} AS build`, "WORKDIR /workspace", "COPY . .",
      `RUN --mount=type=cache,target=${cache} ${cmd} \\`,
      `    && find ${outDir} -maxdepth 1 -name '*.${art}' ! -name '*-plain.${art}' -exec cp {} /workspace/app.${art} \\;`);
  } else {
    out.push(``, L(`# 미리 빌드한 산출물(${outDir}/*.${art})을 씁니다 — 먼저 ${p.buildTool === "maven" ? "mvn -B -DskipTests package" : "./gradlew build -x test"}`, `# Uses the pre-built artifact (${outDir}/*.${art}) — run ${p.buildTool === "maven" ? "mvn -B -DskipTests package" : "./gradlew build -x test"} first`),
      `FROM \${BASE_REGISTRY}/${img(r.images.jdk, o.jdk)} AS build`, "WORKDIR /workspace", `COPY ${outDir}/ /workspace/${outDir}/`,
      `RUN find ${outDir} -maxdepth 1 -name '*.${art}' ! -name '*-plain.${art}' -exec cp {} /workspace/app.${art} \\;`);
  }
  if (p.runtime === "tomcat") {
    // WAR 를 이미지 안에서 풀어 둔다 — 설정 파일(globals.properties)을 볼륨·Secret 으로 덮어쓸 수 있게
    out.push("WORKDIR /workspace/ROOT", "RUN jar xf /workspace/app.war && test -d WEB-INF");
    out.push(``, `FROM \${BASE_REGISTRY}/${img(p.tomcat === "11.0" ? r.images.tomcat11 : r.images.tomcat, o.jdk)}`,
      `ENV TZ=${r.timezone} LANG=C.UTF-8 JAVA_OPTS="${javaOpts}"`,
      `RUN groupadd -r -g ${u.uid} ${u.name} && useradd -r -u ${u.uid} -g ${u.name} -d /usr/local/tomcat ${u.name} \\`,
      `    && rm -rf /usr/local/tomcat/webapps/* \\`,
      `    && chown -R ${u.name}:${u.name} /usr/local/tomcat/logs /usr/local/tomcat/temp /usr/local/tomcat/work /usr/local/tomcat/webapps`,
      `COPY --from=build --chown=${u.name}:${u.name} /workspace/ROOT /usr/local/tomcat/webapps/ROOT`,
      `USER ${u.uid}`, `EXPOSE ${p.port}`,
      `HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD curl -fsS -o /dev/null http://127.0.0.1:${p.port}${p.liveness} || exit 1`);
  } else {
    out.push(``, `FROM \${BASE_REGISTRY}/${img(r.images.jre, o.jdk)}`,
      `ENV TZ=${r.timezone} LANG=C.UTF-8 JAVA_OPTS="${javaOpts}"`,
      `RUN groupadd -r -g ${u.uid} ${u.name} && useradd -r -u ${u.uid} -g ${u.name} -d /app ${u.name} \\`,
      `    && mkdir -p /app && chown ${u.name}:${u.name} /app`,
      "WORKDIR /app",
      `COPY --from=build --chown=${u.name}:${u.name} /workspace/app.jar /app/app.jar`,
      `USER ${u.uid}`);
    if (p.web) out.push(`EXPOSE ${p.port}`, `HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD curl -fsS -o /dev/null http://127.0.0.1:${p.port}${p.liveness} || exit 1`);
    out.push(`ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]`);
  }
  return out.join("\n") + "\n";
}

export function renderDockerignore(p: DeployProfile, o: DeployRenderOptions): string {
  if (!o.buildInImage) {
    const outDir = `${o.moduleDir ? `${o.moduleDir}/` : ""}${p.buildTool === "maven" ? "target" : "build/libs"}`;
    return [L("# 미리 빌드한 산출물만 보냄", "# Send only the pre-built artifact"), "*", `!${outDir}/`, `!${outDir}/*.${p.packaging}`, ""].join("\n");
  }
  return [".git", ".gitignore", ".idea", ".vscode", ".settings", ".project", ".classpath", "*.iml", "target", "build", ".gradle", "node_modules", "deploy", "migration-backup", ".egov*", "*.log", "logs", "Dockerfile", ".dockerignore", ""].join("\n");
}

interface DbEnv { name: string; key: string; value: string; secret: boolean }
/** 앱 쪽 DB 설정 덮어쓰기 목록(Boot env). host 는 compose 서비스 이름 또는 Kubernetes 자리표시자. */
function dbEnvFor(p: DeployProfile, host: string): DbEnv[] {
  const db = p.db;
  if (!db || db.inject !== "env") return [];
  const out: DbEnv[] = [];
  if (db.keys.dbType) out.push({ name: envNameOf(db.keys.dbType), key: db.keys.dbType, value: db.type === "maria" ? "maria" : db.type, secret: false });
  if (db.keys.url && db.url) out.push({ name: envNameOf(db.keys.url), key: db.keys.url, value: replaceJdbcHost(db.url, host), secret: false });
  if (db.keys.user) out.push({ name: envNameOf(db.keys.user), key: db.keys.user, value: db.user ?? loadDeployRules().databases[db.type]?.rootUser ?? "app", secret: false });
  if (db.keys.password) out.push({ name: envNameOf(db.keys.password), key: db.keys.password, value: "CHANGE_ME", secret: true });
  return out.filter((e) => e.value !== undefined);
}
/** Classic: DB 키만 바꾼 설정 파일 사본. */
export function renderClassicConfig(projectDir: string, p: DeployProfile, host: string): string | null {
  const db = p.db;
  if (!db || db.inject !== "file") return null;
  const text = read(path.join(projectDir, db.file));
  const lines = text.split(/\r?\n/);
  const props = parseProperties(text);
  const set = (key: string | undefined, value: string) => { if (!key) return; const e = props.get(key); if (e) lines[e.line - 1] = `${key} = ${value}`; };
  if (db.url) set(db.keys.url, replaceJdbcHost(db.url, host));
  set(db.keys.password, "CHANGE_ME");
  return [L(`# egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_deploy — ${db.file} 사본(DB 호스트·비밀번호만 바꿈). 운영 값은 저장소에 두지 마세요.`, `# egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_deploy — copy of ${db.file} (only DB host and password changed). Do not commit production values.`), ...lines].join("\n");
}
/** WAR 를 풀어 둔 위치에서 설정 파일 경로 */
const classicTarget = (p: DeployProfile) => `${loadDeployRules().runtime.tomcat.webapps}/ROOT/WEB-INF/classes/${p.db!.file.replace(/^src\/main\/resources\//, "")}`;

export function renderCompose(p: DeployProfile, o: DeployRenderOptions): string {
  const r = loadDeployRules();
  const db = p.db;
  const svc = db && db.service === "container" && db.inject !== "none" ? r.databases[db.type] : null;
  const out: string[] = [
    L(`# eGovFrame 로컬 실행 — egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_deploy`, `# eGovFrame local run — egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_deploy`),
    L(`# 사용: cd deploy && cp .env.example .env && docker compose up --build`, `# Usage: cd deploy && cp .env.example .env && docker compose up --build`),
    `name: ${p.appName}`,
    "services:",
    "  app:",
    "    build:",
    "      context: ..",
    `      dockerfile: ${o.dockerfile ?? "Dockerfile"}`,
    "      args:",
    `        BASE_REGISTRY: \${BASE_REGISTRY:-${o.imageRegistry}}`,
    `    image: ${o.image}`,
  ];
  if (p.web) out.push("    ports:", `      - "\${APP_PORT:-${p.port}}:${p.port}"`);
  const env = dbEnvFor(p, svc ? "db" : (db?.host ?? "db"));
  if (env.length) {
    out.push("    environment:");
    for (const e of env) out.push(`      ${e.name}: ${e.secret ? '"${DB_PASSWORD:-CHANGE_ME}"' : q(e.value)}`);
  }
  if (db?.inject === "file") out.push("    volumes:", `      - ./config/${path.posix.basename(db.file)}:${classicTarget(p)}:ro`);
  if (svc) out.push("    depends_on:", "      db:", "        condition: service_healthy");
  out.push("    restart: unless-stopped");
  if (svc && db) {
    const rootUser = svc.rootUser;
    const user = db.user ?? rootUser;
    out.push("  db:", `    image: \${BASE_REGISTRY:-${o.imageRegistry}}/${svc.image}`, "    environment:");
    if (db.type === "postgres") {
      out.push(`      ${svc.env.user}: ${q(user)}`, `      ${svc.env.password}: "\${DB_PASSWORD:-CHANGE_ME}"`);
    } else {
      out.push(`      ${svc.env.rootPassword}: "\${DB_PASSWORD:-CHANGE_ME}"`);
      if (user !== rootUser) out.push(`      ${svc.env.user}: ${q(user)}`, `      ${svc.env.password}: "\${DB_PASSWORD:-CHANGE_ME}"`);
    }
    if (db.database) out.push(`      ${svc.env.database}: ${q(db.database)}`);
    out.push("      TZ: Asia/Seoul");
    if (svc.command.length) out.push("    command:", ...svc.command.map((c) => `      - ${q(c)}`));
    out.push("    volumes:", `      - db-data:${svc.data}`);
    db.initScripts.forEach((s, i) => out.push(`      - ../${s}:${svc.initdb}/${String(i + 1).padStart(2, "0")}-${path.posix.basename(s)}:ro`));
    out.push("    healthcheck:", `      test: ["CMD-SHELL", ${JSON.stringify(svc.healthcheck)}]`, "      interval: 10s", "      timeout: 5s", "      retries: 30", "      start_period: 30s");
    out.push("    restart: unless-stopped", "volumes:", "  db-data: {}");
  }
  return out.join("\n") + "\n";
}

export function renderEnvExample(p: DeployProfile, o: DeployRenderOptions): string {
  return [
    L("# docker compose 변수 — .env 로 복사해 값을 바꾸세요(.env 는 저장소에 넣지 않음)", "# docker compose variables — copy to .env and change the values (do not commit .env)"),
    `BASE_REGISTRY=${o.imageRegistry}`,
    ...(p.web ? [`APP_PORT=${p.port}`] : []),
    ...(p.db && p.db.inject !== "none" ? ["DB_PASSWORD=CHANGE_ME"] : []),
    "",
  ].join("\n");
}

export interface K8sExtra { env?: { name: string; value: string; secret: boolean }[]; configMapMount?: { name: string; mountPath: string } }
export function renderKubernetes(projectDir: string, p: DeployProfile, o: DeployRenderOptions, extra: K8sExtra = {}): string {
  const r = loadDeployRules();
  const u = r.user;
  const name = p.appName;
  const labels = [`app.kubernetes.io/name: ${name}`, `app.kubernetes.io/version: ${q(p.version)}`, "app.kubernetes.io/managed-by: egovframe-scaffold-mcp"];
  const docs: string[][] = [];
  // 같은 이름은 뒤(extra — 작업공간의 localhost 참조 치환)가 이긴다
  const env = [...new Map([...dbEnvFor(p, "CHANGE_ME_DB_HOST"), ...(extra.env ?? []).map((e) => ({ ...e, key: e.name }))].map((e) => [e.name, e] as const)).values()];
  const plain = env.filter((e) => !e.secret);
  const secret = env.filter((e) => e.secret);
  docs.push(["apiVersion: v1", "kind: ConfigMap", "metadata:", `  name: ${name}-config`, "  labels:", ...labels.map((l) => `    ${l}`), "data:", `  TZ: ${q(r.timezone)}`, `  JAVA_OPTS: ${q(`-Dfile.encoding=UTF-8 -Duser.timezone=${r.timezone} -XX:MaxRAMPercentage=75`)}`, ...plain.map((e) => `  ${e.name}: ${q(e.value)}`)]);
  const classic = p.db?.inject === "file" ? renderClassicConfig(projectDir, p, "CHANGE_ME_DB_HOST") : null;
  if (secret.length || classic) {
    const S = ["apiVersion: v1", "kind: Secret", "metadata:", `  name: ${name}-secret`, "  labels:", ...labels.map((l) => `    ${l}`), "type: Opaque", "stringData:"];
    for (const e of secret) S.push(`  ${e.name}: ${q(e.value)}`);
    if (classic) { S.push(`  ${path.posix.basename(p.db!.file)}: |`); for (const l of classic.split("\n")) S.push(l ? `    ${l}` : ""); }
    docs.push(S);
  }
  const probe = (kind: string, pathStr: string, delay: number) => [`        ${kind}:`, "          httpGet:", `            path: ${pathStr}`, "            port: http", `          initialDelaySeconds: ${delay}`, "          periodSeconds: 10", "          timeoutSeconds: 5", "          failureThreshold: 6"];
  const D = ["apiVersion: apps/v1", "kind: Deployment", "metadata:", `  name: ${name}`, "  labels:", ...labels.map((l) => `    ${l}`), "spec:", "  replicas: 1", "  selector:", "    matchLabels:", `      app.kubernetes.io/name: ${name}`, "  template:", "    metadata:", "      labels:", ...labels.map((l) => `        ${l}`), "    spec:",
    "      securityContext:", "        runAsNonRoot: true", `        runAsUser: ${u.uid}`, `        runAsGroup: ${u.uid}`, `        fsGroup: ${u.uid}`, "        seccompProfile:", "          type: RuntimeDefault",
    "      containers:", `      - name: ${name}`, `        image: ${o.image}`, "        imagePullPolicy: IfNotPresent"];
  if (p.web) D.push("        ports:", "        - name: http", `          containerPort: ${p.port}`);
  D.push("        envFrom:", "        - configMapRef:", `            name: ${name}-config`);
  if (secret.length) D.push("        - secretRef:", `            name: ${name}-secret`);
  if (p.web) D.push(...probe("startupProbe", p.liveness, 10).map((l) => l.replace("failureThreshold: 6", "failureThreshold: 30")), ...probe("readinessProbe", p.readiness, 0), ...probe("livenessProbe", p.liveness, 0));
  D.push("        resources:", "          requests:", "            cpu: 250m", "            memory: 768Mi", "          limits:", "            cpu: '1'", "            memory: 1536Mi",
    "        securityContext:", "          allowPrivilegeEscalation: false", "          capabilities:", "            drop:", "            - ALL");
  if (extra.configMapMount) {
    D.push("        volumeMounts:", "        - name: config-repo", `          mountPath: ${extra.configMapMount.mountPath}`, "          readOnly: true",
      "      volumes:", "      - name: config-repo", "        configMap:", `          name: ${extra.configMapMount.name}`);
  }
  if (classic) {
    D.push("        volumeMounts:", "        - name: db-config", `          mountPath: ${classicTarget(p)}`, `          subPath: ${path.posix.basename(p.db!.file)}`, "          readOnly: true",
      "      volumes:", "      - name: db-config", "        secret:", `          secretName: ${name}-secret`, "          items:", `          - key: ${path.posix.basename(p.db!.file)}`, `            path: ${path.posix.basename(p.db!.file)}`);
  }
  docs.push(D);
  if (p.web) {
    docs.push(["apiVersion: v1", "kind: Service", "metadata:", `  name: ${name}`, "  labels:", ...labels.map((l) => `    ${l}`), "spec:", "  type: ClusterIP", "  selector:", `    app.kubernetes.io/name: ${name}`, "  ports:", "  - name: http", "    port: 80", "    targetPort: http"]);
    if (o.ingressHost) docs.push(["apiVersion: networking.k8s.io/v1", "kind: Ingress", "metadata:", `  name: ${name}`, "  labels:", ...labels.map((l) => `    ${l}`), "spec:", "  rules:", `  - host: ${o.ingressHost}`, "    http:", "      paths:", `      - path: ${p.contextPath || "/"}`, "        pathType: Prefix", "        backend:", "          service:", `            name: ${name}`, "            port:", "              name: http"]);
  }
  return [L(`# eGovFrame Kubernetes 매니페스트 — egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_deploy`, `# eGovFrame Kubernetes manifest — egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_deploy`), L(`# 적용 전: 이미지(${o.image})를 레지스트리에 올리고 CHANGE_ME 값(DB 호스트·비밀번호)을 바꾸세요. kubectl apply -f deploy/k8s/`, `# Before applying: push the image (${o.image}) to a registry and replace the CHANGE_ME values (DB host and password). kubectl apply -f deploy/k8s/`), ...docs.map((d) => `---\n${d.join("\n")}`)].join("\n") + "\n";
}

// ── 도구 ─────────────────────────────────────────────────
export interface GenerateDeployOptions {
  projectDir: string;
  targets?: DeployTarget[];
  jdk?: string;
  /** 기반 이미지 레지스트리(기본 docker.io/library) — 폐쇄망 사내 레지스트리·프록시 캐시 */
  imageRegistry?: string;
  /** 앱 이미지 이름(기본 <appName>:<version>) */
  image?: string;
  appName?: string;
  /** false 면 미리 빌드한 산출물(target/*.war·jar)을 이미지에 담는 Dockerfile */
  buildInImage?: boolean;
  /** Dockerfile 경로(프로젝트 상대, 기본 Dockerfile). 루트가 아니면 .dockerignore 는 <경로>.dockerignore(BuildKit) */
  dockerfilePath?: string;
  ingressHost?: string;
  dryRun?: boolean;
  /** v0.47: 멀티 모듈 작업공간에서 일부 서비스만(모듈 이름·경로·서비스 이름). 그 서비스가 먼저 띄워야 하는 서비스·인프라는 함께 들어간다 */
  modules?: string[];
}
export interface GenerateDeployResult {
  projectDir: string;
  supported: boolean;
  unsupported?: { id: string; reason: string };
  profile?: DeployProfile;
  dryRun: boolean;
  written: boolean;
  files: { path: string; target: DeployTarget; bytes: number; content?: string }[];
  usage: string[];
  notes: string[];
  /** v0.47: 멀티 모듈 작업공간이면 서비스·인프라 */
  workspace?: {
    kind: string; appName: string;
    services: { name: string; module: string; runtime: string; port: number; web: boolean; ownDockerfile: boolean; image: string; env: string[]; dependsOn: string[]; configRepo?: string }[];
    infra: { name: string; image: string }[];
    skipped: { module: string; reason: string }[];
    unresolved: { service: string; key: string; value: string }[];
  };
}

export const DEPLOY_IMAGE_REGISTRY_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?(\/[a-z0-9._-]+)*$/;
export const DEPLOY_IMAGE_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?(\/[a-z0-9._-]+)*(:[\w.-]{1,128})?$/;
export const DEPLOY_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export async function generateDeploy(opts: GenerateDeployOptions): Promise<GenerateDeployResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const rules = loadDeployRules();
  const jdk = opts.jdk ?? "17";
  if (!rules.jdks.includes(jdk)) throw new Error(L(`jdk 는 ${rules.jdks.join("·")} 중 하나여야 합니다(5.x 는 Java 17 이상): ${jdk}`, `jdk must be one of ${rules.jdks.join("·")} (5.x requires Java 17 or later): ${jdk}`));
  const imageRegistry = (opts.imageRegistry ?? "docker.io/library").replace(/\/+$/, "");
  if (!DEPLOY_IMAGE_REGISTRY_RE.test(imageRegistry)) throw new Error(L(`imageRegistry 형식 오류(예: docker.io/library, harbor.example.go.kr/dockerhub): ${JSON.stringify(opts.imageRegistry)}`, `Invalid imageRegistry format (e.g. docker.io/library, harbor.example.go.kr/dockerhub): ${JSON.stringify(opts.imageRegistry)}`));
  if (opts.ingressHost !== undefined && !DEPLOY_HOST_RE.test(opts.ingressHost)) throw new Error(L(`ingressHost 는 도메인 이름이어야 합니다: ${JSON.stringify(opts.ingressHost)}`, `ingressHost must be a domain name: ${JSON.stringify(opts.ingressHost)}`));
  const targets = [...new Set(opts.targets?.length ? opts.targets : (["docker", "compose", "k8s"] as DeployTarget[]))];
  const dryRun = opts.dryRun !== false;
  // v0.47: 멀티 모듈·다중 프로젝트 작업공간
  const ws = detectWorkspace(projectDir);
  if (isMultiModule(ws) && ws.kind !== "single") {
    if (opts.appName && !/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/.test(opts.appName)) throw new Error(L(`appName 은 소문자·숫자·하이픈 50자 이하여야 합니다: ${opts.appName}`, `appName must be lowercase letters, digits and hyphens, at most 50 characters: ${opts.appName}`));
    const plan = planWorkspaceDeploy(projectDir, { appName: opts.appName });
    if (opts.modules?.length) {
      const want = new Set(opts.modules);
      const picked = plan.services.filter((x) => want.has(x.name) || want.has(x.module.name) || want.has(x.module.dir));
      const unknownMods = opts.modules.filter((mm) => !plan.services.some((x) => x.name === mm || x.module.name === mm || x.module.dir === mm));
      if (unknownMods.length) throw new Error(L(`작업공간에 없는 서비스·모듈: ${unknownMods.join(", ")} (있는 것: ${plan.services.map((x) => x.module.name).join(", ")})`, `Service/module not in the workspace: ${unknownMods.join(", ")} (available: ${plan.services.map((x) => x.module.name).join(", ")})`));
      const keep = new Set(picked.map((x) => x.name));
      for (let changed = true; changed;) { changed = false; for (const x of plan.services) if (keep.has(x.name)) for (const d of x.dependsOn) if (!keep.has(d) && plan.services.some((y) => y.name === d)) { keep.add(d); changed = true; } }
      plan.services = plan.services.filter((x) => keep.has(x.name));
      const usedInfra = new Set(plan.services.flatMap((x) => x.dependsOn));
      plan.infra = plan.infra.filter((i) => usedInfra.has(i.name));
      plan.notes.push(L(`modules: ${opts.modules.join(", ")} → 서비스 ${plan.services.length}개(먼저 뜰 서비스 포함)·인프라 ${plan.infra.map((i) => i.name).join("·") || "없음"}`, `modules: ${opts.modules.join(", ")} → ${plan.services.length} services (including those that must start first) · infra ${plan.infra.map((i) => i.name).join("·") || "none"}`));
    }
    if (!plan.services.length) return { projectDir, supported: false, unsupported: { id: "no-service", reason: L(`실행할 서비스 모듈이 없습니다(${plan.skipped.map((x) => `${x.module}: ${x.reason}`).join("; ")})`, `No runnable service module (${plan.skipped.map((x) => `${x.module}: ${x.reason}`).join("; ")})`) }, dryRun, written: false, files: [], usage: [], notes: plan.notes };
    const buildInImage = opts.buildInImage !== false;
    const { files, images } = workspaceDeployFiles(plan, { jdk, imageRegistry, buildInImage, targets });
    const notes = [...plan.notes];
    for (const x of plan.skipped) notes.push(L(`제외: ${x.module} — ${x.reason}`, `Skipped: ${x.module} — ${x.reason}`));
    const own = plan.services.filter((x) => x.ownDockerfile);
    if (own.length) notes.push(L(`자체 Dockerfile 이 있는 서비스 ${own.length}개(${own.map((x) => x.name).join(", ")})는 그대로 씁니다 — 그 Dockerfile 이 미리 빌드한 산출물을 복사하면 먼저 빌드하세요.`, `${own.length} services with their own Dockerfile (${own.map((x) => x.name).join(", ")}) are used as-is — if that Dockerfile copies a pre-built artifact, build first.`));
    if (!buildInImage) notes.push(L(`buildInImage=false — 이미지 빌드 전에 ${ws.kind === "maven-modules" ? "루트에서 mvn -B -DskipTests package" : "모듈마다 빌드"} 로 산출물을 만드세요.`, `buildInImage=false — build the artifacts before the image build (${ws.kind === "maven-modules" ? "mvn -B -DskipTests package at the root" : "build each module"}).`));
    const exists = files.filter((f) => fs.existsSync(path.join(projectDir, f.path))).map((f) => f.path);
    if (exists.length && !dryRun) throw new Error(L(`이미 있는 파일은 덮어쓰지 않습니다: ${exists.join(", ")}`, `Existing files are not overwritten: ${exists.join(", ")}`));
    if (exists.length) notes.push(L(`이미 있는 파일: ${exists.join(", ")} — dryRun=false 면 거부됩니다.`, `Existing files: ${exists.join(", ")} — refused with dryRun=false.`));
    if (!dryRun) await withFileTransaction(projectDir, L("다중 서비스 배포 산출물 생성", "multi-service deploy artifact generation"), (tx) => { for (const f of files) tx.writeFile(f.path, f.content, { mustNotExist: true }); });
    const usage = [
      ...(targets.includes("compose") ? ["cd deploy && cp .env.example .env && docker compose up --build"] : []),
      ...(targets.includes("k8s") ? [L("kubectl apply -f deploy/k8s/   # 이미지를 레지스트리에 올리고 CHANGE_ME(인프라 호스트·비밀번호)를 먼저 바꾼 뒤", "kubectl apply -f deploy/k8s/   # after pushing the images to a registry and replacing CHANGE_ME (infra hosts and passwords)")] : []),
    ];
    return {
      projectDir, supported: true, dryRun, written: !dryRun,
      files: files.map((f) => ({ path: f.path, target: f.target, bytes: Buffer.byteLength(f.content), ...(dryRun ? { content: f.content } : {}) })), usage, notes,
      workspace: {
        kind: ws.kind, appName: plan.appName,
        services: plan.services.map((x) => ({ name: x.name, module: x.module.dir, runtime: x.profile.runtime, port: x.profile.port, web: x.profile.web, ownDockerfile: !!x.ownDockerfile, image: images[x.name], env: x.env.map((e) => e.name), dependsOn: x.dependsOn, ...(x.configRepo ? { configRepo: x.configRepo.source } : {}) })),
        infra: plan.infra.map((i) => ({ name: i.name, image: i.image })), skipped: plan.skipped, unresolved: plan.unresolved,
      },
    };
  }
  const a = analyzeDeploy(projectDir);
  if (!a.profile) return { projectDir, supported: false, unsupported: a.unsupported!, dryRun, written: false, files: [], usage: [], notes: a.notes };
  const p = a.profile;
  if (opts.appName) { if (!/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/.test(opts.appName)) throw new Error(L(`appName 은 소문자·숫자·하이픈 50자 이하여야 합니다: ${opts.appName}`, `appName must be lowercase letters, digits and hyphens, at most 50 characters: ${opts.appName}`)); p.appName = opts.appName; }
  const image = opts.image ?? `${p.appName}:${p.version.toLowerCase().replace(/[^\w.-]/g, "-")}`;
  if (!DEPLOY_IMAGE_RE.test(image)) throw new Error(L(`image 형식 오류: ${image}`, `Invalid image format: ${image}`));
  const dockerfile = (opts.dockerfilePath ?? "Dockerfile").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!/^(?!\/)(?!.*(^|\/)\.\.(\/|$))[\w.\-/]+$/.test(dockerfile)) throw new Error(L(`dockerfilePath 는 프로젝트 안의 상대 경로여야 합니다: ${opts.dockerfilePath}`, `dockerfilePath must be a relative path inside the project: ${opts.dockerfilePath}`));
  const dockerignore = dockerfile === "Dockerfile" ? ".dockerignore" : `${dockerfile}.dockerignore`;
  const o: DeployRenderOptions = { jdk, imageRegistry, buildInImage: opts.buildInImage !== false, image, ingressHost: opts.ingressHost, dockerfile };
  const notes = [...a.notes];
  const files: { path: string; target: DeployTarget; content: string }[] = [];
  if (targets.includes("docker") || targets.includes("compose")) {
    files.push({ path: dockerfile, target: "docker", content: renderDockerfile(p, o) }, { path: dockerignore, target: "docker", content: renderDockerignore(p, o) });
  }
  if (targets.includes("compose")) {
    files.push({ path: "deploy/docker-compose.yml", target: "compose", content: renderCompose(p, o) }, { path: "deploy/.env.example", target: "compose", content: renderEnvExample(p, o) });
    const svcHost = p.db?.service === "container" ? "db" : (p.db?.host ?? "db");
    const cfg = renderClassicConfig(projectDir, p, svcHost);
    if (cfg) files.push({ path: `deploy/config/${path.posix.basename(p.db!.file)}`, target: "compose", content: cfg + "\n" });
  }
  if (targets.includes("k8s")) files.push({ path: `deploy/k8s/${p.appName}.yaml`, target: "k8s", content: renderKubernetes(projectDir, p, o) });

  if (p.db?.service === "external" && p.db.inject !== "none") notes.push(L(`DB(${p.db.type})는 ${p.db.serviceNote} — compose 는 앱만 띄우고 연결 정보(${p.db.url ? replaceJdbcHost(p.db.url, p.db.host ?? "") : "Url 없음"})를 그대로 씁니다.`, `DB (${p.db.type}): ${p.db.serviceNote} — compose starts only the app and keeps the connection settings (${p.db.url ? replaceJdbcHost(p.db.url, p.db.host ?? "") : "no Url"}) as they are.`));
  if (p.db?.inject === "env") notes.push(L(`DB 설정은 Spring 환경 변수로 덮어씁니다(${dbEnvFor(p, "db").map((e) => `${e.key} → ${e.name}`).join(", ")}).`, `DB settings are overridden through Spring environment variables (${dbEnvFor(p, "db").map((e) => `${e.key} → ${e.name}`).join(", ")}).`));
  if (p.db?.inject === "file") notes.push(L(`Classic 은 WAR 를 풀어 배포하고 ${p.db.file} 을 compose 는 볼륨(deploy/config/), Kubernetes 는 Secret 으로 덮어씁니다(${classicTarget(p)}).`, `Classic deploys the exploded WAR and overrides ${p.db.file} with a volume (deploy/config/) in compose and a Secret in Kubernetes (${classicTarget(p)}).`));
  if (!p.web) notes.push(L("웹 의존성이 없는 Boot 앱(배치 등) — 포트·헬스체크·Service 없이 만듭니다. 한 번 실행하고 끝나는 커맨드라인 배치는 Kubernetes Job·CronJob 으로 바꾸세요.", "Boot app without web dependencies (batch etc.) — generated without port, health check or Service. For a run-once command-line batch, switch to a Kubernetes Job/CronJob."));
  if (p.web && p.liveness === `${p.contextPath}/`) notes.push(L(`헬스체크는 ${p.contextPath || "/"} 의 HTTP 응답으로 봅니다${p.runtime === "boot" ? " — spring-boot-starter-actuator 와 management.endpoint.health.probes.enabled=true 가 있으면 /actuator/health/liveness·readiness 를 씁니다" : ""}.`, `The health check uses the HTTP response of ${p.contextPath || "/"}${p.runtime === "boot" ? " — with spring-boot-starter-actuator and management.endpoint.health.probes.enabled=true, /actuator/health/liveness and readiness are used instead" : ""}.`));
  if (!o.buildInImage) notes.push(L(`buildInImage=false — 이미지 빌드 전에 ${p.buildTool === "maven" ? "mvn -B -DskipTests package" : "./gradlew build -x test"} 로 산출물을 만드세요(폐쇄망에서 컨테이너 안 Maven 접근이 어려울 때).`, `buildInImage=false — build the artifact with ${p.buildTool === "maven" ? "mvn -B -DskipTests package" : "./gradlew build -x test"} before the image build (for air-gapped networks where Maven cannot be reached from inside the container).`));

  // 템플릿이 이미 배포 구성을 갖고 있으면 알린다(공식 simple-backend 등)
  const upstream = ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "k8s", "kubernetes", "helm", "charts"].filter((f) => fs.existsSync(path.join(projectDir, f)));
  if (upstream.length) notes.push(L(`프로젝트에 이미 배포 구성(${upstream.join(", ")})이 있습니다 — 템플릿이 제공한 구성을 먼저 검토하세요. 함께 두려면 dockerfilePath(예: deploy/Dockerfile)로 겹치지 않게 만드세요.`, `The project already has a deploy configuration (${upstream.join(", ")}) — review the template-provided configuration first. To keep both, use dockerfilePath (e.g. deploy/Dockerfile) so they do not overlap.`));
  const exists = files.filter((f) => fs.existsSync(path.join(projectDir, f.path))).map((f) => f.path);
  if (exists.length && !dryRun) throw new Error(L(`이미 있는 파일은 덮어쓰지 않습니다: ${exists.join(", ")}`, `Existing files are not overwritten: ${exists.join(", ")}`));
  if (exists.length) notes.push(L(`이미 있는 파일: ${exists.join(", ")} — dryRun=false 면 거부됩니다.`, `Existing files: ${exists.join(", ")} — refused with dryRun=false.`));
  if (!dryRun) await withFileTransaction(projectDir, L("배포 산출물 생성", "deploy artifact generation"), (tx) => { for (const f of files) tx.writeFile(f.path, f.content, { mustNotExist: true }); });
  const usage = [
    ...(files.some((f) => f.path === dockerfile) ? [`docker build -t ${image}${dockerfile === "Dockerfile" ? "" : ` -f ${dockerfile}`} .${imageRegistry !== "docker.io/library" ? "" : L("   # 폐쇄망: --build-arg BASE_REGISTRY=<사내 레지스트리>", "   # air-gapped: --build-arg BASE_REGISTRY=<internal registry>")}`] : []),
    ...(p.web && files.some((f) => f.path === dockerfile) ? [`docker run --rm -p ${p.port}:${p.port} ${image}   # http://localhost:${p.port}${p.contextPath || "/"}`] : []),
    ...(targets.includes("compose") ? ["cd deploy && cp .env.example .env && docker compose up --build"] : []),
    ...(targets.includes("k8s") ? [L(`kubectl apply -f deploy/k8s/${p.appName}.yaml   # CHANGE_ME 를 먼저 바꾸고 이미지를 레지스트리에 올린 뒤`, `kubectl apply -f deploy/k8s/${p.appName}.yaml   # after replacing CHANGE_ME and pushing the image to a registry`)] : []),
  ];
  return { projectDir, supported: true, profile: p, dryRun, written: !dryRun, files: files.map((f) => ({ path: f.path, target: f.target, bytes: Buffer.byteLength(f.content), ...(dryRun ? { content: f.content } : {}) })), usage, notes };
}

export function renderDeployMarkdown(r: GenerateDeployResult): string {
  const out: string[] = [L(`# 배포 산출물 ${r.dryRun ? "(dryRun — 쓰지 않음)" : "생성"}`, `# Deploy artifacts ${r.dryRun ? "(dryRun — nothing written)" : "generated"}`), ""];
  if (!r.supported) { out.push(L(`- 지원하지 않는 구조: ${r.unsupported!.reason}`, `- Unsupported layout: ${r.unsupported!.reason}`)); for (const n of r.notes) out.push(`- ${n}`); return out.join("\n"); }
  if (r.workspace) {
    const w = r.workspace;
    out.push(L(`- 작업공간 ${w.kind} · 서비스 ${w.services.length}개 · 인프라 ${w.infra.map((i) => i.name).join("·") || "없음"}`, `- Workspace ${w.kind} · ${w.services.length} services · infra ${w.infra.map((i) => i.name).join("·") || "none"}`), "", L("| 서비스 | 모듈 | 실행 | 포트 | 이미지 | 환경 변수(localhost 참조) | 먼저 뜰 것 |", "| Service | Module | Runtime | Port | Image | Env vars (localhost refs) | Depends on |"), "|---|---|---|---|---|---|---|");
    for (const s of w.services) out.push(`| ${s.name} | ${s.module} | ${s.runtime}${s.ownDockerfile ? L("(자체 Dockerfile)", "(own Dockerfile)") : ""} | ${s.web ? s.port : "-"} | ${s.image} | ${s.env.join(", ") || "-"} | ${s.dependsOn.join(", ") || "-"} |`);
    out.push("", L("| 파일 | 대상 | 크기 |", "| File | Target | Size |"), "|---|---|---|");
    for (const f of r.files) out.push(`| ${f.path} | ${f.target} | ${f.bytes} B |`);
    if (r.usage.length) out.push("", "```bash", ...r.usage, "```");
    for (const n of r.notes) out.push(`- ${n}`);
    return out.join("\n");
  }
  const p = r.profile!;
  out.push(L(`- ${p.appName} ${p.version} · ${p.buildTool}${p.wrapper ? "(래퍼)" : ""} · ${p.packaging} → ${p.runtime === "tomcat" ? `Tomcat ${p.tomcat}(ROOT)` : "Boot java -jar"}${p.web ? ` · 포트 ${p.port}${p.contextPath ? ` · 컨텍스트 ${p.contextPath}` : ""} · 헬스 ${p.liveness}` : " · 웹 없음"}`, `- ${p.appName} ${p.version} · ${p.buildTool}${p.wrapper ? "(wrapper)" : ""} · ${p.packaging} → ${p.runtime === "tomcat" ? `Tomcat ${p.tomcat}(ROOT)` : "Boot java -jar"}${p.web ? ` · port ${p.port}${p.contextPath ? ` · context ${p.contextPath}` : ""} · health ${p.liveness}` : " · no web"}`));
  if (p.db) out.push(L(`- DB: ${p.db.type} (${p.db.file}) — ${p.db.inject === "env" ? "환경 변수로 덮어씀" : p.db.inject === "file" ? "설정 파일 덮어씀" : "내장 DB"}${p.db.service === "container" && p.db.inject !== "none" ? ` · compose DB 컨테이너${p.db.initScripts.length ? `(초기화 ${p.db.initScripts.join(", ")})` : ""}` : p.db.inject !== "none" ? " · 외부 DB" : ""}`, `- DB: ${p.db.type} (${p.db.file}) — ${p.db.inject === "env" ? "overridden via environment variables" : p.db.inject === "file" ? "config file overridden" : "embedded DB"}${p.db.service === "container" && p.db.inject !== "none" ? ` · compose DB container${p.db.initScripts.length ? ` (init ${p.db.initScripts.join(", ")})` : ""}` : p.db.inject !== "none" ? " · external DB" : ""}`));
  out.push("", L("| 파일 | 대상 | 크기 |", "| File | Target | Size |"), "|---|---|---|");
  for (const f of r.files) out.push(`| ${f.path} | ${f.target} | ${f.bytes} B |`);
  if (r.usage.length) out.push("", "```bash", ...r.usage, "```");
  for (const n of r.notes) out.push(`- ${n}`);
  if (r.dryRun) for (const f of r.files.filter((x) => x.content)) out.push("", `### ${f.path}`, "", "```" + (f.path.endsWith(".yml") || f.path.endsWith(".yaml") ? "yaml" : f.path === "Dockerfile" ? "dockerfile" : ""), f.content!.trimEnd(), "```");
  return out.join("\n");
}
