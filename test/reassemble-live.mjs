// node test/reassemble-live.mjs — 공통컴포넌트 재조립 실제 경로(v0.38): 공식 저장소 git 원본 태그 식별 + 고정 아카이브(sha256 검증)로 적용.
// 픽스처: 공식 공통컴포넌트 v3.10.0 부분 트리(회귀 코퍼스 캐시)에서 bbs·cmm 소스를 복사하고 파일 2개를 고친 프로젝트.
// 확인: 원본 v3.10.0 식별·사용자 수정 2·dryRun 무기록 → 적용 후 목표 파일 blob = v5.0.7 tree, 패치 2, 매니페스트, validate 누락 0, upgrade 미리보기 변경 0.
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
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
} finally {
  rmSync(proj, { recursive: true, force: true });
}
if (process.exitCode) console.error(`reassemble-live FAIL (${n})`); else console.log(`reassemble-live OK (${n})`);
