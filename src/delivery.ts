// 납품 패키지 (v1.1) — 감리·검수에 내는 산출물을 한 디렉터리에 모으고 manifest(sha256)·목차·이전 차수 비교를 만든다.
//   기존 도구를 그대로 불러 쓰며(평가서·의존성·SBOM·SBOM 점검·VEX·보안약점·SARIF·배포 산출물·빌드), 실패한 항목은 빼지 않고 이유와 함께 목차에 남긴다.
//   새 디렉터리에만 쓴다(오프라인 번들과 같은 방식: 비어 있지 않으면 거부, 스테이징 → rename). 프로젝트는 읽기만 한다(SBOM 도 프로젝트에 쓰지 않음).
//   verify: 받은 쪽이 manifest 의 지문을 다시 계산해 변조·누락을 본다.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { SERVER_VERSION } from "./version.js";
import { assessProject, renderAssessmentMarkdown, type AssessmentResult, type AssessmentOptions } from "./assessment.js";
import { checkDependencies, renderDependencyMarkdown, type CheckDependenciesResult, type OsvQuery } from "./dependencies.js";
import { generateSbom, renderSbomMarkdown, parentKindOf, CYCLONEDX_SPEC_VERSION, type GenerateSbomResult, type SbomDocument } from "./sbom.js";
import { checkMinimumElements, recheckSbom, diffSboms, mergeVex, renderSbomCheckMarkdown, type CheckSbomResult, type VexDocument, type SbomDiff } from "./sbom-check.js";
import { cdxToSpdx } from "./spdx.js";
import { checkSecureCoding, renderSecureCodingMarkdown, toSarif, type SecureCodingResult } from "./secure-coding.js";
import { generateDeploy, renderDeployMarkdown, type GenerateDeployResult } from "./deploy.js";
import { runBuild, detectBuildToolAt, type BuildRunResult } from "./build-runner.js";
import type { Runner } from "./build-runner.js";

export const DELIVERY_MANIFEST = "delivery-manifest.json";
export const DELIVERY_INDEX = "index.md";
export const DELIVERY_SCHEMA_VERSION = 1;

export type DeliveryItemId = "assessment" | "dependencies" | "sbom" | "sbom-check" | "secure-coding" | "deploy" | "build";
export const DELIVERY_ITEMS: DeliveryItemId[] = ["assessment", "dependencies", "sbom", "sbom-check", "secure-coding", "deploy", "build"];
/** 기본 포함(빌드는 시간이 걸리고 환경 의존이라 지정할 때만) */
export const DELIVERY_DEFAULT_INCLUDE: DeliveryItemId[] = ["assessment", "dependencies", "sbom", "sbom-check", "secure-coding", "deploy"];
export const DELIVERY_ITEM_LABEL: Record<DeliveryItemId, string> = {
  assessment: "전환 준비도 평가서", dependencies: "의존성 조치 목록", sbom: "SBOM(CycloneDX·SPDX)", "sbom-check": "SBOM 점검·VEX 초안", "secure-coding": "보안약점 점검(SARIF)", deploy: "컨테이너·배포 산출물", build: "빌드 결과",
};

export interface DeliveryFile { path: string; sha256: string; bytes: number }
export interface DeliveryItem { id: DeliveryItemId; label: string; status: "ok" | "failed" | "skipped"; durationMs: number; files: string[]; summary: Record<string, unknown>; error?: string }
export interface DeliveryManifest {
  schemaVersion: number;
  tool: { name: string; version: string };
  createdAt: string;
  project: { name: string; buildTool: string | null; fingerprint: string; fingerprintFiles: number };
  items: DeliveryItem[];
  files: DeliveryFile[];
  /** 모든 파일(manifest 제외)의 "path sha256" 를 정렬해 이은 것의 sha256 — 공문·메일에 한 줄로 인용 */
  rootHash: string;
  previous?: { dir: string; createdAt: string | null; rootHash: string | null };
}

export interface DeliveryDiff {
  previousDir: string;
  previousCreatedAt: string | null;
  grades: { migration: { from: string | null; to: string | null }; supplyChain: { from: string | null; to: string | null } } | null;
  sbom: SbomDiff | null;
  vulnerabilities: { added: string[]; resolved: string[] } | null;
  secureCoding: { added: number; resolved: number; from: number | null; to: number | null } | null;
  dependencies: { from: Record<string, number> | null; to: Record<string, number> | null } | null;
  /** 비교할 수 없었던 항목과 이유 */
  skipped: string[];
  changed: boolean;
}

export interface PrepareDeliveryOptions {
  projectDir: string;
  outputDir: string;
  include?: DeliveryItemId[];
  previousDelivery?: string;
  /** false 면 OSV 조회(의존성·SBOM·평가서) */
  offline?: boolean;
  zip?: boolean;
  dryRun?: boolean;
  /** SBOM 공급자·작성자(없으면 pom <organization><name>) */
  supplier?: string;
  author?: string;
  /** 빌드 항목의 타임아웃 */
  timeoutMs?: number;
  /** 테스트 주입 */
  osvQuery?: OsvQuery;
  runner?: Runner;
  now?: () => number;
}
export interface PrepareDeliveryResult {
  projectDir: string;
  outputDir: string;
  dryRun: boolean;
  written: boolean;
  include: DeliveryItemId[];
  items: DeliveryItem[];
  files: number;
  bytes: number;
  rootHash: string | null;
  manifestPath?: string;
  zipPath?: string;
  diff?: DeliveryDiff;
  notes: string[];
}
export interface VerifyDeliveryResult {
  dir: string;
  ok: boolean;
  manifest: { createdAt: string; tool: string; rootHash: string; files: number; items: number } | null;
  verified: number;
  mismatched: { path: string; expected: string; actual: string }[];
  missing: string[];
  extra: string[];
  rootHashMatches: boolean | null;
  notes: string[];
}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const toPosix = (p: string) => p.split(path.sep).join("/");
const SKIP_DIRS = new Set(["target", "build", "node_modules", ".git", ".gradle", ".idea", "out", "dist", "bin"]);

/** 입력 지문 — 빌드 파일 내용 + 소스 트리(경로·크기). 같은 입력으로 만든 패키지인지 가린다. */
export function projectFingerprint(projectDir: string, maxFiles = 20_000): { sha256: string; files: number } {
  const h = createHash("sha256");
  let n = 0;
  const stack = [projectDir];
  const entries: string[] = [];
  while (stack.length && n < maxFiles) {
    const d = stack.pop()!;
    let list: fs.Dirent[];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(abs); continue; }
      if (!e.isFile()) continue;
      const rel = toPosix(path.relative(projectDir, abs));
      const isBuild = /(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties)$/.test(rel);
      if (isBuild) entries.push(`${rel}\0${sha256(fs.readFileSync(abs))}`);
      else if (/^src\//.test(rel) || /\/src\//.test(rel)) entries.push(`${rel}\0${fs.statSync(abs).size}`);
      else continue;
      n++;
    }
  }
  for (const e of entries.sort()) h.update(e).update("\n");
  return { sha256: h.digest("hex"), files: entries.length };
}

/** 모든 파일의 "path sha256" 정렬 → sha256 */
export function rootHashOf(files: DeliveryFile[]): string {
  return sha256([...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => `${f.path} ${f.sha256}`).join("\n"));
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) stack.push(abs); else if (e.isFile()) out.push(toPosix(path.relative(dir, abs)));
    }
  }
  return out.sort();
}

/** 받은 패키지의 지문 재검증. */
export function verifyDelivery(dir: string): VerifyDeliveryResult {
  const root = path.resolve(dir);
  const notes: string[] = [];
  const mf = path.join(root, DELIVERY_MANIFEST);
  if (!fs.existsSync(mf)) return { dir: root, ok: false, manifest: null, verified: 0, mismatched: [], missing: [DELIVERY_MANIFEST], extra: [], rootHashMatches: null, notes: [`${DELIVERY_MANIFEST} 가 없습니다 — 납품 패키지 디렉터리가 아니거나 manifest 가 지워졌습니다.`] };
  let m: DeliveryManifest;
  try { m = JSON.parse(fs.readFileSync(mf, "utf8")); } catch (e) { return { dir: root, ok: false, manifest: null, verified: 0, mismatched: [], missing: [], extra: [], rootHashMatches: null, notes: [`${DELIVERY_MANIFEST} JSON 해석 실패: ${e instanceof Error ? e.message : String(e)}`] }; }
  const mismatched: VerifyDeliveryResult["mismatched"] = [];
  const missing: string[] = [];
  let verified = 0;
  const actualFiles: DeliveryFile[] = [];
  for (const f of m.files) {
    const abs = path.join(root, f.path);
    if (!fs.existsSync(abs)) { missing.push(f.path); continue; }
    const buf = fs.readFileSync(abs);
    const actual = sha256(buf);
    actualFiles.push({ path: f.path, sha256: actual, bytes: buf.length });
    if (actual !== f.sha256 || buf.length !== f.bytes) mismatched.push({ path: f.path, expected: f.sha256, actual });
    else verified++;
  }
  const listed = new Set(m.files.map((f) => f.path));
  const extra = walkFiles(root).filter((p) => p !== DELIVERY_MANIFEST && !listed.has(p));
  const rootHashMatches = missing.length === 0 ? rootHashOf(actualFiles) === m.rootHash : null;
  const ok = mismatched.length === 0 && missing.length === 0 && rootHashMatches === true;
  if (extra.length) notes.push(`manifest 에 없는 파일 ${extra.length}개 — 검증 대상은 아니지만 패키지에 섞여 있습니다: ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? " …" : ""}`);
  if (!ok) notes.push("지문이 맞지 않습니다 — 전송 중 손상되었거나 만든 뒤 바뀐 파일입니다. 만든 쪽의 rootHash 와 대조하세요.");
  return { dir: root, ok, manifest: { createdAt: m.createdAt, tool: `${m.tool.name} ${m.tool.version}`, rootHash: m.rootHash, files: m.files.length, items: m.items.length }, verified, mismatched, missing, extra, rootHashMatches, notes };
}

// ── 이전 차수 비교 ──────────────────────────────────────
interface PreviousData { manifest: DeliveryManifest | null; sbom: SbomDocument | null; assessment: AssessmentResult | null; secure: SecureCodingResult | null; dependencies: CheckDependenciesResult | null }
function readJson<T>(p: string): T | null { try { return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : null; } catch { return null; } }
export function readDeliveryData(dir: string): PreviousData {
  return {
    manifest: readJson<DeliveryManifest>(path.join(dir, DELIVERY_MANIFEST)),
    sbom: readJson<SbomDocument>(path.join(dir, "sbom", "bom.cdx.json")),
    assessment: readJson<AssessmentResult>(path.join(dir, "assessment", "assessment.json")),
    secure: readJson<SecureCodingResult>(path.join(dir, "secure-coding", "secure-coding.json")),
    dependencies: readJson<CheckDependenciesResult>(path.join(dir, "dependencies", "dependencies.json")),
  };
}
const vulnIds = (d: CheckDependenciesResult | null): Set<string> => new Set((d?.vulnerabilities ?? []).flatMap((v) => v.ids));

/** 이전 패키지(디렉터리)와 지금 데이터의 차이. 시각·serialNumber 는 보지 않는다(같은 입력이면 changed=false). */
export function diffDeliveries(previousDir: string, prev: PreviousData, cur: PreviousData, currentOsv?: Parameters<typeof diffSboms>[3]): DeliveryDiff {
  const skipped: string[] = [];
  let grades: DeliveryDiff["grades"] = null;
  if (prev.assessment && cur.assessment) grades = { migration: { from: prev.assessment.grades.migration.grade, to: cur.assessment.grades.migration.grade }, supplyChain: { from: prev.assessment.grades.supplyChain.grade, to: cur.assessment.grades.supplyChain.grade } };
  else skipped.push(`평가서 등급: ${!prev.assessment ? "이전" : "현재"} 패키지에 assessment/assessment.json 없음`);
  let sbom: SbomDiff | null = null;
  if (prev.sbom && cur.sbom) sbom = diffSboms(cur.sbom, prev.sbom, path.posix.join(path.basename(previousDir), "sbom/bom.cdx.json"), currentOsv);
  else skipped.push(`SBOM: ${!prev.sbom ? "이전" : "현재"} 패키지에 sbom/bom.cdx.json 없음`);
  let vulnerabilities: DeliveryDiff["vulnerabilities"] = null;
  if (prev.dependencies && cur.dependencies) { const a = vulnIds(prev.dependencies), b = vulnIds(cur.dependencies); vulnerabilities = { added: [...b].filter((x) => !a.has(x)).sort(), resolved: [...a].filter((x) => !b.has(x)).sort() }; }
  else skipped.push(`의존성 취약점: ${!prev.dependencies ? "이전" : "현재"} 패키지에 dependencies/dependencies.json 없음`);
  let secureCoding: DeliveryDiff["secureCoding"] = null;
  if (prev.secure && cur.secure) { const a = new Set(prev.secure.findings.map((f) => f.fingerprint)), b = new Set(cur.secure.findings.map((f) => f.fingerprint)); secureCoding = { added: [...b].filter((x) => !a.has(x)).length, resolved: [...a].filter((x) => !b.has(x)).length, from: prev.secure.summary.total, to: cur.secure.summary.total }; }
  else skipped.push(`보안약점: ${!prev.secure ? "이전" : "현재"} 패키지에 secure-coding/secure-coding.json 없음`);
  const dependencies = prev.dependencies && cur.dependencies ? { from: prev.dependencies.summary as unknown as Record<string, number>, to: cur.dependencies.summary as unknown as Record<string, number> } : null;
  const changed = !!(
    (grades && (grades.migration.from !== grades.migration.to || grades.supplyChain.from !== grades.supplyChain.to)) ||
    (sbom && (sbom.added.length || sbom.removed.length || sbom.versionChanged.length || sbom.newVulnerabilities.length || sbom.resolvedVulnerabilities.length)) ||
    (vulnerabilities && (vulnerabilities.added.length || vulnerabilities.resolved.length)) ||
    (secureCoding && (secureCoding.added || secureCoding.resolved)) ||
    (dependencies && JSON.stringify(dependencies.from) !== JSON.stringify(dependencies.to))
  );
  return { previousDir, previousCreatedAt: prev.manifest?.createdAt ?? null, grades, sbom, vulnerabilities, secureCoding, dependencies, skipped, changed };
}

export function renderDeliveryDiffMarkdown(d: DeliveryDiff): string {
  const L: string[] = [`# 이전 차수와 비교`, ``, `- 이전 패키지: \`${d.previousDir}\`${d.previousCreatedAt ? ` (${d.previousCreatedAt})` : ""}`, `- 결과: **${d.changed ? "달라진 점 있음" : "달라진 점 없음"}**`, ``];
  if (d.grades) L.push(`## 등급`, ``, `| 축 | 이전 | 현재 |`, `|---|---|---|`, `| 전환 난이도 | ${d.grades.migration.from} | ${d.grades.migration.to} |`, `| 공급망 상태 | ${d.grades.supplyChain.from} | ${d.grades.supplyChain.to} |`, ``);
  if (d.sbom) {
    L.push(`## SBOM`, ``, `- 추가 ${d.sbom.added.length} · 제거 ${d.sbom.removed.length} · 버전 변경 ${d.sbom.versionChanged.length} · 그대로 ${d.sbom.unchanged}`, `- 새 취약점 ${d.sbom.newVulnerabilities.length} · 해소된 취약점 ${d.sbom.resolvedVulnerabilities.length}`, ``);
    for (const a of d.sbom.added.slice(0, 20)) L.push(`- 추가: ${a.component}${a.version ? `@${a.version}` : ""}`);
    for (const r of d.sbom.removed.slice(0, 20)) L.push(`- 제거: ${r.component}${r.version ? `@${r.version}` : ""}`);
    for (const v of d.sbom.versionChanged.slice(0, 20)) L.push(`- 버전: ${v.component} ${v.from} → ${v.to}`);
    for (const v of d.sbom.newVulnerabilities.slice(0, 20)) L.push(`- 새 취약점: ${v.id} (${v.components.join(", ")})`);
    if (d.sbom.added.length + d.sbom.removed.length + d.sbom.versionChanged.length + d.sbom.newVulnerabilities.length) L.push(``);
  }
  if (d.vulnerabilities) L.push(`## 의존성 취약점(OSV)`, ``, `- 새로 생김 ${d.vulnerabilities.added.length}${d.vulnerabilities.added.length ? `: ${d.vulnerabilities.added.slice(0, 10).join(", ")}` : ""}`, `- 해소 ${d.vulnerabilities.resolved.length}${d.vulnerabilities.resolved.length ? `: ${d.vulnerabilities.resolved.slice(0, 10).join(", ")}` : ""}`, ``);
  if (d.secureCoding) L.push(`## 보안약점`, ``, `- 총 ${d.secureCoding.from} → ${d.secureCoding.to} · 새 항목 ${d.secureCoding.added} · 해소 ${d.secureCoding.resolved}`, ``);
  if (d.dependencies?.from && d.dependencies.to) {
    L.push(`## 의존성 판정`, ``, `| 판정 | 이전 | 현재 |`, `|---|---|---|`);
    for (const k of Object.keys(d.dependencies.to)) L.push(`| ${k} | ${d.dependencies.from[k] ?? 0} | ${d.dependencies.to[k]} |`);
    L.push(``);
  }
  if (d.skipped.length) L.push(`## 비교하지 못한 항목`, ``, ...d.skipped.map((s) => `- ${s}`), ``);
  return L.join("\n");
}

// ── 패키지 만들기 ──────────────────────────────────────
type Staged = { rel: string; content: string | Buffer }[];

export async function prepareDelivery(opts: PrepareDeliveryOptions): Promise<PrepareDeliveryResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const outputDir = path.resolve(opts.outputDir);
  const include = (opts.include?.length ? opts.include : DELIVERY_DEFAULT_INCLUDE).filter((x, i, a) => a.indexOf(x) === i);
  for (const id of include) if (!DELIVERY_ITEMS.includes(id)) throw new Error(`알 수 없는 항목: ${id} (지원: ${DELIVERY_ITEMS.join(", ")})`);
  if (include.includes("sbom-check") && !include.includes("sbom")) throw new Error("sbom-check 는 sbom 항목이 있어야 합니다(이 패키지의 SBOM 을 점검).");
  const dryRun = opts.dryRun !== false;
  const offline = opts.offline !== false;
  const now = opts.now ?? Date.now;
  const notes: string[] = [];
  const rel = path.relative(projectDir, outputDir);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error(`outputDir 는 프로젝트 밖이어야 합니다(프로젝트는 읽기만 함): ${outputDir}`);
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) throw new Error(`outputDir 가 비어 있지 않습니다: ${outputDir} — 차수마다 새 디렉터리를 지정하세요(이전 차수는 previousDelivery 로 비교)`);
  let previousDir: string | undefined;
  if (opts.previousDelivery) {
    previousDir = path.resolve(opts.previousDelivery);
    if (!fs.existsSync(path.join(previousDir, DELIVERY_MANIFEST))) throw new Error(`previousDelivery 에 ${DELIVERY_MANIFEST} 가 없습니다: ${previousDir}`);
  }
  const fp = projectFingerprint(projectDir);
  const buildTool = detectBuildToolAt(projectDir);
  const items: DeliveryItem[] = include.map((id) => ({ id, label: DELIVERY_ITEM_LABEL[id], status: "skipped", durationMs: 0, files: [], summary: {} }));
  const result: PrepareDeliveryResult = { projectDir, outputDir, dryRun, written: false, include, items, files: 0, bytes: 0, rootHash: null, notes };
  if (dryRun) {
    notes.push(`dryRun — 만들지 않았습니다. dryRun=false 로 ${include.length}개 항목(${include.map((i) => DELIVERY_ITEM_LABEL[i]).join("·")})을 ${outputDir} 에 씁니다${previousDir ? `. 이전 차수 ${previousDir} 와 비교합니다` : ""}.`);
    if (offline) notes.push("offline — OSV 취약점은 조회하지 않습니다(offline=false 또는 오프라인 번들).");
    return result;
  }

  const staged: Staged = [];
  const put = (relPath: string, content: string | Buffer) => { staged.push({ rel: relPath, content }); return relPath; };
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  const ctx: { sbom?: GenerateSbomResult; assessment?: AssessmentResult; secure?: SecureCodingResult; dependencies?: CheckDependenciesResult; deploy?: GenerateDeployResult; build?: BuildRunResult; checkOsv?: Parameters<typeof diffSboms>[3] } = {};
  const prevData = previousDir ? readDeliveryData(previousDir) : null;

  const run = async (id: DeliveryItemId, fn: (item: DeliveryItem) => Promise<void>) => {
    const item = items.find((x) => x.id === id)!;
    const t0 = now();
    try { await fn(item); item.status = "ok"; } catch (e) {
      // 실패한 항목의 파일은 패키지에 넣지 않는다(목차에 이유만 남김)
      item.status = "failed"; item.error = e instanceof Error ? e.message : String(e);
      const drop = new Set(item.files); item.files = [];
      staged.splice(0, staged.length, ...staged.filter((s) => !drop.has(s.rel)));
    }
    item.durationMs = now() - t0;
  };

  if (include.includes("sbom")) await run("sbom", async (item) => {
    const r = await generateSbom({ projectDir, dryRun: false, noWrite: true, offline, osvQuery: opts.osvQuery, supplier: opts.supplier, author: opts.author, runner: opts.runner, now });
    if (!r.bom) throw new Error("SBOM 문서를 만들지 못했습니다");
    ctx.sbom = r;
    item.files.push(put("sbom/bom.cdx.json", json(r.bom)));
    const sp = cdxToSpdx(r.bom, { now });
    item.files.push(put("sbom/bom.spdx.json", json(sp.doc)));
    item.files.push(put("sbom/sbom.md", `${renderSbomMarkdown({ ...r, outputPath: "sbom/bom.cdx.json", written: true })}\n`));
    item.summary = { components: r.components, direct: r.direct, transitive: r.transitive, vulnerabilities: r.vulnerabilities, minimum: r.minimum?.verdict ?? null, generator: r.generator, ...(r.osvError ? { osvError: r.osvError } : {}) };
  });
  if (include.includes("sbom-check")) await run("sbom-check", async (item) => {
    const bom = ctx.sbom?.bom;
    if (!bom) throw new Error("SBOM 항목이 실패해 점검할 문서가 없습니다");
    const minimum = checkMinimumElements(bom);
    const parentKind = buildTool === "maven" ? parentKindOf(projectDir, "maven") : "none";
    const recheck = await recheckSbom(bom, { parentKind, offline, osvQuery: opts.osvQuery });
    ctx.checkOsv = recheck.osv;
    const prevBom = prevData?.sbom ?? null;
    const diff = prevBom ? diffSboms(bom, prevBom, path.posix.join(path.basename(previousDir!), "sbom/bom.cdx.json"), recheck.osv) : undefined;
    // VEX 초안 — 이전 차수의 VEX 가 있으면 사람이 적은 판단을 보존
    const detected = new Map<string, Set<string>>();
    const add = (id: string, ref: string) => { if (!detected.has(id)) detected.set(id, new Set()); detected.get(id)!.add(ref); };
    for (const v of bom.vulnerabilities ?? []) for (const a of v.affects ?? []) add(v.id, a.ref);
    for (const it of recheck.osv.items) for (const id of it.ids) add(id, it.ref);
    const existingVex = previousDir ? readJson<VexDocument>(path.join(previousDir, "sbom", "vex.cdx.json")) : null;
    const vex = mergeVex(bom, detected, existingVex && existingVex.bomFormat === "CycloneDX" && Array.isArray(existingVex.vulnerabilities) ? existingVex : null, now);
    item.files.push(put("sbom/vex.cdx.json", json(vex.doc)));
    const cr: CheckSbomResult = {
      projectDir, sbomPath: "sbom/bom.cdx.json", absolutePath: path.join(outputDir, "sbom/bom.cdx.json"),
      document: { format: "cyclonedx", specVersion: bom.specVersion ?? CYCLONEDX_SPEC_VERSION, serialNumber: bom.serialNumber ?? null, version: bom.version ?? 1, timestamp: bom.metadata?.timestamp ?? null, components: (bom.components ?? []).length, tools: [], vulnerabilities: (bom.vulnerabilities ?? []).length },
      minimum, recheck, ...(diff ? { diff } : {}),
      vex: { path: "sbom/vex.cdx.json", dryRun: false, written: true, created: vex.created, added: vex.added, extended: vex.extended, preserved: vex.preserved, notDetected: vex.notDetected, states: vex.states, usedBomLink: vex.usedBomLink, vulnerabilities: vex.doc.vulnerabilities.length },
      notes: offline ? ["offline — OSV 재조회 안 함"] : [],
    };
    item.files.push(put("sbom-check/sbom-check.md", `${renderSbomCheckMarkdown(cr)}\n`), put("sbom-check/sbom-check.json", json(cr)));
    item.summary = { verdict: minimum.verdict, gaps: minimum.componentsWithGaps, newVulnerabilities: recheck.osv.newIds.length, vex: { added: vex.added, preserved: vex.preserved, vulnerabilities: vex.doc.vulnerabilities.length }, ...(diff ? { sbomDiff: { added: diff.added.length, removed: diff.removed.length, versionChanged: diff.versionChanged.length, newVulnerabilities: diff.newVulnerabilities.length } } : {}) };
  });
  if (include.includes("dependencies")) await run("dependencies", async (item) => {
    const r = await checkDependencies({ projectDir, offline, osvQuery: opts.osvQuery });
    ctx.dependencies = r;
    item.files.push(put("dependencies/dependencies.md", `${renderDependencyMarkdown(r)}\n`), put("dependencies/dependencies.json", json(r)));
    item.summary = { findings: r.findings.length, ...r.summary, vulnerabilities: (r.vulnerabilities ?? []).length };
  });
  if (include.includes("secure-coding")) await run("secure-coding", async (item) => {
    const r = await checkSecureCoding({ projectDir, maxFindings: 20_000 });
    ctx.secure = r;
    item.files.push(put("secure-coding/secure-coding.md", `${renderSecureCodingMarkdown(r, 100)}\n`), put("secure-coding/secure-coding.json", json(r)), put("secure-coding/egovframe-secure.sarif", json(toSarif(r))));
    item.summary = { ...r.summary, byOrigin: r.byOrigin };
  });
  if (include.includes("assessment")) await run("assessment", async (item) => {
    const o: AssessmentOptions = { projectDir, offline, osvQuery: opts.osvQuery, now };
    const r = await assessProject(o);
    ctx.assessment = r;
    item.files.push(put("assessment/assessment.md", `${renderAssessmentMarkdown(r)}\n`), put("assessment/assessment.json", json(r)));
    item.summary = { migration: r.grades.migration.grade, supplyChain: r.grades.supplyChain.grade, manual: r.migration.manual, auto: r.migration.auto };
  });
  if (include.includes("deploy")) await run("deploy", async (item) => {
    const r = await generateDeploy({ projectDir, dryRun: true });
    ctx.deploy = r;
    if (!r.supported) throw new Error(`배포 산출물 대상 아님: ${r.unsupported?.reason ?? "분석 실패"}`);
    for (const f of r.files) if (f.content !== undefined) item.files.push(put(`deploy/${f.path}`, f.content));
    item.files.push(put("deploy/deploy.md", `${renderDeployMarkdown(r)}\n`));
    item.summary = { files: r.files.length, runtime: r.profile?.runtime ?? r.workspace?.kind ?? null, ...(r.workspace ? { services: r.workspace.services.length } : {}) };
  });
  if (include.includes("build")) await run("build", async (item) => {
    const r = await runBuild({ projectDir, goal: "package", timeoutMs: opts.timeoutMs ?? 900_000, runner: opts.runner, now });
    ctx.build = r;
    const { logTail, ...rest } = r;
    item.files.push(put("build/build.json", json(rest)), put("build/build.log", `${logTail ?? ""}\n`));
    item.summary = { success: r.success ?? null, errors: (r.errors ?? []).length, command: r.command };
    if (r.success === false) throw new Error(`빌드 실패(종료 코드 ${r.exitCode ?? "?"}${r.timedOut ? ", 타임아웃" : ""}) — 오류 ${(r.errors ?? []).length}건`);
  });

  // 이전 차수 비교
  let diff: DeliveryDiff | undefined;
  if (previousDir && prevData) {
    diff = diffDeliveries(previousDir, prevData, { manifest: null, sbom: ctx.sbom?.bom ?? null, assessment: ctx.assessment ?? null, secure: ctx.secure ?? null, dependencies: ctx.dependencies ?? null }, ctx.checkOsv);
    put("diff.md", `${renderDeliveryDiffMarkdown(diff)}\n`);
    put("diff.json", json(diff));
  }

  // 파일 목록·지문·목차·manifest
  const createdAt = new Date(now()).toISOString();
  const files: DeliveryFile[] = staged.map((s) => { const buf = Buffer.isBuffer(s.content) ? s.content : Buffer.from(s.content, "utf8"); return { path: s.rel, sha256: sha256(buf), bytes: buf.length }; });
  const indexWithout = renderDeliveryIndex({ createdAt, projectName: path.basename(projectDir), items, files, rootHash: "(아래)", previous: previousDir, diff });
  const indexBuf = Buffer.from(`${indexWithout}\n`, "utf8");
  files.push({ path: DELIVERY_INDEX, sha256: sha256(indexBuf), bytes: indexBuf.length });
  const rootHash = rootHashOf(files);
  const manifest: DeliveryManifest = {
    schemaVersion: DELIVERY_SCHEMA_VERSION, tool: { name: "egovframe-scaffold-mcp", version: SERVER_VERSION }, createdAt,
    project: { name: path.basename(projectDir), buildTool, fingerprint: fp.sha256, fingerprintFiles: fp.files },
    items, files: [...files].sort((a, b) => a.path.localeCompare(b.path)), rootHash,
    ...(previousDir ? { previous: { dir: previousDir, createdAt: prevData?.manifest?.createdAt ?? null, rootHash: prevData?.manifest?.rootHash ?? null } } : {}),
  };
  const staging = `${outputDir}.partial-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const s of staged) { const abs = path.join(staging, s.rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, s.content); }
    fs.writeFileSync(path.join(staging, DELIVERY_INDEX), indexBuf);
    fs.writeFileSync(path.join(staging, DELIVERY_MANIFEST), json(manifest));
    fs.mkdirSync(path.dirname(outputDir), { recursive: true });
    if (fs.existsSync(outputDir)) fs.rmdirSync(outputDir);
    fs.renameSync(staging, outputDir);
  } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); throw e; }
  result.written = true;
  result.files = files.length + 1;
  result.bytes = files.reduce((s, f) => s + f.bytes, 0);
  result.rootHash = rootHash;
  result.manifestPath = path.join(outputDir, DELIVERY_MANIFEST);
  if (diff) result.diff = diff;
  if (opts.zip) {
    const zip = new AdmZip();
    zip.addLocalFolder(outputDir, path.basename(outputDir));
    const zp = `${outputDir}.zip`;
    if (fs.existsSync(zp)) throw new Error(`zip 이 이미 있습니다: ${zp}`);
    zip.writeZip(zp);
    result.zipPath = zp;
  }
  const failed = items.filter((i) => i.status === "failed");
  if (failed.length) notes.push(`${failed.length}개 항목 실패 — 목차(index.md)에 이유를 남겼습니다: ${failed.map((f) => `${f.id}(${f.error})`).join("; ")}`);
  if (offline) notes.push("offline — OSV 취약점은 조회하지 않았습니다(offline=false 또는 오프라인 번들로 포함).");
  notes.push(`rootHash ${rootHash} — 받은 쪽은 prepare_egovframe_delivery(verify=true, outputDir) 또는 CLI deliver --verify 로 같은 값이 나오는지 확인합니다.`);
  return result;
}

function renderDeliveryIndex(o: { createdAt: string; projectName: string; items: DeliveryItem[]; files: DeliveryFile[]; rootHash: string; previous?: string; diff?: DeliveryDiff }): string {
  const L: string[] = [`# 납품 패키지 — ${o.projectName}`, ``, `- 만든 시각: ${o.createdAt}`, `- 도구: egovframe-scaffold-mcp ${SERVER_VERSION}`, `- 파일 ${o.files.length}개 · 전체 지문(rootHash)은 \`${DELIVERY_MANIFEST}\` 의 \`rootHash\``, ...(o.previous ? [`- 이전 차수: \`${o.previous}\` → [diff.md](diff.md)${o.diff ? ` (${o.diff.changed ? "달라진 점 있음" : "달라진 점 없음"})` : ""}`] : []), ``, `## 항목`, ``, `| 항목 | 상태 | 파일 | 요약 |`, `|---|---|---|---|`];
  for (const it of o.items) {
    const status = it.status === "ok" ? "✅ 생성" : it.status === "failed" ? `❌ 실패 — ${it.error}` : "— 건너뜀";
    const sum = Object.entries(it.summary).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => `${k} ${v}`).join(" · ");
    L.push(`| ${it.label} (\`${it.id}\`) | ${status} | ${it.files.map((f) => `[${path.posix.basename(f)}](${f})`).join(" · ") || "—"} | ${sum || "—"} |`);
  }
  L.push(``, `## 검증`, ``, `받은 쪽에서 \`npx -y egovframe-scaffold-mcp deliver --verify --output-dir <이 디렉터리>\` 를 실행하면 \`${DELIVERY_MANIFEST}\` 의 sha256 과 rootHash 를 다시 계산해 변조·누락을 확인합니다.`, ``, `## 파일`, ``, `| 경로 | 크기 | sha256 |`, `|---|---|---|`);
  for (const f of [...o.files].sort((a, b) => a.path.localeCompare(b.path))) L.push(`| ${f.path} | ${f.bytes} | \`${f.sha256.slice(0, 16)}…\` |`);
  return L.join("\n");
}

export function renderDeliveryMarkdown(r: PrepareDeliveryResult): string {
  const L: string[] = [`# 납품 패키지${r.dryRun ? " (dryRun — 계획)" : ""}`, ``, `- 프로젝트: \`${r.projectDir}\``, `- 출력: \`${r.outputDir}\`${r.zipPath ? ` + \`${r.zipPath}\`` : ""}`, `- 항목 ${r.include.length}개 · ${r.written ? `파일 ${r.files}개 · ${(r.bytes / 1024).toFixed(0)}KB · rootHash \`${r.rootHash}\`` : "아직 만들지 않음"}`, ``, `| 항목 | 상태 | 소요 | 요약 |`, `|---|---|---|---|`];
  for (const it of r.items) {
    const sum = Object.entries(it.summary).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => `${k} ${v}`).join(" · ");
    L.push(`| ${it.label} | ${it.status === "ok" ? "생성" : it.status === "failed" ? `실패 — ${it.error}` : r.dryRun ? "예정" : "건너뜀"} | ${it.durationMs ? `${(it.durationMs / 1000).toFixed(1)}초` : "—"} | ${sum || "—"} |`);
  }
  if (r.diff) L.push(``, `## 이전 차수와 비교`, ``, `- ${r.diff.changed ? "달라진 점 있음" : "달라진 점 없음"} — 자세한 내용은 패키지의 diff.md`, ...(r.diff.grades ? [`- 등급: 전환 ${r.diff.grades.migration.from} → ${r.diff.grades.migration.to}, 공급망 ${r.diff.grades.supplyChain.from} → ${r.diff.grades.supplyChain.to}`] : []), ...(r.diff.sbom ? [`- SBOM: 추가 ${r.diff.sbom.added.length} · 제거 ${r.diff.sbom.removed.length} · 버전 변경 ${r.diff.sbom.versionChanged.length} · 새 취약점 ${r.diff.sbom.newVulnerabilities.length}`] : []), ...(r.diff.secureCoding ? [`- 보안약점: ${r.diff.secureCoding.from} → ${r.diff.secureCoding.to} (새 ${r.diff.secureCoding.added} · 해소 ${r.diff.secureCoding.resolved})`] : []));
  if (r.notes.length) L.push(``, `## 참고`, ``, ...r.notes.map((n) => `- ${n}`));
  return L.join("\n");
}

export function renderVerifyMarkdown(v: VerifyDeliveryResult): string {
  const L: string[] = [`# 납품 패키지 검증 — ${v.ok ? "✅ 일치" : "❌ 불일치"}`, ``, `- 디렉터리: \`${v.dir}\``];
  if (v.manifest) L.push(`- manifest: ${v.manifest.createdAt} · ${v.manifest.tool} · 항목 ${v.manifest.items} · 파일 ${v.manifest.files}`, `- rootHash: \`${v.manifest.rootHash}\` — ${v.rootHashMatches === null ? "계산 불가(누락 있음)" : v.rootHashMatches ? "일치" : "불일치"}`);
  L.push(`- 지문 일치 ${v.verified} · 불일치 ${v.mismatched.length} · 누락 ${v.missing.length} · manifest 밖 파일 ${v.extra.length}`);
  for (const m of v.mismatched) L.push(`  - 불일치: ${m.path} (기대 ${m.expected.slice(0, 12)}… / 실제 ${m.actual.slice(0, 12)}…)`);
  for (const m of v.missing) L.push(`  - 누락: ${m}`);
  if (v.notes.length) L.push(``, ...v.notes.map((n) => `- ${n}`));
  return L.join("\n");
}
