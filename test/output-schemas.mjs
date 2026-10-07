// node test/output-schemas.mjs — 구조화 출력 스키마 ↔ 실제 결과 정합 (오프라인)
import { OUTPUT_SCHEMAS, TOOL_META, READ_ONLY_TOOLS, DESTRUCTIVE_TOOLS, buildServer, diagnoseProject, validateProject, migrateProject, applyMigration, checkDependencies, diagnoseNetwork, generateProjectReport, checkSbom } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
// SDK 는 outputSchema.shape 로 만든 JSON Schema(additionalProperties: false)로 structuredContent 를 검증하므로 최상위 키가 전부 선언돼 있어야 한다
const check = (name, value) => { const r = OUTPUT_SCHEMAS[name].safeParse(value); const extra = Object.keys(value).filter((k) => !(k in OUTPUT_SCHEMAS[name].shape)); assert(r.success && extra.length === 0, `${name} 결과가 outputSchema 통과${r.success ? "" : `: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`}${extra.length ? ` (미선언 키: ${extra.join(", ")})` : ""}`); };

// ── 메타데이터 정합 ───────────────────────────────────
const server = buildServer();
const names = Object.keys(server._registeredTools);
assert(names.length === 30 && names.every((nm) => TOOL_META[nm]) && Object.keys(TOOL_META).every((nm) => names.includes(nm)), "TOOL_META 와 등록 도구 30종 일치");
assert(names.every((nm) => { const t = server._registeredTools[nm]; return typeof t.title === "string" && t.title.length > 0 && t.annotations && typeof t.annotations.readOnlyHint === "boolean"; }), "모든 도구에 title·annotations");
// v0.37: generate_egovframe_report 는 outputPath 로 새 파일을 만들 수 있어 읽기 전용 힌트를 뗐다(14 → 13)
assert(READ_ONLY_TOOLS.length === 13 && DESTRUCTIVE_TOOLS.length === 5, `readOnly 13 · destructive 5 (got ${READ_ONLY_TOOLS.length}/${DESTRUCTIVE_TOOLS.length})`);
assert(READ_ONLY_TOOLS.every((nm) => !DESTRUCTIVE_TOOLS.includes(nm)) && READ_ONLY_TOOLS.every((nm) => TOOL_META[nm].annotations.idempotentHint), "읽기 전용은 파괴적이지 않고 멱등");
for (const nm of ["remove_egovframe_components", "upgrade_egovframe_project", "migrate_egovframe_project", "generate_agents_md", "reassemble_egovframe_components"]) assert(DESTRUCTIVE_TOOLS.includes(nm), `destructiveHint: ${nm}`);
for (const nm of ["list_egovframe_templates", "diagnose_egovframe_project", "validate_egovframe_project", "check_egovframe_dependencies", "diagnose_egovframe_network", "sync_egovframe_catalog"]) assert(READ_ONLY_TOOLS.includes(nm), `readOnlyHint: ${nm}`);
assert(!READ_ONLY_TOOLS.includes("generate_egovframe_report") && TOOL_META.generate_egovframe_report.annotations.destructiveHint === false && TOOL_META.generate_egovframe_report.annotations.openWorldHint === true, "generate_egovframe_report: 비읽기(outputPath)·비파괴(새 파일만)·openWorld(resolve·OSV)");
for (const nm of ["create_egovframe_project", "add_egovframe_components", "get_egovframe_guide", "diagnose_egovframe_network", "build_egovframe_project"]) assert(TOOL_META[nm].annotations.openWorldHint, `openWorldHint: ${nm}`);
for (const nm of ["generate_egovframe_config", "generate_egovframe_crud", "list_egovframe_components", "remove_egovframe_components"]) assert(!TOOL_META[nm].annotations.openWorldHint, `오프라인 도구는 openWorldHint 아님: ${nm}`);
assert(Object.keys(OUTPUT_SCHEMAS).length === 9 && Object.keys(OUTPUT_SCHEMAS).every((nm) => server._registeredTools[nm].outputSchema), "구조화 출력 9종이 등록에 outputSchema 로 반영");
assert(names.filter((nm) => server._registeredTools[nm].outputSchema).length === 9, "outputSchema 는 9종에만");
assert(TOOL_META.generate_egovframe_sbom.annotations.readOnlyHint === false && TOOL_META.generate_egovframe_sbom.annotations.destructiveHint === false && TOOL_META.generate_egovframe_sbom.annotations.openWorldHint === true, "generate_egovframe_sbom: 비읽기·비파괴·openWorld");
assert(!READ_ONLY_TOOLS.includes("check_egovframe_sbom") && !DESTRUCTIVE_TOOLS.includes("check_egovframe_sbom") && TOOL_META.check_egovframe_sbom.annotations.openWorldHint === true, "check_egovframe_sbom: 비읽기(vex 파일)·비파괴(판단 보존)·openWorld(OSV)");
const en = buildServer({ lang: "en" });
assert(names.every((nm) => en._registeredTools[nm].title !== server._registeredTools[nm].title && /^[\x20-\x7E]+$/.test(en._registeredTools[nm].title)), "영문 title 30종(ASCII, 한국어와 다름)");

// ── 실제 결과 ↔ 스키마 ────────────────────────────────
const legacy = mkdtempSync(path.join(tmpdir(), "egovschema-"));
write(legacy, "pom.xml", `<project><properties><egovframework.rte.version>3.10.0</egovframework.rte.version></properties><dependencies>
<dependency><groupId>egovframework.rte</groupId><artifactId>egovframework.rte.ptl.mvc</artifactId><version>\${egovframework.rte.version}</version></dependency>
<dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>3.1.0</version></dependency>
<dependency><groupId>commons-dbcp</groupId><artifactId>commons-dbcp</artifactId><version>1.4</version></dependency>
</dependencies></project>\n`);
write(legacy, "src/main/java/egovframework/com/cmm/Svc.java", "import javax.servlet.http.HttpServletRequest;\nimport egovframework.rte.psl.dataaccess.mapper.Mapper;\nclass Svc {}\n");
write(legacy, "src/main/resources/application.properties", "Globals.DbType=mysql\n");
check("diagnose_egovframe_project", diagnoseProject({ projectDir: legacy }));
check("validate_egovframe_project", await validateProject({ projectDir: legacy }));
check("migrate_egovframe_project", migrateProject({ projectDir: legacy }));
const dry = await applyMigration({ projectDir: legacy });
check("migrate_egovframe_project", dry);
const applied = await applyMigration({ projectDir: legacy, dryRun: false });
check("migrate_egovframe_project", applied);
assert(applied.remaining && applied.backupDir, "apply 결과 필드(remaining·backupDir)도 스키마 안");
check("check_egovframe_dependencies", await checkDependencies({ projectDir: legacy }));
check("check_egovframe_dependencies", await checkDependencies({ projectDir: legacy, offline: false, osvQuery: async (q) => ({ results: q.map(() => ({ vulns: [{ id: "GHSA-x" }] })) }) }));
// v0.37 리포트: markdown 은 text 로만 가고 structuredContent 에서는 뺀다(server.ts 와 같은 모양으로 검사)
const strip = ({ markdown, ...rest }) => rest;
check("generate_egovframe_report", strip(await generateProjectReport({ projectDir: legacy })));
check("generate_egovframe_report", strip(await generateProjectReport({ projectDir: legacy, sections: ["assessment"], offline: false, osvQuery: async (q) => ({ results: q.map(() => ({ vulns: [{ id: "GHSA-x" }] })) }) })));
check("generate_egovframe_report", strip(await generateProjectReport({ projectDir: legacy, sections: ["components", "assessment"], outputPath: "docs/assessment.md", dryRun: true })));
check("generate_egovframe_report", strip(await generateProjectReport({ projectDir: legacy, sections: ["assessment"], outputPath: "docs/assessment.md" })));
check("diagnose_egovframe_network", await diagnoseNetwork({ env: {}, nodeVersion: "v22.0.0", envProxySupported: true, probe: async () => ({ status: 200 }), lookup: async () => [{ address: "1.2.3.4", family: 4 }] }));
check("diagnose_egovframe_network", await diagnoseNetwork({ env: { HTTPS_PROXY: "http://p:1" }, nodeVersion: "v22.0.0", envProxySupported: true, probe: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); }, lookup: async () => { throw new Error("ENOTFOUND"); } }));
// 빈 프로젝트
// v0.40: SBOM 점검과 평가서 5절(최소 요소·VEX)
write(legacy, "sbom/bom.cdx.json", readFileSync(new URL("./fixtures/sbom-egov-web-plugin.cdx.json", import.meta.url), "utf8"));
write(legacy, "sbom/old.cdx.json", readFileSync(new URL("./fixtures/sbom-egov-web-plugin.cdx.json", import.meta.url), "utf8"));
check("check_egovframe_sbom", await checkSbom({ projectDir: legacy }));
check("check_egovframe_sbom", await checkSbom({ projectDir: legacy, baselinePath: "sbom/old.cdx.json", offline: false, vex: true, osvQuery: async (q) => ({ results: q.map((x, i) => (i === 0 ? { vulns: [{ id: "GHSA-x" }] } : {})) }) }));
const rep2 = strip(await generateProjectReport({ projectDir: legacy, sections: ["assessment"] }));
check("generate_egovframe_report", rep2);
assert(rep2.assessment.sbom.minimum.verdict === "needs-work" && rep2.assessment.sbom.vex.present && rep2.assessment.sbom.vex.states.in_triage === 1, "평가서 5절: 최소 요소·VEX 상태");
const empty = mkdtempSync(path.join(tmpdir(), "egovschemaE-"));
check("diagnose_egovframe_project", diagnoseProject({ projectDir: empty }));
check("migrate_egovframe_project", migrateProject({ projectDir: empty }));
check("check_egovframe_dependencies", await checkDependencies({ projectDir: empty }));
check("generate_egovframe_report", strip(await generateProjectReport({ projectDir: empty, sections: ["assessment"] })));
// 스키마가 실제로 거르는지
assert(!OUTPUT_SCHEMAS.diagnose_egovframe_project.safeParse({ projectDir: 1 }).success && !OUTPUT_SCHEMAS.migrate_egovframe_project.safeParse({ ...migrateProject({ projectDir: empty }), sourceEra: "6.x" }).success, "잘못된 값은 스키마가 거부");

rmSync(legacy, { recursive: true, force: true }); rmSync(empty, { recursive: true, force: true });
if (process.exitCode) console.error(`output-schemas FAIL (${n} assertions)`); else console.log(`output-schemas OK (${n} assertions)`);
