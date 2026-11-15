// The one local Storage stub for content-loader tests (design p1-step8-design.md §10.2; P1-2b). A
// node:http server on 127.0.0.1:0 under /storage/v1/object/public/content/, shaped on what this
// project's bucket answered (spec §3.2; requirements.md:324, :444): objects with content-type,
// content-length, cf-cache-status, cf-ray, age and accept-ranges; a missing object answers 400 with
// Supabase's JSON. Every answer sets content-length explicitly: Node adds none to a HEAD answer,
// even after res.end(bytes) (critic probe, Node 24.18.0), and a stub relying on it would fail every
// HEAD with "content-length missing". Per-path handler queues inject failures; a request log and an
// in-flight counter let tests assert exact request lists and concurrency.
// It drives only in-process loadContent with a temp root, never the entry point (which writes the
// real storyboard/.content) and never `pnpm build` (next build refuses a base off MEDIA_ORIGIN).
import { readdirSync, readFileSync } from 'node:fs'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, relative, sep } from 'node:path'

/** The public object prefix, as Supabase serves the `content` bucket. */
export const STUB_PREFIX = '/storage/v1/object/public/content/'

/** The body Supabase sent for a missing object, with status 400 (requirements.md:324, :444). */
export const MISSING_OBJECT_BODY =
  '{"statusCode":"404","error":"not_found","message":"Object not found"}'

/** CDN headers on every object answer; the loader logs them (cf, age, pop). */
export const CDN_HEADERS = { 'cf-cache-status': 'MISS', 'cf-ray': '8f1a2b3c4d5e6f70-BOM', age: '0' }

export interface StubObject {
  readonly bytes: Uint8Array
  readonly contentType: string
}

export interface StubRequest {
  readonly method: string
  /** The object path after the prefix (the full pathname for a request outside it). */
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: IncomingHttpHeaders
}

/** Answers one request; `object` is the stored object for the path, if any. */
export type StubHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  object: StubObject | undefined,
) => void

export interface StubStorage {
  /** `http://127.0.0.1:<port>/storage/v1/object/public/content` (no trailing slash). */
  readonly baseUrl: string
  /** Every request, in arrival order. */
  readonly requests: StubRequest[]
  /** The most requests in flight at once since the last reset. */
  readonly maxInFlight: number
  /** Stores an object; GET and HEAD serve it. */
  put(path: string, bytes: Uint8Array, contentType: string): void
  /** Stores every file under `dir` at `<prefix><relative path>`, typed by its extension. */
  putFolder(dir: string, prefix?: string): void
  /** Handlers for the next requests to `path`, in order; the last one repeats. */
  queue(path: string, ...handlers: StubHandler[]): void
  /** A Set-Cookie value sent on every answer (null: none), to prove the loader never sends it back. */
  setCookie(value: string | null): void
  /** Forgets objects, handlers, the log and the counters (between tests). */
  reset(): void
  /** Ends every connection, then the server. */
  close(): Promise<void>
}

const TYPES: Readonly<Record<string, string>> = {
  json: 'application/json',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  mp3: 'audio/mpeg',
}

/** Starts a stub on a free loopback port. */
export async function startStubStorage(): Promise<StubStorage> {
  const objects = new Map<string, StubObject>()
  const handlers = new Map<string, StubHandler[]>()
  const requests: StubRequest[] = []
  let cookie: string | null = null
  let inFlight = 0
  let maxInFlight = 0

  const server = createServer((req, res) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    let counted = true
    const done = () => {
      if (counted) inFlight--
      counted = false
    }
    res.on('close', done)
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname.startsWith(STUB_PREFIX)
      ? url.pathname.slice(STUB_PREFIX.length)
      : url.pathname
    requests.push({ method: req.method ?? '', path, query: url.searchParams, headers: req.headers })
    if (cookie !== null) res.setHeader('set-cookie', cookie)
    const queue = handlers.get(path)
    const handler = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    const object = url.pathname.startsWith(STUB_PREFIX) ? objects.get(path) : undefined
    ;(handler ?? serveObject())(req, res, object)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}${STUB_PREFIX.slice(0, -1)}`,
    requests,
    get maxInFlight() {
      return maxInFlight
    },
    put(path, bytes, contentType) {
      objects.set(path, { bytes, contentType })
    },
    putFolder(dir, prefix = '') {
      const visit = (folder: string) => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          const file = join(folder, entry.name)
          if (entry.isDirectory()) visit(file)
          else if (entry.isFile()) {
            const path = `${prefix}${relative(dir, file).split(sep).join('/')}`
            const ext = entry.name.split('.').pop() ?? ''
            objects.set(path, {
              bytes: new Uint8Array(readFileSync(file)),
              contentType: TYPES[ext] ?? 'application/octet-stream',
            })
          }
        }
      }
      visit(dir)
    },
    queue(path, ...queued) {
      handlers.set(path, queued)
    },
    setCookie(value) {
      cookie = value
    },
    reset() {
      objects.clear()
      handlers.clear()
      requests.length = 0
      cookie = null
      maxInFlight = inFlight
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

// ---- handlers ----

/** Writes status, headers (content-length always explicit) and, except for HEAD, the body. */
function answer(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  headers: OutgoingHttpHeaders,
  body: Uint8Array | string,
  contentLength: number | null = typeof body === 'string' ? Buffer.byteLength(body) : body.length,
): void {
  const all: OutgoingHttpHeaders = { ...headers }
  if (contentLength !== null) all['content-length'] = String(contentLength)
  res.writeHead(status, all)
  if (req.method === 'HEAD') res.end()
  else res.end(body)
}

export interface ObjectOverrides {
  /** Serves these bytes instead of the stored object (for GET-only paths with no object). */
  readonly bytes?: Uint8Array
  readonly contentType?: string
  /** A content-length other than the true one; null leaves it out (HEAD only: GET would hang). */
  readonly contentLength?: number | null
  readonly contentEncoding?: string
  /** false: no Accept-Ranges header. */
  readonly acceptRanges?: boolean
  readonly status?: number
}

/**
 * The stored object (or `overrides.bytes`), with the CDN headers; a missing object answers 400
 * with Supabase's JSON. Overrides inject a wrong type, length or encoding, or no Accept-Ranges.
 */
export function serveObject(overrides: ObjectOverrides = {}): StubHandler {
  return (req, res, stored) => {
    const bytes = overrides.bytes ?? stored?.bytes
    if (!bytes) {
      answer(req, res, 400, { 'content-type': 'application/json' }, MISSING_OBJECT_BODY)
      return
    }
    const headers: OutgoingHttpHeaders = {
      'content-type': overrides.contentType ?? stored?.contentType ?? 'application/octet-stream',
      ...CDN_HEADERS,
    }
    if (overrides.acceptRanges !== false) headers['accept-ranges'] = 'bytes'
    if (overrides.contentEncoding !== undefined) {
      headers['content-encoding'] = overrides.contentEncoding
    }
    const length = overrides.contentLength === undefined ? bytes.length : overrides.contentLength
    answer(req, res, overrides.status ?? 200, headers, bytes, length)
  }
}

/** A JSON object answer (GET or HEAD) with the CDN headers. */
export function json(bytes: Uint8Array, contentType = 'application/json'): StubHandler {
  return serveObject({ bytes, contentType })
}

/** Any status with a small JSON body, e.g. 404, 500, 503, or 429 with `{ 'retry-after': '2' }`. */
export function status(code: number, headers: Record<string, string> = {}): StubHandler {
  return (req, res) => {
    answer(req, res, code, { 'content-type': 'application/json', ...headers }, '{"error":"x"}')
  }
}

/** A redirect to `location` (a stub path); the loader must never follow it. */
export function redirect(code: number, location: string): StubHandler {
  return status(code, { location })
}

/** Waits `ms` before `then` answers (slow headers). */
export function slow(ms: number, then: StubHandler): StubHandler {
  return (req, res, object) => {
    const timer = setTimeout(() => then(req, res, object), ms)
    res.on('close', () => clearTimeout(timer))
  }
}

/** Sends headers and half the body, then stalls (a slow body). */
export function stallBody(bytes: Uint8Array, contentType = 'application/json'): StubHandler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': contentType, 'content-length': String(bytes.length) })
    res.write(bytes.subarray(0, Math.floor(bytes.length / 2)))
  }
}

/** Sends headers and half the body, then closes the connection (a truncated body). */
export function truncateBody(bytes: Uint8Array, contentType = 'application/json'): StubHandler {
  return (req, res) => {
    res.writeHead(200, { 'content-type': contentType, 'content-length': String(bytes.length) })
    res.write(bytes.subarray(0, Math.floor(bytes.length / 2)), () => req.socket.destroy())
  }
}

/** Closes the connection without an answer. */
export const drop: StubHandler = (req) => {
  req.socket.destroy()
}

/** Never answers; only the client's timeout or deadline ends the request. */
export const neverAnswer: StubHandler = () => undefined
