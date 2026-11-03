// node test/project-map-live.mjs — 프로젝트 구조 지도(v1.14) 실자산 검증 (CI 통합: 네트워크)
//   (1) 공식 공통컴포넌트 v5.0.7 전체(카탈로그 고정 커밋): 60초 이내, 해석 실패율 5% 이하, 카탈로그 테이블 대부분이 매퍼에서 참조됨, URL·화면 수, impact 세 방향이 끝까지 닿음
//   (2) 코퍼스 v4.3.2 부분 트리와 수치 비교(인수인계 표가 버전 사이에 무엇이 늘고 줄었는지 — 정보)
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCorpus, materializeEntry } from "../scripts/corpus-lib.mjs";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const { downloadComponentsZip } = await import("../dist/components.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-map-live-"));
try {
  const src = m.loadCatalog().source;
  const { zip } = await downloadComponentsZip(src);
  const full = path.join(root, "full");
  for (const e of zip.getEntries()) {
    const rel = e.entryName.replace(/^[^/]+\//, "");
    if (e.isDirectory || !/^src\/main\/(java|resources|webapp)\//.test(rel) || /\.(png|gif|jpg|jpeg|ico|woff2?|ttf|eot|swf|zip|jar|pdf)$/i.test(rel)) continue;
    mkdirSync(path.dirname(path.join(full, rel)), { recursive: true });
    writeFileSync(path.join(full, rel), e.getData());
  }
  writeFileSync(path.join(full, "pom.xml"), "<project><artifactId>egovframe-common-components</artifactId><version>5.0.7</version><packaging>war</packaging></project>");
  const r = m.buildProjectMap({ projectDir: full });
  const s = r.summary;
  const catalogTables = new Set(m.loadCatalog().components.flatMap((c) => c.tables ?? []));
  const referenced = [...catalogTables].filter((t) => r.nodes.some((x) => x.id === `table:${t}`)).length;
  info(`${src.tag}: ${JSON.stringify(s)} · 카탈로그 테이블 ${referenced}/${catalogTables.size} 참조 · ${r.durationMs}ms`);
  assert(r.durationMs < 60_000, `공통컴포넌트 ${src.tag} 전체 지도 60초 이내 (${r.durationMs}ms)`);
  assert(s.unresolvedRate <= 0.05, `해석 실패율 5% 이하 (${(s.unresolvedRate * 100).toFixed(1)}% — 동적 SQL ${s.unresolvedStatements}·뷰 ${s.unresolvedViews})`);
  assert(s.files.java > 1000 && s.mappers > 120 && s.statements > 1000 && s.classes.controller > 150 && s.urls > 1000 && s.views > 600, `규모: Java ${s.files.java} · 매퍼 ${s.mappers}(문장 ${s.statements}) · Controller ${s.classes.controller} · URL ${s.urls} · 화면 ${s.views}`);
  assert(referenced / catalogTables.size >= 0.8, `카탈로그 테이블 ${catalogTables.size} 중 ${referenced} 가 매퍼에서 참조됨(80% 이상)`);
  assert(r.componentTables.length >= 40 && r.nodes.filter((x) => x.component).length > s.files.java * 0.8, `컴포넌트 표시: ${r.componentTables.length}개 컴포넌트, 노드 대부분에 component`);
  const it = r.impact ?? m.impactOf(r, { table: "COMTNBBS" });
  const iu = m.impactOf(r, { url: "/cop/bbs/selectArticleList.do" });
  const ic = m.impactOf(r, { class: "EgovArticleServiceImpl" });
  info(`impact COMTNBBS ${JSON.stringify(it.byType)} · /cop/bbs/selectArticleList.do ${JSON.stringify(iu.byType)} · EgovArticleServiceImpl ${JSON.stringify(ic.byType)}`);
  assert(it.byType.url > 10 && it.byType.view > 5 && it.byType.class > 5, "impact(COMTNBBS): 매퍼 → DAO → Service → Controller → URL·화면까지");
  assert(iu.byType.table >= 2 && iu.nodes.some((x) => x.node.id === "table:COMTNBBS") && iu.byType.mapper >= 1, "impact(URL): 거꾸로 COMTNBBS 까지");
  assert(ic.byType.table >= 1 && ic.byType.url >= 1, "impact(class): 양쪽");
  const h = m.handoverTables(r);
  assert(h.screens.length === r.edges.filter((e) => e.kind === "maps").length && h.programs.length === s.classes.controller && h.dbAccess.length === s.tables, `인수인계 표: 화면 ${h.screens.length} · 프로그램 ${h.programs.length} · DB 접근 ${h.dbAccess.length}`);
  info(`고아: 매퍼 ${s.orphanMappers}(${r.orphans.mappers.slice(0, 5).join(", ")}) · 문장 ${s.orphanStatements} · URL 없는 Controller ${s.controllersWithoutUrl} · 미참조 컴포넌트 테이블 ${s.unreferencedTables}(${r.orphans.unreferencedTables.slice(0, 5).join(", ")})`);

  // (2) 코퍼스 v4.3.2 비교
  const corpus = loadCorpus();
  const { dir } = materializeEntry(corpus, corpus.entries.find((x) => x.id === "cc-4.3.2"));
  const r4 = m.buildProjectMap({ projectDir: dir });
  const h4 = m.handoverTables(r4);
  const urls5 = new Set(h.screens.map((x) => x.url)), urls4 = new Set(h4.screens.map((x) => x.url));
  const added = [...urls5].filter((u) => !urls4.has(u)).length, removed = [...urls4].filter((u) => !urls5.has(u)).length;
  info(`v4.3.2(부분 트리) → ${src.tag}: URL ${urls4.size} → ${urls5.size} (+${added} −${removed}) · 테이블 ${r4.summary.tables} → ${s.tables} · 매퍼 ${r4.summary.mappers} → ${s.mappers} · Controller ${r4.summary.classes.controller} → ${s.classes.controller}`);
  assert(r4.summary.unresolvedRate <= 0.05 && urls5.size >= urls4.size * 0.9, "코퍼스 4.3.2 도 해석 실패율 5% 이하, 5.0.7 URL 이 4.3.2 의 90% 이상 보존");
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`project-map-live FAIL (${n} assertions)`); else console.log(`project-map-live OK (${n} assertions)`);
