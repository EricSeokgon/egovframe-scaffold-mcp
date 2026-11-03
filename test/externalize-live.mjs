// node test/externalize-live.mjs — 설정·비밀값 외부화(v1.13) 실자산 검증 (CI 통합: 네트워크·Maven·JDK 17)
//   (1) 공식 portal-site(Classic): Globals.Password 평문 → ${EGOV_PASSWORD}, egov-crypto-config.properties 의 키 → 외부 파일(Globals.CryptoConfigPath),
//       verify=true 로 원래 값을 환경 변수로 주고 실제 기동 통과(내장 HSQL), 보안약점 hardcoded-config-password 감소, 결과에 원래 값 없음
//   (2) 공식 web·boot-web: 비밀 값 0(web 의 context-datasource.xml 리터럴은 주석 안 — 오탐 없음)
//   (3) 공식 공통컴포넌트 코퍼스 4.3.2·3.10.0: 암호화 값은 그대로(4.x 는 egov-crypto 가 파일을 직접 읽음), 키는 수동 1, 3.10.0 의 SNS 비밀 2건은 자리표시자 대상
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCorpus, materializeEntry } from "../scripts/corpus-lib.mjs";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-externalize-live-"));
const mk = (template) => m.createProject({ template, projectName: `ex-${template}`, groupId: "egovframework.example", outputDir: root, database: "hsql" }).then((c) => c.projectPath);
const G = "src/main/resources/egovframework/egovProps/globals.properties";
const C = "src/main/resources/egovframework/egovProps/conf/egov-crypto-config.properties";

try {
  // (1) portal-site
  const portal = await mk("portal-site");
  const before = readFileSync(path.join(portal, G), "utf8");
  const dry = await m.externalizeConfig({ projectDir: portal });
  info(`portal-site 계획: ${JSON.stringify(dry.summary)} · 보안약점 ${dry.secureCoding.before}`);
  assert(dry.runtime === "tomcat" && dry.findings.some((f) => f.key === "Globals.Password" && f.action === "env" && f.envName === "EGOV_PASSWORD") && dry.findings.filter((f) => f.file === C && f.action === "crypto-path").length === 2 && dry.findings.some((f) => f.key === "Globals.File.algorithmKey" && f.action === "manual"), "portal-site: Globals.Password → env, 암호화 키 2 → 외부 파일, 첨부파일 키는 수동(직접 읽음)");
  assert(readFileSync(path.join(portal, G), "utf8") === before && !existsSync(path.join(portal, "migration-backup")), "dryRun 무기록");
  const t0 = Date.now();
  const r = await m.externalizeConfig({ projectDir: portal, dryRun: false, verify: true, timeoutMs: 600_000 });
  info(`portal-site 적용+기동: ${r.verify?.success ? "기동" : `실패 ${r.verify?.cause?.kind}: ${r.verify?.cause?.summary?.slice(0, 160)}`} · ${Math.round((Date.now() - t0) / 1000)}초 · 보안약점 ${r.secureCoding.before} → ${r.secureCoding.after}`);
  assert(r.verify?.ran && r.verify.success === true && !r.rolledBack, `원래 값을 환경 변수(${r.verify?.env.join(", ")})로 주고 실제 기동 통과${r.verify?.success ? "" : `\n${r.verify?.cause?.hint ?? ""}`}`);
  const g = readFileSync(path.join(portal, G), "utf8");
  assert(g.includes("Globals.Password = ${EGOV_PASSWORD}") && /^Globals\.CryptoConfigPath=\$\{EGOV_CRYPTO_CONFIG:\}/m.test(g) && !g.includes("= pst01"), "globals.properties: 자리표시자·CryptoConfigPath");
  const c = readFileSync(path.join(portal, C), "utf8");
  assert(/^# algorithmKey = /m.test(c) && !/^algorithmKey\s*=/m.test(c) && existsSync(path.join(portal, "deploy/secrets/egov-crypto-config.properties.example")), "crypto config 의 키 줄 제거, 외부 본 예시 생성");
  assert(r.secureCoding.after !== null && r.secureCoding.after < r.secureCoding.before && !JSON.stringify(r).includes("pst01") && !readFileSync(r.planPath, "utf8").includes("pst01") && readFileSync(path.join(r.backupDir, G), "utf8") === before, "보안약점 감소, 결과·plan 에 원래 값 없음, 백업에 원본");
  const again = await m.externalizeConfig({ projectDir: portal });
  assert(again.summary.env === 0 && again.summary.cryptoPath === 0, "멱등: 다시 실행하면 바꿀 것 없음");

  // (2) web·boot-web — 오탐 없음
  for (const t of ["web", "boot-web"]) {
    const d = await mk(t);
    const x = await m.externalizeConfig({ projectDir: d });
    assert(x.summary.found === 0, `${t}: 비밀 값 0(주석 안 리터럴은 제외) (${JSON.stringify(x.summary)})`);
  }

  // (3) 코퍼스
  const corpus = loadCorpus();
  const expect = { "cc-4.3.2": { encrypted: 8, env: 0, manual: 1 }, "cc-3.10.0": { encrypted: 7, env: 2, manual: 1 } };
  for (const [id, e] of Object.entries(expect)) {
    const entry = corpus.entries.find((x) => x.id === id);
    const { dir } = materializeEntry(corpus, entry);
    const x = await m.externalizeConfig({ projectDir: dir });
    info(`${id}: ${JSON.stringify(x.summary)}`);
    assert(x.summary.encrypted === e.encrypted && x.summary.env === e.env && x.summary.manual === e.manual && x.summary.files === (e.env ? 1 : 0) && x.findings.some((f) => f.key === "egov-crypto:config/algorithmKey" && f.action === "manual"), `${id}: 암호화 값 ${e.encrypted} 그대로 · 자리표시자 ${e.env} · 수동 ${e.manual}(4.x 암호화 키)`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`externalize-live FAIL (${n} assertions)`); else console.log(`externalize-live OK (${n} assertions)`);
