// The publisher's outcome codes, printed lines and local reports (design
// migration-input/p1-step14-design.md §4.8, §4.9, §5, D14-18; P1-8c, Step 14; and
// migration-input/p1-step15a-design.md §4.7, §4.8, §5, D15-19, D15-22, D15-28, D15-29; P1-8d part
// a, Step 15a: the approve and publish codes, lines and sections, the phase tail, the real-path
// half of the report-dir guard and the writer's write-time re-checks). EXIT_BY_CODE is the
// one source of the codes and the exits each may carry (§5); a code's exit follows the phase it
// occurs in. Every formatter and the report builder validate each field (a StoryId, a 64-hex sha, a
// safe integer, a listed code, a fixed word) and throw a TypeError naming the field, never its
// value; so no line or report can carry a path, a message, a key or a private waiver field. The
// writer takes only the checked real dir (a CheckedReportDir, which checkedReportDir alone makes),
// creates it, re-checks its real path, then per file removes a stale temp entry, creates the temp
// exclusively, re-checks and renames; a failed write is a result, never a throw.
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { isSafeStoragePath } from '../../src/core/content/gates'
import { LOCALE_CODES } from '../../src/core/locales'
import { NodeId, StoryId } from '../../src/core/package/v1'

export type ExitCode = 0 | 1 | 2 | 3 | 4
/**
 * end 0; local and plan 1 (no Storage write sent); configuration 2; commit 3; pointer 4 (§5); tail
 * 4 (Step 15a: after the production pointer moved, or after an unchanged plan, while the hook and
 * verify run).
 */
export type Phase = 'end' | 'local' | 'plan' | 'configuration' | 'commit' | 'pointer' | 'tail'
/** The publisher's commands that print lines and write reports (help prints the usage only). */
export type Command = 'validate' | 'stage' | 'approve' | 'publish'

const PHASE_EXIT: ReadonlyMap<string, ExitCode> = new Map<string, ExitCode>([
  ['end', 0],
  ['local', 1],
  ['plan', 1],
  ['configuration', 2],
  ['commit', 3],
  ['pointer', 4],
  ['tail', 4],
])

const group = (exits: readonly ExitCode[], codes: readonly string[]) =>
  codes.map((code) => [code, Object.freeze([...exits])] as const)

/** §5, exhaustive: code → the exits it may carry. */
export const EXIT_BY_CODE: ReadonlyMap<string, readonly ExitCode[]> = new Map([
  ...group([0], ['staged', 'unchanged', 'dry-run', 'ok']),
  ...group(
    [1],
    [
      'local-file-path',
      'local-file-missing',
      'local-file-not-regular',
      'local-file-too-large',
      'package-not-jcs',
      'package-strict-parse',
      'package-story-id',
      'package-collection',
      'phase-1-package',
      'waiver-file-missing',
      'waiver-file-invalid',
      'waiver-story-id',
      'waiver-rule-set',
      'waiver-story-level-key',
      'waiver-keys-invalid',
      'waiver-on-non-migration',
      'validator-unwaived',
      'package-gate',
      'media-plan',
      'media-size',
      'media-hash',
      'media-type',
      'blocked',
      'catalogue-unknown-object',
      'pointer-state-inconsistent',
      'pointer-gate',
      'snapshot-missing',
      'snapshot-gate',
      'waiver-not-in-masters',
      'waiver-hash-mismatch',
      'waiver-too-large',
      'version-not-increased',
      'waivers-changed-same-package',
      'existing-object-differs',
      'existing-object-unverifiable',
      'carried-package-missing',
      'seq-exhausted',
      'plan-gate',
    ],
  ),
  ...group([1, 3], ['local-file-changed', 'storage-unauthorized', 'storage-failed']),
  ...group(
    [2],
    [
      'usage',
      'configuration',
      'stage-here-only',
      'project-mismatch',
      'private-lists-invalid',
      'report-unwritten',
    ],
  ),
  ...group(
    [3],
    [
      'upload-failed',
      'too-large',
      'mime-refused',
      'upload-verify-failed',
      'snapshot-unconfirmed',
      'seq-taken',
      'concurrent-writer',
      'deadline',
    ],
  ),
  ...group(
    [4],
    ['pointer-not-moved', 'pointer-superseded', 'pointer-unconfirmed', 'pointer-raced'],
  ),
  ...group([1, 3, 4], ['client-refused', 'internal']),
  // Step 15a §5: 35 new codes (6 at exit 0, 23 at exit 1, answers-missing at 1 and 2,
  // run-context-refused at 2, 2 at exit 3, 2 at exit 4).
  ...group(
    [0],
    [
      'approved',
      'already-approved',
      'already-published',
      'published',
      'rebuilt',
      'verify-superseded',
    ],
  ),
  ...group(
    [1],
    [
      'answers-invalid',
      'not-staged',
      'approval-package-changed',
      'staged-entry-superseded',
      'staged-entry-invalid',
      'approve-origin-not-migration',
      'approval-review-incomplete',
      'approval-missing',
      'approval-invalid',
      'approval-rule-set',
      'approval-waiver-mismatch',
      'approval-sha-mismatch',
      'waiver-keys-differ',
      'object-missing',
      'carried-package-gate',
      'production-missing',
      'production-entry-unapproved',
      'feature-not-in-production',
      'feature-media-incomplete',
      'rollback-seq-not-older',
      'rollback-snapshot-missing',
      'rollback-snapshot-invalid',
      'rollback-entry-unapproved',
    ],
  ),
  ...group([1, 2], ['answers-missing']),
  ...group([2], ['run-context-refused']),
  ...group([3], ['approval-raced', 'approval-unconfirmed']),
  ...group([4], ['hook-failed', 'verify-timeout']),
])

export const REVIEW_LINE = 'review: corepack pnpm preview:staging'

/** The fixed text of a client refusal (storage.ts; port.ts isStorageRefusal uses the same rule). */
const REFUSAL = /^refused: [a-z]+ (field|body-gate|class-pattern|url) [a-z0-9-]+$/
const ERROR_NAME = /^[A-Z][A-Za-z]{0,39}Error$/
const SHA = /^[0-9a-f]{64}$/
const CHECK_ID = /^[A-Z][0-9]{3}$/
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RULE_SET_REF = /^[a-z0-9-]{1,32}@\d{1,4}\.\d{1,4}\.\d{1,4}$/
const STORY_MESSAGE = new RegExp(
  `^waiver-story-level-key story=([a-z0-9-]+) check=(?:[A-Z][0-9]{3}|invalid) locale=(?:${[...LOCALE_CODES, 'none'].join('|')})$`,
)

function field(ok: boolean, name: string): void {
  if (!ok) throw new TypeError(`report: invalid ${name}`)
}

const exitsOf = (code: string): readonly ExitCode[] => EXIT_BY_CODE.get(code) ?? []
const isCode = (code: unknown): code is string => typeof code === 'string' && EXIT_BY_CODE.has(code)
const isStoryId = (value: unknown): value is string =>
  typeof value === 'string' && StoryId.safeParse(value).success
const isSha = (value: unknown): value is string => typeof value === 'string' && SHA.test(value)
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isSeq = (value: unknown): value is number => isCount(value) && value >= 1
const isCommand = (value: unknown): value is Command =>
  value === 'validate' || value === 'stage' || value === 'approve' || value === 'publish'
const oneOf = (value: unknown, words: readonly string[]): value is string =>
  typeof value === 'string' && words.includes(value)
const isErrorName = (value: unknown): value is string =>
  typeof value === 'string' &&
  (ERROR_NAME.test(value) || value === 'Error' || value === 'non-error')
/** The first 12 hex of a sha256, for printed lines. */
const sha12 = (sha: string): string => sha.slice(0, 12)
const seqOrNone = (seq: number | null): string => (seq === null ? 'none' : String(seq))

/** The exit for a code in a phase (§5 phase rule); a TypeError when the code may not carry it. */
export function exitForPhase(code: string, phase: Phase): ExitCode {
  const exit = PHASE_EXIT.get(phase)
  field(exit !== undefined && isCode(code) && exitsOf(code).includes(exit), 'code for the phase')
  return exit ?? 1
}

export interface ReportCounts {
  readonly errors: number
  readonly waived: number
  readonly lapsed: number
  readonly warnings: number
  readonly info: number
  readonly unusedKeys: number
}

function checkCounts(counts: ReportCounts): void {
  for (const key of ['errors', 'waived', 'lapsed', 'warnings', 'info', 'unusedKeys'] as const) {
    field(isCount(counts[key]), `count ${key}`)
  }
}

export interface ValidateStoryLine {
  readonly storyId: string
  /** null when the package file could not be read. */
  readonly packageSha256: string | null
  /** null when the package did not parse. */
  readonly version: number | null
  readonly counts: ReportCounts
  /** The number of media variants checked. */
  readonly media: number
  readonly blocking: string | null
}

/** `validate: <id> package=<sha12> version=<v> errors=… media=<k> verdict=ok|blocked:<code>`. */
export function formatValidateStory(line: ValidateStoryLine): string {
  field(isStoryId(line.storyId), 'storyId')
  field(line.packageSha256 === null || isSha(line.packageSha256), 'packageSha256')
  field(line.version === null || isSeq(line.version), 'version')
  checkCounts(line.counts)
  field(isCount(line.media), 'media')
  field(
    line.blocking === null || (isCode(line.blocking) && exitsOf(line.blocking).includes(1)),
    'blocking',
  )
  const c = line.counts
  const pkg = line.packageSha256 === null ? 'none' : sha12(line.packageSha256)
  const version = line.version === null ? 'none' : String(line.version)
  const verdict = line.blocking === null ? 'ok' : `blocked:${line.blocking}`
  return `validate: ${line.storyId} package=${pkg} version=${version} errors=${c.errors} waived=${c.waived} lapsed=${c.lapsed} warnings=${c.warnings} info=${c.info} unused-keys=${c.unusedKeys} media=${line.media} verdict=${verdict}`
}

/**
 * `validate: <ok>/<total> stageable`, and under `--all` ` ignored=<n>`: the names in the packages
 * folder that are not exactly `<StoryId>.json` (TP-7, FID-4), so a wrong-case name is never silent.
 */
export function formatValidateSummary(ok: number, total: number, ignored?: number): string {
  field(isCount(ok) && isCount(total) && ok <= total, 'summary counts')
  field(ignored === undefined || isCount(ignored), 'ignored count')
  const tail = ignored === undefined ? '' : ` ignored=${ignored}`
  return `validate: ${ok}/${total} stageable${tail}`
}

export interface StageStoryLine {
  readonly storyId: string
  readonly packageSha256: string
  readonly version: number
  readonly state: 'new' | 'in-production' | 'unchanged'
  readonly mediaNew: number
  readonly mediaSkipped: number
  readonly bytes: number
  readonly waiverKeys: number
}

/** One named story: `stage: <id> package=… version=… state=… media-new=… … waiver-keys=<k>`. */
export function formatStageStory(line: StageStoryLine): string {
  field(isStoryId(line.storyId), 'storyId')
  field(isSha(line.packageSha256), 'packageSha256')
  field(isSeq(line.version), 'version')
  field(oneOf(line.state, ['new', 'in-production', 'unchanged']), 'state')
  for (const key of ['mediaNew', 'mediaSkipped', 'bytes', 'waiverKeys'] as const) {
    field(isCount(line[key]), key)
  }
  return `stage: ${line.storyId} package=${sha12(line.packageSha256)} version=${line.version} state=${line.state} media-new=${line.mediaNew} media-skipped=${line.mediaSkipped} bytes=${line.bytes} waiver-keys=${line.waiverKeys}`
}

export interface StageCarriedLine {
  readonly storyId: string
  readonly packageSha256: string
  readonly version: number
  readonly state: 'candidate' | 'superseded'
}

/** A carried or dropped staging entry: `stage: <id> package=… version=… state=candidate|superseded`. */
export function formatStageCarried(line: StageCarriedLine): string {
  field(isStoryId(line.storyId), 'storyId')
  field(isSha(line.packageSha256), 'packageSha256')
  field(isSeq(line.version), 'version')
  field(oneOf(line.state, ['candidate', 'superseded']), 'state')
  return `stage: ${line.storyId} package=${sha12(line.packageSha256)} version=${line.version} state=${line.state}`
}

export interface PlanLine {
  /** null when the composition is unchanged and no seq is allocated. */
  readonly seq: number | null
  readonly stories: number
  readonly objectsNew: number
  readonly objectsSkipped: number
  readonly orphans: number
  readonly production: number | null
  readonly staging: number | null
}

/** `stage: plan seq=<N|none> stories=… objects-new=… objects-skipped=… orphans=… production=… staging=…`. */
export function formatPlan(line: PlanLine): string {
  for (const key of ['seq', 'production', 'staging'] as const) {
    field(line[key] === null || isSeq(line[key]), key)
  }
  for (const key of ['stories', 'objectsNew', 'objectsSkipped', 'orphans'] as const) {
    field(isCount(line[key]), key)
  }
  return `stage: plan seq=${seqOrNone(line.seq)} stories=${line.stories} objects-new=${line.objectsNew} objects-skipped=${line.objectsSkipped} orphans=${line.orphans} production=${seqOrNone(line.production)} staging=${seqOrNone(line.staging)}`
}

/** `stage: snapshot seq=<N> sha256=<sha12> created|identical` (after the read-back). */
export function formatSnapshot(line: {
  readonly seq: number
  readonly sha256: string
  readonly result: 'created' | 'identical'
}): string {
  field(isSeq(line.seq), 'seq')
  field(isSha(line.sha256), 'sha256')
  field(oneOf(line.result, ['created', 'identical']), 'result')
  return `stage: snapshot seq=${line.seq} sha256=${sha12(line.sha256)} ${line.result}`
}

/** `stage: staging pointer seq=<N> moved (read back, post-check clean)`. */
export function formatPointerMoved(seq: number): string {
  field(isSeq(seq), 'seq')
  return `stage: staging pointer seq=${seq} moved (read back, post-check clean)`
}

// ---- approve and publish lines (Step 15a §4.7) ----

/** The six answer keys (answers.ts reads them; a refusal line may name one, never a value). */
const ANSWER_KEYS: readonly string[] = [
  'languages-read',
  'all-nodes-read',
  'images-viewed',
  'narration-check',
  'devices',
  'checklist-complete',
]
const APPROVE_STATES = ['new', 'already-approved', 'already-published'] as const
const PUBLISH_STORY_STATES = ['new', 'replaced', 'in-production'] as const
const idOrNone = (id: string | null): string => (id === null ? 'none' : id)

export interface ApprovePlanLine {
  readonly storyId: string
  readonly packageSha256: string
  readonly version: number
  /** The staged entry's waiverFileSha256; null when the entry has no block. */
  readonly waiverFileSha256: string | null
  readonly state: (typeof APPROVE_STATES)[number]
}

/** `approve: <id> package=<sha12> version=<v> waivers=<sha12|none> state=<state>`. */
export function formatApprovePlan(line: ApprovePlanLine): string {
  field(isStoryId(line.storyId), 'storyId')
  field(isSha(line.packageSha256), 'packageSha256')
  field(isSeq(line.version), 'version')
  field(line.waiverFileSha256 === null || isSha(line.waiverFileSha256), 'waiverFileSha256')
  field(oneOf(line.state, APPROVE_STATES), 'state')
  const waivers = line.waiverFileSha256 === null ? 'none' : sha12(line.waiverFileSha256)
  return `approve: ${line.storyId} package=${sha12(line.packageSha256)} version=${line.version} waivers=${waivers} state=${line.state}`
}

/** `approve: record sha256=<sha12> created|identical|exists|planned`. */
export function formatApprovalRecord(line: {
  readonly sha256: string
  readonly result: 'created' | 'identical' | 'exists' | 'planned'
}): string {
  field(isSha(line.sha256), 'sha256')
  field(oneOf(line.result, ['created', 'identical', 'exists', 'planned']), 'result')
  return `approve: record sha256=${sha12(line.sha256)} ${line.result}`
}

/** `approve: answer <key> refused`: the key is one of the six, never a value. */
export function formatAnswerRefused(key: string): string {
  field(oneOf(key, ANSWER_KEYS), 'answer key')
  return `approve: answer ${key} refused`
}

export interface PublishStoryLine {
  readonly storyId: string
  readonly packageSha256: string
  readonly version: number
  /** The approvalSha256 the entry carries in N+1 (production's for in-production); null for none. */
  readonly approvalSha256: string | null
  readonly state: (typeof PUBLISH_STORY_STATES)[number]
}

/** `publish: <id> package=<sha12> version=<v> approval=<sha12|none> state=<state>`. */
export function formatPublishStory(line: PublishStoryLine): string {
  field(isStoryId(line.storyId), 'storyId')
  field(isSha(line.packageSha256), 'packageSha256')
  field(isSeq(line.version), 'version')
  field(line.approvalSha256 === null || isSha(line.approvalSha256), 'approvalSha256')
  field(oneOf(line.state, PUBLISH_STORY_STATES), 'state')
  const approval = line.approvalSha256 === null ? 'none' : sha12(line.approvalSha256)
  return `publish: ${line.storyId} package=${sha12(line.packageSha256)} version=${line.version} approval=${approval} state=${line.state}`
}

/** `publish: feature <id|none> state=set|cleared|kept|checked`. */
export function formatFeature(line: {
  readonly storyId: string | null
  readonly state: 'set' | 'cleared' | 'kept' | 'checked'
}): string {
  field(line.storyId === null || isStoryId(line.storyId), 'storyId')
  field(oneOf(line.state, ['set', 'cleared', 'kept', 'checked']), 'state')
  return `publish: feature ${idOrNone(line.storyId)} state=${line.state}`
}

/** A refused feature: `publish: feature <id> A001=<n> A005=<n> A006=<n>` (featured.ts's checks). */
export function formatFeatureCounts(line: {
  readonly storyId: string
  readonly A001: number
  readonly A005: number
  readonly A006: number
}): string {
  field(isStoryId(line.storyId), 'storyId')
  for (const key of ['A001', 'A005', 'A006'] as const) field(isCount(line[key]), key)
  return `publish: feature ${line.storyId} A001=${line.A001} A005=${line.A005} A006=${line.A006}`
}

export interface PublishPlanLine {
  readonly kind: 'publish' | 'rollback'
  /** N+1, or null when the plan is unchanged. */
  readonly seq: number | null
  readonly stories: number
  readonly production: number | null
  readonly staging: number | null
  readonly featured: string | null
  /** The rollback's `<seq>`; null for a publish. */
  readonly from: number | null
}

/** `publish: plan kind=… seq=<N|none> stories=… production=… staging=… featured=… from=…`. */
export function formatPublishPlan(line: PublishPlanLine): string {
  field(oneOf(line.kind, ['publish', 'rollback']), 'kind')
  for (const key of ['seq', 'production', 'staging', 'from'] as const) {
    field(line[key] === null || isSeq(line[key]), key)
  }
  field(isCount(line.stories), 'stories')
  field(line.featured === null || isStoryId(line.featured), 'featured')
  return `publish: plan kind=${line.kind} seq=${seqOrNone(line.seq)} stories=${line.stories} production=${seqOrNone(line.production)} staging=${seqOrNone(line.staging)} featured=${idOrNone(line.featured)} from=${seqOrNone(line.from)}`
}

/** `publish: snapshot seq=<N> sha256=<sha12> created|identical` (after the read-back). */
export function formatPublishSnapshot(line: {
  readonly seq: number
  readonly sha256: string
  readonly result: 'created' | 'identical'
}): string {
  field(isSeq(line.seq), 'seq')
  field(isSha(line.sha256), 'sha256')
  field(oneOf(line.result, ['created', 'identical']), 'result')
  return `publish: snapshot seq=${line.seq} sha256=${sha12(line.sha256)} ${line.result}`
}

/** `publish: production pointer seq=<N> moved (read back, post-check clean)`. */
export function formatProductionMoved(seq: number): string {
  field(isSeq(seq), 'seq')
  return `publish: production pointer seq=${seq} moved (read back, post-check clean)`
}

/** `publish: live seq=<N>`: verify confirmed the expected seq. */
export function formatLive(seq: number): string {
  field(isSeq(seq), 'seq')
  return `publish: live seq=${seq}`
}

/** `publish: superseded seq=<N>`: verify saw a later seq live. */
export function formatSuperseded(seq: number): string {
  field(isSeq(seq), 'seq')
  return `publish: superseded seq=${seq}`
}

/** Printed after a verify timeout, before the recovery line (D15-11; a fixed sentence). */
export const VERIFY_TIMEOUT_HINT =
  'publish: verify timed out; if a Vercel Instant Rollback is active, production stays on it until Undo Rollback (spec §8)'

/** After hook-failed or verify-timeout (CRIT-8): the redeploy of production as it is. */
export function formatRecovery(seq: number): string {
  field(isSeq(seq), 'seq')
  return `publish: recovery: publish --snapshot ${seq} redeploys production as it is`
}

export interface StopDetail {
  readonly storyId?: string
  /** client-refused only: the fixed text of a refusal isStorageRefusal accepted. */
  readonly refusal?: string
  /** internal only: internalName(thrown). */
  readonly errorName?: string
}

/**
 * `<command>: stopped: <code>` or `… <code> <id>`; pointer-raced adds `re-run <command>`,
 * client-refused the refusal's fixed text, internal the class name only (§4.8).
 */
export function formatStopped(command: Command, code: string, detail: StopDetail = {}): string {
  field(isCommand(command), 'command')
  field(isCode(code) && !exitsOf(code).includes(0), 'code')
  let line = `${command}: stopped: ${code}`
  if (detail.storyId !== undefined) {
    field(isStoryId(detail.storyId), 'storyId')
    line += ` ${detail.storyId}`
  }
  if (code === 'client-refused') {
    field(typeof detail.refusal === 'string' && REFUSAL.test(detail.refusal), 'refusal')
    line += ` ${detail.refusal}`
  } else {
    field(detail.refusal === undefined, 'refusal')
  }
  if (code === 'internal') {
    field(isErrorName(detail.errorName), 'error name')
    line += ` ${detail.errorName}`
  } else {
    field(detail.errorName === undefined, 'error name')
  }
  if (code === 'pointer-raced') line += ` re-run ${command}`
  return line
}

/** `<command>: report-unwritten` (stderr). */
export function formatReportUnwritten(command: Command): string {
  field(isCommand(command), 'command')
  return `${command}: report-unwritten`
}

/** The stderr reason for a report dir whose real path lies in the site (D14-25, SEC1-1). */
export function formatReportDirRefused(command: Command): string {
  field(isCommand(command), 'command')
  return `${command}: report-dir refused: its real path is at or under public/ or app/ of the storyboard folder`
}

/**
 * The stderr reason for a report dir whose real path is not on a local drive (D15-29): a mapped
 * drive or a link to a share answers `\\host\share\…`, a volume without a letter `Volume{…}\…`.
 */
export function formatReportDirNotLocal(command: Command, given: boolean): string {
  field(isCommand(command), 'command')
  field(typeof given === 'boolean', 'given')
  return given
    ? `${command}: report-dir refused: its real path is not on a local drive`
    : `${command}: report-dir refused: the default report dir's real path is not on a local drive; pass a local --report-dir`
}

/** The stderr reason when the real path of the storyboard folder's public/ or app/ is not local. */
export function formatSiteNotLocal(command: Command): string {
  field(isCommand(command), 'command')
  return `${command}: report-dir refused: the storyboard folder's real path is not on a local drive; run from a local checkout`
}

/** `<command>: <message>` for story-checks' fixed R24 message (story, check and locale only). */
export function formatStoryMessage(command: Command, message: string): string {
  field(isCommand(command), 'command')
  const match = STORY_MESSAGE.exec(message)
  field(match !== null && isStoryId(match[1]), 'story message')
  return `${command}: ${message}`
}

/**
 * The class name an `internal` line may print (INT-3): the Error's own `name` when it matches
 * `^[A-Z][A-Za-z]{0,39}Error$`, else `Error`; `non-error` for anything that is not an Error.
 */
export function internalName(thrown: unknown): string {
  if (!(thrown instanceof Error)) return 'non-error'
  let name: unknown
  try {
    name = thrown.name
  } catch {
    return 'Error'
  }
  return typeof name === 'string' && ERROR_NAME.test(name) ? name : 'Error'
}

// ---- reports (§4.9) ----

export interface ReportFinding {
  readonly checkId: string
  readonly severity: string
  readonly nodeId: string | null
  readonly locale: string | null
  readonly waived?: boolean
}

export interface ReportMedia {
  readonly path: string
  readonly mime: string
  readonly bytes: number
  readonly sha256: string | null
  /** checked or refused (local checks); new, skipped or uploaded (stage). */
  readonly state: string
}

export interface ReportStory {
  readonly storyId: string
  readonly packageSha256: string | null
  readonly version: number | null
  readonly origin: string | null
  readonly verdict: string
  readonly blocking: string | null
  readonly counts: ReportCounts
  /** Validator findings; only checkId, severity, nodeId, locale and waived are written. */
  readonly findings: readonly ReportFinding[]
  /** Check ids that did not run. */
  readonly skipped: readonly string[]
  readonly waiver: { readonly waiverFileSha256: string; readonly keys: number } | null
  readonly media: readonly ReportMedia[]
}

export interface ReportPlan {
  readonly seq: number | null
  readonly productionSeq: number | null
  readonly stagingSeq: number | null
  readonly gaps: number
  readonly stories: readonly {
    readonly storyId: string
    readonly packageSha256: string
    readonly source: string
  }[]
  readonly snapshotSha256: string | null
  readonly pointerSha256: string | null
}

export interface ReportInput {
  readonly command: string
  /**
   * validate for validate; stage or dry-run for stage; approve or dry-run for approve; publish or
   * dry-run for publish (MODES).
   */
  readonly mode: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly outcome: string
  readonly exitCode: number
  /** The number of create and pointer requests sent. */
  readonly writes: number
  readonly uploaded: readonly string[]
  readonly skipped: readonly string[]
  readonly orphans: readonly number[]
  readonly superseded: readonly { readonly storyId: string; readonly packageSha256: string }[]
  readonly ruleSetRef: string
  readonly privateWordLists: string
  readonly stories: readonly ReportStory[]
  /** Stage only (null when the run stopped before the plan); never set for the other commands. */
  readonly plan?: ReportPlan | null
  /** Approve only (null when the run stopped before the plan); never set for the others. */
  readonly approval?: ReportApproval | null
  /** Publish only (null when the run stopped before the plan); never set for the others. */
  readonly publish?: ReportPublish | null
}

/** The approve report's section (§4.8): each field null until known; never an answer. */
export interface ReportApproval {
  readonly storyId: string | null
  readonly packageSha256: string | null
  readonly version: number | null
  readonly waiverFileSha256: string | null
  readonly state: (typeof APPROVE_STATES)[number] | null
  readonly approvalSha256: string | null
}

export interface ReportPublishNamed {
  readonly storyId: string
  readonly packageSha256: string
  readonly version: number
  /** The approvalSha256 the entry carries in N+1 (production's for a story already in production). */
  readonly approvalSha256: string | null
  readonly state: (typeof PUBLISH_STORY_STATES)[number]
}

/** An entry of N+1 (every entry of a production snapshot carries its approval). */
export interface ReportPublishStory {
  readonly storyId: string
  readonly packageSha256: string
  readonly approvalSha256: string
  readonly source: 'production' | 'published' | 'rollback'
}

/** The publish report's section (§4.8): ids, hashes, seqs and fixed words only. */
export interface ReportPublish {
  readonly kind: 'publish' | 'rollback'
  /** The rollback's `<seq>`; null for a publish. */
  readonly from: number | null
  /** N+1; null when the plan is unchanged or the run stopped before it. */
  readonly seq: number | null
  readonly productionSeq: number | null
  readonly stagingSeq: number | null
  readonly featuredBefore: string | null
  readonly featuredAfter: string | null
  readonly named: readonly ReportPublishNamed[]
  readonly stories: readonly ReportPublishStory[]
  readonly snapshotSha256: string | null
  readonly pointerSha256: string | null
  readonly hook: 'not-run' | 'triggered' | 'failed'
  readonly verify: 'not-run' | 'live' | 'superseded' | 'timeout'
  readonly liveSeq: number | null
}

/** Every key a ReportInput may hold; any other own key is a TypeError (nothing extra is written). */
const INPUT_KEYS: readonly string[] = [
  'command',
  'mode',
  'startedAt',
  'finishedAt',
  'outcome',
  'exitCode',
  'writes',
  'uploaded',
  'skipped',
  'orphans',
  'superseded',
  'ruleSetRef',
  'privateWordLists',
  'stories',
  'plan',
  'approval',
  'publish',
]
const MODES: Readonly<Record<Command, readonly string[]>> = {
  validate: ['validate'],
  stage: ['dry-run', 'stage'],
  approve: ['approve', 'dry-run'],
  publish: ['publish', 'dry-run'],
}

/** A plain object whose own keys are exactly `keys` (a TypeError naming `name` otherwise). */
function exactKeys(value: unknown, keys: readonly string[], name: string): void {
  field(value !== null && typeof value === 'object' && !Array.isArray(value), name)
  const own = Object.keys(value as object)
  field(own.length === keys.length && own.every((key) => keys.includes(key)), `${name} keys`)
}

const storyIdOrNull = (value: unknown, name: string): string | null => {
  field(value === null || isStoryId(value), name)
  return value as string | null
}

const shaOrNull = (value: unknown, name: string): string | null => {
  field(value === null || isSha(value), name)
  return value as string | null
}
const seqOrNull = (value: unknown, name: string): number | null => {
  field(value === null || isSeq(value), name)
  return value as number | null
}

function reportStory(story: ReportStory): Record<string, unknown> {
  field(isStoryId(story.storyId), 'story storyId')
  field(oneOf(story.verdict, ['ok', 'blocked']), 'story verdict')
  field(
    story.verdict === 'ok'
      ? story.blocking === null
      : isCode(story.blocking) && !exitsOf(story.blocking).includes(0),
    'story blocking',
  )
  field(
    story.origin === null || oneOf(story.origin, ['migration', 'agent_flow', 'writer_flow']),
    'story origin',
  )
  checkCounts(story.counts)
  field(
    story.skipped.every((id) => CHECK_ID.test(id)),
    'story skipped',
  )
  const waiver = story.waiver
  field(waiver === null || (isSha(waiver.waiverFileSha256) && isCount(waiver.keys)), 'story waiver')
  return {
    storyId: story.storyId,
    packageSha256: shaOrNull(story.packageSha256, 'story packageSha256'),
    version: seqOrNull(story.version, 'story version'),
    origin: story.origin,
    verdict: story.verdict,
    blocking: story.blocking,
    counts: {
      errors: story.counts.errors,
      waived: story.counts.waived,
      lapsed: story.counts.lapsed,
      warnings: story.counts.warnings,
      info: story.counts.info,
      unusedKeys: story.counts.unusedKeys,
    },
    findings: story.findings.map(reportFinding),
    skipped: [...story.skipped],
    waiver:
      waiver === null ? null : { waiverFileSha256: waiver.waiverFileSha256, keys: waiver.keys },
    media: story.media.map((media) => {
      field(isSafeStoragePath(media.path), 'media path')
      field(oneOf(media.mime, ['image/webp', 'image/jpeg', 'audio/mpeg']), 'media mime')
      field(isCount(media.bytes), 'media bytes')
      field(oneOf(media.state, ['checked', 'refused', 'new', 'skipped', 'uploaded']), 'media state')
      return {
        path: media.path,
        mime: media.mime,
        bytes: media.bytes,
        sha256: shaOrNull(media.sha256, 'media sha256'),
        state: media.state,
      }
    }),
  }
}

/** Exactly {checkId, severity, nodeId, locale, waived}: never message, measured, limit or ruleId. */
function reportFinding(f: ReportFinding): Record<string, unknown> {
  field(CHECK_ID.test(f.checkId), 'finding checkId')
  field(oneOf(f.severity, ['error', 'warn', 'info']), 'finding severity')
  field(f.nodeId === null || NodeId.safeParse(f.nodeId).success, 'finding nodeId')
  field(f.locale === null || oneOf(f.locale, LOCALE_CODES), 'finding locale')
  return {
    checkId: f.checkId,
    severity: f.severity,
    nodeId: f.nodeId,
    locale: f.locale,
    waived: f.waived === true,
  }
}

function reportPlan(plan: ReportPlan): Record<string, unknown> {
  field(isCount(plan.gaps), 'plan gaps')
  return {
    seq: seqOrNull(plan.seq, 'plan seq'),
    productionSeq: seqOrNull(plan.productionSeq, 'plan productionSeq'),
    stagingSeq: seqOrNull(plan.stagingSeq, 'plan stagingSeq'),
    gaps: plan.gaps,
    stories: plan.stories.map((story) => {
      field(isStoryId(story.storyId) && isSha(story.packageSha256), 'plan story')
      field(oneOf(story.source, ['production', 'candidate', 'new']), 'plan source')
      return { storyId: story.storyId, packageSha256: story.packageSha256, source: story.source }
    }),
    snapshotSha256: shaOrNull(plan.snapshotSha256, 'plan snapshotSha256'),
    pointerSha256: shaOrNull(plan.pointerSha256, 'plan pointerSha256'),
  }
}

const APPROVAL_KEYS = [
  'storyId',
  'packageSha256',
  'version',
  'waiverFileSha256',
  'state',
  'approvalSha256',
]

function reportApproval(approval: ReportApproval): Record<string, unknown> {
  exactKeys(approval, APPROVAL_KEYS, 'approval')
  field(approval.state === null || oneOf(approval.state, APPROVE_STATES), 'approval state')
  return {
    storyId: storyIdOrNull(approval.storyId, 'approval storyId'),
    packageSha256: shaOrNull(approval.packageSha256, 'approval packageSha256'),
    version: seqOrNull(approval.version, 'approval version'),
    waiverFileSha256: shaOrNull(approval.waiverFileSha256, 'approval waiverFileSha256'),
    state: approval.state,
    approvalSha256: shaOrNull(approval.approvalSha256, 'approval approvalSha256'),
  }
}

const PUBLISH_KEYS = [
  'kind',
  'from',
  'seq',
  'productionSeq',
  'stagingSeq',
  'featuredBefore',
  'featuredAfter',
  'named',
  'stories',
  'snapshotSha256',
  'pointerSha256',
  'hook',
  'verify',
  'liveSeq',
]

function reportPublish(publish: ReportPublish): Record<string, unknown> {
  exactKeys(publish, PUBLISH_KEYS, 'publish')
  field(oneOf(publish.kind, ['publish', 'rollback']), 'publish kind')
  field(oneOf(publish.hook, ['not-run', 'triggered', 'failed']), 'publish hook')
  field(oneOf(publish.verify, ['not-run', 'live', 'superseded', 'timeout']), 'publish verify')
  field(Array.isArray(publish.named) && Array.isArray(publish.stories), 'publish lists')
  return {
    kind: publish.kind,
    from: seqOrNull(publish.from, 'publish from'),
    seq: seqOrNull(publish.seq, 'publish seq'),
    productionSeq: seqOrNull(publish.productionSeq, 'publish productionSeq'),
    stagingSeq: seqOrNull(publish.stagingSeq, 'publish stagingSeq'),
    featuredBefore: storyIdOrNull(publish.featuredBefore, 'publish featuredBefore'),
    featuredAfter: storyIdOrNull(publish.featuredAfter, 'publish featuredAfter'),
    named: publish.named.map((named) => {
      exactKeys(named, ['storyId', 'packageSha256', 'version', 'approvalSha256', 'state'], 'named')
      field(isStoryId(named.storyId) && isSha(named.packageSha256), 'named story')
      field(isSeq(named.version), 'named version')
      field(oneOf(named.state, PUBLISH_STORY_STATES), 'named state')
      return {
        storyId: named.storyId,
        packageSha256: named.packageSha256,
        version: named.version,
        approvalSha256: shaOrNull(named.approvalSha256, 'named approvalSha256'),
        state: named.state,
      }
    }),
    stories: publish.stories.map((story) => {
      exactKeys(story, ['storyId', 'packageSha256', 'approvalSha256', 'source'], 'publish story')
      field(isStoryId(story.storyId) && isSha(story.packageSha256), 'publish story')
      field(isSha(story.approvalSha256), 'publish story approvalSha256')
      field(oneOf(story.source, ['production', 'published', 'rollback']), 'publish story source')
      return {
        storyId: story.storyId,
        packageSha256: story.packageSha256,
        approvalSha256: story.approvalSha256,
        source: story.source,
      }
    }),
    snapshotSha256: shaOrNull(publish.snapshotSha256, 'publish snapshotSha256'),
    pointerSha256: shaOrNull(publish.pointerSha256, 'publish pointerSha256'),
    hook: publish.hook,
    verify: publish.verify,
    liveSeq: seqOrNull(publish.liveSeq, 'publish liveSeq'),
  }
}

/** The report's JSON text and its Markdown rendering; a TypeError on any field outside the rules. */
export function buildReport(input: ReportInput): { readonly json: string; readonly md: string } {
  field(isCommand(input.command), 'command')
  field(
    Object.keys(input).every((key) => INPUT_KEYS.includes(key)),
    'input keys',
  )
  field(isCommand(input.command) && oneOf(input.mode, MODES[input.command]), 'mode')
  field(ISO_MS.test(input.startedAt) && ISO_MS.test(input.finishedAt), 'timestamps')
  field(
    isCode(input.outcome) && exitsOf(input.outcome).some((exit) => exit === input.exitCode),
    'outcome and exit',
  )
  field(isCount(input.writes), 'writes')
  field(
    [...input.uploaded, ...input.skipped].every((path) => isSafeStoragePath(path)),
    'object paths',
  )
  field(
    input.orphans.every((seq) => isSeq(seq)),
    'orphans',
  )
  field(
    input.superseded.every((s) => isStoryId(s.storyId) && isSha(s.packageSha256)),
    'superseded',
  )
  field(RULE_SET_REF.test(input.ruleSetRef), 'ruleSetRef')
  field(oneOf(input.privateWordLists, ['loaded', 'not loaded']), 'privateWordLists')
  field(input.command === 'stage' ? input.plan !== undefined : input.plan === undefined, 'plan')
  field(
    input.command === 'approve' ? input.approval !== undefined : input.approval === undefined,
    'approval',
  )
  field(
    input.command === 'publish' ? input.publish !== undefined : input.publish === undefined,
    'publish',
  )
  if (input.command === 'approve' || input.command === 'publish') {
    // §D15-19: approve and publish carry no stories, objects or private word lists.
    field(
      input.stories.length === 0 &&
        input.uploaded.length === 0 &&
        input.skipped.length === 0 &&
        input.superseded.length === 0,
      'lists for approve and publish',
    )
    field(input.privateWordLists === 'not loaded', 'privateWordLists for approve and publish')
  }
  const report: Record<string, unknown> = {
    command: input.command,
    mode: input.mode,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    outcome: input.outcome,
    exitCode: input.exitCode,
    writes: input.writes,
    uploaded: [...input.uploaded],
    skipped: [...input.skipped],
    orphans: [...input.orphans],
    superseded: input.superseded.map((s) => ({
      storyId: s.storyId,
      packageSha256: s.packageSha256,
    })),
    ruleSetRef: input.ruleSetRef,
    privateWordLists: input.privateWordLists,
    stories: input.stories.map(reportStory),
  }
  if (input.command === 'stage') report.plan = input.plan ? reportPlan(input.plan) : null
  if (input.command === 'approve') {
    report.approval = input.approval == null ? null : reportApproval(input.approval)
  }
  if (input.command === 'publish') {
    report.publish = input.publish == null ? null : reportPublish(input.publish)
  }
  return { json: `${JSON.stringify(report, null, 2)}\n`, md: renderMarkdown(report) }
}

const cell = (value: unknown): string =>
  value === null || value === undefined
    ? '-'
    : Array.isArray(value)
      ? value.join(', ') || '-'
      : String(value)
const table = (head: readonly string[], rows: readonly (readonly unknown[])[]): string[] => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
]

/** The same validated data as tables (every value is a fixed word, number, id, hash or object path). */
function renderMarkdown(report: Record<string, unknown>): string {
  type Story = Record<string, unknown> & {
    counts: Record<string, number>
    findings: Record<string, unknown>[]
    media: Record<string, unknown>[]
    waiver: { waiverFileSha256: string; keys: number } | null
  }
  const stories = report.stories as Story[]
  const lines = [
    `# publisher ${String(report.command)} report`,
    '',
    ...table(
      ['field', 'value'],
      [
        'command',
        'mode',
        'startedAt',
        'finishedAt',
        'outcome',
        'exitCode',
        'writes',
        'ruleSetRef',
        'privateWordLists',
      ].map((key) => [key, report[key]]),
    ),
    '',
    '## Stories',
    '',
    ...table(
      [
        'story',
        'package',
        'version',
        'origin',
        'verdict',
        'blocking',
        'errors',
        'waived',
        'lapsed',
        'warnings',
        'info',
        'unused keys',
        'skipped',
        'waiver file',
        'waiver keys',
        'media',
      ],
      stories.map((s) => [
        s.storyId,
        s.packageSha256,
        s.version,
        s.origin,
        s.verdict,
        s.blocking,
        s.counts.errors,
        s.counts.waived,
        s.counts.lapsed,
        s.counts.warnings,
        s.counts.info,
        s.counts.unusedKeys,
        s.skipped,
        s.waiver?.waiverFileSha256 ?? null,
        s.waiver?.keys ?? null,
        s.media.length,
      ]),
    ),
    '',
    '## Findings',
    '',
    ...table(
      ['story', 'check', 'severity', 'node', 'locale', 'waived'],
      stories.flatMap((s) =>
        s.findings.map((f) => [s.storyId, f.checkId, f.severity, f.nodeId, f.locale, f.waived]),
      ),
    ),
    '',
    '## Media',
    '',
    ...table(
      ['story', 'path', 'mime', 'bytes', 'sha256', 'state'],
      stories.flatMap((s) =>
        s.media.map((m) => [s.storyId, m.path, m.mime, m.bytes, m.sha256, m.state]),
      ),
    ),
    '',
    '## Objects',
    '',
    ...table(
      ['list', 'entries'],
      [
        ['uploaded', report.uploaded],
        ['skipped', report.skipped],
        ['orphans', report.orphans],
        [
          'superseded',
          (report.superseded as { storyId: string; packageSha256: string }[]).map(
            (s) => `${s.storyId} ${s.packageSha256}`,
          ),
        ],
      ],
    ),
  ]
  const plan = report.plan as
    (Record<string, unknown> & { stories: Record<string, unknown>[] }) | null | undefined
  if (plan !== undefined) {
    lines.push('', '## Plan', '')
    if (plan === null) {
      lines.push('No plan: the run stopped before it.')
    } else {
      lines.push(
        ...table(
          ['seq', 'production', 'staging', 'gaps', 'snapshot', 'pointer'],
          [
            [
              plan.seq,
              plan.productionSeq,
              plan.stagingSeq,
              plan.gaps,
              plan.snapshotSha256,
              plan.pointerSha256,
            ],
          ],
        ),
        '',
        ...table(
          ['story', 'package', 'source'],
          plan.stories.map((s) => [s.storyId, s.packageSha256, s.source]),
        ),
      )
    }
  }
  const approval = report.approval as Record<string, unknown> | null | undefined
  if (approval !== undefined) {
    lines.push('', '## Approval', '')
    if (approval === null) {
      lines.push('No approval data: the run stopped before the plan.')
    } else {
      lines.push(
        ...table(
          ['story', 'package', 'version', 'waiver file', 'state', 'approval record'],
          [APPROVAL_KEYS.map((key) => approval[key])],
        ),
      )
    }
  }
  type Rows = Record<string, unknown>[]
  const publish = report.publish as
    (Record<string, unknown> & { named: Rows; stories: Rows }) | null | undefined
  if (publish !== undefined) {
    lines.push('', '## Publish', '')
    if (publish === null) {
      lines.push('No publish data: the run stopped before the plan.')
    } else {
      lines.push(
        ...table(
          ['field', 'value'],
          PUBLISH_KEYS.filter((key) => key !== 'named' && key !== 'stories').map((key) => [
            key,
            publish[key],
          ]),
        ),
        '',
        '### Named stories',
        '',
        ...table(
          ['story', 'package', 'version', 'approval', 'state'],
          publish.named.map((s) => [
            s.storyId,
            s.packageSha256,
            s.version,
            s.approvalSha256,
            s.state,
          ]),
        ),
        '',
        '### Snapshot stories',
        '',
        ...table(
          ['story', 'package', 'approval', 'source'],
          publish.stories.map((s) => [s.storyId, s.packageSha256, s.approvalSha256, s.source]),
        ),
      )
    }
  }
  return `${lines.join('\n')}\n`
}

/**
 * The real path of `path`: the real path of its nearest existing ancestor (links, junctions, subst
 * drives and other-case names on the way resolved by the OS), then the rest of the path as given.
 */
function realPathOf(path: string): string {
  const rest: string[] = []
  let current = resolve(path)
  for (;;) {
    try {
      return join(realpathSync.native(current), ...rest)
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(path)
      rest.unshift(basename(current))
      current = parent
    }
  }
}

/**
 * True only for a drive-letter absolute path (`X:\`) or one with exactly one leading `/` (D15-29).
 * realpathSync.native turns a mapped drive or a link to a share into `\\host\share\…` and a volume
 * without a letter into `Volume{…}\…`, which no in-site compare can place. No platform argument:
 * tests inject win32 on Linux, where a real path starts with one `/`; a win32 real path never does.
 */
export function isLocalRealPath(path: string): boolean {
  return /^[A-Za-z]:\\/.test(path) || /^\/(?!\/)/.test(path) || path === '/'
}

/** The storyboard folder the report dir is compared with, and the platform of the run. */
export interface ReportSite {
  readonly storyboardRoot: string
  readonly platform: string
}

/** A report dir's real path that passed the whole verdict; only checkedReportDir makes one. */
export type CheckedReportDir = string & { readonly __brand: 'CheckedReportDir' }
export type ReportDirRefusal = 'in-site' | 'not-local' | 'site-not-local'

const SITE_FOLDERS = ['public', 'app'] as const
/** win32 folds as NTFS's upcase table does for U+0131 and U+017F (D15-28); posix keeps case. */
const foldFor = (platform: string) => (path: string) =>
  platform === 'win32' ? path.toUpperCase().toLowerCase() : path
const inSiteOf = (real: string, bases: readonly string[], platform: string): boolean => {
  const fold = foldFor(platform)
  const target = fold(real)
  return bases.some((base) => {
    const folded = fold(base)
    return target === folded || target.startsWith(folded + sep)
  })
}

/**
 * The one real-path verdict (D15-22, D15-29), in order: the report dir's real path not local;
 * public/'s or app/'s real path not local; the real path at or under public/ or app/ (D14-25,
 * SEC1-1: a cwd through a junction, a link or a subst drive, an 8.3 or other-case name). The dir's
 * real path is read once per verdict.
 */
function realDirVerdict(
  dir: string,
  site: ReportSite,
): { readonly verdict: ReportDirRefusal | 'ok'; readonly real: string } {
  const real = realPathOf(dir)
  if (!isLocalRealPath(real)) return { verdict: 'not-local', real }
  const bases = SITE_FOLDERS.map((name) => realPathOf(join(site.storyboardRoot, name)))
  if (!bases.every(isLocalRealPath)) return { verdict: 'site-not-local', real }
  if (inSiteOf(real, bases, site.platform)) return { verdict: 'in-site', real }
  return { verdict: 'ok', real }
}

/**
 * True when the report dir's real path is `<storyboardRoot>/public` or `/app`, or under either
 * (D14-25, SEC1-1): both sides through realPathOf, folded on win32 (D15-28). args.ts already
 * refused the string forms; this sees a cwd reached through a junction, a link or a subst drive,
 * and a link inside the report dir's existing part. checkedReportDir holds the full verdict.
 */
export function reportDirInSite(dir: string, storyboardRoot: string, platform: string): boolean {
  const bases = SITE_FOLDERS.map((name) => realPathOf(join(storyboardRoot, name)))
  return inSiteOf(realPathOf(dir), bases, platform)
}

/**
 * The report dir checked once at the start of a run (D15-22): its real path as the branded
 * CheckedReportDir, or the refusal. The runner keeps the real path and writes there, so a link on
 * the input path retargeted later cannot move the report.
 */
export function checkedReportDir(
  dir: string,
  site: ReportSite,
):
  | { readonly ok: true; readonly realDir: CheckedReportDir }
  | { readonly ok: false; readonly reason: ReportDirRefusal } {
  const { verdict, real } = realDirVerdict(dir, site)
  if (verdict !== 'ok') return { ok: false, reason: verdict }
  return { ok: true, realDir: real as CheckedReportDir }
}

export type ReportWrite =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code: 'report-unwritten'
      /** The write-time verdict that refused, or null for any other failure. */
      readonly refused: ReportDirRefusal | null
    }

const REPORT_NAMES: ReadonlyMap<string, string> = new Map([
  ['validate', 'publisher-validate'],
  ['stage', 'publisher-stage'],
  ['approve', 'publisher-approve'],
  ['publish', 'publisher-publish'],
])

/** Removes a temp file of ours, best effort (a failure leaves it; the run reports unwritten). */
function removeQuietly(temp: string): void {
  try {
    rmSync(temp, { force: true })
  } catch {
    // Nothing of ours to remove, or it cannot be removed; the result already says unwritten.
  }
}

/**
 * Writes `<realDir>/publisher-<command>.json` and `.md` (a dry run included: the name follows the
 * command). Invalid data throws a TypeError before any write. Then (D15-22): a recursive mkdir; the
 * full real-path verdict again; per file, a stale entry at `<name>.tmp` removed (a link removed,
 * never followed), the temp created exclusively, the verdict again, and a rename over the old
 * report. A failure is `{ok: false, code: 'report-unwritten', refused}`: the verdict that refused,
 * or null. An entry this run did not create is never removed.
 */
export function writeReport(
  realDir: CheckedReportDir,
  input: ReportInput,
  site: ReportSite,
): ReportWrite {
  const { json, md } = buildReport(input)
  const base = REPORT_NAMES.get(input.command) ?? 'publisher-stage'
  const unwritten = (refused: ReportDirRefusal | null): ReportWrite => ({
    ok: false,
    code: 'report-unwritten',
    refused,
  })
  try {
    mkdirSync(realDir, { recursive: true })
  } catch {
    return unwritten(null)
  }
  const afterMkdir = realDirVerdict(realDir, site).verdict
  if (afterMkdir !== 'ok') return unwritten(afterMkdir)
  for (const [name, text] of [
    [`${base}.json`, json],
    [`${base}.md`, md],
  ] as const) {
    const temp = join(realDir, `${name}.tmp`)
    try {
      rmSync(temp, { force: true })
    } catch {
      // A directory at the temp name, say: it is not ours, so it stays.
      return unwritten(null)
    }
    try {
      writeFileSync(temp, text, { flag: 'wx' })
    } catch {
      // An entry planted after the removal is not ours: it stays.
      return unwritten(null)
    }
    const beforeRename = realDirVerdict(realDir, site).verdict
    if (beforeRename !== 'ok') {
      removeQuietly(temp)
      return unwritten(beforeRename)
    }
    try {
      renameSync(temp, join(realDir, name))
    } catch {
      removeQuietly(temp)
      return unwritten(null)
    }
  }
  return { ok: true }
}
