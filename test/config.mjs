// node test/config.mjs — 설정 파일 생성(generate_egovframe_config) 오프라인 검증
import {
  CONFIG_FORMATS,
  CONFIG_EXTENSIONS,
  loadConfigCatalog,
  getConfigTemplate,
  describeConfigTemplates,
  validateConfigFields,
  renderConfig,
  resolveFileName,
  defaultOutputDir,
  generateConfig,
  templateSha256,
} from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

let checks = 0;
function assert(c, m) { checks++; if (!c) { console.error("FAIL:", m); process.exitCode = 1; } }
const rejects = (fn, re, m) => { let err; try { fn(); } catch (e) { err = e; } assert(err && re.test(err.message), `${m} — ${err ? err.message.slice(0, 120) : "예외 없음"}`); };

const catalog = loadConfigCatalog();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ── 1. 카탈로그 무결성 ─────────────────────────────── */
assert(catalog.schemaVersion === 1, "schemaVersion 1");
assert(/^[0-9a-f]{40}$/.test(catalog.source.commit), "Initializr commit 고정");
assert(catalog.source.license === "Apache-2.0", "출처 라이선스 기록");
assert(catalog.entries.length === 21, `설정 템플릿 21종 — 실제 ${catalog.entries.length}`);
assert(new Set(catalog.entries.map((e) => e.id)).size === 21, "id 중복 없음");
assert(existsSync(path.join(ROOT, "catalog", "config-templates", "NOTICE.md")), "동봉 템플릿 NOTICE 존재");
let files = 0;
for (const e of catalog.entries) {
  assert(/^[a-z0-9-]+$/.test(e.id), `id 형식: ${e.id}`);
  assert(Object.keys(e.formats).length >= 1 && Object.keys(e.formats).every((f) => CONFIG_FORMATS.includes(f)), `형식 유효: ${e.id}`);
  assert(e.formats.xml, `xml 형식은 전 템플릿 제공: ${e.id}`);
  assert(e.fields.every((f) => f in e.defaults), `모든 변수에 기본값: ${e.id}`);
  assert(!e.fields.includes("txtFileName"), `txtFileName 은 변수 목록에서 제외: ${e.id}`);
  assert(/^[A-Z]/.test(e.defaultFileName.javaConfig) && e.defaultFileName.xml.length > 0, `기본 파일명: ${e.id}`);
  for (const [format, spec] of Object.entries(e.formats)) {
    const p = path.join(ROOT, "catalog", "config-templates", spec.file);
    assert(existsSync(p), `동봉 파일 존재: ${spec.file}`);
    const actual = templateSha256(readFileSync(p, "utf8"));
    assert(actual === spec.sha256, `동봉 파일 지문 일치: ${spec.file}`);
    assert(templateSha256(readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n")) === spec.sha256, `CRLF 체크아웃에서도 지문 일치: ${spec.file}`);
    files++;
  }
  for (const [field, allowed] of Object.entries(e.enums ?? {})) {
    assert(allowed.includes(String(e.defaults[field])), `기본값이 선택지 안: ${e.id}.${field}`);
  }
}
assert(files === 49, `동봉 템플릿 파일 49개 — 실제 ${files}`);
assert(getConfigTemplate("logging-jdbc").excluded?.[0]?.format === "properties" && !getConfigTemplate("logging-jdbc").formats.properties, "내용이 형식과 다른 upstream 파일은 큐레이션으로 제외");
const timeRolling = getConfigTemplate("logging-time-rolling-file");
assert(!timeRolling.formats.javaConfig && timeRolling.upstreamMissing?.[0]?.format === "javaConfig", "upstream 에 없는 javaConfig 는 제외하고 사유 기록");
assert(["logging-console", "logging-file", "logging-rolling-file", "logging-time-rolling-file"].every((id) => getConfigTemplate(id).formats.yaml && getConfigTemplate(id).formats.properties), "logging 계열은 yaml·properties 제공");
rejects(() => renderConfig("logging-jdbc", "properties"), /XML 내용이라/, "제외 형식은 사유와 함께 거부");

/* ── 2. 전 템플릿·전 형식 기본값 렌더링 ─────────────── */
let rendered = 0;
for (const e of catalog.entries) {
  for (const format of Object.keys(e.formats)) {
    const r = renderConfig(e.id, format);
    rendered++;
    assert(!/\{\{|\}\}/.test(r.content), `자리표시자 잔존 없음: ${e.id}/${format}`);
    assert(r.content.trim().length > 40, `내용 있음: ${e.id}/${format}`);
    if (format === "xml") assert(/^<\?xml|^<!DOCTYPE|^<beans|^<Configuration|^<ehcache|^<config/m.test(r.content.trimStart()), `xml 시작: ${e.id}`);
    if (format === "javaConfig") {
      assert(r.content.includes(`package ${e.defaults.txtConfigPackage};`), `패키지 선언: ${e.id}`);
      assert(r.content.includes(`class ${e.defaultFileName.javaConfig}`), `클래스명 = 기본 파일명: ${e.id}`);
    }
    if (format === "yaml") assert(/^Configuration:/m.test(r.content), `yaml 루트: ${e.id}`);
    if (format === "properties") assert(/^(appender|rootLogger|logger|status|name)\b/m.test(r.content), `properties 키: ${e.id}`);
  }
}
assert(rendered === 49, `렌더링 49건 — 실제 ${rendered}`);

/* ── 3. 분기·필드 덮어쓰기 ──────────────────────────── */
const c3p0 = renderConfig("datasource", "xml", { rdoType: "C3P0", txtPasswd: "pw" });
assert(c3p0.content.includes("ComboPooledDataSource") && c3p0.content.includes('value="pw"'), "C3P0 분기 + 비밀번호 조건부");
const dbcp = renderConfig("datasource", "xml");
assert(dbcp.content.includes("BasicDataSource") && !dbcp.content.includes("password"), "DBCP 기본 + 빈 비밀번호는 생략");
assert(renderConfig("datasource", "xml", { rdoType: "JDBC" }).content.includes("DriverManagerDataSource"), "JDBC 분기");
const jconf = renderConfig("datasource", "javaConfig", { txtConfigPackage: "kr.go.sample.config", txtDatasourceName: "mainDs" });
assert(jconf.content.startsWith("package kr.go.sample.config;") && jconf.content.includes('name = "mainDs"'), "JavaConfig 패키지·bean 이름 덮어쓰기");
assert(renderConfig("logging-jdbc", "xml", { rdoConnectionType: "ConnectionFactory" }).content.includes("<ConnectionFactory"), "logging-jdbc ConnectionFactory 분기");
assert(renderConfig("logging-jdbc", "xml").content.includes('password="log01"'), "logging-jdbc DriverManager 기본(txtPasswd 로 매핑)");
assert(renderConfig("property", "xml", { rdoType: "External File" }).content.includes("config.properties"), "property 외부 파일 분기");
assert(renderConfig("idgen-uuid", "xml", { rdoIdType: "Address" }).content.includes("12:34:56:78:9A:AB"), "uuid Address 분기");
const noAop = renderConfig("transaction-datasource", "xml", { chkAopConfigTransaction: "false" });
assert(!noAop.content.includes("<aop:config") && renderConfig("transaction-datasource", "xml").content.includes("<aop:config"), "boolean 필드는 'false' 문자열도 인식");
assert(renderConfig("transaction-datasource", "xml", { chkAopConfigTransaction: false }).content.includes("<aop:config") === false, "boolean 필드 false 값");
assert(renderConfig("scheduling-cron-trigger", "xml", { txtCronExpression: "0 0 3 * * ?" }).content.includes("0 0 3 * * ?"), "cron 표현식 덮어쓰기");
assert(renderConfig("logging-rolling-file", "yaml", { txtMaxIndex: "7" }).content.includes("max: 7"), "yaml 필드 덮어쓰기");

/* ── 4. 검증·거부 ───────────────────────────────────── */
rejects(() => renderConfig("nope", "xml"), /알 수 없는 설정 템플릿/, "미존재 id 거부");
rejects(() => renderConfig("datasource", "toml"), /format 은/, "미지원 형식 거부");
rejects(() => renderConfig("datasource", "yaml"), /yaml 형식을 제공하지 않습니다/, "템플릿이 없는 형식 거부");
rejects(() => renderConfig("logging-time-rolling-file", "javaConfig"), /upstream 카탈로그는 .* 가리키지만/, "upstream 누락 형식은 사유와 함께 거부");
rejects(() => renderConfig("datasource", "xml", { txtNope: "x" }), /템플릿에 없는 필드/, "알 수 없는 필드 거부");
rejects(() => renderConfig("datasource", "xml", { rdoType: "HikariCP" }), /허용되지 않습니다 \(DBCP\|C3P0\|JDBC\)/, "선택지 밖 값 거부");
const v = validateConfigFields(getConfigTemplate("datasource"), { rdoType: "C3P0", txtUrl: "x", txtConfigPackage: "a.b" });
assert(v.unknown.length === 0 && v.invalidEnum.length === 0, "txtConfigPackage 는 전 템플릿 공통 허용");
rejects(() => resolveFileName(getConfigTemplate("datasource"), "javaConfig", "dataSourceConfig"), /대문자로 시작/, "JavaConfig 클래스명 규칙");
rejects(() => resolveFileName(getConfigTemplate("datasource"), "xml", "../evil"), /fileName 은/, "파일명 경로 문자 거부");
rejects(() => resolveFileName(getConfigTemplate("datasource"), "xml", "a/b"), /fileName 은/, "파일명 슬래시 거부");
assert(resolveFileName(getConfigTemplate("datasource"), "xml") === "context-datasource", "xml 기본 파일명");
assert(resolveFileName(getConfigTemplate("datasource"), "javaConfig") === "EgovDataSourceConfig", "javaConfig 기본 클래스명");
assert(defaultOutputDir(getConfigTemplate("datasource"), "xml", "a.b") === "src/main/resources/egovframework/spring", "xml 기본 위치");
assert(defaultOutputDir(getConfigTemplate("logging-console"), "xml", "a.b") === "src/main/resources", "logging xml 은 리소스 루트");
assert(defaultOutputDir(getConfigTemplate("datasource"), "javaConfig", "kr.go.sample.config") === "src/main/java/kr/go/sample/config", "javaConfig 는 패키지 경로");
assert(defaultOutputDir(getConfigTemplate("logging-console"), "yaml", "a.b") === "src/main/resources", "yaml 위치");
const desc = describeConfigTemplates();
assert(desc.length === 21 && desc.every((d) => d.formats.length && d.fields.length && d.defaults), "리소스용 요약");

/* ── 5. 파일 생성·거부·경로 방어 ────────────────────── */
const proj = mkdtempSync(path.join(tmpdir(), "cfg-"));
writeFileSync(path.join(proj, "pom.xml"), "<project/>");
const dry = generateConfig({ projectDir: proj, configId: "datasource", format: "xml", dryRun: true });
assert(dry.dryRun && !dry.written && !existsSync(dry.absolutePath), "dryRun 무기록");
assert(dry.path === "src/main/resources/egovframework/spring/context-datasource.xml", `dryRun 경로 — ${dry.path}`);
assert(readdirSync(proj).length === 1, "dryRun 은 디렉터리도 만들지 않음");
const w = generateConfig({ projectDir: proj, configId: "datasource", format: "xml", fields: { txtPasswd: "secret" } });
assert(w.written && existsSync(w.absolutePath) && readFileSync(w.absolutePath, "utf8").includes('value="secret"'), "실제 생성");
assert(w.context.txtPasswd === "********" && !JSON.stringify(w.context).includes("secret"), "결과 컨텍스트의 비밀번호 가림");
assert(w.overridden.length === 1 && w.overridden[0] === "txtPasswd", "덮어쓴 필드 보고");
rejects(() => generateConfig({ projectDir: proj, configId: "datasource", format: "xml" }), /이미 존재합니다/, "기존 파일 거부");
assert(readFileSync(w.absolutePath, "utf8").includes('value="secret"'), "거부 시 기존 파일 불변");
const jc = generateConfig({ projectDir: proj, configId: "transaction-jpa", format: "javaConfig", fields: { txtConfigPackage: "kr.go.sample.config" } });
assert(jc.path === "src/main/java/kr/go/sample/config/EgovTransactionJpaConfig.java" && existsSync(jc.absolutePath), `javaConfig 경로 — ${jc.path}`);
const custom = generateConfig({ projectDir: proj, configId: "logging-console", format: "properties", outputDir: "src/main/resources/conf", fileName: "log4j2-dev" });
assert(custom.path === "src/main/resources/conf/log4j2-dev.properties" && existsSync(custom.absolutePath), "outputDir·fileName 지정");
rejects(() => generateConfig({ projectDir: proj, configId: "datasource", format: "xml", outputDir: "../outside" }), /프로젝트 내부의 상대 경로/, "상위 경로 outputDir 거부");
rejects(() => generateConfig({ projectDir: proj, configId: "datasource", format: "xml", outputDir: "/etc" }), /프로젝트 내부의 상대 경로/, "절대 경로 outputDir 거부");
rejects(() => generateConfig({ projectDir: proj, configId: "datasource", format: "xml", outputDir: "src/../../x" }), /프로젝트 내부의 상대 경로|프로젝트 밖/, "중간 .. 거부");
rejects(() => generateConfig({ projectDir: proj, configId: "datasource", format: "javaConfig", fields: { txtConfigPackage: "Kr.Go" } }), /자바 패키지 형식/, "잘못된 패키지 거부");
rejects(() => generateConfig({ projectDir: path.join(proj, "nope"), configId: "datasource", format: "xml" }), /프로젝트 디렉터리가 없습니다/, "없는 프로젝트 거부");
if (process.platform !== "win32") {
  const outside = mkdtempSync(path.join(tmpdir(), "cfg-out-"));
  symlinkSync(outside, path.join(proj, "linked"));
  rejects(() => generateConfig({ projectDir: proj, configId: "datasource", format: "xml", outputDir: "linked/cfg" }), /symlink/, "symlink 로 프로젝트 밖 이탈 거부");
  assert(readdirSync(outside).length === 0, "symlink 거부 시 밖에 아무것도 안 씀");
  rmSync(outside, { recursive: true, force: true });
}
assert(Object.values(CONFIG_EXTENSIONS).join(",") === ".xml,.java,.yaml,.properties", "확장자 매핑");
rmSync(proj, { recursive: true, force: true });

if (process.exitCode) console.error(`config FAIL (${checks} checks)`); else console.log(`config OK (${checks} assertions)`);
