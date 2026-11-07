// P0-13 THROWAWAY: removed at cleanup
// P0-13 spike CLI (plan file 15), on top of the reusable publisher modules. Run from storyboard/:
//   pnpm spike env-check                                  names and "ok" only, never a value
//   pnpm spike upload                                     clips A, B, D, probe.webp, then clip C last
//   pnpm spike s1 publish --seq N [--wrong-hash] [--hook] snapshot N (+ duplicate check), pointer, hook
//   pnpm spike watch [--minutes 120]                      build-info every 5 s (seq, deploymentId)
//   pnpm spike wait-stable [--minutes 2]                  same seq and deploymentId for >= 2 minutes
//   pnpm spike freshness [--rounds 20]                    pointer re-upload + new-nonce reads (S1-3)
//   pnpm spike cdn upload|warm|delete|poll|reupload --run R   deleted-object CDN lag (S1-7)
//   pnpm spike protection [--old H] [--current H] [--branch-alias H]   old deployment URLs (S1-5)
//   pnpm spike statuses --sha <commit>                    public GitHub statuses for a commit (S1-1)
//   pnpm spike cleanup list | delete (--all | --path P ...) --confirm
// Uploads and deletes go only through tools/publisher/storage.ts: bucket `content`, prefix `spikes/`,
// overwritable paths exactly the S-1 pointer and the freshness pointer. Deletes take exact ledger
// paths that a fresh recursive list also shows, and need --confirm. Nothing here prints a credential.
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { isEntryPoint } from '../../scripts/load-content'
import { checkPointer } from '../../src/core/content/gates'
import { makePointer, makeSnapshot } from '../../src/core/package/catalogue-build'
import {
  checkPublisherEnv,
  loadEnvFile,
  readDeployHookUrl,
  readSiteUrl,
  readStorageCredentials,
  readSupabaseUrl,
  type Env,
  type Secret,
} from '../publisher/env'
import { triggerDeployHook } from '../publisher/hook'
import { mediaType, readCapped, parseJsonBytes } from '../publisher/http'
import {
  createStorageClient,
  MAX_REMOVE_PATHS,
  StorageRefusedError,
  type StorageClient,
  type StorageGuards,
  type UploadResult,
} from '../publisher/storage'
import { describeSample, readBuildInfo, type BuildInfoSample } from '../publisher/verify'
import { describeProbe, probe, type ProbeRecord } from './http-probe'
import {
  createRecorder,
  lastDelete,
  livePaths,
  newRunId,
  planSeq,
  reuploadCheck,
  type LedgerEntry,
  type Recorder,
} from './ledger'
import {
  assertRunId,
  audioUploadList,
  BUCKET,
  CDN_PROBE_NAMES,
  cdnProbeList,
  cdnProbePath,
  freshnessPointerPath,
  IMMUTABLE_CACHE_SECONDS,
  POINTER_CACHE_SECONDS,
  publicObjectUrl,
  S1_POINTER,
  S1_ROOT,
  s1SnapshotPath,
  sha256Hex,
  SPIKE_DIR,
  spikeGuards,
  WRITE_PREFIX,
  type SpikeObject,
  type UploadPurpose,
} from './objects'

export interface SpikeDeps {
  readonly recorder: Recorder
  readonly log: (line: string) => void
  readonly now: () => Date
  /** Monotonic milliseconds. */
  readonly clock: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly fetchImpl: typeof fetch
}

// ---- command line ----

export type Command =
  | { readonly name: 'help' }
  | { readonly name: 'env-check' }
  | { readonly name: 'upload'; readonly bearerFallback: boolean }
  | {
      readonly name: 's1-publish'
      readonly seq: number
      readonly wrongHash: boolean
      readonly hook: boolean
      readonly bearerFallback: boolean
    }
  | { readonly name: 'watch'; readonly minutes: number; readonly intervalMs: number }
  | {
      readonly name: 'wait-stable'
      readonly minutes: number
      readonly timeoutMinutes: number
      readonly intervalMs: number
    }
  | { readonly name: 'freshness'; readonly rounds: number; readonly bearerFallback: boolean }
  | { readonly name: 'cdn-upload'; readonly bearerFallback: boolean }
  | {
      readonly name: 'cdn-warm'
      readonly runId: string
      readonly maxTries: number
      readonly intervalMs: number
    }
  | {
      readonly name: 'cdn-delete'
      readonly runId: string
      readonly confirm: boolean
      readonly bearerFallback: boolean
    }
  | {
      readonly name: 'cdn-poll'
      readonly runId: string
      readonly intervalMs: number
      readonly maxMinutes: number
    }
  | {
      readonly name: 'cdn-reupload'
      readonly runId: string
      readonly intervalMs: number
      readonly maxMinutes: number
      readonly bearerFallback: boolean
    }
  | {
      readonly name: 'protection'
      readonly old: string | null
      readonly current: string | null
      readonly branchAlias: string | null
    }
  | { readonly name: 'statuses'; readonly sha: string; readonly repo: string }
  | { readonly name: 'cleanup-list'; readonly bearerFallback: boolean }
  | {
      readonly name: 'cleanup-delete'
      readonly all: boolean
      readonly paths: readonly string[]
      readonly confirm: boolean
      readonly bearerFallback: boolean
    }

export const DEFAULT_REPO = 'acumenamit/panchtantra-stories'
export const FRESHNESS_ROUNDS = 20

const OPTIONS = {
  seq: { type: 'string' },
  'wrong-hash': { type: 'boolean' },
  hook: { type: 'boolean' },
  'bearer-fallback': { type: 'boolean' },
  run: { type: 'string' },
  rounds: { type: 'string' },
  minutes: { type: 'string' },
  'timeout-minutes': { type: 'string' },
  'max-minutes': { type: 'string' },
  'interval-ms': { type: 'string' },
  'max-tries': { type: 'string' },
  confirm: { type: 'boolean' },
  all: { type: 'boolean' },
  path: { type: 'string', multiple: true },
  sha: { type: 'string' },
  repo: { type: 'string' },
  old: { type: 'string' },
  current: { type: 'string' },
  'branch-alias': { type: 'string' },
} as const

type OptionName = keyof typeof OPTIONS

const ALLOWED_OPTIONS: Readonly<Record<string, readonly OptionName[]>> = {
  'env-check': [],
  upload: ['bearer-fallback'],
  's1 publish': ['seq', 'wrong-hash', 'hook', 'bearer-fallback'],
  watch: ['minutes', 'interval-ms'],
  'wait-stable': ['minutes', 'timeout-minutes', 'interval-ms'],
  freshness: ['rounds', 'bearer-fallback'],
  'cdn upload': ['bearer-fallback'],
  'cdn warm': ['run', 'max-tries', 'interval-ms'],
  'cdn delete': ['run', 'confirm', 'bearer-fallback'],
  'cdn poll': ['run', 'interval-ms', 'max-minutes'],
  'cdn reupload': ['run', 'interval-ms', 'max-minutes', 'bearer-fallback'],
  protection: ['old', 'current', 'branch-alias'],
  statuses: ['sha', 'repo'],
  'cleanup list': ['bearer-fallback'],
  'cleanup delete': ['all', 'path', 'confirm', 'bearer-fallback'],
}

export class UsageError extends Error {
  override readonly name = 'UsageError'
}

function integerOption(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return fallback
  if (!/^\d{1,9}$/.test(raw)) throw new UsageError(`--${name} must be a whole number`)
  const value = Number(raw)
  if (value < min || value > max) throw new UsageError(`--${name} must be from ${min} to ${max}`)
  return value
}

function requiredRunId(raw: string | undefined): string {
  if (raw === undefined) throw new UsageError('--run <run id> is required (cdn upload prints it)')
  try {
    assertRunId(raw)
  } catch {
    throw new UsageError('--run must look like r20261107-101500')
  }
  return raw
}

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

function hostOption(raw: string | undefined, name: string): string | null {
  if (raw === undefined) return null
  const host = raw.replace(/^https:\/\//, '').replace(/\/$/, '')
  if (!HOST.test(host)) throw new UsageError(`--${name} must be a host name such as x.vercel.app`)
  return host
}

function parseRaw(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'invalid arguments')
  }
}

/** Parses argv (without node and the script) into one command; throws UsageError on any mistake. */
export function parseCommand(argv: readonly string[]): Command {
  const { values, positionals } = parseRaw(argv)
  if (positionals.length === 0 || positionals[0] === 'help') return { name: 'help' }
  const [first, second] = positionals
  const key = ['s1', 'cdn', 'cleanup'].includes(first!) ? `${first} ${second ?? ''}` : first!
  const allowed = ALLOWED_OPTIONS[key]
  const maxPositionals = key.includes(' ') ? 2 : 1
  if (!allowed || positionals.length > maxPositionals) {
    throw new UsageError(`unknown command: ${positionals.join(' ')}`)
  }
  for (const option of Object.keys(values)) {
    if (!allowed.includes(option as OptionName)) {
      throw new UsageError(`--${option} does not apply to "${key}"`)
    }
  }
  const bearerFallback = values['bearer-fallback'] === true
  const intervalMs = (fallback: number) =>
    integerOption(values['interval-ms'], 'interval-ms', fallback, 1000, 600_000)
  switch (key) {
    case 'env-check':
      return { name: 'env-check' }
    case 'upload':
      return { name: 'upload', bearerFallback }
    case 's1 publish':
      if (values.seq === undefined) throw new UsageError('--seq <n> is required')
      return {
        name: 's1-publish',
        seq: integerOption(values.seq, 'seq', 0, 1, 1000),
        wrongHash: values['wrong-hash'] === true,
        hook: values.hook === true,
        bearerFallback,
      }
    case 'watch':
      return {
        name: 'watch',
        minutes: integerOption(values.minutes, 'minutes', 120, 1, 600),
        intervalMs: intervalMs(5000),
      }
    case 'wait-stable':
      return {
        name: 'wait-stable',
        minutes: integerOption(values.minutes, 'minutes', 2, 2, 60),
        timeoutMinutes: integerOption(values['timeout-minutes'], 'timeout-minutes', 30, 1, 240),
        intervalMs: intervalMs(5000),
      }
    case 'freshness':
      return {
        name: 'freshness',
        rounds: integerOption(values.rounds, 'rounds', FRESHNESS_ROUNDS, 1, FRESHNESS_ROUNDS),
        bearerFallback,
      }
    case 'cdn upload':
      return { name: 'cdn-upload', bearerFallback }
    case 'cdn warm':
      return {
        name: 'cdn-warm',
        runId: requiredRunId(values.run),
        maxTries: integerOption(values['max-tries'], 'max-tries', 12, 1, 60),
        intervalMs: intervalMs(10_000),
      }
    case 'cdn delete':
      return {
        name: 'cdn-delete',
        runId: requiredRunId(values.run),
        confirm: values.confirm === true,
        bearerFallback,
      }
    case 'cdn poll':
    case 'cdn reupload': {
      const common = {
        runId: requiredRunId(values.run),
        intervalMs: intervalMs(30_000),
        maxMinutes: integerOption(values['max-minutes'], 'max-minutes', 90, 1, 180),
      }
      return key === 'cdn poll'
        ? { name: 'cdn-poll', ...common }
        : { name: 'cdn-reupload', ...common, bearerFallback }
    }
    case 'protection':
      return {
        name: 'protection',
        old: hostOption(values.old, 'old'),
        current: hostOption(values.current, 'current'),
        branchAlias: hostOption(values['branch-alias'], 'branch-alias'),
      }
    case 'statuses': {
      const sha = values.sha ?? ''
      if (!/^[0-9a-f]{40}$/.test(sha))
        throw new UsageError('--sha must be a full 40-hex commit sha')
      const repo = values.repo ?? DEFAULT_REPO
      if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo)) {
        throw new UsageError('--repo must look like owner/name')
      }
      return { name: 'statuses', sha, repo }
    }
    case 'cleanup list':
      return { name: 'cleanup-list', bearerFallback }
    case 'cleanup delete': {
      const all = values.all === true
      const paths = values.path ?? []
      if (all === paths.length > 0) throw new UsageError('give either --all or --path <p> ...')
      return {
        name: 'cleanup-delete',
        all,
        paths,
        confirm: values.confirm === true,
        bearerFallback,
      }
    }
    default:
      throw new UsageError(`unknown command: ${positionals.join(' ')}`)
  }
}

// ---- shared steps ----

interface UploadMeta {
  readonly seq?: number | null
  readonly runId?: string | null
  readonly wrongHash?: boolean
  readonly upsert?: boolean
  readonly purpose?: UploadPurpose
}

/** The Storage result plus what was sent. */
export type UploadedObject = UploadResult & { readonly bytes: number; readonly sha256: string }

function resultStatus(result: UploadResult): number | null {
  return result.kind === 'unauthorized' || result.kind === 'failed' ? result.status : null
}

function resultCode(result: UploadResult): string | null {
  return result.kind === 'failed' ? result.code : null
}

const UNAUTHORIZED_NOTE =
  'Storage refused the key (401/403). Stop here. The Bearer fallback (--bearer-fallback) is tried only after the owner says OK.'

/** Writes the attempt line, uploads, then writes the result line. Never retries. */
export async function uploadObject(
  deps: SpikeDeps,
  storage: StorageClient,
  object: SpikeObject,
  meta: UploadMeta = {},
): Promise<UploadedObject> {
  const body = object.body()
  const sha256 = sha256Hex(body)
  const upsert = meta.upsert ?? false
  deps.recorder.appendLedger({
    kind: 'upload-attempt',
    at: deps.now().toISOString(),
    bucket: BUCKET,
    path: object.path,
    bytes: body.byteLength,
    sha256,
    contentType: object.contentType,
    cacheControl: object.cacheControl,
    upsert,
    purpose: meta.purpose ?? object.purpose,
    seq: meta.seq ?? null,
    runId: meta.runId ?? null,
    wrongHash: meta.wrongHash ?? false,
  })
  let result: UploadResult
  try {
    result = await storage.upload({
      bucket: BUCKET,
      path: object.path,
      body,
      contentType: object.contentType,
      cacheControl: object.cacheControl,
      upsert,
    })
  } catch (error) {
    deps.recorder.appendLedger({
      kind: 'upload-result',
      at: deps.now().toISOString(),
      path: object.path,
      result: 'failed',
      status: null,
      code: error instanceof StorageRefusedError ? 'refused-by-guard' : 'error',
    })
    throw error
  }
  deps.recorder.appendLedger({
    kind: 'upload-result',
    at: deps.now().toISOString(),
    path: object.path,
    result: result.kind,
    status: resultStatus(result),
    code: resultCode(result),
  })
  const detail =
    result.kind === 'failed' ? ` status=${result.status ?? '-'} code=${result.code}` : ''
  deps.log(
    `upload ${result.kind}${detail} ${object.path} bytes=${body.byteLength} sha=${sha256.slice(0, 12)} max-age=${object.cacheControl}${upsert ? ' upsert' : ''}`,
  )
  if (result.kind === 'unauthorized') deps.log(UNAUTHORIZED_NOTE)
  return { ...result, bytes: body.byteLength, sha256 }
}

function probeOptions(deps: SpikeDeps, label: string) {
  return { fetchImpl: deps.fetchImpl, clock: deps.clock, now: deps.now, label }
}

/** A cache-busting query value that is new on every call, even within one millisecond. */
function createNonceSource(deps: SpikeDeps): () => string {
  let last = 0
  return () => {
    last = Math.max(last + 1, deps.now().getTime())
    return String(last)
  }
}

function withQuery(url: URL, name: string, value: string): URL {
  const copy = new URL(url)
  copy.searchParams.set(name, value)
  return copy
}

async function probeAndRecord(
  deps: SpikeDeps,
  stream: string,
  url: URL,
  label: string,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<ProbeRecord> {
  const record = await probe(url, probeOptions(deps, label))
  deps.recorder.appendEvidence(stream, { ...extra, probe: record })
  deps.log(describeProbe(record))
  return record
}

// ---- upload (plan O4 step 5) ----

export async function runAudioUpload(
  deps: SpikeDeps,
  storage: StorageClient,
  list: readonly SpikeObject[] = audioUploadList(),
): Promise<number> {
  const entries = deps.recorder.readLedger()
  let total = 0
  for (const object of list) {
    const done = entries.some(
      (e) => e.kind === 'upload-result' && e.path === object.path && e.result === 'created',
    )
    if (done) {
      deps.log(`upload skipped ${object.path}: already created (on the ledger)`)
      continue
    }
    const result = await uploadObject(deps, storage, object)
    if (result.kind === 'duplicate') {
      deps.log(`note: ${object.path} already existed; content-addressed, so it was left as it is`)
    } else if (result.kind !== 'created') {
      deps.log(`stopped: ${object.path} was not uploaded (${result.kind})`)
      return 1
    }
    total += result.bytes
  }
  deps.log(`upload done: ${total} bytes this run. Clip C went last: run s3-headers.sh H0 now.`)
  return 0
}

// ---- s1 publish ----

/** The same digest with its last hex digit changed: a pointer the snapshot gate must refuse. */
export function corruptSha256(sha256: string): string {
  return `${sha256.slice(0, -1)}${sha256.endsWith('0') ? '1' : '0'}`
}

export interface PublishOptions {
  readonly seq: number
  readonly wrongHash: boolean
  readonly hookUrl: Secret | null
}

export async function publishS1(
  deps: SpikeDeps,
  storage: StorageClient,
  options: PublishOptions,
): Promise<number> {
  const plan = planSeq(deps.recorder.readLedger(), options.seq, options.wrongHash)
  if (plan.kind === 'refused') {
    deps.log(`refused: ${plan.reason}`)
    return 1
  }
  let snapshotPath: string
  let snapshotSha256: string
  if (plan.kind === 'new') {
    const snapshot = await makeSnapshot({
      schemaVersion: '1.0',
      seq: plan.seq,
      createdAt: deps.now().toISOString(),
      note: `P0-13 S-1 synthetic snapshot ${plan.seq}`,
      featuredStoryId: null,
      stories: [],
    })
    const object: SpikeObject = {
      path: s1SnapshotPath(plan.seq),
      contentType: 'application/json',
      cacheControl: IMMUTABLE_CACHE_SECONDS,
      purpose: 's1-snapshot',
      body: () => snapshot.bytes,
    }
    const first = await uploadObject(deps, storage, object, { seq: plan.seq })
    if (first.kind !== 'created') {
      deps.log(
        `stopped: snapshot ${plan.seq} was not created (${first.kind}); seq ${plan.seq} is now used, so the next publish is --seq ${plan.seq + 1}`,
      )
      return 1
    }
    // The same bytes again must come back "duplicate": the module never overwrites (plan O4 step 2).
    const again = await uploadObject(deps, storage, object, { seq: plan.seq })
    if (again.kind !== 'duplicate') {
      deps.log(`stopped: the repeated snapshot upload returned ${again.kind}, not duplicate`)
      return 1
    }
    snapshotPath = object.path
    snapshotSha256 = snapshot.sha256
  } else {
    deps.log(`restore: seq ${plan.seq} snapshot is already stored; only the pointer is sent again`)
    snapshotPath = plan.snapshotPath
    snapshotSha256 = plan.snapshotSha256
  }

  const pointer = await makePointer({
    schemaVersion: '1.0',
    seq: plan.seq,
    snapshotPath,
    snapshotSha256: options.wrongHash ? corruptSha256(snapshotSha256) : snapshotSha256,
    updatedAt: deps.now().toISOString(),
  })
  const local = checkPointer(pointer.bytes, { mode: 'production', root: S1_ROOT })
  if (!local.ok) throw new Error(`built pointer fails the pointer gate: ${local.reason}`)
  const pointerObject: SpikeObject = {
    path: S1_POINTER,
    contentType: 'application/json',
    cacheControl: POINTER_CACHE_SECONDS,
    purpose: 's1-pointer',
    body: () => pointer.bytes,
  }
  const moved = await uploadObject(deps, storage, pointerObject, {
    seq: plan.seq,
    wrongHash: options.wrongHash,
    upsert: true,
  })
  if (moved.kind !== 'created') {
    deps.log(`stopped: the pointer was not moved (${moved.kind})`)
    return 1
  }

  const record = {
    action: 'publish',
    kind: plan.kind,
    seq: plan.seq,
    snapshotPath,
    snapshotSha256,
    pointerSha256: pointer.sha256,
    wrongHash: options.wrongHash,
  }
  if (options.hookUrl === null) {
    deps.recorder.appendEvidence('s1', { at: deps.now().toISOString(), ...record, hook: null })
    deps.log(`published seq=${plan.seq} (${plan.kind}) without the hook${wrongHashNote(options)}`)
    return 0
  }
  // The hook module logs only the job id and createdAt; the URL never leaves it.
  const hook = await triggerDeployHook({
    hookUrl: options.hookUrl,
    fetchImpl: deps.fetchImpl,
    log: deps.log,
  })
  const hookRecord =
    hook.kind === 'triggered'
      ? { jobId: hook.jobId, createdAt: hook.createdAt }
      : { failed: hook.reason, status: hook.status }
  deps.recorder.appendEvidence('s1', { at: deps.now().toISOString(), ...record, hook: hookRecord })
  if (hook.kind !== 'triggered') return 1
  deps.log(
    `published seq=${plan.seq} (${plan.kind}), hook job ${hook.jobId}${wrongHashNote(options)}`,
  )
  return 0
}

function wrongHashNote(options: PublishOptions): string {
  return options.wrongHash ? '; the pointer carries a WRONG snapshot hash on purpose' : ''
}

// ---- watch and wait-stable ----

function describeChange(previous: BuildInfoSample | null, sample: BuildInfoSample): string {
  if (sample.kind !== 'live' || previous?.kind !== 'live') return ''
  return previous.seq !== sample.seq || previous.deploymentId !== sample.deploymentId
    ? ' CHANGED'
    : ''
}

export async function watch(
  deps: SpikeDeps,
  siteUrl: URL,
  options: { readonly minutes: number; readonly intervalMs: number },
): Promise<number> {
  const deadline = deps.clock() + options.minutes * 60_000
  let previous: BuildInfoSample | null = null
  while (deps.clock() < deadline) {
    const sample = await readBuildInfo(siteUrl, {
      fetchImpl: deps.fetchImpl,
      now: () => deps.now().getTime(),
    })
    deps.recorder.appendEvidence('watch', { sample })
    deps.log(`${describeSample(sample)}${describeChange(previous, sample)}`)
    previous = sample
    await deps.sleep(options.intervalMs)
  }
  return 0
}

/** The `at` of the first sample in the trailing run of live samples with one seq and deploymentId. */
export function stableSince(samples: readonly BuildInfoSample[]): number | null {
  const last = samples.at(-1)
  if (last?.kind !== 'live') return null
  let since = last.at
  for (let index = samples.length - 2; index >= 0; index--) {
    const sample = samples[index]!
    if (sample.kind !== 'live') break
    if (sample.seq !== last.seq || sample.deploymentId !== last.deploymentId) break
    since = sample.at
  }
  return since
}

export async function waitStable(
  deps: SpikeDeps,
  siteUrl: URL,
  options: {
    readonly minutes: number
    readonly timeoutMinutes: number
    readonly intervalMs: number
  },
): Promise<number> {
  const holdMs = options.minutes * 60_000
  const deadline = deps.clock() + options.timeoutMinutes * 60_000
  const samples: BuildInfoSample[] = []
  for (;;) {
    const sample = await readBuildInfo(siteUrl, {
      fetchImpl: deps.fetchImpl,
      now: () => deps.now().getTime(),
    })
    samples.push(sample)
    deps.recorder.appendEvidence('watch', { sample, waitStable: true })
    deps.log(describeSample(sample))
    const since = stableSince(samples)
    if (since !== null && sample.kind === 'live' && sample.at - since >= holdMs) {
      deps.log(
        `stable: seq=${sample.seq} deployment=${sample.deploymentId ?? '-'} for ${Math.round((sample.at - since) / 1000)} s. Now confirm in Vercel that nothing is Building or Queued.`,
      )
      return 0
    }
    if (deps.clock() + options.intervalMs > deadline) {
      deps.log(`not stable within ${options.timeoutMinutes} minutes`)
      return 1
    }
    await deps.sleep(options.intervalMs)
  }
}

// ---- freshness (S1-3) ----

/** Reads after each pointer upload, in ms: +0, +1, +5 and +30 s (plan S1-3). */
export const FRESHNESS_OFFSETS_MS: readonly number[] = [0, 1000, 5000, 30_000]
const PLACEHOLDER_SHA256 = '0'.repeat(64)

export async function runFreshness(
  deps: SpikeDeps,
  storage: StorageClient,
  supabaseOrigin: URL,
  options: { readonly runId: string; readonly rounds: number },
): Promise<number> {
  const path = freshnessPointerPath(options.runId)
  const url = publicObjectUrl(supabaseOrigin, path)
  const nextNonce = createNonceSource(deps)
  const stale: string[] = []
  let newNonceReads = 0
  let previousNonce: string | null = null
  deps.log(`freshness run ${options.runId}: ${options.rounds} rounds on ${path}`)
  for (let round = 1; round <= options.rounds; round++) {
    // A schema-valid pointer whose seq is the round number; nothing builds from it.
    const pointer = await makePointer({
      schemaVersion: '1.0',
      seq: round,
      snapshotPath: s1SnapshotPath(1),
      snapshotSha256: PLACEHOLDER_SHA256,
      updatedAt: deps.now().toISOString(),
    })
    const object: SpikeObject = {
      path,
      contentType: 'application/json',
      cacheControl: POINTER_CACHE_SECONDS,
      purpose: 'freshness-pointer',
      body: () => pointer.bytes,
    }
    const uploaded = await uploadObject(deps, storage, object, {
      runId: options.runId,
      seq: round,
      upsert: true,
    })
    if (uploaded.kind !== 'created') {
      deps.log(`stopped: round ${round} upload returned ${uploaded.kind}`)
      return 1
    }
    const uploadedAt = deps.clock()
    let firstNonce: string | null = null
    for (const offset of FRESHNESS_OFFSETS_MS) {
      await deps.sleep(Math.max(0, uploadedAt + offset - deps.clock()))
      const nonce = nextNonce()
      firstNonce ??= nonce
      const label = `round=${round} +${offset / 1000}s new-nonce`
      const record = await probeAndRecord(
        deps,
        'freshness',
        withQuery(url, 'cacheNonce', nonce),
        label,
        {
          runId: options.runId,
          round,
          offsetMs: offset,
          read: 'new-nonce',
          expectedSha256: pointer.sha256,
        },
      )
      newNonceReads++
      if (record.status !== 200 || record.sha256 !== pointer.sha256) stale.push(label)
    }
    // Recorded only: what the plain URL and a reused (previous round's) nonce serve now.
    await probeAndRecord(deps, 'freshness', url, `round=${round} plain`, {
      runId: options.runId,
      round,
      read: 'plain',
      expectedSha256: pointer.sha256,
    })
    if (previousNonce !== null) {
      await probeAndRecord(
        deps,
        'freshness',
        withQuery(url, 'cacheNonce', previousNonce),
        `round=${round} reused-nonce`,
        { runId: options.runId, round, read: 'reused-nonce', expectedSha256: pointer.sha256 },
      )
    }
    previousNonce = firstNonce
  }
  const fresh = newNonceReads - stale.length
  deps.recorder.appendEvidence('freshness', {
    at: deps.now().toISOString(),
    runId: options.runId,
    summary: { newNonceReads, fresh, stale },
  })
  deps.log(`freshness: ${fresh} of ${newNonceReads} new-nonce reads returned the latest bytes`)
  for (const label of stale) deps.log(`STALE: ${label}`)
  deps.log(
    `At the end of the S-1 session delete the pointer: pnpm spike cleanup delete --path ${path} --confirm`,
  )
  return stale.length === 0 ? 0 : 3
}

// ---- cdn (S1-7) ----

export async function cdnUpload(
  deps: SpikeDeps,
  storage: StorageClient,
  runId: string,
): Promise<number> {
  deps.log(`cdn run ${runId}`)
  for (const object of cdnProbeList(runId)) {
    const result = await uploadObject(deps, storage, object, { runId })
    if (result.kind !== 'created') {
      deps.log(`stopped: ${object.path} was not created (${result.kind})`)
      return 1
    }
  }
  deps.recorder.appendEvidence('cdn', { at: deps.now().toISOString(), action: 'upload', runId })
  deps.log(
    `cdn upload done. Next: s3-headers.sh H2 ${runId}, then pnpm spike cdn warm --run ${runId}`,
  )
  return 0
}

function requireLive(entries: readonly LedgerEntry[], paths: readonly string[]): string | null {
  const live = new Set(livePaths(entries))
  const missing = paths.filter((path) => !live.has(path))
  return missing.length === 0 ? null : `not live on the ledger: ${missing.join(', ')}`
}

export async function cdnWarm(
  deps: SpikeDeps,
  supabaseOrigin: URL,
  options: { readonly runId: string; readonly maxTries: number; readonly intervalMs: number },
): Promise<number> {
  const paths = CDN_PROBE_NAMES.map((name) => cdnProbePath(options.runId, name))
  const problem = requireLive(deps.recorder.readLedger(), paths)
  if (problem) {
    deps.log(`refused: ${problem}`)
    return 1
  }
  const pending = new Set(paths)
  for (let attempt = 1; attempt <= options.maxTries && pending.size > 0; attempt++) {
    for (const path of [...pending]) {
      const record = await probeAndRecord(
        deps,
        'cdn',
        publicObjectUrl(supabaseOrigin, path),
        `warm try=${attempt}`,
        {
          action: 'warm',
          runId: options.runId,
          path,
          attempt,
        },
      )
      if (record.cfCacheStatus === 'HIT') {
        pending.delete(path)
        deps.log(`HIT ${path} after ${attempt} tries, age=${record.age ?? '-'}`)
      }
    }
    if (pending.size > 0 && attempt < options.maxTries) await deps.sleep(options.intervalMs)
  }
  for (const path of pending) deps.log(`never HIT within ${options.maxTries} tries: ${path}`)
  return 0
}

/** Deletes exact paths, records each on the ledger, and returns the ones Storage confirmed. */
async function removeExact(
  deps: SpikeDeps,
  storage: StorageClient,
  paths: readonly string[],
): Promise<{ removed: string[]; ok: boolean }> {
  const removed: string[] = []
  for (let start = 0; start < paths.length; start += MAX_REMOVE_PATHS) {
    const chunk = paths.slice(start, start + MAX_REMOVE_PATHS)
    const result = await storage.remove(BUCKET, chunk)
    const at = deps.now().toISOString()
    const record = (
      path: string,
      outcome: 'removed' | 'not-removed' | 'failed',
      detail: string | null,
    ) =>
      deps.recorder.appendLedger({
        kind: 'delete',
        at,
        bucket: BUCKET,
        path,
        result: outcome,
        detail,
      })
    if (result.kind === 'removed') {
      for (const path of result.paths) record(path, 'removed', null)
      removed.push(...result.paths)
      continue
    }
    if (result.kind === 'count-mismatch') {
      for (const path of result.removed) record(path, 'removed', null)
      for (const path of result.notRemoved) record(path, 'not-removed', 'not in the response')
      removed.push(...result.removed)
      deps.log(
        `count mismatch: not removed ${result.notRemoved.join(', ') || '-'}; unexpected ${result.unexpected.join(', ') || '-'}`,
      )
      return { removed, ok: false }
    }
    const detail =
      result.kind === 'failed'
        ? `status=${result.status ?? '-'} code=${result.code}`
        : `status=${result.status}`
    for (const path of chunk) record(path, 'failed', `${result.kind} ${detail}`)
    deps.log(`delete ${result.kind} ${detail}`)
    if (result.kind === 'unauthorized') deps.log(UNAUTHORIZED_NOTE)
    return { removed, ok: false }
  }
  return { removed, ok: true }
}

export async function cdnDelete(
  deps: SpikeDeps,
  storage: StorageClient,
  supabaseOrigin: URL,
  options: { readonly runId: string; readonly confirm: boolean },
): Promise<number> {
  const paths = CDN_PROBE_NAMES.map((name) => cdnProbePath(options.runId, name))
  const problem = requireLive(deps.recorder.readLedger(), paths)
  if (problem) {
    deps.log(`refused: ${problem}`)
    return 1
  }
  if (!options.confirm) {
    for (const path of paths) deps.log(`would delete (permanent): ${path}`)
    deps.log('dry run: nothing deleted. Add --confirm to delete these objects.')
    return 0
  }
  const { removed, ok } = await removeExact(deps, storage, paths)
  for (const path of removed) deps.log(`deleted ${path}`)
  // Control reads with a new nonce: the origin must already refuse each object.
  const nextNonce = createNonceSource(deps)
  for (const path of removed) {
    const url = withQuery(publicObjectUrl(supabaseOrigin, path), 'cacheNonce', nextNonce())
    await probeAndRecord(deps, 'cdn', url, 'control new-nonce', {
      action: 'delete-control',
      runId: options.runId,
      path,
    })
  }
  return ok ? 0 : 1
}

interface PollState {
  readonly path: string
  readonly deletedAt: number
  nonOkStreak: number
  streakStartedAt: number | null
  goneAt: number | null
  lastOkAt: number | null
  readonly goneCacheStatuses: string[]
}

export async function cdnPoll(
  deps: SpikeDeps,
  supabaseOrigin: URL,
  options: { readonly runId: string; readonly intervalMs: number; readonly maxMinutes: number },
): Promise<number> {
  const entries = deps.recorder.readLedger()
  const states: PollState[] = []
  for (const name of CDN_PROBE_NAMES) {
    const path = cdnProbePath(options.runId, name)
    const deleted = lastDelete(entries, path)
    if (deleted?.result !== 'removed') {
      deps.log(`skipped (not deleted on the ledger): ${path}`)
      continue
    }
    states.push({
      path,
      deletedAt: Date.parse(deleted.at),
      nonOkStreak: 0,
      streakStartedAt: null,
      goneAt: null,
      lastOkAt: null,
      goneCacheStatuses: [],
    })
  }
  if (states.length === 0) {
    deps.log('nothing to poll: run cdn delete --confirm first')
    return 1
  }
  const deadline = deps.clock() + options.maxMinutes * 60_000
  while (states.some((s) => s.goneAt === null)) {
    for (const state of states.filter((s) => s.goneAt === null)) {
      const record = await probeAndRecord(
        deps,
        'cdn',
        publicObjectUrl(supabaseOrigin, state.path),
        'poll',
        {
          action: 'poll',
          runId: options.runId,
          path: state.path,
        },
      )
      const at = Date.parse(record.at)
      if (record.status === 200) {
        state.nonOkStreak = 0
        state.streakStartedAt = null
        state.lastOkAt = at
        continue
      }
      state.nonOkStreak++
      state.streakStartedAt ??= at
      state.goneCacheStatuses.push(record.cfCacheStatus ?? '-')
      if (state.nonOkStreak >= 3) state.goneAt = state.streakStartedAt
    }
    if (states.every((s) => s.goneAt !== null)) break
    if (deps.clock() + options.intervalMs > deadline) break
    await deps.sleep(options.intervalMs)
  }
  for (const state of states) {
    const lag =
      state.goneAt === null
        ? 'still served at the deadline'
        : `${Math.round((state.goneAt - state.deletedAt) / 1000)} s after the delete`
    const lastOk = state.lastOkAt === null ? '-' : new Date(state.lastOkAt).toISOString()
    deps.log(
      `${state.path}: gone ${lag}; last 200 at ${lastOk}; non-200 cf-cache-status ${state.goneCacheStatuses.join(',') || '-'}`,
    )
    deps.recorder.appendEvidence('cdn', {
      at: deps.now().toISOString(),
      action: 'poll-summary',
      runId: options.runId,
      path: state.path,
      deletedAt: new Date(state.deletedAt).toISOString(),
      goneAt: state.goneAt === null ? null : new Date(state.goneAt).toISOString(),
      lagSeconds:
        state.goneAt === null ? null : Math.round((state.goneAt - state.deletedAt) / 1000),
      lastOkAt: lastOk === '-' ? null : lastOk,
      goneCacheStatuses: state.goneCacheStatuses,
    })
  }
  return 0
}

export async function cdnReupload(
  deps: SpikeDeps,
  storage: StorageClient,
  supabaseOrigin: URL,
  options: { readonly runId: string; readonly intervalMs: number; readonly maxMinutes: number },
): Promise<number> {
  const check = reuploadCheck(deps.recorder.readLedger(), options.runId)
  if (!check.ok) {
    deps.log(`refused: ${check.reason}`)
    return 1
  }
  const object = cdnProbeList(options.runId).find((o) => o.path === check.path)
  if (!object) throw new Error('probe-300.mp3 is missing from the probe list')
  const result = await uploadObject(deps, storage, object, {
    runId: options.runId,
    purpose: 'cdn-reupload',
  })
  if (result.kind !== 'created') {
    deps.log(`stopped: re-upload returned ${result.kind}`)
    return 1
  }
  const started = deps.clock()
  const deadline = started + options.maxMinutes * 60_000
  const url = publicObjectUrl(supabaseOrigin, check.path)
  for (;;) {
    const record = await probeAndRecord(deps, 'cdn', url, 'reupload poll', {
      action: 'reupload-poll',
      runId: options.runId,
      path: check.path,
    })
    if (record.status === 200) {
      deps.log(`served again ${Math.round((deps.clock() - started) / 1000)} s after the re-upload`)
      break
    }
    if (deps.clock() + options.intervalMs > deadline) {
      deps.log('still not served at the deadline')
      break
    }
    await deps.sleep(options.intervalMs)
  }
  deps.log(
    `Delete it at the end of the session: pnpm spike cleanup delete --path ${check.path} --confirm`,
  )
  return 0
}

// ---- protection (S1-5) ----

const WatchRow = z.object({
  sample: z.object({
    kind: z.literal('live'),
    at: z.number(),
    deploymentUrl: z.string().nullable(),
  }),
})

/** From watch evidence: the newest live deploymentUrl that is not the current one. */
export function newestSuperseded(rows: readonly unknown[], current: string): string | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = WatchRow.safeParse(rows[index])
    const url = row.success ? row.data.sample.deploymentUrl : null
    if (url !== null && url !== current) return url
  }
  return null
}

export type ProtectionRole = 'superseded' | 'current-generated' | 'branch-alias' | 'production'

/** Plan S1-5: deployments answer 401, or 302/307 to vercel.com/sso-api; production answers 200 JSON. */
export function judgeProtection(role: ProtectionRole, record: ProbeRecord): boolean {
  if (role === 'production') return record.status === 200 && record.mediaType === 'application/json'
  if (record.status === 401) return true
  if ((record.status !== 302 && record.status !== 307) || record.location === null) return false
  try {
    const location = new URL(record.location)
    return location.host === 'vercel.com' && location.pathname.startsWith('/sso-api')
  } catch {
    return false
  }
}

export async function checkProtection(
  deps: SpikeDeps,
  siteUrl: URL,
  options: {
    readonly old: string | null
    readonly current: string | null
    readonly branchAlias: string | null
  },
): Promise<number> {
  let current = options.current
  if (current === null) {
    const sample = await readBuildInfo(siteUrl, {
      fetchImpl: deps.fetchImpl,
      now: () => deps.now().getTime(),
    })
    current = sample.kind === 'live' ? sample.deploymentUrl : null
  }
  const old =
    options.old ??
    (current === null ? null : newestSuperseded(deps.recorder.readEvidence('watch'), current))
  const targets: { role: ProtectionRole; host: string | null }[] = [
    { role: 'superseded', host: old },
    { role: 'current-generated', host: current },
    { role: 'branch-alias', host: options.branchAlias },
    { role: 'production', host: siteUrl.host },
  ]
  let allPass = true
  for (const target of targets) {
    if (target.host === null) {
      deps.log(`${target.role}: no host known (pass it with an option); not checked`)
      allPass = false
      continue
    }
    const url = new URL(`https://${target.host}/build-info.json`)
    const record = await probeAndRecord(deps, 'protection', url, target.role, { role: target.role })
    const pass = judgeProtection(target.role, record)
    allPass &&= pass
    deps.log(
      `${target.role}: ${pass ? 'as expected' : 'NOT as expected'} (status ${record.status ?? '-'})`,
    )
  }
  return allPass ? 0 : 1
}

// ---- statuses (S1-1) ----

const GithubStatus = z.object({
  context: z.string(),
  state: z.string(),
  description: z.string().nullable(),
  target_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

function urlWithoutQuery(raw: string | null): string | null {
  if (raw === null) return null
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return null
  }
}

export async function commitStatuses(
  deps: SpikeDeps,
  options: { readonly sha: string; readonly repo: string },
): Promise<number> {
  const url = new URL(
    `https://api.github.com/repos/${options.repo}/commits/${options.sha}/statuses`,
  )
  url.searchParams.set('per_page', '100')
  const response = await deps.fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'storyboard-p0-13-spike',
      'x-github-api-version': '2022-11-28',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const bytes = await readCapped(response, 1024 * 1024)
  const json =
    bytes && mediaType(response.headers.get('content-type')) === 'application/json'
      ? parseJsonBytes(bytes)
      : null
  const statuses = json?.ok ? z.array(GithubStatus).safeParse(json.value) : null
  if (response.status !== 200 || !statuses?.success) {
    deps.log(`statuses: GitHub answered ${response.status}; no readable status list`)
    return 1
  }
  const rows = statuses.data.map((s) => ({
    context: s.context,
    state: s.state,
    description: s.description,
    target: urlWithoutQuery(s.target_url),
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }))
  deps.recorder.appendEvidence('statuses', {
    at: deps.now().toISOString(),
    repo: options.repo,
    sha: options.sha,
    statuses: rows,
  })
  if (rows.length === 0) deps.log('statuses: none yet')
  for (const row of rows) {
    deps.log(
      `${row.updatedAt} ${row.context}: ${row.state} - ${row.description ?? ''} ${row.target ?? ''}`,
    )
  }
  return 0
}

// ---- cleanup ----

export interface CleanupView {
  readonly both: readonly string[]
  /** Listed but not ours on the ledger: never deleted by this tool. */
  readonly listedOnly: readonly string[]
  /** On the ledger as live but not listed: already gone, or never created. */
  readonly ledgerOnly: readonly string[]
}

export function compareWithLedger(listed: readonly string[], live: readonly string[]): CleanupView {
  const listedSet = new Set(listed)
  const liveSet = new Set(live)
  return {
    both: listed.filter((path) => liveSet.has(path)),
    listedOnly: listed.filter((path) => !liveSet.has(path)),
    ledgerOnly: live.filter((path) => !listedSet.has(path)),
  }
}

async function listSpikes(deps: SpikeDeps, storage: StorageClient): Promise<string[] | null> {
  const listed = await storage.list(BUCKET, WRITE_PREFIX)
  if (listed.kind !== 'listed') {
    deps.log(`list ${listed.kind} status=${listed.status ?? '-'}`)
    if (listed.kind === 'unauthorized') deps.log(UNAUTHORIZED_NOTE)
    return null
  }
  return listed.objects.map((o) => o.path)
}

function logView(deps: SpikeDeps, view: CleanupView): void {
  deps.log(`listed and on the ledger: ${view.both.length}`)
  for (const path of view.both) deps.log(`  ${path}`)
  deps.log(`listed but NOT on the ledger (never deleted by this tool): ${view.listedOnly.length}`)
  for (const path of view.listedOnly) deps.log(`  ${path}`)
  deps.log(`on the ledger but not listed: ${view.ledgerOnly.length}`)
  for (const path of view.ledgerOnly) deps.log(`  ${path}`)
}

export async function cleanupList(deps: SpikeDeps, storage: StorageClient): Promise<number> {
  const listed = await listSpikes(deps, storage)
  if (listed === null) return 1
  const view = compareWithLedger(listed, livePaths(deps.recorder.readLedger()))
  deps.recorder.appendEvidence('cleanup', { at: deps.now().toISOString(), action: 'list', ...view })
  logView(deps, view)
  return 0
}

export async function cleanupDelete(
  deps: SpikeDeps,
  storage: StorageClient,
  options: { readonly all: boolean; readonly paths: readonly string[]; readonly confirm: boolean },
): Promise<number> {
  const live = livePaths(deps.recorder.readLedger())
  const liveSet = new Set(live)
  const requested = options.all ? live : [...new Set(options.paths)]
  const unknown = requested.filter((path) => !liveSet.has(path))
  if (unknown.length > 0) {
    deps.log(`refused: not live on the ledger, so never deleted here: ${unknown.join(', ')}`)
    return 1
  }
  const listed = await listSpikes(deps, storage)
  if (listed === null) return 1
  const listedSet = new Set(listed)
  const targets = requested.filter((path) => listedSet.has(path))
  for (const path of requested.filter((p) => !listedSet.has(p))) {
    deps.log(`not present in Storage (skipped): ${path}`)
  }
  if (targets.length === 0) {
    deps.log('nothing to delete')
    return 0
  }
  if (!options.confirm) {
    for (const path of targets) deps.log(`would delete (permanent): ${path}`)
    deps.log(`dry run: nothing deleted. Add --confirm to delete these ${targets.length} objects.`)
    return 0
  }
  const { removed, ok } = await removeExact(deps, storage, targets)
  deps.log(`deleted ${removed.length} of ${targets.length}`)
  const after = await listSpikes(deps, storage)
  if (after !== null) {
    deps.log(`spikes/ now lists ${after.length} objects`)
    deps.recorder.appendEvidence('cleanup', {
      at: deps.now().toISOString(),
      action: 'delete',
      removed,
      remaining: after,
    })
  }
  return ok ? 0 : 1
}

// ---- env-check ----

export function envCheck(deps: SpikeDeps, env: Env): number {
  const checks = checkPublisherEnv(env)
  for (const check of checks)
    deps.log(check.ok ? `${check.name} ok` : `${check.name} ${check.problem}`)
  return checks.every((check) => check.ok) ? 0 : 1
}

// ---- main ----

const USAGE = `usage: pnpm spike <command>
  env-check
  upload [--bearer-fallback]
  s1 publish --seq N [--wrong-hash] [--hook] [--bearer-fallback]
  watch [--minutes 120] [--interval-ms 5000]
  wait-stable [--minutes 2] [--timeout-minutes 30]
  freshness [--rounds 20] [--bearer-fallback]
  cdn upload [--bearer-fallback]
  cdn warm --run R [--max-tries 12] [--interval-ms 10000]
  cdn delete --run R [--confirm] [--bearer-fallback]
  cdn poll --run R [--interval-ms 30000] [--max-minutes 90]
  cdn reupload --run R [--interval-ms 30000] [--max-minutes 90] [--bearer-fallback]
  protection [--old HOST] [--current HOST] [--branch-alias HOST]
  statuses --sha <40 hex> [--repo owner/name]
  cleanup list [--bearer-fallback]
  cleanup delete (--all | --path P ...) [--confirm] [--bearer-fallback]`

/** Values that must never be printed or written: the raw secret key, the hook URL and its last segment. */
export function forbiddenValues(env: Env): string[] {
  const values = [env.SUPABASE_SECRET_KEY ?? '', env.VERCEL_DEPLOY_HOOK_PRODUCTION ?? '']
  const hookSegment = (env.VERCEL_DEPLOY_HOOK_PRODUCTION ?? '').split('/').filter(Boolean).at(-1)
  if (hookSegment) values.push(hookSegment)
  return values.filter((value) => value.length >= 8)
}

export function scrubber(forbidden: readonly string[]): (text: string) => string {
  return (text) => forbidden.reduce((out, value) => out.split(value).join('[redacted]'), text)
}

function required<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new UsageError(result.reason)
  return result.value
}

function storageFor(
  env: Env,
  deps: SpikeDeps,
  guards: StorageGuards,
  bearerFallback: boolean,
): { storage: StorageClient; origin: URL } {
  const credentials = required(readStorageCredentials(env))
  if (bearerFallback) deps.log('note: --bearer-fallback is on (owner OK required)')
  const storage = createStorageClient({
    supabaseUrl: credentials.supabaseUrl,
    secretKey: credentials.secretKey,
    guards,
    fetchImpl: deps.fetchImpl,
    bearerFallback,
  })
  return { storage, origin: credentials.supabaseUrl }
}

export async function runCommand(command: Command, deps: SpikeDeps, env: Env): Promise<number> {
  switch (command.name) {
    case 'help':
      deps.log(USAGE)
      return 0
    case 'env-check':
      return envCheck(deps, env)
    case 'upload':
      return runAudioUpload(
        deps,
        storageFor(env, deps, spikeGuards(), command.bearerFallback).storage,
      )
    case 's1-publish': {
      const hookUrl = command.hook ? required(readDeployHookUrl(env)) : null
      const { storage } = storageFor(env, deps, spikeGuards(), command.bearerFallback)
      return publishS1(deps, storage, { seq: command.seq, wrongHash: command.wrongHash, hookUrl })
    }
    case 'watch':
      return watch(deps, required(readSiteUrl(env)), command)
    case 'wait-stable':
      return waitStable(deps, required(readSiteUrl(env)), command)
    case 'freshness': {
      const runId = newRunId(deps.now(), deps.recorder.readLedger())
      const { storage, origin } = storageFor(env, deps, spikeGuards(runId), command.bearerFallback)
      return runFreshness(deps, storage, origin, { runId, rounds: command.rounds })
    }
    case 'cdn-upload': {
      const runId = newRunId(deps.now(), deps.recorder.readLedger())
      const { storage } = storageFor(env, deps, spikeGuards(), command.bearerFallback)
      return cdnUpload(deps, storage, runId)
    }
    case 'cdn-warm':
      return cdnWarm(deps, required(readSupabaseUrl(env)), command)
    case 'cdn-delete': {
      const { storage, origin } = storageFor(env, deps, spikeGuards(), command.bearerFallback)
      return cdnDelete(deps, storage, origin, command)
    }
    case 'cdn-poll':
      return cdnPoll(deps, required(readSupabaseUrl(env)), command)
    case 'cdn-reupload': {
      const { storage, origin } = storageFor(env, deps, spikeGuards(), command.bearerFallback)
      return cdnReupload(deps, storage, origin, command)
    }
    case 'protection':
      return checkProtection(deps, required(readSiteUrl(env)), command)
    case 'statuses':
      return commitStatuses(deps, command)
    case 'cleanup-list':
      return cleanupList(deps, storageFor(env, deps, spikeGuards(), command.bearerFallback).storage)
    case 'cleanup-delete': {
      const { storage } = storageFor(env, deps, spikeGuards(), command.bearerFallback)
      return cleanupDelete(deps, storage, command)
    }
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  loadEnvFile()
  const env: Env = process.env
  const forbidden = forbiddenValues(env)
  const scrub = scrubber(forbidden)
  const log = (line: string) => console.log(scrub(line))
  const deps: SpikeDeps = {
    recorder: createRecorder(SPIKE_DIR, forbidden),
    log,
    now: () => new Date(),
    clock: () => performance.now(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    fetchImpl: fetch,
  }
  try {
    return await runCommand(parseCommand(argv), deps, env)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error(scrub(`spike: ${message}`))
    if (error instanceof UsageError) console.error(USAGE)
    return 1
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
