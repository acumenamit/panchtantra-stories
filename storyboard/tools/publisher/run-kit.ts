// The publisher's shared run kit (design migration-input/p1-step15a-design.md §2.1, §3.21, §3.22,
// D15-21, D15-22, D15-29; P1-8d part a, Step 15a): one copy of the stop and report pattern for
// validate, stage, approve and publish.
// - Moved from stage.ts without a behaviour change: Stop, failureCode, WAIVER_READ_CODE (stage.ts's
//   WAIVER_CODE, renamed), stopLine and internalLine (now for any of the four commands).
// - openReportDir checks the report dir once at the start of a run and returns its real path as a
//   CheckedReportDir, or prints the usage stop and the reason and returns null (exit 2, no report).
// - writeRunReport writes the report into that checked real dir; a refusal prints its reason (none
//   for a write that failed for another cause) and then `<command>: report-unwritten`.
// - Output only through deps.log and deps.error, in report.ts's fixed formats. Imports ./report only
//   (fence FS4d).
import {
  checkedReportDir,
  formatReportDirNotLocal,
  formatReportDirRefused,
  formatReportUnwritten,
  formatSiteNotLocal,
  formatStopped,
  internalName,
  writeReport,
  type CheckedReportDir,
  type Command,
  type Phase,
  type ReportDirRefusal,
  type ReportInput,
  type StopDetail,
} from './report'

/** A stop signal inside a run: the code, the line's detail and the phase its exit follows. */
export class Stop {
  constructor(
    readonly code: string,
    readonly detail: StopDetail,
    readonly phase: Phase,
  ) {}
}

/** A failed read or listing: unauthorized, or any other failure. */
export const failureCode = (kind: string): string =>
  kind === 'unauthorized' ? 'storage-unauthorized' : 'storage-failed'

/** A masters waiver read that is not `found`, by result kind. */
export const WAIVER_READ_CODE: Readonly<Record<string, string>> = {
  'not-found': 'waiver-not-in-masters',
  'hash-mismatch': 'waiver-hash-mismatch',
  'too-large': 'waiver-too-large',
  unauthorized: 'storage-unauthorized',
  failed: 'storage-failed',
}

/**
 * The codes a command may stop with before any runner starts (cli.ts may not import report.ts);
 * Step 15b adds takedown-here-only, the actions-mode `--takedown` refusal (D15B-8).
 */
export type ConfigurationCode =
  | 'usage'
  | 'configuration'
  | 'stage-here-only'
  | 'project-mismatch'
  | 'run-context-refused'
  | 'answers-missing'
  | 'takedown-here-only'

/** A stop line for the CLI's configuration checks. */
export function stopLine(command: Command, code: ConfigurationCode): string {
  return formatStopped(command, code)
}

/** The internal stop line for a throw that escaped a runner (FID-3): the class name only. */
export function internalLine(command: Command, thrown: unknown): string {
  return formatStopped(command, 'internal', { errorName: internalName(thrown) })
}

/** What the report-dir helpers need from a runner's deps. */
export interface RunKitDeps {
  readonly storyboardRoot: string
  /** The platform the run reports; win32 folds the in-site compare (D15-28). */
  readonly platform: string
  readonly log: (line: string) => void
  readonly error: (line: string) => void
}

/** The stderr reason for a report-dir refusal; `given` picks the flag or the default text. */
function refusalLine(command: Command, refused: ReportDirRefusal, given: boolean): string {
  if (refused === 'not-local') return formatReportDirNotLocal(command, given)
  if (refused === 'site-not-local') return formatSiteNotLocal(command)
  return formatReportDirRefused(command)
}

/**
 * The report dir's start check (D15-22, D15-29): the checked real dir, or null after printing
 * `<command>: stopped: usage` and the reason (the run then exits 2 with no report).
 */
export function openReportDir(
  command: Command,
  dir: string,
  given: boolean,
  deps: RunKitDeps,
): CheckedReportDir | null {
  const checked = checkedReportDir(dir, {
    storyboardRoot: deps.storyboardRoot,
    platform: deps.platform,
  })
  if (checked.ok) return checked.realDir
  deps.log(formatStopped(command, 'usage'))
  deps.error(refusalLine(command, checked.reason, given))
  return null
}

/**
 * The report write at the end of a run (D15-22): true when written; else the refusal's reason (if
 * the write-time verdict refused) and `<command>: report-unwritten` on stderr, and false. The
 * runner's exit is then 2 when no Storage write was sent and no hook was called (D15-19).
 */
export function writeRunReport(
  command: Command,
  realDir: CheckedReportDir,
  input: ReportInput,
  given: boolean,
  deps: RunKitDeps,
): boolean {
  const written = writeReport(realDir, input, {
    storyboardRoot: deps.storyboardRoot,
    platform: deps.platform,
  })
  if (written.ok) return true
  if (written.refused !== null) deps.error(refusalLine(command, written.refused, given))
  deps.error(formatReportUnwritten(command))
  return false
}
