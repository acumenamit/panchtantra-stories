// The publisher's approve command (design migration-input/p1-step15a-design.md §4.1, D15-1 to
// D15-5, D15-14, D15-18, D15-22, D15-25, D15-27, CRIT-1, CRIT-5, TP-7; P1-8d part a, Step 15a).
// - In pc mode the report dir is checked first (run-kit openReportDir); every later exit writes the
//   report into that checked real dir (writeRunReport). Actions mode writes no report (D15-15).
// - The stdin channel is read before any client exists (answers-invalid, phase local).
// - The plan, through readOnlyPort: the catalogue state; the staged entry for the id (not-staged);
//   the --package binding right after it (approval-package-changed: nothing else is read);
//   already-published; staged-entry-superseded; the existing record, read first (already-approved,
//   or its refusal code); the remote story check without the approval step (origin migration); the
//   prompts (after the facts are known) and the review from the answers; the record built from the
//   staged entry and the rule set, self-checked (plan-gate). A dry run stops there.
// - The commit: createWithRetry unchanged, then always one readMaster read-back, which alone decides:
//   our sha256 is approved (created or identical by the create's result), another approval-raced,
//   anything else approval-unconfirmed.
// - Output only through deps.log and deps.error, in report.ts's fixed formats: ids, hashes, counts
//   and codes; an answer, the record body, a thrown message or a check's reason is never printed.
//   A client refusal is recognised only by isStorageRefusal.
import type { SnapshotEntry } from '../../src/core/content/packages'
import { isCanonicalJcs } from '../../src/core/content/gates'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import {
  APPROVAL_PRESCREEN_LEGACY,
  ApprovalRecord,
  type ApprovalReview,
} from '../../src/core/package/approval'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import {
  promptAnswers,
  readAnswersStream,
  reviewFromAnswers,
  type AnswerInput,
  type Answers,
  type ReviewFacts,
} from './answers'
import { createWithRetry, readCatalogueState } from './catalogue-state'
import { isStorageRefusal, readOnlyPort, type ApprovePort, type StorageReader } from './port'
import {
  exitForPhase,
  formatAnswerRefused,
  formatApprovalRecord,
  formatApprovePlan,
  formatStopped,
  internalName,
  type CheckedReportDir,
  type ExitCode,
  type Phase,
  type ReportApproval,
  type ReportInput,
  type StopDetail,
} from './report'
import { checkApprovalRecord, checkStoryRemote } from './remote-checks'
import { Stop, failureCode, openReportDir, writeRunReport } from './run-kit'
import type { ApprovalRef } from './storage-layout'

const RULESET = PANCHATANTRA_RULESET

/** stdin or a test stream, as cli.ts opens it (the answer channel's input type). */
export type ApproveStdin = AnswerInput

/** The answer channel (TP-7): stdin read before the plan, or prompts after the facts are known. */
export type ApproveAnswers =
  | { readonly kind: 'stdin'; readonly input: AnswerInput; readonly deadline: Promise<void> }
  | { readonly kind: 'prompt'; readonly input: AnswerInput; readonly write: (text: string) => void }

/** What approve needs from the parsed arguments (the timeout goes to the client, in cli.ts). */
export interface ApproveInput {
  readonly storyId: string
  /** 12 to 64 lowercase hex: a prefix of the reviewed package's sha256 (D15-27). */
  readonly packagePrefix: string
  readonly dryRun: boolean
  readonly reportDir: string
  readonly reportDirGiven: boolean
}

export interface ApproveDeps {
  readonly storyboardRoot: string
  readonly platform: string
  readonly now: () => Date
  readonly sleep: (ms: number) => Promise<void>
  readonly log: (line: string) => void
  readonly error: (line: string) => void
  /** pc: this PC, reports written; actions: GitHub Actions, no report dir and no report (D15-15). */
  readonly runMode: 'pc' | 'actions'
  /** Builds the client; called once, after the stdin answers were read. */
  readonly makePort: () => ApprovePort
  readonly answers: ApproveAnswers
}

/** The record approve writes for the staged entry and the review (D15-2), as a plain object. */
function recordOf(entry: SnapshotEntry, review: ApprovalReview, now: Date): ApprovalRecord {
  return {
    storyId: entry.storyId,
    packageSha256: entry.packageSha256,
    ruleSetRef: RULESET.ref,
    waiversSha256: entry.waivers?.waiverFileSha256 ?? '',
    review,
    prescreen: APPROVAL_PRESCREEN_LEGACY,
    decision: 'approved',
    approvedOn: now.toISOString().slice(0, 10),
    approvedBy: 'owner',
  }
}

/** The answer codes name the answers, not the story: their stop lines carry no id. */
const ANSWER_CODES: ReadonlySet<string> = new Set([
  'answers-invalid',
  'answers-missing',
  'approval-review-incomplete',
])

/** The approve command (§4.1): exit 0 approved, already-approved, already-published or dry-run. */
export async function runApprove(input: ApproveInput, deps: ApproveDeps): Promise<ExitCode> {
  let realDir: CheckedReportDir | null = null
  if (deps.runMode === 'pc') {
    realDir = openReportDir('approve', input.reportDir, input.reportDirGiven, deps)
    if (realDir === null) return 2
  }
  const startedAt = deps.now().toISOString()
  const mode = input.dryRun ? 'dry-run' : 'approve'
  const storyId = input.storyId
  let phase: Phase = 'local'
  let writes = 0
  let orphans: readonly number[] = []
  let approval: ReportApproval | null = null
  const known = (fields: Partial<ReportApproval>) => {
    approval = { ...(approval ?? EMPTY_APPROVAL), ...fields }
  }

  const report = (outcome: string, exitCode: ExitCode): ReportInput => ({
    command: 'approve',
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
    approval,
  })
  const finish = (code: string, at: Phase): ExitCode => {
    const exitCode = exitForPhase(code, at)
    if (realDir === null) return exitCode
    if (writeRunReport('approve', realDir, report(code, exitCode), input.reportDirGiven, deps)) {
      return exitCode
    }
    return writes === 0 ? 2 : exitCode
  }
  function stop(code: string, detail: StopDetail = {}, at: Phase = phase): never {
    throw new Stop(code, detail, at)
  }
  const named = { storyId }

  /** The commit holds the port through this wrapper: it counts writes. */
  const tracked = (port: ApprovePort): ApprovePort => ({
    listContent: (folder) => port.listContent(folder),
    readContent: (ref) => port.readContent(ref),
    readMaster: (ref) => port.readMaster(ref),
    create: async (ref, body) => {
      const result = await port.create(ref, body)
      writes += 1
      return result
    },
  })

  try {
    // The stdin channel, before any client exists (§4.1 step 5).
    let answers: Answers | null = null
    if (deps.answers.kind === 'stdin') {
      const read = await readAnswersStream(deps.answers.input, deps.answers.deadline)
      if (!read.ok) stop(read.code, {}, 'local')
      answers = read.answers
    }

    // The plan (§4.1 step 6), through the read-only port.
    phase = 'plan'
    const port = deps.makePort()
    const reader: StorageReader = readOnlyPort(port)
    known({ storyId })
    const read = await readCatalogueState(reader)
    if (!read.ok) stop(read.code)
    const state = read.state
    orphans = state.orphans
    const staged = state.staging?.snapshot.stories.find((entry) => entry.storyId === storyId)
    if (staged === undefined) stop('not-staged', named)
    known({
      packageSha256: staged.packageSha256,
      version: staged.version,
      waiverFileSha256: staged.waivers?.waiverFileSha256 ?? null,
    })
    // The binding (D15-27): the owner named the reviewed package; nothing else is read first.
    if (!staged.packageSha256.startsWith(input.packagePrefix)) {
      stop('approval-package-changed', named)
    }
    const planLine = (state: ApproveState) =>
      formatApprovePlan({
        storyId,
        packageSha256: staged.packageSha256,
        version: staged.version,
        waiverFileSha256: staged.waivers?.waiverFileSha256 ?? null,
        state,
      })
    const production = state.production?.snapshot.stories.find((entry) => entry.storyId === storyId)
    if (
      production !== undefined &&
      production.packageSha256 === staged.packageSha256 &&
      production.approvalSha256 !== undefined
    ) {
      known({ state: 'already-published', approvalSha256: production.approvalSha256 })
      deps.log(planLine('already-published'))
      return finish('already-published', 'end')
    }
    if (
      staged.approvalSha256 !== undefined ||
      (production !== undefined &&
        production.packageSha256 !== staged.packageSha256 &&
        production.version >= staged.version)
    ) {
      stop('staged-entry-superseded', named)
    }

    // The existing record, read first (D15-5).
    const ref: ApprovalRef = {
      kind: 'approval',
      storyId,
      packageSha256: staged.packageSha256,
    }
    const existing = await reader.readMaster(ref)
    if (existing.kind === 'found') {
      const code = checkApprovalRecord(existing.bytes, staged)
      if (code !== null) stop(code, named)
      known({ state: 'already-approved', approvalSha256: existing.sha256 })
      deps.log(planLine('already-approved'))
      deps.log(formatApprovalRecord({ sha256: existing.sha256, result: 'exists' }))
      return finish('already-approved', 'end')
    }
    if (existing.kind !== 'not-found') stop(failureCode(existing.kind), named)

    // The remote story check without the approval step (§4.4 steps 2 to 4, origin migration).
    const checked = await checkStoryRemote(reader, staged, {
      approval: 'skip',
      origin: 'migration',
    })
    if (!checked.ok) stop(checked.code, named)
    const pkg = checked.pkg
    const facts: ReviewFacts = {
      storyId,
      packageSha256: staged.packageSha256,
      version: staged.version,
      locales: pkg.locales,
      nodeCount: pkg.nodes.length,
      imageCount: pkg.nodes.filter((node) => node.image !== null).length,
    }

    // The prompts, after the facts are known (§4.1 step 7); then the review.
    if (deps.answers.kind === 'prompt') {
      const prompted = await promptAnswers(deps.answers.input, deps.answers.write, facts)
      if (!prompted.ok) stop(prompted.code)
      answers = prompted.answers
    }
    if (answers === null) stop('internal', { errorName: 'Error' })
    const review = reviewFromAnswers(answers, facts)
    if (!review.ok) {
      deps.log(formatAnswerRefused(review.key))
      stop(review.code)
    }

    // The record, built and self-checked (§4.1 step 8).
    const record = recordOf(staged, review.review, deps.now())
    const bytes = jcsBytes(record)
    const parsedBack: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!ApprovalRecord.safeParse(parsedBack).success || !isCanonicalJcs(parsedBack, bytes)) {
      stop('plan-gate', named)
    }
    const sha256 = await sha256Hex(bytes)
    known({ state: 'new', approvalSha256: sha256 })
    deps.log(planLine('new'))
    if (input.dryRun) {
      deps.log(formatApprovalRecord({ sha256, result: 'planned' }))
      return finish('dry-run', 'end')
    }

    // The commit (§4.1 step 9): the create, then the one read-back that decides.
    phase = 'commit'
    const writer = tracked(port)
    const created = await createWithRetry(writer, ref, bytes, { sleep: deps.sleep })
    if (!created.ok) stop(created.code, named)
    const back = await writer.readMaster(ref)
    if (back.kind === 'found' && back.sha256 === sha256) {
      deps.log(
        formatApprovalRecord({
          sha256,
          result: created.result === 'created' ? 'created' : 'identical',
        }),
      )
      return finish('approved', 'end')
    }
    if (back.kind === 'found') stop('approval-raced', named)
    stop('approval-unconfirmed', named)
  } catch (thrown) {
    if (thrown instanceof Stop) {
      const detail = ANSWER_CODES.has(thrown.code) ? {} : thrown.detail
      deps.log(formatStopped('approve', thrown.code, detail))
      return finish(thrown.code, thrown.phase)
    }
    if (isStorageRefusal(thrown)) {
      deps.log(formatStopped('approve', 'client-refused', { refusal: thrown.message }))
      return finish('client-refused', phase)
    }
    deps.log(formatStopped('approve', 'internal', { errorName: internalName(thrown) }))
    return finish('internal', phase)
  }
}

type ApproveState = 'new' | 'already-approved' | 'already-published'

const EMPTY_APPROVAL: ReportApproval = {
  storyId: null,
  packageSha256: null,
  version: null,
  waiverFileSha256: null,
  state: null,
  approvalSha256: null,
}
