// 공식 가이드 문서 조회·검색 (get_egovframe_guide, search_egovframe_docs).
import { DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "./shared.js";
import { loadCatalog } from "./catalog.js";

/* ------------------------------------------------------------------ */
/* 가이드 문서 조회 (v0.7.0)                                            */
/* ------------------------------------------------------------------ */

export const DOCS_REPO = "eGovFramework/egovframe-docs";

export const GUIDE_MAX_CHARS = 15_000;

export interface GuideResult {
  componentId: string;
  docs: { path: string; title: string }[];
  selected: { path: string; title: string } | null;
  content: string | null;
  truncated: boolean;
}

/** 컴포넌트의 공식 가이드 문서를 egovframe-docs에서 가져온다. */
export async function getGuide(componentId: string, docIndex = 0): Promise<GuideResult> {
  const catalog = loadCatalog();
  const comp = catalog.components.find((c) => c.id === componentId);
  if (!comp)
    throw new Error(`알 수 없는 컴포넌트 id: '${componentId}' — search_egovframe_components로 검색해 보세요`);
  const docs = comp.docs ?? [];
  if (docs.length === 0)
    return { componentId, docs: [], selected: null, content: null, truncated: false };
  if (docIndex < 0 || docIndex >= docs.length)
    throw new Error(`docIndex는 0~${docs.length - 1} 범위여야 합니다 (문서 ${docs.length}건)`);
  const sel = docs[docIndex];
  const url = `https://raw.githubusercontent.com/${DOCS_REPO}/main/${sel.path}`;
  const res = await fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) throw new Error(`가이드 문서 다운로드 실패 (${res.status}): ${url}`);
  let content = await res.text();
  const truncated = content.length > GUIDE_MAX_CHARS;
  if (truncated) content = content.slice(0, GUIDE_MAX_CHARS);
  return { componentId, docs, selected: sel, content, truncated };
}

// ── 가이드 문서 검색 (v0.15.0) ──────────────────────────
export interface DocHit {
  title: string;
  path: string;
  url: string;
  componentId: string;
  componentName: string;
  category: string;
  score: number;
}

/** 카탈로그 가이드 매핑(제목·경로·연계 컴포넌트)을 키워드로 검색한다. 오프라인. */
export function searchDocs(opts: { query: string; limit?: number }): DocHit[] {
  const terms = opts.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const catalog = loadCatalog();
  const best = new Map<string, DocHit>(); // path 기준 중복 제거(최고 점수 유지)
  for (const c of catalog.components) {
    for (const d of c.docs ?? []) {
      const title = d.title.toLowerCase();
      const name = c.name.toLowerCase();
      const hay = [d.title, d.path, c.name, c.description, c.category, c.id].join(" ").toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 3;
        if (name.includes(t)) score += 2;
        if (hay.includes(t)) score += 1;
      }
      if (score <= 0) continue;
      const hit: DocHit = {
        title: d.title, path: d.path,
        url: `https://github.com/${DOCS_REPO}/blob/main/${d.path}`,
        componentId: c.id, componentName: c.name, category: c.category, score,
      };
      const prev = best.get(d.path);
      if (!prev || score > prev.score) best.set(d.path, hit);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 10);
}

/** deep 검색용: 본문에서 질의어 주변 스니펫 추출 */
export function extractDocSnippet(body: string, terms: string[]): string {
  const text = body.replace(/\s+/g, " ").trim();
  const low = text.toLowerCase();
  let idx = -1;
  for (const t of terms) { const i = low.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
  if (idx < 0) return text.slice(0, 160);
  const start = Math.max(0, idx - 60);
  return (start > 0 ? "…" : "") + text.slice(start, start + 200) + (start + 200 < text.length ? "…" : "");
}
