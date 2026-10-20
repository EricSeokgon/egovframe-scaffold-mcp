// 응답 언어 (v1.2). EGOVFRAME_LANG=en 또는 CLI --lang en 이면 Markdown 응답과 문장 필드(reason·note·summary)를 영문으로 낸다.
//   구조화 출력의 키는 언어와 무관하다. 기본은 한국어이고, ko 출력은 영문화 전과 바이트 단위로 같아야 한다(test:i18n goldens).
//   렌더러와 분석 코드는 L(ko, en) 으로 두 문장을 나란히 적고, 규칙 데이터는 tr(obj, "reason") 으로 reason_en 을 고른다.
import { LANG_ENV } from "./i18n.js";

export type Lang = "ko" | "en";

export function langFromEnv(env: NodeJS.ProcessEnv = process.env): Lang {
  return (env[LANG_ENV] ?? "").trim().toLowerCase() === "en" ? "en" : "ko";
}

let current: Lang = langFromEnv();

export function getLang(): Lang { return current; }
export function setLang(lang: Lang): Lang { const prev = current; current = lang === "en" ? "en" : "ko"; return prev; }

/** 두 언어 문장 중 현재 언어의 것. 한국어 문장은 영문화 전 그대로 둔다. */
export const L = (ko: string, en: string): string => (current === "en" ? en : ko);

/** 규칙 데이터의 문장 필드 — 영문이면 `<key>_en` 이 있을 때 그것을, 없으면 원문. */
export function tr<T extends object>(obj: T, key: keyof T & string): string {
  const en = (obj as Record<string, unknown>)[`${key}_en`];
  const ko = (obj as Record<string, unknown>)[key];
  return current === "en" && typeof en === "string" && en ? en : (typeof ko === "string" ? ko : "");
}

/** 숫자 단위 등 짧은 조각 */
export const isEn = (): boolean => current === "en";
