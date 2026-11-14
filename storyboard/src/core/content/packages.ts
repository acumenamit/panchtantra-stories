// Package gate (spec §3.2): one package's bytes checked against its snapshot entry. Pure: bytes in,
// verdicts out. Fixtures mode uses it from P1-2a; Storage loading reuses it in P1-2b.
import { sha256Hex } from '../hashing'
import type { CatalogueSnapshot } from '../package/catalogue'
import { StoryPackageV1 } from '../package/v1'
import type { PublicRuleSet } from '../rules/types'
import type { Finding, ValidationReport } from '../validator/types'
import { validatePackage } from '../validator/validate'
import { parseStrictJson, type GateResult } from './gates'

export type SnapshotEntry = CatalogueSnapshot['stories'][number]

export interface CheckedPackage {
  readonly entry: SnapshotEntry
  readonly pkg: StoryPackageV1
  /** The exact bytes that were hashed; the loader writes them out unchanged. */
  readonly bytes: Uint8Array<ArrayBuffer>
  /** No unwaived error remains. `skipped` lists checks that did not run (E016-E018 at build). */
  readonly report: ValidationReport
}

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
 * Package gate, in order: sha256(bytes) equals the entry's packageSha256; the bytes strict-parse as
 * a v1 package; the package's storyId and version match the entry; the validator (publish mode,
 * no waivers, no private word lists) reports no error. The first failure is returned, named.
 * The approval gate is not here: splitByApproval runs on the snapshot before packages are read.
 */
export async function checkPackage(
  bytes: Uint8Array<ArrayBuffer>,
  entry: SnapshotEntry,
  ruleSet: PublicRuleSet,
): Promise<GateResult<CheckedPackage>> {
  const label = `package ${entry.storyId}`
  if ((await sha256Hex(bytes)) !== entry.packageSha256) return fail(`${label} sha256 mismatch`)
  const parsed = parseStrictJson(bytes, StoryPackageV1, label)
  if (!parsed.ok) return parsed
  const pkg = parsed.value.data
  if (pkg.storyId !== entry.storyId) {
    return fail(`${label} has storyId ${pkg.storyId}, but the snapshot names ${entry.storyId}`)
  }
  if (pkg.version !== entry.version) {
    return fail(`${label} has version ${pkg.version}, but the snapshot names ${entry.version}`)
  }
  // Waivers live in the private bucket and are never applied at build, so any error fails it.
  const report = validatePackage(pkg, { ruleSet, mode: 'publish' })
  if (!report.ok) {
    const errors = report.findings.filter((f) => f.severity === 'error' && !f.waived)
    const first = errors[0]
    return fail(
      `${label} failed the validator with ${errors.length} error(s); first: ${first ? describeFinding(first) : 'unknown'}`,
    )
  }
  return ok({ entry, pkg, bytes, report })
}

/** "E005 node=start locale=en: <message>", for the build log. */
export function describeFinding(f: Finding): string {
  const node = f.nodeId === null ? '' : ` node=${f.nodeId}`
  const locale = f.locale === null ? '' : ` locale=${f.locale}`
  return `${f.checkId}${node}${locale}: ${f.message}`
}
