// node test/diagnose.mjs — 네트워크 불필요, 픽스처로 진단 검증
import { diagnoseProject } from "../dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function assert(cond, msg) { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else { console.log("ok:", msg); } }

// 픽스처: maven + egovframe + mysql + cmm·bbs 패키지
const root = mkdtempSync(path.join(tmpdir(), "egovdiag-"));
writeFileSync(path.join(root, "pom.xml"),
  `<project><dependencies><dependency><groupId>org.egovframe.rte</groupId>` +
  `<artifactId>org.egovframe.rte.ptl.mvc</artifactId><version>4.3.0</version></dependency></dependencies></project>`);
mkdirSync(path.join(root, "src/main/resources"), { recursive: true });
writeFileSync(path.join(root, "src/main/resources/application.properties"), "Globals.DbType=mysql\n");
for (const p of ["src/main/java/egovframework/com/cmm", "src/main/java/egovframework/com/cop/bbs"]) {
  mkdirSync(path.join(root, p), { recursive: true });
  writeFileSync(path.join(root, p, "Placeholder.java"), "class Placeholder {}");
}

const r = diagnoseProject({ projectDir: root });
assert(r.buildSystem === "maven", "maven 감지");
assert(r.isEgovProject === true, "egovframe 좌표 감지");
assert(r.egovVersion === "4.3.0", `RTE 버전 4.3.0 (got ${r.egovVersion})`);
assert(r.database === "mysql", `DbType mysql (got ${r.database})`);
const ids = r.detectedComponents.map((c) => c.id);
assert(ids.includes("cmm") && ids.includes("bbs"), `cmm·bbs 감지 (got ${ids.join(",")})`);
assert(!r.issues.some((i) => i.includes("의존")), "bbs→cmm 의존 충족(누락 이슈 없음)");

// 음성 픽스처: 빈 디렉터리
const empty = mkdtempSync(path.join(tmpdir(), "egovempty-"));
const r2 = diagnoseProject({ projectDir: empty });
assert(r2.buildSystem === "unknown", "빈 디렉터리 → 빌드 unknown");
assert(r2.issues.length > 0, "빈 디렉터리 → 이슈 존재");

rmSync(root, { recursive: true, force: true });
rmSync(empty, { recursive: true, force: true });
if (process.exitCode) { console.error("diagnose FAIL"); } else { console.log("diagnose OK"); }
