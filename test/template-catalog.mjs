import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  TEMPLATES,
  diffProjects,
  loadTemplateCatalog,
  normalizeInitializrProjects,
  syncTemplateCatalog,
} from "../dist/index.js";

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

/* ── 1. 고정 카탈로그 무결성 ─────────────────────────────── */
const catalog = loadTemplateCatalog();

check(() => assert.equal(catalog.schemaVersion, 1));
check(() => assert.equal(catalog.generatedBy, "scripts/generate-template-catalog.mjs"));
check(() => assert.equal(catalog.sources.initializr.repository, "eGovFramework/egovframe-vscode-initializr"));
check(() => assert.equal(catalog.sources.initializr.path, "templates/templates-projects.json"));
check(() => assert.match(catalog.sources.initializr.sha256, /^[0-9a-f]{64}$/));
check(() => assert.equal(catalog.sources.development.repository, "eGovFramework/egovframe-development"));
check(() => assert.match(catalog.sources.development.sha256, /^[0-9a-f]{64}$/));
check(() => assert.ok(catalog.projects.length > 0));

// id 중복 없음
check(() => assert.equal(new Set(catalog.projects.map((p) => p.id)).size, catalog.projects.length));
check(() => assert.equal(new Set(catalog.mcpOnly.map((m) => m.id)).size, catalog.mcpOnly.length));

// 모든 프로젝트가 필수 필드를 갖는다
for (const project of catalog.projects) {
  check(() => assert.ok(project.id && project.displayName && project.category, `필드 누락: ${project.id}`));
  check(() => assert.ok(project.initializr && typeof project.initializr.fileName === "string"));
  check(() => assert.ok(project.mcpTemplate === null || typeof project.mcpTemplate === "string"));
}

// 매핑 무결성: mcpTemplate 은 실제 TEMPLATES 키여야 하고, mcp 블록과 저장소가 일치해야 한다
for (const project of catalog.projects.filter((p) => p.mcpTemplate)) {
  check(() => assert.ok(TEMPLATES[project.mcpTemplate], `존재하지 않는 MCP 템플릿: ${project.mcpTemplate}`));
  check(() => assert.equal(project.mcp.repository, TEMPLATES[project.mcpTemplate].repo));
  check(() => assert.equal(project.mcp.branch, TEMPLATES[project.mcpTemplate].branch));
}
for (const only of catalog.mcpOnly) {
  check(() => assert.ok(TEMPLATES[only.id], `mcpOnly 가 존재하지 않는 템플릿을 가리킵니다: ${only.id}`));
}

// mcpOnly = TEMPLATES - (매핑에 쓰인 템플릿)
const mapped = new Set(catalog.projects.map((p) => p.mcpTemplate).filter(Boolean));
const expectedOnly = Object.keys(TEMPLATES).filter((id) => !mapped.has(id)).sort();
check(() => assert.deepEqual(catalog.mcpOnly.map((m) => m.id).sort(), expectedOnly));

// coverage 숫자는 projects 로부터 계산된 값과 같아야 한다
check(() => assert.equal(catalog.coverage.initializrProjects, catalog.projects.length));
check(() => assert.equal(catalog.coverage.coveredByMcp, catalog.projects.filter((p) => p.mcpTemplate).length));
check(() => assert.equal(catalog.coverage.uncovered, catalog.projects.filter((p) => !p.mcpTemplate).length));
check(() => assert.equal(catalog.coverage.mcpTemplates, Object.keys(TEMPLATES).length));
check(() => assert.equal(catalog.coverage.mcpOnly, catalog.mcpOnly.length));
check(() => assert.equal(catalog.coverage.coveredByMcp + catalog.coverage.uncovered, catalog.coverage.initializrProjects));

// 설정 마법사(Development wizards.xml)도 함께 담겨 있다
check(() => assert.ok(catalog.configWizards.length >= 1));
check(() => assert.ok(catalog.configWizards.some((c) => c.name === "CRUD")));
check(() => assert.ok(catalog.configWizards.every((c) => Array.isArray(c.wizards))));

/* ── 2. 정규화 ───────────────────────────────────────────── */
const rawUpstream = catalog.projects.map((p) => ({
  projectName: p.id,
  displayName: p.displayName,
  category: p.category,
  description: p.description,
  fileName: p.initializr.fileName,
  pomFile: p.initializr.pomFile ?? undefined,
}));

const normalized = normalizeInitializrProjects(rawUpstream);
check(() => assert.equal(normalized.length, catalog.projects.length));
check(() => assert.equal(normalized[0].id, catalog.projects[0].id));
check(() => assert.equal(normalized[0].pomFile, catalog.projects[0].initializr.pomFile));
check(() => assert.throws(() => normalizeInitializrProjects({}), /배열이 아닙니다/));
check(() => assert.throws(() => normalizeInitializrProjects([{ displayName: "x" }]), /projectName/));

/* ── 3. 차이 계산 ────────────────────────────────────────── */
check(() => assert.deepEqual(diffProjects(catalog.projects, normalized), []));

const added = [...normalized, { id: "egov-new", displayName: "New", category: "Web", description: "", fileName: "n.zip", pomFile: null }];
check(() => assert.deepEqual(diffProjects(catalog.projects, added), [{ id: "egov-new", kind: "added" }]));

const removed = normalized.filter((p) => p.id !== catalog.projects[0].id);
check(() => assert.deepEqual(diffProjects(catalog.projects, removed), [{ id: catalog.projects[0].id, kind: "removed" }]));

const changed = normalized.map((p, i) => (i === 0 ? { ...p, displayName: `${p.displayName} v2`, fileName: "other.zip" } : p));
const changedDrift = diffProjects(catalog.projects, changed);
check(() => assert.equal(changedDrift.length, 1));
check(() => assert.equal(changedDrift[0].kind, "changed"));
check(() => assert.deepEqual(changedDrift[0].fields, ["displayName", "fileName"]));

// pomFile 이 null ↔ 값 으로 바뀌는 것도 잡는다
const pomChanged = normalized.map((p, i) => (i === 0 ? { ...p, pomFile: `${p.pomFile ?? "x"}-changed` } : p));
check(() => assert.deepEqual(diffProjects(catalog.projects, pomChanged)[0].fields, ["pomFile"]));

// 정렬: 결과는 id 오름차순
const multi = [...added.filter((p) => p.id !== "egov-boot-web"), { id: "aaa-new", displayName: "", category: "", description: "", fileName: "", pomFile: null }];
const multiDrift = diffProjects(catalog.projects, multi);
check(() => assert.deepEqual([...multiDrift].map((d) => d.id).sort(), multiDrift.map((d) => d.id)));

/* ── 4. 동기화(네트워크 주입) ────────────────────────────── */
const identicalText = JSON.stringify(rawUpstream);
const identicalSha = createHash("sha256").update(identicalText, "utf8").digest("hex");

// 고정 sha 가 같은 카탈로그를 만들어 upToDate 경로를 검증
const pinnedCatalog = { ...catalog, sources: { ...catalog.sources, initializr: { ...catalog.sources.initializr, sha256: identicalSha } } };
const clean = await syncTemplateCatalog({}, { catalog: pinnedCatalog, fetchText: async () => identicalText });
check(() => assert.equal(clean.upToDate, true));
check(() => assert.equal(clean.drift.length, 0));
check(() => assert.equal(clean.warnings.length, 0));
check(() => assert.equal(clean.upstreamSha256, identicalSha));
check(() => assert.equal(clean.pinnedProjects, catalog.projects.length));
check(() => assert.equal(clean.upstreamProjects, catalog.projects.length));
check(() => assert.equal(clean.requestedRef, catalog.sources.initializr.branch));
check(() => assert.equal(clean.uncovered.length, catalog.coverage.uncovered));

// 내용이 같아도 고정 sha 가 다르면 upToDate 가 아니다(스냅샷 갱신 필요 신호)
const shaMismatch = await syncTemplateCatalog({}, { catalog, fetchText: async () => identicalText });
check(() => assert.equal(shaMismatch.drift.length, 0));
check(() => assert.equal(shaMismatch.upToDate, catalog.sources.initializr.sha256 === identicalSha));

// upstream 에 새 항목이 생기면 경고와 함께 보고한다
const addedText = JSON.stringify([...rawUpstream, { projectName: "egov-new", displayName: "New", category: "Web", description: "", fileName: "n.zip" }]);
const withAdded = await syncTemplateCatalog({}, { catalog, fetchText: async () => addedText });
check(() => assert.equal(withAdded.upToDate, false));
check(() => assert.deepEqual(withAdded.drift, [{ id: "egov-new", kind: "added" }]));
check(() => assert.ok(withAdded.warnings.some((w) => w.includes("template-mapping.json"))));

// upstream 에서 사라지면 removed 경고
const removedText = JSON.stringify(rawUpstream.slice(1));
const withRemoved = await syncTemplateCatalog({}, { catalog, fetchText: async () => removedText });
check(() => assert.deepEqual(withRemoved.drift, [{ id: rawUpstream[0].projectName, kind: "removed" }]));
check(() => assert.ok(withRemoved.warnings.some((w) => w.includes("upstream"))));

// ref 를 주면 그 ref 로 조회한다
let requestedUrl = "";
await syncTemplateCatalog(
  { ref: "v1.2.3" },
  {
    catalog,
    fetchText: async (url) => {
      requestedUrl = url;
      return identicalText;
    },
  },
);
check(() => assert.ok(requestedUrl.includes("/v1.2.3/")));
check(() => assert.ok(requestedUrl.startsWith("https://raw.githubusercontent.com/eGovFramework/egovframe-vscode-initializr/")));

// 잘못된 ref 는 네트워크 접근 전에 거부한다
let touched = false;
await assert.rejects(
  syncTemplateCatalog({ ref: "../../etc/passwd\n" }, { catalog, fetchText: async () => { touched = true; return ""; } }),
  /ref 형식/,
);
check(() => assert.equal(touched, false));

// 깨진 JSON 은 해석 오류로 보고한다
await assert.rejects(syncTemplateCatalog({}, { catalog, fetchText: async () => "{not json" }), /해석하지 못했습니다/);
checks += 1;

// 배열이 아닌 JSON 도 같은 경로로 잡힌다
await assert.rejects(syncTemplateCatalog({}, { catalog, fetchText: async () => '{"a":1}' }), /해석하지 못했습니다/);
checks += 1;

console.log(`template-catalog OK (${checks} assertions)`);
