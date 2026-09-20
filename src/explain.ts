// 컴포넌트 상세 설명 (explain_egovframe_component).
import { loadCatalog } from "./catalog.js";
import { DOCS_REPO } from "./guide.js";

// ── 컴포넌트 상세 설명 (v0.18.0) ────────────────────────
export interface ComponentExplain {
  id: string; name: string; category: string; description: string;
  dependsOn: string[]; transitiveDeps: string[]; dependents: string[];
  tables: string[]; docs: { title: string; url: string }[]; approxFiles: number; installHint: string;
}

/** 컴포넌트 하나의 상세(설명·의존성·역의존·테이블·가이드·설치 힌트)를 계산한다. (읽기 전용) */
export function explainComponent(id: string): ComponentExplain {
  const catalog = loadCatalog();
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  const c = byId.get(id);
  if (!c) throw new Error(`알 수 없는 컴포넌트 id: ${id} — list_egovframe_components로 확인하세요.`);

  const seen = new Set<string>();
  const stack = [...c.dependsOn];
  while (stack.length) {
    const d = stack.pop()!;
    if (seen.has(d)) continue;
    seen.add(d);
    const dc = byId.get(d);
    if (dc) stack.push(...dc.dependsOn);
  }
  const transitiveDeps = [...seen];
  const dependents = catalog.components.filter((x) => x.dependsOn.includes(id)).map((x) => x.id);
  const docs = (c.docs ?? []).map((d) => ({ title: d.title, url: `https://github.com/${DOCS_REPO}/blob/main/${d.path}` }));
  return {
    id: c.id, name: c.name, category: c.category, description: c.description,
    dependsOn: c.dependsOn, transitiveDeps, dependents, tables: c.tables ?? [], docs, approxFiles: c.approxFiles,
    installHint: `add_egovframe_components(projectDir="...", components=["${c.id}"]) — 의존성 ${transitiveDeps.length ? transitiveDeps.join(", ") : "없음"} 포함`,
  };
}
