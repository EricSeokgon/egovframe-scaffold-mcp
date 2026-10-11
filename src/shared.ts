// 공용 헬퍼 — 다운로드 타임아웃·fetch·해시.
import { createHash } from "node:crypto";
import { networkHint } from "./network.js";
import { bundleResponseFor } from "./offline-bundle.js";

/** 템플릿 다운로드 제한 시간(ms) — 무응답 시 무한 대기를 방지한다. */
export const DOWNLOAD_TIMEOUT_MS = 30_000;

/** 제한 시간이 적용된 fetch. AbortError를 사람이 읽을 수 있는 메시지로 바꾼다. */
export async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  // v0.42: 폐쇄망 오프라인 번들(EGOVFRAME_OFFLINE_BUNDLE)에 같은 URL 이 있으면 지문 검증 후 그 파일을 쓴다
  if ((init.method ?? "GET").toUpperCase() === "GET") { const hit = bundleResponseFor(url); if (hit) return hit; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    // 실패 원인(프록시 미설정·IPv6·TLS·DNS)에 맞는 한 줄 처방을 붙인다 (v0.31)
    const hint = networkHint(e, url);
    if (e instanceof Error && e.name === "AbortError")
      throw new Error(`요청 시간 초과(${timeoutMs}ms): ${url}\n${hint}`);
    const msg = e instanceof Error ? e.message : String(e);
    const wrapped = new Error(`${msg}\n${hint}`);
    (wrapped as Error & { cause?: unknown }).cause = e;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

/** 공통컴포넌트 저장소 zip 다운로드 제한 시간(ms) — 템플릿보다 커서 별도 값 사용 */
export const COMPONENTS_DOWNLOAD_TIMEOUT_MS = 120_000;

// ── 업그레이드 (v0.17.0) ────────────────────────────────
export function sha256(buf: Buffer | string): string {
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}
