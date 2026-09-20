#!/usr/bin/env node
/**
 * 공식 프로젝트 템플릿 카탈로그를 한 파일로 합친다 → catalog/templates.json (v0.26)
 *
 * 세 곳에 흩어져 있던 "어떤 공식 프로젝트가 있는가"를 하나의 스키마로 모은다.
 *   1) Initializr  : templates/templates-projects.json (프로젝트 22종, zip + pom 스냅샷)
 *   2) MCP         : src/project.ts 의 TEMPLATES (공식 저장소 직접 조달, dist/index.js 로 재수출)
 *   3) Development : eGovFrameTemplates/wizards.xml (설정 스니펫 마법사 카테고리)
 *
 * 사용법:
 *   node scripts/generate-template-catalog.mjs                  # upstream 을 내려받아 생성
 *   node scripts/generate-template-catalog.mjs --offline a.json b.xml
 *
 * 매핑은 catalog/template-mapping.json 에서 큐레이션한다(자동 추론하지 않는다).
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "catalog", "templates.json");
const MAPPING_PATH = path.join(ROOT, "catalog", "template-mapping.json");

export const INITIALIZR_SOURCE = {
  repository: "eGovFramework/egovframe-vscode-initializr",
  branch: "main",
  path: "templates/templates-projects.json",
};
export const DEVELOPMENT_SOURCE = {
  repository: "eGovFramework/egovframe-development",
  branch: "main",
  path: "egovframework.dev.imp.templates/src/main/resources/eGovFrameTemplates/wizards.xml",
};

const rawUrl = (s) => `https://raw.githubusercontent.com/${s.repository}/${s.branch}/${s.path}`;

async function fetchText(url, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "egovframe-scaffold-mcp" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** wizards.xml 에서 설정 스니펫 마법사 카테고리를 뽑는다(정규식 파싱 — 구조가 단순한 고정 문서). */
export function parseConfigWizards(xml) {
  const categories = [];
  const catRe = /<category\s+name="([^"]+)"\s*>([\s\S]*?)<\/category>/g;
  let m;
  while ((m = catRe.exec(xml))) {
    const wizards = [...m[2].matchAll(/<wizard-def\s+description="([^"]+)"\s+template="([^"]+)"\s*\/>/g)].map((w) => ({
      description: w[1],
      template: w[2],
    }));
    categories.push({ name: m[1], wizards });
  }
  return categories;
}

/** Initializr 항목을 공통 스키마로 정규화한다. */
export function fromInitializr(entries) {
  return entries.map((e) => ({
    id: e.projectName,
    displayName: e.displayName,
    category: e.category,
    description: e.description,
    initializr: { fileName: e.fileName, pomFile: e.pomFile || null },
  }));
}

/** MCP TEMPLATES 를 공통 스키마로 정규화한다. */
export function fromMcpTemplates(templates) {
  return Object.entries(templates).map(([id, t]) => ({
    id,
    repository: t.repo,
    branch: t.branch,
    description: t.description,
    multiProject: Boolean(t.multiProject),
    // zip 조달 템플릿은 고정 지문을 카탈로그에 함께 싣는다 — sync 가 upstream LFS 포인터와 대조한다
    ...(t.archive
      ? { archive: { kind: t.archive.kind, commit: t.archive.commit, path: t.archive.path, sha256: t.archive.sha256, bytes: t.archive.bytes } }
      : {}),
  }));
}

/** 정규화된 두 목록과 큐레이션 매핑을 합쳐 통합 카탈로그를 만든다. */
export function mergeCatalog(initializrEntries, mcpEntries, mapping) {
  const mcpById = new Map(mcpEntries.map((m) => [m.id, m]));
  const used = new Set();
  const projects = initializrEntries.map((e) => {
    const curated = mapping.mappings[e.id];
    if (!curated) throw new Error(`template-mapping.json 에 '${e.id}' 항목이 없습니다 — 매핑을 먼저 큐레이션하세요`);
    const mcpTemplate = curated.mcpTemplate ?? null;
    if (mcpTemplate && !mcpById.has(mcpTemplate))
      throw new Error(`template-mapping.json 의 '${e.id}' 가 존재하지 않는 MCP 템플릿 '${mcpTemplate}' 을 가리킵니다`);
    if (mcpTemplate) used.add(mcpTemplate);
    const mcp = mcpTemplate ? mcpById.get(mcpTemplate) : null;
    return {
      ...e,
      mcpTemplate,
      mcp: mcp
        ? { repository: mcp.repository, branch: mcp.branch, multiProject: mcp.multiProject, ...(mcp.archive ? { archive: mcp.archive } : {}) }
        : null,
      ...(curated.note ? { note: curated.note } : {}),
    };
  });
  const mcpOnly = mcpEntries
    .filter((m) => !used.has(m.id))
    .map((m) => ({
      id: m.id,
      repository: m.repository,
      branch: m.branch,
      multiProject: m.multiProject,
      ...(mapping.mcpOnlyNotes?.[m.id] ? { note: mapping.mcpOnlyNotes[m.id] } : {}),
    }));
  const covered = projects.filter((p) => p.mcpTemplate).length;
  return {
    projects,
    mcpOnly,
    coverage: {
      initializrProjects: projects.length,
      coveredByMcp: covered,
      uncovered: projects.length - covered,
      mcpTemplates: mcpEntries.length,
      mcpOnly: mcpOnly.length,
    },
  };
}

async function main() {
  const offlineIdx = process.argv.indexOf("--offline");
  let projectsText, wizardsText;
  if (offlineIdx >= 0) {
    projectsText = fs.readFileSync(process.argv[offlineIdx + 1], "utf8");
    wizardsText = fs.readFileSync(process.argv[offlineIdx + 2], "utf8");
  } else {
    [projectsText, wizardsText] = await Promise.all([
      fetchText(rawUrl(INITIALIZR_SOURCE)),
      fetchText(rawUrl(DEVELOPMENT_SOURCE)),
    ]);
  }

  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8"));
  // Windows 절대경로(C:\\…)는 ESM import 지정자로 쓸 수 없으므로 file:// URL 로 변환한다.
  const { TEMPLATES } = await import(pathToFileURL(path.join(ROOT, "dist", "index.js")).href);

  const initializrEntries = fromInitializr(JSON.parse(projectsText));
  const mcpEntries = fromMcpTemplates(TEMPLATES);
  const merged = mergeCatalog(initializrEntries, mcpEntries, mapping);
  const configWizards = parseConfigWizards(wizardsText);

  const surveyedAt = new Date().toISOString().slice(0, 10);
  const catalog = {
    schemaVersion: 1,
    generatedBy: "scripts/generate-template-catalog.mjs",
    sources: {
      initializr: { ...INITIALIZR_SOURCE, surveyedAt, entries: initializrEntries.length, sha256: sha256(projectsText) },
      development: {
        ...DEVELOPMENT_SOURCE,
        surveyedAt,
        categories: configWizards.length,
        wizards: configWizards.reduce((n, c) => n + c.wizards.length, 0),
        sha256: sha256(wizardsText),
      },
      mcp: { source: "src/project.ts TEMPLATES", templates: mcpEntries.length },
    },
    coverage: merged.coverage,
    projects: merged.projects,
    mcpOnly: merged.mcpOnly,
    configWizards,
  };

  fs.writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  const { initializrProjects, coveredByMcp, uncovered, mcpOnly } = merged.coverage;
  console.log(
    `templates.json 생성: Initializr ${initializrProjects}종 중 MCP 대응 ${coveredByMcp}종, 미커버 ${uncovered}종, MCP 단독 ${mcpOnly}종, 설정 마법사 ${configWizards.length}카테고리`,
  );
}

// 직접 실행 여부 — 문자열 비교는 Windows(file:///C:/…)와 symlink 에서 어긋나므로 realpath 로 비교한다.
const isDirectRun = (() => {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isDirectRun) {
  await main();
}
