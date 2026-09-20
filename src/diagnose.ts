// 기존 프로젝트 진단·리포트 (diagnose_egovframe_project, generate_egovframe_report).
import * as fs from "node:fs";
import * as path from "node:path";
import { loadCatalog } from "./catalog.js";
import { DOCS_REPO } from "./guide.js";

// ── 프로젝트 진단 (v0.14.0) ─────────────────────────────
export interface DiagnoseResult {
  projectDir: string;
  isEgovProject: boolean;
  buildSystem: "maven" | "gradle" | "unknown";
  egovVersion: string | null;
  database: string | null;
  detectedComponents: { id: string; name: string; matchedPrefix: string }[];
  aiLayer: boolean;
  hasManifest: boolean;
  issues: string[];
  suggestions: string[];
}

/** 기존 프로젝트를 읽기 전용으로 스캔해 구성·설치 컴포넌트·설정 문제를 진단한다. (디스크 변경 없음) */
export function diagnoseProject(opts: { projectDir: string }): DiagnoseResult {
  const dir = opts.projectDir;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
    throw new Error(`프로젝트 디렉터리가 없습니다: ${dir}`);

  const readIf = (p: string): string | null => {
    try { return fs.readFileSync(path.join(dir, p), "utf-8"); } catch { return null; }
  };
  const existsRel = (p: string): boolean => fs.existsSync(path.join(dir, p));

  const pom = readIf("pom.xml");
  const gradle = readIf("build.gradle") ?? readIf("build.gradle.kts");
  const buildSystem: DiagnoseResult["buildSystem"] = pom ? "maven" : gradle ? "gradle" : "unknown";
  const buildText = pom ?? gradle ?? "";
  const isEgovProject = /egovframe/i.test(buildText);

  // eGovFrame RTE 버전 추정 (best-effort)
  let egovVersion: string | null = null;
  const vpats: RegExp[] = [
    /<(?:org\.egovframe\.rte\.version|egovframe[.\w]*version|version\.egovframe[.\w]*)>\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i,
    /org\.egovframe\.rte[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i,
    /egovframe[^\n]*?rte[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i,
  ];
  for (const re of vpats) { const m = buildText.match(re); if (m) { egovVersion = m[1]; break; } }

  // Globals.DbType 탐지
  let database: string | null = null;
  const dbFiles = [
    "src/main/resources/application.properties",
    "src/main/resources/globals.properties",
    "src/main/resources/egovframework/egovProps/globals.properties",
    "src/main/resources/application.yml",
    "src/main/resources/application.yaml",
  ];
  for (const f of dbFiles) {
    const t = readIf(f);
    if (t) { const m = t.match(/Globals\.DbType\s*[:=]\s*["']?([A-Za-z]+)/); if (m) { database = m[1]; break; } }
  }

  // 카탈로그 pathPrefixes 지문으로 설치 컴포넌트 감지
  const catalog = loadCatalog();
  const detectedComponents: DiagnoseResult["detectedComponents"] = [];
  const detectedIds = new Set<string>();
  for (const c of catalog.components) {
    const prefix = c.pathPrefixes.find((p) => p.includes("/java/")) ?? c.pathPrefixes[0];
    if (!prefix || !existsRel(prefix)) continue;
    try {
      if (fs.readdirSync(path.join(dir, prefix)).length > 0) {
        detectedComponents.push({ id: c.id, name: c.name, matchedPrefix: prefix });
        detectedIds.add(c.id);
      }
    } catch { /* skip unreadable */ }
  }

  const aiLayer = existsRel("src/main/resources/application-ai.yml") || existsRel("src/main/resources/egovframework/ai");
  const hasManifest = existsRel(".egovframe-components.json");

  const issues: string[] = [];
  const suggestions: string[] = [];
  if (buildSystem === "unknown") issues.push("빌드 파일(pom.xml·build.gradle)을 찾지 못했습니다 — eGovFrame 프로젝트가 아닐 수 있습니다.");
  else if (!isEgovProject) issues.push("빌드 파일에서 egovframe 좌표를 찾지 못했습니다.");
  if (isEgovProject && !egovVersion) issues.push("eGovFrame(RTE) 버전을 자동 검출하지 못했습니다 — pom/gradle 수동 확인 권장.");
  if (detectedComponents.length > 0 && !database) issues.push("공통컴포넌트가 감지됐으나 Globals.DbType이 설정되어 있지 않습니다.");
  for (const c of catalog.components) {
    if (!detectedIds.has(c.id)) continue;
    for (const dep of c.dependsOn) {
      if (!detectedIds.has(dep)) issues.push(`컴포넌트 '${c.id}'가 의존하는 '${dep}'가 감지되지 않았습니다.`);
    }
  }
  const uniqIssues = [...new Set(issues)];

  if (!hasManifest && detectedComponents.length > 0)
    suggestions.push("스캐폴딩 매니페스트(.egovframe-components.json)가 없어 remove/validate 수명주기 도구는 쓸 수 없습니다. 신규 조립은 add_egovframe_components를 사용하세요.");
  if (detectedComponents.length === 0 && buildSystem !== "unknown")
    suggestions.push("감지된 공통컴포넌트가 없습니다. list_egovframe_components로 목록 확인 후 add_egovframe_components로 조립할 수 있습니다.");
  if (uniqIssues.length === 0) suggestions.push("특이사항 없음 — 구성 정상.");

  return {
    projectDir: dir, isEgovProject, buildSystem, egovVersion, database,
    detectedComponents, aiLayer, hasManifest, issues: uniqIssues, suggestions,
  };
}

// ── 프로젝트 리포트 (v0.16.0) ───────────────────────────
/** 프로젝트를 스캔해 설치 컴포넌트·테이블·가이드·이슈를 Markdown 리포트로 생성한다. (읽기 전용) */
export function generateReport(opts: { projectDir: string }): string {
  const d = diagnoseProject({ projectDir: opts.projectDir });
  const catalog = loadCatalog();
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  const L: string[] = [];
  L.push(`# eGovFrame 프로젝트 리포트`);
  L.push(``);
  L.push(`- 경로: ${d.projectDir}`);
  L.push(`- 빌드: ${d.buildSystem}${d.isEgovProject ? " (egovframe)" : ""} · RTE ${d.egovVersion ?? "미검출"} · DbType ${d.database ?? "미설정"}`);
  L.push(`- AI 계층: ${d.aiLayer ? "있음" : "없음"} · 매니페스트: ${d.hasManifest ? "있음" : "없음"}`);
  L.push(``);
  L.push(`## 설치 공통컴포넌트 (${d.detectedComponents.length})`);
  L.push(``);
  if (d.detectedComponents.length) {
    L.push(`| id | 이름 | 카테고리 | 테이블 | 가이드 |`);
    L.push(`|---|---|---|---|---|`);
    for (const dc of d.detectedComponents) {
      const c = byId.get(dc.id);
      const tables = c?.tables?.length ?? 0;
      const guide = c?.docs?.length ? `${c.docs.length}건` : "-";
      L.push(`| ${dc.id} | ${dc.name} | ${c?.category ?? "-"} | ${tables} | ${guide} |`);
    }
  } else {
    L.push(`(감지된 컴포넌트 없음)`);
  }
  const tableSet = new Set<string>();
  for (const dc of d.detectedComponents) for (const t of byId.get(dc.id)?.tables ?? []) tableSet.add(t);
  if (tableSet.size) {
    L.push(``, `## 참조 테이블 (${tableSet.size})`, ``, [...tableSet].sort().join(", "));
  }
  const docLines: string[] = [];
  for (const dc of d.detectedComponents) {
    const c = byId.get(dc.id);
    for (const doc of c?.docs ?? [])
      docLines.push(`- [${doc.title}](https://github.com/${DOCS_REPO}/blob/main/${doc.path}) — ${dc.id}`);
  }
  if (docLines.length) L.push(``, `## 가이드 문서`, ``, ...docLines);
  if (d.issues.length) L.push(``, `## 이슈`, ``, ...d.issues.map((i) => `- ${i}`));
  if (d.suggestions.length) L.push(``, `## 제안`, ``, ...d.suggestions.map((s) => `- ${s}`));
  return L.join("\n");
}
