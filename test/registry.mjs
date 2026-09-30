// node test/registry.mjs — MCP Registry 메타데이터(server.json)와 package.json 정합 (오프라인)
import { readFileSync } from "node:fs";
let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
assert(typeof pkg.mcpName === "string" && /^io\.github\.[A-Za-z0-9-]+\/[a-z0-9-]+$/.test(pkg.mcpName), `package.json mcpName 형식 (${pkg.mcpName})`);
assert(server.name === pkg.mcpName, "server.json name == package.json mcpName (레지스트리 검증 조건)");
assert(server.version === pkg.version, `server.json version == package.json version (${server.version} / ${pkg.version})`);
assert(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/.test(server.$schema), "$schema 는 공식 스키마 URL");
assert(server.repository?.source === "github" && server.repository.url === "https://github.com/EricSeokgon/egovframe-scaffold-mcp", "repository 가 GitHub 저장소");
assert(Array.isArray(server.packages) && server.packages.length === 1, "packages 1개(npm)");
const p = server.packages[0];
assert(p.registryType === "npm" && p.identifier === pkg.name && p.version === pkg.version && p.transport?.type === "stdio", "npm 패키지 좌표·버전·stdio transport");
assert(p.environmentVariables.every((e) => e.name && e.description && e.isSecret === false) && p.environmentVariables.some((e) => e.name === "EGOVFRAME_ALLOWED_ROOTS") && p.environmentVariables.some((e) => e.name === "EGOVFRAME_LANG"), "환경변수 2종 문서화(비밀 아님)");
assert(typeof server.description === "string" && server.description.length <= 100 * 3 && !/[ㄱ-힝]{20,}/.test(server.description.replace(/\(.*?\)/g, "")), "description 은 영어 기준(괄호 안 한글 병기만)");
assert(pkg.files.includes("README.en.md") && pkg.files.includes("catalog"), "npm files 에 README.en.md·catalog 포함");
if (process.exitCode) console.error(`registry FAIL (${n})`); else console.log(`registry OK (${n})`);
