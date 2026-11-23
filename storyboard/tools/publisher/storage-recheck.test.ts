// Step 13 (P1-8b): storage.ts calls targetOf or pointerTarget, re-check 1 and re-check 2 as three
// separate imports (design p1-step13-design.md §3.3, §13.5). vi.mock wraps each layout export in a
// vi.fn around the real function; each test gives one call a hostile return, so a removed or
// reordered call in storage.ts turns a test red. A separate file because vi.mock covers the file.
// Every call goes to a recorder on http://127.0.0.1:9; nothing is sent anywhere.
// Step 15a (design p1-step15a-design.md §14.12): APPROVAL is a full valid record (the strict approval
// gate, D15-6) and T14-80 g4 samples a content media target (a package is content-readable, D15-17).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { APPROVAL_CHECKLIST_TEXT, APPROVAL_PRESCREEN_LEGACY } from '../../src/core/package/approval'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { Secret } from './env'
import { createStorageClient, StorageRefusedError, type StorageClient } from './storage'
import * as layout from './storage-layout'
import type { Target } from './storage-layout'

vi.mock('./storage-layout', async (importOriginal) => {
  const real = await importOriginal<typeof import('./storage-layout')>()
  return {
    ...real,
    targetOf: vi.fn(real.targetOf),
    pointerTarget: vi.fn(real.pointerTarget),
    contentReadTarget: vi.fn(real.contentReadTarget),
    recheckTarget: vi.fn(real.recheckTarget),
    recheckUrl: vi.fn(real.recheckUrl),
  }
})

const real = await vi.importActual<typeof import('./storage-layout')>('./storage-layout')

// Assembled at runtime, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-storage-test-key'].join('_')
const SHA_A = 'a'.repeat(64)
const APPROVAL_REF = { kind: 'approval', storyId: 'two-paths', packageSha256: SHA_A } as const
const WAIVER_REF = { kind: 'waiver', storyId: 'two-paths', waiverSha256: SHA_A } as const
const APPROVAL = jcsBytes({
  storyId: 'two-paths',
  packageSha256: SHA_A,
  ruleSetRef: PANCHATANTRA_RULESET.ref,
  waiversSha256: 'b'.repeat(64),
  review: {
    languagesRead: ['en', 'hi'],
    allNodesRead: true,
    imagesViewed: 1,
    narrationCheck: 'checked',
    devices: ['phone'],
    reviewerChecklist: APPROVAL_CHECKLIST_TEXT,
  },
  prescreen: APPROVAL_PRESCREEN_LEGACY,
  decision: 'approved',
  approvedOn: '2026-11-21',
  approvedBy: 'owner',
})
const BAD_APPROVAL = jcsBytes({
  storyId: 'fox-and-crow',
  packageSha256: SHA_A,
  approvedOn: '2026-11-21',
})
const POINTER = jcsBytes({
  schemaVersion: '1.0',
  seq: 7,
  snapshotPath: 'catalogue/snapshots/7.json',
  snapshotSha256: SHA_A,
  updatedAt: '2026-11-21T00:00:00.000Z',
})

const masters = (kind: 'approval' | 'waiver', path: string): Target => ({
  kind,
  bucket: 'masters',
  path,
  contentType: kind === 'approval' ? 'application/json' : null,
  cacheSeconds: kind === 'approval' ? 0 : null,
  maxBytes: layout.MAX_JSON_BYTES,
  fields: Object.freeze<Record<string, string>>(
    kind === 'approval'
      ? { storyId: 'two-paths', packageSha256: SHA_A }
      : { storyId: 'two-paths', waiverSha256: SHA_A },
  ),
})
const pointer = (path: string): Target => ({
  kind: 'pointer',
  bucket: 'content',
  path,
  contentType: 'application/json',
  cacheSeconds: 0,
  maxBytes: layout.MAX_JSON_BYTES,
  fields: Object.freeze({ mode: 'production' }),
})
const ok = (value: Target) => ({ ok: true as const, value })

const K2_FORMS: [string, string][] = [
  ['P05', 'a//b'],
  ['P07', 'a/%2f/b'],
  ['P08', 'a/%252e%252e/b'],
]

function client(): { storage: StorageClient; calls: string[] } {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input))
    return new Response('{}', { status: 200 })
  }
  const storage = createStorageClient({
    supabaseUrl: new URL('http://127.0.0.1:9'),
    secretKey: new Secret(FAKE_KEY),
    fetchImpl,
  })
  return { storage, calls }
}

/** The ok flag of every result a wrapped layout function returned in this test. */
const okOf = (fn: (...args: never[]) => unknown) =>
  vi.mocked(fn).mock.results.map((result) => (result.value as { ok: boolean }).ok)

async function refusalOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt
    return 'resolved'
  } catch (error) {
    return error instanceof StorageRefusedError ? error.message : `other ${String(error)}`
  }
}

// mockReset also drops any queued once-return a test left unused, and keeps the real function.
beforeEach(() => {
  vi.mocked(layout.targetOf).mockReset()
  vi.mocked(layout.pointerTarget).mockReset()
  vi.mocked(layout.contentReadTarget).mockReset()
  vi.mocked(layout.recheckTarget).mockReset()
  vi.mocked(layout.recheckUrl).mockReset()
})

// ---- loopback guard (13.1 D, G5; review fix FID-3): global fetch reaches loopback hosts only ----

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0

beforeEach(() => {
  escapes = 0
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
    escapes++
    return Promise.reject(new TypeError('blocked: not a loopback host'))
  })
})

afterEach(() => {
  const count = escapes
  vi.unstubAllGlobals()
  expect(count, 'loopback guard: requests that tried to leave 127.0.0.1').toBe(0)
})

describe('storage.ts calls each layout check', () => {
  it('T13-K1 a hostile target that passes re-check 1 is refused by re-check 2 with 0 requests', async () => {
    const { storage, calls } = client()
    vi.mocked(layout.targetOf).mockReturnValueOnce(
      ok(masters('approval', `approvals/a/../b/${SHA_A}.json`)),
    )
    vi.mocked(layout.recheckTarget).mockReturnValueOnce(
      ok(masters('approval', `approvals/a/../b/${SHA_A}.json`)),
    )
    const message = await refusalOf(storage.create(APPROVAL_REF, APPROVAL))
    expect(vi.mocked(layout.targetOf), 'precondition: targetOf called once').toHaveBeenCalledTimes(
      1,
    )
    expect(
      vi.mocked(layout.recheckTarget),
      'precondition: re-check 1 called once',
    ).toHaveBeenCalledTimes(1)
    expect.soft(message, '(g1) url-mismatch').toBe('refused: approval url url-mismatch')
    // The transport refuses the same URL with the same text (review fix SEC-6), so the message alone
    // cannot show re-check 2 ran: it must have been called once and refused.
    expect.soft(okOf(layout.recheckUrl), '(g1) re-check 2 ran once and refused').toEqual([false])
    expect.soft(calls.length, '(g1) 0 requests').toBe(0)
  })

  it('T13-K2 the three forms the URL parser keeps are refused by re-check 1 as unsafe-path', async () => {
    const { storage, calls } = client()
    for (const [id, form] of K2_FORMS) {
      const path = `approvals/${form}/${SHA_A}.json`
      const route = `/storage/v1/object/masters/${path}`
      expect(
        real.recheckUrl(new URL(route, 'http://127.0.0.1:9'), 'http://127.0.0.1:9', route).ok,
        `precondition: ${id} passes re-check 2`,
      ).toBe(true)
      vi.mocked(layout.targetOf).mockClear()
      vi.mocked(layout.targetOf).mockReturnValueOnce(ok(masters('approval', path)))
      const message = await refusalOf(storage.create(APPROVAL_REF, APPROVAL))
      expect(
        vi.mocked(layout.targetOf),
        `precondition: ${id} targetOf called once`,
      ).toHaveBeenCalledTimes(1)
      expect.soft(message, `(g1) ${id}`).toBe('refused: approval class-pattern unsafe-path')
    }
    expect.soft(calls.length, '(g1) 0 requests').toBe(0)
  })

  it('T13-K3 a safe-but-wrong path is refused by re-check 1 as class-pattern', async () => {
    const { storage, calls } = client()
    vi.mocked(layout.targetOf).mockReturnValueOnce(
      ok(masters('approval', `approvals/Lion-And-Hare/${SHA_A}.json`)),
    )
    const message = await refusalOf(storage.create(APPROVAL_REF, APPROVAL))
    expect(vi.mocked(layout.targetOf), 'precondition: targetOf called once').toHaveBeenCalledTimes(
      1,
    )
    expect.soft(message, '(g1) class-pattern').toBe('refused: approval class-pattern class-pattern')
    expect.soft(calls.length, '(g1) 0 requests').toBe(0)
  })

  it('T13-K4 readMaster runs the same re-checks on the waiver class', async () => {
    const { storage, calls } = client()
    const rows: [string, string, boolean, string][] = [
      ['K1 form', `waivers/a/../b/${SHA_A}.json`, true, 'refused: waiver url url-mismatch'],
      ...K2_FORMS.map(([id, form]): [string, string, boolean, string] => [
        `K2 ${id}`,
        `waivers/${form}/${SHA_A}.json`,
        false,
        'refused: waiver class-pattern unsafe-path',
      ]),
      [
        'K3 form',
        `waivers/Lion-And-Hare/${SHA_A}.json`,
        false,
        'refused: waiver class-pattern class-pattern',
      ],
    ]
    for (const [name, path, skipRecheck1, want] of rows) {
      vi.mocked(layout.targetOf).mockClear()
      vi.mocked(layout.recheckUrl).mockClear()
      vi.mocked(layout.targetOf).mockReturnValueOnce(ok(masters('waiver', path)))
      if (skipRecheck1)
        vi.mocked(layout.recheckTarget).mockReturnValueOnce(ok(masters('waiver', path)))
      const message = await refusalOf(storage.readMaster(WAIVER_REF))
      expect(
        vi.mocked(layout.targetOf),
        `precondition: ${name} targetOf called once`,
      ).toHaveBeenCalledTimes(1)
      expect.soft(message, `(g1) ${name}`).toBe(want)
      expect
        .soft(
          okOf(layout.recheckUrl),
          `(g1) ${name} re-check 2 ${skipRecheck1 ? 'refused' : 'not reached'}`,
        )
        .toEqual(skipRecheck1 ? [false] : [])
    }
    expect.soft(calls.length, '(g1) 0 requests').toBe(0)
  })

  it('T13-K5 writePointer runs re-check 1 on the pointer target', async () => {
    const { storage, calls } = client()
    const rows: [string, string][] = [
      ['catalogue/../production.json', 'refused: pointer class-pattern unsafe-path'],
      ['catalogue/fixtures.json', 'refused: pointer class-pattern class-pattern'],
    ]
    for (const [path, want] of rows) {
      vi.mocked(layout.pointerTarget).mockClear()
      vi.mocked(layout.pointerTarget).mockReturnValueOnce(ok(pointer(path)))
      const message = await refusalOf(storage.writePointer('production', POINTER))
      expect(
        vi.mocked(layout.pointerTarget),
        `precondition: ${path} pointerTarget called once`,
      ).toHaveBeenCalledTimes(1)
      expect.soft(message, `(g1) ${path}`).toBe(want)
    }
    expect.soft(calls.length, '(g1) 0 requests').toBe(0)
  })

  it('T13-K6 the body gate runs before the re-checks', async () => {
    const hostile = () => ok(masters('approval', `approvals/a/../b/${SHA_A}.json`))
    const { storage, calls } = client()
    // hard preconditions: each component alone
    vi.mocked(layout.targetOf).mockReturnValueOnce(hostile())
    vi.mocked(layout.recheckTarget).mockReturnValueOnce(hostile())
    expect(
      await refusalOf(storage.create(APPROVAL_REF, APPROVAL)),
      'precondition: hostile target alone',
    ).toBe('refused: approval url url-mismatch')
    expect(
      await refusalOf(storage.create(APPROVAL_REF, BAD_APPROVAL)),
      'precondition: failing body alone',
    ).toBe('refused: approval body-gate record-story-id')
    expect(calls.length, 'precondition: 0 requests so far').toBe(0)
    expect(
      await refusalOf(storage.create(APPROVAL_REF, APPROVAL)),
      'precondition: valid body and target',
    ).toBe('resolved')
    expect(calls.length, 'precondition: the valid create made 1 call').toBe(1)
    vi.mocked(layout.targetOf).mockClear()
    vi.mocked(layout.targetOf).mockReturnValueOnce(hostile())
    vi.mocked(layout.recheckTarget).mockReturnValueOnce(hostile())
    const message = await refusalOf(storage.create(APPROVAL_REF, BAD_APPROVAL))
    expect(vi.mocked(layout.targetOf), 'precondition: targetOf called once').toHaveBeenCalledTimes(
      1,
    )
    expect.soft(message, '(g1) body-gate first').toBe('refused: approval body-gate record-story-id')
    expect.soft(calls.length, '(g1) no new request').toBe(1)
  })

  it('T13-K8 with both re-checks passed, the transport refuses a URL outside the closed route list, with 0 requests', async () => {
    // Review fix SEC-6: send() checks the URL against §4.1's routes itself, so a later call site that
    // builds a URL another way (OBJECT_ROUTE + 'move', a relative URL) cannot send it.
    const { storage, calls } = client()
    const passBoth = (target: Target) => {
      vi.mocked(layout.recheckTarget).mockReturnValueOnce(ok(target))
      vi.mocked(layout.recheckUrl).mockImplementationOnce((url) => ({ ok: true, value: url }))
    }
    expect(
      await refusalOf(storage.create(APPROVAL_REF, APPROVAL)),
      'precondition: a valid create is sent',
    ).toBe('resolved')
    expect(calls.length, 'precondition: one request').toBe(1)
    const rows: [string, () => Promise<unknown>, string][] = [
      [
        'g1 create reaching /object/move',
        () => {
          const target = masters('approval', `approvals/../../move/${SHA_A}.json`)
          vi.mocked(layout.targetOf).mockReturnValueOnce(ok(target))
          passBoth(target)
          return storage.create(APPROVAL_REF, APPROVAL)
        },
        'refused: approval url url-mismatch',
      ],
      [
        'g1 create reaching /bucket/masters',
        () => {
          const target = masters(
            'approval',
            `approvals/../../../bucket/masters/approvals/two-paths/${SHA_A}.json`,
          )
          vi.mocked(layout.targetOf).mockReturnValueOnce(ok(target))
          passBoth(target)
          return storage.create(APPROVAL_REF, APPROVAL)
        },
        'refused: approval url url-mismatch',
      ],
      [
        'g2 readMaster reaching /object/sign/masters',
        () => {
          const target = masters(
            'waiver',
            `waivers/../../../sign/masters/waivers/two-paths/${SHA_A}.json`,
          )
          vi.mocked(layout.targetOf).mockReturnValueOnce(ok(target))
          passBoth(target)
          return storage.readMaster(WAIVER_REF)
        },
        'refused: waiver url url-mismatch',
      ],
      [
        'g3 a pointer write landing on a masters approval',
        () => {
          const target = pointer(`catalogue/../../masters/approvals/two-paths/${SHA_A}.json`)
          vi.mocked(layout.pointerTarget).mockReturnValueOnce(ok(target))
          passBoth(target)
          return storage.writePointer('production', POINTER)
        },
        'refused: pointer url url-mismatch',
      ],
      ...(['?x', '#x'] as const).map((tail): [string, () => Promise<unknown>, string] => [
        `g4 a ${tail[0]} on a valid approval path`,
        () => {
          const target = masters('approval', `approvals/two-paths/${SHA_A}.json${tail}`)
          vi.mocked(layout.targetOf).mockReturnValueOnce(ok(target))
          passBoth(target)
          return storage.create(APPROVAL_REF, APPROVAL)
        },
        'refused: approval url url-mismatch',
      ]),
    ]
    for (const [name, attempt, want] of rows) {
      vi.mocked(layout.recheckUrl).mockClear()
      const before = calls.length
      const message = await refusalOf(attempt())
      expect(
        vi.mocked(layout.recheckUrl),
        `precondition: ${name} re-check 2 called once`,
      ).toHaveBeenCalledTimes(1)
      expect.soft(message, `(${name})`).toBe(want)
      expect.soft(calls.length - before, `(${name}) 0 requests`).toBe(0)
    }
  })

  it('T13-K7 fields that disagree with the path are refused by re-check 1 as class-fields', async () => {
    const { storage, calls } = client()
    vi.mocked(layout.targetOf).mockReturnValueOnce(
      ok(masters('approval', `approvals/fox-and-crow/${SHA_A}.json`)),
    )
    const message = await refusalOf(storage.create(APPROVAL_REF, APPROVAL))
    expect(vi.mocked(layout.targetOf), 'precondition: targetOf called once').toHaveBeenCalledTimes(
      1,
    )
    expect.soft(message, '(g1) class-fields').toBe('refused: approval class-pattern class-fields')
    expect.soft(calls.length, '(g1) 0 requests').toBe(0)
  })
})

// ---- Step 14 (P1-8c): readContent (design p1-step14-design.md §3.4, §14.10) ----

const content = (
  kind: 'pointer' | 'snapshot' | 'package',
  path: string,
  fields: Record<string, string | number>,
): Target => ({
  kind,
  bucket: 'content',
  path,
  contentType: 'application/json',
  cacheSeconds: kind === 'pointer' ? 0 : 3600,
  maxBytes: layout.MAX_JSON_BYTES,
  fields: Object.freeze({ ...fields }),
})
const STAGING_REF = { kind: 'pointer', mode: 'staging' } as const
const SNAPSHOT_TARGET = (tail = '') =>
  content('snapshot', `catalogue/snapshots/7.json${tail}`, { seq: 7 })
const STAGING_TARGET = (tail = '') =>
  content('pointer', `catalogue/staging.json${tail}`, { mode: 'staging' })
const searchOf = (url: string | undefined) => (url === undefined ? 'no call' : new URL(url).search)
const pathnameOf = (url: string | undefined) =>
  url === undefined ? 'no call' : new URL(url).pathname

describe('readContent calls each layout check (Step 14)', () => {
  it('T14-79 readContent calls contentReadTarget, re-check 1 and re-check 2 as separate imports, in that order (A11)', async () => {
    const { storage, calls } = client()
    expect(
      await refusalOf(storage.readContent(STAGING_REF)),
      'precondition: a valid read resolves',
    ).toBe('resolved')
    expect(calls.length, 'precondition: one request').toBe(1)
    // (g1) a refusal injected once into each check is the thrown text, with 0 requests
    const injections: [string, () => void, string][] = [
      [
        'contentReadTarget',
        () =>
          vi.mocked(layout.contentReadTarget).mockReturnValueOnce({
            ok: false,
            refusal: { cls: 'pointer', stage: 'field', rule: 'injected-zero' },
          }),
        'refused: pointer field injected-zero',
      ],
      [
        're-check 1',
        () =>
          vi.mocked(layout.recheckTarget).mockReturnValueOnce({
            ok: false,
            refusal: { cls: 'pointer', stage: 'class-pattern', rule: 'injected-one' },
          }),
        'refused: pointer class-pattern injected-one',
      ],
      [
        're-check 2',
        () =>
          vi.mocked(layout.recheckUrl).mockReturnValueOnce({
            ok: false,
            refusal: { cls: 'ref', stage: 'url', rule: 'injected-two' },
          }),
        'refused: pointer url injected-two',
      ],
    ]
    for (const [name, inject, want] of injections) {
      inject()
      const before = calls.length
      expect.soft(await refusalOf(storage.readContent(STAGING_REF)), `(g1) ${name}`).toBe(want)
      expect.soft(calls.length - before, `(g1) ${name} 0 requests`).toBe(0)
    }
    // (g2) one call each, in the order contentReadTarget, re-check 1, re-check 2
    vi.mocked(layout.contentReadTarget).mockClear()
    vi.mocked(layout.recheckTarget).mockClear()
    vi.mocked(layout.recheckUrl).mockClear()
    await storage.readContent(STAGING_REF)
    const order = [layout.contentReadTarget, layout.recheckTarget, layout.recheckUrl].map(
      (fn) => vi.mocked(fn).mock.invocationCallOrder[0] ?? Number.NaN,
    )
    for (const [name, fn] of [
      ['contentReadTarget', layout.contentReadTarget],
      ['re-check 1', layout.recheckTarget],
      ['re-check 2', layout.recheckUrl],
    ] as const) {
      expect.soft(vi.mocked(fn).mock.calls.length, `(g2) ${name} called once`).toBe(1)
    }
    expect
      .soft(order[0]! < order[1]! && order[1]! < order[2]!, `(g2) order ${order.join(' < ')}`)
      .toBe(true)
  })

  it("T14-80 send()'s search rule, client half: only a pointer GET carries a nonce (L10, CRIT-10)", async () => {
    const { storage, calls } = client()
    const passBoth = () => {
      vi.mocked(layout.recheckTarget).mockImplementationOnce((target) => ({
        ok: true,
        value: target,
      }))
      vi.mocked(layout.recheckUrl).mockImplementationOnce((url) => ({ ok: true, value: url }))
    }
    const readAs = (target: Target) => {
      vi.mocked(layout.contentReadTarget).mockReturnValueOnce(ok(target))
      passBoth()
      return storage.readContent(STAGING_REF)
    }
    // positive control: with both re-checks mocked to pass, a valid target reaches the transport
    expect(await refusalOf(readAs(STAGING_TARGET())), 'precondition: a valid read is sent').toBe(
      'resolved',
    )
    expect(calls.length, 'precondition: one request').toBe(1)
    const rows: [string, () => Promise<unknown>, string][] = [
      ...(['?cacheNonce=1', '?x=1', '?'] as const).map(
        (tail): [string, () => Promise<unknown>, string] => [
          `snapshot target ending ${tail}`,
          () => readAs(SNAPSHOT_TARGET(tail)),
          'refused: snapshot url url-mismatch',
        ],
      ),
      [
        'waiver target ending ?cacheNonce=1',
        () => {
          vi.mocked(layout.targetOf).mockReturnValueOnce(
            ok(masters('waiver', `waivers/two-paths/${SHA_A}.json?cacheNonce=1`)),
          )
          passBoth()
          return storage.readMaster(WAIVER_REF)
        },
        'refused: waiver url url-mismatch',
      ],
      ...(['?cacheNonce=1', '?', '#'] as const).map(
        (tail): [string, () => Promise<unknown>, string] => [
          `writePointer target ending ${tail}`,
          () => {
            vi.mocked(layout.pointerTarget).mockReturnValueOnce(
              ok(pointer(`catalogue/production.json${tail}`)),
            )
            passBoth()
            return storage.writePointer('production', POINTER)
          },
          'refused: pointer url url-mismatch',
        ],
      ),
      [
        'readContent pointer target ending #x',
        () => readAs(STAGING_TARGET('#x')),
        'refused: pointer url url-mismatch',
      ],
    ]
    for (const [name, attempt, want] of rows) {
      vi.mocked(layout.recheckUrl).mockClear()
      const before = calls.length
      const message = await refusalOf(attempt())
      expect(
        vi.mocked(layout.recheckUrl),
        `precondition: ${name} re-check 2 called once`,
      ).toHaveBeenCalledTimes(1)
      expect.soft(message, `(g1) ${name}`).toBe(want)
      expect.soft(calls.length - before, `(g1) ${name} 0 requests`).toBe(0)
    }
    // (g2) the nonce assignment replaces a search the target carried; it never appends
    const beforeG2 = calls.length
    expect.soft(await refusalOf(readAs(STAGING_TARGET('?x=1'))), '(g2) sent').toBe('resolved')
    expect.soft(calls.length - beforeG2, '(g2) one request').toBe(1)
    expect
      .soft(searchOf(calls[beforeG2]), '(g2) the search is exactly the nonce')
      .toMatch(/^\?cacheNonce=[1-9][0-9]{0,15}$/)
    // (g3) the nonce follows the target's kind, never the ref's
    const beforeG3 = calls.length
    expect
      .soft(await refusalOf(readAs(SNAPSHOT_TARGET())), '(g3) a pointer ref with a snapshot target')
      .toBe('resolved')
    expect.soft(calls.length - beforeG3, '(g3) one request').toBe(1)
    expect
      .soft(pathnameOf(calls[beforeG3]), '(g3) the snapshot path')
      .toBe('/storage/v1/object/authenticated/content/catalogue/snapshots/7.json')
    expect.soft(searchOf(calls[beforeG3]), '(g3) no search on the snapshot read').toBe('')
    // (g4) routeClass's content branch is pointer, snapshot and package only (Step 15a)
    const beforeG4 = calls.length
    const media: Target = {
      kind: 'media',
      bucket: 'content',
      path: `media/two-paths/${SHA_A}-w640.webp`,
      contentType: 'image/webp',
      cacheSeconds: 3600,
      maxBytes: layout.MAX_JSON_BYTES,
      fields: Object.freeze({
        storyId: 'two-paths',
        sha256: SHA_A,
        variant: 'w640',
        mime: 'image/webp',
      }),
    }
    expect
      .soft(await refusalOf(readAs(media)), '(g4) a content media target')
      .toBe('refused: media url url-mismatch')
    expect.soft(calls.length - beforeG4, '(g4) 0 requests').toBe(0)
  })
})

// ---- Step 17 (P1-9a): the masters classes on the closed route list (design p1-step17-design.md
// §3.7; test plan 14.12: T17-41) ----

describe('routeClass for the masters classes (Step 17)', () => {
  it('T17-41 routeClass: a GET on the masters read route reaches approval, waiver, image-master and media-log; a POST creates both new kinds in masters (A23)', async () => {
    const png = Uint8Array.of(
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      13,
      0x49,
      0x48,
      0x44,
      0x52,
    )
    const pngSha = await sha256Hex(png)
    const log = new TextEncoder().encode('[]')
    const logSha12 = (await sha256Hex(log)).slice(0, 12)
    const master = {
      kind: 'image-master',
      storyId: 'two-paths',
      sha256: pngSha,
      ext: 'png',
    } as const
    const mediaLog = {
      kind: 'media-log',
      date: '2026-11-23',
      sha12: logSha12,
      file: 'media-log.json',
    } as const
    const { storage, calls } = client()
    expect(
      await refusalOf(storage.readMaster(APPROVAL_REF)),
      'precondition: an approval read is sent',
    ).toBe('resolved')
    expect(calls.length, 'precondition: one request').toBe(1)
    const reads: [string, () => Promise<unknown>, string][] = [
      ['waiver', () => storage.readMaster(WAIVER_REF), `waivers/two-paths/${SHA_A}.json`],
      ['image-master', () => storage.readMaster(master), `images/two-paths/${pngSha}.png`],
      [
        'media-log',
        () => storage.readMaster(mediaLog),
        `media-log/2026-11-23-${logSha12}/media-log.json`,
      ],
    ]
    for (const [name, attempt, path] of reads) {
      const before = calls.length
      expect.soft(await refusalOf(attempt()), `(g1) GET ${name} is sent`).toBe('resolved')
      expect
        .soft(calls.slice(before), `(g1) GET ${name} on the masters read route`)
        .toEqual([`http://127.0.0.1:9/storage/v1/object/authenticated/masters/${path}`])
    }
    const creates: [string, () => Promise<unknown>, string][] = [
      ['image-master', () => storage.create(master, png), `images/two-paths/${pngSha}.png`],
      [
        'media-log',
        () => storage.create(mediaLog, log),
        `media-log/2026-11-23-${logSha12}/media-log.json`,
      ],
    ]
    for (const [name, attempt, path] of creates) {
      const before = calls.length
      expect.soft(await refusalOf(attempt()), `(g2) POST ${name} is sent`).toBe('resolved')
      expect
        .soft(calls.slice(before), `(g2) POST ${name} to the masters bucket`)
        .toEqual([`http://127.0.0.1:9/storage/v1/object/masters/${path}`])
    }
  })
})
