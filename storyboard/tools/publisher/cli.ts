// pnpm publisher (design migration-input/p1-step14-design.md §3.11 D14-1, D14-10, D14-17, §4.3 step 1,
// §5; P1-8c, Step 14; and migration-input/p1-step15a-design.md §3.15, §3.16, §4.1, §4.2, D15-3,
// D15-15, D15-16, D15-18, D15-30, TP-2; P1-8d part a, Step 15a): `validate (<id>... | --all)`,
// `stage <id>... [--dry-run]`, `approve <id> --package <prefix>`, `publish [<id>...] [--feature]
// [--snapshot]` and `help`.
// - runCli takes every effect as a dependency and holds no default client factory, hook or verify
//   function, so a test can never build a real client or reach Vercel. validate never builds a
//   client and never loads the env file.
// - stage, in this order, before any client exists: parse; stage-here-only from the run context
//   captured before the env file loads (win32, and GITHUB_ACTIONS, VERCEL and VERCEL_ENV unset, an
//   empty value counting as set, names without regard to case); the env file once (one that cannot
//   be loaded is a configuration stop named by role); the Storage credentials (problems by name
//   only); the project check against MEDIA_ORIGIN. Each stop is exit 2 and writes no report.
// - approve and publish (D15-15): run-context-refused unless no VERCEL or VERCEL_ENV is set and
//   either win32 without GITHUB_ACTIONS (pc mode, this PC) or linux with GITHUB_ACTIONS exactly
//   `true` (actions mode). In actions mode no env file is loaded, `--report-dir` is refused and no
//   report is written. approve's answer channel is decided before the env file (--answers-stdin, or
//   prompts on a TTY in pc mode; else answers-missing with the fixed line); stdin is opened for
//   approve only. publish reads the deploy hook URL and the site URL after the credentials and the
//   project check, before any client (names only), and hands runPublish a structural tail adapted
//   from the injected hook and verify functions.
// - A throw that escapes a runner prints `<command>: stopped: internal <class name>` and is exit 1,
//   so the entry block's rejection handler never ends a run in silence.
// - This is the only module that builds the Storage client, and it holds it as a StagePort,
//   ApprovePort or PublishPort, so a result kind the client adds and the port lacks, or a write the
//   command may not make, is a compile error here (fence F1, one row).
// - The entry block runs only as the process entry point; it captures the run context first. Its
//   stdin deadline timer is unref'd, so a run that read its answers never waits for it (D15-30).
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEntryPoint } from '../../scripts/load-content'
import { MEDIA_ORIGIN } from '../../src/config/security-headers'
import { RUN_CONTEXT_NAMES, captureRunContext, parseArgs } from './args'
import { runApprove, type ApproveAnswers, type ApproveStdin } from './approve'
import { loadEnvFile, readStorageCredentials } from './env'
import { readDeployHookUrl, readSiteUrl } from './env'
import { triggerDeployHook, type HookOptions, type HookResult } from './hook'
import type { ApprovePort, PublishPort, StagePort } from './port'
import { runPublish, type PublishTail } from './publish'
import { internalLine, stopLine } from './run-kit'
import { runStage, runValidate } from './stage'
import { createStorageClient, type StorageClient, type StorageClientOptions } from './storage'
import { verifyPublish, type VerifyOptions, type VerifyOutcome } from './verify'

type Values = Readonly<Record<string, string | undefined>>
type Command = 'validate' | 'stage' | 'approve' | 'publish'

/** The fixed stderr line when approve has no answer channel (TP-2). */
const NO_ANSWER_CHANNEL = 'approve: stdin is not a terminal; pass --answers-stdin'
/** The fixed stderr line for --report-dir in actions mode (TP-2). */
const REPORT_DIR_IN_ACTIONS = 'usage: --report-dir is not used in GitHub Actions'
/** The stdin deadline of the entry block (D15-3). */
const STDIN_DEADLINE_MS = 30_000

export interface CliDeps {
  /** The environment the credentials are read from, after the env file loaded into it. */
  readonly env: Values
  /** GITHUB_ACTIONS, VERCEL and VERCEL_ENV as the run started, before any env file (D14-17). */
  readonly runContext: Values
  readonly platform: string
  readonly cwd: string
  readonly storyboardRoot: string
  readonly now: () => Date
  readonly sleep: (ms: number) => Promise<void>
  readonly log: (line: string) => void
  readonly error: (line: string) => void
  /** Loads the env file into `env`; called once, only for a command that may run here in pc mode. */
  readonly loadEnv: () => unknown
  readonly createClient: (options: StorageClientOptions) => StorageClient
  /** approve only: the process's stdin (opened once its answer channel is known). */
  readonly openStdin: () => ApproveStdin
  /** approve only: whether stdin is a terminal (prompts in pc mode). */
  readonly stdinIsTTY: () => boolean
  /** approve only: writes a prompt question (stderr). */
  readonly promptWrite: (text: string) => void
  /** approve --answers-stdin only: resolves when the stdin deadline passed. */
  readonly stdinDeadline: () => Promise<void>
  /** publish only: the deploy hook trigger (no default; the entry block passes hook.ts's). */
  readonly triggerHook: (options: HookOptions) => Promise<HookResult>
  /** publish only: the live check (no default; the entry block passes verify.ts's). */
  readonly verify: (options: VerifyOptions) => Promise<VerifyOutcome>
}

/** stage runs on this PC only (D14-10): win32 and none of the three names set, in any case. */
function stageAllowedHere(runContext: Values, platform: string): boolean {
  if (platform !== 'win32') return false
  return !Object.entries(runContext).some(
    ([name, value]) => value !== undefined && RUN_CONTEXT_NAMES.includes(name.toUpperCase()),
  )
}

/**
 * Where approve and publish may run (D15-15), from the run context captured before any env file
 * (names folded with toUpperCase, an empty value counting as set): pc mode on win32 with none of
 * GITHUB_ACTIONS, VERCEL and VERCEL_ENV set; actions mode on linux with GITHUB_ACTIONS exactly
 * `true` and neither VERCEL nor VERCEL_ENV set; else null (run-context-refused).
 */
function commandAllowedHere(runContext: Values, platform: string): 'pc' | 'actions' | null {
  const values = (name: string) =>
    Object.entries(runContext)
      .filter(([key, value]) => value !== undefined && key.toUpperCase() === name)
      .map(([, value]) => value)
  if (values('VERCEL').length > 0 || values('VERCEL_ENV').length > 0) return null
  const actions = values('GITHUB_ACTIONS')
  if (platform === 'win32' && actions.length === 0) return 'pc'
  if (platform === 'linux' && actions.length > 0 && actions.every((value) => value === 'true')) {
    return 'actions'
  }
  return null
}

/** Runs one command; resolves to the process exit code (§5). */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const parsed = parseArgs(argv, {
    cwd: deps.cwd,
    storyboardRoot: deps.storyboardRoot,
    platform: deps.platform,
  })
  if (!parsed.ok) {
    deps.error(parsed.message)
    return 2
  }
  if (parsed.command === 'help') {
    deps.log(parsed.usage)
    return 0
  }
  const output = {
    storyboardRoot: deps.storyboardRoot,
    platform: deps.platform,
    now: deps.now,
    log: deps.log,
    error: deps.error,
  }
  /** A throw that escapes a runner prints internal with its class name only, exit 1 (FID-3). */
  const guarded = async (command: Command, run: () => Promise<number>) => {
    try {
      return await run()
    } catch (thrown) {
      deps.log(internalLine(command, thrown))
      return 1
    }
  }
  if (parsed.command === 'validate') return guarded('validate', () => runValidate(parsed, output))
  const command = parsed.command

  // Where the command may run, before any env file (D14-10, D15-15).
  let runMode: 'pc' | 'actions' = 'pc'
  if (command === 'stage') {
    if (!stageAllowedHere(deps.runContext, deps.platform)) {
      deps.log(stopLine('stage', 'stage-here-only'))
      return 2
    }
  } else {
    const allowed = commandAllowedHere(deps.runContext, deps.platform)
    if (allowed === null) {
      deps.log(stopLine(command, 'run-context-refused'))
      return 2
    }
    runMode = allowed
    if (runMode === 'actions' && parsed.reportDirGiven) {
      deps.error(REPORT_DIR_IN_ACTIONS)
      return 2
    }
  }
  // approve's answer channel, before the env file (D15-3, TP-2); stdin is opened later.
  let channel: 'stdin' | 'prompt' | null = null
  if (parsed.command === 'approve') {
    if (parsed.answersStdin) channel = 'stdin'
    else if (runMode === 'pc' && deps.stdinIsTTY()) channel = 'prompt'
    else {
      deps.log(stopLine('approve', 'answers-missing'))
      deps.error(NO_ANSWER_CHANNEL)
      return 2
    }
  }
  if (runMode === 'pc') {
    try {
      deps.loadEnv()
    } catch {
      deps.log(stopLine(command, 'configuration'))
      deps.error(`${command}: the env file could not be loaded`)
      return 2
    }
  }
  const credentials = readStorageCredentials(deps.env)
  if (!credentials.ok) {
    deps.log(stopLine(command, 'configuration'))
    deps.error(`${command}: ${credentials.reason}`)
    return 2
  }
  const { supabaseUrl, secretKey } = credentials.value
  if (supabaseUrl.origin !== MEDIA_ORIGIN) {
    deps.log(stopLine(command, 'project-mismatch'))
    return 2
  }
  const clientOptions = { supabaseUrl, secretKey, timeoutMs: parsed.timeoutMs }

  if (parsed.command === 'stage') {
    return guarded('stage', () =>
      runStage(parsed, {
        ...output,
        sleep: deps.sleep,
        makePort: () => {
          const client = deps.createClient(clientOptions)
          const port: StagePort = client
          return port
        },
      }),
    )
  }

  if (parsed.command === 'approve') {
    const input = deps.openStdin()
    const answers: ApproveAnswers =
      channel === 'stdin'
        ? { kind: 'stdin', input, deadline: deps.stdinDeadline() }
        : { kind: 'prompt', input, write: deps.promptWrite }
    return guarded('approve', () =>
      runApprove(parsed, {
        ...output,
        sleep: deps.sleep,
        runMode,
        makePort: () => {
          const client = deps.createClient(clientOptions)
          const port: ApprovePort = client
          return port
        },
        answers,
      }),
    )
  }

  // publish: the hook and site URLs before any client (D15-16), names only.
  const hookUrl = readDeployHookUrl(deps.env)
  if (!hookUrl.ok) {
    deps.log(stopLine('publish', 'configuration'))
    deps.error(`publish: ${hookUrl.reason}`)
    return 2
  }
  const siteUrl = readSiteUrl(deps.env)
  if (!siteUrl.ok) {
    deps.log(stopLine('publish', 'configuration'))
    deps.error(`publish: ${siteUrl.reason}`)
    return 2
  }
  const tail: PublishTail = {
    hook: async () => (await deps.triggerHook({ hookUrl: hookUrl.value, log: deps.log })).kind,
    verify: async (expectedSeq, absentStoryIds) => {
      const outcome = await deps.verify({
        siteUrl: siteUrl.value,
        expectedSeq,
        log: deps.log,
        sleep: deps.sleep,
        now: () => deps.now().getTime(),
        ...(absentStoryIds === undefined ? {} : { absentStoryIds }),
      })
      return outcome.kind === 'timeout'
        ? { kind: 'timeout' }
        : { kind: outcome.kind, seq: outcome.sample.seq }
    },
  }
  return guarded('publish', () =>
    runPublish(parsed, {
      ...output,
      sleep: deps.sleep,
      runMode,
      makePort: () => {
        const client = deps.createClient(clientOptions)
        const port: PublishPort = client
        return port
      },
      tail,
    }),
  )
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const runContext = captureRunContext(process.env, process.platform)
  const deps: CliDeps = {
    env: process.env,
    runContext,
    platform: process.platform,
    cwd: process.cwd(),
    storyboardRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
    now: () => new Date(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    loadEnv: loadEnvFile,
    createClient: createStorageClient,
    openStdin: () => process.stdin,
    stdinIsTTY: () => process.stdin.isTTY === true,
    promptWrite: (text) => void process.stderr.write(text),
    stdinDeadline: () => new Promise((done) => setTimeout(done, STDIN_DEADLINE_MS).unref()),
    triggerHook: triggerDeployHook,
    verify: verifyPublish,
  }
  runCli(process.argv.slice(2), deps).then(
    (code) => {
      process.exitCode = code
    },
    () => {
      process.exitCode = 1
    },
  )
}
