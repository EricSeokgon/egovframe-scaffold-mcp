// 메서드 안 데이터 흐름(경량 taint) — check_egovframe_secure_coding 의 등급 상·하향과 변수를 거친 미탐 보완 (v1.5)
//   범위: 한 메서드 안의 지역 변수. 소스(요청 파라미터·헤더·쿠키·Spring 바인딩 파라미터·업로드 파일명) → 대입·문자열 결합·append·컬렉션 →
//   위험 호출(JDBC·파일 경로·OS 명령·리다이렉트)의 인자. 메서드 간·클래스 간 흐름, 필드, 별칭은 보지 않는다(결과는 "확인됨/상수만/판단 불가").
//   입력은 주석을 지운 Java 소스(stripJavaComments). 줄 번호는 원문과 같다.

export type FlowSink = "sql" | "path" | "command" | "redirect";
export interface FlowStep { line: number; code: string; step: string }
export interface SinkFlow { sink: FlowSink; line: number; column: number; status: "tainted" | "constant" | "unknown"; path: FlowStep[]; method: string }

/** 문자열·문자 리터럴 내용을 같은 길이의 공백으로(구조 판정용). 따옴표는 남긴다. */
export function blankJavaLiterals(src: string): string {
  const blank = (x: string) => x.replace(/[^\n]/g, " ");
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' && src.startsWith('"""', i)) {
      const e = src.indexOf('"""', i + 3); const end = e < 0 ? n : e;
      out += '"""' + blank(src.slice(i + 3, end)) + (e < 0 ? "" : '"""'); i = e < 0 ? n : e + 3; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += c + blank(src.slice(i + 1, Math.min(j, n)));
      if (j < n && src[j] === c) { out += c; i = j + 1; } else i = Math.min(j, n);
      continue;
    }
    out += c; i++;
  }
  return out;
}

const CONTROL = new Set(["if", "for", "while", "switch", "catch", "synchronized", "try", "else", "do", "return", "new", "throw", "assert", "super", "this"]);
const SOURCE_ANN = /@(RequestParam|PathVariable|RequestHeader|CookieValue|RequestBody|ModelAttribute|RequestPart|MatrixVariable)\b/;
const NON_SOURCE_TYPES = /^(HttpServletRequest|HttpServletResponse|ServletRequest|ServletResponse|Model|ModelMap|ModelAndView|BindingResult|Errors|HttpSession|Locale|Principal|SessionStatus|RedirectAttributes|Authentication|UriComponentsBuilder|SessionStatus|WebRequest|NativeWebRequest|ServerHttpRequest|ServerWebExchange|Pageable|Sort|int|long|boolean|double|float|short|byte|char|Integer|Long|Boolean|Double|Float|Short|Byte|LocalDate|LocalDateTime|Date|UUID)$/;
const REQUEST_TYPES = /^(HttpServletRequest|ServletRequest|MultipartHttpServletRequest|MultipartRequest)$/;
const SOURCE_CALL = /\b(\w+)\s*\.\s*(getParameter|getParameterValues|getParameterMap|getParameterNames|getHeader|getHeaders|getQueryString|getRequestURI|getRequestURL|getPathInfo|getCookies|getInputStream|getReader|getRemoteUser)\s*\(/g;
const UPLOAD_CALL = /\.\s*(getOriginalFilename|getFileName|getSubmittedFileName)\s*\(/;
/** 값을 안전한 형태로 바꾸는 호출 — 안의 인자는 흐름에서 뺀다 */
const SANITIZER = /\b(?:Integer\.(?:parseInt|valueOf)|Long\.(?:parseLong|valueOf)|Short\.parseShort|Double\.parseDouble|Boolean\.(?:parseBoolean|valueOf)|UUID\.fromString|EgovWebUtil\.(?:clearXSSMinimum|clearXSSMaximum|filePathBlackList|filePathReplaceAll|fileInjectPathReplaceAll|filePathWhiteList|removeOSCmdRisk|removeCRLF|removeSQLInjectionRisk|isIPAddress)|EgovFileScrty\.\w+|FilenameUtils\.getName|HtmlUtils\.htmlEscape\w*|StringEscapeUtils\.escape\w+|Encode\.for\w+|ESAPI\.encoder\(\)\s*\.\s*\w+|URLEncoder\.encode|Pattern\.quote|\w*[Ww]hite[Ll]ist\w*|\w*[Aa]llow(?:ed|List)\w*|\w*[Ss]anitiz\w*|\w*[Vv]alidat\w*|\w*[Ee]scape\w*|\w+(?:Service|ServiceImpl|Mapper|Dao|DAO|Repository|Repo|Manager|Client|Template)\s*\.\s*\w+)\s*\(/g;
/** 검증 조건 — 이 문장 뒤로 그 변수(와 그 변수에서 온 값)는 경로 조작 흐름에서 판단 불가로 본다 */
const GUARD = [/\b(\w+)\s*\.\s*(?:startsWith|matches)\s*\(/g, /\b(?:is|check|validate|verify|assert)\w*\s*\(\s*(\w+)\s*[,)]/g];
const SINKS: { sink: FlowSink; re: RegExp; receiver?: RegExp }[] = [
  { sink: "sql", re: /\b(\w+)\s*\.\s*(executeQuery|executeUpdate|executeLargeUpdate|prepareStatement|prepareCall|addBatch)\s*\(/g },
  { sink: "sql", re: /\b(\w+)\s*\.\s*(execute)\s*\(/g, receiver: /^(stmt|statement|st|conn|connection|con|pstmt|ps|jdbcTemplate|jdbc|template|namedParameterJdbcTemplate)$/i },
  { sink: "sql", re: /\b(\w+)\s*\.\s*(queryForList|queryForObject|queryForMap|queryForRowSet|query|update|batchUpdate)\s*\(/g, receiver: /jdbc|template/i },
  { sink: "path", re: /\bnew\s+(?:[\w.]+\.)?(File|FileInputStream|FileOutputStream|FileReader|FileWriter|RandomAccessFile)\s*\(/g },
  { sink: "path", re: /\b(Paths\s*\.\s*get|Path\s*\.\s*of|Files\s*\.\s*(?:newInputStream|newOutputStream|newBufferedReader|newBufferedWriter|readAllBytes|readAllLines|readString|write|writeString|copy|delete|deleteIfExists|move|createFile))\s*\(/g },
  { sink: "command", re: /\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(|\bnew\s+ProcessBuilder\s*\(/g },
  { sink: "redirect", re: /\b\w+\s*\.\s*sendRedirect\s*\(|\bnew\s+RedirectView\s*\(/g },
];

interface VarInfo { line: number; code: string; step: string; from: string | null }
interface MethodInfo { name: string; startLine: number; endLine: number; bodyStart: number; bodyEnd: number }

/** 줄 번호(1부터) 계산기 — 줄 시작 위치 표를 한 번 만들고 이분 탐색(큰 파일에서 O(n²) 를 피함) */
function lineIndex(text: string): (off: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (off: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; };
}
/** 헤더 끝의 공백과 throws 절을 지운다(정규식 역추적 없이) */
function trimHeader(h: string): string {
  let t = h.trimEnd();
  if (t.endsWith(")")) return t;
  const k = t.lastIndexOf("throws");
  if (k > 0 && /\s/.test(t[k - 1]) && /^throws\s+[\w.,\s]+$/.test(t.slice(k))) t = t.slice(0, k).trimEnd();
  return t;
}
/** off 의 여는 괄호와 짝인 닫는 괄호 위치(구조 텍스트 기준) */
function matchParen(s: string, open: number, o = "(", c = ")"): number {
  let d = 0;
  for (let i = open; i < s.length; i++) { if (s[i] === o) d++; else if (s[i] === c && --d === 0) return i; }
  return -1;
}
/** 최상위 콤마로 나눈 인자 목록 */
function splitArgs(s: string): string[] {
  const out: string[] = []; let d = 0, st = 0;
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === "(" || c === "<" || c === "[" || c === "{") d++; else if (c === ")" || c === ">" || c === "]" || c === "}") d--; else if (c === "," && d === 0) { out.push(s.slice(st, i)); st = i + 1; } }
  out.push(s.slice(st));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** 메서드 본문 범위를 찾는다(생성자 포함, 제어문·익명 클래스 제외). */
export function findMethods(skel: string): MethodInfo[] {
  const out: MethodInfo[] = [];
  const lineOf = lineIndex(skel);
  for (let i = 0; i < skel.length; i++) {
    if (skel[i] !== "{") continue;
    // 헤더: 직전 ; { } 이후 텍스트
    let h = i - 1; while (h >= 0 && skel[h] !== ";" && skel[h] !== "{" && skel[h] !== "}") h--;
    // 헤더가 아주 길면(배열 초기화 등) 메서드 선언이 아님
    if (i - h > 2000) continue;
    const header = trimHeader(skel.slice(h + 1, i));
    if (!header.endsWith(")")) continue;
    // 마지막 괄호 묶음(파라미터 목록)과 그 앞 식별자(메서드 이름)
    let d = 0, po = -1;
    for (let k = header.length - 1; k >= 0; k--) { if (header[k] === ")") d++; else if (header[k] === "(" && --d === 0) { po = k; break; } }
    if (po < 0) continue;
    const nm = /([A-Za-z_]\w*)\s*$/.exec(header.slice(0, po));
    if (!nm || CONTROL.has(nm[1])) continue;
    const before = header.slice(0, po - nm[0].length).replace(/@\w+(\s*\([^)]*\))?/g, " ").trim();
    // 선언(타입·수식어가 앞에 있음)만 — 호출문·new·람다·대입 제외
    if (!before || /[=+\-*/!?:,(]$/.test(before) || /\b(return|new)$/.test(before) || /->$/.test(before)) continue;
    const m = [header, nm[1]];
    const end = matchParen(skel, i, "{", "}");
    if (end < 0) continue;
    out.push({ name: m[1], startLine: lineOf(h + 1), endLine: lineOf(end), bodyStart: i + 1, bodyEnd: end });
  }
  return out;
}

/**
 * 파일 하나의 위험 호출마다 인자로 들어가는 값의 흐름을 판정한다.
 * clean: 주석을 지운 원문, isController: 클래스가 @Controller·@RestController 인지(바인딩 파라미터를 소스로 볼지)
 */
/** 위험 호출이 하나도 없을 파일을 빨리 거른다 */
const ANY_SINK = /\b(executeQuery|executeUpdate|executeLargeUpdate|prepareStatement|prepareCall|addBatch|execute|queryFor\w+|query|update|batchUpdate|File|FileInputStream|FileOutputStream|FileReader|FileWriter|RandomAccessFile|Paths|Path|Files|exec|ProcessBuilder|sendRedirect|RedirectView)\b\s*[.(]/;
export function analyzeJavaFlows(clean: string): SinkFlow[] {
  if (!ANY_SINK.test(clean)) return [];
  const skel = blankJavaLiterals(clean);
  const lineOf = lineIndex(clean);
  const isController = /@(RestController|Controller)\b/.test(skel);
  const lines = clean.split("\n");
  const codeAt = (ln: number) => (lines[ln - 1] ?? "").trim().slice(0, 200);
  const results: SinkFlow[] = [];
  const methods = findMethods(skel);
  // 바깥 메서드만(다른 메서드 본문 안에 들어 있는 메서드 — 익명 클래스 — 는 바깥 것에 포함해 한 번만 본다)
  const top = methods.filter((m) => !methods.some((o) => o !== m && o.bodyStart < m.bodyStart && o.bodyEnd > m.bodyEnd));
  for (const m of top) {
    // 시그니처 파라미터
    let h = m.bodyStart - 2; while (h >= 0 && skel[h] !== ";" && skel[h] !== "{" && skel[h] !== "}") h--;
    const headerSkel = trimHeader(skel.slice(h + 1, m.bodyStart - 1));
    let close = headerSkel.length - 1, open = -1;
    { let d = 0; for (let k = close; k >= 0; k--) { if (headerSkel[k] === ")") d++; else if (headerSkel[k] === "(" && --d === 0) { open = k; break; } } }
    const params = open >= 0 ? splitArgs(headerSkel.slice(open + 1, close)) : [];
    const mapped = /@(\w+Mapping|RequestMapping)\b/.test(headerSkel);
    const tainted = new Map<string, VarInfo>();
    const constant = new Set<string>();
    const nonConst = new Set<string>();
    const requestNames = new Set<string>(["request", "req", "httpRequest", "httpServletRequest", "servletRequest"]);
    const sigLine = lineOf(h + 1 + Math.max(0, open));
    for (const p of params) {
      const pm = /(?:final\s+)?([\w.]+(?:<[^>]*>)?(?:\[\])?)\s+(\w+)\s*$/.exec(p.replace(/@\w+(\s*\([^)]*\))?/g, " ").trim());
      if (!pm) continue;
      const type = pm[1].replace(/<.*$/, "").split(".").pop()!, name = pm[2];
      if (REQUEST_TYPES.test(type)) { requestNames.add(name); continue; }
      if (SOURCE_ANN.test(p) || (isController && mapped && !NON_SOURCE_TYPES.test(type))) tainted.set(name, { line: sigLine, code: codeAt(sigLine), step: `parameter ${name}`, from: null });
    }
    nonConst.add("__params__");
    for (const p of params) { const nm = /(\w+)\s*$/.exec(p); if (nm) nonConst.add(nm[1]); }
    const bodySkel = skel.slice(m.bodyStart, m.bodyEnd);
    const bodyClean = clean.slice(m.bodyStart, m.bodyEnd);
    const base = m.bodyStart;
    // 문장 단위: ; { } 로 끊는다(for 헤더의 ; 는 괄호 안이라 건너뜀)
    const stmts: { s: number; e: number }[] = [];
    { let st = 0, d = 0; for (let i = 0; i < bodySkel.length; i++) { const c = bodySkel[i]; if (c === "(") d++; else if (c === ")") d--; else if (d === 0 && (c === ";" || c === "{" || c === "}")) { if (i > st) stmts.push({ s: st, e: i }); st = i + 1; } } if (st < bodySkel.length) stmts.push({ s: st, e: bodySkel.length }); }
    const stripSanitized = (skelExpr: string) => {
      let out = skelExpr, guard = 0;
      SANITIZER.lastIndex = 0;
      for (let mm = SANITIZER.exec(out); mm && guard++ < 50; mm = SANITIZER.exec(out)) {
        const o = mm.index + mm[0].length - 1; const c = matchParen(out, o);
        if (c < 0) break;
        out = `${out.slice(0, mm.index)}0${" ".repeat(c - mm.index)}${out.slice(c + 1)}`;
        SANITIZER.lastIndex = mm.index + 1;
      }
      return out;
    };
    const idents = (skelExpr: string) => [...skelExpr.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\b(?!\s*\()/g)].map((x) => x[1]);
    // 소스가 전혀 없는 메서드(대부분)는 흐름 계산을 건너뛴다 — 위험 호출의 상수 판정만 한다
    SOURCE_CALL.lastIndex = 0;
    const hasSource = () => tainted.size > 0 || SOURCE_CALL.test(bodySkel) || UPLOAD_CALL.test(bodySkel);
    const anySource = hasSource();
    const taintOf = (skelExpr: string): { name: string | null; source: string | null } | null => {
      if (!anySource) return null;
      const e = skelExpr.includes("(") ? stripSanitized(skelExpr) : skelExpr;
      SOURCE_CALL.lastIndex = 0;
      for (const sm of e.matchAll(SOURCE_CALL)) if (requestNames.has(sm[1]) || /request|req$/i.test(sm[1])) return { name: null, source: `${sm[1]}.${sm[2]}()` };
      if (UPLOAD_CALL.test(e)) return { name: null, source: "uploaded file name" };
      for (const id of idents(e)) if (tainted.has(id)) return { name: id, source: null };
      // 메서드 호출 수신자(vo.getX())
      for (const r of e.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\.\s*\w+\s*\(/g)) if (tainted.has(r[1])) return { name: r[1], source: null };
      return null;
    };
    const isConstExpr = (skelExpr: string) => {
      const e = skelExpr.replace(/"[^"\n]*"|'[^'\n]*'/g, " ").replace(/\b(true|false|null|this)\b/g, " ").replace(/\b\d[\w.]*\b/g, " ");
      if (/\w+\s*\(/.test(e.replace(/\bString\s*\.\s*valueOf\s*\(/g, " ("))) return false;
      return idents(e).every((id) => /^[A-Z][A-Z0-9_]*$/.test(id) || (constant.has(id) && !nonConst.has(id)));
    };
    // 상수 변수(흐름과 무관하게 한 번)
    for (const { s, e } of stmts) {
      const st = bodySkel.slice(s, e).trim();
      const mm = /^(?:final\s+)?[\w.]+(?:<[\s\S]*>)?(?:\[\])*\s+(\w+)\s*=(?!=)\s*([\s\S]+)$/.exec(st) ?? /^(?:this\s*\.\s*)?(\w+)\s*\+?=(?!=)\s*([\s\S]+)$/.exec(st);
      if (!mm) continue;
      if (isConstExpr(mm[2]) && !nonConst.has(mm[1])) constant.add(mm[1]); else { nonConst.add(mm[1]); constant.delete(mm[1]); }
    }
    // 위험 호출 위치(문장에 배정)
    const sinkHits: { def: typeof SINKS[number]; at: number; openAt: number }[] = [];
    for (const def of SINKS) {
      def.re.lastIndex = 0;
      for (const sm of bodySkel.matchAll(def.re)) {
        if (def.receiver && !def.receiver.test(sm[1] ?? "")) continue;
        sinkHits.push({ def, at: sm.index!, openAt: sm.index! + sm[0].length - 1 });
      }
    }
    const guarded = new Set<string>();
    const chainOf = (name: string | null) => { const chain: FlowStep[] = []; const names: string[] = []; let cur = name, g = 0; while (cur && g++ < 20) { const v = tainted.get(cur); if (!v) break; names.push(cur); chain.unshift({ line: v.line, code: v.code, step: v.step }); cur = v.from; } return { chain, names }; };
    const evalSink = (hit: typeof sinkHits[number]) => {
      const closeAt = matchParen(bodySkel, hit.openAt);
      if (closeAt < 0) return;
      const args = bodySkel.slice(hit.openAt + 1, closeAt);
      // SQL 은 첫 인자(SQL 문자열)만, 나머지는 전체 인자
      const arg = hit.def.sink === "sql" ? (splitArgs(args)[0] ?? "") : args;
      const line = lineOf(base + hit.at);
      const column = base + hit.at - clean.lastIndexOf("\n", base + hit.at - 1);
      const t = taintOf(arg);
      let status: SinkFlow["status"] = "unknown";
      const pathSteps: FlowStep[] = [];
      if (t) {
        const { chain, names } = chainOf(t.name);
        // 경로 조작: 검증(startsWith·isSafe… )을 거친 값이면 판단 불가
        if (hit.def.sink === "path" && names.some((x) => guarded.has(x))) status = "unknown";
        else {
          status = "tainted";
          pathSteps.push(...chain);
          if (t.source) pathSteps.push({ line, code: codeAt(line), step: t.source });
          pathSteps.push({ line, code: codeAt(line), step: `${hit.def.sink} sink` });
        }
      } else if (arg.trim() && isConstExpr(arg)) status = "constant";
      results.push({ sink: hit.def.sink, line, column, status, path: pathSteps, method: m.name });
    };
    // 문장 순서대로: 그 문장 안의 위험 호출을 지금 상태로 판정 → 검증 조건 → 대입(덮어쓰면 흐름이 끊김)
    sinkHits.sort((a, b) => a.at - b.at);
    const done = new Set<typeof sinkHits[number]>();
    let hp = 0;
    for (const { s, e } of stmts) {
      while (hp < sinkHits.length && sinkHits[hp].at < s) hp++;
      for (let q = hp; q < sinkHits.length && sinkHits[q].at < e; q++) { evalSink(sinkHits[q]); done.add(sinkHits[q]); }
      const raw = bodySkel.slice(s, e);
      const st = raw.trim();
      if (!st) continue;
      for (const g of GUARD) { g.lastIndex = 0; for (const gm of st.matchAll(g)) guarded.add(gm[1]); }
      const ln = lineOf(base + s + (raw.length - raw.trimStart().length));
      let target: string | null = null, rhs: string | null = null, step = "", additive = false;
      let mm = /^(?:final\s+)?[\w.]+(?:<[\s\S]*>)?(?:\[\])*\s+(\w+)\s*=(?!=)\s*([\s\S]+)$/.exec(st);
      if (mm) { target = mm[1]; rhs = mm[2]; step = `${target} =`; }
      else if ((mm = /^(?:this\s*\.\s*)?(\w+)\s*(\+?=)(?!=)\s*([\s\S]+)$/.exec(st))) { target = mm[1]; rhs = mm[3]; step = `${target} ${mm[2]}`; additive = mm[2] === "+="; }
      else if ((mm = /^for\s*\(\s*(?:final\s+)?[\w.<>\[\],?\s]+?\s+(\w+)\s*:\s*([\s\S]+)\)$/.exec(st))) { target = mm[1]; rhs = mm[2]; step = `for ${target}`; }
      else if ((mm = /^(\w+)\s*\.\s*(append|add|addAll|put|putAll|set|insert|concat)\s*\(([\s\S]*)$/.exec(st))) { target = mm[1]; rhs = mm[3]; step = `${target}.${mm[2]}(…)`; additive = true; }
      if (!target || rhs === null) continue;
      const t = taintOf(rhs);
      if (t) { if (!tainted.has(target)) tainted.set(target, { line: ln, code: codeAt(ln), step: t.source ? `${step} ${t.source}` : `${step} ${t.name}`, from: t.name }); }
      else if (!additive) { tainted.delete(target); guarded.delete(target); }
      // 검증된 값에서 온 변수도 검증된 것으로
      if (t?.name && guarded.has(t.name)) guarded.add(target);
    }
    // 문장 밖(람다 본문 등)에 남은 위험 호출
    for (const hit of sinkHits) if (!done.has(hit)) evalSink(hit);
    void bodyClean;
  }
  // 같은 줄·같은 종류 중복 제거(가장 강한 판정)
  const rank = { tainted: 0, unknown: 1, constant: 2 } as const;
  const byKey = new Map<string, SinkFlow>();
  for (const r of results) { const k = `${r.sink}|${r.line}`; const cur = byKey.get(k); if (!cur || rank[r.status] < rank[cur.status]) byKey.set(k, r); }
  return [...byKey.values()].sort((a, b) => a.line - b.line);
}
