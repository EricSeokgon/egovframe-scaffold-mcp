// 실자산(live) 테스트가 쓰는 upstream 표본을 **커밋으로 고정**해 받는다 (테스트가 아니라 도우미).
//   태그 이름으로 받으면 upstream 이 태그를 옮길 때 정답이 바뀐다 — 공통컴포넌트 v5.0.7 태그는 두 번 옮겨졌다
//   (2026-10-07, 2026-11-25: 7912e13 → 36abd0d "NCSC Security patch applied.", 370 파일).
//   "v5.0.7" 은 카탈로그가 고정한 커밋(catalog/components.json, v1.26.1 부터 36abd0d),
//   "v5.0.7@2026-10" 은 그 전의 태그 커밋 — 보안 패치 전후를 비교하는 표본으로 남긴다.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export const COMMON_COMPONENTS_REPO = "https://github.com/eGovFramework/egovframe-common-components.git";
export const COMMON_COMPONENTS_COMMITS = {
  "v5.0.6": "23d01889e01fcfa486d28d7a2ec4adb51fbaf3ad",
  /** 카탈로그·재조립 목표가 고정한 v5.0.7 (2026-11-25 에 옮겨진 태그 — 보안 패치 포함) */
  "v5.0.7": "36abd0d5bcb22e58b366f8d5f1e8ccdccfe7d6da",
  /** 2026-10-07 ~ 2026-11-25 의 v5.0.7 태그(v1.26.0 까지 카탈로그가 고정하던 커밋) */
  "v5.0.7@2026-10": "7912e13ca5a064a4dc81d5772582f928e985e653",
};

/**
 * 공식 템플릿 저장소의 고정 커밋 — "고칠 것이 있는 실제 프로젝트"가 필요한 시나리오 테스트용(createProject 의 ref 로 준다).
 * 템플릿은 기본 브랜치로 받기 때문에 upstream 이 스스로 고치면 시나리오가 사라진다
 * (2026-11-27 공식 템플릿의 5.1.0 갱신: msa-common-components 의 취약 의존성 권고가 대부분 해소됨).
 */
export const TEMPLATE_COMMITS = {
  /** 5.1.0 갱신 직전(2026-10-29, 5.0.4 기준) — 취약 버전을 직접 고정한 모듈 pom 이 남아 있는 상태 */
  "msa-common-components@5.0.4": "d4c57063d26668a5b1fb4f19a8b9fbdc980b3021",
};

/** 고정 커밋 하나만 얕게 받아 dest 에 풀어 놓는다(.git 은 남는다). */
export function clonePinned(dest, ref, repo = COMMON_COMPONENTS_REPO) {
  const sha = COMMON_COMPONENTS_COMMITS[ref] ?? ref;
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`고정 커밋을 모르는 ref: ${ref}`);
  mkdirSync(dest, { recursive: true });
  const git = (args) => execFileSync("git", args, { cwd: dest, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  git(["init", "-q"]);
  git(["remote", "add", "origin", repo]);
  git(["-c", "advice.detachedHead=false", "fetch", "-q", "--depth", "1", "origin", sha]);
  git(["-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"]);
  return dest;
}
