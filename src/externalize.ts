// 설정·비밀값 외부화 (externalize_egovframe_config, v1.13.0)
//   설정 파일(globals.properties·application.properties/yml·context-*.xml)의 비밀번호·비밀 값을 저장소 밖으로 옮긴다.
//   - env: 값을 지우고 ${ENV_NAME} 자리표시자 — Spring 자리표시자(PropertyPlaceholderConfigurer·Boot Environment)로 읽는 키만.
//     EgovProperties.getProperty("…") 처럼 파일을 직접 읽는 키는 자리표시자가 풀리지 않으므로 수동 항목으로.
//   - crypto-path(5.x): 표준프레임워크 암호화 값은 그대로 두고 복호화 키가 든 egov-crypto-config.properties 의 키 줄을 지운 뒤
//     Globals.CryptoConfigPath=${EGOV_CRYPTO_CONFIG:} 로 외부 파일(환경 변수)에서 읽게 한다 — runtime 5.x 의 EgovCryptoConfiguration 이
//     @Value("${Globals.CryptoConfigPath:}") 로 경로(classpath:·file:·절대 경로)를 받는다.
//   판정은 보안약점 점검의 hardcoded-config-password 규칙(화이트리스트 포함)을 그대로 쓴다 — 두 도구의 결과가 같아야 하므로.
//   원래 값은 migration-backup/ 의 원본에만 남고 결과·로그에는 가린 값(앞 2자 + ***)만 적는다.
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { checkSecureCoding } from "./secure-coding.js";
import { withFileTransaction } from "./file-transaction.js";
import { analyzeDeploy } from "./deploy.js";
import { verifyStartup, type StartupResult, type StartupOptions } from "./startup.js";
import type { Runner } from "./build-runner.js";
import { L } from "./lang.js";

export type SecretKind = "db-password" | "crypto-key" | "file-crypto-key" | "secret";
export type SecretFormat = "properties" | "yaml" | "xml";
/** env: 자리표시자로 교체 · crypto-path: 키 파일을 외부 경로로 · manual: 사람이 (사유) · encrypted: 암호화 값(키 외부화로 보호) */
export type SecretAction = "env" | "crypto-path" | "manual" | "encrypted";
export interface SecretFinding {
  file: string;
  line: number;
  key: string;
  kind: SecretKind;
  format: SecretFormat;
  /** 가린 값 */
  masked: string;
  action: SecretAction;
  envName?: string;
  reason?: string;
  /** 설정 파일을 직접 읽는 Java 파일(EgovProperties.getProperty 등) */
  directReaders: string[];
}
export interface ExternalizeChange { line: number; before: string; after: string }
export interface ExternalizeOptions {
  projectDir: string;
  dryRun?: boolean;
  /** auto(기본): 읽는 방식대로 · env: 자리표시자만 · crypto: 키 파일 외부화만 */
  mode?: "auto" | "env" | "crypto";
  /** 프로젝트 상대 경로 접두어로 좁히기 */
  paths?: string[];
  /** 적용 뒤 원래 값을 환경 변수로 주고 기동 검증(v1.11) — 설정 해석에 실패하면 되돌림 */
  verify?: boolean;
  timeoutMs?: number;
  tomcatHome?: string;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  httpProbe?: StartupOptions["httpProbe"];
  download?: StartupOptions["download"];
  cacheDir?: string;
  faultInjection?: "after-files";
}
export interface ExternalizeResult {
  projectDir: string;
  dryRun: boolean;
  mode: "auto" | "env" | "crypto";
  runtime: "boot" | "tomcat" | "unknown";
  findings: SecretFinding[];
  summary: { found: number; env: number; cryptoPath: number; encrypted: number; manual: number; files: number };
  files: { path: string; changes: ExternalizeChange[] }[];
  /** 환경 변수 → 키 목록 */
  env: { name: string; keys: string[]; example: string }[];
  /** 새로 만든 파일(예: deploy/secrets/egov-crypto-config.properties.example) */
  generated: string[];
  /** 갱신한 배포 산출물 */
  deployUpdated: string[];
  manual: { file: string; line: number; key: string; reason: string }[];
  secureCoding: { rule: string; before: number; after: number | null };
  verify?: { ran: boolean; success: boolean | null; cause?: StartupResult["cause"]; durationMs: number; env: string[] };
  rolledBack?: boolean;
  backupDir?: string;
  planPath?: string;
  notes: string[];
}

export const CONFIG_PASSWORD_RULE = "hardcoded-config-password";
export const CRYPTO_CONFIG_FILE = "egovframework/egovProps/conf/egov-crypto-config.properties";
export const CRYPTO_PATH_KEY = "Globals.CryptoConfigPath";
export const CRYPTO_ENV = "EGOV_CRYPTO_CONFIG";
const SKIP_DIRS = new Set(["target", "build", "node_modules", ".git", "migration-backup", "deploy", "sbom", "bin", "out", ".idea", ".settings"]);
const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");
const read = (p: string) => fs.readFileSync(p, "utf8");

export const maskSecret = (v: string): string => (v.length <= 2 ? "***" : `${v.slice(0, 2)}${"*".repeat(Math.min(8, Math.max(3, v.length - 2)))}`);
/** 키 → 환경 변수 이름: Globals.mysql.Password → EGOV_MYSQL_PASSWORD, spring.datasource.password → SPRING_DATASOURCE_PASSWORD */
export function envNameForKey(key: string): string {
  const isGlobals = /^Globals\./i.test(key);
  const base = key.replace(/^Globals\./i, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return isGlobals || !/^[A-Z]/.test(base) ? `EGOV_${base}` : base;
}
/** 표준프레임워크 암호화 값 모양(Base64 를 URL 인코딩: xz4fmrSdr1vGGl6UtwPLwA%3D%3D) */
export const looksEgovEncrypted = (v: string): boolean => { const b = v.replace(/%3D/gi, "="); return /^[A-Za-z0-9+/]{12,}={0,2}$/.test(b) && b.length % 4 === 0 && /[A-Z]/.test(b) && /[a-z]/.test(b) && (/=$/.test(b) || /[+/]/.test(b)); };
export const algorithmKeyHash = (key: string): string => createHash("sha256").update(key, "utf8").digest("base64");

function walk(root: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".egovframe-write-txn")) walk(p, out, depth + 1); continue; }
    if (e.isFile()) out.push(p);
  }
  return out;
}
/** 앱이 읽는 설정(자리표시자가 풀리는 곳) — 배포 정의(compose·k8s·Dockerfile 옆 yml)는 아니다 */
const isAppConfig = (r: string) => /^(src\/main\/resources\/|src\/main\/webapp\/WEB-INF\/|config\/application[\w.-]*\.(properties|ya?ml)$|application[\w.-]*\.(properties|ya?ml)$)/.test(r);
const isConfigPath = (r: string) => /\.(properties|ya?ml|xml)$/.test(r) && !/(^|\/)src\/test\//.test(r) && !/(^|\/)(message|messages|i18n)[/_]|message[_\w]*\.properties$|\/sqlmap\/|\/mappers?\/|pom\.xml$|log4j|logback|\.xsd$/.test(r);
/** XML 주석을 같은 길이의 공백으로(줄 번호 보존) */
const blankXmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));

const PROP_LINE = /^(\s*)([^\s=:#!][^=:\s]*)(\s*[=:]\s*)(.*?)(\s*)$/;
const YAML_LINE = /^(\s*)([\w.\-]+)(\s*:\s+)(["']?)(.*?)\4(\s*(?:#.*)?)$/;
const XML_PROP = /<property\s+name\s*=\s*"([^"]*(?:password|passwd|pwd|secret)[^"]*)"\s+value\s*=\s*"([^"$#][^"]*)"/i;

/** YAML 줄의 점 경로(spring.datasource.password) — 들여쓰기로 부모 키를 거슬러 올라간다 */
function yamlKeyPath(lines: string[], idx: number): string {
  const indentOf = (s: string) => s.match(/^\s*/)![0].length;
  const keyOf = (s: string) => s.match(/^\s*(?:-\s+)?([\w.\-]+)\s*:/)?.[1] ?? null;
  const parts: string[] = [];
  let indent = indentOf(lines[idx]);
  const self = keyOf(lines[idx]); if (self) parts.push(self);
  for (let i = idx - 1; i >= 0 && indent > 0; i--) {
    const l = lines[i]; if (!l.trim() || l.trim().startsWith("#")) continue;
    const ind = indentOf(l);
    if (ind < indent) { const kk = keyOf(l); if (kk) parts.unshift(kk); indent = ind; }
  }
  return parts.join(".");
}

/** Java 소스에서 설정 파일을 직접 읽는 키(EgovProperties.getProperty / getPathProperty / resolvePassword) */
function directReadersOf(projectDir: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const javaRoot = path.join(projectDir, "src", "main", "java");
  if (!fs.existsSync(javaRoot)) return out;
  for (const f of walk(javaRoot)) {
    if (!f.endsWith(".java")) continue;
    const text = read(f);
    if (!/EgovProperties|resolvePassword|getProperty\s*\(/.test(text)) continue;
    const re = /\b(?:EgovProperties\s*\.\s*(?:getProperty|getPathProperty|getPropertyValue)|resolvePassword)\s*\(\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) { const k = m[1]; const arr = out.get(k) ?? []; const r = rel(projectDir, f); if (!arr.includes(r)) arr.push(r); out.set(k, arr); }
  }
  return out;
}
/** `${키}` 로 참조되는 키(XML·Java @Value) */
function placeholderRefs(projectDir: string, files: string[]): Set<string> {
  const out = new Set<string>();
  const re = /\$\{([A-Za-z][\w.\-]*)(?::[^}]*)?\}/g;
  for (const f of files) {
    let text: string;
    try { text = read(f); } catch { continue; }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.add(m[1]);
  }
  return out;
}

export interface SecretScan { findings: SecretFinding[]; configFiles: string[]; cryptoConfig: string | null; globals: string | null; hasCryptoRuntime: boolean; secureBefore: number; directReaders: Map<string, string[]>; values: Map<string, string> }
/** 비밀 값 찾기(읽기 전용). 값은 돌려주되 결과 구조에는 가린 값만 싣는다. */
export async function scanSecrets(projectDir: string, opts: { paths?: string[]; mode?: ExternalizeOptions["mode"] } = {}): Promise<SecretScan> {
  const all = walk(projectDir).map((p) => ({ abs: p, rel: rel(projectDir, p) })).filter((f) => isConfigPath(f.rel) && (!opts.paths?.length || opts.paths.some((pf) => f.rel.startsWith(pf.replace(/\\/g, "/").replace(/^\.\//, "")))));
  const configFiles = all.map((f) => f.rel).sort();
  const cryptoConfig = all.find((f) => f.rel.endsWith(CRYPTO_CONFIG_FILE))?.rel ?? null;
  const globals = all.find((f) => /(^|\/)egovProps\/globals\.properties$/.test(f.rel))?.rel ?? null;
  /** 4.x: egov-crypto 네임스페이스(crypto="true")가 globals.properties 를 직접 읽어 복호화 */
  const legacyCrypto = all.filter((f) => /context-crypto\.xml$/.test(f.rel)).some((f) => /crypto\s*=\s*"true"/.test(blankXmlComments(read(f.abs))));
  const direct = directReadersOf(projectDir);
  const refs = placeholderRefs(projectDir, [...all.map((f) => f.abs), ...walk(path.join(projectDir, "src", "main", "java")).filter((f) => f.endsWith(".java"))]);
  const values = new Map<string, string>();
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  const push = (f: SecretFinding, value: string) => { const id = `${f.file}:${f.line}`; if (seen.has(id)) return; seen.add(id); findings.push(f); values.set(id, value); };

  // (1) properties·yml — 보안약점 점검과 같은 규칙·화이트리스트
  const sc = await checkSecureCoding({ projectDir, rules: [CONFIG_PASSWORD_RULE], dataFlow: false, includeTests: false, maxFindings: 5000, ...(opts.paths?.length ? { paths: opts.paths } : {}) });
  for (const x of sc.findings) {
    if (!configFiles.includes(x.file)) continue;
    const text = read(path.join(projectDir, x.file));
    const allLines = text.split(/\r?\n/);
    const raw = allLines[x.line - 1] ?? "";
    const yaml = /\.ya?ml$/.test(x.file);
    const m = yaml ? raw.match(YAML_LINE) : raw.match(PROP_LINE);
    if (!m) continue;
    const key = yaml ? yamlKeyPath(allLines, x.line - 1) : m[2], value = yaml ? m[5] : m[4];
    if (!value) continue;
    const readers = direct.get(key) ?? [];
    const kind: SecretKind = /password|passwd|pwd/i.test(key) ? "db-password" : "secret";
    const encrypted = looksEgovEncrypted(value) && (!!cryptoConfig || legacyCrypto);
    let action: SecretAction; let reason: string | undefined;
    if (encrypted) { action = "encrypted"; reason = cryptoConfig ? L("표준프레임워크 암호화 값 — 복호화 키를 외부화해 보호(값은 그대로)", "eGovFrame-encrypted value — protected by externalizing the decryption key (value unchanged)") : L("표준프레임워크 암호화 값(4.x egov-crypto 가 파일을 직접 읽어 복호화) — 값은 그대로, 키는 context-crypto.xml 수동 항목", "eGovFrame-encrypted value (4.x egov-crypto reads the file directly to decrypt) — value unchanged; the key is a manual item in context-crypto.xml"); }
    else if (readers.length && !refs.has(key)) { action = "manual"; reason = L(`설정 파일을 직접 읽는 코드(${readers.slice(0, 2).join(", ")})가 있어 자리표시자가 풀리지 않음 — 값을 암호화(EgovEnvCryptoService)하거나 코드를 Environment/@Value 로 바꾼 뒤 외부화`, `Read directly from the file by code (${readers.slice(0, 2).join(", ")}) so a placeholder would not resolve — encrypt the value (EgovEnvCryptoService) or switch the code to Environment/@Value, then externalize`); }
    else if (!isAppConfig(x.file)) { action = "manual"; reason = L("앱 설정이 아닌 파일(배포 정의 등) — compose 는 .env 치환, Kubernetes 는 Secret 으로 옮기세요(generate_egovframe_deploy 산출물 참고)", "Not application configuration (deployment definition etc.) — use .env substitution for compose and a Secret for Kubernetes (see generate_egovframe_deploy output)"); }
    else if (opts.mode === "crypto") { action = "manual"; reason = L("mode=crypto — 자리표시자 교체는 하지 않음", "mode=crypto — placeholder replacement skipped"); }
    else { action = "env"; if (readers.length) reason = L(`자리표시자로도 읽고(${[...refs].includes(key) ? "참조 있음" : ""}) 직접도 읽음(${readers[0]}) — 직접 읽는 곳은 값을 못 받음`, `Read both through a placeholder and directly (${readers[0]}) — the direct reader will not get the value`); }
    push({ file: x.file, line: x.line, key, kind, format: yaml ? "yaml" : "properties", masked: maskSecret(value), action, ...(action === "env" ? { envName: envNameForKey(key) } : {}), ...(reason ? { reason } : {}), directReaders: readers }, value);
  }
  // (2) XML 리터럴 — <property name="password" value="…"/>(주석 제외, 자리표시자·SpEL 제외)
  for (const f of all.filter((f) => f.rel.endsWith(".xml"))) {
    const lines = blankXmlComments(read(f.abs)).split(/\r?\n/);
    lines.forEach((ln, i) => {
      const m = ln.match(XML_PROP);
      if (!m) return;
      const value = m[2];
      if (!value.trim() || /^(\*+|x{3,}|pw|password|changeme|secret|null|none)$/i.test(value)) return;
      const bean = (() => { for (let j = i; j >= 0 && j > i - 40; j--) { const b = lines[j].match(/<bean\b[^>]*\bid\s*=\s*"([^"]+)"/); if (b) return b[1]; } return "bean"; })();
      const key = `${bean}.${m[1]}`;
      if (!isAppConfig(f.rel)) return;
      const action: SecretAction = opts.mode === "crypto" ? "manual" : "env";
      push({ file: f.rel, line: i + 1, key, kind: "db-password", format: "xml", masked: maskSecret(value), action, ...(action === "env" ? { envName: envNameForKey(`Globals.${key}`) } : { reason: L("mode=crypto — 자리표시자 교체는 하지 않음", "mode=crypto — placeholder replacement skipped") }), directReaders: [] }, value);
    });
  }
  // (3) 암호화 키 — egov-crypto-config.properties(5.x) / context-crypto.xml(4.x) / Globals.File.algorithmKey
  if (cryptoConfig) {
    const lines = read(path.join(projectDir, cryptoConfig)).split(/\r?\n/);
    lines.forEach((ln, i) => {
      const m = ln.match(PROP_LINE);
      if (!m || !/^algorithmKey(Hash)?$/.test(m[2]) || !m[4]) return;
      const action: SecretAction = opts.mode === "env" ? "manual" : "crypto-path";
      push({ file: cryptoConfig, line: i + 1, key: m[2], kind: "crypto-key", format: "properties", masked: m[2] === "algorithmKeyHash" ? maskSecret(m[4]) : maskSecret(m[4]), action, ...(action === "crypto-path" ? { envName: CRYPTO_ENV } : { reason: L("mode=env — 키 파일 외부화는 하지 않음", "mode=env — key file externalization skipped") }), directReaders: [] }, m[4]);
    });
  }
  for (const f of all.filter((f) => /context-crypto\.xml$/.test(f.rel))) {
    const lines = blankXmlComments(read(f.abs)).split(/\r?\n/);
    lines.forEach((ln, i) => { const m = ln.match(/\balgorithmKey\s*=\s*"([^"$]+)"/); if (m) push({ file: f.rel, line: i + 1, key: "egov-crypto:config/algorithmKey", kind: "crypto-key", format: "xml", masked: maskSecret(m[1]), action: "manual", reason: L("4.x egov-crypto 네임스페이스 — 키를 외부 파일로 옮기는 설정이 없음. 5.x 전환 뒤(egov-crypto-config.properties) 외부화하거나 PropertyPlaceholderConfigurer 로 ${…} 를 쓰세요", "4.x egov-crypto namespace — no setting to read the key from an external file. Externalize after moving to 5.x (egov-crypto-config.properties) or use ${…} through a PropertyPlaceholderConfigurer"), directReaders: [] }, m[1]); });
  }
  if (globals) {
    const lines = read(path.join(projectDir, globals)).split(/\r?\n/);
    lines.forEach((ln, i) => { const m = ln.match(PROP_LINE); if (m && m[2] === "Globals.File.algorithmKey" && m[4] && !m[4].startsWith("${")) push({ file: globals, line: i + 1, key: m[2], kind: "file-crypto-key", format: "properties", masked: maskSecret(m[4]), action: "manual", reason: L(`첨부파일 암호화 키 — EgovProperties.getProperty 로 파일을 직접 읽음(${(direct.get(m[2]) ?? []).slice(0, 2).join(", ") || "EgovFileMngController 등"}) — 코드를 Environment 로 바꾸거나 운영 배포 때 파일을 덮어쓰기`, `Attachment encryption key — read directly from the file by EgovProperties.getProperty (${(direct.get(m[2]) ?? []).slice(0, 2).join(", ") || "EgovFileMngController etc."}) — switch the code to Environment or override the file at deployment`), directReaders: direct.get(m[2]) ?? [] }, m[4]); });
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { findings, configFiles, cryptoConfig, globals, hasCryptoRuntime: !!cryptoConfig, secureBefore: sc.findings.filter((x) => configFiles.includes(x.file)).length, directReaders: direct, values };
}

/** 줄의 값만 자리표시자로(들여쓰기·구분자·CRLF 보존) */
function replaceValue(raw: string, format: SecretFormat, placeholder: string): string | null {
  const eol = raw.endsWith("\r") ? "\r" : "";
  const line = eol ? raw.slice(0, -1) : raw;
  if (format === "properties") { const m = line.match(PROP_LINE); return m ? `${m[1]}${m[2]}${m[3]}${placeholder}${eol}` : null; }
  if (format === "yaml") { const m = line.match(YAML_LINE); return m ? `${m[1]}${m[2]}${m[3]}${placeholder}${m[6]}${eol}` : null; }
  const m = line.match(XML_PROP); return m ? `${line.replace(m[0], m[0].replace(/value\s*=\s*"[^"]*"/, `value="${placeholder}"`))}${eol}` : null;
}

/** 배포 산출물(generate_egovframe_deploy 가 만든 것)에 비밀 환경 변수 자리 추가 */
function updateDeployFiles(projectDir: string, envs: { name: string; example: string }[], cryptoFile: string | null): Map<string, { before: string; after: string }> {
  const out = new Map<string, { before: string; after: string }>();
  if (!envs.length) return out;
  const envExample = path.join(projectDir, "deploy", ".env.example");
  if (fs.existsSync(envExample)) {
    const before = read(envExample);
    const missing = envs.filter((e) => !new RegExp(`^${e.name}=`, "m").test(before));
    if (missing.length) out.set("deploy/.env.example", { before, after: `${before.replace(/\n*$/, "\n")}${missing.map((e) => `${e.name}=${e.example}`).join("\n")}\n` });
  }
  const compose = path.join(projectDir, "deploy", "docker-compose.yml");
  if (fs.existsSync(compose)) {
    const before = read(compose);
    const missing = envs.filter((e) => !new RegExp(`^\\s+${e.name}:`, "m").test(before));
    if (missing.length) {
      const lines = before.split("\n");
      const app = lines.findIndex((l) => /^  app:\s*$/.test(l));
      const envIdx = app >= 0 ? lines.findIndex((l, i) => i > app && /^    environment:\s*$/.test(l)) : -1;
      const entries = missing.map((e) => `      ${e.name}: "\${${e.name}:-${e.example.replace(/"/g, "")}}"`);
      if (envIdx >= 0) lines.splice(envIdx + 1, 0, ...entries);
      else if (app >= 0) { const img = lines.findIndex((l, i) => i > app && /^    image:/.test(l)); lines.splice((img >= 0 ? img : app) + 1, 0, "    environment:", ...entries); }
      if (cryptoFile && !/egov-crypto-config\.properties/.test(before)) {
        const i = lines.findIndex((l, k) => k > app && /^    volumes:\s*$/.test(l));
        const mount = `      - ./secrets/egov-crypto-config.properties:/run/egov/egov-crypto-config.properties:ro`;
        if (i >= 0) lines.splice(i + 1, 0, mount);
        else { const r = lines.findIndex((l, k) => k > app && /^    restart:/.test(l)); lines.splice(r >= 0 ? r : lines.length, 0, "    volumes:", mount); }
      }
      out.set("deploy/docker-compose.yml", { before, after: lines.join("\n") });
    }
  }
  const k8sDir = path.join(projectDir, "deploy", "k8s");
  if (fs.existsSync(k8sDir)) {
    for (const f of fs.readdirSync(k8sDir).filter((f) => /\.ya?ml$/.test(f))) {
      const before = read(path.join(k8sDir, f));
      if (!/^kind: Secret$/m.test(before) || !/^stringData:\s*$/m.test(before)) continue;
      const missing = envs.filter((e) => !new RegExp(`^  ${e.name}:`, "m").test(before));
      if (!missing.length) continue;
      out.set(`deploy/k8s/${f}`, { before, after: before.replace(/^stringData:\s*$/m, (m) => `${m}\n${missing.map((e) => `  ${e.name}: '${e.example}'`).join("\n")}`) });
    }
  }
  return out;
}

export async function externalizeConfig(opts: ExternalizeOptions): Promise<ExternalizeResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(L(`프로젝트 디렉터리가 없습니다: ${projectDir}`, `Project directory not found: ${projectDir}`));
  const dryRun = opts.dryRun !== false;
  const mode = opts.mode ?? "auto";
  const notes: string[] = [];
  const a = analyzeDeploy(projectDir);
  const runtime: ExternalizeResult["runtime"] = a.profile?.runtime ?? "unknown";
  const scan = await scanSecrets(projectDir, { paths: opts.paths, mode });

  // 계획 — 파일별 줄 교체
  const texts = new Map<string, { before: string; lines: string[]; changes: ExternalizeChange[] }>();
  const load = (r: string) => { let t = texts.get(r); if (!t) { const before = read(path.join(projectDir, r)); t = { before, lines: before.split("\n"), changes: [] }; texts.set(r, t); } return t; };
  const envMap = new Map<string, { keys: string[]; example: string; values: Set<string> }>();
  for (const f of scan.findings) {
    if (f.action !== "env") continue;
    const value = scan.values.get(`${f.file}:${f.line}`) ?? "";
    let name = f.envName!;
    for (let n = 2; envMap.has(name) && !envMap.get(name)!.values.has(value); n++) name = `${f.envName}_${n}`;
    f.envName = name;
    const e = envMap.get(name) ?? { keys: [], example: "CHANGE_ME", values: new Set<string>() };
    if (!e.keys.includes(f.key)) e.keys.push(f.key); e.values.add(value); envMap.set(name, e);
    const t = load(f.file);
    const after = replaceValue(t.lines[f.line - 1], f.format, `\${${name}}`);
    if (after === null) { f.action = "manual"; f.reason = L("줄 형식을 해석하지 못함", "Could not parse the line"); continue; }
    t.changes.push({ line: f.line, before: t.lines[f.line - 1].replace(value, f.masked).replace(/\r$/, ""), after: after.replace(/\r$/, "") });
    t.lines[f.line - 1] = after;
  }
  // 암호화 키 파일 → 외부 경로
  const cryptoFindings = scan.findings.filter((f) => f.action === "crypto-path");
  let cryptoExample: { path: string; content: string } | null = null;
  if (cryptoFindings.length && scan.cryptoConfig) {
    const t = load(scan.cryptoConfig);
    for (const f of cryptoFindings) {
      const value = scan.values.get(`${f.file}:${f.line}`) ?? "";
      const raw = t.lines[f.line - 1];
      const eol = raw.endsWith("\r") ? "\r" : "";
      const after = `# ${f.key} = (${L("외부 파일로 옮김", "moved to an external file")}: ${CRYPTO_PATH_KEY} / ${CRYPTO_ENV})${eol}`;
      t.changes.push({ line: f.line, before: raw.replace(value, f.masked).replace(/\r$/, ""), after: after.replace(/\r$/, "") });
      t.lines[f.line - 1] = after;
    }
    const original = t.before.split(/\r?\n/).map((ln) => { const m = ln.match(PROP_LINE); return m && /^algorithmKey(Hash)?$/.test(m[2]) ? `${m[1]}${m[2]}${m[3]}CHANGE_ME` : ln; });
    cryptoExample = { path: "deploy/secrets/egov-crypto-config.properties.example", content: [L(`# egov-crypto-config.properties 외부 본 — 저장소 밖(운영 서버·k8s Secret)에 두고 ${CRYPTO_ENV}=file:/경로 로 가리키세요.`, `# External egov-crypto-config.properties — keep it outside the repository (server, k8s Secret) and point ${CRYPTO_ENV}=file:/path at it.`), L("# algorithmKey 를 새 키로 바꾸면 algorithmKeyHash = base64(sha256(키)) 로 맞추고, 암호화된 값(Globals.*.Password)은 새 키로 다시 암호화해야 합니다.", "# When algorithmKey changes, set algorithmKeyHash = base64(sha256(key)) and re-encrypt the encrypted values (Globals.*.Password) with the new key."), ...original].join("\n") + "\n" };
    envMap.set(CRYPTO_ENV, { keys: [CRYPTO_PATH_KEY], example: "file:/run/egov/egov-crypto-config.properties", values: new Set() });
    if (scan.globals) {
      const g = load(scan.globals);
      if (!g.lines.some((ln) => new RegExp(`^\\s*${CRYPTO_PATH_KEY.replace(".", "\\.")}\\s*[=:]`).test(ln))) {
        const eol = g.lines[0]?.endsWith("\r") ? "\r" : "";
        const add = [`${eol}`, `# ${L("암호화 설정 파일 경로(v1.13 externalize) — 비우면 classpath 의 egov-crypto-config.properties", "Crypto config file path (v1.13 externalize) — empty means the classpath egov-crypto-config.properties")}${eol}`, `${CRYPTO_PATH_KEY}=\${${CRYPTO_ENV}:}${eol}`];
        const last = g.lines.length && g.lines[g.lines.length - 1].trim() === "" ? g.lines.length - 1 : g.lines.length;
        g.lines.splice(last, 0, ...add.slice(last === 0 ? 1 : 0));
        g.changes.push({ line: last + 1, before: "", after: `${CRYPTO_PATH_KEY}=\${${CRYPTO_ENV}:}` });
      }
    } else notes.push(L(`globals.properties 를 찾지 못해 ${CRYPTO_PATH_KEY} 를 넣지 못했습니다 — JVM 옵션 -D${CRYPTO_PATH_KEY}=file:/경로 로 주세요`, `globals.properties not found, so ${CRYPTO_PATH_KEY} was not added — pass -D${CRYPTO_PATH_KEY}=file:/path as a JVM option`));
  }
  const files = [...texts.entries()].filter(([, t]) => t.changes.length).map(([p, t]) => ({ path: p, changes: t.changes }));
  const env = [...envMap.entries()].map(([name, e]) => ({ name, keys: e.keys, example: e.example }));
  const deploy = updateDeployFiles(projectDir, env, cryptoExample ? cryptoExample.path : null);
  const manual = scan.findings.filter((f) => f.action === "manual").map((f) => ({ file: f.file, line: f.line, key: f.key, reason: f.reason ?? "" }));
  const summary = { found: scan.findings.length, env: scan.findings.filter((f) => f.action === "env").length, cryptoPath: cryptoFindings.length, encrypted: scan.findings.filter((f) => f.action === "encrypted").length, manual: manual.length, files: files.length };
  if (scan.findings.some((f) => f.action === "encrypted") && !cryptoFindings.length && mode !== "env") notes.push(L("암호화된 값이 있지만 egov-crypto-config.properties(5.x)가 없어 키를 외부화하지 못했습니다 — 4.x 는 context-crypto.xml 의 키를 수동 항목으로 내고, 5.x 전환(migrate_egovframe_project·reassemble) 뒤 다시 실행하면 키가 외부 파일로 갑니다.", "Encrypted values exist but there is no egov-crypto-config.properties (5.x), so the key was not externalized — for 4.x the key in context-crypto.xml is listed as a manual item; run again after moving to 5.x (migrate_egovframe_project, reassemble) and the key goes to an external file."));
  if (runtime === "tomcat" && summary.env) notes.push(L("Classic: PropertyPlaceholderConfigurer 는 자리표시자를 globals.properties → JVM 시스템 속성 → 환경 변수 순으로 풉니다. 환경 변수가 없으면 'Could not resolve placeholder' 로 기동이 실패합니다(verify_egovframe_startup: config-missing).", "Classic: PropertyPlaceholderConfigurer resolves placeholders from globals.properties, then JVM system properties, then environment variables. Without the variable, startup fails with 'Could not resolve placeholder' (verify_egovframe_startup: config-missing)."));
  if (cryptoFindings.length) notes.push(L(`암호화 키는 ${CRYPTO_ENV}=file:/경로/egov-crypto-config.properties 로 외부 파일에서 읽습니다(runtime 5.x EgovCryptoConfiguration 의 ${CRYPTO_PATH_KEY}). 저장소의 값은 여전히 기본 키 'egovframe' 로 암호화돼 있으니 외부 파일에 새 키·해시를 두고 값을 다시 암호화하세요(공통컴포넌트 EgovCryptoInfo 화면 또는 EgovEnvCryptoService.encrypt).`, `The crypto key is read from an external file via ${CRYPTO_ENV}=file:/path/egov-crypto-config.properties (${CRYPTO_PATH_KEY} of runtime 5.x EgovCryptoConfiguration). Values in the repository are still encrypted with the default key 'egovframe' — put a new key and hash in the external file and re-encrypt the values (EgovCryptoInfo screen of the common components or EgovEnvCryptoService.encrypt).`));
  const base: ExternalizeResult = { projectDir, dryRun, mode, runtime, findings: scan.findings, summary, files, env, generated: cryptoExample ? [cryptoExample.path] : [], deployUpdated: [...deploy.keys()], manual, secureCoding: { rule: CONFIG_PASSWORD_RULE, before: scan.secureBefore, after: null }, notes };
  if (dryRun || (!files.length && !cryptoExample)) {
    if (dryRun && (files.length || cryptoExample)) notes.push(L(`적용하려면 dryRun=false 로 다시 호출하세요. 원본(비밀 값 포함)은 migration-backup/ 에만 남고 결과에는 가린 값만 적습니다.${opts.verify ? " verify=true 면 적용 뒤 원래 값을 환경 변수로 주고 기동을 확인합니다." : ""}`, `To apply, call again with dryRun=false. Originals (with the secret values) are kept only in migration-backup/; results show masked values.${opts.verify ? " With verify=true the project is started after applying, with the original values given as environment variables." : ""}`));
    return base;
  }

  // 적용 — 한 transaction
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRel = path.join("migration-backup", `${ts}-externalize-${randomUUID()}`);
  const planRel = path.join(backupRel, "externalize-plan.json");
  const plan = { createdAt: new Date().toISOString(), tool: "externalize_egovframe_config", mode, summary, env, files: files.map((f) => ({ path: f.path, changes: f.changes })), generated: base.generated, deployUpdated: base.deployUpdated, manual };
  await withFileTransaction(projectDir, L("설정 외부화", "config externalization"), (tx) => {
    for (const [r, t] of texts) { const cur = tx.readFile(r); if (cur === null || cur.toString("utf8") !== t.before) throw new Error(L(`점검 이후 파일이 바뀌어 적용을 중단합니다: ${r}`, `File changed since the scan; aborting: ${r}`)); }
    for (const [r, t] of texts) { if (!t.changes.length) continue; tx.writeFile(path.join(backupRel, r), t.before, { mustNotExist: true }); tx.writeFile(r, t.lines.join("\n")); }
    if (cryptoExample) tx.writeFile(cryptoExample.path, cryptoExample.content, { mustNotExist: !fs.existsSync(path.join(projectDir, cryptoExample.path)) });
    for (const [r, d] of deploy) { tx.writeFile(path.join(backupRel, r), d.before, { mustNotExist: true }); tx.writeFile(r, d.after); }
    tx.writeFile(planRel, `${JSON.stringify(plan, null, 2)}\n`, { mustNotExist: true });
    if (opts.faultInjection === "after-files") throw new Error("externalize fault injection: after-files");
  });
  const backupDir = path.join(projectDir, backupRel);
  const result: ExternalizeResult = { ...base, backupDir, planPath: path.join(projectDir, planRel) };

  // 재점검 — 보안약점 규칙이 0 이 됐는지
  try {
    const after = await checkSecureCoding({ projectDir, rules: [CONFIG_PASSWORD_RULE], dataFlow: false, includeTests: false, maxFindings: 5000, ...(opts.paths?.length ? { paths: opts.paths } : {}) });
    result.secureCoding = { rule: CONFIG_PASSWORD_RULE, before: scan.secureBefore, after: after.findings.filter((x) => scan.configFiles.includes(x.file)).length };
  } catch { /* 재점검 실패는 결과에 null */ }

  // 검증 — 원래 값을 환경 변수로 주고 기동(설정 해석이 깨졌으면 되돌림)
  if (opts.verify) {
    const envValues: Record<string, string> = {};
    for (const f of scan.findings) if (f.action === "env" && f.envName) envValues[f.envName] = scan.values.get(`${f.file}:${f.line}`) ?? "";
    if (cryptoFindings.length && scan.cryptoConfig) envValues[CRYPTO_ENV] = `file:${path.join(backupDir, scan.cryptoConfig)}`;
    const t0 = Date.now();
    let st: StartupResult | null = null; let err: string | null = null;
    try { st = await verifyStartup({ projectDir, timeoutMs: opts.timeoutMs, tomcatHome: opts.tomcatHome, runner: opts.runner, platform: opts.platform, httpProbe: opts.httpProbe, download: opts.download, cacheDir: opts.cacheDir, env: envValues }); } catch (e) { err = e instanceof Error ? e.message : String(e); }
    const configBroken = !!st && !st.success && !!st.cause && (st.cause.kind === "config-missing" || (st.cause.kind === "bean-creation" && /placeholder|crypto|decrypt|Crypto/i.test(st.cause.summary)));
    result.verify = { ran: !!st, success: st ? st.success : null, ...(st?.cause ? { cause: st.cause } : {}), durationMs: Date.now() - t0, env: Object.keys(envValues) };
    if (err) notes.push(L(`기동 검증을 실행하지 못했습니다: ${err}`, `Startup verification could not run: ${err}`));
    if (configBroken) {
      await withFileTransaction(projectDir, L("설정 외부화 되돌리기", "config externalization rollback"), (tx) => {
        for (const [r, t] of texts) if (t.changes.length) tx.writeFile(r, t.before);
        for (const [r, d] of deploy) tx.writeFile(r, d.before);
        if (cryptoExample) tx.removeFile(cryptoExample.path);
      });
      result.rolledBack = true;
      notes.push(L(`원래 값을 환경 변수로 줬는데도 설정 해석에 실패해(${st!.cause!.kind}: ${st!.cause!.summary.slice(0, 160)}) 파일을 되돌렸습니다. 백업 ${backupRel} 은 남겨 둡니다.`, `Startup failed at configuration resolution even with the original values as environment variables (${st!.cause!.kind}: ${st!.cause!.summary.slice(0, 160)}); files were restored. Backup ${backupRel} is kept.`));
    } else if (st && !st.success) notes.push(L(`기동은 실패했지만 설정 해석 단계는 지났습니다(${st.cause?.kind ?? "?"}: ${st.cause?.summary.slice(0, 120) ?? ""}) — 외부화와 무관한 원인이라 적용을 유지합니다.`, `Startup failed but passed configuration resolution (${st.cause?.kind ?? "?"}: ${st.cause?.summary.slice(0, 120) ?? ""}) — unrelated to externalization, so the changes are kept.`));
  }
  return result;
}

export function renderExternalizeMarkdown(r: ExternalizeResult): string {
  const out: string[] = [];
  const s = r.summary;
  out.push(L(`# 설정·비밀값 외부화 ${r.dryRun ? "계획" : r.rolledBack ? "(되돌림)" : "결과"} — ${r.projectDir}`, `# Config secret externalization ${r.dryRun ? "plan" : r.rolledBack ? "(rolled back)" : "result"} — ${r.projectDir}`), ``);
  out.push(L(`비밀 값 ${s.found}건: 환경 변수 자리표시자 ${s.env} · 암호화 키 외부 파일 ${s.cryptoPath} · 암호화 값(키로 보호) ${s.encrypted} · 수동 ${s.manual} · 바꾼 파일 ${s.files} · 보안약점 ${r.secureCoding.rule} ${r.secureCoding.before}${r.secureCoding.after !== null ? ` → ${r.secureCoding.after}` : ""}`, `Secrets ${s.found}: env placeholders ${s.env} · crypto key to external file ${s.cryptoPath} · encrypted values (protected by key) ${s.encrypted} · manual ${s.manual} · files changed ${s.files} · secure-coding ${r.secureCoding.rule} ${r.secureCoding.before}${r.secureCoding.after !== null ? ` → ${r.secureCoding.after}` : ""}`), ``);
  if (r.env.length) {
    out.push(L("## 환경 변수", "## Environment variables"), ``);
    for (const e of r.env) out.push(`- \`${e.name}\` ← ${e.keys.map((k) => `\`${k}\``).join(", ")} (${L("예", "e.g.")} \`${e.name}=${e.example}\`)`);
    out.push(``);
  }
  if (r.files.length) {
    out.push(L("## 바뀌는 줄", "## Changed lines"), ``);
    for (const f of r.files) { out.push(`- \`${f.path}\``); for (const c of f.changes.slice(0, 12)) out.push(`  - L${c.line}: \`${c.before.trim() || "(추가)"}\` → \`${c.after.trim()}\``); }
    out.push(``);
  }
  if (r.generated.length || r.deployUpdated.length) out.push(L(`생성 ${r.generated.map((g) => `\`${g}\``).join(", ") || "없음"} · 배포 산출물 갱신 ${r.deployUpdated.map((g) => `\`${g}\``).join(", ") || "없음"}`, `Generated ${r.generated.map((g) => `\`${g}\``).join(", ") || "none"} · deployment files updated ${r.deployUpdated.map((g) => `\`${g}\``).join(", ") || "none"}`), ``);
  if (r.manual.length) {
    out.push(L("## 수동 항목", "## Manual items"), ``);
    for (const m of r.manual) out.push(`- \`${m.file}:${m.line}\` \`${m.key}\` — ${m.reason}`);
    out.push(``);
  }
  if (r.verify) out.push(L(`**기동 검증**: ${r.verify.ran ? (r.verify.success ? "기동 성공" : `실패 — ${r.verify.cause?.kind ?? "?"}: ${r.verify.cause?.summary.slice(0, 160) ?? ""}`) : "실행 못 함"} · ${Math.round(r.verify.durationMs / 1000)}초 · 환경 변수 ${r.verify.env.join(", ")}${r.rolledBack ? " · **파일 되돌림**" : ""}`, `**Startup verification**: ${r.verify.ran ? (r.verify.success ? "started" : `failed — ${r.verify.cause?.kind ?? "?"}: ${r.verify.cause?.summary.slice(0, 160) ?? ""}`) : "could not run"} · ${Math.round(r.verify.durationMs / 1000)}s · env ${r.verify.env.join(", ")}${r.rolledBack ? " · **files restored**" : ""}`), ``);
  if (r.backupDir) out.push(L(`- 백업: ${r.backupDir} (원본 — 비밀 값 포함, 저장소에 넣지 마세요 + externalize-plan.json)`, `- Backup: ${r.backupDir} (originals — contain the secret values, do not commit + externalize-plan.json)`));
  for (const n of r.notes) out.push(`- ${n}`);
  return out.join("\n");
}
