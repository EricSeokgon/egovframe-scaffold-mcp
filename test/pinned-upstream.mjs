// 실자산(live) 테스트가 쓰는 upstream 표본을 **커밋으로 고정**해 받는다 (테스트가 아니라 도우미).
//   태그 이름으로 받으면 upstream 이 태그를 옮길 때 정답이 바뀐다 — 2026-11-25 공통컴포넌트 v5.0.7 태그가
//   7912e13 → 36abd0d("NCSC Security patch applied.", 370 파일)로 옮겨져 접근 통제·매퍼 실측 테스트의 정답이 달라졌다.
//   카탈로그가 고정한 것도 7912e13 이므로(catalog/components.json) 테스트의 "v5.0.7" 은 그 커밋이다.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export const COMMON_COMPONENTS_REPO = "https://github.com/eGovFramework/egovframe-common-components.git";
export const COMMON_COMPONENTS_COMMITS = {
  "v5.0.6": "23d01889e01fcfa486d28d7a2ec4adb51fbaf3ad",
  /** 카탈로그·재조립 목표가 고정한 v5.0.7 (2026-10 조사 시점의 태그) */
  "v5.0.7": "7912e13ca5a064a4dc81d5772582f928e985e653",
  /** 2026-11-25 에 옮겨진 v5.0.7 태그(보안 패치 1 커밋이 더해짐) */
  "v5.0.7-retag": "36abd0d5bcb22e58b366f8d5f1e8ccdccfe7d6da",
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
