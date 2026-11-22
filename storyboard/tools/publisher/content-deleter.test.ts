// The content deleter's tests. Step 13 moved nine remove() tests here from storage.test.ts (owner
// item 1 option 1; design p1-step13-design.md §3.2, §13.8 D1-D9). Step 15b (design
// p1-step15b-design.md §3.13, D15B-13; test plan §14.6) rewrites the file to the hardened API: the
// two pure-helper tests are kept unchanged; the other nine map to equal or stricter groups of T15B-8
// to T15B-12 (refuses invalid guards → T15B-8 g3; https and loopback → g1; the short key → g5; the
// exact DELETE → T15B-11 g1; count mismatch → T15B-11 g3; unauthorized and failed → T15B-11 g4;
// masters, buckets, paths and counts → T15B-10; the key run → T15B-11 g6; the local server →
// T15B-12, now the storage stub with deletes on).
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkRemoved,
  createContentDeleter,
  isUnderPrefix,
  type ContentDeleter,
  type ContentDeleterOptions,
} from './content-deleter'
import { Secret } from './env'
import { isStorageRefusal } from './port'
import { createStorageClient } from './storage'
import { expectNoUnexpected, startStorageStub } from './storage-stub'

// Assembled at runtime, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-storage-test-key'].join('_')
const PUBLISHABLE_KEY = ['sb', 'publishable', 'fake-storage-test-key'].join('_')
const CANARY = ['S15B', 'CANARY'].join('')
const REF = 'abcdefghijklmnopqrst'
const SUPABASE_URL = new URL(`https://${REF}.supabase.co`)
const LOOPBACK_URL = new URL('http://127.0.0.1:9')
const ID = 'two-paths'
const hex = (char: string) => char.repeat(64)
const WEBP = `media/${ID}/${hex('a')}-w768.webp`
const WIDE = `media/${ID}/${hex('b')}-w1408.webp`
const MP3 = `media/${ID}/${hex('c')}-en.mp3`
const PACKAGE = `packages/${ID}/${hex('d')}.json`

interface Call {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: unknown
  readonly redirect: RequestRedirect | undefined
  readonly signal: unknown
}

type Respond = (call: Call, index: number) => Response | Promise<Response>

/** Rows naming every path of the request body, as Storage answers a full removal. */
const allRemoved: Respond = (call) =>
  json(
    200,
    (JSON.parse(String(call.body)) as { prefixes: string[] }).prefixes.map((name) => ({
      name,
      bucket_id: 'content',
    })),
  )

function recorder(respond: Respond = allRemoved) {
  const calls: Call[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: init?.body,
      redirect: init?.redirect,
      signal: init?.signal,
    }
    calls.push(call)
    return respond(call, calls.length - 1)
  }
  return { calls, fetchImpl }
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A deleter bound to `storyId` on the loopback origin with a recording fetchImpl. */
function deleter(respond?: Respond, storyId = ID) {
  const fake = recorder(respond)
  const remover = createContentDeleter({
    supabaseUrl: LOOPBACK_URL,
    secretKey: new Secret(FAKE_KEY),
    storyId,
    fetchImpl: fake.fetchImpl,
  })
  return { remover, calls: fake.calls }
}

/** The thrown value of `make`, or null when it returned. */
function thrown(make: () => unknown): unknown {
  try {
    make()
    return null
  } catch (error) {
    return error
  }
}

/** The rule word of a construction refusal, `ok`, or `other <name>` for any other throw. */
function ruleOf(make: () => unknown): string {
  const error = thrown(make)
  if (error === null) return 'ok'
  const match =
    error instanceof Error
      ? /^refused: (?:client|deleter) option ([a-z-]+)$/.exec(error.message)
      : null
  return match ? match[1]! : `other ${error instanceof Error ? error.name : typeof error}`
}

/** A URL subclass whose getters show `shown` while its own state stays `real`. */
function lyingUrl(real: string, shown: string): URL {
  const fake = new URL(shown)
  class Lying extends URL {
    override get hostname() {
      return fake.hostname
    }
    override get origin() {
      return fake.origin
    }
    override get href() {
      return fake.href
    }
    override get protocol() {
      return fake.protocol
    }
    override get port() {
      return fake.port
    }
  }
  return new Lying(real)
}

/** An object with only URL.prototype and getters that show an allowed host. */
function prototypeOnlyUrl(shown: string): URL {
  const fake = new URL(shown)
  return Object.create(URL.prototype, {
    hostname: { get: () => fake.hostname },
    origin: { get: () => fake.origin },
    href: { get: () => fake.href },
    protocol: { get: () => fake.protocol },
    port: { get: () => fake.port },
    pathname: { get: () => fake.pathname },
  }) as URL
}

// ---- loopback guard (13.1 D, G5; review fix SEC2-7): global fetch reaches loopback hosts only ----
// The deleter accepts https without fetchImpl, so a test that dropped its fetchImpl would otherwise
// send a real DELETE.

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

// ---- pure helpers ----

describe('storage helpers', () => {
  it('isUnderPrefix needs a path strictly inside a prefix', () => {
    expect(isUnderPrefix('spikes/a.json', ['spikes/'])).toBe(true)
    expect(isUnderPrefix('spikes/', ['spikes/'])).toBe(false)
    expect(isUnderPrefix('spikesx/a.json', ['spikes/'])).toBe(false)
    expect(isUnderPrefix('catalogue/production.json', ['spikes/'])).toBe(false)
  })

  it('checkRemoved compares names and count with the request', () => {
    const asked = ['spikes/a.json', 'spikes/b.json']
    expect(
      checkRemoved(asked, 200, [{ name: 'spikes/b.json' }, { name: 'spikes/a.json' }]),
    ).toEqual({ kind: 'removed', paths: asked })
    expect(checkRemoved(asked, 200, [{ name: 'spikes/a.json' }])).toEqual({
      kind: 'count-mismatch',
      removed: ['spikes/a.json'],
      notRemoved: ['spikes/b.json'],
      unexpected: [],
    })
    expect(checkRemoved(['spikes/a.json'], 200, [{ name: 'spikes/z.json' }])).toEqual({
      kind: 'count-mismatch',
      removed: [],
      notRemoved: ['spikes/a.json'],
      unexpected: ['spikes/z.json'],
    })
    expect(
      checkRemoved(['spikes/a.json'], 200, [{ name: 'spikes/a.json' }, { name: 'spikes/a.json' }]),
    ).toEqual({
      kind: 'count-mismatch',
      removed: ['spikes/a.json'],
      notRemoved: [],
      unexpected: [],
    })
    expect(checkRemoved(asked, 200, { message: 'ok' })).toEqual({
      kind: 'failed',
      status: 200,
      code: 'unreadable-response',
    })
  })
})

// ---- construction (Step 15b, D15B-13) ----

describe('createContentDeleter construction (Step 15b)', () => {
  const base = (): ContentDeleterOptions => ({
    supabaseUrl: SUPABASE_URL,
    secretKey: new Secret(FAKE_KEY),
    storyId: ID,
  })
  // A secret-shaped key, so g5's 8-character non-secret-shaped loopback key is its own sample, not this
  // precondition's (B15B-mut-4).
  const loop = (): ContentDeleterOptions => ({
    supabaseUrl: LOOPBACK_URL,
    secretKey: new Secret(FAKE_KEY),
    storyId: ID,
    fetchImpl: recorder().fetchImpl,
  })
  const make = (options: unknown) => () => createContentDeleter(options as ContentDeleterOptions)

  it("T15B-8 construction: the client's origin, key, fetch and timeout rules, read once from own data properties, the URL re-parsed; refusals are 'refused: deleter option <rule>' (A13, D15B-13, CRIT-4, L13, TP-12)", async () => {
    const refusals: unknown[] = []
    const rule = (options: unknown): string => {
      const error = thrown(make(options))
      if (error !== null) refusals.push(error)
      return ruleOf(make(options))
    }
    expect(rule(base()), 'precondition: the https sample constructs').toBe('ok')
    expect(rule(loop()), 'precondition: the loopback sample constructs').toBe('ok')
    expect(
      rule({ ...base(), supabaseUrl: new URL(`https://${REF}.supabase.co:443/`) }),
      'precondition: :443 constructs (the parser drops the default port, TP-12)',
    ).toBe('ok')
    expect(
      rule({ ...base(), supabaseUrl: new URL(`https://${REF.toUpperCase()}.SUPABASE.CO`) }),
      'precondition: an upper-case host constructs (the URL parser lowercases it)',
    ).toBe('ok')

    // (g1) url-origin
    const origins: readonly (readonly [string, string, boolean])[] = [
      ['http on the Supabase host', `http://${REF}.supabase.co`, false],
      ['a 19-character ref', `https://${REF.slice(1)}.supabase.co`, false],
      ['port 8443', `https://${REF}.supabase.co:8443/`, false],
      ['a path', `https://${REF}.supabase.co/x`, false],
      ['credentials', `https://u:p@${REF}.supabase.co`, false],
      ['a search', `https://${REF}.supabase.co/?q`, false],
      ['a hash', `https://${REF}.supabase.co/#h`, false],
      ['a suffix host', `https://${REF}.supabase.co.evil.example`, false],
      ['https on loopback', 'https://127.0.0.1:9', false],
      ['loopback without a port', 'http://127.0.0.1', true],
      ['another loopback-like host', 'http://127.0.0.2:9', true],
    ]
    for (const [label, href, loopback] of origins) {
      const options = loopback
        ? { ...loop(), supabaseUrl: new URL(href) }
        : { ...base(), supabaseUrl: new URL(href) }
      expect.soft(rule(options), `(g1) url-origin ${label}`).toBe('url-origin')
    }
    for (const href of ['http://localhost:9', 'http://[::1]:9']) {
      expect
        .soft(rule({ ...loop(), supabaseUrl: new URL(href) }), `(g1) accepted ${href}`)
        .toBe('ok')
    }

    // (g2) forged URLs
    const allowed = `https://${REF}.supabase.co`
    expect
      .soft(
        rule({ ...base(), supabaseUrl: lyingUrl('https://evil.example/', allowed) }),
        '(g2) a URL subclass with lying getters over evil.example',
      )
      .toBe('url-origin')
    expect
      .soft(
        rule({ ...base(), supabaseUrl: prototypeOnlyUrl(allowed) }),
        '(g2) Object.create(URL.prototype) with getters',
      )
      .toBe('url-origin')
    const plain = new URL(allowed)
    expect
      .soft(
        rule({
          ...base(),
          supabaseUrl: {
            href: plain.href,
            origin: plain.origin,
            hostname: plain.hostname,
            protocol: plain.protocol,
          },
        }),
        '(g2) a plain object',
      )
      .toBe('url-origin')
    const port = 47_381
    const sneaky = recorder()
    const forged = createContentDeleter({
      supabaseUrl: lyingUrl(`http://127.0.0.1:${port}`, 'http://127.0.0.1:1'),
      secretKey: new Secret(FAKE_KEY),
      storyId: ID,
      fetchImpl: sneaky.fetchImpl,
    })
    await forged.remove('content', [WEBP])
    expect
      .soft(
        sneaky.calls.map((call) => new URL(call.url).origin),
        '(g2) a loopback subclass whose origin lies: the DELETE goes to the real port',
      )
      .toEqual([`http://127.0.0.1:${port}`])

    // (g3) options read once from own data properties
    const optionKeys: readonly (readonly [string, unknown])[] = [
      ['bearerFallback: false', { ...base(), bearerFallback: false }],
      ['guards', { ...base(), guards: { allowedBuckets: ['content'] } }],
      ['listPageSize: 1', { ...base(), listPageSize: 1 }],
      ['a symbol key', { ...base(), [Symbol('x')]: 1 }],
      [
        'a non-enumerable storyId',
        Object.defineProperty({ ...base(), storyId: undefined }, 'storyId', {
          value: ID,
          enumerable: false,
        }),
      ],
      [
        'a class instance',
        new (class Options {
          supabaseUrl = SUPABASE_URL
          secretKey = new Secret(FAKE_KEY)
          storyId = ID
        })(),
      ],
      ['an array', [SUPABASE_URL, new Secret(FAKE_KEY), ID]],
      ['null', null],
      [
        'a Proxy whose prototype trap answers a class prototype',
        new Proxy(base(), { getPrototypeOf: () => Map.prototype }),
      ],
    ]
    for (const [label, options] of optionKeys) {
      expect.soft(rule(options), `(g3) option-keys ${label}`).toBe('option-keys')
    }
    let getterRuns = 0
    const withGetter = { ...base() } as Record<string, unknown>
    delete withGetter.storyId
    Object.defineProperty(withGetter, 'storyId', {
      get: () => {
        getterRuns++
        return ID
      },
      enumerable: true,
    })
    expect.soft(rule(withGetter), '(g3) option-accessor a getter storyId').toBe('option-accessor')
    expect.soft(getterRuns, '(g3) the getter never runs').toBe(0)
    let descriptorReads = 0
    const flipping = new Proxy(loop(), {
      getOwnPropertyDescriptor(target, key) {
        const own = Reflect.getOwnPropertyDescriptor(target, key)
        if (key !== 'storyId' || own === undefined) return own
        descriptorReads++
        return { ...own, value: descriptorReads === 1 ? ID : 'river-stones' }
      },
      get(target, key, receiver) {
        return key === 'storyId' ? 'river-stones' : Reflect.get(target, key, receiver)
      },
    })
    let bound: ContentDeleter | null = null
    expect(
      ruleOf(() => (bound = createContentDeleter(flipping))),
      'precondition: the flipping Proxy constructs (read once)',
    ).toBe('ok')
    const later = bound
      ? await (bound as ContentDeleter)
          .remove('content', [`packages/river-stones/${hex('e')}.json`])
          .then(
            () => 'sent',
            (error: unknown) => (error instanceof Error ? error.message : String(error)),
          )
      : 'did not construct'
    expect
      .soft(later, '(g3) a flipping descriptor Proxy: bound to two-paths, river-stones refused')
      .toBe('refused: delete class-pattern story-id')

    // (g4) fetch-impl
    expect
      .soft(rule({ ...base(), fetchImpl: recorder().fetchImpl }), '(g4) a fetchImpl with https')
      .toBe('fetch-impl')
    expect
      .soft(rule({ ...loop(), fetchImpl: 'fetch' }), '(g4) a non-function fetchImpl on loopback')
      .toBe('fetch-impl')

    // (g5) key-short, key-shape
    for (const [label, key] of [
      ['short', new Secret('short')],
      ['a 7-character key', new Secret('abcdefg')],
      ['a plain string', FAKE_KEY],
    ] as const) {
      expect.soft(rule({ ...base(), secretKey: key }), `(g5) key-short ${label}`).toBe('key-short')
    }
    expect
      .soft(
        rule({ ...base(), secretKey: new Secret(PUBLISHABLE_KEY) }),
        '(g5) key-shape a publishable-shaped key on https',
      )
      .toBe('key-shape')
    expect
      .soft(
        rule({ ...loop(), secretKey: new Secret('abcdefgh') }),
        '(g5) accepted: a non-secret-shaped 8-character key on loopback',
      )
      .toBe('ok')

    // (g6) story-id
    const storyIds: readonly (readonly [string, unknown])[] = [
      ['Lion', 'Lion'],
      ['ab', 'ab'],
      ['65 characters', 'a'.repeat(65)],
      ['a--b', 'a--b'],
      ['a lone surrogate', `${ID}\ud800`],
      ['the number 7', 7],
      ['a canary', `${CANARY}-x`],
    ]
    for (const [label, storyId] of storyIds) {
      expect.soft(rule({ ...base(), storyId }), `(g6) story-id ${label}`).toBe('story-id')
    }
    const noStory = { ...base() } as Record<string, unknown>
    delete noStory.storyId
    expect.soft(rule(noStory), '(g6) story-id absent').toBe('story-id')

    // (g7) timeout
    for (const timeoutMs of [0, 600_001, 1.5, '1000', Number.NaN]) {
      expect
        .soft(rule({ ...base(), timeoutMs }), `(g7) timeout ${String(timeoutMs)}`)
        .toBe('timeout')
    }
    for (const timeoutMs of [1, 600_000]) {
      expect.soft(rule({ ...base(), timeoutMs }), `(g7) accepted ${timeoutMs}`).toBe('ok')
    }

    // (g8) every refusal: a TypeError with the fixed text and no value in it
    expect(refusals.length, 'precondition: refusals were collected').toBeGreaterThan(30)
    for (const error of refusals) {
      const message = error instanceof Error ? error.message : String(error)
      expect.soft(error instanceof TypeError, `(g8) a TypeError ${message}`).toBe(true)
      expect
        .soft(/^refused: deleter option [a-z-]+$/.test(message), `(g8) the fixed text ${message}`)
        .toBe(true)
      for (const value of [FAKE_KEY, PUBLISHABLE_KEY, REF, 'evil', 'supabase', 'Lion', CANARY]) {
        expect
          .soft(
            message.toLowerCase().includes(value.toLowerCase()),
            `(g8) ${message} holds no ${value}`,
          )
          .toBe(false)
      }
    }
  })

  it('T15B-9 parity: every shared construction sample gives the client and the deleter the same rule word (CRIT-4, AUD-2)', () => {
    /** The sample plus storyId, every other descriptor and the prototype kept (never spread). */
    const withStoryId = (sample: unknown): unknown =>
      sample === null || typeof sample !== 'object'
        ? sample
        : Object.defineProperty(
            Object.create(
              Object.getPrototypeOf(sample) as object | null,
              Object.getOwnPropertyDescriptors(sample),
            ) as object,
            'storyId',
            { value: ID, enumerable: true, writable: true, configurable: true },
          )
    const https = (extra: Record<string, unknown> = {}) => ({
      supabaseUrl: SUPABASE_URL,
      secretKey: new Secret(FAKE_KEY),
      ...extra,
    })
    const looped = (extra: Record<string, unknown> = {}) => ({
      supabaseUrl: LOOPBACK_URL,
      secretKey: new Secret('abcdefgh'),
      fetchImpl: recorder().fetchImpl,
      ...extra,
    })
    const client = (sample: unknown) =>
      ruleOf(() => createStorageClient(sample as Parameters<typeof createStorageClient>[0]))
    const ours = (sample: unknown) =>
      ruleOf(() => createContentDeleter(withStoryId(sample) as ContentDeleterOptions))
    expect(
      [client(looped()), ours(looped())],
      'precondition: a loopback sample constructs both',
    ).toEqual(['ok', 'ok'])

    const getter = (key: string) => {
      const sample: Record<string, unknown> = looped()
      Object.defineProperty(sample, key, { get: () => 1000, enumerable: true })
      return sample
    }
    const allowed = `https://${REF}.supabase.co`
    const refusals: readonly (readonly [string, unknown])[] = [
      ['http on the Supabase host', https({ supabaseUrl: new URL(`http://${REF}.supabase.co`) })],
      [
        'a 19-character ref',
        https({ supabaseUrl: new URL(`https://${REF.slice(1)}.supabase.co`) }),
      ],
      ['port 8443', https({ supabaseUrl: new URL(`https://${REF}.supabase.co:8443/`) })],
      ['a path', https({ supabaseUrl: new URL(`https://${REF}.supabase.co/x`) })],
      ['credentials', https({ supabaseUrl: new URL(`https://u:p@${REF}.supabase.co`) })],
      ['a search', https({ supabaseUrl: new URL(`https://${REF}.supabase.co/?q`) })],
      ['a hash', https({ supabaseUrl: new URL(`https://${REF}.supabase.co/#h`) })],
      ['a suffix host', https({ supabaseUrl: new URL(`https://${REF}.supabase.co.evil.example`) })],
      ['https on loopback', https({ supabaseUrl: new URL('https://127.0.0.1:9') })],
      ['loopback without a port', looped({ supabaseUrl: new URL('http://127.0.0.1') })],
      ['another loopback-like host', looped({ supabaseUrl: new URL('http://127.0.0.2:9') })],
      ['a lying URL subclass', https({ supabaseUrl: lyingUrl('https://evil.example/', allowed) })],
      ['a prototype-only URL', https({ supabaseUrl: prototypeOnlyUrl(allowed) })],
      [
        'a plain object URL',
        https({ supabaseUrl: { href: `${allowed}/`, hostname: `${REF}.supabase.co` } }),
      ],
      ['a fetchImpl with https', https({ fetchImpl: recorder().fetchImpl })],
      ['a non-function fetchImpl', looped({ fetchImpl: 'fetch' })],
      ['short', https({ secretKey: new Secret('short') })],
      ['a 7-character key', looped({ secretKey: new Secret('abcdefg') })],
      ['a plain string key', https({ secretKey: FAKE_KEY })],
      ['a publishable-shaped key', https({ secretKey: new Secret(PUBLISHABLE_KEY) })],
      ['timeout 0', https({ timeoutMs: 0 })],
      ['timeout 600001', https({ timeoutMs: 600_001 })],
      ['timeout 1.5', https({ timeoutMs: 1.5 })],
      ["timeout '1000'", https({ timeoutMs: '1000' })],
      ['timeout NaN', https({ timeoutMs: Number.NaN })],
      ['a getter on timeoutMs', getter('timeoutMs')],
      ['a getter on bogus', getter('bogus')],
      [
        'a non-enumerable timeoutMs',
        Object.defineProperty(looped(), 'timeoutMs', { value: 1000, enumerable: false }),
      ],
      ['a symbol key', looped({ [Symbol('x')]: 1 })],
      [
        'a class instance',
        new (class Options {
          supabaseUrl = LOOPBACK_URL
          secretKey = new Secret('abcdefgh')
        })(),
      ],
      ['an array', [LOOPBACK_URL, new Secret('abcdefgh')]],
      ['null', null],
    ]
    const accepted: readonly (readonly [string, unknown])[] = [
      ['the https base', https()],
      [':443', https({ supabaseUrl: new URL(`https://${REF}.supabase.co:443/`) })],
      ['localhost', looped({ supabaseUrl: new URL('http://localhost:9') })],
      ['[::1]', looped({ supabaseUrl: new URL('http://[::1]:9') })],
      [
        'a lying loopback subclass',
        looped({ supabaseUrl: lyingUrl('http://127.0.0.1:9', 'http://127.0.0.1:1') }),
      ],
      ['an 8-character key on loopback', looped({ secretKey: new Secret('abcdefgh') })],
      ['timeout 1', https({ timeoutMs: 1 })],
      ['timeout 600000', https({ timeoutMs: 600_000 })],
    ]
    for (const [label, sample] of refusals) {
      expect(client(sample), `precondition: ${label} is a client refusal`).not.toBe('ok')
    }
    // (g1) the same rule word for every sample
    for (const [label, sample] of [...refusals, ...accepted]) {
      expect.soft(ours(sample), `(g1) ${label}`).toBe(client(sample))
    }
  })
})

// ---- remove (Step 15b, D15B-13) ----

describe('remove (Step 15b)', () => {
  it('T15B-10 remove: refusals in order, each a StorageRefusedError whose fixed text isStorageRefusal accepts; nothing sent; the paths copied before any await (A13, L14, CRIT-15)', async () => {
    const { remover, calls } = deleter()
    expect(await remover.remove('content', [WEBP]), 'precondition: one path sends').toEqual({
      kind: 'removed',
      paths: [WEBP],
    })
    expect(calls.length, 'precondition: exactly one request').toBe(1)
    const refusals: { error: unknown; sample: string }[] = []
    /** The refusal text of one call, recording it and checking that it sent nothing. */
    const refusalOf = async (bucket: unknown, paths: unknown, sample: string): Promise<string> => {
      const before = calls.length
      try {
        await remover.remove(bucket as string, paths as string[])
        return 'sent'
      } catch (error) {
        refusals.push({ error, sample })
        return error instanceof Error ? error.message : String(error)
      } finally {
        expect.soft(calls.length - before, `(g7) no request for ${sample}`).toBe(0)
      }
    }
    const classPaths = (count: number) =>
      Array.from({ length: count }, (_v, i) => `media/${ID}/${hex('a')}-w${i}.webp`)

    // (g1) buckets
    for (const bucket of ['masters', 'Content', 'content ', 'content/x', '', 'other']) {
      expect
        .soft(
          await refusalOf(bucket, [WEBP], `bucket ${bucket}`),
          `(g1) bucket ${JSON.stringify(bucket)}`,
        )
        .toBe('refused: delete field bucket')
    }
    expect
      .soft(await refusalOf('masters', [], 'masters []'), '(g1) masters with [] is still bucket')
      .toBe('refused: delete field bucket')

    // (g2) paths
    expect.soft(await refusalOf('content', {}, '{}'), '(g2) {}').toBe('refused: delete field paths')
    expect
      .soft(await refusalOf('content', 'x', "'x'"), "(g2) 'x'")
      .toBe('refused: delete field paths')
    expect
      .soft(await refusalOf('content', [], '[]'), '(g2) []')
      .toBe('refused: delete field path-count')
    expect
      .soft(await refusalOf('content', classPaths(101), '101 paths'), '(g2) 101 class paths')
      .toBe('refused: delete field path-count')
    const sent = calls.length
    expect
      .soft(
        await remover
          .remove('content', classPaths(100))
          .catch((error: unknown) => (error instanceof Error ? error.message : String(error))),
        '(g2) 100 class paths are removed',
      )
      .toEqual({ kind: 'removed', paths: classPaths(100) })
    expect.soft(calls.length - sent, '(g2) 100 class paths: sent once').toBe(1)
    expect
      .soft(await refusalOf('content', [1], '[1]'), '(g2) [1]')
      .toBe('refused: delete field paths')
    expect
      .soft(await refusalOf('content', [WEBP, WEBP], '[p, p]'), '(g2) [p, p]')
      .toBe('refused: delete field path-repeated')
    expect
      .soft(
        await refusalOf(
          'content',
          Array.from({ length: 101 }, () => 1),
          '101 numbers',
        ),
        '(g2) 101 entries holding a number: the length first',
      )
      .toBe('refused: delete field path-count')

    // (g3) unsafe paths
    const unsafe = [
      `packages/${ID}/../x.json`,
      '%2e%2e/x',
      `media//${ID}/x.webp`,
      `media\\${ID}\\x.webp`,
      `/${WEBP}`,
      `${WEBP}/`,
      `${WEBP}?x=1`,
      `${WEBP}#f`,
      `${WEBP} `,
      `media/${ID}/\ud800.webp`,
      `media/${ID}/${CANARY} x.webp`,
    ]
    for (const path of unsafe) {
      expect
        .soft(await refusalOf('content', [path], path), `(g3) unsafe-path ${JSON.stringify(path)}`)
        .toBe('refused: delete class-pattern unsafe-path')
    }

    // (g4) not a package or media path
    const classless = [
      'catalogue/production.json',
      'catalogue/staging.json',
      'catalogue/snapshots/1.json',
      `approvals/${ID}/${hex('d')}.json`,
      `waivers/${ID}/${hex('d')}.json`,
      `media/${ID}/${hex('A')}-w768.webp`,
      `media/${ID}/${hex('a')}-w768.png`,
      `packages/${ID}/${hex('d')}.JSON`,
      `media/${ID}/${hex('a')}-w768.mp3.bak`,
      `packages/${ID}/sub/${hex('d')}.json`,
      `media/${ID}/${CANARY}.webp`,
    ]
    for (const path of classless) {
      expect
        .soft(await refusalOf('content', [path], path), `(g4) class-pattern ${path}`)
        .toBe('refused: delete class-pattern class-pattern')
    }

    // (g5) another story
    for (const path of [
      `packages/river-stones/${hex('d')}.json`,
      `media/${ID}-x/${hex('a')}-w768.webp`,
      `media/two/${hex('a')}-w768.webp`,
    ]) {
      expect
        .soft(await refusalOf('content', [path], path), `(g5) story-id ${path}`)
        .toBe('refused: delete class-pattern story-id')
    }
    const lion = deleter(undefined, 'lion')
    const neighbour = `media/lion-and-hare/${hex('a')}-w768.webp`
    const lionRefusal = await lion.remover.remove('content', [neighbour]).then(
      () => 'sent',
      (error: unknown) => {
        refusals.push({ error, sample: neighbour })
        return error instanceof Error ? error.message : String(error)
      },
    )
    expect
      .soft(lionRefusal, '(g5) a deleter bound to lion refuses lion-and-hare')
      .toBe('refused: delete class-pattern story-id')
    expect.soft(lion.calls.length, '(g7) no request for lion-and-hare').toBe(0)

    // (g6) the paths copied at entry
    const copyCase = deleter()
    const mutable = [WEBP]
    const done = copyCase.remover.remove('content', mutable)
    mutable[0] = 'catalogue/production.json'
    await done.catch(() => undefined)
    expect
      .soft(
        copyCase.calls.map((call) => String(call.body)),
        '(g6) a mutated array: the body names the own path',
      )
      .toEqual([JSON.stringify({ prefixes: [WEBP] })])
    const proxyCase = deleter()
    let indexReads = 0
    const shifting = new Proxy([WEBP], {
      get(target, key, receiver) {
        if (key === '0') {
          indexReads++
          return indexReads === 1 ? WEBP : 'catalogue/production.json'
        }
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    await proxyCase.remover.remove('content', shifting)
    expect
      .soft(
        proxyCase.calls.map((call) => String(call.body)),
        '(g6) a Proxy array whose later reads differ: the body names the own path',
      )
      .toEqual([JSON.stringify({ prefixes: [WEBP] })])

    // (g7) every refusal: isStorageRefusal, and no sample in the message
    expect(refusals.length, 'precondition: refusals were collected').toBeGreaterThan(30)
    for (const { error, sample } of refusals) {
      const message = error instanceof Error ? error.message : String(error)
      expect.soft(isStorageRefusal(error), `(g7) isStorageRefusal ${sample}`).toBe(true)
      expect
        .soft(sample.length > 3 && message.includes(sample), `(g7) the message holds no ${sample}`)
        .toBe(false)
      expect
        .soft(message.includes(CANARY), `(g7) the message holds no canary ${sample}`)
        .toBe(false)
    }
  })

  it('T15B-11 one exact DELETE and its typed results: removed, count-mismatch, unauthorized, failed, unreadable, network; a code repeating the key becomes unknown (A13, L15)', async () => {
    const paths = [WEBP, MP3]
    const results: unknown[] = []
    const once = async (respond: Respond, asked: readonly string[] = paths) => {
      const { remover, calls } = deleter(respond)
      const result = await remover.remove('content', asked)
      results.push(result)
      return { result, calls }
    }

    // (g1) the exact request
    const exact = await once(allRemoved)
    expect(exact.result, 'precondition: removed').toEqual({ kind: 'removed', paths })
    const [call] = exact.calls
    expect
      .soft(
        call === undefined
          ? null
          : {
              url: call.url,
              method: call.method,
              headers: call.headers,
              body: call.body,
              redirect: call.redirect,
            },
        '(g1) the one DELETE',
      )
      .toEqual({
        url: `${LOOPBACK_URL.origin}/storage/v1/object/content`,
        method: 'DELETE',
        headers: {
          apikey: FAKE_KEY,
          'content-type': 'application/json',
          'accept-encoding': 'identity',
        },
        body: JSON.stringify({ prefixes: paths }),
        redirect: 'manual',
      })
    expect.soft(call?.signal instanceof AbortSignal, '(g1) an AbortSignal').toBe(true)
    expect.soft(exact.calls.length, '(g1) exactly one request').toBe(1)
    expect
      .soft(Object.keys(call?.headers ?? {}).includes('authorization'), '(g1) no authorization')
      .toBe(false)

    // (g2) rows in another order
    const reversed = await once(() => json(200, [{ name: MP3 }, { name: WEBP }]))
    expect.soft(reversed.result, '(g2) rows in another order: removed, request order').toEqual({
      kind: 'removed',
      paths,
    })

    // (g3) count mismatches
    expect
      .soft((await once(() => json(200, [{ name: WEBP }]))).result, '(g3) fewer rows')
      .toEqual({ kind: 'count-mismatch', removed: [WEBP], notRemoved: [MP3], unexpected: [] })
    expect
      .soft(
        (await once(() => json(200, [{ name: WEBP }, { name: MP3 }, { name: WIDE }]))).result,
        '(g3) an extra row',
      )
      .toEqual({ kind: 'count-mismatch', removed: paths, notRemoved: [], unexpected: [WIDE] })
    expect
      .soft(
        (await once(() => json(200, [{ name: WEBP }, { name: MP3 }, { name: MP3 }]))).result,
        '(g3) a duplicated row',
      )
      .toEqual({ kind: 'count-mismatch', removed: paths, notRemoved: [], unexpected: [] })

    // (g4) the other answers
    expect
      .soft((await once(() => json(200, []))).result, '(g4) [] → every path not removed')
      .toEqual({ kind: 'count-mismatch', removed: [], notRemoved: paths, unexpected: [] })
    expect
      .soft((await once(() => json(200, {}))).result, '(g4) {} → unreadable-response')
      .toEqual({ kind: 'failed', status: 200, code: 'unreadable-response' })
    expect
      .soft((await once(() => json(403, { code: 'AccessDenied' }))).result, '(g4) 403')
      .toEqual({ kind: 'unauthorized', status: 403 })
    expect
      .soft((await once(() => json(401, { error: 'Unauthorized' }))).result, '(g4) 401')
      .toEqual({ kind: 'unauthorized', status: 401 })
    expect
      .soft((await once(() => json(400, { code: 'InvalidKey' }))).result, '(g4) 400 InvalidKey')
      .toEqual({ kind: 'failed', status: 400, code: 'InvalidKey' })
    expect
      .soft((await once(() => json(503, { error: 'Unavailable' }))).result, '(g4) 503')
      .toEqual({ kind: 'failed', status: 503, code: 'Unavailable' })

    // (g5) a network error
    const reset = await once(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    })
    expect
      .soft(
        reset.result,
        '(g5) a rejected fetch: failed, status null, the error name and cause code',
      )
      .toEqual({ kind: 'failed', status: null, code: 'TypeError (ECONNRESET)' })

    // (g6) the key never reaches a result
    const partial = FAKE_KEY.slice('sb_secret_'.length)
    expect
      .soft((await once(() => json(502, { error: partial }))).result, '(g6) a 502 echoing the key')
      .toEqual({ kind: 'failed', status: 502, code: 'unknown' })
    const keyCause = await once(() => {
      throw new TypeError('fetch failed', { cause: { code: partial.replaceAll('-', '_') } })
    })
    expect
      .soft(keyCause.result, '(g6) a network cause code holding a run of the key')
      .toEqual({ kind: 'failed', status: null, code: 'unknown' })
    const run = FAKE_KEY.slice(-8)
    for (const result of results) {
      const text = JSON.stringify(result)
      expect.soft(text.includes(run), `(g6) no key run in ${text}`).toBe(false)
    }
  })

  it('T15B-12 over the stub with deletes: the logged request, apikey only, accept-encoding exactly identity; the store after; an absent path is not removed (A13, A15, CRIT-2)', async () => {
    const stub = await startStorageStub({ apikey: FAKE_KEY, deletes: true })
    try {
      const text = (value: string) => new TextEncoder().encode(value)
      const stubOnly = `media/${ID}/${hex('a')}-w768.webpx`
      const river = `media/river-stones/${hex('f')}-w768.webp`
      const approval = `approvals/${ID}/${hex('d')}.json`
      stub.put('content', PACKAGE, text('{"p":1}'), 'application/json')
      stub.put('content', WEBP, text('webp'), 'image/webp')
      stub.put('content', MP3, text('mp3'), 'audio/mpeg')
      stub.put('content', stubOnly, text('webpx'), 'image/webp')
      stub.put('content', river, text('river'), 'image/webp')
      stub.put('masters', approval, text('{"a":1}'), 'application/json')
      const remover = createContentDeleter({
        supabaseUrl: stub.origin,
        secretKey: new Secret(FAKE_KEY),
        storyId: ID,
      })
      const asked = [PACKAGE, WEBP, MP3]
      expect(
        asked.every((path) => stub.object('content', path) !== undefined),
        'precondition: the three two-paths objects are stored',
      ).toBe(true)

      // (g1) removed, and only those three
      const result = await remover.remove('content', asked)
      expect.soft(result, '(g1) removed').toEqual({ kind: 'removed', paths: asked })
      expect
        .soft(
          asked.map((path) => stub.object('content', path)),
          '(g1) each removed object is gone',
        )
        .toEqual([undefined, undefined, undefined])
      expect
        .soft(stub.object('content', stubOnly)?.bytes, '(g1) the .webpx object is byte-identical')
        .toEqual(text('webpx'))
      expect
        .soft(
          stub.object('content', river)?.bytes,
          '(g1) the river-stones object is byte-identical',
        )
        .toEqual(text('river'))
      expect
        .soft(stub.object('masters', approval)?.bytes, '(g1) the masters object is byte-identical')
        .toEqual(text('{"a":1}'))

      // (g2) the log
      const deletes = stub.requests.filter((entry) => entry.method === 'DELETE')
      expect.soft(deletes.length, '(g2) one DELETE logged').toBe(1)
      const [entry] = deletes
      expect
        .soft([entry?.pathname, entry?.search], '(g2) DELETE /storage/v1/object/content, no search')
        .toEqual(['/storage/v1/object/content', ''])
      expect
        .soft([entry?.apikeyMatched, entry?.authorization], '(g2) apikey only')
        .toEqual([true, 'absent'])
      expect
        .soft(entry?.values['content-type'], '(g2) content-type application/json')
        .toBe('application/json')
      expect
        .soft(entry?.values['accept-encoding'], '(g2) accept-encoding exactly identity')
        .toBe('identity')
      expect
        .soft(
          entry ? (JSON.parse(new TextDecoder().decode(entry.body)) as unknown) : null,
          '(g2) the body is exactly the prefixes asked',
        )
        .toEqual({ prefixes: asked })

      // (g3) an absent path
      const absent = `media/${ID}/${hex('9')}-w768.webp`
      const missing = await remover.remove('content', [absent])
      expect
        .soft(missing, '(g3) an absent path: count-mismatch, not removed')
        .toEqual({ kind: 'count-mismatch', removed: [], notRemoved: [absent], unexpected: [] })
      expect
        .soft(
          [stub.object('content', stubOnly)?.bytes, stub.object('content', river)?.bytes],
          '(g3) the store unchanged',
        )
        .toEqual([text('webpx'), text('river')])
      expectNoUnexpected(stub)
    } finally {
      await stub.close()
    }
  })
})
