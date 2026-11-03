// node test/externalize.mjs — 설정·비밀값 외부화(v1.13, 게이트, 오프라인·가짜 runner)
//   찾기: 보안약점 규칙과 같은 집합(화이트리스트 적용)·XML 리터럴(주석 제외)·암호화 키·직접 읽는 키는 수동, 배포 정의 파일은 수동,
//   적용: properties·yml·XML 의 값만 자리표시자로(구분자·CRLF 보존), 암호화 키 줄 주석 + Globals.CryptoConfigPath + 외부 본 예시,
//   배포 산출물(.env.example·compose·Secret) 갱신, 백업·plan, 결과·plan 에 원래 값 없음, dryRun 무기록, 재점검 수, 멱등,
//   verify: 원래 값을 환경 변수로 주고 기동(성공 유지 / config-missing 이면 되돌림 / DB 접속 실패는 유지), mode=env·crypto, 4.x context-crypto.xml,
//   generate_egovframe_deploy 가 자리표시자를 Secret 자리로, MCP·CLI 노출
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-externalize-"));
let k = 0;
const project = (files) => { const d = path.join(root, `p${k++}`); for (const [rel, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); } return d; };
const read = (d, rel) => readFileSync(path.join(d, rel), "utf8");

const WAR_POM = "<project><parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.2</version></parent><artifactId>webapp</artifactId><version>1.0</version><packaging>war</packaging></project>";
const BOOT_POM = "<project><parent><groupId>org.egovframe.boot</groupId><artifactId>egovframe-boot-starter-parent</artifactId><version>5.0.2</version></parent><artifactId>bootapp</artifactId><version>1.0</version><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>";
const G = "src/main/resources/egovframework/egovProps/globals.properties";
const C = "src/main/resources/egovframework/egovProps/conf/egov-crypto-config.properties";
const DS = "src/main/resources/egovframework/spring/com/context-datasource.xml";
const ENC = "xz4fmrSdr1vGGl6UtwPLwA%3D%3D";
const GLOBALS = `Globals.DbType = hsql\r\nGlobals.UserName = pst\r\nGlobals.Password = pst01\r\nGlobals.mysql.Password = ${ENC}\r\nGlobals.hsql.Password=\r\nldap.password = ******\r\nGlobals.File.algorithmKey = egovframe\r\nGlobals.fileStorePath = /tmp\r\n`;
const CRYPTO = "# egov-crypto\nid = egovCryptoConfig\ncrypto = true\nalgorithm = SHA-256\nalgorithmKey = egovframe\nalgorithmKeyHash = gdyYs/IZqY86VcWhT8emCYfqY1ahw2vtLG+/FzNqtrQ=\ncryptoBlockSize = 1024\n";
const DATASOURCE = `<?xml version="1.0" encoding="UTF-8"?>\n<beans>\n  <bean id="propertyConfigurer" class="org.springframework.beans.factory.config.PropertyPlaceholderConfigurer"/>\n  <bean id="dataSource-mysql" class="com.zaxxer.hikari.HikariDataSource">\n    <property name="username" value="\${Globals.UserName}"/>\n    <property name="password" value="\${Globals.Password}"/>\n  </bean>\n  <bean id="reportDs" class="com.zaxxer.hikari.HikariDataSource">\n    <property name="username" value="rpt"/>\n    <property name="password" value="rpt-secret-1"/>\n  </bean>\n  <!--\n  <bean id="oldDs" class="x">\n    <property name="password" value="commented-out"/>\n  </bean>\n  -->\n  <bean id="enc" class="y"><property name="password" value="#{egovPasswordResolver.resolvePassword('Globals.mysql.Password')}"/></bean>\n</beans>\n`;
const JAVA = { "src/main/java/egovframework/com/cmm/web/EgovFileMngController.java": 'package egovframework.com.cmm.web;\npublic class EgovFileMngController { public static final String ALGORITHM_KEY = EgovProperties.getProperty("Globals.File.algorithmKey"); }\n', "src/main/java/egovframework/com/cmm/util/EgovPasswordResolver.java": "package egovframework.com.cmm.util;\npublic class EgovPasswordResolver { public String resolvePassword(String k) { return EgovProperties.getProperty(k); } }\n" };
const YML = "src/main/resources/application.yml";
const classic = (extra = {}) => project({ "pom.xml": WAR_POM, [G]: GLOBALS, [C]: CRYPTO, [DS]: DATASOURCE, [YML]: "spring:\n  datasource:\n    password: \"yamlpw9\"\n    username: app\n", "src/main/resources/egovframework/message/com/message-common.properties": "fail.common.password=비밀번호가 틀립니다\n", "docker-compose.yml": "services:\n  db:\n    environment:\n      MYSQL_ROOT_PASSWORD: rootpw1\n", ...JAVA, ...extra });

// ── 찾기·계획(dryRun) ────────────────────────────────
{
  const d = classic();
  const r = await m.externalizeConfig({ projectDir: d });
  const by = (file, key) => r.findings.find((f) => f.file === file && f.key === key);
  assert(r.dryRun && r.runtime === "tomcat" && r.summary.found === 8 && r.summary.env === 3 && r.summary.cryptoPath === 2 && r.summary.encrypted === 1 && r.summary.manual === 2, `찾기: 8건 — env 3(Globals.Password·XML 리터럴·yml) · 암호화 키 2 · 암호화 값 1 · 수동 2 (${JSON.stringify(r.summary)})`);
  assert(by(G, "Globals.Password")?.action === "env" && by(G, "Globals.Password").envName === "EGOV_PASSWORD" && by(G, "Globals.Password").format === "properties", "globals.properties 평문 → ${EGOV_PASSWORD}");
  assert(by(G, "Globals.mysql.Password")?.action === "encrypted" && by(G, "Globals.mysql.Password").directReaders.length === 0, "암호화 값은 그대로(키 외부화로 보호)");
  assert(by(G, "Globals.File.algorithmKey")?.action === "manual" && /EgovFileMngController/.test(by(G, "Globals.File.algorithmKey").reason) && by(G, "Globals.File.algorithmKey").directReaders.includes("src/main/java/egovframework/com/cmm/web/EgovFileMngController.java"), "EgovProperties 로 직접 읽는 키는 수동(읽는 파일 명시)");
  assert(!by(G, "Globals.hsql.Password") && !by(G, "ldap.password") && !r.findings.some((f) => /message-common/.test(f.file)), "빈 값·가린 값(******)·메시지 번들은 대상 아님(보안약점 규칙과 같음)");
  assert(by(DS, "reportDs.password")?.action === "env" && by(DS, "reportDs.password").line === 10 && by(DS, "reportDs.password").envName === "EGOV_REPORTDS_PASSWORD" && !r.findings.some((f) => f.file === DS && f.line !== 10), "XML: 리터럴 비밀번호만(자리표시자·SpEL·주석 안 제외), 빈 id 로 이름");
  assert(by(YML, "spring.datasource.password")?.action === "env" && by(YML, "spring.datasource.password").format === "yaml" && by(YML, "spring.datasource.password").envName === "SPRING_DATASOURCE_PASSWORD", "yml 값 → 점 경로 키 → 환경 변수");
  assert(by(C, "algorithmKey")?.action === "crypto-path" && by(C, "algorithmKeyHash")?.action === "crypto-path" && by(C, "algorithmKey").envName === "EGOV_CRYPTO_CONFIG", "egov-crypto-config.properties 의 키·해시 → 외부 파일 경로");
  assert(by("docker-compose.yml", "services.db.environment.MYSQL_ROOT_PASSWORD")?.action === "manual" && /compose/.test(by("docker-compose.yml", "services.db.environment.MYSQL_ROOT_PASSWORD").reason), "배포 정의 파일의 값은 수동(앱 설정이 아님)");
  assert(r.findings.every((f) => !/pst01|rpt-secret-1|yamlpw9|rootpw1/.test(JSON.stringify(f))) && !/pst01|rpt-secret-1|yamlpw9|rootpw1/.test(JSON.stringify(r)) && !/pst01|rpt-secret/.test(m.renderExternalizeMarkdown(r)), "결과·Markdown 에 원래 값 없음(가린 값만)");
  assert(r.env.map((e) => e.name).join(",") === "SPRING_DATASOURCE_PASSWORD,EGOV_PASSWORD,EGOV_REPORTDS_PASSWORD,EGOV_CRYPTO_CONFIG" && r.env.find((e) => e.name === "EGOV_CRYPTO_CONFIG").example.startsWith("file:"), "환경 변수 목록·예시");
  assert(r.files.length === 4 && r.files.find((f) => f.path === G).changes.some((c) => c.after.includes("Globals.CryptoConfigPath=${EGOV_CRYPTO_CONFIG:}")) && r.generated[0] === "deploy/secrets/egov-crypto-config.properties.example", "계획: 파일 4(globals·crypto·XML·yml), CryptoConfigPath 추가, 외부 본 예시");
  assert(read(d, G) === GLOBALS && !existsSync(path.join(d, "migration-backup")) && !existsSync(path.join(d, "deploy")) && r.notes.some((x) => /dryRun=false/.test(x)), "dryRun 무기록");
  assert(r.secureCoding.before === 4 && r.secureCoding.after === null, `보안약점 규칙 전 ${r.secureCoding.before}(globals 2·yml 1·compose 1)`);
  // 화이트리스트: 보안약점 점검의 예외 파일이 그대로 적용
  writeFileSync(path.join(d, ".egovframe-secure-ignore.json"), JSON.stringify({ ignores: [{ rule: "hardcoded-config-password", path: YML, reason: "테스트용 로컬 DB 비밀번호", reviewer: "보안담당" }] }));
  const r2 = await m.externalizeConfig({ projectDir: d });
  assert(r2.summary.found === 7 && !r2.findings.some((f) => f.file === YML) && r2.secureCoding.before === 3, "화이트리스트(.egovframe-secure-ignore.json)로 뺀 항목은 외부화 대상도 아님");
  // paths 로 좁히기
  const r3 = await m.externalizeConfig({ projectDir: d, paths: ["src/main/resources/egovframework/spring"] });
  assert(r3.summary.found === 1 && r3.findings[0].file === DS, "paths 로 좁히기");
  rmSync(d, { recursive: true, force: true });
}

// ── 적용 ─────────────────────────────────────────────
{
  const d = classic({ "deploy/.env.example": "# compose vars\nBASE_REGISTRY=docker.io/library\nDB_PASSWORD=CHANGE_ME\n", "deploy/docker-compose.yml": "name: app\nservices:\n  app:\n    image: app:1\n    environment:\n      TZ: Asia/Seoul\n    restart: unless-stopped\n", "deploy/k8s/app.yaml": "---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: app-secret\ntype: Opaque\nstringData:\n  DB_PASSWORD: 'CHANGE_ME'\n---\napiVersion: apps/v1\nkind: Deployment\n" });
  const r = await m.externalizeConfig({ projectDir: d, dryRun: false });
  assert(!r.dryRun && r.backupDir && existsSync(r.planPath) && r.summary.env === 3, "적용: 백업·plan");
  const g = read(d, G);
  assert(g.includes("Globals.Password = ${EGOV_PASSWORD}\r\n") && g.includes(`Globals.mysql.Password = ${ENC}\r\n`) && g.includes("Globals.File.algorithmKey = egovframe\r\n") && /\r\nGlobals\.CryptoConfigPath=\$\{EGOV_CRYPTO_CONFIG:\}\r\n$/.test(g) && !g.includes("pst01"), "globals: 값만 자리표시자(CRLF·구분자 보존), 암호화 값·수동 키 그대로, CryptoConfigPath 끝에 추가");
  const c = read(d, C);
  assert(/^# algorithmKey = \(/m.test(c) && /^# algorithmKeyHash = \(/m.test(c) && !c.includes("egovframe\n") && !c.includes("gdyYs") && c.includes("cryptoBlockSize = 1024"), "crypto config: 키·해시 줄만 주석, 나머지 그대로");
  const ds = read(d, DS);
  assert(ds.includes('<property name="password" value="${EGOV_REPORTDS_PASSWORD}"/>') && ds.includes('value="commented-out"') && ds.includes("resolvePassword('Globals.mysql.Password')") && !ds.includes("rpt-secret-1"), "XML: 리터럴만 교체, 주석·SpEL 그대로");
  assert(read(d, YML) === "spring:\n  datasource:\n    password: ${SPRING_DATASOURCE_PASSWORD}\n    username: app\n", "yml: 따옴표 값 → 자리표시자");
  const ex = read(d, "deploy/secrets/egov-crypto-config.properties.example");
  assert(ex.includes("algorithmKey = CHANGE_ME") && ex.includes("algorithmKeyHash = CHANGE_ME") && ex.includes("cryptoBlockSize = 1024") && ex.includes("base64(sha256") && !ex.includes("gdyYs"), "외부 본 예시: 키·해시는 CHANGE_ME, 해시 계산법 안내");
  assert(/SPRING_DATASOURCE_PASSWORD=CHANGE_ME\nEGOV_PASSWORD=CHANGE_ME\nEGOV_REPORTDS_PASSWORD=CHANGE_ME\nEGOV_CRYPTO_CONFIG=file:\/run\/egov\/egov-crypto-config\.properties\n$/.test(read(d, "deploy/.env.example")), ".env.example 에 변수 추가");
  const compose = read(d, "deploy/docker-compose.yml");
  assert(compose.includes('      EGOV_PASSWORD: "${EGOV_PASSWORD:-CHANGE_ME}"\n') && compose.includes('      EGOV_CRYPTO_CONFIG: "${EGOV_CRYPTO_CONFIG:-file:/run/egov/egov-crypto-config.properties}"') && compose.includes("    volumes:\n      - ./secrets/egov-crypto-config.properties:/run/egov/egov-crypto-config.properties:ro\n    restart:") && compose.includes("      TZ: Asia/Seoul"), "compose: app environment 에 변수, 암호화 설정 파일 볼륨");
  assert(read(d, "deploy/k8s/app.yaml").includes("stringData:\n  SPRING_DATASOURCE_PASSWORD: 'CHANGE_ME'\n  EGOV_PASSWORD: 'CHANGE_ME'\n  EGOV_REPORTDS_PASSWORD: 'CHANGE_ME'\n  EGOV_CRYPTO_CONFIG: 'file:/run/egov/egov-crypto-config.properties'\n  DB_PASSWORD: 'CHANGE_ME'"), "k8s Secret stringData 에 변수");
  assert(r.deployUpdated.join(",") === "deploy/.env.example,deploy/docker-compose.yml,deploy/k8s/app.yaml", `배포 산출물 갱신 목록 (${r.deployUpdated})`);
  assert(readFileSync(path.join(r.backupDir, G), "utf8") === GLOBALS && readFileSync(path.join(r.backupDir, C), "utf8") === CRYPTO && readFileSync(path.join(r.backupDir, "deploy/.env.example"), "utf8").startsWith("# compose vars"), "백업에 원본(비밀 값 포함)");
  const plan = readFileSync(r.planPath, "utf8");
  assert(!/pst01|rpt-secret-1|yamlpw9/.test(plan) && JSON.parse(plan).summary.env === 3 && !/pst01|rpt-secret-1|yamlpw9/.test(JSON.stringify(r)), "plan·결과에 원래 값 없음");
  assert(r.secureCoding.before === 4 && r.secureCoding.after === 2, `보안약점 규칙 ${r.secureCoding.before} → ${r.secureCoding.after}(남은 2 = 암호화 값·배포 정의 파일)`);
  // 멱등
  const again = await m.externalizeConfig({ projectDir: d, dryRun: false });
  assert(again.summary.env === 0 && again.summary.cryptoPath === 0 && again.summary.files === 0 && !again.backupDir && again.summary.manual === 2, "멱등: 두 번째는 바꿀 것 없음(암호화 값·수동 항목만 남음)");
  const md = m.renderExternalizeMarkdown(r);
  assert(md.includes("## 환경 변수") && md.includes("`EGOV_PASSWORD` ← `Globals.Password`") && md.includes("## 수동 항목") && md.includes("비밀 값 포함"), "Markdown");
  rmSync(d, { recursive: true, force: true });
  // fault injection → 아무것도 남지 않음
  const d2 = classic();
  let threw = false;
  try { await m.externalizeConfig({ projectDir: d2, dryRun: false, faultInjection: "after-files" }); } catch { threw = true; }
  assert(threw && read(d2, G) === GLOBALS && read(d2, C) === CRYPTO && !existsSync(path.join(d2, "deploy")) && !existsSync(path.join(d2, "migration-backup")), "transaction 실패 → 원상 복구");
  rmSync(d2, { recursive: true, force: true });
}

// ── mode ─────────────────────────────────────────────
{
  const d = classic();
  const env = await m.externalizeConfig({ projectDir: d, mode: "env" });
  assert(env.summary.env === 3 && env.summary.cryptoPath === 0 && env.findings.filter((f) => f.kind === "crypto-key").every((f) => f.action === "manual") && !env.generated.length, "mode=env: 자리표시자만, 키 파일은 수동");
  const cr = await m.externalizeConfig({ projectDir: d, mode: "crypto" });
  assert(cr.summary.env === 0 && cr.summary.cryptoPath === 2 && cr.files.length === 2 && cr.files.every((f) => f.path === G || f.path === C), "mode=crypto: 키 파일 외부화만(globals 에는 CryptoConfigPath 만)");
  rmSync(d, { recursive: true, force: true });
  // 4.x: context-crypto.xml 의 키 → 수동, 암호화 값은 보호 못 함(안내)
  const d4 = project({ "pom.xml": "<project><properties><egovframework.rte.version>4.3.0</egovframework.rte.version></properties><artifactId>a</artifactId><version>1</version><packaging>war</packaging></project>", [G]: `Globals.mysql.Password = ${ENC}\n`, "src/main/resources/egovframework/spring/com/context-crypto.xml": '<beans xmlns:egov-crypto="http://maven.egovframe.go.kr/schema/egov-crypto">\n  <egov-crypto:config id="egovCryptoConfig" initial="true" crypto="true" algorithm="SHA-256" algorithmKey="egovframe" algorithmKeyHash="gdyYs/IZqY86VcWhT8emCYfqY1ahw2vtLG+/FzNqtrQ=" cryptoBlockSize="1024"/>\n</beans>\n' });
  const r4 = await m.externalizeConfig({ projectDir: d4 });
  assert(r4.findings.some((f) => f.key === "egov-crypto:config/algorithmKey" && f.action === "manual" && /4\.x/.test(f.reason)) && r4.findings.find((f) => f.key === "Globals.mysql.Password").action === "encrypted" && /4\.x/.test(r4.findings.find((f) => f.key === "Globals.mysql.Password").reason) && r4.summary.files === 0 && r4.notes.some((x) => /5\.x 전환/.test(x)), "4.x: 네임스페이스 키는 수동, 암호화 값은 그대로(egov-crypto 가 직접 읽음) — 바꿀 파일 없음, 5.x 전환 뒤 안내");
  rmSync(d4, { recursive: true, force: true });
}

// ── verify(가짜 runner, Boot) ─────────────────────────
{
  const proc = (log, opt = {}) => async (cmd, o) => { o.onData(log); if (opt.exit !== undefined) return { exitCode: opt.exit, timedOut: false }; await new Promise((r) => { if (o.signal?.aborted) r(); else o.signal?.addEventListener("abort", r, { once: true }); }); return { exitCode: null, timedOut: false, aborted: true }; };
  const boot = () => project({ "pom.xml": BOOT_POM, "src/main/resources/application.properties": "server.port=8080\nspring.datasource.url=jdbc:mysql://127.0.0.1:3306/app\nspring.datasource.username=app\nspring.datasource.password=bootpw77\n" });
  const d = boot();
  const seen = [];
  const ok = await m.externalizeConfig({ projectDir: d, dryRun: false, verify: true, platform: "linux", runner: async (c, o) => { seen.push(c); return proc("Started App in 2.1 seconds (process running for 3)\n")(c, o); }, httpProbe: async () => 200 });
  assert(ok.runtime === "boot" && ok.verify.ran && ok.verify.success === true && !ok.rolledBack && seen[0].env.SPRING_DATASOURCE_PASSWORD === "bootpw77" && ok.verify.env.join() === "SPRING_DATASOURCE_PASSWORD" && !JSON.stringify(ok).includes("bootpw77"), "verify: 원래 값을 환경 변수로 주고 기동 성공 → 유지(값은 결과에 없음)");
  assert(read(d, "src/main/resources/application.properties").includes("spring.datasource.password=${SPRING_DATASOURCE_PASSWORD}\n"), "Boot: spring.datasource.password → ${SPRING_DATASOURCE_PASSWORD}");
  rmSync(d, { recursive: true, force: true });
  const d2 = boot();
  const bad = await m.externalizeConfig({ projectDir: d2, dryRun: false, verify: true, platform: "linux", runner: proc("Caused by: java.lang.IllegalArgumentException: Could not resolve placeholder 'SPRING_DATASOURCE_PASSWORD' in value \"${SPRING_DATASOURCE_PASSWORD}\"\n\n***************************\nAPPLICATION FAILED TO START\n***************************\n", { exit: 1 }), httpProbe: async () => 200 });
  assert(bad.verify.success === false && bad.verify.cause.kind === "config-missing" && bad.rolledBack === true && read(d2, "src/main/resources/application.properties").includes("spring.datasource.password=bootpw77\n") && existsSync(bad.backupDir) && bad.notes.some((x) => /되돌렸습니다/.test(x)), "verify: 설정 해석 실패(config-missing) → 파일 되돌림(백업은 유지)");
  rmSync(d2, { recursive: true, force: true });
  const d3 = boot();
  const db = await m.externalizeConfig({ projectDir: d3, dryRun: false, verify: true, platform: "linux", runner: proc("Caused by: java.net.ConnectException: Connection refused\nCaused by: com.mysql.cj.jdbc.exceptions.CommunicationsException: Communications link failure\n\n***************************\nAPPLICATION FAILED TO START\n***************************\n", { exit: 1 }), httpProbe: async () => 200 });
  assert(db.verify.success === false && db.verify.cause.kind !== "config-missing" && !db.rolledBack && read(d3, "src/main/resources/application.properties").includes("${SPRING_DATASOURCE_PASSWORD}") && db.notes.some((x) => /설정 해석 단계는 지났습니다/.test(x)), `verify: 설정과 무관한 실패(${db.verify.cause.kind})는 적용 유지`);
  rmSync(d3, { recursive: true, force: true });
}

// ── generate_egovframe_deploy 연계: 자리표시자 → Secret 자리 ─────────
{
  const d = project({ "pom.xml": BOOT_POM, "src/main/resources/application.properties": "server.port=8080\nspring.datasource.url=jdbc:mysql://127.0.0.1:3306/app\nspring.datasource.username=app\nspring.datasource.password=${SPRING_DATASOURCE_PASSWORD}\napp.api.secret=${EGOV_API_SECRET}\napp.name=${APP_NAME:demo}\n", [G]: "Globals.CryptoConfigPath=${EGOV_CRYPTO_CONFIG:}\n" });
  const a = m.analyzeDeploy(d);
  assert(a.profile.secretEnv.join(",") === "EGOV_API_SECRET,EGOV_CRYPTO_CONFIG,SPRING_DATASOURCE_PASSWORD", `analyzeDeploy.secretEnv (${a.profile.secretEnv})`);
  const o = { jdk: "17", imageRegistry: "docker.io/library", buildInImage: true, image: "app:1" };
  const compose = m.renderCompose(a.profile, o), envx = m.renderEnvExample(a.profile, o), k8s = m.renderKubernetes(d, a.profile, o);
  assert(compose.includes('      EGOV_API_SECRET: "${EGOV_API_SECRET:-CHANGE_ME}"') && compose.includes('      EGOV_CRYPTO_CONFIG: "${EGOV_CRYPTO_CONFIG:-file:/run/egov/egov-crypto-config.properties}"') && (compose.match(/SPRING_DATASOURCE_PASSWORD:/g) ?? []).length === 1, "compose: 자리표시자 비밀 변수 자리(DB 비밀번호와 중복 없음)");
  assert(envx.includes("DB_PASSWORD=CHANGE_ME\nEGOV_API_SECRET=CHANGE_ME\nEGOV_CRYPTO_CONFIG=file:/run/egov/egov-crypto-config.properties\n"), ".env.example 에 자리표시자 변수");
  const secretDoc = k8s.split("---").find((x) => /kind: Secret/.test(x)) ?? "", cmDoc = k8s.split("---").find((x) => /kind: ConfigMap/.test(x)) ?? "";
  assert(secretDoc.includes("  EGOV_API_SECRET: 'CHANGE_ME'") && secretDoc.includes("  EGOV_CRYPTO_CONFIG: 'file:/run/egov/egov-crypto-config.properties'") && !cmDoc.includes("EGOV_API_SECRET"), "k8s: Secret 에만(ConfigMap 아님)");
  rmSync(d, { recursive: true, force: true });
}

// ── 도우미 ───────────────────────────────────────────
assert(m.envNameForKey("Globals.mysql.Password") === "EGOV_MYSQL_PASSWORD" && m.envNameForKey("Globals.Password") === "EGOV_PASSWORD" && m.envNameForKey("spring.datasource.password") === "SPRING_DATASOURCE_PASSWORD" && m.envNameForKey("dataSource.password") === "DATASOURCE_PASSWORD" && m.envNameForKey("1st.key") === "EGOV_1ST_KEY", "환경 변수 이름 규칙");
assert(m.looksEgovEncrypted(ENC) && m.looksEgovEncrypted("xz4fmrSdr1vGGl6UtwPLwA==") && !m.looksEgovEncrypted("pst01") && !m.looksEgovEncrypted("password123") && !m.looksEgovEncrypted("qN3IfdTb5F7e7IIdIMG1jt9YLiOwon3i1aG9mYY7lsYa") && m.algorithmKeyHash("egovframe") === "gdyYs/IZqY86VcWhT8emCYfqY1ahw2vtLG+/FzNqtrQ=" && m.maskSecret("pst01") === "ps***" && m.maskSecret("a") === "***", "암호화 값 모양·키 해시(base64(sha256))·가리기");

{
  const d = project({ "pom.xml": WAR_POM, [G]: "Globals.Password = one1\nGlobals.password = two2\nGlobals.PASSWORD = one1\n" });
  const r = await m.externalizeConfig({ projectDir: d });
  assert(r.findings.map((f) => f.envName).join() === "EGOV_PASSWORD,EGOV_PASSWORD_2,EGOV_PASSWORD" && r.env.length === 2 && r.env[0].keys.join() === "Globals.Password,Globals.PASSWORD", "같은 환경 변수 이름: 값이 같으면 공유, 다르면 _2");
  rmSync(d, { recursive: true, force: true });
}

// ── MCP·CLI ──────────────────────────────────────────
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  const tools = (await client.listTools()).tools;
  const t = tools.find((x) => x.name === "externalize_egovframe_config");
  assert(t && t.annotations.destructiveHint === true && t.annotations.openWorldHint === false && t.inputSchema.properties.dryRun.default === true && t.inputSchema.properties.mode.enum.join() === "auto,env,crypto" && t.outputSchema && tools.length >= 40, `MCP: 등록됨, 파괴적, dryRun 기본, outputSchema`);
  const d = classic();
  const res = await client.callTool({ name: "externalize_egovframe_config", arguments: { projectDir: d, format: "json" } });
  assert(!res.isError && res.structuredContent.summary.found === 8 && !JSON.stringify(res).includes("pst01"), "MCP 호출: 구조화 출력, 값 없음");
  rmSync(d, { recursive: true, force: true });
  await client.close(); await server.close();
  const { CLI_COMMANDS } = m;
  assert(CLI_COMMANDS && Object.keys(CLI_COMMANDS).includes("externalize") && CLI_COMMANDS.externalize.tool === "externalize_egovframe_config" && CLI_COMMANDS.externalize.blocked.includes("dryRun"), "CLI externalize(--write 없으면 계획만)");
}

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`externalize FAIL (${n} assertions)`); else console.log(`externalize OK (${n} assertions)`);
