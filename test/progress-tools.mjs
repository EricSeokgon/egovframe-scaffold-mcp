// node test/progress-tools.mjs — v1.2 진행 알림·취소: 복합 도구(납품 패키지·재조립·리허설·오프라인 번들)
//   가짜 runner·메모리 원본·주입 다운로드로 단계 이벤트(순서·단조 증가·total 도달)와 취소(AbortError) 경로를 검증하고,
//   취소 뒤에 부분 출력(스테이징·사본·transaction)이 남지 않고 프로젝트가 그대로인지 트리 해시로 확인한다.
import {
  prepareDelivery,
  reassembleComponents,
  rehearseMigration,
  prepareOfflineBundle,
  MemoryOriginSource,
  loadCatalog,
  purlOf,
  OSV_MAVEN_DUMP_URL,
  collectProgress,
  AbortError,
  isAbortError,
} from "../dist/index.js";
import { makeModern, makeLegacy } from "./fixtures/i18n-fixture.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const isAbort = (e) => e instanceof Error && e.name === "AbortError" && e instanceof AbortError && isAbortError(e);
const monotonic = (events) => events.every((e, i) => i === 0 || e.progress >= events[i - 1].progress);
const endsAtTotal = (events) => events.length > 0 && events.at(-1).total !== undefined && events.at(-1).progress === events.at(-1).total;
const sameTotal = (events) => events.every((e) => e.total === events[0].total);
async function rejectsAbort(p, msg) {
  let err; try { await p; } catch (e) { err = e; }
  assert(err && isAbort(err), `${msg} (got ${err ? `${err.name}: ${err.message.slice(0, 80)}` : "no error"})`);
}
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text); };
/** 디렉터리 트리 해시(경로 + 내용) — 취소 뒤 프로젝트가 바이트 단위로 그대로인지 */
function treeHash(root) {
  const h = createHash("sha256");
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { h.update(`D ${path.relative(root, p)}\n`); walk(p); } // portability: ok 같은 OS 안에서 전후 비교
      else { h.update(`F ${path.relative(root, p)} `); h.update(readFileSync(p)); h.update("\n"); } // portability: ok 같은 OS 안에서 전후 비교
    }
  };
  walk(root);
  return h.digest("hex");
}
const noPartial = (dir) => !readdirSync(dir).some((x) => x.includes(".partial-"));

/** signal 을 존중하는 가짜 runner: onRun 뒤 취소됐으면 aborted */
const abortingRunner = (onRun) => async (cmd, o) => {
  onRun?.(cmd, o);
  if (o.signal?.aborted) return { exitCode: null, timedOut: false, aborted: true };
  o.onData("[INFO] BUILD SUCCESS\n");
  return { exitCode: 0, timedOut: false };
};

const root = mkdtempSync(path.join(tmpdir(), "egov-progress-tools-"));
try {
  // ── prepareDelivery ─────────────────────────────────────────────────
  {
    const proj = makeModern(path.join(root, "modern"));
    const bom = { bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: "urn:uuid:11111111-1111-1111-1111-111111111111", version: 1,
      metadata: { timestamp: "2026-10-04T00:00:00Z", component: { type: "application", "bom-ref": "pkg:maven/egovframework.example/modern@1.2.3?type=war", group: "egovframework.example", name: "modern", version: "1.2.3" } },
      components: [{ type: "library", "bom-ref": purlOf("org.springframework", "spring-webmvc", "6.2.11"), group: "org.springframework", name: "spring-webmvc", version: "6.2.11", purl: purlOf("org.springframework", "spring-webmvc", "6.2.11") }],
      dependencies: [{ ref: "pkg:maven/egovframework.example/modern@1.2.3?type=war", dependsOn: [purlOf("org.springframework", "spring-webmvc", "6.2.11")] }] };
    const pluginRunner = async (cmd, o) => {
      const dir = cmd.args.find((a) => a.startsWith("-DoutputDirectory=")).slice("-DoutputDirectory=".length);
      writeFileSync(path.join(dir, "bom.json"), JSON.stringify(bom));
      o.onData("[INFO] BUILD SUCCESS\n");
      return { exitCode: 0, timedOut: false };
    };
    const include = ["assessment", "dependencies", "sbom", "sbom-check", "secure-coding"];
    const expectedOrder = ["sbom", "sbom-check", "dependencies", "secure-coding", "assessment", "write package"];
    const out1 = path.join(root, "delivery-1");
    // dryRun 은 보고 없음
    const p0 = collectProgress();
    const plan = await prepareDelivery({ projectDir: proj, outputDir: out1, include, runner: pluginRunner, progress: p0 });
    assert(plan.dryRun && p0.events.length === 0, "prepareDelivery(dryRun): 진행 보고 없음");
    // 정상 생성: 항목마다 한 단계, 실행 순서대로, 단조 증가, 마지막 = total
    const p1 = collectProgress();
    const r1 = await prepareDelivery({ projectDir: proj, outputDir: out1, include, dryRun: false, runner: pluginRunner, progress: p1 });
    assert(r1.written && r1.items.find((i) => i.id === "sbom").status === "ok", "prepareDelivery: 가짜 플러그인으로 생성");
    const stepEvents = p1.events.filter((e) => Number.isInteger(e.progress) && e.progress < e.total && expectedOrder.includes(e.message));
    assert(stepEvents.map((e) => e.message).join() === expectedOrder.join() && stepEvents.map((e) => e.progress).join() === expectedOrder.map((_, i) => i).join(), `prepareDelivery: 항목마다 한 단계·실행 순서 (${stepEvents.map((e) => `${e.progress}:${e.message}`).join(" ")})`);
    assert(monotonic(p1.events) && endsAtTotal(p1.events) && sameTotal(p1.events) && p1.events.at(-1).total === expectedOrder.length, `prepareDelivery: 단조 증가·total=${expectedOrder.length} 도달 (${p1.events.length} events)`);
    assert(p1.events.some((e) => /^sbom: /.test(e.message) && e.progress > 0 && e.progress < 1), "prepareDelivery: SBOM 하위 진행이 0~1 구간의 소수로 보고");
    // 취소: sbom 항목 안(가짜 runner)에서 → AbortError, 항목 실패로 기록하지 않고, 출력 디렉터리·스테이징 없음
    const out2 = path.join(root, "delivery-2");
    const ac = new AbortController();
    const p2 = collectProgress(ac.signal);
    await rejectsAbort(prepareDelivery({ projectDir: proj, outputDir: out2, include, dryRun: false, runner: abortingRunner(() => ac.abort()), progress: p2 }), "prepareDelivery: sbom 항목 안 취소 → AbortError");
    assert(!existsSync(out2) && !existsSync(path.join(out2, "delivery-manifest.json")) && noPartial(root), "prepareDelivery: 취소 뒤 부분 출력 없음(manifest·스테이징 없음)");
    assert(p2.events.every((e) => !/write package/.test(e.message)) && p2.events.length >= 1 && p2.events[0].message === "sbom", "prepareDelivery: 취소 뒤 다음 단계 보고 없음");
    // 사전 취소
    const pre = new AbortController(); pre.abort();
    await rejectsAbort(prepareDelivery({ projectDir: proj, outputDir: path.join(root, "delivery-3"), include, dryRun: false, runner: pluginRunner, progress: collectProgress(pre.signal) }), "prepareDelivery: 사전 취소 → AbortError");
    assert(!existsSync(path.join(root, "delivery-3")), "prepareDelivery: 사전 취소면 아무것도 만들지 않음");
    // progress 없이 동일 동작
    const r4 = await prepareDelivery({ projectDir: proj, outputDir: path.join(root, "delivery-4"), include, dryRun: false, runner: pluginRunner });
    assert(r4.written, "prepareDelivery: progress 없이 동일 동작");
  }

  // ── reassembleComponents(메모리 원본) ───────────────────────────────
  {
    const catalog = loadCatalog();
    const bbs = catalog.components.find((c) => c.id === "bbs");
    const J = "src/main/java/egovframework/com/cop/bbs/";
    const assets = Object.fromEntries(["messageBundles", "idgnContexts", "schedulingContexts", "webAssets", "webFragments"].flatMap((f) => bbs[f] ?? []).map((p) => [p, `5.0.7 asset ${p}\n`]));
    const v3100 = { [`${J}A.java`]: "class A { /* 3.10 */ }\n", [`${J}B.java`]: "class B {\n  int x;\n}\n" };
    const v507 = { ...assets, [`${J}A.java`]: "class A { /* 5.0.7 */ }\n", [`${J}B.java`]: "class B {\n  long x;\n}\n", [`${J}G.java`]: "class G { /* new */ }\n" };
    const origin = new MemoryOriginSource({ "v3.10.0": v3100, "v5.0.7": v507 }, { "v5.0.7": catalog.source.commit });
    const readTarget = async (paths) => new Map(paths.map((p) => [p, origin.contentOf("v5.0.7", p)]).filter(([, b]) => b));
    const makeProject = (name) => {
      const dir = path.join(root, name);
      write(dir, "pom.xml", `<project><properties><egovframework.rte.version>3.10.0</egovframework.rte.version></properties><dependencies>
<dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.ptl.mvc</artifactId><version>\${egovframework.rte.version}</version></dependency>
</dependencies></project>\n`);
      write(dir, `${J}A.java`, v3100[`${J}A.java`]);
      write(dir, `${J}B.java`, "class B {\n  int x; // user\n}\n");
      return dir;
    };
    // dryRun: 원본 식별 → 분류 두 단계, 단조 증가·total 도달
    const p1 = makeProject("reasm-1");
    const pd = collectProgress();
    const dry = await reassembleComponents({ projectDir: p1, origin, progress: pd });
    assert(dry.dryRun && dry.origin.tag === "v3.10.0", "reassemble(dryRun): 원본 v3.10.0 식별");
    assert(pd.events.length >= 3 && monotonic(pd.events) && endsAtTotal(pd.events) && sameTotal(pd.events) && pd.events[0].message === "identify origin" && pd.events.some((e) => e.message === "classify files"), `reassemble(dryRun): 단계 보고·단조·완료 (${pd.events.map((e) => `${e.progress}/${e.total}:${e.message}`).join(" ")})`);
    // 적용: 수집 → 기록 → 컴파일(가짜 runner) 단계 포함
    const pa = collectProgress();
    const applied = await reassembleComponents({ projectDir: p1, origin, dryRun: false, readTarget, verify: true, runner: abortingRunner(), platform: "linux", progress: pa });
    assert(applied.manifestUpdated && applied.verify?.ran && pa.events.map((e) => e.message).filter((m) => ["identify origin", "classify files", "fetch target files", "write files", "compile"].includes(m)).join() === "identify origin,classify files,fetch target files,write files,compile" && monotonic(pa.events) && endsAtTotal(pa.events) && pa.events.at(-1).total === 5, `reassemble(apply+verify): 5단계 순서·단조·완료 (${pa.events.map((e) => `${e.progress}:${e.message}`).join(" ")})`);
    assert(pa.events.some((e) => /^maven compile: /.test(e.message) && e.progress >= 4 && e.progress <= 5), "reassemble: 컴파일 하위 진행이 4~5 구간으로 보고");
    // 취소: 기록 단계 직전(보고 콜백에서 취소) → transaction 롤백 + AbortError, 프로젝트 트리 해시 불변
    const p2 = makeProject("reasm-2");
    const before = treeHash(p2);
    const ac = new AbortController();
    const pc = collectProgress(ac.signal);
    const origReport = pc.report.bind(pc);
    pc.report = (m, d, t) => { origReport(m, d, t); if (m === "write files") ac.abort(); };
    await rejectsAbort(reassembleComponents({ projectDir: p2, origin, dryRun: false, readTarget, progress: pc }), "reassemble: 기록 단계에서 취소 → AbortError(TransactionError 로 감싸지 않음)");
    assert(treeHash(p2) === before && !existsSync(path.join(p2, ".egovframe-components.json")) && !existsSync(path.join(p2, "migration-backup")) && !existsSync(path.join(p2, `${J}G.java`)) && !readdirSync(p2).some((x) => x.startsWith(".egovframe-write-txn-")), "reassemble: 취소 뒤 프로젝트 트리 해시 동일·매니페스트·백업·staging 없음");
    // 취소: 원본 식별 전(사전 취소)
    const pre = new AbortController(); pre.abort();
    await rejectsAbort(reassembleComponents({ projectDir: p2, origin, progress: collectProgress(pre.signal) }), "reassemble: 사전 취소 → AbortError");
    assert(treeHash(p2) === before, "reassemble: 사전 취소 뒤 트리 불변");
    // progress 없이 동일 동작
    const plain = await reassembleComponents({ projectDir: p2, origin, dryRun: false, readTarget });
    assert(plain.manifestUpdated && readFileSync(path.join(p2, `${J}A.java`), "utf8") === v507[`${J}A.java`], "reassemble: progress 없이 동일 동작");
  }

  // ── rehearseMigration(레거시 픽스처·가짜 runner) ───────────────────────
  {
    const proj = makeLegacy(path.join(root, "legacy"));
    const wsRoot = path.join(root, "rehearsal-ws");
    const REF = `<project><modelVersion>4.0.0</modelVersion><parent><groupId>org.egovframe.web</groupId><artifactId>egovframe-web-config-parent</artifactId><version>5.0.2</version></parent><dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId></dependency></dependencies></project>\n`;
    const before = treeHash(proj);
    // 정상: steps 로 재조립을 빼면 그 단계는 보고하지 않는다
    const p1 = collectProgress();
    const r1 = await rehearseMigration({ projectDir: proj, steps: ["migrate", "verify", "align-pom"], workspaceRoot: wsRoot, runner: abortingRunner(), referencePom: async () => REF, platform: "linux", progress: p1 });
    const PHASES = ["copy project", "reassemble components", "apply migration", "compile", "align pom and compile"];
    const phases = p1.events.filter((e) => PHASES.includes(e.message)).map((e) => e.message);
    assert(r1.original.unchanged && r1.steps.filter((s) => s.ran).every((s) => s.ok), `rehearse: 단계 성공·원본 불변 (${r1.steps.filter((s) => !s.ok).map((s) => s.error).join(" / ")})`);
    assert(phases.join() === "copy project,apply migration,compile,align pom and compile" && monotonic(p1.events) && endsAtTotal(p1.events) && sameTotal(p1.events) && p1.events.at(-1).total === 4, `rehearse: 단계 순서(재조립 제외)·단조·완료 (${p1.events.map((e) => `${e.progress}:${e.message}`).join(" ")})`);
    assert(p1.events.filter((e) => /^maven compile: /.test(e.message)).length === 4, "rehearse: 컴파일 두 번의 하위 진행(각 0/1·1/1)이 보고됨");
    assert(treeHash(proj) === before && readdirSync(path.join(wsRoot)).filter((x) => x !== "records").length === 0, "rehearse: 원본 트리 해시 동일·사본 삭제");
    // 취소: 컴파일(가짜 runner)에서 → AbortError, 단계 실패로 기록하지 않음, 사본 삭제, 원본 불변
    const ac = new AbortController();
    let runs = 0;
    const p2 = collectProgress(ac.signal);
    await rejectsAbort(rehearseMigration({ projectDir: proj, steps: ["migrate", "verify", "align-pom"], workspaceRoot: wsRoot, runner: abortingRunner(() => { runs++; ac.abort(); }), referencePom: async () => REF, platform: "linux", progress: p2 }), "rehearse: 컴파일 중 취소 → AbortError");
    assert(runs === 1 && !p2.events.some((e) => e.message === "align pom and compile"), "rehearse: 취소 뒤 다음 단계(pom 맞춤)를 실행하지 않음");
    assert(readdirSync(wsRoot).filter((x) => x !== "records").length === 0, "rehearse: 취소 뒤 리허설 사본 디렉터리 삭제");
    assert(treeHash(proj) === before, "rehearse: 취소 뒤 원본 트리 해시 동일");
    // 사전 취소: 사본을 만들지 않음
    const pre = new AbortController(); pre.abort();
    await rejectsAbort(rehearseMigration({ projectDir: proj, steps: ["migrate"], workspaceRoot: wsRoot, progress: collectProgress(pre.signal) }), "rehearse: 사전 취소 → AbortError");
    assert(!existsSync(wsRoot) || readdirSync(wsRoot).filter((x) => x !== "records").length === 0, "rehearse: 사전 취소면 사본 없음");
    // progress 없이 동일 동작
    const r3 = await rehearseMigration({ projectDir: proj, steps: ["migrate", "verify"], workspaceRoot: wsRoot, runner: abortingRunner(), referencePom: async () => REF, platform: "linux" });
    assert(r3.original.unchanged && r3.afterAutomation?.success === true, "rehearse: progress 없이 동일 동작");
  }

  // ── prepareOfflineBundle(주입 다운로드) ──────────────────────────────
  {
    const catalog = { repository: "eGovFramework/egovframe-common-components", tag: "v5.0.7", commit: "7912e13ca5a064a4dc81d5772582f928e985e653" };
    const tpls = [{ id: "web", url: "https://media.githubusercontent.com/media/x/web.zip" }, { id: "boot", url: "https://media.githubusercontent.com/media/x/boot.zip" }];
    const osvDump = (await import("adm-zip")).default;
    const z = new osvDump(); z.addFile("GHSA-1.json", Buffer.from(JSON.stringify({ id: "GHSA-1", affected: [] })));
    const bodies = (u) => (u === OSV_MAVEN_DUMP_URL ? z.toBuffer() : Buffer.from(`PK-${u}`));
    const include = ["osv", "components", "templates"];
    const base = { catalog, templateList: tpls, serverVersion: "1.2.0", include, now: () => Date.UTC(2026, 9, 19) };
    // dryRun 은 보고 없음
    const p0 = collectProgress();
    const plan = await prepareOfflineBundle({ ...base, outputDir: path.join(root, "bundle-0"), download: async (u) => ({ buffer: bodies(u), lastModified: null }), progress: p0 });
    assert(plan.dryRun && p0.events.length === 0, "prepareOfflineBundle(dryRun): 진행 보고 없음");
    // 정상: 항목별 다운로드 보고(total 고정) → 기록 → 완료
    const out1 = path.join(root, "bundle-1");
    const p1 = collectProgress();
    const seen = [];
    const r1 = await prepareOfflineBundle({ ...base, outputDir: out1, dryRun: false, download: async (u, signal) => { seen.push(signal === p1.signal); return { buffer: bodies(u), lastModified: null }; }, progress: p1 });
    assert(r1.written && existsSync(path.join(out1, "bundle-manifest.json")) && r1.items.length === 4, "prepareOfflineBundle: 주입 다운로드로 생성");
    const dls = p1.events.filter((e) => /^download \d+\/4 /.test(e.message));
    assert(dls.length === 5 && dls.map((e) => e.message.split(" ")[1]).join() === "1/4,2/4,3/4,4/4,4/4" && dls.every((e) => e.progress >= 0 && e.progress <= 1), `prepareOfflineBundle: 항목별 다운로드 보고(x/4, 0~1 구간) (${dls.map((e) => e.message).join("; ")})`);
    assert(monotonic(p1.events) && endsAtTotal(p1.events) && sameTotal(p1.events) && p1.events.at(-1).total === 2 && p1.events.some((e) => e.message === "write bundle"), `prepareOfflineBundle: 단조·total=2(다운로드·기록) 도달 (${p1.events.map((e) => `${e.progress}:${e.message}`).join(" ")})`);
    assert(seen.length === 4 && seen.every(Boolean), "prepareOfflineBundle: download 에 취소 signal 전달");
    // 취소: 두 번째 다운로드 중 → AbortError, 부분 번들(스테이징)·출력 디렉터리 없음
    const out2 = path.join(root, "bundle-2");
    const ac = new AbortController();
    let calls = 0;
    const p2 = collectProgress(ac.signal);
    await rejectsAbort(prepareOfflineBundle({ ...base, outputDir: out2, dryRun: false, download: async (u) => { calls++; if (calls === 2) ac.abort(); return { buffer: bodies(u), lastModified: null }; }, progress: p2 }), "prepareOfflineBundle: 다운로드 중 취소 → AbortError");
    assert(calls === 2 && !existsSync(out2) && noPartial(root), "prepareOfflineBundle: 취소 뒤 다음 항목 미실행·부분 번들 삭제");
    // 사전 취소: 스테이징도 만들지 않음
    const pre = new AbortController(); pre.abort();
    await rejectsAbort(prepareOfflineBundle({ ...base, outputDir: path.join(root, "bundle-3"), dryRun: false, download: async (u) => ({ buffer: bodies(u), lastModified: null }), progress: collectProgress(pre.signal) }), "prepareOfflineBundle: 사전 취소 → AbortError");
    assert(!existsSync(path.join(root, "bundle-3")) && noPartial(root), "prepareOfflineBundle: 사전 취소면 아무것도 만들지 않음");
    // progress 없이 동일 동작
    const r4 = await prepareOfflineBundle({ ...base, outputDir: path.join(root, "bundle-4"), dryRun: false, download: async (u) => ({ buffer: bodies(u), lastModified: null }) });
    assert(r4.written, "prepareOfflineBundle: progress 없이 동일 동작");
  }
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (process.exitCode) { console.error(`FAILED (${n} assertions)`); process.exit(1); }
console.log(`OK (${n} assertions)`);
