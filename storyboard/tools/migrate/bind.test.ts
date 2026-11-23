// P1-9a (Step 17) the media binder (design migration-input/p1-step17-design.md D17-3, D17-10, D17-12,
// D17-13, D17-14, D17-18, D17-22, D17-26 to D17-29, §3.3, §3.10, §3.12-§3.14, §3.18, §3.22, A14-A21,
// A30-A32, A35, A43; test plan 14.8: T17-15 to T17-28). The binder runs on an in-memory world built
// from fixtures/packages/two-paths.json (S1) and lantern-walk.json (S2) with a fake codec; every
// write goes under the test's own OS temp folder (`s17-out-…`). T17-26 stages and uploads the output
// through the loopback storage stub with a fake key assembled at run time. T17-28 is a source check
// of bind-real-data.test.ts. Titles start with their id; one expect.soft per claim, messages
// "(gN) <claim> <sample>"; preconditions are hard expects starting "precondition:".
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { jcsBytes } from '../../src/core/hashing'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { keyOf as entryKey, buildEntriesFor } from '../narration/parler-pipeline'
import type { ParlerPlanEntry } from '../narration/parler'
import { parseArgs } from '../publisher/args'
import { Secret } from '../publisher/env'
import type { LocalRead } from '../publisher/local-files'
import { runMasters } from '../publisher/masters'
import type { MastersPort } from '../publisher/port'
import { runStage } from '../publisher/stage'
import { waiverBytesOf, waiverFileOf } from '../publisher/stage-testkit'
import { createStorageClient } from '../publisher/storage'
import { expectNoUnexpected, startStorageStub, type StorageStub } from '../publisher/storage-stub'
import { runBind, type BindDeps, type BindInputs } from './bind'
import { localLegacyIo, runBindCli, type BindCliDeps } from './bind-cli'
import { nodeOutputFs, type OutputFs } from './bind-output'
import { convertLegacyStory } from './convert'
import { EXPECTED_ENCODER, WEBP_SETTINGS, type ImageCodec } from './image-codec'
import { countImageRows, deriveLegacyImageRows } from './legacy-images'
import { loadFrozenLegacyStories, type LegacyStory } from './load-legacy'
import { mp3Frames, pngOf, vp8Of, vp8xData } from './media-fixtures'
import { readPngFacts } from './png-facts'
import { applyTextCorrections, type TextCorrection } from './text-corrections'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const enc = (text: string) => new TextEncoder().encode(text)
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const byCode = <T extends { storyId: string }>(list: readonly T[]) =>
  [...list].sort((a, b) => (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0))
const NOW = '2026-11-23T10:00:00.000Z'
const S1 = 'two-paths'
const S2 = 'lantern-walk'
const HAN = '\u7425'
const TIMEOUT = { timeout: 120_000 }
const SETTINGS_SHA256 = sha(jcsBytes(WEBP_SETTINGS))
const HERE = fileURLToPath(new URL('.', import.meta.url))
const FIXTURES = fileURLToPath(new URL('../../fixtures/packages/', import.meta.url))
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0])

// ---- the world (14.8) ----

const fixture = (name: string): StoryPackageV1 =>
  StoryPackageV1.parse(JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')))
const P1 = { [S1]: fixture(S1), [S2]: fixture(S2) } as const

/** The legacy story a phase-1 package converts from (convert.ts inverted), with the given images. */
function legacyOf(
  pkg: StoryPackageV1,
  images: Readonly<Record<string, string>>,
  hiStart?: string,
): LegacyStory {
  const en = pkg.text.en!
  const hi = pkg.text.hi!
  const pick = (field: 'title' | 'description' | 'theme' | 'duration' | 'book') => ({
    en: en[field],
    hi: hi[field],
  })
  const nodes = Object.fromEntries(
    pkg.nodes.map((n) => {
      const e = en.nodes[n.id]!
      const h = hi.nodes[n.id]!
      const node: Record<string, unknown> = {
        scene: n.scene,
        ...(images[n.id] !== undefined ? { image: images[n.id] } : {}),
        text: { en: e.text, hi: n.id === 'start' && hiStart !== undefined ? hiStart : h.text },
      }
      if (e.question !== undefined) node.question = { en: e.question, hi: h.question }
      if (n.type !== 'ending') {
        node.choices = n.choices.map((c) => ({
          text: { en: e.choices?.[c.id], hi: h.choices?.[c.id] },
          next: c.next,
        }))
      }
      if (n.isAlternate) node.isAlternate = true
      if (n.type === 'ending') {
        node.isEnding = true
        if (e.lesson !== undefined) node.lesson = { en: e.lesson, hi: h.lesson }
        node.lessonIcon = n.lessonIcon
      }
      return [n.id, node]
    }),
  )
  return {
    id: pkg.storyId,
    title: pick('title'),
    description: pick('description'),
    theme: pick('theme'),
    age: pkg.age,
    duration: pick('duration'),
    addedOn: pkg.addedOn,
    featured: false,
    emoji: pkg.emoji,
    color: pkg.color,
    book: pick('book'),
    progressSteps: [...pkg.progressSteps],
    nodes,
  } as unknown as LegacyStory
}

const HI_START = P1[S1].text.hi!.nodes.start!.text
const PLANTED = (() => {
  const cut = HI_START.indexOf(' ')
  return HI_START.slice(0, cut) + HAN + HI_START.slice(cut)
})()
const R: TextCorrection = {
  storyId: S1,
  locale: 'hi',
  nodeId: 'start',
  field: 'text',
  beforeSha256: sha(enc(PLANTED)),
  after: HI_START,
  approvedOn: '2026-11-23',
  approvedBy: 'owner',
}
const IMAGES_S1 = {
  start: '/images/two-paths/start.jpg',
  wise_path: '/images/two-paths/wise_path.png',
  quick_path: '/images/two-paths/quick.jpg',
  ending_wise: '/images/two-paths/gone.png',
}
const IMAGES_S2 = {
  start: '/images/lantern-walk/start.png',
  crossroads: '/images/lantern-walk/crossroads.png',
}
const CANARY = {
  seed: 4294967291,
  revision: ['S17REV', 'CANARY'].join(''),
  environment: ['S17ENV', 'CANARY'].join(''),
  generatedAt: '2031-01-02T03:04:05.000Z',
}
const PROVENANCE = {
  origin: 'ai_generated',
  vendor: 'AI4Bharat',
  product: 'Indic Parler-TTS (Apache-2.0)',
}

let QUICK = new Uint8Array(0)
let WISE = new Uint8Array(0)

interface Spec {
  readonly wise?: Uint8Array
  readonly quick?: Uint8Array
  readonly records?: readonly TextCorrection[]
  /** The packages the media log's entries come from: what the binder computes, or the raw phase 1. */
  readonly logFrom?: 'binder' | 'raw'
  readonly seeds?: Readonly<Record<string, number>>
  readonly stories?: 'both' | 'none'
}

interface World {
  stories: LegacyStory[]
  files: Map<string, Uint8Array>
  phase1: Map<string, Uint8Array>
  phase1Names: string[]
  corrections: Uint8Array
  overrides: Uint8Array
  seedOverrides: Uint8Array | null
  records: Record<string, unknown>[]
  mediaLog: Uint8Array
  history: Uint8Array
  hashLines: string[]
  hashList: Uint8Array
  audio: Map<string, Uint8Array>
  mapRows: Record<string, unknown>[]
  map: Uint8Array
  entries: ParlerPlanEntry[]
}

function setLog(w: World, records: Record<string, unknown>[]): void {
  w.records = records
  w.mediaLog = enc(`${JSON.stringify(records, null, 2)}\n`)
  // One line per record; the first in an older writer's spacing (not JSON.stringify's form).
  w.history = enc(
    records
      .map((r, i) => {
        const line = JSON.stringify(r)
        return i === 0 ? line.replace('{"storyId":', '{ "storyId": ') : line
      })
      .map((line) => `${line}\n`)
      .join(''),
  )
}
function setList(w: World, lines: string[]): void {
  w.hashLines = lines
  w.hashList = enc(lines.map((l) => `${l}\n`).join(''))
}
const KEY_FIELDS = [
  'storyId',
  'nodeId',
  'action',
  'legacyPath',
  'fileSha256',
  'realFormat',
  'size',
  'bytes',
] as const
function setMap(w: World, rows: Record<string, unknown>[], totals?: unknown): void {
  w.mapRows = rows
  w.map = enc(JSON.stringify({ rows, totals: totals ?? null, notes: 'synthetic map' }))
}
/** The map re-derived from the world's stories and files (key fields only). */
function remap(w: World): void {
  const derived = deriveLegacyImageRows(w.stories, (segments, cap) =>
    readMemory(w.files, segments.join('/'), cap),
  )
  if (!derived.ok) throw new Error('test setup: the world does not derive')
  const rows = derived.rows.map(
    (r) => Object.fromEntries(KEY_FIELDS.map((k) => [k, r[k]])) as Record<string, unknown>,
  )
  setMap(w, rows, countImageRows(derived.rows))
}
function readMemory(files: Map<string, Uint8Array>, key: string, cap: number): LocalRead {
  const bytes = files.get(key)
  if (bytes === undefined) return { ok: false, code: 'local-file-missing' }
  if (bytes.length > cap) return { ok: false, code: 'local-file-too-large' }
  return { ok: true, bytes: new Uint8Array(bytes) }
}

async function buildWorld(spec: Spec = {}): Promise<World> {
  const s1 = legacyOf(P1[S1], IMAGES_S1, PLANTED)
  const s2 = legacyOf(P1[S2], IMAGES_S2)
  const stories = spec.stories === 'none' ? [] : [s1, s2]
  const raw = byCode(stories.map((s) => convertLegacyStory(s)))
  const records = spec.records ?? [R]
  const applied = applyTextCorrections(raw, records)
  const logPackages = spec.logFrom === 'raw' || !applied.ok ? raw : applied.packages
  const entries = await buildEntriesFor(logPackages, spec.seeds ?? {})
  const audio = new Map<string, Uint8Array>()
  const log: Record<string, unknown>[] = []
  const lines: string[] = []
  entries.forEach((e, i) => {
    const bytes = mp3Frames(6 + i, entryKey(e))
    audio.set(e.file, bytes)
    log.push({
      storyId: e.storyId,
      nodeId: e.nodeId,
      locale: e.locale,
      file: `audio/${e.file}`,
      bytes: bytes.length,
      sha256: sha(bytes),
      durationMs: (6 + i) * 24,
      narratedTextSha256: e.narratedTextSha256,
      recipe: 'narration-recipe@2',
      modelRevision: CANARY.revision,
      voice: e.voice,
      seed: CANARY.seed,
      environment: CANARY.environment,
      generatedAt: CANARY.generatedAt,
      provenance: { ...PROVENANCE, voice: e.voice },
    })
    lines.push(`${sha(bytes)}  ${e.file}`)
  })
  const w: World = {
    stories,
    files: new Map([
      ['images/two-paths/start.jpg', JPEG],
      ['images/two-paths/wise_path.png', spec.wise ?? WISE],
      ['images/two-paths/quick.jpg', spec.quick ?? QUICK],
    ]),
    phase1: new Map(raw.map((p) => [`${p.storyId}.phase1.json`, jcsBytes(p)])),
    phase1Names: raw.map((p) => `${p.storyId}.phase1.json`),
    corrections: enc(JSON.stringify({ corrections: records })),
    overrides: enc('{ "overrides": [] }\n'),
    seedOverrides: spec.seeds ? enc(JSON.stringify(spec.seeds)) : null,
    records: [],
    mediaLog: new Uint8Array(0),
    history: new Uint8Array(0),
    hashLines: [],
    hashList: new Uint8Array(0),
    audio,
    mapRows: [],
    map: new Uint8Array(0),
    entries,
  }
  setLog(w, log)
  setList(
    w,
    [...lines].sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : a.slice(66) > b.slice(66) ? 1 : 0)),
  )
  remap(w)
  return w
}
const clone = (w: World): World => structuredClone(w)

/** The world's inputs, each read recorded by name. */
function inputsOf(w: World, reads: string[] = []): BindInputs {
  const read = (name: string, bytes: Uint8Array | null, cap: number): LocalRead => {
    reads.push(name)
    if (bytes === null) return { ok: false, code: 'local-file-missing' }
    if (bytes.length > cap) return { ok: false, code: 'local-file-too-large' }
    return { ok: true, bytes: new Uint8Array(bytes) }
  }
  return {
    legacyStories: () => (reads.push('legacy'), w.stories),
    map: (cap) => read('map', w.map, cap),
    legacyFile: (segments, cap) => {
      reads.push(`legacy-file ${segments.join('/')}`)
      return readMemory(w.files, segments.join('/'), cap)
    },
    phase1List: () => (reads.push('phase1-list'), { ok: true, names: [...w.phase1Names].sort() }),
    phase1Read: (name, cap) => read(`phase1 ${name}`, w.phase1.get(name) ?? null, cap),
    corrections: (cap) => read('corrections', w.corrections, cap),
    overrides: (cap) => read('overrides', w.overrides, cap),
    seedOverrides: (cap) => read('seed-overrides', w.seedOverrides, cap),
    mediaLog: (cap) => read('media-log', w.mediaLog, cap),
    history: (cap) => read('history', w.history, cap),
    hashList: (cap) => read('hash-list', w.hashList, cap),
    audio: (segments, cap) => {
      reads.push(`audio ${segments.join('/')}`)
      return readMemory(w.audio, segments.join('/'), cap)
    },
  }
}

// ---- the fake codec (§8) ----

type CodecMode =
  'ok' | 'wrongDims' | 'extraChunk' | 'flaky' | 'throws' | 'versions' | { readonly size: number }

interface FakeCodec {
  readonly codec: ImageCodec
  /** `<master sha12>:<width>` per call, in call order. */
  readonly calls: string[]
}

function fakeCodec(mode: CodecMode = 'ok'): FakeCodec {
  const calls: string[] = []
  let n = 0
  return {
    calls,
    codec: {
      versions: mode === 'versions' ? { ...EXPECTED_ENCODER, vips: '8.18.6' } : EXPECTED_ENCODER,
      async encode(master, width) {
        const facts = readPngFacts(master)
        if (!facts.ok) throw new Error('fake codec: not a PNG')
        const call = n++
        calls.push(`${sha(master).slice(0, 12)}:${width}`)
        if (mode === 'throws') throw new Error('fake codec: encode failed')
        const height = Math.round((facts.facts.height * width) / facts.facts.width)
        if (typeof mode === 'object' && call === 0) {
          if (mode.size % 2 === 1) return new Uint8Array(mode.size)
          return vp8Of({ width, height, seed: 'big', payloadBytes: mode.size - 30 })
        }
        const seed = `${sha(master).slice(0, 12)}:${width}${mode === 'flaky' ? `:flaky:${call}` : ''}`
        return vp8Of({
          width,
          height: mode === 'wrongDims' ? height + 1 : height,
          seed,
          ...(mode === 'extraChunk' ? { after: [{ fourcc: 'EXIF', data: enc('exif') }] } : {}),
        })
      },
    },
  }
}
const nodeOfCall = (call: string) =>
  call.startsWith(sha(WISE).slice(0, 12))
    ? `wise_path:${call.split(':')[1]}`
    : call.startsWith(sha(QUICK).slice(0, 12))
      ? `quick_path:${call.split(':')[1]}`
      : call

// ---- temp roots and runs ----

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
/** A new temp MI (`<tmp>/s17-out-…/mi`); P2 is `<mi>/phase2`, absent. */
function newMi(): string {
  const base = mkdtempSync(join(tmpdir(), 's17-out-'))
  roots.push(base)
  const mi = join(base, 'mi')
  mkdirSync(mi)
  return mi
}
const p2Of = (mi: string) => join(mi, 'phase2')

function hexes() {
  let n = 0
  return () => (++n).toString(16).padStart(8, '0')
}

interface RunOptions {
  readonly dryRun?: boolean
  readonly version?: number
  readonly flag?: string
  readonly codec?: FakeCodec | 'throw'
  readonly mi?: string
  readonly now?: string
  readonly fs?: OutputFs
  readonly inputs?: BindInputs
}
interface Ran {
  readonly exit: number
  readonly lines: string[]
  readonly reads: string[]
  readonly codec: FakeCodec | null
  readonly loads: number
  readonly mi: string
}

async function bind(w: World, o: RunOptions = {}): Promise<Ran> {
  const reads: string[] = []
  const lines: string[] = []
  const codec = o.codec ?? fakeCodec()
  const mi = o.mi ?? newMi()
  let loads = 0
  const deps: BindDeps = {
    inputs: o.inputs ?? inputsOf(w, reads),
    loadCodec: () => {
      loads++
      if (codec === 'throw') throw new Error('fake loader: no codec')
      return codec.codec
    },
    outputRoot: p2Of(mi),
    now: () => new Date(o.now ?? NOW),
    log: (line) => void lines.push(line),
    error: (line) => void lines.push(line),
    platform: process.platform,
    realPath: realpathSync.native,
    fs: o.fs ?? nodeOutputFs,
    randomHex: hexes(),
  }
  const exit = await runBind(
    {
      approvedMapSha256: o.flag ?? sha(w.map),
      packageVersion: o.version ?? 2,
      dryRun: o.dryRun ?? false,
    },
    deps,
  )
  return { exit, lines, reads, codec: codec === 'throw' ? null : codec, loads, mi }
}
const problems = (lines: readonly string[]) => lines.filter((l) => l.startsWith('bind: problem'))
const problem = (...words: string[]) => `bind: problem ${words.join(' ')}`
const stopped = (code: string) => `bind: stopped: ${code}`
const fileAt = (mi: string, ...segments: string[]) => join(p2Of(mi), ...segments)
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

/** Every file under `dir` (relative '/' path → sha256); links listed, never followed. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (rel: string) => {
    const abs = rel === '' ? dir : join(dir, ...rel.split('/'))
    if (!existsSync(abs)) return
    for (const name of readdirSync(abs)) {
      const child = rel === '' ? name : `${rel}/${name}`
      const stat = lstatSync(join(abs, name))
      if (stat.isSymbolicLink()) out[child] = 'link'
      else if (stat.isDirectory()) walk(child)
      else out[child] = sha(readFileSync(join(abs, name)))
    }
  }
  walk('')
  return out
}
const storyLines = (lines: readonly string[]) => lines.filter((l) => l.startsWith('bind: story '))
const mediaNames = (mi: string) =>
  Object.keys(tree(fileAt(mi, 'media')))
    .filter((n) => !n.endsWith('.part'))
    .sort()

let world: World
beforeAll(async () => {
  QUICK = pngOf({ width: 1408, height: 768, chunks: ['zTXt', 'caBX'], seed: 's17-quick' })
  for (let s = 0; ; s++) {
    WISE = pngOf({ width: 1024, height: 1024, chunks: ['caBX'], seed: `s17-wise-${s}` })
    if (sha(QUICK) < sha(WISE)) break
  }
  world = await buildWorld()
}, 60_000)

// ---- T17-15 ----

/** An fs adapter over an empty disk: lstat answers ENOENT, any other call throws. */
const EMPTY_FS: OutputFs = {
  lstat: () => {
    throw Object.assign(new Error('lstat'), { code: 'ENOENT' })
  },
  readdir: () => {
    throw new Error('readdir')
  },
  mkdir: () => {
    throw new Error('mkdir')
  },
  readFile: () => {
    throw new Error('readFile')
  },
  writeFile: () => {
    throw new Error('writeFile')
  },
  link: () => {
    throw new Error('link')
  },
  unlink: () => {
    throw new Error('unlink')
  },
  rename: () => {
    throw new Error('rename')
  },
}

async function cli(
  argv: readonly string[],
  o: { platform?: string; env?: Record<string, string> } = {},
): Promise<Ran> {
  const reads: string[] = []
  const lines: string[] = []
  const codec = fakeCodec()
  let loads = 0
  const deps: BindCliDeps = {
    inputs: inputsOf(world, reads),
    loadCodec: () => (loads++, codec.codec),
    outputRoot: 'C:\\s17\\mi\\phase2',
    now: () => new Date(NOW),
    log: (line) => void lines.push(line),
    error: (line) => void lines.push(line),
    env: o.env ?? {},
    platform: o.platform ?? 'win32',
    realPath: (path) => path,
    fs: EMPTY_FS,
    randomHex: hexes(),
  }
  const exit = await runBindCli(argv, deps)
  return { exit, lines, reads, codec, loads, mi: '' }
}

describe('the binder CLI (T17-15)', () => {
  it(
    'T17-15 runBindCli: usage and bind-here-only exit 2 before any input is read; no message echoes a value (A14, TP17-2, TP17-13)',
    TIMEOUT,
    async () => {
      const HEX = sha(world.map)
      const good = await cli(['--approved-map-sha256', HEX, '--package-version', '2', '--dry-run'])
      expect(good.exit, `precondition: a dry run on win32 exits 0 ${good.lines.join(' | ')}`).toBe(
        0,
      )
      expect(
        new Set(good.reads).size === good.reads.length && good.reads.includes('history'),
        'precondition: each input read once',
      ).toBe(true)

      const usage: [string, string[]][] = [
        ['no map flag', ['--package-version', '2', '--dry-run']],
        ['no version flag', ['--approved-map-sha256', HEX, '--dry-run']],
        ['upper-case hex', ['--approved-map-sha256', HEX.toUpperCase(), '--package-version', '2']],
        ['63 hex', ['--approved-map-sha256', HEX.slice(1), '--package-version', '2']],
        ['65 hex', ['--approved-map-sha256', `${HEX}0`, '--package-version', '2']],
        ['a trailing space', ['--approved-map-sha256', `${HEX} `, '--package-version', '2']],
        ['an empty hex', ['--approved-map-sha256', '', '--package-version', '2']],
        ...['1', '1000', '02', '2.0', '+2', ' 2', '2e0', '0x2', ''].map((v): [string, string[]] => [
          `package-version ${JSON.stringify(v)}`,
          ['--approved-map-sha256', HEX, '--package-version', v],
        ]),
        ['--dry-run=1', ['--approved-map-sha256', HEX, '--package-version', '2', '--dry-run=1']],
        ['--Dry-Run', ['--approved-map-sha256', HEX, '--package-version', '2', '--Dry-Run']],
        [
          'an unknown flag',
          ['--approved-map-sha256', HEX, '--package-version', '2', '--S17ARGCANARY'],
        ],
        [
          'a repeated flag',
          ['--approved-map-sha256', HEX, '--package-version', '3', '--package-version', '2'],
        ],
        ['a value flag with no value', ['--approved-map-sha256', HEX, '--package-version']],
        ['a positional', ['--approved-map-sha256', HEX, '--package-version', '2', 'S17ARGCANARY']],
        [
          'a canary as the value',
          ['--approved-map-sha256', 'S17ARGCANARY', '--package-version', '2'],
        ],
      ]
      const refusals: Ran[] = []
      for (const [what, argv] of usage) {
        const ran = await cli(argv)
        refusals.push(ran)
        expect.soft([ran.exit, ran.lines], `(g1) ${what}`).toEqual([2, [stopped('usage')]])
        expect
          .soft(ran.lines.join('\n').includes('S17ARGCANARY'), `(g1) ${what}: no value echoed`)
          .toBe(false)
      }

      const hereOnly: [string, string, Record<string, string>][] = [
        ['platform linux', 'linux', {}],
        ['GITHUB_ACTIONS true', 'win32', { GITHUB_ACTIONS: 'true' }],
        ['github_actions (any case on win32)', 'win32', { github_actions: 'true' }],
        ['VERCEL empty (an empty value counts as set)', 'win32', { VERCEL: '' }],
        ['VERCEL_ENV preview', 'win32', { VERCEL_ENV: 'preview' }],
      ]
      for (const [what, platform, env] of hereOnly) {
        const ran = await cli(
          ['--approved-map-sha256', HEX, '--package-version', '2', '--dry-run'],
          {
            platform,
            env,
          },
        )
        refusals.push(ran)
        expect.soft([ran.exit, ran.lines], `(g2) ${what}`).toEqual([2, [stopped('bind-here-only')]])
      }

      expect
        .soft(
          refusals.map((r) => [r.reads.length, r.loads]),
          '(g3) every refusal reads 0 inputs and loads no codec',
        )
        .toEqual(refusals.map(() => [0, 0]))
    },
  )
})

// ---- T17-16 ----

const LINE_ORDER = [
  /^bind: map /,
  /^bind: correction applied /,
  /^bind: story lantern-walk /,
  /^bind: story two-paths /,
  /^bind: media /,
  /^bind: masters /,
  /^bind: done dry-run \(nothing written\)$/,
]

/** The T17-16 g1 world: one planted problem in each of phases 1-5. */
async function plantedWorld(): Promise<World> {
  const quickNoC2pa = pngOf({ width: 1408, height: 768, chunks: ['zTXt'], seed: 's17-quick' })
  const wrong: TextCorrection = { ...R, beforeSha256: sha(enc('another text')) }
  const w = await buildWorld({ quick: quickNoC2pa, records: [wrong], logFrom: 'raw' })
  // phase 1: one map row stale (the map rebuilt from this world first).
  setMap(
    w,
    w.mapRows.map((r) =>
      r.nodeId === 'ending_wise' ? { ...r, legacyPath: '/images/two-paths/other.png' } : r,
    ),
  )
  // phase 2: S2's phase-1 file drifts (still canonical and strict).
  const s2 = JSON.parse(dec(w.phase1.get(`${S2}.phase1.json`)!)) as StoryPackageV1
  s2.text.en!.nodes.start!.text += ' Again.'
  w.phase1.set(`${S2}.phase1.json`, jcsBytes(s2))
  // phase 4: one record's sha256 differs from its file.
  setLog(
    w,
    w.records.map((r) =>
      r.storyId === S2 && r.nodeId === 'start' && r.locale === 'en'
        ? { ...r, sha256: 'f'.repeat(64) }
        : r,
    ),
  )
  return w
}

describe('the binder phases (T17-16)', () => {
  it(
    'T17-16 phases 1-6 collect every problem before any encode; at most 50 problem lines then a count; a dry run writes nothing (A14, TP17-4)',
    TIMEOUT,
    async () => {
      const clean = await bind(world, { dryRun: true })
      expect(clean.exit, `precondition: the clean dry run exits 0 ${clean.lines.join(' | ')}`).toBe(
        0,
      )
      expect(
        clean.lines.length === LINE_ORDER.length &&
          clean.lines.every((line, i) => LINE_ORDER[i]!.test(line)),
        `precondition: the clean dry run's lines ${clean.lines.join(' | ')}`,
      ).toBe(true)

      // g1
      const planted = await bind(await plantedWorld(), { dryRun: true })
      expect
        .soft(problems(planted.lines), '(g1) five problem lines in phase order')
        .toEqual([
          problem('map-row-stale', S1, 'ending_wise'),
          problem('phase1-drift', S2),
          problem('correction-before-mismatch', S1, 'start', 'hi'),
          problem('narration-hash', S2, 'start', 'en'),
          problem('master-no-c2pa', S1, 'quick_path'),
        ])
      expect.soft(planted.exit, '(g1) exit 1').toBe(1)
      expect.soft(planted.codec?.calls.length, '(g1) 0 encodes').toBe(0)
      expect.soft(existsSync(p2Of(planted.mi)), '(g1) the output root absent').toBe(false)

      // g2
      for (const extra of [51, 50]) {
        const w = clone(world)
        setList(w, [
          ...w.hashLines,
          ...Array.from(
            { length: extra },
            (_, i) => `${sha(enc(String(i)))}  ${S1}/extra_${i}.en.mp3`,
          ),
        ])
        const ran = await bind(w, { dryRun: true })
        const lines = problems(ran.lines)
        const extras = lines.filter((l) => l.startsWith(problem('hash-list-extra')))
        expect.soft(extras.length, `(g2) ${extra} extra lines: 50 problem lines`).toBe(50)
        expect
          .soft(
            lines.filter((l) => l.startsWith('bind: problem ...')),
            `(g2) ${extra} extra lines: the tail`,
          )
          .toEqual(extra === 51 ? ['bind: problem ... and 1 more'] : [])
      }

      // g3
      expect.soft(clean.codec?.calls.length, '(g3) the clean dry run encodes 4 times').toBe(4)
      expect
        .soft(existsSync(p2Of(clean.mi)), '(g3) the dry run leaves the output root absent')
        .toBe(false)
    },
  )
})

// ---- T17-17 ----

describe('the binder map phase (T17-17)', () => {
  it(
    "T17-17 phase 1: the sha256 of the map file's bytes is the flag; strict JSON; rows re-derived; the line prints derived counts (A10, A14)",
    TIMEOUT,
    async () => {
      // g1
      const other = await bind(world, { dryRun: true, flag: sha(enc('another file')) })
      expect
        .soft([other.exit, problems(other.lines), other.reads], '(g1) the flag of another file')
        .toEqual([1, [problem('map-sha256-mismatch')], ['map']])
      const spaced = clone(world)
      spaced.map = enc(JSON.stringify(JSON.parse(dec(world.map)), null, 2))
      const ws = await bind(spaced, { dryRun: true, flag: sha(world.map) })
      expect
        .soft(
          [ws.exit, problems(ws.lines), ws.reads],
          '(g1) the map re-serialised with other whitespace',
        )
        .toEqual([1, [problem('map-sha256-mismatch')], ['map']])

      // g2
      const text = dec(world.map)
      const rows = (JSON.parse(text) as { rows: Record<string, unknown>[] }).rows
      const invalid: [string, Uint8Array][] = [
        ['a BOM', Uint8Array.from([0xef, 0xbb, 0xbf, ...world.map])],
        [
          'C3 28',
          Uint8Array.from([...enc(text.slice(0, -1)), ...enc(',"x":"'), 0xc3, 0x28, ...enc('"}')]),
        ],
        ['an own __proto__ at the top', enc(`{"__proto__":{"a":1},${text.slice(1)}`)],
        [
          'an own __proto__ in a row',
          enc(JSON.stringify({ rows }).replace('{"storyId":', '{"__proto__":{"a":1},"storyId":')),
        ],
        ['rows not an array', enc(JSON.stringify({ rows: { a: rows[0] } }))],
        [
          'a row missing a key field',
          enc(
            JSON.stringify({
              rows: rows.map((r, i) => (i === 0 ? { ...r, action: undefined } : r)),
            }),
          ),
        ],
      ]
      for (const [what, bytes] of invalid) {
        const w = clone(world)
        w.map = bytes
        const ran = await bind(w, { dryRun: true })
        expect.soft(problems(ran.lines), `(g2) ${what}`).toEqual([problem('map-invalid')])
      }

      // g3
      const totals = clone(world)
      setMap(totals, totals.mapRows, { rows: 9, keep: 99, recreate: 1, missing: 3, new: 3 })
      const t = await bind(totals, { dryRun: true })
      expect
        .soft(t.lines[0], '(g3) totals.keep 99: the derived counts are printed')
        .toBe(
          `bind: map sha256=${sha(totals.map)} rows=9 keep=2 recreate=1 missing=3 new=3 overrides=0`,
        )

      // g4
      const stale = clone(world)
      setMap(
        stale,
        stale.mapRows.map((r) =>
          r.nodeId === 'wise_path' ? { ...r, fileSha256: 'a'.repeat(64) } : r,
        ),
      )
      const st = await bind(stale, { dryRun: true })
      expect
        .soft(problems(st.lines), "(g4) wise_path's fileSha256 changed")
        .toEqual([problem('map-row-stale', S1, 'wise_path')])

      // g5
      const demoted = clone(world)
      demoted.overrides = enc(
        JSON.stringify({
          overrides: [
            {
              storyId: S1,
              nodeId: 'wise_path',
              action: 'recreate-step22',
              approvedOn: '2026-11-23',
              approvedBy: 'owner',
            },
          ],
        }),
      )
      const d = await bind(demoted)
      expect.soft(d.exit, `(g5) one override: exit 0 ${d.lines.join(' | ')}`).toBe(0)
      expect
        .soft(d.lines[0], '(g5) one override: the map line')
        .toBe(
          `bind: map sha256=${sha(demoted.map)} rows=9 keep=1 recreate=2 missing=3 new=3 overrides=1`,
        )
      expect
        .soft(d.codec?.calls.map(nodeOfCall), '(g5) one override: 2 encodes, quick_path only')
        .toEqual(['quick_path:768', 'quick_path:1408'])
      const pkg = existsSync(fileAt(d.mi, 'packages', `${S1}.json`))
        ? (readJson(fileAt(d.mi, 'packages', `${S1}.json`)) as unknown as StoryPackageV1)
        : null
      expect
        .soft(pkg?.nodes.find((n) => n.id === 'wise_path')?.image, '(g5) wise_path image null')
        .toBeNull()
      expect
        .soft(
          existsSync(fileAt(d.mi, 'masters', 'images', S1, `${sha(WISE)}.png`)),
          '(g5) no wise_path master',
        )
        .toBe(false)
      const missingRow = clone(world)
      missingRow.overrides = enc(
        JSON.stringify({
          overrides: [
            {
              storyId: S1,
              nodeId: 'ending_wise',
              action: 'recreate-step22',
              approvedOn: '2026-11-23',
              approvedBy: 'owner',
            },
          ],
        }),
      )
      const m = await bind(missingRow, { dryRun: true })
      expect
        .soft(problems(m.lines), '(g5) an override naming a missing row')
        .toEqual([problem('image-map-overrides-invalid')])

      // g6 (S17-R1-FID-1) the map check's and the derivation's own codes through the binder: each
      // stops with its line, nothing encoded, the output root absent.
      const outcome = (ran: Ran) => [
        ran.exit,
        problems(ran.lines),
        ran.codec?.calls.length,
        existsSync(p2Of(ran.mi)),
      ]
      const rowSet = clone(world)
      setMap(rowSet, [...rowSet.mapRows.slice(0, -1), rowSet.mapRows[0]!])
      expect
        .soft(
          outcome(await bind(rowSet)),
          '(g6) a map with one row removed and one row twice: map-rows',
        )
        .toEqual([1, [problem('map-rows')], 0, false])
      const WISE_PATH = 'images/two-paths/wise_path.png'
      const refusing = inputsOf(world)
      const notRegular = await bind(world, {
        inputs: {
          ...refusing,
          legacyFile: (segments, cap) =>
            segments.join('/') === WISE_PATH
              ? { ok: false, code: 'local-file-not-regular' }
              : refusing.legacyFile(segments, cap),
        },
      })
      expect
        .soft(
          outcome(notRegular),
          '(g6) a legacy file the reader refuses (local-file-not-regular): master-read',
        )
        .toEqual([1, [problem('master-read', S1, 'wise_path')], 0, false])
      const sevenBytes = clone(world)
      sevenBytes.files.set(WISE_PATH, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a))
      expect
        .soft(
          outcome(await bind(sevenBytes)),
          '(g6) a legacy file holding 7 of the 8 PNG signature bytes: legacy-format-unknown',
        )
        .toEqual([1, [problem('legacy-format-unknown', S1, 'wise_path')], 0, false])
    },
  )
})

// ---- T17-18 ----

describe('the binder phase-1 phase (T17-18)', () => {
  it(
    "T17-18 phase 2: the phase-1 folder holds exactly the legacy stories' files, each canonical, strict and byte-equal to the re-conversion; an empty set is refused (A16, TP17-3)",
    TIMEOUT,
    async () => {
      const name1 = `${S1}.phase1.json`
      const sets: [string, (w: World) => void][] = [
        [
          'an extra river-stones.phase1.json',
          (w) => w.phase1Names.push('river-stones.phase1.json'),
        ],
        ['one file missing', (w) => (w.phase1Names = w.phase1Names.filter((n) => n !== name1))],
        [
          'Two-paths.phase1.json',
          (w) =>
            (w.phase1Names = w.phase1Names.map((n) => (n === name1 ? 'Two-paths.phase1.json' : n))),
        ],
        ['an extra two-paths.phase1.json.bak', (w) => w.phase1Names.push(`${name1}.bak`)],
      ]
      for (const [what, edit] of sets) {
        const w = clone(world)
        edit(w)
        const ran = await bind(w, { dryRun: true })
        expect.soft(problems(ran.lines), `(g1) ${what}`).toEqual([problem('phase1-set')])
      }

      const raw1 = world.phase1.get(name1)!
      const s2Raw = world.phase1.get(`${S2}.phase1.json`)!
      const invalid: [string, (w: World, reads: string[]) => BindInputs][] = [
        [
          'a folder named two-paths.phase1.json',
          (w, reads) => ({
            ...inputsOf(w, reads),
            phase1Read: (name, cap) =>
              name === name1
                ? { ok: false, code: 'local-file-not-regular' }
                : inputsOf(w, reads).phase1Read(name, cap),
          }),
        ],
        [
          'pretty-printed JSON',
          (w, reads) => {
            w.phase1.set(name1, enc(JSON.stringify(JSON.parse(dec(raw1)), null, 2)))
            return inputsOf(w, reads)
          },
        ],
        [
          "storyId lantern-walk inside two-paths' file",
          (w, reads) => {
            w.phase1.set(name1, s2Raw)
            return inputsOf(w, reads)
          },
        ],
        [
          'a BOM',
          (w, reads) => {
            w.phase1.set(name1, Uint8Array.from([0xef, 0xbb, 0xbf, ...raw1]))
            return inputsOf(w, reads)
          },
        ],
      ]
      for (const [what, make] of invalid) {
        const w = clone(world)
        const ran = await bind(w, { dryRun: true, inputs: make(w, []) })
        expect.soft(problems(ran.lines), `(g2) ${what}`).toEqual([problem('phase1-invalid', S1)])
      }

      const drift: [string, (p: StoryPackageV1) => void][] = [
        ['one text character changed', (p) => (p.text.en!.nodes.start!.text += '!')],
        ['version 2', (p) => (p.version = 2)],
      ]
      for (const [what, edit] of drift) {
        const w = clone(world)
        const pkg = JSON.parse(dec(raw1)) as StoryPackageV1
        edit(pkg)
        w.phase1.set(name1, jcsBytes(pkg))
        const ran = await bind(w, { dryRun: true })
        expect.soft(problems(ran.lines), `(g3) ${what}`).toEqual([problem('phase1-drift', S1)])
      }

      const empty = await bind(await buildWorld({ stories: 'none' }), { dryRun: true })
      expect
        .soft(problems(empty.lines), '(g4) no legacy stories and an empty folder')
        .toContain(problem('phase1-set'))
    },
  )
})

// ---- T17-19 ----

describe('the binder correction phase (T17-19)', () => {
  it(
    'T17-19 phase 3: the binder applies the recorded correction, prints one line per record, and builds the packages and the narration plan from the corrected text (A14, D17-15)',
    TIMEOUT,
    async () => {
      const rawHi = JSON.parse(dec(world.phase1.get(`${S1}.phase1.json`)!)) as StoryPackageV1
      expect(
        rawHi.text.hi?.nodes.start?.text.includes(HAN),
        'precondition: the raw phase-1 hi start text holds the planted letter',
      ).toBe(true)
      const real = await bind(world)
      expect
        .soft(
          real.lines.filter((l) => l.startsWith('bind: correction')),
          '(g1) the correction line',
        )
        .toEqual([
          `bind: correction applied ${S1}/start.hi text before=${R.beforeSha256.slice(0, 12)} after=${sha(enc(R.after)).slice(0, 12)}`,
        ])

      const written = fileAt(real.mi, 'packages', `${S1}.json`)
      const pkg = existsSync(written) ? (readJson(written) as unknown as StoryPackageV1) : null
      expect
        .soft(
          pkg?.text.hi?.nodes.start?.text ?? 'absent',
          "(g2) the package's hi start text is R.after",
        )
        .toBe(R.after)
      const none = await bind(await buildWorld({ records: [] }))
      expect
        .soft(problems(none.lines), '(g2) corrections []')
        .toEqual([problem('package-invalid', S1, 'T006')])
      expect.soft(existsSync(p2Of(none.mi)), '(g2) corrections []: nothing written').toBe(false)

      const stale = await bind(await buildWorld({ logFrom: 'raw' }), { dryRun: true })
      expect
        .soft(problems(stale.lines), '(g3) the log made from the uncorrected entries')
        .toEqual([problem('narration-stale', S1, 'start', 'hi')])

      const missed: TextCorrection = { ...R, beforeSha256: sha(enc('not the text')) }
      const miss = await bind(await buildWorld({ records: [missed] }), { dryRun: true })
      expect
        .soft(problems(miss.lines), '(g4) a record whose hash misses')
        .toEqual([problem('correction-before-mismatch', S1, 'start', 'hi')])
      const bom = await buildWorld({ records: [], logFrom: 'raw' })
      bom.corrections = Uint8Array.from([
        0xef,
        0xbb,
        0xbf,
        ...enc(JSON.stringify({ corrections: [R] })),
      ])
      const b = await bind(bom, { dryRun: true })
      expect
        .soft(problems(b.lines), '(g4) a corrections file with a BOM')
        .toEqual([problem('correction-file')])
    },
  )
})

// ---- T17-20 ----

const rec = (w: World, story: string, node: string, locale: string) =>
  w.records.find((r) => r.storyId === story && r.nodeId === node && r.locale === locale)!

function editRecord(
  w: World,
  story: string,
  node: string,
  locale: string,
  edit: (r: Record<string, unknown>) => Record<string, unknown>,
): void {
  setLog(
    w,
    w.records.map((r) =>
      r.storyId === story && r.nodeId === node && r.locale === locale ? edit({ ...r }) : r,
    ),
  )
}

describe('the binder narration phase (T17-20)', () => {
  it(
    'T17-20 phase 4: each narration rule has its own sample and code; the list, the log and the files agree three ways; MP3s are bound byte for byte under their own hash (A15, A31, TP17-4)',
    TIMEOUT,
    async () => {
      const clean = await bind(world, { dryRun: true })
      expect(
        [
          clean.exit,
          problems(clean.lines),
          clean.reads.filter((r) => r.startsWith('audio ')).length,
        ],
        'precondition: the clean world passes phase 4 with 18 keys',
      ).toEqual([0, [], 18])

      const one = (code: string, story = S1, node = 'start', locale = 'en') => [
        problem(code, story, node, locale),
      ]
      const START_EN = `${S1}/start.en.mp3`
      const caps: number[] = []
      const samples: [string, (w: World) => BindInputs | void, string[]][] = [
        [
          'a record missing',
          (w) =>
            setLog(
              w,
              w.records.filter((r) => r !== rec(w, S1, 'start', 'en')),
            ),
          one('narration-record-missing'),
        ],
        ['a file missing', (w) => void w.audio.delete(START_EN), one('narration-file')],
        [
          'the reader answering too-large',
          (w) => ({
            ...inputsOf(w),
            audio: (segments, cap) => {
              if (segments.join('/') === START_EN) {
                caps.push(cap)
                return { ok: false, code: 'local-file-too-large' }
              }
              return inputsOf(w).audio(segments, cap)
            },
          }),
          one('narration-file'),
        ],
        [
          'record.file without audio/',
          (w) => editRecord(w, S1, 'start', 'en', (r) => ({ ...r, file: START_EN })),
          one('narration-file'),
        ],
        [
          'a file that sniffs as image/webp',
          (w) => void w.audio.set(START_EN, vp8Of({ width: 8, height: 8 })),
          one('narration-file'),
        ],
        [
          'sha256(file) differs from record.sha256',
          (w) => {
            // The list line names the changed bytes, so only the record differs from the file.
            const bytes = new Uint8Array(w.audio.get(START_EN)!)
            bytes[10] = (bytes[10] ?? 0) ^ 0x01
            w.audio.set(START_EN, bytes)
            setList(
              w,
              w.hashLines.map((l) => (l.endsWith(START_EN) ? `${sha(bytes)}  ${START_EN}` : l)),
            )
          },
          one('narration-hash'),
        ],
        [
          "record.sha256 differs from the line's",
          (w) =>
            setList(
              w,
              w.hashLines.map((l) => (l.endsWith(START_EN) ? `${'e'.repeat(64)}  ${START_EN}` : l)),
            ),
          one('narration-hash'),
        ],
        [
          'record.bytes differs from the length',
          (w) =>
            editRecord(w, S1, 'start', 'en', (r) => ({ ...r, bytes: (r.bytes as number) + 1 })),
          one('narration-hash'),
        ],
        [
          'a list line missing',
          (w) =>
            setList(
              w,
              w.hashLines.filter((l) => !l.endsWith(START_EN)),
            ),
          one('narration-hash'),
        ],
        [
          'an extra list line',
          (w) => setList(w, [...w.hashLines, `${'d'.repeat(64)}  ${S1}/nowhere.en.mp3`]),
          [problem('hash-list-extra', S1, 'nowhere', 'en')],
        ],
        [
          'a CRLF list',
          (w) => void (w.hashList = enc(w.hashLines.map((l) => `${l}\r\n`).join(''))),
          [problem('hash-list-invalid')],
        ],
        [
          'a list with a BOM',
          (w) => void (w.hashList = Uint8Array.from([0xef, 0xbb, 0xbf, ...w.hashList])),
          [problem('hash-list-invalid')],
        ],
        [
          'a list with no final LF',
          (w) => void (w.hashList = w.hashList.subarray(0, -1)),
          [problem('hash-list-invalid')],
        ],
        [
          'a 0-byte list',
          (w) => void (w.hashList = new Uint8Array(0)),
          [problem('hash-list-invalid')],
        ],
        [
          'durationMs 24 above mp3Info',
          (w) =>
            editRecord(w, S1, 'start', 'en', (r) => ({
              ...r,
              durationMs: (r.durationMs as number) + 24,
            })),
          one('narration-duration'),
        ],
        [
          'durationMs 24 below mp3Info',
          (w) =>
            editRecord(w, S1, 'start', 'en', (r) => ({
              ...r,
              durationMs: (r.durationMs as number) - 24,
            })),
          one('narration-duration'),
        ],
        [
          'durationMs 0',
          (w) => editRecord(w, S1, 'start', 'en', (r) => ({ ...r, durationMs: 0 })),
          one('narration-duration'),
        ],
        [
          'narratedTextSha256 of the uncorrected entry',
          (w) => {
            const raw = buildEntriesForSync.get('raw-start-hi')!
            editRecord(w, S1, 'start', 'hi', (r) => ({ ...r, narratedTextSha256: raw }))
          },
          one('narration-stale', S1, 'start', 'hi'),
        ],
        ...[true, 'true', false].map((value): [string, (w: World) => void, string[]] => [
          `listenPending ${JSON.stringify(value)}`,
          (w) => editRecord(w, S1, 'start', 'en', (r) => ({ ...r, listenPending: value })),
          one('narration-listen-pending'),
        ]),
        ...(
          [
            ['provenance with tier', (p: Record<string, unknown>) => ({ ...p, tier: 'free' })],
            [
              'provenance without voice',
              (p: Record<string, unknown>) => ({ ...p, voice: undefined }),
            ],
            ['vendor ai4bharat', (p: Record<string, unknown>) => ({ ...p, vendor: 'ai4bharat' })],
            [
              "the other locale's voice",
              (p: Record<string, unknown>) => ({ ...p, voice: 'Divya' }),
            ],
            ['origin human', (p: Record<string, unknown>) => ({ ...p, origin: 'human' })],
          ] as const
        ).map(([what, edit]): [string, (w: World) => void, string[]] => [
          what,
          (w) =>
            editRecord(w, S1, 'start', 'en', (r) => ({
              ...r,
              provenance: edit(r.provenance as Record<string, unknown>),
            })),
          one('narration-provenance'),
        ]),
      ]
      for (const [what, edit, want] of samples) {
        const w = clone(world)
        const inputs = edit(w) ?? undefined
        const ran = await bind(w, { dryRun: true, ...(inputs ? { inputs } : {}) })
        expect.soft(problems(ran.lines), `(g1) ${what}`).toEqual(want)
      }
      expect.soft(caps, '(g1) the audio reader is asked with the 10 MiB cap').toEqual([10_485_760])

      // g2
      const emptyLog = clone(world)
      setLog(emptyLog, [])
      // The history kept: an empty history is refused by the masters gate (g5's sample).
      emptyLog.history = world.history
      const e = await bind(emptyLog, { dryRun: true })
      expect
        .soft(problems(e.lines), '(g2) the log []: one record-missing per key')
        .toEqual(
          world.entries.map((x) =>
            problem('narration-record-missing', x.storyId, x.nodeId, x.locale),
          ),
        )
      const invalidLogs: [string, Uint8Array][] = [
        ['an object', enc('{"records":[]}')],
        ['a BOM', Uint8Array.from([0xef, 0xbb, 0xbf, ...world.mediaLog])],
        ['C3 28', Uint8Array.from([...enc('[{"storyId":"'), 0xc3, 0x28, ...enc('"}]')])],
        [
          'an own __proto__',
          enc(dec(world.mediaLog).replace('"storyId":', '"__proto__":{"a":1},"storyId":')),
        ],
        ['one key twice', enc(JSON.stringify([...world.records, world.records[0]]))],
      ]
      for (const [what, bytes] of invalidLogs) {
        const w = clone(world)
        w.mediaLog = bytes
        const ran = await bind(w, { dryRun: true })
        expect.soft(problems(ran.lines), `(g2) ${what}`).toEqual([problem('narration-log-invalid')])
      }

      // g3
      const seeded = await bind(await buildWorld({ seeds: { [`${S1}/start.hi`]: 1 } }), {
        dryRun: true,
      })
      expect
        .soft(
          [seeded.exit, problems(seeded.lines)],
          '(g3) a seed override with the log made at seed 1',
        )
        .toEqual([0, []])
      const badSeeds: [string, Uint8Array][] = [
        ['an unknown key', enc(JSON.stringify({ [`${S1}/nowhere.hi`]: 1 }))],
        ['seed -1', enc(JSON.stringify({ [`${S1}/start.hi`]: -1 }))],
        ['a BOM', Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('{}')])],
      ]
      for (const [what, bytes] of badSeeds) {
        const w = clone(world)
        w.seedOverrides = bytes
        const ran = await bind(w, { dryRun: true })
        expect.soft(problems(ran.lines), `(g3) ${what}`).toEqual([problem('narration-overrides')])
      }

      // g4
      const real = await bind(world)
      expect.soft(real.exit, '(g4) a real run').toBe(0)
      const s1 = existsSync(fileAt(real.mi, 'packages', `${S1}.json`))
        ? (readJson(fileAt(real.mi, 'packages', `${S1}.json`)) as unknown as StoryPackageV1)
        : null
      const startEn = s1?.assets.find(
        (a) => a.kind === 'audio' && a.nodeId === 'start' && a.locale === 'en',
      )
      const source = world.audio.get(START_EN)!
      expect.soft(startEn?.id, '(g4) the audio asset id is the file sha256').toBe(sha(source))
      expect
        .soft(startEn?.variants[0]?.path, '(g4) the variant is named by that sha256')
        .toBe(`media/${S1}/${sha(source)}-en.mp3`)
      const copied = fileAt(real.mi, 'media', S1, `${sha(source)}-en.mp3`)
      expect
        .soft(
          existsSync(copied) ? sha(readFileSync(copied)) : 'absent',
          '(g4) the copy holds the source bytes',
        )
        .toBe(sha(source))

      // g5 (S17-R1-SEC-1) media-log.json and its history as `masters` takes them: each form its
      // body gate refuses is narration-log-invalid here, before anything is written. Each sample
      // changes one file only, so the other file's gate cannot answer for it.
      let deep: unknown = { ['__proto__']: 1 }
      for (let i = 0; i < 70; i++) deep = [deep]
      const logForms: [string, Record<string, unknown>[]][] = [
        [
          'a lone-surrogate escape in a value',
          world.records.map((r, i) => (i === 0 ? { ...r, note: '\ud800' } : r)),
        ],
        [
          'an own __proto__ nested below depth 64',
          world.records.map((r, i) => (i === 0 ? { ...r, deep } : r)),
        ],
      ]
      for (const [what, records] of logForms) {
        const w = clone(world)
        w.mediaLog = enc(`${JSON.stringify(records, null, 2)}\n`)
        expect(
          dec(w.mediaLog).includes(what.startsWith('a lone') ? '\\ud800' : '"__proto__"'),
          `precondition: ${what} is in the bytes`,
        ).toBe(true)
        const ran = await bind(w, { dryRun: true })
        expect
          .soft(problems(ran.lines), `(g5) media-log.json: ${what}`)
          .toEqual([problem('narration-log-invalid')])
      }
      const historyText = dec(world.history)
      const historyForms: [string, string][] = [
        ['0 bytes', ''],
        ['CRLF line ends', historyText.replaceAll('\n', '\r\n')],
        ['no final LF', historyText.slice(0, -1)],
        ['a line that is an array', `${historyText}[1,2]\n`],
      ]
      for (const [what, text] of historyForms) {
        const w = clone(world)
        w.history = enc(text)
        const ran = await bind(w, { dryRun: true })
        expect
          .soft(problems(ran.lines), `(g5) the history: ${what}`)
          .toEqual([problem('narration-log-invalid')])
      }
    },
  )
})

/** Entries the samples need, built once (the uncorrected start.hi hash). */
const buildEntriesForSync = new Map<string, string>()
beforeAll(async () => {
  const raw = byCode(
    [legacyOf(P1[S1], IMAGES_S1, PLANTED), legacyOf(P1[S2], IMAGES_S2)].map((s) =>
      convertLegacyStory(s),
    ),
  )
  const entries = await buildEntriesFor(raw, {})
  buildEntriesForSync.set(
    'raw-start-hi',
    entries.find((e) => e.storyId === S1 && e.nodeId === 'start' && e.locale === 'hi')!
      .narratedTextSha256,
  )
}, 60_000)

// ---- T17-21 ----

describe('the binder image phases (T17-21)', () => {
  it(
    "T17-21 phases 5 and 7: masters by magic with their own type; widths 768 and the master's own; names by each variant's own bytes; every encoder and variant gate; recreate, missing and new rows bind nothing (A17, A18, A32, D17-4, D17-8)",
    TIMEOUT,
    async () => {
      const real = await bind(world)
      // The exact four codec calls are g3's claim (MU17-139, MU17-140 must reach it).
      expect(
        [real.exit, (real.codec?.calls.length ?? 0) > 0],
        `precondition: the clean real run exits 0 and encodes ${real.lines.join(' | ')}`,
      ).toEqual([0, true])

      // g1
      const quickMaster = fileAt(real.mi, 'masters', 'images', S1, `${sha(QUICK)}.png`)
      expect
        .soft(
          existsSync(quickMaster) ? sha(readFileSync(quickMaster)) : 'absent',
          "(g1) quick.jpg's PNG bytes as <sha>.png",
        )
        .toBe(sha(QUICK))
      const facts = existsSync(quickMaster) ? readPngFacts(readFileSync(quickMaster)) : null
      expect
        .soft(
          facts?.ok && ['zTXt', 'caBX'].every((t) => facts.facts.chunkTypes.includes(t)),
          '(g1) the master keeps zTXt and caBX',
        )
        .toBe(true)
      expect
        .soft(
          mediaNames(real.mi).filter((n) => /\.(png|jpg)$/.test(n)),
          '(g1) no .png or .jpg under P2/media',
        )
        .toEqual([])

      // g2
      const sizes: [number, number][] = [
        [2048, 2048],
        [512, 512],
        [1024, 768],
        [1408, 1408],
        [1407, 768],
        [768, 768],
      ]
      for (const [width, height] of sizes) {
        const w = await buildWorld({
          wise: pngOf({ width, height, chunks: ['caBX'], seed: 's17-size' }),
        })
        const ran = await bind(w, { dryRun: true })
        expect
          .soft(problems(ran.lines), `(g2) a ${width}x${height} master`)
          .toEqual([problem('master-size', S1, 'wise_path')])
      }
      const noC2pa = await bind(
        await buildWorld({
          quick: pngOf({ width: 1408, height: 768, chunks: ['zTXt'], seed: 's17-q2' }),
        }),
        { dryRun: true },
      )
      expect
        .soft(problems(noC2pa.lines), '(g2) a master without caBX')
        .toEqual([problem('master-no-c2pa', S1, 'quick_path')])

      // g3
      const pkg = readJson(fileAt(real.mi, 'packages', `${S1}.json`)) as unknown as StoryPackageV1
      const images = pkg.assets.filter((a) => a.kind === 'image')
      for (const image of images) {
        const widths = image.variants.map((v) => v.width ?? 0)
        expect
          .soft(widths, `(g3) ${image.id.slice(0, 12)}: ascending widths`)
          .toEqual([768, image.width])
        for (const v of image.variants) {
          const name = v.path.split('/').pop() ?? ''
          const file = fileAt(real.mi, 'media', S1, name)
          const bytes = existsSync(file) ? readFileSync(file) : new Uint8Array(0)
          expect
            .soft(name, `(g3) ${v.path}: named by its own bytes`)
            .toBe(`${sha(bytes)}-w${v.width}.webp`)
        }
      }
      expect
        .soft(
          real.codec?.calls.map(nodeOfCall),
          "(g3) the codec asked for 768 and each master's own width",
        )
        .toEqual(['wise_path:768', 'wise_path:1024', 'quick_path:768', 'quick_path:1408'])

      // g4
      const gates: [string, FakeCodec | 'throw', string[], number][] = [
        ['other versions', fakeCodec('versions'), [problem('encoder-version')], 1],
        ['the loader throwing', 'throw', [problem('encoder-unavailable')], 1],
        ['encode throwing', fakeCodec('throws'), [problem('encoder-unavailable')], 1],
        [
          'wrong dimensions',
          fakeCodec('wrongDims'),
          [
            problem('variant-invalid', S1, 'wise_path'),
            problem('variant-invalid', S1, 'quick_path'),
          ],
          1,
        ],
        [
          'an extra chunk',
          fakeCodec('extraChunk'),
          [
            problem('variant-invalid', S1, 'wise_path'),
            problem('variant-invalid', S1, 'quick_path'),
          ],
          1,
        ],
        [
          '10,485,761 bytes',
          fakeCodec({ size: 10_485_761 }),
          [problem('variant-too-large', S1, 'wise_path')],
          1,
        ],
        ['exactly 10,485,760 bytes', fakeCodec({ size: 10_485_760 }), [], 0],
      ]
      for (const [what, codec, want, exit] of gates) {
        const ran = await bind(world, { dryRun: true, codec })
        expect.soft([ran.exit, problems(ran.lines)], `(g4) ${what}`).toEqual([exit, want])
        if (what === 'other versions')
          expect.soft(ran.codec?.calls.length, '(g4) other versions: 0 encodes').toBe(0)
      }

      // g5
      const names = Object.keys(tree(p2Of(real.mi))).join('\n')
      expect
        .soft(names.includes(sha(JPEG)), "(g5) the recreate file's sha256 names no file")
        .toBe(false)
      expect
        .soft(
          pkg.nodes.filter((n) => n.image !== null).map((n) => n.id),
          '(g5) recreate, missing and new rows keep image null',
        )
        .toEqual(['wise_path', 'quick_path'])
      expect
        .soft(
          Object.keys(tree(fileAt(real.mi, 'masters', 'images'))).sort(),
          '(g5) masters for the two kept rows only',
        )
        .toEqual([`${S1}/${sha(QUICK)}.png`, `${S1}/${sha(WISE)}.png`].sort())
    },
  )
})

// ---- T17-22 ----

interface LedgerFile {
  schema: string
  images: {
    masterSha256: string
    storyId: string
    nodeId: string
    width: number
    height: number
    variants: { token: string; width: number; height: number; sha256: string; bytes: number }[]
    encoder: Record<string, string>
  }[]
}
const ledgerOf = (mi: string): LedgerFile =>
  readJson(fileAt(mi, 'binding-ledger.json')) as unknown as LedgerFile
const writeLedger = (mi: string, value: unknown) =>
  writeFileSync(fileAt(mi, 'binding-ledger.json'), jcsBytes(value))

describe('the binding ledger (T17-22)', () => {
  it(
    'T17-22 the binding ledger: written last, sorted, append-only; a bound master never re-encoded; a master without an entry re-encoded and its present WebP accepted only when equal; any other WebP is ledger-orphan; a cut-off run completes with no new names (A17, D17-10, CRIT-2, TP17-4)',
    TIMEOUT,
    async () => {
      const first = await bind(world)
      expect(
        first.exit,
        `precondition: the first real run exits 0 ${first.lines.join(' | ')}`,
      ).toBe(0)
      expect(
        existsSync(fileAt(first.mi, 'binding-ledger.json')),
        'precondition: the ledger written',
      ).toBe(true)
      expect(
        sha(QUICK) < sha(WISE),
        "precondition: the masters' sha256 order is the reverse of node order",
      ).toBe(true)

      // g1
      const bytes = readFileSync(fileAt(first.mi, 'binding-ledger.json'))
      const ledger = ledgerOf(first.mi)
      expect.soft(sha(bytes), '(g1) canonical JCS').toBe(sha(jcsBytes(ledger)))
      expect.soft(ledger.schema, '(g1) the schema').toBe('binding-ledger@1')
      expect
        .soft(
          ledger.images.map((e) => e.nodeId),
          '(g1) sorted by masterSha256',
        )
        .toEqual(['quick_path', 'wise_path'])
      for (const entry of ledger.images) {
        expect
          .soft(entry.encoder, `(g1) ${entry.nodeId}: the encoder`)
          .toEqual({ ...EXPECTED_ENCODER, settingsSha256: SETTINGS_SHA256 })
        expect
          .soft(
            entry.variants.map((v) => [v.token, v.width]),
            `(g1) ${entry.nodeId}: the variants`,
          )
          .toEqual([
            ['w768', 768],
            [`w${entry.width}`, entry.width],
          ])
      }

      // g2
      const second = await bind(world, { mi: first.mi })
      const mediaLine = second.lines.find((l) => l.startsWith('bind: media '))
      expect.soft(second.codec?.calls.length, '(g2) a second run encodes nothing').toBe(0)
      expect
        .soft(mediaLine, '(g2) the media line')
        .toMatch(/^bind: media webp new=0 reused=4 mp3=18 bytes=\d+$/)
      expect
        .soft(storyLines(second.lines), '(g2) the same package hashes')
        .toEqual(storyLines(first.lines))
      expect
        .soft(second.lines[second.lines.length - 1], '(g2) every media and masters file skipped')
        .toBe('bind: done wrote=4 skipped=27')

      // g3
      const wiseEntry = ledger.images.find((e) => e.nodeId === 'wise_path')!
      const wiseFile = (mi: string) =>
        fileAt(mi, 'media', S1, `${wiseEntry.variants[0]!.sha256}-w768.webp`)
      // S17-R1-SEC-2: wise_path's 768 variant replaced by `file`, the ledger naming its true sha256
      // and bytes (and `height`), so only the reused variant's own gates can refuse it.
      const swapNarrow = (mi: string, file: Uint8Array, height = 768) => {
        unlinkSync(wiseFile(mi))
        const variant = { ...wiseEntry.variants[0]!, height, sha256: sha(file), bytes: file.length }
        writeFileSync(fileAt(mi, 'media', S1, `${variant.sha256}-w768.webp`), file)
        writeLedger(mi, {
          ...ledger,
          images: ledger.images.map((e) =>
            e.nodeId === 'wise_path' ? { ...e, variants: [variant, ...e.variants.slice(1)] } : e,
          ),
        })
      }
      const g3: [string, (mi: string) => void, string[]][] = [
        [
          'a reused variant holding a VP8X chunk, its true sha256 recorded',
          (mi) =>
            swapNarrow(
              mi,
              vp8Of({
                width: 768,
                height: 768,
                before: [{ fourcc: 'VP8X', data: vp8xData(0, 768, 768) }],
              }),
            ),
          [problem('ledger-file-differs', S1, 'wise_path')],
        ],
        [
          'a reused variant of other dimensions than recorded (768x767 recorded 768x768)',
          (mi) => swapNarrow(mi, vp8Of({ width: 768, height: 767 })),
          [problem('ledger-file-differs', S1, 'wise_path')],
        ],
        [
          "a recorded height off the master's aspect (768x767 of a 1024x1024 master)",
          (mi) => swapNarrow(mi, vp8Of({ width: 768, height: 767 }), 767),
          [problem('ledger-file-differs', S1, 'wise_path')],
        ],
        [
          'a recorded variant removed',
          (mi) => unlinkSync(wiseFile(mi)),
          [problem('ledger-file-missing', S1, 'wise_path')],
        ],
        [
          'its bytes changed',
          (mi) => writeFileSync(wiseFile(mi), enc('other')),
          [problem('ledger-file-differs', S1, 'wise_path')],
        ],
        [
          'the ledger not JCS',
          (mi) => writeFileSync(fileAt(mi, 'binding-ledger.json'), JSON.stringify(ledger, null, 2)),
          [problem('ledger-invalid')],
        ],
        [
          'unsorted',
          (mi) => writeLedger(mi, { ...ledger, images: [...ledger.images].reverse() }),
          [problem('ledger-invalid')],
        ],
        [
          'a masterSha256 twice',
          (mi) => writeLedger(mi, { ...ledger, images: [ledger.images[0], ...ledger.images] }),
          [problem('ledger-invalid')],
        ],
        [
          'schema binding-ledger@2',
          (mi) => writeLedger(mi, { ...ledger, schema: 'binding-ledger@2' }),
          [problem('ledger-invalid')],
        ],
        [
          // No JCS form holds a lone surrogate (canonicalize refuses it), so no ledger string can
          // carry ill-formed text into the image log (B17-fix1-2).
          'an encoder text that is a lone-surrogate escape',
          (mi) =>
            writeFileSync(
              fileAt(mi, 'binding-ledger.json'),
              dec(bytes).replace(`"sharp":"${EXPECTED_ENCODER.sharp}"`, '"sharp":"\\ud800"'),
            ),
          [problem('ledger-invalid')],
        ],
        [
          'the same master bound to another node',
          (mi) =>
            writeLedger(mi, {
              ...ledger,
              images: ledger.images.map((e) =>
                e.nodeId === 'quick_path' ? { ...e, nodeId: 'start' } : e,
              ),
            }),
          [problem('ledger-entry-changed', S1, 'quick_path')],
        ],
      ]
      for (const [what, edit, want] of g3) {
        const mi = newMi()
        cpSync(p2Of(first.mi), p2Of(mi), { recursive: true })
        edit(mi)
        const ran = await bind(world, { mi, dryRun: true })
        expect.soft(problems(ran.lines), `(g3) ${what}`).toEqual(want)
      }

      // g4
      {
        const mi = newMi()
        cpSync(p2Of(first.mi), p2Of(mi), { recursive: true })
        writeLedger(mi, {
          ...ledger,
          images: ledger.images.filter((e) => e.nodeId !== 'wise_path'),
        })
        const rerun = await bind(world, { mi })
        expect
          .soft(
            [rerun.exit, rerun.codec?.calls.map(nodeOfCall)],
            '(g4) an entry removed: 2 encodes',
          )
          .toEqual([0, ['wise_path:768', 'wise_path:1024']])
        expect
          .soft(sha(readFileSync(fileAt(mi, 'binding-ledger.json'))), '(g4) the entry restored')
          .toBe(sha(bytes))
        const third = await bind(world, { mi })
        expect.soft(third.codec?.calls.length, '(g4) a third run encodes nothing').toBe(0)
      }
      {
        const mi = newMi()
        cpSync(p2Of(first.mi), p2Of(mi), { recursive: true })
        writeLedger(mi, {
          ...ledger,
          images: ledger.images.filter((e) => e.nodeId !== 'wise_path'),
        })
        const before = tree(p2Of(mi))
        const flaky = await bind(world, { mi, codec: fakeCodec('flaky') })
        expect
          .soft([flaky.exit, flaky.lines[flaky.lines.length - 1]], '(g4) the flaky codec')
          .toEqual([1, stopped('ledger-orphan')])
        expect.soft(tree(p2Of(mi)), '(g4) the flaky codec: the tree unchanged').toEqual(before)
      }
      {
        const mi = newMi()
        cpSync(p2Of(first.mi), p2Of(mi), { recursive: true })
        writeFileSync(
          fileAt(mi, 'media', S1, `${'c'.repeat(64)}-w768.webp`),
          vp8Of({ width: 768, height: 768 }),
        )
        const stray = await bind(world, { mi })
        expect
          .soft([stray.exit, stray.lines[stray.lines.length - 1]], '(g4) a stray WebP')
          .toEqual([1, stopped('ledger-orphan')])
      }

      // g5
      {
        const mi = newMi()
        let mediaWrites = 0
        const cut: OutputFs = {
          ...nodeOutputFs,
          writeFile: (path, data, options) => {
            if (/\.(mp3|webp)\.\d+-[0-9a-f]{8}\.part$/.test(path) && ++mediaWrites === 4) {
              nodeOutputFs.writeFile(path, data.subarray(0, data.length >> 1), options)
              throw Object.assign(new Error('cut off'), { code: 'EIO' })
            }
            nodeOutputFs.writeFile(path, data, options)
          },
        }
        const broken = await bind(world, { mi, fs: cut })
        expect
          .soft(
            [broken.exit, broken.lines[broken.lines.length - 1]],
            '(g5) cut off after the 3rd media file',
          )
          .toEqual([1, stopped('output-write')])
        const resumed = await bind(world, { mi })
        expect.soft(resumed.exit, `(g5) the re-run completes ${resumed.lines.join(' | ')}`).toBe(0)
        expect
          .soft(storyLines(resumed.lines), '(g5) the package hashes of an uninterrupted run')
          .toEqual(storyLines(first.lines))
        expect
          .soft(mediaNames(mi), '(g5) the media names of an uninterrupted run')
          .toEqual(mediaNames(first.mi))
        expect.soft(readdirSync(fileAt(mi, '.tmp')).length, '(g5) the stale .part remains').toBe(1)
        expect
          .soft(resumed.lines[0], '(g5) the re-run reports it')
          .toBe('bind: note stale-part files=1')
      }

      // g6
      {
        const mi = newMi()
        mkdirSync(p2Of(mi))
        writeLedger(mi, { schema: 'binding-ledger@1', images: [] })
        const ran = await bind(world, { mi })
        expect
          .soft(
            [ran.exit, ran.codec?.calls.length],
            '(g6) a P2 holding images [] binds as a first binding',
          )
          .toEqual([0, 4])
      }
    },
  )
})

// ---- T17-23 ----

describe('the version-2 packages (T17-23)', () => {
  it(
    'T17-23 phase 8: version-2 packages: images in node order, then audio by node and locale order; provenance; no tier; the rest byte-equal to the corrected phase-1; JCS and deterministic; A001 refuses (A18, A32, D17-13, D17-18)',
    TIMEOUT,
    async () => {
      const real = await bind(world)
      expect(real.exit, `precondition: a clean real run ${real.lines.join(' | ')}`).toBe(0)
      const read = (mi: string, id: string) =>
        readJson(fileAt(mi, 'packages', `${id}.json`)) as unknown as StoryPackageV1
      const s1 = read(real.mi, S1)
      const s2 = read(real.mi, S2)

      // g1
      expect
        .soft(
          [S1, S2].map((id) => StoryPackageV1.safeParse(read(real.mi, id)).success),
          '(g1) both packages parse strictly',
        )
        .toEqual([true, true])
      expect.soft(s1.version, '(g1) version 2').toBe(2)
      const v3 = await bind(world, { version: 3 })
      expect.soft(read(v3.mi, S1).version, '(g1) version 3 in a second run').toBe(3)
      expect
        .soft(
          Object.fromEntries(s1.nodes.map((n) => [n.id, n.image])),
          '(g1) image ids on the kept nodes',
        )
        .toEqual({
          start: null,
          wise_path: sha(WISE),
          quick_path: sha(QUICK),
          ending_wise: null,
          ending_quick: null,
        })
      const order = s1.assets.map((a) =>
        a.kind === 'image'
          ? `image ${a.id === sha(WISE) ? 'wise_path' : 'quick_path'}`
          : `audio ${a.nodeId} ${a.locale}`,
      )
      expect
        .soft(order, '(g1) images in node order, then audio by node and locale')
        .toEqual([
          'image wise_path',
          'image quick_path',
          ...['start', 'wise_path', 'quick_path', 'ending_wise', 'ending_quick'].flatMap((n) => [
            `audio ${n} en`,
            `audio ${n} hi`,
          ]),
        ])
      expect
        .soft(
          s2.assets.map((a) => a.kind),
          '(g1) S2: 8 audio assets, no image',
        )
        .toEqual(Array.from({ length: 8 }, () => 'audio'))

      // g2
      const wise = s1.assets.find((a) => a.kind === 'image' && a.id === sha(WISE))
      expect
        .soft(
          wise && {
            ...wise,
            variants: wise.variants.map((v) => ({
              ...v,
              path: v.path.replace(/[0-9a-f]{64}/, 'H'),
            })),
          },
          '(g2) the image asset',
        )
        .toEqual({
          kind: 'image',
          id: sha(WISE),
          width: 1024,
          height: 1024,
          variants: [
            {
              path: `media/${S1}/H-w768.webp`,
              mime: 'image/webp',
              bytes: wise?.variants[0]?.bytes,
              width: 768,
            },
            {
              path: `media/${S1}/H-w1024.webp`,
              mime: 'image/webp',
              bytes: wise?.variants[1]?.bytes,
              width: 1024,
            },
          ],
          provenance: {
            origin: 'ai_generated',
            vendor: 'Google',
            product: 'Gemini app',
            c2paInMaster: true,
          },
        })
      const audio = s1.assets.find(
        (a) => a.kind === 'audio' && a.nodeId === 'wise_path' && a.locale === 'hi',
      )
      const source = world.audio.get(`${S1}/wise_path.hi.mp3`)!
      const entry = world.entries.find(
        (e) => e.storyId === S1 && e.nodeId === 'wise_path' && e.locale === 'hi',
      )!
      expect.soft(audio, '(g2) the audio asset').toEqual({
        kind: 'audio',
        id: sha(source),
        nodeId: 'wise_path',
        locale: 'hi',
        durationMs: rec(world, S1, 'wise_path', 'hi').durationMs,
        variants: [
          { path: `media/${S1}/${sha(source)}-hi.mp3`, mime: 'audio/mpeg', bytes: source.length },
        ],
        provenance: { ...PROVENANCE, voice: 'Divya' },
        narratedTextSha256: entry.narratedTextSha256,
      })
      expect
        .soft(
          [...s1.assets, ...s2.assets].filter((a) => Object.hasOwn(a.provenance, 'tier')).length,
          '(g2) no tier in any provenance',
        )
        .toBe(0)

      // g3
      const corrected = applyTextCorrections(
        [StoryPackageV1.parse(JSON.parse(dec(world.phase1.get(`${S1}.phase1.json`)!)))],
        [R],
      )
      const stripped = {
        ...s1,
        version: 1,
        nodes: s1.nodes.map((n) => ({ ...n, image: null })),
        assets: [],
      }
      expect
        .soft(dec(jcsBytes(stripped)), '(g3) the rest is byte-equal to the corrected phase 1')
        .toBe(corrected.ok ? dec(jcsBytes(corrected.packages[0])) : 'not applied')

      // g4
      const file = readFileSync(fileAt(real.mi, 'packages', `${S1}.json`))
      expect.soft(sha(file), '(g4) the file is jcsBytes(package)').toBe(sha(jcsBytes(s1)))
      const nextDay = await bind(world, { now: '2026-11-24T10:00:00.000Z' })
      expect
        .soft(
          sha(readFileSync(fileAt(nextDay.mi, 'packages', `${S1}.json`))),
          '(g4) two runs give the same bytes',
        )
        .toBe(sha(file))

      // g5
      const twins = await buildWorld({ wise: QUICK })
      const t = await bind(twins, { dryRun: true })
      expect
        .soft(problems(t.lines), '(g5) two kept nodes with byte-identical legacy files')
        .toEqual([problem('package-invalid', S1, 'A001')])
    },
  )
})

// ---- T17-24 ----

const snapshotFolders = (mi: string) =>
  existsSync(fileAt(mi, 'masters', 'media-log'))
    ? readdirSync(fileAt(mi, 'masters', 'media-log')).sort()
    : []

describe('the snapshots (T17-24)', () => {
  it(
    'T17-24 snapshots: the media log and its history copied under <UTC date>-<sha12 of media-log.json>; the image log as its own JCS snapshot; reuse by sha12 alone; a partial folder completed (A19, D17-14, CRIT-2)',
    TIMEOUT,
    async () => {
      const real = await bind(world)
      expect(real.exit, 'precondition: a clean real run').toBe(0)
      const logFolder = `2026-11-23-${sha(world.mediaLog).slice(0, 12)}`
      const imageLogFolder = snapshotFolders(real.mi).find((n) => n !== logFolder) ?? 'none'
      const imageLogPath = fileAt(real.mi, 'masters', 'media-log', imageLogFolder, 'image-log.json')
      const imageLog = existsSync(imageLogPath) ? readFileSync(imageLogPath) : new Uint8Array(0)

      // g1
      const copy = (name: string) => {
        const p = fileAt(real.mi, 'masters', 'media-log', logFolder, name)
        return existsSync(p) ? sha(readFileSync(p)) : 'absent'
      }
      expect
        .soft(copy('media-log.json'), '(g1) media-log.json byte-equal')
        .toBe(sha(world.mediaLog))
      expect
        .soft(copy('media-log.history.jsonl'), '(g1) the history byte-equal')
        .toBe(sha(world.history))
      expect
        .soft(imageLogFolder, '(g1) the image log under <date>-<sha12 of image-log.json>')
        .toBe(`2026-11-23-${sha(imageLog).slice(0, 12)}`)
      for (const [now, date] of [
        ['2026-11-23T23:30:00-05:00', '2026-11-24'],
        ['2026-11-24T00:30:00+05:30', '2026-11-23'],
      ] as const) {
        const ran = await bind(world, { now })
        expect
          .soft(
            snapshotFolders(ran.mi).every((n) => n.startsWith(`${date}-`)),
            `(g1) now ${now} names ${date}`,
          )
          .toBe(true)
      }

      // g2
      const parsed = JSON.parse(dec(imageLog)) as {
        schema: string
        images: Record<string, unknown>[]
      }
      expect.soft(sha(imageLog), '(g2) canonical JCS').toBe(sha(jcsBytes(parsed)))
      expect.soft(parsed.schema, '(g2) the schema').toBe('image-log@1')
      expect
        .soft(
          parsed.images.map((i) => `${i.storyId}/${i.nodeId}`),
          '(g2) sorted by storyId then nodeId',
        )
        .toEqual([`${S1}/quick_path`, `${S1}/wise_path`])
      expect
        .soft(
          parsed.images.map((i) => Object.keys(i).sort().join(',')),
          '(g2) no timestamp: exactly the designed keys',
        )
        .toEqual(
          parsed.images.map(() =>
            [
              'c2paInMaster',
              'encoder',
              'format',
              'height',
              'legacyPath',
              'masterBytes',
              'masterSha256',
              'nodeId',
              'storyId',
              'variants',
              'width',
            ].join(','),
          ),
        )
      const later = await bind(world, { now: '2026-11-25T10:00:00.000Z' })
      const laterFolder =
        snapshotFolders(later.mi).find((n) => n.endsWith(imageLogFolder.slice(11))) ?? 'none'
      expect
        .soft(
          laterFolder !== 'none' &&
            sha(
              readFileSync(fileAt(later.mi, 'masters', 'media-log', laterFolder, 'image-log.json')),
            ),
          '(g2) a run on another day: the same bytes',
        )
        .toBe(sha(imageLog))

      // g3
      {
        const nextDay = await bind(world, { mi: real.mi, now: '2026-11-24T10:00:00.000Z' })
        expect
          .soft(
            [nextDay.exit, snapshotFolders(real.mi)],
            '(g3) a re-run a day later: no second folder',
          )
          .toEqual([0, [logFolder, imageLogFolder].sort()])
      }
      {
        const mi = newMi()
        cpSync(p2Of(real.mi), p2Of(mi), { recursive: true })
        rmSync(fileAt(mi, 'masters', 'media-log', logFolder, 'media-log.history.jsonl'))
        const ran = await bind(world, { mi })
        const history = fileAt(mi, 'masters', 'media-log', logFolder, 'media-log.history.jsonl')
        expect
          .soft(
            [ran.exit, existsSync(history) && sha(readFileSync(history))],
            '(g3) a folder holding only media-log.json is completed',
          )
          .toEqual([0, sha(world.history)])
      }
      {
        const mi = newMi()
        cpSync(p2Of(real.mi), p2Of(mi), { recursive: true })
        writeFileSync(
          fileAt(mi, 'masters', 'media-log', logFolder, 'media-log.history.jsonl'),
          '{"other":1}\n',
        )
        // MP3s to write before the masters, so a per-file pre-check would write some first.
        for (const name of readdirSync(fileAt(mi, 'media', S1)).filter((n) => n.endsWith('.mp3')))
          rmSync(fileAt(mi, 'media', S1, name))
        const before = tree(p2Of(mi))
        const ran = await bind(world, { mi })
        expect
          .soft([ran.exit, ran.lines[ran.lines.length - 1]], '(g3) a folder whose history differs')
          .toEqual([1, stopped('output-file-differs')])
        expect
          .soft(tree(p2Of(mi)), '(g3) a folder whose history differs: nothing written')
          .toEqual(before)
      }
      {
        const mi = newMi()
        cpSync(p2Of(real.mi), p2Of(mi), { recursive: true })
        cpSync(
          fileAt(mi, 'masters', 'media-log', logFolder),
          fileAt(mi, 'masters', 'media-log', `2026-11-01-${logFolder.slice(11)}`),
          { recursive: true },
        )
        const ran = await bind(world, { mi, dryRun: true })
        expect
          .soft(problems(ran.lines), '(g3) two folders with one sha12')
          .toEqual([problem('media-log-folder-invalid')])
      }

      // g4
      expect
        .soft(
          real.lines.find((l) => l.startsWith('bind: masters ')),
          '(g4) the masters line',
        )
        .toBe(`bind: masters images=2 media-log=${logFolder} image-log=${imageLogFolder}`)

      // g5 (S17-R1-SEC-1, -FID-2) the snapshot folders as `masters` reads them: a reused folder
      // whose date is not a calendar date is media-log-folder-invalid before anything is written.
      for (const [what, folder] of [
        ['the media-log folder', logFolder],
        ['the image-log folder', imageLogFolder],
      ] as const) {
        const mi = newMi()
        cpSync(p2Of(real.mi), p2Of(mi), { recursive: true })
        const from = fileAt(mi, 'masters', 'media-log', folder)
        cpSync(from, fileAt(mi, 'masters', 'media-log', `2026-02-30-${folder.slice(11)}`), {
          recursive: true,
        })
        rmSync(from, { recursive: true })
        const before = tree(p2Of(mi))
        const ran = await bind(world, { mi })
        expect
          .soft(
            [ran.exit, problems(ran.lines), tree(p2Of(mi))],
            `(g5) ${what} reused under 2026-02-30: nothing written`,
          )
          .toEqual([1, [problem('media-log-folder-invalid')], before])
      }
    },
  )
})

// ---- T17-25 ----

const TP17_13: readonly RegExp[] = [
  /^bind: map sha256=[0-9a-f]{64} rows=\d+ keep=\d+ recreate=\d+ missing=\d+ new=\d+ overrides=\d+$/,
  /^bind: correction applied [a-z0-9-]+\/[a-z][a-z0-9_]*\.[a-z]{2} (text|question|lesson) before=[0-9a-f]{12} after=[0-9a-f]{12}$/,
  /^bind: story [a-z0-9-]+ version=\d+ package=[0-9a-f]{64} images=\d+ audio=\d+ without-picture=\d+$/,
  /^bind: media webp new=\d+ reused=\d+ mp3=\d+ bytes=\d+$/,
  /^bind: masters images=\d+ media-log=\d{4}-\d{2}-\d{2}-[0-9a-f]{12} image-log=\d{4}-\d{2}-\d{2}-[0-9a-f]{12}$/,
  /^bind: note stale-part files=\d+$/,
  /^bind: problem [a-z0-9-]+( [A-Za-z0-9_-]+){0,3}$/,
  /^bind: problem \.\.\. and \d+ more$/,
  /^bind: stopped: (usage|bind-here-only|output-not-directory|output-not-real|output-path|output-file-differs|output-write|ledger-orphan|internal)$/,
  /^bind: done dry-run \(nothing written\)$/,
  /^bind: done wrote=\d+ skipped=\d+$/,
]

/** Every text string of a package (titles, node texts, choices, lessons). */
function textStrings(pkg: StoryPackageV1): string[] {
  const out: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === 'string') out.push(value)
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(pkg.text)
  return out
}

describe('the binder lines (T17-25)', () => {
  it(
    'T17-25 lines and bind-report.json: a closed set of fixed lines; no story text, local path (raw, JSON-escaped, forward-slash, URL-encoded, file URL), seed, revision or date value in any line or the report, on success and on every stop (A21, TP17-13)',
    TIMEOUT,
    async () => {
      const log = dec(world.mediaLog)
      expect(
        [String(CANARY.seed), CANARY.revision, CANARY.environment, CANARY.generatedAt].every((c) =>
          log.includes(c),
        ),
        "precondition: the log's four canaries are in the inputs",
      ).toBe(true)
      const real = await bind(world)
      expect(real.mi.includes('s17-out-'), 'precondition: the output root holds s17-out-').toBe(
        true,
      )
      const dry = await bind(world, { dryRun: true })
      const planted = await bind(await plantedWorld(), { dryRun: true })
      const mi = newMi()
      let mediaWrites = 0
      const cut: OutputFs = {
        ...nodeOutputFs,
        writeFile: (path, data, options) => {
          if (/\.(mp3|webp)\.\d+-[0-9a-f]{8}\.part$/.test(path) && ++mediaWrites === 4) {
            nodeOutputFs.writeFile(path, data.subarray(0, 3), options)
            throw Object.assign(new Error(`cut off at ${path}`), { code: 'EIO' })
          }
          nodeOutputFs.writeFile(path, data, options)
        },
      }
      const broken = await bind(world, { mi, fs: cut })
      const resumed = await bind(world, { mi })
      const runs: [string, Ran][] = [
        ['the clean real run', real],
        ['its dry run', dry],
        ["T17-16 g1's run", planted],
        ["T17-22 g5's cut-off run", broken],
        ["T17-22 g5's re-run", resumed],
      ]

      // g1
      for (const [what, ran] of runs) {
        expect
          .soft(
            ran.lines.filter((line) => !TP17_13.some((re) => re.test(line))),
            `(g1) ${what}: every line in TP17-13`,
          )
          .toEqual([])
      }

      // g2
      const report = dec(readFileSync(fileAt(real.mi, 'bind-report.json')))
      const texts = [...textStrings(P1[S1]), ...textStrings(P1[S2]), PLANTED].flatMap((t) => [
        t,
        t.slice(0, 24),
      ])
      for (const [what, ran] of [
        ...runs,
        ['bind-report.json', { ...real, lines: [report] } as Ran] as [string, Ran],
      ]) {
        const all = ran.lines.join('\n')
        const root = ran.mi === '' ? mi : ran.mi
        const forms = [
          root,
          JSON.stringify(root).slice(1, -1),
          root.replaceAll('\\', '/'),
          encodeURIComponent(root),
          pathToFileURL(root).href,
        ]
        expect
          .soft(
            [String(CANARY.seed), CANARY.revision, CANARY.environment, CANARY.generatedAt].filter(
              (c) => all.includes(c),
            ),
            `(g2) ${what}: no canary`,
          )
          .toEqual([])
        expect
          .soft(texts.filter((t) => all.includes(t)).length, `(g2) ${what}: no story text`)
          .toBe(0)
        expect
          .soft(forms.filter((f) => all.includes(f)).length, `(g2) ${what}: no output root form`)
          .toBe(0)
        expect
          .soft(
            all.replace(/\d{4}-\d{2}-\d{2}-[0-9a-f]{12}/g, '').match(/\d{4}-\d{2}-\d{2}/g) ?? [],
            `(g2) ${what}: no date but the snapshot folder names`,
          )
          .toEqual([])
      }
    },
  )
})

// ---- T17-26 ----

const FAKE_KEY = ['sb', 'secret', 'fake-bind-test-key'].join('_')
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

describe('the binder output through the stub (T17-26)', () => {
  it(
    "T17-26 the binder's output through the stub: stage stages it with A001-A003 passing and a re-stage is unchanged; masters creates every object and a re-run plans none (A18, A31, D17-12, D17-19, CRIT-12)",
    TIMEOUT,
    async () => {
      const realFetch = globalThis.fetch
      let escapes = 0
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
        escapes++
        return Promise.reject(new TypeError('blocked: not a loopback host'))
      })
      const stub: StorageStub = await startStorageStub({ apikey: FAKE_KEY })
      try {
        const real = await bind(world)
        expect(real.exit, 'precondition: a clean real run').toBe(0)
        const p2 = p2Of(real.mi)
        const work = join(real.mi, '..')
        const waivers = join(work, 'waivers')
        mkdirSync(waivers)
        for (const id of [S1, S2]) {
          const bytes = waiverBytesOf(waiverFileOf(id))
          writeFileSync(join(waivers, `${id}.json`), bytes)
          // Stage reads each local waiver file's masters copy (an earlier upload, as stage.test.ts).
          stub.put('masters', `waivers/${id}/${sha(bytes)}.json`, bytes, 'application/json')
        }
        const context = { cwd: work, storyboardRoot: join(work, 'sb'), platform: process.platform }
        const client = () =>
          createStorageClient({ supabaseUrl: stub.origin, secretKey: new Secret(FAKE_KEY) })
        const out: string[] = []
        const deps = {
          storyboardRoot: context.storyboardRoot,
          platform: process.platform,
          now: () => new Date(NOW),
          sleep: async () => {},
          log: (line: string) => void out.push(line),
          error: (line: string) => void out.push(line),
          realPath: realpathSync.native,
        }
        const stageArgs = (extra: string[]) => {
          const parsed = parseArgs(
            [
              'stage',
              S2,
              S1,
              '--packages',
              join(p2, 'packages'),
              '--media',
              p2,
              '--waivers',
              waivers,
              '--report-dir',
              join(work, 'reports'),
              ...extra,
            ],
            context,
          )
          if (!parsed.ok || parsed.command !== 'stage') throw new Error('test setup: stage args')
          return parsed
        }
        const stage = async (extra: string[]) => {
          out.length = 0
          const exit = await runStage(stageArgs(extra), { ...deps, makePort: client })
          return { exit, lines: [...out] }
        }
        const dry = await stage(['--dry-run'])
        const storyLine = (id: string) => dry.lines.find((l) => l.startsWith(`stage: ${id} `)) ?? ''
        expect(
          [
            dry.exit,
            /state=new media-new=8 /.test(storyLine(S2)),
            /state=new media-new=14 /.test(storyLine(S1)),
          ],
          `precondition: stage's dry run plans both new, 22 media objects ${dry.lines.join(' | ')}`,
        ).toEqual([0, true, true])

        // g1
        const commit = await stage([])
        expect.soft(commit.exit, `(g1) the stage commit ${commit.lines.join(' | ')}`).toBe(0)
        const declared = [S1, S2].flatMap((id) =>
          StoryPackageV1.parse(readJson(join(p2, 'packages', `${id}.json`))).assets.flatMap(
            (a) => a.variants,
          ),
        )
        for (const v of declared) {
          const stored = stub.object('content', v.path)
          expect
            .soft(
              stored && [
                stored.contentType,
                sha(stored.bytes) === /([0-9a-f]{64})-[a-z0-9]+\.[a-z0-9]+$/.exec(v.path)?.[1],
              ],
              `(g1) ${v.path}: stored with its type and named by its bytes`,
            )
            .toEqual([v.mime, true])
        }
        const contentPosts = () =>
          stub.requests.filter(
            (r) => r.method === 'POST' && r.pathname.startsWith('/storage/v1/object/content/'),
          )
        expect
          .soft(
            contentPosts().filter((r) => /\.(png|jpg)$/.test(r.pathname)).length,
            '(g1) no .png or .jpg object in content',
          )
          .toBe(0)

        // g2
        // Object creates only (a listing is a POST to /storage/v1/object/list/).
        const creates = () =>
          stub.requests.filter(
            (r) => r.method === 'POST' && !r.pathname.startsWith('/storage/v1/object/list/'),
          ).length
        const postsBefore = creates()
        const again = await stage([])
        expect
          .soft(
            [
              again.exit,
              again.lines.filter((l) => / state=unchanged /.test(l)).length,
              creates() - postsBefore,
            ],
            `(g2) a re-stage is unchanged with 0 POST ${again.lines.join(' | ')}`,
          )
          .toEqual([0, 2, 0])

        // g3
        const report = readJson(join(p2, 'bind-report.json')) as {
          masters: { imageMasters: number; mediaLogFiles: number }
        }
        const masters = async (extra: string[]) => {
          out.length = 0
          const parsed = parseArgs(
            [
              'masters',
              '--masters',
              join(p2, 'masters'),
              '--report-dir',
              join(work, 'reports'),
              ...extra,
            ],
            context,
          )
          if (!parsed.ok || parsed.command !== 'masters')
            throw new Error('test setup: masters args')
          const exit = await runMasters(parsed, {
            ...deps,
            makePort: () => {
              const port: MastersPort = client()
              return port
            },
          })
          return { exit, lines: [...out] }
        }
        const plan = (lines: string[]) =>
          /plan=([0-9a-f]{64})/.exec(
            lines.find((l) => l.startsWith('masters: plan ')) ?? '',
          )?.[1] ?? ''
        const mDry = await masters(['--dry-run'])
        expect
          .soft(
            mDry.lines.find((l) => l.startsWith('masters: classes')),
            '(g3) the classes line equals bind-report.json',
          )
          .toBe(
            `masters: classes image-master=${report.masters.imageMasters} media-log=${report.masters.mediaLogFiles}`,
          )
        expect
          .soft(
            [
              report.masters.imageMasters,
              report.masters.mediaLogFiles,
              mDry.lines.filter((l) => / state=new$/.test(l)).length,
            ],
            '(g3) 5 new objects',
          )
          .toEqual([2, 3, 5])
        const mCommit = await masters(['--expect-plan', plan(mDry.lines)])
        expect
          .soft(
            [mCommit.exit, mCommit.lines[mCommit.lines.length - 1]],
            '(g3) the commit creates 5',
          )
          .toEqual([0, 'masters: done created=5 existing=0'])
        const mDry2 = await masters(['--dry-run'])
        const mAgain = await masters(['--expect-plan', plan(mDry2.lines)])
        const outcome = (
          readJson(join(work, 'reports', 'publisher-masters.json')) as { outcome?: string }
        ).outcome
        expect
          .soft([mAgain.exit, outcome], '(g3) a re-run: masters-unchanged')
          .toEqual([0, 'masters-unchanged'])
        expectNoUnexpected(stub)
      } finally {
        await stub.close()
        vi.unstubAllGlobals()
      }
      expect(escapes, 'loopback guard: requests that tried to leave 127.0.0.1').toBe(0)
    },
  )
})

// ---- T17-27 ----

const LEGACY_MODULE_CAP = 1_048_576

describe('localLegacyIo (T17-27)', () => {
  it('T17-27 localLegacyIo: the frozen loader reads pt/src/stories through listLocalFolder and readLocalFile, so a link named like a module stops the load (CRIT-5)', () => {
    const base = newMi()
    const source = 'const syn = { "id": "syn-story" }\nexport default syn\n'
    const frozenOf = (text: string) => ({ 'pt/src/stories/syn.js': sha(enc(text)) })
    const dir = join(base, 'stories')
    mkdirSync(dir)
    writeFileSync(join(dir, 'syn.js'), source)
    const loaded = loadFrozenLegacyStories(dir, frozenOf(source), localLegacyIo(dir))
    expect(
      loaded.map((l) => l.story.id),
      'precondition: one synthetic module loads',
    ).toEqual(['syn-story'])

    // g1: a link named like the module.
    const linked = join(base, 'linked')
    mkdirSync(linked)
    const realFile = join(base, 'real-syn.js')
    writeFileSync(realFile, source)
    let made = true
    try {
      if (process.platform === 'win32') {
        const folder = join(base, 'a-folder')
        mkdirSync(folder)
        symlinkSync(folder, join(linked, 'syn.js'), 'junction')
      } else symlinkSync(realFile, join(linked, 'syn.js'), 'file')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
        console.log('skipped: junction not creatable here (PB3)')
        made = false
      } else throw error
    }
    if (made) {
      expect
        .soft(
          () => loadFrozenLegacyStories(linked, frozenOf(source), localLegacyIo(linked)),
          '(g1) a link named like the module',
        )
        .toThrow()
    }
    // g1: a module one byte over the module cap, its frozen hash matching (the readFileSync form reads it).
    const big = join(base, 'big')
    mkdirSync(big)
    const padding = `// ${'x'.repeat(LEGACY_MODULE_CAP - source.length - 3)}\n`
    const bigSource = `${padding}${source}`
    expect(enc(bigSource).length, 'precondition: the module is one byte over the cap').toBe(
      LEGACY_MODULE_CAP + 1,
    )
    writeFileSync(join(big, 'syn.js'), bigSource)
    expect
      .soft(
        () => loadFrozenLegacyStories(big, frozenOf(bigSource), localLegacyIo(big)),
        '(g1) a module over the cap',
      )
      .toThrow()
  })
})

// ---- T17-28 ----

const FACT_KEYS = new Set([
  'storyId',
  'nodeId',
  'locale',
  'sha256',
  'bytes',
  'durationMs',
  'narratedTextSha256',
  'listenPending',
])
const FORBIDDEN_NAMES = new Set([
  'readJsonFile',
  'seed',
  'modelRevision',
  'parlerCommit',
  'tokenizerRevision',
  'generatedAt',
  'ingestedAt',
  'environment',
  'gainDb',
  'levelPeakDbfs',
])

/** The reviewed source check of bind-real-data.test.ts (A43): findings, and the logFacts count. */
function scanRealDataSource(text: string): { logFacts: number; findings: string[] } {
  const file = ts.createSourceFile(
    'bind-real-data.test.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const findings: string[] = []
  let logFacts = 0
  let parses = 0
  const isLogFacts = (node: ts.Node): boolean =>
    (ts.isFunctionDeclaration(node) && node.name?.text === 'logFacts') ||
    (ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'logFacts' &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
  const isJsonParse = (node: ts.Node): boolean =>
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'JSON' &&
      node.name.text === 'parse') ||
    (ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'JSON' &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'parse')
  const jsonPath = (node: ts.Node | undefined) =>
    node !== undefined && ts.isStringLiteralLike(node) && /\.json$/i.test(node.text)
  const at = (node: ts.Node, what: string) =>
    findings.push(`${file.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${what}`)
  const visit = (node: ts.Node, inside: boolean): void => {
    const here = inside || isLogFacts(node)
    if (isLogFacts(node)) logFacts++
    if (isJsonParse(node)) {
      parses++
      const called = ts.isCallExpression(node.parent) && node.parent.expression === node
      if (!here || !called) at(node, 'JSON.parse outside a call in logFacts')
    }
    if (here && ts.isObjectLiteralExpression(node)) {
      for (const p of node.properties) {
        if (ts.isSpreadAssignment(p)) at(p, 'a spread')
        else if (p.name !== undefined && ts.isComputedPropertyName(p.name)) at(p, 'a computed key')
        else if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p))
          at(p, 'a member')
        else if (
          !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ||
          !FACT_KEYS.has(p.name.text)
        )
          at(p, 'a key outside the eight')
      }
    }
    if (ts.isIdentifier(node) && FORBIDDEN_NAMES.has(node.text)) at(node, 'a private name')
    if (ts.isStringLiteralLike(node) && FORBIDDEN_NAMES.has(node.text))
      at(node, 'a private name string')
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      jsonPath(node.moduleSpecifier)
    )
      at(node, 'a .json import')
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      jsonPath(node.moduleReference.expression)
    )
      at(node, 'a .json import')
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      jsonPath(node.arguments[0])
    )
      at(node, 'a .json require or import()')
    ts.forEachChild(node, (child) => visit(child, here))
  }
  visit(file, false)
  if (parses !== 1) findings.push(`JSON.parse count ${parses}`)
  return { logFacts, findings }
}

const GOOD_LOG_FACTS = `function logFacts(bytes: Uint8Array) {
  const records = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>[]
  return records.map((r) => ({ storyId: String(r.storyId), listenPending: Object.hasOwn(r, 'listenPending') }))
}
`

describe('the bind-real-data source check (T17-28)', () => {
  it('T17-28 bind-real-data.test.ts reads the private media log only through logFacts, a projection to eight public keys (CRIT-13)', () => {
    const real = scanRealDataSource(readFileSync(join(HERE, 'bind-real-data.test.ts'), 'utf8'))
    expect(real.logFacts, 'precondition: exactly one function named logFacts').toBe(1)
    expect(
      scanRealDataSource(GOOD_LOG_FACTS).findings,
      'precondition: a clean sample is clean',
    ).toEqual([])

    // g1
    expect
      .soft(
        real.findings,
        '(g1) the real file: one JSON.parse in logFacts, eight keys, no private name or .json import',
      )
      .toEqual([])

    // g2
    const samples: [string, string][] = [
      ['an alias', `${GOOD_LOG_FACTS}const p = JSON.parse\np('[]')\n`],
      ['Reflect.apply', `${GOOD_LOG_FACTS}Reflect.apply(JSON.parse, null, ['[]'])\n`],
      ['a bracket key', `${GOOD_LOG_FACTS}JSON['parse']('[]')\n`],
      ['readJsonFile', `${GOOD_LOG_FACTS}readJsonFile('x')\n`],
      ['a spread', GOOD_LOG_FACTS.replace('({ storyId', '({ ...r, storyId')],
      ['a computed key', GOOD_LOG_FACTS.replace('({ storyId', '({ [k]: r[k], storyId')],
      [
        'a .json import',
        `import log from '../../migration-input/narration/media-log.json'\n${GOOD_LOG_FACTS}`,
      ],
      [
        'a .json require',
        `${GOOD_LOG_FACTS}const l = require('../../migration-input/narration/media-log.json')\n`,
      ],
    ]
    for (const [what, text] of samples) {
      expect
        .soft(scanRealDataSource(text).findings.length > 0, `(g2) ${what} is a finding`)
        .toBe(true)
    }
  })
})
