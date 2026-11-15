// Package gate (spec §3.2): one package's bytes checked against its snapshot entry. Pure: bytes in,
// verdicts out. Fixtures and Storage loading share it (P1-2a, P1-2b).
// P1-2b (design p1-step8-design.md §4.1 row 10, §5.3, §5.4, §9 items 12-19): Storage packages must
// be canonical JCS; collectionId is checked; the snapshot entry's public waiver keys are applied
// with the publisher's matcher; an unwaived error fails with up to 20 detail lines.
import { sha256Hex } from '../hashing'
import type { CatalogueSnapshot, WaiverKey } from '../package/catalogue'
import { StoryPackageV1 } from '../package/v1'
import type { PublicRuleSet } from '../rules/types'
import type { Finding, ValidationReport } from '../validator/types'
import { validatePackage } from '../validator/validate'
import { applyWaiverKeys } from '../validator/waivers'
import { decodeJson, isCanonicalJcs, parseStrictJson, safeLogText, type GateResult } from './gates'

export type SnapshotEntry = CatalogueSnapshot['stories'][number]

/** The validator's findings by kind, for the package log line. `errors` is unwaived errors. */
export interface PackageCounts {
  readonly errors: number
  readonly waived: number
  readonly warnings: number
  readonly info: number
}

export interface CheckedPackage {
  readonly entry: SnapshotEntry
  readonly pkg: StoryPackageV1
  /** The exact bytes that were hashed; the loader writes them out unchanged. */
  readonly bytes: Uint8Array<ArrayBuffer>
  /**
   * The validator report with the entry's waiver keys applied: no unwaived error remains, waived
   * findings are marked. `skipped` lists checks that did not run (E016-E018 at build).
   */
  readonly report: ValidationReport
  /** The waived findings, in report order (one `content: waived` line each). */
  readonly waived: readonly Finding[]
  /** Keys that matched no finding (one `content: waiver key unused` line each; never a failure). */
  readonly unusedKeys: readonly WaiverKey[]
  /** Unwaived findings whose key binds other text; always empty on a passing package. */
  readonly lapsed: readonly Finding[]
  readonly counts: PackageCounts
}

export interface CheckPackageOptions {
  /** Storage packages must be canonical JCS (spec:171); the committed fixtures are not. */
  readonly requireJcs: boolean
}

/** At most this many `content: unwaived` lines, then one `… and <k> more` line (design §3.4 row 13). */
export const MAX_UNWAIVED_LINES = 20

const LAPSED_HINT = ' (lapsed: a key for this check, node and locale binds other text)'

const ok = <T>(value: T): GateResult<T> => ({ ok: true, value })
const fail = <T>(reason: string): GateResult<T> => ({ ok: false, reason })

/** A storyId may appear only once in a snapshot, so each package has one output file. */
export function checkUniqueStoryIds(stories: readonly SnapshotEntry[]): GateResult<null> {
  const seen = new Set<string>()
  for (const { storyId } of stories) {
    if (seen.has(storyId)) return fail(`snapshot lists story ${storyId} more than once`)
    seen.add(storyId)
  }
  return ok(null)
}

/**
 * Package gate, in order (design §4.1 row 10): a. sha256(bytes) equals the entry's packageSha256;
 * b. with `requireJcs` (Storage), the bytes are canonical JCS; c. they strict-parse as a v1
 * package; d. its storyId, version and collectionId equal the entry's and the collection is the
 * rule set's; e. a waiver block is allowed only on an origin "migration" package and only for this
 * rule set (§5.3); f. the validator (publish mode, no private word lists) with the entry's keys
 * applied leaves no unwaived error. The first failure is returned, named. The approval gate is not
 * here: splitByApproval runs on the snapshot before packages are read.
 * `options` is required, so no caller can skip the Storage JCS rule by leaving it out.
 */
export async function checkPackage(
  bytes: Uint8Array<ArrayBuffer>,
  entry: SnapshotEntry,
  ruleSet: PublicRuleSet,
  options: CheckPackageOptions,
): Promise<GateResult<CheckedPackage>> {
  const label = `package ${entry.storyId}`
  if ((await sha256Hex(bytes)) !== entry.packageSha256) return fail(`${label} sha256 mismatch`)
  if (options.requireJcs) {
    const decoded = decodeJson(bytes, label)
    if (!decoded.ok) return decoded
    if (!isCanonicalJcs(decoded.value, bytes)) return fail(`${label} is not canonical JCS`)
  }
  const parsed = parseStrictJson(bytes, StoryPackageV1, label)
  if (!parsed.ok) return parsed
  const pkg = parsed.value.data
  if (pkg.storyId !== entry.storyId) {
    return fail(`${label} has storyId ${pkg.storyId}, but the snapshot names ${entry.storyId}`)
  }
  if (pkg.version !== entry.version) {
    return fail(`${label} has version ${pkg.version}, but the snapshot names ${entry.version}`)
  }
  if (pkg.collectionId !== entry.collectionId) {
    return fail(
      `${label} has collectionId ${safeLogText(pkg.collectionId)}, but the snapshot names ${safeLogText(entry.collectionId)}`,
    )
  }
  if (pkg.collectionId !== ruleSet.collectionId) {
    return fail(
      `${label} is in collection ${safeLogText(pkg.collectionId)}; this build has only the ${ruleSet.collectionId} rule set`,
    )
  }

  const block = entry.waivers
  if (block !== undefined) {
    if (pkg.origin !== 'migration') {
      return fail(
        `${label} carries waiver keys but its origin is ${pkg.origin}; waivers apply only to origin migration (spec §5.3)`,
      )
    }
    if (block.ruleSetRef !== ruleSet.ref) {
      return fail(
        `waiver keys for ${entry.storyId} were recorded for ${block.ruleSetRef}; this build validates with ${ruleSet.ref}`,
      )
    }
  }

  // Waiver files stay private; only the entry's public keys reach the build. An absent block
  // means no keys, so a story with errors and no block fails closed.
  const validated = validatePackage(pkg, { ruleSet, mode: 'publish' })
  const applied = await applyWaiverKeys(validated, pkg, block?.keys ?? [])
  const { report } = applied
  const unwaived = report.findings.filter((f) => f.severity === 'error' && !f.waived)
  if (unwaived.length > 0 || !report.ok) {
    const first = unwaived[0]
    return {
      ok: false,
      reason: `${label} failed the validator with ${unwaived.length} unwaived error(s); first: ${first ? describeFinding(first) : 'unknown'}`,
      details: unwaivedLines(entry.storyId, unwaived, applied.lapsed),
    }
  }
  const waived = report.findings.filter((f) => f.waived === true)
  const count = (severity: Finding['severity']) =>
    report.findings.filter((f) => f.severity === severity).length
  return ok({
    entry,
    pkg,
    bytes,
    report,
    waived,
    unusedKeys: applied.unused,
    lapsed: applied.lapsed,
    counts: {
      errors: unwaived.length,
      waived: waived.length,
      warnings: count('warn'),
      info: count('info'),
    },
  })
}

/** "E005 node=start locale=en: <message>", for the build log. */
export function describeFinding(f: Finding): string {
  const node = f.nodeId === null ? '' : ` node=${f.nodeId}`
  const locale = f.locale === null ? '' : ` locale=${f.locale}`
  return `${f.checkId}${node}${locale}: ${f.message}`
}

/** Up to 20 `content: unwaived` lines, each with the lapsed hint where it applies, then the rest counted. */
function unwaivedLines(
  storyId: string,
  unwaived: readonly Finding[],
  lapsed: readonly Finding[],
): string[] {
  const lines = unwaived
    .slice(0, MAX_UNWAIVED_LINES)
    .map(
      (f) =>
        `content: unwaived story=${storyId} ${where(f.checkId, f.nodeId, f.locale)}: ${f.message}${lapsed.includes(f) ? LAPSED_HINT : ''}`,
    )
  if (unwaived.length > MAX_UNWAIVED_LINES) {
    lines.push(`content: unwaived … and ${unwaived.length - MAX_UNWAIVED_LINES} more`)
  }
  return lines
}

const where = (checkId: string, nodeId: string | null, locale: string | null) =>
  `check=${checkId} node=${nodeId ?? '-'} locale=${locale ?? '-'}`

/**
 * The log lines for a package that passed the gate, in the design §4.5 order: the package line
 * (computed errors, waived, warnings, info), one line per waived finding, one per unused key, then
 * one per reason for skipped checks.
 */
export function packageLogLines(checked: CheckedPackage): string[] {
  const { entry, counts } = checked
  const story = `story=${entry.storyId}`
  const lines = [
    `content: package ${story} version=${entry.version} sha=${entry.packageSha256.slice(0, 12)} errors=${counts.errors} waived=${counts.waived} warnings=${counts.warnings} info=${counts.info}`,
  ]
  for (const f of checked.waived) {
    lines.push(`content: waived ${story} ${where(f.checkId, f.nodeId, f.locale)}`)
  }
  for (const k of checked.unusedKeys) {
    lines.push(
      `content: waiver key unused ${story} ${where(k.checkId, k.nodeId, k.locale)} (no matching finding)`,
    )
  }
  // Private word lists stay on the owner's PC, so these checks never run at build.
  const { skipped } = checked.report
  for (const reason of new Set(skipped.map((s) => s.reason))) {
    const ids = skipped.filter((s) => s.reason === reason).map((s) => s.checkId)
    lines.push(`content: validator skipped ${ids.join(',')} for ${story} (${reason})`)
  }
  return lines
}
