// node test/reapply.mjs — 사용자 수정 자동 재적용(v1.12, 게이트, 오프라인)
//   mergeThreeWay: 깨끗한 병합·한쪽만 바뀜·absorbed·충돌(hunk 수)·이진·CRLF 보존,
//   재조립 reapply: 사용자 수정 소스·설정이 3-way 로 합쳐져 쓰이고 충돌은 목표본+패치+작업 목록(표식 없음), 매니페스트 해시, 멱등, verify 되돌림, dryRun 안내,
//   업그레이드 reapply: 기준(매니페스트 태그)·목표(카탈로그) 아카이브로 충돌 파일 병합, 합치지 못한 것만 거부, force 와 함께, verify 되돌림, 매니페스트 source 갱신,
//   리허설 reapply 수치, MCP 입력
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
async function rejects(fn, re, msg) { try { await fn(); assert(false, `${msg} (예외 없음)`); } catch (e) { assert(re.test(e.message), `${msg} (${e.message.slice(0, 100)})`); } }
const m = await import("../dist/index.js");
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text); };
const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");
const B = (s) => Buffer.from(s);

// ── mergeThreeWay ────────────────────────────────────
{
  const base = B("line1\nline2\nline3\nline4\nline5\n");
  const clean = await m.mergeThreeWay(base, B("line1\nline2 user\nline3\nline4\nline5\n"), B("line1\nline2\nline3\nline4\nline5 upstream\n"));
  assert(clean.status === "clean" && clean.merged.toString() === "line1\nline2 user\nline3\nline4\nline5 upstream\n" && clean.conflicts === 0, "다른 곳을 고쳤으면 둘 다 반영");
  assert((await m.mergeThreeWay(base, base, B("x\n"))).status === "clean" && (await m.mergeThreeWay(base, base, B("x\n"))).merged.toString() === "x\n", "사용자 변경 없음 → 목표본");
  assert((await m.mergeThreeWay(base, B("u\n"), base)).merged.toString() === "u\n", "upstream 변경 없음 → 사용자본");
  const ab = await m.mergeThreeWay(base, B("line1\nline2 same\nline3\nline4\nline5\n"), B("line1\nline2 same\nline3\nline4\nline5\n"));
  assert(ab.status === "absorbed" && ab.merged.toString().includes("line2 same"), "같은 변경 → absorbed(upstream 에 이미 반영)");
  const cf = await m.mergeThreeWay(base, B("line1\nline2 user\nline3\nline4\nline5\n"), B("line1\nline2 upstream\nline3\nline4\nline5\n"));
  assert(cf.status === "conflict" && cf.conflicts === 1 && cf.merged === undefined, `같은 줄 → 충돌 ${cf.conflicts}곳, 결과 없음`);
  const cf2 = await m.mergeThreeWay(B("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n"), B("A\nb\nc\nd\ne\nf\ng\nh\ni\nJ\n"), B("1\nb\nc\nd\ne\nf\ng\nh\ni\n0\n"));
  assert(cf2.status === "conflict" && cf2.conflicts === 2, `떨어진 두 곳 충돌 → hunk ${cf2.conflicts}`);
  const bin = await m.mergeThreeWay(Buffer.from([0, 1, 2]), Buffer.from([0, 1, 3]), Buffer.from([0, 9, 2]));
  assert(bin.status === "binary", "이진은 병합하지 않음");
  const crlf = await m.mergeThreeWay(B("a\r\nb\r\nc\r\nd\r\ne\r\n"), B("a\r\nb user\r\nc\r\nd\r\ne\r\n"), B("a\r\nb\r\nc\r\nd\r\ne up\r\n"));
  assert(crlf.status === "clean" && crlf.merged.toString() === "a\r\nb user\r\nc\r\nd\r\ne up\r\n", "CRLF 보존");
  const euc = Buffer.concat([Buffer.from([0xc7, 0xd1, 0x0a]), B("b\nc\nd\ne\nf\n")]);
  const e2 = await m.mergeThreeWay(euc, Buffer.concat([euc, B("user\n")]), Buffer.concat([Buffer.from([0xc7, 0xd1, 0x0a]), B("B\nc\nd\ne\nf\n")]));
  assert(e2.status === "clean" && e2.merged.subarray(0, 2).equals(Buffer.from([0xc7, 0xd1])) && e2.merged.toString("latin1").endsWith("B\nc\nd\ne\nf\nuser\n"), "EUC-KR 바이트 보존");
}

// ── 재조립 reapply ───────────────────────────────────
const catalog = m.loadCatalog();
const bbs = catalog.components.find((c) => c.id === "bbs");
const J = "src/main/java/egovframework/com/cop/bbs/";
const msg = bbs.messageBundles[0];
const assets = Object.fromEntries(["messageBundles", "idgnContexts", "schedulingContexts", "webAssets", "webFragments"].flatMap((f) => bbs[f] ?? []).map((p) => [p, `5.0.7 asset ${p}\n`]));
const TEN = (tag) => `class T {\n  int a;\n  int b;\n  int c;\n  int d;\n  int e;\n  int f;\n  int g; // ${tag}\n}\n`;
const v3100 = { [`${J}Clean.java`]: TEN("3.10"), [`${J}Conf.java`]: TEN("3.10"), [`${J}Same.java`]: TEN("3.10"), [`${J}Plain.java`]: "class P {}\n", [`${J}U1.java`]: "class U1 { /* 3.10 */ }\n", [`${J}U2.java`]: "class U2 { /* 3.10 */ }\n", [`${J}U3.java`]: "class U3 { /* 3.10 */ }\n", [msg]: "title=3.10\nk1=a\nk2=b\nk3=c\nk4=d\nfoot=3.10\n" };
const v507 = { ...assets, [`${J}Clean.java`]: TEN("5.0.7"), [`${J}Conf.java`]: TEN("5.0.7"), [`${J}Same.java`]: TEN("5.0.7"), [`${J}Plain.java`]: "class P { /* 5 */ }\n", [`${J}U1.java`]: "class U1 { /* 5 */ }\n", [`${J}U2.java`]: "class U2 { /* 5 */ }\n", [`${J}U3.java`]: "class U3 { /* 5 */ }\n", [msg]: "title=5.0.7\nk1=a\nk2=b\nk3=c\nk4=d\nfoot=3.10\n" };
const origin = new m.MemoryOriginSource({ "v3.10.0": v3100, "v5.0.7": v507 }, { "v5.0.7": catalog.source.commit });
const readTarget = async (paths) => new Map(paths.map((p) => [p, origin.contentOf("v5.0.7", p)]).filter(([, b]) => b));
const makeProject = () => {
  const root = mkdtempSync(path.join(tmpdir(), "egov-reapply-"));
  write(root, "pom.xml", `<project><properties><egovframework.rte.version>3.10.0</egovframework.rte.version></properties></project>\n`);
  write(root, `${J}Clean.java`, TEN("3.10").replace("int a;", "int a; // user")); // 다른 줄 → 깨끗한 병합
  write(root, `${J}Conf.java`, TEN("3.10").replace("// 3.10", "// user")); // 같은 줄 → 충돌
  write(root, `${J}Same.java`, TEN("5.0.7")); // 사용자가 upstream 과 같은 변경 → absorbed
  write(root, `${J}Plain.java`, "class P {}\n"); // 원본 그대로 → 교체
  for (const u of ["U1", "U2", "U3"]) write(root, `${J}${u}.java`, v3100[`${J}${u}.java`]); // 원본 식별용
  write(root, msg, "title=3.10\nk1=a\nk2=b\nk3=c\nk4=d\nfoot=사용자\n"); // 설정 자산: 다른 키 → 깨끗한 병합
  return root;
};
{
  const p = makeProject();
  const dry = await m.reassembleComponents({ projectDir: p, origin, reapply: true });
  assert(dry.dryRun && !dry.reapply && dry.notes.some((x) => x.includes("reapply=true") && x.includes("3-way")), "dryRun: 병합하지 않고 안내만");
  const r = await m.reassembleComponents({ projectDir: p, origin, readTarget, dryRun: false, reapply: true });
  const rp = r.reapply;
  assert(r.origin.tag === "v3.10.0" && rp && rp.reapplied === 2 && rp.absorbed === 0 && rp.conflicts === 1 && rp.binary === 0 && rp.reverted === 0, `재조립 reapply: 원본 v3.10.0 · 자동 2(소스 1·설정 1) · 충돌 1(목표와 같은 파일은 identical 이라 병합 대상 아님) (${JSON.stringify(rp && { ...rp, entries: undefined })})`);
  assert(read(p, `${J}Clean.java`) === TEN("5.0.7").replace("int a;", "int a; // user"), "깨끗한 병합: 사용자 줄 + upstream 줄 모두 반영");
  assert(read(p, `${J}Conf.java`) === TEN("5.0.7") && !read(p, `${J}Conf.java`).includes("<<<<"), "충돌: 목표본 그대로, 표식 없음");
  assert(read(p, msg) === "title=5.0.7\nk1=a\nk2=b\nk3=c\nk4=d\nfoot=사용자\n", "설정 자산도 병합(keep-reference → replace)");
  assert(read(p, `${J}Same.java`) === TEN("5.0.7") && r.files.find((f) => f.path === `${J}Same.java`).state === "identical", "목표와 같은 사용자 변경은 identical");
  const w = r.worklist.filter((x) => x.kind === "reapply-patch" || x.kind === "review-config");
  assert(w.length === 1 && w[0].path === `${J}Conf.java` && /충돌 1곳/.test(w[0].detail) && w[0].patch && existsSync(path.join(p, w[0].patch)), "작업 목록: 충돌 파일만, hunk 수·패치 경로");
  assert(r.files.find((f) => f.path === `${J}Clean.java`).reapply === "clean" && r.files.find((f) => f.path === `${J}Conf.java`).reapply === "conflict" && existsSync(path.join(p, r.files.find((f) => f.path === `${J}Clean.java`).patch)), "파일 항목에 reapply 상태, 깨끗한 병합도 패치는 남김");
  const mf = JSON.parse(read(p, ".egovframe-components.json"));
  const h = mf.components.bbs.hashes[`${J}Clean.java`];
  const sha = (s) => "sha256:" + createHash("sha256").update(s).digest("hex");
  assert(h.hash === sha(read(p, `${J}Clean.java`)) && h.srcHash === sha(TEN("5.0.7")), "매니페스트: hash=합친 파일, srcHash=목표본");
  const plan = JSON.parse(readFileSync(r.planPath, "utf8"));
  assert(plan.reapply.reapplied === 2 && plan.files.find((f) => f.path.endsWith("Conf.java")).reapply === "conflict", "reassemble-plan.json 에 reapply");
  await rejects(() => m.reassembleComponents({ projectDir: p, origin, readTarget, dryRun: false, reapply: true }), /이미 매니페스트/, "재조립 뒤에는 매니페스트가 기준 → 다시 재조립 대신 upgrade 로");
  const z507 = new AdmZip(); for (const [rel, b] of Object.entries(v507)) z507.addFile(`r/${rel}`, Buffer.from(b)); for (const [rel, b] of Object.entries(v3100)) if (!v507[rel]) z507.addFile(`r/${rel}`, Buffer.from(b));
  const again = await m.upgradeProject({ projectDir: p, archiveData: z507.toBuffer() });
  assert(again.summary.conflict === 0 && again.summary.update === 0 && again.summary["user-modified"] === 0 && again.summary.unchanged > 0, `멱등: 같은 태그로 upgrade dryRun → 충돌·갱신 0(합친 파일이 매니페스트 기준) (${JSON.stringify(again.summary)})`);
  assert(m.renderReassembleMarkdown(r).includes("사용자 수정 재적용: 자동 2"), "Markdown");
  rmSync(p, { recursive: true, force: true });
  // reapply 없이: 기존 동작(목표본 + 패치)
  const p0 = makeProject();
  const r0 = await m.reassembleComponents({ projectDir: p0, origin, readTarget, dryRun: false });
  assert(!r0.reapply && read(p0, `${J}Clean.java`) === TEN("5.0.7") && read(p0, msg) === "title=3.10\nk1=a\nk2=b\nk3=c\nk4=d\nfoot=사용자\n" && r0.worklist.filter((x) => x.kind === "reapply-patch").length === 2 && r0.worklist.some((x) => x.kind === "review-config" && x.path === msg), "reapply 생략 → v0.38 과 같은 동작(목표본 + 패치·설정 검토)");
  rmSync(p0, { recursive: true, force: true });
}
// verify 되돌림: 합친 파일에서 컴파일 오류 → 목표본
{
  const p = makeProject();
  const runner = async (_cmd, o) => { o.onData(`[ERROR] ${path.join(p, `${J}Clean.java`)}:[2,3] cannot find symbol\n[INFO] BUILD FAILURE\n`); return { exitCode: 1, timedOut: false }; };
  const r = await m.reassembleComponents({ projectDir: p, origin, readTarget, dryRun: false, reapply: true, verify: true, runner, platform: "linux" });
  assert(r.reapply.reverted === 1 && r.reapply.reapplied === 1 && read(p, `${J}Clean.java`) === TEN("5.0.7") && r.worklist.some((w) => w.path === `${J}Clean.java` && /되돌림/.test(w.detail)), "verify: 오류 난 합친 파일만 목표본으로 되돌리고 작업 목록에");
  const mf = JSON.parse(read(p, ".egovframe-components.json"));
  assert(mf.components.bbs.hashes[`${J}Clean.java`].hash === mf.components.bbs.hashes[`${J}Clean.java`].srcHash, "되돌린 파일의 매니페스트 해시 = 목표본");
  assert(read(p, msg) === "title=5.0.7\nk1=a\nk2=b\nk3=c\nk4=d\nfoot=사용자\n", "오류 없는 합친 파일은 유지");
  rmSync(p, { recursive: true, force: true });
}

// ── 업그레이드 reapply ───────────────────────────────
{
  const sha = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
  const rel = "src/main/java/egovframework/com/cmm/Up.java", rel2 = "src/main/java/egovframework/com/cmm/Up2.java", relCfg = "src/main/java/egovframework/com/cmm/Keep.java";
  const base = { [rel]: B(TEN("base")), [rel2]: B(TEN("base")), [relCfg]: B("k\n") };
  const target = { [rel]: B(TEN("target")), [rel2]: B(TEN("target")), [relCfg]: B("k\n") };
  const zipOf = (files, root) => { const z = new AdmZip(); for (const [r, b] of Object.entries(files)) z.addFile(`${root}/${r}`, b); return z.toBuffer(); };
  const mk = () => {
    const d = mkdtempSync(path.join(tmpdir(), "egov-up-reapply-"));
    write(d, "pom.xml", "<project/>");
    write(d, rel, TEN("base").replace("int a;", "int a; // user")); // 충돌 분류이지만 다른 줄 → 병합 가능
    write(d, rel2, TEN("base").replace("// base", "// user")); // 같은 줄 → 병합 불가
    write(d, relCfg, "k\n");
    const manifest = { schemaVersion: 3, source: { repository: "fixture/repo", repo: "fixture/repo", branch: "main", tag: "v0.1", commit: "a".repeat(40) }, components: { cmm: { installedAt: "2026-01-01T00:00:00.000Z", files: [rel, rel2, relCfg], hashes: Object.fromEntries(Object.entries(base).map(([r, b]) => [r, { hash: sha(b), srcHash: sha(b) }])), sqlScripts: [] } } };
    writeFileSync(path.join(d, ".egovframe-components.json"), JSON.stringify(manifest, null, 2));
    return d;
  };
  const d = mk();
  const dry = await m.upgradeProject({ projectDir: d, archiveData: zipOf(target, "t"), reapply: true });
  assert(dry.summary.conflict === 2 && dry.summary.unchanged === 1 && dry.target.tag === catalog.source.tag && dry.base.tag === "v0.1" && dry.notes.some((x) => /충돌 2개 파일을 .*3-way/.test(x)), "업그레이드 dryRun: 충돌 2, 기준=매니페스트 태그·목표=카탈로그 태그");
  await rejects(() => m.upgradeProject({ projectDir: d, dryRun: false, archiveData: zipOf(target, "t"), baseArchiveData: zipOf(base, "b"), reapply: true }), /충돌 1건.*3-way 병합으로도 합치지 못함/, "합치지 못한 1건은 force 없이 거부(아무것도 쓰지 않음)");
  assert(read(d, rel) === TEN("base").replace("int a;", "int a; // user"), "거부 뒤 파일 불변");
  const r = await m.upgradeProject({ projectDir: d, dryRun: false, archiveData: zipOf(target, "t"), baseArchiveData: zipOf(base, "b"), reapply: true, force: true });
  assert(r.applied.reapplied === 1 && r.applied.forced === 1 && r.reapply.reapplied === 1 && r.reapply.conflicts === 1, `force 와 함께: 합친 1 · 덮어쓴 1 (${JSON.stringify(r.applied)})`);
  assert(read(d, rel) === TEN("target").replace("int a;", "int a; // user") && read(d, rel2) === TEN("target"), "합친 파일은 사용자 줄 유지, 충돌 파일은 upstream 본");
  const mf = JSON.parse(read(d, ".egovframe-components.json"));
  assert(mf.source.commit === catalog.source.commit && mf.components.cmm.hashes[rel].hash === sha(read(d, rel)) && mf.components.cmm.hashes[rel].srcHash === sha(TEN("target")), "매니페스트: source 가 카탈로그 태그로, hash=합친 파일·srcHash=upstream");
  assert(existsSync(path.join(r.backupDir, rel)) && JSON.parse(readFileSync(path.join(r.backupDir, "upgrade-plan.json"), "utf8")).reapply.reapplied === 1, "백업·upgrade-plan.json 에 reapply");
  const again = await m.upgradeProject({ projectDir: d, archiveData: zipOf(target, "t") });
  assert(again.summary.conflict === 0 && again.summary.update === 0 && again.summary.unchanged === 3, `다음 업그레이드: 합친 파일이 매니페스트 기준이라 충돌·갱신 없음 (${JSON.stringify(again.summary)})`);
  rmSync(d, { recursive: true, force: true });
  // 기준 아카이브의 파일이 매니페스트 srcHash 와 다르면 병합하지 않음(error)
  const d2 = mk();
  const wrongBase = { ...base, [rel]: B("other base\n") };
  await rejects(() => m.upgradeProject({ projectDir: d2, dryRun: false, archiveData: zipOf(target, "t"), baseArchiveData: zipOf(wrongBase, "b"), reapply: true }), /충돌 2건/, "기준 불일치 파일은 합치지 않음(error)");
  rmSync(d2, { recursive: true, force: true });
  // verify 되돌림
  const d3 = mk();
  const runner = async (_cmd, o) => { o.onData(`[ERROR] ${path.join(d3, rel)}:[3,1] ';' expected\n[INFO] BUILD FAILURE\n`); return { exitCode: 1, timedOut: false }; };
  const r3 = await m.upgradeProject({ projectDir: d3, dryRun: false, archiveData: zipOf(target, "t"), baseArchiveData: zipOf(base, "b"), reapply: true, force: true, verify: true, runner, platform: "linux" });
  assert(r3.verify.ran && r3.verify.success === false && r3.reapply.reverted === 1 && r3.applied.reapplied === 0 && read(d3, rel) === TEN("target"), "verify: 합친 파일에 오류 → upstream 본으로 되돌림");
  rmSync(d3, { recursive: true, force: true });
}

// ── 리허설 reapply ───────────────────────────────────
{
  const p = makeProject();
  const ws = mkdtempSync(path.join(tmpdir(), "egov-reapply-ws-"));
  const runner = async (_cmd, o) => { o.onData("[INFO] BUILD SUCCESS\n"); return { exitCode: 0, timedOut: false }; };
  const r = await m.rehearseMigration({ projectDir: p, steps: ["reassemble"], workspaceRoot: ws, origin, readTarget, runner, platform: "linux", reapply: true });
  assert(r.reassemble?.reapply?.reapplied === 2 && r.reassemble.reapply.conflicts === 1 && r.steps[0].summary.includes("재적용 자동 2"), "리허설: 사본에서 reapply 수치");
  assert(read(p, `${J}Clean.java`) === TEN("3.10").replace("int a;", "int a; // user"), "리허설은 원본 불변");
  rmSync(p, { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true });
}

// MCP 입력
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  const tools = (await client.listTools()).tools;
  for (const nm of ["reassemble_egovframe_components", "upgrade_egovframe_project", "rehearse_egovframe_migration"]) {
    const t = tools.find((x) => x.name === nm);
    assert(t && t.inputSchema.properties.reapply?.type === "boolean" && t.inputSchema.properties.reapply.default === false, `${nm}: reapply 파라미터(기본 false)`);
  }
  await client.close(); await server.close();
}

if (process.exitCode) console.error(`reapply FAIL (${n} assertions)`); else console.log(`reapply OK (${n} assertions)`);
