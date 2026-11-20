// The production live check (P1 D4; design p1-step7-design.md §5.7 items 4 and 6, §8.1 item 12,
// §8.7; P1-1c). `pnpm live:check`, run by .github/workflows/live-check.yml after each Production
// deployment, once a day and on demand. Read-only GETs to the committed production domain, never a
// URL from an event or the environment. The expectation comes from the committed
// PRODUCTION_LAUNCH, never from an env value:
// - gated: "/" 200 with the Coming-soon body, today's title, description, viewport, theme-color,
//   color-scheme, manifest and icon tags, exactly one robots meta (noindex, nofollow), no locale
//   link and no redirect script; /en, /hi, both Grown-ups
//   pages, /ar, /no-such-page, /en/stories/two-paths/read and /en/stories/two-paths 404 with the
//   bilingual h1 and noindex; /build-info.json 404 until EXPECT_BUILD_INFO is flipped at Step 25a.
// - launched (after Step 25b): "/" 200 with both gate links; /en and /hi 200 with <html lang>;
//   unmatched URLs 404, /en/stories/two-paths/read and /en/stories/two-paths among them.
// - /en/stories/two-paths/read (C18; design p1-step10-design.md §2.1, P1-4b) is a player URL for a
//   fixture story id, which Production never builds, so each Production deployment proves on Vercel
//   itself that it is the bilingual 404: gated, through the [locale] segment's empty params;
//   launched, through the player route's dynamicParams 404 (dynamicParams = false). P1 Step 12
//   (design p1-step12-design.md §3.22 N22, B12, S12-CRIT-16): /en/stories/two-paths, the story
//   landing of the same fixture id, is probed the same way (launched: the landing route's
//   dynamicParams 404).
// - always: the exact spec CSP and the 3 other security headers on the response of every probe
//   above (/build-info.json included), and no Set-Cookie on any of them (spec §9). The og image
//   probe below is the one exception: it checks status, content type, length and sha256 only
//   (design §4.14; lead decision in design §21).
// - the og fallback image (P1 Step 12, design §3.22 N22, §4.14, B9): once per round, after the
//   probes above, GET /og/storyboard-1200x630.jpg with no redirect followed: 200, content-type
//   exactly image/jpeg, and the body's length and sha256 equal to the committed
//   public/og/storyboard-1200x630.jpg, read once at start (missing: the run fails before any
//   request). It proves the og file is deployed while the reader is gated.
// - no staging banner (design p1-step9-design.md §4.5; P1-2c): on "/" in both states, on /en and
//   /hi when launched, and on every 404 probe, the body holds neither the banner attribute (in any
//   form) nor the banner text (raw or \u-escaped); /build-info.json has no body rule.
// It passes only after ROUNDS_IN_A_ROW matching rounds in a row, ROUND_INTERVAL_MS apart: any
// mismatch resets the count, because one matching round can be followed by a brief read of the
// previous deployment (owner D2, the publisher's verify). Reaching the deadline first fails.
// Log lines hold only paths, status codes, header names and pass/fail: never a header value or
// body text, so nothing the site sends back reaches the public run log.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRODUCTION_LAUNCH, type ProductionLaunch } from '../src/config/launch'
import { securityHeaders } from '../src/config/security-headers'
import { COMMITTED_PRODUCTION_ORIGIN } from '../src/config/site-url'
import { APP_NAME } from '../src/core/app-info'
import { ENABLED_LOCALE_CODES, LOCALE_CODES } from '../src/core/locales'
import { LOCALE_REDIRECT_SCRIPT } from '../src/core/progress/locale-redirect-boot'
import { gateOptions } from '../src/reader/routing'
import { THEME_COLOR } from '../src/ui/brand'
import { ROOT_METADATA } from '../src/ui/root/metadata'
import { OG_IMAGE } from '../src/ui/root/social'
import { STAGING_BANNER_ATTRIBUTE, STAGING_BANNER_TEXT } from '../src/ui/root/staging'
import { ROOT_VIEWPORT } from '../src/ui/viewport'
import { checkServiceUrl, readCapped } from '../tools/publisher/http'
import { COMING_SOON_MAIN, leakForms, ROBOTS_META } from './check-build'
import { isEntryPoint } from './load-content'

/**
 * The production domain: the committed origin the build's "site url" line compares the site URL
 * with (src/config/site-url.ts), so the build and this check name one origin (design §3.22).
 */
export const PRODUCTION_ORIGIN = COMMITTED_PRODUCTION_ORIGIN

/** The og fallback image's path on the site (src/ui/root/social.ts OG_IMAGE). */
export const OG_IMAGE_PATH = OG_IMAGE.path
/** The committed file the deployed image must equal, relative to the storyboard folder. */
export const OG_IMAGE_FILE = `public${OG_IMAGE.path}`
/** The one content-type the og image may carry. */
const OG_IMAGE_TYPE = 'image/jpeg'

/** /build-info.json is 404 while CONTENT_SOURCE=none; flipped to true at Step 25a. */
export const EXPECT_BUILD_INFO: boolean = false

export const ROUNDS_IN_A_ROW = 6
export const ROUND_INTERVAL_MS = 5_000
/** Long enough to outlast a deployment that is still building when the check starts. */
export const DEADLINE_MS = 10 * 60_000
export const REQUEST_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 1024 * 1024

/**
 * Unmatched URLs probed in both states. The player and landing paths name a fixture story id that
 * Production never builds (C18, P1-4b; P1 Step 12, S12-CRIT-16): gated, the [locale] segment's
 * empty params make them 404s; launched, the player and landing routes' dynamicParams 404 does.
 */
const UNMATCHED = [
  '/ar',
  '/no-such-page',
  '/en/stories/two-paths/read',
  '/en/stories/two-paths',
] as const

/** The redirect script's first call; the RSC payload repeats the script escaped. */
const REDIRECT_MARKER = 'getEntriesByType('

/**
 * The gated "/" head tags besides title, description and robots (design Recommendations
 * "Production" row, §8.7): Next's default viewport (so no maximum-scale), the theme colour and
 * colour scheme (src/ui/viewport.ts), the manifest link, and the two icon links (their href carries
 * a content hash after "?"). Each must appear exactly once, and no other tag of its name or rel.
 */
const HEAD_TAGS: readonly (readonly [name: string, tag: string])[] = [
  ['viewport meta', '<meta name="viewport" content="width=device-width, initial-scale=1"/>'],
  ['theme-color meta', `<meta name="theme-color" content="${THEME_COLOR}"/>`],
  [
    'color-scheme meta',
    `<meta name="color-scheme" content="${String(ROOT_VIEWPORT.colorScheme)}"/>`,
  ],
  ['manifest link', '<link rel="manifest" href="/manifest.webmanifest"/>'],
  ['icon link', '<link rel="icon" href="/icon.png?'],
  ['apple-touch-icon link', '<link rel="apple-touch-icon" href="/apple-icon.png?'],
]

/** `<meta name="x"` or `<link rel="x"`: the start every tag of that kind shares. */
const tagKind = (tag: string): string => /^<(?:meta name|link rel)="[^"]+"/.exec(tag)?.[0] ?? tag

/** One response as the checker sees it. status null: no response (network error or timeout). */
export interface Recorded {
  readonly status: number | null
  /** Lower-case names; a header sent twice appears twice. */
  readonly headers: readonly (readonly [name: string, value: string])[]
  /** null: unreadable or larger than 1 MiB. */
  readonly body: string | null
}

/** One body rule: a short name for the log, and the test. */
interface BodyRule {
  readonly name: string
  readonly holds: (body: string) => boolean
}

export interface Probe {
  readonly path: string
  readonly status: number
  readonly rules: readonly BodyRule[]
}

/** The 404 page's h1, in English and in its lang="hi" part (messages/*.json notFound.title). */
export interface NotFoundTitles {
  readonly en: string
  readonly hi: string
}

/** The four security headers production sends (src/config/security-headers.ts, no NODE_ENV). */
export const EXPECTED_HEADERS: readonly (readonly [name: string, value: string])[] =
  securityHeaders({}).map(({ key, value }) => [key.toLowerCase(), value] as const)

const count = (text: string, needle: string): number => text.split(needle).length - 1
const robotsMetas = (html: string): string[] => html.match(/<meta\s+name="robots"[^>]*>/g) ?? []
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const rule = (name: string, holds: (body: string) => boolean): BodyRule => ({ name, holds })

const ROBOTS_200 = rule('robots meta (exactly one, noindex, nofollow)', (body) => {
  const metas = robotsMetas(body)
  return metas.length === 1 && metas[0] === ROBOTS_META
})
const ROBOTS_404 = rule('robots meta (noindex)', (body) => {
  const metas = robotsMetas(body)
  return metas.length > 0 && metas.every((meta) => meta.includes('noindex'))
})

/** Production never shows the staging banner (P1-2c): no attribute in any form, no text form. */
const NO_STAGING_BANNER = rule(
  'no staging banner',
  (body) =>
    !body.includes(STAGING_BANNER_ATTRIBUTE) &&
    leakForms(STAGING_BANNER_TEXT).every((form) => !body.includes(form)),
)

function bilingualH1(titles: NotFoundTitles): BodyRule {
  const hiPart = new RegExp(`<(\\w+)\\b[^>]*\\blang="hi"[^>]*>${escapeRegExp(titles.hi)}</\\1>`)
  return rule('bilingual h1', (body) => {
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(body)?.[1]
    return h1 !== undefined && h1.startsWith(titles.en) && hiPart.test(h1)
  })
}

/** Every probe for one expectation, in request order. */
export function probes(
  launch: ProductionLaunch,
  expectBuildInfo: boolean,
  titles: NotFoundTitles,
): Probe[] {
  const notFound = (path: string): Probe => ({
    path,
    status: 404,
    rules: [bilingualH1(titles), ROBOTS_404, NO_STAGING_BANNER],
  })
  const buildInfo: Probe = {
    path: '/build-info.json',
    status: expectBuildInfo ? 200 : 404,
    rules: [],
  }
  if (launch === 'gated') {
    return [
      {
        path: '/',
        status: 200,
        rules: [
          rule('coming-soon body', (body) => body.includes(COMING_SOON_MAIN)),
          rule('title', (body) => count(body, `<title>${APP_NAME}</title>`) === 1),
          rule(
            'description',
            (body) =>
              count(body, `<meta name="description" content="${ROOT_METADATA.description}"/>`) ===
              1,
          ),
          ...HEAD_TAGS.map(([name, tag]) =>
            rule(name, (body) => count(body, tag) === 1 && count(body, tagKind(tag)) === 1),
          ),
          ROBOTS_200,
          rule('no locale link', (body) =>
            LOCALE_CODES.every((code) => !body.includes(`href="/${code}`)),
          ),
          rule(
            'no redirect script',
            (body) => !body.includes(LOCALE_REDIRECT_SCRIPT) && !body.includes(REDIRECT_MARKER),
          ),
          NO_STAGING_BANNER,
        ],
      },
      ...['/en', '/hi', '/en/grown-ups', '/hi/grown-ups', ...UNMATCHED].map(notFound),
      buildInfo,
    ]
  }
  return [
    {
      path: '/',
      status: 200,
      rules: [
        rule('gate links', (body) =>
          gateOptions().every((option) => body.includes(`href="${option.href}"`)),
        ),
        ROBOTS_200,
        NO_STAGING_BANNER,
      ],
    },
    ...ENABLED_LOCALE_CODES.map((code): Probe => ({
      path: `/${code}`,
      status: 200,
      rules: [
        rule(`html lang ${code}`, (body) => body.includes(`<html lang="${code}"`)),
        ROBOTS_200,
        NO_STAGING_BANNER,
      ],
    })),
    ...UNMATCHED.map(notFound),
    buildInfo,
  ]
}

/** What is wrong with one response: short phrases naming a rule or a header, never a value. */
export function checkResponse(probe: Probe, response: Recorded): string[] {
  const problems: string[] = []
  if (response.status === null) return ['no response']
  if (response.status !== probe.status) problems.push(`status (expected ${probe.status})`)
  for (const [name, value] of EXPECTED_HEADERS) {
    const values = response.headers.filter(([n]) => n === name).map(([, v]) => v)
    if (values.length === 0) problems.push(`missing header ${name}`)
    else if (values.length > 1 || values[0] !== value) problems.push(`header ${name} differs`)
  }
  if (response.headers.some(([name]) => name === 'set-cookie'))
    problems.push('header set-cookie present')
  if (response.status === probe.status && probe.rules.length > 0) {
    if (response.body === null) problems.push('body unreadable or larger than 1 MiB')
    else {
      for (const { name, holds } of probe.rules) if (!holds(response.body)) problems.push(name)
    }
  }
  return problems
}

/** One log line per problem: "/en 200: status (expected 404)". */
export function checkRound(
  probeList: readonly Probe[],
  responses: ReadonlyMap<string, Recorded>,
): string[] {
  return probeList.flatMap((probe) => {
    const response: Recorded = responses.get(probe.path) ?? {
      status: null,
      headers: [],
      body: null,
    }
    return checkResponse(probe, response).map(
      (problem) => `${probe.path} ${response.status ?? 'none'}: ${problem}`,
    )
  })
}

/** A fetch Response as the checker sees it. */
export async function record(response: Response): Promise<Recorded> {
  const headers = [...response.headers].map(([name, value]) => [name.toLowerCase(), value] as const)
  const bytes = await readCapped(response, MAX_BODY_BYTES).catch(() => null)
  return {
    status: response.status,
    headers,
    body: bytes === null ? null : new TextDecoder('utf-8').decode(bytes),
  }
}

/** What the deployed og image must be: the committed file's byte length and sha256 (hex). */
export interface OgImageExpectation {
  readonly length: number
  readonly sha256: string
}

/** One response as the og probe sees it: its body as bytes. */
export interface RecordedBytes {
  readonly status: number | null
  /** Lower-case names; a header sent twice appears twice. */
  readonly headers: readonly (readonly [name: string, value: string])[]
  /** null: unreadable or larger than 1 MiB. */
  readonly bytes: Uint8Array | null
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** The committed og image under `root`; throws naming the file (never a value) when it is missing. */
export function readOgImage(root: string): OgImageExpectation {
  const path = join(root, OG_IMAGE_FILE)
  if (!existsSync(path)) throw new Error(`${OG_IMAGE_FILE} is missing`)
  const bytes = new Uint8Array(readFileSync(path))
  return { length: bytes.length, sha256: sha256Hex(bytes) }
}

/** A fetch Response as the og probe sees it. */
export async function recordBytes(response: Response): Promise<RecordedBytes> {
  const headers = [...response.headers].map(([name, value]) => [name.toLowerCase(), value] as const)
  const bytes = await readCapped(response, MAX_BODY_BYTES).catch(() => null)
  return { status: response.status, headers, bytes }
}

/**
 * What is wrong with the og image response (design §4.14): short phrases naming a rule or a header,
 * never a header value, a length or a hash.
 */
export function checkOgImage(expected: OgImageExpectation, response: RecordedBytes): string[] {
  if (response.status === null) return ['no response']
  if (response.status !== 200) return ['status (expected 200)']
  const problems: string[] = []
  const types = response.headers.filter(([name]) => name === 'content-type').map(([, v]) => v)
  if (types.length === 0) problems.push('missing header content-type')
  else if (types.length > 1 || types[0] !== OG_IMAGE_TYPE) {
    problems.push('header content-type differs')
  }
  if (response.bytes === null) problems.push('body unreadable or larger than 1 MiB')
  else if (response.bytes.length !== expected.length) problems.push('body length differs')
  else if (sha256Hex(response.bytes) !== expected.sha256) problems.push('body sha256 differs')
  return problems
}

/** The 404 h1 strings from the committed catalogues, read as text. */
export function readNotFoundTitles(root: string): NotFoundTitles {
  const title = (locale: string): string => {
    const catalogue: unknown = JSON.parse(
      readFileSync(join(root, 'messages', `${locale}.json`), 'utf8'),
    )
    const value =
      typeof catalogue === 'object' && catalogue !== null
        ? (catalogue as Record<string, unknown>)['notFound.title']
        : undefined
    if (typeof value !== 'string' || value === '') {
      throw new Error(`messages/${locale}.json has no notFound.title`)
    }
    return value
  }
  return { en: title('en'), hi: title('hi') }
}

/** The storyboard folder, which holds the committed public/og file. */
const STORYBOARD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export interface LiveCheckOptions {
  readonly titles: NotFoundTitles
  /** The storyboard folder the committed og image is read from (the repository's by default). */
  readonly root?: string
  readonly origin?: string
  readonly launch?: ProductionLaunch
  readonly expectBuildInfo?: boolean
  readonly fetchImpl?: typeof fetch
  /** Epoch milliseconds. */
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly log?: (line: string) => void
  readonly intervalMs?: number
  readonly deadlineMs?: number
  readonly timeoutMs?: number
}

/** Returns the process exit code: 0 after ROUNDS_IN_A_ROW matching rounds in a row, else 1. */
export async function runLiveCheck(options: LiveCheckOptions): Promise<number> {
  const origin = new URL(options.origin ?? PRODUCTION_ORIGIN)
  checkServiceUrl(origin, 'live-check origin')
  const launch = options.launch ?? PRODUCTION_LAUNCH
  const expectBuildInfo = options.expectBuildInfo ?? EXPECT_BUILD_INFO
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const log = options.log ?? ((line: string) => console.log(line))
  const intervalMs = options.intervalMs ?? ROUND_INTERVAL_MS
  const deadlineMs = options.deadlineMs ?? DEADLINE_MS
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const probeList = probes(launch, expectBuildInfo, options.titles)
  // The committed og image, read once before any request (design §4.14).
  let ogImage: OgImageExpectation
  try {
    ogImage = readOgImage(options.root ?? STORYBOARD_ROOT)
  } catch {
    log(`live-check: FAIL (${OG_IMAGE_FILE} is missing)`)
    return 1
  }
  const request = (path: string): Promise<Response> =>
    fetchImpl(new URL(path, origin), {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })

  log(
    `live-check: ${origin.origin} expecting ${launch} (PRODUCTION_LAUNCH), /build-info.json ` +
      `${expectBuildInfo ? 200 : 404}; ${ROUNDS_IN_A_ROW} matching rounds in a row, ` +
      `${intervalMs / 1000} s apart`,
  )
  const started = now()
  let inARow = 0
  for (let round = 1; ; round++) {
    const responses = new Map<string, Recorded>()
    for (const probe of probeList) {
      try {
        responses.set(probe.path, await record(await request(probe.path)))
      } catch {
        responses.set(probe.path, { status: null, headers: [], body: null })
      }
    }
    let og: RecordedBytes
    try {
      og = await recordBytes(await request(OG_IMAGE_PATH))
    } catch {
      og = { status: null, headers: [], bytes: null }
    }
    const problems = [
      ...checkRound(probeList, responses),
      ...checkOgImage(ogImage, og).map(
        (problem) => `${OG_IMAGE_PATH} ${og.status ?? 'none'}: ${problem}`,
      ),
    ]
    if (problems.length === 0) {
      inARow++
      log(`live-check: round ${round}: pass (${inARow}/${ROUNDS_IN_A_ROW})`)
      if (inARow >= ROUNDS_IN_A_ROW) {
        log(`live-check: pass (${ROUNDS_IN_A_ROW} matching rounds in a row)`)
        return 0
      }
    } else {
      log(`live-check: round ${round}: FAIL${inARow > 0 ? `, count reset from ${inARow}` : ''}`)
      for (const problem of problems) log(`live-check:   ${problem}`)
      inARow = 0
    }
    if (now() - started + intervalMs > deadlineMs) {
      log(
        `live-check: FAIL (deadline reached after ${round} rounds without ${ROUNDS_IN_A_ROW} ` +
          'matching rounds in a row)',
      )
      return 1
    }
    await sleep(intervalMs)
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  void runLiveCheck({ titles: readNotFoundTitles(STORYBOARD_ROOT) }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`live-check: FAIL (${error instanceof Error ? error.name : 'error'})`)
      process.exit(1)
    },
  )
}
