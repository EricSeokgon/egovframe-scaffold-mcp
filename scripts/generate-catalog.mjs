#!/usr/bin/env node
/**
 * 공통컴포넌트 저장소 구조를 스캔해 catalog/components.json을 생성한다. (M3)
 *
 * 사용법:
 *   node scripts/generate-catalog.mjs            # 저장소 zip을 내려받아 생성
 *   node scripts/generate-catalog.mjs --zip a.zip # 로컬 zip 사용(오프라인)
 *
 * 규칙:
 *  - 컴포넌트 단위: egovframework/com/<cat>/<comp> 2단계 패키지 (cmm은 하위 포함 단일 컴포넌트)
 *  - 각 컴포넌트의 pathPrefixes: java/mapper/jsp 3종
 *  - catalog/overrides.json으로 id·이름·설명·의존성을 큐레이션 (기본 dependsOn: ["cmm"])
 */
import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = { repo: "eGovFramework/egovframe-common-components", branch: "main" };
const JAVA = "src/main/java/egovframework/com/";
const MAPPER = "src/main/resources/egovframework/mapper/com/";
const JSP = "src/main/webapp/WEB-INF/jsp/egovframework/com/";

let zipEntriesCache = null;
async function loadZipEntries() {
  if (zipEntriesCache) return zipEntriesCache;
  const zipArg = process.argv.indexOf("--zip");
  let buf;
  if (zipArg > -1) {
    buf = fs.readFileSync(process.argv[zipArg + 1]);
  } else {
    const url = `https://codeload.github.com/${SOURCE.repo}/zip/${SOURCE.branch}`;
    console.error(`다운로드: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`다운로드 실패 (${res.status})`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const zip = new AdmZip(buf);
  zipEntriesCache = zip.getEntries().filter((e) => !e.isDirectory);
  return zipEntriesCache;
}

async function loadEntries() {
  const entries = (await loadZipEntries()).map((e) => e.entryName);
  const rootPrefix = entries[0].split("/")[0] + "/";
  return entries.map((n) => (n.startsWith(rootPrefix) ? n.slice(rootPrefix.length) : n));
}

/** 컴포넌트 매퍼(*_SQL_mysql.xml)에서 참조 테이블(COMT*)을 추출한다. */
async function extractTables(mapperPrefix) {
  const entries = await loadZipEntries();
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  const tables = new Set();
  for (const e of entries) {
    const rel = e.entryName.startsWith(rootPrefix) ? e.entryName.slice(rootPrefix.length) : e.entryName;
    if (rel.startsWith(mapperPrefix) && rel.endsWith("_SQL_mysql.xml")) {
      const txt = e.getData().toString("utf8");
      for (const t of txt.match(/\bCOMT[A-Z0-9_]{2,}\b/g) ?? []) tables.add(t);
    }
  }
  return [...tables].sort();
}

/** 파일 경로 → 컴포넌트 키 (예: cop.bbs, cmm). 해당 없으면 null */
function componentKey(rel, base) {
  if (!rel.startsWith(base)) return null;
  const segs = rel.slice(base.length).split("/");
  if (segs.length < 2) return null; // 최소 <cat>/<파일>
  if (segs[0] === "cmm") return "cmm"; // cmm은 하위 포함 단일 컴포넌트
  if (segs.length < 3) return null; // <cat>/<comp>/<파일> 필요
  return `${segs[0]}.${segs[1]}`;
}

const files = await loadEntries();
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog/overrides.json"), "utf-8"));
const byKey = new Map();
for (const f of files)
  for (const base of [JAVA, MAPPER, JSP]) {
    const key = componentKey(f, base);
    if (key) {
      if (!byKey.has(key)) byKey.set(key, 0);
      byKey.set(key, byKey.get(key) + 1);
    }
  }

const components = [];
for (const key of [...byKey.keys()].sort()) {
  const pkg = key === "cmm" ? "cmm/" : key.replace(".", "/") + "/";
  const o = overrides[key] ?? {};
  components.push({
    id: o.id ?? key,
    name: o.name ?? key,
    category: key.split(".")[0],
    description: o.description ?? `egovframework/com/${pkg.slice(0, -1)} 하위 소스·매퍼·JSP (자동 생성 항목)`,
    pathPrefixes: [JAVA + pkg, MAPPER + pkg, JSP + pkg],
    dependsOn: o.dependsOn ?? (key === "cmm" ? [] : ["cmm"]),
    approxFiles: byKey.get(key),
    tables: await extractTables(MAPPER + pkg),
  });
}

const catalog = {
  schemaVersion: 1,
  source: { ...SOURCE, surveyedAt: new Date().toISOString().slice(0, 10) },
  sqlNote: "DB 스크립트는 script/ddl|dml/<db>/ 의 통합본(com_DDL_<db>.sql 등)으로 제공됩니다. 컴포넌트별 테이블 선별 적용은 로드맵 항목입니다.",
  generatedBy: "scripts/generate-catalog.mjs",
  components,
};
fs.writeFileSync(path.join(ROOT, "catalog/components.json"), JSON.stringify(catalog, null, 2) + "\n");
console.error(`생성 완료: ${components.length}개 컴포넌트 (총 ${components.reduce((n, c) => n + c.approxFiles, 0)}개 파일 매핑)`);
