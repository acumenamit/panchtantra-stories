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
import type { GateMode } from '../../src/core/content/gates'
import {
  buildInfoUrl,
  describeSample,
  readBuildInfo,
  verifyPublish,
  VERIFY_INTERVAL_MS,
  type LiveSample,
  type VerifyOptions,
} from './verify'

const START = Date.UTC(2026, 10, 7, 10, 0, 0)
const COMMIT = '1ab6342c0ffee1ab6342c0ffee1ab6342c0ffee0'
const BUILT_AT = '2026-11-07T09:58:00.000Z'
const LION = 'the-lion-and-the-mouse'
const CROW = 'the-thirsty-crow'
const MONKEY = 'the-monkey-and-the-crocodile'

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

interface InfoOptions {
  readonly mode?: GateMode
  readonly storyIds?: readonly string[]
}

function buildInfo(
  seq: number,
  { mode = 'production', storyIds = [] }: InfoOptions = {},
): BuildInfo {
  return BuildInfo.parse({
    schemaVersion: '1.0',
    mode,
    seq,
    pointerPath: 'catalogue/production.json',
    snapshotPath: `catalogue/snapshots/${seq}.json`,
    snapshotSha256: 'a'.repeat(64),
    featuredStoryId: null,
    stories: storyIds.map((storyId) => ({ storyId, version: 1, packageSha256: 'c'.repeat(64) })),
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

const live = (seq: number, storyIds: readonly string[] = []) =>
  body(JSON.stringify(buildInfo(seq, { storyIds })))
const notProduction = (seq: number, mode: GateMode) =>
  body(JSON.stringify(buildInfo(seq, { mode })))
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

/** The log of `count` confirming reads of `seq`, counting from `first`. */
const confirmingLines = (seq: number, count: number, first = 1) =>
  Array.from({ length: count }, (_, i) => [
    liveLine(seq),
    `verify: confirming seq=${seq} ${first + i}/6`,
  ]).flat()

/** Only the count lines of the log: each confirming read and each reset. */
const countLines = () => logs.filter((line) => /^verify: (confirming|count reset)/.test(line))

/** Sleeps between `reads` requests at the default interval. */
const intervals = (reads: number) => Array<number>(reads - 1).fill(VERIFY_INTERVAL_MS)

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
  it('polls every 5 s with no-store and a fresh verify value until 6 reads in a row confirm', async () => {
    queue = [status(404), live(2), live(3)]
    const outcome = await verifyPublish(options(3))
    expect(outcome).toEqual({
      kind: 'live',
      expectedSeq: 3,
      samples: 8,
      regressions: [],
      sample: {
        kind: 'live',
        at: START + 7 * VERIFY_INTERVAL_MS,
        ms: 0,
        seq: 3,
        deploymentId: 'dpl_seq3',
        appVersion: COMMIT,
        deploymentUrl: 'storyboard-seq3.vercel.app',
        builtAt: BUILT_AT,
        storyIds: [],
      },
    })
    expect(sleeps).toEqual(intervals(8))
    expect(seen.map((r) => [r.path, r.query])).toEqual(
      Array.from({ length: 8 }, (_, i) => ['/build-info.json', `?verify=${START + i * 5_000}`]),
    )
    // cache: 'no-store' makes fetch send these on the wire.
    expect(seen.every((r) => r.headers['cache-control'] === 'no-cache')).toBe(true)
    expect(seen.every((r) => r.headers.pragma === 'no-cache')).toBe(true)
    expect(logs).toEqual([
      'verify: unavailable status=404 reason=status is not 200 ms=0',
      liveLine(2),
      ...confirmingLines(3, 6),
      'verify: live seq=3',
    ])
  })

  it('reports live after exactly 6 confirming reads, not 5', async () => {
    queue = [live(3)]
    const outcome = await verifyPublish(options(3))
    expect(outcome).toMatchObject({
      kind: 'live',
      samples: 6,
      sample: { seq: 3, at: START + 25_000 },
    })
    expect(seen).toHaveLength(6)
    expect(sleeps).toEqual(intervals(6))
    expect(logs).toEqual([...confirmingLines(3, 6), 'verify: live seq=3'])
  })

  it('reports superseded when a later seq is already live, after the same 6 reads', async () => {
    queue = [live(4)]
    const outcome = await verifyPublish(options(3))
    expect(outcome.kind).toBe('superseded')
    expect(outcome).toMatchObject({ expectedSeq: 3, samples: 6, sample: { seq: 4 } })
    expect(sleeps).toEqual(intervals(6))
    expect(logs).toEqual([...confirmingLines(4, 6), 'verify: superseded expected=3 live=4'])
  })

  it('reports superseded when the last confirming read is above the expected seq', async () => {
    queue = [live(3), live(3), live(4)]
    const outcome = await verifyPublish(options(3))
    expect(outcome).toMatchObject({
      kind: 'superseded',
      samples: 6,
      regressions: [],
      sample: { seq: 4, at: START + 25_000 },
    })
    expect(logs).toEqual([
      ...confirmingLines(3, 2),
      ...confirmingLines(4, 4, 3),
      'verify: superseded expected=3 live=4',
    ])
  })

  it('resets the count when a read in the middle is unavailable', async () => {
    queue = [live(3), live(3), live(3), status(503), live(3)]
    const outcome = await verifyPublish(options(3))
    expect(outcome).toMatchObject({
      kind: 'live',
      samples: 10,
      regressions: [],
      sample: { seq: 3, at: START + 45_000 },
    })
    expect(countLines()).toEqual([
      'verify: confirming seq=3 1/6',
      'verify: confirming seq=3 2/6',
      'verify: confirming seq=3 3/6',
      'verify: count reset from 3/6 to 0: build-info unavailable',
      ...[1, 2, 3, 4, 5, 6].map((k) => `verify: confirming seq=3 ${k}/6`),
    ])
  })

  it('resets the count when a read is below the expected seq', async () => {
    queue = [live(3), live(3), live(2), live(3)]
    const outcome = await verifyPublish(options(3))
    expect(outcome).toMatchObject({
      kind: 'live',
      samples: 9,
      regressions: [{ from: 3, to: 2, at: START + 10_000 }],
      sample: { seq: 3, at: START + 40_000 },
    })
    expect(countLines()).toEqual([
      'verify: confirming seq=3 1/6',
      'verify: confirming seq=3 2/6',
      'verify: count reset from 2/6 to 0: seq 2 is below expected 3',
      ...[1, 2, 3, 4, 5, 6].map((k) => `verify: confirming seq=3 ${k}/6`),
    ])
  })

  it('resets the count on a step back below the highest live seq, and records it once', async () => {
    queue = [live(3), live(4), live(3)]
    const outcome = await verifyPublish(options(3, { deadlineMs: 60_000 }))
    expect(outcome).toEqual({
      kind: 'timeout',
      expectedSeq: 3,
      samples: 13,
      regressions: [{ from: 4, to: 3, at: START + 10_000 }],
      lastSeq: 3,
    })
    expect(logs.slice(0, 7)).toEqual([
      ...confirmingLines(3, 1),
      ...confirmingLines(4, 1, 2),
      liveLine(3),
      'verify: seq went backwards from 4 to 3',
      'verify: count reset from 2/6 to 0: seq 3 is below the highest live seq 4',
    ])
    // The later reads of 3 do not go down from the read before them, so only one regression.
    expect(logs.filter((line) => line.startsWith('verify: seq went backwards'))).toHaveLength(1)
    expect(countLines()).toEqual([
      'verify: confirming seq=3 1/6',
      'verify: confirming seq=4 2/6',
      'verify: count reset from 2/6 to 0: seq 3 is below the highest live seq 4',
    ])
  })

  // Owner decision, 2026-11-14: a read confirms only when its seq is not lower than the highest
  // live seq seen so far in the run, not just the read before it.
  it('at expected 3, reads 3,4,3,3,3,3,3,3,... time out: the older seq never confirms again', async () => {
    queue = [live(3), live(4), live(3), live(3), live(3), live(3), live(3), live(3)]
    const outcome = await verifyPublish(options(3, { deadlineMs: 60_000 }))
    expect(outcome).toMatchObject({ kind: 'timeout', samples: 13, lastSeq: 3 })
    expect(seen).toHaveLength(13)
    // Reads 4 to 13 are each a 3 at the expected seq that does not count, and each says why.
    expect(logs.filter((line) => line.startsWith('verify: not confirming:'))).toEqual(
      Array<string>(10).fill('verify: not confirming: seq 3 is below the highest live seq 4'),
    )
    expect(logs.some((line) => line.startsWith('verify: confirming seq=3 2/6'))).toBe(false)
    expect(logs.at(-1)).toBe('verify: timed out after 13 samples; last seq=3')
  })

  it('at expected 3, reads 4,4,4,4,4,4 report superseded', async () => {
    queue = [live(4), live(4), live(4), live(4), live(4), live(4)]
    const outcome = await verifyPublish(options(3))
    expect(outcome).toMatchObject({
      kind: 'superseded',
      expectedSeq: 3,
      samples: 6,
      regressions: [],
      sample: { seq: 4, at: START + 25_000 },
    })
    expect(logs).toEqual([...confirmingLines(4, 6), 'verify: superseded expected=3 live=4'])
  })

  it('records every time the seq goes backwards, across unavailable samples', async () => {
    queue = [live(3), status(500), live(2), live(4)]
    const outcome = await verifyPublish(options(4))
    expect(outcome).toMatchObject({
      kind: 'live',
      samples: 9,
      regressions: [{ from: 3, to: 2, at: START + 10_000 }],
    })
    expect(logs).toContain('verify: seq went backwards from 3 to 2')
  })

  it('never confirms an older seq after a newer one, across an unavailable read', async () => {
    queue = [live(4), status(503), live(3)]
    const outcome = await verifyPublish(options(3, { deadlineMs: 30_000 }))
    expect(outcome).toEqual({
      kind: 'timeout',
      expectedSeq: 3,
      samples: 7,
      regressions: [{ from: 4, to: 3, at: START + 10_000 }],
      lastSeq: 3,
    })
    expect(logs).toContain('verify: seq went backwards from 4 to 3')
    expect(countLines()).toEqual([
      'verify: confirming seq=4 1/6',
      'verify: count reset from 1/6 to 0: build-info unavailable',
    ])
    expect(logs.filter((line) => line.startsWith('verify: not confirming:'))).toEqual(
      Array<string>(5).fill('verify: not confirming: seq 3 is below the highest live seq 4'),
    )
  })

  it('with absentStoryIds, never confirms a read that still lists the story, then confirms once it is gone', async () => {
    queue = [
      live(5, [LION, CROW]),
      live(5, [CROW]),
      live(5, [CROW]),
      live(5, [CROW, LION]),
      live(5, [CROW]),
    ]
    const outcome = await verifyPublish(options(5, { absentStoryIds: [LION, MONKEY] }))
    expect(outcome).toMatchObject({
      kind: 'live',
      samples: 10,
      sample: { seq: 5, storyIds: [CROW], at: START + 45_000 },
    })
    expect(logs.filter((line) => !line.startsWith('verify: seq='))).toEqual([
      'verify: not confirming: an unpublished story is still listed',
      'verify: confirming seq=5 1/6',
      'verify: confirming seq=5 2/6',
      'verify: count reset from 2/6 to 0: an unpublished story is still listed',
      ...[1, 2, 3, 4, 5, 6].map((k) => `verify: confirming seq=5 ${k}/6`),
      'verify: live seq=5',
    ])
    // In Actions the ids are workflow inputs, and run logs are public.
    expect(logs.some((line) => line.includes('lion') || line.includes('monkey'))).toBe(false)
  })

  it('with several absentStoryIds, never confirms a read that lists any one of them', async () => {
    queue = [live(5, [CROW, MONKEY]), live(5, [CROW, MONKEY]), live(5, [CROW])]
    const outcome = await verifyPublish(options(5, { absentStoryIds: [LION, MONKEY] }))
    expect(outcome).toMatchObject({
      kind: 'live',
      samples: 8,
      sample: { seq: 5, storyIds: [CROW], at: START + 35_000 },
    })
    expect(countLines()).toEqual([1, 2, 3, 4, 5, 6].map((k) => `verify: confirming seq=5 ${k}/6`))
  })

  it('with absentStoryIds, times out while every read still lists the story', async () => {
    queue = [live(5, [CROW, LION])]
    const outcome = await verifyPublish(options(5, { absentStoryIds: [LION], deadlineMs: 30_000 }))
    expect(outcome).toEqual({
      kind: 'timeout',
      expectedSeq: 5,
      samples: 7,
      regressions: [],
      lastSeq: 5,
    })
    expect(logs.some((line) => line.startsWith('verify: confirming'))).toBe(false)
  })

  it('with absentStoryIds, counts a story named only in build-info excluded as gone', async () => {
    const lionExcluded = {
      ...buildInfo(5, { storyIds: [CROW] }),
      excluded: [{ storyId: LION, version: 2, reason: 'approval-missing' }],
    }
    queue = [body(JSON.stringify(BuildInfo.parse(lionExcluded)))]
    const outcome = await verifyPublish(options(5, { absentStoryIds: [LION] }))
    expect(outcome).toMatchObject({
      kind: 'live',
      samples: 6,
      sample: { seq: 5, storyIds: [CROW], at: START + 25_000 },
    })
    expect(countLines()).toEqual([1, 2, 3, 4, 5, 6].map((k) => `verify: confirming seq=5 ${k}/6`))
  })

  it('refuses an empty absentStoryIds list with a RangeError before any request', async () => {
    queue = [live(3, [LION])]
    const error: unknown = await verifyPublish(options(3, { absentStoryIds: [] })).then(
      () => null,
      (thrown: unknown) => thrown,
    )
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toHaveProperty('message', 'absentStoryIds must not be empty')
    expect(seen).toEqual([])
    // Leaving the option out still means no takedown check.
    const outcome = await verifyPublish(options(3))
    expect(outcome).toMatchObject({ kind: 'live', samples: 6, sample: { storyIds: [LION] } })
  })

  it('refuses bad absentStoryIds with a RangeError before any request', async () => {
    // Sparse lists: every() skips holes, so these check that each index is read.
    const holeFirst: string[] = []
    holeFirst[1] = LION
    const cases: [unknown, string][] = [
      [['The Lion'], 'absentStoryIds must be a list of story ids'],
      [[''], 'absentStoryIds must be a list of story ids'],
      [[CROW, 42], 'absentStoryIds must be a list of story ids'],
      [CROW, 'absentStoryIds must be a list of story ids'],
      [null, 'absentStoryIds must be a list of story ids'],
      [holeFirst, 'absentStoryIds must be a list of story ids'],
      [new Array<string>(2), 'absentStoryIds must be a list of story ids'],
      [[CROW, LION, CROW], 'absentStoryIds must not repeat a story id'],
    ]
    for (const [absentStoryIds, message] of cases) {
      const error: unknown = await verifyPublish(
        options(1, { absentStoryIds: absentStoryIds as readonly string[] }),
      ).then(
        () => null,
        (thrown: unknown) => thrown,
      )
      expect(error).toBeInstanceOf(RangeError)
      expect(error).toHaveProperty('message', message)
    }
    expect(seen).toEqual([])
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

  it('times out when the deadline arrives part way through the confirming reads', async () => {
    queue = [live(3)]
    const outcome = await verifyPublish(options(3, { deadlineMs: 22_000 }))
    expect(outcome).toEqual({
      kind: 'timeout',
      expectedSeq: 3,
      samples: 5,
      regressions: [],
      lastSeq: 3,
    })
    expect(logs).toEqual([
      ...confirmingLines(3, 5),
      'verify: timed out after 5 samples; last seq=3',
    ])
  })

  // At the default interval the 6th read starts 25 s after the first, so 25 s is the shortest
  // deadline that can confirm. The 6th confirming read returns before the deadline check.
  it.each([
    [25_000, 'live after 6 reads', { kind: 'live', samples: 6, sample: { at: START + 25_000 } }],
    [24_999, 'a timeout after 5 reads', { kind: 'timeout', samples: 5, lastSeq: 3 }],
  ] as const)('with deadlineMs %i, the result is %s', async (deadlineMs, _result, want) => {
    queue = [live(3)]
    const outcome = await verifyPublish(options(3, { deadlineMs }))
    expect(outcome).toMatchObject(want)
    expect(seen).toHaveLength(want.samples)
  })

  it.each(['staging', 'fixtures'] as const)(
    'never confirms a %s build-info, even at the expected seq',
    async (mode) => {
      queue = [notProduction(3, mode)]
      const outcome = await verifyPublish(options(3, { deadlineMs: 12_000 }))
      expect(outcome).toEqual({
        kind: 'timeout',
        expectedSeq: 3,
        samples: 3,
        regressions: [],
        lastSeq: null,
      })
    },
  )

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

  it.each([
    ['intervalMs', (value: number): Partial<VerifyOptions> => ({ intervalMs: value })],
    ['deadlineMs', (value: number): Partial<VerifyOptions> => ({ deadlineMs: value })],
  ] as const)(
    'refuses %s unless it is a finite number above 0, before any request',
    async (name, extra) => {
      queue = [live(3)]
      const bad = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        0,
        -0,
        -1,
        -5_000,
        '5000' as unknown as number,
      ]
      for (const value of bad) {
        const error: unknown = await verifyPublish(options(3, extra(value))).then(
          () => null,
          (thrown: unknown) => thrown,
        )
        expect(error).toBeInstanceOf(RangeError)
        expect(error).toHaveProperty('message', `${name} must be a finite number > 0`)
      }
      expect(seen).toEqual([])
    },
  )

  it('uses intervalMs and deadlineMs when they are given', async () => {
    queue = [live(3)]
    const outcome = await verifyPublish(options(3, { intervalMs: 1_000, deadlineMs: 5_500 }))
    expect(outcome).toMatchObject({ kind: 'live', samples: 6, sample: { at: START + 5_000 } })
    expect(sleeps).toEqual(Array<number>(5).fill(1_000))
    sleeps = []
    const late = await verifyPublish(options(3, { intervalMs: 1_000, deadlineMs: 4_500 }))
    expect(late).toMatchObject({ kind: 'timeout', samples: 5, lastSeq: 3 })
    expect(sleeps).toEqual(Array<number>(4).fill(1_000))
  })

  it('prints deploymentId and appVersion from the site on one line, with only safe characters', async () => {
    const crafted = {
      ...buildInfo(3),
      deploymentId: 'dpl_1\n::error::forged',
      appVersion: `abc\r\n::warning file=x::y\u001b[31m${'z'.repeat(80)}`,
    }
    queue = [body(JSON.stringify(BuildInfo.parse(crafted)))]
    const outcome = await verifyPublish(options(3, { deadlineMs: 1 }))
    expect(outcome).toMatchObject({ kind: 'timeout', samples: 1, lastSeq: 3 })
    expect(logs).toEqual([
      `verify: seq=3 deployment=dpl_1?::error::forged app=abc??::warning?file?x::y??31m${'z'.repeat(35)} builtAt=${BUILT_AT} ms=0`,
      'verify: confirming seq=3 1/6',
      'verify: timed out after 1 samples; last seq=3',
    ])
    // Printable ASCII only (no newline or control character), and no line starts a workflow command.
    expect(logs.every((line) => /^[\x20-\x7e]+$/.test(line) && !line.startsWith('::'))).toBe(true)
  })
})

describe('readBuildInfo', () => {
  const read = () => readBuildInfo(siteUrl, { now: () => clock })

  it('accepts application/json with a charset parameter', async () => {
    queue = [live(7)]
    expect(await read()).toMatchObject({ kind: 'live', seq: 7, at: START })
  })

  it('lists the built story ids in build-info order', async () => {
    queue = [live(7, [MONKEY, CROW, LION])]
    expect(await read()).toMatchObject({ kind: 'live', seq: 7, storyIds: [MONKEY, CROW, LION] })
  })

  it.each([
    ['staging', 'build-info mode is staging, not production'],
    ['fixtures', 'build-info mode is fixtures, not production'],
  ] as const)('reads a %s build-info as unavailable and names the mode', async (mode, reason) => {
    queue = [notProduction(7, mode)]
    expect(await read()).toEqual({ kind: 'unavailable', at: START, ms: 0, status: 200, reason })
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

  it('prints a crafted content-type only in the safe, capped form', async () => {
    const prefix = 'content-type must be application/json, got '
    const crafted = [
      ['text/html ::error file=x::forged', 'text/html?::error?file?x::forged'],
      [`x/${'a'.repeat(200)}`, `x/${'a'.repeat(62)}`],
    ]
    for (const [type, printed] of crafted) {
      queue = [body(JSON.stringify(buildInfo(1)), type)]
      const sample = await read()
      expect(sample).toEqual({
        kind: 'unavailable',
        at: START,
        ms: 0,
        status: 200,
        reason: `${prefix}${printed}`,
      })
      if (sample.kind === 'unavailable') {
        expect(sample.reason.slice(prefix.length)).toMatch(/^[A-Za-z0-9._:/?-]{1,64}$/)
      }
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

describe('describeSample', () => {
  const sample = (deploymentId: string | null, appVersion: string | null): LiveSample => ({
    kind: 'live',
    at: START,
    ms: 0,
    seq: 3,
    deploymentId,
    appVersion,
    deploymentUrl: null,
    builtAt: BUILT_AT,
    storyIds: [],
  })
  const line = (deployment: string, app: string) =>
    `verify: seq=3 deployment=${deployment} app=${app} builtAt=${BUILT_AT} ms=0`

  it('prints - for a missing or empty value', () => {
    expect(describeSample(sample(null, ''))).toBe(line('-', '-'))
  })

  it('keeps the safe characters A-Z a-z 0-9 . _ : / - as they are', () => {
    const safe = 'AZaz09._:/-dpl_Ab12'
    expect(describeSample(sample(safe, COMMIT))).toBe(line(safe, COMMIT))
  })

  it('replaces each other character with one ?, a character outside the BMP included', () => {
    expect(describeSample(sample('dpl 1\t\u0000é\u{1F600}"=', 'a b'))).toBe(
      line('dpl?1??????', 'a?b'),
    )
  })

  it('cuts a value to 64 characters', () => {
    const long = 'a'.repeat(64)
    expect(describeSample(sample(`${long}b`, long))).toBe(line(long, long))
  })
})
