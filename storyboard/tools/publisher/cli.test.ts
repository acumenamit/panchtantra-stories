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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_ORIGIN } from '../../src/config/security-headers'
import { jcsBytes } from '../../src/core/hashing'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { runCli, type CliDeps } from './cli'
import { Secret } from './env'
import {
  buildTestStories,
  writeStageInputs,
  type StageInputDirs,
  type TestStory,
} from './stage-testkit'
import { createStorageClient, type StorageClientOptions } from './storage'
import { expectNoUnexpected, startStorageStub, type StorageStub } from './storage-stub'

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
    ...over,
  }
  return { deps, out, err, calls, options }
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
