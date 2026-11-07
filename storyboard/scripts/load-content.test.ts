import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuildInfo } from '../src/core/content/build-info'
import type { GateMode } from '../src/core/content/gates'
import { jcsBytes, sha256Hex, toJcs } from '../src/core/hashing'
import type { CatalogueSnapshot } from '../src/core/package/catalogue'
import {
  makePointer,
  makeSnapshot,
  pointerPath,
  snapshotPath,
} from '../src/core/package/catalogue-build'
import {
  isEntryPoint,
  loadContent,
  MAX_BODY_BYTES,
  objectUrl,
  popFromCfRay,
  resolveConfig,
  vercelEnvName,
  type Env,
  type LoaderOptions,
} from './load-content'

const PREFIX = '/storage/v1/object/public/content/'
const NOW = new Date('2026-11-07T10:00:00.000Z')
const SHA = 'e'.repeat(64)
const COMMIT = '1ab6342c0ffee1ab6342c0ffee1ab6342c0ffee0'
// Joined at runtime so no file holds a string shaped like a real key (secret scanners on push).
const SECRETISH = ['sb', 'secret', 'should_never_print'].join('_')

type Handler = (req: IncomingMessage, res: ServerResponse) => void
interface SeenRequest {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: IncomingHttpHeaders
}

let server: Server
let baseUrl: string
/** Per object path, the handlers for successive requests; the last one repeats. */
let routes: Map<string, Handler[]>
let seen: SeenRequest[]
let root: string
let out: string[]
let errors: string[]
let sleeps: number[]

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname
    seen.push({ method: req.method ?? '', path, query: url.searchParams, headers: req.headers })
    const queue = routes.get(path)
    const handler = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    ;(handler ?? status(404))(req, res)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${PREFIX.slice(0, -1)}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((done) => server.close(() => done()))
})

beforeEach(() => {
  routes = new Map()
  seen = []
  out = []
  errors = []
  sleeps = []
  root = mkdtempSync(join(tmpdir(), 'load-content-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

// ---- server handlers ----

const CDN_HEADERS = { 'cf-cache-status': 'MISS', 'cf-ray': '8f1a2b3c4d5e6f70-BOM', age: '0' }

function json(bytes: Uint8Array, type = 'application/json'): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': type, 'content-length': bytes.length, ...CDN_HEADERS })
    res.end(bytes)
  }
}

function status(code: number, headers: Record<string, string> = {}): Handler {
  return (_req, res) => {
    res.writeHead(code, { 'content-type': 'application/json', ...headers })
    res.end('{"error":"x"}')
  }
}

const dropConnection: Handler = (req) => req.socket.destroy()
const neverAnswer: Handler = () => undefined

// ---- fixtures ----

interface Published {
  readonly pointerPath: string
  readonly snapshotPath: string
  readonly pointerBytes: Uint8Array
  readonly snapshotBytes: Uint8Array
  readonly snapshotSha256: string
}

async function publish(
  o: {
    root?: string
    mode?: GateMode
    seq?: number
    stories?: CatalogueSnapshot['stories']
    featuredStoryId?: string | null
    pointerSha256?: string
  } = {},
): Promise<Published> {
  const seq = o.seq ?? 1
  const snapshot = await makeSnapshot({
    schemaVersion: '1.0',
    seq,
    createdAt: NOW.toISOString(),
    note: 'loader test',
    featuredStoryId: o.featuredStoryId ?? null,
    stories: o.stories ?? [],
  })
  const sPath = snapshotPath(seq, o.root)
  const pointer = await makePointer({
    schemaVersion: '1.0',
    seq,
    snapshotPath: sPath,
    snapshotSha256: o.pointerSha256 ?? snapshot.sha256,
    updatedAt: NOW.toISOString(),
  })
  const pPath = pointerPath(o.mode ?? 'production', o.root)
  routes.set(pPath, [json(pointer.bytes)])
  routes.set(sPath, [json(snapshot.bytes, 'application/json; charset=utf-8')])
  return {
    pointerPath: pPath,
    snapshotPath: sPath,
    pointerBytes: pointer.bytes,
    snapshotBytes: snapshot.bytes,
    snapshotSha256: snapshot.sha256,
  }
}

const storageEnv = (pointer = 'catalogue/production.json', extra: Env = {}): Env => ({
  CONTENT_SOURCE: 'storage',
  CONTENT_BASE_URL: baseUrl,
  CONTENT_POINTER: pointer,
  ...extra,
})

const run = (env: Env, extra: Partial<LoaderOptions> = {}) =>
  loadContent({
    env,
    root,
    now: () => NOW,
    log: (line) => void out.push(line),
    logError: (line) => void errors.push(line),
    sleep: async (ms) => void sleeps.push(ms),
    timeoutMs: 2_000,
    ...extra,
  })

const paths = () => ({
  contentDir: join(root, '.content'),
  contentInfo: join(root, '.content', 'build-info.json'),
  publicInfo: join(root, 'public', 'build-info.json'),
})

function plantStaleOutputs(): void {
  mkdirSync(join(root, '.content'), { recursive: true })
  writeFileSync(paths().contentInfo, 'stale')
  mkdirSync(join(root, 'public'), { recursive: true })
  writeFileSync(paths().publicInfo, 'stale')
  writeFileSync(join(root, 'public', 'keep.txt'), 'not ours')
}

function expectNoOutputs(): void {
  expect(existsSync(paths().contentDir)).toBe(false)
  expect(existsSync(paths().publicInfo)).toBe(false)
}

const readBuildInfo = (path = paths().publicInfo) =>
  BuildInfo.parse(JSON.parse(readFileSync(path, 'utf8')))

const sha12 = async (bytes: Uint8Array) => (await sha256Hex(new Uint8Array(bytes))).slice(0, 12)

/**
 * Runs `body` with a temporary link to the folder `target` (a junction on Windows, which needs no
 * admin rights; a symlink elsewhere). Only the link is removed afterwards, never the target.
 */
function withLinkedFolder<T>(target: string, body: (link: string) => T): T {
  const parent = mkdtempSync(join(tmpdir(), 'load-content-link-'))
  const link = join(parent, 'linked')
  symlinkSync(target, link, 'junction')
  try {
    return body(link)
  } finally {
    unlinkSync(link)
    rmdirSync(parent) // not recursive: it refuses to run if the link were still there
  }
}

// ---- tests ----

describe('loadContent: storage mode, good content', () => {
  it('loads a production pointer and snapshot and writes both outputs', async () => {
    const pub = await publish()
    const env = storageEnv('catalogue/production.json', {
      VERCEL_GIT_COMMIT_SHA: COMMIT,
      VERCEL_DEPLOYMENT_ID: 'dpl_test',
      VERCEL_URL: 'storyboard-abc.vercel.app',
    })
    expect(await run(env)).toBe(0)
    expect(errors).toEqual([])

    const info = readBuildInfo()
    expect(info).toEqual({
      schemaVersion: '1.0',
      mode: 'production',
      seq: 1,
      pointerPath: 'catalogue/production.json',
      snapshotPath: 'catalogue/snapshots/1.json',
      snapshotSha256: pub.snapshotSha256,
      featuredStoryId: null,
      stories: [],
      excluded: [],
      appVersion: COMMIT,
      deploymentId: 'dpl_test',
      deploymentUrl: 'storyboard-abc.vercel.app',
      builtAt: NOW.toISOString(),
      fetches: [
        {
          path: 'catalogue/production.json',
          status: 200,
          cfCacheStatus: 'MISS',
          age: 0,
          pop: 'BOM',
          sha256: await sha12(pub.pointerBytes),
          ms: expect.any(Number),
        },
        {
          path: 'catalogue/snapshots/1.json',
          status: 200,
          cfCacheStatus: 'MISS',
          age: 0,
          pop: 'BOM',
          sha256: await sha12(pub.snapshotBytes),
          ms: expect.any(Number),
        },
      ],
    })
    // Both copies are the same canonical bytes; the verified inputs are kept byte for byte.
    expect(readFileSync(paths().contentInfo, 'utf8')).toBe(toJcs(info))
    expect(readFileSync(paths().publicInfo, 'utf8')).toBe(toJcs(info))
    expect(new Uint8Array(readFileSync(join(root, '.content', 'pointer.json')))).toEqual(
      pub.pointerBytes,
    )
    expect(new Uint8Array(readFileSync(join(root, '.content', 'snapshot.json')))).toEqual(
      pub.snapshotBytes,
    )
    expect(existsSync(join(root, '.content', '.tmp'))).toBe(false)
  })

  it('logs one line per GET and a final line', async () => {
    const pub = await publish()
    expect(await run(storageEnv())).toBe(0)
    expect(out).toEqual([
      `content: fetch path=catalogue/production.json status=200 cf=MISS age=0 pop=BOM sha=${await sha12(pub.pointerBytes)} seq=1`,
      `content: fetch path=catalogue/snapshots/1.json status=200 cf=MISS age=0 pop=BOM sha=${await sha12(pub.snapshotBytes)} seq=1`,
      'content: mode=production seq=1 snapshot=catalogue/snapshots/1.json',
    ])
  })

  it('reads the pointer with a cacheNonce and the snapshot without a query, both with identity encoding', async () => {
    await publish()
    expect(await run(storageEnv())).toBe(0)
    expect(seen.map((r) => [r.method, r.path, r.query.toString()])).toEqual([
      ['GET', 'catalogue/production.json', `cacheNonce=${NOW.getTime()}`],
      ['GET', 'catalogue/snapshots/1.json', ''],
    ])
    expect(seen.every((r) => r.headers['accept-encoding'] === 'identity')).toBe(true)
  })

  it('maps a staging pointer to staging mode and leaves Vercel values null outside Vercel', async () => {
    await publish({ mode: 'staging', seq: 4 })
    expect(await run(storageEnv('catalogue/staging.json'))).toBe(0)
    const info = readBuildInfo()
    expect(info.mode).toBe('staging')
    expect(info.seq).toBe(4)
    expect([info.appVersion, info.deploymentId, info.deploymentUrl]).toEqual([null, null, null])
  })

  it('replaces stale outputs and leaves other public files alone', async () => {
    plantStaleOutputs()
    await publish()
    expect(await run(storageEnv())).toBe(0)
    expect(readBuildInfo(paths().contentInfo).seq).toBe(1)
    expect(readFileSync(join(root, 'public', 'keep.txt'), 'utf8')).toBe('not ours')
  })

  it('excludes unapproved stories in production mode and logs each one', async () => {
    await publish({
      stories: [
        {
          storyId: 'two-paths',
          collectionId: 'panchatantra',
          version: 2,
          packagePath: `packages/two-paths/${SHA}.json`,
          packageSha256: SHA,
        },
      ],
    })
    expect(await run(storageEnv())).toBe(0)
    expect(readBuildInfo().excluded).toEqual([
      { storyId: 'two-paths', version: 2, reason: 'approval-missing' },
    ])
    expect(out).toContain('content: excluded story=two-paths version=2 reason=approval-missing')
  })

  it('never names a featured story that was not built', async () => {
    await publish({ featuredStoryId: 'blue-jackal' })
    expect(await run(storageEnv())).toBe(0)
    expect(readBuildInfo().featuredStoryId).toBeNull()
    expect(out).toContain('content: featured story=blue-jackal is not built; featuredStoryId=null')
  })

  // P0-13 THROWAWAY: removed at cleanup together with SPIKE_ROOTS.
  it('accepts the spikes/s1/ pointer root during P0-13', async () => {
    await publish({ root: 'spikes/s1/', seq: 2 })
    expect(await run(storageEnv('spikes/s1/catalogue/production.json'))).toBe(0)
    const info = readBuildInfo()
    expect([info.pointerPath, info.snapshotPath]).toEqual([
      'spikes/s1/catalogue/production.json',
      'spikes/s1/catalogue/snapshots/2.json',
    ])
  })
})

describe('loadContent: retries', () => {
  it('retries a 500 and succeeds on the next 200, recording both GETs', async () => {
    const pub = await publish()
    routes.set(pub.snapshotPath, [status(500), json(pub.snapshotBytes)])
    expect(await run(storageEnv())).toBe(0)
    expect(readBuildInfo().fetches.map((f) => [f.path, f.status])).toEqual([
      ['catalogue/production.json', 200],
      ['catalogue/snapshots/1.json', 500],
      ['catalogue/snapshots/1.json', 200],
    ])
    expect(sleeps).toEqual([1_000])
    expect(out[1]).toMatch(
      /^content: fetch path=catalogue\/snapshots\/1\.json status=500 cf=- age=- pop=- sha=[a-f0-9]{12} seq=-$/,
    )
  })

  it('retries a dropped connection and records it with status null', async () => {
    const pub = await publish()
    routes.set(pub.pointerPath, [dropConnection, json(pub.pointerBytes)])
    expect(await run(storageEnv())).toBe(0)
    const [first] = readBuildInfo().fetches
    expect(first).toMatchObject({ path: 'catalogue/production.json', status: null, sha256: null })
    expect(out[0]).toMatch(
      /^content: fetch path=catalogue\/production\.json status=error\(TypeError/,
    )
  })

  it('fails after 3 attempts when every answer is a 5xx', async () => {
    const pub = await publish()
    routes.set(pub.snapshotPath, [status(503)])
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual([
      'content gate failed: snapshot GET failed after 3 attempts: status 503',
    ])
    expect(seen.filter((r) => r.path === pub.snapshotPath)).toHaveLength(3)
    expect(sleeps).toEqual([1_000, 2_000])
    expectNoOutputs()
  })

  it('fails after 3 attempts when every request times out', async () => {
    const pub = await publish()
    routes.set(pub.pointerPath, [neverAnswer])
    expect(await run(storageEnv(), { timeoutMs: 100 })).toBe(1)
    expect(errors).toEqual([
      'content gate failed: pointer GET failed after 3 attempts: TimeoutError',
    ])
    expect(seen).toHaveLength(3)
  })

  it('does not retry a 404', async () => {
    routes.set('catalogue/production.json', [status(404)])
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer GET returned status 404'])
    expect(seen).toHaveLength(1)
  })

  it('does not follow a redirect', async () => {
    const pub = await publish()
    routes.set(pub.pointerPath, [status(302, { location: `${PREFIX}${pub.snapshotPath}` })])
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer GET returned status 302'])
    expect(seen).toHaveLength(1)
  })
})

describe('loadContent: response checks and gates', () => {
  it('fails on a snapshot hash mismatch and writes nothing', async () => {
    plantStaleOutputs()
    await publish({ pointerSha256: SHA })
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: snapshot sha256 mismatch'])
    expect(out).toHaveLength(2) // both fetch lines, for the build log
    expectNoOutputs()
  })

  it('fails on a content-type other than application/json', async () => {
    const pub = await publish()
    routes.set(pub.pointerPath, [json(pub.pointerBytes, 'text/html')])
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual([
      'content gate failed: pointer content-type must be application/json, got text/html',
    ])
  })

  it('compares the content-type without parameters or case', async () => {
    const pub = await publish()
    routes.set(pub.pointerPath, [json(pub.pointerBytes, 'Application/JSON; charset=UTF-8')])
    expect(await run(storageEnv())).toBe(0)
    expect(errors).toEqual([])
  })

  it('fails on non-canonical pointer bytes', async () => {
    const pub = await publish()
    const pretty = JSON.stringify(JSON.parse(new TextDecoder().decode(pub.pointerBytes)), null, 2)
    routes.set(pub.pointerPath, [json(new TextEncoder().encode(pretty))])
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer is not canonical JCS'])
  })

  it('fails on an unsafe snapshot path without requesting it', async () => {
    const unsafe = jcsBytes({
      schemaVersion: '1.0',
      seq: 1,
      snapshotPath: 'catalogue/snapshots/../../masters/x.json',
      snapshotSha256: SHA,
      updatedAt: NOW.toISOString(),
    })
    routes.set('catalogue/production.json', [json(unsafe)])
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer snapshotPath is unsafe'])
    expect(seen).toHaveLength(1)
  })

  it('fails when a declared body is larger than 1 MiB', async () => {
    routes.set('catalogue/production.json', [json(new Uint8Array(MAX_BODY_BYTES + 1))])
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer is larger than 1048576 bytes'])
  })

  it('fails when a streamed body without content-length grows past 1 MiB', async () => {
    routes.set('catalogue/production.json', [
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        for (let i = 0; i <= 16; i++) res.write(new Uint8Array(64 * 1024))
        res.end()
      },
    ])
    expect(await run(storageEnv())).toBe(1)
    expect(errors).toEqual(['content gate failed: pointer is larger than 1048576 bytes'])
  })

  it('fails closed on a snapshot that lists stories to build (packages arrive in P1-2)', async () => {
    await publish({
      mode: 'staging',
      stories: [
        {
          storyId: 'two-paths',
          collectionId: 'panchatantra',
          version: 1,
          packagePath: `packages/two-paths/${SHA}.json`,
          packageSha256: SHA,
        },
      ],
    })
    expect(await run(storageEnv('catalogue/staging.json'))).toBe(1)
    expect(errors).toEqual([
      'content gate failed: snapshot lists 1 stories to build; package loading arrives in P1-2',
    ])
    expectNoOutputs()
  })
})

describe('loadContent: CONTENT_SOURCE unset or none', () => {
  it('fails in Vercel Production when CONTENT_SOURCE is unset, without any request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const env = { VERCEL_ENV: 'production', CONTENT_BASE_URL: baseUrl }
    expect(await run(env, { fetchImpl })).toBe(1)
    expect(errors).toEqual([
      'content gate failed: CONTENT_SOURCE is not set; it is required when VERCEL_ENV=production',
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(seen).toHaveLength(0)
  })

  it.each([
    ['CI or this PC (no VERCEL_ENV)', {}, 'unset'],
    ['a Vercel Preview', { VERCEL_ENV: 'preview' }, 'preview'],
    ['an empty CONTENT_SOURCE', { CONTENT_SOURCE: '' }, 'unset'],
  ])('skips without network on %s and removes stale outputs', async (_where, env, vercelEnv) => {
    plantStaleOutputs()
    const fetchImpl = vi.fn<typeof fetch>()
    expect(await run(env, { fetchImpl })).toBe(0)
    expect(out).toEqual([`content: skipped (CONTENT_SOURCE is not set; VERCEL_ENV=${vercelEnv})`])
    expect(errors).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
    expectNoOutputs()
    expect(existsSync(join(root, 'public', 'keep.txt'))).toBe(true)
  })

  it('skips on CONTENT_SOURCE=none, in Production too', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    expect(await run({ CONTENT_SOURCE: 'none', VERCEL_ENV: 'production' }, { fetchImpl })).toBe(0)
    expect(out).toEqual(['content: skipped (CONTENT_SOURCE=none; VERCEL_ENV=production)'])
    expect(fetchImpl).not.toHaveBeenCalled()
    expectNoOutputs()
  })
})

describe('loadContent: Vercel Production needs a production pointer', () => {
  it('fails on a staging pointer without any request, so the approval gate is never skipped', async () => {
    plantStaleOutputs()
    await publish({ mode: 'staging' })
    const fetchImpl = vi.fn<typeof fetch>()
    const env = storageEnv('catalogue/staging.json', { VERCEL_ENV: 'production' })
    expect(await run(env, { fetchImpl })).toBe(1)
    expect(errors).toEqual([
      'content gate failed: CONTENT_POINTER must be a production pointer when VERCEL_ENV=production',
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(seen).toHaveLength(0)
  })

  it('loads a production pointer in Production and a staging pointer in a Preview', async () => {
    await publish()
    expect(await run(storageEnv('catalogue/production.json', { VERCEL_ENV: 'production' }))).toBe(0)
    expect(readBuildInfo().mode).toBe('production')
    await publish({ mode: 'staging' })
    expect(await run(storageEnv('catalogue/staging.json', { VERCEL_ENV: 'preview' }))).toBe(0)
    expect(readBuildInfo().mode).toBe('staging')
  })
})

describe('resolveConfig', () => {
  it.each([
    [{ CONTENT_SOURCE: 'fixtures' }, 'CONTENT_SOURCE must be "storage" or "none"'],
    [{ CONTENT_SOURCE: 'storage' }, 'CONTENT_BASE_URL is not set'],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'not a url' },
      'CONTENT_BASE_URL is not a valid URL',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'http://example.supabase.co/x' },
      'CONTENT_BASE_URL must use https',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'ftp://127.0.0.1/x' },
      'CONTENT_BASE_URL must use https',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'https://example.supabase.co/x?token=1' },
      'CONTENT_BASE_URL must not carry a query',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'https://u:p@example.supabase.co/x' },
      'CONTENT_BASE_URL must not carry credentials',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'https://example.supabase.co/x#frag' },
      'CONTENT_BASE_URL must not carry a fragment',
    ],
    [
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: 'https://example.supabase.co/x' },
      'CONTENT_POINTER is not set',
    ],
    [
      {
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: 'https://example.supabase.co/x',
        CONTENT_POINTER: 'x/catalogue/production.json',
      },
      'pointer path must be <root>catalogue/production.json or <root>catalogue/staging.json',
    ],
    [
      {
        VERCEL_ENV: 'production',
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: 'https://example.supabase.co/x',
        CONTENT_POINTER: 'catalogue/staging.json',
      },
      'CONTENT_POINTER must be a production pointer when VERCEL_ENV=production',
    ],
  ])('refuses %j', (env, reason) => {
    expect(resolveConfig(env)).toEqual({ ok: false, reason })
  })

  it('takes the gate mode from the pointer outside Vercel Production', () => {
    for (const [vercelEnv, pointer, mode] of [
      ['production', 'catalogue/production.json', 'production'],
      ['preview', 'catalogue/staging.json', 'staging'],
      ['preview', 'catalogue/production.json', 'production'],
      [undefined, 'catalogue/staging.json', 'staging'],
    ] as const) {
      const r = resolveConfig({
        VERCEL_ENV: vercelEnv,
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: 'https://example.supabase.co/x',
        CONTENT_POINTER: pointer,
      })
      expect(r.ok && r.value.kind === 'storage' && r.value.location.mode).toBe(mode)
    }
  })

  it('never echoes a configured value in a reason', () => {
    const secretish = SECRETISH
    for (const env of [
      { CONTENT_SOURCE: secretish },
      { CONTENT_SOURCE: 'storage', CONTENT_BASE_URL: secretish },
      {
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: 'https://example.supabase.co/x',
        CONTENT_POINTER: secretish,
      },
    ]) {
      const r = resolveConfig(env)
      expect(r.ok).toBe(false)
      expect(JSON.stringify(r)).not.toContain(secretish)
    }
  })

  it('accepts an https base URL with or without a trailing slash', () => {
    for (const base of ['https://example.supabase.co/x', 'https://example.supabase.co/x/']) {
      const r = resolveConfig({
        CONTENT_SOURCE: 'storage',
        CONTENT_BASE_URL: base,
        CONTENT_POINTER: 'catalogue/production.json',
      })
      expect(r.ok && r.value.kind).toBe('storage')
    }
  })
})

describe('helpers', () => {
  it('reads the CDN location from cf-ray', () => {
    expect(popFromCfRay('8f1a2b3c4d5e6f70-BOM')).toBe('BOM')
    expect(popFromCfRay('8f1a2b3c4d5e6f70-sin')).toBe('SIN')
    expect(popFromCfRay('8f1a2b3c4d5e6f70')).toBeNull()
    expect(popFromCfRay(null)).toBeNull()
  })

  it('joins an object path onto the base URL with exactly one slash', () => {
    for (const base of [
      'https://x.supabase.co/storage/v1/object/public/content',
      'https://x.supabase.co/storage/v1/object/public/content/',
    ]) {
      expect(objectUrl(new URL(base), 'catalogue/production.json').href).toBe(
        'https://x.supabase.co/storage/v1/object/public/content/catalogue/production.json',
      )
    }
  })

  it('names the Vercel environment for log lines without echoing an unknown value', () => {
    expect(vercelEnvName({})).toBe('unset')
    expect(vercelEnvName({ VERCEL_ENV: '' })).toBe('unset')
    for (const name of ['production', 'preview', 'development']) {
      expect(vercelEnvName({ VERCEL_ENV: name })).toBe(name)
    }
    expect(vercelEnvName({ VERCEL_ENV: SECRETISH })).toBe('other')
  })

  it('recognises the entry point and nothing else', () => {
    const file = fileURLToPath(import.meta.url)
    expect(isEntryPoint(pathToFileURL(file).href, file)).toBe(true)
    expect(isEntryPoint(pathToFileURL(file).href, join(dirname(file), 'other.ts'))).toBe(false)
    expect(isEntryPoint(pathToFileURL(file).href, undefined)).toBe(false)
  })

  it('recognises the entry point when it is started through a symlinked or junctioned folder', () => {
    const file = fileURLToPath(import.meta.url)
    withLinkedFolder(dirname(file), (link) => {
      expect(isEntryPoint(pathToFileURL(file).href, join(link, basename(file)))).toBe(true)
      expect(isEntryPoint(pathToFileURL(file).href, join(link, 'other.ts'))).toBe(false)
    })
  })
})

describe('load-content (real process, exit code)', () => {
  const storyboard = join(dirname(fileURLToPath(import.meta.url)), '..')

  /** Runs the loader as `pnpm build` does, in Production with CONTENT_SOURCE unset. */
  function runInProductionWithoutSource(script: string) {
    const env: NodeJS.ProcessEnv = { ...process.env, VERCEL_ENV: 'production' }
    for (const name of ['CONTENT_SOURCE', 'CONTENT_BASE_URL', 'CONTENT_POINTER']) delete env[name]
    return spawnSync(
      process.execPath,
      [join(storyboard, 'node_modules/tsx/dist/cli.mjs'), script],
      {
        env,
        encoding: 'utf8',
      },
    )
  }

  function expectGateFailure(result: ReturnType<typeof runInProductionWithoutSource>): void {
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'content gate failed: CONTENT_SOURCE is not set; it is required when VERCEL_ENV=production',
    )
    expect(result.stdout).toBe('')
  }

  it('exits 1 with the gate message in Production when CONTENT_SOURCE is unset', () => {
    expectGateFailure(runInProductionWithoutSource(join(storyboard, 'scripts/load-content.ts')))
  }, 30_000)

  it('fails closed the same way when started through a symlinked or junctioned folder', () => {
    withLinkedFolder(join(storyboard, 'scripts'), (link) => {
      expectGateFailure(runInProductionWithoutSource(join(link, 'load-content.ts')))
    })
  }, 30_000)
})
