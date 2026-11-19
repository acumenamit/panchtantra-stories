// The stub staging harness and its catalogue (design p1-step9-design.md §6.8, §7, §10.1; P1-2c):
// the refusals and build envs; publishFixturesAsStaging plus in-process loadContent into a temp
// root (platform win32): exit 0, mode staging, 3 stories and no HEAD; one tampered package byte:
// exit 1 and nothing written. Then the whole harness run with the real loopback stub and loader
// but fakes for next and check-build, so no real next build runs and no server starts.
// P1-4b Step 10e (design p1-step10-design.md §2.5, §4.5): the harness publishes with pictureStory,
// so its run loads 4 stories and makes the picture story's 12 media HEADs on the stub (planned
// expectation update); the direct publishFixturesAsStaging calls here stay as they were (C3).
// P1-5a Step 11 (design p1-step11-design.md §8.1, §13.3 T11-22, §13.5): the harness also publishes
// the narrated story (narrationStory), so its run loads 5 stories and makes 27 media HEADs (the
// picture story's 12 and the narrated story's 15 clips of 6,048 bytes); planned expectation
// updates of the first log line, the media lines, the HEAD count and the stories list.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveLaunch } from '../../src/config/launch'
import { BuildInfo } from '../../src/core/content/build-info'
import { sha256Hex, toJcs } from '../../src/core/hashing'
import { CatalogueSnapshot } from '../../src/core/package/catalogue'
import type { CheckBuildOptions } from '../check-build'
import { loadContent, type Env, type LoaderOptions } from '../load-content'
import { LOADER_HINT, stagingEnvs, stoppedLine } from '../preview-staging'
import {
  checkHarnessEnv,
  HARNESS_PLACE_REFUSED,
  HARNESS_USAGE,
  harnessBuildEnv,
  parseHarnessArgs,
  stagingBuild,
  type HarnessLaunch,
} from './staging-build'
import {
  FIXTURES_DIR,
  publishFixturesAsStaging,
  STAGING_NOTE,
  STAGING_POINTER_PATH,
} from './staging-catalogue'
import { NARRATION_STORY_ID } from './narration-story-id'
import { PICTURE_STORY_ID } from './picture-story-id'
import { startStubStorage, type StubStorage } from './stub-storage'

const NOW = new Date('2026-11-15T10:00:00.000Z')
// Joined at runtime so no file holds a string shaped like a real key (secret scanners on push).
const SENTINEL = ['sb', 'secret', 'harness_never_prints'].join('_')
const FIXTURE_IDS = ['lantern-walk', 'river-stones', 'two-paths']
const PRESET = [
  'VERCEL',
  'VERCEL_ENV',
  'READER_LAUNCH',
  'CONTENT_SOURCE',
  'CONTENT_POINTER',
  'CONTENT_BASE_URL',
] as const
const STAGING_ENV_LINE =
  'content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=storage GITHUB_ACTIONS=unset platform=win32'
const MODE_LINE =
  'content: mode=staging seq=1 snapshot=catalogue/snapshots/1.json stories=3 excluded=0 featured=none'
const BASE = 'http://127.0.0.1:1/storage/v1/object/public/content'
/** The harness run's mode line: the 3 fixtures and the derived picture and narrated stories. */
const HARNESS_MODE_LINE = MODE_LINE.replace('stories=3', 'stories=5')

let root: string
let stubs: StubStorage[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'staging-build-'))
  stubs = []
})

afterEach(async () => {
  for (const stub of stubs) await stub.close()
  rmSync(root, { recursive: true, force: true })
})

async function stub(): Promise<StubStorage> {
  const started = await startStubStorage()
  stubs.push(started)
  return started
}

const fixtureJson = (storyId: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, 'packages', `${storyId}.json`), 'utf8'))

const outputs = () => ({
  contentDir: join(root, '.content'),
  contentInfo: join(root, '.content', 'build-info.json'),
  publicInfo: join(root, 'public', 'build-info.json'),
})

/** The loader as the harness runs it, pinned to this PC's platform and a fixed clock. */
const loadWin32 = (options: LoaderOptions) =>
  loadContent({ ...options, platform: 'win32', now: () => NOW })

/** Flips one byte of the first package the stub is given (a tampered upload). */
function tampering(real: StubStorage): StubStorage {
  let done = false
  return {
    baseUrl: real.baseUrl,
    requests: real.requests,
    get maxInFlight() {
      return real.maxInFlight
    },
    put(path, bytes, contentType) {
      if (!done && path.startsWith('packages/')) {
        done = true
        const copy = new Uint8Array(bytes)
        copy[10] = (copy[10] ?? 0) ^ 1
        real.put(path, copy, contentType)
      } else real.put(path, bytes, contentType)
    },
    putFolder: real.putFolder,
    queue: real.queue,
    setCookie: real.setCookie,
    reset: real.reset,
    close: real.close,
  }
}

describe('parseHarnessArgs (design §6.8)', () => {
  it('takes no arguments (review) or exactly --launch review|gated', () => {
    expect(parseHarnessArgs([])).toBe('review')
    expect(parseHarnessArgs(['--launch', 'review'])).toBe('review')
    expect(parseHarnessArgs(['--launch', 'gated'])).toBe('gated')
    for (const argv of [
      ['--launch'],
      ['--launch', 'open'],
      ['--launch=gated'],
      ['gated'],
      ['--launch', 'gated', 'extra'],
      ['--stub'],
    ]) {
      expect(parseHarnessArgs(argv), argv.join(' ')).toBeNull()
    }
  })
})

describe('checkHarnessEnv (design §6.8)', () => {
  it('runs only in GitHub Actions or on Windows', () => {
    expect(checkHarnessEnv({}, 'win32')).toEqual([])
    expect(checkHarnessEnv({ GITHUB_ACTIONS: 'true' }, 'linux')).toEqual([])
    expect(checkHarnessEnv({}, 'linux')).toEqual([HARNESS_PLACE_REFUSED])
    expect(checkHarnessEnv({}, 'darwin')).toEqual([HARNESS_PLACE_REFUSED])
    expect(checkHarnessEnv({ GITHUB_ACTIONS: 'false' }, 'linux')).toEqual([HARNESS_PLACE_REFUSED])
  })

  it.each(
    PRESET.flatMap((name) =>
      [
        ['a value', SENTINEL],
        ['empty', ''],
        ['preview', 'preview'],
      ].map(([label, value]) => [name, label, value ?? ''] as const),
    ),
  )('refuses %s preset (%s), naming only the variable', (name, _label, value) => {
    const refusals = checkHarnessEnv({ [name]: value, GITHUB_ACTIONS: 'true' }, 'linux')
    expect(refusals).toEqual([
      `staging-build: refused: ${name} is set; the harness sets what it needs`,
    ])
    expect(refusals.join('\n')).not.toContain(SENTINEL)
  })
})

describe('harnessBuildEnv (design §6.8)', () => {
  const parent: Env = { PATH: '/usr/bin', GITHUB_ACTIONS: 'true' }

  it("review is preview:staging's simulated Preview: reader open, no loopback base", () => {
    const env = harnessBuildEnv(parent, 'review', BASE)
    expect(env).toEqual(stagingEnvs(parent, BASE).build)
    expect(env).toEqual({
      ...parent,
      CONTENT_SOURCE: 'storage',
      VERCEL_ENV: 'preview',
      READER_LAUNCH: 'review',
    })
    expect(resolveLaunch(env)).toEqual({ readerRoutes: true, reason: 'review', refused: false })
  })

  it('gated passes only CONTENT_SOURCE=storage: the committed gated state', () => {
    const env = harnessBuildEnv(parent, 'gated', BASE)
    expect(env).toEqual({ ...parent, CONTENT_SOURCE: 'storage' })
    expect(resolveLaunch(env)).toEqual({
      readerRoutes: false,
      reason: 'committed',
      refused: false,
    })
  })
})

describe('publishFixturesAsStaging (design §6.8, §3.6 row 29)', () => {
  it('publishes the 3 fixtures as canonical JCS at the spec layout, a snapshot and the staging pointer', async () => {
    const puts: { path: string; bytes: Uint8Array; type: string }[] = []
    const catalogue = await publishFixturesAsStaging({
      put: (path, bytes, type) => void puts.push({ path, bytes, type }),
    })
    expect(catalogue.pointerPath).toBe('catalogue/staging.json')
    expect(STAGING_POINTER_PATH).toBe('catalogue/staging.json')
    expect(catalogue.snapshotPath).toBe('catalogue/snapshots/1.json')
    expect(puts.map((p) => p.type)).toEqual(Array(5).fill('application/json'))
    expect(puts.map((p) => p.path)).toEqual([
      ...catalogue.packages.map((p) => p.entry.packagePath),
      'catalogue/snapshots/1.json',
      'catalogue/staging.json',
    ])
    expect(catalogue.packages.map((p) => p.entry.storyId)).toEqual(FIXTURE_IDS)
    for (const { entry, bytes } of catalogue.packages) {
      const sha = await sha256Hex(bytes)
      expect(entry.packageSha256).toBe(sha)
      expect(entry.packagePath).toBe(`packages/${entry.storyId}/${sha}.json`)
      const text = new TextDecoder().decode(bytes)
      expect(toJcs(JSON.parse(text))).toBe(text) // canonical JCS
      expect(JSON.parse(text)).toEqual(fixtureJson(entry.storyId)) // the committed package
      expect(entry).not.toHaveProperty('approvalSha256')
    }
    const snapshot = CatalogueSnapshot.parse(
      JSON.parse(new TextDecoder().decode(catalogue.snapshotBytes)),
    )
    expect(snapshot).toMatchObject({ seq: 1, featuredStoryId: null, note: STAGING_NOTE })
    expect(snapshot.stories).toEqual(catalogue.packages.map((p) => p.entry))
  })

  it('loads in-process into a temp root on win32: exit 0, mode staging, 3 stories, 0 HEADs', async () => {
    const s = await stub()
    const catalogue = await publishFixturesAsStaging(s)
    const out: string[] = []
    const errors: string[] = []
    const env = stagingEnvs({}, s.baseUrl).loader
    const code = await loadWin32({
      env,
      root,
      log: (line) => void out.push(line),
      logError: (line) => void errors.push(line),
    })
    expect(errors).toEqual([])
    expect(code).toBe(0)
    expect(s.requests.map((r) => [r.method, r.path])).toEqual([
      ['GET', 'catalogue/staging.json'],
      ['GET', 'catalogue/snapshots/1.json'],
      ...catalogue.packages.map((p) => ['GET', p.entry.packagePath]),
    ])
    expect(s.requests.filter((r) => r.method === 'HEAD')).toEqual([])
    expect(out[0]).toBe(STAGING_ENV_LINE)
    expect(out.at(-1)).toBe(MODE_LINE)
    const info = BuildInfo.parse(JSON.parse(readFileSync(outputs().contentInfo, 'utf8')))
    expect(info.mode).toBe('staging')
    expect(info.stories.map((story) => story.storyId)).toEqual(FIXTURE_IDS)
    expect(readFileSync(outputs().publicInfo)).toEqual(readFileSync(outputs().contentInfo))
    expect(readdirSync(join(root, '.content', 'packages')).sort()).toEqual(
      FIXTURE_IDS.map((id) => `${id}.json`),
    )
    for (const { entry, bytes } of catalogue.packages) {
      const written = readFileSync(join(root, '.content', 'packages', `${entry.storyId}.json`))
      expect(new Uint8Array(written)).toEqual(bytes)
    }
  })

  it('one tampered package byte: exit 1 at the package gate, and nothing written', async () => {
    const s = await stub()
    const catalogue = await publishFixturesAsStaging(tampering(s))
    const errors: string[] = []
    const code = await loadWin32({
      env: stagingEnvs({}, s.baseUrl).loader,
      root,
      log: () => undefined,
      logError: (line) => void errors.push(line),
    })
    expect(code).toBe(1)
    expect(errors).toEqual(['content gate failed: package lantern-walk sha256 mismatch'])
    expect(s.requests.map((r) => r.path)).toEqual([
      'catalogue/staging.json',
      'catalogue/snapshots/1.json',
      catalogue.packages[0]?.entry.packagePath,
    ])
    expect(existsSync(outputs().contentDir)).toBe(false)
    expect(existsSync(outputs().publicInfo)).toBe(false)
  })
})

describe('stagingBuild, the whole harness run (design §6.8)', () => {
  function harness(
    o: { argv?: readonly string[]; env?: Env; platform?: string; tamper?: boolean } = {},
  ) {
    const calls: string[] = []
    const spawns: { args: readonly string[]; env: Env; stubOpen: boolean }[] = []
    const checks: CheckBuildOptions[] = []
    const out: string[] = []
    const errors: string[] = []
    let started: StubStorage | undefined
    let closed = 0
    const result = stagingBuild({
      root,
      env: o.env ?? {},
      platform: o.platform ?? 'win32',
      argv: o.argv ?? [],
      startStub: async () => {
        calls.push('start stub')
        const real = await stub()
        const served = o.tamper ? tampering(real) : real
        started = {
          ...served,
          put: served.put,
          close: async () => {
            closed++
            calls.push('close stub')
            await real.close()
          },
        }
        return started
      },
      load: async (options) => {
        calls.push('load')
        return loadWin32(options)
      },
      spawnNext: async (args, env) => {
        calls.push(`next ${args[0]}`)
        spawns.push({ args, env, stubOpen: closed === 0 })
        return 0
      },
      checkBuild: (options) => {
        calls.push('check-build')
        checks.push(options)
        return 0
      },
      log: (line) => void out.push(line),
      logError: (line) => void errors.push(line),
    })
    return {
      result,
      calls,
      spawns,
      checks,
      out,
      errors,
      stub: () => started,
      closes: () => closed,
    }
  }

  it.each(['review', 'gated'] as const)(
    '--launch %s: publish, load, close the stub, next build, check-build, mode staging',
    async (launch: HarnessLaunch) => {
      const parent: Env = { PATH: '/usr/bin' }
      const h = harness({ argv: ['--launch', launch], env: parent })
      expect(await h.result).toBe(0)
      expect(h.errors).toEqual([])
      expect(h.calls).toEqual(['start stub', 'load', 'close stub', 'next build', 'check-build'])
      expect(h.closes()).toBe(1)
      const base = h.stub()?.baseUrl ?? ''
      expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/storage\/v1\/object\/public\/content$/)
      const buildEnv =
        launch === 'review'
          ? { ...parent, CONTENT_SOURCE: 'storage', VERCEL_ENV: 'preview', READER_LAUNCH: 'review' }
          : { ...parent, CONTENT_SOURCE: 'storage' }
      expect(h.spawns).toEqual([{ args: ['build'], env: buildEnv, stubOpen: false }])
      expect(h.checks.map((c) => [c.root, c.env])).toEqual([[root, buildEnv]])
      expect(JSON.stringify(h.spawns)).not.toContain('127.0.0.1') // next build never sees the base
      expect(h.out).toContain(STAGING_ENV_LINE)
      expect(h.out).toContain(HARNESS_MODE_LINE)
      expect(h.out[0]).toBe(
        `staging-build: launch=${launch}; stub on 127.0.0.1 serves 5 packages under catalogue/staging.json: 3 fixtures, the derived picture story ${PICTURE_STORY_ID} with 12 media objects and the derived narrated story ${NARRATION_STORY_ID} with 15 media objects`,
      )
      // The picture story's 12 variants and the narrated story's 15 clips (15 × 6,048 bytes) pass
      // the loader's media HEAD gate on the stub.
      expect(h.out).toContain(`content: media story=${PICTURE_STORY_ID} variants=12 bytes=408 ok`)
      expect(h.out).toContain(
        `content: media story=${NARRATION_STORY_ID} variants=15 bytes=90720 ok`,
      )
      expect(h.stub()?.requests.filter((r) => r.method === 'HEAD')).toHaveLength(27)
      expect(h.out.indexOf('staging-build: stub closed')).toBe(h.out.indexOf(HARNESS_MODE_LINE) + 1)
      expect(h.out.at(-1)).toBe(`staging-build: ok (launch=${launch})`)
      const info = BuildInfo.parse(JSON.parse(readFileSync(outputs().contentInfo, 'utf8')))
      expect(info.mode).toBe('staging')
      expect(info.stories.map((story) => story.storyId)).toEqual([
        'lantern-walk',
        'river-stones',
        PICTURE_STORY_ID,
        NARRATION_STORY_ID,
        'two-paths',
      ])
    },
  )

  it('a tampered package: exit 1 at the loader; next build and check-build never run; nothing written', async () => {
    const h = harness({ tamper: true })
    expect(await h.result).toBe(1)
    expect(h.calls).toEqual(['start stub', 'load', 'close stub'])
    expect(h.spawns).toEqual([])
    expect(h.checks).toEqual([])
    expect(h.errors).toEqual([
      'content gate failed: package lantern-walk sha256 mismatch',
      stoppedLine('load-content'),
      LOADER_HINT,
    ])
    expect(existsSync(outputs().contentDir)).toBe(false)
    expect(existsSync(outputs().publicInfo)).toBe(false)
  })

  it('refusals exit 2 before the stub starts', async () => {
    const bad = harness({ argv: ['--launch', 'open'] })
    expect(await bad.result).toBe(2)
    expect(bad.errors).toEqual([HARNESS_USAGE])
    const preset = harness({ env: { CONTENT_SOURCE: SENTINEL } })
    expect(await preset.result).toBe(2)
    expect(preset.errors).toEqual([
      'staging-build: refused: CONTENT_SOURCE is set; the harness sets what it needs',
    ])
    const linux = harness({ platform: 'linux' })
    expect(await linux.result).toBe(2)
    expect(linux.errors).toEqual([HARNESS_PLACE_REFUSED])
    for (const h of [bad, preset, linux]) {
      expect(h.calls).toEqual([])
      expect(h.out).toEqual([])
    }
    expect(existsSync(outputs().contentDir)).toBe(false)
  })

  it('never prints an env value (a sentinel in the parent env and in a refused one)', async () => {
    const ok = harness({ env: { SOME_TOKEN: SENTINEL, PATH: SENTINEL } })
    expect(await ok.result).toBe(0)
    const refused = harness({ env: { VERCEL_ENV: SENTINEL, READER_LAUNCH: SENTINEL } })
    expect(await refused.result).toBe(2)
    const lines = [...ok.out, ...ok.errors, ...refused.out, ...refused.errors]
    expect(lines.length).toBeGreaterThan(10)
    for (const line of lines) expect(line).not.toContain(SENTINEL)
  })
})
