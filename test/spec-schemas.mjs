// SPDX 2.3·GitLab CI 공식 JSON 스키마 검증 도우미(테스트 전용, v0.43) — test/fixtures/spdx-2.3, test/fixtures/gitlab-ci
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const mk = () => { const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true }); addFormats(ajv); return ajv; };
const fmt = (fn) => fn.errors.slice(0, 5).map((e) => `${e.instancePath || "/"} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ""}`).join("; ");

const spdxFn = mk().compile(load("./fixtures/spdx-2.3/spdx-schema.json"));
/** SPDX 2.3 JSON 스키마 — 오류가 없으면 null */
export function validateSpdx(doc) { return spdxFn(doc) ? null : fmt(spdxFn); }

const gitlabAjv = mk();
gitlabAjv.addFormat("uri-reference", true);
const gitlabFn = gitlabAjv.compile(load("./fixtures/gitlab-ci/ci.json"));
/** `.gitlab-ci.yml` 텍스트 — YAML 해석 후 GitLab CI 스키마. 오류가 없으면 null */
export function validateGitlabCi(text) {
  let doc;
  try { doc = parseYaml(text); } catch (e) { return `YAML 해석 실패: ${e.message}`; }
  return gitlabFn(doc) ? null : fmt(gitlabFn);
}
export { parseYaml };

// v0.44: SARIF 2.1.0(OASIS, draft-04) — 최상위 id → $id, $schema 제거 후 ajv(draft-07)로 컴파일
const sarifSchema = load("./fixtures/sarif-2.1.0/sarif-schema-2.1.0.json");
sarifSchema.$id = sarifSchema.id; delete sarifSchema.id; delete sarifSchema.$schema;
const sarifFn = mk().compile(sarifSchema);
/** SARIF 2.1.0 — 오류가 없으면 null */
export function validateSarif(doc) { return sarifFn(doc) ? null : fmt(sarifFn); }
