// Step 15a (P1-8d part a) approve.ts: runApprove's plan, the --package binding, both answer
// channels, the dry run, the create with its one read-back and the reports (design
// migration-input/p1-step15a-design.md §4.1, D15-1 to D15-5, D15-14, D15-18, D15-22, D15-27, CRIT-1,
// CRIT-5, TP-7, TP-8; test plan §14.9: T15A-30 to T15A-37).
// Every Storage call goes to the loopback stub through a real client built in the test with a fake
// key assembled at run time; a loopback guard on the global fetch refuses and counts any other host.
// Staging is seeded by a real runStage (or, for refusal cases, documents built with the catalogue
// builders and stored with stub.put). Every test ends with expectApproveSafe (TP-8): after the mark
// set once staging is seeded, object POSTs only to one approval path, at most `maxCreates`, then
// expectNoUnexpected. Temp roots under the OS temp folder are the storyboardRoot and the report dir.
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
import { expectedPackagePath } from '../../src/core/content/gates'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import type { CatalogueSnapshot } from '../../src/core/package/catalogue'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { parseArgs } from './args'
import { runApprove, type ApproveAnswers } from './approve'
import { buildProductionDocuments, buildStagingDocuments } from './catalogue-state'
import { Secret } from './env'
import type { ApprovePort } from './port'
import { formatReportDirRefused } from './report'
import { runStage } from './stage'
import {
  answersOf,
  approvalRecordOf,
  buildTestStories,
  fullyBoundStory,
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
const FAKE_KEY = ['sb', 'secret', 'fake-approve-test-key'].join('_')
const NOW = '2026-11-21T20:00:00.000Z'
const ID = 'two-paths'
const LIST_PATH = '/storage/v1/object/list/content'
const READ = '/storage/v1/object/authenticated/'
const CREATE = '/storage/v1/object/'
const MISSING_BODY = '{"statusCode":"404","error":"not_found","message":"Object not found"}'
const TIMEOUT = { timeout: 90_000 }
const RULESET = PANCHATANTRA_RULESET
const NEXT_MAJOR = RULESET.ref.replace(/@(\d+)/, (_whole, major: string) => `@${Number(major) + 1}`)
const approvalPath = (story: Pick<TestStory, 'storyId' | 'packageSha256'>) =>
  `approvals/${story.storyId}/${story.packageSha256}.json`
const approvalRead = (story: Pick<TestStory, 'storyId' | 'packageSha256'>) =>
  `${READ}masters/${approvalPath(story)}`
const approvalWrite = (story: Pick<TestStory, 'storyId' | 'packageSha256'>) =>
  `${CREATE}masters/${approvalPath(story)}`
const sha12 = (sha: string) => sha.slice(0, 12)

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
  root = mkdtempSync(join(tmpdir(), 's15a-ap-'))
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

/** The request index from which expectApproveSafe and the class logs read. */
const mark = (stub: StorageStub) => void marks.set(stub, stub.requests.length)
const since = (stub: StorageStub) => stub.requests.slice(marks.get(stub) ?? 0)
const isObjectPost = (r: StubLogEntry) => r.method === 'POST' && r.pathname !== LIST_PATH
const objectPosts = (stub: StorageStub) => since(stub).filter(isObjectPost)

type LogLike = Pick<StorageStub, 'requests' | 'unexpected'>
/**
 * TP-8 (A19): after the mark, object POSTs only to one masters approval path, at most
 * `maxCreates`; list POSTs allowed; then expectNoUnexpected.
 */
function expectApproveSafe(stub: LogLike, maxCreates: number): void {
  const from = marks.get(stub as StorageStub) ?? 0
  const posts = stub.requests.slice(from).filter(isObjectPost)
  const approvals = posts.filter((r) => r.pathname.startsWith(`${CREATE}masters/approvals/`))
  if (approvals.length !== posts.length) throw new Error('A19: an object POST other than approval')
  if (new Set(approvals.map((r) => r.pathname)).size > 1) {
    throw new Error('A19: more than one approval path')
  }
  if (approvals.length > maxCreates) throw new Error(`A19: ${approvals.length} approval POSTs`)
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

/** A real stage of `stories` into the stub (masters waiver files seeded first); then the mark. */
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
  const client = createStorageClient({ supabaseUrl: stub.origin, secretKey: new Secret(FAKE_KEY) })
  const exit = await runStage(parsed, {
    storyboardRoot: root,
    platform: process.platform,
    now: () => new Date(NOW),
    sleep: async () => {},
    log: () => {},
    error: () => {},
    makePort: () => client,
  })
  if (exit !== 0) throw new Error(`test setup: stage exited ${exit}`)
  mark(stub)
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
/** The snapshot the stub's `mode` pointer names. */
function snapshotOf(stub: StorageStub, mode: 'staging' | 'production'): CatalogueSnapshot {
  const pointer = JSON.parse(decode(stub.object('content', `catalogue/${mode}.json`)!.bytes)) as {
    snapshotPath: string
  }
  return JSON.parse(
    decode(stub.object('content', pointer.snapshotPath)!.bytes),
  ) as CatalogueSnapshot
}

/** The entry without its waiver block. */
function withoutWaivers(entry: SnapshotEntry): SnapshotEntry {
  const copy = { ...entry }
  delete copy.waivers
  return copy
}

/** Stores snapshot `seq` and the `mode` pointer, built by the catalogue builders (refusal cases). */
async function putDocuments(
  stub: StorageStub,
  mode: 'staging' | 'production',
  seq: number,
  stories: readonly SnapshotEntry[],
): Promise<void> {
  const composition = { featuredStoryId: null, stories, note: 'test' }
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
  mark(stub)
}

type Before = (url: URL, init: RequestInit) => Promise<Response | void> | Response | void
function wrapFetch(before?: Before): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const answer = before ? await before(url, init ?? {}) : undefined
    if (answer instanceof Response) return answer
    return globalThis.fetch(input, init)
  }) as typeof fetch
}
const isPost = (init: RequestInit, url: URL, pathname: string) =>
  init.method === 'POST' && url.pathname === pathname
const bodyOf = (init: RequestInit) => new Uint8Array(init.body as Uint8Array)

interface ApproveOptions {
  readonly answers?: Record<string, string> | string
  readonly prompt?: readonly string[]
  readonly dryRun?: boolean
  readonly prefix?: string
  readonly reportDir?: string
  readonly clock?: ReturnType<typeof fakeClock>
  readonly before?: Before
  readonly events?: string[]
}

interface Approved {
  readonly exit: number
  readonly out: string[]
  readonly err: string[]
  readonly prompts: string[]
  readonly sleeps: number[]
  readonly made: number
  readonly report: Record<string, unknown> | null
  readonly md: string
}

/** One runApprove through a real client on the stub, stdin answers by default (answersOf). */
async function approve(
  stub: StorageStub,
  story: TestStory,
  options: ApproveOptions = {},
): Promise<Approved> {
  const out: string[] = []
  const err: string[] = []
  const prompts: string[] = []
  const sleeps: number[] = []
  const clock = options.clock ?? fakeClock()
  const dir = options.reportDir ?? reportDir()
  const events = options.events
  const before: Before | undefined =
    options.before || events
      ? async (url, init) => {
          events?.push(`request ${init.method ?? 'GET'} ${url.pathname}`)
          return options.before?.(url, init)
        }
      : undefined
  const client = createStorageClient({
    supabaseUrl: stub.origin,
    secretKey: new Secret(FAKE_KEY),
    ...(before ? { fetchImpl: wrapFetch(before) } : {}),
  })
  const argv = [
    'approve',
    story.storyId,
    '--package',
    options.prefix ?? sha12(story.packageSha256),
    '--report-dir',
    dir,
    ...(options.dryRun ? ['--dry-run'] : []),
    ...(options.prompt ? [] : ['--answers-stdin']),
  ]
  const parsed = parseArgs(argv, context())
  if (!parsed.ok || parsed.command !== 'approve') throw new Error('test setup: approve args')
  const text =
    typeof options.answers === 'string'
      ? options.answers
      : JSON.stringify(options.answers ?? answersOf(story))
  const answers: ApproveAnswers = options.prompt
    ? {
        kind: 'prompt',
        input: Readable.from([...options.prompt]),
        write: (line) => {
          events?.push('prompt')
          prompts.push(line)
        },
      }
    : { kind: 'stdin', input: Readable.from([text]), deadline: new Promise<void>(() => {}) }
  let made = 0
  const exit = await runApprove(parsed, {
    storyboardRoot: root,
    platform: process.platform,
    now: clock.now,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock.advance(ms)
    },
    log: (line) => void out.push(line),
    error: (line) => void err.push(line),
    runMode: 'pc',
    makePort: () => {
      made++
      const port: ApprovePort = client
      return port
    },
    answers,
  })
  const json = join(dir, 'publisher-approve.json')
  const md = join(dir, 'publisher-approve.md')
  return {
    exit,
    out,
    err,
    prompts,
    sleeps,
    made,
    report: existsSync(json)
      ? (JSON.parse(readFileSync(json, 'utf8')) as Record<string, unknown>)
      : null,
    md: existsSync(md) ? readFileSync(md, 'utf8') : '',
  }
}

/**
 * The request classes after the mark (T15A-30 g1, T15A-31 g3), consecutive repeats collapsed (the
 * catalogue/ listing also lists its snapshots/ folder).
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
    if (r.method === 'GET' && r.pathname.startsWith(`${READ}masters/approvals/`)) {
      return 'approval-read'
    }
    if (r.method === 'GET' && r.pathname.startsWith(`${READ}content/packages/`)) {
      return 'package-read'
    }
    if (r.method === 'GET' && r.pathname.startsWith(`${READ}masters/waivers/`)) return 'waiver-read'
    if (r.method === 'POST' && r.pathname.startsWith(`${CREATE}masters/approvals/`)) {
      return 'approval-create'
    }
    return `other ${r.method} ${r.pathname}`
  })
  return named.filter((name, index) => name !== named[index - 1])
}
const STATE_READS = ['catalogue-list', 'production-read', 'staging-read', 'snapshot-read']

/**
 * Every output of runs on a stub (§14.1 privacy): stdout, stderr, prompt text, both reports, and
 * every request body after the mark decoded as latin1, except masters approval POSTs, whose bodies
 * are returned apart (a precondition holds the canary there).
 */
function outputsOf(stub: StorageStub, runs: readonly Approved[]) {
  const approvalBodies: string[] = []
  const bodies: string[] = []
  for (const r of since(stub)) {
    const text = Buffer.from(r.body).toString('latin1')
    if (r.method === 'POST' && r.pathname.startsWith(`${CREATE}masters/approvals/`)) {
      approvalBodies.push(text)
    } else bodies.push(text)
  }
  const text = [
    ...runs.flatMap((run) => [...run.out, ...run.err, ...run.prompts]),
    ...runs.map((run) => `${JSON.stringify(run.report)}\n${run.md}`),
    ...bodies,
  ].join('\n')
  return { text, approvalBodies }
}

const encode = (text: string) => new TextEncoder().encode(text)
const pretty = (bytes: Uint8Array) => encode(JSON.stringify(JSON.parse(decode(bytes)), null, 2))
const withKey = (bytes: Uint8Array, key: string, value: unknown) =>
  jcsBytes({ ...(JSON.parse(decode(bytes)) as object), [key]: value })
const publisherUnder = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[]).filter((name) =>
    name.split(/[\\/]/).some((part) => part.startsWith('publisher-')),
  )

describe('approve', () => {
  it(
    'T15A-30 approve a staged story: the plan reads, the remote check without the approval step, the answers, one approval create and one read-back; exit 0 approved (A6, A7, A19, CRIT-1)',
    TIMEOUT,
    async () => {
      const [lantern, river, two] = await Promise.all(
        ['lantern-walk', 'river-stones', 'two-paths'].map((id) => storyOf(id)),
      )
      const bound = await fullyBoundStory(lantern!)
      const stub = await newStub()
      await stageIn(stub, [two!, river!, bound])
      expect(
        snapshotOf(stub, 'staging').stories.some((e) => e.storyId === ID),
        'precondition: staging holds two-paths',
      ).toBe(true)
      const run = await approve(stub, two!)
      expect(run.exit, 'precondition: approve exits 0').toBe(0)
      expect
        .soft(classes(stub), '(g1) the request classes after the stage, nothing else')
        .toEqual([
          'catalogue-list',
          'production-read',
          'staging-read',
          'snapshot-read',
          'approval-read',
          'package-read',
          'waiver-read',
          'packages-list',
          'media-list',
          'approval-create',
          'approval-read',
        ])
      expectApproveSafe(stub, 1)
      const expected = await approvalRecordOf(two!, { on: '2026-11-21' })
      const stored = stub.object('masters', approvalPath(two!))
      expect
        .soft(stored && decode(stored.bytes), '(g2) the stored bytes are the JCS of the record')
        .toBe(decode(expected.bytes))
      const day = async (story: TestStory, iso: string) => {
        mark(stub)
        const r = await approve(stub, story, { clock: fakeClock(iso) })
        expectApproveSafe(stub, 1)
        const bytes = stub.object('masters', approvalPath(story))?.bytes
        return {
          exit: r.exit,
          record: bytes ? (JSON.parse(decode(bytes)) as Record<string, unknown>) : null,
        }
      }
      const late = await day(river!, '2026-11-21T23:59:59.999Z')
      expect
        .soft([late.exit, late.record?.approvedOn], '(g2) 23:59:59.999Z records 2026-11-21')
        .toEqual([0, '2026-11-21'])
      const next = await day(bound, '2026-11-22T00:00:00.000Z')
      expect
        .soft([next.exit, next.record?.approvedOn], '(g2) 00:00:00.000Z records 2026-11-22')
        .toEqual([0, '2026-11-22'])
      expect
        .soft(
          (next.record?.review as { imagesViewed?: number } | undefined)?.imagesViewed,
          '(g2) the fully bound story records imagesViewed = its node count',
        )
        .toBe(bound.pkg.nodes.length)
      const waiverSha = snapshotOf(stub, 'staging').stories.find((e) => e.storyId === ID)!.waivers!
        .waiverFileSha256
      expect
        .soft(run.out, '(g3) stdout exactly the plan line and the record line')
        .toEqual([
          `approve: ${ID} package=${sha12(two!.packageSha256)} version=1 waivers=${sha12(waiverSha)} state=new`,
          `approve: record sha256=${sha12(expected.sha256)} created`,
        ])
      expect.soft(run.report?.approval, '(g3) the report approval section').toEqual({
        storyId: ID,
        packageSha256: two!.packageSha256,
        version: 1,
        waiverFileSha256: waiverSha,
        state: 'new',
        approvalSha256: expected.sha256,
      })

      // g4: the prompt channel on a fresh stub.
      const prompted = await newStub()
      await stageIn(prompted, [two!])
      const events: string[] = []
      const viaPrompt = await approve(prompted, two!, {
        prompt: ['en,hi\r\n', 'yes\r\n', '1\r\n', 'checked\r\n', 'phone, laptop\r\n', 'yes\r\n'],
        events,
      })
      expect(viaPrompt.exit, 'precondition: the prompt run exits 0').toBe(0)
      const firstPrompt = events.indexOf('prompt')
      const lastListing = events.reduce(
        (at, e, i) => (e === `request POST ${LIST_PATH}` ? i : at),
        -1,
      )
      const waiverAt = events.findIndex((e) => e.includes('/authenticated/masters/waivers/'))
      expect
        .soft(
          firstPrompt > lastListing && firstPrompt > waiverAt && waiverAt >= 0,
          '(g4) every prompt after the waiver GET and both lists',
        )
        .toBe(true)
      expect
        .soft(
          decode(prompted.object('masters', approvalPath(two!))?.bytes ?? new Uint8Array()),
          "(g4) the record equals the stdin channel's",
        )
        .toBe(decode(expected.bytes))
      expectApproveSafe(prompted, 1)
    },
  )

  it(
    'T15A-31 approve plan refusals before any masters write (A6, L3, CRIT-5)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf('river-stones')
      const stub = await newStub()
      await stageIn(stub, [two])
      for (const prefix of [sha12(two.packageSha256), two.packageSha256]) {
        mark(stub)
        const r = await approve(stub, two, { prefix, dryRun: true })
        expect
          .soft([r.exit, objectPosts(stub).length], `(g1) a ${prefix.length}-hex prefix passes`)
          .toEqual([0, 0])
        expectApproveSafe(stub, 0)
      }

      const empty = await newStub()
      mark(empty)
      const none = await approve(empty, two)
      expect
        .soft([none.exit, none.out.at(-1), none.report?.outcome], '(g2) no staging pointer')
        .toEqual([1, `approve: stopped: not-staged ${ID}`, 'not-staged'])
      expectApproveSafe(empty, 0)
      const other = await newStub()
      await stageIn(other, [river])
      const absent = await approve(other, two)
      expect
        .soft([absent.exit, absent.out.at(-1)], '(g2) an id not in staging')
        .toEqual([1, `approve: stopped: not-staged ${ID}`])
      expectApproveSafe(other, 0)

      mark(stub)
      const changed = await approve(stub, two, { prefix: sha12(river.packageSha256) })
      expect
        .soft([changed.exit, changed.out.at(-1), changed.report?.outcome], '(g3) another sha')
        .toEqual([
          1,
          `approve: stopped: approval-package-changed ${ID}`,
          'approval-package-changed',
        ])
      expect.soft(classes(stub), '(g3) the log ends at the state reads').toEqual(STATE_READS)
      expectApproveSafe(stub, 0)
      const v2 = await withPackage(two, { ...two.pkg, version: 2 } as StoryPackageV1)
      const moved = await newStub()
      await stageIn(moved, [two])
      await stageIn(moved, [v2])
      const stale = await approve(moved, two, { prefix: sha12(two.packageSha256) })
      expect
        .soft([stale.exit, stale.out.at(-1)], '(g3) a stage moved two-paths to v2 after the review')
        .toEqual([1, `approve: stopped: approval-package-changed ${ID}`])
      expectApproveSafe(moved, 0)

      const staged = snapshotOf(stub, 'staging').stories.find((e) => e.storyId === ID)!
      const published = await newStub()
      await stageIn(published, [two])
      await putDocuments(published, 'production', 2, [
        { ...staged, approvalSha256: 'e'.repeat(64) },
      ])
      const done = await approve(published, two)
      expect
        .soft([done.exit, done.report?.outcome], '(g4) production holds the approved package')
        .toEqual([0, 'already-published'])
      expect
        .soft(
          classes(published).every((c) => STATE_READS.includes(c)),
          '(g4) nothing read after the state',
        )
        .toBe(true)
      expectApproveSafe(published, 0)

      const approvedStaged = await newStub()
      await stageIn(approvedStaged, [two])
      await putDocuments(approvedStaged, 'staging', 2, [
        { ...staged, approvalSha256: 'e'.repeat(64) },
      ])
      const sup1 = await approve(approvedStaged, two)
      expect
        .soft([sup1.exit, sup1.out.at(-1)], '(g5) a staging entry carrying approvalSha256')
        .toEqual([1, `approve: stopped: staged-entry-superseded ${ID}`])
      expectApproveSafe(approvedStaged, 0)
      const higher = await newStub()
      await stageIn(higher, [two])
      const otherSha = 'f'.repeat(64)
      await putDocuments(higher, 'production', 2, [
        {
          ...staged,
          packageSha256: otherSha,
          packagePath: expectedPackagePath(
            { storyId: ID, packageSha256: otherSha },
            'production',
            '',
          ),
          approvalSha256: 'e'.repeat(64),
        },
      ])
      const sup2 = await approve(higher, two)
      expect
        .soft([sup2.exit, sup2.out.at(-1)], '(g5) production holds another package at v >= staged')
        .toEqual([1, `approve: stopped: staged-entry-superseded ${ID}`])
      expectApproveSafe(higher, 0)

      const noBlock = await newStub()
      await stageIn(noBlock, [two])
      const bare = withoutWaivers(staged)
      await putDocuments(noBlock, 'staging', 2, [bare])
      const invalid = await approve(noBlock, two)
      expect
        .soft([invalid.exit, invalid.out.at(-1)], '(g6) a staged migration entry without waivers')
        .toEqual([1, `approve: stopped: staged-entry-invalid ${ID}`])
      expectApproveSafe(noBlock, 0)
      const writer = await withPackage(two, { ...two.pkg, origin: 'writer_flow' } as StoryPackageV1)
      const flow = await newStub()
      await stageIn(flow, [two])
      const writerPath = expectedPackagePath(writer, 'staging', '')
      flow.put('content', writerPath, writer.packageBytes, 'application/json')
      await putDocuments(flow, 'staging', 2, [
        { ...bare, packageSha256: writer.packageSha256, packagePath: writerPath },
      ])
      const wf = await approve(flow, writer)
      expect
        .soft([wf.exit, wf.out.at(-1)], '(g6) a writer_flow package')
        .toEqual([1, `approve: stopped: approve-origin-not-migration ${ID}`])
      expectApproveSafe(flow, 0)
    },
  )

  it(
    'T15A-32 an existing record is read first: valid is already-approved with no write; invalid, other rule set, other waiver file and failed reads stop (A7, L4)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await newStub()
      await stageIn(stub, [two])
      const valid = await approvalRecordOf(two, { on: '2026-11-20' })
      const cases: [string, Uint8Array | null, number | null, number, string][] = [
        ['a valid record', valid.bytes, null, 0, 'already-approved'],
        ['a non-JCS record', pretty(valid.bytes), null, 1, 'approval-invalid'],
        [
          'ruleSetRef major + 1',
          withKey(valid.bytes, 'ruleSetRef', NEXT_MAJOR),
          null,
          1,
          'approval-rule-set',
        ],
        [
          'another waiversSha256',
          withKey(valid.bytes, 'waiversSha256', 'c'.repeat(64)),
          null,
          1,
          'approval-waiver-mismatch',
        ],
        ['a 401', valid.bytes, 401, 1, 'storage-unauthorized'],
        ['a 500', valid.bytes, 500, 1, 'storage-failed'],
      ]
      for (const [label, record, status, exit, outcome] of cases) {
        if (record !== null) stub.put('masters', approvalPath(two), record, 'application/json')
        if (status !== null) {
          stub.override('GET', approvalRead(two), {
            kind: 'answer',
            status,
            body: JSON.stringify({ statusCode: String(status), error: 'x' }),
          })
        }
        mark(stub)
        const r = await approve(stub, two)
        expect.soft([r.exit, r.report?.outcome], `(g1) ${label}`).toEqual([exit, outcome])
        expect.soft(objectPosts(stub).length, `(g1) ${label}: zero object POSTs`).toBe(0)
        if (label === 'a valid record') {
          expect
            .soft(r.out.at(-1), '(g1) the exists line')
            .toBe(`approve: record sha256=${sha12(valid.sha256)} exists`)
        }
        expectApproveSafe(stub, 0)
      }
    },
  )

  it(
    'T15A-33 create outcomes: a duplicate read back as ours is identical, another record approval-raced, any other read-back approval-unconfirmed; one retry on null or 5xx (A7, CRIT-1, L4)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const ours = await approvalRecordOf(two, { on: '2026-11-21' })

      const same = await newStub()
      await stageIn(same, [two])
      const identical = await approve(same, two, {
        before: (url, init) => {
          if (isPost(init, url, approvalWrite(two))) {
            same.put('masters', approvalPath(two), bodyOf(init), 'application/json')
          }
        },
      })
      expect
        .soft([identical.exit, identical.out.at(-1)], '(g1) our bytes stored first: identical')
        .toEqual([0, `approve: record sha256=${sha12(ours.sha256)} identical`])
      expectApproveSafe(same, 1)

      const raced = await newStub()
      await stageIn(raced, [two])
      const theirs = await approvalRecordOf(two, { on: '2026-11-20' })
      const lost = await approve(raced, two, {
        before: (url, init) => {
          if (isPost(init, url, approvalWrite(two))) {
            raced.put('masters', approvalPath(two), theirs.bytes, 'application/json')
          }
        },
      })
      expect
        .soft([lost.exit, lost.out.at(-1)], '(g2) another record stored first: approval-raced')
        .toEqual([3, `approve: stopped: approval-raced ${ID}`])
      const rerun = await approve(raced, two)
      expect
        .soft([rerun.exit, rerun.report?.outcome], '(g2) the re-run: already-approved')
        .toEqual([0, 'already-approved'])
      expectApproveSafe(raced, 1)

      const hidden = await newStub()
      await stageIn(hidden, [two])
      const unconfirmed = await approve(hidden, two, {
        before: (url, init) => {
          if (isPost(init, url, approvalWrite(two))) {
            hidden.override('GET', approvalRead(two), {
              kind: 'answer',
              status: 400,
              body: MISSING_BODY,
            })
          }
        },
      })
      expect
        .soft([unconfirmed.exit, unconfirmed.out.at(-1)], '(g3) a read-back not found')
        .toEqual([3, `approve: stopped: approval-unconfirmed ${ID}`])
      const again = await approve(hidden, two)
      expect
        .soft([again.exit, again.report?.outcome], '(g3) the re-run: already-approved')
        .toEqual([0, 'already-approved'])
      expectApproveSafe(hidden, 1)

      const retried = await newStub()
      await stageIn(retried, [two])
      retried.override('POST', approvalWrite(two), {
        kind: 'answer',
        status: 500,
        body: '{"statusCode":"500","error":"internal"}',
      })
      const second = await approve(retried, two)
      expect
        .soft([second.exit, second.sleeps, objectPosts(retried).length], '(g4) a 500 then created')
        .toEqual([0, [1000], 2])
      expectApproveSafe(retried, 2)
      for (const [status, code] of [
        [400, 'upload-failed'],
        [401, 'storage-unauthorized'],
      ] as const) {
        const stub = await newStub()
        await stageIn(stub, [two])
        stub.override('POST', approvalWrite(two), {
          kind: 'answer',
          status,
          body: JSON.stringify({ statusCode: String(status), error: 'x' }),
        })
        const r = await approve(stub, two)
        expect
          .soft([r.exit, r.out.at(-1), objectPosts(stub).length], `(g4) a ${status}`)
          .toEqual([3, `approve: stopped: ${code} ${ID}`, 1])
        expectApproveSafe(stub, 1)
      }
    },
  )

  it(
    'T15A-34 approve --dry-run reads, checks and builds the record and writes nothing; the planned sha equals the real run (A16, D15-14)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await newStub()
      await stageIn(stub, [two])
      const dry = await approve(stub, two, { dryRun: true })
      const planned = (dry.report?.approval as { approvalSha256?: string } | undefined)
        ?.approvalSha256
      expect(planned, 'precondition: the dry run reports a planned sha').toMatch(/^[0-9a-f]{64}$/)
      expect
        .soft(
          [dry.exit, objectPosts(stub).length, dry.out.at(-1), dry.report?.mode],
          '(g1) zero object POSTs, planned, mode dry-run, exit 0',
        )
        .toEqual([0, 0, `approve: record sha256=${sha12(planned!)} planned`, 'dry-run'])
      const real = await approve(stub, two)
      const stored = stub.object('masters', approvalPath(two))
      expect
        .soft(real.out.at(-1), '(g2) the real run prints created with the same sha12')
        .toBe(`approve: record sha256=${sha12(planned!)} created`)
      expect
        .soft(
          stored && (await sha256Hex(new Uint8Array(stored.bytes))),
          "(g2) the stored bytes hash to the dry run's approvalSha256",
        )
        .toBe(planned)
      const river = await storyOf('river-stones')
      const refused = await approve(stub, river, { dryRun: true })
      expect.soft(refused.exit, '(g3) a dry-run refusal (not-staged) is exit 1').toBe(1)
      expect
        .soft(
          [dry.exit, refused.exit].every((e) => e <= 2),
          '(g3) dry runs never end 3 or 4',
        )
        .toBe(true)
      expectApproveSafe(stub, 1)
    },
  )

  it(
    'T15A-35 the answers through runApprove: stdin refusals stop before any request; an early prompt end, an incomplete review and a review text with an unpaired surrogate stop before any write; refusal lines name the key only (A5, L2, L20)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await newStub()
      await stageIn(stub, [two])
      const seventh = await approve(stub, two, { answers: { ...answersOf(two), x: 'y' } })
      expect
        .soft(
          [seventh.exit, seventh.out, since(stub).length, seventh.made],
          '(g1) a seventh key: exit 1, the stop line, no request, no client',
        )
        .toEqual([1, ['approve: stopped: answers-invalid'], 0, 0])
      const early = await approve(stub, two, {
        prompt: ['en,hi\n', 'yes\n', '1\n', 'checked\n', 'phone\n'],
      })
      expect
        .soft([early.exit, early.report?.outcome, objectPosts(stub).length], '(g2) five lines')
        .toEqual([1, 'answers-missing', 0])
      const no = await approve(stub, two, { answers: answersOf(two, { 'all-nodes-read': 'no' }) })
      expect
        .soft(
          [no.exit, no.report?.outcome, objectPosts(stub).length],
          '(g3) all-nodes-read no: approval-review-incomplete, zero POSTs',
        )
        .toEqual([1, 'approval-review-incomplete', 0])
      expect
        .soft(no.out, '(g3) the refused line names the key')
        .toContain('approve: answer all-nodes-read refused')
      // A narration-check holding an unpaired surrogate: valid JSON (the \ud800 escape) and valid
      // UTF-8 on stdin, refused by the review's form rule, never an internal stop (S15A-R1-SEC-1).
      const loneAnswers = answersOf(two, { 'narration-check': 'ok\uD800' })
      expect(
        JSON.stringify(loneAnswers).includes('ok\\ud800'),
        'precondition: the stdin text carries the JSON escape of an unpaired surrogate',
      ).toBe(true)
      const lone = await approve(stub, two, { answers: loneAnswers })
      expect
        .soft(
          [lone.exit, lone.report?.outcome, lone.out, objectPosts(stub).length],
          '(g5) an unpaired surrogate in narration-check: answers-invalid naming the key, zero POSTs',
        )
        .toEqual([
          1,
          'answers-invalid',
          ['approve: answer narration-check refused', 'approve: stopped: answers-invalid'],
          0,
        ])
      expectApproveSafe(stub, 0)

      const canary = {
        'narration-check': 'S15ACANARYnarration',
        devices: 'S15ACANARYdevice, laptop',
      }
      const runs = [
        await approve(stub, two, {
          answers: answersOf(two, { ...canary, 'all-nodes-read': 'no' }),
        }),
        await approve(stub, two, { answers: { ...answersOf(two, canary), x: 'S15ACANARYx' } }),
        await approve(stub, two, {
          answers: answersOf(two, { ...canary, 'narration-check': 'S15ACANARYnarration‮' }),
        }),
        await approve(stub, two, { answers: answersOf(two, canary) }),
      ]
      const { text, approvalBodies } = outputsOf(stub, runs)
      expect(
        runs.at(-1)?.exit === 0 && approvalBodies.some((body) => body.includes('S15ACANARY')),
        'precondition: the canary answers reached the approval POST body',
      ).toBe(true)
      expect.soft(text.includes('S15ACANARY'), '(g4) no canary in any other output').toBe(false)
      expectApproveSafe(stub, 1)
    },
  )

  it(
    'T15A-36 ApprovePort: approve sends only the approval POST and list POSTs; a forbidden create does not compile (A19, L19)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await newStub()
      await stageIn(stub, [two])
      const ok = await approve(stub, two)
      expect(ok.exit, 'precondition: the approved run exits 0').toBe(0)
      expect.soft(() => expectApproveSafe(stub, 1), '(g1) an approved run').not.toThrow()
      const retried = await newStub()
      await stageIn(retried, [two])
      retried.override('POST', approvalWrite(two), {
        kind: 'answer',
        status: 500,
        body: '{"statusCode":"500","error":"internal"}',
      })
      expect((await approve(retried, two)).exit, 'precondition: the retried run exits 0').toBe(0)
      expect
        .soft(() => expectApproveSafe(retried, 2), '(g1) a first create answered 500')
        .not.toThrow()

      // g2: one more content POST (an authorised request the wrapper adds) is caught.
      const extra = await newStub()
      await stageIn(extra, [two])
      const planted = await approve(extra, two, {
        before: async (url, init) => {
          if (isPost(init, url, approvalWrite(two))) {
            await globalThis.fetch(
              new URL('/storage/v1/object/content/extra/x.json', extra.origin),
              {
                method: 'POST',
                headers: {
                  apikey: FAKE_KEY,
                  authorization: `Bearer ${FAKE_KEY}`,
                  'content-type': 'application/json',
                },
                body: '{}',
              },
            )
          }
        },
      })
      expect(planted.exit, 'precondition: the planted run exits 0').toBe(0)
      expect.soft(() => expectApproveSafe(extra, 1), '(g2) one more content POST').toThrow(/A19/)
      expect
        .soft(typeof approvePortTypeSamples, '(g3) the type-only samples compile, never called')
        .toBe('function')
    },
  )

  it(
    'T15A-37 approve reports: publisher-approve on every exit once the plan started, never an answer; the report goes to the checked real dir, and a real dir replaced mid-run is report-unwritten with the refused line (A20, A23, CRIT-13)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const ours = await approvalRecordOf(two, { on: '2026-11-21' })
      const stub = await newStub()
      await stageIn(stub, [two])
      const staged = snapshotOf(stub, 'staging').stories.find((e) => e.storyId === ID)!
      const known = {
        storyId: ID,
        packageSha256: two.packageSha256,
        version: 1,
        waiverFileSha256: staged.waivers!.waiverFileSha256,
        state: 'new',
        approvalSha256: ours.sha256,
      }
      const ok = await approve(stub, two)
      expect
        .soft([ok.report?.outcome, ok.report?.exitCode, ok.report?.approval], '(g1) approved')
        .toEqual(['approved', 0, known])
      const empty = await newStub()
      mark(empty)
      const none = await approve(empty, two)
      expect
        .soft(
          [none.report?.outcome, none.report?.exitCode, none.report?.approval],
          '(g1) not-staged',
        )
        .toEqual([
          'not-staged',
          1,
          {
            storyId: ID,
            packageSha256: null,
            version: null,
            waiverFileSha256: null,
            state: null,
            approvalSha256: null,
          },
        ])
      const raced = await newStub()
      await stageIn(raced, [two])
      const theirs = await approvalRecordOf(two, { on: '2026-11-20' })
      const lost = await approve(raced, two, {
        before: (url, init) => {
          if (isPost(init, url, approvalWrite(two))) {
            raced.put('masters', approvalPath(two), theirs.bytes, 'application/json')
          }
        },
      })
      expect
        .soft([lost.report?.outcome, lost.report?.exitCode, lost.report?.approval], '(g1) raced')
        .toEqual(['approval-raced', 3, known])
      for (const run of [ok, none, lost]) {
        expect.soft(JSON.stringify(run.report).includes('checked'), '(g1) no answer').toBe(false)
      }

      const publicDir = join(root, 'public')
      const a = join(root, 'a')
      const link = join(root, 'link')
      mkdirSync(a)
      symlinkSync(a, link, 'junction')
      const viaLink = await newStub()
      await stageIn(viaLink, [two])
      let retargeted = 0
      const g2 = await approve(viaLink, two, {
        reportDir: join(link, 'reports'),
        before: (url, init) => {
          if (isPost(init, url, approvalWrite(two)) && retargeted === 0) {
            rmSync(link, { force: true })
            symlinkSync(publicDir, link, 'junction')
            retargeted += 1
          }
        },
      })
      expect(retargeted, 'precondition: the link was retargeted mid-run').toBe(1)
      expect
        .soft(
          [g2.exit, existsSync(join(a, 'reports', 'publisher-approve.json'))],
          '(g2) the report under <tmp>/a/reports, exit 0',
        )
        .toEqual([0, true])
      expect.soft(publisherUnder(publicDir), '(g2) nothing under public').toEqual([])
      expectApproveSafe(viaLink, 1)

      const out = join(root, 'out')
      mkdirSync(out)
      const replaced = await newStub()
      await stageIn(replaced, [two])
      let moved = 0
      const g3 = await approve(replaced, two, {
        reportDir: join(out, 'reports'),
        before: (url, init) => {
          if (isPost(init, url, approvalWrite(two)) && moved === 0) {
            renameSync(out, join(root, 'out-away'))
            symlinkSync(publicDir, out, 'junction')
            moved += 1
          }
        },
      })
      expect(moved, 'precondition: the real dir was replaced mid-run').toBe(1)
      expect.soft(g3.exit, '(g3) exit 0 (a write happened)').toBe(0)
      expect
        .soft(g3.err, '(g3) the refused line, then report-unwritten')
        .toEqual([formatReportDirRefused('approve'), 'approve: report-unwritten'])
      expect.soft(publisherUnder(publicDir), '(g3) no publisher-* file under public').toEqual([])
      expectApproveSafe(replaced, 1)

      const file = join(root, 'a-file')
      writeFileSync(file, 'not a folder')
      const blocked = await newStub()
      mark(blocked)
      const g4 = await approve(blocked, two, { reportDir: file })
      expect.soft(g4.exit, '(g4) a refusal before any write, the report dir a file: exit 2').toBe(2)
      expectApproveSafe(blocked, 0)
      expectApproveSafe(stub, 1)
    },
  )
})

/** Type-only samples (T15A-36 g3): never called; checked by corepack pnpm typecheck. */
function approvePortTypeSamples(client: StorageClient, bytes: Uint8Array): void {
  // The CLI's `const port: ApprovePort = client` compiles.
  const port: ApprovePort = client
  // @ts-expect-error an ApprovePort cannot create a snapshot
  void port.create({ kind: 'snapshot', seq: 1 }, bytes)
  // @ts-expect-error an ApprovePort cannot create a package
  void port.create({ kind: 'package', storyId: 'a-b', packageSha256: 'a'.repeat(64) }, bytes)
  void port.create(
    // @ts-expect-error an ApprovePort cannot create a media object
    { kind: 'media', storyId: 'a-b', sha256: 'a'.repeat(64), variant: 'w768', mime: 'image/webp' },
    bytes,
  )
  // @ts-expect-error an ApprovePort has no pointer write
  void port.writePointer('staging', bytes)
}
