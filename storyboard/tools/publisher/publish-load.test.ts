// Step 15a (P1-8d part a) loader acceptance in production mode: the build's own loader accepts the
// snapshot publish wrote (design migration-input/p1-step15a-design.md §8, A26, D14-12's pattern;
// test plan §14.13: T15A-66, T15A-67). Stage, approve and publish write into the publisher's
// loopback stub; the test lists every content object through the client and copies it, with its
// stored content type, into the loader's stub; then the real loadContent runs in production mode
// (platform linux with GITHUB_ACTIONS, CONTENT_POINTER catalogue/production.json) into a temp root.
// The hook and verify are fakes. A loopback guard refuses and counts any other host; every test ends
// with expectPublishSafe (TP-8).
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadContent, outputPaths } from '../../scripts/load-content'
import { startStubStorage, type StubStorage } from '../../scripts/testing/stub-storage'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { parseArgs } from './args'
import { runApprove } from './approve'
import { Secret } from './env'
import type { PublishPort } from './port'
import { runPublish } from './publish'
import { runStage } from './stage'
import {
  answersOf,
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

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-publish-load-key'].join('_')
const NOW = '2026-11-21T20:00:00.000Z'
const LIST_PATH = '/storage/v1/object/list/content'
const CREATE = '/storage/v1/object/'
const TIMEOUT = { timeout: 120_000 }

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0
let root = ''
const publisherStubs: StorageStub[] = []
const loaderStubs: StubStorage[] = []
const marks = new Map<StorageStub, number>()

beforeEach(() => {
  escapes = 0
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
    escapes++
    return Promise.reject(new TypeError('blocked: not a loopback host'))
  })
  root = mkdtempSync(join(tmpdir(), 's15a-load-'))
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
  marks.clear()
  rmSync(root, { recursive: true, force: true })
  const count = escapes
  vi.unstubAllGlobals()
  expect(count, 'loopback guard: requests that tried to leave 127.0.0.1').toBe(0)
  if (problems.length > 0) throw problems[0]
})

const isObjectPost = (r: StubLogEntry) => r.method === 'POST' && r.pathname !== LIST_PATH
/**
 * TP-8 (A19): after the mark set at the start of the last publish, object POSTs only to
 * catalogue/snapshots/<seq>.json (at most two) and catalogue/production.json (at most one); none
 * under masters; none to the staging pointer; then expectNoUnexpected.
 */
function expectPublishSafe(stub: StorageStub, seq: number | null): void {
  const posts = stub.requests.slice(marks.get(stub) ?? 0).filter(isObjectPost)
  const snapshot = (r: StubLogEntry) =>
    seq !== null && r.pathname === `${CREATE}content/catalogue/snapshots/${seq}.json`
  const pointer = (r: StubLogEntry) => r.pathname === `${CREATE}content/catalogue/production.json`
  if (!posts.every((r) => snapshot(r) || pointer(r))) {
    throw new Error('A19: an object POST outside the snapshot and the production pointer')
  }
  if (posts.filter(snapshot).length > 2 || posts.filter(pointer).length > 1) {
    throw new Error('A19: too many snapshot or production POSTs')
  }
  expectNoUnexpected(stub)
}

let cached: Promise<TestStory[]> | null = null
const testStories = (): Promise<TestStory[]> => (cached ??= buildTestStories())
const context = () => ({ cwd: root, storyboardRoot: root, platform: process.platform })

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

const quiet = {
  now: () => new Date(NOW),
  sleep: async () => {},
  log: () => {},
  error: () => {},
}

async function stage(client: StorageClient, stories: readonly TestStory[]): Promise<number> {
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
      join(root, 'reports'),
    ],
    context(),
  )
  if (!parsed.ok || parsed.command !== 'stage') throw new Error('test setup: stage args')
  return runStage(parsed, {
    storyboardRoot: root,
    platform: process.platform,
    ...quiet,
    makePort: () => client,
  })
}

async function approve(client: StorageClient, story: TestStory): Promise<number> {
  const parsed = parseArgs(
    [
      'approve',
      story.storyId,
      '--package',
      story.packageSha256.slice(0, 12),
      '--answers-stdin',
      '--report-dir',
      join(root, 'reports'),
    ],
    context(),
  )
  if (!parsed.ok || parsed.command !== 'approve') throw new Error('test setup: approve args')
  return runApprove(parsed, {
    storyboardRoot: root,
    platform: process.platform,
    ...quiet,
    runMode: 'pc',
    makePort: () => client,
    answers: {
      kind: 'stdin',
      input: Readable.from([JSON.stringify(answersOf(story))]),
      deadline: new Promise<void>(() => {}),
    },
  })
}

async function publish(stub: StorageStub, client: StorageClient, args: readonly string[]) {
  marks.set(stub, stub.requests.length)
  const parsed = parseArgs(['publish', ...args, '--report-dir', join(root, 'reports')], context())
  if (!parsed.ok || parsed.command !== 'publish') throw new Error('test setup: publish args')
  return runPublish(parsed, {
    storyboardRoot: root,
    platform: process.platform,
    ...quiet,
    runMode: 'pc',
    makePort: () => {
      const port: PublishPort = client
      return port
    },
    tail: {
      hook: async () => 'triggered',
      verify: async (seq) => ({ kind: 'live', seq }),
    },
  })
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
      CONTENT_POINTER: 'catalogue/production.json',
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

interface BuildInfo {
  readonly stories: readonly { storyId: string; packageSha256: string }[]
  readonly excluded?: readonly unknown[]
  readonly featuredStoryId?: string | null
}
const buildInfo = (): BuildInfo =>
  JSON.parse(readFileSync(outputPaths(root).publicBuildInfo, 'utf8')) as BuildInfo

/** The production snapshot's entries (id and package sha) in order. */
function productionEntries(stub: StorageStub) {
  const pointer = JSON.parse(
    new TextDecoder().decode(stub.object('content', 'catalogue/production.json')!.bytes),
  ) as { snapshotPath: string; seq: number }
  const snapshot = JSON.parse(
    new TextDecoder().decode(stub.object('content', pointer.snapshotPath)!.bytes),
  ) as { stories: { storyId: string; packageSha256: string }[] }
  return {
    seq: pointer.seq,
    stories: snapshot.stories.map((e) => ({ storyId: e.storyId, packageSha256: e.packageSha256 })),
  }
}

describe('loader acceptance in production mode', () => {
  it(
    'T15A-66 the real loader in production mode accepts N+1: stories, excluded empty, featured kept (A26)',
    TIMEOUT,
    async () => {
      const [lantern, river, two] = await testStories()
      const bound = await fullyBoundStory(two!)
      const stories = [lantern!, river!, bound]
      const { stub, client } = await publisherStub(stories)
      const staged = await stage(client, stories)
      const approvals = [await approve(client, bound), await approve(client, river!)]
      const published = await publish(stub, client, [
        bound.storyId,
        river!.storyId,
        '--feature',
        bound.storyId,
      ])
      expect(
        [staged, ...approvals, published],
        'precondition: stage, approve two and publish them with --feature exited 0',
      ).toEqual([0, 0, 0, 0])
      // MT15A-3 (test-side plant): pass a media path as `drop` here to leave one object out.
      const { loader, copied, listed } = await copyToLoader(stub, client)
      expect(copied, 'precondition: every listed object copied with its stored type').toBe(listed)
      const loaded = await load(loader)
      expect.soft(loaded.exit, '(g1) loadContent returns 0 in production mode').toBe(0)
      const info = loaded.exit === 0 ? buildInfo() : { stories: [] }
      const n1 = productionEntries(stub)
      expect
        .soft(
          info.stories.map((s) => ({ storyId: s.storyId, packageSha256: s.packageSha256 })),
          "(g2) build-info's stories equal N+1's ids and package shas in order",
        )
        .toEqual(n1.stories)
      expect.soft(info.excluded ?? [], '(g2) excluded empty').toEqual([])
      expect.soft(info.featuredStoryId, "(g2) the flag's featured id kept").toBe(bound.storyId)
      expectPublishSafe(stub, n1.seq)
    },
  )

  it(
    "T15A-67 a rollback N+1 loads in production mode with the older snapshot's stories (A26, A15)",
    TIMEOUT,
    async () => {
      const two = (await testStories()).find((s) => s.storyId === 'two-paths')!
      const v2 = await withPackage(two, { ...two.pkg, version: 2 } as StoryPackageV1)
      const { stub, client } = await publisherStub([two])
      const steps: number[] = []
      steps.push(await stage(client, [two]), await approve(client, two))
      steps.push(await publish(stub, client, [two.storyId]))
      const first = productionEntries(stub).seq
      steps.push(await stage(client, [v2]), await approve(client, v2))
      steps.push(await publish(stub, client, [two.storyId]))
      steps.push(await publish(stub, client, ['--snapshot', String(first)]))
      expect(steps, 'precondition: v1 published, v2 published, then the rollback exited 0').toEqual(
        [0, 0, 0, 0, 0, 0, 0],
      )
      const { loader } = await copyToLoader(stub, client)
      const loaded = await load(loader)
      expect.soft(loaded.exit, '(g1) loadContent returns 0').toBe(0)
      expect
        .soft(
          loaded.exit === 0 ? buildInfo().stories.map((s) => s.packageSha256) : [],
          "(g1) build-info lists v1's package sha",
        )
        .toEqual([two.packageSha256])
      expectPublishSafe(stub, productionEntries(stub).seq)
    },
  )
})
