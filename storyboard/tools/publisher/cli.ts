// pnpm publisher (design migration-input/p1-step14-design.md §3.11 D14-1, D14-10, D14-17, §4.3 step 1,
// §5; P1-8c, Step 14; and migration-input/p1-step15a-design.md §3.15, §3.16, §4.1, §4.2, D15-3,
// D15-15, D15-16, D15-18, D15-30, TP-2; P1-8d part a, Step 15a): `validate (<id>... | --all)`,
// `stage <id>... [--dry-run]`, `approve <id> --package <prefix>`, `publish [<id>...] [--feature]
// [--snapshot]`, `publish --unpublish <id> [--takedown]`, `verify [--deep]` (both Step 15b, below)
// and `help`.
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
//   ApprovePort, PublishPort, UnpublishPort (the unpublish factory) or StorageReader (verify), so a
//   result kind the client adds and the port lacks, or a write the command may not make, is a
//   compile error here (fence F1, one row).
// - The entry block runs only as the process entry point; it captures the run context first. Its
//   stdin deadline timer is unref'd, so a run that read its answers never waits for it (D15-30).
// - Step 15b (migration-input/p1-step15b-design.md §2.3, §4.1, D15B-6, D15B-8, D15B-14, D15B-18,
//   D15B-19, D15B-21, D15B-35, D15B-36; P1-8d part b): `--takedown` in actions mode stops with
//   takedown-here-only right after the report-dir refusal, before the env file, the credentials or
//   any client. publish hands runPublish the unpublish factory (`const port: UnpublishPort =
//   client`), the remover factory (the content deleter through CliDeps.createDeleter, no default,
//   built at most once and only when runPublish calls it in the takedown commit), realPath
//   (realpathSync.native) and the Range adapter (verify.ts's checkRange on CONTENT_PUBLIC_BASE);
//   the verify adapter passes lastSeq on a timeout. `verify [--deep]` runs after the credentials and
//   the project check with the site URL only (no hook URL), its client held read-only, verify asked
//   for the build detail, and the public reads bound to the site URL and the public content base.
//   CliDeps.publicReads has no default either.
// - Step 16 (migration-input/p1-step16-design.md §3.14.2, D16-14, D16-32; P1-8e): approve, publish
//   and verify with `--fixtures` (args.ts: approve and publish also need --dry-run) run after every
//   run-context refusal and approve's answer channel, before the env file: one fixed line, then the
//   runner on the in-memory world of CliDeps.fixtures (no default): its client as the ports, verify's
//   live answer and its site, a tail and a remover that throw. No env read, env file, credential,
//   project check, URL read, client, hook, verify, deleter or public read happens on that branch. The
//   world's type comes from ./port only; the entry block loads fixture-store.ts through `import()`, so
//   a run without `--fixtures` never evaluates it or the test kit it builds from.
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEntryPoint } from '../../scripts/load-content'
import { CONTENT_PUBLIC_BASE, MEDIA_ORIGIN } from '../../src/config/security-headers'
import { RUN_CONTEXT_NAMES, captureRunContext, parseArgs } from './args'
import { runApprove, type ApproveAnswers, type ApproveStdin } from './approve'
import {
  createContentDeleter,
  type ContentDeleter,
  type ContentDeleterOptions,
} from './content-deleter'
import { loadEnvFile, readStorageCredentials } from './env'
import { readDeployHookUrl, readSiteUrl } from './env'
import { triggerDeployHook, type HookOptions, type HookResult } from './hook'
import type {
  ApprovePort,
  ContentRemover,
  FixtureSet,
  PublishPort,
  StagePort,
  StorageReader,
  UnpublishPort,
} from './port'
import { runPublish, type PublishTail } from './publish'
import { internalLine, stopLine } from './run-kit'
import { runStage, runValidate } from './stage'
import { createStorageClient, type StorageClient, type StorageClientOptions } from './storage'
import {
  checkLanding,
  checkRange,
  readPublicObject,
  verifyPublish,
  type VerifyOptions,
  type VerifyOutcome,
} from './verify'
import { runVerify, type VerifyCommandAnswer } from './verify-command'

type Values = Readonly<Record<string, string | undefined>>
type Command = 'validate' | 'stage' | 'approve' | 'publish' | 'verify'

/** The fixed stderr line when approve has no answer channel (TP-2). */
const NO_ANSWER_CHANNEL = 'approve: stdin is not a terminal; pass --answers-stdin'
/** The fixed stderr line for --report-dir in actions mode (TP-2). */
const REPORT_DIR_IN_ACTIONS = 'usage: --report-dir is not used in GitHub Actions'
/** The fixed stderr line for --takedown in actions mode (D15B-8). */
const TAKEDOWN_IN_ACTIONS =
  'publish: --takedown runs on this PC only; GitHub Actions refuses it (spec §8)'
/** The stdin deadline of the entry block (D15-3). */
const STDIN_DEADLINE_MS = 30_000
/** The fixed first line of a --fixtures run (Step 16, S16-CRIT-12): what it promises, no value. */
const FIXTURES_LINE: Readonly<Record<'approve' | 'publish' | 'verify', string>> = {
  approve: 'approve: fixtures dry run: an in-memory store; no Storage, deploy hook or site request',
  publish: 'publish: fixtures dry run: an in-memory store; no Storage, deploy hook or site request',
  verify: 'verify: fixtures dry run: an in-memory store; no Storage, deploy hook or site request',
}

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
  /** publish and verify: the live check (no default; the entry block passes verify.ts's). */
  readonly verify: (options: VerifyOptions) => Promise<VerifyOutcome>
  /** publish --takedown only: the content deleter (no default; the entry block passes it). */
  readonly createDeleter: (options: ContentDeleterOptions) => ContentDeleter
  /** publish and verify: the public reads (no default; the entry block passes verify.ts's). */
  readonly publicReads: {
    readonly readPublicObject: typeof readPublicObject
    readonly checkRange: typeof checkRange
    readonly checkLanding: typeof checkLanding
  }
  /**
   * `--fixtures` only (Step 16, D16-14, D16-32): the in-memory fixture world. No default; the entry
   * block passes fixture-store.ts's openFixtureSet through a dynamic import. Required (L16-1); a
   * deps object that lacks it anyway still stops a --fixtures run as internal TypeError.
   */
  readonly fixtures: () => Promise<FixtureSet>
}

/** A parsed approve, publish or verify: the commands `--fixtures` is for. */
type FixturesInput = Extract<
  ReturnType<typeof parseArgs>,
  { readonly command: 'approve' | 'publish' | 'verify' }
>

/** What runFixtures shares with the real branch (runCli's output, run mode and answer channel). */
interface FixturesContext {
  readonly output: {
    readonly storyboardRoot: string
    readonly platform: string
    readonly now: () => Date
    readonly log: (line: string) => void
    readonly error: (line: string) => void
  }
  readonly runMode: 'pc' | 'actions'
  readonly channel: 'stdin' | 'prompt' | null
}

/**
 * The --fixtures run (§3.14.2 item 3): the world from deps.fixtures, its client as approve's,
 * publish's, the unpublish factory's or verify's port, verify's live answer and site from the world,
 * a tail and a remover that throw (TP16-12: unreachable in a dry run). Never touches deps.env,
 * loadEnv, createClient, triggerHook, verify, createDeleter or publicReads.
 */
async function runFixtures(
  input: FixturesInput,
  deps: CliDeps,
  context: FixturesContext,
): Promise<number> {
  const open = deps.fixtures
  if (open === undefined) throw new TypeError('fixtures: no fixture world')
  const set = await open()
  const { output, runMode } = context
  if (input.command === 'approve') {
    const stdin = deps.openStdin()
    const answers: ApproveAnswers =
      context.channel === 'stdin'
        ? { kind: 'stdin', input: stdin, deadline: deps.stdinDeadline() }
        : { kind: 'prompt', input: stdin, write: deps.promptWrite }
    return runApprove(input, {
      ...output,
      sleep: deps.sleep,
      runMode,
      makePort: () => {
        const port: ApprovePort = set.client
        return port
      },
      answers,
    })
  }
  if (input.command === 'publish') {
    const noTail = async (): Promise<never> => {
      throw new TypeError('fixtures: no tail')
    }
    return runPublish(input, {
      ...output,
      sleep: deps.sleep,
      runMode,
      makePort: () => {
        const port: PublishPort = set.client
        return port
      },
      makeUnpublishPort: () => {
        const port: UnpublishPort = set.client
        return port
      },
      makeRemover: () => {
        throw new TypeError('fixtures: no deleter')
      },
      realPath: realpathSync.native,
      tail: { hook: noTail, verify: noTail, range: noTail },
    })
  }
  return runVerify(input, {
    ...output,
    sleep: deps.sleep,
    runMode,
    makePort: () => {
      const port: StorageReader = set.client
      return port
    },
    verify: (expectedSeq) => set.live(expectedSeq),
    site: set.site,
  })
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
    // D15B-8: --takedown runs on this PC only, refused before the env file or any client.
    if (runMode === 'actions' && parsed.command === 'publish' && parsed.takedown) {
      deps.log(stopLine('publish', 'takedown-here-only'))
      deps.error(TAKEDOWN_IN_ACTIONS)
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
  // Step 16 (D16-14): the fixtures dry run, after every run-context refusal and the answer channel,
  // before the env file, the credentials, the project check, any URL read and any client.
  if (parsed.command !== 'stage' && parsed.fixtures) {
    const input = parsed
    deps.log(FIXTURES_LINE[input.command])
    return guarded(input.command, () => runFixtures(input, deps, { output, runMode, channel }))
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

  if (parsed.command === 'verify') {
    // D15B-19: the site URL only (no hook URL), after the credentials and the project check.
    const site = readSiteUrl(deps.env)
    if (!site.ok) {
      deps.log(stopLine('verify', 'configuration'))
      deps.error(`verify: ${site.reason}`)
      return 2
    }
    const siteUrl = site.value
    const base = new URL(CONTENT_PUBLIC_BASE)
    const verify = async (expectedSeq: number): Promise<VerifyCommandAnswer> => {
      const outcome = await deps.verify({
        siteUrl,
        expectedSeq,
        log: deps.log,
        sleep: deps.sleep,
        now: () => deps.now().getTime(),
        detail: true,
      })
      if (outcome.kind === 'timeout') return { kind: 'timeout', lastSeq: outcome.lastSeq }
      const build = outcome.sample.build
      if (build === undefined) throw new TypeError('verify: the live read carried no build detail')
      return { kind: outcome.kind, seq: outcome.sample.seq, build }
    }
    return guarded('verify', () =>
      runVerify(parsed, {
        ...output,
        sleep: deps.sleep,
        runMode,
        makePort: () => {
          const client = deps.createClient(clientOptions)
          const port: StorageReader = client
          return port
        },
        verify,
        site: {
          landing: (storyId, locale) =>
            deps.publicReads.checkLanding(siteUrl, { storyId, locale }, { sleep: deps.sleep }),
          object: (head) => deps.publicReads.readPublicObject(base, head, { sleep: deps.sleep }),
          range: (target) => deps.publicReads.checkRange(base, target, { sleep: deps.sleep }),
        },
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
        ? { kind: 'timeout', lastSeq: outcome.lastSeq }
        : { kind: outcome.kind, seq: outcome.sample.seq }
    },
    range: (target) =>
      deps.publicReads.checkRange(new URL(CONTENT_PUBLIC_BASE), target, { sleep: deps.sleep }),
  }
  // D15B-14, D15B-35: the deleter, built at most once, only when runPublish asks for it (the
  // takedown commit); no run-mode check here (actions mode never reaches it, D15B-8).
  let memo: ContentRemover | null = null
  const storyId = parsed.unpublish ?? ''
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
      makeUnpublishPort: () => {
        const client = deps.createClient(clientOptions)
        const port: UnpublishPort = client
        return port
      },
      makeRemover: () => {
        if (memo !== null) return memo
        const deleter = deps.createDeleter({
          supabaseUrl,
          secretKey,
          storyId,
          timeoutMs: parsed.timeoutMs,
        })
        const remover: ContentRemover = deleter
        memo = remover
        return remover
      },
      realPath: realpathSync.native,
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
    createDeleter: createContentDeleter,
    publicReads: { readPublicObject, checkRange, checkLanding },
    // D16-32: only a --fixtures run evaluates the fixture world and the test kit it builds from.
    fixtures: async () => (await import('./fixture-store')).openFixtureSet(),
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
