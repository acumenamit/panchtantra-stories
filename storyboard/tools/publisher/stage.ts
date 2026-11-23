// The publisher's validate and stage commands (design migration-input/p1-step14-design.md §4.1 to
// §4.5, §4.8, §4.9, §5, D14-3, D14-6 to D14-8, D14-15, D14-18, D14-21, D23-1, D23-2; P1-8c, Step 14).
// - validate: the local checks of every story, both reports, exit 0 or 1; no Storage, no env file.
// - stage: the local checks first (a blocked story stops before any client exists); then the plan
//   through readOnlyPort (the catalogue state, the waivers from masters, the composition, the
//   per-story listings, the documents and the build's gates); a dry run stops there; the commit
//   uploads media then packages one at a time, verifies them by listing, creates the snapshot with
//   its read-back and moves the staging pointer (never production).
// - Before any other work, the report dir is checked once (run-kit openReportDir; D14-25, Step 15a
//   D15-22, D15-29): a real path at or under public/ or app/, or not on a local drive, is a usage
//   stop (exit 2, no report). Every later exit writes the report into that checked real dir
//   (run-kit writeRunReport, which re-checks it); a code's exit follows its phase. The commit
//   deadline is checked before every commit request (D14-8).
// - Output only through deps.log and deps.error, in report.ts's fixed formats: ids, counts, hashes
//   and codes. A client refusal is recognised only by isStorageRefusal; any other throw prints its
//   class name.
// - Step 17 (migration-input/p1-step17-design.md §3.19, §3.20, D17-19, D17-20, TP17-8; P1-9a):
//   after formatPlan's line, `stage: plan plan=<64> set=<64>` (plan-digest.ts over the planned
//   objects with their states, the named stories as fixed, and the seqs and states as variable);
//   `--expect-plan`, when given, is compared there, before any write and in a dry run too
//   (plan-changed, exit 1). Without it stage behaves as at Step 14 (L20-1).
import { MEDIA_MAX_BYTES } from '../../src/core/content/media'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { sha256Hex } from '../../src/core/hashing'
import { StoryId } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import {
  allocateSeq,
  buildStagingDocuments,
  composeStaging,
  createSnapshot,
  createWithRetry,
  movePointer,
  readCatalogueState,
  type StagingDocuments,
} from './catalogue-state'
import { listLocalFolder, readLocalFile } from './local-files'
import { planDigests } from './plan-digest'
import { isStorageRefusal, readOnlyPort, type StagePort, type StorageReader } from './port'
import {
  REVIEW_LINE,
  exitForPhase,
  formatPlan,
  formatPlanDigest,
  formatPointerMoved,
  formatSnapshot,
  formatStageCarried,
  formatStageStory,
  formatStopped,
  formatStoryMessage,
  formatValidateStory,
  formatValidateSummary,
  internalName,
  type ExitCode,
  type Phase,
  type ReportInput,
  type ReportPlan,
  type ReportStory,
  type StopDetail,
} from './report'
import { Stop, WAIVER_READ_CODE, failureCode, openReportDir, writeRunReport } from './run-kit'
import { MAX_JSON_BYTES, classOfPath, type MediaRef } from './storage-layout'
import { checkStories, deriveWaiverBlock, loadPrivateLists, type LocalStory } from './story-checks'

/** The whole commit, measured on deps.now from its start (D14-8). */
export const STAGE_DEADLINE_MS = 3_600_000
const RULESET = PANCHATANTRA_RULESET
const PACKAGE_MIME = 'application/json'
const ZERO_COUNTS = { errors: 0, waived: 0, lapsed: 0, warnings: 0, info: 0, unusedKeys: 0 }

/** What validate needs from the parsed arguments (args.ts). */
export interface ValidateInput {
  readonly all: boolean
  readonly ids: readonly string[]
  readonly packages: string
  readonly media: string
  readonly waivers: string
  readonly reportDir: string
  /** True when --report-dir was given (the not-local reason names the flag or the default). */
  readonly reportDirGiven: boolean
}

/** What stage needs from the parsed arguments (the timeout goes to the client, in cli.ts). */
export interface StageInput {
  readonly ids: readonly string[]
  readonly packages: string
  readonly media: string
  readonly waivers: string
  readonly reportDir: string
  readonly reportDirGiven: boolean
  readonly dryRun: boolean
  /** Step 17 (D17-20): the reviewed plan digest, compared before any write; null when not given. */
  readonly expectPlan: string | null
}

export interface ValidateDeps {
  readonly storyboardRoot: string
  /** The platform the run reports; win32 compares the report dir's real path without case. */
  readonly platform: string
  readonly now: () => Date
  readonly log: (line: string) => void
  readonly error: (line: string) => void
}

export interface StageDeps extends ValidateDeps {
  readonly sleep: (ms: number) => Promise<void>
  /** Builds the client; called once, only after every local check passed (§4.3 step 3). */
  readonly makePort: () => StagePort
}

/** `--all`: exact `<StoryId>.json` names, case-sensitive (TP-7); any other name is ignored. */
export function selectStoryFiles(names: readonly string[]): { ids: string[]; ignored: number } {
  const ids: string[] = []
  let ignored = 0
  for (const name of names) {
    const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : ''
    if (StoryId.safeParse(id).success) ids.push(id)
    else ignored += 1
  }
  return { ids, ignored }
}

const inputsOf = (
  input: { readonly packages: string; readonly media: string; readonly waivers: string },
  privateData: Parameters<typeof checkStories>[1]['privateData'],
) => ({
  packagesDir: input.packages,
  mediaDir: input.media,
  waiversDir: input.waivers,
  privateData,
})

/** A story for the report (§4.9); media states default to the local checks'. */
function reportStoryOf(story: LocalStory, states: ReadonlyMap<string, string>): ReportStory {
  const verdict = story.verdict
  return {
    storyId: story.storyId,
    packageSha256: story.packageSha256,
    version: story.pkg?.version ?? null,
    origin: story.pkg?.origin ?? null,
    verdict: story.blocking === null ? 'ok' : 'blocked',
    blocking: story.blocking,
    counts: verdict?.counts ?? ZERO_COUNTS,
    findings: verdict?.findings ?? [],
    skipped: verdict?.skipped ?? [],
    waiver:
      story.waiver === null
        ? null
        : { waiverFileSha256: story.waiver.sha256, keys: story.waiver.block.keys.length },
    media: story.media.map((m) => ({
      path: m.path,
      mime: m.mime,
      bytes: m.bytes,
      sha256: m.sha256,
      state: states.get(m.path) ?? m.state,
    })),
  }
}

// ---- validate (§4.1) ----

/** The validate command: local checks only; exit 0 (every story stageable), 1 or 2. */
export async function runValidate(input: ValidateInput, deps: ValidateDeps): Promise<ExitCode> {
  const realDir = openReportDir('validate', input.reportDir, input.reportDirGiven, deps)
  if (realDir === null) return 2
  const startedAt = deps.now().toISOString()
  let ids: readonly string[] = input.ids
  let ignored: number | undefined
  if (input.all) {
    const listed = listLocalFolder(input.packages)
    const selected = listed.ok ? selectStoryFiles(listed.names) : { ids: [], ignored: 0 }
    ids = selected.ids
    ignored = selected.ignored
  }
  if (ids.length === 0) {
    deps.log(formatStopped('validate', 'usage'))
    return 2
  }
  let stories: LocalStory[] = []
  let privateState: 'loaded' | 'not loaded' = 'not loaded'
  const finish = (outcome: string, exitCode: ExitCode): ExitCode => {
    const report: ReportInput = {
      command: 'validate',
      mode: 'validate',
      startedAt,
      finishedAt: deps.now().toISOString(),
      outcome,
      exitCode,
      writes: 0,
      uploaded: [],
      skipped: [],
      orphans: [],
      superseded: [],
      ruleSetRef: RULESET.ref,
      privateWordLists: privateState,
      stories: stories.map((story) => reportStoryOf(story, new Map())),
    }
    return writeRunReport('validate', realDir, report, input.reportDirGiven, deps) ? exitCode : 2
  }
  try {
    const lists = loadPrivateLists(deps.storyboardRoot)
    if (!lists.ok) {
      deps.log(formatStopped('validate', lists.code))
      return finish(lists.code, 2)
    }
    privateState = lists.state
    stories = await checkStories(ids, inputsOf(input, lists.data))
    for (const story of stories) {
      deps.log(
        formatValidateStory({
          storyId: story.storyId,
          packageSha256: story.packageSha256,
          version: story.pkg?.version ?? null,
          counts: story.verdict?.counts ?? ZERO_COUNTS,
          media: story.media.filter((m) => m.state === 'checked').length,
          blocking: story.blocking,
        }),
      )
      if (story.message !== null) deps.log(formatStoryMessage('validate', story.message))
    }
    const ok = stories.filter((story) => story.blocking === null).length
    deps.log(formatValidateSummary(ok, stories.length, ignored))
    return ok === stories.length ? finish('ok', 0) : finish('blocked', 1)
  } catch (thrown) {
    deps.log(formatStopped('validate', 'internal', { errorName: internalName(thrown) }))
    return finish('internal', 1)
  }
}

// ---- stage (§4.3, §4.4) ----

/** A copy sorted by storyId in UTF-16 code units, so the CLI order of the ids never moves a digest. */
const byStoryId = <T extends { readonly storyId: string }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0))

interface PlannedObject {
  readonly storyId: string
  readonly kind: 'media' | 'package'
  readonly path: string
  readonly bytes: number
  readonly mime: string
  readonly sha256: string
  readonly ref: MediaRef | null
}

/** The stage command: plan, then the dry run or the commit; exits by phase (§5). */
export async function runStage(input: StageInput, deps: StageDeps): Promise<ExitCode> {
  const realDir = openReportDir('stage', input.reportDir, input.reportDirGiven, deps)
  if (realDir === null) return 2
  const startedAt = deps.now().toISOString()
  const mode = input.dryRun ? 'dry-run' : 'stage'
  let phase: Phase = 'local'
  let writes = 0
  let privateState: 'loaded' | 'not loaded' = 'not loaded'
  let stories: LocalStory[] = []
  let plan: ReportPlan | null = null
  let orphans: readonly number[] = []
  let superseded: { storyId: string; packageSha256: string }[] = []
  const uploaded: string[] = []
  const skipped: string[] = []
  const mediaStates = new Map<string, string>()

  const report = (outcome: string, exitCode: ExitCode): ReportInput => ({
    command: 'stage',
    mode,
    startedAt,
    finishedAt: deps.now().toISOString(),
    outcome,
    exitCode,
    writes,
    uploaded,
    skipped,
    orphans,
    superseded,
    ruleSetRef: RULESET.ref,
    privateWordLists: privateState,
    stories: stories.map((story) => reportStoryOf(story, mediaStates)),
    plan,
  })
  const finish = (code: string, at: Phase): ExitCode => {
    const exitCode = exitForPhase(code, at)
    if (writeRunReport('stage', realDir, report(code, exitCode), input.reportDirGiven, deps)) {
      return exitCode
    }
    return writes === 0 ? 2 : exitCode
  }
  function stop(code: string, detail: StopDetail = {}, at: Phase = phase): never {
    throw new Stop(code, detail, at)
  }
  /** A checked story without what its local checks set: a defect, printed as internal Error. */
  function defect(): never {
    return stop('internal', { errorName: 'Error' })
  }

  /** The commit holds the port through this wrapper: it counts writes and marks the pointer phase. */
  const tracked = (port: StagePort): StagePort => ({
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

  try {
    // Local checks (§4.3 step 2): nothing is built or read remotely before every story passes.
    const lists = loadPrivateLists(deps.storyboardRoot)
    if (!lists.ok) stop(lists.code, {}, 'configuration')
    privateState = lists.ok ? lists.state : 'not loaded'
    stories = await checkStories(input.ids, inputsOf(input, lists.ok ? lists.data : null))
    const blocked = stories.filter((story) => story.blocking !== null)
    for (const story of blocked) {
      deps.log(formatStopped('stage', story.blocking ?? '', { storyId: story.storyId }))
      if (story.message !== null) deps.log(formatStoryMessage('stage', story.message))
    }
    if (blocked.length > 0) return finish(blocked[0]?.blocking ?? 'internal', 'local')

    // The plan (§4.3 steps 3 to 9), through the read-only port (D23-2, TP-12).
    phase = 'plan'
    const port = deps.makePort()
    const reader: StorageReader = readOnlyPort(port)
    const read = await readCatalogueState(reader)
    if (!read.ok) stop(read.code)
    const state = read.state
    orphans = state.orphans

    const named: SnapshotEntry[] = []
    for (const story of stories) {
      const entry = story.entry
      if (entry === null) defect()
      if (story.waiver === null) {
        named.push(entry)
        continue
      }
      const master = await reader.readMaster({
        kind: 'waiver',
        storyId: story.storyId,
        waiverSha256: story.waiver.sha256,
      })
      if (master.kind !== 'found') {
        stop(WAIVER_READ_CODE[master.kind] ?? 'storage-failed', { storyId: story.storyId })
      }
      const derived = await deriveWaiverBlock(story.storyId, master.bytes)
      if (!derived.ok) stop(derived.code, { storyId: story.storyId })
      named.push({ ...entry, waivers: derived.waiver.block })
    }

    const composed = composeStaging({
      production: state.production?.snapshot ?? null,
      staging: state.staging?.snapshot ?? null,
      named,
    })
    if (!composed.ok) stop(composed.code, { storyId: composed.storyId })
    const composition = composed.composition
    superseded = composition.carried
      .filter((c) => c.state === 'superseded')
      .map((c) => ({ storyId: c.storyId, packageSha256: c.packageSha256 }))

    // Existing objects (D14-7): planned objects of the named stories, then carried packages.
    const planned: PlannedObject[] = []
    for (const story of stories) {
      const entry = story.entry
      const bytes = story.packageBytes
      if (entry === null || bytes === null || story.packageSha256 === null) defect()
      for (const media of story.media) {
        const found = classOfPath('content', media.path)
        if (found?.kind !== 'media') stop('media-plan', { storyId: story.storyId })
        const fields = found.fields
        planned.push({
          storyId: story.storyId,
          kind: 'media',
          path: media.path,
          bytes: media.bytes,
          mime: media.mime,
          sha256: media.sha256,
          ref: {
            kind: 'media',
            storyId: String(fields.storyId),
            sha256: String(fields.sha256),
            variant: String(fields.variant),
            mime: media.mime,
          },
        })
      }
      planned.push({
        storyId: story.storyId,
        kind: 'package',
        path: entry.packagePath,
        bytes: bytes.byteLength,
        mime: PACKAGE_MIME,
        sha256: story.packageSha256,
        ref: null,
      })
    }
    const fresh = new Set<string>()
    for (const story of stories) {
      const listed = new Map<string, { size: number | null; mimetype: string | null }>()
      for (const folder of [`media/${story.storyId}/`, `packages/${story.storyId}/`]) {
        const listing = await reader.listContent(folder)
        if (listing.kind !== 'listed') stop(failureCode(listing.kind), { storyId: story.storyId })
        for (const object of listing.objects) listed.set(object.path, object)
      }
      for (const object of planned.filter((p) => p.storyId === story.storyId)) {
        const existing = listed.get(object.path)
        if (existing === undefined) {
          fresh.add(object.path)
          continue
        }
        if (existing.size === null || existing.mimetype === null) {
          stop('existing-object-unverifiable', { storyId: story.storyId })
        }
        if (existing.size !== object.bytes || existing.mimetype !== object.mime) {
          stop('existing-object-differs', { storyId: story.storyId })
        }
      }
    }
    const namedIds = new Set(stories.map((story) => story.storyId))
    for (const entry of composition.stories) {
      if (namedIds.has(entry.storyId)) continue
      const listing = await reader.listContent(`packages/${entry.storyId}/`)
      if (listing.kind !== 'listed') stop(failureCode(listing.kind), { storyId: entry.storyId })
      if (!listing.objects.some((object) => object.path === entry.packagePath)) {
        stop('carried-package-missing', { storyId: entry.storyId })
      }
    }
    for (const object of planned) {
      const isFresh = fresh.has(object.path)
      if (!isFresh) skipped.push(object.path)
      if (object.kind === 'media') mediaStates.set(object.path, isFresh ? 'new' : 'skipped')
    }

    let documents: StagingDocuments | null = null
    if (!composition.unchanged) {
      const seq = allocateSeq(state)
      if (!seq.ok) stop(seq.code)
      const built = await buildStagingDocuments(composition, seq.seq, deps.now())
      if (!built.ok) stop(built.code)
      documents = built.documents
    }
    plan = {
      seq: documents?.seq ?? null,
      productionSeq: state.production?.pointer.seq ?? null,
      stagingSeq: state.staging?.pointer.seq ?? null,
      gaps: state.gaps,
      stories: composition.sources,
      snapshotSha256: documents?.snapshot.sha256 ?? null,
      pointerSha256: documents?.pointer.sha256 ?? null,
    }

    // The plan lines (§4.8).
    for (const outcome of composition.named) {
      const story = stories.find((s) => s.storyId === outcome.storyId)
      const own = planned.filter((p) => p.storyId === outcome.storyId)
      const media = own.filter((p) => p.kind === 'media')
      deps.log(
        formatStageStory({
          storyId: outcome.storyId,
          packageSha256: outcome.packageSha256,
          version: outcome.version,
          state: outcome.state,
          mediaNew: media.filter((p) => fresh.has(p.path)).length,
          mediaSkipped: media.filter((p) => !fresh.has(p.path)).length,
          bytes: own.filter((p) => fresh.has(p.path)).reduce((sum, p) => sum + p.bytes, 0),
          waiverKeys: story?.waiver?.block.keys.length ?? 0,
        }),
      )
    }
    for (const carried of composition.carried) deps.log(formatStageCarried(carried))
    deps.log(
      formatPlan({
        seq: plan.seq,
        stories: composition.stories.length,
        objectsNew: fresh.size,
        objectsSkipped: planned.length - fresh.size,
        orphans: state.orphans.length,
        production: plan.productionSeq,
        staging: plan.stagingSeq,
      }),
    )
    // The plan digests (D17-20): the objects with their states, the named stories as fixed, the
    // seqs and the composition's states as variable; compared before any write, dry run included.
    const digests = await planDigests(
      'stage',
      planned.map((object) => ({
        path: object.path,
        sha256: object.sha256,
        bytes: object.bytes,
        contentType: object.mime,
        state: fresh.has(object.path) ? 'new' : 'existing',
      })),
      {
        fixed: byStoryId(
          composition.named.map((named) => ({
            storyId: named.storyId,
            packageSha256: named.packageSha256,
            version: named.version,
          })),
        ),
        variable: {
          seq: plan.seq,
          productionSeq: plan.productionSeq,
          stagingSeq: plan.stagingSeq,
          named: byStoryId(
            composition.named.map((named) => ({ storyId: named.storyId, state: named.state })),
          ),
          carried: byStoryId(
            composition.carried.map((carried) => ({
              storyId: carried.storyId,
              packageSha256: carried.packageSha256,
              state: carried.state,
            })),
          ),
        },
      },
    )
    deps.log(formatPlanDigest('stage', digests))
    if (input.expectPlan !== null && input.expectPlan !== digests.plan) stop('plan-changed')
    if (input.dryRun) return finish('dry-run', 'end')

    // The commit (§4.4): exit 3 until the pointer write is sent, 4 after it.
    phase = 'commit'
    const writer = tracked(port)
    const started = deps.now().getTime()
    const deadlinePassed = () => deps.now().getTime() - started > STAGE_DEADLINE_MS
    const options = { sleep: deps.sleep, deadlinePassed }
    const uploads = [
      ...planned.filter((p) => p.kind === 'media' && fresh.has(p.path)),
      ...planned.filter((p) => p.kind === 'package' && fresh.has(p.path)),
    ]
    for (const object of uploads) {
      if (deadlinePassed()) stop('deadline')
      const local =
        object.kind === 'media'
          ? readLocalFile(input.media, object.path.split('/'), MEDIA_MAX_BYTES)
          : readLocalFile(input.packages, [`${object.storyId}.json`], MAX_JSON_BYTES)
      const same =
        local.ok &&
        local.bytes.byteLength === object.bytes &&
        (await sha256Hex(local.bytes)) === object.sha256
      if (!local.ok || !same) stop('local-file-changed', { storyId: object.storyId })
      const ref = object.ref ?? {
        kind: 'package' as const,
        storyId: object.storyId,
        packageSha256: object.sha256,
      }
      const created = await createWithRetry(writer, ref, local.bytes, options)
      if (!created.ok) {
        stop(created.code, created.code === 'deadline' ? {} : { storyId: object.storyId })
      }
      uploaded.push(object.path)
      if (object.kind === 'media') mediaStates.set(object.path, 'uploaded')
    }
    for (const story of stories) {
      const listed = new Map<string, { size: number | null; mimetype: string | null }>()
      for (const folder of [`media/${story.storyId}/`, `packages/${story.storyId}/`]) {
        if (deadlinePassed()) stop('deadline')
        const listing = await writer.listContent(folder)
        if (listing.kind !== 'listed') stop(failureCode(listing.kind), { storyId: story.storyId })
        for (const object of listing.objects) listed.set(object.path, object)
      }
      for (const object of planned.filter((p) => p.storyId === story.storyId)) {
        const found = listed.get(object.path)
        if (found?.size !== object.bytes || found.mimetype !== object.mime) {
          stop('upload-verify-failed', { storyId: story.storyId })
        }
      }
    }
    if (documents !== null) {
      if (deadlinePassed()) stop('deadline')
      const snapshot = await createSnapshot(writer, documents.seq, documents.snapshot, options)
      if (!snapshot.ok) stop(snapshot.code)
      deps.log(
        formatSnapshot({
          seq: documents.seq,
          sha256: documents.snapshot.sha256,
          result: snapshot.result,
        }),
      )
      const moved = await movePointer(
        writer,
        'staging',
        { seq: documents.seq, bytes: documents.pointer.bytes, sha256: documents.pointer.sha256 },
        {
          production: state.production?.sha256 ?? null,
          staging: state.staging?.sha256 ?? null,
        },
        deps.now,
        { deadlinePassed },
      )
      if (!moved.ok) stop(moved.code, {}, moved.afterWrite ? 'pointer' : 'commit')
      deps.log(formatPointerMoved(documents.seq))
    }
    deps.log(REVIEW_LINE)
    return finish(documents === null ? 'unchanged' : 'staged', 'end')
  } catch (thrown) {
    if (thrown instanceof Stop) {
      deps.log(formatStopped('stage', thrown.code, thrown.detail))
      return finish(thrown.code, thrown.phase)
    }
    if (isStorageRefusal(thrown)) {
      deps.log(formatStopped('stage', 'client-refused', { refusal: thrown.message }))
      return finish('client-refused', phase)
    }
    deps.log(formatStopped('stage', 'internal', { errorName: internalName(thrown) }))
    return finish('internal', phase)
  }
}
