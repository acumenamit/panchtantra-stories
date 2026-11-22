// Step 15b (P1-8d part b) publish.ts kind unpublish: `publish --unpublish <id> [--takedown]`
// through runPublish (design migration-input/p1-step15b-design.md §3.2 to §3.12, §3.17, §3.18,
// §3.22, §4.2, D15B-1 to D15B-12, D15B-17, D15B-18, D15B-22, D15B-28 to D15B-33; test plan §14.10:
// T15B-32 to T15B-43).
// Every Storage call goes to the loopback stub (deletes on) through a real client built in the test
// with a fake key assembled at run time, held as `const port: UnpublishPort = client`; makePort is a
// spy that throws unless a test publishes. Every DELETE goes through the real hardened deleter on
// the stub's own origin. The hook, verify and the Range check are fakes that record their calls in
// `calls` (verify as `verify <seq> <absent ids>`). A loopback guard on the global fetch refuses and
// counts any other host. Takedown runs write the audio tree and the hash list under the test's own
// temp root. Every test ends with expectUnpublishSafe (TP-14).
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planMediaHeads } from '../../src/core/content/media'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import type { CatalogueSnapshot } from '../../src/core/package/catalogue'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { parseArgs } from './args'
import { runApprove } from './approve'
import { buildProductionDocuments, buildStagingDocuments } from './catalogue-state'
import { createContentDeleter } from './content-deleter'
import { Secret } from './env'
import type { ContentRemover, PublishPort, RangeAnswer, RangeTarget, UnpublishPort } from './port'
import { runPublish, type PublishTail, type VerifyAnswer } from './publish'
import { RANGE_RECOVERY, TAKEDOWN_LAG_NOTE, VERIFY_TIMEOUT_HINT } from './report'
import { runStage } from './stage'
import {
  answersOf,
  buildTestStories,
  fullyBoundStory,
  hashListOf,
  mp3Bytes,
  withPackage,
  writeAudioTree,
  writeStageInputs,
  type TestStory,
} from './stage-testkit'
import { createStorageClient, type StorageClient } from './storage'
import { classOfPath } from './storage-layout'
import {
  expectNoUnexpected,
  startStorageStub,
  type StorageStub,
  type StubLogEntry,
} from './storage-stub'

// ---- shared material ----

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-unpublish-test-key'].join('_')
const NOW = '2026-11-22T12:00:00.000Z'
const ID = 'two-paths'
const RIVER = 'river-stones'
const LIST_PATH = '/storage/v1/object/list/content'
const READ = '/storage/v1/object/authenticated/'
const CREATE = '/storage/v1/object/'
const DELETE_PATH = '/storage/v1/object/content'
const PRODUCTION_WRITE = `${CREATE}content/catalogue/production.json`
const STAGING_WRITE = `${CREATE}content/catalogue/staging.json`
const snapshotWrite = (seq: number) => `${CREATE}content/catalogue/snapshots/${seq}.json`
const snapshotRead = (seq: number) => `${READ}content/catalogue/snapshots/${seq}.json`
const MISSING_BODY = '{"statusCode":"404","error":"not_found","message":"Object not found"}'
const TIMEOUT = { timeout: 240_000 }
const sha12 = (sha: string) => sha.slice(0, 12)
const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const native = (path: string) => realpathSync.native(path)

// ---- loopback guard (§14.1 "Network") ----

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0
let root = ''
const stubs: StorageStub[] = []
const marks = new Map<StorageStub, number>()

beforeEach(() => {
  escapes = 0
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
    escapes++
    return Promise.reject(new TypeError('blocked: not a loopback host'))
  })
  root = mkdtempSync(join(tmpdir(), 's15b-'))
  mkdirSync(join(root, 'public'))
})

afterEach(async () => {
  const problems: unknown[] = []
  for (const stub of stubs.splice(0)) {
    try {
      expectNoUnexpected(stub)
    } catch (error) {
      problems.push(error)
    }
    await stub.close()
  }
  marks.clear()
  rmSync(root, { recursive: true, force: true })
  const count = escapes
  vi.unstubAllGlobals()
  expect(count, 'loopback guard: requests that tried to leave 127.0.0.1').toBe(0)
  if (problems.length > 0) throw problems[0]
})

async function newStub(key = FAKE_KEY): Promise<StorageStub> {
  const stub = await startStorageStub({ apikey: key, deletes: true })
  stubs.push(stub)
  return stub
}
const keyOf = new Map<StorageStub, string>()

const mark = (stub: StorageStub) => void marks.set(stub, stub.requests.length)
const since = (stub: StorageStub) => stub.requests.slice(marks.get(stub) ?? 0)
const isObjectPost = (r: StubLogEntry) => r.method === 'POST' && r.pathname !== LIST_PATH
const objectPosts = (stub: StorageStub) => since(stub).filter(isObjectPost)
const deletesOf = (log: readonly StubLogEntry[]) => log.filter((r) => r.method === 'DELETE')
/** A stub's requests since its mark, kept for a TP-14 check at the end of the test. */
const logOf = (stub: StorageStub) => ({ requests: since(stub), unexpected: [...stub.unexpected] })

type LogLike = Pick<StorageStub, 'requests' | 'unexpected'>

/**
 * TP-14: each DELETE is DELETE /storage/v1/object/content, no search, content-type
 * application/json, a strict JSON body of exactly `prefixes` whose every path is the package or
 * media class of `storyId` and, when given, in `planned`. Throws naming the method and pathname.
 */
function expectDeletesConfined(stub: LogLike, storyId: string, planned?: readonly string[]): void {
  for (const r of stub.requests.filter((q) => q.method === 'DELETE')) {
    const where = `${r.method} ${r.pathname}`
    if (r.pathname !== DELETE_PATH || r.search !== '') throw new Error(`confined: ${where}`)
    if (r.values['content-type'] !== 'application/json') throw new Error(`confined: ${where}`)
    let body: unknown
    try {
      body = JSON.parse(decode(r.body))
    } catch {
      throw new Error(`confined: ${where}`)
    }
    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).join(',') !== 'prefixes' ||
      !Array.isArray((body as { prefixes: unknown }).prefixes)
    ) {
      throw new Error(`confined: ${where}`)
    }
    for (const path of (body as { prefixes: unknown[] }).prefixes) {
      const found = typeof path === 'string' ? classOfPath('content', path) : null
      if (
        found === null ||
        (found.kind !== 'package' && found.kind !== 'media') ||
        found.fields.storyId !== storyId ||
        (planned !== undefined && !planned.includes(path as string))
      ) {
        throw new Error(`confined: ${where}`)
      }
    }
  }
  expectNoUnexpected(stub as StorageStub)
}

interface Safe {
  readonly seq: number | null
  readonly moves: 'both' | 'staging' | 'none'
  readonly storyId: string
  readonly takedown: boolean
}
/**
 * TP-14: after the mark, object POSTs only to catalogue/snapshots/<seq>.json (at most two, none
 * when nothing moves), catalogue/production.json (at most one, only when both move) and
 * catalogue/staging.json (at most one, none when nothing moves); none under masters; DELETEs only
 * with takedown, each confined; then expectNoUnexpected. Throws naming the method and pathname.
 */
function expectUnpublishSafe(stub: LogLike, safe: Safe): void {
  const log = stub.requests.slice(marks.get(stub as StorageStub) ?? 0)
  const posts = log.filter(isObjectPost)
  for (const r of posts) {
    const where = `${r.method} ${r.pathname}`
    if (r.pathname.startsWith(`${CREATE}masters/`)) throw new Error(`unpublish-safe: ${where}`)
    const snapshot = r.pathname.startsWith(`${CREATE}content/catalogue/snapshots/`)
    if (snapshot && (safe.moves === 'none' || r.pathname !== snapshotWrite(safe.seq ?? 0))) {
      throw new Error(`unpublish-safe: ${where}`)
    }
    if (r.pathname === PRODUCTION_WRITE && safe.moves !== 'both') {
      throw new Error(`unpublish-safe: ${where}`)
    }
    if (r.pathname === STAGING_WRITE && safe.moves === 'none') {
      throw new Error(`unpublish-safe: ${where}`)
    }
    if (!snapshot && r.pathname !== PRODUCTION_WRITE && r.pathname !== STAGING_WRITE) {
      throw new Error(`unpublish-safe: ${where}`)
    }
  }
  const count = (path: string) => posts.filter((r) => r.pathname === path).length
  if (posts.filter((r) => r.pathname.includes('/catalogue/snapshots/')).length > 2) {
    throw new Error('unpublish-safe: more than two snapshot POSTs')
  }
  if (count(PRODUCTION_WRITE) > 1 || count(STAGING_WRITE) > 1) {
    throw new Error('unpublish-safe: more than one POST of a pointer')
  }
  const dels = deletesOf(log)
  if (!safe.takedown && dels.length > 0) {
    throw new Error(`unpublish-safe: ${dels[0]!.method} ${dels[0]!.pathname}`)
  }
  expectDeletesConfined({ requests: log, unexpected: stub.unexpected }, safe.storyId)
}

let cached: Promise<TestStory[]> | null = null
const testStories = (): Promise<TestStory[]> => (cached ??= buildTestStories())
const storyOf = async (id = ID): Promise<TestStory> =>
  (await testStories()).find((story) => story.storyId === id)!

function fakeClock(iso = NOW) {
  let t = Date.parse(iso)
  return { now: () => new Date(t), advance: (ms: number) => void (t += ms) }
}
const context = () => ({ cwd: root, storyboardRoot: root, platform: process.platform })
const reportDir = () => join(root, 'reports')
const client = (stub: StorageStub, fetchImpl?: typeof fetch): StorageClient =>
  createStorageClient({
    supabaseUrl: stub.origin,
    secretKey: new Secret(keyOf.get(stub) ?? FAKE_KEY),
    ...(fetchImpl ? { fetchImpl } : {}),
  })
const packagePathOf = (story: TestStory) => `packages/${story.storyId}/${story.packageSha256}.json`
const storyPaths = (story: TestStory) => [packagePathOf(story), ...story.media.map((m) => m.path)]
const sorted = (paths: readonly string[]) => [...paths].sort()

async function stageIn(stub: StorageStub, stories: readonly TestStory[]): Promise<void> {
  for (const story of stories) {
    stub.put(
      'masters',
      `waivers/${story.storyId}/${story.waiverSha256}.json`,
      story.waiverBytes,
      'application/json',
    )
  }
  const dirs = writeStageInputs(join(root, 'in'), stories)
  const parsed = parseArgs(
    [
      'stage',
      ...stories.map((s) => s.storyId),
      '--packages',
      dirs.packagesDir,
      '--media',
      dirs.mediaDir,
      '--waivers',
      dirs.waiversDir,
      '--report-dir',
      join(root, 'stage-reports'),
    ],
    context(),
  )
  if (!parsed.ok || parsed.command !== 'stage') throw new Error('test setup: stage args')
  const port = client(stub)
  const exit = await runStage(parsed, {
    storyboardRoot: root,
    platform: process.platform,
    now: () => new Date(NOW),
    sleep: async () => {},
    log: () => {},
    error: () => {},
    makePort: () => port,
  })
  if (exit !== 0) throw new Error(`test setup: stage exited ${exit}`)
  mark(stub)
}

async function approveIn(stub: StorageStub, story: TestStory): Promise<void> {
  const parsed = parseArgs(
    [
      'approve',
      story.storyId,
      '--package',
      sha12(story.packageSha256),
      '--answers-stdin',
      '--report-dir',
      join(root, 'approve-reports'),
    ],
    context(),
  )
  if (!parsed.ok || parsed.command !== 'approve') throw new Error('test setup: approve args')
  const port = client(stub)
  const exit = await runApprove(parsed, {
    storyboardRoot: root,
    platform: process.platform,
    now: () => new Date(NOW),
    sleep: async () => {},
    log: () => {},
    error: () => {},
    runMode: 'pc',
    makePort: () => port,
    answers: {
      kind: 'stdin',
      input: Readable.from([JSON.stringify(answersOf(story))]),
      deadline: new Promise<void>(() => {}),
    },
  })
  if (exit !== 0) throw new Error(`test setup: approve exited ${exit}`)
  mark(stub)
}

type Before = (url: URL, init: RequestInit) => Promise<Response | void> | Response | void
type After = (url: URL, init: RequestInit) => Promise<void> | void
interface FetchOptions {
  readonly before?: Before
  readonly after?: After
  /** Content paths that read as not found and are left out of listings (read on every call). */
  readonly deleted?: Set<string>
}
function wrapFetch(options: FetchOptions): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const opts = init ?? {}
    const deleted = options.deleted ?? new Set<string>()
    const method = opts.method ?? 'GET'
    if (method === 'GET' && url.pathname.startsWith(`${READ}content/`)) {
      if (deleted.has(url.pathname.slice(`${READ}content/`.length))) {
        return new Response(MISSING_BODY, {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
    }
    const answer = options.before ? await options.before(url, opts) : undefined
    if (answer instanceof Response) return answer
    let response = await globalThis.fetch(input, opts)
    if (deleted.size > 0 && method === 'POST' && url.pathname === LIST_PATH) {
      const prefix = (JSON.parse(String(opts.body)) as { prefix: string }).prefix
      const page = (await response.json()) as { name: string }[]
      const kept = page.filter((entry) => !deleted.has(`${prefix}/${entry.name}`))
      response = new Response(JSON.stringify(kept), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (options.after) await options.after(url, opts)
    return response
  }) as typeof fetch
}
const isPost = (init: RequestInit, url: URL, pathname: string) =>
  init.method === 'POST' && url.pathname === pathname

interface RunOptions extends FetchOptions {
  readonly hook?: 'triggered' | 'failed' | (() => Promise<'triggered' | 'failed'>)
  readonly verify?: (seq: number) => Promise<VerifyAnswer> | VerifyAnswer
  readonly range?: (target: RangeTarget) => RangeAnswer
  readonly reportDir?: string
  readonly realPath?: (path: string) => string
  readonly makeRemover?: () => ContentRemover
  /** The deleter's fetchImpl (loopback only). */
  readonly removerFetch?: typeof fetch
  /** True when makePort may build the client (publish and rollback runs). */
  readonly publishPort?: boolean
}

interface Ran {
  readonly exit: number
  readonly out: string[]
  readonly err: string[]
  readonly calls: string[]
  readonly targets: { readonly target: RangeTarget; readonly index: number }[]
  readonly factories: string[]
  readonly removers: number
  readonly report: Record<string, unknown> | null
  readonly md: string
}

/** The Range answer the fakes give by default: D15B-16's middle range of the target. */
const okRange = (target: RangeTarget): RangeAnswer => {
  const start = Math.floor(target.bytes / 2)
  return { kind: 'ok', start, end: Math.min(target.bytes - 1, start + 1023), size: target.bytes }
}

/** One runPublish of `publish <args>` through a real client on the stub; the mark first. */
async function run(
  stub: StorageStub,
  args: readonly string[],
  options: RunOptions = {},
): Promise<Ran> {
  mark(stub)
  const out: string[] = []
  const err: string[] = []
  const calls: string[] = []
  const targets: { target: RangeTarget; index: number }[] = []
  const factories: string[] = []
  let removers = 0
  const clock = fakeClock()
  const dir = options.reportDir ?? reportDir()
  const parsed = parseArgs(['publish', ...args, '--report-dir', dir], context())
  if (!parsed.ok || parsed.command !== 'publish') throw new Error('test setup: publish args')
  const wrapped =
    options.before || options.after || options.deleted ? wrapFetch(options) : undefined
  const port = client(stub, wrapped)
  const tail: PublishTail = {
    hook: async () => {
      calls.push('hook')
      const hook = options.hook ?? 'triggered'
      return typeof hook === 'function' ? hook() : hook
    },
    verify: async (seq, absent) => {
      calls.push(`verify ${seq}${absent === undefined ? '' : ` ${absent.join(',')}`}`)
      return options.verify ? options.verify(seq) : { kind: 'live', seq }
    },
    range: async (target) => {
      targets.push({ target, index: calls.length })
      calls.push('range')
      return options.range ? options.range(target) : okRange(target)
    },
  }
  const exit = await runPublish(parsed, {
    storyboardRoot: root,
    platform: process.platform,
    now: clock.now,
    sleep: async (ms) => clock.advance(ms),
    log: (line) => void out.push(line),
    error: (line) => void err.push(line),
    runMode: 'pc',
    makePort: () => {
      factories.push('publish')
      if (options.publishPort !== true) throw new Error('test spy: makePort was not expected')
      const writer: PublishPort = port
      return writer
    },
    makeUnpublishPort: () => {
      factories.push('unpublish')
      const writer: UnpublishPort = port
      return writer
    },
    makeRemover: () => {
      removers += 1
      if (options.makeRemover) return options.makeRemover()
      return createContentDeleter({
        supabaseUrl: stub.origin,
        secretKey: new Secret(keyOf.get(stub) ?? FAKE_KEY),
        storyId: parsed.unpublish ?? '',
        ...(options.removerFetch ? { fetchImpl: options.removerFetch } : {}),
      })
    },
    realPath: options.realPath ?? native,
    tail,
  })
  const json = join(dir, 'publisher-publish.json')
  const md = join(dir, 'publisher-publish.md')
  return {
    exit,
    out,
    err,
    calls,
    targets,
    factories,
    removers,
    report: existsSync(json)
      ? (JSON.parse(readFileSync(json, 'utf8')) as Record<string, unknown>)
      : null,
    md: existsSync(md) ? readFileSync(md, 'utf8') : '',
  }
}
const unpublish = (stub: StorageStub, args: readonly string[], options: RunOptions = {}) =>
  run(stub, ['--unpublish', ...args], options)
const publish = (stub: StorageStub, args: readonly string[], options: RunOptions = {}) =>
  run(stub, args, { ...options, publishPort: true })

/** Stories staged, approved and (optionally) published, in that order. */
async function prepared(
  stories: readonly TestStory[],
  approved: readonly TestStory[] = stories,
  published: readonly string[][] = [],
  key = FAKE_KEY,
): Promise<StorageStub> {
  const stub = await newStub(key)
  keyOf.set(stub, key)
  await stageIn(stub, stories)
  for (const story of approved) await approveIn(stub, story)
  for (const ids of published) {
    const r = await publish(stub, ids)
    if (r.exit !== 0) throw new Error(`test setup: publish ${ids.join(' ')} exited ${r.exit}`)
  }
  return stub
}
/** The shared seed: production seq 2 holds both stories, staging seq 1 holds both. */
const seed = async () => prepared([await storyOf(), await storyOf(RIVER)], undefined, [[ID, RIVER]])

/** The snapshot the stub's `mode` pointer names, and the pointer's seq and bytes. */
function pointed(stub: StorageStub, mode: 'staging' | 'production') {
  const bytes = stub.object('content', `catalogue/${mode}.json`)?.bytes
  if (bytes === undefined) return null
  const pointer = JSON.parse(decode(bytes)) as { seq: number; snapshotPath: string }
  const snapshot = JSON.parse(
    decode(stub.object('content', pointer.snapshotPath)!.bytes),
  ) as CatalogueSnapshot
  return { seq: pointer.seq, snapshot, bytes: decode(bytes) }
}
const snapshotAt = (stub: StorageStub, seq: number): CatalogueSnapshot =>
  JSON.parse(
    decode(stub.object('content', `catalogue/snapshots/${seq}.json`)!.bytes),
  ) as CatalogueSnapshot

async function putDocuments(
  stub: StorageStub,
  mode: 'staging' | 'production',
  seq: number,
  stories: readonly SnapshotEntry[],
  featuredStoryId: string | null = null,
  pointer = true,
): Promise<void> {
  const composition = { featuredStoryId, stories, note: 'test' }
  const built =
    mode === 'production'
      ? await buildProductionDocuments(composition, seq, new Date(NOW))
      : await buildStagingDocuments(composition, seq, new Date(NOW))
  if (!built.ok) throw new Error(`test setup: ${mode} documents`)
  stub.put(
    'content',
    `catalogue/snapshots/${seq}.json`,
    built.documents.snapshot.bytes,
    'application/json',
  )
  if (pointer) {
    stub.put('content', `catalogue/${mode}.json`, built.documents.pointer.bytes, 'application/json')
  }
}
/** A pointer document of `mode` at `seq` over `stories` (its snapshot not stored). */
async function pointerBytes(
  mode: 'staging' | 'production',
  seq: number,
  stories: readonly SnapshotEntry[],
): Promise<Uint8Array> {
  const composition = { featuredStoryId: null, stories, note: 'test' }
  const built =
    mode === 'production'
      ? await buildProductionDocuments(composition, seq, new Date(NOW))
      : await buildStagingDocuments(composition, seq, new Date(NOW))
  if (!built.ok) throw new Error('test setup: pointer bytes')
  return built.documents.pointer.bytes
}

/** The request classes after the mark, consecutive repeats collapsed. */
function classes(stub: StorageStub): string[] {
  const named = since(stub).map((r) => {
    if (r.method === 'DELETE') return 'delete'
    if (r.method === 'POST' && r.pathname === LIST_PATH) {
      const prefix = (JSON.parse(decode(r.body)) as { prefix: string }).prefix
      if (prefix.startsWith('catalogue')) return 'catalogue-list'
      if (prefix.startsWith('packages/')) return 'packages-list'
      if (prefix.startsWith('media/')) return 'media-list'
      return `list ${prefix}`
    }
    if (r.method === 'GET' && r.pathname.endsWith('/catalogue/production.json')) {
      return 'production-read'
    }
    if (r.method === 'GET' && r.pathname.endsWith('/catalogue/staging.json')) return 'staging-read'
    if (r.method === 'GET' && r.pathname.includes('/catalogue/snapshots/')) return 'snapshot-read'
    if (r.method === 'GET' && r.pathname.startsWith(`${READ}masters/approvals/`)) return 'approval'
    if (r.method === 'GET' && r.pathname.startsWith(`${READ}content/packages/`)) return 'package'
    if (r.method === 'GET' && r.pathname.startsWith(`${READ}masters/waivers/`)) return 'waiver'
    if (r.method === 'POST' && r.pathname.startsWith(`${CREATE}content/catalogue/snapshots/`)) {
      return 'snapshot-create'
    }
    if (r.method === 'POST' && r.pathname === PRODUCTION_WRITE) return 'production-write'
    if (r.method === 'POST' && r.pathname === STAGING_WRITE) return 'staging-write'
    return `other ${r.method} ${r.pathname}`
  })
  return named.filter((name, index) => name !== named[index - 1])
}
const STATE_READS = [
  'catalogue-list',
  'production-read',
  'snapshot-read',
  'staging-read',
  'snapshot-read',
]
const COMMIT = [
  'snapshot-create',
  'snapshot-read',
  'catalogue-list',
  'production-read',
  'staging-read',
  'production-write',
  'production-read',
  'catalogue-list',
  'staging-read',
]
const STAGING_MOVE = [
  'catalogue-list',
  'production-read',
  'staging-read',
  'staging-write',
  'staging-read',
  'catalogue-list',
  'production-read',
]

/** The first audio/mpeg head of the stories' packages in order, as a Range target. */
function firstMp3(stories: readonly TestStory[]): RangeTarget {
  const plan = planMediaHeads(
    stories.map((s) => ({ pkg: s.pkg })),
    '',
  )
  if (!plan.ok) throw new Error('test setup: media plan')
  const head = plan.value.heads.find((h) => h.mime === 'audio/mpeg')!
  return {
    path: head.path,
    bytes: head.bytes,
    sha256: String(classOfPath('content', head.path)!.fields.sha256),
  }
}
const rangeLine = (seq: number, target: RangeTarget) => {
  const r = okRange(target) as Extract<RangeAnswer, { kind: 'ok' }>
  return `publish: range check ok seq=${seq} bytes=${r.start}-${r.end}/${r.size} object=${sha12(target.sha256)}`
}
const noRollback = (seq: number, id = ID) =>
  `publish: do not use Vercel Instant Rollback past the deployment of seq ${seq}: the previous deployment still serves ${id}`
const recovery = (id = ID, takedown = false) =>
  `publish: recovery: publish --unpublish ${id}${takedown ? ' --takedown' : ''} re-runs the remaining steps`

const audioDir = (dir: string) => join(dir, 'migration-input', 'audio')
function seedAudio(stories: readonly TestStory[], list = hashListOf(stories)): void {
  writeAudioTree(root, stories)
  mkdirSync(audioDir(root), { recursive: true })
  writeFileSync(join(audioDir(root), 'SHA256SUMS.txt'), list)
}

/** The story without its narration: no audio asset, no MP3 media (T15B-37 g6). */
async function withoutNarration(story: TestStory): Promise<TestStory> {
  const pkg = {
    ...story.pkg,
    assets: story.pkg.assets.filter((asset) => asset.kind !== 'audio'),
  } as StoryPackageV1
  const bound = await withPackage(story, pkg)
  return { ...bound, media: story.media.filter((m) => m.mime !== 'audio/mpeg') }
}

/** stdout, stderr and both reports of a run (§14.1 "Secrets and privacy"). */
const channels = (r: Ran) => [...r.out, ...r.err, JSON.stringify(r.report), r.md].join('\n')
/**
 * Every case and separator form of a temp root, each also as JSON text writes it: `channels` holds
 * `JSON.stringify(r.report)`, which doubles every backslash of a win32 path (S15B-R1 F1, as
 * takedown.test.ts's B15B-mut-3).
 */
const rootForms = (dir: string) => {
  const forms = [
    dir,
    dir.toUpperCase(),
    dir.toLowerCase(),
    dir.replaceAll('\\', '/'),
    dir.replaceAll('/', '\\'),
  ]
  return [...forms, ...forms.map((form) => JSON.stringify(form).slice(1, -1))]
}

describe('publish --unpublish', () => {
  it(
    "T15B-32 unpublish in production and staging: N+1 without the story, production then staging with D15B-3's expected, one hook, verify N+1 with the story absent, the Range check on N+1's first MP3; outcome unpublished (A3, A7, D15B-2, D15B-3, CRIT-16a)",
    TIMEOUT,
    async () => {
      const river = await storyOf(RIVER)
      const stub = await seed()
      const two2 = pointed(stub, 'production')!.snapshot.stories.find((e) => e.storyId === RIVER)!
      const r = await unpublish(stub, [ID])
      // The run must reach the tail; its exit 0 is g6's outcome claim, so a mutant that ends it at
      // exit 4 (MU15B-196) still reaches g3 (B15B-implC-6).
      expect(r.calls.includes('hook'), 'precondition: the run reached the tail').toBe(true)
      expect
        .soft(classes(stub), '(g1) the request classes in order')
        .toEqual([
          ...STATE_READS,
          'package',
          'packages-list',
          'media-list',
          ...COMMIT,
          ...STAGING_MOVE,
        ])
      const production = pointed(stub, 'production')
      const staging = pointed(stub, 'staging')
      expect
        .soft(
          [production?.seq, staging?.seq, production?.bytes === staging?.bytes],
          '(g2) production and staging name seq 3 with equal bytes',
        )
        .toEqual([3, 3, true])
      const three = snapshotAt(stub, 3)
      expect
        .soft(
          decode(jcsBytes(three.stories)),
          "(g2) snapshot 3's stories are [river], JCS-equal to snapshot 2's",
        )
        .toBe(decode(jcsBytes([two2])))
      expect.soft(three.note, '(g2) the note').toBe(`publisher unpublish: ${ID}`)
      const posts = objectPosts(stub).map((p) => p.pathname)
      expect
        .soft(
          [
            posts.indexOf(PRODUCTION_WRITE) < posts.indexOf(STAGING_WRITE),
            r.out.some((l) => l.includes('staging-not-moved')),
          ],
          '(g3) the staging POST after the production POST, and no staging-not-moved',
        )
        .toEqual([true, false])
      const target = firstMp3([river])
      expect
        .soft(
          [r.calls, r.targets],
          "(g4) the calls, and the range target river's first MP3 at index 2",
        )
        .toEqual([['hook', `verify 3 ${ID}`, 'range'], [{ target, index: 2 }]])
      const snapshotSha =
        (r.report?.publish as { snapshotSha256?: string } | undefined)?.snapshotSha256 ?? ''
      expect
        .soft(r.out, '(g5) stdout exactly')
        .toEqual([
          `publish: unpublish ${ID} production=remove staging=remove`,
          'publish: plan kind=unpublish seq=3 stories=1 production=2 staging=1 featured=none from=none',
          `publish: snapshot seq=3 sha256=${sha12(snapshotSha)} created`,
          'publish: production pointer seq=3 moved (read back, post-check clean)',
          'publish: staging pointer seq=3 moved (read back, post-check clean)',
          'publish: live seq=3',
          noRollback(3),
          rangeLine(3, target),
        ])
      const section = r.report?.publish as Record<string, unknown> | undefined
      expect
        .soft(
          [
            section?.kind,
            section?.from,
            r.report?.unpublish,
            r.report?.takedown,
            r.report?.checks,
            r.report?.outcome,
          ],
          '(g6) the report',
        )
        .toEqual([
          'unpublish',
          null,
          {
            storyId: ID,
            inProduction: true,
            inStaging: true,
            productionMove: 'moved',
            stagingMove: 'moved',
          },
          null,
          { range: 'ok', rollbackFlag: 'none' },
          'unpublished',
        ])
      expectUnpublishSafe(stub, { seq: 3, moves: 'both', storyId: ID, takedown: false })
    },
  )

  it(
    'T15B-33 the states: production only, no staging pointer, staging only (moves staging), neither with objects (no write), neither without objects (story unknown), featured cleared or kept, the last story, no production (A3, D15B-2, CRIT-7, CRIT-8, TP-10)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      // g1: P and not S.
      const onlyP = await seed()
      const stagedRiver = pointed(onlyP, 'staging')!.snapshot.stories.find(
        (e) => e.storyId === RIVER,
      )!
      await putDocuments(onlyP, 'staging', 3, [stagedRiver])
      const r1 = await unpublish(onlyP, [ID])
      expect
        .soft(
          [
            r1.exit,
            pointed(onlyP, 'production')?.seq,
            pointed(onlyP, 'staging')?.seq,
            pointed(onlyP, 'staging')?.bytes === pointed(onlyP, 'production')?.bytes,
          ],
          "(g1) P∧¬S: both pointers name N+1, staging's candidates dropped",
        )
        .toEqual([0, 4, 4, true])
      expectUnpublishSafe(onlyP, { seq: 4, moves: 'both', storyId: ID, takedown: false })

      // g2: no staging pointer (reads as not found until our staging write lands).
      const noStaging = await seed()
      const deleted = new Set(['catalogue/staging.json'])
      const r2 = await unpublish(noStaging, [ID], {
        deleted,
        after: (url, init) => {
          if (isPost(init, url, STAGING_WRITE)) deleted.delete('catalogue/staging.json')
        },
      })
      expect
        .soft(
          [
            r2.exit,
            pointed(noStaging, 'staging')?.seq,
            pointed(noStaging, 'staging')?.bytes === pointed(noStaging, 'production')?.bytes,
          ],
          '(g2) no staging pointer: one is created and equals N+1',
        )
        .toEqual([0, 3, true])
      expectUnpublishSafe(noStaging, { seq: 3, moves: 'both', storyId: ID, takedown: false })

      // g3: not P, S.
      const onlyS = await prepared([two, river], undefined, [[RIVER]])
      const productionBefore = pointed(onlyS, 'production')!
      const r3 = await unpublish(onlyS, [ID])
      expect
        .soft(
          [
            objectPosts(onlyS).filter((p) => p.pathname.includes('/catalogue/snapshots/')).length,
            objectPosts(onlyS).filter((p) => p.pathname === STAGING_WRITE).length,
            objectPosts(onlyS).filter((p) => p.pathname === PRODUCTION_WRITE).length,
            pointed(onlyS, 'production')?.bytes === productionBefore.bytes,
            r3.calls,
            r3.report?.outcome,
          ],
          '(g3) ¬P∧S: one snapshot POST, one staging POST, no production POST, production unchanged',
        )
        .toEqual([
          1,
          1,
          0,
          true,
          ['hook', `verify ${productionBefore.seq} ${ID}`, 'range'],
          'unpublished',
        ])
      expectUnpublishSafe(onlyS, { seq: 3, moves: 'staging', storyId: ID, takedown: false })

      // g4: neither, after a full unpublish (the objects are still stored).
      const neither = await seed()
      expect((await unpublish(neither, [ID])).exit, 'precondition: the first unpublish').toBe(0)
      const r4 = await unpublish(neither, [ID])
      expect
        .soft(
          [objectPosts(neither).length, r4.out.slice(0, 2), r4.calls, r4.report?.outcome],
          '(g4) neither: no POST, the absent lines, the tail, rebuilt',
        )
        .toEqual([
          0,
          [
            `publish: unpublish ${ID} production=absent staging=absent`,
            'publish: plan kind=unpublish seq=none stories=1 production=3 staging=3 featured=none from=none',
          ],
          ['hook', `verify 3 ${ID}`, 'range'],
          'rebuilt',
        ])
      expectUnpublishSafe(neither, { seq: null, moves: 'none', storyId: ID, takedown: false })

      // g5: a story nothing names.
      const r5 = await unpublish(neither, ['no-such-story'])
      expect
        .soft(
          [r5.exit, r5.out.slice(-2), r5.calls, objectPosts(neither).length],
          '(g5) unpublish-story-unknown',
        )
        .toEqual([
          1,
          [
            'publish: unpublish no-such-story: no pointer, package or media object names it',
            'publish: stopped: unpublish-story-unknown no-such-story',
          ],
          [],
          0,
        ])
      expectUnpublishSafe(neither, {
        seq: null,
        moves: 'none',
        storyId: 'no-such-story',
        takedown: false,
      })

      // g6: featured cleared or kept (fully bound stories).
      const twoB = await fullyBoundStory(two)
      const riverB = await fullyBoundStory(river)
      for (const [featured, wantFeature, wantLine] of [
        [ID, null, true],
        [RIVER, RIVER, false],
      ] as const) {
        const stub = await prepared([twoB, riverB], undefined, [[ID, RIVER]])
        expect((await publish(stub, ['--feature', featured])).exit, 'precondition: --feature').toBe(
          0,
        )
        const r = await unpublish(stub, [ID])
        const planAt = r.out.findIndex((l) => l.startsWith('publish: plan '))
        expect
          .soft(
            [
              r.exit,
              pointed(stub, 'production')?.snapshot.featuredStoryId,
              r.out.includes('publish: feature none state=cleared'),
              wantLine ? r.out.indexOf('publish: feature none state=cleared') === planAt - 1 : true,
            ],
            `(g6) production featuring ${featured}`,
          )
          .toEqual([0, wantFeature, wantLine, true])
        expect
          .soft(
            r.out.some((l) => l.startsWith('publish: feature ') && !wantLine),
            `(g6) no feature line when kept: ${featured}`,
          )
          .toBe(false)
        expectUnpublishSafe(stub, { seq: 4, moves: 'both', storyId: ID, takedown: false })
      }

      // g7: the last story; no production.
      const last = await prepared([two], undefined, [[ID]])
      const r7 = await unpublish(last, [ID])
      expect
        .soft([r7.exit, r7.out.at(-1), objectPosts(last).length], '(g7) a one-story production')
        .toEqual([1, `publish: stopped: unpublish-last-story ${ID}`, 0])
      expectUnpublishSafe(last, { seq: null, moves: 'none', storyId: ID, takedown: false })
      // ¬P∧S over a hand-made zero-story production: N+1 would be empty (D15B-2, S15B-R1-FID-1).
      const emptyProduction = await prepared([two])
      await putDocuments(emptyProduction, 'production', 2, [])
      const r9 = await unpublish(emptyProduction, [ID])
      expect
        .soft(
          [r9.exit, r9.out.at(-1), objectPosts(emptyProduction).length, r9.calls],
          '(g7) staging only over an empty production',
        )
        .toEqual([1, `publish: stopped: unpublish-last-story ${ID}`, 0, []])
      expectUnpublishSafe(emptyProduction, {
        seq: null,
        moves: 'none',
        storyId: ID,
        takedown: false,
      })
      const none = await prepared([two])
      const r8 = await unpublish(none, [ID])
      expect
        .soft(
          [r8.exit, r8.out.at(-1), objectPosts(none).length, r8.calls],
          '(g7) no production pointer',
        )
        .toEqual([1, 'publish: stopped: production-missing', 0, []])
      expectUnpublishSafe(none, { seq: null, moves: 'none', storyId: ID, takedown: false })
    },
  )

  it(
    "T15B-34 carried checks run on N+1's entries before any write: a missing package or variant of a remaining story stops the run; the unpublished story's own package is not needed (A5, L4)",
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      // Each sample runs on its own seed and its TP-14 check runs at the end, so one sample's
      // planted fault never hides the next (B15B-implC-16).
      const safe: [LogLike, Safe][] = []
      const refused: Safe = { seq: null, moves: 'none', storyId: ID, takedown: false }
      seedAudio([two, river])
      const s1 = await seed()
      const r1 = await unpublish(s1, [ID], { deleted: new Set([packagePathOf(river)]) })
      expect
        .soft(
          [r1.exit, r1.out.at(-1), objectPosts(s1).length, r1.calls],
          "(g1) river's package deleted",
        )
        .toEqual([1, `publish: stopped: carried-package-missing ${RIVER}`, 0, []])
      safe.push([logOf(s1), refused])
      const s1t = await seed()
      const r1t = await unpublish(s1t, [ID, '--takedown'], {
        deleted: new Set([packagePathOf(river)]),
      })
      const ownLists = since(s1t).filter(
        (q) => q.pathname === LIST_PATH && decode(q.body).includes(`"prefix":"packages/${ID}"`),
      )
      expect
        .soft(
          [r1t.exit, r1t.out.at(-1), ownLists.length],
          '(g1) with --takedown: no two-paths listing sent',
        )
        .toEqual([1, `publish: stopped: carried-package-missing ${RIVER}`, 0])
      safe.push([logOf(s1t), { ...refused, takedown: true }])
      const s2 = await seed()
      const r2 = await unpublish(s2, [ID], { deleted: new Set([river.media[0]!.path]) })
      expect
        .soft([r2.exit, r2.out.at(-1), objectPosts(s2).length], '(g2) one river variant deleted')
        .toEqual([1, `publish: stopped: object-missing ${RIVER}`, 0])
      safe.push([logOf(s2), refused])
      const s3 = await seed()
      const r3 = await unpublish(s3, [ID], { deleted: new Set([packagePathOf(two)]) })
      expect
        .soft([r3.exit, r3.report?.outcome], "(g3) two-paths' own package deleted: unpublished")
        .toEqual([0, 'unpublished'])
      safe.push([logOf(s3), { seq: 3, moves: 'both', storyId: ID, takedown: false }])
      for (const [log, rule] of safe) expectUnpublishSafe(log, rule)
    },
  )

  it(
    'T15B-35 production move failures stop with no staging move and no tail; a production pointer-raced after our bytes were read back continues to the staging move and the tail (A4, D15B-4, CRIT-5, TP-9)',
    TIMEOUT,
    async () => {
      const samples: [string, (stub: StorageStub) => RunOptions, number, boolean][] = [
        [
          'pointer-not-moved',
          (stub) => {
            stub.override('POST', PRODUCTION_WRITE, {
              kind: 'answer',
              status: 400,
              body: '{"statusCode":"400"}',
            })
            return {}
          },
          4,
          true,
        ],
        [
          'pointer-superseded',
          (stub) => ({
            after: async (url, init) => {
              if (isPost(init, url, PRODUCTION_WRITE)) {
                const entries = pointed(stub, 'staging')!.snapshot.stories.map((e) => ({
                  ...e,
                  approvalSha256: 'e'.repeat(64),
                }))
                stub.put(
                  'content',
                  'catalogue/production.json',
                  await pointerBytes('production', 5, entries),
                  'application/json',
                )
              }
            },
          }),
          4,
          true,
        ],
        [
          'pointer-unconfirmed',
          () => ({
            before: (url, init) => {
              if (isPost(init, url, PRODUCTION_WRITE))
                throw new TypeError('the production POST lost')
            },
          }),
          4,
          true,
        ],
        [
          'concurrent-writer',
          (stub) => ({
            after: (url, init) => {
              if ((init.method ?? 'GET') === 'GET' && url.pathname === snapshotRead(3)) {
                stub.put('content', 'catalogue/snapshots/5.json', encode('{}'), 'application/json')
              }
            },
          }),
          3,
          false,
        ],
      ]
      for (const [code, make, exit, withRecovery] of samples) {
        const stub = await seed()
        const r = await unpublish(stub, [ID], make(stub))
        const stagingPosts = objectPosts(stub).filter((p) => p.pathname === STAGING_WRITE).length
        expect
          .soft(
            [r.exit, stagingPosts, r.calls, r.out.at(-1)],
            `(g1) ${code}: the stop, no staging POST, no tail`,
          )
          .toEqual([exit, 0, [], withRecovery ? recovery() : `publish: stopped: ${code}`])
        expect
          .soft(r.out.includes(`publish: stopped: ${code}`), `(g1) ${code}: the stop line`)
          .toBe(true)
        expectUnpublishSafe(stub, { seq: 3, moves: 'both', storyId: ID, takedown: false })
      }
      const raced = await seed()
      const r = await unpublish(raced, [ID], {
        after: (url, init) => {
          if (isPost(init, url, PRODUCTION_WRITE)) {
            raced.put('content', 'catalogue/snapshots/5.json', encode('{}'), 'application/json')
          }
        },
      })
      const live = r.out.indexOf('publish: live seq=3')
      expect
        .soft(
          [
            r.out.includes('publish: staging pointer not moved: concurrent-writer'),
            r.calls,
            r.out[live + 1],
            r.out.slice(-2),
            r.exit,
            (r.report?.unpublish as { productionMove?: string } | undefined)?.productionMove,
            (r.report?.unpublish as { stagingMove?: string } | undefined)?.stagingMove,
          ],
          '(g2) pointer-raced continues: the staging line, the tail, the no-rollback line, the end',
        )
        .toEqual([
          true,
          ['hook', `verify 3 ${ID}`, 'range'],
          noRollback(3),
          ['publish: stopped: pointer-raced re-run publish', recovery()],
          4,
          'moved',
          'failed',
        ])
      expectUnpublishSafe(raced, { seq: 3, moves: 'both', storyId: ID, takedown: false })
    },
  )

  it(
    'T15B-36 a staging failure after production moved is deferred: the tail runs, takedown refuses while staging names the story, the run ends staging-not-moved; in the staging-only state it stops; recovery precedence with a Range failure; the re-run converges (A4, L3, CRIT-14, TP-9)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      // Each run's TP-14 check runs at the end, so one group's planted fault never hides the next
      // group (B15B-implC-16).
      const safe: [LogLike, Safe][] = []
      const codes: [string, (stub: StorageStub) => RunOptions][] = [
        [
          'concurrent-writer',
          (stub) => {
            let posted = false
            let done = false
            return {
              after: (url, init) => {
                if (isPost(init, url, PRODUCTION_WRITE)) posted = true
                const stagingRead =
                  (init.method ?? 'GET') === 'GET' &&
                  url.pathname.endsWith('/catalogue/staging.json')
                if (posted && !done && stagingRead) {
                  done = true
                  stub.put(
                    'content',
                    'catalogue/snapshots/5.json',
                    encode('{}'),
                    'application/json',
                  )
                }
              },
            }
          },
        ],
        [
          'storage-unauthorized',
          (stub) => {
            stub.override('POST', STAGING_WRITE, {
              kind: 'answer',
              status: 401,
              body: '{"statusCode":"401"}',
            })
            return {}
          },
        ],
        [
          'pointer-not-moved',
          (stub) => {
            stub.override('POST', STAGING_WRITE, {
              kind: 'answer',
              status: 400,
              body: '{"statusCode":"400"}',
            })
            return {}
          },
        ],
        [
          'pointer-unconfirmed',
          () => ({
            before: (url, init) => {
              if (isPost(init, url, STAGING_WRITE)) throw new TypeError('the staging POST lost')
            },
          }),
        ],
        [
          'pointer-superseded',
          (stub) => ({
            after: async (url, init) => {
              if (isPost(init, url, STAGING_WRITE)) {
                const entries = pointed(stub, 'production')!.snapshot.stories
                stub.put(
                  'content',
                  'catalogue/staging.json',
                  await pointerBytes('staging', 5, entries),
                  'application/json',
                )
              }
            },
          }),
        ],
        [
          'pointer-raced',
          (stub) => ({
            after: (url, init) => {
              if (isPost(init, url, STAGING_WRITE)) {
                const bytes = stub.object('content', 'catalogue/production.json')!.bytes
                stub.put(
                  'content',
                  'catalogue/production.json',
                  encode(`${decode(bytes)} `),
                  'application/json',
                )
              }
            },
          }),
        ],
        [
          'storage-failed',
          () => {
            let posted = false
            let lists = 0
            return {
              before: (url, init) => {
                if (isPost(init, url, PRODUCTION_WRITE)) posted = true
                // The root listing of catalogue/ (its snapshots/ folder is listed after it).
                const root =
                  isPost(init, url, LIST_PATH) &&
                  (JSON.parse(String(init.body)) as { prefix: string }).prefix === 'catalogue'
                if (posted && root) {
                  lists += 1
                  if (lists === 2) {
                    return new Response('{"statusCode":"500"}', {
                      status: 500,
                      headers: { 'content-type': 'application/json' },
                    })
                  }
                }
              },
            }
          },
        ],
      ]
      let notMoved: StorageStub | null = null
      for (const [code, make] of codes) {
        const stub = await seed()
        const r = await unpublish(stub, [ID], make(stub))
        expect
          .soft(
            [
              r.out.includes(`publish: staging pointer not moved: ${code}`),
              r.calls,
              r.exit,
              r.out.slice(-2),
              (r.report?.unpublish as { stagingMove?: string } | undefined)?.stagingMove,
            ],
            `(g1) ${code}: deferred, the tail ran, staging-not-moved`,
          )
          .toEqual([
            true,
            ['hook', `verify 3 ${ID}`, 'range'],
            4,
            [`publish: stopped: staging-not-moved ${ID}`, recovery()],
            'failed',
          ])
        safe.push([logOf(stub), { seq: 3, moves: 'both', storyId: ID, takedown: false }])
        if (code === 'pointer-not-moved') notMoved = stub
      }

      // g2: the same with --takedown.
      const withTakedown = await seed()
      seedAudio([two, river])
      withTakedown.override('POST', STAGING_WRITE, {
        kind: 'answer',
        status: 400,
        body: '{"statusCode":"400"}',
      })
      const g2 = await unpublish(withTakedown, [ID, '--takedown'])
      expect
        .soft(
          [g2.exit, g2.out.slice(-2), deletesOf(since(withTakedown)).length],
          '(g2) --takedown: takedown-still-named, zero DELETEs, the --takedown recovery line',
        )
        .toEqual([4, [`publish: stopped: takedown-still-named ${ID}`, recovery(ID, true)], 0])
      safe.push([logOf(withTakedown), { seq: 3, moves: 'both', storyId: ID, takedown: true }])

      // g3: the staging-only state stops.
      const onlyS = await prepared([two, river], undefined, [[RIVER]])
      onlyS.override('POST', STAGING_WRITE, {
        kind: 'answer',
        status: 400,
        body: '{"statusCode":"400"}',
      })
      const g3 = await unpublish(onlyS, [ID])
      expect
        .soft(
          [g3.exit, g3.out.includes('publish: stopped: pointer-not-moved'), g3.calls],
          '(g3) ¬P∧S: pointer-not-moved, no tail',
        )
        .toEqual([4, true, []])
      safe.push([logOf(onlyS), { seq: 3, moves: 'staging', storyId: ID, takedown: false }])

      // g4: a staging failure and a Range failure.
      const both = await seed()
      both.override('POST', STAGING_WRITE, {
        kind: 'answer',
        status: 400,
        body: '{"statusCode":"400"}',
      })
      const g4 = await unpublish(both, [ID], {
        range: () => ({ kind: 'failed', reason: 'status', status: 404 }),
      })
      expect
        .soft(
          g4.out.slice(-3),
          '(g4) the range stop, the unpublish recovery line, then RANGE_RECOVERY',
        )
        .toEqual(['publish: stopped: range-check-failed', recovery(), RANGE_RECOVERY])
      safe.push([logOf(both), { seq: 3, moves: 'both', storyId: ID, takedown: false }])

      // g5: the re-run after g1's pointer-not-moved.
      expect(notMoved, 'precondition: g1 ran pointer-not-moved').not.toBeNull()
      if (notMoved !== null) {
        const g5 = await unpublish(notMoved, [ID])
        const four = snapshotAt(notMoved, 4)
        expect
          .soft(
            [
              decode(jcsBytes(four.stories)) === decode(jcsBytes(snapshotAt(notMoved, 3).stories)),
              objectPosts(notMoved).filter((p) => p.pathname === STAGING_WRITE).length,
              objectPosts(notMoved).filter((p) => p.pathname === PRODUCTION_WRITE).length,
              g5.calls.filter((c) => c === 'hook').length,
              g5.report?.outcome,
              pointed(notMoved, 'staging')?.seq,
            ],
            "(g5) the re-run: N+2 = production's content, one staging POST, no production POST, one hook",
          )
          .toEqual([true, 1, 0, 1, 'unpublished', 4])
        safe.push([logOf(notMoved), { seq: 4, moves: 'staging', storyId: ID, takedown: false }])
      }
      for (const [log, rule] of safe) expectUnpublishSafe(log, rule)
    },
  )

  it(
    'T15B-37 the tail per stop: hook-failed stops verify, takedown and range; verify-timeout stops takedown and range; a takedown stop stops range; a Range failure is exit 4 with RANGE_RECOVERY; a throw in takedown is internal with no recovery line; no MP3 gives the skip line (A7, D15B-7, D15B-17, TP-9)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const s1 = await seed()
      const g1 = await unpublish(s1, [ID], { hook: 'failed' })
      expect
        .soft([g1.calls, g1.out.slice(-2), g1.exit], '(g1) hook failed')
        .toEqual([['hook'], ['publish: stopped: hook-failed', recovery()], 4])
      expectUnpublishSafe(s1, { seq: 3, moves: 'both', storyId: ID, takedown: false })

      const s2 = await seed()
      seedAudio([two, river])
      const g2 = await unpublish(s2, [ID, '--takedown'], { verify: () => ({ kind: 'timeout' }) })
      expect
        .soft(
          [
            g2.out.slice(-3),
            deletesOf(since(s2)).length,
            g2.calls.includes('range'),
            (g2.report?.checks as { rollbackFlag?: string } | undefined)?.rollbackFlag,
          ],
          '(g2) verify timeout: the hint and the recovery line; no DELETE, no range; flag none',
        )
        .toEqual([
          ['publish: stopped: verify-timeout', VERIFY_TIMEOUT_HINT, recovery(ID, true)],
          0,
          false,
          'none',
        ])
      expectUnpublishSafe(s2, { seq: 3, moves: 'both', storyId: ID, takedown: true })

      const s3 = await seed()
      seedAudio([two, river])
      const late = `media/${ID}/${await sha256Hex(encode('late'))}-w9.webp`
      const g3 = await unpublish(s3, [ID, '--takedown'], {
        hook: async () => {
          s3.put('content', late, encode('late'), 'image/webp')
          return 'triggered'
        },
      })
      expect
        .soft(
          [g3.out.slice(-2), g3.calls],
          '(g3) a new object stored by the hook: takedown-raced, no range',
        )
        .toEqual([
          [`publish: stopped: takedown-raced ${ID}`, recovery(ID, true)],
          ['hook', `verify 3 ${ID}`],
        ])
      expectUnpublishSafe(s3, { seq: 3, moves: 'both', storyId: ID, takedown: true })

      const s4 = await seed()
      const g4 = await unpublish(s4, [ID], {
        range: () => ({ kind: 'failed', reason: 'content-range', status: 206 }),
      })
      const target = firstMp3([river])
      expect
        .soft(
          [g4.out.slice(-3), g4.exit, (g4.report?.checks as { range?: string } | undefined)?.range],
          '(g4) a Range failure: the failed line, the stop, RANGE_RECOVERY, exit 4',
        )
        .toEqual([
          [
            `publish: range check failed reason=content-range object=${sha12(target.sha256)}`,
            'publish: stopped: range-check-failed',
            RANGE_RECOVERY,
          ],
          4,
          'failed',
        ])
      expectUnpublishSafe(s4, { seq: 3, moves: 'both', storyId: ID, takedown: false })

      const s5 = await seed()
      seedAudio([two, river])
      const g5 = await unpublish(s5, [ID, '--takedown'], {
        makeRemover: () => {
          throw new TypeError('remover')
        },
      })
      expect
        .soft(
          [g5.out.at(-1), g5.exit, g5.calls.filter((c) => c === 'hook').length],
          '(g5) makeRemover throws: internal, no recovery line',
        )
        .toEqual(['publish: stopped: internal TypeError', 4, 1])
      expectUnpublishSafe(s5, { seq: 3, moves: 'both', storyId: ID, takedown: true })

      const quiet = await withoutNarration(river)
      const s6 = await newStub()
      keyOf.set(s6, FAKE_KEY)
      await stageIn(s6, [two, quiet])
      expect(pointed(s6, 'staging')?.seq, 'precondition: the MP3-less stage exits 0').toBe(1)
      await approveIn(s6, two)
      await approveIn(s6, quiet)
      expect((await publish(s6, [ID, RIVER])).exit, 'precondition: both published').toBe(0)
      const g6 = await unpublish(s6, [ID])
      expect
        .soft(
          [
            g6.out.at(-1),
            g6.targets.length,
            g6.exit,
            (g6.report?.checks as { range?: string } | undefined)?.range,
          ],
          '(g6) no MP3 in N+1: the skip line, range never called, exit 0',
        )
        .toEqual(['publish: range check skipped: no MP3 in seq 3', 0, 0, 'skipped'])
      expectUnpublishSafe(s6, { seq: 3, moves: 'both', storyId: ID, takedown: false })

      const s7 = await seed()
      const g7 = await unpublish(s7, [ID], { verify: () => ({ kind: 'timeout', lastSeq: 1 }) })
      expect
        .soft(
          [
            g7.out.at(-2),
            (g7.report?.checks as { rollbackFlag?: string } | undefined)?.rollbackFlag,
          ],
          '(g7) production moved 2 → 3, lastSeq 1: the older-than-before line',
        )
        .toEqual([
          "publish: live seq=1 is below seq=2, production's seq before this run: a Vercel Instant Rollback is the likely cause; Undo Rollback in Vercel, then re-run",
          'older-than-before',
        ])
      expectUnpublishSafe(s7, { seq: 3, moves: 'both', storyId: ID, takedown: false })
      const g7b = await unpublish(s7, [ID], { verify: () => ({ kind: 'timeout', lastSeq: 2 }) })
      expect
        .soft(
          [
            g7b.out.at(-2),
            (g7b.report?.checks as { rollbackFlag?: string } | undefined)?.rollbackFlag,
          ],
          '(g7) the neither state (expected 3), lastSeq 2: the older-live line',
        )
        .toEqual([
          'publish: live seq=2 is below seq=3: production serves an older deployment (a Vercel Instant Rollback stays in force until Undo Rollback; or a build failed or is still running)',
          'older-live',
        ])
      expectUnpublishSafe(s7, { seq: null, moves: 'none', storyId: ID, takedown: false })
    },
  )

  it(
    "T15B-38 unpublish --takedown end to end: the takedown plan in the plan phase, deletes only after verify, the story's folders empty, every other object intact; outcome taken-down (A11, D15B-11, L17, CRIT-16a)",
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await seed()
      seedAudio([two, river])
      const keep = [
        ...storyPaths(river),
        'catalogue/snapshots/1.json',
        'catalogue/snapshots/2.json',
      ]
      const before = new Map(
        keep.map((p) => [p, Buffer.from(stub.object('content', p)?.bytes ?? [])]),
      )
      const masterPaths = [
        `waivers/${ID}/${two.waiverSha256}.json`,
        `waivers/${RIVER}/${river.waiverSha256}.json`,
        `approvals/${ID}/${two.packageSha256}.json`,
        `approvals/${RIVER}/${river.packageSha256}.json`,
      ]
      const mastersBefore = masterPaths.map((p) =>
        Buffer.from(stub.object('masters', p)?.bytes ?? []),
      )
      let deletesAtVerify = -1
      let requestsAtVerify = -1
      let pointersAtVerify: Buffer[] = []
      const r = await unpublish(stub, [ID, '--takedown'], {
        verify: (seq) => {
          deletesAtVerify = deletesOf(stub.requests).length
          requestsAtVerify = stub.requests.length
          pointersAtVerify = ['production', 'staging'].map((m) =>
            Buffer.from(stub.object('content', `catalogue/${m}.json`)!.bytes),
          )
          return { kind: 'live', seq }
        },
      })
      // The run must reach verify; its exit 0 is g4's outcome claim, so a mutant that ends it at
      // exit 4 (MU15B-232) still reaches g2 (B15B-implC-6).
      expect(deletesAtVerify, 'precondition: the run reached verify').toBeGreaterThanOrEqual(0)
      const planLine = r.out.findIndex((l) => l.startsWith(`publish: takedown ${ID} plan `))
      const snapshotLine = r.out.findIndex((l) => l.startsWith('publish: snapshot '))
      const firstDelete = stub.requests.findIndex((q) => q.method === 'DELETE')
      expect
        .soft(
          [
            planLine >= 0 && planLine < snapshotLine,
            deletesAtVerify,
            firstDelete > requestsAtVerify,
          ],
          '(g1) the plan line before the snapshot line; no DELETE at verify; the first DELETE after it',
        )
        .toEqual([true, 0, true])
      const c = client(stub)
      const lists = await Promise.all([
        c.listContent(`packages/${ID}/`),
        c.listContent(`media/${ID}/`),
      ])
      expect
        .soft(
          lists.map((l) => (l.kind === 'listed' ? l.objects.length : -1)),
          "(g2) two-paths' folders list empty",
        )
        .toEqual([0, 0])
      expect
        .soft(
          keep.filter(
            (p) => !Buffer.from(stub.object('content', p)?.bytes ?? []).equals(before.get(p)!),
          ),
          "(g2) river's objects and snapshots 1-2 byte-identical",
        )
        .toEqual([])
      expect
        .soft(
          masterPaths.filter(
            (p, i) =>
              !Buffer.from(stub.object('masters', p)?.bytes ?? []).equals(mastersBefore[i]!),
          ),
          '(g2) every masters object byte-identical',
        )
        .toEqual([])
      expect
        .soft(
          ['production', 'staging'].every((m, i) =>
            Buffer.from(stub.object('content', `catalogue/${m}.json`)!.bytes).equals(
              pointersAtVerify[i]!,
            ),
          ) && stub.object('content', 'catalogue/snapshots/3.json') !== undefined,
          '(g2) both pointers and snapshot 3 byte-identical since verify',
        )
        .toBe(true)
      const snapshotSha =
        (r.report?.publish as { snapshotSha256?: string } | undefined)?.snapshotSha256 ?? ''
      expect
        .soft(r.out, '(g3) stdout exactly')
        .toEqual([
          `publish: unpublish ${ID} production=remove staging=remove`,
          'publish: plan kind=unpublish seq=3 stories=1 production=2 staging=1 featured=none from=none',
          `publish: takedown ${ID} plan packages=1 media=3 mp3=1 mp3-unproven=0 images=2 (hash list checked)`,
          `publish: snapshot seq=3 sha256=${sha12(snapshotSha)} created`,
          'publish: production pointer seq=3 moved (read back, post-check clean)',
          'publish: staging pointer seq=3 moved (read back, post-check clean)',
          'publish: live seq=3',
          noRollback(3),
          `publish: takedown ${ID} removed 4/4`,
          `publish: takedown ${ID} done removed=4 (re-list empty)`,
          TAKEDOWN_LAG_NOTE,
          rangeLine(3, firstMp3([river])),
        ])
      expect.soft([r.report?.takedown, r.report?.outcome], '(g4) the report').toEqual([
        {
          storyId: ID,
          packages: 1,
          media: 3,
          mp3: 1,
          mp3Unproven: 0,
          images: 2,
          removed: 4,
          kept: 0,
          state: 'removed',
        },
        'taken-down',
      ])
      const dels = deletesOf(since(stub))
      expect
        .soft(
          [
            dels.length,
            dels[0]
              ? sorted((JSON.parse(decode(dels[0].body)) as { prefixes: string[] }).prefixes)
              : [],
          ],
          '(g5) exactly one DELETE naming the four planned paths',
        )
        .toEqual([1, sorted(storyPaths(two))])
      expectDeletesConfined(stub, ID, storyPaths(two))
      expectUnpublishSafe(stub, { seq: 3, moves: 'both', storyId: ID, takedown: true })

      // g6: a rollback to snapshot 2 after the takedown is refused before any write.
      const pointersBefore = ['production', 'staging'].map((m) =>
        Buffer.from(stub.object('content', `catalogue/${m}.json`)!.bytes),
      )
      const back = await publish(stub, ['--snapshot', '2'])
      expect
        .soft(
          [
            back.exit,
            back.out.at(-1),
            objectPosts(stub).length,
            back.calls,
            ['production', 'staging'].every((m, i) =>
              Buffer.from(stub.object('content', `catalogue/${m}.json`)!.bytes).equals(
                pointersBefore[i]!,
              ),
            ),
          ],
          '(g6) publish --snapshot 2: object-missing two-paths, no POST, no tail, pointers unchanged',
        )
        .toEqual([1, `publish: stopped: object-missing ${ID}`, 0, [], true])
      expectUnpublishSafe(stub, { seq: null, moves: 'none', storyId: ID, takedown: false })
    },
  )

  it(
    'T15B-39 a later takedown and the re-runs: the neither state with --takedown deletes after the tail; a re-run after takedown-incomplete removes what is left; an all-kept re-run builds no deleter; a re-run after a full takedown is story-unknown (A12, D15B-8, D15B-12, TP-7)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await seed()
      seedAudio([two, river])
      expect((await unpublish(stub, [ID])).exit, 'precondition: the withdrawal').toBe(0)
      const g1 = await unpublish(stub, [ID, '--takedown'])
      expect
        .soft(
          [
            objectPosts(stub).length,
            g1.calls,
            storyPaths(two).filter((p) => stub.object('content', p) !== undefined),
            g1.report?.outcome,
            g1.out.includes(noRollback(3)),
          ],
          '(g1) the neither state with --takedown: no POST, the tail, every object removed, taken-down',
        )
        .toEqual([0, ['hook', `verify 3 ${ID}`, 'range'], [], 'taken-down', true])
      expectUnpublishSafe(stub, { seq: null, moves: 'none', storyId: ID, takedown: true })

      const s2 = await seed()
      seedAudio([two, river])
      const keptPath = sorted(storyPaths(two))[0]!
      s2.override('DELETE', DELETE_PATH, { kind: 'keep', paths: [keptPath] })
      const first = await unpublish(s2, [ID, '--takedown'])
      // A claim of g2, not a hard precondition, so a commit fault that changes both runs
      // (MU15B-237) still reaches the re-run's claim (B15B-implC-16).
      expect
        .soft(first.out.at(-2), '(g2) the first takedown ends takedown-incomplete')
        .toBe(`publish: stopped: takedown-incomplete ${ID}`)
      const again = await unpublish(s2, [ID, '--takedown'])
      const dels = deletesOf(since(s2))
      expect
        .soft(
          [
            again.report?.outcome,
            dels.map((d) => (JSON.parse(decode(d.body)) as { prefixes: string[] }).prefixes),
          ],
          '(g2) the re-run removes exactly the left path',
        )
        .toEqual(['taken-down', [[keptPath]]])
      expectUnpublishSafe(s2, { seq: null, moves: 'none', storyId: ID, takedown: true })

      const s3 = await seed()
      const mp3 = two.media.find((m) => m.mime === 'audio/mpeg')!
      const full = hashListOf([two, river])
      const withoutLine = full
        .split('\n')
        .filter((row) => !row.startsWith(mp3.sha256))
        .join('\n')
      seedAudio([two, river], withoutLine)
      const kept = await unpublish(s3, [ID, '--takedown'])
      expect
        .soft(
          [
            kept.out.slice(-3)[0],
            s3.object('content', mp3.path) !== undefined,
            storyPaths(two).filter((p) => p !== mp3.path && s3.object('content', p) !== undefined),
          ],
          '(g3) without the line: package and images removed, the MP3 kept, takedown-mp3-kept',
        )
        .toEqual([`publish: stopped: takedown-mp3-kept ${ID}`, true, []])
      const rerun = await unpublish(s3, [ID, '--takedown'])
      expect
        .soft(
          [deletesOf(since(s3)).length, rerun.removers, rerun.out.slice(-3)[0]],
          '(g3) its re-run: no DELETE, no makeRemover, takedown-mp3-kept again',
        )
        .toEqual([0, 0, `publish: stopped: takedown-mp3-kept ${ID}`])
      seedAudio([two, river], full)
      const restored = await unpublish(s3, [ID, '--takedown'])
      expect
        .soft(
          [restored.report?.outcome, s3.object('content', mp3.path) === undefined],
          '(g3) the line restored: the MP3 deleted, taken-down',
        )
        .toEqual(['taken-down', true])
      expectUnpublishSafe(s3, { seq: null, moves: 'none', storyId: ID, takedown: true })

      const g4 = await unpublish(stub, [ID, '--takedown'])
      expect
        .soft(
          [g4.exit, g4.out.at(-1), g4.calls],
          '(g4) a re-run after a full takedown: unpublish-story-unknown',
        )
        .toEqual([1, `publish: stopped: unpublish-story-unknown ${ID}`, []])
      expectUnpublishSafe(stub, { seq: null, moves: 'none', storyId: ID, takedown: true })
    },
  )

  it(
    'T15B-40 an unproven MP3 is kept through runPublish: packages and images deleted, the MP3 stored, exit 4 takedown-mp3-kept with the owner line; the dry run shows the count (A9, CRIT-6, TP-6, TP-9)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await seed()
      seedAudio([two, river])
      const orphanBytes = mp3Bytes('orphan-narration')
      const orphan = `media/${ID}/${await sha256Hex(orphanBytes)}-en.mp3`
      stub.put('content', orphan, orphanBytes, 'audio/mpeg')
      const dry = await unpublish(stub, [ID, '--takedown', '--dry-run'])
      expect
        .soft(
          [dry.out.at(-1), dry.exit, deletesOf(since(stub)).length],
          '(g4) the dry run: mp3-unproven=1, exit 0, no DELETE',
        )
        .toEqual([
          `publish: takedown ${ID} plan packages=1 media=4 mp3=2 mp3-unproven=1 images=2 (hash list checked)`,
          0,
          0,
        ])
      expectUnpublishSafe(stub, { seq: null, moves: 'none', storyId: ID, takedown: true })
      const r = await unpublish(stub, [ID, '--takedown'])
      expect
        .soft(
          [
            storyPaths(two).filter((p) => stub.object('content', p) !== undefined),
            stub.object('content', orphan) !== undefined,
          ],
          '(g1) the package, the images and the proven MP3 gone; the orphan MP3 stored',
        )
        .toEqual([[], true])
      const live = r.out.indexOf('publish: live seq=3')
      expect
        .soft(
          [r.out[live + 1], r.out.slice(-6), r.exit],
          '(g2) the no-rollback line after live; the end of stdout; exit 4',
        )
        .toEqual([
          noRollback(3),
          [
            `publish: takedown ${ID} done removed=4 kept=1 (re-list shows only the kept MP3s)`,
            TAKEDOWN_LAG_NOTE,
            rangeLine(3, firstMp3([river])),
            `publish: stopped: takedown-mp3-kept ${ID}`,
            `publish: takedown ${ID}: 1 MP3 object(s) kept: restore each file under migration-input/audio/${ID}/ and its line in SHA256SUMS.txt, then re-run; or back the object up and remove it by hand`,
            recovery(ID, true),
          ],
          4,
        ])
      const section = r.report?.takedown as
        { mp3Unproven?: number; kept?: number; state?: string } | undefined
      expect
        .soft([section?.mp3Unproven, section?.kept, section?.state], '(g3) the report')
        .toEqual([1, 1, 'mp3-kept'])
      expectUnpublishSafe(stub, { seq: 3, moves: 'both', storyId: ID, takedown: true })
    },
  )

  it(
    'T15B-41 dry runs: every plan read on the read-only port, the plan and takedown plan lines, zero writes, deletes, hooks, verifies and range calls, no deleter built; exits 0, 1 and 2 (A21, D15B-22, L27)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await seed()
      seedAudio([two, river])
      for (const args of [
        [ID, '--dry-run'],
        [ID, '--takedown', '--dry-run'],
      ]) {
        const r = await unpublish(stub, args)
        expect
          .soft(
            [
              r.exit,
              r.report?.mode,
              objectPosts(stub).length,
              deletesOf(since(stub)).length,
              r.calls,
              r.removers,
              r.factories,
            ],
            `(g1) ${args.join(' ')}: exit 0, dry-run, nothing written, no tail, no deleter`,
          )
          .toEqual([0, 'dry-run', 0, 0, [], 0, ['unpublish']])
        expectUnpublishSafe(stub, { seq: null, moves: 'none', storyId: ID, takedown: true })
        if (args.includes('--takedown')) {
          expect
            .soft(r.out, '(g2) the unpublish, plan and takedown plan lines, nothing else')
            .toEqual([
              `publish: unpublish ${ID} production=remove staging=remove`,
              'publish: plan kind=unpublish seq=3 stories=1 production=2 staging=1 featured=none from=none',
              `publish: takedown ${ID} plan packages=1 media=3 mp3=1 mp3-unproven=0 images=2 (hash list checked)`,
            ])
        }
      }
      rmSync(join(audioDir(root), 'SHA256SUMS.txt'))
      const noList = await unpublish(stub, [ID, '--takedown', '--dry-run'])
      expect
        .soft([noList.exit, noList.out.at(-1)], '(g3) no list file: exit 1 hash-list-missing')
        .toEqual([1, `publish: stopped: hash-list-missing ${ID}`])
      expectUnpublishSafe(stub, { seq: null, moves: 'none', storyId: ID, takedown: true })
      // args.ts refuses the string form public/r; a junction to public/ reaches the real-path check.
      symlinkSync(join(root, 'public'), join(root, 'rd'), 'junction')
      const inSite = await unpublish(stub, [ID, '--dry-run'], { reportDir: join(root, 'rd', 'r') })
      expect
        .soft(
          [inSite.exit, inSite.calls, since(stub).length],
          '(g3) a report dir under public/: exit 2, no request',
        )
        .toEqual([2, [], 0])
      expectUnpublishSafe(stub, { seq: null, moves: 'none', storyId: ID, takedown: false })
    },
  )

  it(
    'T15B-42 one factory per kind, the writer types, and the run-time predicate (A6, A14, L5, D15B-6, TP-14)',
    TIMEOUT,
    async () => {
      const stub = await seed()
      const r = await unpublish(stub, [ID])
      expect
        .soft(r.factories, '(g1) an unpublish run: makeUnpublishPort once, makePort never')
        .toEqual(['unpublish'])
      expectUnpublishSafe(stub, { seq: 3, moves: 'both', storyId: ID, takedown: false })
      const realLog = { requests: since(stub), unexpected: stub.unexpected }
      const fresh = await prepared([await storyOf(RIVER)])
      const p = await publish(fresh, [RIVER])
      expect
        .soft([p.exit, p.factories], '(g1) a publish run: makePort once, makeUnpublishPort never')
        .toEqual([0, ['publish']])
      expect
        .soft(typeof unpublishPortTypeSamples, '(g2) the type-only samples compile, never called')
        .toBe('function')
      const entry = (method: string, pathname: string, body: unknown = {}): StubLogEntry => ({
        method,
        pathname,
        search: '',
        headerNames: [],
        apikeyMatched: true,
        authorization: 'absent',
        values: { 'content-type': 'application/json' },
        body: encode(JSON.stringify(body)),
        bodySha256: '',
      })
      const riverPath = `media/${RIVER}/${'a'.repeat(64)}-w768.webp`
      const ownPath = `media/${ID}/${'a'.repeat(64)}-w768.webp`
      const negatives: [string, StubLogEntry, Safe][] = [
        [
          'a staging POST with moves none',
          entry('POST', STAGING_WRITE),
          { seq: null, moves: 'none', storyId: ID, takedown: false },
        ],
        [
          'a production POST with moves staging',
          entry('POST', PRODUCTION_WRITE),
          { seq: 3, moves: 'staging', storyId: ID, takedown: false },
        ],
        [
          'a DELETE with takedown false',
          entry('DELETE', DELETE_PATH, { prefixes: [ownPath] }),
          { seq: 3, moves: 'both', storyId: ID, takedown: false },
        ],
        [
          'a DELETE naming a river path',
          entry('DELETE', DELETE_PATH, { prefixes: [riverPath] }),
          { seq: 3, moves: 'both', storyId: ID, takedown: true },
        ],
        [
          'a masters POST',
          entry('POST', `${CREATE}masters/approvals/${ID}/${'a'.repeat(64)}.json`),
          { seq: 3, moves: 'both', storyId: ID, takedown: false },
        ],
      ]
      for (const [label, synthetic, safe] of negatives) {
        expect
          .soft(
            () => expectUnpublishSafe({ requests: [synthetic], unexpected: [] }, safe),
            `(g3) ${label}`,
          )
          .toThrow(/unpublish-safe|confined/)
      }
      expect
        .soft(
          () =>
            expectUnpublishSafe(realLog, { seq: 3, moves: 'both', storyId: ID, takedown: false }),
          '(g3) the real T15B-32 log passes',
        )
        .not.toThrow()
      expectNoUnexpected(fresh)
    },
  )

  it(
    "T15B-43 privacy at the runPublish level: a failing deleter's key run, a refused list's line and the local root appear in no channel (A28, L25)",
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const key = ['sb', 'secret', 'S15BCANARYkey0123456789'].join('_')
      const stub = await prepared([two, river], undefined, [[ID, RIVER]], key)
      seedAudio([two, river])
      const run1 = await unpublish(stub, [ID, '--takedown'], {
        removerFetch: wrapFetch({
          before: (_url, init) => {
            if (init.method === 'DELETE') {
              return new Response(JSON.stringify({ error: key.slice('sb_secret_'.length) }), {
                status: 502,
                headers: { 'content-type': 'application/json' },
              })
            }
          },
        }),
      })
      expect(run1.out.at(-2), 'precondition: takedown-incomplete').toBe(
        `publish: stopped: takedown-incomplete ${ID}`,
      )
      expect
        .soft(channels(run1).includes('S15BCANARY'), '(g1) no canary in any channel')
        .toBe(false)
      expectUnpublishSafe(stub, { seq: 3, moves: 'both', storyId: ID, takedown: true })

      const canaryList = `${hashListOf([two, river])}${'a'.repeat(64)}  ${ID}/s15bcanary.en.mp3\r\n`
      seedAudio([two, river], canaryList)
      const run2 = await unpublish(stub, [ID, '--takedown'])
      expect
        .soft(
          [run2.exit, run2.out.at(-1), channels(run2).includes('s15bcanary')],
          '(g2) a refused list',
        )
        .toEqual([1, `publish: stopped: hash-list-invalid ${ID}`, false])
      expectUnpublishSafe(stub, { seq: null, moves: 'none', storyId: ID, takedown: true })

      // g3: across the T15B-38 run.
      const fresh = await seed()
      seedAudio([two, river])
      const full = await unpublish(fresh, [ID, '--takedown'])
      expect(full.exit, 'precondition: the takedown run').toBe(0)
      const text3 = channels(full)
      expect
        .soft(
          [...rootForms(root), 'SHA256SUMS'].filter((f) => text3.includes(f)),
          '(g3) no root form, no SHA256SUMS',
        )
        .toEqual([])
      expectUnpublishSafe(fresh, { seq: 3, moves: 'both', storyId: ID, takedown: true })

      // g4: local refusals in dry runs.
      const forbidden = [
        ...rootForms(root),
        'SHA256SUMS',
        'migration-input\\audio',
        'migration-input/audio',
      ]
      const dryStub = await seed()
      const audio = audioDir(root)
      const mp3 = two.media.find((m) => m.mime === 'audio/mpeg')!
      const samples: [string, () => RunOptions, number][] = [
        [
          '(a) no list file',
          () => {
            rmSync(join(audio, 'SHA256SUMS.txt'), { force: true })
            return {}
          },
          1,
        ],
        [
          '(b) the audio folder on a share',
          () => {
            seedAudio([two, river])
            return {
              realPath: (path) =>
                path === audio ? '\\\\h\\s\\sb\\migration-input\\audio' : native(path),
            }
          },
          1,
        ],
        [
          "(c) a list without the MP3's line",
          () => {
            seedAudio(
              [two, river],
              hashListOf([two, river])
                .split('\n')
                .filter((row) => !row.startsWith(mp3.sha256))
                .join('\n'),
            )
            return {}
          },
          0,
        ],
        [
          '(d) a list with a CR',
          () => {
            seedAudio([two, river], hashListOf([two, river]).replace('\n', '\r\n'))
            return {}
          },
          1,
        ],
      ]
      for (const [label, make, exit] of samples) {
        const r = await unpublish(dryStub, [ID, '--takedown', '--dry-run'], make())
        const text = channels(r)
        expect
          .soft([r.exit, forbidden.filter((f) => text.includes(f))], `(g4) ${label}`)
          .toEqual([exit, []])
        if (label.startsWith('(c)')) {
          expect
            .soft(r.out.at(-1)?.includes('mp3-unproven=1'), '(g4) (c) mp3-unproven=1')
            .toBe(true)
        }
        expectUnpublishSafe(dryStub, { seq: null, moves: 'none', storyId: ID, takedown: true })
      }
    },
  )
})

/** Type-only samples (T15B-42 g2): never called; checked by corepack pnpm typecheck. */
function unpublishPortTypeSamples(
  c: StorageClient,
  bytes: Uint8Array,
  opts: Parameters<typeof createContentDeleter>[0],
): void {
  const publishPort: PublishPort = c
  // @ts-expect-error a PublishPort cannot write the staging pointer
  void publishPort.writePointer('staging', bytes)
  const unpublishPort: UnpublishPort = c
  void unpublishPort.writePointer('staging', bytes)
  void unpublishPort.writePointer('production', bytes)
  // S6: the deleter is a ContentRemover.
  const remover: ContentRemover = createContentDeleter(opts)
  void remover
}
