// CycloneDX 1.6 공식 JSON 스키마 검증 도우미(테스트 전용) — test/fixtures/cyclonedx-1.6 (specification 태그 1.6.1)
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const dir = new URL("./fixtures/cyclonedx-1.6/", import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);
// draft-2019 확장 형식: 형식 자체보다 구조 검증이 목적이므로 문자열이면 통과
ajv.addFormat("iri-reference", true);
ajv.addFormat("idn-email", true);
ajv.addSchema(load("spdx.schema.json"), "spdx.schema.json");
ajv.addSchema(load("jsf-0.82.schema.json"), "jsf-0.82.schema.json");
const validateFn = ajv.compile(load("bom-1.6.schema.json"));

/** 오류가 없으면 null, 있으면 앞쪽 오류 문자열 */
export function validateCycloneDx(doc) {
  return validateFn(doc) ? null : validateFn.errors.slice(0, 5).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}
