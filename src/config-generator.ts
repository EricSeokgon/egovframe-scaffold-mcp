// 설정 파일 생성 (generate_egovframe_config) — 공식 Initializr 설정 템플릿(Handlebars)을 동봉해 오프라인으로 렌더링한다.
//
// 템플릿·기본값·기본 파일명은 catalog/config-templates.json(scripts/generate-config-catalog.mjs 가 생성)에서 읽고,
// 템플릿 본문은 catalog/config-templates/<folder>/<file>.hbs 에 commit·sha256 고정으로 동봉된다.
import Handlebars from "handlebars";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const CONFIG_FORMATS = ["xml", "javaConfig", "yaml", "properties"] as const;
export type ConfigFormat = (typeof CONFIG_FORMATS)[number];

export interface ConfigTemplateEntry {
  id: string;
  category: string;
  displayName: string;
  description: string;
  formType: string;
  templateFolder: string;
  formats: Partial<Record<ConfigFormat, { file: string; sha256: string }>>;
  defaultFileName: { xml: string; javaConfig: string };
  /** 템플릿이 참조하는 변수(txtFileName 제외) */
  fields: string[];
  defaults: Record<string, string | boolean>;
  enums?: Record<string, string[]>;
  upstreamMissing?: Array<{ format: ConfigFormat; file: string }>;
  /** 큐레이션으로 제외한 형식과 사유 */
  excluded?: Array<{ format: ConfigFormat; file: string; reason: string }>;
  note?: string;
}

export interface ConfigCatalog {
  schemaVersion: number;
  generatedBy: string;
  source: { repository: string; branch: string; commit: string; catalogPath: string; templateDir: string; license: string; surveyedAt: string; catalogSha256: string };
  outputDirs: Record<ConfigFormat, string>;
  outputDirOverrides: Record<string, Partial<Record<ConfigFormat, string>>>;
  entries: ConfigTemplateEntry[];
}

const CATALOG_URL = new URL("../catalog/config-templates.json", import.meta.url);
const TEMPLATE_DIR_URL = new URL("../catalog/config-templates/", import.meta.url);

let cached: ConfigCatalog | null = null;
export function loadConfigCatalog(): ConfigCatalog {
  if (!cached) cached = JSON.parse(fs.readFileSync(CATALOG_URL, "utf8")) as ConfigCatalog;
  return cached;
}

export function getConfigTemplate(id: string): ConfigTemplateEntry {
  const entry = loadConfigCatalog().entries.find((e) => e.id === id);
  if (!entry) throw new Error(`알 수 없는 설정 템플릿 id: ${id} — 사용 가능: ${loadConfigCatalog().entries.map((e) => e.id).join(", ")}`);
  return entry;
}

// ── Handlebars 환경: Initializr configGenerator.ts 가 등록하는 헬퍼와 동일하게 맞춘다 ──
const hbs = Handlebars.create();
hbs.registerHelper("eq", (a: unknown, b: unknown) => a === b);
hbs.registerHelper("ne", (a: unknown, b: unknown) => a !== b);
hbs.registerHelper("capitalize", (s: unknown) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : ""));
hbs.registerHelper("trim", (v: unknown) => String(v ?? "").trim());
hbs.registerHelper("or", (...args: unknown[]) => args.slice(0, -1).some((v) => !!v));

const compiled = new Map<string, HandlebarsTemplateDelegate>();

/** 동봉 템플릿을 읽어 고정 sha256 과 대조한 뒤 컴파일한다(패키지 변조·손상 감지). */
function compileTemplate(entry: ConfigTemplateEntry, format: ConfigFormat): HandlebarsTemplateDelegate {
  const spec = entry.formats[format];
  if (!spec) {
    const missing = entry.upstreamMissing?.find((m) => m.format === format);
    const excluded = entry.excluded?.find((m) => m.format === format);
    throw new Error(
      `'${entry.id}' 는 ${format} 형식을 제공하지 않습니다 (제공: ${Object.keys(entry.formats).join(", ")})` +
        (missing ? ` — upstream 카탈로그는 ${missing.file} 을 가리키지만 저장소에 그 파일이 없습니다` : "") +
        (excluded ? ` — ${excluded.reason}` : ""),
    );
  }
  const key = `${entry.id}:${format}`;
  let fn = compiled.get(key);
  if (!fn) {
    const text = fs.readFileSync(new URL(spec.file, TEMPLATE_DIR_URL), "utf8");
    const actual = createHash("sha256").update(text).digest("hex");
    if (actual !== spec.sha256)
      throw new Error(`동봉 템플릿 지문이 카탈로그와 다릅니다: ${spec.file} (${actual.slice(0, 12)}… / ${spec.sha256.slice(0, 12)}…)`);
    fn = hbs.compile(text, { noEscape: true, strict: false });
    compiled.set(key, fn);
  }
  return fn;
}

const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CLASS_NAME_RE = /^[A-Z][A-Za-z0-9_]{0,127}$/;
const PACKAGE_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/;
const REL_DIR_RE = /^(?![\\/])(?!.*(^|[\\/])\.\.([\\/]|$)).{1,256}$/;

export const CONFIG_EXTENSIONS: Record<ConfigFormat, string> = { xml: ".xml", javaConfig: ".java", yaml: ".yaml", properties: ".properties" };

export interface ConfigFieldValidation {
  /** 알 수 없는 필드 */
  unknown: string[];
  /** 선택지를 벗어난 값 */
  invalidEnum: Array<{ field: string; value: string; allowed: string[] }>;
}

/** 사용자 필드를 템플릿 변수 집합·선택지와 대조한다. */
export function validateConfigFields(entry: ConfigTemplateEntry, fields: Record<string, unknown>): ConfigFieldValidation {
  const known = new Set([...entry.fields, "txtConfigPackage"]);
  const unknown = Object.keys(fields).filter((k) => !known.has(k)).sort();
  const invalidEnum: ConfigFieldValidation["invalidEnum"] = [];
  for (const [field, allowed] of Object.entries(entry.enums ?? {})) {
    const v = fields[field];
    if (v !== undefined && !allowed.includes(String(v))) invalidEnum.push({ field, value: String(v), allowed });
  }
  return { unknown, invalidEnum };
}

/** 기본값 위에 사용자 값을 덮어 렌더링 컨텍스트를 만든다. boolean 필드는 "true"/"false" 문자열도 받는다. */
export function buildConfigContext(entry: ConfigTemplateEntry, fields: Record<string, unknown>, fileName: string): Record<string, unknown> {
  const ctx: Record<string, unknown> = { ...entry.defaults };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    const isBool = typeof entry.defaults[k] === "boolean";
    ctx[k] = isBool ? (typeof v === "boolean" ? v : String(v).toLowerCase() === "true") : String(v);
  }
  ctx.txtFileName = fileName;
  return ctx;
}

/** 순수 렌더링 — 디스크에 쓰지 않는다. */
export function renderConfig(id: string, format: ConfigFormat, fields: Record<string, unknown> = {}, fileName?: string): { content: string; fileName: string; entry: ConfigTemplateEntry } {
  const entry = getConfigTemplate(id);
  if (!CONFIG_FORMATS.includes(format)) throw new Error(`format 은 ${CONFIG_FORMATS.join("|")} 중 하나여야 합니다: ${format}`);
  const v = validateConfigFields(entry, fields);
  if (v.unknown.length > 0)
    throw new Error(`'${id}' 템플릿에 없는 필드입니다: ${v.unknown.join(", ")} — 사용 가능: ${entry.fields.join(", ")}`);
  if (v.invalidEnum.length > 0)
    throw new Error(v.invalidEnum.map((e) => `${e.field}='${e.value}' 는 허용되지 않습니다 (${e.allowed.join("|")})`).join("; "));
  const name = resolveFileName(entry, format, fileName);
  const template = compileTemplate(entry, format);
  const content = template(buildConfigContext(entry, fields, name));
  return { content, fileName: name, entry };
}

/** 파일명(확장자 없음) 또는 JavaConfig 클래스명을 정한다. */
export function resolveFileName(entry: ConfigTemplateEntry, format: ConfigFormat, requested?: string): string {
  const name = (requested ?? (format === "javaConfig" ? entry.defaultFileName.javaConfig : entry.defaultFileName.xml)).trim();
  if (format === "javaConfig") {
    if (!CLASS_NAME_RE.test(name)) throw new Error(`JavaConfig 클래스명은 대문자로 시작하는 자바 식별자여야 합니다: ${name}`);
  } else if (!FILE_NAME_RE.test(name) || name.endsWith(".")) {
    throw new Error(`fileName 은 영문·숫자·점·하이픈·밑줄만 허용합니다(확장자 제외): ${name}`);
  }
  return name;
}

/** 기본 출력 디렉터리(프로젝트 상대). javaConfig 는 패키지 경로를 따른다. */
export function defaultOutputDir(entry: ConfigTemplateEntry, format: ConfigFormat, configPackage: string): string {
  const catalog = loadConfigCatalog();
  const override = catalog.outputDirOverrides[entry.category]?.[format];
  const base = override ?? catalog.outputDirs[format];
  return base.replace("{package}", configPackage.replace(/\./g, "/"));
}

export interface GenerateConfigOptions {
  projectDir: string;
  configId: string;
  format: ConfigFormat;
  fields?: Record<string, unknown>;
  /** 파일명(확장자 제외) 또는 JavaConfig 클래스명. 미지정 시 Initializr 기본값 */
  fileName?: string;
  /** 프로젝트 상대 출력 디렉터리. 미지정 시 형식·카테고리별 기본 위치 */
  outputDir?: string;
  dryRun?: boolean;
}

export interface GenerateConfigResult {
  configId: string;
  format: ConfigFormat;
  path: string;
  absolutePath: string;
  fileName: string;
  content: string;
  /** 사용자가 덮어쓴 필드 */
  overridden: string[];
  /** 렌더링에 쓰인 전체 컨텍스트(비밀번호 계열은 가려짐) */
  context: Record<string, unknown>;
  dryRun: boolean;
  written: boolean;
}

const SECRET_RE = /passw/i;

/** 설정 파일 하나를 생성한다. 기존 파일이 있으면 아무것도 쓰지 않고 거부한다. */
export function generateConfig(opts: GenerateConfigOptions): GenerateConfigResult {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const fields = opts.fields ?? {};
  const { content, fileName, entry } = renderConfig(opts.configId, opts.format, fields, opts.fileName);

  const configPackage = String(fields.txtConfigPackage ?? entry.defaults.txtConfigPackage ?? "egovframework.example.config");
  if (opts.format === "javaConfig" && !PACKAGE_RE.test(configPackage))
    throw new Error(`txtConfigPackage 는 자바 패키지 형식이어야 합니다: ${configPackage}`);

  const relDir = (opts.outputDir ?? defaultOutputDir(entry, opts.format, configPackage)).replace(/\\/g, "/").replace(/\/+$/, "");
  if (!REL_DIR_RE.test(relDir)) throw new Error(`outputDir 은 프로젝트 내부의 상대 경로여야 합니다: ${opts.outputDir}`);
  const relPath = `${relDir}/${fileName}${CONFIG_EXTENSIONS[opts.format]}`;
  const absolutePath = path.resolve(projectDir, relPath);
  // 방어선: 정규화 후에도 프로젝트 안이어야 한다 (symlink 는 realpath 로 확인)
  const rel = path.relative(projectDir, absolutePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`출력 경로가 프로젝트 밖입니다: ${relPath}`);
  let probe = path.dirname(absolutePath);
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  const realProject = fs.realpathSync(projectDir);
  const relReal = path.relative(realProject, realProbe);
  if (relReal.startsWith("..") || path.isAbsolute(relReal)) throw new Error(`출력 경로가 symlink 를 통해 프로젝트 밖을 가리킵니다: ${relPath}`);

  if (fs.existsSync(absolutePath)) throw new Error(`이미 존재합니다: ${relPath} — 덮어쓰지 않습니다(다른 fileName 을 지정하거나 파일을 옮기세요)`);

  const context = buildConfigContext(entry, fields, fileName);
  for (const k of Object.keys(context)) if (SECRET_RE.test(k) && context[k]) context[k] = "********";
  const overridden = Object.keys(fields).filter((k) => fields[k] !== undefined && fields[k] !== null).sort();

  const dryRun = opts.dryRun === true;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, { encoding: "utf8", flag: "wx" });
  }
  return { configId: entry.id, format: opts.format, path: relPath, absolutePath, fileName, content, overridden, context, dryRun, written: !dryRun };
}

/** 도구 설명·리소스용 요약. */
export function describeConfigTemplates(): Array<{ id: string; category: string; displayName: string; formats: string[]; fields: string[]; defaults: Record<string, string | boolean>; enums?: Record<string, string[]>; defaultFileName: { xml: string; javaConfig: string }; note?: string }> {
  return loadConfigCatalog().entries.map((e) => ({
    id: e.id,
    category: e.category,
    displayName: e.displayName,
    formats: Object.keys(e.formats),
    fields: e.fields,
    defaults: e.defaults,
    ...(e.enums ? { enums: e.enums } : {}),
    defaultFileName: e.defaultFileName,
    ...(e.note ? { note: e.note } : {}),
  }));
}
