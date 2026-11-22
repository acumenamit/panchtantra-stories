// The publisher workflows' dispatch helper (design migration-input/p1-step16-design.md §3.9, D16-9,
// D16-28 to D16-31; P1-8e, Step 16). Each job of .github/workflows/publisher-*.yml runs it last, from
// storyboard, as `pnpm exec tsx scripts/publisher-dispatch.ts <workflow> <job>`, with constants only.
// It reads the dispatch inputs from the event file, never from a run line, checks them, and spawns
// the publisher CLI with an argv array and no shell, so no shell ever parses an input value.
// Checks, in order; each refusal prints one fixed line to stderr and exits 2 without a spawn:
// 1 argv is [workflow, job] from the two sets; 2 linux and GITHUB_ACTIONS 'true'; 3 the event is a
// workflow_dispatch; for the storage job only, 4 GITHUB_REF is refs/heads/main (case-sensitive),
// 4b GITHUB_RUN_ATTEMPT is '1' (a re-run replays old intent), 4c RUNNER_DEBUG is not set (debug
// output is public); 5 the event file (at most 1 MiB, strict UTF-8, a JSON object, `inputs` an
// object, missing or null read as {}); 6 every input key is declared and every required one given (a
// missing optional input takes its workflow default); 7 each input's rule, in table order; 8 the mode
// matches the job; then approve's stdin is at most ANSWERS_MAX_BYTES. No line holds an input value,
// an event key or an error message. It reads six environment names from the injected env; the
// secrets in the dispatch step's env pass to the CLI unread, as the same env object. The CLI runs as
// `process.execPath <tsx/cli> tools/publisher/cli.ts <argv>`; approve's six answers reach it on
// stdin as one JSON object in ANSWER_KEYS order plus LF. Exit: 2 for a refusal, 1 when the CLI did
// not start or was stopped, or for any internal error (never a message or a stack), else the CLI's.
import { spawn } from 'node:child_process'
import { closeSync, openSync, readSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StoryId } from '../src/core/package/v1'
import { ANSWER_KEYS, ANSWERS_MAX_BYTES } from '../tools/publisher/answers'
import { isEntryPoint } from './load-content'

export type Workflow = 'approve' | 'publish' | 'unpublish' | 'verify'
export type Job = 'fixtures' | 'storage'
export type DispatchEnv = Readonly<Record<string, string | undefined>>

/** One workflow_dispatch input as its workflow file declares it (T16-7 g9 compares the two). */
export interface DispatchInput {
  readonly name: string
  readonly type: 'choice' | 'string' | 'boolean'
  /** `required: true` in the file; false when the file says `required: false` or nothing. */
  readonly required: boolean
  /** The file's `default:`, or null when it has none (a required input). */
  readonly default: string | boolean | null
  /** A choice input's options, else null. */
  readonly options: readonly string[] | null
}

const MODES = ['fixtures', 'dry-run', 'run'] as const
const YES_NO = ['no', 'yes'] as const
const choice = (name: string, options: readonly string[], defaultValue: string): DispatchInput => ({
  name,
  type: 'choice',
  required: false,
  default: defaultValue,
  options,
})
const requiredText = (name: string): DispatchInput => ({
  name,
  type: 'string',
  required: true,
  default: null,
  options: null,
})
const optionalText = (name: string): DispatchInput => ({
  name,
  type: 'string',
  required: false,
  default: '',
  options: null,
})

/** Each workflow's inputs, in the order of its file (§3.24.1). */
export const DISPATCH_INPUTS: Readonly<Record<Workflow, readonly DispatchInput[]>> = {
  approve: [
    choice('mode', MODES, 'fixtures'),
    requiredText('story-id'),
    requiredText('package-prefix'),
    requiredText('languages-read'),
    choice('all-nodes-read', YES_NO, 'no'),
    requiredText('images-viewed'),
    requiredText('narration-check'),
    requiredText('devices'),
    choice('checklist-complete', YES_NO, 'no'),
  ],
  publish: [
    choice('mode', MODES, 'fixtures'),
    optionalText('story-ids'),
    optionalText('feature'),
    optionalText('snapshot'),
  ],
  unpublish: [choice('mode', MODES, 'fixtures'), requiredText('story-id')],
  verify: [
    choice('mode', ['fixtures', 'run'], 'fixtures'),
    { name: 'deep', type: 'boolean', required: false, default: false, options: null },
  ],
}

/** The only environment names the helper reads (from its injected env). */
export const DISPATCH_ENV_NAMES = [
  'GITHUB_ACTIONS',
  'GITHUB_EVENT_NAME',
  'GITHUB_EVENT_PATH',
  'GITHUB_REF',
  'GITHUB_RUN_ATTEMPT',
  'RUNNER_DEBUG',
] as const

/** The event file's cap: 1,048,576 bytes accepted, 1,048,577 refused. */
export const EVENT_MAX_BYTES = 1_048_576

const WORKFLOWS: ReadonlySet<string> = new Set<Workflow>([
  'approve',
  'publish',
  'unpublish',
  'verify',
])
const JOBS: ReadonlySet<string> = new Set<Job>(['fixtures', 'storage'])

const LINE = {
  usage: 'dispatch: usage',
  platform: 'dispatch: runs in GitHub Actions on linux only',
  event: 'dispatch: the event is not a workflow_dispatch',
  ref: 'dispatch: storage modes run from main only',
  attempt: 'dispatch: a re-run is refused; dispatch a new run from main',
  debug: 'dispatch: debug logging is on; dispatch without it',
  file: 'dispatch: the event file is not a readable JSON object',
  inputs: "dispatch: the inputs differ from the workflow's",
  modeJob: 'dispatch: input mode does not match the job',
  tooLong: 'dispatch: the answers are too long',
  stopped: 'dispatch: the publisher did not start or was stopped',
  internal: 'dispatch: internal error',
} as const

const isStoryId = (value: unknown): value is string =>
  typeof value === 'string' && StoryId.safeParse(value).success
const PACKAGE_PREFIX = /^[0-9a-f]{12,64}$/
const STORY_IDS = /^[a-z0-9-]+(?: [a-z0-9-]+)*$/
const STORY_IDS_MAX = 64
const SNAPSHOT = /^[1-9][0-9]{0,15}$/

interface Rule {
  readonly accepts: (value: unknown, workflow: Workflow) => boolean
  readonly text: string
}
const FREE_TEXT: Rule = { accepts: (value) => typeof value === 'string', text: 'is not a string' }
const YES_OR_NO: Rule = {
  accepts: (value) => value === 'yes' || value === 'no',
  text: 'is not yes or no',
}

/** Each input's rule and the fixed text of its refusal line (§3.9.3). */
const RULES: Readonly<Record<string, Rule>> = {
  mode: {
    accepts: (value, workflow) =>
      typeof value === 'string' && modeOptions(workflow).includes(value),
    text: "is not one of the workflow's modes",
  },
  'story-id': { accepts: isStoryId, text: 'is not a story id' },
  'package-prefix': {
    accepts: (value) => typeof value === 'string' && PACKAGE_PREFIX.test(value),
    text: 'is not 12 to 64 lowercase hex characters',
  },
  'languages-read': FREE_TEXT,
  'images-viewed': FREE_TEXT,
  'narration-check': FREE_TEXT,
  devices: FREE_TEXT,
  'all-nodes-read': YES_OR_NO,
  'checklist-complete': YES_OR_NO,
  'story-ids': {
    accepts: (value) => {
      if (value === '') return true
      if (typeof value !== 'string' || !STORY_IDS.test(value)) return false
      const ids = value.split(' ')
      return ids.length <= STORY_IDS_MAX && ids.every(isStoryId)
    },
    text: 'is not up to 64 story ids one space apart',
  },
  feature: {
    accepts: (value) => value === '' || value === 'none' || isStoryId(value),
    text: 'is not empty, none or a story id',
  },
  snapshot: {
    accepts: (value) => value === '' || (typeof value === 'string' && SNAPSHOT.test(value)),
    text: 'is not empty or a whole number from 1',
  },
  deep: {
    accepts: (value) => value === true || value === false || value === 'true' || value === 'false',
    text: 'is not true or false',
  },
}

function modeOptions(workflow: Workflow): readonly string[] {
  return DISPATCH_INPUTS[workflow].find((input) => input.name === 'mode')?.options ?? []
}

export interface PlanDeps {
  readonly env: DispatchEnv
  readonly platform: string
  /** At most `maxBytes + 1` bytes of the file. */
  readonly readFile: (path: string, maxBytes: number) => Uint8Array
}

export type DispatchPlan =
  | { readonly ok: true; readonly argv: readonly string[]; readonly stdin: Uint8Array | null }
  | { readonly ok: false; readonly line: string }

const refuse = (line: string): DispatchPlan => ({ ok: false, line })

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

/** The event file's `inputs` object (missing or null read as {}), or null when it is unreadable. */
function readInputs(deps: PlanDeps): Record<string, unknown> | null {
  const path = deps.env.GITHUB_EVENT_PATH
  if (path === undefined || path === '') return null
  let event: unknown
  try {
    const bytes = deps.readFile(path, EVENT_MAX_BYTES)
    if (bytes.byteLength > EVENT_MAX_BYTES) return null
    event = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    return null
  }
  if (!isPlainObject(event)) return null
  const inputs = Object.hasOwn(event, 'inputs') ? event.inputs : null
  if (inputs === null || inputs === undefined) return {}
  return isPlainObject(inputs) ? inputs : null
}

/** `--dry-run --fixtures`, `--dry-run` or nothing; verify has no `--dry-run`. */
function modeFlags(workflow: Workflow, mode: string): string[] {
  if (mode === 'fixtures')
    return workflow === 'verify' ? ['--fixtures'] : ['--dry-run', '--fixtures']
  return mode === 'dry-run' ? ['--dry-run'] : []
}

function argvOf(workflow: Workflow, values: ReadonlyMap<string, unknown>): string[] {
  const text = (name: string) => String(values.get(name))
  const flags = modeFlags(workflow, text('mode'))
  switch (workflow) {
    case 'approve':
      return [
        'approve',
        text('story-id'),
        '--package',
        text('package-prefix'),
        '--answers-stdin',
        ...flags,
      ]
    case 'publish': {
      const ids = text('story-ids')
      const feature = text('feature')
      const snapshot = text('snapshot')
      return [
        'publish',
        ...(ids === '' ? [] : ids.split(' ')),
        ...(feature === '' ? [] : ['--feature', feature]),
        ...(snapshot === '' ? [] : ['--snapshot', snapshot]),
        ...flags,
      ]
    }
    case 'unpublish':
      return ['publish', '--unpublish', text('story-id'), ...flags]
    case 'verify': {
      const deep = values.get('deep')
      return ['verify', ...(deep === true || deep === 'true' ? ['--deep'] : []), ...flags]
    }
  }
}

/** approve's stdin: the six answers in ANSWER_KEYS order as one JSON object, then one LF. */
function answersBytes(values: ReadonlyMap<string, unknown>): Uint8Array {
  const answers: Record<string, unknown> = {}
  for (const key of ANSWER_KEYS) answers[key] = values.get(key)
  return new TextEncoder().encode(`${JSON.stringify(answers)}\n`)
}

/** Checks 1 to 8 and the answers-length check, then the CLI's argv and stdin (§3.9.2-§3.9.4). */
export function planDispatch(argv: readonly string[], deps: PlanDeps): DispatchPlan {
  const [workflowArg, jobArg] = argv
  if (
    argv.length !== 2 ||
    workflowArg === undefined ||
    jobArg === undefined ||
    !WORKFLOWS.has(workflowArg) ||
    !JOBS.has(jobArg)
  ) {
    return refuse(LINE.usage)
  }
  const workflow = workflowArg as Workflow
  const job = jobArg as Job
  if (deps.platform !== 'linux' || deps.env.GITHUB_ACTIONS !== 'true') return refuse(LINE.platform)
  if (deps.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') return refuse(LINE.event)
  if (job === 'storage') {
    if (deps.env.GITHUB_REF !== 'refs/heads/main') return refuse(LINE.ref)
    if (deps.env.GITHUB_RUN_ATTEMPT !== '1') return refuse(LINE.attempt)
    if (deps.env.RUNNER_DEBUG !== undefined) return refuse(LINE.debug)
  }
  const inputs = readInputs(deps)
  if (inputs === null) return refuse(LINE.file)
  const table = DISPATCH_INPUTS[workflow]
  const declared = new Set(table.map((input) => input.name))
  for (const key of Object.keys(inputs)) if (!declared.has(key)) return refuse(LINE.inputs)
  for (const input of table) {
    if (input.required && !Object.hasOwn(inputs, input.name)) return refuse(LINE.inputs)
  }
  const values = new Map<string, unknown>()
  for (const input of table) {
    const value = Object.hasOwn(inputs, input.name) ? inputs[input.name] : input.default
    const rule = RULES[input.name]
    if (rule === undefined) throw new Error('publisher-dispatch: an input without a rule')
    if (!rule.accepts(value, workflow)) return refuse(`dispatch: input ${input.name} ${rule.text}`)
    values.set(input.name, value)
  }
  const mode = values.get('mode')
  const modeMatches =
    job === 'fixtures'
      ? mode === 'fixtures'
      : mode === 'run' || (workflow !== 'verify' && mode === 'dry-run')
  if (!modeMatches) return refuse(LINE.modeJob)
  const stdin = workflow === 'approve' ? answersBytes(values) : null
  if (stdin !== null && stdin.byteLength > ANSWERS_MAX_BYTES) return refuse(LINE.tooLong)
  return { ok: true, argv: argvOf(workflow, values), stdin }
}

/** The part of a child's stdin the helper uses. */
export interface ChildStdin {
  on(event: 'error', listener: (error: Error) => void): unknown
  write(chunk: Uint8Array): unknown
  end(): unknown
}

/** The part of a child process the helper uses. */
export interface ChildLike {
  readonly stdin: ChildStdin | null
  once(event: 'error', listener: (error: Error) => void): unknown
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown
}

/** The spawn options the helper passes: the env object unchanged, no shell, fixed stdio. */
export interface DispatchSpawnOptions {
  readonly cwd: string
  readonly env: DispatchEnv
  readonly shell: false
  readonly stdio: readonly ['pipe' | 'ignore', 'inherit', 'inherit']
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: DispatchSpawnOptions,
) => ChildLike

export interface MainDeps extends PlanDeps {
  readonly spawn: SpawnLike
  /** One line to stderr. */
  readonly error: (line: string) => void
  readonly execPath: string
  readonly tsxCli: string
  readonly cliPath: string
  readonly storyboardRoot: string
}

/** Spawns the CLI for an accepted plan; resolves to its exit code. */
function runChild(
  plan: { readonly argv: readonly string[]; readonly stdin: Uint8Array | null },
  deps: MainDeps,
): Promise<number> {
  return new Promise<number>((done, fail) => {
    const child = deps.spawn(deps.execPath, [deps.tsxCli, deps.cliPath, ...plan.argv], {
      cwd: deps.storyboardRoot,
      env: deps.env,
      shell: false,
      stdio: [plan.stdin === null ? 'ignore' : 'pipe', 'inherit', 'inherit'],
    })
    let settled = false
    const finish = (code: number, line: string | null) => {
      if (settled) return
      settled = true
      if (line !== null) deps.error(line)
      done(code)
    }
    child.once('error', () => finish(1, LINE.stopped))
    child.once('close', (code) => (code === null ? finish(1, LINE.stopped) : finish(code, null)))
    if (plan.stdin !== null) {
      const stdin = child.stdin
      if (stdin === null) {
        fail(new Error('no stdin'))
        return
      }
      // An EPIPE or ECONNRESET (the CLI exited before reading) is ignored: the child's code wins.
      stdin.on('error', () => {})
      stdin.write(plan.stdin)
      stdin.end()
    }
  })
}

/** The helper's whole run; resolves to its exit code and never rejects. */
export async function main(argv: readonly string[], deps: MainDeps): Promise<number> {
  try {
    const plan = planDispatch(argv, deps)
    if (!plan.ok) {
      deps.error(plan.line)
      return 2
    }
    return await runChild(plan, deps)
  } catch {
    deps.error(LINE.internal)
    return 1
  }
}

/** tsx's CLI entry (`tsx/cli`, ./dist/cli.mjs), resolved from this module. */
export function resolveTsxCli(): string {
  return createRequire(import.meta.url).resolve('tsx/cli')
}

/** tools/publisher/cli.ts under the storyboard folder that holds this module's scripts/ folder. */
export function cliPathOf(url: string): string {
  return join(resolve(dirname(fileURLToPath(url)), '..'), 'tools', 'publisher', 'cli.ts')
}

/** At most `maxBytes + 1` bytes of a file. */
function readCapped(path: string, maxBytes: number): Uint8Array {
  const fd = openSync(path, 'r')
  try {
    const buffer = new Uint8Array(maxBytes + 1)
    let total = 0
    while (total < buffer.byteLength) {
      const count = readSync(fd, buffer, total, buffer.byteLength - total, null)
      if (count === 0) break
      total += count
    }
    return buffer.subarray(0, total)
  } finally {
    closeSync(fd)
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  // Built inside the promise chain, so a throw while resolving a path is the internal line too.
  void Promise.resolve()
    .then(() =>
      main(process.argv.slice(2), {
        env: process.env,
        platform: process.platform,
        readFile: readCapped,
        // Node's env type names NODE_ENV; the object is passed on as it is.
        spawn: (command, args, options) =>
          spawn(command, [...args], {
            cwd: options.cwd,
            env: options.env as NodeJS.ProcessEnv,
            shell: options.shell,
            stdio: [...options.stdio],
          }),
        error: (line) => console.error(line),
        execPath: process.execPath,
        tsxCli: resolveTsxCli(),
        cliPath: cliPathOf(import.meta.url),
        storyboardRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      }),
    )
    .then(
      (code) => {
        process.exitCode = code
      },
      () => {
        console.error(LINE.internal)
        process.exitCode = 1
      },
    )
}
