// 패키지 버전 — package.json 단일 출처 (server.ts·agents-md.ts 공용, 순환 import 방지).
import * as fs from "node:fs";

export const SERVER_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
