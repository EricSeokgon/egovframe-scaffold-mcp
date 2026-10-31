// 기동 검증 (verify_egovframe_startup, v1.11.0)
//   전환·갱신·조립 뒤 "컴파일은 되는데 뜨지 않는다"가 가장 흔한 다음 단계다 — 빈 생성 실패, 설정 파일 경로, DB 접속,
//   JDBC 드라이버, MyBatis 매퍼 XML 오류는 컴파일로 잡히지 않는다. 이 모듈은 프로젝트를 바꾸지 않고 실제로 띄워 본다.
//   - Spring Boot: mvn spring-boot:run / gradle bootRun, 빈 포트를 --server.port 로 주입
//   - Classic war: 패키징한 war 를 캐시의 Tomcat 10.1(Servlet 6.1+ 는 11.0)에 ROOT 로 두고 CATALINA_BASE 를 임시 디렉터리로 따로 둬서
//     org.apache.catalina.startup.Bootstrap 을 java 로 직접 실행(Cargo·스크립트 실행 권한 없이 Windows·Linux 공통)
//   로그의 기동 완료 문구 뒤 HTTP 로 확인하고(5xx 가 아니면 기동), 실패면 Spring 원인 사슬을 종류별로 분류해 처방을 단다.
//   끝나면 프로세스 트리를 끝낸다(build-runner 의 Runner·signal 재사용).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { analyzeDeploy, loadDeployRules } from "./deploy.js";
import { defaultRunner, detectBuildToolAt, failureSummary, resolveCommand, runBuild, type BuildTool, type Runner } from "./build-runner.js";
import { classifyFailure, type FailureKind } from "./maven-resilience.js";
import { defaultCacheDir } from "./component-origin.js";
import { DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "./shared.js";
import { throwIfAborted, type Progress } from "./progress.js";
import { L } from "./lang.js";

export type StartupFailureKind = "build" | "repository-unavailable" | "port-in-use" | "driver-missing" | "db-connection" | "db-schema" | "mapper-xml" | "config-missing" | "javax-namespace" | "bean-creation" | "http-error" | "timeout" | "other";
export interface StartupCause {
  kind: StartupFailureKind;
  /** 마지막 원인(예외 클래스: 메시지) */
  summary: string;
  bean?: string;
  /** 관련 설정 자원(context-*.xml·application.yml·매퍼 XML) */
  resource?: string;
  line?: number;
  jdbcUrl?: string;
  driver?: string;
  hint: string;
}
export interface StartupLogAnalysis { started: boolean; startedInMs?: number; failed: boolean; chain: string[]; cause: StartupCause | null }

// ── 로그 분석(순수 함수, 테스트 대상) ─────────────────
const BOOT_STARTED = /Started \S+ in ([\d.]+) seconds/;
const TOMCAT_STARTED = /Server startup in \[?([\d,]+)\]? ?(?:ms|milliseconds)/;
const FAILED_MARKERS = /APPLICATION FAILED TO START|Application run failed|Context \[[^\]]*\] startup failed due to previous errors|One or more listeners failed to start|Exception sending context initialized event to listener|Context initialization failed|Servlet\.init\(\) for servlet \[[^\]]+\] threw exception/;
const DRIVER_COORD: [RegExp, string][] = [
  [/mysql/i, "com.mysql:mysql-connector-j"], [/mariadb/i, "org.mariadb.jdbc:mariadb-java-client"], [/postgres/i, "org.postgresql:postgresql"],
  [/oracle/i, "com.oracle.database.jdbc:ojdbc11"], [/hsqldb/i, "org.hsqldb:hsqldb"], [/tmax|tibero/i, L("Tibero JDBC(벤더 배포 — 사내 저장소)", "Tibero JDBC (vendor distribution — internal repository)")], [/altibase/i, L("Altibase JDBC(벤더 배포)", "Altibase JDBC (vendor distribution)")], [/cubrid/i, "cubrid:cubrid-jdbc"],
];

/** 로그에서 기동 여부와 실패 원인을 뽑는다. 원인은 마지막 Caused by(가장 안쪽)를 기준으로 종류를 정한다. */
/** 배포 사본·빌드 결과의 경로를 프로젝트 원본 경로로(…/WEB-INF/classes/x → src/main/resources/x) */
export function normalizeResource(res: string, projectDir?: string): string {
  const r = res.replace(/\\/g, "/");
  const m = r.match(/\/(?:WEB-INF\/classes|target\/classes|build\/resources\/main)\/(.+)$/);
  if (m) return m[1].endsWith(".class") ? `src/main/java/${m[1].replace(/\$[^/]*(?=\.class$)/, "").replace(/\.class$/, ".java")}` : `src/main/resources/${m[1]}`;
  const w = r.match(/\/webapps\/ROOT\/(.+)$/);
  if (w) return `src/main/webapp/${w[1]}`;
  if (projectDir) { const pd = projectDir.replace(/\\/g, "/").replace(/\/+$/, ""); if (r.startsWith(`${pd}/`)) return r.slice(pd.length + 1); }
  return r;
}

export function analyzeStartupLog(log: string, runtime: "boot" | "tomcat" = "boot", opts: { afterStart?: boolean } = {}): StartupLogAnalysis {
  const text = log.replace(/\r/g, "");
  const sm = text.match(runtime === "boot" ? BOOT_STARTED : TOMCAT_STARTED);
  const started = !!sm;
  const startedInMs = sm ? (runtime === "boot" ? Math.round(Number(sm[1]) * 1000) : Number(sm[1].replace(/,/g, ""))) : undefined;
  const failed = FAILED_MARKERS.test(text);
  // 예외 사슬: 맨 위 예외 + Caused by 들(중복 제거, 순서 유지)
  const chain: string[] = [];
  for (const m of text.matchAll(/^(?:Caused by: )?((?:[a-z][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error)(?::[^\n]*)?)$/gm)) {
    const s = m[1].trim().slice(0, 400);
    if (!chain.includes(s)) chain.push(s);
  }
  const causedBy = [...text.matchAll(/^Caused by: ([^\n]+)$/gm)].map((m) => m[1].trim());
  const root = causedBy.at(-1) ?? chain.at(-1) ?? null;
  const has = (re: RegExp) => re.exec(text);
  let cause: StartupCause | null = null;
  // 바깥 빈(sampleService)이 아니라 실제로 실패한 안쪽 빈 — 클래스를 못 찾은 빈이 있으면 그것, 아니면 마지막 "Error creating bean"
  const noClass = text.match(/Cannot find class \[([^\]]+)\] for bean with name '([^']+)' defined in ((?:class path resource|file|URL|ServletContext resource) \[[^\]]+\])/);
  const beans = [...text.matchAll(/Error creating bean with name '([^']+)'(?: defined in ((?:class path resource|file|URL|ServletContext resource) \[[^\]]+\]|[\w.$]+))?/g)];
  const bean: RegExpMatchArray | null = noClass ? (Object.assign([noClass[0], noClass[2], noClass[3]], { index: noClass.index }) as unknown as RegExpMatchArray) : beans.at(-1) ?? null;
  const resourceOf = (s: string | undefined) => { const v = s?.match(/\[([^\]]+)\]/)?.[1] ?? s; return v ? normalizeResource(v) : v; };
  const summary = root ?? (text.match(/^\s*(?:\[ERROR\]|ERROR|SEVERE)[^\n]*$/m)?.[0].trim() ?? "");
  let m: RegExpExecArray | null;
  if (!started || failed || opts.afterStart) {
    if ((m = has(/Port (\d+) was already in use|java\.net\.BindException: Address already in use/))) cause = { kind: "port-in-use", summary: m[0], hint: L("포트가 이미 쓰이고 있습니다 — 다른 포트(port)로 다시 실행하거나 그 프로세스를 끝내세요", "The port is already in use — run again with another port, or stop that process") };
    else if ((m = has(/Cannot load driver class: ([\w.$]+)|Failed to load driver class ([\w.$]+)|(?:ClassNotFoundException|NoClassDefFoundError): ((?:com\.mysql|org\.mariadb|org\.postgresql|oracle\.jdbc|org\.hsqldb|com\.tmax|Altibase|cubrid)[\w.$/]*)/))) {
      const driver = (m[1] ?? m[2] ?? m[3]).replace(/\//g, ".");
      const coord = DRIVER_COORD.find(([re]) => re.test(driver))?.[1];
      cause = { kind: "driver-missing", summary: m[0], driver, hint: L(`JDBC 드라이버 ${driver} 가 클래스패스에 없습니다 — 의존성 ${coord ?? "(드라이버 좌표)"} 를 추가하세요(공식 parent 가 관리하면 버전 생략)`, `JDBC driver ${driver} is not on the classpath — add the dependency ${coord ?? "(driver coordinate)"} (omit the version when the official parent manages it)`) };
    }
    else if ((m = has(/Communications link failure|Connection refused|Connection to [\w.:\-]+ refused|Unknown database '[^']+'|Access denied for user '[^']+'|password authentication failed for user "[^"]+"|database "[^"]+" does not exist|IO Error: The Network Adapter could not establish the connection|ORA-\d{5}[^\n]*|Could not create connection to database server|(?:Unable|Failed) to obtain JDBC Connection[^\n]*/))) {
      const url = text.match(/jdbc:[\w:]+[^\s'",;)\]]+/)?.[0];
      cause = { kind: "db-connection", summary: root && /SQL|JDBC|Connect|Communications|refused|denied/i.test(root) ? root : m[0], ...(url ? { jdbcUrl: url } : {}), hint: L(`DB 에 접속하지 못했습니다${url ? `(${url})` : ""} — DB 가 떠 있는지·계정·DB 이름을 확인하세요. 개발 DB 는 prepare_egovframe_database(run=true, keep=true) 또는 생성한 docker-compose.db.yml 로 띄울 수 있습니다`, `Could not connect to the DB${url ? ` (${url})` : ""} — check that it is running and the account and database name. A development DB can be started with prepare_egovframe_database(run=true, keep=true) or the generated docker-compose.db.yml`) };
    }
    else if ((m = has(/user lacks privilege or object not found: ([\w.]+)|Table '([^']+)' doesn't exist|relation "([^"]+)" does not exist|ORA-00942[^\n]*|Base table or view not found[^\n]*/))) {
      const table = m[1] ?? m[2] ?? m[3];
      cause = { kind: "db-schema", summary: root && /SQL|Hsql|table|relation|object/i.test(root) ? root : m[0], hint: L(`DB 에 테이블${table ? ` ${table}` : ""} 이 없습니다 — 접속은 됐지만 스키마·기초 데이터가 들어가지 않았습니다. prepare_egovframe_database 로 적재하세요(HSQL 인메모리 템플릿은 Globals.Hsql.AutoInit=true)`, `Table${table ? ` ${table}` : ""} does not exist — the connection works but the schema and seed data were not loaded. Load them with prepare_egovframe_database (for HSQL in-memory templates set Globals.Hsql.AutoInit=true)`) };
    }
    else if ((m = has(/Error parsing Mapper XML\. The XML location is '([^']+)'|Failed to parse mapping resource: '([^']+)'|Error parsing SQL Mapper Configuration[^\n]*|BuilderException: Error parsing Mapper XML[^\n]*|Mapped Statements collection already contains value for ([\w.]+)/))) {
      const res = m[1] ?? m[2] ?? text.match(/The XML location is '([^']+)'|mapping resource: '([^']+)'/)?.slice(1).find(Boolean);
      const line = Number(text.match(/lineNumber: (\d+)/)?.[1]) || undefined;
      cause = { kind: "mapper-xml", summary: root ?? m[0], ...(res ? { resource: resourceOf(`[${res}]`) } : {}), ...(line ? { line } : {}), hint: L(`MyBatis 매퍼 XML 을 읽지 못했습니다${res ? `(${resourceOf(`[${res}]`)}${line ? `:${line}` : ""})` : ""} — XML 문법·태그 짝·namespace·같은 id 의 중복을 확인하세요`, `MyBatis could not read the mapper XML${res ? ` (${resourceOf(`[${res}]`)}${line ? `:${line}` : ""})` : ""} — check the XML syntax, tag pairs, namespace and duplicate ids`) };
    }
    else if ((m = has(/(?:ClassNotFoundException|NoClassDefFoundError): (javax[./](?:servlet|persistence|validation|annotation|xml\/bind|xml\.bind|inject)[\w.$/]*)/))) cause = { kind: "javax-namespace", summary: m[0], hint: L(`javax 패키지(${m[1].replace(/\//g, ".")})를 찾습니다 — 5.x(Spring 6)는 jakarta.* 입니다. migrate_egovframe_project 의 javax→jakarta 항목을 적용하고 javax 좌표 라이브러리를 Jakarta 판으로 바꾸세요`, `Looking for a javax package (${m[1].replace(/\//g, ".")}) — 5.x (Spring 6) uses jakarta.*. Apply the javax→jakarta items of migrate_egovframe_project and replace javax-coordinate libraries with their Jakarta versions`) };
    else if ((m = has(/FileNotFoundException: (?:class path resource|ServletContext resource) \[([^\]]+)\] cannot be opened because it does not exist|IOException parsing XML document from (?:class path resource|file|ServletContext resource|URL) \[([^\]]+)\][^\n]*|Could not resolve placeholder '([^']+)'[^\n]*/))) {
      const res = m[1] ?? m[2];
      cause = { kind: "config-missing", summary: m[0], ...(res ? { resource: normalizeResource(res) } : {}), hint: m[3] ? L(`설정 값 \${${m[3]}} 을 찾지 못했습니다 — application.properties·globals.properties 에 키를 추가하거나 기본값(\${${m[3]}:…})을 두세요`, `Configuration value \${${m[3]}} was not found — add the key to application.properties or globals.properties, or give it a default (\${${m[3]}:…})`) : L(`설정 파일 ${res} 이 없거나 읽을 수 없습니다 — 공통컴포넌트 설정(context-*.xml)이 빠졌는지, import 경로가 맞는지 확인하세요(validate_egovframe_project)`, `Configuration file ${res} is missing or unreadable — check whether common-component configuration (context-*.xml) is missing and the import path is right (validate_egovframe_project)`) };
    }
    else if (bean && /HeadlessException|AWTError|X11|DISPLAY/.test(root ?? "")) cause = { kind: "bean-creation", summary: root ?? bean[0], bean: bean[1], ...(bean[2] ? { resource: resourceOf(bean[2]) } : {}), hint: L(`빈 '${bean[1]}' 이 화면(GUI) 창을 띄우려 합니다(예: HSQL DatabaseManagerSwing) — 서버·CI 에는 화면이 없으니 그 빈을 개발 PC 프로필에서만 켜세요`, `Bean '${bean[1]}' tries to open a GUI window (e.g. the HSQL DatabaseManagerSwing) — servers and CI have no display, so enable that bean only in a developer-PC profile`) };
    else if (bean) cause = { kind: "bean-creation", summary: root ?? bean[0], bean: bean[1], ...(bean[2] ? { resource: resourceOf(bean[2]) } : {}), hint: L(`빈 '${bean[1]}' 을 만들지 못했습니다${bean[2] ? `(${resourceOf(bean[2])})` : ""} — 마지막 원인(${(root ?? "").slice(0, 120)})을 보고, 공통컴포넌트면 필요한 설정·의존 컴포넌트가 조립됐는지 validate_egovframe_project 로 확인하세요`, `Could not create bean '${bean[1]}'${bean[2] ? ` (${resourceOf(bean[2])})` : ""} — see the last cause (${(root ?? "").slice(0, 120)}); for common components, check with validate_egovframe_project that the required configuration and dependent components are assembled`) };
    else if (!opts.afterStart && (failed || summary)) cause = { kind: "other", summary: summary.slice(0, 400), hint: L("로그 끝부분(logTail)의 첫 오류를 확인하세요", "Check the first error at the end of the log (logTail)") };
  }
  if (cause && bean && !cause.bean) cause.bean = bean[1];
  if (cause && bean?.[2] && !cause.resource) cause.resource = resourceOf(bean[2]);
  return { started: started && !failed, ...(startedInMs !== undefined ? { startedInMs } : {}), failed, chain: chain.slice(0, 12), cause };
}

// ── Tomcat(캐시) ─────────────────────────────────────
export type Download = (url: string) => Promise<Buffer>;
const defaultDownload: Download = async (url) => {
  const r = await fetchWithTimeout(url, Math.max(DOWNLOAD_TIMEOUT_MS, 180_000), { headers: { "User-Agent": "egovframe-scaffold-mcp" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
};
/** 캐시에 고정 버전 Tomcat 을 풀어 두고 그 경로(CATALINA_HOME)를 돌려준다. sha256 이 다르면 거부. */
export async function ensureTomcat(line: "10.1" | "11.0", o: { cacheDir?: string; download?: Download } = {}): Promise<{ home: string; version: string; downloaded: boolean; from?: string }> {
  const t = loadDeployRules().startup!.tomcat[line];
  const home = path.join(o.cacheDir ?? defaultCacheDir(), "tomcat", `apache-tomcat-${t.version}`);
  if (fs.existsSync(path.join(home, "bin", "bootstrap.jar"))) return { home, version: t.version, downloaded: false };
  const mirror = process.env.EGOVFRAME_MAVEN_MIRROR?.trim().replace(/\/+$/, "");
  const urls = [...(mirror ? [`${mirror}/${t.maven}`] : []), `https://repo1.maven.org/maven2/${t.maven}`, t.archive];
  const errors: string[] = [];
  for (const url of urls) {
    let buf: Buffer;
    try { buf = await (o.download ?? defaultDownload)(url); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); continue; }
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== t.sha256) { errors.push(L(`sha256 불일치 ${url} (${sha.slice(0, 12)})`, `sha256 mismatch ${url} (${sha.slice(0, 12)})`)); continue; }
    const staging = `${home}.${randomUUID().slice(0, 8)}.tmp`;
    fs.mkdirSync(staging, { recursive: true });
    for (const e of new AdmZip(buf).getEntries()) {
      const rel = e.entryName.replace(/^[^/]+\//, "");
      if (!rel || rel.split("/").includes("..")) continue;
      const dst = path.join(staging, rel);
      if (e.isDirectory) { fs.mkdirSync(dst, { recursive: true }); continue; }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, e.getData());
    }
    try { fs.renameSync(staging, home); } catch { fs.rmSync(staging, { recursive: true, force: true }); }
    if (fs.existsSync(path.join(home, "bin", "bootstrap.jar"))) return { home, version: t.version, downloaded: true, from: url };
  }
  throw new Error(L(`Tomcat ${t.version} 을 받지 못했습니다: ${errors.join("; ")} — 사내 미러(EGOVFRAME_MAVEN_MIRROR) 또는 tomcatHome 으로 설치된 Tomcat 을 지정하세요`, `Could not download Tomcat ${t.version}: ${errors.join("; ")} — set an internal mirror (EGOVFRAME_MAVEN_MIRROR) or point tomcatHome at an installed Tomcat`));
}

/** CATALINA_BASE: conf 복사 + HTTP 포트 교체·셧다운 포트 끔·AJP 제거, webapps/ROOT.war */
export function prepareCatalinaBase(home: string, war: string, port: number, baseDir: string): string {
  for (const d of ["conf", "logs", "temp", "webapps", "work"]) fs.mkdirSync(path.join(baseDir, d), { recursive: true });
  for (const f of fs.readdirSync(path.join(home, "conf"))) { const p = path.join(home, "conf", f); if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(baseDir, "conf", f)); }
  const sx = path.join(baseDir, "conf", "server.xml");
  let xml = fs.readFileSync(sx, "utf8");
  xml = xml.replace(/<Server port="\d+"/, '<Server port="-1"').replace(/(<Connector port=")8080(" protocol="HTTP\/1\.1")/, `$1${port}$2 address="127.0.0.1"`).replace(/<Connector[^>]*protocol="AJP\/1\.3"[^>]*\/>/g, "");
  fs.writeFileSync(sx, xml);
  fs.copyFileSync(war, path.join(baseDir, "webapps", "ROOT.war"));
  return baseDir;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const a = s.address(); const p = typeof a === "object" && a ? a.port : 0; s.close(() => resolve(p)); });
  });
}
export type HttpProbe = (url: string) => Promise<number | null>;
const defaultProbe: HttpProbe = async (url) => {
  try { const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) }); return r.status; } catch { return null; }
};

// ── 진입점 ────────────────────────────────────────────
export interface StartupOptions {
  projectDir: string;
  /** 확인할 경로(기본: context path 의 "/" — actuator 가 있으면 /actuator/health) */
  path?: string;
  /** 고정 포트(기본: 빈 포트) */
  port?: number;
  /** 전체 제한(기본 300000ms — 첫 실행은 의존성 다운로드 포함) */
  timeoutMs?: number;
  /** Classic war 를 띄울 설치된 Tomcat(기본: 캐시에 고정 버전을 내려받음) */
  tomcatHome?: string;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  httpProbe?: HttpProbe;
  download?: Download;
  cacheDir?: string;
  progress?: Progress;
}
export interface StartupResult {
  projectDir: string;
  runtime: "boot" | "tomcat" | "unknown";
  buildTool: BuildTool | null;
  command: string;
  port: number;
  url: string | null;
  /** 기동 성공(로그의 완료 문구 + HTTP 5xx 아님, 웹이 아니면 완료 문구만) */
  success: boolean;
  started: boolean;
  startedInMs?: number;
  durationMs: number;
  http?: { url: string; status: number | null; ok: boolean };
  cause?: StartupCause;
  chain: string[];
  tomcat?: { version: string; home: string; downloaded: boolean };
  build?: { ran: boolean; success: boolean | null; command?: string; durationMs?: number; errors: number; failureKind?: FailureKind; failureHint?: string };
  logTail: string;
  notes: string[];
}

const quoteWin = (s: string, platform: string) => (platform === "win32" && /\s/.test(s) ? `"${s}"` : s);

export async function verifyStartup(opts: StartupOptions): Promise<StartupResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const started = Date.now();
  const platform = opts.platform ?? process.platform;
  const runner = opts.runner ?? defaultRunner;
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const notes: string[] = [];
  const a = analyzeDeploy(projectDir);
  if (!a.profile) throw new Error(L(`기동할 수 없는 프로젝트입니다: ${a.unsupported?.reason ?? ""}${a.unsupported?.id === "multi-module" ? " — 모듈 디렉터리를 projectDir 로 주세요" : ""}`, `This project cannot be started: ${a.unsupported?.reason ?? ""}${a.unsupported?.id === "multi-module" ? " — pass the module directory as projectDir" : ""}`));
  const p = a.profile;
  const buildTool = detectBuildToolAt(projectDir)!;
  // Boot 는 war 패키징이어도 spring-boot:run 으로(외부 Tomcat 없이)
  const buildFile = path.join(projectDir, buildTool === "maven" ? "pom.xml" : fs.existsSync(path.join(projectDir, "build.gradle")) ? "build.gradle" : "build.gradle.kts");
  const buildText = fs.readFileSync(buildFile, "utf8");
  const runtime: "boot" | "tomcat" = p.runtime === "boot" || /spring-boot-maven-plugin|egovframe-boot-starter-parent|spring-boot-starter-parent|id\s*\(?\s*['"]org\.springframework\.boot['"]/.test(buildText) ? "boot" : "tomcat";
  const port = opts.port ?? await freePort();
  const contextPath = runtime === "boot" ? p.contextPath : "";
  const probePath = opts.path ?? (runtime === "boot" && p.actuator ? `${contextPath}/actuator/health` : `${contextPath}/`);
  if (!/^\/[\w\-./]*$/.test(probePath)) throw new Error(L(`path 는 / 로 시작하는 경로여야 합니다: ${probePath}`, `path must start with /: ${probePath}`));
  const url = p.web ? `http://127.0.0.1:${port}${probePath}` : null;
  const base: Omit<StartupResult, "command" | "success" | "started" | "durationMs" | "chain" | "logTail"> = { projectDir, runtime, buildTool, port, url, notes };
  let log = "";
  const cap = (s: string) => { log += s; if (log.length > 4_000_000) log = log.slice(-3_000_000); };

  // 실행 명령
  let cmd = resolveCommand(projectDir, buildTool, "compile", { platform });
  let tomcatInfo: StartupResult["tomcat"];
  let build: StartupResult["build"];
  let baseDir: string | null = null;
  if (runtime === "boot") {
    cmd = { ...cmd, args: buildTool === "maven" ? ["-B", "spring-boot:run", `-Dspring-boot.run.arguments=--server.port=${port}`, "-Dspring-boot.run.jvmArguments=-Djava.awt.headless=true"] : ["--console=plain", "bootRun", `--args=--server.port=${port}`] };
  } else {
    opts.progress?.report("startup: package war", 0, 3);
    const b = await runBuild({ projectDir, goal: "package", timeoutMs, runner, platform });
    build = { ran: true, success: b.success ?? null, command: b.command, durationMs: b.durationMs, errors: b.errors?.length ?? 0, ...failureSummary(b) };
    const outDir = path.join(projectDir, buildTool === "maven" ? "target" : "build/libs");
    const war = (() => { try { return fs.readdirSync(outDir).filter((f) => f.endsWith(".war") && !f.endsWith("-plain.war")).map((f) => path.join(outDir, f)).sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0]; } catch { return undefined; } })();
    if (!b.success || !war) {
      const kind: StartupFailureKind = b.failureKind === "repository-unavailable" ? "repository-unavailable" : "build";
      return { ...base, command: b.command, success: false, started: false, durationMs: Date.now() - started, chain: [], build, cause: { kind, summary: b.errors?.[0] ? `${b.errors[0].file ?? ""}${b.errors[0].line ? `:${b.errors[0].line}` : ""} ${b.errors[0].message}`.trim() : (b.success ? L("war 파일을 찾지 못했습니다", "No war file found") : L("war 패키징 실패", "war packaging failed")), hint: kind === "repository-unavailable" ? (b.failureHint ?? "") : L("기동 전에 패키징이 실패했습니다 — build_egovframe_project(goal=\"compile\") 로 오류를 먼저 고치세요", "Packaging failed before startup — fix the errors first with build_egovframe_project(goal=\"compile\")") }, logTail: (b.logTail ?? "").split("\n").slice(-40).join("\n") };
    }
    opts.progress?.report("startup: tomcat", 1, 3);
    const home = opts.tomcatHome ? path.resolve(opts.tomcatHome) : null;
    const tc = home ? { home, version: (() => { try { return fs.readFileSync(path.join(home, "RELEASE-NOTES"), "utf8").match(/Apache Tomcat Version ([\d.]+)/)?.[1] ?? "?"; } catch { return "?"; } })(), downloaded: false } : await ensureTomcat(p.tomcat, { cacheDir: opts.cacheDir, download: opts.download });
    if (!fs.existsSync(path.join(tc.home, "bin", "bootstrap.jar"))) throw new Error(L(`Tomcat 설치가 아닙니다(bin/bootstrap.jar 없음): ${tc.home}`, `Not a Tomcat installation (no bin/bootstrap.jar): ${tc.home}`));
    tomcatInfo = { version: tc.version, home: tc.home, downloaded: tc.downloaded };
    baseDir = prepareCatalinaBase(tc.home, war, port, fs.mkdtempSync(path.join(os.tmpdir(), "egov-startup-")));
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", platform === "win32" ? "java.exe" : "java") : "java";
    const q = (s: string) => quoteWin(s, String(platform));
    cmd = { command: q(java), args: ["-cp", q([path.join(tc.home, "bin", "bootstrap.jar"), path.join(tc.home, "bin", "tomcat-juli.jar")].join(platform === "win32" ? ";" : ":")), `-Dcatalina.home=${q(tc.home)}`, `-Dcatalina.base=${q(baseDir)}`, `-Djava.io.tmpdir=${q(path.join(baseDir, "temp"))}`, "-Djava.util.logging.manager=org.apache.juli.ClassLoaderLogManager", `-Djava.util.logging.config.file=${q(path.join(baseDir, "conf", "logging.properties"))}`, "-Djava.awt.headless=true", "org.apache.catalina.startup.Bootstrap", "start"], cwd: baseDir, usedWrapper: false };
    notes.push(L(`Classic war 를 Tomcat ${tc.version} 에 ROOT 로 올립니다(프로젝트는 바꾸지 않음, CATALINA_BASE 는 임시 디렉터리).`, `The Classic war is deployed as ROOT on Tomcat ${tc.version} (the project is not changed; CATALINA_BASE is a temporary directory).`));
  }
  const command = [cmd.command, ...cmd.args].join(" ");

  // 실행 — 완료 문구·실패 문구를 보면 HTTP 확인 뒤 끝낸다
  opts.progress?.report("startup: run", 2, 3);
  const ac = new AbortController();
  const onParent = () => ac.abort();
  opts.progress?.signal?.addEventListener("abort", onParent, { once: true });
  let http: StartupResult["http"];
  let watching = true;
  const startRe = runtime === "boot" ? BOOT_STARTED : TOMCAT_STARTED;
  const watch = (async () => {
    while (watching && !ac.signal.aborted) {
      await new Promise((r) => setTimeout(r, 500));
      if (FAILED_MARKERS.test(log)) { await new Promise((r) => setTimeout(r, 1500)); ac.abort(); return; }
      if (startRe.test(log)) {
        if (url) {
          let status: number | null = null;
          for (let i = 0; i < 5 && status === null && !ac.signal.aborted; i++) { status = await (opts.httpProbe ?? defaultProbe)(url); if (status === null) await new Promise((r) => setTimeout(r, 2000)); }
          http = { url, status, ok: status !== null && status < 500 };
          await new Promise((r) => setTimeout(r, 500)); // 응답 처리 중 로그(오류 스택)를 함께 받는다
        }
        ac.abort();
        return;
      }
    }
  })();
  let rr: Awaited<ReturnType<Runner>>;
  try {
    rr = await runner(cmd, { timeoutMs, onData: cap, signal: ac.signal });
  } finally {
    watching = false;
    opts.progress?.signal?.removeEventListener("abort", onParent);
  }
  await watch.catch(() => {});
  throwIfAborted(opts.progress?.signal);
  if (baseDir) { try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* 잠긴 파일 — 임시 디렉터리 */ } }

  const an = analyzeStartupLog(log, runtime);
  const reachedStart = an.started;
  let success = reachedStart && (url ? !!http?.ok : true);
  let cause = an.cause ?? undefined;
  if (!reachedStart && (!cause || cause.kind === "other")) {
    // 빌드 도구 단계에서 끝남(컴파일 오류·저장소 장애) 또는 시간 초과
    const f = classifyFailure({ output: log, timedOut: rr.timedOut, goal: "compile" });
    if (rr.timedOut) cause = { kind: "timeout", summary: L(`${Math.round(timeoutMs / 1000)}초 안에 기동 완료 문구가 없었습니다`, `No startup completion message within ${Math.round(timeoutMs / 1000)}s`), hint: L("timeoutMs 를 늘리거나(첫 실행은 의존성 다운로드 포함) 로그 끝부분을 확인하세요", "Increase timeoutMs (the first run includes dependency downloads) or check the end of the log") };
    else if (f.kind === "repository-unavailable") cause = { kind: "repository-unavailable", summary: f.repository?.line ?? "", hint: L("원격 저장소 장애로 실행 전 단계에서 멈췄습니다 — 코드 문제가 아닙니다. 잠시 뒤 다시 실행하세요", "Stopped before startup because a remote repository was unavailable — not a code problem. Retry later") };
    else if (/BUILD FAILURE|COMPILATION ERROR|Compilation failure|FAILURE: Build failed/.test(log) && !/Started |Server startup in|Initializing Spring/.test(log)) cause = { kind: "build", summary: log.match(/^\[ERROR\][^\n]*\.java:\[\d+,\d+\][^\n]*/m)?.[0] ?? log.match(/^\[ERROR\][^\n]+/m)?.[0] ?? "BUILD FAILURE", hint: L("기동 전에 빌드가 실패했습니다 — build_egovframe_project(goal=\"compile\") 로 오류를 먼저 고치세요", "The build failed before startup — fix the errors first with build_egovframe_project(goal=\"compile\")") };
  }
  if (reachedStart && url && !http?.ok) {
    success = false;
    // 기동 뒤 요청 처리(헬스 체크의 DB 연결 등)에서 난 오류
    const late = analyzeStartupLog(log, runtime, { afterStart: true }).cause;
    if (late) { cause = late; notes.push(L(`기동은 됐지만 ${probePath} 가 ${http?.status ?? "응답 없음"} — 요청 처리 중 오류입니다.`, `It started, but ${probePath} returned ${http?.status ?? "no response"} — an error while handling the request.`)); }
    cause ??= { kind: "http-error", summary: http?.status ? `HTTP ${http.status} ${url}` : L(`응답 없음 ${url}`, `no response ${url}`), hint: L(`기동은 됐지만 ${probePath} 가 ${http?.status ?? "응답 없음"} 입니다 — 로그의 요청 처리 오류를 보거나 path 로 다른 화면을 지정하세요`, `It started, but ${probePath} returned ${http?.status ?? "no response"} — check the request errors in the log, or pass another screen with path`) };
  }
  if (success) cause = undefined;
  if (cause?.resource) cause.resource = normalizeResource(cause.resource, projectDir);
  if (cause?.kind === "db-connection" && !cause.jdbcUrl && p.db?.url) cause.jdbcUrl = p.db.url;
  const tail = log.replace(/\r/g, "").split("\n").filter((l) => l.trim()).slice(-60).join("\n");
  return { ...base, command, success, started: reachedStart, ...(an.startedInMs !== undefined ? { startedInMs: an.startedInMs } : {}), durationMs: Date.now() - started, ...(http ? { http } : {}), ...(cause ? { cause } : {}), chain: an.chain, ...(tomcatInfo ? { tomcat: tomcatInfo } : {}), ...(build ? { build } : {}), logTail: tail };
}

const KIND_LABEL: Record<StartupFailureKind, () => string> = {
  build: () => L("빌드 실패", "build failure"), "repository-unavailable": () => L("원격 저장소 장애", "remote repository unavailable"), "port-in-use": () => L("포트 사용 중", "port in use"), "driver-missing": () => L("JDBC 드라이버 없음", "JDBC driver missing"), "db-connection": () => L("DB 접속 실패", "DB connection failure"), "db-schema": () => L("DB 테이블 없음", "DB table missing"), "mapper-xml": () => L("매퍼 XML 오류", "mapper XML error"), "config-missing": () => L("설정 누락", "missing configuration"), "javax-namespace": () => L("javax 네임스페이스", "javax namespace"), "bean-creation": () => L("빈 생성 실패", "bean creation failure"), "http-error": () => L("HTTP 오류", "HTTP error"), timeout: () => L("시간 초과", "timeout"), other: () => L("기타", "other"),
};
export const startupKindLabel = (k: StartupFailureKind): string => KIND_LABEL[k]();

export function renderStartupMarkdown(r: StartupResult): string {
  const out: string[] = [];
  out.push(L(`# 기동 검증 — ${r.success ? "✅ 기동" : "❌ 실패"}`, `# Startup check — ${r.success ? "✅ started" : "❌ failed"}`), "");
  out.push(L(`- 경로: ${r.projectDir} · ${r.runtime === "boot" ? "Spring Boot" : `Classic war → Tomcat ${r.tomcat?.version ?? ""}`} · ${r.buildTool} · 포트 ${r.port}`, `- Path: ${r.projectDir} · ${r.runtime === "boot" ? "Spring Boot" : `Classic war → Tomcat ${r.tomcat?.version ?? ""}`} · ${r.buildTool} · port ${r.port}`));
  out.push(L(`- 명령: \`${r.command}\``, `- Command: \`${r.command}\``));
  out.push(L(`- ${r.started ? `기동 완료 문구 확인${r.startedInMs !== undefined ? `(${(r.startedInMs / 1000).toFixed(1)}초)` : ""}` : "기동 완료 문구 없음"}${r.http ? ` · ${r.http.url} → ${r.http.status ?? "응답 없음"}` : ""} · 전체 ${Math.round(r.durationMs / 1000)}초`, `- ${r.started ? `startup message seen${r.startedInMs !== undefined ? ` (${(r.startedInMs / 1000).toFixed(1)}s)` : ""}` : "no startup message"}${r.http ? ` · ${r.http.url} → ${r.http.status ?? "no response"}` : ""} · total ${Math.round(r.durationMs / 1000)}s`));
  for (const n of r.notes) out.push(`- ${n}`);
  if (r.cause) {
    const c = r.cause;
    out.push("", L(`## 원인: ${startupKindLabel(c.kind)}`, `## Cause: ${startupKindLabel(c.kind)}`), "", `- ${c.summary}`);
    if (c.bean) out.push(L(`- 빈: \`${c.bean}\``, `- Bean: \`${c.bean}\``));
    if (c.resource) out.push(L(`- 자원: ${c.resource}${c.line ? `:${c.line}` : ""}`, `- Resource: ${c.resource}${c.line ? `:${c.line}` : ""}`));
    if (c.jdbcUrl) out.push(`- JDBC URL: ${c.jdbcUrl}`);
    if (c.driver) out.push(L(`- 드라이버: ${c.driver}`, `- Driver: ${c.driver}`));
    out.push(L(`- 처방: ${c.hint}`, `- Fix: ${c.hint}`));
    if (r.chain.length) out.push("", L("### 예외 사슬", "### Exception chain"), "", ...r.chain.map((x) => `- ${x}`));
    out.push("", L("### 로그 끝부분", "### End of log"), "", "```", ...r.logTail.split("\n").slice(-25), "```");
  }
  return out.join("\n");
}
