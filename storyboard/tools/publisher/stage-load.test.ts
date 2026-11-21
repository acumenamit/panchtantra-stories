// Step 14 (P1-8c) loader acceptance: the build's own loader, in staging mode, accepts what stage
// wrote (design migration-input/p1-step14-design.md D14-12, D13-5, A27; test plan §14.9: T14-71,
// T14-72). Stage writes into the publisher's loopback stub; the test lists every content object
// through the client and copies it, with its stored content type, into the loader's stub; then the
// real loadContent runs in staging mode (platform linux with GITHUB_ACTIONS, the staging allowlist
// on both OSes) into a temp root. A loopback guard refuses and counts any other host; every test
// ends with expectStageSafe (A25).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadContent, outputPaths } from '../../scripts/load-content'
import { startStubStorage, type StubStorage } from '../../scripts/testing/stub-storage'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { parseArgs } from './args'
import { Secret } from './env'
import { runStage } from './stage'
import { buildTestStories, withPackage, writeStageInputs, type TestStory } from './stage-testkit'
import { createStorageClient, type StorageClient } from './storage'
import { expectNoUnexpected, startStorageStub, type StorageStub } from './storage-stub'

const FAKE_KEY = ['sb', 'secret', 'fake-stage-load-key'].join('_')
const NOW = '2026-11-21T10:00:00.000Z'
const IDS = ['two-paths', 'river-stones', 'lantern-walk']
const TIMEOUT = { timeout: 30_000 }

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0
let root = ''
const publisherStubs: StorageStub[] = []
const loaderStubs: StubStorage[] = []

beforeEach(() => {
  escapes = 0
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
    escapes++
    return Promise.reject(new TypeError('blocked: not a loopback host'))
  })
  root = mkdtempSync(join(tmpdir(), 's14-load-'))
})

afterEach(async () => {
  const problems: unknown[] = []
  for (const stub of publisherStubs.splice(0)) {
    try {
      expectNoUnexpected(stub)
    } catch (error) {
      problems.push(error)
    }
    await stub.close()
  }
  for (const stub of loaderStubs.splice(0)) await stub.close()
  rmSync(root, { recursive: true, force: true })
  const count = escapes
  vi.unstubAllGlobals()
  expect(count, 'loopback guard: requests that tried to leave 127.0.0.1').toBe(0)
  if (problems.length > 0) throw problems[0]
})

/** A25: no POST to the production pointer, none under masters, then expectNoUnexpected. */
function expectStageSafe(stub: StorageStub): void {
  const posted = stub.requests.filter((r) => r.method === 'POST')
  if (posted.some((r) => r.pathname === '/storage/v1/object/content/catalogue/production.json')) {
    throw new Error('A25: a POST to the production pointer')
  }
  if (posted.some((r) => r.pathname.startsWith('/storage/v1/object/masters/'))) {
    throw new Error('A25: a POST under masters')
  }
  expectNoUnexpected(stub)
}

let cached: Promise<TestStory[]> | null = null
const testStories = (): Promise<TestStory[]> => (cached ??= buildTestStories())

async function publisherStub(stories: readonly TestStory[]) {
  const stub = await startStorageStub({ apikey: FAKE_KEY })
  publisherStubs.push(stub)
  for (const story of stories) {
    stub.put(
      'masters',
      `waivers/${story.storyId}/${story.waiverSha256}.json`,
      story.waiverBytes,
      'application/json',
    )
  }
  const client = createStorageClient({ supabaseUrl: stub.origin, secretKey: new Secret(FAKE_KEY) })
  return { stub, client }
}

async function stage(client: StorageClient, ids: readonly string[], stories: readonly TestStory[]) {
  const dirs = writeStageInputs(root, stories)
  const parsed = parseArgs(
    [
      'stage',
      ...ids,
      '--packages',
      dirs.packagesDir,
      '--media',
      dirs.mediaDir,
      '--waivers',
      dirs.waiversDir,
      '--report-dir',
      join(root, 'reports'),
    ],
    { cwd: root, storyboardRoot: root, platform: process.platform },
  )
  if (!parsed.ok || parsed.command !== 'stage') throw new Error('test setup: stage args')
  const out: string[] = []
  const exit = await runStage(parsed, {
    storyboardRoot: root,
    platform: process.platform,
    now: () => new Date(NOW),
    sleep: async () => {},
    log: (line) => void out.push(line),
    error: (line) => void out.push(line),
    makePort: () => client,
  })
  return { exit, out }
}

/** Every content object, with its stored type, into a fresh loader stub; `drop` is left out. */
async function copyToLoader(stub: StorageStub, client: StorageClient, drop: string | null = null) {
  const listed = await client.listContent('')
  if (listed.kind !== 'listed') throw new Error('test setup: the content listing failed')
  const loader = await startStubStorage()
  loaderStubs.push(loader)
  let copied = 0
  for (const object of listed.objects) {
    if (object.path === drop) continue
    const stored = stub.object('content', object.path)
    if (stored === undefined) continue
    loader.put(object.path, stored.bytes, stored.contentType)
    copied++
  }
  return { loader, copied, listed: listed.objects.length }
}

async function load(loader: StubStorage) {
  const lines: string[] = []
  const exit = await loadContent({
    env: {
      CONTENT_SOURCE: 'storage',
      CONTENT_BASE_URL: loader.baseUrl,
      CONTENT_POINTER: 'catalogue/staging.json',
      GITHUB_ACTIONS: 'true',
    },
    root,
    platform: 'linux',
    now: () => new Date(NOW),
    log: (line) => void lines.push(line),
    logError: (line) => void lines.push(line),
  })
  return { exit, lines }
}

const buildInfoStories = (): { storyId: string; packageSha256: string }[] => {
  const info = JSON.parse(readFileSync(outputPaths(root).publicBuildInfo, 'utf8')) as {
    stories: { storyId: string; packageSha256: string }[]
  }
  return info.stories.map((s) => ({ storyId: s.storyId, packageSha256: s.packageSha256 }))
}

describe('loader acceptance', () => {
  it(
    "T14-71 the loader accepts stage's output in staging mode (A27, D14-12)",
    TIMEOUT,
    async () => {
      const stories = await testStories()
      const { stub, client } = await publisherStub(stories)
      const staged = await stage(client, IDS, stories)
      expect(staged.exit, 'precondition: a stage of the three stories exited 0').toBe(0)
      // MT14-3 (test-side plant): pass a media path as `drop` here to leave one object out.
      const { loader, copied, listed } = await copyToLoader(stub, client)
      expect(
        listed,
        'precondition: the listing holds every content object (12 objects, a snapshot, a pointer)',
      ).toBe(14)
      expect.soft(copied, '(g1) every listed object copied with its stored type').toBe(listed)
      const loaded = await load(loader)
      expect(
        loaded.lines.some((l) => l.includes('staging')),
        "precondition: the loader's environment line names staging",
      ).toBe(true)
      expect.soft(loaded.exit, '(g1) loadContent returns 0').toBe(0)
      const want = [...IDS].sort()
      expect
        .soft(
          loaded.exit === 0 ? buildInfoStories().map((s) => s.storyId) : [],
          '(g2) build-info in sorted id order',
        )
        .toEqual(want)
      expectStageSafe(stub)
    },
  )

  it(
    'T14-72 after a production publish, stage composes production plus the new version, and the loader shows that set (A27, D13-5)',
    TIMEOUT,
    async () => {
      const stories = await testStories()
      const { stub, client } = await publisherStub(stories)
      expect(
        (await stage(client, IDS, stories)).exit,
        'precondition: the first stage exited 0',
      ).toBe(0)
      const pointer = stub.object('content', 'catalogue/staging.json')
      expect(pointer, 'precondition: the staging pointer stored').toBeDefined()
      // A stand-in for Step 15's publish: production names the first stage's snapshot.
      stub.put('content', 'catalogue/production.json', pointer!.bytes, 'application/json')
      const second = [...IDS].sort()[1]!
      const old = stories.find((s) => s.storyId === second)!
      const v2 = await withPackage(old, { ...old.pkg, version: 2 } as StoryPackageV1)
      const next = stories.map((s) => (s.storyId === second ? v2 : s))
      const restaged = await stage(client, [second], next)
      expect.soft(restaged.exit, '(g1) staging v2 exits 0').toBe(0)
      expect
        .soft(
          restaged.out.some((l) => l.startsWith(`stage: ${second} `) && l.includes(' state=new ')),
          '(g1) state new',
        )
        .toBe(true)
      const { loader } = await copyToLoader(stub, client)
      const loaded = await load(loader)
      expect.soft(loaded.exit, '(g2) the loader accepts it').toBe(0)
      const want = [...IDS].sort().map((id) => ({
        storyId: id,
        packageSha256: (id === second ? v2 : stories.find((s) => s.storyId === id)!).packageSha256,
      }))
      expect
        .soft(
          loaded.exit === 0 ? buildInfoStories() : [],
          "(g2) production's order, the second at v2",
        )
        .toEqual(want)
      expectStageSafe(stub)
    },
  )
})
