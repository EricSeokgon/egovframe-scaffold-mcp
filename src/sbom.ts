// SBOM 생성 (generate_egovframe_sbom, v0.36) — CycloneDX 1.6 JSON.
//   Maven : cyclonedx-maven-plugin 2.9.3 의 makeAggregateBom 을 좌표를 완전히 적어 호출(pom 변경 없음) → 해시·라이선스 포함
//   Gradle: 해석된 의존성 트리(dependency-tree.ts)로 이 서버가 직접 CycloneDX 문서를 만든다(빌드 파일 변경 없음; 해시·라이선스 없음)
//   enrich: component 마다 기준 판정(egovframe:status·basis·baseline) 을 properties 로 붙이고, offline=false 면 OSV 결과를 vulnerabilities[] 로 넣는다.
//   출력은 프로젝트 안 경로만 허용하고 기존 파일은 overwrite=true 가 아니면 거부한다. dryRun(기본) 은 실행 없이 계획만 돌려준다.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { capOutput, defaultRunner, detectBuildToolAt, resolveCommand, type BuildTool, type ResolvedCommand, type Runner } from "./build-runner.js";
import { detectWorkspace } from "./workspace.js";
import { classifyDependency, defaultOsvQuery, loadDependencyBaseline, type DependencyStatus, type OsvQuery, type ParentInfo } from "./dependencies.js";
import { resolveDependencyTree, type ResolveScope, type ResolvedArtifact } from "./dependency-tree.js";
import { loadMigrationRules, parsePomProperties } from "./migrate.js";
import { withFileTransaction } from "./file-transaction.js";
import { SERVER_VERSION } from "./version.js";
import { checkMinimumElements, loadSbomRules, supplierFor } from "./sbom-check.js";
import { osvProvenanceNote } from "./offline-bundle.js";
import { cdxToSpdx, spdxToCdx, DEFAULT_SPDX_PATH, SPDX_VERSION, type SpdxDocument } from "./spdx.js";
import { L } from "./lang.js";
import { AbortError, stepper, subProgress, throwIfAborted, type Progress } from "./progress.js";

export const CYCLONEDX_MAVEN_PLUGIN = "org.cyclonedx:cyclonedx-maven-plugin:2.9.3";
export const CYCLONEDX_SPEC_VERSION = "1.6";
export const DEFAULT_SBOM_PATH = "sbom/bom.cdx.json";
export type SbomFormat = "cyclonedx-json" | "spdx-json";

export interface SbomComponent {
  type: string;
  "bom-ref"?: string;
  group?: string;
  name: string;
  version?: string;
  purl?: string;
  scope?: string;
  hashes?: { alg: string; content: string }[];
  licenses?: unknown[];
  properties?: { name: string; value: string }[];
  [k: string]: unknown;
}
export interface SbomDocument {
  bomFormat: "CycloneDX";
  specVersion: string;
  serialNumber?: string;
  version: number;
  metadata?: { timestamp?: string; tools?: unknown; component?: SbomComponent; [k: string]: unknown };
  components?: SbomComponent[];
  dependencies?: { ref: string; dependsOn?: string[] }[];
  vulnerabilities?: { id: string; "bom-ref"?: string; source?: { name: string; url?: string }; affects: { ref: string }[]; [k: string]: unknown }[];
  [k: string]: unknown;
}

export interface GenerateSbomOptions {
  projectDir: string;
  format?: SbomFormat;
  /** 프로젝트 상대 경로(기본 sbom/bom.cdx.json, spdx-json 이면 sbom/bom.spdx.json) */
  outputPath?: string;
  /** runtime(기본) | all(test·provided 포함) */
  scope?: ResolveScope;
  /** 기준 판정 속성 부착(기본 true) */
  enrich?: boolean;
  /** false 면 OSV 로 알려진 취약점을 vulnerabilities[] 로 (기본 true = 조회 안 함) */
  offline?: boolean;
  osvQuery?: OsvQuery;
  overwrite?: boolean;
  dryRun?: boolean;
  /** v0.40: 공급자(주 component·문서) — 없으면 pom <organization><name> */
  supplier?: string;
  /** v0.40: SBOM 작성자(metadata.authors) — 없으면 supplier */
  author?: string;
  /** v0.40: 주 component 이름·버전 덮어쓰기(없으면 pom <name>·<version>) */
  componentName?: string;
  componentVersion?: string;
  /** v0.40: 공급자가 빠진 component 를 catalog/sbom-rules.json 공급자 표로 보완(기본: enrich 와 같음) */
  fillSuppliers?: boolean;
  timeoutMs?: number;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  now?: () => number;
  /** v1.1(내부, 납품 패키지): 프로젝트에 쓰지 않고 문서만 만들어 돌려준다(written=false, bom·spdx 에 문서) */
  noWrite?: boolean;
  /** v1.2: 진행 알림·취소(signal). 취소되면 프로세스 트리를 끝내고 AbortError 를 던진다(dryRun 은 보고 없음) */
  progress?: Progress;
}

export interface GenerateSbomResult {
  projectDir: string;
  buildTool: BuildTool;
  format: SbomFormat;
  specVersion: string;
  outputPath: string;
  absolutePath: string;
  dryRun: boolean;
  written: boolean;
  overwritten: boolean;
  command: string;
  generator: "cyclonedx-maven-plugin" | "egovframe-scaffold-mcp";
  durationMs?: number;
  components: number;
  direct: number;
  transitive: number;
  /** enrich 결과 집계(enrich=false 면 0) */
  statuses: Record<DependencyStatus, number>;
  vulnerabilities: number;
  osvError?: string;
  /** v0.40: 최소 요소 7종 점검 요약(check_egovframe_sbom 과 같은 규칙) */
  minimum?: { verdict: "ready" | "needs-work"; missing: string[]; componentsWithGaps: number; supplierFromCatalog: number };
  bytes: number;
  /** dryRun 이 아니면 문서 전체 */
  bom?: SbomDocument;
  /** v0.43: bomFormat=spdx-json 이면 쓴 SPDX 문서 */
  spdx?: SpdxDocument;
  notes: string[];
  logTail?: string;
}

const REL_PATH_RE = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\0]+$/;

/** 출력 경로를 검증하고 절대 경로를 돌려준다(프로젝트 안, symlink 이탈 금지). SBOM·리포트 공용. */
export function resolveOutputPath(projectDir: string, outputPath: string): { relPath: string; absolutePath: string } {
  const relPath = outputPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!REL_PATH_RE.test(relPath) || path.isAbsolute(outputPath) || /^[A-Za-z]:/.test(outputPath)) throw new Error(L(`outputPath 는 프로젝트 내부의 상대 경로여야 합니다: ${outputPath}`, `outputPath must be a relative path inside the project: ${outputPath}`));
  const absolutePath = path.resolve(projectDir, relPath);
  const rel = path.relative(projectDir, absolutePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(L(`출력 경로가 프로젝트 밖입니다: ${outputPath}`, `Output path is outside the project: ${outputPath}`));
  let probe = path.dirname(absolutePath);
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const relReal = path.relative(fs.realpathSync(projectDir), fs.realpathSync(probe));
  if (relReal.startsWith("..") || path.isAbsolute(relReal)) throw new Error(L(`출력 경로가 symlink 를 통해 프로젝트 밖을 가리킵니다: ${outputPath}`, `Output path points outside the project through a symlink: ${outputPath}`));
  return { relPath, absolutePath };
}
export const resolveSbomOutputPath = resolveOutputPath;

/** Maven: cyclonedx-maven-plugin 명령(출력은 임시 디렉터리로). */
export function sbomCommand(projectDir: string, buildTool: BuildTool, scope: ResolveScope, outputDirectory: string, platform?: NodeJS.Platform | string): ResolvedCommand {
  const base = resolveCommand(projectDir, buildTool, "compile", { platform });
  if (buildTool === "maven") {
    const all = scope === "all";
    return { ...base, args: ["-B", `${CYCLONEDX_MAVEN_PLUGIN}:makeAggregateBom`, "-DoutputFormat=json", "-DoutputName=bom", `-DoutputDirectory=${outputDirectory}`, `-DschemaVersion=${CYCLONEDX_SPEC_VERSION}`, `-DincludeTestScope=${all}`, `-DincludeProvidedScope=${all}`, "-DincludeSystemScope=true"] };
  }
  // Gradle 은 트리 해석 명령을 쓴다(dependency-tree.ts)
  return { ...base, args: ["dependencies", "--configuration", scope === "runtime" ? "runtimeClasspath" : "testRuntimeClasspath", "-q", "--console=plain"] };
}

export const purlOf = (groupId: string, artifactId: string, version: string, type = "jar") => `pkg:maven/${encodeURIComponent(groupId)}/${encodeURIComponent(artifactId)}@${encodeURIComponent(version)}?type=${type}`;

/** 해석된 트리로 CycloneDX 문서를 만든다(Gradle 경로·플러그인 없는 환경용, 순수 함수). */
export function buildBomFromTree(root: { name: string; group?: string; version?: string }, artifacts: ResolvedArtifact[], now: () => number = Date.now): SbomDocument {
  const rootRef = root.group && root.version ? purlOf(root.group, root.name, root.version) : `urn:egovframe:${root.name}`;
  const refOf = (a: ResolvedArtifact) => purlOf(a.groupId, a.artifactId, a.version, a.type ?? "jar");
  const byArtifactId = new Map<string, ResolvedArtifact>();
  for (const a of artifacts) if (!byArtifactId.has(a.artifactId)) byArtifactId.set(a.artifactId, a);
  const depends = new Map<string, Set<string>>();
  depends.set(rootRef, new Set());
  for (const a of artifacts) {
    const parent = a.via.length ? byArtifactId.get(a.via[a.via.length - 1]) : null;
    const parentRef = parent ? refOf(parent) : rootRef;
    if (!depends.has(parentRef)) depends.set(parentRef, new Set());
    depends.get(parentRef)!.add(refOf(a));
    if (!depends.has(refOf(a))) depends.set(refOf(a), new Set());
  }
  return {
    bomFormat: "CycloneDX",
    specVersion: CYCLONEDX_SPEC_VERSION,
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date(now()).toISOString(),
      tools: { components: [{ type: "application", name: "egovframe-scaffold-mcp", version: SERVER_VERSION }] },
      component: { type: "application", "bom-ref": rootRef, ...(root.group ? { group: root.group } : {}), name: root.name, ...(root.version ? { version: root.version } : {}) },
    },
    components: artifacts.map((a) => ({ type: "library", "bom-ref": refOf(a), group: a.groupId, name: a.artifactId, version: a.version, purl: refOf(a), scope: "required" })),
    dependencies: [...depends.entries()].map(([ref, set]) => ({ ref, dependsOn: [...set].sort() })),
  };
}

const ENRICH_KEYS = new Set(["egovframe:status", "egovframe:basis", "egovframe:baseline"]);
/** component 마다 기준 판정을 properties 로 붙인다(기존 properties 는 유지, egovframe:* 는 갱신). */
export function enrichBom(bom: SbomDocument, parentKind: ParentInfo["kind"]): Record<DependencyStatus, number> {
  const baseline = loadDependencyBaseline();
  const rules = loadMigrationRules();
  const statuses: Record<DependencyStatus, number> = { ok: 0, outdated: 0, managed: 0, legacy: 0, replace: 0, vendor: 0, unknown: 0, unversioned: 0 };
  for (const c of bom.components ?? []) {
    if (!c.group || !c.version) continue;
    const r = classifyDependency({ groupId: c.group, artifactId: c.name, version: c.version, resolvedVersion: c.version }, { baseline, rules, parentKind });
    statuses[r.status]++;
    const props = (c.properties ?? []).filter((p) => !ENRICH_KEYS.has(p.name));
    props.push({ name: "egovframe:status", value: r.status });
    if (r.basis) props.push({ name: "egovframe:basis", value: r.basis });
    if (r.baseline) props.push({ name: "egovframe:baseline", value: r.baseline });
    c.properties = props;
  }
  return statuses;
}

/** OSV 결과를 CycloneDX vulnerabilities[] 로 넣는다(같은 ID 는 affects 로 합침). */
export async function attachVulnerabilities(bom: SbomDocument, query: OsvQuery): Promise<number> {
  const comps = (bom.components ?? []).filter((c) => c.group && c.version && c["bom-ref"]);
  const byId = new Map<string, Set<string>>();
  for (let i = 0; i < comps.length; i += 100) {
    const chunk = comps.slice(i, i + 100);
    const res = await query(chunk.map((c) => ({ package: { name: `${c.group}:${c.name}`, ecosystem: "Maven" as const }, version: c.version! })));
    res.results.forEach((r, j) => { for (const v of r.vulns ?? []) { if (!byId.has(v.id)) byId.set(v.id, new Set()); byId.get(v.id)!.add(chunk[j]["bom-ref"]!); } });
  }
  bom.vulnerabilities = [...byId.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, refs]) => ({ id, "bom-ref": `vuln:${id}`, source: { name: "OSV", url: `https://osv.dev/vulnerability/${id}` }, affects: [...refs].sort().map((ref) => ({ ref })) }));
  return bom.vulnerabilities.length;
}

/** pom 의 <organization><name>·<name>(주 component 메타데이터 기본값). */
export function pomIdentity(projectDir: string): { organization?: string; name?: string; version?: string } {
  try {
    const pom = fs.readFileSync(path.join(projectDir, "pom.xml"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const self = pom.replace(/<parent>[\s\S]*?<\/parent>/, "").replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/, "").replace(/<dependencies>[\s\S]*?<\/dependencies>/, "").replace(/<build>[\s\S]*?<\/build>/, "").replace(/<licenses>[\s\S]*?<\/licenses>/, "").replace(/<developers>[\s\S]*?<\/developers>/, "");
    const organization = self.match(/<organization>[\s\S]*?<name>\s*([^<]+?)\s*<\/name>[\s\S]*?<\/organization>/)?.[1];
    const noOrg = self.replace(/<organization>[\s\S]*?<\/organization>/, "");
    const name = noOrg.match(/<name>\s*([^<]+?)\s*<\/name>/)?.[1];
    const version = noOrg.match(/<version>\s*([^<\s]+)\s*<\/version>/)?.[1];
    return { ...(organization ? { organization } : {}), ...(name && !name.includes("${") ? { name } : {}), ...(version && !version.includes("${") ? { version } : {}) };
  } catch { return {}; }
}

/** 최소 요소 메타데이터를 채운다: 공급자·작성자·주 component 이름/버전·lifecycles. 이미 있는 값은 옵션이 있을 때만 덮어쓴다. */
export function applySbomMetadata(bom: SbomDocument, meta: { supplier?: string; author?: string; componentName?: string; componentVersion?: string }): void {
  const md = (bom.metadata ??= {});
  if (meta.supplier) {
    md.supplier = { name: meta.supplier };
    if (md.component) md.component.supplier = { name: meta.supplier };
  }
  if (meta.author) md.authors = [{ name: meta.author }];
  if (md.component && meta.componentName) md.component.name = meta.componentName;
  if (md.component && meta.componentVersion) md.component.version = meta.componentVersion;
  if (!Array.isArray(md.lifecycles)) md.lifecycles = [{ phase: "build" }];
}

/** supplier·publisher·manufacturer 가 모두 없는 component 에 공급자 표의 값을 넣고 출처를 properties 로 남긴다. 채운 수를 돌려준다. */
export function fillComponentSuppliers(bom: SbomDocument): number {
  const rules = loadSbomRules();
  let filled = 0;
  for (const c of bom.components ?? []) {
    const has = (c.supplier as { name?: string } | undefined)?.name || c.publisher || (c.manufacturer as { name?: string } | undefined)?.name;
    if (has || !c.group) continue;
    const s = supplierFor(c.group, rules);
    if (!s) continue;
    c.supplier = { name: s.name, ...(s.url ? { url: [s.url] } : {}) };
    c.properties = [...(c.properties ?? []).filter((p) => p.name !== "egovframe:supplierBasis"), { name: "egovframe:supplierBasis", value: "catalog" }];
    filled++;
  }
  return filled;
}

function mavenRoot(projectDir: string): { name: string; group?: string; version?: string } {
  try {
    const pom = fs.readFileSync(path.join(projectDir, "pom.xml"), "utf8");
    const self = pom.replace(/<parent>[\s\S]*?<\/parent>/, "").replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/, "").replace(/<dependencies>[\s\S]*?<\/dependencies>/, "").replace(/<build>[\s\S]*?<\/build>/, "");
    const props = parsePomProperties(pom);
    const pick = (tag: string) => self.match(new RegExp(`<${tag}>\\s*([^<\\s]+)\\s*</${tag}>`))?.[1] ?? pom.match(new RegExp(`<parent>[\\s\\S]*?<${tag}>\\s*([^<\\s]+)[\\s\\S]*?</parent>`))?.[1];
    const resolve = (v?: string) => (v ? v.replace(/\$\{([\w.\-]+)\}/g, (_, k) => props.get(k) ?? `\${${k}}`) : v);
    return { name: pick("artifactId") ?? path.basename(projectDir), group: resolve(pick("groupId")), version: resolve(pick("version")) };
  } catch { return { name: path.basename(projectDir) }; }
}
function gradleRoot(projectDir: string): { name: string; group?: string; version?: string } {
  let name = path.basename(projectDir);
  let group: string | undefined, version: string | undefined;
  for (const f of ["settings.gradle", "settings.gradle.kts"]) {
    try { const m = fs.readFileSync(path.join(projectDir, f), "utf8").match(/rootProject\.name\s*=\s*["']([^"']+)["']/); if (m) name = m[1]; } catch { /* 없음 */ }
  }
  for (const f of ["build.gradle", "build.gradle.kts"]) {
    try { const t = fs.readFileSync(path.join(projectDir, f), "utf8"); group = t.match(/^\s*group\s*=?\s*["']([^"']+)["']/m)?.[1]; version = t.match(/^\s*version\s*=?\s*["']([^"']+)["']/m)?.[1]; } catch { /* 없음 */ }
  }
  return { name, group, version };
}

/** 프로젝트 parent 종류(기준 우선순위용) — pom 의 parent 좌표만 본다. */
export function parentKindOf(projectDir: string, buildTool: BuildTool): ParentInfo["kind"] {
  if (buildTool !== "maven") return "none";
  try {
    const pom = fs.readFileSync(path.join(projectDir, "pom.xml"), "utf8");
    const p = pom.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
    if (!p) return "none";
    const g = p.match(/<groupId>\s*([^<\s]+)/)?.[1], a = p.match(/<artifactId>\s*([^<\s]+)/)?.[1];
    const src = loadDependencyBaseline().sources.find((s) => s.groupId === g && s.artifactId === a);
    return src ? src.kind : "other";
  } catch { return "none"; }
}

/** SBOM 을 생성한다. dryRun(기본) 은 명령·출력 경로만 돌려주고 아무것도 실행·기록하지 않는다. */
/** 빌드 단위 하나의 CycloneDX 문서(Maven 플러그인 또는 해석 트리). */
async function produceBom(projectDir: string, buildTool: BuildTool, cmd: ResolvedCommand, tmpDir: string, scope: ResolveScope, runner: Runner, opts: GenerateSbomOptions, now: () => number, notes: string[], progress?: Progress): Promise<{ bom: SbomDocument; logTail?: string }> {
  let bom: SbomDocument;
  let logTail: string | undefined;
    throwIfAborted(progress?.signal);
    if (buildTool === "maven") {
      let buffer = "";
      progress?.report(`cyclonedx-maven-plugin: ${[cmd.command, ...cmd.args].join(" ")}`, 0, 1);
      const r = await runner(cmd, { timeoutMs: opts.timeoutMs ?? 600_000, onData: (c) => (buffer += c), signal: progress?.signal });
      logTail = capOutput(buffer, 60).text;
      if (r.aborted || progress?.signal?.aborted) throw new AbortError("cyclonedx-maven-plugin cancelled");
      progress?.report(`cyclonedx-maven-plugin: exit ${r.exitCode ?? "-"}${r.timedOut ? " (timeout)" : ""}`, 1, 1);
      const bomFile = path.join(tmpDir, "bom.json");
      if (r.timedOut) throw new Error(L(`SBOM 생성 시간 초과(${opts.timeoutMs ?? 600_000}ms)`, `SBOM generation timed out (${opts.timeoutMs ?? 600_000}ms)`));
      if (r.exitCode !== 0 || !fs.existsSync(bomFile)) throw new Error(L(`cyclonedx-maven-plugin 실패(종료 코드 ${r.exitCode}). 로그 끝:\n${logTail}`, `cyclonedx-maven-plugin failed (exit code ${r.exitCode}). Log tail:\n${logTail}`));
      bom = JSON.parse(fs.readFileSync(bomFile, "utf8")) as SbomDocument;
      if (bom.bomFormat !== "CycloneDX") throw new Error(L("플러그인 출력이 CycloneDX 문서가 아닙니다", "Plugin output is not a CycloneDX document"));
      // 플러그인이 metadata.timestamp 를 빼는 환경이 있다(CI 실측) — 최소 요소 '생성 시각'은 이 서버가 생성 시각으로 채운다
      const ts = bom.metadata?.timestamp;
      if (!ts || Number.isNaN(Date.parse(ts))) {
        (bom.metadata ??= {}).timestamp = new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
        notes.push(L("플러그인 출력에 metadata.timestamp 가 없어 생성 시각을 넣었습니다(최소 요소 '생성 시각').", "Plugin output had no metadata.timestamp, so the generation time was filled in (minimum element 'timestamp')."));
      }
      const tools = (bom.metadata ??= {}).tools as { components?: unknown[] } | undefined;
      const mine = { type: "application", name: "egovframe-scaffold-mcp", version: SERVER_VERSION };
      if (tools && Array.isArray(tools.components)) tools.components.push(mine); else if (!tools) bom.metadata.tools = { components: [mine] };
    } else {
      const tree = await resolveDependencyTree({ projectDir, scope, timeoutMs: opts.timeoutMs ?? 600_000, runner, platform: opts.platform, now, ...(progress ? { progress } : {}) });
      logTail = tree.logTail;
      if (!tree.success) throw new Error(L(`의존성 트리 해석 실패(${tree.error ?? "원인 미상"}). 로그 끝:\n${tree.logTail ?? ""}`, `Dependency tree resolution failed (${tree.error ?? "unknown cause"}). Log tail:\n${tree.logTail ?? ""}`));
      bom = buildBomFromTree(gradleRoot(projectDir), tree.artifacts, now);
      notes.push(L("Gradle 은 플러그인 없이 해석된 트리로 문서를 만들어 해시·라이선스 정보가 없습니다.", "For Gradle the document is built from the resolved tree without a plugin, so it has no hash or license information."));
    }
  return { bom, logTail };
}

/** v0.47: 모듈 문서를 합본으로 — 주 component 는 작업공간, 모듈 주 component 는 component 로, 의존관계는 합집합. */
export function mergeModuleBoms(name: string, parts: { name: string; dir: string; bom: SbomDocument }[], now: () => number = Date.now): SbomDocument {
  const rootRef = `workspace:${name}`;
  const comps = new Map<string, SbomComponent>();
  const deps = new Map<string, Set<string>>();
  const rootDeps: string[] = [];
  for (const p of parts) {
    const mc = p.bom.metadata?.component;
    if (mc) { const ref = mc["bom-ref"] ?? `module:${p.name}`; comps.set(ref, { ...mc, "bom-ref": ref, type: mc.type ?? "application" } as SbomComponent); rootDeps.push(ref); }
    for (const c of p.bom.components ?? []) { const ref = c["bom-ref"] ?? c.purl ?? `${c.group}:${c.name}:${c.version}`; if (!comps.has(ref)) comps.set(ref, c); }
    for (const d of p.bom.dependencies ?? []) { const set = deps.get(d.ref) ?? new Set<string>(); for (const x of d.dependsOn ?? []) set.add(x); deps.set(d.ref, set); }
  }
  const first = parts[0]?.bom;
  return {
    bomFormat: "CycloneDX", specVersion: first?.specVersion ?? CYCLONEDX_SPEC_VERSION, version: 1,
    serialNumber: `urn:uuid:${randomUUID()}`,
    metadata: { timestamp: new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z"), tools: { components: [{ type: "application", name: "egovframe-scaffold-mcp", version: SERVER_VERSION }] }, component: { type: "application", name, "bom-ref": rootRef } as SbomComponent },
    components: [...comps.values()],
    dependencies: [{ ref: rootRef, dependsOn: rootDeps }, ...[...deps].map(([ref, set]) => ({ ref, dependsOn: [...set] }))],
  } as SbomDocument;
}

export async function generateSbom(opts: GenerateSbomOptions): Promise<GenerateSbomResult> {
  throwIfAborted(opts.progress?.signal);
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory does not exist: ${projectDir}`));
  const buildTool = detectBuildToolAt(projectDir);
  const ws = detectWorkspace(projectDir);
  if (!buildTool && !(ws.kind === "independent" && ws.modules.length)) throw new Error(L(`빌드 파일(pom.xml·build.gradle)을 찾지 못했습니다: ${projectDir}`, `No build file (pom.xml/build.gradle) found: ${projectDir}`));
  const format: SbomFormat = opts.format ?? "cyclonedx-json";
  if (format !== "cyclonedx-json" && format !== "spdx-json") throw new Error(L(`지원하지 않는 format: ${format}`, `Unsupported format: ${format}`));
  const spdx = format === "spdx-json";
  const scope = opts.scope ?? "runtime";
  const { relPath, absolutePath } = resolveSbomOutputPath(projectDir, opts.outputPath ?? (spdx ? DEFAULT_SPDX_PATH : DEFAULT_SBOM_PATH));
  const exists = fs.existsSync(absolutePath);
  const dryRun = opts.dryRun !== false;
  const notes: string[] = [];
  const statuses: Record<DependencyStatus, number> = { ok: 0, outdated: 0, managed: 0, legacy: 0, replace: 0, vendor: 0, unknown: 0, unversioned: 0 };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "egov-sbom-"));
  const cmd = buildTool ? sbomCommand(projectDir, buildTool, scope, tmpDir, opts.platform) : null;
  const effectiveTool: BuildTool = buildTool ?? ws.modules[0].buildTool;
  const command = cmd ? [cmd.command, ...cmd.args].join(" ") : L(`(프로젝트별 ${ws.modules.length}개: ${[...new Set(ws.modules.map((m) => m.buildTool))].join("·")})`, `(per project, ${ws.modules.length}: ${[...new Set(ws.modules.map((m) => m.buildTool))].join("·")})`);
  const generator: GenerateSbomResult["generator"] = effectiveTool === "maven" && buildTool ? "cyclonedx-maven-plugin" : "egovframe-scaffold-mcp";
  const base: GenerateSbomResult = { projectDir, buildTool: effectiveTool, format, specVersion: spdx ? SPDX_VERSION : CYCLONEDX_SPEC_VERSION, outputPath: relPath, absolutePath, dryRun, written: false, overwritten: false, command, generator, components: 0, direct: 0, transitive: 0, statuses, vulnerabilities: 0, bytes: 0, notes };
  if (exists && !opts.overwrite && !dryRun && !opts.noWrite) { fs.rmSync(tmpDir, { recursive: true, force: true }); throw new Error(L(`${relPath} 이 이미 있습니다. 덮어쓰려면 overwrite=true 를 쓰세요.`, `${relPath} already exists. Use overwrite=true to overwrite it.`)); }
  if (dryRun) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    notes.push(L(`dryRun — 실행하지 않았습니다. dryRun=false 로 ${buildTool === "maven" ? "cyclonedx-maven-plugin 을 실행해" : "의존성 트리를 해석해"} ${relPath} 에 ${spdx ? `SPDX 2.3 JSON(CycloneDX ${CYCLONEDX_SPEC_VERSION} 로 만든 뒤 변환)` : `CycloneDX ${CYCLONEDX_SPEC_VERSION} JSON`} 을 씁니다.${exists ? ` 기존 파일이 있어 overwrite=true 가 필요합니다.` : ""}`, `dryRun — nothing was executed. With dryRun=false, ${buildTool === "maven" ? "cyclonedx-maven-plugin is run" : "the dependency tree is resolved"} and ${spdx ? `SPDX 2.3 JSON (built as CycloneDX ${CYCLONEDX_SPEC_VERSION}, then converted)` : `CycloneDX ${CYCLONEDX_SPEC_VERSION} JSON`} is written to ${relPath}.${exists ? ` The file already exists, so overwrite=true is required.` : ""}`));
    return base;
  }

  const now = opts.now ?? Date.now;
  const runner = opts.runner ?? defaultRunner;
  const started = now();
  let bom: SbomDocument;
  let logTail: string | undefined;
  const modulesWritten: { path: string; json: string }[] = [];
  // v1.2: 진행 단계 — 실제로 수행하는 단계만 나열한다(생성[모듈별] → enrich → OSV → SPDX 변환 → 기록)
  const genSteps = buildTool && cmd ? [buildTool === "maven" ? "cyclonedx-maven-plugin" : "dependency tree"] : ws.modules.map((m) => `${m.buildTool === "maven" ? "cyclonedx-maven-plugin" : "dependency tree"} (module ${m.name})`);
  const steps = [...genSteps, ...(opts.enrich !== false ? ["enrich components"] : []), ...(opts.offline === false ? ["query OSV"] : []), ...(spdx ? ["convert to SPDX"] : []), ...(opts.noWrite ? [] : ["write SBOM"])];
  const prog = stepper(opts.progress, steps);
  let stepNo = 0;
  const subFor = (i: number, prefix?: string) => (opts.progress ? subProgress(opts.progress, i, i + 1, steps.length, prefix) : undefined);
  try {
    if (buildTool && cmd) { prog.step(stepNo); ({ bom, logTail } = await produceBom(projectDir, buildTool, cmd, tmpDir, scope, runner, opts, now, notes, subFor(stepNo))); stepNo++; }
    else {
      // v0.47: 루트 빌드 파일이 없는 독립 프로젝트 묶음 — 프로젝트마다 만들고 합본(주 component 아래 모듈 component)
      const mods = ws.modules.filter((m) => !m.library || true);
      const parts: { name: string; dir: string; bom: SbomDocument }[] = [];
      for (const m of mods) {
        const mdir = path.join(projectDir, m.dir);
        const mtmp = fs.mkdtempSync(path.join(os.tmpdir(), "egov-sbom-m-"));
        try {
          prog.step(stepNo);
          const mcmd = sbomCommand(mdir, m.buildTool, scope, mtmp, opts.platform);
          const r = await produceBom(mdir, m.buildTool, mcmd, mtmp, scope, runner, opts, now, notes, subFor(stepNo, `module ${m.name}`));
          stepNo++;
          parts.push({ name: m.name, dir: m.dir, bom: r.bom });
          logTail = r.logTail;
        } finally { fs.rmSync(mtmp, { recursive: true, force: true }); }
      }
      bom = mergeModuleBoms(path.basename(projectDir), parts, now);
      for (const p of parts) modulesWritten.push({ path: path.posix.join(path.posix.dirname(relPath), "modules", `${p.name}.cdx.json`), json: `${JSON.stringify(p.bom, null, 2)}\n` });
      notes.push(L(`작업공간(독립 프로젝트 ${parts.length}개)을 프로젝트마다 만들어 합쳤습니다 — 합본 ${relPath}, 모듈별 ${path.posix.join(path.posix.dirname(relPath), "modules")}/<모듈>.cdx.json.`, `Workspace (${parts.length} independent project(s)) was generated per project and merged — combined ${relPath}, per module ${path.posix.join(path.posix.dirname(relPath), "modules")}/<module>.cdx.json.`));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  const durationMs = now() - started;

  const comps = bom.components ?? [];
  const rootRef = bom.metadata?.component?.["bom-ref"];
  const directRefs = new Set((bom.dependencies ?? []).find((d) => d.ref === rootRef)?.dependsOn ?? []);
  const direct = comps.filter((c) => c["bom-ref"] && directRefs.has(c["bom-ref"])).length;

  // v0.40: 최소 요소 메타데이터(공급자·작성자·주 component)와 component 공급자 보완
  const ident = buildTool === "maven" ? pomIdentity(projectDir) : {};
  const supplier = opts.supplier ?? ident.organization;
  applySbomMetadata(bom, { supplier, author: opts.author ?? supplier, componentName: opts.componentName, componentVersion: opts.componentVersion });
  const supplierFilled = (opts.fillSuppliers ?? opts.enrich !== false) ? fillComponentSuppliers(bom) : 0;
  if (supplierFilled) notes.push(L(`공급자가 없던 component ${supplierFilled}종을 공급자 표(catalog/sbom-rules.json)로 보완했습니다(properties egovframe:supplierBasis=catalog).`, `${supplierFilled} component(s) without a supplier were filled from the supplier table (catalog/sbom-rules.json) (properties egovframe:supplierBasis=catalog).`));
  if (!supplier) notes.push(L("공급자·작성자 미지정 — supplier·author 옵션 또는 pom <organization><name> 이 없으면 최소 요소 점검에서 '보완 필요'가 됩니다.", "Supplier and author not specified — without the supplier/author options or pom <organization><name>, the minimum elements check reports 'needs work'."));

  if (opts.enrich !== false) { prog.step(stepNo++); Object.assign(statuses, enrichBom(bom, buildTool ? parentKindOf(projectDir, buildTool) : "boot")); }
  let vulnerabilities = 0;
  let osvError: string | undefined;
  if (opts.offline === false) {
    prog.step(stepNo++);
    try { vulnerabilities = await attachVulnerabilities(bom, opts.osvQuery ?? defaultOsvQuery); if (!opts.osvQuery) { const n = osvProvenanceNote(); if (n) notes.push(n); } } catch (e) { if (e instanceof Error && e.name === "AbortError") throw e; osvError = L(`OSV 조회 실패: ${e instanceof Error ? e.message : String(e)}`, `OSV query failed: ${e instanceof Error ? e.message : String(e)}`); }
    throwIfAborted(opts.progress?.signal);
  }

  // v0.43: SPDX 2.3 — CycloneDX 로 만든 문서를 변환해 쓰고, 최소 요소는 SPDX 를 다시 읽은 모양으로 점검(점검 도구와 같은 경로)
  let spdxDoc: SpdxDocument | undefined;
  if (spdx) {
    prog.step(stepNo++);
    const conv = cdxToSpdx(bom, { now });
    spdxDoc = conv.doc;
    notes.push(...conv.notes, L(`SPDX 2.3 으로 변환했습니다 — 패키지 ${conv.doc.packages?.length ?? 0} · 관계 ${conv.doc.relationships?.length ?? 0}. VEX 초안(check_egovframe_sbom vex=true)은 CycloneDX SBOM 에서만 만듭니다.`, `Converted to SPDX 2.3 — ${conv.doc.packages?.length ?? 0} package(s) · ${conv.doc.relationships?.length ?? 0} relationship(s). A VEX draft (check_egovframe_sbom vex=true) is only produced from a CycloneDX SBOM.`));
  }
  const json = `${JSON.stringify(spdxDoc ?? bom, null, 2)}\n`;
  if (!opts.noWrite) {
    prog.step(stepNo++);
    await withFileTransaction(projectDir, L("SBOM 생성", "SBOM generation"), (tx) => {
      tx.writeFile(relPath, json, { mustNotExist: !exists });
      for (const m of modulesWritten) tx.writeFile(m.path, m.json, { mustNotExist: !(opts.overwrite && fs.existsSync(path.join(projectDir, m.path))) });
    });
  }
  prog.finish("SBOM: done");
  const mr = checkMinimumElements(spdxDoc ? spdxToCdx(spdxDoc).bom : bom);
  const minimum = { verdict: mr.verdict, missing: mr.elements.filter((e) => !e.ok).map((e) => e.id), componentsWithGaps: mr.componentsWithGaps, supplierFromCatalog: mr.supplierFromCatalog };
  return { ...base, written: !opts.noWrite, overwritten: !opts.noWrite && exists, durationMs, components: comps.length, direct, transitive: comps.length - direct, statuses, vulnerabilities, ...(osvError ? { osvError } : {}), minimum, bytes: Buffer.byteLength(json), bom, ...(spdxDoc ? { spdx: spdxDoc } : {}), logTail };
}

/** 결과 요약 Markdown. */
export function renderSbomMarkdown(r: GenerateSbomResult): string {
  const out: string[] = [];
  out.push(r.format === "spdx-json" ? L(`# SBOM 생성 (SPDX 2.3 JSON)`, `# SBOM generation (SPDX 2.3 JSON)`) : L(`# SBOM 생성 (CycloneDX ${r.specVersion} JSON)`, `# SBOM generation (CycloneDX ${r.specVersion} JSON)`), ``);
  out.push(L(`- 경로: ${r.projectDir} · 빌드 ${r.buildTool} · 생성기 ${r.generator}`, `- Path: ${r.projectDir} · build ${r.buildTool} · generator ${r.generator}`));
  out.push(L(`- 출력: ${r.outputPath}${r.written ? ` (${r.bytes} bytes${r.overwritten ? ", 덮어씀" : ""})` : r.dryRun ? " (dryRun — 쓰지 않음)" : ""}`, `- Output: ${r.outputPath}${r.written ? ` (${r.bytes} bytes${r.overwritten ? ", overwritten" : ""})` : r.dryRun ? " (dryRun — not written)" : ""}`));
  out.push(L(`- 명령: \`${r.command}\``, `- Command: \`${r.command}\``));
  if (r.written) {
    out.push(L(`- component ${r.components}종 = 직접 ${r.direct} + 전이 ${r.transitive}${r.durationMs !== undefined ? ` · ${r.durationMs}ms` : ""}`, `- ${r.components} component(s) = ${r.direct} direct + ${r.transitive} transitive${r.durationMs !== undefined ? ` · ${r.durationMs}ms` : ""}`));
    const s = r.statuses;
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    if (total) out.push(L(`- 기준 판정(egovframe:status): 기준 충족 ${s.ok} · 기준 미만 ${s.outdated} · 전환 대상 ${s.legacy} · 교체 필요 ${s.replace} · 벤더 ${s.vendor} · 기준 없음 ${s.unknown}`, `- Baseline status (egovframe:status): meets baseline ${s.ok} · below baseline ${s.outdated} · migration target ${s.legacy} · needs replacement ${s.replace} · vendor ${s.vendor} · no baseline ${s.unknown}`));
    if (r.minimum) out.push(L(`- 최소 요소 7종: ${r.minimum.verdict === "ready" ? "✅ 제출 가능" : `⚠️ 보완 필요(${r.minimum.missing.join("·")}) — check_egovframe_sbom 으로 상세 확인`}`, `- 7 minimum elements: ${r.minimum.verdict === "ready" ? "✅ ready to submit" : `⚠️ needs work (${r.minimum.missing.join("·")}) — see check_egovframe_sbom for details`}`));
    out.push(L(`- 취약점(vulnerabilities[]): ${r.osvError ? r.osvError : r.vulnerabilities}${!r.osvError && r.vulnerabilities === 0 && r.bom?.vulnerabilities === undefined ? " (offline — 조회 안 함; offline=false 로 OSV 조회)" : ""}`, `- Vulnerabilities (vulnerabilities[]): ${r.osvError ? r.osvError : r.vulnerabilities}${!r.osvError && r.vulnerabilities === 0 && r.bom?.vulnerabilities === undefined ? " (offline — not queried; use offline=false to query OSV)" : ""}`));
    if (r.bom?.vulnerabilities?.length) for (const v of r.bom.vulnerabilities.slice(0, 15)) out.push(`  - ${v.id}: ${v.affects.map((a) => a.ref.replace(/^pkg:maven\//, "").replace(/\?type=.*$/, "")).join(", ")}`);
  }
  for (const n of r.notes) out.push(`- ${n}`);
  out.push(``, `---`, L(`SBOM 은 공공 SW 공급망 보안 로드맵(2027년 공공기관 SBOM 등록)에 맞춘 표준 형식(CycloneDX 1.6 · SPDX 2.3)입니다. 기준 판정은 check_egovframe_dependencies 와 같은 규칙입니다.`, `The SBOM uses the standard formats (CycloneDX 1.6 · SPDX 2.3) aligned with Korea's public-sector software supply-chain security roadmap (SBOM registration for public institutions in 2027). Baseline status uses the same rules as check_egovframe_dependencies.`));
  return out.join("\n");
}
