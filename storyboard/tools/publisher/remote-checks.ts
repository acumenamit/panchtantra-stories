// The publisher's remote story check (design migration-input/p1-step15a-design.md §4.4, D15-4,
// D15-8, D15-9, D15-12, CRIT-7, CRIT-12, TP-10; P1-8d part a, Step 15a). One code path for approve,
// publish, the featured check and rollback, on this PC and in Actions: everything is read from
// Storage through the read-only port, never from local files.
// - checkStoryRemote, in order, the first failure being the story's code: (1) the approval record
//   from masters (when required), strict, canonical JCS, its ids, the current rule set, the entry's
//   waiver file, and with expectApprovalSha256 the sha256 readMaster returned; (2) the package read
//   through the content-addressed read, its sha256 compared, then the build's checkPackage with
//   requireJcs (G011 and the unwaived-error rule included), the phase-1 rule, and for approve the
//   migration origin and its waiver block; (3) the waiver file named by the entry's block, re-derived
//   and compared byte for byte; (4) the media plan and the package and media listings, each object
//   listed with its size and mime.
// - checkCarriedEntry runs steps 2 and 4 on an entry publish takes from production (no approval or
//   waiver read; CRIT-7).
// - featureCheck is pure: the build's own featuredVerdict decides, and a refusal carries the counts
//   of the same validatePackage call the verdict makes (waivers never count).
// Results are codes only: no reason, message or body leaves this module; it never prints.
import { featuredVerdict } from '../../src/core/content/featured'
import { isCanonicalJcs, parseStrictJson } from '../../src/core/content/gates'
import { planMediaHeads } from '../../src/core/content/media'
import { checkPackage, type SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes } from '../../src/core/hashing'
import { ApprovalRecord } from '../../src/core/package/approval'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { validatePackage } from '../../src/core/validator/validate'
import type { StorageReader } from './port'
import { WAIVER_READ_CODE, failureCode } from './run-kit'
import { deriveWaiverBlock } from './story-checks'

const RULESET = PANCHATANTRA_RULESET
const PACKAGE_MIME = 'application/json'

/**
 * The requests of a full check, in order (§4.4; AUD-8): the masters approval read, the content
 * package read (no search), the masters waiver read, the listing of packages/<id>/, the listing of
 * media/<id>/. The tests of the check and of publish compare their request logs with it.
 */
export const REMOTE_CHECK_STEPS = [
  'approval',
  'package',
  'waiver',
  'packages-list',
  'media-list',
] as const

export interface RemoteCheckOptions {
  /** `skip` for approve (its record does not exist yet). */
  readonly approval: 'required' | 'skip'
  /** Rollback: the entry's approvalSha256, which the stored record's sha256 must equal. */
  readonly expectApprovalSha256?: string
  /** Approve: the package must be origin migration with a waiver block on its entry. */
  readonly origin?: 'migration'
}

export type RemoteCheckResult =
  | {
      readonly ok: true
      /** The sha256 readMaster returned for the record; null when step 1 was skipped. */
      readonly approvalSha256: string | null
      readonly pkg: StoryPackageV1
      readonly packageBytes: Uint8Array<ArrayBuffer>
    }
  | { readonly ok: false; readonly code: string; readonly storyId: string }

type Fail = Extract<RemoteCheckResult, { ok: false }>
type Checked = {
  readonly ok: true
  readonly pkg: StoryPackageV1
  readonly bytes: Uint8Array<ArrayBuffer>
}

export type ApprovalRecordCode =
  'approval-invalid' | 'approval-rule-set' | 'approval-waiver-mismatch'

/**
 * An approval record's bytes against the entry (§4.4 step 1): strict schema and canonical JCS
 * (approval-invalid), its storyId and packageSha256 equal to the entry's (approval-invalid), the
 * current rule set (approval-rule-set), and its waiversSha256 equal to the entry's waiver file
 * (approval-waiver-mismatch; an entry without a block never matches). null when valid.
 */
export function checkApprovalRecord(
  bytes: Uint8Array,
  entry: SnapshotEntry,
): ApprovalRecordCode | null {
  const parsed = parseStrictJson(bytes, ApprovalRecord, 'approval record')
  if (!parsed.ok || !isCanonicalJcs(parsed.value.raw, bytes)) return 'approval-invalid'
  const record = parsed.value.data
  if (record.storyId !== entry.storyId || record.packageSha256 !== entry.packageSha256) {
    return 'approval-invalid'
  }
  if (record.ruleSetRef !== RULESET.ref) return 'approval-rule-set'
  if (entry.waivers === undefined || record.waiversSha256 !== entry.waivers.waiverFileSha256) {
    return 'approval-waiver-mismatch'
  }
  return null
}

/** The codes step 2 and step 4 give, for a named story and for a carried one. */
interface StepCodes {
  readonly packageMissing: string
  readonly packageGate: string
}
const NAMED: StepCodes = { packageMissing: 'object-missing', packageGate: 'package-gate' }
const CARRIED: StepCodes = {
  packageMissing: 'carried-package-missing',
  packageGate: 'carried-package-gate',
}

/** Step 2: the package read by its content address, its sha256, checkPackage, the phase-1 rule. */
async function packageStep(
  reader: StorageReader,
  entry: SnapshotEntry,
  codes: StepCodes,
): Promise<Checked | { readonly ok: false; readonly code: string }> {
  const read = await reader.readContent({
    kind: 'package',
    storyId: entry.storyId,
    packageSha256: entry.packageSha256,
  })
  if (read.kind === 'not-found') return { ok: false, code: codes.packageMissing }
  if (read.kind !== 'found') return { ok: false, code: failureCode(read.kind) }
  if (read.sha256 !== entry.packageSha256) return { ok: false, code: codes.packageGate }
  const gate = await checkPackage(read.bytes, entry, RULESET, { requireJcs: true })
  if (!gate.ok) return { ok: false, code: codes.packageGate }
  if (gate.value.pkg.assets.length === 0) return { ok: false, code: 'phase-1-package' }
  return { ok: true, pkg: gate.value.pkg, bytes: read.bytes }
}

/** Step 4: the media plan, both listings, then the package and every head with size and mime. */
async function objectStep(
  reader: StorageReader,
  entry: SnapshotEntry,
  checked: Checked,
  codes: StepCodes,
): Promise<string | null> {
  const plan = planMediaHeads([{ pkg: checked.pkg }], '')
  if (!plan.ok) return codes.packageGate
  const listed = new Map<string, { size: number | null; mimetype: string | null }>()
  for (const folder of [`packages/${entry.storyId}/`, `media/${entry.storyId}/`]) {
    const listing = await reader.listContent(folder)
    if (listing.kind !== 'listed') return failureCode(listing.kind)
    for (const object of listing.objects) listed.set(object.path, object)
  }
  const wanted = [
    { path: entry.packagePath, bytes: checked.bytes.byteLength, mime: PACKAGE_MIME },
    ...plan.value.heads.map((head) => ({ path: head.path, bytes: head.bytes, mime: head.mime })),
  ]
  for (const object of wanted) {
    const found = listed.get(object.path)
    if (found === undefined) return 'object-missing'
    if (found.size === null || found.mimetype === null) return 'existing-object-unverifiable'
    if (found.size !== object.bytes || found.mimetype !== object.mime) {
      return 'existing-object-differs'
    }
  }
  return null
}

/** The JCS text of a waiver block (step 3 compares the derived and the entry's byte for byte). */
const blockText = (block: unknown): string => new TextDecoder().decode(jcsBytes(block))

/**
 * The remote story check (§4.4), all reads through `reader` (the read-only port): steps 1 to 4 in
 * order, the first failure being the story's code.
 */
export async function checkStoryRemote(
  reader: StorageReader,
  entry: SnapshotEntry,
  options: RemoteCheckOptions,
): Promise<RemoteCheckResult> {
  const storyId = entry.storyId
  const fail = (code: string): Fail => ({ ok: false, code, storyId })

  // 1. The approval record.
  let approvalSha256: string | null = null
  if (options.approval === 'required') {
    const read = await reader.readMaster({
      kind: 'approval',
      storyId,
      packageSha256: entry.packageSha256,
    })
    if (read.kind === 'not-found') return fail('approval-missing')
    if (read.kind !== 'found') return fail(failureCode(read.kind))
    const code = checkApprovalRecord(read.bytes, entry)
    if (code !== null) return fail(code)
    if (
      options.expectApprovalSha256 !== undefined &&
      read.sha256 !== options.expectApprovalSha256
    ) {
      return fail('approval-sha-mismatch')
    }
    approvalSha256 = read.sha256
  }

  // 2. The package.
  const checked = await packageStep(reader, entry, NAMED)
  if (!checked.ok) return fail(checked.code)
  if (options.origin === 'migration') {
    if (checked.pkg.origin !== 'migration') return fail('approve-origin-not-migration')
    if (entry.waivers === undefined) return fail('staged-entry-invalid')
  }

  // 3. The waiver file the entry's block names, re-derived from masters.
  if (entry.waivers !== undefined) {
    const read = await reader.readMaster({
      kind: 'waiver',
      storyId,
      waiverSha256: entry.waivers.waiverFileSha256,
    })
    if (read.kind !== 'found') return fail(WAIVER_READ_CODE[read.kind] ?? 'storage-failed')
    const derived = await deriveWaiverBlock(storyId, read.bytes)
    if (!derived.ok) return fail(derived.code)
    if (blockText(derived.waiver.block) !== blockText(entry.waivers)) {
      return fail('waiver-keys-differ')
    }
  }

  // 4. The objects.
  const objects = await objectStep(reader, entry, checked, NAMED)
  if (objects !== null) return fail(objects)
  return { ok: true, approvalSha256, pkg: checked.pkg, packageBytes: checked.bytes }
}

/**
 * §4.4 steps 2 and 4 on an entry publish takes from production (CRIT-7): three requests; a package
 * that is gone is carried-package-missing, another sha256 or a checkPackage or media-plan failure
 * carried-package-gate. No approval record or waiver file is read (L9).
 */
export async function checkCarriedEntry(
  reader: StorageReader,
  entry: SnapshotEntry,
): Promise<RemoteCheckResult> {
  const storyId = entry.storyId
  const checked = await packageStep(reader, entry, CARRIED)
  if (!checked.ok) return { ok: false, code: checked.code, storyId }
  const objects = await objectStep(reader, entry, checked, CARRIED)
  if (objects !== null) return { ok: false, code: objects, storyId }
  return { ok: true, approvalSha256: null, pkg: checked.pkg, packageBytes: checked.bytes }
}

export type FeatureResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'feature-not-in-production' }
  | {
      readonly ok: false
      readonly code: 'feature-media-incomplete'
      readonly counts: { readonly A001: number; readonly A005: number; readonly A006: number }
    }

/**
 * The featured invariant for one id (D15-12), pure: the id must be among N+1's `stories`; then the
 * build's featuredVerdict decides on the story's package `pkg` (already read by the caller's step 2;
 * undefined when the caller read none, which only an id outside `stories` can be), and a refusal
 * carries the A001, A005 and A006 error counts of the same validatePackage call (publish mode,
 * forFeature; waivers never count).
 */
export function featureCheck(
  id: string,
  stories: readonly SnapshotEntry[],
  pkg: StoryPackageV1 | undefined,
): FeatureResult {
  if (!stories.some((entry) => entry.storyId === id)) {
    return { ok: false, code: 'feature-not-in-production' }
  }
  if (pkg === undefined) {
    return { ok: false, code: 'feature-media-incomplete', counts: { A001: 0, A005: 0, A006: 0 } }
  }
  const verdict = featuredVerdict(id, stories, [], [{ pkg }], RULESET)
  if (verdict.featuredStoryId === id) return { ok: true }
  const report = validatePackage(pkg, { ruleSet: RULESET, mode: 'publish', forFeature: true })
  const count = (checkId: string) =>
    report.findings.filter((f) => f.checkId === checkId && f.severity === 'error').length
  return {
    ok: false,
    code: 'feature-media-incomplete',
    counts: { A001: count('A001'), A005: count('A005'), A006: count('A006') },
  }
}
