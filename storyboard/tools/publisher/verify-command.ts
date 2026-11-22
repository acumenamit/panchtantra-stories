// The publisher's verify command: `verify [--deep] [--timeout-ms <n>] [--report-dir <dir>]` (design
// migration-input/p1-step15b-design.md §3.19, §3.20, §4.6, §4.7, D15B-18 to D15B-20; P1-8d part b,
// Step 15b).
// - In pc mode the report dir is checked first, before any Storage read (run-kit openReportDir);
//   every later exit writes publisher-verify.{json,md} there. Actions mode writes no report.
// - Every step runs in phase plan (verify writes nothing, exit 1), in this order, each failure
//   recorded and the run's code the first failure in step order: 1. the catalogue state through the
//   read-only port (no production pointer stops); the expected seq is production's. 2. verify
//   (deps.verify, which asks for the confirmed read's build); a timeout prints the older-live line
//   or the verify hint and skips steps 3 to 5. 3. the live build's snapshot sha256 against the
//   production pointer's (after a superseded answer, the state read once more). 4. for every
//   production entry the build loaded, in snapshot order: its package read and gated
//   (readCheckedPackage), its landing page in each enabled locale it lists, then one image (the
//   first WebP, else the first JPEG) and one MP3 per story; site-gated only when at least one page
//   was checked and every checked page answered 404. 5. the build's excluded rows. 6. the Range
//   check on the first MP3 of the packages step 4 read (all production packages after a timeout).
//   7. with --deep: every listed package and media object against its own name and every approval
//   record and waiver file the two snapshots name, capped from the listings before any object read.
// - Output only through deps.log and deps.error in report.ts's fixed formats; reads only through the
//   read-only port and deps.site (the CLI binds the site URL and the public content base, so this
//   module never builds a URL and never opens a network connection).
import { planMediaHeads } from '../../src/core/content/media'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { ENABLED_LOCALE_CODES } from '../../src/core/locales'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { readCatalogueState, type CatalogueState } from './catalogue-state'
import {
  isStorageRefusal,
  readOnlyPort,
  type LiveBuild,
  type RangeTarget,
  type StorageReader,
  type VerifySite,
} from './port'
import { checkApprovalRecord, readCheckedPackage } from './remote-checks'
import {
  exitForPhase,
  formatDeepMismatch,
  formatDeepPlan,
  formatDeepSummary,
  formatExcluded,
  formatExcludedCount,
  formatLandingFailed,
  formatLandingSummary,
  formatMediaFailed,
  formatMediaSummary,
  formatOlderLive,
  formatRangeFailed,
  formatRangeOk,
  formatRangeSkipped,
  formatSnapshotMatch,
  formatStopped,
  formatVerifyExpected,
  formatVerifyTimeoutHint,
  internalName,
  type CheckedReportDir,
  type ExitCode,
  type Phase,
  type ReportInput,
  type ReportVerify,
} from './report'
import { failureCode, openReportDir, writeRunReport } from './run-kit'
import { classOfPath } from './storage-layout'

/** --deep's caps, planned from the listings before any object read (D15B-20). */
export const DEEP_MAX_OBJECTS = 5_000
export const DEEP_MAX_BYTES = 536_870_912

export interface VerifyInput {
  readonly deep: boolean
  readonly reportDir: string
  readonly reportDirGiven: boolean
}

/** What verify answered, with the confirmed read's build (the CLI asks for detail). */
export type VerifyCommandAnswer =
  | { readonly kind: 'live' | 'superseded'; readonly seq: number; readonly build: LiveBuild }
  | { readonly kind: 'timeout'; readonly lastSeq: number | null }

export interface VerifyDeps {
  readonly storyboardRoot: string
  readonly platform: string
  readonly now: () => Date
  readonly sleep: (ms: number) => Promise<void>
  readonly log: (line: string) => void
  readonly error: (line: string) => void
  /** pc: this PC, a report written; actions: GitHub Actions, no report. */
  readonly runMode: 'pc' | 'actions'
  /** Builds the client, held read-only; called once. */
  readonly makePort: () => StorageReader
  readonly verify: (expectedSeq: number) => Promise<VerifyCommandAnswer>
  readonly site: VerifySite
}

interface Failure {
  readonly code: string
  readonly storyId?: string
}

/** A stop before the first recorded step (state read, production missing). */
class EarlyStop {
  constructor(readonly code: string) {}
}

/** The first audio/mpeg head of the packages in order, as a Range target; null when none. */
function rangeTargetOf(packages: readonly StoryPackageV1[]): RangeTarget | null {
  const plan = planMediaHeads(
    packages.map((pkg) => ({ pkg })),
    '',
  )
  if (!plan.ok) return null
  const head = plan.value.heads.find((candidate) => candidate.mime === 'audio/mpeg')
  if (head === undefined) return null
  const sha256 = classOfPath('content', head.path)?.fields.sha256
  return typeof sha256 === 'string' ? { path: head.path, bytes: head.bytes, sha256 } : null
}

/** The verify command (§4.6): exit 0 verified or verify-superseded, else the first failure's code. */
export async function runVerify(input: VerifyInput, deps: VerifyDeps): Promise<ExitCode> {
  let realDir: CheckedReportDir | null = null
  if (deps.runMode === 'pc') {
    realDir = openReportDir('verify', input.reportDir, input.reportDirGiven, deps)
    if (realDir === null) return 2
  }
  const startedAt = deps.now().toISOString()
  let orphans: readonly number[] = []
  let section: ReportVerify | null = null
  const update = (fields: Partial<ReportVerify>) => {
    if (section !== null) section = { ...section, ...fields }
  }
  const failures: Failure[] = []
  const fail = (code: string, storyId?: string) =>
    void failures.push(storyId === undefined ? { code } : { code, storyId })

  const report = (outcome: string, exitCode: ExitCode): ReportInput => ({
    command: 'verify',
    mode: 'verify',
    startedAt,
    finishedAt: deps.now().toISOString(),
    outcome,
    exitCode,
    writes: 0,
    uploaded: [],
    skipped: [],
    orphans,
    superseded: [],
    ruleSetRef: PANCHATANTRA_RULESET.ref,
    privateWordLists: 'not loaded',
    stories: [],
    verify: section,
  })
  /** The report, then the exit; a failed report is exit 2 (verify writes nothing, D15-19). */
  const finish = (code: string, at: Phase): ExitCode => {
    const exitCode = exitForPhase(code, at)
    if (realDir === null) return exitCode
    if (writeRunReport('verify', realDir, report(code, exitCode), input.reportDirGiven, deps)) {
      return exitCode
    }
    return 2
  }

  /** --deep (D15B-20): the plan from the listings, the caps, then every object and record. */
  async function deep(reader: StorageReader, state: CatalogueState): Promise<void> {
    const objects: { path: string; size: number; kind: 'package' | 'media' }[] = []
    for (const [folder, kind] of [
      ['packages/', 'package'],
      ['media/', 'media'],
    ] as const) {
      const listing = await reader.listContent(folder)
      if (listing.kind !== 'listed') return fail(failureCode(listing.kind))
      for (const object of listing.objects) {
        const found = classOfPath('content', object.path)
        if (found?.kind !== kind || object.size === null) return fail('deep-unknown-object')
        objects.push({ path: object.path, size: object.size, kind })
      }
    }
    const bytes = objects.reduce((sum, object) => sum + object.size, 0)
    const approvals = new Map<string, SnapshotEntry>()
    const waivers = new Map<string, SnapshotEntry>()
    for (const pointer of [state.production, state.staging]) {
      for (const entry of pointer?.snapshot.stories ?? []) {
        if (entry.approvalSha256 !== undefined) {
          approvals.set(`${entry.storyId}/${entry.packageSha256}/${entry.approvalSha256}`, entry)
        }
        if (entry.waivers !== undefined) {
          waivers.set(`${entry.storyId}/${entry.waivers.waiverFileSha256}`, entry)
        }
      }
    }
    const counts = {
      objects: objects.length,
      bytes,
      approvals: approvals.size,
      waivers: waivers.size,
    }
    deps.log(formatDeepPlan(counts))
    if (objects.length > DEEP_MAX_OBJECTS || bytes > DEEP_MAX_BYTES) {
      update({ deep: { ...counts, checked: 0, mismatches: 0 } })
      return fail('deep-over-cap')
    }
    let mismatches = 0
    const mismatch = (
      kind: 'package' | 'media' | 'approval' | 'waiver',
      storyId: string,
      sha256: string,
      reason: string,
    ) => {
      mismatches += 1
      deps.log(formatDeepMismatch({ kind, storyId, sha256, reason }))
    }
    for (const object of objects) {
      const fields = classOfPath('content', object.path)?.fields ?? {}
      const storyId = String(fields.storyId)
      if (object.kind === 'package') {
        const name = String(fields.packageSha256)
        const read = await reader.readContent({ kind: 'package', storyId, packageSha256: name })
        if (read.kind === 'not-found') mismatch('package', storyId, name, 'missing')
        else if (read.kind !== 'found') mismatch('package', storyId, name, 'read-failed')
        else if (read.sha256 !== name) mismatch('package', storyId, name, 'hash')
        else if (read.size !== object.size) mismatch('package', storyId, name, 'size')
        continue
      }
      const answer = await deps.site.object({
        path: object.path,
        bytes: object.size,
        mime: String(fields.mime),
      })
      if (answer.kind === 'failed') mismatch('media', storyId, String(fields.sha256), answer.reason)
    }
    for (const entry of approvals.values()) {
      const sha = entry.approvalSha256 ?? ''
      const read = await reader.readMaster({
        kind: 'approval',
        storyId: entry.storyId,
        packageSha256: entry.packageSha256,
      })
      if (read.kind === 'not-found') mismatch('approval', entry.storyId, sha, 'missing')
      else if (read.kind !== 'found') mismatch('approval', entry.storyId, sha, 'read-failed')
      else if (read.sha256 !== sha) mismatch('approval', entry.storyId, sha, 'approval-sha')
      else if (checkApprovalRecord(read.bytes, entry) !== null) {
        mismatch('approval', entry.storyId, sha, 'approval-invalid')
      }
    }
    for (const entry of waivers.values()) {
      const sha = entry.waivers?.waiverFileSha256 ?? ''
      const read = await reader.readMaster({
        kind: 'waiver',
        storyId: entry.storyId,
        waiverSha256: sha,
      })
      if (read.kind === 'not-found') mismatch('waiver', entry.storyId, sha, 'waiver-missing')
      else if (read.kind === 'hash-mismatch') mismatch('waiver', entry.storyId, sha, 'hash')
      else if (read.kind === 'too-large') mismatch('waiver', entry.storyId, sha, 'too-large')
      else if (read.kind !== 'found') mismatch('waiver', entry.storyId, sha, 'read-failed')
    }
    const checked = objects.length + approvals.size + waivers.size
    deps.log(formatDeepSummary({ checked, mismatches }))
    update({ deep: { ...counts, checked, mismatches } })
    if (mismatches > 0) fail('deep-mismatch')
  }

  try {
    // 1. The state; the expected seq is production's.
    const reader = readOnlyPort(deps.makePort())
    const read = await readCatalogueState(reader)
    if (!read.ok) throw new EarlyStop(read.code)
    let state = read.state
    orphans = state.orphans
    const production = state.production
    if (production === null) throw new EarlyStop('production-missing')
    const expectedSeq = production.pointer.seq
    section = {
      expectedSeq,
      outcome: 'not-run',
      liveSeq: null,
      rollbackFlag: 'none',
      snapshot: 'not-run',
      landing: { checked: 0, failed: 0, gated: false },
      media: { checked: 0, failed: 0, skipped: 0 },
      excluded: [],
      range: 'not-run',
      deep: null,
    }
    deps.log(formatVerifyExpected(expectedSeq))

    // 2. verify.
    const answer = await deps.verify(expectedSeq)
    let rangePackages: StoryPackageV1[] = []
    if (answer.kind === 'timeout') {
      update({ outcome: 'timeout' })
      if (answer.lastSeq !== null && answer.lastSeq < expectedSeq) {
        deps.log(formatOlderLive('verify', answer.lastSeq, expectedSeq))
        update({ rollbackFlag: 'older-live' })
      } else {
        deps.log(formatVerifyTimeoutHint('verify'))
      }
      fail('verify-timeout')
      for (const entry of production.snapshot.stories) {
        const checked = await readCheckedPackage(reader, entry)
        if (checked.ok) rangePackages.push(checked.pkg)
        else fail(checked.code, entry.storyId)
      }
    } else {
      update({ outcome: answer.kind, liveSeq: answer.seq })
      // 3. The live build's snapshot against the production pointer (re-read once after superseded).
      let pointer = production
      if (answer.kind === 'superseded') {
        const again = await readCatalogueState(reader)
        if (again.ok && again.state.production !== null) {
          state = again.state
          pointer = again.state.production
        }
      }
      if (
        pointer.pointer.seq === answer.seq &&
        answer.build.snapshotSha256 === pointer.snapshotSha256
      ) {
        deps.log(formatSnapshotMatch(answer.seq, pointer.snapshotSha256))
        update({ snapshot: 'match' })
      } else {
        update({ snapshot: 'mismatch' })
        fail('live-snapshot-mismatch')
      }

      // 4. Landing pages, then one image and one MP3 per story the build loaded.
      const built = new Set(answer.build.stories.map((story) => story.storyId))
      const chosen: { entry: SnapshotEntry; pkg: StoryPackageV1 }[] = []
      let pages = 0
      let pagesFailed = 0
      let every404 = true
      for (const entry of pointer.snapshot.stories) {
        if (!built.has(entry.storyId)) continue
        const checked = await readCheckedPackage(reader, entry)
        if (!checked.ok) {
          fail(checked.code, entry.storyId)
          continue
        }
        chosen.push({ entry, pkg: checked.pkg })
        for (const locale of ENABLED_LOCALE_CODES) {
          if (!(checked.pkg.locales as readonly string[]).includes(locale)) continue
          const page = await deps.site.landing(entry.storyId, locale)
          pages += 1
          if (page.kind === 'ok') {
            every404 = false
            continue
          }
          pagesFailed += 1
          if (page.status !== 404) every404 = false
          deps.log(
            formatLandingFailed({
              storyId: entry.storyId,
              locale,
              reason: page.reason,
              status: page.status,
            }),
          )
        }
      }
      const gated = pages > 0 && pagesFailed === pages && every404
      if (gated) fail('site-gated')
      else if (pagesFailed > 0) fail('landing-page-failed')
      let objectsChecked = 0
      let objectsFailed = 0
      let skipped = 0
      for (const { entry, pkg } of chosen) {
        const plan = planMediaHeads([{ pkg }], '')
        if (!plan.ok) {
          fail('carried-package-gate', entry.storyId)
          continue
        }
        const heads = plan.value.heads
        const image =
          heads.find((head) => head.mime === 'image/webp') ??
          heads.find((head) => head.mime === 'image/jpeg')
        const mp3 = heads.find((head) => head.mime === 'audio/mpeg')
        for (const [kind, head] of [
          ['image', image],
          ['mp3', mp3],
        ] as const) {
          if (head === undefined) {
            skipped += 1
            continue
          }
          const got = await deps.site.object({
            path: head.path,
            bytes: head.bytes,
            mime: head.mime,
          })
          objectsChecked += 1
          if (got.kind === 'failed') {
            objectsFailed += 1
            deps.log(
              formatMediaFailed({
                storyId: entry.storyId,
                kind,
                reason: got.reason,
                status: got.status,
              }),
            )
          }
        }
      }
      if (objectsFailed > 0) fail('media-check-failed')
      deps.log(formatLandingSummary({ checked: pages, failed: pagesFailed }))
      deps.log(formatMediaSummary({ checked: objectsChecked, failed: objectsFailed, skipped }))
      update({
        landing: { checked: pages, failed: pagesFailed, gated },
        media: { checked: objectsChecked, failed: objectsFailed, skipped },
      })

      // 5. The excluded rows.
      for (const row of answer.build.excluded) deps.log(formatExcluded(row))
      deps.log(formatExcludedCount(answer.build.excluded.length))
      update({
        excluded: answer.build.excluded.map((row) => ({
          storyId: row.storyId,
          version: row.version,
          reason: row.reason,
        })),
      })
      rangePackages = chosen.map(({ pkg }) => pkg)
    }

    // 6. The Range check.
    const target = rangeTargetOf(rangePackages)
    if (target === null) {
      deps.log(formatRangeSkipped('verify', expectedSeq))
      update({ range: 'skipped' })
    } else {
      const ranged = await deps.site.range(target)
      if (ranged.kind === 'ok') {
        deps.log(
          formatRangeOk('verify', {
            seq: expectedSeq,
            start: ranged.start,
            end: ranged.end,
            size: ranged.size,
            sha256: target.sha256,
          }),
        )
        update({ range: 'ok' })
      } else {
        deps.log(formatRangeFailed('verify', ranged.reason, target.sha256))
        update({ range: 'failed' })
        fail('range-check-failed')
      }
    }

    // 7. --deep.
    if (input.deep) await deep(reader, state)

    // 8. The outcome: the first failure in step order, else verified or verify-superseded.
    const first = failures[0]
    if (first === undefined) {
      return finish(answer.kind === 'superseded' ? 'verify-superseded' : 'verified', 'end')
    }
    deps.log(
      formatStopped(
        'verify',
        first.code,
        first.storyId === undefined ? {} : { storyId: first.storyId },
      ),
    )
    return finish(first.code, 'plan')
  } catch (thrown) {
    if (thrown instanceof EarlyStop) {
      deps.log(formatStopped('verify', thrown.code))
      return finish(thrown.code, 'plan')
    }
    if (isStorageRefusal(thrown)) {
      deps.log(formatStopped('verify', 'client-refused', { refusal: thrown.message }))
      return finish('client-refused', 'plan')
    }
    deps.log(formatStopped('verify', 'internal', { errorName: internalName(thrown) }))
    return finish('internal', 'plan')
  }
}
