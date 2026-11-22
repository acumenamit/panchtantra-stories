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
// Step 15b (design migration-input/p1-step15b-design.md D15B-16, D15B-21; test plan §14.8): the
// public reads and the detail option, tested in their own describe with their own loopback guard
// at the end of this file; every line above is unchanged (S5).
import { createHash } from 'node:crypto'
import { afterEach, vi } from 'vitest'
import { PUBLIC_RETRY_DELAYS_MS, checkLanding, checkRange, readPublicObject } from './verify'

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

// ---- Step 15b: the public reads and the detail option (T15B-16 to T15B-20) ----
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:". The server is this file's loopback
// server; the base is `<siteUrl.origin>/s15b-public/content`, a neutral path that also shows the
// base's pathname is used as given. Retry waits go through a recording sleep.

describe('Step 15b public reads (D15B-16, D15B-21)', () => {
  // The loopback guard of storage.test.ts, for this describe only: a request to any other host is
  // counted and refused, and the count must stay 0.
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
  const realFetch = globalThis.fetch
  let escapes = 0
  beforeEach(() => {
    escapes = 0
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
      escapes++
      return Promise.reject(new TypeError('blocked: not a loopback host'))
    })
  })
  afterEach(() => {
    const count = escapes
    vi.unstubAllGlobals()
    expect(count, 'loopback guard: requests that tried to leave 127.0.0.1').toBe(0)
  })

  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const bytesOf = (n: number, seed = 7) =>
    Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 256)
  const base = () => new URL(`${siteUrl.origin}/s15b-public/content`)
  const recordSleep = { sleep: async (ms: number) => void sleeps.push(ms) }

  interface Answer {
    readonly status?: number
    readonly headers?: Readonly<Record<string, string>>
    readonly body?: Uint8Array | string
    /** Sent without a content-length, in two chunks. */
    readonly chunked?: boolean
  }
  const answer =
    ({ status: code = 200, headers = {}, body = '', chunked = false }: Answer): Handler =>
    (_req, res) => {
      const payload = Buffer.from(body)
      const head: Record<string, string> = { ...headers }
      if (!chunked && head['content-length'] === undefined) {
        head['content-length'] = String(payload.length)
      }
      res.writeHead(code, head)
      if (chunked) {
        res.write(payload.subarray(0, 1))
        res.end(payload.subarray(1))
      } else {
        res.end(payload)
      }
    }
  const destroyed: Handler = (req) => req.socket.destroy()
  /** Headers sent, then two of the declared bytes, then nothing. */
  const stalled: Handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': '10' })
    res.write(Buffer.from('12'))
  }
  const mp3 = { 'content-type': 'audio/mpeg' }

  /** An MP3 object: the full GET and any `range: bytes=s-e` GET, each answer changeable. */
  const serveMp3 =
    (
      body: Uint8Array,
      change: {
        readonly full?: (a: Answer) => Answer
        readonly range?: (a: Answer, start: number, end: number) => Answer
      } = {},
    ): Handler =>
    (req, res) => {
      const range = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ''))
      if (req.headers.range === undefined) {
        const full: Answer = { headers: mp3, body }
        answer(change.full ? change.full(full) : full)(req, res)
        return
      }
      const start = Number(range?.[1] ?? 0)
      const end = Number(range?.[2] ?? 0)
      const partial: Answer = {
        status: 206,
        // accept-ranges: bytes by default, so that only g4 decides whether it is read.
        headers: {
          ...mp3,
          'content-range': `bytes ${start}-${end}/${body.length}`,
          'accept-ranges': 'bytes',
        },
        body: body.subarray(start, end + 1),
      }
      answer(change.range ? change.range(partial, start, end) : partial)(req, res)
    }
  const targetOf = (body: Uint8Array) => {
    const hash = sha(body)
    return { path: `media/two-paths/${hash}-en.mp3`, bytes: body.length, sha256: hash }
  }
  const failed = (reason: string, status: number | null) => ({ kind: 'failed', reason, status })
  /** verify.ts's caller-error TypeErrors name their input, so no other TypeError counts as one. */
  const CALLER_ERROR = /^(public base|site URL|public object|range target|landing) /
  const settle = async (run: () => Promise<unknown>) => {
    try {
      return await run()
    } catch (error) {
      return error instanceof TypeError && CALLER_ERROR.test(error.message)
        ? 'caller-error'
        : `threw ${String(error)}`
    }
  }

  it("T15B-16 readPublicObject: one GET of base + path; exactly 200, the length, the type, identity and the body's sha256 against the name; each failure its reason; caller errors throw before any request (A20, D15B-21, L22, L24)", async () => {
    const webp = bytesOf(300)
    const object = {
      path: `media/two-paths/${sha(webp)}-w768.webp`,
      bytes: 300,
      mime: 'image/webp',
    }
    queue = [answer({ headers: { 'content-type': 'image/webp' }, body: webp })]
    expect(
      await readPublicObject(base(), object, recordSleep),
      'precondition: an ok answer',
    ).toEqual({
      kind: 'ok',
    })
    expect
      .soft(
        seen.map((r) => [r.path, r.query]),
        '(g1) one GET of the base pathname + / + path',
      )
      .toEqual([[`/s15b-public/content/${object.path}`, '']])

    const other = bytesOf(300, 99)
    const samples: [string, Handler[], unknown][] = [
      [
        '404 (a body of the right length and type, other bytes)',
        [answer({ status: 404, headers: { 'content-type': 'image/webp' }, body: other })],
        failed('status', 404),
      ],
      [
        'content-length + 1',
        [answer({ headers: { 'content-type': 'image/webp' }, body: bytesOf(301) })],
        failed('length', 200),
      ],
      [
        'image/png',
        [answer({ headers: { 'content-type': 'image/png' }, body: webp })],
        failed('type', 200),
      ],
      [
        'content-encoding: gzip',
        [
          answer({
            headers: { 'content-type': 'image/webp', 'content-encoding': 'gzip' },
            body: webp,
          }),
        ],
        failed('encoding', 200),
      ],
      [
        'other bytes',
        [answer({ headers: { 'content-type': 'image/webp' }, body: other })],
        failed('hash', 200),
      ],
      [
        '302 (to a loopback ok answer)',
        [
          answer({
            status: 302,
            headers: { location: `/s15b-public/content/${object.path}?moved` },
          }),
          answer({ headers: { 'content-type': 'image/webp' }, body: webp }),
        ],
        failed('redirect', 302),
      ],
      ['a destroyed socket', [destroyed], failed('network', null)],
      [
        'a chunked body over bytes',
        [answer({ headers: { 'content-type': 'image/webp' }, body: bytesOf(305), chunked: true })],
        failed('too-large', 200),
      ],
    ]
    for (const [id, handlers, want] of samples) {
      queue = [...handlers]
      expect
        .soft(await settle(() => readPublicObject(base(), object, recordSleep)), `(g2) ${id}`)
        .toEqual(want)
    }

    const hex = sha(webp)
    const callerErrors: [string, () => Promise<unknown>][] = [
      [
        'catalogue/production.json',
        () =>
          readPublicObject(base(), { ...object, path: 'catalogue/production.json' }, recordSleep),
      ],
      [
        'media/two-paths/../x.webp',
        () =>
          readPublicObject(base(), { ...object, path: 'media/two-paths/../x.webp' }, recordSleep),
      ],
      [
        'approvals/two-paths/<hex>.json',
        () =>
          readPublicObject(
            base(),
            { ...object, path: `approvals/two-paths/${hex}.json` },
            recordSleep,
          ),
      ],
      ['a base with ?q', () => readPublicObject(new URL(`${base().href}?q`), object, recordSleep)],
      ['a base with #h', () => readPublicObject(new URL(`${base().href}#h`), object, recordSleep)],
      [
        'http://example.org/x',
        () => readPublicObject(new URL('http://example.org/x'), object, recordSleep),
      ],
      ['bytes -1', () => readPublicObject(base(), { ...object, bytes: -1 }, recordSleep)],
    ]
    for (const [id, run] of callerErrors) {
      queue = [answer({ headers: { 'content-type': 'image/webp' }, body: webp })]
      seen = []
      const got = await settle(run)
      expect
        .soft([got, seen.length, escapes], `(g3) a caller error and zero requests: ${id}`)
        .toEqual(['caller-error', 0, 0])
    }

    const pkg = new TextEncoder().encode('{"schemaVersion":"1.0"}')
    const pkgObject = {
      path: `packages/two-paths/${sha(pkg)}.json`,
      bytes: pkg.length,
      mime: 'application/json',
    }
    queue = [answer({ headers: { 'content-type': 'application/json' }, body: pkg })]
    expect
      .soft(
        await settle(() => readPublicObject(base(), pkgObject, recordSleep)),
        '(g4) a package path',
      )
      .toEqual({ kind: 'ok' })
  })

  it("T15B-17 checkRange: the full GET then one middle range; exactly 206, content-range bytes s-e/size, the slice's bytes, type and identity; each failure its reason; Accept-Ranges never read (A16, D15B-16, L18)", async () => {
    const body4096 = bytesOf(4096)
    queue = [serveMp3(body4096)]
    const first = await checkRange(base(), targetOf(body4096), recordSleep)
    expect(first.kind, 'precondition: a 4,096-byte MP3 gives ok').toBe('ok')
    expect.soft(first, '(g1) size 4096').toEqual({ kind: 'ok', start: 2048, end: 3071, size: 4096 })
    expect
      .soft(
        seen.map((r) => r.headers.range),
        '(g1) the second request asks bytes=2048-3071',
      )
      .toEqual([undefined, 'bytes=2048-3071'])
    for (const [size, start, end] of [
      [2000, 1000, 1999],
      [3, 1, 2],
      [1, 0, 0],
    ] as const) {
      const body = bytesOf(size)
      queue = [serveMp3(body)]
      expect
        .soft(
          await settle(() => checkRange(base(), targetOf(body), recordSleep)),
          `(g1) size ${size}`,
        )
        .toEqual({ kind: 'ok', start, end, size })
    }

    const rangeSamples: [string, Handler, unknown][] = [
      [
        '200 for the range',
        serveMp3(body4096, { range: () => ({ headers: mp3, body: body4096 }) }),
        failed('status', 200),
      ],
      [
        'bytes 0-1023/4096',
        serveMp3(body4096, {
          range: (a) => ({ ...a, headers: { ...mp3, 'content-range': 'bytes 0-1023/4096' } }),
        }),
        failed('content-range', 206),
      ],
      [
        'bytes 2048-3071/4097',
        serveMp3(body4096, {
          range: (a) => ({ ...a, headers: { ...mp3, 'content-range': 'bytes 2048-3071/4097' } }),
        }),
        failed('content-range', 206),
      ],
      [
        'content-range absent',
        serveMp3(body4096, { range: (a) => ({ ...a, headers: mp3 }) }),
        failed('content-range', 206),
      ],
      [
        'a body one byte short (its content-length matching)',
        serveMp3(body4096, { range: (a, s, e) => ({ ...a, body: body4096.subarray(s, e) }) }),
        failed('length', 206),
      ],
      [
        'a body one byte too long (content-length e - s + 2, matching)',
        serveMp3(body4096, { range: (a, s, e) => ({ ...a, body: body4096.subarray(s, e + 2) }) }),
        failed('length', 206),
      ],
      [
        'one byte different',
        serveMp3(body4096, {
          range: (a, s, e) => {
            const slice = Uint8Array.from(body4096.subarray(s, e + 1))
            slice[10] = (slice[10]! + 1) % 256
            return { ...a, body: slice }
          },
        }),
        failed('bytes', 206),
      ],
      [
        'audio/mp3',
        serveMp3(body4096, {
          range: (a) => ({ ...a, headers: { ...a.headers, 'content-type': 'audio/mp3' } }),
        }),
        failed('type', 206),
      ],
      [
        'gzip',
        serveMp3(body4096, {
          range: (a) => ({ ...a, headers: { ...a.headers, 'content-encoding': 'gzip' } }),
        }),
        failed('encoding', 206),
      ],
    ]
    for (const [id, handler, want] of rangeSamples) {
      queue = [handler]
      expect
        .soft(await settle(() => checkRange(base(), targetOf(body4096), recordSleep)), `(g2) ${id}`)
        .toEqual(want)
    }

    const wrong = bytesOf(4096, 99)
    const fullSamples: [string, Handler, unknown][] = [
      [
        '404',
        serveMp3(body4096, { full: () => ({ status: 404, headers: mp3, body: wrong }) }),
        failed('full-status', 404),
      ],
      [
        'a content-length other than bytes (one byte short)',
        serveMp3(body4096, { full: (a) => ({ ...a, body: body4096.subarray(0, 4095) }) }),
        failed('full-length', 200),
      ],
      [
        'a wrong type',
        serveMp3(body4096, { full: (a) => ({ ...a, headers: { 'content-type': 'audio/mp3' } }) }),
        failed('full-type', 200),
      ],
      [
        'gzip',
        serveMp3(body4096, {
          full: (a) => ({ ...a, headers: { ...mp3, 'content-encoding': 'gzip' } }),
        }),
        failed('full-encoding', 200),
      ],
      [
        'the wrong sha256',
        serveMp3(body4096, { full: (a) => ({ ...a, body: wrong }) }),
        failed('full-hash', 200),
      ],
      [
        'a chunked body over the cap',
        serveMp3(body4096, { full: (a) => ({ ...a, body: bytesOf(4106), chunked: true }) }),
        failed('too-large', 200),
      ],
    ]
    for (const [id, handler, want] of fullSamples) {
      queue = [handler]
      seen = []
      const got = await settle(() => checkRange(base(), targetOf(body4096), recordSleep))
      expect.soft([got, seen.length], `(g3) ${id}, one request`).toEqual([want, 1])
    }

    for (const [id, acceptRanges] of [
      ['accept-ranges: none', 'none'],
      ['no accept-ranges', null],
    ] as const) {
      const withAcceptRanges = (a: Answer): Answer => {
        const headers: Record<string, string> = { ...a.headers }
        delete headers['accept-ranges']
        if (acceptRanges !== null) headers['accept-ranges'] = acceptRanges
        return { ...a, headers }
      }
      queue = [serveMp3(body4096, { range: withAcceptRanges })]
      expect
        .soft(await settle(() => checkRange(base(), targetOf(body4096), recordSleep)), `(g4) ${id}`)
        .toEqual({ kind: 'ok', start: 2048, end: 3071, size: 4096 })
    }

    // (g5) Caller errors (TP-3; B15B-implB-6): the target must be an MP3 media path with a whole
    // byte count from 1 and a 64-hex sha256, else a TypeError before any request.
    const target = targetOf(body4096)
    const callerErrors: [string, () => Promise<unknown>][] = [
      [
        'a package path',
        () =>
          checkRange(
            base(),
            { ...target, path: `packages/two-paths/${target.sha256}.json` },
            recordSleep,
          ),
      ],
      [
        'a WebP path',
        () =>
          checkRange(
            base(),
            { ...target, path: `media/two-paths/${target.sha256}-w768.webp` },
            recordSleep,
          ),
      ],
      ['bytes 0', () => checkRange(base(), { ...target, bytes: 0 }, recordSleep)],
      ['sha256 x', () => checkRange(base(), { ...target, sha256: 'x' }, recordSleep)],
      ['a base with ?q', () => checkRange(new URL(`${base().href}?q`), target, recordSleep)],
    ]
    for (const [id, run] of callerErrors) {
      queue = [serveMp3(body4096)]
      seen = []
      const got = await settle(run)
      expect
        .soft([got, seen.length], `(g5) a caller error and zero requests: ${id}`)
        .toEqual(['caller-error', 0])
    }
  })

  it('T15B-18 public GET policy: identity set on the full GET and left to fetch on the range GET, no cache headers, manual redirect, at most two retries after 1 s and 2 s on network, timeout, 429 and 5xx only (A16, A20, L24, CRIT-2, CRIT-13)', async () => {
    queue = [live(1)]
    await readBuildInfo(siteUrl, { now: () => clock })
    expect(
      seen.length === 1 &&
        seen[0]?.headers['cache-control'] === 'no-cache' &&
        seen[0]?.headers.pragma === 'no-cache',
      'precondition: readBuildInfo (unchanged) sends cache-control: no-cache and pragma: no-cache',
    ).toBe(true)

    const body = bytesOf(4096)
    const target = targetOf(body)
    seen = []
    queue = [serveMp3(body)]
    const range = await checkRange(base(), target, recordSleep)
    const webp = bytesOf(200)
    queue = [answer({ headers: { 'content-type': 'image/webp' }, body: webp })]
    const object = await readPublicObject(
      base(),
      { path: `media/two-paths/${sha(webp)}-w768.webp`, bytes: 200, mime: 'image/webp' },
      recordSleep,
    )
    queue = [
      answer({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<html></html>' }),
    ]
    const landing = await checkLanding(siteUrl, { storyId: 'two-paths', locale: 'en' }, recordSleep)
    expect(
      [range.kind, object.kind, landing.kind, seen.length],
      'precondition: the four GETs answered ok',
    ).toEqual(['ok', 'ok', 'ok', 4])
    const [fullGet, rangeGet, objectGet, landingGet] = seen
    expect
      .soft(
        [fullGet, rangeGet, objectGet, landingGet].map((r) => r?.headers['accept-encoding']),
        '(g1) accept-encoding is exactly identity on the full, range, object and landing GETs',
      )
      .toEqual(['identity', 'identity', 'identity', 'identity'])
    expect
      .soft(
        [fullGet, rangeGet, objectGet, landingGet].map((r) => r?.headers.range),
        '(g1) only the range GET carries range',
      )
      .toEqual([undefined, 'bytes=2048-3071', undefined, undefined])
    expect
      .soft(
        seen.filter(
          (r) => r.headers['cache-control'] !== undefined || r.headers.pragma !== undefined,
        ).length,
        '(g1) no public GET carries cache-control or pragma',
      )
      .toBe(0)

    const r503 = status(503)
    const retries: [string, Handler[], unknown, number[], number][] = [
      [
        '503, 503, then the answers',
        [r503, r503, serveMp3(body)],
        { kind: 'ok', start: 2048, end: 3071, size: 4096 },
        [1000, 2000],
        4,
      ],
      ['503 three times', [r503], failed('full-status', 503), [1000, 2000], 3],
      [
        '429 then ok',
        [status(429), serveMp3(body)],
        { kind: 'ok', start: 2048, end: 3071, size: 4096 },
        [1000],
        3,
      ],
      ['404', [status(404)], failed('full-status', 404), [], 1],
      [
        'a destroyed socket twice, then ok',
        [destroyed, destroyed, serveMp3(body)],
        { kind: 'ok', start: 2048, end: 3071, size: 4096 },
        [1000, 2000],
        4,
      ],
    ]
    for (const [id, handlers, want, waits, requests] of retries) {
      queue = [...handlers]
      seen = []
      sleeps = []
      const got = await settle(() => checkRange(base(), target, recordSleep))
      expect.soft([got, sleeps, seen.length], `(g2) ${id}`).toEqual([want, waits, requests])
    }
    expect.soft(PUBLIC_RETRY_DELAYS_MS, '(g2) the retry waits').toEqual([1000, 2000])

    queue = [status(301, { location: `/s15b-public/content/${target.path}` })]
    seen = []
    sleeps = []
    const redirected = await settle(() => checkRange(base(), target, recordSleep))
    expect
      .soft(
        [redirected, seen.length, sleeps],
        '(g3) a 301 on the full GET is redirect after one request',
      )
      .toEqual([failed('redirect', 301), 1, []])

    // (g2) The stalled body, last: headers, two of the ten declared bytes, then nothing. timeoutMs
    // 300 lets the headers arrive on every try, so each try ends inside the body read (the judge's
    // catch), never at the fetch; the tries and the answered fetches are counted at the fetch, and
    // the server is drained before the next test (S15B-R1-SEC-2; B15B-implB-7).
    queue = [stalled]
    seen = []
    sleeps = []
    let tries = 0
    let answered = 0
    const counting: typeof fetch = async (input, init) => {
      tries++
      const response = await fetch(input, init)
      answered++
      return response
    }
    const stalledGot = await settle(() =>
      checkRange(base(), target, { ...recordSleep, timeoutMs: 300, fetchImpl: counting }),
    )
    for (let i = 0; i < 100 && seen.length < 3; i++) {
      await new Promise((done) => setTimeout(done, 10))
    }
    expect
      .soft(
        [stalledGot, sleeps, tries, answered],
        '(g2) a stalled body with timeoutMs 300: network after three tries, the headers answered on each',
      )
      .toEqual([failed('network', null), [1000, 2000], 3, 3])
  })

  it('T15B-19 checkLanding: GET <origin>/<locale>/stories/<id>; exactly 200 text/html, the body capped at 4 MiB and discarded; the story id and the locale re-checked (A20, L21, TP-15)', async () => {
    const html = answer({
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<html></html>',
    })
    queue = [html]
    expect
      .soft(
        await settle(() =>
          checkLanding(siteUrl, { storyId: 'two-paths', locale: 'en' }, recordSleep),
        ),
        '(g1) ok',
      )
      .toEqual({ kind: 'ok' })
    expect
      .soft(
        seen.map((r) => [r.path, r.query]),
        '(g1) the server saw /en/stories/two-paths',
      )
      .toEqual([['/en/stories/two-paths', '']])

    const samples: [string, Handler[], unknown][] = [
      [
        '404',
        [answer({ status: 404, headers: { 'content-type': 'text/html' }, body: 'x' })],
        failed('status', 404),
      ],
      [
        '302 (to a loopback 200)',
        [answer({ status: 302, headers: { location: '/en/stories/two-paths?moved' } }), html],
        failed('redirect', 302),
      ],
      [
        'application/json',
        [answer({ headers: { 'content-type': 'application/json' }, body: '{}' })],
        failed('type', 200),
      ],
      [
        'a chunked 4 MiB + 1 body',
        [
          answer({
            headers: { 'content-type': 'text/html' },
            body: new Uint8Array(4 * 1024 * 1024 + 1),
            chunked: true,
          }),
        ],
        failed('too-large', 200),
      ],
      ['a destroyed socket', [destroyed], failed('network', null)],
    ]
    for (const [id, handlers, want] of samples) {
      queue = [...handlers]
      expect
        .soft(
          await settle(() =>
            checkLanding(siteUrl, { storyId: 'two-paths', locale: 'en' }, recordSleep),
          ),
          `(g2) ${id}`,
        )
        .toEqual(want)
    }

    const callerErrors: [string, URL, string, string][] = [
      ['story id Two', siteUrl, 'Two', 'en'],
      ['story id a/b', siteUrl, 'a/b', 'en'],
      ['story id two-paths + U+D800', siteUrl, 'two-paths\uD800', 'en'],
      ['locale ar (disabled)', siteUrl, 'two-paths', 'ar'],
      ['locale fr', siteUrl, 'two-paths', 'fr'],
      ['locale EN', siteUrl, 'two-paths', 'EN'],
      ['a site URL with ?q', new URL(`${siteUrl.href}?q`), 'two-paths', 'en'],
    ]
    for (const [id, site, storyId, locale] of callerErrors) {
      queue = [html]
      seen = []
      const got = await settle(() => checkLanding(site, { storyId, locale }, recordSleep))
      expect
        .soft([got, seen.length], `(g3) a caller error and zero requests: ${id}`)
        .toEqual(['caller-error', 0])
    }
  })

  it("T15B-20 the detail option: verifyPublish with detail true returns the confirmed read's build; without it the outcome has no build key and the log is byte-identical (A20, D15B-21, L20)", async () => {
    const S1 = '1'.repeat(64)
    const S2 = '2'.repeat(64)
    const read = (snapshotSha256: string) =>
      body(
        JSON.stringify(
          BuildInfo.parse({
            ...buildInfo(3, { storyIds: [LION] }),
            snapshotSha256,
            featuredStoryId: LION,
            excluded: [{ storyId: CROW, version: 2, reason: 'approval-missing' }],
          }),
        ),
      )
    const reads = () => [read(S1), read(S1), read(S1), read(S1), read(S1), read(S2)]
    queue = reads()
    const detailed = await verifyPublish(options(3, { detail: true }))
    const detailedLogs = [...logs]
    queue = reads()
    logs = []
    clock = START
    const plain = await verifyPublish(options(3))
    expect(
      [detailed.kind, plain.kind, detailedLogs.length > 0],
      'precondition: both runs end live after six confirming reads',
    ).toEqual(['live', 'live', true])
    expect
      .soft(
        detailed.kind === 'live' ? detailed.sample.build : null,
        '(g1) the build of the last read',
      )
      .toEqual({
        snapshotSha256: S2,
        featuredStoryId: LION,
        stories: [{ storyId: LION, version: 1, packageSha256: 'c'.repeat(64) }],
        excluded: [{ storyId: CROW, version: 2, reason: 'approval-missing' }],
      })
    expect
      .soft(plain.kind === 'live' && 'build' in plain.sample, '(g2) no build key without detail')
      .toBe(false)
    expect
      .soft(logs, '(g2) the logs with and without detail are equal line for line')
      .toEqual(detailedLogs)
  })
})
