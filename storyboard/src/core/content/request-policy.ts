// Request policy for every content-loader GET and HEAD (spec §3.2; design p1-step8-design.md §3.4
// rows 1-9 and 36, §4.3, §9 items 21-22; P1-2b). Pure: scripts/content/request.ts makes the
// requests, races sleeps against the deadlines, and asks retryDecision what to do after each
// attempt.

/** Per attempt, headers and body included (§3.4 row 1). */
export const ATTEMPT_TIMEOUT_MS = 15_000
/** One request plus up to 2 retries (§3.4 row 2). */
export const MAX_ATTEMPTS = 3
/** The retry delay is this times the attempt number: 1 s, then 2 s (§3.4 row 4). */
export const RETRY_DELAY_MS = 1_000
/** An integer Retry-After of 1 to this many seconds replaces the delay; more fails at once. */
export const RETRY_AFTER_MAX_SECONDS = 10
/** Media HEADs in flight (§3.4 row 7); GETs run one at a time (row 6). */
export const HEAD_CONCURRENCY = 6
/** The media gate stops after this many failures and lists them all (§3.4 row 8). */
export const MEDIA_FAILURES_MAX = 10
/** Deadlines (§3.4 row 9): the media gate, and the whole load. */
export const MEDIA_DEADLINE_MS = 300_000
export const LOAD_DEADLINE_MS = 600_000

/** What one attempt gave, as the request loop sees it. */
export type AttemptResult =
  /** An answer, with its raw Retry-After header (or null). */
  | { readonly kind: 'response'; readonly status: number; readonly retryAfter: string | null }
  /**
   * No answer: a network error or the per-attempt timer's TimeoutError, named by
   * describeNetworkError, e.g. `TypeError (ECONNREFUSED)` or `TimeoutError`.
   */
  | { readonly kind: 'network'; readonly error: string }
  /**
   * A deadline or the pool's stop signal fired. The caller checks the signals before each
   * attempt and after each failure, because AbortSignal.timeout aborts with TimeoutError for the
   * per-attempt timer and the deadlines alike (§3.4 row 36).
   */
  | { readonly kind: 'stopped' }

export type RetryDecision =
  /** Use this answer as it is: 200 passes; any other status fails at once (3xx, 4xx but 429). */
  | { readonly action: 'final' }
  /** Wait, then try again. */
  | { readonly action: 'retry'; readonly delayMs: number }
  /** Give up: `failed after 3 attempts: <what>` or `asked to wait <n> s`. */
  | { readonly action: 'fail'; readonly reason: string }
  /** A deadline or stop signal fired: never retried; the caller prints the deadline's own message. */
  | { readonly action: 'stopped' }

/** 429 and every 5xx are retried, on GET and HEAD alike (§3.4 row 3). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

/**
 * A Retry-After header as whole seconds (RFC 9110 delta-seconds), or null when it is absent or
 * anything else; an HTTP date counts as unparseable and keeps the normal delay (§3.4 row 4).
 */
export function parseRetryAfter(value: string | null | undefined): number | null {
  const text = value?.trim() ?? ''
  return /^\d{1,15}$/.test(text) ? Number(text) : null
}

/**
 * What to do after attempt number `attempt` (1-based) gave `result` (§4.3):
 * - stopped (deadline or stop signal): `stopped`, never retried;
 * - an answer that is not 429 or 5xx: `final`;
 * - 429, 5xx, a network error or a per-attempt timeout on the last attempt:
 *   `fail` with `failed after 3 attempts: <status n | error name>`;
 * - otherwise a Retry-After above 10 s: `fail` with `asked to wait <n> s`; of 1-10 s: `retry`
 *   after that many seconds; absent, 0 or unparseable: `retry` after retryDelayMs × attempt.
 */
export function retryDecision(
  result: AttemptResult,
  attempt: number,
  retryDelayMs: number = RETRY_DELAY_MS,
): RetryDecision {
  if (result.kind === 'stopped') return { action: 'stopped' }
  if (result.kind === 'response' && !isRetryableStatus(result.status)) return { action: 'final' }
  if (attempt >= MAX_ATTEMPTS) {
    const what = result.kind === 'network' ? result.error : `status ${result.status}`
    return { action: 'fail', reason: `failed after ${MAX_ATTEMPTS} attempts: ${what}` }
  }
  const wait = result.kind === 'response' ? parseRetryAfter(result.retryAfter) : null
  if (wait !== null && wait > RETRY_AFTER_MAX_SECONDS) {
    return { action: 'fail', reason: `asked to wait ${wait} s` }
  }
  if (wait !== null && wait >= 1) return { action: 'retry', delayMs: wait * 1000 }
  return { action: 'retry', delayMs: retryDelayMs * attempt }
}
