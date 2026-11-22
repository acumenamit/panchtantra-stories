// Step 15b (P1-8d part b) takedown.ts: this PC's hash list, the takedown plan and its commit
// (design migration-input/p1-step15b-design.md §2.1, §3.9 to §3.12, §4.3, §4.4, D15B-9 to D15B-12,
// D15B-29, D15B-34, D15B-36; test plan §14.9: T15B-21 to T15B-31).
// Every Storage call goes to the loopback stub (deletes on) through a real client built in the test
// with a fake key assembled at run time; every DELETE goes through the real hardened deleter on the
// stub's own origin. A loopback guard on the global fetch refuses and counts any other host. Each
// test owns an OS temp root that holds the audio tree and the hash list (stage-testkit's
// writeAudioTree and hashListOf, or a list the test writes); no test reads the repository's
// migration-input/audio/ or any waiver file. Junctions are made with symlinkSync(…, 'junction'); a
// directory or file symlink that this PC refuses (EPERM) prints its S9 skip line instead.
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { parseArgs } from './args'
import { buildProductionDocuments, buildStagingDocuments } from './catalogue-state'
import { createContentDeleter } from './content-deleter'
import { Secret } from './env'
import type { ContentRemover, ListResult, StorageReader } from './port'
import { runStage } from './stage'
import {
  buildTestStories,
  fullyBoundStory,
  hashListOf,
  webpBytes,
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
import { commitTakedown, parseHashList, planTakedown, type TakedownPlan } from './takedown'

// ---- shared material ----

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-takedown-test-key'].join('_')
const NOW = '2026-11-22T10:00:00.000Z'
const ID = 'two-paths'
const RIVER = 'river-stones'
const LIST_PATH = '/storage/v1/object/list/content'
const READ = '/storage/v1/object/authenticated/'
const DELETE_PATH = '/storage/v1/object/content'
const MISSING_BODY = '{"statusCode":"404","error":"not_found","message":"Object not found"}'
const TIMEOUT = { timeout: 180_000 }
const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const native = (path: string) => realpathSync.native(path)

// ---- loopback guard (§14.1 "Network") ----

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0
let root = ''
const stubs: StorageStub[] = []
const extraRoots: string[] = []

beforeEach(() => {
  escapes = 0
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
    escapes++
    return Promise.reject(new TypeError('blocked: not a loopback host'))
  })
  root = newRoot()
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
  for (const dir of extraRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
  const count = escapes
  vi.unstubAllGlobals()
  expect(count, 'loopback guard: requests that tried to leave 127.0.0.1').toBe(0)
  if (problems.length > 0) throw problems[0]
})

/** A fresh temp root (the test's own OS temp folder), removed after the test. */
function newRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 's15b-'))
  mkdirSync(join(dir, 'public'))
  extraRoots.push(dir)
  return dir
}

async function newStub(): Promise<StorageStub> {
  const stub = await startStorageStub({ apikey: FAKE_KEY, deletes: true })
  stubs.push(stub)
  return stub
}

let cached: Promise<TestStory[]> | null = null
const testStories = (): Promise<TestStory[]> => (cached ??= buildTestStories())
const storyOf = async (id = ID): Promise<TestStory> =>
  (await testStories()).find((story) => story.storyId === id)!

const client = (stub: StorageStub, fetchImpl?: typeof fetch): StorageClient =>
  createStorageClient({
    supabaseUrl: stub.origin,
    secretKey: new Secret(FAKE_KEY),
    ...(fetchImpl ? { fetchImpl } : {}),
  })

const packagePathOf = (story: TestStory) => `packages/${story.storyId}/${story.packageSha256}.json`
/** Every content path a story's package and media occupy. */
const storyPaths = (story: TestStory) => [packagePathOf(story), ...story.media.map((m) => m.path)]
const sorted = (paths: readonly string[]) => [...paths].sort()

/** Stores a story's package and media directly, as a stage would have. */
function putStory(stub: StorageStub, story: TestStory): void {
  stub.put('content', packagePathOf(story), story.packageBytes, 'application/json')
  for (const media of story.media) stub.put('content', media.path, media.bytes, media.mime)
}

/** A real stage of `stories` (masters waiver files seeded first) into the stub. */
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
    { cwd: root, storyboardRoot: root, platform: process.platform },
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

/** The snapshot the stub's `mode` pointer names. */
function pointed(stub: StorageStub, mode: 'staging' | 'production') {
  const bytes = stub.object('content', `catalogue/${mode}.json`)?.bytes
  if (bytes === undefined) return null
  const pointer = JSON.parse(decode(bytes)) as { seq: number; snapshotPath: string }
  const snapshot = JSON.parse(decode(stub.object('content', pointer.snapshotPath)!.bytes)) as {
    stories: SnapshotEntry[]
  }
  return { seq: pointer.seq, stories: snapshot.stories }
}

/** Stores snapshot `seq` and the `mode` pointer, built by the catalogue builders. */
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
}

const approved = (entry: SnapshotEntry): SnapshotEntry => ({
  ...entry,
  approvalSha256: 'e'.repeat(64),
})

/**
 * The neither state for `story`: river-stones staged (staging seq 1) and published as production
 * seq 2 (documents built from the staged entry); `story`'s objects stored directly, its audio tree
 * and a hash list written under `dir`.
 */
async function neitherState(stub: StorageStub, story: TestStory, dir = root): Promise<void> {
  const river = await storyOf(RIVER)
  await stageIn(stub, [river])
  const staged = pointed(stub, 'staging')!.stories.find((e) => e.storyId === RIVER)!
  await putDocuments(stub, 'production', 2, [approved(staged)])
  putStory(stub, story)
  seedAudio(dir, [story])
}

const audioDir = (dir: string) => join(dir, 'migration-input', 'audio')
const listFile = (dir: string) => join(audioDir(dir), 'SHA256SUMS.txt')
function writeList(dir: string, text: string | Uint8Array): void {
  mkdirSync(audioDir(dir), { recursive: true })
  writeFileSync(listFile(dir), text)
}
function seedAudio(dir: string, stories: readonly TestStory[]): void {
  writeAudioTree(dir, stories)
  writeList(dir, hashListOf(stories))
}

/** TP-16: answers mapped paths (a string, or an Error thrown); others go to realpathSync.native. */
function realPathAnswering(answers: Map<string, string | Error>) {
  const asked: string[] = []
  const realPath = (path: string): string => {
    asked.push(path)
    const answer = answers.get(path)
    if (answer instanceof Error) throw answer
    if (answer !== undefined) return answer
    return realpathSync.native(path)
  }
  return { realPath, asked }
}

/** A reader whose folder listings a test rewrites; every other read goes to `base`. */
function fakeReader(
  base: StorageReader,
  list: (folder: string, real: ListResult, call: number) => ListResult | Promise<ListResult>,
): StorageReader {
  let calls = 0
  return {
    listContent: async (folder) => list(folder, await base.listContent(folder), calls++),
    readContent: (ref) => base.readContent(ref),
    readMaster: (ref) => base.readMaster(ref),
  }
}
const listed = (paths: readonly string[], size: number | null = 1): ListResult => ({
  kind: 'listed',
  objects: paths.map((path) => ({
    path,
    size,
    mimetype: null,
    cacheControl: null,
    updatedAt: null,
  })),
})
const withExtra = (real: ListResult, paths: readonly string[]): ListResult =>
  real.kind === 'listed' ? listed([...real.objects.map((o) => o.path), ...paths]) : real

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

/** A recording remover factory: a real hardened deleter on the stub's origin. */
function removers(stub: StorageStub, storyId: string, fetchImpl?: typeof fetch) {
  const made: number[] = []
  const makeRemover = (): ContentRemover => {
    made.push(stub.requests.length)
    return createContentDeleter({
      supabaseUrl: stub.origin,
      secretKey: new Secret(FAKE_KEY),
      storyId,
      ...(fetchImpl ? { fetchImpl } : {}),
    })
  }
  return { made, makeRemover }
}

const deletes = (log: readonly StubLogEntry[]) => log.filter((r) => r.method === 'DELETE')
const deleteBody = (r: StubLogEntry) =>
  (JSON.parse(decode(r.body)) as { prefixes: string[] }).prefixes
const isDeleteOf = (r: StubLogEntry) => r.method === 'DELETE'

type LogLike = Pick<StorageStub, 'requests' | 'unexpected'>
/**
 * TP-14: each DELETE entry is DELETE /storage/v1/object/content with no search, content-type
 * application/json and a strict JSON body of exactly `prefixes`, whose every path is the package or
 * media class of `storyId` and, when given, in `planned`. Throws naming the method and pathname.
 */
function expectDeletesConfined(stub: LogLike, storyId: string, planned?: readonly string[]): void {
  for (const r of stub.requests.filter(isDeleteOf)) {
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
      Object.keys(body).join(',') !== 'prefixes'
    ) {
      throw new Error(`confined: ${where}`)
    }
    const paths = (body as { prefixes: unknown }).prefixes
    if (!Array.isArray(paths)) throw new Error(`confined: ${where}`)
    for (const path of paths) {
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

/** The request classes of `log`, consecutive repeats collapsed. */
function classes(log: readonly StubLogEntry[]): string[] {
  const named = log.map((r) => {
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
    if (r.method === 'GET' && r.pathname.startsWith(`${READ}content/packages/`)) return 'package'
    return `other ${r.method} ${r.pathname}`
  })
  return named.filter((name, index) => name !== named[index - 1])
}

/**
 * Every case and separator form of a temp root (T15B-25 g6, T15B-26 g5), each also as JSON text
 * writes it: both checks read `JSON.stringify` output, which doubles every backslash of a win32 path.
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
const leaks = (text: string, dir: string) =>
  [...rootForms(dir), 'SHA256SUMS', 'migration-input'].filter((form) => text.includes(form))

/** The 8.3 short form of `path` (cmd's `%~sI`) on a win32 host, or null on any other host. */
function shortPathOf(path: string): string | null {
  if (process.platform !== 'win32') return null
  const command = `"for %I in ("${path}") do @echo %~sI"`
  const run = spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
    encoding: 'utf8',
    windowsVerbatimArguments: true,
  })
  if (run.status !== 0) throw new Error('test setup: cmd gave no 8.3 short name')
  return run.stdout.trim()
}

/** A symlink this PC may refuse (EPERM): true when made, else the S9 skip line is printed. */
function trySymlink(target: string, link: string, type: 'dir' | 'file', label: string): boolean {
  try {
    symlinkSync(target, link, type)
    return true
  } catch (error) {
    if ((error as { code?: string }).code !== 'EPERM') throw error
    console.log(`skipped: a ${label} is not creatable here (S9)`)
    return false
  }
}

const hex = (seed: string) => sha256Hex(encode(seed))
const line = (sha: string, path: string) => `${sha}  ${path}\n`

/** The story's MP3 media paths, sorted. */
const mp3Paths = (story: TestStory) =>
  sorted(story.media.filter((m) => m.mime === 'audio/mpeg').map((m) => m.path))

// ---- T15B-21 to T15B-23: the hash list's text rule (parseHashList) ----

describe('the hash list', () => {
  it(
    "T15B-21 parseHashList accepts the real file's shape, the near misses and the bounds; hashListOf and writeAudioTree build a list and a tree the proof accepts (A9, A26, L8, CRIT-15, TP-13)",
    TIMEOUT,
    async () => {
      const [lantern, river, two] = await testStories()
      const stories = [two!, river!, lantern!]
      const text = hashListOf(stories)
      writeAudioTree(root, stories)
      const parsed = parseHashList(encode(text))
      expect.soft(parsed.ok, '(g1) hashListOf of the three stories: ok').toBe(true)
      const expected = text
        .slice(0, -1)
        .split('\n')
        .map((row) => {
          const [storyId, file] = row.slice(66).split('/')
          return { sha256: row.slice(0, 64), storyId, file }
        })
      expect.soft(parsed.ok ? parsed.lines : [], '(g1) the lines in list order').toEqual(expected)
      const hashes = await Promise.all(
        expected.map(async (l) =>
          sha256Hex(readFileSync(join(audioDir(root), l.storyId!, l.file!))),
        ),
      )
      expect
        .soft(hashes, "(g1) each file under writeAudioTree's root hashes to its sha256")
        .toEqual(expected.map((l) => l.sha256))
      expect(expected.length, 'precondition: the three stories name MP3s').toBeGreaterThan(2)

      const h = await hex('near-miss')
      const h2 = await hex('near-miss-2')
      const node48 = `a${'b'.repeat(47)}`
      const id64 = 'a'.repeat(64)
      const samples: [string, string][] = [
        ['console/x.en.mp3', line(h, 'console/x.en.mp3')],
        ['lion/con_x.en.mp3', line(h, 'lion/con_x.en.mp3')],
        ['lion/com10.en.mp3', line(h, 'lion/com10.en.mp3')],
        ['lion/x.ar.mp3', line(h, 'lion/x.ar.mp3')],
        ['two paths with one hash', line(h2, 'lion/y.en.mp3') + line(h2, 'lion/z.en.mp3')],
        ['a 48-character node id', line(h, `lion/${node48}.en.mp3`)],
        ['a 64-character story id', line(h, `${id64}/x.en.mp3`)],
        ['abc/x.en.mp3', line(h, 'abc/x.en.mp3')],
      ]
      const many: string[] = []
      for (let i = 0; i < 10_000; i++) many.push(line(h, `lion/n${i}.en.mp3`))
      samples.push(['exactly 10,000 lines', many.join('')])
      for (const [label, list] of samples) {
        expect.soft(parseHashList(encode(list)).ok, `(g2) accepted: ${label}`).toBe(true)
      }
    },
  )

  it(
    'T15B-22 parseHashList refuses on the bytes and the structure: BOM, invalid UTF-8, encoded surrogates, controls, CR, TAB, NUL, non-ASCII, U+FEFF inside, bidi; no final LF, an empty line, an empty file, a lone LF, 10,001 lines; the refusal carries no text (A9, L8, PB1, TP-15)',
    TIMEOUT,
    async () => {
      const a = await hex('line-a')
      const b = await hex('line-b')
      const first = `${a}  two-paths/start.en.mp3`
      const second = `${b}  two-paths/start.hi.mp3`
      const valid = encode(`${first}\n${second}\n`)
      expect(parseHashList(valid).ok, 'precondition: the valid two-line list is ok').toBe(true)
      const split = 'two-paths/st'.length + 66
      const insert = (bytes: readonly number[]) =>
        Uint8Array.from([
          ...encode(first.slice(0, split)),
          ...bytes,
          ...encode(`${first.slice(split)}\n${second}\n`),
        ])
      const samples: [string, Uint8Array][] = [
        ['EF BB BF + the list', Uint8Array.from([0xef, 0xbb, 0xbf, ...valid])],
        ['FF', insert([0xff])],
        ['C0 AF', insert([0xc0, 0xaf])],
        ['ED A0 80', insert([0xed, 0xa0, 0x80])],
        ['ED B0 80', insert([0xed, 0xb0, 0x80])],
        ['F4 90 80 80', insert([0xf4, 0x90, 0x80, 0x80])],
        ['E2 80 AE (U+202E)', insert([0xe2, 0x80, 0xae])],
        ['EF BB BF inside a line', insert([0xef, 0xbb, 0xbf])],
        ['CRLF endings', encode(`${first}\r\n${second}\r\n`)],
        ['a lone CR', insert([0x0d])],
        ['a TAB for the two spaces', encode(`${a}\ttwo-paths/start.en.mp3\n${second}\n`)],
        ['NUL', insert([0x00])],
        ['7F', insert([0x7f])],
        ['1B', insert([0x1b])],
        ['C3 A9', insert([0xc3, 0xa9])],
      ]
      for (const [label, bytes] of samples) {
        expect.soft(parseHashList(bytes), `(g1) refused: ${label}`).toEqual({
          ok: false,
          code: 'hash-list-invalid',
        })
      }
      const many: string[] = []
      for (let i = 0; i < 10_001; i++) many.push(line(a, `lion/n${i}.en.mp3`))
      const structure: [string, Uint8Array][] = [
        ['no final LF', encode(`${first}\n${second}`)],
        ['\\n\\n at the end', encode(`${first}\n${second}\n\n`)],
        ['an empty middle line', encode(`${first}\n\n${second}\n`)],
        ['0 bytes', new Uint8Array(0)],
        ['\\n alone', encode('\n')],
        ['10,001 lines', encode(many.join(''))],
      ]
      for (const [label, bytes] of structure) {
        expect.soft(parseHashList(bytes), `(g2) refused: ${label}`).toEqual({
          ok: false,
          code: 'hash-list-invalid',
        })
      }
      const canary = encode(`${first}\n${a} two-paths/s15bcanary.en.mp3\n`)
      const refused = parseHashList(canary)
      expect
        .soft(Object.keys(refused).sort(), '(g3) the refusal holds exactly ok and code')
        .toEqual(['code', 'ok'])
      expect
        .soft(JSON.stringify(refused).includes('s15bcanary'), '(g3) no canary in the refusal')
        .toBe(false)
    },
  )

  it(
    'T15B-23 parseHashList line rule: hex, spacing, markers, separators, ids, node ids, locales, reserved stems, duplicates; any bad line refuses the whole list (A9, L8, CRIT-15)',
    TIMEOUT,
    async () => {
      const h = await hex('line-rule')
      const h2 = await hex('line-rule-2')
      const good = line(h, 'lion/x.en.mp3')
      expect(parseHashList(encode(good)).ok, 'precondition: the good line is ok').toBe(true)
      const id65 = 'a'.repeat(65)
      const node49 = `a${'b'.repeat(48)}`
      const bad: [string, string][] = [
        ['upper-case hex', `${h.toUpperCase()}  lion/y.en.mp3\n`],
        ['63 hex', `${h.slice(1)}  lion/y.en.mp3\n`],
        ['65 hex', `${h}a  lion/y.en.mp3\n`],
        ['one space', `${h} lion/y.en.mp3\n`],
        ['three spaces', `${h}   lion/y.en.mp3\n`],
        ['a * marker', `${h} *lion/y.en.mp3\n`],
        ['a leading space', ` ${h}  lion/y.en.mp3\n`],
        ['a trailing space', `${h}  lion/y.en.mp3 \n`],
        ['./two-paths/…', line(h, './two-paths/y.en.mp3')],
        ['/two-paths/…', line(h, '/two-paths/y.en.mp3')],
        ['two-paths//x.en.mp3', line(h, 'two-paths//x.en.mp3')],
        ['two-paths/x.en.mp3/', line(h, 'two-paths/x.en.mp3/')],
        ['x/../y.en.mp3', line(h, 'x/../y.en.mp3')],
        ['two-paths\\x.en.mp3', line(h, 'two-paths\\x.en.mp3')],
        ['two-paths/x:y.en.mp3', line(h, 'two-paths/x:y.en.mp3')],
        ['a/b/c.en.mp3', line(h, 'abc/b/c.en.mp3')],
        ['Lion/…', line(h, 'Lion/y.en.mp3')],
        ['ab/…', line(h, 'ab/y.en.mp3')],
        ['a 65-character id', line(h, `${id65}/y.en.mp3`)],
        ['a--b/…', line(h, 'a--b/y.en.mp3')],
        ['lion/X.en.mp3', line(h, 'lion/X.en.mp3')],
        ['lion/1x.en.mp3', line(h, 'lion/1x.en.mp3')],
        ['a 49-character node', line(h, `lion/${node49}.en.mp3`)],
        ['lion/x.fr.mp3', line(h, 'lion/x.fr.mp3')],
        ['lion/x.EN.mp3', line(h, 'lion/x.EN.mp3')],
        ['lion/x.en.MP3', line(h, 'lion/x.en.MP3')],
        ['lion/x.en.mp3.bak', line(h, 'lion/y.en.mp3.bak')],
        ['lion/x.en.wav', line(h, 'lion/y.en.wav')],
        ['con/x.en.mp3', line(h, 'con/x.en.mp3')],
        ['prn/…', line(h, 'prn/x.en.mp3')],
        ['nul/…', line(h, 'nul/x.en.mp3')],
        ['lion/aux.en.mp3', line(h, 'lion/aux.en.mp3')],
        ['lion/com1.hi.mp3', line(h, 'lion/com1.hi.mp3')],
        ['lion/lpt9.en.mp3', line(h, 'lion/lpt9.en.mp3')],
        ['a repeated path with one hash', line(h, 'lion/x.en.mp3')],
        ['a repeated path with two hashes', line(h2, 'lion/x.en.mp3')],
      ]
      for (const [label, row] of bad) {
        expect.soft(parseHashList(encode(good + row)), `(g1) refused: ${label}`).toEqual({
          ok: false,
          code: 'hash-list-invalid',
        })
      }
      const hundred: string[] = []
      for (let i = 0; i < 100; i++) hundred.push(line(h, `lion/n${i}.en.mp3`))
      hundred.splice(50, 0, `${h} lion/odd.en.mp3\n`)
      expect
        .soft(parseHashList(encode(hundred.join(''))), '(g2) 100 good lines and one bad')
        .toEqual({ ok: false, code: 'hash-list-invalid' })
    },
  )
})

// ---- T15B-24 to T15B-27: the takedown plan ----

describe('the takedown plan', () => {
  it(
    'T15B-24 planTakedown: the two folder listings, every version and variant, the class and story rule, listing failures, a path listed twice, the set sorted (A10, L10, CRIT-11a, TP-12)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await newStub()
      putStory(stub, two)
      const orphanPackage = `packages/${ID}/${await hex('older')}.json`
      const orphanImage = `media/${ID}/${await hex('orphan-image')}-w640.webp`
      stub.put('content', orphanPackage, encode('{}'), 'application/json')
      stub.put('content', orphanImage, webpBytes('orphan'), 'image/webp')
      seedAudio(root, [two])
      const mark = stub.requests.length
      const plan = await planTakedown(client(stub), ID, null, root, native)
      expect(plan.ok, 'precondition: the plan is ok').toBe(true)
      const value = plan.ok ? plan.plan : null
      expect(value?.counts, 'precondition: the counts').toEqual({
        packages: 2,
        media: 4,
        mp3: 1,
        mp3Unproven: 0,
        images: 3,
      })
      const every = sorted([...storyPaths(two), orphanPackage, orphanImage])
      expect
        .soft(value?.paths, '(g1) every object under the two folders, sorted by code units')
        .toEqual(every)
      const lists = stub.requests.slice(mark)
      expect
        .soft(
          lists.map((r) =>
            r.pathname === LIST_PATH
              ? `list ${(JSON.parse(decode(r.body)) as { prefix: string }).prefix}`
              : `${r.method} ${r.pathname}`,
          ),
          '(g1) exactly two list requests: packages/two-paths, then media/two-paths',
        )
        .toEqual([`list packages/${ID}`, `list media/${ID}`])

      const unknown: [string, string][] = [
        ['nested', `packages/${ID}/sub/${await hex('nested')}.json`],
        ['upper-case hex', `media/${ID}/${(await hex('upper')).toUpperCase()}-w768.webp`],
        ['.png', `media/${ID}/${await hex('png')}-w768.png`],
        ['.mp3.bak', `media/${ID}/${await hex('bak')}-w768.mp3.bak`],
        ['.JSON', `packages/${ID}/${await hex('json')}.JSON`],
      ]
      for (const [label, path] of unknown) {
        const own = await newStub()
        putStory(own, two)
        own.put('content', path, encode('x'), 'application/octet-stream')
        const before = own.requests.length
        const r = await planTakedown(client(own), ID, null, root, native)
        expect
          .soft(
            [r, own.requests.slice(before).every((q) => q.pathname === LIST_PATH)],
            `(g2) takedown-unknown-object, no request after the listings: ${label}`,
          )
          .toEqual([{ ok: false, code: 'takedown-unknown-object' }, true])
      }

      const failing: [string, () => Promise<unknown>][] = [
        [
          '401',
          async () => {
            stub.override('POST', LIST_PATH, {
              kind: 'answer',
              status: 401,
              body: '{"statusCode":"401"}',
            })
            return planTakedown(client(stub), ID, null, root, native)
          },
        ],
        [
          '500',
          async () => {
            stub.override('POST', LIST_PATH, {
              kind: 'answer',
              status: 500,
              body: '{"statusCode":"500"}',
            })
            return planTakedown(client(stub), ID, null, root, native)
          },
        ],
        [
          'list-size-exceeded',
          async () =>
            planTakedown(
              fakeReader(client(stub), () => ({
                kind: 'failed',
                status: null,
                code: 'list-size-exceeded',
              })),
              ID,
              null,
              root,
              native,
            ),
        ],
        [
          'list-depth-exceeded',
          async () =>
            planTakedown(
              fakeReader(client(stub), () => ({
                kind: 'failed',
                status: null,
                code: 'list-depth-exceeded',
              })),
              ID,
              null,
              root,
              native,
            ),
        ],
      ]
      const codes: Record<string, string> = {
        '401': 'storage-unauthorized',
        '500': 'storage-failed',
        'list-size-exceeded': 'storage-failed',
        'list-depth-exceeded': 'storage-failed',
      }
      for (const [label, run] of failing) {
        expect
          .soft(await run(), `(g3) a listing failure: ${label}`)
          .toEqual({ ok: false, code: codes[label] })
      }
      // The client answers a 401 or 500 list POST as a failure; the stub records the answer, not
      // an unexpected request, so the shared stub stays clean.
      const placeholder = await newStub()
      putStory(placeholder, two)
      placeholder.put('content', `media/${ID}/.emptyFolderPlaceholder`, encode(''), 'text/plain')
      expect
        .soft(
          await planTakedown(client(placeholder), ID, null, root, native),
          '(g4) .emptyFolderPlaceholder through the real client: storage-failed (unsafe-name)',
        )
        .toEqual({ ok: false, code: 'storage-failed' })
      expect
        .soft(
          await planTakedown(
            fakeReader(client(stub), (folder, real) =>
              folder.startsWith('media/')
                ? withExtra(real, [`media/${ID}/.emptyFolderPlaceholder`])
                : real,
            ),
            ID,
            null,
            root,
            native,
          ),
          '(g4) .emptyFolderPlaceholder in a fake listing: takedown-unknown-object',
        )
        .toEqual({ ok: false, code: 'takedown-unknown-object' })
      expect
        .soft(
          await planTakedown(
            fakeReader(client(stub), (folder, real) =>
              folder.startsWith('packages/') ? withExtra(real, [packagePathOf(two)]) : real,
            ),
            ID,
            null,
            root,
            native,
          ),
          '(g5) a path listed twice: takedown-unknown-object',
        )
        .toEqual({ ok: false, code: 'takedown-unknown-object' })
      for (const each of stubs) expectDeletesConfined(each, ID)
    },
  )

  it(
    "T15B-25 the hash-list read is a local path guard: fixed segments only, the audio folder's real path local, one sample per Windows path form, links refused on every segment, realPath required (A9, L7, CRIT-10, CRIT-12, TP-16)",
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await newStub()
      putStory(stub, two)
      seedAudio(root, [two])
      const reader = client(stub)
      const ok = await planTakedown(reader, ID, null, root, native)
      expect(ok.ok, 'precondition: planTakedown with realpathSync.native is ok').toBe(true)
      const refusals: unknown[] = []
      const audio = audioDir(root)
      const answers: [string, string | Error, string][] = [
        ['a share (also a mapped drive Z:)', '\\\\h\\s\\sb\\migration-input\\audio', 'not'],
        ['\\\\?\\UNC\\', '\\\\?\\UNC\\h\\s\\sb\\migration-input\\audio', 'not'],
        ['\\\\.\\UNC\\', '\\\\.\\UNC\\h\\s\\sb\\migration-input\\audio', 'not'],
        [
          '\\\\?\\Volume{…}',
          '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\sb\\migration-input\\audio',
          'not',
        ],
        [
          'Volume{…}',
          'Volume{00000000-0000-0000-0000-000000000000}\\sb\\migration-input\\audio',
          'not',
        ],
        ['\\\\?\\C:', '\\\\?\\C:\\sb\\migration-input\\audio', 'not'],
        ['\\\\.\\C:', '\\\\.\\C:\\sb\\migration-input\\audio', 'not'],
        ['C:sb (drive-relative)', 'C:sb\\migration-input\\audio', 'not'],
        ['//h/s', '//h/s/sb/migration-input/audio', 'not'],
        ["''", '', 'not'],
        [
          'an ENOENT throw',
          Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
          'not',
        ],
        ["X:\\ (a subst drive's target)", 'X:\\sb\\migration-input\\audio', 'ok'],
        ['/sb/…', '/sb/migration-input/audio', 'ok'],
      ]
      for (const [label, answer, want] of answers) {
        const double = realPathAnswering(new Map([[audio, answer]]))
        const r = await planTakedown(reader, ID, null, root, double.realPath)
        if (!r.ok) refusals.push(r)
        expect
          .soft(r.ok ? 'ok' : r.code, `(g1) ${label}`)
          .toBe(want === 'ok' ? 'ok' : 'takedown-not-on-this-pc')
        expect
          .soft(
            double.asked.includes(audio),
            `(g1) the double was asked about the audio folder: ${label}`,
          )
          .toBe(true)
      }

      if (process.platform !== 'win32') {
        console.log('skipped: device-prefixed and 8.3 roots need a win32 host')
      } else {
        for (const prefix of ['\\\\?\\', '\\\\.\\']) {
          const r = await planTakedown(reader, ID, null, `${prefix}${root}`, native)
          expect.soft(r.ok ? 'ok' : r.code, `(g2) the root as ${prefix} + root`).toBe('ok')
        }
        const short = shortPathOf(root)
        if (short === null || short.toLowerCase() === root.toLowerCase()) {
          console.log('skipped: the temp root has no 8.3 short name')
        } else {
          const r = await planTakedown(reader, ID, null, short, native)
          expect.soft(r.ok ? 'ok' : r.code, '(g2) the 8.3 short form of the root').toBe('ok')
        }
      }

      // g3: links on each fixed segment, each in its own root.
      const linkSamples: [string, (dir: string) => void, string][] = [
        [
          'migration-input a junction to a copy',
          (dir) => {
            renameSync(join(dir, 'migration-input'), join(dir, 'mi-copy'))
            symlinkSync(join(dir, 'mi-copy'), join(dir, 'migration-input'), 'junction')
          },
          'hash-list-invalid',
        ],
        [
          'audio a junction',
          (dir) => {
            renameSync(audioDir(dir), join(dir, 'audio-copy'))
            symlinkSync(join(dir, 'audio-copy'), audioDir(dir), 'junction')
          },
          'hash-list-invalid',
        ],
        [
          'SHA256SUMS.txt a junction to a folder',
          (dir) => {
            rmSync(listFile(dir))
            mkdirSync(join(dir, 'a-folder'))
            symlinkSync(join(dir, 'a-folder'), listFile(dir), 'junction')
          },
          'hash-list-invalid',
        ],
      ]
      for (const [label, make, code] of linkSamples) {
        const dir = newRoot()
        seedAudio(dir, [two])
        make(dir)
        const r = await planTakedown(reader, ID, null, dir, native)
        if (!r.ok) refusals.push({ ...r, dir })
        expect.soft(r.ok ? 'ok' : r.code, `(g3) ${label}`).toBe(code)
      }
      const home = newRoot()
      seedAudio(home, [two])
      const holder = newRoot()
      const linked = join(holder, 'root-link')
      symlinkSync(home, linked, 'junction')
      const viaLink = await planTakedown(reader, ID, null, linked, native)
      expect
        .soft(viaLink.ok, '(g3) the root itself a junction to the tree: ok (L7 residual)')
        .toBe(true)

      // g4: file forms, each in its own root.
      const big = newRoot()
      writeAudioTree(big, [two])
      // The literal (D15B-9's 1 MiB + 1), so a raised cap (MU15B-156) changes the code, not this sample.
      writeList(big, await bigList(1_048_577))
      const fileSamples: [string, () => string, string][] = [
        [
          'the list a folder',
          () => {
            const dir = newRoot()
            writeAudioTree(dir, [two])
            mkdirSync(listFile(dir), { recursive: true })
            return dir
          },
          'hash-list-invalid',
        ],
        ['1,048,577 bytes of valid lines', () => big, 'hash-list-invalid'],
        [
          'sha256sums.txt',
          () => {
            const dir = newRoot()
            writeAudioTree(dir, [two])
            writeFileSync(join(audioDir(dir), 'sha256sums.txt'), hashListOf([two]))
            return dir
          },
          'hash-list-missing',
        ],
        [
          'absent',
          () => {
            const dir = newRoot()
            writeAudioTree(dir, [two])
            return dir
          },
          'hash-list-missing',
        ],
      ]
      for (const [label, make, code] of fileSamples) {
        const dir = make()
        const r = await planTakedown(reader, ID, null, dir, native)
        if (!r.ok) refusals.push({ ...r, dir })
        expect.soft(r.ok ? 'ok' : r.code, `(g4) ${label}`).toBe(code)
      }
      expect
        .soft(typeof realPathRequiredSamples, '(g5) the type-only samples compile, never called')
        .toBe('function')
      // g6 (AUD-11): every refusal holds exactly ok and code, and no form of any root.
      for (const refusal of refusals) {
        const { dir, ...result } = refusal as { dir?: string; ok: false; code: string }
        expect
          .soft(Object.keys(result).sort(), '(g6) a refusal holds exactly ok and code')
          .toEqual(['code', 'ok'])
        const text = JSON.stringify(result)
        expect.soft(leaks(text, dir ?? root), `(g6) no root form in ${text}`).toEqual([])
      }
      expect(refusals.length, 'precondition: g6 checked every refusal').toBeGreaterThan(10)
      for (const each of stubs) expectDeletesConfined(each, ID)
    },
  )

  it(
    'T15B-26 the MP3 proof per object: a line of the same story and a local file with its sha256 and size; any other MP3 is unproven and kept, never deleted; packages and images need no proof, but the list is always read (A9, L9, CRIT-6, CRIT-10, CRIT-11b-c, TP-5)',
    TIMEOUT,
    async () => {
      const two = await fullyBoundStory(await storyOf())
      const mp3s = mp3Paths(two)
      expect(mp3s.length, 'precondition: several MP3s').toBeGreaterThanOrEqual(3)
      const stub = await newStub()
      putStory(stub, two)
      const reader = client(stub)
      seedAudio(root, [two])
      const base = await planTakedown(reader, ID, null, root, native)
      expect(
        base.ok ? [base.plan.counts.mp3Unproven, base.plan.kept] : base,
        'precondition: the plan is ok, nothing kept',
      ).toEqual([0, []])
      const total = storyPaths(two).length
      const target = mp3s[0]!
      const media = two.media.find((m) => m.path === target)!
      const file = hashListOf([two])
        .split('\n')
        .find((row) => row.startsWith(media.sha256))!
        .slice(66)
        .split('/')[1]!
      const localOf = (dir: string) => join(audioDir(dir), ID, file)
      const plans: TakedownPlan[] = []
      const counts = (kept: number) => ({
        packages: 1,
        media: total - 1,
        mp3: mp3s.length,
        mp3Unproven: kept,
        images: total - 1 - mp3s.length,
      })
      /** One sample in its own root: `make` changes it; the plan must keep `kept`. */
      const sample = async (
        label: string,
        make: (dir: string) => void | Promise<void>,
        kept: readonly string[],
        planReader: StorageReader = reader,
      ) => {
        const dir = newRoot()
        seedAudio(dir, [two])
        await make(dir)
        const r = await planTakedown(planReader, ID, null, dir, native)
        if (r.ok) plans.push(r.plan)
        expect
          .soft(r.ok ? [r.plan.kept, r.plan.counts] : r, `(g1) unproven, kept: ${label}`)
          .toEqual([sorted(kept), counts(kept.length)])
        expect
          .soft(r.ok ? r.plan.paths : [], `(g1) every object still in the plan's paths: ${label}`)
          .toEqual(sorted(storyPaths(two)))
        return dir
      }
      await sample(
        "the object's sha256 not in the list",
        (dir) =>
          writeList(
            dir,
            hashListOf([two])
              .split('\n')
              .filter((row) => !row.startsWith(media.sha256))
              .join('\n'),
          ),
        [target],
      )
      await sample(
        'its line under river-stones/ (the file there too)',
        (dir) => {
          mkdirSync(join(audioDir(dir), RIVER), { recursive: true })
          writeFileSync(join(audioDir(dir), RIVER, file), media.bytes)
          writeList(dir, hashListOf([two]).replace(`  ${ID}/${file}`, `  ${RIVER}/${file}`))
        },
        [target],
      )
      await sample('the local file missing', (dir) => rmSync(localOf(dir)), [target])
      await sample(
        'one byte changed',
        (dir) => {
          const bytes = Uint8Array.from(media.bytes)
          bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff
          writeFileSync(localOf(dir), bytes)
        },
        [target],
      )
      await sample('truncated', (dir) => writeFileSync(localOf(dir), media.bytes.slice(0, -1)), [
        target,
      ])
      // The stored object has other bytes (its listed size differs); the local file is correct.
      const resized = await newStub()
      putStory(resized, two)
      resized.put('content', target, Uint8Array.from([...media.bytes, 0x20]), 'audio/mpeg')
      await sample('the listed size differs', () => {}, [target], client(resized))
      await sample(
        'a null listed size (fake reader)',
        () => {},
        [target],
        fakeReader(reader, (_folder, real) =>
          real.kind === 'listed'
            ? {
                kind: 'listed',
                objects: real.objects.map((o) => (o.path === target ? { ...o, size: null } : o)),
              }
            : real,
        ),
      )
      await sample(
        'audio/two-paths a junction (every MP3 of the story kept)',
        (dir) => {
          renameSync(join(audioDir(dir), ID), join(audioDir(dir), 'real-two'))
          symlinkSync(join(audioDir(dir), 'real-two'), join(audioDir(dir), ID), 'junction')
        },
        mp3s,
      )
      {
        const dir = newRoot()
        seedAudio(dir, [two])
        renameSync(join(audioDir(dir), ID), join(audioDir(dir), 'real-two'))
        if (
          trySymlink(
            join(audioDir(dir), 'real-two'),
            join(audioDir(dir), ID),
            'dir',
            'directory symlink',
          )
        ) {
          const r = await planTakedown(reader, ID, null, dir, native)
          if (r.ok) plans.push(r.plan)
          expect
            .soft(
              r.ok ? r.plan.kept : r,
              '(g1) unproven, kept: audio/two-paths a directory symlink',
            )
            .toEqual(mp3s)
        }
      }
      {
        const dir = newRoot()
        seedAudio(dir, [two])
        const copy = join(dir, 'copy.mp3')
        writeFileSync(copy, media.bytes)
        rmSync(localOf(dir))
        if (trySymlink(copy, localOf(dir), 'file', 'file symlink')) {
          const r = await planTakedown(reader, ID, null, dir, native)
          if (r.ok) plans.push(r.plan)
          expect
            .soft(r.ok ? r.plan.kept : r, '(g1) unproven, kept: the MP3 file a symlink')
            .toEqual([target])
        }
      }
      await sample(
        'the file a folder',
        (dir) => {
          rmSync(localOf(dir))
          mkdirSync(localOf(dir))
        },
        [target],
      )

      // g2: the second MP3 (sorted) fails, the first and the third pass.
      const middle = mp3s[1]!
      const middleMedia = two.media.find((m) => m.path === middle)!
      const middleFile = hashListOf([two])
        .split('\n')
        .find((row) => row.startsWith(middleMedia.sha256))!
        .slice(66)
        .split('/')[1]!
      {
        const dir = newRoot()
        seedAudio(dir, [two])
        rmSync(join(audioDir(dir), ID, middleFile))
        const r = await planTakedown(reader, ID, null, dir, native)
        expect.soft(r.ok ? r.plan.kept : r, '(g2) only the second MP3 kept').toEqual([middle])
      }
      // g3: two lines share one sha256; the first one's file is missing, the second proves.
      {
        const dir = newRoot()
        seedAudio(dir, [two])
        writeList(dir, line(media.sha256, `${ID}/aaa_missing.en.mp3`) + hashListOf([two]))
        const r = await planTakedown(reader, ID, null, dir, native)
        expect
          .soft(r.ok ? r.plan.kept : r, '(g3) the second line with the sha proves it')
          .toEqual([])
      }
      // g4: an image-only story whose audio folder exists without the list.
      {
        const images = await newStub()
        images.put('content', packagePathOf(two), two.packageBytes, 'application/json')
        for (const m of two.media.filter((x) => x.mime !== 'audio/mpeg')) {
          images.put('content', m.path, m.bytes, m.mime)
        }
        const dir = newRoot()
        mkdirSync(audioDir(dir), { recursive: true })
        const r = await planTakedown(client(images), ID, null, dir, native)
        expect.soft(r, '(g4) no MP3, no list: hash-list-missing').toEqual({
          ok: false,
          code: 'hash-list-missing',
        })
      }
      // g5 (AUD-11): no root form in any g1 plan, and kept holds class paths only.
      expect(plans.length, 'precondition: g5 reads the g1 plans').toBeGreaterThan(8)
      for (const plan of plans) {
        const text = JSON.stringify(plan)
        const forms = extraRoots.flatMap((dir) => rootForms(dir)).filter((f) => text.includes(f))
        expect.soft(forms, '(g5) no temp-root form in a plan').toEqual([])
        expect
          .soft(
            plan.kept.every((p) => classOfPath('content', p)?.kind === 'media'),
            '(g5) kept holds storage paths of the class rule only',
          )
          .toBe(true)
      }
      for (const each of stubs) expectDeletesConfined(each, ID)
    },
  )

  it(
    'T15B-27 own entry in the P and S states: its package path and every head must be listed, and its package must pass the gate, else takedown-check-failed at plan (CRIT-17a)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const stub = await newStub()
      await stageIn(stub, [two])
      const entry = pointed(stub, 'staging')!.stories.find((e) => e.storyId === ID)!
      // No list file: a plan that reached the hash list would say hash-list-missing.
      const bare = newRoot()
      mkdirSync(audioDir(bare), { recursive: true })
      const head = two.media[0]!.path
      const samples: [string, StorageReader][] = [
        [
          'its package read as deleted',
          client(stub, wrapFetch({ deleted: new Set([packagePathOf(two)]) })),
        ],
        ['one head deleted', client(stub, wrapFetch({ deleted: new Set([head]) }))],
        ['a blind listing', fakeReader(client(stub), () => listed([]))],
      ]
      for (const [label, reader] of samples) {
        expect
          .soft(await planTakedown(reader, ID, entry, bare, native), `(g1) ${label}`)
          .toEqual({ ok: false, code: 'takedown-check-failed' })
      }
      seedAudio(root, [two])
      const control = await planTakedown(client(stub), ID, null, root, native)
      expect.soft(control.ok, '(g1) entry null with the objects present: ok').toBe(true)
      const pretty = encode(JSON.stringify(two.pkg, null, 2))
      const prettySha = await sha256Hex(pretty)
      const prettyPath = `packages/${ID}/${prettySha}.json`
      stub.put('content', prettyPath, pretty, 'application/json')
      const prettyEntry: SnapshotEntry = {
        ...entry,
        packageSha256: prettySha,
        packagePath: prettyPath,
      }
      expect
        .soft(
          await planTakedown(client(stub), ID, prettyEntry, root, native),
          '(g2) its package stored pretty-printed under its sha256',
        )
        .toEqual({ ok: false, code: 'takedown-check-failed' })
      for (const each of stubs) expectDeletesConfined(each, ID)
    },
  )
})

// ---- T15B-28 to T15B-31: the takedown commit ----

describe('the takedown commit', () => {
  it(
    'T15B-28 commitTakedown: steps 1-8 in order, chunks of at most 100 in sorted order, both pointers re-read before each chunk, the deleter built once after every check, the store after exact (A11, D15B-11, L12, TP-3)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const stub = await newStub()
      await neitherState(stub, two)
      const orphans: string[] = []
      for (let i = 0; i < 250; i++) {
        const path = `media/${ID}/${await hex(`orphan-${i}`)}-w${i}.webp`
        stub.put('content', path, webpBytes(`orphan-${i}`), 'image/webp')
        orphans.push(path)
      }
      const reader = client(stub)
      const planned = await planTakedown(reader, ID, null, root, native)
      expect(planned.ok, 'precondition: the plan is ok').toBe(true)
      if (!planned.ok) return
      const plan = planned.plan
      const keep = [
        ...storyPaths(river),
        'catalogue/production.json',
        'catalogue/staging.json',
        'catalogue/snapshots/1.json',
        'catalogue/snapshots/2.json',
      ]
      const before = new Map(keep.map((p) => [p, stub.object('content', p)?.bytes]))
      const waiverPath = `waivers/${RIVER}/${river.waiverSha256}.json`
      const waiverBefore = stub.object('masters', waiverPath)?.bytes
      const mark = stub.requests.length
      const { made, makeRemover } = removers(stub, ID)
      const chunks: [number, number][] = []
      const result = await commitTakedown(
        reader,
        makeRemover,
        plan,
        root,
        { onChunk: (removed, total) => void chunks.push([removed, total]) },
        native,
      )
      const log = stub.requests.slice(mark)
      expect
        .soft(classes(log), '(g1) the request classes after the mark, in order')
        .toEqual([
          'catalogue-list',
          'production-read',
          'snapshot-read',
          'staging-read',
          'snapshot-read',
          'package',
          'packages-list',
          'media-list',
          'production-read',
          'staging-read',
          'delete',
          'production-read',
          'staging-read',
          'delete',
          'production-read',
          'staging-read',
          'delete',
          'packages-list',
          'media-list',
          'production-read',
          'staging-read',
        ])
      const bodies = deletes(log).map(deleteBody)
      const t = plan.paths.length - plan.kept.length
      expect
        .soft(
          bodies.map((b) => b.length),
          '(g2) three DELETEs of 100, 100 and the rest',
        )
        .toEqual([100, 100, t - 200])
      expect
        .soft(bodies.flat(), '(g2) their union is the plan minus kept, sorted, with no overlap')
        .toEqual(sorted(plan.paths.filter((p) => !plan.kept.includes(p))))
      const firstDelete = stub.requests.findIndex((r, i) => i >= mark && r.method === 'DELETE')
      const lastList = stub.requests.findLastIndex(
        (r, i) => i >= mark && i < firstDelete && r.pathname === LIST_PATH,
      )
      expect
        .soft(
          [made.length, made[0] !== undefined && made[0] > lastList && made[0] <= firstDelete],
          '(g3) one makeRemover, after the second listing and before the first DELETE',
        )
        .toEqual([1, true])
      expect.soft(chunks, '(g3) onChunk gets the running removed count and the total').toEqual([
        [100, t],
        [200, t],
        [t, t],
      ])
      expect
        .soft(
          plan.paths.filter((p) => stub.object('content', p) !== undefined),
          '(g4) every planned path is gone',
        )
        .toEqual([])
      expect
        .soft(
          keep.filter((p) => {
            const now = stub.object('content', p)?.bytes
            const was = before.get(p)
            return (
              now === undefined || was === undefined || !Buffer.from(now).equals(Buffer.from(was))
            )
          }),
          "(g4) river-stones' objects, both pointers and every snapshot byte-identical",
        )
        .toEqual([])
      expect
        .soft(
          Buffer.from(stub.object('masters', waiverPath)?.bytes ?? []).equals(
            Buffer.from(waiverBefore ?? [0]),
          ),
          '(g4) masters byte-identical',
        )
        .toBe(true)
      expect.soft(result, '(g5) the result').toEqual({ ok: true, removed: t, kept: [] })
      expect(orphans.length + 4, 'precondition: 254 objects planned').toBe(plan.paths.length)
      expectDeletesConfined(stub, ID, plan.paths)
    },
  )

  it(
    'T15B-29 commit refusals before or between chunks: still-named, check-failed, raced, not-on-this-pc, a repeated path, a fresh listing that lost planned paths with nothing left to delete; nothing is deleted before the checks pass (A11, L11, L12, CRIT-9, CRIT-11a, TP-5, TP-8, S15B-R1-SEC-1)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const river = await storyOf(RIVER)
      const noop = { onChunk: () => {} }
      const zeroDeletes = (stub: StorageStub, mark: number) =>
        deletes(stub.requests.slice(mark)).length

      // g1: the story still named.
      {
        const stub = await newStub()
        await stageIn(stub, [two, river])
        const staged = pointed(stub, 'staging')!.stories
        await putDocuments(stub, 'production', 2, [
          approved(staged.find((e) => e.storyId === RIVER)!),
        ])
        seedAudio(root, [two])
        const reader = client(stub)
        const plan = await planTakedown(reader, ID, null, root, native)
        expect(plan.ok, 'precondition: g1 plan').toBe(true)
        if (!plan.ok) return
        const mark = stub.requests.length
        const { made, makeRemover } = removers(stub, ID)
        const r = await commitTakedown(reader, makeRemover, plan.plan, root, noop, native)
        expect
          .soft([r, zeroDeletes(stub, mark), made.length], '(g1) staging still names two-paths')
          .toEqual([{ ok: false, code: 'takedown-still-named', removed: 0 }, 0, 0])
        const stub2 = await newStub()
        await neitherState(stub2, two)
        const reader2 = client(stub2)
        const plan2 = await planTakedown(reader2, ID, null, root, native)
        if (!plan2.ok) throw new Error('test setup: g1 second plan')
        const stagedTwo = pointed(stub, 'staging')!.stories.find((e) => e.storyId === ID)!
        const riverProd = pointed(stub2, 'production')!.stories
        await putDocuments(stub2, 'production', 3, [...riverProd, approved(stagedTwo)])
        const mark2 = stub2.requests.length
        const second = removers(stub2, ID)
        const r2 = await commitTakedown(reader2, second.makeRemover, plan2.plan, root, noop, native)
        expect
          .soft(
            [r2, zeroDeletes(stub2, mark2), second.made.length],
            '(g1) a production naming two-paths stored after the plan',
          )
          .toEqual([{ ok: false, code: 'takedown-still-named', removed: 0 }, 0, 0])
      }

      // g2: takedown-check-failed.
      const checkFailed: [string, (stub: StorageStub) => Promise<void> | void][] = [
        [
          'the catalogue list answered 500',
          (stub) =>
            stub.override('POST', LIST_PATH, {
              kind: 'answer',
              status: 500,
              body: '{"statusCode":"500"}',
            }),
        ],
        [
          'the river-stones package read answered 500',
          (stub) =>
            stub.override('GET', `${READ}content/${packagePathOf(river)}`, {
              kind: 'answer',
              status: 500,
              body: '{"statusCode":"500"}',
            }),
        ],
        [
          "a staging snapshot whose river entry's packagePath names packages/two-paths/",
          async (stub) => {
            const entry = pointed(stub, 'staging')!.stories.find((e) => e.storyId === RIVER)!
            const forged = { ...entry, packagePath: packagePathOf(two) }
            const snapshot = {
              schemaVersion: '1.0',
              seq: 3,
              createdAt: NOW,
              note: 'forged',
              featuredStoryId: null,
              stories: [forged],
            }
            const snapshotBytes = jcsBytes(snapshot)
            const pointer = {
              schemaVersion: '1.0',
              seq: 3,
              snapshotPath: 'catalogue/snapshots/3.json',
              snapshotSha256: await sha256Hex(snapshotBytes),
              updatedAt: NOW,
            }
            stub.put('content', 'catalogue/snapshots/3.json', snapshotBytes, 'application/json')
            stub.put('content', 'catalogue/staging.json', jcsBytes(pointer), 'application/json')
          },
        ],
        [
          'a river-stones package naming a media path under media/two-paths/ (CRIT-9)',
          async (stub) => {
            const entry = pointed(stub, 'staging')!.stories.find((e) => e.storyId === RIVER)!
            const image = river.pkg.assets.find((a) => a.kind === 'image')!
            const foreign = {
              ...river.pkg,
              assets: river.pkg.assets.map((a) =>
                a === image
                  ? {
                      ...a,
                      variants: a.variants.map((v, i) =>
                        i === 0 ? { ...v, path: two.media[0]!.path } : v,
                      ),
                    }
                  : a,
              ),
            } as StoryPackageV1
            const forged = await withPackage(river, foreign)
            stub.put('content', packagePathOf(forged), forged.packageBytes, 'application/json')
            await putDocuments(stub, 'staging', 3, [
              { ...entry, packageSha256: forged.packageSha256, packagePath: packagePathOf(forged) },
            ])
          },
        ],
      ]
      for (const [label, inject] of checkFailed) {
        const stub = await newStub()
        await neitherState(stub, two)
        const reader = client(stub)
        const plan = await planTakedown(reader, ID, null, root, native)
        if (!plan.ok) throw new Error(`test setup: g2 plan ${label}`)
        await inject(stub)
        const mark = stub.requests.length
        const { made, makeRemover } = removers(stub, ID)
        const r = await commitTakedown(reader, makeRemover, plan.plan, root, noop, native)
        expect
          .soft([r, zeroDeletes(stub, mark), made.length], `(g2) ${label}`)
          .toEqual([{ ok: false, code: 'takedown-check-failed', removed: 0 }, 0, 0])
      }

      // g3: raced.
      {
        const stub = await newStub()
        await neitherState(stub, two)
        const reader = client(stub)
        const plan = await planTakedown(reader, ID, null, root, native)
        if (!plan.ok) throw new Error('test setup: g3 plan')
        stub.put(
          'content',
          `media/${ID}/${await hex('late')}-w9.webp`,
          webpBytes('late'),
          'image/webp',
        )
        const mark = stub.requests.length
        const { makeRemover } = removers(stub, ID)
        const r = await commitTakedown(reader, makeRemover, plan.plan, root, noop, native)
        expect
          .soft([r, zeroDeletes(stub, mark)], '(g3) a new two-paths media object after the plan')
          .toEqual([{ ok: false, code: 'takedown-raced', removed: 0 }, 0])
      }
      for (const [label, which, mode] of [
        ['a new staging pointer after DELETE 1', 1, 'staging'],
        ['a new production pointer after the last DELETE', 2, 'production'],
      ] as const) {
        const stub = await newStub()
        await neitherState(stub, two)
        for (let i = 0; i < 146; i++) {
          stub.put(
            'content',
            `media/${ID}/${await hex(`r-${i}`)}-w${i}.webp`,
            webpBytes(`r-${i}`),
            'image/webp',
          )
        }
        const reader = client(stub)
        const plan = await planTakedown(reader, ID, null, root, native)
        if (!plan.ok) throw new Error('test setup: g3 race plan')
        let seen = 0
        const after: After = (url, init) => {
          if (init.method !== 'DELETE') return
          seen += 1
          if (seen !== which) return
          const path = `catalogue/${mode}.json`
          const bytes = stub.object('content', path)!.bytes
          stub.put('content', path, encode(`${decode(bytes)} `), 'application/json')
        }
        const mark = stub.requests.length
        const { makeRemover } = removers(stub, ID, wrapFetch({ after }))
        const r = await commitTakedown(reader, makeRemover, plan.plan, root, noop, native)
        const total = plan.plan.paths.length
        expect
          .soft([r, zeroDeletes(stub, mark)], `(g3) ${label}`)
          .toEqual(
            which === 1
              ? [{ ok: false, code: 'takedown-raced', removed: 100 }, 1]
              : [{ ok: false, code: 'takedown-raced', removed: total }, 2],
          )
      }

      // g4: not on this PC at commit.
      {
        const stub = await newStub()
        await neitherState(stub, two)
        const reader = client(stub)
        const answers = new Map<string, string | Error>()
        const double = realPathAnswering(answers)
        const plan = await planTakedown(reader, ID, null, root, double.realPath)
        if (!plan.ok) throw new Error('test setup: g4 plan')
        answers.set(audioDir(root), '\\\\h\\s\\sb\\migration-input\\audio')
        const mark = stub.requests.length
        const r = await commitTakedown(
          reader,
          removers(stub, ID).makeRemover,
          plan.plan,
          root,
          noop,
          double.realPath,
        )
        expect
          .soft([r, zeroDeletes(stub, mark)], '(g4) realPath local at plan, a share at commit')
          .toEqual([{ ok: false, code: 'takedown-not-on-this-pc', removed: 0 }, 0])
        const plan2 = await planTakedown(reader, ID, null, root, native)
        if (!plan2.ok) throw new Error('test setup: g4 second plan')
        rmSync(listFile(root))
        const mark2 = stub.requests.length
        const r2 = await commitTakedown(
          reader,
          removers(stub, ID).makeRemover,
          plan2.plan,
          root,
          noop,
          native,
        )
        expect
          .soft([r2, zeroDeletes(stub, mark2)], '(g4) the list file removed after the plan')
          .toEqual([{ ok: false, code: 'takedown-not-on-this-pc', removed: 0 }, 0])
      }

      // g5: the commit's second listing names a path twice.
      {
        const stub = await newStub()
        await neitherState(stub, two)
        const reader = client(stub)
        const plan = await planTakedown(reader, ID, null, root, native)
        if (!plan.ok) throw new Error('test setup: g5 plan')
        const doubled = fakeReader(reader, (folder, real) =>
          folder.startsWith('media/') ? withExtra(real, [two.media[0]!.path]) : real,
        )
        const mark = stub.requests.length
        const r = await commitTakedown(
          doubled,
          removers(stub, ID).makeRemover,
          plan.plan,
          root,
          noop,
          native,
        )
        expect
          .soft([r, zeroDeletes(stub, mark)], '(g5) a path listed twice at commit')
          .toEqual([{ ok: false, code: 'takedown-check-failed', removed: 0 }, 0])
      }

      // g6 (AUD-1): the commit re-proves every MP3.
      const bound = await fullyBoundStory(two)
      const boundMp3 = mp3Paths(bound)
      const fileOf = (path: string) => {
        const m = bound.media.find((x) => x.path === path)!
        return hashListOf([bound])
          .split('\n')
          .find((row) => row.startsWith(m.sha256))!
          .slice(66)
          .split('/')[1]!
      }
      const changes: [string, (dir: string) => void, readonly string[]][] = [
        [
          '(a) a proven MP3 file deleted',
          (dir) => rmSync(join(audioDir(dir), ID, fileOf(boundMp3[0]!))),
          [boundMp3[0]!],
        ],
        [
          '(b) truncated by one byte',
          (dir) => {
            const path = join(audioDir(dir), ID, fileOf(boundMp3[0]!))
            writeFileSync(path, readFileSync(path).subarray(0, -1))
          },
          [boundMp3[0]!],
        ],
        [
          '(c) one byte changed',
          (dir) => {
            const path = join(audioDir(dir), ID, fileOf(boundMp3[0]!))
            const bytes = Uint8Array.from(readFileSync(path))
            bytes[0] = bytes[0]! ^ 0xff
            writeFileSync(path, bytes)
          },
          [boundMp3[0]!],
        ],
        [
          '(d) audio/two-paths replaced by a junction to a correct copy',
          (dir) => {
            cpSync(join(audioDir(dir), ID), join(dir, 'copy-two'), { recursive: true })
            rmSync(join(audioDir(dir), ID), { recursive: true })
            symlinkSync(join(dir, 'copy-two'), join(audioDir(dir), ID), 'junction')
          },
          boundMp3,
        ],
      ]
      for (const [label, change, kept] of changes) {
        const stub = await newStub()
        const dir = newRoot()
        await neitherState(stub, bound, dir)
        const reader = client(stub)
        const plan = await planTakedown(reader, ID, null, dir, native)
        if (!plan.ok || plan.plan.kept.length !== 0) throw new Error(`test setup: g6 ${label}`)
        change(dir)
        const keptBytes = kept.map((p) => stub.object('content', p)?.bytes)
        const r = await commitTakedown(
          reader,
          removers(stub, ID).makeRemover,
          plan.plan,
          dir,
          noop,
          native,
        )
        const t = plan.plan.paths.length
        expect
          .soft(r, `(g6) ${label}: removed t - k, kept that MP3`)
          .toEqual({ ok: true, removed: t - kept.length, kept: sorted(kept) })
        expect
          .soft(
            () =>
              expectDeletesConfined(
                stub,
                ID,
                plan.plan.paths.filter((p) => !kept.includes(p)),
              ),
            `(g6) ${label}: no DELETE names a kept MP3`,
          )
          .not.toThrow()
        expect
          .soft(
            kept.every((p, i) => {
              const now = stub.object('content', p)?.bytes
              const was = keptBytes[i]
              return (
                now !== undefined && was !== undefined && Buffer.from(now).equals(Buffer.from(was))
              )
            }),
            `(g6) ${label}: each kept MP3 still stored byte-identical`,
          )
          .toBe(true)
        expect
          .soft(
            plan.plan.paths.filter(
              (p) => !kept.includes(p) && stub.object('content', p) !== undefined,
            ),
            `(g6) ${label}: every other planned object gone`,
          )
          .toEqual([])
      }

      // g7 (S15B-R1-SEC-1): the commit's fresh listing lost planned paths and nothing is left to
      // delete; a fake reader rewrites only the story's two folders at commit.
      const mp3 = two.media.find((m) => m.mime === 'audio/mpeg')!
      const folders = new Set([`packages/${ID}/`, `media/${ID}/`])
      const vanished: [string, () => Promise<{ stub: StorageStub; dir: string }>, string[]][] = [
        [
          '(a) both folders listed empty (a blind listing)',
          async () => {
            const stub = await newStub()
            await neitherState(stub, two)
            return { stub, dir: root }
          },
          [],
        ],
        [
          '(b) only the kept MP3 listed (the package and images left out)',
          async () => {
            const stub = await newStub()
            const dir = newRoot()
            await neitherState(stub, two, dir)
            writeList(dir, line(await hex('another'), `${ID}/other.en.mp3`))
            return { stub, dir }
          },
          [mp3.path],
        ],
        [
          '(c) a plan holding only a kept MP3, both folders listed empty',
          async () => {
            const stub = await newStub()
            stub.put('content', mp3.path, mp3.bytes, mp3.mime)
            await stageIn(stub, [river])
            const staged = pointed(stub, 'staging')!.stories
            await putDocuments(stub, 'production', 2, [approved(staged[0]!)])
            const dir = newRoot()
            writeAudioTree(dir, [two])
            writeList(dir, line(await hex('another'), `${ID}/other.en.mp3`))
            return { stub, dir }
          },
          [],
        ],
      ]
      for (const [label, make, shown] of vanished) {
        const { stub, dir } = await make()
        const reader = client(stub)
        const plan = await planTakedown(reader, ID, null, dir, native)
        if (!plan.ok) throw new Error(`test setup: g7 plan ${label}`)
        const before = plan.plan.paths.map((p) => stub.object('content', p)?.bytes)
        const lost = fakeReader(reader, (folder, real) =>
          folders.has(folder) ? listed(shown.filter((p) => p.startsWith(folder))) : real,
        )
        const mark = stub.requests.length
        const { made, makeRemover } = removers(stub, ID)
        const r = await commitTakedown(lost, makeRemover, plan.plan, dir, noop, native)
        expect
          .soft(
            [
              r,
              zeroDeletes(stub, mark),
              made.length,
              plan.plan.paths.every((p, i) => {
                const now = stub.object('content', p)?.bytes
                const was = before[i]
                return (
                  now !== undefined &&
                  was !== undefined &&
                  Buffer.from(now).equals(Buffer.from(was))
                )
              }),
            ],
            `(g7) ${label}: takedown-check-failed, no deleter, no DELETE, every planned object stored`,
          )
          .toEqual([{ ok: false, code: 'takedown-check-failed', removed: 0 }, 0, 0, true])
      }
      for (const each of stubs) expectDeletesConfined(each, ID)
    },
  )

  it(
    'T15B-30 partial failure and re-run: any chunk result but removed stops with takedown-incomplete after a re-list, never retried, no later chunk; a re-run plans what is left and converges; an all-kept delete set builds no deleter (A12, L15, D15B-12, TP-7)',
    TIMEOUT,
    async () => {
      const two = await storyOf()
      const noop = { onChunk: () => {} }
      // g1: one path kept by the DELETE.
      const stub = await newStub()
      await neitherState(stub, two)
      const reader = client(stub)
      const plan = await planTakedown(reader, ID, null, root, native)
      if (!plan.ok) throw new Error('test setup: g1 plan')
      const keptPath = plan.plan.paths[0]!
      stub.override('DELETE', DELETE_PATH, { kind: 'keep', paths: [keptPath] })
      const r1 = await commitTakedown(
        reader,
        removers(stub, ID).makeRemover,
        plan.plan,
        root,
        noop,
        native,
      )
      const n = plan.plan.paths.length
      expect
        .soft(r1, '(g1) a keep of one path: takedown-incomplete, removed n-1')
        .toEqual({ ok: false, code: 'takedown-incomplete', removed: n - 1 })
      const left = await reader.listContent(`media/${ID}/`)
      const leftPackages = await reader.listContent(`packages/${ID}/`)
      const remaining = [left, leftPackages].flatMap((l) =>
        l.kind === 'listed' ? l.objects.map((o) => o.path) : ['failed'],
      )
      expect.soft(remaining, '(g1) the re-list shows that one path').toEqual([keptPath])

      // g2: the answer lost after the DELETE landed, and a truncated answer.
      for (const [label, inject] of [
        ['the answer lost after landing', 'after'],
        ['a truncate override', 'truncate'],
      ] as const) {
        const own = await newStub()
        await neitherState(own, two)
        const ownReader = client(own)
        const ownPlan = await planTakedown(ownReader, ID, null, root, native)
        if (!ownPlan.ok) throw new Error(`test setup: g2 ${label}`)
        let thrown = 0
        const fetchImpl =
          inject === 'after'
            ? wrapFetch({
                after: (_url, init) => {
                  if (init.method === 'DELETE' && thrown === 0) {
                    thrown += 1
                    throw new TypeError('connection lost after the DELETE landed')
                  }
                },
              })
            : undefined
        if (inject === 'truncate') {
          own.override('DELETE', DELETE_PATH, { kind: 'truncate', declared: 400, sent: 10 })
        }
        const r = await commitTakedown(
          ownReader,
          removers(own, ID, fetchImpl).makeRemover,
          ownPlan.plan,
          root,
          noop,
          native,
        )
        expect
          .soft(r, `(g2) ${label}: incomplete, the gone chunk counted`)
          .toEqual({ ok: false, code: 'takedown-incomplete', removed: ownPlan.plan.paths.length })
        expect
          .soft(
            ownPlan.plan.paths.filter((p) => own.object('content', p) !== undefined),
            `(g2) ${label}: the re-list shows the chunk gone`,
          )
          .toEqual([])
      }

      // g3: chunk 1 of 150 answered 401, 503 or {}.
      for (const [label, status, body] of [
        ['401', 401, '{"statusCode":"401"}'],
        ['503', 503, '{"statusCode":"503"}'],
        ['{}', 200, '{}'],
      ] as const) {
        const own = await newStub()
        await neitherState(own, two)
        for (let i = 0; i < 146; i++) {
          own.put(
            'content',
            `media/${ID}/${await hex(`c-${i}`)}-w${i}.webp`,
            webpBytes(`c-${i}`),
            'image/webp',
          )
        }
        const ownReader = client(own)
        const ownPlan = await planTakedown(ownReader, ID, null, root, native)
        if (!ownPlan.ok) throw new Error(`test setup: g3 ${label}`)
        own.override('DELETE', DELETE_PATH, {
          kind: 'answer',
          status,
          body,
          headers: { 'content-type': 'application/json' },
        })
        const mark = own.requests.length
        const r = await commitTakedown(
          ownReader,
          removers(own, ID).makeRemover,
          ownPlan.plan,
          root,
          noop,
          native,
        )
        const first = sorted(ownPlan.plan.paths).slice(0, 100)
        expect
          .soft(
            [
              r,
              deletes(own.requests.slice(mark)).length,
              first.every((p) => own.object('content', p) !== undefined),
            ],
            `(g3) DELETE 1 answered ${label}: incomplete, one DELETE, the chunk still stored`,
          )
          .toEqual([{ ok: false, code: 'takedown-incomplete', removed: 0 }, 1, true])
      }

      // g4: the re-run after g1, and an all-kept delete set.
      const rePlan = await planTakedown(reader, ID, null, root, native)
      expect
        .soft(
          rePlan.ok ? rePlan.plan.paths : rePlan,
          '(g4) a fresh plan holds exactly the kept path',
        )
        .toEqual([keptPath])
      if (rePlan.ok) {
        const r = await commitTakedown(
          reader,
          removers(stub, ID).makeRemover,
          rePlan.plan,
          root,
          noop,
          native,
        )
        expect.soft(r, '(g4) its commit removes it').toEqual({ ok: true, removed: 1, kept: [] })
      }
      const only = await newStub()
      const mp3 = two.media.find((m) => m.mime === 'audio/mpeg')!
      only.put('content', mp3.path, mp3.bytes, mp3.mime)
      const river = await storyOf(RIVER)
      await stageIn(only, [river])
      const staged = pointed(only, 'staging')!.stories
      await putDocuments(only, 'production', 2, [approved(staged[0]!)])
      const dir = newRoot()
      writeAudioTree(dir, [two])
      writeList(dir, line(await hex('another'), `${ID}/other.en.mp3`))
      const onlyReader = client(only)
      const onlyPlan = await planTakedown(onlyReader, ID, null, dir, native)
      expect
        .soft(onlyPlan.ok ? onlyPlan.plan.counts.mp3Unproven : onlyPlan, '(g4) mp3Unproven 1')
        .toBe(1)
      if (onlyPlan.ok) {
        const mark = only.requests.length
        const { made, makeRemover } = removers(only, ID)
        const r = await commitTakedown(onlyReader, makeRemover, onlyPlan.plan, dir, noop, native)
        expect
          .soft(
            [r, made.length, deletes(only.requests.slice(mark)).length],
            '(g4) an all-kept delete set: no makeRemover, no DELETE',
          )
          .toEqual([{ ok: true, removed: 0, kept: [mp3.path] }, 0, 0])
      }
      expectDeletesConfined(stub, ID)
    },
  )

  it(
    "T15B-31 confinement: hostile ids, hostile listings and forged plans never put masters, a pointer, a snapshot, an approval or another story's object in a DELETE (A10, A13, §6, TP-14)",
    TIMEOUT,
    async () => {
      const river = await storyOf(RIVER)
      const stub = await newStub()
      await stageIn(stub, [river])
      const staged = pointed(stub, 'staging')!.stories
      await putDocuments(stub, 'production', 2, [approved(staged[0]!)])
      stub.put(
        'masters',
        `approvals/${RIVER}/${river.packageSha256}.json`,
        encode('{}'),
        'application/json',
      )
      const ids = ['catalogue', 'snapshots', 'approvals', 'waivers', 'masters', 'con', 'lion']
      const own = new Map<string, string[]>()
      for (const id of ids) {
        const paths = [
          `packages/${id}/${await hex(`${id}-p`)}.json`,
          `media/${id}/${await hex(`${id}-m`)}-w768.webp`,
        ]
        stub.put('content', paths[0]!, encode('{}'), 'application/json')
        stub.put('content', paths[1]!, webpBytes(id), 'image/webp')
        own.set(id, paths)
      }
      const hare = `media/lion-and-hare/${await hex('hare')}-w768.webp`
      stub.put('content', hare, webpBytes('hare'), 'image/webp')
      const reader = client(stub)
      const everything = async () => {
        const all = await reader.listContent('')
        if (all.kind !== 'listed') throw new Error('test setup: content listing')
        const content = all.objects.map((o) => ({
          key: `content ${o.path}`,
          bytes: Buffer.from(stub.object('content', o.path)?.bytes ?? []),
        }))
        const masterPaths = [
          `waivers/${RIVER}/${river.waiverSha256}.json`,
          `approvals/${RIVER}/${river.packageSha256}.json`,
        ]
        return [
          ...content,
          ...masterPaths.map((p) => ({
            key: `masters ${p}`,
            bytes: Buffer.from(stub.object('masters', p)?.bytes ?? []),
          })),
        ]
      }
      writeList(root, line(await hex('filler'), 'filler-story/x.en.mp3'))
      for (const id of ids) {
        const before = await everything()
        const plan = await planTakedown(reader, id, null, root, native)
        expect
          .soft(plan.ok ? plan.plan.paths : plan, `(g1) ${id}: the plan`)
          .toEqual(sorted(own.get(id)!))
        if (!plan.ok) continue
        const mark = stub.requests.length
        const r = await commitTakedown(
          reader,
          removers(stub, id).makeRemover,
          plan.plan,
          root,
          { onChunk: () => {} },
          native,
        )
        expect
          .soft(r, `(g1) ${id}: exactly its two objects removed`)
          .toEqual({ ok: true, removed: 2, kept: [] })
        const after = new Map((await everything()).map((o) => [o.key, o.bytes]))
        const changed = before
          .filter((o) => !own.get(id)!.some((p) => o.key === `content ${p}`))
          .filter((o) => !(after.get(o.key)?.equals(o.bytes) ?? false))
          .map((o) => o.key)
        expect.soft(changed, `(g1) ${id}: every other object byte-identical`).toEqual([])
        const log = { requests: stub.requests.slice(mark), unexpected: stub.unexpected }
        expect
          .soft(() => expectDeletesConfined(log, id, plan.plan.paths), `(g1) ${id}: confined`)
          .not.toThrow()
      }

      // g2: a hostile listing adds a foreign path, at plan or at commit.
      const lion = await newStub()
      const lionPaths = [
        `packages/lion/${await hex('lion-p2')}.json`,
        `media/lion/${await hex('lion-m2')}-w768.webp`,
      ]
      lion.put('content', lionPaths[0]!, encode('{}'), 'application/json')
      lion.put('content', lionPaths[1]!, webpBytes('lion2'), 'image/webp')
      lion.put('content', hare, webpBytes('hare'), 'image/webp')
      await stageIn(lion, [river])
      await putDocuments(lion, 'production', 2, [approved(pointed(lion, 'staging')!.stories[0]!)])
      const lionReader = client(lion)
      for (const foreign of [
        hare,
        'catalogue/production.json',
        `approvals/lion/${await hex('ap')}.json`,
      ]) {
        const atPlan = fakeReader(lionReader, (folder, real) =>
          folder.startsWith('media/') ? withExtra(real, [foreign]) : real,
        )
        const mark = lion.requests.length
        expect
          .soft(
            [
              await planTakedown(atPlan, 'lion', null, root, native),
              deletes(lion.requests.slice(mark)).length,
            ],
            `(g2) ${foreign} in the plan's listing`,
          )
          .toEqual([{ ok: false, code: 'takedown-unknown-object' }, 0])
        const plan = await planTakedown(lionReader, 'lion', null, root, native)
        if (!plan.ok) throw new Error('test setup: g2 lion plan')
        const atCommit = fakeReader(lionReader, (folder, real) =>
          folder.startsWith('media/') ? withExtra(real, [foreign]) : real,
        )
        const mark2 = lion.requests.length
        const r = await commitTakedown(
          atCommit,
          removers(lion, 'lion').makeRemover,
          plan.plan,
          root,
          { onChunk: () => {} },
          native,
        )
        expect
          .soft(
            [r, deletes(lion.requests.slice(mark2)).length],
            `(g2) ${foreign} in the commit's listing`,
          )
          .toEqual([{ ok: false, code: 'takedown-unknown-object', removed: 0 }, 0])
      }

      // g3: forged plans.
      const riverImage = river.media[0]!.path
      const plan = await planTakedown(lionReader, 'lion', null, root, native)
      if (!plan.ok) throw new Error('test setup: g3 plan')
      const forged: TakedownPlan = {
        ...plan.plan,
        paths: sorted([...plan.plan.paths, riverImage, 'catalogue/production.json']),
      }
      const riverBytes = lion.object('content', riverImage)?.bytes
      const pointerBytes = lion.object('content', 'catalogue/production.json')?.bytes
      const listedForeign = fakeReader(lionReader, (folder, real) =>
        folder.startsWith('media/')
          ? withExtra(real, [riverImage, 'catalogue/production.json'])
          : real,
      )
      const mark3 = lion.requests.length
      const refused = await commitTakedown(
        listedForeign,
        removers(lion, 'lion').makeRemover,
        forged,
        root,
        { onChunk: () => {} },
        native,
      )
      expect
        .soft(
          [refused, deletes(lion.requests.slice(mark3)).length],
          '(g3) a forged plan listed inside the folder',
        )
        .toEqual([{ ok: false, code: 'takedown-unknown-object', removed: 0 }, 0])
      const dropped = await commitTakedown(
        lionReader,
        removers(lion, 'lion').makeRemover,
        forged,
        root,
        { onChunk: () => {} },
        native,
      )
      expect
        .soft(dropped, '(g3) a forged plan: only the own objects removed')
        .toEqual({ ok: true, removed: 2, kept: [] })
      expect
        .soft(
          [
            Buffer.from(lion.object('content', riverImage)?.bytes ?? []).equals(
              Buffer.from(riverBytes ?? [0]),
            ),
            Buffer.from(lion.object('content', 'catalogue/production.json')?.bytes ?? []).equals(
              Buffer.from(pointerBytes ?? [0]),
            ),
          ],
          '(g3) the foreign objects stay',
        )
        .toEqual([true, true])
      expectDeletesConfined(lion, 'lion')

      // g4: the helper's own negatives on synthetic logs.
      const entry = (pathname: string, body: unknown, search = ''): StubLogEntry => {
        const bytes = encode(JSON.stringify(body))
        return {
          method: 'DELETE',
          pathname,
          search,
          headerNames: [],
          apikeyMatched: true,
          authorization: 'absent',
          values: { 'content-type': 'application/json' },
          body: bytes,
          bodySha256: '',
        }
      }
      const negatives: [string, StubLogEntry][] = [
        ['a DELETE naming media/river-stones/x', entry(DELETE_PATH, { prefixes: [riverImage] })],
        [
          'a masters DELETE',
          entry('/storage/v1/object/masters', {
            prefixes: [`media/lion/${'a'.repeat(64)}-w1.webp`],
          }),
        ],
        ['a DELETE with a search', entry(DELETE_PATH, { prefixes: [lionPaths[1]] }, '?x=1')],
        ['a body with an extra key', entry(DELETE_PATH, { prefixes: [lionPaths[1]], x: 1 })],
      ]
      for (const [label, synthetic] of negatives) {
        expect
          .soft(
            () => expectDeletesConfined({ requests: [synthetic], unexpected: [] }, 'lion'),
            `(g4) ${label}`,
          )
          .toThrow(/confined/)
      }
      expectNoUnexpected(stub)
    },
  )
})

/** A hash list of valid, unique lines of exactly `bytes` bytes, under 10,000 lines (T15B-25 g4). */
async function bigList(bytes: number): Promise<string> {
  const sha = await hex('big')
  // One line of exactly `length` bytes (84 to 187): 75 fixed bytes, a story id of 3 to 64 `a`s and
  // a node id `n<i>` padded with `x` (unique by its digits).
  const rowOf = (i: number, length: number): string => {
    const digits = `n${i}`
    const nodeLength = Math.min(48, length - 75 - 3)
    const node = `${digits}${'x'.repeat(nodeLength - digits.length)}`
    const story = 'a'.repeat(length - 75 - nodeLength)
    return line(sha, `${story}/${node}.en.mp3`)
  }
  const rows: string[] = []
  let left = bytes
  let i = 0
  while (left > 2 * 187) {
    rows.push(rowOf(i++, 187))
    left -= 187
  }
  rows.push(rowOf(i++, Math.ceil(left / 2)), rowOf(i++, Math.floor(left / 2)))
  const text = rows.join('')
  if (text.length !== bytes || rows.length > 10_000) {
    throw new Error(`test setup: bigList made ${text.length} bytes in ${rows.length} lines`)
  }
  return text
}

/** Type-only samples (T15B-25 g5): never called; checked by corepack pnpm typecheck. */
function realPathRequiredSamples(reader: StorageReader, plan: TakedownPlan): void {
  // @ts-expect-error realPath is required
  void planTakedown(reader, 'two-paths', null, '/root')
  // @ts-expect-error realPath is required
  void commitTakedown(reader, () => ({}) as ContentRemover, plan, '/root', { onChunk: () => {} })
}
