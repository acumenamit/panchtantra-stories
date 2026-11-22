// The owner approval record (spec §7.1, OD-12; design migration-input/p1-step15a-design.md §3.2,
// D15-2; P1-8d part a, Step 15a). `publisher approve` writes one record per story to
// masters/approvals/<storyId>/<packageSha256>.json as the canonical JCS bytes of a value this schema
// accepts; the Storage client's approval body gate and publish both parse it with this schema.
// - The field set is the spec's, closed: strict objects, no other key at either level.
// - reviewerChecklist, prescreen, decision and approvedBy are fixed literals (P1 has legacy stories
//   only, OD-10); approvedOn is a real calendar date, written as the UTC date of the run.
// - The two free-text fields are private owner notes; isReviewText keeps control, line-separator
//   and bidi characters and unpaired surrogates out of a permanent record and requires NFC,
//   trimmed text.
// Pure: zod and ./v1 only (zod-jitless first, src/ui/i18n/client-boundary.test.ts).
import '../zod-jitless'
import { z } from 'zod'
import { Locale, Sha256, StoryId } from './v1'

/** The fixed checklist line (spec §7.1). */
export const APPROVAL_CHECKLIST_TEXT = 'Flow Guide v1.0 checklist: all items ticked'
/** The fixed prescreen line for legacy stories (spec §7.1, OD-10). */
export const APPROVAL_PRESCREEN_LEGACY = 'not run: owner exception for legacy stories (OD-10)'
/** The longest narrationCheck, in UTF-16 units. */
export const REVIEW_TEXT_MAX = 200
/** The longest device name, in UTF-16 units. */
export const DEVICE_TEXT_MAX = 80

/** The rule-set ref form of a snapshot entry's waiver block (catalogue.ts WaiverKeys). */
const RULE_SET_REF = /^[a-z0-9-]{1,32}@\d{1,4}\.\d{1,4}\.\d{1,4}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * True for a UTF-16 unit a review text may not hold: C0 controls, DEL and C1 controls, the line and
 * paragraph separators, and every bidi control (Unicode Bidi_Control: the Arabic letter mark, the
 * marks, embeddings, overrides and isolates).
 */
function isForbiddenUnit(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

/**
 * A review text: a string of 1 to `max` UTF-16 units, well-formed (every surrogate paired, so the
 * record has a JCS form), equal to its NFC form and to its trim, with no unit isForbiddenUnit
 * names.
 */
export function isReviewText(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) return false
  if (value.normalize('NFC') !== value || value.trim() !== value) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (isForbiddenUnit(code)) return false
    if (isHighSurrogate(code)) {
      // charCodeAt past the end is NaN, which is no low surrogate.
      if (!isLowSurrogate(value.charCodeAt(i + 1))) return false
      i++
    } else if (isLowSurrogate(code)) return false
  }
  return true
}

/** A real calendar date in the proleptic Gregorian calendar (2028-02-29 yes, 2026-02-30 no). */
function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return false
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

const unique = (list: readonly unknown[]): boolean => new Set(list).size === list.length

const DeviceText = z
  .string()
  .refine((value) => isReviewText(value, DEVICE_TEXT_MAX) && !value.includes(','))

/** The owner's review answers (spec §7.1 `review`). */
export const ApprovalReview = z.strictObject({
  languagesRead: z.array(Locale).min(1).max(3).refine(unique),
  allNodesRead: z.literal(true),
  imagesViewed: z.number().int().min(0).max(64),
  narrationCheck: z.string().refine((value) => isReviewText(value, REVIEW_TEXT_MAX)),
  devices: z.array(DeviceText).min(1).max(8).refine(unique),
  reviewerChecklist: z.literal(APPROVAL_CHECKLIST_TEXT),
})
export type ApprovalReview = z.infer<typeof ApprovalReview>

/** One approval record (spec §7.1), closed. */
export const ApprovalRecord = z.strictObject({
  storyId: StoryId,
  packageSha256: Sha256,
  ruleSetRef: z.string().regex(RULE_SET_REF),
  waiversSha256: Sha256,
  review: ApprovalReview,
  prescreen: z.literal(APPROVAL_PRESCREEN_LEGACY),
  decision: z.literal('approved'),
  approvedOn: z.string().regex(DATE).refine(isCalendarDate),
  approvedBy: z.literal('owner'),
})
export type ApprovalRecord = z.infer<typeof ApprovalRecord>
