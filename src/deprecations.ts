// deprecated 파라미터 (v1.0 버전 정책의 폐기 절차) — MINOR 에서 표시하고 다음 MAJOR 에서만 제거한다.
//   옛 이름은 계속 받고(새 이름이 없을 때만 대신 씀), 응답에 경고 한 줄을 남긴다.

export interface DeprecatedParam { use: string; since: string; removeIn: string }

export const DEPRECATED_PARAMS: Record<string, Record<string, DeprecatedParam>> = {
  check_egovframe_secure_coding: { top: { use: "topN", since: "1.0.0", removeIn: "2.0.0" } },
};

/** deprecated 이름으로 온 값을 새 이름으로 옮기고 경고를 돌려준다(새 이름이 이미 있으면 새 이름이 우선) */
export function applyDeprecatedParams<T extends Record<string, unknown>>(tool: string, args: T): { args: T; warnings: string[] } {
  const table = DEPRECATED_PARAMS[tool];
  if (!table) return { args, warnings: [] };
  const out: Record<string, unknown> = { ...args };
  const warnings: string[] = [];
  for (const [old, d] of Object.entries(table)) {
    if (out[old] === undefined) continue;
    if (out[d.use] === undefined) out[d.use] = out[old];
    delete out[old];
    warnings.push(`파라미터 \`${old}\` 는 ${d.since} 부터 deprecated 입니다 — \`${d.use}\` 를 쓰세요(${d.removeIn} 에서 제거).`);
  }
  return { args: out as T, warnings };
}
