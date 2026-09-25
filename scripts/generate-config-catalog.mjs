#!/usr/bin/env node
/**
 * 공식 Initializr 설정 템플릿을 내려받아 패키지에 동봉한다 → catalog/config-templates/ + catalog/config-templates.json (v0.28)
 *
 *   출처: eGovFramework/egovframe-vscode-initializr (Apache-2.0)
 *         templates/templates-context-xml.json   — 설정 템플릿 21종 목록
 *         templates/config/<folder>/<file>.hbs   — Handlebars 템플릿(xml·javaConfig·yaml·properties)
 *
 * 브랜치는 움직이므로 commit 으로 고정하고, 파일마다 sha256 을 기록한다.
 * 큐레이션(MCP id·기본값·기본 파일명·선택지)은 catalog/config-mapping.json 에서 읽는다.
 * upstream 항목이 매핑에 없거나, 템플릿이 참조하는 변수에 기본값이 없으면 실패한다 — 조용한 누락을 막기 위해서다.
 *
 * 사용법:
 *   node scripts/generate-config-catalog.mjs                     # 고정 commit 에서 내려받아 생성
 *   node scripts/generate-config-catalog.mjs --commit <sha>      # 다른 commit 으로 갱신
 *   node scripts/generate-config-catalog.mjs --offline <initializr-clone-dir>
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "catalog", "config-templates");
const OUT_JSON = path.join(ROOT, "catalog", "config-templates.json");
const MAPPING_PATH = path.join(ROOT, "catalog", "config-mapping.json");

export const CONFIG_SOURCE = {
  repository: "eGovFramework/egovframe-vscode-initializr",
  branch: "main",
  catalogPath: "templates/templates-context-xml.json",
  templateDir: "templates/config",
  license: "Apache-2.0",
};
/** 조사 시점의 Initializr commit. 갱신 절차: docs/design-config-generation.md */
export const DEFAULT_COMMIT = "bc1864133ef3143118d33afb7ce43f5b8f433d5a";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const FORMATS = [
  ["xml", "templateFile"],
  ["javaConfig", "javaConfigTemplate"],
  ["yaml", "yamlTemplate"],
  ["properties", "propertiesTemplate"],
];
const VAR_RE = /\b((?:txt|rdo|cbo|cmb|chk)[A-Za-z]+)\b/g;

async function fetchText(url, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "egovframe-scaffold-mcp" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const commitIdx = argv.indexOf("--commit");
  const offlineIdx = argv.indexOf("--offline");
  const commit = commitIdx >= 0 ? argv[commitIdx + 1] : DEFAULT_COMMIT;
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`commit 은 40자 hex 여야 합니다: ${commit}`);
  const offlineDir = offlineIdx >= 0 ? path.resolve(argv[offlineIdx + 1]) : null;

  const read = async (rel) =>
    offlineDir
      ? fs.readFileSync(path.join(offlineDir, rel), "utf8")
      : fetchText(`https://raw.githubusercontent.com/${CONFIG_SOURCE.repository}/${commit}/${rel}`);

  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8"));
  const catalogText = await read(CONFIG_SOURCE.catalogPath);
  const upstream = JSON.parse(catalogText);
  if (!Array.isArray(upstream)) throw new Error("templates-context-xml.json 이 배열이 아닙니다");

  const byDisplay = new Map(mapping.entries.map((e) => [e.displayName, e]));
  const seen = new Set();
  const files = {};
  const entries = [];
  const upstreamMissing = {};
  const excluded = {};

  for (const up of upstream) {
    const curated = byDisplay.get(up.displayName);
    if (!curated) throw new Error(`config-mapping.json 에 '${up.displayName}' 항목이 없습니다 — 큐레이션을 먼저 추가하세요`);
    if (curated.templateFolder !== up.templateFolder || curated.templateFile !== up.templateFile)
      throw new Error(`'${up.displayName}' 의 templateFolder/templateFile 이 upstream 과 다릅니다`);
    seen.add(up.displayName);

    const formats = {};
    const variables = new Set();
    for (const [format, key] of FORMATS) {
      const file = up[key];
      if (!file) continue;
      if (curated.excludeFormats?.[format]) {
        (excluded[curated.id] ??= []).push({ format, file: `${CONFIG_SOURCE.templateDir}/${up.templateFolder}/${file}`, reason: curated.excludeFormats[format] });
        continue;
      }
      const rel = `${CONFIG_SOURCE.templateDir}/${up.templateFolder}/${file}`;
      let text;
      try {
        text = await read(rel);
      } catch (error) {
        // upstream 카탈로그가 존재하지 않는 파일을 가리키는 경우(예: logging 의 timeBasedRollingFile-java.hbs) —
        // 그 포맷만 제외하고 기록해, 사용자가 없는 포맷을 요청하면 이유를 알 수 있게 한다.
        if (/404|ENOENT/.test(String(error?.message ?? error))) {
          (upstreamMissing[curated.id] ??= []).push({ format, file: rel });
          continue;
        }
        throw error;
      }
      const local = `${up.templateFolder}/${file}`;
      files[local] = { text, sha256: sha256(text), upstreamPath: rel };
      formats[format] = { file: local, sha256: files[local].sha256 };
      for (const m of text.matchAll(VAR_RE)) variables.add(m[1]);
    }
    variables.delete("txtFileName"); // 파일명·클래스명은 도구가 채운다
    const missing = [...variables].filter((v) => !(v in curated.defaults)).sort();
    if (missing.length > 0)
      throw new Error(`'${curated.id}' 템플릿이 참조하는 변수에 기본값이 없습니다: ${missing.join(", ")}`);
    const unused = Object.keys(curated.defaults).filter((k) => !variables.has(k) && k !== "txtConfigPackage").sort();

    entries.push({
      id: curated.id,
      category: curated.category,
      displayName: up.displayName,
      description: up.description ?? "",
      formType: curated.formType,
      templateFolder: up.templateFolder,
      formats,
      defaultFileName: curated.defaultFileName,
      fields: [...variables].sort(),
      defaults: curated.defaults,
      ...(curated.enums ? { enums: curated.enums } : {}),
      ...(unused.length ? { unusedDefaults: unused } : {}),
      ...(upstreamMissing[curated.id] ? { upstreamMissing: upstreamMissing[curated.id] } : {}),
      ...(excluded[curated.id] ? { excluded: excluded[curated.id] } : {}),
      ...(curated.note ? { note: curated.note } : {}),
    });
  }
  const stale = mapping.entries.filter((e) => !seen.has(e.displayName)).map((e) => e.id);
  if (stale.length > 0) throw new Error(`upstream 에 없는 매핑 항목: ${stale.join(", ")}`);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  for (const [local, f] of Object.entries(files)) {
    const dest = path.join(OUT_DIR, local);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.text, "utf8");
  }
  fs.writeFileSync(
    path.join(OUT_DIR, "NOTICE.md"),
    [
      "# 출처 및 라이선스",
      "",
      `이 디렉터리의 \`.hbs\` 템플릿은 [eGovFramework/egovframe-vscode-initializr](https://github.com/${CONFIG_SOURCE.repository})`,
      `저장소의 \`${CONFIG_SOURCE.templateDir}/\` 에서 가져온 것으로, Apache License 2.0 으로 배포됩니다.`,
      `고정 commit: \`${commit}\`. 수정하지 않고 그대로 동봉하며, \`scripts/generate-config-catalog.mjs\` 로 갱신합니다.`,
      "",
    ].join("\n"),
  );

  const catalog = {
    schemaVersion: 1,
    generatedBy: "scripts/generate-config-catalog.mjs",
    source: { ...CONFIG_SOURCE, commit, surveyedAt: new Date().toISOString().slice(0, 10), catalogSha256: sha256(catalogText) },
    outputDirs: mapping.outputDirs,
    outputDirOverrides: mapping.outputDirOverrides ?? {},
    entries,
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  const nFiles = Object.keys(files).length;
  const missingCount = Object.values(upstreamMissing).reduce((n, list) => n + list.length, 0);
  console.log(
    `config-templates.json 생성: 템플릿 ${entries.length}종, 파일 ${nFiles}개 동봉 (commit ${commit.slice(0, 12)})` +
      (missingCount ? ` — upstream 카탈로그가 가리키지만 존재하지 않는 파일 ${missingCount}개 제외` : ""),
  );
}

const isDirectRun = (() => {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isDirectRun) await main();
