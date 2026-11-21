// Content-only deleter (P1-8b, owner item 1 option 1; design p1-step13-design.md §3.2, row A31).
// The remove() that the publisher's Storage client held until Step 13, moved here unchanged with
// its guards and its tests, so the client itself has no delete route. It is reached by no entry
// (storage-fence.test.ts fence F4) until Step 15b reviews its first caller, limits it to the
// content package and media classes on this PC only and applies the client's construction rules
// (§1.3).
// - The secret key goes on the `apikey` header only. `bearerFallback` (off by default) also sends
//   `Authorization: Bearer <key>`; it is used only with the owner's OK.
// - Guards, set by the caller, are checked before any request: an allowed bucket list, write
//   prefixes and safe paths. The protected bucket is never deleted from, whatever the caller
//   allows. A refusal throws StorageRefusedError and sends nothing.
// - Results are typed. Errors and results never contain the key or any header.
import { z } from 'zod'
import { isSafeStoragePath } from '../../src/core/content/gates'
import type { Secret } from './env'
import { checkServiceUrl, describeNetworkError, parseJsonBytes, readCapped } from './http'
import {
  classifyFailure,
  DEFAULT_TIMEOUT_MS,
  isFolderPrefix,
  repeatsSecretRun,
  StorageRefusedError,
  type StorageFailure,
} from './storage'

/** Buckets this client never writes to or deletes from. */
export const PROTECTED_BUCKETS: readonly string[] = ['masters']

/** Our own bound per remove call, so one mistaken call cannot delete a large set; callers chunk. */
export const MAX_REMOVE_PATHS = 100
const MAX_RESPONSE_BYTES = 1024 * 1024

export interface StorageGuards {
  /** Buckets any call may name. PROTECTED_BUCKETS stay read-only even when listed here. */
  readonly allowedBuckets: readonly string[]
  /** Uploads and removes must sit under one of these folders, each ending with '/'. */
  readonly writePrefixes: readonly string[]
  /** The only paths an upload may overwrite (upsert). Exact paths; no patterns. */
  readonly overwritablePaths: readonly string[]
}

export interface ContentDeleterOptions {
  /** https://<ref>.supabase.co (http is accepted only on a loopback host, for tests). */
  readonly supabaseUrl: URL
  readonly secretKey: Secret
  readonly guards: StorageGuards
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
  /** Off by default; see the file header. */
  readonly bearerFallback?: boolean
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

const BUCKET_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/

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

export function createContentDeleter(options: ContentDeleterOptions): ContentDeleter {
  checkServiceUrl(options.supabaseUrl, 'supabaseUrl')
  const origin = options.supabaseUrl.origin
  const guards = checkGuards(options.guards)
  const { secretKey } = options
  if (secretKey.reveal().length < 8) throw new TypeError('secretKey is too short')
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

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

  /** The one transport: a DELETE of one route (the client's own transport has no DELETE). */
  async function send(
    path: string,
    headers: Record<string, string>,
    body: Uint8Array<ArrayBuffer> | string,
  ): Promise<Exchange> {
    try {
      const response = await fetchImpl(new URL(path, origin), {
        method: 'DELETE',
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

  async function remove(bucket: string, paths: readonly string[]): Promise<RemoveResult> {
    checkBucket(bucket, 'write')
    if (paths.length === 0) refuse('remove needs at least one path')
    if (paths.length > MAX_REMOVE_PATHS) refuse(`remove takes at most ${MAX_REMOVE_PATHS} paths`)
    if (new Set(paths).size !== paths.length) refuse('remove paths must be unique')
    for (const path of paths) checkWritablePath(path)
    const exchange = await send(
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

  return { remove }
}
