// 기관 규칙 팩 (v1.23) — 동봉 규칙 위에 얹는 기관·사업자 기준.
//   팩 = 디렉터리 하나: rule-pack.json(이름·버전 + 도구별 절). 절은 그 자리에 쓰거나 같은 디렉터리의 JSON 파일 이름으로 가리킨다.
//   - secureCoding: 규칙 추가·덮어쓰기(id) · severity 조정 · disable
//   - operations:   규칙 추가(line·lacks·pom) · thresholds(maxMinutes·maxBytes) · severity · disable
//   - dependencies: banned(금지 좌표·대체 안내) · minimum(최소 버전)
//   - privacy:      items(컬럼 사전) · cryptoCalls·sqlCryptoFunctions·maskCalls(호출 사전 추가)
//   경로는 도구 파라미터 rulePacks 또는 환경 변수 EGOVFRAME_RULE_PACKS(경로 구분자로 여러 개 — 뒤가 이김).
//   팩은 데이터만 담는다(코드 실행 없음). 로드할 때 형식·정규식·id·check 종류를 검증하고 틀리면 사유와 함께 거부한다.
//   팩이 없으면 각 도구의 동작과 출력은 그대로다.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { assertPathAllowed } from "./allowed-roots.js";
import { L } from "./lang.js";
import { compileRulePattern, loadSecureRules, type SecureRule, type SecureRules, type SecureSeverity } from "./secure-coding.js";
import { loadOperationsRules, type OpsRule, type OpsRules, type OpsSeverity } from "./operations.js";
import { loadPrivacyRules, type PrivacyItemRule, type PrivacyRules } from "./privacy.js";

export const RULE_PACKS_ENV = "EGOVFRAME_RULE_PACKS";
export const RULE_PACK_FILE = "rule-pack.json";
export const RULE_PACK_SECTIONS = ["secureCoding", "operations", "dependencies", "privacy"] as const;
export type RulePackSection = (typeof RULE_PACK_SECTIONS)[number];

export interface PackBannedDependency { groupId: string; artifactId?: string; /** 이 버전 미만만 금지(없으면 전부) */ versionBelow?: string; reason: string; reason_en?: string; replacement?: string }
export interface PackMinimumDependency { groupId: string; artifactId: string; version: string; reason?: string; reason_en?: string }
export interface RulePack {
  name: string; version: string; description?: string; dir: string; sha256: string; files: string[];
  secureCoding?: { rules: SecureRule[]; severity: Record<string, SecureSeverity>; disable: string[] };
  operations?: { rules: OpsRule[]; thresholds: Record<string, { maxMinutes?: number; maxBytes?: number }>; severity: Record<string, OpsSeverity>; disable: string[] };
  dependencies?: { banned: PackBannedDependency[]; minimum: PackMinimumDependency[] };
  privacy?: { items: PrivacyItemRule[]; cryptoCalls: string[]; sqlCryptoFunctions: string[]; maskCalls: string[] };
}
/** 결과에 남기는 팩 표시(경로는 넣지 않는다 — 사람마다 다르다) */
export interface RulePackInfo { name: string; version: string; sha256: string; sections: RulePackSection[] }
export const rulePackInfo = (packs: RulePack[]): RulePackInfo[] => packs.map((p) => ({ name: p.name, version: p.version, sha256: p.sha256, sections: RULE_PACK_SECTIONS.filter((s) => p[s]) }));

export class RulePackError extends Error {
  readonly problems: string[];
  constructor(dir: string, problems: string[]) {
    super(L(`규칙 팩을 읽지 못했습니다: ${dir}\n${problems.map((p) => `- ${p}`).join("\n")}`, `Could not load the rule pack: ${dir}\n${problems.map((p) => `- ${p}`).join("\n")}`));
    this.name = "RulePackError";
    this.problems = problems;
  }
}

/** 파라미터가 있으면 그것, 없으면 환경 변수(경로 구분자로 나눔). 빈 값은 "팩 없음" */
export function resolveRulePackPaths(param?: string[] | null, env: string | undefined = process.env[RULE_PACKS_ENV]): string[] {
  const list = param && param.length ? param : (env ?? "").split(path.delimiter);
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

const SEVERITIES = ["high", "medium", "low"];
const SECURE_TARGETS = ["java", "jsp", "mapper", "sqlmap", "config"];
const OPS_TARGETS = ["properties", "yaml", "xml", "web-xml", "log4j2", "logback"];
const OPS_PACK_KINDS = ["line", "lacks", "pom"];
const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COORD_RE = /^[A-Za-z0-9_.\-]+$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function tryRegex(src: unknown, where: string, problems: string[]): void {
  if (!isStr(src)) { problems.push(L(`${where}: 정규식 문자열이 필요합니다`, `${where}: a regular expression string is required`)); return; }
  if (src.length > 2000) { problems.push(L(`${where}: 정규식이 너무 깁니다(2000자 이하)`, `${where}: the regular expression is too long (max 2000 characters)`)); return; }
  try { compileRulePattern(src); } catch (e) { problems.push(L(`${where}: 정규식을 컴파일하지 못했습니다 — ${(e as Error).message}`, `${where}: the regular expression does not compile — ${(e as Error).message}`)); }
}
function unknownKeys(o: Record<string, unknown>, allowed: string[], where: string, problems: string[]): void {
  const bad = Object.keys(o).filter((k) => !allowed.includes(k));
  if (bad.length) problems.push(L(`${where}: 알 수 없는 키 ${bad.join(", ")} (쓸 수 있는 키: ${allowed.join(", ")})`, `${where}: unknown key(s) ${bad.join(", ")} (allowed: ${allowed.join(", ")})`));
}
function idMap<T extends string>(v: unknown, values: string[], where: string, problems: string[]): Record<string, T> {
  if (v === undefined) return {};
  if (!isObj(v)) { problems.push(L(`${where}: { "규칙 id": "값" } 모양이어야 합니다`, `${where}: must be an object { "rule id": "value" }`)); return {}; }
  for (const [k, x] of Object.entries(v)) if (!values.includes(String(x))) problems.push(L(`${where}.${k}: ${values.join("|")} 중 하나여야 합니다`, `${where}.${k}: must be one of ${values.join("|")}`));
  return v as Record<string, T>;
}
function idList(v: unknown, where: string, problems: string[]): string[] {
  if (v === undefined) return [];
  if (!strList(v)) { problems.push(L(`${where}: 규칙 id 문자열 배열이어야 합니다`, `${where}: must be an array of rule id strings`)); return []; }
  return v;
}

const SECURE_RULE_KEYS = ["id", "guideItem", "guideItem_en", "category", "cwe", "severity", "targets", "pattern", "unless", "fileHas", "fileLacks", "scope", "message", "message_en", "fix", "fix_en"];
function validateSecure(raw: unknown, problems: string[], earlier: RulePack[]): RulePack["secureCoding"] {
  const W = "secureCoding";
  if (!isObj(raw)) { problems.push(L(`${W}: 객체여야 합니다`, `${W}: must be an object`)); return undefined; }
  unknownKeys(raw, ["rules", "severity", "disable"], W, problems);
  const base = loadSecureRules();
  const cats = base.categories.map((c) => c.id);
  const rules: SecureRule[] = [];
  const seen = new Set<string>();
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) problems.push(L(`${W}.rules: 배열이어야 합니다`, `${W}.rules: must be an array`));
  for (const [i, r] of (Array.isArray(raw.rules) ? raw.rules : []).entries()) {
    const w = `${W}.rules[${i}]`;
    if (!isObj(r)) { problems.push(L(`${w}: 객체여야 합니다`, `${w}: must be an object`)); continue; }
    unknownKeys(r, SECURE_RULE_KEYS, w, problems);
    if (!isStr(r.id) || !ID_RE.test(r.id)) problems.push(L(`${w}.id: 소문자·숫자·하이픈 id 가 필요합니다`, `${w}.id: a lowercase/digit/hyphen id is required`));
    else if (seen.has(r.id)) problems.push(L(`${w}.id: 팩 안에서 id 가 겹칩니다(${r.id})`, `${w}.id: duplicate id inside the pack (${r.id})`));
    else seen.add(r.id);
    for (const k of ["guideItem", "message", "fix"]) if (!isStr(r[k])) problems.push(L(`${w}.${k}: 문자열이 필요합니다`, `${w}.${k}: a string is required`));
    if (!cats.includes(String(r.category))) problems.push(L(`${w}.category: ${cats.join("|")} 중 하나여야 합니다`, `${w}.category: must be one of ${cats.join("|")}`));
    if (!Number.isInteger(r.cwe) || (r.cwe as number) <= 0) problems.push(L(`${w}.cwe: CWE 번호(양의 정수)가 필요합니다`, `${w}.cwe: a CWE number (positive integer) is required`));
    if (!SEVERITIES.includes(String(r.severity))) problems.push(L(`${w}.severity: high|medium|low`, `${w}.severity: high|medium|low`));
    if (!Array.isArray(r.targets) || !r.targets.length || !r.targets.every((t) => SECURE_TARGETS.includes(String(t)))) problems.push(L(`${w}.targets: ${SECURE_TARGETS.join("|")} 의 배열이어야 합니다`, `${w}.targets: must be an array of ${SECURE_TARGETS.join("|")}`));
    if (r.scope !== undefined && r.scope !== "line" && r.scope !== "file") problems.push(L(`${w}.scope: line|file`, `${w}.scope: line|file`));
    tryRegex(r.pattern, `${w}.pattern`, problems);
    for (const k of ["unless", "fileHas", "fileLacks"]) if (r[k] !== undefined) tryRegex(r[k], `${w}.${k}`, problems);
    rules.push(r as unknown as SecureRule);
  }
  const known = new Set([...base.rules.map((r) => r.id), ...earlier.flatMap((p) => p.secureCoding?.rules.map((r) => r.id) ?? []), ...rules.map((r) => r.id)]);
  const severity = idMap<SecureSeverity>(raw.severity, SEVERITIES, `${W}.severity`, problems);
  const disable = idList(raw.disable, `${W}.disable`, problems);
  for (const id of [...Object.keys(severity), ...disable]) if (!known.has(id)) problems.push(L(`${W}: 없는 규칙 id 를 가리킵니다(${id})`, `${W}: refers to an unknown rule id (${id})`));
  return { rules, severity, disable };
}

const OPS_RULE_KEYS = ["id", "category", "severity", "title", "title_en", "check", "message", "message_en", "fix", "fix_en", "basis", "basis_en"];
function validateOps(raw: unknown, problems: string[], earlier: RulePack[]): RulePack["operations"] {
  const W = "operations";
  if (!isObj(raw)) { problems.push(L(`${W}: 객체여야 합니다`, `${W}: must be an object`)); return undefined; }
  unknownKeys(raw, ["rules", "thresholds", "severity", "disable"], W, problems);
  const base = loadOperationsRules();
  const cats = base.categories.map((c) => c.id);
  const rules: OpsRule[] = [];
  const seen = new Set<string>();
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) problems.push(L(`${W}.rules: 배열이어야 합니다`, `${W}.rules: must be an array`));
  for (const [i, r] of (Array.isArray(raw.rules) ? raw.rules : []).entries()) {
    const w = `${W}.rules[${i}]`;
    if (!isObj(r)) { problems.push(L(`${w}: 객체여야 합니다`, `${w}: must be an object`)); continue; }
    unknownKeys(r, OPS_RULE_KEYS, w, problems);
    if (!isStr(r.id) || !ID_RE.test(r.id)) problems.push(L(`${w}.id: 소문자·숫자·하이픈 id 가 필요합니다`, `${w}.id: a lowercase/digit/hyphen id is required`));
    else if (seen.has(r.id)) problems.push(L(`${w}.id: 팩 안에서 id 가 겹칩니다(${r.id})`, `${w}.id: duplicate id inside the pack (${r.id})`));
    else seen.add(r.id);
    for (const k of ["title", "message", "fix", "basis"]) if (!isStr(r[k])) problems.push(L(`${w}.${k}: 문자열이 필요합니다`, `${w}.${k}: a string is required`));
    if (!cats.includes(String(r.category))) problems.push(L(`${w}.category: ${cats.join("|")} 중 하나여야 합니다`, `${w}.category: must be one of ${cats.join("|")}`));
    if (!SEVERITIES.includes(String(r.severity))) problems.push(L(`${w}.severity: high|medium|low`, `${w}.severity: high|medium|low`));
    const c = r.check;
    if (!isObj(c)) { problems.push(L(`${w}.check: 객체여야 합니다`, `${w}.check: must be an object`)); continue; }
    unknownKeys(c, ["kind", "targets", "pattern", "unless", "requires", "artifact"], `${w}.check`, problems);
    if (!OPS_PACK_KINDS.includes(String(c.kind))) { problems.push(L(`${w}.check.kind: 알 수 없는 check 종류 '${String(c.kind)}' — 팩 규칙은 ${OPS_PACK_KINDS.join("|")} 만 씁니다`, `${w}.check.kind: unknown check kind '${String(c.kind)}' — pack rules may use ${OPS_PACK_KINDS.join("|")} only`)); continue; }
    if (c.kind === "pom") { if (!isStr(c.artifact)) problems.push(L(`${w}.check.artifact: 의존성 artifactId 가 필요합니다`, `${w}.check.artifact: a dependency artifactId is required`)); }
    else {
      if (!Array.isArray(c.targets) || !c.targets.length || !c.targets.every((t) => OPS_TARGETS.includes(String(t)))) problems.push(L(`${w}.check.targets: ${OPS_TARGETS.join("|")} 의 배열이어야 합니다`, `${w}.check.targets: must be an array of ${OPS_TARGETS.join("|")}`));
      tryRegex(c.pattern, `${w}.check.pattern`, problems);
      if (c.unless !== undefined) tryRegex(c.unless, `${w}.check.unless`, problems);
      if (c.kind === "lacks") tryRegex(c.requires, `${w}.check.requires`, problems);
    }
    rules.push(r as unknown as OpsRule);
  }
  const known = new Set([...base.rules.map((r) => r.id), ...earlier.flatMap((p) => p.operations?.rules.map((r) => r.id) ?? []), ...rules.map((r) => r.id)]);
  const thresholds: Record<string, { maxMinutes?: number; maxBytes?: number }> = {};
  if (raw.thresholds !== undefined && !isObj(raw.thresholds)) problems.push(L(`${W}.thresholds: { "규칙 id": { maxMinutes | maxBytes } } 모양이어야 합니다`, `${W}.thresholds: must be { "rule id": { maxMinutes | maxBytes } }`));
  for (const [id, t] of Object.entries(isObj(raw.thresholds) ? raw.thresholds : {})) {
    const w = `${W}.thresholds.${id}`;
    const target = base.rules.find((r) => r.id === id);
    if (!isObj(t)) { problems.push(L(`${w}: 객체여야 합니다`, `${w}: must be an object`)); continue; }
    unknownKeys(t, ["maxMinutes", "maxBytes"], w, problems);
    for (const k of ["maxMinutes", "maxBytes"] as const) {
      if (t[k] === undefined) continue;
      if (!Number.isFinite(t[k]) || (t[k] as number) <= 0) problems.push(L(`${w}.${k}: 양수여야 합니다`, `${w}.${k}: must be a positive number`));
      else if (!target || target.check[k] === undefined) problems.push(L(`${w}.${k}: 이 임계값이 있는 동봉 규칙이 아닙니다(${base.rules.filter((r) => r.check[k] !== undefined).map((r) => r.id).join(", ")})`, `${w}.${k}: not a bundled rule with this threshold (${base.rules.filter((r) => r.check[k] !== undefined).map((r) => r.id).join(", ")})`));
    }
    thresholds[id] = t as { maxMinutes?: number; maxBytes?: number };
  }
  const severity = idMap<OpsSeverity>(raw.severity, SEVERITIES, `${W}.severity`, problems);
  const disable = idList(raw.disable, `${W}.disable`, problems);
  for (const id of [...Object.keys(severity), ...disable]) if (!known.has(id)) problems.push(L(`${W}: 없는 규칙 id 를 가리킵니다(${id})`, `${W}: refers to an unknown rule id (${id})`));
  return { rules, thresholds, severity, disable };
}

function validateDeps(raw: unknown, problems: string[]): RulePack["dependencies"] {
  const W = "dependencies";
  if (!isObj(raw)) { problems.push(L(`${W}: 객체여야 합니다`, `${W}: must be an object`)); return undefined; }
  unknownKeys(raw, ["banned", "minimum"], W, problems);
  const banned: PackBannedDependency[] = [], minimum: PackMinimumDependency[] = [];
  for (const k of ["banned", "minimum"] as const) if (raw[k] !== undefined && !Array.isArray(raw[k])) problems.push(L(`${W}.${k}: 배열이어야 합니다`, `${W}.${k}: must be an array`));
  const version = (v: unknown) => isStr(v) && /^\d[\w.\-+]*$/.test(v);
  for (const [i, b] of (Array.isArray(raw.banned) ? raw.banned : []).entries()) {
    const w = `${W}.banned[${i}]`;
    if (!isObj(b)) { problems.push(L(`${w}: 객체여야 합니다`, `${w}: must be an object`)); continue; }
    unknownKeys(b, ["groupId", "artifactId", "versionBelow", "reason", "reason_en", "replacement"], w, problems);
    if (!isStr(b.groupId) || !COORD_RE.test(b.groupId)) problems.push(L(`${w}.groupId: 좌표 문자열이 필요합니다`, `${w}.groupId: a coordinate string is required`));
    if (b.artifactId !== undefined && (!isStr(b.artifactId) || !COORD_RE.test(b.artifactId))) problems.push(L(`${w}.artifactId: 좌표 문자열이어야 합니다`, `${w}.artifactId: must be a coordinate string`));
    if (b.versionBelow !== undefined && !version(b.versionBelow)) problems.push(L(`${w}.versionBelow: 버전 문자열이어야 합니다`, `${w}.versionBelow: must be a version string`));
    if (!isStr(b.reason)) problems.push(L(`${w}.reason: 금지 사유가 필요합니다`, `${w}.reason: a reason is required`));
    banned.push(b as unknown as PackBannedDependency);
  }
  for (const [i, m] of (Array.isArray(raw.minimum) ? raw.minimum : []).entries()) {
    const w = `${W}.minimum[${i}]`;
    if (!isObj(m)) { problems.push(L(`${w}: 객체여야 합니다`, `${w}: must be an object`)); continue; }
    unknownKeys(m, ["groupId", "artifactId", "version", "reason", "reason_en"], w, problems);
    for (const k of ["groupId", "artifactId"]) if (!isStr(m[k]) || !COORD_RE.test(m[k] as string)) problems.push(L(`${w}.${k}: 좌표 문자열이 필요합니다`, `${w}.${k}: a coordinate string is required`));
    if (!version(m.version)) problems.push(L(`${w}.version: 버전 문자열이 필요합니다`, `${w}.version: a version string is required`));
    minimum.push(m as unknown as PackMinimumDependency);
  }
  return { banned, minimum };
}

function validatePrivacy(raw: unknown, problems: string[]): RulePack["privacy"] {
  const W = "privacy";
  if (!isObj(raw)) { problems.push(L(`${W}: 객체여야 합니다`, `${W}: must be an object`)); return undefined; }
  unknownKeys(raw, ["items", "cryptoCalls", "sqlCryptoFunctions", "maskCalls"], W, problems);
  const grades = loadPrivacyRules().grades.map((g) => g.id as string);
  const items: PrivacyItemRule[] = [];
  const seen = new Set<string>();
  if (raw.items !== undefined && !Array.isArray(raw.items)) problems.push(L(`${W}.items: 배열이어야 합니다`, `${W}.items: must be an array`));
  for (const [i, it] of (Array.isArray(raw.items) ? raw.items : []).entries()) {
    const w = `${W}.items[${i}]`;
    if (!isObj(it)) { problems.push(L(`${w}: 객체여야 합니다`, `${w}: must be an object`)); continue; }
    unknownKeys(it, ["id", "grade", "label", "label_en", "columns"], w, problems);
    if (!isStr(it.id) || !ID_RE.test(it.id)) problems.push(L(`${w}.id: 소문자·숫자·하이픈 id 가 필요합니다`, `${w}.id: a lowercase/digit/hyphen id is required`));
    else if (seen.has(it.id)) problems.push(L(`${w}.id: 팩 안에서 id 가 겹칩니다(${it.id})`, `${w}.id: duplicate id inside the pack (${it.id})`));
    else seen.add(it.id);
    if (!grades.includes(String(it.grade))) problems.push(L(`${w}.grade: ${grades.join("|")} 중 하나여야 합니다`, `${w}.grade: must be one of ${grades.join("|")}`));
    if (!isStr(it.label)) problems.push(L(`${w}.label: 문자열이 필요합니다`, `${w}.label: a string is required`));
    tryRegex(it.columns, `${w}.columns`, problems);
    items.push(it as unknown as PrivacyItemRule);
  }
  const calls = (k: string): string[] => {
    const v = raw[k];
    if (v === undefined) return [];
    if (!strList(v)) { problems.push(L(`${W}.${k}: 정규식 문자열 배열이어야 합니다`, `${W}.${k}: must be an array of regular expression strings`)); return []; }
    v.forEach((s, i) => tryRegex(s, `${W}.${k}[${i}]`, problems));
    return v;
  };
  return { items, cryptoCalls: calls("cryptoCalls"), sqlCryptoFunctions: calls("sqlCryptoFunctions"), maskCalls: calls("maskCalls") };
}

/** 팩 디렉터리 하나를 읽고 검증한다. 문제가 있으면 RulePackError(사유 전부). earlier = 먼저 적용되는 팩(그 팩이 더한 규칙 id 를 가리킬 수 있다) */
export function loadRulePack(dirInput: string, earlier: RulePack[] = []): RulePack {
  const dir = assertPathAllowed("rulePacks", dirInput);
  const problems: string[] = [];
  const manifestPath = path.join(dir, RULE_PACK_FILE);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new RulePackError(dirInput, [L("디렉터리가 없습니다", "the directory does not exist")]);
  if (!fs.existsSync(manifestPath)) throw new RulePackError(dirInput, [L(`${RULE_PACK_FILE} 이 없습니다`, `${RULE_PACK_FILE} is missing`)]);
  const hash = createHash("sha256");
  const files: string[] = [];
  const readJson = (rel: string): unknown => {
    const full = path.resolve(dir, rel);
    const outside = path.relative(dir, full);
    if (outside.startsWith("..") || path.isAbsolute(outside)) { problems.push(L(`${rel}: 팩 디렉터리 밖의 파일은 읽지 않습니다`, `${rel}: files outside the pack directory are not read`)); return undefined; }
    let text: string;
    try {
      if (fs.statSync(full).size > 2 * 1024 * 1024) { problems.push(L(`${rel}: 파일이 너무 큽니다(2MB 이하)`, `${rel}: the file is too large (max 2 MB)`)); return undefined; }
      text = fs.readFileSync(full, "utf8");
    } catch { problems.push(L(`${rel}: 파일을 읽지 못했습니다`, `${rel}: could not read the file`)); return undefined; }
    // 줄바꿈 방식과 무관하게 같은 지문(Windows 체크아웃)
    const norm = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
    hash.update(`${rel.split(path.sep).join("/")}\n${norm}\n`);
    files.push(rel.split(path.sep).join("/"));
    try { return JSON.parse(norm); } catch (e) { problems.push(L(`${rel}: JSON 이 아닙니다 — ${(e as Error).message}`, `${rel}: not valid JSON — ${(e as Error).message}`)); return undefined; }
  };
  const m = readJson(RULE_PACK_FILE);
  if (!isObj(m)) { if (!problems.length) problems.push(L(`${RULE_PACK_FILE}: 객체여야 합니다`, `${RULE_PACK_FILE}: must be an object`)); throw new RulePackError(dirInput, problems); }
  unknownKeys(m, ["schemaVersion", "name", "version", "description", ...RULE_PACK_SECTIONS], RULE_PACK_FILE, problems);
  if (m.schemaVersion !== 1) problems.push(L(`schemaVersion: 1 이어야 합니다(이 버전이 읽는 형식)`, `schemaVersion: must be 1 (the format this version reads)`));
  if (!isStr(m.name) || !/^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$/.test(m.name)) problems.push(L("name: 영문·숫자·점·밑줄·하이픈 1–64자가 필요합니다", "name: 1–64 letters, digits, dots, underscores or hyphens are required"));
  if (!isStr(m.version) || m.version.length > 40) problems.push(L("version: 문자열(40자 이하)이 필요합니다", "version: a string (max 40 characters) is required"));
  if (m.description !== undefined && typeof m.description !== "string") problems.push(L("description: 문자열이어야 합니다", "description: must be a string"));
  const section = (k: RulePackSection): unknown => {
    const v = m[k];
    if (typeof v !== "string") return v;
    if (!/^[\w.\-]+\.json$/.test(v)) { problems.push(L(`${k}: 파일로 가리킬 때는 같은 디렉터리의 .json 파일 이름이어야 합니다(${v})`, `${k}: when pointing to a file it must be a .json file name in the same directory (${v})`)); return undefined; }
    return readJson(v);
  };
  const pack: RulePack = { name: String(m.name ?? ""), version: String(m.version ?? ""), ...(typeof m.description === "string" && m.description ? { description: m.description } : {}), dir, sha256: "", files };
  const before = problems.length;
  const s = section("secureCoding"), o = section("operations"), d = section("dependencies"), p = section("privacy");
  if (problems.length === before) {
    if (s !== undefined) pack.secureCoding = validateSecure(s, problems, earlier);
    if (o !== undefined) pack.operations = validateOps(o, problems, earlier);
    if (d !== undefined) pack.dependencies = validateDeps(d, problems);
    if (p !== undefined) pack.privacy = validatePrivacy(p, problems);
    if (!problems.length && !RULE_PACK_SECTIONS.some((k) => pack[k])) problems.push(L(`규칙 절이 하나도 없습니다(${RULE_PACK_SECTIONS.join("·")})`, `no rule section (${RULE_PACK_SECTIONS.join(", ")})`));
  }
  if (problems.length) throw new RulePackError(dirInput, problems);
  pack.sha256 = hash.digest("hex");
  return pack;
}

/** 경로 순서대로 읽는다(뒤가 이김). 이름이 같은 팩이 둘이면 거부 */
export function loadRulePacks(param?: string[] | null): RulePack[] {
  const packs: RulePack[] = [];
  for (const p of resolveRulePackPaths(param)) packs.push(loadRulePack(p, packs));
  const names = packs.map((p) => p.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new RulePackError(dup, [L(`이름이 같은 팩이 두 번 지정되었습니다(${dup})`, `the same pack name is given twice (${dup})`)]);
  return packs;
}

/** 규칙 id → 그 규칙을 정한 팩 이름(동봉 규칙이면 없음) */
export type RuleOrigins = Map<string, string>;

export function applySecurePacks(base: SecureRules, packs: RulePack[]): { rules: SecureRules; origins: RuleOrigins; disabled: string[] } {
  const origins: RuleOrigins = new Map();
  if (!packs.some((p) => p.secureCoding)) return { rules: base, origins, disabled: [] };
  let list = base.rules.map((r) => ({ ...r }));
  const disabled: string[] = [];
  for (const p of packs) {
    const s = p.secureCoding;
    if (!s) continue;
    for (const r of s.rules) { const i = list.findIndex((x) => x.id === r.id); if (i >= 0) list[i] = { ...r }; else list.push({ ...r }); origins.set(r.id, p.name); }
    for (const [id, sev] of Object.entries(s.severity)) { const r = list.find((x) => x.id === id); if (r) { r.severity = sev; origins.set(id, p.name); } }
    for (const id of s.disable) { if (list.some((x) => x.id === id)) disabled.push(id); list = list.filter((x) => x.id !== id); origins.set(id, p.name); }
  }
  return { rules: { ...base, rules: list }, origins, disabled: [...new Set(disabled)] };
}

export function applyOpsPacks(base: OpsRules, packs: RulePack[]): { rules: OpsRules; origins: RuleOrigins; disabled: string[] } {
  const origins: RuleOrigins = new Map();
  if (!packs.some((p) => p.operations)) return { rules: base, origins, disabled: [] };
  let list = base.rules.map((r) => ({ ...r, check: { ...r.check } }));
  const disabled: string[] = [];
  for (const p of packs) {
    const o = p.operations;
    if (!o) continue;
    for (const r of o.rules) { const i = list.findIndex((x) => x.id === r.id); const c = { ...r, check: { ...r.check } }; if (i >= 0) list[i] = c; else list.push(c); origins.set(r.id, p.name); }
    for (const [id, t] of Object.entries(o.thresholds)) { const r = list.find((x) => x.id === id); if (r) { Object.assign(r.check, t); origins.set(id, p.name); } }
    for (const [id, sev] of Object.entries(o.severity)) { const r = list.find((x) => x.id === id); if (r) { r.severity = sev; origins.set(id, p.name); } }
    for (const id of o.disable) { if (list.some((x) => x.id === id)) disabled.push(id); list = list.filter((x) => x.id !== id); origins.set(id, p.name); }
  }
  return { rules: { ...base, rules: list }, origins, disabled: [...new Set(disabled)] };
}

export function applyPrivacyPacks(base: PrivacyRules, packs: RulePack[]): { rules: PrivacyRules; origins: RuleOrigins } {
  const origins: RuleOrigins = new Map();
  if (!packs.some((p) => p.privacy)) return { rules: base, origins };
  const out: PrivacyRules = { ...base, items: base.items.map((i) => ({ ...i })) };
  for (const p of packs) {
    const v = p.privacy;
    if (!v) continue;
    // 팩 항목이 먼저 대조되도록 앞에 둔다 — 기관 사전이 동봉 사전보다 구체적이다
    for (const it of [...v.items].reverse()) { out.items = out.items.filter((x) => x.id !== it.id); out.items.unshift({ ...it }); origins.set(it.id, p.name); }
    const add = (cur: string, more: string[]) => (more.length ? [cur, ...more.map((s) => `(?:${s})`)].join("|") : cur);
    out.cryptoCalls = add(out.cryptoCalls, v.cryptoCalls);
    out.sqlCryptoFunctions = add(out.sqlCryptoFunctions, v.sqlCryptoFunctions);
    out.maskCalls = add(out.maskCalls, v.maskCalls);
  }
  return { rules: out, origins };
}

/** 의존성 좌표에 걸리는 팩 기준(뒤 팩이 이김). 금지가 최소 버전보다 먼저 */
export function packDependencyRule(packs: RulePack[], groupId: string, artifactId: string): { kind: "banned"; pack: string; rule: PackBannedDependency } | { kind: "minimum"; pack: string; rule: PackMinimumDependency } | null {
  for (const p of [...packs].reverse()) {
    const b = p.dependencies?.banned.find((x) => x.groupId === groupId && (!x.artifactId || x.artifactId === artifactId));
    if (b) return { kind: "banned", pack: p.name, rule: b };
  }
  for (const p of [...packs].reverse()) {
    const m = p.dependencies?.minimum.find((x) => x.groupId === groupId && x.artifactId === artifactId);
    if (m) return { kind: "minimum", pack: p.name, rule: m };
  }
  return null;
}

export interface RuleListEntry { tool: RulePackSection; id: string; severity: string | null; title: string; source: string; status: "active" | "disabled" }
export interface RuleListResult {
  rulePacks: RulePackInfo[];
  summary: { total: number; bundled: number; fromPacks: number; disabled: number; byTool: Record<string, number> };
  rules: RuleListEntry[];
  notes: string[];
}
/** 적용 중인 규칙과 출처(동봉/팩 이름). 팩이 잘못되면 RulePackError */
export function listRules(opts: { rulePacks?: string[]; tools?: RulePackSection[] } = {}): RuleListResult {
  const packs = loadRulePacks(opts.rulePacks);
  const want = opts.tools?.length ? opts.tools : [...RULE_PACK_SECTIONS];
  const rules: RuleListEntry[] = [];
  const BUNDLED = "bundled";
  if (want.includes("secureCoding")) {
    const a = applySecurePacks(loadSecureRules(), packs);
    for (const r of a.rules.rules) rules.push({ tool: "secureCoding", id: r.id, severity: r.severity, title: r.guideItem, source: a.origins.get(r.id) ?? BUNDLED, status: "active" });
    for (const id of a.disabled) rules.push({ tool: "secureCoding", id, severity: null, title: loadSecureRules().rules.find((r) => r.id === id)?.guideItem ?? id, source: a.origins.get(id) ?? BUNDLED, status: "disabled" });
  }
  if (want.includes("operations")) {
    const a = applyOpsPacks(loadOperationsRules(), packs);
    for (const r of a.rules.rules) rules.push({ tool: "operations", id: r.id, severity: r.severity, title: r.title, source: a.origins.get(r.id) ?? BUNDLED, status: "active" });
    for (const id of a.disabled) rules.push({ tool: "operations", id, severity: null, title: loadOperationsRules().rules.find((r) => r.id === id)?.title ?? id, source: a.origins.get(id) ?? BUNDLED, status: "disabled" });
  }
  if (want.includes("privacy")) {
    const a = applyPrivacyPacks(loadPrivacyRules(), packs);
    for (const it of a.rules.items) rules.push({ tool: "privacy", id: it.id, severity: it.grade, title: it.label, source: a.origins.get(it.id) ?? BUNDLED, status: "active" });
  }
  if (want.includes("dependencies")) {
    for (const p of packs) {
      for (const b of p.dependencies?.banned ?? []) rules.push({ tool: "dependencies", id: `banned:${b.groupId}:${b.artifactId ?? "*"}${b.versionBelow ? `:<${b.versionBelow}` : ""}`, severity: null, title: b.reason, source: p.name, status: "active" });
      for (const m of p.dependencies?.minimum ?? []) rules.push({ tool: "dependencies", id: `minimum:${m.groupId}:${m.artifactId}:${m.version}`, severity: null, title: m.reason ?? L(`최소 버전 ${m.version}`, `minimum version ${m.version}`), source: p.name, status: "active" });
    }
  }
  const active = rules.filter((r) => r.status === "active");
  const byTool: Record<string, number> = {};
  for (const r of active) byTool[r.tool] = (byTool[r.tool] ?? 0) + 1;
  const notes: string[] = [];
  if (!packs.length) notes.push(L(`규칙 팩이 없습니다 — 동봉 규칙만 적용됩니다. 환경 변수 ${RULE_PACKS_ENV} 또는 rulePacks 파라미터로 팩 디렉터리를 지정하세요.`, `No rule pack — only the bundled rules apply. Point ${RULE_PACKS_ENV} or the rulePacks parameter at a pack directory.`));
  if (want.includes("dependencies")) notes.push(L("의존성의 동봉 기준(공식 parent·Spring Boot BOM 1,500여 좌표)은 목록에 싣지 않습니다 — 팩이 더한 금지·최소 버전만 보입니다.", "The bundled dependency baseline (official parent and Spring Boot BOM, about 1,500 coordinates) is not listed — only the banned and minimum entries added by packs are shown."));
  return { rulePacks: rulePackInfo(packs), summary: { total: active.length, bundled: active.filter((r) => r.source === BUNDLED).length, fromPacks: active.filter((r) => r.source !== BUNDLED).length, disabled: rules.length - active.length, byTool }, rules, notes };
}

export function renderRuleListMarkdown(r: RuleListResult, topN = 200): string {
  const out: string[] = [L("# 적용 중인 규칙", "# Rules in effect"), ""];
  if (r.rulePacks.length) {
    out.push(L("| 규칙 팩 | 버전 | 절 | sha256 |", "| Rule pack | Version | Sections | sha256 |"), "|---|---|---|---|");
    for (const p of r.rulePacks) out.push(`| ${p.name} | ${p.version} | ${p.sections.join(", ")} | \`${p.sha256.slice(0, 16)}…\` |`);
    out.push("");
  }
  out.push(L(`- 적용 ${r.summary.total}개(동봉 ${r.summary.bundled} · 팩 ${r.summary.fromPacks}) · 끈 규칙 ${r.summary.disabled}개 — ${Object.entries(r.summary.byTool).map(([k, v]) => `${k} ${v}`).join(" · ")}`, `- ${r.summary.total} in effect (bundled ${r.summary.bundled}, packs ${r.summary.fromPacks}) · ${r.summary.disabled} disabled — ${Object.entries(r.summary.byTool).map(([k, v]) => `${k} ${v}`).join(" · ")}`));
  for (const n of r.notes) out.push(`- ${n}`);
  // 팩이 정한 것과 끈 것을 먼저
  const sorted = [...r.rules].sort((a, b) => Number(a.source === "bundled") - Number(b.source === "bundled"));
  out.push("", L("| 도구 | 규칙 | 등급 | 출처 | 상태 | 제목 |", "| Tool | Rule | Severity | Source | Status | Title |"), "|---|---|---|---|---|---|");
  for (const x of sorted.slice(0, topN)) out.push(`| ${x.tool} | \`${x.id}\` | ${x.severity ?? "-"} | ${x.source === "bundled" ? L("동봉", "bundled") : x.source} | ${x.status === "active" ? L("적용", "active") : L("끔", "disabled")} | ${x.title.replace(/\|/g, "\\|").slice(0, 80)} |`);
  if (sorted.length > topN) out.push("", L(`… ${sorted.length - topN}개 더(format=json 또는 topN)`, `… ${sorted.length - topN} more (format=json or topN)`));
  return out.join("\n");
}
