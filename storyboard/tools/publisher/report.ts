// The publisher's outcome codes, printed lines and local reports (design
// migration-input/p1-step14-design.md §4.8, §4.9, §5, D14-18; P1-8c, Step 14). EXIT_BY_CODE is the
// one source of the codes and the exits each may carry (§5); a code's exit follows the phase it
// occurs in. Every formatter and the report builder validate each field (a StoryId, a 64-hex sha, a
// safe integer, a listed code, a fixed word) and throw a TypeError naming the field, never its
// value; so no line or report can carry a path, a message, a key or a private waiver field. The
// writer creates the report dir, writes each file to a temp name in the same folder, then renames
// it; a failed write is a result, never a throw.
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { isSafeStoragePath } from '../../src/core/content/gates'
import { LOCALE_CODES } from '../../src/core/locales'
import { NodeId, StoryId } from '../../src/core/package/v1'

export type ExitCode = 0 | 1 | 2 | 3 | 4
/** end 0; local and plan 1 (no Storage write sent); configuration 2; commit 3; pointer 4 (§5). */
export type Phase = 'end' | 'local' | 'plan' | 'configuration' | 'commit' | 'pointer'

const PHASE_EXIT: ReadonlyMap<string, ExitCode> = new Map<string, ExitCode>([
  ['end', 0],
  ['local', 1],
  ['plan', 1],
  ['configuration', 2],
  ['commit', 3],
  ['pointer', 4],
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
const isCommand = (value: unknown): value is 'validate' | 'stage' =>
  value === 'validate' || value === 'stage'
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

export interface StopDetail {
  readonly storyId?: string
  /** client-refused only: the fixed text of a refusal isStorageRefusal accepted. */
  readonly refusal?: string
  /** internal only: internalName(thrown). */
  readonly errorName?: string
}

/**
 * `<command>: stopped: <code>` or `… <code> <id>`; pointer-raced adds `re-run stage`,
 * client-refused the refusal's fixed text, internal the class name only (§4.8).
 */
export function formatStopped(
  command: 'validate' | 'stage',
  code: string,
  detail: StopDetail = {},
): string {
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
  if (code === 'pointer-raced') line += ' re-run stage'
  return line
}

/** `<command>: report-unwritten` (stderr). */
export function formatReportUnwritten(command: 'validate' | 'stage'): string {
  field(isCommand(command), 'command')
  return `${command}: report-unwritten`
}

/** The stderr reason for a report dir whose real path lies in the site (D14-25, SEC1-1). */
export function formatReportDirRefused(command: 'validate' | 'stage'): string {
  field(isCommand(command), 'command')
  return `${command}: report-dir refused: its real path is at or under public/ or app/ of the storyboard folder`
}

/** `<command>: <message>` for story-checks' fixed R24 message (story, check and locale only). */
export function formatStoryMessage(command: 'validate' | 'stage', message: string): string {
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
  /** validate for validate; dry-run or stage for stage. */
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
  /** Stage only (null when the run stopped before the plan); never set for validate. */
  readonly plan?: ReportPlan | null
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

/** The report's JSON text and its Markdown rendering; a TypeError on any field outside the rules. */
export function buildReport(input: ReportInput): { readonly json: string; readonly md: string } {
  field(isCommand(input.command), 'command')
  field(
    oneOf(input.mode, input.command === 'validate' ? ['validate'] : ['dry-run', 'stage']),
    'mode',
  )
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
 * True when the report dir's real path is `<storyboardRoot>/public` or `/app`, or under either
 * (D14-25, SEC1-1): both sides through realPathOf, without regard to case on win32. args.ts already
 * refused the string forms; this sees a cwd reached through a junction, a link or a subst drive,
 * and a link inside the report dir's existing part. stage.ts asks it before any other work.
 */
export function reportDirInSite(dir: string, storyboardRoot: string, platform: string): boolean {
  const fold = (path: string) => (platform === 'win32' ? path.toLowerCase() : path)
  const target = fold(realPathOf(dir))
  return ['public', 'app'].some((name) => {
    const base = fold(realPathOf(join(storyboardRoot, name)))
    return target === base || target.startsWith(base + sep)
  })
}

export type ReportWrite =
  { readonly ok: true } | { readonly ok: false; readonly code: 'report-unwritten' }

const REPORT_NAMES: ReadonlyMap<string, string> = new Map([
  ['validate', 'publisher-validate'],
  ['stage', 'publisher-stage'],
])

/**
 * Writes `<dir>/publisher-<command>.json` and `.md` (a dry run included: the name follows the
 * command): a recursive mkdir, then each file to `<name>.tmp` in the same folder and a rename over
 * the old report. Invalid data throws a TypeError before any write; a failed write is
 * `{ok: false, code: 'report-unwritten'}`, and the temp file is removed.
 */
export function writeReport(dir: string, input: ReportInput): ReportWrite {
  const { json, md } = buildReport(input)
  const base = REPORT_NAMES.get(input.command) ?? 'publisher-stage'
  const unwritten: ReportWrite = { ok: false, code: 'report-unwritten' }
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return unwritten
  }
  for (const [name, text] of [
    [`${base}.json`, json],
    [`${base}.md`, md],
  ] as const) {
    const temp = join(dir, `${name}.tmp`)
    try {
      writeFileSync(temp, text)
      renameSync(temp, join(dir, name))
    } catch {
      try {
        rmSync(temp, { force: true })
      } catch {
        // The temp name is not a plain file; nothing of ours to remove.
      }
      return unwritten
    }
  }
  return { ok: true }
}
