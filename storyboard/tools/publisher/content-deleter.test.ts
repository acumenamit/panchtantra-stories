// The nine remove() tests moved from storage.test.ts at Step 13 (owner item 1 option 1; design
// p1-step13-design.md §3.2, §13.8 D1-D9). Bodies unchanged; only the imports, the constructor name
// (createContentDeleter) and the halves that tested upload or list are gone. The deleter keeps its
// own inline server; the storage stub treats DELETE as unexpected.
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkRemoved,
  createContentDeleter,
  isUnderPrefix,
  MAX_REMOVE_PATHS,
  type ContentDeleterOptions,
  type StorageGuards,
} from './content-deleter'
import { Secret } from './env'
import { StorageRefusedError } from './storage'

// Assembled at runtime, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-storage-test-key'].join('_')
const SUPABASE_URL = new URL('https://abcdefghijklmnopqrst.supabase.co')
const POINTER = 'spikes/run/catalogue/production.json'
const FRESHNESS = 'spikes/run/freshness/r1/pointer.json'
const CLIP = 'spikes/audio/clip.mp3'
const GUARDS: StorageGuards = {
  allowedBuckets: ['content'],
  writePrefixes: ['spikes/'],
  overwritablePaths: [POINTER, FRESHNESS],
}

interface Call {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: unknown
  readonly redirect: RequestRedirect | undefined
}

type Respond = (call: Call, index: number) => Response | Promise<Response>

function recorder(respond: Respond = () => json(200, { Key: 'content/x', Id: 'id' })) {
  const calls: Call[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: init?.body,
      redirect: init?.redirect,
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

function client(respond?: Respond, extra: Partial<ContentDeleterOptions> = {}) {
  const fake = recorder(respond)
  const storage = createContentDeleter({
    supabaseUrl: SUPABASE_URL,
    secretKey: new Secret(FAKE_KEY),
    guards: GUARDS,
    fetchImpl: fake.fetchImpl,
    ...extra,
  })
  return { storage, calls: fake.calls }
}

async function expectRefused(promise: Promise<unknown>, message: string): Promise<void> {
  await expect(promise).rejects.toThrow(StorageRefusedError)
  await expect(promise).rejects.toThrow(message)
}

const UNSAFE_PATHS = [
  '',
  '../spikes/x.json',
  'spikes/../masters/x.json',
  '/spikes/x.json',
  'spikes/x.json?upsert=true',
  'spikes/x.json#frag',
  'spikes\\x.json',
  'spikes//x.json',
  'spikes/x y.json',
  'spikes/.hidden',
  'spikes/x.json/',
]

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

// ---- configuration ----

describe('createContentDeleter configuration', () => {
  const make = (extra: Partial<ContentDeleterOptions>) => () =>
    createContentDeleter({
      supabaseUrl: SUPABASE_URL,
      secretKey: new Secret(FAKE_KEY),
      guards: GUARDS,
      ...extra,
    })

  it('refuses invalid guards', () => {
    const cases: [Partial<StorageGuards>, string][] = [
      [{ allowedBuckets: [] }, 'allowedBuckets must not be empty'],
      [{ allowedBuckets: ['Content/x'] }, 'invalid bucket name'],
      [{ writePrefixes: [] }, 'writePrefixes must not be empty'],
      [{ writePrefixes: [''] }, 'must be a safe folder'],
      [{ writePrefixes: ['spikes'] }, 'must be a safe folder'],
      [{ writePrefixes: ['../'] }, 'must be a safe folder'],
      [{ overwritablePaths: ['catalogue/production.json'] }, 'must be safe and under a prefix'],
      [{ overwritablePaths: ['spikes/../x.json'] }, 'must be safe and under a prefix'],
    ]
    for (const [override, message] of cases) {
      expect(make({ guards: { ...GUARDS, ...override } })).toThrow(message)
    }
  })

  // Review fix FID-2: the deleter's two construction guards came with the code, so their HEAD tests
  // (storage.test.ts at a6622a8, 'refuses a non-https Supabase URL except on loopback' and the key
  // half of 'refuses a short key and a bad page size') come too; the page-size half has no deleter.
  it('refuses a non-https Supabase URL except on loopback', () => {
    expect(make({ supabaseUrl: new URL('http://abcdefghijklmnopqrst.supabase.co') })).toThrow(
      'supabaseUrl must use https',
    )
    expect(make({ supabaseUrl: new URL('http://127.0.0.1:9') })).not.toThrow()
  })

  it('refuses a short key', () => {
    expect(make({ secretKey: new Secret('short') })).toThrow('secretKey is too short')
  })
})

// ---- remove ----

describe('remove', () => {
  const paths = ['spikes/cdn/r1/probe.json', 'spikes/cdn/r1/probe.webp']

  it('sends the exact DELETE and confirms every path', async () => {
    const { storage, calls } = client(() =>
      json(
        200,
        paths.map((name) => ({ name, bucket_id: 'content' })),
      ),
    )
    expect(await storage.remove('content', paths)).toEqual({ kind: 'removed', paths })
    expect(calls).toEqual([
      {
        url: 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/content',
        method: 'DELETE',
        headers: { apikey: FAKE_KEY, 'content-type': 'application/json' },
        body: '{"prefixes":["spikes/cdn/r1/probe.json","spikes/cdn/r1/probe.webp"]}',
        redirect: 'manual',
      },
    ])
  })

  it('reports a count mismatch when Storage deletes fewer objects', async () => {
    const { storage } = client(() => json(200, [{ name: paths[0] }]))
    expect(await storage.remove('content', paths)).toEqual({
      kind: 'count-mismatch',
      removed: [paths[0]],
      notRemoved: [paths[1]],
      unexpected: [],
    })
  })

  it('returns unauthorized and failed results', async () => {
    const answers = [json(403, { code: 'AccessDenied' }), json(400, { code: 'InvalidKey' })]
    const { storage } = client((_call, index) => answers[index]!)
    expect(await storage.remove('content', paths)).toEqual({ kind: 'unauthorized', status: 403 })
    expect(await storage.remove('content', paths)).toEqual({
      kind: 'failed',
      status: 400,
      code: 'InvalidKey',
    })
  })

  it('refuses masters, other buckets, outside paths, unsafe paths, empty, duplicate and oversized lists', async () => {
    const { storage, calls } = client(undefined, {
      guards: { ...GUARDS, allowedBuckets: ['content', 'masters'] },
    })
    await expectRefused(
      storage.remove('masters', ['spikes/canary.txt']),
      'refused: bucket "masters" is never written to or deleted from',
    )
    await expectRefused(storage.remove('other', paths), 'is not in the allowed bucket list')
    await expectRefused(
      storage.remove('content', [paths[0]!, 'catalogue/production.json']),
      'refused: path "catalogue/production.json" is outside the write prefixes',
    )
    for (const path of UNSAFE_PATHS) {
      await expectRefused(storage.remove('content', [path]), 'refused: unsafe path')
    }
    await expectRefused(storage.remove('content', []), 'refused: remove needs at least one path')
    await expectRefused(
      storage.remove('content', [paths[0]!, paths[0]!]),
      'refused: remove paths must be unique',
    )
    const many = Array.from({ length: MAX_REMOVE_PATHS + 1 }, (_v, i) => `spikes/${i}.json`)
    await expectRefused(storage.remove('content', many), `at most ${MAX_REMOVE_PATHS} paths`)
    expect(calls).toHaveLength(0)
  })
})

// ---- secrets ----

describe('the key never leaves the client', () => {
  it('drops a code that repeats part of the key without its sb_ start', async () => {
    const partial = FAKE_KEY.slice('sb_secret_'.length) // a valid-looking token on its own
    const respond = () => json(502, { error: partial })
    const { storage } = client(respond)
    expect(await storage.remove('content', [CLIP])).toEqual({
      kind: 'failed',
      status: 502,
      code: 'unknown',
    })
  })
})

// ---- over the wire ----

interface SeenRequest {
  readonly method: string
  readonly url: string
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
}

describe('over a local HTTP server', () => {
  let server: Server
  let base: URL
  let seen: SeenRequest[]
  let answer: (req: IncomingMessage, res: ServerResponse) => void

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks),
        })
        answer(req, res)
      })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  })

  beforeEach(() => {
    seen = []
    answer = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"Key":"content/x","Id":"id"}')
    }
  })

  const wireClient = () =>
    createContentDeleter({ supabaseUrl: base, secretKey: new Secret(FAKE_KEY), guards: GUARDS })

  it('removes with a JSON body', async () => {
    answer = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(req.method === 'DELETE' ? '[{"name":"spikes/a.json"}]' : '[]')
    }
    const storage = wireClient()
    expect(await storage.remove('content', ['spikes/a.json'])).toEqual({
      kind: 'removed',
      paths: ['spikes/a.json'],
    })
    expect(
      seen.map((r) => [r.method, r.url, r.headers['content-type'], r.body.toString()]),
    ).toEqual([
      [
        'DELETE',
        '/storage/v1/object/content',
        'application/json',
        '{"prefixes":["spikes/a.json"]}',
      ],
    ])
    expect(seen.every((r) => r.headers.apikey === FAKE_KEY && !r.headers.authorization)).toBe(true)
  })
})
