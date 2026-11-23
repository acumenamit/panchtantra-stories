// T17-1 to T17-3 (design migration-input/p1-step17-design.md §14.2, §3.15, D17-15, D17-31; P1
// Step 17): the recorded text corrections. T17-1 the strict loader, T17-2 applyTextCorrections'
// rules 1-5, T17-3 the CI proof that the committed record is the owner's correction of the one
// string in pt/ (DEC:31, :33). No pt/ story text is copied here: T17-3 builds the span and its
// replacement from code points and pins hashes and lengths only; T17-2 uses the fixtures.
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../fixtures/packages/lantern-walk.json'
import twoPaths from '../../fixtures/packages/two-paths.json'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { scriptProblem, textHygiene } from '../../src/core/validator/text'
import { validatePackage } from '../../src/core/validator/validate'
import type { LocalFileCode, LocalRead } from '../publisher/local-files'
import { convertLegacyStory } from './convert'
import { loadLegacyStories } from './load-legacy'
import {
  applyTextCorrections,
  loadTextCorrections,
  parseTextCorrections,
  replaceSpanOnce,
  type TextCorrection,
} from './text-corrections'

const STORYBOARD = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PT_STORIES = join(STORYBOARD, '..', 'pt', 'src', 'stories')
const BEFORE_PIN = '46fbd0f668c9a4e81cb4cb1e839155a65b1e323557bc8da3a758c87f7ca83bb0'
const AFTER_PIN = '770f97aa79342686285bfc51fb4cbdebda7fd7bbb8e87df1bd9cffe280bbba32'
/** "उसकी" + U+7425 U+73C0 + "रंगी", from code points (DEC:33). */
const SPAN = String.fromCodePoint(
  0x0909,
  0x0938,
  0x0915,
  0x0940,
  0x7425,
  0x73c0,
  0x0930,
  0x0902,
  0x0917,
  0x0940,
)
/** "उसकी नारंगी": U+7425 U+73C0 become a space plus "ना" (DEC:33). */
const REPLACEMENT = String.fromCodePoint(
  0x0909,
  0x0938,
  0x0915,
  0x0940,
  0x0020,
  0x0928,
  0x093e,
  0x0930,
  0x0902,
  0x0917,
  0x0940,
)
/** "नन्ही", the synthetic replacement word of T17-2 (from code points). */
const NEW_WORD = String.fromCodePoint(0x0928, 0x0928, 0x094d, 0x0939, 0x0940)

const encoder = new TextEncoder()
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const REFUSED = { ok: false, code: 'correction-file' }

// ---- T17-1 helpers ----

const RECORD = {
  storyId: 'two-paths',
  locale: 'hi',
  nodeId: 'start',
  field: 'text',
  beforeSha256: 'a'.repeat(64),
  after: 'x',
  approvedOn: '2026-11-15',
  approvedBy: 'owner',
}
const fileOf = (value: unknown) => encoder.encode(JSON.stringify(value))
const withRecords = (corrections: unknown[]) => fileOf({ corrections })
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
/** The one-record file with `raw` bytes in the middle of `after`. */
const withRawInAfter = (raw: number[]) => {
  const [head = '', tail = ''] = JSON.stringify({
    corrections: [{ ...RECORD, after: 'xS17MARKy' }],
  }).split('S17MARK')
  return concat(encoder.encode(head), new Uint8Array(raw), encoder.encode(tail))
}
/** The one-record file padded with spaces after the JSON to exactly `size` bytes. */
const paddedTo = (size: number) => {
  const text = JSON.stringify({ corrections: [RECORD] })
  return encoder.encode(text + ' '.repeat(size - encoder.encode(text).length))
}

// ---- T17-2 helpers ----

/** The world: lantern-walk then two-paths (array order equals storyId order). */
const world = (): StoryPackageV1[] => [
  StoryPackageV1.parse(structuredClone(lanternWalk)),
  StoryPackageV1.parse(structuredClone(twoPaths)),
]
const textOf = (p: StoryPackageV1 | undefined, locale: 'en' | 'hi', nodeId: string) =>
  p?.text[locale]?.nodes[nodeId]
const twoPathsOf = (packages: readonly StoryPackageV1[]) =>
  packages.find((p) => p.storyId === 'two-paths')
const HI_START = textOf(StoryPackageV1.parse(structuredClone(twoPaths)), 'hi', 'start')?.text ?? ''
const HI_AFTER = HI_START.split(' ')
  .map((word, i) => (i === 1 ? NEW_WORD : word))
  .join(' ')
const record = (over: Partial<TextCorrection> = {}): TextCorrection => ({
  storyId: 'two-paths',
  locale: 'hi',
  nodeId: 'start',
  field: 'text',
  beforeSha256: sha(HI_START),
  after: HI_AFTER,
  approvedOn: '2026-11-15',
  approvedBy: 'owner',
  ...over,
})
const failure = (
  code: string,
  where: Partial<{ storyId: string; nodeId: string; locale: string; field: string }> = {},
) => ({
  ok: false,
  code,
  storyId: 'two-paths',
  nodeId: 'start',
  locale: 'hi',
  field: 'text',
  ...where,
})

// ---- T17-3 helpers ----

const LOCALES = ['en', 'hi'] as const

/** Every text string of a package by a path: story fields, node text, question, lesson, choices. */
function stringsOf(p: StoryPackageV1): Map<string, string> {
  const out = new Map<string, string>()
  for (const l of LOCALES) {
    const t = p.text[l]
    if (!t) continue
    for (const f of ['title', 'description', 'theme', 'duration', 'book'] as const)
      out.set(`${p.storyId}/${l}/${f}`, t[f])
    for (const [id, nt] of Object.entries(t.nodes)) {
      out.set(`${p.storyId}/${l}/${id}/text`, nt.text)
      if (nt.question !== undefined) out.set(`${p.storyId}/${l}/${id}/question`, nt.question)
      if (nt.lesson !== undefined) out.set(`${p.storyId}/${l}/${id}/lesson`, nt.lesson)
      for (const [cid, c] of Object.entries(nt.choices ?? {}))
        out.set(`${p.storyId}/${l}/${id}/choices/${cid}`, c)
    }
  }
  return out
}

function differingStrings(
  a: readonly StoryPackageV1[],
  b: readonly StoryPackageV1[],
): readonly string[] {
  const left = new Map(a.flatMap((p) => [...stringsOf(p)]))
  const right = new Map(b.flatMap((p) => [...stringsOf(p)]))
  const paths = new Set([...left.keys(), ...right.keys()])
  return [...paths].filter((path) => left.get(path) !== right.get(path))
}

const t006Count = (packages: readonly StoryPackageV1[]) =>
  packages.flatMap((pkg) =>
    validatePackage(pkg, { ruleSet: PANCHATANTRA_RULESET, mode: 'publish' }).findings.filter(
      (f) => f.checkId === 'T006',
    ),
  ).length

describe('the recorded text corrections (P1 Step 17)', () => {
  it('T17-1 parseTextCorrections and loadTextCorrections: strict bytes and schema; every refusal is correction-file and carries no value (A3, CRIT-9, CRIT-15, TP17-1)', () => {
    const one = parseTextCorrections(withRecords([RECORD]))
    expect(one.ok && one.records.length, 'precondition: a one-record file parses').toBe(1)
    const none = parseTextCorrections(withRecords([]))
    expect(none.ok && none.records.length, 'precondition: an empty list parses').toBe(0)

    // g1 bytes
    const bytes: [string, Uint8Array][] = [
      ['a UTF-8 BOM', concat(new Uint8Array([0xef, 0xbb, 0xbf]), withRecords([RECORD]))],
      ['C3 28 in after', withRawInAfter([0xc3, 0x28])],
      ['ED A0 80 (an encoded surrogate) in after', withRawInAfter([0xed, 0xa0, 0x80])],
      [
        'the JSON escape backslash-u-d800 (a lone surrogate) in after',
        withRawInAfter([...encoder.encode(String.raw`\ud800`)]),
      ],
      ['truncated JSON', withRecords([RECORD]).slice(0, -5)],
      ['[]', encoder.encode('[]')],
      ['null', encoder.encode('null')],
      ['0 bytes', new Uint8Array(0)],
    ]
    for (const [sample, b] of bytes)
      expect
        .soft(parseTextCorrections(b), `(g1) bytes → correction-file: ${sample}`)
        .toStrictEqual(REFUSED)

    // g2 size and reader
    const exact = parseTextCorrections(paddedTo(65_536))
    expect.soft(exact.ok, '(g2) a file of exactly 65,536 bytes parses').toBe(true)
    expect
      .soft(parseTextCorrections(paddedTo(65_537)), '(g2) 65,537 bytes → correction-file')
      .toStrictEqual(REFUSED)
    const calls: [string, readonly string[], number][] = []
    const recording = (root: string, segments: readonly string[], cap: number): LocalRead => {
      calls.push([root, [...segments], cap])
      return { ok: true, bytes: new Uint8Array(withRecords([RECORD])) }
    }
    const read = loadTextCorrections(recording)
    expect.soft(read.ok && read.records.length, '(g2) the reader’s bytes parse').toBe(1)
    expect
      .soft(
        calls,
        '(g2) one read: the storyboard root, tools/migrate/text-corrections.json, cap 65,536',
      )
      .toEqual([[STORYBOARD, ['tools', 'migrate', 'text-corrections.json'], 65_536]])
    const codes: LocalFileCode[] = [
      'local-file-path',
      'local-file-missing',
      'local-file-not-regular',
      'local-file-too-large',
      'local-file-changed',
    ]
    for (const code of codes)
      expect
        .soft(
          loadTextCorrections(() => ({ ok: false, code })),
          `(g2) a reader answering ${code} → correction-file`,
        )
        .toStrictEqual(REFUSED)

    // g3 schema
    const schema: [string, Uint8Array][] = [
      ['an unknown key in the file', fileOf({ corrections: [RECORD], extra: 1 })],
      ['an unknown key in a record', withRecords([{ ...RECORD, extra: 1 }])],
      [
        'an own __proto__ key in the file',
        encoder.encode(`{"__proto__":{},"corrections":${JSON.stringify([RECORD])}}`),
      ],
      [
        'an own __proto__ key in a record',
        encoder.encode(`{"corrections":[{"__proto__":{},${JSON.stringify(RECORD).slice(1)}]}`),
      ],
      ['storyId Crow', withRecords([{ ...RECORD, storyId: 'Crow' }])],
      ['storyId ab', withRecords([{ ...RECORD, storyId: 'ab' }])],
      ['locale xx', withRecords([{ ...RECORD, locale: 'xx' }])],
      ['locale EN', withRecords([{ ...RECORD, locale: 'EN' }])],
      ['nodeId Seek', withRecords([{ ...RECORD, nodeId: 'Seek' }])],
      ['field choices', withRecords([{ ...RECORD, field: 'choices' }])],
      ['field title', withRecords([{ ...RECORD, field: 'title' }])],
      ['field Text', withRecords([{ ...RECORD, field: 'Text' }])],
      ['beforeSha256 upper case', withRecords([{ ...RECORD, beforeSha256: 'A'.repeat(64) }])],
      ['beforeSha256 63 hex', withRecords([{ ...RECORD, beforeSha256: 'a'.repeat(63) }])],
      ['beforeSha256 65 hex', withRecords([{ ...RECORD, beforeSha256: 'a'.repeat(65) }])],
      ["after ''", withRecords([{ ...RECORD, after: '' }])],
      ['after 4,097 units', withRecords([{ ...RECORD, after: 'x'.repeat(4097) }])],
      ['approvedOn 2026-11-15-', withRecords([{ ...RECORD, approvedOn: '2026-11-15-' }])],
      ['approvedOn " 2026-11-15"', withRecords([{ ...RECORD, approvedOn: ' 2026-11-15' }])],
      ['approvedOn 2026-02-30', withRecords([{ ...RECORD, approvedOn: '2026-02-30' }])],
      ['approvedOn 2026-11-15T00:00', withRecords([{ ...RECORD, approvedOn: '2026-11-15T00:00' }])],
      ['approvedOn 2026-1-15', withRecords([{ ...RECORD, approvedOn: '2026-1-15' }])],
      ['approvedOn the number 20261115', withRecords([{ ...RECORD, approvedOn: 20261115 }])],
      ['approvedBy Owner', withRecords([{ ...RECORD, approvedBy: 'Owner' }])],
      ['approvedBy lead', withRecords([{ ...RECORD, approvedBy: 'lead' }])],
      ['65 records', withRecords(Array.from({ length: 65 }, () => RECORD))],
    ]
    for (const [sample, b] of schema)
      expect
        .soft(parseTextCorrections(b), `(g3) schema → correction-file: ${sample}`)
        .toStrictEqual(REFUSED)
    const passing: [string, Uint8Array][] = [
      ['after 4,096 units', withRecords([{ ...RECORD, after: 'x'.repeat(4096) }])],
      ['64 records', withRecords(Array.from({ length: 64 }, () => RECORD))],
    ]
    for (const [sample, b] of passing)
      expect.soft(parseTextCorrections(b).ok, `(g3) passes: ${sample}`).toBe(true)

    // g4 no value: every refusal above is exactly {ok: false, code: 'correction-file'}.
    const refusals = [...bytes, ...schema].map(([, b]) => parseTextCorrections(b))
    expect
      .soft(
        refusals.every((r) => JSON.stringify(r) === JSON.stringify(REFUSED)),
        '(g4) every refusal is exactly {ok: false, code: correction-file}',
      )
      .toBe(true)
  })

  it('T17-2 applyTextCorrections: rules 1-5 in record order, the first failure wins and nothing is applied, a deep copy; the empty set applies nothing (A4)', () => {
    const base = world()
    const tp = twoPathsOf(base)
    expect(
      base.map((p) => p.storyId),
      'precondition: both clones parse',
    ).toEqual(['lantern-walk', 'two-paths'])
    expect(textOf(tp, 'hi', 'start')?.text, 'precondition: two-paths hi start text').toBeTruthy()
    expect(
      textOf(tp, 'hi', 'start')?.question,
      'precondition: two-paths hi start question',
    ).toBeTruthy()
    expect(textOf(tp, 'en', 'start')?.text, 'precondition: two-paths en start text').toBeTruthy()
    expect(
      textOf(base[0], 'en', 'start')?.lesson,
      'precondition: lantern-walk start has no lesson',
    ).toBeUndefined()
    expect(
      HI_AFTER !== HI_START && HI_AFTER.includes(NEW_WORD),
      'precondition: R changes one word',
    ).toBe(true)

    // g1 rule 5
    const applied = applyTextCorrections(world(), [record()])
    expect
      .soft(
        applied.ok && textOf(twoPathsOf(applied.packages), 'hi', 'start')?.text,
        '(g1) R applies',
      )
      .toBe(HI_AFTER)
    expect.soft(applied.ok && applied.applied, '(g1) applied reports R').toStrictEqual([
      {
        storyId: 'two-paths',
        locale: 'hi',
        nodeId: 'start',
        field: 'text',
        beforeSha256: sha(HI_START),
        afterSha256: sha(HI_AFTER),
      },
    ])

    // g2 rule 1
    const enStart = textOf(tp, 'en', 'start')?.text ?? ''
    const hiQuestion = textOf(tp, 'hi', 'start')?.question ?? ''
    const sameKey: [string, TextCorrection[]][] = [
      ['equal after', [record(), record()]],
      ['different after', [record(), record({ after: `${HI_AFTER} ${NEW_WORD}।` })]],
    ]
    for (const [sample, records] of sameKey)
      expect
        .soft(applyTextCorrections(world(), records), `(g2) correction-duplicate: ${sample}`)
        .toStrictEqual(failure('correction-duplicate'))
    const notDuplicates: [string, TextCorrection[]][] = [
      [
        'another field',
        [
          record(),
          record({
            field: 'question',
            beforeSha256: sha(hiQuestion),
            after: `${NEW_WORD} ${hiQuestion}`,
          }),
        ],
      ],
      [
        'another locale',
        [
          record(),
          record({ locale: 'en', beforeSha256: sha(enStart), after: `${enStart} Again.` }),
        ],
      ],
    ]
    for (const [sample, records] of notDuplicates) {
      const r = applyTextCorrections(world(), records)
      expect.soft(r.ok && r.applied.length, `(g2) not a duplicate: ${sample}`).toBe(2)
    }

    // g3 rule 2
    const enOnly = world()
    const enOnlyTp = twoPathsOf(enOnly)
    if (enOnlyTp) enOnlyTp.locales = ['en']
    const enOnlyNoHi = world()
    const noHiTp = twoPathsOf(enOnlyNoHi)
    if (noHiTp) {
      noHiTp.locales = ['en']
      delete noHiTp.text.hi
    }
    const targets: [string, StoryPackageV1[], TextCorrection, object][] = [
      ['a story absent', world(), record({ storyId: 'river-stones' }), { storyId: 'river-stones' }],
      ["hi on a clone whose locales are ['en']", enOnly, record(), {}],
      ["hi on a clone with locales ['en'] and no hi text", enOnlyNoHi, record(), {}],
      ['a node absent', world(), record({ nodeId: 'nowhere' }), { nodeId: 'nowhere' }],
      ['nodeId constructor', world(), record({ nodeId: 'constructor' }), { nodeId: 'constructor' }],
      ['nodeId toString', world(), record({ nodeId: 'toString' }), { nodeId: 'toString' }],
      [
        'question where absent (an ending)',
        world(),
        record({ nodeId: 'ending_wise', field: 'question' }),
        { nodeId: 'ending_wise', field: 'question' },
      ],
      ['lesson on a non-ending node', world(), record({ field: 'lesson' }), { field: 'lesson' }],
    ]
    for (const [sample, packages, r, where] of targets)
      expect
        .soft(applyTextCorrections(packages, [r]), `(g3) correction-target-missing: ${sample}`)
        .toStrictEqual(failure('correction-target-missing', where))

    // g4 rule 3
    const accented = world()
    const accentedEn = textOf(twoPathsOf(accented), 'en', 'start')
    if (accentedEn) accentedEn.text = 'A young fox stands where the café path splits in two.'
    const accentedText = accentedEn?.text ?? ''
    expect(
      accentedText.normalize('NFD') !== accentedText,
      'precondition: the en sample holds é, so its NFD form differs',
    ).toBe(true)
    const once = applyTextCorrections(world(), [record()])
    const mismatches: [string, StoryPackageV1[], TextCorrection, object][] = [
      ['another string', world(), record({ beforeSha256: sha('another string') }), {}],
      [
        "the text's NFD form",
        accented,
        record({
          locale: 'en',
          beforeSha256: sha(accentedText.normalize('NFD')),
          after: `${accentedText} Again.`,
        }),
        { locale: 'en' },
      ],
      [
        'its UTF-16LE bytes',
        world(),
        record({
          beforeSha256: createHash('sha256').update(Buffer.from(HI_START, 'utf16le')).digest('hex'),
        }),
        {},
      ],
      ['the text plus LF', world(), record({ beforeSha256: sha(`${HI_START}\n`) }), {}],
      ['applied twice', once.ok ? once.packages : [], record(), {}],
      [
        "field question with the text's hash",
        world(),
        record({ field: 'question' }),
        { field: 'question' },
      ],
      ["locale en with the hi text's hash", world(), record({ locale: 'en' }), { locale: 'en' }],
    ]
    for (const [sample, packages, r, where] of mismatches)
      expect
        .soft(applyTextCorrections(packages, [r]), `(g4) correction-before-mismatch: ${sample}`)
        .toStrictEqual(failure('correction-before-mismatch', where))

    // g5 rule 4
    const afters: [string, string][] = [
      ['a lone high surrogate', '\ud800'],
      ['a lone low surrogate', '\udc00'],
      ['the NFD form of an NFC after', 'Café path'.normalize('NFD')],
      ['U+0007', `${NEW_WORD}\u0007${NEW_WORD}`],
      ['U+0085', `${NEW_WORD}\u0085${NEW_WORD}`],
      ['U+202E', `${NEW_WORD}‮${NEW_WORD}`],
      ['a leading space', ` ${HI_AFTER}`],
      ['a trailing space', `${HI_AFTER} `],
      ['*a', `*${NEW_WORD}`],
      ['<b>x</b>', '<b>x</b>'],
      ['https://x', 'https://x'],
      ['a CJK letter', `${NEW_WORD}琥`],
      ['after equal to the current text', HI_START],
    ]
    for (const [sample, after] of afters)
      expect
        .soft(
          applyTextCorrections(world(), [record({ after })]),
          `(g5) correction-after-invalid: ${sample}`,
        )
        .toStrictEqual(failure('correction-after-invalid'))
    const nbsp = applyTextCorrections(world(), [record({ after: HI_AFTER.replace(' ', ' ') })])
    expect
      .soft(nbsp.ok, '(g5) an after holding U+00A0 passes (no hygiene rule names it)')
      .toBe(true)

    // g6 order and atomicity
    const inputs = world()
    const snapshot = structuredClone(inputs)
    const bad = record({
      locale: 'en',
      beforeSha256: sha('another string'),
      after: `${enStart} Again.`,
    })
    const stopped = applyTextCorrections(inputs, [record(), bad])
    expect
      .soft(stopped, "(g6) [R, bad] → bad's code and no packages")
      .toStrictEqual(failure('correction-before-mismatch', { locale: 'en' }))
    expect
      .soft(inputs, '(g6) every input deep-equal to its snapshot after [R, bad]')
      .toEqual(snapshot)
    const bad1 = bad
    const bad2 = record({ storyId: 'lantern-walk', nodeId: 'nowhere' })
    expect
      .soft(applyTextCorrections(world(), [bad1, bad2]), "(g6) [bad1, bad2] → bad1's code")
      .toStrictEqual(failure('correction-before-mismatch', { locale: 'en' }))

    // g7 deep copy
    const originals = world()
    const before = structuredClone(originals)
    const copied = applyTextCorrections(originals, [record()])
    expect.soft(originals, '(g7) the inputs equal their snapshots after [R]').toEqual(before)
    expect
      .soft(
        copied.ok && twoPathsOf(copied.packages) !== twoPathsOf(originals),
        '(g7) the returned two-paths package is a new object',
      )
      .toBe(true)

    // g8 the empty set
    const empty = applyTextCorrections(world(), [])
    expect.soft(empty, '(g8) [] → ok, nothing applied, the packages unchanged').toStrictEqual({
      ok: true,
      packages: world(),
      applied: [],
    })
  })

  it(
    'T17-3 CI proof: the committed record is the owner’s correction of the one string in pt/, and nothing else changes (A5, CRIT-4)',
    { timeout: 60_000 },
    () => {
      const raw = loadLegacyStories(PT_STORIES).map((l) => convertLegacyStory(l.story))
      expect(raw.length, 'precondition: 11 stories').toBe(11)
      const crow = raw.find((p) => p.storyId === 'crow-and-serpent')
      const before = textOf(crow, 'hi', 'seek_advice')?.text
      expect(typeof before, 'precondition: crow-and-serpent hi seek_advice text exists').toBe(
        'string',
      )
      const loaded = loadTextCorrections()
      expect(loaded.ok && loaded.records.length, 'precondition: exactly 1 committed record').toBe(1)
      const records = loaded.ok ? loaded.records : []
      const committed = records[0]
      const text = before ?? ''

      // g1 the record
      expect
        .soft(
          committed && {
            storyId: committed.storyId,
            locale: committed.locale,
            nodeId: committed.nodeId,
            field: committed.field,
            approvedOn: committed.approvedOn,
            approvedBy: committed.approvedBy,
          },
          '(g1) the record names crow-and-serpent hi seek_advice text, 2026-11-15, owner',
        )
        .toEqual({
          storyId: 'crow-and-serpent',
          locale: 'hi',
          nodeId: 'seek_advice',
          field: 'text',
          approvedOn: '2026-11-15',
          approvedBy: 'owner',
        })

      // g2 before
      expect
        .soft(sha(text), '(g2) the re-converted string’s sha256 is the record’s')
        .toBe(committed?.beforeSha256)
      expect.soft(sha(text), '(g2) and the pinned literal').toBe(BEFORE_PIN)
      expect.soft(text.length, '(g2) 564 UTF-16 units').toBe(564)

      // g3 after
      const replaced = replaceSpanOnce(text, SPAN, REPLACEMENT)
      const after = committed?.after ?? ''
      expect.soft(replaced, '(g3) replaceSpanOnce gives the record’s after').toStrictEqual({
        ok: true,
        text: after,
      })
      expect.soft(after.length, '(g3) 565 units').toBe(565)
      expect.soft(sha(after), '(g3) the pinned after sha256').toBe(AFTER_PIN)
      expect.soft(text.slice(0, 167) === after.slice(0, 167), '(g3) the prefix is equal').toBe(true)
      expect.soft(text.slice(177) === after.slice(178), '(g3) the suffix is equal').toBe(true)

      // g4 after is clean
      expect.soft(/[琥珀]/u.test(after), '(g4) after holds no U+7425 or U+73C0').toBe(false)
      expect.soft(after === after.normalize('NFC'), '(g4) after is NFC').toBe(true)
      expect.soft(after.isWellFormed(), '(g4) after is well-formed').toBe(true)
      expect.soft(textHygiene(after), '(g4) after has no T001-T005 problem').toEqual([])
      expect.soft(scriptProblem(after), '(g4) after has no T006 problem').toBeNull()

      // g5 replaceSpanOnce
      expect
        .soft(replaceSpanOnce(text.replace(SPAN, ''), SPAN, REPLACEMENT), '(g5) the span removed')
        .toStrictEqual({ ok: false, count: 0 })
      expect
        .soft(
          replaceSpanOnce(text.replace(SPAN, SPAN + SPAN), SPAN, REPLACEMENT),
          '(g5) the span doubled',
        )
        .toStrictEqual({ ok: false, count: 2 })

      // g6 the 11
      const corrected = applyTextCorrections(raw, records)
      expect
        .soft(
          corrected.ok && corrected.applied.map((a) => a.afterSha256),
          '(g6) applied exactly one, with the pinned after sha256',
        )
        .toEqual([AFTER_PIN])
      const correctedPackages = corrected.ok ? corrected.packages : []
      expect
        .soft(
          differingStrings(raw, correctedPackages),
          '(g6) exactly one string differs across the 11',
        )
        .toEqual(['crow-and-serpent/hi/seek_advice/text'])
      expect.soft(t006Count(raw), '(g6) publish-mode T006 findings before: 1').toBe(1)
      expect.soft(t006Count(correctedPackages), '(g6) and after: 0').toBe(0)
    },
  )
})
