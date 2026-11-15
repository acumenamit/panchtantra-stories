// Prebuild content loader (spec §3.2). Runs as its own tsx process before `next build`, using Node's
// global fetch, so Next's fetch cache is never involved. It reads public configuration only:
//   CONTENT_SOURCE    storage | fixtures | none. Unset: skipped, except when VERCEL_ENV=production,
//                     where the build fails, so a lost setting can never publish an empty site.
//                     fixtures: the committed files under fixtures/ (no network); refused whenever
//                     VERCEL or VERCEL_ENV is set (owner decision D1, VERCEL guard 2026-11-14), and
//                     accepted only in GitHub Actions (GITHUB_ACTIONS=true) or on Windows (P1-2b, R4).
//   CONTENT_BASE_URL  exactly the committed CONTENT_PUBLIC_BASE, or a loopback test server
//   CONTENT_POINTER   <root>catalogue/production.json | <root>catalogue/staging.json (sets the gate mode)
//                     A staging pointer loads only in a Vercel Preview (VERCEL_ENV=preview), or
//                     with VERCEL and VERCEL_ENV unset in GitHub Actions or on Windows (this PC);
//                     check-build reuses the predicate, stagingPointerAllowed (P1-2c; design
//                     p1-step9-design.md §3.3 A).
// Every run first prints a value-free `content: environment …` line (P1-2b; design
// p1-step8-design.md §3.3, §4.5). Storage mode then runs the chain of design §4.1: pointer,
// snapshot, packagePath rule, packages (sha256, JCS, strict parse, ids, validator with the
// snapshot's public waiver keys), media HEAD gate, featured rule.
// Outputs: .content/ (pages read only this) and public/build-info.json, written after every gate passes.
// Any failure prints its detail lines, then "content gate failed: <reason>", and exits 1, so Vercel
// keeps the last good deployment.
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTENT_PUBLIC_BASE } from '../src/config/security-headers'
import { BuildInfo } from '../src/core/content/build-info'
import { featuredVerdict } from '../src/core/content/featured'
import {
  checkPackagePaths,
  checkPointer,
  checkSnapshot,
  DEFAULT_POINTER_ROOTS,
  modeFromPointerPath,
  type GateResult,
  type PointerLocation,
  type StoragePointerLocation,
} from '../src/core/content/gates'
import {
  BUILD_INFO_FILE,
  CONTENT_DIR,
  PACKAGES_DIR,
  packageFileName,
  POINTER_FILE,
  PUBLIC_BUILD_INFO_FILE,
  PUBLIC_DIR,
  SNAPSHOT_FILE,
  TMP_DIR,
} from '../src/core/content/output-layout'
import {
  checkPackage,
  checkUniqueStoryIds,
  packageLogLines,
  type CheckedPackage,
  type CheckPackageOptions,
  type SnapshotEntry,
} from '../src/core/content/packages'
import {
  ATTEMPT_TIMEOUT_MS,
  LOAD_DEADLINE_MS,
  MEDIA_DEADLINE_MS,
  RETRY_DELAY_MS,
} from '../src/core/content/request-policy'
import { jcsBytes, sha256Hex } from '../src/core/hashing'
import { pointerPath } from '../src/core/package/catalogue-build'
import { PANCHATANTRA_RULESET } from '../src/core/rules/panchatantra'
import { checkServiceUrl } from '../tools/publisher/http'
import { createFileSource, type FileSource } from './content/file-source'
import { runMediaGate } from './content/media-gate'
import { getJson, peekSeq, startDeadline, type RequestContext } from './content/request'

export { MAX_BODY_BYTES, popFromCfRay } from './content/request'

export const POINTER_ROOTS: readonly string[] = DEFAULT_POINTER_ROOTS

export type Env = Readonly<Record<string, string | undefined>>

export interface LoaderOptions {
  readonly env: Env
  /** The storyboard folder: outputs go to <root>/.content/ and <root>/public/build-info.json. */
  readonly root: string
  /** process.platform unless a test passes another; fixtures are accepted on win32 (R4). */
  readonly platform?: string
  readonly fetchImpl?: typeof fetch
  readonly now?: () => Date
  readonly clock?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly log?: (line: string) => void
  readonly logError?: (line: string) => void
  /** Per request attempt; 15,000 ms. */
  readonly timeoutMs?: number
  readonly retryDelayMs?: number
  /** The whole load (pointer to media gate); 600,000 ms (design §3.4 row 9). */
  readonly loadDeadlineMs?: number
  /** The media HEAD gate, from its first HEAD; 300,000 ms. */
  readonly mediaDeadlineMs?: number
  readonly roots?: readonly string[]
}

export type LoaderConfig =
  | { readonly kind: 'skip'; readonly why: string }
  | { readonly kind: 'fixtures' }
  | {
      readonly kind: 'storage'
      readonly baseUrl: URL
      readonly pointerPath: string
      readonly location: StoragePointerLocation
    }

const ok = <T>(value: T): GateResult<T> => ({ ok: true, value })
const fail = <T>(reason: string): GateResult<T> => ({ ok: false, reason })

/** The R4 allowlist's refusal (design §4.1 row 1). */
export const FIXTURES_REFUSED_HERE =
  'CONTENT_SOURCE=fixtures runs only in GitHub Actions or on Windows (this PC); refused here (spec §3.2, R4)'

/** The base rule's refusal: it names only the committed constant, never the configured value. */
export const BASE_URL_REFUSED = `CONTENT_BASE_URL must be the committed public base ${CONTENT_PUBLIC_BASE} (spec §3.5, D3)`

/** The staging allowlist's refusal (design p1-step9-design.md §3.3 A; P1-2c); echoes no value. */
export const STAGING_REFUSED_HERE =
  'a staging pointer loads only in a Vercel Preview, in GitHub Actions or on Windows (this PC); refused here (spec §3.2)'

/**
 * Where a staging pointer may load (design p1-step9-design.md §3.3 A; P1-2c). Staging skips the
 * approval gate, so the allowlist is positive: a Vercel Preview (VERCEL_ENV=preview), or, with
 * VERCEL and VERCEL_ENV both unset (any value, even empty, counts as set), GitHub Actions
 * (GITHUB_ACTIONS=true) or Windows (this PC). Vercel builds run on Linux and do not set
 * GITHUB_ACTIONS, so a Production build with system variables off is refused too (the Step 8 blind
 * spot, p1-step8-design.md:200). Pure; check-build reuses it as the second lock of
 * [staging-banner], so the two can never drift apart.
 */
export function stagingPointerAllowed(env: Env, platform: string): boolean {
  if (env.VERCEL_ENV === 'preview') return true
  if (env.VERCEL !== undefined || env.VERCEL_ENV !== undefined) return false
  return env.GITHUB_ACTIONS === 'true' || platform === 'win32'
}

/** Reads the environment only; never echoes a value, so a misplaced secret is never printed. */
export function resolveConfig(
  env: Env,
  roots: readonly string[] = POINTER_ROOTS,
  platform: string = process.platform,
): GateResult<LoaderConfig> {
  const source = env.CONTENT_SOURCE ?? ''
  if (source === '') {
    if (env.VERCEL_ENV === 'production') {
      return fail('CONTENT_SOURCE is not set; it is required when VERCEL_ENV=production')
    }
    return ok({ kind: 'skip', why: 'CONTENT_SOURCE is not set' })
  }
  if (source === 'none') return ok({ kind: 'skip', why: 'CONTENT_SOURCE=none' })
  if (source === 'fixtures') {
    // Fixtures skip the approval gate, so they never build on Vercel. Vercel sets VERCEL=1 and
    // VERCEL_ENV only while system variables are exposed; either one, any value (even empty),
    // refuses fixtures (owner, 2026-11-14), checked first so its message stays. With that option
    // off a Vercel build looks local, so fixtures also need a positive allowlist: GitHub Actions
    // (GITHUB_ACTIONS=true) or Windows (this PC); Vercel builds run on Linux. The value-free
    // environment line printed before this makes such a build visible in any log (P1-2b, R4).
    if (env.VERCEL !== undefined || env.VERCEL_ENV !== undefined) {
      return fail(
        'CONTENT_SOURCE=fixtures is refused when VERCEL or VERCEL_ENV is set (CI and local only)',
      )
    }
    if (env.GITHUB_ACTIONS !== 'true' && platform !== 'win32') return fail(FIXTURES_REFUSED_HERE)
    return ok({ kind: 'fixtures' })
  }
  if (source !== 'storage') return fail('CONTENT_SOURCE must be "storage", "fixtures" or "none"')

  const baseUrl = parseBaseUrl(env.CONTENT_BASE_URL)
  if (!baseUrl.ok) return baseUrl
  const pointerPath = env.CONTENT_POINTER ?? ''
  if (pointerPath === '') return fail('CONTENT_POINTER is not set')
  const location = modeFromPointerPath(pointerPath, roots)
  if (!location.ok) return location
  // Staging skips the approval gate; it is for local preview and hosted Previews only (spec §3.2).
  if (env.VERCEL_ENV === 'production' && location.value.mode !== 'production') {
    return fail('CONTENT_POINTER must be a production pointer when VERCEL_ENV=production')
  }
  // Then the positive allowlist (P1-2c, design p1-step9-design.md §3.3 A). A refusal returns here,
  // before any request and before stale outputs are removed.
  if (location.value.mode === 'staging' && !stagingPointerAllowed(env, platform)) {
    return fail(STAGING_REFUSED_HERE)
  }
  return ok({ kind: 'storage', baseUrl: baseUrl.value, pointerPath, location: location.value })
}

const VERCEL_ENV_NAMES: readonly string[] = ['production', 'preview', 'development']
const CONTENT_SOURCE_NAMES: readonly string[] = ['storage', 'fixtures', 'none']
const PLATFORM_NAMES: readonly string[] = ['win32', 'linux', 'darwin']

/** VERCEL_ENV for log lines: one of Vercel's names, "unset" or "other"; never an arbitrary value. */
export function vercelEnvName(env: Env): string {
  const value = env.VERCEL_ENV ?? ''
  if (value === '') return 'unset'
  return VERCEL_ENV_NAMES.includes(value) ? value : 'other'
}

/** An env value as an enum (design §4.5): unset, empty, one of `listed`, else other. */
function enumName(value: string | undefined, listed: readonly string[]): string {
  if (value === undefined) return 'unset'
  if (value === '') return 'empty'
  return listed.includes(value) ? value : 'other'
}

/**
 * The first line of every run (design §3.3, §4.5): enums only, never a value, so a Vercel build
 * with system variables off (VERCEL=unset) stands out in its log.
 */
export function environmentLine(env: Env, platform: string): string {
  const vercel = env.VERCEL === undefined ? 'unset' : env.VERCEL === '' ? 'empty' : 'set'
  return [
    'content: environment',
    `VERCEL=${vercel}`,
    `VERCEL_ENV=${enumName(env.VERCEL_ENV, VERCEL_ENV_NAMES)}`,
    `CONTENT_SOURCE=${enumName(env.CONTENT_SOURCE, CONTENT_SOURCE_NAMES)}`,
    `GITHUB_ACTIONS=${enumName(env.GITHUB_ACTIONS, ['true'])}`,
    `platform=${PLATFORM_NAMES.includes(platform) ? platform : 'other'}`,
  ].join(' ')
}

const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]']

function parseBaseUrl(raw: string | undefined): GateResult<URL> {
  if (!raw) return fail('CONTENT_BASE_URL is not set')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail('CONTENT_BASE_URL is not a valid URL')
  }
  try {
    // https, or plain http on a loopback test server; no credentials and no fragment.
    checkServiceUrl(url, 'CONTENT_BASE_URL')
  } catch (error) {
    return fail(error instanceof TypeError ? error.message : 'CONTENT_BASE_URL is not allowed')
  }
  if (url.search) return fail('CONTENT_BASE_URL must not carry a query')
  // Exactly the committed public base, compared as the parsed URL (host case and :443 are
  // normalised; any other path or percent-encoding differs), or a loopback test server (P1-2b).
  const committed = url.href.replace(/\/+$/, '') === CONTENT_PUBLIC_BASE
  if (!committed && !LOOPBACK_HOSTS.includes(url.hostname)) return fail(BASE_URL_REFUSED)
  return ok(url)
}

/** Joins a gate-checked (safe) Storage path onto the base URL. */
export function objectUrl(baseUrl: URL, path: string): URL {
  return new URL(`${baseUrl.href.replace(/\/+$/, '')}/${path}`)
}

export interface LoadedContent {
  readonly buildInfo: BuildInfo
  readonly pointerBytes: Uint8Array<ArrayBuffer>
  readonly snapshotBytes: Uint8Array<ArrayBuffer>
  /** Gate-checked packages in snapshot order, written to .content/packages/<storyId>.json. */
  readonly packages: readonly CheckedPackage[]
}

function vercelValue(env: Env, name: string): string | null {
  const value = env[name]?.trim()
  return value ? value.slice(0, 256) : null
}

async function loadFromStorage(
  config: Extract<LoaderConfig, { kind: 'storage' }>,
  env: Env,
  now: () => Date,
  ctx: RequestContext,
  mediaDeadlineMs: number,
): Promise<GateResult<LoadedContent>> {
  const { mode, root } = config.location
  const pointerUrl = objectUrl(config.baseUrl, config.pointerPath)
  pointerUrl.searchParams.set('cacheNonce', String(now().getTime()))
  const pointerBytes = await getJson('pointer', config.pointerPath, pointerUrl, ctx)
  if (!pointerBytes.ok) return pointerBytes
  const pointer = checkPointer(pointerBytes.value, config.location)
  if (!pointer.ok) return pointer

  const { snapshotPath } = pointer.value
  const snapshotUrl = objectUrl(config.baseUrl, snapshotPath)
  const snapshotBytes = await getJson('snapshot', snapshotPath, snapshotUrl, ctx)
  if (!snapshotBytes.ok) return snapshotBytes
  const checked = await checkSnapshot(snapshotBytes.value, pointer.value, mode)
  if (!checked.ok) return checked

  const { snapshot, included, excluded } = checked.value
  const unique = checkUniqueStoryIds(snapshot.stories)
  if (!unique.ok) return unique
  for (const story of excluded) {
    ctx.log(
      `content: excluded story=${story.storyId} version=${story.version} reason=approval-missing`,
    )
  }
  // Every entry, excluded ones too, before any package GET (design §4.1 row 8).
  const paths = checkPackagePaths(snapshot.stories, mode, root)
  if (!paths.ok) return paths
  const packages = await loadPackages(
    snapshot.stories,
    included,
    (entry) =>
      getJson(
        `package ${entry.storyId}`,
        entry.packagePath,
        objectUrl(config.baseUrl, entry.packagePath),
        ctx,
      ),
    ctx.log,
    { requireJcs: true },
  )
  if (!packages.ok) return packages
  const media = await runMediaGate({
    packages: packages.value,
    root,
    objectUrl: (path) => objectUrl(config.baseUrl, path),
    mediaDeadlineMs,
    ctx,
  })
  if (!media.ok) return media
  const featured = featuredVerdict(
    snapshot.featuredStoryId,
    snapshot.stories,
    excluded,
    packages.value,
    PANCHATANTRA_RULESET,
  )
  ctx.log(featured.line)

  const buildInfo = BuildInfo.safeParse({
    schemaVersion: '1.0',
    mode,
    seq: snapshot.seq,
    pointerPath: config.pointerPath,
    snapshotPath,
    snapshotSha256: pointer.value.snapshotSha256,
    featuredStoryId: featured.featuredStoryId,
    stories: builtStories(packages.value),
    excluded: excluded.map((s) => ({
      storyId: s.storyId,
      version: s.version,
      reason: 'approval-missing',
    })),
    appVersion: vercelValue(env, 'VERCEL_GIT_COMMIT_SHA'),
    deploymentId: vercelValue(env, 'VERCEL_DEPLOYMENT_ID'),
    deploymentUrl: vercelValue(env, 'VERCEL_URL'),
    builtAt: now().toISOString(),
    fetches: ctx.fetches,
  })
  if (!buildInfo.success) return fail('build-info failed strict parse')
  return ok({
    buildInfo: buildInfo.data,
    pointerBytes: pointerBytes.value,
    snapshotBytes: snapshotBytes.value,
    packages: packages.value,
  })
}

const builtStories = (packages: readonly CheckedPackage[]) =>
  packages.map(({ entry }) => ({
    storyId: entry.storyId,
    version: entry.version,
    packageSha256: entry.packageSha256,
  }))

// ---- fixtures mode (owner decision D1, 2026-11-13) ----

/** The committed pointer, relative to fixtures/: catalogue/fixtures.json. */
export const FIXTURES_POINTER_PATH = pointerPath('fixtures')
const FIXTURES_LOCATION: PointerLocation = { mode: 'fixtures', root: '' }

/** The folder that holds the committed fixture catalogue and packages. */
export function fixturesDir(root: string): string {
  return join(root, 'fixtures')
}

/** One log line per file read, shaped like the fetch lines of Storage mode. */
async function logRead(path: string, bytes: Uint8Array<ArrayBuffer>, log: (line: string) => void) {
  log(
    `content: read path=${path} sha=${(await sha256Hex(bytes)).slice(0, 12)} seq=${peekSeq(bytes)}`,
  )
}

/**
 * The shared package step (design §4.4), for Storage and the file source alike: a storyId may
 * appear once per snapshot; then each included entry's bytes go through the package gate, one at
 * a time in snapshot order, and the first failure stops the load. Storage passes requireJcs.
 */
export async function loadPackages(
  stories: readonly SnapshotEntry[],
  included: readonly SnapshotEntry[],
  readBytes: (entry: SnapshotEntry) => Promise<GateResult<Uint8Array<ArrayBuffer>>>,
  log: (line: string) => void,
  options: CheckPackageOptions,
): Promise<GateResult<CheckedPackage[]>> {
  const unique = checkUniqueStoryIds(stories)
  if (!unique.ok) return unique
  const packages: CheckedPackage[] = []
  for (const entry of included) {
    const bytes = await readBytes(entry)
    if (!bytes.ok) return bytes
    const checked = await checkPackage(bytes.value, entry, PANCHATANTRA_RULESET, options)
    if (!checked.ok) return checked
    // The package line (computed counts), one line per waived finding and per unused key, then
    // the checks that did not run (private word lists stay on the owner's PC).
    for (const line of packageLogLines(checked.value)) log(line)
    packages.push(checked.value)
  }
  return ok(packages)
}

/** Fixtures mode: the same pointer, snapshot and package gates as Storage, on committed files. */
async function loadFromFixtures(
  source: FileSource,
  env: Env,
  now: () => Date,
  log: (line: string) => void,
): Promise<GateResult<LoadedContent>> {
  const pointerBytes = source(FIXTURES_POINTER_PATH, 'pointer')
  if (!pointerBytes.ok) return pointerBytes
  await logRead(FIXTURES_POINTER_PATH, pointerBytes.value, log)
  const pointer = checkPointer(pointerBytes.value, FIXTURES_LOCATION)
  if (!pointer.ok) return pointer

  const { snapshotPath } = pointer.value
  const snapshotBytes = source(snapshotPath, 'snapshot')
  if (!snapshotBytes.ok) return snapshotBytes
  await logRead(snapshotPath, snapshotBytes.value, log)
  const checked = await checkSnapshot(snapshotBytes.value, pointer.value, 'fixtures')
  if (!checked.ok) return checked

  const { snapshot, included } = checked.value
  const unique = checkUniqueStoryIds(snapshot.stories)
  if (!unique.ok) return unique
  // The committed layout, packages/<storyId>.json, before any package is read (design §3.4 row 21).
  const paths = checkPackagePaths(snapshot.stories, 'fixtures', '')
  if (!paths.ok) return paths
  const packages = await loadPackages(
    snapshot.stories,
    included,
    async (entry) => {
      const bytes = source(entry.packagePath, `package ${entry.storyId}`)
      if (bytes.ok) await logRead(entry.packagePath, bytes.value, log)
      return bytes
    },
    log,
    { requireJcs: false },
  )
  if (!packages.ok) return packages
  // The media HEAD gate needs the network, which fixtures mode never uses, so media is refused.
  for (const { entry, pkg } of packages.value) {
    if (pkg.assets.length > 0 || pkg.nodes.some((node) => node.image !== null)) {
      return fail(
        `package ${entry.storyId} declares media; fixtures mode cannot run the media HEAD gate`,
      )
    }
  }
  // The approval gate is skipped in fixtures mode, so nothing is excluded.
  const featured = featuredVerdict(
    snapshot.featuredStoryId,
    snapshot.stories,
    [],
    packages.value,
    PANCHATANTRA_RULESET,
  )
  log(featured.line)

  const buildInfo = BuildInfo.safeParse({
    schemaVersion: '1.0',
    mode: 'fixtures',
    seq: snapshot.seq,
    pointerPath: FIXTURES_POINTER_PATH,
    snapshotPath,
    snapshotSha256: pointer.value.snapshotSha256,
    featuredStoryId: featured.featuredStoryId,
    stories: builtStories(packages.value),
    excluded: [],
    appVersion: vercelValue(env, 'VERCEL_GIT_COMMIT_SHA'),
    deploymentId: vercelValue(env, 'VERCEL_DEPLOYMENT_ID'),
    deploymentUrl: vercelValue(env, 'VERCEL_URL'),
    builtAt: now().toISOString(),
    fetches: [], // no network in fixtures mode
  })
  if (!buildInfo.success) return fail('build-info failed strict parse')
  return ok({
    buildInfo: buildInfo.data,
    pointerBytes: pointerBytes.value,
    snapshotBytes: snapshotBytes.value,
    packages: packages.value,
  })
}

export function outputPaths(root: string) {
  const contentDir = join(root, CONTENT_DIR)
  return {
    contentDir,
    packagesDir: join(contentDir, PACKAGES_DIR),
    tmpDir: join(contentDir, TMP_DIR),
    publicBuildInfo: join(root, PUBLIC_DIR, PUBLIC_BUILD_INFO_FILE),
  }
}

export function removeStaleOutputs(root: string): void {
  const paths = outputPaths(root)
  rmSync(paths.contentDir, { recursive: true, force: true })
  rmSync(paths.publicBuildInfo, { force: true })
}

/** Each file is written beside the outputs, then renamed, so no reader ever sees a partial file. */
function writeOutputs(root: string, loaded: LoadedContent): void {
  const paths = outputPaths(root)
  mkdirSync(paths.tmpDir, { recursive: true })
  mkdirSync(dirname(paths.publicBuildInfo), { recursive: true })
  const writeAtomic = (target: string, bytes: Uint8Array) => {
    const tmp = join(paths.tmpDir, basename(target))
    writeFileSync(tmp, bytes)
    renameSync(tmp, target)
  }
  const buildInfoBytes = jcsBytes(loaded.buildInfo)
  writeAtomic(join(paths.contentDir, POINTER_FILE), loaded.pointerBytes)
  writeAtomic(join(paths.contentDir, SNAPSHOT_FILE), loaded.snapshotBytes)
  if (loaded.packages.length > 0) mkdirSync(paths.packagesDir, { recursive: true })
  for (const { entry, bytes } of loaded.packages) {
    // storyId is a gate-checked StoryId ([a-z0-9-] only) and unique in the snapshot.
    writeAtomic(join(paths.packagesDir, packageFileName(entry.storyId)), bytes)
  }
  writeAtomic(join(paths.contentDir, BUILD_INFO_FILE), buildInfoBytes)
  writeAtomic(paths.publicBuildInfo, buildInfoBytes) // last: its presence means "content loaded"
  rmSync(paths.tmpDir, { recursive: true, force: true })
}

/** Returns the process exit code: 0 (loaded or skipped) or 1 (gate failed). Never throws. */
export async function loadContent(options: LoaderOptions): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line))
  const logError = options.logError ?? ((line: string) => console.error(line))
  const failWith = (reason: string, details: readonly string[] = []) => {
    for (const line of details) logError(line)
    logError(`content gate failed: ${reason}`)
    return 1
  }
  try {
    const platform = options.platform ?? process.platform
    log(environmentLine(options.env, platform))
    const config = resolveConfig(options.env, options.roots, platform)
    if (!config.ok) return failWith(config.reason)
    removeStaleOutputs(options.root)
    if (config.value.kind === 'skip') {
      // The environment is named, so a skipped Production build stands out in the Vercel log.
      log(`content: skipped (${config.value.why}; VERCEL_ENV=${vercelEnvName(options.env)})`)
      return 0
    }
    const now = options.now ?? (() => new Date())
    const loaded =
      config.value.kind === 'fixtures'
        ? await loadFromFixtures(
            createFileSource(fixturesDir(options.root), 'fixtures'),
            options.env,
            now,
            log,
          )
        : await loadFromStorage(
            config.value,
            options.env,
            now,
            {
              fetchImpl: options.fetchImpl ?? fetch,
              clock: options.clock ?? (() => performance.now()),
              sleep: options.sleep,
              log,
              timeoutMs: options.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
              retryDelayMs: options.retryDelayMs ?? RETRY_DELAY_MS,
              fetches: [],
              loadDeadline: startDeadline(options.loadDeadlineMs ?? LOAD_DEADLINE_MS),
            },
            options.mediaDeadlineMs ?? MEDIA_DEADLINE_MS,
          )
    if (!loaded.ok) return failWith(loaded.reason, loaded.details)
    try {
      writeOutputs(options.root, loaded.value)
    } catch (error) {
      // A write that fails part-way (disk full, a locked file) must not leave half the outputs.
      try {
        removeStaleOutputs(options.root)
      } catch {
        // the build still fails below
      }
      return failWith(
        `writing outputs failed: ${error instanceof Error ? error.message : 'unknown'}`,
      )
    }
    const info = loaded.value.buildInfo
    log(
      `content: mode=${info.mode} seq=${info.seq} snapshot=${info.snapshotPath} stories=${info.stories.length} excluded=${info.excluded.length} featured=${info.featuredStoryId ?? 'none'}`,
    )
    return 0
  } catch (error) {
    return failWith(`unexpected error: ${error instanceof Error ? error.message : 'unknown'}`)
  }
}

/**
 * True when this file is the process entry point (tsx scripts/load-content.ts), not an import.
 * Both sides are resolved to the real file first: import.meta.url is already the real path, while
 * argv[1] keeps a symlink, junction or subst drive as typed. A raw comparison would then skip the
 * loader, and with it every fail-closed gate, and exit 0.
 */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false
  const self = realFile(fileURLToPath(moduleUrl))
  const entry = realFile(resolve(argv1))
  return process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry
}

/** The canonical path with links, junctions and subst drives resolved; the path itself if missing. */
function realFile(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  void loadContent({ env: process.env, root }).then((code) => process.exit(code))
}
