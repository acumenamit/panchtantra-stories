// Step 15b (P1-8d part b) verify-command.ts: `verify [--deep]` through runVerify (design
// migration-input/p1-step15b-design.md §3.19, §3.20, §4.6, §4.7, D15B-18 to D15B-20; test plan
// §14.12: T15B-46 to T15B-49).
// Every Storage call goes to the loopback stub through a real client built in the test with a fake
// key assembled at run time, held read-only. verify and the public reads are fakes that record their
// calls (`verify <seq>`, `landing <id> <locale>`, `object <path>`, `range <path>`); nothing reaches a
// site. A loopback guard on the global fetch refuses and counts any other host. The seed is a real
// stage, approve and publish of two-paths and river-stones (production seq 2, staging seq 1); the
// verify fake answers live seq 2 with the production snapshot's sha unless a group says otherwise.
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planMediaHeads } from '../../src/core/content/media'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { sha256Hex } from '../../src/core/hashing'
import type { CatalogueSnapshot } from '../../src/core/package/catalogue'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { parseArgs } from './args'
import { runApprove } from './approve'
import { buildProductionDocuments } from './catalogue-state'
import { Secret } from './env'
import type {
  LandingAnswer,
  ListResult,
  LiveBuild,
  ObjectAnswer,
  PublishPort,
  RangeAnswer,
  RangeTarget,
  StorageReader,
  VerifySite,
} from './port'
import { runPublish } from './publish'
import { formatVerifyTimeoutHint } from './report'
import { runStage } from './stage'
import {
  answersOf,
  approvalRecordOf,
  buildTestStories,
  waiverBytesOf,
  waiverFileOf,
  withPackage,
  writeStageInputs,
  type TestMedia,
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
import { runVerify, type VerifyCommandAnswer } from './verify-command'

// ---- shared material ----

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-verify-command-key'].join('_')
const NOW = '2026-11-22T14:00:00.000Z'
const ID = 'two-paths'
const RIVER = 'river-stones'
const LIST_PATH = '/storage/v1/object/list/content'
const READ = '/storage/v1/object/authenticated/'
const TIMEOUT = { timeout: 240_000 }
const sha12 = (sha: string) => sha.slice(0, 12)
const encode = (text: string) => new TextEncoder().encode(text)
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

async function newStub(): Promise<StorageStub> {
  const stub = await startStorageStub({ apikey: FAKE_KEY })
  stubs.push(stub)
  return stub
}
const mark = (stub: StorageStub) => void marks.set(stub, stub.requests.length)
const since = (stub: StorageStub) => stub.requests.slice(marks.get(stub) ?? 0)
const isObjectPost = (r: StubLogEntry) => r.method === 'POST' && r.pathname !== LIST_PATH

let cached: Promise<TestStory[]> | null = null
const testStories = (): Promise<TestStory[]> => (cached ??= buildTestStories())
const storyOf = async (id = ID): Promise<TestStory> =>
  (await testStories()).find((story) => story.storyId === id)!
const context = () => ({ cwd: root, storyboardRoot: root, platform: process.platform })
const client = (stub: StorageStub): StorageClient =>
  createStorageClient({ supabaseUrl: stub.origin, secretKey: new Secret(FAKE_KEY) })

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
}

const notHere = (name: string) => (): never => {
  throw new Error(`test: ${name} is not for this publish`)
}
async function publishIn(stub: StorageStub, ids: readonly string[]): Promise<void> {
  const parsed = parseArgs(
    ['publish', ...ids, '--report-dir', join(root, 'publish-reports')],
    context(),
  )
  if (!parsed.ok || parsed.command !== 'publish') throw new Error('test setup: publish args')
  const port = client(stub)
  const exit = await runPublish(parsed, {
    storyboardRoot: root,
    platform: process.platform,
    now: () => new Date(NOW),
    sleep: async () => {},
    log: () => {},
    error: () => {},
    runMode: 'pc',
    makePort: () => {
      const writer: PublishPort = port
      return writer
    },
    makeUnpublishPort: notHere('makeUnpublishPort'),
    makeRemover: notHere('makeRemover'),
    realPath: notHere('realPath'),
    tail: {
      hook: async () => 'triggered',
      verify: async (seq) => ({ kind: 'live', seq }),
      range: async () => ({ kind: 'ok', start: 0, end: 0, size: 1 }),
    },
  })
  if (exit !== 0) throw new Error(`test setup: publish exited ${exit}`)
}

/** Stories staged, approved and published together (production seq 2, staging seq 1). */
async function seeded(stories: readonly TestStory[]): Promise<StorageStub> {
  const stub = await newStub()
  await stageIn(stub, stories)
  for (const story of stories) await approveIn(stub, story)
  await publishIn(
    stub,
    stories.map((s) => s.storyId),
  )
  return stub
}
const seed = async () => seeded([await storyOf(), await storyOf(RIVER)])

function pointed(stub: StorageStub, mode: 'staging' | 'production') {
  const bytes = stub.object('content', `catalogue/${mode}.json`)?.bytes
  if (bytes === undefined) return null
  const pointer = JSON.parse(decode(bytes)) as { seq: number; snapshotPath: string }
  const snapshotBytes = stub.object('content', pointer.snapshotPath)!.bytes
  const snapshot = JSON.parse(decode(snapshotBytes)) as CatalogueSnapshot
  return { seq: pointer.seq, snapshot, snapshotBytes }
}

/** The live build the production pointer names (every story, nothing excluded). */
async function liveBuild(stub: StorageStub): Promise<LiveBuild> {
  const production = pointed(stub, 'production')!
  return {
    snapshotSha256: await sha256Hex(new Uint8Array(production.snapshotBytes)),
    featuredStoryId: production.snapshot.featuredStoryId,
    stories: production.snapshot.stories.map((e) => ({
      storyId: e.storyId,
      version: e.version,
      packageSha256: e.packageSha256,
    })),
    excluded: [],
  }
}

async function putProduction(stub: StorageStub, seq: number, stories: readonly SnapshotEntry[]) {
  const built = await buildProductionDocuments(
    { featuredStoryId: null, stories, note: 'test' },
    seq,
    new Date(NOW),
  )
  if (!built.ok) throw new Error('test setup: production documents')
  stub.put(
    'content',
    `catalogue/snapshots/${seq}.json`,
    built.documents.snapshot.bytes,
    'application/json',
  )
  stub.put(
    'content',
    'catalogue/production.json',
    built.documents.pointer.bytes,
    'application/json',
  )
  return built.documents.snapshot.sha256
}

interface SiteOptions {
  readonly landing?: (storyId: string, locale: string) => LandingAnswer
  readonly object?: (path: string) => ObjectAnswer
  readonly range?: (target: RangeTarget) => RangeAnswer
}
const okRange = (target: RangeTarget): RangeAnswer => {
  const start = Math.floor(target.bytes / 2)
  return { kind: 'ok', start, end: Math.min(target.bytes - 1, start + 1023), size: target.bytes }
}

interface Verified {
  readonly exit: number
  readonly out: string[]
  readonly err: string[]
  readonly calls: string[]
  readonly objects: { path: string; bytes: number; mime: string }[]
  readonly report: Record<string, unknown> | null
  readonly md: string
}

/** One runVerify on the stub; the mark first. */
async function verify(
  stub: StorageStub,
  answer: (seq: number) => VerifyCommandAnswer | Promise<VerifyCommandAnswer>,
  options: SiteOptions & {
    readonly deep?: boolean
    readonly reader?: (base: StorageReader) => StorageReader
    readonly runMode?: 'pc' | 'actions'
  } = {},
): Promise<Verified> {
  mark(stub)
  const out: string[] = []
  const err: string[] = []
  const calls: string[] = []
  const objects: { path: string; bytes: number; mime: string }[] = []
  const dir = join(root, 'reports')
  const base = client(stub)
  const site: VerifySite = {
    landing: async (storyId, locale) => {
      calls.push(`landing ${storyId} ${locale}`)
      return options.landing ? options.landing(storyId, locale) : { kind: 'ok' }
    },
    object: async (head) => {
      calls.push(`object ${head.path}`)
      objects.push({ path: head.path, bytes: head.bytes, mime: head.mime })
      return options.object ? options.object(head.path) : { kind: 'ok' }
    },
    range: async (target) => {
      calls.push(`range ${target.path}`)
      return options.range ? options.range(target) : okRange(target)
    },
  }
  const exit = await runVerify(
    { deep: options.deep ?? false, reportDir: dir, reportDirGiven: true },
    {
      storyboardRoot: root,
      platform: process.platform,
      now: () => new Date(NOW),
      sleep: async () => {},
      log: (line) => void out.push(line),
      error: (line) => void err.push(line),
      runMode: options.runMode ?? 'pc',
      makePort: () => (options.reader ? options.reader(base) : base),
      verify: async (seq) => {
        calls.push(`verify ${seq}`)
        return answer(seq)
      },
      site,
    },
  )
  const json = join(dir, 'publisher-verify.json')
  const md = join(dir, 'publisher-verify.md')
  const report = existsSync(json)
    ? (JSON.parse(readFileSync(json, 'utf8')) as Record<string, unknown>)
    : null
  const text = existsSync(md) ? readFileSync(md, 'utf8') : ''
  rmSync(dir, { recursive: true, force: true })
  return { exit, out, err, calls, objects, report, md: text }
}
const live =
  (build: LiveBuild, seq = 2) =>
  () => ({ kind: 'live' as const, seq, build })

/** The first `mime` head of a story's package. */
function headOf(story: TestStory, mime: string) {
  const plan = planMediaHeads([{ pkg: story.pkg }], '')
  if (!plan.ok) throw new Error('test setup: media plan')
  return plan.value.heads.find((h) => h.mime === mime)
}
function targetOf(story: TestStory): RangeTarget {
  const head = headOf(story, 'audio/mpeg')!
  return {
    path: head.path,
    bytes: head.bytes,
    sha256: String(classOfPath('content', head.path)!.fields.sha256),
  }
}
const rangeLine = (seq: number, target: RangeTarget) => {
  const r = okRange(target) as Extract<RangeAnswer, { kind: 'ok' }>
  return `verify: range check ok seq=${seq} bytes=${r.start}-${r.end}/${r.size} object=${sha12(target.sha256)}`
}
/** The production snapshot's stories in snapshot order, as test stories. */
async function inOrder(stub: StorageStub, stories: readonly TestStory[]): Promise<TestStory[]> {
  return pointed(stub, 'production')!.snapshot.stories.map((e) =>
    stories.find((s) => s.storyId === e.storyId)!,
  )
}

/** A JPEG: SOI, an APP0 marker, the seed, EOI. */
const jpegBytes = (seed: string) =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...encode(seed), 0xff, 0xd9])
/** The story with its image's variants as JPEGs (no WebP). */
async function withJpegImage(story: TestStory): Promise<TestStory> {
  const index = story.pkg.assets.findIndex((a) => a.kind === 'image')
  const image = story.pkg.assets[index]!
  const media: TestMedia[] = []
  const variants: { path: string; mime: 'image/jpeg'; bytes: number; width: number }[] = []
  for (const variant of image.variants) {
    const width = (variant as { width?: number }).width ?? 768
    const bytes = jpegBytes(`${story.storyId}:jpeg:${width}`)
    const sha256 = await sha256Hex(bytes)
    const item: TestMedia = {
      path: `media/${story.storyId}/${sha256}-w${width}.jpg`,
      mime: 'image/jpeg',
      bytes,
      sha256,
    }
    media.push(item)
    variants.push({ path: item.path, mime: 'image/jpeg', bytes: bytes.length, width })
  }
  const pkg = {
    ...story.pkg,
    assets: story.pkg.assets.map((a, i) => (i === index ? { ...a, variants } : a)),
  } as StoryPackageV1
  const bound = await withPackage(story, pkg)
  return { ...bound, media: [...media, ...story.media.filter((m) => m.mime === 'audio/mpeg')] }
}
async function withoutNarration(story: TestStory): Promise<TestStory> {
  const pkg = {
    ...story.pkg,
    assets: story.pkg.assets.filter((a) => a.kind !== 'audio'),
  } as StoryPackageV1
  const bound = await withPackage(story, pkg)
  return { ...bound, media: story.media.filter((m) => m.mime !== 'audio/mpeg') }
}

describe('verify', () => {
  it(
    'T15B-46 verify: the expected seq from the production pointer, the live snapshot matched, two landing pages per built story, one image and one MP3 per story, the excluded rows, the Range check; verified, exit 0, the report (A18, D15B-19, TP-11)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await seed()
      const build = await liveBuild(stub)
      const order = await inOrder(stub, [two, river])
      const r = await verify(stub, live(build))
      expect(r.exit, 'precondition: verified').toBe(0)
      const requests = since(stub)
      const kinds = requests.map((q) =>
        q.method === 'POST' && q.pathname === LIST_PATH
          ? `list ${(JSON.parse(decode(q.body)) as { prefix: string }).prefix}`
          : q.method === 'GET' && q.pathname.startsWith(`${READ}content/packages/`)
            ? 'package'
            : `${q.method} ${q.pathname.replace(/\?.*$/, '')}`,
      )
      expect
        .soft(
          [
            kinds.filter((k) => k === 'package').length,
            kinds.filter((k) => k.startsWith('list ') && !k.startsWith('list catalogue')).length,
            requests.filter(isObjectPost).length,
            requests.filter((q) => q.method === 'DELETE').length,
          ],
          '(g1) the state reads, then one package read per built story; no other listing, POST or DELETE',
        )
        .toEqual([2, 0, 0, 0])
      expect
        .soft(
          r.calls,
          '(g2) verify(2), the landing pages, one image and one MP3 per story, the range',
        )
        .toEqual([
          'verify 2',
          ...order.flatMap((s) => s.pkg.locales.map((l) => `landing ${s.storyId} ${l}`)),
          ...order.flatMap((s) => [
            `object ${headOf(s, 'image/webp')!.path}`,
            `object ${headOf(s, 'audio/mpeg')!.path}`,
          ]),
          `range ${targetOf(order[0]!).path}`,
        ])
      expect
        .soft(r.out, '(g3) stdout exactly')
        .toEqual([
          'verify: expected seq=2 (production pointer)',
          `verify: live build seq=2 loaded snapshot sha256=${sha12(build.snapshotSha256)} (matches the production pointer)`,
          'verify: landing checked=4 failed=0',
          'verify: media checked=4 failed=0 skipped=0',
          'verify: excluded=0',
          rangeLine(2, targetOf(order[0]!)),
        ])
      expect
        .soft(
          [r.report?.outcome, r.report?.exitCode, r.report?.writes, r.report?.verify],
          '(g4) the report: verified, exit 0, writes 0, the verify section exact',
        )
        .toEqual([
          'verified',
          0,
          0,
          {
            expectedSeq: 2,
            outcome: 'live',
            liveSeq: 2,
            rollbackFlag: 'none',
            snapshot: 'match',
            landing: { checked: 4, failed: 0, gated: false },
            media: { checked: 4, failed: 0, skipped: 0 },
            excluded: [],
            range: 'ok',
            deep: null,
          },
        ])
      const partial: LiveBuild = {
        ...build,
        stories: build.stories.filter((s) => s.storyId === ID),
        excluded: [{ storyId: RIVER, version: 1, reason: 'approval-missing' }],
      }
      const r2 = await verify(stub, live(partial))
      expect
        .soft(
          [
            r2.calls.filter((c) => c.includes(RIVER)),
            since(stub).filter((q) => q.pathname.includes(`/packages/${RIVER}/`)).length,
            r2.out.includes(`verify: excluded ${RIVER} version=1 reason=approval-missing`),
            r2.out.includes('verify: excluded=1'),
            (r2.report?.verify as { excluded?: unknown } | undefined)?.excluded,
            r2.exit,
          ],
          '(g5) a build excluding river-stones: no river request, its excluded line and row, exit 0',
        )
        .toEqual([
          [],
          0,
          true,
          true,
          [{ storyId: RIVER, version: 1, reason: 'approval-missing' }],
          0,
        ])
      expectNoUnexpected(stub)
    },
  )

  it(
    'T15B-47 verify outcomes: production missing, a timeout with the flag line (range and deep still run), superseded with one state re-read, a live snapshot mismatch; the first failure in step order wins (A17, A18, L19, L20)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const staged = await newStub()
      await stageIn(staged, [two])
      const g1 = await verify(staged, () => {
        throw new Error('test: verify was not expected')
      })
      expect
        .soft(
          [g1.exit, g1.out.at(-1), g1.calls],
          '(g1) no production: production-missing, no verify call',
        )
        .toEqual([1, 'verify: stopped: production-missing', []])

      const stub = await seed()
      const build = await liveBuild(stub)
      const g2 = await verify(stub, () => ({ kind: 'timeout', lastSeq: 1 }))
      expect
        .soft(
          [
            g2.out.includes(
              'verify: live seq=1 is below seq=2: production serves an older deployment (a Vercel Instant Rollback stays in force until Undo Rollback; or a build failed or is still running)',
            ),
            g2.exit,
            g2.out.at(-1),
            g2.calls.filter((c) => c.startsWith('landing') || c.startsWith('object')),
            g2.calls.filter((c) => c.startsWith('range')).length,
          ],
          '(g2) a timeout with lastSeq 1: the older-live line, verify-timeout, no landing or object call, one range call',
        )
        .toEqual([true, 1, 'verify: stopped: verify-timeout', [], 1])
      const g2b = await verify(stub, () => ({ kind: 'timeout', lastSeq: 2 }))
      expect
        .soft(
          g2b.out.includes(formatVerifyTimeoutHint('verify')),
          '(g2) lastSeq 2: the verify hint',
        )
        .toBe(true)

      const entries = pointed(stub, 'production')!.snapshot.stories
      const g3 = await verify(stub, async () => {
        const sha = await putProduction(stub, 3, entries)
        return { kind: 'superseded', seq: 3, build: { ...build, snapshotSha256: sha } }
      })
      const productionReads = since(stub).filter(
        (q) => q.method === 'GET' && q.pathname.endsWith('/catalogue/production.json'),
      ).length
      expect
        .soft(
          [g3.exit, g3.report?.outcome, productionReads],
          '(g3) superseded seq 3, matching: exit 0 after one state re-read',
        )
        .toEqual([0, 'verify-superseded', 2])
      const fresh = await seed()
      const freshEntries = pointed(fresh, 'production')!.snapshot.stories
      const freshBuild = await liveBuild(fresh)
      const g3b = await verify(fresh, async () => {
        await putProduction(fresh, 3, freshEntries)
        return { kind: 'superseded', seq: 3, build: freshBuild }
      })
      expect
        .soft(
          [g3b.exit, g3b.out.at(-1)],
          '(g3) superseded with another sha: live-snapshot-mismatch',
        )
        .toEqual([1, 'verify: stopped: live-snapshot-mismatch'])

      const other = await seed()
      const otherBuild = { ...(await liveBuild(other)), snapshotSha256: 'f'.repeat(64) }
      const g4 = await verify(other, live(otherBuild))
      expect
        .soft(
          [g4.exit, g4.out.at(-1), g4.calls.filter((c) => c.startsWith('landing')).length],
          '(g4) live seq 2 with another snapshot sha: live-snapshot-mismatch, the landing calls still made',
        )
        .toEqual([1, 'verify: stopped: live-snapshot-mismatch', 4])
      const g5 = await verify(other, live(otherBuild), {
        landing: (storyId, locale) =>
          storyId === ID && locale === 'en'
            ? { kind: 'failed', reason: 'status', status: 404 }
            : { kind: 'ok' },
      })
      expect
        .soft([g5.exit, g5.out.at(-1)], '(g5) a mismatch and a landing 404: the mismatch wins')
        .toEqual([1, 'verify: stopped: live-snapshot-mismatch'])
      expectNoUnexpected(stub)
    },
  )

  it(
    'T15B-48 landing pages and media: one failure, all 404 is site-gated only when at least one page was checked, one image (JPEG when no WebP) and one MP3 per story, an MP3-less story skipped, landing before media (A18, L21, L22, CRIT-17b)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await seed()
      const build = await liveBuild(stub)
      const notFound: LandingAnswer = { kind: 'failed', reason: 'status', status: 404 }
      const g1 = await verify(stub, live(build), {
        landing: (storyId, locale) =>
          storyId === ID && locale === 'en' ? notFound : { kind: 'ok' },
      })
      expect
        .soft(
          [
            g1.out.includes(`verify: landing ${ID} en failed reason=status status=404`),
            g1.out.at(-1),
          ],
          '(g1) one landing 404: its line, landing-page-failed',
        )
        .toEqual([true, 'verify: stopped: landing-page-failed'])
      const g2 = await verify(stub, live(build), { landing: () => notFound })
      expect
        .soft(g2.out.at(-1), '(g2) all four 404: site-gated')
        .toBe('verify: stopped: site-gated')
      const g2b = await verify(stub, live({ ...build, stories: [] }))
      expect
        .soft(
          [g2b.out.includes('verify: landing checked=0 failed=0'), g2b.exit, g2b.report?.outcome],
          '(g2) a build with no stories: checked 0, verified',
        )
        .toEqual([true, 0, 'verified'])

      const image = headOf(two, 'image/webp')!.path
      const mp3 = headOf(river, 'audio/mpeg')!.path
      const g3 = await verify(stub, live(build), {
        object: (path) =>
          path === image
            ? { kind: 'failed', reason: 'hash', status: 200 }
            : path === mp3
              ? { kind: 'failed', reason: 'length', status: 200 }
              : { kind: 'ok' },
      })
      expect
        .soft(
          [
            g3.out.includes(`verify: media ${ID} image failed reason=hash status=200`),
            g3.out.includes(`verify: media ${RIVER} mp3 failed reason=length status=200`),
            g3.out.at(-1),
          ],
          '(g3) an image hash and an MP3 length failure: their lines, media-check-failed',
        )
        .toEqual([true, true, 'verify: stopped: media-check-failed'])
      const quiet = await withoutNarration(river)
      const jpeg = await withJpegImage(two)
      const mixed = await seeded([jpeg, quiet])
      const g3b = await verify(mixed, live(await liveBuild(mixed)))
      expect
        .soft(
          [
            g3b.out.includes('verify: media checked=3 failed=0 skipped=1'),
            g3b.calls.includes(`object ${headOf(jpeg, 'image/jpeg')!.path}`),
            g3b.exit,
          ],
          '(g3) an MP3-less story skipped; a JPEG-only image requested',
        )
        .toEqual([true, true, 0])
      const g4 = await verify(stub, live(build), {
        landing: (storyId, locale) =>
          storyId === ID && locale === 'en' ? notFound : { kind: 'ok' },
        object: (path) =>
          path === image ? { kind: 'failed', reason: 'hash', status: 200 } : { kind: 'ok' },
      })
      expect
        .soft(g4.out.at(-1), '(g4) a landing and a media failure: landing wins')
        .toBe('verify: stopped: landing-page-failed')
      expectNoUnexpected(stub)
    },
  )

  it(
    'T15B-49 --deep: capped from the listings before any object read; every listed package and media object against its name; every approval record and waiver file the two snapshots name; the mismatch lines; runs after a timeout and in actions mode; no waiver field printed (A19, D15B-20, L23)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await seed()
      const build = await liveBuild(stub)
      const contentObjects = [two, river].flatMap((s) => [
        { path: `packages/${s.storyId}/${s.packageSha256}.json`, bytes: s.packageBytes.length },
        ...s.media.map((m) => ({ path: m.path, bytes: m.bytes.length })),
      ])
      const total = contentObjects.reduce((sum, o) => sum + o.bytes, 0)
      const r = await verify(stub, live(build), { deep: true })
      expect
        .soft(
          [
            r.out.includes(
              `verify: deep plan objects=8 bytes=${total} approvals=2 waivers=2 (Supabase egress; spec §8: at most monthly, and after a suspected key leak)`,
            ),
            r.out.includes('verify: deep checked=12 mismatches=0'),
            r.exit,
          ],
          '(g1) the deep plan line; checked = objects + approvals + waivers, no mismatch',
        )
        .toEqual([true, true, 0])
      const media = [two, river].flatMap((s) =>
        s.media.map((m) => ({ path: m.path, bytes: m.bytes.length, mime: m.mime })),
      )
      const deepObjects = r.objects.slice(4)
      expect
        .soft(
          [
            [...deepObjects].sort((a, b) => (a.path < b.path ? -1 : 1)),
            since(stub).filter(
              (q) => q.method === 'GET' && q.pathname.startsWith(`${READ}content/packages/`),
            ).length,
          ],
          '(g1) site.object for every media object with its size and mime; one package read per package object',
        )
        .toEqual([[...media].sort((a, b) => (a.path < b.path ? -1 : 1)), 2 + 2])

      // g2: the caps, through a fake reader.
      const fakeLists =
        (objects: { path: string; size: number | null }[]) =>
        (base: StorageReader): StorageReader => ({
          listContent: async (folder): Promise<ListResult> =>
            folder === 'packages/' || folder === 'media/'
              ? {
                  kind: 'listed',
                  objects: objects
                    .filter((o) => o.path.startsWith(folder))
                    .map((o) => ({
                      path: o.path,
                      size: o.size,
                      mimetype: 'image/webp',
                      cacheControl: null,
                      updatedAt: null,
                    })),
                }
              : base.listContent(folder),
          readContent: (ref) => base.readContent(ref),
          readMaster: (ref) => base.readMaster(ref),
        })
      const hexes: string[] = []
      for (let i = 0; i < 5_001; i++) hexes.push(await sha256Hex(encode(`deep-${i}`)))
      const many = (count: number, size: (i: number) => number) =>
        hexes.slice(0, count).map((h, i) => ({ path: `media/${ID}/${h}-w1.webp`, size: size(i) }))
      const cap = 536_870_912
      const caps: [string, { path: string; size: number | null }[], string][] = [
        ['5,001 objects', many(5_001, () => 1), 'deep-over-cap'],
        ['512 MiB + 1', many(2, (i) => (i === 0 ? cap : 1)), 'deep-over-cap'],
      ]
      for (const [label, objects, code] of caps) {
        const g = await verify(stub, live(build), { deep: true, reader: fakeLists(objects) })
        expect
          .soft([g.out.at(-1), g.objects.length - 4], `(g2) ${label}: ${code}, zero object reads`)
          .toEqual([`verify: stopped: ${code}`, 0])
      }
      const exact = many(5_000, (i) => (i === 0 ? cap - 4_999 : 1))
      const proceeds = await verify(stub, live(build), { deep: true, reader: fakeLists(exact) })
      expect
        .soft(
          [proceeds.out.some((l) => l.includes('deep-over-cap')), proceeds.objects.length - 4],
          '(g2) exactly 5,000 objects and 512 MiB: proceeds',
        )
        .toEqual([false, 5_000])

      // g3: an unknown name (in its own stub), a null size.
      const noted = await seed()
      noted.put('content', `packages/${ID}/notes.json`, encode('{}'), 'application/json')
      const unknown = await verify(noted, live(await liveBuild(noted)), { deep: true })
      expect
        .soft(
          [unknown.out.at(-1), unknown.objects.length - 4],
          '(g3) packages/two-paths/notes.json: deep-unknown-object before any read',
        )
        .toEqual(['verify: stopped: deep-unknown-object', 0])
      const nullSize = await verify(stub, live(build), {
        deep: true,
        reader: fakeLists([{ path: `media/${ID}/${hexes[0]}-w1.webp`, size: null }]),
      })
      expect
        .soft(nullSize.out.at(-1), '(g3) a null size: deep-unknown-object')
        .toBe('verify: stopped: deep-unknown-object')

      // g4: mismatches, each in its own stub.
      const canary = {
        basis: 'S15BCANARYbasis',
        notes: ['S15BCANARYnote'],
        recordedBy: 'S15BCANARYby',
      }
      const runs: Verified[] = []
      const mismatches: [string, (s: StorageStub) => Promise<LiveBuild | undefined>, string][] = [
        [
          'a package object with other bytes under its name',
          async (s) => {
            const orphanHex = await sha256Hex(encode('orphan-package'))
            s.put(
              'content',
              `packages/${ID}/${orphanHex}.json`,
              encode('{"other":"bytes"}'),
              'application/json',
            )
            return undefined
          },
          `verify: deep mismatch package ${ID} ${sha12(await sha256Hex(encode('orphan-package')))} reason=hash`,
        ],
        [
          'the site answering length for a media object',
          async () => undefined,
          `verify: deep mismatch media ${RIVER} ${sha12(String(classOfPath('content', river.media[1]!.path)!.fields.sha256))} reason=length`,
        ],
        [
          'a valid record of another sha at the approval path',
          async (s) => {
            const otherRecord = await approvalRecordOf(two, { on: '2026-11-01' })
            s.put(
              'masters',
              `approvals/${ID}/${two.packageSha256}.json`,
              otherRecord.bytes,
              'application/json',
            )
            return undefined
          },
          'approval-sha',
        ],
        [
          'an entry whose approvalSha256 is the sha256 of a stored non-JCS record',
          async (s) => {
            const record = await approvalRecordOf(two, { on: '2026-11-22' })
            const pretty = encode(JSON.stringify(record.record, null, 2))
            s.put(
              'masters',
              `approvals/${ID}/${two.packageSha256}.json`,
              pretty,
              'application/json',
            )
            const prettySha = await sha256Hex(pretty)
            const entries = pointed(s, 'production')!.snapshot.stories.map((e) =>
              e.storyId === ID ? { ...e, approvalSha256: prettySha } : e,
            )
            const sha = await putProduction(s, 3, entries)
            return { ...(await liveBuild(s)), snapshotSha256: sha }
          },
          'approval-invalid',
        ],
        [
          // The stub cannot delete a stored object, so the reader answers this one read as absent.
          'a waiver file absent from masters',
          async () => undefined,
          'waiver-missing',
        ],
        [
          'a waiver file with other bytes under its name',
          async (s) => {
            s.put(
              'masters',
              `waivers/${ID}/${two.waiverSha256}.json`,
              waiverBytesOf({ ...waiverFileOf(ID), ...canary }),
              'application/json',
            )
            return undefined
          },
          'reason=hash',
        ],
      ]
      for (const [label, inject, want] of mismatches) {
        const own = await seed()
        const injected = await inject(own)
        const ownBuild = injected ?? (await liveBuild(own))
        const lengthPath = river.media[1]!.path
        const absentWaiver = (base: StorageReader): StorageReader => ({
          listContent: (folder) => base.listContent(folder),
          readContent: (ref) => base.readContent(ref),
          readMaster: async (ref) =>
            ref.kind === 'waiver' && ref.storyId === ID
              ? { kind: 'not-found' }
              : base.readMaster(ref),
        })
        const g = await verify(own, live(ownBuild, injected ? 3 : 2), {
          deep: true,
          object: (path) =>
            label.includes('length') && path === lengthPath
              ? { kind: 'failed', reason: 'length', status: 200 }
              : { kind: 'ok' },
          ...(label.includes('absent') ? { reader: absentWaiver } : {}),
        })
        runs.push(g)
        const line = g.out.find((l) => l.startsWith('verify: deep mismatch '))
        expect
          .soft(
            [
              line?.includes(want) ?? false,
              g.out.some((l) => /^verify: deep checked=\d+ mismatches=1$/.test(l)),
              g.out.at(-1),
              g.exit,
            ],
            `(g4) ${label}`,
          )
          .toEqual([true, true, 'verify: stopped: deep-mismatch', 1])
        expectNoUnexpected(own)
      }

      // g5: after a timeout; in actions mode.
      const afterTimeout = await verify(stub, () => ({ kind: 'timeout', lastSeq: null }), {
        deep: true,
      })
      expect
        .soft(
          afterTimeout.out.some((l) => l.startsWith('verify: deep plan ')),
          '(g5) after a timeout, deep still runs',
        )
        .toBe(true)
      const actions = await verify(stub, live(build), { deep: true, runMode: 'actions' })
      expect
        .soft(
          [
            actions.out.some((l) => l.startsWith('verify: deep plan ')),
            actions.report,
            existsSync(join(root, 'reports')),
          ],
          '(g5) in actions mode: deep runs, no report',
        )
        .toEqual([true, null, false])
      // g6: the changed waiver's private fields in no channel.
      const text = runs
        .map((g) => [...g.out, ...g.err, JSON.stringify(g.report), g.md].join('\n'))
        .join('\n')
      expect
        .soft(text.includes('S15BCANARY'), '(g6) no private waiver field in any channel')
        .toBe(false)
      expect(
        runs.some((g) => g.out.some((l) => l.startsWith(`verify: deep mismatch waiver ${ID}`))),
        'precondition: g6 read the canary waiver',
      ).toBe(true)
      expectNoUnexpected(stub)
    },
  )
})
