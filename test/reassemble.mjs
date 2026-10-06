// node test/reassemble.mjs — 공통컴포넌트 재조립(v0.38) 오프라인 검증: 메모리 원본 저장소로 원본 태그 식별·3-way 분류·적용·패치·매니페스트·rollback.
import { reassembleComponents, renderReassembleMarkdown, MemoryOriginSource, gitBlobId, blobIdsOf, compareTags, unifiedPatch, loadCatalog, validateProject, OUTPUT_SCHEMAS, REASSEMBLE_STATES } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
async function rejects(fn, re, msg) { try { await fn(); assert(false, `${msg} (예외 없음)`); } catch (e) { assert(re.test(e.message), `${msg} (${e.message.slice(0, 90)})`); } }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text); };
const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");

// ── 순수 함수 ──────────────────────────────────────────
assert(gitBlobId(Buffer.from("hello\n")) === "ce013625030ba8dba906f756967f9e9ca394464a", "gitBlobId = git hash-object");
const crlf = Buffer.from("a\r\nb\r\n");
assert(blobIdsOf(crlf).length === 2 && blobIdsOf(crlf)[1] === gitBlobId(Buffer.from("a\nb\n")) && blobIdsOf(Buffer.from("x\n")).length === 1, "CRLF 체크아웃은 LF 정규화 id 도 함께");
assert(compareTags("v3.10.0", "v3.9.0") > 0 && compareTags("v4.3.2", "v5.0.0") < 0 && compareTags("v3.10.0", "v3.10.0-FINAL") === 0, "태그 버전 비교(숫자 기준)");
const patch = (await unifiedPatch("src/A.java", Buffer.from("a\nb\nc\n"), Buffer.from("a\nB\nc\n"))).toString("utf8");
assert(patch.startsWith("diff --git a/src/A.java b/src/A.java") && patch.includes("--- a/src/A.java") && patch.includes("+++ b/src/A.java") && patch.includes("-b\n+B"), "unified diff 헤더는 프로젝트 경로");
assert((await unifiedPatch("x", Buffer.from("same\n"), Buffer.from("same\n"))).length === 0, "차이 없으면 빈 패치");
const euc = Buffer.from([0xc7, 0xd1, 0x0a]);
assert((await unifiedPatch("한글/E.java", Buffer.from("x\n"), euc)).includes(euc) && (await unifiedPatch("한글/E.java", Buffer.from("x\n"), euc)).toString("utf8").includes("+++ b/한글/E.java"), "패치는 원문 바이트(EUC-KR 등) 보존, 헤더 경로는 UTF-8");

// ── 픽스처: bbs 컴포넌트, 원본 v3.10.0 / 후보 v3.9.0 / 목표 v5.0.7 ──
const catalog = loadCatalog();
const bbs = catalog.components.find((c) => c.id === "bbs");
const J = "src/main/java/egovframework/com/cop/bbs/";
const M = "src/main/resources/egovframework/mapper/com/cop/bbs/";
const msg = bbs.messageBundles[0];
const assets = Object.fromEntries(["messageBundles", "idgnContexts", "schedulingContexts", "webAssets", "webFragments"].flatMap((f) => bbs[f] ?? []).map((p) => [p, `5.0.7 asset ${p}\n`]));
const v3100 = {
  [`${J}A.java`]: "class A { /* 3.10 */ }\n",
  [`${J}B.java`]: "class B {\n  int x;\n}\n",
  [`${J}C.java`]: "class C { /* same in 5 */ }\n",
  [`${J}D.java`]: "class D { /* removed in 5 */ }\n",
  [`${J}E.java`]: "class E { /* removed in 5 */ }\n",
  [`${J}K.java`]: "class K {\n  void k() {}\n}\n",
  [`${M}Bbs_SQL_mysql.xml`]: "<mapper>3.10</mapper>\n",
  [msg]: "title=3.10\n",
};
const v390 = { [`${J}A.java`]: "class A { /* 3.9 */ }\n", [`${J}C.java`]: "class C { /* same in 5 */ }\n" };
const v507 = {
  ...assets,
  [`${J}A.java`]: "class A { /* 5.0.7 */ }\n",
  [`${J}B.java`]: "class B {\n  long x;\n}\n",
  [`${J}C.java`]: "class C { /* same in 5 */ }\n",
  [`${J}G.java`]: "class G { /* new in 5 */ }\n",
  [`${J}H.java`]: "class H { /* 5.0.7 */ }\n",
  [`${J}K.java`]: "class K {\n  void k5() {}\n}\n",
  [`${M}Bbs_SQL_mysql.xml`]: "<mapper>5.0.7</mapper>\n",
  [msg]: "title=5.0.7\n",
};
const origin = new MemoryOriginSource({ "v3.9.0": v390, "v3.10.0": v3100, "v5.0.7": v507 }, { "v5.0.7": catalog.source.commit });
const readTarget = async (paths) => new Map(paths.map((p) => [p, origin.contentOf("v5.0.7", p)]).filter(([, b]) => b));

function makeProject() {
  const root = mkdtempSync(path.join(tmpdir(), "egovreasm-"));
  write(root, "pom.xml", `<project><properties><egovframework.rte.version>3.10.0</egovframework.rte.version></properties><dependencies>
<dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.ptl.mvc</artifactId><version>\${egovframework.rte.version}</version></dependency>
</dependencies></project>\n`);
  write(root, `${J}A.java`, v3100[`${J}A.java`]); // 원본 그대로 → 교체
  write(root, `${J}B.java`, "class B {\n  int x; // 사용자\n}\n"); // 사용자 수정 → 교체 + 패치
  write(root, `${J}C.java`, v3100[`${J}C.java`]); // 목표와 같음
  write(root, `${J}D.java`, v3100[`${J}D.java`]); // 5.x 제거(원본 그대로)
  write(root, `${J}E.java`, "class E { /* user */ }\n"); // 5.x 제거(사용자 수정)
  write(root, `${J}F.java`, "class F {}\n"); // 사용자 추가
  write(root, `${J}H.java`, "class H { /* mine */ }\n"); // 원본에 없는 경로 → 원본 미확인
  write(root, `${J}K.java`, v3100[`${J}K.java`].replace(/\n/g, "\r\n")); // CRLF 체크아웃 — 원본 그대로로 판정
  write(root, `${M}Bbs_SQL_mysql.xml`, v3100[`${M}Bbs_SQL_mysql.xml`]);
  write(root, msg, "title=사용자\n"); // 설정·자산 사용자 수정 → 유지 + 참고본
  return root;
}

// ── dryRun: 원본 식별·분류 ───────────────────────────────
const p1 = makeProject();
const dry = await reassembleComponents({ projectDir: p1, origin });
const st = (rel) => dry.files.find((f) => f.path === rel);
assert(dry.dryRun && dry.origin.tag === "v3.10.0" && dry.origin.mode === "auto" && dry.origin.candidates[0].tag === "v3.10.0" && dry.origin.candidates.some((c) => c.tag === "v3.9.0"), `원본 태그 v3.10.0 식별(후보 ${dry.origin.candidates.map((c) => `${c.tag}:${c.matched}/${c.total}`).join(" ")})`);
assert(!dry.origin.candidates.some((c) => c.tag === "v5.0.7"), "3.x 프로젝트는 3.x 태그만 후보");
assert(dry.sourceEra === "3.x" && dry.target.tag === "v5.0.7" && dry.target.commit === catalog.source.commit, "세대·목표 태그·고정 커밋");
assert(dry.components.length === 1 && dry.components[0].id === "bbs", "감지된 컴포넌트 bbs 만 대상");
const expectState = { A: "unchanged", B: "user-modified", C: "identical", D: "removed-unchanged", E: "removed-modified", F: "user-added", G: "new", H: "unverified", K: "unchanged" };
for (const [k, s] of Object.entries(expectState)) assert(st(`${J}${k}.java`)?.state === s, `${k}.java → ${s} (got ${st(`${J}${k}.java`)?.state})`);
assert(st(`${M}Bbs_SQL_mysql.xml`).state === "unchanged" && st(msg).state === "user-modified" && st(msg).action === "keep-reference" && st(msg).asset === "messageBundles", "매퍼는 교체, 메시지(자산) 사용자 수정은 유지+참고본");
assert(st(`${J}B.java`).action === "replace" && st(`${J}D.java`).action === "delete" && st(`${J}F.java`).action === "keep" && st(`${J}G.java`).action === "add" && st(`${J}H.java`).action === "replace", "처리 방식(교체·삭제·유지·추가)");
assert(dry.files.filter((f) => f.state === "new").length === 1 + Object.keys(assets).length - 1, `5.x 신규 = G + 자산(메시지 1개 제외) ${Object.keys(assets).length - 1}`);
assert(dry.worklist.map((w) => w.kind).join(",") === "reapply-patch,removed-in-5x,removed-in-5x,unverified-replaced,review-config", `작업 목록 순서·종류 (${dry.worklist.map((w) => w.kind).join(",")})`);
assert(!existsSync(path.join(p1, ".egovframe-components.json")) && !existsSync(path.join(p1, "migration-backup")) && read(p1, `${J}A.java`) === v3100[`${J}A.java`], "dryRun 무기록");
const sum = REASSEMBLE_STATES.reduce((s, k) => s + dry.summary[k], 0);
assert(sum === dry.files.length && dry.actions.replace + dry.actions.add + dry.actions.delete + dry.actions.keep + dry.actions["keep-reference"] === dry.files.length, "요약 합계 = 파일 수");
const md = renderReassembleMarkdown(dry);
assert(md.includes("# 공통컴포넌트 재조립 (미리보기)") && md.includes("원본: v3.10.0 → 목표: v5.0.7") && md.includes("## 작업 목록") && md.includes("| bbs |"), "Markdown 요약");
const sc = OUTPUT_SCHEMAS.reassemble_egovframe_components.safeParse(dry);
assert(sc.success && Object.keys(dry).every((k) => k in OUTPUT_SCHEMAS.reassemble_egovframe_components.shape), `outputSchema 통과·미선언 키 없음${sc.success ? "" : JSON.stringify(sc.error.issues.slice(0, 2))}`);

// ── 원본 태그 지정·오류 ───────────────────────────────────
const fixed = await reassembleComponents({ projectDir: p1, origin, sourceTag: "v3.9.0" });
assert(fixed.origin.mode === "fixed" && fixed.origin.tag === "v3.9.0" && fixed.files.find((f) => f.path === `${J}B.java`).state === "unverified", "sourceTag 지정 시 그 태그가 기준선(v3.9.0 에 없는 B 는 원본 미확인)");
await rejects(() => reassembleComponents({ projectDir: p1, origin, sourceTag: "v9.9.9" }), /원본 태그 v9\.9\.9/, "없는 원본 태그 거부");
await rejects(() => reassembleComponents({ projectDir: p1, origin, components: ["nope"] }), /카탈로그에 없는/, "없는 컴포넌트 id 거부");
await rejects(() => reassembleComponents({ projectDir: p1, origin: new MemoryOriginSource({ "v3.10.0": v3100, "v5.0.7": v507 }, { "v5.0.7": "f".repeat(40) }) }), /태그 이동/, "목표 태그 커밋이 카탈로그와 다르면 거부");

// ── 적용 ─────────────────────────────────────────────────
const applied = await reassembleComponents({ projectDir: p1, origin, dryRun: false, readTarget });
assert(!applied.dryRun && applied.manifestUpdated && existsSync(applied.backupDir) && existsSync(applied.planPath), "적용: 매니페스트·백업·계획 파일");
assert(read(p1, `${J}A.java`) === v507[`${J}A.java`] && read(p1, `${J}B.java`) === v507[`${J}B.java`] && read(p1, `${J}G.java`) === v507[`${J}G.java`] && read(p1, `${J}H.java`) === v507[`${J}H.java`] && read(p1, `${J}K.java`) === v507[`${J}K.java`], "교체·추가 파일 = 5.0.7");
assert(!existsSync(path.join(p1, `${J}D.java`)) && !existsSync(path.join(p1, `${J}E.java`)) && read(p1, `${J}F.java`) === "class F {}\n" && read(p1, msg) === "title=사용자\n", "5.x 제거 파일 삭제, 사용자 추가 파일·자산 사용자본 유지");
const bk = path.relative(p1, applied.backupDir).split(path.sep).join("/");
assert(read(p1, `${bk}/originals/${J}B.java`).includes("// 사용자") && read(p1, `${bk}/originals/${J}D.java`) === v3100[`${J}D.java`] && read(p1, `${bk}/originals/${J}H.java`).includes("mine") && read(p1, `${bk}/reference/${msg}`) === "title=5.0.7\n", "원본 백업·자산 참고본");
const pB = applied.files.find((f) => f.path === `${J}B.java`).patch;
assert(pB && read(p1, pB).includes("-  int x;\n+  int x; // 사용자") && applied.worklist.find((w) => w.path === `${J}B.java`).patch === pB, "사용자 변경 패치(원본→현재)와 작업 목록 연결");
const pE = applied.files.find((f) => f.path === `${J}E.java`).patch;
assert(pE && read(p1, pE).includes("+class E { /* user */ }"), "제거 파일의 사용자 변경도 패치");
const man = JSON.parse(read(p1, ".egovframe-components.json"));
assert(man.source.tag === "v5.0.7" && man.components.bbs && man.components.bbs.files.includes(`${J}A.java`) && !man.components.bbs.files.includes(`${J}D.java`) && !man.components.bbs.files.includes(`${J}F.java`) && man.components.bbs.hashes[msg].hash !== man.components.bbs.hashes[msg].srcHash, "매니페스트: 목표 파일만, 자산 사용자본은 hash≠srcHash");
const plan = JSON.parse(readFileSync(applied.planPath, "utf8"));
assert(plan.tool === "reassemble_egovframe_components" && plan.files.length === applied.files.length && plan.origin.tag === "v3.10.0", "reassemble-plan.json");
const val = await validateProject({ projectDir: p1 });
assert(val.manifestFound && val.components.find((c) => c.id === "bbs")?.missing === 0, "재조립 뒤 validate_egovframe_project: 누락 0");
await rejects(() => reassembleComponents({ projectDir: p1, origin }), /upgrade_egovframe_project/, "매니페스트로 관리되는 컴포넌트는 재조립 거부(upgrade 안내)");

// ── 실패 시 원복 ─────────────────────────────────────────
const p2 = makeProject();
const before = Object.fromEntries(["A", "B", "D", "E", "H"].map((k) => [k, read(p2, `${J}${k}.java`)]));
await rejects(() => reassembleComponents({ projectDir: p2, origin, dryRun: false, readTarget, faultInjection: "after-files" }), /fault injection/, "fault injection");
assert(Object.entries(before).every(([k, v]) => existsSync(path.join(p2, `${J}${k}.java`)) && read(p2, `${J}${k}.java`) === v) && !existsSync(path.join(p2, `${J}G.java`)) && !existsSync(path.join(p2, ".egovframe-components.json")) && !existsSync(path.join(p2, "migration-backup")), "rollback: 교체·삭제·추가·백업 전부 원복");
await rejects(() => reassembleComponents({ projectDir: p2, origin, dryRun: false, readTarget: async (ps) => { const m = await readTarget(ps); m.set(`${J}A.java`, Buffer.from("tampered")); return m; } }), /blob 과 다릅니다/, "목표 내용이 태그 blob 과 다르면 거부");

// ── verify(가짜 runner) ──────────────────────────────────
const p3 = makeProject();
const errRunner = async (cmd, o) => { o.onData(`[ERROR] ${path.join(p3, J, "G.java")}:[1,9] cannot find symbol\n[ERROR] ${path.join(p3, J, "B.java")}:[2,3] cannot find symbol\n`); return { exitCode: 1, timedOut: false }; };
const ver = await reassembleComponents({ projectDir: p3, origin, dryRun: false, readTarget, verify: true, runner: errRunner, platform: "linux" });
assert(ver.verify?.ran && ver.verify.success === false && ver.verify.errors === 2 && ver.verify.inReassembled === 2 && ver.worklist.find((w) => w.path === `${J}B.java`).errors === 1, `verify: 오류 2건, 재조립 파일 2건, 작업 목록에 연결 (${JSON.stringify(ver.verify)})`);

// ── 대상 없음 ────────────────────────────────────────────
const p4 = mkdtempSync(path.join(tmpdir(), "egovreasm-empty-"));
write(p4, "pom.xml", "<project></project>\n");
const none = await reassembleComponents({ projectDir: p4, origin });
assert(none.components.length === 0 && none.files.length === 0 && none.notes.some((x) => x.includes("찾지 못했습니다")), "감지된 컴포넌트 없음 → 안내만");

for (const d of [p1, p2, p3, p4]) rmSync(d, { recursive: true, force: true });
void readdirSync;
if (process.exitCode) console.error(`reassemble FAIL (${n} assertions)`); else console.log(`reassemble OK (${n} assertions)`);
