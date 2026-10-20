// progress: 장시간 도구의 진행 알림·취소 (v1.2)
//   - 클라이언트가 요청 `_meta.progressToken` 을 주면 단계마다 `notifications/progress` 를 보낸다(안 주면 아무것도 보내지 않음).
//   - 클라이언트의 `notifications/cancelled` 는 SDK 가 `extra.signal`(AbortSignal) 로 넘긴다. 긴 작업은 단계 사이에서
//     `throwIfAborted` 로 멈추고, 자식 프로세스는 Runner 가 signal 로 트리째 종료한다. 트랜잭션 안에서 던지면 파일은 되돌아간다.
//   - 모듈은 이 파일의 `Progress` 만 알고 MCP SDK 는 server.ts 에서만 다룬다(CLI·라이브러리 호출은 noop).

export interface Progress {
  /** 단계 보고. total 을 알면 함께(모르면 생략). done 은 단조 증가해야 한다. */
  report(message: string, done: number, total?: number): void;
  /** 취소 신호(없으면 취소 불가) */
  readonly signal?: AbortSignal;
}

export interface ProgressEvent { message: string; progress: number; total?: number }

/** 취소로 끝난 작업이 던지는 오류(name === "AbortError"). 핸들러·CLI 는 이것으로 취소를 구분한다. */
export class AbortError extends Error {
  constructor(message = "cancelled") { super(message); this.name = "AbortError"; }
}
export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/** 취소됐으면 AbortError 를 던진다 — 긴 작업의 단계 경계에서 부른다 */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new AbortError();
}

/** 아무것도 보내지 않는 Progress(옵션이 없을 때 기본값) */
export const NOOP_PROGRESS: Progress = { report() { /* noop */ } };

/** 테스트·CLI 용: 이벤트를 배열에 모으는 Progress */
export function collectProgress(signal?: AbortSignal): Progress & { events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  return { events, signal, report(message, done, total) { events.push({ message, progress: done, ...(total !== undefined ? { total } : {}) }); } };
}

/**
 * 상위 Progress 의 한 구간(from..to)을 하위 작업이 0..subTotal 로 쓰게 한다.
 * 예: 납품 패키지의 항목 3/7 이 SBOM 생성을 호출하면 SBOM 의 단계가 3.0~4.0 사이의 소수 진행으로 보고된다.
 */
export function subProgress(parent: Progress | undefined, from: number, to: number, total: number, prefix?: string): Progress {
  if (!parent) return NOOP_PROGRESS;
  return {
    signal: parent.signal,
    report(message, done, subTotal) {
      const frac = subTotal && subTotal > 0 ? Math.min(done / subTotal, 1) : 0;
      parent.report(prefix ? `${prefix}: ${message}` : message, round3(from + (to - from) * frac), total);
    },
  };
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 정해진 단계 목록을 순서대로 보고하는 도우미. `step(i)` 는 i번째 단계를 시작한다는 뜻(done = i, total = steps.length),
 * `finish()` 는 done = total. 보고 때마다 취소도 확인한다.
 */
export function stepper(progress: Progress | undefined, steps: readonly string[]) {
  const p = progress ?? NOOP_PROGRESS;
  return {
    total: steps.length,
    step(i: number, detail?: string): void {
      throwIfAborted(p.signal);
      p.report(detail ? `${steps[i]} — ${detail}` : steps[i], i, steps.length);
    },
    finish(message = "done"): void { p.report(message, steps.length, steps.length); },
    get signal() { return p.signal; },
  };
}

/** MCP 핸들러의 extra 에서 Progress 를 만든다(server.ts 전용). progressToken 이 없으면 알림은 보내지 않고 signal 만 넘긴다. */
export function progressFromExtra(extra: {
  _meta?: { progressToken?: string | number } | undefined;
  signal?: AbortSignal;
  sendNotification?: (n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
}): Progress {
  const token = extra._meta?.progressToken;
  const send = extra.sendNotification;
  let last = -1;
  let chain: Promise<void> = Promise.resolve();
  return {
    signal: extra.signal,
    report(message, done, total) {
      if (token === undefined || token === null || !send) return;
      last = Math.max(last, done); // 단조 증가 보장(같은 값 반복은 허용)
      const params = { progressToken: token, progress: last, ...(total !== undefined ? { total } : {}), message };
      // 순서를 지켜 보내고, 보내기 실패(연결 종료 등)는 작업을 멈추지 않는다
      chain = chain.then(() => send({ method: "notifications/progress", params })).catch(() => { /* ignore */ });
    },
  };
}
