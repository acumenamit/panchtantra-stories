// P0-13 THROWAWAY: removed at cleanup
// The CLI runs against the real storage client, whose fetch is an in-memory fake of the Storage
// REST API and the public CDN URL. Nothing here touches the network.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadContent } from '../../scripts/load-content'
import { Secret } from '../publisher/env'
import { createStorageClient, StorageRefusedError, type StorageClient } from '../publisher/storage'
import type { BuildInfoSample } from '../publisher/verify'
import {
  cdnDelete,
  cdnPoll,
  cleanupDelete,
  cleanupList,
  commitStatuses,
  compareWithLedger,
  corruptSha256,
  envCheck,
  forbiddenValues,
  judgeProtection,
  newestSuperseded,
  parseCommand,
  publishS1,
  runAudioUpload,
  runFreshness,
  scrubber,
  stableSince,
  UsageError,
  type SpikeDeps,
} from './cli'
import type { ProbeRecord } from './http-probe'
import { createRecorder, type Recorder } from './ledger'
import {
  cdnProbeList,
  cdnProbePath,
  CDN_PROBE_NAMES,
  freshnessPointerPath,
  S1_POINTER,
  s1SnapshotPath,
  spikeGuards,
  type SpikeObject,
} from './objects'

const ORIGIN = 'https://abcdefghijklmnopqrst.supabase.co'
const PUBLIC_PREFIX = '/storage/v1/object/public/content/'
const FAKE_KEY = ['sb', 'secret', 'fake-cli-test-key'].join('_')
const HOOK = new Secret('https://api.vercel.com/v1/integrations/deploy/prj_test123/hooksecret987')
const RUN = 'r20261107-101500'
const START = Date.parse('2026-11-07T10:00:00.000Z')

// ---- in-memory Storage ----

interface StoredFile {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly contentType: string
  readonly cacheControl: string
}

interface FakeStorage {
  readonly store: Map<string, StoredFile>
  readonly requests: string[]
  readonly fetchImpl: typeof fetch
  /** When set, public GETs serve the bytes from before the latest overwrite (a stale CDN). */
  stale: boolean
  /** Public GET answers to replay first, per path (status only). */
  readonly scriptedStatuses: Map<string, number[]>
}

function json(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function listLevel(store: Map<string, StoredFile>, prefix: string) {
  const base = prefix === '' ? '' : `${prefix}/`
  const names = new Map<string, boolean>() // name -> isFolder
  for (const key of store.keys()) {
    if (!key.startsWith(base)) continue
    const rest = key.slice(base.length).split('/')
    names.set(rest[0]!, rest.length > 1 || names.get(rest[0]!) === true)
  }
  return [...names.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, folder]) =>
      folder ? { name, id: null } : { name, id: `id-${name}`, metadata: { size: 1 } },
    )
}

function fakeStorage(): FakeStorage {
  const store = new Map<string, StoredFile>()
  const previous = new Map<string, StoredFile>()
  const fake: FakeStorage = {
    store,
    requests: [],
    stale: false,
    scriptedStatuses: new Map(),
    fetchImpl: async (input, init) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      const headers = new Headers(init?.headers)
      fake.requests.push(`${method} ${url.pathname}`)
      if (url.host === 'api.vercel.com') {
        return json(201, { job: { id: 'job_1', state: 'PENDING', createdAt: 1_762_509_600_000 } })
      }
      if (method === 'POST' && url.pathname === '/storage/v1/object/list/content') {
        const body = JSON.parse(String(init?.body)) as {
          prefix: string
          limit: number
          offset: number
        }
        return json(200, listLevel(store, body.prefix).slice(body.offset, body.offset + body.limit))
      }
      if (method === 'POST' && url.pathname.startsWith('/storage/v1/object/content/')) {
        const path = url.pathname.slice('/storage/v1/object/content/'.length)
        const existing = store.get(path)
        if (existing && headers.get('x-upsert') !== 'true') {
          return json(400, { statusCode: '409', error: 'Duplicate', message: 'exists' })
        }
        if (existing) previous.set(path, existing)
        store.set(path, {
          bytes: new Uint8Array(await new Response(init?.body).arrayBuffer()),
          contentType: headers.get('content-type') ?? '',
          cacheControl: headers.get('cache-control') ?? '',
        })
        return json(200, { Key: `content/${path}` })
      }
      if (method === 'DELETE' && url.pathname === '/storage/v1/object/content') {
        const { prefixes } = JSON.parse(String(init?.body)) as { prefixes: string[] }
        return json(
          200,
          prefixes.filter((p) => store.delete(p)).map((name) => ({ name })),
        )
      }
      if (method === 'GET' && url.pathname.startsWith(PUBLIC_PREFIX)) {
        const path = url.pathname.slice(PUBLIC_PREFIX.length)
        const scripted = fake.scriptedStatuses.get(path)?.shift()
        if (scripted !== undefined) {
          return new Response(scripted === 200 ? 'old' : '{}', {
            status: scripted,
            headers: { 'cf-cache-status': scripted === 200 ? 'HIT' : 'MISS' },
          })
        }
        const file = (fake.stale ? previous.get(path) : undefined) ?? store.get(path)
        if (!file) return json(404, { error: 'not_found' }, { 'cf-cache-status': 'MISS' })
        return new Response(file.bytes, {
          status: 200,
          headers: {
            'content-type': file.contentType,
            'cache-control': file.cacheControl,
            'cf-cache-status': 'MISS',
            'cf-ray': 'abc-BOM',
          },
        })
      }
      return json(404, { error: 'unexpected request in test' })
    },
  }
  return fake
}

// ---- deps ----

let dir: string
let recorder: Recorder
let lines: string[]
let ms: number
let fake: FakeStorage

function deps(): SpikeDeps {
  return {
    recorder,
    log: (line) => lines.push(line),
    now: () => new Date(START + ms),
    clock: () => ms,
    sleep: async (delay) => {
      ms += delay
    },
    fetchImpl: fake.fetchImpl,
  }
}

function storage(freshnessRunId?: string): StorageClient {
  return createStorageClient({
    supabaseUrl: new URL(ORIGIN),
    secretKey: new Secret(FAKE_KEY),
    guards: spikeGuards(freshnessRunId),
    fetchImpl: fake.fetchImpl,
  })
}

/** Every byte the CLI wrote to the evidence folder. */
function allWritten(): string {
  return readdirSync(dir)
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spike-cli-'))
  recorder = createRecorder(
    dir,
    forbiddenValues({
      SUPABASE_SECRET_KEY: FAKE_KEY,
      VERCEL_DEPLOY_HOOK_PRODUCTION: HOOK.reveal(),
    }),
  )
  lines = []
  ms = 0
  fake = fakeStorage()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Runs the real prebuild loader against the fake Storage, as a Vercel production build would. */
async function loaderBuild(): Promise<{ code: number; errors: string[]; seq: number | null }> {
  const root = mkdtempSync(join(tmpdir(), 'spike-cli-build-'))
  const errors: string[] = []
  try {
    const code = await loadContent({
      env: {
        VERCEL_ENV: 'production',
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: `${ORIGIN}/storage/v1/object/public/content`,
        CONTENT_POINTER: S1_POINTER,
      },
      root,
      fetchImpl: fake.fetchImpl,
      log: () => undefined,
      logError: (line) => errors.push(line),
      sleep: async () => undefined,
    })
    const seq =
      code === 0
        ? (
            JSON.parse(readFileSync(join(root, '.content', 'build-info.json'), 'utf8')) as {
              seq: number
            }
          ).seq
        : null
    return { code, errors, seq }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ---- tests ----

describe('parseCommand', () => {
  it('parses each subcommand with its defaults', () => {
    expect(parseCommand([])).toEqual({ name: 'help' })
    expect(parseCommand(['env-check'])).toEqual({ name: 'env-check' })
    expect(parseCommand(['upload'])).toEqual({ name: 'upload', bearerFallback: false })
    expect(parseCommand(['s1', 'publish', '--seq', '4', '--wrong-hash', '--hook'])).toEqual({
      name: 's1-publish',
      seq: 4,
      wrongHash: true,
      hook: true,
      bearerFallback: false,
    })
    expect(parseCommand(['watch'])).toEqual({ name: 'watch', minutes: 120, intervalMs: 5000 })
    expect(parseCommand(['wait-stable'])).toEqual({
      name: 'wait-stable',
      minutes: 2,
      timeoutMinutes: 30,
      intervalMs: 5000,
    })
    expect(parseCommand(['freshness'])).toEqual({
      name: 'freshness',
      rounds: 20,
      bearerFallback: false,
    })
    expect(parseCommand(['cdn', 'warm', '--run', RUN])).toEqual({
      name: 'cdn-warm',
      runId: RUN,
      maxTries: 12,
      intervalMs: 10_000,
    })
    expect(parseCommand(['cdn', 'poll', '--run', RUN])).toEqual({
      name: 'cdn-poll',
      runId: RUN,
      intervalMs: 30_000,
      maxMinutes: 90,
    })
    expect(parseCommand(['cdn', 'delete', '--run', RUN, '--confirm'])).toMatchObject({
      name: 'cdn-delete',
      confirm: true,
    })
    expect(parseCommand(['protection', '--old', 'https://a-b.vercel.app/'])).toEqual({
      name: 'protection',
      old: 'a-b.vercel.app',
      current: null,
      branchAlias: null,
    })
    expect(parseCommand(['statuses', '--sha', 'a'.repeat(40)])).toEqual({
      name: 'statuses',
      sha: 'a'.repeat(40),
      repo: 'acumenamit/panchtantra-stories',
    })
    expect(parseCommand(['cleanup', 'delete', '--path', 'spikes/a', '--path', 'spikes/b'])).toEqual(
      {
        name: 'cleanup-delete',
        all: false,
        paths: ['spikes/a', 'spikes/b'],
        confirm: false,
        bearerFallback: false,
      },
    )
  })

  it('refuses unknown commands, stray options and bad values', () => {
    const bad = [
      ['deploy'],
      ['s1'],
      ['s1', 'publish'],
      ['s1', 'publish', '--seq', 'x'],
      ['s1', 'publish', '--seq', '0'],
      ['watch', '--seq', '1'],
      ['upload', '--confirm'],
      ['cdn', 'warm'],
      ['cdn', 'warm', '--run', '../x'],
      ['cdn', 'warm', '--run', RUN, 'extra'],
      ['freshness', '--rounds', '21'],
      ['watch', '--interval-ms', '10'],
      ['statuses', '--sha', 'abc'],
      ['cleanup', 'delete'],
      ['cleanup', 'delete', '--all', '--path', 'spikes/a'],
      ['protection', '--old', 'not a host'],
      ['upload', '--unknown'],
    ]
    for (const argv of bad) expect(() => parseCommand(argv), argv.join(' ')).toThrow(UsageError)
  })
})

describe('s1 publish', () => {
  it('uploads snapshot 1, proves "duplicate" with the same bytes, then moves the pointer', async () => {
    expect(await publishS1(deps(), storage(), { seq: 1, wrongHash: false, hookUrl: null })).toBe(0)
    const snapshot = s1SnapshotPath(1)
    expect(fake.requests.filter((r) => r.startsWith('POST'))).toEqual([
      `POST /storage/v1/object/content/${snapshot}`,
      `POST /storage/v1/object/content/${snapshot}`,
      `POST /storage/v1/object/content/${S1_POINTER}`,
    ])
    const results = recorder
      .readLedger()
      .flatMap((e) => (e.kind === 'upload-result' ? [`${e.path} ${e.result}`] : []))
    expect(results).toEqual([
      `${snapshot} created`,
      `${snapshot} duplicate`,
      `${S1_POINTER} created`,
    ])
    expect(fake.store.get(snapshot)?.cacheControl).toBe('max-age=3600')
    expect(fake.store.get(S1_POINTER)?.cacheControl).toBe('max-age=0')
    expect(await loaderBuild()).toEqual({ code: 0, errors: [], seq: 1 })
  })

  it('never reuses a seq', async () => {
    await publishS1(deps(), storage(), { seq: 1, wrongHash: false, hookUrl: null })
    const before = fake.requests.length
    expect(await publishS1(deps(), storage(), { seq: 1, wrongHash: false, hookUrl: null })).toBe(1)
    expect(await publishS1(deps(), storage(), { seq: 3, wrongHash: false, hookUrl: null })).toBe(1)
    expect(fake.requests).toHaveLength(before)
    expect(lines.at(-1)).toContain('the next new seq is 2')
  })

  it('a --wrong-hash pointer fails the build gate; the restore of the same seq passes', async () => {
    for (const seq of [1, 2, 3]) {
      await publishS1(deps(), storage(), { seq, wrongHash: false, hookUrl: null })
    }
    expect(await publishS1(deps(), storage(), { seq: 4, wrongHash: true, hookUrl: null })).toBe(0)
    expect(await loaderBuild()).toEqual({
      code: 1,
      errors: ['content gate failed: snapshot sha256 mismatch'],
      seq: null,
    })
    expect(await publishS1(deps(), storage(), { seq: 4, wrongHash: false, hookUrl: null })).toBe(0)
    expect(await loaderBuild()).toEqual({ code: 0, errors: [], seq: 4 })
    expect(await publishS1(deps(), storage(), { seq: 4, wrongHash: false, hookUrl: null })).toBe(1)
  })

  it('--hook logs only the job id; the hook URL is never printed or written', async () => {
    expect(await publishS1(deps(), storage(), { seq: 1, wrongHash: false, hookUrl: HOOK })).toBe(0)
    expect(fake.requests).toContain('POST /v1/integrations/deploy/prj_test123/hooksecret987')
    expect(lines).toContain('hook: job=job_1 createdAt=2025-11-07T10:00:00.000Z')
    const everything = `${lines.join('\n')}\n${allWritten()}`
    expect(everything).not.toContain('hooksecret987')
    expect(everything).not.toContain(FAKE_KEY)
    expect(recorder.readEvidence('s1')).toMatchObject([{ seq: 1, hook: { jobId: 'job_1' } }])
  })

  it('stops on 401 without trying the Bearer fallback', async () => {
    const refusing: typeof fetch = async () => json(401, { error: 'Unauthorized' })
    const client = createStorageClient({
      supabaseUrl: new URL(ORIGIN),
      secretKey: new Secret(FAKE_KEY),
      guards: spikeGuards(),
      fetchImpl: refusing,
    })
    expect(await publishS1(deps(), client, { seq: 1, wrongHash: false, hookUrl: null })).toBe(1)
    expect(lines.join('\n')).toContain('Storage refused the key (401/403). Stop here.')
    expect(lines.join('\n')).toContain('the next publish is --seq 2')
  })
})

describe('upload', () => {
  const object = (path: string): SpikeObject => ({
    path,
    contentType: 'audio/mpeg',
    cacheControl: 3600,
    purpose: 'audio-clip',
    body: () => new Uint8Array([1, 2, 3]),
  })

  it('uploads the list in order, never twice, and the guards refuse paths outside spikes/', async () => {
    const list = [object('spikes/audio/a.mp3'), object('spikes/audio/c.mp3')]
    expect(await runAudioUpload(deps(), storage(), list)).toBe(0)
    expect(await runAudioUpload(deps(), storage(), list)).toBe(0)
    expect(fake.requests).toEqual([
      'POST /storage/v1/object/content/spikes/audio/a.mp3',
      'POST /storage/v1/object/content/spikes/audio/c.mp3',
    ])
    expect(lines.filter((l) => l.startsWith('upload skipped'))).toHaveLength(2)
    await expect(runAudioUpload(deps(), storage(), [object('pt/x.mp3')])).rejects.toThrow(
      StorageRefusedError,
    )
  })
})

describe('freshness', () => {
  it('reads each new pointer with new nonces at +0, +1, +5 and +30 s', async () => {
    expect(
      await runFreshness(deps(), storage(RUN), new URL(ORIGIN), { runId: RUN, rounds: 2 }),
    ).toBe(0)
    const reads = recorder.readEvidence('freshness') as { read?: string; offsetMs?: number }[]
    expect(reads.filter((r) => r.read === 'new-nonce').map((r) => r.offsetMs)).toEqual([
      0, 1000, 5000, 30_000, 0, 1000, 5000, 30_000,
    ])
    expect(reads.filter((r) => r.read === 'plain')).toHaveLength(2)
    expect(reads.filter((r) => r.read === 'reused-nonce')).toHaveLength(1)
    expect(lines).toContain('freshness: 8 of 8 new-nonce reads returned the latest bytes')
    expect(fake.store.has(freshnessPointerPath(RUN))).toBe(true)
  })

  it('reports stale reads and exits 3', async () => {
    fake.stale = true
    expect(
      await runFreshness(deps(), storage(RUN), new URL(ORIGIN), { runId: RUN, rounds: 2 }),
    ).toBe(3)
    expect(lines).toContain('freshness: 4 of 8 new-nonce reads returned the latest bytes')
    expect(lines.filter((l) => l.startsWith('STALE: round=2'))).toHaveLength(4)
  })

  it("only the run's own pointer is overwritable", async () => {
    const other = freshnessPointerPath('r20261107-999999')
    const client = storage(RUN)
    await expect(
      client.upload({
        bucket: 'content',
        path: other,
        body: new Uint8Array([1]),
        contentType: 'application/json',
        cacheControl: 0,
        upsert: true,
      }),
    ).rejects.toThrow('upsert is not allowed')
  })
})

describe('cdn delete and poll', () => {
  async function uploadProbes() {
    const client = storage()
    for (const object of cdnProbeList(RUN)) {
      await client.upload({ ...object, bucket: 'content', body: object.body() })
      recorder.appendLedger({
        kind: 'upload-attempt',
        at: new Date(START).toISOString(),
        bucket: 'content',
        path: object.path,
        bytes: 1,
        sha256: 'a'.repeat(64),
        contentType: object.contentType,
        cacheControl: object.cacheControl,
        upsert: false,
        purpose: 'cdn-probe',
        seq: null,
        runId: RUN,
        wrongHash: false,
      })
    }
    return client
  }

  it('is a dry run without --confirm, then deletes exactly the 5 probes and reads a control', async () => {
    const client = await uploadProbes()
    expect(await cdnDelete(deps(), client, new URL(ORIGIN), { runId: RUN, confirm: false })).toBe(0)
    expect(fake.requests.some((r) => r.startsWith('DELETE'))).toBe(false)
    expect(await cdnDelete(deps(), client, new URL(ORIGIN), { runId: RUN, confirm: true })).toBe(0)
    expect(fake.store.size).toBe(0)
    const deletes = recorder.readLedger().filter((e) => e.kind === 'delete')
    expect(deletes.map((e) => e.path)).toEqual(CDN_PROBE_NAMES.map((n) => cdnProbePath(RUN, n)))
    const controls = recorder.readEvidence('cdn') as { action: string; probe: ProbeRecord }[]
    expect(controls.map((c) => [c.action, c.probe.status])).toEqual(
      CDN_PROBE_NAMES.map(() => ['delete-control', 404]),
    )
    expect(controls.every((c) => new URL(c.probe.url).searchParams.has('cacheNonce'))).toBe(true)
  })

  it('refuses a run that is not on the ledger', async () => {
    expect(await cdnDelete(deps(), storage(), new URL(ORIGIN), { runId: RUN, confirm: true })).toBe(
      1,
    )
    expect(fake.requests).toEqual([])
  })

  it('poll counts an object gone at the first of 3 non-200 answers in a row', async () => {
    const client = await uploadProbes()
    await cdnDelete(deps(), client, new URL(ORIGIN), { runId: RUN, confirm: true })
    ms = 60_000
    for (const name of CDN_PROBE_NAMES) {
      fake.scriptedStatuses.set(cdnProbePath(RUN, name), [200, 404, 200, 404, 404])
    }
    expect(
      await cdnPoll(deps(), new URL(ORIGIN), { runId: RUN, intervalMs: 30_000, maxMinutes: 90 }),
    ).toBe(0)
    const summaries = (
      recorder.readEvidence('cdn') as { action: string; lagSeconds?: number }[]
    ).filter((r) => r.action === 'poll-summary')
    // Reads at +60 s (200), +90 (404), +120 (200), +150 (404), +180 (404), +210 (404 from the store).
    expect(summaries.map((s) => s.lagSeconds)).toEqual(CDN_PROBE_NAMES.map(() => 150))
  })
})

describe('cleanup', () => {
  it('lists Storage against the ledger and deletes only ledger paths that are listed', async () => {
    await publishS1(deps(), storage(), { seq: 1, wrongHash: false, hookUrl: null })
    // An object the tool did not upload: never deleted here.
    fake.store.set('spikes/someone-else.json', {
      bytes: new Uint8Array([1]),
      contentType: 'application/json',
      cacheControl: 'max-age=1',
    })
    expect(await cleanupList(deps(), storage())).toBe(0)
    expect(lines).toContain('listed but NOT on the ledger (never deleted by this tool): 1')

    expect(
      await cleanupDelete(deps(), storage(), {
        all: false,
        paths: ['spikes/someone-else.json'],
        confirm: true,
      }),
    ).toBe(1)
    expect(await cleanupDelete(deps(), storage(), { all: true, paths: [], confirm: false })).toBe(0)
    expect(fake.store.size).toBe(3)
    expect(await cleanupDelete(deps(), storage(), { all: true, paths: [], confirm: true })).toBe(0)
    expect([...fake.store.keys()]).toEqual(['spikes/someone-else.json'])
    expect(lines).toContain('deleted 2 of 2')
  })

  it('compareWithLedger splits the three groups', () => {
    expect(compareWithLedger(['a', 'b'], ['b', 'c'])).toEqual({
      both: ['b'],
      listedOnly: ['a'],
      ledgerOnly: ['c'],
    })
  })
})

describe('pure helpers', () => {
  const live = (at: number, seq: number, deploymentId: string): BuildInfoSample => ({
    kind: 'live',
    at,
    ms: 1,
    seq,
    deploymentId,
    appVersion: null,
    deploymentUrl: `${deploymentId}.vercel.app`,
    builtAt: '2026-11-07T10:00:00.000Z',
  })
  const down = (at: number): BuildInfoSample => ({
    kind: 'unavailable',
    at,
    ms: 1,
    status: 503,
    reason: 'x',
  })

  it('stableSince returns the start of the trailing same-seq, same-deployment run', () => {
    expect(stableSince([])).toBeNull()
    expect(stableSince([live(0, 1, 'd1'), down(5)])).toBeNull()
    expect(stableSince([live(0, 1, 'd1'), live(5, 2, 'd2'), live(10, 2, 'd2')])).toBe(5)
    expect(stableSince([live(0, 2, 'd2'), down(5), live(10, 2, 'd2')])).toBe(10)
    expect(stableSince([live(0, 2, 'd1'), live(5, 2, 'd2')])).toBe(5)
  })

  it('newestSuperseded picks the newest deploymentUrl that is not the current one', () => {
    const rows = [
      { sample: live(0, 1, 'old1') },
      { sample: down(1) },
      { sample: live(2, 2, 'old2') },
      { sample: live(3, 3, 'cur') },
      'junk',
    ]
    expect(newestSuperseded(rows, 'cur.vercel.app')).toBe('old2.vercel.app')
    expect(newestSuperseded([], 'cur.vercel.app')).toBeNull()
  })

  it('judgeProtection follows the S1-5 rule', () => {
    const record = (status: number, location: string | null, type: string | null = null) =>
      ({ status, location, mediaType: type }) as ProbeRecord
    expect(judgeProtection('superseded', record(401, null))).toBe(true)
    expect(judgeProtection('superseded', record(307, 'https://vercel.com/sso-api'))).toBe(true)
    expect(judgeProtection('branch-alias', record(302, 'https://vercel.com/login'))).toBe(false)
    expect(judgeProtection('current-generated', record(200, null, 'application/json'))).toBe(false)
    expect(judgeProtection('production', record(200, null, 'application/json'))).toBe(true)
    expect(judgeProtection('production', record(307, 'https://vercel.com/sso-api'))).toBe(false)
  })

  it('corruptSha256 changes exactly the last digit', () => {
    expect(corruptSha256(`${'a'.repeat(63)}0`)).toBe(`${'a'.repeat(63)}1`)
    expect(corruptSha256('f'.repeat(64))).toBe(`${'f'.repeat(63)}0`)
  })

  it('forbiddenValues and scrubber hide the key, the hook URL and its last segment', () => {
    const forbidden = forbiddenValues({
      SUPABASE_SECRET_KEY: FAKE_KEY,
      VERCEL_DEPLOY_HOOK_PRODUCTION: HOOK.reveal(),
      NEXT_PUBLIC_SITE_URL: 'https://example.vercel.app',
    })
    expect(forbidden).toEqual([FAKE_KEY, HOOK.reveal(), 'hooksecret987'])
    expect(scrubber(forbidden)(`a ${FAKE_KEY} b hooksecret987`)).toBe('a [redacted] b [redacted]')
  })

  it('envCheck prints names with ok or the problem, never a value', () => {
    const publishable = ['sb', 'publishable', 'should-not-print'].join('_')
    const code = envCheck(deps(), {
      SUPABASE_URL: ORIGIN,
      SUPABASE_SECRET_KEY: publishable,
      VERCEL_DEPLOY_HOOK_PRODUCTION: HOOK.reveal(),
    })
    expect(code).toBe(1)
    expect(lines[0]).toBe('SUPABASE_URL ok')
    expect(lines[2]).toBe('VERCEL_DEPLOY_HOOK_PRODUCTION ok')
    expect(lines[3]).toBe('NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_SITE_URL is not set')
    expect(lines.join('\n')).not.toContain('should-not-print')
    expect(lines.join('\n')).not.toContain('hooksecret987')
  })

  it('commitStatuses prints one line per status without query strings', async () => {
    const github: typeof fetch = async (input) => {
      expect(String(input)).toBe(
        `https://api.github.com/repos/acumenamit/panchtantra-stories/commits/${'b'.repeat(40)}/statuses?per_page=100`,
      )
      return json(200, [
        {
          context: 'Vercel – storyboard',
          state: 'success',
          description: 'Deployment has completed',
          target_url: 'https://vercel.com/team/storyboard/abc?x=1',
          created_at: '2026-11-07T10:00:00Z',
          updated_at: '2026-11-07T10:01:00Z',
        },
      ])
    }
    const code = await commitStatuses(
      { ...deps(), fetchImpl: github },
      { sha: 'b'.repeat(40), repo: 'acumenamit/panchtantra-stories' },
    )
    expect(code).toBe(0)
    expect(lines).toEqual([
      '2026-11-07T10:01:00Z Vercel – storyboard: success - Deployment has completed https://vercel.com/team/storyboard/abc',
    ])
  })
})
