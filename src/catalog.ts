// 공통컴포넌트 카탈로그 — 로드·의존성 해석·검색.
import * as fs from "node:fs";
import type { CatalogSourceMetadata } from "./catalog-sync.js";

/* ------------------------------------------------------------------ */
/* 컴포넌트 카탈로그 (M1) — 로드맵 '공통컴포넌트 선택 설치'의 1단계       */
/* 설계: docs/design-components-parameter.md                            */
/* ------------------------------------------------------------------ */

export interface CatalogComponent {
  id: string;
  name: string;
  category: string;
  description: string;
  /** 공통컴포넌트 저장소 루트 기준 경로 프리픽스(startsWith 매칭) */
  pathPrefixes: string[];
  dependsOn: string[];
  /** surveyedAt 시점의 파일 수(안내용 근사치) */
  approxFiles: number;
  /** 컴포넌트 매퍼가 참조하는 DB 테이블 (선별 DDL 추출용) */
  tables?: string[];
  /** 관련 공식 가이드 문서 (egovframe-docs 저장소 상대 경로) */
  docs?: { path: string; title: string }[];
  /** 그룹 항목: 설치 시 이 리프 컴포넌트들로 확장된다 (자체 파일 없음) */
  children?: string[];
  /** 컴포넌트 메시지 번들(.properties) */
  messageBundles?: string[];
  /** ID 생성기 Spring context */
  idgnContexts?: string[];
  /** 스케줄러 Spring context */
  schedulingContexts?: string[];
  /** CSS·JS·이미지·HTML 등 웹 정적 자산 */
  webAssets?: string[];
  /** 공통 Spring·Spring MVC 설정 조각 */
  webFragments?: string[];
  /** 소스 import 분석으로 탐지한 Maven 좌표 */
  mavenDependencies?: string[];
}

export interface Catalog {
  schemaVersion: number;
  source: CatalogSourceMetadata & { repo: string; branch: string; surveyedAt: string };
  sqlNote: string;
  components: CatalogComponent[];
}

const CATALOG_URL = new URL("../catalog/components.json", import.meta.url);

/** 카탈로그 로드 + 무결성 검증(id 중복, 의존 대상 존재) */
export function loadCatalog(): Catalog {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_URL, "utf-8")) as Catalog;
  if (![1, 2].includes(catalog.schemaVersion)) throw new Error(`지원하지 않는 카탈로그 schemaVersion: ${catalog.schemaVersion}`);
  if (catalog.schemaVersion >= 2) {
    if (!catalog.source.repository || !catalog.source.tag || !/^[0-9a-f]{40}$/.test(catalog.source.commit ?? ""))
      throw new Error("카탈로그 오류: schemaVersion 2는 source.repository/tag/commit이 필요합니다");
    const archive = catalog.source.archive;
    if (!archive || !/^[0-9a-f]{64}$/.test(archive.sha256) || archive.bytes <= 0 || archive.files <= 0)
      throw new Error("카탈로그 오류: source.archive 무결성 메타데이터가 올바르지 않습니다");
  }
  const ids = new Set<string>();
  for (const c of catalog.components) {
    if (ids.has(c.id)) throw new Error(`카탈로그 오류: 중복 id '${c.id}'`);
    ids.add(c.id);
  }
  for (const c of catalog.components) {
    for (const d of c.dependsOn)
      if (!ids.has(d)) throw new Error(`카탈로그 오류: '${c.id}'가 의존하는 '${d}'가 카탈로그에 없습니다`);
    for (const ch of c.children ?? [])
      if (!ids.has(ch)) throw new Error(`카탈로그 오류: '${c.id}'의 children '${ch}'가 카탈로그에 없습니다`);
    for (const field of COMPONENT_ASSET_FIELDS)
      for (const asset of c[field] ?? []) {
        const normalized = asset.replace(/\\/g, "/");
        if (normalized.startsWith("/") || normalized.split("/").includes(".."))
          throw new Error(`카탈로그 오류: '${c.id}.${field}'에 안전하지 않은 경로가 있습니다: ${asset}`);
      }
  }
  return catalog;
}

/** 요청 컴포넌트 → 의존성 포함 설치 순서(위상 정렬). 순환 의존 시 오류 */
export function resolveComponents(
  catalog: Catalog,
  ids: string[],
  includeDependencies = true,
): CatalogComponent[] {
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  for (const id of ids)
    if (!byId.has(id))
      throw new Error(`알 수 없는 컴포넌트 id: '${id}' — list_egovframe_components로 목록을 확인하세요`);
  // 그룹(children 보유·자체 파일 없음) → 리프로 확장
  const expanded: string[] = [];
  const expand = (id: string, depth: number) => {
    if (depth > 3) throw new Error(`카탈로그 오류: 그룹 중첩이 너무 깊습니다: '${id}'`);
    const c = byId.get(id)!;
    if (c.children?.length && c.pathPrefixes.length === 0) for (const ch of c.children) expand(ch, depth + 1);
    else expanded.push(id);
  };
  for (const id of ids) expand(id, 0);
  ids = [...new Set(expanded)];
  const order: CatalogComponent[] = [];
  const state = new Map<string, 1 | 2>(); // 1=방문 중, 2=완료
  const visit = (id: string, stack: string[]) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) throw new Error(`카탈로그 오류: 순환 의존 감지 ${[...stack, id].join(" → ")}`);
    state.set(id, 1);
    if (includeDependencies) for (const d of byId.get(id)!.dependsOn) visit(d, [...stack, id]);
    state.set(id, 2);
    order.push(byId.get(id)!);
  };
  for (const id of ids) visit(id, []);
  return order;
}

export const COMPONENT_ASSET_FIELDS = [
  "messageBundles", "idgnContexts", "schedulingContexts", "webAssets", "webFragments",
] as const;

export type ComponentAssetField = (typeof COMPONENT_ASSET_FIELDS)[number];

/* ------------------------------------------------------------------ */
/* 컴포넌트 검색 (v0.5.0)                                               */
/* ------------------------------------------------------------------ */

export interface SearchResult {
  id: string;
  name: string;
  category: string;
  description: string;
  dependsOn: string[];
  approxFiles: number;
  score: number;
}

/** 카탈로그에서 키워드로 컴포넌트를 검색한다 (id·이름·설명·카테고리 부분 일치, 점수순). */
export function searchComponents(catalog: Catalog, query: string, category?: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) throw new Error("query가 비어 있습니다");
  const results: SearchResult[] = [];
  for (const c of catalog.components) {
    if (category && c.category !== category) continue;
    let score = 0;
    const id = c.id.toLowerCase();
    const name = c.name.toLowerCase();
    const desc = c.description.toLowerCase();
    if (id === q) score += 100;
    else if (id.includes(q)) score += 50;
    if (name.includes(q)) score += 40;
    if (desc.includes(q)) score += 20;
    if (c.category.toLowerCase() === q) score += 10;
    if (score > 0)
      results.push({ id: c.id, name: c.name, category: c.category, description: c.description,
        dependsOn: c.dependsOn, approxFiles: c.approxFiles, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}
