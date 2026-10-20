// node test/i18n.mjs — 응답 영문화(v1.2) 게이트 (오프라인)
//   (1) ko: 대상 도구의 Markdown·문장 필드가 goldens(test/fixtures/i18n-golden-ko.json)와 바이트 단위로 같다 — 영문화가 한국어 출력을 바꾸지 않았음
//   (2) en: 같은 호출의 출력에 한글이 없다(허용 목록: 프로젝트 파일에서 인용한 원문·고유명사)
//   (3) 언어 전환 API: setLang·getLang·L, EGOVFRAME_LANG, CLI --lang
//   goldens 갱신: node test/i18n.mjs --update (렌더러를 의도적으로 바꿨을 때만, diff 를 PR 에서 검토)
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeLegacy, makeModern } from "./fixtures/i18n-fixture.mjs";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const goldenPath = path.join(here, "fixtures/i18n-golden-ko.json");
const update = process.argv.includes("--update");
const root = mkdtempSync(path.join(tmpdir(), "egovi18n-"));
const legacy = makeLegacy(path.join(root, "legacy"));
const modern = makeModern(path.join(root, "modern"));
const fixedNow = () => Date.UTC(2026, 9, 20, 1, 2, 3);
const HANGUL = /[가-힣]/;

// 출력에서 환경에 따라 달라지는 부분만 가린다(경로·실행 시간·버전). 문구는 그대로여야 한다.
const normalize = (s, json = false) => s
  .split(root).join("<root>").split(root.replace(/\\/g, "/")).join("<root>")
  .replace(/\d+(\.\d+)?\s?(ms|초)\b/g, "<t>")
  .replace(/egovframe-scaffold-mcp \d+\.\d+\.\d+/g, "egovframe-scaffold-mcp <v>")
  .replace(/"version": "\d+\.\d+\.\d+"/g, '"version": "<v>"')
  .replace(/urn:uuid:[0-9a-f-]{36}/g, "urn:uuid:<id>")
  .replace(/egov-sbom-[A-Za-z0-9]+/g, "egov-sbom-<tmp>")
  // Windows 경로 구분자(goldens 는 POSIX 에서 생성): JSON 은 이스케이프된 '\\\\', Markdown 은 단어 사이의 '\\' 만
  .replace(json ? /\\\\/g : /(?<=[\w.)-])\\(?=[\w.])/g, "/");

// 한 언어로 전부 실행해 {이름: 정규화한 출력} 을 만든다
async function runAll(lang) {
  m.setLang(lang);
  const out = {};
  const put = (k, v) => { out[k] = typeof v === "string" ? normalize(v) : normalize(JSON.stringify(v, null, 1), true); };
  const mig = m.migrateProject({ projectDir: legacy });
  put("migrate.md", m.renderMigrationMarkdown(mig));
  put("migrate.reasons", mig.items.map((i) => [i.kind, i.action, i.reason]));
  const dep = await m.checkDependencies({ projectDir: legacy });
  put("dependencies.md", m.renderDependencyMarkdown(dep));
  put("dependencies.actions", dep.findings.map((f) => [f.artifactId, f.status, f.action ?? null, f.note ?? null]));
  const dep5 = await m.checkDependencies({ projectDir: modern });
  put("dependencies5.md", m.renderDependencyMarkdown(dep5));
  const as = await m.assessProject({ projectDir: modern, now: fixedNow });
  put("assessment.md", m.renderAssessmentMarkdown(as));
  put("assessment.notes", { migration: as.migration.notes, dependencies: as.dependencies.notes, grades: as.grades });
  const up = m.updateProject({ projectDir: modern });
  put("update.md", m.renderUpdateMarkdown(up));
  put("update.reasons", up.items.map((i) => [i.kind, i.action, i.reason]));
  const sc = await m.checkSecureCoding({ projectDir: modern });
  put("secure.md", m.renderSecureCodingMarkdown(sc));
  put("secure.findings", sc.findings.map((f) => [f.rule, f.guideItem, f.message, f.fix, f.note ?? null]));
  const dp = await m.generateDeploy({ projectDir: modern });
  put("deploy.md", m.renderDeployMarkdown(dp));
  put("deploy.notes", { notes: dp.notes, usage: dp.usage });
  const sbc = await m.checkSbom({ projectDir: modern });
  put("sbom-check.md", m.renderSbomCheckMarkdown(sbc));
  const sb = await m.generateSbom({ projectDir: modern, platform: "linux" });
  put("sbom.md", m.renderSbomMarkdown(sb));
  const dl = await m.prepareDelivery({ projectDir: modern, outputDir: path.join(root, `dl-${lang}`) });
  put("delivery.md", m.renderDeliveryMarkdown(dl));
  const vf = m.verifyDelivery(root);
  put("verify.md", m.renderVerifyMarkdown(vf));
  return out;
}

try {
  const prev = m.getLang();
  const ko = await runAll("ko");
  if (update) { writeFileSync(goldenPath, `${JSON.stringify(ko, null, 2)}\n`); console.log(`goldens 갱신: ${path.relative(process.cwd(), goldenPath)} (${Object.keys(ko).length}개)`); } // portability: ok 표시용 경로
  assert(existsSync(goldenPath), "goldens 존재(test/fixtures/i18n-golden-ko.json)");
  const golden = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, "utf8")) : {};
  for (const k of Object.keys(ko)) {
    const same = golden[k] === ko[k];
    if (!same && golden[k] !== undefined) { const a = golden[k].split("\n"), b = ko[k].split("\n"); const i = a.findIndex((l, j) => l !== b[j]); console.error(`  첫 차이(${k} ${i + 1}행):\n    golden: ${a[i]}\n    now   : ${b[i]}`); }
    assert(same, `ko 바이트 일치: ${k}`);
  }
  assert(Object.keys(golden).every((k) => k in ko), "goldens 의 항목이 전부 실행됨");

  const en = await runAll("en");
  for (const k of Object.keys(en)) {
    const lines = en[k].split("\n").filter((l) => HANGUL.test(l));
    assert(lines.length === 0, `en 한글 없음: ${k}${lines.length ? ` (${lines.length}줄, 예: ${lines[0].trim().slice(0, 100)})` : ""}`);
  }
  assert(en["migrate.md"] !== ko["migrate.md"] && en["assessment.md"].includes("Grade") && en["secure.md"].length > 200, "en 출력은 ko 와 다르고 영문 라벨을 포함");
  m.setLang(prev);

  // 규칙 데이터: 한국어 문장 필드(reason·note·summary·guideItem·message·fix·label·hint·basis·evidence·defaultReason·disclaimer·name)마다 <필드>_en 이 있다
  const SENTENCE_KEYS = new Set(["reason", "replacement", "note", "summary", "guideItem", "message", "fix", "label", "hint", "basis", "evidence", "defaultReason", "disclaimer", "name"]);
  const missingEn = [];
  const walk = (o, p, top) => {
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`, false)); return; }
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && HANGUL.test(v) && SENTENCE_KEYS.has(k) && !(top && (k === "note" || k === "comment")) && !(k === "label" && typeof o.labelEn === "string")) { if (!(typeof o[`${k}_en`] === "string" && o[`${k}_en`] && !HANGUL.test(o[`${k}_en`]))) missingEn.push(`${p}.${k}`); }
      if (k === "externalDatabases" && v && typeof v === "object") for (const [dk, dv] of Object.entries(v)) if (HANGUL.test(String(dv)) && !o.externalDatabases_en?.[dk]) missingEn.push(`${p}.externalDatabases.${dk}`);
      walk(v, `${p}.${k}`, false);
    }
  };
  for (const f of ["migration-mapping", "migration-rules", "update-mapping", "update-rules", "secure-coding-rules", "sbom-rules", "deploy-rules"]) walk(JSON.parse(readFileSync(path.join(here, `../catalog/${f}.json`), "utf8")), f, true);
  assert(missingEn.length === 0, `규칙 데이터의 _en 누락 0${missingEn.length ? ` (${missingEn.length}건, 예: ${missingEn.slice(0, 3).join(", ")})` : ""}`);

  // 언어 전환 API
  assert(m.L("가", "a") === "가" && (m.setLang("en"), m.L("가", "a")) === "a" && m.getLang() === "en", "L(ko, en)·setLang·getLang");
  m.setLang("ko");
  assert(m.langFromEnv({ EGOVFRAME_LANG: "EN" }) === "en" && m.langFromEnv({ EGOVFRAME_LANG: "fr" }) === "ko" && m.langFromEnv({}) === "ko", "langFromEnv: en 만 인식, 나머지 ko");
  // CLI --lang en: 같은 프로세스 안에서 전역 언어를 바꾸고 끝나면 되돌린다
  const io = (cwd) => { const out = [], err = []; return { cwd, env: {}, stdout: (s) => out.push(s), stderr: (s) => err.push(s), out, err }; };
  const i1 = io(modern);
  const c1 = await m.runCli(["secure", "--lang", "en"], i1);
  assert(c1 === 0 && !HANGUL.test(i1.out.join("")) && /weakness/i.test(i1.out.join("")) && m.getLang() === "ko", "CLI --lang en: 영문 응답, 실행 후 언어 복원");
  const i2 = io(modern);
  const c2 = await m.runCli(["secure"], i2);
  assert(c2 === 0 && HANGUL.test(i2.out.join("")), "CLI 기본: 한국어 응답");
  const i3 = io(modern);
  const c3 = await m.runCli(["secure", "--lang", "en"], { ...i3, env: { EGOVFRAME_LANG: "ko" } });
  assert(c3 === 0 && !HANGUL.test(i3.out.join("")), "CLI --lang 이 EGOVFRAME_LANG 보다 우선");
  const i4 = io(modern);
  const c4 = await m.runCli(["secure"], { ...i4, env: { EGOVFRAME_LANG: "en" } });
  assert(c4 === 0 && !HANGUL.test(i4.out.join("")) && m.getLang() === "ko", "CLI: EGOVFRAME_LANG=en 환경이면 영문, 끝나면 복원");
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`i18n FAIL (${n} assertions)`); else console.log(`i18n OK (${n} assertions)`);
