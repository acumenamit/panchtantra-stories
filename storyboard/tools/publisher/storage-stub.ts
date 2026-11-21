// A loopback model of the Supabase Storage REST routes the publisher's client uses (design
// p1-step13-design.md §3.12 and §13.2.3, row A15). Test infrastructure for Steps 13-16: no non-test
// file may reach this module (fence F3 in storage-fence.test.ts).
// - It models three routes and nothing else: create, POST /storage/v1/object/{content|masters}/<path>
//   (create-only; the object is replaced only when x-upsert is exactly 'true', research A3); the
//   authenticated read, GET /storage/v1/object/authenticated/{content|masters}/<path>; and one list
//   page, POST /storage/v1/object/list/{content|masters}.
// - It fails closed. A missing or wrong apikey, or an authorization header other than Bearer of the
//   same key, is recorded in `unexpected` and answered 401. Any other method, route, query, path form
//   or malformed list body is recorded in `unexpected` and answered 500. Overrides apply to modelled
//   routes only. Every test asserts that `unexpected` is empty (expectNoUnexpected).
// - Every answer sets content-length explicitly, through writeHead before end, so a dropped length
//   would show as a chunked answer (stub-storage.ts:5-8: Node adds none to a HEAD answer). Only the
//   chunked-gzip override sends none; stall and truncate declare a length they never send.
// - The request log keeps header names, whether the apikey matched, an authorization class and the
//   values of exactly content-type, cache-control, x-upsert and accept-encoding. It never keeps a
//   credential value or any other header value (lead decision 10).
// - It decides every answer from its own route model and imports only node: modules, so a change to
//   the client's path fence cannot move the stub with it (FS4b).
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'

export type StubBucket = 'content' | 'masters'

export interface StubOptions {
  /** The only apikey the stub serves. */
  readonly apikey: string
  /** How a create-only conflict is answered: HTTP 400 with statusCode "409" (default), or HTTP 409. */
  readonly conflict?: 'http400' | 'http409'
  /** The body of a missing object (HTTP 400): the measured not_found body (default) or NoSuchKey. */
  readonly missing?: 'not_found' | 'NoSuchKey'
}

/** One request as the stub saw it, without any credential or other header value. */
export interface StubLogEntry {
  readonly method: string
  /** The request target before any '?', exactly as sent (no dot-segment or percent decoding). */
  readonly pathname: string
  /** '' or the raw '?...' part. */
  readonly search: string
  /** Sorted, lower case, each name once. */
  readonly headerNames: readonly string[]
  readonly apikeyMatched: boolean
  readonly authorization: 'absent' | 'bearer-matched' | 'other'
  readonly values: {
    readonly 'content-type'?: string
    readonly 'cache-control'?: string
    readonly 'x-upsert'?: string
    readonly 'accept-encoding'?: string
  }
  readonly body: Uint8Array
  readonly bodySha256: string
}

/**
 * A one-shot change to the next answer of one modelled route. `answer` and `redirect` replace the
 * route's handler (nothing is stored or read); the others run the handler and change how its answer
 * is delivered.
 */
export type StubBehaviour =
  | {
      readonly kind: 'answer'
      readonly status: number
      readonly body?: string | Uint8Array
      readonly headers?: Readonly<Record<string, string>>
    }
  | { readonly kind: 'redirect'; readonly status: 301 | 302 | 307 | 308; readonly location: string }
  /** The headers, with content-length, then no body until close(). */
  | { readonly kind: 'stall' }
  /** content-length `declared`, then `sent` bytes, then the socket is destroyed. */
  | { readonly kind: 'truncate'; readonly declared: number; readonly sent: number }
  /** The answer body gzipped, with content-encoding gzip; `chunked` sends no content-length. */
  | { readonly kind: 'gzip'; readonly chunked?: boolean }
  /** The normal answer after `ms` milliseconds. */
  | { readonly kind: 'delay'; readonly ms: number }

export interface StubObject {
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly cacheControl: string | null
}

export interface StorageStub {
  /** http://127.0.0.1:<port> */
  readonly origin: URL
  /** Every request, in arrival order (a fresh copy on each read). */
  readonly requests: readonly StubLogEntry[]
  /** The requests the stub refused (401) or does not model (500). */
  readonly unexpected: readonly StubLogEntry[]
  /** Stores an object directly, as an earlier upload would have (cacheControl null). */
  put(bucket: StubBucket, path: string, bytes: Uint8Array, contentType?: string): void
  /** A copy of the stored object, or undefined. */
  object(bucket: StubBucket, path: string): StubObject | undefined
  /** Queues a one-shot behaviour for the next request of a modelled route (method and pathname). */
  override(method: 'GET' | 'POST', pathname: string, behaviour: StubBehaviour): void
  /** Ends every connection, then the server. Safe to call twice. */
  close(): Promise<void>
}

const CREATE_ROUTE = '/storage/v1/object/'
const READ_ROUTE = '/storage/v1/object/authenticated/'
const LIST_ROUTE = '/storage/v1/object/list/'
const BUCKETS: ReadonlySet<string> = new Set(['content', 'masters'])
const LOGGED_VALUES = ['content-type', 'cache-control', 'x-upsert', 'accept-encoding'] as const
const SEGMENT = /^[A-Za-z0-9._-]+$/
const MAX_REQUEST_BYTES = 32 * 1024 * 1024
const UPDATED_AT = '2026-11-21T00:00:00.000Z'

/** Copied from scripts/testing/stub-storage.ts:29-31, not imported (CRIT-10). */
const MISSING_OBJECT_BODY = '{"statusCode":"404","error":"not_found","message":"Object not found"}'
const NO_SUCH_KEY_BODY =
  '{"statusCode":"404","code":"NoSuchKey","error":"not_found","message":"Object not found"}'
const DUPLICATE_BODY =
  '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}'
const UNAUTHORIZED_BODY =
  '{"statusCode":"401","error":"Unauthorized","message":"storage stub: apikey missing or wrong"}'
const UNEXPECTED_BODY =
  '{"statusCode":"500","error":"StubUnexpected","message":"storage stub: request not modelled"}'

interface Answer {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
}

const encode = (text: string) => new TextEncoder().encode(text)
const jsonAnswer = (status: number, body: string): Answer => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: encode(body),
})

/** A path the stub stores: non-empty segments of [A-Za-z0-9._-], never '.' or '..'. */
function isModelledPath(path: string): boolean {
  return (
    path !== '' &&
    path.split('/').every((segment) => SEGMENT.test(segment) && segment !== '.' && segment !== '..')
  )
}

function checkBucketAndPath(bucket: string, path: string): void {
  if (!BUCKETS.has(bucket)) throw new TypeError('storage stub: unknown bucket')
  if (!isModelledPath(path)) throw new TypeError('storage stub: path not modelled')
}

/** Header values by lower-case name, every occurrence kept (Node drops repeated authorization). */
function rawHeaderValues(req: IncomingMessage): Map<string, string[]> {
  const values = new Map<string, string[]>()
  for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
    const name = (req.rawHeaders[index] ?? '').toLowerCase()
    values.set(name, [...(values.get(name) ?? []), req.rawHeaders[index + 1] ?? ''])
  }
  return values
}

function logEntryOf(
  req: IncomingMessage,
  pathname: string,
  search: string,
  body: Uint8Array,
  apikey: string,
): StubLogEntry {
  const headers = rawHeaderValues(req)
  const keys = headers.get('apikey') ?? []
  const auth = headers.get('authorization') ?? []
  const values: Record<string, string> = {}
  for (const name of LOGGED_VALUES) {
    const found = headers.get(name)
    if (found !== undefined) values[name] = found.join(', ')
  }
  return Object.freeze({
    method: req.method ?? '',
    pathname,
    search,
    headerNames: Object.freeze([...headers.keys()].sort()),
    apikeyMatched: keys.length === 1 && keys[0] === apikey,
    authorization:
      auth.length === 0
        ? 'absent'
        : auth.length === 1 && auth[0] === `Bearer ${apikey}`
          ? 'bearer-matched'
          : 'other',
    values: Object.freeze(values),
    body,
    bodySha256: createHash('sha256').update(body).digest('hex'),
  })
}

function checkOptions(options: StubOptions): Required<StubOptions> {
  if (typeof options !== 'object' || options === null) throw new TypeError('storage stub: options')
  for (const key of Object.keys(options)) {
    if (!['apikey', 'conflict', 'missing'].includes(key)) {
      throw new TypeError('storage stub: unknown option')
    }
  }
  if (typeof options.apikey !== 'string' || options.apikey === '') {
    throw new TypeError('storage stub: apikey must be a non-empty string')
  }
  const conflict = options.conflict ?? 'http400'
  const missing = options.missing ?? 'not_found'
  if (conflict !== 'http400' && conflict !== 'http409')
    throw new TypeError('storage stub: conflict')
  if (missing !== 'not_found' && missing !== 'NoSuchKey')
    throw new TypeError('storage stub: missing')
  return { apikey: options.apikey, conflict, missing }
}

const BEHAVIOURS: ReadonlySet<string> = new Set([
  'answer',
  'redirect',
  'stall',
  'truncate',
  'gzip',
  'delay',
])

export async function startStorageStub(options: StubOptions): Promise<StorageStub> {
  const { apikey, conflict, missing } = checkOptions(options)
  const stores = new Map<StubBucket, Map<string, StubObject>>([
    ['content', new Map()],
    ['masters', new Map()],
  ])
  const storeOf = (bucket: string): Map<string, StubObject> => {
    const store = stores.get(bucket as StubBucket)
    if (store === undefined) throw new TypeError('storage stub: unknown bucket')
    return store
  }
  const log: StubLogEntry[] = []
  const unexpected: StubLogEntry[] = []
  const overrides = new Map<string, StubBehaviour[]>()
  const timers = new Set<NodeJS.Timeout>()
  let ids = 0

  function create(bucket: string, path: string, req: IncomingMessage, body: Uint8Array): Answer {
    const store = storeOf(bucket)
    const headers = rawHeaderValues(req)
    const upsertValues = headers.get('x-upsert') ?? []
    const upsert = upsertValues.length === 1 && upsertValues[0] === 'true'
    if (store.has(path) && !upsert) {
      return jsonAnswer(conflict === 'http409' ? 409 : 400, DUPLICATE_BODY)
    }
    const contentType = headers.get('content-type')
    const cacheControl = headers.get('cache-control')
    store.set(path, {
      bytes: new Uint8Array(body),
      contentType: contentType?.length === 1 ? (contentType[0] ?? '') : 'application/octet-stream',
      cacheControl: cacheControl?.length === 1 ? (cacheControl[0] ?? null) : null,
    })
    ids += 1
    return jsonAnswer(200, JSON.stringify({ Key: `${bucket}/${path}`, Id: `stub-object-${ids}` }))
  }

  function read(bucket: string, path: string): Answer {
    const found = storeOf(bucket).get(path)
    if (found === undefined) {
      return jsonAnswer(400, missing === 'NoSuchKey' ? NO_SUCH_KEY_BODY : MISSING_OBJECT_BODY)
    }
    const headers: Record<string, string> = { 'content-type': found.contentType }
    if (found.cacheControl !== null) headers['cache-control'] = found.cacheControl
    return { status: 200, headers, body: new Uint8Array(found.bytes) }
  }

  /** One list page, or null when the request body is not one the client sends. */
  function list(bucket: string, body: Uint8Array): Answer | null {
    let request: unknown
    try {
      request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
    } catch {
      return null
    }
    if (typeof request !== 'object' || request === null || Array.isArray(request)) return null
    const fields = request as Record<string, unknown>
    if (
      !Object.keys(fields).every((key) => ['prefix', 'limit', 'offset', 'sortBy'].includes(key))
    ) {
      return null
    }
    const { prefix, limit, offset, sortBy } = fields
    if (typeof prefix !== 'string' || (prefix !== '' && !isModelledPath(prefix))) return null
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) return null
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) return null
    if (
      sortBy !== undefined &&
      JSON.stringify(sortBy) !== JSON.stringify({ column: 'name', order: 'asc' })
    ) {
      return null
    }
    const folder = prefix === '' ? '' : `${prefix}/`
    const entries = new Map<string, unknown>()
    for (const [path, object] of storeOf(bucket)) {
      if (!path.startsWith(folder)) continue
      const rest = path.slice(folder.length)
      const slash = rest.indexOf('/')
      if (slash >= 0) {
        const name = rest.slice(0, slash)
        entries.set(name, {
          name,
          id: null,
          updated_at: null,
          created_at: null,
          last_accessed_at: null,
          metadata: null,
        })
      } else {
        entries.set(rest, {
          name: rest,
          id: createHash('sha256').update(`${bucket}/${path}`).digest('hex').slice(0, 32),
          updated_at: UPDATED_AT,
          created_at: UPDATED_AT,
          last_accessed_at: UPDATED_AT,
          metadata: {
            size: object.bytes.byteLength,
            mimetype: object.contentType,
            cacheControl: object.cacheControl,
          },
        })
      }
    }
    const page = [...entries.keys()]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(offset, offset + limit)
      .map((name) => entries.get(name))
    return jsonAnswer(200, JSON.stringify(page))
  }

  /** The handler of a modelled route, or null (the request is unexpected). */
  function route(
    method: string,
    pathname: string,
    search: string,
    req: IncomingMessage,
    body: Uint8Array,
  ): (() => Answer | null) | null {
    if (search !== '') return null
    if (method === 'POST' && pathname.startsWith(LIST_ROUTE)) {
      const bucket = pathname.slice(LIST_ROUTE.length)
      return BUCKETS.has(bucket) ? () => list(bucket, body) : null
    }
    const split = (prefix: string): [string, string] | null => {
      const rest = pathname.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash < 0) return null
      const bucket = rest.slice(0, slash)
      const path = rest.slice(slash + 1)
      return BUCKETS.has(bucket) && isModelledPath(path) ? [bucket, path] : null
    }
    if (method === 'GET' && pathname.startsWith(READ_ROUTE)) {
      const target = split(READ_ROUTE)
      return target ? () => read(target[0], target[1]) : null
    }
    if (method === 'POST' && pathname.startsWith(CREATE_ROUTE)) {
      const target = split(CREATE_ROUTE)
      return target ? () => create(target[0], target[1], req, body) : null
    }
    return null
  }

  function send(res: ServerResponse, answer: Answer): void {
    res.writeHead(answer.status, {
      ...answer.headers,
      'content-length': String(answer.body.byteLength),
    })
    res.end(answer.body)
  }

  function deliver(
    res: ServerResponse,
    handler: () => Answer | null,
    behaviour: StubBehaviour | undefined,
    refuse: () => void,
  ): void {
    if (behaviour === undefined) {
      const answer = handler()
      if (answer === null) refuse()
      else send(res, answer)
      return
    }
    switch (behaviour.kind) {
      case 'answer': {
        const body =
          typeof behaviour.body === 'string'
            ? encode(behaviour.body)
            : (behaviour.body ?? new Uint8Array())
        const extra: Record<string, string> = {}
        for (const [name, value] of Object.entries(behaviour.headers ?? {})) {
          extra[name.toLowerCase()] = value
        }
        res.writeHead(behaviour.status, {
          'content-type': 'application/json',
          'content-length': String(body.byteLength),
          ...extra,
        })
        res.end(body)
        return
      }
      case 'redirect':
        res.writeHead(behaviour.status, { location: behaviour.location, 'content-length': '0' })
        res.end()
        return
      case 'delay': {
        const timer = setTimeout(() => {
          timers.delete(timer)
          deliver(res, handler, undefined, refuse)
        }, behaviour.ms)
        timers.add(timer)
        return
      }
      default:
        break
    }
    const answer = handler()
    if (answer === null) {
      refuse()
      return
    }
    switch (behaviour.kind) {
      case 'gzip': {
        const zipped = gzipSync(answer.body)
        const headers: Record<string, string> = { ...answer.headers, 'content-encoding': 'gzip' }
        if (!behaviour.chunked) headers['content-length'] = String(zipped.byteLength)
        res.writeHead(answer.status, headers)
        res.end(zipped)
        return
      }
      case 'stall':
        res.writeHead(answer.status, {
          ...answer.headers,
          'content-length': String(answer.body.byteLength),
        })
        res.flushHeaders()
        return
      case 'truncate': {
        const sent = new Uint8Array(behaviour.sent).fill(0x20)
        sent.set(answer.body.subarray(0, behaviour.sent))
        res.writeHead(answer.status, {
          ...answer.headers,
          'content-length': String(behaviour.declared),
        })
        res.write(sent, () => res.socket?.destroy())
        return
      }
    }
  }

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_REQUEST_BYTES) chunks.push(chunk)
    })
    req.on('error', () => {})
    req.on('end', () => {
      const target = req.url ?? ''
      const query = target.indexOf('?')
      const pathname = query < 0 ? target : target.slice(0, query)
      const search = query < 0 ? '' : target.slice(query)
      const body = new Uint8Array(Buffer.concat(chunks))
      const entry = logEntryOf(req, pathname, search, body, apikey)
      log.push(entry)
      const refuse = (status: 401 | 500): void => {
        unexpected.push(entry)
        send(res, jsonAnswer(status, status === 401 ? UNAUTHORIZED_BODY : UNEXPECTED_BODY))
      }
      const authorised =
        entry.apikeyMatched &&
        (entry.authorization === 'absent' || entry.authorization === 'bearer-matched')
      if (!authorised) {
        refuse(401)
        return
      }
      const method = req.method ?? ''
      const handler =
        size <= MAX_REQUEST_BYTES && pathname.startsWith('/')
          ? route(method, pathname, search, req, body)
          : null
      if (handler === null) {
        refuse(500)
        return
      }
      const key = `${method} ${pathname}`
      const queued = overrides.get(key)
      const behaviour = queued?.shift()
      if (queued?.length === 0) overrides.delete(key)
      deliver(res, handler, behaviour, () => refuse(500))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const port = (server.address() as AddressInfo).port
  let closing: Promise<void> | null = null

  return {
    get origin() {
      return new URL(`http://127.0.0.1:${port}`)
    },
    get requests() {
      return Object.freeze([...log])
    },
    get unexpected() {
      return Object.freeze([...unexpected])
    },
    put(bucket, path, bytes, contentType = 'application/octet-stream') {
      checkBucketAndPath(bucket, path)
      storeOf(bucket).set(path, { bytes: new Uint8Array(bytes), contentType, cacheControl: null })
    },
    object(bucket, path) {
      checkBucketAndPath(bucket, path)
      const found = storeOf(bucket).get(path)
      return found === undefined
        ? undefined
        : {
            bytes: new Uint8Array(found.bytes),
            contentType: found.contentType,
            cacheControl: found.cacheControl,
          }
    },
    override(method, pathname, behaviour) {
      if (method !== 'GET' && method !== 'POST')
        throw new TypeError('storage stub: override method')
      if (typeof pathname !== 'string' || !pathname.startsWith('/')) {
        throw new TypeError('storage stub: override pathname')
      }
      if (!BEHAVIOURS.has(behaviour.kind)) throw new TypeError('storage stub: override kind')
      const key = `${method} ${pathname}`
      overrides.set(key, [...(overrides.get(key) ?? []), behaviour])
    },
    close() {
      closing ??= new Promise<void>((resolve) => {
        for (const timer of timers) clearTimeout(timer)
        timers.clear()
        server.closeAllConnections()
        server.close(() => resolve())
      })
      return closing
    },
  }
}

/** Throws when the stub saw a request it refused or does not model, naming method and pathname. */
export function expectNoUnexpected(stub: StorageStub): void {
  const seen = stub.unexpected
  if (seen.length === 0) return
  const names = seen.map((entry) => `${entry.method} ${entry.pathname}`).join(', ')
  throw new Error(`storage stub: ${seen.length} unexpected request(s): ${names}`)
}
