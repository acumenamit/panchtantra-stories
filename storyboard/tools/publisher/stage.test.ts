// Step 14 (P1-8c) stage.ts: the validate command and the stage plan, dry run and commit (design
// migration-input/p1-step14-design.md §4.1 to §4.5, §4.8, §4.9, §5, D14-3, D14-6 to D14-8,
// D14-15, D14-18, D14-21, D23-1, D23-2; test plan §14.7: T14-44 to T14-60 and T14-89).
// Every Storage call goes to the loopback stub through a real client built in the test with a fake
// key assembled at run time; a loopback guard on the global fetch refuses and counts any other host.
// Inputs are the testkit's phase-2 stories written under an OS temp folder, which is also the
// storyboardRoot and the report dir; nothing is written under the repository. Every test ends with
// expectStageSafe (A25). vi.mock wraps composeStaging in a vi.fn around the real one (T14-89).
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_ORIGIN } from '../../src/config/security-headers'
import { expectedPackagePath } from '../../src/core/content/gates'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import type { CatalogueSnapshot } from '../../src/core/package/catalogue'
import { makePointer, makeSnapshot } from '../../src/core/package/catalogue-build'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { parseArgs } from './args'
import * as catalogueState from './catalogue-state'
import { runCli, type CliDeps } from './cli'
import { Secret } from './env'
import { isStorageRefusal, readOnlyPort, type StagePort, type StageWriter } from './port'
import { runStage, runValidate, selectStoryFiles, type StageDeps } from './stage'
import {
  buildTestStories,
  waiverBytesOf,
  waiverFileOf,
  withPackage,
  writeStageInputs,
  type StageInputDirs,
  type TestStory,
} from './stage-testkit'
import {
  createStorageClient,
  repeatsSecretRun,
  type StorageClient,
  type StorageClientOptions,
} from './storage'
import { expectNoUnexpected, startStorageStub, type StorageStub } from './storage-stub'
import { checkStories, deriveWaiverBlock, type LocalStory } from './story-checks'

vi.mock('./catalogue-state', async (importOriginal) => {
  const real = await importOriginal<typeof import('./catalogue-state')>()
  return { ...real, composeStaging: vi.fn(real.composeStaging) }
})
const composeSpy = vi.mocked(catalogueState.composeStaging)
// Transparent except where T14-57 g5 injects one answer (a checked story without its entry).
vi.mock('./story-checks', async (importOriginal) => {
  const real = await importOriginal<typeof import('./story-checks')>()
  return { ...real, checkStories: vi.fn(real.checkStories) }
})
const checkStoriesSpy = vi.mocked(checkStories)

// ---- shared material ----

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-stage-test-key'].join('_')
const NOW = '2026-11-21T10:00:00.000Z'
/** The CLI order (not sorted), so appended entries must be sorted by the code. */
const IDS = ['two-paths', 'river-stones', 'lantern-walk']
const SORTED = ['lantern-walk', 'river-stones', 'two-paths']
const LIST_PATH = '/storage/v1/object/list/content'
const OBJECT_ROUTE = '/storage/v1/object/'
const pointerRead = (mode: string) =>
  `/storage/v1/object/authenticated/content/catalogue/${mode}.json`
const pointerWrite = (mode: string) => `/storage/v1/object/content/catalogue/${mode}.json`
const contentWrite = (path: string) => `/storage/v1/object/content/${path}`
const waiverRead = (id: string, sha: string) =>
  `/storage/v1/object/authenticated/masters/waivers/${id}/${sha}.json`
const REVIEW = 'review: corepack pnpm preview:staging'
const TIMEOUT = { timeout: 30_000 }

// ---- loopback guard (§14.1 "Network") ----

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0
let loopbackRequests = 0
let root = ''
const stubs: StorageStub[] = []

beforeEach(() => {
  escapes = 0
  loopbackRequests = 0
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) {
      loopbackRequests++
      return realFetch(input, init)
    }
    escapes++
    return Promise.reject(new TypeError('blocked: not a loopback host'))
  })
  root = mkdtempSync(join(tmpdir(), 's14-st-'))
  composeSpy.mockClear()
  checkStoriesSpy.mockClear()
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

type LogLike = Pick<StorageStub, 'requests' | 'unexpected'>
/** A25: no POST to the production pointer, none under masters, then expectNoUnexpected. */
function expectStageSafe(stub: LogLike): void {
  const posted = stub.requests.filter((r) => r.method === 'POST')
  if (posted.some((r) => r.pathname === pointerWrite('production'))) {
    throw new Error('A25: a POST to the production pointer')
  }
  if (posted.some((r) => r.pathname.startsWith(`${OBJECT_ROUTE}masters/`))) {
    throw new Error('A25: a POST under masters')
  }
  expectNoUnexpected(stub as StorageStub)
}
const allStageSafe = () => {
  for (const stub of stubs) expectStageSafe(stub)
}

let cached: Promise<TestStory[]> | null = null
const testStories = (): Promise<TestStory[]> => (cached ??= buildTestStories())
const byId = (stories: readonly TestStory[], id: string) =>
  stories.find((story) => story.storyId === id)!

async function inputs(stories?: readonly TestStory[]) {
  const list = stories ?? (await testStories())
  return { stories: list, dirs: writeStageInputs(root, list) }
}
const seedMasters = (stub: StorageStub, stories: readonly TestStory[]) => {
  for (const story of stories) {
    stub.put(
      'masters',
      `waivers/${story.storyId}/${story.waiverSha256}.json`,
      story.waiverBytes,
      'application/json',
    )
  }
}
const reportDir = () => join(root, 'reports')
const context = () => ({ cwd: root, storyboardRoot: root, platform: process.platform })
function stageArgs(dirs: StageInputDirs, ids = IDS, extra: string[] = []) {
  const parsed = parseArgs(
    ['stage', ...ids, ...dirFlags(dirs), '--report-dir', reportDir(), ...extra],
    context(),
  )
  if (!parsed.ok || parsed.command !== 'stage') throw new Error('test setup: stage args')
  return parsed
}
function validateArgs(dirs: StageInputDirs, ids: string[] = IDS, extra: string[] = []) {
  const parsed = parseArgs(
    ['validate', ...ids, ...dirFlags(dirs), '--report-dir', reportDir(), ...extra],
    context(),
  )
  if (!parsed.ok || parsed.command !== 'validate') throw new Error('test setup: validate args')
  return parsed
}
const dirFlags = (dirs: StageInputDirs) => [
  '--packages',
  dirs.packagesDir,
  '--media',
  dirs.mediaDir,
  '--waivers',
  dirs.waiversDir,
]

function fakeClock(iso = NOW) {
  let t = Date.parse(iso)
  return { now: () => new Date(t), advance: (ms: number) => void (t += ms) }
}

type Before = (url: URL, init: RequestInit) => Promise<Response | void> | Response | void
type After = (url: URL, init: RequestInit) => Promise<void> | void
/** A fetchImpl for a loopback client: `before` may answer instead; `after` runs once it landed. */
function wrapFetch(before?: Before, after?: After): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const options = init ?? {}
    const answer = before ? await before(url, options) : undefined
    if (answer instanceof Response) return answer
    const response = await globalThis.fetch(input, options)
    if (after) await after(url, options)
    return response
  }) as typeof fetch
}
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const listPrefix = (init: RequestInit): string | null =>
  typeof init.body === 'string'
    ? ((JSON.parse(init.body) as { prefix?: string }).prefix ?? null)
    : null
const isPost = (init: RequestInit, url: URL, pathname: string) =>
  init.method === 'POST' && url.pathname === pathname
const isObjectPost = (init: RequestInit, url: URL, prefix: string) =>
  init.method === 'POST' && url.pathname.startsWith(`${OBJECT_ROUTE}content/${prefix}`)

interface StageOptions {
  readonly clock?: ReturnType<typeof fakeClock>
  readonly fetchImpl?: typeof fetch
  readonly port?: (client: StorageClient) => StagePort
  readonly noFetchImpl?: boolean
}

interface Ran {
  readonly exit: number
  readonly out: string[]
  readonly err: string[]
  readonly sleeps: number[]
  readonly made: number
}

async function stage(
  stub: StorageStub,
  args: ReturnType<typeof stageArgs>,
  options: StageOptions = {},
): Promise<Ran> {
  const out: string[] = []
  const err: string[] = []
  const sleeps: number[] = []
  const clock = options.clock ?? fakeClock()
  const extra: Partial<StorageClientOptions> = options.fetchImpl
    ? { fetchImpl: options.fetchImpl }
    : {}
  const client = createStorageClient({
    supabaseUrl: stub.origin,
    secretKey: new Secret(FAKE_KEY),
    ...extra,
  })
  let made = 0
  const deps: StageDeps = {
    storyboardRoot: root,
    platform: process.platform,
    now: clock.now,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock.advance(ms)
    },
    log: (line) => void out.push(line),
    error: (line) => void err.push(line),
    makePort: () => {
      made++
      return options.port ? options.port(client) : client
    },
  }
  const exit = await runStage(args, deps)
  return { exit, out, err, sleeps, made }
}

async function validate(
  args: ReturnType<typeof validateArgs>,
  platform: string = process.platform,
) {
  const out: string[] = []
  const err: string[] = []
  const exit = await runValidate(args, {
    storyboardRoot: root,
    platform,
    now: fakeClock().now,
    log: (line) => void out.push(line),
    error: (line) => void err.push(line),
  })
  return { exit, out, err }
}

/** The request classes in order, consecutive repeats collapsed (T14-47 g1). */
function classes(stub: StorageStub): string[] {
  const seen: string[] = []
  for (const r of stub.requests) {
    let name: string
    if (r.method === 'POST' && r.pathname === LIST_PATH) {
      const prefix = (JSON.parse(new TextDecoder().decode(r.body)) as { prefix: string }).prefix
      name = prefix.startsWith('catalogue') ? 'catalogue-list' : 'story-list'
    } else if (r.method === 'GET' && r.pathname.includes('/authenticated/masters/waivers/')) {
      name = 'waiver-read'
    } else if (r.method === 'GET' && /\/catalogue\/(production|staging)\.json$/.test(r.pathname)) {
      name = 'pointer-read'
    } else if (r.method === 'GET' && r.pathname.includes('/catalogue/snapshots/')) {
      name = 'snapshot-read'
    } else if (r.method === 'POST' && r.pathname.startsWith(contentWrite('media/'))) {
      name = 'media-create'
    } else if (r.method === 'POST' && r.pathname.startsWith(contentWrite('packages/'))) {
      name = 'package-create'
    } else if (r.method === 'POST' && r.pathname.startsWith(contentWrite('catalogue/snapshots/'))) {
      name = 'snapshot-create'
    } else if (r.method === 'POST' && r.pathname === pointerWrite('staging')) {
      name = 'pointer-write'
    } else {
      name = `other ${r.method} ${r.pathname}`
    }
    if (seen[seen.length - 1] !== name) seen.push(name)
  }
  return seen
}
const STAGE_CLASSES = [
  'catalogue-list',
  'pointer-read',
  'waiver-read',
  'story-list',
  'media-create',
  'package-create',
  'story-list',
  'snapshot-create',
  'snapshot-read',
  'catalogue-list',
  'pointer-read',
  'pointer-write',
  'pointer-read',
  'catalogue-list',
  'pointer-read',
]
const objectPosts = (stub: StorageStub) =>
  stub.requests.filter((r) => r.method === 'POST' && r.pathname !== LIST_PATH)
const createPosts = (stub: StorageStub) =>
  objectPosts(stub).filter((r) => !r.pathname.endsWith('/catalogue/staging.json'))
const readReport = (name = 'publisher-stage.json'): Record<string, unknown> | null => {
  const path = join(reportDir(), name)
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : null
}
const decode = (bytes: Uint8Array | undefined) =>
  bytes === undefined ? '' : new TextDecoder().decode(bytes)
const sha12 = (sha: string) => sha.slice(0, 12)
const lastLine = (lines: readonly string[]) => lines[lines.length - 1] ?? ''

/** The first run's media and package objects, copied with their stored types (T14-49). */
function copyObjects(
  from: StorageStub,
  to: StorageStub,
  stories: readonly TestStory[],
  skip: string | null = null,
) {
  let copied = 0
  for (const story of stories) {
    const paths = [...story.media.map((m) => m.path), expectedPackagePath(story, 'staging', '')]
    for (const path of paths) {
      if (path === skip) continue
      const object = from.object('content', path)
      if (object === undefined) continue
      to.put('content', path, object.bytes, object.contentType)
      copied++
    }
  }
  return copied
}

const entryOf = (storyId: string, version: number, packageSha256: string): SnapshotEntry => ({
  storyId,
  collectionId: PANCHATANTRA_RULESET.collectionId,
  version,
  packagePath: expectedPackagePath({ storyId, packageSha256 }, 'staging', ''),
  packageSha256,
})
async function storeProduction(stub: StorageStub, seq: number, stories: SnapshotEntry[]) {
  const value: CatalogueSnapshot = {
    schemaVersion: '1.0',
    seq,
    createdAt: NOW,
    note: 'production',
    featuredStoryId: null,
    stories,
  }
  const snapshot = await makeSnapshot(value)
  stub.put('content', `catalogue/snapshots/${seq}.json`, snapshot.bytes, 'application/json')
  const pointer = await makePointer({
    schemaVersion: '1.0',
    seq,
    snapshotPath: `catalogue/snapshots/${seq}.json`,
    snapshotSha256: snapshot.sha256,
    updatedAt: NOW,
  })
  stub.put('content', 'catalogue/production.json', pointer.bytes, 'application/json')
  return { snapshot, pointer }
}

const firstMediaPath = (stories: readonly TestStory[]) => byId(stories, IDS[0]!).media[0]!.path

/** The report-dir refusal printed on stderr when the real path lies in the site (SEC1-1). */
const reportDirRefused = (command: string) =>
  `${command}: report-dir refused: its real path is at or under public/ or app/ of the storyboard folder`
/**
 * Runs `body` with a cwd that is a junction to the temp root (a directory link on Linux), so a
 * relative --report-dir passes args.ts's string compare and only the real path shows the site.
 */
async function withLinkedCwd(body: (link: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 's14-st-cwd-'))
  const link = join(home, 'root-link')
  symlinkSync(root, link, 'junction')
  try {
    await body(link)
  } finally {
    rmSync(link, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}
/**
 * The 8.3 short form of `path` (cmd's `%~sI`) on a win32 host, or null on any other host. It equals
 * `path`, case aside, when the volume keeps no short names (R2-SEC-1).
 */
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

// ---- validate (A10) ----

describe('validate', () => {
  it(
    'T14-44 validate is local: every story reported, exit 0 or 1, both reports written; a failed report write, and a report dir whose real path is in public/ or app/, is exit 2 (A10, D14-25)',
    TIMEOUT,
    async () => {
      const stories = await testStories()
      const first = byId(stories, IDS[0]!)
      const phase1 = await withPackage(first, { ...first.pkg, assets: [] } as StoryPackageV1)
      const { dirs } = await inputs([phase1, ...stories.filter((s) => s !== first)])
      const blocked = await validate(validateArgs(dirs))
      expect(stubs.length, 'precondition: no stub is started').toBe(0)
      expect(loopbackRequests, 'precondition: the guard saw no request').toBe(0)
      expect
        .soft(
          blocked.out.filter((l) => /^validate: [a-z-]+ package=/.test(l)).length,
          '(g1) three story lines',
        )
        .toBe(3)
      expect.soft(lastLine(blocked.out), '(g1) the summary').toBe('validate: 2/3 stageable')
      expect.soft(blocked.exit, '(g1) exit 1').toBe(1)
      writeStageInputs(root, stories)
      const fixed = await validate(validateArgs(dirs))
      expect.soft(fixed.exit, '(g1) with the story fixed, exit 0').toBe(0)
      expect
        .soft(existsSync(join(reportDir(), 'publisher-validate.json')), '(g2) json written')
        .toBe(true)
      expect
        .soft(existsSync(join(reportDir(), 'publisher-validate.md')), '(g2) md written')
        .toBe(true)
      expect
        .soft(readReport('publisher-validate.json')?.mode, '(g2) mode validate')
        .toBe('validate')
      rmSync(reportDir(), { recursive: true, force: true })
      writeFileSync(reportDir(), 'a file where the report dir should be')
      const unwritten = await validate(validateArgs(dirs))
      expect.soft(unwritten.exit, '(g3) exit 2').toBe(2)
      expect.soft(unwritten.err, '(g3) report-unwritten').toContain('validate: report-unwritten')

      // g4 (SEC1-1): through a cwd that is a junction to the root, args.ts's string compare sees no
      // site folder; the real path does. Nothing is written there, and the run stops as usage.
      mkdirSync(join(root, 'public'))
      // R2-SEC-1: the temp root's 8.3 short name passes args.ts's string compare, and only the
      // native real path gives the long name back, so this sample pins realpathSync.native.
      const short = shortPathOf(root)
      const hasShort = short !== null && short.toLowerCase() !== root.toLowerCase()
      if (short === null) console.log('skipped: 8.3 short name needs a win32 host')
      else if (!hasShort) console.log('skipped: the temp root has no 8.3 short name')
      await withLinkedCwd(async (link) => {
        const viaLink = (dir: string, platform: string = process.platform) => {
          const parsed = parseArgs(['validate', ...IDS, ...dirFlags(dirs), '--report-dir', dir], {
            cwd: link,
            storyboardRoot: root,
            platform,
          })
          if (!parsed.ok || parsed.command !== 'validate') {
            throw new Error('test setup: validate args through the linked cwd')
          }
          return validate(parsed, platform)
        }
        const near = await viaLink('reports-via-link')
        expect.soft(near.exit, '(g4) near miss accepted: <link>/reports-via-link').toBe(0)
        const samples: [string, string, string, string][] = [
          ['<link>/public (present)', 'public', process.platform, join(root, 'public')],
          [
            '<link>/app/new/sub (absent)',
            join('app', 'new', 'sub'),
            process.platform,
            join(root, 'app', 'new', 'sub'),
          ],
          [
            '<link>/APP/y on platform win32 (absent)',
            join('APP', 'y'),
            'win32',
            join(root, 'APP', 'y'),
          ],
        ]
        if (hasShort && short !== null) {
          const real = join(root, 'public')
          samples.push([
            '<8.3 root>/public (present)',
            join(short, 'public'),
            process.platform,
            real,
          ])
        }
        for (const [label, dir, platform, real] of samples) {
          const r = await viaLink(dir, platform)
          expect.soft(r.exit, `(g4) ${label}: exit 2`).toBe(2)
          expect.soft(r.out, `(g4) ${label}: stopped usage`).toEqual(['validate: stopped: usage'])
          expect.soft(r.err, `(g4) ${label}: the reason`).toEqual([reportDirRefused('validate')])
          expect
            .soft(existsSync(join(real, 'publisher-validate.json')), `(g4) ${label}: no report`)
            .toBe(false)
        }
      })
      allStageSafe()
    },
  )

  it(
    'T14-45 --all selects exact StoryId.json names; a matching folder or link is refused, other names are ignored and counted on the summary (L17, TP-7)',
    TIMEOUT,
    async () => {
      const stories = await testStories()
      const one = byId(stories, 'lantern-walk')
      const { dirs } = await inputs([one])
      const all = (extra: string[] = []) => validateArgs(dirs, [], ['--all', ...extra])
      const base = await validate(all())
      expect(
        base.out.filter((l) => l.startsWith('validate: lantern-walk ')).length,
        'precondition: the valid lantern-walk.json is checked',
      ).toBe(1)
      // Near misses that cannot collide with lantern-walk.json on a case-insensitive disk (B14-implC-3).
      for (const name of [
        'River-Stones.json',
        'two-paths.JSON',
        'two-paths.json.json',
        'notes.txt',
      ]) {
        writeFileSync(join(dirs.packagesDir, name), '{}')
      }
      const ignored = await validate(all())
      expect
        .soft(
          ignored.out.filter((l) => / package=/.test(l)),
          '(g1) only lantern-walk is checked',
        )
        .toEqual(base.out.filter((l) => / package=/.test(l)))
      expect
        .soft(selectStoryFiles(readdirSync(dirs.packagesDir)).ignored, '(g1) four names ignored')
        .toBe(4)
      // FID-4: the ignored count is printed, so a wrong-case name cannot vanish silently.
      expect
        .soft(lastLine(ignored.out), '(g1) the summary counts the ignored names')
        .toBe('validate: 1/1 stageable ignored=4')
      mkdirSync(join(dirs.packagesDir, 'c-d.json'))
      const target = mkdtempSync(join(tmpdir(), 's14-st-link-'))
      symlinkSync(target, join(dirs.packagesDir, 'e-f.json'), 'junction')
      const refused = await validate(all())
      rmSync(join(dirs.packagesDir, 'e-f.json'), { recursive: true, force: true })
      rmSync(target, { recursive: true, force: true })
      for (const id of ['c-d', 'e-f']) {
        expect
          .soft(
            refused.out.some(
              (l) =>
                l.startsWith(`validate: ${id} `) &&
                l.endsWith('verdict=blocked:local-file-not-regular'),
            ),
            `(g2) ${id} refused as local-file-not-regular`,
          )
          .toBe(true)
      }
      const emptyDir = join(root, 'empty-packages')
      mkdirSync(emptyDir)
      const empty = await validate(validateArgs({ ...dirs, packagesDir: emptyDir }, [], ['--all']))
      expect.soft(empty.exit, '(g3) an empty dir is exit 2').toBe(2)
      allStageSafe()
    },
  )
})

// ---- stage (A6, A16 to A25) ----

describe('stage', () => {
  it(
    'T14-46 stage reads each waiver from masters by the local file sha; every result kind maps as §3.13 (A6, D14-3)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const stub = await newStub()
      seedMasters(stub, stories)
      expect(
        stub.object('masters', `waivers/${stories[0]!.storyId}/${stories[0]!.waiverSha256}.json`),
        'precondition: the waiver bytes stored in masters',
      ).toBeDefined()
      const ran = await stage(stub, stageArgs(dirs))
      const reads = stub.requests.filter(
        (r) => r.method === 'GET' && r.pathname.includes('/masters/'),
      )
      expect
        .soft(
          reads.map((r) => r.pathname),
          '(g1) one GET per story by the local sha',
        )
        .toEqual(IDS.map((id) => waiverRead(id, byId(stories, id).waiverSha256)))
      const stored = JSON.parse(
        decode(stub.object('content', 'catalogue/snapshots/1.json')?.bytes),
      ) as CatalogueSnapshot
      for (const story of stories) {
        const derived = await deriveWaiverBlock(
          story.storyId,
          new Uint8Array(
            stub.object('masters', `waivers/${story.storyId}/${story.waiverSha256}.json`)!.bytes,
          ),
        )
        expect
          .soft(
            stored.stories.find((s) => s.storyId === story.storyId)?.waivers,
            `(g1) block from masters: ${story.storyId}`,
          )
          .toEqual(derived.ok ? derived.waiver.block : 'derive failed')
      }
      expect(ran.exit, 'precondition: the clean run stages').toBe(0)
      const sample = async (label: string, want: string, setup: (s: StorageStub) => void) => {
        const s = await newStub()
        setup(s)
        const r = await stage(s, stageArgs(dirs))
        expect
          .soft(
            r.out.some((l) => l.startsWith(`stage: stopped: ${want}`)),
            `(g2) ${label}`,
          )
          .toBe(true)
        expect.soft(r.exit, `(g3) exit 1: ${label}`).toBe(1)
        expect.soft(objectPosts(s).length, `(g3) zero POSTs: ${label}`).toBe(0)
      }
      const first = byId(stories, IDS[0]!)
      const firstPath = `waivers/${first.storyId}/${first.waiverSha256}.json`
      await sample('not stored', 'waiver-not-in-masters', (s) =>
        seedMasters(
          s,
          stories.filter((x) => x !== first),
        ),
      )
      await sample('other bytes under the name', 'waiver-hash-mismatch', (s) => {
        seedMasters(s, stories)
        s.put('masters', firstPath, new TextEncoder().encode('{"other":true}'), 'application/json')
      })
      await sample('1 MiB + 1 stored', 'waiver-too-large', (s) => {
        seedMasters(s, stories)
        s.put('masters', firstPath, new Uint8Array(1024 * 1024 + 1).fill(0x20), 'application/json')
      })
      await sample('GET 401', 'storage-unauthorized', (s) => {
        seedMasters(s, stories)
        s.override('GET', waiverRead(first.storyId, first.waiverSha256), {
          kind: 'answer',
          status: 401,
          body: '{"statusCode":"401"}',
        })
      })
      await sample('GET 500', 'storage-failed', (s) => {
        seedMasters(s, stories)
        s.override('GET', waiverRead(first.storyId, first.waiverSha256), {
          kind: 'answer',
          status: 500,
          body: '{"statusCode":"500"}',
        })
      })
      allStageSafe()
    },
  )

  it(
    'T14-47 stage on an empty bucket: the request classes in the D14-8 order, the expected snapshot and pointer, exit 0 (A17, A19, A20, A22)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const pre = await validate(validateArgs(dirs))
      expect(pre.exit, 'precondition: the three stories pass validate').toBe(0)
      const stub = await newStub()
      seedMasters(stub, stories)
      // MT14-5 plants go in this pass-through wrapper (each alone; see the build report).
      const passThrough = wrapFetch()
      const ran = await stage(stub, stageArgs(dirs), { fetchImpl: passThrough })
      expect.soft(classes(stub), '(g1) the classes in order').toEqual(STAGE_CLASSES)
      const entries = SORTED.map((id) => {
        const s = byId(stories, id)
        return {
          ...entryOf(id, s.pkg.version, s.packageSha256),
          waivers: {
            ruleSetRef: PANCHATANTRA_RULESET.ref,
            waiverFileSha256: s.waiverSha256,
            keys: [],
          },
        }
      })
      const want = jcsBytes({
        schemaVersion: '1.0',
        seq: 1,
        createdAt: NOW,
        note: `publisher stage: ${SORTED.join(' ')}`,
        featuredStoryId: null,
        stories: entries,
      })
      const wantSha = await sha256Hex(want)
      expect
        .soft(
          decode(stub.object('content', 'catalogue/snapshots/1.json')?.bytes),
          '(g2) the stored snapshot',
        )
        .toBe(decode(want))
      const pointer = JSON.parse(
        decode(stub.object('content', 'catalogue/staging.json')?.bytes) || '{}',
      ) as Record<string, unknown>
      expect
        .soft(pointer.snapshotPath, '(g3) the pointer names snapshot 1')
        .toBe('catalogue/snapshots/1.json')
      expect.soft(pointer.snapshotSha256, '(g3) with its sha256').toBe(wantSha)
      expect.soft(pointer.updatedAt, '(g3) updatedAt is now').toBe(NOW)
      for (const story of stories) {
        for (const media of story.media) {
          expect
            .soft(stub.object('content', media.path)?.contentType, `(g3) type ${media.path}`)
            .toBe(media.mime)
        }
        expect
          .soft(
            stub.object('content', expectedPackagePath(story, 'staging', ''))?.contentType,
            `(g3) type package ${story.storyId}`,
          )
          .toBe('application/json')
      }
      for (const r of createPosts(stub)) {
        expect.soft(r.values['x-upsert'], `(g3) x-upsert false ${r.pathname}`).toBe('false')
        expect
          .soft(r.values['cache-control'], `(g3) max-age=3600 ${r.pathname}`)
          .toBe('max-age=3600')
      }
      const pointerPosts = objectPosts(stub).filter((r) => r.pathname === pointerWrite('staging'))
      expect
        .soft(
          pointerPosts.map((r) => r.values['x-upsert']),
          '(g3) pointer x-upsert true',
        )
        .toEqual(['true'])
      expect
        .soft(
          pointerPosts.map((r) => r.values['cache-control']),
          '(g3) pointer max-age=0',
        )
        .toEqual(['max-age=0'])
      const storyLine = (id: string) => {
        const s = byId(stories, id)
        const bytes = s.packageBytes.length + s.media.reduce((n, m) => n + m.bytes.length, 0)
        return `stage: ${id} package=${sha12(s.packageSha256)} version=1 state=new media-new=3 media-skipped=0 bytes=${bytes} waiver-keys=0`
      }
      expect
        .soft(ran.out, '(g4) stdout is the §4.8 lines, the review command last')
        .toEqual([
          ...IDS.map(storyLine),
          'stage: plan seq=1 stories=3 objects-new=12 objects-skipped=0 orphans=0 production=none staging=none',
          `stage: snapshot seq=1 sha256=${sha12(wantSha)} created`,
          'stage: staging pointer seq=1 moved (read back, post-check clean)',
          REVIEW,
        ])
      expect.soft(ran.exit, '(g4) exit 0').toBe(0)
      allStageSafe()
    },
  )

  it('T14-48 uploads are sequential: never two requests in flight (A17)', TIMEOUT, async () => {
    const { stories, dirs } = await inputs()
    const stub = await newStub()
    seedMasters(stub, stories)
    let inFlight = 0
    let most = 0
    const counting: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      inFlight++
      most = Math.max(most, inFlight)
      try {
        return await globalThis.fetch(input, init)
      } finally {
        inFlight--
      }
    }) as typeof fetch
    const ran = await stage(stub, stageArgs(dirs), { fetchImpl: counting })
    expect(ran.exit, 'precondition: the run stages').toBe(0)
    expect(createPosts(stub).length, 'precondition: at least nine creates').toBeGreaterThanOrEqual(
      9,
    )
    expect.soft(most, '(g1) the in-flight maximum is 1').toBe(1)
    allStageSafe()
  })

  it(
    'T14-49 existing objects: equal size and type skipped; any difference stops before the first write (A16, L4)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const first = await newStub()
      seedMasters(first, stories)
      expect((await stage(first, stageArgs(dirs))).exit, 'precondition: the first run stages').toBe(
        0,
      )
      const again = await newStub()
      seedMasters(again, stories)
      expect(copyObjects(first, again, stories), 'precondition: 12 objects copied').toBe(12)
      const skip = await stage(again, stageArgs(dirs))
      const mediaAndPackages = createPosts(again).filter((r) => !r.pathname.includes('/catalogue/'))
      expect.soft(mediaAndPackages.length, '(g1) zero media and package POSTs').toBe(0)
      expect
        .soft(
          skip.out.find((l) => l.startsWith('stage: plan ')),
          '(g1) all counted skipped',
        )
        .toBe(
          'stage: plan seq=1 stories=3 objects-new=0 objects-skipped=12 orphans=0 production=none staging=none',
        )
      expect
        .soft(
          again.object('content', firstMediaPath(stories))?.cacheControl,
          '(g1) pre-stored with cacheControl null',
        )
        .toBeNull()
      expect.soft(skip.exit, '(g1) and still staged').toBe(0)

      const stops = async (
        label: string,
        group: string,
        want: string,
        setup: (s: StorageStub) => Promise<void | typeof fetch> | void | typeof fetch,
      ) => {
        const s = await newStub()
        seedMasters(s, stories)
        const fetchImpl = await setup(s)
        const r = await stage(s, stageArgs(dirs), fetchImpl ? { fetchImpl } : {})
        expect
          .soft(
            r.out.some((l) => l.startsWith(`stage: stopped: ${want}`)),
            `(${group}) ${label}`,
          )
          .toBe(true)
        expect.soft(objectPosts(s).length, `(g5) zero POSTs: ${label}`).toBe(0)
        expect.soft(r.exit, `(g5) exit 1: ${label}`).toBe(1)
      }
      const media = byId(stories, IDS[0]!).media[0]!
      await stops('size off by one', 'g2', 'existing-object-differs', (s) => {
        copyObjects(first, s, stories)
        s.put('content', media.path, new Uint8Array([...media.bytes, 0]), media.mime)
      })
      await stops('type binary/octet-stream', 'g2', 'existing-object-differs', (s) => {
        copyObjects(first, s, stories)
        s.put('content', media.path, media.bytes, 'binary/octet-stream')
      })
      await stops('metadata null', 'g3', 'existing-object-unverifiable', () =>
        wrapFetch((url, init) => {
          if (isPost(init, url, LIST_PATH) && listPrefix(init) === `media/${IDS[0]}`) {
            const name = media.path.slice(media.path.lastIndexOf('/') + 1)
            return jsonResponse(200, [
              { name, id: 'listed-null-metadata', updated_at: NOW, metadata: null },
            ])
          }
        }),
      )
      await stops(
        'a carried entry without its package',
        'g4',
        'carried-package-missing',
        async (s) => {
          await storeProduction(s, 1, [entryOf('other-tale', 1, 'c'.repeat(64))])
        },
      )
      allStageSafe()
    },
  )

  it(
    'T14-50 retry: once, after sleep(1000), on status null or 5xx only (A17)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const target = contentWrite(firstMediaPath(stories))
      const run = async (setup: (s: StorageStub) => void | typeof fetch) => {
        const s = await newStub()
        seedMasters(s, stories)
        const fetchImpl = setup(s)
        const r = await stage(s, stageArgs(dirs), fetchImpl ? { fetchImpl } : {})
        return {
          ...r,
          stub: s,
          attempts: objectPosts(s).filter((p) => p.pathname === target).length,
        }
      }
      const fail = (status: number) => ({
        kind: 'answer' as const,
        status,
        body: JSON.stringify({ statusCode: String(status), error: 'x' }),
      })
      const once = await run((s) => s.override('POST', target, fail(500)))
      expect(once.attempts, 'precondition: the override hit the first media POST').toBe(2)
      expect.soft(once.sleeps, '(g1) sleep called once with 1000').toEqual([1000])
      expect.soft(once.exit, '(g1) then staged').toBe(0)
      let thrown = false
      const network = await run(() =>
        wrapFetch((url, init) => {
          if (!thrown && isPost(init, url, target)) {
            thrown = true
            throw new TypeError('network down once')
          }
        }),
      )
      expect.soft(network.sleeps, '(g2) a network failure is retried once').toEqual([1000])
      expect.soft(network.exit, '(g2) then staged').toBe(0)
      const twice = await run((s) => {
        s.override('POST', target, fail(500))
        s.override('POST', target, fail(500))
      })
      expect.soft(twice.attempts, '(g3) two attempts').toBe(2)
      expect
        .soft(lastLine(twice.out), '(g3) upload-failed')
        .toBe(`stage: stopped: upload-failed ${IDS[0]}`)
      expect.soft(twice.exit, '(g3) exit 3').toBe(3)
      for (const [status, code] of [
        [400, 'upload-failed'],
        [401, 'storage-unauthorized'],
        [413, 'too-large'],
        [415, 'mime-refused'],
      ] as const) {
        const r = await run((s) => s.override('POST', target, fail(status)))
        expect.soft(r.sleeps, `(g4) no retry on ${status}`).toEqual([])
        expect.soft(r.attempts, `(g4) one attempt on ${status}`).toBe(1)
        expect
          .soft(lastLine(r.out), `(g4) ${status} → ${code}`)
          .toBe(`stage: stopped: ${code} ${IDS[0]}`)
        expect.soft(r.exit, `(g4) exit 3 on ${status}`).toBe(3)
      }
      const media = byId(stories, IDS[0]!).media[0]!
      const present = await run((s) =>
        wrapFetch((url, init) => {
          if (isPost(init, url, target)) {
            s.put('content', media.path, media.bytes, media.mime)
            return jsonResponse(409, { statusCode: '409', error: 'Duplicate' })
          }
        }),
      )
      expect.soft(present.exit, '(g5) a duplicate counts as present; the listing agrees').toBe(0)
      const absent = await run(() =>
        wrapFetch((url, init) => {
          if (isPost(init, url, target))
            return jsonResponse(409, { statusCode: '409', error: 'Duplicate' })
        }),
      )
      expect
        .soft(lastLine(absent.out), '(g5) the listing decides')
        .toBe(`stage: stopped: upload-verify-failed ${IDS[0]}`)
      allStageSafe()
    },
  )

  it(
    'T14-51 verification listing: a planned object missing after the uploads is upload-verify-failed before the snapshot (A18)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const normal = await newStub()
      seedMasters(normal, stories)
      expect((await stage(normal, stageArgs(dirs))).exit, 'precondition: a normal run stages').toBe(
        0,
      )
      const target = contentWrite(firstMediaPath(stories))
      const s = await newStub()
      seedMasters(s, stories)
      const r = await stage(s, stageArgs(dirs), {
        fetchImpl: wrapFetch((url, init) => {
          if (isPost(init, url, target)) return jsonResponse(200, { Key: 'not-stored' })
        }),
      })
      expect
        .soft(lastLine(r.out), '(g1) upload-verify-failed')
        .toBe(`stage: stopped: upload-verify-failed ${IDS[0]}`)
      expect.soft(r.exit, '(g1) exit 3').toBe(3)
      expect
        .soft(
          objectPosts(s).filter((p) => p.pathname.includes('/catalogue/')).length,
          '(g2) no snapshot or pointer POST',
        )
        .toBe(0)
      const v = await newStub()
      seedMasters(v, stories)
      let packaged = false
      let failed = false
      const listed = await stage(v, stageArgs(dirs), {
        fetchImpl: wrapFetch((url, init) => {
          if (isObjectPost(init, url, 'packages/')) packaged = true
          if (packaged && !failed && isPost(init, url, LIST_PATH)) {
            failed = true
            return jsonResponse(500, { statusCode: '500', error: 'x' })
          }
        }),
      })
      expect
        .soft(lastLine(listed.out), '(g3) storage-failed')
        .toBe(`stage: stopped: storage-failed ${IDS[0]}`)
      expect.soft(listed.exit, '(g3) exit 3').toBe(3)
      expect
        .soft(
          objectPosts(v).filter((p) => p.pathname.includes('/catalogue/')).length,
          '(g3) no snapshot POST',
        )
        .toBe(0)
      allStageSafe()
    },
  )

  it(
    'T14-52 deadline (checked before every commit request) and local-file-changed stop the commit before the next request; the read-back after a pointer write always runs (A9, A17, TP-5, TP-9)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const target = contentWrite(firstMediaPath(stories))
      const clockA = fakeClock()
      expect(clockA.now().toISOString(), 'precondition: a fake clock').toBe(NOW)
      const a = await newStub()
      seedMasters(a, stories)
      const late = await stage(a, stageArgs(dirs), {
        clock: clockA,
        fetchImpl: wrapFetch(undefined, (url, init) => {
          if (isPost(init, url, target)) clockA.advance(3_600_001)
        }),
      })
      expect.soft(lastLine(late.out), '(g1) deadline').toBe('stage: stopped: deadline')
      expect.soft(late.exit, '(g1) exit 3').toBe(3)
      expect.soft(objectPosts(a).length, '(g1) no later POST').toBe(1)
      const clockB = fakeClock()
      const b = await newStub()
      seedMasters(b, stories)
      const afterPointer = await stage(b, stageArgs(dirs), {
        clock: clockB,
        fetchImpl: wrapFetch(undefined, (url, init) => {
          if (isPost(init, url, pointerWrite('staging'))) clockB.advance(3_600_001)
        }),
      })
      const order = b.requests.map((r) => `${r.method} ${r.pathname}`)
      const at = order.indexOf(`POST ${pointerWrite('staging')}`)
      expect
        .soft(order[at + 1], '(g2) the read-back GET is still sent')
        .toBe(`GET ${pointerRead('staging')}`)
      expect.soft(afterPointer.exit, '(g2) and decides: moved').toBe(0)
      const second = byId(stories, IDS[0]!).media[1]!
      const c = await newStub()
      seedMasters(c, stories)
      const changed = await stage(c, stageArgs(dirs), {
        fetchImpl: wrapFetch(undefined, (url, init) => {
          if (isPost(init, url, target)) {
            writeFileSync(
              join(dirs.mediaDir, ...second.path.split('/')),
              new Uint8Array(second.bytes.length).fill(7),
            )
          }
        }),
      })
      expect
        .soft(lastLine(changed.out), '(g3) local-file-changed')
        .toBe(`stage: stopped: local-file-changed ${IDS[0]}`)
      expect.soft(changed.exit, '(g3) exit 3').toBe(3)
      expect.soft(objectPosts(c).length, '(g3) before its POST').toBe(1)
      writeStageInputs(root, stories)

      // g4 to g6 (FID-1): the deadline is checked before every commit request, reads included:
      // the clock passes 60 min on the named request, and the request after it is never sent.
      const keyOf = (method: string, pathname: string, prefix: string | null) =>
        prefix === null ? `${method} ${pathname}` : `list ${prefix}`
      const sent = (s: StorageStub, key: string) =>
        s.requests.filter((r) => {
          const prefix =
            r.method === 'POST' && r.pathname === LIST_PATH
              ? (JSON.parse(decode(r.body)) as { prefix: string }).prefix
              : null
          return keyOf(r.method, r.pathname, prefix) === key
        }).length
      const expireOn = async (group: string, key: string, nth: number) => {
        const clock = fakeClock()
        const s = await newStub()
        seedMasters(s, stories)
        const seen = new Map<string, number>()
        const r = await stage(s, stageArgs(dirs), {
          clock,
          fetchImpl: wrapFetch(undefined, (url, init) => {
            const k = keyOf(init.method ?? 'GET', url.pathname, listPrefix(init))
            seen.set(k, (seen.get(k) ?? 0) + 1)
            if (k === key && seen.get(k) === nth) clock.advance(3_600_001)
          }),
        })
        expect(
          sent(s, key),
          `precondition: the request that expires the clock was sent: ${key}`,
        ).toBeGreaterThanOrEqual(nth)
        expect
          .soft(lastLine(r.out), `(${group}) stopped deadline: ${key}`)
          .toBe('stage: stopped: deadline')
        expect.soft(r.exit, `(${group}) exit 3: ${key}`).toBe(3)
        return s
      }
      const snapshotPath = (seq: number) => `catalogue/snapshots/${seq}.json`
      const g4 = await expireOn('g4', `list media/${IDS[0]}`, 2)
      expect
        .soft(sent(g4, `list packages/${IDS[0]}`), '(g4) no verification listing after it')
        .toBe(1)
      expect
        .soft(sent(g4, `POST ${contentWrite(snapshotPath(1))}`), '(g4) no snapshot POST')
        .toBe(0)
      const g5 = await expireOn('g5', `POST ${contentWrite(snapshotPath(1))}`, 1)
      expect
        .soft(
          sent(g5, `GET /storage/v1/object/authenticated/content/${snapshotPath(1)}`),
          '(g5) no snapshot read-back after the create that expired the clock',
        )
        .toBe(0)
      expect.soft(sent(g5, `POST ${pointerWrite('staging')}`), '(g5) no pointer POST').toBe(0)
      const g6a = await expireOn('g6', 'list catalogue', 2)
      expect
        .soft(
          sent(g6a, `GET ${pointerRead('production')}`) +
            sent(g6a, `GET ${pointerRead('staging')}`),
          '(g6) no pre-check pointer read after the pre-check listing',
        )
        .toBe(2)
      const g6b = await expireOn('g6', `GET ${pointerRead('production')}`, 2)
      expect
        .soft(
          sent(g6b, `GET ${pointerRead('staging')}`),
          '(g6) no staging read after the pre-check production read',
        )
        .toBe(1)
      for (const s of [g6a, g6b]) {
        expect.soft(sent(s, `POST ${pointerWrite('staging')}`), '(g6) no pointer POST').toBe(0)
      }
      allStageSafe()
    },
  )

  it(
    'T14-53 dry run: every plan read, no object-route POST, a read-only port, report mode dry-run; exit 0, 1 or 2 only (A21, L8, TP-12)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const stub = await newStub()
      seedMasters(stub, stories)
      const dry = await stage(stub, stageArgs(dirs, IDS, ['--dry-run']))
      expect
        .soft(classes(stub), "(g1) T14-47's classes up to the plan's end")
        .toEqual(STAGE_CLASSES.slice(0, 4))
      expect.soft(objectPosts(stub).length, '(g1) the only POSTs are list POSTs').toBe(0)
      const client = createStorageClient({
        supabaseUrl: stub.origin,
        secretKey: new Secret(FAKE_KEY),
      })
      const reader = readOnlyPort(client)
      expect
        .soft(Reflect.ownKeys(reader).sort(), '(g2) exactly the three read methods')
        .toEqual(['listContent', 'readContent', 'readMaster'])
      expect.soft(reader === (client as unknown), '(g2) a new object, not the client').toBe(false)
      expect
        .soft(
          dry.out.find((l) => l.startsWith('stage: plan ')),
          '(g3) the plan line',
        )
        .toBe(
          'stage: plan seq=1 stories=3 objects-new=12 objects-skipped=0 orphans=0 production=none staging=none',
        )
      expect.soft(readReport()?.mode, '(g3) mode dry-run').toBe('dry-run')
      expect.soft(dry.exit, '(g3) exit 0').toBe(0)
      const first = byId(stories, IDS[0]!)
      const failures: [string, (s: StorageStub) => void | typeof fetch][] = [
        [
          'catalogue listing 500',
          (s) =>
            s.override('POST', LIST_PATH, {
              kind: 'answer',
              status: 500,
              body: '{"statusCode":"500"}',
            }),
        ],
        [
          'pointer GET 500',
          (s) =>
            s.override('GET', pointerRead('staging'), {
              kind: 'answer',
              status: 500,
              body: '{"statusCode":"500"}',
            }),
        ],
        [
          'waiver GET 500',
          (s) =>
            s.override('GET', waiverRead(first.storyId, first.waiverSha256), {
              kind: 'answer',
              status: 500,
              body: '{"statusCode":"500"}',
            }),
        ],
        [
          'a story listing 500',
          () =>
            wrapFetch((url, init) => {
              if (isPost(init, url, LIST_PATH) && listPrefix(init) === `packages/${IDS[0]}`) {
                return jsonResponse(500, { statusCode: '500' })
              }
            }),
        ],
      ]
      for (const [label, setup] of failures) {
        const s = await newStub()
        seedMasters(s, stories)
        const fetchImpl = setup(s)
        const r = await stage(
          s,
          stageArgs(dirs, IDS, ['--dry-run']),
          fetchImpl ? { fetchImpl } : {},
        )
        expect.soft(r.exit, `(g4) ${label}: exit 1`).toBe(1)
      }
      allStageSafe()
    },
  )

  it('T14-54 no-op and self-heal (A15, D13-6)', TIMEOUT, async () => {
    const { stories, dirs } = await inputs()
    const stub = await newStub()
    seedMasters(stub, stories)
    expect((await stage(stub, stageArgs(dirs))).exit, 'precondition: a first stage done').toBe(0)
    const before = objectPosts(stub).length
    const again = await stage(stub, stageArgs(dirs))
    expect.soft(objectPosts(stub).length - before, '(g1) zero creates and pointer POSTs').toBe(0)
    expect
      .soft(
        again.out.find((l) => l.startsWith('stage: plan ')),
        '(g1) the exact plan line',
      )
      .toBe(
        'stage: plan seq=none stories=3 objects-new=0 objects-skipped=12 orphans=0 production=none staging=1',
      )
    expect.soft(again.exit, '(g1) exit 0').toBe(0)
    expect.soft(readReport()?.outcome, '(g1) outcome unchanged').toBe('unchanged')
    const missing = firstMediaPath(stories)
    const healed = await newStub()
    seedMasters(healed, stories)
    copyObjects(stub, healed, stories, missing)
    for (const path of ['catalogue/snapshots/1.json', 'catalogue/staging.json']) {
      const object = stub.object('content', path)!
      healed.put('content', path, object.bytes, object.contentType)
    }
    const self = await stage(healed, stageArgs(dirs))
    expect
      .soft(
        objectPosts(healed).map((r) => r.pathname),
        '(g2) that one media POST only',
      )
      .toEqual([contentWrite(missing)])
    expect.soft(self.exit, '(g2) unchanged, exit 0').toBe(0)
    expect.soft(readReport()?.outcome, '(g2) outcome unchanged').toBe('unchanged')
    allStageSafe()
  })

  it(
    'T14-55 partial failure and re-run at each stop point of §4.5 (D13-2, A19, A20)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const media2 = contentWrite(byId(stories, IDS[0]!).media[1]!.path)
      const fail500 = { kind: 'answer' as const, status: 500, body: '{"statusCode":"500"}' }
      const one = await newStub()
      seedMasters(one, stories)
      one.override('POST', media2, fail500)
      one.override('POST', media2, fail500)
      const broken = await stage(one, stageArgs(dirs))
      expect(broken.exit, 'precondition: media 2 of 9 fails twice: exit 3').toBe(3)
      const storedBefore = objectPosts(one).length
      const rerun = await stage(one, stageArgs(dirs))
      const rerunCreates = objectPosts(one)
        .slice(storedBefore)
        .filter((r) => !r.pathname.includes('/catalogue/'))
      expect
        .soft(rerunCreates.length, '(g1) the re-run uploads only the objects not stored')
        .toBe(11)
      expect.soft(rerun.exit, '(g1) then stages').toBe(0)

      const two = await newStub()
      seedMasters(two, stories)
      const otherBytes = new TextEncoder().encode('{"other":"package"}')
      const otherSha = await sha256Hex(otherBytes)
      const raced = await stage(two, stageArgs(dirs), {
        fetchImpl: wrapFetch(undefined, async (url, init) => {
          if (isPost(init, url, contentWrite('catalogue/snapshots/1.json'))) {
            two.put(
              'content',
              `packages/other-tale/${otherSha}.json`,
              otherBytes,
              'application/json',
            )
            await storeProduction(two, 2, [entryOf('other-tale', 1, otherSha)])
          }
        }),
      })
      expect.soft(raced.exit, '(g2) concurrent-writer: exit 3').toBe(3)
      expect
        .soft(lastLine(raced.out), '(g2) concurrent-writer')
        .toBe('stage: stopped: concurrent-writer')
      const recomposed = await stage(two, stageArgs(dirs))
      expect
        .soft(
          recomposed.out
            .find((l) => l.startsWith('stage: plan '))
            ?.endsWith('orphans=0 production=2 staging=none'),
          '(g2) the re-run plan line',
        )
        .toBe(true)
      expect
        .soft(
          recomposed.out
            .find((l) => l.startsWith('stage: plan '))
            ?.startsWith('stage: plan seq=3 '),
          '(g2) allocates 3',
        )
        .toBe(true)
      const three = JSON.parse(
        decode(two.object('content', 'catalogue/snapshots/3.json')?.bytes) || '{"stories":[]}',
      ) as CatalogueSnapshot
      expect.soft(three.stories[0]?.storyId, "(g2) production's story first").toBe('other-tale')
      expect.soft(recomposed.exit, '(g2) the re-run stages').toBe(0)

      const lost = await newStub()
      seedMasters(lost, stories)
      const landed = await stage(lost, stageArgs(dirs), {
        fetchImpl: wrapFetch(undefined, (url, init) => {
          if (isPost(init, url, pointerWrite('staging'))) throw new TypeError('answer lost')
        }),
      })
      expect.soft(landed.exit, '(g3) the lost answer is read back: moved').toBe(0)
      const after = await stage(lost, stageArgs(dirs))
      expect.soft(readReport()?.outcome, '(g3) the re-run is unchanged').toBe('unchanged')
      expect.soft(after.exit, '(g3) exit 0').toBe(0)

      const four = await newStub()
      seedMasters(four, stories)
      four.override('POST', pointerWrite('staging'), fail500)
      const notMoved = await stage(four, stageArgs(dirs))
      expect.soft(notMoved.exit, '(g4) pointer-not-moved: exit 4').toBe(4)
      const next = await stage(four, stageArgs(dirs))
      expect
        .soft(
          next.out.find((l) => l.startsWith('stage: plan ')),
          '(g4) the exact re-run plan line',
        )
        .toBe(
          'stage: plan seq=2 stories=3 objects-new=0 objects-skipped=12 orphans=1 production=none staging=none',
        )
      expect.soft(next.exit, '(g4) then moves').toBe(0)
      allStageSafe()
    },
  )

  it(
    'T14-56 reports on every exit once the plan started; after any write a failed report prints report-unwritten and keeps the exit code (A23, CRIT-16, TP-11)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      expect(reportDir().startsWith(root), 'precondition: the report dir in the temp root').toBe(
        true,
      )
      const cases: [string, number, (s: StorageStub) => Promise<void> | void][] = [
        ['staged', 0, () => {}],
        [
          'version-not-increased',
          1,
          async (s) => void (await storeProduction(s, 1, [entryOf(IDS[0]!, 1, 'b'.repeat(64))])),
        ],
        [
          'upload-failed',
          3,
          (s) =>
            s.override('POST', contentWrite(firstMediaPath(stories)), {
              kind: 'answer',
              status: 400,
              body: '{"statusCode":"400"}',
            }),
        ],
        [
          'pointer-not-moved',
          4,
          (s) =>
            s.override('POST', pointerWrite('staging'), {
              kind: 'answer',
              status: 500,
              body: '{"statusCode":"500"}',
            }),
        ],
      ]
      for (const [outcome, exit, setup] of cases) {
        rmSync(reportDir(), { recursive: true, force: true })
        const s = await newStub()
        seedMasters(s, stories)
        await setup(s)
        const r = await stage(s, stageArgs(dirs))
        const report = readReport()
        expect
          .soft([r.exit, report?.outcome, report?.exitCode], `(g1) ${outcome}`)
          .toEqual([exit, outcome, exit])
        expect.soft(report?.writes, `(g1) writes: ${outcome}`).toBe(objectPosts(s).length)
        for (const key of ['uploaded', 'skipped', 'orphans']) {
          expect.soft(Array.isArray(report?.[key]), `(g1) ${key}: ${outcome}`).toBe(true)
        }
        expect
          .soft((report?.uploaded as unknown[] | undefined)?.length, `(g1) uploaded: ${outcome}`)
          .toBe(exit === 0 || exit === 4 ? 12 : 0)
      }
      const first = byId(stories, IDS[0]!)
      const phase1 = await withPackage(first, { ...first.pkg, assets: [] } as StoryPackageV1)
      writeStageInputs(root, [phase1])
      rmSync(reportDir(), { recursive: true, force: true })
      const local = await stage(await newStub(), stageArgs(dirs))
      expect
        .soft([local.exit, readReport()?.outcome], '(g1) phase-1-package')
        .toEqual([1, 'phase-1-package'])
      writeStageInputs(root, stories)

      const cli = (argv: string[], over: Partial<CliDeps> = {}) =>
        runCli(argv, {
          env: { SUPABASE_URL: MEDIA_ORIGIN, SUPABASE_SECRET_KEY: FAKE_KEY },
          runContext: {},
          platform: 'win32',
          cwd: root,
          storyboardRoot: root,
          now: fakeClock().now,
          sleep: async () => {},
          log: () => {},
          error: () => {},
          loadEnv: () => true,
          createClient: () => {
            throw new Error('test: no client in a configuration stop')
          },
          ...over,
        })
      const stageArgv = ['stage', ...IDS, ...dirFlags(dirs), '--report-dir', reportDir()]
      for (const [label, argv, over] of [
        ['usage', [...stageArgv, '--unknown'], {}],
        ['stage-here-only', stageArgv, { platform: 'linux' }],
        [
          'project-mismatch',
          stageArgv,
          {
            env: {
              SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
              SUPABASE_SECRET_KEY: FAKE_KEY,
            },
          },
        ],
      ] as const) {
        rmSync(reportDir(), { recursive: true, force: true })
        const exit = await cli([...argv], over as Partial<CliDeps>)
        expect.soft(exit, `(g2) ${label}: exit 2`).toBe(2)
        expect.soft(existsSync(reportDir()), `(g2) no report: ${label}`).toBe(false)
        expect
          .soft(
            existsSync(join(root, 'migration-input', 'reports')),
            `(g2) no default report: ${label}`,
          )
          .toBe(false)
      }
      // SEC1-1: a report dir whose real path is public/ (a cwd that is a junction to the root) is a
      // usage exit that writes no report and builds no client.
      mkdirSync(join(root, 'public'))
      await withLinkedCwd(async (link) => {
        const out: string[] = []
        const err: string[] = []
        const exit = await cli(['stage', ...IDS, ...dirFlags(dirs), '--report-dir', 'public'], {
          cwd: link,
          log: (line) => void out.push(line),
          error: (line) => void err.push(line),
        })
        const label = 'a report dir in public/ through a linked cwd'
        expect.soft(exit, `(g2) ${label}: exit 2`).toBe(2)
        expect.soft(readdirSync(join(root, 'public')), `(g2) no report: ${label}`).toEqual([])
        expect
          .soft([out, err], `(g2) ${label}: the lines`)
          .toEqual([['stage: stopped: usage'], [reportDirRefused('stage')]])
      })

      rmSync(reportDir(), { recursive: true, force: true })
      const s = await newStub()
      seedMasters(s, stories)
      const kept = await stage(s, stageArgs(dirs), {
        fetchImpl: wrapFetch((url, init) => {
          if (isPost(init, url, pointerWrite('staging'))) writeFileSync(reportDir(), 'a file now')
        }),
      })
      expect.soft(kept.err, '(g3) report-unwritten on stderr').toContain('stage: report-unwritten')
      expect.soft(kept.exit, '(g3) the exit kept: 0').toBe(0)
      rmSync(reportDir(), { recursive: true, force: true })
      writeFileSync(reportDir(), 'a file from the start')
      const d = await newStub()
      seedMasters(d, stories)
      const dry = await stage(d, stageArgs(dirs, IDS, ['--dry-run']))
      expect.soft(dry.exit, '(g3) a dry run (no writes): exit 2').toBe(2)
      rmSync(reportDir(), { force: true })
      allStageSafe()
    },
  )

  it(
    'T14-57 client refusals and other throws: isStorageRefusal decides; internal prints the class name only (CRIT-3)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const probe = await newStub()
      const probeClient = createStorageClient({
        supabaseUrl: probe.origin,
        secretKey: new Secret(FAKE_KEY),
      })
      let real: unknown
      try {
        await probeClient.readContent({
          kind: 'package',
          storyId: 'two-paths',
          packageSha256: 'a'.repeat(64),
        } as never)
      } catch (error) {
        real = error
      }
      expect(real instanceof Error, 'precondition: a real refusal caught').toBe(true)
      const realText = (real as Error).message
      const fake = new Error('refused: pointer field mode S14CANARY')
      Object.defineProperty(fake, 'name', { value: 'StorageRefusedError' })
      const typeError = new TypeError(realText)
      expect.soft(isStorageRefusal(real), '(g1) the real refusal').toBe(true)
      expect.soft(isStorageRefusal(fake), '(g1) a forged name with a canary text').toBe(false)
      expect.soft(isStorageRefusal(typeError), '(g1) a TypeError with the text').toBe(false)
      expect
        .soft(
          isStorageRefusal({ name: 'StorageRefusedError', message: realText }),
          '(g1) a plain object',
        )
        .toBe(false)
      const run = async (throws: unknown, where: 'readContent' | 'writePointer') => {
        const s = await newStub()
        seedMasters(s, stories)
        return stage(s, stageArgs(dirs), {
          port: (client) =>
            ({
              ...client,
              [where]: async () => {
                throw throws
              },
            }) as StagePort,
        })
      }
      const read = await run(real, 'readContent')
      expect
        .soft(lastLine(read.out), '(g2) client-refused with the fixed text')
        .toBe(`stage: stopped: client-refused ${realText}`)
      expect.soft(read.exit, '(g2) from a plan read: exit 1').toBe(1)
      const write = await run(real, 'writePointer')
      expect
        .soft(lastLine(write.out), '(g2) from writePointer')
        .toBe(`stage: stopped: client-refused ${realText}`)
      expect.soft(write.exit, '(g2) from writePointer: exit 3').toBe(3)
      const everything = (r: Ran) => [...r.out, ...r.err, JSON.stringify(readReport())].join('\n')
      const forged = await run(fake, 'readContent')
      expect
        .soft(lastLine(forged.out), '(g3) a forged refusal is internal')
        .toBe('stage: stopped: internal StorageRefusedError')
      expect.soft(everything(forged).includes('S14CANARY'), '(g3) no canary').toBe(false)
      const typed = await run(new TypeError('S14CANARY message'), 'readContent')
      expect
        .soft(lastLine(typed.out), '(g3) a TypeError is internal')
        .toBe('stage: stopped: internal TypeError')
      expect
        .soft(everything(typed).includes('S14CANARY'), '(g3) no canary in a TypeError path')
        .toBe(false)
      const named = new Error('quiet')
      Object.defineProperty(named, 'name', { value: 's14canary-name' })
      const odd = await run(named, 'readContent')
      expect
        .soft(lastLine(odd.out), '(g4) an unfit name prints Error')
        .toBe('stage: stopped: internal Error')
      const text = await run('s14canary-string', 'readContent')
      expect
        .soft(lastLine(text.out), '(g4) a thrown string')
        .toBe('stage: stopped: internal non-error')
      expect.soft(everything(odd).includes('s14canary'), '(g4) no canary name').toBe(false)
      expect.soft(everything(text).includes('s14canary'), '(g4) no canary string').toBe(false)

      // g5 (FID-2): a story that passed the local checks without its entry or package bytes is a
      // defect stop: internal with the class name Error, exit 1 and a report, never a rejection.
      const realCheck = (await vi.importActual<typeof import('./story-checks')>('./story-checks'))
        .checkStories
      for (const [label, field] of [
        ['no entry', 'entry'],
        ['no package bytes', 'packageBytes'],
      ] as const) {
        checkStoriesSpy.mockImplementationOnce(async (ids, inputs) =>
          (await realCheck(ids, inputs)).map((story, i) =>
            i === 0 ? ({ ...story, [field]: null } as LocalStory) : story,
          ),
        )
        rmSync(reportDir(), { recursive: true, force: true })
        const s = await newStub()
        seedMasters(s, stories)
        const r = await stage(s, stageArgs(dirs)).catch(() => null)
        expect.soft(r?.exit ?? 'rejected', `(g5) ${label}: exit 1`).toBe(1)
        expect
          .soft(lastLine(r?.out ?? []), `(g5) ${label}: internal Error`)
          .toBe('stage: stopped: internal Error')
        expect.soft(readReport()?.outcome, `(g5) ${label}: the report`).toBe('internal')
        expect.soft(objectPosts(s).length, `(g5) ${label}: nothing written`).toBe(0)
      }
      allStageSafe()
    },
  )

  it('T14-58 nothing private in any channel on any path (A22, L13, CRIT-11)', TIMEOUT, async () => {
    rmSync(root, { recursive: true, force: true })
    root = mkdtempSync(join(tmpdir(), 's14-S14CANARYPATH-'))
    const stories = await testStories()
    const first = byId(stories, IDS[0]!)
    const nodeOf = (pkg: StoryPackageV1) => pkg.nodes.find((n) => n.type !== 'ending')!.id
    const idiomNode = first.pkg.nodes.filter((n) => n.id !== nodeOf(first.pkg)).at(-1)!.id
    const worded = structuredClone(first.pkg)
    // At the start: the ending rule (E014) reads how the text ends.
    worded.text.en!.nodes[idiomNode]!.text =
      `zqxcanaryword ${worded.text.en!.nodes[idiomNode]!.text}`
    const record = {
      checkId: 'E004',
      ruleId: 'S14CANARYruleId',
      nodeId: nodeOf(first.pkg),
      locale: null,
      severity: 'error' as const,
      measured: 'S14CANARYmeasured',
      limit: 'S14CANARYlimit',
      nodeTextSha256: 'f'.repeat(64),
    }
    const canaryFile = {
      ...waiverFileOf(first.storyId, [record]),
      basis: 'S14CANARYbasis',
      notes: ['S14CANARYnotes'],
      recordedOn: '1999-12-31',
      recordedBy: 'S14CANARYrecordedBy',
      measuredOnPackageSha256: '0123456789abcdef'.repeat(4),
    }
    const waiverBytes = waiverBytesOf(canaryFile)
    const canaryStory: TestStory = {
      ...(await withPackage(first, worded)),
      waiverBytes,
      waiverSha256: await sha256Hex(waiverBytes),
    }
    const all = [canaryStory, ...stories.filter((s) => s !== first)]
    const dirs = writeStageInputs(root, all)
    const privateDir = join(root, '.rules-private')
    mkdirSync(privateDir)
    const privatePath = join(privateDir, `${PANCHATANTRA_RULESET.ref}.private.json`)
    const privateFile = {
      ref: PANCHATANTRA_RULESET.ref,
      idioms: ['zqxcanaryword'],
      anachronismKeywords: [],
      sanskritNeverCall: {},
    }
    writeFileSync(privatePath, JSON.stringify(privateFile))
    const CANARIES = [
      'S14CANARYbasis',
      'S14CANARYnotes',
      'S14CANARYruleId',
      'S14CANARYmeasured',
      'S14CANARYlimit',
      'S14CANARYrecordedBy',
      '1999-12-31',
      '0123456789abcdef'.repeat(4),
      'S14CANARYPATH',
      's14canarynode',
      'S14CANARYextra',
      'S14CANARYwrongtype',
      'S14CANARYkey',
      'S14CANARYunknown',
    ]
    const IDIOM = 'zqxcanaryword'
    const reports = () =>
      existsSync(reportDir())
        ? readdirSync(reportDir())
            .map((name) => readFileSync(join(reportDir(), name), 'latin1'))
            .join('\n')
        : ''
    const bodies = (stub: StorageStub | null) =>
      stub === null
        ? ''
        : stub.requests.map((r) => Buffer.from(r.body).toString('latin1')).join('\n')
    interface Outputs {
      readonly label: string
      readonly std: string
      readonly report: string
      readonly body: string
      readonly idiomInBodies: boolean
      readonly exit: number
    }
    const results: Outputs[] = []
    const cliRun = async (
      label: string,
      argv: string[],
      stub: StorageStub | null,
      idiomBodies: boolean,
      fetchImpl?: typeof fetch,
    ) => {
      rmSync(reportDir(), { recursive: true, force: true })
      const out: string[] = []
      const exit = await runCli(argv, {
        env: { SUPABASE_URL: MEDIA_ORIGIN, SUPABASE_SECRET_KEY: FAKE_KEY },
        runContext: {},
        platform: 'win32',
        cwd: root,
        storyboardRoot: root,
        now: fakeClock().now,
        sleep: async () => {},
        log: (line) => void out.push(line),
        error: (line) => void out.push(line),
        loadEnv: () => true,
        createClient: (options) => {
          if (stub === null) throw new Error('test: no client on this path')
          return createStorageClient({
            supabaseUrl: stub.origin,
            secretKey: options.secretKey,
            ...(fetchImpl ? { fetchImpl } : {}),
          })
        },
      })
      results.push({
        label,
        std: out.join('\n'),
        report: reports(),
        body: bodies(stub),
        idiomInBodies: idiomBodies,
        exit,
      })
      return exit
    }
    const validateArgv = (ids = IDS) => [
      'validate',
      ...ids,
      ...dirFlags(dirs),
      '--report-dir',
      reportDir(),
    ]
    const stageArgv = (extra: string[] = []) => [
      'stage',
      ...IDS,
      ...dirFlags(dirs),
      '--report-dir',
      reportDir(),
      ...extra,
    ]
    const seeded = async () => {
      const s = await newStub()
      seedMasters(s, all)
      return s
    }
    expect(
      await cliRun('validate ok', validateArgv(), null, true),
      'precondition: validate ok',
    ).toBe(0)
    const validateReport = results[0]!.report
    expect(
      validateReport.includes('"checkId": "E016"'),
      'precondition: the private word raised E016',
    ).toBe(true)
    const blockedStory = await withPackage(byId(stories, IDS[1]!), {
      ...byId(stories, IDS[1]!).pkg,
      assets: [],
    } as StoryPackageV1)
    writeStageInputs(root, [blockedStory])
    expect(
      await cliRun('validate blocked', validateArgv(), null, true),
      'precondition: validate blocked',
    ).toBe(1)
    expect(
      await cliRun('stage blocked (exit 1)', stageArgv(), null, true),
      'precondition: stage exit 1',
    ).toBe(1)
    writeStageInputs(root, all)
    expect(
      await cliRun('stage dry run', stageArgv(['--dry-run']), await seeded(), true),
      'precondition: dry run',
    ).toBe(0)
    const staged = await seeded()
    expect(await cliRun('staged', stageArgv(), staged, false), 'precondition: staged').toBe(0)
    expect(await cliRun('unchanged', stageArgv(), staged, false), 'precondition: unchanged').toBe(0)
    const s3 = await seeded()
    s3.override('POST', contentWrite(canaryStory.media[0]!.path), {
      kind: 'answer',
      status: 400,
      body: '{"statusCode":"400"}',
    })
    expect(await cliRun('exit 3', stageArgv(), s3, false), 'precondition: exit 3').toBe(3)
    const s4 = await seeded()
    s4.override('POST', pointerWrite('staging'), {
      kind: 'answer',
      status: 500,
      body: '{"statusCode":"500"}',
    })
    expect(await cliRun('exit 4', stageArgv(), s4, false), 'precondition: exit 4').toBe(4)

    const errorCases: [string, string, () => void][] = [
      [
        'waiver-file-invalid',
        'an extra key',
        () =>
          writeFileSync(
            join(dirs.waiversDir, `${first.storyId}.json`),
            waiverBytesOf({ ...canaryFile, S14CANARYextra: 'S14CANARYextra value' } as never),
          ),
      ],
      [
        'waiver-file-invalid',
        'a field of the wrong type',
        () =>
          writeFileSync(
            join(dirs.waiversDir, `${first.storyId}.json`),
            waiverBytesOf({
              ...canaryFile,
              waivers: [{ ...record, ruleId: ['S14CANARYwrongtype'] }],
            } as never),
          ),
      ],
      [
        'waiver-keys-invalid',
        'a duplicate record',
        () =>
          writeFileSync(
            join(dirs.waiversDir, `${first.storyId}.json`),
            waiverBytesOf({
              ...canaryFile,
              waivers: [
                { ...record, nodeId: 's14canarynode' },
                { ...record, nodeId: 's14canarynode' },
              ],
            }),
          ),
      ],
      [
        'waiver-keys-invalid',
        'an A001 record',
        () =>
          writeFileSync(
            join(dirs.waiversDir, `${first.storyId}.json`),
            waiverBytesOf({
              ...canaryFile,
              waivers: [{ ...record, checkId: 'A001', nodeId: 's14canarynode' }],
            }),
          ),
      ],
      [
        'private-lists-invalid',
        'an extra key',
        () => writeFileSync(privatePath, JSON.stringify({ ...privateFile, S14CANARYkey: 1 })),
      ],
      [
        'private-lists-invalid',
        'an idiom of the wrong type',
        () => writeFileSync(privatePath, JSON.stringify({ ...privateFile, idioms: [[IDIOM]] })),
      ],
      [
        'package-strict-parse',
        'a canary in an unknown key',
        () =>
          writeFileSync(
            join(dirs.packagesDir, `${first.storyId}.json`),
            jcsBytes({ ...worded, S14CANARYunknown: 'S14CANARYunknown value' }),
          ),
      ],
    ]
    for (const [code, label, plant] of errorCases) {
      writeStageInputs(root, all)
      writeFileSync(privatePath, JSON.stringify(privateFile))
      plant()
      await cliRun(`validate ${code}: ${label}`, validateArgv(), null, true)
      const gotValidate = results.at(-1)!
      expect.soft(gotValidate.std.includes(code), `(g5) validate ${code}: ${label}`).toBe(true)
      const s = await seeded()
      await cliRun(`dry run ${code}: ${label}`, stageArgv(['--dry-run']), s, true)
      const gotDry = results.at(-1)!
      expect.soft(gotDry.std.includes(code), `(g5) dry run ${code}: ${label}`).toBe(true)
      for (const got of [gotValidate, gotDry]) {
        const all3 = [got.std, got.report, got.body].join('\n')
        const leaked = [...CANARIES, IDIOM].filter((c) => all3.includes(c))
        expect.soft(leaked, `(g5) no canary: ${got.label}`).toEqual([])
      }
    }
    writeStageInputs(root, all)
    writeFileSync(privatePath, JSON.stringify(privateFile))
    const origins = stubs.map((s) => s.origin.host)
    for (const got of results) {
      const std = [...CANARIES, IDIOM].filter((c) => got.std.includes(c))
      expect.soft(std, `(g1) no canary in stdout or stderr: ${got.label}`).toEqual([])
      const report = [...CANARIES, IDIOM].filter((c) => got.report.includes(c))
      expect.soft(report, `(g2) no canary in either report: ${got.label}`).toEqual([])
      const body = [...CANARIES, ...(got.idiomInBodies ? [IDIOM] : [])].filter((c) =>
        got.body.includes(c),
      )
      expect.soft(body, `(g3) no canary in any stub body: ${got.label}`).toEqual([])
      const visible = [got.std, got.report].join('\n')
      const forms = ['storage/v1', 'http://', 'https://', ...origins].filter((f) =>
        visible.includes(f),
      )
      expect.soft(forms, `(g4) no origin, route or URL: ${got.label}`).toEqual([])
      expect
        .soft(repeatsSecretRun(visible, FAKE_KEY), `(g4) no run of the key: ${got.label}`)
        .toBe(false)
    }
    allStageSafe()
  })

  it(
    'T14-59 the A25 guard is live, and a stage writer cannot create an approval (A25, CRIT-19a)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const stub = await newStub()
      seedMasters(stub, stories)
      expect((await stage(stub, stageArgs(dirs))).exit, "precondition: T14-47's run").toBe(0)
      expect(
        () => expectStageSafe(stub),
        "precondition: expectStageSafe passes on T14-47's log",
      ).not.toThrow()
      const withPost = (pathname: string): LogLike => ({
        requests: [...stub.requests, { ...stub.requests[0]!, method: 'POST', pathname }],
        unexpected: [],
      })
      expect
        .soft(
          () => expectStageSafe(withPost(pointerWrite('production'))),
          '(g1) a POST to the production pointer',
        )
        .toThrow(/production pointer/)
      expect
        .soft(
          () =>
            expectStageSafe(
              withPost(`${OBJECT_ROUTE}masters/approvals/two-paths/${'a'.repeat(64)}.json`),
            ),
          '(g1) a POST under masters',
        )
        .toThrow(/masters/)
      const writer: StageWriter = {
        create: async () => ({ kind: 'created' }),
        writePointer: async () => ({ kind: 'written' }),
      }
      const approvalRef = {
        kind: 'approval',
        storyId: 'two-paths',
        packageSha256: 'a'.repeat(64),
      } as const
      // @ts-expect-error an approval create is not a StageWriter call (D14-21)
      const approval = await writer.create(approvalRef, new Uint8Array(1))
      expect.soft(approval, '(g2) the fake writer ran').toEqual({ kind: 'created' })
      const source = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
      const at = source.findIndex((line) =>
        line.trim().startsWith('// @ts-expect-error an approval create'),
      )
      expect
        .soft(
          source[at + 1]?.includes('writer.create(approvalRef, '),
          '(g2) the directive sits before the approval create',
        )
        .toBe(true)
      allStageSafe()
    },
  )

  it(
    "T14-60 at run time stage reaches only the client's origin (A24, CRIT-5 run-time half)",
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const stub = await newStub()
      seedMasters(stub, stories)
      const staged = await stage(stub, stageArgs(dirs))
      const dryStub = await newStub()
      seedMasters(dryStub, stories)
      const dry = await stage(dryStub, stageArgs(dirs, IDS, ['--dry-run']))
      expect(
        [staged.exit, dry.exit],
        'precondition: a staged run and a dry run without fetchImpl',
      ).toEqual([0, 0])
      expect.soft(escapes, '(g1) zero escapes').toBe(0)
      expect
        .soft(loopbackRequests, "(g1) the guard's loopback count equals the stub logs")
        .toBe(stub.requests.length + dryStub.requests.length)
      allStageSafe()
    },
  )

  it(
    'T14-89 the plan gate runs on the composed documents before any write: a failure is plan-gate with zero creates (A19, TP-13, S14-AUD-15)',
    TIMEOUT,
    async () => {
      const { stories, dirs } = await inputs()
      const clean = await newStub()
      seedMasters(clean, stories)
      expect(
        (await stage(clean, stageArgs(dirs))).exit,
        'precondition: the wrapped composeStaging calls through and the run stages',
      ).toBe(0)
      expect(composeSpy, 'precondition: composeStaging called once').toHaveBeenCalledTimes(1)
      const hostile = async (
        label: string,
        group: string,
        change: (stories: SnapshotEntry[]) => SnapshotEntry[],
      ) => {
        const real = (
          await vi.importActual<typeof import('./catalogue-state')>('./catalogue-state')
        ).composeStaging
        composeSpy.mockImplementationOnce((input) => {
          const result = real(input)
          return result.ok
            ? {
                ...result,
                composition: {
                  ...result.composition,
                  stories: change([...result.composition.stories]),
                },
              }
            : result
        })
        rmSync(reportDir(), { recursive: true, force: true })
        const s = await newStub()
        seedMasters(s, stories)
        const r = await stage(s, stageArgs(dirs))
        expect
          .soft(lastLine(r.out), `(${group}) ${label}: plan-gate`)
          .toBe('stage: stopped: plan-gate')
        expect.soft(r.exit, `(${group}) ${label}: exit 1`).toBe(1)
        expect
          .soft(objectPosts(s).length, `(${group}) ${label}: zero create and pointer POSTs`)
          .toBe(0)
        expect.soft(readReport()?.outcome, `(${group}) ${label}: report outcome`).toBe('plan-gate')
      }
      await hostile('a duplicate of the first entry', 'g1', (list) => [...list, list[0]!])
      await hostile('a fixtures-form packagePath', 'g2', (list) =>
        list.map((e, i) => (i === 0 ? { ...e, packagePath: `packages/${e.storyId}.json` } : e)),
      )
      allStageSafe()
    },
  )
})
