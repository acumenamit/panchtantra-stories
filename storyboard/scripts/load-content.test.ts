// The content loader (spec §3.2; P1-2a; P1-2b design p1-step8-design.md §4, §6, §7, §9, §10.1):
// in-process loadContent against the local Storage stub (scripts/testing/stub-storage.ts) with a
// temp root, fixtures mode on copies of the committed fixtures, resolveConfig, and the real process.
// Against vacuous passes (design §10.1): each stub test asserts the exact request list it expects;
// HEAD property tests run over exactly N > 0 HEADs; deadline tests set the per-attempt timeout above
// the deadline; Storage tests serve jcsBytes of the fixture packages (the committed files are not
// canonical JCS) with the matching sha256 and packagePath.
// P1-2c (design p1-step9-design.md §3.3 A, §10.1): the staging-pointer allowlist and its
// stagingPointerAllowed truth table. Staging-pointer runs say platform win32 (this PC), as fixtures
// runs do, so they pass on Linux CI too; Production-pointer runs keep platform linux (Vercel).
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTENT_PUBLIC_BASE } from '../src/config/security-headers'
import { BuildInfo } from '../src/core/content/build-info'
import type { GateMode } from '../src/core/content/gates'
import type { MediaPackage } from '../src/core/content/media'
import type { SnapshotEntry } from '../src/core/content/packages'
import { jcsBytes, sha256Hex, toJcs } from '../src/core/hashing'
import type { CatalogueSnapshot, WaiverKeys } from '../src/core/package/catalogue'
import {
  makePointer,
  makeSnapshot,
  pointerPath,
  snapshotPath,
} from '../src/core/package/catalogue-build'
import { StoryPackageV1 } from '../src/core/package/v1'
import { findingFingerprint } from '../src/core/validator/waivers'
import { buildCatalogue, readFixtureEntries, writeCatalogue } from './build-fixtures-catalogue'
import { createFileSource } from './content/file-source'
import { runMediaGate } from './content/media-gate'
import { startDeadline } from './content/request'
import {
  BASE_URL_REFUSED,
  environmentLine,
  FIXTURES_REFUSED_HERE,
  isEntryPoint,
  loadContent,
  loadPackages,
  MAX_BODY_BYTES,
  objectUrl,
  popFromCfRay,
  POINTER_ROOTS,
  resolveConfig,
  STAGING_REFUSED_HERE,
  stagingPointerAllowed,
  vercelEnvName,
  type Env,
  type LoaderOptions,
} from './load-content'
import {
  drop,
  json,
  neverAnswer,
  redirect,
  serveObject,
  slow,
  stallBody,
  startStubStorage,
  status,
  STUB_PREFIX,
  truncateBody,
  type StubHandler,
  type StubStorage,
} from './testing/stub-storage'

const NOW = new Date('2026-11-07T10:00:00.000Z')
const SHA = 'e'.repeat(64)
const APPROVAL = 'a'.repeat(64)
const COMMIT = '1ab6342c0ffee1ab6342c0ffee1ab6342c0ffee0'
// Joined at runtime so no file holds a string shaped like a real key (secret scanners on push).
const SECRETISH = ['sb', 'secret', 'should_never_print'].join('_')

const STORAGE_ENV_LINE =
  'content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=storage GITHUB_ACTIONS=unset platform=linux'
/** A staging-pointer run on this PC (P1-2c): outside a Preview it loads only here or in CI. */
const STAGING_ENV_LINE =
  'content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=storage GITHUB_ACTIONS=unset platform=win32'
const FIXTURES_ENV_LINE =
  'content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=fixtures GITHUB_ACTIONS=unset platform=win32'

let stub: StubStorage
let baseUrl: string
let root: string
let out: string[]
let errors: string[]
let sleeps: number[]

// A fresh stub per test: a HEAD a stopped pool had already sent can reach the server after its
// test ended, and must never land in the next test's request log or in-flight count.
beforeEach(async () => {
  stub = await startStubStorage()
  baseUrl = stub.baseUrl
  out = []
  errors = []
  sleeps = []
  root = mkdtempSync(join(tmpdir(), 'load-content-'))
})

afterEach(async () => {
  await stub.close()
  rmSync(root, { recursive: true, force: true })
})

const seen = () => stub.requests
const requestList = () => seen().map((r) => [r.method, r.path])
const route = (path: string, ...handlers: StubHandler[]) => stub.queue(path, ...handlers)

// ---- catalogue ----

interface Published {
  readonly pointerPath: string
  readonly snapshotPath: string
  readonly pointerBytes: Uint8Array
  readonly snapshotBytes: Uint8Array
  readonly snapshotSha256: string
}

async function publish(
  o: {
    root?: string
    mode?: GateMode
    seq?: number
    stories?: CatalogueSnapshot['stories']
    featuredStoryId?: string | null
    pointerSha256?: string
  } = {},
): Promise<Published> {
  const seq = o.seq ?? 1
  const snapshot = await makeSnapshot({
    schemaVersion: '1.0',
    seq,
    createdAt: NOW.toISOString(),
    note: 'loader test',
    featuredStoryId: o.featuredStoryId ?? null,
    stories: o.stories ?? [],
  })
  const sPath = snapshotPath(seq, o.root)
  const pointer = await makePointer({
    schemaVersion: '1.0',
    seq,
    snapshotPath: sPath,
    snapshotSha256: o.pointerSha256 ?? snapshot.sha256,
    updatedAt: NOW.toISOString(),
  })
  const pPath = pointerPath(o.mode ?? 'production', o.root)
  stub.put(pPath, pointer.bytes, 'application/json')
  stub.put(sPath, snapshot.bytes, 'application/json; charset=utf-8')
  return {
    pointerPath: pPath,
    snapshotPath: sPath,
    pointerBytes: pointer.bytes,
    snapshotBytes: snapshot.bytes,
    snapshotSha256: snapshot.sha256,
  }
}

const storageEnv = (pointer = 'catalogue/production.json', extra: Env = {}): Env => ({
  CONTENT_SOURCE: 'storage',
  CONTENT_BASE_URL: baseUrl,
  CONTENT_POINTER: pointer,
  ...extra,
})

const run = (env: Env, extra: Partial<LoaderOptions> = {}) =>
  loadContent({
    env,
    root,
    platform: 'linux',
    now: () => NOW,
    log: (line) => void out.push(line),
    logError: (line) => void errors.push(line),
    sleep: async (ms) => void sleeps.push(ms),
    timeoutMs: 2_000,
    ...extra,
  })

/**
 * Staging-pointer runs say platform win32 (this PC), as fixtures runs do (runFixtures): outside a
 * Vercel Preview a staging pointer loads only in GitHub Actions or on Windows (P1-2c, design
 * p1-step9-design.md §3.3 A, §10.1), so they pass on Linux CI too.
 */
const runStaging = (env: Env, extra: Partial<LoaderOptions> = {}) =>
  run(env, { platform: 'win32', ...extra })

const paths = () => ({
  contentDir: join(root, '.content'),
  contentInfo: join(root, '.content', 'build-info.json'),
  publicInfo: join(root, 'public', 'build-info.json'),
})

function plantStaleOutputs(): void {
  mkdirSync(join(root, '.content'), { recursive: true })
  writeFileSync(paths().contentInfo, 'stale')
  mkdirSync(join(root, 'public'), { recursive: true })
  writeFileSync(paths().publicInfo, 'stale')
  writeFileSync(join(root, 'public', 'keep.txt'), 'not ours')
}

function expectNoOutputs(): void {
  expect(existsSync(paths().contentDir)).toBe(false)
  expect(existsSync(paths().publicInfo)).toBe(false)
}

const readBuildInfo = (path = paths().publicInfo) =>
  BuildInfo.parse(JSON.parse(readFileSync(path, 'utf8')))

const sha12 = async (bytes: Uint8Array) => (await sha256Hex(new Uint8Array(bytes))).slice(0, 12)

/**
 * Runs `body` with a temporary link to the folder `target` (a junction on Windows, which needs no
 * admin rights; a symlink elsewhere). Only the link is removed afterwards, never the target.
 */
function withLinkedFolder<T>(target: string, body: (link: string) => T): T {
  const parent = mkdtempSync(join(tmpdir(), 'load-content-link-'))
  const link = join(parent, 'linked')
  symlinkSync(target, link, 'junction')
  try {
    return body(link)
  } finally {
    unlinkSync(link)
    rmdirSync(parent) // not recursive: it refuses to run if the link were still there
  }
}

// ---- Storage packages and synthetic media ----

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const storyboardDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_IDS = ['lantern-walk', 'river-stones', 'two-paths']

const fixturePackage = (storyId: string): Json =>
  JSON.parse(readFileSync(join(storyboardDir, 'fixtures', 'packages', `${storyId}.json`), 'utf8'))

interface Served {
  readonly entry: SnapshotEntry
  readonly pkg: Json
  readonly bytes: Uint8Array<ArrayBuffer>
}

/**
 * A committed fixture package, changed by `mutate`, served as canonical JCS at the spec layout
 * `<root>packages/<storyId>/<sha256>.json`, with its snapshot entry.
 */
async function servePackage(
  storyId: string,
  o: {
    root?: string
    mutate?: (pkg: Json) => void
    approved?: boolean
    waivers?: WaiverKeys
    serve?: boolean
  } = {},
): Promise<Served> {
  const pkg = fixturePackage(storyId)
  o.mutate?.(pkg)
  const bytes = jcsBytes(pkg)
  const packageSha256 = await sha256Hex(bytes)
  const entry: SnapshotEntry = {
    storyId,
    collectionId: pkg.collectionId,
    version: pkg.version,
    packagePath: `${o.root ?? ''}packages/${storyId}/${packageSha256}.json`,
    packageSha256,
    ...(o.approved ? { approvalSha256: APPROVAL } : {}),
    ...(o.waivers ? { waivers: o.waivers } : {}),
  }
  if (o.serve !== false) stub.put(entry.packagePath, bytes, 'application/json')
  return { entry, pkg, bytes }
}

type MediaMime = 'image/webp' | 'image/jpeg' | 'audio/mpeg'
const EXT: Record<MediaMime, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'audio/mpeg': 'mp3',
}

interface MediaVariant {
  readonly path: string
  readonly mime: MediaMime
  readonly bytes: number
}

const hex64 = (n: number) => n.toString(16).padStart(64, '0')
const variantPath = (storyId: string, n: number, name: string, mime: MediaMime, prefix = '') =>
  `${prefix}media/${storyId}/${hex64(n)}-${name}.${EXT[mime]}`

/** Adds an image asset (id hex64(n)) with these variants; returns them. */
function addImage(
  pkg: Json,
  n: number,
  variants: readonly (readonly [name: string, mime: MediaMime, bytes: number])[],
  prefix = '',
): MediaVariant[] {
  const list = variants.map(([name, mime, bytes]) => ({
    path: variantPath(pkg.storyId, n, name, mime, prefix),
    mime,
    bytes,
  }))
  pkg.assets.push({
    kind: 'image',
    id: hex64(n),
    width: 800,
    height: 600,
    variants: list.map((v) => ({ ...v, width: 800 })),
    provenance: { origin: 'human' },
  })
  return list
}

/** Adds an audio asset (id hex64(n)) for one node and locale; returns its one variant. */
function addAudio(
  pkg: Json,
  n: number,
  nodeId: string,
  locale: string,
  bytes: number,
  prefix = '',
): MediaVariant {
  const variant = {
    path: variantPath(pkg.storyId, n, 'mp3', 'audio/mpeg', prefix),
    mime: 'audio/mpeg' as const,
    bytes,
  }
  pkg.assets.push({
    kind: 'audio',
    id: hex64(n),
    nodeId,
    locale,
    durationMs: 1000,
    variants: [variant],
    provenance: { origin: 'human' },
    narratedTextSha256: SHA,
  })
  return variant
}

/** Stores each variant as an object of exactly its declared size and type. */
function serveMedia(variants: readonly MediaVariant[]): void {
  for (const v of variants) stub.put(v.path, new Uint8Array(v.bytes), v.mime)
}

/** Every node pictured and narrated in every locale (a package the featured rule keeps). */
function addFullMedia(pkg: Json): MediaVariant[] {
  const variants: MediaVariant[] = []
  let n = 100
  for (const node of pkg.nodes) {
    const id = n++
    variants.push(...addImage(pkg, id, [['w800', 'image/webp', 2000 + id]]))
    node.image = hex64(id)
    for (const locale of pkg.locales) variants.push(addAudio(pkg, n++, node.id, locale, 3000 + n))
  }
  return variants
}

/** The GETs of a staging load of these packages: pointer, snapshot, then each package in order. */
const stagingGets = (...served: readonly Served[]) => [
  ['GET', 'catalogue/staging.json'],
  ['GET', 'catalogue/snapshots/1.json'],
  ...served.map((s) => ['GET', s.entry.packagePath]),
]

const fetchLine = async (path: string, bytes: Uint8Array, seq = '-') =>
  `content: fetch path=${path} status=200 cf=MISS age=0 pop=BOM sha=${await sha12(bytes)} seq=${seq}`

const packageLine = (entry: SnapshotEntry, waived = 0) =>
  expect.stringMatching(
    new RegExp(
      `^content: package story=${entry.storyId} version=${entry.version} sha=${entry.packageSha256.slice(0, 12)} errors=0 waived=${waived} warnings=\\d+ info=\\d+$`,
    ),
  )

const skippedLine = (storyId: string) =>
  `content: validator skipped E016,E017,E018 for story=${storyId} (private word lists not loaded)`

const summaryLine = (heads: number, ok: number, failed = 0, retried = 0) =>
  expect.stringMatching(
    new RegExp(
      `^content: media heads=${heads} ok=${ok} failed=${failed} retried=${retried} ms=\\d+$`,
    ),
  )

// ---- tests ----

describe('loadContent: storage mode, good content', () => {
  it('loads a production pointer and snapshot and writes both outputs', async () => {
    const pub = await publish()
    const env = storageEnv('catalogue/production.json', {
      VERCEL_GIT_COMMIT_SHA: COMMIT,
      VERCEL_DEPLOYMENT_ID: 'dpl_test',
      VERCEL_URL: 'storyboard-abc.vercel.app',
    })
    expect(await run(env)).toBe(0)
    expect(errors).toEqual([])

    const info = readBuildInfo()
    expect(info).toEqual({
      schemaVersion: '1.0',
      mode: 'production',
      seq: 1,
      pointerPath: 'catalogue/production.json',
      snapshotPath: 'catalogue/snapshots/1.json',
      snapshotSha256: pub.snapshotSha256,
      featuredStoryId: null,
      stories: [],
      excluded: [],
      appVersion: COMMIT,
      deploymentId: 'dpl_test',
      deploymentUrl: 'storyboard-abc.vercel.app',
      builtAt: NOW.toISOString(),
      fetches: [
        {
          path: 'catalogue/production.json',
          status: 200,
          cfCacheStatus: 'MISS',
          age: 0,
          pop: 'BOM',
          sha256: await sha12(pub.pointerBytes),
          ms: expect.any(Number),
        },
        {
          path: 'catalogue/snapshots/1.json',
          status: 200,
          cfCacheStatus: 'MISS',
          age: 0,
          pop: 'BOM',
          sha256: await sha12(pub.snapshotBytes),
          ms: expect.any(Number),
        },
      ],
    })
    // Both copies are the same canonical bytes; the verified inputs are kept byte for byte.
    expect(readFileSync(paths().contentInfo, 'utf8')).toBe(toJcs(info))
    expect(readFileSync(paths().publicInfo, 'utf8')).toBe(toJcs(info))
    expect(new Uint8Array(readFileSync(join(root, '.content', 'pointer.json')))).toEqual(
      pub.pointerBytes,
    )
    expect(new Uint8Array(readFileSync(join(root, '.content', 'snapshot.json')))).toEqual(
      pub.snapshotBytes,
    )
    expect(existsSync(join(root, '.content', '.tmp'))).toBe(false)
  })

  it('logs the environment line, one line per GET, the media summary, featured and a final line', async () => {
    const pub = await publish()
    expect(await run(storageEnv())).toBe(0)
    expect(out).toEqual([
      STORAGE_ENV_LINE,
      await fetchLine('catalogue/production.json', pub.pointerBytes, '1'),
      await fetchLine('catalogue/snapshots/1.json', pub.snapshotBytes, '1'),
      summaryLine(0, 0),
      'content: featured none',
      'content: mode=production seq=1 snapshot=catalogue/snapshots/1.json stories=0 excluded=0 featured=none',
    ])
  })

  it('reads the pointer with a cacheNonce and the snapshot without a query, both with identity encoding', async () => {
    await publish()
    expect(await run(storageEnv())).toBe(0)
    expect(seen().map((r) => [r.method, r.path, r.query.toString()])).toEqual([
      ['GET', 'catalogue/production.json', `cacheNonce=${NOW.getTime()}`],
      ['GET', 'catalogue/snapshots/1.json', ''],
    ])
    expect(seen().every((r) => r.headers['accept-encoding'] === 'identity')).toBe(true)
  })

  it('maps a staging pointer to staging mode and leaves Vercel values null outside Vercel', async () => {
    await publish({ mode: 'staging', seq: 4 })
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    const info = readBuildInfo()
    expect(info.mode).toBe('staging')
    expect(info.seq).toBe(4)
    expect([info.appVersion, info.deploymentId, info.deploymentUrl]).toEqual([null, null, null])
  })

  it('replaces stale outputs and leaves other public files alone', async () => {
    plantStaleOutputs()
    await publish()
    expect(await run(storageEnv())).toBe(0)
    expect(readBuildInfo(paths().contentInfo).seq).toBe(1)
    expect(readFileSync(join(root, 'public', 'keep.txt'), 'utf8')).toBe('not ours')
  })

  it('loads a staging pointer, its packages in snapshot order and their media, and writes every output', async () => {
    const media: MediaVariant[] = []
    const lantern = await servePackage('lantern-walk')
    const river = await servePackage('river-stones', {
      mutate: (pkg) => {
        media.push(
          ...addImage(pkg, 1, [
            ['w800', 'image/webp', 1200],
            ['w400', 'image/webp', 600],
          ]),
          addAudio(pkg, 2, 'start', 'en', 3000),
        )
      },
    })
    const two = await servePackage('two-paths', {
      mutate: (pkg) => void media.push(...addImage(pkg, 3, [['full', 'image/jpeg', 5000]])),
    })
    serveMedia(media)
    const served = [lantern, river, two]
    const pub = await publish({ mode: 'staging', stories: served.map((s) => s.entry) })
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(errors).toEqual([])

    // GETs one at a time in snapshot order, then exactly one HEAD per declared variant.
    const list = requestList()
    expect(list.slice(0, 5)).toEqual([
      ['GET', 'catalogue/staging.json'],
      ['GET', 'catalogue/snapshots/1.json'],
      ...served.map((s) => ['GET', s.entry.packagePath]),
    ])
    expect(list.slice(5).sort()).toEqual(media.map((v) => ['HEAD', v.path]).sort())
    expect(
      seen()
        .filter((r) => r.method === 'HEAD')
        .every((r) => r.query.toString() === ''),
    ).toBe(true)

    const info = readBuildInfo()
    expect(info.mode).toBe('staging')
    expect(info.stories).toEqual(
      served.map(({ entry }) => ({
        storyId: entry.storyId,
        version: entry.version,
        packageSha256: entry.packageSha256,
      })),
    )
    expect(info.featuredStoryId).toBeNull()
    expect(info.excluded).toEqual([])
    // build-info lists GETs only; HEADs are logged, never recorded.
    expect(info.fetches.map((f) => [f.path, f.status])).toEqual([
      ['catalogue/staging.json', 200],
      ['catalogue/snapshots/1.json', 200],
      ...served.map((s) => [s.entry.packagePath, 200]),
    ])
    expect(readdirSync(join(root, '.content', 'packages')).sort()).toEqual(
      FIXTURE_IDS.map((id) => `${id}.json`),
    )
    for (const s of served) {
      expect(
        new Uint8Array(readFileSync(join(root, '.content', 'packages', `${s.entry.storyId}.json`))),
      ).toEqual(s.bytes)
    }

    const expected: unknown[] = [
      STAGING_ENV_LINE,
      await fetchLine('catalogue/staging.json', pub.pointerBytes, '1'),
      await fetchLine('catalogue/snapshots/1.json', pub.snapshotBytes, '1'),
    ]
    for (const s of served) {
      expected.push(
        await fetchLine(s.entry.packagePath, s.bytes),
        packageLine(s.entry),
        skippedLine(s.entry.storyId),
      )
    }
    expected.push(
      'content: media story=lantern-walk variants=0 bytes=0 ok',
      'content: media story=river-stones variants=3 bytes=4800 ok',
      'content: media story=two-paths variants=1 bytes=5000 ok',
      summaryLine(4, 4),
      'content: featured none',
      'content: mode=staging seq=1 snapshot=catalogue/snapshots/1.json stories=3 excluded=0 featured=none',
    )
    expect(out).toEqual(expected)
  })

  it('loads a production pointer: excluded entries are logged and path-checked, never fetched or HEADed', async () => {
    const media: MediaVariant[] = []
    const lantern = await servePackage('lantern-walk', { approved: true })
    const river = await servePackage('river-stones', {
      approved: true,
      mutate: (pkg) => void media.push(...addImage(pkg, 7, [['w800', 'image/webp', 900]])),
    })
    const two = await servePackage('two-paths', {
      mutate: (pkg) => void addImage(pkg, 8, [['w800', 'image/webp', 900]]),
    })
    serveMedia(media)
    await publish({ stories: [lantern.entry, two.entry, river.entry] })
    expect(await run(storageEnv())).toBe(0)
    expect(errors).toEqual([])
    expect(requestList()).toEqual([
      ['GET', 'catalogue/production.json'],
      ['GET', 'catalogue/snapshots/1.json'],
      ['GET', lantern.entry.packagePath],
      ['GET', river.entry.packagePath],
      ['HEAD', media[0]!.path],
    ])
    const info = readBuildInfo()
    expect(info.stories.map((s) => s.storyId)).toEqual(['lantern-walk', 'river-stones'])
    expect(info.excluded).toEqual([
      { storyId: 'two-paths', version: 1, reason: 'approval-missing' },
    ])
    expect(out).toContain('content: excluded story=two-paths version=1 reason=approval-missing')
    expect(out.at(-1)).toBe(
      'content: mode=production seq=1 snapshot=catalogue/snapshots/1.json stories=2 excluded=1 featured=none',
    )
    expect(existsSync(join(root, '.content', 'packages', 'two-paths.json'))).toBe(false)
  })

  it('excludes unapproved stories in production mode and logs each one', async () => {
    const two = await servePackage('two-paths', { serve: false })
    await publish({ stories: [two.entry] })
    expect(await run(storageEnv())).toBe(0)
    expect(readBuildInfo().excluded).toEqual([
      { storyId: 'two-paths', version: 1, reason: 'approval-missing' },
    ])
    expect(out).toContain('content: excluded story=two-paths version=1 reason=approval-missing')
    expect(requestList()).toEqual([
      ['GET', 'catalogue/production.json'],
      ['GET', 'catalogue/snapshots/1.json'],
    ])
  })

  it('applies the snapshot entry waiver keys: each waived finding and each unused key on its own line', async () => {
    const parsed: { pkg?: StoryPackageV1 } = {}
    const mutate = (pkg: Json) => {
      pkg.text.en.nodes.start.question = 'Which way? Left or right?'
      parsed.pkg = StoryPackageV1.parse(pkg)
    }
    // A first pass only to compute the fingerprint the key binds to.
    await servePackage('two-paths', { mutate, serve: false })
    const keys: WaiverKeys = {
      ruleSetRef: 'panchatantra@3.0.0',
      waiverFileSha256: 'b'.repeat(64),
      keys: [
        { checkId: 'E004', nodeId: 'start', locale: 'hi', nodeTextSha256: 'f'.repeat(64) },
        {
          checkId: 'E005',
          nodeId: 'start',
          locale: 'en',
          nodeTextSha256: await findingFingerprint(parsed.pkg!, { nodeId: 'start', locale: 'en' }),
        },
      ],
    }
    const two = await servePackage('two-paths', { mutate, waivers: keys })
    await publish({ mode: 'staging', stories: [two.entry] })
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(errors).toEqual([])
    expect(requestList()).toEqual(stagingGets(two))
    const at = out.findIndex((line) => line.startsWith('content: package story=two-paths'))
    expect(out.slice(at, at + 4)).toEqual([
      packageLine(two.entry, 1),
      'content: waived story=two-paths check=E005 node=start locale=en',
      'content: waiver key unused story=two-paths check=E004 node=start locale=hi (no matching finding)',
      skippedLine('two-paths'),
    ])
  })
})

describe('loadContent: storage packages fail closed', () => {
  /** One staging entry, two-paths, with the given serving; returns it. */
  async function oneStory(o: Parameters<typeof servePackage>[1] = {}): Promise<Served> {
    const two = await servePackage('two-paths', o)
    await publish({ mode: 'staging', stories: [two.entry] })
    return two
  }

  async function expectFailure(lines: readonly string[]): Promise<void> {
    plantStaleOutputs()
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(1)
    expect(errors).toEqual(lines)
    expectNoOutputs()
  }

  const GETS = stagingGets

  it('fails on a missing package object (Supabase answers 400) without retrying', async () => {
    const two = await oneStory({ serve: false })
    await expectFailure(['content gate failed: package two-paths GET returned status 400'])
    expect(requestList()).toEqual(GETS(two))
    expect(sleeps).toEqual([])
  })

  it('retries a 5xx package answer, then loads it', async () => {
    const two = await oneStory()
    route(two.entry.packagePath, status(503), json(two.bytes))
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(requestList()).toEqual([...GETS(two), ['GET', two.entry.packagePath]])
    expect(sleeps).toEqual([1_000])
    expect(readBuildInfo().fetches.map((f) => f.status)).toEqual([200, 200, 503, 200])
  })

  it('retries a 429 after its Retry-After of 2 s, then loads it', async () => {
    const two = await oneStory()
    route(two.entry.packagePath, status(429, { 'retry-after': '2' }), json(two.bytes))
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(requestList()).toEqual([...GETS(two), ['GET', two.entry.packagePath]])
    expect(sleeps).toEqual([2_000])
  })

  it('fails at once when Retry-After asks for more than 10 s', async () => {
    const two = await oneStory()
    route(two.entry.packagePath, status(429, { 'retry-after': '11' }))
    await expectFailure(['content gate failed: package two-paths GET asked to wait 11 s'])
    expect(requestList()).toEqual(GETS(two))
    expect(sleeps).toEqual([])
  })

  it('fails on a package content-type other than application/json', async () => {
    const two = await oneStory()
    route(two.entry.packagePath, json(two.bytes, 'text/plain'))
    await expectFailure([
      'content gate failed: package two-paths content-type must be application/json, got text/plain',
    ])
    expect(requestList()).toEqual(GETS(two))
  })

  it('fails on a package larger than 1 MiB', async () => {
    const two = await oneStory()
    route(two.entry.packagePath, json(new Uint8Array(MAX_BODY_BYTES + 1)))
    await expectFailure([
      `content gate failed: package two-paths is larger than ${MAX_BODY_BYTES} bytes`,
    ])
    expect(requestList()).toEqual(GETS(two))
  })

  it('fails on a packagePath off the spec layout before any package GET', async () => {
    const two = await servePackage('two-paths')
    const entry = { ...two.entry, packagePath: 'packages/two-paths.json' }
    await publish({ mode: 'staging', stories: [entry] })
    await expectFailure([
      `content gate failed: snapshot entry two-paths: packagePath must be packages/two-paths/${two.entry.packageSha256}.json`,
    ])
    expect(requestList()).toEqual([
      ['GET', 'catalogue/staging.json'],
      ['GET', 'catalogue/snapshots/1.json'],
    ])
  })

  it('path-checks excluded entries too, before any package GET', async () => {
    const lantern = await servePackage('lantern-walk', { approved: true })
    const two = await servePackage('two-paths')
    await publish({
      stories: [lantern.entry, { ...two.entry, packagePath: `packages/${SHA}.json` }],
    })
    plantStaleOutputs()
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual([
      `content gate failed: snapshot entry two-paths: packagePath must be packages/two-paths/${two.entry.packageSha256}.json`,
    ])
    expect(requestList()).toEqual([
      ['GET', 'catalogue/production.json'],
      ['GET', 'catalogue/snapshots/1.json'],
    ])
    expectNoOutputs()
  })

  it('fails on a package whose bytes do not match the snapshot sha256', async () => {
    const two = await oneStory()
    route(two.entry.packagePath, json(jcsBytes({ ...two.pkg, emoji: 'x' })))
    await expectFailure(['content gate failed: package two-paths sha256 mismatch'])
    expect(requestList()).toEqual(GETS(two))
  })

  it('fails on Storage package bytes that are not canonical JCS', async () => {
    const pretty = new TextEncoder().encode(JSON.stringify(fixturePackage('two-paths'), null, 2))
    const sha = await sha256Hex(pretty)
    const entry: SnapshotEntry = {
      storyId: 'two-paths',
      collectionId: 'panchatantra',
      version: 1,
      packagePath: `packages/two-paths/${sha}.json`,
      packageSha256: sha,
    }
    stub.put(entry.packagePath, pretty, 'application/json')
    await publish({ mode: 'staging', stories: [entry] })
    await expectFailure(['content gate failed: package two-paths is not canonical JCS'])
    expect(requestList()).toEqual([
      ['GET', 'catalogue/staging.json'],
      ['GET', 'catalogue/snapshots/1.json'],
      ['GET', entry.packagePath],
    ])
  })

  it('fails on an unwaived validator error, printing its detail line before the failure line', async () => {
    const two = await oneStory({
      mutate: (pkg) => void (pkg.text.en.nodes.start.question = 'Which way? Left or right?'),
    })
    await expectFailure([
      'content: unwaived story=two-paths check=E005 node=start locale=en: 2 question marks (exactly 1 expected)',
      'content gate failed: package two-paths failed the validator with 1 unwaived error(s); first: E005 node=start locale=en: 2 question marks (exactly 1 expected)',
    ])
    expect(requestList()).toEqual(GETS(two))
  })

  it('marks a key that binds other text as lapsed', async () => {
    const keys: WaiverKeys = {
      ruleSetRef: 'panchatantra@3.0.0',
      waiverFileSha256: 'b'.repeat(64),
      keys: [{ checkId: 'E005', nodeId: 'start', locale: 'en', nodeTextSha256: 'c'.repeat(64) }],
    }
    const two = await oneStory({
      waivers: keys,
      mutate: (pkg) => void (pkg.text.en.nodes.start.question = 'Which way? Left or right?'),
    })
    await expectFailure([
      'content: unwaived story=two-paths check=E005 node=start locale=en: 2 question marks (exactly 1 expected) (lapsed: a key for this check, node and locale binds other text)',
      'content gate failed: package two-paths failed the validator with 1 unwaived error(s); first: E005 node=start locale=en: 2 question marks (exactly 1 expected)',
    ])
    expect(requestList()).toEqual(GETS(two))
  })

  it('fails on waiver keys recorded under another rule set', async () => {
    const two = await oneStory({
      waivers: { ruleSetRef: 'panchatantra@3.1.0', waiverFileSha256: 'b'.repeat(64), keys: [] },
    })
    await expectFailure([
      'content gate failed: waiver keys for two-paths were recorded for panchatantra@3.1.0; this build validates with panchatantra@3.0.0',
    ])
    expect(requestList()).toEqual(GETS(two))
  })

  it('fails on waiver keys on a package whose origin is not migration', async () => {
    const two = await oneStory({
      mutate: (pkg) => void (pkg.origin = 'agent_flow'),
      waivers: { ruleSetRef: 'panchatantra@3.0.0', waiverFileSha256: 'b'.repeat(64), keys: [] },
    })
    await expectFailure([
      'content gate failed: package two-paths carries waiver keys but its origin is agent_flow; waivers apply only to origin migration (spec §5.3)',
    ])
    expect(requestList()).toEqual(GETS(two))
  })

  it('stops at the first failing package, in snapshot order', async () => {
    const lantern = await servePackage('lantern-walk', { serve: false })
    const two = await servePackage('two-paths')
    await publish({ mode: 'staging', stories: [lantern.entry, two.entry] })
    await expectFailure(['content gate failed: package lantern-walk GET returned status 400'])
    expect(requestList()).toEqual([
      ['GET', 'catalogue/staging.json'],
      ['GET', 'catalogue/snapshots/1.json'],
      ['GET', lantern.entry.packagePath],
    ])
  })

  it('fails a media pre-check before any HEAD', async () => {
    const two = await oneStory({
      mutate: (pkg) =>
        void pkg.assets.push({
          kind: 'image',
          id: hex64(1),
          width: 800,
          height: 600,
          variants: [
            { path: `media/other-story/${hex64(1)}-w800.webp`, mime: 'image/webp', bytes: 10 },
          ],
          provenance: { origin: 'human' },
        }),
    })
    await expectFailure([
      `content gate failed: package two-paths media media/other-story/${hex64(1)}-w800.webp: path must be media/two-paths/<64 hex>-<variant>.<ext>`,
    ])
    expect(requestList()).toEqual(GETS(two))
  })
})

describe('loadContent: the media HEAD gate', () => {
  /** two-paths with one declared variant, served by `handlers` (default: the stored object). */
  async function oneVariant(
    handlers: StubHandler[] = [],
    mime: MediaMime = 'image/webp',
    bytes = 1000,
  ): Promise<{ readonly path: string; readonly two: Served }> {
    let variant: MediaVariant | undefined
    const two = await servePackage('two-paths', {
      mutate: (pkg) => {
        variant =
          mime === 'audio/mpeg'
            ? addAudio(pkg, 5, 'start', 'en', bytes)
            : (addImage(pkg, 5, [['w800', mime, bytes]])[0] as MediaVariant)
      },
    })
    serveMedia([variant!])
    if (handlers.length > 0) route(variant!.path, ...handlers)
    await publish({ mode: 'staging', stories: [two.entry] })
    return { path: variant!.path, two }
  }

  const heads = () => seen().filter((r) => r.method === 'HEAD')

  it.each<[string, StubHandler[], string, number, Partial<LoaderOptions>?]>([
    ['304', [status(304)], 'status 304', 1],
    ['404', [status(404)], 'status 404', 1],
    [
      'a redirect, never followed',
      [redirect(302, `${STUB_PREFIX}elsewhere.webp`)],
      'redirect 302 (not followed)',
      1,
    ],
    ['503 on every attempt', [status(503)], 'failed after 3 attempts: status 503', 3],
    ['429 asking for 11 s', [status(429, { 'retry-after': '11' })], 'asked to wait 11 s', 1],
    [
      'a timeout on every attempt',
      [neverAnswer],
      'failed after 3 attempts: TimeoutError',
      3,
      { timeoutMs: 100 },
    ],
    ['no content-length', [serveObject({ contentLength: null })], 'content-length missing', 1],
    [
      'a wrong content-length',
      [serveObject({ contentLength: 999 })],
      'content-length 999 does not match declared 1000',
      1,
    ],
    [
      'another media type',
      [serveObject({ contentType: 'image/png' })],
      'content-type image/png does not match declared image/webp',
      1,
    ],
    [
      'binary/octet-stream',
      [serveObject({ contentType: 'binary/octet-stream' })],
      'content-type binary/octet-stream does not match declared image/webp',
      1,
    ],
    [
      'content-encoding br',
      [serveObject({ contentEncoding: 'br' })],
      'content-encoding br is not identity',
      1,
    ],
  ])('fails on %s, naming the variant', async (_what, handlers, reason, attempts, extra = {}) => {
    const { path, two } = await oneVariant(handlers)
    plantStaleOutputs()
    expect(await runStaging(storageEnv('catalogue/staging.json'), extra)).toBe(1)
    expect(errors).toEqual([
      `content: media failed story=two-paths path=${path} reason=${reason}`,
      `content gate failed: media HEAD failed for 1 of 1 variants; first: ${path} ${reason}`,
    ])
    expect(requestList()).toEqual([
      ['GET', 'catalogue/staging.json'],
      ['GET', 'catalogue/snapshots/1.json'],
      ['GET', two.entry.packagePath],
      ...Array.from({ length: attempts }, () => ['HEAD', path]),
    ])
    // One `media head` line per attempt that was not a 200; a judged 200 logs none.
    const headLines = out.filter((line) => line.startsWith(`content: media head path=${path} `))
    expect(headLines).toHaveLength(reason.startsWith('content-') ? 0 : attempts)
    expectNoOutputs()
  })

  it('fails on a missing media object (Supabase answers 400)', async () => {
    let path = ''
    const two = await servePackage('two-paths', {
      mutate: (pkg) => void (path = addImage(pkg, 5, [['w800', 'image/webp', 1000]])[0]!.path),
    })
    await publish({ mode: 'staging', stories: [two.entry] })
    plantStaleOutputs()
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(1)
    expect(errors).toEqual([
      `content: media failed story=two-paths path=${path} reason=status 400`,
      `content gate failed: media HEAD failed for 1 of 1 variants; first: ${path} status 400`,
    ])
    expect(out).toContain(`content: media head path=${path} attempt=1 status=400`)
    expect(requestList()).toEqual([...stagingGets(two), ['HEAD', path]])
    expectNoOutputs()
  })

  it.each<[string, StubHandler[], number[], string[]]>([
    ['audio/mpeg; charset=x', [serveObject({ contentType: 'audio/mpeg; charset=x' })], [], []],
    ['content-encoding identity', [serveObject({ contentEncoding: 'identity' })], [], []],
    [
      '503, then 200',
      [status(503), serveObject()],
      [1_000],
      ['attempt=1 status=503', 'attempt=2 status=200'],
    ],
    [
      '429 with Retry-After 2, then 200',
      [status(429, { 'retry-after': '2' }), serveObject()],
      [2_000],
      ['attempt=1 status=429', 'attempt=2 status=200'],
    ],
    [
      'a dropped connection, then 200',
      [drop, serveObject()],
      [1_000],
      ['attempt=1 status=error(TypeError', 'attempt=2 status=200'],
    ],
  ])('passes on %s', async (what, handlers, expectedSleeps, headLines) => {
    const mime = what.startsWith('audio') ? 'audio/mpeg' : 'image/webp'
    const { path, two } = await oneVariant(handlers, mime)
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(errors).toEqual([])
    expect(sleeps).toEqual(expectedSleeps)
    const logged = out.filter((line) => line.startsWith('content: media head '))
    expect(logged).toHaveLength(headLines.length)
    headLines.forEach((fragment, i) => {
      expect(logged[i]!.startsWith(`content: media head path=${path} ${fragment}`)).toBe(true)
    })
    expect(out).toContain('content: media story=two-paths variants=1 bytes=1000 ok')
    expect(out).toContainEqual(summaryLine(1, 1, 0, headLines.length > 0 ? 1 : 0))
    expect(requestList()).toEqual([
      ...stagingGets(two),
      ...Array.from({ length: Math.max(1, headLines.length) }, () => ['HEAD', path]),
    ])
  })

  it('records a missing Accept-Ranges in a note line only', async () => {
    const { path, two } = await oneVariant([serveObject({ acceptRanges: false })])
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(requestList()).toEqual([...stagingGets(two), ['HEAD', path]])
    expect(out.slice(-4)).toEqual([
      summaryLine(1, 1),
      'content: media note: 1 of 1 answers had no "Accept-Ranges: bytes" (recorded, not a gate)',
      'content: featured none',
      'content: mode=staging seq=1 snapshot=catalogue/snapshots/1.json stories=1 excluded=0 featured=none',
    ])
  })

  it('sends identity encoding, no authorization, no cookie and no query on exactly N HEADs', async () => {
    const media: MediaVariant[] = []
    const two = await servePackage('two-paths', {
      mutate: (pkg) =>
        void media.push(
          ...addImage(pkg, 1, [
            ['w800', 'image/webp', 100],
            ['w400', 'image/webp', 50],
          ]),
          addAudio(pkg, 2, 'start', 'hi', 70),
        ),
    })
    serveMedia(media)
    await publish({ mode: 'staging', stories: [two.entry] })
    stub.setCookie('__cf_bm=stub-cookie; Path=/; HttpOnly')
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(
      heads()
        .map((r) => r.path)
        .sort(),
    ).toEqual(media.map((v) => v.path).sort())
    expect(heads()).toHaveLength(3)
    for (const r of seen()) {
      expect(r.headers['accept-encoding']).toBe('identity')
      expect(r.headers.authorization).toBeUndefined()
      expect(r.headers.cookie).toBeUndefined()
    }
    expect(heads().every((r) => r.query.toString() === '')).toBe(true)
  })

  it('keeps 6 HEADs in flight, never more', async () => {
    const media: MediaVariant[] = []
    const two = await servePackage('two-paths', {
      mutate: (pkg) => {
        for (let i = 0; i < 12; i++)
          media.push(...addImage(pkg, 10 + i, [['w800', 'image/webp', 100 + i]]))
      },
    })
    serveMedia(media)
    for (const v of media) route(v.path, slow(150, serveObject()))
    await publish({ mode: 'staging', stories: [two.entry] })
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(heads()).toHaveLength(12)
    expect(stub.maxInFlight).toBe(6)
  })

  it('stops after 10 failures and lists them in declaration order', async () => {
    const media: MediaVariant[] = []
    const two = await servePackage('two-paths', {
      mutate: (pkg) => {
        for (let i = 0; i < 20; i++)
          media.push(...addImage(pkg, 30 + i, [['w800', 'image/webp', 100]]))
      },
    })
    serveMedia(media)
    // Later variants answer sooner, so completion order differs from declaration order.
    media.forEach((v, i) => route(v.path, slow((20 - i) * 4, status(404))))
    await publish({ mode: 'staging', stories: [two.entry] })
    plantStaleOutputs()
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(1)
    expect(errors).toHaveLength(11)
    const failed = errors.slice(0, 10).map((line) => {
      const match = /^content: media failed story=two-paths path=(\S+) reason=status 404$/.exec(
        line,
      )
      expect(match).not.toBeNull()
      return match![1]!
    })
    const order = failed.map((path) => media.findIndex((v) => v.path === path))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(errors[10]).toBe(
      `content gate failed: media HEAD failed for 10 of 20 variants; first: ${failed[0]} status 404`,
    )
    expect(heads().length).toBeGreaterThanOrEqual(10)
    expect(heads().length).toBeLessThan(20)
    expectNoOutputs()
  })

  it('aborts the HEADs still in flight at the 10th failure instead of waiting for them', async () => {
    const media: MediaVariant[] = []
    const two = await servePackage('two-paths', {
      mutate: (pkg) => {
        for (let i = 0; i < 14; i++)
          media.push(...addImage(pkg, 70 + i, [['w800', 'image/webp', 100]]))
      },
    })
    serveMedia(media)
    // Variants 0 and 1 never answer, so they are in flight when the 10th fast 404 (variants 2-11)
    // arrives; 12 and 13 never answer either. The per-attempt timeout is far above the test's
    // limit, so only the pool's stop signal can end the hanging HEADs in time.
    const hanging = [0, 1, 12, 13].map((i) => media[i]!.path)
    for (const v of media) route(v.path, hanging.includes(v.path) ? neverAnswer : status(404))
    await publish({ mode: 'staging', stories: [two.entry] })
    plantStaleOutputs()
    const started = performance.now()
    expect(await runStaging(storageEnv('catalogue/staging.json'), { timeoutMs: 20_000 })).toBe(1)
    expect(performance.now() - started).toBeLessThan(5_000)
    const failing = media.slice(2, 12).map((v) => v.path)
    expect(errors).toEqual([
      ...failing.map(
        (path) => `content: media failed story=two-paths path=${path} reason=status 404`,
      ),
      `content gate failed: media HEAD failed for 10 of 14 variants; first: ${failing[0]} status 404`,
    ])
    // Aborted attempts are never logged, listed or retried.
    expect(out.filter((line) => hanging.some((path) => line.includes(path)))).toEqual([])
    expect(out).toContainEqual(summaryLine(14, 0, 10))
    expect(requestList().filter(([method]) => method === 'GET')).toEqual(stagingGets(two))
    const headPaths = heads().map((r) => r.path)
    expect(new Set(headPaths).size).toBe(headPaths.length)
    expect(headPaths).toEqual(expect.arrayContaining([hanging[0], hanging[1], ...failing]))
    expect(headPaths.every((path) => media.some((v) => v.path === path))).toBe(true)
    expect(sleeps).toEqual([])
    expectNoOutputs()
  })

  it('passes a variant above 1 MiB: a HEAD answer is never read through readCapped', async () => {
    const bytes = 2 * 1024 * 1024
    expect(bytes).toBeGreaterThan(MAX_BODY_BYTES)
    const { path, two } = await oneVariant([], 'audio/mpeg', bytes)
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(errors).toEqual([])
    expect(out).toContain(`content: media story=two-paths variants=1 bytes=${bytes} ok`)
    expect(out).toContainEqual(summaryLine(1, 1))
    expect(out.filter((line) => line.startsWith('content: media head '))).toEqual([])
    expect(requestList()).toEqual([...stagingGets(two), ['HEAD', path]])
  })

  it('stops at the media deadline without retrying, naming how many were checked', async () => {
    const media: MediaVariant[] = []
    const two = await servePackage('two-paths', {
      mutate: (pkg) =>
        void media.push(
          ...addImage(pkg, 1, [
            ['a', 'image/webp', 10],
            ['b', 'image/webp', 11],
            ['c', 'image/webp', 12],
          ]),
        ),
    })
    serveMedia(media)
    route(media[1]!.path, neverAnswer)
    route(media[2]!.path, neverAnswer)
    await publish({ mode: 'staging', stories: [two.entry] })
    plantStaleOutputs()
    const started = performance.now()
    // The per-attempt timeout is far above the deadline, so only the deadline can end the run.
    expect(
      await runStaging(storageEnv('catalogue/staging.json'), {
        mediaDeadlineMs: 500,
        timeoutMs: 20_000,
      }),
    ).toBe(1)
    expect(performance.now() - started).toBeLessThan(5_000)
    expect(errors).toEqual(['content gate failed: media HEAD stopped after 0.5 s (1 of 3 checked)'])
    expect(
      heads()
        .map((r) => r.path)
        .sort(),
    ).toEqual(media.map((v) => v.path).sort())
    expect(sleeps).toEqual([])
    expectNoOutputs()
  })

  it('stops at the whole-load deadline during the HEADs with its own message', async () => {
    const { path, two } = await oneVariant([neverAnswer])
    plantStaleOutputs()
    expect(
      await runStaging(storageEnv('catalogue/staging.json'), {
        loadDeadlineMs: 2_000,
        mediaDeadlineMs: 20_000,
        timeoutMs: 20_000,
      }),
    ).toBe(1)
    expect(errors).toEqual(['content gate failed: content loading exceeded 2 s'])
    expect(requestList()).toEqual([
      ['GET', 'catalogue/staging.json'],
      ['GET', 'catalogue/snapshots/1.json'],
      ['GET', two.entry.packagePath],
      ['HEAD', path],
    ])
    expectNoOutputs()
  })
})

describe('runMediaGate with an injected fetch (design §3.4 row 37, §4.1)', () => {
  /** The gate over two-paths with `variants` declared images; HEADs go to `fetchImpl` only. */
  function gate(variants: number, fetchImpl: typeof fetch, loadDeadline = startDeadline(600_000)) {
    const pkg = fixturePackage('two-paths')
    const media: MediaVariant[] = []
    for (let i = 0; i < variants; i++) {
      media.push(...addImage(pkg, 60 + i, [['w800', 'image/webp', 100]]))
    }
    const lines: string[] = []
    const runGate = () =>
      runMediaGate({
        packages: [{ pkg: pkg as MediaPackage['pkg'] }],
        root: '',
        objectUrl: (path) => new URL(`${STUB_PREFIX}${path}`, 'http://127.0.0.1:9'),
        mediaDeadlineMs: 300_000,
        ctx: {
          fetchImpl,
          clock: () => performance.now(),
          sleep: async () => undefined,
          log: (line) => void lines.push(line),
          timeoutMs: 15_000,
          retryDelayMs: 1_000,
          fetches: [],
          loadDeadline,
        },
      })
    return { media, lines, runGate }
  }

  it('lists at most 10 failures, also when more answers are judged in the turn of the 10th', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch
    const { media, lines, runGate } = gate(30, fetchImpl)
    const result = await runGate()
    // Answers that resolve at once land in the same turn: more HEADs were judged than may be listed.
    expect(calls).toBeGreaterThan(10)
    if (result.ok) throw new Error('expected the gate to fail')
    expect(result.details).toHaveLength(10)
    const order = (result.details ?? []).map((line) => {
      const match = /^content: media failed story=two-paths path=(\S+) reason=status 404$/.exec(
        line,
      )
      expect(match).not.toBeNull()
      return media.findIndex((v) => v.path === match![1])
    })
    expect(new Set(order).size).toBe(10)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(result.reason).toBe(
      `media HEAD failed for 10 of 30 variants; first: ${media[order[0]!]!.path} status 404`,
    )
    expect(lines).toContainEqual(summaryLine(30, 0, 10))
  })

  it('fails when the whole-load deadline fired before the gate, even with no HEAD to make', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const live = gate(0, fetchImpl)
    expect(await live.runGate()).toEqual({ ok: true, value: null })
    expect(live.lines).toContain('content: media story=two-paths variants=0 bytes=0 ok')

    const deadline = startDeadline(1)
    await vi.waitFor(() => expect(deadline.signal.aborted).toBe(true))
    const expired = gate(0, fetchImpl, deadline)
    expect(await expired.runGate()).toEqual({
      ok: false,
      reason: 'content loading exceeded 0.001 s',
      details: [],
    })
    expect(expired.lines).toEqual([summaryLine(0, 0)])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('loadContent: retries and the load deadline', () => {
  it('retries a 500 and succeeds on the next 200, recording both GETs', async () => {
    const pub = await publish()
    route(pub.snapshotPath, status(500), json(pub.snapshotBytes))
    expect(await run(storageEnv())).toBe(0)
    expect(readBuildInfo().fetches.map((f) => [f.path, f.status])).toEqual([
      ['catalogue/production.json', 200],
      ['catalogue/snapshots/1.json', 500],
      ['catalogue/snapshots/1.json', 200],
    ])
    expect(sleeps).toEqual([1_000])
    expect(out[2]).toMatch(
      /^content: fetch path=catalogue\/snapshots\/1\.json status=500 cf=- age=- pop=- sha=[a-f0-9]{12} seq=-$/,
    )
  })

  it('retries a dropped connection and records it with status null', async () => {
    const pub = await publish()
    route(pub.pointerPath, drop, json(pub.pointerBytes))
    expect(await run(storageEnv())).toBe(0)
    const [first] = readBuildInfo().fetches
    expect(first).toMatchObject({ path: 'catalogue/production.json', status: null, sha256: null })
    expect(out[1]).toMatch(
      /^content: fetch path=catalogue\/production\.json status=error\(TypeError/,
    )
  })

  it('fails after 3 attempts when every answer is a 5xx', async () => {
    const pub = await publish()
    route(pub.snapshotPath, status(503))
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual([
      'content gate failed: snapshot GET failed after 3 attempts: status 503',
    ])
    expect(seen().filter((r) => r.path === pub.snapshotPath)).toHaveLength(3)
    expect(sleeps).toEqual([1_000, 2_000])
    expectNoOutputs()
  })

  it('fails after 3 attempts when every request times out', async () => {
    const pub = await publish()
    route(pub.pointerPath, neverAnswer)
    expect(await run(storageEnv(), { timeoutMs: 100 })).toBe(1)
    expect(errors).toEqual([
      'content gate failed: pointer GET failed after 3 attempts: TimeoutError',
    ])
    expect(seen()).toHaveLength(3)
  })

  it('times out a body that stalls after the headers: the per-attempt timer covers the body', async () => {
    const pub = await publish()
    route(pub.pointerPath, stallBody(pub.pointerBytes))
    expect(await run(storageEnv(), { timeoutMs: 100 })).toBe(1)
    expect(errors).toEqual([
      'content gate failed: pointer GET failed after 3 attempts: TimeoutError',
    ])
    expect(requestList()).toEqual(Array.from({ length: 3 }, () => ['GET', pub.pointerPath]))
    expect(sleeps).toEqual([1_000, 2_000])
  })

  it('retries a body cut short by a closed connection', async () => {
    const pub = await publish()
    route(pub.pointerPath, truncateBody(pub.pointerBytes), json(pub.pointerBytes))
    expect(await run(storageEnv())).toBe(0)
    expect(requestList()).toEqual([
      ['GET', pub.pointerPath],
      ['GET', pub.pointerPath],
      ['GET', pub.snapshotPath],
    ])
    expect(readBuildInfo().fetches[0]).toMatchObject({ status: null, sha256: null })
    expect(sleeps).toEqual([1_000])
  })

  it('does not retry a 404', async () => {
    route('catalogue/production.json', status(404))
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer GET returned status 404'])
    expect(seen()).toHaveLength(1)
  })

  it('does not follow a redirect', async () => {
    const pub = await publish()
    route(pub.pointerPath, redirect(302, `${STUB_PREFIX}${pub.snapshotPath}`))
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer GET returned status 302'])
    expect(seen()).toHaveLength(1)
  })

  it('fails at the whole-load deadline, never retried, with its own message', async () => {
    const pub = await publish()
    route(pub.pointerPath, neverAnswer)
    plantStaleOutputs()
    const started = performance.now()
    // The per-attempt timeout is far above the deadline, so only the deadline can end the run.
    expect(await run(storageEnv(), { loadDeadlineMs: 150, timeoutMs: 20_000 })).toBe(1)
    expect(performance.now() - started).toBeLessThan(5_000)
    expect(errors).toEqual(['content gate failed: content loading exceeded 0.15 s'])
    expect(requestList()).toEqual([['GET', 'catalogue/production.json']])
    expect(sleeps).toEqual([])
    expect(out).toEqual([
      STORAGE_ENV_LINE,
      'content: fetch path=catalogue/production.json status=error(TimeoutError) cf=- age=- pop=- sha=- seq=-',
    ])
    expectNoOutputs()
  })

  it('races a retry sleep against the load deadline', async () => {
    const pub = await publish()
    route(pub.pointerPath, status(503))
    const sleep = () => new Promise<void>(() => undefined) // never ends on its own
    expect(await run(storageEnv(), { loadDeadlineMs: 150, timeoutMs: 20_000, sleep })).toBe(1)
    expect(errors).toEqual(['content gate failed: content loading exceeded 0.15 s'])
    expect(requestList()).toEqual([['GET', 'catalogue/production.json']])
  })
})

describe('loadContent: response checks and gates', () => {
  it('fails on a snapshot hash mismatch and writes nothing', async () => {
    plantStaleOutputs()
    await publish({ pointerSha256: SHA })
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: snapshot sha256 mismatch'])
    expect(out).toHaveLength(3) // the environment line and both fetch lines, for the build log
    expectNoOutputs()
  })

  it('fails on a content-type other than application/json', async () => {
    const pub = await publish()
    route(pub.pointerPath, json(pub.pointerBytes, 'text/html'))
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual([
      'content gate failed: pointer content-type must be application/json, got text/html',
    ])
  })

  it('compares the content-type without parameters or case', async () => {
    const pub = await publish()
    route(pub.pointerPath, json(pub.pointerBytes, 'Application/JSON; charset=UTF-8'))
    expect(await run(storageEnv())).toBe(0)
    expect(errors).toEqual([])
  })

  it('fails on non-canonical pointer bytes', async () => {
    const pub = await publish()
    const pretty = JSON.stringify(JSON.parse(new TextDecoder().decode(pub.pointerBytes)), null, 2)
    route(pub.pointerPath, json(new TextEncoder().encode(pretty)))
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer is not canonical JCS'])
  })

  it('fails on an unsafe snapshot path without requesting it', async () => {
    const unsafe = jcsBytes({
      schemaVersion: '1.0',
      seq: 1,
      snapshotPath: 'catalogue/snapshots/../../masters/x.json',
      snapshotSha256: SHA,
      updatedAt: NOW.toISOString(),
    })
    route('catalogue/production.json', json(unsafe))
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer snapshotPath is unsafe'])
    expect(seen()).toHaveLength(1)
  })

  it('fails on a snapshot path other than catalogue/snapshots/<seq>.json without requesting it', async () => {
    const pointer = jcsBytes({
      schemaVersion: '1.0',
      seq: 2,
      snapshotPath: 'catalogue/snapshots/1.json',
      snapshotSha256: SHA,
      updatedAt: NOW.toISOString(),
    })
    route('catalogue/production.json', json(pointer))
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual([
      'content gate failed: pointer snapshotPath must be catalogue/snapshots/2.json',
    ])
    expect(requestList()).toEqual([['GET', 'catalogue/production.json']])
  })

  it('fails when a declared body is larger than 1 MiB', async () => {
    route('catalogue/production.json', json(new Uint8Array(MAX_BODY_BYTES + 1)))
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer is larger than 1048576 bytes'])
  })

  it('fails when a streamed body without content-length grows past 1 MiB', async () => {
    route('catalogue/production.json', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      for (let i = 0; i <= 16; i++) res.write(new Uint8Array(64 * 1024))
      res.end()
    })
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer is larger than 1048576 bytes'])
  })
})

describe('loadContent: the featured rule', () => {
  it('drops a featured story that is not in the snapshot', async () => {
    await publish({ featuredStoryId: 'blue-jackal' })
    expect(await run(storageEnv())).toBe(0)
    expect(requestList()).toEqual([
      ['GET', 'catalogue/production.json'],
      ['GET', 'catalogue/snapshots/1.json'],
    ])
    expect(readBuildInfo().featuredStoryId).toBeNull()
    expect(out).toContain(
      'content: featured story=blue-jackal dropped (reason=not-in-snapshot); featuredStoryId=null',
    )
  })

  it('drops a featured story that production excluded for a missing approval', async () => {
    const two = await servePackage('two-paths', { serve: false })
    await publish({ stories: [two.entry], featuredStoryId: 'two-paths' })
    expect(await run(storageEnv())).toBe(0)
    expect(requestList()).toEqual([
      ['GET', 'catalogue/production.json'],
      ['GET', 'catalogue/snapshots/1.json'],
    ])
    expect(readBuildInfo().featuredStoryId).toBeNull()
    expect(out).toContain(
      'content: featured story=two-paths dropped (reason=approval-missing); featuredStoryId=null',
    )
  })

  it('drops a built story without its pictures and narration, counting them', async () => {
    const two = await servePackage('two-paths')
    await publish({ mode: 'staging', stories: [two.entry], featuredStoryId: 'two-paths' })
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(requestList()).toEqual(stagingGets(two))
    expect(readBuildInfo().featuredStoryId).toBeNull()
    // two-paths: 5 nodes in 2 locales, no picture and no narration.
    expect(out).toContain(
      'content: featured story=two-paths dropped (reason=media-incomplete A001=0 A005=10 A006=5); featuredStoryId=null',
    )
  })

  it('keeps a built story whose every node is pictured and narrated', async () => {
    const media: MediaVariant[] = []
    const lantern = await servePackage('lantern-walk', {
      mutate: (pkg) => void media.push(...addFullMedia(pkg)),
    })
    serveMedia(media)
    await publish({ mode: 'staging', stories: [lantern.entry], featuredStoryId: 'lantern-walk' })
    expect(await runStaging(storageEnv('catalogue/staging.json'))).toBe(0)
    expect(errors).toEqual([])
    expect(media).toHaveLength(12) // 4 pictures, 8 narrations
    const list = requestList()
    expect(list.slice(0, 3)).toEqual(stagingGets(lantern))
    expect(list.slice(3).sort()).toEqual(media.map((v) => ['HEAD', v.path]).sort())
    expect(readBuildInfo().featuredStoryId).toBe('lantern-walk')
    expect(out.slice(-2)).toEqual([
      'content: featured story=lantern-walk',
      'content: mode=staging seq=1 snapshot=catalogue/snapshots/1.json stories=1 excluded=0 featured=lantern-walk',
    ])
  })
})

describe('loadContent: CONTENT_SOURCE unset or none', () => {
  it('fails in Vercel Production when CONTENT_SOURCE is unset, without any request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const env = { VERCEL_ENV: 'production', CONTENT_BASE_URL: baseUrl }
    expect(await run(env, { fetchImpl })).toBe(1)
    expect(errors).toEqual([
      'content gate failed: CONTENT_SOURCE is not set; it is required when VERCEL_ENV=production',
    ])
    expect(out).toEqual([
      'content: environment VERCEL=unset VERCEL_ENV=production CONTENT_SOURCE=unset GITHUB_ACTIONS=unset platform=linux',
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(seen()).toHaveLength(0)
  })

  it.each([
    ['CI or this PC (no VERCEL_ENV)', {}, 'unset', 'VERCEL_ENV=unset CONTENT_SOURCE=unset'],
    [
      'a Vercel Preview',
      { VERCEL_ENV: 'preview' },
      'preview',
      'VERCEL_ENV=preview CONTENT_SOURCE=unset',
    ],
    [
      'an empty CONTENT_SOURCE',
      { CONTENT_SOURCE: '' },
      'unset',
      'VERCEL_ENV=unset CONTENT_SOURCE=empty',
    ],
  ])(
    'skips without network on %s and removes stale outputs',
    async (_where, env, vercelEnv, names) => {
      plantStaleOutputs()
      const fetchImpl = vi.fn<typeof fetch>()
      expect(await run(env, { fetchImpl })).toBe(0)
      expect(out).toEqual([
        `content: environment VERCEL=unset ${names} GITHUB_ACTIONS=unset platform=linux`,
        `content: skipped (CONTENT_SOURCE is not set; VERCEL_ENV=${vercelEnv})`,
      ])
      expect(errors).toEqual([])
      expect(fetchImpl).not.toHaveBeenCalled()
      expectNoOutputs()
      expect(existsSync(join(root, 'public', 'keep.txt'))).toBe(true)
    },
  )

  it('skips on CONTENT_SOURCE=none, in Production too', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const env = { VERCEL: '1', CONTENT_SOURCE: 'none', VERCEL_ENV: 'production' }
    expect(await run(env, { fetchImpl })).toBe(0)
    expect(out).toEqual([
      'content: environment VERCEL=set VERCEL_ENV=production CONTENT_SOURCE=none GITHUB_ACTIONS=unset platform=linux',
      'content: skipped (CONTENT_SOURCE=none; VERCEL_ENV=production)',
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
    expectNoOutputs()
  })
})

describe('loadContent: Vercel Production needs a production pointer', () => {
  it('fails on a staging pointer without any request, so the approval gate is never skipped', async () => {
    plantStaleOutputs()
    await publish({ mode: 'staging' })
    const fetchImpl = vi.fn<typeof fetch>()
    const env = storageEnv('catalogue/staging.json', { VERCEL_ENV: 'production' })
    expect(await run(env, { fetchImpl })).toBe(1)
    expect(errors).toEqual([
      'content gate failed: CONTENT_POINTER must be a production pointer when VERCEL_ENV=production',
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(seen()).toHaveLength(0)
  })

  it('loads a production pointer in Production and a staging pointer in a Preview', async () => {
    await publish()
    expect(await run(storageEnv('catalogue/production.json', { VERCEL_ENV: 'production' }))).toBe(0)
    expect(readBuildInfo().mode).toBe('production')
    await publish({ mode: 'staging' })
    expect(await run(storageEnv('catalogue/staging.json', { VERCEL_ENV: 'preview' }))).toBe(0)
    expect(readBuildInfo().mode).toBe('staging')
  })
})

describe('loadContent: a staging pointer loads only in a Preview, GitHub Actions or on Windows (P1-2c)', () => {
  it.each<[string, Env, string, string]>([
    [
      'a Vercel Preview on Linux',
      { VERCEL: '1', VERCEL_ENV: 'preview' },
      'linux',
      'VERCEL=set VERCEL_ENV=preview CONTENT_SOURCE=storage GITHUB_ACTIONS=unset platform=linux',
    ],
    [
      'GitHub Actions on Linux',
      { GITHUB_ACTIONS: 'true' },
      'linux',
      'VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=storage GITHUB_ACTIONS=true platform=linux',
    ],
    [
      'this PC (win32)',
      {},
      'win32',
      'VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=storage GITHUB_ACTIONS=unset platform=win32',
    ],
  ])('loads it in %s', async (_where, extra, platform, names) => {
    const pub = await publish({ mode: 'staging' })
    expect(await run(storageEnv('catalogue/staging.json', extra), { platform })).toBe(0)
    expect(errors).toEqual([])
    expect(requestList()).toEqual(stagingGets())
    expect(readBuildInfo().mode).toBe('staging')
    expect(out[0]).toBe(`content: environment ${names}`)
    expect(out.at(-1)).toBe(
      `content: mode=staging seq=1 snapshot=${pub.snapshotPath} stories=0 excluded=0 featured=none`,
    )
  })

  it.each<[string, Env, string]>([
    ['Linux with no Vercel variables and no GitHub Actions (the Step 8 blind spot)', {}, 'linux'],
    ['darwin with no Vercel variables and no GitHub Actions', {}, 'darwin'],
    ['VERCEL set and VERCEL_ENV unset', { VERCEL: '1' }, 'linux'],
    ['VERCEL set and VERCEL_ENV unset, on win32', { VERCEL: '1' }, 'win32'],
    ['VERCEL_ENV=development', { VERCEL_ENV: 'development' }, 'win32'],
    ['an empty VERCEL_ENV', { VERCEL_ENV: '' }, 'win32'],
  ])('refuses it on %s: no request, and no output touched', async (_where, extra, platform) => {
    plantStaleOutputs()
    await publish({ mode: 'staging' })
    const fetchImpl = vi.fn<typeof fetch>()
    const env = storageEnv('catalogue/staging.json', extra)
    expect(await run(env, { platform, fetchImpl })).toBe(1)
    expect(errors).toEqual([`content gate failed: ${STAGING_REFUSED_HERE}`])
    expect(out).toEqual([environmentLine(env, platform)])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(seen()).toHaveLength(0)
    // The refusal comes before stale outputs are removed: everything is as it was.
    expect(readFileSync(paths().contentInfo, 'utf8')).toBe('stale')
    expect(readFileSync(paths().publicInfo, 'utf8')).toBe('stale')
    expect(readFileSync(join(root, 'public', 'keep.txt'), 'utf8')).toBe('not ours')
  })

  it('prints the blind-spot environment line before the refusal', async () => {
    await publish({ mode: 'staging' })
    expect(await run(storageEnv('catalogue/staging.json'))).toBe(1)
    expect(out).toEqual([STORAGE_ENV_LINE])
    expect(errors).toEqual([`content gate failed: ${STAGING_REFUSED_HERE}`])
  })
})

describe('stagingPointerAllowed (P1-2c, design p1-step9-design.md §3.3 A)', () => {
  it.each<[Env, string, boolean]>([
    [{}, 'win32', true],
    [{}, 'linux', false],
    [{}, 'darwin', false],
    [{}, 'other', false],
    [{ GITHUB_ACTIONS: 'true' }, 'linux', true],
    [{ GITHUB_ACTIONS: 'true' }, 'darwin', true],
    [{ GITHUB_ACTIONS: 'true' }, 'win32', true],
    [{ GITHUB_ACTIONS: '1' }, 'linux', false],
    [{ GITHUB_ACTIONS: 'TRUE' }, 'linux', false],
    [{ GITHUB_ACTIONS: '' }, 'linux', false],
    [{ VERCEL_ENV: 'preview' }, 'linux', true],
    [{ VERCEL: '1', VERCEL_ENV: 'preview' }, 'linux', true],
    [{ VERCEL: '', VERCEL_ENV: 'preview' }, 'darwin', true],
    [{ VERCEL_ENV: 'Preview' }, 'linux', false],
    [{ VERCEL_ENV: 'production' }, 'win32', false],
    [{ VERCEL_ENV: 'production' }, 'linux', false],
    [{ VERCEL_ENV: 'production', GITHUB_ACTIONS: 'true' }, 'linux', false],
    [{ VERCEL: '1', VERCEL_ENV: 'production' }, 'linux', false],
    [{ VERCEL_ENV: 'development' }, 'win32', false],
    [{ VERCEL_ENV: '' }, 'win32', false],
    [{ VERCEL_ENV: '' }, 'linux', false],
    [{ VERCEL: '1' }, 'win32', false],
    [{ VERCEL: '1' }, 'linux', false],
    [{ VERCEL: '' }, 'win32', false],
    [{ VERCEL: '1', GITHUB_ACTIONS: 'true' }, 'linux', false],
    [{ VERCEL_ENV: undefined, VERCEL: undefined }, 'win32', true],
  ])('%j on %s is %s', (env, platform, allowed) => {
    expect(stagingPointerAllowed(env, platform)).toBe(allowed)
  })

  it('reads no other variable', () => {
    const unrelated: Env = {
      CONTENT_SOURCE: 'storage',
      CONTENT_POINTER: 'catalogue/staging.json',
      NODE_ENV: 'production',
      CI: 'true',
    }
    expect(stagingPointerAllowed(unrelated, 'linux')).toBe(false)
    expect(stagingPointerAllowed(unrelated, 'win32')).toBe(true)
  })
})

describe('loadContent: a Storage pointer can never select fixtures mode', () => {
  it.each([{}, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production' }])(
    'refuses CONTENT_POINTER=catalogue/fixtures.json without any request (%j)',
    async (extra) => {
      // Even if such an object were uploaded, it must not skip the approval gate.
      const pub = await publish({ mode: 'staging' })
      stub.put('catalogue/fixtures.json', pub.pointerBytes, 'application/json')
      expect(await run(storageEnv('catalogue/fixtures.json', extra))).toBe(1)
      expect(errors).toEqual([
        'content gate failed: pointer path must be <root>catalogue/production.json or <root>catalogue/staging.json',
      ])
      expect(seen()).toHaveLength(0)
      expectNoOutputs()
    },
  )
})

describe('loadContent: the committed base URL rule', () => {
  it('refuses any other https base before the first request, naming only the committed constant', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const env = storageEnv('catalogue/production.json', {
      CONTENT_BASE_URL: 'https://other-ref.supabase.co/storage/v1/object/public/content',
    })
    expect(await run(env, { fetchImpl })).toBe(1)
    expect(errors).toEqual([`content gate failed: ${BASE_URL_REFUSED}`])
    expect(errors[0]).not.toContain('other-ref')
    expect(fetchImpl).not.toHaveBeenCalled()
    expectNoOutputs()
  })

  it('loads from a loopback server (the stub)', async () => {
    await publish()
    expect(await run(storageEnv())).toBe(0)
  })
})

// ---- fixtures mode ----

const fixturesEnv: Env = { CONTENT_SOURCE: 'fixtures' }
/** Fixtures runs say platform win32 (this PC), so they pass on Linux CI too (design §10.1). */
const runFixtures = (env: Env = fixturesEnv, extra: Partial<LoaderOptions> = {}) =>
  run(env, { platform: 'win32', ...extra })

const fixtures = () => join(root, 'fixtures')
const fixturePath = (path: string) => join(fixtures(), ...path.split('/'))
const fixtureBytes = (path: string) => new Uint8Array(readFileSync(fixturePath(path)))
const contentBytes = (path: string) =>
  new Uint8Array(readFileSync(join(root, '.content', ...path.split('/'))))
const sha12Of = async (path: string) => (await sha256Hex(fixtureBytes(path))).slice(0, 12)

/** A copy of the committed fixtures in this test's root, so a test can change it safely. */
function copyFixtures(): void {
  cpSync(join(storyboardDir, 'fixtures'), fixtures(), { recursive: true })
}

/** Rebuilds the copied catalogue from edited entries, with fresh hashes for pointer and snapshot. */
async function rewriteCatalogue(
  edit: (stories: SnapshotEntry[]) => SnapshotEntry[],
  featuredStoryId: string | null = null,
): Promise<void> {
  const stories = edit(await readFixtureEntries(fixtures()))
  writeCatalogue(fixtures(), await buildCatalogue(stories, featuredStoryId))
}

/** Changes one copied package, then rebuilds the catalogue so its sha256 still matches. */
async function changePackage(storyId: string, mutate: (pkg: Json) => void): Promise<void> {
  const entries = await readFixtureEntries(fixtures()) // before the change, which may not parse
  const path = `packages/${storyId}.json`
  const pkg = JSON.parse(readFileSync(fixturePath(path), 'utf8')) as Json
  mutate(pkg)
  writeFileSync(fixturePath(path), `${JSON.stringify(pkg, null, 2)}\n`)
  const packageSha256 = await sha256Hex(fixtureBytes(path))
  const stories = entries.map((e) => (e.storyId === storyId ? { ...e, packageSha256 } : e))
  writeCatalogue(fixtures(), await buildCatalogue(stories))
}

/** Points the two-paths entry at another path, keeping everything else. */
const moveTwoPaths = (packagePath: string) =>
  rewriteCatalogue((stories) =>
    stories.map((s) => (s.storyId === 'two-paths' ? { ...s, packagePath } : s)),
  )

describe('loadContent: fixtures mode, committed fixtures', () => {
  it('loads the 3 fixtures without network and writes every output', async () => {
    copyFixtures()
    plantStaleOutputs()
    const fetchImpl = vi.fn<typeof fetch>()
    expect(await runFixtures(fixturesEnv, { fetchImpl })).toBe(0)
    expect(errors).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(seen()).toHaveLength(0)

    const entries = await readFixtureEntries(fixtures())
    const snapshotBytes = fixtureBytes('catalogue/snapshots/1.json')
    const info = readBuildInfo() // strict parse
    expect(info).toEqual({
      schemaVersion: '1.0',
      mode: 'fixtures',
      seq: 1,
      pointerPath: 'catalogue/fixtures.json',
      snapshotPath: 'catalogue/snapshots/1.json',
      snapshotSha256: await sha256Hex(snapshotBytes),
      featuredStoryId: null,
      stories: entries.map(({ storyId, version, packageSha256 }) => ({
        storyId,
        version,
        packageSha256,
      })),
      excluded: [],
      appVersion: null,
      deploymentId: null,
      deploymentUrl: null,
      builtAt: NOW.toISOString(),
      fetches: [],
    })
    expect(info.stories.map((s) => s.storyId)).toEqual(FIXTURE_IDS)
    expect(readFileSync(paths().contentInfo, 'utf8')).toBe(toJcs(info))
    expect(readFileSync(paths().publicInfo, 'utf8')).toBe(toJcs(info))
    expect(contentBytes('pointer.json')).toEqual(fixtureBytes('catalogue/fixtures.json'))
    expect(contentBytes('snapshot.json')).toEqual(snapshotBytes)
    expect(readdirSync(join(root, '.content', 'packages')).sort()).toEqual(
      FIXTURE_IDS.map((id) => `${id}.json`),
    )
    for (const id of FIXTURE_IDS) {
      // Each package's exact bytes, so its sha256 still matches build-info.
      expect(contentBytes(`packages/${id}.json`)).toEqual(fixtureBytes(`packages/${id}.json`))
    }
    expect(existsSync(join(root, '.content', '.tmp'))).toBe(false)
    expect(readFileSync(join(root, 'public', 'keep.txt'), 'utf8')).toBe('not ours')
  })

  it('logs the environment line, each file read, each package, the skipped checks, featured and a final line', async () => {
    copyFixtures()
    expect(await runFixtures()).toBe(0)
    const expected: unknown[] = [
      FIXTURES_ENV_LINE,
      `content: read path=catalogue/fixtures.json sha=${await sha12Of('catalogue/fixtures.json')} seq=1`,
      `content: read path=catalogue/snapshots/1.json sha=${await sha12Of('catalogue/snapshots/1.json')} seq=1`,
    ]
    for (const id of FIXTURE_IDS) {
      const sha = await sha12Of(`packages/${id}.json`)
      expected.push(
        `content: read path=packages/${id}.json sha=${sha} seq=-`,
        expect.stringMatching(
          new RegExp(
            `^content: package story=${id} version=1 sha=${sha} errors=0 waived=0 warnings=\\d+ info=\\d+$`,
          ),
        ),
        skippedLine(id),
      )
    }
    expected.push(
      'content: featured none',
      'content: mode=fixtures seq=1 snapshot=catalogue/snapshots/1.json stories=3 excluded=0 featured=none',
    )
    expect(out).toEqual(expected)
  })

  it('still reads only local files when Storage settings are also present', async () => {
    copyFixtures()
    await publish()
    const env = {
      ...fixturesEnv,
      CONTENT_BASE_URL: baseUrl,
      CONTENT_POINTER: 'catalogue/production.json',
    }
    expect(await runFixtures(env)).toBe(0)
    expect(seen()).toHaveLength(0)
    expect(readBuildInfo().mode).toBe('fixtures')
  })

  it('runs in GitHub Actions on Linux', async () => {
    copyFixtures()
    expect(await run({ ...fixturesEnv, GITHUB_ACTIONS: 'true' }, { platform: 'linux' })).toBe(0)
    expect(out[0]).toBe(
      'content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=fixtures GITHUB_ACTIONS=true platform=linux',
    )
    expect(readBuildInfo().mode).toBe('fixtures')
  })

  it('drops the featured story the snapshot names: fixtures have no pictures or narration', async () => {
    copyFixtures()
    await rewriteCatalogue((stories) => stories, 'river-stones')
    expect(await runFixtures()).toBe(0)
    expect(readBuildInfo().featuredStoryId).toBeNull()
    // river-stones: 8 nodes in 2 locales.
    expect(out).toContain(
      'content: featured story=river-stones dropped (reason=media-incomplete A001=0 A005=16 A006=8); featuredStoryId=null',
    )
  })

  it('follows snapshot order, not file-name order, in build-info and the log', async () => {
    copyFixtures()
    await rewriteCatalogue((stories) => [...stories].reverse())
    expect(await runFixtures()).toBe(0)
    const reversed = ['two-paths', 'river-stones', 'lantern-walk']
    expect(readBuildInfo().stories.map((s) => s.storyId)).toEqual(reversed)
    const packageLines = out.filter((line) => line.startsWith('content: package story='))
    expect(packageLines.map((line) => /story=([a-z0-9-]+)/.exec(line)?.[1])).toEqual(reversed)
  })

  it('removes every output when a write fails part-way', async () => {
    copyFixtures()
    let planted = false
    // now() runs after stale outputs are removed and before writing starts. A non-empty folder
    // planted here blocks the third package, after pointer, snapshot and two packages are written.
    const now = () => {
      if (!planted) {
        planted = true
        const blocker = join(root, '.content', 'packages', 'two-paths.json')
        mkdirSync(blocker, { recursive: true })
        writeFileSync(join(blocker, 'keep.txt'), 'blocks the rename')
      }
      return NOW
    }
    expect(await runFixtures(fixturesEnv, { now })).toBe(1)
    expect(planted).toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^content gate failed: writing outputs failed: /)
    expectNoOutputs()
  })
})

describe('loadPackages (the shared package step)', () => {
  const entries = () => readFixtureEntries(join(storyboardDir, 'fixtures'))
  const readEntry: Parameters<typeof loadPackages>[2] = async (entry) => ({
    ok: true,
    value: new Uint8Array(readFileSync(join(storyboardDir, 'fixtures', entry.packagePath))),
  })

  it('refuses a duplicate storyId among entries that are not built, before reading any package', async () => {
    const [a, b, c] = await entries()
    const readBytes = vi.fn(readEntry)
    const result = await loadPackages([a!, b!, c!, { ...a! }], [b!, c!], readBytes, () => {}, {
      requireJcs: false,
    })
    expect(result).toEqual({
      ok: false,
      reason: 'snapshot lists story lantern-walk more than once',
    })
    expect(readBytes).not.toHaveBeenCalled()
  })

  it('reads and checks only the included entries, in the order given', async () => {
    const [a, b, c] = await entries()
    const readBytes = vi.fn(readEntry)
    const result = await loadPackages([a!, b!, c!], [a!, c!], readBytes, () => {}, {
      requireJcs: false,
    })
    expect(result.ok && result.value.map((p) => p.entry.storyId)).toEqual([
      'lantern-walk',
      'two-paths',
    ])
    expect(readBytes.mock.calls.map(([entry]) => entry.storyId)).toEqual([
      'lantern-walk',
      'two-paths',
    ])
  })

  it('requires canonical JCS only when asked (Storage)', async () => {
    const [a] = await entries()
    expect((await loadPackages([a!], [a!], readEntry, () => {}, { requireJcs: true })).ok).toBe(
      false,
    )
    expect((await loadPackages([a!], [a!], readEntry, () => {}, { requireJcs: false })).ok).toBe(
      true,
    )
  })
})

describe('loadContent: fixtures mode is refused on Vercel', () => {
  it.each([
    ['production', 'production'],
    ['preview', 'preview'],
    ['development', 'development'],
    ['', 'empty'],
    ['staging', 'other'],
    ['other', 'other'],
  ])(
    'refuses VERCEL_ENV=%j without reading, fetching or writing anything',
    async (vercelEnv, name) => {
      copyFixtures()
      const fetchImpl = vi.fn<typeof fetch>()
      expect(await runFixtures({ ...fixturesEnv, VERCEL_ENV: vercelEnv }, { fetchImpl })).toBe(1)
      expect(errors).toEqual([
        'content gate failed: CONTENT_SOURCE=fixtures is refused when VERCEL or VERCEL_ENV is set (CI and local only)',
      ])
      expect(out).toEqual([
        `content: environment VERCEL=unset VERCEL_ENV=${name} CONTENT_SOURCE=fixtures GITHUB_ACTIONS=unset platform=win32`,
      ])
      expect(fetchImpl).not.toHaveBeenCalled()
      expectNoOutputs()
    },
  )

  it.each([
    ['1', 'set'],
    ['', 'empty'],
    ['other', 'set'],
  ])(
    'refuses VERCEL=%j with no VERCEL_ENV, without reading, fetching or writing anything',
    async (vercel, name) => {
      copyFixtures()
      const fetchImpl = vi.fn<typeof fetch>()
      expect(await runFixtures({ ...fixturesEnv, VERCEL: vercel }, { fetchImpl })).toBe(1)
      expect(errors).toEqual([
        'content gate failed: CONTENT_SOURCE=fixtures is refused when VERCEL or VERCEL_ENV is set (CI and local only)',
      ])
      expect(out).toEqual([
        `content: environment VERCEL=${name} VERCEL_ENV=unset CONTENT_SOURCE=fixtures GITHUB_ACTIONS=unset platform=win32`,
      ])
      expect(fetchImpl).not.toHaveBeenCalled()
      expectNoOutputs()
    },
  )

  it.each(['linux', 'darwin', 'freebsd'])(
    'refuses fixtures on %s outside GitHub Actions (R4) without touching anything',
    async (platform) => {
      copyFixtures()
      plantStaleOutputs()
      expect(await run(fixturesEnv, { platform })).toBe(1)
      expect(errors).toEqual([`content gate failed: ${FIXTURES_REFUSED_HERE}`])
      expect(out).toEqual([
        `content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=fixtures GITHUB_ACTIONS=unset platform=${platform === 'freebsd' ? 'other' : platform}`,
      ])
      // A refused configuration touches no output (the stale ones stay as they were).
      expect(readFileSync(paths().publicInfo, 'utf8')).toBe('stale')
    },
  )
})

describe('loadContent: fixtures mode gates fail closed', () => {
  /** Runs the loader over stale outputs and expects one named failure and no outputs at all. */
  async function expectGateFailure(reason: string | RegExp, details: string[] = []): Promise<void> {
    plantStaleOutputs()
    expect(await runFixtures()).toBe(1)
    expect(errors.slice(0, -1)).toEqual(details)
    const last = errors.at(-1) ?? ''
    if (typeof reason === 'string') expect(last).toBe(`content gate failed: ${reason}`)
    else expect(last).toMatch(reason)
    expectNoOutputs()
  }

  it('fails on tampered package bytes and names the story', async () => {
    copyFixtures()
    const path = fixturePath('packages/two-paths.json')
    writeFileSync(path, readFileSync(path, 'utf8').replace('A young fox', 'A young cat'))
    await expectGateFailure('package two-paths sha256 mismatch')
  })

  it('fails on a tampered snapshot', async () => {
    copyFixtures()
    const path = fixturePath('catalogue/snapshots/1.json')
    writeFileSync(path, readFileSync(path, 'utf8').replace('"version":1', '"version":2'))
    await expectGateFailure('snapshot sha256 mismatch')
  })

  it('fails on a pointer that is not canonical JCS', async () => {
    copyFixtures()
    const path = fixturePath('catalogue/fixtures.json')
    writeFileSync(path, JSON.stringify(JSON.parse(readFileSync(path, 'utf8')), null, 2))
    await expectGateFailure('pointer is not canonical JCS')
  })

  it('fails on a package that fails the strict parse', async () => {
    copyFixtures()
    await changePackage('two-paths', (pkg) => {
      pkg.extra = 1
    })
    await expectGateFailure(/^content gate failed: package two-paths failed strict parse: /)
  })

  it('fails on an unwaived validator error and names it, with its detail line first', async () => {
    copyFixtures()
    await changePackage('two-paths', (pkg) => {
      pkg.text.en.nodes.start.question = 'Which way? Left or right?'
    })
    await expectGateFailure(
      'package two-paths failed the validator with 1 unwaived error(s); first: E005 node=start locale=en: 2 question marks (exactly 1 expected)',
      [
        'content: unwaived story=two-paths check=E005 node=start locale=en: 2 question marks (exactly 1 expected)',
      ],
    )
  })

  it('fails when the snapshot version differs from the package', async () => {
    copyFixtures()
    await rewriteCatalogue((stories) =>
      stories.map((s) => (s.storyId === 'two-paths' ? { ...s, version: 2 } : s)),
    )
    await expectGateFailure('package two-paths has version 1, but the snapshot names 2')
  })

  it('fails when the snapshot storyId differs from the package', async () => {
    copyFixtures()
    // The file is named after the entry, so the packagePath rule passes and the id check runs.
    const entries = await readFixtureEntries(fixtures())
    cpSync(fixturePath('packages/two-paths.json'), fixturePath('packages/other-story.json'))
    const stories = entries.map((s) =>
      s.storyId === 'two-paths'
        ? { ...s, storyId: 'other-story', packagePath: 'packages/other-story.json' }
        : s,
    )
    writeCatalogue(fixtures(), await buildCatalogue(stories))
    await expectGateFailure(
      'package other-story has storyId two-paths, but the snapshot names other-story',
    )
  })

  it('fails when a storyId appears twice in the snapshot', async () => {
    copyFixtures()
    await rewriteCatalogue((stories) => [...stories, stories[2]!])
    await expectGateFailure('snapshot lists story two-paths more than once')
  })

  it.each([
    '../two-paths.json',
    'packages/../../two-paths.json',
    '/packages/two-paths.json',
    'C:/packages/two-paths.json',
    'packages\\two-paths.json',
    '%2e%2e/two-paths.json',
    'packages/./two-paths.json',
    'packages/missing.json',
    'packages',
  ])(
    'refuses the package path %j by the packagePath rule, before any read',
    async (packagePath) => {
      copyFixtures()
      await moveTwoPaths(packagePath)
      await expectGateFailure(
        'snapshot entry two-paths: packagePath must be packages/two-paths.json',
      )
      expect(out.some((line) => line.startsWith('content: read path=packages/'))).toBe(false)
    },
  )

  it('refuses a package that leaves fixtures/ through a link (the file source, a second lock)', async () => {
    copyFixtures()
    const outside = mkdtempSync(join(tmpdir(), 'load-content-outside-'))
    const packages = fixturePath('packages')
    cpSync(packages, outside, { recursive: true })
    rmSync(packages, { recursive: true, force: true })
    symlinkSync(outside, packages, 'junction')
    try {
      await expectGateFailure('package lantern-walk path leaves the fixtures folder')
    } finally {
      unlinkSync(packages) // only the link; then the outside folder itself
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('fails when a package file is missing', async () => {
    copyFixtures()
    rmSync(fixturePath('packages/two-paths.json'))
    await expectGateFailure('package two-paths file not found: packages/two-paths.json')
  })

  it('fails when a package path names a folder', async () => {
    copyFixtures()
    rmSync(fixturePath('packages/two-paths.json'))
    mkdirSync(fixturePath('packages/two-paths.json'))
    await expectGateFailure('package two-paths is not a file: packages/two-paths.json')
  })

  it('fails on a package file larger than 1 MiB', async () => {
    copyFixtures()
    const path = fixturePath('packages/two-paths.json')
    writeFileSync(path, `${readFileSync(path, 'utf8')}${' '.repeat(MAX_BODY_BYTES)}`)
    await rewriteCatalogue((stories) => stories) // a fresh sha256 for the padded bytes
    await expectGateFailure(`package two-paths is larger than ${MAX_BODY_BYTES} bytes`)
  })

  it.each([
    [
      // The picture names a matching image asset, or A001 would fail first (design §10.1).
      'a node picture',
      (pkg: Json) => {
        pkg.nodes[0].image = SHA
        pkg.assets.push({
          kind: 'image',
          id: SHA,
          width: 800,
          height: 600,
          variants: [{ path: `media/two-paths/${SHA}-w800.webp`, mime: 'image/webp', bytes: 1000 }],
          provenance: { origin: 'human' },
        })
      },
    ],
    [
      'an asset',
      (pkg: Json) => {
        pkg.assets.push({
          kind: 'image',
          id: SHA,
          width: 800,
          height: 600,
          variants: [{ path: `media/${SHA}.webp`, mime: 'image/webp', bytes: 1000, width: 800 }],
          provenance: { origin: 'human' },
        })
      },
    ],
  ])(
    'refuses a package that declares media (%s): fixtures mode has no media HEAD gate',
    async (_what, mutate) => {
      copyFixtures()
      await changePackage('two-paths', mutate)
      await expectGateFailure(
        'package two-paths declares media; fixtures mode cannot run the media HEAD gate',
      )
    },
  )

  it('fails when the fixtures folder is missing', async () => {
    await expectGateFailure('fixtures folder not found')
  })
})

describe('createFileSource (the file source)', () => {
  const read = (path: string) => createFileSource(fixtures(), 'fixtures')(path, 'package x')

  it('reads a file by a safe path inside the folder', () => {
    copyFixtures()
    expect(read('packages/two-paths.json')).toEqual({
      ok: true,
      value: fixtureBytes('packages/two-paths.json'),
    })
  })

  it.each(['../x.json', 'packages/../../x.json', '/x.json', 'a\\b.json', '%2e%2e/x.json', ''])(
    'refuses the unsafe path %j',
    (path) => {
      copyFixtures()
      expect(read(path)).toEqual({ ok: false, reason: 'package x path is unsafe' })
    },
  )

  it('refuses a path that leaves the folder through a link', () => {
    copyFixtures()
    const outside = mkdtempSync(join(tmpdir(), 'load-content-outside-'))
    writeFileSync(join(outside, 'x.json'), '{}')
    const link = fixturePath('packages/linked')
    symlinkSync(outside, link, 'junction')
    try {
      expect(read('packages/linked/x.json')).toEqual({
        ok: false,
        reason: 'package x path leaves the fixtures folder',
      })
    } finally {
      unlinkSync(link)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('names a missing file, a folder, an oversized file and a missing folder', () => {
    expect(read('packages/x.json')).toEqual({ ok: false, reason: 'fixtures folder not found' })
    copyFixtures()
    expect(read('packages/missing.json')).toEqual({
      ok: false,
      reason: 'package x file not found: packages/missing.json',
    })
    expect(read('packages')).toEqual({ ok: false, reason: 'package x is not a file: packages' })
    writeFileSync(fixturePath('big.json'), ' '.repeat(MAX_BODY_BYTES + 1))
    expect(read('big.json')).toEqual({
      ok: false,
      reason: `package x is larger than ${MAX_BODY_BYTES} bytes`,
    })
  })
})

describe('resolveConfig', () => {
  const COMMITTED = CONTENT_PUBLIC_BASE

  it.each([
    [{ CONTENT_SOURCE: 'remote' }, 'CONTENT_SOURCE must be "storage", "fixtures" or "none"'],
    [
      {
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: COMMITTED,
        CONTENT_POINTER: 'catalogue/fixtures.json',
      },
      'pointer path must be <root>catalogue/production.json or <root>catalogue/staging.json',
    ],
    [{ CONTENT_SOURCE: 'storage' }, 'CONTENT_BASE_URL is not set'],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'not a url' },
      'CONTENT_BASE_URL is not a valid URL',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'http://example.supabase.co/x' },
      'CONTENT_BASE_URL must use https',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'ftp://127.0.0.1/x' },
      'CONTENT_BASE_URL must use https',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'https://example.supabase.co/x?token=1' },
      'CONTENT_BASE_URL must not carry a query',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'https://u:p@example.supabase.co/x' },
      'CONTENT_BASE_URL must not carry credentials',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'https://example.supabase.co/x#frag' },
      'CONTENT_BASE_URL must not carry a fragment',
    ],
    [{ CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: COMMITTED }, 'CONTENT_POINTER is not set'],
    [
      {
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: COMMITTED,
        CONTENT_POINTER: 'x/catalogue/production.json',
      },
      'pointer path must be <root>catalogue/production.json or <root>catalogue/staging.json',
    ],
    [
      {
        VERCEL_ENV: 'production',
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: COMMITTED,
        CONTENT_POINTER: 'catalogue/staging.json',
      },
      'CONTENT_POINTER must be a production pointer when VERCEL_ENV=production',
    ],
  ])('refuses %j', (env, reason) => {
    expect(resolveConfig(env)).toEqual({ ok: false, reason })
  })

  describe('the R4 allowlist for fixtures (VERCEL and VERCEL_ENV refused first)', () => {
    const VERCEL_REFUSED =
      'CONTENT_SOURCE=fixtures is refused when VERCEL or VERCEL_ENV is set (CI and local only)'
    const FIXTURES = { ok: true, value: { kind: 'fixtures' } }
    it.each<[Env, string, unknown]>([
      [{}, 'win32', FIXTURES],
      [{}, 'linux', { ok: false, reason: FIXTURES_REFUSED_HERE }],
      [{}, 'darwin', { ok: false, reason: FIXTURES_REFUSED_HERE }],
      [{ GITHUB_ACTIONS: 'true' }, 'linux', FIXTURES],
      [{ GITHUB_ACTIONS: 'true' }, 'darwin', FIXTURES],
      [{ GITHUB_ACTIONS: '1' }, 'linux', { ok: false, reason: FIXTURES_REFUSED_HERE }],
      [{ GITHUB_ACTIONS: 'TRUE' }, 'linux', { ok: false, reason: FIXTURES_REFUSED_HERE }],
      [{ GITHUB_ACTIONS: '' }, 'linux', { ok: false, reason: FIXTURES_REFUSED_HERE }],
      [{ VERCEL: '1' }, 'win32', { ok: false, reason: VERCEL_REFUSED }],
      [{ VERCEL: '' }, 'win32', { ok: false, reason: VERCEL_REFUSED }],
      [{ VERCEL: '1' }, 'linux', { ok: false, reason: VERCEL_REFUSED }],
      [{ VERCEL_ENV: 'production' }, 'win32', { ok: false, reason: VERCEL_REFUSED }],
      [{ VERCEL_ENV: '' }, 'win32', { ok: false, reason: VERCEL_REFUSED }],
      [{ VERCEL: '1', GITHUB_ACTIONS: 'true' }, 'linux', { ok: false, reason: VERCEL_REFUSED }],
      [
        { VERCEL_ENV: 'preview', GITHUB_ACTIONS: 'true' },
        'linux',
        { ok: false, reason: VERCEL_REFUSED },
      ],
    ])('%j on %s', (extra, platform, expected) => {
      expect(
        resolveConfig({ CONTENT_SOURCE: 'fixtures', ...extra }, POINTER_ROOTS, platform),
      ).toEqual(expected)
    })

    it.each(['production', 'preview', 'development', '', 'staging', 'other'])(
      'keeps the VERCEL_ENV=%j message on every platform',
      (VERCEL_ENV) => {
        for (const platform of ['win32', 'linux']) {
          expect(
            resolveConfig({ CONTENT_SOURCE: 'fixtures', VERCEL_ENV }, POINTER_ROOTS, platform),
          ).toEqual({ ok: false, reason: VERCEL_REFUSED })
        }
      },
    )
  })

  it('accepts CONTENT_SOURCE=fixtures outside Vercel and ignores any Storage settings', () => {
    const fixtures = { ok: true, value: { kind: 'fixtures' } }
    expect(resolveConfig({ CONTENT_SOURCE: 'fixtures' }, POINTER_ROOTS, 'win32')).toEqual(fixtures)
    expect(
      resolveConfig(
        {
          CONTENT_SOURCE: 'fixtures',
          CONTENT_BASE_URL: 'https://example.supabase.co/x',
          CONTENT_POINTER: 'catalogue/production.json',
        },
        POINTER_ROOTS,
        'win32',
      ),
    ).toEqual(fixtures)
  })

  it('takes the gate mode from the pointer outside Vercel Production', () => {
    // win32 (this PC): with no VERCEL_ENV a staging pointer loads only here or in CI (P1-2c).
    for (const [vercelEnv, pointer, mode] of [
      ['production', 'catalogue/production.json', 'production'],
      ['preview', 'catalogue/staging.json', 'staging'],
      ['preview', 'catalogue/production.json', 'production'],
      [undefined, 'catalogue/staging.json', 'staging'],
    ] as const) {
      const r = resolveConfig(
        {
          VERCEL_ENV: vercelEnv,
          CONTENT_SOURCE: 'storage',
          CONTENT_BASE_URL: COMMITTED,
          CONTENT_POINTER: pointer,
        },
        POINTER_ROOTS,
        'win32',
      )
      expect(r.ok && r.value.kind === 'storage' && r.value.location.mode).toBe(mode)
    }
  })

  describe('the staging-pointer allowlist (P1-2c, design p1-step9-design.md §3.3 A)', () => {
    const storageWith = (pointer: string, extra: Env = {}): Env => ({
      CONTENT_SOURCE: 'storage',
      CONTENT_BASE_URL: COMMITTED,
      CONTENT_POINTER: pointer,
      ...extra,
    })
    const modeOf = (r: ReturnType<typeof resolveConfig>) =>
      r.ok && r.value.kind === 'storage' ? r.value.location.mode : r

    it('is the design sentence, word for word', () => {
      expect(STAGING_REFUSED_HERE).toBe(
        'a staging pointer loads only in a Vercel Preview, in GitHub Actions or on Windows (this PC); refused here (spec §3.2)',
      )
    })

    it.each<[string, Env, string]>([
      ['a Vercel Preview on Linux', { VERCEL: '1', VERCEL_ENV: 'preview' }, 'linux'],
      ['VERCEL_ENV=preview alone on Linux', { VERCEL_ENV: 'preview' }, 'linux'],
      ['GitHub Actions on Linux', { GITHUB_ACTIONS: 'true' }, 'linux'],
      ['this PC (win32)', {}, 'win32'],
    ])('loads a staging pointer in %s', (_where, extra, platform) => {
      const r = resolveConfig(storageWith('catalogue/staging.json', extra), POINTER_ROOTS, platform)
      expect(modeOf(r)).toBe('staging')
    })

    it.each<[string, Env, string]>([
      ['Linux without a Preview or GitHub Actions', {}, 'linux'],
      ['darwin without a Preview or GitHub Actions', {}, 'darwin'],
      ['an unknown platform', {}, 'freebsd'],
      ['GITHUB_ACTIONS=1', { GITHUB_ACTIONS: '1' }, 'linux'],
      ['GITHUB_ACTIONS=TRUE', { GITHUB_ACTIONS: 'TRUE' }, 'linux'],
      ['VERCEL set and VERCEL_ENV unset (Linux)', { VERCEL: '1' }, 'linux'],
      ['VERCEL set and VERCEL_ENV unset (win32)', { VERCEL: '1' }, 'win32'],
      ['VERCEL empty (win32)', { VERCEL: '' }, 'win32'],
      ['VERCEL set in GitHub Actions', { VERCEL: '1', GITHUB_ACTIONS: 'true' }, 'linux'],
      ['VERCEL_ENV=development', { VERCEL_ENV: 'development' }, 'win32'],
      ['VERCEL_ENV empty', { VERCEL_ENV: '' }, 'win32'],
      ['VERCEL_ENV=Preview (case matters)', { VERCEL_ENV: 'Preview' }, 'linux'],
      [
        'VERCEL_ENV=other in GitHub Actions',
        { VERCEL_ENV: 'other', GITHUB_ACTIONS: 'true' },
        'linux',
      ],
    ])('refuses a staging pointer with %s', (_where, extra, platform) => {
      const r = resolveConfig(storageWith('catalogue/staging.json', extra), POINTER_ROOTS, platform)
      expect(r).toEqual({ ok: false, reason: STAGING_REFUSED_HERE })
    })

    it('keeps the VERCEL_ENV=production message on every platform, GitHub Actions included', () => {
      for (const platform of ['win32', 'linux']) {
        for (const extra of [{}, { GITHUB_ACTIONS: 'true' }, { VERCEL: '1' }]) {
          const env = storageWith('catalogue/staging.json', { VERCEL_ENV: 'production', ...extra })
          expect(resolveConfig(env, POINTER_ROOTS, platform)).toEqual({
            ok: false,
            reason: 'CONTENT_POINTER must be a production pointer when VERCEL_ENV=production',
          })
        }
      }
    })

    it('leaves a production pointer alone on every platform', () => {
      for (const platform of ['win32', 'linux', 'darwin']) {
        for (const extra of [{}, { VERCEL: '1' }, { VERCEL_ENV: 'production' }]) {
          const env = storageWith('catalogue/production.json', extra)
          expect(modeOf(resolveConfig(env, POINTER_ROOTS, platform))).toBe('production')
        }
      }
    })

    it('applies to a staging pointer under a root too, and never echoes a value', () => {
      const roots = ['', 'spikes/run/']
      const env = storageWith('spikes/run/catalogue/staging.json', { VERCEL: SECRETISH })
      const r = resolveConfig(env, roots, 'linux')
      expect(r).toEqual({ ok: false, reason: STAGING_REFUSED_HERE })
      expect(JSON.stringify(r)).not.toContain(SECRETISH)
      expect(modeOf(resolveConfig({ ...env, VERCEL: undefined }, roots, 'win32'))).toBe('staging')
    })
  })

  it('never echoes a configured value in a reason', () => {
    const secretish = SECRETISH
    for (const env of [
      { CONTENT_SOURCE: secretish },
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: secretish },
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: `https://${secretish}.supabase.co/x` },
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: `${COMMITTED}?k=${secretish}` },
      {
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: COMMITTED,
        CONTENT_POINTER: secretish,
      },
    ]) {
      const r = resolveConfig(env)
      expect(r.ok).toBe(false)
      expect(JSON.stringify(r)).not.toContain(secretish)
    }
  })

  describe('the committed base URL rule', () => {
    const storage = (base: string) =>
      resolveConfig({
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: base,
        CONTENT_POINTER: 'catalogue/production.json',
      })

    it('is the committed constant, named in the refusal', () => {
      expect(COMMITTED).toBe(
        'https://wlunxatrekiqygwphkgy.supabase.co/storage/v1/object/public/content',
      )
      expect(BASE_URL_REFUSED).toBe(
        'CONTENT_BASE_URL must be the committed public base https://wlunxatrekiqygwphkgy.supabase.co/storage/v1/object/public/content (spec §3.5, D3)',
      )
    })

    it.each([
      COMMITTED,
      `${COMMITTED}/`,
      `${COMMITTED}//`,
      'https://WLUNXATREKIQYGWPHKGY.supabase.co/storage/v1/object/public/content',
      'https://wlunxatrekiqygwphkgy.supabase.co:443/storage/v1/object/public/content/',
      'http://127.0.0.1:54321/storage/v1/object/public/content',
      'http://localhost:8080/x',
      'http://[::1]:9000/storage/v1/object/public/content/',
      'https://127.0.0.1/anything',
    ])('accepts %s', (base) => {
      const r = storage(base)
      expect(r.ok && r.value.kind).toBe('storage')
    })

    it.each([
      'https://example.supabase.co/x',
      'https://wlunxatrekiqygwphkgy.supabase.co',
      'https://wlunxatrekiqygwphkgy.supabase.co/storage/v1/object/public/masters',
      `${COMMITTED}/catalogue`,
      'https://wlunxatrekiqygwphkgy.supabase.co/storage/v1/object/public/%63ontent',
      'https://wlunxatrekiqygwphkgy.supabase.co:8443/storage/v1/object/public/content',
      'https://wlunxatrekiqygwphkgy.supabase.co.evil.test/storage/v1/object/public/content',
      `${COMMITTED}?`,
      `${COMMITTED}#`,
      'https://127.0.0.2/storage/v1/object/public/content',
    ])('refuses %s with the constant only', (base) => {
      expect(storage(base)).toEqual({ ok: false, reason: BASE_URL_REFUSED })
    })
  })
})

describe('the environment line (design §4.5)', () => {
  it.each<[Env, string, string]>([
    [
      {},
      'win32',
      'VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=unset GITHUB_ACTIONS=unset platform=win32',
    ],
    [
      { VERCEL: '', VERCEL_ENV: '', CONTENT_SOURCE: '', GITHUB_ACTIONS: '' },
      'linux',
      'VERCEL=empty VERCEL_ENV=empty CONTENT_SOURCE=empty GITHUB_ACTIONS=empty platform=linux',
    ],
    [
      { VERCEL: '1', VERCEL_ENV: 'production', CONTENT_SOURCE: 'none', GITHUB_ACTIONS: 'true' },
      'linux',
      'VERCEL=set VERCEL_ENV=production CONTENT_SOURCE=none GITHUB_ACTIONS=true platform=linux',
    ],
    [
      { VERCEL: SECRETISH, VERCEL_ENV: 'preview', CONTENT_SOURCE: 'storage', GITHUB_ACTIONS: '1' },
      'darwin',
      'VERCEL=set VERCEL_ENV=preview CONTENT_SOURCE=storage GITHUB_ACTIONS=other platform=darwin',
    ],
    [
      { VERCEL_ENV: 'development', CONTENT_SOURCE: 'fixtures', GITHUB_ACTIONS: 'TRUE' },
      'aix',
      'VERCEL=unset VERCEL_ENV=development CONTENT_SOURCE=fixtures GITHUB_ACTIONS=other platform=other',
    ],
    [
      { VERCEL_ENV: SECRETISH, CONTENT_SOURCE: SECRETISH, GITHUB_ACTIONS: SECRETISH },
      SECRETISH,
      'VERCEL=unset VERCEL_ENV=other CONTENT_SOURCE=other GITHUB_ACTIONS=other platform=other',
    ],
  ])('%j on %s', (env, platform, names) => {
    expect(environmentLine(env, platform)).toBe(`content: environment ${names}`)
  })

  it('is the first line of every run, failing ones included, on stdout', async () => {
    expect(await run({ CONTENT_SOURCE: 'remote' })).toBe(1)
    expect(out).toEqual([
      'content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=other GITHUB_ACTIONS=unset platform=linux',
    ])
    expect(errors).toEqual([
      'content gate failed: CONTENT_SOURCE must be "storage", "fixtures" or "none"',
    ])
  })
})

// ---- secret safety (design §10.1) ----

const CANARIES: Env = {
  READER_DB_URL: `postgres://reader:${SECRETISH}@db.example.test:5432/reader`,
  SUPABASE_SECRET_KEY: SECRETISH,
  VERCEL_OIDC_TOKEN: SECRETISH,
  VERCEL_AUTOMATION_BYPASS_SECRET: SECRETISH,
}

/** Every file the loader wrote under the root (.content/ and public/build-info.json), as text. */
function writtenText(): string {
  const parts: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) visit(file)
      else parts.push(readFileSync(file, 'utf8'))
    }
  }
  if (existsSync(paths().contentDir)) visit(paths().contentDir)
  if (existsSync(paths().publicInfo)) parts.push(readFileSync(paths().publicInfo, 'utf8'))
  return parts.join('\n')
}

function expectNoSecret(): void {
  const lines = [...out, ...errors]
  expect(lines.length).toBeGreaterThan(0)
  for (const text of [...lines, writtenText()]) {
    expect(text).not.toContain(SECRETISH)
    expect(text).not.toContain('127.0.0.1') // never a host or base URL
    expect(text).not.toContain(baseUrl)
  }
}

describe('secret safety: canary values never reach a log line or an output', () => {
  it('a passing storage run', async () => {
    const media: MediaVariant[] = []
    const two = await servePackage('two-paths', {
      mutate: (pkg) => void media.push(...addImage(pkg, 1, [['w800', 'image/webp', 100]])),
    })
    serveMedia(media)
    await publish({ mode: 'staging', stories: [two.entry] })
    expect(await runStaging({ ...storageEnv('catalogue/staging.json'), ...CANARIES })).toBe(0)
    expect(requestList()).toEqual([...stagingGets(two), ['HEAD', media[0]!.path]])
    expect(existsSync(paths().publicInfo)).toBe(true)
    expectNoSecret()
  })

  it('a passing fixtures run, with a canary query on CONTENT_BASE_URL', async () => {
    copyFixtures()
    const env = { ...fixturesEnv, ...CANARIES, CONTENT_BASE_URL: `${baseUrl}?token=${SECRETISH}` }
    expect(await runFixtures(env)).toBe(0)
    expect(existsSync(paths().publicInfo)).toBe(true)
    expectNoSecret()
  })

  it('a failing run on a canary query on CONTENT_BASE_URL', async () => {
    const env = {
      ...storageEnv(),
      ...CANARIES,
      CONTENT_BASE_URL: `${baseUrl}?token=${SECRETISH}`,
    }
    expect(await run(env)).toBe(1)
    expect(errors).toEqual(['content gate failed: CONTENT_BASE_URL must not carry a query'])
    expectNoSecret()
  })

  it('a failing run after requests (a tampered package)', async () => {
    const two = await servePackage('two-paths')
    route(two.entry.packagePath, json(jcsBytes({ ...two.pkg, emoji: SECRETISH.slice(0, 2) })))
    await publish({ mode: 'staging', stories: [two.entry] })
    expect(await runStaging({ ...storageEnv('catalogue/staging.json'), ...CANARIES })).toBe(1)
    expect(errors).toEqual(['content gate failed: package two-paths sha256 mismatch'])
    expect(requestList()).toEqual(stagingGets(two))
    expectNoSecret()
  })
})

// ---- the env names the loader reads (design §4.2, §9 item 34) ----

const LOADER_ENV_NAMES = [
  'CONTENT_BASE_URL',
  'CONTENT_POINTER',
  'CONTENT_SOURCE',
  'GITHUB_ACTIONS',
  'VERCEL',
  'VERCEL_DEPLOYMENT_ID',
  'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_URL',
]

interface Source {
  readonly file: string
  readonly text: string
}

/** Wrappers that leave the value unchanged: `(env)`, `env!`, `env as Env`, `env satisfies Env`. */
const transparent = (node: ts.Node) =>
  ts.isParenthesizedExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isTypeAssertionExpression(node)

/** The identifier is the name being declared, not a use: `env: Env`, `{ env: … }`, `const env`. */
function declaresName(parent: ts.Node, id: ts.Identifier): boolean {
  return (
    ((ts.isParameter(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent)) &&
      parent.name === id) ||
    (ts.isBindingElement(parent) && (parent.name === id || parent.propertyName === id))
  )
}

/** The node sits inside the left side of a destructuring assignment: `({ … } = x)`. */
function inAssignmentTarget(node: ts.Node): boolean {
  let child = node
  for (let p = node.parent; p; child = p, p = p.parent) {
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return p.left === child
    }
    if (ts.isForOfStatement(p) || ts.isForInStatement(p)) return p.initializer === child
    const pattern =
      ts.isObjectLiteralExpression(p) ||
      ts.isArrayLiteralExpression(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isShorthandPropertyAssignment(p) ||
      ts.isSpreadAssignment(p) ||
      ts.isSpreadElement(p) ||
      transparent(p)
    if (!pattern) return false
  }
  return false
}

/**
 * `{ env: e }` or `{ env: { X } }`, in a binding pattern or a destructuring assignment: env taken
 * out under another name, so its reads would no longer be seen. `{ env }` and `{ env: env }` keep
 * the name and stay visible. null when `id` is not such a property name.
 */
function renamesEnv(parent: ts.Node, id: ts.Identifier): string | null {
  let target: ts.Node | undefined
  if (ts.isBindingElement(parent) && parent.propertyName === id) target = parent.name
  else if (ts.isPropertyAssignment(parent) && parent.name === id && inAssignmentTarget(parent)) {
    target = parent.initializer
    // `{ env: e = fallback } = x`
    if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      target = target.left
    }
  }
  if (!target) return null
  if (ts.isIdentifier(target) && target.text === 'env') return null
  const pattern =
    ts.isObjectBindingPattern(target) ||
    ts.isArrayBindingPattern(target) ||
    ts.isObjectLiteralExpression(target) ||
    ts.isArrayLiteralExpression(target)
  return pattern ? 'destructures env' : 'aliases env'
}

/**
 * Every env name the sources read, from their syntax trees (design §10.1 secret safety, §9 item
 * 34): property reads on an env expression (`env`, `options.env`, `process.env`) and the literal
 * names passed as `vercelValue(env, '<NAME>')`. Every other use of an env expression is a problem,
 * so a read cannot hide from the list: destructuring, spreading, enumerating or aliasing it (also
 * as `{ env: e }` or `{ env: { X } }` in a binding pattern or a destructuring assignment), a
 * computed `env[...]` outside vercelValue, any other vercelValue call, and passing it to a
 * function unless that function is declared in these sources with the parameter named `env`
 * (whose reads this scan then sees). The one value use allowed is `{ env: <env> }` handed to such
 * a function (the entry point's `loadContent({ env: process.env, root })`).
 */
function scanEnvReads(sources: readonly Source[]): { names: string[]; problems: string[] } {
  const names = new Set<string>()
  const problems: string[] = []
  const trees = sources.map(({ file, text }) => ({
    file,
    tree: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  }))
  const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
    visit(node)
    ts.forEachChild(node, (child) => walk(child, visit))
  }

  // The functions these sources declare, with their parameter names.
  const params = new Map<string, readonly string[]>()
  const parameterNames = (fn: ts.SignatureDeclarationBase) =>
    fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ''))
  for (const { tree } of trees) {
    walk(tree, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        params.set(node.name.text, parameterNames(node))
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        params.set(node.name.text, parameterNames(node.initializer))
      }
    })
  }
  const insideVercelValue = (node: ts.Node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name?.text === 'vercelValue') return true
    }
    return false
  }

  /** null when this use of an env expression is allowed, else the problem. */
  const judge = (expression: ts.Node): string | null => {
    let top = expression
    while (top.parent && transparent(top.parent)) top = top.parent
    const p = top.parent
    if (ts.isPropertyAccessExpression(p) && p.expression === top) {
      names.add(p.name.text)
      return null
    }
    if (ts.isElementAccessExpression(p) && p.expression === top) {
      return insideVercelValue(p) ? null : 'computed env[...] outside vercelValue'
    }
    if (ts.isCallExpression(p) && p.arguments.some((a) => a === top)) {
      const callee = p.expression
      if (ts.isIdentifier(callee) && callee.text === 'vercelValue') {
        const [first, second] = p.arguments
        if (p.arguments.length === 2 && first === top && ts.isIdentifier(top)) {
          if (second && ts.isStringLiteralLike(second)) {
            names.add(second.text)
            return null
          }
        }
        return "vercelValue called other than as vercelValue(env, '<NAME>')"
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        ['Object', 'Reflect'].includes(callee.expression.text)
      ) {
        return 'enumerates env'
      }
      const index = p.arguments.findIndex((a) => a === top)
      if (ts.isIdentifier(callee) && params.get(callee.text)?.[index] === 'env') return null
      return `passes env to ${callee.getText()}`
    }
    if (
      (ts.isPropertyAssignment(p) && p.initializer === top) ||
      ts.isShorthandPropertyAssignment(p)
    ) {
      const literal = p.parent
      const call = literal.parent
      const keyed = ts.isIdentifier(p.name) && p.name.text === 'env'
      const handedToLocal =
        ts.isCallExpression(call) &&
        call.arguments.some((a) => a === literal) &&
        ts.isIdentifier(call.expression) &&
        params.has(call.expression.text)
      return keyed && handedToLocal ? null : 'uses env as a value'
    }
    if (ts.isSpreadAssignment(p) || ts.isSpreadElement(p)) return 'spreads env'
    if (ts.isVariableDeclaration(p) && p.initializer === top) {
      return ts.isIdentifier(p.name) ? 'aliases env' : 'destructures env'
    }
    if (
      ts.isBinaryExpression(p) &&
      p.right === top &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      return ts.isObjectLiteralExpression(p.left) || ts.isArrayLiteralExpression(p.left)
        ? 'destructures env'
        : 'aliases env'
    }
    if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.expression === top) {
      return 'enumerates env'
    }
    return 'uses env as a value'
  }

  for (const { file, tree } of trees) {
    walk(tree, (node) => {
      let problem: string | null = null
      if (ts.isIdentifier(node) && node.text === 'env') {
        const p = node.parent
        const renamed = renamesEnv(p, node)
        if (renamed) problem = renamed
        else if (ts.isPropertyAccessExpression(p) && p.name === node) problem = judge(p)
        else if (!declaresName(p, node)) problem = judge(node)
      } else if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'env'
      ) {
        problem = 'computed access to env'
      } else if (
        (ts.isParameter(node) || ts.isVariableDeclaration(node)) &&
        !ts.isIdentifier(node.name) &&
        node.type &&
        ts.isTypeReferenceNode(node.type) &&
        node.type.typeName.getText() === 'Env'
      ) {
        problem = 'destructures env'
      }
      if (problem) problems.push(`${file}: ${problem}`)
    })
  }
  return { names: [...names].sort(), problems }
}

describe('the loader reads only the 9 public env names', () => {
  const loaderSources = (): Source[] => {
    const contentDir = join(storyboardDir, 'scripts', 'content')
    const files = [
      'scripts/load-content.ts',
      ...readdirSync(contentDir)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .map((name) => `scripts/content/${name}`),
    ]
    return files.map((file) => ({
      file,
      text: readFileSync(join(storyboardDir, ...file.split('/')), 'utf8'),
    }))
  }

  it('in load-content.ts and scripts/content/*.ts', () => {
    const sources = loaderSources()
    expect(sources.map((s) => s.file)).toEqual(
      expect.arrayContaining([
        'scripts/load-content.ts',
        'scripts/content/request.ts',
        'scripts/content/file-source.ts',
        'scripts/content/media-gate.ts',
      ]),
    )
    expect(scanEnvReads(sources)).toEqual({ names: LOADER_ENV_NAMES, problems: [] })
  })

  it.each([
    ['a destructuring', 'const { READER_DB_URL } = options.env', 'destructures env'],
    ['a spread', 'const copy = { ...env }', 'spreads env'],
    ['an enumeration', 'for (const k of Object.keys(env)) log(k)', 'enumerates env'],
    ['a computed read', "const x = env['READER_DB_URL']", 'computed env[...] outside vercelValue'],
    [
      'vercelValue on process.env',
      "export const leak = () => vercelValue(process.env, 'READER_DB_URL')",
      "vercelValue called other than as vercelValue(env, '<NAME>')",
    ],
    [
      'vercelValue on options.env',
      "const leak = (options: LoaderOptions) => vercelValue(options.env, 'READER_DB_URL')",
      "vercelValue called other than as vercelValue(env, '<NAME>')",
    ],
    [
      'vercelValue with a variable name',
      'const leak = (n: string) => vercelValue(env, n)',
      "vercelValue called other than as vercelValue(env, '<NAME>')",
    ],
    ['an alias', 'const e = options.env\nconst x = e.READER_DB_URL', 'aliases env'],
    [
      'a renamed destructuring',
      'const { env: e } = options\nconst x = e.READER_DB_URL',
      'aliases env',
    ],
    [
      'a renamed destructured parameter',
      'function f({ env: e }: LoaderOptions) {\n  return e.SUPABASE_SECRET_KEY\n}',
      'aliases env',
    ],
    ['a nested destructuring', 'const { env: { READER_DB_URL } } = options', 'destructures env'],
    [
      'a renamed destructuring assignment',
      'let e: Env\n;({ env: e } = options)\nconst x = e.READER_DB_URL',
      'aliases env',
    ],
    [
      'a renamed destructuring assignment with a default',
      'let e: Env\n;({ env: e = {} } = options)\nconst x = e.READER_DB_URL',
      'aliases env',
    ],
    [
      'a function returning env',
      'const source = (o: LoaderOptions) => o.env\nexport const x = (o: LoaderOptions) => source(o).READER_DB_URL',
      'uses env as a value',
    ],
    [
      'a destructured Env parameter',
      'function f({ READER_DB_URL }: Env) {\n  return READER_DB_URL\n}',
      'destructures env',
    ],
    [
      'env passed to a parameter with another name',
      'function leak(e: Env) {\n  return e.READER_DB_URL\n}\nleak(env)',
      'passes env to leak',
    ],
    [
      'env passed to an outside function',
      'log(JSON.stringify(env))',
      'passes env to JSON.stringify',
    ],
    ['a computed process.env', "const x = process['env']", 'computed access to env'],
  ])('catches %s', (_what, line, problem) => {
    const text = `function vercelValue(env: Env, name: string): string | null {\n  return env[name] ?? null\n}\n${line}\n`
    expect(scanEnvReads([{ file: 'seed.ts', text }]).problems).toEqual([`seed.ts: ${problem}`])
  })

  it('catches a hidden read appended to the real loader source', () => {
    const [loader, ...rest] = loaderSources()
    expect(loader!.file).toBe('scripts/load-content.ts')
    for (const [line, problem] of [
      [
        "export const leak = () => vercelValue(process.env, 'READER_DB_URL')",
        "vercelValue called other than as vercelValue(env, '<NAME>')",
      ],
      [
        'const source = (o: LoaderOptions) => o.env\nexport const leak = (o: LoaderOptions) => source(o).READER_DB_URL',
        'uses env as a value',
      ],
      ['export const leak = ({ env: e }: LoaderOptions) => e.READER_DB_URL', 'aliases env'],
    ] as const) {
      const seeded = { file: loader!.file, text: `${loader!.text}\n${line}\n` }
      expect(scanEnvReads([seeded, ...rest])).toEqual({
        names: LOADER_ENV_NAMES,
        problems: [`scripts/load-content.ts: ${problem}`],
      })
    }
  })

  it('lists a property read and a vercelValue name', () => {
    const text = "const a = env.READER_DB_URL\nconst b = vercelValue(env, 'VERCEL_OIDC_TOKEN')\n"
    expect(scanEnvReads([{ file: 'seed.ts', text }]).names).toEqual([
      'READER_DB_URL',
      'VERCEL_OIDC_TOKEN',
    ])
  })
})

describe('helpers', () => {
  it('reads the CDN location from cf-ray', () => {
    expect(popFromCfRay('8f1a2b3c4d5e6f70-BOM')).toBe('BOM')
    expect(popFromCfRay('8f1a2b3c4d5e6f70-sin')).toBe('SIN')
    expect(popFromCfRay('8f1a2b3c4d5e6f70')).toBeNull()
    expect(popFromCfRay(null)).toBeNull()
  })

  it('joins an object path onto the base URL with exactly one slash', () => {
    for (const base of [
      'https://x.supabase.co/storage/v1/object/public/content',
      'https://x.supabase.co/storage/v1/object/public/content/',
    ]) {
      expect(objectUrl(new URL(base), 'catalogue/production.json').href).toBe(
        'https://x.supabase.co/storage/v1/object/public/content/catalogue/production.json',
      )
    }
  })

  it('names the Vercel environment for log lines without echoing an unknown value', () => {
    expect(vercelEnvName({})).toBe('unset')
    expect(vercelEnvName({ VERCEL_ENV: '' })).toBe('unset')
    for (const name of ['production', 'preview', 'development']) {
      expect(vercelEnvName({ VERCEL_ENV: name })).toBe(name)
    }
    expect(vercelEnvName({ VERCEL_ENV: SECRETISH })).toBe('other')
  })

  it('recognises the entry point and nothing else', () => {
    const file = fileURLToPath(import.meta.url)
    expect(isEntryPoint(pathToFileURL(file).href, file)).toBe(true)
    expect(isEntryPoint(pathToFileURL(file).href, join(dirname(file), 'other.ts'))).toBe(false)
    expect(isEntryPoint(pathToFileURL(file).href, undefined)).toBe(false)
  })

  it('recognises the entry point when it is started through a symlinked or junctioned folder', () => {
    const file = fileURLToPath(import.meta.url)
    withLinkedFolder(dirname(file), (link) => {
      expect(isEntryPoint(pathToFileURL(file).href, join(link, basename(file)))).toBe(true)
      expect(isEntryPoint(pathToFileURL(file).href, join(link, 'other.ts'))).toBe(false)
    })
  })
})

describe('load-content (real process, exit code)', () => {
  const storyboard = join(dirname(fileURLToPath(import.meta.url)), '..')

  /** Runs the loader as `pnpm build` does, in Production with CONTENT_SOURCE unset. */
  function productionWithoutSource(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, VERCEL_ENV: 'production' }
    for (const name of ['CONTENT_SOURCE', 'CONTENT_BASE_URL', 'CONTENT_POINTER']) delete env[name]
    return env
  }

  const spawnLoader = (script: string, env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, [join(storyboard, 'node_modules/tsx/dist/cli.mjs'), script], {
      env,
      encoding: 'utf8',
    })

  /** stdout holds exactly the environment line (enums of this process's environment). */
  function expectOnlyEnvironmentLine(stdout: string, env: NodeJS.ProcessEnv): void {
    expect(stdout).toBe(`${environmentLine(env, process.platform)}\n`)
    expect(stdout).toMatch(
      /^content: environment VERCEL=(unset|empty|set) VERCEL_ENV=\w+ CONTENT_SOURCE=\w+ GITHUB_ACTIONS=\w+ platform=\w+\n$/,
    )
  }

  function expectGateFailure(result: ReturnType<typeof spawnLoader>, env: NodeJS.ProcessEnv): void {
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'content gate failed: CONTENT_SOURCE is not set; it is required when VERCEL_ENV=production',
    )
    expectOnlyEnvironmentLine(result.stdout, env)
    expect(result.stdout).toContain('VERCEL_ENV=production CONTENT_SOURCE=unset')
  }

  it('exits 1 with the gate message in Production when CONTENT_SOURCE is unset', () => {
    const env = productionWithoutSource()
    expectGateFailure(spawnLoader(join(storyboard, 'scripts/load-content.ts'), env), env)
  }, 30_000)

  it('fails closed the same way when started through a symlinked or junctioned folder', () => {
    const env = productionWithoutSource()
    withLinkedFolder(join(storyboard, 'scripts'), (link) => {
      expectGateFailure(spawnLoader(join(link, 'load-content.ts'), env), env)
    })
  }, 30_000)

  it('exits 1 on CONTENT_SOURCE=fixtures in a Vercel build and leaves the real outputs as they were', () => {
    // This runs against the real storyboard folder, so it checks that the refusal comes before
    // the loader removes or writes .content/ and public/build-info.json.
    const publicInfo = join(storyboard, 'public', 'build-info.json')
    const outputsNow = () => ({
      content: existsSync(join(storyboard, '.content')),
      buildInfo: existsSync(publicInfo) ? readFileSync(publicInfo, 'utf8') : null,
    })
    const before = outputsNow()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VERCEL_ENV: 'preview',
      CONTENT_SOURCE: 'fixtures',
    }
    const result = spawnLoader(join(storyboard, 'scripts/load-content.ts'), env)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'content gate failed: CONTENT_SOURCE=fixtures is refused when VERCEL or VERCEL_ENV is set (CI and local only)',
    )
    expectOnlyEnvironmentLine(result.stdout, env)
    expect(result.stdout).toContain('VERCEL_ENV=preview CONTENT_SOURCE=fixtures')
    expect(outputsNow()).toEqual(before)
  }, 30_000)
})
