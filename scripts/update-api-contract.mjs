// npm run api-contract:update — 공개 API 계약 스냅샷(test/fixtures/api-contract.json) 갱신 (v1.0 버전 정책)
//   base: 이 계약 변경을 재는 기준 릴리스(스냅샷이 다른 버전에서 만들어졌으면 그 버전), change: base 이후 누적 등급.
//   갱신 결과의 diff(계약과 change)를 PR 에서 검토한다. test:release 가 change 와 package.json 버전 증가 폭을 맞춰 본다.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "test/fixtures/api-contract.json");
const { buildApiContract, compareContracts, maxLevel } = await import(pathToFileURL(path.join(root, "dist", "index.js")).href);
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const contract = await buildApiContract();
let base = version, change = "none", changes = [];
if (existsSync(file)) {
  const old = JSON.parse(readFileSync(file, "utf8"));
  const c = compareContracts(old.contract, contract);
  changes = c.changes;
  if (old.version === version) { base = old.base; change = maxLevel(old.change, c.level); }
  else { base = old.version; change = c.level; }
}
writeFileSync(file, `${JSON.stringify({ version, base, change, contract }, null, 2)}\n`);
console.log(`api-contract: ${path.relative(root, file)} — version ${version} · base ${base} · change ${change}`);
for (const ch of changes) console.log(`  ${ch.level.padEnd(5)} ${ch.path} — ${ch.what}`);
