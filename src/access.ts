// 접근 통제 점검 (v1.24) — "있어야 할 검증이 없다"를 정적으로 찾는다. 읽기 전용.
//   1) 핸들러(컨트롤러 메서드)마다 URL·HTTP 메서드·하는 일(C·R·U·D)·검증 수준(없음 < 로그인 < 역할 < 소유권) = URL 권한 표
//   2) 전역 보호: Spring Security 설정·인증 인터셉터의 URL 패턴 → 전역에서 로그인으로 막히는 URL
//   3) 누락 의심: 검증 없는 변경 / 형제 핸들러보다 낮은 검증 / 소유권 비교 없는 수정·삭제 / 형제보다 낮은 상세 조회
//   판정은 규칙 데이터(catalog/access-rules.json)의 호출 사전 기반 휴리스틱이다 — 역할–URL 을 DB(보호자원)로 관리하는 프로젝트는
//   그 내용을 알 수 없어 관리 화면이 "검증 없음"으로 보일 수 있다(전역 보호 안내·예외 파일).
import { assignFingerprints, readCheckBaseline, applyBaseline, baselineLine, type BaselineInfo } from "./baseline.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { L, getLang } from "./lang.js";
import { readIgnoreFile, compileRulePattern, type SecureIgnore } from "./secure-coding.js";
import { loadRulePacks, rulePackInfo, type RulePackInfo } from "./rule-packs.js";

export type AccessLevel = "none" | "login" | "role" | "owner";
export type AccessAction = "create" | "update" | "delete" | "read" | "other";
export type AccessFindingKind = "unprotected-write" | "sibling-mismatch" | "missing-ownership" | "unprotected-detail";
export interface AccessRules {
  schemaVersion: number; surveyedAt: string; note: string; note_en?: string; sources: { name: string; name_en?: string }[];
  /** 검증 호출 사전(정규식) — 수준별 */
  loginCalls: string; roleCalls: string; ownerCalls: string;
  /** 등록자·소유자 식별 필드(이 이름이 보이면 "사용자별 데이터"로 본다) */
  ownerFields: string;
  /** 하는 일: 서비스 호출·메서드 이름의 동사 */
  verbs: { create: string; update: string; delete: string; read: string };
  /** 서비스·DAO 수신자 이름(이 변수의 메서드 호출만 "하는 일"로 센다) */
  serviceReceivers: string;
  /** 의도된 공개 경로(로그인·오류·정적) — 누락 의심에서 뺀다 */
  publicUrlPatterns: string[];
  /** 인증 인터셉터·필터 클래스 이름 */
  authInterceptors: string;
}
const RULES_URL = new URL("../catalog/access-rules.json", import.meta.url);
let cached: AccessRules | null = null;
export function loadAccessRules(): AccessRules { if (!cached) cached = JSON.parse(fs.readFileSync(RULES_URL, "utf8")) as AccessRules; return cached; }

export interface AccessHandler {
  file: string; line: number; controller: string; method: string;
  urls: string[]; http: string[];
  action: AccessAction; level: AccessLevel;
  /** 검증 근거(호출·어노테이션, 최대 3개) */
  evidence: string[];
  /** 전역 보호(Spring Security·인터셉터)로 로그인이 필요한가 — 알 수 없으면 null */
  globalLogin: boolean | null;
  /** 사용자별 데이터(등록자 필드)를 다루는가 */
  ownerData: boolean;
}
export interface AccessFinding {
  kind: AccessFindingKind; severity: "high" | "medium" | "low";
  file: string; line: number; controller: string; method: string; url: string; action: AccessAction; level: AccessLevel;
  message: string; fix: string;
  /** 근거가 된 형제 핸들러(메서드 이름·수준) */
  sibling?: { method: string; level: AccessLevel; line: number };
  /** v1.26: 줄 번호에 묶이지 않는 지문(종류·파일·컨트롤러·메서드·URL·순번) */
  fingerprint?: string;
  /** v1.26: baselinePath 를 줬을 때 — 이전 결과에 없던 항목 */
  isNew?: boolean;
}
export interface AccessGlobal {
  kind: "spring-security" | "egov-security" | "interceptor" | "none";
  file: string | null;
  /** 로그인이 필요한 패턴 / 제외(공개) 패턴 */
  protect: string[]; exclude: string[];
  note: string;
}
export interface AccessOptions { projectDir: string; maxFiles?: number; rulePacks?: string[]; /** v1.26: 이전 결과(format=json) — 새로 생긴 항목만 isNew */ baselinePath?: string }
export interface AccessResult {
  projectDir: string;
  rulesVersion: { surveyedAt: string };
  durationMs: number;
  global: AccessGlobal;
  handlers: AccessHandler[];
  findings: AccessFinding[];
  summary: {
    controllers: number; handlers: number;
    byLevel: Record<AccessLevel, number>; byAction: Record<AccessAction, number>;
    writes: number; writesWithoutCheck: number;
    high: number; medium: number; low: number; suppressed: number;
    /** v1.26: 새 항목 수(baselinePath 없으면 null) */
    new: number | null;
  };
  /** v1.26: 비교한 기준선(있을 때만) */
  baseline?: BaselineInfo;
  ignoreFile: string | null;
  invalidIgnores: string[];
  rulePacks?: RulePackInfo[];
  notes: string[];
}
export const ACCESS_IGNORE_FILE = ".egovframe-access-ignore.json";

const SKIP_DIRS = new Set(["target", "build", "node_modules", ".git", "migration-backup", "deploy", "sbom", "bin", "out", ".idea", ".settings", "test"]);
const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");
const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
function walk(root: string, max: number): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(p); continue; }
      if (e.isFile() && /\.(java|xml|properties)$/.test(e.name)) out.push(p);
    }
  }
  return out.sort();
}
/** 주석과 문자열 내용을 공백으로(줄·길이 보존). 문자열은 따옴표만 남긴다 — keepStrings 면 문자열은 그대로 */
export function maskJava(src: string, keepStrings = false): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; out += src.slice(i, end).replace(/[^\n]/g, " "); i = end; continue; }
    if (c === "/" && d === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? n : e; out += " ".repeat(end - i); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
      const body = src.slice(i + 1, Math.min(j, n));
      out += c + (keepStrings ? body : body.replace(/[^\n]/g, " ")) + (j < n && src[j] === c ? c : "");
      i = Math.min(j + 1, n);
      continue;
    }
    out += c; i++;
  }
  return out;
}
const lineOf = (text: string, idx: number) => { let ln = 1; for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) ln++; return ln; };
/** idx 의 여는 괄호에 짝이 맞는 닫는 괄호 위치(없으면 -1) */
function matchClose(text: string, idx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = idx; i < text.length; i++) { const c = text[i]; if (c === open) depth++; else if (c === close) { depth--; if (depth === 0) return i; } }
  return -1;
}
const MAPPING_RE = /@(Request|Get|Post|Put|Delete|Patch)Mapping\b/g;
/** 매핑 어노테이션 인자에서 경로·HTTP 메서드 */
function mappingArgs(kind: string, args: string): { paths: string[]; http: string[] } {
  const http = kind === "Request" ? [...args.matchAll(/RequestMethod\s*\.\s*([A-Z]+)/g)].map((m) => m[1]) : [kind.toUpperCase()];
  // value/path 인자의 문자열만(params·produces·headers·name 의 문자열 제외)
  const cleaned = args.replace(/\b(params|produces|consumes|headers|name)\s*=\s*(\{[^}]*\}|"[^"]*")/g, "");
  const paths = [...cleaned.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  return { paths, http };
}
const joinUrl = (a: string, b: string) => { const x = `/${a}/${b}`.replace(/\/{2,}/g, "/"); return x.length > 1 ? x.replace(/\/$/, "") : x; };

interface RawHandler { file: string; line: number; controller: string; method: string; urls: string[]; http: string[]; annotations: string; classAnnotations: string; body: string; classText: string }
/** 컨트롤러 소스에서 핸들러 메서드를 꺼낸다(정규식·괄호 짝) */
export function parseControllerHandlers(file: string, src: string): RawHandler[] {
  if (!/@(Rest)?Controller\b/.test(src)) return [];
  const code = maskJava(src, true), bare = maskJava(src, false);
  const cm = /\b(?:public\s+|abstract\s+|final\s+)*class\s+(\w+)/.exec(bare);
  if (!cm) return [];
  const classStart = cm.index;
  // 클래스 선언 앞의 어노테이션 구간(마지막 import 뒤)
  const lastImport = bare.lastIndexOf("import ", classStart);
  const headStart = lastImport < 0 ? 0 : bare.indexOf(";", lastImport) + 1;
  const classAnnotations = code.slice(headStart, classStart);
  let prefixes = [""];
  const pm = /@RequestMapping\b\s*(\()?/.exec(classAnnotations);
  if (pm?.[1]) { const o = headStart + pm.index + pm[0].length - 1; const c = matchClose(bare, o, "(", ")"); if (c > 0) { const a = mappingArgs("Request", code.slice(o + 1, c)); if (a.paths.length) prefixes = a.paths; } }
  const out: RawHandler[] = [];
  MAPPING_RE.lastIndex = classStart;
  let m: RegExpExecArray | null;
  while ((m = MAPPING_RE.exec(bare))) {
    let i = m.index + m[0].length;
    while (/\s/.test(bare[i] ?? "")) i++;
    let paths: string[] = [], http: string[] = m[1] === "Request" ? [] : [m[1].toUpperCase()];
    if (bare[i] === "(") { const c = matchClose(bare, i, "(", ")"); if (c < 0) continue; const a = mappingArgs(m[1], code.slice(i + 1, c)); paths = a.paths; http = a.http; i = c + 1; }
    // 어노테이션 블록의 시작(앞쪽으로 연속된 어노테이션)과 메서드 선언
    const sig = /\G/.source; void sig;
    const rest = bare.slice(i);
    const decl = /^(?:\s*@\w+(?:\s*\((?:[^()]|\([^()]*\))*\))?)*\s*(?:public|protected|private)?\s*(?:static\s+|final\s+|synchronized\s+)*[\w<>\[\],.?\s]+?\s+(\w+)\s*\(/.exec(rest);
    if (!decl) continue;
    const parenOpen = i + decl[0].length - 1;
    const parenClose = matchClose(bare, parenOpen, "(", ")");
    if (parenClose < 0) continue;
    const braceOpen = bare.indexOf("{", parenClose);
    const semi = bare.indexOf(";", parenClose);
    if (braceOpen < 0 || (semi >= 0 && semi < braceOpen)) continue;
    const braceClose = matchClose(bare, braceOpen, "{", "}");
    if (braceClose < 0) continue;
    // 메서드 위 어노테이션 전체: 앞의 '}' 또는 ';' 또는 '{' 뒤부터 선언까지
    let annStart = m.index;
    for (let k = m.index - 1; k >= 0; k--) { const ch = bare[k]; if (ch === "}" || ch === ";" || ch === "{") { annStart = k + 1; break; } }
    const annotations = code.slice(annStart, parenOpen);
    const urls = [...new Set(prefixes.flatMap((p) => (paths.length ? paths : [""]).map((x) => joinUrl(p, x))))];
    out.push({ file, line: lineOf(bare, m.index), controller: cm[1], method: decl[1], urls, http, annotations, classAnnotations, body: bare.slice(braceOpen, braceClose + 1) + "\n" + code.slice(parenOpen, parenClose + 1), classText: bare });
    MAPPING_RE.lastIndex = braceOpen + 1;
  }
  return out;
}

const LEVEL_ORDER: Record<AccessLevel, number> = { none: 0, login: 1, role: 2, owner: 3 };
/** Ant 패턴 → 정규식(** = 여러 단계, * = 한 단계, ? = 한 글자) */
export function antToRegExp(p: string): RegExp {
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") { re += ".*"; i++; if (p[i + 1] === "/") { re = re.replace(/\.\*$/, "(?:.*/)?"); i++; } }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** 전역 보호: Spring Security 설정(Java·XML)과 인증 인터셉터의 URL 패턴 */
export function detectGlobalAccess(files: { rel: string; abs: string }[], rules: AccessRules): AccessGlobal {
  const authRe = compileRulePattern(rules.authInterceptors);
  let best = null as AccessGlobal | null;
  const lits = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const f of files) {
    if (/(^|\/)src\/test\//.test(f.rel)) continue;
    if (f.rel.endsWith(".java")) {
      const raw = read(f.abs);
      if (!/SecurityFilterChain|addInterceptors\s*\(/.test(raw)) continue;
      const code = maskJava(raw, true);
      if (/\bSecurityFilterChain\b/.test(code) && /@Bean\b/.test(code)) {
        const protect: string[] = [], exclude: string[] = [];
        for (const m of code.matchAll(/\.(?:requestMatchers|antMatchers|mvcMatchers)\s*\(((?:[^()]|\([^()]*\))*)\)\s*\.\s*(permitAll|authenticated|hasRole|hasAnyRole|hasAuthority|hasAnyAuthority|access|denyAll)\b/g)) (m[2] === "permitAll" ? exclude : protect).push(...lits(m[1]));
        const any = /\.anyRequest\s*\(\s*\)\s*\.\s*(permitAll|authenticated|hasRole|hasAnyRole|hasAuthority|hasAnyAuthority|access|denyAll)\b/.exec(code)?.[1];
        if (any && any !== "permitAll") protect.push("/**");
        const g: AccessGlobal = { kind: "spring-security", file: f.rel, protect, exclude, note: "" };
        if (!best || best.kind !== "spring-security" || g.protect.length > best.protect.length) best = g;
      } else if (/addInterceptors\s*\(/.test(code)) {
        for (const m of code.matchAll(/\.addInterceptor\s*\(((?:[^()]|\([^()]*\))*)\)((?:\s*\.\s*(?:addPathPatterns|excludePathPatterns|order)\s*\((?:[^()]|\([^()]*\))*\))*)/g)) {
          if (!authRe.test(m[1])) continue;
          const protect = [...m[2].matchAll(/addPathPatterns\s*\(((?:[^()]|\([^()]*\))*)\)/g)].flatMap((x) => lits(x[1]));
          const exclude = [...m[2].matchAll(/excludePathPatterns\s*\(((?:[^()]|\([^()]*\))*)\)/g)].flatMap((x) => lits(x[1]));
          if (!best) best = { kind: "interceptor", file: f.rel, protect: protect.length ? protect : ["/**"], exclude, note: "" };
        }
      }
    } else if (f.rel.endsWith(".xml") && !f.rel.endsWith("pom.xml")) {
      const raw = read(f.abs);
      if (!/intercept-url|mvc:interceptor/.test(raw)) continue;
      const x = raw.replace(/<!--[\s\S]*?-->/g, "");
      if (/<(?:\w+:)?intercept-url\b/.test(x)) {
        const protect: string[] = [], exclude: string[] = [];
        for (const m of x.matchAll(/<(?:\w+:)?intercept-url\b([^>]*)>/g)) { const p = /pattern\s*=\s*"([^"]+)"/.exec(m[1])?.[1]; const a = /access\s*=\s*"([^"]+)"/.exec(m[1])?.[1] ?? ""; if (p) (/permitAll|IS_AUTHENTICATED_ANONYMOUSLY|ROLE_ANONYMOUS|isAnonymous/.test(a) ? exclude : protect).push(p); }
        if (!best || best.kind !== "spring-security") best = { kind: "spring-security", file: f.rel, protect, exclude, note: "" };
      } else {
        for (const m of x.matchAll(/<mvc:interceptor>([\s\S]*?)<\/mvc:interceptor>/g)) {
          if (!authRe.test(m[1])) continue;
          const protect = [...m[1].matchAll(/<mvc:mapping\s+path\s*=\s*"([^"]+)"/g)].map((y) => y[1]);
          const exclude = [...m[1].matchAll(/<mvc:exclude-mapping\s+path\s*=\s*"([^"]+)"/g)].map((y) => y[1]);
          if (!best) best = { kind: "interceptor", file: f.rel, protect, exclude, note: /<beans\s+profile\s*=/.test(x) ? L("프로파일에 따라 켜지는 인터셉터입니다 — 운영 프로파일에서 켜지는지 확인하세요", "This interceptor is enabled per profile — confirm it is active in the production profile") : "" };
        }
      }
    }
  }
  // URL 패턴이 하나도 없는 SecurityFilterChain(CSRF 전용 등)은 전역 보호가 아니다
  if (best && best.kind === "spring-security" && !best.protect.length && !best.exclude.length) best = null;
  // 표준프레임워크 보안(시큐리티 간소화·보안 스타터): 역할–URL 을 DB(보호자원)에서 읽는다 — 어떤 URL 이 보호되는지는 소스에 없다
  const egov = files.find((f) => (f.rel.endsWith("globals.properties") && /^\s*Globals\.Auth\s*[=:]\s*security\b/m.test(read(f.abs))) || (f.rel.endsWith(".xml") && !f.rel.endsWith("pom.xml") && /<egov-security:config\b/.test(read(f.abs))) || (/(^|\/)pom\.xml$/.test(f.rel) && /<artifactId>\s*egovframe-boot-starter-security\s*</.test(read(f.abs).replace(/<!--[\s\S]*?-->/g, "")))
    // v1.26.1: 5.1.0 실행환경 보안(fdl-security Java Configuration) — XML 네임스페이스 대신 EgovSecurityConfiguration 빈 + egov-security-config.properties(sqlRolesAndUrl)
    || (f.rel.endsWith(".properties") && /^\s*sqlRolesAndUrl\s*[=:]/m.test(read(f.abs)))
    || (f.rel.endsWith(".xml") && !f.rel.endsWith("pom.xml") && /class\s*=\s*"org\.egovframe\.rte\.fdl\.security\.config\.EgovSecurityConfiguration"/.test(read(f.abs).replace(/<!--[\s\S]*?-->/g, "")))
    || (f.rel.endsWith(".java") && /^\s*import\s+org\.egovframe\.rte\.fdl\.security\.config\.EgovSecurityConfiguration\s*;/m.test(read(f.abs))));
  if (egov && (!best || best.kind === "interceptor")) return { kind: "egov-security", file: egov.rel, protect: [], exclude: [], note: L("표준프레임워크 보안(역할–URL 을 DB 보호자원으로 관리)을 쓰는 프로젝트입니다 — 어떤 URL 이 어느 역할로 막히는지는 소스에 없어, 검증 없는 변경 핸들러는 '확인 필요'(중간)로 낮춰 보고합니다. 보호자원 데이터에 그 URL 이 있는지 대조하세요.", "This project uses eGovFrame security (role-to-URL mappings kept as secured resources in a database) — which URL is restricted to which role is not in the source, so write handlers without a check are reported as 'to verify' (medium). Compare them with the secured-resource data.") };
  return best ?? { kind: "none", file: null, protect: [], exclude: [], note: L("Spring Security 설정·인증 인터셉터를 찾지 못했습니다 — 핸들러 안의 검증만으로 판정합니다", "No Spring Security configuration or authentication interceptor found — only checks inside handlers are considered") };
}

const tr = (o: { [k: string]: unknown }, k: string): string => (getLang() === "en" && typeof o[`${k}_en`] === "string" ? (o[`${k}_en`] as string) : (o[k] as string));
void tr;

export function checkAccess(opts: AccessOptions): AccessResult {
  const t0 = Date.now();
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const packs = loadRulePacks(opts.rulePacks);
  const base = loadAccessRules();
  // v1.23 규칙 팩의 access 절: 호출 사전·소유자 필드·공개 경로를 더한다
  const rules: AccessRules = { ...base, publicUrlPatterns: [...base.publicUrlPatterns] };
  const add = (cur: string, more?: string[]) => (more?.length ? [cur, ...more.map((s) => `(?:${s})`)].join("|") : cur);
  const accessPacks = packs.filter((p) => p.access);
  for (const p of accessPacks) { const a = p.access!; rules.loginCalls = add(rules.loginCalls, a.loginCalls); rules.roleCalls = add(rules.roleCalls, a.roleCalls); rules.ownerCalls = add(rules.ownerCalls, a.ownerCalls); rules.ownerFields = add(rules.ownerFields, a.ownerFields); rules.publicUrlPatterns.push(...a.publicUrlPatterns); }
  const notes: string[] = [];
  const files = walk(projectDir, opts.maxFiles ?? 30_000).map((p) => ({ abs: p, rel: rel(projectDir, p) })).filter((f) => !/(^|\/)src\/test\//.test(f.rel));
  const global = detectGlobalAccess(files, rules);
  const protectRe = global.protect.map(antToRegExp), excludeRe = global.exclude.map(antToRegExp), publicRe = rules.publicUrlPatterns.map(antToRegExp);
  const globalLogin = (url: string): boolean | null => (global.kind === "none" || global.kind === "egov-security" ? null : protectRe.some((r) => r.test(url)) && !excludeRe.some((r) => r.test(url)));
  const loginRe = compileRulePattern(rules.loginCalls, "g"), roleRe = compileRulePattern(rules.roleCalls, "g"), ownerRe = compileRulePattern(rules.ownerCalls, "g"), ownerFieldRe = compileRulePattern(rules.ownerFields);
  const recv = rules.serviceReceivers;
  const callRe = (verbs: string) => new RegExp(`\\b\\w*(?:${recv})\\w*\\s*\\.\\s*(?:${verbs})\\w*\\s*\\(`, "i");
  const verbCall = { create: callRe(rules.verbs.create), update: callRe(rules.verbs.update), delete: callRe(rules.verbs.delete), read: callRe(rules.verbs.read) };
  const nameRe = (verbs: string) => new RegExp(`^(?:${verbs})`, "i");
  const verbName = { create: nameRe(rules.verbs.create), update: nameRe(rules.verbs.update), delete: nameRe(rules.verbs.delete), read: nameRe(rules.verbs.read) };

  const handlers: AccessHandler[] = [];
  const controllers = new Set<string>();
  for (const f of files) {
    if (!f.rel.endsWith(".java")) continue;
    const src = read(f.abs);
    if (!/@(Rest)?Controller\b/.test(src)) continue;
    const raws = parseControllerHandlers(f.rel, src);
    if (!raws.length) continue;
    controllers.add(f.rel);
    for (const h of raws) {
      const scope = `${h.classAnnotations}\n${h.annotations}\n${h.body}`;
      const ev = (re: RegExp) => { re.lastIndex = 0; const out: string[] = []; let m: RegExpExecArray | null; while ((m = re.exec(scope)) && out.length < 3) { const t = m[0].replace(/\s+/g, "").replace(/\($/, ""); if (!out.includes(t)) out.push(t); if (m[0] === "") re.lastIndex++; } return out; };
      const o = ev(ownerRe), r = ev(roleRe), l = ev(loginRe);
      const level: AccessLevel = o.length ? "owner" : r.length ? "role" : l.length ? "login" : "none";
      // 하는 일: 본문의 서비스 호출이 먼저, 없으면 메서드 이름. 화면만 여는 *View 는 읽기
      const b = h.body;
      let action: AccessAction = verbCall.delete.test(b) ? "delete" : verbCall.update.test(b) ? "update" : verbCall.create.test(b) ? "create" : verbCall.read.test(b) ? "read" : "other";
      if (action === "other" || action === "read") {
        const viewOnly = /View$|Form$|Popup$|Page$/i.test(h.method);
        const byName: AccessAction = verbName.delete.test(h.method) ? "delete" : verbName.update.test(h.method) ? "update" : verbName.create.test(h.method) ? "create" : verbName.read.test(h.method) ? "read" : "other";
        if (action === "other") action = viewOnly && byName !== "other" ? "read" : byName === "other" ? "other" : (/[A-Za-z]*(?:Service|DAO|Dao|Mapper|Manager)\w*\s*\.\s*\w+\s*\(/.test(b) ? byName : "read");
      }
      const gl = h.urls.length ? h.urls.map(globalLogin) : [globalLogin("")];
      handlers.push({ file: h.file, line: h.line, controller: h.controller, method: h.method, urls: h.urls, http: h.http, action, level, evidence: [...o, ...r, ...l].slice(0, 3), globalLogin: gl.every((x) => x === true) ? true : gl.some((x) => x === null) ? null : false, ownerData: ownerFieldRe.test(b) || ownerFieldRe.test(h.classText) });
    }
  }

  // ── 누락 의심 ──
  const findings: AccessFinding[] = [];
  const isWrite = (a: AccessAction) => a === "create" || a === "update" || a === "delete";
  const isPublic = (h: AccessHandler) => h.urls.some((u) => publicRe.some((r) => r.test(u)));
  const byController = new Map<string, AccessHandler[]>();
  for (const h of handlers) byController.set(h.file, [...(byController.get(h.file) ?? []), h]);
  const actionLabel = (a: AccessAction) => ({ create: L("등록", "create"), update: L("수정", "update"), delete: L("삭제", "delete"), read: L("조회", "read"), other: L("기타", "other") })[a];
  const levelLabel = (l: AccessLevel) => ({ none: L("검증 없음", "no check"), login: L("로그인", "login"), role: L("역할", "role"), owner: L("소유권", "ownership") })[l];
  for (const [, list] of byController) {
    const writes = list.filter((h) => isWrite(h.action));
    const strongestWrite = [...writes].sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level])[0];
    const strongestRead = [...list.filter((h) => h.action === "read")].sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level])[0];
    for (const h of list) {
      if (isPublic(h)) continue;
      const mk = (kind: AccessFindingKind, severity: AccessFinding["severity"], message: string, fix: string, sibling?: AccessHandler): void => { findings.push({ kind, severity, file: h.file, line: h.line, controller: h.controller, method: h.method, url: h.urls[0] ?? "", action: h.action, level: h.level, message, fix, ...(sibling ? { sibling: { method: sibling.method, level: sibling.level, line: sibling.line } } : {}) }); };
      if (isWrite(h.action)) {
        // 형제 변경 핸들러가 역할·소유권을 확인하는데 이 핸들러는 그보다 낮다
        // 등록에는 "소유자"가 없다 — 등록은 형제가 역할을 확인할 때만(또는 자신은 검증이 전혀 없는데 형제는 있을 때만) 비교한다
        const roleSibling = writes.find((w) => w !== h && w.level === "role");
        const cmp = h.action === "create" ? (roleSibling ?? (h.level === "none" ? writes.find((w) => w !== h && w.level !== "none") : undefined)) : strongestWrite;
        if (cmp && cmp !== h && (h.action === "create" ? true : LEVEL_ORDER[cmp.level] >= LEVEL_ORDER.role) && LEVEL_ORDER[h.level] < LEVEL_ORDER[cmp.level] && LEVEL_ORDER[h.level] < LEVEL_ORDER.role) {
          const strongestWrite = cmp;
          mk("sibling-mismatch", "high", L(`같은 컨트롤러의 ${strongestWrite.method} 는 ${levelLabel(strongestWrite.level)} 을 확인하는데 이 ${actionLabel(h.action)} 핸들러는 ${levelLabel(h.level)} 입니다`, `${strongestWrite.method} in the same controller checks ${levelLabel(strongestWrite.level)}, but this ${actionLabel(h.action)} handler has ${levelLabel(h.level)}`), L(`${strongestWrite.method} 와 같은 검증을 메서드 첫머리에 넣으세요`, `Add the same check as ${strongestWrite.method} at the top of the method`), strongestWrite);
          continue;
        }
        if (h.level === "none") {
          const covered = h.globalLogin === true;
          if (global.kind === "egov-security") { mk("unprotected-write", "medium", L(`${actionLabel(h.action)} 핸들러에 검증이 없습니다 — 역할–URL 보호자원(DB)에 이 URL 이 등록되어 있는지 확인하세요`, `No check in this ${actionLabel(h.action)} handler — verify that this URL is registered in the secured resources (database)`), L("보호자원에 없으면 등록하고, 사용자 글이면 등록자와 로그인 사용자를 비교하세요", "Register it in the secured resources if missing, and compare the registrant with the logged-in user for user content")); continue; }
          mk("unprotected-write", covered ? "medium" : "high", covered ? L(`${actionLabel(h.action)} 핸들러에 검증이 없습니다 — 전역 보호(${global.file})로 로그인은 필요하지만 역할·소유권은 확인하지 않습니다`, `No check in this ${actionLabel(h.action)} handler — the global protection (${global.file}) requires login, but no role or ownership is checked`) : L(`${actionLabel(h.action)} 핸들러에 로그인·역할·소유권 검증이 없고 전역 보호 범위도 아닙니다`, `This ${actionLabel(h.action)} handler has no login, role or ownership check and is outside the global protection`), L("로그인 여부와, 관리 기능이면 역할을, 사용자 글이면 등록자와 로그인 사용자를 비교하세요", "Check login, then the role for admin functions or compare the registrant with the logged-in user for user content"));
          continue;
        }
        if ((h.action === "update" || h.action === "delete") && h.level === "login" && h.ownerData) {
          mk("missing-ownership", "medium", L(`${actionLabel(h.action)} 핸들러가 로그인만 확인하고 등록자와 비교하지 않습니다 — 다른 사용자의 번호를 넣어 ${actionLabel(h.action)}할 수 있습니다(CWE-639)`, `This ${actionLabel(h.action)} handler only checks login and never compares the registrant — another user's id can be submitted (CWE-639)`), L("대상을 다시 조회해 등록자(frstRegisterId 등)와 로그인 사용자를 비교하세요", "Reload the target and compare its registrant (frstRegisterId etc.) with the logged-in user"));
        }
      } else if (h.action === "read" && strongestRead && strongestRead !== h && strongestRead.level === "owner" && LEVEL_ORDER[h.level] < LEVEL_ORDER.role && /detail|view|inqire|select\w*(?!list)/i.test(h.method) && !/list/i.test(h.method) && !verbName.create.test(h.method) && h.ownerData) {
        mk("unprotected-detail", "low", L(`같은 컨트롤러의 ${strongestRead.method} 는 소유권을 확인하는데 이 상세 조회는 ${levelLabel(h.level)} 입니다`, `${strongestRead.method} in the same controller checks ownership, but this detail view has ${levelLabel(h.level)}`), L(`${strongestRead.method} 와 같은 검증이 필요한지 확인하세요`, `Check whether the same check as ${strongestRead.method} is needed`), strongestRead);
      }
    }
  }

  assignFingerprints("access", findings, (f) => [f.kind, f.file, f.controller, f.method, f.url]);
  const ig = readIgnoreFile(projectDir, ACCESS_IGNORE_FILE);
  let suppressed = 0;
  const kept = findings.filter((f) => { const hit = ig.list.some((x: SecureIgnore) => (x.rule === f.kind || x.rule === "*") && (x.path === f.file || f.file.startsWith(x.path.endsWith("/") ? x.path : `${x.path}/`)) && (x.line === undefined || x.line === f.line)); if (hit) suppressed++; return !hit; });
  const SEV = { high: 0, medium: 1, low: 2 } as const;
  kept.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  const byLevel: Record<AccessLevel, number> = { none: 0, login: 0, role: 0, owner: 0 };
  const byAction: Record<AccessAction, number> = { create: 0, update: 0, delete: 0, read: 0, other: 0 };
  for (const h of handlers) { byLevel[h.level]++; byAction[h.action]++; }
  if (global.note) notes.push(global.note);
  if (global.kind !== "none") notes.push(L(`전역 보호: ${global.kind === "spring-security" ? "Spring Security" : "인증 인터셉터"}(${global.file}) — 보호 ${global.protect.length}개 패턴, 제외 ${global.exclude.length}개. 역할–URL 을 DB(보호자원)로 관리하면 그 내용은 여기 보이지 않습니다.`, `Global protection: ${global.kind === "spring-security" ? "Spring Security" : "authentication interceptor"} (${global.file}) — ${global.protect.length} protected patterns, ${global.exclude.length} excluded. Role-to-URL mappings kept in a database (secured resources) are not visible here.`));
  notes.push(L("호출 이름 기반의 정적 판정입니다 — 서비스 계층·AOP·필터에서 하는 검증은 보이지 않습니다. 의도된 공개 URL 은 예외 파일에 사유와 함께 등록하세요.", "This is a static check based on call names — checks done in the service layer, AOP or filters are not visible. Register intentionally public URLs in the ignore file with a reason."));
  if (ig.invalid.length) notes.push(...ig.invalid.map((x) => `${ACCESS_IGNORE_FILE}: ${x}`));
  if (accessPacks.length) notes.push(L(`규칙 팩 적용: ${accessPacks.map((p) => `${p.name} ${p.version}`).join(", ")}`, `Rule packs applied: ${accessPacks.map((p) => `${p.name} ${p.version}`).join(", ")}`));
  const writes = handlers.filter((h) => isWrite(h.action));
  const bl = opts.baselinePath ? applyBaseline(kept, readCheckBaseline(projectDir, opts.baselinePath, "access")) : null;
  if (bl?.note) notes.push(bl.note);
  return {
    projectDir, rulesVersion: { surveyedAt: rules.surveyedAt }, durationMs: Date.now() - t0, global, handlers, findings: kept,
    summary: { controllers: controllers.size, handlers: handlers.length, byLevel, byAction, writes: writes.length, writesWithoutCheck: writes.filter((h) => h.level === "none").length, high: kept.filter((f) => f.severity === "high").length, medium: kept.filter((f) => f.severity === "medium").length, low: kept.filter((f) => f.severity === "low").length, suppressed, new: bl ? bl.newCount : null },
    ...(bl ? { baseline: bl.info } : {}),
    ignoreFile: ig.file, invalidIgnores: ig.invalid, ...(accessPacks.length ? { rulePacks: rulePackInfo(accessPacks) } : {}), notes,
  };
}

const LV = (l: AccessLevel) => ({ none: L("없음", "none"), login: L("로그인", "login"), role: L("역할", "role"), owner: L("소유권", "ownership") })[l];
const AC = (a: AccessAction) => ({ create: "C", update: "U", delete: "D", read: "R", other: "-" })[a];
export function renderAccessMarkdown(r: AccessResult, topN = 40): string {
  const s = r.summary;
  const out: string[] = [L(`# 접근 통제 점검 — ${r.projectDir}`, `# Access control check — ${r.projectDir}`), ""];
  out.push(L(`- 컨트롤러 ${s.controllers}개 · 핸들러 ${s.handlers}개 — 검증 수준: 없음 ${s.byLevel.none} · 로그인 ${s.byLevel.login} · 역할 ${s.byLevel.role} · 소유권 ${s.byLevel.owner}`, `- ${s.controllers} controllers · ${s.handlers} handlers — check level: none ${s.byLevel.none} · login ${s.byLevel.login} · role ${s.byLevel.role} · ownership ${s.byLevel.owner}`));
  out.push(L(`- 변경(등록·수정·삭제) 핸들러 ${s.writes}개 중 검증 없음 ${s.writesWithoutCheck}개`, `- ${s.writesWithoutCheck} of ${s.writes} write handlers (create/update/delete) have no check`));
  out.push(L(`- **누락 의심: 높음 ${s.high} · 중간 ${s.medium} · 낮음 ${s.low}**${s.suppressed ? ` · 예외 ${s.suppressed}` : ""}`, `- **Suspected gaps: high ${s.high} · medium ${s.medium} · low ${s.low}**${s.suppressed ? ` · suppressed ${s.suppressed}` : ""}`));
  if (r.baseline) out.push(baselineLine(r.baseline, s.new ?? 0));
  for (const n of r.notes) out.push(`- ${n}`);
  if (r.findings.length) {
    out.push("", L("## 누락 의심 (심각도순)", "## Suspected gaps (by severity)"), "", L("| 등급 | 종류 | URL | 메서드 | 일 | 검증 | 위치 | 근거 |", "| Severity | Kind | URL | Method | Act | Check | Location | Evidence |"), "|---|---|---|---|---|---|---|---|");
    for (const f of r.findings.slice(0, topN)) out.push(`| ${f.isNew ? "🆕 " : ""}${f.severity} | ${f.kind} | \`${f.url}\` | ${f.controller}.${f.method} | ${AC(f.action)} | ${LV(f.level)} | \`${f.file}:${f.line}\` | ${f.message.replace(/\|/g, "\\|")}${f.sibling ? L(` (형제 ${f.sibling.method}:${f.sibling.line})`, ` (sibling ${f.sibling.method}:${f.sibling.line})`) : ""} |`);
    if (r.findings.length > topN) out.push("", L(`… ${r.findings.length - topN}건 더(format=json 또는 topN)`, `… ${r.findings.length - topN} more (format=json or topN)`));
    out.push("", L(`> 확인해서 의도된 공개·다른 계층의 검증이면 \`${ACCESS_IGNORE_FILE}\` 에 사유·검토자와 함께 예외로 등록할 수 있습니다(rule = 종류).`, `> If a finding is intentional or checked in another layer, register it in \`${ACCESS_IGNORE_FILE}\` with a reason and reviewer (rule = kind).`));
  }
  out.push("", L("## URL 권한 표", "## URL permission table"), "", L("| URL | HTTP | 일 | 검증 | 전역 로그인 | 핸들러 | 근거 |", "| URL | HTTP | Act | Check | Global login | Handler | Evidence |"), "|---|---|---|---|---|---|---|");
  for (const h of r.handlers.slice(0, topN * 3)) out.push(`| \`${h.urls.join(", ")}\` | ${h.http.join(",") || "*"} | ${AC(h.action)} | ${LV(h.level)} | ${h.globalLogin === null ? "-" : h.globalLogin ? "✅" : "✖"} | ${h.controller}.${h.method} | ${h.evidence.map((e) => `\`${e}\``).join(" ")} |`);
  if (r.handlers.length > topN * 3) out.push("", L(`… ${r.handlers.length - topN * 3}개 더(format=csv 로 전체)`, `… ${r.handlers.length - topN * 3} more (format=csv for the full table)`));
  return out.join("\n");
}
/** URL 권한 표 CSV(감리 제출용) — UTF-8 BOM, CRLF */
export function renderAccessCsv(r: AccessResult): string {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const flagged = new Map<string, AccessFinding>();
  for (const f of r.findings) flagged.set(`${f.file}:${f.line}`, f);
  const rows = [[L("URL", "URL"), "HTTP", L("하는 일", "Action"), L("검증 수준", "Check level"), L("전역 로그인", "Global login"), L("컨트롤러", "Controller"), L("메서드", "Method"), L("위치", "Location"), L("검증 근거", "Evidence"), L("누락 의심", "Suspected gap")]];
  for (const h of r.handlers) { const f = flagged.get(`${h.file}:${h.line}`); rows.push([h.urls.join(" "), h.http.join(" ") || "*", h.action, h.level, h.globalLogin === null ? "" : h.globalLogin ? "Y" : "N", h.controller, h.method, `${h.file}:${h.line}`, h.evidence.join(" "), f ? `${f.severity}:${f.kind}` : ""]); }
  return "﻿" + rows.map((r2) => r2.map(q).join(",")).join("\r\n") + "\r\n";
}
