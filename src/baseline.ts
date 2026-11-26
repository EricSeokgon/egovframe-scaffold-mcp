// 점검 기준선 (v1.26.0) — "지금 있는 것은 목록으로, 새로 생기는 것만 막는다".
//   - 지문: 점검 종류 + 규칙 + 프로젝트 상대 경로 + 줄 번호가 아닌 대상 + 같은 키 안의 순번.
//     위에 줄을 끼워 넣어도 같은 항목으로 남고, 응답 언어(ko/en)와도 무관하다.
//   - 기준선 파일은 그 도구의 이전 JSON 결과 그대로다(별도 형식 없음).
//   - 보안약점 점검(v0.44)의 지문 값·SARIF 기준선은 그대로 둔다 — secure-coding.ts 가 자기 지문을 만들고 여기서는 읽기만 공유한다.
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { resolveOutputPath } from "./sbom.js";
import { L } from "./lang.js";

export type BaselineCheck = "secure" | "operations" | "privacy" | "access" | "mapper" | "consistency";
export interface BaselineInfo { path: string; findings: number; resolved: number }
export interface Fingerprinted { fingerprint?: string; isNew?: boolean }

/** 지문 한 개 — 32자 hex. parts 에 줄 번호·번역되는 문구를 넣지 않는다. */
export function fingerprintOf(check: BaselineCheck, parts: (string | number | undefined | null)[], nth = 1): string {
  const key = [check, ...parts.map((p) => String(p ?? "").replace(/\s+/g, " ").trim())].join("|");
  return createHash("sha256").update(`${key}|${nth}`).digest("hex").slice(0, 32);
}

/** 항목마다 지문을 붙인다. 같은 키가 여러 번 나오면 나온 순서대로 순번을 매긴다(정렬·예외 처리 전에 부를 것). */
export function assignFingerprints<T extends Fingerprinted>(check: BaselineCheck, items: T[], partsOf: (item: T) => (string | number | undefined | null)[]): T[] {
  const seen = new Map<string, number>();
  for (const it of items) {
    const parts = partsOf(it);
    const key = parts.map((p) => String(p ?? "")).join("|");
    const nth = (seen.get(key) ?? 0) + 1; seen.set(key, nth);
    it.fingerprint = fingerprintOf(check, parts, nth);
  }
  return items;
}

/** 공용 경로 검증 오류의 'outputPath' 를 실제 파라미터 이름으로 바꾼다. */
function relabel<T>(name: string, fn: () => T): T {
  try { return fn(); } catch (e) { throw new Error((e instanceof Error ? e.message : String(e)).replace(/outputPath/g, name)); }
}

type Doc = Record<string, unknown>;
const isObj = (v: unknown): v is Doc => !!v && typeof v === "object" && !Array.isArray(v);
/** 결과 JSON 이 어느 도구의 것인지(모르면 null) */
export function baselineKindOf(doc: unknown): "secure" | "sarif" | "operations" | "privacy" | "access" | "validate" | null {
  if (!isObj(doc)) return null;
  if (Array.isArray(doc.runs)) return "sarif";
  if ("manifestFound" in doc || isObj(doc.mapper) || isObj(doc.consistency)) return "validate";
  if (Array.isArray(doc.handlers) && isObj(doc.global)) return "access";
  if (Array.isArray(doc.columns) && Array.isArray(doc.flows)) return "privacy";
  if (isObj(doc.grade) && isObj(doc.configSet)) return "operations";
  if (Array.isArray(doc.findings) && (Array.isArray(doc.byRule) || isObj(doc.byOrigin))) return "secure";
  return null;
}
const KIND_OF: Record<BaselineCheck, ReturnType<typeof baselineKindOf>> = { secure: "secure", operations: "operations", privacy: "privacy", access: "access", mapper: "validate", consistency: "validate" };
const TOOL_OF: Record<string, string> = { secure: "check_egovframe_secure_coding", sarif: "check_egovframe_secure_coding(SARIF)", operations: "check_egovframe_operations", privacy: "check_egovframe_privacy", access: "check_egovframe_access", validate: "validate_egovframe_project" };

export interface LoadedBaseline { relPath: string; fingerprints: Set<string>; truncated: boolean }

/**
 * 기준선(그 도구의 이전 JSON 결과)을 읽어 지문 집합을 돌려준다.
 * 다른 도구의 결과·지문 없는(v1.25 이하) 결과는 조용히 "전부 새 항목"이 되지 않게 오류로 알린다.
 */
export function readCheckBaseline(projectDir: string, rel: string, check: BaselineCheck): LoadedBaseline {
  const { relPath, absolutePath } = relabel("baselinePath", () => resolveOutputPath(projectDir, rel));
  if (!fs.existsSync(absolutePath)) throw new Error(L(`baseline 이 없습니다: ${relPath}`, `baseline not found: ${relPath}`));
  let doc: unknown;
  try { doc = JSON.parse(fs.readFileSync(absolutePath, "utf8")); } catch (e) { throw new Error(L(`baseline(${relPath}) JSON 해석 실패: ${e instanceof Error ? e.message : String(e)}`, `baseline (${relPath}): failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`)); }
  const kind = baselineKindOf(doc), want = KIND_OF[check]!;
  if (kind !== want) {
    const what = kind ? L(`${TOOL_OF[kind]} 의 결과입니다`, `is a ${TOOL_OF[kind]} result`) : L("이 도구의 JSON 결과가 아닙니다", "is not a JSON result of this tool");
    throw new Error(L(`baseline(${relPath}) 이 ${what} — ${TOOL_OF[want]} 의 format=json 결과(CLI --json-out)를 주세요`, `baseline (${relPath}) ${what} — pass the format=json result of ${TOOL_OF[want]} (CLI --json-out)`));
  }
  const d = doc as Doc;
  const section = check === "mapper" || check === "consistency" ? (isObj(d[check]) ? (d[check] as Doc) : null) : d;
  if (!section) throw new Error(L(`baseline(${relPath}) 에 ${check} 결과가 없습니다 — ${check}=true 로 만든 결과를 주세요`, `baseline (${relPath}) has no ${check} result — pass a result produced with ${check}=true`));
  const list = (check === "mapper" || check === "consistency" ? section.issues : section.findings);
  const items = Array.isArray(list) ? (list as Doc[]) : [];
  const fps = new Set<string>();
  for (const f of items) if (isObj(f) && typeof f.fingerprint === "string") fps.add(f.fingerprint);
  if (items.length && !fps.size) throw new Error(L(`baseline(${relPath}) 의 항목에 지문(fingerprint)이 없습니다 — v1.26.0 이상으로 다시 만든 결과를 주세요`, `baseline (${relPath}) findings carry no fingerprint — regenerate it with v1.26.0 or later`));
  const sm = isObj(section.summary) ? section.summary : {};
  const total = (check === "mapper" || check === "consistency") && typeof sm.errors === "number" && typeof sm.warnings === "number" ? sm.errors + sm.warnings : items.length;
  return { relPath, fingerprints: fps, truncated: section.truncated === true || total > items.length };
}

/** 항목에 isNew 를 붙이고 해결 건수를 센다. items 는 잘라 내기 전의 전체여야 한다. */
export function applyBaseline<T extends Fingerprinted>(items: T[], base: LoadedBaseline): { info: BaselineInfo; newCount: number; note?: string } {
  const now = new Set<string>();
  let newCount = 0;
  for (const it of items) { const fp = it.fingerprint ?? ""; now.add(fp); it.isNew = !base.fingerprints.has(fp); if (it.isNew) newCount++; }
  let resolved = 0;
  for (const fp of base.fingerprints) if (!now.has(fp)) resolved++;
  return {
    info: { path: base.relPath, findings: base.fingerprints.size, resolved }, newCount,
    ...(base.truncated ? { note: L(`baseline(${base.relPath}) 이 잘린 결과입니다(truncated) — 잘린 뒤의 항목이 새 항목으로 보입니다. maxIssues 를 늘려 다시 만드세요.`, `baseline (${base.relPath}) is a truncated result — findings past the cut show up as new. Regenerate it with a larger maxIssues.`) } : {}),
  };
}

/** 요약 한 줄(Markdown) */
export function baselineLine(info: BaselineInfo, newCount: number): string {
  return L(`- 비교: ${info.path}(이전 ${info.findings}건) — 새 항목 ${newCount}건 · 해결 ${info.resolved}건`, `- Baseline: ${info.path} (${info.findings} previous findings) — ${newCount} new · ${info.resolved} resolved`);
}
