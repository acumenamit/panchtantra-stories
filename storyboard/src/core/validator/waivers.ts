// Legacy waivers (spec §5.4, REQ:64): for origin = "migration" only. A waiver matches on
// (storyId, checkId, nodeId, locale, nodeTextSha256); if the node changes, the waiver lapses.
// P1-2b (design p1-step8-design.md §3.1 D9, §5.4): one matcher for the build and the publisher.
// deriveWaiverKeys keeps only the public match fields of a waiver file; applyWaiverKeys applies
// them; applyWaivers is the two together. X000, S001 and A001 are never waived.
import '../zod-jitless'
import { z } from 'zod'
import { jcsSha256 } from '../hashing'
import { compareWaiverKeys } from '../package/catalogue'
import type { WaiverKey, WaiverKeys } from '../package/catalogue'
import { Locale, NodeId, Sha256, StoryId } from '../package/v1'
import type { StoryPackageV1 } from '../package/v1'
import type { Finding, ValidationReport } from './types'

export const WaiverFile = z.strictObject({
  storyId: StoryId,
  ruleSetRef: z.string(),
  basis: z.string(),
  measuredOnPackageSha256: Sha256.optional(), // informational only
  waivers: z.array(
    z.strictObject({
      checkId: z.string(),
      ruleId: z.string().nullable(),
      nodeId: NodeId.nullable(),
      locale: Locale.nullable(),
      severity: z.literal('error'),
      measured: z.string().optional(),
      limit: z.string().optional(),
      nodeTextSha256: Sha256,
    }),
  ),
  notes: z.array(z.string()),
  recordedOn: z.iso.date(),
  recordedBy: z.string(),
})
export type WaiverFile = z.infer<typeof WaiverFile>

/**
 * Integrity checks that are never waivable (design §3.4 row 26, §5.4): X000 (the validator
 * crashed, so later checks never ran), S001 (the package did not parse) and A001 (an asset
 * reference does not resolve, so it would reach a page).
 */
export const NEVER_WAIVABLE: ReadonlySet<string> = new Set(['X000', 'S001', 'A001'])

/**
 * Fingerprint the waiver binds to. Text checks: the node's text entry in that locale.
 * Locale-free checks: the node's structure {id, type, isAlternate, choices} only (no image, scene or
 * lessonIcon), so media binding in phase 2 never invalidates a waiver. Story-level: the graph.
 */
export async function findingFingerprint(
  pkg: StoryPackageV1,
  f: Pick<Finding, 'nodeId' | 'locale'>,
): Promise<string> {
  if (f.nodeId === null) {
    return jcsSha256({
      startNodeId: pkg.startNodeId,
      progressSteps: pkg.progressSteps,
      nodes: pkg.nodes.map(structural),
    })
  }
  if (f.locale !== null) return jcsSha256(pkg.text[f.locale]?.nodes[f.nodeId] ?? null)
  const node = pkg.nodes.find((n) => n.id === f.nodeId)
  return jcsSha256(node ? structural(node) : null)
}

function structural(n: StoryPackageV1['nodes'][number]) {
  return {
    id: n.id,
    type: n.type,
    isAlternate: n.isAlternate,
    choices: n.type === 'ending' ? [] : n.choices,
  }
}

const keyOf = (checkId: string, nodeId: string | null, locale: string | null, sha: string) =>
  `${checkId}|${nodeId ?? '-'}|${locale ?? '-'}|${sha}`

/** The same check, node and locale; the text binding left out (for the lapsed hint). */
const placeOf = (checkId: string, nodeId: string | null, locale: string | null) =>
  `${checkId}|${nodeId ?? '-'}|${locale ?? '-'}`

/**
 * The public waiver block of a waiver file (design §5.2, §5.4): `ruleSetRef`, the sha256 of the
 * file's bytes, and per record only {checkId, nodeId, locale, nodeTextSha256}, sorted. Pure. Throws
 * (never de-duplicates or drops) on a duplicate key or on a record for X000, S001 or A001. The
 * messages name only story, check and node ids and locales.
 */
export function deriveWaiverKeys(file: WaiverFile, fileSha256: string): WaiverKeys {
  const keys: WaiverKey[] = file.waivers.map((w) => ({
    checkId: w.checkId,
    nodeId: w.nodeId,
    locale: w.locale,
    nodeTextSha256: w.nodeTextSha256,
  }))
  for (const k of keys) {
    if (NEVER_WAIVABLE.has(k.checkId)) {
      throw new TypeError(
        `waiver file for ${file.storyId} has a record for ${k.checkId}, which is never waivable (X000, S001, A001)`,
      )
    }
  }
  keys.sort(compareWaiverKeys)
  for (let i = 1; i < keys.length; i++) {
    const previous = keys[i - 1]
    const current = keys[i]
    if (previous && current && compareWaiverKeys(previous, current) === 0) {
      throw new TypeError(
        `waiver file for ${file.storyId} has a duplicate key: ${current.checkId} node=${current.nodeId ?? '-'} locale=${current.locale ?? '-'}`,
      )
    }
  }
  return { ruleSetRef: file.ruleSetRef, waiverFileSha256: fileSha256, keys }
}

export interface AppliedWaiverKeys {
  /** The report with matching error findings marked `waived` and `ok` recomputed. */
  readonly report: ValidationReport
  /** Keys that waived nothing: no error finding matches, or it is never waivable. Logged only. */
  readonly unused: readonly WaiverKey[]
  /**
   * Unwaived error findings (the objects in `report.findings`) for which a key names the same
   * check, node and locale but binds other text: the node changed after the waiver was recorded.
   * Never-waivable findings are not listed (no key can waive them).
   */
  readonly lapsed: readonly Finding[]
}

/**
 * The one matcher (design §5.4). Marks each error finding `waived` when a key equals
 * (checkId, nodeId, locale, findingFingerprint); never X000, S001 or A001. No origin or rule-set
 * guard here: applyWaivers keeps its silent guards, and the build's package gate fails instead.
 */
export async function applyWaiverKeys(
  report: ValidationReport,
  pkg: StoryPackageV1,
  keys: readonly WaiverKey[],
): Promise<AppliedWaiverKeys> {
  const keyText = (k: WaiverKey) => keyOf(k.checkId, k.nodeId, k.locale, k.nodeTextSha256)
  const allowed = new Set(keys.map(keyText))
  const places = new Set(keys.map((k) => placeOf(k.checkId, k.nodeId, k.locale)))
  const used = new Set<string>()
  const findings: Finding[] = []
  const lapsed: Finding[] = []
  for (const f of report.findings) {
    if (NEVER_WAIVABLE.has(f.checkId)) {
      // Never waived by any path (design §5.4): one that arrives marked waived leaves unwaived.
      findings.push(f.waived ? { ...f, waived: false } : f)
      continue
    }
    if (f.severity !== 'error') {
      findings.push(f)
      continue
    }
    const key = keyOf(f.checkId, f.nodeId, f.locale, await findingFingerprint(pkg, f))
    if (allowed.has(key)) {
      used.add(key)
      findings.push({ ...f, waived: true })
      continue
    }
    findings.push(f)
    if (!f.waived && places.has(placeOf(f.checkId, f.nodeId, f.locale))) lapsed.push(f)
  }
  return {
    report: {
      ...report,
      findings,
      ok: !findings.some((f) => f.severity === 'error' && !f.waived),
    },
    unused: keys.filter((k) => !used.has(keyText(k))),
    lapsed,
  }
}

/**
 * Marks matching error findings as waived; recomputes ok. Waivers never apply to non-migration
 * packages, and a file for another story or rule set is ignored (silent, as before P1-2b). Since
 * P1-2b it is deriveWaiverKeys plus applyWaiverKeys, so a file with a duplicate record or a record
 * for X000, S001 or A001 throws instead of matching.
 */
export async function applyWaivers(
  report: ValidationReport,
  pkg: StoryPackageV1,
  file: WaiverFile | null,
): Promise<ValidationReport> {
  if (
    !file ||
    pkg.origin !== 'migration' ||
    file.storyId !== pkg.storyId ||
    file.ruleSetRef !== report.ruleSetRef
  ) {
    return report
  }
  // Matching never reads waiverFileSha256; the parsed file's JCS digest stands in for the bytes
  // this function never sees.
  const block = deriveWaiverKeys(file, await jcsSha256(file))
  return (await applyWaiverKeys(report, pkg, block.keys)).report
}

/**
 * Drafts one waiver per unwaived error finding (for the owner to review; never auto-approved).
 * X000, S001 and A001 findings are never drafted: they are never waivable (design §9 item 39).
 * Findings that share a key (one check on two strings of the same node and locale) get one
 * record, the first in report order: that key waives them all, and a second record would make
 * deriveWaiverKeys refuse the draft as a duplicate, so a draft never trips that refusal either.
 */
export async function draftWaivers(
  report: ValidationReport,
  pkg: StoryPackageV1,
  meta: { basis: string; recordedOn: string; packageSha256?: string },
): Promise<WaiverFile> {
  const waivers = []
  const drafted = new Set<string>()
  for (const f of report.findings) {
    if (f.severity !== 'error' || f.waived || NEVER_WAIVABLE.has(f.checkId)) continue
    const nodeTextSha256 = await findingFingerprint(pkg, f)
    const key = keyOf(f.checkId, f.nodeId, f.locale, nodeTextSha256)
    if (drafted.has(key)) continue
    drafted.add(key)
    waivers.push({
      checkId: f.checkId,
      ruleId: f.ruleId,
      nodeId: f.nodeId,
      locale: f.locale,
      severity: 'error' as const,
      ...(f.measured !== undefined ? { measured: f.measured } : {}),
      ...(f.limit !== undefined ? { limit: f.limit } : {}),
      nodeTextSha256,
    })
  }
  return WaiverFile.parse({
    storyId: pkg.storyId,
    ruleSetRef: report.ruleSetRef,
    basis: meta.basis,
    ...(meta.packageSha256 ? { measuredOnPackageSha256: meta.packageSha256 } : {}),
    waivers,
    notes: [],
    recordedOn: meta.recordedOn,
    recordedBy: 'owner (draft, not yet approved)',
  })
}
