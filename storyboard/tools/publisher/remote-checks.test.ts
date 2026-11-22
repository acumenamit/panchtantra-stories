// Step 15a (P1-8d part a) remote-checks.ts: the shared remote story check through the read-only
// port, the carried-entry check and the featured check (design
// migration-input/p1-step15a-design.md §4.4, D15-8, D15-12, TP-10; test plan §14.7: T15A-19 to
// T15A-24). Every Storage call goes to the loopback stub through a real client built in the test
// with a fake key assembled at run time; a loopback guard on the global fetch refuses and counts any
// other host, and every test ends with expectNoUnexpected (afterEach).
// Seed: the testkit's two-paths story staged by hand: its package, media, waiver file and an
// approval record (TP-9) stored in the stub.
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
// Step 15b (P1-8d part b, design p1-step15b-design.md §14.5) adds T15B-7: readCheckedPackage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectedPackagePath } from '../../src/core/content/gates'
import { checkPackage, type SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { validatePackage } from '../../src/core/validator/validate'
import { findingFingerprint } from '../../src/core/validator/waivers'
import { Secret } from './env'
import {
  REMOTE_CHECK_STEPS,
  checkStoryRemote,
  featureCheck,
  readCheckedPackage,
  type RemoteCheckOptions,
} from './remote-checks'
import {
  approvalRecordOf,
  buildTestStories,
  fullyBoundStory,
  waiverBytesOf,
  waiverFileOf,
  withPackage,
  type TestStory,
} from './stage-testkit'
import { createStorageClient, type StorageClient } from './storage'
import {
  expectNoUnexpected,
  startStorageStub,
  type StorageStub,
  type StubLogEntry,
} from './storage-stub'
import { deriveWaiverBlock } from './story-checks'

// ---- shared material ----

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-remote-checks-key'].join('_')
const ID = 'two-paths'
const ON = '2026-11-21'
const READ = '/storage/v1/object/authenticated/'
const LIST_PATH = '/storage/v1/object/list/content'
const TIMEOUT = { timeout: 30_000 }
const RULESET = PANCHATANTRA_RULESET
/** A rule-set ref of the next major version, built from the current one (never typed). */
const NEXT_MAJOR = RULESET.ref.replace(/@(\d+)/, (_whole, major: string) => `@${Number(major) + 1}`)

// ---- loopback guard (§14.1 "Network") ----

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0
const stubs: StorageStub[] = []

beforeEach(() => {
  escapes = 0
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
    escapes++
    return Promise.reject(new TypeError('blocked: not a loopback host'))
  })
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
  vi.restoreAllMocks()
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

type Before = (url: URL, init: RequestInit) => Response | void
function clientOf(stub: StorageStub, before?: Before): StorageClient {
  const fetchImpl = before
    ? ((async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        const answer = before(url, init ?? {})
        if (answer instanceof Response) return answer
        return globalThis.fetch(input, init)
      }) as typeof fetch)
    : undefined
  return createStorageClient({
    supabaseUrl: stub.origin,
    secretKey: new Secret(FAKE_KEY),
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}

let cached: Promise<TestStory[]> | null = null
const testStories = (): Promise<TestStory[]> => (cached ??= buildTestStories())
const storyOf = async (id = ID): Promise<TestStory> =>
  (await testStories()).find((story) => story.storyId === id)!

const listPrefix = (entry: StubLogEntry): string =>
  (JSON.parse(new TextDecoder().decode(entry.body)) as { prefix: string }).prefix

/** Each request as the step of §4.4 it belongs to (the shared REMOTE_CHECK_STEPS names). */
function stepsOf(requests: readonly StubLogEntry[], id = ID): string[] {
  return requests.map((r) => {
    if (r.method === 'GET' && r.pathname.startsWith(`${READ}masters/approvals/${id}/`)) {
      return 'approval'
    }
    if (r.method === 'GET' && r.pathname.startsWith(`${READ}content/packages/${id}/`)) {
      return r.search === '' ? 'package' : `package ${r.search}`
    }
    if (r.method === 'GET' && r.pathname.startsWith(`${READ}masters/waivers/${id}/`)) {
      return 'waiver'
    }
    if (r.method === 'POST' && r.pathname === LIST_PATH) {
      const prefix = listPrefix(r)
      if (prefix === `packages/${id}`) return 'packages-list'
      if (prefix === `media/${id}`) return 'media-list'
      return `list ${prefix}`
    }
    return `other ${r.method} ${r.pathname}`
  })
}

/** The entry without its waiver block. */
function withoutWaivers(entry: SnapshotEntry): SnapshotEntry {
  const copy = { ...entry }
  delete copy.waivers
  return copy
}

/** The story's staged entry with the block derived from `waiverBytes`. */
async function entryOf(story: TestStory): Promise<SnapshotEntry> {
  const derived = await deriveWaiverBlock(story.storyId, story.waiverBytes)
  if (!derived.ok) throw new Error('test setup: the waiver block')
  return {
    storyId: story.storyId,
    collectionId: story.pkg.collectionId,
    version: story.pkg.version,
    packagePath: expectedPackagePath(story, 'staging', ''),
    packageSha256: story.packageSha256,
    waivers: derived.waiver.block,
  }
}

interface SeedOptions {
  readonly record?: Uint8Array | null
  readonly waiver?: boolean
  readonly media?: boolean
  readonly packageBytes?: Uint8Array | null
}

/** Stores the story's package, media, waiver file and approval record (each can be left out). */
async function seed(stub: StorageStub, story: TestStory, options: SeedOptions = {}) {
  const entry = await entryOf(story)
  const approval = await approvalRecordOf(story, { on: ON })
  const packageBytes =
    options.packageBytes === undefined ? story.packageBytes : options.packageBytes
  if (packageBytes !== null)
    stub.put('content', entry.packagePath, packageBytes, 'application/json')
  if (options.media !== false) {
    for (const media of story.media) stub.put('content', media.path, media.bytes, media.mime)
  }
  if (options.waiver !== false) {
    stub.put(
      'masters',
      `waivers/${story.storyId}/${story.waiverSha256}.json`,
      story.waiverBytes,
      'application/json',
    )
  }
  const record = options.record === undefined ? approval.bytes : options.record
  if (record !== null) {
    stub.put(
      'masters',
      `approvals/${story.storyId}/${story.packageSha256}.json`,
      record,
      'application/json',
    )
  }
  return { entry, approval }
}

/** One check on a fresh client; the requests it sent and its result. */
async function run(
  stub: StorageStub,
  entry: SnapshotEntry,
  options: RemoteCheckOptions,
  before?: Before,
) {
  const from = stub.requests.length
  const result = await checkStoryRemote(clientOf(stub, before), entry, options)
  return { result, sent: stub.requests.slice(from) }
}

const codeOf = (result: { ok: boolean; code?: string }) => (result.ok ? 'ok' : result.code)
const encode = (text: string) => new TextEncoder().encode(text)
const pretty = (bytes: Uint8Array) =>
  encode(JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)), null, 2))
const withKey = (bytes: Uint8Array, key: string, value: unknown) =>
  jcsBytes({ ...(JSON.parse(new TextDecoder().decode(bytes)) as object), [key]: value })

describe('the remote story check (§4.4)', () => {
  it(
    'T15A-19 checkStoryRemote: the four steps in order, each object read once; ok carries approvalSha256 as readMaster sha256; skip sends no approval read (A8, §4.4)',
    TIMEOUT,
    async () => {
      const story = await storyOf()
      const stub = await newStub()
      const { entry, approval } = await seed(stub, story)
      expect(
        [
          stub.object('content', entry.packagePath),
          stub.object('masters', `approvals/${ID}/${story.packageSha256}.json`),
          stub.object('masters', `waivers/${ID}/${story.waiverSha256}.json`),
          ...story.media.map((m) => stub.object('content', m.path)),
        ].every((object) => object !== undefined),
        'precondition: every seeded object is in the stub',
      ).toBe(true)
      const full = await run(stub, entry, { approval: 'required' })
      expect
        .soft(stepsOf(full.sent), '(g1) the five requests in order, nothing else')
        .toEqual([...REMOTE_CHECK_STEPS])
      expect
        .soft(
          full.result.ok ? full.result.approvalSha256 : codeOf(full.result),
          '(g2) approvalSha256 is the sha256 of the stored record bytes',
        )
        .toBe(approval.sha256)
      expect
        .soft(
          [approval.sha256 !== story.packageSha256, approval.sha256 !== story.waiverSha256],
          '(g2) the record sha differs from the package and waiver sha',
        )
        .toEqual([true, true])
      const skip = await run(stub, entry, { approval: 'skip' })
      expect
        .soft(stepsOf(skip.sent), '(g3) skip: the same log without the approval GET')
        .toEqual(REMOTE_CHECK_STEPS.filter((step) => step !== 'approval'))
      expect
        .soft(skip.result.ok ? skip.result.approvalSha256 : codeOf(skip.result), '(g3) skip: null')
        .toBe(null)
    },
  )

  it(
    'T15A-20 approval step: every code, and nothing read after the refusal (A8, L5)',
    TIMEOUT,
    async () => {
      const story = await storyOf()
      const control = await newStub()
      const { entry, approval } = await seed(control, story)
      const positive = await run(control, entry, { approval: 'required' })
      expect(positive.result.ok, 'precondition: the seeded story passes here').toBe(true)
      const recordPath = `${READ}masters/approvals/${ID}/${story.packageSha256}.json`
      const other = (await storyOf('river-stones')).packageSha256
      const noWaivers = withoutWaivers(entry)
      const samples: [string, Uint8Array | null, SnapshotEntry, RemoteCheckOptions, string][] = [
        ['absent', null, entry, { approval: 'required' }, 'approval-missing'],
        ['a 401', approval.bytes, entry, { approval: 'required' }, 'storage-unauthorized'],
        ['a 500', approval.bytes, entry, { approval: 'required' }, 'storage-failed'],
        [
          'pretty-printed',
          pretty(approval.bytes),
          entry,
          { approval: 'required' },
          'approval-invalid',
        ],
        [
          'an extra key',
          withKey(approval.bytes, 'x', 1),
          entry,
          { approval: 'required' },
          'approval-invalid',
        ],
        [
          'another packageSha256 in the record',
          withKey(approval.bytes, 'packageSha256', other),
          entry,
          { approval: 'required' },
          'approval-invalid',
        ],
        [
          'ruleSetRef of major + 1',
          withKey(approval.bytes, 'ruleSetRef', NEXT_MAJOR),
          entry,
          { approval: 'required' },
          'approval-rule-set',
        ],
        [
          'waiversSha256 of another file',
          withKey(approval.bytes, 'waiversSha256', 'c'.repeat(64)),
          entry,
          { approval: 'required' },
          'approval-waiver-mismatch',
        ],
        [
          'an entry without waivers',
          approval.bytes,
          noWaivers,
          { approval: 'required' },
          'approval-waiver-mismatch',
        ],
        [
          'expectApprovalSha256 of other bytes',
          approval.bytes,
          entry,
          { approval: 'required', expectApprovalSha256: 'd'.repeat(64) },
          'approval-sha-mismatch',
        ],
      ]
      for (const [label, record, target, options, code] of samples) {
        const stub = await newStub()
        await seed(stub, story, { record })
        if (label === 'a 401') {
          stub.override('GET', recordPath, {
            kind: 'answer',
            status: 401,
            body: '{"statusCode":"401","error":"Unauthorized"}',
          })
        }
        if (label === 'a 500') {
          stub.override('GET', recordPath, {
            kind: 'answer',
            status: 500,
            body: '{"statusCode":"500","error":"internal"}',
          })
        }
        const { result, sent } = await run(stub, target, options)
        expect.soft(codeOf(result), `(g1) ${label}`).toBe(code)
        expect
          .soft(result.ok ? null : result.storyId, `(g1) ${label}: the story named`)
          .toBe(result.ok ? null : ID)
        expect
          .soft(stepsOf(sent), `(g1) ${label}: the log ends at the approval GET`)
          .toEqual(['approval'])
      }
    },
  )

  it(
    'T15A-21 package step: every code; checkPackage with requireJcs decides; no reason printed (A8, L7)',
    TIMEOUT,
    async () => {
      const story = await storyOf()
      const consoleLog = vi.spyOn(console, 'log')
      const consoleError = vi.spyOn(console, 'error')
      const skip: RemoteCheckOptions = { approval: 'skip' }
      const migration: RemoteCheckOptions = { approval: 'skip', origin: 'migration' }
      const control = await newStub()
      const { entry } = await seed(control, story)
      expect(
        (await run(control, entry, migration)).result.ok,
        'precondition: the seeded story passes with origin migration',
      ).toBe(true)

      /** A variant of the story's package stored at its own path, with its entry. */
      async function variant(pkg: StoryPackageV1, keepBlock = true) {
        const changed = await withPackage(story, pkg)
        const stub = await newStub()
        const seeded = await seed(stub, changed)
        const target: SnapshotEntry = keepBlock ? seeded.entry : withoutWaivers(seeded.entry)
        return { stub, target, changed }
      }

      const absent = await newStub()
      await seed(absent, story, { packageBytes: null })
      expect
        .soft(codeOf((await run(absent, entry, skip)).result), '(g1) absent')
        .toBe('object-missing')

      const swapped = await newStub()
      await seed(swapped, story, {
        packageBytes: (await storyOf('river-stones')).packageBytes,
      })
      expect
        .soft(codeOf((await run(swapped, entry, skip)).result), "(g1) another package's bytes")
        .toBe('package-gate')

      // A non-JCS form of our package, the entry naming its sha.
      const loose = pretty(story.packageBytes)
      const looseSha = await sha256Hex(loose)
      const looseStub = await newStub()
      await seed(looseStub, story)
      const looseEntry: SnapshotEntry = {
        ...entry,
        packageSha256: looseSha,
        packagePath: expectedPackagePath({ storyId: ID, packageSha256: looseSha }, 'staging', ''),
      }
      looseStub.put('content', looseEntry.packagePath, loose, 'application/json')
      expect
        .soft(codeOf((await run(looseStub, looseEntry, skip)).result), '(g1) a non-JCS package')
        .toBe('package-gate')

      const arabic = structuredClone(story.pkg)
      arabic.locales = ['en', 'hi', 'ar']
      arabic.text.ar = structuredClone(arabic.text.en!)
      const g011 = await variant(arabic)
      expect
        .soft(codeOf((await run(g011.stub, g011.target, skip)).result), '(g1) G011 (ar disabled)')
        .toBe('package-gate')

      const spaced = structuredClone(story.pkg)
      const nodeId = spaced.nodes[0]!.id
      const text = spaced.text.en!.nodes[nodeId]!
      spaced.text.en!.nodes[nodeId] = { ...text, text: ` ${text.text}` }
      const unwaived = validatePackage(spaced, { ruleSet: RULESET, mode: 'publish' })
      expect(
        unwaived.findings.some((f) => f.severity === 'error'),
        'precondition: a leading space is an unwaived error in publish mode',
      ).toBe(true)
      const tcheck = await variant(spaced)
      expect
        .soft(
          codeOf((await run(tcheck.stub, tcheck.target, skip)).result),
          '(g1) an unwaived error',
        )
        .toBe('package-gate')

      const phase1 = {
        ...story.pkg,
        nodes: story.pkg.nodes.map((node) => ({ ...node, image: null })),
        assets: [],
      } as StoryPackageV1
      const p1 = await variant(phase1)
      expect
        .soft(codeOf((await run(p1.stub, p1.target, skip)).result), '(g1) a phase-1 package')
        .toBe('phase-1-package')

      const writer = { ...story.pkg, origin: 'writer_flow' } as StoryPackageV1
      const wf = await variant(writer, false)
      const gate = await checkPackage(wf.changed.packageBytes, wf.target, RULESET, {
        requireJcs: true,
      })
      expect(gate.ok, 'precondition: checkPackage passes the writer_flow package').toBe(true)
      expect
        .soft(
          codeOf((await run(wf.stub, wf.target, migration)).result),
          '(g2) a writer_flow package with origin migration',
        )
        .toBe('approve-origin-not-migration')
      const bare = withoutWaivers(entry)
      expect
        .soft(
          codeOf((await run(control, bare, migration)).result),
          '(g2) a migration entry without waivers',
        )
        .toBe('staged-entry-invalid')
      expect.soft(consoleLog, '(g3) nothing printed (console.log)').not.toHaveBeenCalled()
      expect.soft(consoleError, '(g3) nothing printed (console.error)').not.toHaveBeenCalled()
    },
  )

  it(
    'T15A-22 waiver step: read by the entry file sha, re-derived, compared byte for byte (A8, L6)',
    TIMEOUT,
    async () => {
      const base = await storyOf()
      const nodeId = base.pkg.nodes[0]!.id
      const records = ['T001', 'T002'].map((checkId) => ({
        checkId,
        ruleId: null,
        nodeId,
        locale: 'en' as const,
        severity: 'error' as const,
        nodeTextSha256: 'a'.repeat(64),
      }))
      const waiverBytes = waiverBytesOf(waiverFileOf(ID, records))
      const story: TestStory = { ...base, waiverBytes, waiverSha256: await sha256Hex(waiverBytes) }
      const skip: RemoteCheckOptions = { approval: 'skip' }
      const control = await newStub()
      const { entry } = await seed(control, story)
      expect(entry.waivers?.keys.length, 'precondition: the block holds two keys').toBe(2)
      expect((await run(control, entry, skip)).result.ok, 'precondition: the story passes').toBe(
        true,
      )

      const absent = await newStub()
      await seed(absent, story, { waiver: false })
      expect
        .soft(codeOf((await run(absent, entry, skip)).result), '(g1) absent')
        .toBe('waiver-not-in-masters')
      const changed = await newStub()
      await seed(changed, story, { waiver: false })
      changed.put(
        'masters',
        `waivers/${ID}/${story.waiverSha256}.json`,
        base.waiverBytes,
        'application/json',
      )
      expect
        .soft(codeOf((await run(changed, entry, skip)).result), '(g1) other bytes under the name')
        .toBe('waiver-hash-mismatch')
      const block = entry.waivers!
      const dropped: SnapshotEntry = { ...entry, waivers: { ...block, keys: [block.keys[0]!] } }
      expect
        .soft(codeOf((await run(control, dropped, skip)).result), '(g2) one key dropped')
        .toBe('waiver-keys-differ')
      const reordered: SnapshotEntry = {
        ...entry,
        waivers: { ...block, keys: [block.keys[1]!, block.keys[0]!] },
      }
      expect
        .soft(codeOf((await run(control, reordered, skip)).result), '(g2) the keys reordered')
        .toBe('waiver-keys-differ')
      const otherRuleSet: SnapshotEntry = {
        ...entry,
        waivers: { ...block, ruleSetRef: NEXT_MAJOR },
      }
      expect
        .soft(
          codeOf((await run(control, otherRuleSet, skip)).result),
          '(g3) a block for another rule set: package-gate at step 2',
        )
        .toBe('package-gate')
    },
  )

  it(
    'T15A-23 object step: the package and every head listed with size and mime (A8, L8)',
    TIMEOUT,
    async () => {
      const story = await storyOf()
      const skip: RemoteCheckOptions = { approval: 'skip' }
      const control = await newStub()
      const { entry } = await seed(control, story)
      expect((await run(control, entry, skip)).result.ok, 'precondition: the story passes').toBe(
        true,
      )
      const name = entry.packagePath.slice(`packages/${ID}/`.length)
      const listing = (metadata: unknown) =>
        JSON.stringify([
          {
            name,
            id: 'f'.repeat(32),
            updated_at: '2026-11-21T00:00:00.000Z',
            created_at: '2026-11-21T00:00:00.000Z',
            last_accessed_at: '2026-11-21T00:00:00.000Z',
            metadata,
          },
        ])

      const missing = await newStub()
      await seed(missing, story, { media: false })
      for (const media of story.media.slice(1)) {
        missing.put('content', media.path, media.bytes, media.mime)
      }
      expect
        .soft(codeOf((await run(missing, entry, skip)).result), '(g1) one variant deleted')
        .toBe('object-missing')

      const bigger = await newStub()
      await seed(bigger, story)
      bigger.override('POST', LIST_PATH, {
        kind: 'answer',
        status: 200,
        body: listing({
          size: story.packageBytes.byteLength + 1,
          mimetype: 'application/json',
          cacheControl: null,
        }),
      })
      expect
        .soft(codeOf((await run(bigger, entry, skip)).result), '(g2) the package listed size + 1')
        .toBe('existing-object-differs')

      const retyped = await newStub()
      await seed(retyped, story)
      retyped.put('content', story.media[0]!.path, story.media[0]!.bytes, 'binary/octet-stream')
      expect
        .soft(codeOf((await run(retyped, entry, skip)).result), '(g2) a media object retyped')
        .toBe('existing-object-differs')

      const unknown = await newStub()
      await seed(unknown, story)
      unknown.override('POST', LIST_PATH, { kind: 'answer', status: 200, body: listing(null) })
      expect
        .soft(codeOf((await run(unknown, entry, skip)).result), '(g3) metadata null')
        .toBe('existing-object-unverifiable')

      for (const [status, code] of [
        [401, 'storage-unauthorized'],
        [500, 'storage-failed'],
      ] as const) {
        const stub = await newStub()
        await seed(stub, story)
        const { result } = await run(stub, entry, skip, (url, init) => {
          const body = typeof init.body === 'string' ? init.body : ''
          if (url.pathname === LIST_PATH && body.includes(`"prefix":"media/${ID}"`)) {
            return new Response(JSON.stringify({ statusCode: String(status), error: 'x' }), {
              status,
              headers: { 'content-type': 'application/json' },
            })
          }
        })
        expect.soft(codeOf(result), `(g4) the media listing ${status}`).toBe(code)
      }
    },
  )

  it(
    'T15A-24 featureCheck: the build featuredVerdict decides, the counts come from the same validatePackage call, waivers never count, and the id must be in N+1 (A14, L13, TP-10)',
    TIMEOUT,
    async () => {
      const bound = await fullyBoundStory(await storyOf())
      const entry = await entryOf(bound)
      expect(featureCheck(ID, [entry], bound.pkg), 'precondition: the fully bound story').toEqual({
        ok: true,
      })
      const audioIndex = bound.pkg.assets.findIndex((asset) => asset.kind === 'audio')
      const noNarration = {
        ...bound.pkg,
        assets: bound.pkg.assets.filter((_, index) => index !== audioIndex),
      } as StoryPackageV1
      expect.soft(featureCheck(ID, [entry], noNarration), '(g1) one narration removed').toEqual({
        ok: false,
        code: 'feature-media-incomplete',
        counts: { A001: 0, A005: 1, A006: 0 },
      })
      const noPicture = {
        ...bound.pkg,
        nodes: bound.pkg.nodes.map((node, index) =>
          index === 0 ? { ...node, image: null } : node,
        ),
      } as StoryPackageV1
      expect.soft(featureCheck(ID, [entry], noPicture), '(g1) one picture removed').toEqual({
        ok: false,
        code: 'feature-media-incomplete',
        counts: { A001: 0, A005: 0, A006: 1 },
      })
      const finding = validatePackage(noNarration, {
        ruleSet: RULESET,
        mode: 'publish',
        forFeature: true,
      }).findings.find((f) => f.checkId === 'A005' && f.severity === 'error')
      expect(finding, 'precondition: the A005 finding exists').toBeDefined()
      const waived: SnapshotEntry = {
        ...entry,
        waivers: {
          ...entry.waivers!,
          keys: [
            {
              checkId: 'A005',
              nodeId: finding!.nodeId,
              locale: finding!.locale,
              nodeTextSha256: await findingFingerprint(noNarration, finding!),
            },
          ],
        },
      }
      expect
        .soft(featureCheck(ID, [waived], noNarration), '(g2) a waiver keyed on the A005 finding')
        .toEqual({
          ok: false,
          code: 'feature-media-incomplete',
          counts: { A001: 0, A005: 1, A006: 0 },
        })
      expect
        .soft(featureCheck('lantern-walk', [entry], bound.pkg), '(g3) an id outside the stories')
        .toEqual({ ok: false, code: 'feature-not-in-production' })
    },
  )
})

// ---- Step 15b (P1-8d part b): the shared package read ----
// (design migration-input/p1-step15b-design.md §3.27, D15B-27; §14.5)

describe('readCheckedPackage (Step 15b)', () => {
  it(
    'T15B-7 readCheckedPackage: one content-addressed read with the carried codes; no listing, no masters read (A25, D15B-27)',
    TIMEOUT,
    async () => {
      const story = await storyOf()
      const read = async (stub: StorageStub, entry: SnapshotEntry) => {
        const from = stub.requests.length
        const result = await readCheckedPackage(clientOf(stub), entry)
        return { result, sent: stub.requests.slice(from) }
      }
      const stub = await newStub()
      const { entry } = await seed(stub, story)
      const ok = await read(stub, entry)
      expect(ok.result.ok, 'precondition: the seeded package reads ok').toBe(true)

      // (g1) ok: {ok: true, pkg, bytes}; one GET of the package path, no listing, no masters read
      expect
        .soft(
          ok.result.ok ? Object.keys(ok.result).sort() : codeOf(ok.result),
          '(g1) ok carries exactly ok, pkg and bytes',
        )
        .toEqual(['bytes', 'ok', 'pkg'])
      expect.soft(ok.result.ok ? ok.result.pkg.storyId : null, '(g1) the checked package').toBe(ID)
      expect
        .soft(ok.result.ok ? ok.result.bytes : null, '(g1) the bytes read')
        .toEqual(story.packageBytes)
      expect
        .soft(
          ok.sent.map((r) => [r.method, r.pathname, r.search]),
          '(g1) exactly one request: a GET of the package path with no search',
        )
        .toEqual([['GET', `${READ}content/${entry.packagePath}`, '']])
      expect
        .soft(stepsOf(ok.sent), '(g1) no list request and no masters request')
        .toEqual(['package'])

      // (g2) the carried codes
      const absent = await newStub()
      await seed(absent, story, { packageBytes: null })
      expect
        .soft(codeOf((await read(absent, entry)).result), '(g2) not found')
        .toBe('carried-package-missing')

      const swapped = await newStub()
      await seed(swapped, story, { packageBytes: (await storyOf('river-stones')).packageBytes })
      expect
        .soft(codeOf((await read(swapped, entry)).result), '(g2) other bytes under the name')
        .toBe('carried-package-gate')

      const loose = pretty(story.packageBytes)
      const looseSha = await sha256Hex(loose)
      const looseStub = await newStub()
      const looseEntry: SnapshotEntry = {
        ...entry,
        packageSha256: looseSha,
        packagePath: expectedPackagePath({ storyId: ID, packageSha256: looseSha }, 'staging', ''),
      }
      looseStub.put('content', looseEntry.packagePath, loose, 'application/json')
      expect
        .soft(
          codeOf((await read(looseStub, looseEntry)).result),
          '(g2) a pretty-printed package under its own sha256 (requireJcs)',
        )
        .toBe('carried-package-gate')

      const phase1 = await withPackage(story, {
        ...story.pkg,
        nodes: story.pkg.nodes.map((node) => ({ ...node, image: null })),
        assets: [],
      } as StoryPackageV1)
      const p1Stub = await newStub()
      const p1 = await seed(p1Stub, phase1)
      expect
        .soft(codeOf((await read(p1Stub, p1.entry)).result), '(g2) a phase-1 package')
        .toBe('phase-1-package')

      const packageRead = `${READ}content/${entry.packagePath}`
      const refused = await newStub()
      await seed(refused, story)
      refused.override('GET', packageRead, { kind: 'answer', status: 401, body: '{}' })
      expect
        .soft(codeOf((await read(refused, entry)).result), '(g2) 401')
        .toBe('storage-unauthorized')
      refused.override('GET', packageRead, { kind: 'answer', status: 500, body: '{}' })
      expect.soft(codeOf((await read(refused, entry)).result), '(g2) 500').toBe('storage-failed')
    },
  )
})
