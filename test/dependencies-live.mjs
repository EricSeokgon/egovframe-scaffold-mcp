// node test/dependencies-live.mjs — OSV 조회 경로 (네트워크, CI integration 전용)
// 알려진 취약 버전(log4j 1.2.17)이 포함된 픽스처를 offline=false 로 점검해 OSV 결과가 붙는지 확인한다.
import { checkDependencies } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const root = mkdtempSync(path.join(tmpdir(), "egovdeplive-"));
mkdirSync(root, { recursive: true });
writeFileSync(path.join(root, "pom.xml"), `<project><dependencies>
  <dependency><groupId>log4j</groupId><artifactId>log4j</artifactId><version>1.2.17</version></dependency>
  <dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>6.2.11</version></dependency>
</dependencies></project>\n`);
try {
  const r = await checkDependencies({ projectDir: root, offline: false });
  assert(!r.osvError, `OSV 조회 성공 (${r.osvError ?? "ok"})`);
  const log4j = r.vulnerabilities?.find((v) => v.dependency === "log4j:log4j");
  assert(log4j && log4j.ids.length >= 1, `log4j 1.2.17 취약점 ${log4j?.ids.length ?? 0}건 (예: ${log4j?.ids[0] ?? "-"})`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`dependencies-live FAIL (${n})`); else console.log(`dependencies-live OK (${n})`);
