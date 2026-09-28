// 의존성 점검 (check_egovframe_dependencies, v0.30.0 — 읽기 전용).
// 프로젝트의 Maven/Gradle 의존성을 공식 5.x parent 가 관리하는 기준 버전(catalog/dependency-baseline.json)과 대조하고,
// 보안 설정의 존재 여부를 파일·라인 근거와 함께 보고한다. 기본은 오프라인이며 offline=false 일 때만 OSV 로 알려진 취약점을 조회한다.
import * as fs from "node:fs";
import * as path from "node:path";
import { diagnoseProject } from "./diagnose.js";
import { DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "./shared.js";
import { lineAt, loadMigrationRules, parsePomDeps, parsePomProperties, resolveProp, versionBelow, walkProjectFiles, type MigrationRules } from "./migrate.js";

export interface BaselineManaged { groupId: string; artifactId: string; version: string; scope?: string; type?: string; sources: ("web" | "boot")[]; versionBySource?: Record<string, string>; parentVersion?: string }
export interface DependencyBaseline {
  schemaVersion: number;
  surveyedAt: string;
  repository: string;
  sources: { kind: "web" | "boot"; groupId: string; artifactId: string; version: string; url: string; sha256: string; managed: number; parent?: { groupId: string; artifactId: string; version: string } }[];
  java: number;
  rte: { version: string; parentManaged: Record<string, string | null> };
  spring: { framework: string | null; boot: string | null; security: string | null };
  properties: { web: Record<string, string>; boot: Record<string, string> };
  managed: BaselineManaged[];
  /** BOM import·버전 속성이 정하는 groupId 계열 기준(개별 artifact 가 managed 에 없어도 적용) */
  families: { groupIdPrefix: string; version: string; via: string }[];
}

const BASELINE_URL = new URL("../catalog/dependency-baseline.json", import.meta.url);
let cached: DependencyBaseline | null = null;
export function loadDependencyBaseline(): DependencyBaseline {
  if (!cached) cached = JSON.parse(fs.readFileSync(BASELINE_URL, "utf8")) as DependencyBaseline;
  return cached;
}

export type DependencyStatus = "ok" | "outdated" | "managed" | "legacy" | "replace" | "unknown" | "unversioned";
export interface DependencyFinding {
  file: string; line: number;
  groupId: string; artifactId: string;
  /** pom 에 적힌 그대로(속성 참조 포함), 없으면 null */
  version: string | null;
  /** 속성을 푼 버전, 못 풀면 null */
  resolvedVersion: string | null;
  scope: string | null;
  status: DependencyStatus;
  /** 기준 버전(baseline 에 있을 때) */
  baseline: string | null;
  note?: string;
}
export interface SecurityCheck { id: string; title: string; status: "ok" | "missing" | "n/a"; evidence: { file: string; line: number; text: string }[]; hint: string }
export interface Vulnerability { dependency: string; version: string; ids: string[] }
export interface ParentInfo { groupId: string | null; artifactId: string | null; version: string | null; kind: "web" | "boot" | "other" | "none"; status: "ok" | "outdated" | "n/a" }
export interface CheckDependenciesResult {
  projectDir: string;
  buildSystem: "maven" | "gradle" | "unknown";
  offline: boolean;
  baseline: { surveyedAt: string; rte: string; springFramework: string | null; springBoot: string | null; java: number };
  parent: ParentInfo;
  java: { value: string | null; status: "ok" | "outdated" | "unknown" };
  findings: DependencyFinding[];
  summary: Record<DependencyStatus, number>;
  checks: SecurityCheck[];
  vulnerabilities?: Vulnerability[];
  osvError?: string;
  notes: string[];
}
export type OsvQuery = (queries: { package: { name: string; ecosystem: "Maven" }; version: string }[]) => Promise<{ results: { vulns?: { id: string }[] }[] }>;
export interface CheckDependenciesOptions { projectDir: string; offline?: boolean; osvQuery?: OsvQuery; maxFiles?: number }

const OSV_URL = "https://api.osv.dev/v1/querybatch";
export const defaultOsvQuery: OsvQuery = async (queries) => {
  const res = await fetchWithTimeout(OSV_URL, DOWNLOAD_TIMEOUT_MS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queries }) });
  if (!res.ok) throw new Error(`OSV ${res.status} ${res.statusText}`);
  return (await res.json()) as { results: { vulns?: { id: string }[] }[] };
};

const SKIP_SCOPES = new Set<string>(); // 모든 scope 를 본다(test 도 취약점 대상)

/** 좌표 하나를 분류한다(순수 함수, 테스트 대상). */
export function classifyDependency(
  dep: { groupId: string; artifactId: string; version: string | null; resolvedVersion: string | null },
  ctx: { baseline: DependencyBaseline; rules: MigrationRules; parentKind: ParentInfo["kind"] },
): { status: DependencyStatus; baseline: string | null; note?: string } {
  const key = `${dep.groupId}:${dep.artifactId}`;
  const { baseline, rules } = ctx;
  // 1) 3.x/4.x RTE 좌표·javax 좌표 → 전환 대상
  for (const c of rules.coordinates) if (c.from.some((f) => `${f.groupId}:${f.artifactId}` === key))
    return { status: "legacy", baseline: `${c.to.groupId}:${c.to.artifactId}:${rules.target.runtimeVersion}`, note: `${rules.source.fromTag.replace(/^v/, "")} 계열 RTE 좌표 — migrate_egovframe_project 로 5.x 좌표로 전환` };
  if (rules.removedModules.some((m) => m.fromArtifactId === dep.artifactId && /^(egovframework\.rte|org\.egovframe\.rte)$/.test(dep.groupId)))
    return { status: "replace", baseline: null, note: rules.removedModules.find((m) => m.fromArtifactId === dep.artifactId)!.reason };
  const jk = rules.jakarta.artifacts.find((a) => `${a.from.groupId}:${a.from.artifactId}` === key);
  if (jk) return { status: "legacy", baseline: `${jk.to.groupId}:${jk.to.artifactId}:${jk.toVersion}`, note: "javax 좌표 — Jakarta 좌표로 전환(migrate_egovframe_project)" };
  // 2) 교체 필요 라이브러리
  for (const lib of rules.libraries) {
    if (lib.match.groupId !== dep.groupId) continue;
    const re = new RegExp(`^${lib.match.artifactId.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    if (!re.test(dep.artifactId)) continue;
    if (lib.match.versionBelow) {
      if (!dep.resolvedVersion) continue;
      if (versionBelow(dep.resolvedVersion, lib.match.versionBelow) !== true) continue;
    }
    return { status: "replace", baseline: lib.replacement, note: lib.reason };
  }
  // 3) 기준 목록(개별 좌표 → 계열)
  const exact = baseline.managed.find((x) => x.groupId === dep.groupId && x.artifactId === dep.artifactId);
  const family = exact ? null : [...baseline.families].filter((f) => dep.groupId === f.groupIdPrefix || dep.groupId.startsWith(`${f.groupIdPrefix}.`)).sort((a, b) => b.groupIdPrefix.length - a.groupIdPrefix.length)[0] ?? null;
  const m = exact ?? (family ? { version: family.version } : null);
  const familyNote = family ? `계열 기준: ${family.via}` : undefined;
  if (!dep.version) {
    if (ctx.parentKind === "web" || ctx.parentKind === "boot") return { status: "managed", baseline: m?.version ?? null, note: m ? undefined : (ctx.parentKind === "boot" ? "Spring Boot BOM 이 관리(기준 목록 밖)" : "parent 에 없는 좌표 — 버전 출처 확인") };
    return { status: "unversioned", baseline: m?.version ?? null, note: "버전이 없고 5.x parent 도 없음 — dependencyManagement 또는 명시 버전 필요" };
  }
  if (!m) return { status: "unknown", baseline: null, note: "기준 목록(공식 5.x parent)에 없는 좌표 — 판단 보류" };
  if (!dep.resolvedVersion) return { status: "unknown", baseline: m.version, note: `버전 속성을 풀지 못함: ${dep.version}` };
  const below = versionBelow(dep.resolvedVersion, m.version);
  if (below === null) return { status: "unknown", baseline: m.version, note: `버전을 비교할 수 없음: ${dep.resolvedVersion}` };
  return below ? { status: "outdated", baseline: m.version, ...(familyNote ? { note: familyNote } : {}) } : { status: "ok", baseline: m.version, ...(familyNote ? { note: familyNote } : {}) };
}

interface RawDep { file: string; line: number; groupId: string; artifactId: string; version: string | null; resolvedVersion: string | null; scope: string | null }

function collectMaven(dir: string, files: string[], baseline: DependencyBaseline): { deps: RawDep[]; parent: ParentInfo; java: string | null; repoIssues: { file: string; line: number; text: string }[] } {
  const deps: RawDep[] = [];
  const repoIssues: { file: string; line: number; text: string }[] = [];
  let parent: ParentInfo = { groupId: null, artifactId: null, version: null, kind: "none", status: "n/a" };
  let java: string | null = null;
  const poms = files.filter((f) => path.basename(f) === "pom.xml").sort((a, b) => a.length - b.length);
  const rootProps = new Map<string, string>();
  for (const abs of poms) {
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    const text = fs.readFileSync(abs, "utf8");
    const props = new Map([...rootProps, ...parsePomProperties(text)]);
    if (rel === "pom.xml") {
      for (const [k, v] of props) rootProps.set(k, v);
      const p = text.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
      if (p) {
        const g = p.match(/<groupId>\s*([^<\s]+)/)?.[1] ?? null, a = p.match(/<artifactId>\s*([^<\s]+)/)?.[1] ?? null, v = p.match(/<version>\s*([^<\s]+)/)?.[1] ?? null;
        const src = baseline.sources.find((s) => s.groupId === g && s.artifactId === a);
        const status: ParentInfo["status"] = src && v ? (versionBelow(v, src.version) ? "outdated" : "ok") : "n/a";
        parent = { groupId: g, artifactId: a, version: v, kind: src ? src.kind : "other", status };
      }
      java = resolveProp(props.get("java.version") ?? props.get("maven.compiler.release") ?? props.get("maven.compiler.source") ?? props.get("maven.compiler.target") ?? null, props);
      if (!java) { const m = text.match(/<(?:release|source)>\s*([^<\s]+)\s*<\/(?:release|source)>/); java = m ? resolveProp(m[1], props) : null; }
      if (java && /\$\{/.test(java)) java = null; // parent 가 정의하는 속성 → 아래에서 parent 기준으로 판정
    }
    for (const m of text.matchAll(/<repository>[\s\S]*?<url>\s*(http:\/\/[^<\s]+)\s*<\/url>[\s\S]*?<\/repository>/g))
      repoIssues.push({ file: rel, line: lineAt(text, (m.index ?? 0) + m[0].indexOf(m[1])), text: m[1] });
    // dependencyManagement 안의 항목은 프로젝트가 직접 쓰는 의존성이 아닐 수 있으나 버전 결정에는 관여하므로 함께 본다
    for (const d of parsePomDeps(text)) {
      const resolved = resolveProp(d.version, props);
      deps.push({ file: rel, line: d.line, groupId: d.groupId, artifactId: d.artifactId, version: d.version, resolvedVersion: resolved && !/\$\{/.test(resolved) ? resolved : null, scope: d.scope });
    }
  }
  return { deps, parent, java, repoIssues };
}

function collectGradle(dir: string, files: string[]): { deps: RawDep[]; java: string | null; repoIssues: { file: string; line: number; text: string }[] } {
  const deps: RawDep[] = [];
  const repoIssues: { file: string; line: number; text: string }[] = [];
  let java: string | null = null;
  for (const abs of files.filter((f) => /^(build\.gradle|build\.gradle\.kts)$/.test(path.basename(f)))) {
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    const text = fs.readFileSync(abs, "utf8");
    for (const m of text.matchAll(/["']([\w.\-]+):([\w.\-]+)(?::([^"':\s]+))?["']/g))
      deps.push({ file: rel, line: lineAt(text, m.index ?? 0), groupId: m[1], artifactId: m[2], version: m[3] ?? null, resolvedVersion: m[3] && !/\$/.test(m[3]) ? m[3] : null, scope: null });
    for (const m of text.matchAll(/(http:\/\/[^\s"']+)/g)) repoIssues.push({ file: rel, line: lineAt(text, m.index ?? 0), text: m[1] });
    const src = text.match(/sourceCompatibility\s*=?\s*["']?(?:JavaVersion\.VERSION_)?(1_8|1\.8|[0-9]+)/) ?? text.match(/languageVersion\s*=?\s*JavaLanguageVersion\.of\((\d+)\)/);
    if (src) java = src[1].replace("1_8", "1.8");
  }
  return { deps, java, repoIssues };
}

const CHECK_EXT = new Set([".xml", ".java", ".properties", ".yml", ".yaml"]);
function grepEvidence(dir: string, files: string[], re: RegExp, filter?: (rel: string) => boolean, cap = 5): SecurityCheck["evidence"] {
  const out: SecurityCheck["evidence"] = [];
  for (const abs of files) {
    if (!CHECK_EXT.has(path.extname(abs))) continue;
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    if (filter && !filter(rel)) continue;
    let text: string;
    try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
    if (!re.test(text)) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && out.length < cap; i++) if (re.test(lines[i])) out.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 160) });
    if (out.length >= cap) break;
  }
  return out;
}

/** 프로젝트 의존성을 기준 버전과 대조하고 보안 설정 존재 여부를 점검한다. (읽기 전용) */
export async function checkDependencies(opts: CheckDependenciesOptions): Promise<CheckDependenciesResult> {
  const baseline = loadDependencyBaseline();
  const rules = loadMigrationRules();
  const offline = opts.offline ?? true;
  const dir = path.resolve(opts.projectDir);
  const diag = diagnoseProject({ projectDir: dir });
  const files = walkProjectFiles(dir, opts.maxFiles ?? 20_000);
  const notes: string[] = [];

  let raw: RawDep[] = [];
  let parent: ParentInfo = { groupId: null, artifactId: null, version: null, kind: "none", status: "n/a" };
  let javaValue: string | null = null;
  let repoIssues: { file: string; line: number; text: string }[] = [];
  if (diag.buildSystem === "maven") ({ deps: raw, parent, java: javaValue, repoIssues } = collectMaven(dir, files, baseline));
  else if (diag.buildSystem === "gradle") ({ deps: raw, java: javaValue, repoIssues } = collectGradle(dir, files));
  else notes.push("빌드 파일(pom.xml·build.gradle)을 찾지 못해 의존성 대조를 건너뜁니다.");

  const findings: DependencyFinding[] = [];
  const seen = new Set<string>();
  for (const d of raw) {
    if (SKIP_SCOPES.has(d.scope ?? "")) continue;
    const key = `${d.file}\u0000${d.groupId}:${d.artifactId}\u0000${d.version ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = classifyDependency(d, { baseline, rules, parentKind: parent.kind });
    findings.push({ file: d.file, line: d.line, groupId: d.groupId, artifactId: d.artifactId, version: d.version, resolvedVersion: d.resolvedVersion, scope: d.scope, status: c.status, baseline: c.baseline, ...(c.note ? { note: c.note } : {}) });
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const summary: Record<DependencyStatus, number> = { ok: 0, outdated: 0, managed: 0, legacy: 0, replace: 0, unknown: 0, unversioned: 0 };
  for (const f of findings) summary[f.status]++;

  // Java
  let javaStatus: CheckDependenciesResult["java"]["status"] = "unknown";
  if (javaValue) {
    const num = javaValue.startsWith("1.") ? Number(javaValue.slice(2)) : Number.parseInt(javaValue, 10);
    if (Number.isFinite(num)) javaStatus = num >= baseline.java ? "ok" : "outdated";
  } else if (parent.kind === "web" || parent.kind === "boot") { javaValue = String(baseline.java); javaStatus = "ok"; notes.push("java.version 은 5.x parent 가 관리합니다(17)."); }

  // 보안 설정 점검 — 존재 여부만 판정하고 근거를 남긴다
  const checks: SecurityCheck[] = [];
  const secComponents = diag.detectedComponents.filter((c) => c.id === "sec.security" || c.id.startsWith("sec.security."));
  checks.push({
    id: "sec-security-component", title: "공통컴포넌트 sec.security(인증·인가 기반) 설치",
    status: secComponents.length ? "ok" : diag.detectedComponents.length ? "missing" : "n/a",
    evidence: secComponents.map((c) => ({ file: c.matchedPrefix, line: 0, text: c.id })),
    hint: secComponents.length ? "" : "add_egovframe_components(componentIds=[\"sec.security\"]) 로 설치하거나, 자체 Spring Security 설정을 쓰는 경우 아래 CSRF·헤더 항목으로 확인",
  });
  const csrf = grepEvidence(dir, files, /<csrf\b|\.csrf\(|CsrfFilter|CsrfTokenRepository|csrfAccessDeniedUrl|_csrf|egov-security:config[^>]*csrf/i, (rel) => !rel.includes("/test/"));
  checks.push({ id: "csrf", title: "CSRF 보호 설정", status: csrf.length ? "ok" : "missing", evidence: csrf, hint: csrf.length ? "" : "Spring Security 의 csrf() 또는 <csrf/> 설정(EgovSecurityConfig 의 csrf 속성)을 켜세요" });
  const xss = grepEvidence(dir, files, /HTMLTagFilter|XssFilter|XSSFilter|xss-?filter|EgovXssFilter|Lucy|XssEscapeServletFilter/i, (rel) => /web\.xml$|\.java$|\.xml$/.test(rel) && !rel.includes("/test/"));
  checks.push({ id: "xss-filter", title: "XSS 방어 필터(HTMLTagFilter 등)", status: xss.length ? "ok" : "missing", evidence: xss, hint: xss.length ? "" : "web.xml 에 org.egovframe.rte.ptl.mvc.filter.HTMLTagFilter 를 등록하거나 Lucy-XSS 등 필터를 적용하세요" });
  const headers = grepEvidence(dir, files, /HeaderWriterFilter|X-Frame-Options|Content-Security-Policy|X-Content-Type-Options|Strict-Transport-Security|\.headers\(|<headers\b|frameOptions|contentSecurityPolicy/i, (rel) => !rel.includes("/test/"));
  checks.push({ id: "security-headers", title: "보안 응답 헤더(X-Frame-Options·CSP·HSTS 등)", status: headers.length ? "ok" : "missing", evidence: headers, hint: headers.length ? "" : "Spring Security headers() 또는 web.xml 필터로 X-Frame-Options·Content-Security-Policy 등을 설정하세요" });
  checks.push({ id: "https-repositories", title: "Maven 저장소 URL HTTPS", status: repoIssues.length ? "missing" : (diag.buildSystem === "unknown" ? "n/a" : "ok"), evidence: repoIssues, hint: repoIssues.length ? "http:// 저장소는 중간자 변조에 노출됩니다. https://maven.egovframe.go.kr/maven/ 등 HTTPS 로 바꾸세요(migrate_egovframe_project 가 자동 치환)" : "" });

  const result: CheckDependenciesResult = {
    projectDir: dir, buildSystem: diag.buildSystem, offline,
    baseline: { surveyedAt: baseline.surveyedAt, rte: baseline.rte.version, springFramework: baseline.spring.framework, springBoot: baseline.spring.boot, java: baseline.java },
    parent, java: { value: javaValue, status: javaStatus }, findings, summary, checks, notes,
  };

  if (!offline) {
    const targets = findings.filter((f) => f.resolvedVersion);
    const query = opts.osvQuery ?? defaultOsvQuery;
    const vulns: Vulnerability[] = [];
    try {
      for (let i = 0; i < targets.length; i += 100) {
        const chunk = targets.slice(i, i + 100);
        const res = await query(chunk.map((f) => ({ package: { name: `${f.groupId}:${f.artifactId}`, ecosystem: "Maven" as const }, version: f.resolvedVersion! })));
        res.results.forEach((r, j) => {
          const ids = (r.vulns ?? []).map((v) => v.id);
          if (ids.length) vulns.push({ dependency: `${chunk[j].groupId}:${chunk[j].artifactId}`, version: chunk[j].resolvedVersion!, ids });
        });
      }
      result.vulnerabilities = vulns;
    } catch (e) {
      result.osvError = `OSV 조회 실패: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return result;
}

const STATUS_LABEL: Record<DependencyStatus, string> = { ok: "기준 충족", outdated: "기준 미만", managed: "parent 관리", legacy: "전환 대상", replace: "교체 필요", unknown: "기준 없음", unversioned: "버전 없음" };

/** 점검 결과를 Markdown 으로 렌더링한다. */
export function renderDependencyMarkdown(r: CheckDependenciesResult): string {
  const L: string[] = [];
  L.push(`# 의존성 점검`, ``);
  L.push(`- 경로: ${r.projectDir} · 빌드 ${r.buildSystem} · ${r.offline ? "오프라인" : "OSV 조회 포함"}`);
  L.push(`- 기준: 공식 5.x parent(조사일 ${r.baseline.surveyedAt}) — RTE ${r.baseline.rte}, Spring ${r.baseline.springFramework ?? "-"}, Boot ${r.baseline.springBoot ?? "-"}, Java ${r.baseline.java}`);
  L.push(`- parent: ${r.parent.kind === "none" ? "없음" : `${r.parent.groupId}:${r.parent.artifactId}:${r.parent.version ?? "?"} (${r.parent.kind}, ${r.parent.status})`}`);
  L.push(`- Java: ${r.java.value ?? "미검출"} (${r.java.status})`);
  const s = r.summary;
  L.push(`- 의존성 ${r.findings.length}건: 기준 충족 ${s.ok} · 기준 미만 ${s.outdated} · parent 관리 ${s.managed} · 전환 대상 ${s.legacy} · 교체 필요 ${s.replace} · 기준 없음 ${s.unknown} · 버전 없음 ${s.unversioned}`);
  for (const n of r.notes) L.push(`- ${n}`);
  const attention = r.findings.filter((f) => f.status === "outdated" || f.status === "legacy" || f.status === "replace" || f.status === "unversioned");
  if (attention.length) {
    L.push(``, `## 조치 필요 (${attention.length})`, ``, `| 파일:라인 | 좌표 | 현재 | 기준/대체 | 상태 | 비고 |`, `|---|---|---|---|---|---|`);
    for (const f of attention) L.push(`| ${f.file}:${f.line} | ${f.groupId}:${f.artifactId} | ${f.resolvedVersion ?? f.version ?? "-"} | ${f.baseline ?? "-"} | ${STATUS_LABEL[f.status]} | ${f.note ?? ""} |`);
  }
  const unknown = r.findings.filter((f) => f.status === "unknown");
  if (unknown.length) L.push(``, `## 기준 없음 (${unknown.length}) — 판단 보류`, ``, unknown.map((f) => `${f.groupId}:${f.artifactId}${f.resolvedVersion ? `:${f.resolvedVersion}` : ""}`).join(", "));
  L.push(``, `## 보안 설정 점검`, ``);
  for (const c of r.checks) {
    const mark = c.status === "ok" ? "✅" : c.status === "missing" ? "⚠️" : "➖";
    L.push(`- ${mark} ${c.title}: ${c.status}${c.hint ? ` — ${c.hint}` : ""}`);
    for (const e of c.evidence.slice(0, 3)) L.push(`  - ${e.file}${e.line ? `:${e.line}` : ""} \`${e.text}\``);
  }
  if (r.vulnerabilities) {
    L.push(``, `## 알려진 취약점 (OSV, ${r.vulnerabilities.length}건)`, ``);
    if (r.vulnerabilities.length === 0) L.push(`조회한 의존성에 등록된 취약점이 없습니다.`);
    for (const v of r.vulnerabilities) L.push(`- ${v.dependency}:${v.version} — ${v.ids.slice(0, 6).join(", ")}${v.ids.length > 6 ? ` 외 ${v.ids.length - 6}건` : ""} (https://osv.dev/vulnerability/${v.ids[0]})`);
  }
  if (r.osvError) L.push(``, `⚠️ ${r.osvError}`);
  L.push(``, `---`, `읽기 전용 점검입니다. 전환 대상은 migrate_egovframe_project, 공통컴포넌트 갱신은 upgrade_egovframe_project 로 처리합니다.`);
  return L.join("\n");
}
