// Step 13 (P1-8b) layers 2 and 3: the Storage client on a recorder and over the wire against the
// loopback stub (design p1-step13-design.md §4, §13.4). Titles start with their T13 id, except the
// six kept helper tests. One expect.soft per claim, messages "(gN) ..."; preconditions are hard.
// No request leaves 127.0.0.1: the recorder never touches the network, and a loopback guard on the
// global fetch refuses and counts any other host (13.1 D, guard G5).
// Step 14 (P1-8c, design p1-step14-design.md §14.10) adds readContent: T14-76 to T14-78, and the
// listed edits of T13-C6, T13-H3, T13-R26 (g5) and T13-W14.
import { createServer, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { inspect } from 'node:util'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../fixtures/packages/two-paths.json'
import {
  checkPackagePaths,
  checkPointer,
  checkSnapshot,
  isCanonicalJcs,
  parseStrictJson,
} from '../../src/core/content/gates'
import { MEDIA_MAX_BYTES } from '../../src/core/content/media'
import { checkUniqueStoryIds } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { CatalogueSnapshot } from '../../src/core/package/catalogue'
import { hasOwnProtoKey, StoryPackageV1 } from '../../src/core/package/v1'
import { Secret } from './env'
import {
  classifyRead,
  classifyUpload,
  createStorageClient,
  effectiveStatus,
  isFolderPrefix,
  MAX_LIST_DEPTH,
  repeatsSecretRun,
  StorageRefusedError,
  storageErrorCode,
  type StorageClient,
  type StorageClientOptions,
} from './storage'
import { MAX_JSON_BYTES } from './storage-layout'
import type * as StubModule from './storage-stub'

// ---- shared material (13.2.1) ----

// Assembled at runtime, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-storage-test-key'].join('_')
const RECORDER_URL = new URL('http://127.0.0.1:9')
const HTTPS_URL = new URL('https://abcdefghijklmnopqrst.supabase.co')
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const PKG = jcsBytes(fixture)
const PKG_SHA = await sha256Hex(PKG)
const WAIVER = new TextEncoder().encode('{"waivers":[]}')
const WAIVER_SHA = await sha256Hex(WAIVER)
const MIMES = ['image/webp', 'image/jpeg', 'audio/mpeg'] as const
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'audio/mpeg': 'mp3' } as const
/** Node 24.18.0's own request headers on the four routes (PR-3, design §10.1); POSTs add content-length. */
const NODE_DEFAULT_HEADERS = [
  'accept',
  'accept-language',
  'connection',
  'content-length',
  'host',
  'sec-fetch-mode',
  'user-agent',
]

type Ref = Record<string, unknown>
const PACKAGE_REF = (): Ref => ({ kind: 'package', storyId: 'two-paths', packageSha256: PKG_SHA })
const MEDIA_REF = (mime: string = 'image/webp'): Ref => ({
  kind: 'media',
  storyId: 'lion-and-hare',
  sha256: SHA_A,
  variant: 'w640',
  mime,
})
const SNAPSHOT_REF = (): Ref => ({ kind: 'snapshot', seq: 7 })
const APPROVAL_REF = (): Ref => ({ kind: 'approval', storyId: 'two-paths', packageSha256: SHA_A })
const WAIVER_REF = (): Ref => ({
  kind: 'waiver',
  storyId: 'lion-and-hare',
  waiverSha256: WAIVER_SHA,
})

const ENTRY = {
  storyId: 'two-paths',
  collectionId: 'panchatantra',
  version: 1,
  packagePath: `packages/two-paths/${SHA_A}.json`,
  packageSha256: SHA_A,
}
const SNAPSHOT_VALUE = (over: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0',
  seq: 7,
  createdAt: '2026-11-21T00:00:00.000Z',
  note: 't',
  featuredStoryId: null,
  stories: [ENTRY],
  ...over,
})
const SNAPSHOT = () => jcsBytes(SNAPSHOT_VALUE())
const POINTER_VALUE = (seq: number, over: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0',
  seq,
  snapshotPath: `catalogue/snapshots/${seq}.json`,
  snapshotSha256: SHA_A,
  updatedAt: '2026-11-21T00:00:00.000Z',
  ...over,
})
const POINTER = (seq: number) => jcsBytes(POINTER_VALUE(seq))
const APPROVAL = (on: string) =>
  jcsBytes({ storyId: 'two-paths', packageSha256: SHA_A, approvedOn: on })
const MEDIA = () => Uint8Array.of(1, 2, 3)
const text = (s: string) => new TextEncoder().encode(s)

const BODY_OF: Record<string, () => Uint8Array<ArrayBuffer>> = {
  package: () => PKG.slice(),
  media: MEDIA,
  snapshot: SNAPSHOT,
  approval: () => APPROVAL('2026-11-21'),
}
const VALID_REF: Record<string, () => Ref> = {
  package: PACKAGE_REF,
  media: () => MEDIA_REF(),
  snapshot: SNAPSHOT_REF,
  approval: APPROVAL_REF,
  waiver: WAIVER_REF,
}

// ---- recorder (13.2.2) ----

interface Call {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: unknown
  readonly redirect: RequestRedirect | undefined
  readonly signal: AbortSignal | null | undefined
}

type Respond = (call: Call, index: number) => Response | Promise<Response>

function recorder(respond: Respond = () => json(200, { Key: 'content/x', Id: 'id' })) {
  const calls: Call[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers)),
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

const bytesResponse = (bytes: Uint8Array<ArrayBuffer>, status = 200) =>
  new Response(bytes, { status })

function client(respond?: Respond, extra: Record<string, unknown> = {}) {
  const fake = recorder(respond)
  const storage = createStorageClient({
    supabaseUrl: RECORDER_URL,
    secretKey: new Secret(FAKE_KEY),
    fetchImpl: fake.fetchImpl,
    ...extra,
  } as StorageClientOptions)
  return { storage, calls: fake.calls }
}

const make = (options: Record<string, unknown>) => () =>
  createStorageClient(options as unknown as StorageClientOptions)

/** 13.1 C: rejects with StorageRefusedError, exact text, no cause, no new request. */
async function expectRefused(
  label: string,
  attempt: () => Promise<unknown>,
  message: string,
  count: () => number,
): Promise<void> {
  const before = count()
  let error: unknown = 'no error'
  try {
    await attempt()
  } catch (caught) {
    error = caught
  }
  expect.soft(error instanceof StorageRefusedError, `${label}: StorageRefusedError`).toBe(true)
  expect.soft((error as Error).message, `${label}: message`).toBe(`refused: ${message}`)
  expect.soft((error as Error).cause, `${label}: no cause`).toBeUndefined()
  expect.soft(count() - before, `${label}: no request`).toBe(0)
}

function optionRefusal(attempt: () => unknown): string {
  try {
    attempt()
    return 'constructed'
  } catch (error) {
    return error instanceof TypeError ? error.message : `other ${String(error)}`
  }
}

// ---- loopback guard (13.1 D, G5) ----

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

// ---- form catalogue FORMS13 (13.2.4), the subset the methods need ----

type Form = readonly [id: string, value: unknown]
type FieldRule = 'story-id' | 'sha256' | 'variant' | 'mime' | 'seq'
const STRING_FORMS: readonly Form[] = [
  ['F-C1', 'Lion-and-hare'],
  ['F-C2', 'LION-AND-HARE'],
  ['F-C3', 'A'.repeat(64)],
  ['F-C4', 'aB'.repeat(32)],
  ['F-S1', 'a/b'],
  ['F-S2', 'a\\b'],
  ['F-S3', '.'],
  ['F-S4', '..'],
  ['F-S5', 'a/../b'],
  ['F-S6', 'a//b'],
  ['F-S7', '/lion-and-hare'],
  ['F-S8', 'lion-and-hare/'],
  ['F-S9', './lion-and-hare'],
  ['F-E1', '%2e%2e'],
  ['F-E2', '%2E%2E'],
  ['F-E3', 'a%2Fb'],
  ['F-E4', 'a%252eb'],
  ['F-E5', 'a%00b'],
  ['F-U1', 'lion／hare'],
  ['F-U2', 'lion-аnd-hare'],
  ['F-U3', 'lion‍hare'],
  ['F-U4', 'lion‮hare'],
  ['F-U5', 'lion hare'],
  ['F-N1', 'lion\u0000hare'],
  ['F-N2', 'lion\nhare'],
  ['F-N3', 'lion\rhare'],
  ['F-N4', 'lion\thare'],
  ['F-N5', 'lion\u007fhare'],
  ['F-N6', 'lion-and-hare '],
  ['F-N7', ' lion-and-hare'],
  ['F-L1', 'ab'],
  ['F-L2', 'a'.repeat(65)],
  ['F-L3', 'a'.repeat(600)],
  ['F-Q1', 'lion?x-upsert=true'],
  ['F-Q2', 'lion#x'],
  ['F-Q3', 'lion;x'],
  ['F-M1', '-lion'],
  ['F-M2', 'lion-'],
  ['F-M3', 'lion--hare'],
  ['F-M4', 'lion_hare'],
  ['F-M5', 'lion.hare'],
  ['F-X1', 'lion.json'],
  ['F-X2', 'x.json/'],
  ['F-X3', '.json.txt'],
  ['F-X4', `${'a'.repeat(64)}.json`],
]
const typeForms = (valid: string): readonly Form[] => [
  ['F-Y1', [valid]],
  ['F-Y2', new String(valid)],
  ['F-Y3', { toString: () => valid }],
  ['F-Y4', 123],
  ['F-Y5', null],
  ['F-Y6', undefined],
  ['F-Y7', Symbol('x')],
  ['F-Y8', true],
]
const SEQ_FORMS: readonly Form[] = [
  ['Z1', 0],
  ['Z2', -1],
  ['Z3', 1.5],
  ['Z4', Number.NaN],
  ['Z5', Number.POSITIVE_INFINITY],
  ['Z6', 2 ** 53],
  ['Z7', '1'],
  ['Z8', 1n],
  ['Z9', new Number(1)],
  ['Z10', -0],
  ['Z11', '1.json'],
  ['Z12', null],
]
const MIME_FORMS: readonly Form[] = [
  ['MM1', 'image/png'],
  ['MM2', 'IMAGE/WEBP'],
  ['MM3', 'audio/mpeg; charset=x'],
  ['MM4', 'toString'],
  ['MM5', 'constructor'],
  ['MM6', '__proto__'],
  ['MM7', 'hasOwnProperty'],
  ['MM8', 'audio/mpeg\r\nx-upsert: true'],
  ['MM9', 'image/jpg'],
  ['MM10', ''],
]
const MODE_FORMS: readonly Form[] = [
  ['MD1', 'fixtures'],
  ['MD2', 'Production'],
  ['MD3', 'production '],
  ['MD4', 'catalogue/production'],
  ['MD5', ''],
  ['MD6', '__proto__'],
  ['MD7', 'toString'],
  ['MD8', 1],
  ['MD9', null],
  ['MD10', new String('production')],
  ['MD11', 'production.json'],
  ['MD12', 'staging\u0000'],
]
const VALID_OF: Record<FieldRule, string> = {
  'story-id': 'lion-and-hare',
  sha256: SHA_A,
  variant: 'w640',
  mime: 'image/webp',
  seq: '7',
}
function formsFor(rule: FieldRule): readonly Form[] {
  if (rule === 'seq') return SEQ_FORMS
  const base =
    rule === 'mime'
      ? MIME_FORMS
      : STRING_FORMS.filter(([id]) => !(rule === 'variant' && id === 'F-L1'))
  const extra: Form[] =
    rule === 'sha256'
      ? [['F-L4', 'a'.repeat(63)]]
      : rule === 'variant'
        ? [['F-L6', 'v'.repeat(17)]]
        : []
  return [...base, ...extra, ...typeForms(VALID_OF[rule])]
}
const CLASS_FIELDS: Record<string, readonly (readonly [string, FieldRule])[]> = {
  package: [
    ['storyId', 'story-id'],
    ['packageSha256', 'sha256'],
  ],
  media: [
    ['storyId', 'story-id'],
    ['sha256', 'sha256'],
    ['variant', 'variant'],
    ['mime', 'mime'],
  ],
  snapshot: [['seq', 'seq']],
  approval: [
    ['storyId', 'story-id'],
    ['packageSha256', 'sha256'],
  ],
  waiver: [
    ['storyId', 'story-id'],
    ['waiverSha256', 'sha256'],
  ],
}
const KIND_UNKNOWN = ['listing', 'canary', 'media-log', 'image', 'report', 'masters'] // K10-K15

/** The L7a shapes (13.3), shared by R8. */
function refShapes(valid: () => Ref, cls: string): [string, unknown, string][] {
  class Instance {
    kind = valid().kind
  }
  const rows: [string, unknown, string][] = [
    ['null', null, 'ref field ref-not-object'],
    ['array', [], 'ref field ref-not-object'],
    ['function', () => valid(), 'ref field ref-not-object'],
    ['string', 'approval', 'ref field ref-not-object'],
    ['class instance', Object.assign(new Instance(), valid()), 'ref field ref-prototype'],
    ['Object.create(validRef)', Object.create(valid()), 'ref field ref-prototype'],
  ]
  for (const extra of ['upsert', 'bucket', 'path', 'contentType', 'cacheControl']) {
    rows.push([
      `extra ${extra}`,
      { ...valid(), [extra]: extra === 'upsert' ? true : 'x' },
      `${cls} field ref-keys`,
    ])
  }
  const missing = valid()
  delete missing.storyId
  rows.push(['missing key', missing, `${cls} field ref-keys`])
  rows.push(['symbol key', { ...valid(), [Symbol('x')]: 1 }, `${cls} field ref-keys`])
  const hidden = valid()
  Object.defineProperty(hidden, 'path', { value: 'x', enumerable: false })
  rows.push(['non-enumerable key', hidden, `${cls} field ref-keys`])
  const proto = JSON.parse(`{"__proto__":{"x":1},${JSON.stringify(valid()).slice(1)}`) as Ref
  rows.push(['own __proto__', proto, `${cls} field ref-keys`])
  for (const field of ['storyId', 'kind']) {
    const ref = valid()
    const value = ref[field]
    Object.defineProperty(ref, field, { get: () => value, enumerable: true })
    rows.push([`getter ${field}`, ref, `${field === 'kind' ? 'ref' : cls} field ref-accessor`])
  }
  return rows
}

const asCreate = (storage: StorageClient, ref: unknown, body: unknown) =>
  storage.create(ref as never, body as Uint8Array)
const asRead = (storage: StorageClient, ref: unknown) => storage.readMaster(ref as never)

// ---- pure helpers: six kept tests (unchanged, A20) ----

describe('storage helpers', () => {
  it('isFolderPrefix accepts the root and safe folders ending in one slash', () => {
    expect(['', 'spikes/', 'spikes/run/'].every(isFolderPrefix)).toBe(true)
    expect(['spikes', '/spikes/', 'spikes//', '../', 'a b/'].some(isFolderPrefix)).toBe(false)
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
})

// ---- classification ----

describe('classification', () => {
  it('T13-S1 classifyUpload reads a third conflict shape (KeyAlreadyExists without statusCode) as failed', () => {
    expect
      .soft(classifyUpload(400, { code: 'KeyAlreadyExists' }), '(g1) third shape')
      .toEqual({ kind: 'failed', status: 400, code: 'KeyAlreadyExists' })
  })

  it('T13-S2 classifyRead: auth first, not-found only on the exact raw signal with a 400 or 404 status', () => {
    const rows: [number, unknown, unknown][] = [
      [400, { statusCode: '404', error: 'not_found' }, { kind: 'not-found' }],
      [400, { statusCode: '404', code: 'NoSuchKey', error: 'not_found' }, { kind: 'not-found' }],
      [404, { code: 'NoSuchKey' }, { kind: 'not-found' }],
      [400, { code: 'NoSuchKey' }, { kind: 'not-found' }],
      [404, undefined, { kind: 'failed', status: 404, code: 'unknown' }],
      [
        400,
        { statusCode: '404', code: 'NoSuchBucket' },
        { kind: 'failed', status: 404, code: 'NoSuchBucket' },
      ],
      [404, { error: 'Not Found' }, { kind: 'failed', status: 404, code: 'NotFound' }],
      [
        400,
        { statusCode: '409', error: 'Duplicate' },
        { kind: 'failed', status: 409, code: 'Duplicate' },
      ],
      [400, { code: 'nosuchkey' }, { kind: 'failed', status: 400, code: 'nosuchkey' }],
      [400, { code: 'NoSuchKeyX' }, { kind: 'failed', status: 400, code: 'NoSuchKeyX' }],
      [400, { statusCode: '403', code: 'NoSuchKey' }, { kind: 'unauthorized', status: 403 }],
      [401, {}, { kind: 'unauthorized', status: 401 }],
      [500, { code: 'NoSuchKey' }, { kind: 'failed', status: 500, code: 'NoSuchKey' }],
      [400, { code: 'InvalidKey' }, { kind: 'failed', status: 400, code: 'InvalidKey' }],
      [302, undefined, { kind: 'failed', status: 302, code: 'unknown' }],
      [
        400,
        { statusCode: '404', error: FAKE_KEY },
        { kind: 'failed', status: 404, code: 'unknown' },
      ],
      [400, undefined, { kind: 'failed', status: 400, code: 'unknown' }],
      [400, { code: 'No Such Key' }, { kind: 'failed', status: 400, code: 'NoSuchKey' }],
      [400, { error: 'Not_Found' }, { kind: 'failed', status: 400, code: 'Not_Found' }],
    ]
    expect(
      new Set(rows.map((r) => JSON.stringify(r.slice(0, 2)))).size,
      'precondition: 19 distinct rows',
    ).toBe(19)
    rows.forEach(([status, body, want], i) => {
      expect.soft(classifyRead(status, body), `(g1) row ${i + 1}`).toEqual(want)
    })
    expect
      .soft(classifyRead(403, {}), '(g1) row 12b')
      .toEqual({ kind: 'unauthorized', status: 403 })
  })
})

// ---- construction ----

describe('createStorageClient construction', () => {
  const base = (extra: Record<string, unknown> = {}) => ({
    supabaseUrl: HTTPS_URL,
    secretKey: new Secret(FAKE_KEY),
    ...extra,
  })

  it('T13-C1 accepts only https://<20 alnum>.supabase.co or http on a loopback host with a port, read from the URL itself', async () => {
    const upper = new URL('https://ABCDEFGHIJKLMNOPQRST.supabase.co:443')
    expect(upper.hostname, 'precondition: the parser lowercases the host').toBe(
      'abcdefghijklmnopqrst.supabase.co',
    )
    expect(upper.port, 'precondition: the parser drops :443').toBe('')
    const short = new URL('http://127.1:9')
    expect(short.hostname, 'precondition: 127.1 is normalised').toBe('127.0.0.1')
    const accepted: [string, URL][] = [
      ['https', HTTPS_URL],
      ['trailing slash', new URL('https://abcdefghijklmnopqrst.supabase.co/')],
      ['upper case and :443', upper],
      ['127.0.0.1', new URL('http://127.0.0.1:9')],
      ['localhost', new URL('http://localhost:9')],
      ['[::1]', new URL('http://[::1]:9')],
      ['127.1', short],
    ]
    for (const [name, url] of accepted) {
      expect
        .soft(optionRefusal(make(base({ supabaseUrl: url }))), `(g1) accepts ${name}`)
        .toBe('constructed')
    }
    const refused: [string, unknown][] = [
      ['evil', new URL('https://evil.example')],
      ['21 characters', new URL('https://abcdefghijklmnopqrstu.supabase.co')],
      ['19 characters', new URL('https://abcdefghijklmnopqrs.supabase.co')],
      ['suffix', new URL('https://abcdefghijklmnopqrst.supabase.co.evil.example')],
      ['.com', new URL('https://abcdefghijklmnopqrst.supabase.com')],
      ['port 444', new URL('https://abcdefghijklmnopqrst.supabase.co:444')],
      ['path', new URL('https://abcdefghijklmnopqrst.supabase.co/x')],
      ['query', new URL('https://abcdefghijklmnopqrst.supabase.co/?q')],
      ['fragment', new URL('https://abcdefghijklmnopqrst.supabase.co/#f')],
      ['credentials', new URL('https://u:p@abcdefghijklmnopqrst.supabase.co')],
      ['http on supabase.co', new URL('http://abcdefghijklmnopqrst.supabase.co')],
      ['loopback without a port', new URL('http://127.0.0.1')],
      ['127.0.0.2', new URL('http://127.0.0.2:9')],
      ['0.0.0.0', new URL('http://0.0.0.0:9')],
      ['localhost.', new URL('http://localhost.:9')],
      ['ws', new URL('ws://127.0.0.1:9')],
      ['a string', 'https://abcdefghijklmnopqrst.supabase.co'],
    ]
    for (const [name, url] of refused) {
      expect
        .soft(optionRefusal(make(base({ supabaseUrl: url }))), `(g2) refuses ${name}`)
        .toBe('refused: client option url-origin')
    }
    // Review fix SEC2-2: the checks and the requests read one URL, re-parsed from the URL's own href,
    // so a subclass or a forged URL cannot pass the host check and send somewhere else.
    const getters = (target: object, values: Record<string, string>) => {
      for (const [name, value] of Object.entries(values)) {
        Object.defineProperty(target, name, { get: () => value })
      }
    }
    class SupabaseLookalike extends URL {}
    getters(SupabaseLookalike.prototype, {
      hostname: 'abcdefghijklmnopqrst.supabase.co',
      origin: 'https://abcdefghijklmnopqrst.supabase.co',
      href: 'https://abcdefghijklmnopqrst.supabase.co/',
    })
    Object.defineProperty(SupabaseLookalike.prototype, 'toString', {
      value: () => 'https://abcdefghijklmnopqrst.supabase.co/',
    })
    const lookalike = new SupabaseLookalike('https://evil.example/')
    const data = (value: string) => ({ value })
    const forged: unknown = Object.create(URL.prototype, {
      protocol: data('https:'),
      username: data(''),
      password: data(''),
      hostname: data('abcdefghijklmnopqrst.supabase.co'),
      port: data(''),
      pathname: data('/'),
      search: data(''),
      hash: data(''),
      origin: data('https://evil.example'),
      href: data('https://abcdefghijklmnopqrst.supabase.co/'),
    })
    expect(forged instanceof URL, 'precondition: the forgery passes instanceof URL').toBe(true)
    expect(lookalike.hostname, 'precondition: the subclass shows a supabase.co host').toBe(
      'abcdefghijklmnopqrst.supabase.co',
    )
    const forgeries: [string, unknown][] = [
      ['a subclass over evil.example', lookalike],
      ['an Object.create(URL.prototype) forgery', forged],
    ]
    for (const [name, url] of forgeries) {
      expect
        .soft(optionRefusal(make(base({ supabaseUrl: url }))), `(g3) refuses ${name}`)
        .toBe('refused: client option url-origin')
    }
    class HttpLookalike extends URL {}
    getters(HttpLookalike.prototype, { protocol: 'http:' })
    const fake = recorder()
    const httpsAsHttp = new HttpLookalike('https://abcdefghijklmnopqrst.supabase.co')
    expect(httpsAsHttp.protocol, 'precondition: the subclass shows http:').toBe('http:')
    expect
      .soft(
        optionRefusal(make(base({ supabaseUrl: httpsAsHttp, fetchImpl: fake.fetchImpl }))),
        '(g3) an https URL that shows http: still refuses fetchImpl',
      )
      .toBe('refused: client option fetch-impl')
    class LoopbackLookalike extends URL {}
    getters(LoopbackLookalike.prototype, { origin: 'http://127.0.0.2:9' })
    const steered = createStorageClient({
      supabaseUrl: new LoopbackLookalike('http://127.0.0.1:9'),
      secretKey: new Secret(FAKE_KEY),
      fetchImpl: fake.fetchImpl,
    } as StorageClientOptions)
    await steered.readMaster(APPROVAL_REF() as never)
    expect(fake.calls.length, 'precondition: one request').toBe(1)
    expect
      .soft(fake.calls[0]?.url ?? '', '(g3) a subclass origin getter does not steer the request')
      .toMatch(/^http:\/\/127\.0\.0\.1:9\/storage\/v1\/object\/authenticated\/masters\//)
  })

  it('T13-C2 options are a plain object with exactly the known own data keys', () => {
    expect(optionRefusal(make(base())), 'precondition: valid options construct').toBe('constructed')
    class Options {
      supabaseUrl = HTTPS_URL
      secretKey = new Secret(FAKE_KEY)
    }
    const getter = base()
    Object.defineProperty(getter, 'supabaseUrl', { get: () => HTTPS_URL, enumerable: true })
    const rows: [string, () => unknown, string][] = [
      ['guards', make(base({ guards: {} })), 'option-keys'],
      ['supabaseURL', make(base({ supabaseURL: HTTPS_URL })), 'option-keys'],
      ['apikey', make(base({ apikey: FAKE_KEY })), 'option-keys'],
      ['null', () => createStorageClient(null as never), 'option-keys'],
      ['array', () => createStorageClient([] as never), 'option-keys'],
      ['class instance', () => createStorageClient(new Options() as never), 'option-keys'],
      ['getter', make(getter), 'option-accessor'],
      ['missing supabaseUrl', make({ secretKey: new Secret(FAKE_KEY) }), 'url-origin'],
    ]
    for (const [name, attempt, rule] of rows) {
      expect.soft(optionRefusal(attempt), `(g1) ${name}`).toBe(`refused: client option ${rule}`)
    }
  })

  it('T13-C3 fetchImpl is accepted only with a loopback origin', () => {
    const fake = recorder()
    expect
      .soft(optionRefusal(make(base({ fetchImpl: fake.fetchImpl }))), '(g1) https plus fetchImpl')
      .toBe('refused: client option fetch-impl')
    expect
      .soft(
        optionRefusal(make(base({ supabaseUrl: RECORDER_URL, fetchImpl: fake.fetchImpl }))),
        '(g2) loopback plus fetchImpl',
      )
      .toBe('constructed')
    expect
      .soft(
        optionRefusal(make(base({ supabaseUrl: RECORDER_URL }))),
        '(g3) loopback without fetchImpl',
      )
      .toBe('constructed')
    expect.soft(fake.calls.length + escapes, '(g3) no call made').toBe(0)
  })

  it('T13-C4 an https origin needs the secret-key shape; every origin needs 8 or more characters', () => {
    const hook = new Secret('https://api.vercel.com/v1/integrations/deploy/prj_x/hook_y')
    const publishable = new Secret(['sb', 'publishable', 'fake-storage-test-key'].join('_'))
    const rows: [string, Record<string, unknown>, string][] = [
      ['hook-shaped key on https', base({ secretKey: hook }), 'refused: client option key-shape'],
      [
        'publishable key on https',
        base({ secretKey: publishable }),
        'refused: client option key-shape',
      ],
      ['secret key on https', base(), 'constructed'],
      [
        '7 characters on https',
        base({ secretKey: new Secret('abcdefg') }),
        'refused: client option key-short',
      ],
      [
        '7 characters on loopback',
        base({ supabaseUrl: RECORDER_URL, secretKey: new Secret('abcdefg') }),
        'refused: client option key-short',
      ],
      [
        '8 plain characters on loopback',
        base({ supabaseUrl: RECORDER_URL, secretKey: new Secret('abcdefgh') }),
        'constructed',
      ],
    ]
    for (const [name, options, want] of rows) {
      expect.soft(optionRefusal(make(options)), `(g1) ${name}`).toBe(want)
    }
  })

  it('T13-C5 timeoutMs from 1 to 600000, listPageSize a positive safe integer, bearerFallback a boolean', () => {
    const loop = (extra: Record<string, unknown>) =>
      make(base({ supabaseUrl: RECORDER_URL, ...extra }))
    for (const timeoutMs of [0, -1, 1.5, Number.NaN, 600_001, '60000']) {
      expect
        .soft(optionRefusal(loop({ timeoutMs })), `(g1) timeoutMs ${String(timeoutMs)}`)
        .toBe('refused: client option timeout')
    }
    for (const timeoutMs of [1, 600_000]) {
      expect
        .soft(optionRefusal(loop({ timeoutMs })), `(g1) timeoutMs ${timeoutMs}`)
        .toBe('constructed')
    }
    for (const listPageSize of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      expect
        .soft(optionRefusal(loop({ listPageSize })), `(g2) listPageSize ${listPageSize}`)
        .toBe('refused: client option page-size')
    }
    expect.soft(optionRefusal(loop({ listPageSize: 1 })), '(g2) listPageSize 1').toBe('constructed')
    for (const bearerFallback of ['false', 1, null]) {
      expect
        .soft(
          optionRefusal(loop({ bearerFallback })),
          `(g3) bearerFallback ${String(bearerFallback)}`,
        )
        .toBe('refused: client option bearer-fallback')
    }
    for (const bearerFallback of [true, false]) {
      expect
        .soft(optionRefusal(loop({ bearerFallback })), `(g3) bearerFallback ${bearerFallback}`)
        .toBe('constructed')
    }
  })

  it('T13-C6 the client has exactly five methods and nothing else', () => {
    const { storage } = client()
    expect
      .soft(Reflect.ownKeys(storage).map(String).sort(), '(g1) own keys')
      .toEqual(['create', 'listContent', 'readContent', 'readMaster', 'writePointer'])
    for (const key of [
      'create',
      'listContent',
      'readContent',
      'readMaster',
      'writePointer',
    ] as const) {
      expect.soft(typeof storage[key], `(g1) ${key} is a function`).toBe('function')
    }
    const proto: unknown = Object.getPrototypeOf(storage)
    expect.soft(proto === Object.prototype || proto === null, '(g1) plain prototype').toBe(true)
    for (const key of ['remove', 'upload', 'list', 'send', 'emptyBucket']) {
      expect.soft(key in storage, `(g1) no ${key}`).toBe(false)
    }
  })

  it('T13-C7 every construction refusal is fixed text with no URL, key or hook', () => {
    const hookText = 'https://api.vercel.com/v1/integrations/deploy/prj_x/hook_y'
    const attempts = [
      make(base({ supabaseUrl: new URL('https://evil.example/x?q') })),
      make(base({ guards: {} })),
      make(base({ fetchImpl: recorder().fetchImpl })),
      make(base({ secretKey: new Secret(hookText) })),
      make(base({ secretKey: new Secret('abcdefg') })),
      make(base({ supabaseUrl: RECORDER_URL, timeoutMs: 0 })),
      make(base({ supabaseUrl: RECORDER_URL, listPageSize: 0 })),
      make(base({ supabaseUrl: RECORDER_URL, bearerFallback: 'false' })),
    ]
    for (const [i, attempt] of attempts.entries()) {
      const message = optionRefusal(attempt)
      expect.soft(message, `(g1) ${i} fixed text`).toMatch(/^refused: client option [a-z-]+$/)
      for (const leak of ['evil.example', FAKE_KEY, hookText, 'supabase.co']) {
        expect.soft(message.includes(leak), `(g1) ${i} no ${leak.slice(0, 12)}`).toBe(false)
      }
    }
  })
})

// ---- requests on the recorder ----

describe('requests on the recorder', () => {
  const createCases = (): [
    string,
    Ref,
    Uint8Array<ArrayBuffer>,
    string,
    string,
    string,
    number,
  ][] => [
    [
      'package',
      PACKAGE_REF(),
      PKG.slice(),
      'content',
      `packages/two-paths/${PKG_SHA}.json`,
      'application/json',
      3600,
    ],
    ...MIMES.map((mime): [string, Ref, Uint8Array<ArrayBuffer>, string, string, string, number] => [
      `media ${mime}`,
      MEDIA_REF(mime),
      MEDIA(),
      'content',
      `media/lion-and-hare/${SHA_A}-w640.${EXT[mime]}`,
      mime,
      3600,
    ]),
    [
      'snapshot',
      SNAPSHOT_REF(),
      SNAPSHOT(),
      'content',
      'catalogue/snapshots/7.json',
      'application/json',
      3600,
    ],
    [
      'approval',
      APPROVAL_REF(),
      APPROVAL('2026-11-21'),
      'masters',
      `approvals/two-paths/${SHA_A}.json`,
      'application/json',
      0,
    ],
  ]

  it('T13-R1 create sends one POST per class with the exact URL, headers, body, redirect and signal', async () => {
    const { storage, calls } = client()
    const cases = createCases()
    for (const [, ref, body] of cases) await asCreate(storage, ref, body)
    expect(calls.length, 'precondition: one call per create').toBe(cases.length)
    cases.forEach(([name, , body, bucket, path, type, seconds], i) => {
      const call = calls[i]!
      expect(
        Object.keys(call.headers).length,
        'precondition: at least 2 header names',
      ).toBeGreaterThanOrEqual(2)
      expect
        .soft(call.url, `(g1) url ${name}`)
        .toBe(`http://127.0.0.1:9/storage/v1/object/${bucket}/${path}`)
      expect.soft(call.method, `(g2) method ${name}`).toBe('POST')
      expect.soft(call.headers, `(g3) headers ${name}`).toEqual({
        apikey: FAKE_KEY,
        'content-type': type,
        'cache-control': `max-age=${seconds}`,
        'x-upsert': 'false',
        'accept-encoding': 'identity',
      })
      expect.soft(new Uint8Array(call.body as Uint8Array), `(g4) body ${name}`).toEqual(body)
      expect.soft(call.redirect, `(g5) redirect ${name}`).toBe('manual')
      expect.soft(call.signal instanceof AbortSignal, `(g6) signal ${name}`).toBe(true)
    })
  })

  it('T13-R2 writePointer sends x-upsert true and max-age=0 to exactly the two pointer paths', async () => {
    const { storage, calls } = client()
    for (const mode of ['production', 'staging'] as const)
      await storage.writePointer(mode, POINTER(7))
    expect(calls.length, 'precondition: 2 calls').toBe(2)
    ;(['production', 'staging'] as const).forEach((mode, i) => {
      const call = calls[i]!
      expect(
        Object.keys(call.headers).length,
        'precondition: at least 2 header names',
      ).toBeGreaterThanOrEqual(2)
      expect
        .soft(call.url, `(g1) url ${mode}`)
        .toBe(`http://127.0.0.1:9/storage/v1/object/content/catalogue/${mode}.json`)
      expect.soft(call.method, `(g2) method ${mode}`).toBe('POST')
      expect.soft(call.headers, `(g3) headers ${mode}`).toEqual({
        apikey: FAKE_KEY,
        'content-type': 'application/json',
        'cache-control': 'max-age=0',
        'x-upsert': 'true',
        'accept-encoding': 'identity',
      })
      expect.soft(new Uint8Array(call.body as Uint8Array), `(g4) body ${mode}`).toEqual(POINTER(7))
      expect.soft(call.redirect, `(g5) redirect ${mode}`).toBe('manual')
      expect.soft(call.signal instanceof AbortSignal, `(g6) signal ${mode}`).toBe(true)
    })
  })

  it('T13-R3 readMaster sends one GET of the authenticated route with apikey and identity only', async () => {
    const { storage, calls } = client(() => bytesResponse(WAIVER.slice()))
    await asRead(storage, APPROVAL_REF())
    await asRead(storage, WAIVER_REF())
    expect(calls.length, 'precondition: 2 calls').toBe(2)
    const paths = [`approvals/two-paths/${SHA_A}.json`, `waivers/lion-and-hare/${WAIVER_SHA}.json`]
    paths.forEach((path, i) => {
      const call = calls[i]!
      expect(
        Object.keys(call.headers).length,
        'precondition: at least 2 header names',
      ).toBeGreaterThanOrEqual(2)
      expect
        .soft(call.url, `(g1) url ${path}`)
        .toBe(`http://127.0.0.1:9/storage/v1/object/authenticated/masters/${path}`)
      expect.soft(call.method, `(g2) method ${path}`).toBe('GET')
      expect
        .soft(call.headers, `(g3) headers ${path}`)
        .toEqual({ apikey: FAKE_KEY, 'accept-encoding': 'identity' })
      expect.soft(call.body, `(g4) no body ${path}`).toBeUndefined()
      expect.soft(call.redirect, `(g5) redirect ${path}`).toBe('manual')
      expect.soft(call.signal instanceof AbortSignal, `(g6) signal ${path}`).toBe(true)
    })
  })

  it('T13-R4 listContent posts the list route of content with the exact body and headers', async () => {
    const { storage, calls } = client(() => json(200, []))
    expect(await storage.listContent('catalogue/'), 'precondition: listed').toEqual({
      kind: 'listed',
      objects: [],
    })
    expect(calls.length, 'precondition: 1 call').toBe(1)
    const call = calls[0]!
    expect.soft(call.url, '(g1) url').toBe('http://127.0.0.1:9/storage/v1/object/list/content')
    expect.soft(call.method, '(g2) method').toBe('POST')
    expect.soft(call.headers, '(g3) headers').toEqual({
      apikey: FAKE_KEY,
      'content-type': 'application/json',
      'accept-encoding': 'identity',
    })
    expect
      .soft(call.body, '(g4) body')
      .toBe(
        '{"prefix":"catalogue","limit":100,"offset":0,"sortBy":{"column":"name","order":"asc"}}',
      )
  })

  it('T13-R5 bearerFallback adds exactly Authorization: Bearer on all four routes; the default adds none', async () => {
    for (const [flag, want] of [
      [true, `Bearer ${FAKE_KEY}`],
      [undefined, undefined],
    ] as const) {
      const respond: Respond = (call) =>
        call.method === 'GET'
          ? bytesResponse(WAIVER.slice())
          : call.url.includes('/list/')
            ? json(200, [])
            : json(200, {})
      const { storage, calls } = client(respond, flag === undefined ? {} : { bearerFallback: flag })
      await asCreate(storage, MEDIA_REF(), MEDIA())
      await storage.writePointer('production', POINTER(7))
      await asRead(storage, WAIVER_REF())
      await storage.listContent('')
      expect(calls.length, 'precondition: 4 calls').toBe(4)
      for (const call of calls) {
        expect
          .soft(
            call.headers.authorization,
            `(g1) ${String(flag)} ${call.method} ${call.url.slice(22, 60)}`,
          )
          .toBe(want)
      }
    }
  })

  const R6: [string, string, 'create' | 'read'][] = [
    ['T13-R6a', 'package', 'create'],
    ['T13-R6b', 'media', 'create'],
    ['T13-R6c', 'snapshot', 'create'],
    ['T13-R6d', 'approval', 'create'],
    ['T13-R6e', 'approval', 'read'],
    ['T13-R6f', 'waiver', 'read'],
  ]
  for (const [id, cls, method] of R6) {
    it(`${id} ${method === 'create' ? 'create' : 'readMaster'} refuses every ${cls} field form at stage field with 0 requests`, async () => {
      const respond: Respond = () =>
        method === 'read' ? bytesResponse(WAIVER.slice()) : json(200, {})
      const { storage, calls } = client(respond)
      const run = (ref: unknown) =>
        method === 'create' ? asCreate(storage, ref, BODY_OF[cls]!()) : asRead(storage, ref)
      await run(VALID_REF[cls]!())
      expect(calls.length, 'precondition: the valid ref makes exactly 1 call').toBe(1)
      for (const [field, rule] of CLASS_FIELDS[cls]!) {
        for (const [form, value] of formsFor(rule)) {
          await expectRefused(
            `(g1) ${field} ${form}`,
            () => run({ ...VALID_REF[cls]!(), [field]: value }),
            `${cls} field ${rule}`,
            () => calls.length,
          )
        }
      }
    })
  }

  it('T13-R6g writePointer refuses every mode form at stage field with 0 requests', async () => {
    const { storage, calls } = client()
    await storage.writePointer('production', POINTER(7))
    expect(calls.length, 'precondition: the valid mode makes exactly 1 call').toBe(1)
    for (const [form, mode] of MODE_FORMS) {
      await expectRefused(
        `(g1) ${form}`,
        () => storage.writePointer(mode as never, POINTER(7)),
        'pointer field mode',
        () => calls.length,
      )
    }
  })

  it('T13-R7 each method takes only its kinds', async () => {
    const { storage, calls } = client()
    const count = () => calls.length
    await expectRefused(
      '(g1) create waiver',
      () => asCreate(storage, WAIVER_REF(), WAIVER.slice()),
      'waiver field kind-not-creatable',
      count,
    )
    await expectRefused(
      '(g1) create pointer',
      () => asCreate(storage, { kind: 'pointer', mode: 'production' }, POINTER(7)),
      'ref field kind-unknown',
      count,
    )
    for (const cls of ['package', 'media', 'snapshot']) {
      await expectRefused(
        `(g2) readMaster ${cls}`,
        () => asRead(storage, VALID_REF[cls]!()),
        `${cls} field kind-not-readable`,
        count,
      )
    }
    for (const kind of KIND_UNKNOWN) {
      await expectRefused(
        `(g3) create ${kind}`,
        () => asCreate(storage, { ...APPROVAL_REF(), kind }, MEDIA()),
        'ref field kind-unknown',
        count,
      )
      await expectRefused(
        `(g3) readMaster ${kind}`,
        () => asRead(storage, { ...APPROVAL_REF(), kind }),
        'ref field kind-unknown',
        count,
      )
    }
  })

  it('T13-R8 odd ref shapes are refused by create and readMaster with 0 requests', async () => {
    const { storage, calls } = client()
    for (const [name, ref, want] of refShapes(APPROVAL_REF, 'approval')) {
      await expectRefused(
        `(g1) create ${name}`,
        () => asCreate(storage, ref, APPROVAL('2026-11-21')),
        want,
        () => calls.length,
      )
    }
    for (const [name, ref, want] of refShapes(WAIVER_REF, 'waiver')) {
      await expectRefused(
        `(g2) readMaster ${name}`,
        () => asRead(storage, ref),
        want,
        () => calls.length,
      )
    }
  })

  it('T13-R9 a bucket, path or upsert from the caller is refused, the old upload shape too', async () => {
    const { storage, calls } = client()
    const count = () => calls.length
    await expectRefused(
      '(g1) approval plus bucket',
      () => asCreate(storage, { ...APPROVAL_REF(), bucket: 'content' }, APPROVAL('2026-11-21')),
      'approval field ref-keys',
      count,
    )
    await expectRefused(
      '(g1) package plus bucket',
      () => asCreate(storage, { ...PACKAGE_REF(), bucket: 'masters' }, PKG.slice()),
      'package field ref-keys',
      count,
    )
    await expectRefused(
      '(g1) package plus upsert',
      () => asCreate(storage, { ...PACKAGE_REF(), upsert: true }, PKG.slice()),
      'package field ref-keys',
      count,
    )
    const old = {
      bucket: 'masters',
      path: 'canary.txt',
      body: MEDIA(),
      contentType: 'text/plain',
      cacheControl: 0,
      upsert: true,
    }
    await expectRefused(
      '(g1) old upload shape',
      () => asCreate(storage, old, MEDIA()),
      'ref field kind-unknown',
      count,
    )
  })

  it('T13-R10a only a Uint8Array over a plain ArrayBuffer (a Buffer included) is a body', async () => {
    const { storage, calls } = client()
    for (const cls of ['media', 'approval']) {
      const valid = BODY_OF[cls]!()
      await asCreate(storage, VALID_REF[cls]!(), valid)
      await asCreate(storage, VALID_REF[cls]!(), Buffer.from(valid))
    }
    expect(calls.length, 'precondition: Uint8Array and Buffer pass').toBe(4)
    for (const cls of ['media', 'approval']) {
      const bytes = BODY_OF[cls]!()
      const shared = new Uint8Array(new SharedArrayBuffer(bytes.byteLength))
      shared.set(bytes)
      const bodies: [string, unknown][] = [
        ['ArrayBuffer', bytes.buffer],
        ['DataView', new DataView(bytes.buffer)],
        ['Uint16Array', new Uint16Array(4)],
        ['Uint8ClampedArray', new Uint8ClampedArray(bytes)],
        ['number[]', [...bytes]],
        ['string', '{}'],
        ['null', null],
        ['SharedArrayBuffer view', shared],
        ['Proxy', new Proxy(BODY_OF[cls]!(), {})],
      ]
      for (const [name, body] of bodies) {
        await expectRefused(
          `(g1) ${cls} ${name}`,
          () => asCreate(storage, VALID_REF[cls]!(), body),
          `${cls} body-gate body-type`,
          () => calls.length,
        )
      }
    }
  })

  it('T13-R10b a body is 1 byte to the class cap: empty and cap+1 refused, the cap itself sent', async () => {
    const { storage, calls } = client()
    const count = () => calls.length
    for (const cls of ['package', 'media', 'snapshot', 'approval']) {
      await expectRefused(
        `(g1) empty ${cls}`,
        () => asCreate(storage, VALID_REF[cls]!(), new Uint8Array(0)),
        `${cls} body-gate body-size`,
        count,
      )
    }
    await expectRefused(
      '(g1) empty pointer',
      () => storage.writePointer('production', new Uint8Array(0)),
      'pointer body-gate body-size',
      count,
    )
    await asCreate(storage, MEDIA_REF(), new Uint8Array(MEDIA_MAX_BYTES))
    expect.soft(calls.length, '(g2) media at the cap is sent').toBe(1)
    await expectRefused(
      '(g2) media cap+1',
      () => asCreate(storage, MEDIA_REF(), new Uint8Array(MEDIA_MAX_BYTES + 1)),
      'media body-gate body-size',
      count,
    )
    const padded = (total: number) => {
      const head = jcsBytes({
        approvedOn: '2026-11-21',
        pad: '',
        packageSha256: SHA_A,
        storyId: 'two-paths',
      })
      return jcsBytes({
        approvedOn: '2026-11-21',
        pad: 'x'.repeat(total - head.byteLength),
        packageSha256: SHA_A,
        storyId: 'two-paths',
      })
    }
    const atCap = padded(MAX_JSON_BYTES)
    expect(atCap.byteLength, 'precondition: the padded record is exactly 1 MiB').toBe(1_048_576)
    await asCreate(storage, APPROVAL_REF(), atCap)
    expect.soft(calls.length, '(g3) approval at the cap is sent').toBe(2)
    await expectRefused(
      '(g3) approval cap+1',
      () => asCreate(storage, APPROVAL_REF(), padded(MAX_JSON_BYTES + 1)),
      'approval body-gate body-size',
      count,
    )
    await expectRefused(
      '(g3) approval cap+1 not JSON',
      () => asCreate(storage, APPROVAL_REF(), new Uint8Array(MAX_JSON_BYTES + 1).fill(0x20)),
      'approval body-gate body-size',
      count,
    )
  })

  it('T13-R11 package gate: sha256, canonical JCS, strict v1 parse and storyId, each alone', async () => {
    const pretty = text(JSON.stringify(fixture, null, 2))
    const extra = jcsBytes({ ...fixture, extraKey: 1 })
    const samples: [string, Ref, Uint8Array<ArrayBuffer>, string][] = [
      ['g1', { ...PACKAGE_REF(), packageSha256: SHA_A }, PKG.slice(), 'sha256-mismatch'],
      ['g2', { ...PACKAGE_REF(), packageSha256: await sha256Hex(pretty) }, pretty, 'not-jcs'],
      ['g3', { ...PACKAGE_REF(), packageSha256: await sha256Hex(extra) }, extra, 'strict-parse'],
      ['g4', { ...PACKAGE_REF(), storyId: 'lion-and-hare' }, PKG.slice(), 'story-id-mismatch'],
    ]
    const { storage, calls } = client()
    await asCreate(storage, PACKAGE_REF(), PKG.slice())
    expect(calls.length, 'precondition: the valid package is sent').toBe(1)
    for (const [group, ref, body, rule] of samples) {
      const parsed = parseStrictJson(body, StoryPackageV1, 'p')
      const failing = [
        (await sha256Hex(body)) !== ref.packageSha256 ? 'sha256-mismatch' : null,
        !isCanonicalJcs(JSON.parse(new TextDecoder().decode(body)), body) ? 'not-jcs' : null,
        !parsed.ok ? 'strict-parse' : null,
        parsed.ok && parsed.value.data.storyId !== ref.storyId ? 'story-id-mismatch' : null,
      ].filter((v) => v !== null)
      expect(failing, `precondition: ${group} fails only ${rule}`).toEqual([rule])
      await expectRefused(
        `(${group}) ${rule}`,
        () => asCreate(storage, ref, body),
        `package body-gate ${rule}`,
        () => calls.length,
      )
    }
  })

  it('T13-R12 snapshot gate: strict parse, JCS, seq, packagePath and unique storyIds, each alone', async () => {
    const two = [
      ENTRY,
      { ...ENTRY, packageSha256: SHA_B, packagePath: `packages/two-paths/${SHA_B}.json` },
    ]
    const samples: [string, Uint8Array<ArrayBuffer>, string][] = [
      ['g1', jcsBytes({ ...SNAPSHOT_VALUE(), extra: 1 }), 'strict-parse'],
      ['g2', text(JSON.stringify(SNAPSHOT_VALUE(), null, 2)), 'not-jcs'],
      ['g3', jcsBytes(SNAPSHOT_VALUE({ seq: 8 })), 'seq-mismatch'],
      [
        'g4',
        jcsBytes(
          SNAPSHOT_VALUE({ stories: [{ ...ENTRY, packagePath: 'packages/two-paths.json' }] }),
        ),
        'package-path',
      ],
      ['g5', jcsBytes(SNAPSHOT_VALUE({ stories: two })), 'story-id-unique'],
    ]
    const { storage, calls } = client()
    await asCreate(storage, SNAPSHOT_REF(), SNAPSHOT())
    expect(calls.length, 'precondition: the valid snapshot is sent').toBe(1)
    for (const [group, body, rule] of samples) {
      const parsed = parseStrictJson(body, CatalogueSnapshot, 's')
      const failing = parsed.ok
        ? [
            !isCanonicalJcs(parsed.value.raw, body) ? 'not-jcs' : null,
            parsed.value.data.seq !== 7 ? 'seq-mismatch' : null,
            !checkPackagePaths(parsed.value.data.stories, 'production', '').ok
              ? 'package-path'
              : null,
            !checkUniqueStoryIds(parsed.value.data.stories).ok ? 'story-id-unique' : null,
          ].filter((v) => v !== null)
        : ['strict-parse']
      expect(failing, `precondition: ${group} fails only ${rule}`).toEqual([rule])
      await expectRefused(
        `(${group}) ${rule}`,
        () => asCreate(storage, SNAPSHOT_REF(), body),
        `snapshot body-gate ${rule}`,
        () => calls.length,
      )
    }
  })

  it('T13-R13 pointer gate: the build pointer gate, then seq 1 or more', async () => {
    const { storage, calls } = client()
    await storage.writePointer('production', POINTER(7))
    expect(calls.length, 'precondition: the valid pointer is sent').toBe(1)
    const g1: [string, Uint8Array<ArrayBuffer>][] = [
      [
        'wrong seq path',
        jcsBytes(POINTER_VALUE(3, { snapshotPath: 'catalogue/snapshots/4.json' })),
      ],
      ['not canonical', text(JSON.stringify(POINTER_VALUE(3), null, 2))],
      [
        'another root',
        jcsBytes(POINTER_VALUE(3, { snapshotPath: 'spikes/run/catalogue/snapshots/3.json' })),
      ],
    ]
    for (const [name, body] of g1) {
      expect(
        checkPointer(body, { mode: 'production', root: '' }).ok,
        `precondition: ${name} fails the pointer gate`,
      ).toBe(false)
      await expectRefused(
        `(g1) ${name}`,
        () => storage.writePointer('production', body),
        'pointer body-gate pointer-gate',
        () => calls.length,
      )
    }
    expect(
      checkPointer(POINTER(0), { mode: 'production', root: '' }).ok,
      'precondition: seq 0 passes checkPointer',
    ).toBe(true)
    await expectRefused(
      '(g2) seq 0',
      () => storage.writePointer('production', POINTER(0)),
      'pointer body-gate pointer-seq',
      () => calls.length,
    )
  })

  it('T13-R14 approval gate: a JSON object, no __proto__ key at any depth, own storyId and packageSha256 equal', async () => {
    const { storage, calls } = client()
    await asCreate(storage, APPROVAL_REF(), APPROVAL('2026-11-21'))
    expect(calls.length, 'precondition: the valid record is sent').toBe(1)
    const record = (over: Record<string, unknown>, drop?: string) => {
      const value: Record<string, unknown> = {
        storyId: 'two-paths',
        packageSha256: SHA_A,
        approvedOn: '2026-11-21',
        ...over,
      }
      if (drop) delete value[drop]
      return jcsBytes(value)
    }
    const rows: [string, Uint8Array<ArrayBuffer>, string][] = [
      ['g1 0xff', Uint8Array.of(0xff), 'record-json'],
      ['g1 []', text('[]'), 'record-json'],
      ['g1 null', text('null'), 'record-json'],
      ['g1 "x"', text('"x"'), 'record-json'],
      [
        'g2 top-level __proto__',
        text(`{"__proto__":{},"packageSha256":"${SHA_A}","storyId":"two-paths"}`),
        'proto-key',
      ],
      [
        'g2 nested __proto__',
        text(`{"packageSha256":"${SHA_A}","storyId":"two-paths","x":{"__proto__":{}}}`),
        'proto-key',
      ],
      ['g3 other storyId', record({ storyId: 'fox-and-crow' }), 'record-story-id'],
      ['g3 missing storyId', record({}, 'storyId'), 'record-story-id'],
      ['g3 number storyId', record({ storyId: 7 }), 'record-story-id'],
      ['g4 other sha', record({ packageSha256: SHA_B }), 'record-sha256'],
      ['g4 missing sha', record({}, 'packageSha256'), 'record-sha256'],
      ['g4 upper sha', record({ packageSha256: SHA_A.toUpperCase() }), 'record-sha256'],
    ]
    for (const [name, body, rule] of rows) {
      await expectRefused(
        `(${name})`,
        () => asCreate(storage, APPROVAL_REF(), body),
        `approval body-gate ${rule}`,
        () => calls.length,
      )
    }
    // Review fix SEC-4: hasOwnProtoKey (v1.ts:148) looks no deeper than 64 levels, so a record that
    // nests deeper cannot be cleared of __proto__ keys and is refused (fail closed).
    const deep = (levels: number, inner: string) =>
      text(
        `{"packageSha256":"${SHA_A}","storyId":"two-paths","x":${'{"x":'.repeat(levels)}${inner}${'}'.repeat(levels)}}`,
      )
    const protoAt70 = deep(69, '{"__proto__":{}}')
    expect(
      hasOwnProtoKey(JSON.parse(new TextDecoder().decode(protoAt70))),
      'precondition: hasOwnProtoKey does not see a __proto__ key 70 levels deep',
    ).toBe(false)
    const before = calls.length
    expect
      .soft(
        await asCreate(storage, APPROVAL_REF(), deep(63, '{}')),
        '(g5) a record whose deepest object is 64 levels down is still sent',
      )
      .toEqual({ kind: 'created' })
    expect.soft(calls.length, '(g5) one request for it').toBe(before + 1)
    for (const [name, body] of [
      ['g5 __proto__ 70 levels deep', protoAt70],
      ['g5 an object 65 levels deep', deep(64, '{}')],
    ] as const) {
      await expectRefused(
        `(${name})`,
        () => asCreate(storage, APPROVAL_REF(), body),
        'approval body-gate proto-key',
        () => calls.length,
      )
    }
  })

  it('T13-R15 checks run in order: field, then body type, then size, then the gate', async () => {
    const { storage, calls } = client()
    const count = () => calls.length
    const shared = (bytes: Uint8Array) => {
      const view = new Uint8Array(new SharedArrayBuffer(bytes.byteLength))
      view.set(bytes)
      return view
    }
    const badStory = { ...APPROVAL_REF(), storyId: 'Two-Paths' }
    const badRecord = jcsBytes({
      storyId: 'fox-and-crow',
      packageSha256: SHA_A,
      approvedOn: '2026-11-21',
    })
    const head = jcsBytes({
      approvedOn: '2026-11-21',
      pad: '',
      packageSha256: SHA_A,
      storyId: 'two-paths',
    })
    const overCap = jcsBytes({
      approvedOn: '2026-11-21',
      pad: 'x'.repeat(MAX_JSON_BYTES + 1 - head.byteLength),
      packageSha256: SHA_A,
      storyId: 'two-paths',
    })
    expect(overCap.byteLength, 'precondition: cap+1 record').toBe(MAX_JSON_BYTES + 1)
    // hard preconditions: each component alone gives its own stage and rule
    const alone: [string, () => Promise<unknown>, string][] = [
      [
        'bad storyId',
        () => asCreate(storage, badStory, APPROVAL('2026-11-21')),
        'approval field story-id',
      ],
      [
        'empty body',
        () => asCreate(storage, APPROVAL_REF(), new Uint8Array(0)),
        'approval body-gate body-size',
      ],
      [
        'shared buffer',
        () => asCreate(storage, APPROVAL_REF(), shared(APPROVAL('2026-11-21'))),
        'approval body-gate body-type',
      ],
      [
        'gate failure',
        () => asCreate(storage, APPROVAL_REF(), badRecord),
        'approval body-gate record-story-id',
      ],
      [
        'padded cap+1',
        () => asCreate(storage, APPROVAL_REF(), overCap),
        'approval body-gate body-size',
      ],
      [
        'small non-JSON',
        () => asCreate(storage, APPROVAL_REF(), text('not json')),
        'approval body-gate record-json',
      ],
    ]
    for (const [name, attempt, want] of alone) {
      let message = 'resolved'
      await attempt().catch((e: unknown) => (message = (e as Error).message))
      expect(message, `precondition: ${name} alone`).toBe(`refused: ${want}`)
    }
    await asCreate(storage, APPROVAL_REF(), APPROVAL('2026-11-21'))
    expect(calls.length, 'precondition: the valid control makes exactly 1 call').toBe(1)
    await expectRefused(
      '(g1) field before body',
      () => asCreate(storage, badStory, new Uint8Array(0)),
      'approval field story-id',
      count,
    )
    await expectRefused(
      '(g2) body type before gate',
      () => asCreate(storage, APPROVAL_REF(), shared(badRecord)),
      'approval body-gate body-type',
      count,
    )
    await expectRefused(
      '(g3) size before gate',
      () => asCreate(storage, APPROVAL_REF(), new Uint8Array(MAX_JSON_BYTES + 1).fill(0x20)),
      'approval body-gate body-size',
      count,
    )
  })

  it('T13-R16 a src/core reason is never forwarded, not as the message and not as the cause', async () => {
    const marker = 'q7marker'
    const markedSnapshot = jcsBytes(
      SNAPSHOT_VALUE({
        stories: [{ ...ENTRY, storyId: 'q7marker-zz', packagePath: 'packages/q7marker-zz.json' }],
      }),
    )
    const seqSnapshot = jcsBytes(SNAPSHOT_VALUE({ seq: 987654321 }))
    const markedPointer = jcsBytes(
      POINTER_VALUE(424242, { snapshotPath: 'catalogue/snapshots/1.json' }),
    )
    const markedPackage = jcsBytes({ ...fixture, q7markerkey: 1 })
    const markedSha = await sha256Hex(markedPackage)
    const parsedSnapshot = parseStrictJson(markedSnapshot, CatalogueSnapshot, 's')
    const reasons: [string, string][] = [
      [
        'a',
        parsedSnapshot.ok
          ? ((
              checkPackagePaths(parsedSnapshot.value.data.stories, 'production', '') as {
                reason?: string
              }
            ).reason ?? '')
          : '',
      ],
      [
        'b',
        (
          (await checkSnapshot(
            seqSnapshot,
            { ...POINTER_VALUE(7), snapshotSha256: await sha256Hex(seqSnapshot) } as never,
            'staging',
          )) as { reason?: string }
        ).reason ?? '',
      ],
      [
        'c',
        (checkPointer(markedPointer, { mode: 'production', root: '' }) as { reason?: string })
          .reason ?? '',
      ],
      [
        'd',
        (parseStrictJson(markedPackage, StoryPackageV1, 'p') as { reason?: string }).reason ?? '',
      ],
    ]
    expect(reasons[0]![1], 'precondition: (a) the src/core reason holds the marker').toContain(
      marker,
    )
    expect(reasons[1]![1], 'precondition: (b) the src/core reason holds the seq').toContain(
      '987654321',
    )
    expect(reasons[2]![1], 'precondition: (c) the src/core reason holds the seq').toContain(
      '424242',
    )
    expect(reasons[3]![1], 'precondition: (d) the src/core reason holds the marker').toContain(
      marker,
    )
    const { storage } = client()
    const attempts: [string, () => Promise<unknown>, string, string][] = [
      [
        'a',
        () => asCreate(storage, SNAPSHOT_REF(), markedSnapshot),
        'snapshot body-gate package-path',
        marker,
      ],
      [
        'b',
        () => asCreate(storage, SNAPSHOT_REF(), seqSnapshot),
        'snapshot body-gate seq-mismatch',
        '987654321',
      ],
      [
        'c',
        () => storage.writePointer('production', markedPointer),
        'pointer body-gate pointer-gate',
        '424242',
      ],
      [
        'd',
        () => asCreate(storage, { ...PACKAGE_REF(), packageSha256: markedSha }, markedPackage),
        'package body-gate strict-parse',
        marker,
      ],
      [
        'e',
        () =>
          asCreate(
            storage,
            APPROVAL_REF(),
            jcsBytes({ storyId: 'q7marker-x', packageSha256: SHA_A }),
          ),
        'approval body-gate record-story-id',
        marker,
      ],
    ]
    for (const [name, attempt, want, mark] of attempts) {
      const error = (await attempt().catch((e: unknown) => e)) as Error
      expect.soft(error.message, `(g1) ${name} fixed text`).toBe(`refused: ${want}`)
      expect.soft(String(error).includes(mark), `(g1) ${name} String has no marker`).toBe(false)
      expect.soft(error.cause, `(g2) ${name} no cause`).toBeUndefined()
      expect
        .soft(
          JSON.stringify(Object.entries(error)).includes(mark),
          `(g2) ${name} own entries have no marker`,
        )
        .toBe(false)
    }
  })

  it('T13-R17 create classifies every answer: created, duplicate unchecked, too-large, mime-refused, unauthorized, failed, network', async () => {
    const rows: [string, () => Response | Promise<Response>, unknown][] = [
      ['g1 200', () => json(200, {}), { kind: 'created' }],
      [
        'g2 409',
        () => json(409, { error: 'Duplicate' }),
        { kind: 'duplicate', stored: 'unchecked' },
      ],
      [
        'g2 400/409',
        () => json(400, { statusCode: '409', error: 'Duplicate' }),
        { kind: 'duplicate', stored: 'unchecked' },
      ],
      ['g3 413', () => json(413, {}), { kind: 'too-large' }],
      ['g3 400/413', () => json(400, { statusCode: '413' }), { kind: 'too-large' }],
      ['g4 415', () => json(415, {}), { kind: 'mime-refused' }],
      ['g4 400/415', () => json(400, { statusCode: '415' }), { kind: 'mime-refused' }],
      ['g5 401', () => json(401, {}), { kind: 'unauthorized', status: 401 }],
      ['g5 403', () => json(403, {}), { kind: 'unauthorized', status: 403 }],
      ['g5 400/403', () => json(400, { statusCode: '403' }), { kind: 'unauthorized', status: 403 }],
      [
        'g6 400 InvalidKey',
        () => json(400, { code: 'InvalidKey' }),
        { kind: 'failed', status: 400, code: 'InvalidKey' },
      ],
      [
        'g6 500',
        () => json(500, { code: 'InternalError' }),
        { kind: 'failed', status: 500, code: 'InternalError' },
      ],
      [
        'g6 502 no body',
        () => new Response(null, { status: 502 }),
        { kind: 'failed', status: 502, code: 'unknown' },
      ],
      [
        'g6 302',
        () => new Response(null, { status: 302 }),
        { kind: 'failed', status: 302, code: 'unknown' },
      ],
      [
        'g6 400 KeyAlreadyExists',
        () => json(400, { code: 'KeyAlreadyExists' }),
        { kind: 'failed', status: 400, code: 'KeyAlreadyExists' },
      ],
      [
        'g7 ECONNREFUSED',
        () =>
          Promise.reject(
            new TypeError('fetch failed', {
              cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
            }),
          ),
        { kind: 'failed', status: null, code: 'TypeError (ECONNREFUSED)' },
      ],
      [
        'g8 timeout',
        () => Promise.reject(new DOMException('The operation timed out', 'TimeoutError')),
        { kind: 'failed', status: null, code: 'TimeoutError' },
      ],
    ]
    expect(rows.length, 'precondition: 17 rows').toBe(17)
    for (const [name, answer, want] of rows) {
      const { storage, calls } = client(() => answer())
      expect.soft(await asCreate(storage, PACKAGE_REF(), PKG.slice()), `(${name})`).toEqual(want)
      expect.soft(calls.length, `(${name}) one call`).toBe(1)
    }
  })

  it('T13-R18 writePointer: written, a duplicate is failed 409, and the other kinds as for create', async () => {
    const rows: [string, () => Response | Promise<Response>, unknown][] = [
      ['200', () => json(200, {}), { kind: 'written' }],
      ['409', () => json(409, {}), { kind: 'failed', status: 409, code: 'duplicate' }],
      [
        '400/409',
        () => json(400, { statusCode: '409' }),
        { kind: 'failed', status: 409, code: 'duplicate' },
      ],
      ['413', () => json(413, {}), { kind: 'too-large' }],
      ['401', () => json(401, {}), { kind: 'unauthorized', status: 401 }],
      [
        '500',
        () => json(500, { code: 'InternalError' }),
        { kind: 'failed', status: 500, code: 'InternalError' },
      ],
      [
        'network',
        () => Promise.reject(new TypeError('fetch failed')),
        { kind: 'failed', status: null, code: 'TypeError' },
      ],
    ]
    for (const [name, answer, want] of rows) {
      const { storage, calls } = client(() => answer())
      expect
        .soft(await storage.writePointer('production', POINTER(7)), `(g1) ${name}`)
        .toEqual(want)
      expect.soft(calls.length, `(g1) ${name} one call`).toBe(1)
    }
  })

  it('T13-R19a a 200 read is found with bytes, size and sha256; a waiver must hash to its name', async () => {
    const marked = text('{"marker":"q7body"}')
    const markedSha = await sha256Hex(marked)
    const approval = await asRead(
      client(() => bytesResponse(marked.slice())).storage,
      APPROVAL_REF(),
    )
    expect
      .soft(approval, '(g1) approval found')
      .toEqual({ kind: 'found', bytes: marked, size: marked.byteLength, sha256: markedSha })
    const waiver = await asRead(client(() => bytesResponse(WAIVER.slice())).storage, WAIVER_REF())
    expect
      .soft(waiver, '(g2) matching waiver found')
      .toEqual({ kind: 'found', bytes: WAIVER, size: WAIVER.byteLength, sha256: WAIVER_SHA })
    const other = await asRead(client(() => bytesResponse(marked.slice())).storage, {
      ...WAIVER_REF(),
      waiverSha256: SHA_B,
    })
    expect
      .soft(other, '(g3) other waiver is hash-mismatch with the actual hash')
      .toEqual({ kind: 'hash-mismatch', sha256: markedSha })
    expect.soft(Object.keys(other).sort(), '(g3) keys').toEqual(['kind', 'sha256'])
    expect.soft(JSON.stringify(other).includes('q7body'), '(g3) no body').toBe(false)
    expect(markedSha === SHA_A, 'precondition: the approval bytes do not hash to the name').toBe(
      false,
    )
    expect.soft(approval.kind, '(g4) approvals have no name hash').toBe('found')
  })

  it('T13-R19b non-2xx reads go through classifyRead; an oversized error body is failed unknown', async () => {
    const rows: [number, unknown, unknown][] = [
      [400, { statusCode: '404', error: 'not_found' }, { kind: 'not-found' }],
      [400, { statusCode: '404', code: 'NoSuchKey', error: 'not_found' }, { kind: 'not-found' }],
      [404, undefined, { kind: 'failed', status: 404, code: 'unknown' }],
      [
        400,
        { statusCode: '404', code: 'NoSuchBucket' },
        { kind: 'failed', status: 404, code: 'NoSuchBucket' },
      ],
      [
        400,
        { statusCode: '409', error: 'Duplicate' },
        { kind: 'failed', status: 409, code: 'Duplicate' },
      ],
      [400, { statusCode: '403', code: 'NoSuchKey' }, { kind: 'unauthorized', status: 403 }],
      [500, { code: 'NoSuchKey' }, { kind: 'failed', status: 500, code: 'NoSuchKey' }],
    ]
    for (const [status, body, want] of rows) {
      const answer = () =>
        body === undefined ? new Response(null, { status }) : json(status, body)
      expect
        .soft(
          await asRead(client(answer).storage, APPROVAL_REF()),
          `(g1) ${status} ${JSON.stringify(body)}`,
        )
        .toEqual(want)
    }
    const big = () => new Response(new Uint8Array(2 * 1024 * 1024).fill(0x20), { status: 400 })
    expect
      .soft(await asRead(client(big).storage, APPROVAL_REF()), '(g2) 2 MiB error body')
      .toEqual({ kind: 'failed', status: 400, code: 'unknown' })
    const broken = (status: number) => () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(text('{"code":'))
            controller.error(new TypeError('terminated'))
          },
        }),
        { status },
      )
    expect
      .soft(await asRead(client(broken(400)).storage, APPROVAL_REF()), '(g3) unreadable error body')
      .toEqual({ kind: 'failed', status: 400, code: 'unknown' })
    expect
      .soft(await asRead(client(broken(200)).storage, APPROVAL_REF()), '(g4) unreadable 2xx body')
      .toEqual({ kind: 'failed', status: null, code: 'TypeError' })
  })

  it('T13-R19c the 1 MiB read cap: a declared length over it, a streamed body over it, and exactly the cap', async () => {
    const declared = () =>
      new Response(new Uint8Array(10), { headers: { 'content-length': '1048577' } })
    expect(
      (await declared().arrayBuffer()).byteLength,
      'precondition: the body really is 10 bytes',
    ).toBe(10)
    expect
      .soft(await asRead(client(declared).storage, APPROVAL_REF()), '(g1) declared')
      .toEqual({ kind: 'too-large', limit: 1_048_576 })
    const streamed = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_JSON_BYTES))
            controller.enqueue(new Uint8Array(1))
            controller.close()
          },
        }),
      )
    expect
      .soft(await asRead(client(streamed).storage, APPROVAL_REF()), '(g2) streamed')
      .toEqual({ kind: 'too-large', limit: 1_048_576 })
    const exact = await asRead(
      client(() => new Response(new Uint8Array(MAX_JSON_BYTES))).storage,
      APPROVAL_REF(),
    )
    expect
      .soft(exact.kind === 'found' && exact.size, '(g3) exactly the cap is found')
      .toBe(1_048_576)
  })

  it('T13-R20 an approval duplicate reads the record back once: identical, different or unchecked', async () => {
    const body = APPROVAL('2026-11-21')
    const rows: [string, () => Response | Promise<Response>, string][] = [
      ['same bytes', () => bytesResponse(APPROVAL('2026-11-21')), 'identical'],
      ['other bytes', () => bytesResponse(APPROVAL('2026-11-20')), 'different'],
      ['400 not_found', () => json(400, { statusCode: '404', error: 'not_found' }), 'unchecked'],
      ['500', () => json(500, {}), 'unchecked'],
      ['401', () => json(401, {}), 'unchecked'],
      ['network', () => Promise.reject(new TypeError('fetch failed')), 'unchecked'],
      ['over the cap', () => new Response(new Uint8Array(MAX_JSON_BYTES + 1)), 'unchecked'],
    ]
    for (const [name, read, stored] of rows) {
      const { storage, calls } = client((call) =>
        call.method === 'POST' ? json(409, { error: 'Duplicate' }) : read(),
      )
      expect
        .soft(await asCreate(storage, APPROVAL_REF(), body.slice()), `(g1) ${name}`)
        .toEqual({ kind: 'duplicate', stored })
      expect
        .soft(
          calls.map((c) => c.method),
          `(g2) ${name} calls`,
        )
        .toEqual(['POST', 'GET'])
      expect
        .soft(calls[1]?.url, `(g2) ${name} GET url`)
        .toBe(
          `http://127.0.0.1:9/storage/v1/object/authenticated/masters/approvals/two-paths/${SHA_A}.json`,
        )
    }
    const content = client(() => json(409, {}))
    await asCreate(content.storage, PACKAGE_REF(), PKG.slice())
    expect.soft(content.calls.length, '(g3) a content duplicate makes 1 call').toBe(1)
    const pointer = client(() => json(409, {}))
    await pointer.storage.writePointer('production', POINTER(7))
    expect.soft(pointer.calls.length, '(g3) writePointer never reads back').toBe(1)
  })

  it('T13-R26 an unreadable or over-cap body under a known status is classified with the body undefined on every route: 401 and 403 stay unauthorized and the status is kept', async () => {
    // Design §17, FID-1 option (a). A 2xx read keeps §3.4 (its body is the object: R19b g4, W8, W11).
    const cut = (status: number) => () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(text('{"code":'))
            controller.error(new TypeError('terminated'))
          },
        }),
        { status },
      )
    const overCap = (status: number) => () =>
      new Response(new Uint8Array(MAX_JSON_BYTES + 1).fill(0x20), { status })
    let readError: unknown = null
    await cut(401)()
      .arrayBuffer()
      .catch((error: unknown) => (readError = error))
    expect(readError, 'precondition: the cut body cannot be read').toBeInstanceOf(TypeError)
    type Row = readonly [name: string, answer: () => Response, want: unknown]
    const routes: readonly [string, (storage: StorageClient) => Promise<unknown>, Row[]][] = [
      [
        'g1 create',
        (storage) => asCreate(storage, PACKAGE_REF(), PKG.slice()),
        [
          ['401 cut', cut(401), { kind: 'unauthorized', status: 401 }],
          ['403 cut', cut(403), { kind: 'unauthorized', status: 403 }],
          ['401 over the cap', overCap(401), { kind: 'unauthorized', status: 401 }],
          ['409 cut', cut(409), { kind: 'duplicate', stored: 'unchecked' }],
          ['500 cut', cut(500), { kind: 'failed', status: 500, code: 'unknown' }],
          ['200 cut', cut(200), { kind: 'created' }],
        ],
      ],
      [
        'g2 writePointer',
        (storage) => storage.writePointer('production', POINTER(7)),
        [
          ['403 cut', cut(403), { kind: 'unauthorized', status: 403 }],
          ['401 over the cap', overCap(401), { kind: 'unauthorized', status: 401 }],
          ['409 cut', cut(409), { kind: 'failed', status: 409, code: 'duplicate' }],
          ['500 cut', cut(500), { kind: 'failed', status: 500, code: 'unknown' }],
          ['200 cut', cut(200), { kind: 'written' }],
        ],
      ],
      [
        'g3 listContent',
        (storage) => storage.listContent('catalogue/'),
        [
          ['401 cut', cut(401), { kind: 'unauthorized', status: 401 }],
          ['403 over the cap', overCap(403), { kind: 'unauthorized', status: 403 }],
          ['500 cut', cut(500), { kind: 'failed', status: 500, code: 'unknown' }],
          ['200 cut', cut(200), { kind: 'failed', status: 200, code: 'unreadable-response' }],
        ],
      ],
      [
        'g4 readMaster',
        (storage) => asRead(storage, APPROVAL_REF()),
        [
          ['401 over the cap', overCap(401), { kind: 'unauthorized', status: 401 }],
          ['403 cut', cut(403), { kind: 'unauthorized', status: 403 }],
          ['500 over the cap', overCap(500), { kind: 'failed', status: 500, code: 'unknown' }],
        ],
      ],
      [
        'g5 readContent',
        (storage) => storage.readContent({ kind: 'pointer', mode: 'staging' }),
        [
          ['401 cut', cut(401), { kind: 'unauthorized', status: 401 }],
          ['403 over the cap', overCap(403), { kind: 'unauthorized', status: 403 }],
          ['500 cut', cut(500), { kind: 'failed', status: 500, code: 'unknown' }],
          ['200 cut', cut(200), { kind: 'failed', status: null, code: 'TypeError' }],
        ],
      ],
    ]
    for (const [label, call, rows] of routes) {
      const [group, route] = label.split(' ')
      for (const [name, answer, want] of rows) {
        const { storage, calls } = client(() => answer())
        expect.soft(await call(storage), `(${group}) ${route} ${name}`).toEqual(want)
        expect.soft(calls.length, `(${group}) ${route} ${name} one call`).toBe(1)
      }
    }
  })

  // ---- Step 14 (P1-8c): readContent (design p1-step14-design.md §3.4, §14.10) ----

  const CONTENT_READ = 'http://127.0.0.1:9/storage/v1/object/authenticated/content/'
  const POINTER_READ = (mode: 'production' | 'staging') => ({ kind: 'pointer', mode }) as const
  const nonceOf = (url: string | undefined): number => {
    const match = /\?cacheNonce=([1-9][0-9]{0,15})$/.exec(url ?? '')
    return match ? Number(match[1]) : Number.NaN
  }

  it('T14-76 readContent on the recorder: the route, a nonce on pointer reads only, the headers, one call and no retry (A11)', async () => {
    const { storage, calls } = client(() => bytesResponse(POINTER(7)))
    const first = await storage.readContent(POINTER_READ('staging'))
    expect(first.kind, 'precondition: found').toBe('found')
    // (g1) the route, with a nonce on pointer reads only
    await storage.readContent(POINTER_READ('production'))
    expect(calls.length, 'precondition: two pointer calls').toBe(2)
    const snapshotRead = await storage
      .readContent({ kind: 'snapshot', seq: 7 })
      .then((result) => result.kind)
      .catch((error: unknown) => `threw ${(error as Error).message}`)
    expect.soft(snapshotRead, '(g1) snapshot read found').toBe('found')
    for (const [i, mode] of (['staging', 'production'] as const).entries()) {
      expect
        .soft(calls[i]?.url, `(g1) ${mode} pointer url`)
        .toMatch(
          new RegExp(
            `^${CONTENT_READ.replaceAll('.', '\\.')}catalogue/${mode}\\.json\\?cacheNonce=[1-9][0-9]{0,15}$`,
          ),
        )
      expect.soft(calls[i]?.method, `(g1) ${mode} GET`).toBe('GET')
    }
    expect
      .soft(calls[2]?.url, '(g1) snapshot url with no search')
      .toBe(`${CONTENT_READ}catalogue/snapshots/7.json`)
    // (g2) the headers
    for (const [i, call] of calls.entries()) {
      expect
        .soft(call.headers, `(g2) headers ${i}`)
        .toEqual({ apikey: FAKE_KEY, 'accept-encoding': 'identity' })
      expect.soft(call.body, `(g2) no body ${i}`).toBeUndefined()
    }
    const bearer = client(() => bytesResponse(POINTER(7)), { bearerFallback: true })
    await bearer.storage.readContent(POINTER_READ('staging'))
    await bearer.storage.readContent({ kind: 'snapshot', seq: 7 })
    for (const [i, call] of bearer.calls.entries()) {
      expect.soft(call.headers, `(g2) bearerFallback headers ${i}`).toEqual({
        apikey: FAKE_KEY,
        authorization: `Bearer ${FAKE_KEY}`,
        'accept-encoding': 'identity',
      })
    }
    // (g3) Date.now frozen: three pointer reads give strictly increasing nonces
    const frozen = vi.spyOn(Date, 'now').mockReturnValue(1_732_190_000_000)
    const fresh = client(() => bytesResponse(POINTER(7)))
    try {
      for (let i = 0; i < 3; i++) await fresh.storage.readContent(POINTER_READ('staging'))
    } finally {
      frozen.mockRestore()
    }
    const nonces = fresh.calls.map((call) => nonceOf(call.url))
    expect(nonces.length, 'precondition: three frozen-clock calls').toBe(3)
    expect
      .soft(
        nonces[0]! < nonces[1]! && nonces[1]! < nonces[2]!,
        `(g3) strictly increasing ${nonces.join(' ')}`,
      )
      .toBe(true)
    // (g4) a clock outside the nonce range is refused at stage url, with 0 calls
    for (const [name, value] of [
      ['1e16', 1e16],
      ['2**53', 2 ** 53],
      ['NaN', Number.NaN],
    ] as const) {
      const edge = client(() => bytesResponse(POINTER(7)))
      const spy = vi.spyOn(Date, 'now').mockReturnValue(value)
      try {
        await expectRefused(
          `(g4) Date.now ${name}`,
          () => edge.storage.readContent(POINTER_READ('staging')),
          'pointer url url-mismatch',
          () => edge.calls.length,
        )
      } finally {
        spy.mockRestore()
      }
    }
    // (g5) a 500 is one call: never retried
    const failing = client(() => json(500, {}))
    expect
      .soft(await failing.storage.readContent(POINTER_READ('staging')), '(g5) failed')
      .toEqual({ kind: 'failed', status: 500, code: 'unknown' })
    expect.soft(failing.calls.length, '(g5) one call').toBe(1)
  })

  it('T14-77 readContent classification: found without a hash check, too-large, not-found, unauthorized, failed scrubbed (A11)', async () => {
    const marked = text('{"marker":"q7body"}')
    const markedSha = await sha256Hex(marked)
    const refs = [POINTER_READ('staging'), { kind: 'snapshot', seq: 7 } as const]
    for (const ref of refs) {
      const read = (respond: Respond) => client(respond).storage.readContent(ref)
      const label = ref.kind
      expect(markedSha === SHA_A, 'precondition: the bytes hash to no name').toBe(false)
      // (g1) found whatever the bytes
      expect
        .soft(await read(() => bytesResponse(marked.slice())), `(g1) ${label} found`)
        .toEqual({ kind: 'found', bytes: marked, size: marked.byteLength, sha256: markedSha })
      // (g2) over the cap
      expect
        .soft(
          await read(() => new Response(new Uint8Array(MAX_JSON_BYTES + 1))),
          `(g2) ${label} over 1 MiB`,
        )
        .toEqual({ kind: 'too-large', limit: MAX_JSON_BYTES })
      // (g3) not-found and unauthorized through classifyRead
      const rows: [string, () => Response, unknown][] = [
        [
          '400 not_found',
          () => json(400, { statusCode: '404', error: 'not_found' }),
          { kind: 'not-found' },
        ],
        [
          '400 NoSuchKey',
          () => json(400, { statusCode: '404', code: 'NoSuchKey', error: 'not_found' }),
          { kind: 'not-found' },
        ],
        ['404 not_found', () => json(404, { error: 'not_found' }), { kind: 'not-found' }],
        ['401', () => json(401, {}), { kind: 'unauthorized', status: 401 }],
        ['403', () => json(403, {}), { kind: 'unauthorized', status: 403 }],
      ]
      for (const [name, answer, want] of rows) {
        expect.soft(await read(answer), `(g3) ${label} ${name}`).toEqual(want)
      }
      // (g4) failures scrubbed
      const echoed = await read(() => json(500, { code: FAKE_KEY, message: `bad ${FAKE_KEY}` }))
      expect
        .soft(echoed, `(g4) ${label} 500 echoing the key`)
        .toEqual({ kind: 'failed', status: 500, code: 'unknown' })
      expect.soft(JSON.stringify(echoed).includes(FAKE_KEY), `(g4) ${label} no key`).toBe(false)
      const partial = FAKE_KEY.slice('sb_secret_'.length)
      const echoedPart = await read(() => json(500, { code: partial }))
      expect
        .soft(echoedPart, `(g4) ${label} 500 echoing the key without its sb_ start`)
        .toEqual({ kind: 'failed', status: 500, code: 'unknown' })
      const network = await read(() => Promise.reject(new TypeError('fetch failed')))
      expect
        .soft(network.kind === 'failed' && network.status, `(g4) ${label} network status null`)
        .toBe(null)
    }
  })
})

// ---- listContent ----

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
const stored = (path: string, size: number, mimetype: string) => ({
  path,
  size,
  mimetype,
  cacheControl: 'max-age=3600',
  updatedAt: '2026-11-07T10:00:00.000Z',
})

describe('listContent', () => {
  it('T13-R21a lists every object recursively across pages, sorted by path', async () => {
    const tree = {
      spikes: [
        file('a.json', 10, 'application/json'),
        folder('audio'),
        file('b.json', 20, 'application/json'),
      ],
      'spikes/audio': [file('x.mp3', 30, 'audio/mpeg')],
    }
    const { storage, calls } = client(listServer(tree, 2), { listPageSize: 2 })
    // The folder sorts between the two files, so the result order proves the sort.
    expect.soft(await storage.listContent('spikes/'), '(g1) result').toEqual({
      kind: 'listed',
      objects: [
        stored('spikes/a.json', 10, 'application/json'),
        stored('spikes/audio/x.mp3', 30, 'audio/mpeg'),
        stored('spikes/b.json', 20, 'application/json'),
      ],
    })
    const sortBy = '"sortBy":{"column":"name","order":"asc"}'
    const route = 'http://127.0.0.1:9/storage/v1/object/list/content'
    expect
      .soft(
        calls.map((c) => [c.method, c.url, c.body]),
        '(g2) requests',
      )
      .toEqual([
        ['POST', route, `{"prefix":"spikes","limit":2,"offset":0,${sortBy}}`],
        ['POST', route, `{"prefix":"spikes","limit":2,"offset":2,${sortBy}}`],
        ['POST', route, `{"prefix":"spikes/audio","limit":2,"offset":0,${sortBy}}`],
      ])
  })

  it('T13-R21b lists the bucket root with an empty prefix and tolerates missing metadata', async () => {
    const { storage, calls } = client(() => json(200, [{ name: 'readme.txt', id: 'id-1' }]))
    expect.soft(await storage.listContent(''), '(g1) result').toEqual({
      kind: 'listed',
      objects: [
        { path: 'readme.txt', size: null, mimetype: null, cacheControl: null, updatedAt: null },
      ],
    })
    expect
      .soft(JSON.parse(String(calls[0]?.body)), '(g2) body')
      .toMatchObject({ prefix: '', limit: 100 })
  })

  it('T13-R21c refuses invalid folders as listing field folder', async () => {
    const { storage, calls } = client()
    for (const bad of ['spikes', '/spikes/', 'spikes//', '../', 'a b/', 'a/../', 'A\\b/', 7]) {
      await expectRefused(
        `(g1) ${JSON.stringify(bad)}`,
        () => storage.listContent(bad as string),
        'listing field folder',
        () => calls.length,
      )
    }
  })

  it('T13-R21d returns unauthorized, unreadable and limit failures', async () => {
    expect
      .soft(await client(() => json(401, {})).storage.listContent('catalogue/'), '(g1) 401')
      .toEqual({ kind: 'unauthorized', status: 401 })
    expect
      .soft(
        await client(() => json(200, { not: 'a list' })).storage.listContent(''),
        '(g2) unreadable',
      )
      .toEqual({ kind: 'failed', status: 200, code: 'unreadable-response' })
    const endless = client(() => json(200, [folder('d')]))
    expect
      .soft(await endless.storage.listContent(''), '(g3) depth')
      .toEqual({ kind: 'failed', status: null, code: 'list-depth-exceeded' })
    expect.soft(endless.calls.length, '(g3) depth calls').toBe(MAX_LIST_DEPTH + 1)
    const huge = client(
      () =>
        json(
          200,
          Array.from({ length: 1000 }, (_v, i) => file(`f${i}.json`, 1, 'x/y')),
        ),
      { listPageSize: 1000 },
    )
    expect
      .soft(await huge.storage.listContent(''), '(g4) size')
      .toEqual({ kind: 'failed', status: null, code: 'list-size-exceeded' })
  })

  it('T13-R22 a server-chosen unsafe name fails the whole call before any folder built from it is requested', async () => {
    const names = ['../x', 'a/b', 'a\u0000b', '..', '.', 'x%2f']
    for (const name of names) {
      for (const asFolder of [false, true]) {
        const entry = asFolder ? folder(name) : file(name, 1, 'application/json')
        const { storage, calls } = client(() => json(200, [entry]))
        expect
          .soft(
            await storage.listContent('catalogue/'),
            `(g1) ${JSON.stringify(name)} ${asFolder ? 'folder' : 'file'}`,
          )
          .toEqual({ kind: 'failed', status: null, code: 'unsafe-name' })
        expect
          .soft(
            calls.length,
            `(g2) ${JSON.stringify(name)} ${asFolder ? 'folder' : 'file'} one call`,
          )
          .toBe(1)
      }
    }
    const fine = client(() => json(200, [file('README.md', 1, 'text/plain')]))
    expect
      .soft((await fine.storage.listContent('catalogue/')).kind, '(g3) README.md is listed')
      .toBe('listed')
  })
})

// ---- no retries, body copy, accessor refs ----

describe('time of check and retries', () => {
  it('T13-R23 no operation retries: one call each, two for an approval duplicate', async () => {
    const answers: [string, () => Response | Promise<Response>][] = [
      ['500', () => json(500, {})],
      ['503', () => json(503, {})],
      ['network', () => Promise.reject(new TypeError('fetch failed'))],
      ['timeout', () => Promise.reject(new DOMException('t', 'TimeoutError'))],
    ]
    for (const [name, answer] of answers) {
      const c = client(() => answer())
      await asCreate(c.storage, PACKAGE_REF(), PKG.slice())
      expect.soft(c.calls.length, `(g1) create ${name}`).toBe(1)
    }
    for (const [name, answer] of answers.slice(0, 3)) {
      const p = client(() => answer())
      await p.storage.writePointer('production', POINTER(7))
      expect.soft(p.calls.length, `(g2) writePointer ${name}`).toBe(1)
      const r = client(() => answer())
      await asRead(r.storage, APPROVAL_REF())
      expect.soft(r.calls.length, `(g3) readMaster ${name}`).toBe(1)
    }
    const dup = client((call) => (call.method === 'POST' ? json(409, {}) : json(500, {})))
    await asCreate(dup.storage, APPROVAL_REF(), APPROVAL('2026-11-21'))
    expect.soft(dup.calls.length, '(g4) approval duplicate with a 500 read').toBe(2)
  })

  it('T13-R24 the body is copied at entry: size, gate, hash and request use the copy, for every class', async () => {
    // (g1) media, flipped right after the call
    const m1 = client()
    const body1 = MEDIA()
    const p1 = asCreate(m1.storage, MEDIA_REF(), body1)
    body1.fill(9)
    await p1
    const sent1 = m1.calls[0]?.body as Uint8Array
    expect.soft([...sent1], '(g1) recorded bytes').toEqual([1, 2, 3])
    expect
      .soft(sent1 === body1 || sent1.buffer === body1.buffer, '(g1) not the caller buffer')
      .toBe(false)
    // (g2) flipped in a microtask
    const m2 = client()
    const body2 = MEDIA()
    const p2 = asCreate(m2.storage, MEDIA_REF(), body2)
    queueMicrotask(() => body2.fill(9))
    await p2
    expect.soft([...(m2.calls[0]?.body as Uint8Array)], '(g2) recorded bytes').toEqual([1, 2, 3])
    // (g3) a subarray view
    const m3 = client()
    await asCreate(m3.storage, MEDIA_REF(), Uint8Array.of(7, 7, 1, 2, 3, 7, 7, 7).subarray(2, 5))
    const sent3 = m3.calls[0]?.body as Uint8Array
    expect.soft([...sent3], '(g3) view bytes').toEqual([1, 2, 3])
    expect.soft(sent3.buffer.byteLength, '(g3) view length').toBe(3)
    // (g4) a pooled Buffer
    const pooled = Buffer.from([1, 2, 3])
    expect(
      pooled.byteOffset > 0 || pooled.buffer.byteLength > 3,
      'precondition: a pooled Buffer',
    ).toBe(true)
    const m4 = client()
    expect
      .soft(await asCreate(m4.storage, MEDIA_REF(), pooled), '(g4) accepted')
      .toEqual({ kind: 'created' })
    expect.soft([...(m4.calls[0]?.body as Uint8Array)], '(g4) bytes').toEqual([1, 2, 3])
    // (g5)-(g8) the irreversible writes, the caller's buffer flipped right after the call
    const flips: [
      string,
      (s: StorageClient, b: Uint8Array) => Promise<unknown>,
      () => Uint8Array<ArrayBuffer>,
    ][] = [
      ['g5 package', (s, b) => asCreate(s, PACKAGE_REF(), b), () => PKG.slice()],
      ['g6 snapshot', (s, b) => asCreate(s, SNAPSHOT_REF(), b), SNAPSHOT],
      ['g7 approval', (s, b) => asCreate(s, APPROVAL_REF(), b), () => APPROVAL('2026-11-21')],
      ['g8 pointer', (s, b) => s.writePointer('production', b), () => POINTER(7)],
    ]
    for (const [name, call, bytes] of flips) {
      const c = client()
      const body = bytes()
      const original = body.slice()
      const pending = call(c.storage, body)
      body[1] = body[1]! ^ 0xff
      expect(body[1] !== original[1], `precondition: ${name} flip changed a byte`).toBe(true)
      const result = await pending
      expect
        .soft(result, `(${name}) sent`)
        .toEqual(name.includes('pointer') ? { kind: 'written' } : { kind: 'created' })
      expect
        .soft(new Uint8Array(c.calls[0]?.body as Uint8Array), `(${name}) call-time bytes`)
        .toEqual(original)
      if (name.includes('package')) {
        expect
          .soft(
            await sha256Hex(new Uint8Array(c.calls[0]?.body as Uint8Array)),
            '(g5) recorded sha256',
          )
          .toBe(PKG_SHA)
      }
    }
  })

  it('T13-R25 refs are read once from data descriptors through the methods', async () => {
    const { storage, calls } = client(() => bytesResponse(WAIVER.slice()))
    let ran = 0
    const getterStory = APPROVAL_REF()
    Object.defineProperty(getterStory, 'storyId', {
      get: () => (ran++, 'two-paths'),
      enumerable: true,
    })
    await expectRefused(
      '(g1) getter storyId',
      () => asRead(storage, getterStory),
      'approval field ref-accessor',
      () => calls.length,
    )
    expect.soft(ran, '(g1) the getter ran 0 times').toBe(0)
    const getterKind = APPROVAL_REF()
    Object.defineProperty(getterKind, 'kind', { get: () => 'approval', enumerable: true })
    await expectRefused(
      '(g2) getter kind',
      () => asRead(storage, getterKind),
      'ref field ref-accessor',
      () => calls.length,
    )
    let gets = 0
    const flipping = new Proxy(APPROVAL_REF(), {
      get(target, key, receiver) {
        gets++
        return key === 'storyId' ? 'fox-and-crow' : Reflect.get(target, key, receiver)
      },
    })
    await asRead(storage, flipping)
    expect
      .soft(calls.at(-1)?.url, '(g3) get-trap Proxy reads the target path')
      .toBe(
        `http://127.0.0.1:9/storage/v1/object/authenticated/masters/approvals/two-paths/${SHA_A}.json`,
      )
    expect.soft(gets, '(g3) get trap unused').toBe(0)
    const seen = new Map<PropertyKey, number>()
    const twice = new Proxy(APPROVAL_REF(), {
      getOwnPropertyDescriptor(target, key) {
        const n = (seen.get(key) ?? 0) + 1
        seen.set(key, n)
        const d = Reflect.getOwnPropertyDescriptor(target, key)
        return n >= 2 && key === 'storyId' && d ? { ...d, value: 'fox-and-crow' } : d
      },
    })
    const before = calls.length
    await asRead(storage, twice)
    expect.soft(calls.length - before, '(g4) one call').toBe(1)
    expect
      .soft(
        calls.at(-1)?.url.endsWith(`/approvals/two-paths/${SHA_A}.json`),
        '(g4) first value used',
      )
      .toBe(true)
  })
})

// ---- secrets ----

describe('the key never leaves the client', () => {
  it('T13-H1 the key is not visible when the client is inspected or serialized', () => {
    const { storage } = client()
    expect
      .soft(inspect(storage, { depth: 10, showHidden: true }).includes(FAKE_KEY), '(g1) inspect')
      .toBe(false)
    expect.soft(String(JSON.stringify(storage)).includes(FAKE_KEY), '(g2) JSON').toBe(false)
  })

  it('T13-H2 a key-shaped ref value or record value gives fixed text, no key, no header names', async () => {
    const { storage } = client()
    const attempts: [string, () => Promise<unknown>][] = [
      [
        'ref storyId',
        () => asCreate(storage, { ...APPROVAL_REF(), storyId: FAKE_KEY }, APPROVAL('2026-11-21')),
      ],
      [
        'record storyId',
        () =>
          asCreate(storage, APPROVAL_REF(), jcsBytes({ storyId: FAKE_KEY, packageSha256: SHA_A })),
      ],
    ]
    for (const [name, attempt] of attempts) {
      const error = (await attempt().catch((e: unknown) => e)) as Error
      expect
        .soft(error.message, `(g1) ${name}`)
        .toMatch(/^refused: approval (field story-id|body-gate record-story-id)$/)
      expect.soft(String(error).includes(FAKE_KEY), `(g2) ${name} no key`).toBe(false)
      expect
        .soft(/apikey|authorization/i.test(String(error)), `(g2) ${name} no header names`)
        .toBe(false)
    }
  })

  it('T13-H3 an echoed key in a server code becomes unknown on all five methods', async () => {
    const answer: Respond = () => json(500, { code: FAKE_KEY, message: `bad ${FAKE_KEY}` })
    const results = [
      await asCreate(client(answer).storage, MEDIA_REF(), MEDIA()),
      await asRead(client(answer).storage, APPROVAL_REF()),
      await client(answer).storage.writePointer('production', POINTER(7)),
      await client(answer).storage.listContent(''),
      await client(answer).storage.readContent({ kind: 'pointer', mode: 'staging' }),
    ]
    expect(results.length, 'precondition: 5 calls').toBe(5)
    results.forEach((result, i) => {
      expect.soft(result, `(g1) ${i}`).toEqual({ kind: 'failed', status: 500, code: 'unknown' })
      expect.soft(JSON.stringify(result).includes(FAKE_KEY), `(g2) ${i} no key`).toBe(false)
    })
  })

  it('T13-H4 an echo after a long prefix leaves no part of the key in a code', async () => {
    const error = `The provided API key is invalid: ${FAKE_KEY}`
    const answer: Respond = () => json(400, { statusCode: '400', error })
    for (const result of [
      await asCreate(client(answer).storage, MEDIA_REF(), MEDIA()),
      await asRead(client(answer).storage, APPROVAL_REF()),
    ]) {
      expect.soft(result, '(g1) unknown').toEqual({ kind: 'failed', status: 400, code: 'unknown' })
      expect.soft(repeatsSecretRun(JSON.stringify(result), FAKE_KEY), '(g2) no key run').toBe(false)
    }
  })

  it('T13-H5 a code that repeats part of the key without its sb_ start becomes unknown', async () => {
    const partial = FAKE_KEY.slice('sb_secret_'.length)
    const answer: Respond = () => json(500, { code: partial })
    expect
      .soft(await asCreate(client(answer).storage, MEDIA_REF(), MEDIA()), '(g1) create')
      .toEqual({ kind: 'failed', status: 500, code: 'unknown' })
    expect
      .soft(await asRead(client(answer).storage, APPROVAL_REF()), '(g1) readMaster')
      .toEqual({ kind: 'failed', status: 500, code: 'unknown' })
  })

  it('T13-H6 a network cause code that repeats part of the key becomes unknown', async () => {
    const answer: Respond = () =>
      Promise.reject(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('x'), { code: FAKE_KEY.slice(10, 30) }),
        }),
      )
    expect
      .soft(await asCreate(client(answer).storage, MEDIA_REF(), MEDIA()), '(g1) create')
      .toEqual({ kind: 'failed', status: null, code: 'unknown' })
    expect
      .soft(await asRead(client(answer).storage, APPROVAL_REF()), '(g1) readMaster')
      .toEqual({ kind: 'failed', status: null, code: 'unknown' })
  })

  it('T13-H7 results carry only their typed keys and never the server message', async () => {
    const message = 'q7servermessage'
    const failed = await asCreate(
      client(() => json(500, { code: 'InternalError', message })).storage,
      MEDIA_REF(),
      MEDIA(),
    )
    const unauthorized = await asRead(client(() => json(401, { message })).storage, APPROVAL_REF())
    const found = await asRead(client(() => bytesResponse(WAIVER.slice())).storage, WAIVER_REF())
    const notFound = await asRead(
      client(() => json(400, { statusCode: '404', error: 'not_found', message })).storage,
      APPROVAL_REF(),
    )
    expect.soft(Object.keys(failed).sort(), '(g1) failed keys').toEqual(['code', 'kind', 'status'])
    expect
      .soft(Object.keys(unauthorized).sort(), '(g1) unauthorized keys')
      .toEqual(['kind', 'status'])
    expect
      .soft(Object.keys(found).sort(), '(g1) found keys')
      .toEqual(['bytes', 'kind', 'sha256', 'size'])
    expect.soft(Object.keys(notFound), '(g1) not-found keys').toEqual(['kind'])
    for (const result of [failed, unauthorized, notFound]) {
      expect
        .soft(JSON.stringify(result).includes(message), `(g2) no server message in ${result.kind}`)
        .toBe(false)
    }
  })
})

// ---- over the wire, against the loopback stub (13.2.3) ----

describe('over the wire against the storage stub', () => {
  let stubs: typeof StubModule | undefined
  let stub: StubModule.StorageStub
  const started: StubModule.StorageStub[] = []

  const startStub = async (
    extra: Partial<Parameters<typeof StubModule.startStorageStub>[0]> = {},
  ) => {
    stubs ??= await import('./storage-stub')
    const s = await stubs.startStorageStub({ apikey: FAKE_KEY, ...extra })
    started.push(s)
    return s
  }
  const wire = (s: StubModule.StorageStub, extra: Record<string, unknown> = {}) =>
    createStorageClient({
      supabaseUrl: s.origin,
      secretKey: new Secret(FAKE_KEY),
      ...extra,
    } as StorageClientOptions)

  beforeEach(async () => {
    stub = await startStub()
  })

  afterEach(async () => {
    try {
      for (const s of started) stubs!.expectNoUnexpected(s)
    } finally {
      await Promise.all(started.splice(0).map((s) => s.close()))
    }
  })

  /** headerNames ⊇ the client's set and ⊆ the client's set ∪ NODE_DEFAULT_HEADERS (content-length on POST only). */
  function expectWireHeaders(
    entry: StubModule.StubLogEntry,
    client: readonly string[],
    label: string,
  ) {
    const names = entry.headerNames.map((n) => n.toLowerCase())
    expect(names.length, 'precondition: at least 2 header names').toBeGreaterThanOrEqual(2)
    const allowed = new Set([
      ...client,
      ...NODE_DEFAULT_HEADERS.filter((n) => entry.method === 'POST' || n !== 'content-length'),
    ])
    for (const name of client) expect.soft(names.includes(name), `${label}: has ${name}`).toBe(true)
    for (const name of names) expect.soft(allowed.has(name), `${label}: ${name} allowed`).toBe(true)
  }
  const CREATE_HEADERS = ['accept-encoding', 'apikey', 'cache-control', 'content-type', 'x-upsert']

  it('T13-W1 create over the wire, per class: created, stored with the class type and cache, exact log values', async () => {
    const cases: [
      string,
      Ref,
      Uint8Array<ArrayBuffer>,
      'content' | 'masters',
      string,
      string,
      number,
    ][] = [
      [
        'package',
        PACKAGE_REF(),
        PKG.slice(),
        'content',
        `packages/two-paths/${PKG_SHA}.json`,
        'application/json',
        3600,
      ],
      ...MIMES.map(
        (
          mime,
        ): [
          string,
          Ref,
          Uint8Array<ArrayBuffer>,
          'content' | 'masters',
          string,
          string,
          number,
        ] => [
          `media ${mime}`,
          MEDIA_REF(mime),
          MEDIA(),
          'content',
          `media/lion-and-hare/${SHA_A}-w640.${EXT[mime]}`,
          mime,
          3600,
        ],
      ),
      [
        'snapshot',
        SNAPSHOT_REF(),
        SNAPSHOT(),
        'content',
        'catalogue/snapshots/7.json',
        'application/json',
        3600,
      ],
      [
        'approval',
        APPROVAL_REF(),
        APPROVAL('2026-11-21'),
        'masters',
        `approvals/two-paths/${SHA_A}.json`,
        'application/json',
        0,
      ],
    ]
    for (const [, , , bucket, path] of cases)
      expect(stub.object(bucket, path), 'precondition: the store was empty').toBeUndefined()
    const storage = wire(stub)
    for (const [name, ref, body, bucket, path, type, seconds] of cases) {
      expect
        .soft(await asCreate(storage, ref, body.slice()), `(g1) ${name} created`)
        .toEqual({ kind: 'created' })
      const object = stub.object(bucket, path)
      expect.soft(object && new Uint8Array(object.bytes), `(g2) ${name} stored bytes`).toEqual(body)
      expect.soft(object?.contentType, `(g3) ${name} stored type`).toBe(type)
      expect.soft(object?.cacheControl, `(g3) ${name} stored cache`).toBe(`max-age=${seconds}`)
    }
    expect(stub.requests.length, 'precondition: one request per class').toBe(cases.length)
    cases.forEach(([name, , , bucket, path, type, seconds], i) => {
      const entry = stub.requests[i]!
      expect
        .soft([entry.method, entry.pathname, entry.search], `(g4) ${name} route`)
        .toEqual(['POST', `/storage/v1/object/${bucket}/${path}`, ''])
      expect.soft(entry.values, `(g4) ${name} values`).toEqual({
        'content-type': type,
        'cache-control': `max-age=${seconds}`,
        'x-upsert': 'false',
        'accept-encoding': 'identity',
      })
      expect
        .soft([entry.apikeyMatched, entry.authorization], `(g5) ${name} credentials`)
        .toEqual([true, 'absent'])
      expectWireHeaders(entry, CREATE_HEADERS, `(g6) ${name}`)
    })
  })

  it('T13-W2 a content duplicate in both conflict shapes is duplicate unchecked with one request', async () => {
    for (const conflict of ['http400', 'http409'] as const) {
      const s = await startStub({ conflict })
      const cases: [string, Ref, Uint8Array<ArrayBuffer>, string][] = [
        ['package', PACKAGE_REF(), PKG.slice(), `packages/two-paths/${PKG_SHA}.json`],
        ['media', MEDIA_REF(), MEDIA(), `media/lion-and-hare/${SHA_A}-w640.webp`],
        ['snapshot', SNAPSHOT_REF(), SNAPSHOT(), 'catalogue/snapshots/7.json'],
      ]
      for (const [name, ref, body, path] of cases) {
        s.put('content', path, body.slice())
        const before = s.requests.length
        expect
          .soft(await asCreate(wire(s), ref, body), `(g1) ${conflict} ${name}`)
          .toEqual({ kind: 'duplicate', stored: 'unchecked' })
        expect.soft(s.requests.length - before, `(g1) ${conflict} ${name} one request`).toBe(1)
      }
    }
  })

  it('T13-W3 an approval duplicate is identical, different or unchecked from one read-back; the store is unchanged', async () => {
    const path = `approvals/two-paths/${SHA_A}.json`
    const get = `/storage/v1/object/authenticated/masters/${path}`
    // (g1) identical
    stub.put('masters', path, APPROVAL('2026-11-21'))
    expect
      .soft(await asCreate(wire(stub), APPROVAL_REF(), APPROVAL('2026-11-21')), '(g1) identical')
      .toEqual({ kind: 'duplicate', stored: 'identical' })
    expect
      .soft(
        stub.requests.map((r) => [r.method, r.pathname]),
        '(g1) POST then GET',
      )
      .toEqual([
        ['POST', `/storage/v1/object/masters/${path}`],
        ['GET', get],
      ])
    // (g2) the same decision on another day
    const other = await startStub()
    other.put('masters', path, APPROVAL('2026-11-20'))
    expect(APPROVAL('2026-11-20').byteLength, 'precondition: equal sizes').toBe(
      APPROVAL('2026-11-21').byteLength,
    )
    expect
      .soft(await asCreate(wire(other), APPROVAL_REF(), APPROVAL('2026-11-21')), '(g2) different')
      .toEqual({ kind: 'duplicate', stored: 'different' })
    expect
      .soft(
        other.object('masters', path) && new Uint8Array(other.object('masters', path)!.bytes),
        '(g4) stored unchanged',
      )
      .toEqual(APPROVAL('2026-11-20'))
    // (g3) unreadable read-backs
    const reads: [string, StubModule.StubBehaviour][] = [
      [
        'missing',
        {
          kind: 'answer',
          status: 400,
          body: '{"statusCode":"404","error":"not_found","message":"Object not found"}',
        },
      ],
      ['500', { kind: 'answer', status: 500, body: '{}' }],
      ['403', { kind: 'answer', status: 400, body: '{"statusCode":"403","error":"Unauthorized"}' }],
    ]
    for (const [name, behaviour] of reads) {
      const s = await startStub()
      s.put('masters', path, APPROVAL('2026-11-21'))
      s.override('GET', get, behaviour)
      expect
        .soft(await asCreate(wire(s), APPROVAL_REF(), APPROVAL('2026-11-21')), `(g3) ${name}`)
        .toEqual({ kind: 'duplicate', stored: 'unchecked' })
      expect
        .soft(s.requests.filter((r) => r.method === 'POST').length, `(g5) ${name} one POST`)
        .toBe(1)
      expect
        .soft(new Uint8Array(s.object('masters', path)!.bytes), `(g4) ${name} stored unchanged`)
        .toEqual(APPROVAL('2026-11-21'))
    }
    expect.soft(stub.requests.filter((r) => r.method === 'POST').length, '(g5) one POST').toBe(1)
  })

  it('T13-W4 two concurrent creates of one approval: one created, one duplicate with the right verdict', async () => {
    for (const [name, second, verdict] of [
      ['equal', '2026-11-21', 'identical'],
      ['other day', '2026-11-20', 'different'],
    ] as const) {
      const s = await startStub()
      const storage = wire(s)
      const results = await Promise.all([
        asCreate(storage, APPROVAL_REF(), APPROVAL('2026-11-21')),
        asCreate(storage, APPROVAL_REF(), APPROVAL(second)),
      ])
      const kinds = results.map((r) => r.kind).sort()
      expect.soft(kinds, `(g1) ${name} kinds`).toEqual(['created', 'duplicate'])
      const dup = results.find((r) => r.kind === 'duplicate') as { stored?: string } | undefined
      expect.soft(dup?.stored, `(g2) ${name} verdict`).toBe(verdict)
    }
  })

  it('T13-W5 writePointer overwrites with x-upsert true, max-age=0 and identity, for both modes', async () => {
    for (const mode of ['production', 'staging'] as const) {
      const storage = wire(stub)
      expect
        .soft(await storage.writePointer(mode, POINTER(3)), `(g1) ${mode} first`)
        .toEqual({ kind: 'written' })
      expect
        .soft(await storage.writePointer(mode, POINTER(4)), `(g1) ${mode} second`)
        .toEqual({ kind: 'written' })
      expect
        .soft(
          new Uint8Array(stub.object('content', `catalogue/${mode}.json`)!.bytes),
          `(g2) ${mode} stored`,
        )
        .toEqual(POINTER(4))
    }
    for (const entry of stub.requests) {
      expect.soft(entry.values, `(g3) ${entry.pathname}`).toEqual({
        'content-type': 'application/json',
        'cache-control': 'max-age=0',
        'x-upsert': 'true',
        'accept-encoding': 'identity',
      })
      expectWireHeaders(entry, CREATE_HEADERS, `(g3) ${entry.pathname}`)
    }
  })

  it('T13-W6 readMaster over the wire: found whatever the stored type, both missing bodies not-found, failures typed', async () => {
    const path = `waivers/lion-and-hare/${WAIVER_SHA}.json`
    const get = `/storage/v1/object/authenticated/masters/${path}`
    stub.put('masters', path, WAIVER.slice(), 'binary/octet-stream')
    expect
      .soft(await asRead(wire(stub), WAIVER_REF()), '(g1) found')
      .toEqual({ kind: 'found', bytes: WAIVER, size: WAIVER.byteLength, sha256: WAIVER_SHA })
    for (const missing of ['not_found', 'NoSuchKey'] as const) {
      const s = await startStub({ missing })
      expect
        .soft(await asRead(wire(s), APPROVAL_REF()), `(g2) missing ${missing}`)
        .toEqual({ kind: 'not-found' })
    }
    const overrides: [string, StubModule.StubBehaviour, unknown][] = [
      [
        'NoSuchBucket',
        { kind: 'answer', status: 400, body: '{"statusCode":"404","code":"NoSuchBucket"}' },
        { kind: 'failed', status: 404, code: 'NoSuchBucket' },
      ],
      [
        '404 no body',
        { kind: 'answer', status: 404 },
        { kind: 'failed', status: 404, code: 'unknown' },
      ],
      [
        '400/403',
        { kind: 'answer', status: 400, body: '{"statusCode":"403","error":"Unauthorized"}' },
        { kind: 'unauthorized', status: 403 },
      ],
    ]
    for (const [name, behaviour, want] of overrides) {
      stub.override('GET', get, behaviour)
      expect.soft(await asRead(wire(stub), WAIVER_REF()), `(g3) ${name}`).toEqual(want)
    }
    for (const entry of stub.requests) {
      expect.soft([entry.method, entry.pathname], '(g4) authenticated route').toEqual(['GET', get])
      expect.soft(entry.values['accept-encoding'], '(g4) identity').toBe('identity')
      expectWireHeaders(entry, ['accept-encoding', 'apikey'], '(g4) headers')
    }
  })

  it('T13-W7 a redirect is never followed: the key never reaches the second server', async () => {
    let seen = 0
    let withKey = 0
    const second: Server = createServer((req, res) => {
      seen++
      if (req.headers.apikey !== undefined) withKey++
      res.writeHead(200, { 'content-length': '0' })
      res.end()
    })
    await new Promise<void>((done) => second.listen(0, '127.0.0.1', done))
    try {
      const origin = `http://127.0.0.1:${(second.address() as AddressInfo).port}`
      await realFetch(`${origin}/probe`)
      expect(seen, 'precondition: the second server counts').toBe(1)
      seen = 0
      const read = `/storage/v1/object/authenticated/masters/approvals/two-paths/${SHA_A}.json`
      stub.override('GET', read, { kind: 'redirect', status: 307, location: `${origin}/stolen` })
      expect
        .soft(await asRead(wire(stub), APPROVAL_REF()), '(g1) readMaster')
        .toEqual({ kind: 'failed', status: 307, code: 'unknown' })
      const s2 = await startStub()
      s2.override('POST', `/storage/v1/object/masters/approvals/two-paths/${SHA_A}.json`, {
        kind: 'redirect',
        status: 307,
        location: `${origin}/stolen`,
      })
      expect
        .soft(await asCreate(wire(s2), APPROVAL_REF(), APPROVAL('2026-11-21')), '(g2) create')
        .toEqual({ kind: 'failed', status: 307, code: 'unknown' })
      expect.soft([seen, withKey], '(g1, g2) second server saw nothing').toEqual([0, 0])
      expect
        .soft([stub.requests.length, s2.requests.length], '(g1, g2) one request each')
        .toEqual([1, 1])
    } finally {
      second.closeAllConnections()
      await new Promise<void>((done) => second.close(() => done()))
    }
  })

  it('T13-W8 a stalled body ends as TimeoutError', { timeout: 10_000 }, async () => {
    const path = `approvals/two-paths/${SHA_A}.json`
    stub.put('masters', path, APPROVAL('2026-11-21'))
    stub.override('GET', `/storage/v1/object/authenticated/masters/${path}`, { kind: 'stall' })
    expect
      .soft(await asRead(wire(stub, { timeoutMs: 200 }), APPROVAL_REF()), '(g1) timeout')
      .toEqual({ kind: 'failed', status: null, code: 'TimeoutError' })
  })

  it('T13-W9 an object over 1 MiB is too-large, with a declared length and without one', async () => {
    const path = `approvals/two-paths/${SHA_A}.json`
    stub.put('masters', path, new Uint8Array(MAX_JSON_BYTES + 1))
    expect
      .soft(await asRead(wire(stub), APPROVAL_REF()), '(g1) declared')
      .toEqual({ kind: 'too-large', limit: MAX_JSON_BYTES })
    stub.override('GET', `/storage/v1/object/authenticated/masters/${path}`, {
      kind: 'gzip',
      chunked: true,
    })
    expect
      .soft(await asRead(wire(stub), APPROVAL_REF()), '(g2) no content-length')
      .toEqual({ kind: 'too-large', limit: MAX_JSON_BYTES })
  })

  it('T13-W10 a gzip answer is decoded and counted decoded: found, the waiver hash on decoded bytes, the bomb too-large', async () => {
    const pad = (n: number) => text(`{"p":"${'x'.repeat(n - 8)}"}`)
    const body = pad(2026)
    expect(body.byteLength, 'precondition: 2026 bytes').toBe(2026)
    expect(gzipSync(body).byteLength, 'precondition: compressed is shorter').toBeLessThan(2026)
    const sha = await sha256Hex(body)
    const approvalPath = `approvals/two-paths/${SHA_A}.json`
    stub.put('masters', approvalPath, body)
    stub.override('GET', `/storage/v1/object/authenticated/masters/${approvalPath}`, {
      kind: 'gzip',
    })
    expect
      .soft(await asRead(wire(stub), APPROVAL_REF()), '(g1) found decoded')
      .toEqual({ kind: 'found', bytes: body, size: 2026, sha256: sha })
    const waiverPath = `waivers/lion-and-hare/${sha}.json`
    stub.put('masters', waiverPath, body)
    stub.override('GET', `/storage/v1/object/authenticated/masters/${waiverPath}`, { kind: 'gzip' })
    expect
      .soft(
        (await asRead(wire(stub), { ...WAIVER_REF(), waiverSha256: sha })).kind,
        '(g2) waiver found',
      )
      .toBe('found')
    const bomb = new Uint8Array(5 * 1024 * 1024)
    expect(gzipSync(bomb).byteLength, 'precondition: the bomb is small compressed').toBeLessThan(
      MAX_JSON_BYTES,
    )
    stub.put('masters', approvalPath, bomb)
    stub.override('GET', `/storage/v1/object/authenticated/masters/${approvalPath}`, {
      kind: 'gzip',
    })
    expect
      .soft(await asRead(wire(stub), APPROVAL_REF()), '(g3) bomb')
      .toEqual({ kind: 'too-large', limit: MAX_JSON_BYTES })
  })

  it('T13-W11 a truncated body is failed with a network code', async () => {
    const path = `approvals/two-paths/${SHA_A}.json`
    stub.put('masters', path, APPROVAL('2026-11-21'))
    stub.override('GET', `/storage/v1/object/authenticated/masters/${path}`, {
      kind: 'truncate',
      declared: 100,
      sent: 10,
    })
    const result = await asRead(wire(stub), APPROVAL_REF())
    console.log(`T13-W11 code ${JSON.stringify(result)}`)
    expect.soft(result.kind === 'failed' && result.status, '(g1) failed, status null').toBe(null)
    expect
      .soft(result.kind === 'failed' && result.code.startsWith('TypeError'), '(g1) TypeError code')
      .toBe(true)
  })

  it('T13-W12 listContent over the wire pages and recurses with identity', async () => {
    for (const name of [
      'catalogue/snapshots/1.json',
      'catalogue/snapshots/2.json',
      'catalogue/snapshots/3.json',
      'catalogue/production.json',
    ]) {
      stub.put('content', name, MEDIA(), 'application/json')
    }
    const result = await wire(stub, { listPageSize: 2 }).listContent('catalogue/')
    expect
      .soft(result.kind === 'listed' && result.objects.map((o) => o.path), '(g1) sorted')
      .toEqual([
        'catalogue/production.json',
        'catalogue/snapshots/1.json',
        'catalogue/snapshots/2.json',
        'catalogue/snapshots/3.json',
      ])
    const bodies = stub.requests.map(
      (r) => JSON.parse(new TextDecoder().decode(r.body)) as { prefix: string; offset: number },
    )
    // catalogue/ holds two entries (production.json and the snapshots folder), a full page of 2, so
    // the client asks once more at offset 2 before it walks the folder.
    expect
      .soft(
        bodies.map((b) => [b.prefix, b.offset]),
        '(g2) pages',
      )
      .toEqual([
        ['catalogue', 0],
        ['catalogue', 2],
        ['catalogue/snapshots', 0],
        ['catalogue/snapshots', 2],
      ])
    for (const entry of stub.requests) {
      expect.soft(entry.values['accept-encoding'], '(g3) identity').toBe('identity')
      expectWireHeaders(entry, ['accept-encoding', 'apikey', 'content-type'], '(g3) headers')
    }
  })

  it('T13-W13 a package flipped right after the call is stored as gated', async () => {
    const body = PKG.slice()
    const pending = asCreate(wire(stub), PACKAGE_REF(), body)
    body[1] = body[1]! ^ 0xff
    expect.soft(await pending, '(g1) created').toEqual({ kind: 'created' })
    const object = stub.object('content', `packages/two-paths/${PKG_SHA}.json`)
    expect
      .soft(object && (await sha256Hex(new Uint8Array(object.bytes))), '(g2) stored sha256')
      .toBe(PKG_SHA)
  })

  it('T13-W14 bearerFallback on the wire: bearer-matched on every route; the default is absent', async () => {
    const path = `waivers/lion-and-hare/${WAIVER_SHA}.json`
    for (const [flag, want] of [
      [true, 'bearer-matched'],
      [false, 'absent'],
    ] as const) {
      const s = await startStub()
      s.put('masters', path, WAIVER.slice())
      const storage = wire(s, { bearerFallback: flag })
      await asCreate(storage, MEDIA_REF(), MEDIA())
      await storage.writePointer('production', POINTER(7))
      await asRead(storage, WAIVER_REF())
      await storage.listContent('catalogue/snapshots/') // an empty folder: one list request
      await storage.readContent({ kind: 'pointer', mode: 'staging' }) // missing: one request
      await storage.readContent({ kind: 'snapshot', seq: 7 }) // missing: one request
      expect(s.requests.length, 'precondition: 6 requests').toBe(6)
      for (const entry of s.requests)
        expect
          .soft(entry.authorization, `(g1) ${flag} ${entry.method} ${entry.pathname.slice(0, 40)}`)
          .toBe(want)
    }
  })

  it('T13-W15 a closed port is failed with a network code', async () => {
    const closed: Server = createServer()
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done))
    const port = (closed.address() as AddressInfo).port
    await new Promise<void>((done) => closed.close(() => done()))
    const refused = await new Promise<boolean>((done) => {
      const socket = connect(port, '127.0.0.1')
      socket.once('connect', () => (socket.destroy(), done(false)))
      socket.once('error', () => done(true))
    })
    expect(refused, 'precondition: the port refuses').toBe(true)
    const storage = createStorageClient({
      supabaseUrl: new URL(`http://127.0.0.1:${port}`),
      secretKey: new Secret(FAKE_KEY),
    })
    const result = await asRead(storage, APPROVAL_REF())
    console.log(`T13-W15 code ${JSON.stringify(result)}`)
    expect.soft(result.kind === 'failed' && result.status, '(g1) status null').toBe(null)
    expect
      .soft(result.kind === 'failed' && result.code.startsWith('TypeError'), '(g1) TypeError code')
      .toBe(true)
  })

  it('T14-78 readContent over the wire: the stub serves the nonce form; found, missing and snapshot reads (A11, A12)', async () => {
    const pointerBytes = POINTER(7)
    const snapshotBytes = SNAPSHOT()
    stub.put('content', 'catalogue/staging.json', pointerBytes, 'application/json')
    stub.put('content', 'catalogue/snapshots/7.json', snapshotBytes, 'application/json')
    const read = '/storage/v1/object/authenticated/content/'
    // (g1) the staging pointer, with a nonce
    const found = await wire(stub).readContent({ kind: 'pointer', mode: 'staging' })
    expect(stub.requests.length, 'precondition: one request').toBe(1)
    expect.soft(found, '(g1) pointer found with its bytes').toEqual({
      kind: 'found',
      bytes: pointerBytes,
      size: pointerBytes.byteLength,
      sha256: await sha256Hex(pointerBytes),
    })
    const entry = stub.requests[0]!
    expect.soft(entry.method, '(g1) GET').toBe('GET')
    expect.soft(entry.pathname, '(g1) pathname').toBe(`${read}catalogue/staging.json`)
    expect.soft(entry.search, '(g1) a nonce search').toMatch(/^\?cacheNonce=[1-9][0-9]{0,15}$/)
    expect.soft(entry.values['accept-encoding'], '(g1) identity').toBe('identity')
    expect.soft(entry.apikeyMatched, '(g1) apikey matched').toBe(true)
    expectWireHeaders(entry, ['accept-encoding', 'apikey'], '(g1) headers')
    // (g2) production missing, under both missing bodies
    for (const missing of ['not_found', 'NoSuchKey'] as const) {
      const s = await startStub({ missing })
      expect
        .soft(
          await wire(s).readContent({ kind: 'pointer', mode: 'production' }),
          `(g2) missing ${missing}`,
        )
        .toEqual({ kind: 'not-found' })
      expect.soft(s.requests.length, `(g2) ${missing} one request`).toBe(1)
    }
    // (g3) the snapshot, with no search
    const snapshot = await wire(stub)
      .readContent({ kind: 'snapshot', seq: 7 })
      .catch((error: unknown) => `threw ${(error as Error).message}`)
    expect.soft(snapshot, '(g3) snapshot found').toEqual({
      kind: 'found',
      bytes: snapshotBytes,
      size: snapshotBytes.byteLength,
      sha256: await sha256Hex(snapshotBytes),
    })
    const last = stub.requests.at(-1)
    expect.soft(last?.pathname, '(g3) pathname').toBe(`${read}catalogue/snapshots/7.json`)
    expect.soft(last?.search, '(g3) no search').toBe('')
  })
})
