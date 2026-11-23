// pnpm migrate:waiver-keys (design p1-step8-design.md §2, §9 items 37, 38, 43, §10.1; P1-2b).
// Synthetic waiver files in a temp folder give exact JCS output and every refusal; no private field
// or value ever reaches the output or a message. The committed keys file is checked too: canonical,
// the 11 legacy stories of pt/, 41 keys that waive every legacy error through the build's matcher.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toJcs } from '../../src/core/hashing'
import { WaiverKeys } from '../../src/core/package/catalogue'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { applyWaiverKeys, validatePackage } from '../../src/core/validator'
import { convertLegacyStory } from './convert'
import { loadLegacyStories } from './load-legacy'
import { applyTextCorrections, loadTextCorrections } from './text-corrections'
import {
  buildLegacyWaiverKeys,
  LEGACY_WAIVER_KEYS_NOTE,
  LegacyWaiverKeysFile,
} from './waiver-keys-cli'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const here = dirname(fileURLToPath(import.meta.url))
const SHA_1 = '1'.repeat(64)
const SHA_2 = '2'.repeat(64)
const SHA_3 = '3'.repeat(64)
const PRIVATE_FIELDS = [
  'basis',
  'notes',
  'ruleId',
  'measured',
  'limit',
  'measuredOnPackageSha256',
  'recordedOn',
  'recordedBy',
]
/** A canary in every private value; it must never reach the output or a message. */
const CANARY = 'PRIVATE-CANARY'

const record = (over: Json = {}): Json => ({
  checkId: 'E014',
  ruleId: `${CANARY}-rule`,
  nodeId: 'ending_counsel',
  locale: 'en',
  severity: 'error',
  measured: `${CANARY} measured`,
  limit: `${CANARY} limit`,
  nodeTextSha256: SHA_1,
  ...over,
})

const waiverFile = (storyId: string, waivers: Json[], over: Json = {}): Json => ({
  storyId,
  ruleSetRef: 'panchatantra@3.0.0',
  basis: `${CANARY} basis`,
  measuredOnPackageSha256: SHA_3,
  waivers,
  notes: [`${CANARY} note`],
  recordedOn: '2026-11-13',
  recordedBy: `${CANARY} recorder`,
  ...over,
})

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'waiver-keys-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Writes <dir>/<storyId>.json (pretty, as validate-cli writes drafts) and returns its sha256. */
function put(storyId: string, content: Json | string): string {
  const text = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`
  writeFileSync(join(dir, `${storyId}.json`), text)
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
}

function refusal(storyIds: readonly string[]): string {
  try {
    buildLegacyWaiverKeys(dir, storyIds)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).not.toContain(CANARY)
    return message
  }
  throw new Error('expected a refusal')
}

describe('buildLegacyWaiverKeys (synthetic waiver files)', () => {
  it('writes exact JCS: stories by storyId, keys sorted, only the public fields', () => {
    const alpha = put(
      'alpha-story',
      waiverFile('alpha-story', [
        record({ checkId: 'E014', locale: 'hi', nodeTextSha256: SHA_2 }),
        record({ checkId: 'E005', nodeId: 'start', locale: 'en' }),
        record({ checkId: 'E010', nodeId: 'start', locale: null, ruleId: null }),
      ]),
    )
    const beta = put('beta-story', waiverFile('beta-story', []))
    const built = buildLegacyWaiverKeys(dir, ['beta-story', 'alpha-story'])
    const text = new TextDecoder().decode(built.bytes)
    expect(text).toBe(
      `{"note":"${LEGACY_WAIVER_KEYS_NOTE}","schemaVersion":"1.0","stories":[` +
        `{"storyId":"alpha-story","waivers":{"keys":[` +
        `{"checkId":"E005","locale":"en","nodeId":"start","nodeTextSha256":"${SHA_1}"},` +
        `{"checkId":"E010","locale":null,"nodeId":"start","nodeTextSha256":"${SHA_1}"},` +
        `{"checkId":"E014","locale":"hi","nodeId":"ending_counsel","nodeTextSha256":"${SHA_2}"}` +
        `],"ruleSetRef":"panchatantra@3.0.0","waiverFileSha256":"${alpha}"}},` +
        `{"storyId":"beta-story","waivers":{"keys":[],"ruleSetRef":"panchatantra@3.0.0","waiverFileSha256":"${beta}"}}` +
        `]}`,
    )
    expect(text).toBe(toJcs(built.value))
    expect(LegacyWaiverKeysFile.parse(JSON.parse(text))).toEqual(built.value)
    expect({
      stories: built.stories,
      keys: built.keys,
      storiesWithoutKeys: built.storiesWithoutKeys,
    }).toEqual({ stories: 2, keys: 3, storiesWithoutKeys: 1 })
  })

  it('puts no private field or value in the output', () => {
    put('alpha-story', waiverFile('alpha-story', [record(), record({ locale: 'hi' })]))
    const text = new TextDecoder().decode(buildLegacyWaiverKeys(dir, ['alpha-story']).bytes)
    expect(text).not.toContain(CANARY)
    for (const field of PRIVATE_FIELDS) expect(text).not.toContain(`"${field}"`)
    expect(text).not.toContain(SHA_3) // measuredOnPackageSha256
    expect(text).not.toContain('2026-11-13') // recordedOn
  })

  it('names the waiver file by the sha256 of its exact bytes', () => {
    const file = waiverFile('alpha-story', [record()])
    const pretty = put('alpha-story', file)
    const a = buildLegacyWaiverKeys(dir, ['alpha-story']).value.stories[0]?.waivers
    const compact = put('alpha-story', JSON.stringify(file))
    const b = buildLegacyWaiverKeys(dir, ['alpha-story']).value.stories[0]?.waivers
    expect(a?.waiverFileSha256).toBe(pretty)
    expect(b?.waiverFileSha256).toBe(compact)
    expect(pretty).not.toBe(compact)
    expect(a?.keys).toEqual(b?.keys)
  })

  it('refuses a missing story', () => {
    put('alpha-story', waiverFile('alpha-story', []))
    expect(refusal(['alpha-story', 'delta-story'])).toBe(
      'missing waiver file for story delta-story (waivers/delta-story.json)',
    )
  })

  it('refuses a waiver file recorded for another rule set, without printing its ref', () => {
    put('alpha-story', waiverFile('alpha-story', [], { ruleSetRef: `panchatantra@3.1.0` }))
    expect(refusal(['alpha-story'])).toBe(
      'waiver file for alpha-story was recorded for another rule set; this tool derives keys for panchatantra@3.0.0',
    )
  })

  it('refuses a duplicate key, even when the private fields differ', () => {
    put('alpha-story', waiverFile('alpha-story', [record(), record({ limit: 'other' })]))
    expect(refusal(['alpha-story'])).toBe(
      'waiver file for alpha-story has a duplicate key: E014 node=ending_counsel locale=en',
    )
  })

  it.each(['X000', 'S001', 'A001'])('refuses a record for %s', (checkId) => {
    put('alpha-story', waiverFile('alpha-story', [record(), record({ checkId })]))
    expect(refusal(['alpha-story'])).toBe(
      `waiver file for alpha-story has a record for ${checkId}, which is never waivable (X000, S001, A001)`,
    )
  })

  it('refuses invalid JSON without quoting it', () => {
    put('alpha-story', `{"basis": "${CANARY}", oops}`)
    expect(refusal(['alpha-story'])).toBe('waiver file for alpha-story is not valid JSON')
  })

  it('refuses a file that fails strict parse, naming only the path and the issue code', () => {
    put('alpha-story', waiverFile('alpha-story', [record({ severity: CANARY })]))
    expect(refusal(['alpha-story'])).toBe(
      'waiver file for alpha-story failed strict parse at waivers.0.severity (invalid_value)',
    )
    put('alpha-story', { ...waiverFile('alpha-story', []), extra: CANARY })
    expect(refusal(['alpha-story'])).toBe(
      'waiver file for alpha-story failed strict parse at (root) (unrecognized_keys)',
    )
  })

  it('refuses a file that names another story', () => {
    put('alpha-story', waiverFile('beta-story', []))
    expect(refusal(['alpha-story'])).toBe('waiver file for alpha-story names story beta-story')
  })

  it('refuses keys that fail the snapshot schema (a checkId outside [A-Z]NNN)', () => {
    put('alpha-story', waiverFile('alpha-story', [record({ checkId: 'e014' })]))
    expect(refusal(['alpha-story'])).toBe(
      'waiver keys for alpha-story fail the snapshot schema at keys.0.checkId',
    )
  })

  it('refuses a bad or repeated story id, and a folder in place of a file', () => {
    expect(refusal(['../escape'])).toBe('invalid story id at position 0')
    put('alpha-story', waiverFile('alpha-story', []))
    expect(refusal(['alpha-story', 'alpha-story'])).toBe('story alpha-story is listed twice')
    mkdirSync(join(dir, 'gamma-story.json'))
    expect(refusal(['gamma-story'])).toBe(
      'missing waiver file for story gamma-story (waivers/gamma-story.json)',
    )
  })
})

describe('the committed tools/migrate/legacy-waiver-keys.json', () => {
  const text = readFileSync(join(here, 'legacy-waiver-keys.json'), 'utf8')
  const file = LegacyWaiverKeysFile.parse(JSON.parse(text))
  const legacy = loadLegacyStories(join(resolve(here, '../../..'), 'pt/src/stories'))

  it('is canonical JCS with the fixed note and no private field', () => {
    expect(text).toBe(toJcs(file))
    expect(file.note).toBe(
      'Derived match keys of the legacy waivers (P1 D9); written by pnpm migrate:waiver-keys; the build never reads this file',
    )
    for (const field of PRIVATE_FIELDS) expect(text).not.toContain(`"${field}"`)
  })

  it('holds the 11 legacy stories of pt/, by storyId, 41 keys, two of them with none', () => {
    expect(file.stories.map((s) => s.storyId)).toEqual(legacy.map((l) => l.story.id).sort())
    expect(file.stories).toHaveLength(11)
    expect(file.stories.reduce((n, s) => n + s.waivers.keys.length, 0)).toBe(41)
    expect(file.stories.filter((s) => s.waivers.keys.length === 0).map((s) => s.storyId)).toEqual([
      'jackal-and-war-drum',
      'one-pot-of-seeds',
    ])
    for (const s of file.stories) {
      expect(s.waivers.ruleSetRef).toBe(PANCHATANTRA_RULESET.ref)
      expect(WaiverKeys.safeParse(s.waivers).success).toBe(true)
    }
  })

  it('waives every error of the re-converted legacy stories through the build matcher', async () => {
    const byId = new Map(file.stories.map((s) => [s.storyId, s.waivers.keys]))
    // P1 Step 17 (p1-step17-design.md D17-15, D17-16, L17-1): T006 is an error in publish mode, so the
    // stories are checked after the committed text correction, as Proof A builds them; the raw
    // crow-and-serpent keeps exactly one unwaived error, the T006 the correction removes.
    const converted = legacy.map(({ story }) => convertLegacyStory(story))
    const records = loadTextCorrections()
    if (!records.ok) throw new Error(`tools/migrate/text-corrections.json: ${records.code}`)
    const corrected = applyTextCorrections(converted, records.records)
    if (!corrected.ok)
      throw new Error(`text-corrections.json: ${corrected.code} ${corrected.storyId}`)
    const rawCrow = converted.find((pkg) => pkg.storyId === 'crow-and-serpent')
    if (!rawCrow) throw new Error('crow-and-serpent is missing')
    const rawReport = validatePackage(rawCrow, { ruleSet: PANCHATANTRA_RULESET, mode: 'publish' })
    const rawApplied = await applyWaiverKeys(rawReport, rawCrow, byId.get(rawCrow.storyId) ?? [])
    expect
      .soft(
        rawApplied.report.findings
          .filter((f) => f.severity === 'error' && f.waived !== true)
          .map((f) => [f.checkId, f.nodeId, f.locale]),
        'the raw crow-and-serpent: its only unwaived error is T006 at seek_advice hi',
      )
      .toEqual([['T006', 'seek_advice', 'hi']])
    let waived = 0
    let unused = 0
    let lapsed = 0
    for (const pkg of corrected.packages) {
      const report = validatePackage(pkg, { ruleSet: PANCHATANTRA_RULESET, mode: 'publish' })
      const applied = await applyWaiverKeys(report, pkg, byId.get(pkg.storyId) ?? [])
      expect(applied.report.ok, pkg.storyId).toBe(true)
      waived += applied.report.findings.filter((f) => f.waived).length
      unused += applied.unused.length
      lapsed += applied.lapsed.length
    }
    expect({ waived, unused, lapsed }).toEqual({ waived: 41, unused: 0, lapsed: 0 })
  })
})
