// The Storage stub's own self-test (design p1-step13-design.md §13.6, A15; guard G2). It drives the
// stub with raw fetch and node:http, never through the client, so the stub's proof does not depend
// on the client. Every test starts its own stub; tests that make unexpected requests on purpose use
// a second, local stub, so the shared afterEach can require the shared stub's `unexpected` to be
// empty (fail closed). A loopback fetch guard refuses any other host (13.1 D, G5).
import { createHash } from 'node:crypto'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { connect } from 'node:net'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoUnexpected, startStorageStub, type StorageStub } from './storage-stub'

// Assembled at run time, so no file holds a key-shaped string (13.1 G).
const FAKE_KEY = ['fake', 'stub', 'key', (0x7f3a).toString(16), 'q'.repeat(8)].join('-')
const WRONG_KEY = ['wrong', 'stub', 'key', (0x9c1d).toString(16)].join('-')
const MARK = ['Q7', 'MARK'].join('')

// The answer bodies the design fixes (13.2.3), written here so the stub is checked against the
// design, not against its own constants.
const MISSING_OBJECT_BODY = '{"statusCode":"404","error":"not_found","message":"Object not found"}'
const NO_SUCH_KEY_BODY =
  '{"statusCode":"404","code":"NoSuchKey","error":"not_found","message":"Object not found"}'

const SHA = 'a'.repeat(64)
const APPROVAL_PATH = `approvals/two-paths/${SHA}.json`
const OBJECT = '/storage/v1/object/'
const AUTHENTICATED = '/storage/v1/object/authenticated/'
const LIST_CONTENT = '/storage/v1/object/list/content'

const text = (value: string) => new TextEncoder().encode(value)
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

// ---- the loopback fetch guard (13.1 D; G5) ----

const realFetch = globalThis.fetch
const LOOPBACK: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])
let escapes = 0
const guarded: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!LOOPBACK.has(url.hostname)) {
    escapes += 1
    return Promise.reject(new TypeError('test fetch guard: only loopback hosts'))
  }
  return realFetch(input, init)
}

// ---- the shared stub ----

let stub: StorageStub

beforeEach(async () => {
  escapes = 0
  vi.stubGlobal('fetch', guarded)
  stub = await startStorageStub({ apikey: FAKE_KEY })
})

afterEach(async () => {
  try {
    expectNoUnexpected(stub)
    expect(escapes, 'no request left the loopback host').toBe(0)
  } finally {
    vi.unstubAllGlobals()
    await stub.close()
  }
})

// ---- request helpers ----

interface Answer {
  readonly status: number
  readonly headers: Headers
  readonly bytes: Uint8Array
  readonly text: string
}

async function send(
  target: StorageStub,
  method: string,
  pathname: string,
  options: {
    headers?: Record<string, string>
    body?: Uint8Array<ArrayBuffer> | string
    apikey?: string | null
  } = {},
): Promise<Answer> {
  const apikey = options.apikey === undefined ? FAKE_KEY : options.apikey
  const headers: Record<string, string> = {
    ...(apikey === null ? {} : { apikey }),
    ...options.headers,
  }
  const response = await fetch(new URL(pathname, target.origin), {
    method,
    headers,
    body: options.body,
    redirect: 'manual',
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  return {
    status: response.status,
    headers: response.headers,
    bytes,
    text: new TextDecoder().decode(bytes),
  }
}

const create = (
  target: StorageStub,
  bucket: string,
  path: string,
  body: string,
  headers: Record<string, string> = {},
) =>
  send(target, 'POST', `${OBJECT}${bucket}/${path}`, {
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })

interface RawAnswer {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
  /** False when the connection ended before the declared body arrived. */
  readonly complete: boolean
}

/** One request over node:http, with no decoding of the body (gzip stays gzip). */
function raw(
  target: StorageStub,
  method: string,
  pathname: string,
  headers: Record<string, string>,
  body?: Uint8Array,
  onHead?: (head: { status: number; headers: IncomingHttpHeaders }) => void,
): Promise<RawAnswer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: Number(target.origin.port),
        method,
        path: pathname,
        // Node frames a GET, HEAD or DELETE body only when its length is declared.
        headers: body ? { ...headers, 'content-length': String(body.byteLength) } : headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = []
        onHead?.({ status: res.statusCode ?? 0, headers: res.headers })
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('error', () => {})
        res.on('close', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            complete: res.complete,
          }),
        )
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))

// ---- the tests ----

describe('the Storage stub (G2)', () => {
  it('T13-ST1 create-only POST: a second create conflicts, and only x-upsert exactly true overwrites', async () => {
    const path = 'catalogue/production.json'
    const first = await create(stub, 'content', path, 'v1', { 'cache-control': 'max-age=0' })
    expect.soft(first.status, '(g1) the first create answers 200').toBe(200)
    expect
      .soft(stub.object('content', path)?.bytes, '(g1) the object is stored')
      .toEqual(text('v1'))
    expect
      .soft(stub.object('content', path)?.contentType, '(g1) its content-type')
      .toBe('application/json')
    expect
      .soft(stub.object('content', path)?.cacheControl, '(g1) its cache-control')
      .toBe('max-age=0')
    const second = await create(stub, 'content', path, 'v2')
    expect
      .soft(second.status, '(g2) a create without x-upsert on an existing key conflicts')
      .toBe(400)
    for (const value of ['True', '1', 'yes', 'false', 'TRUE', 'true, true']) {
      const attempt = await create(stub, 'content', path, `v-${value}`, { 'x-upsert': value })
      expect.soft(attempt.status, `(g3) x-upsert '${value}' is create-only`).toBe(400)
      expect
        .soft(stub.object('content', path)?.bytes, `(g3) x-upsert '${value}' keeps v1`)
        .toEqual(text('v1'))
    }
    const upsert = await create(stub, 'content', path, 'v3', { 'x-upsert': 'true' })
    expect.soft(upsert.status, "(g4) x-upsert exactly 'true' overwrites").toBe(200)
    expect
      .soft(stub.object('content', path)?.bytes, '(g4) the new bytes are stored')
      .toEqual(text('v3'))
    const fresh = await create(stub, 'masters', APPROVAL_PATH, '{}', { 'x-upsert': 'false' })
    expect.soft(fresh.status, '(g5) a new masters key is created').toBe(200)
    expect
      .soft(stub.object('content', APPROVAL_PATH), '(g5) the buckets are separate')
      .toBeUndefined()
  })

  it('T13-ST2 the conflict shape: http400 (the default) answers 400 with statusCode "409"; http409 answers 409', async () => {
    const shapes = [
      ['default', stub],
      ['http400', await startStorageStub({ apikey: FAKE_KEY, conflict: 'http400' })],
      ['http409', await startStorageStub({ apikey: FAKE_KEY, conflict: 'http409' })],
    ] as const
    try {
      for (const [label, target] of shapes) {
        expect(
          (await create(target, 'content', 'media/x/a.json', '1')).status,
          'precondition: created',
        ).toBe(200)
        const conflict = await create(target, 'content', 'media/x/a.json', '2')
        expect.soft(conflict.status, `(g1) ${label} status`).toBe(label === 'http409' ? 409 : 400)
        expect.soft(JSON.parse(conflict.text), `(g2) ${label} body`).toEqual({
          statusCode: '409',
          error: 'Duplicate',
          message: 'The resource already exists',
        })
        expect
          .soft(conflict.headers.get('content-type'), `(g3) ${label} JSON`)
          .toBe('application/json')
      }
    } finally {
      await shapes[1][1].close()
      await shapes[2][1].close()
    }
  })

  it('T13-ST3 authenticated GET: found gives the exact bytes and type; missing gives the not_found or NoSuchKey body', async () => {
    const bytes = text('{"storyId":"two-paths"}')
    stub.put('masters', APPROVAL_PATH, bytes, 'binary/octet-stream')
    const found = await raw(stub, 'GET', `${AUTHENTICATED}masters/${APPROVAL_PATH}`, {
      apikey: FAKE_KEY,
    })
    expect.soft(found.status, '(g1) found answers 200').toBe(200)
    expect.soft(new Uint8Array(found.body), '(g1) the exact bytes').toEqual(bytes)
    expect
      .soft(found.headers['content-type'], '(g1) the stored content-type')
      .toBe('binary/octet-stream')
    expect
      .soft(found.headers['content-length'], '(g1) content-length = byte length')
      .toBe(String(bytes.length))
    await create(stub, 'content', 'catalogue/snapshots/7.json', '{"seq":7}', {
      'cache-control': 'max-age=3600',
    })
    const created = await send(stub, 'GET', `${AUTHENTICATED}content/catalogue/snapshots/7.json`)
    expect.soft(created.text, '(g2) a created object is read back').toBe('{"seq":7}')
    expect
      .soft(created.headers.get('cache-control'), '(g2) with its cache-control')
      .toBe('max-age=3600')
    const missing = await send(stub, 'GET', `${AUTHENTICATED}masters/waivers/two-paths/${SHA}.json`)
    expect.soft(missing.status, '(g3) missing answers 400 (default not_found mode)').toBe(400)
    expect.soft(missing.text, '(g3) the measured not_found body').toBe(MISSING_OBJECT_BODY)
    const modes = [
      ['not_found', MISSING_OBJECT_BODY],
      ['NoSuchKey', NO_SUCH_KEY_BODY],
    ] as const
    for (const [mode, body] of modes) {
      const other = await startStorageStub({ apikey: FAKE_KEY, missing: mode })
      try {
        const answer = await send(other, 'GET', `${AUTHENTICATED}masters/${APPROVAL_PATH}`)
        expect.soft(answer.status, `(g4) ${mode} mode status`).toBe(400)
        expect.soft(answer.text, `(g4) ${mode} mode body`).toBe(body)
        expectNoUnexpected(other)
      } finally {
        await other.close()
      }
    }
  })

  it('T13-ST4 list: one folder page, folders with id null, files with metadata, sorted, limit and offset, root prefix', async () => {
    const paths = [
      'catalogue/staging.json',
      'catalogue/snapshots/2.json',
      'catalogue/snapshots/1.json',
      'catalogue/production.json',
      'media/lion-and-hare/x.webp',
    ]
    for (const path of paths) stub.put('content', path, text(path), 'application/json')
    await create(stub, 'content', 'catalogue/snapshots/3.json', '{}', {
      'cache-control': 'max-age=3600',
    })
    const page = async (prefix: string, limit: number, offset: number) => {
      const answer = await send(stub, 'POST', LIST_CONTENT, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } }),
      })
      expect(answer.status, 'precondition: the list answers 200').toBe(200)
      return JSON.parse(answer.text) as {
        name: string
        id: string | null
        metadata: { size: number; mimetype: string; cacheControl: string | null } | null
      }[]
    }
    const first = await page('catalogue', 2, 0)
    expect
      .soft(
        first.map((entry) => entry.name),
        '(g1) limit 2, sorted by name',
      )
      .toEqual(['production.json', 'snapshots'])
    expect.soft(first[1]?.id, '(g2) a folder has id null').toBeNull()
    expect.soft(first[1]?.metadata, '(g2) and no metadata').toBeNull()
    expect.soft(typeof first[0]?.id, '(g3) a file has a string id').toBe('string')
    expect.soft(first[0]?.metadata, '(g3) and size, mimetype and cacheControl').toEqual({
      size: 'catalogue/production.json'.length,
      mimetype: 'application/json',
      cacheControl: null,
    })
    const second = await page('catalogue', 2, 2)
    expect
      .soft(
        second.map((entry) => entry.name),
        '(g4) offset 2 gives the rest',
      )
      .toEqual(['staging.json'])
    const snapshots = await page('catalogue/snapshots', 100, 0)
    expect
      .soft(
        snapshots.map((entry) => entry.name),
        '(g5) a nested folder',
      )
      .toEqual(['1.json', '2.json', '3.json'])
    expect
      .soft(snapshots[2]?.metadata?.cacheControl, '(g5) a created file keeps its cache-control')
      .toBe('max-age=3600')
    const root = await page('', 100, 0)
    expect
      .soft(
        root.map((entry) => [entry.name, entry.id]),
        "(g6) prefix '' is the root",
      )
      .toEqual([
        ['catalogue', null],
        ['media', null],
      ])
  })

  it('T13-ST5 fail closed: every Storage route the client does not use answers 500 and is recorded; the store is unchanged', async () => {
    const local = await startStorageStub({ apikey: FAKE_KEY })
    try {
      local.put('content', 'a/one.json', text('one'), 'application/json')
      local.put('masters', 'canary.txt', text('canary'), 'text/plain')
      const json = { 'content-type': 'application/json' }
      const routes: readonly (readonly [string, string, string?])[] = [
        ['DELETE', '/storage/v1/object/content', '{"prefixes":["a/one.json"]}'],
        ['DELETE', '/storage/v1/object/content/a/one.json'],
        ['PUT', '/storage/v1/object/content/a/one.json', 'two'],
        ['PATCH', '/storage/v1/object/content/a/one.json', 'two'],
        ['HEAD', '/storage/v1/object/authenticated/content/a/one.json'],
        ['HEAD', '/storage/v1/object/content/a/one.json'],
        [
          'POST',
          '/storage/v1/object/move',
          '{"bucketId":"content","sourceKey":"a/one.json","destinationKey":"b"}',
        ],
        [
          'POST',
          '/storage/v1/object/copy',
          '{"bucketId":"content","sourceKey":"a/one.json","destinationKey":"b"}',
        ],
        ['POST', '/storage/v1/object/sign/masters/canary.txt', '{"expiresIn":60}'],
        ['POST', '/storage/v1/object/upload/sign/content/x.json', '{}'],
        ['POST', '/storage/v1/upload/resumable', '{}'],
        ['POST', '/storage/v1/s3/content/x.json', '{}'],
        ['GET', '/storage/v1/s3/content/a/one.json'],
        ['GET', '/storage/v1/object/public/masters/canary.txt'],
        ['GET', '/storage/v1/object/masters/canary.txt'],
        ['GET', '/storage/v1/object/info/content/a/one.json'],
        ['POST', '/storage/v1/object/authenticated/content/a/one.json', '{}'],
        ['POST', '/storage/v1/object/public/content/a/one.json', '{}'],
        ['POST', '/storage/v1/object/content/a/../b.json', '{}'],
        ['POST', '/storage/v1/object/content/a//b.json', '{}'],
        ['POST', '/storage/v1/object/content/a%2fb.json', '{}'],
        ['POST', '/storage/v1/object/content/a.json?x-upsert=true', '{}'],
        ['POST', '/storage/v1/object/list/content/', '{"prefix":"","limit":1,"offset":0}'],
        ['POST', LIST_CONTENT, 'not json'],
        ['GET', '/nope'],
      ]
      for (const [method, pathname, body] of routes) {
        const answer = await raw(
          local,
          method,
          pathname,
          { apikey: FAKE_KEY, ...json },
          body ? text(body) : undefined,
        )
        expect.soft(answer.status, `(g1) ${method} ${pathname} answers 500`).toBe(500)
      }
      const recorded = local.unexpected.map(
        (entry) => `${entry.method} ${entry.pathname}${entry.search}`,
      )
      expect
        .soft(recorded, '(g2) each is recorded in unexpected, in order')
        .toEqual(routes.map(([method, pathname]) => `${method} ${pathname}`))
      expect.soft(local.requests.length, '(g2) and in requests').toBe(routes.length)
      expect
        .soft(local.object('content', 'a/one.json')?.bytes, '(g3) the store is unchanged')
        .toEqual(text('one'))
      expect.soft(local.object('content', 'b'), '(g3) nothing was moved or copied').toBeUndefined()
      expect
        .soft(local.object('masters', 'canary.txt')?.bytes, '(g3) masters is unchanged')
        .toEqual(text('canary'))
    } finally {
      await local.close()
    }
  })

  it('T13-ST6 bucket administration and render routes answer 500 and are recorded; the store is unchanged', async () => {
    const local = await startStorageStub({ apikey: FAKE_KEY })
    try {
      local.put('masters', APPROVAL_PATH, text('{}'), 'application/json')
      const routes = [
        ['POST', '/storage/v1/bucket/masters/empty'],
        ['PUT', '/storage/v1/bucket/masters'],
        ['DELETE', '/storage/v1/bucket/masters'],
        ['GET', '/storage/v1/bucket/masters'],
        ['GET', '/storage/v1/bucket'],
        ['POST', '/storage/v1/bucket'],
        ['GET', '/storage/v1/render/image/authenticated/masters/x'],
      ] as const
      for (const [method, pathname] of routes) {
        const answer = await send(local, method, pathname, {
          headers: { 'content-type': 'application/json' },
          body: method === 'GET' ? undefined : '{"public":true}',
        })
        expect.soft(answer.status, `(g1) ${method} ${pathname} answers 500`).toBe(500)
      }
      expect
        .soft(
          local.unexpected.map((entry) => `${entry.method} ${entry.pathname}`),
          '(g2) each is recorded in unexpected',
        )
        .toEqual(routes.map(([method, pathname]) => `${method} ${pathname}`))
      expect
        .soft(local.object('masters', APPROVAL_PATH)?.bytes, '(g3) the store is unchanged')
        .toEqual(text('{}'))
    } finally {
      await local.close()
    }
  })

  it('T13-ST7 no apikey, a wrong apikey or authorization without the apikey answers 401 and is recorded; the right apikey is served', async () => {
    const local = await startStorageStub({ apikey: FAKE_KEY })
    try {
      local.put('masters', APPROVAL_PATH, text('{}'), 'application/json')
      const path = `${AUTHENTICATED}masters/${APPROVAL_PATH}`
      const refused: readonly (readonly [
        string,
        { apikey?: string | null; headers?: Record<string, string> },
      ])[] = [
        ['no apikey', { apikey: null }],
        ['a wrong apikey', { apikey: WRONG_KEY }],
        [
          'authorization without the apikey',
          { apikey: null, headers: { authorization: `Bearer ${FAKE_KEY}` } },
        ],
        [
          'the apikey with another authorization',
          { headers: { authorization: `Bearer ${WRONG_KEY}` } },
        ],
        ['the apikey in another case of value', { apikey: FAKE_KEY.toUpperCase() }],
      ]
      for (const [label, options] of refused) {
        const answer = await send(local, 'GET', path, options)
        expect.soft(answer.status, `(g1) ${label} answers 401`).toBe(401)
      }
      const unexpected = await send(local, 'DELETE', '/storage/v1/object/masters', { apikey: null })
      expect
        .soft(unexpected.status, '(g1) an unmodelled route without the apikey answers 401 too')
        .toBe(401)
      expect
        .soft(local.unexpected.length, '(g2) each refusal is recorded in unexpected')
        .toBe(refused.length + 1)
      expect
        .soft(
          local.unexpected.map((entry) => [entry.apikeyMatched, entry.authorization]),
          '(g2) with the apikey and authorization classes',
        )
        .toEqual([
          [false, 'absent'],
          [false, 'absent'],
          [false, 'bearer-matched'],
          [true, 'other'],
          [false, 'absent'],
          [false, 'absent'],
        ])
      const before = local.unexpected.length
      const plain = await send(local, 'GET', path)
      const bearer = await send(local, 'GET', path, {
        headers: { authorization: `Bearer ${FAKE_KEY}` },
      })
      expect
        .soft([plain.status, plain.text], '(g3) the right apikey is served')
        .toEqual([200, '{}'])
      expect
        .soft([bearer.status, bearer.text], '(g3) with Bearer of the same key too')
        .toEqual([200, '{}'])
      expect.soft(local.unexpected.length, '(g3) neither is unexpected').toBe(before)
      expect
        .soft(local.requests.at(-1)?.authorization, '(g3) logged as bearer-matched')
        .toBe('bearer-matched')
    } finally {
      await local.close()
    }
  })

  it('T13-ST8 the request log keeps no credential or other header value, only names and the four named values', async () => {
    const local = await startStorageStub({ apikey: FAKE_KEY })
    try {
      const marked = { 'x-marker': MARK }
      const body = text('{"ok":1}')
      await send(local, 'POST', `${OBJECT}content/catalogue/production.json`, {
        headers: {
          ...marked,
          authorization: `Bearer ${FAKE_KEY}`,
          'content-type': 'application/json',
          'cache-control': 'max-age=0',
          'x-upsert': 'true',
          'accept-encoding': 'identity',
        },
        body,
      })
      await send(local, 'GET', `${AUTHENTICATED}masters/${APPROVAL_PATH}`, {
        apikey: WRONG_KEY,
        headers: marked,
      })
      await send(local, 'DELETE', '/storage/v1/object/content', {
        headers: marked,
        body: '{"prefixes":["x"]}',
      })
      expect(local.requests.length, 'precondition: three requests logged').toBe(3)
      expect(local.unexpected.length, 'precondition: two of them unexpected').toBe(2)
      for (const [label, entries] of [
        ['requests', local.requests],
        ['unexpected', local.unexpected],
      ] as const) {
        const json = JSON.stringify(entries)
        expect.soft(json.includes(FAKE_KEY), `(g1) ${label} holds no apikey value`).toBe(false)
        expect
          .soft(json.includes(WRONG_KEY), `(g1) ${label} holds no wrong apikey value`)
          .toBe(false)
        expect.soft(json.includes(MARK), `(g1) ${label} holds no other header value`).toBe(false)
      }
      const [created] = local.requests
      expect
        .soft(Object.keys(created ?? {}).sort(), '(g2) the entry fields')
        .toEqual([
          'apikeyMatched',
          'authorization',
          'body',
          'bodySha256',
          'headerNames',
          'method',
          'pathname',
          'search',
          'values',
        ])
      expect
        .soft(created?.headerNames, '(g2) names include x-marker, apikey and authorization')
        .toEqual(expect.arrayContaining(['apikey', 'authorization', 'x-marker']))
      expect
        .soft(created?.headerNames, '(g2) names are sorted and lower case')
        .toEqual([...(created?.headerNames ?? [])].map((name) => name.toLowerCase()).sort())
      expect.soft(created?.values, '(g3) exactly the four named values').toEqual({
        'content-type': 'application/json',
        'cache-control': 'max-age=0',
        'x-upsert': 'true',
        'accept-encoding': 'identity',
      })
      for (const entry of local.requests) {
        expect
          .soft(
            Object.keys(entry.values).every((name) =>
              ['content-type', 'cache-control', 'x-upsert', 'accept-encoding'].includes(name),
            ),
            `(g3) ${entry.method} values hold only the four names`,
          )
          .toBe(true)
      }
      expect
        .soft([created?.apikeyMatched, created?.authorization], '(g4) classes')
        .toEqual([true, 'bearer-matched'])
      expect.soft(created?.body, '(g4) the body').toEqual(body)
      expect.soft(created?.bodySha256, '(g4) its sha256').toBe(sha256(body))
      expect
        .soft([created?.pathname, created?.search], '(g4) pathname and search')
        .toEqual([`${OBJECT}content/catalogue/production.json`, ''])
    } finally {
      await local.close()
    }
  })

  it('T13-ST9 every answer sets content-length explicitly: found, missing, created, conflict, list, 500 and 401', async () => {
    const local = await startStorageStub({ apikey: FAKE_KEY })
    try {
      local.put('masters', APPROVAL_PATH, text('{"a":1}'), 'application/json')
      const json = { 'content-type': 'application/json' }
      const listBody = text(JSON.stringify({ prefix: '', limit: 10, offset: 0 }))
      const cases: readonly (readonly [
        string,
        string,
        string,
        Record<string, string>,
        Uint8Array?,
      ])[] = [
        ['found', 'GET', `${AUTHENTICATED}masters/${APPROVAL_PATH}`, { apikey: FAKE_KEY }],
        ['missing', 'GET', `${AUTHENTICATED}masters/x.json`, { apikey: FAKE_KEY }],
        ['created', 'POST', `${OBJECT}content/x.json`, { apikey: FAKE_KEY, ...json }, text('{}')],
        ['conflict', 'POST', `${OBJECT}content/x.json`, { apikey: FAKE_KEY, ...json }, text('{}')],
        ['list', 'POST', LIST_CONTENT, { apikey: FAKE_KEY, ...json }, listBody],
        ['unexpected 500', 'DELETE', '/storage/v1/object/content', { apikey: FAKE_KEY }],
        ['401', 'GET', `${AUTHENTICATED}masters/${APPROVAL_PATH}`, {}],
      ]
      for (const [label, method, pathname, headers, body] of cases) {
        const answer = await raw(local, method, pathname, headers, body)
        expect
          .soft(answer.headers['transfer-encoding'], `(g1) ${label} is not chunked`)
          .toBeUndefined()
        expect
          .soft(answer.headers['content-length'], `(g1) ${label} content-length = body`)
          .toBe(String(answer.body.length))
        expect.soft(answer.body.length > 0, `(g1) ${label} has a body`).toBe(true)
      }
      // Node adds no content-length to a HEAD answer by itself (stub-storage.ts:5-8).
      for (const [label, headers] of [
        ['unexpected 500 to HEAD', { apikey: FAKE_KEY }],
        ['401 to HEAD', {}],
      ] as const) {
        const answer = await raw(local, 'HEAD', `${AUTHENTICATED}masters/${APPROVAL_PATH}`, headers)
        expect
          .soft(Number(answer.headers['content-length']), `(g2) ${label} declares its length`)
          .toBeGreaterThan(0)
      }
    } finally {
      await local.close()
    }
  })

  it('T13-ST10a overrides: answer, redirect, gzip (declared and chunked) and an oversize object', async () => {
    const path = `${OBJECT}content/catalogue/production.json`
    stub.override('POST', path, {
      kind: 'answer',
      status: 503,
      body: '{"x":1}',
      headers: { 'X-Test': 'one' },
    })
    const answered = await send(stub, 'POST', path, {
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect
      .soft([answered.status, answered.text], '(g1) answer: status and body')
      .toEqual([503, '{"x":1}'])
    expect.soft(answered.headers.get('x-test'), '(g1) answer: extra header').toBe('one')
    expect.soft(answered.headers.get('content-length'), '(g1) answer: explicit length').toBe('7')
    expect
      .soft(stub.object('content', 'catalogue/production.json'), '(g1) answer replaces the handler')
      .toBeUndefined()
    const after = await send(stub, 'POST', path, {
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect.soft(after.status, '(g1) an override is one-shot').toBe(200)

    const read = `${AUTHENTICATED}masters/${APPROVAL_PATH}`
    stub.override('GET', read, {
      kind: 'redirect',
      status: 307,
      location: 'http://127.0.0.1:9/elsewhere',
    })
    const redirected = await send(stub, 'GET', read)
    expect.soft(redirected.status, '(g2) redirect: status').toBe(307)
    expect
      .soft(redirected.headers.get('location'), '(g2) redirect: Location')
      .toBe('http://127.0.0.1:9/elsewhere')
    expect
      .soft(redirected.headers.get('content-length'), '(g2) redirect: explicit length')
      .toBe('0')

    const object = text(JSON.stringify({ storyId: 'two-paths', note: 'x'.repeat(1900) }))
    stub.put('masters', APPROVAL_PATH, object, 'application/json')
    const compressed = gzipSync(object)
    expect(compressed.length < object.length, 'precondition: gzip shortens the object').toBe(true)
    stub.override('GET', read, { kind: 'gzip' })
    const gzipped = await raw(stub, 'GET', read, { apikey: FAKE_KEY })
    expect.soft(gzipped.headers['content-encoding'], '(g3) gzip: content-encoding').toBe('gzip')
    expect
      .soft(gzipped.headers['content-length'], '(g3) gzip: compressed length')
      .toBe(String(gzipped.body.length))
    expect.soft(gzipped.body.length < object.length, '(g3) gzip: the body is compressed').toBe(true)
    expect
      .soft(new Uint8Array(gunzipSync(gzipped.body)), '(g3) gzip: decodes to the object')
      .toEqual(object)
    stub.override('GET', read, { kind: 'gzip', chunked: true })
    const chunked = await raw(stub, 'GET', read, { apikey: FAKE_KEY })
    expect
      .soft(chunked.headers['content-length'], '(g4) chunked gzip: no content-length')
      .toBeUndefined()
    expect.soft(chunked.headers['transfer-encoding'], '(g4) chunked gzip: chunked').toBe('chunked')
    expect
      .soft(new Uint8Array(gunzipSync(chunked.body)), '(g4) chunked gzip: decodes')
      .toEqual(object)
    const plain = await raw(stub, 'GET', read, { apikey: FAKE_KEY })
    expect
      .soft(plain.headers['content-encoding'], '(g4) the next answer is identity again')
      .toBeUndefined()

    const big = new Uint8Array(1_048_577).fill(32)
    stub.put('masters', 'waivers/two-paths/big.json', big, 'application/json')
    const oversize = await raw(stub, 'GET', `${AUTHENTICATED}masters/waivers/two-paths/big.json`, {
      apikey: FAKE_KEY,
    })
    expect
      .soft(oversize.headers['content-length'], '(g5) oversize: the declared length')
      .toBe('1048577')
    expect.soft(oversize.body.length, '(g5) oversize: every byte').toBe(1_048_577)
  })

  it('T13-ST10b overrides: stall, truncate and delay', { timeout: 10_000 }, async () => {
    const local = await startStorageStub({ apikey: FAKE_KEY })
    const read = `${AUTHENTICATED}masters/${APPROVAL_PATH}`
    const bytes = text('{"storyId":"two-paths","approvedOn":"2026-11-21"}')
    let headAt = -1
    try {
      local.put('masters', APPROVAL_PATH, bytes, 'application/json')
      local.override('GET', read, { kind: 'stall' })
      let stalledHead: { status: number; headers: IncomingHttpHeaders } | undefined
      const stalled = raw(local, 'GET', read, { apikey: FAKE_KEY }, undefined, (head) => {
        stalledHead = head
        headAt = performance.now()
      })
      for (let waited = 0; stalledHead === undefined && waited < 2000; waited += 10) await pause(10)
      expect(stalledHead, 'precondition: the stalled answer sent its headers').toBeDefined()
      await pause(150)
      expect.soft(stalledHead?.status, '(g1) stall: status 200').toBe(200)
      expect
        .soft(stalledHead?.headers['content-length'], '(g1) stall: the declared length')
        .toBe(String(bytes.length))
      const pending = await Promise.race([
        stalled.then(() => 'ended'),
        pause(50).then(() => 'open'),
      ])
      expect.soft(pending, '(g1) stall: no body and no end until close').toBe('open')
      await local.close()
      const ended = await stalled
      expect.soft(ended.body.length, '(g1) stall: no byte was sent').toBe(0)
      expect.soft(ended.complete, '(g1) stall: the answer never completed').toBe(false)
      expect
        .soft(performance.now() - headAt >= 150, '(g1) stall: held open at least 150 ms')
        .toBe(true)
    } finally {
      await local.close()
    }

    const other = await startStorageStub({ apikey: FAKE_KEY })
    try {
      other.put('masters', APPROVAL_PATH, bytes, 'application/json')
      other.override('GET', read, { kind: 'truncate', declared: 100, sent: 10 })
      const truncated = await raw(other, 'GET', read, { apikey: FAKE_KEY })
      expect
        .soft(truncated.headers['content-length'], '(g2) truncate: the declared length')
        .toBe('100')
      expect.soft(truncated.body.length, '(g2) truncate: exactly the sent bytes').toBe(10)
      expect.soft(truncated.complete, '(g2) truncate: the socket closed early').toBe(false)
      expect
        .soft(new Uint8Array(truncated.body), '(g2) truncate: the first bytes of the answer')
        .toEqual(bytes.subarray(0, 10))

      other.override('GET', read, { kind: 'delay', ms: 300 })
      const started = performance.now()
      const delayed = await send(other, 'GET', read)
      const elapsed = performance.now() - started
      expect
        .soft(
          elapsed >= 290,
          `(g3) delay: not answered before 300 ms (took ${Math.round(elapsed)} ms)`,
        )
        .toBe(true)
      expect
        .soft([delayed.status, delayed.text], '(g3) delay: then the normal answer')
        .toEqual([200, new TextDecoder().decode(bytes)])
      // Review fix R1-T3: no fixed upper bound (13.12 P8); the undelayed answer only has to come
      // back sooner than the delayed one did, which a loaded machine does not change.
      const quick = performance.now()
      await send(other, 'GET', read)
      const quickElapsed = performance.now() - quick
      expect(
        quickElapsed < elapsed,
        `precondition: an undelayed answer is quicker (${Math.round(quickElapsed)} ms against ${Math.round(elapsed)} ms)`,
      ).toBe(true)
      expectNoUnexpected(other)
    } finally {
      await other.close()
    }
  })

  it(
    'T13-ST11 two stubs have separate stores and ports; after close() the port refuses connections',
    { timeout: 15_000 },
    async () => {
      const a = await startStorageStub({ apikey: FAKE_KEY })
      const b = await startStorageStub({ apikey: FAKE_KEY })
      try {
        expect.soft(a.origin.port === b.origin.port, '(g1) separate ports').toBe(false)
        expect.soft(a.origin.hostname, '(g1) loopback only').toBe('127.0.0.1')
        a.put('content', 'catalogue/production.json', text('a'), 'application/json')
        await create(b, 'content', 'catalogue/staging.json', 'b')
        expect
          .soft(b.object('content', 'catalogue/production.json'), '(g2) b does not see a')
          .toBeUndefined()
        expect
          .soft(a.object('content', 'catalogue/staging.json'), '(g2) a does not see b')
          .toBeUndefined()
        expect
          .soft(
            (await send(b, 'GET', `${AUTHENTICATED}content/catalogue/production.json`)).status,
            '(g2) b misses it',
          )
          .toBe(400)
        const port = Number(a.origin.port)
        await a.close()
        const refused = await new Promise<string>((resolve) => {
          const socket = connect({ host: '127.0.0.1', port })
          socket.on('connect', () => {
            socket.destroy()
            resolve('connected')
          })
          socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'))
        })
        expect.soft(refused, '(g3) the closed port refuses').toBe('ECONNREFUSED')
        expect
          .soft(
            (await send(b, 'GET', `${AUTHENTICATED}content/catalogue/staging.json`)).text,
            '(g3) b still serves',
          )
          .toBe('b')
        expectNoUnexpected(b)
      } finally {
        await a.close()
        await b.close()
      }
    },
  )

  it('T13-ST12 expectNoUnexpected throws when unexpected is not empty, naming method and pathname only', async () => {
    await create(stub, 'content', 'catalogue/production.json', '{}')
    await send(stub, 'GET', `${AUTHENTICATED}content/catalogue/production.json`)
    expect.soft(() => expectNoUnexpected(stub), '(g1) normal requests only: no throw').not.toThrow()
    const local = await startStorageStub({ apikey: FAKE_KEY })
    try {
      await send(local, 'DELETE', `/storage/v1/object/content?mark=${MARK}`, {
        body: `{"prefixes":["${MARK}"]}`,
      })
      let message = ''
      try {
        expectNoUnexpected(local)
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect
        .soft(message, '(g2) it throws, naming the method and pathname')
        .toContain('DELETE /storage/v1/object/content')
      expect.soft(message.includes(MARK), '(g3) no query or body text').toBe(false)
      expect.soft(message.includes(FAKE_KEY), '(g3) no key').toBe(false)
      expect.soft(message.includes('?'), '(g3) no search').toBe(false)
    } finally {
      await local.close()
    }
  })
})

// ---- Step 14 (P1-8c): the nonce form (design p1-step14-design.md §4.7, §14.10) ----

/** One raw request line over node:net, so a `#` reaches the server exactly as written. */
function rawLine(target: StorageStub, method: string, requestTarget: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: Number(target.origin.port) })
    const chunks: Buffer[] = []
    socket.on('connect', () => {
      socket.write(
        `${method} ${requestTarget} HTTP/1.1\r\nhost: 127.0.0.1\r\napikey: ${FAKE_KEY}\r\n` +
          'connection: close\r\n\r\n',
      )
    })
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('error', reject)
    socket.on('close', () => {
      const head = Buffer.concat(chunks).toString('latin1').split('\r\n')[0] ?? ''
      resolve(Number(head.split(' ')[1] ?? 0))
    })
  })
}

describe('the Storage stub nonce form (Step 14)', () => {
  it('T14-81 the stub models exactly ?cacheNonce=<1-16 digits, no leading zero> on a pointer GET (A12, L10 stub half)', async () => {
    const pointerBytes = text('{"pointer":"staging"}')
    stub.put('content', 'catalogue/staging.json', pointerBytes, 'application/json')
    const staging = `${AUTHENTICATED}content/catalogue/staging.json`
    const production = `${AUTHENTICATED}content/catalogue/production.json`
    const plain = await raw(stub, 'GET', staging, { apikey: FAKE_KEY })
    expect(plain.status, 'precondition: the pointer GET with no search is served').toBe(200)
    // (g1) modelled: both pointers, 1 digit and 16 digits
    const sixteen = '1234567890123456'
    for (const nonce of ['1', sixteen]) {
      const found = await raw(stub, 'GET', `${staging}?cacheNonce=${nonce}`, { apikey: FAKE_KEY })
      expect.soft(found.status, `(g1) staging nonce ${nonce.length} digits found`).toBe(200)
      expect
        .soft(new Uint8Array(found.body), `(g1) staging nonce ${nonce.length} bytes`)
        .toEqual(pointerBytes)
      const missing = await raw(stub, 'GET', `${production}?cacheNonce=${nonce}`, {
        apikey: FAKE_KEY,
      })
      expect.soft(missing.status, `(g1) production nonce ${nonce.length} digits missing`).toBe(400)
      expect
        .soft(missing.body.toString('utf8'), `(g1) production nonce ${nonce.length} missing body`)
        .toBe(MISSING_OBJECT_BODY)
    }
    // (g2) every near miss is unexpected (500) and recorded with its search
    const local = await startStorageStub({ apikey: FAKE_KEY })
    try {
      const stagingBytes = text('{"pointer":"local"}')
      const snapshotBytes = text('{"snapshot":7}')
      local.put('content', 'catalogue/staging.json', stagingBytes, 'application/json')
      local.put('content', 'catalogue/snapshots/7.json', snapshotBytes, 'application/json')
      const localStaging = `${AUTHENTICATED}content/catalogue/staging.json`
      const gets = [
        `${localStaging}?cacheNonce=`,
        `${localStaging}?cacheNonce=01`,
        `${localStaging}?cacheNonce=12345678901234567`,
        `${localStaging}?cacheNonce=1&x=2`,
        `${localStaging}?x=1`,
        `${localStaging}?cacheNonceX=1`,
        `${localStaging}?cachenonce=1`,
        `${localStaging}?CACHENONCE=1`,
        `${localStaging}?%63acheNonce=1`,
        `${localStaging}?`,
        `${AUTHENTICATED}content/catalogue/Staging.json?cacheNonce=1`,
        `${AUTHENTICATED}content/catalogue/staging.json/?cacheNonce=1`,
        `${AUTHENTICATED}masters/catalogue/staging.json?cacheNonce=1`,
        `${AUTHENTICATED}content/catalogue/snapshots/7.json?cacheNonce=1`,
      ]
      const sent: string[] = []
      for (const target of gets) {
        const answer = await raw(local, 'GET', target, { apikey: FAKE_KEY })
        expect.soft(answer.status, `(g2) GET ${target.slice(AUTHENTICATED.length)}`).toBe(500)
        sent.push(`GET ${target}`)
      }
      const hash = `${localStaging}?cacheNonce=1#x`
      expect.soft(await rawLine(local, 'GET', hash), '(g2) GET ?cacheNonce=1#x').toBe(500)
      sent.push(`GET ${hash}`)
      const post = `${OBJECT}content/catalogue/staging.json?cacheNonce=1`
      const posted = await raw(
        local,
        'POST',
        post,
        { apikey: FAKE_KEY, 'content-type': 'application/json', 'x-upsert': 'true' },
        text('{"pointer":"overwritten"}'),
      )
      expect.soft(posted.status, '(g2) POST with a nonce').toBe(500)
      sent.push(`POST ${post}`)
      expect
        .soft(
          local.unexpected.map((entry) => `${entry.method} ${entry.pathname}${entry.search}`),
          '(g2) each is recorded in unexpected with its search, in order',
        )
        .toEqual(sent)
      // (g3) the store is unchanged after g2
      expect
        .soft(local.object('content', 'catalogue/staging.json')?.bytes, '(g3) staging unchanged')
        .toEqual(stagingBytes)
      expect
        .soft(
          local.object('content', 'catalogue/snapshots/7.json')?.bytes,
          '(g3) snapshot unchanged',
        )
        .toEqual(snapshotBytes)
      expect
        .soft(local.object('content', 'catalogue/production.json'), '(g3) nothing created')
        .toBeUndefined()
    } finally {
      await local.close()
    }
  })
})
