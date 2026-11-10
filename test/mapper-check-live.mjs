// node test/mapper-check-live.mjs — 매퍼·DAO 정합성(v1.19) 실자산 검증 (CI 통합: 네트워크)
//   (1) 공통컴포넌트 v5.0.7: 없는 문장 10곳 = upstream 이 10-26 에 고친 6곳(AdministCodeRecptnDAO·InsttCodeRecptnDAO 4, CnsltManageDAO 1, BndtManage 건수 1)
//       + 아직 고쳐지지 않은 4곳(KnoManagementDAO·KnoAppraisalDAO 의 insert·delete), 이어 만든 ID 1곳은 맞는 문장 있음, DB 별 차이 0, 후보 1순위가 upstream 의 정답
//   (2) 같은 저장소 main: upstream 수정 6곳이 빠지고 4곳만 남음
//   (3) 공식 템플릿 6종: web·boot-web 0, 나머지는 보고한 항목마다 독립 확인(모든 매퍼 XML 의 주석 밖에 그 id 가 없음) — 오탐 0
//   (4) 공통컴포넌트 전체 3초 이내
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-mapper-live-"));
const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const REPO = "https://github.com/eGovFramework/egovframe-common-components.git";
const UPSTREAM_FIXED = ["AdministCodeRecptnDAO.selectAdministCodeList", "AdministCodeRecptnDAO.selectAdministCodeListTotCnt", "InsttCodeRecptnDAO.selectInsttCodeList", "InsttCodeRecptnDAO.selectInsttCodeListTotCnt", "CnsltManageDAO.selectCnsltAnswerListDetail", "bndtManageDAO.selectBndtManageListTotCnt"];
const NOT_FIXED = ["KnoAppraisalDAO.deleteKnoAppraisal", "KnoAppraisalDAO.insertKnoAppraisal", "KnoManagementDAO.deleteKnoManagement", "KnoManagementDAO.insertKnoManagement"];
const UPSTREAM_ANSWER = { "AdministCodeRecptnDAO.selectAdministCodeList": "selectAdministCodeRecptnList", "AdministCodeRecptnDAO.selectAdministCodeListTotCnt": "selectAdministCodeRecptnListTotCnt", "InsttCodeRecptnDAO.selectInsttCodeList": "selectInsttCodeRecptnList", "InsttCodeRecptnDAO.selectInsttCodeListTotCnt": "selectInsttCodeRecptnListTotCnt", "CnsltManageDAO.selectCnsltAnswerListDetail": "selectCnsltAnswerDetail" };
const missingRefs = (r) => r.issues.filter((i) => i.kind === "missing-statement" || i.kind === "missing-namespace").map((i) => i.ref).sort();

// 독립 확인: 모든 매퍼 XML 에서 namespace 와 (주석 밖) id 를 다시 읽어 그 문장이 정말 없는지
function allXml(dir, out = []) { for (const e of readdirSync(dir)) { if (["target", ".git", "node_modules"].includes(e)) continue; const p = path.join(dir, e); const st = statSync(p); if (st.isDirectory()) allXml(p, out); else if (e.endsWith(".xml")) out.push(p); } return out; }
function reallyMissing(dir, ref) {
  const dot = ref.lastIndexOf("."); const ns = ref.slice(0, dot), id = ref.slice(dot + 1);
  for (const f of allXml(dir)) {
    const t = readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const fns = t.match(/<mapper\s[^>]*namespace="([^"]+)"/)?.[1];
    if (!fns || (fns !== ns && fns.split(".").pop() !== ns.split(".").pop())) continue;
    if (new RegExp(`<(select|insert|update|delete)\\s[^>]*id="(${fns}\\.)?${id}"`).test(t)) return false;
  }
  return true;
}

try {
  // (1)(4) v5.0.7
  const v507 = path.join(root, "cc-507");
  git(["clone", "-q", "--depth", "1", "--branch", "v5.0.7", REPO, v507]);
  const r = m.checkMappers({ projectDir: v507 });
  info(`v5.0.7: ${r.durationMs}ms · ${JSON.stringify(r.counts)} · ${JSON.stringify(r.summary)}`);
  assert(JSON.stringify(missingRefs(r)) === JSON.stringify([...UPSTREAM_FIXED, ...NOT_FIXED].sort()), `v5.0.7 없는 문장 10 = upstream 수정 6 + 미수정 4 (${missingRefs(r).join(", ")})`);
  assert(r.summary.errors === 10 && r.summary.variantGaps === 0 && r.counts.dynamicCalls === 1 && r.summary.dynamicMatched === 1 && r.counts.namespaces >= 140, `오류 10 · DB 별 차이 0("ns." 접두 id 정규화) · 이어 만든 ID 1(맞음)`);
  const top1 = Object.entries(UPSTREAM_ANSWER).filter(([ref, ans]) => r.issues.find((i) => i.ref === ref)?.candidates?.[0] === ans).length;
  assert(top1 === 5, `후보 1순위가 upstream 이 고른 정답 ${top1}/5(문장 자체가 없던 BndtManage 제외)`);
  assert(r.durationMs < 3000, `공통컴포넌트 전체 ${r.durationMs}ms(3초 이내)`);
  // (2) main
  const main = path.join(root, "cc-main");
  git(["clone", "-q", "--depth", "1", REPO, main]);
  const rm = m.checkMappers({ projectDir: main });
  info(`main: ${JSON.stringify(rm.summary)} · ${missingRefs(rm).join(", ")}`);
  assert(JSON.stringify(missingRefs(rm)) === JSON.stringify([...NOT_FIXED].sort()), "main: upstream 수정 6곳이 빠지고 미수정 4곳만");
  // (3) 공식 템플릿
  for (const t of ["web", "boot-web", "simple-backend", "simple-homepage", "portal-site", "enterprise-business"]) {
    const c = await m.createProject({ template: t, projectName: `mc-${t}`, groupId: "egovframework.example", outputDir: root, database: "hsql" });
    const x = m.checkMappers({ projectDir: c.projectPath });
    info(`${t}: ${JSON.stringify(x.counts)} · ${JSON.stringify(x.summary)}`);
    if (t === "web" || t === "boot-web") { assert(x.summary.errors === 0 && x.summary.warnings === 0 && x.counts.interfaceMethods > 0, `${t}: 항목 0(Mapper 인터페이스 ${x.counts.interfaceMethods} 메서드 모두 XML 에 있음)`); continue; }
    const wrong = missingRefs(x).filter((ref) => !reallyMissing(c.projectPath, ref));
    const variants = x.issues.filter((i) => i.kind === "db-variant");
    assert(wrong.length === 0 && variants.every((v) => v.missingIn.length > 0), `${t}: 없는 문장 ${missingRefs(x).length}건 모두 독립 확인(오탐 0)${wrong.length ? ` — 틀림: ${wrong.join(", ")}` : ""}, DB 별 차이 ${variants.length}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`mapper-check-live FAIL (${n} assertions)`); else console.log(`mapper-check-live OK (${n} assertions)`);
