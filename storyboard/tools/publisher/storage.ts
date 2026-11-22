// Supabase Storage REST client for the publisher (spec §3.3, §4.4, §8; design p1-step13-design.md,
// P1-8b). Plain fetch, no SDK.
// - Callers name objects by typed refs (storage-layout.ts). Bucket, path, content type, cache and
//   the upsert flag come from the class table, never from a caller. Re-check 1 (the target) and
//   re-check 2 (the request URL) run before any request.
// - Five methods only: create (create-only, x-upsert false), writePointer (the two pointers, the
//   only overwrites), readMaster (approvals and waivers, the authenticated GET), readContent (the
//   two pointers, each with a fresh cache nonce, and snapshots, the authenticated GET; Step 14,
//   p1-step14-design.md §3.4; and packages by content address, no nonce, Step 15a,
//   p1-step15a-design.md §3.17) and listContent. The transport sends GET and POST only, to routes
//   built from four fixed literals; this module has no delete, move, copy, sign or bucket route.
// - A request URL carries no search and no hash, and its href is exactly origin, pathname and
//   search; the one search sent is `?cacheNonce=<digits>` on a pointer read.
// - A body is type-checked and copied at entry, before any await; size, the build's own gates, the
//   hash and the request all use the copy.
// - The secret key goes on the `apikey` header only. `bearerFallback` (a boolean, off by default)
//   also sends `Authorization: Bearer <key>`; it is used only with the owner's OK.
// - A refusal throws StorageRefusedError with the fixed text `refused: <class> <stage> <rule>` and
//   sends nothing; a construction refusal is a TypeError `refused: client option <rule>`.
// - The approval body gate (Step 15a, D15-6) keeps the Step 13 checks and their order, then the strict
//   ApprovalRecord schema (record-schema) and canonical JCS bytes (not-jcs).
// - Results are typed. Nothing is retried and nothing is printed. Errors and results never carry the
//   key, a header or server message text: failure codes are whole sanitised tokens or "unknown".
import { z } from 'zod'
import {
  checkPackagePaths,
  checkPointer,
  decodeJson,
  isCanonicalJcs,
  isSafeStoragePath,
  parseStrictJson,
} from '../../src/core/content/gates'
import { checkUniqueStoryIds } from '../../src/core/content/packages'
import { sha256Hex } from '../../src/core/hashing'
import { ApprovalRecord } from '../../src/core/package/approval'
import { CatalogueSnapshot } from '../../src/core/package/catalogue'
import { hasOwnProtoKey, StoryPackageV1 } from '../../src/core/package/v1'
import { isSecretKeyShape, Secret } from './env'
import { describeNetworkError, parseJsonBytes, readCapped } from './http'
import {
  classOfPath,
  contentReadTarget,
  MAX_JSON_BYTES,
  pointerTarget,
  recheckTarget,
  recheckUrl,
  targetOf,
  type ContentReadRef,
  type CreateRef,
  type LayoutResult,
  type MasterReadRef,
  type PointerMode,
  type Refusal,
  type Target,
} from './storage-layout'

export const DEFAULT_TIMEOUT_MS = 60_000
export const LIST_PAGE_SIZE = 100
export const MAX_LIST_DEPTH = 16
export const MAX_LIST_ENTRIES = 10_000
const MAX_TIMEOUT_MS = 600_000
const MIN_KEY_LENGTH = 8
const MAX_RESPONSE_BYTES = MAX_JSON_BYTES

// The closed route list (§4.1): every request URL is built from one of these four literals.
const OBJECT_ROUTE = '/storage/v1/object/'
const MASTERS_READ_ROUTE = '/storage/v1/object/authenticated/masters/'
const CONTENT_READ_ROUTE = '/storage/v1/object/authenticated/content/'
const LIST_ROUTE = '/storage/v1/object/list/content'
/** The one search the transport sends: a pointer read's cache nonce (Step 14, D13-4). */
const NONCE_SEARCH = /^\?cacheNonce=[1-9][0-9]{0,15}$/
/** A nonce as text: a positive integer of at most 16 digits, no leading zero. */
const NONCE_TEXT = /^[1-9][0-9]{0,15}$/

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])
const SUPABASE_HOST = /^[a-z0-9]{20}\.supabase\.co$/
const OPTION_KEYS: ReadonlySet<string> = new Set([
  'supabaseUrl',
  'secretKey',
  'fetchImpl',
  'timeoutMs',
  'listPageSize',
  'bearerFallback',
])

export interface StorageClientOptions {
  /** https://<20 lowercase alnum>.supabase.co, or http on a loopback host with a port (tests). */
  readonly supabaseUrl: URL
  readonly secretKey: Secret
  /** Accepted only with a loopback origin. */
  readonly fetchImpl?: typeof fetch
  /** 1 to 600,000 ms; covers headers and body. */
  readonly timeoutMs?: number
  readonly listPageSize?: number
  /** Off by default; see the file header. */
  readonly bearerFallback?: boolean
}

/** Storage answered with an authentication or permission error, or the request failed. */
export type StorageFailure =
  | { readonly kind: 'unauthorized'; readonly status: number }
  | { readonly kind: 'failed'; readonly status: number | null; readonly code: string }

/** What one upload answer means, before the client adds its read-back verdict. */
export type UploadOutcome =
  | { readonly kind: 'created' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'mime-refused' }
  | StorageFailure

export type StoredVerdict = 'identical' | 'different' | 'unchecked'

export type CreateResult =
  | { readonly kind: 'created' }
  | { readonly kind: 'duplicate'; readonly stored: StoredVerdict }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'mime-refused' }
  | StorageFailure

export type PointerResult =
  | { readonly kind: 'written' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'mime-refused' }
  | StorageFailure

/** `not-found` means absent, or not visible to this key; callers stop on it (§1.3). */
export type ReadResult =
  | {
      readonly kind: 'found'
      readonly bytes: Uint8Array<ArrayBuffer>
      readonly size: number
      readonly sha256: string
    }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'too-large'; readonly limit: number }
  | { readonly kind: 'hash-mismatch'; readonly sha256: string }
  | StorageFailure

/** A pointer or snapshot read: a read result without the hash check (content names hold no hash). */
export type ContentReadResult = Exclude<ReadResult, { readonly kind: 'hash-mismatch' }>

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
  /** Create-only write of a package, media item, snapshot or masters approval record. */
  create(ref: CreateRef, body: Uint8Array): Promise<CreateResult>
  /** Overwrites catalogue/production.json or catalogue/staging.json with a gated pointer. */
  writePointer(mode: PointerMode, body: Uint8Array): Promise<PointerResult>
  /** Reads an approval or waiver from masters by exact name. */
  readMaster(ref: MasterReadRef): Promise<ReadResult>
  /** Reads a pointer (with a fresh cache nonce), a snapshot or a package from content, authenticated. */
  readContent(ref: ContentReadRef): Promise<ContentReadResult>
  /** Every content object under a folder ('' or 'a/b/'), recursively, all pages, sorted by path. */
  listContent(folder: string): Promise<ListResult>
}

/** A ref, body, URL or folder check failed; no request was sent. */
export class StorageRefusedError extends Error {
  override readonly name = 'StorageRefusedError'
}

// ---- pure helpers ----

/** '' (the bucket root) or a safe path followed by exactly one '/'. */
export function isFolderPrefix(folder: string): boolean {
  return folder === '' || (folder.endsWith('/') && isSafeStoragePath(folder.slice(0, -1)))
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
/** The `sb_` start of every Supabase API key, secret and publishable alike. */
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

export function classifyUpload(httpStatus: number, body: unknown): UploadOutcome {
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

/**
 * A read answer that is not 2xx (lead decision 5): 401/403 first; then `not-found` only on an
 * effective status of 400 or 404 with the raw `code` exactly NoSuchKey, or, with no string `code`,
 * the raw `error` exactly not_found; anything else is failed.
 */
export function classifyRead(
  httpStatus: number,
  body: unknown,
): StorageFailure | { readonly kind: 'not-found' } {
  const failure = classifyFailure(httpStatus, body)
  if (failure.kind === 'unauthorized') return failure
  const status = effectiveStatus(httpStatus, body)
  const signal =
    isRecord(body) &&
    (body.code === 'NoSuchKey' || (typeof body.code !== 'string' && body.error === 'not_found'))
  return (status === 400 || status === 404) && signal ? { kind: 'not-found' } : failure
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

function refuse(cls: string, refusal: Refusal): never {
  throw new StorageRefusedError(`refused: ${cls} ${refusal.stage} ${refusal.rule}`)
}

function refuseRule(cls: string, stage: Refusal['stage'], rule: string): never {
  refuse(cls, { cls, stage, rule })
}

function expectTarget(result: LayoutResult<Target>): Target {
  if (!result.ok) refuse(result.refusal.cls, result.refusal)
  return result.value
}

/** The body checked and copied before any await (CRIT-6): a Uint8Array over a plain ArrayBuffer. */
function copyBody(cls: string, body: unknown, maxBytes: number): Uint8Array<ArrayBuffer> {
  if (
    !ArrayBuffer.isView(body) ||
    !(body instanceof Uint8Array) ||
    !(body.buffer instanceof ArrayBuffer)
  ) {
    refuseRule(cls, 'body-gate', 'body-type')
  }
  const copy = new Uint8Array(new ArrayBuffer(body.byteLength))
  copy.set(body)
  if (copy.byteLength === 0 || copy.byteLength > maxBytes) refuseRule(cls, 'body-gate', 'body-size')
  return copy
}

/** hasOwnProtoKey (src/core/package/v1.ts) looks no deeper than this many levels. */
const PROTO_CHECK_DEPTH = 64

/**
 * True when an object or array sits deeper than hasOwnProtoKey looks, so the record cannot be cleared
 * of `__proto__` keys "at any depth" (§3.3) and the approval gate refuses it (review fix SEC-4).
 */
function nestsBelowProtoCheck(value: unknown, depth = 0): boolean {
  if (value === null || typeof value !== 'object') return false
  if (depth > PROTO_CHECK_DEPTH) return true
  return Object.values(value).some((child) => nestsBelowProtoCheck(child, depth + 1))
}

/**
 * The class's body gate on the copy (§3.3, §3.7): the build's own checks that can run from the ref
 * and the body alone. Returns the failing rule or null; a src/core reason is never forwarded.
 */
async function bodyGateRule(
  target: Target,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string | null> {
  const fields = target.fields
  switch (target.kind) {
    case 'package': {
      if ((await sha256Hex(bytes)) !== fields.packageSha256) return 'sha256-mismatch'
      const decoded = decodeJson(bytes, 'package')
      if (!decoded.ok || !isCanonicalJcs(decoded.value, bytes)) return 'not-jcs'
      const parsed = parseStrictJson(bytes, StoryPackageV1, 'package')
      if (!parsed.ok) return 'strict-parse'
      if (parsed.value.data.storyId !== fields.storyId) return 'story-id-mismatch'
      return null
    }
    case 'snapshot': {
      const parsed = parseStrictJson(bytes, CatalogueSnapshot, 'snapshot')
      if (!parsed.ok) return 'strict-parse'
      if (!isCanonicalJcs(parsed.value.raw, bytes)) return 'not-jcs'
      const { seq, stories } = parsed.value.data
      if (seq !== fields.seq) return 'seq-mismatch'
      if (!checkPackagePaths(stories, 'production', '').ok) return 'package-path'
      if (!checkUniqueStoryIds(stories).ok) return 'story-id-unique'
      return null
    }
    case 'pointer': {
      const mode = fields.mode
      const checked =
        mode === 'production' || mode === 'staging' ? checkPointer(bytes, { mode, root: '' }) : null
      if (checked === null || !checked.ok) return 'pointer-gate'
      if (checked.value.seq < 1) return 'pointer-seq'
      return null
    }
    case 'approval': {
      const decoded = decodeJson(bytes, 'approval')
      if (!decoded.ok || !isRecord(decoded.value)) return 'record-json'
      const record = decoded.value
      if (nestsBelowProtoCheck(record) || hasOwnProtoKey(record)) return 'proto-key'
      if (!Object.hasOwn(record, 'storyId') || record.storyId !== fields.storyId) {
        return 'record-story-id'
      }
      if (
        !Object.hasOwn(record, 'packageSha256') ||
        record.packageSha256 !== fields.packageSha256
      ) {
        return 'record-sha256'
      }
      const parsed = parseStrictJson(bytes, ApprovalRecord, 'approval')
      if (!parsed.ok) return 'record-schema'
      if (!isCanonicalJcs(parsed.value.raw, bytes)) return 'not-jcs'
      return null
    }
    default:
      return null // media: the size bound only
  }
}

/**
 * The class a request path belongs to under the closed route list (§4.1), or null: the list route
 * (POST), a pointer, snapshot or package under the authenticated content route (GET; Step 14, Step
 * 15a), an approval or
 * waiver under the authenticated masters route (GET), or a creatable class's object path (POST).
 * send() refuses any other URL, so a later call site that builds a URL another way (OBJECT_ROUTE +
 * 'move', a relative URL) cannot send it (review fix SEC-6).
 */
function routeClass(method: 'GET' | 'POST', pathname: string): string | null {
  if (method === 'POST' && pathname === LIST_ROUTE) return 'listing'
  if (method === 'GET') {
    if (pathname.startsWith(CONTENT_READ_ROUTE)) {
      const kind = classOfPath('content', pathname.slice(CONTENT_READ_ROUTE.length))?.kind
      return kind === 'pointer' || kind === 'snapshot' || kind === 'package' ? kind : null
    }
    if (!pathname.startsWith(MASTERS_READ_ROUTE)) return null
    const kind = classOfPath('masters', pathname.slice(MASTERS_READ_ROUTE.length))?.kind
    return kind === 'approval' || kind === 'waiver' ? kind : null
  }
  if (method !== 'POST' || !pathname.startsWith(OBJECT_ROUTE)) return null
  const rest = pathname.slice(OBJECT_ROUTE.length)
  const slash = rest.indexOf('/')
  const kind =
    slash < 0 ? undefined : classOfPath(rest.slice(0, slash), rest.slice(slash + 1))?.kind
  return kind === undefined || kind === 'waiver' ? null : kind
}

/**
 * The URL the options name, re-parsed from its own href (review fix SEC2-2). `URL.prototype.toString`
 * reads the URL's internal state and throws on an object that only has URL.prototype, so a subclass
 * or a forgery whose getters show an allowed host cannot steer the checks and the requests apart.
 * null when the value is not a real URL.
 */
function realUrl(value: unknown): URL | null {
  if (!(value instanceof URL)) return null
  try {
    return new URL(URL.prototype.toString.call(value))
  } catch {
    return null
  }
}

function isAllowedOrigin(url: URL): boolean {
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false
  if (url.protocol === 'https:') return SUPABASE_HOST.test(url.hostname) && url.port === ''
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && url.port !== ''
}

function optionRefused(rule: string): never {
  throw new TypeError(`refused: client option ${rule}`)
}

/** The options read once from own data descriptors: exact known keys, no accessors (A22). */
function readOptions(options: unknown): ReadonlyMap<string, unknown> {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    optionRefused('option-keys')
  }
  const proto: unknown = Object.getPrototypeOf(options)
  if (proto !== Object.prototype && proto !== null) optionRefused('option-keys')
  const values = new Map<string, unknown>()
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !OPTION_KEYS.has(key)) optionRefused('option-keys')
    const descriptor = Reflect.getOwnPropertyDescriptor(options, key)
    if (descriptor === undefined || !descriptor.enumerable) optionRefused('option-keys')
    if (!('value' in descriptor)) optionRefused('option-accessor')
    values.set(key, descriptor.value)
  }
  return values
}

// ---- client ----

type Exchange =
  | {
      readonly kind: 'response'
      readonly status: number
      /** The body under the 1 MiB cap, or null when it was larger. */
      readonly bytes: Uint8Array<ArrayBuffer> | null
    }
  | { readonly kind: 'network'; readonly code: string }
  /** Headers arrived, then reading the body failed (a stall past the timeout, a cut connection). */
  | { readonly kind: 'unreadable'; readonly status: number; readonly code: string }

const jsonOf = (bytes: Uint8Array | null): unknown => {
  if (bytes === null) return undefined
  const parsed = parseJsonBytes(bytes)
  return parsed.ok ? parsed.value : undefined
}

/**
 * An answer's JSON body, or undefined when it was over the cap, broke off or is not JSON. A known
 * status is then classified with the body undefined on every route, so 401 and 403 stay
 * `unauthorized` and the status is kept (review fix FID-1, design §17).
 */
const bodyOf = (exchange: Exchange): unknown =>
  exchange.kind === 'response' ? jsonOf(exchange.bytes) : undefined

export function createStorageClient(options: StorageClientOptions): StorageClient {
  const values = readOptions(options)
  const supabaseUrl = realUrl(values.get('supabaseUrl'))
  if (supabaseUrl === null || !isAllowedOrigin(supabaseUrl)) optionRefused('url-origin')
  const loopback = supabaseUrl.protocol === 'http:'
  const fetchOption = values.get('fetchImpl')
  if (fetchOption !== undefined && (!loopback || typeof fetchOption !== 'function')) {
    optionRefused('fetch-impl')
  }
  const secretKey = values.get('secretKey')
  if (!(secretKey instanceof Secret) || secretKey.reveal().length < MIN_KEY_LENGTH) {
    optionRefused('key-short')
  }
  if (!loopback && !isSecretKeyShape(secretKey.reveal())) optionRefused('key-shape')
  const rawPage = values.get('listPageSize')
  const pageOption = rawPage === undefined ? LIST_PAGE_SIZE : rawPage
  if (typeof pageOption !== 'number' || !Number.isSafeInteger(pageOption) || pageOption < 1) {
    optionRefused('page-size')
  }
  const pageSize: number = pageOption
  const rawTimeout = values.get('timeoutMs')
  const timeoutOption = rawTimeout === undefined ? DEFAULT_TIMEOUT_MS : rawTimeout
  if (
    typeof timeoutOption !== 'number' ||
    !Number.isSafeInteger(timeoutOption) ||
    timeoutOption < 1 ||
    timeoutOption > MAX_TIMEOUT_MS
  ) {
    optionRefused('timeout')
  }
  const timeoutMs: number = timeoutOption
  const bearerOption = values.get('bearerFallback')
  if (bearerOption !== undefined && typeof bearerOption !== 'boolean') {
    optionRefused('bearer-fallback')
  }
  const bearer = bearerOption === true
  const fetchImpl = (fetchOption as typeof fetch | undefined) ?? fetch
  const origin = supabaseUrl.origin
  const key: Secret = secretKey

  /** A failure code that repeats any run of the key, whole or partial, becomes "unknown". */
  const safeCode = (code: string) => (repeatsSecretRun(code, key.reveal()) ? 'unknown' : code)

  const authHeaders = (): Record<string, string> => {
    const value = key.reveal()
    return bearer ? { apikey: value, authorization: `Bearer ${value}` } : { apikey: value }
  }

  /** Re-check 1 on the target, then re-check 2 on the URL built from one of the three routes. */
  function checkedUrl(target: Target, route: string): URL {
    const first = recheckTarget(target)
    if (!first.ok) refuse(target.kind, first.refusal)
    const url = new URL(route, origin)
    const second = recheckUrl(url, origin, route)
    if (!second.ok) refuse(target.kind, second.refusal)
    return url
  }

  async function send(
    cls: string,
    method: 'GET' | 'POST',
    url: URL,
    headers: Record<string, string>,
    body?: Uint8Array<ArrayBuffer> | string,
  ): Promise<Exchange> {
    // WHATWG reports a bare '?' or '#' as an empty search or hash while fetch still sends it, so the
    // href itself must be exactly origin, pathname and search (Step 14, D14-23).
    if (url.href !== url.origin + url.pathname + url.search) refuseRule(cls, 'url', 'url-mismatch')
    const nonceRead = cls === 'pointer' && method === 'GET' && NONCE_SEARCH.test(url.search)
    if (url.origin !== origin || (url.search !== '' && !nonceRead) || url.hash !== '') {
      refuseRule(cls, 'url', 'url-mismatch')
    }
    if (routeClass(method, url.pathname) !== cls) refuseRule(cls, 'url', 'url-mismatch')
    let response: Response
    try {
      response = await fetchImpl(url, {
        method,
        headers: { ...authHeaders(), ...headers },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      return { kind: 'network', code: safeCode(describeNetworkError(error)) }
    }
    try {
      return {
        kind: 'response',
        status: response.status,
        bytes: await readCapped(response, MAX_RESPONSE_BYTES),
      }
    } catch (error) {
      return {
        kind: 'unreadable',
        status: response.status,
        code: safeCode(describeNetworkError(error)),
      }
    }
  }

  const networkFailure = (exchange: { code: string }): StorageFailure => ({
    kind: 'failed',
    status: null,
    code: exchange.code,
  })

  const scrubFailure = (failure: StorageFailure): StorageFailure =>
    failure.kind === 'failed' ? { ...failure, code: safeCode(failure.code) } : failure

  /** A non-2xx read answer through classifyRead, its failure code scrubbed. */
  const classifiedRead = (status: number, body: unknown): ContentReadResult => {
    const result = classifyRead(status, body)
    return result.kind === 'failed' ? scrubFailure(result) : result
  }

  /** One authenticated GET of a checked URL, classified; no name hash is checked here. */
  async function getObject(target: Target, url: URL): Promise<ContentReadResult> {
    const exchange = await send(target.kind, 'GET', url, { 'accept-encoding': 'identity' })
    if (exchange.kind === 'network') return networkFailure(exchange)
    const success = exchange.status >= 200 && exchange.status < 300
    // A 2xx body is the object: one that breaks off is like a network error (§3.4). An error body
    // that breaks off or is over the cap is classified with the body undefined (FID-1).
    if (exchange.kind === 'unreadable') {
      return success ? networkFailure(exchange) : classifiedRead(exchange.status, undefined)
    }
    if (success) {
      if (exchange.bytes === null) return { kind: 'too-large', limit: MAX_JSON_BYTES }
      const sha256 = await sha256Hex(exchange.bytes)
      return { kind: 'found', bytes: exchange.bytes, size: exchange.bytes.byteLength, sha256 }
    }
    return classifiedRead(exchange.status, bodyOf(exchange))
  }

  async function readTarget(target: Target): Promise<ReadResult> {
    const result = await getObject(target, checkedUrl(target, MASTERS_READ_ROUTE + target.path))
    if (
      result.kind === 'found' &&
      target.kind === 'waiver' &&
      result.sha256 !== target.fields.waiverSha256
    ) {
      return { kind: 'hash-mismatch', sha256: result.sha256 }
    }
    return result
  }

  /** The last nonce sent; each pointer read sends a larger one. */
  let lastNonce = 0

  /**
   * A fresh nonce: Math.max(Date.now(), last + 1), a positive safe integer of at most 16 digits;
   * any other value (a clock of NaN, 1e16 or 2**53) is refused with nothing sent.
   */
  function nextNonce(): number {
    const nonce = Math.max(Date.now(), lastNonce + 1)
    if (!Number.isSafeInteger(nonce) || nonce < 1 || !NONCE_TEXT.test(String(nonce))) {
      refuseRule('pointer', 'url', 'url-mismatch')
    }
    lastNonce = nonce
    return nonce
  }

  async function readContent(ref: ContentReadRef): Promise<ContentReadResult> {
    const target = expectTarget(contentReadTarget(ref))
    const url = checkedUrl(target, CONTENT_READ_ROUTE + target.path)
    // The assignment replaces any search; it never appends (documented, L10a).
    if (target.kind === 'pointer') url.search = `?cacheNonce=${nextNonce()}`
    return getObject(target, url)
  }

  /** One POST of the copy; the answer classified as an upload. */
  async function upload(target: Target, copy: Uint8Array<ArrayBuffer>, upsert: 'true' | 'false') {
    const url = checkedUrl(target, OBJECT_ROUTE + target.bucket + '/' + target.path)
    const exchange = await send(
      target.kind,
      'POST',
      url,
      {
        'content-type': target.contentType ?? '',
        'cache-control': `max-age=${target.cacheSeconds ?? 0}`,
        'x-upsert': upsert,
        'accept-encoding': 'identity',
      },
      copy,
    )
    if (exchange.kind === 'network') return networkFailure(exchange)
    const outcome = classifyUpload(exchange.status, bodyOf(exchange))
    return outcome.kind === 'unauthorized' || outcome.kind === 'failed'
      ? scrubFailure(outcome)
      : outcome
  }

  async function create(ref: CreateRef, body: Uint8Array): Promise<CreateResult> {
    const target = expectTarget(targetOf(ref, 'create'))
    const copy = copyBody(target.kind, body, target.maxBytes)
    const rule = await bodyGateRule(target, copy)
    if (rule !== null) refuseRule(target.kind, 'body-gate', rule)
    const outcome = await upload(target, copy, 'false')
    if (outcome.kind !== 'duplicate') return outcome
    if (target.kind !== 'approval') return { kind: 'duplicate', stored: 'unchecked' }
    const stored = await readTarget(target)
    if (stored.kind !== 'found') return { kind: 'duplicate', stored: 'unchecked' }
    const same = stored.sha256 === (await sha256Hex(copy))
    return { kind: 'duplicate', stored: same ? 'identical' : 'different' }
  }

  async function writePointer(mode: PointerMode, body: Uint8Array): Promise<PointerResult> {
    const target = expectTarget(pointerTarget(mode))
    const copy = copyBody('pointer', body, target.maxBytes)
    const rule = await bodyGateRule(target, copy)
    if (rule !== null) refuseRule('pointer', 'body-gate', rule)
    const outcome = await upload(target, copy, 'true')
    if (outcome.kind === 'created') return { kind: 'written' }
    if (outcome.kind === 'duplicate') return { kind: 'failed', status: 409, code: 'duplicate' }
    return outcome
  }

  async function readMaster(ref: MasterReadRef): Promise<ReadResult> {
    return readTarget(expectTarget(targetOf(ref, 'read')))
  }

  async function listPage(
    url: URL,
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
      'listing',
      'POST',
      url,
      { 'content-type': 'application/json', 'accept-encoding': 'identity' },
      body,
    )
    if (exchange.kind === 'network') return { ok: false, failure: networkFailure(exchange) }
    const parsedBody = bodyOf(exchange)
    if (exchange.status < 200 || exchange.status >= 300) {
      return { ok: false, failure: scrubFailure(classifyFailure(exchange.status, parsedBody)) }
    }
    const page = ListedPage.safeParse(parsedBody)
    if (!page.success) {
      return {
        ok: false,
        failure: { kind: 'failed', status: exchange.status, code: 'unreadable-response' },
      }
    }
    return { ok: true, entries: page.data }
  }

  async function listContent(folder: string): Promise<ListResult> {
    if (typeof folder !== 'string' || !isFolderPrefix(folder))
      refuseRule('listing', 'field', 'folder')
    const url = new URL(LIST_ROUTE, origin)
    const checked = recheckUrl(url, origin, LIST_ROUTE)
    if (!checked.ok) refuse('listing', checked.refusal)
    const objects: StoredObject[] = []
    const pending: { folder: string; depth: number }[] = [{ folder, depth: 0 }]
    let entriesSeen = 0 // files and folders, which bounds the number of requests too
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (next.depth > MAX_LIST_DEPTH) {
        return { kind: 'failed', status: null, code: 'list-depth-exceeded' }
      }
      for (let offset = 0; ; offset += pageSize) {
        const page = await listPage(url, next.folder, offset)
        if (!page.ok) return page.failure
        entriesSeen += page.entries.length
        if (entriesSeen > MAX_LIST_ENTRIES) {
          return { kind: 'failed', status: null, code: 'list-size-exceeded' }
        }
        for (const entry of page.entries) {
          const path = `${next.folder}${entry.name}`
          // A server-chosen name is never followed somewhere else (CRIT-16).
          if (entry.name.includes('/') || !isSafeStoragePath(path)) {
            return { kind: 'failed', status: null, code: 'unsafe-name' }
          }
          if (entry.id === null) pending.push({ folder: `${path}/`, depth: next.depth + 1 })
          else objects.push(toStoredObject(path, entry))
        }
        if (page.entries.length < pageSize) break
      }
    }
    objects.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return { kind: 'listed', objects }
  }

  return { create, writePointer, readMaster, readContent, listContent }
}
