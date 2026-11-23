// Step 17 (P1-9a) masters.ts: runMasters, the create-only writer of the image masters and media-log
// snapshots (design migration-input/p1-step17-design.md §3.7, §3.14, §3.19, §3.20, §3.23, §5,
// D17-7, D17-19, D17-20, D17-23, D17-25; test plan 14.10: T17-30 to T17-34, and the type samples of
// A24). Every Storage call goes to the loopback stub through a real client built in the test with
// a fake key assembled at run time; a loopback guard on the global fetch refuses and counts any other
// host. The masters trees and reports are written under an OS temp folder only. Titles start with
// their id; one expect.soft per claim, messages "(gN) <claim> <sample>"; preconditions are hard
// expects starting "precondition:".
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { pngOf } from '../migrate/media-fixtures'
import { parseArgs } from './args'
import { Secret } from './env'
import { runMasters, type MastersDeps } from './masters'
import { planDigests } from './plan-digest'
import type { MastersPort, StageWriter, StorageReader } from './port'
import { createStorageClient, type StorageClient } from './storage'
import type { ApprovalRef, ImageMasterRef, MediaLogRef } from './storage-layout'
import {
  expectNoUnexpected,
  startStorageStub,
  type StorageStub,
  type StubBehaviour,
} from './storage-stub'

// ---- shared material ----

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-masters-test-key'].join('_')
const NOW = '2026-11-23T10:00:00.000Z'
const TIMEOUT = { timeout: 60_000 }
const READ_ROUTE = '/storage/v1/object/authenticated/masters/'
const CREATE_ROUTE = '/storage/v1/object/masters/'
const enc = (text: string) => new TextEncoder().encode(text)

/** A wide master (pngOf 1408x768 with caBX) and one of 2,076,066 bytes: the largest real master + 1. */
const MASTER_A = pngOf({ width: 1408, height: 768, chunks: ['caBX'], seed: 's17-a' })
const BIG_SIZE = 2_076_066
const MASTER_B = (() => {
  const base = pngOf({ width: 16, height: 16, chunks: ['caBX'], seed: 's17-b' })
  const pad = new Uint8Array(BIG_SIZE - base.byteLength - 12)
  return pngOf({
    width: 16,
    height: 16,
    chunks: ['caBX', { type: 'paDd', data: pad }],
    seed: 's17-b',
  })
})()
const SHA_A = await sha256Hex(MASTER_A)
const SHA_B = await sha256Hex(MASTER_B)
const LOG = jcsBytes([{ storyId: 'story-aa', nodeId: 'start', locale: 'en', bytes: 1 }])
const LOG_SHA12 = (await sha256Hex(LOG)).slice(0, 12)
const HISTORY = enc('{"a":1}\n{"b":[2]}\n')
const IMAGE_LOG = jcsBytes({ schema: 'image-log@1', images: [{ storyId: 'story-aa' }] })
const IMAGE_LOG_SHA12 = (await sha256Hex(IMAGE_LOG)).slice(0, 12)

const PATH_A = `images/story-aa/${SHA_A}.png`
const PATH_B = `images/story-aa/${SHA_B}.png`
const PATH_LOG = `media-log/2026-11-13-${LOG_SHA12}/media-log.json`
const PATH_HISTORY = `media-log/2026-11-13-${LOG_SHA12}/media-log.history.jsonl`
const PATH_IMAGE_LOG = `media-log/2026-11-23-${IMAGE_LOG_SHA12}/image-log.json`
type Entry = readonly [path: string, bytes: Uint8Array]
/** The 14.10 setup: two image masters, the media-log pair and the image log (5 objects). */
const SETUP = (): Entry[] => [
  [PATH_A, MASTER_A],
  [PATH_B, MASTER_B],
  [PATH_LOG, LOG],
  [PATH_HISTORY, HISTORY],
  [PATH_IMAGE_LOG, IMAGE_LOG],
]
const TYPE_OF: Readonly<Record<string, string>> = {
  [PATH_A]: 'image/png',
  [PATH_B]: 'image/png',
  [PATH_LOG]: 'application/json',
  [PATH_HISTORY]: 'application/x-ndjson',
  [PATH_IMAGE_LOG]: 'application/json',
}
const ALL_PATHS = Object.keys(TYPE_OF).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const BYTES_OF = new Map<string, Uint8Array>(SETUP())

// ---- loopback guard, temp root and stubs ----

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0
let root = ''
const stubs: StorageStub[] = []

beforeEach(() => {
  escapes = 0
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
    escapes++
    return Promise.reject(new TypeError('blocked: not a loopback host'))
  })
  root = mkdtempSync(join(tmpdir(), 's17-masters-'))
})

afterEach(async () => {
  const problems: unknown[] = []
  for (const stub of stubs.splice(0)) {
    try {
      expectNoUnexpected(stub)
    } catch (error) {
      problems.push(error)
    }
    await stub.close()
  }
  rmSync(root, { recursive: true, force: true })
  const count = escapes
  vi.unstubAllGlobals()
  expect(count, 'loopback guard: requests that tried to leave 127.0.0.1').toBe(0)
  if (problems.length > 0) throw problems[0]
})

async function newStub(): Promise<StorageStub> {
  const stub = await startStorageStub({ apikey: FAKE_KEY })
  stubs.push(stub)
  return stub
}

let trees = 0
/** Writes `entries` under a new folder of the temp root; returns the folder (the --masters root). */
function writeTree(entries: readonly Entry[], name = `m${++trees}`): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  for (const [path, bytes] of entries) {
    const file = join(dir, ...path.split('/'))
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
  return dir
}
const reportDir = () => join(root, 'reports')
const storyboardRoot = () => join(root, 'sb')

function fakeClock(iso = NOW) {
  let t = Date.parse(iso)
  return { now: () => new Date(t), advance: (ms: number) => void (t += ms) }
}

interface RunOptions {
  readonly stub?: StorageStub | null
  readonly realPath?: (path: string) => string
  readonly platform?: string
  readonly clock?: ReturnType<typeof fakeClock>
  readonly fetchImpl?: typeof fetch
  readonly onLog?: (line: string) => void
}
interface Ran {
  readonly exit: number
  readonly out: string[]
  readonly err: string[]
  readonly made: number
}

async function run(dir: string, extra: string[] = [], options: RunOptions = {}): Promise<Ran> {
  const parsed = parseArgs(['masters', '--masters', dir, '--report-dir', reportDir(), ...extra], {
    cwd: root,
    storyboardRoot: storyboardRoot(),
    platform: process.platform,
  })
  if (!parsed.ok || parsed.command !== 'masters') throw new Error('test setup: masters args')
  const out: string[] = []
  const err: string[] = []
  const clock = options.clock ?? fakeClock()
  let made = 0
  const deps: MastersDeps = {
    storyboardRoot: storyboardRoot(),
    platform: options.platform ?? process.platform,
    now: clock.now,
    sleep: async (ms) => clock.advance(ms),
    log: (line) => {
      out.push(line)
      options.onLog?.(line)
    },
    error: (line) => void err.push(line),
    realPath: options.realPath ?? realpathSync.native,
    makePort: () => {
      made++
      const stub = options.stub
      if (stub === undefined || stub === null) throw new Error('test: no client on this path')
      const client = createStorageClient({
        supabaseUrl: stub.origin,
        secretKey: new Secret(FAKE_KEY),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      })
      const port: MastersPort = client
      return port
    },
  }
  const exit = await runMasters(parsed, deps)
  return { exit, out, err, made }
}

const lastLine = (lines: readonly string[]) => lines[lines.length - 1] ?? ''
const stopped = (code: string) => `masters: stopped: ${code}`
const posts = (stub: StorageStub) =>
  stub.requests.filter((r) => r.method === 'POST' && r.pathname.startsWith(CREATE_ROUTE))
const gets = (stub: StorageStub) => stub.requests.filter((r) => r.method === 'GET')
const PLAN_LINE =
  /^masters: plan objects=\d+ new=\d+ existing=\d+ bytes=\d+ plan=([0-9a-f]{64}) set=([0-9a-f]{64})$/
function planOf(out: readonly string[]): { plan: string; set: string } {
  const match = PLAN_LINE.exec(out.find((line) => PLAN_LINE.test(line)) ?? '')
  if (match === null) throw new Error('test: no plan line')
  return { plan: match[1]!, set: match[2]! }
}
const readReport = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(reportDir(), 'publisher-masters.json'), 'utf8')) as Record<
    string,
    unknown
  >
const notFound = (): StubBehaviour => ({
  kind: 'answer',
  status: 400,
  body: '{"statusCode":"404","error":"not_found","message":"Object not found"}',
})
const answer = (status: number, body: string | Uint8Array = '{}'): StubBehaviour => ({
  kind: 'answer',
  status,
  body,
})
const passThrough = (): StubBehaviour => ({ kind: 'delay', ms: 0 })

/** A directory link (a junction on win32); null with the PB3 skip line where links are refused. */
function linkTo(target: string, link: string): string | null {
  try {
    symlinkSync(target, link, 'junction')
    return link
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') {
      console.log('skipped: this host refuses links (S14 PB3)')
      return null
    }
    throw error
  }
}
/** The 8.3 short form of `path` (cmd's `%~sI`) on a win32 host, or null on any other host. */
function shortPathOf(path: string): string | null {
  if (process.platform !== 'win32') return null
  const command = `"for %I in ("${path}") do @echo %~sI"`
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
    encoding: 'utf8',
    windowsVerbatimArguments: true,
  })
  if (result.status !== 0) throw new Error('test setup: cmd gave no 8.3 short name')
  return result.stdout.trim()
}

describe('masters: the root (D17-23)', () => {
  it(
    'T17-30 the --masters root: its real path must equal the resolved one, folded on win32 (D15-28); else masters-root, exit 1, before any client (A25, D17-23, CRIT-7)',
    TIMEOUT,
    async () => {
      const stub = await newStub()
      const dir = writeTree(SETUP())
      const plain = await run(dir, ['--dry-run'], { stub })
      expect(plain.exit, 'precondition: the plain root dry run exits 0').toBe(0)
      const refusals: Ran[] = []
      const before = stub.requests.length

      // (g1) injected real paths
      const injected: [string, (p: string) => string][] = [
        ['a subst pair', () => 'Z:\\s17-subst\\m'],
        ['an 8.3 pair', (p) => join(dirname(p), 'S17-MA~1')],
        ['a mapped drive', () => '\\\\host\\share\\m'],
        ['a Volume path', () => '\\\\?\\Volume{0}\\m'],
        [
          'a throw',
          () => {
            throw new Error('realpath failed')
          },
        ],
      ]
      for (const [label, realPath] of injected) {
        const r = await run(dir, ['--dry-run'], { stub, realPath })
        refusals.push(r)
        expect
          .soft([r.exit, lastLine(r.out)], `(g1) ${label}`)
          .toEqual([1, stopped('masters-root')])
        expect.soft(readReport().outcome, `(g1) ${label}: report outcome`).toBe('masters-root')
      }

      // (g2) on disk: a link at the root; the root's 8.3 short form
      const link = linkTo(dir, join(root, 'm-link'))
      if (link !== null) {
        const r = await run(link, ['--dry-run'], { stub })
        refusals.push(r)
        expect
          .soft([r.exit, lastLine(r.out)], '(g2) a link as the root')
          .toEqual([1, stopped('masters-root')])
      }
      const short = shortPathOf(dir)
      if (short !== null && short.toLowerCase() !== dir.toLowerCase()) {
        const r = await run(short, ['--dry-run'], { stub })
        refusals.push(r)
        expect
          .soft([r.exit, lastLine(r.out)], '(g2) the root 8.3 form')
          .toEqual([1, stopped('masters-root')])
      } else {
        console.log('skipped: the 8.3 sample needs a win32 volume that keeps short names')
      }

      // (g3) the case fold: win32 folds as NTFS does, posix keeps case
      const mis = writeTree(SETUP(), 'mis')
      for (const variant of ['MIS', 'mıs', 'miſ']) {
        const realPath = () => join(root, variant)
        const win = await run(mis, ['--dry-run'], { stub, realPath, platform: 'win32' })
        expect
          .soft([win.exit, lastLine(win.out).startsWith('masters: plan ')], `(g3) win32 ${variant}`)
          .toEqual([0, true])
        const posix = await run(mis, ['--dry-run'], { stub, realPath, platform: 'linux' })
        refusals.push(posix)
        expect
          .soft([posix.exit, lastLine(posix.out)], `(g3) linux ${variant}`)
          .toEqual([1, stopped('masters-root')])
      }
      const upperDrive = await run(mis, ['--dry-run'], {
        stub,
        realPath: (p) => p.toUpperCase(),
        platform: 'win32',
      })
      expect.soft(upperDrive.exit, '(g3) win32: an upper-case real path passes').toBe(0)

      // (g4) every refusal precedes the client
      expect(refusals.length, 'precondition: refusals were run').toBeGreaterThanOrEqual(8)
      expect.soft(plain.made, '(g4) the passing root builds one client').toBe(1)
      expect
        .soft(
          refusals.map((r) => r.made),
          '(g4) makePort never called on a refusal',
        )
        .toEqual(refusals.map(() => 0))
      const reads = stub.requests.length - before
      expect.soft(reads, '(g4) only the passing win32 samples read (5 objects each)').toBe(5 * 4)
    },
  )
})

describe('masters: the local tree', () => {
  it(
    'T17-31 the local listing: class objects by exact name only; a snapshot folder holds exactly the media-log pair or the image log; nothing is masters-empty; per-class counts printed (A26, CRIT-12, TP17-9)',
    TIMEOUT,
    async () => {
      const stub = await newStub()
      const base = await run(writeTree(SETUP()), ['--dry-run'], { stub })
      expect(
        base.out.filter((line) => line.startsWith('masters: object ')).length,
        'precondition: the setup tree plans 5 objects',
      ).toBe(5)
      const refusedAs = async (label: string, group: string, code: string, dir: string) => {
        const r = await run(dir, ['--dry-run'], { stub })
        expect
          .soft([r.exit, lastLine(r.out), r.made], `(${group}) ${label}`)
          .toEqual([1, stopped(code), 0])
      }
      const withExtra = (extra: Entry[]) => writeTree([...SETUP(), ...extra])
      const renamed = (from: string, to: string) => {
        const dir = writeTree(SETUP())
        renameSync(join(dir, ...from.split('/')), join(dir, ...to.split('/')))
        return dir
      }
      const thumbs = enc('x')

      // (g1) masters-unknown-file
      const g1: [string, () => string][] = [
        ['Thumbs.db at the root', () => withExtra([['Thumbs.db', thumbs]])],
        ['Thumbs.db in images/', () => withExtra([['images/Thumbs.db', thumbs]])],
        ['Thumbs.db in a story folder', () => withExtra([['images/story-aa/Thumbs.db', thumbs]])],
        [
          'Thumbs.db in a snapshot folder',
          () => withExtra([[`media-log/2026-11-13-${LOG_SHA12}/Thumbs.db`, thumbs]]),
        ],
        ['Images/', () => renamed('images', 'Images')],
        ['images/Story-aa/', () => renamed('images/story-aa', 'images/Story-aa')],
        ['images/ab/', () => withExtra([[`images/ab/${SHA_A}.png`, MASTER_A]])],
        ['<sha>.PNG', () => renamed(PATH_A, PATH_A.replace('.png', '.PNG'))],
        ['<sha>.jpeg', () => renamed(PATH_A, PATH_A.replace('.png', '.jpeg'))],
        ['<sha>.png.bak', () => renamed(PATH_A, `${PATH_A}.bak`)],
        ['a 63-hex name', () => renamed(PATH_A, `images/story-aa/${SHA_A.slice(1)}.png`)],
        ['media-log/x/', () => withExtra([['media-log/x/media-log.json', LOG]])],
        [
          'an empty images/story-bb/',
          () => {
            const dir = writeTree(SETUP())
            mkdirSync(join(dir, 'images', 'story-bb'))
            return dir
          },
        ],
      ]
      for (const [label, make] of g1) await refusedAs(label, 'g1', 'masters-unknown-file', make())

      // (g2) media-log-folder-invalid
      const folder = `media-log/2026-11-13-${LOG_SHA12}`
      const images: Entry[] = [
        [PATH_A, MASTER_A],
        [PATH_B, MASTER_B],
      ]
      const g2: [string, Entry[]][] = [
        ['media-log.json alone', [...images, [PATH_LOG, LOG]]],
        ['the history alone', [...images, [PATH_HISTORY, HISTORY]]],
        [
          'media-log.json with image-log.json',
          [...images, [PATH_LOG, LOG], [`${folder}/image-log.json`, IMAGE_LOG]],
        ],
        [
          'all three',
          [
            ...images,
            [PATH_LOG, LOG],
            [PATH_HISTORY, HISTORY],
            [`${folder}/image-log.json`, IMAGE_LOG],
          ],
        ],
        [
          'a date 2026-02-30',
          [
            ...images,
            [`media-log/2026-02-30-${LOG_SHA12}/media-log.json`, LOG],
            [`media-log/2026-02-30-${LOG_SHA12}/media-log.history.jsonl`, HISTORY],
          ],
        ],
        ['a folder inside a snapshot folder', [...SETUP(), [`${folder}/sub/x.json`, LOG]]],
        [
          'two folders with one sha12',
          [
            ...SETUP(),
            [`media-log/2026-11-23-${LOG_SHA12}/media-log.json`, LOG],
            [`media-log/2026-11-23-${LOG_SHA12}/media-log.history.jsonl`, HISTORY],
          ],
        ],
      ]
      for (const [label, entries] of g2) {
        await refusedAs(label, 'g2', 'media-log-folder-invalid', writeTree(entries))
      }

      // (g3) a folder where a file belongs; a file where a folder belongs; a link at each level
      const folderAsFile = writeTree(SETUP())
      mkdirSync(join(folderAsFile, 'images', 'story-aa', `${'c'.repeat(64)}.png`))
      await refusedAs('a folder named <sha>.png', 'g3', 'local-file-not-regular', folderAsFile)
      const elsewhere = writeTree([[`story-cc/${SHA_A}.png`, MASTER_A]], 'elsewhere')
      const linked = writeTree(SETUP())
      if (linkTo(join(elsewhere, 'story-cc'), join(linked, 'images', 'story-cc')) !== null) {
        await refusedAs('a link inside images/', 'g3', 'local-file-not-regular', linked)
      }
      const imagesElsewhere = writeTree([[`story-aa/${SHA_A}.png`, MASTER_A]], 'images-elsewhere')
      const imagesLinked = writeTree([
        [PATH_LOG, LOG],
        [PATH_HISTORY, HISTORY],
      ])
      if (linkTo(imagesElsewhere, join(imagesLinked, 'images')) !== null) {
        await refusedAs('a link as images/', 'g3', 'local-file-not-regular', imagesLinked)
      }
      const logElsewhere = writeTree(
        [
          ['media-log.json', LOG],
          ['media-log.history.jsonl', HISTORY],
        ],
        'log-elsewhere',
      )
      const logLinked = writeTree([[PATH_A, MASTER_A]])
      mkdirSync(join(logLinked, 'media-log'))
      if (linkTo(logElsewhere, join(logLinked, 'media-log', `2026-11-13-${LOG_SHA12}`)) !== null) {
        await refusedAs('a link as a snapshot folder', 'g3', 'local-file-not-regular', logLinked)
      }
      const fileLinked = writeTree([
        [PATH_LOG, LOG],
        [PATH_HISTORY, HISTORY],
      ])
      mkdirSync(join(fileLinked, 'images', 'story-aa'), { recursive: true })
      let fileLink = true
      try {
        symlinkSync(
          join(elsewhere, 'story-cc', `${SHA_A}.png`),
          join(fileLinked, ...PATH_A.split('/')),
          'file',
        )
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EPERM' && code !== 'EACCES') throw error
        console.log('skipped: this host refuses file links (S14 PB3)')
        fileLink = false
      }
      if (fileLink)
        await refusedAs('a file link as a master', 'g3', 'local-file-not-regular', fileLinked)
      const imagesFile = writeTree([
        [PATH_LOG, LOG],
        [PATH_HISTORY, HISTORY],
        ['images', enc('x')],
      ])
      await refusedAs(
        'a file named images (a folder that fails to list)',
        'g3',
        'local-file-not-regular',
        imagesFile,
      )
      const storyFile = writeTree([
        [PATH_LOG, LOG],
        [PATH_HISTORY, HISTORY],
        ['images/story-aa', enc('x')],
      ])
      await refusedAs('a file named images/story-aa', 'g3', 'local-file-not-regular', storyFile)

      // (g4) nothing is masters-empty
      await refusedAs('an empty root', 'g4', 'masters-empty', writeTree([]))
      const emptyFolders = writeTree([])
      mkdirSync(join(emptyFolders, 'images'))
      mkdirSync(join(emptyFolders, 'media-log'))
      await refusedAs('empty images/ and media-log/', 'g4', 'masters-empty', emptyFolders)

      // (g5) full-path UTF-16 order, the classes line first
      const ordered = writeTree([
        [`images/abc/${SHA_A}.png`, MASTER_A],
        [`images/abc-d/${SHA_B}.png`, MASTER_B],
        [PATH_LOG, LOG],
        [PATH_HISTORY, HISTORY],
        [PATH_IMAGE_LOG, IMAGE_LOG],
      ])
      const r = await run(ordered, ['--dry-run'], { stub })
      const objects = r.out
        .filter((line) => line.startsWith('masters: object '))
        .map((line) => line.split(' ')[2])
      expect
        .soft(objects.slice(0, 2), '(g5) images/abc-d/ before images/abc/')
        .toEqual([`images/abc-d/${SHA_B}.png`, `images/abc/${SHA_A}.png`])
      expect
        .soft(r.out[0], '(g5) the classes line first')
        .toBe('masters: classes image-master=2 media-log=3')
      expect.soft(PLAN_LINE.test(lastLine(r.out)), '(g5) the plan line last').toBe(true)
    },
  )

  it(
    'T17-32 every local file passes masterBodyRule before planning (A23, A26, TP17-6)',
    TIMEOUT,
    async () => {
      const stub = await newStub()
      expect(
        (await run(writeTree(SETUP()), ['--dry-run'], { stub })).exit,
        'precondition: the setup tree passes',
      ).toBe(0)
      const images: Entry[] = [[PATH_B, MASTER_B]]
      const masterNamed = async (bytes: Uint8Array<ArrayBuffer>, ext: string, sha?: string) =>
        `images/story-aa/${sha ?? (await sha256Hex(bytes))}.${ext}`
      const logFolder = async (bytes: Uint8Array<ArrayBuffer>, sha12?: string) =>
        `media-log/2026-11-13-${sha12 ?? (await sha256Hex(bytes)).slice(0, 12)}`
      const withLog = async (bytes: Uint8Array<ArrayBuffer>, sha12?: string): Promise<Entry[]> => {
        const folder = await logFolder(bytes, sha12)
        return [
          ...images,
          [`${folder}/media-log.json`, bytes],
          [`${folder}/media-log.history.jsonl`, HISTORY],
        ]
      }
      const withImageLog = async (bytes: Uint8Array<ArrayBuffer>): Promise<Entry[]> => [
        ...images,
        [`${await logFolder(bytes)}/image-log.json`, bytes],
      ]
      const withHistory = (bytes: Uint8Array): Entry[] => [
        ...images,
        [PATH_LOG, LOG],
        [PATH_HISTORY, bytes],
      ]
      const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2)
      const noIhdr = MASTER_A.slice()
      noIhdr.set(enc('IDAT'), 12)
      const bytesOf = (...parts: (string | number[])[]): Uint8Array<ArrayBuffer> => {
        const chunks = parts.map((p) => (typeof p === 'string' ? enc(p) : Uint8Array.from(p)))
        const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
        let at = 0
        for (const c of chunks) {
          out.set(c, at)
          at += c.byteLength
        }
        return out
      }
      const samples: [string, Entry[]][] = [
        [
          'a PNG whose sha256 is not its name',
          [...images, [await masterNamed(MASTER_A, 'png', 'c'.repeat(64)), MASTER_A]],
        ],
        ['.png holding a JPEG', [...images, [await masterNamed(jpeg, 'png'), jpeg]]],
        ['.jpg holding a PNG', [...images, [await masterNamed(MASTER_A, 'jpg'), MASTER_A]]],
        ['a signature with no IHDR at 12', [...images, [await masterNamed(noIhdr, 'png'), noIhdr]]],
        ['media-log.json with a BOM', await withLog(bytesOf([0xef, 0xbb, 0xbf], '[]'))],
        ['media-log.json C3 28', await withLog(bytesOf('["', [0xc3, 0x28], '"]'))],
        ['media-log.json an object', await withLog(enc('{}'))],
        ['media-log.json an own __proto__', await withLog(enc('[{"__proto__":1}]'))],
        ['media-log.json "\\ud800"', await withLog(enc('["\\ud800"]'))],
        ['media-log.json not starting with its sha12', await withLog(LOG, 'abcdef012345')],
        ['image-log.json as an array', await withImageLog(enc('[]'))],
        [
          'image-log.json not JCS',
          await withImageLog(enc('{"schema": "image-log@1", "images": []}')),
        ],
        [
          'image-log.json schema image-log@2',
          await withImageLog(enc('{"images":[],"schema":"image-log@2"}')),
        ],
        ['the history without its final LF', withHistory(enc('{"a":1}'))],
        ['the history with an empty line', withHistory(enc('{"a":1}\n\n'))],
        ['the history with a CR', withHistory(enc('{"a":1}\r\n'))],
        ['the history with a line [1]', withHistory(enc('[1]\n'))],
        ['the history of 0 bytes', withHistory(new Uint8Array(0))],
      ]
      for (const [label, entries] of samples) {
        const r = await run(writeTree(entries), ['--dry-run'], { stub })
        expect
          .soft([r.exit, lastLine(r.out), r.made], `(g1) ${label}`)
          .toEqual([1, stopped('masters-local-invalid'), 0])
      }
    },
  )
})

describe('masters: the plan and the commit', () => {
  it(
    'T17-33 plan by authenticated reads: new, existing or differs; a failed read stops; --expect-plan compared before any write; dry run and unchanged (A26, A27, L7-1, TP17-8)',
    TIMEOUT,
    async () => {
      const dir = writeTree(SETUP())
      const empty = await newStub()
      const dry = await run(dir, ['--dry-run'], { stub: empty })
      const objectLine = `masters: object ${PATH_A} bytes=${MASTER_A.byteLength} sha256=${SHA_A.slice(0, 12)} state=new`
      expect(dry.exit, 'precondition: the dry run exits 0').toBe(0)
      expect(
        dry.out.filter((line) => line.endsWith(' state=new')).length,
        'precondition: an empty stub plans 5 new',
      ).toBe(5)
      expect(dry.out.includes(objectLine), 'precondition: the object line of the wide master').toBe(
        true,
      )
      expect(dry.out[0], 'precondition: the classes line').toBe(
        'masters: classes image-master=2 media-log=3',
      )
      const total = ALL_PATHS.reduce((n, p) => n + BYTES_OF.get(p)!.byteLength, 0)
      expect(
        lastLine(dry.out).startsWith(
          `masters: plan objects=5 new=5 existing=0 bytes=${total} plan=`,
        ),
        'precondition: the plan line',
      ).toBe(true)
      const first = planOf(dry.out)

      // (g1) existing, differs, and the large master read under its own cap
      const holding = async (entries: Entry[]) => {
        const stub = await newStub()
        for (const [path, bytes] of entries) stub.put('masters', path, bytes, TYPE_OF[path])
        return stub
      }
      const equal = await holding([[PATH_LOG, LOG]])
      const equalRun = await run(dir, ['--dry-run'], { stub: equal })
      expect
        .soft(
          equalRun.out.some(
            (l) => l.startsWith(`masters: object ${PATH_LOG} `) && l.endsWith('state=existing'),
          ),
          '(g1) equal bytes: existing',
        )
        .toBe(true)
      for (const [label, path, other] of [
        ['an image master', PATH_A, MASTER_B],
        ['the history', PATH_HISTORY, enc('{"c":3}\n')],
      ] as const) {
        const stub = await holding([[path, other]])
        const r = await run(dir, ['--expect-plan', first.plan], { stub })
        expect
          .soft([r.exit, lastLine(r.out), posts(stub).length], `(g1) other bytes under ${label}`)
          .toEqual([1, stopped('master-exists-differs'), 0])
      }
      const big = await holding([[PATH_B, MASTER_B]])
      const bigRun = await run(dir, ['--dry-run'], { stub: big })
      expect
        .soft(
          bigRun.out.some(
            (l) =>
              l.startsWith(`masters: object ${PATH_B} bytes=2076066 `) &&
              l.endsWith('state=existing'),
          ),
          '(g1) the 2,076,066-byte master stored: existing',
        )
        .toBe(true)

      // (g2) a failed read stops at exit 1 with 0 POST
      const failing: [string, (stub: StorageStub) => void, string][] = [
        ['GET 500', (s) => s.override('GET', READ_ROUTE + PATH_A, answer(500)), 'storage-failed'],
        [
          'GET 401',
          (s) => s.override('GET', READ_ROUTE + PATH_A, answer(401)),
          'storage-unauthorized',
        ],
        [
          'an image master of 20,971,521 bytes',
          (s) => s.put('masters', PATH_A, new Uint8Array(20_971_521), 'image/png'),
          'master-unverifiable',
        ],
      ]
      for (const [label, setup, code] of failing) {
        const stub = await newStub()
        setup(stub)
        const r = await run(dir, ['--expect-plan', first.plan], { stub })
        expect
          .soft([r.exit, lastLine(r.out), posts(stub).length], `(g2) ${label}`)
          .toEqual([1, stopped(code), 0])
      }

      // (g3) a blind read (L7-1): planned new, the create answers duplicate, the read-back decides
      const blind = await holding([[PATH_A, MASTER_A]])
      blind.override('GET', READ_ROUTE + PATH_A, notFound())
      const blindDry = await run(dir, ['--dry-run'], { stub: blind })
      expect(
        planOf(blindDry.out),
        'precondition: the blind read plans as on an empty stub',
      ).toEqual(first)
      blind.override('GET', READ_ROUTE + PATH_A, notFound())
      const blindRun = await run(dir, ['--expect-plan', first.plan], { stub: blind })
      expect
        .soft(
          [blindRun.exit, lastLine(blindRun.out)],
          '(g3) the duplicate read back identical: counted existing',
        )
        .toEqual([0, 'masters: done created=4 existing=1'])

      // (g4) --expect-plan before any write, in a dry run too
      const other = 'f'.repeat(64)
      const changed = await newStub()
      const changedRun = await run(dir, ['--expect-plan', other], { stub: changed })
      expect
        .soft(
          [changedRun.exit, lastLine(changedRun.out), posts(changed).length],
          '(g4) differing: plan-changed, 0 POST',
        )
        .toEqual([1, stopped('plan-changed'), 0])
      expect.soft(readReport().outcome, '(g4) differing: report outcome').toBe('plan-changed')
      const proceeds = await newStub()
      const proceedsRun = await run(dir, ['--expect-plan', first.plan], { stub: proceeds })
      expect
        .soft([proceedsRun.exit, posts(proceeds).length], '(g4) equal: proceeds')
        .toEqual([0, 5])
      const dryEqual = await run(dir, ['--dry-run', '--expect-plan', first.plan], { stub: empty })
      expect
        .soft([dryEqual.exit, readReport().outcome], '(g4) dry run equal: dry-run')
        .toEqual([0, 'dry-run'])
      const dryOther = await run(dir, ['--dry-run', '--expect-plan', other], { stub: empty })
      expect
        .soft([dryOther.exit, lastLine(dryOther.out)], '(g4) dry run differing: plan-changed')
        .toEqual([1, stopped('plan-changed')])

      // (g5) the digests recomputed; a state moves the plan, not the set
      const objects = ALL_PATHS.map((path) => ({ path, state: 'new' }))
      const recompute = async (states: readonly { path: string; state: string }[]) =>
        planDigests(
          'masters',
          await Promise.all(
            states.map(async ({ path, state }) => ({
              path,
              sha256: await sha256Hex(BYTES_OF.get(path)! as Uint8Array<ArrayBuffer>),
              bytes: BYTES_OF.get(path)!.byteLength,
              contentType: TYPE_OF[path]!,
              state,
            })),
          ),
          { fixed: {}, variable: {} },
        )
      expect.soft(first, '(g5) plan and set equal planDigests').toEqual(await recompute(objects))
      const oneExisting = planOf(equalRun.out)
      expect.soft(oneExisting.set, '(g5) one object existing: the set stays').toBe(first.set)
      expect.soft(oneExisting.plan !== first.plan, '(g5) and the plan moves').toBe(true)
      expect
        .soft(oneExisting, '(g5) the moved plan equals planDigests with that state')
        .toEqual(
          await recompute(
            objects.map((o) => (o.path === PATH_LOG ? { ...o, state: 'existing' } : o)),
          ),
        )

      // (g6) the dry run and an unchanged plan write nothing
      expect.soft(posts(empty).length, '(g6) the dry runs: 0 POST').toBe(0)
      const all = await holding(SETUP())
      const allDry = await run(dir, ['--dry-run'], { stub: all })
      const unchanged = await run(dir, ['--expect-plan', planOf(allDry.out).plan], { stub: all })
      expect
        .soft([unchanged.exit, posts(all).length], '(g6) every object existing: exit 0, 0 POST')
        .toEqual([0, 0])
      expect
        .soft(readReport().outcome, '(g6) report outcome masters-unchanged')
        .toBe('masters-unchanged')
    },
  )

  it(
    'T17-34 the commit: create-only, x-upsert false, the class type, cache 0; each created object read back by full hash; each failure kind at exit 3; the deadline; the report and lines hold storage paths only (A26, CRIT-1, TP17-14)',
    TIMEOUT,
    async () => {
      const dir = writeTree(SETUP())
      const planStub = await newStub()
      const { plan } = planOf((await run(dir, ['--dry-run'], { stub: planStub })).out)
      const stub = await newStub()
      const done = await run(dir, ['--expect-plan', plan], { stub })
      expect([done.exit, lastLine(done.out)], 'precondition: masters-written').toEqual([
        0,
        'masters: done created=5 existing=0',
      ])
      expect(readReport().outcome, 'precondition: report outcome').toBe('masters-written')

      // (g1) the creates and their read-backs
      const creates = posts(stub)
      expect.soft(creates.length, '(g1) 5 POST').toBe(5)
      for (const r of creates) {
        const path = r.pathname.slice(CREATE_ROUTE.length)
        expect.soft(r.values['x-upsert'], `(g1) x-upsert false ${path}`).toBe('false')
        expect.soft(r.values['cache-control'], `(g1) max-age=0 ${path}`).toBe('max-age=0')
        expect.soft(r.values['content-type'], `(g1) content type ${path}`).toBe(TYPE_OF[path])
      }
      for (const path of ALL_PATHS) {
        expect
          .soft(
            gets(stub).filter((r) => r.pathname === READ_ROUTE + path).length,
            `(g1) the plan read and one read-back: ${path}`,
          )
          .toBe(2)
        expect
          .soft(stub.object('masters', path)?.bytes.byteLength, `(g1) stored ${path}`)
          .toBe(BYTES_OF.get(path)!.byteLength)
      }

      // (g2) the read-back decides
      const readBack: [string, StubBehaviour, string][] = [
        ['other bytes', answer(200, MASTER_B), 'master-readback-differs'],
        ['500', answer(500), 'master-unverifiable'],
      ]
      for (const [label, behaviour, code] of readBack) {
        const s = await newStub()
        s.override('GET', READ_ROUTE + PATH_A, passThrough())
        s.override('GET', READ_ROUTE + PATH_A, behaviour)
        const r = await run(dir, ['--expect-plan', plan], { stub: s })
        expect
          .soft([r.exit, lastLine(r.out)], `(g2) the read-back answered ${label}`)
          .toEqual([3, stopped(code)])
      }
      expect
        .soft(
          stub.object('masters', PATH_B)?.bytes.byteLength,
          '(g2) the 2,076,066-byte master stored and read back identical',
        )
        .toBe(BIG_SIZE)

      // (g3) a create answered duplicate (the plan read blind): identical, different, unchecked
      const duplicate: [string, Uint8Array, StubBehaviour[], number, string][] = [
        ['equal stored bytes', MASTER_A, [notFound()], 0, 'masters: done created=4 existing=1'],
        ['other stored bytes', MASTER_B, [notFound()], 3, stopped('master-exists-differs')],
        [
          'the read-back failing',
          MASTER_A,
          [notFound(), answer(500)],
          3,
          stopped('master-unverifiable'),
        ],
      ]
      for (const [label, stored, behaviours, exit, line] of duplicate) {
        const s = await newStub()
        s.put('masters', PATH_A, stored, 'image/png')
        for (const behaviour of behaviours) s.override('GET', READ_ROUTE + PATH_A, behaviour)
        const r = await run(dir, ['--expect-plan', plan], { stub: s })
        expect.soft([r.exit, lastLine(r.out)], `(g3) duplicate: ${label}`).toEqual([exit, line])
      }

      // (g4) mime-refused, a local file changed after the plan, the deadline
      const mime = await newStub()
      mime.override('POST', CREATE_ROUTE + PATH_A, answer(415))
      const mimeRun = await run(dir, ['--expect-plan', plan], { stub: mime })
      expect
        .soft([mimeRun.exit, lastLine(mimeRun.out)], '(g4) 415: mime-refused at exit 3')
        .toEqual([3, stopped('mime-refused')])
      const changedDir = writeTree(SETUP())
      const changed = await newStub()
      const changedRun = await run(changedDir, ['--expect-plan', plan], {
        stub: changed,
        onLog: (line) => {
          if (PLAN_LINE.test(line))
            writeFileSync(join(changedDir, ...PATH_LOG.split('/')), enc('[1]'))
        },
      })
      expect
        .soft(
          [changedRun.exit, lastLine(changedRun.out)],
          '(g4) a local file rewritten after the plan',
        )
        .toEqual([3, stopped('local-file-changed')])
      const late = await newStub()
      const clock = fakeClock()
      let posted = 0
      const lateRun = await run(dir, ['--expect-plan', plan], {
        stub: late,
        clock,
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const response = await globalThis.fetch(input, init)
          if (init?.method === 'POST' && ++posted === 1) clock.advance(3_600_001)
          return response
        }) as typeof fetch,
      })
      expect
        .soft(
          [lateRun.exit, lastLine(lateRun.out), posts(late).length],
          '(g4) past the deadline after the first create',
        )
        .toEqual([3, stopped('deadline'), 1])

      // (g5) the report and lines: storage paths, counts and hashes only
      const r = await run(dir, ['--expect-plan', plan], { stub: await newStub() })
      const report = readReport()
      expect
        .soft(
          [report.command, report.mode, report.exitCode, report.outcome],
          '(g5) command, mode, exit and code',
        )
        .toEqual(['masters', 'masters', 0, 'masters-written'])
      const section = report.masters as Record<string, unknown>
      expect
        .soft([section.plan, section.set], '(g5) the digests')
        .toEqual([plan, planOf(r.out).set])
      expect.soft(section.objects, '(g5) the objects: path, bytes, sha256, state').toEqual(
        await Promise.all(
          ALL_PATHS.map(async (path) => ({
            path,
            bytes: BYTES_OF.get(path)!.byteLength,
            sha256: await sha256Hex(BYTES_OF.get(path)! as Uint8Array<ArrayBuffer>),
            state: 'created',
          })),
        ),
      )
      const texts = [
        ...r.out,
        ...r.err,
        readFileSync(join(reportDir(), 'publisher-masters.json'), 'utf8'),
        readFileSync(join(reportDir(), 'publisher-masters.md'), 'utf8'),
      ].join('\n')
      for (const path of [dir, reportDir(), root]) {
        const forms = [
          path,
          JSON.stringify(path).slice(1, -1),
          path.replaceAll('\\', '/'),
          encodeURIComponent(path),
          pathToFileURL(path).href,
        ]
        for (const form of forms) {
          expect
            .soft(texts.includes(form), `(g5) no ${JSON.stringify(form)} in any line or report`)
            .toBe(false)
        }
      }
      expect.soft(texts.includes(FAKE_KEY), '(g5) no key in any line or report').toBe(false)
    },
  )
})

// ---- type samples (A24; compile time: MU17-T1 and MU17-T2 turn an expect-error unused, TS2578) ----

export function mastersTypeSamples(
  client: StorageClient,
  writer: StageWriter,
  reader: StorageReader,
  refs: { approval: ApprovalRef; master: ImageMasterRef; log: MediaLogRef },
): MastersPort {
  const port: MastersPort = client
  // @ts-expect-error MastersPort.create takes the two masters classes only, never an approval
  void port.create(refs.approval, new Uint8Array(1))
  // @ts-expect-error StageWriter.create takes package, media and snapshot refs only
  void writer.create(refs.master, new Uint8Array(1))
  // @ts-expect-error StorageReader.readMaster takes approvals and waivers only
  void reader.readMaster(refs.log)
  return port
}
