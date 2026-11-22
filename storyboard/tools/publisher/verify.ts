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
// - Step 15b (design migration-input/p1-step15b-design.md D15B-16, D15B-18, D15B-21): the `detail`
//   option adds the confirmed read's build (snapshot sha256, featured id, stories, excluded) to the
//   live or superseded sample; without it the outcome and every log line are as before. The
//   public reads live here too, so no other module opens a network connection: readPublicObject
//   (one stored object re-hashed against its name), checkRange (the full GET, then one middle
//   range) and checkLanding (one landing page). The caller (cli.ts) binds the site URL and the
//   public content base; this module holds no route. The full GET, readPublicObject and
//   checkLanding send `accept-encoding: identity`; the range GET sends only `range`, because
//   Node's fetch adds `accept-encoding: identity` itself to a request with a range (PB2). No public
//   GET sets a cache option; only the build-info read keeps `cache: 'no-store'`. Each public GET
//   is tried again at most twice, after 1 s and 2 s, on a network error, a timeout, 429 or 5xx, and
//   never follows a redirect. They print nothing; a network or content problem is a typed answer,
//   a caller error a TypeError before any request.
import { BuildInfo } from '../../src/core/content/build-info'
import { sha256Hex } from '../../src/core/hashing'
import { ENABLED_LOCALE_CODES } from '../../src/core/locales'
import { StoryId } from '../../src/core/package/v1'
import {
  checkServiceUrl,
  describeNetworkError,
  mediaType,
  parseJsonBytes,
  readCapped,
} from './http'
import { classOfPath } from './storage-layout'

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
 * What one live build loaded, from the same build-info read as its sample (the detail option,
 * D15B-21): ids, versions, hashes and build-info's one excluded reason.
 */
export interface LiveBuildDetail {
  readonly snapshotSha256: string
  readonly featuredStoryId: string | null
  readonly stories: readonly {
    readonly storyId: string
    readonly version: number
    readonly packageSha256: string
  }[]
  readonly excluded: readonly {
    readonly storyId: string
    readonly version: number
    readonly reason: 'approval-missing'
  }[]
}

/**
 * One GET of build-info.json. Never throws for a network or content problem. A build-info that
 * passes the strict parse but is not from a production build (staging, fixtures) is unavailable.
 */
export async function readBuildInfo(
  siteUrl: URL,
  options: ReadOptions = {},
): Promise<BuildInfoSample> {
  return (await readSample(siteUrl, options)).sample
}

/** readBuildInfo's read, with the build detail of a live sample (null for an unavailable one). */
async function readSample(
  siteUrl: URL,
  options: ReadOptions,
): Promise<{ readonly sample: BuildInfoSample; readonly build: LiveBuildDetail | null }> {
  const now = options.now ?? Date.now
  const at = now()
  const url = buildInfoUrl(siteUrl, at)
  const unavailable = (
    status: number | null,
    reason: string,
  ): { readonly sample: UnavailableSample; readonly build: null } => ({
    sample: { kind: 'unavailable', at, ms: Math.max(0, now() - at), status, reason },
    build: null,
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
  const sample: LiveSample = {
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
  const build: LiveBuildDetail = {
    snapshotSha256: info.data.snapshotSha256,
    featuredStoryId: info.data.featuredStoryId,
    stories: stories.map(({ storyId, version, packageSha256 }) => ({
      storyId,
      version,
      packageSha256,
    })),
    excluded: info.data.excluded.map(({ storyId, version, reason }) => ({
      storyId,
      version,
      reason,
    })),
  }
  return { sample, build }
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

/** A confirmed sample; it carries `build` only when verifyPublish was asked for detail. */
export type ConfirmedSample = LiveSample & { readonly build?: LiveBuildDetail }

export type VerifyOutcome =
  | (OutcomeBase & { readonly kind: 'live'; readonly sample: ConfirmedSample })
  | (OutcomeBase & { readonly kind: 'superseded'; readonly sample: ConfirmedSample })
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
  /**
   * Step 15b (D15B-21): when true, a live or superseded outcome's sample also carries `build`, the
   * LiveBuildDetail of the same read. Left out, the outcome is built exactly as before (no `build`
   * key) and the log is the same either way.
   */
  readonly detail?: boolean
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
    const { sample, build } = await readSample(options.siteUrl, options)
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
        // The detail option adds the same read's build; without it the sample is as it was read.
        const confirmed: ConfirmedSample =
          options.detail === true && build !== null ? { ...sample, build } : sample
        if (sample.seq > expectedSeq) {
          log(`verify: superseded expected=${expectedSeq} live=${sample.seq}`)
          return { ...base, kind: 'superseded', sample: confirmed }
        }
        log(`verify: live seq=${sample.seq}`)
        return { ...base, kind: 'live', sample: confirmed }
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

// ---- Step 15b: the public reads (D15B-16, D15B-21) ----

/** The waits before the second and the third try of a public GET (spec §1.4's policy, no Retry-After). */
export const PUBLIC_RETRY_DELAYS_MS: readonly number[] = Object.freeze([1_000, 2_000])
/** A landing page is read to here, then discarded. */
const MAX_LANDING_BYTES = 4 * 1024 * 1024
/** Every public GET but the range GET asks for the stored bytes as they are. */
const IDENTITY: Readonly<Record<string, string>> = Object.freeze({ 'accept-encoding': 'identity' })
const SHA256_HEX = /^[0-9a-f]{64}$/

export interface PublicReadOptions {
  readonly fetchImpl?: typeof fetch
  /** Per request, in ms; REQUEST_TIMEOUT_MS (15 s) when left out. */
  readonly timeoutMs?: number
  /** The wait before a retry (PUBLIC_RETRY_DELAYS_MS). */
  readonly sleep?: (ms: number) => Promise<void>
}

/** A stored object to re-hash: its content path, its size and its media type. */
export interface PublicObject {
  readonly path: string
  readonly bytes: number
  readonly mime: string
}
export type PublicObjectReason =
  'status' | 'length' | 'type' | 'encoding' | 'hash' | 'redirect' | 'network' | 'too-large'
export type PublicObjectAnswer =
  | { readonly kind: 'ok' }
  | { readonly kind: 'failed'; readonly reason: PublicObjectReason; readonly status: number | null }

/** The Range check's MP3: its content path, its size and its sha256 (the path's 64 hex). */
export interface RangeTarget {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}
export type RangeReason =
  | 'full-status'
  | 'full-length'
  | 'full-type'
  | 'full-encoding'
  | 'full-hash'
  | 'too-large'
  | 'status'
  | 'content-range'
  | 'length'
  | 'bytes'
  | 'type'
  | 'encoding'
  | 'redirect'
  | 'network'
export type RangeAnswer =
  | { readonly kind: 'ok'; readonly start: number; readonly end: number; readonly size: number }
  | { readonly kind: 'failed'; readonly reason: RangeReason; readonly status: number | null }

export type LandingReason = 'status' | 'type' | 'redirect' | 'network' | 'too-large'
export type LandingAnswer =
  | { readonly kind: 'ok' }
  | { readonly kind: 'failed'; readonly reason: LandingReason; readonly status: number | null }

/** The end of one public GET with retries: the judged answer, a redirect, or the last failure. */
type Got<T> =
  | { readonly kind: 'answer'; readonly value: T }
  | { readonly kind: 'redirect'; readonly status: number }
  | {
      readonly kind: 'gave-up'
      readonly cause: 'network' | 'status'
      readonly status: number | null
    }

/** Cancels a body this module will not read, so the connection is freed (best effort). */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The body is already gone; nothing to free.
  }
}

/** True when the answer is not encoded: no content-encoding, or exactly identity. */
const isIdentity = (value: string | null): boolean =>
  value === null || value.trim().toLowerCase() === 'identity'

/**
 * One public GET under D15B-16 step 4's policy: `headers` exactly, `redirect: 'manual'`, the
 * timeout, no cache option. A network error, a timeout, 429 or 5xx (also a body read that fails
 * inside `judge`) is tried again after 1 s, then after 2 s; a 3xx is a redirect; any other answer
 * goes to `judge`, whose result is final.
 */
async function getWithRetries<T>(
  url: URL,
  headers: Readonly<Record<string, string>>,
  options: PublicReadOptions,
  judge: (response: Response) => Promise<T>,
): Promise<Got<T>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  let last: { readonly cause: 'network' | 'status'; readonly status: number | null } = {
    cause: 'network',
    status: null,
  }
  for (let attempt = 0; attempt <= PUBLIC_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(PUBLIC_RETRY_DELAYS_MS[attempt - 1] ?? 0)
    let response: Response
    try {
      response = await fetchImpl(url, {
        headers: { ...headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      last = { cause: 'network', status: null }
      continue
    }
    const status = response.status
    if (status >= 300 && status < 400) {
      await discard(response)
      return { kind: 'redirect', status }
    }
    if (status === 429 || status >= 500) {
      await discard(response)
      last = { cause: 'status', status }
      continue
    }
    try {
      return { kind: 'answer', value: await judge(response) }
    } catch {
      // A body read that failed or timed out part way: a network failure.
      last = { cause: 'network', status: null }
    }
  }
  return { kind: 'gave-up', ...last }
}

/** A public base or site URL: https, or http on loopback; no credentials, query or fragment. */
function checkPublicBase(url: URL, label: string): void {
  checkServiceUrl(url, label)
  if (url.search !== '') throw new TypeError(`${label} must not carry a query`)
}

/**
 * The URL of a stored object: `base.origin` + `base.pathname` + `/` + path, compared exactly
 * afterwards. The path must be of the content media or package class (classOfPath); its 64 hex is
 * the sha256 its bytes must have. A caller error is a TypeError before any request.
 */
function publicObjectUrl(base: URL, path: string): { readonly url: URL; readonly sha256: string } {
  checkPublicBase(base, 'public base')
  const cls = classOfPath('content', path)
  const kind = cls?.kind
  if (kind !== 'media' && kind !== 'package') {
    throw new TypeError('public object path must be a content media or package path')
  }
  const pathname = `${base.pathname}/${path}`
  const url = new URL(`${base.origin}${pathname}`)
  if (url.origin !== base.origin || url.pathname !== pathname || url.search || url.hash) {
    throw new TypeError('public object URL must be exactly the base and the path')
  }
  const sha256 = String(cls?.fields[kind === 'media' ? 'sha256' : 'packageSha256'] ?? '')
  return { url, sha256 }
}

/**
 * One stored object read from its public URL and re-hashed (D15B-21): exactly 200; a
 * content-length, when sent, equal to `bytes`; the media type `mime`; no encoding; the body read
 * with the cap `bytes`; its sha256 equal to the path's 64 hex.
 */
export async function readPublicObject(
  base: URL,
  object: PublicObject,
  options: PublicReadOptions = {},
): Promise<PublicObjectAnswer> {
  const { url, sha256 } = publicObjectUrl(base, object.path)
  if (!Number.isSafeInteger(object.bytes) || object.bytes < 0) {
    throw new TypeError('public object bytes must be a whole number')
  }
  const got = await getWithRetries(
    url,
    IDENTITY,
    options,
    async (response): Promise<PublicObjectAnswer> => {
      const failed = async (reason: PublicObjectReason): Promise<PublicObjectAnswer> => {
        await discard(response)
        return { kind: 'failed', reason, status: response.status }
      }
      if (response.status !== 200) return failed('status')
      const declared = response.headers.get('content-length')
      if (declared !== null && declared !== String(object.bytes)) return failed('length')
      if (mediaType(response.headers.get('content-type')) !== object.mime) return failed('type')
      if (!isIdentity(response.headers.get('content-encoding'))) return failed('encoding')
      const body = await readCapped(response, object.bytes)
      if (body === null) return { kind: 'failed', reason: 'too-large', status: response.status }
      if ((await sha256Hex(body)) !== sha256) {
        return { kind: 'failed', reason: 'hash', status: response.status }
      }
      return { kind: 'ok' }
    },
  )
  if (got.kind === 'answer') return got.value
  if (got.kind === 'redirect') return { kind: 'failed', reason: 'redirect', status: got.status }
  return { kind: 'failed', reason: got.cause, status: got.status }
}

/** True when two byte arrays hold the same bytes. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i])
}

/**
 * The Range check on one stored MP3 (D15B-16): the full GET (exactly 200, type audio/mpeg, no
 * encoding, the body read with the cap `bytes`, content-length exactly `bytes`, sha256 equal to
 * the target's), then one GET of `range: bytes=<s>-<e>` with s = floor(size/2), e = min(size-1,
 * s+1023): exactly 206, content-range exactly `bytes <s>-<e>/<size>`, type audio/mpeg, no
 * encoding, a content-length (when sent) and a body of exactly e-s+1 bytes, equal to the full
 * body's slice. Accept-Ranges is never read. A full-GET failure sends no range GET.
 */
export async function checkRange(
  base: URL,
  target: RangeTarget,
  options: PublicReadOptions = {},
): Promise<RangeAnswer> {
  const { url } = publicObjectUrl(base, target.path)
  const cls = classOfPath('content', target.path)
  if (cls?.kind !== 'media' || cls.fields.mime !== 'audio/mpeg') {
    throw new TypeError('range target must be an MP3 media path')
  }
  if (!Number.isSafeInteger(target.bytes) || target.bytes < 1) {
    throw new TypeError('range target bytes must be a whole number from 1')
  }
  if (typeof target.sha256 !== 'string' || !SHA256_HEX.test(target.sha256)) {
    throw new TypeError('range target sha256 must be 64 lowercase hex')
  }
  const size = target.bytes
  type FullRead = { readonly kind: 'body'; readonly body: Uint8Array } | RangeAnswer
  const first = await getWithRetries(
    url,
    IDENTITY,
    options,
    async (response): Promise<FullRead> => {
      const failed = async (reason: RangeReason): Promise<RangeAnswer> => {
        await discard(response)
        return { kind: 'failed', reason, status: response.status }
      }
      if (response.status !== 200) return failed('full-status')
      if (mediaType(response.headers.get('content-type')) !== 'audio/mpeg')
        return failed('full-type')
      if (!isIdentity(response.headers.get('content-encoding'))) return failed('full-encoding')
      const body = await readCapped(response, size)
      if (body === null) return { kind: 'failed', reason: 'too-large', status: response.status }
      if (response.headers.get('content-length') !== String(size)) {
        return { kind: 'failed', reason: 'full-length', status: response.status }
      }
      if ((await sha256Hex(body)) !== target.sha256) {
        return { kind: 'failed', reason: 'full-hash', status: response.status }
      }
      return { kind: 'body', body }
    },
  )
  if (first.kind === 'redirect') return { kind: 'failed', reason: 'redirect', status: first.status }
  if (first.kind === 'gave-up') {
    const reason = first.cause === 'status' ? 'full-status' : 'network'
    return { kind: 'failed', reason, status: first.status }
  }
  if (first.value.kind !== 'body') return first.value
  const whole = first.value.body

  const start = Math.floor(size / 2)
  const end = Math.min(size - 1, start + 1023)
  const want = end - start + 1
  const second = await getWithRetries(
    url,
    { range: `bytes=${start}-${end}` },
    options,
    async (response): Promise<RangeAnswer> => {
      const failed = async (reason: RangeReason): Promise<RangeAnswer> => {
        await discard(response)
        return { kind: 'failed', reason, status: response.status }
      }
      if (response.status !== 206) return failed('status')
      if (response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) {
        return failed('content-range')
      }
      if (mediaType(response.headers.get('content-type')) !== 'audio/mpeg') return failed('type')
      if (!isIdentity(response.headers.get('content-encoding'))) return failed('encoding')
      const declared = response.headers.get('content-length')
      if (declared !== null && declared !== String(want)) return failed('length')
      const body = await readCapped(response, want)
      if (body === null || body.byteLength !== want) {
        return { kind: 'failed', reason: 'length', status: response.status }
      }
      if (!sameBytes(body, whole.subarray(start, end + 1))) {
        return { kind: 'failed', reason: 'bytes', status: response.status }
      }
      return { kind: 'ok', start, end, size }
    },
  )
  if (second.kind === 'answer') return second.value
  if (second.kind === 'redirect')
    return { kind: 'failed', reason: 'redirect', status: second.status }
  return { kind: 'failed', reason: second.cause, status: second.status }
}

/**
 * One landing page (D15B-21): GET `<origin>/<locale>/stories/<storyId>` for a StoryId in an
 * enabled locale, exactly 200 and text/html, the body read to 4 MiB and discarded.
 */
export async function checkLanding(
  siteUrl: URL,
  page: { readonly storyId: string; readonly locale: string },
  options: PublicReadOptions = {},
): Promise<LandingAnswer> {
  checkPublicBase(siteUrl, 'site URL')
  if (!StoryId.safeParse(page.storyId).success) {
    throw new TypeError('landing story id must be a story id')
  }
  if (!(ENABLED_LOCALE_CODES as readonly string[]).includes(page.locale)) {
    throw new TypeError('landing locale must be an enabled locale')
  }
  const pathname = `/${page.locale}/stories/${page.storyId}`
  const url = new URL(pathname, siteUrl.origin)
  if (url.origin !== siteUrl.origin || url.pathname !== pathname || url.search || url.hash) {
    throw new TypeError('landing URL must be exactly the origin and the page path')
  }
  const got = await getWithRetries(
    url,
    IDENTITY,
    options,
    async (response): Promise<LandingAnswer> => {
      const failed = async (reason: LandingReason): Promise<LandingAnswer> => {
        await discard(response)
        return { kind: 'failed', reason, status: response.status }
      }
      if (response.status !== 200) return failed('status')
      if (mediaType(response.headers.get('content-type')) !== 'text/html') return failed('type')
      const body = await readCapped(response, MAX_LANDING_BYTES)
      if (body === null) return { kind: 'failed', reason: 'too-large', status: response.status }
      return { kind: 'ok' }
    },
  )
  if (got.kind === 'answer') return got.value
  if (got.kind === 'redirect') return { kind: 'failed', reason: 'redirect', status: got.status }
  return { kind: 'failed', reason: got.cause, status: got.status }
}
