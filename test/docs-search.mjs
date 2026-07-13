// node test/docs-search.mjs — 오프라인 문서 인덱스 검색 검증
import { searchDocs } from "../dist/index.js";
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

if (process.exitCode) console.error("docs-search FAIL"); else console.log("docs-search OK");
