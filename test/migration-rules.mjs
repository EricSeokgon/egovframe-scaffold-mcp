// node test/migration-rules.mjs — 전환 규칙 카탈로그 정합 (오프라인)
// catalog/migration-rules.json 이 스키마를 지키고, 대응표의 목적지(좌표·패키지·클래스)가 규칙에 동봉된 5.x 소스 트리 근거와 맞는지,
// 큐레이션(catalog/migration-mapping.json)과 생성물이 어긋나지 않았는지 검증한다. 네트워크 없이 실행된다.
import { readFileSync } from "node:fs";
import { loadMigrationRules, classifyJavaxPackage, versionBelow } from "../dist/index.js";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }

const rules = loadMigrationRules();
const mapping = JSON.parse(readFileSync(new URL("../catalog/migration-mapping.json", import.meta.url), "utf8"));
const baseline = JSON.parse(readFileSync(new URL("../catalog/dependency-baseline.json", import.meta.url), "utf8"));
const classes5 = new Set(rules.evidence.classes5);
const packages5 = new Set(rules.evidence.packages5);

// ── 스키마·출처 ───────────────────────────────────────
assert(rules.schemaVersion === 2, "schemaVersion 2 (v0.33: packages.components 추가, 기존 필드 유지)");
assert(/^\d{4}-\d{2}-\d{2}$/.test(rules.surveyedAt), "surveyedAt 날짜");
assert(rules.source.repository === "eGovFramework/egovframe-runtime" && /^[0-9a-f]{40}$/.test(rules.source.fromCommit) && /^[0-9a-f]{40}$/.test(rules.source.toCommit), "출처 저장소·commit 고정");
assert(rules.source.fromTag === mapping.runtime.fromTag && rules.source.toTag === mapping.runtime.toTag && rules.source.midTag === mapping.runtime.midTag, "태그가 매핑과 일치");
assert(rules.target.runtimeVersion === rules.source.toTag.replace(/^v/, "").replace(/-Final$/, ""), "target.runtimeVersion 이 toTag 와 일치");
assert(rules.target.repositoryUrl.startsWith("https://") && rules.target.legacyRepositoryUrls.every((u) => u.startsWith("http://")), "저장소 URL: 목적지 https, 레거시 http");
assert(rules.target.parents.length === 2 && rules.target.parents.every((p) => /^\d+\.\d+\.\d+$/.test(p.version) && p.version.startsWith("5.")), "5.x parent 2종");
assert(rules.target.webXml.namespace === "https://jakarta.ee/xml/ns/jakartaee" && rules.target.webXml.legacyNamespaces.length >= 2, "web.xml 스키마 규칙");
assert(classes5.size >= 300 && packages5.size >= 50 && rules.evidence.classes.to === classes5.size, `5.x 근거 트리 동봉 (클래스 ${classes5.size}, 패키지 ${packages5.size})`);
assert(rules.evidence.classes.direct + rules.evidence.classes.relocated + rules.evidence.classes.removed <= rules.evidence.classes.from, "클래스 분류 합계 ≤ 3.x 클래스 수");

// ── 좌표 대응표 ───────────────────────────────────────
const { prefix } = rules.packages;
assert(prefix.from === "egovframework.rte." && prefix.to === "org.egovframe.rte.", "패키지 접두어 규칙");
assert(rules.coordinates.length === 18, `RTE 모듈 18종 (got ${rules.coordinates.length})`);
const fromKeys = new Set();
for (const c of rules.coordinates) {
  const expectedTo = `egovframe-rte-${c.module.replace(/\./g, "-")}`;
  assert(c.to.groupId === "org.egovframe.rte" && c.to.artifactId === expectedTo, `${c.module}: to = org.egovframe.rte:${expectedTo}`);
  const era3 = c.from.find((f) => f.era === "3.x");
  assert(era3 && era3.groupId === "egovframework.rte" && era3.artifactId === `egovframework.rte.${c.module}`, `${c.module}: 3.x from 좌표`);
  const era4 = c.from.find((f) => f.era === "4.x");
  assert(era4 && era4.groupId === "org.egovframe.rte" && era4.artifactId === `org.egovframe.rte.${c.module}`, `${c.module}: 4.x from 좌표(점 표기)`);
  for (const f of c.from) { const k = `${f.groupId}:${f.artifactId}`; assert(!fromKeys.has(k), `from 좌표 중복 없음: ${k}`); fromKeys.add(k); }
  assert(packages5.has(`org.egovframe.rte.${c.module}`), `${c.module}: 5.x 패키지 존재`);
}
for (const m of ["fdl.cmmn", "ptl.mvc", "psl.dataaccess", "fdl.idgnr", "fdl.property", "fdl.security", "fdl.crypto", "bat.core"])
  assert(rules.coordinates.some((c) => c.module === m), `핵심 모듈 포함: ${m}`);
assert(rules.removedModules.length === 1 && rules.removedModules[0].module === "spring-modules-validation" && rules.removedModules[0].reason.length > 20, "제거 모듈: spring-modules-validation + 사유");
assert(rules.newModules.length >= 6 && rules.newModules.every((m) => m.to.groupId === "org.egovframe.rte" && m.to.artifactId === `egovframe-rte-${m.module.replace(/\./g, "-")}`), "신규 5.x 모듈 좌표 규칙");
assert(rules.newModules.some((m) => m.to.artifactId === "egovframe-rte-ptl-reactive"), "ptl.reactive(5.x 템플릿이 쓰는 신규 모듈) 포함");

// ── 패키지·클래스 ─────────────────────────────────────
for (const r of rules.packages.renames) {
  assert(r.from.endsWith(".") && r.to.endsWith(".") && r.from !== r.to, `rename 형식: ${r.from} → ${r.to}`);
  assert(packages5.has(r.to.slice(0, -1)), `rename 목적지 패키지 존재: ${r.to}`);
  assert(![...classes5].some((c) => c.startsWith(r.from)), `rename 원본 패키지는 5.x 에 없음: ${r.from}`);
  assert(r.classes > 0, `rename 근거 클래스 수 > 0: ${r.from}`);
}
assert(rules.packages.renames.some((r) => r.from === "org.egovframe.rte.fdl.cryptography." && r.to === "org.egovframe.rte.fdl.crypto."), "cryptography → crypto 포함");
assert(rules.packages.renames.some((r) => r.from === "org.egovframe.rte.fdl.security.securedobject." && r.to === "org.egovframe.rte.fdl.security.secureobject."), "securedobject → secureobject 포함");
for (const m of rules.packages.moves) {
  assert(classes5.has(m.to) && !classes5.has(m.from) && m.legacyFrom.startsWith(prefix.from), `move: ${m.from} → ${m.to}`);
}
const removedSeen = new Set();
for (const r of rules.packages.removed) {
  assert(!classes5.has(r.class), `제거 클래스는 5.x 에 없음: ${r.class}`);
  assert(r.legacyClass === prefix.from + r.class.slice(prefix.to.length), `legacyClass 접두어: ${r.class}`);
  assert(typeof r.reason === "string" && r.reason.length >= 10, `제거 사유: ${r.class}`);
  assert(r.replacement === null || classes5.has(r.replacement), `대체 클래스 존재: ${r.class} → ${r.replacement}`);
  assert(!removedSeen.has(r.class), `제거 목록 중복 없음: ${r.class}`);
  removedSeen.add(r.class);
}
for (const must of ["org.egovframe.rte.psl.dataaccess.mapper.Mapper", "org.egovframe.rte.fdl.cmmn.AbstractServiceImpl", "org.egovframe.rte.ptl.mvc.bind.annotation.CommandMap", "org.egovframe.rte.fdl.security.config.EgovSecurityNameHandler"])
  assert(removedSeen.has(must), `제거 목록 포함: ${must}`);
// 큐레이션의 모든 removedClasses 규칙이 실제로 쓰였는지 (생성기가 보장하지만 손편집 대비)
for (const rule of mapping.removedClasses) {
  const re = rule.match.includes("*") ? new RegExp(`^${rule.match.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`) : null;
  assert(rules.packages.removed.some((r) => (re ? re.test(r.class) : r.class === rule.match)), `매핑 규칙 사용됨: ${rule.match}`);
}
// 자주 쓰는 5.x 클래스가 근거 트리에 있는지(웹 템플릿이 참조하는 것들)
for (const c of ["org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl", "org.egovframe.rte.psl.dataaccess.mapper.EgovMapper", "org.egovframe.rte.psl.dataaccess.util.EgovMap", "org.egovframe.rte.fdl.idgnr.impl.EgovTableIdGnrServiceImpl", "org.egovframe.rte.ptl.mvc.tags.ui.pagination.PaginationInfo", "org.egovframe.rte.fdl.security.config.EgovSecurityConfiguration", "org.egovframe.rte.fdl.crypto.config.EgovCryptoConfiguration", "org.egovframe.rte.fdl.access.config.EgovAccessConfiguration"])
  assert(classes5.has(c), `5.x 클래스 존재: ${c}`);

// ── 공통컴포넌트 대응표 (v0.33) ──────────────────────
{
  const c = rules.packages.components;
  const src = rules.source.components;
  assert(c && src && src.repository === "eGovFramework/egovframe-common-components" && src.fromTag === mapping.components.fromTag && src.toTag === mapping.components.toTag && /^[0-9a-f]{40}$/.test(src.fromCommit) && /^[0-9a-f]{40}$/.test(src.toCommit), "공통컴포넌트 출처·태그·commit");
  assert(c.prefix === "egovframework.com." && c.evidence.from >= 1000 && c.evidence.to >= 1000 && c.evidence.removed === c.removed.length && c.evidence.moved === c.moves.length, `공통컴포넌트 근거(${c.evidence.from}→${c.evidence.to}, 제거 ${c.evidence.removed}·이동 ${c.evidence.moved}·추가 ${c.evidence.added})`);
  assert(c.removed.every((r) => r.class.startsWith(c.prefix) && typeof r.reason === "string" && r.reason.length >= 10 && (r.replacement === null || r.replacement.startsWith(c.prefix))), "제거 클래스 형식·사유");
  assert(c.moves.every((m) => m.from.startsWith(c.prefix) && m.to.startsWith(c.prefix) && m.from !== m.to && m.from.split(".").pop() === m.to.split(".").pop()), "이동 클래스는 단순명이 같고 패키지만 다름");
  const rmSet = new Set(c.removed.map((r) => r.class));
  assert(rmSet.size === c.removed.length && !c.moves.some((m) => rmSet.has(m.from)), "제거·이동 목록 중복 없음");
  for (const [k, v] of Object.entries(mapping.components.replacements)) {
    const r = c.removed.find((x) => x.class === k);
    assert(r && r.replacement === v.replacement && r.reason === v.reason, `큐레이션 대체 반영: ${k}`);
  }
  assert(rmSet.has("egovframework.com.cmm.util.EgovMybaitsUtil") && c.moves.some((m) => m.from === "egovframework.com.utl.sys.fsm.service.FileSystemUtils" && m.to === "egovframework.com.cmm.service.FileSystemUtils"), "조사 시점 대표 항목(EgovMybaitsUtil 제거, FileSystemUtils 이동)");
  assert(!c.removed.some((r) => classes5.has(r.class)) && !rules.packages.removed.some((r) => rmSet.has(r.class)), "RTE 목록과 섞이지 않음");
}

// ── Jakarta ───────────────────────────────────────────
assert(JSON.stringify(rules.jakarta.packages) === JSON.stringify(mapping.jakarta.packages) && JSON.stringify(rules.jakarta.artifacts) === JSON.stringify(mapping.jakarta.artifacts), "Jakarta 규칙이 매핑과 동일");
const pk = new Set();
for (const p of rules.jakarta.packages) {
  assert(p.to === `jakarta.${p.from.slice("javax.".length)}`, `규칙적 대응: ${p.from} → ${p.to}`);
  assert(!pk.has(p.from), `패키지 중복 없음: ${p.from}`);
  pk.add(p.from);
}
for (const must of ["javax.servlet", "javax.validation", "javax.persistence", "javax.annotation", "javax.inject", "javax.transaction", "javax.xml.bind", "javax.mail", "javax.websocket"])
  assert(pk.has(must), `Jakarta 패키지 포함: ${must}`);
for (const jdk of ["javax.sql", "javax.xml.parsers", "javax.xml.transform", "javax.xml.xpath", "javax.crypto", "javax.naming", "javax.net", "javax.swing", "javax.imageio", "javax.management", "javax.security.auth", "javax.security.cert", "javax.script", "javax.sound", "javax.print", "javax.tools", "javax.lang.model", "javax.annotation.processing", "javax.transaction.xa", "javax.accessibility", "javax.smartcardio", "javax.rmi.ssl"])
  assert(classifyJavaxPackage(jdk, rules) === null, `JDK 내장 패키지 제외: ${jdk}`);
const ak = new Set();
for (const a of rules.jakarta.artifacts) {
  const k = `${a.from.groupId}:${a.from.artifactId}`;
  assert(!ak.has(k), `artifact 중복 없음: ${k}`);
  ak.add(k);
  assert(/^(jakarta\.|org\.glassfish|org\.eclipse)/.test(a.to.groupId) && /^\d+\.\d+/.test(a.toVersion), `artifact 목적지 형식: ${k} → ${a.to.groupId}:${a.to.artifactId}:${a.toVersion}`);
  assert(versionBelow(a.toVersion, "2.0.0") === false, `Jakarta 좌표 버전은 2.x 이상(네임스페이스 전환 이후): ${k}`);
  const managed = baseline.managed.find((m) => m.groupId === a.to.groupId && m.artifactId === a.to.artifactId);
  if (managed) assert(versionBelow(a.toVersion, managed.version) === false, `Jakarta 목적지 버전이 공식 parent 기준 이상: ${a.to.artifactId} ${a.toVersion} ≥ ${managed.version}`);
}
for (const must of ["javax.servlet:javax.servlet-api", "javax.servlet:servlet-api", "javax.servlet:jstl", "javax.servlet.jsp.jstl:jstl-api", "javax.validation:validation-api", "javax.annotation:javax.annotation-api", "javax.inject:javax.inject", "org.glassfish:javax.json"])
  assert(ak.has(must), `Jakarta artifact 포함: ${must}`);

// ── 라이브러리·네임스페이스·빌드 ──────────────────────
for (const l of rules.libraries) {
  assert(l.match.groupId && l.match.artifactId && l.reason.length >= 10, `library 규칙 형식: ${l.match.groupId}:${l.match.artifactId}`);
  if (l.match.versionBelow) assert(/^\d+\.\d+\.\d+$/.test(l.match.versionBelow), `versionBelow 형식: ${l.match.groupId}:${l.match.artifactId}`);
}
for (const must of ["commons-dbcp:commons-dbcp", "log4j:log4j", "commons-fileupload:commons-fileupload", "org.apache.tiles:tiles-*", "egovframework.rte:spring-modules-validation"])
  assert(rules.libraries.some((l) => `${l.match.groupId}:${l.match.artifactId}` === must), `library 포함: ${must}`);
assert(rules.xmlNamespaces.length >= 3 && rules.xmlNamespaces.every((x) => x.uri.startsWith("http://") && x.reason.length >= 10), "XML 네임스페이스 규칙 형식");
for (const x of rules.xmlNamespaces) if (x.replacement.startsWith("org.egovframe.rte.")) assert(classes5.has(x.replacement), `네임스페이스 대체 클래스 존재: ${x.replacement}`);
for (const must of ["egov-security", "egov-access", "egov-crypto"]) assert(rules.xmlNamespaces.some((x) => x.uri.endsWith(`/schema/${must}`)), `네임스페이스 포함: ${must}`);
assert(rules.build.javaRelease === 17 && rules.build.springMinimum === "6.0.0" && rules.build.springVersionProperties.includes("spring.maven.artifact.version"), "빌드 규칙(Java 17·Spring 6·속성명)");

if (process.exitCode) console.error(`migration-rules FAIL (${n} assertions)`); else console.log(`migration-rules OK (${n} assertions)`);
