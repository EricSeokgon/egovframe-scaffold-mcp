// 패키지 버전 — package.json 단일 출처 (server.ts·agents-md.ts 공용, 순환 import 방지).
import * as fs from "node:fs";

const PKG: { version?: unknown; engines?: { node?: unknown } } = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  } catch {
    return {};
  }
})();

export const SERVER_VERSION: string = typeof PKG.version === "string" && PKG.version ? PKG.version : "0.0.0";

/** 지원 Node 범위(package.json engines.node) — 공개 API 계약의 일부(v1.0) */
export const NODE_ENGINES: string = typeof PKG.engines?.node === "string" ? PKG.engines.node : "";
