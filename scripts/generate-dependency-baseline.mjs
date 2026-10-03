#!/usr/bin/env node
/**
 * 공식 5.x parent pom 에서 의존성 기준 버전을 추출한다 → catalog/dependency-baseline.json (v0.30)
 *
 *   출처(표준프레임워크 Maven 저장소 https://maven.egovframe.go.kr/maven/):
 *     org.egovframe.web:egovframe-web-config-parent   — 웹(Classic) 프로젝트 parent: <properties> + <dependencyManagement>
 *     org.egovframe.boot:egovframe-boot-starter-parent — Boot 프로젝트 parent: 위와 같고, 상위 spring-boot-starter-parent 버전을 기록
 *
 *   기준 버전은 "공식 템플릿이 관리하는 버전" 이다. 프로젝트 의존성이 이보다 낮으면 outdated 로 본다.
 *
 *   v0.34 (schemaVersion 2) 두 가지 기준을 더 담는다:
 *     boot          — Boot parent 가 상속하는 spring-boot-dependencies BOM(Maven Central)의 dependencyManagement 전체와,
 *                     그 안의 BOM import(type pom·scope import)를 한 단계 더 풀어 "groupId:artifactId" → version 으로 기록.
 *                     직접 나열 항목이 import 보다 우선하고, import 는 선언 순서대로 먼저 나온 쪽이 이긴다(Maven 의 해석 순서).
 *     rteTransitive — egovframe-runtime 모듈 pom 18종(규칙 카탈로그 coordinates 의 5.x 좌표)의 <dependencies>(test 제외)를 읽어
 *                     RTE 가 끌어오는 버전을 기록. 같은 좌표를 더 낮은 버전으로 명시한 프로젝트는 전이 버전과 충돌할 수 있다.
 *   모든 원본 pom 은 url·sha256 을 적어 재현할 수 있게 한다.
 *
 * 사용법:
 *   node scripts/generate-dependency-baseline.mjs                       # 고정 버전 내려받아 생성
 *   node scripts/generate-dependency-baseline.mjs --web 5.0.2 --boot 5.0.2
 *   node scripts/generate-dependency-baseline.mjs --offline <dir>      # <dir>/web-parent.pom, boot-parent.pom, spring-boot-dependencies.pom,
 *                                                                      #   <dir>/bom/<artifactId>-<version>.pom, <dir>/rte/<artifactId>.pom 사용
 *   node scripts/generate-dependency-baseline.mjs --cache <dir>        # 내려받은 pom 을 <dir> 에 저장(다음 실행은 --offline 으로 재현 가능)
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_JSON = path.join(ROOT, "catalog", "dependency-baseline.json");
const RULES_JSON = path.join(ROOT, "catalog", "migration-rules.json");

export const REPO = "https://maven.egovframe.go.kr/maven/";
export const CENTRAL = "https://repo1.maven.org/maven2/";
export const PARENTS = {
  web: { groupId: "org.egovframe.web", artifactId: "egovframe-web-config-parent", version: "5.0.2" },
  boot: { groupId: "org.egovframe.boot", artifactId: "egovframe-boot-starter-parent", version: "5.0.2" },
};
export const BOOT_BOM = { groupId: "org.springframework.boot", artifactId: "spring-boot-dependencies" };
export const RTE_ROOT_ARTIFACT = "egovframe-rte-root";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const pomUrl = (p, repo = REPO) => `${repo}${p.groupId.replace(/\./g, "/")}/${p.artifactId}/${p.version}/${p.artifactId}-${p.version}.pom`;

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

/** pom 의 <properties> 를 읽는다(상위 pom 의 속성을 extraProps 로 합칠 수 있다). */
export function parsePomProps(xml, extraProps = new Map()) {
  const props = new Map(extraProps);
  const propsBlock = xml.match(/<properties>([\s\S]*?)<\/properties>/);
  if (propsBlock) for (const m of propsBlock[1].matchAll(/<([\w.\-]+)>\s*([^<]*?)\s*<\/\1>/g)) props.set(m[1], m[2]);
  const self = xml.replace(/<parent>[\s\S]*?<\/parent>/, "").replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/, "").replace(/<dependencies>[\s\S]*?<\/dependencies>/, "");
  const ownVersion = self.match(/<version>\s*([^<\s]+)\s*<\/version>/)?.[1] ?? xml.match(/<parent>[\s\S]*?<version>\s*([^<\s]+)[\s\S]*?<\/parent>/)?.[1];
  if (ownVersion) { props.set("project.version", ownVersion); props.set("pom.version", ownVersion); }
  const ownGroup = self.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1] ?? xml.match(/<parent>[\s\S]*?<groupId>\s*([^<\s]+)[\s\S]*?<\/parent>/)?.[1];
  if (ownGroup) props.set("project.groupId", ownGroup);
  return props;
}
const makeResolver = (props) => (v) => { let out = v; for (let i = 0; i < 5 && /\$\{[\w.\-]+\}/.test(out); i++) out = out.replace(/\$\{([\w.\-]+)\}/g, (_, k) => props.get(k) ?? `\${${k}}`); return out; };
const parseCoord = (block) => {
  const b = block.replace(/<exclusions>[\s\S]*?<\/exclusions>/g, "");
  return { g: b.match(/<groupId>\s*([^<\s]+)/)?.[1], a: b.match(/<artifactId>\s*([^<\s]+)/)?.[1], v: b.match(/<version>\s*([^<\s]+)/)?.[1], scope: b.match(/<scope>\s*([^<\s]+)/)?.[1], type: b.match(/<type>\s*([^<\s]+)/)?.[1], optional: /<optional>\s*true/.test(b) };
};

/**
 * parent/BOM pom 을 읽는다: 상위 좌표, java.version, 버전 속성, dependencyManagement 목록.
 * strict=true(기본) 면 풀리지 않은 버전 속성은 오류, false 면 건너뛰고 unresolved 에 센다(외부 BOM 용).
 */
export function parseParentPom(xml, { strict = true, extraProps = new Map() } = {}) {
  const props = parsePomProps(xml, extraProps);
  const resolve = makeResolver(props);
  const parent = xml.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
  const parentCoord = parent
    ? { groupId: parent.match(/<groupId>\s*([^<\s]+)/)?.[1], artifactId: parent.match(/<artifactId>\s*([^<\s]+)/)?.[1], version: parent.match(/<version>\s*([^<\s]+)/)?.[1] }
    : null;
  const dm = xml.match(/<dependencyManagement>\s*<dependencies>([\s\S]*?)<\/dependencies>\s*<\/dependencyManagement>/)?.[1] ?? "";
  const managed = [];
  const unresolved = [];
  for (const m of dm.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const { g, a, v, scope, type } = parseCoord(m[1]);
    if (!g || !a || !v) continue;
    const entry = { groupId: resolve(g), artifactId: resolve(a), version: resolve(v) };
    if (scope) entry.scope = scope;
    if (type) entry.type = type;
    if (/\$\{/.test(entry.version) || /\$\{/.test(entry.groupId) || /\$\{/.test(entry.artifactId)) {
      if (strict) throw new Error(`해결되지 않은 버전 속성: ${g}:${a} = ${v}`);
      unresolved.push(`${g}:${a}:${v}`);
      continue;
    }
    managed.push(entry);
  }
  const versionProps = {};
  for (const [k, v] of props) if (/version/i.test(k) && !k.startsWith("project.") && !k.startsWith("pom.")) versionProps[k] = resolve(v);
  return { parentCoord, java: props.get("java.version") ?? null, properties: versionProps, managed, unresolved, props };
}

/** 모듈 pom 의 <dependencies>(dependencyManagement 밖) 를 읽는다. 상위 pom 의 속성은 extraProps 로 넘긴다. */
export function parseModuleDependencies(xml, extraProps = new Map()) {
  const props = parsePomProps(xml, extraProps);
  const resolve = makeResolver(props);
  const body = xml.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, "");
  const block = body.match(/<dependencies>([\s\S]*?)<\/dependencies>/)?.[1] ?? "";
  const deps = [];
  const unresolved = [];
  for (const m of block.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const { g, a, v, scope, optional } = parseCoord(m[1]);
    if (!g || !a) continue;
    const entry = { groupId: resolve(g), artifactId: resolve(a), version: v ? resolve(v) : null, scope: scope ?? "compile", optional };
    if (entry.version === null || /\$\{/.test(entry.version)) { unresolved.push(`${g}:${a}:${v ?? "(없음)"}`); continue; }
    deps.push(entry);
  }
  return { deps, unresolved };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const offlineDir = arg("--offline");
  const cacheDir = arg("--cache");
  const web = { ...PARENTS.web, version: arg("--web") ?? PARENTS.web.version };
  const boot = { ...PARENTS.boot, version: arg("--boot") ?? PARENTS.boot.version };
  for (const p of [web, boot]) if (!/^\d+\.\d+\.\d+$/.test(p.version)) throw new Error(`버전 형식: ${p.version}`);

  // 원본 pom 읽기: --offline 이면 디렉터리에서, 아니면 내려받고(--cache 면 같은 이름으로 저장)
  const read = async (url, file) => {
    if (offlineDir) return fs.readFileSync(path.join(offlineDir, file), "utf8");
    const text = await fetchText(url);
    if (cacheDir) { fs.mkdirSync(path.dirname(path.join(cacheDir, file)), { recursive: true }); fs.writeFileSync(path.join(cacheDir, file), text, "utf8"); }
    return text;
  };
  const webXml = await read(pomUrl(web), "web-parent.pom");
  const bootXml = await read(pomUrl(boot), "boot-parent.pom");
  const w = parseParentPom(webXml);
  const b = parseParentPom(bootXml);
  if (w.parentCoord) throw new Error("web parent 에 상위 parent 가 생겼습니다 — 생성기가 상위 BOM 을 따라가도록 보강해야 합니다");
  if (!b.parentCoord || b.parentCoord.artifactId !== "spring-boot-starter-parent") throw new Error("boot parent 의 상위가 spring-boot-starter-parent 가 아닙니다");
  if (w.java !== "17" || b.java !== "17") throw new Error(`java.version 이 17 이 아닙니다: web ${w.java}, boot ${b.java}`);

  const rules = JSON.parse(fs.readFileSync(RULES_JSON, "utf8"));
  const rteVersion = rules.target.runtimeVersion;

  // 두 parent 의 관리 목록을 합친다. 같은 좌표가 양쪽에 있으면 높은 버전을 기준으로 삼고 출처를 모두 적는다.
  const byKey = new Map();
  const add = (list, source) => {
    for (const e of list) {
      const k = `${e.groupId}:${e.artifactId}`;
      const cur = byKey.get(k);
      if (!cur) { byKey.set(k, { ...e, sources: [source] }); continue; }
      if (!cur.sources.includes(source)) cur.sources.push(source);
      if (compareVersions(e.version, cur.version) > 0) { cur.version = e.version; cur.versionBySource = { ...(cur.versionBySource ?? {}), [source]: e.version }; }
      else if (e.version !== cur.version) cur.versionBySource = { ...(cur.versionBySource ?? {}), [source]: e.version };
    }
  };
  add(w.managed, "web");
  add(b.managed, "boot");
  // RTE 모듈은 실행환경 최신(규칙 카탈로그 목표) 기준으로 올린다 — parent 가 관리하는 버전보다 새 릴리스가 있을 수 있다
  for (const [k, e] of byKey) if (e.groupId === "org.egovframe.rte" && compareVersions(rteVersion, e.version) > 0) { e.parentVersion = e.version; e.version = rteVersion; }
  const managed = [...byKey.values()].sort((x, y) => `${x.groupId}:${x.artifactId}`.localeCompare(`${y.groupId}:${y.artifactId}`));

  // BOM import(type pom·scope import)는 그 groupId 계열 전체의 버전을 정한다 — 계열 규칙으로 기록해 개별 artifact 가 목록에 없어도 대조할 수 있게 한다.
  // 웹 parent 의 spring.framework.version 속성도 같은 뜻이다(직접 나열한 spring-* 항목과 함께).
  // matchSubgroups: 하위 groupId(접두.xxx)까지 같은 버전으로 묶이는 계열만 true — jackson-bom 은 com.fasterxml.jackson.core/.dataformat/… 를 한 버전으로 관리하지만,
  // org.springframework 는 .data/.security/.social 같은 하위 그룹이 별도 프로젝트(버전 다름)이므로 groupId 가 정확히 같을 때만 적용한다(v0.34).
  const SUBGROUP_FAMILIES = new Set(["com.fasterxml.jackson"]);
  const families = new Map();
  const addFamily = (groupIdPrefix, version, via) => { const cur = families.get(groupIdPrefix); if (!cur || compareVersions(version, cur.version) > 0) families.set(groupIdPrefix, { groupIdPrefix, version, via, matchSubgroups: SUBGROUP_FAMILIES.has(groupIdPrefix) }); };
  // 달력형 릴리스 트레인(예: spring-cloud-dependencies 2025.0.0)은 구성 artifact 버전이 트레인 번호와 다르므로 계열 규칙으로 쓰지 않는다.
  const releaseTrains = [];
  for (const e of managed) if (e.type === "pom" && e.scope === "import") {
    if (/^\d{4}\.\d+/.test(e.version)) { releaseTrains.push({ groupId: e.groupId, artifactId: e.artifactId, version: e.version, sources: e.sources }); continue; }
    const prefix = e.artifactId === "jackson-bom" ? "com.fasterxml.jackson" : e.groupId;
    addFamily(prefix, e.version, `${e.groupId}:${e.artifactId}:${e.version} (BOM import, ${e.sources.join("/")})`);
  }
  if (w.properties["spring.framework.version"]) addFamily("org.springframework", w.properties["spring.framework.version"], `web parent spring.framework.version`);
  if (b.properties["spring.security.version"]) addFamily("org.springframework.security", b.properties["spring.security.version"], `boot parent spring.security.version`);
  if (b.properties["spring.batch.version"]) addFamily("org.springframework.batch", b.properties["spring.batch.version"], `boot parent spring.batch.version`);
  if (w.properties["jackson.version"]) addFamily("com.fasterxml.jackson", w.properties["jackson.version"], `web parent jackson.version`);
  addFamily("org.springframework.boot", b.parentCoord.version, `boot parent 의 상위 spring-boot-starter-parent`);

  // ── v0.34: Spring Boot BOM 전체 (Maven Central) ─────────────────────────────────────────
  // Boot parent 의 상위 spring-boot-starter-parent 는 같은 버전의 spring-boot-dependencies 를 상속한다.
  const bootBom = { ...BOOT_BOM, version: b.parentCoord.version };
  const bootBomXml = await read(pomUrl(bootBom, CENTRAL), "spring-boot-dependencies.pom");
  const bb = parseParentPom(bootBomXml, { strict: false });
  if (bb.unresolved.length) throw new Error(`spring-boot-dependencies 에 풀리지 않은 항목: ${bb.unresolved.slice(0, 5).join(", ")}`);
  const bootManaged = new Map(); // "g:a" → version (직접 항목 우선, import 는 선언 순서대로 첫 번째가 이김)
  const bootImports = [];
  const bootConflicts = [];
  const putBoot = (e, via) => {
    const k = `${e.groupId}:${e.artifactId}`;
    const cur = bootManaged.get(k);
    if (cur === undefined) bootManaged.set(k, e.version);
    else if (cur !== e.version) bootConflicts.push(`${k}: ${cur} (유지) vs ${e.version} (${via})`);
  };
  for (const e of bb.managed) if (!(e.type === "pom" && e.scope === "import")) putBoot(e, "직접");
  for (const e of bb.managed) {
    if (!(e.type === "pom" && e.scope === "import")) continue;
    const file = `bom/${e.artifactId}-${e.version}.pom`;
    const xml = await read(pomUrl(e, CENTRAL), file);
    let parsed = parseParentPom(xml, { strict: false });
    // 풀리지 않은 속성이 있고 상위 pom 이 있으면 상위 속성을 한 번 합쳐 다시 읽는다
    if (parsed.unresolved.length && parsed.parentCoord?.groupId && parsed.parentCoord.version) {
      const pc = { groupId: parsed.parentCoord.groupId, artifactId: parsed.parentCoord.artifactId, version: parsed.parentCoord.version };
      try {
        const parentXml = await read(pomUrl(pc, CENTRAL), `bom/${pc.artifactId}-${pc.version}.parent.pom`);
        parsed = parseParentPom(xml, { strict: false, extraProps: parsePomProps(parentXml) });
      } catch (err) { console.warn(`  상위 pom 조회 실패(${pc.artifactId}): ${err.message}`); }
    }
    let members = 0;
    for (const m of parsed.managed) { if (m.type === "pom" && m.scope === "import") continue; putBoot(m, e.artifactId); members++; }
    bootImports.push({ groupId: e.groupId, artifactId: e.artifactId, version: e.version, url: pomUrl(e, CENTRAL), sha256: sha256(xml), members, ...(parsed.unresolved.length ? { unresolved: parsed.unresolved.length } : {}) });
  }
  const bootDirect = bb.managed.filter((e) => !(e.type === "pom" && e.scope === "import")).length;

  // ── v0.34: RTE 모듈 전이 의존성 (표준프레임워크 Maven 저장소) ───────────────────────────────
  const rteRoot = { groupId: "org.egovframe.rte", artifactId: RTE_ROOT_ARTIFACT, version: rteVersion };
  const rteRootXml = await read(pomUrl(rteRoot), `rte/${RTE_ROOT_ARTIFACT}.pom`);
  const rootProps = parsePomProps(rteRootXml);
  const rteModules = [];
  const rteManaged = new Map(); // "g:a" → { version, scope, via: [module…] }
  const rteUnresolved = [];
  const SCOPE_RANK = { compile: 0, runtime: 1, provided: 2, system: 3 };
  for (const c of rules.coordinates) {
    const mod = { groupId: c.to.groupId, artifactId: c.to.artifactId, version: rteVersion };
    const xml = await read(pomUrl(mod), `rte/${mod.artifactId}.pom`);
    const { deps, unresolved } = parseModuleDependencies(xml, rootProps);
    for (const u of unresolved) rteUnresolved.push(`${mod.artifactId}: ${u}`);
    let counted = 0;
    for (const d of deps) {
      if (d.scope === "test" || d.optional) continue;
      if (d.groupId === "org.egovframe.rte") continue; // 모듈 간 의존은 RTE 자체 버전
      counted++;
      const k = `${d.groupId}:${d.artifactId}`;
      const short = mod.artifactId.replace(/^egovframe-rte-/, "");
      const cur = rteManaged.get(k);
      if (!cur) { rteManaged.set(k, { version: d.version, scope: d.scope, via: [short] }); continue; }
      if (!cur.via.includes(short)) cur.via.push(short);
      if (compareVersions(d.version, cur.version) > 0) cur.version = d.version;
      if ((SCOPE_RANK[d.scope] ?? 9) < (SCOPE_RANK[cur.scope] ?? 9)) cur.scope = d.scope;
    }
    rteModules.push({ artifactId: mod.artifactId, url: pomUrl(mod), sha256: sha256(xml), dependencies: counted });
  }
  if (rteUnresolved.length) throw new Error(`RTE 모듈 pom 에 풀리지 않은 의존성: ${rteUnresolved.slice(0, 5).join(", ")}`);

  const sortedObject = (map, pick = (v) => v) => Object.fromEntries([...map.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([k, v]) => [k, pick(v)]));

  const baseline = {
    schemaVersion: 2,
    generatedBy: "scripts/generate-dependency-baseline.mjs",
    surveyedAt: new Date().toISOString().slice(0, 10),
    repository: REPO,
    sources: [
      { kind: "web", ...web, url: pomUrl(web), sha256: sha256(webXml), managed: w.managed.length },
      { kind: "boot", ...boot, url: pomUrl(boot), sha256: sha256(bootXml), managed: b.managed.length, parent: b.parentCoord },
    ],
    java: 17,
    rte: { version: rteVersion, parentManaged: { web: w.properties["egovframe.rte.version"] ?? null, boot: b.properties["egovframe.rte.version"] ?? null } },
    spring: { framework: w.properties["spring.framework.version"] ?? null, boot: b.parentCoord.version, security: b.properties["spring.security.version"] ?? null },
    properties: { web: w.properties, boot: b.properties },
    managed,
    families: [...families.values()].sort((x, y) => x.groupIdPrefix.localeCompare(y.groupIdPrefix)),
    releaseTrains,
    boot: {
      bom: { ...bootBom, url: pomUrl(bootBom, CENTRAL), sha256: sha256(bootBomXml), direct: bootDirect, imports: bootImports.length },
      imports: bootImports,
      conflicts: bootConflicts.length,
      managed: sortedObject(bootManaged),
    },
    rteTransitive: {
      version: rteVersion,
      root: { artifactId: RTE_ROOT_ARTIFACT, url: pomUrl(rteRoot), sha256: sha256(rteRootXml) },
      modules: rteModules,
      managed: sortedObject(rteManaged, (v) => ({ version: v.version, scope: v.scope, via: [...v.via].sort() })),
    },
  };
  const json = `${JSON.stringify(baseline, null, 2)}\n`;
  fs.writeFileSync(OUT_JSON, json, "utf8");
  console.log(`dependency-baseline.json 생성(${Buffer.byteLength(json)} bytes): 관리 좌표 ${managed.length}종 (web ${w.managed.length}, boot ${b.managed.length}) + 계열 ${baseline.families.length}종, RTE ${rteVersion}, Spring ${baseline.spring.framework}, Boot ${baseline.spring.boot}`);
  console.log(`  Boot BOM ${bootBom.version}: 직접 ${bootDirect} + import ${bootImports.length}종 → 좌표 ${bootManaged.size}종 (충돌 ${bootConflicts.length}건${bootConflicts.length ? `: ${bootConflicts.slice(0, 3).join("; ")}` : ""})`);
  console.log(`  RTE 전이: 모듈 ${rteModules.length}종 → 좌표 ${rteManaged.size}종`);
}

export function compareVersions(a, b) {
  const pa = String(a).match(/^\d+(?:\.\d+)*/)?.[0].split(".").map(Number) ?? [];
  const pb = String(b).match(/^\d+(?:\.\d+)*/)?.[0].split(".").map(Number) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] ?? 0, y = pb[i] ?? 0; if (x !== y) return x < y ? -1 : 1; }
  return 0;
}

const isDirectRun = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isDirectRun) await main();
