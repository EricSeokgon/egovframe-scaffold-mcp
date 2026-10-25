// node test/docs-search.mjs — 오프라인 문서 인덱스 검색 검증
import { loadCatalog, searchDocs } from "../dist/index.js";
function assert(c, m) { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); }

const board = searchDocs({ query: "게시판" });
assert(board.length > 0, "'게시판' 결과 있음");
assert(board.some((h) => h.componentId === "bbs"), "'게시판' → bbs 매핑 포함");
assert(board.every((h) => h.url.includes("egovframe-docs/blob/main/")), "URL 형식 정상");
assert(board[0].score >= board[board.length - 1].score, "점수 내림차순 정렬");

const login = searchDocs({ query: "로그인" });
assert(login.length > 0, "'로그인' 결과 있음");

const limited = searchDocs({ query: "관리", limit: 3 });
assert(limited.length <= 3, "limit 반영");

const none = searchDocs({ query: "zzxqnonexistentterm" });
assert(none.length === 0, "미존재어 → 0건");

const empty = searchDocs({ query: "   " });
assert(empty.length === 0, "빈 질의 → 0건");


const guides = loadCatalog().components.flatMap((c) => c.docs ?? []);
assert(guides.every((d) => !d.title.endsWith(".md")), "가이드 제목은 파일 이름 대신 문서 제목");
const group = searchDocs({ query: "그룹관리" });
assert(group.some((h) => h.path === "common-component/security/group-management.md" && h.title === "그룹관리"), "그룹관리 → 실제 가이드 제목과 경로");
const statistics = searchDocs({ query: "게시물 통계" });
assert(statistics.some((h) => h.path === "common-component/statistics-reporting/post-statistics.md" && h.title === "게시물 통계"), "게시물 통계 → 실제 가이드");

// Exercise the real generator offline without touching the packaged catalog.
const fs = await import("node:fs");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { execFileSync } = await import("node:child_process");
const { default: AdmZip } = await import("adm-zip");
const fixture = fs.mkdtempSync(fileURLToPath(new URL("../.catalog-titles-", import.meta.url)));
try {
  fs.mkdirSync(path.join(fixture, "scripts"));
  fs.mkdirSync(path.join(fixture, "catalog"));
  fs.mkdirSync(path.join(fixture, "docs/common-component"), { recursive: true });
  fs.copyFileSync(new URL("../scripts/generate-catalog.mjs", import.meta.url), path.join(fixture, "scripts/generate-catalog.mjs"));
  fs.writeFileSync(path.join(fixture, "catalog/overrides.json"), "{}");
  const zip = new AdmZip();
  zip.addFile("fixture/src/main/java/egovframework/com/sec/gmt/service/Example.java", Buffer.from("class Example {}"));
  zip.writeZip(path.join(fixture, "source.zip"));
  const cases = [
    ["indented.md", '  title: "예제: 그룹 관리"', "예제: 그룹 관리"],
    ["plain.md", "title: 기존 제목", "기존 제목"],
    ["tab.md", "\ttitle: 탭 제목", "탭 제목"],
    ["missing.md", "description: 제목 없음", "missing.md"],
  ];
  for (const [name, header] of cases)
    fs.writeFileSync(path.join(fixture, "docs/common-component", name), `---\n${header}\n---\n${"egovframework.com.sec.gmt ".repeat(3)}`);
  execFileSync(process.execPath, [path.join(fixture, "scripts/generate-catalog.mjs"), "--zip", path.join(fixture, "source.zip"), "--docs", path.join(fixture, "docs")], { stdio: "pipe" });
  const generated = JSON.parse(fs.readFileSync(path.join(fixture, "catalog/components.json"), "utf8"));
  const docs = generated.components.find((c) => c.id === "sec.gmt").docs;
  for (const [name, , title] of cases)
    assert(docs.some((d) => d.path === `common-component/${name}` && d.title === title), `generator title: ${name}`);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

if (process.exitCode) console.error("docs-search FAIL"); else console.log("docs-search OK");
