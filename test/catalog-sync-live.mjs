import { syncCatalog } from "../dist/index.js";

const result = await syncCatalog();
if (!result.upToDate) throw new Error(`catalog is not up to date: ${result.warnings.join(", ")}`);
if (result.resolvedCommit !== result.pinnedCommit) throw new Error("tag/commit mismatch");
if (result.archive.securityPaths.length < 3) throw new Error("sec.security package missing");
if (result.archive.unmappedComponentPaths.length !== 0) throw new Error("unmapped component paths found");
// v1.26: upstream 이 고정 태그를 옮긴 것은 실패가 아니라 알림이다 — 고정 커밋의 아카이브 무결성은 위에서 확인했다.
//   (upstream 의 태그 이동 한 번이 릴리스 전체를 막지 않게. 카탈로그 갱신은 사람이 판단해 다음 릴리스에서)
if (result.tagMoved) {
  const msg = `upstream moved tag ${result.tagMoved.tag}: catalog pins ${result.tagMoved.pinnedCommit.slice(0, 7)}, tag is now ${result.tagMoved.currentCommit.slice(0, 7)} - regenerate the catalog (scripts/generate-catalog.mjs)`;
  console.log(process.env.GITHUB_ACTIONS ? `::warning title=common-components tag moved::${msg}` : `warning: ${msg}`);
}
console.log(`catalog sync OK: ${result.resolvedCommit}, ${result.archive.files} files, sha256:${result.archive.sha256}`);
