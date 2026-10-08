// node test/rehearse-live.mjs — 전환 리허설(v0.41) 실자산 검증: 공식 공통컴포넌트 v4.3.2 전체 트리(단일 war, 6,523 파일)를
// 내려받아(커밋 고정, 캐시) 재조립 → 전환 적용 → 컴파일 → pom 맞춤 → 컴파일. 네트워크·git·JDK 17·Maven 필요(CI 통합 전용).
import { rehearseMigration, renderRehearsalMarkdown, fingerprintTree } from "../dist/index.js";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { loadCorpus } from "../scripts/corpus-lib.mjs";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const within = (actual, expected, pct) => Math.abs(actual - expected) <= Math.max(1, Math.round(expected * pct));

const corpus = loadCorpus();
const R = corpus.rehearsal;
// 전체 트리(≈220MB)는 코퍼스 캐시(actions/cache)에 넣지 않고 임시 디렉터리에 받는다(아카이브 ≈38MB). REHEARSE_TREE 로 기존 트리를 줄 수 있다.
const own = !process.env.REHEARSE_TREE;
const tmp = own ? mkdtempSync(path.join(tmpdir(), "egov-rehearse-live-")) : null;
const tree = process.env.REHEARSE_TREE ? path.resolve(process.env.REHEARSE_TREE) : path.join(tmp, `cc-${R.tag.replace(/^v/, "")}`);
try {
  if (!existsSync(path.join(tree, "pom.xml"))) {
    mkdirSync(tree, { recursive: true });
    const url = `https://codeload.github.com/${corpus.repository}/tar.gz/${R.commit}`;
    const res = await fetch(url, { headers: { "User-Agent": "egovframe-scaffold-mcp" } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const tgz = path.join(tmp ?? tmpdir(), `cc-${R.commit.slice(0, 7)}.tar.gz`);
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    const t = spawnSync("tar", ["xzf", tgz, "-C", tree, "--strip-components=1"], { encoding: "utf8" });
    rmSync(tgz, { force: true });
    if (t.status !== 0) throw new Error(`tar 실패: ${t.stderr}`);
  }
  const fp = fingerprintTree(tree);
  assert(fp.files === R.files, `공식 ${R.tag}(${R.commit.slice(0, 7)}) 전체 트리 파일 ${fp.files} = ${R.files}`);

  const t0 = Date.now();
  const r = await rehearseMigration({ projectDir: tree, timeoutMs: 1_200_000 });
  const md = renderRehearsalMarkdown(r);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n\n`);
  const E = R.expected;
  const failed = r.steps.filter((s) => !s.ok);
  assert(failed.length === 0, `단계 4개 성공 (${failed.map((s) => `${s.step}: ${s.error}`).join(" / ") || "모두 통과"}, ${Math.round((Date.now() - t0) / 1000)}초)`);
  assert(r.original.unchanged && fingerprintTree(tree).sha256 === fp.sha256 && r.workspace.path === null, "원본 트리 불변·사본 정리");
  assert(r.reassemble?.origin === E.origin && within(r.reassemble.actions.replace, E.reassembleReplace, R.tolerance.pct) && within(r.reassemble.actions.add, E.reassembleAdd, R.tolerance.pct) && within(r.reassemble.actions.delete, E.reassembleDelete, R.tolerance.pct), `재조립: 원본 ${r.reassemble?.origin} · 교체 ${r.reassemble?.actions.replace} · 추가 ${r.reassemble?.actions.add} · 삭제 ${r.reassemble?.actions.delete}`);
  assert(within(r.migrate?.applied.items ?? -1, E.migrateApplied, R.tolerance.pct), `전환 적용 자동 ${r.migrate?.applied.items}건 ≈ ${E.migrateApplied}`);
  const A = r.afterAutomation?.analysis, B = r.afterPomAlignment?.analysis;
  assert(A && within(A.errors, E.afterAutomationErrors, R.tolerance.pct), `자동 단계 후 컴파일 오류 ${A?.errors} ≈ ${E.afterAutomationErrors}(±${R.tolerance.pct * 100}%) — javac 100개 상한 없이 셈`);
  assert(A && (A.missingPackage + A.cascade) / A.errors >= E.afterAutomationMissingShare, `그중 누락 패키지·연쇄 ${A ? A.missingPackage + A.cascade : "?"}건(${A ? Math.round(((A.missingPackage + A.cascade) / A.errors) * 100) : "?"}%) — pom 의존성 문제`);
  assert(B && B.errors <= E.afterPomAlignmentMaxErrors && r.afterPomAlignment.parent?.startsWith("org.egovframe.web:egovframe-web-config-parent"), `pom 맞춤 후 남는 오류 ${B?.errors}건 ≤ ${E.afterPomAlignmentMaxErrors}`);
  assert(r.worklist[0]?.kind === "align-pom", "작업 목록 1순위는 pom 맞춤");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
if (process.exitCode) console.error(`rehearse-live FAIL (${n} assertions)`); else console.log(`rehearse-live OK (${n} assertions)`);
