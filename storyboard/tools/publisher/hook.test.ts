import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Secret } from './env'
import { hookRequestUrl, parseHookJob, triggerDeployHook, type HookOptions } from './hook'

// The two path segments after /deploy/ are what makes a hook URL a credential.
const PROJECT_SEGMENT = 'prj_fakeProject01'
const HOOK_SEGMENT = 'fakeHookSegment02'
const HOOK_PATH = `/v1/integrations/deploy/${PROJECT_SEGMENT}/${HOOK_SEGMENT}`
const CREATED_AT = Date.UTC(2026, 10, 7, 10, 0, 0, 123)

interface SeenRequest {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: IncomingHttpHeaders
  readonly body: string
}

let server: Server
let origin: string
let seen: SeenRequest[]
let answer: (req: IncomingMessage, res: ServerResponse) => void
let logs: string[]

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      seen.push({
        method: req.method ?? '',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
      })
      answer(req, res)
    })
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
  logs = []
  answer = reply(201, { job: { id: 'job_abc123', state: 'PENDING', createdAt: CREATED_AT } })
})

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
}

const trigger = (url = `${origin}${HOOK_PATH}`, extra: Partial<HookOptions> = {}) =>
  triggerDeployHook({ hookUrl: new Secret(url), log: (line) => void logs.push(line), ...extra })

function expectNoHookSecret(...texts: string[]): void {
  for (const text of texts) {
    expect(text).not.toContain(PROJECT_SEGMENT)
    expect(text).not.toContain(HOOK_SEGMENT)
  }
}

describe('hookRequestUrl', () => {
  it('adds buildCache=false through the URL API, replacing any existing value', () => {
    const plain = hookRequestUrl(new Secret(`https://api.vercel.com${HOOK_PATH}`))
    expect(plain.href).toBe(`https://api.vercel.com${HOOK_PATH}?buildCache=false`)
    const withQuery = hookRequestUrl(
      new Secret(`https://api.vercel.com${HOOK_PATH}?ref=main&buildCache=true`),
    )
    expect(withQuery.href).toBe(`https://api.vercel.com${HOOK_PATH}?ref=main&buildCache=false`)
  })

  it('refuses an invalid or non-https URL without echoing it', () => {
    expect(() => hookRequestUrl(new Secret('not a url'))).toThrow(
      new TypeError('deploy hook URL is not a valid URL'),
    )
    expect(() => hookRequestUrl(new Secret(`http://api.vercel.com${HOOK_PATH}`))).toThrow(
      new TypeError('deploy hook URL must use https'),
    )
  })
})

describe('parseHookJob', () => {
  it('reads job.id and a numeric createdAt; anything else gives null createdAt', () => {
    expect(parseHookJob(201, { job: { id: 'job_1', createdAt: CREATED_AT } })).toEqual({
      kind: 'triggered',
      status: 201,
      jobId: 'job_1',
      createdAt: CREATED_AT,
    })
    expect(parseHookJob(200, { job: { id: 'job_1', createdAt: '2026-11-07' } })).toMatchObject({
      createdAt: null,
    })
    expect(parseHookJob(200, { job: { id: 'job_1' } })).toMatchObject({ createdAt: null })
  })

  it('needs a usable job.id', () => {
    for (const body of [{}, { job: {} }, { job: { id: '' } }, { job: { id: 'a b' } }, null, []]) {
      expect(parseHookJob(200, body)).toBeNull()
    }
  })
})

describe('triggerDeployHook', () => {
  it('POSTs once to the hook with buildCache=false and no body, and logs only the job id and createdAt', async () => {
    const result = await trigger()
    expect(result).toEqual({
      kind: 'triggered',
      status: 201,
      jobId: 'job_abc123',
      createdAt: CREATED_AT,
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.path).toBe(HOOK_PATH)
    expect(seen[0]?.query.toString()).toBe('buildCache=false')
    expect(seen[0]?.body).toBe('')
    expect(logs).toEqual(['hook: job=job_abc123 createdAt=2026-11-07T10:00:00.123Z'])
  })

  it('accepts any 2xx that carries job.id', async () => {
    for (const status of [200, 201, 202]) {
      answer = reply(status, { job: { id: `job_${status}` } })
      expect(await trigger()).toEqual({
        kind: 'triggered',
        status,
        jobId: `job_${status}`,
        createdAt: null,
      })
    }
    expect(logs).toEqual([
      'hook: job=job_200 createdAt=-',
      'hook: job=job_201 createdAt=-',
      'hook: job=job_202 createdAt=-',
    ])
  })

  it('fails on a 2xx without job.id, on non-JSON and on an error status, without retrying', async () => {
    const cases: [ReturnType<typeof reply>, unknown][] = [
      [
        reply(200, { ok: true }),
        { kind: 'failed', status: 200, reason: 'response has no usable job.id' },
      ],
      [
        reply(200, 'not json'),
        { kind: 'failed', status: 200, reason: 'response has no usable job.id' },
      ],
      [
        reply(404, { error: { code: 'not_found' } }),
        { kind: 'failed', status: 404, reason: 'non-2xx status' },
      ],
      [
        reply(429, { error: 'rate limited' }),
        { kind: 'failed', status: 429, reason: 'non-2xx status' },
      ],
      [reply(500, 'oops'), { kind: 'failed', status: 500, reason: 'non-2xx status' }],
    ]
    for (const [handler, expected] of cases) {
      seen = []
      answer = handler
      expect(await trigger()).toEqual(expected)
      expect(seen).toHaveLength(1)
    }
  })

  it('does not follow a redirect', async () => {
    answer = reply(307, '', { location: `${origin}/elsewhere` })
    expect(await trigger()).toEqual({ kind: 'failed', status: 307, reason: 'non-2xx status' })
    expect(seen.map((r) => r.path)).toEqual([HOOK_PATH])
  })

  it('fails on a body over 64 KiB', async () => {
    answer = reply(200, { job: { id: 'job_big' }, padding: 'x'.repeat(70_000) })
    expect(await trigger()).toEqual({
      kind: 'failed',
      status: 200,
      reason: 'response body unreadable or too large',
    })
  })

  it('reports a network error by name and cause only', async () => {
    const result = await trigger(`${origin}${HOOK_PATH}`, {
      fetchImpl: async (input) => {
        throw new TypeError(`fetch failed for ${String(input)}`, {
          cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }),
        })
      },
    })
    expect(result).toEqual({
      kind: 'failed',
      status: null,
      reason: 'network TypeError (ECONNRESET)',
    })
    expect(logs).toEqual(['hook: failed status=- reason=network TypeError (ECONNRESET)'])
  })

  it('never puts the hook URL in a result or a log line', async () => {
    const outcomes = [await trigger()]
    answer = reply(500, `echo ${HOOK_PATH}`)
    outcomes.push(await trigger())
    answer = (req) => req.socket.destroy()
    outcomes.push(await trigger())
    expectNoHookSecret(JSON.stringify(outcomes), ...logs)
  })
})
