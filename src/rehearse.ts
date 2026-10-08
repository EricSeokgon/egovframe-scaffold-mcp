// 전환 리허설 (rehearse_egovframe_migration, v0.41) — 사용자 프로젝트를 건드리지 않고 사본에서 자동 단계를 전부 돌린 뒤
// 사람이 고칠 것이 실제로 얼마나 남는지 컴파일로 잰다.
//   순서: 사본 → (1) 공통컴포넌트 재조립 → (2) 전환 적용(auto) → (3) 컴파일(오류 실측 A)
//         → (4) pom 맞춤(공식 공통컴포넌트 고정 태그 pom 기준 parent·좌표·버전) → 다시 컴파일(오류 실측 B)
//   재조립을 전환 적용보다 먼저 한다 — 적용이 javax→jakarta 등으로 컴포넌트 소스를 바꾸면 원본 태그 지문이 깨져
//   (실측: 공식 4.3.2 트리가 v5.0.1 로 오인되고 1,489개 파일이 "사용자 수정"이 됨) 재조립이 의미를 잃는다.
//   javac 는 기본 100개에서 오류 보고를 멈추므로 Maven 은 fork + JDK_JAVAC_OPTIONS=-Xmaxerrs 로 전부 센다.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { loadCatalog } from "./catalog.js";
import { defaultCacheDir, type OriginSource } from "./component-origin.js";
import { downloadComponentsZip } from "./components.js";
import { detectBuildToolAt, runBuild, type BuildError, type BuildTool, type Runner } from "./build-runner.js";
import { applyMigration, applyTextEdits, linkBuildError, loadMigrationRules, migrateProject, parsePomDeps, parsePomProperties, type MigrationItem, type PomDep, type TextEdit } from "./migrate.js";
import { reassembleComponents, unifiedPatch } from "./reassemble.js";

export type RehearsalStep = "reassemble" | "migrate" | "verify" | "align-pom";
export const REHEARSAL_STEPS: RehearsalStep[] = ["reassemble", "migrate", "verify", "align-pom"];
const COPY_SKIP = new Set([".git", ".svn", ".hg", "target", "build", "node_modules", ".gradle", ".idea", "migration-backup", "upgrade-backup", "remove-backup"]);
export const JAVAC_MAX_ERRORS = 100_000;

// ── 사본 ─────────────────────────────────────────────────
export interface TreeFingerprint { files: number; bytes: number; sha256: string }
/** 경로·크기·mtime 으로 만든 디렉터리 지문(내용은 읽지 않음, 빌드 산출물·백업 디렉터리 제외). */
export function fingerprintTree(root: string): TreeFingerprint {
  const rows: string[] = [];
  let bytes = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (COPY_SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { const st = fs.statSync(p); bytes += st.size; rows.push(`${path.relative(root, p).split(path.sep).join("/")}\t${st.size}\t${Math.trunc(st.mtimeMs)}`); }
    }
  };
  walk(root);
  return { files: rows.length, bytes, sha256: createHash("sha256").update(rows.join("\n")).digest("hex") };
}
/** 프로젝트를 작업 디렉터리로 복사한다(빌드 산출물·VCS·백업 제외, symlink 는 링크 그대로). */
export function copyProject(src: string, dest: string): { files: number; bytes: number } {
  let files = 0, bytes = 0;
  fs.cpSync(src, dest, {
    recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false,
    filter: (from) => {
      if (COPY_SKIP.has(path.basename(from)) && from !== src) return false;
      try { const st = fs.lstatSync(from); if (st.isFile()) { files++; bytes += st.size; } } catch { /* 경쟁 상태 무시 */ }
      return true;
    },
  });
  return { files, bytes };
}

// ── pom 맞춤 ─────────────────────────────────────────────
const spansOf = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
/** 주 `<dependencies>` 의 의존성만(주석·dependencyManagement·build(plugin)·profiles 안 제외). */
export function mainDependencies(text: string): PomDep[] {
  const excluded = [
    ...spansOf(text, /<!--[\s\S]*?-->/g),
    ...spansOf(text, /<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g),
    ...spansOf(text, /<build>[\s\S]*?<\/build>/g),
    ...spansOf(text, /<profiles>[\s\S]*?<\/profiles>/g),
  ];
  return parsePomDeps(text).filter((d) => !excluded.some((x) => d.block.start >= x.start && d.block.start < x.end));
}
const mainDependenciesClose = (text: string): number | null => {
  const excluded = [...spansOf(text, /<!--[\s\S]*?-->/g), ...spansOf(text, /<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g), ...spansOf(text, /<build>[\s\S]*?<\/build>/g), ...spansOf(text, /<profiles>[\s\S]*?<\/profiles>/g)];
  const closes = [...text.matchAll(/<\/dependencies>/g)].map((m) => m.index ?? 0).filter((i) => !excluded.some((x) => i >= x.start && i < x.end));
  return closes.length ? closes[0] : null;
};
const topLevelProperties = (text: string): { start: number; end: number; inner: number } | null => {
  const excluded = [...spansOf(text, /<!--[\s\S]*?-->/g), ...spansOf(text, /<profiles>[\s\S]*?<\/profiles>/g), ...spansOf(text, /<build>[\s\S]*?<\/build>/g)];
  for (const m of text.matchAll(/<properties>([\s\S]*?)<\/properties>/g)) {
    const s = m.index ?? 0;
    if (!excluded.some((x) => s >= x.start && s < x.end)) return { start: s, end: s + m[0].length, inner: s + "<properties>".length };
  }
  return null;
};
const parentOf = (text: string) => {
  const m = text.match(/<parent>([\s\S]*?)<\/parent>/);
  if (!m) return null;
  const g = m[1].match(/<groupId>\s*([^<\s]+)/)?.[1] ?? "", a = m[1].match(/<artifactId>\s*([^<\s]+)/)?.[1] ?? "", v = m[1].match(/<version>\s*([^<\s]+)/)?.[1] ?? "";
  return { groupId: g, artifactId: a, version: v, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] };
};
const usedProps = (v: string | null) => [...(v ?? "").matchAll(/\$\{([\w.\-]+)\}/g)].map((m) => m[1]);

export interface PomAlignment {
  text: string;
  parent: string | null;
  added: string[];
  versionsChanged: string[];
  scopesChanged: string[];
  propertiesSet: string[];
  propertiesRemoved: string[];
}
/**
 * 프로젝트 pom 을 기준 pom(공식 공통컴포넌트 고정 태그)에 맞춘다 — 리허설 사본 전용(순수 함수).
 * parent 를 기준 parent 로, 기준의 주 의존성 중 프로젝트에 없는 것(test 제외)은 추가, 있는 것은 버전 표기를 기준과 같게
 * (기준에 버전이 없으면 parent 관리에 맡기도록 프로젝트 쪽 <version> 제거), 기준 의존성이 parent 의 속성을 쓰는데
 * 프로젝트가 같은 속성을 직접 정의하고 있으면(예: spring 5.3.37) 그 정의를 지워 parent 값이 쓰이게 한다.
 */
export function alignPomToReference(project: string, reference: string): PomAlignment {
  const edits: TextEdit[] = [];
  const out: Omit<PomAlignment, "text"> = { parent: null, added: [], versionsChanged: [], scopesChanged: [], propertiesSet: [], propertiesRemoved: [] };
  const refParent = parentOf(reference);
  const prjParent = parentOf(project);
  if (refParent && (!prjParent || prjParent.groupId !== refParent.groupId || prjParent.artifactId !== refParent.artifactId || prjParent.version !== refParent.version)) {
    const block = refParent.text.replace(/\r?\n[ \t]*/g, "\n\t\t").replace(/\n\t\t<\/parent>$/, "\n\t</parent>");
    if (prjParent) edits.push({ start: prjParent.start, end: prjParent.end, replacement: block });
    else {
      const mv = project.match(/<modelVersion>[^<]*<\/modelVersion>/);
      const at = mv ? (mv.index ?? 0) + mv[0].length : (project.indexOf(">", project.indexOf("<project")) + 1);
      edits.push({ start: at, end: at, replacement: `\n\t${block}` });
    }
    out.parent = `${refParent.groupId}:${refParent.artifactId}:${refParent.version}${prjParent ? ` (기존 ${prjParent.groupId}:${prjParent.artifactId}:${prjParent.version} 교체)` : " (추가)"}`;
  }
  const refProps = parsePomProperties(reference);
  const prjPropsBlock = topLevelProperties(project);
  const prjProps = prjPropsBlock ? parsePomProperties(project.slice(prjPropsBlock.start, prjPropsBlock.end)) : new Map<string, string>();
  const refDeps = mainDependencies(reference).filter((d) => d.scope !== "test");
  const prjDeps = mainDependencies(project);
  const key = (d: { groupId: string; artifactId: string }) => `${d.groupId}:${d.artifactId}`;
  const prjByKey = new Map(prjDeps.map((d) => [key(d), d] as const));
  // 속성: 기준 의존성이 쓰는 속성
  const props = new Set(refDeps.flatMap((d) => usedProps(d.version)));
  const propEdits: TextEdit[] = [];
  const toInsert: string[] = [];
  for (const p of [...props].sort()) {
    const has = prjProps.has(p);
    if (refProps.has(p)) {
      if (has && prjProps.get(p) === refProps.get(p)) continue;
      if (has && prjPropsBlock) {
        const m = project.slice(prjPropsBlock.start, prjPropsBlock.end).match(new RegExp(`<${p.replace(/[.\-]/g, "\\$&")}>[^<]*</${p.replace(/[.\-]/g, "\\$&")}>`));
        if (m) propEdits.push({ start: prjPropsBlock.start + (m.index ?? 0), end: prjPropsBlock.start + (m.index ?? 0) + m[0].length, replacement: `<${p}>${refProps.get(p)}</${p}>` });
      } else toInsert.push(`<${p}>${refProps.get(p)}</${p}>`);
      out.propertiesSet.push(`${p}=${refProps.get(p)}`);
    } else if (has && prjPropsBlock) {
      // parent 가 정의하는 속성을 프로젝트가 덮어쓰고 있음 → 정의 삭제
      const re = new RegExp(`[ \\t]*<${p.replace(/[.\-]/g, "\\$&")}>[^<]*</${p.replace(/[.\-]/g, "\\$&")}>[ \\t]*\\r?\\n?`);
      const m = project.slice(prjPropsBlock.start, prjPropsBlock.end).match(re);
      if (m) { propEdits.push({ start: prjPropsBlock.start + (m.index ?? 0), end: prjPropsBlock.start + (m.index ?? 0) + m[0].length, replacement: "" }); out.propertiesRemoved.push(`${p}=${prjProps.get(p)}`); }
    }
  }
  if (toInsert.length) {
    if (prjPropsBlock) propEdits.push({ start: prjPropsBlock.inner, end: prjPropsBlock.inner, replacement: toInsert.map((x) => `\n\t\t${x}`).join("") });
    else {
      const anchor = parentOf(project)?.end ?? (project.match(/<modelVersion>[^<]*<\/modelVersion>/)?.index ?? 0);
      propEdits.push({ start: anchor, end: anchor, replacement: `\n\t<properties>${toInsert.map((x) => `\n\t\t${x}`).join("")}\n\t</properties>` });
    }
  }
  edits.push(...propEdits);
  // 의존성
  const additions: string[] = [];
  for (const r of refDeps) {
    const d = prjByKey.get(key(r));
    if (!d) {
      additions.push(reference.slice(r.block.start, r.block.end).replace(/\r?\n[ \t]*/g, "\n\t\t\t").replace(/\n\t\t\t<\/dependency>$/, "\n\t\t</dependency>"));
      out.added.push(`${key(r)}${r.version ? `:${r.version}` : ""}`);
      continue;
    }
    // scope: 기준과 다르면 기준에 맞춤(예: 전환 적용이 test 범위로 남긴 jakarta.annotation-api 가 기준에서는 compile)
    if ((d.scope ?? null) !== (r.scope ?? null)) {
      const body = project.slice(d.block.start, d.block.end);
      const sm = body.match(/[ \t]*<scope>[^<]*<\/scope>[ \t]*\r?\n?/);
      if (sm && !r.scope) edits.push({ start: d.block.start + (sm.index ?? 0), end: d.block.start + (sm.index ?? 0) + sm[0].length, replacement: "" });
      else if (sm && r.scope) { const inner = body.match(/<scope>[^<]*<\/scope>/)!; edits.push({ start: d.block.start + (inner.index ?? 0), end: d.block.start + (inner.index ?? 0) + inner[0].length, replacement: `<scope>${r.scope}</scope>` }); }
      else if (r.scope) edits.push({ start: d.aSpan.end + "</artifactId>".length, end: d.aSpan.end + "</artifactId>".length, replacement: `\n${d.indent}\t<scope>${r.scope}</scope>` });
      out.scopesChanged.push(`${key(r)}: ${d.scope ?? "compile"} → ${r.scope ?? "compile"}`);
    }
    if ((d.version ?? null) === (r.version ?? null)) continue;
    if (r.version && d.vSpan) edits.push({ start: d.vSpan.start, end: d.vSpan.end, replacement: r.version });
    else if (r.version && !d.vSpan) edits.push({ start: d.aSpan.end + "</artifactId>".length, end: d.aSpan.end + "</artifactId>".length, replacement: `\n${d.indent}\t<version>${r.version}</version>` });
    else if (!r.version && d.vSpan) {
      const body = project.slice(d.block.start, d.block.end);
      const m = body.match(/[ \t]*<version>[^<]*<\/version>[ \t]*\r?\n?/);
      if (m) edits.push({ start: d.block.start + (m.index ?? 0), end: d.block.start + (m.index ?? 0) + m[0].length, replacement: "" });
    }
    out.versionsChanged.push(`${key(r)}: ${d.version ?? "(없음)"} → ${r.version ?? "(parent 관리)"}`);
  }
  if (additions.length) {
    const close = mainDependenciesClose(project);
    const block = `\t<!-- egovframe-scaffold-mcp 리허설: 공식 공통컴포넌트 기준 pom 에서 추가 -->\n\t\t${additions.join("\n\t\t")}\n\t`;
    if (close !== null) edits.push({ start: close, end: close, replacement: block });
    else { const end = project.lastIndexOf("</project>"); edits.push({ start: end, end, replacement: `\t<dependencies>\n\t${block}</dependencies>\n` }); }
  }
  const r = applyTextEdits(project, edits);
  return { text: r.text, ...out };
}

// ── 오류 분석 ─────────────────────────────────────────────
export interface MissingPackageGroup { package: string; direct: number; cascade: number; errors: number; files: number; hint: string | null }
export interface ErrorAnalysis {
  errors: number;
  files: number;
  /** "package X does not exist" */
  missingPackage: number;
  /** 누락 패키지가 있는 파일의 다른 오류(cannot find symbol 등) — 대부분 같은 원인의 연쇄 */
  cascade: number;
  other: number;
  missingPackages: MissingPackageGroup[];
  byDirectory: { dir: string; errors: number }[];
  /** 누락 패키지 밖 오류를 전환 수동 항목·규칙과 연결한 결과 */
  linked: { manual: number; rules: number; unlinked: number };
  /** 오류가 javac 상한에 닿았을 수 있음(Gradle 등 fork 설정을 못 한 경우) */
  capped: boolean;
  /** 누락 패키지·연쇄 밖 오류(코드 작업)가 많은 파일 */
  topFiles: { file: string; errors: number; sample: string }[];
}
/**
 * 오류가 "패키지(또는 그 안의 타입)를 찾지 못함" 이면 그 패키지.
 * JDK 21 javac 는 없는 패키지의 import 를 "package X does not exist" 로, JDK 17 은 같은 상황의 상당수를
 * "cannot find symbol / location: package X" 로 보고한다(실측: 같은 트리에서 514 대 184) — 둘 다 같은 원인으로 센다.
 */
export function missingPackageOf(e: BuildError): string | null {
  const direct = e.message.match(/package ([\w.]+) does not exist/)?.[1];
  if (direct) return direct;
  if (/^cannot find symbol/.test(e.message)) return e.symbol?.match(/^package ([\w.]+)$/)?.[1] ?? e.location?.match(/^package ([\w.]+)$/)?.[1] ?? null;
  return null;
}
/** 누락 패키지 → 기준 pom 좌표 추정(groupId 가 패키지 접두어인 것 중 artifactId 토큰이 가장 많이 겹치는 것). */
export function packageHint(pkg: string, reference: PomDep[]): string | null {
  if (pkg.startsWith("lombok ")) return "다른 컴파일 오류로 Lombok 이 getter·setter·log 를 만들지 못함 — 누락 의존성을 풀면 함께 사라짐";
  if (pkg.startsWith("jakarta.")) {
    const j = reference.find((d) => d.groupId.startsWith("jakarta.") && pkg.startsWith(d.groupId)) ?? null;
    return j ? `${j.groupId}:${j.artifactId}` : "Jakarta EE API — 5.x parent(egovframe-web-config-parent)가 관리";
  }
  const segs = pkg.split(".");
  let best: { d: PomDep; score: number } | null = null;
  for (const d of reference) {
    if (!(pkg === d.groupId || pkg.startsWith(`${d.groupId}.`) || d.groupId.startsWith(`${segs.slice(0, 2).join(".")}`))) continue;
    const toks = d.artifactId.toLowerCase().split(/[-_.]/);
    const score = (pkg.startsWith(d.groupId) ? 10 + d.groupId.length : 0) + toks.filter((t) => t.length > 2 && segs.some((s) => s.toLowerCase().includes(t))).length * 3;
    if (!best || score > best.score) best = { d, score };
  }
  return best && best.score > 0 ? `${best.d.groupId}:${best.d.artifactId}${best.d.version && !best.d.version.includes("${") ? `:${best.d.version}` : ""}` : null;
}
export function analyzeErrors(errors: BuildError[], workspace: string, items: MigrationItem[], reference: PomDep[], capped: boolean): ErrorAnalysis {
  const rules = loadMigrationRules();
  const rel = (f: string) => { const abs = path.isAbsolute(f) ? f : path.join(workspace, f); return path.relative(workspace, abs).split(path.sep).join("/"); };
  // JDK 17 은 없는 패키지를 import 한 파일 대부분에서 "package does not exist" 대신 쓰는 곳마다 "cannot find symbol / class X" 를 낸다
  // — 그 파일의 import 문으로 X 의 패키지를 찾아 누락 패키지로 센다.
  const importCache = new Map<string, Map<string, string>>();
  const importsOf = (abs: string) => {
    if (!importCache.has(abs)) {
      const m = new Map<string, string>();
      try { for (const x of fs.readFileSync(abs, "utf8").matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)\.(\w+)\s*;/gm)) m.set(x[2], x[1]); } catch { /* 읽기 실패 무시 */ }
      importCache.set(abs, m);
    }
    return importCache.get(abs)!;
  };
  const absOf = (f: string) => (path.isAbsolute(f) ? f : path.join(workspace, f));
  const missingOf = (e: BuildError): string | null => {
    const p = missingPackageOf(e);
    if (p) return p;
    const cls = /^cannot find symbol/.test(e.message) ? e.symbol?.match(/^(?:class|interface|enum|annotation)\s+(\w+)/)?.[1] : undefined;
    if (!cls) return null;
    const pkg = importsOf(absOf(e.file)).get(cls);
    return pkg && !pkg.startsWith("java.") && !pkg.startsWith("javax.") ? pkg : null;
  };
  const missingIn = new Map<string, { pkg: string; line: number }[]>();
  for (const e of errors) {
    const pkg = missingOf(e);
    if (pkg) { const f = rel(e.file); missingIn.set(f, [...(missingIn.get(f) ?? []), { pkg, line: e.line }]); }
  }
  for (const v of missingIn.values()) v.sort((a, b) => a.line - b.line);
  // 누락 패키지가 있는 파일이 선언한 타입(파일 이름) → 그 파일의 첫 누락 패키지.
  // 다른 파일에서 그 타입의 멤버를 못 찾는 오류(예: Lombok 이 없어 VO 의 getter 가 없음 → 호출부마다 cannot find symbol)도 같은 원인이다.
  const typeToPkg = new Map<string, string>();
  for (const [f, v] of missingIn) typeToPkg.set(path.posix.basename(f).replace(/\.java$/, ""), v[0].pkg);
  const referencedType = (e: BuildError): string | null => {
    const loc = e.location ?? "";
    const t = loc.match(/of type ([\w.$]+)/)?.[1] ?? loc.match(/^(?:class|interface|enum|record) ([\w.$]+)/)?.[1] ?? null;
    return t ? t.split(".").pop()!.split("$")[0] : null;
  };
  // Lombok 이 만드는 멤버(getter/setter/log)를 못 찾는 오류: 다른 컴파일 오류가 있으면 javac 가 annotation processing 을
  // 끝까지 돌리지 않아(JDK 17 에서 두드러짐) Lombok 이 코드를 만들지 못한다 — 누락 의존성이 풀리면 함께 사라지는 연쇄다.
  const javaIndex = new Map<string, string>();
  const walkJava = (dir: string) => { let ents: fs.Dirent[] = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const d of ents) { if (COPY_SKIP.has(d.name)) continue; const p = path.join(dir, d.name); if (d.isDirectory()) walkJava(p); else if (d.name.endsWith(".java") && !javaIndex.has(d.name.slice(0, -5))) javaIndex.set(d.name.slice(0, -5), p); } };
  if (errors.some((e) => /^cannot find symbol/.test(e.message))) walkJava(path.join(workspace, "src"));
  const lombokCache = new Map<string, boolean>();
  const usesLombok = (type: string | null) => {
    if (!type) return false;
    if (!lombokCache.has(type)) { const p = javaIndex.get(type); let v = false; try { v = !!p && /^\s*import\s+lombok\./m.test(fs.readFileSync(p, "utf8")); } catch { v = false; } lombokCache.set(type, v); }
    return lombokCache.get(type)!;
  };
  const LOMBOK = "lombok (annotation processing 중단)";
  const groups = new Map<string, { direct: number; cascade: number; files: Set<string> }>();
  const g = (pkg: string) => { if (!groups.has(pkg)) groups.set(pkg, { direct: 0, cascade: 0, files: new Set() }); return groups.get(pkg)!; };
  let missingPackage = 0, cascade = 0, other = 0;
  const linked = { manual: 0, rules: 0, unlinked: 0 };
  const byDir = new Map<string, number>(), byFile = new Map<string, { n: number; sample: string }>();
  for (const e of errors) {
    const f = rel(e.file);
    const dir = path.posix.dirname(f);
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    const pkg = missingOf(e);
    if (pkg) { missingPackage++; const x = g(pkg); x.direct++; x.files.add(f); continue; }
    const miss = missingIn.get(f);
    if (miss?.length) { cascade++; const x = g(miss[0].pkg); x.cascade++; x.files.add(f); continue; }
    const viaType = /^cannot find symbol/.test(e.message) ? typeToPkg.get(referencedType(e) ?? "") : undefined;
    if (viaType) { cascade++; const x = g(viaType); x.cascade++; x.files.add(f); continue; }
    if (/^cannot find symbol/.test(e.message) && /^(method|variable) /.test(e.symbol ?? "") && (usesLombok(referencedType(e)) || usesLombok(path.posix.basename(f).replace(/\.java$/, "")))) { cascade++; const x = g(LOMBOK); x.cascade++; x.files.add(f); continue; }
    other++;
    const bf = byFile.get(f) ?? { n: 0, sample: e.message };
    bf.n++; byFile.set(f, bf);
    const l = linkBuildError({ ...e, file: path.isAbsolute(e.file) ? e.file : path.join(workspace, e.file) }, items, rules, workspace);
    if (l.itemIndex !== null) linked.manual++; else if (l.how === "rules-symbol") linked.rules++; else linked.unlinked++;
  }
  const missingPackages: MissingPackageGroup[] = [...groups.entries()].map(([pkg, x]) => ({ package: pkg, direct: x.direct, cascade: x.cascade, errors: x.direct + x.cascade, files: x.files.size, hint: packageHint(pkg, reference) }))
    .sort((a, b) => b.errors - a.errors || a.package.localeCompare(b.package));
  return {
    errors: errors.length, files: new Set(errors.map((e) => rel(e.file))).size, missingPackage, cascade, other, missingPackages,
    byDirectory: [...byDir.entries()].map(([dir, n]) => ({ dir, errors: n })).sort((a, b) => b.errors - a.errors || a.dir.localeCompare(b.dir)).slice(0, 10),
    linked, capped,
    topFiles: [...byFile.entries()].map(([file, x]) => ({ file, errors: x.n, sample: x.sample })).sort((a, b) => b.errors - a.errors || a.file.localeCompare(b.file)).slice(0, 15),
  };
}

// ── 도구 ─────────────────────────────────────────────────
export interface RehearseOptions {
  projectDir: string;
  steps?: RehearsalStep[];
  components?: string[];
  sourceTag?: string;
  keepWorkspace?: boolean;
  /** 사본을 만들 곳(기본 EGOVFRAME_CACHE_DIR/rehearsal) — 프로젝트 안이면 거부 */
  workspaceRoot?: string;
  /** 컴파일 1회 타임아웃(기본 900000) */
  timeoutMs?: number;
  topN?: number;
  // 테스트 주입
  origin?: OriginSource;
  readTarget?: (paths: string[]) => Promise<Map<string, Buffer>>;
  referencePom?: () => Promise<string | null>;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  now?: () => number;
}
export interface RehearsalPhase {
  ran: boolean;
  success: boolean | null;
  command?: string;
  durationMs?: number;
  timedOut?: boolean;
  analysis?: ErrorAnalysis;
  reason?: string;
}
export interface RehearsalStepResult { step: RehearsalStep; ran: boolean; ok: boolean; durationMs: number; summary: string; error?: string }
export interface RehearsalWorkItem { kind: "align-pom" | "missing-package" | "manual-item" | "file"; title: string; errors: number; detail: string }
export interface RehearseResult {
  projectDir: string;
  buildTool: BuildTool | null;
  startedAt: string;
  workspace: { path: string | null; kept: boolean; files: number; bytes: number; copyMs: number };
  original: { files: number; bytes: number; sha256: string; unchanged: boolean };
  steps: RehearsalStepResult[];
  reassemble?: { origin: string | null; components: number; actions: Record<string, number>; worklist: number };
  migrate?: { applied: { items: number; edits: number; files: number }; manualRemaining: number; byKind: Record<string, number> };
  /** 자동 단계(재조립·전환 적용) 직후 컴파일 */
  afterAutomation?: RehearsalPhase;
  /** pom 을 기준에 맞춘 뒤 컴파일 — 남는 것이 코드 작업 */
  afterPomAlignment?: RehearsalPhase & { reference?: string; parent?: string | null; added?: string[]; versionsChanged?: string[]; scopesChanged?: string[]; propertiesSet?: string[]; propertiesRemoved?: string[]; patch?: string };
  worklist: RehearsalWorkItem[];
  /** 평가서가 읽는 최근 결과 파일 */
  savedTo?: string;
  notes: string[];
}

/** 프로젝트 경로별 최근 리허설 결과 위치(캐시 디렉터리 — 프로젝트를 건드리지 않는다). */
export function rehearsalRecordPath(projectDir: string, root = path.join(defaultCacheDir(), "rehearsal")): string {
  const h = createHash("sha256").update(path.resolve(projectDir)).digest("hex").slice(0, 16);
  return path.join(root, "records", `${h}.json`);
}
export function readRehearsalRecord(projectDir: string, root?: string): RehearseResult | null {
  try { return JSON.parse(fs.readFileSync(rehearsalRecordPath(projectDir, root), "utf8")) as RehearseResult; } catch { return null; }
}

const isInside = (child: string, parent: string) => { const r = path.relative(parent, child); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };

/** 리허설 실행. 프로젝트는 읽기만 한다(실행 전후 지문 비교로 확인). */
export async function rehearseMigration(opts: RehearseOptions): Promise<RehearseResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const buildTool = detectBuildToolAt(projectDir);
  const steps = new Set(opts.steps ?? REHEARSAL_STEPS);
  for (const s of steps) if (!REHEARSAL_STEPS.includes(s)) throw new Error(`알 수 없는 단계: ${s} (가능: ${REHEARSAL_STEPS.join(", ")})`);
  const now = opts.now ?? Date.now;
  const root = path.resolve(opts.workspaceRoot ?? path.join(defaultCacheDir(), "rehearsal"));
  if (isInside(root, projectDir)) throw new Error(`작업 디렉터리(${root})가 프로젝트 안에 있습니다 — EGOVFRAME_CACHE_DIR 또는 workspaceRoot 를 프로젝트 밖으로 지정하세요`);
  const notes: string[] = [];
  const before = fingerprintTree(projectDir);
  fs.mkdirSync(root, { recursive: true });
  const ws = fs.mkdtempSync(path.join(root, `${path.basename(projectDir).replace(/[^\w.-]/g, "_")}-`));
  const startedAt = new Date(now()).toISOString();
  const result: RehearseResult = {
    projectDir, buildTool, startedAt,
    workspace: { path: ws, kept: !!opts.keepWorkspace, files: 0, bytes: 0, copyMs: 0 },
    original: { files: before.files, bytes: before.bytes, sha256: before.sha256, unchanged: true },
    steps: [], worklist: [], notes,
  };
  const timeoutMs = opts.timeoutMs ?? 900_000;
  // pom 에 소스 인코딩이 없으면 fork 된 javac 가 플랫폼 기본 인코딩(JDK 17 + POSIX 로케일이면 US-ASCII)을 써서
  // 한글 주석이 "unmappable character" 오류로 쏟아진다 — JDK 18+ 의 기본값과 같은 UTF-8 을 지정한다.
  const pomText = buildTool === "maven" ? fs.readFileSync(path.join(projectDir, "pom.xml"), "utf8") : "";
  const noEncoding = buildTool === "maven" && !/<project\.build\.sourceEncoding>/.test(pomText) && !/<encoding>[^<]+<\/encoding>/.test(pomText);
  const compileOpts = buildTool === "maven"
    ? { extraArgs: ["-Dmaven.compiler.fork=true", ...(noEncoding ? ["-Dproject.build.sourceEncoding=UTF-8"] : [])], env: { JDK_JAVAC_OPTIONS: `-Xmaxerrs ${JAVAC_MAX_ERRORS}` } }
    : {};
  if (noEncoding) notes.push("pom 에 소스 인코딩이 없어 컴파일에 -Dproject.build.sourceEncoding=UTF-8 을 줬습니다(JDK 18+ 기본값과 같음). 실제 pom 에도 지정하기를 권합니다.");
  let reference: string | null = null;
  const loadReference = async () => {
    if (reference !== null) return reference;
    try {
      if (opts.referencePom) reference = await opts.referencePom();
      else {
        const { zip } = await downloadComponentsZip(loadCatalog().source);
        const e = zip.getEntries().find((x) => /^[^/]+\/pom\.xml$/.test(x.entryName));
        reference = e ? e.getData().toString("utf8") : null;
      }
    } catch (e) { notes.push(`기준 pom 을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`); reference = null; }
    return reference;
  };
  const step = async (name: RehearsalStep, fn: () => Promise<string>) => {
    const t = now();
    if (!steps.has(name)) { result.steps.push({ step: name, ran: false, ok: true, durationMs: 0, summary: "건너뜀(steps 에 없음)" }); return; }
    try { const summary = await fn(); result.steps.push({ step: name, ran: true, ok: true, durationMs: now() - t, summary }); }
    catch (e) { result.steps.push({ step: name, ran: true, ok: false, durationMs: now() - t, summary: "실패", error: e instanceof Error ? e.message : String(e) }); }
  };
  const compile = async (): Promise<RehearsalPhase> => {
    if (!buildTool) return { ran: false, success: null, reason: "빌드 파일(pom.xml·build.gradle)이 없어 컴파일하지 않음" };
    const b = await runBuild({ projectDir: ws, goal: "compile", timeoutMs, runner: opts.runner, platform: opts.platform, now, ...compileOpts });
    const items = migrateProject({ projectDir: ws }).items;
    const ref = (await loadReference()) ?? "";
    const capped = buildTool !== "maven" && (b.errors?.length ?? 0) === 100;
    return { ran: true, success: b.success ?? null, command: b.command, durationMs: b.durationMs, timedOut: b.timedOut, analysis: analyzeErrors(b.errors ?? [], ws, items, ref ? mainDependencies(ref) : [], capped) };
  };

  try {
    const t0 = now();
    const copied = copyProject(projectDir, ws);
    result.workspace.files = copied.files; result.workspace.bytes = copied.bytes; result.workspace.copyMs = now() - t0;

    await step("reassemble", async () => {
      const r = await reassembleComponents({ projectDir: ws, dryRun: false, components: opts.components, sourceTag: opts.sourceTag, origin: opts.origin, readTarget: opts.readTarget, runner: opts.runner, platform: opts.platform });
      result.reassemble = { origin: r.origin.tag, components: r.components.length, actions: { ...r.actions }, worklist: r.worklist.length };
      return r.components.length ? `원본 ${r.origin.tag ?? "미확인"} → ${r.target.tag}: 컴포넌트 ${r.components.length}종, 교체 ${r.actions.replace}·추가 ${r.actions.add}·삭제 ${r.actions.delete}·유지 ${r.actions.keep}, 작업 목록 ${r.worklist.length}` : "재조립할 공통컴포넌트 없음";
    });
    await step("migrate", async () => {
      const a = await applyMigration({ projectDir: ws, dryRun: false });
      result.migrate = { applied: a.applied, manualRemaining: a.remaining?.manual ?? a.skippedManual, byKind: { ...(a.remaining?.byKind ?? {}) } };
      return `자동 ${a.applied.items}건(파일 ${a.applied.files}) 적용, 수동 ${result.migrate.manualRemaining}건 남음 (${a.sourceEra})`;
    });
    await step("verify", async () => {
      result.afterAutomation = await compile();
      const p = result.afterAutomation;
      return !p.ran ? p.reason! : p.success ? "컴파일 통과" : `컴파일 오류 ${p.analysis!.errors}건(파일 ${p.analysis!.files}) — 누락 패키지 ${p.analysis!.missingPackage} + 연쇄 ${p.analysis!.cascade} + 기타 ${p.analysis!.other}`;
    });
    await step("align-pom", async () => {
      if (buildTool !== "maven") { result.afterPomAlignment = { ran: false, success: null, reason: "pom 맞춤은 Maven 프로젝트만" }; return "건너뜀 — Maven 아님"; }
      const ref = await loadReference();
      if (!ref) { result.afterPomAlignment = { ran: false, success: null, reason: "기준 pom 없음" }; throw new Error("기준 pom(공식 공통컴포넌트 고정 태그 pom.xml)을 읽지 못했습니다"); }
      const pomPath = path.join(ws, "pom.xml");
      const beforePom = fs.readFileSync(pomPath, "utf8");
      const al = alignPomToReference(beforePom, ref);
      fs.writeFileSync(pomPath, al.text);
      const patch = (await unifiedPatch("pom.xml", Buffer.from(beforePom), Buffer.from(al.text))).toString("utf8");
      const lines = patch.split("\n");
      const phase = await compile();
      const cat = loadCatalog().source;
      result.afterPomAlignment = { ...phase, reference: `${cat.repository ?? "eGovFramework/egovframe-common-components"}@${cat.tag ?? "?"} pom.xml`, parent: al.parent, added: al.added, versionsChanged: al.versionsChanged, scopesChanged: al.scopesChanged, propertiesSet: al.propertiesSet, propertiesRemoved: al.propertiesRemoved, patch: lines.length > 400 ? `${lines.slice(0, 400).join("\n")}\n… (${lines.length - 400}줄 생략 — keepWorkspace=true 로 사본의 pom.xml 확인)` : patch };
      return !phase.ran ? phase.reason! : `parent ${al.parent ? "교체/추가" : "유지"}·좌표 추가 ${al.added.length}·버전 ${al.versionsChanged.length}·범위 ${al.scopesChanged.length}·속성 ${al.propertiesSet.length + al.propertiesRemoved.length} → ${phase.success ? "컴파일 통과" : `컴파일 오류 ${phase.analysis!.errors}건(파일 ${phase.analysis!.files})`}`;
    });
  } finally {
    const after = fingerprintTree(projectDir);
    result.original.unchanged = after.sha256 === before.sha256;
    if (!result.original.unchanged) notes.push("⚠️ 리허설 중 원본 프로젝트 지문이 바뀌었습니다 — 리허설 도중 다른 프로세스가 파일을 고쳤을 수 있습니다");
    if (!opts.keepWorkspace) { fs.rmSync(ws, { recursive: true, force: true }); result.workspace.path = null; }
  }

  // 작업 목록: pom 맞춤으로 사라지는 오류 → 남은 누락 패키지 → 수동 항목·파일
  const a = result.afterAutomation?.analysis, b = result.afterPomAlignment?.analysis;
  if (a && b && a.errors > b.errors) {
    const p = result.afterPomAlignment!;
    result.worklist.push({ kind: "align-pom", title: `pom 을 ${p.reference} 기준으로 맞추기`, errors: a.errors - b.errors, detail: `${p.parent ? `parent ${p.parent}, ` : ""}좌표 추가 ${p.added?.length ?? 0}·버전 ${p.versionsChanged?.length ?? 0}·범위 ${p.scopesChanged?.length ?? 0}·속성 정리 ${(p.propertiesSet?.length ?? 0) + (p.propertiesRemoved?.length ?? 0)} — 사본에 적용한 변경은 afterPomAlignment.patch` });
  }
  const last = b ?? a;
  if (last) {
    for (const m of last.missingPackages.slice(0, 10)) result.worklist.push({ kind: "missing-package", title: `패키지 ${m.package} 없음`, errors: m.errors, detail: `직접 ${m.direct} + 같은 파일 연쇄 ${m.cascade}, 파일 ${m.files}${m.hint ? ` — 후보 좌표 ${m.hint}` : " — 5.x 대응 라이브러리 확인(벤더 jar 이면 system scope·사내 저장소)"}` });
    for (const f of last.topFiles) {
      if (result.worklist.length >= (opts.topN ?? 20)) break;
      result.worklist.push({ kind: "file", title: f.file, errors: f.errors, detail: f.sample });
    }
  }
  result.worklist.sort((x, y) => (x.kind === "align-pom" ? -1 : y.kind === "align-pom" ? 1 : 0) || y.errors - x.errors);
  result.worklist = result.worklist.slice(0, opts.topN ?? 20);
  if (steps.has("reassemble") && steps.has("migrate")) notes.push("재조립을 전환 적용보다 먼저 합니다 — 적용이 컴포넌트 소스를 바꾸면 원본 태그 식별이 깨지기 때문입니다. 실제 프로젝트에서도 같은 순서를 권합니다.");
  if (buildTool === "maven") notes.push(`컴파일은 maven.compiler.fork=true·JDK_JAVAC_OPTIONS=-Xmaxerrs ${JAVAC_MAX_ERRORS} 로 javac 의 오류 100개 상한 없이 셉니다.`);
  if (a?.capped || b?.capped) notes.push("오류가 정확히 100건 — javac 기본 상한에 걸렸을 수 있습니다(Gradle 은 compilerArgs 에 -Xmaxerrs 를 직접 지정).");

  // 평가서용 최근 결과(패치 본문 제외)
  try {
    const rec = rehearsalRecordPath(projectDir, root);
    fs.mkdirSync(path.dirname(rec), { recursive: true });
    const slim = { ...result, afterPomAlignment: result.afterPomAlignment ? { ...result.afterPomAlignment, patch: undefined } : undefined };
    fs.writeFileSync(rec, `${JSON.stringify(slim, null, 2)}\n`);
    result.savedTo = rec;
  } catch (e) { notes.push(`최근 결과를 저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`); }
  return result;
}

const fmtPhase = (p: RehearsalPhase | undefined) => (!p ? "—" : !p.ran ? `건너뜀(${p.reason})` : p.success ? "✅ 통과" : `❌ ${p.analysis?.errors ?? 0}건 / 파일 ${p.analysis?.files ?? 0}${p.timedOut ? " (시간 초과)" : ""}`);

/** 결과 Markdown. */
export function renderRehearsalMarkdown(r: RehearseResult): string {
  const L: string[] = [];
  L.push(`# 표준프레임워크 5.x 전환 리허설`, ``);
  L.push(`- 경로: ${r.projectDir} · 빌드 ${r.buildTool ?? "없음"} · 시작 ${r.startedAt}`);
  L.push(`- 사본: 파일 ${r.workspace.files}개(${(r.workspace.bytes / 1048576).toFixed(1)}MB, ${r.workspace.copyMs}ms)${r.workspace.kept && r.workspace.path ? ` → ${r.workspace.path} (유지)` : " — 끝나고 삭제"}`);
  L.push(`- 원본: ${r.original.unchanged ? "✅ 변경 없음(실행 전후 지문 같음)" : "⚠️ 지문이 바뀜"}`);
  const A = r.afterAutomation, B = r.afterPomAlignment;
  L.push(``, `## 결과`, ``, `| 단계 | 컴파일 |`, `|---|---|`, `| 자동 단계 후(재조립·전환 적용) | ${fmtPhase(A)} |`, `| pom 맞춤 후 | ${fmtPhase(B)} |`);
  if (A?.analysis && B?.analysis && A.analysis.errors > 0) L.push(``, `- **자동 단계 뒤 오류 ${A.analysis.errors}건 중 ${A.analysis.errors - B.analysis.errors}건(${Math.round(((A.analysis.errors - B.analysis.errors) / A.analysis.errors) * 100)}%)은 pom 의존성 문제**이고, pom 을 맞춘 뒤 남는 ${B.analysis.errors}건이 코드 작업입니다.`);
  L.push(``, `## 단계`, ``);
  for (const s of r.steps) L.push(`- ${s.ran ? (s.ok ? "✅" : "❌") : "➖"} ${s.step} — ${s.ok ? s.summary : `실패: ${s.error}`}${s.ran ? ` (${s.durationMs}ms)` : ""}`);
  const an = (B?.analysis ?? A?.analysis);
  if (an && an.errors) {
    L.push(``, `## 남은 오류 (${B?.analysis ? "pom 맞춤 후" : "자동 단계 후"})`, ``);
    L.push(`- 누락 패키지 ${an.missingPackage} · 같은 파일 연쇄 ${an.cascade} · 기타 ${an.other}(수동 항목 연결 ${an.linked.manual} · 규칙으로 설명 ${an.linked.rules} · 분류 불가 ${an.linked.unlinked})`);
    if (an.missingPackages.length) { L.push(``, `| 누락 패키지 | 오류 | 파일 | 후보 좌표 |`, `|---|---|---|---|`); for (const m of an.missingPackages.slice(0, 12)) L.push(`| \`${m.package}\` | ${m.errors} | ${m.files} | ${m.hint ?? "—"} |`); }
    if (an.topFiles.length) { L.push(``, `코드 작업이 많은 파일(누락 패키지·연쇄 제외):`); for (const f of an.topFiles.slice(0, 10)) L.push(`- ${f.file} — ${f.errors}건 (${f.sample})`); }
  }
  if (B?.ran) {
    L.push(``, `## pom 맞춤 (사본에만 적용, ${B.reference})`, ``);
    if (B.parent) L.push(`- parent: ${B.parent}`);
    L.push(`- 좌표 추가 ${B.added?.length ?? 0}: ${(B.added ?? []).slice(0, 30).join(", ") || "없음"}`);
    if (B.versionsChanged?.length) L.push(`- 버전 표기 변경 ${B.versionsChanged.length}: ${B.versionsChanged.slice(0, 15).join("; ")}`);
    if (B.scopesChanged?.length) L.push(`- 범위(scope) 변경 ${B.scopesChanged.length}: ${B.scopesChanged.join("; ")}`);
    if (B.propertiesRemoved?.length) L.push(`- parent 값으로 돌린 속성: ${B.propertiesRemoved.join(", ")}`);
    if (B.propertiesSet?.length) L.push(`- 기준 값으로 맞춘 속성: ${B.propertiesSet.join(", ")}`);
  }
  if (r.worklist.length) { L.push(``, `## 작업 목록 (사라지는 오류 순)`, ``); for (const w of r.worklist) L.push(`- **${w.errors}건** ${w.title} — ${w.detail}`); }
  for (const n of r.notes) L.push(`- ${n}`);
  L.push(``, `---`, `프로젝트는 바꾸지 않았습니다. 실제 전환은 reassemble_egovframe_components → migrate_egovframe_project(apply) 순서로 진행하고, pom 은 위 변경을 검토해 반영하세요.`);
  return L.join("\n");
}
