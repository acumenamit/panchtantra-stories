// The media HEAD gate (spec §3.2 "Media HEAD"; design p1-step8-design.md §6, §3.4 rows 7-11 and
// 36-38, §4.5, §9 items 23-27; P1-2b). After every included package passed its gate: the pure
// pre-checks (planMediaHeads), then one HEAD per declared variant, 6 in flight, each judged by
// judgeHead. Failures are collected until every variant is checked or 10 have failed; then the
// pool's stop signal aborts HEADs still in flight (their outcomes are not listed) and the gate
// fails, listing the collected failures in declaration order. The media deadline (300 s) starts
// with the first HEAD; it and the whole-load deadline abort in-flight HEADs and are never retried.
// The whole-load deadline covers rows 2-12 of design §4.1, so it fails the gate even when no HEAD
// is due. HEADs are never added to build-info.fetches; the log lines are those of design §4.5.
import type { GateResult } from '../../src/core/content/gates'
import {
  acceptsByteRanges,
  judgeHead,
  planMediaHeads,
  type MediaHead,
  type MediaPackage,
} from '../../src/core/content/media'
import { HEAD_CONCURRENCY, MEDIA_FAILURES_MAX } from '../../src/core/content/request-policy'
import {
  deadlineSeconds,
  headDecision,
  headOnce,
  loadDeadlineMessage,
  pause,
  runPool,
  startDeadline,
  type Deadline,
  type RequestContext,
} from './request'

export interface MediaGateInput {
  /** The included packages that passed the package gate, in snapshot order. */
  readonly packages: readonly MediaPackage[]
  /** The pointer root ('' in the real layout); media paths are `<root>media/<storyId>/…`. */
  readonly root: string
  /** Objects are requested as `<objectUrl(path)>`, with no query. */
  readonly objectUrl: (path: string) => URL
  /** 300,000 unless a test passes another value. */
  readonly mediaDeadlineMs: number
  readonly ctx: RequestContext
}

interface MediaFailure {
  readonly head: MediaHead
  readonly reason: string
}

/** `answered200`: the final answer was a 200 (only those count for the Accept-Ranges note). */
type HeadOutcome =
  | { readonly kind: 'pass'; readonly ranges: boolean }
  | {
      readonly kind: 'fail'
      readonly reason: string
      readonly answered200: boolean
      readonly ranges: boolean
    }
  | { readonly kind: 'stopped' }

/** The media deadline's failure (design §4.1 row 12). */
export function mediaDeadlineMessage(deadline: Deadline, checked: number, total: number): string {
  return `media HEAD stopped after ${deadlineSeconds(deadline.ms)} s (${checked} of ${total} checked)`
}

/** Runs the gate; on success it has logged the per-story and summary lines. */
export async function runMediaGate(input: MediaGateInput): Promise<GateResult<null>> {
  const { ctx } = input
  const plan = planMediaHeads(input.packages, input.root)
  if (!plan.ok) return plan
  const { heads, stories } = plan.value
  const started = ctx.clock()
  const failures: MediaFailure[] = []
  const stop = new AbortController()
  const counts = { checked: 0, passed: 0, retried: 0, answers: 0, noRanges: 0 }
  // The media deadline starts when the first HEAD starts; with no variant there is none.
  const mediaDeadline = heads.length > 0 ? startDeadline(input.mediaDeadlineMs) : null
  const signals = [ctx.loadDeadline.signal, stop.signal]
  if (mediaDeadline) signals.push(mediaDeadline.signal)

  await runPool(
    heads,
    HEAD_CONCURRENCY,
    async (head) => {
      const outcome = await checkHead(head, input.objectUrl(head.path), signals, ctx, counts)
      // An outcome judged in the same turn as the 10th failure belongs to a HEAD that was in
      // flight at the stop: it is not counted or listed, so at most 10 failures are (design §3.4
      // row 37, §4.5).
      if (outcome.kind === 'stopped' || stop.signal.aborted) return
      counts.checked++
      if (outcome.kind === 'pass' || outcome.answered200) {
        counts.answers++
        if (!outcome.ranges) counts.noRanges++
      }
      if (outcome.kind === 'pass') {
        counts.passed++
        return
      }
      failures.push({ head, reason: outcome.reason })
      if (failures.length >= MEDIA_FAILURES_MAX) stop.abort()
    },
    AbortSignal.any(signals),
  )

  const ms = Math.max(0, Math.round(ctx.clock() - started))
  const sorted = [...failures].sort((a, b) => a.head.order - b.head.order)
  const details = sorted.map(
    ({ head, reason }) =>
      `content: media failed story=${head.storyId} path=${head.path} reason=${reason}`,
  )
  // A whole-load deadline that fired after the last package GET (during the package checks or
  // the pre-checks) fails the gate too, also when there was no HEAD to make (design §4.1).
  const complete = counts.checked === heads.length && !ctx.loadDeadline.signal.aborted
  const listFailures = failures.length >= MEDIA_FAILURES_MAX || (complete && failures.length > 0)
  if (complete && failures.length === 0) {
    for (const story of stories) {
      ctx.log(
        `content: media story=${story.storyId} variants=${story.variants} bytes=${story.bytes} ok`,
      )
    }
  }
  ctx.log(
    `content: media heads=${heads.length} ok=${counts.passed} failed=${failures.length} retried=${counts.retried} ms=${ms}`,
  )
  if (counts.noRanges > 0) {
    ctx.log(
      `content: media note: ${counts.noRanges} of ${counts.answers} answers had no "Accept-Ranges: bytes" (recorded, not a gate)`,
    )
  }
  if (listFailures) {
    const first = sorted[0]
    return {
      ok: false,
      reason: `media HEAD failed for ${failures.length} of ${heads.length} variants; first: ${first?.head.path} ${first?.reason}`,
      details,
    }
  }
  if (!complete) {
    // A deadline fired: the whole-load deadline names itself first, then the media deadline.
    const reason =
      ctx.loadDeadline.signal.aborted || !mediaDeadline
        ? loadDeadlineMessage(ctx.loadDeadline)
        : mediaDeadlineMessage(mediaDeadline, counts.checked, heads.length)
    return { ok: false, reason, details }
  }
  return { ok: true, value: null }
}

/**
 * One variant: HEAD with the request policy until judged. Logs `content: media head …` for each
 * attempt that was not a 200, or that was a retry. `stopped` when a deadline or the stop signal
 * fired, before or during an attempt or a retry sleep.
 */
async function checkHead(
  head: MediaHead,
  url: URL,
  signals: readonly AbortSignal[],
  ctx: RequestContext,
  counts: { retried: number },
): Promise<HeadOutcome> {
  const stopped = () => signals.some((signal) => signal.aborted)
  for (let attempt = 1; ; attempt++) {
    if (stopped()) return { kind: 'stopped' }
    const result = await headOnce(url, [AbortSignal.timeout(ctx.timeoutMs), ...signals], ctx)
    // Deadlines abort with TimeoutError too, so the signals are checked before anything is judged.
    if (stopped()) return { kind: 'stopped' }
    const status = result.kind === 'response' ? String(result.status) : `error(${result.error})`
    if (result.kind === 'network' || result.status !== 200 || attempt > 1) {
      ctx.log(`content: media head path=${head.path} attempt=${attempt} status=${status}`)
    }
    const decision = headDecision(result, attempt, ctx.retryDelayMs)
    if (decision.action === 'final' && result.kind === 'response') {
      const ranges = acceptsByteRanges(result.headers)
      const verdict = judgeHead(head, result.status, result.headers)
      return verdict.ok
        ? { kind: 'pass', ranges }
        : { kind: 'fail', reason: verdict.reason, answered200: result.status === 200, ranges }
    }
    if (decision.action === 'fail') {
      return { kind: 'fail', reason: decision.reason, answered200: false, ranges: true }
    }
    if (decision.action !== 'retry') return { kind: 'stopped' }
    counts.retried++
    await pause(decision.delayMs, signals, ctx)
  }
}
