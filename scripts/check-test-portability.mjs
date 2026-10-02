#!/usr/bin/env node
/**
 * 테스트 이식성 검사 (v0.32) — test/*.mjs 에서 POSIX 전용 가정을 찾아 실패시킨다.
 *
 * 왜: v0.30·v0.31 에서 Linux 게이트는 통과했지만 Windows 게이트만 두 번 연속 깨졌다. 원인은 모두 테스트의 기대값이었다
 *   (path.relative 결과를 '/' 표기와 비교, 래퍼 이름을 './mvnw' 로 고정). 도구 코드는 플랫폼 중립이었다.
 *
 * 규칙(각각 사유와 대안을 출력한다):
 *   P1  path.relative(...) 결과를 정규화 없이 문자열로 쓰면 안 된다 → .split(path.sep).join("/") 로 정규화
 *   P2  "./mvnw" · "./gradlew" · "mvn " · "gradle " 같은 POSIX 명령 리터럴을 기대값으로 쓰면 안 된다
 *       → resolveCommand/collectAgentsFacts 에 { platform } 을 주입해 양쪽을 단언
 *   P3  process.platform 분기 없이 "/tmp" · "/home" · "/etc" 절대 경로를 쓰면 안 된다 → os.tmpdir() 또는 분기
 *   P4  경로를 "\n"·"/" 로 직접 조립해 비교하는 `includes("src/…")` 는 결과가 '/' 로 정규화된 값(도구 결과 rel 경로)일 때만 허용
 *       — 파일 시스템에서 읽은 경로(readdir·path.relative)와 비교하면 안 된다 (P1 로 감지)
 *
 * 허용 표시: 줄 끝에 `// portability: ok <사유>` 를 붙이면 그 줄은 건너뛴다.
 * 사용법: node scripts/check-test-portability.mjs   (prepublishOnly 에 포함)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = path.join(ROOT, "test");

const RULES = [
  {
    id: "P1", re: /path\.relative\([^)]*\)(?!\s*\.split\(path\.sep\))/,
    skipIf: (line) => /split\(path\.sep\)|path\.sep/.test(line),
    why: "path.relative 결과는 Windows 에서 '\\\\' 구분자 — '/' 표기와 비교하면 실패",
    fix: "path.relative(...).split(path.sep).join(\"/\") 로 정규화",
  },
  {
    id: "P2", re: /"\.\/(mvnw|gradlew)[^"]*"|'\.\/(mvnw|gradlew)[^']*'|`\.\/(mvnw|gradlew)/,
    skipIf: (line) => /platform:\s*"(linux|darwin)"|platform:\s*"win32"/.test(line) || /generateCiYaml/.test(line),
    why: "래퍼 명령은 Windows 에서 mvnw.cmd/gradlew.bat",
    fix: "resolveCommand(..., { platform: \"linux\" }) 와 { platform: \"win32\" } 를 각각 단언",
  },
  {
    id: "P3", re: /"\/(tmp|home|etc|usr|var)(\/|")/,
    skipIf: (line) => /process\.platform|isWin|win32/.test(line),
    why: "POSIX 절대 경로는 Windows 에 없음",
    fix: "os.tmpdir()·mkdtempSync 를 쓰거나 process.platform 으로 분기",
  },
];

let violations = 0;
let scanned = 0;
for (const f of fs.readdirSync(TEST_DIR).filter((n) => n.endsWith(".mjs")).sort()) {
  const text = fs.readFileSync(path.join(TEST_DIR, f), "utf8");
  scanned++;
  text.split("\n").forEach((line, i) => {
    if (/\/\/\s*portability:\s*ok/.test(line)) return;
    if (/^\s*\/\//.test(line)) return; // 주석 줄
    for (const r of RULES) {
      if (!r.re.test(line)) continue;
      if (r.skipIf && r.skipIf(line)) continue;
      violations++;
      console.error(`${f}:${i + 1} [${r.id}] ${r.why}\n    ${line.trim().slice(0, 140)}\n    → ${r.fix}`);
    }
  });
}
if (violations > 0) {
  console.error(`\ntest portability FAIL: ${violations}건 (test 파일 ${scanned}개). 의도된 줄이면 '// portability: ok <사유>' 를 붙이세요.`);
  process.exit(1);
}
console.log(`test portability OK: test 파일 ${scanned}개, 위반 0건`);
