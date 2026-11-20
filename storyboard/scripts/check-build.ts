// Post-build check (P1 D4; design p1-step7-design.md §5.7 item 2, §8.1 item 11; P1-1c). `pnpm build`
// runs it right after `next build`, so it also runs inside Vercel's build: exit 1 fails the build
// and Vercel keeps the last good deployment (spec §3.2). It reads .next/prerender-manifest.json,
// the prerendered HTML (under .next/server/app, or under .next/server/route-cache when a deployment
// adapter such as Vercel's is set; see readPrerenderedHtml) and the client JS under .next/static:
// - State agreement first: the launch state is derived from the output alone (locale pages and
//   the gate's redirect script present, or absent) and compared with the decision recomputed from
//   this process's environment. next build loads .env* files and this tsx script does not, so a
//   decision input set in one of them shows up here as a disagreement and stops the build.
// - Gated: no locale page, a /[locale] pattern entry with fallback false, "/" exactly the
//   Coming-soon markup with no redirect script, no locale link and no Hindi island.
// - Open: a page for every enabled locale and none for a disabled one, both gate links and the
//   redirect script exactly once on "/", <html lang> per locale page. Deliberately loose about
//   deeper routes, so later steps need not edit it ([player-pages] and [landing-pages] below are
//   the exceptions).
// - Both: "/" and /_not-found are built; every /[locale]… pattern has fallback false (with
//   dynamicParams = false every unlisted param is a 404); noindex, nofollow exactly once on every
//   200 page and noindex on the 404; no message value of 16 or more UTF-16 code units in client JS,
//   raw or \uXXXX-escaped in either hex case (a minifier may escape Devanagari and ’).
// - A missing file is a failure, never a skip. It prints the launch line once (the only place it
//   is printed: next.config is loaded by several build workers), then each failed rule by name.
// - [content-outputs] (C-2; design p1-step8-design.md §3.3, §9 item 35; P1-2b): .content/ and
//   public/build-info.json exist exactly when the loader loaded content. With CONTENT_SOURCE
//   unset, empty or none neither exists, so a gated build proves /build-info.json cannot be
//   served; with fixtures or storage both build-info copies exist, are byte-equal and name a mode
//   that agrees with CONTENT_SOURCE.
// - [staging-banner] (design p1-step9-design.md §3.6 rows 12-15, §4.5, §9 item 7; P1-2c): the
//   pages are every prerendered HTML file in both output layouts except _global-error.html. When
//   .content/build-info.json names mode staging, every page holds exactly one banner: a <p> with
//   lang="en" and exactly the committed text, before the first <main, <header and <a ; and the
//   build fails wherever the loader would refuse a staging pointer (the shared
//   stagingPointerAllowed, on this process's environment and platform: the second lock). Any
//   other mode, or no content: no page holds the banner attribute in any form or the banner text
//   (raw or \u-escaped). Every build: neither reaches .next/static JS. Right after the launch line,
//   every run (pass or fail) prints one value-free line: "content mode: <none|fixtures|staging|
//   production|invalid>; staging banner pages: <n> of <m>".
// - [player-pages] (design p1-step10-design.md §9.1 G1; P1-4b): the story player's pages are
//   <locale>/stories/<storyId>/read.html, in either output layout. "Content loaded" means
//   .content/build-info.json exists and parses strictly. Open with content loaded: exactly one page
//   per story build-info lists and per enabled locale of its package (.content/packages/<id>.json,
//   parsed with the strict StoryPackageV1, as the reader parses it; src/content is server-only, so
//   it is not imported here), each with exactly one main element, and that one <main id="main">
//   (attributes in any order), and its <html lang>; with at least one story, a
//   /[locale]/stories/[storyId]/read pattern entry too. Gated, or no content: no player page.
// - [package-text-leak] (C-3; design p1-step10-design.md §9.1 G2): no line (split on \n) of 16 or
//   more UTF-16 code units of any text value of any built package, in any of its locales, in
//   .next/static JS: raw, JSON-escaped, with every ' written \', with every </ written <\/, and the
//   two crossings a minifier can make of these (JSON-escaped with <\/; \' with <\/), each also
//   \u-escaped in either hex case. It fails when build-info lists a story and no value was scanned.
//   Documented limit: a line split across concatenated string literals is not found.
// - Right after the content mode line, every run prints one value-free line (design §8): "player
//   pages: <n> (expected <m>); package text values scanned: <k>" ("unknown" where the build output
//   or a package could not be read). Failures name files and ids only, never a text value, in the
//   §8 forms: "[player-pages] missing <path>", "[player-pages] unexpected <path> (<why>)",
//   "[player-pages] gated build has <path>", "[player-pages] <path>: <main id="main" <k> time(s)",
//   "[player-pages] <path>: <main <k> time(s)", "[player-pages] <path>: <html lang> is not <code>",
//   "[package-text-leak] <static file>: storyId <id> locale <l> node <n|-> field <f>" (plus the form
//   that matched) and "[package-text-leak] content is loaded but 0 values were scanned".
// - [landing-pages] (P1 Step 12; design p1-step12-design.md §3.16 N17, A18): the story landings,
//   <locale>/stories/<storyId>.html (never read.html, a sibling folder or another extension), in
//   either output layout, by the [player-pages] rules: open with content loaded, exactly one per
//   listed story and enabled locale of its package, each with one main element, that one <main
//   id="main">, and its <html lang>; with at least one story, a /[locale]/stories/[storyId] pattern
//   entry too. Gated, or no content: no landing. A package that could not be read is reported once,
//   by [player-pages]. Right after the player line, every run prints "landing pages: <n> (expected
//   <m>)" ("unknown" where the build output or a package could not be read); failures take the
//   [player-pages] forms with [landing-pages].
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DECISION_INPUTS,
  launchLogLine,
  resolveLaunch,
  type Env,
  type LaunchDecision,
} from '../src/config/launch'
import { APP_NAME } from '../src/core/app-info'
import { BuildInfo } from '../src/core/content/build-info'
import { parseStrictJson, type GateMode } from '../src/core/content/gates'
import {
  BUILD_INFO_FILE,
  CONTENT_DIR,
  PACKAGES_DIR,
  packageFileName,
  PUBLIC_BUILD_INFO_FILE,
  PUBLIC_DIR,
} from '../src/core/content/output-layout'
import {
  ENABLED_LOCALE_CODES,
  isEnabledLocale,
  isLocaleCode,
  LOCALE_CODES,
} from '../src/core/locales'
import { StoryPackageV1 } from '../src/core/package/v1'
import { LOCALE_REDIRECT_SCRIPT } from '../src/core/progress/locale-redirect-boot'
import { gateOptions } from '../src/reader/routing'
import {
  STAGING_BANNER_ATTRIBUTE,
  STAGING_BANNER_MARKER,
  STAGING_BANNER_TEXT,
} from '../src/ui/root/staging'
import { isEntryPoint, STAGING_REFUSED_HERE, stagingPointerAllowed } from './load-content'

/** The prerender manifest version Next 16.4.5 writes; an upgrade that changes it fails loudly (R18). */
export const MANIFEST_VERSION = 4

/** Shorter message values are too common to mean a leaked catalogue (design §5.7 item 2). */
export const MIN_LEAK_LENGTH = 16

/** The only robots meta a 200 page may carry (src/ui/root/metadata.ts ROOT_ROBOTS). */
export const ROBOTS_META = '<meta name="robots" content="noindex, nofollow"/>'

/** Today's "/" body markup while gated (app/(reader)/(gate)/page.tsx, ComingSoon). */
export const COMING_SOON_MAIN = `<main><h1>${APP_NAME}</h1><p>Coming soon.</p></main>`

/** Next's own 500 page: no robots meta and no banner (design p1-step7-design.md §5.7; P1-2c R8). */
const GLOBAL_ERROR_HTML = '_global-error.html'

/** The gate's own language; every other locale may appear on "/" only as an island (open builds). */
const GATE_LOCALE = 'en'

/** The redirect script's first call. The RSC payload repeats the script escaped; this finds it. */
const REDIRECT_MARKER = 'getEntriesByType('

const LOCALE_PATTERN = '/[locale]'

/** The story player's route (app/(reader)/[locale]/(player)/stories/[storyId]/read; P1-4b). */
export const PLAYER_PATTERN = '/[locale]/stories/[storyId]/read'

/** The story landing's route (app/(reader)/[locale]/(site)/stories/[storyId]; P1 Step 12). */
export const LANDING_PATTERN = '/[locale]/stories/[storyId]'

const REQUIRED_PATTERNS = {
  gated: [LOCALE_PATTERN],
  open: [LOCALE_PATTERN, '/[locale]/grown-ups'],
  /**
   * Also required when open and build-info lists at least one story (design p1-step10 §9.1 G1;
   * the landing from P1 Step 12, design p1-step12 §3.16).
   */
  openWithStories: [PLAYER_PATTERN, LANDING_PATTERN],
} as const

/** The four decision input names as a list: "A, B, C or D". */
const INPUT_NAMES = `${DECISION_INPUTS.slice(0, -1).join(', ')} or ${DECISION_INPUTS.at(-1)}`

/** next build loads .env* files and this tsx script does not (design §5.1, R21). */
export const ENV_FILE_QUESTION = `is ${INPUT_NAMES} set in a .env* file?`

/** The design §5.7 item 2 sentence, exactly. */
export const DISAGREEMENT_HINT = `build output disagrees with the launch decision; ${ENV_FILE_QUESTION}`

export type LaunchState = 'gated' | 'open'

export interface BuildOutput {
  /** .next/prerender-manifest.json as text; undefined when the file is missing. */
  readonly manifest: string | undefined
  /** Every prerendered page's .html, keyed by its posix path as under .next/server/app ("en/grown-ups.html"). */
  readonly html: ReadonlyMap<string, string>
  /** Every .js under .next/static, keyed by its posix path there ("chunks/x.js"). */
  readonly staticJs: ReadonlyMap<string, string>
}

export interface CatalogueValue {
  readonly locale: string
  readonly key: string
  readonly value: string
}

export interface CheckReport {
  /** "reader launch: gated (committed); locale routes: 0". */
  readonly launchLine: string
  /** "[rule] what failed", one per failed rule; empty when the build passes. */
  readonly failures: readonly string[]
}

interface Manifest {
  readonly routes: Readonly<Record<string, unknown>>
  readonly dynamicRoutes: Readonly<Record<string, unknown>>
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** "/en/grown-ups" → "en", "/[locale]" → "[locale]", "/" → "". */
const firstSegment = (route: string): string => route.split('/')[1] ?? ''

/** "en/grown-ups.html" → "en", "index.html" → "index". */
const firstHtmlSegment = (path: string): string => path.replace(/\.html$/, '').split('/')[0] ?? ''

/** Non-overlapping occurrences of `needle` in `text`. */
function count(text: string, needle: string): number {
  if (needle === '') return 0
  return text.split(needle).length - 1
}

/** Every UTF-16 code unit outside ASCII as \uXXXX (a JS string escape), in the given hex case. */
export function escapeNonAscii(value: string, upper: boolean): string {
  return value.replace(/[^\x00-\x7f]/g, (unit) => {
    const hex = unit.charCodeAt(0).toString(16).padStart(4, '0')
    return `\\u${upper ? hex.toUpperCase() : hex}`
  })
}

/** The forms a catalogue value can take in minified JS: raw, and escaped in either hex case. */
export function leakForms(value: string): string[] {
  return [...new Set([value, escapeNonAscii(value, false), escapeNonAscii(value, true)])]
}

function parseManifest(text: string): Manifest | string {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return 'prerender-manifest.json is not valid JSON'
  }
  if (!isRecord(value)) return 'prerender-manifest.json is not an object'
  if (value.version !== MANIFEST_VERSION) {
    return `prerender-manifest.json version is not ${MANIFEST_VERSION} (a Next upgrade? design R18)`
  }
  if (!isRecord(value.routes) || !isRecord(value.dynamicRoutes)) {
    return 'prerender-manifest.json has no routes or dynamicRoutes object'
  }
  return { routes: value.routes, dynamicRoutes: value.dynamicRoutes }
}

/** Robots metas of any content: React writes them as <meta name="robots" content="…"/>. */
const robotsMetas = (html: string): string[] => html.match(/<meta\s+name="robots"[^>]*>/g) ?? []

/**
 * The pure check. `catalogue` holds every message value of every catalogue; `content` is what
 * readBuiltContent read (it adds the player pattern to the open build's required patterns).
 */
export function checkBuild(
  output: BuildOutput,
  decision: LaunchDecision,
  catalogue: readonly CatalogueValue[],
  content: BuiltContent = NO_CONTENT,
): CheckReport {
  const failures: string[] = []
  const fail = (rule: string, message: string): void => {
    failures.push(`[${rule}] ${message}`)
  }
  const manifest = output.manifest === undefined ? undefined : parseManifest(output.manifest)
  const localeRoutes =
    manifest !== undefined && typeof manifest !== 'string'
      ? Object.keys(manifest.routes).filter((route) => isLocaleCode(firstSegment(route)))
      : undefined
  const launchLine = `${launchLogLine(decision)}; locale routes: ${localeRoutes?.length ?? 'unknown'}`
  const report = (): CheckReport => ({ launchLine, failures })

  if (decision.refused) {
    // next build stops on a refused decision, so reaching this means the two saw different inputs.
    fail(
      'launch',
      `reader launch refused: ${decision.reason}; next build should have stopped first: ${ENV_FILE_QUESTION}`,
    )
    return report()
  }
  if (output.manifest === undefined) fail('files', 'missing .next/prerender-manifest.json')
  else if (typeof manifest === 'string') fail('manifest', manifest)
  const index = output.html.get('index.html')
  if (index === undefined) fail('files', 'missing the prerendered index.html')
  if (manifest === undefined || typeof manifest === 'string' || index === undefined) return report()
  const routes = Object.keys(manifest.routes)

  // State agreement: the output alone decides what it is, then the decision must match it.
  const redirectRaw = count(index, LOCALE_REDIRECT_SCRIPT)
  const derived: LaunchState = (localeRoutes?.length ?? 0) > 0 || redirectRaw > 0 ? 'open' : 'gated'
  const expected: LaunchState = decision.readerRoutes ? 'open' : 'gated'
  if (derived !== expected) {
    fail(
      'state-agreement',
      `${DISAGREEMENT_HINT} (output: ${derived}, locale routes: ${localeRoutes?.length ?? 0}, ` +
        `redirect scripts: ${redirectRaw}; decision: ${expected})`,
    )
    return report()
  }

  // Both states.
  for (const route of ['/', '/_not-found']) {
    if (!(route in manifest.routes)) fail('routes', `routes has no ${route}`)
  }
  for (const [pattern, entry] of Object.entries(manifest.dynamicRoutes)) {
    if (firstSegment(pattern) !== '[locale]') continue
    const fallback = isRecord(entry) ? entry.fallback : undefined
    if (fallback !== false) {
      fail(
        'dynamic-routes',
        `${pattern} has fallback ${fallback === undefined ? 'missing' : JSON.stringify(fallback)}, not false ` +
          '(every /[locale]… segment needs dynamicParams = false)',
      )
    }
  }
  const required = [
    ...REQUIRED_PATTERNS[expected],
    ...(expected === 'open' && content.storyIds.length > 0
      ? REQUIRED_PATTERNS.openWithStories
      : []),
  ]
  for (const pattern of required) {
    if (!(pattern in manifest.dynamicRoutes)) {
      fail('dynamic-routes', `dynamicRoutes has no ${pattern} entry (design R23)`)
    }
  }

  if (expected === 'gated') {
    if (!index.includes(COMING_SOON_MAIN)) {
      fail('coming-soon', `index.html does not hold ${COMING_SOON_MAIN}`)
    }
    if (count(index, REDIRECT_MARKER) > 0) {
      fail('redirect-script', 'index.html holds the redirect script (escaped)')
    }
    for (const code of LOCALE_CODES) {
      if (index.includes(`href="/${code}`)) fail('gate', `index.html links to /${code}`)
      if (code !== GATE_LOCALE && index.includes(`lang="${code}"`)) {
        fail('gate', `index.html holds lang="${code}"`)
      }
    }
  } else {
    for (const code of ENABLED_LOCALE_CODES) {
      if (!routes.includes(`/${code}`)) fail('routes', `routes has no /${code}`)
    }
    for (const route of routes) {
      const first = firstSegment(route)
      if (isLocaleCode(first) && !isEnabledLocale(first)) {
        fail('routes', `routes has ${route}, under the disabled locale ${first}`)
      }
    }
    for (const option of gateOptions()) {
      if (!index.includes(`href="${option.href}"`)) {
        fail('gate', `index.html has no gate link to ${option.href}`)
      }
    }
    const elements = count(index, `<script>${LOCALE_REDIRECT_SCRIPT}</script>`)
    if (elements !== 1 || redirectRaw !== 1) {
      fail(
        'redirect-script',
        `index.html must hold the redirect script exactly once as a <script> element ` +
          `(found ${elements} elements, ${redirectRaw} copies)`,
      )
    }
    for (const code of ENABLED_LOCALE_CODES) {
      if (!output.html.has(`${code}.html`)) fail('html-lang', `missing ${code}.html`)
    }
    for (const [path, html] of output.html) {
      const code = firstHtmlSegment(path)
      if (isEnabledLocale(code) && !html.includes(`<html lang="${code}"`)) {
        fail('html-lang', `${path} has no <html lang="${code}"`)
      }
    }
  }

  // Robots, in every build (spec §10.3): noindex is never tied to the launch flag.
  if (!output.html.has('_not-found.html')) fail('files', 'missing the prerendered _not-found.html')
  for (const [path, html] of output.html) {
    if (path === GLOBAL_ERROR_HTML) continue // Next's own 500 page carries none (design §5.7)
    const metas = robotsMetas(html)
    if (path === '_not-found.html') {
      if (metas.length === 0 || metas.some((meta) => !meta.includes('noindex'))) {
        fail('robots', `${path}: every robots meta must hold noindex (found ${metas.length})`)
      }
    } else if (metas.length !== 1 || metas[0] !== ROBOTS_META) {
      fail(
        'robots',
        `${path}: expected exactly one noindex, nofollow robots meta (found ${metas.length} robots metas, ${count(html, ROBOTS_META)} noindex, nofollow)`,
      )
    }
  }

  // No catalogue in client JS (design §6.1: strings are resolved on the server).
  const long = catalogue.filter(({ value }) => value.length >= MIN_LEAK_LENGTH)
  if (long.length === 0) fail('catalogue', 'no message value to scan for')
  if (output.staticJs.size === 0) fail('catalogue-leak', 'no .js file under .next/static to scan')
  for (const [path, js] of output.staticJs) {
    for (const { locale, key, value } of long) {
      const forms = leakForms(value)
      const found = forms.findIndex((form) => js.includes(form))
      if (found !== -1) {
        fail(
          'catalogue-leak',
          `.next/static/${path} holds ${locale} ${key}${found === 0 ? '' : ' (\\u-escaped)'}`,
        )
      }
    }
  }
  return report()
}

const toPosix = (path: string): string => path.split(sep).join('/')

/** Every file under `dir` whose name ends with `suffix`, as posix path (relative to dir) → text. */
function readTree(dir: string, suffix: string): Map<string, string> {
  const found = new Map<string, string>()
  const visit = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith(suffix)) {
        found.set(toPosix(relative(dir, path)), readFileSync(path, 'utf8'))
      }
    }
  }
  if (existsSync(dir)) visit(dir)
  return new Map([...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/**
 * The prerendered App Router HTML, keyed as under .next/server/app ("index.html", "en.html",
 * "en/grown-ups.html"), from either layout Next 16.4.5 writes:
 * - no adapter (local, CI): .next/server/app/<path>.html;
 * - with a deployment adapter (NEXT_ADAPTER_PATH; Vercel sets it, its log says "Running
 *   onBuildComplete from Vercel"): .next/server/route-cache/APP_PAGE/<sha256 of the source
 *   route>/$/<path>.html (next/dist/server/lib/route-cache-key.js getRouteCacheKey).
 * Two different files for one page (both layouts, or two source routes) throw, so the check
 * reports it; a byte-identical copy (next start writes served pages into route-cache) is one page.
 */
export function readPrerenderedHtml(next: string): Map<string, string> {
  const found = new Map<string, string>()
  const add = (key: string, html: string, from: string): void => {
    const earlier = found.get(key)
    // `next start` also writes served pages into route-cache, so a byte-identical second copy is
    // the same page; two different files for one page fail.
    if (earlier !== undefined && earlier !== html) {
      throw new Error(`two different prerendered files for ${key} (${from})`)
    }
    found.set(key, html)
  }
  for (const [path, html] of readTree(join(next, 'server', 'app'), '.html')) {
    add(path, html, 'server/app')
  }
  const routeCache = join(next, 'server', 'route-cache', 'APP_PAGE')
  if (existsSync(routeCache)) {
    for (const entry of readdirSync(routeCache, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      for (const [path, html] of readTree(join(routeCache, entry.name, '$'), '.html')) {
        add(path, html, 'server/route-cache')
      }
    }
  }
  return new Map([...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Reads the build output under <root>/.next; missing files are left for the check to report. */
export function readBuildOutput(root: string): BuildOutput {
  const next = join(root, '.next')
  const manifestPath = join(next, 'prerender-manifest.json')
  return {
    manifest: existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : undefined,
    html: readPrerenderedHtml(next),
    staticJs: readTree(join(next, 'static'), '.js'),
  }
}

/**
 * Every value of every catalogue in <root>/messages, read as text (the catalogues are imported only
 * by src/ui/i18n/messages.ts, which is server-only). Throws when a file is not a flat string map.
 */
export function readCatalogues(root: string): CatalogueValue[] {
  const dir = join(root, 'messages')
  if (!existsSync(dir)) throw new Error('messages/ is missing')
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
  if (files.length === 0) throw new Error('no catalogue in messages/')
  return files.flatMap((name) => {
    const value: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    if (!isRecord(value) || Object.values(value).some((v) => typeof v !== 'string')) {
      throw new Error(`messages/${name} is not a flat object of strings`)
    }
    const locale = name.replace(/\.json$/, '')
    return Object.entries(value).map(([key, text]) => ({ locale, key, value: String(text) }))
  })
}

/** What [content-outputs] reads from the storyboard folder. */
export interface ContentOutputs {
  /** Something exists at .content/. */
  readonly contentDir: boolean
  /** .content/build-info.json; null when missing or not a file. */
  readonly contentBuildInfo: Uint8Array | null
  /** Something exists at public/build-info.json. */
  readonly publicBuildInfoExists: boolean
  /** public/build-info.json; null when missing or not a file. */
  readonly publicBuildInfo: Uint8Array | null
}

/** The build-info modes each loading CONTENT_SOURCE may produce. */
const CONTENT_MODES: Readonly<Record<'fixtures' | 'storage', readonly string[]>> = {
  fixtures: ['fixtures'],
  storage: ['production', 'staging'],
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

/** A build-info copy, strictly parsed; the failure names what is wrong, never a value. */
function parseBuildInfo(bytes: Uint8Array): BuildInfo | 'not-json' | 'not-strict' {
  let parsed: ReturnType<typeof BuildInfo.safeParse>
  try {
    parsed = BuildInfo.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return 'not-json'
  }
  return parsed.success ? parsed.data : 'not-strict'
}

/**
 * Rule [content-outputs] (C-2, design p1-step8-design.md §3.3). `contentSource` is this process's
 * CONTENT_SOURCE; an empty value counts as unset, as in the loader. Messages name enums and file
 * names only, never a value.
 */
export function checkContentOutputs(
  contentSource: string | undefined,
  outputs: ContentOutputs,
): string[] {
  const failures: string[] = []
  const fail = (message: string): void => {
    failures.push(`[content-outputs] ${message}`)
  }
  const source = contentSource ?? ''
  if (source === '' || source === 'none') {
    const name = contentSource === undefined ? 'unset' : source === '' ? 'empty' : 'none'
    if (outputs.contentDir) fail(`.content/ exists, but CONTENT_SOURCE is ${name}`)
    if (outputs.publicBuildInfoExists) {
      fail(`public/build-info.json exists, but CONTENT_SOURCE is ${name}`)
    }
    return failures
  }
  if (source !== 'fixtures' && source !== 'storage') {
    fail('CONTENT_SOURCE is not storage, fixtures or none')
    return failures
  }
  const { contentBuildInfo, publicBuildInfo } = outputs
  if (contentBuildInfo === null) fail(`missing .content/build-info.json (CONTENT_SOURCE=${source})`)
  if (publicBuildInfo === null) fail(`missing public/build-info.json (CONTENT_SOURCE=${source})`)
  if (contentBuildInfo === null || publicBuildInfo === null) return failures
  if (!bytesEqual(contentBuildInfo, publicBuildInfo)) {
    fail('.content/build-info.json and public/build-info.json differ')
    return failures
  }
  const parsed = parseBuildInfo(contentBuildInfo)
  if (parsed === 'not-json') {
    fail('.content/build-info.json is not valid JSON')
    return failures
  }
  if (parsed === 'not-strict') {
    fail('.content/build-info.json failed strict parse')
    return failures
  }
  const expected = CONTENT_MODES[source]
  if (!expected.includes(parsed.mode)) {
    fail(
      `build-info mode is ${parsed.mode}, but CONTENT_SOURCE=${source} needs ${expected.join(' or ')}`,
    )
  }
  return failures
}

/**
 * The content mode of a build (P1-2c): what the loader wrote to .content/build-info.json, which is
 * what the pages read through contentMode(). null when there is no such file (no content was
 * loaded), 'invalid' when it is not a valid build-info ([content-outputs] fails that build).
 */
export type ContentMode = GateMode | 'invalid' | null

/** Reads the mode from the bytes of .content/build-info.json, or null when the file is missing. */
export function readContentMode(bytes: Uint8Array | null): ContentMode {
  if (bytes === null) return null
  const parsed = parseBuildInfo(bytes)
  return typeof parsed === 'string' ? 'invalid' : parsed.mode
}

/** The pages [staging-banner] counts, and how many of them hold the banner marker. */
export interface StagingBannerCounts {
  readonly pages: number
  readonly withBanner: number
}

export interface StagingBannerReport extends StagingBannerCounts {
  /** "[staging-banner] what failed", naming files, rules and counts only; empty when it holds. */
  readonly failures: readonly string[]
}

/** The banner element: a <p> holding only text (design §4.5). */
const BANNER_ELEMENT = new RegExp(`<p\\b[^>]*\\s${STAGING_BANNER_MARKER}[^>]*>([^<]*)</p>`, 'g')

/** Each banner element must come before the first of these (design §3.6 row 12). */
const BANNER_BEFORE = ['<main', '<header', '<a '] as const

/**
 * Rule [staging-banner] (design p1-step9-design.md §3.6 rows 12-15, §4.5; P1-2c). `mode` comes
 * from readContentMode; `env` and `platform` are this process's, for the second lock, which is the
 * loader's own stagingPointerAllowed. Messages name files, rules and counts, never a value.
 */
export function checkStagingBanner(
  output: BuildOutput,
  mode: ContentMode,
  env: Env,
  platform: string,
): StagingBannerReport {
  const failures: string[] = []
  const fail = (message: string): void => {
    failures.push(`[staging-banner] ${message}`)
  }
  const pages = [...output.html].filter(([path]) => path !== GLOBAL_ERROR_HTML)
  const withBanner = pages.filter(([, html]) => html.includes(STAGING_BANNER_MARKER)).length
  const textForms = leakForms(STAGING_BANNER_TEXT)
  /** " (\u-escaped)" when the text was found only escaped, as [catalogue-leak] says it. */
  const textFound = (text: string): string | null => {
    const found = textForms.findIndex((form) => text.includes(form))
    return found === -1 ? null : found === 0 ? '' : ' (\\u-escaped)'
  }

  if (mode === 'staging') {
    if (!stagingPointerAllowed(env, platform)) {
      fail(`content mode is staging, but ${STAGING_REFUSED_HERE}`)
    }
    for (const [path, html] of pages) {
      const markers = count(html, STAGING_BANNER_MARKER)
      if (markers !== 1) {
        fail(`${path}: expected exactly one banner (found ${markers} ${STAGING_BANNER_MARKER})`)
        continue
      }
      const elements = [...html.matchAll(BANNER_ELEMENT)]
      const element = elements[0]
      if (elements.length !== 1 || element === undefined) {
        fail(
          `${path}: the banner is not a <p> element holding only text (found ${elements.length} such elements)`,
        )
        continue
      }
      const openTag = element[0].slice(0, element[0].indexOf('>') + 1)
      if (!/\slang="en"[\s/>]/.test(openTag)) fail(`${path}: the banner has no lang="en"`)
      if (element[1] !== STAGING_BANNER_TEXT) {
        fail(`${path}: the banner text is not STAGING_BANNER_TEXT (src/ui/root/staging.ts)`)
      }
      const at = html.indexOf(STAGING_BANNER_MARKER)
      for (const tag of BANNER_BEFORE) {
        const first = html.indexOf(tag)
        if (first !== -1 && first < at) {
          fail(`${path}: the banner comes after the first ${tag.trim()}`)
        }
      }
    }
  } else {
    const name = mode ?? 'none'
    for (const [path, html] of pages) {
      const attributes = count(html, STAGING_BANNER_ATTRIBUTE)
      if (attributes > 0) {
        fail(
          `${path}: holds ${STAGING_BANNER_ATTRIBUTE} ${attributes} time(s), but content mode is ${name} (only a staging build has the banner)`,
        )
      }
      const text = textFound(html)
      if (text !== null) {
        fail(`${path}: holds the banner text${text}, but content mode is ${name}`)
      }
    }
  }

  // No build sends the banner in client JS: the component is a Server Component (design §4.2).
  for (const [path, js] of output.staticJs) {
    const text = textFound(js)
    if (text !== null) fail(`.next/static/${path} holds the banner text${text}`)
    if (js.includes(STAGING_BANNER_ATTRIBUTE)) {
      fail(`.next/static/${path} holds ${STAGING_BANNER_ATTRIBUTE}`)
    }
  }
  return { failures, pages: pages.length, withBanner }
}

/**
 * The value-free summary line (design §3.6 row 13, §4.5): enums and counts only. `counts` is null
 * when the build output could not be read (the [read] failure says why).
 */
export function contentModeLine(mode: ContentMode, counts: StagingBannerCounts | null): string {
  const pages = counts === null ? 'unknown' : `${counts.withBanner} of ${counts.pages}`
  return `content mode: ${mode ?? 'none'}; staging banner pages: ${pages}`
}

/** Reads the loader's outputs under <root> (output-layout.ts names), for [content-outputs]. */
export function readContentOutputs(root: string): ContentOutputs {
  const file = (path: string): Uint8Array | null => {
    try {
      return new Uint8Array(readFileSync(path))
    } catch {
      return null // missing, or a folder
    }
  }
  const publicPath = join(root, PUBLIC_DIR, PUBLIC_BUILD_INFO_FILE)
  return {
    contentDir: existsSync(join(root, CONTENT_DIR)),
    contentBuildInfo: file(join(root, CONTENT_DIR, BUILD_INFO_FILE)),
    publicBuildInfoExists: existsSync(publicPath),
    publicBuildInfo: file(publicPath),
  }
}

// ---- [player-pages] and [package-text-leak] (design p1-step10-design.md §9.1 G1, G2; P1-4b) ----

/** What [player-pages] and [package-text-leak] read from .content. */
export interface BuiltContent {
  /** build-info's story ids, in its order; [] when no content was loaded. */
  readonly storyIds: readonly string[]
  /** The package of each listed story that could be read and strictly parsed, in build-info order. */
  readonly packages: readonly StoryPackageV1[]
  /** One line per listed package that could not be read: file names only, never a value. */
  readonly problems: readonly string[]
}

/** No content loaded (no build-info, or one that is not strictly valid). */
export const NO_CONTENT: BuiltContent = { storyIds: [], packages: [], problems: [] }

/**
 * The packages a build was made from: for each story `buildInfo` (the bytes of
 * .content/build-info.json) lists, <root>/.content/packages/<id>.json parsed with the strict
 * StoryPackageV1, as the reader parses it (src/content/reader.ts). Never throws.
 */
export function readBuiltContent(root: string, buildInfo: Uint8Array | null): BuiltContent {
  const info = buildInfo === null ? 'not-json' : parseBuildInfo(buildInfo)
  if (typeof info === 'string') return NO_CONTENT // not loaded; [content-outputs] names a bad file
  const packages: StoryPackageV1[] = []
  const problems: string[] = []
  for (const { storyId } of info.stories) {
    const name = `${CONTENT_DIR}/${PACKAGES_DIR}/${packageFileName(storyId)}`
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(
        readFileSync(join(root, CONTENT_DIR, PACKAGES_DIR, packageFileName(storyId))),
      )
    } catch {
      problems.push(`${name} is missing`)
      continue
    }
    const parsed = parseStrictJson(bytes, StoryPackageV1, `package ${storyId}`)
    if (!parsed.ok) problems.push(`${name} failed strict parse`)
    else if (parsed.value.data.storyId !== storyId) problems.push(`${name} names another storyId`)
    else packages.push(parsed.value.data)
  }
  return { storyIds: info.stories.map((story) => story.storyId), packages, problems }
}

/** A player page as BuildOutput.html keys it: <locale>/stories/<storyId>/read.html. */
const PLAYER_PAGE = /^([^/]+)\/stories\/([^/]+)\/read\.html$/

/** A landing page as BuildOutput.html keys it: <locale>/stories/<storyId>.html (P1 Step 12). */
const LANDING_PAGE = /^([^/]+)\/stories\/([^/]+)\.html$/

/** One kind of per-story page: its rule name, how its path is read and how it is written. */
interface StoryPageKind {
  readonly rule: 'player-pages' | 'landing-pages'
  /** Captures the locale and the storyId. */
  readonly page: RegExp
  readonly path: (code: string, storyId: string) => string
  /** Whether this rule reports the packages that could not be read (one rule does). */
  readonly reportsProblems: boolean
}

const PLAYER_PAGES: StoryPageKind = {
  rule: 'player-pages',
  page: PLAYER_PAGE,
  path: (code, storyId) => `${code}/stories/${storyId}/read.html`,
  reportsProblems: true,
}

const LANDING_PAGES: StoryPageKind = {
  rule: 'landing-pages',
  page: LANDING_PAGE,
  path: (code, storyId) => `${code}/stories/${storyId}.html`,
  reportsProblems: false,
}

/**
 * A <main> element with id="main", its attributes in any order: React writes them in JSX prop
 * order, so a literal `<main id="main"` would miss `<main class="…" id="main">` (C8).
 */
const MAIN_ELEMENT = /<main\b[^>]*\sid="main"[\s>]/g
/**
 * Any <main> element, with or without an id, or any other element with role="main": a page has
 * one main landmark only (F1; review R2-G1-7). A <main role="main"> counts once: the scan resumes
 * after its `<main `. React escapes quotes and `<` in text and attribute values.
 */
const ANY_MAIN = /<main[\s>]|<[a-z][^>]*\srole="main"[\s/>]/g

/**
 * The pages of one kind a build must have, path → locale: open, one per listed story and per
 * enabled locale of its package; gated, none. null when a listed package could not be read.
 */
function expectedStoryPages(
  kind: StoryPageKind,
  decision: LaunchDecision,
  content: BuiltContent,
): Map<string, string> | null {
  if (content.problems.length > 0) return null
  const expected = new Map<string, string>()
  if (!decision.readerRoutes) return expected
  for (const pkg of content.packages) {
    for (const code of ENABLED_LOCALE_CODES) {
      if (pkg.locales.includes(code)) expected.set(kind.path(code, pkg.storyId), code)
    }
  }
  return expected
}

export interface PlayerPagesReport {
  /** "[player-pages] what failed", naming files and ids only; empty when it holds. */
  readonly failures: readonly string[]
  /** The player pages in the output. */
  readonly pages: number
  /** The player pages the launch and content call for; null when a package could not be read. */
  readonly expected: number | null
}

/** What [landing-pages] found: the [player-pages] report's shape (P1 Step 12). */
export type LandingPagesReport = PlayerPagesReport

/** Rule [player-pages] (design p1-step10-design.md §9.1 G1). */
export function checkPlayerPages(
  output: BuildOutput,
  decision: LaunchDecision,
  content: BuiltContent,
): PlayerPagesReport {
  return checkStoryPages(PLAYER_PAGES, output, decision, content)
}

/** Rule [landing-pages] (design p1-step12-design.md §3.16 N17, A18): the player rule's twin. */
export function checkLandingPages(
  output: BuildOutput,
  decision: LaunchDecision,
  content: BuiltContent,
): LandingPagesReport {
  return checkStoryPages(LANDING_PAGES, output, decision, content)
}

/** The shared per-story page rule: [player-pages] and [landing-pages]. */
function checkStoryPages(
  kind: StoryPageKind,
  output: BuildOutput,
  decision: LaunchDecision,
  content: BuiltContent,
): PlayerPagesReport {
  const failures = kind.reportsProblems
    ? content.problems.map((problem) => `[${kind.rule}] ${problem}`)
    : []
  const fail = (message: string): void => {
    failures.push(`[${kind.rule}] ${message}`)
  }
  const expected = expectedStoryPages(kind, decision, content)
  const listed = new Set(content.storyIds)
  const packages = new Map(content.packages.map((pkg) => [pkg.storyId, pkg]))
  /** A page that is not in the expected set, in the §8 form, with why it is not; ids only. */
  const unexpected = (path: string, code: string, storyId: string): string => {
    if (!decision.readerRoutes) return `gated build has ${path}`
    const why = !isEnabledLocale(code)
      ? `${code} is not an enabled locale`
      : !listed.has(storyId)
        ? `build-info lists no story ${storyId}`
        : packages.has(storyId)
          ? `package ${storyId} has no ${code} text`
          : `package ${storyId} could not be read`
    return `unexpected ${path} (${why})`
  }
  const pages = [...output.html].filter(([path]) => kind.page.test(path))
  for (const [path, html] of pages) {
    const [, code = '', storyId = ''] = kind.page.exec(path) ?? []
    if (expected !== null && !expected.has(path)) fail(unexpected(path, code, storyId))
    const mains = html.match(MAIN_ELEMENT)?.length ?? 0
    const anyMains = html.match(ANY_MAIN)?.length ?? 0
    if (mains !== 1) fail(`${path}: <main id="main" ${mains} time(s)`)
    else if (anyMains !== 1) fail(`${path}: <main ${anyMains} time(s)`)
    if (!html.includes(`<html lang="${code}"`)) fail(`${path}: <html lang> is not ${code}`)
  }
  for (const path of expected?.keys() ?? []) {
    if (!output.html.has(path)) fail(`missing ${path}`)
  }
  return { failures, pages: pages.length, expected: expected?.size ?? null }
}

/** One line of a package text value, with ids that name where it came from. */
export interface PackageTextValue {
  readonly storyId: string
  readonly locale: string
  /** "title", "alt.<assetId>", "nodes.<nodeId>.text", "nodes.<nodeId>.choices.<choiceId>", … */
  readonly field: string
  readonly line: string
}

/**
 * Every line (split on "\n") of MIN_LEAK_LENGTH or more UTF-16 code units of every text value of
 * `pkg`, in every locale it has: title, description, theme, duration, book, alt values, and each
 * node's text, question, choice labels and lesson.
 */
export function packageTextValues(pkg: StoryPackageV1): PackageTextValue[] {
  const values: PackageTextValue[] = []
  const add = (locale: string, field: string, text: string | undefined): void => {
    for (const line of text?.split('\n') ?? []) {
      if (line.length >= MIN_LEAK_LENGTH) values.push({ storyId: pkg.storyId, locale, field, line })
    }
  }
  for (const [locale, text] of Object.entries(pkg.text)) {
    if (text === undefined) continue
    add(locale, 'title', text.title)
    add(locale, 'description', text.description)
    add(locale, 'theme', text.theme)
    add(locale, 'duration', text.duration)
    add(locale, 'book', text.book)
    for (const [assetId, alt] of Object.entries(text.alt ?? {})) add(locale, `alt.${assetId}`, alt)
    for (const [nodeId, node] of Object.entries(text.nodes)) {
      add(locale, `nodes.${nodeId}.text`, node.text)
      add(locale, `nodes.${nodeId}.question`, node.question)
      for (const [choiceId, label] of Object.entries(node.choices ?? {})) {
        add(locale, `nodes.${nodeId}.choices.${choiceId}`, label)
      }
      add(locale, `nodes.${nodeId}.lesson`, node.lesson)
    }
  }
  return values
}

/**
 * The forms a package text line can take in minified JS (design §9.1 G2), each with the note a
 * failure carries: the line; the JSON-escaped line; the line with every ' written \' (a
 * single-quoted string: package text, unlike messages, may hold ASCII apostrophes); the line with
 * every </ written <\/; and the two crossings of these a minifier can write (the JSON-escaped line
 * with every </ written <\/, and the \' line with every </ written <\/). Each also \u-escaped in
 * both hex cases (leakForms), so an ASCII-only single-quoted string is found too.
 */
export function packageTextForms(line: string): (readonly [form: string, note: string])[] {
  const json = JSON.stringify(line).slice(1, -1)
  const quoted = line.replace(/'/g, "\\'")
  const slash = (text: string): string => text.replace(/<\//g, '<\\/')
  const bases: readonly (readonly [string, string])[] = [
    [line, ''],
    [json, 'JSON-escaped'],
    [quoted, "with \\'"],
    [slash(line), 'with <\\/'],
    [slash(json), 'JSON-escaped with <\\/'],
    [slash(quoted), "with \\' and <\\/"],
  ]
  const note = (base: string, escaped: boolean): string => {
    if (!escaped) return base === '' ? '' : ` (${base})`
    if (base === '') return ' (\\u-escaped)'
    return base === 'JSON-escaped' ? ' (JSON- and \\u-escaped)' : ` (${base}, \\u-escaped)`
  }
  const all = bases.flatMap(([text, base]) =>
    leakForms(text).map((form, i) => [form, note(base, i > 0)] as const),
  )
  const seen = new Set<string>()
  return all.filter(([form]) => {
    if (seen.has(form)) return false
    seen.add(form)
    return true
  })
}

export interface PackageTextLeakReport {
  /** "[package-text-leak] what failed", naming files and ids only; empty when it holds. */
  readonly failures: readonly string[]
  /** The package text values (lines) scanned for. */
  readonly values: number
}

/** Rule [package-text-leak] (C-3; design p1-step10-design.md §9.1 G2): every .next/static JS file. */
export function checkPackageTextLeak(
  output: BuildOutput,
  content: BuiltContent,
): PackageTextLeakReport {
  const failures = new Set<string>()
  const values = content.packages.flatMap(packageTextValues)
  // "Content is loaded" for this rule: build-info lists at least one story (an empty catalogue is
  // valid, so 0 values with 0 stories passes; C9).
  if (content.storyIds.length > 0 && values.length === 0) {
    failures.add('[package-text-leak] content is loaded but 0 values were scanned')
  }
  for (const { storyId, locale, field, line } of values) {
    const forms = packageTextForms(line)
    const [node, name] = nodeAndField(field)
    for (const [path, js] of output.staticJs) {
      const found = forms.find(([form]) => js.includes(form))
      if (found !== undefined) {
        failures.add(
          `[package-text-leak] .next/static/${path}: storyId ${storyId} locale ${locale} node ${node} field ${name}${found[1]}`,
        )
      }
    }
  }
  return { failures: [...failures], values: values.length }
}

/** A value's field as design §8 names it: "nodes.<id>.<f>" is node <id> field <f>; else node -. */
function nodeAndField(field: string): readonly [node: string, field: string] {
  const match = /^nodes\.([^.]+)\.(.+)$/.exec(field)
  return match === null ? ['-', field] : [match[1] ?? '-', match[2] ?? field]
}

/** The one value-free landing line every run prints after the player line (P1 Step 12, §3.16). */
export function landingLine(pages: number | null, expected: number | null): string {
  return `landing pages: ${pages ?? 'unknown'} (expected ${expected ?? 'unknown'})`
}

/** The one value-free player line every run prints (design p1-step10-design.md §8, §10.1 item 5). */
export function playerLine(
  pages: number | null,
  expected: number | null,
  values: number | null,
): string {
  return (
    `player pages: ${pages ?? 'unknown'} (expected ${expected ?? 'unknown'}); ` +
    `package text values scanned: ${values ?? 'unknown'}`
  )
}

export interface CheckBuildOptions {
  readonly root: string
  readonly env: Env
  /** process.platform unless a test passes another; read by the [staging-banner] second lock. */
  readonly platform?: string
  readonly log?: (line: string) => void
  readonly logError?: (line: string) => void
}

/** What [staging-banner] reads when the build output itself could not be read. */
const NO_OUTPUT: BuildOutput = { manifest: undefined, html: new Map(), staticJs: new Map() }

/** Returns the process exit code: 0 when every rule holds, else 1. Never throws. */
export function runCheckBuild(options: CheckBuildOptions): number {
  const log = options.log ?? ((line: string) => console.log(line))
  const logError = options.logError ?? ((line: string) => console.error(line))
  const platform = options.platform ?? process.platform
  const decision = resolveLaunch(options.env)
  // C-2 runs whatever the build output gives, so a gated build always proves its content outputs.
  // It reads first: the player rules need the packages build-info names (P1-4b).
  let contentFailures: string[]
  let mode: ContentMode
  let content: BuiltContent = NO_CONTENT
  try {
    const outputs = readContentOutputs(options.root)
    contentFailures = checkContentOutputs(options.env.CONTENT_SOURCE, outputs)
    mode = readContentMode(outputs.contentBuildInfo)
    content = readBuiltContent(options.root, outputs.contentBuildInfo)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown'
    contentFailures = [`[content-outputs] unreadable: ${reason}`]
    mode = 'invalid' // unreadable: no banner is allowed, and the build already fails
  }
  let result: CheckReport
  let output: BuildOutput | undefined
  try {
    let catalogue: CatalogueValue[] = []
    let catalogueError: string | undefined
    try {
      catalogue = readCatalogues(options.root)
    } catch (error) {
      catalogueError = error instanceof Error ? error.message : 'unreadable'
    }
    output = readBuildOutput(options.root)
    const report = checkBuild(output, decision, catalogue, content)
    result = catalogueError
      ? { ...report, failures: [`[catalogue] ${catalogueError}`, ...report.failures] }
      : report
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown'
    result = { launchLine: launchLogLine(decision), failures: [`[read] ${reason}`] }
  }
  // [staging-banner] beside C-2 (P1-2c). Without a readable output its second lock still runs.
  const banner = checkStagingBanner(output ?? NO_OUTPUT, mode, options.env, platform)
  // [player-pages], [landing-pages] (P1 Step 12) and [package-text-leak] (P1-4b) need the output;
  // without it the [read] failure already fails the build, and only the package problems are added.
  const player = output === undefined ? undefined : checkPlayerPages(output, decision, content)
  const landing = output === undefined ? undefined : checkLandingPages(output, decision, content)
  const leak = output === undefined ? undefined : checkPackageTextLeak(output, content)
  result = {
    ...result,
    failures: [
      ...result.failures,
      ...contentFailures,
      ...banner.failures,
      ...(player?.failures ?? content.problems.map((problem) => `[player-pages] ${problem}`)),
      ...(landing?.failures ?? []),
      ...(leak?.failures ?? []),
    ],
  }
  log(result.launchLine)
  log(contentModeLine(mode, output === undefined ? null : banner))
  log(
    playerLine(
      player?.pages ?? null,
      player === undefined
        ? (expectedStoryPages(PLAYER_PAGES, decision, content)?.size ?? null)
        : player.expected,
      leak?.values ?? null,
    ),
  )
  log(
    landingLine(
      landing?.pages ?? null,
      landing === undefined
        ? (expectedStoryPages(LANDING_PAGES, decision, content)?.size ?? null)
        : landing.expected,
    ),
  )
  if (result.failures.length === 0) {
    log('check-build: ok')
    return 0
  }
  for (const failure of result.failures) logError(`check-build failed ${failure}`)
  return 1
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  process.exit(runCheckBuild({ root, env: process.env }))
}
