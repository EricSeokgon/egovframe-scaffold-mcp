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
 *   v1.3 (5.1.0): parent 5.1.0 은 RTE 모듈을 직접 나열하지 않고 BOM org.egovframe.rte:egovframe-rte-root 를 import 한다.
 *     그 BOM 의 dependencyManagement(직접 항목 + 하위 BOM import)를 parent 관리 목록으로 한 단계 풀고, RTE 전이 모듈 목록도 BOM 에서 읽는다.
 *     Boot parent 의 버전 속성(spring-framework.version 등)은 상속한 spring-boot-dependencies 의 같은 이름 속성을 재정의하므로 함께 반영한다.
 *     parent 버전별 기준 파일: --out catalog/dependency-baseline-5.1.json (기본 파일 catalog/dependency-baseline.json 은 전환 목표 5.0.2 기준)
 *
 * 사용법:
 *   node scripts/generate-dependency-baseline.mjs                       # 고정 버전 내려받아 생성
 *   node scripts/generate-dependency-baseline.mjs --web 5.0.2 --boot 5.0.2
 *   node scripts/generate-dependency-baseline.mjs --web 5.1.0 --boot 5.1.0 --out catalog/dependency-baseline-5.1.json
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

// v1.6: 표준프레임워크 저장소의 일시 장애(5xx·끊김·지연)는 3회까지 다시 받는다
async function fetchText(url, timeoutMs = 60_000) {
  for (let i = 1; ; i++) {
    try { return await fetchTextOnce(url, timeoutMs); } catch (e) {
      const transient = e?.name === "AbortError" || /^5\d\d /.test(String(e?.message)) || /fetch failed|ECONNRESET|ETIMEDOUT/.test(String(e?.message) + String(e?.cause?.code));
      if (!transient || i >= 3) throw e;
      console.error(`재시도 ${i + 1}/3: ${url} (${e?.message ?? e})`);
      await new Promise((r) => setTimeout(r, 5_000 * i));
    }
  }
}
async function fetchTextOnce(url, timeoutMs) {
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
export function parsePomProps(xml, extraProps = new Map(), overrideProps = new Map()) {
  const props = new Map(extraProps);
  const propsBlock = xml.match(/<properties>([\s\S]*?)<\/properties>/);
  if (propsBlock) for (const m of propsBlock[1].matchAll(/<([\w.\-]+)>\s*([^<]*?)\s*<\/\1>/g)) props.set(m[1], m[2]);
  const self = xml.replace(/<parent>[\s\S]*?<\/parent>/, "").replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/, "").replace(/<dependencies>[\s\S]*?<\/dependencies>/, "");
  const ownVersion = self.match(/<version>\s*([^<\s]+)\s*<\/version>/)?.[1] ?? xml.match(/<parent>[\s\S]*?<version>\s*([^<\s]+)[\s\S]*?<\/parent>/)?.[1];
  if (ownVersion) { props.set("project.version", ownVersion); props.set("pom.version", ownVersion); }
  const ownGroup = self.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1] ?? xml.match(/<parent>[\s\S]*?<groupId>\s*([^<\s]+)[\s\S]*?<\/parent>/)?.[1];
  if (ownGroup) props.set("project.groupId", ownGroup);
  for (const [k, v] of overrideProps) props.set(k, v); // 자식 pom(예: Boot parent)이 재정의한 속성
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
export function parseParentPom(xml, { strict = true, extraProps = new Map(), overrideProps = new Map() } = {}) {
  const props = parsePomProps(xml, extraProps, overrideProps);
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
export function parseModuleDependencies(xml, extraProps = new Map(), managedVersions = new Map()) {
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
    // v1.3: 5.1.0 모듈 pom 은 버전을 상위(egovframe-rte-root)의 dependencyManagement 에 맡긴다
    if (entry.version === null) entry.version = managedVersions.get(`${entry.groupId}:${entry.artifactId}`) ?? null;
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
  const outJson = arg("--out") ? path.resolve(arg("--out")) : OUT_JSON;
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
  // RTE 기준 버전: --rte > parent 가 관리하는 RTE 버전(전환 목표보다 새로우면) > 전환 규칙 목표
  const parentRte = w.properties["egovframe.rte.version"] ?? b.properties["egovframe.rte.version"] ?? null;
  const rteVersion = arg("--rte") ?? (parentRte && compareVersions(parentRte, rules.target.runtimeVersion) > 0 ? parentRte : rules.target.runtimeVersion);

  // v1.3: parent 5.1.0 은 egovframe-rte-root BOM 을 import 한다 — 그 관리 목록을 parent 관리 목록으로 한 단계 푼다
  const rootImport = [...w.managed, ...b.managed].find((e) => e.groupId === "org.egovframe.rte" && e.artifactId === RTE_ROOT_ARTIFACT && e.type === "pom" && e.scope === "import");
  let rteRootBom = null;
  if (rootImport) {
    const xml = await read(pomUrl({ groupId: "org.egovframe.rte", artifactId: RTE_ROOT_ARTIFACT, version: rootImport.version }), `rte/${RTE_ROOT_ARTIFACT}-${rootImport.version}.bom.pom`);
    const parsed = parseParentPom(xml, { strict: false });
    if (parsed.unresolved.length) throw new Error(`${RTE_ROOT_ARTIFACT} ${rootImport.version} 에 풀리지 않은 항목: ${parsed.unresolved.slice(0, 5).join(", ")}`);
    rteRootBom = { version: rootImport.version, xml, parsed };
    const via = (list) => list.some((e) => e === rootImport || (e.artifactId === RTE_ROOT_ARTIFACT && e.scope === "import"));
    if (via(w.managed)) w.managed.push(...parsed.managed.map((e) => ({ ...e, via: RTE_ROOT_ARTIFACT })));
    if (via(b.managed)) b.managed.push(...parsed.managed.map((e) => ({ ...e, via: RTE_ROOT_ARTIFACT })));
    for (const [k, v] of Object.entries(parsed.properties)) if (!(k in w.properties)) w.properties[k] = v;
  }

  // 두 parent 의 관리 목록을 합친다. 같은 좌표가 양쪽에 있으면 높은 버전을 기준으로 삼고 출처별 버전을 적는다.
  // v1.6: Maven 의 우선순위대로 출처별 실제 버전을 정한다 — parent 의 직접 선언 > (boot: 상속한 spring-boot-dependencies) > import BOM(선언 순서, 먼저 나온 쪽).
  //   5.1.0 재배포(2026-10-26 확인)에서 web parent 가 Jakarta EE 9 버전(servlet 5.0·annotation 2.0.0 등)을 직접 선언해 rte-root BOM 의 EE 10 버전을 덮는데,
  //   예전 생성기는 BOM 값과 높은 쪽을 골라 web 기준이 실제보다 높았다. boot 는 상속한 Boot BOM 이 자기 import(rte-root)보다 우선한다(Maven 3 import 규칙, 실측 트리로 확인).
  const effectiveOf = (list) => {
    const eff = new Map();
    for (const e of list) if (!e.via) { const k = `${e.groupId}:${e.artifactId}`; if (!eff.has(k)) eff.set(k, e.version); }
    return eff;
  };
  const effWeb = effectiveOf(w.managed), effBoot = effectiveOf(b.managed);
  const byKey = new Map();
  const add = (list, source) => {
    for (const e of list) {
      const k = `${e.groupId}:${e.artifactId}`;
      const cur = byKey.get(k);
      if (!cur) { byKey.set(k, { ...e, sources: [source] }); continue; }
      if (!cur.sources.includes(source)) cur.sources.push(source);
      if (compareVersions(e.version, cur.version) > 0) cur.version = e.version;
    }
  };
  add(w.managed.filter((e) => !e.via), "web");
  add(b.managed.filter((e) => !e.via), "boot");
  add(w.managed.filter((e) => e.via), "web");
  add(b.managed.filter((e) => e.via), "boot");
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
  // Boot parent 가 재정의한 속성(spring-framework.version 등)은 spring-boot-dependencies 의 같은 이름 속성보다 우선한다
  const bb = parseParentPom(bootBomXml, { strict: false, overrideProps: new Map(Object.entries(b.properties)) });
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
    // v1.3: -egov.N 재빌드(예: spring-integration-bom 6.5.10-egov.1)는 표준프레임워크 저장소에만 있다
    const bomRepo = /-egov\.\d+$/.test(e.version) ? REPO : CENTRAL;
    const xml = await read(pomUrl(e, bomRepo), file);
    let parsed = parseParentPom(xml, { strict: false });
    // 풀리지 않은 속성이 있고 상위 pom 이 있으면 상위 속성을 한 번 합쳐 다시 읽는다
    if (parsed.unresolved.length && parsed.parentCoord?.groupId && parsed.parentCoord.version) {
      const pc = { groupId: parsed.parentCoord.groupId, artifactId: parsed.parentCoord.artifactId, version: parsed.parentCoord.version };
      try {
        const parentXml = await read(pomUrl(pc, /-egov\.\d+$/.test(pc.version) ? REPO : CENTRAL), `bom/${pc.artifactId}-${pc.version}.parent.pom`);
        parsed = parseParentPom(xml, { strict: false, extraProps: parsePomProps(parentXml) });
      } catch (err) { console.warn(`  상위 pom 조회 실패(${pc.artifactId}): ${err.message}`); }
    }
    let members = 0;
    for (const m of parsed.managed) { if (m.type === "pom" && m.scope === "import") continue; putBoot(m, e.artifactId); members++; }
    bootImports.push({ groupId: e.groupId, artifactId: e.artifactId, version: e.version, url: pomUrl(e, bomRepo), sha256: sha256(xml), members, ...(parsed.unresolved.length ? { unresolved: parsed.unresolved.length } : {}) });
  }
  const bootDirect = bb.managed.filter((e) => !(e.type === "pom" && e.scope === "import")).length;

  // v1.6: 출처별 실제 버전 — web: 직접 > import(선언 순서), boot: 직접 > Boot BOM > import(선언 순서)
  const firstVia = (list, k) => list.find((e) => e.via && `${e.groupId}:${e.artifactId}` === k)?.version;
  for (const [k, e] of byKey) {
    const vb = {};
    if (e.sources.includes("web")) vb.web = effWeb.get(k) ?? firstVia(w.managed, k) ?? e.version;
    if (e.sources.includes("boot")) vb.boot = effBoot.get(k) ?? bootManaged.get(k) ?? firstVia(b.managed, k) ?? e.version;
    if (e.groupId === "org.egovframe.rte") { for (const s of Object.keys(vb)) if (compareVersions(rteVersion, vb[s]) > 0) vb[s] = rteVersion; }
    const vals = Object.values(vb);
    e.version = vals.reduce((a, x) => (compareVersions(x, a) > 0 ? x : a), vals[0] ?? e.version);
    if (new Set(vals).size > 1) e.versionBySource = vb; else delete e.versionBySource;
  }

  // v1.6: import BOM 의 실제 구성원 — 계열 규칙(groupId → 한 버전)은 같은 groupId 에 버전 줄이 다른 BOM 이 둘이면 틀린다
  //   (io.micrometer: micrometer-bom 1.15.x 와 micrometer-tracing-bom 1.5.x), 구성원 버전이 BOM 번호와 다를 수도 있다(jackson-annotations 2.22 ← jackson-bom 2.22.3).
  //   출처별 선언 순서(order)를 적어 두고, 판정은 그 순서로 처음 구성원으로 가진 BOM 의 버전을 쓴다.
  const readBomMembers = async (e) => {
    const bomRepo = /-egov\.\d+$/.test(e.version) ? REPO : CENTRAL;
    const xml = await read(pomUrl(e, bomRepo), `bom/${e.artifactId}-${e.version}.pom`);
    let parsed = parseParentPom(xml, { strict: false });
    if (parsed.unresolved.length && parsed.parentCoord?.groupId && parsed.parentCoord.version) {
      const pc = { groupId: parsed.parentCoord.groupId, artifactId: parsed.parentCoord.artifactId, version: parsed.parentCoord.version };
      try { parsed = parseParentPom(xml, { strict: false, extraProps: parsePomProps(await read(pomUrl(pc, /-egov\.\d+$/.test(pc.version) ? REPO : CENTRAL), `bom/${pc.artifactId}-${pc.version}.parent.pom`)) }); } catch { /* 상위 없음 */ }
    }
    const members = {};
    for (const m of parsed.managed) if (!(m.type === "pom" && m.scope === "import") && !/\$\{/.test(m.version)) members[`${m.groupId}:${m.artifactId}`] ??= m.version;
    return members;
  };
  const bomMembers = new Map(); // "g:a:v" → { bom, groupIdPrefix, matchSubgroups, sources, order, members }
  for (const [source, list] of [["web", w.managed], ["boot", b.managed]]) {
    let i = 0;
    // 직접 선언한 import 가 먼저, 그다음 rte-root 안의 import(선언 순서)
    for (const e of [...list.filter((x) => !x.via), ...list.filter((x) => x.via)]) {
      if (!(e.type === "pom" && e.scope === "import") || /^\d{4}\.\d+/.test(e.version) || e.artifactId === RTE_ROOT_ARTIFACT) continue;
      const id = `${e.groupId}:${e.artifactId}:${e.version}`;
      let cur = bomMembers.get(id);
      if (!cur) {
        const prefix = e.artifactId === "jackson-bom" ? "com.fasterxml.jackson" : e.groupId;
        cur = { bom: id, groupIdPrefix: prefix, matchSubgroups: prefix === "com.fasterxml.jackson", sources: [], order: {}, members: await readBomMembers(e) };
        bomMembers.set(id, cur);
      }
      if (!cur.sources.includes(source)) { cur.sources.push(source); cur.order[source] = i++; }
    }
  }

  // ── v0.34: RTE 모듈 전이 의존성 (표준프레임워크 Maven 저장소) ───────────────────────────────
  const rteRoot = { groupId: "org.egovframe.rte", artifactId: RTE_ROOT_ARTIFACT, version: rteVersion };
  const rteRootXml = rteRootBom && rteRootBom.version === rteVersion ? rteRootBom.xml : await read(pomUrl(rteRoot), `rte/${RTE_ROOT_ARTIFACT}.pom`);
  const rootProps = parsePomProps(rteRootXml);
  // 상위 BOM 이 관리하는 버전(모듈 pom 의 버전 없는 의존성용): 직접 항목 + 하위 BOM import 한 단계(Central 또는 표준프레임워크 저장소)
  const rootManagedVersions = new Map();
  if (rteRootBom) {
    for (const e of rteRootBom.parsed.managed) if (!(e.type === "pom" && e.scope === "import")) rootManagedVersions.set(`${e.groupId}:${e.artifactId}`, e.version);
    for (const e of rteRootBom.parsed.managed) {
      if (!(e.type === "pom" && e.scope === "import")) continue;
      const bomRepo = /-egov\.\d+$/.test(e.version) ? REPO : CENTRAL;
      const xml = await read(pomUrl(e, bomRepo), `bom/${e.artifactId}-${e.version}.pom`);
      let parsed = parseParentPom(xml, { strict: false });
      if (parsed.unresolved.length && parsed.parentCoord?.groupId && parsed.parentCoord.version) {
        const pc = { groupId: parsed.parentCoord.groupId, artifactId: parsed.parentCoord.artifactId, version: parsed.parentCoord.version };
        try { parsed = parseParentPom(xml, { strict: false, extraProps: parsePomProps(await read(pomUrl(pc, /-egov\.\d+$/.test(pc.version) ? REPO : CENTRAL), `bom/${pc.artifactId}-${pc.version}.parent.pom`)) }); } catch { /* 상위 없음 */ }
      }
      for (const m of parsed.managed) if (!(m.type === "pom" && m.scope === "import") && !rootManagedVersions.has(`${m.groupId}:${m.artifactId}`)) rootManagedVersions.set(`${m.groupId}:${m.artifactId}`, m.version);
    }
    for (const c of rteRootBom.parsed.managed) if (c.groupId === "org.egovframe.rte") rootManagedVersions.set(`${c.groupId}:${c.artifactId}`, rteVersion);
  }
  const rteModules = [];
  const rteManaged = new Map(); // "g:a" → { version, scope, via: [module…] }
  const rteUnresolved = [];
  const SCOPE_RANK = { compile: 0, runtime: 1, provided: 2, system: 3 };
  // 모듈 목록: BOM 이 있으면 BOM 의 RTE 모듈 전체(5.1.0 의 AI 모듈 포함), 없으면 전환 규칙의 5.x 좌표
  const rteModuleCoords = rteRootBom
    ? rteRootBom.parsed.managed.filter((e) => e.groupId === "org.egovframe.rte" && e.artifactId !== RTE_ROOT_ARTIFACT && !e.type).map((e) => ({ groupId: e.groupId, artifactId: e.artifactId }))
    : rules.coordinates.map((c) => c.to);
  for (const c of rteModuleCoords) {
    const mod = { groupId: c.groupId, artifactId: c.artifactId, version: rteVersion };
    const xml = await read(pomUrl(mod), `rte/${mod.artifactId}.pom`);
    const { deps, unresolved } = parseModuleDependencies(xml, rootProps, rootManagedVersions);
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
    rte: { version: rteVersion, parentManaged: { web: w.properties["egovframe.rte.version"] ?? null, boot: b.properties["egovframe.rte.version"] ?? null }, ...(rteRootBom ? { bom: { artifactId: RTE_ROOT_ARTIFACT, version: rteRootBom.version, url: pomUrl({ groupId: "org.egovframe.rte", artifactId: RTE_ROOT_ARTIFACT, version: rteRootBom.version }), sha256: sha256(rteRootBom.xml), managed: rteRootBom.parsed.managed.length } } : {}) },
    spring: { framework: w.properties["spring.framework.version"] ?? b.properties["spring-framework.version"] ?? null, boot: b.parentCoord.version, security: b.properties["spring.security.version"] ?? b.properties["spring-security.version"] ?? w.properties["spring.security.version"] ?? null },
    properties: { web: w.properties, boot: b.properties },
    managed,
    families: [...families.values()].sort((x, y) => x.groupIdPrefix.localeCompare(y.groupIdPrefix)),
    // v1.6: import BOM 의 구성원(계열 규칙보다 우선)
    bomMembers: [...bomMembers.values()].sort((x, y) => x.bom.localeCompare(y.bom)).map((x) => ({ ...x, members: Object.fromEntries(Object.entries(x.members).sort((p, q) => p[0].localeCompare(q[0]))) })),
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
  fs.writeFileSync(outJson, json, "utf8");
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
