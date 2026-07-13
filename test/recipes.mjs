// node test/recipes.mjs — 네트워크 불필요, 레시피 정합성 검증
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const recipes = JSON.parse(readFileSync(path.join(root, "../catalog/recipes.json"), "utf-8")).recipes;
const catalog = JSON.parse(readFileSync(path.join(root, "../catalog/components.json"), "utf-8"));

const ids = new Set();
for (const c of catalog.components) {
  ids.add(c.id);
  if (Array.isArray(c.children)) for (const ch of c.children) ids.add(typeof ch === "string" ? ch : ch.id);
}
const STACKS = ["spring-ai", "langchain4j"];

let fail = 0;
for (const r of recipes) {
  if (!r.template) { console.error(`recipe ${r.id}: no template`); fail++; }
  for (const c of r.components) {
    if (!ids.has(c)) { console.error(`recipe ${r.id}: missing component id "${c}"`); fail++; }
  }
  if (r.ai && !STACKS.includes(r.ai.stack)) { console.error(`recipe ${r.id}: bad ai.stack ${r.ai.stack}`); fail++; }
}
if (fail) { console.error(`recipes FAIL: ${fail}건`); process.exit(1); }
console.log(`recipes OK (${recipes.length}건)`);
