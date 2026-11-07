// P0-13 THROWAWAY: removed at cleanup
import { createHash } from 'node:crypto'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertNoCredentialHeaders,
  describeProbe,
  probe,
  redactSetCookie,
  sanitizeLocation,
} from './http-probe'

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let origin: string
let handler: Handler
let seen: { method: string; url: string; headers: IncomingHttpHeaders }[]

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
    handler(req, res)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((done) => server.close(() => done()))
})

beforeEach(() => {
  seen = []
  handler = (_req, res) => res.end()
})

const BODY = new TextEncoder().encode('synthetic body bytes')
const BODY_SHA = createHash('sha256').update(BODY).digest('hex')

const CDN_HEADERS = {
  'content-type': 'audio/mpeg; charset=binary',
  'accept-ranges': 'bytes',
  'cache-control': 'max-age=3600',
  'cf-cache-status': 'HIT',
  'cf-ray': '8f1a2b3c4d5e6f70-BOM',
  age: '42',
  etag: '"abc"',
  'last-modified': 'Sat, 07 Nov 2026 10:00:00 GMT',
  'x-vercel-id': 'bom1::abcde',
  'x-vercel-cache': 'MISS',
}

describe('probe', () => {
  it('GET: status, timing, bytes, sha256 and every header; the body is only hashed', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { ...CDN_HEADERS, 'content-length': BODY.length })
      res.end(BODY)
    }
    let tick = 0
    const record = await probe(new URL(`${origin}/clip.mp3?cacheNonce=1`), {
      label: 'test',
      clock: () => (tick += 10),
      now: () => new Date('2026-11-07T10:00:00.000Z'),
    })
    expect(record).toMatchObject({
      label: 'test',
      at: '2026-11-07T10:00:00.000Z',
      method: 'GET',
      url: `${origin}/clip.mp3?cacheNonce=1`,
      status: 200,
      error: null,
      bytes: BODY.length,
      sha256: BODY_SHA,
      truncated: false,
      contentType: 'audio/mpeg; charset=binary',
      mediaType: 'audio/mpeg',
      contentLength: BODY.length,
      acceptRanges: 'bytes',
      cacheControl: 'max-age=3600',
      cfCacheStatus: 'HIT',
      cfRay: '8f1a2b3c4d5e6f70-BOM',
      pop: 'BOM',
      age: 42,
      etag: '"abc"',
      lastModified: 'Sat, 07 Nov 2026 10:00:00 GMT',
      location: null,
      vercel: { 'x-vercel-id': 'bom1::abcde', 'x-vercel-cache': 'MISS' },
    })
    expect(record.headersMs).toBeGreaterThan(0)
    expect(record.totalMs).toBeGreaterThan(record.headersMs)
    expect(record.headers).toContainEqual(['cf-cache-status', 'HIT'])
    expect(seen[0]?.headers['accept-encoding']).toBe('identity')
  })

  it('HEAD reads no body', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { ...CDN_HEADERS, 'content-length': 1096653 })
      res.end()
    }
    const record = await probe(new URL(`${origin}/clip.mp3`), { method: 'HEAD' })
    expect(seen[0]?.method).toBe('HEAD')
    expect(record).toMatchObject({ status: 200, bytes: null, sha256: null, contentLength: 1096653 })
  })

  it('sends a Range header and reports the 206 answer', async () => {
    handler = (_req, res) => {
      res.writeHead(206, { 'content-range': 'bytes 0-1/1096653', 'content-length': 2 })
      res.end(Buffer.from([0xff, 0xfb]))
    }
    const record = await probe(new URL(`${origin}/clip.mp3`), {
      headers: { range: 'bytes=0-1', 'user-agent': 'AppleCoreMedia/1.0.0' },
    })
    expect(record).toMatchObject({ status: 206, bytes: 2, contentRange: 'bytes 0-1/1096653' })
    expect(record.requestHeaders).toEqual({
      'accept-encoding': 'identity',
      range: 'bytes=0-1',
      'user-agent': 'AppleCoreMedia/1.0.0',
    })
    expect(seen[0]?.headers['user-agent']).toBe('AppleCoreMedia/1.0.0')
    expect(seen[0]?.headers.range).toBe('bytes=0-1')
  })

  it('does not follow a redirect and drops the query of its target; cookies keep only their name', async () => {
    handler = (_req, res) => {
      res.writeHead(307, [
        ['location', 'https://vercel.com/sso-api?url=https%3A%2F%2Fx.vercel.app&nonce=secretish'],
        ['set-cookie', '_vercel_sso_nonce=abc123; Path=/; HttpOnly'],
      ])
      res.end()
    }
    const record = await probe(new URL(`${origin}/build-info.json`))
    expect(seen).toHaveLength(1)
    expect(record.status).toBe(307)
    expect(record.location).toBe('https://vercel.com/sso-api')
    expect(record.headers).toContainEqual(['location', 'https://vercel.com/sso-api'])
    expect(record.headers).toContainEqual(['set-cookie', '_vercel_sso_nonce=[redacted]'])
    expect(JSON.stringify(record)).not.toContain('abc123')
    expect(JSON.stringify(record)).not.toContain('secretish')
  })

  it('a dropped connection or a timeout is a record with an error, never a throw', async () => {
    handler = (req) => req.socket.destroy()
    const dropped = await probe(new URL(`${origin}/x`))
    expect(dropped).toMatchObject({ status: null, bytes: null, sha256: null, headers: [] })
    expect(dropped.error).toMatch(/^TypeError/)

    handler = () => undefined
    const slow = await probe(new URL(`${origin}/x`), { timeoutMs: 50 })
    expect(slow).toMatchObject({ status: null, error: 'TimeoutError' })
  })

  it('a body over the cap is cut off and not hashed', async () => {
    handler = (_req, res) => res.end(Buffer.alloc(2048))
    const record = await probe(new URL(`${origin}/big`), { maxBodyBytes: 1024 })
    expect(record).toMatchObject({ status: 200, bytes: null, sha256: null, truncated: true })
  })

  it('refuses credential headers and non-https URLs before sending anything', async () => {
    for (const name of ['apikey', 'Authorization', 'cookie', 'Proxy-Authorization']) {
      await expect(probe(new URL(`${origin}/x`), { headers: { [name]: 'x' } })).rejects.toThrow(
        TypeError,
      )
    }
    await expect(probe(new URL('http://example.com/x'))).rejects.toThrow('must use https')
    expect(seen).toEqual([])
    expect(() => assertNoCredentialHeaders({ range: 'bytes=0-1' })).not.toThrow()
  })
})

describe('helpers', () => {
  it('sanitizeLocation keeps scheme, host and path, resolving relative targets', () => {
    expect(sanitizeLocation('/login?next=/a#x', 'https://x.vercel.app/build-info.json')).toBe(
      'https://x.vercel.app/login',
    )
    expect(sanitizeLocation('http://[bad', 'https://x.vercel.app/')).toBe('[unparseable location]')
  })

  it('redactSetCookie keeps a clean cookie name only', () => {
    expect(redactSetCookie('a=b; Path=/')).toBe('a=[redacted]')
    expect(redactSetCookie('=b')).toBe('cookie=[redacted]')
  })

  it('describeProbe makes one short line', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'cf-cache-status': 'MISS', 'cf-ray': 'abc-BOM', age: '0' })
      res.end(BODY)
    }
    const record = await probe(new URL(`${origin}/a.json?cacheNonce=5`), { label: 'r1' })
    expect(describeProbe(record)).toMatch(
      new RegExp(
        `^r1 GET 200 bytes=${BODY.length} sha=${BODY_SHA.slice(0, 12)} cf=MISS age=0 pop=BOM \\d+ms /a\\.json\\?cacheNonce=5$`,
      ),
    )
  })
})
