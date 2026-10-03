#!/usr/bin/env node
/**
 * 회귀 코퍼스 기대값 생성 → catalog/migration-corpus.json (v0.37)
 *
 *   공식 egovframe-common-components 의 두 태그(v3.10.0: 3.x 좌표 · v4.3.2: 4.x 좌표, 4.x 마지막) 부분 트리에
 *   진단·dryRun 적용·의존성 점검·평가서를 돌려 종류별 건수·unknown·재조립 권고·적용 계획 수·등급을 기대값으로 고정한다.
 *   test/migrate-corpus.mjs 가 같은 측정을 다시 해 ±허용 범위(tolerance) 안인지 단언한다 — 규칙·기준·스캐너가 바뀌어 결과가
 *   의도치 않게 움직이면 거기서 잡힌다. 의도한 변경이면 이 스크립트로 기대값을 다시 만들고 변경 이력에 적는다.
 *
 * 사용법:
 *   npm run build && node scripts/generate-migration-corpus.mjs            # .corpus-cache 에 부분 클론(없으면) 후 기대값 갱신
 *   EGOV_CORPUS_CACHE=/path node scripts/generate-migration-corpus.mjs     # 캐시 위치 지정
 *   node scripts/generate-migration-corpus.mjs --check                     # 기록하지 않고 현재 기대값과 차이만 출력
 */
import * as fs from "node:fs";
import { CORPUS_PATH, loadCorpus, materializeEntry, measureEntry, compareEntry } from "./corpus-lib.mjs";
import * as api from "../dist/index.js";

const check = process.argv.includes("--check");
const corpus = loadCorpus();
let changed = false;
for (const entry of corpus.entries) {
  const { dir, cached } = materializeEntry(corpus, entry);
  const t0 = Date.now();
  const actual = await measureEntry(api, dir);
  const diffs = compareEntry(entry.expected ?? {}, actual, corpus.tolerance);
  console.log(`${entry.id} (${entry.tag} ${entry.commit.slice(0, 7)}, ${cached ? "캐시" : "클론"}, ${Date.now() - t0}ms): 항목 ${actual.migration.items} = 자동 ${actual.migration.auto} + 수동 ${actual.migration.manual} · 재조립 ${actual.migration.reassemble} · 의존성 ${actual.dependencies.findings}(기준 없음 ${actual.dependencies.unknown.length}) · 등급 ${actual.grades.migration}/${actual.grades.supplyChain}`);
  if (diffs.length) { console.log(`  기대값과 차이 ${diffs.length}건:`); for (const d of diffs) console.log(`  - ${d}`); }
  if (!check) { entry.expected = actual; changed = changed || diffs.length > 0; }
}
if (!check) {
  corpus.generatedAt = new Date().toISOString().slice(0, 10);
  corpus.generatedWith = { version: api.SERVER_VERSION, rulesTag: api.loadMigrationRules().source.toTag, baselineSurveyedAt: api.loadDependencyBaseline().surveyedAt };
  fs.writeFileSync(CORPUS_PATH, `${JSON.stringify(corpus, null, 2)}\n`);
  console.log(`${changed ? "갱신" : "변화 없음"}: ${CORPUS_PATH}`);
}
