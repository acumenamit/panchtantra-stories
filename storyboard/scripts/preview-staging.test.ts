// preview:staging (design p1-step9-design.md §3.4 C5-c, §3.6 rows 22-28, §6.1, §10.1; P1-2c): the
// refusals, the two environments (checked against the real resolveConfig and resolveLaunch), the
// shared steps, the whole run, the LAN lines and the next command. The loader, next and check-build
// are fakes throughout: no test reads the real bucket, spawns a real next or binds a port.
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLaunch } from '../src/config/launch'
import { CONTENT_PUBLIC_BASE } from '../src/config/security-headers'
import { BuildInfo } from '../src/core/content/build-info'
import type { GateMode } from '../src/core/content/gates'
import { jcsBytes } from '../src/core/hashing'
import type { CheckBuildOptions } from './check-build'
import {
  environmentLine,
  POINTER_ROOTS,
  resolveConfig,
  STAGING_REFUSED_HERE,
  stagingPointerAllowed,
  type Env,
  type LoaderOptions,
} from './load-content'
import {
  BUILD_STEPS,
  checkPreviewEnv,
  lanUrls,
  LOADER_HINT,
  NEXT_BUILD_ARGS,
  nextCommand,
  nextSpawner,
  PLAIN_HTTP_LINE,
  PREVIEW_HOSTNAME,
  PREVIEW_PORT,
  previewStaging,
  runStagingSteps,
  SIMULATED_LINE,
  STAGING_POINTER,
  STAGING_STEPS,
  stagingEnvs,
  START_ARGS,
  stoppedLine,
  type ChildLike,
  type Interfaces,
  type SpawnLike,
} from './preview-staging'

// Joined at runtime so no file holds a string shaped like a real key (secret scanners on push).
const SENTINEL = ['sb', 'secret', 'preview_never_prints'].join('_')
const PRESET = [
  'VERCEL',
  'VERCEL_ENV',
  'READER_LAUNCH',
  'CONTENT_SOURCE',
  'CONTENT_POINTER',
  'CONTENT_BASE_URL',
] as const
const PARENT: Env = { PATH: '/usr/bin', HOME: '/home/owner' }

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'preview-staging-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A strictly valid build-info with this mode in <root>/.content (what the loader would write). */
function writeBuildInfo(mode: GateMode): void {
  const info = BuildInfo.parse({
    schemaVersion: '1.0',
    mode,
    seq: 1,
    pointerPath: `catalogue/${mode}.json`,
    snapshotPath: 'catalogue/snapshots/1.json',
    snapshotSha256: 'a'.repeat(64),
    featuredStoryId: null,
    stories: [],
    excluded: [],
    appVersion: null,
    deploymentId: null,
    deploymentUrl: null,
    builtAt: '2026-11-15T10:00:00.000Z',
    fetches: [
      {
        path: `catalogue/${mode}.json`,
        status: 200,
        cfCacheStatus: 'MISS',
        age: 0,
        pop: 'BOM',
        sha256: 'abcdef012345',
        ms: 1,
      },
    ],
  })
  mkdirSync(join(root, '.content'), { recursive: true })
  writeFileSync(join(root, '.content', 'build-info.json'), jcsBytes(info))
}

type Written = GateMode | 'absent' | 'invalid'

interface FakeOptions {
  readonly load?: number
  readonly build?: number
  readonly check?: number
  readonly start?: number
  /** What the fake loader leaves in .content/build-info.json when it exits 0. */
  readonly written?: Written
}

/** Fakes for the three steps and next start, recording every call in order. */
function fakes(o: FakeOptions = {}) {
  const calls: string[] = []
  const loads: LoaderOptions[] = []
  const spawns: { readonly args: readonly string[]; readonly env: Env }[] = []
  const checks: CheckBuildOptions[] = []
  const out: string[] = []
  const errors: string[] = []
  const load = async (options: LoaderOptions): Promise<number> => {
    calls.push('load')
    loads.push(options)
    const code = o.load ?? 0
    const written = o.written ?? 'staging'
    if (code !== 0 || written === 'absent') return code
    if (written === 'invalid') {
      mkdirSync(join(root, '.content'), { recursive: true })
      writeFileSync(join(root, '.content', 'build-info.json'), '{"mode":"staging"}')
    } else {
      writeBuildInfo(written)
    }
    return code
  }
  const spawnNext = async (args: readonly string[], env: Env): Promise<number> => {
    calls.push(`next ${args[0]}`)
    spawns.push({ args, env })
    return args[0] === 'build' ? (o.build ?? 0) : (o.start ?? 0)
  }
  const checkBuild = (options: CheckBuildOptions): number => {
    calls.push('check-build')
    checks.push(options)
    return o.check ?? 0
  }
  return {
    calls,
    loads,
    spawns,
    checks,
    out,
    errors,
    load,
    spawnNext,
    checkBuild,
    log: (line: string) => void out.push(line),
    logError: (line: string) => void errors.push(line),
  }
}

const IPV4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal })
const INTERFACES: Interfaces = {
  'Wi-Fi': [IPV4('192.168.1.20'), { address: 'fe80::1', family: 'IPv6', internal: false }],
  'Loopback Pseudo-Interface 1': [
    IPV4('127.0.0.1', true),
    { address: '::1', family: 'IPv6', internal: true },
  ],
  Ethernet: [IPV4('10.0.0.5')],
  Down: undefined,
}

describe('the constants (design §6.1, §3.6 rows 24-25)', () => {
  it('serve on 3006 on every interface, from the staging pointer', () => {
    expect(PREVIEW_PORT).toBe(3006)
    expect(PREVIEW_HOSTNAME).toBe('0.0.0.0')
    expect(STAGING_POINTER).toBe('catalogue/staging.json')
    expect([...START_ARGS]).toEqual(['start', '--port', '3006', '--hostname', '0.0.0.0'])
    expect([...BUILD_STEPS]).toEqual([
      'tsx scripts/load-content.ts',
      'next build',
      'tsx scripts/check-build.ts',
    ])
  })

  it("next build's arguments come from BUILD_STEPS; the in-process steps take none (drift guard)", () => {
    expect(BUILD_STEPS[1].split(' ')[0]).toBe('next')
    expect(['next', ...NEXT_BUILD_ARGS].join(' ')).toBe(BUILD_STEPS[1])
    expect([...NEXT_BUILD_ARGS]).toEqual(['build'])
    // loadContent and runCheckBuild run in-process with no argv: a `build` step that ever passes
    // one to them must change runStagingSteps too, so the guard fails here first.
    expect(BUILD_STEPS[0]).toMatch(/^tsx scripts\/[\w-]+\.ts$/)
    expect(BUILD_STEPS[2]).toMatch(/^tsx scripts\/[\w-]+\.ts$/)
  })

  it('stop lines and the hint are fixed strings', () => {
    expect(STAGING_STEPS.map(stoppedLine)).toEqual([
      'preview:staging: stopped at load-content; nothing is served',
      'preview:staging: stopped at next build; nothing is served',
      'preview:staging: stopped at check-build; nothing is served',
      'preview:staging: stopped at mode check; nothing is served',
    ])
    expect(LOADER_HINT).toBe(
      'if catalogue/staging.json does not exist yet: `stage` writes it (P1 Step 14)',
    )
    expect(SIMULATED_LINE).toBe(
      'preview:staging: simulated Preview build of catalogue/staging.json (reader open, banner on every page, noindex); never deployed',
    )
    expect(PLAIN_HTTP_LINE).toBe(
      'plain HTTP: anyone on this Wi-Fi can open it while it runs; Ctrl+C stops it',
    )
  })
})

describe('checkPreviewEnv (design §3.6 row 26)', () => {
  it('passes a clean shell with no arguments', () => {
    expect(checkPreviewEnv(PARENT, [])).toEqual([])
    expect(checkPreviewEnv({ ...PARENT, GITHUB_ACTIONS: 'false' }, [])).toEqual([])
    expect(checkPreviewEnv({}, [])).toEqual([])
  })

  it.each(
    PRESET.flatMap((name) =>
      [
        ['a value', SENTINEL],
        ['empty', ''],
      ].map(([label, value]) => [name, label, value ?? ''] as const),
    ),
  )(
    'refuses %s preset (%s), naming only the variable and its Remove-Item line',
    (name, _label, value) => {
      const refusals = checkPreviewEnv({ ...PARENT, [name]: value }, [])
      expect(refusals).toEqual([
        `preview:staging: refused: ${name} is set in this shell; run Remove-Item Env:${name} or open a new window`,
      ])
      expect(refusals.join('\n')).not.toContain(SENTINEL)
    },
  )

  it('refuses GITHUB_ACTIONS=true: CI uses the staging harness', () => {
    expect(checkPreviewEnv({ ...PARENT, GITHUB_ACTIONS: 'true' }, [])).toEqual([
      'preview:staging: refused: GITHUB_ACTIONS is true in this shell (CI builds staging with scripts/testing/staging-build.ts); run Remove-Item Env:GITHUB_ACTIONS or open a new window',
    ])
  })

  it('refuses any argument, counting them and never echoing one', () => {
    expect(checkPreviewEnv(PARENT, ['--stub'])).toEqual([
      'preview:staging: refused: it takes no arguments (found 1); run corepack pnpm preview:staging alone',
    ])
    const refusals = checkPreviewEnv(PARENT, [SENTINEL, ''])
    expect(refusals).toEqual([
      'preview:staging: refused: it takes no arguments (found 2); run corepack pnpm preview:staging alone',
    ])
  })

  it('lists every refusal at once, in a fixed order', () => {
    const all = Object.fromEntries(PRESET.map((name) => [name, SENTINEL]))
    const refusals = checkPreviewEnv({ ...all, GITHUB_ACTIONS: 'true' }, [SENTINEL])
    expect(refusals).toHaveLength(PRESET.length + 2)
    expect(refusals.slice(0, PRESET.length).map((line) => line.split(' ')[2])).toEqual([...PRESET])
    expect(refusals.at(-2)).toContain('GITHUB_ACTIONS is true')
    expect(refusals.at(-1)).toContain('no arguments (found 1)')
    expect(refusals.join('\n')).not.toContain(SENTINEL)
  })
})

describe('stagingEnvs (design §6.1, §3.4 C5-c)', () => {
  const parent: Env = {
    ...PARENT,
    CONTENT_SOURCE: 'fixtures',
    CONTENT_POINTER: 'catalogue/production.json',
    CONTENT_BASE_URL: 'https://example.invalid/old',
  }

  it('gives the loader the staging pointer and base, and next build a simulated Preview', () => {
    const before = { ...parent }
    const envs = stagingEnvs(parent, CONTENT_PUBLIC_BASE)
    expect(envs.loader).toEqual({
      ...PARENT,
      CONTENT_SOURCE: 'storage',
      CONTENT_POINTER: 'catalogue/staging.json',
      CONTENT_BASE_URL: CONTENT_PUBLIC_BASE,
    })
    expect(envs.build).toEqual({
      ...PARENT,
      CONTENT_SOURCE: 'storage',
      VERCEL_ENV: 'preview',
      READER_LAUNCH: 'review',
    })
    expect('CONTENT_BASE_URL' in envs.build).toBe(false)
    expect('CONTENT_POINTER' in envs.build).toBe(false)
    expect(parent).toEqual(before)
  })

  it('the loader env loads the staging pointer on this PC (win32) and in CI, with no Vercel variable', () => {
    const { loader } = stagingEnvs(PARENT, CONTENT_PUBLIC_BASE)
    expect(environmentLine(loader, 'win32')).toBe(
      'content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=storage GITHUB_ACTIONS=unset platform=win32',
    )
    const config = resolveConfig(loader, POINTER_ROOTS, 'win32')
    expect(config.ok).toBe(true)
    if (!config.ok || config.value.kind !== 'storage') throw new Error('expected storage')
    expect(config.value.location.mode).toBe('staging')
    expect(config.value.pointerPath).toBe('catalogue/staging.json')
    expect(config.value.baseUrl.href.replace(/\/+$/, '')).toBe(CONTENT_PUBLIC_BASE)
    // Elsewhere outside a Preview it is refused: the loader never gets VERCEL_ENV=preview.
    expect(resolveConfig(loader, POINTER_ROOTS, 'linux')).toEqual({
      ok: false,
      reason: STAGING_REFUSED_HERE,
    })
  })

  it('the build env opens the reader for review, and the loader env opens nothing', () => {
    const { loader, build } = stagingEnvs(PARENT, CONTENT_PUBLIC_BASE)
    expect(resolveLaunch(build)).toEqual({ readerRoutes: true, reason: 'review', refused: false })
    expect(resolveLaunch(loader)).toEqual({
      readerRoutes: false,
      reason: 'committed',
      refused: false,
    })
    // check-build's second lock passes a staging build with this env on any platform.
    for (const platform of ['win32', 'linux', 'darwin']) {
      expect(stagingPointerAllowed(build, platform)).toBe(true)
    }
  })
})

describe('runStagingSteps (design §6.1, §3.6 row 28)', () => {
  const envs = stagingEnvs(PARENT, CONTENT_PUBLIC_BASE)
  const steps = (f: ReturnType<typeof fakes>) =>
    runStagingSteps({
      root,
      loaderEnv: envs.loader,
      buildEnv: envs.build,
      load: f.load,
      spawnNext: f.spawnNext,
      checkBuild: f.checkBuild,
      log: f.log,
      logError: f.logError,
    })

  it('runs the loader, next build and check-build in order, then checks the mode', async () => {
    const f = fakes()
    expect(await steps(f)).toBe(0)
    expect(f.calls).toEqual(['load', 'next build', 'check-build'])
    expect(f.loads).toHaveLength(1)
    expect(f.loads[0]?.root).toBe(root)
    expect(f.loads[0]?.env).toBe(envs.loader)
    expect(f.spawns).toEqual([{ args: ['build'], env: envs.build }])
    // The very array read from BUILD_STEPS[1], not a second literal (drift guard, §3.6 row 24).
    expect(f.spawns[0]?.args).toBe(NEXT_BUILD_ARGS)
    expect(f.checks[0]?.root).toBe(root)
    expect(f.checks[0]?.env).toBe(envs.build)
    expect(f.errors).toEqual([])
  })

  it('a loader failure stops before next build, with the stop line and the hint', async () => {
    const f = fakes({ load: 1 })
    expect(await steps(f)).toBe(1)
    expect(f.calls).toEqual(['load'])
    expect(f.errors).toEqual([stoppedLine('load-content'), LOADER_HINT])
  })

  it('a next build failure stops before check-build and passes its exit code through', async () => {
    const f = fakes({ build: 3 })
    expect(await steps(f)).toBe(3)
    expect(f.calls).toEqual(['load', 'next build'])
    expect(f.errors).toEqual([stoppedLine('next build')])
  })

  it('a check-build failure stops before the mode check', async () => {
    const f = fakes({ check: 1 })
    expect(await steps(f)).toBe(1)
    expect(f.calls).toEqual(['load', 'next build', 'check-build'])
    expect(f.errors).toEqual([stoppedLine('check-build')])
  })

  it.each([
    ['fixtures', 'fixtures'],
    ['production', 'production'],
    ['absent', 'none'],
    ['invalid', 'invalid'],
  ] as const)('a build whose content mode is %s stops at the mode check', async (written, name) => {
    const f = fakes({ written })
    expect(await steps(f)).toBe(1)
    expect(f.errors).toEqual([
      `preview:staging: content mode is ${name}, not staging`,
      stoppedLine('mode check'),
    ])
  })
})

describe('previewStaging, the whole run with fakes (design §6.1 main)', () => {
  const run = (f: ReturnType<typeof fakes>, env: Env = PARENT, argv: readonly string[] = []) => {
    const interfaces = vi.fn(() => INTERFACES)
    const result = previewStaging({
      root,
      env,
      argv,
      interfaces,
      load: f.load,
      spawnNext: f.spawnNext,
      checkBuild: f.checkBuild,
      log: f.log,
      logError: f.logError,
    })
    return { result, interfaces }
  }

  it('builds, prints the URLs, then starts next on 3006 with the parent env unchanged', async () => {
    const f = fakes({ start: 7 })
    const { result } = run(f)
    expect(await result).toBe(7)
    expect(f.calls).toEqual(['load', 'next build', 'check-build', 'next start'])
    expect(f.loads[0]?.env.CONTENT_BASE_URL).toBe(CONTENT_PUBLIC_BASE)
    expect(f.spawns[1]?.args).toEqual(['start', '--port', '3006', '--hostname', '0.0.0.0'])
    expect(f.spawns[1]?.env).toBe(PARENT)
    expect(f.out).toEqual([
      SIMULATED_LINE,
      'http://localhost:3006',
      'http://192.168.1.20:3006',
      'http://10.0.0.5:3006',
      PLAIN_HTTP_LINE,
    ])
    expect(f.errors).toEqual([])
  })

  it('a loader exit 1 spawns nothing and exits 1', async () => {
    const f = fakes({ load: 1 })
    const { result, interfaces } = run(f)
    expect(await result).toBe(1)
    expect(f.spawns).toEqual([])
    expect(f.out).toEqual([])
    expect(interfaces).not.toHaveBeenCalled()
  })

  it('a next build failure starts nothing', async () => {
    const f = fakes({ build: 1 })
    expect(await run(f).result).toBe(1)
    expect(f.calls).toEqual(['load', 'next build'])
  })

  it('a check-build failure starts nothing', async () => {
    const f = fakes({ check: 1 })
    expect(await run(f).result).toBe(1)
    expect(f.spawns.map((s) => s.args[0])).toEqual(['build'])
    expect(f.out).toEqual([])
  })

  it('a mode other than staging starts nothing', async () => {
    const f = fakes({ written: 'fixtures' })
    expect(await run(f).result).toBe(1)
    expect(f.spawns.map((s) => s.args[0])).toEqual(['build'])
    expect(f.errors.at(-1)).toBe(stoppedLine('mode check'))
  })

  it('a refusal exits 2 before any step', async () => {
    const f = fakes()
    const { result, interfaces } = run(f, { ...PARENT, CONTENT_SOURCE: 'fixtures' })
    expect(await result).toBe(2)
    expect(f.calls).toEqual([])
    expect(interfaces).not.toHaveBeenCalled()
    expect(f.errors).toEqual([
      'preview:staging: refused: CONTENT_SOURCE is set in this shell; run Remove-Item Env:CONTENT_SOURCE or open a new window',
    ])
  })

  it('never prints an env value or an argument (a sentinel in every place)', async () => {
    const secretEnv: Env = { ...PARENT, SOME_TOKEN: SENTINEL, NEXT_PUBLIC_X: SENTINEL }
    const presetAll = Object.fromEntries(PRESET.map((name) => [name, SENTINEL]))
    const cases: [FakeOptions, Env, readonly string[], number][] = [
      [{}, secretEnv, [], 0],
      [{ load: 1 }, secretEnv, [], 1],
      [{ build: 1 }, secretEnv, [], 1],
      [{ check: 1 }, secretEnv, [], 1],
      [{ written: 'production' }, secretEnv, [], 1],
      [{}, { ...secretEnv, ...presetAll, GITHUB_ACTIONS: 'true' }, [SENTINEL], 2],
    ]
    let lines = 0
    // One run at a time: the fakes share this test's root.
    for (const [options, env, argv, code] of cases) {
      rmSync(join(root, '.content'), { recursive: true, force: true })
      const f = fakes(options)
      expect(await run(f, env, argv).result).toBe(code)
      for (const line of [...f.out, ...f.errors]) expect(line).not.toContain(SENTINEL)
      lines += f.out.length + f.errors.length
    }
    expect(lines).toBeGreaterThan(PRESET.length + 2)
  })
})

describe('lanUrls (design §6.1)', () => {
  it('lists http://<ip>:3006 for each non-internal IPv4 address', () => {
    expect(lanUrls(INTERFACES)).toEqual(['http://192.168.1.20:3006', 'http://10.0.0.5:3006'])
    expect(lanUrls({})).toEqual([])
    expect(lanUrls({ lo: [IPV4('127.0.0.1', true)] })).toEqual([])
  })
})

class FakeChild extends EventEmitter implements ChildLike {
  readonly kill = vi.fn<(signal?: NodeJS.Signals) => boolean>(() => true)
}

describe('next is run by this Node, with no shell (design §3.6 row 23, §6.1 main step 4)', () => {
  it('runs next/dist/bin/next through process.execPath', () => {
    const { command, args } = nextCommand(START_ARGS)
    expect(command).toBe(process.execPath)
    const bin = args[0] ?? ''
    expect(bin.split(sep).join('/')).toMatch(/\/node_modules\/next\/dist\/bin\/next$/)
    expect(existsSync(bin)).toBe(true)
    expect(args.slice(1)).toEqual(['start', '--port', '3006', '--hostname', '0.0.0.0'])
  })

  function spawner(platform: string) {
    const child = new FakeChild()
    const signals = new EventEmitter()
    const spawned: { command: string; args: readonly string[]; options: unknown }[] = []
    const errors: string[] = []
    const spawnImpl: SpawnLike = (command, args, options) => {
      spawned.push({ command, args, options })
      return child
    }
    const spawnNext = nextSpawner(root, platform, spawnImpl, signals, (line) => {
      errors.push(line)
    })
    return { child, signals, spawned, errors, spawnNext }
  }

  it('spawns with cwd, env and inherited stdio only, and passes the exit code through', async () => {
    const s = spawner('win32')
    const pending = s.spawnNext(START_ARGS, PARENT)
    expect(s.spawned).toHaveLength(1)
    expect(s.spawned[0]?.command).toBe(process.execPath)
    expect(s.spawned[0]?.args.slice(1)).toEqual([...START_ARGS])
    expect(s.spawned[0]?.options).toEqual({ cwd: root, env: PARENT, stdio: 'inherit' })
    expect(s.signals.listenerCount('SIGINT')).toBe(1)
    s.child.emit('exit', 3, null)
    expect(await pending).toBe(3)
    expect(s.signals.listenerCount('SIGINT')).toBe(0)
    expect(s.signals.listenerCount('SIGTERM')).toBe(0)
  })

  it('on Windows ignores Ctrl+C (the child gets it itself) and waits for the exit', async () => {
    const s = spawner('win32')
    const pending = s.spawnNext(START_ARGS, PARENT)
    s.signals.emit('SIGINT')
    s.signals.emit('SIGTERM')
    expect(s.child.kill).not.toHaveBeenCalled()
    s.child.emit('exit', 0, null)
    expect(await pending).toBe(0)
  })

  it('elsewhere forwards SIGINT and SIGTERM to the child', async () => {
    const s = spawner('linux')
    const pending = s.spawnNext(['build'], PARENT)
    s.signals.emit('SIGINT')
    s.signals.emit('SIGTERM')
    expect(s.child.kill.mock.calls).toEqual([['SIGINT'], ['SIGTERM']])
    s.child.emit('exit', null, 'SIGINT')
    expect(await pending).toBe(1)
  })

  it('a child that cannot start resolves 1 and names only the error code', async () => {
    const s = spawner('win32')
    const pending = s.spawnNext(['build'], PARENT)
    s.child.emit('error', Object.assign(new Error(`spawn ${SENTINEL}`), { code: 'ENOENT' }))
    expect(await pending).toBe(1)
    expect(s.errors).toEqual(['preview:staging: next could not start (ENOENT)'])
    expect(s.signals.listenerCount('SIGINT')).toBe(0)
  })
})
