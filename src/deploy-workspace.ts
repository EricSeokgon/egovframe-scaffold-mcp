// 멀티 모듈·다중 서비스 배포 산출물 (generate_egovframe_deploy, v0.47).
//   공식 MSA 템플릿처럼 서비스 모듈이 여럿이면 모듈마다 이미지(자체 Dockerfile 이 있으면 그대로)를 만들고
//   하나의 docker-compose 와 서비스별 Kubernetes 매니페스트로 묶는다.
//   핵심은 설정 안의 localhost 참조다 — 서비스가 http://localhost:8888(설정 서버)·:8761(디스커버리)·jdbc:mysql://localhost:3306·
//   spring.rabbitmq.host=localhost 를 보면 컨테이너에서는 자기 자신을 가리킨다. 포트로 대상 서비스를 찾아
//   (1) 모듈 자신의 설정은 Spring 환경 변수로 덮어쓰고, (2) 설정 서버가 내주는 설정 파일은 사본을 만들어 바꾼 뒤 설정 서버에 붙인다.
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeDeploy, loadDeployRules, parseProperties, parseJdbcUrl, renderDockerfile, renderDockerignore, renderKubernetes, type DeployProfile, type DeployRenderOptions } from "./deploy.js";
import { detectWorkspace, flattenYaml, type Workspace, type WorkspaceModule } from "./workspace.js";
import { SERVER_VERSION } from "./version.js";

const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
export const serviceName = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "svc";
/** Spring Boot 의 환경 변수 이름(완화 바인딩): 점 → _, 대시 제거, 대문자 — search-locations → SEARCHLOCATIONS */
export const springEnvName = (key: string) => key.replace(/-/g, "").replace(/\./g, "_").replace(/\[|\]/g, "_").toUpperCase();
const LOCAL_RE = /\b(localhost|127\.0\.0\.1)(?=:(\d{2,5})\b)/g;

export interface HostTarget { host: string; kind: "service" | "db" | "infra" }
export interface ServiceRef { key: string; from: string; to: string; line: number; file: string }
export interface WorkspaceService {
  name: string; module: WorkspaceModule; profile: DeployProfile;
  /** 자체 Dockerfile(모듈 상대) — 있으면 그대로 쓰고 새로 만들지 않는다 */
  ownDockerfile: string | null;
  /** 빌드 컨텍스트(작업공간 상대)·Dockerfile(컨텍스트 상대) */
  context: string; dockerfile: string;
  /** 모듈이 server.port=0(임의 포트)이면 컨테이너 포트를 고정 */
  fixedPort: boolean;
  /** 모듈 설정의 localhost 참조 → 환경 변수(compose 값) */
  env: { name: string; value: string; secret: boolean }[];
  refs: ServiceRef[];
  dependsOn: string[];
  /** 설정 서버면 설정 저장소 사본 */
  configRepo?: { source: string; mount: string; files: { rel: string; content: string; changed: number }[] };
  /** 발행할 호스트 포트(설정된 고정 포트만) */
  publish: boolean;
}
export interface WorkspaceDeployPlan {
  appName: string; version: string; ws: Workspace;
  services: WorkspaceService[];
  infra: { name: string; kind: "db" | "infra"; image: string; port: number; env: Record<string, string>; command: string[]; healthcheck: string; volumes: string[]; dataPath?: string }[];
  skipped: { module: string; reason: string }[];
  unresolved: { service: string; key: string; value: string }[];
  notes: string[];
  /** DB 컨테이너 비밀번호 기본값(.env.example) */
  dbPassword?: string | null;
}

function moduleConfig(abs: string): { file: string; map: Map<string, { value: string; line: number }> }[] {
  const out: { file: string; map: Map<string, { value: string; line: number }> }[] = [];
  for (const f of ["application.yml", "application.yaml", "bootstrap.yml", "bootstrap.yaml", "application.properties", "bootstrap.properties"]) {
    const p = path.join(abs, "src/main/resources", f);
    if (!fs.existsSync(p)) continue;
    out.push({ file: `src/main/resources/${f}`, map: f.endsWith(".properties") ? parseProperties(read(p)) : flattenYaml(read(p)) });
  }
  return out;
}

/** 값 하나의 localhost:포트 참조를 대상 호스트로. 바뀐 것이 없으면 null */
export function rewriteLocal(value: string, ports: Map<number, HostTarget>): { value: string; hosts: string[]; unknown: number[] } | null {
  const hosts: string[] = [], unknown: number[] = [];
  const out = value.replace(LOCAL_RE, (h, _1, port) => { const t = ports.get(Number(port)); if (!t) { unknown.push(Number(port)); return h; } hosts.push(t.host); return t.host; });
  return hosts.length || unknown.length ? { value: out, hosts, unknown } : null;
}

/** 작업공간을 서비스·인프라로 나눈다(읽기 전용). */
export function planWorkspaceDeploy(projectDir: string, opts: { appName?: string } = {}): WorkspaceDeployPlan {
  const rules = loadDeployRules();
  const ws = detectWorkspace(projectDir);
  const root = ws.root;
  const notes: string[] = [...ws.notes];
  const skipped: WorkspaceDeployPlan["skipped"] = [];
  const services: WorkspaceService[] = [];
  for (const m of ws.modules) {
    if (m.library) { skipped.push({ module: m.dir, reason: "라이브러리 모듈(실행 단위 아님) — 다른 서비스 이미지 안에 들어갑니다" }); continue; }
    const a = analyzeDeploy(path.join(root, m.dir));
    if (!a.profile) { skipped.push({ module: m.dir, reason: a.unsupported?.reason ?? "분석 실패" }); continue; }
    const name = serviceName(m.name);
    const rootCtx = m.buildTool === "maven" && m.inheritsFrom !== null;
    services.push({
      name, module: m, profile: a.profile, ownDockerfile: m.dockerfile,
      context: rootCtx ? "" : m.dir, dockerfile: rootCtx ? `${m.dir}/Dockerfile` : "Dockerfile",
      fixedPort: a.notes.some((n) => n.startsWith("server.port=0")), env: [], refs: [], dependsOn: [], publish: false,
    });
  }
  // 포트 → 대상
  const ports = new Map<number, HostTarget>();
  const configured = new Map<string, number>(); // 서비스 → 설정에 적힌 포트
  for (const s of services) {
    const cfg = moduleConfig(path.join(root, s.module.dir));
    const p = cfg.map((c) => c.map.get("server.port")?.value).find((v) => v && /^\d+$/.test(v));
    if (p && p !== "0") { ports.set(Number(p), { host: s.name, kind: "service" }); configured.set(s.name, Number(p)); s.publish = true; }
  }
  for (const [type, db] of Object.entries(rules.databases)) if (!ports.has(db.port)) ports.set(db.port, { host: "db", kind: "db" });
  for (const [name, inf] of Object.entries(rules.infra ?? {})) if (!ports.has(inf.port)) ports.set(inf.port, { host: name, kind: "infra" });

  // 설정 서버의 저장소 위치(native)
  const configServer = services.find((s) => moduleConfig(path.join(root, s.module.dir)).some((c) => [...c.map.keys()].some((k) => k.startsWith("spring.cloud.config.server."))));
  const used = new Set<string>(); // 참조된 db·infra
  const unresolved: WorkspaceDeployPlan["unresolved"] = [];
  const dbCreds: { user?: string; password?: string; database?: string; type?: string } = {};
  const scanRefs = (svc: WorkspaceService | null, file: string, map: Map<string, { value: string; line: number }>, sink: (r: ServiceRef & { name: string }) => void) => {
    for (const [key, { value, line }] of map) {
      // 자격 증명·DB 이름 수집(DB 컨테이너를 같은 값으로)
      if (/datasource\.username$/i.test(key)) dbCreds.user ??= value.replace(/^\$\{[\w.\-]+:(.*)\}$/, "$1");
      if (/datasource\.password$/i.test(key)) dbCreds.password ??= value.replace(/^\$\{[\w.\-]+:(.*)\}$/, "$1");
      if (/datasource\.url$/i.test(key)) { const j = parseJdbcUrl(value.replace(/^\$\{[\w.\-]+:(.*)\}$/, "$1")); if (j?.database) dbCreds.database ??= j.database; dbCreds.type ??= value.match(/jdbc:(?:log4jdbc:)?(\w+):/)?.[1]; }
      const r0 = rewriteLocal(value, ports);
      // 자기 자신을 가리키는 참조(문서·브라우저용 URL 등)는 그대로 둔다 — 컨테이너 밖에서 쓰는 주소다
      const r = r0 && svc && r0.hosts.length && r0.hosts.every((h) => h === svc.name) ? null : r0;
      if (r) {
        for (const h of r.hosts) { const t = [...ports.values()].find((x) => x.host === h); if (t && t.kind !== "service") used.add(h); if (svc && t?.kind === "service" && h !== svc.name && !svc.dependsOn.includes(h)) svc.dependsOn.push(h); }
        for (const u of r.unknown) unresolved.push({ service: svc?.name ?? "config-repo", key, value });
        if (r.hosts.length) sink({ key, from: value, to: r.value, line, file, name: springEnvName(key) });
        continue;
      }
      // host 만 따로 적은 키(spring.rabbitmq.host: localhost + port: 5672)
      if (/(^|\.)host$/.test(key) && /^(localhost|127\.0\.0\.1)$/.test(value)) {
        const port = Number(map.get(key.replace(/host$/, "port"))?.value);
        const t = ports.get(port);
        if (!t) { unresolved.push({ service: svc?.name ?? "config-repo", key, value: `${value}${port ? `:${port}` : ""}` }); continue; }
        if (t.kind !== "service") used.add(t.host);
        sink({ key, from: value, to: t.host, line, file, name: springEnvName(key) });
      }
    }
  };
  for (const s of services) {
    for (const c of moduleConfig(path.join(root, s.module.dir))) scanRefs(s, `${s.module.dir}/${c.file}`, c.map, (r) => { s.refs.push(r); if (!s.env.some((e) => e.name === r.name)) s.env.push({ name: r.name, value: r.to, secret: false }); });
    if (s.fixedPort) s.env.push({ name: "SERVER_PORT", value: String(s.profile.port), secret: false });
  }
  if (configServer) {
    const cfg = moduleConfig(path.join(root, configServer.module.dir));
    const loc = cfg.map((c) => c.map.get("spring.cloud.config.server.native.search-locations")?.value).find(Boolean) ?? null;
    const dirOf = (l: string): string | null => {
      const first = l.split(",")[0].trim().replace(/^\$\{[\w.\-]+:(.*)\}$/, "$1");
      const cp = first.match(/^classpath:\/?(.*)$/);
      const cands = cp ? [path.join(root, configServer.module.dir, "src/main/resources", cp[1])]
        : first.startsWith("file:") ? [path.join(root, configServer.module.dir, first.slice(5)), path.join(root, first.slice(5).replace(/^\.\//, ""))] : [];
      return cands.find((d) => fs.existsSync(d) && fs.statSync(d).isDirectory()) ?? null;
    };
    const src = loc ? dirOf(loc) : null;
    if (src) {
      const files: NonNullable<WorkspaceService["configRepo"]>["files"] = [];
      for (const f of fs.readdirSync(src).filter((x) => /\.(ya?ml|properties)$/.test(x)).sort()) {
        const text = read(path.join(src, f));
        const map = f.endsWith(".properties") ? parseProperties(text) : flattenYaml(text);
        const lines = text.split(/\r?\n/);
        let changed = 0;
        scanRefs(null, f, map, (r) => { const i = r.line - 1; if (lines[i]?.includes(r.from)) { lines[i] = lines[i].replace(r.from, r.to); changed++; } });
        files.push({ rel: f, content: lines.join("\n"), changed });
      }
      configServer.configRepo = { source: path.relative(root, src).split(path.sep).join("/"), mount: "/config-repo", files };
      configServer.env.push({ name: "SPRING_CLOUD_CONFIG_SERVER_NATIVE_SEARCHLOCATIONS", value: "file:/config-repo/", secret: false });
      notes.push(`설정 서버(${configServer.name})의 저장소 ${configServer.configRepo.source} 를 deploy/config-repo/ 사본으로 붙입니다(localhost 참조 ${files.reduce((n, f) => n + f.changed, 0)}곳을 서비스 이름으로 바꿈).`);
    } else if (loc) notes.push(`설정 서버 저장소 위치(${loc})를 작업공간에서 찾지 못했습니다 — 설정 서버가 내주는 설정의 localhost 참조는 바꾸지 않았습니다.`);
  }
  // 설정 서버를 참조하는 서비스는 설정 서버 뒤에, 디스커버리를 참조하는 서비스는 디스커버리 뒤에 뜨게(이미 dependsOn)
  // 인프라
  const infra: WorkspaceDeployPlan["infra"] = [];
  let dbPassword: string | null = null;
  if (used.has("db")) {
    const type = rules.dbAliases[(dbCreds.type ?? "mysql").toLowerCase()] ?? (dbCreds.type ?? "mysql").toLowerCase();
    const db = rules.databases[type];
    if (db) {
      const env: Record<string, string> = {};
      const user = dbCreds.user ?? db.rootUser;
      // 앱은 설정에 적힌 비밀번호를 그대로 쓰므로(설정 서버가 내줌) DB 컨테이너 기본값을 그 값에 맞춘다 — 운영 값은 .env·설정에서 바꿀 것
      const pw = dbCreds.password && !/\$\{/.test(dbCreds.password) ? dbCreds.password : "CHANGE_ME";
      dbPassword = pw;
      if (type === "postgres") { env[db.env.user] = user; env[db.env.password] = `\${DB_PASSWORD:-${pw}}`; }
      else { env[db.env.rootPassword] = "${DB_ROOT_PASSWORD:-CHANGE_ME}"; if (user !== db.rootUser) { env[db.env.user] = user; env[db.env.password] = `\${DB_PASSWORD:-${pw}}`; } }
      if (dbCreds.database) env[db.env.database] = dbCreds.database;
      env.TZ = rules.timezone;
      // 템플릿이 둔 초기화 SQL 디렉터리(docker-compose/<db>/init 등)
      const initDirs = ["docker-compose/mysql/init", "docker-compose/mariadb/init", "docker-compose/postgres/init", "docker-compose/postgresql/init", "init", "sql"].map((d) => path.join(root, d)).filter((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith(".sql")));
      const volumes = ["db-data:" + db.data, ...(initDirs[0] ? [`../${path.relative(root, initDirs[0]).split(path.sep).join("/")}:${db.initdb}:ro`] : [])];
      infra.push({ name: "db", kind: "db", image: db.image, port: db.port, env, command: db.command, healthcheck: db.healthcheck, volumes, dataPath: db.data });
      if (dbPassword !== "CHANGE_ME") notes.push(`DB 계정·비밀번호는 설정 파일에 적힌 값(${user} 계정)을 앱이 그대로 쓰므로 DB 컨테이너 기본값을 같게 두었습니다 — 운영에서는 설정과 .env 의 DB_PASSWORD 를 함께 바꾸세요.`);
      if (!initDirs.length) notes.push("DB 초기화 SQL 디렉터리를 찾지 못해 빈 DB 로 띄웁니다.");
    } else notes.push(`DB(${type})는 공개 이미지 규칙이 없어 컨테이너로 띄우지 않습니다 — 연결 정보를 바꾸세요.`);
  }
  for (const [name, inf] of Object.entries(rules.infra ?? {})) {
    if (!used.has(name)) continue;
    const env: Record<string, string> = {};
    if (inf.env && inf.user) { env[inf.env.user] = inf.user; env[inf.env.password] = `\${${name.toUpperCase()}_PASSWORD:-CHANGE_ME}`; }
    infra.push({ name, kind: "infra", image: inf.image, port: inf.port, env, command: [], healthcheck: inf.healthcheck, volumes: [] });
    if (inf.user) for (const s of services) if (s.refs.some((r) => r.to === name)) {
      // 브로커 계정: guest 는 원격 접속 불가 → 만든 계정으로
      if (name === "rabbitmq") s.env.push({ name: "SPRING_RABBITMQ_USERNAME", value: inf.user, secret: false }, { name: "SPRING_RABBITMQ_PASSWORD", value: `\${RABBITMQ_PASSWORD:-CHANGE_ME}`, secret: true });
    }
    notes.push(`${name}: ${inf.note}`);
  }
  for (const s of services) for (const r of s.refs) { const t = [...ports.values()].find((x) => x.host === r.to || r.to.includes(`${x.host}:`) || r.to.includes(`//${x.host}`)); if (t && t.kind !== "service" && !s.dependsOn.includes(t.host)) s.dependsOn.push(t.host); }
  if (configServer) for (const s of services) if (s !== configServer && (s.configRepo === undefined) && s.refs.some((r) => r.to.includes(configServer.name)) && !s.dependsOn.includes(configServer.name)) s.dependsOn.push(configServer.name);
  if (unresolved.length) notes.push(`대상을 모르는 localhost 참조 ${unresolved.length}건(포트 ${[...new Set(unresolved.map((u) => u.value.match(/:(\d+)/)?.[1]).filter(Boolean))].join("·") || "-"}) — 외부 서비스(검색 엔진 등)는 직접 연결하세요: ${unresolved.slice(0, 4).map((u) => `${u.service} ${u.key}`).join(", ")}`);
  const rootPom = read(path.join(root, "pom.xml"));
  const appName = opts.appName ?? serviceName(rootPom.replace(/<parent>[\s\S]*?<\/parent>/, "").match(/<artifactId>\s*([^<\s]+)/)?.[1] ?? path.basename(root));
  const version = rootPom.replace(/<parent>[\s\S]*?<\/parent>/, "").match(/<version>\s*([^<\s$]+)\s*<\/version>/)?.[1] ?? services[0]?.profile.version ?? "1.0.0";
  return { appName, version, ws, services, infra, skipped, unresolved, notes, dbPassword };
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** compose 값: 우리가 만든 변수(${NAME:-기본})만 치환되게 두고, 설정에서 온 Spring 자리표시자(${a.b:기본})는 $$ 로 막는다 */
const composeEscape = (s: string) => s.replace(/\$\{(?![A-Z][A-Z0-9_]*:-)/g, "$$${");
const dq = (s: string) => { const v = composeEscape(s); return /\$\{/.test(v) ? `"${v}"` : q(v); };

export function renderWorkspaceCompose(plan: WorkspaceDeployPlan, o: { imageRegistry: string; image: (s: WorkspaceService) => string }): string {
  const L: string[] = [
    `# eGovFrame 다중 서비스 로컬 실행 — egovframe-scaffold-mcp ${SERVER_VERSION} generate_egovframe_deploy`,
    `# 사용: cd deploy && cp .env.example .env && docker compose up --build`,
    `name: ${plan.appName}`, "services:",
  ];
  const healthy = new Set([...plan.infra.map((i) => i.name), ...plan.services.filter((s) => s.profile.web).map((s) => s.name)]);
  for (const s of plan.services) {
    L.push(`  ${s.name}:`, "    build:", `      context: ../${s.context || "."}`.replace(/\/\.$/, ""), `      dockerfile: ${s.ownDockerfile ?? s.dockerfile}`, "      args:", `        BASE_REGISTRY: \${BASE_REGISTRY:-${o.imageRegistry}}`, `    image: ${o.image(s)}`);
    if (s.publish && s.profile.web) L.push("    ports:", `      - "\${${s.name.replace(/-/g, "_").toUpperCase()}_PORT:-${s.profile.port}}:${s.profile.port}"`);
    if (s.env.length) { L.push("    environment:"); for (const e of s.env) L.push(`      ${e.name}: ${e.secret ? `"${e.value}"` : dq(e.value)}`); }
    if (s.configRepo) L.push("    volumes:", `      - ./config-repo:${s.configRepo.mount}:ro`);
    if (s.ownDockerfile && s.profile.web) L.push("    healthcheck:", `      test: ["CMD-SHELL", "curl -fsS -o /dev/null http://127.0.0.1:${s.profile.port}${s.profile.liveness} || exit 1"]`, "      interval: 15s", "      timeout: 5s", "      retries: 20", "      start_period: 60s");
    if (s.dependsOn.length) { L.push("    depends_on:"); for (const d of s.dependsOn) L.push(`      ${d}:`, `        condition: ${healthy.has(d) ? "service_healthy" : "service_started"}`); }
    L.push("    restart: unless-stopped");
  }
  for (const i of plan.infra) {
    L.push(`  ${i.name}:`, `    image: \${BASE_REGISTRY:-${o.imageRegistry}}/${i.image}`);
    if (Object.keys(i.env).length) { L.push("    environment:"); for (const [k, v] of Object.entries(i.env)) L.push(`      ${k}: ${dq(v)}`); }
    if (i.command.length) L.push("    command:", ...i.command.map((c) => `      - ${q(c)}`));
    if (i.volumes.length) L.push("    volumes:", ...i.volumes.map((v) => `      - ${v}`));
    L.push("    healthcheck:", `      test: ["CMD-SHELL", ${JSON.stringify(i.healthcheck)}]`, "      interval: 10s", "      timeout: 5s", "      retries: 30", "      start_period: 30s", "    restart: unless-stopped");
  }
  const vols = plan.infra.filter((i) => i.dataPath).map((i) => `  ${i.name}-data: {}`);
  if (vols.length) L.push("volumes:", ...vols);
  return L.join("\n").replace(/db-data:/g, "db-data:") + "\n";
}

export function renderWorkspaceEnv(plan: WorkspaceDeployPlan, imageRegistry: string): string {
  return [
    "# docker compose 변수 — .env 로 복사해 값을 바꾸세요(.env 는 저장소에 넣지 않음)", `BASE_REGISTRY=${imageRegistry}`,
    ...plan.services.filter((s) => s.publish && s.profile.web).map((s) => `${s.name.replace(/-/g, "_").toUpperCase()}_PORT=${s.profile.port}`),
    ...(plan.infra.some((i) => i.kind === "db") ? ["DB_ROOT_PASSWORD=CHANGE_ME", `DB_PASSWORD=${plan.dbPassword ?? "CHANGE_ME"}`] : []),
    ...plan.infra.filter((i) => i.kind === "infra" && Object.keys(i.env).length).map((i) => `${i.name.toUpperCase()}_PASSWORD=CHANGE_ME`), "",
  ].join("\n");
}

/** 서비스 하나의 Kubernetes 매니페스트 — localhost 참조는 같은 이름의 Service DNS 로(인프라는 CHANGE_ME 자리표시자) */
export function renderWorkspaceK8s(root: string, plan: WorkspaceDeployPlan, s: WorkspaceService, o: DeployRenderOptions): string {
  const infraNames = new Set(plan.infra.map((i) => i.name));
  const env = s.env.map((e) => ({ name: e.name, secret: e.secret, value: e.secret ? "CHANGE_ME" : e.value.replace(/\b(db|rabbitmq|redis)(?=[:/]|$)/g, (h) => (infraNames.has(h) ? `CHANGE_ME_${h.toUpperCase()}_HOST` : h)) }));
  return renderKubernetes(path.join(root, s.module.dir), { ...s.profile, appName: s.name }, o, { env, ...(s.configRepo ? { configMapMount: { name: `${plan.appName}-config-repo`, mountPath: s.configRepo.mount } } : {}) });
}

export function renderConfigRepoConfigMap(plan: WorkspaceDeployPlan, s: WorkspaceService): string {
  const L = ["apiVersion: v1", "kind: ConfigMap", "metadata:", `  name: ${plan.appName}-config-repo`, "  labels:", "    app.kubernetes.io/managed-by: egovframe-scaffold-mcp", "data:"];
  for (const f of s.configRepo!.files) { L.push(`  ${f.rel}: |`); for (const l of f.content.split("\n")) L.push(l ? `    ${l}` : ""); }
  return [`# 설정 서버(${s.name}) 저장소 — ${s.configRepo!.source} 사본(localhost 참조를 Service 이름으로). 인프라 호스트 CHANGE_ME 를 바꾸세요`, "---", ...L].join("\n").replace(/\b(db|rabbitmq|redis):(\d+)/g, (all, h, p) => (plan.infra.some((i) => i.name === h) ? `CHANGE_ME_${h.toUpperCase()}_HOST:${p}` : all)) + "\n";
}

export interface WorkspaceDeployFile { path: string; target: "docker" | "compose" | "k8s"; content: string }
/** 다중 서비스 산출물 파일 목록(쓰지 않음). */
export function workspaceDeployFiles(plan: WorkspaceDeployPlan, o: { jdk: string; imageRegistry: string; buildInImage: boolean; image?: string; targets: string[] }): { files: WorkspaceDeployFile[]; images: Record<string, string> } {
  const files: WorkspaceDeployFile[] = [];
  const images: Record<string, string> = {};
  const tag = plan.version.toLowerCase().replace(/[^\w.-]/g, "-");
  const imageOf = (s: WorkspaceService) => (images[s.name] ??= `${plan.appName}-${s.name}:${tag}`);
  for (const s of plan.services) {
    const ro: DeployRenderOptions = { jdk: o.jdk, imageRegistry: o.imageRegistry, buildInImage: o.buildInImage, image: imageOf(s), ...(s.context === "" && s.module.dir ? { moduleDir: s.module.dir } : {}) };
    if ((o.targets.includes("docker") || o.targets.includes("compose")) && !s.ownDockerfile) {
      const dfPath = s.context === "" ? `${s.module.dir}/Dockerfile` : `${s.module.dir}/Dockerfile`;
      files.push({ path: dfPath, target: "docker", content: renderDockerfile(s.profile, ro) });
      files.push({ path: s.context === "" ? `${s.module.dir}/Dockerfile.dockerignore` : `${s.module.dir}/.dockerignore`, target: "docker", content: renderDockerignore(s.profile, ro) });
    }
    if (o.targets.includes("k8s")) files.push({ path: `deploy/k8s/${s.name}.yaml`, target: "k8s", content: renderWorkspaceK8s(plan.ws.root, plan, s, ro) });
  }
  if (o.targets.includes("compose")) {
    files.push({ path: "deploy/docker-compose.yml", target: "compose", content: renderWorkspaceCompose(plan, { imageRegistry: o.imageRegistry, image: imageOf }) });
    files.push({ path: "deploy/.env.example", target: "compose", content: renderWorkspaceEnv(plan, o.imageRegistry) });
    const cs = plan.services.find((s) => s.configRepo);
    if (cs) for (const f of cs.configRepo!.files) files.push({ path: `deploy/config-repo/${f.rel}`, target: "compose", content: f.content });
  }
  if (o.targets.includes("k8s")) { const cs = plan.services.find((s) => s.configRepo); if (cs) files.push({ path: `deploy/k8s/${plan.appName}-config-repo.yaml`, target: "k8s", content: renderConfigRepoConfigMap(plan, cs) }); }
  return { files, images };
}
