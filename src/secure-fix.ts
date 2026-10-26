// 보안약점 자동 조치 (fix_egovframe_secure_coding, v1.7.0)
//   check_egovframe_secure_coding 이 찾은 항목 중 고친 결과를 규칙으로 정할 수 있는 것만 고친다. 나머지는 사유와 함께 수동 항목으로 남긴다.
//   - xss-cout-unescaped: 줄바꿈 치환(fn:replace(x, crlf, '<br/>'))은 x 를 먼저 fn:escapeXml 로 감싸고, 단순 값은 escapeXml="false" 를 지운다.
//     본문(…Cn·…Dc·…Cntnt 등 HTML 편집기 값일 수 있는 이름)은 수동.
//   - print-stack-trace: 클래스의 로거 필드(SLF4J·Commons Logging·Log4j 2·Log4j 1, Lombok @Slf4j 등)로 logger.error(e.getMessage(), e).
//   - debug-code: System.out.println(x) → logger.debug(…), System.err.println(x) → logger.error(…). 로거가 없거나 정적 메서드에서
//     인스턴스 로거를 써야 하면 수동.
//   - cookie-flags: Secure·HttpOnly 는 HTTP 배포·스크립트의 쿠키 읽기를 바꾸므로 고치지 않고 제안 줄만 낸다.
//   기본은 dryRun(계획·변경 줄·재점검 결과만). 적용은 파일 트랜잭션(백업 migration-backup/<시각>-secure-fix-…, 실패 시 복구)이다.
//   고친 뒤 같은 규칙으로 다시 점검해 사라진 지문이 고친 항목과 같고 다른 규칙의 지문은 그대로인지 확인한다.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { checkSecureCoding, findHtmlTagFilter, stripJavaComments, type SecureFinding } from "./secure-coding.js";
import { withFileTransaction } from "./file-transaction.js";
import { blankJavaLiterals, findMethods } from "./java-flow.js";
import { L } from "./lang.js";

export const FIXABLE_RULES = ["xss-cout-unescaped", "print-stack-trace", "debug-code", "cookie-flags"] as const;
export type FixableRule = (typeof FIXABLE_RULES)[number];

/** HTML 편집기 값일 수 있는 필드 이름(끝) — escape 하면 태그가 글자로 보일 수 있어 수동 */
export const HTML_FIELD_RE = /(Cn|Cntnt|Content|Contents|Html|Dc|Df|Body|Memo|Desc|Description)$/i;

export interface FixChange { line: number; before: string; after: string }
export interface FixFile { path: string; rules: string[]; edits: number; changes: FixChange[] }
export interface FixManual { rule: string; file: string; line: number; code: string; reason: string; suggestion?: string }
export interface SecureFixOptions {
  projectDir: string;
  rules?: string[];
  paths?: string[];
  /** 공통컴포넌트 출처(매니페스트·egovframework/com 경로)도 고침(기본 false) */
  includeComponents?: boolean;
  /** src/test 도 고침(기본 false) */
  includeTests?: boolean;
  /** 기본 true — 파일을 쓰지 않음 */
  dryRun?: boolean;
  /** HTMLTagFilter(요청 값을 엔티티로 바꿔 저장)가 등록돼 있어도 c:out 을 고침(기본 false — 두 번 escape 돼 화면이 바뀌므로 수동) */
  ignoreHtmlTagFilter?: boolean;
  /** 테스트용: 적용 중 실패 주입 */
  faultInjection?: "after-files";
}
export interface SecureFixResult {
  projectDir: string;
  dryRun: boolean;
  summary: { candidates: number; fixed: number; manual: number; excluded: number; files: number };
  byRule: { rule: string; candidates: number; fixed: number; manual: number; excluded: number }[];
  files: FixFile[];
  manual: FixManual[];
  /** 고친 파일만 다시 점검한 결과 */
  verify: { before: number; after: number; removed: number; expectedRemoved: number; otherRulesUnchanged: boolean; ok: boolean; unexpected: string[] };
  backupDir?: string;
  planPath?: string;
  /** v1.7: 프로젝트에 등록된 HTMLTagFilter(있으면 그 위치) */
  htmlTagFilter?: string | null;
  notes: string[];
}

// ── 로거 ─────────────────────────────────────────────────
export interface LoggerField { name: string; isStatic: boolean; kind: "slf4j" | "commons" | "log4j2" | "log4j" | "lombok" }

/** 클래스의 로거 필드(첫 번째). java.util.logging 은 error 가 없어 제외. 주석은 지운 소스를 받는다. */
export function findLogger(clean: string): LoggerField | null {
  const lombok = /@(Slf4j|Log4j2|CommonsLog|Log4j)\b/.exec(clean);
  if (lombok) return { name: "log", isStatic: true, kind: lombok[1] === "Slf4j" ? "slf4j" : lombok[1] === "Log4j2" ? "log4j2" : lombok[1] === "CommonsLog" ? "commons" : "log4j" };
  const imports = {
    slf4j: /import\s+org\.slf4j\.Logger\s*;/.test(clean),
    log4j2: /import\s+org\.apache\.logging\.log4j\.Logger\s*;/.test(clean),
    log4j: /import\s+org\.apache\.log4j\.Logger\s*;/.test(clean),
    commons: /import\s+org\.apache\.commons\.logging\.Log\s*;/.test(clean),
  };
  const re = /(^|[;{}\s])((?:(?:private|protected|public|static|final|transient)\s+)*)((?:org\.slf4j\.|org\.apache\.logging\.log4j\.|org\.apache\.log4j\.)?Logger|(?:org\.apache\.commons\.logging\.)?Log)\s+([A-Za-z_]\w*)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const type = m[3];
    let kind: LoggerField["kind"] | null = null;
    if (type.startsWith("org.slf4j.")) kind = "slf4j";
    else if (type.startsWith("org.apache.logging.log4j.")) kind = "log4j2";
    else if (type.startsWith("org.apache.log4j.")) kind = "log4j";
    else if (type.endsWith("Log") && type !== "Logger") kind = imports.commons || type.startsWith("org.apache.commons") ? "commons" : null;
    else kind = imports.slf4j ? "slf4j" : imports.log4j2 ? "log4j2" : imports.log4j ? "log4j" : null;
    if (!kind) continue;
    return { name: m[4], isStatic: /\bstatic\b/.test(m[2]), kind };
  }
  return null;
}

/** offset 을 감싸는 메서드들 중 하나라도 static 인지(익명 클래스·람다 안이어도 바깥 static 메서드면 인스턴스 필드를 못 씀) */
function inStaticContext(skel: string, offset: number): boolean | null {
  const ms = findMethods(skel).filter((x) => x.bodyStart <= offset && offset <= x.bodyEnd);
  if (!ms.length) return null;
  return ms.some((x) => {
    let h = x.bodyStart - 2;
    while (h >= 0 && skel[h] !== ";" && skel[h] !== "{" && skel[h] !== "}") h--;
    return /\bstatic\b/.test(skel.slice(h + 1, x.bodyStart - 1));
  });
}

/** 괄호 짝이 맞는 단일 인자인지(문자열 리터럴 안의 괄호는 무시) */
function balancedArg(arg: string): boolean {
  const s = blankJavaLiterals(arg);
  let d = 0;
  for (const ch of s) { if (ch === "(") d++; else if (ch === ")") { d--; if (d < 0) return false; } }
  return d === 0 && arg.trim().length > 0;
}
/** 최상위 쉼표가 있는지(println 은 인자 하나) */
function hasTopComma(arg: string): boolean {
  const s = blankJavaLiterals(arg);
  let d = 0;
  for (const ch of s) { if ("([{".includes(ch)) d++; else if (")]}".includes(ch)) d--; else if (ch === "," && d === 0) return true; }
  return false;
}

// ── 줄 단위 조치 ─────────────────────────────────────────
type LineFix = { after: string } | { manual: string; suggestion?: string };

/** JSP 한 줄의 <c:out … escapeXml="false"> 를 고친다. 한 줄의 태그를 모두 고칠 수 있을 때만 바꾼다(항목은 줄 단위). */
export function fixCoutLine(line: string): LineFix {
  const TAG = /<c:out\b(?:[^>"']|"[^"]*"|'[^']*')*?\/?>/g;
  let changed = false, reason = "";
  const out = line.replace(TAG, (tag) => {
    const esc = /\s+escapeXml\s*=\s*(["'])false\1/.exec(tag);
    if (!esc) return tag;
    const vm = /\bvalue\s*=\s*(["'])([\s\S]*?)\1/.exec(tag);
    if (!vm) { reason ||= L("value 속성을 읽지 못함", "could not read the value attribute"); return tag; }
    const value = vm[2];
    // (1) 줄바꿈을 <br/> 로 바꾸는 값: 먼저 escape 한 뒤 바꾼다(줄바꿈 표시는 그대로, escapeXml="false" 유지)
    const rep = /^\$\{\s*fn:replace\(\s*([^,()]+?)\s*,\s*([A-Za-z_][\w.]*|'[^']*'|"[^"]*")\s*,\s*('<br\s*\/?>'|"<br\s*\/?>")\s*\)\s*\}$/.exec(value.trim());
    if (rep) {
      changed = true;
      return tag.replace(vm[0], vm[0].replace(value, value.replace(rep[1], `fn:escapeXml(${rep[1]})`)));
    }
    if (/fn:escapeXml\s*\(/.test(value)) return tag; // 이미 escape 한 값
    // (2) 단순 속성 경로(와 일반 글자)만: escapeXml="false" 를 지운다
    const exprs = [...value.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1].trim());
    const literal = value.replace(/\$\{[^}]*\}/g, "");
    if (!exprs.length || exprs.some((e) => !/^[A-Za-z_]\w*(\s*(\.\s*[A-Za-z_]\w*|\[\s*\d+\s*\]))*$/.test(e)) || /[<>&]/.test(literal)) {
      reason ||= L("값이 단순 속성이 아님(식·함수·HTML 조각) — 화면 출력을 확인하고 수동으로", "value is not a plain property (expression, function or HTML) — review the output manually");
      return tag;
    }
    const html = exprs.map((e) => e.split(/[.\[]/).map((x) => x.replace(/\]$/, "").trim()).filter(Boolean).pop()!).find((n) => HTML_FIELD_RE.test(n));
    if (html) {
      reason ||= L(`본문 필드(${html}) — HTML 편집기 값이면 escape 시 태그가 글자로 보입니다. 저장 시 허용 태그 필터(XSS 필터·Lucy)를 적용한 뒤 판단`, `body field (${html}) — if it holds HTML editor output, escaping shows the tags as text. Decide after applying an allow-list filter (XSS filter, Lucy) on save`);
      return tag;
    }
    changed = true;
    return tag.replace(esc[0], "");
  });
  if (reason) return { manual: changed ? L(`같은 줄의 다른 c:out 을 고칠 수 없어 줄 전체를 수동으로 — ${reason}`, `another c:out on the same line cannot be fixed, so the whole line is manual — ${reason}`) : reason };
  return changed ? { after: out } : { manual: L("고칠 수 있는 c:out 을 찾지 못함", "no fixable c:out found") };
}

/** Java 한 줄의 e.printStackTrace(); / System.out.println(x); 를 로거 호출로. */
export function fixJavaLine(rule: "print-stack-trace" | "debug-code", line: string, logger: LoggerField | null, staticCtx: boolean | null): LineFix {
  if (!logger) return { manual: L("클래스에 로거 필드가 없음(SLF4J·Commons Logging·Log4j) — 로거를 선언한 뒤 다시 실행하거나 수동으로", "the class has no logger field (SLF4J, Commons Logging, Log4j) — declare one and re-run, or fix manually") };
  if (staticCtx && !logger.isStatic) return { manual: L(`정적 메서드에서 인스턴스 로거(${logger.name})를 쓸 수 없음 — 로거를 static 으로 바꾸거나 수동으로`, `an instance logger (${logger.name}) cannot be used in a static context — make it static or fix manually`) };
  if (rule === "print-stack-trace") {
    const m = /^(\s*)([A-Za-z_]\w*)\s*\.\s*printStackTrace\s*\(\s*\)\s*;(\s*(\/\/.*)?)$/.exec(line);
    if (!m) return { manual: L("문장 하나짜리 `e.printStackTrace();` 줄이 아님", "not a single `e.printStackTrace();` statement line") };
    return { after: `${m[1]}${logger.name}.error(${m[2]}.getMessage(), ${m[2]});${m[3]}` };
  }
  const m = /^(\s*)System\s*\.\s*(out|err)\s*\.\s*println\s*\((.*)\)\s*;(\s*(\/\/.*)?)$/.exec(line);
  if (!m) return { manual: L("문장 하나짜리 `System.out.println(…);` 줄이 아님(print·printf·여러 줄은 수동)", "not a single-line `System.out.println(…);` statement (print, printf and multi-line need manual work)") };
  const arg = m[3].trim();
  if (!balancedArg(arg) || hasTopComma(arg)) return { manual: L("인자를 하나로 읽지 못함", "could not read a single argument") };
  const str = /^"/.test(arg) ? arg : `String.valueOf(${arg})`;
  return { after: `${m[1]}${logger.name}.${m[2] === "out" ? "debug" : "error"}(${str});${m[4]}` };
}

// ── 본체 ─────────────────────────────────────────────────
const isComponentOrigin = (o: SecureFinding["origin"]) => o === "component" || o === "component-modified" || o === "component-unmanaged";

export async function fixSecureCoding(opts: SecureFixOptions): Promise<SecureFixResult> {
  const projectDir = path.resolve(opts.projectDir);
  const dryRun = opts.dryRun !== false;
  const rules = (opts.rules?.length ? opts.rules : [...FIXABLE_RULES]);
  const bad = rules.filter((r) => !(FIXABLE_RULES as readonly string[]).includes(r));
  if (bad.length) throw new Error(L(`조치할 수 없는 규칙: ${bad.join(", ")} (가능: ${FIXABLE_RULES.join(", ")})`, `Rules without a fix: ${bad.join(", ")} (available: ${FIXABLE_RULES.join(", ")})`));
  const scan = await checkSecureCoding({ projectDir, rules, paths: opts.paths, includeTests: true, dataFlow: false, maxFindings: 1_000_000 });
  const notes: string[] = [];
  const stat = new Map<string, { candidates: number; fixed: number; manual: number; excluded: number }>(rules.map((r) => [r, { candidates: 0, fixed: 0, manual: 0, excluded: 0 }]));
  const manual: FixManual[] = [];
  const byFile = new Map<string, SecureFinding[]>();
  for (const f of scan.findings) {
    const s = stat.get(f.rule)!;
    s.candidates++;
    if ((isComponentOrigin(f.origin) && !opts.includeComponents) || (f.origin === "test" && !opts.includeTests)) { s.excluded++; continue; }
    (byFile.get(f.file) ?? byFile.set(f.file, []).get(f.file)!).push(f);
  }

  // HTMLTagFilter 는 요청 값을 엔티티(&lt; 등)로 바꿔 저장하므로, 그런 프로젝트의 escapeXml="false" 는 두 번 escape 를 피하려는 설계다
  const tagFilter = rules.includes("xss-cout-unescaped") ? findHtmlTagFilter(projectDir) : null;
  const xssBlocked = !!tagFilter && !opts.ignoreHtmlTagFilter;
  if (tagFilter) notes.push(xssBlocked
    ? L(`HTMLTagFilter 가 등록돼 있습니다(${tagFilter}) — 요청 값을 엔티티로 바꿔 저장하므로 escapeXml 을 지우면 화면에 &amp;lt; 처럼 두 번 바뀌어 보입니다. c:out 항목은 수동으로 두었습니다. 필터를 걷어내고 출력 escape 로 바꾸는 경우에만 ignoreHtmlTagFilter=true 로 다시 실행하세요.`, `HTMLTagFilter is registered (${tagFilter}) — it stores request values as entities, so removing escapeXml would double-escape (&amp;lt;) on screen. c:out findings were left manual. Re-run with ignoreHtmlTagFilter=true only if you remove the filter and switch to output escaping.`)
    : L(`HTMLTagFilter(${tagFilter})가 있지만 ignoreHtmlTagFilter=true 로 c:out 을 고쳤습니다 — 필터를 함께 걷어내야 두 번 escape 되지 않습니다.`, `HTMLTagFilter (${tagFilter}) is present but c:out was fixed because ignoreHtmlTagFilter=true — remove the filter as well to avoid double escaping.`));
  const files: FixFile[] = [];
  const newTexts = new Map<string, { before: string; after: string }>();
  const expectedGone = new Map<string, number>(); // 고친 항목(규칙·파일·코드 줄) → 건수
  for (const [rel, list] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const before = fs.readFileSync(path.join(projectDir, rel), "utf8");
    const lines = before.split("\n");
    const isJava = rel.toLowerCase().endsWith(".java");
    const clean = isJava ? stripJavaComments(before) : "";
    const skel = isJava ? blankJavaLiterals(clean) : "";
    const logger = isJava ? findLogger(clean) : null;
    const lineStart = (i: number) => { let off = 0; for (let k = 0; k < i; k++) off += lines[k].length + 1; return off; };
    const changes: FixChange[] = [];
    const touched = new Map<number, string>(); // 줄 → 고친 내용(같은 줄의 여러 항목은 한 번에)
    const rulesHere = new Set<string>();
    for (const f of list.sort((a, b) => a.line - b.line)) {
      const i = f.line - 1;
      const raw = lines[i] ?? "";
      const cr = raw.endsWith("\r") ? "\r" : "";
      const cur = touched.get(i) ?? raw.slice(0, raw.length - cr.length);
      const s = stat.get(f.rule)!;
      if (f.rule === "cookie-flags") {
        const v = /(\b[A-Za-z_]\w*)\s*=\s*new\s+[\w.]*Cookie\s*\(/.exec(cur)?.[1];
        manual.push({ rule: f.rule, file: rel, line: f.line, code: f.code, reason: L("Secure 는 HTTP 로 서비스하면 쿠키가 전송되지 않고, HttpOnly 는 스크립트가 쿠키를 읽으면 동작이 바뀌어 자동으로 고치지 않음", "Secure stops the cookie over plain HTTP and HttpOnly breaks scripts that read it, so this is not fixed automatically"), ...(v ? { suggestion: `${v}.setHttpOnly(true);\n${v}.setSecure(true);` } : {}) });
        s.manual++;
        continue;
      }
      if (f.rule === "xss-cout-unescaped" && xssBlocked) {
        manual.push({ rule: f.rule, file: rel, line: f.line, code: f.code, reason: L(`HTMLTagFilter(${tagFilter}) 사용 — 저장 값이 이미 엔티티라 escape 하면 두 번 바뀜`, `HTMLTagFilter (${tagFilter}) in use — stored values are already entities, so escaping would double them`) });
        s.manual++;
        continue;
      }
      const fx = f.rule === "xss-cout-unescaped" ? fixCoutLine(cur) : fixJavaLine(f.rule as "print-stack-trace" | "debug-code", cur, logger, isJava ? inStaticContext(skel, lineStart(i) + Math.max(0, f.column - 1)) : null);
      if ("after" in fx) {
        touched.set(i, fx.after);
        rulesHere.add(f.rule);
        s.fixed++;
        expectedGone.set(findingKey(f), (expectedGone.get(findingKey(f)) ?? 0) + 1);
      } else {
        manual.push({ rule: f.rule, file: rel, line: f.line, code: f.code, reason: fx.manual, ...(fx.suggestion ? { suggestion: fx.suggestion } : {}) });
        s.manual++;
      }
    }
    if (!touched.size) continue;
    for (const [i, after] of [...touched.entries()].sort((a, b) => a[0] - b[0])) {
      const raw = lines[i];
      const cr = raw.endsWith("\r") ? "\r" : "";
      changes.push({ line: i + 1, before: raw.slice(0, raw.length - cr.length), after });
      lines[i] = after + cr;
    }
    const after = lines.join("\n");
    newTexts.set(rel, { before, after });
    files.push({ path: rel, rules: [...rulesHere].sort(), edits: changes.length, changes });
  }

  // 같은 줄의 c:out 여러 개 중 일부만 escapeXml 이 지워진 경우 등은 재점검이 가린다
  const verify = await verifyFix(projectDir, rules, newTexts, expectedGone);
  if (!verify.ok) notes.push(L(`재점검이 예상과 다릅니다: ${verify.unexpected.slice(0, 5).join("; ")}`, `Re-check differs from the plan: ${verify.unexpected.slice(0, 5).join("; ")}`));
  const excluded = [...stat.values()].reduce((n, s) => n + s.excluded, 0);
  if (excluded && !opts.includeComponents) notes.push(L(`공통컴포넌트 출처 ${excluded}건은 고치지 않았습니다(includeComponents=true 로 포함). 공통컴포넌트는 업그레이드·재조립 때 원본으로 바뀔 수 있습니다.`, `${excluded} findings in common-component sources were left as is (include them with includeComponents=true). Component sources may be replaced on upgrade or reassembly.`));

  const summary = { candidates: scan.findings.length, fixed: [...stat.values()].reduce((n, s) => n + s.fixed, 0), manual: manual.length, excluded, files: files.length };
  const base: SecureFixResult = { projectDir, dryRun, summary, byRule: rules.map((r) => ({ rule: r, ...stat.get(r)! })), files, manual, verify, ...(rules.includes("xss-cout-unescaped") ? { htmlTagFilter: tagFilter } : {}), notes };
  if (dryRun || !files.length) {
    if (dryRun && files.length) notes.push(L("적용하려면 dryRun=false 로 다시 호출하세요. 원본은 migration-backup/ 에 보관되고, 실패하면 작업 전 상태로 되돌립니다.", "To apply, call again with dryRun=false. Originals are kept in migration-backup/ and the project is rolled back on failure."));
    return base;
  }
  if (!verify.ok) throw new Error(L(`재점검이 계획과 달라 적용하지 않습니다: ${verify.unexpected.slice(0, 5).join("; ")}`, `Not applied — the re-check differs from the plan: ${verify.unexpected.slice(0, 5).join("; ")}`));
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRel = path.join("migration-backup", `${ts}-secure-fix-${randomUUID()}`);
  const planRel = path.join(backupRel, "secure-fix-plan.json");
  await withFileTransaction(projectDir, L("보안약점 조치", "secure coding fix"), (tx) => {
    for (const [rel, { before }] of newTexts) {
      const cur = tx.readFile(rel);
      if (cur === null || cur.toString("utf8") !== before) throw new Error(L(`점검 이후 파일이 바뀌어 적용을 중단합니다: ${rel}`, `File changed since the check; aborting: ${rel}`));
    }
    for (const [rel, { before, after }] of newTexts) {
      tx.writeFile(path.join(backupRel, rel), before, { mustNotExist: true });
      tx.writeFile(rel, after);
    }
    const plan = { createdAt: new Date().toISOString(), tool: "fix_egovframe_secure_coding", summary, byRule: base.byRule, files: files.map((f) => ({ path: f.path, rules: f.rules, edits: f.edits })), manual };
    tx.writeFile(planRel, `${JSON.stringify(plan, null, 2)}\n`, { mustNotExist: true });
    if (opts.faultInjection === "after-files") throw new Error("secure-fix fault injection: after-files");
  });
  return { ...base, backupDir: path.join(projectDir, backupRel), planPath: path.join(projectDir, planRel) };
}

/** 지문 대신 규칙·파일·정규화한 코드 줄로 센다 — 같은 줄이 여럿인 파일에서 일부만 고치면 순번이 바뀌어 지문이 달라지기 때문 */
const findingKey = (f: Pick<SecureFinding, "rule" | "file" | "code">) => `${f.rule}|${f.file}|${f.code.replace(/\s+/g, " ")}`;
const countKeys = (fs: SecureFinding[]) => { const m = new Map<string, number>(); for (const f of fs) m.set(findingKey(f), (m.get(findingKey(f)) ?? 0) + 1); return m; };

/** 고친 파일만 임시 디렉터리에 같은 경로로 두고 전·후를 점검해, 사라진 항목이 고친 항목과 같고 새 항목·다른 규칙 변화가 없는지 본다. */
async function verifyFix(projectDir: string, rules: string[], newTexts: Map<string, { before: string; after: string }>, expectedGone: Map<string, number>): Promise<SecureFixResult["verify"]> {
  const expectedRemoved = [...expectedGone.values()].reduce((a, b) => a + b, 0);
  if (!newTexts.size) return { before: 0, after: 0, removed: 0, expectedRemoved, otherRulesUnchanged: true, ok: true, unexpected: [] };
  const mk = (side: "before" | "after") => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), `egov-secfix-${side}-`));
    for (const [rel, t] of newTexts) { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t[side]); }
    return d;
  };
  const b = mk("before"), a = mk("after");
  try {
    const [rb, ra] = await Promise.all([checkSecureCoding({ projectDir: b, dataFlow: false, maxFindings: 1_000_000 }), checkSecureCoding({ projectDir: a, dataFlow: false, maxFindings: 1_000_000 })]);
    const cb = countKeys(rb.findings), ca = countKeys(ra.findings);
    const unexpected: string[] = [];
    let removed = 0, otherRulesUnchanged = true;
    for (const k of new Set([...cb.keys(), ...ca.keys()])) {
      const before = cb.get(k) ?? 0, after = ca.get(k) ?? 0, want = before - (expectedGone.get(k) ?? 0);
      removed += Math.max(0, before - after);
      if (after !== want) {
        const [rule, file] = k.split("|");
        if (!rules.includes(rule)) otherRulesUnchanged = false;
        unexpected.push(after > want ? L(`남거나 새로 생김 ${rule} ${file} (${after - want}건)`, `remaining or new ${rule} ${file} (${after - want})`) : L(`예상 밖으로 사라짐 ${rule} ${file} (${want - after}건)`, `unexpectedly gone ${rule} ${file} (${want - after})`));
      }
    }
    return { before: rb.findings.length, after: ra.findings.length, removed, expectedRemoved, otherRulesUnchanged, ok: unexpected.length === 0, unexpected };
  } finally {
    fs.rmSync(b, { recursive: true, force: true });
    fs.rmSync(a, { recursive: true, force: true });
  }
}

export function renderSecureFixMarkdown(r: SecureFixResult, top = 30): string {
  const out: string[] = [];
  out.push(L(`# 보안약점 조치 ${r.dryRun ? "계획(dryRun)" : "결과"}`, `# Secure coding fix ${r.dryRun ? "plan (dryRun)" : "result"}`), "");
  out.push(L(`- 경로: ${r.projectDir}`, `- Path: ${r.projectDir}`));
  out.push(L(`- 대상 ${r.summary.candidates}건 → ${r.dryRun ? "고칠 예정" : "고침"} ${r.summary.fixed} · 수동 ${r.summary.manual} · 공통컴포넌트·테스트 제외 ${r.summary.excluded} · 파일 ${r.summary.files}개`, `- ${r.summary.candidates} findings → ${r.dryRun ? "to fix" : "fixed"} ${r.summary.fixed} · manual ${r.summary.manual} · excluded (components, tests) ${r.summary.excluded} · ${r.summary.files} files`));
  const v = r.verify;
  out.push(L(`- 재점검(고친 파일): ${v.before} → ${v.after}건, 사라진 항목 ${v.removed}(계획 ${v.expectedRemoved}) · 다른 규칙 ${v.otherRulesUnchanged ? "변화 없음" : "변화 있음"} · ${v.ok ? "✅ 계획과 일치" : "⚠️ 계획과 다름"}`, `- Re-check (changed files): ${v.before} → ${v.after}, findings removed ${v.removed} (planned ${v.expectedRemoved}) · other rules ${v.otherRulesUnchanged ? "unchanged" : "changed"} · ${v.ok ? "✅ matches the plan" : "⚠️ differs from the plan"}`));
  if (r.backupDir) out.push(L(`- 백업: ${r.backupDir} (원본 + secure-fix-plan.json)`, `- Backup: ${r.backupDir} (originals + secure-fix-plan.json)`));
  for (const n of r.notes) out.push(`- ${n}`);
  out.push("", L("| 규칙 | 대상 | 고침 | 수동 | 제외 |", "| Rule | Findings | Fixed | Manual | Excluded |"), "|---|---|---|---|---|");
  for (const b of r.byRule) out.push(`| ${b.rule} | ${b.candidates} | ${b.fixed} | ${b.manual} | ${b.excluded} |`);
  if (r.files.length) {
    out.push("", L(`## 변경${r.dryRun ? " 미리보기" : ""}`, `## Changes${r.dryRun ? " (preview)" : ""}`));
    let shown = 0;
    for (const f of r.files) {
      if (shown >= top) { out.push("", L(`… 외 파일 ${r.files.length - r.files.indexOf(f)}개`, `… and ${r.files.length - r.files.indexOf(f)} more files`)); break; }
      out.push("", `### ${f.path} (${f.edits})`, "", "```diff");
      for (const c of f.changes.slice(0, 10)) out.push(`@@ L${c.line}`, `- ${c.before.trim()}`, `+ ${c.after.trim()}`);
      out.push("```");
      shown++;
    }
  }
  if (r.manual.length) {
    out.push("", L(`## 수동 항목 ${r.manual.length}건`, `## Manual items (${r.manual.length})`), "");
    for (const m of r.manual.slice(0, top)) out.push(`- ${m.rule} ${m.file}:${m.line} — ${m.reason}${m.suggestion ? L(` (제안: \`${m.suggestion.replace(/\n/g, " ")}\`)`, ` (suggestion: \`${m.suggestion.replace(/\n/g, " ")}\`)`) : ""}`);
    if (r.manual.length > top) out.push(L(`- … 외 ${r.manual.length - top}건`, `- … and ${r.manual.length - top} more`));
  }
  return out.join("\n");
}
