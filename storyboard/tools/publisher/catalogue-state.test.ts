// Step 14 (P1-8c) catalogue-state.ts: the catalogue state reader, seq allocation, staging
// composition, the document builder, the snapshot create with read-back and the pointer move
// (design migration-input/p1-step14-design.md §3.1 to §3.6, D13-1 to D13-6, D14-13, D14-14,
// D14-16, D14-19, D14-24, D14-27, TP-2, TP-13; test plan §14.6: T14-25 to T14-43).
// Every Storage call goes to the loopback stub through a real client built in the test with a fake
// key assembled at run time; a loopback guard on the global fetch refuses and counts any other
// host. Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
// Step 15a (P1-8d part a, design p1-step15a-design.md §14.8) adds T15A-25 to T15A-29: production
// composition, rollback composition and the production documents.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkPointer,
  checkSnapshot,
  expectedPackagePath,
  splitByApproval,
} from '../../src/core/content/gates'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import type { CatalogueSnapshot, WaiverKeys } from '../../src/core/package/catalogue'
import { makePointer, makeSnapshot } from '../../src/core/package/catalogue-build'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import * as catalogueState from './catalogue-state'
import {
  allocateSeq,
  buildProductionDocuments,
  buildStagingDocuments,
  composeProduction,
  composeRollback,
  composeStaging,
  createSnapshot,
  movePointer,
  readCatalogueState,
  type Composition,
  type ExpectedPointers,
} from './catalogue-state'
import { Secret } from './env'
import type { StagePort } from './port'
import { formatStopped } from './report'
import { buildTestStories, writeStageInputs } from './stage-testkit'
import { createStorageClient, type StorageClientOptions } from './storage'
import type { ContentReadRef, MasterReadRef, PointerMode } from './storage-layout'
import { expectNoUnexpected, startStorageStub, type StorageStub } from './storage-stub'
import { checkStory } from './story-checks'

// ---- shared material ----

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-catalogue-state-key'].join('_')
const NOW = '2026-11-21T10:00:00.000Z'
const LATER = '2026-11-21T10:05:00.000Z'
const COLLECTION = PANCHATANTRA_RULESET.collectionId
const LIST_PATH = '/storage/v1/object/list/content'
const pointerRead = (mode: PointerMode) =>
  `/storage/v1/object/authenticated/content/catalogue/${mode}.json`
const pointerWrite = (mode: PointerMode) => `/storage/v1/object/content/catalogue/${mode}.json`
const snapshotRead = (seq: number) =>
  `/storage/v1/object/authenticated/content/catalogue/snapshots/${seq}.json`
const snapshotWrite = (seq: number) => `/storage/v1/object/content/catalogue/snapshots/${seq}.json`
const MISSING = '{"statusCode":"404","error":"not_found","message":"Object not found"}'
const NONCE = /^\?cacheNonce=[1-9][0-9]{0,15}$/
const hex = (char: string) => char.repeat(64)

// ---- loopback guard (§14.1 "Network") ----

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0
const stubs: StorageStub[] = []
const temps: string[] = []

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
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
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

const clientOf = (stub: StorageStub, extra: Partial<StorageClientOptions> = {}) =>
  createStorageClient({ supabaseUrl: stub.origin, secretKey: new Secret(FAKE_KEY), ...extra })

/** A plain object forwarding the five methods and logging each call (§14.1 helpers). */
function recordingPort(port: StagePort, calls: string[]) {
  return {
    listContent: (folder: string) => {
      calls.push(`list ${folder}`)
      return port.listContent(folder)
    },
    readContent: (ref: ContentReadRef) => {
      calls.push(
        ref.kind === 'pointer'
          ? `read pointer ${ref.mode}`
          : ref.kind === 'snapshot'
            ? `read snapshot ${ref.seq}`
            : `read package ${ref.storyId}`,
      )
      return port.readContent(ref)
    },
    readMaster: (ref: MasterReadRef) => {
      calls.push(`master ${ref.kind}`)
      return port.readMaster(ref)
    },
    create: (ref: Parameters<StagePort['create']>[0], body: Uint8Array) => {
      calls.push(`create ${ref.kind}`)
      return port.create(ref, body)
    },
    writePointer: (mode: PointerMode, body: Uint8Array) => {
      calls.push(`write ${mode}`)
      return port.writePointer(mode, body)
    },
  }
}

type Hook = (url: URL, init: RequestInit) => Promise<Response | void> | Response | void
type AfterHook = (url: URL, init: RequestInit) => Promise<void> | void

/** A fetchImpl for a loopback client: `before` may answer instead; `after` runs once it landed. */
function wrapFetch(before?: Hook, after?: AfterHook): typeof fetch {
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

const isPost = (init: RequestInit, url: URL, pathname: string) =>
  init.method === 'POST' && url.pathname === pathname
const listPrefix = (init: RequestInit): string | null => {
  if (typeof init.body !== 'string') return null
  const parsed = JSON.parse(init.body) as { prefix?: unknown }
  return typeof parsed.prefix === 'string' ? parsed.prefix : null
}

function fakeClock(iso = NOW) {
  let t = Date.parse(iso)
  return { now: () => new Date(t), advance: (ms: number) => void (t += ms) }
}

const entry = (
  storyId: string,
  version = 1,
  packageSha256 = hex('a'),
  extra: Partial<SnapshotEntry> = {},
): SnapshotEntry => ({
  storyId,
  collectionId: COLLECTION,
  version,
  packagePath: expectedPackagePath({ storyId, packageSha256 }, 'staging', ''),
  packageSha256,
  ...extra,
})
const block = (fileChar: string, ruleSetRef = PANCHATANTRA_RULESET.ref): WaiverKeys => ({
  ruleSetRef,
  waiverFileSha256: hex(fileChar),
  keys: [],
})
const snapshotValue = (
  seq: number,
  stories: SnapshotEntry[] = [],
  featuredStoryId: string | null = null,
): CatalogueSnapshot => ({
  schemaVersion: '1.0',
  seq,
  createdAt: NOW,
  note: `test ${seq}`,
  featuredStoryId,
  stories,
})

async function storeSnapshot(
  stub: StorageStub,
  seq: number,
  stories: SnapshotEntry[] = [],
  featured: string | null = null,
) {
  const built = await makeSnapshot(snapshotValue(seq, stories, featured))
  stub.put('content', `catalogue/snapshots/${seq}.json`, built.bytes, 'application/json')
  return built
}
const pointerFor = (seq: number, snapshotSha256: string, updatedAt = NOW) =>
  makePointer({
    schemaVersion: '1.0',
    seq,
    snapshotPath: `catalogue/snapshots/${seq}.json`,
    snapshotSha256,
    updatedAt,
  })
async function storePointer(
  stub: StorageStub,
  mode: PointerMode,
  seq: number,
  snapshotSha256: string,
  updatedAt = NOW,
) {
  const built = await pointerFor(seq, snapshotSha256, updatedAt)
  stub.put('content', `catalogue/${mode}.json`, built.bytes, 'application/json')
  return built
}
const putRaw = (stub: StorageStub, path: string, bytes: Uint8Array) =>
  stub.put('content', path, bytes, 'application/json')

/** T14-26's state: snapshots 1, 3, 4, 5, 6; production → 3, staging → 4. */
async function presentState(stub: StorageStub) {
  const snaps = new Map<number, Awaited<ReturnType<typeof storeSnapshot>>>()
  for (const seq of [1, 3, 4, 5, 6]) {
    snaps.set(seq, await storeSnapshot(stub, seq, [entry(`story-${seq}`, seq)]))
  }
  const production = await storePointer(stub, 'production', 3, snaps.get(3)!.sha256)
  const staging = await storePointer(stub, 'staging', 4, snaps.get(4)!.sha256)
  return { snaps, production, staging }
}

/** The movePointer plan state: snapshots 3, 4 and N = 5; production → 3, staging → 4. */
async function planState(
  stub: StorageStub,
  with_: { production?: boolean; staging?: boolean } = {},
) {
  const s3 = await storeSnapshot(stub, 3)
  const s4 = await storeSnapshot(stub, 4)
  const s5 = await storeSnapshot(stub, 5)
  const production =
    with_.production === false ? null : await storePointer(stub, 'production', 3, s3.sha256)
  const staging = with_.staging === false ? null : await storePointer(stub, 'staging', 4, s4.sha256)
  const next = await pointerFor(5, s5.sha256, LATER)
  const expected: ExpectedPointers = {
    production: production?.sha256 ?? null,
    staging: staging?.sha256 ?? null,
  }
  return { s3, s4, s5, expected, built: { seq: 5, bytes: next.bytes, sha256: next.sha256 } }
}

const posts = (stub: StorageStub, pathname: string) =>
  stub.requests.filter((r) => r.method === 'POST' && r.pathname === pathname)
const gets = (stub: StorageStub, pathname: string) =>
  stub.requests.filter((r) => r.method === 'GET' && r.pathname === pathname)
const shaOf = async (bytes: Uint8Array | undefined) =>
  bytes === undefined ? null : sha256Hex(new Uint8Array(bytes))
const stateOf = async (stub: StorageStub, extra: Partial<StorageClientOptions> = {}) =>
  readCatalogueState(clientOf(stub, extra))
const codeOf = (result: { ok: boolean; code?: string }) => (result.ok ? 'ok' : result.code)
const answer = (status: number, body = '{}') => ({ kind: 'answer' as const, status, body })

// ---- readCatalogueState (A13, A14) ----

describe('readCatalogueState', () => {
  it('T14-25 empty bucket: one listing, then both pointers read with a fresh nonce; absent because list and read agree; N = 1', async () => {
    const stub = await newStub()
    const calls: string[] = []
    const result = await readCatalogueState(recordingPort(clientOf(stub), calls))
    expect(result.ok, 'precondition: the empty state reads').toBe(true)
    expect.soft(calls[0], '(g1) the catalogue listing first').toBe('list catalogue/')
    expect
      .soft([...calls.slice(1)].sort(), '(g1) then the two pointer reads, either order')
      .toEqual(['read pointer production', 'read pointer staging'])
    const pointerGets = stub.requests.filter((r) => r.method === 'GET')
    expect
      .soft(pointerGets.map((r) => r.pathname).sort(), '(g2) one GET per pointer')
      .toEqual([pointerRead('production'), pointerRead('staging')])
    for (const request of pointerGets) {
      expect.soft(request.search, `(g2) a nonce on ${request.pathname}`).toMatch(NONCE)
    }
    const nonces = pointerGets.map((r) => Number(r.search.slice('?cacheNonce='.length)))
    expect.soft((nonces[1] ?? 0) > (nonces[0] ?? 0), '(g2) the nonces strictly increase').toBe(true)
    const state = result.ok ? result.state : null
    expect.soft(state?.production, '(g3) production absent').toBeNull()
    expect.soft(state?.staging, '(g3) staging absent').toBeNull()
    expect.soft(state ? allocateSeq(state) : null, '(g3) N = 1').toEqual({ ok: true, seq: 1 })
  })

  it('T14-26 present state: both pointers and snapshots pass the build gates; orphans are seqs above the higher pointer, gaps are missing seqs (CRIT-16)', async () => {
    const stub = await newStub()
    const { snaps, production, staging } = await presentState(stub)
    const result = await stateOf(stub)
    const state = result.ok ? result.state : null
    expect.soft(state?.production?.snapshot.seq, '(g1) production snapshot 3').toBe(3)
    expect.soft(state?.staging?.snapshot.seq, '(g1) staging snapshot 4').toBe(4)
    expect
      .soft(state?.production?.snapshotSha256, '(g1) production snapshot sha256')
      .toBe(snaps.get(3)!.sha256)
    expect
      .soft(state?.staging?.snapshotSha256, '(g1) staging snapshot sha256')
      .toBe(snaps.get(4)!.sha256)
    expect.soft(state?.production?.sha256, '(g1) production pointer sha256').toBe(production.sha256)
    expect.soft(state?.staging?.sha256, '(g1) staging pointer sha256').toBe(staging.sha256)
    const snapshotGets = stub.requests.filter(
      (r) => r.method === 'GET' && r.pathname.includes('/snapshots/'),
    )
    expect
      .soft(snapshotGets.map((r) => r.pathname).sort(), '(g1) the two snapshot GETs')
      .toEqual([snapshotRead(3), snapshotRead(4)])
    for (const request of snapshotGets) {
      expect.soft(request.search, `(g1) no search on ${request.pathname}`).toBe('')
    }
    expect.soft(state?.orphans, '(g2) orphans 5 and 6').toEqual([5, 6])
    expect.soft(state?.gaps, '(g2) one gap (2)').toBe(1)
  })

  it('T14-27 an unknown object under catalogue/ stops the run before any pointer read (L16)', async () => {
    const base = async (stub: StorageStub) => {
      const s2 = await storeSnapshot(stub, 2)
      await storePointer(stub, 'production', 2, s2.sha256)
    }
    const clean = await newStub()
    await base(clean)
    expect(codeOf(await stateOf(clean)), 'precondition: the clean state reads').toBe('ok')
    const unknown = [
      'catalogue/snapshots/01.json',
      'catalogue/snapshots/0.json',
      'catalogue/snapshots/1.JSON',
      'catalogue/snapshots/12345678901234567.json',
      'catalogue/snapshots/9007199254740993.json',
      'catalogue/snapshots/1.json/x',
      'catalogue/Production.json',
      'catalogue/production.json.bak',
      'catalogue/x.txt',
    ]
    for (const path of unknown) {
      const stub = await newStub()
      await base(stub)
      putRaw(stub, path, new TextEncoder().encode('{}'))
      const calls: string[] = []
      const result = await readCatalogueState(recordingPort(clientOf(stub), calls))
      expect.soft(codeOf(result), `(g1) ${path}`).toBe('catalogue-unknown-object')
      expect.soft(calls, `(g2) no read follows ${path}`).toEqual(['list catalogue/'])
    }
  })

  it('T14-28 pointer and snapshot consistency (A13, L16, TP-2)', async () => {
    const clean = await newStub()
    await presentState(clean)
    expect(codeOf(await stateOf(clean)), "precondition: T14-26's state reads").toBe('ok')
    const sample = async (
      label: string,
      want: string,
      group: string,
      change: (stub: StorageStub, base: Awaited<ReturnType<typeof presentState>>) => Promise<void>,
    ) => {
      const stub = await newStub()
      const base = await presentState(stub)
      await change(stub, base)
      expect.soft(codeOf(await stateOf(stub)), `(${group}) ${label}`).toBe(want)
    }
    await sample('listed pointer read not-found', 'pointer-state-inconsistent', 'g1', async (s) => {
      s.override('GET', pointerRead('production'), answer(400, MISSING))
    })
    await sample('pointer found but not listed', 'pointer-state-inconsistent', 'g1', async (s) => {
      const listed = [
        { name: 'snapshots', id: null, updated_at: null, metadata: null },
        {
          name: 'staging.json',
          id: 'stub-listed-staging',
          updated_at: NOW,
          metadata: { size: 1, mimetype: 'application/json', cacheControl: null },
        },
      ]
      s.override('POST', LIST_PATH, answer(200, JSON.stringify(listed)))
    })
    await sample('pointer seq 7 not listed', 'snapshot-missing', 'g2', async (s) => {
      await storePointer(s, 'production', 7, hex('c'))
    })
    await sample('seq 5 naming snapshots/4.json', 'pointer-gate', 'g3', async (s, b) => {
      const bytes = jcsBytes({
        schemaVersion: '1.0',
        seq: 5,
        snapshotPath: 'catalogue/snapshots/4.json',
        snapshotSha256: b.snaps.get(4)!.sha256,
        updatedAt: NOW,
      })
      putRaw(s, 'catalogue/production.json', bytes)
    })
    await sample('a non-JCS pointer', 'pointer-gate', 'g3', async (s, b) => {
      const value = (await pointerFor(3, b.snaps.get(3)!.sha256)).value
      putRaw(
        s,
        'catalogue/production.json',
        new TextEncoder().encode(JSON.stringify(value, null, 1)),
      )
    })
    await sample(
      'a snapshot sha256 other than the pointer names',
      'snapshot-gate',
      'g4',
      async (s) => {
        await storePointer(s, 'production', 3, hex('d'))
      },
    )
    await sample('a snapshot seq other than the pointer seq', 'snapshot-gate', 'g4', async (s) => {
      const other = await makeSnapshot(snapshotValue(9))
      putRaw(s, 'catalogue/snapshots/3.json', other.bytes)
      await storePointer(s, 'production', 3, other.sha256)
    })
    await sample('a non-JCS snapshot', 'snapshot-gate', 'g4', async (s) => {
      const bytes = new TextEncoder().encode(JSON.stringify(snapshotValue(3), null, 1))
      putRaw(s, 'catalogue/snapshots/3.json', bytes)
      await storePointer(s, 'production', 3, await sha256Hex(bytes))
    })
    await sample('duplicate storyIds', 'snapshot-gate', 'g5', async (s) => {
      const dup = await storeSnapshot(s, 3, [entry('twice-told'), entry('twice-told', 2)])
      await storePointer(s, 'production', 3, dup.sha256)
    })
    await sample('a fixtures-form packagePath', 'snapshot-gate', 'g5', async (s) => {
      const fixtures = entry('old-form', 1, hex('a'), { packagePath: 'packages/old-form.json' })
      const snap = await storeSnapshot(s, 3, [fixtures])
      await storePointer(s, 'production', 3, snap.sha256)
    })
  })

  it('T14-29 read failures map to storage-unauthorized or storage-failed (L16)', async () => {
    const clean = await newStub()
    await presentState(clean)
    expect(codeOf(await stateOf(clean)), 'precondition: the clean state reads').toBe('ok')
    const sample = async (
      label: string,
      want: string,
      group: string,
      change: (stub: StorageStub) => void,
      extra: Partial<StorageClientOptions> = {},
    ) => {
      const stub = await newStub()
      await presentState(stub)
      change(stub)
      expect.soft(codeOf(await stateOf(stub, extra)), `(${group}) ${label}`).toBe(want)
    }
    const denied = (status: number) =>
      answer(status, JSON.stringify({ statusCode: String(status), error: 'Unauthorized' }))
    await sample('listing 401', 'storage-unauthorized', 'g1', (s) =>
      s.override('POST', LIST_PATH, denied(401)),
    )
    await sample('listing 403', 'storage-unauthorized', 'g1', (s) =>
      s.override('POST', LIST_PATH, denied(403)),
    )
    await sample('pointer GET 401', 'storage-unauthorized', 'g1', (s) =>
      s.override('GET', pointerRead('production'), denied(401)),
    )
    await sample('snapshot GET 403', 'storage-unauthorized', 'g1', (s) =>
      s.override('GET', snapshotRead(4), denied(403)),
    )
    await sample('listing 500', 'storage-failed', 'g2', (s) =>
      s.override('POST', LIST_PATH, answer(500, '{"statusCode":"500","error":"x"}')),
    )
    await sample('an unsafe name in the listing', 'storage-failed', 'g2', (s) =>
      putRaw(s, 'catalogue/.emptyFolderPlaceholder', new Uint8Array([1])),
    )
    const folders = Array.from({ length: 10_001 }, (_, i) => ({
      name: `f${i}`,
      id: null,
      updated_at: null,
      metadata: null,
    }))
    await sample(
      'one page of 10,001 entries',
      'storage-failed',
      'g2',
      (s) => s.override('POST', LIST_PATH, answer(200, JSON.stringify(folders))),
      { listPageSize: 10_001 },
    )
    await sample('pointer GET 500', 'storage-failed', 'g2', (s) =>
      s.override('GET', pointerRead('staging'), answer(500, '{"statusCode":"500"}')),
    )
    await sample('a truncated snapshot body', 'storage-failed', 'g2', (s) =>
      s.override('GET', snapshotRead(3), { kind: 'truncate', declared: 400, sent: 10 }),
    )
    const overCap = new Uint8Array(1024 * 1024 + 1).fill(0x20)
    await sample('a pointer body over the cap', 'storage-failed', 'g3', (s) =>
      s.override('GET', pointerRead('production'), {
        kind: 'answer',
        status: 200,
        body: overCap,
      }),
    )
    await sample('a snapshot body over the cap', 'storage-failed', 'g3', (s) =>
      s.override('GET', snapshotRead(4), { kind: 'answer', status: 200, body: overCap }),
    )
  })

  it('T14-30 allocateSeq: 1 + the highest listed seq, orphans included; seq-exhausted past MAX_SAFE (A14)', async () => {
    const listed = await newStub()
    for (const seq of [1, 2, 7]) await storeSnapshot(listed, seq)
    const two = (await makeSnapshot(snapshotValue(2))).sha256
    await storePointer(listed, 'production', 2, two)
    await storePointer(listed, 'staging', 2, two)
    const empty = await newStub()
    const top = await newStub()
    putRaw(top, 'catalogue/snapshots/9007199254740991.json', new Uint8Array([1]))
    const states = await Promise.all([stateOf(listed), stateOf(empty), stateOf(top)])
    expect(
      states.map((s) => s.ok),
      'precondition: three states built',
    ).toEqual([true, true, true])
    const [a, b, c] = states.map((s) => (s.ok ? allocateSeq(s.state) : null))
    expect.soft(a, '(g1) listed {1, 2, 7}, pointers at 2 → 8').toEqual({ ok: true, seq: 8 })
    expect.soft(b, '(g2) none → 1').toEqual({ ok: true, seq: 1 })
    expect.soft(c, '(g3) 9007199254740991 listed').toEqual({ ok: false, code: 'seq-exhausted' })
  })
})

// ---- composition (A15) ----

const compose = (
  production: CatalogueSnapshot | null,
  staging: CatalogueSnapshot | null,
  named: SnapshotEntry[],
) => composeStaging({ production, staging, named })
const ids = (composition: Composition | null) => composition?.stories.map((s) => s.storyId)
const composed = (result: ReturnType<typeof composeStaging>) =>
  result.ok ? result.composition : null
const jcs = (value: unknown) => new TextDecoder().decode(jcsBytes(value))
/** The entry without approvalSha256 (the fields a new staging entry may hold). */
const withoutApproval = (e: SnapshotEntry): SnapshotEntry => {
  const copy = { ...e }
  delete copy.approvalSha256
  return copy
}

describe('composeStaging', () => {
  it('T14-31 composition: production snapshot.stories in order, candidates and named in place, appended entries in UTF-16 order (A15, D13-5, L18, CRIT-16)', () => {
    const pair = ['story-9', 'story-10']
    expect([...pair].sort(), 'precondition: code-unit order puts story-10 first').toEqual([
      'story-10',
      'story-9',
    ])
    expect(
      [...pair].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })),
      'precondition: a numeric collation differs',
    ).toEqual(['story-9', 'story-10'])
    const p1 = entry('p-one', 1, hex('1'), { approvalSha256: hex('a') })
    const p2 = entry('p-two', 1, hex('2'), { approvalSha256: hex('a') })
    const p3 = entry('p-three', 1, hex('3'))
    const candidate = entry('p-two', 2, hex('4'))
    const newP3 = entry('p-three', 2, hex('5'))
    const n1 = entry('n-one', 1, hex('6'))
    const n2 = entry('n-two', 1, hex('7'))
    const production = snapshotValue(3, [p1, p2, p3])
    const staging = snapshotValue(4, [p1, candidate, p3])
    const one = composed(compose(production, staging, [n2, newP3, n1]))
    expect
      .soft(
        one?.stories.map((s) => [s.storyId, s.packageSha256]),
        '(g1) the composed order',
      )
      .toEqual([
        ['p-one', hex('1')],
        ['p-two', hex('4')],
        ['p-three', hex('5')],
        ['n-one', hex('6')],
        ['n-two', hex('7')],
      ])
    const two = composed(compose(null, null, [entry('story-9'), entry('story-10')]))
    expect.soft(ids(two), '(g2) appended in code-unit order').toEqual(['story-10', 'story-9'])
    const three = composed(
      compose(
        null,
        snapshotValue(2, [entry('c-bee', 1, hex('b')), entry('c-ant', 1, hex('c'))]),
        [],
      ),
    )
    expect
      .soft(ids(three), '(g3) production absent: candidates appended')
      .toEqual(['c-ant', 'c-bee'])
  })

  it('T14-32 states in-production, unchanged and superseded; the no-op (A15, CRIT-2, CRIT-15)', () => {
    const x = entry('x-tale', 2, hex('1'), { approvalSha256: hex('a'), waivers: block('f') })
    expect(x.approvalSha256, "precondition: production's entry for X has approvalSha256").toBe(
      hex('a'),
    )
    const xUnapproved = withoutApproval(x)
    const production = snapshotValue(3, [x], 'x-tale')
    const one = composed(compose(production, null, [xUnapproved]))
    expect.soft(one?.named[0]?.state, '(g1) in-production').toBe('in-production')
    expect
      .soft(jcs(one?.stories[0]), "(g1) production's entry kept, approval included")
      .toBe(jcs(x))

    const candidate = entry('y-tale', 1, hex('2'))
    const staging = snapshotValue(4, [x, candidate], 'x-tale')
    const two = composed(compose(production, staging, [candidate]))
    expect
      .soft(two?.named[0]?.state, '(g2) named equal to the candidate: unchanged')
      .toBe('unchanged')
    expect.soft(two?.unchanged, '(g2) equal to the staging snapshot: outcome unchanged').toBe(true)
    const otherFeatured = composed(compose(production, { ...staging, featuredStoryId: null }, []))
    expect
      .soft(otherFeatured?.unchanged, '(g2) differing only in featuredStoryId is not unchanged')
      .toBe(false)

    const approvedOther = entry('x-tale', 3, hex('3'), { approvalSha256: hex('b') })
    const approvedLone = entry('z-tale', 1, hex('4'), { approvalSha256: hex('b') })
    const higher = entry('x-tale', 4, hex('5'))
    const three = composed(compose(production, snapshotValue(5, [approvedOther, approvedLone]), []))
    expect
      .soft(
        three?.carried.map((c) => [c.storyId, c.state]),
        '(g3) approved staging entries superseded',
      )
      .toEqual([
        ['x-tale', 'superseded'],
        ['z-tale', 'superseded'],
      ])
    expect.soft(ids(three), '(g3) dropped from the composition').toEqual(['x-tale'])
    const threeB = composed(compose(production, snapshotValue(5, [higher]), []))
    expect
      .soft(
        threeB?.carried.map((c) => [c.storyId, c.state]),
        '(g3) an unapproved higher version',
      )
      .toEqual([['x-tale', 'candidate']])

    const p3 = entry('w-tale', 3, hex('6'))
    const lower = entry('w-tale', 2, hex('7'))
    const equal = entry('w-tale', 3, hex('8'))
    for (const [label, staged] of [
      ['v2 under production v3', lower],
      ['v3 with another sha', equal],
    ] as const) {
      const four = composed(compose(snapshotValue(3, [p3]), snapshotValue(4, [staged]), []))
      expect
        .soft(
          four?.carried.map((c) => c.state),
          `(g4) superseded: ${label}`,
        )
        .toEqual(['superseded'])
      expect
        .soft(
          four?.stories.map((s) => s.packageSha256),
          `(g4) production kept: ${label}`,
        )
        .toEqual([hex('6')])
    }
  })

  it('T14-33 same package, another waiver block: waivers-changed-same-package (CRIT-2)', () => {
    const prodX = entry('x-tale', 1, hex('1'), { approvalSha256: hex('a'), waivers: block('f') })
    const candX = entry('x-tale', 2, hex('2'), { waivers: block('f') })
    expect(prodX.waivers?.waiverFileSha256, 'precondition: both carry the block of file F1').toBe(
      candX.waivers?.waiverFileSha256,
    )
    const production = snapshotValue(3, [prodX])
    const staging = snapshotValue(4, [prodX, candX])
    const refused = { ok: false, code: 'waivers-changed-same-package', storyId: 'x-tale' }
    const f2 = { ...block('e'), keys: [] }
    const prodShape = withoutApproval(prodX)
    expect
      .soft(
        compose(production, staging, [{ ...prodShape, waivers: f2 }]),
        '(g1) against production',
      )
      .toEqual(refused)
    expect
      .soft(compose(production, staging, [{ ...candX, waivers: f2 }]), '(g1) against the candidate')
      .toEqual(refused)
    const sameKeysOtherFile: WaiverKeys = { ...block('f'), waiverFileSha256: hex('9') }
    expect
      .soft(
        compose(production, null, [{ ...prodShape, waivers: sameKeysOtherFile }]),
        '(g2) same keys, another waiverFileSha256',
      )
      .toEqual(refused)
    const oldRule = entry('x-tale', 1, hex('1'), {
      approvalSha256: hex('a'),
      waivers: block('f', 'panchatantra@2.0.0'),
    })
    expect
      .soft(
        compose(snapshotValue(3, [oldRule]), null, [{ ...prodShape, waivers: block('f') }]),
        "(g3) production's block on panchatantra@2.0.0",
      )
      .toEqual(refused)
  })

  it('T14-34 version rule against production only (A5, L18, TP-6)', () => {
    const production = snapshotValue(3, [entry('x-tale', 2, hex('1'))])
    expect(production.stories[0]?.version, 'precondition: production X v2').toBe(2)
    const refused = { ok: false, code: 'version-not-increased', storyId: 'x-tale' }
    expect
      .soft(compose(production, null, [entry('x-tale', 2, hex('2'))]), '(g1) v2 with another sha')
      .toEqual(refused)
    expect
      .soft(compose(production, null, [entry('x-tale', 1, hex('3'))]), '(g1) v1')
      .toEqual(refused)
    const v3 = composed(compose(production, null, [entry('x-tale', 3, hex('4'))]))
    expect.soft(v3?.named[0]?.state, '(g2) v3 is new').toBe('new')
    const staging = snapshotValue(4, [entry('x-tale', 5, hex('5'))])
    const v4 = composed(compose(production, staging, [entry('x-tale', 4, hex('6'))]))
    expect
      .soft(
        v4?.stories.map((s) => [s.version, s.packageSha256]),
        '(g3) v4 replaces candidate v5',
      )
      .toEqual([[4, hex('6')]])
    const fresh = composed(compose(production, null, [entry('y-tale', 1, hex('7'))]))
    expect.soft(fresh?.named[0]?.state, '(g4) a story not in production at v1 is new').toBe('new')
  })

  it('T14-35 entry fields, note, clock and featured (A15, D13-6, L18)', async () => {
    const root = mkdtempSync(join(tmpdir(), 's14-cs-'))
    temps.push(root)
    const stories = await buildTestStories()
    const dirs = writeStageInputs(root, stories)
    const local = await checkStory(stories[0]!.storyId, { ...dirs, privateData: null })
    expect(local.entry, 'precondition: the testkit story passes the local checks').not.toBeNull()
    const now = new Date(NOW)
    expect(now.toISOString(), 'precondition: now').toBe(NOW)
    const fresh = composed(compose(null, null, [local.entry!]))
    const made = fresh?.stories[0]
    expect
      .soft(Object.keys(made ?? {}).sort(), '(g1) exactly the six fields')
      .toEqual(['collectionId', 'packagePath', 'packageSha256', 'storyId', 'version', 'waivers'])
    expect.soft(made?.waivers?.keys, '(g1) keys [] for a zero-record file').toEqual([])
    expect.soft(made && 'approvalSha256' in made, '(g1) no approvalSha256').toBe(false)
    expect
      .soft(made?.packagePath, '(g1) the staging packagePath')
      .toBe(
        expectedPackagePath(
          { storyId: made!.storyId, packageSha256: made!.packageSha256 },
          'staging',
          '',
        ),
      )

    const prodA = entry('a-tale', 1, hex('1'), { approvalSha256: hex('a'), waivers: block('f') })
    const prodB = entry('b-tale', 1, hex('2'), { approvalSha256: hex('b') })
    const cand = entry('c-tale', 1, hex('3'), { waivers: block('e') })
    const production = snapshotValue(3, [prodA, prodB], 'b-tale')
    const carried = composed(
      compose(production, snapshotValue(4, [prodA, prodB, cand]), [entry('d-tale')]),
    )
    for (const source of [prodA, prodB, cand]) {
      const kept = carried?.stories.find((s) => s.storyId === source.storyId)
      expect.soft(jcs(kept), `(g2) carried JCS-equal: ${source.storyId}`).toBe(jcs(source))
    }
    expect.soft(carried?.featuredStoryId, "(g3) production's featured").toBe('b-tale')
    expect
      .soft(
        composed(compose(null, null, [entry('d-tale')]))?.featuredStoryId,
        '(g3) null without production',
      )
      .toBeNull()
    const restaged = composed(compose(production, null, [entry('b-tale', 2, hex('9'))]))
    expect.soft(restaged?.featuredStoryId, '(g3) kept when its story is restaged').toBe('b-tale')
    const noted = composed(
      compose(null, null, [entry('zeta-tale'), entry('alpha-tale'), entry('mid-tale')]),
    )
    expect
      .soft(noted?.note, '(g4) the note: named ids sorted')
      .toBe('publisher stage: alpha-tale mid-tale zeta-tale')
    const documents = noted ? await buildStagingDocuments(noted, 1, now) : null
    expect
      .soft(documents?.ok ? documents.documents.snapshot.value.createdAt : null, '(g4) createdAt')
      .toBe(NOW)
  })

  it('T14-36 documents: makeSnapshot, makePointer, then the four checks; any failure is plan-gate (A19, TP-13)', async () => {
    const base = composed(
      compose(snapshotValue(3, [entry('p-one', 1, hex('1'))]), null, [entry('n-one', 1, hex('2'))]),
    )
    expect(base, "precondition: T14-31's kind of composition builds").not.toBeNull()
    const built = await buildStagingDocuments(base!, 6, new Date(NOW))
    const documents = built.ok ? built.documents : null
    const pointerOk = documents
      ? checkPointer(documents.pointer.bytes, { mode: 'staging', root: '' })
      : null
    expect.soft(pointerOk?.ok, '(g1) the pointer passes checkPointer').toBe(true)
    const snapshotOk = documents
      ? await checkSnapshot(documents.snapshot.bytes, documents.pointer.value, 'staging')
      : null
    expect.soft(snapshotOk?.ok, '(g1) the snapshot passes checkSnapshot').toBe(true)
    expect
      .soft(documents?.pointer.value.snapshotSha256, '(g1) the pointer names the snapshot sha256')
      .toBe(documents ? await sha256Hex(documents.snapshot.bytes) : 'none')
    expect.soft(documents?.pointer.value.seq, '(g1) pointer seq N').toBe(6)
    expect.soft(documents?.snapshot.value.seq, '(g1) snapshot seq N').toBe(6)
    const hostile = (stories: SnapshotEntry[]) =>
      buildStagingDocuments({ featuredStoryId: null, stories, note: 'x' }, 6, new Date(NOW))
    expect
      .soft(
        codeOf(await hostile([entry('twice-told'), entry('twice-told', 2)])),
        '(g2) duplicate storyIds',
      )
      .toBe('plan-gate')
    expect
      .soft(
        codeOf(
          await hostile([
            entry('old-form', 1, hex('a'), { packagePath: 'packages/old-form.json' }),
          ]),
        ),
        '(g2) a fixtures-form packagePath',
      )
      .toBe('plan-gate')
  })
})

// ---- Step 15a (P1-8d part a): production composition, rollback, the production documents ----
// (design migration-input/p1-step15a-design.md §3.9, §3.13, D15-9, D15-12, D15-13; §14.8)

const composeP = (
  production: CatalogueSnapshot | null,
  named: { entry: SnapshotEntry; approvalSha256: string | null }[],
  feature?: string | null,
) => composeProduction({ production, named, feature })
const pcomposed = (result: ReturnType<typeof composeProduction>) =>
  result.ok ? result.composition : null
const approved = (storyId: string, version: number, sha: string, approval = hex('e')) =>
  entry(storyId, version, sha, { approvalSha256: approval })

describe('composeProduction, composeRollback and buildProductionDocuments (Step 15a)', () => {
  it('T15A-25 composeProduction: production plus the named entries only, replaced in place or appended in UTF-16 order, each with its approvalSha256; staged candidates never carried (A9, D15-9)', () => {
    const pair = ['story-9', 'story-10']
    expect([...pair].sort(), 'precondition: code-unit order puts story-10 first').toEqual([
      'story-10',
      'story-9',
    ])
    expect(
      [...pair].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })),
      'precondition: a numeric collation puts story-9 first',
    ).toEqual(['story-9', 'story-10'])
    const river = approved('river-stones', 1, hex('1'))
    const two = approved('two-paths', 1, hex('2'))
    const production = snapshotValue(3, [river, two])
    expect(
      production.stories.every((s) => s.approvalSha256 !== undefined),
      'precondition: both production entries approved',
    ).toBe(true)
    const lantern = entry('lantern-walk', 1, hex('3'))
    const staging = snapshotValue(4, [river, two, lantern])
    expect(
      staging.stories.some((s) => s.storyId === 'lantern-walk'),
      'precondition: staging holds the candidate lantern-walk, not named',
    ).toBe(true)
    const riverV2 = entry('river-stones', 2, hex('4'), { waivers: block('f') })
    const story9 = entry('story-9', 1, hex('5'))
    const story10 = entry('story-10', 1, hex('6'))
    const named = [
      { entry: riverV2, approvalSha256: hex('a') },
      { entry: story9, approvalSha256: hex('b') },
      { entry: story10, approvalSha256: hex('c') },
    ]
    // The state-shaped input also carries staging: composeProduction must not read it.
    const input: Parameters<typeof composeProduction>[0] & { staging: CatalogueSnapshot } = {
      production,
      staging,
      named,
      feature: undefined,
    }
    const result = pcomposed(composeProduction(input))
    expect(result, 'precondition: the composition succeeds').not.toBeNull()
    // (g1) the order
    expect
      .soft(
        result?.stories.map((s) => [s.storyId, s.packageSha256]),
        '(g1) river-stones v2 in place, two-paths kept, story-10 then story-9 appended',
      )
      .toEqual([
        ['river-stones', hex('4')],
        ['two-paths', hex('2')],
        ['story-10', hex('6')],
        ['story-9', hex('5')],
      ])
    // (g2) newEntry's key set plus approvalSha256, with its own A
    for (const { entry: staged, approvalSha256 } of named) {
      const made = result?.stories.find((s) => s.storyId === staged.storyId)
      expect
        .soft(Object.keys(made ?? {}).sort(), `(g2) key set ${staged.storyId}`)
        .toEqual([...Object.keys(staged), 'approvalSha256'].sort())
      expect
        .soft(made?.approvalSha256, `(g2) own approvalSha256 ${staged.storyId}`)
        .toBe(approvalSha256)
    }
    // (g3) the staged candidate is not carried
    expect
      .soft(
        result?.stories.some((s) => s.storyId === 'lantern-walk'),
        '(g3) lantern-walk not in N+1',
      )
      .toBe(false)
    // (g4) the named states
    expect
      .soft(
        result?.named.map((n) => [n.storyId, n.state]),
        '(g4) replaced, new, new',
      )
      .toEqual([
        ['river-stones', 'replaced'],
        ['story-9', 'new'],
        ['story-10', 'new'],
      ])
  })

  it('T15A-26 composeProduction states and refusals: in-production keeps production bytes, same package with another block, version-not-increased by unit call only, an unapproved base entry; the first publish (A9, CRIT-11)', () => {
    const p = entry('x-tale', 2, hex('1'), { approvalSha256: hex('a'), waivers: block('f') })
    const production = snapshotValue(3, [p])
    expect(composeP(production, []).ok, 'precondition: production alone composes').toBe(true)
    // (g1) in-production: P kept byte for byte, its approvalSha256 too
    const one = pcomposed(
      composeP(production, [{ entry: withoutApproval(p), approvalSha256: hex('b') }]),
    )
    expect.soft(one?.named[0]?.state, '(g1) in-production').toBe('in-production')
    expect.soft(jcs(one?.stories[0]), "(g1) production's bytes kept").toBe(jcs(p))
    expect
      .soft(one?.stories[0]?.approvalSha256, "(g1) production's approvalSha256 kept")
      .toBe(hex('a'))
    // (g2) same package, another block
    expect
      .soft(
        composeP(production, [
          {
            entry: { ...withoutApproval(p), version: 3, waivers: block('e') },
            approvalSha256: hex('b'),
          },
        ]),
        '(g2) same package, another block',
      )
      .toEqual({ ok: false, code: 'waivers-changed-same-package', storyId: 'x-tale' })
    // (g3) the defensive version rule
    const refused = { ok: false, code: 'version-not-increased', storyId: 'x-tale' }
    expect
      .soft(
        composeP(production, [{ entry: entry('x-tale', 2, hex('2')), approvalSha256: hex('b') }]),
        '(g3) same version with another sha',
      )
      .toEqual(refused)
    expect
      .soft(
        composeP(production, [{ entry: entry('x-tale', 1, hex('3')), approvalSha256: hex('b') }]),
        '(g3) a lower version',
      )
      .toEqual(refused)
    // (g4) an unapproved base entry
    const unapprovedBase = snapshotValue(3, [p, entry('y-tale', 1, hex('4'))])
    expect
      .soft(
        composeP(unapprovedBase, [
          { entry: entry('z-tale', 1, hex('5')), approvalSha256: hex('b') },
        ]),
        '(g4) a base entry without approvalSha256',
      )
      .toEqual({ ok: false, code: 'production-entry-unapproved', storyId: 'y-tale' })
    // (g5) the first publish
    const first = pcomposed(
      composeP(null, [
        { entry: entry('story-9', 1, hex('6')), approvalSha256: hex('b') },
        { entry: entry('story-10', 1, hex('7')), approvalSha256: hex('c') },
      ]),
    )
    expect
      .soft(
        first?.stories.map((s) => s.storyId),
        '(g5) no production: the named entries in code-unit order',
      )
      .toEqual(['story-10', 'story-9'])
    expect.soft(first?.unchanged, '(g5) not unchanged').toBe(false)
  })

  it('T15A-27 composeProduction featured, note and unchanged (A9, D15-12)', () => {
    const a = approved('a-b', 1, hex('1'))
    const c = approved('c-d', 1, hex('2'))
    const production = snapshotValue(3, [a, c], 'c-d')
    expect(production.featuredStoryId, "precondition: production's featured is c-d").toBe('c-d')
    const inProd = [
      { entry: withoutApproval(c), approvalSha256: null },
      { entry: withoutApproval(a), approvalSha256: null },
    ]
    // (g1) featured
    expect
      .soft(pcomposed(composeP(production, []))?.featuredStoryId, "(g1) no flag: production's")
      .toBe('c-d')
    expect
      .soft(pcomposed(composeP(production, [], 'a-b'))?.featuredStoryId, '(g1) a flag id')
      .toBe('a-b')
    expect
      .soft(pcomposed(composeP(production, [], null))?.featuredStoryId, '(g1) none: null')
      .toBeNull()
    // (g2) notes, named ids sorted
    expect
      .soft(pcomposed(composeP(production, inProd))?.note, '(g2) named ids sorted')
      .toBe('publisher publish: a-b c-d')
    expect
      .soft(pcomposed(composeP(production, inProd, null))?.note, '(g2) with feature=none')
      .toBe('publisher publish: a-b c-d feature=none')
    expect
      .soft(pcomposed(composeP(production, [], 'a-b'))?.note, '(g2) a flag alone')
      .toBe('publisher publish: feature=a-b')
    // (g3) unchanged
    expect
      .soft(pcomposed(composeP(production, inProd))?.unchanged, '(g3) all in production, no flag')
      .toBe(true)
    expect
      .soft(
        pcomposed(composeP(production, inProd, 'c-d'))?.unchanged,
        "(g3) the flag equals production's",
      )
      .toBe(true)
    expect
      .soft(
        pcomposed(composeP(production, inProd, 'a-b'))?.unchanged,
        '(g3) a flag that changes it',
      )
      .toBe(false)
    expect
      .soft(pcomposed(composeP(null, []))?.unchanged, '(g3) never without production')
      .toBe(false)
  })

  it('T15A-28 composeRollback: <seq> stories byte for byte, its featured id or the flag, the note, and unchanged by content (A15, CRIT-6)', () => {
    const b = approved('bee-tale', 1, hex('1'))
    const a = approved('ant-tale', 1, hex('2'))
    const three = snapshotValue(3, [b, a], 'bee-tale')
    expect(
      three.stories.map((s) => s.storyId),
      'precondition: <seq> is not in code-unit order',
    ).not.toEqual(three.stories.map((s) => s.storyId).sort())
    const production = snapshotValue(5, [approved('ant-tale', 2, hex('3'))], 'ant-tale')
    expect(
      production.featuredStoryId,
      "precondition: production's featured differs from <seq>'s",
    ).not.toBe(three.featuredStoryId)
    // (g1) the copy, the featured id, the notes
    const back = composeRollback({ production, from: three, feature: undefined })
    expect.soft(jcs(back.stories), "(g1) stories JCS-equal <seq>'s").toBe(jcs(three.stories))
    expect.soft(back.featuredStoryId, "(g1) <seq>'s featured").toBe('bee-tale')
    const flagged = composeRollback({ production, from: three, feature: 'ant-tale' })
    expect.soft(flagged.featuredStoryId, "(g1) the flag's featured").toBe('ant-tale')
    expect.soft(back.note, '(g1) note').toBe('publisher rollback: 3')
    expect
      .soft(composeRollback({ production, from: three, feature: null }).note, '(g1) note with none')
      .toBe('publisher rollback: 3 feature=none')
    // (g2) unchanged by content, never by seq
    const same = composeRollback({ production, from: production, feature: undefined })
    expect.soft(same.unchanged, "(g2) <seq> equal to production's, no flag").toBe(true)
    const older = { ...production, seq: 2, note: 'older', createdAt: LATER }
    expect
      .soft(
        composeRollback({ production, from: older, feature: undefined }).unchanged,
        "(g2) an older <seq> whose content equals production's",
      )
      .toBe(true)
    expect
      .soft(
        composeRollback({ production, from: production, feature: null }).unchanged,
        '(g2) equal <seq> with a flag that changes the featured id',
      )
      .toBe(false)
  })

  it('T15A-29 buildProductionDocuments: the production gates, every entry approved, featured among the entries; any failure plan-gate (A10, L10)', async () => {
    const a = approved('a-tale', 1, hex('1'))
    const b = approved('b-tale', 1, hex('2'), hex('f'))
    const valid = { featuredStoryId: 'b-tale', stories: [a, b], note: 'publisher publish: b-tale' }
    expect(
      valid.stories.every((s) => s.approvalSha256 !== undefined) &&
        valid.stories.some((s) => s.storyId === valid.featuredStoryId),
      'precondition: every entry approved, the featured id among them',
    ).toBe(true)
    const built = await buildProductionDocuments(valid, 6, new Date(NOW))
    const documents = built.ok ? built.documents : null
    // (g1) a valid composition builds, and the production gates pass
    expect.soft(codeOf(built), '(g1) a valid composition builds').toBe('ok')
    expect
      .soft(
        documents
          ? checkPointer(documents.pointer.bytes, { mode: 'production', root: '' }).ok
          : null,
        '(g1) the pointer passes checkPointer (production)',
      )
      .toBe(true)
    const checked = documents
      ? await checkSnapshot(documents.snapshot.bytes, documents.pointer.value, 'production')
      : null
    expect.soft(checked?.ok, '(g1) the snapshot passes checkSnapshot (production)').toBe(true)
    expect
      .soft(
        documents ? splitByApproval(documents.snapshot.value, 'production').excluded : null,
        '(g1) nothing excluded in production',
      )
      .toEqual([])
    expect.soft(documents?.snapshot.value.featuredStoryId, '(g1) featured kept').toBe('b-tale')
    // (g2) plan-gate
    const unapproved = await buildProductionDocuments(
      { ...valid, stories: [a, entry('b-tale', 1, hex('2'))] },
      6,
      new Date(NOW),
    )
    expect.soft(codeOf(unapproved), '(g2) an entry without approvalSha256').toBe('plan-gate')
    const outside = await buildProductionDocuments(
      { ...valid, featuredStoryId: 'c-tale' },
      6,
      new Date(NOW),
    )
    expect.soft(codeOf(outside), '(g2) a featured id outside the entries').toBe('plan-gate')
  })
})

// ---- createSnapshot (A19) ----

describe('createSnapshot', () => {
  const quick = { sleep: async () => {} }

  it('T14-37 createSnapshot: create, then always one read-back that must equal our bytes (A19, CRIT-13)', async () => {
    const value = snapshotValue(1, [entry('two-paths')])
    const ours = await makeSnapshot(value)
    const empty = await newStub()
    expect(codeOf(await stateOf(empty)), 'precondition: N = 1 on an empty stub').toBe('ok')

    const created = await createSnapshot(clientOf(empty), 1, ours, quick)
    expect.soft(created, '(g1) created').toEqual({ ok: true, result: 'created' })
    const snapPosts = posts(empty, snapshotWrite(1))
    expect.soft(snapPosts.length, '(g1) one POST').toBe(1)
    expect.soft(snapPosts[0]?.values['x-upsert'], '(g1) x-upsert false').toBe('false')
    const readBacks = gets(empty, snapshotRead(1))
    expect
      .soft(
        readBacks.map((r) => r.search),
        '(g1) one GET, no search',
      )
      .toEqual([''])

    const identical = await newStub()
    putRaw(identical, 'catalogue/snapshots/1.json', ours.bytes)
    expect
      .soft(
        await createSnapshot(clientOf(identical), 1, ours, quick),
        '(g2) ours after a lost answer',
      )
      .toEqual({ ok: true, result: 'identical' })

    const taken = await newStub()
    await storeSnapshot(taken, 1, [entry('lantern-walk')])
    expect
      .soft(await createSnapshot(clientOf(taken), 1, ours, quick), '(g3) another snapshot stored')
      .toEqual({ ok: false, code: 'seq-taken' })

    const swapped = await makeSnapshot({ ...value, note: 'tset 1' })
    expect(swapped.bytes.length, 'precondition: the other bytes have our length').toBe(
      ours.bytes.length,
    )
    const other = await newStub()
    const replace = wrapFetch((url, init) => {
      if (isPost(init, url, snapshotWrite(1))) init.body = swapped.bytes
    })
    expect
      .soft(
        await createSnapshot(clientOf(other, { fetchImpl: replace }), 1, ours, quick),
        '(g4) created, but other bytes stored',
      )
      .toEqual({ ok: false, code: 'snapshot-unconfirmed' })
    const lost = await newStub()
    lost.override('GET', snapshotRead(1), answer(400, MISSING))
    expect
      .soft(await createSnapshot(clientOf(lost), 1, ours, quick), '(g4) read-back not-found')
      .toEqual({ ok: false, code: 'snapshot-unconfirmed' })
  })
})

// ---- movePointer (A20) ----

describe('movePointer', () => {
  const stored = (stub: StorageStub, mode: PointerMode) =>
    shaOf(stub.object('content', `catalogue/${mode}.json`)?.bytes)

  it('T14-38 movePointer: pre-check, one write, read-back, post-check, in that order (A20, CRIT-1)', async () => {
    const stub = await newStub()
    const plan = await planState(stub)
    expect(codeOf(await stateOf(stub)), 'precondition: production 3, staging 4, snapshot 5').toBe(
      'ok',
    )
    const calls: string[] = []
    const clock = fakeClock()
    const result = await movePointer(
      recordingPort(clientOf(stub), calls),
      'staging',
      plan.built,
      plan.expected,
      clock.now,
    )
    expect
      .soft(calls, '(g1) the calls in order')
      .toEqual([
        'list catalogue/',
        'read pointer production',
        'read pointer staging',
        'write staging',
        'read pointer staging',
        'list catalogue/',
        'read pointer production',
      ])
    const writes = posts(stub, pointerWrite('staging'))
    expect.soft(writes.length, '(g2) exactly one POST').toBe(1)
    expect.soft(writes[0]?.values['x-upsert'], '(g2) x-upsert true').toBe('true')
    expect.soft(writes[0]?.values['cache-control'], '(g2) max-age=0').toBe('max-age=0')
    expect.soft(result, '(g3) moved').toEqual({ ok: true })
    expect
      .soft(await stored(stub, 'staging'), '(g3) the stored bytes are ours')
      .toBe(plan.built.sha256)
  })

  it('T14-39 pre-check: a higher snapshot or any moved pointer since the plan is concurrent-writer, before the write (A20, L6)', async () => {
    // The precondition reads the plan state only (B14-implC-1): a baseline move would stop MU14-132
    // (the write sent before the pre-check) before g4; T14-38 holds the clean move.
    const baseline = await newStub()
    await planState(baseline)
    const read = await stateOf(baseline)
    expect(
      read.ok ? [read.state.production?.pointer.seq, read.state.staging?.pointer.seq] : null,
      'precondition: the plan state reads (production 3, staging 4)',
    ).toEqual([3, 4])
    const concurrent = { ok: false, code: 'concurrent-writer', afterWrite: false }
    const sample = async (
      label: string,
      group: string,
      want: unknown,
      change: (
        stub: StorageStub,
        plan: Awaited<ReturnType<typeof planState>>,
      ) => Promise<void> | void,
      with_: { production?: boolean; staging?: boolean } = {},
    ) => {
      const stub = await newStub()
      const plan = await planState(stub, with_)
      await change(stub, plan)
      const result = await movePointer(
        clientOf(stub),
        'staging',
        plan.built,
        plan.expected,
        fakeClock().now,
      )
      expect.soft(result, `(${group}) ${label}`).toEqual(want)
      expect
        .soft(posts(stub, pointerWrite('staging')).length, `(g4) no pointer POST: ${label}`)
        .toBe(0)
    }
    await sample(
      'snapshot 6 stored',
      'g1',
      concurrent,
      async (s) => void (await storeSnapshot(s, 6)),
    )
    await sample('production moved to 5', 'g2', concurrent, async (s, p) => {
      await storePointer(s, 'production', 5, p.s5.sha256)
    })
    await sample('staging moved to 3', 'g2', concurrent, async (s, p) => {
      await storePointer(s, 'staging', 3, p.s3.sha256)
    })
    await sample(
      'staging absent in the plan, now present',
      'g3',
      concurrent,
      async (s, p) => void (await storePointer(s, 'staging', 4, p.s4.sha256)),
      { staging: false },
    )
    await sample(
      "the pre-check's production read answered 500",
      'g5',
      { ok: false, code: 'storage-failed', afterWrite: false },
      (s) => s.override('GET', pointerRead('production'), answer(500, '{"statusCode":"500"}')),
    )
  })

  it('T14-40 write answers: one POST always; every answer but written and unauthorized is read back, and no answer at all is never not-moved (A20, CRIT-16, SEC1-2)', async () => {
    const baseline = await newStub()
    const plan0 = await planState(baseline)
    expect(
      await movePointer(
        clientOf(baseline),
        'staging',
        plan0.built,
        plan0.expected,
        fakeClock().now,
      ),
      'precondition: T14-38 passes',
    ).toEqual({ ok: true })
    const sample = async (
      label: string,
      group: string,
      want: unknown,
      setup: (
        stub: StorageStub,
        plan: Awaited<ReturnType<typeof planState>>,
      ) => Partial<StorageClientOptions> | void,
    ) => {
      const stub = await newStub()
      const plan = await planState(stub)
      const extra = setup(stub, plan) ?? {}
      const result = await movePointer(
        clientOf(stub, extra),
        'staging',
        plan.built,
        plan.expected,
        fakeClock().now,
      )
      expect.soft(result, `(${group}) ${label}`).toEqual(want)
      expect.soft(posts(stub, pointerWrite('staging')).length, `(g6) one POST: ${label}`).toBe(1)
      return { stub, plan }
    }
    const notMoved = { ok: false, code: 'pointer-not-moved', afterWrite: true }
    await sample('500, nothing stored', 'g1', notMoved, (s) =>
      s.override('POST', pointerWrite('staging'), answer(500, '{"statusCode":"500"}')),
    )
    await sample('landed, answer lost', 'g2', { ok: true }, () => ({
      fetchImpl: wrapFetch(undefined, (url, init) => {
        if (isPost(init, url, pointerWrite('staging'))) throw new TypeError('answer lost')
      }),
    }))
    for (const [label, status] of [
      ['409 duplicate', 409],
      ['413 too-large', 413],
      ['415 mime-refused', 415],
    ] as const) {
      await sample(label, 'g3', notMoved, (s) =>
        s.override('POST', pointerWrite('staging'), answer(status)),
      )
    }
    await sample(
      'pointer 6 stored after our write',
      'g4',
      { ok: false, code: 'pointer-superseded', afterWrite: true },
      (s) => ({
        fetchImpl: wrapFetch(undefined, async (url, init) => {
          if (isPost(init, url, pointerWrite('staging'))) {
            const six = await storeSnapshot(s, 6)
            await storePointer(s, 'staging', 6, six.sha256)
          }
        }),
      }),
    )
    const unconfirmed = { ok: false, code: 'pointer-unconfirmed', afterWrite: true }
    await sample('other bytes at our seq', 'g4', unconfirmed, (s, p) => ({
      fetchImpl: wrapFetch(undefined, async (url, init) => {
        if (isPost(init, url, pointerWrite('staging'))) {
          await storePointer(s, 'staging', 5, p.s5.sha256, '2026-11-21T10:06:00.000Z')
        }
      }),
    }))
    await sample('read-back not-found', 'g4', unconfirmed, (s) => ({
      fetchImpl: wrapFetch(undefined, (url, init) => {
        if (isPost(init, url, pointerWrite('staging'))) {
          s.override('GET', pointerRead('staging'), answer(400, MISSING))
        }
      }),
    }))
    const { stub } = await sample(
      '401',
      'g5',
      { ok: false, code: 'storage-unauthorized', afterWrite: false },
      (s) => s.override('POST', pointerWrite('staging'), answer(401, '{"statusCode":"401"}')),
    )
    const order = stub.requests.map((r) => `${r.method} ${r.pathname}`)
    const at = order.indexOf(`POST ${pointerWrite('staging')}`)
    expect.soft(order.slice(at + 1), '(g5) no read-back after a 401').toEqual([])

    // g7 (SEC1-2): a write with no answer at all (status null: a timeout or a dropped connection)
    // may still land after the read-back, so the old bytes there are pointer-unconfirmed, never
    // pointer-not-moved. Here the server stored nothing at first and the write lands later.
    let posted = false
    let landed = false
    const late = await sample(
      'no answer, the old bytes at the read-back',
      'g7',
      unconfirmed,
      (s, p) => {
        s.override('POST', pointerWrite('staging'), answer(500, '{"statusCode":"500"}'))
        return {
          fetchImpl: wrapFetch(undefined, (url, init) => {
            if (isPost(init, url, pointerWrite('staging'))) {
              posted = true
              throw new TypeError('the connection dropped before the answer')
            }
            if (
              posted &&
              !landed &&
              init.method === 'GET' &&
              url.pathname === pointerRead('staging')
            ) {
              landed = true
              putRaw(s, 'catalogue/staging.json', p.built.bytes)
            }
          }),
        }
      },
    )
    expect(
      await stored(late.stub, 'staging'),
      'precondition: the late write landed after the read-back (the setup, checked after the run)',
    ).toBe(late.plan.built.sha256)
  })

  it('T14-41 post-check: a writer that lands between our reads and our write is pointer-raced (CRIT-1, L6)', async () => {
    const baseline = await newStub()
    const plan0 = await planState(baseline)
    expect(
      await movePointer(
        clientOf(baseline),
        'staging',
        plan0.built,
        plan0.expected,
        fakeClock().now,
      ),
      'precondition: T14-38 passes',
    ).toEqual({ ok: true })
    const raced = { ok: false, code: 'pointer-raced', afterWrite: true }
    const sample = async (
      label: string,
      group: string,
      want: unknown,
      onPost: (
        stub: StorageStub,
        plan: Awaited<ReturnType<typeof planState>>,
      ) => Promise<void> | void,
      with_: { production?: boolean; staging?: boolean } = {},
      when: 'before' | 'after' = 'before',
    ) => {
      const stub = await newStub()
      const plan = await planState(stub, with_)
      const hook = async (url: URL, init: RequestInit) => {
        if (isPost(init, url, pointerWrite('staging'))) await onPost(stub, plan)
      }
      const fetchImpl = when === 'before' ? wrapFetch(hook) : wrapFetch(undefined, hook)
      const result = await movePointer(
        clientOf(stub, { fetchImpl }),
        'staging',
        plan.built,
        plan.expected,
        fakeClock().now,
      )
      expect.soft(result, `(${group}) ${label}`).toEqual(want)
      return result
    }
    const unpublished = await sample(
      'an unpublish to 6 before our write lands',
      'g1',
      raced,
      async (s) => {
        const six = await storeSnapshot(s, 6)
        await storePointer(s, 'production', 6, six.sha256)
        await storePointer(s, 'staging', 6, six.sha256)
      },
    )
    expect
      .soft(
        unpublished.ok ? '' : formatStopped('stage', unpublished.code),
        '(g1) the stopped line says re-run stage',
      )
      .toBe('stage: stopped: pointer-raced re-run stage')
    await sample('production moved below N on our POST', 'g2', raced, async (s, p) => {
      await storePointer(s, 'production', 4, p.s4.sha256)
    })
    await sample('snapshot N + 1 stored, no pointer moved', 'g3', raced, async (s) => {
      await storeSnapshot(s, 6)
    })
    await sample(
      'production absent in the plan, created on our POST',
      'g4',
      raced,
      async (s, p) => void (await storePointer(s, 'production', 4, p.s4.sha256)),
      { production: false },
    )
    await sample(
      'the post-check listing answered 500',
      'g5',
      { ok: false, code: 'pointer-unconfirmed', afterWrite: true },
      (s) => s.override('POST', LIST_PATH, answer(500, '{"statusCode":"500"}')),
      {},
      'after',
    )
  })

  it('T14-42 pre-check window: over 10 s repeats the pre-check once, then concurrent-writer (CRIT-1, TP-9)', async () => {
    const run = async (slow: ReadonlyMap<number, number>) => {
      const stub = await newStub()
      const plan = await planState(stub)
      const clock = fakeClock()
      let sequences = 0
      let pointerPosted = false
      const fetchImpl = wrapFetch((url, init) => {
        if (isPost(init, url, pointerWrite('staging'))) pointerPosted = true
        if (!pointerPosted && isPost(init, url, LIST_PATH) && listPrefix(init) === 'catalogue') {
          sequences += 1
          clock.advance(slow.get(sequences) ?? 0)
        }
      })
      const result = await movePointer(
        clientOf(stub, { fetchImpl }),
        'staging',
        plan.built,
        plan.expected,
        clock.now,
      )
      return { result, sequences, writes: posts(stub, pointerWrite('staging')).length }
    }
    const fast = await run(new Map())
    expect(fast.sequences, 'precondition: a fast move runs one pre-check').toBe(1)
    const once = await run(new Map([[1, 11_000]]))
    expect.soft(once.sequences, '(g1) two pre-check sequences').toBe(2)
    expect.soft(once.result, '(g1) then moved').toEqual({ ok: true })
    const twice = await run(
      new Map([
        [1, 11_000],
        [2, 11_000],
      ]),
    )
    expect
      .soft(twice.result, '(g2) both slow: concurrent-writer')
      .toEqual({ ok: false, code: 'concurrent-writer', afterWrite: false })
    expect.soft(twice.writes, '(g2) zero pointer POSTs').toBe(0)
    const near = await run(new Map([[1, 9_900]]))
    expect.soft(near.sequences, '(g3) 9.9 s: one sequence').toBe(1)
    expect.soft(near.result, '(g3) moved').toEqual({ ok: true })
  })

  it("T14-43 movePointer is generic over mode and takes expected per call; Step 15's exports exist (A30, CRIT-18)", async () => {
    // g3 first: a missing export is reported before the calls below need it.
    const exports = Object.keys(catalogueState)
    for (const name of [
      'readCatalogueState',
      'allocateSeq',
      'composeStaging',
      'buildStagingDocuments',
      'createSnapshot',
      'movePointer',
    ]) {
      expect.soft(exports.includes(name), `(g3) exported: ${name}`).toBe(true)
    }
    const stub = await newStub()
    const s3 = await storeSnapshot(stub, 3)
    const s4 = await storeSnapshot(stub, 4)
    const p3 = await storePointer(stub, 'production', 3, s3.sha256)
    const t3 = await storePointer(stub, 'staging', 3, s3.sha256)
    expect(codeOf(await stateOf(stub)), 'precondition: production 3, staging 3, snapshot 4').toBe(
      'ok',
    )
    const next = await pointerFor(4, s4.sha256, LATER)
    const built = { seq: 4, bytes: next.bytes, sha256: next.sha256 }
    const port = clientOf(stub)
    const first = await movePointer(
      port,
      'production',
      built,
      { production: p3.sha256, staging: t3.sha256 },
      fakeClock().now,
    )
    expect.soft(first, '(g1) production moved').toEqual({ ok: true })
    expect.soft(await stored(stub, 'production'), '(g1) production holds ours').toBe(built.sha256)
    expect.soft(await stored(stub, 'staging'), '(g1) staging untouched').toBe(t3.sha256)
    const second = await movePointer(
      port,
      'staging',
      built,
      { production: built.sha256, staging: t3.sha256 },
      fakeClock().now,
    )
    expect.soft(second, "(g2) staging moved with production's new bytes expected").toEqual({
      ok: true,
    })
    expect.soft(await stored(stub, 'staging'), '(g2) staging holds ours').toBe(built.sha256)
  })
})
