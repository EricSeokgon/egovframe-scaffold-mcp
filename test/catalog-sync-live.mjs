import { syncCatalog } from "../dist/index.js";

const result = await syncCatalog();
if (!result.upToDate) throw new Error(`catalog is not up to date: ${result.warnings.join(", ")}`);
if (result.resolvedCommit !== result.pinnedCommit) throw new Error("tag/commit mismatch");
if (result.archive.securityPaths.length < 3) throw new Error("sec.security package missing");
if (result.archive.unmappedComponentPaths.length !== 0) throw new Error("unmapped component paths found");
console.log(`catalog sync OK: ${result.resolvedCommit}, ${result.archive.files} files, sha256:${result.archive.sha256}`);
