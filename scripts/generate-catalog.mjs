#!/usr/bin/env node
/**
 * 공통컴포넌트 저장소 구조를 스캔해 catalog/components.json을 생성한다. (M3)
 *
 * 사용법:
 *   node scripts/generate-catalog.mjs            # 저장소 zip을 내려받아 생성
 *   node scripts/generate-catalog.mjs --zip a.zip # 로컬 zip 사용(오프라인)
 *
 * 규칙:
 *  - 컴포넌트 단위(v0.12.0): 리프 패키지(service/web 이전까지의 패키지 경로, 최대 4단계).
 *    하위 리프가 여러 개인 2단계 패키지는 children을 가진 그룹으로 함께 등록한다(기존 id 하위 호환).
 *    cmm은 하위 포함 단일 컴포넌트.
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

const STRUCT_SEGS = new Set(["service", "web", "impl"]);

/** 파일 경로 → 리프 컴포넌트 키 (예: cop.bbs, cop.smt.mrm, uss.ion.wik.bmk, cmm). 해당 없으면 null */
function componentKey(rel, base) {
  if (!rel.startsWith(base)) return null;
  const segs = rel.slice(base.length).split("/");
  if (segs.length < 2) return null;
  if (segs[0] === "cmm") return "cmm"; // cmm은 하위 포함 단일 컴포넌트
  if (segs.length < 3) return null;
  const pkg = [segs[0], segs[1]];
  for (let i = 2; i < Math.min(segs.length - 1, 4); i++) {
    if (STRUCT_SEGS.has(segs[i])) break;
    pkg.push(segs[i]);
  }
  return pkg.join(".");
}


/** --docs <egovframe-docs 클론 경로>: 컴포넌트↔가이드 문서 매핑을 계산한다. */
function computeDocsMap() {
  const i = process.argv.indexOf("--docs");
  if (i < 0) return null;
  const docsRoot = process.argv[i + 1];
  const ccRoot = path.join(docsRoot, "common-component");
  const map = new Map(); // key → [{count, path, title}]
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) { if (!p.includes("/intro")) walk(p); continue; }
      if (!name.endsWith(".md") || name === "_index.md") continue;
      const txt = fs.readFileSync(p, "utf8");
      const tm = txt.match(/^title:\s*"?([^"\n]+)"?/m);
      const title = tm ? tm[1].trim() : name;
      if (title.includes("배포")) continue;
      const cnt = new Map();
      for (const m of txt.matchAll(/egovframework[./]com[./]([a-z]{2,4})[./]([a-z]{2,4})(?:[./]([a-z]{2,4}))?(?:[./]([a-z]{2,4}))?\b/g)) {
        const segs = [m[1], m[2], m[3], m[4]].filter((x) => x && !["service", "web", "impl"].includes(x));
        for (let n = 2; n <= segs.length; n++) {
          const key = segs.slice(0, n).join(".");
          cnt.set(key, (cnt.get(key) ?? 0) + 1);
        }
      }
      const cmm = (txt.match(/egovframework[./]com[./]cmm\b/g) ?? []).length;
      if (cmm) cnt.set("cmm", (cnt.get("cmm") ?? 0) + cmm);
      if (cnt.size === 0) continue;
      const [topKey, topCount] = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
      if (topCount < 3) continue; // 지배적 참조만 채택
      if (!map.has(topKey)) map.set(topKey, []);
      map.get(topKey).push({ count: topCount, path: path.relative(docsRoot, p), title });
    }
  };
  walk(ccRoot);
  for (const v of map.values()) v.sort((a, b) => b.count - a.count);
  return map;
}

/** 리프 패키지의 Service 인터페이스 Javadoc에서 한글 명칭을 추출한다 */
async function extractName(javaPrefix) {
  const entries = await loadZipEntries();
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  for (const e of entries) {
    const rel = e.entryName.startsWith(rootPrefix) ? e.entryName.slice(rootPrefix.length) : e.entryName;
    if (!rel.startsWith(javaPrefix) || !/Egov\w*Service\.java$/.test(rel) || rel.includes("/impl/")) continue;
    const txt = e.getData().toString("utf8");
    const jd = txt.match(/\/\*\*([\s\S]*?)\*\//);
    if (!jd) continue;
    const doc = jd[1].replace(/[*\r]/g, " ").replace(/\s+/g, " ");
    let m = doc.match(/개요\s*[-:]?\s*([가-힣A-Za-z0-9()\/·\s]{2,30}?)(?:에 대한|을 위한|를 위한|의 |를 |을 |서비스|기능)/);
    if (!m) m = doc.match(/([가-힣][가-힣A-Za-z0-9()\/·]{1,24}?)(?:에 대한|을 위한|를 위한|를 처리|을 처리|을 관리|를 관리)/);
    if (m) {
      const name = m[1].trim();
      if (name.length >= 2 && !/Copyright|저작권/.test(name)) return name;
    }
  }
  return null;
}

const docsMap = computeDocsMap();
const files = await loadEntries();
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog/overrides.json"), "utf-8"));
let prevDocs = new Map();
try {
  const prev = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog/components.json"), "utf-8"));
  prevDocs = new Map(prev.components.filter((c) => c.docs).map((c) => [c.id, c.docs]));
} catch { /* 최초 생성 시 무시 */ }
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
const leafKeys = [...byKey.keys()].sort();
for (const key of leafKeys) {
  const pkg = key === "cmm" ? "cmm/" : key.replaceAll(".", "/") + "/";
  const o = overrides[key] ?? {};
  const parent2 = key.split(".").slice(0, 2).join(".");
  const autoName = o.name ?? (await extractName(JAVA + pkg));
  components.push({
    id: o.id ?? key,
    name: autoName ?? key,
    category: key.split(".")[0],
    description: o.description ?? `egovframework/com/${pkg.slice(0, -1)} 하위 소스·매퍼·JSP (자동 생성 항목)`,
    pathPrefixes: [JAVA + pkg, MAPPER + pkg, JSP + pkg],
    dependsOn: o.dependsOn ?? (key === "cmm" ? [] : ["cmm"]),
    approxFiles: byKey.get(key),
    tables: await extractTables(MAPPER + pkg),
    docs: docsMap
      ? (docsMap.get(key) ?? docsMap.get(parent2) ?? []).slice(0, 5).map(({ path: p, title }) => ({ path: p.split(path.sep).join("/"), title }))
      : (prevDocs.get(o.id ?? key) ?? undefined),
  });
}

// 2단계 그룹: 하위 리프가 2개 이상이면 children 그룹으로 등록 (기존 id 하위 호환)
const byId = new Map(components.map((c) => [c.id, c]));
const groups = new Map();
for (const key of leafKeys) {
  const segs = key.split(".");
  if (segs.length <= 2) continue;
  const g = segs.slice(0, 2).join(".");
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push((overrides[key]?.id) ?? key);
}
for (const [g, children] of [...groups.entries()].sort()) {
  if (byId.has(g)) { byId.get(g).children = children; continue; } // 직속 파일 리프가 있으면 그 항목에 children 부여
  if (children.length < 2) continue;
  const o = overrides[g] ?? {};
  const pkg = g.replaceAll(".", "/") + "/";
  components.push({
    id: o.id ?? g,
    name: (o.name ?? g) + " (그룹)",
    category: g.split(".")[0],
    description: o.description ?? `egovframework/com/${g.replaceAll(".", "/")} 하위 컴포넌트 ${children.length}종 일괄 설치 그룹`,
    pathPrefixes: [],
    dependsOn: [],
    approxFiles: children.reduce((n, c) => n + (byId.get(c)?.approxFiles ?? 0), 0),
    children,
    docs: docsMap ? (docsMap.get(g) ?? []).slice(0, 5).map(({ path: p, title }) => ({ path: p.split(path.sep).join("/"), title })) : (prevDocs.get(o.id ?? g) ?? undefined),
  });
}
components.sort((a, b) => a.id.localeCompare(b.id));

const catalog = {
  schemaVersion: 1,
  source: { ...SOURCE, surveyedAt: new Date().toISOString().slice(0, 10) },
  sqlNote: "DB 스크립트는 script/ddl|dml/<db>/ 의 통합본(com_DDL_<db>.sql 등)으로 제공됩니다. 컴포넌트별 테이블 선별 적용은 로드맵 항목입니다.",
  generatedBy: "scripts/generate-catalog.mjs",
  components,
};
fs.writeFileSync(path.join(ROOT, "catalog/components.json"), JSON.stringify(catalog, null, 2) + "\n");
console.error(`생성 완료: ${components.length}개 항목 (리프 ${components.filter((c) => !c.children || c.pathPrefixes.length).length}, 그룹 ${components.filter((c) => c.children && !c.pathPrefixes.length).length}) — 리프 파일 ${components.filter((c) => c.pathPrefixes.length).reduce((n, c) => n + c.approxFiles, 0)}개 매핑`);
