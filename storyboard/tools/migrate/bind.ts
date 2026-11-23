// The media binder's core (design migration-input/p1-step17-design.md D17-3, D17-10, D17-12 to D17-14,
// D17-18, D17-26 to D17-29, §3.3, §3.10, §3.12-§3.14, §3.18, A14-A19, A31, A32, A35; P1-9a, Step 17).
// It turns the 11 phase-1 packages, the narration MP3s and the kept legacy PNG pictures into
// version-2 packages under migration-input/phase2 (P2). The CLI (bind-cli.ts) injects the inputs, the
// codec loader and the output; tests inject an in-memory world and a fake codec.
// - checkInputs (phases 1-6, no codec, no writer): 1 the approved map (sha256 of its bytes is the
//   flag; strict JSON; every row re-derived from the legacy modules; then the owner's demotions);
//   2 the phase-1 folder holds exactly the legacy stories' files, each strict, canonical and
//   byte-equal to the re-conversion; 3 the recorded text corrections; 4 narration: the plan from
//   the corrected packages and the saved seeds, every key's record, file and hash-list line agreeing
//   three ways, and media-log.json and its history passing the masters body gate (masterBodyRule);
//   5 every kept master 1024x1024 or 1408x768 with a caBX chunk. Problems are collected in phase
//   order.
// - runBind: the output opened for reading (the guards of bind-output.ts); the ledger (phase 5:
//   reuse, re-read every recorded variant, each passing webp-facts at its recorded size); problems
//   print (at most 50 lines, then a count) and stop before any encode; phase 7 encodes only masters
//   with no ledger entry (versions pinned first; each variant one VP8 key frame of the expected
//   size, at most 10 MiB); phase 8 builds the packages (publish-mode validation: S001, X000, A001,
//   T006 refuse), the image log and the snapshot folders (reused by sha12 alone when the folder's
//   date is a calendar date); then the orphan check and the
//   create-only pre-check of every target (also in a dry run); then the writes: media, masters,
//   packages, the ledger last, then bind-report.json.
// Lines are a closed set (ids, counts, hashes, snapshot folder names): never text, a local path, a
// seed, a revision or any other date.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { MEDIA_MAX_BYTES } from '../../src/core/content/media'
import { jcsBytes } from '../../src/core/hashing'
import { NodeId, Sha256, StoryId, StoryPackageV1, hasOwnProtoKey } from '../../src/core/package/v1'
import type { StoryAsset } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { validatePackage } from '../../src/core/validator/validate'
import { mp3Info } from '../narration/mp3'
import { RECIPE_V2, isParlerLocale } from '../narration/parler'
import type { ParlerLocale, ParlerPlanEntry } from '../narration/parler'
import { buildEntriesFor, keyOf, parseSeedOverrides } from '../narration/parler-pipeline'
import type { LocalList, LocalRead } from '../publisher/local-files'
import { sniffMime } from '../publisher/media-check'
import {
  MAX_JSON_BYTES,
  MEDIA_LOG_MAX_BYTES,
  masterBodyRule,
  targetOf,
} from '../publisher/storage-layout'
import type { MediaLogRef, Target } from '../publisher/storage-layout'
import { parseHashList } from '../publisher/takedown'
import { OutputError, openOutput } from './bind-output'
import type { Output, OutputDeps, OutputTarget } from './bind-output'
import { convertLegacyStory } from './convert'
import { EXPECTED_ENCODER, WEBP_SETTINGS } from './image-codec'
import type { ImageCodec } from './image-codec'
import {
  ImageMapFile,
  applyImageMapOverrides,
  checkImageMap,
  countImageRows,
  deriveLegacyImageRows,
  parseImageMapOverrides,
} from './legacy-images'
import type { ImageRowCounts, LegacyImageReader, LegacyImageRow } from './legacy-images'
import type { LegacyStory } from './load-legacy'
import {
  TEXT_CORRECTIONS_MAX_BYTES,
  applyTextCorrections,
  parseTextCorrections,
} from './text-corrections'
import type { AppliedCorrection } from './text-corrections'
import { readWebpFacts } from './webp-facts'

/** The cap each input is read with (readLocalFile in the CLI). */
export const BIND_INPUT_CAPS = {
  map: MAX_JSON_BYTES,
  phase1: MAX_JSON_BYTES,
  corrections: TEXT_CORRECTIONS_MAX_BYTES,
  overrides: 65_536,
  seedOverrides: 65_536,
  mediaLog: MEDIA_LOG_MAX_BYTES,
  history: MEDIA_LOG_MAX_BYTES,
  hashList: MAX_JSON_BYTES,
  audio: MEDIA_MAX_BYTES,
} as const

const PROBLEM_LINES_MAX = 50
/** Every master's narrow variant; the other is the master's own width (D17-8). */
const NARROW_WIDTH = 768
const MASTER_SIZES: readonly (readonly [number, number])[] = [
  [1024, 1024],
  [1408, 768],
]
const PHASE1_SUFFIX = '.phase1.json'
const IMAGE_PROVENANCE = {
  origin: 'ai_generated',
  vendor: 'Google',
  product: 'Gemini app',
} as const
const AUDIO_PROVENANCE = {
  origin: 'ai_generated',
  vendor: 'AI4Bharat',
  product: 'Indic Parler-TTS (Apache-2.0)',
} as const
/** The validator checks that refuse a built package (the waived legacy errors are stage's to judge). */
const BLOCKING_CHECKS: ReadonlySet<string> = new Set(['S001', 'X000', 'A001', 'T006'])
const SNAPSHOT_FOLDER = /^([0-9]{4}-[0-9]{2}-[0-9]{2})-([a-f0-9]{12})$/

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
/** sha256(jcsBytes(WEBP_SETTINGS)): the ledger's settingsSha256. */
export const SETTINGS_SHA256 = sha256(jcsBytes(WEBP_SETTINGS))

// ---- inputs, problems, facts ----

/** One input read with the binder's cap. */
export type CappedRead = (cap: number) => LocalRead

/** The binder's inputs, each a reader called once (realInputs in bind-cli.ts; a world in tests). */
export interface BindInputs {
  readonly legacyStories: () => readonly LegacyStory[]
  readonly map: CappedRead
  /** `<pt/public>/<segments...>`. */
  readonly legacyFile: LegacyImageReader
  readonly phase1List: () => LocalList
  readonly phase1Read: (name: string, cap: number) => LocalRead
  readonly corrections: CappedRead
  readonly overrides: CappedRead
  /** `local-file-missing` means no saved seeds. */
  readonly seedOverrides: CappedRead
  readonly mediaLog: CappedRead
  readonly history: CappedRead
  readonly hashList: CappedRead
  /** `<migration-input/audio>/<storyId>/<nodeId>.<locale>.mp3`. */
  readonly audio: (segments: readonly string[], cap: number) => LocalRead
}

export interface BindProblem {
  readonly code: string
  /** storyId, then nodeId (or a check id), then locale, as far as the problem has them. */
  readonly ids: readonly string[]
}

export interface PlannedNarration {
  readonly key: string
  readonly narratedTextSha256: string
}

export interface BindFacts {
  readonly mapSha256: string | null
  /** The bound rows' counts (after the demotions), when phase 1 is clean. */
  readonly counts: ImageRowCounts | null
  readonly overrides: number
  readonly applied: readonly AppliedCorrection[]
  readonly stories: readonly string[]
  readonly narration: {
    readonly planned: readonly PlannedNarration[]
    readonly passed: number
  } | null
}

export interface BindCheck {
  readonly problems: readonly BindProblem[]
  readonly facts: BindFacts
}

interface Narrated {
  readonly entry: ParlerPlanEntry
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly durationMs: number
}

interface Inspected extends BindCheck {
  /** The corrected packages, in storyId order. */
  readonly packages: readonly StoryPackageV1[]
  /** The bound rows (after the demotions), or null when they cannot be derived. */
  readonly rows: readonly LegacyImageRow[] | null
  readonly masters: ReadonlyMap<string, Uint8Array>
  readonly narrated: ReadonlyMap<string, Narrated>
  readonly mediaLog: Uint8Array | null
  readonly history: Uint8Array | null
}

const byStoryId = <T extends { readonly storyId: string }>(a: T, b: T): number =>
  a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

type JsonRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

/** Strict JSON: no BOM, fatal UTF-8, JSON.parse, no own `__proto__` key. */
function strictJson(bytes: Uint8Array): JsonRead {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { ok: false }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    return { ok: false }
  }
  return hasOwnProtoKey(value) ? { ok: false } : { ok: true, value }
}

const isCanonical = (value: unknown, bytes: Uint8Array): boolean => {
  try {
    return sameBytes(jcsBytes(value), bytes)
  } catch {
    return false
  }
}

/** A phase-1 file: strict JSON, a strict package naming `storyId`, canonical JCS. */
function isPhase1File(bytes: Uint8Array, storyId: string): boolean {
  const json = strictJson(bytes)
  if (!json.ok) return false
  const parsed = StoryPackageV1.safeParse(json.value)
  return parsed.success && parsed.data.storyId === storyId && isCanonical(json.value, bytes)
}

const sameNames = (listed: readonly string[], expected: readonly string[]): boolean => {
  const a = [...listed].sort()
  const b = [...expected].sort()
  return a.length === b.length && a.every((name, i) => name === b[i])
}

/** media-log.json: a strict JSON array of objects, each keyed once by story, node and locale. */
function parseMediaLog(bytes: Uint8Array): Map<string, Record<string, unknown>> | null {
  const json = strictJson(bytes)
  if (!json.ok || !Array.isArray(json.value)) return null
  const records = new Map<string, Record<string, unknown>>()
  for (const item of json.value as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    const { storyId, nodeId, locale } = record
    if (typeof storyId !== 'string' || typeof nodeId !== 'string' || typeof locale !== 'string')
      return null
    const key = keyOf({ storyId, nodeId, locale })
    if (records.has(key)) return null
    records.set(key, record)
  }
  return records
}

/**
 * The masters target of one snapshot file `<folder>/<file>`, built by storage-layout's own rules
 * (the folder's date a calendar date, its sha12 12 lower hex), or null when they refuse it.
 */
function snapshotTarget(folder: string, file: MediaLogRef['file']): Target | null {
  const match = SNAPSHOT_FOLDER.exec(folder)
  if (match === null) return null
  const target = targetOf({ kind: 'media-log', date: match[1], sha12: match[2], file }, 'create')
  return target.ok ? target.value : null
}

/**
 * True when `masters` would take these bytes as `<folder>/<file>`: the folder's target and the masters
 * body gate (masterBodyRule, §3.7, TP17-6), checked before anything is written (S17-R1-SEC-1).
 */
async function passesMastersGate(
  folder: string,
  file: MediaLogRef['file'],
  bytes: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const target = snapshotTarget(folder, file)
  return target !== null && (await masterBodyRule(target, bytes)) === null
}

/** The record's provenance is exactly the four public fields of its locale's voice. */
function isNarrationProvenance(value: unknown, locale: ParlerLocale): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const want: Record<string, string> = { ...AUDIO_PROVENANCE, voice: RECIPE_V2.voices[locale] }
  const got = value as Record<string, unknown>
  const keys = Object.keys(got).sort()
  return (
    keys.join(',') === Object.keys(want).sort().join(',') &&
    keys.every((key) => got[key] === want[key])
  )
}

/** Phase 4 for one plan entry: the first failing rule, or the narrated file. */
function checkNarration(
  entry: ParlerPlanEntry,
  record: Record<string, unknown> | undefined,
  lines: ReadonlyMap<string, string> | null,
  inputs: BindInputs,
): string | Narrated {
  if (record === undefined) return 'narration-record-missing'
  if (record.file !== `audio/${entry.file}`) return 'narration-file'
  const read = inputs.audio(
    [entry.storyId, `${entry.nodeId}.${entry.locale}.mp3`],
    BIND_INPUT_CAPS.audio,
  )
  if (!read.ok || sniffMime(read.bytes) !== 'audio/mpeg') return 'narration-file'
  const hash = sha256(read.bytes)
  if (record.sha256 !== hash || record.bytes !== read.bytes.length) return 'narration-hash'
  if (lines !== null && lines.get(keyOf(entry)) !== hash) return 'narration-hash'
  const durationMs = record.durationMs
  if (
    typeof durationMs !== 'number' ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    mp3Info(read.bytes).durationMs !== durationMs
  ) {
    return 'narration-duration'
  }
  if (record.narratedTextSha256 !== entry.narratedTextSha256) return 'narration-stale'
  if (Object.hasOwn(record, 'listenPending')) return 'narration-listen-pending'
  if (!isNarrationProvenance(record.provenance, entry.locale)) return 'narration-provenance'
  return { entry, bytes: read.bytes, sha256: hash, durationMs }
}

/**
 * Phases 1-5 (without the ledger): every problem in phase order, the facts and the checked state.
 * `date` (the run's UTC date) only names the snapshot folder the media log is gated under.
 */
async function inspect(
  inputs: BindInputs,
  approvedMapSha256: string,
  date: string,
): Promise<Inspected> {
  const problems: BindProblem[] = []
  const add = (code: string, ...ids: string[]) => void problems.push({ code, ids })

  // Phase 1: the map. A map that is not the approved file stops here; no other input is read.
  const mapRead = inputs.map(BIND_INPUT_CAPS.map)
  if (!mapRead.ok || sha256(mapRead.bytes) !== approvedMapSha256) {
    add('map-sha256-mismatch')
    return {
      problems,
      facts: {
        mapSha256: null,
        counts: null,
        overrides: 0,
        applied: [],
        stories: [],
        narration: null,
      },
      packages: [],
      rows: null,
      masters: new Map(),
      narrated: new Map(),
      mediaLog: null,
      history: null,
    }
  }
  const mapJson = strictJson(mapRead.bytes)
  const map = mapJson.ok ? ImageMapFile.safeParse(mapJson.value) : null
  if (map === null || !map.success) add('map-invalid')
  const stories = [...inputs.legacyStories()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  const derived = deriveLegacyImageRows(stories, inputs.legacyFile)
  if (!derived.ok) for (const p of derived.problems) add(p.code, p.storyId, p.nodeId)
  if (derived.ok && map !== null && map.success) {
    const checked = checkImageMap(map.data, derived.rows)
    if (!checked.ok) {
      for (const p of checked.problems) {
        if (p.code === 'map-rows') add(p.code)
        else add(p.code, p.storyId, p.nodeId)
      }
    }
  }
  const overridesRead = inputs.overrides(BIND_INPUT_CAPS.overrides)
  const overrides = overridesRead.ok ? parseImageMapOverrides(overridesRead.bytes) : null
  let rows: readonly LegacyImageRow[] | null = null
  if (overrides === null || !overrides.ok) add('image-map-overrides-invalid')
  else if (derived.ok) {
    const bound = applyImageMapOverrides(derived.rows, overrides.records)
    if (bound.ok) rows = bound.rows
    else add('image-map-overrides-invalid')
  }
  const counts = problems.length === 0 && rows !== null ? countImageRows(rows) : null

  // Phase 2: the phase-1 files are exactly the re-conversion of the frozen legacy stories.
  const converted = stories.map((story) => convertLegacyStory(story)).sort(byStoryId)
  const expected = converted.map((pkg) => `${pkg.storyId}${PHASE1_SUFFIX}`)
  const listed = inputs.phase1List()
  if (expected.length === 0 || !listed.ok || !sameNames(listed.names, expected)) add('phase1-set')
  else {
    for (const pkg of converted) {
      const read = inputs.phase1Read(`${pkg.storyId}${PHASE1_SUFFIX}`, BIND_INPUT_CAPS.phase1)
      if (!read.ok || !isPhase1File(read.bytes, pkg.storyId)) add('phase1-invalid', pkg.storyId)
      else if (!sameBytes(read.bytes, jcsBytes(pkg))) add('phase1-drift', pkg.storyId)
    }
  }

  // Phase 3: the recorded corrections.
  let packages: readonly StoryPackageV1[] = converted
  let applied: readonly AppliedCorrection[] = []
  const correctionsRead = inputs.corrections(BIND_INPUT_CAPS.corrections)
  const corrections = correctionsRead.ok ? parseTextCorrections(correctionsRead.bytes) : null
  if (corrections === null || !corrections.ok) add('correction-file')
  else {
    const result = applyTextCorrections(converted, corrections.records)
    if (result.ok) {
      packages = result.packages
      applied = result.applied
    } else add(result.code, result.storyId, result.nodeId, result.locale)
  }

  // Phase 4: narration, three ways (the log, the hash list, the files) against the corrected plan.
  let seeds: Record<string, number> | null = null
  const seedRead = inputs.seedOverrides(BIND_INPUT_CAPS.seedOverrides)
  if (seedRead.ok) {
    try {
      seeds = parseSeedOverrides(seedRead.bytes)
    } catch {
      seeds = null
    }
  } else if (seedRead.code === 'local-file-missing') seeds = {}
  let entries: ParlerPlanEntry[] | null = null
  if (seeds !== null) {
    try {
      entries = await buildEntriesFor(packages, seeds)
    } catch {
      entries = null
    }
  }
  if (entries === null) add('narration-overrides')
  const logRead = inputs.mediaLog(BIND_INPUT_CAPS.mediaLog)
  const records = logRead.ok ? parseMediaLog(logRead.bytes) : null
  const historyRead = inputs.history(BIND_INPUT_CAPS.history)
  // Both files as `masters` will take them (S17-R1-SEC-1): the masters body gate under the folder
  // this run names, so a log masters would refuse stops here, before anything is written.
  const logFolder = logRead.ok ? `${date}-${sha256(logRead.bytes).slice(0, 12)}` : ''
  const logGated =
    logRead.ok && (await passesMastersGate(logFolder, 'media-log.json', logRead.bytes))
  const historyGated =
    logRead.ok &&
    historyRead.ok &&
    (await passesMastersGate(logFolder, 'media-log.history.jsonl', historyRead.bytes))
  if (records === null || !historyRead.ok || !logGated || !historyGated) {
    add('narration-log-invalid')
  }
  const listRead = inputs.hashList(BIND_INPUT_CAPS.hashList)
  const list = listRead.ok ? parseHashList(listRead.bytes) : null
  let lines: Map<string, string> | null = null
  if (list === null || !list.ok) add('hash-list-invalid')
  else {
    lines = new Map(
      list.lines.map((l) => [`${l.storyId}/${l.file.slice(0, -'.mp3'.length)}`, l.sha256]),
    )
  }
  const narrated = new Map<string, Narrated>()
  if (entries !== null && records !== null) {
    for (const entry of entries) {
      const result = checkNarration(entry, records.get(keyOf(entry)), lines, inputs)
      if (typeof result === 'string') add(result, entry.storyId, entry.nodeId, entry.locale)
      else narrated.set(keyOf(entry), result)
    }
  }
  if (entries !== null && list !== null && list.ok) {
    const planned = new Set(entries.map((e) => keyOf(e)))
    for (const line of list.lines) {
      const key = `${line.storyId}/${line.file.slice(0, -'.mp3'.length)}`
      if (planned.has(key)) continue
      add('hash-list-extra', line.storyId, line.file.slice(0, -7), line.file.slice(-6, -4))
    }
  }

  // Phase 5: each kept master's size and caBX (the ledger is runBind's: it reads the output).
  for (const row of rows ?? []) {
    if (row.action !== 'keep') continue
    if (!MASTER_SIZES.some(([w, h]) => row.width === w && row.height === h)) {
      add('master-size', row.storyId, row.nodeId)
    } else if (row.caBX !== true) add('master-no-c2pa', row.storyId, row.nodeId)
  }

  return {
    problems,
    facts: {
      mapSha256: sha256(mapRead.bytes),
      counts,
      overrides: overrides !== null && overrides.ok ? overrides.records.length : 0,
      applied,
      stories: converted.map((pkg) => pkg.storyId),
      narration:
        entries === null
          ? null
          : {
              planned: entries.map((e) => ({
                key: keyOf(e),
                narratedTextSha256: e.narratedTextSha256,
              })),
              passed: narrated.size,
            },
    },
    packages,
    rows,
    masters: derived.ok ? derived.masters : new Map(),
    narrated,
    mediaLog: logRead.ok ? logRead.bytes : null,
    history: historyRead.ok ? historyRead.bytes : null,
  }
}

/**
 * Phases 1-6 without a codec or a writer: every problem in phase order, and the facts. `date` (UTC,
 * YYYY-MM-DD) names the snapshot folder the media log is gated under; the gate does not depend on it.
 */
export async function checkInputs(
  inputs: BindInputs,
  approvedMapSha256: string,
  date: string = new Date().toISOString().slice(0, 10),
): Promise<BindCheck> {
  const { problems, facts } = await inspect(inputs, approvedMapSha256, date)
  return { problems, facts }
}

// ---- the binding ledger (§3.10) ----

const LedgerVariant = z
  .strictObject({
    token: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sha256: Sha256,
    bytes: z.number().int().positive(),
  })
  .refine((v) => v.token === `w${v.width}`)
type LedgerVariant = z.infer<typeof LedgerVariant>

const LedgerEntry = z
  .strictObject({
    masterSha256: Sha256,
    storyId: StoryId,
    nodeId: NodeId,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    variants: z.array(LedgerVariant).min(1),
    encoder: z.strictObject({
      sharp: z.string(),
      vips: z.string(),
      webp: z.string(),
      settingsSha256: Sha256,
    }),
  })
  .refine((e) => e.variants.map((v) => v.width).join(',') === `${NARROW_WIDTH},${e.width}`)
type LedgerEntry = z.infer<typeof LedgerEntry>

const LedgerFile = z.strictObject({
  schema: z.literal('binding-ledger@1'),
  images: z.array(LedgerEntry),
})

const LEDGER_NAME = 'binding-ledger.json'
const variantName = (v: LedgerVariant): string => `${v.sha256}-${v.token}.webp`
const variantPath = (storyId: string, v: LedgerVariant): string =>
  `media/${storyId}/${variantName(v)}`

/** The ledger's entries by master: absent is a first binding; anything else malformed is null. */
function readLedger(output: Output): Map<string, LedgerEntry> | null {
  const bytes = output.read([LEDGER_NAME])
  if (bytes === null) return new Map()
  const json = strictJson(bytes)
  if (!json.ok) return null
  const parsed = LedgerFile.safeParse(json.value)
  if (!parsed.success || !isCanonical(json.value, bytes)) return null
  const images = parsed.data.images
  for (let i = 1; i < images.length; i++) {
    if (!(images[i - 1]!.masterSha256 < images[i]!.masterSha256)) return null
  }
  return new Map(images.map((entry) => [entry.masterSha256, entry]))
}

/** A bound master's ledger entry: unchanged, and every recorded variant present with its bytes. */
function checkLedgerEntry(
  output: Output,
  row: LegacyImageRow,
  entry: LedgerEntry,
  reused: Map<string, Uint8Array>,
): string | null {
  if (
    entry.storyId !== row.storyId ||
    entry.nodeId !== row.nodeId ||
    entry.width !== row.width ||
    entry.height !== row.height
  ) {
    return 'ledger-entry-changed'
  }
  for (const variant of entry.variants) {
    const bytes = output.read(['media', entry.storyId, variantName(variant)])
    if (bytes === null) return 'ledger-file-missing'
    if (bytes.length !== variant.bytes || sha256(bytes) !== variant.sha256)
      return 'ledger-file-differs'
    // A reused variant passes the gates of a fresh one (S17-R1-SEC-2): one VP8 key frame and no
    // other chunk (webp-facts), the recorded size, and the master's aspect.
    const webp = readWebpFacts(bytes)
    if (
      !webp.ok ||
      webp.width !== variant.width ||
      webp.height !== variant.height ||
      variant.height !== Math.round((entry.height * variant.width) / entry.width)
    ) {
      return 'ledger-file-differs'
    }
    reused.set(variantPath(entry.storyId, variant), bytes)
  }
  return null
}

// ---- runBind ----

export interface BindOptions {
  readonly approvedMapSha256: string
  readonly packageVersion: number
  readonly dryRun: boolean
}

export interface BindDeps extends OutputDeps {
  readonly inputs: BindInputs
  /** Called once, and only when a master has no ledger entry. */
  readonly loadCodec: () => ImageCodec
  /** P2: migration-input/phase2 in the CLI. */
  readonly outputRoot: string
  readonly now: () => Date
  readonly log: (line: string) => void
  readonly error: (line: string) => void
}

/** A stop that is not a problem line (`bind: stopped: <code>`). */
class Stop extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

const problemLine = (p: BindProblem): string => `bind: problem ${[p.code, ...p.ids].join(' ')}`
const isKeep = (row: LegacyImageRow): boolean => row.action === 'keep'

/** The binder: checks, encodes, builds and writes (§3.3 phases 1-10); the exit code. */
export async function runBind(options: BindOptions, deps: BindDeps): Promise<number> {
  const report = (problems: readonly BindProblem[]): number => {
    for (const p of problems.slice(0, PROBLEM_LINES_MAX)) deps.error(problemLine(p))
    if (problems.length > PROBLEM_LINES_MAX)
      deps.error(`bind: problem ... and ${problems.length - PROBLEM_LINES_MAX} more`)
    return 1
  }
  try {
    const reader = openOutput(deps.outputRoot, deps, 'read')
    if (reader.staleParts > 0) deps.log(`bind: note stale-part files=${reader.staleParts}`)

    const date = deps.now().toISOString().slice(0, 10)
    const seen = await inspect(deps.inputs, options.approvedMapSha256, date)
    const { facts } = seen
    if (facts.counts !== null && facts.mapSha256 !== null) {
      const c = facts.counts
      deps.log(
        `bind: map sha256=${facts.mapSha256} rows=${c.rows} keep=${c.keep} recreate=${c.recreate} missing=${c.missing} new=${c.new} overrides=${facts.overrides}`,
      )
    }
    for (const a of facts.applied) {
      deps.log(
        `bind: correction applied ${a.storyId}/${a.nodeId}.${a.locale} ${a.field} before=${a.beforeSha256.slice(0, 12)} after=${a.afterSha256.slice(0, 12)}`,
      )
    }

    // Phase 5 (the ledger): reuse without encode; every recorded variant re-read.
    const problems = [...seen.problems]
    const keepRows = (seen.rows ?? []).filter(isKeep)
    const ledger = readLedger(reader)
    const reused = new Map<string, Uint8Array>()
    if (ledger === null) problems.push({ code: 'ledger-invalid', ids: [] })
    else {
      for (const row of keepRows) {
        const entry = ledger.get(row.fileSha256 ?? '')
        if (entry === undefined) continue
        const code = checkLedgerEntry(reader, row, entry, reused)
        if (code !== null) problems.push({ code, ids: [row.storyId, row.nodeId] })
      }
    }
    // Phase 6: nothing is encoded or written on a problem.
    if (problems.length > 0 || ledger === null || seen.rows === null) return report(problems)

    // Phase 7: encode the masters with no ledger entry.
    const fresh = new Map<string, LedgerEntry>()
    const encoded = new Map<string, Uint8Array>()
    const toEncode = keepRows.filter((row) => !ledger.has(row.fileSha256 ?? ''))
    if (toEncode.length > 0) {
      let codec: ImageCodec
      try {
        codec = deps.loadCodec()
      } catch {
        return report([{ code: 'encoder-unavailable', ids: [] }])
      }
      const versions = codec.versions
      if (
        versions.sharp !== EXPECTED_ENCODER.sharp ||
        versions.vips !== EXPECTED_ENCODER.vips ||
        versions.webp !== EXPECTED_ENCODER.webp
      ) {
        return report([{ code: 'encoder-version', ids: [] }])
      }
      const variantProblems: BindProblem[] = []
      for (const row of toEncode) {
        const masterSha256 = row.fileSha256 ?? ''
        if (fresh.has(masterSha256)) continue
        const master = seen.masters.get(masterSha256)
        const width = row.width ?? 0
        const height = row.height ?? 0
        if (master === undefined) throw new TypeError('a kept row without its master bytes')
        const variants: LedgerVariant[] = []
        let failed: string | null = null
        for (const asked of [NARROW_WIDTH, width]) {
          let bytes: Uint8Array
          try {
            bytes = await codec.encode(master, asked)
          } catch {
            return report([...variantProblems, { code: 'encoder-unavailable', ids: [] }])
          }
          if (bytes.length > MEDIA_MAX_BYTES) {
            failed = 'variant-too-large'
            break
          }
          const expectedHeight = Math.round((height * asked) / width)
          const webp = readWebpFacts(bytes)
          if (!webp.ok || webp.width !== asked || webp.height !== expectedHeight) {
            failed = 'variant-invalid'
            break
          }
          const variant: LedgerVariant = {
            token: `w${asked}`,
            width: asked,
            height: expectedHeight,
            sha256: sha256(bytes),
            bytes: bytes.length,
          }
          variants.push(variant)
          encoded.set(variantPath(row.storyId, variant), bytes)
        }
        if (failed !== null) {
          variantProblems.push({ code: failed, ids: [row.storyId, row.nodeId] })
          continue
        }
        fresh.set(masterSha256, {
          masterSha256,
          storyId: row.storyId,
          nodeId: row.nodeId,
          width,
          height,
          variants,
          encoder: {
            sharp: versions.sharp,
            vips: versions.vips,
            webp: versions.webp,
            settingsSha256: SETTINGS_SHA256,
          },
        })
      }
      if (variantProblems.length > 0) return report(variantProblems)
    }

    // Phase 8: the packages, the image log, the snapshot folders, the output list.
    const merged = new Map<string, LedgerEntry>([...ledger, ...fresh])
    const entryOf = (row: LegacyImageRow): LedgerEntry => {
      const entry = merged.get(row.fileSha256 ?? '')
      if (entry === undefined) throw new TypeError('a kept row without a ledger entry')
      return entry
    }
    interface Built {
      readonly storyId: string
      readonly bytes: Uint8Array
      readonly sha256: string
      readonly images: number
      readonly audio: number
      readonly withoutPicture: number
      readonly media: OutputTarget[]
    }
    const built: Built[] = []
    const buildProblems: BindProblem[] = []
    for (const pkg of seen.packages) {
      const kept = new Map(
        keepRows.filter((row) => row.storyId === pkg.storyId).map((row) => [row.nodeId, row]),
      )
      const media: OutputTarget[] = []
      const images: StoryAsset[] = []
      for (const node of pkg.nodes) {
        const row = kept.get(node.id)
        if (row === undefined) continue
        const entry = entryOf(row)
        for (const variant of entry.variants) {
          const path = variantPath(entry.storyId, variant)
          const bytes = encoded.get(path) ?? reused.get(path)
          if (bytes === undefined) throw new TypeError('a bound variant without its bytes')
          media.push({ segments: ['media', entry.storyId, variantName(variant)], bytes })
        }
        images.push({
          kind: 'image',
          id: row.fileSha256 ?? '',
          width: entry.width,
          height: entry.height,
          variants: entry.variants.map((v) => ({
            path: variantPath(entry.storyId, v),
            mime: 'image/webp' as const,
            bytes: v.bytes,
            width: v.width,
          })),
          provenance: { ...IMAGE_PROVENANCE, c2paInMaster: row.caBX === true },
        })
      }
      const audio: StoryAsset[] = []
      for (const node of pkg.nodes) {
        for (const locale of pkg.locales) {
          if (!isParlerLocale(locale)) continue
          const narration = seen.narrated.get(
            keyOf({ storyId: pkg.storyId, nodeId: node.id, locale }),
          )
          if (narration === undefined) throw new TypeError('a planned narration without its file')
          const name = `${narration.sha256}-${locale}.mp3`
          media.push({ segments: ['media', pkg.storyId, name], bytes: narration.bytes })
          audio.push({
            kind: 'audio',
            id: narration.sha256,
            nodeId: node.id,
            locale,
            durationMs: narration.durationMs,
            variants: [
              {
                path: `media/${pkg.storyId}/${name}`,
                mime: 'audio/mpeg',
                bytes: narration.bytes.length,
              },
            ],
            provenance: { ...AUDIO_PROVENANCE, voice: RECIPE_V2.voices[locale] },
            narratedTextSha256: narration.entry.narratedTextSha256,
          })
        }
      }
      const next = {
        ...pkg,
        version: options.packageVersion,
        nodes: pkg.nodes.map((node) => ({ ...node, image: kept.get(node.id)?.fileSha256 ?? null })),
        assets: [...images, ...audio],
      }
      const validation = validatePackage(next, { ruleSet: PANCHATANTRA_RULESET, mode: 'publish' })
      const blocking = new Set(
        validation.findings
          .filter((f) => f.severity === 'error' && BLOCKING_CHECKS.has(f.checkId))
          .map((f) => f.checkId),
      )
      for (const checkId of [...blocking].sort()) {
        buildProblems.push({ code: 'package-invalid', ids: [pkg.storyId, checkId] })
      }
      const bytes = jcsBytes(next)
      built.push({
        storyId: pkg.storyId,
        bytes,
        sha256: sha256(bytes),
        images: images.length,
        audio: audio.length,
        withoutPicture: next.nodes.filter((node) => node.image === null).length,
        media,
      })
    }
    if (buildProblems.length > 0) return report(buildProblems)
    // One entry per master: a master bound to a second node conflicts with its entry.
    const conflicts = keepRows
      .filter((row) => {
        const entry = entryOf(row)
        return entry.storyId !== row.storyId || entry.nodeId !== row.nodeId
      })
      .map((row) => ({ code: 'ledger-entry-changed', ids: [row.storyId, row.nodeId] }))
    if (conflicts.length > 0) return report(conflicts)

    const imageLog = jcsBytes({
      schema: 'image-log@1',
      images: [...keepRows]
        .sort((a, b) =>
          a.storyId !== b.storyId
            ? byStoryId(a, b)
            : a.nodeId < b.nodeId
              ? -1
              : a.nodeId > b.nodeId
                ? 1
                : 0,
        )
        .map((row) => {
          const entry = entryOf(row)
          return {
            storyId: row.storyId,
            nodeId: row.nodeId,
            masterSha256: entry.masterSha256,
            masterBytes: row.bytes,
            width: entry.width,
            height: entry.height,
            format: row.realFormat,
            legacyPath: row.legacyPath,
            c2paInMaster: row.caBX === true,
            variants: entry.variants,
            encoder: {
              ...entry.encoder,
              settings: entry.encoder.settingsSha256 === SETTINGS_SHA256 ? WEBP_SETTINGS : null,
            },
          }
        }),
    })
    const mediaLog = seen.mediaLog
    const history = seen.history
    if (mediaLog === null || history === null) throw new TypeError('the media log was not read')
    const folders = reader.list(['masters', 'media-log']) ?? []
    const folderFor = (bytes: Uint8Array): string | null => {
      const sha12 = sha256(bytes).slice(0, 12)
      const hits = folders.filter((name) => SNAPSHOT_FOLDER.exec(name)?.[2] === sha12)
      return hits.length > 1 ? null : (hits[0] ?? `${date}-${sha12}`)
    }
    const logFolder = folderFor(mediaLog)
    const imageLogFolder = folderFor(imageLog)
    if (logFolder === null || imageLogFolder === null) {
      return report([{ code: 'media-log-folder-invalid', ids: [] }])
    }
    // The snapshot folders as `masters` will read them (S17-R1-SEC-1, -FID-2): a reused folder's
    // date is a calendar date (the layout's own date rule). The image log needs no body gate here:
    // jcsBytes builds it (canonicalize refuses a lone surrogate), in a fixed shape, under the sha12
    // of its own bytes, so every masterBodyRule rule holds by construction (B17-fix1-2).
    if (
      snapshotTarget(logFolder, 'media-log.json') === null ||
      snapshotTarget(imageLogFolder, 'image-log.json') === null
    ) {
      return report([{ code: 'media-log-folder-invalid', ids: [] }])
    }

    const media = built.flatMap((b) => b.media)
    const masters: OutputTarget[] = [
      ...keepRows.map((row) => ({
        segments: ['masters', 'images', row.storyId, `${row.fileSha256 ?? ''}.png`],
        bytes: seen.masters.get(row.fileSha256 ?? '') ?? new Uint8Array(0),
      })),
      { segments: ['masters', 'media-log', logFolder, 'media-log.json'], bytes: mediaLog },
      { segments: ['masters', 'media-log', logFolder, 'media-log.history.jsonl'], bytes: history },
      { segments: ['masters', 'media-log', imageLogFolder, 'image-log.json'], bytes: imageLog },
    ]
    const webpNew = [...fresh.values()].reduce((n, e) => n + e.variants.length, 0)
    const webp = media.filter((t) => t.segments[2]!.endsWith('.webp'))
    const mp3 = media.length - webp.length
    const mediaBytes = media.reduce((n, t) => n + t.bytes.length, 0)

    // Phase 10: the lines.
    for (const b of built) {
      deps.log(
        `bind: story ${b.storyId} version=${options.packageVersion} package=${b.sha256} images=${b.images} audio=${b.audio} without-picture=${b.withoutPicture}`,
      )
    }
    deps.log(
      `bind: media webp new=${webpNew} reused=${webp.length - webpNew} mp3=${mp3} bytes=${mediaBytes}`,
    )
    deps.log(
      `bind: masters images=${keepRows.length} media-log=${logFolder} image-log=${imageLogFolder}`,
    )

    // Phase 9 (pre-check, also in a dry run): no orphan WebP; every create-only target absent or equal.
    const known = new Set(
      [...merged.values()].flatMap((entry) =>
        entry.variants.map((v) => variantPath(entry.storyId, v)),
      ),
    )
    for (const story of reader.list(['media']) ?? []) {
      const kind = reader.kind(['media', story])
      if (kind === 'link') throw new OutputError('output-not-directory')
      if (kind !== 'dir') continue
      for (const name of reader.list(['media', story]) ?? []) {
        if (name.endsWith('.webp') && !known.has(`media/${story}/${name}`))
          throw new Stop('ledger-orphan')
      }
    }
    reader.precheck([...media, ...masters])
    if (options.dryRun) {
      deps.log('bind: done dry-run (nothing written)')
      return 0
    }

    // Phase 9: the writes (media, masters, packages, the ledger last, then the report).
    const writer = openOutput(deps.outputRoot, deps, 'write')
    const created = writer.createAll([...media, ...masters])
    for (const b of built)
      writer.replace({ segments: ['packages', `${b.storyId}.json`], bytes: b.bytes })
    const ledgerEntries = [...merged.values()].sort((a, b) =>
      a.masterSha256 < b.masterSha256 ? -1 : a.masterSha256 > b.masterSha256 ? 1 : 0,
    )
    writer.replace({
      segments: [LEDGER_NAME],
      bytes: jcsBytes({ schema: 'binding-ledger@1', images: ledgerEntries }),
    })
    const counts = facts.counts
    const encoders = [
      ...new Set(keepRows.map((row) => JSON.stringify(entryOf(row).encoder))),
    ].sort()
    writer.replace({
      segments: ['bind-report.json'],
      bytes: jcsBytes({
        schema: 'bind-report@1',
        mapSha256: facts.mapSha256,
        counts: counts === null ? null : { ...counts, overrides: facts.overrides },
        corrections: facts.applied.map((a) => ({
          storyId: a.storyId,
          nodeId: a.nodeId,
          locale: a.locale,
          field: a.field,
          before: a.beforeSha256.slice(0, 12),
          after: a.afterSha256.slice(0, 12),
        })),
        stories: built.map((b) => ({
          storyId: b.storyId,
          version: options.packageVersion,
          packageSha256: b.sha256,
          images: b.images,
          audio: b.audio,
          withoutPicture: b.withoutPicture,
        })),
        media: { webpNew, webpReused: webp.length - webpNew, mp3, bytes: mediaBytes },
        masters: {
          imageMasters: keepRows.length,
          mediaLogFiles: 3,
          objects: masters.map((t) => t.segments.slice(1).join('/')),
        },
        encoders: encoders.map((text) => JSON.parse(text) as unknown),
      }),
    })
    deps.log(`bind: done wrote=${created.written + built.length + 2} skipped=${created.skipped}`)
    return 0
  } catch (thrown) {
    if (thrown instanceof OutputError || thrown instanceof Stop) {
      deps.error(`bind: stopped: ${thrown.code}`)
      return 1
    }
    deps.error('bind: stopped: internal')
    return 1
  }
}
