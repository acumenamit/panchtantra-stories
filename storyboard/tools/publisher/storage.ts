// Supabase Storage REST client for the publisher (spec §3.3, §4.4, §8). Plain fetch, no SDK.
// - The secret key goes on the `apikey` header only. `bearerFallback` (off by default) also sends
//   `Authorization: Bearer <key>`; it is used only with the owner's OK if the apikey header alone is
//   refused (P0-13 plan, O4 step 1).
// - Guards, set by the caller, are checked before any request: an allowed bucket list, write
//   prefixes, an exact list of overwritable paths, and safe paths. `masters` is never written or
//   deleted, whatever the caller allows. A refusal throws StorageRefusedError and sends nothing.
// - Results are typed. An upload is never retried, and never retried with upsert.
// - Errors and results never contain the key or any header.
import { z } from 'zod'
import { isSafeStoragePath } from '../../src/core/content/gates'
import type { Secret } from './env'
import { checkServiceUrl, describeNetworkError, parseJsonBytes, readCapped } from './http'

/** Buckets this client never writes to or deletes from. */
export const PROTECTED_BUCKETS: readonly string[] = ['masters']

export const DEFAULT_TIMEOUT_MS = 60_000
export const LIST_PAGE_SIZE = 100
/** Our own bound per remove call, so one mistaken call cannot delete a large set; callers chunk. */
export const MAX_REMOVE_PATHS = 100
export const MAX_LIST_DEPTH = 16
export const MAX_LIST_ENTRIES = 10_000
const MAX_CACHE_SECONDS = 31_536_000 // one year
const MAX_RESPONSE_BYTES = 1024 * 1024

export interface StorageGuards {
  /** Buckets any call may name. PROTECTED_BUCKETS stay read-only even when listed here. */
  readonly allowedBuckets: readonly string[]
  /** Uploads and removes must sit under one of these folders, each ending with '/'. */
  readonly writePrefixes: readonly string[]
  /** The only paths an upload may overwrite (upsert). Exact paths; no patterns. */
  readonly overwritablePaths: readonly string[]
}

export interface StorageClientOptions {
  /** https://<ref>.supabase.co (http is accepted only on a loopback host, for tests). */
  readonly supabaseUrl: URL
  readonly secretKey: Secret
  readonly guards: StorageGuards
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
  readonly listPageSize?: number
  /** Off by default; see the file header. */
  readonly bearerFallback?: boolean
}

export interface UploadRequest {
  readonly bucket: string
  readonly path: string
  readonly body: Uint8Array<ArrayBuffer>
  /** A bare media type such as "audio/mpeg" (no parameters). */
  readonly contentType: string
  /** Seconds, sent as `cache-control: max-age=<n>`. */
  readonly cacheControl: number
  /** Default false. True only for a path in guards.overwritablePaths. */
  readonly upsert?: boolean
}

/** Storage answered with an authentication or permission error, or the request failed. */
export type StorageFailure =
  | { readonly kind: 'unauthorized'; readonly status: number }
  | { readonly kind: 'failed'; readonly status: number | null; readonly code: string }

export type UploadResult =
  | { readonly kind: 'created' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'mime-refused' }
  | StorageFailure

export type RemoveResult =
  | { readonly kind: 'removed'; readonly paths: readonly string[] }
  | {
      readonly kind: 'count-mismatch'
      readonly removed: readonly string[]
      readonly notRemoved: readonly string[]
      readonly unexpected: readonly string[]
    }
  | StorageFailure

export interface StoredObject {
  readonly path: string
  readonly size: number | null
  readonly mimetype: string | null
  readonly cacheControl: string | null
  readonly updatedAt: string | null
}

export type ListResult =
  { readonly kind: 'listed'; readonly objects: readonly StoredObject[] } | StorageFailure

export interface StorageClient {
  upload(request: UploadRequest): Promise<UploadResult>
  /** Deletes exact paths and checks that Storage reports each one deleted. */
  remove(bucket: string, paths: readonly string[]): Promise<RemoveResult>
  /** Every object under a folder ('' or 'a/b/'), recursively, all pages, sorted by path. */
  list(bucket: string, folder: string): Promise<ListResult>
}

/** A guard or argument check failed; no request was sent. */
export class StorageRefusedError extends Error {
  override readonly name = 'StorageRefusedError'
}

// ---- pure helpers ----

const BUCKET_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/

/** '' (the bucket root) or a safe path followed by exactly one '/'. */
export function isFolderPrefix(folder: string): boolean {
  return folder === '' || (folder.endsWith('/') && isSafeStoragePath(folder.slice(0, -1)))
}

export function isUnderPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path.startsWith(prefix) && path.length > prefix.length)
}

/**
 * The status Storage meant. storage-api can answer an error with HTTP 400 and put the real status in
 * the JSON body's `statusCode` (as a string), so that value wins on a 400 (inference from its error
 * format; both shapes are handled).
 */
export function effectiveStatus(httpStatus: number, body: unknown): number {
  if (httpStatus !== 400 || !isRecord(body)) return httpStatus
  const raw = body.statusCode
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : httpStatus
}

/** Storage codes are short words ("KeyAlreadyExists", "Not Found"); anything else is never repeated. */
const ERROR_CODE = /^[A-Za-z][A-Za-z0-9 _.-]{0,39}$/
/** The start of every Supabase API key (sb_secret_, sb_publishable_). */
const KEY_MARKER = /sb_/i
/** The shortest run of key characters treated as a leak when it shows up in a failure code. */
const KEY_RUN_LENGTH = 8

/**
 * Storage's `code` or `error` field, without spaces, or "unknown". Never the message text. The field
 * is taken whole or not at all: it is never cut or stripped into a shorter token, because a cut
 * could leave part of an echoed key that no full-key scrub would then recognise.
 */
export function storageErrorCode(body: unknown): string {
  if (!isRecord(body)) return 'unknown'
  const raw = typeof body.code === 'string' ? body.code : body.error
  if (typeof raw !== 'string' || !ERROR_CODE.test(raw) || KEY_MARKER.test(raw)) return 'unknown'
  return raw.replaceAll(' ', '')
}

const lettersAndDigits = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * True when `text` repeats any KEY_RUN_LENGTH consecutive letters and digits of `secret`. Case and
 * other characters are ignored on both sides, because a sanitizer may already have stripped them.
 */
export function repeatsSecretRun(text: string, secret: string): boolean {
  const haystack = lettersAndDigits(text)
  const needle = lettersAndDigits(secret)
  for (let start = 0; start + KEY_RUN_LENGTH <= needle.length; start++) {
    if (haystack.includes(needle.slice(start, start + KEY_RUN_LENGTH))) return true
  }
  return false
}

export function classifyFailure(httpStatus: number, body: unknown): StorageFailure {
  const status = effectiveStatus(httpStatus, body)
  if (status === 401 || status === 403) return { kind: 'unauthorized', status }
  return { kind: 'failed', status, code: storageErrorCode(body) }
}

export function classifyUpload(httpStatus: number, body: unknown): UploadResult {
  if (httpStatus >= 200 && httpStatus < 300) return { kind: 'created' }
  switch (effectiveStatus(httpStatus, body)) {
    case 409:
      return { kind: 'duplicate' }
    case 413:
      return { kind: 'too-large' }
    case 415:
      return { kind: 'mime-refused' }
    default:
      return classifyFailure(httpStatus, body)
  }
}

const DeletedRows = z.array(z.object({ name: z.string() }))

/** Compares the rows Storage says it deleted with the paths that were asked for. */
export function checkRemoved(
  requested: readonly string[],
  status: number,
  body: unknown,
): RemoveResult {
  const rows = DeletedRows.safeParse(body)
  if (!rows.success) return { kind: 'failed', status, code: 'unreadable-response' }
  const deleted = new Set(rows.data.map((row) => row.name))
  const wanted = new Set(requested)
  const removed = requested.filter((path) => deleted.has(path))
  const notRemoved = requested.filter((path) => !deleted.has(path))
  const unexpected = [...deleted].filter((name) => !wanted.has(name))
  if (notRemoved.length === 0 && unexpected.length === 0 && rows.data.length === requested.length) {
    return { kind: 'removed', paths: removed }
  }
  return { kind: 'count-mismatch', removed, notRemoved, unexpected }
}

const ListedEntry = z.object({
  name: z.string().min(1),
  id: z.string().nullable(), // null marks a folder
  updated_at: z.string().nullish(),
  metadata: z.unknown().optional(),
})
const ListedPage = z.array(ListedEntry)
type ListedEntry = z.infer<typeof ListedEntry>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function metadataField(entry: ListedEntry, key: string): unknown {
  return isRecord(entry.metadata) ? entry.metadata[key] : undefined
}

function toStoredObject(path: string, entry: ListedEntry): StoredObject {
  const size = metadataField(entry, 'size')
  const mimetype = metadataField(entry, 'mimetype')
  const cacheControl = metadataField(entry, 'cacheControl')
  return {
    path,
    size: typeof size === 'number' && Number.isSafeInteger(size) ? size : null,
    mimetype: typeof mimetype === 'string' ? mimetype : null,
    cacheControl: typeof cacheControl === 'string' ? cacheControl : null,
    updatedAt: entry.updated_at ?? null,
  }
}

function describePath(path: string): string {
  return JSON.stringify(path.length > 120 ? `${path.slice(0, 120)}...` : path)
}

function checkGuards(guards: StorageGuards): StorageGuards {
  if (guards.allowedBuckets.length === 0) throw new TypeError('allowedBuckets must not be empty')
  for (const bucket of guards.allowedBuckets) {
    if (!BUCKET_NAME.test(bucket))
      throw new TypeError(`invalid bucket name ${describePath(bucket)}`)
  }
  if (guards.writePrefixes.length === 0) throw new TypeError('writePrefixes must not be empty')
  for (const prefix of guards.writePrefixes) {
    if (prefix === '' || !isFolderPrefix(prefix)) {
      throw new TypeError(
        `write prefix ${describePath(prefix)} must be a safe folder ending in '/'`,
      )
    }
  }
  for (const path of guards.overwritablePaths) {
    if (!isSafeStoragePath(path) || !isUnderPrefix(path, guards.writePrefixes)) {
      throw new TypeError(`overwritable path ${describePath(path)} must be safe and under a prefix`)
    }
  }
  return {
    allowedBuckets: [...guards.allowedBuckets],
    writePrefixes: [...guards.writePrefixes],
    overwritablePaths: [...guards.overwritablePaths],
  }
}

// ---- client ----

type Exchange =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'network'; readonly code: string }

export function createStorageClient(options: StorageClientOptions): StorageClient {
  checkServiceUrl(options.supabaseUrl, 'supabaseUrl')
  const origin = options.supabaseUrl.origin
  const guards = checkGuards(options.guards)
  const overwritable = new Set(guards.overwritablePaths)
  const { secretKey } = options
  if (secretKey.reveal().length < 8) throw new TypeError('secretKey is too short')
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pageSize = options.listPageSize ?? LIST_PAGE_SIZE
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new TypeError('listPageSize must be a positive integer')
  }

  /** Belt and braces: no text leaves this client with the key in it. */
  const scrub = (text: string) => text.split(secretKey.reveal()).join('[redacted]')
  const refuse = (message: string): never => {
    throw new StorageRefusedError(scrub(`refused: ${message}`))
  }
  /** A failure code that repeats any run of the key, whole or partial, becomes "unknown". */
  const safeCode = (code: string) => (repeatsSecretRun(code, secretKey.reveal()) ? 'unknown' : code)

  const authHeaders = (): Record<string, string> => {
    const key = secretKey.reveal()
    return options.bearerFallback
      ? { apikey: key, authorization: `Bearer ${key}` }
      : { apikey: key }
  }

  function checkBucket(bucket: string, access: 'read' | 'write'): void {
    if (access === 'write' && PROTECTED_BUCKETS.includes(bucket)) {
      refuse(`bucket ${describePath(bucket)} is never written to or deleted from`)
    }
    if (!guards.allowedBuckets.includes(bucket)) {
      refuse(`bucket ${describePath(bucket)} is not in the allowed bucket list`)
    }
  }

  function checkWritablePath(path: string): void {
    if (!isSafeStoragePath(path)) refuse(`unsafe path ${describePath(path)}`)
    if (!isUnderPrefix(path, guards.writePrefixes)) {
      refuse(`path ${describePath(path)} is outside the write prefixes`)
    }
  }

  async function send(
    method: 'POST' | 'DELETE',
    path: string,
    headers: Record<string, string>,
    body: Uint8Array<ArrayBuffer> | string,
  ): Promise<Exchange> {
    try {
      const response = await fetchImpl(new URL(path, origin), {
        method,
        headers: { ...authHeaders(), ...headers },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
      const bytes = await readCapped(response, MAX_RESPONSE_BYTES)
      const parsed = bytes ? parseJsonBytes(bytes) : { ok: false as const }
      return {
        kind: 'response',
        status: response.status,
        body: parsed.ok ? parsed.value : undefined,
      }
    } catch (error) {
      return { kind: 'network', code: safeCode(describeNetworkError(error)) }
    }
  }

  const networkFailure = (exchange: { code: string }): StorageFailure => ({
    kind: 'failed',
    status: null,
    code: exchange.code,
  })

  const scrubFailure = (failure: StorageFailure): StorageFailure =>
    failure.kind === 'failed' ? { ...failure, code: safeCode(failure.code) } : failure

  async function upload(request: UploadRequest): Promise<UploadResult> {
    checkBucket(request.bucket, 'write')
    checkWritablePath(request.path)
    if (!MEDIA_TYPE.test(request.contentType)) {
      refuse('contentType must be a bare lowercase media type such as "audio/mpeg"')
    }
    const seconds = request.cacheControl
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > MAX_CACHE_SECONDS) {
      refuse(`cacheControl must be whole seconds from 0 to ${MAX_CACHE_SECONDS}`)
    }
    const upsert = request.upsert ?? false
    if (upsert && !overwritable.has(request.path)) {
      refuse(
        `upsert is not allowed on ${describePath(request.path)}; it is not an overwritable path`,
      )
    }
    const exchange = await send(
      'POST',
      `/storage/v1/object/${request.bucket}/${request.path}`,
      {
        'content-type': request.contentType,
        'cache-control': `max-age=${seconds}`,
        'x-upsert': upsert ? 'true' : 'false',
      },
      request.body,
    )
    if (exchange.kind === 'network') return networkFailure(exchange)
    const result = classifyUpload(exchange.status, exchange.body)
    return result.kind === 'unauthorized' || result.kind === 'failed'
      ? scrubFailure(result)
      : result
  }

  async function remove(bucket: string, paths: readonly string[]): Promise<RemoveResult> {
    checkBucket(bucket, 'write')
    if (paths.length === 0) refuse('remove needs at least one path')
    if (paths.length > MAX_REMOVE_PATHS) refuse(`remove takes at most ${MAX_REMOVE_PATHS} paths`)
    if (new Set(paths).size !== paths.length) refuse('remove paths must be unique')
    for (const path of paths) checkWritablePath(path)
    const exchange = await send(
      'DELETE',
      `/storage/v1/object/${bucket}`,
      { 'content-type': 'application/json' },
      JSON.stringify({ prefixes: paths }),
    )
    if (exchange.kind === 'network') return networkFailure(exchange)
    if (exchange.status < 200 || exchange.status >= 300) {
      return scrubFailure(classifyFailure(exchange.status, exchange.body))
    }
    return checkRemoved(paths, exchange.status, exchange.body)
  }

  async function listPage(
    bucket: string,
    folder: string,
    offset: number,
  ): Promise<{ ok: true; entries: ListedEntry[] } | { ok: false; failure: StorageFailure }> {
    const body = JSON.stringify({
      prefix: folder.replace(/\/$/, ''),
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    const exchange = await send(
      'POST',
      `/storage/v1/object/list/${bucket}`,
      { 'content-type': 'application/json' },
      body,
    )
    if (exchange.kind === 'network') return { ok: false, failure: networkFailure(exchange) }
    if (exchange.status < 200 || exchange.status >= 300) {
      return { ok: false, failure: scrubFailure(classifyFailure(exchange.status, exchange.body)) }
    }
    const page = ListedPage.safeParse(exchange.body)
    if (!page.success) {
      return {
        ok: false,
        failure: { kind: 'failed', status: exchange.status, code: 'unreadable-response' },
      }
    }
    return { ok: true, entries: page.data }
  }

  async function list(bucket: string, folder: string): Promise<ListResult> {
    checkBucket(bucket, 'read')
    if (!isFolderPrefix(folder)) refuse(`folder ${describePath(folder)} must be '' or end in '/'`)
    const objects: StoredObject[] = []
    const pending: { folder: string; depth: number }[] = [{ folder, depth: 0 }]
    let entriesSeen = 0 // files and folders, which bounds the number of requests too
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (next.depth > MAX_LIST_DEPTH) {
        return { kind: 'failed', status: null, code: 'list-depth-exceeded' }
      }
      for (let offset = 0; ; offset += pageSize) {
        const page = await listPage(bucket, next.folder, offset)
        if (!page.ok) return page.failure
        entriesSeen += page.entries.length
        if (entriesSeen > MAX_LIST_ENTRIES) {
          return { kind: 'failed', status: null, code: 'list-size-exceeded' }
        }
        for (const entry of page.entries) {
          const path = `${next.folder}${entry.name}`
          if (entry.id === null) pending.push({ folder: `${path}/`, depth: next.depth + 1 })
          else objects.push(toStoredObject(path, entry))
        }
        if (page.entries.length < pageSize) break
      }
    }
    objects.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return { kind: 'listed', objects }
  }

  return { upload, remove, list }
}
