// Content-only deleter (P1-8b, owner item 1 option 1; design p1-step13-design.md §3.2, row A31),
// hardened for its first caller at Step 15b (design p1-step15b-design.md §3.13, D15B-13; row A13).
// The remove() that the publisher's Storage client held until Step 13 lives here, so the client
// itself has no delete route. Only the publisher CLI reaches this module (storage-fence.test.ts
// fence F4), and only for a takedown on this PC.
// - Construction applies the Storage client's rules in the client's order (storage.ts): the options
//   are read once from own data properties (option-keys, option-accessor); the URL is re-parsed from
//   its own internal state before any check, and every check and the request origin read only the
//   re-parsed URL (url-origin); a fetchImpl only on loopback (fetch-impl); a Secret of at least 8
//   characters, secret-shaped on https (key-short, key-shape); then the one story id this deleter
//   serves (story-id) and the timeout (timeout). A refusal is a TypeError with the fixed text
//   `refused: deleter option <rule>`. The two bounds are private copies of the client's (T15B-9 pins
//   them equal by parity).
// - remove() deletes only from the content bucket (masters refused first), 1 to 100 unique paths
//   copied at entry, each a package or media object of the bound story; the route is built only
//   after the bucket check and re-checked. A refusal throws StorageRefusedError with the fixed text
//   `refused: delete <stage> <rule>` (isStorageRefusal accepts it) and sends nothing. Pointers,
//   snapshots, masters and other stories are unreachable by construction.
// - The secret key goes on the `apikey` header only. Results are typed; errors and results never
//   carry the key, a header, a path or server message text (a failure code repeating any run of the
//   key becomes "unknown").
import { z } from 'zod'
import { isSafeStoragePath } from '../../src/core/content/gates'
import { StoryId } from '../../src/core/package/v1'
import { isSecretKeyShape, Secret } from './env'
import { describeNetworkError, parseJsonBytes, readCapped } from './http'
import {
  classifyFailure,
  DEFAULT_TIMEOUT_MS,
  repeatsSecretRun,
  StorageRefusedError,
  type StorageFailure,
} from './storage'
import { classOfPath, recheckUrl } from './storage-layout'

/** Buckets this deleter never deletes from. */
export const PROTECTED_BUCKETS: readonly string[] = ['masters']

/** Our own bound per remove call, so one mistaken call cannot delete a large set; callers chunk. */
export const MAX_REMOVE_PATHS = 100
const MAX_RESPONSE_BYTES = 1024 * 1024
/** Private copies of storage.ts's two bounds (not exported there); T15B-9 pins them equal. */
const MIN_KEY_LENGTH = 8
const MAX_TIMEOUT_MS = 600_000
/** The one bucket remove() serves. */
const CONTENT_BUCKET = 'content'

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])
const SUPABASE_HOST = /^[a-z0-9]{20}\.supabase\.co$/
const OPTION_KEYS: ReadonlySet<string> = new Set([
  'supabaseUrl',
  'secretKey',
  'storyId',
  'fetchImpl',
  'timeoutMs',
])

export interface ContentDeleterOptions {
  /** https://<20 lowercase alnum>.supabase.co, or http on a loopback host with a port (tests). */
  readonly supabaseUrl: URL
  readonly secretKey: Secret
  /** The one story whose package and media objects this deleter may remove. */
  readonly storyId: string
  /** Accepted only with a loopback origin. */
  readonly fetchImpl?: typeof fetch
  /** 1 to 600,000 ms; covers headers and body. */
  readonly timeoutMs?: number
}

export type RemoveResult =
  | { readonly kind: 'removed'; readonly paths: readonly string[] }
  | {
      readonly kind: 'count-mismatch'
      readonly removed: readonly string[]
      readonly notRemoved: readonly string[]
      readonly unexpected: readonly string[]
    }
  | StorageFailure

export interface ContentDeleter {
  /** Deletes exact paths and checks that Storage reports each one deleted. */
  remove(bucket: string, paths: readonly string[]): Promise<RemoveResult>
}

// ---- pure helpers ----

export function isUnderPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path.startsWith(prefix) && path.length > prefix.length)
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

// ---- construction (the client's rules, storage.ts) ----

function optionRefused(rule: string): never {
  throw new TypeError(`refused: deleter option ${rule}`)
}

/** The options read once from own data descriptors: exact known keys, no accessors. */
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

/**
 * The URL the options name, re-parsed from its own href. `URL.prototype.toString` reads the URL's
 * internal state and throws on an object that only has URL.prototype, so a subclass or a forgery
 * whose getters show an allowed host cannot steer the checks and the request apart. null when the
 * value is not a real URL.
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

/** A remove() refusal: the fixed text `refused: delete <stage> <rule>`, never a value. */
function refuse(stage: 'field' | 'class-pattern' | 'url', rule: string): never {
  throw new StorageRefusedError(`refused: delete ${stage} ${rule}`)
}

// ---- the deleter ----

export function createContentDeleter(options: ContentDeleterOptions): ContentDeleter {
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
  const storyOption = values.get('storyId')
  if (typeof storyOption !== 'string' || !StoryId.safeParse(storyOption).success) {
    optionRefused('story-id')
  }
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
  const storyId: string = storyOption
  const fetchImpl = (fetchOption as typeof fetch | undefined) ?? fetch
  const origin = supabaseUrl.origin
  const key: Secret = secretKey
  /** The story's two folders, each ending in '/' (the second story check). */
  const storyFolders: readonly string[] = [`packages/${storyId}/`, `media/${storyId}/`]

  /** A failure code that repeats any run of the key, whole or partial, becomes "unknown". */
  const safeCode = (code: string) => (repeatsSecretRun(code, key.reveal()) ? 'unknown' : code)

  const scrubFailure = (failure: StorageFailure): StorageFailure =>
    failure.kind === 'failed' ? { ...failure, code: safeCode(failure.code) } : failure

  async function remove(bucket: string, paths: readonly string[]): Promise<RemoveResult> {
    if (PROTECTED_BUCKETS.includes(bucket)) refuse('field', 'bucket')
    if (bucket !== CONTENT_BUCKET) refuse('field', 'bucket')
    if (!Array.isArray(paths)) refuse('field', 'paths')
    // The copy every later check, the body and the result use; taken before any await.
    const copy: unknown[] = [...(paths as readonly unknown[])]
    if (copy.length === 0 || copy.length > MAX_REMOVE_PATHS) refuse('field', 'path-count')
    if (!copy.every((path): path is string => typeof path === 'string')) refuse('field', 'paths')
    const wanted = copy as string[]
    if (new Set(wanted).size !== wanted.length) refuse('field', 'path-repeated')
    for (const path of wanted) {
      if (!isSafeStoragePath(path)) refuse('class-pattern', 'unsafe-path')
      const found = classOfPath(CONTENT_BUCKET, path)
      if (found === null || (found.kind !== 'package' && found.kind !== 'media')) {
        refuse('class-pattern', 'class-pattern')
      }
      if (found.fields.storyId !== storyId) refuse('class-pattern', 'story-id')
      if (!isUnderPrefix(path, storyFolders)) refuse('class-pattern', 'story-id')
    }
    // Built only after the bucket check, so the bucket here is exactly content.
    const route = `/storage/v1/object/${bucket}`
    const url = new URL(route, origin)
    if (!recheckUrl(url, origin, route).ok || url.href !== origin + route) {
      refuse('url', 'url-mismatch')
    }
    let status: number
    let body: unknown
    try {
      const response = await fetchImpl(url, {
        method: 'DELETE',
        headers: {
          apikey: key.reveal(),
          'content-type': 'application/json',
          'accept-encoding': 'identity',
        },
        body: JSON.stringify({ prefixes: wanted }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
      const bytes = await readCapped(response, MAX_RESPONSE_BYTES)
      const parsed = bytes ? parseJsonBytes(bytes) : { ok: false as const }
      status = response.status
      body = parsed.ok ? parsed.value : undefined
    } catch (error) {
      return { kind: 'failed', status: null, code: safeCode(describeNetworkError(error)) }
    }
    if (status < 200 || status >= 300) return scrubFailure(classifyFailure(status, body))
    return checkRemoved(wanted, status, body)
  }

  return { remove }
}
