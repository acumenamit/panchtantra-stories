// Publish verification (spec §8 `verify`; P0-13 plan file 8). Polls
// `<NEXT_PUBLIC_SITE_URL>/build-info.json?verify=<ms>` with cache: 'no-store' every 5 s until the live
// seq is at least the expected seq.
// - seq equal to the expected value: live. Greater: superseded (a later publish went live first).
// - Every time the live seq goes down between two samples it is recorded and logged as a regression.
// - A missing, redirected or invalid build-info is one more sample; polling continues to the deadline.
import { BuildInfo } from '../../src/core/content/build-info'
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

/** One GET of build-info.json. Never throws for a network or content problem. */
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
    return unavailable(200, `content-type must be application/json, got ${type || 'none'}`)
  }
  if (!bytes) return unavailable(200, 'body unreadable or larger than 1 MiB')
  const json = parseJsonBytes(bytes)
  const info = json.ok ? BuildInfo.safeParse(json.value) : null
  if (!info?.success) return unavailable(200, 'build-info failed strict parse')
  const { seq, deploymentId, appVersion, deploymentUrl, builtAt } = info.data
  return {
    kind: 'live',
    at,
    ms: Math.max(0, now() - at),
    seq,
    deploymentId,
    appVersion,
    deploymentUrl,
    builtAt,
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
  readonly intervalMs?: number
  /** Total time allowed from the first request, in ms. */
  readonly deadlineMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly log?: (line: string) => void
}

export function describeSample(sample: BuildInfoSample): string {
  if (sample.kind === 'unavailable') {
    return `verify: unavailable status=${sample.status ?? '-'} reason=${sample.reason} ms=${sample.ms}`
  }
  return `verify: seq=${sample.seq} deployment=${sample.deploymentId ?? '-'} app=${sample.appVersion ?? '-'} builtAt=${sample.builtAt} ms=${sample.ms}`
}

export async function verifyPublish(options: VerifyOptions): Promise<VerifyOutcome> {
  const { expectedSeq } = options
  if (!Number.isSafeInteger(expectedSeq) || expectedSeq < 1) {
    throw new RangeError('expectedSeq must be an integer >= 1')
  }
  checkServiceUrl(options.siteUrl, 'site URL')
  const now = options.now ?? Date.now
  const intervalMs = options.intervalMs ?? VERIFY_INTERVAL_MS
  const deadlineMs = options.deadlineMs ?? DEFAULT_VERIFY_DEADLINE_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const log = options.log ?? ((line: string) => console.log(line))

  const started = now()
  const regressions: SeqRegression[] = []
  let lastSeq: number | null = null
  for (let samples = 1; ; samples++) {
    const sample = await readBuildInfo(options.siteUrl, options)
    log(describeSample(sample))
    if (sample.kind === 'live') {
      if (lastSeq !== null && sample.seq < lastSeq) {
        regressions.push({ from: lastSeq, to: sample.seq, at: sample.at })
        log(`verify: seq went backwards from ${lastSeq} to ${sample.seq}`)
      }
      lastSeq = sample.seq
      const base = { expectedSeq, samples, regressions }
      if (sample.seq === expectedSeq) {
        log(`verify: live seq=${sample.seq}`)
        return { ...base, kind: 'live', sample }
      }
      if (sample.seq > expectedSeq) {
        log(`verify: superseded expected=${expectedSeq} live=${sample.seq}`)
        return { ...base, kind: 'superseded', sample }
      }
    }
    if (now() - started + intervalMs > deadlineMs) {
      log(`verify: timed out after ${samples} samples; last seq=${lastSeq ?? '-'}`)
      return { expectedSeq, samples, regressions, kind: 'timeout', lastSeq }
    }
    await sleep(intervalMs)
  }
}
