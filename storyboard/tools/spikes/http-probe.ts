// P0-13 THROWAWAY: removed at cleanup
// One timed GET or HEAD, described as one NDJSON-ready record (plan file 16): status, latency, bytes,
// sha256, the cache headers, cf-cache-status, cf-ray, age, etag, x-vercel-* and every raw header.
// - The body is hashed while it streams and then dropped; it is never saved.
// - Redirects are not followed, so a login redirect is seen as it is.
// - A probe never carries credentials: apikey, authorization and cookie headers are refused.
// - Location values lose their query and fragment, and Set-Cookie values keep only the cookie name.
import { createHash } from 'node:crypto'
import { popFromCfRay } from '../../scripts/load-content'
import { checkServiceUrl, describeNetworkError, mediaType } from '../publisher/http'

export type ProbeMethod = 'GET' | 'HEAD'

export const DEFAULT_PROBE_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024

const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  'apikey',
  'authorization',
  'cookie',
  'proxy-authorization',
])

export interface ProbeOptions {
  readonly method?: ProbeMethod
  /** Extra request headers such as range or user-agent. */
  readonly headers?: Readonly<Record<string, string>>
  readonly label?: string
  readonly timeoutMs?: number
  readonly maxBodyBytes?: number
  readonly fetchImpl?: typeof fetch
  /** Milliseconds for latency (performance.now() by default). */
  readonly clock?: () => number
  readonly now?: () => Date
}

export interface ProbeRecord {
  readonly label: string | null
  readonly at: string
  readonly method: ProbeMethod
  readonly url: string
  readonly requestHeaders: Readonly<Record<string, string>>
  /** null: network error or timeout (see error). */
  readonly status: number | null
  readonly error: string | null
  /** Request start to response headers. */
  readonly headersMs: number
  /** Request start to the end of the body. */
  readonly totalMs: number
  /** Body bytes read; null for HEAD, a network error or a body over the cap. */
  readonly bytes: number | null
  readonly sha256: string | null
  readonly truncated: boolean
  readonly contentType: string | null
  readonly mediaType: string | null
  readonly contentLength: number | null
  readonly contentRange: string | null
  readonly acceptRanges: string | null
  readonly cacheControl: string | null
  readonly cfCacheStatus: string | null
  readonly cfRay: string | null
  readonly pop: string | null
  readonly age: number | null
  readonly etag: string | null
  readonly lastModified: string | null
  readonly location: string | null
  readonly vercel: Readonly<Record<string, string>>
  readonly headers: readonly (readonly [name: string, value: string])[]
}

/** Throws a TypeError naming the header when a request header would carry a credential. */
export function assertNoCredentialHeaders(headers: Readonly<Record<string, string>>): void {
  for (const name of Object.keys(headers)) {
    if (CREDENTIAL_HEADERS.has(name.toLowerCase())) {
      throw new TypeError(`http-probe never sends a ${name.toLowerCase()} header`)
    }
  }
}

/** scheme://host/path only: the query and fragment of a redirect target are dropped. */
export function sanitizeLocation(value: string, base: string): string {
  try {
    const url = new URL(value, base)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '[unparseable location]'
  }
}

/** "name=value; Path=/" becomes "name=[redacted]". */
export function redactSetCookie(value: string): string {
  const name = value.split('=')[0]?.trim() ?? ''
  return `${name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'cookie'}=[redacted]`
}

/** Every response header, with Location and Set-Cookie made safe to keep. */
export function safeHeaderList(headers: Headers, base: string): [string, string][] {
  const list: [string, string][] = []
  for (const [name, value] of headers) {
    if (name === 'set-cookie') continue
    list.push([name, name === 'location' ? sanitizeLocation(value, base) : value])
  }
  for (const cookie of headers.getSetCookie()) list.push(['set-cookie', redactSetCookie(cookie)])
  return list
}

function header(headers: Headers, name: string): string | null {
  const value = headers.get(name)
  return value === null ? null : value.slice(0, 512)
}

function integerHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name)?.trim() ?? ''
  return /^\d{1,15}$/.test(value) ? Number(value) : null
}

function vercelHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of headers) if (name.startsWith('x-vercel-')) out[name] = value
  return out
}

interface BodyDigest {
  readonly bytes: number | null
  readonly sha256: string | null
  readonly truncated: boolean
}

async function digestBody(response: Response, maxBytes: number): Promise<BodyDigest> {
  if (!response.body)
    return { bytes: 0, sha256: createHash('sha256').digest('hex'), truncated: false }
  const hash = createHash('sha256')
  const reader = response.body.getReader()
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { bytes: null, sha256: null, truncated: true }
    }
    hash.update(value)
  }
  return { bytes: total, sha256: hash.digest('hex'), truncated: false }
}

/** One request. Never throws for a network or HTTP problem; throws only for a bad call. */
export async function probe(url: URL, options: ProbeOptions = {}): Promise<ProbeRecord> {
  checkServiceUrl(url, 'probe URL')
  const extraHeaders = options.headers ?? {}
  assertNoCredentialHeaders(extraHeaders)
  const method = options.method ?? 'GET'
  const clock = options.clock ?? (() => performance.now())
  const now = options.now ?? (() => new Date())
  const requestHeaders = { 'accept-encoding': 'identity', ...extraHeaders }
  const at = now().toISOString()
  const started = clock()
  const elapsed = () => Math.max(0, Math.round(clock() - started))
  const base = {
    label: options.label ?? null,
    at,
    method,
    url: url.href,
    requestHeaders,
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method,
      headers: requestHeaders,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS),
    })
  } catch (error) {
    const ms = elapsed()
    return {
      ...base,
      ...emptyResponseFields(),
      status: null,
      error: describeNetworkError(error),
      headersMs: ms,
      totalMs: ms,
    }
  }
  const headersMs = elapsed()
  let digest: BodyDigest
  let error: string | null = null
  if (method === 'HEAD') {
    await response.body?.cancel()
    digest = { bytes: null, sha256: null, truncated: false }
  } else {
    try {
      digest = await digestBody(response, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
    } catch (bodyError) {
      digest = { bytes: null, sha256: null, truncated: false }
      error = `body ${describeNetworkError(bodyError)}`
    }
  }
  const { headers } = response
  const contentType = header(headers, 'content-type')
  const cfRay = header(headers, 'cf-ray')
  const location = header(headers, 'location')
  return {
    ...base,
    status: response.status,
    error,
    headersMs,
    totalMs: elapsed(),
    ...digest,
    contentType,
    mediaType: contentType === null ? null : mediaType(contentType),
    contentLength: integerHeader(headers, 'content-length'),
    contentRange: header(headers, 'content-range'),
    acceptRanges: header(headers, 'accept-ranges'),
    cacheControl: header(headers, 'cache-control'),
    cfCacheStatus: header(headers, 'cf-cache-status'),
    cfRay,
    pop: popFromCfRay(cfRay),
    age: integerHeader(headers, 'age'),
    etag: header(headers, 'etag'),
    lastModified: header(headers, 'last-modified'),
    location: location === null ? null : sanitizeLocation(location, url.href),
    vercel: vercelHeaders(headers),
    headers: safeHeaderList(headers, url.href),
  }
}

function emptyResponseFields() {
  return {
    bytes: null,
    sha256: null,
    truncated: false,
    contentType: null,
    mediaType: null,
    contentLength: null,
    contentRange: null,
    acceptRanges: null,
    cacheControl: null,
    cfCacheStatus: null,
    cfRay: null,
    pop: null,
    age: null,
    etag: null,
    lastModified: null,
    location: null,
    vercel: {},
    headers: [],
  } as const
}

/** A short console line: "GET 206 bytes=2 sha=1a2b3c4d5e6f cf=HIT age=12 pop=BOM 140ms /path?q". */
export function describeProbe(record: ProbeRecord): string {
  const url = new URL(record.url)
  const status = record.status ?? `error(${record.error ?? 'unknown'})`
  const parts = [
    record.label ?? '',
    record.method,
    String(status),
    record.bytes === null ? '' : `bytes=${record.bytes}`,
    record.sha256 === null ? '' : `sha=${record.sha256.slice(0, 12)}`,
    `cf=${record.cfCacheStatus ?? '-'}`,
    `age=${record.age ?? '-'}`,
    `pop=${record.pop ?? '-'}`,
    record.location === null ? '' : `location=${record.location}`,
    `${record.totalMs}ms`,
    `${url.pathname}${url.search}`,
  ]
  return parts.filter((part) => part !== '').join(' ')
}
