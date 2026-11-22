// The publisher's publish command, with --feature and --snapshot (design
// migration-input/p1-step15a-design.md §4.2 to §4.6, D15-7 to D15-14, D15-18, D15-19, D15-22,
// D15-24, CRIT-6 to CRIT-8, CRIT-11, CRIT-12, CRIT-17, TP-6, TP-7; P1-8d part a, Step 15a).
// - In pc mode the report dir is checked first (run-kit openReportDir); every later exit writes the
//   report into that checked real dir. Actions mode writes no report (D15-15).
// - The plan, by kind (D15-24; Step 15b adds unpublish), through readOnlyPort:
//   - publish: per named id its staged entry (not-staged), in production already (no record read)
//     or superseded (D15-4 step 3's rule), else the full remote check (§4.4); then every entry N+1
//     takes from production gets §4.4 steps 2 and 4 (CRIT-7); composeProduction; the featured
//     invariant on the packages already read (D15-12).
//   - rollback (--snapshot <seq>): production exists, <seq> listed and at or below production's,
//     read strict, canonical, its own seq, every entry approved and passing the full remote check
//     with its approvalSha256; composeRollback (unchanged by content, CRIT-6); the featured invariant.
// - Unless the plan is unchanged: allocateSeq and buildProductionDocuments; the plan lines; a dry
//   run stops there. The commit: createSnapshot (with its read-back), then movePointer for
//   production only; publish and rollback never write staging (unpublish moves it: Step 15b below).
// - The tail, after the pointer moved or after an unchanged plan, never after a stop (D15-11): one
//   hook (never retried), then verify; hook-failed and verify-timeout exit 4 with the recovery line
//   (and, after a timeout, the Instant Rollback hint). From the hook call on the phase is tail, so a
//   throw there is internal at exit 4, the report written and the hook never called again.
// - Output only through deps.log and deps.error, in report.ts's fixed formats: ids, hashes, counts,
//   seqs and codes; a record body, a check's reason or a thrown message is never printed. A client
//   refusal is recognised only by isStorageRefusal. The hook and verify come in as deps.tail, so this
//   module never reaches a network module itself.
// - Step 15b (migration-input/p1-step15b-design.md §4.2, §4.5, D15B-2 to D15B-7, D15B-16 to D15B-18,
//   D15B-22, D15B-28 to D15B-33; P1-8d part b):
//   - Every tail reaching live or superseded ends with the one Range check (deps.tail.range) on the
//     first audio/mpeg head of the verified snapshot's packages, in snapshot order; no MP3 prints the
//     skip line; a failure is range-check-failed (exit 4) with RANGE_RECOVERY. A verify timeout
//     prints exactly one of the Instant Rollback flag lines or the hint, before the recovery line.
//   - Kind unpublish (`--unpublish <id> [--takedown]`) holds the unpublish port only
//     (deps.makeUnpublishPort; makePort is never called): the state, P and S, moves both, staging or
//     none; in neither pointer the story's two folders must list something (unpublish-story-unknown);
//     N+1 = production without the story (composeUnpublish), the last story refused; the carried
//     checks on N+1's entries; with --takedown the takedown plan (takedown.ts); documents exactly when
//     something moves. The commit moves production, then staging to the same N+1; a production
//     pointer-raced and a staging failure after production moved are recorded and the tail runs. The
//     tail: hook, verify with the story absent, the no-rollback line, the takedown commit (the
//     deleter built only there, through deps.makeRemover), then the Range check. The end follows
//     D15B-32: a stopping step's code, else range-check-failed, else the first recorded condition
//     (pointer-raced, staging-not-moved, takedown-mp3-kept), else taken-down, verify-superseded,
//     unpublished or rebuilt; after an exit-4 end the kept-MP3 line, the unpublish recovery line and
//     RANGE_RECOVERY as they apply. Publish and rollback keep every Step 15a stop.
import { checkPackagePaths, isCanonicalJcs, parseStrictJson } from '../../src/core/content/gates'
import { planMediaHeads } from '../../src/core/content/media'
import { checkUniqueStoryIds, type SnapshotEntry } from '../../src/core/content/packages'
import { CatalogueSnapshot } from '../../src/core/package/catalogue'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import {
  allocateSeq,
  buildProductionDocuments,
  composeProduction,
  composeRollback,
  composeUnpublish,
  createSnapshot,
  movePointer,
  readCatalogueState,
  sameEntry,
  type CatalogueState,
  type NamedProductionEntry,
  type ProductionComposition,
  type ProductionDocuments,
} from './catalogue-state'
import {
  isStorageRefusal,
  readOnlyPort,
  type ContentRemover,
  type PublishPort,
  type RangeAnswer,
  type RangeTarget,
  type StorageReader,
  type UnpublishPort,
} from './port'
import {
  RANGE_RECOVERY,
  TAKEDOWN_LAG_NOTE,
  VERIFY_TIMEOUT_HINT,
  exitForPhase,
  formatFeature,
  formatFeatureCounts,
  formatLive,
  formatMp3Kept,
  formatNoRollback,
  formatOlderLive,
  formatOlderThanBefore,
  formatProductionMoved,
  formatPublishPlan,
  formatPublishSnapshot,
  formatPublishStory,
  formatRangeFailed,
  formatRangeOk,
  formatRangeSkipped,
  formatRecovery,
  formatStagingMoved,
  formatStagingNotMoved,
  formatStopped,
  formatSuperseded,
  formatTakedownDone,
  formatTakedownPlan,
  formatTakedownRemoved,
  formatUnpublishPlan,
  formatUnpublishRecovery,
  formatUnpublishUnknown,
  internalName,
  type CheckedReportDir,
  type ExitCode,
  type Phase,
  type ReportChecks,
  type ReportInput,
  type ReportPublish,
  type ReportTakedown,
  type ReportUnpublish,
  type StopDetail,
} from './report'
import { checkCarriedEntry, checkStoryRemote, featureCheck } from './remote-checks'
import { Stop, failureCode, openReportDir, writeRunReport } from './run-kit'
import { classOfPath } from './storage-layout'
import { commitTakedown, planTakedown, type TakedownPlan } from './takedown'

const RULESET = PANCHATANTRA_RULESET

/**
 * What verify answered: the expected seq or a later one live, or no confirmation in time; a timeout
 * may carry the last live seq verify read (D15B-18).
 */
export type VerifyAnswer =
  | { readonly kind: 'live' | 'superseded'; readonly seq: number }
  | { readonly kind: 'timeout'; readonly lastSeq?: number | null }

/**
 * The tail's functions (TP-7), adapted by cli.ts from hook.ts and verify.ts. `absentStoryIds` is
 * for the unpublish (Step 15b); publish and rollback never pass it. `range` is the one Range check
 * (D15B-16), on the target this module picks.
 */
export interface PublishTail {
  readonly hook: () => Promise<'triggered' | 'failed'>
  readonly verify: (
    expectedSeq: number,
    absentStoryIds?: readonly string[],
  ) => Promise<VerifyAnswer>
  readonly range: (target: RangeTarget) => Promise<RangeAnswer>
}

/** What publish needs from the parsed arguments (the timeout goes to the client, in cli.ts). */
export interface PublishInput {
  readonly ids: readonly string[]
  /** True when --feature was given (`none` included). */
  readonly featureGiven: boolean
  /** The story id of --feature; null for `none` or when the flag was not given. */
  readonly feature: string | null
  /** The seq of --snapshot, or null. */
  readonly snapshot: number | null
  /** The story id of --unpublish (Step 15b, D15B-1), or null. */
  readonly unpublish: string | null
  /** --takedown (D15B-8): only with --unpublish. */
  readonly takedown: boolean
  readonly dryRun: boolean
  readonly reportDir: string
  readonly reportDirGiven: boolean
}

export interface PublishDeps {
  readonly storyboardRoot: string
  readonly platform: string
  readonly now: () => Date
  readonly sleep: (ms: number) => Promise<void>
  readonly log: (line: string) => void
  readonly error: (line: string) => void
  /** pc: this PC, reports written; actions: GitHub Actions, no report dir and no report (D15-15). */
  readonly runMode: 'pc' | 'actions'
  /** Builds the client for publish and rollback; called once, never for an unpublish. */
  readonly makePort: () => PublishPort
  /** Builds the client for an unpublish (D15B-6); called once, only for kind unpublish. */
  readonly makeUnpublishPort: () => UnpublishPort
  /** Builds the content deleter (D15B-14); called only in the takedown commit, at most once. */
  readonly makeRemover: () => ContentRemover
  /** The real path of a local folder (cli.ts: realpathSync.native; D15B-36). */
  readonly realPath: (path: string) => string
  readonly tail: PublishTail
}

/** The plan kinds (D15-24, D15B-1). */
type PlanKind = 'publish' | 'rollback' | 'unpublish'

type FeatureState = 'set' | 'cleared' | 'kept' | 'checked'

interface Plan {
  readonly composition: ProductionComposition
  readonly feature: FeatureState | null
  /** Every entry's package as the plan read it (the Range target's source, D15B-16). */
  readonly packages: ReadonlyMap<string, StoryPackageV1>
}

/** The report's takedown state for a takedown stop (§3.23). */
const TAKEDOWN_STATE: Readonly<Record<string, ReportTakedown['state']>> = {
  'takedown-incomplete': 'incomplete',
  'takedown-raced': 'raced',
  'takedown-still-named': 'still-named',
  'takedown-check-failed': 'check-failed',
  'takedown-not-on-this-pc': 'not-on-this-pc',
  'takedown-unknown-object': 'unknown-object',
}

/**
 * The Range target (D15B-16): the first audio/mpeg head of planMediaHeads over the verified
 * snapshot's packages in snapshot order, its sha256 the path's 64 hex; null when none.
 */
function rangeTarget(
  stories: readonly SnapshotEntry[],
  packages: ReadonlyMap<string, StoryPackageV1>,
): RangeTarget | null {
  const pkgs = stories.map((entry) => packages.get(entry.storyId))
  if (pkgs.some((pkg) => pkg === undefined)) {
    throw new TypeError('publish: a verified entry has no package read')
  }
  const plan = planMediaHeads(
    pkgs.flatMap((pkg) => (pkg === undefined ? [] : [{ pkg }])),
    '',
  )
  if (!plan.ok) throw new TypeError('publish: the verified snapshot has no media plan')
  const head = plan.value.heads.find((candidate) => candidate.mime === 'audio/mpeg')
  if (head === undefined) return null
  const sha256 = classOfPath('content', head.path)?.fields.sha256
  if (typeof sha256 !== 'string') throw new TypeError('publish: an MP3 head without a sha256 name')
  return { path: head.path, bytes: head.bytes, sha256 }
}

/**
 * The publish command (§4.2, §4.3; Step 15b §4.2 for --unpublish): exit 0 published, unpublished,
 * taken-down, rebuilt, verify-superseded or dry-run.
 */
export async function runPublish(input: PublishInput, deps: PublishDeps): Promise<ExitCode> {
  let realDir: CheckedReportDir | null = null
  if (deps.runMode === 'pc') {
    realDir = openReportDir('publish', input.reportDir, input.reportDirGiven, deps)
    if (realDir === null) return 2
  }
  const startedAt = deps.now().toISOString()
  const mode = input.dryRun ? 'dry-run' : 'publish'
  const unpublishId = input.unpublish
  const kind: PlanKind =
    unpublishId !== null ? 'unpublish' : input.snapshot === null ? 'publish' : 'rollback'
  /** --feature: undefined when not given, null for none, else the id. */
  const feature = input.featureGiven ? input.feature : undefined
  let phase: Phase = 'plan'
  let writes = 0
  let hookCalls = 0
  let orphans: readonly number[] = []
  let section: ReportPublish | null = null
  const update = (fields: Partial<ReportPublish>) => {
    if (section !== null) section = { ...section, ...fields }
  }
  // Step 15b's optional report sections (§3.23): written on every publish report.
  let unpublishSection: ReportUnpublish | null = null
  let takedownSection: ReportTakedown | null =
    unpublishId !== null && input.takedown
      ? {
          storyId: unpublishId,
          packages: 0,
          media: 0,
          mp3: 0,
          mp3Unproven: 0,
          images: 0,
          removed: 0,
          kept: 0,
          state: 'not-run',
        }
      : null
  let checks: ReportChecks = { range: 'not-run', rollbackFlag: 'none' }
  const updateUnpublish = (fields: Partial<ReportUnpublish>) => {
    if (unpublishSection !== null) unpublishSection = { ...unpublishSection, ...fields }
  }
  const updateTakedown = (fields: Partial<ReportTakedown>) => {
    if (takedownSection !== null) takedownSection = { ...takedownSection, ...fields }
  }

  const report = (outcome: string, exitCode: ExitCode): ReportInput => ({
    command: 'publish',
    mode,
    startedAt,
    finishedAt: deps.now().toISOString(),
    outcome,
    exitCode,
    writes,
    uploaded: [],
    skipped: [],
    orphans,
    superseded: [],
    ruleSetRef: RULESET.ref,
    privateWordLists: 'not loaded',
    stories: [],
    publish: section,
    unpublish: unpublishSection,
    takedown: takedownSection,
    checks,
  })
  /** The report, then the exit; a failed report is exit 2 only when nothing was written or hooked. */
  const finish = (code: string, at: Phase): ExitCode => {
    const exitCode = exitForPhase(code, at)
    if (realDir === null) return exitCode
    if (writeRunReport('publish', realDir, report(code, exitCode), input.reportDirGiven, deps)) {
      return exitCode
    }
    return writes === 0 && hookCalls === 0 ? 2 : exitCode
  }
  function stop(code: string, detail: StopDetail = {}, at: Phase = phase): never {
    throw new Stop(code, detail, at)
  }

  /** The commit holds the port through this wrapper: it counts writes and marks the pointer phase. */
  const tracked = (port: PublishPort): PublishPort => ({
    listContent: (folder) => port.listContent(folder),
    readContent: (ref) => port.readContent(ref),
    readMaster: (ref) => port.readMaster(ref),
    create: async (ref, body) => {
      const result = await port.create(ref, body)
      writes += 1
      return result
    },
    writePointer: async (pointerMode, body) => {
      const result = await port.writePointer(pointerMode, body)
      writes += 1
      if (result.kind !== 'unauthorized') phase = 'pointer'
      return result
    },
  })
  /** The unpublish commit's wrapper (D15B-6): the same counting, either pointer. */
  const trackedUnpublish = (port: UnpublishPort): UnpublishPort => ({
    listContent: (folder) => port.listContent(folder),
    readContent: (ref) => port.readContent(ref),
    readMaster: (ref) => port.readMaster(ref),
    create: async (ref, body) => {
      const result = await port.create(ref, body)
      writes += 1
      return result
    },
    writePointer: async (pointerMode, body) => {
      const result = await port.writePointer(pointerMode, body)
      writes += 1
      if (result.kind !== 'unauthorized') phase = 'pointer'
      return result
    },
  })

  /**
   * The verify timeout's one line (D15B-18): older than production's seq before the run when
   * production moved in this run, else older than the expected seq, else the hint.
   */
  function timeoutLine(
    expectedSeq: number,
    before: number | null,
    lastSeq: number | null | undefined,
  ): string {
    const last = lastSeq ?? null
    if (before !== null && expectedSeq > before && last !== null && last < before) {
      checks = { ...checks, rollbackFlag: 'older-than-before' }
      return formatOlderThanBefore('publish', last, before)
    }
    if (last !== null && last < expectedSeq) {
      checks = { ...checks, rollbackFlag: 'older-live' }
      return formatOlderLive('publish', last, expectedSeq)
    }
    return VERIFY_TIMEOUT_HINT
  }

  /** The Range step (D15B-16, D15B-17): true when it failed. */
  async function rangeStep(
    stories: readonly SnapshotEntry[],
    packages: ReadonlyMap<string, StoryPackageV1>,
    expectedSeq: number,
  ): Promise<boolean> {
    phase = 'tail'
    const target = rangeTarget(stories, packages)
    if (target === null) {
      deps.log(formatRangeSkipped('publish', expectedSeq))
      checks = { ...checks, range: 'skipped' }
      return false
    }
    const answer = await deps.tail.range(target)
    if (answer.kind === 'ok') {
      deps.log(
        formatRangeOk('publish', {
          seq: expectedSeq,
          start: answer.start,
          end: answer.end,
          size: answer.size,
          sha256: target.sha256,
        }),
      )
      checks = { ...checks, range: 'ok' }
      return false
    }
    deps.log(formatRangeFailed('publish', answer.reason, target.sha256))
    checks = { ...checks, range: 'failed' }
    return true
  }

  /** The featured invariant for one id (D15-12) on the packages already read. */
  function checkFeatured(
    id: string,
    composition: ProductionComposition,
    packages: ReadonlyMap<string, StoryPackageV1>,
  ): void {
    const verdict = featureCheck(id, composition.stories, packages.get(id))
    if (verdict.ok) return
    if (verdict.code === 'feature-media-incomplete') {
      deps.log(formatFeatureCounts({ storyId: id, ...verdict.counts }))
    }
    stop(verdict.code, { storyId: id })
  }

  /** §4.2 steps 3 to 6: the named stories, the carried entries, the composition, the featured id. */
  async function planPublish(reader: StorageReader, state: CatalogueState): Promise<Plan> {
    const production = state.production?.snapshot ?? null
    if (input.ids.length === 0 && production === null) stop('production-missing')
    const packages = new Map<string, StoryPackageV1>()
    const named: NamedProductionEntry[] = []
    const checked = new Map<string, string | null>()
    for (const id of input.ids) {
      const staged = state.staging?.snapshot.stories.find((entry) => entry.storyId === id)
      if (staged === undefined) stop('not-staged', { storyId: id })
      const current = production?.stories.find((entry) => entry.storyId === id)
      if (current !== undefined && sameEntry(staged, current)) {
        named.push({ entry: staged, approvalSha256: null })
        checked.set(id, null)
        continue
      }
      if (
        staged.approvalSha256 !== undefined ||
        (current !== undefined &&
          current.packageSha256 !== staged.packageSha256 &&
          current.version >= staged.version)
      ) {
        stop('staged-entry-superseded', { storyId: id })
      }
      const result = await checkStoryRemote(reader, staged, { approval: 'required' })
      if (!result.ok) stop(result.code, { storyId: result.storyId })
      named.push({ entry: staged, approvalSha256: result.approvalSha256 })
      checked.set(id, result.approvalSha256)
      packages.set(id, result.pkg)
    }
    // Every entry N+1 takes from production, in production's order (CRIT-7), each read once.
    const published = new Set([...checked].filter(([, sha]) => sha !== null).map(([id]) => id))
    for (const entry of production?.stories ?? []) {
      if (published.has(entry.storyId)) continue
      const carried = await checkCarriedEntry(reader, entry)
      if (!carried.ok) stop(carried.code, { storyId: carried.storyId })
      packages.set(entry.storyId, carried.pkg)
    }
    const composed = composeProduction({ production, named, feature })
    if (!composed.ok) stop(composed.code, { storyId: composed.storyId })
    const composition = composed.composition
    let state2: FeatureState | null = null
    if (feature === null) {
      state2 = 'cleared'
    } else if (feature !== undefined) {
      checkFeatured(feature, composition, packages)
      state2 = 'set'
    } else if (composition.featuredStoryId !== null) {
      // A featured story kept from production is re-checked only when a named story replaced it.
      if (published.has(composition.featuredStoryId)) {
        checkFeatured(composition.featuredStoryId, composition, packages)
        state2 = 'checked'
      } else {
        state2 = 'kept'
      }
    }
    return { composition, feature: state2, packages }
  }

  /** §4.3 and D15-13: the rollback's checks in order, composeRollback, the featured id. */
  async function planRollback(
    reader: StorageReader,
    state: CatalogueState,
    seq: number,
  ): Promise<Plan> {
    const production = state.production
    if (production === null) stop('production-missing')
    if (!state.seqs.includes(seq)) stop('rollback-snapshot-missing')
    if (seq > production.pointer.seq) stop('rollback-seq-not-older')
    const read = await reader.readContent({ kind: 'snapshot', seq })
    if (read.kind === 'not-found') stop('snapshot-missing')
    if (read.kind !== 'found') stop(failureCode(read.kind))
    const parsed = parseStrictJson(read.bytes, CatalogueSnapshot, 'snapshot')
    if (
      !parsed.ok ||
      !isCanonicalJcs(parsed.value.raw, read.bytes) ||
      parsed.value.data.seq !== seq ||
      !checkPackagePaths(parsed.value.data.stories, 'production', '').ok ||
      !checkUniqueStoryIds(parsed.value.data.stories).ok
    ) {
      stop('rollback-snapshot-invalid')
    }
    const from = parsed.value.data
    for (const entry of from.stories) {
      if (entry.approvalSha256 === undefined) {
        stop('rollback-entry-unapproved', { storyId: entry.storyId })
      }
    }
    const packages = new Map<string, StoryPackageV1>()
    for (const entry of from.stories) {
      const result = await checkStoryRemote(reader, entry, {
        approval: 'required',
        expectApprovalSha256: entry.approvalSha256 ?? '',
      })
      if (!result.ok) stop(result.code, { storyId: result.storyId })
      packages.set(entry.storyId, result.pkg)
    }
    const composition = composeRollback({ production: production.snapshot, from, feature })
    let state2: FeatureState | null = null
    if (feature === null) {
      state2 = 'cleared'
    } else if (feature !== undefined) {
      checkFeatured(feature, composition, packages)
      state2 = 'set'
    } else if (composition.featuredStoryId !== null) {
      checkFeatured(composition.featuredStoryId, composition, packages)
      state2 = 'checked'
    }
    return { composition, feature: state2, packages }
  }

  /**
   * `publish --unpublish <id> [--takedown]` (§4.2, D15B-2 to D15B-7, D15B-28 to D15B-33): the plan
   * through the read-only port, the commit through the unpublish port, the tail and the end.
   */
  async function runUnpublish(storyId: string): Promise<ExitCode> {
    const port = deps.makeUnpublishPort()
    const reader: StorageReader = readOnlyPort(port)
    const read = await readCatalogueState(reader)
    if (!read.ok) stop(read.code)
    const state = read.state
    orphans = state.orphans
    const productionSeq = state.production?.pointer.seq ?? null
    const stagingSeq = state.staging?.pointer.seq ?? null
    section = {
      kind: 'unpublish',
      from: null,
      seq: null,
      productionSeq,
      stagingSeq,
      featuredBefore: state.production?.snapshot.featuredStoryId ?? null,
      featuredAfter: null,
      named: [],
      stories: [],
      snapshotSha256: null,
      pointerSha256: null,
      hook: 'not-run',
      verify: 'not-run',
      liveSeq: null,
    }
    const production = state.production
    if (production === null) stop('production-missing')
    const productionEntry = production.snapshot.stories.find((entry) => entry.storyId === storyId)
    const stagingEntry = state.staging?.snapshot.stories.find((entry) => entry.storyId === storyId)
    const inProduction = productionEntry !== undefined
    const inStaging = stagingEntry !== undefined
    const moves = inProduction ? 'both' : inStaging ? 'staging' : 'none'
    unpublishSection = {
      storyId,
      inProduction,
      inStaging,
      productionMove: inProduction ? 'not-run' : 'not-needed',
      stagingMove: moves === 'none' ? 'not-needed' : 'not-run',
    }
    // D15B-30: in neither pointer, the story's folders must list something.
    if (moves === 'none') {
      let listed = 0
      for (const folder of [`packages/${storyId}/`, `media/${storyId}/`]) {
        const listing = await reader.listContent(folder)
        if (listing.kind !== 'listed') stop(failureCode(listing.kind))
        listed += listing.objects.length
      }
      if (listed === 0) {
        deps.log(formatUnpublishUnknown(storyId))
        stop('unpublish-story-unknown', { storyId })
      }
    }
    const composition = composeUnpublish({ production: production.snapshot, storyId })
    // D15B-2: any empty N+1 is refused (moves both or staging; the neither state builds none).
    if (moves !== 'none' && composition.stories.length === 0) {
      stop('unpublish-last-story', { storyId })
    }
    // D15B-5: every entry of the snapshot the tail verifies, before any write.
    const packages = new Map<string, StoryPackageV1>()
    for (const entry of composition.stories) {
      const carried = await checkCarriedEntry(reader, entry)
      if (!carried.ok) stop(carried.code, { storyId: carried.storyId })
      packages.set(entry.storyId, carried.pkg)
    }
    let takedownPlan: TakedownPlan | null = null
    if (input.takedown) {
      const entry = productionEntry ?? stagingEntry ?? null
      const planned = await planTakedown(reader, storyId, entry, deps.storyboardRoot, deps.realPath)
      if (!planned.ok) {
        updateTakedown({ state: TAKEDOWN_STATE[planned.code] ?? 'not-run' })
        stop(planned.code, { storyId })
      }
      takedownPlan = planned.plan
      updateTakedown({ ...planned.plan.counts, kept: planned.plan.kept.length, state: 'planned' })
    }
    // D15B-31: documents exactly when a pointer moves.
    let documents: ProductionDocuments | null = null
    if (moves !== 'none') {
      const seq = allocateSeq(state)
      if (!seq.ok) stop(seq.code)
      const built = await buildProductionDocuments(composition, seq.seq, deps.now())
      if (!built.ok) stop(built.code)
      documents = built.documents
    }
    update({
      seq: documents?.seq ?? null,
      featuredAfter: composition.featuredStoryId,
      stories: composition.sources.flatMap((source) =>
        source.approvalSha256 === null
          ? []
          : [
              {
                storyId: source.storyId,
                packageSha256: source.packageSha256,
                approvalSha256: source.approvalSha256,
                source: source.source,
              },
            ],
      ),
      snapshotSha256: documents?.snapshot.sha256 ?? null,
      pointerSha256: documents?.pointer.sha256 ?? null,
    })

    // The plan lines (§4.2 step 9; TP-10: the feature line only when it is cleared).
    deps.log(
      formatUnpublishPlan({
        storyId,
        production: inProduction ? 'remove' : 'absent',
        staging: inStaging ? 'remove' : 'absent',
      }),
    )
    if (production.snapshot.featuredStoryId === storyId && composition.featuredStoryId === null) {
      deps.log(formatFeature({ storyId: null, state: 'cleared' }))
    }
    deps.log(
      formatPublishPlan({
        kind: 'unpublish',
        seq: documents?.seq ?? null,
        stories: composition.stories.length,
        production: productionSeq,
        staging: stagingSeq,
        featured: composition.featuredStoryId,
        from: null,
      }),
    )
    if (takedownPlan !== null) deps.log(formatTakedownPlan({ storyId, ...takedownPlan.counts }))
    if (input.dryRun) return finish('dry-run', 'end')

    // The commit (§4.2 step 10): production, then staging; recorded conditions go on to the tail.
    const conditions: string[] = []
    let productionMoved = false
    if (documents !== null) {
      phase = 'commit'
      const writer = trackedUnpublish(port)
      const snapshot = await createSnapshot(writer, documents.seq, documents.snapshot, {
        sleep: deps.sleep,
      })
      if (!snapshot.ok) stop(snapshot.code)
      deps.log(
        formatPublishSnapshot({
          seq: documents.seq,
          sha256: documents.snapshot.sha256,
          result: snapshot.result,
        }),
      )
      const built = {
        seq: documents.seq,
        bytes: documents.pointer.bytes,
        sha256: documents.pointer.sha256,
      }
      const stagingBefore = state.staging?.sha256 ?? null
      if (moves === 'both') {
        const moved = await movePointer(
          writer,
          'production',
          built,
          { production: production.sha256, staging: stagingBefore },
          deps.now,
        )
        if (moved.ok) {
          deps.log(formatProductionMoved(built.seq))
        } else if (moved.code === 'pointer-raced') {
          // D15B-28: our bytes were read back; the withdrawal is in the pointer.
          conditions.push('pointer-raced')
        } else {
          updateUnpublish({ productionMove: 'failed' })
          stop(moved.code, {}, moved.afterWrite ? 'pointer' : 'commit')
        }
        productionMoved = true
        updateUnpublish({ productionMove: 'moved' })
      }
      const staged = await movePointer(
        writer,
        'staging',
        built,
        {
          production: productionMoved ? built.sha256 : production.sha256,
          staging: stagingBefore,
        },
        deps.now,
      )
      if (staged.ok) {
        deps.log(formatStagingMoved(built.seq))
        updateUnpublish({ stagingMove: 'moved' })
      } else {
        updateUnpublish({ stagingMove: 'failed' })
        // D15B-4: deferred after production moved; a stop in the staging-only state.
        if (!productionMoved) stop(staged.code, {}, staged.afterWrite ? 'pointer' : 'commit')
        deps.log(formatStagingNotMoved(staged.code))
        conditions.push('staging-not-moved')
      }
    }
    const expectedSeq =
      productionMoved && documents !== null ? documents.seq : production.pointer.seq
    const recovery = () => deps.log(formatUnpublishRecovery(storyId, input.takedown))

    // The tail (D15B-7): hook, verify with the story absent, takedown, range.
    phase = 'tail'
    hookCalls += 1
    const hooked = await deps.tail.hook()
    update({ hook: hooked })
    if (hooked === 'failed') {
      deps.log(formatStopped('publish', 'hook-failed'))
      recovery()
      return finish('hook-failed', 'tail')
    }
    const verified = await deps.tail.verify(expectedSeq, [storyId])
    update({ verify: verified.kind })
    if (verified.kind === 'timeout') {
      deps.log(formatStopped('publish', 'verify-timeout'))
      deps.log(timeoutLine(expectedSeq, production.pointer.seq, verified.lastSeq))
      recovery()
      return finish('verify-timeout', 'tail')
    }
    update({ liveSeq: verified.seq })
    deps.log(verified.kind === 'live' ? formatLive(verified.seq) : formatSuperseded(verified.seq))
    deps.log(formatNoRollback(expectedSeq, storyId))
    let kept = 0
    let takenDown = false
    if (takedownPlan !== null) {
      phase = 'takedown'
      const result = await commitTakedown(
        reader,
        deps.makeRemover,
        takedownPlan,
        deps.storyboardRoot,
        {
          onChunk: (removed, total) => deps.log(formatTakedownRemoved({ storyId, removed, total })),
        },
        deps.realPath,
      )
      if (!result.ok) {
        updateTakedown({ removed: result.removed, state: TAKEDOWN_STATE[result.code] ?? 'not-run' })
        deps.log(formatStopped('publish', result.code, { storyId }))
        recovery()
        return finish(result.code, 'takedown')
      }
      kept = result.kept.length
      updateTakedown({ removed: result.removed, kept, state: kept > 0 ? 'mp3-kept' : 'removed' })
      if (result.removed > 0) {
        deps.log(formatTakedownDone({ storyId, removed: result.removed, kept }))
        deps.log(TAKEDOWN_LAG_NOTE)
      }
      if (kept > 0) conditions.push('takedown-mp3-kept')
      else takenDown = true
    }
    const rangeFailed = await rangeStep(composition.stories, packages, expectedSeq)

    // The end (D15B-32).
    const final = rangeFailed ? 'range-check-failed' : (conditions[0] ?? null)
    if (final === null) {
      const outcome = takenDown
        ? 'taken-down'
        : verified.kind === 'superseded'
          ? 'verify-superseded'
          : moves !== 'none'
            ? 'unpublished'
            : 'rebuilt'
      return finish(outcome, 'end')
    }
    const named = final === 'staging-not-moved' || final === 'takedown-mp3-kept'
    deps.log(formatStopped('publish', final, named ? { storyId } : {}))
    if (kept > 0) deps.log(formatMp3Kept({ storyId, kept }))
    if (conditions.length > 0) recovery()
    if (rangeFailed) deps.log(RANGE_RECOVERY)
    const at: Phase =
      final === 'takedown-mp3-kept'
        ? 'takedown'
        : final === 'range-check-failed'
          ? 'tail'
          : 'pointer'
    return finish(final, at)
  }

  try {
    if (unpublishId !== null) return await runUnpublish(unpublishId)
    // The plan (§4.2 step 2), through the read-only port.
    const port = deps.makePort()
    const reader: StorageReader = readOnlyPort(port)
    const read = await readCatalogueState(reader)
    if (!read.ok) stop(read.code)
    const state = read.state
    orphans = state.orphans
    const productionSeq = state.production?.pointer.seq ?? null
    const stagingSeq = state.staging?.pointer.seq ?? null
    section = {
      kind,
      from: input.snapshot,
      seq: null,
      productionSeq,
      stagingSeq,
      featuredBefore: state.production?.snapshot.featuredStoryId ?? null,
      featuredAfter: null,
      named: [],
      stories: [],
      snapshotSha256: null,
      pointerSha256: null,
      hook: 'not-run',
      verify: 'not-run',
      liveSeq: null,
    }
    const plan =
      input.snapshot === null
        ? await planPublish(reader, state)
        : await planRollback(reader, state, input.snapshot)
    const composition = plan.composition

    // The documents (§4.2 step 7), unless the content equals production's.
    let documents: ProductionDocuments | null = null
    if (!composition.unchanged) {
      const seq = allocateSeq(state)
      if (!seq.ok) stop(seq.code)
      const built = await buildProductionDocuments(composition, seq.seq, deps.now())
      if (!built.ok) stop(built.code)
      documents = built.documents
    }
    const named = composition.named.map((outcome) => ({
      storyId: outcome.storyId,
      packageSha256: outcome.packageSha256,
      version: outcome.version,
      approvalSha256: outcome.approvalSha256,
      state: outcome.state,
    }))
    update({
      seq: documents?.seq ?? null,
      featuredAfter: composition.featuredStoryId,
      named,
      stories: composition.sources.flatMap((source) =>
        source.approvalSha256 === null
          ? []
          : [
              {
                storyId: source.storyId,
                packageSha256: source.packageSha256,
                approvalSha256: source.approvalSha256,
                source: source.source,
              },
            ],
      ),
      snapshotSha256: documents?.snapshot.sha256 ?? null,
      pointerSha256: documents?.pointer.sha256 ?? null,
    })

    // The plan lines (§4.7).
    for (const line of named) deps.log(formatPublishStory(line))
    if (plan.feature !== null) {
      deps.log(
        formatFeature({
          storyId: plan.feature === 'cleared' ? null : composition.featuredStoryId,
          state: plan.feature,
        }),
      )
    }
    deps.log(
      formatPublishPlan({
        kind,
        seq: documents?.seq ?? null,
        stories: composition.stories.length,
        production: productionSeq,
        staging: stagingSeq,
        featured: composition.featuredStoryId,
        from: input.snapshot,
      }),
    )
    if (input.dryRun) return finish('dry-run', 'end')

    // The commit (§4.2 step 9): exit 3 until the pointer write is sent, 4 after it.
    let liveSeq = productionSeq
    if (documents !== null) {
      phase = 'commit'
      const writer = tracked(port)
      const snapshot = await createSnapshot(writer, documents.seq, documents.snapshot, {
        sleep: deps.sleep,
      })
      if (!snapshot.ok) stop(snapshot.code)
      deps.log(
        formatPublishSnapshot({
          seq: documents.seq,
          sha256: documents.snapshot.sha256,
          result: snapshot.result,
        }),
      )
      const moved = await movePointer(
        writer,
        'production',
        { seq: documents.seq, bytes: documents.pointer.bytes, sha256: documents.pointer.sha256 },
        {
          production: state.production?.sha256 ?? null,
          staging: state.staging?.sha256 ?? null,
        },
        deps.now,
      )
      if (!moved.ok) stop(moved.code, {}, moved.afterWrite ? 'pointer' : 'commit')
      deps.log(formatProductionMoved(documents.seq))
      liveSeq = documents.seq
    }
    if (liveSeq === null) stop('internal', { errorName: 'Error' })
    const expectedSeq = liveSeq

    // The tail (§4.5, D15-11, D15B-7): phase tail from the hook call on; hook, verify, range.
    let outcome = composition.unchanged ? 'rebuilt' : 'published'
    phase = 'tail'
    hookCalls += 1
    const hooked = await deps.tail.hook()
    update({ hook: hooked })
    if (hooked === 'failed') {
      deps.log(formatStopped('publish', 'hook-failed'))
      deps.log(formatRecovery(expectedSeq))
      return finish('hook-failed', 'tail')
    }
    const verified = await deps.tail.verify(expectedSeq)
    update({ verify: verified.kind })
    if (verified.kind === 'timeout') {
      deps.log(formatStopped('publish', 'verify-timeout'))
      deps.log(timeoutLine(expectedSeq, productionSeq, verified.lastSeq))
      deps.log(formatRecovery(expectedSeq))
      return finish('verify-timeout', 'tail')
    }
    update({ liveSeq: verified.seq })
    if (verified.kind === 'live') {
      deps.log(formatLive(verified.seq))
    } else {
      deps.log(formatSuperseded(verified.seq))
      outcome = 'verify-superseded'
    }
    if (await rangeStep(composition.stories, plan.packages, expectedSeq)) {
      deps.log(formatStopped('publish', 'range-check-failed'))
      deps.log(RANGE_RECOVERY)
      return finish('range-check-failed', 'tail')
    }
    return finish(outcome, 'end')
  } catch (thrown) {
    if (thrown instanceof Stop) {
      deps.log(formatStopped('publish', thrown.code, thrown.detail))
      // D15B-32: an unpublish stop at exit 4 is followed by its recovery line (none after exit 3).
      if (unpublishId !== null && exitForPhase(thrown.code, thrown.phase) === 4) {
        deps.log(formatUnpublishRecovery(unpublishId, input.takedown))
      }
      return finish(thrown.code, thrown.phase)
    }
    if (isStorageRefusal(thrown)) {
      deps.log(formatStopped('publish', 'client-refused', { refusal: thrown.message }))
      if (unpublishId !== null && exitForPhase('client-refused', phase) === 4) {
        deps.log(formatUnpublishRecovery(unpublishId, input.takedown))
      }
      return finish('client-refused', phase)
    }
    deps.log(formatStopped('publish', 'internal', { errorName: internalName(thrown) }))
    return finish('internal', phase)
  }
}
