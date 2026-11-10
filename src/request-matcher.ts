// Spring Security 6.5 폐기 예정 RequestMatcher 전환 (v1.18.0)
//   AntPathRequestMatcher·MvcRequestMatcher 는 6.5 에서 @Deprecated(forRemoval = true), 대체는 PathPatternRequestMatcher.
//   5.x parent 는 모두 Spring Security 6.5.x(5.0.x: 6.5.5, 5.1.0: 6.5.11-egov.1)라 갱신 모드에서 항상 본다.
//   한 파일의 모든 사용처가 기계적으로 바뀔 수 있을 때만 auto(문자열 리터럴 패턴·HTTP 메서드, 타입 이름)로 치환하고,
//   하나라도 아니면(변수 패턴·대소문자 옵션·static import·MvcRequestMatcher·끝이 아닌 ** 패턴) 파일 전체를 manual 로 남긴다.
import type { MigrationItem, TextEdit } from "./migrate.js";
import { lineAt } from "./migrate.js";
import { L } from "./lang.js";

const PPRM = "PathPatternRequestMatcher";
const PPRM_FQN = "org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher";
const HTTP_METHOD_FQN = "org.springframework.http.HttpMethod";
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]);

/** 주석을 같은 길이의 공백으로(문자열은 남김, strings=true 면 문자열 내용도 공백) — 오프셋 보존 */
export function maskJavaComments(src: string, strings = false): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1;
      const keep = (t: string) => (strings && t.length > 2 ? t[0] + t.slice(1, -1).replace(/[^\n]/g, " ") + t[t.length - 1] : t);
      if (q === '"' && src.startsWith('"""', i)) { const end = src.indexOf('"""', i + 3); j = end < 0 ? src.length : end + 3; out += keep(src.slice(i, j)); i = j; continue; }
      while (j < src.length && src[j] !== q && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
      out += keep(src.slice(i, j + 1)); i = j + 1; continue;
    }
    if (c === "/" && n === "/") { const end = src.indexOf("\n", i); const j = end < 0 ? src.length : end; out += " ".repeat(j - i); i = j; continue; }
    if (c === "/" && n === "*") { const end = src.indexOf("*/", i + 2); const j = end < 0 ? src.length : end + 2; out += src.slice(i, j).replace(/[^\n]/g, " "); i = j; continue; }
    out += c; i++;
  }
  return out;
}

/** 여는 괄호 위치에서 짝 괄호까지의 인자(최상위 쉼표로 나눔). 실패 시 null */
function readArgs(src: string, open: number): { args: string[]; end: number } | null {
  let depth = 0; const args: string[] = []; let cur = "";
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"') { let j = i + 1; while (j < src.length && src[j] !== '"') { if (src[j] === "\\") j++; j++; } cur += src.slice(i, j + 1); i = j; continue; }
    if (c === "(") { depth++; if (depth === 1) continue; }
    if (c === ")") { depth--; if (depth === 0) { if (cur.trim() || args.length) args.push(cur.trim()); return { args, end: i + 1 }; } }
    if (c === "," && depth === 1) { args.push(cur.trim()); cur = ""; continue; }
    if (depth >= 1) cur += c;
  }
  return null;
}

/** PathPattern 으로 그대로 옮길 수 있는 Ant 패턴인가 — "**" 는 맨 끝 "/**" 만 허용 */
export function pathPatternCompatible(pattern: string): { ok: true } | { ok: false; reason: string } {
  if (!pattern.startsWith("/")) return { ok: false, reason: L("패턴이 / 로 시작하지 않음", "pattern does not start with /") };
  const inner = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
  if (inner.includes("**")) return { ok: false, reason: L("PathPattern 은 ** 를 패턴 끝에만 허용(예: /a/**/b.do 는 기동·요청 시 오류) — 패턴을 나누거나 정규식 matcher 로", "PathPattern only allows ** at the end (e.g. /a/**/b.do fails) — split the pattern or use a regex matcher") };
  return { ok: true };
}

const stringLiteral = (a: string): string | null => { const m = a.match(/^"((?:[^"\\]|\\.)*)"$/); return m ? m[1] : null; };
const methodOf = (a: string): string | null => { const s = stringLiteral(a); if (s !== null) return METHODS.has(s.toUpperCase()) ? s.toUpperCase() : null; const m = a.match(/^(?:org\.springframework\.http\.)?HttpMethod\.([A-Z]+)(?:\.name\(\))?$/); return m && METHODS.has(m[1]) ? m[1] : null; };

/** 한 Java 파일의 AntPathRequestMatcher·MvcRequestMatcher 사용을 항목으로. 사용이 없으면 [] */
export function planRequestMatcherItems(rel: string, text: string): MigrationItem[] {
  if (!/\b(AntPathRequestMatcher|MvcRequestMatcher)\b/.test(text)) return [];
  const src = maskJavaComments(text);
  const code = maskJavaComments(text, true); // 사용처 찾기용(문자열 안 이름 제외)
  const importRe = /^[ \t]*import\s+(static\s+)?org\.springframework\.security\.web\.(?:util|servlet\.util)\.matcher\.(AntPathRequestMatcher|MvcRequestMatcher)(\.[\w.*]+)?\s*;[ \t]*\r?\n?/gm;
  const imports: { start: number; end: number; static: boolean; cls: string }[] = [];
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(src))) imports.push({ start: im.index, end: im.index + im[0].length, static: !!im[1] || !!im[3], cls: im[2] });
  const inImport = (i: number) => imports.some((x) => i >= x.start && i < x.end);
  type Use = { at: number; line: number; cls: string; edit: TextEdit | null; to: string; why?: string; needsHttpMethod?: boolean };
  const uses: Use[] = [];
  const re = /\b(AntPathRequestMatcher|MvcRequestMatcher)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (inImport(m.index)) continue;
    const cls = m[1], at = m.index, line = lineAt(text, at);
    const before = src.slice(Math.max(0, at - 12), at), after = src.slice(at + cls.length);
    if (cls === "MvcRequestMatcher") { uses.push({ at, line, cls, edit: null, to: `${PPRM}.withDefaults().matcher(…)`, why: L("MvcRequestMatcher(서블릿 경로·HandlerMappingIntrospector)는 PathPatternRequestMatcher.withDefaults().basePath(…) 로 옮길 때 서블릿 경로를 사람이 정해야 함", "MvcRequestMatcher (servlet path, HandlerMappingIntrospector) needs a human to choose the servlet path when moving to PathPatternRequestMatcher.withDefaults().basePath(…)") }); continue; }
    const ctor = /\bnew\s+$/.test(before);
    const factory = after.match(/^\s*\.\s*antMatcher\s*(?=\()/);
    if (ctor || factory) {
      const open = at + cls.length + (factory ? factory[0].length : after.match(/^\s*/)![0].length);
      if (src[open] !== "(") { uses.push({ at, line, cls, edit: null, to: `${PPRM}.withDefaults().matcher(…)`, why: L("생성 형태를 해석하지 못함", "could not parse the construction") }); continue; }
      const parsed = readArgs(src, open);
      if (!parsed) { uses.push({ at, line, cls, edit: null, to: `${PPRM}.withDefaults().matcher(…)`, why: L("인자를 해석하지 못함", "could not parse the arguments") }); continue; }
      const start = ctor ? at - before.match(/new\s+$/)![0].length : at;
      let pattern: string | null = null, method: string | null = null, why: string | undefined;
      const a = parsed.args;
      if (ctor) {
        if (a.length === 1) pattern = stringLiteral(a[0]);
        else if (a.length === 2) { pattern = stringLiteral(a[0]); method = methodOf(a[1]); if (!method) why = L("HTTP 메서드 인자가 리터럴이 아님", "HTTP method argument is not a literal"); }
        else why = L("대소문자 구분·UrlPathHelper 인자 — PathPattern 은 대소문자를 구분(기본)하므로 의도를 확인", "case-sensitivity / UrlPathHelper argument — PathPattern is case-sensitive by default, confirm the intent");
      } else {
        if (a.length === 1) { method = methodOf(a[0]); pattern = method ? "/**" : stringLiteral(a[0]); }
        else if (a.length === 2) { method = methodOf(a[0]); pattern = stringLiteral(a[1]); if (!method) why = L("HTTP 메서드 인자가 리터럴이 아님", "HTTP method argument is not a literal"); }
      }
      if (pattern === null && !why) why = L("패턴이 문자열 리터럴이 아님(설정·변수) — 값이 PathPattern 문법(** 는 끝에만)인지 확인하고 PathPatternRequestMatcher.withDefaults().matcher(값) 으로", "pattern is not a string literal (config or variable) — check the values follow PathPattern syntax (** only at the end), then use PathPatternRequestMatcher.withDefaults().matcher(value)");
      if (pattern !== null && !why) { const ok = pathPatternCompatible(pattern); if (!ok.ok) why = ok.reason; }
      const to = `${PPRM}.withDefaults().matcher(${method ? `HttpMethod.${method}, ` : ""}${pattern !== null ? `"${pattern}"` : "…"})`;
      uses.push({ at, line, cls, edit: why ? null : { start, end: parsed.end, replacement: to }, to, why, needsHttpMethod: !!method });
      continue;
    }
    if (/^\s*::\s*new\b/.test(after)) { uses.push({ at, line, cls, edit: null, to: `${PPRM}.withDefaults()::matcher`, why: L("생성자 참조 — PathPatternRequestMatcher.Builder 의 matcher 메서드 참조로", "constructor reference — use a method reference to PathPatternRequestMatcher.Builder::matcher") }); continue; }
    if (/^\s*\./.test(after)) { uses.push({ at, line, cls, edit: null, to: PPRM, why: L("정적 멤버 사용", "static member use") }); continue; }
    // 타입 이름(선언·제네릭·캐스트)
    uses.push({ at, line, cls, edit: { start: at, end: at + cls.length, replacement: PPRM }, to: PPRM });
  }
  if (!uses.length) return [];
  const staticImport = imports.some((x) => x.static);
  const allAuto = !staticImport && uses.every((u) => u.edit) && uses.some((u) => u.edit && u.edit.replacement !== PPRM);
  const reasonBase = L("Spring Security 6.5 에서 AntPathRequestMatcher·MvcRequestMatcher 는 폐기 예정(forRemoval) — 다음 메이저에서 사라짐. 5.x parent 는 모두 6.5.x 입니다", "AntPathRequestMatcher and MvcRequestMatcher are deprecated for removal in Spring Security 6.5 and go away in the next major; every 5.x parent ships 6.5.x");
  if (!allAuto) {
    const seen = new Set<number>();
    return uses.filter((u) => !seen.has(u.line) && seen.add(u.line)).map((u) => ({ file: rel, line: u.line, kind: "deprecated-api" as const, from: u.cls, to: u.to, action: "manual" as const, reason: `${reasonBase}. ${staticImport ? L("static import 를 쓰고 있어 자동 치환하지 않음", "static import in use, not rewritten automatically") : u.why ?? L("같은 파일에 자동으로 바꿀 수 없는 사용이 있어 파일 단위로 남김", "another use in this file cannot be rewritten automatically, so the file is left as a whole")}` }));
  }
  // auto: 사용처 + import 정리(같은 파일 안 모두)
  const needsHttp = uses.some((u) => u.needsHttpMethod) && !new RegExp(`^\\s*import\\s+${HTTP_METHOD_FQN.replace(/\./g, "\\.")}\\s*;`, "m").test(src) && !/^\s*import\s+org\.springframework\.http\.\*\s*;/m.test(src);
  const hasPprmImport = new RegExp(`^\\s*import\\s+${PPRM_FQN.replace(/\./g, "\\.")}\\s*;`, "m").test(src);
  const importEdits: TextEdit[] = [];
  imports.forEach((x, i) => {
    const eol = text.slice(x.start, x.end).match(/\r?\n$/)?.[0] ?? "\n";
    const replacement = i === 0 && !hasPprmImport ? `import ${PPRM_FQN};${eol}${needsHttp ? `import ${HTTP_METHOD_FQN};${eol}` : ""}` : "";
    importEdits.push({ start: x.start, end: x.end, replacement });
  });
  if (!imports.length) {
    // 와일드카드 import(…web.util.matcher.*)로 쓰던 파일 — 새 클래스는 다른 패키지라 import 를 더한다
    const add = [...(!hasPprmImport && !/^\s*import\s+org\.springframework\.security\.web\.servlet\.util\.matcher\.\*\s*;/m.test(src) ? [`import ${PPRM_FQN};\n`] : []), ...(needsHttp ? [`import ${HTTP_METHOD_FQN};\n`] : [])];
    if (add.length) { const pkg = src.match(/^\s*package\s+[\w.]+\s*;[ \t]*\r?\n/m); const at = pkg ? pkg.index! + pkg[0].length : 0; importEdits.push({ start: at, end: at, replacement: add.join("") }); }
  }
  return uses.map((u, i) => ({ file: rel, line: u.line, kind: "deprecated-api" as const, from: u.cls, to: u.to, action: "auto" as const, reason: `${reasonBase}. ${L("리터럴 패턴·HTTP 메서드라 그대로 옮김(PathPattern 은 끝이 아닌 ** 를 허용하지 않음 — 이 파일 패턴은 해당 없음)", "literal pattern and HTTP method, rewritten as is (PathPattern rejects a non-trailing ** — none in this file)")}`, edits: i === 0 ? [u.edit!, ...importEdits] : [u.edit!] }));
}

/**
 * v1.18: JUnit Jupiter 6 의 org.junit.jupiter.api.MediaType 과 다른 패키지의 MediaType 이 둘 다 와일드카드 import 로 들어오면
 * 단순 이름 MediaType 이 모호해 컴파일되지 않는다(공식 simple-backend 테스트 실측). 단일 import 가 와일드카드보다 우선하므로
 * 쓰던 쪽(org.springframework.http 등)을 단일 import 로 더한다.
 */
export function planJunit6Items(rel: string, text: string): MigrationItem[] {
  const src = maskJavaComments(text);
  if (!/^\s*import\s+org\.junit\.jupiter\.api\.\*\s*;/m.test(src)) return [];
  if (/^\s*import\s+[\w.]+\.MediaType\s*;/m.test(src)) return [];
  const others = ["org.springframework.http", "jakarta.ws.rs.core", "javax.ws.rs.core", "com.google.common.net"].filter((p) => new RegExp(`^\\s*import\\s+${p.replace(/\./g, "\\.")}\\.\\*\\s*;`, "m").test(src));
  if (others.length !== 1) return [];
  const body = maskJavaComments(text, true).replace(/^\s*import\s+[^;]+;/gm, (x) => " ".repeat(x.length));
  const use = /\bMediaType\b/.exec(body);
  if (!use) return [];
  const im = new RegExp(`^[ \\t]*import\\s+${others[0].replace(/\./g, "\\.")}\\.\\*\\s*;[ \\t]*(\\r?\\n)`, "m").exec(text)!;
  const at = im.index + im[0].length;
  return [{ file: rel, line: lineAt(text, use.index), kind: "library-change" as MigrationItem["kind"], from: "MediaType", to: `${others[0]}.MediaType`, action: "auto", reason: L("JUnit Jupiter 6(5.1.0 parent)에 org.junit.jupiter.api.MediaType 이 생겨 org.junit.jupiter.api.* 와 " + others[0] + ".* 를 함께 와일드카드 import 한 파일에서 MediaType 이 모호해짐 — 단일 import 추가", "JUnit Jupiter 6 (5.1.0 parent) adds org.junit.jupiter.api.MediaType, so MediaType becomes ambiguous where org.junit.jupiter.api.* and " + others[0] + ".* are both wildcard-imported — add a single-type import"), edits: [{ start: at, end: at, replacement: `import ${others[0]}.MediaType;${im[1]}` }] }];
}
