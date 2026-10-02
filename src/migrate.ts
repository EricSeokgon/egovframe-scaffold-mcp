// 3.x/4.x → 5.x 전환 진단 (migrate_egovframe_project, v0.29 — 1단계, 읽기 전용).
// 규칙은 catalog/migration-rules.json(scripts/generate-migration-rules.mjs 가 egovframe-runtime 태그 비교로 생성)에서 읽는다.
// 이 모듈은 파일을 쓰지 않는다. 항목마다 {file, line, kind, from, to, action, reason} 을 돌려주고,
// action="auto" 는 2단계(v0.30) 에서 기계적으로 치환할 수 있는 것, "manual" 은 사람이 코드를 고쳐야 하는 것이다.
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { diagnoseProject } from "./diagnose.js";
import { withFileTransaction } from "./file-transaction.js";
import { detectBuildToolAt, runBuild, type BuildError, type Runner } from "./build-runner.js";

// ── 규칙 ──────────────────────────────────────────────
export interface MigrationCoordinate { module: string; layer: string; from: { groupId: string; artifactId: string; era: string }[]; to: { groupId: string; artifactId: string } }
export interface MigrationRules {
  schemaVersion: number;
  surveyedAt: string;
  source: { repository: string; fromTag: string; midTag: string; toTag: string; fromCommit: string; toCommit: string; components?: { repository: string; fromTag: string; fromCommit: string; toTag: string; toCommit: string } };
  target: {
    runtimeVersion: string; java: number; spring: string; repositoryUrl: string; legacyRepositoryUrls: string[];
    parents: { kind: string; groupId: string; artifactId: string; version: string }[];
    versionProperties: { legacy: string[]; note: string };
    webXml: { legacyNamespaces: string[]; namespace: string; version: string; schemaLocation: string };
  };
  coordinates: MigrationCoordinate[];
  removedModules: { module: string; fromArtifactId: string; reason: string }[];
  newModules: { module: string; layer: string; to: { groupId: string; artifactId: string } }[];
  packages: {
    prefix: { from: string; to: string };
    renames: { from: string; to: string; classes: number }[];
    moves: { from: string; to: string; legacyFrom: string }[];
    removed: { class: string; legacyClass: string; replacement: string | null; reason: string; presentIn4x: boolean }[];
    /** 공통컴포넌트(egovframework.com.*) 3.x→5.x 대응표 (schemaVersion 2) */
    components?: { prefix: string; removed: { class: string; replacement: string | null; reason: string; candidates?: string[] }[]; moves: { from: string; to: string }[]; evidence: Record<string, number> };
  };
  jakarta: {
    packages: { from: string; to: string; exclude?: string[] }[];
    artifacts: { from: { groupId: string; artifactId: string }; to: { groupId: string; artifactId: string }; toVersion: string; scope?: string; also?: { groupId: string; artifactId: string; version: string }; note?: string }[];
  };
  libraries: { match: { groupId: string; artifactId: string; versionBelow?: string }; replacement: string | null; reason: string }[];
  /** 공개 저장소에 기준이 없는 국내 벤더·기관 배포 좌표(groupId 접두) — 의존성 점검이 vendor 로 분류 (v0.34) */
  vendorCoordinates?: { groupIdPrefix: string; note: string }[];
  xmlNamespaces: { uri: string; replacement: string; reason: string }[];
  build: { javaRelease: number; javaProperties: string[]; springVersionProperties: string[]; springMinimum: string };
  evidence: { classes: Record<string, number>; packages5: string[]; classes5: string[] };
}

const RULES_URL = new URL("../catalog/migration-rules.json", import.meta.url);
let cached: MigrationRules | null = null;
export function loadMigrationRules(): MigrationRules {
  if (!cached) cached = JSON.parse(fs.readFileSync(RULES_URL, "utf8")) as MigrationRules;
  return cached;
}

// ── 결과 타입 ─────────────────────────────────────────
export type MigrationAction = "auto" | "manual";
export type MigrationKind =
  | "coordinate" | "coordinate-unknown" | "rte-version" | "parent" | "repository" | "removed-module"
  | "jakarta-artifact" | "library" | "java-release" | "spring-version"
  | "package" | "package-renamed" | "class-moved" | "class-removed" | "class-unknown"
  | "jakarta-package" | "web-xml" | "xml-namespace"
  | "component-class-removed" | "component-class-moved" | "component-reassemble";
/** 파일 원문 오프셋 기준 치환(2단계 적용용). start==end 이면 삽입. */
export interface TextEdit { start: number; end: number; replacement: string }
export interface MigrationItem { file: string; line: number; kind: MigrationKind; from: string; to: string | null; action: MigrationAction; reason: string; edits?: TextEdit[] }
export type SourceEra = "3.x" | "4.x" | "5.x" | "unknown";
export interface MigrateResult {
  projectDir: string;
  target: "5.x";
  rules: { toTag: string; surveyedAt: string; runtimeVersion: string };
  buildSystem: "maven" | "gradle" | "unknown";
  rteVersion: string | null;
  sourceEra: SourceEra;
  filesScanned: number;
  items: MigrationItem[];
  summary: { auto: number; manual: number; files: number; byKind: Record<string, number> };
  notes: string[];
}
export interface MigrateOptions {
  projectDir: string;
  target?: "5.x";
  maxFiles?: number;
  /** true 면 3.x 공통컴포넌트 소스(진단이 재조립 대상으로 표시한 디렉터리)의 항목을 auto 치환 대상에서 제외(manual 로 남김) */
  skipComponents?: boolean;
}

// ── 유틸 ──────────────────────────────────────────────
const SKIP_DIRS = new Set([".git", ".svn", ".hg", "target", "build", "node_modules", ".idea", ".settings", ".gradle", "bin", "out", "dist", ".mvn", "migration-backup", "upgrade-backup", "remove-backup"]);
const TEXT_EXT = new Set([".java", ".xml", ".jsp", ".jspx", ".jspf", ".tag", ".tagx", ".gradle", ".kts", ".properties", ".yml", ".yaml"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** 5.x 관례의 RTE 버전 속성명(parent 를 쓰지 않을 때) */
export const RTE_VERSION_PROPERTY = "org.egovframe.rte.version";

/** 버전 문자열을 숫자 배열로 비교 — a < b 이면 true. 숫자로 시작하지 않으면 비교 불가(null). */
export function versionBelow(a: string, b: string): boolean | null {
  const pa = a.match(/^\d+(?:\.\d+)*/)?.[0].split(".").map(Number);
  const pb = b.match(/^\d+(?:\.\d+)*/)?.[0].split(".").map(Number);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export const lineAt = (text: string, offset: number): number => { let n = 1; for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const globMatch = (pattern: string, value: string) => new RegExp(`^${pattern.split("*").map(escapeRe).join(".*")}$`).test(value);

/** 규칙에서 파생한 조회 구조 */
interface Index {
  coordByFrom: Map<string, MigrationCoordinate>;
  toArtifacts: Set<string>;
  removedByClass: Map<string, MigrationRules["packages"]["removed"][number]>;
  movesByClass: Map<string, string>;
  jakartaArtifacts: Map<string, MigrationRules["jakarta"]["artifacts"][number]>;
  jakartaPackages: MigrationRules["jakarta"]["packages"];
  classes5: Set<string>;
  packages5: Set<string>;
  componentRemoved: Map<string, { class: string; replacement: string | null; reason: string }>;
  componentMoves: Map<string, string>;
  componentPrefix: string | null;
}
let indexCache: Index | null = null;
function index(rules: MigrationRules): Index {
  if (indexCache) return indexCache;
  const coordByFrom = new Map<string, MigrationCoordinate>();
  const toArtifacts = new Set<string>();
  for (const c of rules.coordinates) {
    for (const f of c.from) coordByFrom.set(`${f.groupId}:${f.artifactId}`, c);
    toArtifacts.add(`${c.to.groupId}:${c.to.artifactId}`);
  }
  for (const n of rules.newModules) toArtifacts.add(`${n.to.groupId}:${n.to.artifactId}`);
  indexCache = {
    coordByFrom,
    toArtifacts,
    removedByClass: new Map(rules.packages.removed.map((r) => [r.class, r])),
    movesByClass: new Map(rules.packages.moves.map((m) => [m.from, m.to])),
    jakartaArtifacts: new Map(rules.jakarta.artifacts.map((a) => [`${a.from.groupId}:${a.from.artifactId}`, a])),
    jakartaPackages: [...rules.jakarta.packages].sort((a, b) => b.from.length - a.from.length),
    classes5: new Set(rules.evidence.classes5),
    packages5: new Set(rules.evidence.packages5),
    componentRemoved: new Map((rules.packages.components?.removed ?? []).map((r) => [r.class, r])),
    componentMoves: new Map((rules.packages.components?.moves ?? []).map((m) => [m.from, m.to])),
    componentPrefix: rules.packages.components?.prefix ?? null,
  };
  return indexCache;
}

// ── 순수 판정 함수(테스트 대상) ───────────────────────
/** RTE 클래스/패키지 토큰 하나를 5.x 기준으로 판정한다. 변화가 없으면 null. */
export function classifyRteToken(token: string, rules: MigrationRules = loadMigrationRules()): Pick<MigrationItem, "kind" | "from" | "to" | "action" | "reason"> | null {
  const ix = index(rules);
  const { from: pFrom, to: pTo } = rules.packages.prefix;
  const raw = token.replace(/\.$/, "");
  const legacyPrefix = raw.startsWith(pFrom);
  const norm = legacyPrefix ? pTo + raw.slice(pFrom.length) : raw;
  if (!norm.startsWith(pTo)) return null;

  // 1) 제거·이동은 원래 이름으로 먼저 본다 (패키지 이름 변경보다 우선)
  //    내부 클래스 참조(Foo.Bar)나 정적 멤버(Foo.CONST)는 뒤 세그먼트를 떼며 조회
  const segs = norm.split(".");
  for (let n = segs.length; n >= 3; n--) {
    const cand = segs.slice(0, n).join(".");
    const removed = ix.removedByClass.get(cand);
    if (removed) return { kind: "class-removed", from: raw, to: removed.replacement, action: "manual", reason: removed.reason };
    const moved = ix.movesByClass.get(cand);
    if (moved) return { kind: "class-moved", from: raw, to: moved + norm.slice(cand.length), action: "auto", reason: `5.x 에서 ${moved} 로 이동` };
    if (ix.classes5.has(cand)) {
      // 존재하는 클래스 — 접두어만 바뀐 경우만 보고
      return legacyPrefix ? { kind: "package", from: raw, to: norm, action: "auto", reason: `패키지 접두어 ${pFrom}* → ${pTo}*` } : null;
    }
  }
  // 2) 패키지 이름 변경 (예: fdl.cryptography → fdl.crypto)
  for (const r of rules.packages.renames) {
    if (norm === r.from.slice(0, -1) || norm.startsWith(r.from)) {
      const to = r.to + norm.slice(r.from.length);
      return { kind: "package-renamed", from: raw, to, action: "auto", reason: `5.x 에서 패키지 ${r.from}* → ${r.to}*` };
    }
  }
  // 3) 패키지 자체(와일드카드 import 등) 또는 알 수 없는 클래스
  const isPackage = ix.packages5.has(norm);
  const lastSeg = segs[segs.length - 1] ?? "";
  const looksLikeClass = /^[A-Z]/.test(lastSeg);
  if (isPackage || !looksLikeClass) {
    return legacyPrefix ? { kind: "package", from: raw, to: norm, action: "auto", reason: `패키지 접두어 ${pFrom}* → ${pTo}*` } : null;
  }
  return {
    kind: "class-unknown", from: raw, to: legacyPrefix ? norm : null, action: "manual",
    reason: `${rules.source.toTag} 소스 트리에 없는 클래스 — 사용자 정의 클래스이거나 5.x 에서 제거된 API 인지 확인`,
  };
}

/** javax.* 패키지 토큰이 Jakarta 로 바뀌는 대상이면 대응 패키지, 아니면 null (JDK 내장 javax 는 null). */
export function classifyJavaxPackage(pkg: string, rules: MigrationRules = loadMigrationRules()): string | null {
  const ix = index(rules);
  for (const r of ix.jakartaPackages) {
    if (pkg === r.from || pkg.startsWith(`${r.from}.`)) {
      if (r.exclude?.some((ex) => pkg === ex || pkg.startsWith(`${ex}.`))) return null;
      return r.to + pkg.slice(r.from.length);
    }
  }
  return null;
}

// ── 스캐너 ────────────────────────────────────────────
const RTE_TOKEN_RE = /\b(?:egovframework\.rte|org\.egovframe\.rte)(?:\.[A-Za-z_$][\w$]*)+\.?/g;
const COMPONENT_TOKEN_RE = /\begovframework\.com(?:\.[A-Za-z_$][\w$]*)+/g;

/** 공통컴포넌트(egovframework.com.*) 토큰을 대응표로 판정한다. 대응표에 없는 클래스는 사용자 코드일 수 있으므로 null(보고 안 함). */
export function classifyComponentToken(token: string, rules: MigrationRules = loadMigrationRules()): Pick<MigrationItem, "kind" | "from" | "to" | "action" | "reason"> | null {
  const ix = index(rules);
  if (!ix.componentPrefix || !token.startsWith(ix.componentPrefix)) return null;
  const segs = token.replace(/\.$/, "").split(".");
  for (let n = segs.length; n >= 3; n--) {
    const cand = segs.slice(0, n).join(".");
    const rm = ix.componentRemoved.get(cand);
    if (rm) return { kind: "component-class-removed", from: token, to: rm.replacement, action: "manual", reason: rm.reason };
    const mv = ix.componentMoves.get(cand);
    if (mv) return { kind: "component-class-moved", from: token, to: mv + token.slice(cand.length), action: "auto", reason: `공통컴포넌트 ${rules.source.components?.toTag ?? "5.x"} 에서 ${mv} 로 이동` };
  }
  return null;
}
const JAVAX_TOKEN_RE = /\bjavax(?:\.[a-z_][a-z0-9_]*)+/g;

function scanTextLines(rel: string, text: string, rules: MigrationRules, push: (i: MigrationItem) => void, opts: { rte: boolean; javax: boolean }) {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const seen = new Map<string, MigrationItem>();
    if (opts.rte && (line.includes("egovframework.rte") || line.includes("org.egovframe.rte"))) {
      for (const m of line.matchAll(RTE_TOKEN_RE)) {
        const c = classifyRteToken(m[0], rules);
        if (!c) continue;
        const start = offset + (m.index ?? 0);
        const edit: TextEdit | null = c.action === "auto" && c.to ? { start, end: start + c.from.length, replacement: c.to } : null;
        const prev = seen.get(c.from);
        if (prev) { if (edit) (prev.edits ??= []).push(edit); continue; } // 같은 줄의 반복 참조는 한 항목에 편집만 추가
        const item: MigrationItem = { file: rel, line: i + 1, ...c, ...(edit ? { edits: [edit] } : {}) };
        seen.set(c.from, item);
        push(item);
      }
    }
    if (opts.rte && line.includes("egovframework.com")) {
      for (const m of line.matchAll(COMPONENT_TOKEN_RE)) {
        const c = classifyComponentToken(m[0], rules);
        if (!c) continue;
        const start = offset + (m.index ?? 0);
        const edit: TextEdit | null = c.action === "auto" && c.to ? { start, end: start + c.from.length, replacement: c.to } : null;
        const prev = seen.get(c.from);
        if (prev) { if (edit) (prev.edits ??= []).push(edit); continue; }
        const item: MigrationItem = { file: rel, line: i + 1, ...c, ...(edit ? { edits: [edit] } : {}) };
        seen.set(c.from, item);
        push(item);
      }
    }
    if (opts.javax && line.includes("javax.")) {
      for (const m of line.matchAll(JAVAX_TOKEN_RE)) {
        const to = classifyJavaxPackage(m[0], rules);
        if (!to) continue;
        const start = offset + (m.index ?? 0);
        const edit: TextEdit = { start, end: start + m[0].length, replacement: to };
        const prev = seen.get(m[0]);
        if (prev) { (prev.edits ??= []).push(edit); continue; }
        const item: MigrationItem = { file: rel, line: i + 1, kind: "jakarta-package", from: m[0], to, action: "auto", reason: "Jakarta EE 9+ 패키지 이름 변경(Spring 6)", edits: [edit] };
        seen.set(m[0], item);
        push(item);
      }
    }
    offset += line.length + 1;
  }
}

function scanWebXml(rel: string, text: string, rules: MigrationRules, push: (i: MigrationItem) => void) {
  const w = rules.target.webXml;
  const open = text.match(/<web-app\b[^>]*>/);
  if (!open) return;
  const line = lineAt(text, open.index ?? 0);
  const ns = open[0].match(/\sxmlns="([^"]+)"/)?.[1];
  const ver = open[0].match(/\sversion="([^"]+)"/)?.[1];
  if (ns && w.legacyNamespaces.includes(ns)) {
    // 여는 태그 전체를 다시 쓴다: xmlns·version 교체, schemaLocation 이 있으면 교체·없으면 추가하지 않음(xsi 선언이 없을 수 있음)
    let tag = open[0].replace(/(\s)xmlns="[^"]+"/, `$1xmlns="${w.namespace}"`);
    tag = ver ? tag.replace(/(\s)version="[^"]+"/, `$1version="${w.version}"`) : tag.replace(/<web-app\b/, `<web-app version="${w.version}"`);
    if (/\sxsi:schemaLocation="[^"]*"/.test(tag)) tag = tag.replace(/(\s)xsi:schemaLocation="[^"]*"/, `$1xsi:schemaLocation="${w.schemaLocation}"`);
    const start = open.index ?? 0;
    push({ file: rel, line, kind: "web-xml", from: `xmlns="${ns}"${ver ? ` version="${ver}"` : ""}`, to: `xmlns="${w.namespace}" version="${w.version}" (schemaLocation: ${w.schemaLocation})`, action: "auto", reason: "Servlet 5.0+(Jakarta) web.xml 스키마", edits: [{ start, end: start + open[0].length, replacement: tag }] });
  }
  else if (!ns && /<!DOCTYPE web-app/i.test(text))
    push({ file: rel, line, kind: "web-xml", from: "DOCTYPE web-app (Servlet 2.3 DTD)", to: `xmlns="${w.namespace}" version="${w.version}"`, action: "manual", reason: "DTD 기반 web.xml 은 스키마 기반으로 다시 작성" });
}

function scanSpringXmlNamespaces(rel: string, text: string, rules: MigrationRules, push: (i: MigrationItem) => void) {
  for (const ns of rules.xmlNamespaces) {
    let idx = text.indexOf(ns.uri);
    const reported = new Set<number>();
    while (idx >= 0) {
      const line = lineAt(text, idx);
      if (!reported.has(line)) {
        reported.add(line);
        push({ file: rel, line, kind: "xml-namespace", from: ns.uri, to: ns.replacement, action: "manual", reason: ns.reason });
      }
      idx = text.indexOf(ns.uri, idx + ns.uri.length);
    }
  }
}

export interface PomSpan { start: number; end: number }
export interface PomDep { groupId: string; artifactId: string; version: string | null; line: number; scope: string | null; block: PomSpan; gSpan: PomSpan; aSpan: PomSpan; vSpan: PomSpan | null; indent: string }
export function parsePomProperties(text: string): Map<string, string> {
  const props = new Map<string, string>();
  const block = text.match(/<properties>([\s\S]*?)<\/properties>/);
  if (block) for (const m of block[1].matchAll(/<([\w.\-]+)>\s*([^<]*?)\s*<\/\1>/g)) props.set(m[1], m[2]);
  return props;
}
export function resolveProp(v: string | null, props: Map<string, string>): string | null {
  if (v == null) return null;
  let out = v;
  for (let i = 0; i < 5 && /\$\{[\w.\-]+\}/.test(out); i++) out = out.replace(/\$\{([\w.\-]+)\}/g, (_, k) => props.get(k) ?? `\${${k}}`);
  return out;
}
export function parsePomDeps(text: string): PomDep[] {
  const deps: PomDep[] = [];
  for (const m of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const body = m[1];
    const base = (m.index ?? 0) + "<dependency>".length;
    const gM = body.match(/<groupId>(\s*)([^<\s]+)(\s*)<\/groupId>/);
    const aM = body.match(/<artifactId>(\s*)([^<\s]+)(\s*)<\/artifactId>/);
    if (!gM || !aM) continue;
    const vM = body.match(/<version>(\s*)([^<\s]+)(\s*)<\/version>/);
    const span = (mm: RegExpMatchArray, tag: string): PomSpan => { const st = base + (mm.index ?? 0) + tag.length + 2 + mm[1].length; return { start: st, end: st + mm[2].length }; };
    const lineStart = text.lastIndexOf("\n", m.index ?? 0) + 1;
    deps.push({
      groupId: gM[2], artifactId: aM[2],
      version: vM?.[2] ?? null,
      scope: body.match(/<scope>\s*([^<\s]+)\s*<\/scope>/)?.[1] ?? null,
      line: lineAt(text, base + (aM.index ?? 0)),
      block: { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
      gSpan: span(gM, "groupId"), aSpan: span(aM, "artifactId"), vSpan: vM ? span(vM, "version") : null,
      indent: text.slice(lineStart, m.index ?? 0).match(/^[ \t]*$/) ? text.slice(lineStart, m.index ?? 0) : "",
    });
  }
  return deps;
}

function scanPom(rel: string, text: string, rules: MigrationRules, push: (i: MigrationItem) => void, ctx: { eras: Set<SourceEra>; hasRte: boolean; has5xParent: boolean }) {
  const ix = index(rules);
  const props = parsePomProperties(text);
  const t = rules.target;

  // parent
  const parent = text.match(/<parent>([\s\S]*?)<\/parent>/);
  if (parent) {
    const g = parent[1].match(/<groupId>\s*([^<\s]+)/)?.[1];
    const a = parent[1].match(/<artifactId>\s*([^<\s]+)/)?.[1];
    if (t.parents.some((p) => p.groupId === g && p.artifactId === a)) ctx.has5xParent = true;
  }

  // RTE 버전 속성
  const legacyVersionKeys = new Set<string>();
  for (const key of t.versionProperties.legacy) {
    const m = text.match(new RegExp(`<${escapeRe(key)}>\\s*([^<\\s]+)\\s*</${escapeRe(key)}>`));
    if (!m) continue;
    const below = versionBelow(m[1], t.runtimeVersion);
    if (below === false) continue;
    legacyVersionKeys.add(key);
    const start = m.index ?? 0;
    push({
      file: rel, line: lineAt(text, start), kind: "rte-version", from: `<${key}>${m[1]}</${key}>`,
      to: `<${RTE_VERSION_PROPERTY}>${t.runtimeVersion}</${RTE_VERSION_PROPERTY}> (또는 parent 관리)`, action: "auto",
      reason: t.versionProperties.note,
      edits: [{ start, end: start + m[0].length, replacement: `<${RTE_VERSION_PROPERTY}>${t.runtimeVersion}</${RTE_VERSION_PROPERTY}>` }],
    });
  }

  // 저장소 URL
  for (const url of t.legacyRepositoryUrls) {
    const re = new RegExp(`<url>\\s*${escapeRe(url)}\\s*</url>`, "g");
    for (const m of text.matchAll(re)) {
      const start = (m.index ?? 0) + m[0].indexOf(url);
      push({ file: rel, line: lineAt(text, m.index ?? 0), kind: "repository", from: url, to: t.repositoryUrl, action: "auto", reason: "표준프레임워크 Maven 저장소는 HTTPS 주소만 유효", edits: [{ start, end: start + url.length, replacement: t.repositoryUrl }] });
    }
  }

  // Java 릴리스
  for (const key of rules.build.javaProperties) {
    const m = text.match(new RegExp(`<${escapeRe(key)}>\\s*([^<\\s]+)\\s*</${escapeRe(key)}>`));
    if (!m) continue;
    const v = resolveProp(m[1], props) ?? m[1];
    const num = v.startsWith("1.") ? Number(v.slice(2)) : Number.parseInt(v, 10);
    if (Number.isFinite(num) && num < rules.build.javaRelease) {
      const vs = (m.index ?? 0) + m[0].indexOf(m[1], key.length + 2);
      push({ file: rel, line: lineAt(text, m.index ?? 0), kind: "java-release", from: `<${key}>${m[1]}</${key}>`, to: `<${key}>${rules.build.javaRelease}</${key}>`, action: "auto", reason: `5.x(Spring 6) 는 Java ${rules.build.javaRelease} 이상`, edits: [{ start: vs, end: vs + m[1].length, replacement: String(rules.build.javaRelease) }] });
    }
  }
  for (const m of text.matchAll(/<(source|target|release)>\s*([^<\s]+)\s*<\/\1>/g)) {
    if (/^\$\{/.test(m[2])) continue; // 속성 참조는 속성 쪽 항목이 담당
    const v = m[2];
    const num = v.startsWith("1.") ? Number(v.slice(2)) : Number.parseInt(v, 10);
    if (Number.isFinite(num) && num < rules.build.javaRelease && /maven-compiler-plugin/.test(text)) {
      const vs = (m.index ?? 0) + m[0].indexOf(m[2], m[1].length + 2);
      push({ file: rel, line: lineAt(text, m.index ?? 0), kind: "java-release", from: `<${m[1]}>${m[2]}</${m[1]}>`, to: `<${m[1]}>${rules.build.javaRelease}</${m[1]}>`, action: "auto", reason: `5.x(Spring 6) 는 Java ${rules.build.javaRelease} 이상`, edits: [{ start: vs, end: vs + m[2].length, replacement: String(rules.build.javaRelease) }] });
    }
  }

  // Spring 버전 속성
  for (const key of rules.build.springVersionProperties) {
    const m = text.match(new RegExp(`<${escapeRe(key)}>\\s*([^<\\s]+)\\s*</${escapeRe(key)}>`));
    if (!m) continue;
    if (versionBelow(m[1], rules.build.springMinimum) === true)
      push({ file: rel, line: lineAt(text, m.index ?? 0), kind: "spring-version", from: `<${key}>${m[1]}</${key}>`, to: `${rules.build.springMinimum} 이상 (5.x parent 가 관리)`, action: "manual", reason: "Spring 6 로 올리면 javax→jakarta 와 함께 제거된 API(WebSecurityConfigurerAdapter, CommonsMultipartResolver 등) 대응이 필요" });
  }

  // 의존성
  const deps = parsePomDeps(text);
  // 치환 뒤 pom 에 존재하게 될 좌표(기존 + Jakarta 치환 결과) — 구현 좌표(also) 중복 삽입을 막는다
  const resulting = new Set(deps.map((x) => { const jk = ix.jakartaArtifacts.get(`${x.groupId}:${x.artifactId}`); return jk ? `${jk.to.groupId}:${jk.to.artifactId}` : `${x.groupId}:${x.artifactId}`; }));
  for (const d of deps) {
    const key = `${d.groupId}:${d.artifactId}`;
    const ver = resolveProp(d.version, props);
    const verText = d.version ? `:${d.version}` : "";

    // RTE 의존성의 <version> 치환: 리터럴 → 5.0.2, ${레거시 속성} → ${org.egovframe.rte.version}(속성도 함께 바뀜), 그 외 속성은 그대로
    const rteVersionEdit = (): TextEdit[] => {
      if (!d.vSpan || !d.version) return [];
      const ref = d.version.match(/^\$\{([\w.\-]+)\}$/)?.[1];
      if (ref) return legacyVersionKeys.has(ref) && ref !== RTE_VERSION_PROPERTY ? [{ start: d.vSpan.start, end: d.vSpan.end, replacement: `\${${RTE_VERSION_PROPERTY}}` }] : [];
      return [{ start: d.vSpan.start, end: d.vSpan.end, replacement: t.runtimeVersion }];
    };
    const coord = ix.coordByFrom.get(key);
    if (coord) {
      ctx.hasRte = true;
      const era = coord.from.find((f) => `${f.groupId}:${f.artifactId}` === key)?.era as SourceEra | undefined;
      if (era) ctx.eras.add(era);
      push({
        file: rel, line: d.line, kind: "coordinate", from: `${key}${verText}`, to: `${coord.to.groupId}:${coord.to.artifactId}${d.version ? `:${t.runtimeVersion}` : ""}`, action: "auto", reason: `5.x 좌표(${rules.source.toTag} ${coord.layer}/${coord.module})`,
        edits: [{ start: d.gSpan.start, end: d.gSpan.end, replacement: coord.to.groupId }, { start: d.aSpan.start, end: d.aSpan.end, replacement: coord.to.artifactId }, ...rteVersionEdit()],
      });
      continue;
    }
    if (ix.toArtifacts.has(key)) {
      ctx.hasRte = true;
      ctx.eras.add("5.x");
      if (ver && versionBelow(ver, t.runtimeVersion) === true)
        push({ file: rel, line: d.line, kind: "rte-version", from: `${key}${verText}`, to: `${key}:${t.runtimeVersion}`, action: "auto", reason: `RTE ${t.runtimeVersion} 기준`, edits: rteVersionEdit() });
      continue;
    }
    const removedModule = rules.removedModules.find((m) => m.fromArtifactId === d.artifactId && /^(egovframework\.rte|org\.egovframe\.rte)$/.test(d.groupId));
    if (removedModule) {
      ctx.hasRte = true;
      push({ file: rel, line: d.line, kind: "removed-module", from: `${key}${verText}`, to: null, action: "manual", reason: removedModule.reason });
      continue;
    }
    if (/^(egovframework\.rte|org\.egovframe\.rte)$/.test(d.groupId)) {
      ctx.hasRte = true;
      push({ file: rel, line: d.line, kind: "coordinate-unknown", from: `${key}${verText}`, to: null, action: "manual", reason: `${rules.source.toTag} 모듈 목록에 없는 RTE 좌표 — 모듈명 확인 필요` });
      continue;
    }
    const jk = ix.jakartaArtifacts.get(key);
    if (jk) {
      const also = jk.also ? ` + ${jk.also.groupId}:${jk.also.artifactId}:${jk.also.version}` : "";
      const edits: TextEdit[] = [
        { start: d.gSpan.start, end: d.gSpan.end, replacement: jk.to.groupId },
        { start: d.aSpan.start, end: d.aSpan.end, replacement: jk.to.artifactId },
      ];
      if (d.vSpan) edits.push({ start: d.vSpan.start, end: d.vSpan.end, replacement: jk.toVersion });
      // 구현 좌표(JSTL 의 glassfish 등)가 pom 에 없으면 바로 뒤에 형제 <dependency> 를 삽입
      if (jk.also && !resulting.has(`${jk.also.groupId}:${jk.also.artifactId}`)) {
        resulting.add(`${jk.also.groupId}:${jk.also.artifactId}`);
        const ind = d.indent;
        const inner = ind ? `${ind}    ` : "    ";
        const scope = d.scope ? `\n${inner}<scope>${d.scope}</scope>` : "";
        edits.push({ start: d.block.end, end: d.block.end, replacement: `\n${ind}<dependency>\n${inner}<groupId>${jk.also.groupId}</groupId>\n${inner}<artifactId>${jk.also.artifactId}</artifactId>\n${inner}<version>${jk.also.version}</version>${scope}\n${ind}</dependency>` });
      }
      push({ file: rel, line: d.line, kind: "jakarta-artifact", from: `${key}${verText}`, to: `${jk.to.groupId}:${jk.to.artifactId}:${jk.toVersion}${also}`, action: "auto", reason: jk.note ?? "Jakarta EE 9+ 좌표", edits });
      continue;
    }
    for (const lib of rules.libraries) {
      if (lib.match.groupId !== d.groupId || !globMatch(lib.match.artifactId, d.artifactId)) continue;
      if (lib.match.versionBelow) {
        if (!ver) continue; // 버전을 알 수 없으면(parent 관리) 판단 보류
        const below = versionBelow(ver, lib.match.versionBelow);
        if (below !== true) continue;
      }
      push({ file: rel, line: d.line, kind: "library", from: `${key}${verText}`, to: lib.replacement, action: "manual", reason: lib.reason });
      break;
    }
  }
}

function scanGradle(rel: string, text: string, rules: MigrationRules, push: (i: MigrationItem) => void, ctx: { eras: Set<SourceEra>; hasRte: boolean }) {
  const ix = index(rules);
  const t = rules.target;
  for (const m of text.matchAll(/["']([\w.\-]+):([\w.\-]+)(?::([^"':\s]+))?["']/g)) {
    const key = `${m[1]}:${m[2]}`;
    const line = lineAt(text, m.index ?? 0);
    const inner = { start: (m.index ?? 0) + 1, end: (m.index ?? 0) + m[0].length - 1 };
    const coord = ix.coordByFrom.get(key);
    if (coord) {
      ctx.hasRte = true;
      const era = coord.from.find((f) => `${f.groupId}:${f.artifactId}` === key)?.era as SourceEra | undefined;
      if (era) ctx.eras.add(era);
      const to = `${coord.to.groupId}:${coord.to.artifactId}:${t.runtimeVersion}`;
      push({ file: rel, line, kind: "coordinate", from: m[0].slice(1, -1), to, action: "auto", reason: `5.x 좌표(${rules.source.toTag} ${coord.layer}/${coord.module})`, edits: [{ ...inner, replacement: to }] });
      continue;
    }
    if (ix.toArtifacts.has(key)) { ctx.hasRte = true; ctx.eras.add("5.x"); continue; }
    const jk = ix.jakartaArtifacts.get(key);
    if (jk) {
      const to = `${jk.to.groupId}:${jk.to.artifactId}:${jk.toVersion}`;
      push({ file: rel, line, kind: "jakarta-artifact", from: m[0].slice(1, -1), to, action: "auto", reason: jk.note ?? "Jakarta EE 9+ 좌표", edits: [{ ...inner, replacement: to }] });
      continue;
    }
    for (const lib of rules.libraries) {
      if (lib.match.groupId !== m[1] || !globMatch(lib.match.artifactId, m[2])) continue;
      if (lib.match.versionBelow && (!m[3] || versionBelow(m[3], lib.match.versionBelow) !== true)) continue;
      push({ file: rel, line, kind: "library", from: m[0].slice(1, -1), to: lib.replacement, action: "manual", reason: lib.reason });
      break;
    }
  }
  const reportedRepoLines = new Set<number>();
  for (const url of [...t.legacyRepositoryUrls].sort((a, b) => b.length - a.length)) {
    let idx = text.indexOf(url);
    while (idx >= 0) {
      const line = lineAt(text, idx);
      if (!reportedRepoLines.has(line)) {
        reportedRepoLines.add(line);
        push({ file: rel, line, kind: "repository", from: url, to: t.repositoryUrl, action: "auto", reason: "표준프레임워크 Maven 저장소는 HTTPS 주소만 유효", edits: [{ start: idx, end: idx + url.length, replacement: t.repositoryUrl }] });
      }
      idx = text.indexOf(url, idx + url.length);
    }
  }
  const src = text.match(/sourceCompatibility\s*=?\s*["']?(?:JavaVersion\.VERSION_)?(1_8|1\.8|[0-9]+)/);
  if (src) {
    const num = src[1].startsWith("1") && src[1].length === 3 ? 8 : Number.parseInt(src[1], 10);
    if (Number.isFinite(num) && num < rules.build.javaRelease) {
      const vs = (src.index ?? 0) + src[0].length - src[1].length;
      push({ file: rel, line: lineAt(text, src.index ?? 0), kind: "java-release", from: src[0], to: `${rules.build.javaRelease}`, action: "auto", reason: `5.x(Spring 6) 는 Java ${rules.build.javaRelease} 이상`, edits: [{ start: vs, end: vs + src[1].length, replacement: String(rules.build.javaRelease) }] });
    }
  }
}

export function walkProjectFiles(root: string, maxFiles: number): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(p); continue; }
      if (!e.isFile()) continue;
      if (TEXT_EXT.has(path.extname(e.name)) || e.name === "pom.xml") out.push(p);
      if (out.length >= maxFiles) break;
    }
  }
  return out.sort();
}

// ── 진입점 ────────────────────────────────────────────
/** 기존 프로젝트를 읽기 전용으로 스캔해 5.x 전환 항목을 파일·라인 단위로 보고한다. (디스크 변경 없음) */
export function migrateProject(opts: MigrateOptions): MigrateResult {
  const rules = loadMigrationRules();
  const target = opts.target ?? "5.x";
  if (target !== "5.x") throw new Error(`지원하지 않는 target: ${target} (5.x 만 지원)`);
  const dir = path.resolve(opts.projectDir);
  const diag = diagnoseProject({ projectDir: dir }); // 존재·빌드 도구·RTE 버전
  const maxFiles = opts.maxFiles ?? 20_000;
  const files = walkProjectFiles(dir, maxFiles);
  const items: MigrationItem[] = [];
  const notes: string[] = [];
  const ctx = { eras: new Set<SourceEra>(), hasRte: false, has5xParent: false };
  const seen = new Set<string>();
  const push = (i: MigrationItem) => {
    const k = `${i.file}\u0000${i.line}\u0000${i.kind}\u0000${i.from}`;
    if (seen.has(k)) return;
    seen.add(k);
    items.push(i);
  };
  let scanned = 0;

  for (const abs of files) {
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { continue; }
    if (st.size > MAX_FILE_BYTES) { notes.push(`건너뜀(2MB 초과): ${path.relative(dir, abs)}`); continue; }
    let text: string;
    try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
    if (text.includes("\u0000")) continue; // 바이너리
    scanned++;
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    const base = path.basename(abs);
    const ext = path.extname(abs);
    if (base === "pom.xml") { scanPom(rel, text, rules, push, ctx); continue; }
    if (base === "build.gradle" || base === "build.gradle.kts" || base === "settings.gradle" || base === "settings.gradle.kts") { scanGradle(rel, text, rules, push, ctx); continue; }
    if (base === "web.xml") { scanWebXml(rel, text, rules, push); scanTextLines(rel, text, rules, push, { rte: true, javax: true }); continue; }
    if (ext === ".xml") { scanSpringXmlNamespaces(rel, text, rules, push); scanTextLines(rel, text, rules, push, { rte: true, javax: true }); continue; }
    if (ext === ".java" || ext === ".jsp" || ext === ".jspx" || ext === ".jspf" || ext === ".tag" || ext === ".tagx") { scanTextLines(rel, text, rules, push, { rte: true, javax: true }); continue; }
    if (ext === ".properties" || ext === ".yml" || ext === ".yaml") { scanTextLines(rel, text, rules, push, { rte: true, javax: false }); continue; }
  }
  if (files.length >= maxFiles) notes.push(`파일 수 상한(${maxFiles})에 도달해 일부만 스캔했습니다.`);

  // parent 권고: RTE 좌표를 쓰는 Maven 프로젝트인데 5.x parent 가 없으면 한 번만 안내(manual)
  const rootPom = files.find((f) => path.relative(dir, f) === "pom.xml");
  if (rootPom && ctx.hasRte && !ctx.has5xParent) {
    const p = rules.target.parents;
    push({
      file: "pom.xml", line: 1, kind: "parent", from: "(parent 없음 또는 5.x parent 아님)",
      to: p.map((x) => `${x.groupId}:${x.artifactId}:${x.version}(${x.kind})`).join(" | "), action: "manual",
      reason: "5.x 공식 템플릿은 parent 가 RTE·Spring·Jakarta 의존성 버전을 관리한다. parent 를 쓰지 않으면 각 버전을 직접 맞춰야 한다.",
    });
  }

  // 3.x 공통컴포넌트 소스 재조립 권고: 감지된 컴포넌트 디렉터리 안에 전환 항목(접두어·javax)이 있으면 컴포넌트 단위로 1건
  const componentDirs: string[] = [];
  for (const c of diag.detectedComponents) {
    const prefix = c.matchedPrefix.replace(/\/?$/, "/");
    const inside = items.filter((i) => i.file.startsWith(prefix) && (i.kind === "package" || i.kind === "jakarta-package" || i.kind === "package-renamed" || i.kind === "class-removed"));
    if (inside.length === 0) continue;
    componentDirs.push(prefix);
    push({
      file: c.matchedPrefix, line: 1, kind: "component-reassemble", from: `${c.id} (3.x 소스, 전환 항목 ${inside.length}건)`,
      to: `add_egovframe_components(componentIds=["${c.id}"]) 로 ${rules.source.components?.toTag ?? "5.x"} 재조립`, action: "manual",
      reason: "공통컴포넌트는 upstream 에서 복사한 소스이고 5.x 에서 내용이 바뀌었다(클래스·매퍼·설정). 텍스트 치환보다 5.x 원본을 다시 조립하고 사용자 수정은 백업과 diff 로 옮기는 편이 안전하다. 치환을 원하면 skipComponents=false(기본)로 두면 된다.",
    });
  }
  if (opts.skipComponents && componentDirs.length) {
    let demoted = 0;
    for (const i of items) {
      if (i.action !== "auto" || !componentDirs.some((d) => i.file.startsWith(d))) continue;
      i.action = "manual";
      i.reason = `${i.reason} (skipComponents: 공통컴포넌트 디렉터리는 재조립 대상이라 치환하지 않음)`;
      delete i.edits;
      demoted++;
    }
    if (demoted) notes.push(`skipComponents: 공통컴포넌트 디렉터리 ${componentDirs.length}개의 자동 항목 ${demoted}건을 수동으로 돌렸습니다.`);
  }

  items.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
  const byKind: Record<string, number> = {};
  for (const i of items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  const sourceEra: SourceEra = ctx.eras.has("3.x") ? "3.x" : ctx.eras.has("4.x") ? "4.x" : ctx.eras.has("5.x") ? "5.x" : "unknown";
  if (!ctx.hasRte) notes.push("빌드 파일에서 표준프레임워크 실행환경(RTE) 좌표를 찾지 못했습니다 — 소스 스캔 결과만 보고합니다.");

  return {
    projectDir: dir, target,
    rules: { toTag: rules.source.toTag, surveyedAt: rules.surveyedAt, runtimeVersion: rules.target.runtimeVersion },
    buildSystem: diag.buildSystem, rteVersion: diag.egovVersion, sourceEra,
    filesScanned: scanned, items,
    summary: { auto: items.filter((i) => i.action === "auto").length, manual: items.filter((i) => i.action === "manual").length, files: new Set(items.map((i) => i.file)).size, byKind },
    notes,
  };
}

const KIND_LABEL: Record<MigrationKind, string> = {
  coordinate: "RTE Maven 좌표", "coordinate-unknown": "알 수 없는 RTE 좌표", "rte-version": "RTE 버전", parent: "5.x parent", repository: "Maven 저장소 URL",
  "removed-module": "제거된 RTE 모듈", "jakarta-artifact": "Jakarta 의존성 좌표", library: "교체 필요 라이브러리", "java-release": "Java 버전", "spring-version": "Spring 버전",
  package: "RTE 패키지 접두어", "package-renamed": "RTE 패키지 이름 변경", "class-moved": "RTE 클래스 이동", "class-removed": "제거된 RTE 클래스", "class-unknown": "확인 필요 클래스",
  "jakarta-package": "javax → jakarta 패키지", "web-xml": "web.xml 스키마", "xml-namespace": "제거된 XML 네임스페이스",
  "component-class-removed": "제거된 공통컴포넌트 클래스", "component-class-moved": "이동한 공통컴포넌트 클래스", "component-reassemble": "공통컴포넌트 재조립 권고",
};

/** 진단 결과를 Markdown 으로 렌더링한다. */
export function renderMigrationMarkdown(r: MigrateResult): string {
  const L: string[] = [];
  L.push(`# 표준프레임워크 5.x 전환 진단`, ``);
  L.push(`- 경로: ${r.projectDir}`);
  L.push(`- 빌드: ${r.buildSystem} · 현재 RTE ${r.rteVersion ?? "미검출"} (${r.sourceEra} 좌표) → 목표 ${r.rules.runtimeVersion} (${r.rules.toTag} 기준, 조사일 ${r.rules.surveyedAt})`);
  L.push(`- 스캔 파일 ${r.filesScanned}개 · 항목 ${r.items.length}건 (자동 ${r.summary.auto} · 수동 ${r.summary.manual}) · 대상 파일 ${r.summary.files}개`);
  for (const n of r.notes) L.push(`- ${n}`);
  L.push(``);
  if (r.items.length === 0) { L.push(`전환 항목 없음 — 5.x 기준을 이미 만족합니다.`); return L.join("\n"); }
  L.push(`## 종류별 요약`, ``, `| 종류 | 건수 | 처리 |`, `|---|---|---|`);
  for (const [k, n] of Object.entries(r.summary.byKind).sort((a, b) => b[1] - a[1])) {
    const action = r.items.find((i) => i.kind === k)?.action ?? "auto";
    L.push(`| ${KIND_LABEL[k as MigrationKind] ?? k} | ${n} | ${action === "auto" ? "자동 치환 가능" : "수동"} |`);
  }
  const section = (title: string, action: MigrationAction) => {
    const list = r.items.filter((i) => i.action === action);
    if (list.length === 0) return;
    L.push(``, `## ${title} (${list.length})`, ``);
    let curFile = "";
    for (const i of list) {
      if (i.file !== curFile) { curFile = i.file; L.push(`### ${i.file}`, ``); }
      const to = i.to ? ` → \`${i.to}\`` : " → (대체 없음)";
      L.push(`- L${i.line} [${KIND_LABEL[i.kind]}] \`${i.from}\`${to}`);
      if (action === "manual") L.push(`  - ${i.reason}`);
    }
  };
  section("수동 전환 항목", "manual");
  section("자동 치환 가능 항목", "auto");
  L.push(``, `---`, `자동 항목은 2단계(\`migrate_egovframe_project\` apply, v0.30) 에서 치환하고, 수동 항목은 사유에 따라 코드를 고칩니다. 이 진단은 파일을 수정하지 않았습니다.`);
  return L.join("\n");
}

// ── 2단계: 적용 (v0.30.0) ─────────────────────────────
export interface ApplyFilePlan { file: string; items: number; edits: number; preview: { line: number; before: string; after: string }[] }
export interface MigrateApplyResult extends MigrateResult {
  mode: "apply";
  dryRun: boolean;
  /** 적용(또는 dryRun 이면 적용 예정)한 auto 항목·편집·파일 수 */
  applied: { items: number; edits: number; files: number };
  /** 남겨 둔 manual 항목 수 */
  skippedManual: number;
  files: ApplyFilePlan[];
  /** 겹치는 편집 때문에 건너뛴 항목(파일:라인) — 정상적으로는 없다 */
  conflicts: string[];
  backupDir?: string;
  planPath?: string;
  /** 적용 후 다시 진단한 요약(dryRun 이면 없음). auto 는 0 이어야 한다 */
  remaining?: MigrateResult["summary"];
}
export interface ApplyOptions extends MigrateOptions { dryRun?: boolean; faultInjection?: "after-files" }

/** 파일 하나에 편집을 적용한다. 겹치는 편집은 뒤(오프셋 큰) 것부터 적용하며, 겹치면 건너뛰고 conflicts 에 기록. */
export function applyTextEdits(text: string, edits: TextEdit[]): { text: string; applied: number; skipped: TextEdit[] } {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let minStart = Number.POSITIVE_INFINITY;
  let applied = 0;
  const skipped: TextEdit[] = [];
  for (const e of sorted) {
    if (e.start < 0 || e.end > text.length || e.start > e.end || e.end > minStart) { skipped.push(e); continue; }
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    minStart = e.start;
    applied++;
  }
  return { text: out, applied, skipped };
}

function previewDiff(before: string, after: string, cap = 60): ApplyFilePlan["preview"] {
  const a = before.split("\n"), b = after.split("\n");
  const out: ApplyFilePlan["preview"] = [];
  // 삽입으로 줄 수가 달라질 수 있어 앞에서부터 맞춰 보고, 어긋나면 나머지를 통째로 보고하지 않고 앞 구간만 비교한다
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n && out.length < cap; i++) if (a[i] !== b[i]) out.push({ line: i + 1, before: a[i].trimEnd(), after: b[i].trimEnd() });
  if (b.length > a.length && out.length < cap) out.push({ line: a.length + 1, before: "", after: `(+${b.length - a.length}줄 삽입)` });
  return out;
}

/** 1단계 진단의 auto 항목을 파일에 적용한다. dryRun(기본 true)이면 계획만 돌려주고, 적용 시 transaction 으로 백업·계획 파일과 함께 기록한다. */
export async function applyMigration(opts: ApplyOptions): Promise<MigrateApplyResult> {
  const dryRun = opts.dryRun ?? true;
  const r = migrateProject(opts);
  const dir = r.projectDir;
  const byFile = new Map<string, MigrationItem[]>();
  for (const i of r.items) if (i.action === "auto" && i.edits?.length) (byFile.get(i.file) ?? byFile.set(i.file, []).get(i.file)!).push(i);
  const skippedManual = r.items.filter((i) => i.action === "manual").length;

  const files: ApplyFilePlan[] = [];
  const conflicts: string[] = [];
  const newTexts = new Map<string, { before: string; after: string }>();
  let appliedItems = 0, appliedEdits = 0;
  for (const [file, items] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
    const abs = path.join(dir, file);
    const before = fs.readFileSync(abs, "utf8");
    const edits = items.flatMap((i) => i.edits ?? []);
    const { text, applied, skipped } = applyTextEdits(before, edits);
    for (const sk of skipped) {
      const owner = items.find((i) => i.edits?.includes(sk));
      conflicts.push(`${file}:${owner?.line ?? "?"} ${owner?.from ?? ""}`);
    }
    if (text === before) continue;
    const itemsApplied = items.filter((i) => !(i.edits ?? []).some((e) => skipped.includes(e))).length;
    appliedItems += itemsApplied;
    appliedEdits += applied;
    newTexts.set(file, { before, after: text });
    files.push({ file, items: itemsApplied, edits: applied, preview: previewDiff(before, text) });
  }

  const base: MigrateApplyResult = {
    ...r, mode: "apply", dryRun, applied: { items: appliedItems, edits: appliedEdits, files: files.length }, skippedManual, files, conflicts,
  };
  if (dryRun || files.length === 0) return base;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRelDir = path.join("migration-backup", `${ts}-${randomUUID()}`);
  const planRel = path.join(backupRelDir, "migration-plan.json");
  await withFileTransaction(dir, "5.x 전환 적용", (tx) => {
    for (const [file, { before }] of newTexts) {
      const current = tx.readFile(file);
      if (current === null || current.toString("utf8") !== before) throw new Error(`진단 이후 파일이 변경되어 적용을 중단합니다: ${file}`);
    }
    for (const [file, { before, after }] of newTexts) {
      tx.writeFile(path.join(backupRelDir, file), before, { mustNotExist: true });
      tx.writeFile(file, after);
    }
    const plan = {
      createdAt: new Date().toISOString(),
      tool: "migrate_egovframe_project",
      target: r.target,
      rules: r.rules,
      applied: base.applied,
      files: files.map((f) => ({ file: f.file, items: f.items, edits: f.edits })),
      items: r.items.map(({ edits: _e, ...rest }) => rest),
    };
    tx.writeFile(planRel, `${JSON.stringify(plan, null, 2)}\n`, { mustNotExist: true });
    if (opts.faultInjection === "after-files") throw new Error("migration fault injection: after-files");
  });

  const after = migrateProject(opts);
  return { ...base, backupDir: path.join(dir, backupRelDir), planPath: path.join(dir, planRel), remaining: after.summary };
}

/** 적용 결과를 Markdown 으로 렌더링한다. */
export function renderMigrationApplyMarkdown(r: MigrateApplyResult): string {
  const L: string[] = [];
  L.push(`# 표준프레임워크 5.x 전환 ${r.dryRun ? "적용 계획(dryRun)" : "적용 결과"}`, ``);
  L.push(`- 경로: ${r.projectDir}`);
  L.push(`- 현재 RTE ${r.rteVersion ?? "미검출"} (${r.sourceEra} 좌표) → 목표 ${r.rules.runtimeVersion}`);
  L.push(`- 진단 항목 ${r.items.length}건 (자동 ${r.summary.auto} · 수동 ${r.summary.manual}) → ${r.dryRun ? "적용 예정" : "적용"} ${r.applied.items}항목 · 편집 ${r.applied.edits}곳 · 파일 ${r.applied.files}개 · 수동 항목 ${r.skippedManual}건은 그대로 둠`);
  if (r.conflicts.length) L.push(`- ⚠️ 겹치는 편집으로 건너뜀 ${r.conflicts.length}건: ${r.conflicts.slice(0, 5).join(", ")}${r.conflicts.length > 5 ? " …" : ""}`);
  if (!r.dryRun && r.backupDir) L.push(`- 백업: ${r.backupDir} (원본 파일 + migration-plan.json)`);
  if (r.remaining) L.push(`- 적용 후 재진단: 자동 ${r.remaining.auto} · 수동 ${r.remaining.manual}`);
  for (const n of r.notes) L.push(`- ${n}`);
  if (r.files.length) {
    L.push(``, `## 파일별 변경${r.dryRun ? " 미리보기" : ""}`);
    for (const f of r.files) {
      L.push(``, `### ${f.file} — ${f.items}항목 · ${f.edits}곳`, ``);
      for (const p of f.preview.slice(0, 20)) {
        if (p.before) L.push(`- L${p.line}: \`${p.before.trim()}\``, `  → \`${p.after.trim()}\``);
        else L.push(`- L${p.line}: ${p.after}`);
      }
      if (f.preview.length > 20) L.push(`- … 외 ${f.preview.length - 20}줄`);
    }
  }
  const manual = r.items.filter((i) => i.action === "manual");
  if (manual.length) {
    L.push(``, `## 남은 수동 항목 (${manual.length})`, ``);
    for (const i of manual.slice(0, 50)) L.push(`- ${i.file}:L${i.line} [${KIND_LABEL[i.kind]}] \`${i.from}\`${i.to ? ` → \`${i.to}\`` : ""} — ${i.reason}`);
    if (manual.length > 50) L.push(`- … 외 ${manual.length - 50}건`);
  }
  L.push(``, `---`, r.dryRun
    ? `적용하려면 dryRun=false 로 다시 호출하세요. 적용 시 원본은 migration-backup/ 에 보관되고, 실패하면 작업 전 상태로 되돌립니다.`
    : `다음 단계: build_egovframe_project(goal="compile") 로 컴파일을 확인하고, 오류가 나면 위 수동 항목부터 처리하세요.`);
  return L.join("\n");
}

// ── 3단계: 검증 (v0.33.0) ─────────────────────────────
export interface VerifyLink { error: BuildError; itemIndex: number | null; how: "same-file-symbol" | "same-file-line" | "rules-symbol" | "unlinked"; note?: string }
export interface VerifyWorkItem { index: number; item: MigrationItem; errors: number }
export interface MigrateVerifyResult extends MigrateResult {
  mode: "verify";
  build: { ran: boolean; success: boolean | null; command?: string; durationMs?: number; errors: number; timedOut?: boolean; reason?: string };
  links: VerifyLink[];
  /** 수동 항목별로 "처리하면 해결될 오류 수" 내림차순 */
  worklist: VerifyWorkItem[];
  unlinked: BuildError[];
}
export interface VerifyOptions extends MigrateOptions { timeoutMs?: number; runner?: Runner; platform?: NodeJS.Platform | string }

const simpleName = (fq: string) => fq.replace(/\.$/, "").split(".").pop() ?? fq;
const normRel = (dir: string, file: string) => {
  const abs = path.isAbsolute(file) ? file : path.join(dir, file);
  return path.relative(dir, abs).split(path.sep).join("/");
};

/** 컴파일 오류 하나를 진단 항목(수동 우선)과 연결한다(순수 함수, 테스트 대상). */
export function linkBuildError(error: BuildError, items: MigrationItem[], rules: MigrationRules, projectDir: string): VerifyLink {
  const file = normRel(projectDir, error.file);
  const text = `${error.message} ${error.symbol ?? ""} ${error.location ?? ""}`;
  const pkgMissing = text.match(/package ([\w.]+) does not exist/)?.[1] ?? null;
  const symbolName = error.symbol?.match(/(?:class|interface|variable|method|enum)\s+([\w$]+)/)?.[1] ?? null;
  const locationPkg = error.location?.match(/package ([\w.]+)/)?.[1] ?? null;
  const candidates = items.map((it, index) => ({ it, index })).filter(({ it }) => it.file === file);
  const manualFirst = [...candidates].sort((a, b) => (a.it.action === "manual" ? 0 : 1) - (b.it.action === "manual" ? 0 : 1));
  // 1) 같은 파일 + 심볼 일치: 항목 from 의 단순명/패키지가 오류의 symbol·package·location 과 맞음
  for (const { it, index } of manualFirst) {
    const from = it.from.replace(/\.$/, "");
    if (symbolName && simpleName(from) === symbolName) return { error, itemIndex: index, how: "same-file-symbol" };
    if (pkgMissing && (from === pkgMissing || from.startsWith(`${pkgMissing}.`))) return { error, itemIndex: index, how: "same-file-symbol" };
    if (locationPkg && from.startsWith(`${locationPkg}.`) && symbolName && from.endsWith(`.${symbolName}`)) return { error, itemIndex: index, how: "same-file-symbol" };
  }
  // 2) 같은 파일 + 라인 근접(±3) 의 수동 항목
  const near = manualFirst.find(({ it }) => it.action === "manual" && Math.abs(it.line - error.line) <= 3);
  if (near) return { error, itemIndex: near.index, how: "same-file-line" };
  // 3) 규칙 카탈로그의 제거 클래스·모듈·네임스페이스 심볼 — 다른 파일(예: 상속한 부모)에 항목이 있을 수 있음
  const ix = index(rules);
  if (symbolName) {
    for (const r of rules.packages.removed) if (simpleName(r.class) === symbolName) return { error, itemIndex: null, how: "rules-symbol", note: `${r.class} — ${r.reason}` };
    for (const r of rules.packages.components?.removed ?? []) if (simpleName(r.class) === symbolName) return { error, itemIndex: null, how: "rules-symbol", note: `${r.class} — ${r.reason}` };
  }
  if (pkgMissing && (pkgMissing.startsWith(rules.packages.prefix.from) || pkgMissing.startsWith("javax."))) {
    return { error, itemIndex: null, how: "rules-symbol", note: `패키지 ${pkgMissing} 는 5.x 에 없음 — 2단계 적용이 끝났는지 확인(${pkgMissing.startsWith("javax.") ? "jakarta" : rules.packages.prefix.to}*)` };
  }
  void ix;
  return { error, itemIndex: null, how: "unlinked" };
}

/** 진단 → 컴파일 → 오류를 수동 항목과 연결한 작업 목록. 파일을 쓰지 않는다(빌드 산출물 target/·build/ 는 빌드 도구가 만든다). */
export async function verifyMigration(opts: VerifyOptions): Promise<MigrateVerifyResult> {
  const rules = loadMigrationRules();
  const r = migrateProject(opts);
  const dir = r.projectDir;
  const base = { ...r, mode: "verify" as const };
  if (!detectBuildToolAt(dir)) {
    return { ...base, build: { ran: false, success: null, errors: 0, reason: "빌드 파일(pom.xml·build.gradle)이 없어 컴파일 검증을 건너뜀" }, links: [], worklist: [], unlinked: [] };
  }
  const b = await runBuild({ projectDir: dir, goal: "compile", timeoutMs: opts.timeoutMs ?? 300_000, runner: opts.runner, platform: opts.platform });
  const errors = b.errors ?? [];
  const links = errors.map((e) => linkBuildError(e, r.items, rules, dir));
  const counts = new Map<number, number>();
  for (const l of links) if (l.itemIndex !== null) counts.set(l.itemIndex, (counts.get(l.itemIndex) ?? 0) + 1);
  const worklist: VerifyWorkItem[] = [...counts].map(([index, n]) => ({ index, item: r.items[index], errors: n })).sort((a, b) => b.errors - a.errors || a.item.file.localeCompare(b.item.file) || a.item.line - b.item.line);
  // 오류와 연결되지 않은 수동 항목도 뒤에 붙인다(0건) — 작업 목록은 수동 항목 전체를 덮는다
  r.items.forEach((it, index) => { if (it.action === "manual" && !counts.has(index)) worklist.push({ index, item: it, errors: 0 }); });
  const unlinked = links.filter((l) => l.how === "unlinked").map((l) => l.error);
  return {
    ...base,
    build: { ran: true, success: b.success ?? null, command: b.command, durationMs: b.durationMs, errors: errors.length, timedOut: b.timedOut },
    links, worklist, unlinked,
  };
}

/** 검증 결과를 Markdown 으로 렌더링한다. */
export function renderMigrationVerifyMarkdown(r: MigrateVerifyResult): string {
  const L: string[] = [];
  L.push(`# 표준프레임워크 5.x 전환 검증`, ``);
  L.push(`- 경로: ${r.projectDir}`);
  L.push(`- 진단: 항목 ${r.items.length}건 (자동 ${r.summary.auto} · 수동 ${r.summary.manual})${r.summary.auto > 0 ? " — ⚠️ 자동 항목이 남아 있습니다. 먼저 apply=true, dryRun=false 로 적용하세요." : ""}`);
  if (!r.build.ran) L.push(`- 컴파일: 건너뜀 — ${r.build.reason}`);
  else L.push(`- 컴파일: ${r.build.success ? "✅ 통과" : `❌ 오류 ${r.build.errors}건`}${r.build.timedOut ? " (타임아웃)" : ""} · \`${r.build.command}\` · ${r.build.durationMs ?? 0}ms`);
  const linked = r.links.filter((l) => l.itemIndex !== null).length;
  const byRules = r.links.filter((l) => l.how === "rules-symbol").length;
  if (r.build.ran && r.build.errors > 0) L.push(`- 연결: 수동 항목과 연결 ${linked} · 규칙 심볼로 설명 ${byRules} · 분류 불가 ${r.unlinked.length}`);
  for (const n of r.notes) L.push(`- ${n}`);
  const withErrors = r.worklist.filter((w) => w.errors > 0);
  if (withErrors.length) {
    L.push(``, `## 작업 목록 (오류 해결 수 순)`, ``);
    for (const w of withErrors) L.push(`- **${w.errors}건** ${w.item.file}:L${w.item.line} [${KIND_LABEL[w.item.kind]}] \`${w.item.from}\`${w.item.to ? ` → \`${w.item.to}\`` : ""}`, `  - ${w.item.reason}`);
  }
  const rulesOnly = r.links.filter((l) => l.how === "rules-symbol");
  if (rulesOnly.length) {
    L.push(``, `## 규칙으로 설명되는 오류 (${rulesOnly.length})`, ``);
    for (const l of rulesOnly.slice(0, 30)) L.push(`- ${normRel(r.projectDir, l.error.file)}:L${l.error.line} ${l.error.message}${l.error.symbol ? ` (${l.error.symbol})` : ""} — ${l.note}`);
  }
  if (r.unlinked.length) {
    L.push(``, `## 분류되지 않은 오류 (${r.unlinked.length})`, ``);
    for (const e of r.unlinked.slice(0, 30)) L.push(`- ${normRel(r.projectDir, e.file)}:L${e.line} ${e.message}${e.symbol ? ` (${e.symbol})` : ""}`);
    L.push(``, `전환 규칙과 무관한 오류일 수 있습니다(라이브러리 API 변경, 기존 결함). build_egovframe_project 의 로그를 함께 보세요.`);
  }
  const rest = r.worklist.filter((w) => w.errors === 0);
  if (rest.length) {
    L.push(``, `## 컴파일 오류와 연결되지 않은 수동 항목 (${rest.length})`, ``);
    for (const w of rest.slice(0, 40)) L.push(`- ${w.item.file}:L${w.item.line} [${KIND_LABEL[w.item.kind]}] \`${w.item.from}\``);
    if (rest.length > 40) L.push(`- … 외 ${rest.length - 40}건`);
  }
  if (r.build.ran && r.build.success && r.summary.manual === 0) L.push(``, `전환이 끝났습니다. test_egovframe_project 로 테스트까지 확인하세요.`);
  return L.join("\n");
}
