// pnpm publisher (design migration-input/p1-step14-design.md §3.11 D14-1, D14-10, D14-17, §4.3 step 1,
// §5; P1-8c, Step 14): `validate (<id>... | --all)`, `stage <id>... [--dry-run]` and `help`.
// - runCli takes every effect as a dependency and holds no default client factory, so a test can
//   never build a real client. validate never builds a client and never loads the env file.
// - stage, in this order, before any client exists: parse; stage-here-only from the run context
//   captured before the env file loads (win32, and GITHUB_ACTIONS, VERCEL and VERCEL_ENV unset, an
//   empty value counting as set, names without regard to case); the env file once (one that cannot
//   be loaded is a configuration stop named by role); the Storage credentials (problems by name
//   only); the project check against MEDIA_ORIGIN. Each stop is exit 2 and writes no report.
// - A throw that escapes validate or stage prints `<command>: stopped: internal <class name>` and is
//   exit 1, so the entry block's rejection handler never ends a run in silence.
// - This is the only module that builds the Storage client, and it holds it as a StagePort, so a
//   result kind the client adds and the port lacks is a compile error here (fence F1, one row).
// - The entry block runs only as the process entry point; it captures the run context first.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEntryPoint } from '../../scripts/load-content'
import { MEDIA_ORIGIN } from '../../src/config/security-headers'
import { RUN_CONTEXT_NAMES, captureRunContext, parseArgs } from './args'
import { loadEnvFile, readStorageCredentials } from './env'
import type { StagePort } from './port'
import { internalLine, runStage, runValidate, stopLine } from './stage'
import { createStorageClient, type StorageClient, type StorageClientOptions } from './storage'

type Values = Readonly<Record<string, string | undefined>>

/** The env file named by its role only: never its path or the loader's error text (FID-3). */
const ENV_FILE_UNREADABLE = 'stage: the env file could not be loaded'

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
  /** Loads the env file into `env`; called once, only for a stage command that may run here. */
  readonly loadEnv: () => unknown
  readonly createClient: (options: StorageClientOptions) => StorageClient
}

/** stage runs on this PC only (D14-10): win32 and none of the three names set, in any case. */
function stageAllowedHere(runContext: Values, platform: string): boolean {
  if (platform !== 'win32') return false
  return !Object.entries(runContext).some(
    ([name, value]) => value !== undefined && RUN_CONTEXT_NAMES.includes(name.toUpperCase()),
  )
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
  const guarded = async (command: 'validate' | 'stage', run: () => Promise<number>) => {
    try {
      return await run()
    } catch (thrown) {
      deps.log(internalLine(command, thrown))
      return 1
    }
  }
  if (parsed.command === 'validate') return guarded('validate', () => runValidate(parsed, output))

  if (!stageAllowedHere(deps.runContext, deps.platform)) {
    deps.log(stopLine('stage', 'stage-here-only'))
    return 2
  }
  try {
    deps.loadEnv()
  } catch {
    deps.log(stopLine('stage', 'configuration'))
    deps.error(ENV_FILE_UNREADABLE)
    return 2
  }
  const credentials = readStorageCredentials(deps.env)
  if (!credentials.ok) {
    deps.log(stopLine('stage', 'configuration'))
    deps.error(`stage: ${credentials.reason}`)
    return 2
  }
  const { supabaseUrl, secretKey } = credentials.value
  if (supabaseUrl.origin !== MEDIA_ORIGIN) {
    deps.log(stopLine('stage', 'project-mismatch'))
    return 2
  }
  return guarded('stage', () =>
    runStage(parsed, {
      ...output,
      sleep: deps.sleep,
      makePort: () => {
        const client = deps.createClient({ supabaseUrl, secretKey, timeoutMs: parsed.timeoutMs })
        const port: StagePort = client
        return port
      },
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
