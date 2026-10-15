// 5.x 안의 갱신 (migrate_egovframe_project target="5.0.x", v0.46).
//   공식 Initializr 템플릿은 parent 5.0.0·5.0.1 로 만들어져 새 프로젝트가 만들어지는 순간부터 최신(5.0.2) 미만이다.
//   3.x/4.x → 5.x 전환(migrate.ts)과 달리 좌표·패키지는 그대로이고, 바꿀 것은
//   (1) parent 버전·RTE 버전 속성·RTE 의존성의 리터럴 버전(auto), (2) parent 가 관리하는 속성을 예전 기본값 그대로 덮어쓴 것(auto),
//   (3) 그 사이 바뀐 RTE API·동작을 프로젝트가 참조하는 곳(manual), (4) 공통컴포넌트 최신 유지 안내(manual) 다.
//   규칙은 catalog/update-rules.json(scripts/generate-update-rules.mjs 가 egovframe-runtime 태그와 공식 parent pom 으로 생성)에서 읽는다.
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { diagnoseProject } from "./diagnose.js";
import { withFileTransaction } from "./file-transaction.js";
import { detectBuildToolAt, runBuild, type Runner } from "./build-runner.js";
import { readManifest } from "./manifest.js";
import { loadCatalog } from "./catalog.js";
import {
  applyTextEdits, lineAt, linkBuildError, loadMigrationRules, parsePomDeps, parsePomProperties, versionBelow, walkProjectFiles,
  type ApplyFilePlan, type MigrateResult, type MigrationItem, type SourceEra, type TextEdit, type VerifyLink, type VerifyWorkItem,
} from "./migrate.js";

// ── 규칙 ──────────────────────────────────────────────
export interface UpdateChange { id: string; since: string; kind: "api" | "behavior"; classes: string[]; summary: string; reason: string; action: "manual"; evidence: { fromTag: string; toTag: string } }
export interface UpdateParent { kind: "web" | "boot"; groupId: string; artifactId: string; versions: Record<string, { bootParent?: string; properties: Record<string, string> }> }
export interface UpdateRules {
  schemaVersion: number;
  surveyedAt: string;
  source: { repository: string; mavenRepository: string; tags: { tag: string; version: string; commit: string }[] };
  versions: string[];
  latest: string;
  rteVersionProperties: string[];
  parents: UpdateParent[];
  changes: UpdateChange[];
  components: { repository: string; note: string };
}
const RULES_URL = new URL("../catalog/update-rules.json", import.meta.url);
let cached: UpdateRules | null = null;
export function loadUpdateRules(): UpdateRules {
  if (!cached) cached = JSON.parse(fs.readFileSync(RULES_URL, "utf8")) as UpdateRules;
  return cached;
}
/** migrate_egovframe_project 의 target 값이 5.x 안의 갱신인지 */
export const isUpdateTarget = (target: string | undefined): boolean => !!target && /^5\.0\.\d+$/.test(target);

// ── 결과 타입 ─────────────────────────────────────────
export type UpdateKind = "parent-version" | "rte-version" | "parent-property" | "rte-change" | "component-update";
export interface UpdateInfo {
  /** 프로젝트의 실효 RTE 버전 — (버전 속성 또는 parent 관리 버전)과 RTE 의존성 리터럴 버전 중 가장 낮은 것 */
  from: string | null;
  to: string;
  parent: { kind: "web" | "boot"; groupId: string; artifactId: string; version: string; to: string } | null;
  /** 이 갱신 구간(from 초과 ~ to 이하)에서 바뀐 API·동작 중 프로젝트가 참조하는 것 */
  changes: { id: string; since: string; kind: "api" | "behavior"; summary: string; files: number }[];
  /** 구간에 있지만 프로젝트가 참조하지 않는 변경 수 */
  unreferencedChanges: number;
  components: { detected: number; manifestTag: string | null; catalogTag: string; tool: "upgrade_egovframe_project" | "reassemble_egovframe_components" | null } | null;
}
export interface UpdateResult extends Omit<MigrateResult, "target"> { target: string; update: UpdateInfo }
export interface UpdateOptions { projectDir: string; target?: string; maxFiles?: number; rules?: UpdateRules }

// ── 순수 함수(테스트 대상) ────────────────────────────
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isRteGroup = (g: string) => g === "org.egovframe.rte" || g.startsWith("org.egovframe.rte.");

export interface PomUpdatePlan {
  parent: UpdateInfo["parent"];
  /** 실효 RTE 버전 */
  effective: string | null;
  items: MigrationItem[];
}
/**
 * pom 하나의 갱신 항목(auto)을 계산한다 — create_egovframe_project(alignParent) 도 이 함수를 쓴다.
 * 리터럴 버전만 바꾸고 속성 참조(${…})는 속성 쪽 항목이 맡는다.
 */
export function planPomUpdate(rel: string, text: string, target: string, rules: UpdateRules = loadUpdateRules()): PomUpdatePlan {
  const items: MigrationItem[] = [];
  const props = parsePomProperties(text);
  let parent: UpdateInfo["parent"] = null;
  let parentVersion: string | null = null;
  const pm = text.match(/<parent>([\s\S]*?)<\/parent>/);
  if (pm) {
    const body = pm[1];
    const base = (pm.index ?? 0) + "<parent>".length;
    const g = body.match(/<groupId>\s*([^<\s]+)/)?.[1];
    const a = body.match(/<artifactId>\s*([^<\s]+)/)?.[1];
    const vm = body.match(/<version>(\s*)([^<\s]+)(\s*)<\/version>/);
    const p = rules.parents.find((x) => x.groupId === g && x.artifactId === a);
    if (p && vm) {
      parentVersion = vm[2];
      parent = { kind: p.kind, groupId: p.groupId, artifactId: p.artifactId, version: vm[2], to: target };
      if (versionBelow(vm[2], target) === true) {
        const start = base + (vm.index ?? 0) + "<version>".length + vm[1].length;
        items.push({ file: rel, line: lineAt(text, start), kind: "parent-version", from: `${g}:${a}:${vm[2]}`, to: `${g}:${a}:${target}`, action: "auto", reason: `공식 parent 최신 ${rules.latest} — parent 가 RTE·Spring·Jakarta 의존성 버전을 함께 관리한다`, edits: [{ start, end: start + vm[2].length, replacement: target }] });
      }
      // parent 가 관리하는 속성을 예전 parent 의 기본값 그대로 덮어쓴 것 → 목표 parent 값으로
      const oldProps = p.versions[vm[2]]?.properties;
      const newProps = p.versions[target]?.properties;
      if (oldProps && newProps) {
        for (const [key, value] of props) {
          if (rules.rteVersionProperties.includes(key)) continue;
          if (!(key in newProps) || oldProps[key] !== value || newProps[key] === value) continue;
          const m = text.match(new RegExp(`<${escapeRe(key)}>(\\s*)${escapeRe(value)}(\\s*)</${escapeRe(key)}>`));
          if (!m) continue;
          const start = (m.index ?? 0) + key.length + 2 + m[1].length;
          items.push({ file: rel, line: lineAt(text, start), kind: "parent-property", from: `<${key}>${value}</${key}>`, to: `<${key}>${newProps[key]}</${key}>`, action: "auto", reason: `parent ${vm[2]} 의 기본값을 그대로 덮어쓴 속성 — parent ${target} 값으로 맞춤(의도한 고정이면 속성을 지우고 parent 관리를 쓰는 편이 낫다)`, edits: [{ start, end: start + value.length, replacement: newProps[key] }] });
        }
      }
    }
  }
  // RTE 버전 속성
  let propVersion: string | null = null;
  for (const key of rules.rteVersionProperties) {
    const m = text.match(new RegExp(`<${escapeRe(key)}>(\\s*)([^<\\s]+)(\\s*)</${escapeRe(key)}>`));
    if (!m || !/^5\./.test(m[2])) continue;
    propVersion ??= m[2];
    if (versionBelow(m[2], target) !== true) continue;
    const start = (m.index ?? 0) + key.length + 2 + m[1].length;
    items.push({ file: rel, line: lineAt(text, start), kind: "rte-version", from: `<${key}>${m[2]}</${key}>`, to: `<${key}>${target}</${key}>`, action: "auto", reason: parent ? `parent 가 정한 RTE 버전을 프로젝트가 덮어쓰고 있다 — ${target} 로 맞춤` : `RTE ${target} 기준`, edits: [{ start, end: start + m[2].length, replacement: target }] });
  }
  // RTE 의존성의 리터럴 버전
  const literal: string[] = [];
  for (const d of parsePomDeps(text)) {
    if (!isRteGroup(d.groupId) || !d.version || !d.vSpan || /\$\{/.test(d.version) || !/^5\./.test(d.version)) continue;
    literal.push(d.version);
    if (versionBelow(d.version, target) !== true) continue;
    items.push({ file: rel, line: d.line, kind: "rte-version", from: `${d.groupId}:${d.artifactId}:${d.version}`, to: `${d.groupId}:${d.artifactId}:${target}`, action: "auto", reason: `RTE ${target} 기준`, edits: [{ start: d.vSpan.start, end: d.vSpan.end, replacement: target }] });
  }
  // 실효 버전 = (버전 속성 또는 parent 가 관리하는 버전)과 리터럴 버전 중 가장 낮은 것
  const managed = propVersion ?? (parentVersion && /^5\./.test(parentVersion) ? parentVersion : null);
  const effective = [...(managed ? [managed] : []), ...literal].sort((a, b) => (versionBelow(a, b) ? -1 : versionBelow(b, a) ? 1 : 0))[0] ?? null;
  return { parent, effective, items };
}

/** Gradle 빌드 파일의 org.egovframe.rte 좌표 리터럴 버전 */
export function planGradleUpdate(rel: string, text: string, target: string): { effective: string | null; items: MigrationItem[] } {
  const items: MigrationItem[] = [];
  const found: string[] = [];
  for (const m of text.matchAll(/["'](org\.egovframe\.rte[\w.]*):([\w.\-]+):(5\.[^"':\s]+)["']/g)) {
    found.push(m[3]);
    if (versionBelow(m[3], target) !== true) continue;
    const start = (m.index ?? 0) + 1 + m[1].length + 1 + m[2].length + 1;
    items.push({ file: rel, line: lineAt(text, m.index ?? 0), kind: "rte-version", from: `${m[1]}:${m[2]}:${m[3]}`, to: `${m[1]}:${m[2]}:${target}`, action: "auto", reason: `RTE ${target} 기준`, edits: [{ start, end: start + m[3].length, replacement: target }] });
  }
  const effective = found.sort((a, b) => (versionBelow(a, b) ? -1 : versionBelow(b, a) ? 1 : 0))[0] ?? null;
  return { effective, items };
}

/** 소스 한 파일에서 변경 클래스 참조를 찾는다(FQN, 또는 import 한 단순 이름·와일드카드 import + 단순 이름). 첫 줄만 돌려준다. */
export function findClassReference(text: string, fqn: string): number | null {
  const fq = text.indexOf(fqn);
  if (fq >= 0) {
    const next = text.charAt(fq + fqn.length);
    if (!/[\w$]/.test(next)) return lineAt(text, fq);
  }
  const dot = fqn.lastIndexOf(".");
  const pkg = fqn.slice(0, dot), simple = fqn.slice(dot + 1);
  if (new RegExp(`^\\s*import\\s+${escapeRe(pkg)}\\.\\*\\s*;`, "m").test(text)) {
    const m = new RegExp(`\\b${escapeRe(simple)}\\b`).exec(text.replace(/^\s*import\s+[^;]+;/gm, (s) => " ".repeat(s.length)));
    if (m) return lineAt(text, m.index);
  }
  return null;
}

// ── 진단 ──────────────────────────────────────────────
const SOURCE_EXT = new Set([".java", ".xml", ".jsp", ".jspf", ".tag", ".kt", ".groovy"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** 이미 5.x 인 프로젝트를 읽기 전용으로 스캔해 target(기본 최신 5.0.x)까지의 갱신 항목을 보고한다. */
export function updateProject(opts: UpdateOptions): UpdateResult {
  const rules = opts.rules ?? loadUpdateRules();
  const target = opts.target ?? rules.latest;
  if (!rules.versions.includes(target)) throw new Error(`지원하지 않는 target: ${target} (5.x 갱신은 ${rules.versions.join("·")} 중 하나, 3.x/4.x 전환은 target="5.x")`);
  const dir = path.resolve(opts.projectDir);
  const diag = diagnoseProject({ projectDir: dir });
  const maxFiles = opts.maxFiles ?? 20_000;
  const files = walkProjectFiles(dir, maxFiles);
  const items: MigrationItem[] = [];
  const notes: string[] = [];
  let parent: UpdateInfo["parent"] = null;
  const effectives: string[] = [];
  let legacy = false;
  const sources: { rel: string; text: string }[] = [];
  let scanned = 0;
  for (const abs of files) {
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { continue; }
    if (st.size > MAX_FILE_BYTES) continue;
    let text: string;
    try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
    if (text.includes("\u0000")) continue;
    scanned++;
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    const base = path.basename(abs);
    if (base === "pom.xml") {
      if (/<groupId>\s*egovframework\.rte\s*<\/groupId>/.test(text)) legacy = true;
      const plan = planPomUpdate(rel, text, target, rules);
      if (rel === "pom.xml" && plan.parent) parent = plan.parent;
      if (plan.effective) effectives.push(plan.effective);
      items.push(...plan.items);
      continue;
    }
    if (base === "build.gradle" || base === "build.gradle.kts") {
      if (/egovframework\.rte/.test(text)) legacy = true;
      const plan = planGradleUpdate(rel, text, target);
      if (plan.effective) effectives.push(plan.effective);
      items.push(...plan.items);
      continue;
    }
    if (SOURCE_EXT.has(path.extname(abs)) && text.includes("org.egovframe.rte")) sources.push({ rel, text });
  }
  const from = effectives.sort((a, b) => (versionBelow(a, b) ? -1 : versionBelow(b, a) ? 1 : 0))[0] ?? null;

  // 3.x/4.x 프로젝트면 갱신이 아니라 전환
  const sourceEra: SourceEra = from ? "5.x" : "unknown";
  if (legacy || (diag.egovVersion && /^[34]\./.test(diag.egovVersion))) {
    notes.push(`5.x 이전 좌표의 프로젝트입니다 — 먼저 target="5.x" 로 전환(migrate_egovframe_project)한 뒤 갱신하세요.`);
    return result([], { from: diag.egovVersion, to: target, parent, changes: [], unreferencedChanges: 0, components: null }, diag.egovVersion && /^4\./.test(diag.egovVersion) ? "4.x" : "3.x");
  }
  if (!from) notes.push("빌드 파일에서 5.x RTE 버전(parent·버전 속성·의존성)을 찾지 못했습니다 — 변경 API 참조는 구간 전체(5.0.0 이후)로 봅니다.");

  // 바뀐 API·동작 참조(manual)
  // 구간: from 초과 ~ target 이하(from 미검출이면 target 이하 전부)
  const inRange = rules.changes.filter((c) => versionBelow(target, c.since) !== true && (from ? versionBelow(from, c.since) === true : true));
  const changes: UpdateInfo["changes"] = [];
  for (const c of inRange) {
    const hitFiles = new Set<string>();
    for (const s of sources) {
      for (const cls of c.classes) {
        const line = findClassReference(s.text, cls);
        if (line === null) continue;
        hitFiles.add(s.rel);
        items.push({ file: s.rel, line, kind: "rte-change", from: cls, to: null, action: "manual", reason: `[${c.since} ${c.kind === "api" ? "API 변경" : "동작 변경"}] ${c.summary} — ${c.reason}` });
        break;
      }
    }
    if (hitFiles.size) changes.push({ id: c.id, since: c.since, kind: c.kind, summary: c.summary, files: hitFiles.size });
  }

  // 공통컴포넌트
  let components: UpdateInfo["components"] = null;
  if (diag.detectedComponents.length) {
    const catalogTag = loadCatalog().source.tag ?? "";
    const manifest = readManifest(dir);
    const manifestTag = (manifest?.source as { tag?: string } | undefined)?.tag ?? null;
    const tool = manifest ? (manifestTag === catalogTag ? null : "upgrade_egovframe_project") : "reassemble_egovframe_components";
    components = { detected: diag.detectedComponents.length, manifestTag, catalogTag, tool };
    if (tool) {
      items.push({
        file: manifest ? ".egovframe-components.json" : diag.detectedComponents[0].matchedPrefix, line: 1, kind: "component-update",
        from: `공통컴포넌트 ${diag.detectedComponents.length}종${manifestTag ? ` (${manifestTag})` : " (매니페스트 없음)"}`,
        to: tool === "upgrade_egovframe_project" ? `upgrade_egovframe_project(dryRun=true) 로 ${catalogTag} 와 비교` : `reassemble_egovframe_components(dryRun=true) 로 ${catalogTag} 재조립 계획`,
        action: "manual",
        reason: `${rules.components.note} 사용자 수정 파일은 force 없이 덮어쓰지 않고(upgrade), 재조립은 수정분을 패치로 남긴다.`,
      });
    }
  }
  return result(items, { from, to: target, parent, changes, unreferencedChanges: inRange.length - changes.length, components }, sourceEra);

  function result(list: MigrationItem[], update: UpdateInfo, era: SourceEra): UpdateResult {
    list.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
    const byKind: Record<string, number> = {};
    for (const i of list) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
    return {
      projectDir: dir, target,
      rules: { toTag: `v${target}-Final`, surveyedAt: rules.surveyedAt, runtimeVersion: target },
      buildSystem: diag.buildSystem, rteVersion: from ?? diag.egovVersion, sourceEra: era,
      filesScanned: scanned, items: list,
      summary: { auto: list.filter((i) => i.action === "auto").length, manual: list.filter((i) => i.action === "manual").length, files: new Set(list.map((i) => i.file)).size, byKind },
      notes, update,
    };
  }
}

// ── 적용 ──────────────────────────────────────────────
export interface UpdateApplyResult extends UpdateResult {
  mode: "apply"; dryRun: boolean;
  applied: { items: number; edits: number; files: number };
  skippedManual: number;
  files: ApplyFilePlan[];
  conflicts: string[];
  backupDir?: string; planPath?: string;
  remaining?: UpdateResult["summary"];
}
export interface UpdateApplyOptions extends UpdateOptions { dryRun?: boolean; faultInjection?: "after-files" }

function previewLines(before: string, after: string): ApplyFilePlan["preview"] {
  const a = before.split("\n"), b = after.split("\n");
  const out: ApplyFilePlan["preview"] = [];
  for (let i = 0; i < Math.min(a.length, b.length) && out.length < 40; i++) if (a[i] !== b[i]) out.push({ line: i + 1, before: a[i].trimEnd(), after: b[i].trimEnd() });
  return out;
}

/** auto 항목을 적용한다. dryRun(기본 true)이면 계획만, 적용 시 transaction 으로 백업·계획 파일과 함께 기록한다. */
export async function applyUpdate(opts: UpdateApplyOptions): Promise<UpdateApplyResult> {
  const dryRun = opts.dryRun ?? true;
  const r = updateProject(opts);
  const dir = r.projectDir;
  const byFile = new Map<string, MigrationItem[]>();
  for (const i of r.items) if (i.action === "auto" && i.edits?.length) (byFile.get(i.file) ?? byFile.set(i.file, []).get(i.file)!).push(i);
  const files: ApplyFilePlan[] = [];
  const conflicts: string[] = [];
  const newTexts = new Map<string, { before: string; after: string }>();
  let items = 0, edits = 0;
  for (const [file, list] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
    const before = fs.readFileSync(path.join(dir, file), "utf8");
    const all: TextEdit[] = list.flatMap((i) => i.edits ?? []);
    const { text, applied, skipped } = applyTextEdits(before, all);
    for (const sk of skipped) { const o = list.find((i) => i.edits?.includes(sk)); conflicts.push(`${file}:${o?.line ?? "?"} ${o?.from ?? ""}`); }
    if (text === before) continue;
    const n = list.filter((i) => !(i.edits ?? []).some((e) => skipped.includes(e))).length;
    items += n; edits += applied;
    newTexts.set(file, { before, after: text });
    files.push({ file, items: n, edits: applied, preview: previewLines(before, text) });
  }
  const base: UpdateApplyResult = { ...r, mode: "apply", dryRun, applied: { items, edits, files: files.length }, skippedManual: r.summary.manual, files, conflicts };
  if (dryRun || files.length === 0) return base;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRel = path.join("migration-backup", `${ts}-update-${randomUUID()}`);
  const planRel = path.join(backupRel, "update-plan.json");
  await withFileTransaction(dir, `5.x 갱신 적용(${r.update.from ?? "?"} → ${r.target})`, (tx) => {
    for (const [file, { before }] of newTexts) {
      const cur = tx.readFile(file);
      if (cur === null || cur.toString("utf8") !== before) throw new Error(`진단 이후 파일이 변경되어 적용을 중단합니다: ${file}`);
    }
    for (const [file, { before, after }] of newTexts) {
      tx.writeFile(path.join(backupRel, file), before, { mustNotExist: true });
      tx.writeFile(file, after);
    }
    tx.writeFile(planRel, `${JSON.stringify({ createdAt: new Date().toISOString(), tool: "migrate_egovframe_project", mode: "update", target: r.target, from: r.update.from, applied: base.applied, files: files.map(({ preview: _p, ...f }) => f), items: r.items.map(({ edits: _e, ...rest }) => rest) }, null, 2)}\n`, { mustNotExist: true });
    if (opts.faultInjection === "after-files") throw new Error("update fault injection: after-files");
  });
  const after = updateProject(opts);
  return { ...base, backupDir: path.join(dir, backupRel), planPath: path.join(dir, planRel), remaining: after.summary };
}

// ── 검증 ──────────────────────────────────────────────
export interface UpdateVerifyResult extends UpdateResult {
  mode: "verify";
  build: { ran: boolean; success: boolean | null; command?: string; durationMs?: number; errors: number; timedOut?: boolean; reason?: string };
  links: VerifyLink[]; worklist: VerifyWorkItem[]; unlinked: VerifyLink["error"][];
}
export interface UpdateVerifyOptions extends UpdateOptions { timeoutMs?: number; runner?: Runner; platform?: NodeJS.Platform | string }

/** 진단 → compile → 오류를 manual 항목(바뀐 API 참조)과 연결. 파일을 쓰지 않는다. */
export async function verifyUpdate(opts: UpdateVerifyOptions): Promise<UpdateVerifyResult> {
  const r = updateProject(opts);
  const dir = r.projectDir;
  if (!detectBuildToolAt(dir)) return { ...r, mode: "verify", build: { ran: false, success: null, errors: 0, reason: "빌드 파일(pom.xml·build.gradle)이 없어 컴파일 검증을 건너뜀" }, links: [], worklist: [], unlinked: [] };
  const b = await runBuild({ projectDir: dir, goal: "compile", timeoutMs: opts.timeoutMs ?? 300_000, runner: opts.runner, platform: opts.platform });
  const errors = b.errors ?? [];
  const migRules = loadMigrationRules();
  const links = errors.map((e) => linkBuildError(e, r.items, migRules, dir));
  const counts = new Map<number, number>();
  for (const l of links) if (l.itemIndex !== null) counts.set(l.itemIndex, (counts.get(l.itemIndex) ?? 0) + 1);
  const worklist: VerifyWorkItem[] = [...counts].map(([index, n]) => ({ index, item: r.items[index], errors: n })).sort((a, b) => b.errors - a.errors);
  r.items.forEach((it, index) => { if (it.action === "manual" && !counts.has(index)) worklist.push({ index, item: it, errors: 0 }); });
  return { ...r, mode: "verify", build: { ran: true, success: b.success ?? null, command: b.command, durationMs: b.durationMs, errors: errors.length, timedOut: b.timedOut }, links, worklist, unlinked: links.filter((l) => l.how === "unlinked").map((l) => l.error) };
}

// ── 렌더링 ────────────────────────────────────────────
const KIND_LABEL: Record<string, string> = {
  "parent-version": "parent 버전", "rte-version": "RTE 버전", "parent-property": "parent 관리 속성", "rte-change": "바뀐 RTE API·동작", "component-update": "공통컴포넌트 최신 유지",
};
export const updateKindLabel = (k: string): string => KIND_LABEL[k] ?? k;

export function renderUpdateMarkdown(r: UpdateResult | UpdateApplyResult | UpdateVerifyResult): string {
  const mode = (r as { mode?: "apply" | "verify" }).mode;
  const L: string[] = [];
  const u = r.update;
  const title = mode === "apply" ? ((r as UpdateApplyResult).dryRun ? "적용 계획(dryRun)" : "적용 결과") : mode === "verify" ? "검증" : "진단";
  L.push(`# 표준프레임워크 5.x 최신 유지 ${title}`, ``);
  L.push(`- 경로: ${r.projectDir}`);
  L.push(`- RTE ${u.from ?? "미검출"} → ${u.to}${u.parent ? ` · parent ${u.parent.artifactId} ${u.parent.version}${u.parent.version === u.to ? "(최신)" : ` → ${u.to}`}` : " · 5.x parent 없음"} (규칙 조사 ${r.rules.surveyedAt})`);
  L.push(`- 항목 ${r.items.length}건 (자동 ${r.summary.auto} · 수동 ${r.summary.manual})${u.unreferencedChanges ? ` · 이 구간의 다른 변경 ${u.unreferencedChanges}건은 프로젝트가 참조하지 않음` : ""}`);
  if (u.components) L.push(`- 공통컴포넌트 ${u.components.detected}종 · ${u.components.manifestTag ? `매니페스트 ${u.components.manifestTag}` : "매니페스트 없음"} · 카탈로그 ${u.components.catalogTag}${u.components.tool ? ` → ${u.components.tool}` : " (최신)"}`);
  for (const n of r.notes) L.push(`- ${n}`);
  if (mode === "apply") {
    const a = r as UpdateApplyResult;
    L.push(`- ${a.dryRun ? "적용 예정" : "적용"} ${a.applied.items}항목 · 편집 ${a.applied.edits}곳 · 파일 ${a.applied.files}개`);
    if (a.backupDir) L.push(`- 백업: ${a.backupDir} (원본 + update-plan.json)`);
    if (a.remaining) L.push(`- 적용 후 재진단: 자동 ${a.remaining.auto} · 수동 ${a.remaining.manual}`);
    for (const f of a.files) { L.push(``, `### ${f.file} — ${f.items}항목`, ``); for (const p of f.preview.slice(0, 10)) L.push(`- L${p.line}: \`${p.before.trim()}\` → \`${p.after.trim()}\``); }
  }
  if (mode === "verify") {
    const v = r as UpdateVerifyResult;
    L.push(v.build.ran ? `- 컴파일: ${v.build.success ? "✅ 통과" : `❌ 오류 ${v.build.errors}건`} · \`${v.build.command}\` · ${v.build.durationMs ?? 0}ms` : `- 컴파일: 건너뜀 — ${v.build.reason}`);
    for (const w of v.worklist.filter((x) => x.errors > 0)) L.push(`- **${w.errors}건** ${w.item.file}:L${w.item.line} \`${w.item.from}\``);
    for (const e of v.unlinked.slice(0, 20)) L.push(`- (분류 불가) ${e.file}:L${e.line} ${e.message}`);
  }
  const auto = r.items.filter((i) => i.action === "auto");
  const manual = r.items.filter((i) => i.action === "manual");
  if (auto.length && mode !== "apply") {
    L.push(``, `## 자동 갱신 (${auto.length})`, ``);
    for (const i of auto) L.push(`- ${i.file}:L${i.line} [${updateKindLabel(i.kind)}] \`${i.from}\` → \`${i.to}\``);
  }
  if (manual.length) {
    L.push(``, `## 확인할 항목 (${manual.length})`, ``);
    for (const i of manual.slice(0, 60)) L.push(`- ${i.file}:L${i.line} [${updateKindLabel(i.kind)}] \`${i.from}\`${i.to ? ` → ${i.to}` : ""}`, `  - ${i.reason}`);
    if (manual.length > 60) L.push(`- … 외 ${manual.length - 60}건`);
  }
  if (r.items.length === 0) L.push(``, `갱신 항목 없음 — RTE·parent 가 ${u.to} 기준입니다.`);
  L.push(``, `---`, mode === "apply" && !(r as UpdateApplyResult).dryRun
    ? `다음 단계: verify=true 로 compile 을 확인하고, 확인할 항목(바뀐 API·동작)을 검토하세요.`
    : mode === "apply" ? `적용하려면 dryRun=false 로 다시 호출하세요. 원본은 migration-backup/ 에 보관되고 실패하면 작업 전 상태로 되돌립니다.`
    : `apply=true 로 자동 항목을 적용하고(dryRun 기본), verify=true 로 compile 을 확인합니다. 이 진단은 파일을 수정하지 않았습니다.`);
  return L.join("\n");
}
