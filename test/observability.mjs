// node test/observability.mjs — 관측 내보내기(v1.16, 게이트, 오프라인)
//   generate_egovframe_deploy(observability="otel"): Dockerfile 에이전트 단계(로컬 jar 우선·URL·sha256)·런타임 복사·.dockerignore 예외,
//   compose(앱 환경 변수·수집기 서비스·depends_on·빌드 인자)·.env.example·Kubernetes(ConfigMap 환경 변수·수집기 ConfigMap/Deployment/Service)·README·collector.yaml,
//   기본 none 이면 v1.15 와 바이트 동일, Classic·Boot·buildInImage=false·DB compose 와 함께, 다중 서비스는 안내만, 규칙 데이터, 오프라인 번들 otel 항목, MCP 파라미터
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-otel-"));
let k = 0;
const project = (files) => { const d = path.join(root, `p${k++}`); for (const [rel, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); } return d; };
const BOOT_POM = "<project><parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>5.0.2</version></parent><artifactId>bootapp</artifactId><version>1.2.0</version><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>";
const WAR_POM = "<project><parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.2</version></parent><artifactId>webapp</artifactId><version>1.0</version><packaging>war</packaging></project>";
const file = (r, p) => r.files.find((f) => f.path === p)?.content ?? "";
const rules = m.loadDeployRules().observability;

// ── 규칙 데이터 ──────────────────────────────────────
assert(rules && /^\d+\.\d+\.\d+$/.test(rules.agent.version) && /^[0-9a-f]{64}$/.test(rules.agent.sha256) && rules.agent.bytes > 10_000_000 && rules.agent.url.endsWith(`opentelemetry-javaagent-${rules.agent.version}.jar`) && rules.agent.url.startsWith("https://repo1.maven.org/maven2/io/opentelemetry/javaagent/") && rules.agent.path === "/opt/otel/opentelemetry-javaagent.jar", `에이전트 고정 버전 ${rules?.agent.version}·sha256·Maven Central 경로`);
assert(rules.collector.image === "otel/opentelemetry-collector" && /^\d+\.\d+\.\d+$/.test(rules.collector.version) && /^sha256:[0-9a-f]{64}$/.test(rules.collector.digest) && rules.collector.ports.http === 4318 && rules.collector.ports.grpc === 4317 && rules.note.includes("AGPL") && rules.note_en, `수집기 core 배포판 ${rules.collector.version}·digest·포트, AGPL 스택 비동봉 안내`);

// ── Boot ─────────────────────────────────────────────
{
  const d = project({ "pom.xml": BOOT_POM, "src/main/resources/application.properties": "server.port=8080\nspring.datasource.url=jdbc:mysql://127.0.0.1:3306/app\nspring.datasource.username=app\nspring.datasource.password=${SPRING_DATASOURCE_PASSWORD}\n" });
  const base = await m.generateDeploy({ projectDir: d });
  const none = await m.generateDeploy({ projectDir: d, observability: "none" });
  assert(JSON.stringify(base.files) === JSON.stringify(none.files) && !base.files.some((f) => /otel/i.test(f.path) || /otel|opentelemetry/i.test(f.content ?? "")), "기본 none: 산출물이 v1.15 와 같고 OTel 흔적 없음");
  const r = await m.generateDeploy({ projectDir: d, observability: "otel" });
  const paths = r.files.map((f) => f.path);
  assert(paths.join() === "Dockerfile,.dockerignore,deploy/docker-compose.yml,deploy/.env.example,deploy/k8s/bootapp.yaml,deploy/otel/README.md,deploy/otel/collector.yaml", `otel 산출물 7개 (${paths.join(", ")})`);
  const df = file(r, "Dockerfile");
  assert(df.includes(`FROM \${BASE_REGISTRY}/eclipse-temurin:17-jdk AS otel`) && df.includes(`ARG OTEL_AGENT_URL=${rules.agent.url}`) && df.includes(`ARG OTEL_AGENT_SHA256=${rules.agent.sha256}`) && df.includes("COPY deploy/otel/ /otel-src/") && df.includes("if [ -f /otel-src/opentelemetry-javaagent.jar ]") && df.includes('curl -fsSL --retry 5 -o /opentelemetry-javaagent.jar "$OTEL_AGENT_URL"') && df.includes("sha256sum -c /tmp/otel.sha256"), "Dockerfile 에이전트 단계: 로컬 jar 우선 → URL, 어느 쪽이든 sha256 확인");
  assert(df.includes(`COPY --from=otel --chown=app:app /opentelemetry-javaagent.jar ${rules.agent.path}`) && df.indexOf("COPY --from=otel") < df.indexOf("USER 10001") && !/JAVA_TOOL_OPTIONS/.test(df) && df.includes('ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]'), "런타임에 에이전트만 복사(USER 전), 켜는 건 환경 변수(이미지에 JAVA_TOOL_OPTIONS 없음)");
  assert(!/\|/.test(df.slice(df.indexOf("AS otel"), df.indexOf("FROM ${BASE_REGISTRY}/eclipse-temurin:17-jre"))), "에이전트 단계에 파이프 없음(hadolint DL4006)");
  const ign = file(r, ".dockerignore").split("\n");
  assert(ign.indexOf("deploy") >= 0 && ign.indexOf("!deploy/otel") > ign.indexOf("deploy") && ign.includes("!deploy/otel/**"), ".dockerignore: deploy 제외 뒤 deploy/otel 다시 포함");
  const compose = file(r, "deploy/docker-compose.yml");
  for (const [k, v] of [["JAVA_TOOL_OPTIONS", `-javaagent:${rules.agent.path}`], ["OTEL_SERVICE_NAME", "bootapp"], ["OTEL_RESOURCE_ATTRIBUTES", "deployment.environment.name=${DEPLOY_ENV:-local},service.version=1.2.0"], ["OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318"], ["OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf"], ["OTEL_METRIC_EXPORT_INTERVAL", "${OTEL_METRIC_EXPORT_INTERVAL:-60000}"]]) assert(compose.includes(`      ${k}: "${v}"`), `compose 앱 환경 변수 ${k}`);
  assert(compose.includes('      SPRING_DATASOURCE_PASSWORD: "${DB_PASSWORD:-CHANGE_ME}"') && compose.indexOf("SPRING_DATASOURCE_PASSWORD") < compose.indexOf("JAVA_TOOL_OPTIONS"), "기존 DB 환경 변수는 그대로, OTel 은 뒤에");
  assert(compose.includes(`        OTEL_AGENT_URL: \${OTEL_AGENT_URL:-${rules.agent.url}}`) && compose.includes("    depends_on:\n      db:\n        condition: service_healthy\n      otel-collector:\n        condition: service_started") && compose.includes(`  otel-collector:\n    image: \${OTEL_COLLECTOR_IMAGE:-otel/opentelemetry-collector:${rules.collector.version}}\n    volumes:\n      - ./otel/collector.yaml:/etc/otelcol/config.yaml:ro\n    restart: unless-stopped`) && (compose.match(/^  db:/m) ?? []).length === 1, "compose: 빌드 인자 OTEL_AGENT_URL, DB·수집기 depends_on, 수집기 서비스(설정 볼륨), DB 서비스 유지");
  const env = file(r, "deploy/.env.example");
  assert(env.includes(`OTEL_COLLECTOR_IMAGE=otel/opentelemetry-collector:${rules.collector.version}\nDEPLOY_ENV=local\nOTEL_METRIC_EXPORT_INTERVAL=60000\n`) && env.includes(`# OTEL_AGENT_URL=${rules.agent.url}`) && env.includes("DB_PASSWORD=CHANGE_ME"), ".env.example: 수집기 이미지·환경·간격, 폐쇄망 OTEL_AGENT_URL 주석");
  const k8s = file(r, "deploy/k8s/bootapp.yaml");
  const docs = k8s.split("\n---\n");
  const cm = docs.find((x) => /kind: ConfigMap/.test(x) && /name: bootapp-config/.test(x)) ?? "";
  assert(cm.includes(`  JAVA_TOOL_OPTIONS: '-javaagent:${rules.agent.path}'`) && cm.includes("  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318'") && cm.includes("  OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=CHANGE_ME_ENV,service.version=1.2.0'") && !(docs.find((x) => /kind: Secret/.test(x)) ?? "").includes("OTEL_"), "k8s: 앱 ConfigMap 에 OTel 환경 변수(Secret 아님), 환경 이름은 CHANGE_ME_ENV");
  const ccm = docs.find((x) => /name: otel-collector-config/.test(x)) ?? "", cdep = docs.find((x) => /kind: Deployment/.test(x) && /name: otel-collector$/m.test(x)) ?? "", csvc = docs.find((x) => /kind: Service/.test(x) && /name: otel-collector$/m.test(x)) ?? "";
  assert(ccm.includes("  config.yaml: |\n    # OpenTelemetry Collector") && ccm.includes("\n    receivers:\n") && ccm.includes("            endpoint: 0.0.0.0:4318") && cdep.includes(`        image: otel/opentelemetry-collector:${rules.collector.version}`) && cdep.includes("runAsNonRoot: true") && cdep.includes("readOnlyRootFilesystem: true") && cdep.includes("          mountPath: /etc/otelcol") && cdep.includes("            path: config.yaml") && csvc.includes("    port: 4318") && csvc.includes("    port: 4317"), "k8s: 수집기 ConfigMap(설정 내장)·Deployment(비루트·읽기 전용 루트·설정 마운트)·Service(4317·4318)");
  const col = file(r, "deploy/otel/collector.yaml");
  assert(/^receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 0\.0\.0\.0:4317\n      http:\n        endpoint: 0\.0\.0\.0:4318$/m.test(col) && col.includes("  memory_limiter:") && col.includes("  debug:\n    verbosity: basic") && col.includes("  # otlp_http/backend:") && col.includes("  # prometheus:") && (col.match(/exporters: \[debug\]/g) ?? []).length === 3 && (col.match(/processors: \[memory_limiter, batch\]/g) ?? []).length === 3, "collector.yaml: otlp 수신, memory_limiter·batch, debug 내보내기(trace·metric·log), 백엔드는 주석 예시");
  const readme = file(r, "deploy/otel/README.md");
  assert(readme.includes(rules.agent.sha256) && readme.includes("JAVA_TOOL_OPTIONS") && readme.includes('include=[…,"otel"]') && readme.includes("AGPL") && readme.includes("OTEL_INSTRUMENTATION_"), "README: sha256·켜고 끄기·폐쇄망(번들)·백엔드·AGPL");
  assert(r.notes.some((x) => x.startsWith("관측: OpenTelemetry Java 에이전트") && x.includes("--build-arg OTEL_AGENT_URL")), "안내: 관측 구성·폐쇄망");
  // targets 일부
  const onlyK8s = await m.generateDeploy({ projectDir: d, observability: "otel", targets: ["k8s"] });
  assert(onlyK8s.files.map((f) => f.path).join() === "deploy/k8s/bootapp.yaml,deploy/otel/README.md", "targets=[k8s]: 매니페스트 + README(수집기 설정은 ConfigMap 에)");
  const onlyDocker = await m.generateDeploy({ projectDir: d, observability: "otel", targets: ["docker"] });
  assert(onlyDocker.files.map((f) => f.path).join() === "Dockerfile,.dockerignore,deploy/otel/README.md", "targets=[docker]: Dockerfile 이 복사할 deploy/otel/ 가 생김(README)");
  // 적용
  const w = await m.generateDeploy({ projectDir: d, observability: "otel", dryRun: false });
  assert(w.written && w.files.length === 7, "dryRun=false 로 기록");
  rmSync(d, { recursive: true, force: true });
}

// ── Classic·미리 빌드 ────────────────────────────────
{
  const d = project({ "pom.xml": WAR_POM, "src/main/resources/egovframework/egovProps/globals.properties": "Globals.DbType = hsql\n" });
  const r = await m.generateDeploy({ projectDir: d, observability: "otel", buildInImage: false });
  const df = file(r, "Dockerfile");
  assert(r.profile.runtime === "tomcat" && df.includes("COPY --from=otel --chown=app:app /opentelemetry-javaagent.jar /opt/otel/opentelemetry-javaagent.jar") && df.indexOf("COPY --from=otel") > df.indexOf("webapps/ROOT") && df.indexOf("COPY --from=otel") < df.indexOf("USER 10001"), "Classic(Tomcat): 에이전트 복사(JAVA_TOOL_OPTIONS 는 Tomcat JVM 에도 적용)");
  const ign = file(r, ".dockerignore").split("\n");
  assert(ign[1] === "*" && ign.includes("!deploy/otel") && ign.includes("!deploy/otel/**") && ign.includes("!target/*.war"), "buildInImage=false: '*' 뒤 산출물과 deploy/otel 예외");
  rmSync(d, { recursive: true, force: true });
}

// ── 다중 서비스는 안내만 ─────────────────────────────
{
  const d = project({ "pom.xml": "<project><groupId>egov.msa</groupId><artifactId>root</artifactId><version>1</version><packaging>pom</packaging><modules><module>api</module><module>web</module></modules></project>", "api/pom.xml": BOOT_POM.replace("<artifactId>bootapp</artifactId>", "<groupId>egov.msa</groupId><artifactId>api</artifactId>").replace("</project>", "<build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>"), "api/src/main/resources/application.yml": "server:\n  port: 8081\n", "web/pom.xml": BOOT_POM.replace("<artifactId>bootapp</artifactId>", "<groupId>egov.msa</groupId><artifactId>web</artifactId>").replace("</project>", "<build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>"), "web/src/main/resources/application.yml": "server:\n  port: 8082\n" });
  const r = await m.generateDeploy({ projectDir: d, observability: "otel" });
  assert(r.workspace && r.notes.some((x) => /단일 프로젝트에만/.test(x)) && !r.files.some((f) => /otel/.test(f.path)), "멀티 모듈: 관측은 단일 프로젝트에만 — 안내, 산출물에 넣지 않음");
  rmSync(d, { recursive: true, force: true });
}

// ── 오프라인 번들 otel 항목 ──────────────────────────
{
  const out = path.join(root, "bundle");
  const r = await m.prepareEgovframeOfflineBundle({ outputDir: out, include: ["otel"] });
  assert(r.dryRun && r.items.length === 1 && r.items[0].kind === "otel" && r.items[0].path === "otel/opentelemetry-javaagent.jar" && r.items[0].url === rules.agent.url && r.items[0].sha256 === rules.agent.sha256 && r.items[0].bytes === rules.agent.bytes && r.usage.some((x) => x.includes("deploy/otel/")), "번들 include=[otel]: 에이전트 jar(지문 고정)·사용 안내");
  const r2 = await m.prepareEgovframeOfflineBundle({ outputDir: out });
  assert(!r2.items.some((i) => i.kind === "otel") && !m.BUNDLE_INCLUDES.includes("otel"), "otel 은 기본 포함 아님");
  const buf = Buffer.from("not the agent");
  let threw = null;
  try { await m.prepareEgovframeOfflineBundle({ outputDir: out, include: ["otel"], dryRun: false, download: async () => ({ buffer: buf, lastModified: null }) }); } catch (e) { threw = e.message; }
  assert(threw && /sha256|지문|불일치|mismatch/i.test(threw), `내려받은 jar 지문이 다르면 거부 (${(threw ?? "").slice(0, 80)})`);
}

// ── MCP ──────────────────────────────────────────────
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  const tools = (await client.listTools()).tools;
  const t = tools.find((x) => x.name === "generate_egovframe_deploy");
  const b = tools.find((x) => x.name === "prepare_egovframe_offline_bundle");
  assert(t.inputSchema.properties.observability.enum.join() === "none,otel" && t.inputSchema.properties.observability.default === "none" && b.inputSchema.properties.include.items.enum.includes("otel"), "MCP: observability(기본 none)·번들 include otel");
  const d = project({ "pom.xml": BOOT_POM, "src/main/resources/application.properties": "server.port=8080\n" });
  const res = await client.callTool({ name: "generate_egovframe_deploy", arguments: { projectDir: d, observability: "otel", format: "json" } });
  assert(!res.isError && res.structuredContent.files.some((f) => f.path === "deploy/otel/collector.yaml"), "MCP 호출");
  await client.close(); await server.close();
  rmSync(d, { recursive: true, force: true });
}

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`observability FAIL (${n} assertions)`); else console.log(`observability OK (${n} assertions)`);
