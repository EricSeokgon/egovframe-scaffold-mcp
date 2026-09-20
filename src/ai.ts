// AI RAG 계층 조립 (add_ai_components) — 카탈로그·계획·pom 마커 삽입/원복.
import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";
import { withFileTransaction } from "./file-transaction.js";
import { COMPONENTS_DOWNLOAD_TIMEOUT_MS, fetchWithTimeout, sha256 } from "./shared.js";
import { MANIFEST_FILE, readManifest, type Manifest } from "./manifest.js";

/* ------------------------------------------------------------------ */
/* AI 컴포넌트 조립 (M1 미리보기 + M2 실조립) — 설계: docs/design-ai-components.md */
/* 소스: eGovFramework/egovframe-ai-rag (Spring AI·LangChain4j RAG 샘플)   */
/* ------------------------------------------------------------------ */

export const AI_STACKS = ["spring-ai", "langchain4j"] as const;

export interface AiMavenDependency {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: string;
  optional?: boolean;
  exclusions?: { groupId: string; artifactId: string }[];
}

export interface AiCopyGroup {
  /** 모듈 상대 경로. "a -> b"는 조립 시 이름 변경 복사 */
  paths: string[];
  files: number;
}

export interface AiComponent {
  id: string;
  stack: (typeof AI_STACKS)[number];
  kind: "ai";
  name: string;
  description: string;
  modulePath: string;
  vectorStore: string;
  conflictsWith: string[];
  requires: { java: string; parent: string };
  copyGroups: Record<"source" | "config" | "ui" | "infra" | "tests", AiCopyGroup>;
  approxFiles: number;
  mavenDependencies: AiMavenDependency[];
  mavenProperties: Record<string, string>;
  prerequisites: string[];
}

export interface AiCatalog {
  schemaVersion: number;
  source: { repo: string; branch: string; surveyedAt: string };
  note: string;
  components: AiComponent[];
}

const AI_CATALOG_URL = new URL("../catalog/ai-components.json", import.meta.url);

/** AI 카탈로그 로드 + 무결성 검증 (id 중복, conflictsWith 대상 존재, stack 유일) */
export function loadAiCatalog(): AiCatalog {
  const catalog = JSON.parse(fs.readFileSync(AI_CATALOG_URL, "utf-8")) as AiCatalog;
  const ids = new Set<string>();
  const stacks = new Set<string>();
  for (const c of catalog.components) {
    if (ids.has(c.id)) throw new Error(`AI 카탈로그 오류: 중복 id '${c.id}'`);
    ids.add(c.id);
    if (stacks.has(c.stack)) throw new Error(`AI 카탈로그 오류: 중복 stack '${c.stack}'`);
    stacks.add(c.stack);
  }
  for (const c of catalog.components)
    for (const x of c.conflictsWith)
      if (!ids.has(x)) throw new Error(`AI 카탈로그 오류: '${c.id}'의 conflictsWith '${x}'가 카탈로그에 없습니다`);
  return catalog;
}

export interface AddAiComponentsOptions {
  projectDir: string;
  stack: (typeof AI_STACKS)[number];
  includeInfra?: boolean;
  includeUi?: boolean;
  includeTests?: boolean;
  ref?: string;
  dryRun?: boolean;
  /** fault-injection 회귀 테스트 전용. MCP 스키마에는 노출하지 않는다. */
  faultInjection?: "after-files" | "after-pom";
}

export interface AiPlanResult {
  projectDir: string;
  component: { id: string; name: string; vectorStore: string };
  compatibility: {
    pomFound: boolean;
    required: string;
    parentFound: string | null;
    parentOk: boolean | null;
    warnings: string[];
  };
  dependencyChanges: { toAdd: string[]; alreadyPresent: string[] };
  copyPlan: { group: string; files: number; paths: string[] }[];
  totalFiles: number;
  prerequisites: string[];
  nextSteps: string[];
  dryRun: boolean;
}

/** pom 마커 주석 — 제거 시 이 구간만 걷어내 원복한다 */
const AI_POM_MARKER = (id: string, kind: "deps" | "props", pos: "start" | "end") =>
  `<!-- egovframe-scaffold-mcp:ai:${id}:${kind}:${pos} -->`;

interface AiPlanInternal {
  comp: AiComponent;
  projectDir: string;
  compatibility: AiPlanResult["compatibility"];
  toAddDeps: AiMavenDependency[];
  alreadyPresent: string[];
  toAddProps: Record<string, string>;
  groups: (keyof AiComponent["copyGroups"])[];
}

const depCoord = (d: AiMavenDependency) =>
  `${d.groupId}:${d.artifactId}${d.version ? ":" + d.version : ""}${d.scope ? " (" + d.scope + ")" : ""}`;

/** 공통 게이트·의존성 diff·복사 그룹 계산 (dryRun/실조립 공용) */
function computeAiPlan(opts: AddAiComponentsOptions): AiPlanInternal {
  if (!AI_STACKS.includes(opts.stack))
    throw new Error(`stack은 ${AI_STACKS.join("|")} 중 하나여야 합니다: ${String(opts.stack)}`);

  const catalog = loadAiCatalog();
  const comp = catalog.components.find((c) => c.stack === opts.stack)!;
  const projectDir = path.resolve(opts.projectDir);

  // 매니페스트 게이트: 동일/배타 스택 설치 여부
  const manifest = readManifest(projectDir);
  if (manifest) {
    if (manifest.components[comp.id])
      throw new Error(`'${comp.id}'가 이미 설치되어 있습니다 (매니페스트 기준)`);
    for (const x of comp.conflictsWith)
      if (manifest.components[x])
        throw new Error(
          `상호 배타 컴포넌트 '${x}'가 이미 설치되어 있습니다 — 두 AI 스택은 같은 패키지(com.example.chat)·UI 경로를 사용합니다. 먼저 remove_egovframe_components로 제거하세요`,
        );
  }

  // 호환성 게이트: 부모 POM 좌표 확인 + 의존성/프로퍼티 diff
  const warnings: string[] = [];
  const pomPath = path.join(projectDir, "pom.xml");
  const pomFound = fs.existsSync(pomPath);
  let parentFound: string | null = null;
  let parentOk: boolean | null = null;
  const toAddDeps: AiMavenDependency[] = [];
  const alreadyPresent: string[] = [];
  const toAddProps: Record<string, string> = {};
  if (pomFound) {
    const pom = fs.readFileSync(pomPath, "utf-8");
    const pm = pom.match(/<parent>[\s\S]*?<\/parent>/);
    if (pm) {
      const a = pm[0].match(/<artifactId>([^<]*)<\/artifactId>/)?.[1]?.trim();
      const v = pm[0].match(/<version>([^<]*)<\/version>/)?.[1]?.trim();
      parentFound = a ? `${a}:${v ?? "?"}` : null;
    }
    const [reqA, reqV] = comp.requires.parent.split(":");
    parentOk = parentFound !== null && parentFound.startsWith(`${reqA}:`);
    if (!parentOk)
      warnings.push(
        `부모 POM이 '${comp.requires.parent}'가 아닙니다(발견: ${parentFound ?? "없음"}) — Boot 기반 템플릿(simple-backend)에서 지원합니다`,
      );
    else if (parentFound !== comp.requires.parent)
      warnings.push(`부모 POM 버전이 다릅니다(요구 ${reqV}, 발견 ${parentFound}) — BOM 관리 버전 차이를 확인하세요`);
    for (const d of comp.mavenDependencies) {
      if (pom.includes(`<artifactId>${d.artifactId}</artifactId>`)) alreadyPresent.push(depCoord(d));
      else toAddDeps.push(d);
    }
    for (const [k, v] of Object.entries(comp.mavenProperties))
      if (!pom.includes(`<${k}>`)) toAddProps[k] = v;
  } else {
    warnings.push("pom.xml이 없습니다 — Boot 백엔드 프로젝트 루트 경로인지 확인하세요");
  }

  // 복사 그룹: source·config 필수, ui/infra/tests는 옵션
  const groups: (keyof AiComponent["copyGroups"])[] = ["source", "config"];
  if (opts.includeUi !== false) groups.push("ui");
  if (opts.includeInfra !== false) groups.push("infra");
  if (opts.includeTests === true) groups.push("tests");

  return {
    comp,
    projectDir,
    compatibility: { pomFound, required: comp.requires.parent, parentFound, parentOk, warnings },
    toAddDeps,
    alreadyPresent,
    toAddProps,
    groups,
  };
}

/** AI 컴포넌트 조립 계획 — dryRun 미리보기 (네트워크 불필요) */
export async function planAiComponents(opts: AddAiComponentsOptions): Promise<AiPlanResult> {
  const p = computeAiPlan(opts);
  const copyPlan = p.groups.map((g) => ({
    group: g,
    files: p.comp.copyGroups[g].files,
    paths: p.comp.copyGroups[g].paths,
  }));
  return {
    projectDir: p.projectDir,
    component: { id: p.comp.id, name: p.comp.name, vectorStore: p.comp.vectorStore },
    compatibility: p.compatibility,
    dependencyChanges: { toAdd: p.toAddDeps.map(depCoord), alreadyPresent: p.alreadyPresent },
    copyPlan,
    totalFiles: copyPlan.reduce((n, g) => n + g.files, 0),
    prerequisites: p.comp.prerequisites,
    nextSteps: ["미리보기 모드입니다. 실제 조립하려면 dryRun 없이 다시 호출하세요."],
    dryRun: true,
  };
}

/** 프로세스 수명 동안 AI 샘플 zip을 1회만 내려받기 위한 캐시 */
let aiZipCache: { key: string; zip: AdmZip } | null = null;

async function downloadAiZip(repo: string, branch: string): Promise<AdmZip> {
  const key = `${repo}@${branch}`;
  if (aiZipCache && aiZipCache.key === key) return aiZipCache.zip;
  const zipUrl = `https://codeload.github.com/${repo}/zip/${branch}`;
  const res = await fetchWithTimeout(zipUrl, COMPONENTS_DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) throw new Error(`AI 샘플 저장소 다운로드 실패 (${res.status}): ${zipUrl}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  aiZipCache = { key, zip };
  return zip;
}

/** copyGroups 경로("src" 또는 "src -> dest")를 zip 상대경로 → 대상 상대경로 매핑으로 해석 */
function mapAiEntry(relInModule: string, groupPaths: string[]): string | null {
  for (const spec of groupPaths) {
    const [src, dest] = spec.split("->").map((s) => s.trim());
    const target = dest ?? src;
    if (src.endsWith("/")) {
      if (relInModule.startsWith(src)) return target + relInModule.slice(src.length);
    } else if (relInModule === src) {
      return target;
    }
  }
  return null;
}

/** XML 의존성 블록 직렬화 (exclusions·scope·optional 보존) */
function depToXml(d: AiMavenDependency, indent = "        "): string {
  const i2 = indent + "    ";
  const lines = [`${indent}<dependency>`, `${i2}<groupId>${d.groupId}</groupId>`, `${i2}<artifactId>${d.artifactId}</artifactId>`];
  if (d.version) lines.push(`${i2}<version>${d.version}</version>`);
  if (d.scope) lines.push(`${i2}<scope>${d.scope}</scope>`);
  if (d.optional) lines.push(`${i2}<optional>true</optional>`);
  if (d.exclusions?.length) {
    lines.push(`${i2}<exclusions>`);
    for (const e of d.exclusions)
      lines.push(`${i2}    <exclusion>`, `${i2}        <groupId>${e.groupId}</groupId>`, `${i2}        <artifactId>${e.artifactId}</artifactId>`, `${i2}    </exclusion>`);
    lines.push(`${i2}</exclusions>`);
  }
  lines.push(`${indent}</dependency>`);
  return lines.join("\n");
}

/** dependencyManagement 밖의 프로젝트 직속 </dependencies> 위치를 찾는다 */
export function findProjectDependenciesClose(pom: string): number {
  const dmStart = pom.indexOf("<dependencyManagement>");
  const dmEnd = pom.indexOf("</dependencyManagement>");
  let idx = -1;
  const re = /<\/dependencies>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pom)) !== null) {
    if (dmStart >= 0 && m.index > dmStart && m.index < dmEnd + 24) continue; // dependencyManagement 내부
    idx = m.index;
    break;
  }
  return idx;
}

export interface AddAiResult extends AiPlanResult {
  copiedFiles: number;
  pomChanged: boolean;
  pomBackup: string | null;
}

export const AI_POM_BACKUP = "pom.xml.bak-ai";

/**
 * AI 컴포넌트 실조립 (M2).
 * - 파일 복사: 전체 사전 충돌 검사 후 하나라도 충돌하면 아무것도 쓰지 않고 거부
 * - pom 병합: 누락 좌표만 마커 주석 구간으로 삽입(기존 항목 불변), 병합 전 pom.xml.bak-ai 백업
 * - 설정 프로필화: application.yml → application-ai.yml 복사 (기존 설정 파일은 수정하지 않음)
 * - 매니페스트 기록: remove_egovframe_components가 파일과 pom 삽입분을 함께 정리
 * - transaction: 파일·POM 백업·매니페스트 중 어느 단계가 실패해도 호출 전 상태로 롤백
 */
export async function addAiComponents(opts: AddAiComponentsOptions): Promise<AddAiResult> {
  if (opts.dryRun === true) {
    const plan = await planAiComponents(opts);
    return { ...plan, copiedFiles: 0, pomChanged: false, pomBackup: null };
  }

  const p = computeAiPlan(opts);
  const { comp, projectDir } = p;

  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`대상 프로젝트 디렉터리가 없습니다: ${projectDir} — 먼저 create_egovframe_project로 생성하세요`);
  if (!p.compatibility.pomFound)
    throw new Error(`pom.xml이 없습니다: ${projectDir} — Boot 백엔드 프로젝트 루트에서 실행하세요`);
  if (p.compatibility.parentOk === false)
    throw new Error(
      `부모 POM 불일치: 요구 '${comp.requires.parent}', 발견 '${p.compatibility.parentFound ?? "없음"}' — egovframe-boot-starter-parent 기반 Boot 프로젝트만 지원합니다 (dryRun으로 진단 가능)`,
    );

  // ---- 다운로드 & 파일 계획 ----
  const catalog = loadAiCatalog();
  const zip = await downloadAiZip(catalog.source.repo, opts.ref ?? catalog.source.branch);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  const modPrefix = rootPrefix + comp.modulePath + "/";

  const plan: { entry: AdmZip.IZipEntry; destRel: string; group: string }[] = [];
  for (const e of entries) {
    if (!e.entryName.startsWith(modPrefix)) continue;
    const relInModule = e.entryName.slice(modPrefix.length);
    for (const g of p.groups) {
      const destRel = mapAiEntry(relInModule, comp.copyGroups[g].paths);
      if (destRel !== null) {
        plan.push({ entry: e, destRel, group: g });
        break;
      }
    }
  }
  if (plan.length === 0)
    throw new Error(`조립할 파일을 찾지 못했습니다 — 카탈로그(${catalog.source.surveyedAt})와 저장소 구조가 달라졌을 수 있습니다. npm run generate:ai-catalog로 재생성하세요`);

  // ---- 전체 사전 충돌 검사 (원자적 거부) ----
  const conflicts = plan.filter((f) => fs.existsSync(path.join(projectDir, f.destRel))).map((f) => f.destRel);
  if (conflicts.length > 0)
    throw new Error(
      `기존 파일과 충돌하여 조립을 거부합니다 (${conflicts.length}개): ${conflicts.slice(0, 10).join(", ")}${conflicts.length > 10 ? " 외" : ""} — 아무 파일도 쓰지 않았습니다`,
    );
  const pomPath = path.join(projectDir, "pom.xml");
  const backupPath = path.join(projectDir, AI_POM_BACKUP);
  if ((p.toAddDeps.length > 0 || Object.keys(p.toAddProps).length > 0) && fs.existsSync(backupPath))
    throw new Error(`pom 백업(${AI_POM_BACKUP})이 이미 있습니다 — 이전 조립 잔여물을 정리한 뒤 다시 시도하세요`);

  // ---- POM·매니페스트를 메모리에서 완성해 모든 검증을 쓰기 전에 끝낸다. ----
  let pomChanged = false;
  const pomBefore = fs.readFileSync(pomPath, "utf-8");
  let nextPom = pomBefore;
  if (p.toAddDeps.length > 0 || Object.keys(p.toAddProps).length > 0) {
    if (p.toAddDeps.length > 0) {
      const close = findProjectDependenciesClose(nextPom);
      if (close < 0) throw new Error("pom.xml에서 <dependencies> 블록을 찾지 못했습니다");
      const block = [
        `        ${AI_POM_MARKER(comp.id, "deps", "start")}`,
        ...p.toAddDeps.map((d) => depToXml(d)),
        `        ${AI_POM_MARKER(comp.id, "deps", "end")}`,
        "    ",
      ].join("\n");
      nextPom = nextPom.slice(0, close) + block + nextPom.slice(close);
    }
    if (Object.keys(p.toAddProps).length > 0) {
      const pClose = nextPom.indexOf("</properties>");
      if (pClose < 0) throw new Error("pom.xml에서 <properties> 블록을 찾지 못했습니다");
      const block = [
        `        ${AI_POM_MARKER(comp.id, "props", "start")}`,
        ...Object.entries(p.toAddProps).map(([k, v]) => `        <${k}>${v}</${k}>`),
        `        ${AI_POM_MARKER(comp.id, "props", "end")}`,
        "    ",
      ].join("\n");
      nextPom = nextPom.slice(0, pClose) + block + nextPom.slice(pClose);
    }
    pomChanged = true;
  }

  // ---- 매니페스트 계획 ----
  const manifest: Manifest = readManifest(projectDir) ?? {
    schemaVersion: 3,
    source: { repo: catalog.source.repo, branch: catalog.source.branch },
    components: {},
  };
  const hashes = Object.fromEntries(plan.map((f) => {
    const h = sha256(f.entry.getData());
    return [f.destRel, { hash: h, srcHash: h }];
  }));
  manifest.components[comp.id] = {
    installedAt: new Date().toISOString(),
    files: plan.map((f) => f.destRel),
    hashes,
    sqlScripts: [],
    pom: pomChanged
      ? { backup: AI_POM_BACKUP, addedDeps: p.toAddDeps.map((d) => d.artifactId), addedProps: Object.keys(p.toAddProps) }
      : undefined,
  };
  manifest.schemaVersion = 3;
  const manifestContent = JSON.stringify(manifest, null, 2) + "\n";

  // ---- 파일·POM·매니페스트를 하나의 공통 transaction으로 반영 ----
  await withFileTransaction(projectDir, "AI 조립", async (transaction) => {
    for (const f of plan)
      transaction.writeFile(f.destRel, f.entry.getData(), { mustNotExist: true });

    if (opts.faultInjection === "after-files")
      throw new Error("AI assembly fault injection: after-files");

    if (pomChanged) {
      transaction.writeFile(AI_POM_BACKUP, pomBefore, { mustNotExist: true });
      transaction.writeFile("pom.xml", nextPom);
    }

    if (opts.faultInjection === "after-pom")
      throw new Error("AI assembly fault injection: after-pom");

    transaction.writeFile(MANIFEST_FILE, manifestContent);
  });

  const copyPlan = p.groups.map((g) => ({
    group: g as string,
    files: plan.filter((f) => f.group === g).length,
    paths: comp.copyGroups[g].paths,
  }));
  return {
    projectDir,
    component: { id: comp.id, name: comp.name, vectorStore: comp.vectorStore },
    compatibility: p.compatibility,
    dependencyChanges: { toAdd: p.toAddDeps.map(depCoord), alreadyPresent: p.alreadyPresent },
    copyPlan,
    totalFiles: plan.length,
    copiedFiles: plan.length,
    pomChanged,
    pomBackup: pomChanged ? AI_POM_BACKUP : null,
    prerequisites: comp.prerequisites,
    nextSteps: [
      "Ollama(>=0.17.1) 설치 및 LLM 모델 준비 (폐쇄망 절차는 egovframe-ai-rag README 참조)",
      "ONNX 임베딩 모델 익스포트·배치",
      `docker compose -f docker-compose.ai.yml up -d 로 벡터 저장소(${comp.vectorStore}) 기동`,
      "spring.profiles.active=ai 로 애플리케이션 실행 (application-ai.yml 사용)",
      "브라우저에서 채팅 UI 접속 (경로·포트는 application-ai.yml 참조)",
    ],
    dryRun: false,
  };
}

/** AI 컴포넌트의 pom 삽입분(마커 구간)을 걷어낸다 — remove 시 호출 */
export function stripAiPomAdditions(projectDir: string, componentId: string): boolean {
  const pomPath = path.join(projectDir, "pom.xml");
  if (!fs.existsSync(pomPath)) return false;
  let pom = fs.readFileSync(pomPath, "utf-8");
  let changed = false;
  for (const kind of ["deps", "props"] as const) {
    const start = pom.indexOf(AI_POM_MARKER(componentId, kind, "start"));
    const endMark = AI_POM_MARKER(componentId, kind, "end");
    const end = pom.indexOf(endMark);
    if (start >= 0 && end > start) {
      // 마커 라인 앞 들여쓰기부터 end 마커 라인 끝(개행 포함)까지 제거
      const lineStart = pom.lastIndexOf("\n", start) + 1;
      let lineEnd = end + endMark.length;
      while (lineEnd < pom.length && pom[lineEnd] !== "\n") lineEnd++;
      lineEnd++; // 개행 포함
      pom = pom.slice(0, lineStart) + pom.slice(lineEnd);
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(pomPath, pom);
  const backup = path.join(projectDir, AI_POM_BACKUP);
  if (fs.existsSync(backup)) fs.unlinkSync(backup);
  return changed;
}
