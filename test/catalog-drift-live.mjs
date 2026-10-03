// node test/catalog-drift-live.mjs — 규칙·의존성 기준 카탈로그 drift 감시 실제 조회 (네트워크, CI integration 전용)
// upstream 이 실제로 앞서 있을 수 있으므로 drift 유무는 단언하지 않고, 조회 자체(태그 목록·parent 탐침·pom sha256)가 전부 성공하는지와
// 고정 pom 이 아직 같은 내용인지(재배포 없음)만 확인한다. 새 태그·새 parent 가 있으면 경고를 출력해 사람이 보게 한다.
import { checkCatalogDrift, renderCatalogDriftLines } from "../dist/index.js";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }

const r = await checkCatalogDrift();
console.log(renderCatalogDriftLines(r).join("\n"));
assert(r.errors === 0, `조회 실패 0건 (got ${r.errors})`);
assert(r.migrationRules.runtime.seen > 0 && r.migrationRules.runtime.source !== null, `egovframe-runtime 태그 ${r.migrationRules.runtime.seen}개 조회(${r.migrationRules.runtime.source})`);
assert(r.migrationRules.components && r.migrationRules.components.seen > 0, `egovframe-common-components 태그 ${r.migrationRules.components?.seen ?? 0}개 조회`);
assert(r.dependencyBaseline.parents.length === 2 && r.dependencyBaseline.parents.every((p) => p.sha256Changed === false), "고정 parent pom 2종 sha256 동일(재배포 없음)");
assert(r.dependencyBaseline.bootBom && r.dependencyBaseline.bootBom.sha256Changed === false, "spring-boot-dependencies pom sha256 동일");
if (!r.upToDate) console.warn(`::warning::카탈로그 drift 있음 — ${r.warnings.join(" | ")}`);
if (process.exitCode) console.error(`catalog-drift-live FAIL (${n})`); else console.log(`catalog-drift-live OK (${n})`);
