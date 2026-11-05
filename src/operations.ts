// 운영 준비 점검 (check_egovframe_operations, v1.15.0) — 읽기 전용.
//   "기동은 되는데 운영에서 터지는" 설정(SQL 로깅 드라이버·DEBUG 로그·콘솔 전용 로그·devtools·내장 DB·풀 타임아웃·세션·업로드·오류 노출·actuator·개발 플래그·비밀값)을
//   운영 설정 세트(Boot: application + application-prod.* / Classic: globals.properties + context-*.xml + web.xml + log4j2.xml)에서 찾는다.
//   규칙은 catalog/operations-rules.json 데이터(출처 명시). 값을 고치지 않고 바뀔 줄을 제안만 한다.
import * as fs from "node:fs";
import * as path from "node:path";
import { checkSecureCoding, compileRulePattern, readIgnoreFile, type SecureIgnore } from "./secure-coding.js";
import { L, getLang } from "./lang.js";

export type OpsSeverity = "high" | "medium" | "low";
export type OpsTarget = "properties" | "yaml" | "xml" | "web-xml" | "log4j2" | "logback" | "pom" | "gradle";
export interface OpsRule {
  id: string; category: string; severity: OpsSeverity; title: string; title_en?: string;
  check: { kind: "line" | "lacks" | "pom" | "session-timeout" | "upload" | "profile" | "secrets"; targets?: OpsTarget[]; pattern?: string; unless?: string; requires?: string; artifact?: string; maxMinutes?: number; maxBytes?: number };
  message: string; message_en?: string; fix: string; fix_en?: string; basis: string; basis_en?: string;
}
export interface OpsRules { schemaVersion: number; surveyedAt: string; sources: { name: string; name_en?: string }[]; categories: { id: string; label: string; labelEn: string }[]; rules: OpsRule[] }
const RULES_URL = new URL("../catalog/operations-rules.json", import.meta.url);
let cached: OpsRules | null = null;
export function loadOperationsRules(): OpsRules { if (!cached) cached = JSON.parse(fs.readFileSync(RULES_URL, "utf8")) as OpsRules; return cached; }
const tr = (o: Record<string, unknown>, k: string): string => (getLang() === "en" && typeof o[`${k}_en`] === "string" ? (o[`${k}_en`] as string) : (o[k] as string));

export interface OpsFinding {
  rule: string; category: string; severity: OpsSeverity; title: string;
  file: string; line: number; code: string;
  message: string; fix: string; basis: string;
  /** 바뀔 줄 제안(있을 때) */
  suggestion?: string;
}
export interface OpsRuleResult { rule: string; category: string; severity: OpsSeverity; title: string; status: "pass" | "fail" | "n/a"; findings: number }
export interface OperationsOptions { projectDir: string; /** 운영 프로파일 이름(기본: prod·production·release·ops 중 있는 것) */ profile?: string; rules?: string[]; maxFiles?: number }
export interface OperationsResult {
  projectDir: string;
  rulesVersion: { surveyedAt: string; rules: number };
  runtime: "boot" | "classic" | "unknown";
  /** 운영 설정 세트로 본 파일 */
  configSet: { properties: string[]; profile: string | null; excludedProfiles: string[] };
  filesScanned: number;
  findings: OpsFinding[];
  rules: OpsRuleResult[];
  summary: { total: number; high: number; medium: number; low: number; suppressed: number; pass: number; fail: number; na: number };
  grade: { grade: "A" | "B" | "C" | "D"; formula: string };
  ignoreFile: string | null;
  invalidIgnores: string[];
  notes: string[];
}
export const OPS_IGNORE_FILE = ".egovframe-ops-ignore.json";
const SKIP_DIRS = new Set(["target", "build", "node_modules", ".git", "migration-backup", "deploy", "sbom", "bin", "out", ".idea", ".settings", "static", "css", "js", "images", "img", "fonts"]);
const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");
const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

function walk(root: string, max: number): string[] {
  const out: string[] = []; const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".") && e.name !== "test") stack.push(p); continue; }
      if (e.isFile()) out.push(p);
    }
  }
  return out.sort();
}
/** 파일 → 점검 대상 종류(아니면 null). 메시지 번들·매퍼 XML·테스트는 제외 */
export function classifyOpsFile(r: string): OpsTarget | null {
  if (/(^|\/)src\/test\//.test(r)) return null;
  const base = r.split("/").pop()!;
  if (base === "pom.xml") return "pom";
  if (/^build\.gradle(\.kts)?$/.test(base)) return "gradle";
  if (/(^|\/)WEB-INF\/web\.xml$/.test(r)) return "web-xml";
  if (/^log4j2[\w.-]*\.xml$/.test(base)) return "log4j2";
  if (/^logback[\w.-]*\.xml$/.test(base)) return "logback";
  if (!/(^|\/)(src\/main\/(resources|webapp)|config)\//.test(r) && !/^application[\w.-]*\.(properties|ya?ml)$/.test(r)) return null;
  if (/(^|\/)(message|messages|i18n)[/_]|message[_\w]*\.properties$|\/sqlmap\/|\/mappers?\/|_SQL_[\w]+\.xml$|\.xsd$|\/validator\//i.test(r)) return null;
  if (/\.properties$/.test(base)) return "properties";
  if (/\.ya?ml$/.test(base)) return "yaml";
  if (/\.xml$/.test(base)) return "xml";
  return null;
}
const PROD_NAMES = ["prod", "production", "release", "ops", "real", "live"];
const DEV_NAMES = ["dev", "local", "test", "development", "stage", "staging", "docker", "h2", "hsql"];

export async function checkOperations(opts: OperationsOptions): Promise<OperationsResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const all = loadOperationsRules();
  const unknown = (opts.rules ?? []).filter((r) => !all.rules.some((x) => x.id === r));
  if (unknown.length) throw new Error(L(`알 수 없는 규칙: ${unknown.join(", ")} (사용 가능: ${all.rules.map((r) => r.id).join(", ")})`, `Unknown rule: ${unknown.join(", ")} (available: ${all.rules.map((r) => r.id).join(", ")})`));
  const rules = opts.rules?.length ? all.rules.filter((r) => opts.rules!.includes(r.id)) : all.rules;
  const notes: string[] = [];
  const files = walk(projectDir, opts.maxFiles ?? 20_000).map((p) => ({ abs: p, rel: rel(projectDir, p), type: classifyOpsFile(rel(projectDir, p)) })).filter((f): f is { abs: string; rel: string; type: OpsTarget } => !!f.type);
  const pomText = read(path.join(projectDir, "pom.xml")) + files.filter((f) => f.type === "gradle").map((f) => read(f.abs)).join("\n");
  const runtime: OperationsResult["runtime"] = /spring-boot-starter|egovframe-boot-starter|org\.springframework\.boot/.test(pomText) ? "boot" : /<packaging>\s*war|egovframe-web-config-parent|spring-webmvc/.test(pomText) ? "classic" : "unknown";

  // 운영 설정 세트: Boot 프로파일 파일 중 운영 이름만, 개발 이름은 제외
  const profileOf = (r: string) => r.split("/").pop()!.match(/^application-([\w.-]+)\.(properties|ya?ml)$/)?.[1] ?? null;
  const profiles = [...new Set(files.map((f) => profileOf(f.rel)).filter((x): x is string => !!x))];
  const prodProfile = opts.profile ?? profiles.find((p) => PROD_NAMES.includes(p.toLowerCase())) ?? null;
  if (opts.profile && !profiles.includes(opts.profile)) notes.push(L(`profile=${opts.profile} 설정 파일이 없습니다 — 기본 파일만 봅니다`, `No configuration file for profile=${opts.profile} — only the default files are checked`));
  const excludedProfiles = profiles.filter((p) => p !== prodProfile);
  const inConfigSet = (f: { rel: string; type: OpsTarget }) => { const p = profileOf(f.rel); return !p || p === prodProfile; };
  const scanFiles = files.filter((f) => f.type !== "properties" && f.type !== "yaml" ? true : inConfigSet(f));
  const textOf = new Map<string, string>();
  const text = (f: { abs: string; rel: string }) => { let t = textOf.get(f.rel); if (t === undefined) { t = read(f.abs); textOf.set(f.rel, t); } return t; };
  const propsFiles = scanFiles.filter((f) => f.type === "properties" || f.type === "yaml");
  const propsAll = propsFiles.map((f) => text(f)).join("\n");
  // Boot: 운영 프로파일 파일이 정한 키는 기본 파일의 값을 덮는다 — 기본 파일의 그 줄은 운영에서 읽히지 않으므로 line 규칙에서 뺀다(properties 만, yml 은 중첩 키라 보지 않음)
  const overridden = new Set<string>();
  if (prodProfile) for (const f of propsFiles.filter((x) => profileOf(x.rel) === prodProfile && x.type === "properties")) for (const ln of text(f).split("\n")) { const mm = ln.match(/^\s*([^#!=:\s][^=:\s]*)\s*[=:]/); if (mm) overridden.add(mm[1]); }
  const isOverridden = (f: { rel: string; type: OpsTarget }, ln: string) => { if (!overridden.size || f.type !== "properties" || profileOf(f.rel)) return false; const mm = ln.match(/^\s*([^#!=:\s][^=:\s]*)\s*[=:]/); return !!mm && overridden.has(mm[1]); };

  const findings: OpsFinding[] = [];
  const evaluated = new Map<string, "pass" | "fail" | "n/a">();
  const push = (rule: OpsRule, file: string, line: number, code: string, suggestion?: string) => findings.push({ rule: rule.id, category: rule.category, severity: rule.severity, title: tr(rule as unknown as Record<string, unknown>, "title"), file, line, code: code.trim().slice(0, 200), message: tr(rule as unknown as Record<string, unknown>, "message"), fix: tr(rule as unknown as Record<string, unknown>, "fix"), basis: tr(rule as unknown as Record<string, unknown>, "basis"), ...(suggestion ? { suggestion } : {}) });
  const lineOf = (t: string, idx: number) => t.slice(0, idx).split("\n").length;
  const stripXmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));

  for (const rule of rules) {
    const before = findings.length;
    let applicable = true;
    const c = rule.check;
    const targets = scanFiles.filter((f) => c.targets?.includes(f.type));
    if (c.kind === "line") {
      const re = compileRulePattern(c.pattern!), unless = c.unless ? compileRulePattern(c.unless) : null;
      applicable = targets.length > 0;
      for (const f of targets) {
        const src = f.type === "properties" || f.type === "yaml" ? text(f) : stripXmlComments(text(f));
        src.split("\n").forEach((ln, i) => { if (re.test(ln) && !(unless && unless.test(ln)) && !isOverridden(f, ln)) push(rule, f.rel, i + 1, ln); });
      }
    } else if (c.kind === "lacks") {
      const req = compileRulePattern(c.requires!), re = compileRulePattern(c.pattern!);
      const xmlLike = targets.filter((f) => f.type !== "properties" && f.type !== "yaml");
      const propLike = targets.filter((f) => f.type === "properties" || f.type === "yaml");
      let seen = false, xmlReported = false;
      for (const f of xmlLike) { const src = stripXmlComments(text(f)); const m = req.exec(src); if (!m) continue; seen = true; if (!re.test(src)) { push(rule, f.rel, lineOf(src, m.index), m[0]); xmlReported = true; } }
      if (propLike.length) { const m = req.exec(propsAll); if (m) { seen = true; if (!xmlReported && !re.test(propsAll) && !xmlLike.some((f) => re.test(stripXmlComments(text(f))))) { const f = propLike.find((x) => req.test(text(x)))!; const t = text(f); const mm = req.exec(t)!; push(rule, f.rel, lineOf(t, mm.index), mm[0]); } } }
      applicable = seen;
    } else if (c.kind === "pom") {
      applicable = targets.length > 0 || !!pomText;
      for (const f of files.filter((x) => x.type === "pom" || x.type === "gradle")) {
        const src = f.type === "pom" ? stripXmlComments(text(f)) : text(f);
        const re = f.type === "pom" ? new RegExp(`<artifactId>\\s*${c.artifact}\\s*</artifactId>`, "g") : new RegExp(`['":]${c.artifact}['"]`, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
          const dep = f.type === "pom" ? src.slice(src.lastIndexOf("<dependency>", m.index), src.indexOf("</dependency>", m.index) + 13) : src.split("\n")[lineOf(src, m.index) - 1];
          const soft = f.type === "pom" ? /<optional>\s*true\s*<\/optional>|<scope>\s*(provided|test|runtime)\s*<\/scope>/.test(dep) : /developmentOnly|testImplementation/.test(dep);
          push(rule, f.rel, lineOf(src, m.index), m[0], soft ? L("optional/scope 로 제한돼 있음 — 운영 war·java -cp 실행이면 -Dspring.devtools.restart.enabled=false", "limited by optional/scope — for war or java -cp runs add -Dspring.devtools.restart.enabled=false") : L("<optional>true</optional> 또는 개발 전용 프로파일로 옮기기", "add <optional>true</optional> or move it to a development-only profile"));
        }
      }
    } else if (c.kind === "session-timeout") {
      const webs = scanFiles.filter((f) => f.type === "web-xml");
      applicable = webs.length > 0 || runtime === "boot";
      for (const f of webs) {
        const src = stripXmlComments(text(f));
        const m = src.match(/<session-timeout>\s*(-?\d+)\s*<\/session-timeout>/);
        if (!m) push(rule, f.rel, Math.max(1, lineOf(src, src.search(/<\/web-app>/) < 0 ? 0 : src.search(/<\/web-app>/))), "<session-config> 없음", "<session-config><session-timeout>30</session-timeout></session-config>");
        else if (Number(m[1]) <= 0 || Number(m[1]) > (c.maxMinutes ?? 60)) push(rule, f.rel, lineOf(src, m.index!), m[0], `<session-timeout>30</session-timeout>`);
      }
      if (!webs.length && runtime === "boot" && propsFiles.length) {
        const m = propsAll.match(/^\s*(?:server\.servlet\.session\.timeout|timeout)\s*[=:]\s*(\S+)/m);
        const toMin = (v: string) => { const n = v.match(/^(\d+)\s*(ms|s|m|h|d)?$/i); if (!n) return null; const x = Number(n[1]); const u = (n[2] ?? "s").toLowerCase(); return u === "ms" ? x / 60000 : u === "s" ? x / 60 : u === "m" ? x : u === "h" ? x * 60 : x * 1440; };
        const f = propsFiles[0];
        if (!m) push(rule, f.rel, 1, "server.servlet.session.timeout 없음", "server.servlet.session.timeout=30m");
        else { const min = toMin(m[1]); if (min !== null && min > (c.maxMinutes ?? 60)) push(rule, propsFiles.find((x) => text(x).includes(m[0].trim()))?.rel ?? f.rel, 1, m[0].trim(), "server.servlet.session.timeout=30m"); }
      }
    } else if (c.kind === "upload") {
      const isEgov = /^\s*Globals\./m.test(propsAll);
      applicable = propsFiles.length > 0 && (isEgov || /multipart/.test(propsAll));
      if (applicable) {
        const keyRe = /^\s*(Globals\.fileUpload\.maxRequestSize|Globals\.posblAtchFileSize|spring\.servlet\.multipart\.max-(file|request)-size)\s*[=:]\s*(\S+)/gm;
        let found = false; let m: RegExpExecArray | null;
        for (const f of propsFiles) {
          const t = text(f);
          while ((m = keyRe.exec(t))) {
            found = true;
            const v = m[3]; const n = v.match(/^(\d+)\s*(KB|MB|GB)?$/i); const bytes = n ? Number(n[1]) * (n[2] ? { kb: 1024, mb: 1048576, gb: 1073741824 }[n[2].toLowerCase()]! : 1) : null;
            if (bytes !== null && bytes >= (c.maxBytes ?? 104857600)) push(rule, f.rel, lineOf(t, m.index), m[0].trim(), `${m[1]} = ${Math.min(bytes, 52428800)}`);
            if (/^-1$/.test(v)) push(rule, f.rel, lineOf(t, m.index), m[0].trim(), `${m[1]} = 52428800`);
          }
          keyRe.lastIndex = 0;
        }
        if (!found) push(rule, propsFiles[0].rel, 1, L("업로드 상한 키 없음", "no upload limit key"), isEgov ? "Globals.fileUpload.maxRequestSize = 52428800" : "spring.servlet.multipart.max-request-size=50MB");
        if (isEgov && /^\s*Globals\.(fileUpload\.maxRequestSize|posblAtchFileSize|fileStorePath)/m.test(propsAll) && !/^\s*Globals\.fileUpload\.Extensions/m.test(propsAll)) { const f = propsFiles.find((x) => /^\s*Globals\.(fileUpload\.maxRequestSize|posblAtchFileSize|fileStorePath)/m.test(text(x)))!; push(rule, f.rel, 1, L("Globals.fileUpload.Extensions 없음", "no Globals.fileUpload.Extensions"), "Globals.fileUpload.Extensions = .gif,.jpg,.jpeg,.png,.pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"); }
      }
    } else if (c.kind === "profile") {
      applicable = runtime === "boot" && propsFiles.length > 0;
      if (applicable && !prodProfile) push(rule, propsFiles[0].rel, 1, excludedProfiles.length ? L(`프로파일 파일 ${excludedProfiles.join(", ")} 만 있음`, `only profiles ${excludedProfiles.join(", ")} exist`) : L("프로파일 파일 없음", "no profile files"), "application-prod.properties");
    } else if (c.kind === "secrets") {
      applicable = propsFiles.length > 0 || scanFiles.some((f) => f.type === "xml");
      try {
        const sc = await checkSecureCoding({ projectDir, rules: ["hardcoded-config-password"], dataFlow: false, includeTests: false, maxFindings: 2000 });
        const set = new Set(scanFiles.map((f) => f.rel));
        for (const x of sc.findings) if (set.has(x.file)) push(rule, x.file, x.line, x.code.replace(/([=:]\s*)(\S+)/, (_m, a: string, v: string) => `${a}${v.slice(0, 2)}***`), "externalize_egovframe_config");
      } catch (e) { notes.push(L(`비밀값 점검 실패: ${e instanceof Error ? e.message : String(e)}`, `Secret check failed: ${e instanceof Error ? e.message : String(e)}`)); }
    }
    evaluated.set(rule.id, !applicable ? "n/a" : findings.length > before ? "fail" : "pass");
  }

  // 예외 파일
  const ig = readIgnoreFile(projectDir, OPS_IGNORE_FILE);
  const suppressedList: OpsFinding[] = [];
  const kept = findings.filter((f) => { const hit = ig.list.some((x: SecureIgnore) => x.rule === f.rule && (x.path === f.file || f.file.startsWith(x.path.endsWith("/") ? x.path : `${x.path}/`)) && (x.line === undefined || x.line === f.line)); if (hit) suppressedList.push(f); return !hit; });
  for (const [id, st] of evaluated) if (st === "fail" && !kept.some((f) => f.rule === id)) evaluated.set(id, "pass");
  kept.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line);
  const count = (s: OpsSeverity) => kept.filter((f) => f.severity === s).length;
  const failedRules = (s: OpsSeverity) => new Set(kept.filter((f) => f.severity === s).map((f) => f.rule)).size;
  const h = failedRules("high"), md = failedRules("medium");
  const grade: OperationsResult["grade"]["grade"] = h === 0 && md <= 1 ? "A" : h <= 1 && md <= 3 ? "B" : h <= 3 ? "C" : "D";
  const formula = L(`규칙 단위로 셉니다(같은 규칙의 여러 줄은 1) — A: 높음 0·중간 ≤1 / B: 높음 ≤1·중간 ≤3 / C: 높음 ≤3 / D: 그 밖. 지금 높음 규칙 ${h}·중간 규칙 ${md}`, `Counted per rule (many lines of one rule = 1) — A: high 0, medium ≤1 / B: high ≤1, medium ≤3 / C: high ≤3 / D: otherwise. Now high ${h} · medium ${md} rules`);
  const results: OpsRuleResult[] = rules.map((r) => ({ rule: r.id, category: r.category, severity: r.severity, title: tr(r as unknown as Record<string, unknown>, "title"), status: evaluated.get(r.id) ?? "n/a", findings: kept.filter((f) => f.rule === r.id).length }));
  if (runtime === "boot" && !prodProfile && excludedProfiles.length) notes.push(L(`운영 프로파일을 찾지 못해(있는 것: ${excludedProfiles.join(", ")}) application.properties/yml 만 운영 세트로 봤습니다 — profile 로 지정할 수 있습니다`, `No production profile found (present: ${excludedProfiles.join(", ")}); only application.properties/yml was treated as the production set — pass profile to choose one`));
  if (prodProfile) notes.push(L(`운영 세트: application + application-${prodProfile}.* (제외: ${excludedProfiles.join(", ") || "없음"})`, `Production set: application + application-${prodProfile}.* (excluded: ${excludedProfiles.join(", ") || "none"})`));
  if (ig.invalid.length) notes.push(...ig.invalid.map((x) => `${OPS_IGNORE_FILE}: ${x}`));
  return {
    projectDir, rulesVersion: { surveyedAt: all.surveyedAt, rules: rules.length }, runtime,
    configSet: { properties: propsFiles.map((f) => f.rel), profile: prodProfile, excludedProfiles },
    filesScanned: scanFiles.length, findings: kept, rules: results,
    summary: { total: kept.length, high: count("high"), medium: count("medium"), low: count("low"), suppressed: suppressedList.length, pass: results.filter((r) => r.status === "pass").length, fail: results.filter((r) => r.status === "fail").length, na: results.filter((r) => r.status === "n/a").length },
    grade: { grade, formula }, ignoreFile: ig.file, invalidIgnores: ig.invalid, notes,
  };
}

export function renderOperationsMarkdown(r: OperationsResult, topN = 50): string {
  const out: string[] = [];
  const s = r.summary;
  out.push(L(`# 운영 준비 점검 — ${r.projectDir}`, `# Operations readiness check — ${r.projectDir}`), ``);
  out.push(L(`등급 **${r.grade.grade}** · 미달 규칙 ${s.fail} / 통과 ${s.pass} / 해당 없음 ${s.na} · 항목 ${s.total}(높음 ${s.high} · 중간 ${s.medium} · 낮음 ${s.low})${s.suppressed ? ` · 예외 ${s.suppressed}` : ""} · 실행 ${r.runtime} · 파일 ${r.filesScanned} · 규칙 ${r.rulesVersion.rules}(${r.rulesVersion.surveyedAt})`, `Grade **${r.grade.grade}** · failed rules ${s.fail} / passed ${s.pass} / n/a ${s.na} · findings ${s.total} (high ${s.high} · medium ${s.medium} · low ${s.low})${s.suppressed ? ` · suppressed ${s.suppressed}` : ""} · runtime ${r.runtime} · files ${r.filesScanned} · rules ${r.rulesVersion.rules} (${r.rulesVersion.surveyedAt})`), ``);
  out.push(L("## 점검표", "## Checklist"), ``, L("| 규칙 | 심각도 | 결과 | 건수 |", "| Rule | Severity | Result | Findings |"), "|---|---|---|---|");
  for (const x of r.rules) out.push(`| ${x.title} \`${x.rule}\` | ${x.severity} | ${x.status === "pass" ? "✅" : x.status === "fail" ? "⚠️" : "➖"} ${x.status} | ${x.findings || ""} |`);
  out.push(``);
  if (r.findings.length) {
    out.push(L("## 미달 항목 (심각도순)", "## Findings (by severity)"), ``);
    let last = "";
    for (const f of r.findings.slice(0, topN)) {
      if (f.rule !== last) { if (last) out.push(``); last = f.rule; out.push(`### ${f.title} \`${f.rule}\` — ${f.severity}`, ``, `${f.message}`, ``, L(`- **조치**: ${f.fix}`, `- **Fix**: ${f.fix}`), L(`- **근거**: ${f.basis}`, `- **Basis**: ${f.basis}`), ``); }
      out.push(`- \`${f.file}:${f.line}\` \`${f.code}\`${f.suggestion ? L(` → 제안 \`${f.suggestion}\``, ` → suggest \`${f.suggestion}\``) : ""}`);
    }
    if (r.findings.length > topN) out.push(L(`- … ${r.findings.length - topN}건 더(format=json)`, `- … ${r.findings.length - topN} more (format=json)`));
    out.push(``);
  }
  out.push(L(`등급 산식: ${r.grade.formula}`, `Grade formula: ${r.grade.formula}`), ``);
  for (const n of r.notes) out.push(`- ${n}`);
  out.push(``, L(`값은 고치지 않습니다 — 제안은 부하·DB 정책에 맞춰 사람이 정합니다. 예외는 ${OPS_IGNORE_FILE}(rule·path·reason·reviewer). 공식 운영 기준 문서가 없어 근거는 템플릿 기본값·HikariCP/Spring Boot/Tomcat 문서·실측입니다.`, `Nothing is changed — suggestions are decided by people against load and DB policy. Exceptions go in ${OPS_IGNORE_FILE} (rule, path, reason, reviewer). With no official operations baseline, the basis is template defaults, HikariCP/Spring Boot/Tomcat docs and measurements.`));
  return out.join("\n");
}
