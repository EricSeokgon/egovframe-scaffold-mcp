// 도구 메타데이터 (v0.32.0): MCP tool annotations 와 ko/en title.
// annotations 는 클라이언트의 승인 UX 를 위한 힌트다 — readOnlyHint 는 "디스크를 바꾸지 않는다", destructiveHint 는 "기존 파일을
// 지우거나 덮어쓸 수 있다", idempotentHint 는 "같은 인자로 다시 실행해도 추가 효과가 없다", openWorldHint 는 "외부 네트워크를 쓴다".
// 인자에 따라 성격이 바뀌는 도구(migrate 의 apply, agents-md 의 overwrite)는 보수적으로(파괴 가능) 표시한다.
import type { ToolLang } from "./i18n.js";

export interface ToolAnnotationsLite {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}
export interface ToolMeta { title: { ko: string; en: string }; annotations: ToolAnnotationsLite }

const ro = (openWorld = false): ToolAnnotationsLite => ({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: openWorld });
const create = (openWorld = false): ToolAnnotationsLite => ({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: openWorld });
const destructive = (openWorld = false): ToolAnnotationsLite => ({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: openWorld });

export const TOOL_META: Record<string, ToolMeta> = {
  list_egovframe_templates: { title: { ko: "공식 템플릿 목록", en: "List official templates" }, annotations: ro() },
  create_egovframe_project: { title: { ko: "프로젝트 생성", en: "Create project" }, annotations: create(true) },
  sync_egovframe_catalog: { title: { ko: "컴포넌트 카탈로그 upstream 대조", en: "Verify component catalog against upstream" }, annotations: ro(true) },
  sync_egovframe_templates: { title: { ko: "템플릿 카탈로그 upstream 대조", en: "Verify template catalog against upstream" }, annotations: ro(true) },
  list_egovframe_components: { title: { ko: "공통컴포넌트 목록", en: "List common components" }, annotations: ro() },
  add_egovframe_components: { title: { ko: "공통컴포넌트 조립", en: "Assemble common components" }, annotations: create(true) },
  search_egovframe_components: { title: { ko: "공통컴포넌트 검색", en: "Search common components" }, annotations: ro() },
  remove_egovframe_components: { title: { ko: "공통컴포넌트 제거", en: "Remove common components" }, annotations: destructive() },
  validate_egovframe_project: { title: { ko: "프로젝트 무결성 검증", en: "Validate project" }, annotations: ro() },
  get_egovframe_guide: { title: { ko: "공식 가이드 조회", en: "Get official guide" }, annotations: ro(true) },
  add_ai_components: { title: { ko: "AI 계층 조립", en: "Add AI components" }, annotations: create(true) },
  list_egovframe_recipes: { title: { ko: "레시피 목록", en: "List recipes" }, annotations: ro() },
  apply_egovframe_recipe: { title: { ko: "레시피 적용", en: "Apply recipe" }, annotations: create(true) },
  diagnose_egovframe_project: { title: { ko: "프로젝트 진단", en: "Diagnose project" }, annotations: ro() },
  migrate_egovframe_project: { title: { ko: "5.x 전환 진단·적용", en: "Migrate to 5.x (diagnose / apply)" }, annotations: destructive() },
  check_egovframe_dependencies: { title: { ko: "의존성 점검", en: "Check dependencies" }, annotations: ro(true) },
  diagnose_egovframe_network: { title: { ko: "네트워크 진단", en: "Diagnose network" }, annotations: ro(true) },
  generate_agents_md: { title: { ko: "AGENTS.md 생성", en: "Generate AGENTS.md" }, annotations: destructive() },
  search_egovframe_docs: { title: { ko: "가이드 문서 검색", en: "Search guide documents" }, annotations: ro(true) },
  generate_egovframe_report: { title: { ko: "프로젝트 리포트", en: "Project report" }, annotations: ro() },
  upgrade_egovframe_project: { title: { ko: "공통컴포넌트 업그레이드", en: "Upgrade common components" }, annotations: destructive(true) },
  explain_egovframe_component: { title: { ko: "컴포넌트 상세", en: "Explain component" }, annotations: ro() },
  generate_egovframe_config: { title: { ko: "Spring 설정 파일 생성", en: "Generate Spring configuration" }, annotations: create() },
  generate_egovframe_crud: { title: { ko: "CRUD 코드 생성", en: "Generate CRUD code" }, annotations: create() },
  generate_egovframe_ci: { title: { ko: "CI 워크플로 생성", en: "Generate CI workflow" }, annotations: create() },
  build_egovframe_project: { title: { ko: "프로젝트 빌드", en: "Build project" }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  test_egovframe_project: { title: { ko: "테스트 실행", en: "Run tests" }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
};

/** 도구 이름이 readOnlyHint 인지(테스트·문서용) */
export const READ_ONLY_TOOLS = Object.entries(TOOL_META).filter(([, m]) => m.annotations.readOnlyHint).map(([n]) => n);
export const DESTRUCTIVE_TOOLS = Object.entries(TOOL_META).filter(([, m]) => m.annotations.destructiveHint).map(([n]) => n);

export function toolTitle(name: string, lang: ToolLang): string {
  const m = TOOL_META[name];
  if (!m) throw new Error(`tool-meta 에 없는 도구: ${name}`);
  return m.title[lang];
}
export function toolAnnotations(name: string): ToolAnnotationsLite {
  const m = TOOL_META[name];
  if (!m) throw new Error(`tool-meta 에 없는 도구: ${name}`);
  return { ...m.annotations };
}
