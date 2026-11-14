// Publish verification (spec §8 `verify` and Takedown; P0-13 plan file 8; P1-8a). Polls
// `<NEXT_PUBLIC_SITE_URL>/build-info.json?verify=<ms>` with cache: 'no-store' every 5 s.
// - Only a production build-info counts. Any other mode (staging, fixtures) is read as unavailable.
// - A read confirms when it is live, its seq is at or above the expected seq, its seq is not lower
//   than the highest live seq seen so far in this run, and (unpublish and takedown) it lists none
//   of `absentStoryIds`. Any other read resets the count to 0, because one matching read can be
//   followed by a brief read of the previous deployment (P0-13 S1-2; owner D2, 2026-11-14).
// - Once a newer seq has been read, an older seq never confirms again in that run, even if it is
//   read many times in a row. At expected 3, after a read of 4, later reads of 3 end in a timeout:
//   a step back after a newer publish is not a settled site (owner decision, 2026-11-14).
// - After CONFIRM_SAMPLES confirming reads in a row (6, about 25 s at the 5 s interval), the latest
//   read decides: seq equal to the expected value is live; greater is superseded (a later publish
//   went live first). Both need the same run of confirming reads.
// - Every time the live seq goes down from the previous live read it is recorded and logged as a
//   regression.
// - A story counts as listed only when build-info `stories` names it. A story named only in
//   `excluded` was left out of the build, so for `absentStoryIds` it counts as gone.
// - A missing, redirected or invalid build-info is one more sample; polling continues to the
//   deadline, which counts from the first request. Reaching the deadline before the count is full
//   is a timeout, even if some reads confirmed.
// - Log lines never name an absent story: in Actions those ids are workflow inputs, and run logs
//   are public (spec §8).
// - Text the site sends back (deploymentId, appVersion) is reduced to safe characters and cut to
//   64 characters before it is printed, so it can never add a line to the log (see safeLogValue).
import { BuildInfo } from '../../src/core/content/build-info'
import { StoryId } from '../../src/core/package/v1'
import {
  checkServiceUrl,
  describeNetworkError,
  mediaType,
  parseJsonBytes,
  readCapped,
} from './http'

export const VERIFY_INTERVAL_MS = 5_000
export const DEFAULT_VERIFY_DEADLINE_MS = 20 * 60_000
export const REQUEST_TIMEOUT_MS = 15_000
/** Consecutive confirming reads needed before verify reports live or superseded (owner D2). */
export const CONFIRM_SAMPLES = 6
const MAX_BUILD_INFO_BYTES = 1024 * 1024

export interface LiveSample {
  readonly kind: 'live'
  /** Epoch ms when the request started; also the value of the verify query parameter. */
  readonly at: number
  readonly ms: number
  readonly seq: number
  readonly deploymentId: string | null
  readonly appVersion: string | null
  readonly deploymentUrl: string | null
  readonly builtAt: string
  /**
   * The story ids this build loaded (build-info `stories`), in build-info order. Ids that are only
   * in build-info `excluded` are not here: the build did not load them.
   */
  readonly storyIds: readonly string[]
}

export interface UnavailableSample {
  readonly kind: 'unavailable'
  readonly at: number
  readonly ms: number
  /** null: network error or timeout. */
  readonly status: number | null
  readonly reason: string
}

export type BuildInfoSample = LiveSample | UnavailableSample

export interface ReadOptions {
  readonly fetchImpl?: typeof fetch
  /** Epoch milliseconds. */
  readonly now?: () => number
  readonly timeoutMs?: number
}

/** The URL of one sample: <origin>/build-info.json?verify=<at>. */
export function buildInfoUrl(siteUrl: URL, at: number): URL {
  checkServiceUrl(siteUrl, 'site URL')
  const url = new URL('/build-info.json', siteUrl.origin)
  url.searchParams.set('verify', String(at))
  return url
}

/**
 * One GET of build-info.json. Never throws for a network or content problem. A build-info that
 * passes the strict parse but is not from a production build (staging, fixtures) is unavailable.
 */
export async function readBuildInfo(
  siteUrl: URL,
  options: ReadOptions = {},
): Promise<BuildInfoSample> {
  const now = options.now ?? Date.now
  const at = now()
  const url = buildInfoUrl(siteUrl, at)
  const unavailable = (status: number | null, reason: string): UnavailableSample => ({
    kind: 'unavailable',
    at,
    ms: Math.max(0, now() - at),
    status,
    reason,
  })
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return unavailable(null, `network ${describeNetworkError(error)}`)
  }
  const bytes = await readCapped(response, MAX_BUILD_INFO_BYTES).catch(() => null)
  if (response.status !== 200) return unavailable(response.status, 'status is not 200')
  const type = mediaType(response.headers.get('content-type'))
  if (type !== 'application/json') {
    // The header comes from the network: print it only in the safe, capped form (owner, 2026-11-14).
    return unavailable(
      200,
      `content-type must be application/json, got ${type ? safeLogValue(type) : 'none'}`,
    )
  }
  if (!bytes) return unavailable(200, 'body unreadable or larger than 1 MiB')
  const json = parseJsonBytes(bytes)
  const info = json.ok ? BuildInfo.safeParse(json.value) : null
  if (!info?.success) return unavailable(200, 'build-info failed strict parse')
  const { mode, seq, deploymentId, appVersion, deploymentUrl, builtAt, stories } = info.data
  // The mode passed the strict parse, so it is one of the fixed gate mode names and safe to print.
  if (mode !== 'production') return unavailable(200, `build-info mode is ${mode}, not production`)
  return {
    kind: 'live',
    at,
    ms: Math.max(0, now() - at),
    seq,
    deploymentId,
    appVersion,
    deploymentUrl,
    builtAt,
    storyIds: stories.map((story) => story.storyId),
  }
}

export interface SeqRegression {
  readonly from: number
  readonly to: number
  readonly at: number
}

interface OutcomeBase {
  readonly expectedSeq: number
  readonly samples: number
  readonly regressions: readonly SeqRegression[]
}

export type VerifyOutcome =
  | (OutcomeBase & { readonly kind: 'live'; readonly sample: LiveSample })
  | (OutcomeBase & { readonly kind: 'superseded'; readonly sample: LiveSample })
  | (OutcomeBase & { readonly kind: 'timeout'; readonly lastSeq: number | null })

export interface VerifyOptions extends ReadOptions {
  readonly siteUrl: URL
  readonly expectedSeq: number
  /**
   * The unpublish and takedown check (spec §8 Takedown): story ids that must be gone from the
   * live build. A read whose build-info `stories` still lists any of them does not confirm; a
   * story named only in `excluded` counts as gone. Each must be a valid story id, listed once.
   * Leave it out for a plain publish. An empty list is refused with a RangeError before any
   * request (owner decision, 2026-11-14).
   */
  readonly absentStoryIds?: readonly string[]
  /** Time between reads, in ms. When given, it must be a finite number above 0. */
  readonly intervalMs?: number
  /**
   * Total time allowed from the first request, in ms. When given, it must be a finite number
   * above 0.
   */
  readonly deadlineMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly log?: (line: string) => void
}

/** The most characters of one value from the site that a log line prints. */
const MAX_LOG_VALUE_LENGTH = 64

/**
 * A value from build-info (deploymentId, appVersion) made safe for one log line. Each character
 * other than A-Z a-z 0-9 . _ : / - becomes '?', one '?' per character, and the result is cut to
 * 64 characters. A missing or empty value prints as '-'. No newline or other control character
 * survives, so the value can never start a new log line (in Actions, a line that starts with
 * "::error::" is read as a workflow command).
 */
function safeLogValue(value: string | null): string {
  if (!value) return '-'
  return value.replace(/[^A-Za-z0-9._:/-]/gu, '?').slice(0, MAX_LOG_VALUE_LENGTH)
}

export function describeSample(sample: BuildInfoSample): string {
  if (sample.kind === 'unavailable') {
    return `verify: unavailable status=${sample.status ?? '-'} reason=${sample.reason} ms=${sample.ms}`
  }
  return `verify: seq=${sample.seq} deployment=${safeLogValue(sample.deploymentId)} app=${safeLogValue(sample.appVersion)} builtAt=${sample.builtAt} ms=${sample.ms}`
}

/** Checks absentStoryIds before any request. The error never echoes the input. */
function readAbsentStoryIds(value: unknown): ReadonlySet<string> {
  if (value === undefined) return new Set()
  // Array.from reads every index, so a hole in a sparse list is checked (as undefined) and
  // refused, where every() on the list itself would skip it.
  if (!Array.isArray(value) || !Array.from(value).every((id) => StoryId.safeParse(id).success)) {
    throw new RangeError('absentStoryIds must be a list of story ids')
  }
  if (value.length === 0) throw new RangeError('absentStoryIds must not be empty')
  const ids = new Set<string>(value)
  if (ids.size !== value.length) throw new RangeError('absentStoryIds must not repeat a story id')
  return ids
}

/**
 * Checks intervalMs or deadlineMs before any request: left out, it is `fallback`; given, it must
 * be a finite number above 0. The error names the option, never the value.
 */
function readDuration(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number > 0`)
  }
  return value
}

/**
 * Why a read does not confirm, or null when it does. `highestSeq` is the highest seq of any live
 * read before this one in this run, across unavailable reads, or null before the first live read.
 */
function notConfirmedReason(
  sample: BuildInfoSample,
  highestSeq: number | null,
  expectedSeq: number,
  absent: ReadonlySet<string>,
): string | null {
  if (sample.kind !== 'live') return 'build-info unavailable'
  if (sample.seq < expectedSeq) return `seq ${sample.seq} is below expected ${expectedSeq}`
  if (highestSeq !== null && sample.seq < highestSeq) {
    return `seq ${sample.seq} is below the highest live seq ${highestSeq}`
  }
  if (sample.storyIds.some((id) => absent.has(id))) return 'an unpublished story is still listed'
  return null
}

export async function verifyPublish(options: VerifyOptions): Promise<VerifyOutcome> {
  const { expectedSeq } = options
  if (!Number.isSafeInteger(expectedSeq) || expectedSeq < 1) {
    throw new RangeError('expectedSeq must be an integer >= 1')
  }
  const absent = readAbsentStoryIds(options.absentStoryIds)
  const intervalMs = readDuration(options.intervalMs, 'intervalMs', VERIFY_INTERVAL_MS)
  const deadlineMs = readDuration(options.deadlineMs, 'deadlineMs', DEFAULT_VERIFY_DEADLINE_MS)
  checkServiceUrl(options.siteUrl, 'site URL')
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const log = options.log ?? ((line: string) => console.log(line))

  const started = now()
  const regressions: SeqRegression[] = []
  // lastSeq is the previous live read (regressions and the timeout report); highestSeq is the
  // highest live read so far (the confirm rule).
  let lastSeq: number | null = null
  let highestSeq: number | null = null
  let confirming = 0
  for (let samples = 1; ; samples++) {
    const sample = await readBuildInfo(options.siteUrl, options)
    log(describeSample(sample))
    const reason = notConfirmedReason(sample, highestSeq, expectedSeq, absent)
    if (sample.kind === 'live') {
      if (lastSeq !== null && sample.seq < lastSeq) {
        regressions.push({ from: lastSeq, to: sample.seq, at: sample.at })
        log(`verify: seq went backwards from ${lastSeq} to ${sample.seq}`)
      }
      lastSeq = sample.seq
      highestSeq = Math.max(highestSeq ?? sample.seq, sample.seq)
    }
    // A null reason always means a live read; the kind check is there for the type checker.
    if (reason === null && sample.kind === 'live') {
      confirming++
      log(`verify: confirming seq=${sample.seq} ${confirming}/${CONFIRM_SAMPLES}`)
      if (confirming >= CONFIRM_SAMPLES) {
        const base = { expectedSeq, samples, regressions }
        if (sample.seq > expectedSeq) {
          log(`verify: superseded expected=${expectedSeq} live=${sample.seq}`)
          return { ...base, kind: 'superseded', sample }
        }
        log(`verify: live seq=${sample.seq}`)
        return { ...base, kind: 'live', sample }
      }
    } else if (confirming > 0) {
      log(`verify: count reset from ${confirming}/${CONFIRM_SAMPLES} to 0: ${reason}`)
      confirming = 0
    } else if (sample.kind === 'live' && sample.seq >= expectedSeq) {
      // The sample line alone does not show why a read at or above the expected seq is not counted.
      log(`verify: not confirming: ${reason}`)
    }
    if (now() - started + intervalMs > deadlineMs) {
      log(`verify: timed out after ${samples} samples; last seq=${lastSeq ?? '-'}`)
      return { expectedSeq, samples, regressions, kind: 'timeout', lastSeq }
    }
    await sleep(intervalMs)
  }
}
