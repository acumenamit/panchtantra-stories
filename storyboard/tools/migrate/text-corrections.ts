// The recorded text corrections (design migration-input/p1-step17-design.md §3.15, D17-15, D17-31;
// DEC:31 option H1; P1 Step 17). tools/migrate/text-corrections.json holds the owner's corrections
// of story text that pt/ keeps as written: each record names one field of one node text by
// (storyId, locale, nodeId, field), the sha256 of that field's current UTF-8 bytes and the whole
// corrected field. One function applies them, in three places only: the media binder, the
// narration reader (tools/narration/parler-pipeline.ts) and Proof A
// (scripts/load-content.phase1.test.ts). Never convert.ts, validate-cli.ts, the migrate tests, a
// phase-1 file or tools/narration/cli.ts: pt/, the frozen legacy hash, the 0-diff proof, the
// phase-1 hashes and the waivers stay as they are.
// - The file is read once through readLocalFile (segment rule, exact case, no link, a regular file
//   of at most 65,536 bytes), then strictly: no BOM, fatal UTF-8, no own `__proto__` key, the strict
//   schema below. Every refusal, an absent file included, is exactly `{ok: false, code:
//   'correction-file'}`: no detail, so no text or path leaves this module.
// - applyTextCorrections checks the records in record order (rules 1-5 of §3.15), the first
//   failure wins and nothing is applied; it works on deep copies and never changes its inputs.
// Sync: node:crypto, node:path, node:url, zod, src/core and ../publisher/local-files only.
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DATE, isCalendarDate } from '../../src/core/package/approval'
import { hasOwnProtoKey, Locale, NodeId, Sha256, StoryId } from '../../src/core/package/v1'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { scriptProblem, textHygiene } from '../../src/core/validator/text'
import { readLocalFile } from '../publisher/local-files'
import type { LocalRead } from '../publisher/local-files'

/** The largest text-corrections.json, in bytes (inclusive). */
export const TEXT_CORRECTIONS_MAX_BYTES = 65_536
/** The most records one file holds. */
export const TEXT_CORRECTIONS_MAX_RECORDS = 64
/** The longest `after`, in UTF-16 units. */
export const CORRECTION_AFTER_MAX = 4096
/** The record file under the storyboard root. */
export const TEXT_CORRECTIONS_SEGMENTS: readonly string[] = [
  'tools',
  'migrate',
  'text-corrections.json',
]

/** storyboard/, from this module's place (tools/migrate/). */
const STORYBOARD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Node fields a record may correct (limit L15-1: choices and story-level fields are not). */
export const CorrectableField = z.enum(['text', 'question', 'lesson'])
export type CorrectableField = z.infer<typeof CorrectableField>

/** One correction (DEC:31's shape), closed. */
export const TextCorrection = z.strictObject({
  storyId: StoryId,
  locale: Locale,
  nodeId: NodeId,
  field: CorrectableField,
  beforeSha256: Sha256,
  // Well-formed at parse too (a JSON escape such as backslash-u-d800 decodes to a lone surrogate);
  // rule 4 checks it again with the rest of the after rules.
  after: z
    .string()
    .min(1)
    .max(CORRECTION_AFTER_MAX)
    .refine((value) => value.isWellFormed()),
  approvedOn: z.string().regex(DATE).refine(isCalendarDate),
  approvedBy: z.literal('owner'),
})
export type TextCorrection = z.infer<typeof TextCorrection>

/** The file, closed. */
export const TextCorrectionsFile = z.strictObject({
  corrections: z.array(TextCorrection).max(TEXT_CORRECTIONS_MAX_RECORDS),
})
export type TextCorrectionsFile = z.infer<typeof TextCorrectionsFile>

export type TextCorrectionsRead =
  | { readonly ok: true; readonly records: readonly TextCorrection[] }
  | { readonly ok: false; readonly code: 'correction-file' }

/** How the loader reads one file (readLocalFile's signature). */
export type LocalFileReader = (root: string, segments: readonly string[], cap: number) => LocalRead

const refused = (): TextCorrectionsRead => ({ ok: false, code: 'correction-file' })

/** The record file's bytes, strictly: size, BOM, fatal UTF-8, JSON, own `__proto__`, schema. */
export function parseTextCorrections(bytes: Uint8Array): TextCorrectionsRead {
  if (bytes.length > TEXT_CORRECTIONS_MAX_BYTES) return refused()
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return refused()
  let value: unknown
  try {
    // ignoreBOM keeps a BOM in the text, so JSON.parse would refuse it too.
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    return refused()
  }
  if (hasOwnProtoKey(value)) return refused()
  const parsed = TextCorrectionsFile.safeParse(value)
  if (!parsed.success) return refused()
  return { ok: true, records: parsed.data.corrections }
}

/** Reads storyboard/tools/migrate/text-corrections.json through `read` and parses it. */
export function loadTextCorrections(read: LocalFileReader = readLocalFile): TextCorrectionsRead {
  const file = read(STORYBOARD_ROOT, TEXT_CORRECTIONS_SEGMENTS, TEXT_CORRECTIONS_MAX_BYTES)
  if (!file.ok) return refused()
  return parseTextCorrections(file.bytes)
}

/** sha256 of a string's UTF-8 bytes, lower-case hex. */
const sha256Utf8 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

export type CorrectionCode =
  | 'correction-duplicate'
  | 'correction-target-missing'
  | 'correction-before-mismatch'
  | 'correction-after-invalid'

export interface AppliedCorrection {
  readonly storyId: string
  readonly locale: string
  readonly nodeId: string
  readonly field: CorrectableField
  readonly beforeSha256: string
  readonly afterSha256: string
}

export type ApplyCorrectionsResult =
  | {
      readonly ok: true
      readonly packages: StoryPackageV1[]
      readonly applied: readonly AppliedCorrection[]
    }
  | {
      readonly ok: false
      readonly code: CorrectionCode
      readonly storyId: string
      readonly nodeId: string
      readonly locale: string
      readonly field: CorrectableField
    }

/** Rule 4: `after` is well-formed, NFC, free of T001-T006 problems and not the current text. */
function afterIsValid(after: string, current: string): boolean {
  return (
    after.isWellFormed() &&
    after === after.normalize('NFC') &&
    textHygiene(after).length === 0 &&
    scriptProblem(after) === null &&
    after !== current
  )
}

/**
 * Applies the records to deep copies of the packages, in record order (§3.15):
 * 1. a second record for one (storyId, locale, nodeId, field): correction-duplicate;
 * 2. the story not exactly once among the packages, the locale not in its `locales` or without
 *    text, the node text absent, or the field absent (own keys only, so `constructor` names
 *    nothing): correction-target-missing;
 * 3. the sha256 of the field's current UTF-8 bytes differs from beforeSha256:
 *    correction-before-mismatch;
 * 4. `after` ill-formed, not NFC, with a T001-T006 problem, or equal to the current text:
 *    correction-after-invalid;
 * 5. applied: the field replaced and reported with both hashes.
 * The first failure wins and returns no packages; the inputs are never changed.
 */
export function applyTextCorrections(
  packages: readonly StoryPackageV1[],
  records: readonly TextCorrection[],
): ApplyCorrectionsResult {
  const copies = packages.map((p) => structuredClone(p))
  const seen = new Set<string>()
  const applied: AppliedCorrection[] = []
  for (const r of records) {
    const fail = (code: CorrectionCode): ApplyCorrectionsResult => ({
      ok: false,
      code,
      storyId: r.storyId,
      nodeId: r.nodeId,
      locale: r.locale,
      field: r.field,
    })
    const key = JSON.stringify([r.storyId, r.locale, r.nodeId, r.field])
    if (seen.has(key)) return fail('correction-duplicate')
    seen.add(key)

    const matches = copies.filter((p) => p.storyId === r.storyId)
    const pkg = matches.length === 1 ? matches[0] : undefined
    if (!pkg || !pkg.locales.includes(r.locale) || !Object.hasOwn(pkg.text, r.locale))
      return fail('correction-target-missing')
    const localeText = pkg.text[r.locale]
    if (!localeText || !Object.hasOwn(localeText.nodes, r.nodeId))
      return fail('correction-target-missing')
    const nodeText = localeText.nodes[r.nodeId]
    if (!nodeText || !Object.hasOwn(nodeText, r.field)) return fail('correction-target-missing')
    const current: unknown = nodeText[r.field]
    if (typeof current !== 'string') return fail('correction-target-missing')

    if (sha256Utf8(current) !== r.beforeSha256) return fail('correction-before-mismatch')
    if (!afterIsValid(r.after, current)) return fail('correction-after-invalid')

    nodeText[r.field] = r.after
    applied.push({
      storyId: r.storyId,
      locale: r.locale,
      nodeId: r.nodeId,
      field: r.field,
      beforeSha256: r.beforeSha256,
      afterSha256: sha256Utf8(r.after),
    })
  }
  return { ok: true, packages: copies, applied }
}

export type ReplaceSpanResult =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly count: number }

/**
 * How a record's `after` is made (TP17-1): `text` with its one occurrence of `span` replaced. Any
 * other number of occurrences (overlapping ones counted; an empty span counts 0) is a refusal
 * with that count.
 */
export function replaceSpanOnce(
  text: string,
  span: string,
  replacement: string,
): ReplaceSpanResult {
  if (span.length === 0) return { ok: false, count: 0 }
  let count = 0
  let first = -1
  for (let at = text.indexOf(span); at !== -1; at = text.indexOf(span, at + 1)) {
    if (count === 0) first = at
    count++
  }
  if (count !== 1) return { ok: false, count }
  return { ok: true, text: text.slice(0, first) + replacement + text.slice(first + span.length) }
}
