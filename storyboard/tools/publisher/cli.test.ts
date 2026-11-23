// Step 14 (P1-8c) cli.ts: runCli with injected deps (design migration-input/p1-step14-design.md
// §3.11 D14-1, D14-10, D14-17, §4.3 step 1, §5; test plan §14.8: T14-61 to T14-67).
// The entry block is not run by tests (isEntryPoint is false under Vitest). The injected factory
// records its options, refuses any origin but MEDIA_ORIGIN, and builds the client on the loopback
// stub with the key runCli read; a loopback guard on the global fetch refuses and counts any other
// host, so even a factory that forwarded the real origin could send nothing.
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
// Step 16 (P1-8e, design migration-input/p1-step16-design.md §3.14.2, §3.16, D16-14, D16-16,
// D16-32; test plan §14.6: T16-16 to T16-19, and the harness edit of 14.11 item 2): the --fixtures
// branch through runCli with the real runners and the fixture world, the P1-8 exit matrix M1-M9 once
// (TP16-11), the refusals around the branch and the no-echo canaries.
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTENT_PUBLIC_BASE, MEDIA_ORIGIN } from '../../src/config/security-headers'
import { planMediaHeads } from '../../src/core/content/media'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { runCli, type CliDeps } from './cli'
import { createContentDeleter, type ContentDeleterOptions } from './content-deleter'
import { Secret, readDeployHookUrl, readSiteUrl } from './env'
import { pngOf } from '../migrate/media-fixtures'
import { openFixtureSet } from './fixture-store'
import { triggerDeployHook, type HookOptions, type HookResult } from './hook'
import type { FixtureSet } from './port'
import {
  answersOf,
  approvalRecordOf,
  buildTestStories,
  fullyBoundStory,
  hashListOf,
  waiverBytesOf,
  waiverFileOf,
  withPackage,
  writeAudioTree,
  writeStageInputs,
  type StageInputDirs,
  type TestStory,
} from './stage-testkit'
import { classOfPath } from './storage-layout'
import type { LiveBuildDetail, VerifyOptions, VerifyOutcome } from './verify'
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
  /** Step 15b (TP-2): the public reads, never in `calls`. */
  readonly publicCalls: string[]
}

/** runCli's deps (§14.8 setup); `stub` null means no client may be built. */
function harness(stub: StorageStub | null, over: Partial<CliDeps> = {}): Harness {
  const out: string[] = []
  const err: string[] = []
  const calls: string[] = []
  const options: StorageClientOptions[] = []
  const publicCalls: string[] = []
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
    // Step 16 (§3.27, 14.11 item 2): real-mode runs never ask for the fixture world; the call is
    // recorded, so a real-mode call shows (MU16-115).
    fixtures: unexpected(calls, 'fixtures'),
    // Step 15b (TP-2): the deleter factory throws unless a test passes its own; the Range check
    // answers ok with D15B-16's middle range into publicCalls; the other public reads throw.
    createDeleter: unexpected(calls, 'createDeleter'),
    publicReads: {
      checkRange: async (_base, target) => {
        publicCalls.push(`range ${target.path}`)
        const start = Math.floor(target.bytes / 2)
        return {
          kind: 'ok',
          start,
          end: Math.min(target.bytes - 1, start + 1023),
          size: target.bytes,
        }
      },
      readPublicObject: unexpected(publicCalls, 'readPublicObject'),
      checkLanding: unexpected(publicCalls, 'checkLanding'),
    },
    ...over,
  }
  return { deps, out, err, calls, options, publicCalls }
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
          live.out.at(-2),
          lastLine(live.out),
          lastLine(failed.out),
          malformed.out.at(-1),
        ],
        'precondition: the runs ended as planned',
      ).toEqual([
        'approve: stopped: answers-invalid',
        'approve: stopped: approval-review-incomplete',
        'publish: live seq=2',
        rangeOkLine(2, story),
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

// ---- Step 15b: unpublish, takedown and verify through runCli (§14.13: T15B-50 to T15B-54) ----

const TAKEDOWN_IN_ACTIONS =
  'publish: --takedown runs on this PC only; GitHub Actions refuses it (spec §8)'
const riverStones = async () => (await testStories()).find((s) => s.storyId === 'river-stones')!

/** The first audio/mpeg head of a story's package, as a Range target. */
function mp3TargetOf(story: TestStory) {
  const plan = planMediaHeads([{ pkg: story.pkg }], '')
  if (!plan.ok) throw new Error('test setup: media plan')
  const head = plan.value.heads.find((h) => h.mime === 'audio/mpeg')!
  const sha256 = String(classOfPath('content', head.path)?.fields.sha256)
  return { path: head.path, bytes: head.bytes, sha256 }
}
/** The range line the TP-2 harness gives for a story's first MP3 (D15B-16's middle range). */
function rangeOkLine(seq: number, story: TestStory): string {
  const target = mp3TargetOf(story)
  const start = Math.floor(target.bytes / 2)
  const end = Math.min(target.bytes - 1, start + 1023)
  return `publish: range check ok seq=${seq} bytes=${start}-${end}/${target.bytes} object=${target.sha256.slice(0, 12)}`
}

/**
 * A stub (deletes on) with the three stories staged, two-paths and river-stones approved and both
 * published through runCli (production seq 2); the audio tree and hash list under `root`.
 */
async function publishedStub(key = FAKE_KEY, env = publishEnv(key)): Promise<StorageStub> {
  const list = await testStories()
  const dirs = writeStageInputs(root, list)
  const stub = await startStorageStub({ apikey: key, deletes: true })
  stubs.push(stub)
  for (const story of list) {
    stub.put(
      'masters',
      `waivers/${story.storyId}/${story.waiverSha256}.json`,
      story.waiverBytes,
      'application/json',
    )
  }
  const staged = await runCli(
    ['stage', ...list.map((s) => s.storyId), ...dirFlags(dirs)],
    harness(stub, { env }).deps,
  )
  if (staged !== 0) throw new Error(`test setup: stage exited ${staged}`)
  for (const story of [await twoPaths(), await riverStones()]) {
    const h = harness(stub, { env, ...stdinOf(JSON.stringify(answersOf(story))) })
    const argv = approveArgv(story, ['--answers-stdin', '--report-dir', reportsDir()])
    if ((await runCli(argv, h.deps)) !== 0) throw new Error('test setup: approve')
  }
  const p = harness(stub, { env, ...tailFakes().deps })
  if ((await runCli(['publish', 'two-paths', 'river-stones'], p.deps)) !== 0) {
    throw new Error('test setup: publish')
  }
  writeAudioTree(root, list)
  writeFileSync(join(root, 'migration-input', 'audio', 'SHA256SUMS.txt'), hashListOf(list))
  return stub
}

/** A verify outcome whose sample carries the build the production pointer names. */
async function liveWithBuild(stub: StorageStub, seq: number): Promise<VerifyOutcome> {
  const pointer = JSON.parse(
    new TextDecoder().decode(stub.object('content', 'catalogue/production.json')!.bytes),
  ) as { snapshotPath: string }
  const bytes = stub.object('content', pointer.snapshotPath)!.bytes
  const snapshot = JSON.parse(new TextDecoder().decode(bytes)) as {
    featuredStoryId: string | null
    stories: { storyId: string; version: number; packageSha256: string }[]
  }
  const build: LiveBuildDetail = {
    snapshotSha256: await sha256Hex(new Uint8Array(bytes)),
    featuredStoryId: snapshot.featuredStoryId,
    stories: snapshot.stories.map((e) => ({
      storyId: e.storyId,
      version: e.version,
      packageSha256: e.packageSha256,
    })),
    excluded: [],
  }
  const outcome = liveOutcome(seq)
  if (outcome.kind !== 'live') throw new Error('test setup: live outcome')
  return { ...outcome, sample: { ...outcome.sample, build } }
}

/** Public reads that answer ok and record each call. */
function okPublicReads(calls: string[]): CliDeps['publicReads'] {
  return {
    checkRange: async (_base, target) => {
      calls.push(`range ${target.path}`)
      const start = Math.floor(target.bytes / 2)
      return {
        kind: 'ok',
        start,
        end: Math.min(target.bytes - 1, start + 1023),
        size: target.bytes,
      }
    },
    readPublicObject: async (_base, object) => {
      calls.push(`object ${object.path}`)
      return { kind: 'ok' }
    },
    checkLanding: async (_site, page) => {
      calls.push(`landing ${page.storyId} ${page.locale}`)
      return { kind: 'ok' }
    },
  }
}

/** stdout, stderr and both reports of `command` in the reports dir. */
const channels15b = (h: Harness, command: 'publish' | 'verify') =>
  [
    ...h.out,
    ...h.err,
    readText(join(reportsDir(), `publisher-${command}.json`)),
    readText(join(reportsDir(), `publisher-${command}.md`)),
  ].join('\n')

describe('runCli: unpublish, takedown and verify (Step 15b)', () => {
  it(
    'T15B-50 --takedown in Actions: takedown-here-only after the report-dir refusal and before the env file, the credentials or any client, dry run included; pc mode and a plain unpublish proceed (A8, L6, D15B-8)',
    SLOW,
    async () => {
      for (const extra of [[], ['--dry-run']]) {
        const h = harness(null, { ...ACTIONS, env: publishEnv() })
        const exit = await runCli(
          ['publish', '--unpublish', 'two-paths', '--takedown', ...extra],
          h.deps,
        )
        expect
          .soft(
            [exit, h.out, h.err, h.calls],
            `(g1) actions --takedown ${extra.join(' ')}: takedown-here-only`,
          )
          .toEqual([2, ['publish: stopped: takedown-here-only'], [TAKEDOWN_IN_ACTIONS], []])
      }
      const rd = harness(null, { ...ACTIONS, env: publishEnv() })
      const exitRd = await runCli(
        ['publish', '--unpublish', 'two-paths', '--takedown', '--report-dir', 'r'],
        rd.deps,
      )
      expect
        .soft(
          [exitRd, rd.out, rd.err],
          '(g2) actions --takedown --report-dir: the report-dir refusal only',
        )
        .toEqual([2, [], [REPORT_DIR_IN_ACTIONS]])
      const plain = harness(await newStub([]), { ...ACTIONS, env: publishEnv() })
      await runCli(['publish', '--unpublish', 'two-paths'], plain.deps)
      expect
        .soft(
          [plain.calls.includes('factory'), plain.calls.includes('loadEnv')],
          '(g3) actions with a plain --unpublish: the factory, no loadEnv',
        )
        .toEqual([true, false])
      const stub = await publishedStub()
      const pc = harness(stub, { env: publishEnv() })
      const exitPc = await runCli(
        ['publish', '--unpublish', 'two-paths', '--takedown', '--dry-run'],
        pc.deps,
      )
      expect
        .soft(
          [
            exitPc,
            pc.calls.includes('loadEnv'),
            pc.calls.includes('factory'),
            pc.calls.includes('createDeleter'),
          ],
          '(g4) win32 pc --takedown --dry-run: loadEnv, the factory, no createDeleter, exit 0',
        )
        .toEqual([0, true, true, false])
      const vercel = harness(null, { runContext: { VERCEL: '1' }, env: publishEnv() })
      const exitV = await runCli(['publish', '--unpublish', 'two-paths', '--takedown'], vercel.deps)
      expect
        .soft([exitV, vercel.out], '(g5) VERCEL=1 with --takedown: run-context-refused')
        .toEqual([2, ['publish: stopped: run-context-refused']])
    },
  )

  it(
    'T15B-51 createDeleter: no default; called once, lazily after verify, only in pc mode with --takedown, with the project origin, the Secret, the story id and the timeout (A14, D15B-14)',
    SLOW,
    async () => {
      const stub = await publishedStub()
      const log: string[] = []
      const made: ContentDeleterOptions[] = []
      const recording = (target: StorageStub): Partial<CliDeps> => ({
        env: publishEnv(),
        triggerHook: async () => {
          log.push('hook')
          return TRIGGERED
        },
        verify: async (o) => {
          log.push('verify')
          return liveOutcome(o.expectedSeq)
        },
        createDeleter: (opts) => {
          log.push('createDeleter')
          made.push(opts)
          return createContentDeleter({
            supabaseUrl: target.origin,
            secretKey: opts.secretKey,
            storyId: opts.storyId,
            ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
          })
        },
      })
      const h = harness(stub, recording(stub))
      const exit = await runCli(
        ['publish', '--unpublish', 'two-paths', '--takedown', '--timeout-ms', '5000'],
        h.deps,
      )
      expect(exit, 'precondition: the takedown run exits 0').toBe(0)
      expect
        .soft(
          [
            log.filter((c) => c === 'createDeleter').length,
            log.indexOf('createDeleter') > log.indexOf('verify'),
            made.map((o) => [
              o.supabaseUrl.origin,
              o.secretKey instanceof Secret,
              o.storyId,
              o.timeoutMs,
            ]),
          ],
          '(g1) one createDeleter, after verify, with the origin, the Secret, the id and the timeout',
        )
        .toEqual([1, true, [[MEDIA_ORIGIN, true, 'two-paths', 5000]]])
      log.length = 0
      const exits: number[] = []
      for (const argv of [
        ['publish', '--unpublish', 'two-paths'],
        ['publish', '--unpublish', 'two-paths', '--takedown', '--dry-run'],
      ]) {
        const fresh = await publishedStub()
        exits.push(await runCli(argv, harness(fresh, recording(fresh)).deps))
      }
      expect
        .soft(
          [exits, log.includes('createDeleter')],
          '(g2) none without --takedown, none with --dry-run (both runs exit 0)',
        )
        .toEqual([[0, 0], false])
      const bare = await publishedStub()
      const before = bare.requests.length
      const none = harness(bare, {
        ...recording(bare),
        createDeleter: undefined as unknown as CliDeps['createDeleter'],
      })
      const exitNone = await runCli(
        ['publish', '--unpublish', 'two-paths', '--takedown'],
        none.deps,
      )
      expect
        .soft(
          [
            exitNone !== 0,
            escapes,
            bare.requests.slice(before).filter((r) => r.method === 'DELETE').length,
          ],
          '(g3) createDeleter undefined: a non-zero exit, 0 escapes, no DELETE',
        )
        .toEqual([true, 0, 0])
    },
  )

  it(
    "T15B-52 publish adapters: verify gets absentStoryIds for unpublish only and returns lastSeq on a timeout; range gets CONTENT_PUBLIC_BASE, the target and the run's sleep; publicReads has no default (A17, A20, D15B-18, D15B-21)",
    SLOW,
    async () => {
      const stub = await publishedStub()
      const fakes = tailFakes()
      const h = harness(stub, { env: publishEnv(), ...fakes.deps })
      expect(
        await runCli(['publish', '--unpublish', 'two-paths'], h.deps),
        'precondition: the unpublish',
      ).toBe(0)
      expect
        .soft(fakes.verifies[0]?.absentStoryIds, '(g1) unpublish: verify gets absentStoryIds')
        .toEqual(['two-paths'])
      const timed = await publishedStub()
      const slow = tailFakes(undefined, async (o) => ({
        kind: 'timeout',
        expectedSeq: o.expectedSeq,
        samples: 6,
        regressions: [],
        lastSeq: 1,
      }))
      const t = harness(timed, { env: publishEnv(), ...slow.deps })
      await runCli(['publish', '--unpublish', 'two-paths'], t.deps)
      expect
        .soft(
          t.out.includes(
            "publish: live seq=1 is below seq=2, production's seq before this run: a Vercel Instant Rollback is the likely cause; Undo Rollback in Vercel, then re-run",
          ),
          '(g2) a timeout with lastSeq 1 after production moved 2 → 3: the older-than-before line',
        )
        .toBe(true)
      const { stub: one } = await approvedStub()
      const seen: { base: string; path: string; sleep: unknown }[] = []
      const r = harness(one, {
        env: publishEnv(),
        ...tailFakes().deps,
        publicReads: {
          checkRange: async (base, target, options) => {
            seen.push({ base: base.href, path: target.path, sleep: options?.sleep })
            return { kind: 'ok', start: 0, end: 0, size: target.bytes }
          },
          readPublicObject: unexpected([], 'readPublicObject'),
          checkLanding: unexpected([], 'checkLanding'),
        },
      })
      expect(await runCli(['publish', 'two-paths'], r.deps), 'precondition: the publish').toBe(0)
      expect
        .soft(
          seen.map((s) => [
            s.base === new URL(CONTENT_PUBLIC_BASE).href,
            s.path,
            s.sleep === r.deps.sleep,
          ]),
          "(g3) one checkRange: the public base, two-paths' MP3, the run's sleep",
        )
        .toEqual([[true, mp3TargetOf(await twoPaths()).path, true]])
      const { stub: bareStub } = await approvedStub()
      const bare = harness(bareStub, {
        env: publishEnv(),
        ...tailFakes().deps,
        publicReads: undefined as unknown as CliDeps['publicReads'],
      })
      const exitBare = await runCli(['publish', 'two-paths'], bare.deps)
      expect
        .soft([exitBare !== 0, escapes], '(g4) publicReads undefined: a non-zero exit, 0 escapes')
        .toEqual([true, 0])
    },
  )

  it(
    'T15B-53 the verify command through runCli: pc and actions modes, credentials and the site URL without the hook URL, ids refused, detail asked, the client used read-only (A18, D15B-19)',
    SLOW,
    async () => {
      const stub = await publishedStub()
      const env: Record<string, string> = { ...publishEnv() }
      delete env.VERCEL_DEPLOY_HOOK_PRODUCTION
      const verifies: VerifyOptions[] = []
      const publicCalls: string[] = []
      const verifyFake: Partial<CliDeps> = {
        env,
        verify: async (o) => {
          verifies.push(o)
          return liveWithBuild(stub, o.expectedSeq)
        },
        publicReads: okPublicReads(publicCalls),
      }
      const before = stub.requests.length
      const h = harness(stub, verifyFake)
      const exit = await runCli(['verify', '--report-dir', reportsDir()], h.deps)
      expect
        .soft(
          [
            h.calls,
            verifies[0]?.detail,
            verifies[0]?.siteUrl.href,
            verifies[0]?.expectedSeq,
            exit,
            existsSync(join(reportsDir(), 'publisher-verify.json')),
          ],
          '(g1) pc: loadEnv, the factory, detail, the site URL, expected 2, exit 0, the report',
        )
        .toEqual([['loadEnv', 'factory'], true, `${SITE_URL}/`, 2, 0, true])
      expect
        .soft(
          stub.requests
            .slice(before)
            .filter(
              (r) =>
                (r.method === 'POST' && r.pathname !== '/storage/v1/object/list/content') ||
                r.method === 'DELETE',
            ).length,
          '(g5) no object POST and no DELETE',
        )
        .toBe(0)
      rmSync(reportsDir(), { recursive: true, force: true })
      const actions = harness(stub, { ...verifyFake, ...ACTIONS })
      const exitA = await runCli(['verify'], actions.deps)
      expect
        .soft(
          [
            exitA,
            actions.calls.includes('loadEnv'),
            existsSync(join(defaultReportDir(), 'publisher-verify.json')),
            existsSync(reportsDir()),
          ],
          '(g2) actions: no loadEnv, no report',
        )
        .toEqual([0, false, false, false])
      const rdA = harness(null, { ...verifyFake, ...ACTIONS })
      expect
        .soft(
          [await runCli(['verify', '--report-dir', 'x'], rdA.deps), rdA.err],
          '(g2) actions --report-dir',
        )
        .toEqual([2, [REPORT_DIR_IN_ACTIONS]])
      const noSite: Record<string, string> = { ...env }
      delete noSite.NEXT_PUBLIC_SITE_URL
      const site = readSiteUrl(noSite)
      const unset = harness(null, { env: noSite })
      const exitU = await runCli(['verify'], unset.deps)
      expect
        .soft(
          [exitU, unset.out, unset.err, unset.calls.includes('factory')],
          '(g3) the site URL unset: configuration, by name, no factory',
        )
        .toEqual([
          2,
          ['verify: stopped: configuration'],
          [`verify: ${site.ok ? '' : site.reason}`],
          false,
        ])
      const noKey = harness(null, {
        env: { SUPABASE_URL: MEDIA_ORIGIN, NEXT_PUBLIC_SITE_URL: SITE_URL },
      })
      expect
        .soft(
          [await runCli(['verify'], noKey.deps), noKey.out],
          '(g3) credentials missing: configuration',
        )
        .toEqual([2, ['verify: stopped: configuration']])
      const other = harness(null, { env: { ...env, SUPABASE_URL: OTHER_PROJECT } })
      expect
        .soft(
          [await runCli(['verify'], other.deps), other.out],
          '(g3) another origin: project-mismatch',
        )
        .toEqual([2, ['verify: stopped: project-mismatch']])
      const ids = harness(null, { env })
      expect
        .soft(
          [await runCli(['verify', 'a-b'], ids.deps), ids.err],
          '(g4) verify a-b: the usage text',
        )
        .toEqual([2, ['usage: verify takes no story ids']])
      mkdirSync(join(root, 'public'), { recursive: true })
      symlinkSync(join(root, 'public'), join(root, 'rd'), 'junction')
      const quiet = stub.requests.length
      verifies.length = 0
      const junction = harness(stub, verifyFake)
      const exitJ = await runCli(['verify', '--report-dir', join(root, 'rd', 'x')], junction.deps)
      const written = (readdirSync(root, { recursive: true }) as string[]).filter((n) =>
        n.endsWith('publisher-verify.json'),
      )
      expect
        .soft(
          [
            exitJ,
            junction.err.some((l) => l.includes('report-dir refused')),
            stub.requests.length - quiet,
            verifies.length,
            written,
          ],
          '(g6) a junction to public/: exit 2, the refusal line, no request, no verify call, no report',
        )
        .toEqual([2, true, 0, 0, []])
    },
  )

  it(
    'T15B-54 privacy through runCli for unpublish, takedown and verify: the canary key and the hook URL reach the run and appear in no channel, on success and on each refusal (A28, L25, AUD-4)',
    SLOW,
    async () => {
      const key = ['sb', 'secret', 'S15BCANARYkey0123456789'].join('_')
      const hookText = [
        'https://api.vercel.com/v1/integrations/deploy',
        'S15BCANARYproject',
        'S15BCANARYhook',
      ].join('/')
      const hookPath = '/v1/integrations/deploy/S15BCANARYproject/S15BCANARYhook'
      const env: Record<string, string> = {
        SUPABASE_URL: MEDIA_ORIGIN,
        SUPABASE_SECRET_KEY: key,
        VERCEL_DEPLOY_HOOK_PRODUCTION: hookText,
        NEXT_PUBLIC_SITE_URL: 'https://s15b-site.example',
      }
      const leaks = (text: string) =>
        ['S15BCANARY', hookText, hookPath, key].filter((value) => text.includes(value))
      const texts: string[] = []
      const stub = await publishedStub(key, env)
      const fakes = tailFakes()
      const secrets: string[] = []
      const success = harness(stub, {
        env,
        ...fakes.deps,
        createClient: (opts) => {
          secrets.push(opts.secretKey.reveal())
          return createStorageClient({ supabaseUrl: stub.origin, secretKey: opts.secretKey })
        },
      })
      await runCli(
        ['publish', '--unpublish', 'two-paths', '--report-dir', reportsDir()],
        success.deps,
      )
      expect(
        [fakes.hooks[0]?.hookUrl.reveal() === hookText, secrets[0] === key],
        'precondition: the hook URL and the key reached the run',
      ).toEqual([true, true])
      texts.push(channels15b(success, 'publish'))
      const run502 = harness(stub, {
        env,
        ...tailFakes().deps,
        createDeleter: (opts) =>
          createContentDeleter({
            supabaseUrl: stub.origin,
            secretKey: opts.secretKey,
            storyId: opts.storyId,
            fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
              if (init?.method === 'DELETE') {
                return new Response(JSON.stringify({ error: key.slice('sb_secret_'.length) }), {
                  status: 502,
                  headers: { 'content-type': 'application/json' },
                })
              }
              return globalThis.fetch(input, init)
            }) as typeof fetch,
          }),
      })
      await runCli(
        ['publish', '--unpublish', 'two-paths', '--takedown', '--report-dir', reportsDir()],
        run502.deps,
      )
      expect(
        lastLine(run502.out),
        'precondition: the takedown ended with its recovery line',
      ).toMatch(/re-runs the remaining steps$/)
      texts.push(channels15b(run502, 'publish'))
      // river-stones' waiver: the only file the current snapshots still name after the unpublish.
      const river = await riverStones()
      stub.put(
        'masters',
        `waivers/river-stones/${river.waiverSha256}.json`,
        waiverBytesOf({
          ...waiverFileOf('river-stones'),
          basis: 'S15BCANARYbasis',
          notes: ['S15BCANARYnote'],
          recordedBy: 'S15BCANARYby',
        }),
        'application/json',
      )
      const deep = harness(stub, {
        env,
        verify: async (o) => liveWithBuild(stub, o.expectedSeq),
        publicReads: okPublicReads([]),
      })
      await runCli(['verify', '--deep', '--report-dir', reportsDir()], deep.deps)
      expect(
        deep.out.some((l) => l.startsWith('verify: deep mismatch waiver')),
        'precondition: deep read the canary waiver',
      ).toBe(true)
      texts.push(channels15b(deep, 'verify'))
      expect
        .soft(leaks(texts.join('\n')), '(g1) no canary, hook URL, its path or key in any channel')
        .toEqual([])

      const refusals: string[] = []
      const actions = harness(null, { ...ACTIONS, env })
      await runCli(['publish', '--unpublish', 'two-paths', '--takedown'], actions.deps)
      expect(
        [
          actions.deps.env.SUPABASE_SECRET_KEY === key,
          actions.deps.env.VERCEL_DEPLOY_HOOK_PRODUCTION === hookText,
          actions.out,
        ],
        'precondition: the actions refusal had both values in deps.env',
      ).toEqual([true, true, ['publish: stopped: takedown-here-only']])
      refusals.push(everything(actions))
      const noSite: Record<string, string> = { ...env }
      delete noSite.NEXT_PUBLIC_SITE_URL
      const config = harness(null, { env: noSite })
      await runCli(['verify'], config.deps)
      refusals.push(everything(config))
      const ids = harness(null, { env })
      await runCli(['verify', 'a-b'], ids.deps)
      refusals.push(everything(ids))
      expect
        .soft(
          leaks(refusals.join('\n')),
          '(g2) takedown-here-only, a verify configuration stop and verify a-b: no value',
        )
        .toEqual([])
    },
  )
})

// ---- Step 16: the --fixtures dry runs (§14.6: T16-16 to T16-19) ----

type FixtureCommand = 'approve' | 'publish' | 'verify'
type RunMode = 'pc' | 'actions'
const fixturesLine = (command: FixtureCommand) =>
  `${command}: fixtures dry run: an in-memory store; no Storage, deploy hook or site request`
const FIXTURES_DRY_RUN = 'usage: --fixtures needs --dry-run for approve and publish'
const reportsBase = () => join(root, 'migration-input', 'reports')
const fixturesDir = () => join(reportsBase(), 'fixtures')
const MODES16: readonly (readonly [RunMode, Partial<CliDeps>])[] = [
  ['pc', { platform: 'win32', runContext: {} }],
  ['actions', ACTIONS],
]
const modeDeps = (mode: RunMode): Partial<CliDeps> => (mode === 'pc' ? MODES16[0]![1] : ACTIONS)

interface Cast16 {
  readonly L: TestStory
  readonly R: TestStory
  readonly T: TestStory
  readonly R2: TestStory
}
let cast16: Promise<Cast16> | null = null
/** §3.15's stories: L, R, T* (fully bound) and R2 (R at version 2). */
const stories16 = (): Promise<Cast16> =>
  (cast16 ??= (async () => {
    const list = await testStories()
    const find = (id: string) => list.find((s) => s.storyId === id)!
    const R = find('river-stones')
    return {
      L: find('lantern-walk'),
      R,
      T: await fullyBoundStory(find('two-paths')),
      R2: await withPackage(R, StoryPackageV1.parse({ ...R.pkg, version: 2 })),
    }
  })())

interface Row16 {
  readonly id: string
  readonly command: FixtureCommand
  readonly argv: readonly string[]
  readonly stdin: string | null
  /** The planned end: the run's last stdout lines, in order. */
  readonly end: readonly (string | RegExp)[]
  /** Lines the run must also print somewhere. */
  readonly has: readonly (string | RegExp)[]
  /** The pc report's outcome. */
  readonly outcome: 'dry-run' | 'verified'
  /** M6: --takedown runs on this PC only. */
  readonly pcOnly: boolean
}

const sha12 = (hex: string) => hex.slice(0, 12)

/** §3.16's rows M1-M8, each argv as the dispatch helper builds it (modeFlags last, S16-INT-4). */
async function rows16(answers?: Record<string, string>): Promise<Row16[]> {
  const { L, R, T, R2 } = await stories16()
  const approvalR2 = await approvalRecordOf(R2, { on: '2026-11-22' })
  const world = await openFixtureSet()
  const listing = async (folder: string) => {
    const got = await world.client.listContent(folder)
    return got.kind === 'listed' ? got.objects : []
  }
  const named = [...(await listing('packages/')), ...(await listing('media/'))]
  const bytes = named.reduce((sum, object) => sum + (object.size ?? 0), 0)
  const plan = planMediaHeads([{ pkg: T.pkg }, { pkg: R.pkg }], '')
  const mp3 = plan.ok ? plan.value.heads.find((head) => head.mime === 'audio/mpeg') : undefined
  const start = Math.floor((mp3?.bytes ?? 0) / 2)
  const end = Math.min((mp3?.bytes ?? 0) - 1, start + 1023)
  const mp3Sha = String(classOfPath('content', mp3?.path ?? '')?.fields.sha256)
  const rangeLine = `verify: range check ok seq=3 bytes=${start}-${end}/${mp3?.bytes} object=${sha12(mp3Sha)}`
  const verifyHas = [
    'verify: expected seq=3 (production pointer)',
    /^verify: live build seq=3 loaded snapshot sha256=[0-9a-f]{12} \(matches the production pointer\)$/,
  ]
  const verifyEnd = [
    /^verify: landing checked=[1-9][0-9]* failed=0$/,
    'verify: media checked=4 failed=0 skipped=0',
    'verify: excluded=0',
    rangeLine,
  ]
  const publishRow = (id: string, argv: string[], end: string[], pcOnly = false): Row16 => ({
    id,
    command: 'publish',
    argv,
    stdin: null,
    end,
    has: [],
    outcome: 'dry-run',
    pcOnly,
  })
  const unpublishEnd = [
    'publish: unpublish river-stones production=remove staging=remove',
    'publish: plan kind=unpublish seq=5 stories=1 production=3 staging=4 featured=none from=none',
  ]
  return [
    {
      id: 'M1',
      command: 'approve',
      argv: [
        'approve',
        'lantern-walk',
        '--package',
        sha12(L.packageSha256),
        '--answers-stdin',
        '--dry-run',
        '--fixtures',
      ],
      stdin: `${JSON.stringify(answers ?? answersOf(L))}\n`,
      end: [
        `approve: lantern-walk package=${sha12(L.packageSha256)} version=1 waivers=${sha12(L.waiverSha256)} state=new`,
        /^approve: record sha256=[0-9a-f]{12} planned$/,
      ],
      has: [],
      outcome: 'dry-run',
      pcOnly: false,
    },
    publishRow(
      'M2',
      ['publish', 'river-stones', '--dry-run', '--fixtures'],
      [
        `publish: river-stones package=${sha12(R2.packageSha256)} version=2 approval=${sha12(approvalR2.sha256)} state=replaced`,
        'publish: plan kind=publish seq=5 stories=2 production=3 staging=4 featured=none from=none',
      ],
    ),
    publishRow(
      'M3',
      ['publish', '--feature', 'two-paths', '--dry-run', '--fixtures'],
      [
        'publish: feature two-paths state=set',
        'publish: plan kind=publish seq=5 stories=2 production=3 staging=4 featured=two-paths from=none',
      ],
    ),
    publishRow(
      'M4',
      ['publish', '--snapshot', '1', '--dry-run', '--fixtures'],
      ['publish: plan kind=rollback seq=5 stories=1 production=3 staging=4 featured=none from=1'],
    ),
    publishRow(
      'M5',
      ['publish', '--unpublish', 'river-stones', '--dry-run', '--fixtures'],
      unpublishEnd,
    ),
    publishRow(
      'M6',
      ['publish', '--unpublish', 'river-stones', '--takedown', '--dry-run', '--fixtures'],
      [
        ...unpublishEnd,
        'publish: takedown river-stones plan packages=2 media=3 mp3=1 mp3-unproven=0 images=2 (hash list checked)',
      ],
      true,
    ),
    {
      id: 'M7',
      command: 'verify',
      argv: ['verify', '--fixtures'],
      stdin: null,
      end: verifyEnd,
      has: verifyHas,
      outcome: 'verified',
      pcOnly: false,
    },
    {
      id: 'M8',
      command: 'verify',
      argv: ['verify', '--deep', '--fixtures'],
      stdin: null,
      end: [
        ...verifyEnd,
        `verify: deep plan objects=${named.length} bytes=${bytes} approvals=2 waivers=3 (Supabase egress; spec §8: at most monthly, and after a suspected key leak)`,
        `verify: deep checked=${named.length + 5} mismatches=0`,
      ],
      has: verifyHas,
      outcome: 'verified',
      pcOnly: false,
    },
  ]
}

interface Run16 {
  readonly row: Row16
  readonly mode: RunMode
  readonly exit: number | 'rejected'
  readonly out: readonly string[]
  readonly err: readonly string[]
  readonly calls: readonly string[]
  readonly publicCalls: readonly string[]
  readonly envReads: readonly string[]
  readonly writes: readonly string[]
  /** The entries of <root>/migration-input/reports/fixtures after the run. */
  readonly reports: readonly string[]
  /** publisher-* entries directly under <root>/migration-input/reports. */
  readonly elsewhere: readonly string[]
  readonly reportsExist: boolean
  readonly outcome: unknown
  /** Both report files' text (empty when none). */
  readonly reportText: string
}

/** An env whose every trap records the access, then throws: the fixtures branch never reads it. */
function throwingEnv(reads: string[]): CliDeps['env'] {
  const trap = (name: string) => (): never => {
    reads.push(name)
    throw new TypeError('test: deps.env was read')
  }
  return new Proxy(
    {},
    {
      get: trap('get'),
      has: trap('has'),
      ownKeys: trap('ownKeys'),
      getOwnPropertyDescriptor: trap('getOwnPropertyDescriptor'),
    },
  )
}

/** The world with counting writers that still reject (T16-17 precondition). */
async function countedWorld(writes: string[]): Promise<FixtureSet> {
  const base = await openFixtureSet()
  return {
    ...base,
    client: {
      ...base.client,
      create: (ref, body) => {
        writes.push('create')
        return base.client.create(ref, body)
      },
      writePointer: (mode, body) => {
        writes.push('writePointer')
        return base.client.writePointer(mode, body)
      },
    },
  }
}

/** M6's temp root: this PC's hash list and MP3 tree for R only (hashListOf, writeAudioTree). */
async function writeTakedownTree(): Promise<void> {
  const { R } = await stories16()
  writeAudioTree(root, [R])
  writeFileSync(join(root, 'migration-input', 'audio', 'SHA256SUMS.txt'), hashListOf([R]))
}

/** One row in one mode through runCli with the world; the report folder is emptied first. */
async function runRow(row: Row16, mode: RunMode, over: Partial<CliDeps> = {}): Promise<Run16> {
  rmSync(reportsBase(), { recursive: true, force: true })
  const envReads: string[] = []
  const writes: string[] = []
  const world = await countedWorld(writes)
  const h = harness(null, {
    ...modeDeps(mode),
    env: throwingEnv(envReads),
    fixtures: async () => world,
    ...(row.stdin === null ? {} : stdinOf(row.stdin)),
    ...over,
  })
  const exit = await runCli(row.argv, h.deps).catch(() => 'rejected' as const)
  const reports = existsSync(fixturesDir()) ? readdirSync(fixturesDir()).sort() : []
  const elsewhere = existsSync(reportsBase())
    ? readdirSync(reportsBase()).filter((name) => name.startsWith('publisher-'))
    : []
  const json = join(fixturesDir(), `publisher-${row.command}.json`)
  return {
    row,
    mode,
    exit,
    out: [...h.out],
    err: [...h.err],
    calls: [...h.calls],
    publicCalls: [...h.publicCalls],
    envReads,
    writes,
    reports,
    elsewhere,
    reportsExist: existsSync(reportsBase()),
    outcome: readJson(json)?.outcome,
    reportText: [readText(json), readText(join(fixturesDir(), `publisher-${row.command}.md`))].join(
      '\n',
    ),
  }
}

/** Every row in both modes (M6 in pc mode only). */
async function runAll(rows: readonly Row16[], over: Partial<CliDeps> = {}): Promise<Run16[]> {
  const runs: Run16[] = []
  for (const row of rows) {
    for (const [mode] of MODES16) {
      if (row.pcOnly && mode !== 'pc') continue
      runs.push(await runRow(row, mode, over))
    }
  }
  return runs
}

const matches = (line: string | undefined, want: string | RegExp) =>
  line !== undefined && (typeof want === 'string' ? line === want : want.test(line))
/** True when the run's last stdout lines are its row's planned end and its other lines show. */
const reachedEnd = (run: Run16): boolean => {
  const tail = run.out.slice(-run.row.end.length)
  return (
    tail.length === run.row.end.length &&
    run.row.end.every((want, i) => matches(tail[i], want)) &&
    run.row.has.every((want) => run.out.some((line) => matches(line, want)))
  )
}
const label = (run: Run16) => `${run.row.id} ${run.mode}`

describe('runCli: the --fixtures dry runs (Step 16)', () => {
  it(
    'T16-16 the fixtures branch calls no env read, env file, credential, client, hook, verify, deleter or public read, prints the fixed line first and sends no request, in pc and actions modes (A10, CRIT-12)',
    SLOW,
    async () => {
      await writeTakedownTree()
      const runs = await runAll(await rows16())
      // g1 holds whatever the end of the run, so it is asserted before the precondition that guards
      // g2 and g3: a mutant that reads deps.env makes the run reject at that read (B16-implB-3).
      for (const run of runs) {
        expect
          .soft(
            [run.calls, run.publicCalls, run.envReads],
            `(g1) ${label(run)}: no loadEnv, factory, hook, verify, deleter, public read or env read`,
          )
          .toEqual([[], [], []])
      }
      expect(
        runs.map((run) => [label(run), run.exit, reachedEnd(run)]),
        'precondition: every run reached its planned end with exit 0',
      ).toEqual(runs.map((run) => [label(run), 0, true]))
      expect(runs.length, 'precondition: 15 runs (8 rows in pc mode, 7 in actions mode)').toBe(15)
      for (const run of runs) {
        expect
          .soft(run.out[0], `(g2) ${label(run)}: the fixed line first`)
          .toBe(fixturesLine(run.row.command))
      }
      expect
        .soft([loopbackRequests, escapes], '(g3) no request: loopback 0, escapes 0')
        .toEqual([0, 0])
    },
  )

  it(
    'T16-17 the P1-8 exit matrix M1-M9 through runCli: each row ends as §3.16 states, writes nothing to the world, and writes its report only in pc mode, into reports/fixtures (A13, D16-16)',
    SLOW,
    async () => {
      await writeTakedownTree()
      const probeWrites: string[] = []
      const probe = await countedWorld(probeWrites)
      const rejected = await probe.client
        .create({ kind: 'snapshot', seq: 9 }, new Uint8Array([1]))
        .then(
          () => false,
          (thrown: unknown) => thrown instanceof TypeError,
        )
      expect(
        [rejected, probeWrites],
        'precondition: a counting writer counts the call, then rejects with a TypeError',
      ).toEqual([true, ['create']])
      const rows = await rows16()
      const runs = await runAll(rows)
      // Each row's end and exit sit in its own group (B16-implB-2), so a row's mutant reaches it.
      expect(
        [runs.length, runs.every((run) => typeof run.exit === 'number')],
        'precondition: 15 runs, each settled with an exit code',
      ).toEqual([15, true])
      const groups: [string, string][] = [
        ['M1', '(g1) M1: the plan line state=new, then the record planned, exit 0'],
        ['M2', '(g2) M2: river-stones replaced at version 2, snapshot 5 planned, exit 0'],
        ['M3', '(g3) M3: the feature line sets two-paths, exit 0'],
        ['M4', '(g4) M4: the rollback plan from snapshot 1, exit 0'],
        ['M5', '(g5) M5: production remove, staging remove, N+1 seq 5 with one story, exit 0'],
        ['M6', '(g6) M6 (pc only): the takedown plan, the hash list checked, exit 0'],
        ['M7', '(g7) M7: verified, exit 0'],
        ['M8', "(g7) M8: verified with the world's sha-named objects as the deep counts, exit 0"],
      ]
      for (const [id, message] of groups) {
        for (const run of runs.filter((r) => r.row.id === id)) {
          expect
            .soft(
              [run.exit, reachedEnd(run), run.out.slice(-run.row.end.length)],
              `${message} (${run.mode})`,
            )
            .toEqual([0, true, expect.any(Array)])
        }
      }
      // g8: the reports.
      for (const run of runs) {
        const want =
          run.mode === 'pc'
            ? [
                [`publisher-${run.row.command}.json`, `publisher-${run.row.command}.md`],
                run.row.outcome,
                [],
                true,
              ]
            : [[], undefined, [], false]
        expect
          .soft(
            [run.reports, run.outcome, run.elsewhere, run.reportsExist],
            `(g8) ${label(run)}: ${run.mode === 'pc' ? 'exactly the two reports under reports/fixtures, none under reports' : 'no reports folder'}`,
          )
          .toEqual(want)
      }
      // g9: M9, M6's argv in actions mode.
      const m6 = rows.find((row) => row.id === 'M6')!
      const m9 = await runRow({ ...m6, id: 'M9' }, 'actions')
      expect
        .soft(
          [m9.exit, m9.out, m9.err, m9.reportsExist],
          '(g9) M9: takedown-here-only, exit 2, before the fixtures line',
        )
        .toEqual([2, ['publish: stopped: takedown-here-only'], [TAKEDOWN_IN_ACTIONS], false])
      const m9calls = harness(null, ACTIONS)
      const asked: string[] = []
      await runCli(m6.argv, {
        ...m9calls.deps,
        fixtures: async () => {
          asked.push('fixtures')
          return openFixtureSet()
        },
      })
      expect.soft(asked, '(g9) M9: fixtures not called').toEqual([])
      // g10: no row asked the world to write.
      for (const run of runs) {
        expect.soft(run.writes, `(g10) ${label(run)}: no writer call`).toEqual([])
      }
    },
  )

  it(
    'T16-18 refusals around the branch: --fixtures without --dry-run, a world that throws, the run-context refusals first, real mode never calls fixtures, the fixtures report dir behind a junction (A9, A10, L-T2)',
    SLOW,
    async () => {
      const { L } = await stories16()
      const answers = `${JSON.stringify(answersOf(L))}\n`
      const recorded = (h: Harness): Partial<CliDeps> => ({
        fixtures: async () => {
          h.calls.push('fixtures')
          return openFixtureSet()
        },
      })
      const L12 = sha12(L.packageSha256)
      const approveFix = [
        'approve',
        'lantern-walk',
        '--package',
        L12,
        '--answers-stdin',
        '--fixtures',
      ]
      const control = harness(null, stdinOf(answers))
      const exitControl = await runCli([...approveFix, '--dry-run'], {
        ...control.deps,
        ...recorded(control),
      })
      expect(
        [exitControl, control.calls.includes('fixtures')],
        'precondition: approve --dry-run --fixtures exits 0 and the recorded world was asked',
      ).toEqual([0, true])

      // g1: --fixtures without --dry-run is usage before anything (layer 1; MU16-91).
      for (const [mode] of MODES16) {
        for (const argv of [
          approveFix,
          ['publish', 'river-stones', '--fixtures'],
          ['publish', '--unpublish', 'river-stones', '--fixtures'],
        ]) {
          const h = harness(null, { ...modeDeps(mode), ...stdinOf(answers) })
          const exit = await runCli(argv, { ...h.deps, ...recorded(h) }).catch(() => 'rejected')
          expect
            .soft(
              [exit, h.out, h.err, h.calls],
              `(g1) ${mode} ${argv.slice(0, 2).join(' ')} without --dry-run: usage, exit 2, nothing on stdout, fixtures not called`,
            )
            .toEqual([2, [], [FIXTURES_DRY_RUN], []])
        }
      }

      // g2: a world that throws is internal, after the fixed line (MU16-113).
      const throwing: Partial<CliDeps> = {
        fixtures: async () => {
          throw new TypeError('S16WORLDCANARY')
        },
      }
      // B16-implB-10: CliDeps.fixtures has no default; without it a --fixtures run stops the same way.
      const absent: Partial<CliDeps> = { fixtures: undefined }
      for (const [world, over] of [
        ['a throwing world', throwing],
        ['no fixtures member', absent],
      ] as const) {
        for (const [mode] of MODES16) {
          for (const [command, argv] of [
            ['approve', [...approveFix, '--dry-run']],
            ['publish', ['publish', 'river-stones', '--dry-run', '--fixtures']],
            ['verify', ['verify', '--fixtures']],
          ] as const) {
            const h = harness(null, { ...modeDeps(mode), ...stdinOf(answers), ...over })
            const exit = await runCli(argv, h.deps).catch(() => 'rejected')
            expect
              .soft(
                [exit, h.out, everything(h).includes('S16WORLDCANARY'), escapes],
                `(g2) ${world}, ${mode} ${command}: the fixed line, then internal TypeError, exit 1`,
              )
              .toEqual([
                1,
                [fixturesLine(command), `${command}: stopped: internal TypeError`],
                false,
                0,
              ])
          }
        }
      }

      // g3: every run-context refusal comes first (MU16-114 VERCEL, MU16-160 report dir, MU16-161
      // the answer channel).
      const before: [string, string[], Partial<CliDeps>, number, string[], string[]][] = [
        ...(['approve', 'publish', 'verify'] as const).map(
          (command): [string, string[], Partial<CliDeps>, number, string[], string[]] => [
            `actions ${command} --report-dir x`,
            command === 'approve'
              ? [...approveFix, '--dry-run', '--report-dir', 'x']
              : command === 'publish'
                ? ['publish', 'river-stones', '--dry-run', '--fixtures', '--report-dir', 'x']
                : ['verify', '--fixtures', '--report-dir', 'x'],
            ACTIONS,
            2,
            [],
            [REPORT_DIR_IN_ACTIONS],
          ],
        ),
        ...(['approve', 'publish', 'verify'] as const).map(
          (command): [string, string[], Partial<CliDeps>, number, string[], string[]] => [
            `VERCEL set: ${command}`,
            command === 'approve'
              ? [...approveFix, '--dry-run']
              : command === 'publish'
                ? ['publish', 'river-stones', '--dry-run', '--fixtures']
                : ['verify', '--fixtures'],
            { runContext: { VERCEL: '1' } },
            2,
            [`${command}: stopped: run-context-refused`],
            [],
          ],
        ),
        [
          'actions approve without --answers-stdin',
          ['approve', 'lantern-walk', '--package', L12, '--dry-run', '--fixtures'],
          ACTIONS,
          2,
          ['approve: stopped: answers-missing'],
          [NO_CHANNEL],
        ],
      ]
      for (const [id, argv, over, code, out, err] of before) {
        const h = harness(null, { ...stdinOf(answers), ...over })
        const exit = await runCli(argv, { ...h.deps, ...recorded(h) }).catch(() => 'rejected')
        expect
          .soft([exit, h.out, h.err, h.calls], `(g3) ${id}: refused before the fixtures line`)
          .toEqual([code, out, err, []])
      }

      // g4: a real-mode run never asks for the world (MU16-115).
      const stub = await publishedStub()
      const real = harness(stub, { env: publishEnv() })
      const exitReal = await runCli(['publish', 'two-paths', '--dry-run'], real.deps).catch(
        () => 'rejected',
      )
      expect
        .soft(
          [exitReal, real.calls.includes('fixtures'), real.calls.includes('factory')],
          '(g4) real mode: publish two-paths --dry-run exits 0 through the factory and never calls fixtures',
        )
        .toEqual([0, false, true])

      // g5: the fixtures report dir behind a junction to public/ (MU16-116).
      rmSync(reportsBase(), { recursive: true, force: true })
      mkdirSync(join(root, 'public', 'x'), { recursive: true })
      mkdirSync(reportsBase(), { recursive: true })
      symlinkSync(
        join(root, 'public', 'x'),
        fixturesDir(),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      const linked = harness(null, MODES16[0]![1])
      const exitLinked = await runCli(['verify', '--fixtures'], {
        ...linked.deps,
        fixtures: async () => openFixtureSet(),
      }).catch(() => 'rejected')
      expect
        .soft(
          [
            exitLinked,
            linked.out,
            linked.err,
            readdirSync(join(root, 'public'), { recursive: true }),
          ],
          '(g5) a junction to public/x: exit 2 at the start check (the fixed line, then usage, no read), the refusal line, nothing under public/ but x',
        )
        .toEqual([
          2,
          [fixturesLine('verify'), 'verify: stopped: usage'],
          [
            'verify: report-dir refused: its real path is at or under public/ or app/ of the storyboard folder',
          ],
          ['x'],
        ])
    },
  )

  it(
    'T16-19 no-echo canaries: answers, fake secrets and the root path are absent from stdout, stderr and every report file in raw and encoded forms (A24, D16-12, D16-27)',
    SLOW,
    async () => {
      rmSync(root, { recursive: true, force: true })
      root = mkdtempSync(join(tmpdir(), 's16-S16ROOTCANARY-'))
      const { L } = await stories16()
      const key = ['sb', 'secret', 'S16KEYCANARY0123456789'].join('_')
      const hook = ['https://hook.example', 'S16HOOKCANARY'].join('/')
      const site = ['https://s16sitecanary', 'example'].join('.')
      const env: Record<string, string> = {
        SUPABASE_URL: MEDIA_ORIGIN,
        SUPABASE_SECRET_KEY: key,
        VERCEL_DEPLOY_HOOK_PRODUCTION: hook,
        NEXT_PUBLIC_SITE_URL: site,
      }
      const rows = (
        await rows16(
          answersOf(L, {
            'narration-check': 'S16ANSWERCANARY checked',
            devices: 'phone, S16DEVICECANARY',
          }),
        )
      ).filter((row) => ['M1', 'M2', 'M7'].includes(row.id))
      const runs: Run16[] = []
      for (const row of rows) {
        for (const [mode] of MODES16) runs.push(await runRow(row, mode, { env }))
      }
      // The planned end line is each run's last line (a mutant that adds text to an earlier line
      // still reaches g1, MU16-117).
      const endLine = (run: Run16) => matches(run.out.at(-1), run.row.end.at(-1) ?? '')
      expect(
        runs.map((run) => [
          label(run),
          run.exit,
          endLine(run),
          run.out.length > 0,
          run.reports.length,
        ]),
        'precondition: each run ended exit 0 at its planned end, stdout not empty, pc runs left 2 report files and actions runs 0',
      ).toEqual(runs.map((run) => [label(run), 0, true, true, run.mode === 'pc' ? 2 : 0]))
      expect(
        runs.filter((run) => run.mode === 'pc').every((run) => run.reportText.length > 1),
        'precondition: the pc report files were read',
      ).toBe(true)
      const canaries = [
        'S16ANSWERCANARY',
        'S16DEVICECANARY',
        'S16KEYCANARY',
        'S16HOOKCANARY',
        's16sitecanary',
        'S16ROOTCANARY',
        key,
        hook,
        site,
      ]
      const forms = (value: string) => [
        value,
        value.toUpperCase(),
        value.toLowerCase(),
        JSON.stringify(value).slice(1, -1),
        encodeURIComponent(value),
      ]
      const rootForms16 = (dir: string) => {
        const base = [
          dir,
          dir.toUpperCase(),
          dir.toLowerCase(),
          dir.replaceAll('\\', '/'),
          dir.replaceAll('/', '\\'),
        ]
        return [
          ...base,
          ...base.map((form) => JSON.stringify(form).slice(1, -1)),
          ...base.map((form) => encodeURIComponent(form)),
          pathToFileURL(dir).href,
        ]
      }
      const needles = [...new Set([...canaries.flatMap(forms), ...rootForms16(root)])]
      expect(
        [
          needles.length > canaries.length,
          canaries.every((c) => needles.includes(c)),
          needles.includes(root),
        ],
        'precondition: every canary and the root among the forms to look for',
      ).toEqual([true, true, true])
      for (const run of runs) {
        const text = [...run.out, ...run.err, run.reportText].join('\n')
        expect
          .soft(
            needles.filter((needle) => text.includes(needle)),
            `(g1) ${label(run)}: no canary or root form in stdout, stderr or the reports`,
          )
          .toEqual([])
      }
    },
  )
})

// ---- Step 17 (design migration-input/p1-step17-design.md §3.7, §3.23, D17-7, D17-23, TP17-7;
// test plan 14.12: T17-44): masters through runCli ----

const MASTERS_HERE_ONLY = 'masters: stopped: masters-here-only'
const mastersArgv = (dir: string, extra: string[] = []) => [
  'masters',
  '--masters',
  dir,
  '--report-dir',
  join(root, 'reports'),
  ...extra,
]
/** A masters tree of one image master (pngOf with caBX), named by its own sha256. */
function writeMastersTree(name = 'masters'): string {
  const dir = join(root, 'p2', name)
  const png = pngOf({ width: 16, height: 16, chunks: ['caBX'], seed: 's17-cli' })
  const sha = createHash('sha256').update(png).digest('hex')
  mkdirSync(join(dir, 'images', 'story-aa'), { recursive: true })
  writeFileSync(join(dir, 'images', 'story-aa', `${sha}.png`), png)
  return dir
}
const mastersReportText = () =>
  ['publisher-masters.json', 'publisher-masters.md']
    .map((name) => readText(join(root, 'reports', name)))
    .join('\n')

describe('runCli: masters (Step 17)', () => {
  it(
    "T17-44 masters through runCli: masters-here-only before any load; the env file once, credentials and the project check; the client only after runMasters' local checks; the real realpath; no secret in any channel (A25, TP17-7)",
    TIMEOUT,
    async () => {
      const dir = writeMastersTree()
      const base = harness(await newStub([]))
      const exit = await runCli(mastersArgv(dir, ['--dry-run', '--timeout-ms', '5000']), base.deps)
      expect(exit, 'precondition: a valid root dry run exits 0').toBe(0)

      // (g1) masters-here-only from the run context and platform, before the env file
      const refused: [string, Partial<CliDeps>][] = [
        ['platform linux', { platform: 'linux' }],
        ['win32 GITHUB_ACTIONS true', { runContext: { GITHUB_ACTIONS: 'true' } }],
        ['win32 github_actions', { runContext: { github_actions: 'true' } }],
        ["win32 VERCEL ''", { runContext: { VERCEL: '' } }],
        ['win32 VERCEL_ENV', { runContext: { VERCEL_ENV: 'preview' } }],
      ]
      const runs: Harness[] = [base]
      for (const [label, over] of refused) {
        const h = harness(null, over)
        runs.push(h)
        const code = await runCli(mastersArgv(dir, ['--dry-run']), h.deps)
        expect
          .soft([code, lastLine(h.out), h.calls], `(g1) ${label}`)
          .toEqual([2, MASTERS_HERE_ONLY, []])
      }

      // (g2) the client only after the local checks: an empty root never builds one
      const empty = join(root, 'p2', 'empty')
      mkdirSync(empty, { recursive: true })
      const emptyRun = harness(null)
      runs.push(emptyRun)
      // A throw out of runCli (the harness factory throws on a path that builds no client) is
      // recorded, so a client built too early fails this group's own assertion (R1-TP-3).
      const emptyExit = await runCli(mastersArgv(empty, ['--dry-run']), emptyRun.deps).catch(
        () => 'threw out of runCli',
      )
      expect
        .soft(
          [emptyExit, lastLine(emptyRun.out), emptyRun.calls],
          '(g2) an empty root: masters-empty, no client',
        )
        .toEqual([1, 'masters: stopped: masters-empty', ['loadEnv']])
      expect
        .soft(base.calls, '(g2) a valid root: the env file once, then the factory once')
        .toEqual(['loadEnv', 'factory'])
      expect.soft(base.options.length, '(g2) a valid root: the factory once').toBe(1)
      expect.soft(base.options[0]?.timeoutMs, '(g2) with the --timeout-ms value').toBe(5000)

      // (g3) the real realpath: a link as the root is masters-root
      const link = join(root, 'p2', 'masters-link')
      let linked = true
      try {
        symlinkSync(dir, link, 'junction')
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EPERM' && code !== 'EACCES') throw error
        console.log('skipped: this host refuses links (S14 PB3)')
        linked = false
      }
      if (linked) {
        const h = harness(null)
        runs.push(h)
        const code = await runCli(mastersArgv(link, ['--dry-run']), h.deps)
        expect
          .soft([code, lastLine(h.out), h.calls.includes('factory')], '(g3) a link as --masters')
          .toEqual([1, 'masters: stopped: masters-root', false])
      }

      // (g4) the key in no line, report or error: on success, on each refusal, and when the
      // client factory throws an error that carries it
      const leaky = harness(null, {
        createClient: () => {
          throw new Error(`factory failed for ${FAKE_KEY}`)
        },
      })
      runs.push(leaky)
      const leakyExit = await runCli(mastersArgv(dir, ['--dry-run']), leaky.deps)
      expect
        .soft(
          [leakyExit, lastLine(leaky.out)],
          '(g4) a throwing factory: internal, its class name only',
        )
        .toEqual([1, 'masters: stopped: internal Error'])
      for (const [i, h] of runs.entries()) {
        expect.soft(everything(h).includes(FAKE_KEY), `(g4) no key in run ${i}'s lines`).toBe(false)
      }
      expect.soft(mastersReportText().includes(FAKE_KEY), '(g4) no key in the report').toBe(false)
    },
  )
})
