import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import * as fs from "node:fs";

export const CATALOG_DOWNLOAD_TIMEOUT_MS = 120_000;
export const CATALOG_ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
export const CATALOG_ARCHIVE_MAX_FILES = 20_000;

export interface CatalogArchiveMetadata {
  sha256: string;
  bytes: number;
  files: number;
}

export interface CatalogSourceMetadata {
  repository?: string;
  repo?: string;
  branch?: string;
  tag?: string;
  commit?: string;
  surveyedAt?: string;
  securityPatchLevel?: string;
  archive?: CatalogArchiveMetadata;
}

interface CatalogFile {
  source: CatalogSourceMetadata;
  components?: Array<{
    pathPrefixes?: string[];
    messageBundles?: string[];
    idgnContexts?: string[];
    schedulingContexts?: string[];
    webAssets?: string[];
    webFragments?: string[];
  }>;
}

export interface ArchiveInspection {
  sha256: string;
  bytes: number;
  files: number;
  rootPrefix: string;
  securityPaths: string[];
  unmappedComponentPaths: string[];
}

export interface CatalogSyncOptions {
  ref?: string;
}

export interface CatalogSyncResult {
  repository: string;
  requestedRef: string;
  resolvedCommit: string;
  pinnedTag?: string;
  pinnedCommit?: string;
  surveyedAt?: string;
  securityPatchLevel?: string;
  upToDate: boolean;
  archive: ArchiveInspection;
  expectedArchive?: CatalogArchiveMetadata;
  warnings: string[];
}

const CATALOG_URL = new URL("../catalog/components.json", import.meta.url);
const REF_RE = /^[A-Za-z0-9._\/-]{1,128}$/;

function loadCatalogFile(): CatalogFile {
  return JSON.parse(fs.readFileSync(CATALOG_URL, "utf8")) as CatalogFile;
}

function repositoryOf(source: CatalogSourceMetadata): string {
  const repository = source.repository ?? source.repo;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error("카탈로그 source.repository 형식이 올바르지 않습니다");
  return repository;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "egovframe-scaffold-mcp" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(`공통컴포넌트 카탈로그 동기화 시간 초과(${timeoutMs}ms): ${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEntries(zip: AdmZip): { entries: AdmZip.IZipEntry[]; rootPrefix: string } {
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  if (entries.length === 0) throw new Error("공통컴포넌트 아카이브가 비어 있습니다");
  if (entries.length > CATALOG_ARCHIVE_MAX_FILES)
    throw new Error(`공통컴포넌트 아카이브 파일 수 제한 초과: ${entries.length} > ${CATALOG_ARCHIVE_MAX_FILES}`);

  const first = entries[0].entryName.replace(/\\/g, "/");
  const rootPrefix = first.includes("/") ? first.slice(0, first.indexOf("/") + 1) : "";
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, "/");
    if (name.startsWith("/") || /^[A-Za-z]:\//.test(name) || name.split("/").includes(".."))
      throw new Error(`안전하지 않은 아카이브 경로를 거부합니다: ${entry.entryName}`);
  }
  return { entries, rootPrefix };
}

function expectedPaths(catalog: CatalogFile): { prefixes: string[]; exact: Set<string> } {
  const prefixes: string[] = [];
  const exact = new Set<string>();
  for (const component of catalog.components ?? []) {
    prefixes.push(...(component.pathPrefixes ?? []));
    for (const key of ["messageBundles", "idgnContexts", "schedulingContexts", "webAssets", "webFragments"] as const)
      for (const value of component[key] ?? []) exact.add(value);
  }
  return { prefixes, exact };
}

export function inspectCatalogArchive(buffer: Buffer, catalog = loadCatalogFile()): ArchiveInspection {
  if (buffer.length > CATALOG_ARCHIVE_MAX_BYTES)
    throw new Error(`공통컴포넌트 아카이브 크기 제한 초과: ${buffer.length} > ${CATALOG_ARCHIVE_MAX_BYTES}`);
  const zip = new AdmZip(buffer);
  const { entries, rootPrefix } = normalizeEntries(zip);
  const rel = (name: string) => {
    const normalized = name.replace(/\\/g, "/");
    return rootPrefix && normalized.startsWith(rootPrefix) ? normalized.slice(rootPrefix.length) : normalized;
  };
  const paths = entries.map((entry) => rel(entry.entryName));
  const expected = expectedPaths(catalog);
  const componentRoots = [
    "src/main/java/egovframework/com/",
    "src/main/resources/egovframework/mapper/com/",
    "src/main/webapp/WEB-INF/jsp/egovframework/com/",
  ];
  const unmappedComponentPaths = paths.filter(
    (file) => componentRoots.some((root) => file.startsWith(root)) &&
      !expected.prefixes.some((prefix) => file.startsWith(prefix)) && !expected.exact.has(file),
  );
  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.length,
    files: entries.length,
    rootPrefix,
    securityPaths: paths.filter((file) => file.startsWith("src/main/java/egovframework/com/sec/security/")),
    unmappedComponentPaths: unmappedComponentPaths.slice(0, 100),
  };
}

async function resolveCommit(repository: string, ref: string): Promise<string> {
  const url = `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`;
  const response = await fetchWithTimeout(url, CATALOG_DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) throw new Error(`공통컴포넌트 ref 확인 실패 (${response.status}): ${repository}@${ref}`);
  const body = await response.json() as { sha?: string };
  if (!body.sha || !/^[0-9a-f]{40}$/.test(body.sha)) throw new Error(`GitHub 응답에서 commit SHA를 확인하지 못했습니다: ${repository}@${ref}`);
  return body.sha;
}

async function downloadArchive(repository: string, commit: string): Promise<Buffer> {
  const url = `https://codeload.github.com/${repository}/zip/${commit}`;
  const response = await fetchWithTimeout(url, CATALOG_DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) throw new Error(`공통컴포넌트 저장소 다운로드 실패 (${response.status}): ${url}`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > CATALOG_ARCHIVE_MAX_BYTES)
    throw new Error(`공통컴포넌트 아카이브 크기 제한 초과: ${contentLength} > ${CATALOG_ARCHIVE_MAX_BYTES}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function syncCatalog(options: CatalogSyncOptions = {}): Promise<CatalogSyncResult> {
  const catalog = loadCatalogFile();
  const source = catalog.source;
  const repository = repositoryOf(source);
  const requestedRef = (options.ref ?? source.tag ?? source.commit ?? source.branch ?? "main").trim();
  if (!REF_RE.test(requestedRef)) throw new Error(`ref에 허용되지 않는 문자가 있습니다: ${requestedRef}`);
  const resolvedCommit = await resolveCommit(repository, requestedRef);
  if (requestedRef === source.tag && source.commit && resolvedCommit !== source.commit)
    throw new Error(`공식 태그와 고정 commit이 일치하지 않습니다: ${source.tag}=${resolvedCommit}, catalog=${source.commit}`);

  const buffer = await downloadArchive(repository, resolvedCommit);
  const archive = inspectCatalogArchive(buffer, catalog);
  const pinnedArchive = source.archive;
  const isPinnedCommit = source.commit === resolvedCommit;
  if (isPinnedCommit && pinnedArchive) {
    const mismatch = pinnedArchive.sha256 !== archive.sha256 || pinnedArchive.bytes !== archive.bytes || pinnedArchive.files !== archive.files;
    if (mismatch)
      throw new Error(
        `고정 아카이브 무결성 불일치: expected sha256=${pinnedArchive.sha256}, bytes=${pinnedArchive.bytes}, files=${pinnedArchive.files}; ` +
        `actual sha256=${archive.sha256}, bytes=${archive.bytes}, files=${archive.files}`,
      );
  }

  const warnings: string[] = [];
  if (!isPinnedCommit) warnings.push(`새 upstream commit 감지: ${source.commit ?? "(미고정)"} → ${resolvedCommit}`);
  if (archive.securityPaths.length === 0) warnings.push("sec.security 보안 패키지가 아카이브에서 확인되지 않았습니다");
  if (archive.unmappedComponentPaths.length > 0)
    warnings.push(`카탈로그에 매핑되지 않은 컴포넌트 경로 ${archive.unmappedComponentPaths.length}건(최대 100건 표시)`);

  return {
    repository,
    requestedRef,
    resolvedCommit,
    pinnedTag: source.tag,
    pinnedCommit: source.commit,
    surveyedAt: source.surveyedAt,
    securityPatchLevel: source.securityPatchLevel,
    upToDate: isPinnedCommit && archive.unmappedComponentPaths.length === 0,
    archive,
    expectedArchive: source.archive,
    warnings,
  };
}

export async function downloadVerifiedCatalogArchive(source: CatalogSourceMetadata): Promise<{ zip: AdmZip; inspection: ArchiveInspection }> {
  const repository = repositoryOf(source);
  const ref = source.commit ?? source.tag ?? source.branch ?? "main";
  if (!REF_RE.test(ref)) throw new Error(`카탈로그 source ref에 허용되지 않는 문자가 있습니다: ${ref}`);
  const buffer = await downloadArchive(repository, ref);
  const inspection = inspectCatalogArchive(buffer);
  if (source.archive) {
    const expected = source.archive;
    if (expected.sha256 !== inspection.sha256 || expected.bytes !== inspection.bytes || expected.files !== inspection.files)
      throw new Error(
        `공통컴포넌트 고정 아카이브 무결성 불일치: expected sha256=${expected.sha256}, bytes=${expected.bytes}, files=${expected.files}; ` +
        `actual sha256=${inspection.sha256}, bytes=${inspection.bytes}, files=${inspection.files}`,
      );
  }
  return { zip: new AdmZip(buffer), inspection };
}
