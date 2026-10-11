// 폐쇄망(망분리) 오프라인 번들 (v0.42) — 인터넷 PC 에서 받아 반입하는 자료 묶음.
//   만들기: prepareOfflineBundle — OSV Maven 전체 덤프 · 고정 공통컴포넌트 아카이브 · Initializr zip 템플릿 · 재조립 원본 태그 미러
//           를 한 디렉터리에 담고 bundle-manifest.json(파일별 sha256·크기·출처 URL·받은 시각)을 쓴다.
//   쓰기:   EGOVFRAME_OFFLINE_BUNDLE=<dir> 이면 (1) GET 다운로드(fetchWithTimeout)는 manifest 에 같은 URL 이 있으면 번들 파일을
//           지문 검증 후 돌려주고 (2) OSV querybatch 는 로컬 덤프로 판정하며 (3) 재조립 원본 저장소는 번들 미러를 쓴다(원격 조회 없음).
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import AdmZip from "adm-zip";

export const BUNDLE_ENV = "EGOVFRAME_OFFLINE_BUNDLE";
export const BUNDLE_MANIFEST = "bundle-manifest.json";
export const OSV_MAVEN_DUMP_URL = "https://osv-vulnerabilities.storage.googleapis.com/Maven/all.zip";
export const BUNDLE_MAX_AGE_DAYS = 30;

export type BundleKind = "osv" | "components" | "template" | "origin";
export interface BundleFile { path: string; kind: BundleKind; url: string; sha256: string; bytes: number; fetchedAt: string; id?: string; lastModified?: string | null; records?: number }
export interface BundleOrigin { path: string; repository: string; tags: string[]; fetchedAt: string; bytes: number }
export interface BundleManifest {
  schemaVersion: 1;
  createdAt: string;
  serverVersion: string;
  catalog: { repository: string; tag: string | null; commit: string | null };
  files: BundleFile[];
  origin?: BundleOrigin;
}

// ── 읽기(폐쇄망 쪽) ───────────────────────────────────────
interface LoadedBundle { dir: string; manifest: BundleManifest; verified: Map<string, Buffer> }
let cached: { key: string; bundle: LoadedBundle | null } | null = null;
/** 환경변수(또는 지정 경로)의 번들을 읽는다. 없으면 null. manifest 가 깨졌으면 예외. */
export function loadBundle(dir: string | undefined = process.env[BUNDLE_ENV]): LoadedBundle | null {
  const key = dir ? path.resolve(dir) : "";
  if (cached && cached.key === key) return cached.bundle;
  let bundle: LoadedBundle | null = null;
  if (dir) {
    const mf = path.join(key, BUNDLE_MANIFEST);
    if (!fs.existsSync(mf)) throw new Error(`${BUNDLE_ENV}=${dir} 에 ${BUNDLE_MANIFEST} 가 없습니다 — prepare_egovframe_offline_bundle 로 만든 디렉터리인지 확인하세요`);
    const manifest = JSON.parse(fs.readFileSync(mf, "utf8")) as BundleManifest;
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error(`${mf} 형식이 올바르지 않습니다`);
    bundle = { dir: key, manifest, verified: new Map() };
  }
  cached = { key, bundle };
  return bundle;
}
/** 테스트·장시간 프로세스용: 번들 캐시를 비운다. */
export function resetBundleCache(): void { cached = null; osvIndexCache = null; }

const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** 번들 파일을 지문 검증 후 읽는다(프로세스당 1회 검증). */
export function readBundleFile(bundle: LoadedBundle, f: BundleFile): Buffer {
  const hit = bundle.verified.get(f.path);
  if (hit) return hit;
  const abs = path.resolve(bundle.dir, f.path);
  if (path.relative(bundle.dir, abs).startsWith("..")) throw new Error(`번들 manifest 경로가 번들 밖을 가리킵니다: ${f.path}`);
  const buf = fs.readFileSync(abs);
  const actual = sha256Hex(buf);
  if (buf.length !== f.bytes || actual !== f.sha256) throw new Error(`오프라인 번들 파일 지문 불일치 — 거부합니다: ${f.path} (크기 ${buf.length}/${f.bytes}, sha256 ${actual.slice(0, 12)}…/${f.sha256.slice(0, 12)}…)`);
  bundle.verified.set(f.path, buf);
  return buf;
}
/** GET 다운로드를 번들에서 찾는다(fetchWithTimeout 이 부른다). 없으면 null. */
export function bundleResponseFor(url: string): Response | null {
  const b = loadBundle();
  if (!b) return null;
  const f = b.manifest.files.find((x) => x.url === url);
  if (!f) return null;
  const buf = readBundleFile(b, f);
  return new Response(new Uint8Array(buf), { status: 200, headers: { "content-length": String(buf.length), "x-egovframe-offline-bundle": f.path } });
}
/** 재조립 원본 미러(번들) — 저장소 이름이 같을 때만. */
export function bundleOriginDir(repository: string): string | null {
  const b = loadBundle();
  if (!b?.manifest.origin || b.manifest.origin.repository !== repository) return null;
  const abs = path.resolve(b.dir, b.manifest.origin.path);
  return fs.existsSync(path.join(abs, "HEAD")) ? abs : null;
}

// ── Maven 버전 비교(OSV ECOSYSTEM 범위 판정용) ───────────────
// Maven ComparableVersion 의 요지: 숫자/문자 경계와 . - 로 나누고, 숫자는 수로, 한정자는
// alpha < beta < milestone < rc(=cr) < snapshot < (없음 = ga = final = release) < sp 순서, 그 밖의 문자열은 그 뒤 사전순.
const QUALIFIERS = ["alpha", "beta", "milestone", "rc", "snapshot", "", "sp"];
const ALIAS: Record<string, string> = { a: "alpha", b: "beta", m: "milestone", cr: "rc", ga: "", final: "", release: "" };
type Item = { n: number } | { s: string };
function tokens(v: string): Item[] {
  const out: Item[] = [];
  for (const part of v.toLowerCase().split(/[.\-_+]/)) {
    for (const t of part.match(/\d+|[a-z]+/g) ?? []) out.push(/^\d+$/.test(t) ? { n: Number(t) } : { s: ALIAS[t] ?? t });
  }
  while (out.length && "n" in out[out.length - 1] && (out[out.length - 1] as { n: number }).n === 0) out.pop();
  while (out.length && "s" in out[out.length - 1] && (out[out.length - 1] as { s: string }).s === "") out.pop();
  return out;
}
const qualRank = (s: string) => { const i = QUALIFIERS.indexOf(s); return i >= 0 ? i : QUALIFIERS.length; };
/** 한쪽이 끝났을 때: 숫자는 0 이 아니면 크고, 한정자는 release("") 대비 순위로 */
const vsNull = (a: Item): number => ("n" in a ? (a.n === 0 ? 0 : 1) : Math.sign(qualRank(a.s) - qualRank("")));
function cmpItem(a: Item | undefined, b: Item | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return -vsNull(b!);
  if (b === undefined) return vsNull(a);
  if ("n" in a && "n" in b) return a.n - b.n;
  if ("n" in a) return 1; // 숫자 > 한정자
  if ("n" in b) return -1;
  const ra = qualRank(a.s), rb = qualRank(b.s);
  if (ra !== rb) return ra - rb;
  return ra === QUALIFIERS.length ? a.s.localeCompare(b.s) : 0;
}
/** Maven 버전 비교(음수·0·양수). */
export function compareMavenVersions(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const c = cmpItem(x[i], y[i]); if (c) return Math.sign(c); }
  return 0;
}

// ── 로컬 OSV(덤프) ───────────────────────────────────────
interface OsvRecord { id: string; withdrawn?: string; affected?: { package?: { name?: string; ecosystem?: string }; versions?: string[]; ranges?: { type: string; events: Record<string, string>[] }[] }[] }
interface OsvEntry { id: string; versions: Set<string>; ranges: Record<string, string>[][] }
let osvIndexCache: { key: string; index: Map<string, OsvEntry[]>; records: number } | null = null;
/** OSV 덤프 zip 을 패키지 이름 → 레코드 색인으로 만든다. */
export function buildOsvIndex(zipBuffer: Buffer): { index: Map<string, OsvEntry[]>; records: number } {
  const zip = new AdmZip(zipBuffer);
  const index = new Map<string, OsvEntry[]>();
  let records = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.endsWith(".json")) continue;
    let rec: OsvRecord;
    try { rec = JSON.parse(e.getData().toString("utf8")) as OsvRecord; } catch { continue; }
    records++;
    if (rec.withdrawn) continue;
    for (const a of rec.affected ?? []) {
      if (a.package?.ecosystem !== "Maven" || !a.package.name) continue;
      const entry: OsvEntry = { id: rec.id, versions: new Set(a.versions ?? []), ranges: (a.ranges ?? []).filter((r) => r.type === "ECOSYSTEM").map((r) => r.events) };
      const list = index.get(a.package.name) ?? [];
      list.push(entry);
      index.set(a.package.name, list);
    }
  }
  return { index, records };
}
/** OSV 범위(ECOSYSTEM events) 안인지. */
export function inOsvRange(version: string, events: Record<string, string>[]): boolean {
  const ver = (e: Record<string, string>) => e.introduced ?? e.fixed ?? e.last_affected ?? e.limit ?? "0";
  const sorted = [...events].sort((a, b) => (ver(a) === "0" ? -1 : ver(b) === "0" ? 1 : compareMavenVersions(ver(a), ver(b))));
  let affected = false;
  for (const e of sorted) {
    if (e.introduced !== undefined) { if (e.introduced === "0" || compareMavenVersions(version, e.introduced) >= 0) affected = true; }
    else if (e.fixed !== undefined) { if (compareMavenVersions(version, e.fixed) >= 0) affected = false; }
    else if (e.last_affected !== undefined) { if (compareMavenVersions(version, e.last_affected) > 0) affected = false; }
    else if (e.limit !== undefined) { if (compareMavenVersions(version, e.limit) >= 0) affected = false; }
  }
  return affected;
}
/** 로컬 덤프로 querybatch 와 같은 모양의 결과를 낸다. */
export function queryOsvIndex(index: Map<string, OsvEntry[]>, queries: { package: { name: string }; version: string }[]): { results: { vulns?: { id: string }[] }[] } {
  return {
    results: queries.map((q) => {
      const ids = new Set<string>();
      for (const e of index.get(q.package.name) ?? []) if (e.versions.has(q.version) || e.ranges.some((r) => inOsvRange(q.version, r))) ids.add(e.id);
      return ids.size ? { vulns: [...ids].sort().map((id) => ({ id })) } : {};
    }),
  };
}
/** 번들 OSV 덤프 정보(없으면 null). */
export function bundleOsv(): { file: BundleFile; bundleDir: string } | null {
  const b = loadBundle();
  const f = b?.manifest.files.find((x) => x.kind === "osv");
  return b && f ? { file: f, bundleDir: b.dir } : null;
}
/** 번들 OSV 로 질의(색인은 프로세스당 1회). 번들이 없으면 null. */
export function bundleOsvQuery(queries: { package: { name: string }; version: string }[]): { results: { vulns?: { id: string }[] }[] } | null {
  const b = loadBundle();
  const osv = bundleOsv();
  if (!b || !osv) return null;
  const key = `${b.dir}:${osv.file.sha256}`;
  if (!osvIndexCache || osvIndexCache.key !== key) osvIndexCache = { key, ...buildOsvIndex(readBundleFile(b, osv.file)) };
  return queryOsvIndex(osvIndexCache.index, queries);
}
/** 결과에 붙일 OSV 출처·신선도 노트(번들이 없으면 null). */
export function osvProvenanceNote(now: () => number = Date.now, maxAgeDays = Number(process.env.EGOVFRAME_BUNDLE_MAX_AGE_DAYS) || BUNDLE_MAX_AGE_DAYS): string | null {
  const osv = bundleOsv();
  if (!osv) return null;
  const when = osv.file.lastModified ?? osv.file.fetchedAt;
  const ageDays = Math.floor((now() - Date.parse(when)) / 86_400_000);
  return `OSV 는 오프라인 번들 스냅숏(${when.slice(0, 10)} 기준, ${osv.file.records ?? "?"}건)으로 판정했습니다${ageDays > maxAgeDays ? ` — ⚠️ ${ageDays}일 지났습니다(기준 ${maxAgeDays}일). 인터넷 PC 에서 번들을 새로 만들어 반입하세요` : ""}.`;
}

// ── 만들기(인터넷 쪽) ─────────────────────────────────────
export type BundleInclude = "osv" | "components" | "templates" | "origin";
export const BUNDLE_INCLUDES: BundleInclude[] = ["osv", "components", "templates", "origin"];
export interface BundleSource { kind: BundleKind; id: string; url: string; path: string; expected?: { sha256: string; bytes: number } }
export interface PrepareBundleOptions {
  outputDir: string;
  include?: BundleInclude[];
  /** 담을 템플릿 id(기본: 고정 지문이 있는 Initializr zip 템플릿 전부) */
  templates?: string[];
  dryRun?: boolean;
  /** 테스트 주입 */
  download?: (url: string) => Promise<{ buffer: Buffer; lastModified: string | null }>;
  originUrl?: string;
  now?: () => number;
}
export interface PrepareBundleResult {
  outputDir: string;
  dryRun: boolean;
  written: boolean;
  items: { kind: BundleKind; id: string; url: string; path: string; bytes: number | null; sha256: string | null; verified: boolean | null; note?: string }[];
  origin?: { repository: string; tags: number; bytes: number; path: string };
  totalBytes: number;
  manifestPath?: string;
  usage: string[];
  notes: string[];
}

async function defaultDownload(url: string): Promise<{ buffer: Buffer; lastModified: string | null }> {
  // 번들을 만드는 쪽은 인터넷 PC 다 — 번들 훅을 거치지 않고 직접 받는다
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 600_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "egovframe-scaffold-mcp" } });
    if (!res.ok) throw new Error(`다운로드 실패 (${res.status}): ${url}`);
    const lm = res.headers.get("last-modified");
    return { buffer: Buffer.from(await res.arrayBuffer()), lastModified: lm ? new Date(lm).toISOString() : null };
  } finally { clearTimeout(t); }
}
function git(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, windowsHide: true }, (err, out, errOut) => (err ? reject(new Error(`git ${args[0]} 실패: ${(errOut || err.message).trim().split("\n").slice(-2).join(" ")}`)) : resolve(out))));
}
const dirBytes = (d: string): number => { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size; } return n; };

/** 번들에 담을 항목 목록(순수 계산). */
export function bundleSources(catalog: { repository: string; commit: string | null; tag: string | null; archive?: { sha256: string; bytes: number } }, templates: { id: string; url: string; archive?: { sha256: string; bytes: number } }[], include: BundleInclude[]): BundleSource[] {
  const out: BundleSource[] = [];
  if (include.includes("osv")) out.push({ kind: "osv", id: "osv-maven", url: OSV_MAVEN_DUMP_URL, path: "osv/Maven-all.zip" });
  if (include.includes("components") && catalog.commit) out.push({ kind: "components", id: `${catalog.repository}@${catalog.tag ?? catalog.commit.slice(0, 7)}`, url: `https://codeload.github.com/${catalog.repository}/zip/${catalog.commit}`, path: `archives/${catalog.repository.replace(/\//g, "_")}-${catalog.commit.slice(0, 12)}.zip`, ...(catalog.archive ? { expected: catalog.archive } : {}) });
  if (include.includes("templates")) for (const t of templates) out.push({ kind: "template", id: t.id, url: t.url, path: `templates/${t.id}.zip`, ...(t.archive ? { expected: t.archive } : {}) });
  return out;
}

/** 번들을 만든다(인터넷 PC). dryRun(기본) 이면 받을 목록만. */
export async function prepareOfflineBundle(opts: PrepareBundleOptions & { catalog: Parameters<typeof bundleSources>[0]; templateList: Parameters<typeof bundleSources>[1]; serverVersion: string }): Promise<PrepareBundleResult> {
  const outputDir = path.resolve(opts.outputDir);
  const include = opts.include ?? BUNDLE_INCLUDES;
  const dryRun = opts.dryRun !== false;
  const now = opts.now ?? Date.now;
  const notes: string[] = [];
  const sources = bundleSources(opts.catalog, opts.templateList, include);
  const result: PrepareBundleResult = { outputDir, dryRun, written: false, items: sources.map((s) => ({ kind: s.kind, id: s.id, url: s.url, path: s.path, bytes: s.expected?.bytes ?? null, sha256: s.expected?.sha256 ?? null, verified: null })), totalBytes: 0, usage: [], notes };
  const originRel = `origin/${opts.catalog.repository.replace(/[^A-Za-z0-9._-]/g, "_")}.git`;
  if (include.includes("origin")) result.origin = { repository: opts.catalog.repository, tags: 0, bytes: 0, path: originRel };
  result.usage = [
    `폐쇄망 PC 로 ${outputDir} 디렉터리를 통째로 옮긴 뒤 MCP 클라이언트 설정에 환경변수 ${BUNDLE_ENV}=<옮긴 경로> 를 추가합니다.`,
    "다운로드(공통컴포넌트 아카이브·Initializr zip 템플릿)는 번들에서 지문을 검증해 쓰고, offline=false 의 OSV 조회는 번들 덤프로 판정하며, 재조립 원본 태그는 번들 미러를 씁니다.",
    "Maven 의존성 jar 는 번들에 없습니다 — 기관 Nexus·Artifactory 미러를 settings.xml 에 지정하세요.",
  ];
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) throw new Error(`outputDir 가 비어 있지 않습니다: ${outputDir} — 새 디렉터리를 지정하세요(기존 번들을 덮어쓰지 않습니다)`);
  if (dryRun) { notes.push(`dryRun — 받지 않았습니다. dryRun=false 로 ${sources.length}개 파일${include.includes("origin") ? " + 원본 태그 미러" : ""}를 받아 ${outputDir} 에 씁니다.`); result.totalBytes = result.items.reduce((s, i) => s + (i.bytes ?? 0), 0); return result; }

  const download = opts.download ?? defaultDownload;
  const staging = `${outputDir}.partial-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const files: BundleFile[] = [];
  try {
    for (const [i, s] of sources.entries()) {
      const { buffer, lastModified } = await download(s.url);
      const sha = sha256Hex(buffer);
      if (s.expected && (s.expected.sha256 !== sha || s.expected.bytes !== buffer.length)) throw new Error(`고정 지문과 다릅니다(${s.id}): 크기 ${buffer.length}/${s.expected.bytes}, sha256 ${sha.slice(0, 12)}…/${s.expected.sha256.slice(0, 12)}… — upstream 이 바뀌었는지 sync 도구로 확인하세요`);
      const abs = path.join(staging, s.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buffer);
      const f: BundleFile = { path: s.path, kind: s.kind, url: s.url, sha256: sha, bytes: buffer.length, fetchedAt: new Date(now()).toISOString(), id: s.id };
      if (s.kind === "osv") { f.lastModified = lastModified; f.records = buildOsvIndex(buffer).records; }
      files.push(f);
      result.items[i] = { ...result.items[i], bytes: buffer.length, sha256: sha, verified: s.expected ? true : null, ...(s.kind === "osv" ? { note: `레코드 ${f.records}건, 원본 갱신 ${lastModified ?? "미상"}` } : {}) };
    }
    let origin: BundleOrigin | undefined;
    if (include.includes("origin")) {
      const dir = path.join(staging, originRel);
      fs.mkdirSync(dir, { recursive: true });
      await git(["init", "--quiet", "--bare", dir]);
      await git(["remote", "add", "origin", opts.originUrl ?? `https://github.com/${opts.catalog.repository}.git`], dir);
      // 태그마다 depth 1(내용 포함) — 재조립의 원본 식별·패치 생성에 필요한 blob 이 모두 들어 있다(실측 22태그 ≈38MB)
      await git(["fetch", "--quiet", "--depth", "1", "origin", "+refs/tags/*:refs/tags/*"], dir);
      await git(["remote", "remove", "origin"], dir);
      const tags = (await git(["for-each-ref", "--format=%(refname:short)", "refs/tags"], dir)).split("\n").filter(Boolean);
      origin = { path: originRel, repository: opts.catalog.repository, tags, fetchedAt: new Date(now()).toISOString(), bytes: dirBytes(dir) };
      result.origin = { repository: origin.repository, tags: tags.length, bytes: origin.bytes, path: originRel };
    }
    const manifest: BundleManifest = { schemaVersion: 1, createdAt: new Date(now()).toISOString(), serverVersion: opts.serverVersion, catalog: { repository: opts.catalog.repository, tag: opts.catalog.tag, commit: opts.catalog.commit }, files, ...(origin ? { origin } : {}) };
    fs.writeFileSync(path.join(staging, BUNDLE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.mkdirSync(path.dirname(outputDir), { recursive: true });
    if (fs.existsSync(outputDir)) fs.rmdirSync(outputDir); // 비어 있음을 위에서 확인
    fs.renameSync(staging, outputDir);
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
  result.written = true;
  result.manifestPath = path.join(outputDir, BUNDLE_MANIFEST);
  result.totalBytes = files.reduce((s, f) => s + f.bytes, 0) + (result.origin?.bytes ?? 0);
  return result;
}

/** 결과 Markdown. */
export function renderBundleMarkdown(r: PrepareBundleResult): string {
  const mb = (n: number | null) => (n === null ? "?" : `${(n / 1048576).toFixed(1)}MB`);
  const L: string[] = [`# 오프라인 번들 ${r.dryRun ? "계획(dryRun)" : "생성"}`, ``, `- 경로: ${r.outputDir}${r.written ? ` · 합계 ${mb(r.totalBytes)}` : ""}`, ``, `| 종류 | 항목 | 크기 | sha256 | 고정 지문 |`, `|---|---|---|---|---|`];
  for (const i of r.items) L.push(`| ${i.kind} | ${i.id}${i.note ? ` (${i.note})` : ""} | ${mb(i.bytes)} | ${i.sha256 ? `${i.sha256.slice(0, 12)}…` : "—"} | ${i.verified === true ? "✅ 일치" : i.verified === false ? "❌" : "—"} |`);
  if (r.origin) L.push(`| origin | ${r.origin.repository} 태그 ${r.origin.tags || "(받을 예정)"} | ${r.origin.bytes ? mb(r.origin.bytes) : "?"} | — | — |`);
  L.push(``, `## 폐쇄망에서 쓰기`, ``);
  for (const u of r.usage) L.push(`- ${u}`);
  for (const n of r.notes) L.push(`- ${n}`);
  return L.join("\n");
}
