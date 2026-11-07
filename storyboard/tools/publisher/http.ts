// Request helpers shared by the publisher's Storage client, deploy hook and verify step, and by the
// prebuild content loader (scripts/load-content.ts).
// Whatever these modules put in a message comes from here: status codes, error names and cause
// codes. Never a URL, a header or a response body, so a credential cannot leak through an error.

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * A service URL must use https. Plain http is accepted only on a loopback host, for local test
 * servers. Credentials and fragments are always refused. Throws a TypeError naming `label` only.
 */
export function checkServiceUrl(url: URL, label: string): void {
  const loopback = LOOPBACK_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError(`${label} must use https`)
  }
  if (url.username || url.password) throw new TypeError(`${label} must not carry credentials`)
  if (url.hash) throw new TypeError(`${label} must not carry a fragment`)
}

/** The error name and, when present, the cause code: "TypeError (ECONNREFUSED)", "TimeoutError". */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return 'network error'
  const cause = error.cause
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
      ? ` (${cause.code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32)})`
      : ''
  return `${error.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32) || 'Error'}${code}`
}

/** Reads the whole body, or returns null as soon as it grows past maxBytes. */
export async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    return null
  }
  if (!response.body) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export type JsonParse = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

/** Strict UTF-8 JSON; anything else (including an empty body) is { ok: false }. */
export function parseJsonBytes(bytes: Uint8Array): JsonParse {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch {
    return { ok: false }
  }
}

/** The media type without parameters, lowercased: "application/json; charset=utf-8" -> "application/json". */
export function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase()
}
