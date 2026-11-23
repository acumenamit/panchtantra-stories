// P1-9a (Step 17) the binder's checks on the owner's real inputs (design
// migration-input/p1-step17-design.md §3.3, §8, D17-34, A15, A16, A43, TP17-12; test plan 14.9:
// T17-29). This PC only: migration-input is git-ignored, so where the approved image map is absent
// the file logs one skip line and runs nothing. It calls checkInputs(realInputs()) only (phases 1-6:
// no codec, no writer, nothing written into migration-input) and prints counts, keys and hashes
// only. The private media log is read in this file only through logFacts, a projection to eight
// public keys (CRIT-13; bind.test.ts T17-28 checks this file's source).
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildEntriesFor, parseSeedOverrides } from '../narration/parler-pipeline'
import { MAX_JSON_BYTES, MEDIA_LOG_MAX_BYTES } from '../publisher/storage-layout'
import { parseHashList } from '../publisher/takedown'
import { checkInputs } from './bind'
import { realInputs } from './bind-cli'
import { convertLegacyStory } from './convert'
import { applyTextCorrections, loadTextCorrections } from './text-corrections'

const MI = fileURLToPath(new URL('../../migration-input/', import.meta.url))
const PRESENT = existsSync(join(MI, 'p1-step17-image-map.json'))
if (!PRESENT) {
  console.log(
    "skipped: the approved image map and the private media are on the owner's PC only (MI is git-ignored)",
  )
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** One media-log record reduced to its public facts. */
interface LogFact {
  readonly storyId: string
  readonly nodeId: string
  readonly locale: string
  readonly sha256: string
  readonly bytes: number
  readonly durationMs: number
  readonly narratedTextSha256: string
  readonly listenPending: boolean
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true })

/** media-log.json's bytes to the eight public facts of each record (the one parse of the log). */
function logFacts(bytes: Uint8Array): LogFact[] {
  const records = JSON.parse(STRICT_UTF8.decode(bytes)) as Record<string, unknown>[]
  return records.map((r) => ({
    storyId: String(r.storyId),
    nodeId: String(r.nodeId),
    locale: String(r.locale),
    sha256: String(r.sha256),
    bytes: Number(r.bytes),
    durationMs: Number(r.durationMs),
    narratedTextSha256: String(r.narratedTextSha256),
    listenPending: Object.hasOwn(r, 'listenPending'),
  }))
}

const key = (f: { storyId: string; nodeId: string; locale: string }) =>
  `${f.storyId}/${f.nodeId}.${f.locale}`
const CROW_KEY = 'crow-and-serpent/seek_advice.hi'
const PHASE_1_TO_3 = new Set([
  'map-sha256-mismatch',
  'map-invalid',
  'map-rows',
  'map-row-stale',
  'image-map-overrides-invalid',
  'master-read',
  'legacy-format-unknown',
  'phase1-set',
  'phase1-invalid',
  'phase1-drift',
  'correction-file',
  'correction-duplicate',
  'correction-target-missing',
  'correction-before-mismatch',
  'correction-after-invalid',
])

describe.skipIf(!PRESENT)('the binder on the real inputs (T17-29, this PC only)', () => {
  it(
    "T17-29 the real inputs pass the binder's checks: the map re-derives, the 11 phase-1 files equal the re-conversion, the correction applies, and the narration problems are exactly those the current state implies (A15, A16, TP17-12)",
    { timeout: 120_000 },
    async () => {
      const inputs = realInputs()
      const map = inputs.map(MAX_JSON_BYTES)
      expect(map.ok, 'precondition: the approved map reads').toBe(true)
      const flag = map.ok ? sha(map.bytes) : ''
      const listRead = inputs.hashList(MAX_JSON_BYTES)
      const list = listRead.ok ? parseHashList(listRead.bytes) : null
      expect(
        list?.ok ? list.lines.length : -1,
        'precondition: SHA256SUMS.txt holds 190 lines',
      ).toBe(190)

      const { problems, facts } = await checkInputs(inputs, flag)
      const lines = problems.map((p) => [p.code, ...p.ids].join(' '))

      // g1: the map.
      const k = facts.overrides
      expect
        .soft(facts.counts, '(g1) 95 rows; keep 54 - k, recreate 8 + k, missing 32, new 1')
        .toEqual({ rows: 95, keep: 54 - k, recreate: 8 + k, missing: 32, new: 1 })

      // g2: phases 1-3.
      expect
        .soft(
          lines.filter((l) => PHASE_1_TO_3.has(l.split(' ')[0] ?? '')),
          '(g2) no problem in phases 1-3',
        )
        .toEqual([])
      expect
        .soft(
          facts.applied.map(
            (a) =>
              `${a.storyId}/${a.nodeId}.${a.locale} ${a.field} before=${a.beforeSha256.slice(0, 12)} after=${a.afterSha256.slice(0, 12)}`,
          ),
          '(g2) the one correction applied',
        )
        .toEqual([`${CROW_KEY} text before=46fbd0f668c9 after=770f97aa7934`])

      // g3: narration, by the current state.
      const log = inputs.mediaLog(MEDIA_LOG_MAX_BYTES)
      const factsOfLog = log.ok ? logFacts(log.bytes) : []
      const logKeys = factsOfLog.map(key).sort()
      const listKeys = list?.ok
        ? list.lines.map((l) => `${l.storyId}/${l.file.slice(0, -'.mp3'.length)}`).sort()
        : []
      const planKeys = (facts.narration?.planned ?? []).map((p) => p.key).sort()
      expect.soft(new Set(logKeys).size, '(g3) 190 distinct keys in the log').toBe(190)
      expect.soft(logKeys, "(g3) the log's keys equal the list's").toEqual(listKeys)
      expect.soft(logKeys, "(g3) the log's keys equal the plan's").toEqual(planKeys)
      const crow = factsOfLog.find((f) => key(f) === CROW_KEY)
      // The corrected crow entry, made here and not taken from the binder's facts: the frozen
      // legacy load, the re-conversion, the committed record and crow's saved remake seeds.
      const record = loadTextCorrections()
      const corrected = record.ok
        ? applyTextCorrections(
            inputs.legacyStories().map((story) => convertLegacyStory(story)),
            record.records,
          )
        : null
      const savedRead = inputs.seedOverrides(65_536)
      const saved = savedRead.ok ? parseSeedOverrides(savedRead.bytes) : {}
      const crowSaved = Object.fromEntries(
        Object.entries(saved).filter(([k]) => k.startsWith('crow-and-serpent/')),
      )
      const crowPackage = corrected?.ok
        ? corrected.packages.filter((p) => p.storyId === 'crow-and-serpent')
        : []
      const planned = (await buildEntriesFor(crowPackage, crowSaved)).find(
        (e) => key(e) === CROW_KEY,
      )
      const expected =
        crow === undefined || planned === undefined
          ? ['no crow record or plan entry']
          : crow.narratedTextSha256 !== planned.narratedTextSha256
            ? ['narration-stale crow-and-serpent seek_advice hi']
            : crow.listenPending
              ? ['narration-listen-pending crow-and-serpent seek_advice hi']
              : []
      expect.soft(lines, '(g3) the problems equal the state').toEqual(expected)
      expect
        .soft(facts.narration?.passed, '(g3) every other record passes')
        .toBe(190 - expected.length)
    },
  )
})
