import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { inspect } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Secret } from './env'
import {
  checkRemoved,
  classifyUpload,
  createStorageClient,
  effectiveStatus,
  isFolderPrefix,
  isUnderPrefix,
  MAX_LIST_DEPTH,
  MAX_REMOVE_PATHS,
  repeatsSecretRun,
  StorageRefusedError,
  storageErrorCode,
  type StorageClientOptions,
  type StorageGuards,
  type UploadRequest,
} from './storage'

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
const BYTES = new Uint8Array([1, 2, 3])

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

function client(respond?: Respond, extra: Partial<StorageClientOptions> = {}) {
  const fake = recorder(respond)
  const storage = createStorageClient({
    supabaseUrl: SUPABASE_URL,
    secretKey: new Secret(FAKE_KEY),
    guards: GUARDS,
    fetchImpl: fake.fetchImpl,
    ...extra,
  })
  return { storage, calls: fake.calls }
}

const clip = (extra: Partial<UploadRequest> = {}): UploadRequest => ({
  bucket: 'content',
  path: CLIP,
  body: BYTES,
  contentType: 'audio/mpeg',
  cacheControl: 3600,
  ...extra,
})

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

// ---- pure helpers ----

describe('storage helpers', () => {
  it('isFolderPrefix accepts the root and safe folders ending in one slash', () => {
    expect(['', 'spikes/', 'spikes/run/'].every(isFolderPrefix)).toBe(true)
    expect(['spikes', '/spikes/', 'spikes//', '../', 'a b/'].some(isFolderPrefix)).toBe(false)
  })

  it('isUnderPrefix needs a path strictly inside a prefix', () => {
    expect(isUnderPrefix('spikes/a.json', ['spikes/'])).toBe(true)
    expect(isUnderPrefix('spikes/', ['spikes/'])).toBe(false)
    expect(isUnderPrefix('spikesx/a.json', ['spikes/'])).toBe(false)
    expect(isUnderPrefix('catalogue/production.json', ['spikes/'])).toBe(false)
  })

  it('effectiveStatus takes the body statusCode only on an HTTP 400', () => {
    expect(effectiveStatus(400, { statusCode: '409' })).toBe(409)
    expect(effectiveStatus(400, { statusCode: 413 })).toBe(413)
    expect(effectiveStatus(400, { statusCode: 'nope' })).toBe(400)
    expect(effectiveStatus(400, { statusCode: '200' })).toBe(400)
    expect(effectiveStatus(500, { statusCode: '409' })).toBe(500)
    expect(effectiveStatus(409, undefined)).toBe(409)
  })

  it('storageErrorCode keeps a short token from code or error, never the message', () => {
    expect(storageErrorCode({ code: 'KeyAlreadyExists', message: 'long text' })).toBe(
      'KeyAlreadyExists',
    )
    expect(storageErrorCode({ error: 'Duplicate', message: 'x' })).toBe('Duplicate')
    expect(storageErrorCode({ error: 'Not Found' })).toBe('NotFound')
    expect(storageErrorCode({ message: 'Invalid API key' })).toBe('unknown')
    expect(storageErrorCode('text')).toBe('unknown')
  })

  it('storageErrorCode takes the field whole or not at all, and never anything key-like', () => {
    expect(storageErrorCode({ error: 'has spaces <b>' })).toBe('unknown')
    expect(storageErrorCode({ error: 'The provided API key is invalid: x' })).toBe('unknown')
    expect(storageErrorCode({ code: 'A'.repeat(40) })).toBe('A'.repeat(40))
    expect(storageErrorCode({ code: 'A'.repeat(41) })).toBe('unknown')
    expect(storageErrorCode({ code: ['SB', 'anything'].join('_') })).toBe('unknown')
    expect(storageErrorCode({ code: 42 })).toBe('unknown')
  })

  it('repeatsSecretRun finds any 8 consecutive letters and digits of the secret', () => {
    const secret = ['sb', 'secret', 'Ab12-Cd34_Ef56Gh78'].join('_')
    expect(repeatsSecretRun(`prefix ${secret} suffix`, secret)).toBe(true)
    expect(repeatsSecretRun('xx' + 'Ef56Gh78' + 'yy', secret)).toBe(true)
    expect(repeatsSecretRun('EF56GH78', secret)).toBe(true) // case ignored
    expect(repeatsSecretRun('Ab12Cd34', secret)).toBe(true) // a stripped '-' still matches
    expect(repeatsSecretRun('Ef56Gh7', secret)).toBe(false)
    expect(repeatsSecretRun('KeyAlreadyExists', secret)).toBe(false)
  })

  it('classifyUpload maps every documented outcome', () => {
    const cases: [number, unknown, ReturnType<typeof classifyUpload>][] = [
      [200, { Key: 'content/x' }, { kind: 'created' }],
      [201, undefined, { kind: 'created' }],
      [409, { error: 'Duplicate' }, { kind: 'duplicate' }],
      [400, { statusCode: '409', error: 'Duplicate' }, { kind: 'duplicate' }],
      [413, { error: 'Payload too large' }, { kind: 'too-large' }],
      [400, { statusCode: '413' }, { kind: 'too-large' }],
      [415, { code: 'InvalidMimeType' }, { kind: 'mime-refused' }],
      [400, { statusCode: '415', error: 'invalid_mime_type' }, { kind: 'mime-refused' }],
      [401, { message: 'Invalid API key' }, { kind: 'unauthorized', status: 401 }],
      [403, { code: 'AccessDenied' }, { kind: 'unauthorized', status: 403 }],
      [400, { statusCode: '403', error: 'Unauthorized' }, { kind: 'unauthorized', status: 403 }],
      [400, { code: 'InvalidKey' }, { kind: 'failed', status: 400, code: 'InvalidKey' }],
      [500, { code: 'InternalError' }, { kind: 'failed', status: 500, code: 'InternalError' }],
      [502, undefined, { kind: 'failed', status: 502, code: 'unknown' }],
      [302, undefined, { kind: 'failed', status: 302, code: 'unknown' }],
    ]
    for (const [status, body, expected] of cases) {
      expect(classifyUpload(status, body)).toEqual(expected)
    }
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

describe('createStorageClient configuration', () => {
  const make = (extra: Partial<StorageClientOptions>) => () =>
    createStorageClient({
      supabaseUrl: SUPABASE_URL,
      secretKey: new Secret(FAKE_KEY),
      guards: GUARDS,
      ...extra,
    })

  it('refuses a non-https Supabase URL except on loopback', () => {
    expect(make({ supabaseUrl: new URL('http://abcdefghijklmnopqrst.supabase.co') })).toThrow(
      'supabaseUrl must use https',
    )
    expect(make({ supabaseUrl: new URL('http://127.0.0.1:9') })).not.toThrow()
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

  it('refuses a short key and a bad page size', () => {
    expect(make({ secretKey: new Secret('short') })).toThrow('secretKey is too short')
    expect(make({ listPageSize: 0 })).toThrow('listPageSize must be a positive integer')
  })
})

// ---- upload ----

describe('upload', () => {
  it('sends the exact URL, method, headers and body, with the key on apikey only', async () => {
    const { storage, calls } = client()
    expect(await storage.upload(clip())).toEqual({ kind: 'created' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      url: 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/content/spikes/audio/clip.mp3',
      method: 'POST',
      headers: {
        apikey: FAKE_KEY,
        'content-type': 'audio/mpeg',
        'cache-control': 'max-age=3600',
        'x-upsert': 'false',
      },
      body: BYTES,
      redirect: 'manual',
    })
  })

  it('sends x-upsert true only for an overwritable path, and max-age=0 for pointers', async () => {
    const { storage, calls } = client()
    const pointer = clip({ path: POINTER, contentType: 'application/json', cacheControl: 0 })
    await storage.upload({ ...pointer, upsert: true })
    await storage.upload({ ...pointer, path: FRESHNESS, upsert: true })
    await storage.upload({ ...pointer, upsert: false })
    expect(calls.map((c) => [c.url.split('/object/')[1], c.headers['x-upsert']])).toEqual([
      [`content/${POINTER}`, 'true'],
      [`content/${FRESHNESS}`, 'true'],
      [`content/${POINTER}`, 'false'],
    ])
    expect(calls.every((c) => c.headers['cache-control'] === 'max-age=0')).toBe(true)
  })

  it('refuses upsert on a path that is not in the overwritable list', async () => {
    const { storage, calls } = client()
    await expectRefused(
      storage.upload(clip({ upsert: true })),
      'refused: upsert is not allowed on "spikes/audio/clip.mp3"; it is not an overwritable path',
    )
    expect(calls).toHaveLength(0)
  })

  it('refuses masters for every write, even when a caller allows the bucket', async () => {
    for (const allowedBuckets of [['content'], ['content', 'masters']]) {
      const { storage, calls } = client(undefined, { guards: { ...GUARDS, allowedBuckets } })
      await expectRefused(
        storage.upload(clip({ bucket: 'masters' })),
        'refused: bucket "masters" is never written to or deleted from',
      )
      expect(calls).toHaveLength(0)
    }
  })

  it('refuses a bucket that is not in the allowed list', async () => {
    const { storage, calls } = client()
    await expectRefused(
      storage.upload(clip({ bucket: 'other' })),
      'refused: bucket "other" is not in the allowed bucket list',
    )
    expect(calls).toHaveLength(0)
  })

  it('refuses a path outside the write prefix', async () => {
    const { storage, calls } = client()
    for (const path of ['catalogue/production.json', 'spikesx/a.json', 'media/a.webp']) {
      await expectRefused(
        storage.upload(clip({ path })),
        `refused: path "${path}" is outside the write prefixes`,
      )
    }
    expect(calls).toHaveLength(0)
  })

  it('refuses every unsafe path', async () => {
    const { storage, calls } = client()
    for (const path of UNSAFE_PATHS) {
      await expectRefused(storage.upload(clip({ path })), 'refused: unsafe path')
    }
    expect(calls).toHaveLength(0)
  })

  it('requires a bare media type and whole-second cacheControl', async () => {
    const { storage, calls } = client()
    for (const contentType of ['', 'audio', 'Audio/MPEG', 'application/json; charset=utf-8']) {
      await expectRefused(
        storage.upload(clip({ contentType })),
        'refused: contentType must be a bare lowercase media type',
      )
    }
    for (const cacheControl of [-1, 1.5, Number.NaN, 31_536_001]) {
      await expectRefused(
        storage.upload(clip({ cacheControl })),
        'refused: cacheControl must be whole seconds',
      )
    }
    expect(calls).toHaveLength(0)
  })

  it('returns duplicate on 409 and never retries, with or without upsert', async () => {
    const { storage, calls } = client(() =>
      json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }),
    )
    expect(await storage.upload(clip())).toEqual({ kind: 'duplicate' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.headers['x-upsert']).toBe('false')
  })

  it('returns too-large, mime-refused, unauthorized and failed results', async () => {
    const answers = [
      json(413, { statusCode: '413', error: 'Payload too large' }),
      json(400, { statusCode: '415', error: 'invalid_mime_type' }),
      json(401, { message: 'Invalid API key' }),
      json(500, { code: 'InternalError' }),
    ]
    const { storage } = client((_call, index) => answers[index]!)
    expect(await storage.upload(clip())).toEqual({ kind: 'too-large' })
    expect(await storage.upload(clip())).toEqual({ kind: 'mime-refused' })
    expect(await storage.upload(clip())).toEqual({ kind: 'unauthorized', status: 401 })
    expect(await storage.upload(clip())).toEqual({
      kind: 'failed',
      status: 500,
      code: 'InternalError',
    })
  })

  it('reports a network error by name and cause only', async () => {
    const { storage } = client(() => {
      throw new TypeError(`fetch failed apikey=${FAKE_KEY}`, {
        cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      })
    })
    const result = await storage.upload(clip())
    expect(result).toEqual({ kind: 'failed', status: null, code: 'TypeError (ECONNREFUSED)' })
  })

  it('adds Authorization: Bearer only when the fallback is switched on', async () => {
    const off = client()
    await off.storage.upload(clip())
    expect(Object.keys(off.calls[0]!.headers)).not.toContain('authorization')
    const on = client(undefined, { bearerFallback: true })
    await on.storage.upload(clip())
    expect(on.calls[0]?.headers).toEqual({
      apikey: FAKE_KEY,
      authorization: `Bearer ${FAKE_KEY}`,
      'content-type': 'audio/mpeg',
      'cache-control': 'max-age=3600',
      'x-upsert': 'false',
    })
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

// ---- list ----

type Entry = { name: string; id: string | null; updated_at?: string | null; metadata?: unknown }

const file = (name: string, size: number, mimetype: string): Entry => ({
  name,
  id: `id-${name}`,
  updated_at: '2026-11-07T10:00:00.000Z',
  metadata: { size, mimetype, cacheControl: 'max-age=3600', eTag: '"x"' },
})
const folder = (name: string): Entry => ({ name, id: null, updated_at: null, metadata: null })

function listServer(tree: Record<string, Entry[]>, pageSize: number): Respond {
  return (call) => {
    const body = JSON.parse(String(call.body)) as { prefix: string; offset: number }
    return json(200, (tree[body.prefix] ?? []).slice(body.offset, body.offset + pageSize))
  }
}

describe('list', () => {
  it('lists every object recursively across pages, sorted by path', async () => {
    const tree = {
      spikes: [
        file('a.json', 10, 'application/json'),
        folder('audio'),
        file('b.json', 20, 'application/json'),
      ],
      'spikes/audio': [file('x.mp3', 30, 'audio/mpeg')],
    }
    const { storage, calls } = client(listServer(tree, 2), { listPageSize: 2 })
    expect(await storage.list('content', 'spikes/')).toEqual({
      kind: 'listed',
      objects: [
        {
          path: 'spikes/a.json',
          size: 10,
          mimetype: 'application/json',
          cacheControl: 'max-age=3600',
          updatedAt: '2026-11-07T10:00:00.000Z',
        },
        {
          path: 'spikes/audio/x.mp3',
          size: 30,
          mimetype: 'audio/mpeg',
          cacheControl: 'max-age=3600',
          updatedAt: '2026-11-07T10:00:00.000Z',
        },
        {
          path: 'spikes/b.json',
          size: 20,
          mimetype: 'application/json',
          cacheControl: 'max-age=3600',
          updatedAt: '2026-11-07T10:00:00.000Z',
        },
      ],
    })
    const sortBy = '"sortBy":{"column":"name","order":"asc"}'
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      [
        'POST',
        'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/list/content',
        `{"prefix":"spikes","limit":2,"offset":0,${sortBy}}`,
      ],
      [
        'POST',
        'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/list/content',
        `{"prefix":"spikes","limit":2,"offset":2,${sortBy}}`,
      ],
      [
        'POST',
        'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/list/content',
        `{"prefix":"spikes/audio","limit":2,"offset":0,${sortBy}}`,
      ],
    ])
    expect(calls[0]?.headers).toEqual({ apikey: FAKE_KEY, 'content-type': 'application/json' })
  })

  it('lists the bucket root with an empty prefix and tolerates missing metadata', async () => {
    const { storage, calls } = client(() => json(200, [{ name: 'readme.txt', id: 'id-1' }]))
    expect(await storage.list('content', '')).toEqual({
      kind: 'listed',
      objects: [
        { path: 'readme.txt', size: null, mimetype: null, cacheControl: null, updatedAt: null },
      ],
    })
    expect(JSON.parse(String(calls[0]?.body))).toMatchObject({ prefix: '', limit: 100 })
  })

  it('refuses buckets outside the allowed list (masters included) and invalid folders', async () => {
    const { storage, calls } = client()
    await expectRefused(storage.list('masters', ''), 'is not in the allowed bucket list')
    for (const bad of ['spikes', '/spikes/', '../', 'spikes//']) {
      await expectRefused(storage.list('content', bad), "must be '' or end in '/'")
    }
    expect(calls).toHaveLength(0)
  })

  it('may list masters when a caller allows it, because listing is not a write', async () => {
    const { storage, calls } = client(() => json(200, []), {
      guards: { ...GUARDS, allowedBuckets: ['content', 'masters'] },
    })
    expect(await storage.list('masters', '')).toEqual({ kind: 'listed', objects: [] })
    expect(calls[0]?.url).toBe(
      'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/list/masters',
    )
  })

  it('returns unauthorized, unreadable and limit failures', async () => {
    expect(await client(() => json(401, {})).storage.list('content', 'spikes/')).toEqual({
      kind: 'unauthorized',
      status: 401,
    })
    expect(await client(() => json(200, { not: 'a list' })).storage.list('content', '')).toEqual({
      kind: 'failed',
      status: 200,
      code: 'unreadable-response',
    })
    const endless = client(() => json(200, [folder('d')]))
    expect(await endless.storage.list('content', '')).toEqual({
      kind: 'failed',
      status: null,
      code: 'list-depth-exceeded',
    })
    expect(endless.calls).toHaveLength(MAX_LIST_DEPTH + 1)
    const huge = client(
      () =>
        json(
          200,
          Array.from({ length: 1000 }, (_v, i) => file(`f${i}.json`, 1, 'x/y')),
        ),
      { listPageSize: 1000 },
    )
    expect(await huge.storage.list('content', '')).toEqual({
      kind: 'failed',
      status: null,
      code: 'list-size-exceeded',
    })
  })
})

// ---- secrets ----

describe('the key never leaves the client', () => {
  it('is not visible when the client is inspected or serialized', () => {
    const { storage } = client()
    expect(inspect(storage, { depth: 10, showHidden: true })).not.toContain(FAKE_KEY)
    expect(JSON.stringify(storage)).not.toContain(FAKE_KEY)
  })

  it('is scrubbed from refusal messages, which never mention headers', async () => {
    const { storage } = client()
    const attempt = storage.upload(clip({ path: `spikes/${FAKE_KEY}?x` }))
    await expect(attempt).rejects.toThrow('refused: unsafe path "spikes/[redacted]?x"')
    const error = await attempt.catch((e: unknown) => e)
    expect(String(error)).not.toContain(FAKE_KEY)
    expect(String(error).toLowerCase()).not.toMatch(/apikey|authorization/)
  })

  it('never reaches a failure code when Storage echoes it', async () => {
    const { storage } = client(() => json(500, { code: FAKE_KEY, message: `bad ${FAKE_KEY}` }))
    const result = await storage.upload(clip())
    expect(result).toEqual({ kind: 'failed', status: 500, code: 'unknown' })
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY)
  })

  it('leaves no part of the key in a code when the echo follows a long prefix', async () => {
    const error = `The provided API key is invalid: ${FAKE_KEY}`
    const { storage } = client(() => json(400, { statusCode: '400', error }))
    const result = await storage.upload(clip())
    expect(result).toEqual({ kind: 'failed', status: 400, code: 'unknown' })
    expect(repeatsSecretRun(JSON.stringify(result), FAKE_KEY)).toBe(false)
  })

  it('drops a code that repeats part of the key without its sb_ start', async () => {
    const partial = FAKE_KEY.slice('sb_secret_'.length) // a valid-looking token on its own
    const respond = (_call: Call, index: number) =>
      index === 0 ? json(500, { code: partial }) : json(502, { error: partial })
    const { storage } = client(respond)
    expect(await storage.upload(clip())).toEqual({ kind: 'failed', status: 500, code: 'unknown' })
    expect(await storage.remove('content', [CLIP])).toEqual({
      kind: 'failed',
      status: 502,
      code: 'unknown',
    })
  })

  it('drops a network failure code that repeats part of the key', async () => {
    const cause = Object.assign(new Error('x'), { code: FAKE_KEY.slice(10, 30) })
    const { storage } = client(() => Promise.reject(new TypeError('fetch failed', { cause })))
    expect(await storage.upload(clip())).toEqual({ kind: 'failed', status: null, code: 'unknown' })
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
    createStorageClient({ supabaseUrl: base, secretKey: new Secret(FAKE_KEY), guards: GUARDS })

  it('uploads with the apikey, content-type, cache-control and x-upsert headers and the exact bytes', async () => {
    expect(await wireClient().upload(clip())).toEqual({ kind: 'created' })
    expect(seen).toHaveLength(1)
    const [request] = seen
    expect(request?.method).toBe('POST')
    expect(request?.url).toBe('/storage/v1/object/content/spikes/audio/clip.mp3')
    expect(request?.headers).toMatchObject({
      apikey: FAKE_KEY,
      'content-type': 'audio/mpeg',
      'cache-control': 'max-age=3600',
      'x-upsert': 'false',
      'content-length': '3',
    })
    expect(request?.headers.authorization).toBeUndefined()
    expect(new Uint8Array(request!.body)).toEqual(BYTES)
  })

  it('maps a real 409 to duplicate with a single request', async () => {
    answer = (_req, res) => {
      res.writeHead(409, { 'content-type': 'application/json' })
      res.end('{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}')
    }
    expect(await wireClient().upload(clip())).toEqual({ kind: 'duplicate' })
    expect(seen).toHaveLength(1)
  })

  it('removes with a JSON body and lists with a JSON body', async () => {
    answer = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(req.method === 'DELETE' ? '[{"name":"spikes/a.json"}]' : '[]')
    }
    const storage = wireClient()
    expect(await storage.remove('content', ['spikes/a.json'])).toEqual({
      kind: 'removed',
      paths: ['spikes/a.json'],
    })
    expect(await storage.list('content', 'spikes/')).toEqual({ kind: 'listed', objects: [] })
    expect(
      seen.map((r) => [r.method, r.url, r.headers['content-type'], r.body.toString()]),
    ).toEqual([
      [
        'DELETE',
        '/storage/v1/object/content',
        'application/json',
        '{"prefixes":["spikes/a.json"]}',
      ],
      [
        'POST',
        '/storage/v1/object/list/content',
        'application/json',
        '{"prefix":"spikes","limit":100,"offset":0,"sortBy":{"column":"name","order":"asc"}}',
      ],
    ])
    expect(seen.every((r) => r.headers.apikey === FAKE_KEY && !r.headers.authorization)).toBe(true)
  })
})
