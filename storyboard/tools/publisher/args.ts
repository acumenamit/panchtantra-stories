// The publisher's argument parser and run context (design migration-input/p1-step14-design.md
// §3.11 D14-1, D14-17, D14-25; P1-8c, Step 14). Pure: no file, no environment, no clock. Flags are
// held in a Map, so prototype names (`--__proto__`, `--constructor`, `--toString`) are unknown
// flags. Every message names a flag or a rule from the fixed table, never an input value.
import { resolve, sep } from 'node:path'
import { StoryId } from '../../src/core/package/v1'

export const USAGE_TEXT = [
  'usage: corepack pnpm publisher <command>',
  '  validate (<id>... | --all) --packages <dir> --media <dir> [--waivers <dir>] [--report-dir <dir>]',
  '  stage <id>... --packages <dir> --media <dir> [--waivers <dir>] [--report-dir <dir>] [--dry-run] [--timeout-ms <n>]',
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
])
const COMMANDS: ReadonlySet<string> = new Set(['help', 'validate', 'stage'])

const MESSAGE = {
  empty: 'usage: an argument is empty or holds a NUL character',
  noCommand: 'usage: no command (validate, stage or help)',
  command: 'usage: unknown command (validate, stage or help)',
  helpArgs: 'usage: help takes no arguments',
  bareDashes: 'usage: a bare -- is not allowed',
  singleDash: 'usage: single-dash flags are not supported',
  unknownFlag: 'usage: unknown flag',
  allForValidate: 'usage: --all is for validate only',
  allWithIds: 'usage: --all cannot be combined with story ids',
  idsOrAll: 'usage: validate needs story ids or --all',
  idCount: 'usage: give 1 to 64 story ids',
  idInvalid: 'usage: a story id must be 3 to 64 characters of a-z, 0-9 and single hyphens',
  idTwice: 'usage: a story id is given more than once',
  timeout: 'usage: --timeout-ms must be a whole number from 1 to 600000',
  reportDir: 'usage: --report-dir may not be at or under public/ or app/ of the storyboard folder',
  reportDirDevice: 'usage: --report-dir may not be a device or network path',
} as const
// The flag-named messages take a name from FLAGS, never the argument as typed.
const repeated = (flag: string) => `usage: --${flag} is given more than once`
const noValue = (flag: string) => `usage: --${flag} takes no value`
const needsValue = (flag: string) =>
  `usage: --${flag} needs a value that is not empty and does not start with --`
const stageOnly = (flag: string) => `usage: --${flag} is for stage only`
const required = (flag: string) => `usage: --${flag} is required`

export interface ArgsContext {
  readonly cwd: string
  readonly storyboardRoot: string
  /** The platform node reports for the run; win32 compares the report dir without regard to case. */
  readonly platform: string
}

interface Paths {
  readonly packages: string
  readonly media: string
  readonly waivers: string
  readonly reportDir: string
}

export type ParsedArgs =
  | { readonly ok: true; readonly command: 'help'; readonly usage: string }
  | ({
      readonly ok: true
      readonly command: 'validate'
      /** True for --all; then `ids` is empty. */
      readonly all: boolean
      readonly ids: readonly string[]
    } & Paths)
  | ({
      readonly ok: true
      readonly command: 'stage'
      readonly ids: readonly string[]
      readonly dryRun: boolean
      readonly timeoutMs: number
    } & Paths)
  | { readonly ok: false; readonly code: 'usage'; readonly message: string }

const usage = (message: string): ParsedArgs => ({ ok: false, code: 'usage', message })

/** Parses argv after the script name (design §3.11). */
export function parseArgs(argv: readonly string[], context: ArgsContext): ParsedArgs {
  if (argv.some((arg) => arg === '' || arg.includes('\u0000'))) return usage(MESSAGE.empty)
  const command = argv[0]
  if (command === undefined) return usage(MESSAGE.noCommand)
  if (!COMMANDS.has(command)) return usage(MESSAGE.command)
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

  const all = flags.has('all')
  if (command === 'stage' && all) return usage(MESSAGE.allForValidate)
  if (command === 'validate') {
    for (const flag of ['dry-run', 'timeout-ms']) if (flags.has(flag)) return usage(stageOnly(flag))
    if (all && ids.length > 0) return usage(MESSAGE.allWithIds)
    if (!all && ids.length === 0) return usage(MESSAGE.idsOrAll)
  }
  if (!all && (ids.length === 0 || ids.length > MAX_IDS)) return usage(MESSAGE.idCount)
  if (!ids.every((id) => StoryId.safeParse(id).success)) return usage(MESSAGE.idInvalid)
  if (new Set(ids).size !== ids.length) return usage(MESSAGE.idTwice)

  const text = (flag: string): string | undefined => {
    const value = flags.get(flag)
    return typeof value === 'string' ? value : undefined
  }
  const packages = text('packages')
  const media = text('media')
  if (packages === undefined) return usage(required('packages'))
  if (media === undefined) return usage(required('media'))
  const waivers = text('waivers')
  const reportDir = text('report-dir')
  const paths: Paths = {
    packages: resolve(context.cwd, packages),
    media: resolve(context.cwd, media),
    waivers:
      waivers === undefined
        ? resolve(context.storyboardRoot, 'migration-input', 'waivers')
        : resolve(context.cwd, waivers),
    reportDir:
      reportDir === undefined
        ? resolve(context.storyboardRoot, 'migration-input', 'reports')
        : resolve(context.cwd, reportDir),
  }
  // A win32 device-namespace (\\?\, \\.\) or network (\\host\share) form keeps its prefix through
  // path.resolve, and node:fs opens it, so no string compare can place it (SEC1-1): refused as a
  // form. A resolved posix path always starts with one '/', so this never refuses there.
  if (paths.reportDir.startsWith('\\\\')) return usage(MESSAGE.reportDirDevice)
  if (insideSite(paths.reportDir, context)) return usage(MESSAGE.reportDir)

  if (command === 'validate') return { ok: true, command, all, ids, ...paths }
  const timeout = text('timeout-ms')
  let timeoutMs = TIMEOUT_MS_DEFAULT
  if (timeout !== undefined) {
    if (!/^[1-9][0-9]{0,5}$/.test(timeout) || Number(timeout) > TIMEOUT_MS_MAX) {
      return usage(MESSAGE.timeout)
    }
    timeoutMs = Number(timeout)
  }
  return { ok: true, command: 'stage', ids, dryRun: flags.has('dry-run'), timeoutMs, ...paths }
}

/**
 * True when the resolved report dir is `<storyboardRoot>/public` or `<storyboardRoot>/app`, or
 * under either (D14-25): compared after path.resolve, without regard to case on win32. This is the
 * string half; stage.ts compares the real paths before any work (report.ts reportDirInSite), which
 * also sees a cwd reached through a junction or subst drive (SEC1-1, L15).
 */
function insideSite(dir: string, context: ArgsContext): boolean {
  const fold = (path: string) => (context.platform === 'win32' ? path.toLowerCase() : path)
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
