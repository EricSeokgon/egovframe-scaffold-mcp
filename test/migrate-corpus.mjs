// node test/migrate-corpus.mjs — 회귀 코퍼스(v0.37): 공식 공통컴포넌트 v3.10.0·v4.3.2 부분 트리에 진단·dryRun 적용·의존성 점검·평가서를
// 돌려 catalog/migration-corpus.json 의 기대값과 ±허용 범위 안에서 같은지 단언한다. (git 부분 클론 → 네트워크, CI integration 전용;
// 캐시 .corpus-cache 가 있으면 오프라인으로 돈다.) 규칙·기준을 의도적으로 바꿨으면 `npm run generate:migration-corpus` 로 기대값을 갱신한다.
import * as api from "../dist/index.js";
import { loadCorpus, materializeEntry, measureEntry, compareEntry, cacheDir } from "../scripts/corpus-lib.mjs";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }

const corpus = loadCorpus();
assert(corpus.entries.length === 2 && corpus.entries.every((e) => e.expected && /^[0-9a-f]{40}$/.test(e.commit)), "코퍼스 항목 2종(기대값·커밋 고정)");
assert(corpus.generatedWith?.rulesTag === api.loadMigrationRules().source.toTag && corpus.generatedWith?.baselineSurveyedAt === api.loadDependencyBaseline().surveyedAt, `기대값을 만든 규칙(${corpus.generatedWith?.rulesTag})·기준(${corpus.generatedWith?.baselineSurveyedAt})이 현재 동봉본과 같음 — 다르면 generate:migration-corpus 로 갱신`);
console.log(`캐시: ${cacheDir()}`);

for (const entry of corpus.entries) {
  let dir;
  try {
    const t0 = Date.now();
    const m = materializeEntry(corpus, entry);
    dir = m.dir;
    console.log(`${entry.id}: ${m.cached ? "캐시 사용" : `부분 클론 ${Date.now() - t0}ms`} (${entry.tag} ${entry.commit.slice(0, 7)})`);
  } catch (e) {
    assert(false, `${entry.id} 트리 준비 실패: ${e.message}`);
    continue;
  }
  const t1 = Date.now();
  const actual = await measureEntry(api, dir);
  const ms = Date.now() - t1;
  const diffs = compareEntry(entry.expected, actual, corpus.tolerance);
  assert(diffs.length === 0, `${entry.id}: 기대값 일치(±${corpus.tolerance.pct * 100}%) — 항목 ${actual.migration.items}(자동 ${actual.migration.auto}·수동 ${actual.migration.manual}) 적용 계획 ${actual.apply.items}건/${actual.apply.files}파일 의존성 ${actual.dependencies.findings} 등급 ${actual.grades.migration}/${actual.grades.supplyChain}, ${ms}ms${diffs.length ? `\n  - ${diffs.join("\n  - ")}` : ""}`);
  // 코퍼스가 지키는 품질 기준(기대값과 별개로 절대 조건)
  assert(actual.migration.sourceEra === entry.era, `${entry.id}: 세대 ${entry.era} 판정`);
  assert(actual.migration.unknownClasses === 0, `${entry.id}: 확인 필요 클래스·알 수 없는 좌표 0건 (${actual.migration.unknownClasses})`);
  assert(actual.dependencies.unknown.length <= 1 && actual.dependencies.unknown.every((c) => c === "xerces:xercesImpl"), `${entry.id}: 기준 없음은 xerces:xercesImpl 뿐 (${actual.dependencies.unknown.join(", ") || "-"})`);
  assert(actual.apply.conflicts === 0 && actual.apply.items === actual.migration.auto && actual.apply.skippedManual === actual.migration.manual, `${entry.id}: dryRun 적용 계획 = 자동 항목 전부, 충돌 0`);
  assert(actual.migration.reassemble >= 100 && actual.migration.byKind["component-reassemble"] === actual.migration.reassemble, `${entry.id}: 공통컴포넌트 전체가 재조립 권고(${actual.migration.reassemble}종)`);
  assert(actual.grades.migration === "D" && actual.grades.supplyChain === "D", `${entry.id}: 공통컴포넌트 전체 트리는 두 축 모두 D (${actual.grades.migration}/${actual.grades.supplyChain})`);
  assert(ms < 60_000, `${entry.id}: 측정 ${ms}ms < 60s`);
}
// 두 세대의 관계: 4.x 는 3.x 보다 패키지 접두어 항목이 없고(이미 org.egovframe) Jakarta 항목은 비슷하다
const e3 = corpus.entries.find((e) => e.id === "cc-3.10.0").expected, e4 = corpus.entries.find((e) => e.id === "cc-4.3.2").expected;
assert(e3.migration.byKind.package > 500 && !e4.migration.byKind.package && e4.migration.byKind["jakarta-package"] > 500 && e3.migration.byKind["jakarta-package"] > 500, "3.x 는 RTE 패키지 접두어 치환이 있고 4.x 는 없음, Jakarta 는 둘 다");
assert(e4.dependencies.vendor.length >= 9 && e4.dependencies.vendor.every((c) => c.startsWith("project:")), `4.3.2 의 system scope 로컬 jar ${e4.dependencies.vendor.length}건은 벤더 배포로 분류`);

if (process.exitCode) console.error(`migrate-corpus FAIL (${n})`); else console.log(`migrate-corpus OK (${n})`);
