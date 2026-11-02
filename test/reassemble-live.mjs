// node test/reassemble-live.mjs — 공통컴포넌트 재조립 실제 경로(v0.38): 공식 저장소 git 원본 태그 식별 + 고정 아카이브(sha256 검증)로 적용.
// 픽스처: 공식 공통컴포넌트 v3.10.0 부분 트리(회귀 코퍼스 캐시)에서 bbs·cmm 소스를 복사하고 파일 2개를 고친 프로젝트.
// 확인: 원본 v3.10.0 식별·사용자 수정 2·dryRun 무기록 → 적용 후 목표 파일 blob = v5.0.7 tree, 패치 2, 매니페스트, validate 누락 0, upgrade 미리보기 변경 0.
// v1.12 reapply: 같은 트리에 알려진 수정 4건(파일 끝 주석 2, 5.x 가 손댄 줄의 기본값 1, 메시지 번들 키 추가 1)을 넣고 reapply=true 로 적용 → 자동 3·충돌 1(BoardVO), 합친 파일에 사용자 줄 유지, 충돌 파일은 표식 없는 v5.0.7 본, upgrade 미리보기 변경 0.
// (git·네트워크 필요, CI integration 전용. 캐시: .corpus-cache·EGOVFRAME_CACHE_DIR)
import * as api from "../dist/index.js";
import { loadCorpus, materializeEntry } from "../scripts/corpus-lib.mjs";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }

const corpus = loadCorpus();
const entry = corpus.entries.find((e) => e.id === "cc-3.10.0");
const { dir: src } = materializeEntry(corpus, entry);
const proj = mkdtempSync(path.join(tmpdir(), "egov-reasm-live-"));
try {
  const catalog = api.loadCatalog();
  const comps = ["cmm", "bbs"].map((id) => catalog.components.find((c) => c.id === id));
  cpSync(path.join(src, "pom.xml"), path.join(proj, "pom.xml"));
  for (const c of comps) for (const p of c.pathPrefixes) if (existsSync(path.join(src, p))) { mkdirSync(path.dirname(path.join(proj, p)), { recursive: true }); cpSync(path.join(src, p), path.join(proj, p), { recursive: true }); }
  const J = "src/main/java/egovframework/com/cop/bbs/";
  appendFileSync(path.join(proj, J, "service/Blog.java"), "\n// 사용자 변경 1\n");
  appendFileSync(path.join(proj, J, "service/BlogUser.java"), "\n// 사용자 변경 2\n");

  const t0 = Date.now();
  const dry = await api.reassembleComponents({ projectDir: proj, components: ["cmm", "bbs"] });
  assert(dry.origin.tag === "v3.10.0" && dry.origin.candidates[0].ratio > 0.95, `원본 태그 v3.10.0 식별(${dry.origin.candidates.map((c) => `${c.tag} ${Math.round(c.ratio * 100)}%`).join(" · ")}, ${Date.now() - t0}ms)`);
  assert(dry.summary["user-modified"] === 2 && dry.summary.unverified === 0 && dry.summary.unchanged > 50 && dry.summary.new > 100 && dry.summary["removed-unchanged"] >= 1, `분류: 사용자 수정 2·교체 ${dry.summary.unchanged}·신규 ${dry.summary.new}·5.x 제거 ${dry.summary["removed-unchanged"]}`);
  assert(dry.files.some((f) => f.path.endsWith("cmm/util/EgovMybaitsUtil.java") && f.state === "removed-unchanged"), "규칙의 제거 클래스(EgovMybaitsUtil)가 5.x 제거 파일로 잡힘");
  assert(!existsSync(path.join(proj, ".egovframe-components.json")) && !existsSync(path.join(proj, "migration-backup")), "dryRun 무기록");

  const r = await api.reassembleComponents({ projectDir: proj, components: ["cmm", "bbs"], dryRun: false });
  assert(r.manifestUpdated && r.worklist.filter((w) => w.kind === "reapply-patch" && w.patch).length === 2, `적용: 매니페스트·패치 2개 (${r.backupDir})`);
  const origin = new api.GitOriginSource();
  const target = await origin.listBlobs("v5.0.7", comps.flatMap((c) => c.pathPrefixes));
  const written = r.files.filter((f) => f.action === "replace" || f.action === "add");
  const mismatch = written.filter((f) => target.has(f.path) && api.gitBlobId(readFileSync(path.join(proj, f.path))) !== target.get(f.path));
  assert(written.length > 150 && mismatch.length === 0, `교체·추가 ${written.length}개 파일이 v5.0.7 tree blob 과 일치 (불일치 ${mismatch.length})`);
  const patch = readFileSync(path.join(proj, r.worklist.find((w) => w.path.endsWith("service/Blog.java")).patch), "utf8");
  assert(patch.includes("+// 사용자 변경 1") && patch.includes("--- a/src/main/java/egovframework/com/cop/bbs/service/Blog.java"), "패치에 사용자 변경");
  const v = await api.validateProject({ projectDir: proj });
  assert(v.manifestFound && v.components.every((c) => c.missing === 0), `validate: 누락 0 (${v.components.map((c) => `${c.id}:${c.files}`).join(", ")})`);
  const u = await api.upgradeProject({ projectDir: proj, dryRun: true });
  assert(u.summary.update === 0 && u.summary.conflict === 0 && u.summary.removed === 0 && u.summary.added === 0, `upgrade 미리보기: 변경 0 (${JSON.stringify(u.summary)})`);
  writeFileSync(path.join(proj, "probe.txt"), "x");

  // v1.12 reapply (실자산)
  const p2 = mkdtempSync(path.join(tmpdir(), "egov-reasm-live-reapply-"));
  try {
    cpSync(path.join(src, "pom.xml"), path.join(p2, "pom.xml"));
    for (const c of comps) for (const p of [...c.pathPrefixes, ...(c.messageBundles ?? [])]) if (existsSync(path.join(src, p))) { mkdirSync(path.dirname(path.join(p2, p)), { recursive: true }); cpSync(path.join(src, p), path.join(p2, p), { recursive: true }); }
    const edit = (rel, f) => writeFileSync(path.join(p2, rel), f(readFileSync(path.join(p2, rel), "utf8")));
    appendFileSync(path.join(p2, J, "service/Blog.java"), "\n// 사용자 변경 1\n");
    appendFileSync(path.join(p2, J, "service/BlogUser.java"), "\n// 사용자 변경 2\n");
    edit(`${J}service/BoardVO.java`, (t) => t.replace('private String searchCnd = "";', 'private String searchCnd = "0";')); // 5.0.7 이 같은 자리를 고침(공백·Lombok) → 충돌
    const bundle = comps[1].messageBundles[0];
    appendFileSync(path.join(p2, bundle), "\ncop.bbs.custom=user\n");
    const t1 = Date.now();
    const r2 = await api.reassembleComponents({ projectDir: p2, components: ["cmm", "bbs"], dryRun: false, reapply: true });
    const rp = r2.reapply;
    const st = (rel) => rp.entries.find((e) => e.path === rel)?.status;
    assert(r2.origin.tag === "v3.10.0" && rp.reapplied === 3 && rp.conflicts === 1 && rp.absorbed === 0 && rp.binary === 0 && rp.errors === 0, `reapply: 자동 3·충돌 1 (${rp.entries.map((e) => `${path.basename(e.path)} ${e.status}`).join(", ")}, ${Date.now() - t1}ms)`);
    assert(st(`${J}service/Blog.java`) === "clean" && st(`${J}service/BlogUser.java`) === "clean" && st(bundle) === "clean" && st(`${J}service/BoardVO.java`) === "conflict", "파일 끝 주석 2·메시지 키 추가는 깨끗한 병합, 5.x 가 손댄 줄은 충돌");
    const blog = readFileSync(path.join(p2, J, "service/Blog.java"), "utf8");
    assert(blog.includes("// 사용자 변경 1") && api.gitBlobId(Buffer.from(blog.replace("\n// 사용자 변경 1\n", ""))) === target.get(`${J}service/Blog.java`), "합친 Blog.java = v5.0.7 본 + 사용자 줄");
    assert(readFileSync(path.join(p2, bundle), "utf8").includes("cop.bbs.custom=user"), "메시지 번들에 사용자 키 유지(keep-reference → 병합 교체)");
    const vo = readFileSync(path.join(p2, J, "service/BoardVO.java"));
    assert(!vo.includes("<<<<<<<") && api.gitBlobId(vo) === target.get(`${J}service/BoardVO.java`) && r2.worklist.some((w) => w.kind === "reapply-patch" && w.path === `${J}service/BoardVO.java` && /충돌 1곳/.test(w.detail) && existsSync(path.join(p2, w.patch))), "충돌 파일은 표식 없이 v5.0.7 본, 작업 목록에 충돌 수·패치");
    assert(r2.worklist.filter((w) => w.kind === "reapply-patch").length === 1, "작업 목록의 재적용 항목은 충돌 1건뿐");
    const u2 = await api.upgradeProject({ projectDir: p2, dryRun: true });
    assert(u2.summary.update === 0 && u2.summary.conflict === 0 && u2.summary["user-modified"] === 0, `reapply 뒤 upgrade 미리보기: 변경 0 (${JSON.stringify(u2.summary)})`);
  } finally {
    rmSync(p2, { recursive: true, force: true });
  }
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
} finally {
  rmSync(proj, { recursive: true, force: true });
}
if (process.exitCode) console.error(`reassemble-live FAIL (${n})`); else console.log(`reassemble-live OK (${n})`);
