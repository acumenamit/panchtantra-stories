// The publisher's argument parser and run context (design migration-input/p1-step14-design.md
// §3.11 D14-1, D14-17, D14-25; P1-8c, Step 14; migration-input/p1-step15a-design.md §3.1, §3.7,
// §3.23, §3.29, D15-1, D15-7, D15-23, D15-28; P1-8d part a, Step 15a; and
// migration-input/p1-step15b-design.md §3.26, D15B-1, D15B-8, D15B-19, D15B-26; P1-8d part b, Step
// 15b: `publish --unpublish <id> [--takedown]` and `verify [--deep]`). Pure: no file, no
// environment, no clock. Flags are held in a Map, so prototype names (`--__proto__`,
// `--constructor`, `--toString`) are unknown flags. Every message names a flag or a rule from the
// fixed table, never an input value.
// - Parse order for every command: the flag loop (unknown, repeated, no value, needs a value), the
//   scope texts, the id rules, the `--fixtures` dry-run rule (Step 16), the required flags, the value
//   forms (`--package`, `--snapshot`, `--feature`, then `--unpublish`), the report dir (device or
//   network, then the win32 segment rule, then the in-site compare), then `--timeout-ms`.
// - Step 16 (migration-input/p1-step16-design.md §3.14.1, D16-14; P1-8e): `--fixtures`, a boolean
//   flag for approve, publish and verify; approve and publish also need `--dry-run`, checked right
//   after the id rules. Its default report dir is `<storyboardRoot>/migration-input/reports/fixtures`
//   (one fixed segment more), so a fixtures report never replaces a real one; a given `--report-dir`
//   is used as given, and both pass the same form and in-site checks.
// - Step 17 (migration-input/p1-step17-design.md §3.7, §3.20, §3.23, D17-7, D17-20, D17-23, TP17-7;
//   P1-9a): `masters --masters <dir> [--dry-run] [--expect-plan <64 hex>]`, its flags and scope
//   texts, and `--expect-plan` for stage too (StageInput.expectPlan, string or null). `--masters` is
//   resolved from cwd and refused before any fs call when the given text or the resolved path is a
//   device or network form, or (platform win32) holds a segment Windows cannot store as written; a
//   masters commit without `--expect-plan` is usage. Checked after the required flags and the value
//   forms, before the report dir.
import { resolve, sep } from 'node:path'
import { StoryId } from '../../src/core/package/v1'

export const USAGE_TEXT = [
  'usage: corepack pnpm publisher <command>',
  '  validate (<id>... | --all) --packages <dir> --media <dir> [--waivers <dir>] [--report-dir <dir>]',
  '  stage <id>... --packages <dir> --media <dir> [--waivers <dir>] [--report-dir <dir>] [--dry-run] [--expect-plan <64 hex>] [--timeout-ms <n>]',
  '  approve <id> --package <sha256 prefix> [--answers-stdin] [--report-dir <dir>] [--dry-run] [--fixtures] [--timeout-ms <n>]',
  '  publish <id>... [--feature <id|none>] [--report-dir <dir>] [--dry-run] [--fixtures] [--timeout-ms <n>]',
  '  publish --feature <id|none> [--report-dir <dir>] [--dry-run] [--fixtures] [--timeout-ms <n>]',
  '  publish --snapshot <seq> [--feature <id|none>] [--report-dir <dir>] [--dry-run] [--fixtures] [--timeout-ms <n>]',
  '  publish --unpublish <id> [--takedown] [--report-dir <dir>] [--dry-run] [--fixtures] [--timeout-ms <n>]',
  '  verify [--deep] [--fixtures] [--report-dir <dir>] [--timeout-ms <n>]',
  '  masters --masters <dir> [--dry-run] [--expect-plan <64 hex>] [--report-dir <dir>] [--timeout-ms <n>]',
  '  help',
].join('\n')

/** The client's bound on a request timeout (storage.ts), and stage's default. */
export const TIMEOUT_MS_MAX = 600_000
export const TIMEOUT_MS_DEFAULT = 180_000
const MAX_IDS = 64

type FlagKind = 'value' | 'boolean'
const FLAGS: ReadonlyMap<string, FlagKind> = new Map([
  ['packages', 'value'],
  ['media', 'value'],
  ['waivers', 'value'],
  ['report-dir', 'value'],
  ['timeout-ms', 'value'],
  ['dry-run', 'boolean'],
  ['all', 'boolean'],
  ['answers-stdin', 'boolean'],
  ['feature', 'value'],
  ['snapshot', 'value'],
  ['package', 'value'],
  ['unpublish', 'value'],
  ['takedown', 'boolean'],
  ['deep', 'boolean'],
  ['fixtures', 'boolean'],
  ['masters', 'value'],
  ['expect-plan', 'value'],
])
type Command = 'help' | 'validate' | 'stage' | 'approve' | 'publish' | 'verify' | 'masters'
const COMMANDS: ReadonlySet<string> = new Set<Command>([
  'help',
  'validate',
  'stage',
  'approve',
  'publish',
  'verify',
  'masters',
])

/** Each flag's commands (TP-1); `--report-dir` is for every command but help. */
const SCOPE: ReadonlyMap<string, readonly Command[]> = new Map<string, readonly Command[]>([
  ['packages', ['validate', 'stage']],
  ['media', ['validate', 'stage']],
  ['waivers', ['validate', 'stage']],
  ['report-dir', ['validate', 'stage', 'approve', 'publish', 'verify', 'masters']],
  ['timeout-ms', ['stage', 'approve', 'publish', 'verify', 'masters']],
  ['dry-run', ['stage', 'approve', 'publish', 'masters']],
  ['all', ['validate']],
  ['answers-stdin', ['approve']],
  ['package', ['approve']],
  ['feature', ['publish']],
  ['snapshot', ['publish']],
  ['unpublish', ['publish']],
  ['takedown', ['publish']],
  ['deep', ['verify']],
  ['fixtures', ['approve', 'publish', 'verify']],
  ['masters', ['masters']],
  ['expect-plan', ['stage', 'masters']],
])

const MESSAGE = {
  empty: 'usage: an argument is empty or holds a NUL character',
  noCommand: 'usage: no command (validate, stage, approve, publish, verify, masters or help)',
  command: 'usage: unknown command (validate, stage, approve, publish, verify, masters or help)',
  helpArgs: 'usage: help takes no arguments',
  bareDashes: 'usage: a bare -- is not allowed',
  singleDash: 'usage: single-dash flags are not supported',
  unknownFlag: 'usage: unknown flag',
  allWithIds: 'usage: --all cannot be combined with story ids',
  idsOrAll: 'usage: validate needs story ids or --all',
  idCount: 'usage: give 1 to 64 story ids',
  idInvalid: 'usage: a story id must be 3 to 64 characters of a-z, 0-9 and single hyphens',
  idTwice: 'usage: a story id is given more than once',
  approveOneId: 'usage: approve takes exactly one story id',
  packageForm: 'usage: --package must be 12 to 64 lowercase hex characters',
  publishNeeds: 'usage: publish needs story ids, --feature, --snapshot or --unpublish',
  snapshotWithIds: 'usage: --snapshot cannot be combined with story ids',
  snapshotForm: 'usage: --snapshot must be a whole number from 1',
  featureForm: 'usage: --feature takes a story id or none',
  unpublishWith: 'usage: --unpublish cannot be combined with story ids, --feature or --snapshot',
  unpublishForm: 'usage: --unpublish takes a story id',
  takedownNeeds: 'usage: --takedown needs --unpublish <id>',
  verifyIds: 'usage: verify takes no story ids',
  fixturesDryRun: 'usage: --fixtures needs --dry-run for approve and publish',
  timeout: 'usage: --timeout-ms must be a whole number from 1 to 600000',
  reportDir: 'usage: --report-dir may not be at or under public/ or app/ of the storyboard folder',
  reportDirDevice: 'usage: --report-dir may not be a device or network path',
  reportDirDeviceDefault:
    'usage: the default report dir is on a device or network path; run from a local checkout or pass a local --report-dir',
  reportDirSegment: 'usage: --report-dir has a segment Windows cannot store as written',
  reportDirSegmentDefault:
    'usage: the default report dir has a segment Windows cannot store as written; pass a local --report-dir',
  mastersDevice: 'usage: --masters may not be a device or network path',
  mastersSegment: 'usage: --masters has a segment Windows cannot store as written',
  planForm: 'usage: --expect-plan must be 64 lowercase hex characters',
  mastersNeedsPlan: 'usage: masters needs --expect-plan unless --dry-run',
  mastersIds: 'usage: masters takes no story ids',
} as const
// The flag-named messages take a name from FLAGS, never the argument as typed.
const repeated = (flag: string) => `usage: --${flag} is given more than once`
const noValue = (flag: string) => `usage: --${flag} takes no value`
const needsValue = (flag: string) =>
  `usage: --${flag} needs a value that is not empty and does not start with --`
const required = (flag: string) => `usage: --${flag} is required`
const SCOPE_TEXT: Readonly<Record<string, string>> = {
  packages: 'validate and stage',
  media: 'validate and stage',
  waivers: 'validate and stage',
  'timeout-ms': 'stage, approve, publish, verify and masters',
  'dry-run': 'stage, approve, publish and masters',
  all: 'validate',
  'answers-stdin': 'approve',
  package: 'approve',
  feature: 'publish',
  snapshot: 'publish',
  unpublish: 'publish',
  takedown: 'publish',
  deep: 'verify',
  fixtures: 'approve, publish and verify',
  masters: 'masters',
  'expect-plan': 'stage and masters',
}
const outOfScope = (flag: string) => `usage: --${flag} is for ${SCOPE_TEXT[flag] ?? ''} only`

export interface ArgsContext {
  readonly cwd: string
  readonly storyboardRoot: string
  /**
   * The platform node reports for the run; win32 folds the in-site compare
   * (toUpperCase().toLowerCase()) and applies the D15-28 segment rule.
   */
  readonly platform: string
}

interface Paths {
  readonly packages: string
  readonly media: string
  readonly waivers: string
  readonly reportDir: string
}

interface ReportDirArg {
  readonly reportDir: string
  /** True when `--report-dir` was given; false for the default under storyboardRoot. */
  readonly reportDirGiven: boolean
}

export type ParsedArgs =
  | { readonly ok: true; readonly command: 'help'; readonly usage: string }
  | ({
      readonly ok: true
      readonly command: 'validate'
      /** True for --all; then `ids` is empty. */
      readonly all: boolean
      readonly ids: readonly string[]
      readonly reportDirGiven: boolean
    } & Paths)
  | ({
      readonly ok: true
      readonly command: 'stage'
      readonly ids: readonly string[]
      readonly dryRun: boolean
      /** Step 17 (D17-20): `--expect-plan`, 64 lowercase hex, or null when not given (L20-1). */
      readonly expectPlan: string | null
      readonly timeoutMs: number
      readonly reportDirGiven: boolean
    } & Paths)
  | ({
      readonly ok: true
      readonly command: 'approve'
      readonly storyId: string
      /** 12 to 64 lowercase hex: a prefix of the reviewed package's sha256 (D15-27). */
      readonly packagePrefix: string
      readonly answersStdin: boolean
      readonly dryRun: boolean
      /** True for `--fixtures` (Step 16, D16-14): the in-memory fixture dry run; needs dryRun. */
      readonly fixtures: boolean
      readonly timeoutMs: number
    } & ReportDirArg)
  | ({
      readonly ok: true
      readonly command: 'publish'
      readonly ids: readonly string[]
      /** True when `--feature` was given (`none` included). */
      readonly featureGiven: boolean
      /** The story id of `--feature`; null for `none` or when the flag was not given. */
      readonly feature: string | null
      /** The seq of `--snapshot`, or null. */
      readonly snapshot: number | null
      /** The story id of `--unpublish` (Step 15b, D15B-1), or null when the flag was not given. */
      readonly unpublish: string | null
      /** True for `--takedown`, which needs `--unpublish` (D15B-8). */
      readonly takedown: boolean
      readonly dryRun: boolean
      /** True for `--fixtures` (Step 16, D16-14): the in-memory fixture dry run; needs dryRun. */
      readonly fixtures: boolean
      readonly timeoutMs: number
    } & ReportDirArg)
  | ({
      readonly ok: true
      readonly command: 'verify'
      /** True for `--deep` (D15B-20). */
      readonly deep: boolean
      /** True for `--fixtures` (Step 16, D16-14): verify's fixture dry run (verify writes nothing). */
      readonly fixtures: boolean
      readonly timeoutMs: number
    } & ReportDirArg)
  | ({
      readonly ok: true
      readonly command: 'masters'
      /** The `--masters` root, resolved from cwd (D17-23). */
      readonly masters: string
      readonly dryRun: boolean
      /** `--expect-plan`, 64 lowercase hex; null only on a dry run (a commit needs it). */
      readonly expectPlan: string | null
      readonly timeoutMs: number
    } & ReportDirArg)
  | { readonly ok: false; readonly code: 'usage'; readonly message: string }

const usage = (message: string): ParsedArgs => ({ ok: false, code: 'usage', message })

const isStoryId = (id: string): boolean => StoryId.safeParse(id).success

/**
 * The id rules of each command (§3.1, §3.7; Step 15b §3.26), in order; null when they pass. publish:
 * takedown without unpublish, publish needs, unpublish with, snapshot with ids, the count, the form
 * and repeats; verify: any id is refused.
 */
function idRule(
  command: Exclude<Command, 'help'>,
  ids: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): string | null {
  const all = flags.has('all')
  if (command === 'verify') return ids.length > 0 ? MESSAGE.verifyIds : null
  if (command === 'masters') return ids.length > 0 ? MESSAGE.mastersIds : null
  if (command === 'validate') {
    if (all && ids.length > 0) return MESSAGE.allWithIds
    if (!all && ids.length === 0) return MESSAGE.idsOrAll
  }
  if (command === 'approve') {
    if (ids.length !== 1) return MESSAGE.approveOneId
  } else if (command === 'publish') {
    const unpublish = flags.has('unpublish')
    if (flags.has('takedown') && !unpublish) return MESSAGE.takedownNeeds
    if (ids.length === 0 && !flags.has('feature') && !flags.has('snapshot') && !unpublish) {
      return MESSAGE.publishNeeds
    }
    if (unpublish && (ids.length > 0 || flags.has('feature') || flags.has('snapshot'))) {
      return MESSAGE.unpublishWith
    }
    if (flags.has('snapshot') && ids.length > 0) return MESSAGE.snapshotWithIds
    if (ids.length > MAX_IDS) return MESSAGE.idCount
  } else if (!all && (ids.length === 0 || ids.length > MAX_IDS)) {
    return MESSAGE.idCount
  }
  if (!ids.every(isStoryId)) return MESSAGE.idInvalid
  if (new Set(ids).size !== ids.length) return MESSAGE.idTwice
  return null
}

/** Parses argv after the script name (design §3.11; Step 15a §3.1, §3.7). */
export function parseArgs(argv: readonly string[], context: ArgsContext): ParsedArgs {
  if (argv.some((arg) => arg === '' || arg.includes('\u0000'))) return usage(MESSAGE.empty)
  const name0 = argv[0]
  if (name0 === undefined) return usage(MESSAGE.noCommand)
  if (!COMMANDS.has(name0)) return usage(MESSAGE.command)
  const command = name0 as Command
  if (command === 'help') {
    return argv.length === 1
      ? { ok: true, command: 'help', usage: USAGE_TEXT }
      : usage(MESSAGE.helpArgs)
  }

  const flags = new Map<string, string | true>()
  const ids: string[] = []
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--') return usage(MESSAGE.bareDashes)
    if (!arg.startsWith('--')) {
      if (arg.startsWith('-')) return usage(MESSAGE.singleDash)
      ids.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    const kind = FLAGS.get(name)
    if (kind === undefined) return usage(MESSAGE.unknownFlag)
    if (flags.has(name)) return usage(repeated(name))
    if (kind === 'boolean') {
      if (eq !== -1) return usage(noValue(name))
      flags.set(name, true)
      continue
    }
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1)
    if (value === undefined || value === '' || value.startsWith('--')) {
      return usage(needsValue(name))
    }
    flags.set(name, value)
  }

  // The scope texts: the first flag (in argv order) given outside its commands.
  for (const name of flags.keys()) {
    if (!(SCOPE.get(name) ?? []).includes(command)) return usage(outOfScope(name))
  }
  const idProblem = idRule(command, ids, flags)
  if (idProblem !== null) return usage(idProblem)
  // Step 16 (D16-14): the fixture dry run of approve and publish is a dry run, after the id rules
  // and before the required flags.
  const fixtures = flags.has('fixtures')
  if (fixtures && (command === 'approve' || command === 'publish') && !flags.has('dry-run')) {
    return usage(MESSAGE.fixturesDryRun)
  }

  const text = (flag: string): string | undefined => {
    const value = flags.get(flag)
    return typeof value === 'string' ? value : undefined
  }
  if (command === 'validate' || command === 'stage') {
    if (text('packages') === undefined) return usage(required('packages'))
    if (text('media') === undefined) return usage(required('media'))
  }
  const packagePrefix = text('package')
  if (command === 'approve') {
    if (packagePrefix === undefined) return usage(required('package'))
    if (!/^[0-9a-f]{12,64}$/.test(packagePrefix)) return usage(MESSAGE.packageForm)
  }
  const snapshotText = text('snapshot')
  let snapshot: number | null = null
  if (snapshotText !== undefined) {
    if (!/^[1-9][0-9]{0,15}$/.test(snapshotText) || !Number.isSafeInteger(Number(snapshotText))) {
      return usage(MESSAGE.snapshotForm)
    }
    snapshot = Number(snapshotText)
  }
  const featureText = text('feature')
  if (featureText !== undefined && featureText !== 'none' && !isStoryId(featureText)) {
    return usage(MESSAGE.featureForm)
  }
  const unpublishText = text('unpublish')
  if (unpublishText !== undefined && !isStoryId(unpublishText)) {
    return usage(MESSAGE.unpublishForm)
  }
  // Step 17 (D17-20, D17-23): the masters root and the expected plan.
  const mastersText = text('masters')
  if (command === 'masters' && mastersText === undefined) return usage(required('masters'))
  const expectPlan = text('expect-plan') ?? null
  if (expectPlan !== null && !/^[0-9a-f]{64}$/.test(expectPlan)) return usage(MESSAGE.planForm)
  if (command === 'masters' && !flags.has('dry-run') && expectPlan === null) {
    return usage(MESSAGE.mastersNeedsPlan)
  }
  const masters = mastersText === undefined ? '' : resolve(context.cwd, mastersText)
  if (mastersText !== undefined) {
    // Both the given text and the resolved path: path.resolve makes `//host/x` a single `/` on
    // posix, and turns a drive-relative `m:x` into `m:\x` on win32.
    if (isDeviceOrNetworkPath(mastersText) || isDeviceOrNetworkPath(masters)) {
      return usage(MESSAGE.mastersDevice)
    }
    if (
      context.platform === 'win32' &&
      (hasUnstorableSegment(mastersText) || hasUnstorableSegment(masters))
    ) {
      return usage(MESSAGE.mastersSegment)
    }
  }

  const reportDirText = text('report-dir')
  const reportDirGiven = reportDirText !== undefined
  // With --fixtures the default gains one fixed segment, so a fixtures report never replaces a real
  // one (D16-14); the form and in-site checks below apply to it unchanged.
  const reportDir =
    reportDirText === undefined
      ? resolve(
          context.storyboardRoot,
          'migration-input',
          'reports',
          ...(fixtures ? ['fixtures'] : []),
        )
      : resolve(context.cwd, reportDirText)
  const formRefusal = reportDirFormRefusal(reportDir, reportDirGiven, context.platform)
  if (formRefusal !== null) return usage(formRefusal)
  if (insideSite(reportDir, context)) return usage(MESSAGE.reportDir)

  if (command === 'validate') {
    const waivers = text('waivers')
    return {
      ok: true,
      command,
      all: flags.has('all'),
      ids,
      packages: resolve(context.cwd, text('packages') ?? ''),
      media: resolve(context.cwd, text('media') ?? ''),
      waivers:
        waivers === undefined
          ? resolve(context.storyboardRoot, 'migration-input', 'waivers')
          : resolve(context.cwd, waivers),
      reportDir,
      reportDirGiven,
    }
  }
  const timeout = text('timeout-ms')
  let timeoutMs = TIMEOUT_MS_DEFAULT
  if (timeout !== undefined) {
    if (!/^[1-9][0-9]{0,5}$/.test(timeout) || Number(timeout) > TIMEOUT_MS_MAX) {
      return usage(MESSAGE.timeout)
    }
    timeoutMs = Number(timeout)
  }
  if (command === 'verify') {
    return {
      ok: true,
      command,
      deep: flags.has('deep'),
      fixtures,
      timeoutMs,
      reportDir,
      reportDirGiven,
    }
  }
  const dryRun = flags.has('dry-run')
  if (command === 'approve') {
    return {
      ok: true,
      command,
      storyId: ids[0] ?? '',
      packagePrefix: packagePrefix ?? '',
      answersStdin: flags.has('answers-stdin'),
      dryRun,
      fixtures,
      timeoutMs,
      reportDir,
      reportDirGiven,
    }
  }
  if (command === 'publish') {
    return {
      ok: true,
      command,
      ids,
      featureGiven: featureText !== undefined,
      feature: featureText === undefined || featureText === 'none' ? null : featureText,
      snapshot,
      unpublish: unpublishText ?? null,
      takedown: flags.has('takedown'),
      dryRun,
      fixtures,
      timeoutMs,
      reportDir,
      reportDirGiven,
    }
  }
  if (command === 'masters') {
    return {
      ok: true,
      command,
      masters,
      dryRun,
      expectPlan,
      timeoutMs,
      reportDir,
      reportDirGiven,
    }
  }
  const waivers = text('waivers')
  return {
    ok: true,
    command: 'stage',
    ids,
    dryRun,
    expectPlan,
    timeoutMs,
    packages: resolve(context.cwd, text('packages') ?? ''),
    media: resolve(context.cwd, text('media') ?? ''),
    waivers:
      waivers === undefined
        ? resolve(context.storyboardRoot, 'migration-input', 'waivers')
        : resolve(context.cwd, waivers),
    reportDir,
    reportDirGiven,
  }
}

/**
 * True for a win32 device-namespace (`\\?\`, `\\.\`) or network (`\\host\share`) form, written
 * with `\` or `/` (D15-23). Such a form keeps its prefix through path.resolve and node:fs opens it,
 * so no string compare can place it (SEC1-1). A resolved posix path starts with one '/'.
 */
export function isDeviceOrNetworkPath(resolved: string): boolean {
  return resolved.startsWith('\\\\') || resolved.startsWith('//')
}

/** Reserved device names Windows maps whatever the extension (D15-28), upper case. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'CONIN$',
  'CONOUT$',
  ...['COM', 'LPT'].flatMap((stem) =>
    ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '¹', '²', '³'].map(
      (digit) => `${stem}${digit}`,
    ),
  ),
])
const RESERVED_CHARACTERS = '<>"|?*'

/**
 * True when a segment of the path cannot be stored as written on Windows (D15-28): Node's fs
 * passes `\\?\` paths, so Win32 neither strips a trailing dot or space nor maps a device name, and
 * a `:` names a stream. The first segment may be a drive prefix `X:`. Exported with this body
 * unchanged for Step 15b's hash-list line rule (D15B-9 rule 6).
 */
export function hasUnstorableSegment(path: string): boolean {
  return path.split(/[\\/]/).some((segment, index) => {
    if (segment === '') return false
    if (segment.endsWith('.') || segment.endsWith(' ')) return true
    const drive = index === 0 && /^[A-Za-z]:$/.test(segment)
    if (!drive && segment.includes(':')) return true
    for (const ch of segment) {
      if (ch.charCodeAt(0) < 0x20 || RESERVED_CHARACTERS.includes(ch)) return true
    }
    const dot = segment.indexOf('.')
    const stem = (dot === -1 ? segment : segment.slice(0, dot)).replace(/ +$/, '')
    return RESERVED_NAMES.has(stem.toUpperCase())
  })
}

/**
 * The report-dir form refusal for a resolved path (D15-23, D15-28), or null: a device or network
 * form first (the flag or the default text), then, on platform win32, a segment Windows cannot
 * store as written. Pure, so both texts run on every host; the text never holds the path.
 */
export function reportDirFormRefusal(
  resolved: string,
  given: boolean,
  platform: string,
): string | null {
  if (isDeviceOrNetworkPath(resolved)) {
    return given ? MESSAGE.reportDirDevice : MESSAGE.reportDirDeviceDefault
  }
  if (platform === 'win32' && hasUnstorableSegment(resolved)) {
    return given ? MESSAGE.reportDirSegment : MESSAGE.reportDirSegmentDefault
  }
  return null
}

/**
 * True when the resolved report dir is `<storyboardRoot>/public` or `<storyboardRoot>/app`, or
 * under either (D14-25): compared after path.resolve, on win32 folded with
 * `toUpperCase().toLowerCase()` as NTFS's upcase table folds U+0131 and U+017F (D15-28). This is
 * the string half; the runners compare the real paths before any work (report.ts
 * checkedReportDir), which also sees a cwd reached through a junction or subst drive (L24).
 */
function insideSite(dir: string, context: ArgsContext): boolean {
  const fold = (path: string) =>
    context.platform === 'win32' ? path.toUpperCase().toLowerCase() : path
  const target = fold(dir)
  return ['public', 'app'].some((name) => {
    const base = fold(resolve(context.storyboardRoot, name))
    return target === base || target.startsWith(base + sep)
  })
}

/** The names whose presence refuses stage (D14-10); matched without regard to case on win32. */
export const RUN_CONTEXT_NAMES: readonly string[] = ['GITHUB_ACTIONS', 'VERCEL', 'VERCEL_ENV']

/**
 * The run context, captured from the environment of the run before any env file loads (D14-17): a
 * new null-prototype object holding each own enumerable string key of `env` named GITHUB_ACTIONS,
 * VERCEL or VERCEL_ENV (any case on win32, as the environment matches names there), under its own
 * spelling, with its value. An empty value is kept (it counts as set). `env` is read once, never
 * returned.
 */
export function captureRunContext(
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
): Readonly<Record<string, string | undefined>> {
  const context = Object.create(null) as Record<string, string | undefined>
  for (const [key, value] of Object.entries(env)) {
    const name = platform === 'win32' ? key.toUpperCase() : key
    if (RUN_CONTEXT_NAMES.includes(name)) context[key] = value
  }
  return context
}
