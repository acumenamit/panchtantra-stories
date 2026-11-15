// `pnpm preview:staging` (spec §3.2 staging row, §8 publish sequence; design p1-step9-design.md
// §3.4 C5-c, §3.6 rows 22-28, §6.1-§6.5, §9 item 9; P1-2c). The owner runs it on this PC, in
// storyboard, in PowerShell: `corepack pnpm preview:staging`. It reviews staged stories on the LAN:
// 1. Refusals (exit 2): VERCEL, VERCEL_ENV, the launch variable, CONTENT_SOURCE, CONTENT_POINTER or
//    CONTENT_BASE_URL preset in the shell (even empty), GITHUB_ACTIONS=true (CI uses
//    scripts/testing/staging-build.ts) and any argument. Each message names only the variable and
//    how to clear it in PowerShell, because a value set earlier in the same window stays set.
// 2. The three steps of `build` (BUILD_STEPS, pinned against package.json by
//    package-scripts.test.ts), then the mode check (runStagingSteps):
//    - the loader, in-process, with CONTENT_SOURCE=storage, CONTENT_POINTER=catalogue/staging.json
//      and the committed public base, and no Vercel variable (a staging pointer loads outside a
//      Preview only on Windows or in GitHub Actions, design §3.3);
//    - next build, spawned as `process.execPath <next/dist/bin/next>` with no shell (pnpm is not on
//      PATH here: corepack), and check-build, in-process, both as a declared simulated Preview:
//      CONTENT_SOURCE=storage, VERCEL_ENV=preview and the launch variable set to review, so the
//      reader is open; no CONTENT_BASE_URL or CONTENT_POINTER. launch.ts is unchanged;
//    - the mode check: .content/build-info.json must name mode staging.
//    Any failure prints "preview:staging: stopped at <step>; nothing is served" and passes the exit
//    code through; after a loader failure a fixed hint line follows.
// 3. `next start --port 3006 --hostname 0.0.0.0` with the parent env unchanged (next start runs no
//    launch or base check). Ctrl+C stops it: on Windows the child shares the console and gets
//    Ctrl+C itself, so the wrapper ignores SIGINT and waits for its exit (no orphaned server);
//    elsewhere the wrapper forwards it. The exit code passes through.
// Log lines hold enums and URLs only, never an env value. The output lives in this PC's .next and
// is never deployed (the standing ban on `vercel deploy --prebuilt`).
import { spawn, type SpawnOptions } from 'node:child_process'
import { createRequire } from 'node:module'
import { networkInterfaces } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTENT_PUBLIC_BASE } from '../src/config/security-headers'
import {
  readContentMode,
  readContentOutputs,
  runCheckBuild,
  type CheckBuildOptions,
} from './check-build'
import { isEntryPoint, loadContent, type Env, type LoaderOptions } from './load-content'

/** Dev, start and e2e own 3005 (package.json, playwright.config.ts); the LAN preview uses 3006. */
export const PREVIEW_PORT = 3006
/** next start's default, stated (design §3.6 row 25). */
export const PREVIEW_HOSTNAME = '0.0.0.0'
/** The staging pointer (spec §3.2), relative to the committed public base. */
export const STAGING_POINTER = 'catalogue/staging.json'

/** The three steps of package.json `build`, in order (drift guard, design §3.6 row 24). */
export const BUILD_STEPS = [
  'tsx scripts/load-content.ts',
  'next build',
  'tsx scripts/check-build.ts',
] as const

/**
 * next's arguments for the build step, read from BUILD_STEPS[1] (without its leading `next`), so a
 * flag added to `build`'s next step reaches runStagingSteps once the drift guard is updated. The
 * loader and check-build run in-process and take no arguments.
 */
export const NEXT_BUILD_ARGS: readonly string[] = BUILD_STEPS[1].split(' ').slice(1)

/** The arguments of the one next start (design §6.1 main step 4). */
export const START_ARGS = [
  'start',
  '--port',
  String(PREVIEW_PORT),
  '--hostname',
  PREVIEW_HOSTNAME,
] as const

/** Variables a preview:staging run sets itself, refused when preset (design §3.6 row 26). */
const PRESET_NAMES = [
  'VERCEL',
  'VERCEL_ENV',
  'READER_LAUNCH',
  'CONTENT_SOURCE',
  'CONTENT_POINTER',
  'CONTENT_BASE_URL',
] as const

/** The loader reads these; next build must not see them (a non-media base would stop it). */
const LOADER_ONLY: readonly string[] = ['CONTENT_BASE_URL', 'CONTENT_POINTER']

/** The steps runStagingSteps names when it stops. */
export const STAGING_STEPS = ['load-content', 'next build', 'check-build', 'mode check'] as const
export type StagingStep = (typeof STAGING_STEPS)[number]

/** After any loader failure (a fixed string: nothing parses the loader's output). */
export const LOADER_HINT =
  'if catalogue/staging.json does not exist yet: `stage` writes it (P1 Step 14)'

export const SIMULATED_LINE =
  'preview:staging: simulated Preview build of catalogue/staging.json (reader open, banner on every page, noindex); never deployed'

export const PLAIN_HTTP_LINE =
  'plain HTTP: anyone on this Wi-Fi can open it while it runs; Ctrl+C stops it'

/** The line that ends a run that served nothing. */
export const stoppedLine = (step: StagingStep): string =>
  `preview:staging: stopped at ${step}; nothing is served`

/**
 * The refusals of design §3.6 row 26, one line each, in a fixed order; empty when the run may go
 * on. A preset variable is refused even when empty. Lines name the variable, never its value or an
 * argument's text.
 */
export function checkPreviewEnv(parent: Env, argv: readonly string[]): string[] {
  const refusals: string[] = []
  const clear = (name: string) => `run Remove-Item Env:${name} or open a new window`
  for (const name of PRESET_NAMES) {
    if (parent[name] !== undefined) {
      refusals.push(`preview:staging: refused: ${name} is set in this shell; ${clear(name)}`)
    }
  }
  if (parent.GITHUB_ACTIONS === 'true') {
    refusals.push(
      `preview:staging: refused: GITHUB_ACTIONS is true in this shell (CI builds staging with scripts/testing/staging-build.ts); ${clear('GITHUB_ACTIONS')}`,
    )
  }
  if (argv.length > 0) {
    refusals.push(
      `preview:staging: refused: it takes no arguments (found ${argv.length}); run corepack pnpm preview:staging alone`,
    )
  }
  return refusals
}

export interface StagingEnvs {
  /** For the loader only: the staging pointer and its base; no Vercel variable. */
  readonly loader: Env
  /** For next build and check-build: a declared simulated Preview with the reader open. */
  readonly build: Env
}

/** The two environments of design §6.1, from the parent's (which is never changed). */
export function stagingEnvs(parent: Env, loaderBase: string): StagingEnvs {
  const loader: Env = {
    ...parent,
    CONTENT_SOURCE: 'storage',
    CONTENT_POINTER: STAGING_POINTER,
    CONTENT_BASE_URL: loaderBase,
  }
  const inherited = Object.fromEntries(
    Object.entries(parent).filter(([name]) => !LOADER_ONLY.includes(name)),
  )
  const build: Env = {
    ...inherited,
    CONTENT_SOURCE: 'storage',
    VERCEL_ENV: 'preview',
    READER_LAUNCH: 'review',
  }
  return { loader, build }
}

/** Spawns next with these arguments and this env; resolves with its exit code. */
export type SpawnNext = (args: readonly string[], env: Env) => Promise<number>

export interface StagingStepsOptions {
  /** The storyboard folder: .content, .next and public/build-info.json live under it. */
  readonly root: string
  readonly loaderEnv: Env
  readonly buildEnv: Env
  /** loadContent, or a test fake. */
  readonly load: (options: LoaderOptions) => Promise<number>
  readonly spawnNext: SpawnNext
  /** runCheckBuild, or a test fake. */
  readonly checkBuild: (options: CheckBuildOptions) => number
  readonly log: (line: string) => void
  readonly logError: (line: string) => void
}

/**
 * The build's three steps, then the mode check (design §6.1, §3.6 row 28). Stops at the first
 * step that fails: prints the stop line (and, after the loader, the hint) and returns that step's
 * exit code; a mode other than staging returns 1. Returns 0 only when all four passed.
 */
export async function runStagingSteps(options: StagingStepsOptions): Promise<number> {
  const { root, log, logError } = options
  const stop = (step: StagingStep, code: number): number => {
    logError(stoppedLine(step))
    return code
  }
  const loaded = await options.load({ root, env: options.loaderEnv, log, logError })
  if (loaded !== 0) {
    stop('load-content', loaded)
    logError(LOADER_HINT)
    return loaded
  }
  const built = await options.spawnNext(NEXT_BUILD_ARGS, options.buildEnv)
  if (built !== 0) return stop('next build', built)
  const checked = options.checkBuild({ root, env: options.buildEnv, log, logError })
  if (checked !== 0) return stop('check-build', checked)
  const mode = readContentMode(readContentOutputs(root).contentBuildInfo)
  if (mode !== 'staging') {
    logError(`preview:staging: content mode is ${mode ?? 'none'}, not staging`)
    return stop('mode check', 1)
  }
  return 0
}

/** The fields of an os.networkInterfaces() address that lanUrls reads. */
export interface InterfaceAddress {
  readonly address: string
  readonly family: string
  readonly internal: boolean
}

export type Interfaces = Readonly<Record<string, readonly InterfaceAddress[] | undefined>>

/** http://<ip>:3006 for each non-internal IPv4 address, in the order the system lists them. */
export function lanUrls(interfaces: Interfaces): string[] {
  return Object.values(interfaces).flatMap((addresses) =>
    (addresses ?? [])
      .filter((a) => a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a.address}:${PREVIEW_PORT}`),
  )
}

const requireHere = createRequire(import.meta.url)

/** next's own CLI file (next has no exports map; its bin is ./dist/bin/next). */
export function nextBin(): string {
  return requireHere.resolve('next/dist/bin/next')
}

/** next run by this Node binary, with no shell and never through pnpm (design §3.6 row 23). */
export function nextCommand(args: readonly string[]): { command: string; args: string[] } {
  return { command: process.execPath, args: [nextBin(), ...args] }
}

/** The part of a child process the spawner uses. */
export interface ChildLike {
  once(event: 'exit', listener: (code: number | null) => void): unknown
  once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildLike

/** Where SIGINT and SIGTERM arrive (process, or a test fake). */
export interface SignalTarget {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

const FORWARDED = ['SIGINT', 'SIGTERM'] as const

/**
 * Runs next in `root` with stdio inherited. While it runs, SIGINT and SIGTERM never stop this
 * wrapper: on Windows the child shares the console and gets Ctrl+C itself, so they are ignored;
 * elsewhere they are forwarded to the child. Resolves with the child's exit code (1 when it was
 * ended by a signal or could not start).
 */
export function nextSpawner(
  root: string,
  platform: string = process.platform,
  spawnImpl: SpawnLike = (command, args, options) => spawn(command, args, options),
  signals: SignalTarget = process,
  logError: (line: string) => void = (line) => console.error(line),
): SpawnNext {
  return (args, env) =>
    new Promise<number>((done) => {
      const { command, args: full } = nextCommand(args)
      // Next's types make NODE_ENV a required key of ProcessEnv; the child gets exactly `env`.
      const child = spawnImpl(command, full, {
        cwd: root,
        env: env as NodeJS.ProcessEnv,
        stdio: 'inherit',
      })
      const relays = FORWARDED.map((signal) => {
        const relay = () => {
          if (platform !== 'win32') child.kill(signal)
        }
        signals.on(signal, relay)
        return [signal, relay] as const
      })
      let settled = false
      const finish = (code: number) => {
        if (settled) return
        settled = true
        for (const [signal, relay] of relays) signals.off(signal, relay)
        done(code)
      }
      child.once('error', (error) => {
        logError(`preview:staging: next could not start (${error.code ?? 'unknown'})`)
        finish(1)
      })
      child.once('exit', (code) => finish(code ?? 1))
    })
}

export interface PreviewStagingOptions {
  readonly root: string
  /** The parent environment, passed unchanged to next start. */
  readonly env: Env
  /** The command-line arguments after the script (none are accepted). */
  readonly argv: readonly string[]
  /** os.networkInterfaces, read when the URLs are printed. */
  readonly interfaces: () => Interfaces
  readonly load: (options: LoaderOptions) => Promise<number>
  readonly spawnNext: SpawnNext
  readonly checkBuild: (options: CheckBuildOptions) => number
  readonly log: (line: string) => void
  readonly logError: (line: string) => void
}

/** The whole run of design §6.1 main; resolves with the process exit code. */
export async function previewStaging(options: PreviewStagingOptions): Promise<number> {
  const { log, logError } = options
  const refusals = checkPreviewEnv(options.env, options.argv)
  if (refusals.length > 0) {
    for (const line of refusals) logError(line)
    return 2
  }
  const envs = stagingEnvs(options.env, CONTENT_PUBLIC_BASE)
  const code = await runStagingSteps({
    root: options.root,
    loaderEnv: envs.loader,
    buildEnv: envs.build,
    load: options.load,
    spawnNext: options.spawnNext,
    checkBuild: options.checkBuild,
    log,
    logError,
  })
  if (code !== 0) return code
  log(SIMULATED_LINE)
  log(`http://localhost:${PREVIEW_PORT}`)
  for (const url of lanUrls(options.interfaces())) log(url)
  log(PLAIN_HTTP_LINE)
  return options.spawnNext(START_ARGS, options.env)
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  previewStaging({
    root,
    env: process.env,
    argv: process.argv.slice(2),
    interfaces: networkInterfaces,
    load: loadContent,
    spawnNext: nextSpawner(root),
    checkBuild: runCheckBuild,
    log: (line) => console.log(line),
    logError: (line) => console.error(line),
  }).then(
    // exitCode, not process.exit(): the process ends once its handles have closed, so an exit
    // right after the loader's requests cannot trip libuv's closing-handle assertion on Windows.
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      console.error(
        `preview:staging: unexpected error: ${error instanceof Error ? error.message : 'unknown'}`,
      )
      process.exitCode = 1
    },
  )
}
