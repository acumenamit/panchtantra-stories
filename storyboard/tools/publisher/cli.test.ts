// Step 14 (P1-8c) cli.ts: runCli with injected deps (design migration-input/p1-step14-design.md
// §3.11 D14-1, D14-10, D14-17, §4.3 step 1, §5; test plan §14.8: T14-61 to T14-67).
// The entry block is not run by tests (isEntryPoint is false under Vitest). The injected factory
// records its options, refuses any origin but MEDIA_ORIGIN, and builds the client on the loopback
// stub with the key runCli read; a loopback guard on the global fetch refuses and counts any other
// host, so even a factory that forwarded the real origin could send nothing.
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_ORIGIN } from '../../src/config/security-headers'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { runCli, type CliDeps } from './cli'
import { Secret, readDeployHookUrl, readSiteUrl } from './env'
import { triggerDeployHook, type HookOptions, type HookResult } from './hook'
import {
  answersOf,
  approvalRecordOf,
  buildTestStories,
  waiverBytesOf,
  waiverFileOf,
  writeStageInputs,
  type StageInputDirs,
  type TestStory,
} from './stage-testkit'
import type { VerifyOptions, VerifyOutcome } from './verify'
import { createStorageClient, type StorageClientOptions } from './storage'
import {
  expectNoUnexpected,
  startStorageStub,
  type StorageStub,
  type StubLogEntry,
} from './storage-stub'

// ---- shared material ----

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-cli-test-key'].join('_')
const IDS = ['two-paths', 'river-stones', 'lantern-walk']
const NOW = '2026-11-21T10:00:00.000Z'
const OTHER_PROJECT = 'https://abcdefghijklmnopqrst.supabase.co'
const pointerWrite = (mode: string) => `/storage/v1/object/content/catalogue/${mode}.json`
const contentWrite = (path: string) => `/storage/v1/object/content/${path}`
const TIMEOUT = { timeout: 30_000 }

// ---- loopback guard ----

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0
let loopbackRequests = 0
let root = ''
let wrongOrigins: string[] = []
const stubs: StorageStub[] = []

beforeEach(() => {
  escapes = 0
  loopbackRequests = 0
  wrongOrigins = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) {
      loopbackRequests++
      return realFetch(input, init)
    }
    escapes++
    return Promise.reject(new TypeError('blocked: not a loopback host'))
  })
  root = mkdtempSync(join(tmpdir(), 's14-cli-'))
})

afterEach(async () => {
  const problems: unknown[] = []
  for (const stub of stubs.splice(0)) {
    try {
      expectNoUnexpected(stub)
    } catch (error) {
      problems.push(error)
    }
    await stub.close()
  }
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  const count = escapes
  vi.unstubAllGlobals()
  expect(count, 'loopback guard: requests that tried to leave 127.0.0.1').toBe(0)
  expect(wrongOrigins, 'factory: every client asked for the project origin').toEqual([])
  if (problems.length > 0) throw problems[0]
})

async function newStub(stories: readonly TestStory[]): Promise<StorageStub> {
  const stub = await startStorageStub({ apikey: FAKE_KEY })
  stubs.push(stub)
  for (const story of stories) {
    stub.put(
      'masters',
      `waivers/${story.storyId}/${story.waiverSha256}.json`,
      story.waiverBytes,
      'application/json',
    )
  }
  return stub
}

let cached: Promise<TestStory[]> | null = null
const testStories = (): Promise<TestStory[]> => (cached ??= buildTestStories())

interface Harness {
  readonly deps: CliDeps
  readonly out: string[]
  readonly err: string[]
  readonly calls: string[]
  readonly options: StorageClientOptions[]
}

/** runCli's deps (§14.8 setup); `stub` null means no client may be built. */
function harness(stub: StorageStub | null, over: Partial<CliDeps> = {}): Harness {
  const out: string[] = []
  const err: string[] = []
  const calls: string[] = []
  const options: StorageClientOptions[] = []
  let t = Date.parse(NOW)
  const deps: CliDeps = {
    env: { SUPABASE_URL: MEDIA_ORIGIN, SUPABASE_SECRET_KEY: FAKE_KEY },
    runContext: {},
    platform: 'win32',
    cwd: root,
    storyboardRoot: root,
    now: () => new Date(t),
    sleep: async (ms) => void (t += ms),
    log: (line) => void out.push(line),
    error: (line) => void err.push(line),
    loadEnv: () => {
      calls.push('loadEnv')
      return true
    },
    createClient: (opts) => {
      calls.push('factory')
      options.push(opts)
      if (opts.supabaseUrl.origin !== MEDIA_ORIGIN) {
        wrongOrigins.push(opts.supabaseUrl.origin)
        throw new Error('test factory: not the project origin')
      }
      if (stub === null) throw new Error('test factory: no client on this path')
      return createStorageClient({
        supabaseUrl: stub.origin,
        secretKey: opts.secretKey,
        ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
      })
    },
    // Step 15a (§14.12): the six new members record their call and throw where a test does not
    // expect them; a test that needs one passes its own through `over`.
    openStdin: unexpected(calls, 'openStdin'),
    stdinIsTTY: unexpected(calls, 'stdinIsTTY'),
    promptWrite: unexpected(calls, 'promptWrite'),
    stdinDeadline: unexpected(calls, 'stdinDeadline'),
    triggerHook: unexpected(calls, 'triggerHook'),
    verify: unexpected(calls, 'verify'),
    ...over,
  }
  return { deps, out, err, calls, options }
}

/** A dep that records its call, then throws: no test reaches it unless it passes its own. */
function unexpected(calls: string[], name: string): () => never {
  return () => {
    calls.push(name)
    throw new Error(`test harness: ${name} was not expected here`)
  }
}

const dirFlags = (dirs: StageInputDirs) => [
  '--packages',
  dirs.packagesDir,
  '--media',
  dirs.mediaDir,
  '--waivers',
  dirs.waiversDir,
  '--report-dir',
  join(root, 'reports'),
]
const stageArgv = (dirs: StageInputDirs, extra: string[] = []) => [
  'stage',
  ...IDS,
  ...dirFlags(dirs),
  ...extra,
]
const validateArgv = (dirs: StageInputDirs) => ['validate', ...IDS, ...dirFlags(dirs)]
const lastLine = (lines: readonly string[]) => lines[lines.length - 1] ?? ''
/** The last stage report's outcome (null when none was written). */
const stageOutcome = (): unknown => {
  const path = join(root, 'reports', 'publisher-stage.json')
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { outcome?: unknown }).outcome
    : null
}
const everything = (h: Harness) => [...h.out, ...h.err].join('\n')
const envDigest = () =>
  createHash('sha256')
    .update(
      JSON.stringify(Object.entries(process.env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    )
    .digest('hex')

describe('runCli', () => {
  it(
    'T14-61 validate through runCli: exit 0, no client, no env load (A1, A2, CRIT-12)',
    TIMEOUT,
    async () => {
      const stories = await testStories()
      const dirs = writeStageInputs(root, stories)
      const consoleLog = vi.spyOn(console, 'log')
      const h = harness(null)
      const exit = await runCli(validateArgv(dirs), h.deps)
      expect.soft(exit, '(g1) exit 0').toBe(0)
      expect.soft(lastLine(h.out), '(g1) the summary on deps.log').toBe('validate: 3/3 stageable')
      expect.soft(consoleLog, '(g1) nothing through console.log').not.toHaveBeenCalled()
      expect.soft(h.calls, '(g2) neither the factory nor loadEnv').toEqual([])
    },
  )

  it(
    'T14-62 stage through runCli: parse, loadEnv once, the run context, credentials, the project check, then one client with the timeout (A2, A3, A17, CRIT-12)',
    TIMEOUT,
    async () => {
      const stories = await testStories()
      const dirs = writeStageInputs(root, stories)
      const first = harness(await newStub(stories))
      const exitA = await runCli(stageArgv(dirs), first.deps)
      const second = harness(await newStub(stories))
      const exitB = await runCli(stageArgv(dirs, ['--timeout-ms', '5000']), second.deps)
      expect([exitA, exitB], 'precondition: each run stages').toEqual([0, 0])
      expect
        .soft(first.calls, '(g1) loadEnv once, before the factory')
        .toEqual(['loadEnv', 'factory'])
      const usage = harness(null)
      expect
        .soft(
          await runCli([...stageArgv(dirs), '--bogus'], usage.deps),
          '(g1) a usage error: exit 2',
        )
        .toBe(2)
      expect.soft(usage.calls, '(g1) a usage error calls neither').toEqual([])
      const opts = first.options[0]
      expect
        .soft(Object.keys(opts ?? {}).sort(), '(g2) the options')
        .toEqual(['secretKey', 'supabaseUrl', 'timeoutMs'])
      expect.soft(opts?.supabaseUrl.origin, '(g2) origin MEDIA_ORIGIN').toBe(MEDIA_ORIGIN)
      expect.soft(opts?.secretKey instanceof Secret, '(g2) a Secret').toBe(true)
      expect.soft(opts?.timeoutMs, '(g2) timeoutMs 180000').toBe(180_000)
      expect.soft(second.options[0]?.timeoutMs, '(g2) --timeout-ms 5000').toBe(5000)
    },
  )

  it(
    'T14-63 stage-here-only from the run context and platform; values loaded from the env file never decide (A3, L11, CRIT-12)',
    TIMEOUT,
    async () => {
      const stories = await testStories()
      const dirs = writeStageInputs(root, stories)
      const base = harness(await newStub(stories))
      expect(
        await runCli(stageArgv(dirs, ['--dry-run']), base.deps),
        'precondition: the baseline stages',
      ).toBe(0)
      expect(base.calls, 'precondition: the baseline reaches the factory').toContain('factory')
      const refused: [string, Partial<CliDeps>][] = [
        ['platform linux', { platform: 'linux' }],
        ['GITHUB_ACTIONS true', { runContext: { GITHUB_ACTIONS: 'true' } }],
        ["VERCEL ''", { runContext: { VERCEL: '' } }],
        ["VERCEL_ENV ''", { runContext: { VERCEL_ENV: '' } }],
        ['win32 Github_Actions', { runContext: { Github_Actions: 'true' } }],
        ['win32 vercel_env', { runContext: { vercel_env: 'preview' } }],
      ]
      for (const [label, over] of refused) {
        const h = harness(null, over)
        const exit = await runCli(stageArgv(dirs, ['--dry-run']), h.deps)
        expect
          .soft([exit, h.calls.includes('factory')], `(g1) refused: ${label}`)
          .toEqual([2, false])
      }
      const loaded = harness(await newStub(stories))
      const env: Record<string, string | undefined> = { ...loaded.deps.env }
      const exit = await runCli(stageArgv(dirs, ['--dry-run']), {
        ...loaded.deps,
        env,
        loadEnv: () => {
          loaded.calls.push('loadEnv')
          env.VERCEL = '1'
          return true
        },
      })
      expect.soft(exit, '(g2) VERCEL from the env file does not refuse').toBe(0)
      const canary = harness(null, { runContext: { vercel_env: 'S14CANARYVALUE' } })
      await runCli(stageArgv(dirs, ['--dry-run']), canary.deps)
      expect
        .soft(everything(canary).includes('stage-here-only'), '(g3) the message names the rule')
        .toBe(true)
      expect.soft(everything(canary).includes('S14CANARYVALUE'), '(g3) and no value').toBe(false)
    },
  )

  it('T14-64 project-mismatch and configuration, by name only (A3, L12)', TIMEOUT, async () => {
    const stories = await testStories()
    const dirs = writeStageInputs(root, stories)
    const base = harness(await newStub(stories))
    expect(
      await runCli(stageArgv(dirs, ['--dry-run']), base.deps),
      'precondition: the baseline stages',
    ).toBe(0)
    const other = harness(null, {
      env: { SUPABASE_URL: OTHER_PROJECT, SUPABASE_SECRET_KEY: FAKE_KEY },
    })
    expect.soft(await runCli(stageArgv(dirs), other.deps), '(g1) another ref: exit 2').toBe(2)
    expect.soft(other.out, '(g1) project-mismatch').toContain('stage: stopped: project-mismatch')
    const plainKey = 'S14CANARYplainkey'
    const configs: [string, Record<string, string>, string][] = [
      ['SUPABASE_URL missing', { SUPABASE_SECRET_KEY: FAKE_KEY }, 'SUPABASE_URL'],
      ['the key missing', { SUPABASE_URL: MEDIA_ORIGIN }, 'SUPABASE_SECRET_KEY'],
      [
        'a key without the secret prefix',
        { SUPABASE_URL: MEDIA_ORIGIN, SUPABASE_SECRET_KEY: plainKey },
        'SUPABASE_SECRET_KEY',
      ],
    ]
    const runs: Harness[] = [other]
    for (const [label, env, name] of configs) {
      const h = harness(null, { env })
      runs.push(h)
      const exit = await runCli(stageArgv(dirs), h.deps)
      expect.soft(exit, `(g2) ${label}: exit 2`).toBe(2)
      expect.soft(h.out, `(g2) ${label}: configuration`).toContain('stage: stopped: configuration')
      expect.soft(everything(h).includes(name), `(g2) ${label}: names ${name}`).toBe(true)
    }
    // FID-3: an env file that exists but cannot be loaded (a folder, no read access) is a
    // configuration stop named by role, never a silent rejection; its error text is not printed.
    const envCanary = 'S14CANARYenvpath'
    const unreadable = harness(null, {
      loadEnv: () => {
        throw Object.assign(new Error(`EISDIR: illegal operation on a directory ${envCanary}`), {
          code: 'EISDIR',
        })
      },
    })
    runs.push(unreadable)
    const exitU = await runCli(stageArgv(dirs), unreadable.deps).catch(() => 'rejected')
    expect.soft(exitU, '(g2) the env file unreadable: exit 2').toBe(2)
    expect
      .soft(unreadable.out, '(g2) the env file unreadable: configuration')
      .toEqual(['stage: stopped: configuration'])
    expect
      .soft(unreadable.err, '(g2) the env file unreadable: named by role')
      .toEqual(['stage: the env file could not be loaded'])
    for (const h of runs) {
      const text = everything(h)
      const leaked = [OTHER_PROJECT, 'abcdefghijklmnopqrst', FAKE_KEY, plainKey, envCanary].filter(
        (v) => text.includes(v),
      )
      expect.soft(leaked, '(g3) no env value in any output').toEqual([])
      expect.soft(h.calls.includes('factory'), '(g3) the factory never called').toBe(false)
    }
  })

  it(
    'T14-65 network backstop: the test factory builds on the stub only; a non-loopback request is counted and refused (CRIT-7)',
    TIMEOUT,
    async () => {
      const stories = await testStories()
      const dirs = writeStageInputs(root, stories)
      const stub = await newStub(stories)
      const h = harness(stub)
      expect(globalThis.fetch, 'precondition: the loopback guard is installed').not.toBe(realFetch)
      expect(escapes, 'precondition: the guard starts at 0').toBe(0)
      const exit = await runCli(stageArgv(dirs), h.deps)
      expect
        .soft(loopbackRequests, '(g1) every request went to the stub')
        .toBe(stub.requests.length)
      expect.soft(escapes, '(g1) escapes 0').toBe(0)
      expect.soft(exit, '(g1) the staged run exits 0').toBe(0)
    },
  )

  it('T14-66 exit codes and the stopped line through runCli (§5, TP-1)', TIMEOUT, async () => {
    const stories = await testStories()
    const dirs = writeStageInputs(root, stories)
    const staged = harness(await newStub(stories))
    expect.soft(await runCli(stageArgv(dirs), staged.deps), '(g1) 0 staged').toBe(0)

    const story = stories.find((s) => s.storyId === IDS[0])!
    const arabic = structuredClone(story.pkg)
    arabic.locales = ['en', 'hi', 'ar']
    arabic.text.ar = structuredClone(arabic.text.en!)
    writeFileSync(join(dirs.packagesDir, `${story.storyId}.json`), jcsBytes(arabic))
    const unwaived = harness(await newStub(stories))
    const exit1 = await runCli(stageArgv(dirs), unwaived.deps)
    // Reached is read from the report, not stdout: MU14-275 removes the stopped line itself.
    expect(stageOutcome(), 'precondition: the injection is reached').toBe('validator-unwaived')
    expect.soft(exit1, '(g1) 1 validator-unwaived').toBe(1)
    expect.soft(unwaived.calls.includes('factory'), '(g1) the factory never called').toBe(false)
    expect
      .soft(
        lastLine(unwaived.out).startsWith('stage: stopped: validator-unwaived'),
        '(g1) the stopped line for 1',
      )
      .toBe(true)
    writeStageInputs(root, stories)

    const usage = harness(null)
    expect.soft(await runCli([...stageArgv(dirs), '--nope'], usage.deps), '(g1) 2 usage').toBe(2)

    const s3 = await newStub(stories)
    s3.override('POST', contentWrite(story.media[0]!.path), {
      kind: 'answer',
      status: 400,
      body: '{"statusCode":"400"}',
    })
    const upload = harness(s3)
    const exit3 = await runCli(stageArgv(dirs), upload.deps)
    expect(
      s3.requests.some(
        (r) => r.method === 'POST' && r.pathname === contentWrite(story.media[0]!.path),
      ),
      'precondition: the upload injection is reached',
    ).toBe(true)
    expect.soft(exit3, '(g1) 3 upload-failed').toBe(3)
    expect
      .soft(
        lastLine(upload.out).startsWith('stage: stopped: upload-failed'),
        '(g1) the stopped line for 3',
      )
      .toBe(true)

    const s4 = await newStub(stories)
    s4.override('POST', pointerWrite('staging'), {
      kind: 'answer',
      status: 500,
      body: '{"statusCode":"500"}',
    })
    const pointer = harness(s4)
    const exit4 = await runCli(stageArgv(dirs), pointer.deps)
    expect(
      s4.requests.some((r) => r.method === 'POST' && r.pathname === pointerWrite('staging')),
      'precondition: the pointer injection is reached',
    ).toBe(true)
    expect.soft(exit4, '(g1) 4 pointer-not-moved').toBe(4)
    expect
      .soft(lastLine(pointer.out), '(g1) the stopped line for 4')
      .toBe('stage: stopped: pointer-not-moved')

    mkdirSync(join(root, '.rules-private'))
    writeFileSync(
      join(root, '.rules-private', `${PANCHATANTRA_RULESET.ref}.private.json`),
      '{"ref":"x"}',
    )
    const lists = harness(await newStub(stories))
    const exit2 = await runCli(stageArgv(dirs), lists.deps)
    expect(stageOutcome(), 'precondition: the private-lists injection is reached').toBe(
      'private-lists-invalid',
    )
    expect.soft(exit2, '(g2) private-lists-invalid → 2').toBe(2)
    rmSync(join(root, '.rules-private'), { recursive: true, force: true })

    // g3 (FID-3): a throw that escapes a runner (here the injected clock, before the runner's own
    // catch) prints internal with the class name only and exits 1; the entry block's rejection
    // handler is never the only answer.
    const clockCanary = 'S14CANARYclock'
    for (const [command, argv] of [
      ['validate', validateArgv(dirs)],
      ['stage', stageArgv(dirs)],
    ] as const) {
      const h = harness(null, {
        now: () => {
          throw new RangeError(clockCanary)
        },
      })
      const exit = await runCli([...argv], h.deps).catch(() => 'rejected')
      expect.soft(exit, `(g3) ${command}: an escaped throw exits 1`).toBe(1)
      expect
        .soft(h.out, `(g3) ${command}: internal with the class name`)
        .toEqual([`${command}: stopped: internal RangeError`])
      expect.soft(everything(h).includes(clockCanary), `(g3) ${command}: no canary`).toBe(false)
    }
  })

  it(
    'T14-67 runCli leaves process.env as it was and has no default client factory (A2, CRIT-7)',
    TIMEOUT,
    async () => {
      const before = envDigest()
      const names = new Set(Object.keys(process.env))
      const stories = await testStories()
      const dirs = writeStageInputs(root, stories)
      const v = harness(null)
      const stub = await newStub(stories)
      const s = harness(stub)
      const env: Record<string, string | undefined> = { ...s.deps.env }
      const exitV = await runCli(validateArgv(dirs), v.deps)
      const exitS = await runCli(stageArgv(dirs), {
        ...s.deps,
        env,
        loadEnv: () => {
          env.S14_LOADED = 'from the env file'
          return true
        },
      })
      expect([exitV, exitS], 'precondition: validate and stage ran').toEqual([0, 0])
      const changed = Object.keys(process.env).filter((name) => !names.has(name))
      expect
        .soft(
          envDigest() === before,
          `(g1) process.env unchanged; new names: ${changed.join(',') || 'none'}`,
        )
        .toBe(true)
      const bare = await newStub(stories)
      const noFactory = harness(bare, {
        createClient: undefined as unknown as CliDeps['createClient'],
      })
      const exit = await runCli(stageArgv(dirs, ['--dry-run']), noFactory.deps)
      expect.soft(exit, '(g2) exits non-zero').not.toBe(0)
      expect.soft(bare.requests.length, '(g2) no stub request').toBe(0)
      expect.soft(escapes, '(g2) escapes 0').toBe(0)
    },
  )
})

// ---- Step 15a: approve and publish through runCli (§14.11: T15A-52 to T15A-59, T15A-69) ----

const SLOW = { timeout: 120_000 }
/** The deploy hook URL, assembled at run time: the only shape readDeployHookUrl accepts. */
const hookUrlText = () =>
  ['https://api.vercel.com/v1/integrations/deploy', 'S15ACANARYproject', 'S15ACANARYhook'].join('/')
const SITE_URL = 'https://s15a-site.example'
const NO_CHANNEL = 'approve: stdin is not a terminal; pass --answers-stdin'
const REPORT_DIR_IN_ACTIONS = 'usage: --report-dir is not used in GitHub Actions'
const ACTIONS: Partial<CliDeps> = { platform: 'linux', runContext: { GITHUB_ACTIONS: 'true' } }
const publishEnv = (key = FAKE_KEY): Record<string, string> => ({
  SUPABASE_URL: MEDIA_ORIGIN,
  SUPABASE_SECRET_KEY: key,
  VERCEL_DEPLOY_HOOK_PRODUCTION: hookUrlText(),
  NEXT_PUBLIC_SITE_URL: SITE_URL,
})
const reportsDir = () => join(root, 'reports')
const defaultReportDir = () => join(root, 'migration-input', 'reports')
const twoPaths = async () => (await testStories()).find((s) => s.storyId === 'two-paths')!
/** stdin answers as one JSON body; the deadline never resolves. */
const stdinOf = (text: string): Partial<CliDeps> => ({
  openStdin: () => Readable.from([text]),
  stdinDeadline: () => new Promise<void>(() => {}),
})
const approveArgv = (story: TestStory, extra: string[] = []) => [
  'approve',
  story.storyId,
  '--package',
  story.packageSha256.slice(0, 12),
  ...extra,
]
const liveOutcome = (seq: number): VerifyOutcome => ({
  kind: 'live',
  expectedSeq: seq,
  samples: 6,
  regressions: [],
  sample: {
    kind: 'live',
    at: 0,
    ms: 1,
    seq,
    deploymentId: null,
    appVersion: null,
    deploymentUrl: null,
    builtAt: NOW,
    storyIds: [],
  },
})
const TRIGGERED: HookResult = { kind: 'triggered', status: 200, jobId: 'j1', createdAt: null }

/** Fakes for triggerHook and verify that record their options (no Vercel is ever reached). */
function tailFakes(
  hook: (options: HookOptions) => Promise<HookResult> = async () => TRIGGERED,
  verify: (options: VerifyOptions) => Promise<VerifyOutcome> = async (o) =>
    liveOutcome(o.expectedSeq),
) {
  const hooks: HookOptions[] = []
  const verifies: VerifyOptions[] = []
  const deps: Partial<CliDeps> = {
    triggerHook: async (options) => {
      hooks.push(options)
      return hook(options)
    },
    verify: async (options) => {
      verifies.push(options)
      return verify(options)
    },
  }
  return { hooks, verifies, deps }
}

/** A stub with the stories staged through runCli (pc mode). */
async function stagedStub(stories?: readonly TestStory[], key = FAKE_KEY): Promise<StorageStub> {
  const list = stories ?? (await testStories())
  const dirs = writeStageInputs(root, list)
  const stub = await startStorageStub({ apikey: key })
  stubs.push(stub)
  for (const story of list) {
    stub.put(
      'masters',
      `waivers/${story.storyId}/${story.waiverSha256}.json`,
      story.waiverBytes,
      'application/json',
    )
  }
  const h = harness(stub, { env: publishEnv(key) })
  const exit = await runCli(['stage', ...list.map((s) => s.storyId), ...dirFlags(dirs)], h.deps)
  if (exit !== 0) throw new Error(`test setup: stage exited ${exit}`)
  return stub
}

/** Stages the three stories and approves two-paths through runCli (pc mode, stdin answers). */
async function approvedStub(): Promise<{ stub: StorageStub; story: TestStory }> {
  const stub = await stagedStub()
  const story = await twoPaths()
  const h = harness(stub, stdinOf(JSON.stringify(answersOf(story))))
  const argv = approveArgv(story, ['--answers-stdin', '--report-dir', reportsDir()])
  const exit = await runCli(argv, h.deps)
  if (exit !== 0) throw new Error(`test setup: approve exited ${exit}`)
  return { stub, story }
}

const readJson = (path: string): Record<string, unknown> | null =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : null
const readText = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '')
/** stdout, stderr and both reports of `command` in the reports dir. */
const channelsOf = (h: Harness, command: 'approve' | 'publish') =>
  [
    ...h.out,
    ...h.err,
    readText(join(reportsDir(), `publisher-${command}.json`)),
    readText(join(reportsDir(), `publisher-${command}.md`)),
  ].join('\n')

describe('runCli: approve and publish (Step 15a)', () => {
  it(
    'T15A-52 commandAllowedHere: pc mode and actions mode; Vercel contexts and other platforms refused before any load (A17, L16)',
    SLOW,
    async () => {
      const story = await twoPaths()
      const stories = await testStories()
      const dirs = writeStageInputs(root, stories)
      const answers = JSON.stringify(answersOf(story))
      const argvs = {
        approve: approveArgv(story, ['--answers-stdin']),
        publish: ['publish', 'two-paths'],
      }
      for (const [mode, over] of [
        ['pc', {}],
        ['actions', ACTIONS],
      ] as const) {
        for (const command of ['approve', 'publish'] as const) {
          const h = harness(await newStub(stories), {
            ...stdinOf(answers),
            ...tailFakes().deps,
            env: publishEnv(),
            ...over,
          })
          await runCli(argvs[command], h.deps)
          expect(h.calls, `precondition: ${command} reaches the factory in ${mode} mode`).toContain(
            'factory',
          )
        }
      }
      const refused: [string, Partial<CliDeps>][] = [
        ["win32 VERCEL ''", { runContext: { VERCEL: '' } }],
        [
          "linux actions VERCEL_ENV 'preview'",
          { platform: 'linux', runContext: { GITHUB_ACTIONS: 'true', VERCEL_ENV: 'preview' } },
        ],
        ["linux GITHUB_ACTIONS '1'", { platform: 'linux', runContext: { GITHUB_ACTIONS: '1' } }],
        ["win32 GITHUB_ACTIONS 'true'", { runContext: { GITHUB_ACTIONS: 'true' } }],
        ['linux without GITHUB_ACTIONS', { platform: 'linux' }],
        ['darwin', { platform: 'darwin' }],
        ["win32 vercel_env 'x'", { runContext: { vercel_env: 'x' } }],
        ["win32 Github_Actions 'true'", { runContext: { Github_Actions: 'true' } }],
      ]
      for (const [label, over] of refused) {
        for (const command of ['approve', 'publish'] as const) {
          rmSync(defaultReportDir(), { recursive: true, force: true })
          const h = harness(null, { ...stdinOf(answers), env: publishEnv(), ...over })
          const exit = await runCli(argvs[command], h.deps).catch(() => 'rejected')
          expect
            .soft(
              [
                exit,
                h.out,
                h.calls.includes('loadEnv'),
                h.calls.includes('factory'),
                existsSync(defaultReportDir()),
              ],
              `(g1) ${command} refused: ${label}`,
            )
            .toEqual([2, [`${command}: stopped: run-context-refused`], false, false, false])
        }
      }
      const stage = harness(null, ACTIONS)
      const stageExit = await runCli(stageArgv(dirs), stage.deps)
      expect
        .soft([stageExit, stage.out], '(g2) stage on linux actions stays stage-here-only')
        .toEqual([2, ['stage: stopped: stage-here-only']])
      for (const command of ['approve', 'publish'] as const) {
        const env: Record<string, string | undefined> = { ...publishEnv() }
        const h = harness(await newStub(stories), {
          ...stdinOf(answers),
          ...tailFakes().deps,
          env,
          loadEnv: () => {
            env.VERCEL = '1'
            return true
          },
        })
        await runCli(argvs[command], h.deps)
        expect
          .soft(
            h.calls.includes('factory'),
            `(g3) ${command}: VERCEL from the env file never decides`,
          )
          .toBe(true)
      }
    },
  )

  it(
    'T15A-53 actions mode: no env file, no report, --report-dir refused, approve needs --answers-stdin and never prompts (A17, L17, TP-2)',
    SLOW,
    async () => {
      const { stub, story } = await approvedStub()
      const fakes = tailFakes()
      const approve = harness(stub, {
        ...stdinOf(JSON.stringify(answersOf(story))),
        ...ACTIONS,
        env: publishEnv(),
      })
      const publish = harness(stub, { ...fakes.deps, ...ACTIONS, env: publishEnv() })
      const exitA = await runCli(approveArgv(story, ['--answers-stdin']), approve.deps)
      const exitP = await runCli(['publish', 'two-paths'], publish.deps)
      expect([exitA, exitP], 'precondition: approve and publish ran in actions mode').toEqual([
        0, 0,
      ])
      expect
        .soft(
          [approve.calls.includes('loadEnv'), publish.calls.includes('loadEnv')],
          '(g1) loadEnv never called',
        )
        .toEqual([false, false])
      for (const argv of [
        approveArgv(story, ['--answers-stdin', '--report-dir', 'x']),
        ['publish', 'two-paths', '--report-dir', 'x'],
      ]) {
        const h = harness(null, { ...stdinOf('{}'), ...ACTIONS, env: publishEnv() })
        const exit = await runCli(argv, h.deps)
        expect
          .soft(
            [exit, h.out, h.err, h.calls.includes('factory')],
            `(g2) --report-dir in actions: ${argv[0]}`,
          )
          .toEqual([2, [], [REPORT_DIR_IN_ACTIONS], false])
      }
      expect
        .soft(
          existsSync(defaultReportDir()),
          '(g3) the published run wrote no file under the default report dir',
        )
        .toBe(false)
      expect.soft(fakes.hooks.length, '(g3) the published run reached the tail').toBe(1)
      // Non-throwing stdin and prompt fakes, so a run that prompts ends at this group's assertion.
      const prompts: string[] = []
      const tty = harness(null, {
        ...ACTIONS,
        env: publishEnv(),
        stdinIsTTY: () => true,
        openStdin: () => Readable.from([]),
        promptWrite: (text) => void prompts.push(text),
      })
      const exitT = await runCli(approveArgv(story), tty.deps).catch(() => 'rejected')
      expect
        .soft([exitT, tty.out, tty.err, prompts.length], '(g4) actions approve without the flag')
        .toEqual([2, ['approve: stopped: answers-missing'], [NO_CHANNEL], 0])
    },
  )

  it(
    'T15A-54 pc mode approve channel: TTY prompts, --answers-stdin, or answers-missing exit 2 with the fixed line; stdin opened for approve only (A17, CRIT-10, TP-2)',
    SLOW,
    async () => {
      const story = await twoPaths()
      const none = harness(null, { stdinIsTTY: () => false })
      const exitN = await runCli(approveArgv(story), none.deps)
      expect
        .soft(
          [
            exitN,
            none.out,
            none.err,
            none.calls.includes('loadEnv'),
            none.calls.includes('openStdin'),
          ],
          '(g1) not a TTY and no flag: exit 2, the fixed lines, nothing loaded or opened',
        )
        .toEqual([2, ['approve: stopped: answers-missing'], [NO_CHANNEL], false, false])
      const stub = await stagedStub()
      const prompts: string[] = []
      const lines = Readable.from([
        'en,hi\n',
        'yes\n',
        '1\n',
        'checked\n',
        'phone, laptop\n',
        'yes\n',
      ])
      const tty = harness(stub, {
        stdinIsTTY: () => true,
        openStdin: () => lines,
        promptWrite: (text) => void prompts.push(text),
      })
      const exitT = await runCli(approveArgv(story, ['--report-dir', reportsDir()]), tty.deps)
      expect.soft([exitT, prompts.length], '(g2) a TTY: the six prompts, approved').toEqual([0, 6])
      const body = Readable.from([JSON.stringify(answersOf(story))])
      const flag = harness(stub, {
        openStdin: () => body,
        stdinDeadline: () => new Promise<void>(() => {}),
      })
      const argv = approveArgv(story, ['--answers-stdin', '--report-dir', reportsDir()])
      const exitF = await runCli(argv, flag.deps)
      expect
        .soft([exitF, body.readableEnded], '(g2) the flag: the stream read to its end')
        .toEqual([0, true])
      const opened: string[] = []
      const recording: Partial<CliDeps> = {
        openStdin: () => {
          opened.push('openStdin')
          return Readable.from([])
        },
        stdinDeadline: () => {
          opened.push('stdinDeadline')
          return new Promise<void>(() => {})
        },
      }
      const dirs = writeStageInputs(root, await testStories())
      const publishRun = harness(await newStub([]), {
        ...recording,
        ...tailFakes().deps,
        env: publishEnv(),
      })
      await runCli(['publish', 'two-paths'], publishRun.deps)
      const stageRun = harness(await newStub(await testStories()), recording)
      await runCli(stageArgv(dirs, ['--dry-run']), stageRun.deps)
      expect.soft(opened, '(g3) publish and stage never open stdin or its deadline').toEqual([])
    },
  )

  it(
    'T15A-55 publish configuration: the hook and site URLs read after the credentials and before any client; failures exit 2 by name; approve reads neither (A18, L18)',
    SLOW,
    async () => {
      const story = await twoPaths()
      const noHook = publishEnv()
      delete noHook.VERCEL_DEPLOY_HOOK_PRODUCTION
      const samples: [string, Record<string, string>][] = [
        ['hook unset', noHook],
        [
          'hook https://example.com/x',
          { ...publishEnv(), VERCEL_DEPLOY_HOOK_PRODUCTION: 'https://example.com/x' },
        ],
        ['site with a path', { ...publishEnv(), NEXT_PUBLIC_SITE_URL: `${SITE_URL}/path` }],
        ['site http://', { ...publishEnv(), NEXT_PUBLIC_SITE_URL: 'http://s15a-site.example' }],
      ]
      for (const [label, env] of samples) {
        const hook = readDeployHookUrl(env)
        const site = readSiteUrl(env)
        const reason = !hook.ok ? hook.reason : !site.ok ? site.reason : 'none'
        for (const extra of [[], ['--dry-run']]) {
          const h = harness(null, { env })
          const exit = await runCli(['publish', 'two-paths', ...extra], h.deps).catch(
            () => 'rejected',
          )
          expect
            .soft(
              [exit, h.out, h.err, h.calls.includes('factory')],
              `(g1) ${label} ${extra.join(' ')}`,
            )
            .toEqual([2, ['publish: stopped: configuration'], [`publish: ${reason}`], false])
        }
      }
      const approve = harness(await newStub([]), {
        ...stdinOf(JSON.stringify(answersOf(story))),
        env: { SUPABASE_URL: MEDIA_ORIGIN, SUPABASE_SECRET_KEY: FAKE_KEY },
      })
      await runCli(approveArgv(story, ['--answers-stdin']), approve.deps)
      expect
        .soft(approve.calls.includes('factory'), '(g2) approve with both unset proceeds')
        .toBe(true)
    },
  )

  it(
    'T15A-56 triggerHook and verify: no default; the adapters pass the hook secret and log, and now in milliseconds; no absentStoryIds (A18, A28, CRIT-17)',
    SLOW,
    async () => {
      const first = await approvedStub()
      const bare = harness(first.stub, {
        env: publishEnv(),
        ...tailFakes().deps,
        triggerHook: undefined as unknown as CliDeps['triggerHook'],
      })
      const exitB = await runCli(['publish', 'two-paths'], bare.deps)
      expect
        .soft([escapes, exitB !== 0], '(g1) no default: escapes 0, a non-zero exit')
        .toEqual([0, true])
      const second = await approvedStub()
      const fakes = tailFakes()
      const h = harness(second.stub, { env: publishEnv(), ...fakes.deps })
      const exit = await runCli(['publish', 'two-paths'], h.deps)
      expect(exit, 'precondition: the publish exits 0').toBe(0)
      const hook = fakes.hooks[0]
      expect
        .soft(
          [fakes.hooks.length, hook?.hookUrl.reveal() === hookUrlText(), hook?.log === h.deps.log],
          '(g2) the hook options: the secret and the run log',
        )
        .toEqual([1, true, true])
      const verify = fakes.verifies[0]
      const now = verify?.now?.()
      expect
        .soft(
          [
            verify?.siteUrl.origin,
            verify?.expectedSeq,
            typeof now,
            now === h.deps.now().getTime(),
            verify !== undefined && 'absentStoryIds' in verify,
          ],
          '(g3) the verify options',
        )
        .toEqual([SITE_URL, 2, 'number', true, false])
    },
  )

  it(
    'T15A-57 a throw from the hook or verify adapter after the pointer moved is internal at phase tail: exit 4, the report written, no second hook (CRIT-17)',
    SLOW,
    async () => {
      const throwers: [string, ReturnType<typeof tailFakes>][] = [
        [
          'TypeError',
          tailFakes(async () => {
            throw new TypeError(hookUrlText())
          }),
        ],
        [
          'RangeError',
          tailFakes(undefined, async () => {
            throw new RangeError(hookUrlText())
          }),
        ],
      ]
      for (const [name, fakes] of throwers) {
        const { stub } = await approvedStub()
        const h = harness(stub, { env: publishEnv(), ...fakes.deps })
        const exit = await runCli(['publish', 'two-paths', '--report-dir', reportsDir()], h.deps)
        const report = readJson(join(reportsDir(), 'publisher-publish.json'))
        expect
          .soft(
            [exit, lastLine(h.out), report?.outcome, report?.exitCode, fakes.hooks.length],
            `(g1) a ${name} in the tail: internal at exit 4, the report written, one hook`,
          )
          .toEqual([4, `publish: stopped: internal ${name}`, 'internal', 4, 1])
        expect
          .soft(
            channelsOf(h, 'publish').includes('S15ACANARY'),
            `(g2) ${name}: no canary in any output`,
          )
          .toBe(false)
      }
    },
  )

  it(
    'T15A-58 privacy through runCli: the canary key, hook URL, answers and waiver fields in no channel on success and on each refusal (A25, L20)',
    SLOW,
    async () => {
      const key = ['sb', 'secret', 'S15ACANARYkey'].join('_')
      const base = await twoPaths()
      const file = {
        ...waiverFileOf(base.storyId),
        basis: 'S15ACANARYbasis',
        notes: ['S15ACANARYnote'],
        recordedBy: 'S15ACANARYby',
      }
      const waiverBytes = waiverBytesOf(file)
      const story: TestStory = { ...base, waiverBytes, waiverSha256: await sha256Hex(waiverBytes) }
      const stories = (await testStories()).map((s) => (s.storyId === story.storyId ? story : s))
      const stub = await stagedStub(stories, key)
      const env = publishEnv(key)
      const canary = {
        'narration-check': 'S15ACANARYnarration',
        devices: 'S15ACANARYdevice, laptop',
      }
      const reports = ['--report-dir', reportsDir()]
      const approveTexts: string[] = []
      const publishTexts: string[] = []
      const run = async (
        argv: string[],
        over: Partial<CliDeps>,
        command: 'approve' | 'publish',
      ) => {
        const h = harness(stub, { env, ...over })
        await runCli(argv, h.deps)
        ;(command === 'approve' ? approveTexts : publishTexts).push(channelsOf(h, command))
        return h
      }
      const stdinRun = (answers: Record<string, string>) =>
        run(
          approveArgv(story, ['--answers-stdin', ...reports]),
          stdinOf(JSON.stringify(answers)),
          'approve',
        )
      const invalid = await stdinRun({ ...answersOf(story, canary), x: 'S15ACANARYx' })
      const incomplete = await stdinRun(answersOf(story, { ...canary, 'all-nodes-read': 'no' }))
      const approved = await stdinRun(answersOf(story, canary))
      const live = await run(['publish', 'two-paths', ...reports], tailFakes().deps, 'publish')
      const failedHook = tailFakes(async () => ({
        kind: 'failed',
        status: null,
        reason: 'network TypeError',
      }))
      const failed = await run(['publish', 'two-paths', ...reports], failedHook.deps, 'publish')
      const malformed = harness(null, {
        env: { ...env, VERCEL_DEPLOY_HOOK_PRODUCTION: 'https://example.com/S15ACANARYhookpath' },
      })
      await runCli(['publish', 'two-paths'], malformed.deps)
      const isApprovalPost = (r: StubLogEntry) =>
        r.method === 'POST' && r.pathname.startsWith('/storage/v1/object/masters/approvals/')
      expect(
        [
          invalid.out.at(-1),
          incomplete.out.at(-1),
          lastLine(live.out),
          lastLine(failed.out),
          malformed.out.at(-1),
        ],
        'precondition: the runs ended as planned',
      ).toEqual([
        'approve: stopped: answers-invalid',
        'approve: stopped: approval-review-incomplete',
        'publish: live seq=2',
        'publish: recovery: publish --snapshot 2 redeploys production as it is',
        'publish: stopped: configuration',
      ])
      expect(
        approved.out.at(-1)?.endsWith(' created') &&
          stub.requests
            .filter(isApprovalPost)
            .some((r) => Buffer.from(r.body).toString('latin1').includes('S15ACANARY')),
        'precondition: the canary answers reached the approval POST body',
      ).toBe(true)
      const bodies = stub.requests
        .filter((r) => !isApprovalPost(r))
        .map((r) => Buffer.from(r.body).toString('latin1'))
      const text = [...approveTexts, ...publishTexts, everything(malformed), ...bodies].join('\n')
      expect.soft(text.includes('S15ACANARY'), '(g1) no canary in any channel').toBe(false)
    },
  )

  it(
    'T15A-59 exit codes, stop lines and client options for approve and publish through runCli (A19, A20)',
    SLOW,
    async () => {
      const story = await twoPaths()
      const answers = () => stdinOf(JSON.stringify(answersOf(story)))
      const stdinArgv = approveArgv(story, ['--answers-stdin'])
      const codes: [string, number, string | null][] = []
      const approved = await approvedStub()
      codes.push(['approve approved', 0, null])
      const notStaged = harness(await newStub([]), answers())
      codes.push([
        'approve not-staged',
        await runCli(stdinArgv, notStaged.deps),
        lastLine(notStaged.out),
      ])
      const darwin = harness(null, { ...answers(), platform: 'darwin' })
      codes.push(['approve run-context-refused', await runCli(stdinArgv, darwin.deps), null])
      const racedStub = await stagedStub()
      const theirs = await approvalRecordOf(story, { on: '2026-11-20' })
      const recordPath = `approvals/${story.storyId}/${story.packageSha256}.json`
      const raced = harness(racedStub, {
        ...answers(),
        createClient: (opts) =>
          createStorageClient({
            supabaseUrl: racedStub.origin,
            secretKey: opts.secretKey,
            fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
              const url = new URL(input instanceof Request ? input.url : String(input))
              if (init?.method === 'POST' && url.pathname.endsWith(recordPath)) {
                racedStub.put('masters', recordPath, theirs.bytes, 'application/json')
              }
              return globalThis.fetch(input, init)
            }) as typeof fetch,
          }),
      })
      codes.push([
        'approve approval-raced',
        await runCli(stdinArgv, raced.deps),
        lastLine(raced.out),
      ])
      const published = harness(approved.stub, { env: publishEnv(), ...tailFakes().deps })
      codes.push([
        'publish published',
        await runCli(['publish', 'two-paths'], published.deps),
        null,
      ])
      const unapproved = harness(await stagedStub(), { env: publishEnv(), ...tailFakes().deps })
      codes.push([
        'publish approval-missing',
        await runCli(['publish', 'two-paths'], unapproved.deps),
        lastLine(unapproved.out),
      ])
      const uploadStub = (await approvedStub()).stub
      uploadStub.override('POST', '/storage/v1/object/content/catalogue/snapshots/2.json', {
        kind: 'answer',
        status: 400,
        body: '{"statusCode":"400"}',
      })
      const upload = harness(uploadStub, { env: publishEnv(), ...tailFakes().deps })
      codes.push([
        'publish upload-failed',
        await runCli(['publish', 'two-paths'], upload.deps),
        lastLine(upload.out),
      ])
      const hookStub = (await approvedStub()).stub
      const failing = tailFakes(async () => ({
        kind: 'failed',
        status: 500,
        reason: 'non-2xx status',
      }))
      const hook = harness(hookStub, { env: publishEnv(), ...failing.deps })
      codes.push([
        'publish hook-failed',
        await runCli(['publish', 'two-paths'], hook.deps),
        hook.out.at(-2) ?? '',
      ])
      expect
        .soft(
          codes.map(([label, exit]) => [label, exit]),
          '(g1) the exits',
        )
        .toEqual([
          ['approve approved', 0],
          ['approve not-staged', 1],
          ['approve run-context-refused', 2],
          ['approve approval-raced', 3],
          ['publish published', 0],
          ['publish approval-missing', 1],
          ['publish upload-failed', 3],
          ['publish hook-failed', 4],
        ])
      expect
        .soft(
          codes.filter(([, , line]) => line !== null).map(([, , line]) => line),
          '(g1) the stop lines',
        )
        .toEqual([
          'approve: stopped: not-staged two-paths',
          'approve: stopped: approval-raced two-paths',
          'publish: stopped: approval-missing two-paths',
          'publish: stopped: upload-failed',
          'publish: stopped: hook-failed',
        ])
      const timed = harness(await newStub([]), {
        env: publishEnv(),
        ...tailFakes().deps,
        ...answers(),
      })
      await runCli(['publish', 'two-paths', '--timeout-ms', '5000'], timed.deps)
      await runCli(approveArgv(story, ['--answers-stdin', '--timeout-ms', '5000']), timed.deps)
      const options = [...published.options, ...notStaged.options, ...timed.options]
      expect
        .soft(
          options.map((o) => [o.supabaseUrl.origin, o.secretKey instanceof Secret, o.timeoutMs]),
          '(g2) the factory options: the origin, a Secret, the timeout',
        )
        .toEqual([
          [MEDIA_ORIGIN, true, 180_000],
          [MEDIA_ORIGIN, true, 180_000],
          [MEDIA_ORIGIN, true, 5000],
          [MEDIA_ORIGIN, true, 5000],
        ])
    },
  )

  it(
    'T15A-69 the real triggerDeployHook through cli.ts adapter: one POST with buildCache=false, a failure is hook-failed with no canary in any channel, a triggered hook reaches verify (A18, A25, D15-11, AUD-7)',
    SLOW,
    async () => {
      const { stub } = await approvedStub()
      const sent: { url: URL; method: string | undefined }[] = []
      let answer: () => Promise<Response> = async () =>
        new Response('{"job":{"id":"j1"}}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        sent.push({ url, method: init?.method })
        return answer()
      }) as typeof fetch
      const verifies: VerifyOptions[] = []
      const deps: Partial<CliDeps> = {
        env: publishEnv(),
        triggerHook: (o) => triggerDeployHook({ ...o, fetchImpl: fake }),
        verify: async (o) => {
          verifies.push(o)
          return liveOutcome(o.expectedSeq)
        },
      }
      const ok = harness(stub, deps)
      const exitOk = await runCli(['publish', 'two-paths', '--report-dir', reportsDir()], ok.deps)
      expect(
        stub.requests.some(
          (r) => r.method === 'POST' && r.pathname.endsWith('/catalogue/production.json'),
        ),
        'precondition: the publish reached the tail (the production POST)',
      ).toBe(true)
      const target = new URL(hookUrlText())
      const one = sent[0]
      expect
        .soft(
          [
            sent.length,
            one?.method,
            one?.url.searchParams.get('buildCache'),
            one?.url.origin === target.origin,
            one?.url.pathname === target.pathname,
          ],
          '(g1) one POST with buildCache=false to the hook URL',
        )
        .toEqual([1, 'POST', 'false', true, true])
      expect
        .soft([exitOk, verifies.map((v) => v.expectedSeq)], '(g3) triggered: verify once with 2')
        .toEqual([0, [2]])
      answer = async () => {
        throw new Error(hookUrlText())
      }
      const failed = harness(stub, deps)
      const exitF = await runCli(
        ['publish', 'two-paths', '--report-dir', reportsDir()],
        failed.deps,
      )
      expect
        .soft(
          [exitF, failed.out.slice(-2), verifies.length],
          '(g2) a failed hook: exit 4, the stop and recovery lines, no verify',
        )
        .toEqual([
          4,
          [
            'publish: stopped: hook-failed',
            'publish: recovery: publish --snapshot 2 redeploys production as it is',
          ],
          1,
        ])
      expect
        .soft(channelsOf(failed, 'publish').includes('S15ACANARY'), '(g2) no canary in any output')
        .toBe(false)
    },
  )
})
