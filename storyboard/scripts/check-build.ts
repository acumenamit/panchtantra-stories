// Post-build check (P1 D4; design p1-step7-design.md §5.7 item 2, §8.1 item 11; P1-1c). `pnpm build`
// runs it right after `next build`, so it also runs inside Vercel's build: exit 1 fails the build
// and Vercel keeps the last good deployment (spec §3.2). It reads .next/prerender-manifest.json,
// the prerendered HTML under .next/server/app and the client JS under .next/static:
// - State agreement first: the launch state is derived from the output alone (locale pages and
//   the gate's redirect script present, or absent) and compared with the decision recomputed from
//   this process's environment. next build loads .env* files and this tsx script does not, so a
//   decision input set in one of them shows up here as a disagreement and stops the build.
// - Gated: no locale page, a /[locale] pattern entry with fallback false, "/" exactly the
//   Coming-soon markup with no redirect script, no locale link and no Hindi island.
// - Open: a page for every enabled locale and none for a disabled one, both gate links and the
//   redirect script exactly once on "/", <html lang> per locale page. Deliberately loose about
//   deeper routes, so later steps need not edit it.
// - Both: "/" and /_not-found are built; every /[locale]… pattern has fallback false (with
//   dynamicParams = false every unlisted param is a 404); noindex, nofollow exactly once on every
//   200 page and noindex on the 404; no message value of 16 or more UTF-16 code units in client JS,
//   raw or \uXXXX-escaped in either hex case (a minifier may escape Devanagari and ’).
// - A missing file is a failure, never a skip. It prints the launch line once (the only place it
//   is printed: next.config is loaded by several build workers), then each failed rule by name.
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
import {
  ENABLED_LOCALE_CODES,
  isEnabledLocale,
  isLocaleCode,
  LOCALE_CODES,
} from '../src/core/locales'
import { LOCALE_REDIRECT_SCRIPT } from '../src/core/progress/locale-redirect-boot'
import { gateOptions } from '../src/reader/routing'
import { isEntryPoint } from './load-content'

/** The prerender manifest version Next 16.4.5 writes; an upgrade that changes it fails loudly (R18). */
export const MANIFEST_VERSION = 4

/** Shorter message values are too common to mean a leaked catalogue (design §5.7 item 2). */
export const MIN_LEAK_LENGTH = 16

/** The only robots meta a 200 page may carry (src/ui/root/metadata.ts ROOT_ROBOTS). */
export const ROBOTS_META = '<meta name="robots" content="noindex, nofollow"/>'

/** Today's "/" body markup while gated (app/(reader)/(gate)/page.tsx, ComingSoon). */
export const COMING_SOON_MAIN = `<main><h1>${APP_NAME}</h1><p>Coming soon.</p></main>`

/** The gate's own language; every other locale may appear on "/" only as an island (open builds). */
const GATE_LOCALE = 'en'

/** The redirect script's first call. The RSC payload repeats the script escaped; this finds it. */
const REDIRECT_MARKER = 'getEntriesByType('

const LOCALE_PATTERN = '/[locale]'
const REQUIRED_PATTERNS = {
  gated: [LOCALE_PATTERN],
  open: [LOCALE_PATTERN, '/[locale]/grown-ups'],
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
  /** Every .html under .next/server/app, keyed by its posix path there ("en/grown-ups.html"). */
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

/** The pure check. `catalogue` holds every message value of every catalogue. */
export function checkBuild(
  output: BuildOutput,
  decision: LaunchDecision,
  catalogue: readonly CatalogueValue[],
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
  if (index === undefined) fail('files', 'missing .next/server/app/index.html')
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
  for (const pattern of REQUIRED_PATTERNS[expected]) {
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
  if (!output.html.has('_not-found.html')) fail('files', 'missing .next/server/app/_not-found.html')
  for (const [path, html] of output.html) {
    if (path === '_global-error.html') continue // Next's own 500 page carries none (design §5.7)
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

/** Reads the build output under <root>/.next; missing files are left for the check to report. */
export function readBuildOutput(root: string): BuildOutput {
  const next = join(root, '.next')
  const manifestPath = join(next, 'prerender-manifest.json')
  return {
    manifest: existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : undefined,
    html: readTree(join(next, 'server', 'app'), '.html'),
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

export interface CheckBuildOptions {
  readonly root: string
  readonly env: Env
  readonly log?: (line: string) => void
  readonly logError?: (line: string) => void
}

/** Returns the process exit code: 0 when every rule holds, else 1. Never throws. */
export function runCheckBuild(options: CheckBuildOptions): number {
  const log = options.log ?? ((line: string) => console.log(line))
  const logError = options.logError ?? ((line: string) => console.error(line))
  const decision = resolveLaunch(options.env)
  let result: CheckReport
  try {
    let catalogue: CatalogueValue[] = []
    let catalogueError: string | undefined
    try {
      catalogue = readCatalogues(options.root)
    } catch (error) {
      catalogueError = error instanceof Error ? error.message : 'unreadable'
    }
    const report = checkBuild(readBuildOutput(options.root), decision, catalogue)
    result = catalogueError
      ? { ...report, failures: [`[catalogue] ${catalogueError}`, ...report.failures] }
      : report
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown'
    result = { launchLine: launchLogLine(decision), failures: [`[read] ${reason}`] }
  }
  log(result.launchLine)
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
