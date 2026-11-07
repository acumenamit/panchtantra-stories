import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BuildInfo } from '../../src/core/content/build-info'
import {
  buildInfoUrl,
  readBuildInfo,
  verifyPublish,
  VERIFY_INTERVAL_MS,
  type VerifyOptions,
} from './verify'

const START = Date.UTC(2026, 10, 7, 10, 0, 0)
const COMMIT = '1ab6342c0ffee1ab6342c0ffee1ab6342c0ffee0'
const BUILT_AT = '2026-11-07T09:58:00.000Z'

type Handler = (req: IncomingMessage, res: ServerResponse) => void
interface SeenRequest {
  readonly path: string
  readonly query: string
  readonly headers: IncomingHttpHeaders
}

let server: Server
let siteUrl: URL
let queue: Handler[]
let seen: SeenRequest[]
let logs: string[]
let sleeps: number[]
let clock: number

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    seen.push({ path: url.pathname, query: url.search, headers: req.headers })
    const handler = queue.length > 1 ? queue.shift() : queue[0]
    ;(handler ?? status(404))(req, res)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  siteUrl = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((done) => server.close(() => done()))
})

beforeEach(() => {
  queue = []
  seen = []
  logs = []
  sleeps = []
  clock = START
})

function buildInfo(seq: number): BuildInfo {
  return BuildInfo.parse({
    schemaVersion: '1.0',
    mode: 'production',
    seq,
    pointerPath: 'catalogue/production.json',
    snapshotPath: `catalogue/snapshots/${seq}.json`,
    snapshotSha256: 'a'.repeat(64),
    featuredStoryId: null,
    stories: [],
    excluded: [],
    appVersion: COMMIT,
    deploymentId: `dpl_seq${seq}`,
    deploymentUrl: `storyboard-seq${seq}.vercel.app`,
    builtAt: BUILT_AT,
    fetches: [
      {
        path: 'catalogue/production.json',
        status: 200,
        cfCacheStatus: 'MISS',
        age: 0,
        pop: 'BOM',
        sha256: 'b'.repeat(12),
        ms: 40,
      },
    ],
  })
}

function body(text: string, type = 'application/json; charset=utf-8', code = 200): Handler {
  return (_req, res) => {
    res.writeHead(code, { 'content-type': type })
    res.end(text)
  }
}

const live = (seq: number) => body(JSON.stringify(buildInfo(seq)))
const status =
  (code: number, headers: Record<string, string> = {}): Handler =>
  (_req, res) => {
    res.writeHead(code, { 'content-type': 'text/html', ...headers })
    res.end('<html></html>')
  }

const options = (expectedSeq: number, extra: Partial<VerifyOptions> = {}): VerifyOptions => ({
  siteUrl,
  expectedSeq,
  now: () => clock,
  sleep: async (ms) => {
    sleeps.push(ms)
    clock += ms
  },
  log: (line) => void logs.push(line),
  ...extra,
})

const liveLine = (seq: number) =>
  `verify: seq=${seq} deployment=dpl_seq${seq} app=${COMMIT} builtAt=${BUILT_AT} ms=0`

describe('buildInfoUrl', () => {
  it('is <origin>/build-info.json?verify=<ms>', () => {
    expect(buildInfoUrl(new URL('https://storyboard-test.vercel.app/'), 1234).href).toBe(
      'https://storyboard-test.vercel.app/build-info.json?verify=1234',
    )
  })

  it('refuses plain http except on loopback', () => {
    expect(() => buildInfoUrl(new URL('http://storyboard-test.vercel.app'), 1)).toThrow(
      'site URL must use https',
    )
  })
})

describe('verifyPublish', () => {
  it('polls every 5 s with no-store and a fresh verify value until the expected seq is live', async () => {
    queue = [status(404), live(2), live(3)]
    const outcome = await verifyPublish(options(3))
    expect(outcome).toEqual({
      kind: 'live',
      expectedSeq: 3,
      samples: 3,
      regressions: [],
      sample: {
        kind: 'live',
        at: START + 2 * VERIFY_INTERVAL_MS,
        ms: 0,
        seq: 3,
        deploymentId: 'dpl_seq3',
        appVersion: COMMIT,
        deploymentUrl: 'storyboard-seq3.vercel.app',
        builtAt: BUILT_AT,
      },
    })
    expect(sleeps).toEqual([5_000, 5_000])
    expect(seen.map((r) => [r.path, r.query])).toEqual([
      ['/build-info.json', `?verify=${START}`],
      ['/build-info.json', `?verify=${START + 5_000}`],
      ['/build-info.json', `?verify=${START + 10_000}`],
    ])
    // cache: 'no-store' makes fetch send these on the wire.
    expect(seen.every((r) => r.headers['cache-control'] === 'no-cache')).toBe(true)
    expect(seen.every((r) => r.headers.pragma === 'no-cache')).toBe(true)
    expect(logs).toEqual([
      'verify: unavailable status=404 reason=status is not 200 ms=0',
      liveLine(2),
      liveLine(3),
      'verify: live seq=3',
    ])
  })

  it('reports superseded when a later seq is already live', async () => {
    queue = [live(4)]
    const outcome = await verifyPublish(options(3))
    expect(outcome.kind).toBe('superseded')
    expect(outcome).toMatchObject({ expectedSeq: 3, samples: 1, sample: { seq: 4 } })
    expect(sleeps).toEqual([])
    expect(logs.at(-1)).toBe('verify: superseded expected=3 live=4')
  })

  it('records every time the seq goes backwards, across unavailable samples', async () => {
    queue = [live(3), status(500), live(2), live(4)]
    const outcome = await verifyPublish(options(4))
    expect(outcome).toMatchObject({
      kind: 'live',
      samples: 4,
      regressions: [{ from: 3, to: 2, at: START + 10_000 }],
    })
    expect(logs).toContain('verify: seq went backwards from 3 to 2')
  })

  it('times out at the deadline and reports the last seq', async () => {
    queue = [live(1)]
    const outcome = await verifyPublish(options(2, { deadlineMs: 12_000 }))
    expect(outcome).toEqual({
      kind: 'timeout',
      expectedSeq: 2,
      samples: 3,
      regressions: [],
      lastSeq: 1,
    })
    expect(sleeps).toEqual([5_000, 5_000])
    expect(logs.at(-1)).toBe('verify: timed out after 3 samples; last seq=1')
  })

  it('refuses an invalid expected seq and a non-https site', async () => {
    for (const expectedSeq of [0, -1, 1.5, Number.NaN]) {
      await expect(verifyPublish(options(expectedSeq))).rejects.toThrow(
        new RangeError('expectedSeq must be an integer >= 1'),
      )
    }
    await expect(
      verifyPublish(options(1, { siteUrl: new URL('http://storyboard-test.vercel.app') })),
    ).rejects.toThrow('site URL must use https')
    expect(seen).toEqual([])
  })
})

describe('readBuildInfo', () => {
  const read = () => readBuildInfo(siteUrl, { now: () => clock })

  it('accepts application/json with a charset parameter', async () => {
    queue = [live(7)]
    expect(await read()).toMatchObject({ kind: 'live', seq: 7, at: START })
  })

  it('does not follow a redirect (for example a login page)', async () => {
    queue = [status(307, { location: 'https://vercel.com/sso-api?x=1' })]
    expect(await read()).toEqual({
      kind: 'unavailable',
      at: START,
      ms: 0,
      status: 307,
      reason: 'status is not 200',
    })
    expect(seen).toHaveLength(1)
  })

  it('reports a wrong content-type, invalid JSON, a schema failure and an oversized body', async () => {
    const cases: [Handler, string][] = [
      [
        body(JSON.stringify(buildInfo(1)), 'text/html'),
        'content-type must be application/json, got text/html',
      ],
      [body('{"seq":', 'application/json'), 'build-info failed strict parse'],
      [body(JSON.stringify({ ...buildInfo(1), extra: true })), 'build-info failed strict parse'],
      [body(JSON.stringify({ ...buildInfo(1), seq: 0 })), 'build-info failed strict parse'],
      [body(`"${'x'.repeat(1024 * 1024 + 1)}"`), 'body unreadable or larger than 1 MiB'],
    ]
    for (const [handler, reason] of cases) {
      queue = [handler]
      expect(await read()).toEqual({ kind: 'unavailable', at: START, ms: 0, status: 200, reason })
    }
  })

  it('reports a network error by name and cause only', async () => {
    const sample = await readBuildInfo(siteUrl, {
      now: () => clock,
      fetchImpl: async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('x'), { code: 'ENOTFOUND' }),
        })
      },
    })
    expect(sample).toEqual({
      kind: 'unavailable',
      at: START,
      ms: 0,
      status: null,
      reason: 'network TypeError (ENOTFOUND)',
    })
  })

  it('reports a dropped connection as unavailable', async () => {
    queue = [(req) => req.socket.destroy()]
    expect(await read()).toMatchObject({ kind: 'unavailable', status: null })
  })
})
