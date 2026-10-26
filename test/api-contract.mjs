// node test/api-contract.mjs — 공개 API 계약(v1.0 버전 정책) 게이트 (오프라인)
//   (1) 지금 코드의 계약 = test/fixtures/api-contract.json (다르면 변경을 minor/major 로 분류해 보여 주고 실패)
//   (2) 분류기·버전 증가 폭 검사 단위 단언 (3) deprecated 별칭(check_egovframe_secure_coding top → topN)
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(path.join(root, "test/fixtures/api-contract.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── (1) 스냅샷 ───────────────────────────────────────
const now = await m.buildApiContract();
const diff = m.compareContracts(fixture.contract, now);
assert(diff.changes.length === 0, `계약이 스냅샷과 같음${diff.changes.length ? ` — ${diff.level}:\n${diff.changes.map((c) => `  ${c.level} ${c.path} — ${c.what}`).join("\n")}\n  의도한 변경이면 npm run api-contract:update 후 diff 를 검토하세요` : ""}`);
assert(Object.keys(now.tools).length === 36 && Object.values(now.tools).filter((t) => t.output).length === 15, `도구 36종 · 구조화 출력 15종`);
assert(now.node === pkg.engines.node && now.node === ">=22", `engines.node ${now.node}`);
assert(JSON.stringify(now.cli.exitCodes) === JSON.stringify({ ok: 0, failOn: 2, error: 3, usage: 64 }) && Object.keys(now.cli.commands).length === 13, "CLI 명령 13종·종료 코드 0/2/3/64");
assert(["base", "change", "version"].every((k) => typeof fixture[k] === "string") && ["none", "minor", "major"].includes(fixture.change), `스냅샷 머리말 version ${fixture.version} · base ${fixture.base} · change ${fixture.change}`);
assert(!JSON.stringify(now).includes("\"description\""), "계약에 설명 문구 없음(문구 변경은 계약 변경이 아님)");
assert(JSON.stringify(m.compareContracts(now, clone(now))) === JSON.stringify({ level: "none", changes: [] }), "같은 계약 비교 → none");

// ── (2) 분류기 ───────────────────────────────────────
const T = "check_egovframe_dependencies";
const level = (mut) => { const b = clone(now); mut(b); return m.compareContracts(now, b).level; };
const cases = [
  ["파라미터 제거", (b) => delete b.tools[T].input.properties.offline, "major"],
  ["선택 파라미터 추가", (b) => { b.tools[T].input.properties.extra = { type: "boolean" }; }, "minor"],
  ["필수 파라미터 추가", (b) => { b.tools[T].input.properties.extra = { type: "string" }; b.tools[T].input.required.push("extra"); }, "major"],
  ["기존 파라미터 필수화", (b) => { b.tools[T].input.required.push("offline"); }, "major"],
  ["필수 → 선택", (b) => { b.tools[T].input.required = b.tools[T].input.required.filter((x) => x !== "projectDir"); }, "minor"],
  ["기본값 변경", (b) => { b.tools[T].input.properties.offline.default = false; }, "major"],
  ["타입 변경", (b) => { b.tools[T].input.properties.offline.type = "string"; }, "major"],
  ["입력 허용값 추가", (b) => { b.tools[T].input.properties.format.enum.push("sarif"); }, "minor"],
  ["입력 허용값 제거", (b) => { b.tools[T].input.properties.format.enum = ["json"]; }, "major"],
  ["최댓값 축소", (b) => { b.tools.check_egovframe_secure_coding.input.properties.maxFindings.maximum = 100; }, "major"],
  ["최댓값 확대", (b) => { b.tools.check_egovframe_secure_coding.input.properties.maxFindings.maximum = 50_000; }, "minor"],
  ["출력 필드 제거", (b) => delete b.tools[T].output.properties.summary, "major"],
  ["출력 필드 추가", (b) => { b.tools[T].output.properties.extra = { type: "number" }; }, "minor"],
  ["구조화 출력 제거", (b) => { b.tools[T].output = null; }, "major"],
  ["도구 제거", (b) => delete b.tools[T], "major"],
  ["도구 추가", (b) => { b.tools.future_egovframe_tool = { input: { type: "object", properties: {} }, output: null, deprecated: {} }; }, "minor"],
  ["CLI 명령 제거", (b) => delete b.cli.commands.check, "major"],
  ["CLI 명령 추가", (b) => { b.cli.commands.future = "future_egovframe_tool"; }, "minor"],
  ["종료 코드 변경", (b) => { b.cli.exitCodes.failOn = 1; }, "major"],
  ["환경 변수 제거", (b) => { b.env = b.env.filter((e) => e !== "EGOVFRAME_LANG"); }, "major"],
  ["Node 최소 버전 상향", (b) => { b.node = ">=24"; }, "major"],
  ["Node 최소 버전 하향", (b) => { b.node = ">=20"; }, "minor"],
  ["deprecated 표시", (b) => { b.tools[T].deprecated = { offline: "osv" }; }, "minor"],
];
cases.push(["입력 pattern 변경", (b) => { b.tools[T].input.properties.format.pattern = "^x$"; }, "major"]);
cases.push(["검토된 pattern 확장(PATTERN_WIDENINGS)", (b) => { const w = m.PATTERN_WIDENINGS[0]; const [tool, param] = w.at.split("."); b.tools[tool].input.properties[param].pattern = w.to; }, now.tools.migrate_egovframe_project.input.properties.target.pattern === m.PATTERN_WIDENINGS[0].to ? "none" : "minor"]);
for (const [name, mut, want] of cases) { const got = level(mut); assert(got === want, `분류: ${name} → ${want}${got === want ? "" : ` (got ${got})`}`); }
// 검토된 pattern 확장: 옛 pattern 에 맞는 표본이 새 pattern 에도 모두 맞아야 한다(넓히기만 함)
for (const w of m.PATTERN_WIDENINGS) {
  const from = new RegExp(w.from), to = new RegExp(w.to);
  assert(w.samples.length >= 3 && w.samples.every((x) => from.test(x)) && w.samples.every((x) => to.test(x)), `pattern 확장 ${w.at}(${w.since}): 옛 값 ${w.samples.length}개가 새 pattern 에도 맞음`);
  assert(now.tools[w.at.split(".")[0]].input.properties[w.at.split(".")[1]].pattern === w.to, `pattern 확장 ${w.at}: 지금 계약의 pattern 이 확장 결과와 같음`);
}
const norm = m.normalizeSchema({ type: "object", description: "x", title: "y", properties: { b: { type: "string", description: "z" }, a: { type: "number", default: 1 } }, required: ["b"], additionalProperties: false, $schema: "s" });
assert(JSON.stringify(norm) === JSON.stringify({ type: "object", required: ["b"], properties: { a: { type: "number", default: 1 }, b: { type: "string" } } }), "normalizeSchema: 설명·제목·$schema 제거, 키 정렬");

const bumps = [
  ["0.47.0", "1.0.0", "major", true], ["0.47.0", "0.48.0", "major", true], ["0.47.0", "0.47.1", "major", false],
  ["1.0.0", "2.0.0", "major", true], ["1.0.0", "1.1.0", "major", false], ["1.0.0", "1.1.0", "minor", true],
  ["1.0.0", "1.0.1", "minor", false], ["1.2.3", "2.0.0", "minor", true], ["1.2.3", "1.2.4", "none", true],
];
for (const [b, v, l, ok] of bumps) assert(m.checkVersionBump(b, v, l).ok === ok, `증가 폭: ${b} → ${v} (${l}) ${ok ? "허용" : "거부"}`);
assert(m.checkVersionBump(fixture.base, pkg.version, fixture.change).ok, `이번 릴리스: ${fixture.base} → ${pkg.version} (${fixture.change}) 허용`);
assert(fixture.version === pkg.version || fixture.change === "none" || m.compareContracts(fixture.contract, now).level === "none", "스냅샷 버전 정합");

// ── (3) deprecated 별칭 ───────────────────────────────
assert(now.tools.check_egovframe_secure_coding.deprecated.top === "topN" && m.DEPRECATED_PARAMS.check_egovframe_secure_coding.top.removeIn === "2.0.0", "deprecated 목록: secure_coding top → topN (2.0.0 제거)");
const { args: moved, warnings } = m.applyDeprecatedParams("check_egovframe_secure_coding", { top: 3 });
assert(moved.topN === 3 && !("top" in moved) && warnings.length === 1, "applyDeprecatedParams: 옛 이름 값을 새 이름으로 옮기고 경고 1건");
assert(m.applyDeprecatedParams("check_egovframe_secure_coding", { top: 3, topN: 5 }).args.topN === 5, "새 이름이 있으면 새 이름 우선");
assert(m.applyDeprecatedParams("check_egovframe_dependencies", { offline: true }).warnings.length === 0, "deprecated 없는 도구는 그대로");

const proj = mkdtempSync(path.join(tmpdir(), "egov-contract-"));
try {
  const dir = path.join(proj, "src/main/java/egovframework/example");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(proj, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>g</groupId><artifactId>a</artifactId><version>1</version></project>");
  writeFileSync(path.join(dir, "A.java"), "package egovframework.example;\npublic class A {\n  void a() { try { } catch (Exception e) { e.printStackTrace(); } }\n  void b() { try { } catch (Exception e) { e.printStackTrace(); } }\n  void c() { try { } catch (Exception e) { e.printStackTrace(); } }\n}\n");
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  const call = async (a) => (await client.callTool({ name: "check_egovframe_secure_coding", arguments: { projectDir: proj, ...a } })).content.map((c) => c.text);
  const viaOld = await call({ top: 1 }), viaNew = await call({ topN: 1 }), dflt = await call({});
  assert(viaOld.length === 2 && /deprecated/.test(viaOld[1]) && /topN/.test(viaOld[1]), "옛 이름 top: 응답에 별도 경고 항목");
  assert(viaNew.length === 1 && viaOld[0] === viaNew[0] && /상위 1건/.test(viaNew[0]), "top=1 과 topN=1 의 본문이 같음");
  assert(dflt.length === 1 && /상위 3건/.test(dflt[0]), "둘 다 없으면 기본 40(여기선 3건 전부)");
  const json = await call({ top: 1, format: "json" });
  assert(json.length === 2 && JSON.parse(json[0]).findings.length >= 3, "format=json 본문은 경고와 섞이지 않고 그대로 파싱됨");
  await client.close(); await server.close();
} finally { rmSync(proj, { recursive: true, force: true }); }

if (process.exitCode) console.error(`api-contract FAIL (${n} assertions)`); else console.log(`api-contract OK (${n} assertions)`);
