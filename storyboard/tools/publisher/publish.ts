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
//   production only; staging is never written.
// - The tail, after the pointer moved or after an unchanged plan, never after a stop (D15-11): one
//   hook (never retried), then verify; hook-failed and verify-timeout exit 4 with the recovery line
//   (and, after a timeout, the Instant Rollback hint). From the hook call on the phase is tail, so a
//   throw there is internal at exit 4, the report written and the hook never called again.
// - Output only through deps.log and deps.error, in report.ts's fixed formats: ids, hashes, counts,
//   seqs and codes; a record body, a check's reason or a thrown message is never printed. A client
//   refusal is recognised only by isStorageRefusal. The hook and verify come in as deps.tail, so this
//   module never reaches a network module itself.
import { checkPackagePaths, isCanonicalJcs, parseStrictJson } from '../../src/core/content/gates'
import { checkUniqueStoryIds } from '../../src/core/content/packages'
import { CatalogueSnapshot } from '../../src/core/package/catalogue'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import {
  allocateSeq,
  buildProductionDocuments,
  composeProduction,
  composeRollback,
  createSnapshot,
  movePointer,
  readCatalogueState,
  sameEntry,
  type CatalogueState,
  type NamedProductionEntry,
  type ProductionComposition,
  type ProductionDocuments,
} from './catalogue-state'
import { isStorageRefusal, readOnlyPort, type PublishPort, type StorageReader } from './port'
import {
  VERIFY_TIMEOUT_HINT,
  exitForPhase,
  formatFeature,
  formatFeatureCounts,
  formatLive,
  formatProductionMoved,
  formatPublishPlan,
  formatPublishSnapshot,
  formatPublishStory,
  formatRecovery,
  formatStopped,
  formatSuperseded,
  internalName,
  type CheckedReportDir,
  type ExitCode,
  type Phase,
  type ReportInput,
  type ReportPublish,
  type StopDetail,
} from './report'
import { checkCarriedEntry, checkStoryRemote, featureCheck } from './remote-checks'
import { Stop, failureCode, openReportDir, writeRunReport } from './run-kit'

const RULESET = PANCHATANTRA_RULESET

/** What verify answered: the expected seq or a later one live, or no confirmation in time. */
export type VerifyAnswer =
  { readonly kind: 'live' | 'superseded'; readonly seq: number } | { readonly kind: 'timeout' }

/**
 * The tail's two functions (TP-7), adapted by cli.ts from hook.ts and verify.ts. `absentStoryIds`
 * is for Step 15b's unpublish; publish and rollback never pass it.
 */
export interface PublishTail {
  readonly hook: () => Promise<'triggered' | 'failed'>
  readonly verify: (
    expectedSeq: number,
    absentStoryIds?: readonly string[],
  ) => Promise<VerifyAnswer>
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
  /** Builds the client; called once. */
  readonly makePort: () => PublishPort
  readonly tail: PublishTail
}

/** The plan kinds (D15-24); Step 15b adds unpublish with its own composition. */
type PlanKind = 'publish' | 'rollback'
/** The tail's steps in order (D15-24); Step 15b appends the Range check after verify. */
const TAIL_STEPS = ['hook', 'verify'] as const

type FeatureState = 'set' | 'cleared' | 'kept' | 'checked'

interface Plan {
  readonly composition: ProductionComposition
  readonly feature: FeatureState | null
}

/** The publish command (§4.2, §4.3): exit 0 published, rebuilt, verify-superseded or dry-run. */
export async function runPublish(input: PublishInput, deps: PublishDeps): Promise<ExitCode> {
  let realDir: CheckedReportDir | null = null
  if (deps.runMode === 'pc') {
    realDir = openReportDir('publish', input.reportDir, input.reportDirGiven, deps)
    if (realDir === null) return 2
  }
  const startedAt = deps.now().toISOString()
  const mode = input.dryRun ? 'dry-run' : 'publish'
  const kind: PlanKind = input.snapshot === null ? 'publish' : 'rollback'
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
    return { composition, feature: state2 }
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
    return { composition, feature: state2 }
  }

  try {
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

    // The tail (§4.5, D15-11): phase tail from the hook call on.
    let outcome = composition.unchanged ? 'rebuilt' : 'published'
    for (const step of TAIL_STEPS) {
      phase = 'tail'
      if (step === 'hook') {
        hookCalls += 1
        const hooked = await deps.tail.hook()
        update({ hook: hooked })
        if (hooked === 'failed') {
          deps.log(formatStopped('publish', 'hook-failed'))
          deps.log(formatRecovery(expectedSeq))
          return finish('hook-failed', 'tail')
        }
        continue
      }
      const verified = await deps.tail.verify(expectedSeq)
      update({ verify: verified.kind })
      if (verified.kind === 'timeout') {
        deps.log(formatStopped('publish', 'verify-timeout'))
        deps.log(VERIFY_TIMEOUT_HINT)
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
    }
    return finish(outcome, 'end')
  } catch (thrown) {
    if (thrown instanceof Stop) {
      deps.log(formatStopped('publish', thrown.code, thrown.detail))
      return finish(thrown.code, thrown.phase)
    }
    if (isStorageRefusal(thrown)) {
      deps.log(formatStopped('publish', 'client-refused', { refusal: thrown.message }))
      return finish('client-refused', phase)
    }
    deps.log(formatStopped('publish', 'internal', { errorName: internalName(thrown) }))
    return finish('internal', phase)
  }
}
