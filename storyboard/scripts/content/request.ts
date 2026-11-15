// The content loader's requests (spec §3.2; design p1-step8-design.md §3.4 rows 1-9 and 36-37,
// §4.3, §9 items 21-22 and 24; P1-2b). GETs of public JSON objects (pointer, snapshot, packages)
// and HEADs of media variants share one policy: `accept-encoding: identity`, no redirect followed,
// a 15 s timer per attempt (headers and body), the whole-load deadline, and the retry decisions of
// src/core/content/request-policy.ts. A fired deadline (or the media pool's stop signal) is never
// retried and always gives its own message; retry sleeps race the same signals.
// Messages and log lines carry storage paths, status codes and error names only, never a URL.
import type { ContentFetch } from '../../src/core/content/build-info'
import type { GateResult } from '../../src/core/content/gates'
import { retryDecision, type AttemptResult } from '../../src/core/content/request-policy'
import { sha256Hex } from '../../src/core/hashing'
import { describeNetworkError, mediaType, readCapped } from '../../tools/publisher/http'

/** The most a pointer, snapshot or package may weigh (and a fixture file). */
export const MAX_BODY_BYTES = 1024 * 1024

/** A deadline: its signal, and its length for the message that names it. */
export interface Deadline {
  readonly signal: AbortSignal
  readonly ms: number
}

/** A deadline that starts now (AbortSignal.timeout aborts with TimeoutError when it fires). */
export function startDeadline(ms: number): Deadline {
  return { signal: AbortSignal.timeout(ms), ms }
}

/** "600" for 600,000 ms; tests pass small deadlines, so fractions stay readable ("0.2"). */
export function deadlineSeconds(ms: number): string {
  return String(ms / 1000)
}

/** The whole-load deadline's failure (design §4.1, §9 item 22). */
export function loadDeadlineMessage(deadline: Deadline): string {
  return `content loading exceeded ${deadlineSeconds(deadline.ms)} s`
}

export interface RequestContext {
  readonly fetchImpl: typeof fetch
  readonly clock: () => number
  /** An injected sleep (tests); without one a timer is used. Raced against the signals either way. */
  readonly sleep: ((ms: number) => Promise<void>) | undefined
  readonly log: (line: string) => void
  /** Per attempt; 15 s unless a test passes another value. */
  readonly timeoutMs: number
  /** The retry delay is this times the attempt number. */
  readonly retryDelayMs: number
  /** Every GET attempt, for build-info. HEADs are never recorded here (design §3.4 row 10). */
  readonly fetches: ContentFetch[]
  /** The whole-load deadline (600 s), started before the pointer GET. */
  readonly loadDeadline: Deadline
}

const ok = <T>(value: T): GateResult<T> => ({ ok: true, value })
const fail = <T>(reason: string): GateResult<T> => ({ ok: false, reason })

/** The CDN location from a cf-ray header such as "8f1a2b3c4d5e6f70-BOM". */
export function popFromCfRay(cfRay: string | null): string | null {
  const pop = cfRay?.split('-').pop()
  return pop && /^[A-Za-z0-9]{2,8}$/.test(pop) ? pop.toUpperCase() : null
}

/** A header value for a log line: printable ASCII without spaces, at most 64 characters. */
function headerValue(headers: Headers, name: string): string | null {
  const value = headers
    .get(name)
    ?.replace(/[^\x21-\x7e]/g, '')
    .slice(0, 64)
  return value ? value : null
}

function parseAge(headers: Headers): number | null {
  const age = headers.get('age')?.trim() ?? ''
  return /^\d{1,9}$/.test(age) ? Number(age) : null
}

/** The seq field of a JSON body, for the fetch and read log lines only (gates run later). */
export function peekSeq(body: Uint8Array): string {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body))
    if (typeof value === 'object' && value !== null && 'seq' in value) {
      const seq = (value as { seq: unknown }).seq
      if (typeof seq === 'number' && Number.isSafeInteger(seq)) return String(seq)
    }
  } catch {
    // not JSON: the gates report it
  }
  return '-'
}

const aborted = (signals: readonly AbortSignal[]) => signals.some((signal) => signal.aborted)

/**
 * Waits `ms`, or less when any signal aborts first. An injected sleep is raced against the
 * signals; the default timer is cleared on abort, so nothing is left pending.
 */
export async function pause(
  ms: number,
  signals: readonly AbortSignal[],
  ctx: Pick<RequestContext, 'sleep'>,
): Promise<void> {
  if (aborted(signals)) return
  const any = AbortSignal.any([...signals])
  await new Promise<void>((done) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer)
      any.removeEventListener('abort', finish)
      done()
    }
    any.addEventListener('abort', finish, { once: true })
    if (ctx.sleep) ctx.sleep(ms).then(finish, finish)
    else timer = setTimeout(finish, ms)
  })
}

type GetAttempt =
  | { readonly kind: 'network'; readonly error: string; readonly ms: number }
  | {
      readonly kind: 'response'
      readonly status: number
      readonly headers: Headers
      readonly body: Uint8Array<ArrayBuffer> | null // null: larger than MAX_BODY_BYTES
      readonly ms: number
    }

/** One GET attempt: identity encoding, no redirect, the per-attempt timer and the load deadline. */
async function getOnce(url: URL, ctx: RequestContext): Promise<GetAttempt> {
  const started = ctx.clock()
  const elapsed = () => Math.max(0, Math.round(ctx.clock() - started))
  try {
    const response = await ctx.fetchImpl(url, {
      headers: { 'accept-encoding': 'identity' },
      redirect: 'manual',
      signal: AbortSignal.any([AbortSignal.timeout(ctx.timeoutMs), ctx.loadDeadline.signal]),
    })
    const body = await readCapped(response, MAX_BODY_BYTES)
    return {
      kind: 'response',
      status: response.status,
      headers: response.headers,
      body,
      ms: elapsed(),
    }
  } catch (error) {
    return { kind: 'network', error: describeNetworkError(error), ms: elapsed() }
  }
}

/** One build-info row and one `content: fetch …` line per GET attempt. */
async function record(path: string, attempt: GetAttempt, ctx: RequestContext): Promise<void> {
  const row: ContentFetch =
    attempt.kind === 'network'
      ? {
          path,
          status: null,
          cfCacheStatus: null,
          age: null,
          pop: null,
          sha256: null,
          ms: attempt.ms,
        }
      : {
          path,
          status: attempt.status,
          cfCacheStatus: headerValue(attempt.headers, 'cf-cache-status'),
          age: parseAge(attempt.headers),
          pop: popFromCfRay(headerValue(attempt.headers, 'cf-ray')),
          sha256: attempt.body ? (await sha256Hex(attempt.body)).slice(0, 12) : null,
          ms: attempt.ms,
        }
  ctx.fetches.push(row)
  const seq = attempt.kind === 'response' && attempt.body ? peekSeq(attempt.body) : '-'
  const status = attempt.kind === 'network' ? `error(${attempt.error})` : String(attempt.status)
  ctx.log(
    `content: fetch path=${path} status=${status} cf=${row.cfCacheStatus ?? '-'} age=${row.age ?? '-'} pop=${row.pop ?? '-'} sha=${row.sha256 ?? '-'} seq=${seq}`,
  )
}

/**
 * GETs one JSON object: exactly 200, application/json (parameters ignored), at most
 * MAX_BODY_BYTES. A network error, a per-attempt timeout, 429 or 5xx is retried (at most 3
 * attempts; 1 s × attempt, or a Retry-After of 1-10 s; above 10 s it fails at once). Other 3xx
 * and 4xx fail at once. A fired load deadline fails with its own message and is never retried.
 */
export async function getJson(
  label: string,
  path: string,
  url: URL,
  ctx: RequestContext,
): Promise<GateResult<Uint8Array<ArrayBuffer>>> {
  const deadline = ctx.loadDeadline
  for (let attempt = 1; ; attempt++) {
    if (deadline.signal.aborted) return fail(loadDeadlineMessage(deadline))
    const result = await getOnce(url, ctx)
    await record(path, result, ctx)
    // The deadline aborts with TimeoutError too, so it is checked before the answer is judged.
    if (deadline.signal.aborted) return fail(loadDeadlineMessage(deadline))
    if (result.kind === 'response' && result.status === 200) {
      const type = mediaType(result.headers.get('content-type'))
      if (type !== 'application/json') {
        return fail(`${label} content-type must be application/json, got ${type || 'none'}`)
      }
      if (!result.body) return fail(`${label} is larger than ${MAX_BODY_BYTES} bytes`)
      return ok(result.body)
    }
    const decision = retryDecision(attemptResult(result), attempt, ctx.retryDelayMs)
    if (decision.action === 'final') {
      const status = result.kind === 'response' ? result.status : 0
      return fail(`${label} GET returned status ${status}`) // 3xx and 4xx (but 429) never retried
    }
    if (decision.action === 'fail') return fail(`${label} GET ${decision.reason}`)
    if (decision.action === 'stopped') return fail(loadDeadlineMessage(deadline))
    await pause(decision.delayMs, [deadline.signal], ctx)
  }
}

function attemptResult(
  result: { readonly kind: 'network'; readonly error: string } | HeadResponse | GetAttempt,
): AttemptResult {
  return result.kind === 'network'
    ? { kind: 'network', error: result.error }
    : { kind: 'response', status: result.status, retryAfter: result.headers.get('retry-after') }
}

interface HeadResponse {
  readonly kind: 'response'
  readonly status: number
  readonly headers: Headers
}

export type HeadAttempt = HeadResponse | { readonly kind: 'network'; readonly error: string }

/**
 * One HEAD attempt with the given signals (the caller passes the per-attempt timer, the load and
 * media deadlines and the pool's stop signal). The body is never read, and never through
 * readCapped, which would read a content-length above 1 MiB as "too large"; it is cancelled.
 */
export async function headOnce(
  url: URL,
  signals: readonly AbortSignal[],
  ctx: Pick<RequestContext, 'fetchImpl'>,
): Promise<HeadAttempt> {
  try {
    const response = await ctx.fetchImpl(url, {
      method: 'HEAD',
      headers: { 'accept-encoding': 'identity' },
      redirect: 'manual',
      signal: AbortSignal.any([...signals]),
    })
    try {
      await response.body?.cancel()
    } catch {
      // a HEAD answer has no body; nothing to release
    }
    return { kind: 'response', status: response.status, headers: response.headers }
  } catch (error) {
    return { kind: 'network', error: describeNetworkError(error) }
  }
}

/** The retry decision for a HEAD attempt (the same policy as GET). */
export function headDecision(result: HeadAttempt, attempt: number, retryDelayMs: number) {
  return retryDecision(attemptResult(result), attempt, retryDelayMs)
}

/**
 * Runs `worker` over `items` with at most `size` in flight, in item order. No new item starts
 * once `stop` has aborted; items already running finish (their own signals end them). `worker`
 * must not throw.
 */
export async function runPool<T>(
  items: readonly T[],
  size: number,
  worker: (item: T, index: number) => Promise<void>,
  stop: AbortSignal,
): Promise<void> {
  let next = 0
  const lane = async (): Promise<void> => {
    while (!stop.aborted && next < items.length) {
      const index = next++
      await worker(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane))
}
