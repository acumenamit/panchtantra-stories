// The stub staging harness (design p1-step9-design.md §3.5, §6.8, §9 item 10; P1-2c): the build of
// the CI e2e staging leg and of the lead's local proofs. Tests and CI only; never deployed.
//   pnpm exec tsx scripts/testing/staging-build.ts [--launch review|gated]   (default review)
// - Refuses (exit 2) when VERCEL or VERCEL_ENV is set (any value, even empty), when the launch
//   variable, CONTENT_SOURCE, CONTENT_POINTER or CONTENT_BASE_URL is preset (even empty), and
//   unless GITHUB_ACTIONS=true or the platform is win32, the only places outside a Preview where a
//   staging pointer loads (design §3.3). Messages name variables only, never a value.
// - Starts the loopback Storage stub (stub-storage.ts) and publishes the 3 committed fixtures as a
//   staging catalogue, plus the test-only picture story derived from river-stones and its 12 media
//   variants (publishFixturesAsStaging with pictureStory; design p1-step10-design.md §2.5, §4.5), so
//   the loader's media HEAD gate makes 12 HEAD requests to the stub; and (P1-5a Step 11, design
//   p1-step11-design.md §8.1) the test-only narrated story derived from river-stones and its 15
//   silent clips (narrationStory), 15 HEADs more, 27 in all; and (P1-3 Step 12a, design
//   p1-step12-design.md §3.17 N18, A19) the test-only featured story derived from river-stones,
//   with a picture on every node and a clip for every node in en and hi (featuredStory: 32 media
//   objects, 59 HEADs in all), which the snapshot names featuredStoryId, so the staging Home shows
//   the Featured hero. Then preview:staging's
//   shared steps (runStagingSteps): the loader against the stub's 127.0.0.1 base (allowed for a
//   loopback server), after which the stub is closed at once; next build; check-build; the mode
//   check. Build env: review is preview:staging's (stagingEnvs(...).build: a simulated Preview with
//   the reader open); gated passes only CONTENT_SOURCE=storage, the committed gated state, like a
//   hosted Preview whose launch variable is not set. next build never sees the loopback base.
// - Starts no server: Playwright's webServer runs `pnpm start` on 3005. Like any build it writes
//   the real storyboard/.content, .next and public/build-info.json.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCheckBuild, type CheckBuildOptions } from '../check-build'
import { isEntryPoint, loadContent, type Env, type LoaderOptions } from '../load-content'
import { nextSpawner, runStagingSteps, stagingEnvs, type SpawnNext } from '../preview-staging'
import { FEATURED_STORY_ID } from './featured-story-id'
import { NARRATION_STORY_ID } from './narration-story-id'
import { PICTURE_STORY_ID } from './picture-story-id'
import { FIXTURES_DIR, publishFixturesAsStaging } from './staging-catalogue'
import { startStubStorage, type StubStorage } from './stub-storage'

export const HARNESS_LAUNCHES = ['review', 'gated'] as const
export type HarnessLaunch = (typeof HARNESS_LAUNCHES)[number]

export const HARNESS_USAGE =
  'staging-build: refused: usage: tsx scripts/testing/staging-build.ts [--launch review|gated]'

export const HARNESS_PLACE_REFUSED =
  'staging-build: refused: a staging pointer loads here only in GitHub Actions (GITHUB_ACTIONS=true) or on Windows (design p1-step9-design.md §3.3)'

/** Variables the harness sets itself; any preset one, even empty, refuses the run. */
const PRESET_NAMES = [
  'VERCEL',
  'VERCEL_ENV',
  'READER_LAUNCH',
  'CONTENT_SOURCE',
  'CONTENT_POINTER',
  'CONTENT_BASE_URL',
] as const

/** The launch the arguments ask for: none means review; anything else is null (refused). */
export function parseHarnessArgs(argv: readonly string[]): HarnessLaunch | null {
  if (argv.length === 0) return 'review'
  const [flag, value] = argv
  if (argv.length !== 2 || flag !== '--launch') return null
  return HARNESS_LAUNCHES.find((launch) => launch === value) ?? null
}

/** The refusals of design §6.8, one line each, in a fixed order; empty when the run may go on. */
export function checkHarnessEnv(env: Env, platform: string): string[] {
  const refusals: string[] = []
  for (const name of PRESET_NAMES) {
    if (env[name] !== undefined) {
      refusals.push(`staging-build: refused: ${name} is set; the harness sets what it needs`)
    }
  }
  if (env.GITHUB_ACTIONS !== 'true' && platform !== 'win32') refusals.push(HARNESS_PLACE_REFUSED)
  return refusals
}

/** next build's and check-build's env for each launch (design §6.8). */
export function harnessBuildEnv(parent: Env, launch: HarnessLaunch, loaderBase: string): Env {
  if (launch === 'review') return stagingEnvs(parent, loaderBase).build
  return { ...parent, CONTENT_SOURCE: 'storage' }
}

export interface StagingBuildOptions {
  /** The storyboard folder (a temp folder in tests). */
  readonly root: string
  readonly env: Env
  readonly platform: string
  readonly argv: readonly string[]
  readonly startStub: () => Promise<StubStorage>
  readonly load: (options: LoaderOptions) => Promise<number>
  readonly spawnNext: SpawnNext
  readonly checkBuild: (options: CheckBuildOptions) => number
  readonly log: (line: string) => void
  readonly logError: (line: string) => void
}

/** The whole harness run; resolves with the process exit code. */
export async function stagingBuild(options: StagingBuildOptions): Promise<number> {
  const { log, logError } = options
  const launch = parseHarnessArgs(options.argv)
  const refusals = [
    ...(launch === null ? [HARNESS_USAGE] : []),
    ...checkHarnessEnv(options.env, options.platform),
  ]
  if (launch === null || refusals.length > 0) {
    for (const line of refusals) logError(line)
    return 2
  }
  const stub = await options.startStub()
  let open = true
  const closeStub = async (): Promise<void> => {
    if (!open) return
    open = false
    await stub.close()
    log('staging-build: stub closed')
  }
  try {
    const catalogue = await publishFixturesAsStaging(stub, FIXTURES_DIR, {
      pictureStory: true,
      narrationStory: true,
      featuredStory: true,
    })
    const mediaOfStory = (storyId: string): number =>
      catalogue.media.filter((object) => object.path.startsWith(`media/${storyId}/`)).length
    log(
      `staging-build: launch=${launch}; stub on 127.0.0.1 serves ${catalogue.packages.length} packages under ${catalogue.pointerPath}: ${catalogue.packages.length - 3} fixtures, the derived picture story ${PICTURE_STORY_ID} with ${mediaOfStory(PICTURE_STORY_ID)} media objects, the derived narrated story ${NARRATION_STORY_ID} with ${mediaOfStory(NARRATION_STORY_ID)} media objects and the derived featured story ${FEATURED_STORY_ID} with ${mediaOfStory(FEATURED_STORY_ID)} media objects`,
    )
    const envs = stagingEnvs(options.env, stub.baseUrl)
    const code = await runStagingSteps({
      root: options.root,
      loaderEnv: envs.loader,
      buildEnv: harnessBuildEnv(options.env, launch, stub.baseUrl),
      // The stub is closed right after the loader step, pass or fail.
      load: async (loaderOptions) => {
        try {
          return await options.load(loaderOptions)
        } finally {
          await closeStub()
        }
      },
      spawnNext: options.spawnNext,
      checkBuild: options.checkBuild,
      log,
      logError,
    })
    if (code === 0) log(`staging-build: ok (launch=${launch})`)
    return code
  } finally {
    await closeStub()
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  stagingBuild({
    root,
    env: process.env,
    platform: process.platform,
    argv: process.argv.slice(2),
    startStub: startStubStorage,
    load: loadContent,
    spawnNext: nextSpawner(root),
    checkBuild: runCheckBuild,
    log: (line) => console.log(line),
    logError: (line) => console.error(line),
  }).then(
    // exitCode, not process.exit(): on Windows an exit while the closed stub's sockets are still
    // closing trips a libuv assertion and turns a loader failure's 1 into 127 (design §10.5 item 6).
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      console.error(
        `staging-build: unexpected error: ${error instanceof Error ? error.message : 'unknown'}`,
      )
      process.exitCode = 1
    },
  )
}
