// SPDX 2.3 JSON (v0.43) — CycloneDX 문서와 SPDX 2.3 문서 사이의 변환.
//   cdxToSpdx: generate_egovframe_sbom(bomFormat="spdx-json") 의 출력. 패키지·DEPENDS_ON 관계·purl externalRefs·supplier·
//              creationInfo(creators·created)·체크섬·선언 라이선스·OSV 권고(SECURITY advisory)·egovframe 판정(annotations).
//   spdxToCdx: check_egovframe_sbom 이 SPDX 입력을 읽을 때 — 같은 점검 규칙(최소 요소 7종·재판정·비교)을 그대로 쓰도록
//              내부 CycloneDX 모양으로 옮긴다. 최소 요소의 대응:
//                공급자 = PackageSupplier(없으면 PackageOriginator) · 구성요소명 = PackageName · 버전 = PackageVersion
//                고유식별자 = externalRefs purl·cpe·swid · 의존관계 = 그 패키지가 주어인 DEPENDS_ON(의존이 없으면 NONE)
//                작성자 = creationInfo.creators 의 Person·Organization · 생성 시각 = creationInfo.created
//   의존이 없는 패키지는 `DEPENDS_ON NONE` 으로 적어(SPDX 2.3 §11.1) "의존 없음"과 "모름"을 구분한다.
import { randomUUID } from "node:crypto";
import type { SbomComponent, SbomDocument } from "./sbom.js";
import { SERVER_VERSION } from "./version.js";

export const SPDX_VERSION = "SPDX-2.3";
export const DEFAULT_SPDX_PATH = "sbom/bom.spdx.json";
const TOOL = `egovframe-scaffold-mcp-${SERVER_VERSION}`;

export interface SpdxChecksum { algorithm: string; checksumValue: string }
export interface SpdxExternalRef { referenceCategory: string; referenceType: string; referenceLocator: string; comment?: string }
export interface SpdxAnnotation { annotationDate: string; annotationType: "OTHER" | "REVIEW"; annotator: string; comment: string }
export interface SpdxPackage {
  SPDXID: string;
  name: string;
  versionInfo?: string;
  supplier?: string;
  originator?: string;
  downloadLocation: string;
  filesAnalyzed: boolean;
  homepage?: string;
  description?: string;
  checksums?: SpdxChecksum[];
  licenseConcluded?: string;
  licenseDeclared?: string;
  copyrightText?: string;
  externalRefs?: SpdxExternalRef[];
  primaryPackagePurpose?: string;
  annotations?: SpdxAnnotation[];
  [k: string]: unknown;
}
export interface SpdxRelationship { spdxElementId: string; relationshipType: string; relatedSpdxElement: string; comment?: string }
export interface SpdxDocument {
  spdxVersion: string;
  dataLicense: string;
  SPDXID: string;
  name: string;
  documentNamespace: string;
  creationInfo: { created: string; creators: string[]; licenseListVersion?: string; comment?: string };
  documentDescribes?: string[];
  packages?: SpdxPackage[];
  relationships?: SpdxRelationship[];
  hasExtractedLicensingInfos?: { licenseId: string; extractedText: string; name?: string; seeAlsos?: string[] }[];
  [k: string]: unknown;
}

export const isSpdxDocument = (doc: unknown): doc is SpdxDocument =>
  !!doc && typeof doc === "object" && typeof (doc as { spdxVersion?: unknown }).spdxVersion === "string" && /^SPDX-2\.\d+$/.test((doc as { spdxVersion: string }).spdxVersion);

// ── 공용 ─────────────────────────────────────────────────
const HASH_TO_SPDX: Record<string, string> = {
  "MD5": "MD5", "SHA-1": "SHA1", "SHA-256": "SHA256", "SHA-384": "SHA384", "SHA-512": "SHA512",
  "SHA3-256": "SHA3-256", "SHA3-384": "SHA3-384", "SHA3-512": "SHA3-512",
  "BLAKE2b-256": "BLAKE2b-256", "BLAKE2b-384": "BLAKE2b-384", "BLAKE2b-512": "BLAKE2b-512", "BLAKE3": "BLAKE3",
};
const HASH_FROM_SPDX = Object.fromEntries(Object.entries(HASH_TO_SPDX).map(([k, v]) => [v, k]));

/** SPDX 의 created 형식(YYYY-MM-DDThh:mm:ssZ). 해석할 수 없으면 null. */
export function spdxTimestamp(v: string | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}
/** `Organization: 이름 (메일)` 형식의 이름 부분. NOASSERTION·빈 값은 null. */
export function spdxAgent(v: string | undefined): { kind: "Person" | "Organization" | "Tool"; name: string; email?: string } | null {
  if (!v || v === "NOASSERTION" || v === "NONE") return null;
  const m = v.match(/^\s*(Person|Organization|Tool)\s*:\s*(.*?)\s*(?:\(([^()]*)\))?\s*$/);
  if (!m || !m[2]) return null;
  return { kind: m[1] as "Person" | "Organization" | "Tool", name: m[2], ...(m[3] ? { email: m[3] } : {}) };
}
/** SPDX 의 이름·메일 값에 쓸 수 없는 괄호·줄바꿈을 정리한다. */
const agentText = (s: string) => s.replace(/[()\r\n]/g, " ").replace(/\s+/g, " ").trim();
const agent = (kind: "Person" | "Organization", name: string, email?: string) => `${kind}: ${agentText(name)}${email ? ` (${agentText(email)})` : ""}`;

const idOf = (s: string) => s.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const licenseRefOf = (s: string) => `LicenseRef-${idOf(s)}`;

// ── CycloneDX → SPDX ─────────────────────────────────────
export interface CdxToSpdxOptions { now?: () => number; namespaceBase?: string }
export interface CdxToSpdxResult { doc: SpdxDocument; notes: string[] }

/** CycloneDX 문서를 SPDX 2.3 JSON 으로 옮긴다(순수 함수, 같은 입력이면 같은 출력 — serialNumber 가 urn:uuid 일 때). */
export function cdxToSpdx(bom: SbomDocument, opts: CdxToSpdxOptions = {}): CdxToSpdxResult {
  const notes: string[] = [];
  const md = bom.metadata ?? {};
  const primary = md.component;
  const nowIso = spdxTimestamp(new Date((opts.now ?? Date.now)()).toISOString())!;
  let created = spdxTimestamp(md.timestamp);
  if (!created) { created = nowIso; notes.push("CycloneDX metadata.timestamp 가 없어 SPDX creationInfo.created 에 변환 시각을 넣었습니다(최소 요소 '생성 시각' 판정이 원본과 다를 수 있음)."); }

  // creators: 작성자(metadata.authors·manufacturer) → Organization, 생성 도구 → Tool
  const creators: string[] = [];
  const pushCreator = (c: string) => { if (!creators.includes(c)) creators.push(c); };
  for (const a of (md.authors as { name?: string; email?: string }[] | undefined) ?? []) {
    if (a?.name) pushCreator(agent("Organization", a.name, a.email));
    else if (a?.email) pushCreator(agent("Organization", a.email));
  }
  const mdManufacturer = (md.manufacturer as { name?: string } | undefined)?.name;
  if (mdManufacturer) pushCreator(agent("Organization", mdManufacturer));
  const tools = md.tools as { components?: { name?: string; version?: string }[] } | { name?: string; version?: string }[] | undefined;
  for (const t of Array.isArray(tools) ? tools : tools?.components ?? []) if (t?.name) pushCreator(`Tool: ${idOf(t.name)}${t.version ? `-${t.version}` : ""}`);
  pushCreator(`Tool: ${TOOL}`);

  // SPDXID: bom-ref 를 안전한 문자로, 겹치면 번호
  const used = new Set<string>(["SPDXRef-DOCUMENT"]);
  const refToId = new Map<string, string>();
  const newId = (base: string) => { let id = `SPDXRef-Package-${idOf(base)}`; let n = 2; while (used.has(id)) id = `SPDXRef-Package-${idOf(base)}-${n++}`; used.add(id); return id; };

  const extracted = new Map<string, { licenseId: string; extractedText: string; name: string; seeAlsos?: string[] }>();
  const licenseExpr = (c: SbomComponent): string | undefined => {
    const parts: string[] = [];
    for (const l of (c.licenses as { license?: { id?: string; name?: string; url?: string }; expression?: string }[] | undefined) ?? []) {
      if (l.expression) parts.push(/\s/.test(l.expression) ? `(${l.expression})` : l.expression);
      else if (l.license?.id) parts.push(l.license.id);
      else if (l.license?.name) {
        const id = licenseRefOf(l.license.name);
        if (!extracted.has(id)) extracted.set(id, { licenseId: id, name: l.license.name, extractedText: `${l.license.name}${l.license.url ? ` — ${l.license.url}` : ""} (CycloneDX 라이선스 이름에서 옮김, 본문 미포함)`, ...(l.license.url ? { seeAlsos: [l.license.url] } : {}) });
        parts.push(id);
      }
    }
    return parts.length ? [...new Set(parts)].join(" OR ") : undefined;
  };

  const vulnsByRef = new Map<string, { id: string; url?: string }[]>();
  for (const v of bom.vulnerabilities ?? []) for (const a of v.affects ?? []) {
    const list = vulnsByRef.get(a.ref) ?? [];
    if (!list.some((x) => x.id === v.id)) list.push({ id: v.id, url: v.source?.url });
    vulnsByRef.set(a.ref, list);
  }

  const toPackage = (c: SbomComponent, isPrimary: boolean): SpdxPackage => {
    const id = newId(c["bom-ref"] ?? `${c.group ? `${c.group}-` : ""}${c.name}-${c.version ?? ""}`);
    if (c["bom-ref"]) refToId.set(c["bom-ref"], id);
    const supplierName = (c.supplier as { name?: string } | undefined)?.name ?? (typeof c.publisher === "string" ? c.publisher : undefined) ?? (isPrimary ? (md.supplier as { name?: string } | undefined)?.name : undefined);
    const manufacturer = (c.manufacturer as { name?: string } | undefined)?.name ?? (isPrimary ? mdManufacturer : undefined);
    const author = ((c.authors as { name?: string }[] | undefined) ?? []).find((a) => a?.name)?.name ?? (typeof c.author === "string" ? c.author : undefined);
    const refs: SpdxExternalRef[] = [];
    if (c.purl) refs.push({ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: c.purl });
    if (typeof c.cpe === "string" && c.cpe) refs.push({ referenceCategory: "SECURITY", referenceType: c.cpe.startsWith("cpe:2.3:") ? "cpe23Type" : "cpe22Type", referenceLocator: c.cpe });
    const swid = (c.swid as { tagId?: string } | undefined)?.tagId;
    if (swid) refs.push({ referenceCategory: "SECURITY", referenceType: "swid", referenceLocator: swid });
    for (const v of (c["bom-ref"] ? vulnsByRef.get(c["bom-ref"]) : undefined) ?? []) refs.push({ referenceCategory: "SECURITY", referenceType: "advisory", referenceLocator: v.url ?? `https://osv.dev/vulnerability/${v.id}`, comment: v.id });
    const checksums = (c.hashes ?? []).filter((h) => HASH_TO_SPDX[h.alg] && /^[0-9a-fA-F]+$/.test(h.content)).map((h) => ({ algorithm: HASH_TO_SPDX[h.alg], checksumValue: h.content.toLowerCase() }));
    const homepage = ((c.externalReferences as { type?: string; url?: string }[] | undefined) ?? []).find((r) => r.type === "website" && r.url && /^https?:\/\//.test(r.url))?.url;
    const annotations = (c.properties ?? []).filter((p) => p.name.startsWith("egovframe:")).map((p) => ({ annotationDate: created!, annotationType: "OTHER" as const, annotator: `Tool: ${TOOL}`, comment: `${p.name}=${p.value}` }));
    const declared = licenseExpr(c);
    return {
      SPDXID: id,
      name: c.name,
      ...(c.version ? { versionInfo: c.version } : {}),
      supplier: supplierName ? agent("Organization", supplierName) : "NOASSERTION",
      ...(manufacturer ? { originator: agent("Organization", manufacturer) } : author ? { originator: agent("Person", author) } : {}),
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      ...(homepage ? { homepage } : {}),
      ...(typeof c.description === "string" && c.description ? { description: c.description } : {}),
      ...(checksums.length ? { checksums } : {}),
      licenseConcluded: "NOASSERTION",
      licenseDeclared: declared ?? "NOASSERTION",
      copyrightText: "NOASSERTION",
      ...(refs.length ? { externalRefs: refs } : {}),
      primaryPackagePurpose: isPrimary ? "APPLICATION" : c.type === "framework" ? "FRAMEWORK" : c.type === "application" ? "APPLICATION" : "LIBRARY",
      ...(annotations.length ? { annotations } : {}),
    };
  };

  const packages: SpdxPackage[] = [];
  const primaryPkg = primary ? toPackage(primary, true) : null;
  if (primaryPkg) packages.push(primaryPkg);
  for (const c of bom.components ?? []) packages.push(toPackage(c, false));
  if (!primaryPkg) notes.push("CycloneDX metadata.component(주 component)가 없어 DESCRIBES 관계를 모든 최상위 패키지 대신 문서 자체로만 둡니다.");

  const relationships: SpdxRelationship[] = [];
  if (primaryPkg) relationships.push({ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: primaryPkg.SPDXID });
  let dangling = 0;
  for (const d of bom.dependencies ?? []) {
    const from = refToId.get(d.ref);
    if (!from) { dangling++; continue; }
    const targets = (d.dependsOn ?? []).map((r) => refToId.get(r)).filter((x): x is string => { if (!x) dangling++; return !!x; });
    if (!targets.length) relationships.push({ spdxElementId: from, relationshipType: "DEPENDS_ON", relatedSpdxElement: "NONE" });
    for (const t of [...new Set(targets)]) relationships.push({ spdxElementId: from, relationshipType: "DEPENDS_ON", relatedSpdxElement: t });
  }
  if (dangling) notes.push(`dependencies[] 에서 component 로 찾을 수 없는 bom-ref ${dangling}건은 관계에서 뺐습니다.`);

  const uuid = bom.serialNumber?.match(/^urn:uuid:([0-9a-fA-F-]{36})$/)?.[1] ?? randomUUID();
  const docName = primary ? `${primary.group ? `${primary.group}:` : ""}${primary.name}${primary.version ? `@${primary.version}` : ""}` : "sbom";
  const base = (opts.namespaceBase ?? "https://spdx.org/spdxdocs").replace(/\/+$/, "");
  const doc: SpdxDocument = {
    spdxVersion: SPDX_VERSION,
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: docName,
    documentNamespace: `${base}/${idOf(docName)}-${uuid}`,
    creationInfo: { created, creators, comment: `CycloneDX ${bom.specVersion}${bom.serialNumber ? ` ${bom.serialNumber}` : ""} 에서 ${TOOL} 이 변환` },
    ...(primaryPkg ? { documentDescribes: [primaryPkg.SPDXID] } : {}),
    packages,
    relationships,
    ...(extracted.size ? { hasExtractedLicensingInfos: [...extracted.values()] } : {}),
  };
  return { doc, notes };
}

// ── SPDX → CycloneDX(점검용 내부 모양) ───────────────────
const REVERSED_DEPENDENCY = new Set(["DEPENDENCY_OF", "DEV_DEPENDENCY_OF", "BUILD_DEPENDENCY_OF", "RUNTIME_DEPENDENCY_OF", "OPTIONAL_DEPENDENCY_OF", "PROVIDED_DEPENDENCY_OF", "TEST_DEPENDENCY_OF"]);

export interface SpdxToCdxResult { bom: SbomDocument; notes: string[] }

/** SPDX 2.x JSON 을 점검용 CycloneDX 모양으로 옮긴다. bom-ref 는 SPDXID 를 그대로 쓴다. */
export function spdxToCdx(doc: SpdxDocument): SpdxToCdxResult {
  const notes: string[] = [];
  const pkgs = doc.packages ?? [];
  const rels = doc.relationships ?? [];
  const described = [
    ...rels.filter((r) => r.spdxElementId === doc.SPDXID && r.relationshipType === "DESCRIBES").map((r) => r.relatedSpdxElement),
    ...rels.filter((r) => r.relatedSpdxElement === doc.SPDXID && r.relationshipType === "DESCRIBED_BY").map((r) => r.spdxElementId),
    ...(doc.documentDescribes ?? []),
  ].filter((id, i, a) => a.indexOf(id) === i && pkgs.some((p) => p.SPDXID === id));
  const primaryId = described[0];
  if (described.length > 1) notes.push(`DESCRIBES 대상이 ${described.length}개라 첫 패키지(${primaryId})를 주 component 로 봅니다.`);
  if (!primaryId) notes.push("DESCRIBES 관계로 문서가 설명하는 패키지를 찾지 못했습니다 — 주 component 없이 점검합니다.");

  const toComponent = (p: SpdxPackage): SbomComponent => {
    const refs = p.externalRefs ?? [];
    const purl = refs.find((r) => r.referenceType === "purl")?.referenceLocator;
    const cpe = refs.find((r) => r.referenceType === "cpe23Type" || r.referenceType === "cpe22Type")?.referenceLocator;
    const swid = refs.find((r) => r.referenceType === "swid")?.referenceLocator;
    const group = purl?.match(/^pkg:maven\/([^/@?#]+)\//)?.[1];
    const sup = spdxAgent(p.supplier);
    const ori = spdxAgent(p.originator);
    const props = (p.annotations ?? []).map((a) => a.comment?.match(/^(egovframe:[\w.-]+)=(.*)$/s)).filter((m): m is RegExpMatchArray => !!m).map((m) => ({ name: m[1], value: m[2] }));
    return {
      type: p.primaryPackagePurpose === "APPLICATION" ? "application" : p.primaryPackagePurpose === "FRAMEWORK" ? "framework" : "library",
      "bom-ref": p.SPDXID,
      ...(group ? { group: decodeURIComponent(group) } : {}),
      name: p.name,
      ...(p.versionInfo ? { version: p.versionInfo } : {}),
      ...(purl ? { purl } : {}),
      ...(cpe ? { cpe } : {}),
      ...(swid ? { swid: { tagId: swid } } : {}),
      ...(sup ? { supplier: { name: sup.name } } : {}),
      ...(ori?.kind === "Organization" ? { manufacturer: { name: ori.name } } : ori?.kind === "Person" ? { authors: [{ name: ori.name }] } : {}),
      ...(p.checksums?.length ? { hashes: p.checksums.filter((c) => HASH_FROM_SPDX[c.algorithm]).map((c) => ({ alg: HASH_FROM_SPDX[c.algorithm], content: c.checksumValue })) } : {}),
      ...(props.length ? { properties: props } : {}),
    };
  };

  const primaryPkg = pkgs.find((p) => p.SPDXID === primaryId);
  const components = pkgs.filter((p) => p.SPDXID !== primaryId).map(toComponent);
  const known = new Set(pkgs.map((p) => p.SPDXID));

  // 의존관계: 패키지가 주어인 DEPENDS_ON(NONE = 의존 없음, NOASSERTION = 모름)과 *_DEPENDENCY_OF(뒤집어서)
  const deps = new Map<string, Set<string>>();
  let unknownDeps = 0;
  for (const r of rels) {
    if (r.relationshipType === "DEPENDS_ON" && known.has(r.spdxElementId)) {
      if (r.relatedSpdxElement === "NOASSERTION") { unknownDeps++; continue; }
      const set = deps.get(r.spdxElementId) ?? new Set<string>();
      if (r.relatedSpdxElement !== "NONE" && known.has(r.relatedSpdxElement)) set.add(r.relatedSpdxElement);
      deps.set(r.spdxElementId, set);
    } else if (REVERSED_DEPENDENCY.has(r.relationshipType) && known.has(r.relatedSpdxElement) && known.has(r.spdxElementId)) {
      const set = deps.get(r.relatedSpdxElement) ?? new Set<string>();
      set.add(r.spdxElementId);
      deps.set(r.relatedSpdxElement, set);
    }
  }
  if (unknownDeps) notes.push(`DEPENDS_ON NOASSERTION ${unknownDeps}건은 의존관계를 모르는 것으로 봅니다.`);

  const vulnerabilities: NonNullable<SbomDocument["vulnerabilities"]> = [];
  for (const p of pkgs) for (const r of p.externalRefs ?? []) {
    if (r.referenceType !== "advisory") continue;
    const id = r.comment?.trim() || r.referenceLocator.replace(/\/+$/, "").split("/").pop() || r.referenceLocator;
    const v = vulnerabilities.find((x) => x.id === id);
    if (v) { if (!v.affects.some((a) => a.ref === p.SPDXID)) v.affects.push({ ref: p.SPDXID }); }
    else vulnerabilities.push({ id, source: { name: /osv\.dev/.test(r.referenceLocator) ? "OSV" : "SPDX advisory", url: r.referenceLocator }, affects: [{ ref: p.SPDXID }] });
  }

  const authors: { name: string; email?: string }[] = [];
  const toolList: { name: string; version?: string }[] = [];
  for (const c of doc.creationInfo?.creators ?? []) {
    const a = spdxAgent(c);
    if (!a) continue;
    if (a.kind === "Tool") { const m = a.name.match(/^(.*?)-(\d[\w.+-]*)$/); toolList.push(m ? { name: m[1], version: m[2] } : { name: a.name }); }
    else authors.push({ name: a.name, ...(a.email ? { email: a.email } : {}) });
  }
  const primaryComp = primaryPkg ? toComponent(primaryPkg) : undefined;
  const nsUuid = doc.documentNamespace?.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/)?.[1];
  const bom: SbomDocument = {
    bomFormat: "CycloneDX",
    specVersion: doc.spdxVersion,
    ...(nsUuid ? { serialNumber: `urn:uuid:${nsUuid}` } : {}),
    version: 1,
    metadata: {
      ...(doc.creationInfo?.created ? { timestamp: doc.creationInfo.created } : {}),
      ...(toolList.length ? { tools: { components: toolList.map((t) => ({ type: "application", ...t })) } } : {}),
      ...(authors.length ? { authors } : {}),
      ...(primaryComp ? { component: primaryComp, ...(primaryComp.supplier ? { supplier: primaryComp.supplier } : {}) } : {}),
    },
    components,
    dependencies: [...deps.entries()].map(([ref, set]) => ({ ref, dependsOn: [...set] })),
    ...(vulnerabilities.length ? { vulnerabilities } : {}),
  };
  return { bom, notes };
}
