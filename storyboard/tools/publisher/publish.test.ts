// Step 15a (P1-8d part a) publish.ts: runPublish's publish, feature and rollback plans, the carried
// checks, the commit through the production pointer and the tail (design
// migration-input/p1-step15a-design.md §4.2 to §4.6, D15-7 to D15-14, D15-18, D15-19, D15-22,
// D15-24, CRIT-6 to CRIT-8, CRIT-11, CRIT-12, CRIT-17, TP-6 to TP-8; test plan §14.10: T15A-38 to
// T15A-51).
// Every Storage call goes to the loopback stub through a real client built in the test with a fake
// key assembled at run time; a loopback guard on the global fetch refuses and counts any other host.
// The hook and verify are fakes that record their calls (TP-7); nothing reaches Vercel. Staging is
// seeded by a real runStage, records by a real runApprove (stdin answers), and earlier production
// snapshots by real publishes (or, for refusal cases, documents built with the catalogue builders).
// A deleted object is simulated at the HTTP level: the client's fetchImpl answers its read as not
// found and drops it from listings. Every test ends with expectPublishSafe (TP-8): after the mark set
// at the start of the last run, object POSTs only to catalogue/snapshots/<seq>.json (at most two)
// and catalogue/production.json (at most one), none under masters, none to the staging pointer.
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import type { CatalogueSnapshot } from '../../src/core/package/catalogue'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { parseArgs } from './args'
import { runApprove } from './approve'
import { buildProductionDocuments, buildStagingDocuments } from './catalogue-state'
import { Secret } from './env'
import type { PublishPort } from './port'
import { runPublish, type PublishTail, type VerifyAnswer } from './publish'
import { REMOTE_CHECK_STEPS } from './remote-checks'
import { VERIFY_TIMEOUT_HINT, formatReportDirRefused } from './report'
import { runStage } from './stage'
import {
  answersOf,
  approvalRecordOf,
  buildTestStories,
  fullyBoundStory,
  waiverBytesOf,
  waiverFileOf,
  withPackage,
  writeStageInputs,
  type TestStory,
} from './stage-testkit'
import { createStorageClient, type StorageClient } from './storage'
import {
  expectNoUnexpected,
  startStorageStub,
  type StorageStub,
  type StubLogEntry,
} from './storage-stub'

// ---- shared material ----

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-publish-test-key'].join('_')
const NOW = '2026-11-21T20:00:00.000Z'
const ID = 'two-paths'
const RIVER = 'river-stones'
const LIST_PATH = '/storage/v1/object/list/content'
const READ = '/storage/v1/object/authenticated/'
const CREATE = '/storage/v1/object/'
const PRODUCTION_WRITE = `${CREATE}content/catalogue/production.json`
const STAGING_WRITE = `${CREATE}content/catalogue/staging.json`
const snapshotWrite = (seq: number) => `${CREATE}content/catalogue/snapshots/${seq}.json`
const snapshotRead = (seq: number) => `${READ}content/catalogue/snapshots/${seq}.json`
const MISSING_BODY = '{"statusCode":"404","error":"not_found","message":"Object not found"}'
const TIMEOUT = { timeout: 120_000 }
const RULESET = PANCHATANTRA_RULESET
const NEXT_MAJOR = RULESET.ref.replace(/@(\d+)/, (_whole, major: string) => `@${Number(major) + 1}`)
const sha12 = (sha: string) => sha.slice(0, 12)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

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
  root = mkdtempSync(join(tmpdir(), 's15a-pb-'))
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

async function newStub(): Promise<StorageStub> {
  const stub = await startStorageStub({ apikey: FAKE_KEY })
  stubs.push(stub)
  return stub
}

const mark = (stub: StorageStub) => void marks.set(stub, stub.requests.length)
const since = (stub: StorageStub) => stub.requests.slice(marks.get(stub) ?? 0)
const isObjectPost = (r: StubLogEntry) => r.method === 'POST' && r.pathname !== LIST_PATH
const objectPosts = (stub: StorageStub) => since(stub).filter(isObjectPost)

type LogLike = Pick<StorageStub, 'requests' | 'unexpected'>
/**
 * TP-8 (A19): after the mark, object POSTs only to catalogue/snapshots/<seq>.json (at most two) and
 * catalogue/production.json (at most one); none under masters; none to the staging pointer; then
 * expectNoUnexpected.
 */
function expectPublishSafe(stub: LogLike, seq: number | null): void {
  const posts = stub.requests.slice(marks.get(stub as StorageStub) ?? 0).filter(isObjectPost)
  if (posts.some((r) => r.pathname.startsWith(`${CREATE}masters/`))) {
    throw new Error('A19: a POST under masters')
  }
  if (posts.some((r) => r.pathname === STAGING_WRITE))
    throw new Error('A19: a staging pointer POST')
  const snapshots = posts.filter((r) =>
    r.pathname.startsWith(`${CREATE}content/catalogue/snapshots/`),
  )
  const pointers = posts.filter((r) => r.pathname === PRODUCTION_WRITE)
  if (snapshots.length + pointers.length !== posts.length) {
    throw new Error('A19: an object POST outside the snapshot and the production pointer')
  }
  if (snapshots.some((r) => seq === null || r.pathname !== snapshotWrite(seq))) {
    throw new Error('A19: a snapshot POST of another seq')
  }
  if (snapshots.length > 2) throw new Error('A19: more than two snapshot POSTs')
  if (pointers.length > 1) throw new Error('A19: more than one production POST')
  expectNoUnexpected(stub as StorageStub)
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
    secretKey: new Secret(FAKE_KEY),
    ...(fetchImpl ? { fetchImpl } : {}),
  })

/** A real stage of `stories` (masters waiver files seeded first); then the mark. */
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

/** A real approve with stdin answers (answersOf, `over` merged); exit 0 or the setup fails. */
async function approveIn(
  stub: StorageStub,
  story: TestStory,
  over: Record<string, string> = {},
): Promise<void> {
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
      input: Readable.from([JSON.stringify(answersOf(story, over))]),
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
  /** Content paths that read as not found and are left out of listings. */
  readonly deleted?: ReadonlySet<string>
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

interface PublishOptions extends FetchOptions {
  readonly hook?: 'triggered' | 'failed' | (() => Promise<'triggered' | 'failed'>)
  readonly verify?: (seq: number) => Promise<VerifyAnswer> | VerifyAnswer
  readonly reportDir?: string
  readonly clock?: ReturnType<typeof fakeClock>
}

interface Published {
  readonly exit: number
  readonly out: string[]
  readonly err: string[]
  readonly calls: string[]
  readonly report: Record<string, unknown> | null
  readonly md: string
}

/** One runPublish of `args` (after `publish`) through a real client on the stub; the mark first. */
async function publish(
  stub: StorageStub,
  args: readonly string[],
  options: PublishOptions = {},
): Promise<Published> {
  mark(stub)
  const out: string[] = []
  const err: string[] = []
  const calls: string[] = []
  const clock = options.clock ?? fakeClock()
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
    verify: async (seq) => {
      calls.push(`verify ${seq}`)
      return options.verify ? options.verify(seq) : { kind: 'live', seq }
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
      const writer: PublishPort = port
      return writer
    },
    tail,
  })
  const json = join(dir, 'publisher-publish.json')
  const md = join(dir, 'publisher-publish.md')
  return {
    exit,
    out,
    err,
    calls,
    report: existsSync(json)
      ? (JSON.parse(readFileSync(json, 'utf8')) as Record<string, unknown>)
      : null,
    md: existsSync(md) ? readFileSync(md, 'utf8') : '',
  }
}

/** The snapshot the stub's `mode` pointer names, and the pointer's seq. */
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

/** Stores snapshot `seq` and the `mode` pointer, built by the catalogue builders (refusal cases). */
async function putDocuments(
  stub: StorageStub,
  mode: 'staging' | 'production',
  seq: number,
  stories: readonly SnapshotEntry[],
  featuredStoryId: string | null = null,
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
  stub.put('content', `catalogue/${mode}.json`, built.documents.pointer.bytes, 'application/json')
}

/**
 * The request classes after the mark, consecutive repeats collapsed; the remote check's requests are
 * named as REMOTE_CHECK_STEPS names them (AUD-8).
 */
function classes(stub: StorageStub): string[] {
  const named = since(stub).map((r) => {
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
const STATE_READS = ['catalogue-list', 'production-read', 'staging-read', 'snapshot-read']
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

/** Requests after the mark for one story's paths (T15A-42 g2, g5). */
const storyRequests = (stub: StorageStub, id: string) =>
  since(stub).filter(
    (r) =>
      r.pathname.includes(`/packages/${id}/`) ||
      r.pathname.includes(`/approvals/${id}/`) ||
      r.pathname.includes(`/waivers/${id}/`) ||
      (r.pathname === LIST_PATH && decode(r.body).includes(`"prefix":"media/${id}"`)) ||
      (r.pathname === LIST_PATH && decode(r.body).includes(`"prefix":"packages/${id}"`)),
  )

const publisherUnder = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[]).filter((name) =>
    name.split(/[\\/]/).some((part) => part.startsWith('publisher-')),
  )
const packagePathOf = (story: TestStory) => `packages/${story.storyId}/${story.packageSha256}.json`

/** Stories staged, approved and (optionally) published, in that order. */
async function prepared(
  stories: readonly TestStory[],
  approved: readonly TestStory[] = stories,
  published: readonly string[][] = [],
): Promise<StorageStub> {
  const stub = await newStub()
  await stageIn(stub, stories)
  for (const story of approved) await approveIn(stub, story)
  for (const ids of published) {
    const r = await publish(stub, ids)
    if (r.exit !== 0) throw new Error(`test setup: publish ${ids.join(' ')} exited ${r.exit}`)
  }
  return stub
}

/**
 * The rollback history (fully bound stories): stage both (1); approve both; publish two-paths (2);
 * publish river-stones (3); stage two-paths v2 (4); approve it; publish it (5). Production names 5;
 * snapshot 3 holds both v1 entries, approved; staging names 4.
 */
async function history() {
  const two = await fullyBoundStory(await storyOf(ID))
  const river = await fullyBoundStory(await storyOf(RIVER))
  const v2 = await withPackage(two, { ...two.pkg, version: 2 } as StoryPackageV1)
  const stub = await prepared([two, river], [two, river], [[ID], [RIVER]])
  await stageIn(stub, [v2])
  await approveIn(stub, v2)
  const fifth = await publish(stub, [ID])
  if (fifth.exit !== 0) throw new Error('test setup: the fifth publish')
  return { stub, two, river, v2 }
}

describe('publish', () => {
  it(
    'T15A-38 publish one approved story on an empty production: plan, snapshot N, the production pointer, one hook, verify N; exit 0 published (A9, A12, A13, A19, TP-6)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await prepared([two])
      const stagingBefore = pointed(stub, 'staging')?.bytes
      const record = await approvalRecordOf(two, { on: '2026-11-21' })
      const run = await publish(stub, [ID])
      expect(run.exit, 'precondition: stage, approve and publish exit 0').toBe(0)
      expect
        .soft(classes(stub), '(g1) the request classes in order')
        .toEqual([...STATE_READS, ...REMOTE_CHECK_STEPS, ...COMMIT])
      const production = pointed(stub, 'production')
      expect.soft(production?.seq, '(g2) production names seq 2').toBe(2)
      expect
        .soft(
          production?.snapshot.stories.map((e) => [e.storyId, e.approvalSha256]),
          '(g2) snapshot 2 holds two-paths with its approvalSha256',
        )
        .toEqual([[ID, record.sha256]])
      expect
        .soft(pointed(stub, 'staging')?.bytes, "(g2) the staging pointer's bytes unchanged")
        .toBe(stagingBefore)
      expect.soft(run.calls, '(g3) hook once, then verify(2)').toEqual(['hook', 'verify 2'])
      const snapshotSha = (run.report?.publish as { snapshotSha256?: string } | undefined)
        ?.snapshotSha256
      expect
        .soft(run.out, '(g4) stdout exactly the story, plan, snapshot, pointer and live lines')
        .toEqual([
          `publish: ${ID} package=${sha12(two.packageSha256)} version=1 approval=${sha12(record.sha256)} state=new`,
          'publish: plan kind=publish seq=2 stories=1 production=none staging=1 featured=none from=none',
          `publish: snapshot seq=2 sha256=${sha12(snapshotSha ?? '')} created`,
          'publish: production pointer seq=2 moved (read back, post-check clean)',
          'publish: live seq=2',
        ])
      const section = run.report?.publish as Record<string, unknown> | undefined
      expect
        .soft(
          [section?.hook, section?.verify, section?.liveSeq, run.report?.outcome],
          '(g4) the report: hook triggered, verify live, liveSeq 2',
        )
        .toEqual(['triggered', 'live', 2, 'published'])
      expectPublishSafe(stub, 2)
      const v2 = await withPackage(two, { ...two.pkg, version: 2 } as StoryPackageV1)
      await stageIn(stub, [v2])
      await approveIn(stub, v2)
      const second = await publish(stub, [ID])
      expect
        .soft(second.out[0]?.endsWith(' state=replaced'), '(g4) a second publish of v2: replaced')
        .toBe(true)
      expectPublishSafe(stub, 4)
    },
  )

  it(
    'T15A-39 publish takes the named ids staged entries only; a superseded staged entry is staged-entry-superseded before any write (A9, D15-9, CRIT-11)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await prepared([two, river])
      const r1 = await publish(stub, [ID])
      expect(r1.exit, 'precondition: the publish exits 0').toBe(0)
      expect
        .soft(
          pointed(stub, 'production')?.snapshot.stories.map((e) => e.storyId),
          '(g1) N+1 holds two-paths only',
        )
        .toEqual([ID])
      // Each stub's run is checked at the end, so one group's refusal never hides the next.
      const safe: [StorageStub, number | null][] = [[stub, 2]]

      const staged = pointed(stub, 'staging')!.snapshot.stories.find((e) => e.storyId === ID)!
      const carrying = await prepared([two])
      await putDocuments(carrying, 'staging', 2, [{ ...staged, approvalSha256: 'e'.repeat(64) }])
      const r2 = await publish(carrying, [ID])
      expect
        .soft([r2.exit, r2.out.at(-1)], '(g2) a staging entry with approvalSha256')
        .toEqual([1, `publish: stopped: staged-entry-superseded ${ID}`])
      safe.push([carrying, null])

      for (const [label, version] of [
        ['production at the same version with another sha', 1],
        ['production at a higher version', 2],
      ] as const) {
        const other = 'f'.repeat(64)
        const stub3 = await prepared([two])
        await putDocuments(stub3, 'production', 2, [
          {
            ...staged,
            version,
            packageSha256: other,
            packagePath: `packages/${ID}/${other}.json`,
            approvalSha256: 'e'.repeat(64),
          },
        ])
        const r3 = await publish(stub3, [ID])
        expect
          .soft([r3.exit, r3.out.at(-1), objectPosts(stub3).length, r3.calls], `(g3) ${label}`)
          .toEqual([1, `publish: stopped: staged-entry-superseded ${ID}`, 0, []])
        safe.push([stub3, null])
      }
      for (const [checked, seq] of safe) expectPublishSafe(checked, seq)
    },
  )

  it(
    'T15A-40 publish refuses on a failing named-story check before any write and names the story (A8, §4.2)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await prepared([two, river], [two])
      const r1 = await publish(stub, [ID, RIVER])
      expect
        .soft([r1.exit, r1.out.at(-1), r1.report?.outcome], '(g1) the second record absent')
        .toEqual([1, `publish: stopped: approval-missing ${RIVER}`, 'approval-missing'])
      expect
        .soft([objectPosts(stub).length, r1.calls], '(g1) zero POSTs and hooks')
        .toEqual([0, []])
      expectPublishSafe(stub, null)
      await approveIn(stub, river)
      const r2 = await publish(stub, [ID, RIVER], { deleted: new Set([river.media[0]!.path]) })
      expect
        .soft([r2.exit, r2.out.at(-1), r2.report?.outcome], "(g1) the second's media deleted")
        .toEqual([1, `publish: stopped: object-missing ${RIVER}`, 'object-missing'])
      expect
        .soft([objectPosts(stub).length, r2.calls], '(g1) zero POSTs and hooks')
        .toEqual([0, []])
      expectPublishSafe(stub, null)
    },
  )

  it(
    'T15A-41 carried production entries: package read, checkPackage, media plan and listings before composing (CRIT-7, L9)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await prepared([two, river], [two, river], [[RIVER]])
      const samples: [string, string[], Set<string>, string][] = [
        [
          'one river-stones variant deleted',
          [ID],
          new Set([river.media[0]!.path]),
          'object-missing',
        ],
        ['its package deleted', [ID], new Set([packagePathOf(river)]), 'carried-package-missing'],
        [
          'publish river-stones (in production) with its package deleted',
          [RIVER],
          new Set([packagePathOf(river)]),
          'carried-package-missing',
        ],
      ]
      for (const [label, ids, deleted, code] of samples) {
        const r = await publish(stub, ids, { deleted })
        expect
          .soft([r.exit, r.out.at(-1), objectPosts(stub).length, r.calls], `(g1) ${label}`)
          .toEqual([1, `publish: stopped: ${code} ${RIVER}`, 0, []])
        expectPublishSafe(stub, null)
      }
      const block = await prepared([two, river], [two, river], [[RIVER]])
      const production = pointed(block, 'production')!
      const carried = production.snapshot.stories.find((e) => e.storyId === RIVER)!
      await putDocuments(block, 'production', 3, [
        { ...carried, waivers: { ...carried.waivers!, ruleSetRef: NEXT_MAJOR } },
      ])
      const r = await publish(block, [ID])
      expect
        .soft(
          [r.exit, r.out.at(-1), objectPosts(block).length, r.calls],
          "(g1) river-stones' block naming major + 1",
        )
        .toEqual([1, `publish: stopped: carried-package-gate ${RIVER}`, 0, []])
      expectPublishSafe(block, null)
    },
  )

  it(
    'T15A-42 --feature: set, cleared, kept and re-checked; refused outside N+1, with incomplete media or without production (A14, L13, CRIT-12)',
    TIMEOUT,
    async () => {
      const two = await fullyBoundStory(await storyOf())
      const river = await fullyBoundStory(await storyOf(RIVER))
      const stub = await prepared([two, river], [two, river], [[ID, RIVER]])
      const set = await publish(stub, ['--feature', ID])
      expect
        .soft(
          [set.exit, pointed(stub, 'production')?.snapshot.featuredStoryId, set.out[0]],
          '(g1) --feature <fully bound id>: set',
        )
        .toEqual([0, ID, `publish: feature ${ID} state=set`])
      expectPublishSafe(stub, 3)

      // g3: the featured story republished as a version missing one narration.
      const audio = two.pkg.assets.findIndex((asset) => asset.kind === 'audio')
      const v2 = await withPackage(two, {
        ...two.pkg,
        version: 2,
        assets: two.pkg.assets.filter((_, index) => index !== audio),
      } as StoryPackageV1)
      await stageIn(stub, [v2])
      await approveIn(stub, v2)
      const incomplete = await publish(stub, [ID])
      expect
        .soft(
          [incomplete.exit, incomplete.out.slice(-2), objectPosts(stub).length],
          '(g3) feature-media-incomplete with the counts line, zero POSTs',
        )
        .toEqual([
          1,
          [
            `publish: feature ${ID} A001=0 A005=1 A006=0`,
            `publish: stopped: feature-media-incomplete ${ID}`,
          ],
          0,
        ])
      expectPublishSafe(stub, null)

      const cleared = await publish(stub, ['--feature', 'none'])
      expect
        .soft(
          [cleared.exit, pointed(stub, 'production')?.snapshot.featuredStoryId, cleared.out[0]],
          '(g2) --feature none: cleared',
        )
        .toEqual([0, null, 'publish: feature none state=cleared'])
      expect
        .soft(
          storyRequests(stub, ID).filter(
            (r) => r.method === 'GET' && r.pathname.includes('/packages/'),
          ).length,
          '(g2) the featured package read once (its carried check), never again for none',
        )
        .toBe(1)
      expectPublishSafe(stub, 5)

      const outside = await publish(stub, ['--feature', 'x-y'])
      expect
        .soft([outside.exit, outside.out.at(-1)], '(g4) --feature x-y outside N+1')
        .toEqual([1, 'publish: stopped: feature-not-in-production x-y'])
      expectPublishSafe(stub, null)

      const withRiver = await publish(stub, [ID, '--feature', RIVER])
      expect(withRiver.out.at(-1), 'precondition: g5 reaches the featured check').not.toMatch(
        /stopped: (not-staged|staged-entry)/,
      )
      const riverRequests = storyRequests(stub, RIVER).map((r) =>
        r.pathname === LIST_PATH
          ? `list ${(JSON.parse(decode(r.body)) as { prefix: string }).prefix}`
          : `${r.method} ${r.pathname.includes('/approvals/') ? 'approval' : r.pathname.includes('/waivers/') ? 'waiver' : 'package'}`,
      )
      expect
        .soft(riverRequests, '(g5) river-stones carried: its package GET and both lists only')
        .toEqual(['GET package', `list packages/${RIVER}`, `list media/${RIVER}`])
      expectPublishSafe(stub, 6)

      const fresh = await prepared([two], [two])
      const noProduction = await publish(fresh, ['--feature', 'a-b'])
      expect
        .soft([noProduction.exit, noProduction.out.at(-1)], '(g6) --feature without production')
        .toEqual([1, 'publish: stopped: production-missing'])
      expectPublishSafe(fresh, null)
    },
  )

  it(
    'T15A-43 --snapshot: the rollback checks in order, a byte-for-byte copy, the note, staging untouched, the tail expecting N+1 (A15, L14)',
    TIMEOUT,
    async () => {
      const { stub, two, river } = await history()
      expect(pointed(stub, 'production')?.seq, 'precondition: production at 5').toBe(5)
      const three = snapshotAt(stub, 3)
      expect(
        three.stories.every((e) => e.approvalSha256 !== undefined),
        'precondition: snapshot 3 is approved',
      ).toBe(true)
      const stagingBefore = pointed(stub, 'staging')?.bytes
      const back = await publish(stub, ['--snapshot', '3'])
      const six = snapshotAt(stub, 6)
      expect
        .soft(
          [back.exit, decode(jcsBytes(six.stories)), six.featuredStoryId, six.note],
          '(g1) snapshot 6 copies 3 byte for byte, its featured id, the note',
        )
        .toEqual([
          0,
          decode(jcsBytes(three.stories)),
          three.featuredStoryId,
          'publisher rollback: 3',
        ])
      expect.soft(pointed(stub, 'staging')?.bytes, '(g1) staging unchanged').toBe(stagingBefore)
      expect.soft(back.calls, '(g1) the tail expects 6').toEqual(['hook', 'verify 6'])
      expectPublishSafe(stub, 6)

      const refusals: [string, string[], PublishOptions, string, () => void][] = [
        [
          'unlisted 2',
          ['--snapshot', '2'],
          { deleted: new Set(['catalogue/snapshots/2.json']) },
          'rollback-snapshot-missing',
          () => {},
        ],
        [
          'a non-JCS snapshot',
          ['--snapshot', '1'],
          {},
          'rollback-snapshot-invalid',
          () =>
            stub.put(
              'content',
              'catalogue/snapshots/1.json',
              new TextEncoder().encode(JSON.stringify(snapshotAt(stub, 1), null, 2)),
              'application/json',
            ),
        ],
        [
          'another seq inside',
          ['--snapshot', '2'],
          {},
          'rollback-snapshot-invalid',
          () =>
            stub.put('content', 'catalogue/snapshots/2.json', jcsBytes(three), 'application/json'),
        ],
        [
          'a staging snapshot',
          ['--snapshot', '4'],
          {},
          `rollback-entry-unapproved ${ID}`,
          () => {},
        ],
        [
          "an entry's package deleted",
          ['--snapshot', '3'],
          { deleted: new Set([packagePathOf(river)]) },
          `object-missing ${RIVER}`,
          () => {},
        ],
      ]
      for (const [label, args, options, line, setup] of refusals) {
        setup()
        const r = await publish(stub, args, options)
        expect
          .soft([r.exit, r.out.at(-1), objectPosts(stub).length, r.calls], `(g2) ${label}`)
          .toEqual([1, `publish: stopped: ${line}`, 0, []])
        expectPublishSafe(stub, null)
      }
      const recordPath = `approvals/${ID}/${two.packageSha256}.json`
      const original = stub.object('masters', recordPath)!.bytes
      for (const [label, bytes, code] of [
        [
          "an entry's record bytes changed",
          (await approvalRecordOf(two, { on: '2026-11-20' })).bytes,
          'approval-sha-mismatch',
        ],
        [
          'records of another rule set',
          jcsBytes({ ...(JSON.parse(decode(original)) as object), ruleSetRef: NEXT_MAJOR }),
          'approval-rule-set',
        ],
      ] as const) {
        stub.put('masters', recordPath, bytes, 'application/json')
        const r = await publish(stub, ['--snapshot', '3'])
        expect
          .soft([r.exit, r.out.at(-1), objectPosts(stub).length], `(g2) ${label}`)
          .toEqual([1, `publish: stopped: ${code} ${ID}`, 0])
        expectPublishSafe(stub, null)
      }
      stub.put('masters', recordPath, original, 'application/json')
      stub.put(
        'content',
        'catalogue/snapshots/7.json',
        jcsBytes({ ...three, seq: 7 }),
        'application/json',
      )
      const orphan = await publish(stub, ['--snapshot', '7'])
      expect
        .soft([orphan.exit, orphan.out.at(-1), objectPosts(stub).length], '(g2) a listed orphan 7')
        .toEqual([1, 'publish: stopped: rollback-seq-not-older', 0])
      expectPublishSafe(stub, null)
      const fresh = await prepared([two], [two])
      const none = await publish(fresh, ['--snapshot', '1'])
      expect
        .soft([none.exit, none.out.at(-1), objectPosts(fresh).length], '(g2) no production')
        .toEqual([1, 'publish: stopped: production-missing', 0])
      expectPublishSafe(fresh, null)
    },
  )

  it(
    'T15A-44 --snapshot unchanged by content: equal seq runs the tail only, equal seq with a changing --feature writes N+1, and a re-run after a rollback is unchanged (CRIT-6, TP-6)',
    TIMEOUT,
    async () => {
      const { stub } = await history()
      const same = await publish(stub, ['--snapshot', '5'])
      expect
        .soft(
          [
            same.exit,
            same.out.find((l) => l.startsWith('publish: plan '))?.includes(' seq=none '),
            objectPosts(stub).length,
            same.calls,
            same.report?.outcome,
          ],
          '(g1) --snapshot 5: seq=none, zero POSTs, one hook, verify(5), rebuilt',
        )
        .toEqual([0, true, 0, ['hook', 'verify 5'], 'rebuilt'])
      expectPublishSafe(stub, null)
      const featured = await publish(stub, ['--snapshot', '5', '--feature', RIVER])
      expect
        .soft(
          [
            featured.exit,
            pointed(stub, 'production')?.seq,
            pointed(stub, 'production')?.snapshot.featuredStoryId,
          ],
          '(g2) --snapshot 5 --feature river-stones: snapshot 6 featuring it',
        )
        .toEqual([0, 6, RIVER])
      expectPublishSafe(stub, 6)
      const back = await publish(stub, ['--snapshot', '3'])
      expect(back.exit, 'precondition: the rollback to 3 moved production').toBe(0)
      const rolled = pointed(stub, 'production')!.seq
      expectPublishSafe(stub, rolled)
      const again = await publish(stub, ['--snapshot', '3'])
      expect
        .soft(
          [again.exit, objectPosts(stub).length, again.calls, again.report?.outcome],
          '(g3) a re-run after the rollback: unchanged, zero POSTs, one hook, verify(its seq)',
        )
        .toEqual([0, 0, ['hook', `verify ${rolled}`], 'rebuilt'])
      expect.soft(rolled, '(g3) the rollback wrote snapshot 7').toBe(7)
      expectPublishSafe(stub, null)
    },
  )

  it(
    'T15A-45 the tail: one hook only after moved or unchanged; hook-failed stops verify; the timeout hint and the recovery line; superseded is exit 0; zero hook calls on every earlier stop (A13, L12, CRIT-8)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const failed = await prepared([two])
      const r1 = await publish(failed, [ID], { hook: 'failed' })
      expect
        .soft(
          [r1.exit, r1.calls, r1.out.slice(-2)],
          '(g1) hook failed: exit 4, no verify, the lines',
        )
        .toEqual([
          4,
          ['hook'],
          [
            'publish: stopped: hook-failed',
            'publish: recovery: publish --snapshot 2 redeploys production as it is',
          ],
        ])
      expectPublishSafe(failed, 2)
      const slow = await prepared([two])
      const r2 = await publish(slow, [ID], { verify: () => ({ kind: 'timeout' }) })
      expect
        .soft(
          [r2.exit, r2.out.slice(-3)],
          '(g2) verify timeout: exit 4, the hint, the recovery line',
        )
        .toEqual([
          4,
          [
            'publish: stopped: verify-timeout',
            VERIFY_TIMEOUT_HINT,
            'publish: recovery: publish --snapshot 2 redeploys production as it is',
          ],
        ])
      expectPublishSafe(slow, 2)
      const later = await prepared([two])
      const r3 = await publish(later, [ID], { verify: () => ({ kind: 'superseded', seq: 7 }) })
      expect
        .soft([r3.exit, r3.report?.outcome, r3.out.at(-1)], '(g3) superseded: exit 0')
        .toEqual([0, 'verify-superseded', 'publish: superseded seq=7'])
      expectPublishSafe(later, 2)

      const plan = await prepared([two])
      const r4 = await publish(plan, [RIVER])
      expect.soft([r4.exit, r4.calls], '(g4) a plan stop: no hook, no verify').toEqual([1, []])
      expectPublishSafe(plan, null)
      const commit = await prepared([two])
      for (let i = 0; i < 2; i++) {
        commit.override('POST', snapshotWrite(2), {
          kind: 'answer',
          status: 500,
          body: '{"statusCode":"500","error":"internal"}',
        })
      }
      const r5 = await publish(commit, [ID])
      expect.soft([r5.exit, r5.calls], '(g4) a commit stop: no hook, no verify').toEqual([3, []])
      expectPublishSafe(commit, 2)
      const raced = await prepared([two])
      const otherPointer = raced.object('content', 'catalogue/staging.json')!.bytes
      const r6 = await publish(raced, [ID], {
        after: (url, init) => {
          if (isPost(init, url, PRODUCTION_WRITE)) {
            raced.put(
              'content',
              'catalogue/staging.json',
              new TextEncoder().encode(`${decode(otherPointer)} `),
              'application/json',
            )
          }
        },
      })
      expect
        .soft([r6.exit, r6.out.at(-1), r6.calls], '(g4) pointer-raced: no hook, no verify')
        .toEqual([4, 'publish: stopped: pointer-raced re-run publish', []])
      expectPublishSafe(raced, 2)
    },
  )

  it(
    'T15A-46 partial failure and re-run at each §4.6 row; recovery by --snapshot <production seq> after staging moved (§4.6, CRIT-8)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const lost = await prepared([two])
      lost.override('GET', snapshotRead(2), { kind: 'answer', status: 400, body: MISSING_BODY })
      const r1 = await publish(lost, [ID])
      expect(r1.exit, 'precondition: the read-back not found once: exit 3').toBe(3)
      expect
        .soft(r1.out.at(-1), '(g1) snapshot-unconfirmed')
        .toBe('publish: stopped: snapshot-unconfirmed')
      expectPublishSafe(lost, 2)
      const again = await publish(lost, [ID])
      expect
        .soft(
          [again.exit, pointed(lost, 'production')?.seq],
          '(g1) the re-run allocates 3 and publishes',
        )
        .toEqual([0, 3])
      expectPublishSafe(lost, 3)

      const dropped = await prepared([two])
      let thrown = 0
      const r2 = await publish(dropped, [ID], {
        after: (url, init) => {
          if (isPost(init, url, PRODUCTION_WRITE) && thrown === 0) {
            thrown += 1
            dropped.override('GET', `${READ}content/catalogue/production.json`, {
              kind: 'answer',
              status: 500,
              body: '{"statusCode":"500","error":"internal"}',
            })
            throw new TypeError('connection lost after the request landed')
          }
        },
      })
      expect
        .soft([r2.exit, r2.out.at(-1), r2.calls], '(g2) the production POST lost after landing')
        .toEqual([4, 'publish: stopped: pointer-unconfirmed', []])
      expectPublishSafe(dropped, 2)
      const rerun = await publish(dropped, [ID])
      expect
        .soft(
          [rerun.exit, objectPosts(dropped).length, rerun.calls],
          '(g2) the re-run: in-production, the tail only',
        )
        .toEqual([0, 0, ['hook', 'verify 2']])

      const hookless = await prepared([two])
      const failedHook = await publish(hookless, [ID], { hook: 'failed' })
      expect(failedHook.exit, 'precondition: hook-failed').toBe(4)
      const repeat = await publish(hookless, [ID])
      expect
        .soft(
          [repeat.exit, objectPosts(hookless).length, repeat.calls],
          '(g3) the same publish: unchanged, one more hook',
        )
        .toEqual([0, 0, ['hook', 'verify 2']])
      // The in-production story's line and report entry name the approval N+1 holds (R1-FID-2).
      const live = pointed(hookless, 'production')!.snapshot.stories.find((e) => e.storyId === ID)
      const liveApproval = live?.approvalSha256 ?? ''
      expect(liveApproval, 'precondition: production holds two-paths with an approval').toMatch(
        /^[0-9a-f]{64}$/,
      )
      const namedOf = (run: Published) =>
        (run.report?.publish as { named?: { approvalSha256: string | null }[] } | undefined)
          ?.named?.[0]?.approvalSha256
      expect
        .soft(
          [repeat.out[0], namedOf(repeat)],
          "(g3) the in-production line and the report's named entry carry production's approvalSha256",
        )
        .toEqual([
          `publish: ${ID} package=${sha12(two.packageSha256)} version=1 approval=${sha12(liveApproval)} state=in-production`,
          liveApproval,
        ])
      expectPublishSafe(hookless, null)

      const movedOn = await prepared([two])
      expect(
        (await publish(movedOn, [ID], { hook: 'failed' })).exit,
        'precondition: hook-failed',
      ).toBe(4)
      const v2 = await withPackage(two, { ...two.pkg, version: 2 } as StoryPackageV1)
      await stageIn(movedOn, [v2])
      const stale = await publish(movedOn, [ID])
      expect
        .soft(
          [stale.exit, stale.out.at(-1), stale.calls],
          '(g4) after staging moved: approval-missing, hook 0',
        )
        .toEqual([1, `publish: stopped: approval-missing ${ID}`, []])
      expectPublishSafe(movedOn, null)
      const productionSeq = pointed(movedOn, 'production')!.seq
      const redeploy = await publish(movedOn, ['--snapshot', String(productionSeq)])
      expect
        .soft(
          [redeploy.exit, objectPosts(movedOn).length, redeploy.calls, redeploy.out.at(-1)],
          '(g4) --snapshot <production seq>: zero POSTs, one hook, live',
        )
        .toEqual([0, 0, ['hook', `verify ${productionSeq}`], `publish: live seq=${productionSeq}`])
      expectPublishSafe(movedOn, null)
      // g2's re-run is checked last, so a re-run that writes cannot stop g3 and g4 before they
      // run; nothing publishes to `dropped` after it, so the mark and the checked requests match.
      expectPublishSafe(dropped, null)
    },
  )

  it(
    'T15A-47 the production pointer protocol: a stage racing the publish ends it in exit 3 or 4 with no hook (A12, L11)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const control = await prepared([two])
      const plain = await publish(control, [ID])
      expect
        .soft([plain.exit, plain.calls.length], '(g1) without the race the pointer moves')
        .toEqual([0, 2])
      expectPublishSafe(control, 2)
      const early = await prepared([two])
      const pointer = early.object('content', 'catalogue/staging.json')!.bytes
      const r1 = await publish(early, [ID], {
        before: (url, init) => {
          if (isPost(init, url, snapshotWrite(2))) {
            early.put(
              'content',
              'catalogue/staging.json',
              new TextEncoder().encode(`${decode(pointer)} `),
              'application/json',
            )
          }
        },
      })
      expect
        .soft([r1.exit, r1.out.at(-1), r1.calls], '(g1) staging moved before the pre-check')
        .toEqual([3, 'publish: stopped: concurrent-writer', []])
      expectPublishSafe(early, 2)
      const late = await prepared([two])
      const latePointer = late.object('content', 'catalogue/staging.json')!.bytes
      const r2 = await publish(late, [ID], {
        after: (url, init) => {
          if (isPost(init, url, PRODUCTION_WRITE)) {
            late.put(
              'content',
              'catalogue/staging.json',
              new TextEncoder().encode(`${decode(latePointer)} `),
              'application/json',
            )
          }
        },
      })
      expect
        .soft([r2.exit, r2.out.at(-1), r2.calls], '(g2) staging moved after our write')
        .toEqual([4, 'publish: stopped: pointer-raced re-run publish', []])
      expectPublishSafe(late, 2)
      const higher = await prepared([two])
      const r3 = await publish(higher, [ID], {
        before: (url, init) => {
          if (isPost(init, url, snapshotWrite(2))) {
            higher.put(
              'content',
              'catalogue/snapshots/3.json',
              new TextEncoder().encode('{}'),
              'application/json',
            )
          }
        },
      })
      expect
        .soft([r3.exit, r3.out.at(-1), r3.calls], '(g3) a snapshot 3 listed before the pre-check')
        .toEqual([3, 'publish: stopped: concurrent-writer', []])
      expectPublishSafe(higher, 2)
    },
  )

  it(
    'T15A-48 dry run: every plan read on the read-only port, zero object POSTs, no hook or verify, report mode dry-run, exits 0 to 2 (A16, L15)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await prepared([two])
      const dry = await publish(stub, [ID, '--dry-run'])
      expect
        .soft(
          [dry.exit, dry.out.at(-1), objectPosts(stub).length, dry.calls, dry.report?.mode],
          '(g1) the plan lines, zero POSTs, no hook or verify, mode dry-run',
        )
        .toEqual([
          0,
          'publish: plan kind=publish seq=2 stories=1 production=none staging=1 featured=none from=none',
          0,
          [],
          'dry-run',
        ])
      expectPublishSafe(stub, null)
      expect((await publish(stub, [ID])).exit, 'precondition: the real publish').toBe(0)
      const unchanged = await publish(stub, [ID, '--dry-run'])
      expect
        .soft(
          [unchanged.exit, unchanged.out.at(-1)?.includes(' seq=none '), unchanged.calls],
          '(g1) an unchanged dry run: seq=none',
        )
        .toEqual([0, true, []])
      expectPublishSafe(stub, null)
      const refused = await publish(stub, [RIVER, '--dry-run'])
      expect.soft(refused.exit, '(g2) a dry-run refusal: exit 1').toBe(1)
      expectPublishSafe(stub, null)
    },
  )

  it(
    'T15A-49 PublishPort and its run-time predicate: no masters POST, no staging pointer POST, at most two snapshot POSTs and one production POST (A19, L19)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await prepared([two])
      const planted = await publish(stub, [ID], {
        after: async (url, init) => {
          if (isPost(init, url, PRODUCTION_WRITE)) {
            await globalThis.fetch(new URL(STAGING_WRITE, stub.origin), {
              method: 'POST',
              headers: {
                apikey: FAKE_KEY,
                authorization: `Bearer ${FAKE_KEY}`,
                'content-type': 'application/json',
              },
              body: '{}',
            })
          }
        },
      })
      expect(planted.exit, 'precondition: the planted run ends').toBeTypeOf('number')
      expect.soft(() => expectPublishSafe(stub, 2), '(g1) a staging pointer POST').toThrow(/A19/)
      expect
        .soft(typeof publishPortTypeSamples, '(g2) the type-only samples compile, never called')
        .toBe('function')
    },
  )

  it(
    'T15A-50 publish reports: report-unwritten keeps the run exit after a write or a hook call, else exit 2; the report goes to the checked real dir, and a real dir replaced mid-run is refused (A20, A23, D15-19, CRIT-13)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await prepared([two], [two], [[ID]])
      const file = join(root, 'a-file')
      writeFileSync(file, 'not a folder')
      const r1 = await publish(stub, [ID], { reportDir: file })
      expect
        .soft(
          [r1.exit, r1.err, objectPosts(stub).length, r1.calls.length],
          '(g1) unchanged, one hook, the report dir a file',
        )
        .toEqual([0, ['publish: report-unwritten'], 0, 2])
      expectPublishSafe(stub, null)
      const r2 = await publish(stub, [RIVER], { reportDir: file })
      expect.soft(r2.exit, '(g2) a plan stop, the report dir a file: exit 2').toBe(2)
      expectPublishSafe(stub, null)

      const publicDir = join(root, 'public')
      const a = join(root, 'a')
      const link = join(root, 'link')
      mkdirSync(a)
      symlinkSync(a, link, 'junction')
      let retargeted = 0
      const r3 = await publish(stub, [ID], {
        reportDir: join(link, 'reports'),
        hook: async () => {
          rmSync(link, { force: true })
          symlinkSync(publicDir, link, 'junction')
          retargeted += 1
          return 'triggered'
        },
      })
      expect(retargeted, 'precondition: the link was retargeted in the tail').toBe(1)
      expect
        .soft(
          [r3.exit, existsSync(join(a, 'reports', 'publisher-publish.json'))],
          '(g3) the report under <tmp>/a/reports',
        )
        .toEqual([0, true])
      expect.soft(publisherUnder(publicDir), '(g3) nothing under public').toEqual([])
      expectPublishSafe(stub, null)
      const out = join(root, 'out')
      mkdirSync(out)
      let moved = 0
      const r4 = await publish(stub, [ID], {
        reportDir: join(out, 'reports'),
        hook: async () => {
          renameSync(out, join(root, 'out-away'))
          symlinkSync(publicDir, out, 'junction')
          moved += 1
          return 'triggered'
        },
      })
      expect(moved, 'precondition: the real dir was replaced in the tail').toBe(1)
      expect
        .soft([r4.exit, r4.err], '(g4) the refused line and report-unwritten, exit 0')
        .toEqual([0, [formatReportDirRefused('publish'), 'publish: report-unwritten']])
      expect.soft(publisherUnder(publicDir), '(g4) no publisher-* file under public').toEqual([])
      expectPublishSafe(stub, null)
    },
  )

  it(
    'T15A-51 privacy: no record body, answer or private waiver field in any channel (A25, L20)',
    TIMEOUT,
    async () => {
      const base = await storyOf()
      const river = await storyOf(RIVER)
      const lanternBase = await storyOf('lantern-walk')
      const privateFields = {
        basis: 'S15ACANARYbasis',
        notes: ['S15ACANARYnote'],
        recordedBy: 'S15ACANARYby',
      }
      const waiverBytes = waiverBytesOf({ ...waiverFileOf(ID), ...privateFields })
      const two: TestStory = { ...base, waiverBytes, waiverSha256: await sha256Hex(waiverBytes) }
      // lantern-walk's file holds the canary fields too: the waiver-keys-differ run reads it (SEC-4).
      const lanternWaiver = waiverBytesOf({ ...waiverFileOf('lantern-walk'), ...privateFields })
      const lantern: TestStory = {
        ...lanternBase,
        waiverBytes: lanternWaiver,
        waiverSha256: await sha256Hex(lanternWaiver),
      }
      const canary = {
        'narration-check': 'S15ACANARYnarration',
        devices: 'S15ACANARYdevice, laptop',
      }
      const stub = await newStub()
      await stageIn(stub, [two, river, lantern])
      await approveIn(stub, two, canary)
      await approveIn(stub, river, canary)
      await approveIn(stub, lantern, canary)
      const runs: Published[] = []
      runs.push(await publish(stub, [ID]))
      expect(runs[0]?.exit, 'precondition: the live run').toBe(0)
      const bodies = [...since(stub)]
      const riverRecord = (
        await approvalRecordOf(river, {
          on: '2026-11-21',
          review: {
            narrationCheck: 'S15ACANARYnarration',
            devices: ['S15ACANARYdevice', 'laptop'],
          },
        })
      ).bytes
      stub.put(
        'masters',
        `approvals/${RIVER}/${river.packageSha256}.json`,
        jcsBytes({ ...(JSON.parse(decode(riverRecord)) as object), S15ACANARYkey: 1 }),
        'application/json',
      )
      runs.push(await publish(stub, [RIVER]))
      expect(runs[1]?.out.at(-1), 'precondition: approval-invalid').toBe(
        `publish: stopped: approval-invalid ${RIVER}`,
      )
      bodies.push(...since(stub))
      const staged = pointed(stub, 'staging')!.snapshot.stories
      const lanternEntry = staged.find((e) => e.storyId === 'lantern-walk')!
      await putDocuments(stub, 'staging', 9, [
        ...staged.filter((e) => e.storyId !== 'lantern-walk'),
        {
          ...lanternEntry,
          waivers: {
            ...lanternEntry.waivers!,
            keys: [
              {
                checkId: 'T001',
                nodeId: lantern.pkg.nodes[0]!.id,
                locale: 'en',
                nodeTextSha256: 'a'.repeat(64),
              },
            ],
          },
        },
      ])
      runs.push(await publish(stub, ['lantern-walk']))
      expect(runs[2]?.out.at(-1), 'precondition: waiver-keys-differ').toBe(
        'publish: stopped: waiver-keys-differ lantern-walk',
      )
      expect(
        since(stub).some(
          (r) =>
            r.method === 'GET' &&
            r.pathname.endsWith(`/masters/waivers/lantern-walk/${lantern.waiverSha256}.json`),
        ),
        "precondition: the waiver-keys-differ run read lantern-walk's canary waiver file",
      ).toBe(true)
      bodies.push(...since(stub))
      const text = [
        ...runs.flatMap((r) => [...r.out, ...r.err, JSON.stringify(r.report), r.md]),
        ...bodies
          .filter((r) => r.method === 'POST')
          .map((r) => Buffer.from(r.body).toString('latin1')),
      ].join('\n')
      expect
        .soft(
          text.includes('S15ACANARY'),
          '(g1) no canary in stdout, stderr, reports or POST bodies',
        )
        .toBe(false)
      expectPublishSafe(stub, null)
    },
  )
})

/** Type-only samples (T15A-49 g2): never called; checked by corepack pnpm typecheck. */
function publishPortTypeSamples(client: StorageClient, bytes: Uint8Array): void {
  // The CLI's `const port: PublishPort = client` compiles.
  const port: PublishPort = client
  // @ts-expect-error a PublishPort cannot create an approval
  void port.create({ kind: 'approval', storyId: 'a-b', packageSha256: 'a'.repeat(64) }, bytes)
  // @ts-expect-error a PublishPort cannot create a package
  void port.create({ kind: 'package', storyId: 'a-b', packageSha256: 'a'.repeat(64) }, bytes)
  void port.create(
    // @ts-expect-error a PublishPort cannot create a media object
    { kind: 'media', storyId: 'a-b', sha256: 'a'.repeat(64), variant: 'w768', mime: 'image/webp' },
    bytes,
  )
  // @ts-expect-error a PublishPort cannot write the staging pointer
  void port.writePointer('staging', bytes)
}
