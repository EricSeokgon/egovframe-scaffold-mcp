import { createHash } from "node:crypto";
import * as fs from "node:fs";

/** 통합 템플릿 카탈로그 동기화 제한 시간(ms) */
export const TEMPLATE_CATALOG_TIMEOUT_MS = 30_000;
/** upstream 카탈로그 응답 상한 — 작은 JSON/XML 만 기대한다 */
export const TEMPLATE_CATALOG_MAX_BYTES = 2 * 1024 * 1024;

export interface TemplateSourceRef {
  repository: string;
  branch: string;
  path: string;
  surveyedAt?: string;
  sha256?: string;
  entries?: number;
  categories?: number;
  wizards?: number;
}

export interface UnifiedProject {
  /** Initializr projectName — 통합 카탈로그의 프로젝트 식별자 */
  id: string;
  displayName: string;
  category: string;
  description: string;
  initializr: { fileName: string; pomFile: string | null };
  /** 대응하는 MCP TEMPLATES 키. 같은 공식 산출물일 때만 채운다 */
  mcpTemplate: string | null;
  mcp: { repository: string; branch: string; multiProject: boolean } | null;
  note?: string;
}

export interface McpOnlyTemplate {
  id: string;
  repository: string;
  branch: string;
  multiProject: boolean;
  note?: string;
}

export interface ConfigWizardCategory {
  name: string;
  wizards: Array<{ description: string; template: string }>;
}

export interface TemplateCatalogCoverage {
  initializrProjects: number;
  coveredByMcp: number;
  uncovered: number;
  mcpTemplates: number;
  mcpOnly: number;
}

export interface TemplateCatalog {
  schemaVersion: number;
  generatedBy: string;
  sources: { initializr: TemplateSourceRef; development: TemplateSourceRef; mcp: { source: string; templates: number } };
  coverage: TemplateCatalogCoverage;
  projects: UnifiedProject[];
  mcpOnly: McpOnlyTemplate[];
  configWizards: ConfigWizardCategory[];
}

/** upstream 대비 달라진 항목 한 건 */
export interface TemplateDriftEntry {
  id: string;
  kind: "added" | "removed" | "changed";
  /** changed 일 때 어떤 필드가 달라졌는지 */
  fields?: string[];
}

export interface TemplateSyncResult {
  repository: string;
  path: string;
  requestedRef: string;
  pinnedSha256?: string;
  upstreamSha256: string;
  upToDate: boolean;
  pinnedProjects: number;
  upstreamProjects: number;
  drift: TemplateDriftEntry[];
  coverage: TemplateCatalogCoverage;
  /** MCP 가 아직 담지 않은 Initializr 프로젝트 */
  uncovered: Array<{ id: string; category: string; displayName: string }>;
  warnings: string[];
}

export interface TemplateSyncOptions {
  ref?: string;
}

const CATALOG_URL = new URL("../catalog/templates.json", import.meta.url);
const REF_RE = /^[A-Za-z0-9._\/-]{1,128}$/;

export function loadTemplateCatalog(): TemplateCatalog {
  return JSON.parse(fs.readFileSync(CATALOG_URL, "utf8")) as TemplateCatalog;
}

/** Initializr 원본 배열을 통합 카탈로그의 비교 가능한 형태로 정규화한다. */
export function normalizeInitializrProjects(
  raw: unknown,
): Array<{ id: string; displayName: string; category: string; description: string; fileName: string; pomFile: string | null }> {
  if (!Array.isArray(raw)) throw new Error("Initializr 프로젝트 카탈로그가 배열이 아닙니다");
  return raw.map((entry, index) => {
    const e = entry as Record<string, unknown>;
    const id = typeof e.projectName === "string" ? e.projectName : "";
    if (!id) throw new Error(`Initializr 카탈로그 ${index}번 항목에 projectName 이 없습니다`);
    return {
      id,
      displayName: String(e.displayName ?? ""),
      category: String(e.category ?? ""),
      description: String(e.description ?? ""),
      fileName: String(e.fileName ?? ""),
      pomFile: e.pomFile ? String(e.pomFile) : null,
    };
  });
}

/** 고정 카탈로그와 upstream 목록의 차이를 낸다. */
export function diffProjects(
  pinned: UnifiedProject[],
  upstream: ReturnType<typeof normalizeInitializrProjects>,
): TemplateDriftEntry[] {
  const pinnedById = new Map(pinned.map((p) => [p.id, p]));
  const upstreamById = new Map(upstream.map((p) => [p.id, p]));
  const drift: TemplateDriftEntry[] = [];

  for (const [id, up] of upstreamById) {
    const pin = pinnedById.get(id);
    if (!pin) {
      drift.push({ id, kind: "added" });
      continue;
    }
    const fields: string[] = [];
    if (pin.displayName !== up.displayName) fields.push("displayName");
    if (pin.category !== up.category) fields.push("category");
    if (pin.description !== up.description) fields.push("description");
    if (pin.initializr.fileName !== up.fileName) fields.push("fileName");
    if ((pin.initializr.pomFile ?? null) !== up.pomFile) fields.push("pomFile");
    if (fields.length > 0) drift.push({ id, kind: "changed", fields });
  }
  for (const id of pinnedById.keys()) {
    if (!upstreamById.has(id)) drift.push({ id, kind: "removed" });
  }
  return drift.sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "egovframe-scaffold-mcp" },
    });
    if (!response.ok) throw new Error(`템플릿 카탈로그 조회 실패(${response.status} ${response.statusText}): ${url}`);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > TEMPLATE_CATALOG_MAX_BYTES)
      throw new Error(`템플릿 카탈로그 응답이 상한(${TEMPLATE_CATALOG_MAX_BYTES} bytes)을 넘었습니다: ${url}`);
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(`템플릿 카탈로그 조회 시간 초과(${timeoutMs}ms): ${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Initializr 프로젝트 카탈로그를 내려받아 고정 카탈로그와 대조한다.
 * 네트워크 접근이 필요하며, 파일을 고쳐 쓰지 않고 차이만 보고한다.
 */
export async function syncTemplateCatalog(
  options: TemplateSyncOptions = {},
  deps: { fetchText?: (url: string, timeoutMs: number) => Promise<string>; catalog?: TemplateCatalog } = {},
): Promise<TemplateSyncResult> {
  const catalog = deps.catalog ?? loadTemplateCatalog();
  const source = catalog.sources.initializr;
  const ref = options.ref ?? source.branch;
  if (!REF_RE.test(ref)) throw new Error(`ref 형식이 올바르지 않습니다: ${ref}`);

  const url = `https://raw.githubusercontent.com/${source.repository}/${ref}/${source.path}`;
  const fetchText = deps.fetchText ?? fetchTextWithTimeout;
  const text = await fetchText(url, TEMPLATE_CATALOG_TIMEOUT_MS);
  const upstreamSha256 = createHash("sha256").update(text, "utf8").digest("hex");

  let upstream: ReturnType<typeof normalizeInitializrProjects>;
  try {
    upstream = normalizeInitializrProjects(JSON.parse(text));
  } catch (error) {
    throw new Error(`Initializr 프로젝트 카탈로그를 해석하지 못했습니다: ${(error as Error).message}`);
  }

  const drift = diffProjects(catalog.projects, upstream);
  const warnings: string[] = [];
  if (drift.some((d) => d.kind === "added"))
    warnings.push("upstream 에 새 프로젝트가 있습니다 — catalog/template-mapping.json 에 매핑을 추가한 뒤 generate:template-catalog 로 승격하세요");
  if (drift.some((d) => d.kind === "removed"))
    warnings.push("고정 카탈로그에만 있는 프로젝트가 있습니다 — upstream 에서 제거됐는지 확인하세요");

  const uncovered = catalog.projects
    .filter((p) => !p.mcpTemplate)
    .map((p) => ({ id: p.id, category: p.category, displayName: p.displayName }));

  return {
    repository: source.repository,
    path: source.path,
    requestedRef: ref,
    pinnedSha256: source.sha256,
    upstreamSha256,
    upToDate: drift.length === 0 && source.sha256 === upstreamSha256,
    pinnedProjects: catalog.projects.length,
    upstreamProjects: upstream.length,
    drift,
    coverage: catalog.coverage,
    uncovered,
    warnings,
  };
}
