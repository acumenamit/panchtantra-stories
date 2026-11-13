// Prebuild content loader (spec §3.2). Runs as its own tsx process before `next build`, using Node's
// global fetch, so Next's fetch cache is never involved. It reads public configuration only:
//   CONTENT_SOURCE    storage | none. Unset: skipped, except when VERCEL_ENV=production, where the
//                     build fails, so a lost setting can never publish an empty site.
//   CONTENT_BASE_URL  https://<ref>.supabase.co/storage/v1/object/public/content
//   CONTENT_POINTER   <root>catalogue/production.json | <root>catalogue/staging.json (sets the gate mode)
// Outputs: .content/ (pages read only this) and public/build-info.json, written after every gate passes.
// Any failure prints "content gate failed: <reason>" and exits 1, so Vercel keeps the last good deployment.
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BuildInfo, type ContentFetch } from '../src/core/content/build-info'
import {
  checkPointer,
  checkSnapshot,
  DEFAULT_POINTER_ROOTS,
  modeFromPointerPath,
  type GateResult,
  type PointerLocation,
} from '../src/core/content/gates'
import { jcsBytes, sha256Hex } from '../src/core/hashing'
import {
  checkServiceUrl,
  describeNetworkError,
  mediaType,
  readCapped,
} from '../tools/publisher/http'

export const POINTER_ROOTS: readonly string[] = DEFAULT_POINTER_ROOTS

export const MAX_BODY_BYTES = 1024 * 1024
export const MAX_ATTEMPTS = 3 // one request plus up to 2 retries, on network errors or 5xx only
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRY_DELAY_MS = 1_000

export type Env = Readonly<Record<string, string | undefined>>

export interface LoaderOptions {
  readonly env: Env
  /** The storyboard folder: outputs go to <root>/.content/ and <root>/public/build-info.json. */
  readonly root: string
  readonly fetchImpl?: typeof fetch
  readonly now?: () => Date
  readonly clock?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly log?: (line: string) => void
  readonly logError?: (line: string) => void
  readonly timeoutMs?: number
  readonly retryDelayMs?: number
  readonly roots?: readonly string[]
}

export type LoaderConfig =
  | { readonly kind: 'skip'; readonly why: string }
  | {
      readonly kind: 'storage'
      readonly baseUrl: URL
      readonly pointerPath: string
      readonly location: PointerLocation
    }

const ok = <T>(value: T): GateResult<T> => ({ ok: true, value })
const fail = <T>(reason: string): GateResult<T> => ({ ok: false, reason })

/** Reads the environment only; never echoes a value, so a misplaced secret is never printed. */
export function resolveConfig(
  env: Env,
  roots: readonly string[] = POINTER_ROOTS,
): GateResult<LoaderConfig> {
  const source = env.CONTENT_SOURCE ?? ''
  if (source === '') {
    if (env.VERCEL_ENV === 'production') {
      return fail('CONTENT_SOURCE is not set; it is required when VERCEL_ENV=production')
    }
    return ok({ kind: 'skip', why: 'CONTENT_SOURCE is not set' })
  }
  if (source === 'none') return ok({ kind: 'skip', why: 'CONTENT_SOURCE=none' })
  if (source !== 'storage') return fail('CONTENT_SOURCE must be "storage" or "none"')

  const baseUrl = parseBaseUrl(env.CONTENT_BASE_URL)
  if (!baseUrl.ok) return baseUrl
  const pointerPath = env.CONTENT_POINTER ?? ''
  if (pointerPath === '') return fail('CONTENT_POINTER is not set')
  const location = modeFromPointerPath(pointerPath, roots)
  if (!location.ok) return location
  // Staging skips the approval gate; it is for local preview and hosted Previews only (spec §3.2).
  if (env.VERCEL_ENV === 'production' && location.value.mode !== 'production') {
    return fail('CONTENT_POINTER must be a production pointer when VERCEL_ENV=production')
  }
  return ok({ kind: 'storage', baseUrl: baseUrl.value, pointerPath, location: location.value })
}

const VERCEL_ENV_NAMES: ReadonlySet<string> = new Set(['production', 'preview', 'development'])

/** VERCEL_ENV for log lines: one of Vercel's names, "unset" or "other"; never an arbitrary value. */
export function vercelEnvName(env: Env): string {
  const value = env.VERCEL_ENV ?? ''
  if (value === '') return 'unset'
  return VERCEL_ENV_NAMES.has(value) ? value : 'other'
}

function parseBaseUrl(raw: string | undefined): GateResult<URL> {
  if (!raw) return fail('CONTENT_BASE_URL is not set')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail('CONTENT_BASE_URL is not a valid URL')
  }
  try {
    // https, or plain http on a loopback test server; no credentials and no fragment.
    checkServiceUrl(url, 'CONTENT_BASE_URL')
  } catch (error) {
    return fail(error instanceof TypeError ? error.message : 'CONTENT_BASE_URL is not allowed')
  }
  if (url.search) return fail('CONTENT_BASE_URL must not carry a query')
  return ok(url)
}

/** Joins a gate-checked (safe) Storage path onto the base URL. */
export function objectUrl(baseUrl: URL, path: string): URL {
  return new URL(`${baseUrl.href.replace(/\/+$/, '')}/${path}`)
}

/** The CDN location from a cf-ray header such as "8f1a2b3c4d5e6f70-BOM". */
export function popFromCfRay(cfRay: string | null): string | null {
  const pop = cfRay?.split('-').pop()
  return pop && /^[A-Za-z0-9]{2,8}$/.test(pop) ? pop.toUpperCase() : null
}

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

/** The seq field of a JSON body, for the fetch log line only (gates run later). */
function peekSeq(body: Uint8Array): string {
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

type Attempt =
  | { readonly kind: 'network'; readonly error: string; readonly ms: number }
  | {
      readonly kind: 'response'
      readonly status: number
      readonly headers: Headers
      readonly body: Uint8Array<ArrayBuffer> | null // null: larger than MAX_BODY_BYTES
      readonly ms: number
    }

interface FetchContext {
  readonly fetchImpl: typeof fetch
  readonly clock: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly log: (line: string) => void
  readonly timeoutMs: number
  readonly retryDelayMs: number
  readonly fetches: ContentFetch[]
}

async function getOnce(url: URL, ctx: FetchContext): Promise<Attempt> {
  const started = ctx.clock()
  const elapsed = () => Math.max(0, Math.round(ctx.clock() - started))
  try {
    const response = await ctx.fetchImpl(url, {
      headers: { 'accept-encoding': 'identity' },
      redirect: 'manual',
      signal: AbortSignal.timeout(ctx.timeoutMs),
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

async function record(path: string, attempt: Attempt, ctx: FetchContext): Promise<void> {
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

/** GETs one JSON object: 200 only, application/json (parameters ignored), at most MAX_BODY_BYTES. */
async function getJson(
  label: string,
  path: string,
  url: URL,
  ctx: FetchContext,
): Promise<GateResult<Uint8Array<ArrayBuffer>>> {
  for (let attempt = 1; ; attempt++) {
    const result = await getOnce(url, ctx)
    await record(path, result, ctx)
    if (result.kind === 'response' && result.status === 200) {
      const type = mediaType(result.headers.get('content-type'))
      if (type !== 'application/json') {
        return fail(`${label} content-type must be application/json, got ${type || 'none'}`)
      }
      if (!result.body) return fail(`${label} is larger than ${MAX_BODY_BYTES} bytes`)
      return ok(result.body)
    }
    if (result.kind === 'response' && result.status < 500) {
      return fail(`${label} GET returned status ${result.status}`) // 3xx and 4xx are never retried
    }
    if (attempt >= MAX_ATTEMPTS) {
      const what = result.kind === 'network' ? result.error : `status ${result.status}`
      return fail(`${label} GET failed after ${MAX_ATTEMPTS} attempts: ${what}`)
    }
    await ctx.sleep(ctx.retryDelayMs * attempt)
  }
}

export interface LoadedContent {
  readonly buildInfo: BuildInfo
  readonly pointerBytes: Uint8Array<ArrayBuffer>
  readonly snapshotBytes: Uint8Array<ArrayBuffer>
}

function vercelValue(env: Env, name: string): string | null {
  const value = env[name]?.trim()
  return value ? value.slice(0, 256) : null
}

async function loadFromStorage(
  config: Extract<LoaderConfig, { kind: 'storage' }>,
  env: Env,
  now: () => Date,
  ctx: FetchContext,
): Promise<GateResult<LoadedContent>> {
  const { mode } = config.location
  const pointerUrl = objectUrl(config.baseUrl, config.pointerPath)
  pointerUrl.searchParams.set('cacheNonce', String(now().getTime()))
  const pointerBytes = await getJson('pointer', config.pointerPath, pointerUrl, ctx)
  if (!pointerBytes.ok) return pointerBytes
  const pointer = checkPointer(pointerBytes.value, config.location)
  if (!pointer.ok) return pointer

  const { snapshotPath } = pointer.value
  const snapshotUrl = objectUrl(config.baseUrl, snapshotPath)
  const snapshotBytes = await getJson('snapshot', snapshotPath, snapshotUrl, ctx)
  if (!snapshotBytes.ok) return snapshotBytes
  const checked = await checkSnapshot(snapshotBytes.value, pointer.value, mode)
  if (!checked.ok) return checked

  const { snapshot, included, excluded } = checked.value
  // Packages, the validator and the media HEAD gate arrive in P1-2; until then fail closed.
  if (included.length > 0) {
    return fail(
      `snapshot lists ${included.length} stories to build; package loading arrives in P1-2`,
    )
  }
  for (const story of excluded) {
    ctx.log(
      `content: excluded story=${story.storyId} version=${story.version} reason=approval-missing`,
    )
  }
  const buildInfo = BuildInfo.safeParse({
    schemaVersion: '1.0',
    mode,
    seq: snapshot.seq,
    pointerPath: config.pointerPath,
    snapshotPath,
    snapshotSha256: pointer.value.snapshotSha256,
    featuredStoryId: null, // a featured story must be built; none is until P1-2
    stories: [],
    excluded: excluded.map((s) => ({
      storyId: s.storyId,
      version: s.version,
      reason: 'approval-missing',
    })),
    appVersion: vercelValue(env, 'VERCEL_GIT_COMMIT_SHA'),
    deploymentId: vercelValue(env, 'VERCEL_DEPLOYMENT_ID'),
    deploymentUrl: vercelValue(env, 'VERCEL_URL'),
    builtAt: now().toISOString(),
    fetches: ctx.fetches,
  })
  if (!buildInfo.success) return fail('build-info failed strict parse')
  if (snapshot.featuredStoryId !== null) {
    ctx.log(
      `content: featured story=${snapshot.featuredStoryId} is not built; featuredStoryId=null`,
    )
  }
  return ok({
    buildInfo: buildInfo.data,
    pointerBytes: pointerBytes.value,
    snapshotBytes: snapshotBytes.value,
  })
}

export function outputPaths(root: string) {
  const contentDir = join(root, '.content')
  return {
    contentDir,
    tmpDir: join(contentDir, '.tmp'),
    publicBuildInfo: join(root, 'public', 'build-info.json'),
  }
}

export function removeStaleOutputs(root: string): void {
  const paths = outputPaths(root)
  rmSync(paths.contentDir, { recursive: true, force: true })
  rmSync(paths.publicBuildInfo, { force: true })
}

/** Each file is written beside the outputs, then renamed, so no reader ever sees a partial file. */
function writeOutputs(root: string, loaded: LoadedContent): void {
  const paths = outputPaths(root)
  mkdirSync(paths.tmpDir, { recursive: true })
  mkdirSync(dirname(paths.publicBuildInfo), { recursive: true })
  const writeAtomic = (target: string, bytes: Uint8Array) => {
    const tmp = join(paths.tmpDir, basename(target))
    writeFileSync(tmp, bytes)
    renameSync(tmp, target)
  }
  const buildInfoBytes = jcsBytes(loaded.buildInfo)
  writeAtomic(join(paths.contentDir, 'pointer.json'), loaded.pointerBytes)
  writeAtomic(join(paths.contentDir, 'snapshot.json'), loaded.snapshotBytes)
  writeAtomic(join(paths.contentDir, 'build-info.json'), buildInfoBytes)
  writeAtomic(paths.publicBuildInfo, buildInfoBytes) // last: its presence means "content loaded"
  rmSync(paths.tmpDir, { recursive: true, force: true })
}

/** Returns the process exit code: 0 (loaded or skipped) or 1 (gate failed). Never throws. */
export async function loadContent(options: LoaderOptions): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line))
  const logError = options.logError ?? ((line: string) => console.error(line))
  const failWith = (reason: string) => {
    logError(`content gate failed: ${reason}`)
    return 1
  }
  try {
    const config = resolveConfig(options.env, options.roots)
    if (!config.ok) return failWith(config.reason)
    removeStaleOutputs(options.root)
    if (config.value.kind === 'skip') {
      // The environment is named, so a skipped Production build stands out in the Vercel log.
      log(`content: skipped (${config.value.why}; VERCEL_ENV=${vercelEnvName(options.env)})`)
      return 0
    }
    const now = options.now ?? (() => new Date())
    const ctx: FetchContext = {
      fetchImpl: options.fetchImpl ?? fetch,
      clock: options.clock ?? (() => performance.now()),
      sleep: options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
      log,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      fetches: [],
    }
    const loaded = await loadFromStorage(config.value, options.env, now, ctx)
    if (!loaded.ok) return failWith(loaded.reason)
    writeOutputs(options.root, loaded.value)
    const info = loaded.value.buildInfo
    log(`content: mode=${info.mode} seq=${info.seq} snapshot=${info.snapshotPath}`)
    return 0
  } catch (error) {
    return failWith(`unexpected error: ${error instanceof Error ? error.message : 'unknown'}`)
  }
}

/**
 * True when this file is the process entry point (tsx scripts/load-content.ts), not an import.
 * Both sides are resolved to the real file first: import.meta.url is already the real path, while
 * argv[1] keeps a symlink, junction or subst drive as typed. A raw comparison would then skip the
 * loader, and with it every fail-closed gate, and exit 0.
 */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false
  const self = realFile(fileURLToPath(moduleUrl))
  const entry = realFile(resolve(argv1))
  return process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry
}

/** The canonical path with links, junctions and subst drives resolved; the path itself if missing. */
function realFile(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  void loadContent({ env: process.env, root }).then((code) => process.exit(code))
}
