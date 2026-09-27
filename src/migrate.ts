// 3.x/4.x → 5.x 전환 진단 (migrate_egovframe_project, v0.29 — 1단계, 읽기 전용).
// 규칙은 catalog/migration-rules.json(scripts/generate-migration-rules.mjs 가 egovframe-runtime 태그 비교로 생성)에서 읽는다.
// 이 모듈은 파일을 쓰지 않는다. 항목마다 {file, line, kind, from, to, action, reason} 을 돌려주고,
// action="auto" 는 2단계(v0.30) 에서 기계적으로 치환할 수 있는 것, "manual" 은 사람이 코드를 고쳐야 하는 것이다.
import * as fs from "node:fs";
import * as path from "node:path";
import { diagnoseProject } from "./diagnose.js";

// ── 규칙 ──────────────────────────────────────────────
export interface MigrationCoordinate { module: string; layer: string; from: { groupId: string; artifactId: string; era: string }[]; to: { groupId: string; artifactId: string } }
export interface MigrationRules {
  schemaVersion: number;
  surveyedAt: string;
  source: { repository: string; fromTag: string; midTag: string; toTag: string; fromCommit: string; toCommit: string };
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
  };
  jakarta: {
    packages: { from: string; to: string; exclude?: string[] }[];
    artifacts: { from: { groupId: string; artifactId: string }; to: { groupId: string; artifactId: string }; toVersion: string; scope?: string; also?: { groupId: string; artifactId: string; version: string }; note?: string }[];
  };
  libraries: { match: { groupId: string; artifactId: string; versionBelow?: string }; replacement: string | null; reason: string }[];
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
  | "jakarta-package" | "web-xml" | "xml-namespace";
export interface MigrationItem { file: string; line: number; kind: MigrationKind; from: string; to: string | null; action: MigrationAction; reason: string }
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
export interface MigrateOptions { projectDir: string; target?: "5.x"; maxFiles?: number }

// ── 유틸 ──────────────────────────────────────────────
const SKIP_DIRS = new Set([".git", ".svn", ".hg", "target", "build", "node_modules", ".idea", ".settings", ".gradle", "bin", "out", "dist", ".mvn"]);
const TEXT_EXT = new Set([".java", ".xml", ".jsp", ".jspx", ".jspf", ".tag", ".tagx", ".gradle", ".kts", ".properties", ".yml", ".yaml"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

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

const lineAt = (text: string, offset: number): number => { let n = 1; for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };
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
const JAVAX_TOKEN_RE = /\bjavax(?:\.[a-z_][a-z0-9_]*)+/g;

function scanTextLines(rel: string, text: string, rules: MigrationRules, push: (i: MigrationItem) => void, opts: { rte: boolean; javax: boolean }) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const seen = new Set<string>();
    if (opts.rte && (line.includes("egovframework.rte") || line.includes("org.egovframe.rte"))) {
      for (const m of line.matchAll(RTE_TOKEN_RE)) {
        const c = classifyRteToken(m[0], rules);
        if (!c || seen.has(c.from)) continue;
        seen.add(c.from);
        push({ file: rel, line: i + 1, ...c });
      }
    }
    if (opts.javax && line.includes("javax.")) {
      for (const m of line.matchAll(JAVAX_TOKEN_RE)) {
        const to = classifyJavaxPackage(m[0], rules);
        if (!to || seen.has(m[0])) continue;
        seen.add(m[0]);
        push({ file: rel, line: i + 1, kind: "jakarta-package", from: m[0], to, action: "auto", reason: "Jakarta EE 9+ 패키지 이름 변경(Spring 6)" });
      }
    }
  }
}

function scanWebXml(rel: string, text: string, rules: MigrationRules, push: (i: MigrationItem) => void) {
  const w = rules.target.webXml;
  const open = text.match(/<web-app\b[^>]*>/);
  if (!open) return;
  const line = lineAt(text, open.index ?? 0);
  const ns = open[0].match(/\sxmlns="([^"]+)"/)?.[1];
  const ver = open[0].match(/\sversion="([^"]+)"/)?.[1];
  if (ns && w.legacyNamespaces.includes(ns))
    push({ file: rel, line, kind: "web-xml", from: `xmlns="${ns}"${ver ? ` version="${ver}"` : ""}`, to: `xmlns="${w.namespace}" version="${w.version}" (schemaLocation: ${w.schemaLocation})`, action: "auto", reason: "Servlet 5.0+(Jakarta) web.xml 스키마" });
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

interface PomDep { groupId: string; artifactId: string; version: string | null; line: number; scope: string | null }
function parsePomProperties(text: string): Map<string, string> {
  const props = new Map<string, string>();
  const block = text.match(/<properties>([\s\S]*?)<\/properties>/);
  if (block) for (const m of block[1].matchAll(/<([\w.\-]+)>\s*([^<]*?)\s*<\/\1>/g)) props.set(m[1], m[2]);
  return props;
}
function resolveProp(v: string | null, props: Map<string, string>): string | null {
  if (v == null) return null;
  let out = v;
  for (let i = 0; i < 5 && /\$\{[\w.\-]+\}/.test(out); i++) out = out.replace(/\$\{([\w.\-]+)\}/g, (_, k) => props.get(k) ?? `\${${k}}`);
  return out;
}
function parsePomDeps(text: string): PomDep[] {
  const deps: PomDep[] = [];
  for (const m of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const body = m[1];
    const g = body.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1];
    const aM = body.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/);
    if (!g || !aM) continue;
    deps.push({
      groupId: g, artifactId: aM[1],
      version: body.match(/<version>\s*([^<\s]+)\s*<\/version>/)?.[1] ?? null,
      scope: body.match(/<scope>\s*([^<\s]+)\s*<\/scope>/)?.[1] ?? null,
      line: lineAt(text, (m.index ?? 0) + (aM.index ?? 0)),
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
  for (const key of t.versionProperties.legacy) {
    const m = text.match(new RegExp(`<${escapeRe(key)}>\\s*([^<\\s]+)\\s*</${escapeRe(key)}>`));
    if (!m) continue;
    const below = versionBelow(m[1], t.runtimeVersion);
    if (below === false) continue;
    push({
      file: rel, line: lineAt(text, m.index ?? 0), kind: "rte-version", from: `<${key}>${m[1]}</${key}>`,
      to: `<org.egovframe.rte.version>${t.runtimeVersion}</org.egovframe.rte.version> (또는 parent 관리)`, action: "auto",
      reason: t.versionProperties.note,
    });
  }

  // 저장소 URL
  for (const url of t.legacyRepositoryUrls) {
    const re = new RegExp(`<url>\\s*${escapeRe(url)}\\s*</url>`, "g");
    for (const m of text.matchAll(re))
      push({ file: rel, line: lineAt(text, m.index ?? 0), kind: "repository", from: url, to: t.repositoryUrl, action: "auto", reason: "표준프레임워크 Maven 저장소는 HTTPS 주소만 유효" });
  }

  // Java 릴리스
  for (const key of rules.build.javaProperties) {
    const m = text.match(new RegExp(`<${escapeRe(key)}>\\s*([^<\\s]+)\\s*</${escapeRe(key)}>`));
    if (!m) continue;
    const v = resolveProp(m[1], props) ?? m[1];
    const num = v.startsWith("1.") ? Number(v.slice(2)) : Number.parseInt(v, 10);
    if (Number.isFinite(num) && num < rules.build.javaRelease)
      push({ file: rel, line: lineAt(text, m.index ?? 0), kind: "java-release", from: `<${key}>${m[1]}</${key}>`, to: `${rules.build.javaRelease}`, action: "auto", reason: `5.x(Spring 6) 는 Java ${rules.build.javaRelease} 이상` });
  }
  for (const m of text.matchAll(/<(source|target|release)>\s*([^<\s]+)\s*<\/\1>/g)) {
    const v = resolveProp(m[2], props) ?? m[2];
    const num = v.startsWith("1.") ? Number(v.slice(2)) : Number.parseInt(v, 10);
    if (Number.isFinite(num) && num < rules.build.javaRelease && /maven-compiler-plugin/.test(text))
      push({ file: rel, line: lineAt(text, m.index ?? 0), kind: "java-release", from: `<${m[1]}>${m[2]}</${m[1]}>`, to: `<release>${rules.build.javaRelease}</release>`, action: "auto", reason: `5.x(Spring 6) 는 Java ${rules.build.javaRelease} 이상` });
  }

  // Spring 버전 속성
  for (const key of rules.build.springVersionProperties) {
    const m = text.match(new RegExp(`<${escapeRe(key)}>\\s*([^<\\s]+)\\s*</${escapeRe(key)}>`));
    if (!m) continue;
    if (versionBelow(m[1], rules.build.springMinimum) === true)
      push({ file: rel, line: lineAt(text, m.index ?? 0), kind: "spring-version", from: `<${key}>${m[1]}</${key}>`, to: `${rules.build.springMinimum} 이상 (5.x parent 가 관리)`, action: "manual", reason: "Spring 6 로 올리면 javax→jakarta 와 함께 제거된 API(WebSecurityConfigurerAdapter, CommonsMultipartResolver 등) 대응이 필요" });
  }

  // 의존성
  for (const d of parsePomDeps(text)) {
    const key = `${d.groupId}:${d.artifactId}`;
    const ver = resolveProp(d.version, props);
    const verText = d.version ? `:${d.version}` : "";

    const coord = ix.coordByFrom.get(key);
    if (coord) {
      ctx.hasRte = true;
      const era = coord.from.find((f) => `${f.groupId}:${f.artifactId}` === key)?.era as SourceEra | undefined;
      if (era) ctx.eras.add(era);
      push({ file: rel, line: d.line, kind: "coordinate", from: `${key}${verText}`, to: `${coord.to.groupId}:${coord.to.artifactId}${d.version ? `:${t.runtimeVersion}` : ""}`, action: "auto", reason: `5.x 좌표(${rules.source.toTag} ${coord.layer}/${coord.module})` });
      continue;
    }
    if (ix.toArtifacts.has(key)) {
      ctx.hasRte = true;
      ctx.eras.add("5.x");
      if (ver && versionBelow(ver, t.runtimeVersion) === true)
        push({ file: rel, line: d.line, kind: "rte-version", from: `${key}${verText}`, to: `${key}:${t.runtimeVersion}`, action: "auto", reason: `RTE ${t.runtimeVersion} 기준` });
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
      push({ file: rel, line: d.line, kind: "jakarta-artifact", from: `${key}${verText}`, to: `${jk.to.groupId}:${jk.to.artifactId}:${jk.toVersion}${also}`, action: "auto", reason: jk.note ?? "Jakarta EE 9+ 좌표" });
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
    const coord = ix.coordByFrom.get(key);
    if (coord) {
      ctx.hasRte = true;
      const era = coord.from.find((f) => `${f.groupId}:${f.artifactId}` === key)?.era as SourceEra | undefined;
      if (era) ctx.eras.add(era);
      push({ file: rel, line, kind: "coordinate", from: m[0].slice(1, -1), to: `${coord.to.groupId}:${coord.to.artifactId}:${t.runtimeVersion}`, action: "auto", reason: `5.x 좌표(${rules.source.toTag} ${coord.layer}/${coord.module})` });
      continue;
    }
    if (ix.toArtifacts.has(key)) { ctx.hasRte = true; ctx.eras.add("5.x"); continue; }
    const jk = ix.jakartaArtifacts.get(key);
    if (jk) {
      push({ file: rel, line, kind: "jakarta-artifact", from: m[0].slice(1, -1), to: `${jk.to.groupId}:${jk.to.artifactId}:${jk.toVersion}`, action: "auto", reason: jk.note ?? "Jakarta EE 9+ 좌표" });
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
        push({ file: rel, line, kind: "repository", from: url, to: t.repositoryUrl, action: "auto", reason: "표준프레임워크 Maven 저장소는 HTTPS 주소만 유효" });
      }
      idx = text.indexOf(url, idx + url.length);
    }
  }
  const src = text.match(/sourceCompatibility\s*=?\s*["']?(?:JavaVersion\.VERSION_)?(1_8|1\.8|[0-9]+)/);
  if (src) {
    const num = src[1].startsWith("1") && src[1].length === 3 ? 8 : Number.parseInt(src[1], 10);
    if (Number.isFinite(num) && num < rules.build.javaRelease)
      push({ file: rel, line: lineAt(text, src.index ?? 0), kind: "java-release", from: src[0], to: `${rules.build.javaRelease}`, action: "auto", reason: `5.x(Spring 6) 는 Java ${rules.build.javaRelease} 이상` });
  }
}

function walk(root: string, maxFiles: number): string[] {
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
  const files = walk(dir, maxFiles);
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
