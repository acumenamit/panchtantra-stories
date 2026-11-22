// Step 15a (P1-8d part a): the owner approval record (design migration-input/p1-step15a-design.md
// §3.2 D15-2, §9 L1, §14.5 T15A-12 to T15A-14). A strict schema with SPEC §7.1's closed field set,
// written as canonical JCS bytes; isReviewText keeps control and bidi characters out of the two
// free-text fields. Titles start with their id; one expect.soft per claim, messages
// "(gN) <claim> <sample>"; preconditions are hard expects starting "precondition:".
import { describe, expect, it } from 'vitest'
import { isCanonicalJcs } from '../content/gates'
import { jcsBytes } from '../hashing'
import { PANCHATANTRA_RULESET } from '../rules/panchatantra'
import {
  APPROVAL_CHECKLIST_TEXT,
  APPROVAL_PRESCREEN_LEGACY,
  ApprovalRecord,
  DEVICE_TEXT_MAX,
  isReviewText,
  REVIEW_TEXT_MAX,
} from './approval'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

/** A full valid record (two-paths), built from the module's own literals. */
const fullRecord = (): Json => ({
  storyId: 'two-paths',
  packageSha256: SHA_A,
  ruleSetRef: PANCHATANTRA_RULESET.ref,
  waiversSha256: SHA_B,
  review: {
    languagesRead: ['en', 'hi'],
    allNodesRead: true,
    imagesViewed: 1,
    narrationCheck: 'checked',
    devices: ['phone', 'laptop'],
    reviewerChecklist: APPROVAL_CHECKLIST_TEXT,
  },
  prescreen: APPROVAL_PRESCREEN_LEGACY,
  decision: 'approved',
  approvedOn: '2026-11-21',
  approvedBy: 'owner',
})
const withTop = (over: Json): Json => ({ ...fullRecord(), ...over })
const withReview = (over: Json): Json => {
  const record = fullRecord()
  return { ...record, review: { ...record.review, ...over } }
}
const without = (key: string): Json => {
  const record = fullRecord()
  delete record[key]
  return record
}
const withoutReview = (key: string): Json => {
  const record = fullRecord()
  const review = { ...record.review }
  delete review[key]
  return { ...record, review }
}
const accepts = (value: unknown) => ApprovalRecord.safeParse(value).success
/** One UTF-16 unit changed in the middle of a literal. */
const oneOff = (text: string) => `${text.slice(0, 5)}${text[5] === 'x' ? 'y' : 'x'}${text.slice(6)}`
const PAIR = '\u{1F600}' // one character, two UTF-16 units

describe('ApprovalRecord (Step 15a)', () => {
  it('T15A-12 ApprovalRecord accepts a full record and every field at its bounds, and its JCS bytes are canonical (A2, D15-2)', () => {
    expect(accepts(fullRecord()), 'precondition: the full record parses').toBe(true)
    // (g1) bounds accepted
    const accepted: [string, Json][] = [
      ['imagesViewed 0', withReview({ imagesViewed: 0 })],
      ['imagesViewed 64', withReview({ imagesViewed: 64 })],
      ["languagesRead ['en']", withReview({ languagesRead: ['en'] })],
      ["languagesRead ['en', 'hi', 'ar']", withReview({ languagesRead: ['en', 'hi', 'ar'] })],
      ['1 device', withReview({ devices: ['phone'] })],
      ['8 devices', withReview({ devices: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'] })],
      ['narrationCheck of 200 units', withReview({ narrationCheck: 'n'.repeat(200) })],
      ['a device of 80 units', withReview({ devices: ['d'.repeat(80)] })],
      ['approvedOn 2028-02-29', withTop({ approvedOn: '2028-02-29' })],
      ['ruleSetRef a@0.0.0', withTop({ ruleSetRef: 'a@0.0.0' })],
      [
        'ruleSetRef of a 32-character name @9999.9999.9999',
        withTop({ ruleSetRef: `${'r'.repeat(32)}@9999.9999.9999` }),
      ],
    ]
    for (const [name, record] of accepted) {
      expect.soft(accepts(record), `(g1) accepted ${name}`).toBe(true)
    }
    // (g2) canonical JCS: the bytes are the record's JCS form, and parsing keeps the value as given
    const unsorted = withReview({ languagesRead: ['hi', 'en'] })
    expect
      .soft(isCanonicalJcs(unsorted, jcsBytes(unsorted)), '(g2) JCS bytes are canonical')
      .toBe(true)
    const parsed = ApprovalRecord.safeParse(unsorted)
    expect
      .soft(
        parsed.success ? new TextDecoder().decode(jcsBytes(parsed.data)) : 'refused',
        "(g2) the parsed value's JCS equals the input's (languagesRead hi, en)",
      )
      .toBe(new TextDecoder().decode(jcsBytes(unsorted)))
    // (g3) the literals and maxima of D15-2's table
    expect
      .soft(APPROVAL_CHECKLIST_TEXT, '(g3) checklist text')
      .toBe('Flow Guide v1.0 checklist: all items ticked')
    expect
      .soft(APPROVAL_PRESCREEN_LEGACY, '(g3) prescreen text')
      .toBe('not run: owner exception for legacy stories (OD-10)')
    expect.soft(REVIEW_TEXT_MAX, '(g3) review text max').toBe(200)
    expect.soft(DEVICE_TEXT_MAX, '(g3) device text max').toBe(80)
  })

  it('T15A-13 ApprovalRecord refuses every L1 sample (A2, L1)', () => {
    expect(accepts(fullRecord()), 'precondition: the full record parses').toBe(true)
    const topKeys = Object.keys(fullRecord())
    const reviewKeys = Object.keys(fullRecord().review as Json)
    expect(topKeys.length, 'precondition: 9 top-level keys').toBe(9)
    expect(reviewKeys.length, 'precondition: 6 review keys').toBe(6)
    const protoText = JSON.stringify(fullRecord()).replace('{', '{"__proto__":{},')
    const protoRecord = JSON.parse(protoText) as Json
    expect(
      Object.hasOwn(protoRecord, '__proto__'),
      'precondition: JSON.parse made an own __proto__ key',
    ).toBe(true)
    const lapsedRef = PANCHATANTRA_RULESET.ref.replace(/\.\d+$/, '')
    expect(lapsedRef, 'precondition: a two-part ref built from the rule set').toMatch(
      /^[a-z0-9-]+@\d+\.\d+$/,
    )
    const refused: [string, unknown][] = [
      ...topKeys.map((key): [string, unknown] => [`missing ${key}`, without(key)]),
      ...reviewKeys.map((key): [string, unknown] => [`missing review.${key}`, withoutReview(key)]),
      ['an extra top-level key', withTop({ extra: 1 })],
      ['an extra review key', withReview({ extra: 1 })],
      ['an own __proto__ key from JSON.parse', protoRecord],
      ['allNodesRead false', withReview({ allNodesRead: false })],
      ["decision 'rejected'", withTop({ decision: 'rejected' })],
      ["approvedBy 'x'", withTop({ approvedBy: 'x' })],
      ['approvedOn 2026-02-30', withTop({ approvedOn: '2026-02-30' })],
      ['approvedOn 2026-13-01', withTop({ approvedOn: '2026-13-01' })],
      ['approvedOn 2026-1-01', withTop({ approvedOn: '2026-1-01' })],
      ['approvedOn 2026-11-21T00:00:00Z', withTop({ approvedOn: '2026-11-21T00:00:00Z' })],
      ['imagesViewed 65', withReview({ imagesViewed: 65 })],
      ['imagesViewed -1', withReview({ imagesViewed: -1 })],
      ['imagesViewed 1.5', withReview({ imagesViewed: 1.5 })],
      ["imagesViewed '1'", withReview({ imagesViewed: '1' })],
      ['languagesRead []', withReview({ languagesRead: [] })],
      ["languagesRead ['fr']", withReview({ languagesRead: ['fr'] })],
      ["languagesRead ['en', 'en']", withReview({ languagesRead: ['en', 'en'] })],
      ['languagesRead of four', withReview({ languagesRead: ['en', 'hi', 'ar', 'en'] })],
      ['devices []', withReview({ devices: [] })],
      [
        'nine devices',
        withReview({ devices: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'] }),
      ],
      ['a duplicate device', withReview({ devices: ['phone', 'phone'] })],
      ["a device 'a,b'", withReview({ devices: ['a,b'] })],
      ['a device of 81 units', withReview({ devices: ['d'.repeat(81)] })],
      ['narrationCheck of 201 units', withReview({ narrationCheck: 'n'.repeat(201) })],
      ["narrationCheck ''", withReview({ narrationCheck: '' })],
      ["narrationCheck ' x'", withReview({ narrationCheck: ' x' })],
      ["narrationCheck 'x '", withReview({ narrationCheck: 'x ' })],
      ['narrationCheck with U+202E', withReview({ narrationCheck: 'a‮b' })],
      ['narrationCheck with U+0007', withReview({ narrationCheck: 'a\u0007b' })],
      ['narrationCheck with U+2028', withReview({ narrationCheck: 'a b' })],
      ['narrationCheck with U+200F', withReview({ narrationCheck: 'a‏b' })],
      ['narrationCheck with U+2067', withReview({ narrationCheck: 'a⁧b' })],
      ['narrationCheck with U+0085', withReview({ narrationCheck: 'a\u0085b' })],
      ['narrationCheck e + U+0301 (not NFC)', withReview({ narrationCheck: 'café' })],
      ['narrationCheck with U+061C', withReview({ narrationCheck: 'a؜b' })],
      ['narrationCheck with a lone high surrogate', withReview({ narrationCheck: 'ok\uD800' })],
      ['a device with a lone low surrogate', withReview({ devices: ['a\uDC00b'] })],
      ['ruleSetRef of two parts', withTop({ ruleSetRef: lapsedRef })],
      ['an upper-case packageSha256', withTop({ packageSha256: SHA_A.toUpperCase() })],
      [
        'the checklist text changed',
        withReview({ reviewerChecklist: oneOff(APPROVAL_CHECKLIST_TEXT) }),
      ],
      ['the prescreen text changed', withTop({ prescreen: oneOff(APPROVAL_PRESCREEN_LEGACY) })],
      ["storyId 'Two-Paths'", withTop({ storyId: 'Two-Paths' })],
    ]
    for (const [name, record] of refused) {
      expect.soft(accepts(record), `(g1) refused ${name}`).toBe(false)
    }
  })

  it('T15A-14 isReviewText: length in UTF-16 units, well-formed UTF-16, NFC, trimmed, and exactly the listed control and bidi sets (A2, L1)', () => {
    expect(isReviewText('ok', 200), "precondition: isReviewText('ok', 200)").toBe(true)
    const namaste = 'नमस्ते'
    expect(namaste.normalize('NFC'), 'precondition: the Devanagari sample is NFC').toBe(namaste)
    expect(PAIR.repeat(100).length, 'precondition: 100 pairs are 200 units').toBe(200)
    // (g1) accepted
    const accepted: [string, string][] = [
      ['NFC Devanagari', namaste],
      ['100 surrogate pairs at max 200', PAIR.repeat(100)],
      ['U+0020 inside', 'a b'],
      ['U+007E', 'a~b'],
      ['U+00A0 inside', 'a b'],
      ['U+200D (zero-width joiner)', 'a‍b'],
      ['U+2065', 'a⁥b'],
      ['U+061B (next to U+061C)', 'a؛b'],
      ['a surrogate pair at the end', `ok${PAIR}`],
    ]
    for (const [name, text] of accepted) {
      expect.soft(isReviewText(text, 200), `(g1) accepted ${name}`).toBe(true)
    }
    // (g2) refused
    const refused: [string, string][] = [
      ['101 surrogate pairs', PAIR.repeat(101)],
      ['U+001F', 'a\u001Fb'],
      ['U+007F', 'a\u007Fb'],
      ['U+0080', 'a\u0080b'],
      ['U+009F', 'a\u009Fb'],
      ['U+200E', 'a‎b'],
      ['U+202A', 'a‪b'],
      ['U+202E', 'a‮b'],
      ['U+2066', 'a⁦b'],
      ['U+2069', 'a⁩b'],
      ['U+2028', 'a b'],
      ['U+2029', 'a b'],
      ['a leading tab', '\tab'],
      ['U+061C (Arabic letter mark)', 'a؜b'],
      ['a lone high surrogate inside', 'a\uD800b'],
      ['a lone high surrogate at the end', 'ab\uDBFF'],
      ['a lone low surrogate', 'a\uDC00b'],
      ['a reversed pair (low, then high)', 'a\uDFFF\uD800b'],
      ['two high surrogates', 'a\uD800\uD800b'],
    ]
    for (const [name, text] of refused) {
      expect.soft(isReviewText(text, 200), `(g2) refused ${name}`).toBe(false)
    }
  })
})
