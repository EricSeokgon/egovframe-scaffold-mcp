// 오프라인 번들(v0.42) — 카탈로그·템플릿 정의에서 받을 목록을 만들어 prepareOfflineBundle 에 넘긴다(순환 import 를 피하려 분리).
import { loadCatalog } from "./catalog.js";
import { archiveDownloadUrl, TEMPLATES } from "./project.js";
import { prepareOfflineBundle, type PrepareBundleOptions, type PrepareBundleResult } from "./offline-bundle.js";
import { SERVER_VERSION } from "./version.js";
import { COMPONENTS_REPOSITORY } from "./component-origin.js";

/** 번들에 담을 수 있는 템플릿: 고정 지문이 있는 Initializr zip(기본 전부) + 저장소 템플릿(지정할 때만, 기본 브랜치의 codeload zip). */
export function bundleTemplateList(ids?: string[]): { id: string; url: string; archive?: { sha256: string; bytes: number } }[] {
  const pick = ids ?? Object.entries(TEMPLATES).filter(([, t]) => t.archive).map(([id]) => id);
  return pick.map((id) => {
    const t = TEMPLATES[id];
    if (!t) throw new Error(`알 수 없는 템플릿: ${id} (가능: ${Object.keys(TEMPLATES).join(", ")})`);
    return t.archive
      ? { id, url: archiveDownloadUrl(t.repo, t.archive.commit, t.archive.path), archive: { sha256: t.archive.sha256, bytes: t.archive.bytes } }
      : { id, url: `https://codeload.github.com/${t.repo}/zip/${t.branch}` };
  });
}

export async function prepareEgovframeOfflineBundle(opts: PrepareBundleOptions): Promise<PrepareBundleResult> {
  const src = loadCatalog().source;
  const catalog = { repository: src.repository ?? COMPONENTS_REPOSITORY, tag: src.tag ?? null, commit: src.commit ?? null, ...(src.archive ? { archive: { sha256: src.archive.sha256, bytes: src.archive.bytes } } : {}) };
  return prepareOfflineBundle({ ...opts, catalog, templateList: (opts.include ?? ["osv", "components", "templates", "origin"]).includes("templates") ? bundleTemplateList(opts.templates) : [], serverVersion: SERVER_VERSION });
}
