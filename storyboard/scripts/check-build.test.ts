// The post-build check (design p1-step7-design.md §5.7 item 2, §8.1 item 11; P1-1c). The sample
// outputs are shaped on real Step 7 builds (Next 16.4.5, Turbopack): the prerender-manifest keys and
// entries, and the head, <main> and script markup of index.html, the locale pages and the 404.
// P1-2b (design p1-step8-design.md §3.3 C-2, §10.1): the [content-outputs] truth table.
// P1-2c (design p1-step9-design.md §4.5, §10.1): [staging-banner], its second lock (the loader's
// stagingPointerAllowed), readContentMode and the summary line every runCheckBuild run prints.
// The banner's marker, attribute and text come from src/ui/root/staging.ts, never retyped.
// P1-4b (design p1-step10-design.md §9.1 G1, G2, §10.1 item 5): [player-pages] and
// [package-text-leak] with every listed negative, on the 3 fixture packages and strictly parsed
// variants of them, and the two player lines every runCheckBuild run prints.
// P1 Step 12 (design p1-step12-design.md §3.16 N17, A18; test plan T12-25): [landing-pages], the
// player rule's twin for <locale>/stories/<storyId>.html, the landing pattern among the open
// build's required patterns, and the landing line every run prints after the player line. The
// review sample output (withStories) now holds both story routes.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveLaunch, type Env, type LaunchDecision } from '../src/config/launch'
import type { BuildInfo } from '../src/core/content/build-info'
import { GATE_MODES, type GateMode } from '../src/core/content/gates'
import { jcsBytes } from '../src/core/hashing'
import { ENABLED_LOCALE_CODES } from '../src/core/locales'
import { StoryPackageV1 } from '../src/core/package/v1'
import { LOCALE_REDIRECT_SCRIPT } from '../src/core/progress/locale-redirect-boot'
import {
  STAGING_BANNER_ATTRIBUTE,
  STAGING_BANNER_MARKER,
  STAGING_BANNER_TEXT,
} from '../src/ui/root/staging'
import {
  checkBuild,
  checkContentOutputs,
  checkLandingPages,
  checkPackageTextLeak,
  checkPlayerPages,
  checkStagingBanner,
  COMING_SOON_MAIN,
  contentModeLine,
  DISAGREEMENT_HINT,
  escapeNonAscii,
  leakForms,
  MIN_LEAK_LENGTH,
  NO_CONTENT,
  packageTextForms,
  packageTextValues,
  LANDING_PATTERN,
  landingLine,
  PLAYER_PATTERN,
  playerLine,
  readBuiltContent,
  readCatalogues,
  readContentMode,
  readContentOutputs,
  ROBOTS_META,
  runCheckBuild,
  type BuildOutput,
  type BuiltContent,
  type CatalogueValue,
  type ContentMode,
  type ContentOutputs,
} from './check-build'
import { STAGING_REFUSED_HERE, stagingPointerAllowed } from './load-content'

const storyboard = join(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOGUE = readCatalogues(storyboard)

const GATED = resolveLaunch({ CONTENT_SOURCE: 'none', VERCEL_ENV: 'production' })
const OPEN = resolveLaunch({ CONTENT_SOURCE: 'fixtures', READER_LAUNCH: 'review' })

const FONT_CLASSES = '_0BuglG_variable _2r7mIq_variable RIHMTq_variable'
const BOOT = '<script>(function(){try{var r=localStorage.getItem("reader.v1.prefs")})()</script>'
const NOT_FOUND_ROBOTS = '<meta name="robots" content="noindex"/>'

/** One prerendered document in the shape Next writes it. */
function doc(lang: string, head: string, main: string, tail = ''): string {
  return (
    `<!DOCTYPE html><html lang="${lang}" dir="ltr" class="${FONT_CLASSES}"><head>` +
    '<meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>' +
    `${BOOT}<meta name="theme-color" content="#0d0a05"/>${head}</head>` +
    `<body><div hidden=""><!--$--><!--/$--></div>${main}` +
    '<script id="_R_">(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({})</script>' +
    `${tail}</body></html>`
  )
}

const page = (route: string) => ({
  routeType: 'page',
  response: 'complete',
  compute: 'static',
  initialRevalidateSeconds: false,
  srcRoute: route,
  dataRoute: `${route === '/' ? '/index' : route}.rsc`,
})

const pattern = (regex: string) => ({
  routeRegex: regex,
  dataRoute: '/[locale].rsc',
  fallback: false,
  fallbackRootParams: [],
  fallbackRouteParams: [],
  prefetchDataRoute: null,
})

function manifest(extraRoutes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 4,
    routes: {
      '/': page('/'),
      '/_global-error': page('/_global-error'),
      '/_not-found': { initialStatus: 404, ...page('/_not-found') },
      '/apple-icon.png': { routeType: 'route', srcRoute: '/apple-icon.png', dataRoute: null },
      '/icon.png': { routeType: 'route', srcRoute: '/icon.png', dataRoute: null },
      '/manifest.webmanifest': { routeType: 'route', srcRoute: '/manifest.webmanifest' },
      ...extraRoutes,
    },
    dynamicRoutes: {
      '/[locale]': pattern('^/([^/]+?)(?:/)?$'),
      '/[locale]/grown-ups': pattern('^/([^/]+?)/grown\\-ups(?:/)?$'),
    },
    notFoundRoutes: [],
    preview: { previewModeId: 'id', previewModeSigningKey: 'k', previewModeEncryptionKey: 'k' },
  }
}

const ROOT_HEAD =
  '<title>Storyboard</title>' +
  '<meta name="description" content="Interactive stories for children (work in progress)."/>' +
  `<link rel="manifest" href="/manifest.webmanifest"/>${ROBOTS_META}`

const NOT_FOUND = doc(
  'en',
  `<title>Page not found – Storyboard</title>${NOT_FOUND_ROBOTS}`,
  '<main><h1>Page not found<!-- --> <span lang="hi" class="x_titleHi">पेज नहीं मिला</span></h1>' +
    '<a href="/" class="x_link"><span>Go to the start page</span></a></main>',
)
const GLOBAL_ERROR = '<!DOCTYPE html><html id="__next_error__"><head></head><body></body></html>'
const CHUNKS = new Map([
  [
    'chunks/41_aj8a-f8y7b.js',
    '(globalThis.TURBOPACK||[]).push(["x",function(){return"Grown-ups"}])',
  ],
  ['chunks/turbopack-2u1d16houkiyo.js', 'var a="Site";'],
])

/** The gated output: today's Coming-soon "/", no locale page, the /[locale] patterns kept. */
function gatedOutput(): BuildOutput {
  return {
    manifest: JSON.stringify(manifest()),
    html: new Map([
      ['_global-error.html', GLOBAL_ERROR],
      ['_not-found.html', NOT_FOUND],
      ['index.html', doc('en', ROOT_HEAD, COMING_SOON_MAIN)],
    ]),
    staticJs: new Map(CHUNKS),
  }
}

const GATE_MAIN =
  '<main><h1>Storyboard</h1><p class="x_prompt">Choose your language</p>' +
  '<ul class="x_options"><li><a href="/en?remember=1" hrefLang="en" lang="en" dir="ltr" class="x_option">' +
  '<span aria-hidden="true" class="x_mark">A</span><span class="x_endonym">English</span></a></li>' +
  '<li><a href="/hi?remember=1" hrefLang="hi" lang="hi" dir="ltr" class="x_option">' +
  '<span aria-hidden="true" class="x_mark">अ</span><span class="x_endonym">हिन्दी</span></a></li></ul></main>'

/** The RSC payload repeats the redirect script escaped (not a raw copy). */
const RSC_COPY = `<script>self.__next_f.push([1,"{\\"__html\\":\\"${JSON.stringify(LOCALE_REDIRECT_SCRIPT).slice(1, -1).replace(/"/g, '\\"')}\\"}"])</script>`

const localePage = (code: string, title: string) =>
  doc(
    code,
    `<title>${title}</title>${ROBOTS_META}`,
    `<main id="main" tabindex="-1"><h1>x</h1></main>`,
  )

/** The review output: the gate on "/", /en, /hi and both Grown-ups pages. */
function openOutput(): BuildOutput {
  return {
    manifest: JSON.stringify(
      manifest({
        '/en': page('/[locale]'),
        '/en/grown-ups': page('/[locale]/grown-ups'),
        '/hi': page('/[locale]'),
        '/hi/grown-ups': page('/[locale]/grown-ups'),
      }),
    ),
    html: new Map([
      ['_global-error.html', GLOBAL_ERROR],
      ['_not-found.html', NOT_FOUND],
      ['en.html', localePage('en', 'Storyboard')],
      ['en/grown-ups.html', localePage('en', 'For grown-ups – Storyboard')],
      ['hi.html', localePage('hi', 'Storyboard')],
      ['hi/grown-ups.html', localePage('hi', 'बड़ों के लिए – Storyboard')],
      [
        'index.html',
        doc('en', `${ROOT_HEAD}<script>${LOCALE_REDIRECT_SCRIPT}</script>`, GATE_MAIN, RSC_COPY),
      ],
    ]),
    staticJs: new Map(CHUNKS),
  }
}

type Edit = (output: {
  manifest: Record<string, Record<string, unknown>>
  html: Map<string, string>
  staticJs: Map<string, string>
}) => void

/** A copy of `base` changed by `edit` (the manifest as an object). */
function changed(base: BuildOutput, edit: Edit): BuildOutput {
  const draft = {
    manifest: JSON.parse(base.manifest ?? '{}') as Record<string, Record<string, unknown>>,
    html: new Map(base.html),
    staticJs: new Map(base.staticJs),
  }
  edit(draft)
  return { manifest: JSON.stringify(draft.manifest), html: draft.html, staticJs: draft.staticJs }
}

const failuresOf = (
  output: BuildOutput,
  decision: LaunchDecision,
  catalogue: readonly CatalogueValue[] = CATALOGUE,
) => checkBuild(output, decision, catalogue).failures

// ---- the story player (P1-4b, design p1-step10-design.md §9.1 G1, G2) ----

/**
 * The story lines of a build with no player page, no landing and no package (§10.1 item 5): the
 * player line, then the landing line (Step 12, design p1-step12-design.md §3.16).
 */
const NO_PLAYER_LINES = [
  'player pages: 0 (expected 0); package text values scanned: 0',
  'landing pages: 0 (expected 0)',
]
/** The same lines when the build output could not be read (a [read] failure). */
const UNREAD_PLAYER_LINES = [
  'player pages: unknown (expected 0); package text values scanned: unknown',
  'landing pages: unknown (expected 0)',
]

const fixture = (storyId: string): StoryPackageV1 =>
  StoryPackageV1.parse(
    JSON.parse(readFileSync(join(storyboard, 'fixtures', 'packages', `${storyId}.json`), 'utf8')),
  )
/** The 3 fixture packages: en and hi each; 110 text lines of 16 or more code units in all. */
const FIXTURES = ['lantern-walk', 'river-stones', 'two-paths'].map(fixture)
const TWO_PATHS = fixture('two-paths')

/** A copy of `pkg` changed by `edit`, strictly parsed again, so every sample is a valid package. */
function variant(pkg: StoryPackageV1, edit: (draft: StoryPackageV1) => void): StoryPackageV1 {
  const draft = structuredClone(pkg)
  edit(draft)
  return StoryPackageV1.parse(draft)
}

/** two-paths in English only (C8: its hi page is unexpected). */
const EN_ONLY = variant(TWO_PATHS, (d) => {
  d.locales = ['en']
  delete d.text.hi
})

/** An asset id for the alt-text sample (alt values are package text too). */
const ALT_ID = 'a'.repeat(64)

/**
 * two-paths with a value of 16 or more code units in every text field of en, with a multi-line
 * passage (an apostrophe, a `</` and a 15-unit line), an emoji-led choice and a curly apostrophe,
 * plus an ar locale (in the package, not enabled), whose text must be scanned too.
 */
const SAMPLE = variant(TWO_PATHS, (d) => {
  const en = d.text.en!
  en.title = 'The sample story title for tests'
  en.description = 'A description that is long enough.'
  en.theme = 'A theme that is long enough'
  en.duration = 'A duration, long enough'
  en.book = 'A book line, long enough'
  en.alt = { [ALT_ID]: 'An alt text that is long enough' }
  en.nodes.start!.text =
    'First line of the opening passage.\n\nSecond line: it\'s a "quoted" word.\n' +
    'Third line holds </b> markup.\n15 units, short\n16 units: kept!!'
  en.nodes.start!.question = 'Which way isn’t the long way home?'
  en.nodes.start!.choices = {
    c1: '🐢 Take the slow and steady path',
    c2: '🐇 Run the quick path now',
  }
  en.nodes.ending_wise!.lesson = 'The lesson of the wise ending.'
  d.locales = ['en', 'hi', 'ar']
  const ar = structuredClone(en)
  ar.title = 'Arabic sample title, long enough'
  ar.description = 'Arabic description, long enough'
  ar.theme = 'Arabic theme, long enough'
  ar.duration = 'Arabic duration, long enough'
  ar.book = 'Arabic book line, long enough'
  ar.alt = { [ALT_ID]: 'Arabic alt text, long enough' }
  for (const [id, node] of Object.entries(ar.nodes)) {
    node.text = `Arabic passage of ${id}, long.`
    if (node.question !== undefined) node.question = `Arabic question of ${id}?`
    if (node.choices !== undefined) {
      node.choices = Object.fromEntries(
        Object.keys(node.choices).map((c) => [c, `Arabic choice ${c} of ${id}`]),
      )
    }
    if (node.lesson !== undefined) node.lesson = `Arabic lesson of ${id}, long.`
  }
  d.text.ar = ar
})

const contentOf = (
  packages: readonly StoryPackageV1[],
  storyIds = packages.map((pkg) => pkg.storyId),
): BuiltContent => ({ storyIds, packages, problems: [] })

/** A player page as Next writes it (P1-4b): skip link, hint script, then the island, one main. */
const playerPage = (code: string, main = '<main id="main" tabindex="-1" class="x_main">') =>
  doc(
    code,
    `<title>Two Paths – Storyboard</title>${ROBOTS_META}`,
    '<a href="#main" class="x_skip">Skip</a><script>(function(){try{}catch(e){}})()</script>' +
      `<div data-player="" data-run-phase="opening"><header><a href="/${code}" data-exit="">x</a>` +
      `</header>${main}<div data-run="" data-epoch="0"><h1>x</h1></div><div role="status"></div>` +
      '</main></div>',
  )

const playerPath = (code: string, storyId: string) => `${code}/stories/${storyId}/read.html`

/** `base` with the player pattern entry and, unless gated, a page per story and enabled locale. */
function withPlayers(base: BuildOutput, packages: readonly StoryPackageV1[]): BuildOutput {
  return changed(base, (o) => {
    o.manifest.dynamicRoutes![PLAYER_PATTERN] = pattern('^/([^/]+?)/stories/([^/]+?)/read(?:/)?$')
    if (!o.html.has('en.html')) return // gated: the pattern entry only, as Next writes it
    for (const pkg of packages) {
      for (const code of ENABLED_LOCALE_CODES.filter((c) => pkg.locales.includes(c))) {
        o.manifest.routes![`/${code}/stories/${pkg.storyId}/read`] = page(PLAYER_PATTERN)
        o.html.set(playerPath(code, pkg.storyId), playerPage(code))
      }
    }
  })
}

// ---- the story landing (P1 Step 12, design p1-step12-design.md §3.16 N17) ----

/** A landing page as Next writes it under the (site) layout: skip link, header, one main. */
const landingPage = (code: string, main = '<main id="main" tabindex="-1" class="x_main">') =>
  doc(
    code,
    `<title>Two Paths – Storyboard</title>${ROBOTS_META}`,
    '<a href="#main" class="x_skip">Skip</a><header><a href="/' +
      code +
      '" lang="en">Storyboard</a></header>' +
      `${main}<div data-landing=""><h1>x</h1></div><div role="status"></div></main>`,
  )

const landingPath = (code: string, storyId: string) => `${code}/stories/${storyId}.html`

/** `base` with the landing pattern entry and, unless gated, a landing per story and enabled locale. */
function withLandings(base: BuildOutput, packages: readonly StoryPackageV1[]): BuildOutput {
  return changed(base, (o) => {
    o.manifest.dynamicRoutes![LANDING_PATTERN] = pattern('^/([^/]+?)/stories/([^/]+?)(?:/)?$')
    if (!o.html.has('en.html')) return // gated: the pattern entry only, as Next writes it
    for (const pkg of packages) {
      for (const code of ENABLED_LOCALE_CODES.filter((c) => pkg.locales.includes(c))) {
        o.manifest.routes![`/${code}/stories/${pkg.storyId}`] = page(LANDING_PATTERN)
        o.html.set(landingPath(code, pkg.storyId), landingPage(code))
      }
    }
  })
}

/** Both story routes, as a review build has them: the players and the landings. */
const withStories = (base: BuildOutput, packages: readonly StoryPackageV1[]): BuildOutput =>
  withLandings(withPlayers(base, packages), packages)

// ---- the staging banner (P1-2c) ----

/** The banner as React renders it (src/ui/root/staging-banner.tsx), with a module class. */
const BANNER = `<p ${STAGING_BANNER_MARKER} lang="en" class="x_banner">${STAGING_BANNER_TEXT}</p>`

/** The banner's flight copy: JSON-escaped, so it never matches the marker. */
const BANNER_FLIGHT =
  `<script>self.__next_f.push([1,"[\\"$\\",\\"p\\",null,{\\"${STAGING_BANNER_ATTRIBUTE}\\":\\"\\",` +
  `\\"lang\\":\\"en\\",\\"className\\":\\"x_banner\\",\\"children\\":\\"${STAGING_BANNER_TEXT}\\"}]"])</script>`

/** Next renders this first in <body> on every prerendered page; the banner follows it. */
const HIDDEN_DIV = '<div hidden=""><!--$--><!--/$--></div>'

/** A page with `banner` right after Next's hidden div, and the banner's flight copy. */
const withBanner = (html: string, banner = BANNER): string =>
  html.replace(HIDDEN_DIV, `${HIDDEN_DIV}${banner}`).replace('</body>', `${BANNER_FLIGHT}</body>`)

/** A staging build's output: the banner on every page but Next's _global-error.html. */
function staged(base: BuildOutput): BuildOutput {
  return {
    ...base,
    html: new Map(
      [...base.html].map(([path, html]) => [
        path,
        path === '_global-error.html' ? html : withBanner(html),
      ]),
    ),
  }
}

/** The CI staging harness and preview:staging give check-build a simulated Preview (design §3.4). */
const PREVIEW: Env = { CONTENT_SOURCE: 'storage', VERCEL_ENV: 'preview', READER_LAUNCH: 'review' }
/** The gated harness: storage with no Vercel variables, on win32 or in GitHub Actions. */
const LOCAL_STAGING: Env = { CONTENT_SOURCE: 'storage' }
const OPEN_STAGING = resolveLaunch(PREVIEW)
const GATED_STAGING = resolveLaunch(LOCAL_STAGING)

describe('the sample outputs pass', () => {
  it('a gated build (CI gated leg and Production now)', () => {
    const report = checkBuild(gatedOutput(), GATED, CATALOGUE)
    expect(report.failures).toEqual([])
    expect(report.launchLine).toBe('reader launch: gated (committed); locale routes: 0')
  })

  it('a gated build under the kill switch', () => {
    const report = checkBuild(gatedOutput(), resolveLaunch({ READER_LAUNCH: 'gated' }), CATALOGUE)
    expect(report.failures).toEqual([])
    expect(report.launchLine).toBe('reader launch: gated (kill-switch); locale routes: 0')
  })

  it('an open build (CI review leg)', () => {
    const report = checkBuild(openOutput(), OPEN, CATALOGUE)
    expect(report.failures).toEqual([])
    expect(report.launchLine).toBe('reader launch: open (review); locale routes: 4')
  })
})

describe('the state agreement', () => {
  it('is the design sentence, word for word', () => {
    expect(DISAGREEMENT_HINT).toBe(
      'build output disagrees with the launch decision; is READER_LAUNCH, VERCEL, VERCEL_ENV or CONTENT_SOURCE set in a .env* file?',
    )
  })

  it('fails an open output against a gated decision, with the .env* hint and nothing else', () => {
    const failures = failuresOf(openOutput(), GATED)
    expect(failures).toEqual([
      `[state-agreement] ${DISAGREEMENT_HINT} (output: open, locale routes: 4, redirect scripts: 1; decision: gated)`,
    ])
  })

  it('fails a gated output against an open decision', () => {
    const failures = failuresOf(gatedOutput(), OPEN)
    expect(failures).toEqual([
      `[state-agreement] ${DISAGREEMENT_HINT} (output: gated, locale routes: 0, redirect scripts: 0; decision: open)`,
    ])
  })

  it('fails a gated build with /en built', () => {
    const output = changed(gatedOutput(), (o) => {
      o.manifest.routes!['/en'] = page('/[locale]')
    })
    expect(failuresOf(output, GATED)).toEqual([expect.stringContaining(DISAGREEMENT_HINT)])
  })

  it('fails a gated build whose "/" holds the redirect script', () => {
    const output = changed(gatedOutput(), (o) => {
      o.html.set(
        'index.html',
        doc('en', `${ROOT_HEAD}<script>${LOCALE_REDIRECT_SCRIPT}</script>`, COMING_SOON_MAIN),
      )
    })
    expect(failuresOf(output, GATED)).toEqual([expect.stringContaining('[state-agreement]')])
  })

  it('fails a gated build with /ar built', () => {
    const output = changed(gatedOutput(), (o) => {
      o.manifest.routes!['/ar'] = page('/[locale]')
    })
    expect(failuresOf(output, GATED)).toEqual([expect.stringContaining('[state-agreement]')])
  })

  it('fails a refused decision (next build would have stopped) and never prints the raw value', () => {
    const decision = resolveLaunch({ READER_LAUNCH: 'Review-typo' })
    const report = checkBuild(gatedOutput(), decision, CATALOGUE)
    expect(report.failures).toEqual([
      '[launch] reader launch refused: malformed; next build should have stopped first: ' +
        'is READER_LAUNCH, VERCEL, VERCEL_ENV or CONTENT_SOURCE set in a .env* file?',
    ])
    expect(report.launchLine).toBe('reader launch: gated (malformed); locale routes: 0')
    expect(JSON.stringify(report)).not.toContain('Review-typo')
  })
})

describe('the gated rules', () => {
  it('fails without the /[locale] pattern entry (R23)', () => {
    const output = changed(gatedOutput(), (o) => {
      delete o.manifest.dynamicRoutes!['/[locale]']
    })
    expect(failuresOf(output, GATED)).toEqual([
      '[dynamic-routes] dynamicRoutes has no /[locale] entry (design R23)',
    ])
  })

  it('does not require /[locale]/grown-ups while gated', () => {
    const output = changed(gatedOutput(), (o) => {
      delete o.manifest.dynamicRoutes!['/[locale]/grown-ups']
    })
    expect(failuresOf(output, GATED)).toEqual([])
  })

  it('fails a "/" without the exact Coming-soon markup', () => {
    const output = changed(gatedOutput(), (o) => {
      o.html.set(
        'index.html',
        doc('en', ROOT_HEAD, '<main><h1>Storyboard</h1><p>Coming soon!</p></main>'),
      )
    })
    expect(failuresOf(output, GATED)).toEqual([
      `[coming-soon] index.html does not hold ${COMING_SOON_MAIN}`,
    ])
  })

  it('fails a "/" that holds only the escaped copy of the redirect script', () => {
    const output = changed(gatedOutput(), (o) => {
      o.html.set('index.html', doc('en', ROOT_HEAD, COMING_SOON_MAIN, RSC_COPY))
    })
    expect(failuresOf(output, GATED)).toEqual([
      '[redirect-script] index.html holds the redirect script (escaped)',
    ])
  })

  it.each([
    ['<a href="/en?remember=1">English</a>', '[gate] index.html links to /en'],
    ['<a href="/hi">हिन्दी</a>', '[gate] index.html links to /hi'],
    ['<p lang="hi">अपनी भाषा चुनें</p>', '[gate] index.html holds lang="hi"'],
  ])('fails a "/" holding %s', (extra, failure) => {
    const output = changed(gatedOutput(), (o) => {
      o.html.set('index.html', doc('en', ROOT_HEAD, `${COMING_SOON_MAIN}${extra}`))
    })
    expect(failuresOf(output, GATED)).toEqual([failure])
  })
})

describe('the open rules', () => {
  it('fails without /hi', () => {
    const output = changed(openOutput(), (o) => {
      delete o.manifest.routes!['/hi']
    })
    expect(failuresOf(output, OPEN)).toEqual(['[routes] routes has no /hi'])
  })

  it('fails with /ar built', () => {
    const output = changed(openOutput(), (o) => {
      o.manifest.routes!['/ar'] = page('/[locale]')
      o.html.set('ar.html', localePage('ar', 'Storyboard'))
    })
    expect(failuresOf(output, OPEN)).toEqual([
      '[routes] routes has /ar, under the disabled locale ar',
    ])
  })

  it('fails without /[locale]/grown-ups', () => {
    const output = changed(openOutput(), (o) => {
      delete o.manifest.dynamicRoutes!['/[locale]/grown-ups']
    })
    expect(failuresOf(output, OPEN)).toEqual([
      '[dynamic-routes] dynamicRoutes has no /[locale]/grown-ups entry (design R23)',
    ])
  })

  it('fails a gate without the हिन्दी link', () => {
    const output = changed(openOutput(), (o) => {
      const index = o.html.get('index.html') ?? ''
      o.html.set('index.html', index.replace('href="/hi?remember=1"', 'href="/hi"'))
    })
    expect(failuresOf(output, OPEN)).toEqual([
      '[gate] index.html has no gate link to /hi?remember=1',
    ])
  })

  it.each([
    ['missing', ''],
    [
      'doubled',
      `<script>${LOCALE_REDIRECT_SCRIPT}</script><script>${LOCALE_REDIRECT_SCRIPT}</script>`,
    ],
    ['not an element', `<script id="x">${LOCALE_REDIRECT_SCRIPT}</script>`],
  ])('fails a redirect script that is %s', (_name, scripts) => {
    const output = changed(openOutput(), (o) => {
      o.html.set('index.html', doc('en', `${ROOT_HEAD}${scripts}`, GATE_MAIN, RSC_COPY))
    })
    const failures = failuresOf(output, OPEN)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatch(
      /^\[redirect-script\] index\.html must hold the redirect script exactly once/,
    )
  })

  it('fails a locale page without its <html lang>', () => {
    const output = changed(openOutput(), (o) => {
      o.html.set('hi/grown-ups.html', localePage('en', 'बड़ों के लिए – Storyboard'))
    })
    expect(failuresOf(output, OPEN)).toEqual([
      '[html-lang] hi/grown-ups.html has no <html lang="hi"',
    ])
  })

  it('fails a missing /hi page file', () => {
    const output = changed(openOutput(), (o) => {
      o.html.delete('hi.html')
    })
    expect(failuresOf(output, OPEN)).toEqual(['[html-lang] missing hi.html'])
  })
})

describe('the rules for both states', () => {
  const each = [
    ['gated', gatedOutput, GATED],
    ['open', openOutput, OPEN],
  ] as const

  describe.each(each)('%s', (_state, output, decision) => {
    it.each([
      ['true', true],
      ['null', null],
      ['a fallback page', '/[locale].html'],
      ['missing', undefined],
    ])('fails fallback %s on a /[locale]… entry', (_name, fallback) => {
      for (const key of ['/[locale]', '/[locale]/grown-ups', '/[locale]/story/[id]']) {
        const edited = changed(output(), (o) => {
          o.manifest.dynamicRoutes![key] = { ...pattern('^x$'), fallback }
        })
        const failures = failuresOf(edited, decision)
        expect(failures).toHaveLength(1)
        expect(failures[0]).toMatch(
          new RegExp(`^\\[dynamic-routes\\] ${key.replace(/[[\]/]/g, '\\$&')} has fallback`),
        )
      }
    })

    it('ignores a dynamic route outside /[locale]', () => {
      const edited = changed(output(), (o) => {
        o.manifest.dynamicRoutes!['/write/[id]'] = { ...pattern('^x$'), fallback: null }
      })
      expect(failuresOf(edited, decision)).toEqual([])
    })

    it.each(['/', '/_not-found'])('fails without the %s route', (route) => {
      const edited = changed(output(), (o) => {
        delete o.manifest.routes![route]
      })
      expect(failuresOf(edited, decision)).toEqual([`[routes] routes has no ${route}`])
    })

    it('fails a missing manifest or index.html, never skips', () => {
      expect(failuresOf({ ...output(), manifest: undefined }, decision)).toEqual([
        '[files] missing .next/prerender-manifest.json',
      ])
      const html = new Map(output().html)
      html.delete('index.html')
      expect(failuresOf({ ...output(), html }, decision)).toEqual([
        '[files] missing the prerendered index.html',
      ])
      expect(
        failuresOf({ manifest: undefined, html: new Map(), staticJs: new Map() }, decision),
      ).toEqual([
        '[files] missing .next/prerender-manifest.json',
        '[files] missing the prerendered index.html',
      ])
    })

    it('fails a missing 404 page', () => {
      const html = new Map(output().html)
      html.delete('_not-found.html')
      expect(failuresOf({ ...output(), html }, decision)).toEqual([
        '[files] missing the prerendered _not-found.html',
      ])
    })

    it.each([
      ['not JSON', '{', 'prerender-manifest.json is not valid JSON'],
      ['another version', JSON.stringify({ ...manifest(), version: 5 }), 'version is not 4'],
      ['without routes', JSON.stringify({ version: 4, dynamicRoutes: {} }), 'no routes'],
    ])('fails a manifest that is %s', (_name, text, message) => {
      const failures = failuresOf({ ...output(), manifest: text }, decision)
      expect(failures).toHaveLength(1)
      expect(failures[0]).toContain(`[manifest] `)
      expect(failures[0]).toContain(message)
    })

    it.each([
      ['no robots meta', ''],
      ['two noindex, nofollow metas', `${ROBOTS_META}${ROBOTS_META}`],
      ['a second, different robots meta', `${ROBOTS_META}<meta name="robots" content="index"/>`],
      ['only noindex', NOT_FOUND_ROBOTS],
    ])('fails a 200 page with %s', (_name, robots) => {
      const edited = changed(output(), (o) => {
        const index = o.html.get('index.html') ?? ''
        o.html.set('index.html', index.replace(ROBOTS_META, robots))
      })
      const failures = failuresOf(edited, decision)
      expect(failures).toHaveLength(1)
      expect(failures[0]).toMatch(/^\[robots\] index\.html: expected exactly one noindex, nofollow/)
    })

    it('fails a 404 page without noindex, and ignores _global-error.html', () => {
      const edited = changed(output(), (o) => {
        o.html.set('_not-found.html', NOT_FOUND.replace(NOT_FOUND_ROBOTS, ''))
      })
      expect(failuresOf(edited, decision)).toEqual([
        '[robots] _not-found.html: every robots meta must hold noindex (found 0)',
      ])
      const nofollowOnly = changed(output(), (o) => {
        o.html.set(
          '_not-found.html',
          NOT_FOUND.replace(
            NOT_FOUND_ROBOTS,
            `${NOT_FOUND_ROBOTS}<meta name="robots" content="nofollow"/>`,
          ),
        )
      })
      expect(failuresOf(nofollowOnly, decision)).toHaveLength(1)
    })

    it('fails a catalogue value found in client JS, raw or \\u-escaped in either case', () => {
      const hi = CATALOGUE.find((v) => v.locale === 'hi' && v.key === 'notFound.body')
      const en = CATALOGUE.find((v) => v.locale === 'en' && v.key === 'storage.title')
      if (!hi || !en) throw new Error('catalogue keys missing')
      const forms = [
        hi.value,
        escapeNonAscii(hi.value, false),
        escapeNonAscii(hi.value, true),
        en.value,
        en.value.replace('’', '\\u2019'),
      ]
      for (const form of forms) {
        const edited = changed(output(), (o) => {
          o.staticJs.set('chunks/leak.js', `var m=${JSON.stringify('x')}+"${form}";`)
        })
        expect(failuresOf(edited, decision)).toEqual([
          expect.stringMatching(
            /^\[catalogue-leak\] \.next\/static\/chunks\/leak\.js holds (hi notFound\.body|en storage\.title)/,
          ),
        ])
      }
    })

    it('ignores message values shorter than 16 code units', () => {
      const short = CATALOGUE.filter((v) => v.value.length < 16).map((v) => v.value)
      expect(short.length).toBeGreaterThan(0)
      const edited = changed(output(), (o) => {
        o.staticJs.set('chunks/short.js', short.map((s) => JSON.stringify(s)).join(','))
      })
      expect(failuresOf(edited, decision)).toEqual([])
    })

    it('fails when there is nothing to scan', () => {
      expect(failuresOf({ ...output(), staticJs: new Map() }, decision)).toEqual([
        '[catalogue-leak] no .js file under .next/static to scan',
      ])
      expect(failuresOf(output(), decision, [])).toEqual([
        '[catalogue] no message value to scan for',
      ])
    })
  })
})

describe('leak forms', () => {
  it('escapes every non-ASCII code unit, in lower or upper hex', () => {
    expect(escapeNonAscii('पेज isn’t', false)).toBe('\\u092a\\u0947\\u091c isn\\u2019t')
    expect(escapeNonAscii('पेज isn’t', true)).toBe('\\u092A\\u0947\\u091C isn\\u2019t')
    expect(escapeNonAscii('😀', false)).toBe('\\ud83d\\ude00')
    expect(leakForms('plain ASCII only')).toEqual(['plain ASCII only'])
    expect(leakForms('isn’t')).toEqual(['isn’t', 'isn\\u2019t'])
  })
})

describe('the real catalogues', () => {
  it('are read as text: every value of every locale, enough of them long enough to scan', () => {
    const locales = [...new Set(CATALOGUE.map((v) => v.locale))]
    expect(locales).toEqual(['en', 'hi'])
    const en = CATALOGUE.filter((v) => v.locale === 'en')
    const hi = CATALOGUE.filter((v) => v.locale === 'hi')
    expect(en.map((v) => v.key)).toEqual(hi.map((v) => v.key))
    expect(CATALOGUE.filter((v) => v.value.length >= 16).length).toBeGreaterThanOrEqual(20)
  })
})

describe('[player-pages] (P1-4b, design p1-step10-design.md §9.1 G1)', () => {
  const CONTENT = contentOf(FIXTURES)
  const OPEN_PLAYERS = withStories(openOutput(), FIXTURES)
  const report = (failures: string[], pages: number, expected: number | null) => ({
    failures,
    pages,
    expected,
  })

  it('passes an open build with one page per listed story and enabled locale (6)', () => {
    expect(checkPlayerPages(OPEN_PLAYERS, OPEN, CONTENT)).toEqual(report([], 6, 6))
    const full = checkBuild(OPEN_PLAYERS, OPEN, CATALOGUE, CONTENT)
    expect(full.failures).toEqual([])
    expect(full.launchLine).toBe('reader launch: open (review); locale routes: 16')
  })

  it('expects no player page while gated, or without content', () => {
    const gated = withPlayers(gatedOutput(), FIXTURES)
    expect(checkPlayerPages(gated, GATED, CONTENT)).toEqual(report([], 0, 0))
    expect(checkBuild(gated, GATED, CATALOGUE, CONTENT).failures).toEqual([])
    expect(checkPlayerPages(openOutput(), OPEN, NO_CONTENT)).toEqual(report([], 0, 0))
    expect(checkPlayerPages(openOutput(), OPEN, contentOf([]))).toEqual(report([], 0, 0))
  })

  it('expects only the enabled locales of each package ([en, hi, ar] gives 2 pages)', () => {
    const output = withPlayers(openOutput(), [SAMPLE])
    expect([...output.html.keys()].filter((p) => p.includes('/stories/'))).toEqual([
      playerPath('en', 'two-paths'),
      playerPath('hi', 'two-paths'),
    ])
    expect(checkPlayerPages(output, OPEN, contentOf([SAMPLE]))).toEqual(report([], 2, 2))
  })

  it.each<[string, (o: { html: Map<string, string> }) => void, BuiltContent, string[]]>([
    [
      'an extra page for a story build-info does not list',
      (o) => o.html.set(playerPath('en', 'other-story'), playerPage('en')),
      CONTENT,
      [
        `[player-pages] unexpected ${playerPath('en', 'other-story')} (build-info lists no story other-story)`,
      ],
    ],
    [
      'a missing hi page',
      (o) => o.html.delete(playerPath('hi', 'two-paths')),
      CONTENT,
      [`[player-pages] missing ${playerPath('hi', 'two-paths')}`],
    ],
    [
      'a page under a disabled locale',
      (o) => o.html.set(playerPath('ar', 'two-paths'), playerPage('ar')),
      CONTENT,
      [`[player-pages] unexpected ${playerPath('ar', 'two-paths')} (ar is not an enabled locale)`],
    ],
    [
      'a hi page for an en-only package (C8)',
      () => undefined,
      contentOf([FIXTURES[0]!, FIXTURES[1]!, EN_ONLY]),
      [
        `[player-pages] unexpected ${playerPath('hi', 'two-paths')} (package two-paths has no hi text)`,
      ],
    ],
    [
      'a page with two mains',
      (o) => {
        const path = playerPath('en', 'lantern-walk')
        o.html.set(
          path,
          (o.html.get(path) ?? '').replace('</main>', '</main><main id="main"></main>'),
        )
      },
      CONTENT,
      [`[player-pages] ${playerPath('en', 'lantern-walk')}: <main id="main" 2 time(s)`],
    ],
    [
      'a page with main#main and a second main without an id (two main landmarks, F1)',
      (o) => {
        const path = playerPath('en', 'lantern-walk')
        o.html.set(path, (o.html.get(path) ?? '').replace('</main>', '</main><main></main>'))
      },
      CONTENT,
      [`[player-pages] ${playerPath('en', 'lantern-walk')}: <main 2 time(s)`],
    ],
    [
      'a page with main#main and a second main with other attributes (F1)',
      (o) => {
        const path = playerPath('hi', 'two-paths')
        o.html.set(
          path,
          (o.html.get(path) ?? '').replace('</main>', '</main><main\nclass="x" id="other"></main>'),
        )
      },
      CONTENT,
      [`[player-pages] ${playerPath('hi', 'two-paths')}: <main 2 time(s)`],
    ],
    [
      'a page with main#main and a second main landmark written as role="main" (R2-G1-7)',
      (o) => {
        const path = playerPath('en', 'two-paths')
        o.html.set(
          path,
          (o.html.get(path) ?? '').replace('</main>', '</main><div role="main">x</div>'),
        )
      },
      CONTENT,
      [`[player-pages] ${playerPath('en', 'two-paths')}: <main 2 time(s)`],
    ],
    [
      'a page with a role="main" element inside main#main (R2-G1-7)',
      (o) => {
        const path = playerPath('hi', 'river-stones')
        o.html.set(
          path,
          (o.html.get(path) ?? '').replace('</main>', '<section\nrole="main"></section></main>'),
        )
      },
      CONTENT,
      [`[player-pages] ${playerPath('hi', 'river-stones')}: <main 2 time(s)`],
    ],
    [
      'a page whose only main is <main id="main-x"> (not counted, C8)',
      (o) => o.html.set(playerPath('hi', 'lantern-walk'), playerPage('hi', '<main id="main-x">')),
      CONTENT,
      [`[player-pages] ${playerPath('hi', 'lantern-walk')}: <main id="main" 0 time(s)`],
    ],
    [
      'a page whose main has no id',
      (o) => o.html.set(playerPath('hi', 'lantern-walk'), playerPage('hi', '<main tabindex="-1">')),
      CONTENT,
      [`[player-pages] ${playerPath('hi', 'lantern-walk')}: <main id="main" 0 time(s)`],
    ],
    [
      'a page whose html lang is wrong',
      (o) => o.html.set(playerPath('hi', 'river-stones'), playerPage('en')),
      CONTENT,
      [`[player-pages] ${playerPath('hi', 'river-stones')}: <html lang> is not hi`],
    ],
  ])('fails %s', (_name, edit, content, failures) => {
    const output = changed(OPEN_PLAYERS, edit)
    expect(checkPlayerPages(output, OPEN, content).failures).toEqual(failures)
  })

  it.each([
    ['class first', '<main class="x_main" tabindex="-1" id="main">'],
    ['id last before >', '<main tabindex="-1" class="x_main" id="main">'],
    ['a line break before id', '<main class="x_main"\nid="main">'],
    ['a main that also says role="main" (R2-G1-7)', '<main id="main" role="main" tabindex="-1">'],
  ])('counts a main whose attributes come in another order once: %s (C8)', (_name, main) => {
    const output = changed(OPEN_PLAYERS, (o) => {
      o.html.set(playerPath('en', 'river-stones'), playerPage('en', main))
    })
    expect(checkPlayerPages(output, OPEN, CONTENT)).toEqual(report([], 6, 6))
  })

  it.each([
    ['a <mainly> element', '<mainly>x</mainly>'],
    ['a custom <main-menu> element', '<main-menu>x</main-menu>'],
    ['escaped text that names a main', '<p>&lt;main id="main"&gt;</p>'],
    ['escaped text that names a role', '<p>&lt;div role=&quot;main&quot;&gt;</p>'],
    ['another role', '<div role="mainland">x</div><div data-role="main">x</div>'],
  ])('does not count %s as a second main (F1)', (_name, extra) => {
    const output = changed(OPEN_PLAYERS, (o) => {
      const path = playerPath('en', 'two-paths')
      o.html.set(path, (o.html.get(path) ?? '').replace('</main>', `${extra}</main>`))
    })
    expect(checkPlayerPages(output, OPEN, CONTENT)).toEqual(report([], 6, 6))
  })

  it('fails any player page in a gated build, with or without content', () => {
    const output = changed(withPlayers(gatedOutput(), FIXTURES), (o) => {
      o.html.set(playerPath('en', 'two-paths'), playerPage('en'))
    })
    for (const content of [CONTENT, NO_CONTENT]) {
      expect(checkPlayerPages(output, GATED, content)).toEqual(
        report([`[player-pages] gated build has ${playerPath('en', 'two-paths')}`], 1, 0),
      )
    }
  })

  it('fails a player page in an open build without content', () => {
    expect(checkPlayerPages(withPlayers(openOutput(), [TWO_PATHS]), OPEN, NO_CONTENT)).toEqual(
      report(
        [
          `[player-pages] unexpected ${playerPath('en', 'two-paths')} (build-info lists no story two-paths)`,
          `[player-pages] unexpected ${playerPath('hi', 'two-paths')} (build-info lists no story two-paths)`,
        ],
        2,
        0,
      ),
    )
  })

  it('needs the player pattern entry in an open build with at least one story', () => {
    const output = changed(OPEN_PLAYERS, (o) => {
      delete o.manifest.dynamicRoutes![PLAYER_PATTERN]
    })
    expect(checkBuild(output, OPEN, CATALOGUE, contentOf([TWO_PATHS])).failures).toEqual([
      '[dynamic-routes] dynamicRoutes has no /[locale]/stories/[storyId]/read entry (design R23)',
    ])
    // Not without a story, and not while gated.
    expect(checkBuild(openOutput(), OPEN, CATALOGUE, contentOf([])).failures).toEqual([])
    expect(checkBuild(openOutput(), OPEN, CATALOGUE).failures).toEqual([])
    expect(checkBuild(gatedOutput(), GATED, CATALOGUE, CONTENT).failures).toEqual([])
  })

  it('names a package that could not be read, and expects an unknown count', () => {
    const content: BuiltContent = {
      storyIds: ['two-paths'],
      packages: [],
      problems: ['.content/packages/two-paths.json is missing'],
    }
    expect(checkPlayerPages(withPlayers(openOutput(), [TWO_PATHS]), OPEN, content)).toEqual(
      report(['[player-pages] .content/packages/two-paths.json is missing'], 2, null),
    )
  })

  it('prints one value-free line, in the design §8 form', () => {
    expect(playerLine(6, 6, 110)).toBe(
      'player pages: 6 (expected 6); package text values scanned: 110',
    )
    expect(playerLine(null, null, null)).toBe(
      'player pages: unknown (expected unknown); package text values scanned: unknown',
    )
  })
})

describe('[landing-pages] (T12-25, Step 12; design p1-step12-design.md §3.16 N17)', () => {
  const CONTENT = contentOf(FIXTURES)
  const OPEN_STORIES = withStories(openOutput(), FIXTURES)
  const report = (failures: string[], pages: number, expected: number | null) => ({
    failures,
    pages,
    expected,
  })

  it('(g1) passes an open build with one landing per listed story and enabled locale (6)', () => {
    expect
      .soft(checkLandingPages(OPEN_STORIES, OPEN, CONTENT), '(g1) 6 of 6')
      .toEqual(report([], 6, 6))
    expect
      .soft(checkBuild(OPEN_STORIES, OPEN, CATALOGUE, CONTENT).failures, '(g1) the full check')
      .toEqual([])
  })

  it('(g2) expects no landing while gated, or without content; a landing in a gated build fails', () => {
    const gated = withStories(gatedOutput(), FIXTURES)
    expect
      .soft(checkLandingPages(gated, GATED, CONTENT), '(g2) gated 0 of 0')
      .toEqual(report([], 0, 0))
    expect
      .soft(checkLandingPages(openOutput(), OPEN, NO_CONTENT), '(g2) no content')
      .toEqual(report([], 0, 0))
    expect
      .soft(checkLandingPages(openOutput(), OPEN, contentOf([])), '(g2) no story')
      .toEqual(report([], 0, 0))
    const stray = changed(gated, (o) => {
      o.html.set(landingPath('en', 'two-paths'), landingPage('en'))
    })
    for (const content of [CONTENT, NO_CONTENT]) {
      expect
        .soft(checkLandingPages(stray, GATED, content), '(g2) a gated landing')
        .toEqual(
          report([`[landing-pages] gated build has ${landingPath('en', 'two-paths')}`], 1, 0),
        )
    }
  })

  it('(g3) expects only the enabled locales of each package ([en, hi, ar] gives 2)', () => {
    const output = withStories(openOutput(), [SAMPLE])
    expect
      .soft(checkLandingPages(output, OPEN, contentOf([SAMPLE])), '(g3) 2 of 2')
      .toEqual(report([], 2, 2))
  })

  it.each<[string, (o: { html: Map<string, string> }) => void, BuiltContent, string[]]>([
    [
      'an extra landing for a story build-info does not list',
      (o) => o.html.set(landingPath('en', 'other-story'), landingPage('en')),
      CONTENT,
      [
        `[landing-pages] unexpected ${landingPath('en', 'other-story')} (build-info lists no story other-story)`,
      ],
    ],
    [
      'a missing hi landing',
      (o) => o.html.delete(landingPath('hi', 'two-paths')),
      CONTENT,
      [`[landing-pages] missing ${landingPath('hi', 'two-paths')}`],
    ],
    [
      'a landing under a disabled locale',
      (o) => o.html.set(landingPath('ar', 'two-paths'), landingPage('ar')),
      CONTENT,
      [
        `[landing-pages] unexpected ${landingPath('ar', 'two-paths')} (ar is not an enabled locale)`,
      ],
    ],
    [
      'a hi landing for an en-only package',
      () => undefined,
      contentOf([FIXTURES[0]!, FIXTURES[1]!, EN_ONLY]),
      [
        `[landing-pages] unexpected ${landingPath('hi', 'two-paths')} (package two-paths has no hi text)`,
      ],
    ],
    [
      'a landing with two main#main',
      (o) => {
        const path = landingPath('en', 'lantern-walk')
        o.html.set(
          path,
          (o.html.get(path) ?? '').replace('</main>', '</main><main id="main"></main>'),
        )
      },
      CONTENT,
      [`[landing-pages] ${landingPath('en', 'lantern-walk')}: <main id="main" 2 time(s)`],
    ],
    [
      'a second main landmark as <div data-x role="main">',
      (o) => {
        const path = landingPath('en', 'two-paths')
        o.html.set(
          path,
          (o.html.get(path) ?? '').replace('</main>', '</main><div data-x role="main">x</div>'),
        )
      },
      CONTENT,
      [`[landing-pages] ${landingPath('en', 'two-paths')}: <main 2 time(s)`],
    ],
    [
      'a second main landmark as <section role="main" id="x">',
      (o) => {
        const path = landingPath('hi', 'river-stones')
        o.html.set(
          path,
          (o.html.get(path) ?? '').replace(
            '</main>',
            '<section role="main" id="x"></section></main>',
          ),
        )
      },
      CONTENT,
      [`[landing-pages] ${landingPath('hi', 'river-stones')}: <main 2 time(s)`],
    ],
    [
      'a landing whose main has no id="main"',
      (o) =>
        o.html.set(landingPath('hi', 'lantern-walk'), landingPage('hi', '<main tabindex="-1">')),
      CONTENT,
      [`[landing-pages] ${landingPath('hi', 'lantern-walk')}: <main id="main" 0 time(s)`],
    ],
    [
      'a landing whose html lang is not its locale',
      (o) => o.html.set(landingPath('hi', 'river-stones'), landingPage('en')),
      CONTENT,
      [`[landing-pages] ${landingPath('hi', 'river-stones')}: <html lang> is not hi`],
    ],
  ])('(g4) fails %s', (_name, edit, content, failures) => {
    const output = changed(OPEN_STORIES, edit)
    expect
      .soft(checkLandingPages(output, OPEN, content).failures, '(g4) the failure')
      .toEqual(failures)
  })

  it.each([
    ['a player page', 'en/stories/two-paths/read.html'],
    ['a folder named like stories', 'en/storiesx/two-paths.html'],
    ['the stories folder as a page', 'en/stories.html'],
    ['another extension', 'en/stories/two-paths.htm'],
    ['a deeper page', 'en/stories/two-paths/x.html'],
  ])('(g6) does not count %s as a landing', (_name, path) => {
    const output = changed(OPEN_STORIES, (o) => {
      o.html.set(path, landingPage('en'))
    })
    expect.soft(checkLandingPages(output, OPEN, CONTENT), `(g6) ${path}`).toEqual(report([], 6, 6))
  })

  it('(g7) needs the landing pattern entry in an open build with at least one story', () => {
    const output = changed(OPEN_STORIES, (o) => {
      delete o.manifest.dynamicRoutes![LANDING_PATTERN]
    })
    expect
      .soft(checkBuild(output, OPEN, CATALOGUE, contentOf([TWO_PATHS])).failures, '(g7) open')
      .toEqual([
        '[dynamic-routes] dynamicRoutes has no /[locale]/stories/[storyId] entry (design R23)',
      ])
    expect.soft(LANDING_PATTERN, '(g7) the pattern').toBe('/[locale]/stories/[storyId]')
    // Not without a story, and not while gated.
    expect
      .soft(checkBuild(openOutput(), OPEN, CATALOGUE, contentOf([])).failures, '(g7) no story')
      .toEqual([])
    expect
      .soft(checkBuild(gatedOutput(), GATED, CATALOGUE, CONTENT).failures, '(g7) gated')
      .toEqual([])
  })

  it('(g8) prints one value-free line, in the design §3.16 form', () => {
    expect.soft(landingLine(6, 6), '(g8) counts').toBe('landing pages: 6 (expected 6)')
    expect
      .soft(landingLine(null, null), '(g8) unknown')
      .toBe('landing pages: unknown (expected unknown)')
  })
})

describe('readBuiltContent (P1-4b)', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A root with these package files and a build-info listing `listed`. */
  function rootWith(files: Record<string, string | Uint8Array>, listed: readonly StoryPackageV1[]) {
    const root = mkdtempSync(join(tmpdir(), 'check-build-content-'))
    dirs.push(root)
    mkdirSync(join(root, '.content', 'packages'), { recursive: true })
    for (const [id, bytes] of Object.entries(files)) {
      writeFileSync(join(root, '.content', 'packages', `${id}.json`), bytes)
    }
    const stories = listed.map((pkg) => ({
      storyId: pkg.storyId,
      version: pkg.version,
      packageSha256: 'b'.repeat(64),
    }))
    return { root, info: jcsBytes(buildInfo('fixtures', stories)) }
  }

  it('reads every listed package in build-info order, strictly parsed', () => {
    const [lantern, river, two] = FIXTURES as [StoryPackageV1, StoryPackageV1, StoryPackageV1]
    const { root, info } = rootWith(
      Object.fromEntries(FIXTURES.map((pkg) => [pkg.storyId, jcsBytes(pkg)])),
      [two, lantern, river],
    )
    expect(readBuiltContent(root, info)).toEqual({
      storyIds: ['two-paths', 'lantern-walk', 'river-stones'],
      packages: [two, lantern, river],
      problems: [],
    })
  })

  it('is no content without a build-info, or with one that is not strictly valid', () => {
    const { root } = rootWith({ 'two-paths': jcsBytes(TWO_PATHS) }, [TWO_PATHS])
    expect(readBuiltContent(root, null)).toEqual(NO_CONTENT)
    expect(readBuiltContent(root, new TextEncoder().encode('{'))).toEqual(NO_CONTENT)
    expect(readBuiltContent(root, jcsBytes({ ...buildInfo('fixtures'), extra: 1 }))).toEqual(
      NO_CONTENT,
    )
  })

  it('names a missing, non-strict or mismatched package by file, never a value', () => {
    const secret = ['a', 'secret', 'value'].join('_')
    const other = variant(TWO_PATHS, (d) => {
      d.storyId = 'other-story'
    })
    const { root, info } = rootWith(
      {
        'two-paths': JSON.stringify({ ...TWO_PATHS, extra: secret }),
        'river-stones': jcsBytes(other),
        'lantern-walk': `{"__proto__":{"x":"${secret}"}}`,
      },
      [TWO_PATHS, FIXTURES[1]!, FIXTURES[0]!, EN_ONLY],
    )
    const content = readBuiltContent(root, info)
    expect(content).toEqual({
      storyIds: ['two-paths', 'river-stones', 'lantern-walk', 'two-paths'],
      packages: [],
      problems: [
        '.content/packages/two-paths.json failed strict parse',
        '.content/packages/river-stones.json names another storyId',
        '.content/packages/lantern-walk.json failed strict parse',
        '.content/packages/two-paths.json failed strict parse',
      ],
    })
    expect(JSON.stringify(content)).not.toContain(secret)
    rmSync(join(root, '.content', 'packages', 'two-paths.json'))
    expect(readBuiltContent(root, info).problems[0]).toBe(
      '.content/packages/two-paths.json is missing',
    )
  })
})

describe('[package-text-leak] (C-3, P1-4b, design p1-step10-design.md §9.1 G2)', () => {
  const CONTENT = contentOf([SAMPLE])
  /** openOutput() with one more chunk holding `js`. */
  const leak = (js: string) =>
    changed(openOutput(), (o) => {
      o.staticJs.set('chunks/leak.js', js)
    })
  /** Design §8 names a node's field "node <id> field <f>" and a package field "node - field <f>". */
  const where = (field: string): string => {
    const [, node, name] = /^nodes\.([^.]+)\.(.+)$/.exec(field) ?? []
    return node === undefined ? `node - field ${field}` : `node ${node} field ${name}`
  }
  const holds = (locale: string, field: string, note = '') =>
    `[package-text-leak] .next/static/chunks/leak.js: storyId two-paths locale ${locale} ${where(field)}${note}`
  const valueOf = (locale: string, field: string): string => {
    const value = packageTextValues(SAMPLE).find((v) => v.locale === locale && v.field === field)
    if (!value) throw new Error(`no value ${locale} ${field}`)
    return value.line
  }
  const START = 'nodes.start.text'

  it('passes the fixtures against the sample chunks: 110 values scanned', () => {
    expect(checkPackageTextLeak(openOutput(), contentOf(FIXTURES))).toEqual({
      failures: [],
      values: 110,
    })
  })

  it('reads every text field in every locale of the package, split on "\\n", 16 code units or more', () => {
    const values = packageTextValues(SAMPLE)
    const fields = new Set(values.map((v) => `${v.locale} ${v.field}`))
    for (const field of [
      'en title',
      'en description',
      'en theme',
      'en duration',
      'en book',
      `en alt.${ALT_ID}`,
      `en ${START}`,
      'en nodes.start.question',
      'en nodes.start.choices.c1',
      'en nodes.start.choices.c2',
      'en nodes.ending_wise.lesson',
      'hi title',
      `hi ${START}`,
      'hi nodes.wise_path.text',
      'hi nodes.ending_quick.lesson',
      'ar title', // a locale of the package that is not enabled
      `ar ${START}`,
      `ar alt.${ALT_ID}`,
    ]) {
      expect(fields, field).toContain(field)
    }
    expect(values.filter((v) => v.locale === 'en' && v.field === START).map((v) => v.line)).toEqual(
      [
        'First line of the opening passage.',
        'Second line: it\'s a "quoted" word.',
        'Third line holds </b> markup.',
        '16 units: kept!!',
      ],
    )
    expect(values.every((v) => v.line.length >= MIN_LEAK_LENGTH && !v.line.includes('\n'))).toBe(
      true,
    )
    expect(values.map((v) => v.line)).not.toContain('15 units, short')
  })

  it.each<[string, () => string, string[]]>([
    ['the raw line', () => `var a="${valueOf('hi', 'title')}";`, [holds('hi', 'title')]],
    [
      'the line \\u-escaped in lower case',
      () => `var a="${escapeNonAscii(valueOf('hi', 'title'), false)}";`,
      [holds('hi', 'title', ' (\\u-escaped)')],
    ],
    [
      'the line \\u-escaped in upper case',
      () => `var a="${escapeNonAscii(valueOf('hi', 'title'), true)}";`,
      [holds('hi', 'title', ' (\\u-escaped)')],
    ],
    [
      'one passage line without the rest of the passage',
      () => 'var a="Third line holds </b> markup.";',
      [holds('en', START)],
    ],
    [
      'a line next to an escaped newline (the whole passage as a JS string)',
      () =>
        `var a=${JSON.stringify(SAMPLE.text.en!.nodes.start!.text.split('\n').slice(0, 3).join('\n'))};`,
      [holds('en', START), holds('en', START, ' (JSON-escaped)')],
    ],
    [
      'a value with " written \\"',
      () => `var a=${JSON.stringify('Second line: it\'s a "quoted" word.')};`,
      [holds('en', START, ' (JSON-escaped)')],
    ],
    [
      '’ written \\u2019',
      () => 'var a="Which way isn\\u2019t the long way home?";',
      [holds('en', 'nodes.start.question', ' (\\u-escaped)')],
    ],
    [
      'an emoji-led choice as a surrogate-pair escape, lower case',
      () => 'var a="\\ud83d\\udc22 Take the slow and steady path";',
      [holds('en', 'nodes.start.choices.c1', ' (\\u-escaped)')],
    ],
    [
      'an emoji-led choice as a surrogate-pair escape, upper case',
      () => 'var a="\\uD83D\\uDC07 Run the quick path now";',
      [holds('en', 'nodes.start.choices.c2', ' (\\u-escaped)')],
    ],
    [
      "a line with ' written \\' (a single-quoted string, C9)",
      () => "var a='Second line: it\\'s a \"quoted\" word.';",
      [holds('en', START, " (with \\')")],
    ],
    [
      'a line with </ written <\\/ (C9)',
      () => 'var a="Third line holds <\\/b> markup.";',
      [holds('en', START, ' (with <\\/)')],
    ],
    [
      'a line of a locale that is not enabled',
      () => `var a="${valueOf('ar', 'title')}";`,
      [holds('ar', 'title')],
    ],
  ])('fails %s', (_name, js, failures) => {
    const report = checkPackageTextLeak(leak(js()), CONTENT)
    expect(report.failures).toEqual(failures)
    expect(report.values).toBe(packageTextValues(SAMPLE).length)
  })

  it.each([
    ['en', 'title'],
    ['en', 'description'],
    ['en', 'theme'],
    ['en', 'duration'],
    ['en', 'book'],
    ['en', `alt.${ALT_ID}`],
    ['en', 'nodes.start.question'],
    ['en', 'nodes.start.choices.c1'],
    ['en', 'nodes.ending_wise.lesson'],
    ['hi', START],
    ['hi', 'nodes.wise_path.text'],
    ['hi', 'nodes.ending_quick.lesson'],
  ])('fails a raw %s %s line', (locale, field) => {
    expect(checkPackageTextLeak(leak(`/*${valueOf(locale, field)}*/`), CONTENT).failures).toContain(
      holds(locale, field),
    )
  })

  it('names ids and files only, never the text', () => {
    const line = valueOf('hi', START)
    const { failures } = checkPackageTextLeak(leak(`var a="${line}";`), CONTENT)
    expect(failures).toEqual([holds('hi', START)])
    expect(failures.join('\n')).not.toContain(line)
    // The design §8 form, written out once without the helper.
    expect(failures).toEqual([
      '[package-text-leak] .next/static/chunks/leak.js: storyId two-paths locale hi node start field text',
    ])
    expect(
      checkPackageTextLeak(leak(`var a="${valueOf('en', 'title')}";`), CONTENT).failures,
    ).toEqual([
      '[package-text-leak] .next/static/chunks/leak.js: storyId two-paths locale en node - field title',
    ])
  })

  // F4: the crossings of the forms a minifier can write. Each sample line holds what makes its
  // crossing differ from every simpler form, so the note names the crossing.
  const CROSS = variant(TWO_PATHS, (d) => {
    d.text.en!.nodes.start!.text = [
      'He wrote "</b>" on the old stone wall.',
      "It's the fox’s turn now, said the crow.",
      "It's </i> the end of the old road.",
      'रवि ने "</b>" लिखा और चला गया।',
    ].join('\n')
  })
  const crossLine = (index: number): string => CROSS.text.en!.nodes.start!.text.split('\n')[index]!
  const crossHolds = (note: string) =>
    `[package-text-leak] .next/static/chunks/leak.js: storyId two-paths locale en node start field text${note}`

  it.each<[string, () => string, string]>([
    [
      'the JSON-escaped line with every </ written <\\/',
      () => `var a=${JSON.stringify(crossLine(0)).replace(/<\//g, '<\\/')};`,
      ' (JSON-escaped with <\\/)',
    ],
    [
      "the line with every ' written \\', \\u-escaped (a single-quoted ASCII-only string)",
      () => `var a='${escapeNonAscii(crossLine(1).replace(/'/g, "\\'"), false)}';`,
      " (with \\', \\u-escaped)",
    ],
    [
      "the line with every ' written \\' and every </ written <\\/",
      () => `var a='${crossLine(2).replace(/'/g, "\\'").replace(/<\//g, '<\\/')}';`,
      " (with \\' and <\\/)",
    ],
    [
      'the JSON-escaped line with </ written <\\/, \\u-escaped in upper case',
      () =>
        `var a="${escapeNonAscii(JSON.stringify(crossLine(3)).slice(1, -1).replace(/<\//g, '<\\/'), true)}";`,
      ' (JSON-escaped with <\\/, \\u-escaped)',
    ],
  ])('fails a crossing of forms: %s (F4)', (_name, js, note) => {
    expect(checkPackageTextLeak(leak(js()), contentOf([CROSS])).failures).toEqual([
      crossHolds(note),
    ])
  })

  it('ignores lines shorter than 16 code units', () => {
    const short = FIXTURES.flatMap((pkg) =>
      Object.values(pkg.text).flatMap((t) =>
        [
          t!.title,
          t!.theme,
          t!.duration,
          t!.book,
          ...Object.values(t!.nodes).flatMap((n) => [n.text, ...Object.values(n.choices ?? {})]),
        ].flatMap((v) => v.split('\n')),
      ),
    ).filter((line) => line.length < MIN_LEAK_LENGTH)
    expect(short.length).toBeGreaterThan(0)
    const js = `var s=[${[...short, '15 units, short'].map((s) => JSON.stringify(s)).join(',')}];`
    expect(checkPackageTextLeak(leak(js), contentOf([...FIXTURES, SAMPLE])).failures).toEqual([])
  })

  it('passes an empty build-info with 0 values, and fails a listed story with none scanned', () => {
    expect(checkPackageTextLeak(openOutput(), contentOf([]))).toEqual({ failures: [], values: 0 })
    expect(checkPackageTextLeak(openOutput(), NO_CONTENT)).toEqual({ failures: [], values: 0 })
    const unread: BuiltContent = { storyIds: ['two-paths', 'x-y'], packages: [], problems: ['p'] }
    expect(checkPackageTextLeak(openOutput(), unread)).toEqual({
      failures: ['[package-text-leak] content is loaded but 0 values were scanned'],
      values: 0,
    })
  })

  it('documented limit: a line split across concatenated string literals is not found', () => {
    const js = 'var a="First line of the "+"opening passage.";'
    expect(checkPackageTextLeak(leak(js), CONTENT).failures).toEqual([])
  })

  it('builds each form once, with the note a failure carries', () => {
    expect(packageTextForms('plain ASCII line here')).toEqual([['plain ASCII line here', '']])
    expect(packageTextForms('it\'s </b> "x" पेज')).toEqual([
      ['it\'s </b> "x" पेज', ''],
      ['it\'s </b> "x" \\u092a\\u0947\\u091c', ' (\\u-escaped)'],
      ['it\'s </b> "x" \\u092A\\u0947\\u091C', ' (\\u-escaped)'],
      ['it\'s </b> \\"x\\" पेज', ' (JSON-escaped)'],
      ['it\'s </b> \\"x\\" \\u092a\\u0947\\u091c', ' (JSON- and \\u-escaped)'],
      ['it\'s </b> \\"x\\" \\u092A\\u0947\\u091C', ' (JSON- and \\u-escaped)'],
      ['it\\\'s </b> "x" पेज', " (with \\')"],
      ['it\\\'s </b> "x" \\u092a\\u0947\\u091c', " (with \\', \\u-escaped)"],
      ['it\\\'s </b> "x" \\u092A\\u0947\\u091C', " (with \\', \\u-escaped)"],
      ['it\'s <\\/b> "x" पेज', ' (with <\\/)'],
      ['it\'s <\\/b> "x" \\u092a\\u0947\\u091c', ' (with <\\/, \\u-escaped)'],
      ['it\'s <\\/b> "x" \\u092A\\u0947\\u091C', ' (with <\\/, \\u-escaped)'],
      ['it\'s <\\/b> \\"x\\" पेज', ' (JSON-escaped with <\\/)'],
      ['it\'s <\\/b> \\"x\\" \\u092a\\u0947\\u091c', ' (JSON-escaped with <\\/, \\u-escaped)'],
      ['it\'s <\\/b> \\"x\\" \\u092A\\u0947\\u091C', ' (JSON-escaped with <\\/, \\u-escaped)'],
      ['it\\\'s <\\/b> "x" पेज', " (with \\' and <\\/)"],
      ['it\\\'s <\\/b> "x" \\u092a\\u0947\\u091c', " (with \\' and <\\/, \\u-escaped)"],
      ['it\\\'s <\\/b> "x" \\u092A\\u0947\\u091C', " (with \\' and <\\/, \\u-escaped)"],
    ])
  })
})

describe('runCheckBuild on files', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A storyboard-shaped folder holding `output` under .next and the real catalogues. */
  /**
   * `layout` 'route-cache' writes each page the way Next 16.4.5 does when a deployment adapter is
   * set (Vercel): .next/server/route-cache/APP_PAGE/<one folder per source route>/$/<path>.html.
   */
  /**
   * `content` writes the loader's outputs for that mode (.content/build-info.json and its public
   * copy), as a fixtures or storage build has them; null writes none (CONTENT_SOURCE none or unset).
   * `packages` are written to .content/packages/<id>.json and listed in build-info, in that order.
   */
  function writeRoot(
    output: BuildOutput,
    catalogues = true,
    layout: 'app' | 'route-cache' = 'app',
    content: GateMode | null = null,
    packages: readonly StoryPackageV1[] = [],
  ): string {
    const root = mkdtempSync(join(tmpdir(), 'check-build-'))
    dirs.push(root)
    const write = (path: string, text: string | Uint8Array) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
    }
    if (content !== null) {
      const stories = packages.map((pkg) => {
        const bytes = jcsBytes(pkg)
        write(join(root, '.content', 'packages', `${pkg.storyId}.json`), bytes)
        const packageSha256 = createHash('sha256').update(bytes).digest('hex')
        return { storyId: pkg.storyId, version: pkg.version, packageSha256 }
      })
      const bytes = jcsBytes(buildInfo(content, stories))
      write(join(root, '.content', 'build-info.json'), bytes)
      write(join(root, 'public', 'build-info.json'), bytes)
    }
    if (output.manifest !== undefined)
      write(join(root, '.next', 'prerender-manifest.json'), output.manifest)
    for (const [path, html] of output.html) {
      const source = `source-${path.replace(/\.html$/, '').replace(/\//g, '-')}`
      write(
        layout === 'app'
          ? join(root, '.next', 'server', 'app', path)
          : join(root, '.next', 'server', 'route-cache', 'APP_PAGE', source, '$', path),
        html,
      )
    }
    for (const [path, js] of output.staticJs) write(join(root, '.next', 'static', path), js)
    write(join(root, '.next', 'server', 'app', 'index.rsc'), 'not html')
    if (catalogues) {
      for (const locale of ['en', 'hi']) {
        const values = Object.fromEntries(
          CATALOGUE.filter((v) => v.locale === locale).map((v) => [v.key, v.value]),
        )
        write(join(root, 'messages', `${locale}.json`), JSON.stringify(values))
      }
    }
    return root
  }

  /** `platform` is passed only when given, so the default (process.platform) is also exercised. */
  function run(root: string, env: Record<string, string | undefined>, platform?: string) {
    const out: string[] = []
    const err: string[] = []
    const code = runCheckBuild({
      root,
      env,
      ...(platform === undefined ? {} : { platform }),
      log: (l) => out.push(l),
      logError: (l) => err.push(l),
    })
    return { code, out, err }
  }

  it('passes a gated build and prints the launch line once, then the summary line', () => {
    const result = run(writeRoot(gatedOutput()), {
      VERCEL_ENV: 'production',
      CONTENT_SOURCE: 'none',
    })
    expect(result).toEqual({
      code: 0,
      out: [
        'reader launch: gated (committed); locale routes: 0',
        'content mode: none; staging banner pages: 0 of 2',
        ...NO_PLAYER_LINES,
        'check-build: ok',
      ],
      err: [],
    })
  })

  it('passes an open build', () => {
    const result = run(writeRoot(openOutput(), true, 'app', 'fixtures'), {
      CONTENT_SOURCE: 'fixtures',
      READER_LAUNCH: 'review',
    })
    expect(result.code).toBe(0)
    expect(result.out).toEqual([
      'reader launch: open (review); locale routes: 4',
      'content mode: fixtures; staging banner pages: 0 of 6',
      ...NO_PLAYER_LINES,
      'check-build: ok',
    ])
  })

  it('reads the route-cache layout a deployment adapter produces (Vercel), gated and open', () => {
    const gated = run(writeRoot(gatedOutput(), true, 'route-cache'), {
      VERCEL: '1',
      VERCEL_ENV: 'production',
      CONTENT_SOURCE: 'none',
    })
    expect(gated).toEqual({
      code: 0,
      out: [
        'reader launch: gated (committed); locale routes: 0',
        'content mode: none; staging banner pages: 0 of 2',
        ...NO_PLAYER_LINES,
        'check-build: ok',
      ],
      err: [],
    })
    const open = run(writeRoot(openOutput(), true, 'route-cache', 'fixtures'), {
      CONTENT_SOURCE: 'fixtures',
      READER_LAUNCH: 'review',
    })
    expect(open.code).toBe(0)
    // The rules still run on route-cache pages: a gate link on the otherwise valid gated "/" fails
    // with exactly that rule.
    const linked = gatedOutput()
    const root = writeRoot(
      {
        ...linked,
        html: new Map([
          ...linked.html,
          ['index.html', `${linked.html.get('index.html') ?? ''}<a href="/en">English</a>`],
        ]),
      },
      true,
      'route-cache',
    )
    expect(run(root, { VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' }).err).toEqual([
      'check-build failed [gate] index.html links to /en',
    ])
  })

  /** Writes `html` as <path> in a route-cache source folder `source` under `root`. */
  function writeRouteCache(root: string, source: string, path: string, html: string): void {
    const dir = join(root, '.next', 'server', 'route-cache', 'APP_PAGE', source, '$')
    mkdirSync(dirname(join(dir, path)), { recursive: true }) // a player page path has folders
    writeFileSync(join(dir, path), html)
  }

  it('reads a byte-identical copy as one page (next start writes served pages to route-cache)', () => {
    const output = gatedOutput()
    const root = writeRoot(output)
    for (const name of ['index.html', '_not-found.html']) {
      writeRouteCache(root, `copy-${name}`, name, output.html.get(name) ?? '')
    }
    writeRouteCache(root, 'second-copy', 'index.html', output.html.get('index.html') ?? '')
    expect(run(root, { VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' })).toEqual({
      code: 0,
      out: [
        'reader launch: gated (committed); locale routes: 0',
        'content mode: none; staging banner pages: 0 of 2',
        ...NO_PLAYER_LINES,
        'check-build: ok',
      ],
      err: [],
    })
  })

  it('fails when one page has two different files, across layouts or route-cache folders', () => {
    const across = writeRoot(gatedOutput())
    writeRouteCache(across, 'other', 'index.html', '<main></main>')
    const acrossResult = run(across, { VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' })
    expect(acrossResult.code).toBe(1)
    expect(acrossResult.out).toEqual([
      'reader launch: gated (committed)',
      'content mode: none; staging banner pages: unknown',
      ...UNREAD_PLAYER_LINES,
    ])
    expect(acrossResult.err).toEqual([
      'check-build failed [read] two different prerendered files for index.html (server/route-cache)',
    ])
    const within = writeRoot(gatedOutput(), true, 'route-cache')
    writeRouteCache(within, 'zz-second-source', 'index.html', '<main></main>')
    expect(run(within, { VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' }).err).toEqual([
      'check-build failed [read] two different prerendered files for index.html (server/route-cache)',
    ])
  })

  it('exits 1 naming the rule when the environment disagrees with the output', () => {
    const result = run(writeRoot(gatedOutput(), true, 'app', 'fixtures'), {
      CONTENT_SOURCE: 'fixtures',
      READER_LAUNCH: 'review',
    })
    expect(result.code).toBe(1)
    expect(result.out).toEqual([
      'reader launch: open (review); locale routes: 0',
      'content mode: fixtures; staging banner pages: 0 of 2',
      ...NO_PLAYER_LINES,
    ])
    expect(result.err).toEqual([
      expect.stringContaining(`check-build failed [state-agreement] ${DISAGREEMENT_HINT}`),
    ])
  })

  it('exits 1 when the build output is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-build-'))
    dirs.push(root)
    const result = run(root, {})
    expect(result.code).toBe(1)
    expect(result.out).toEqual([
      'reader launch: gated (committed); locale routes: unknown',
      'content mode: none; staging banner pages: 0 of 0',
      ...NO_PLAYER_LINES,
    ])
    expect(result.err).toEqual([
      'check-build failed [catalogue] messages/ is missing',
      'check-build failed [files] missing .next/prerender-manifest.json',
      'check-build failed [files] missing the prerendered index.html',
    ])
  })

  it('exits 1 when a catalogue is not a flat object of strings', () => {
    const root = writeRoot(gatedOutput())
    writeFileSync(join(root, 'messages', 'hi.json'), JSON.stringify({ 'a.b': 1 }))
    const result = run(root, {})
    expect(result.code).toBe(1)
    expect(result.err[0]).toBe(
      'check-build failed [catalogue] messages/hi.json is not a flat object of strings',
    )
  })

  it('[content-outputs]: a gated build with a stray build-info fails, naming the rule', () => {
    const root = writeRoot(gatedOutput(), true, 'app', 'fixtures')
    const result = run(root, { VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' })
    expect(result).toEqual({
      code: 1,
      out: [
        'reader launch: gated (committed); locale routes: 0',
        'content mode: fixtures; staging banner pages: 0 of 2',
        ...NO_PLAYER_LINES,
      ],
      err: [
        'check-build failed [content-outputs] .content/ exists, but CONTENT_SOURCE is none',
        'check-build failed [content-outputs] public/build-info.json exists, but CONTENT_SOURCE is none',
      ],
    })
  })

  it('[content-outputs]: a fixtures build without its outputs fails', () => {
    const result = run(writeRoot(openOutput()), {
      CONTENT_SOURCE: 'fixtures',
      READER_LAUNCH: 'review',
    })
    expect(result.code).toBe(1)
    expect(result.err).toEqual([
      'check-build failed [content-outputs] missing .content/build-info.json (CONTENT_SOURCE=fixtures)',
      'check-build failed [content-outputs] missing public/build-info.json (CONTENT_SOURCE=fixtures)',
    ])
  })

  it('[content-outputs]: runs even when the build output is unreadable', () => {
    // A staging build-info with banners on its pages; win32 (this PC) passes the second lock.
    const root = writeRoot(staged(gatedOutput()), true, 'app', 'staging')
    mkdirSync(join(root, '.next', 'server', 'route-cache', 'APP_PAGE', 'x', '$'), {
      recursive: true,
    })
    writeFileSync(
      join(root, '.next', 'server', 'route-cache', 'APP_PAGE', 'x', '$', 'index.html'),
      '<main></main>',
    )
    const result = run(root, { CONTENT_SOURCE: 'none' }, 'win32')
    expect(result.out).toEqual([
      'reader launch: gated (committed)',
      'content mode: staging; staging banner pages: unknown',
      ...UNREAD_PLAYER_LINES,
    ])
    expect(result.err).toEqual([
      'check-build failed [read] two different prerendered files for index.html (server/route-cache)',
      'check-build failed [content-outputs] .content/ exists, but CONTENT_SOURCE is none',
      'check-build failed [content-outputs] public/build-info.json exists, but CONTENT_SOURCE is none',
    ])
    // [staging-banner]'s second lock still runs without a readable output (Linux, no Preview).
    expect(run(root, { CONTENT_SOURCE: 'none' }, 'linux').err.at(-1)).toBe(
      `check-build failed [staging-banner] content mode is staging, but ${STAGING_REFUSED_HERE}`,
    )
  })

  it('reads the content outputs by the output-layout names', () => {
    const none = writeRoot(gatedOutput())
    expect(readContentOutputs(none)).toEqual({
      contentDir: false,
      contentBuildInfo: null,
      publicBuildInfoExists: false,
      publicBuildInfo: null,
    })
    const loaded = writeRoot(gatedOutput(), true, 'app', 'fixtures')
    const bytes = new Uint8Array(jcsBytes(buildInfo('fixtures')))
    expect(readContentOutputs(loaded)).toEqual({
      contentDir: true,
      contentBuildInfo: bytes,
      publicBuildInfoExists: true,
      publicBuildInfo: bytes,
    })
    // A folder where a file belongs exists but has no bytes.
    const folder = writeRoot(gatedOutput())
    mkdirSync(join(folder, 'public', 'build-info.json'), { recursive: true })
    expect(readContentOutputs(folder)).toMatchObject({
      publicBuildInfoExists: true,
      publicBuildInfo: null,
    })
  })

  // ---- [staging-banner] and the summary line (P1-2c, design p1-step9-design.md §4.5, §10.1) ----

  it.each(['app', 'route-cache'] as const)(
    'passes a staging build, open and gated, in the %s layout',
    (layout) => {
      // The CI staging leg and preview:staging: a simulated Preview, on Linux.
      const open = run(writeRoot(staged(openOutput()), true, layout, 'staging'), PREVIEW, 'linux')
      expect(open).toEqual({
        code: 0,
        out: [
          'reader launch: open (review); locale routes: 4',
          'content mode: staging; staging banner pages: 6 of 6',
          ...NO_PLAYER_LINES,
          'check-build: ok',
        ],
        err: [],
      })
      // The gated harness: on this PC, and in GitHub Actions on Linux.
      for (const [env, platform] of [
        [LOCAL_STAGING, 'win32'],
        [{ ...LOCAL_STAGING, GITHUB_ACTIONS: 'true' }, 'linux'],
      ] as const) {
        const root = writeRoot(staged(gatedOutput()), true, layout, 'staging')
        expect(run(root, env, platform)).toEqual({
          code: 0,
          out: [
            'reader launch: gated (committed); locale routes: 0',
            'content mode: staging; staging banner pages: 2 of 2',
            ...NO_PLAYER_LINES,
            'check-build: ok',
          ],
          err: [],
        })
      }
    },
  )

  it.each(['app', 'route-cache'] as const)(
    'fails a staging page without its banner in the %s layout, and still prints the summary line',
    (layout) => {
      const output = staged(openOutput())
      const html = new Map(output.html)
      html.set('hi/grown-ups.html', openOutput().html.get('hi/grown-ups.html') ?? '')
      const root = writeRoot({ ...output, html }, true, layout, 'staging')
      expect(run(root, PREVIEW, 'linux')).toEqual({
        code: 1,
        out: [
          'reader launch: open (review); locale routes: 4',
          'content mode: staging; staging banner pages: 5 of 6',
          ...NO_PLAYER_LINES,
        ],
        err: [
          `check-build failed [staging-banner] hi/grown-ups.html: expected exactly one banner (found 0 ${STAGING_BANNER_MARKER})`,
        ],
      })
    },
  )

  it('fails a staging build where the loader would refuse a staging pointer (the second lock)', () => {
    const lock = `check-build failed [staging-banner] content mode is staging, but ${STAGING_REFUSED_HERE}`
    const cases: [Env, string][] = [
      [{ ...LOCAL_STAGING, VERCEL_ENV: 'production' }, 'linux'],
      [{ ...LOCAL_STAGING, VERCEL: '1', VERCEL_ENV: 'production' }, 'win32'],
      [LOCAL_STAGING, 'linux'], // the Step 8 blind spot: Linux, no Vercel variables, no CI
      [LOCAL_STAGING, 'darwin'],
      [{ ...LOCAL_STAGING, VERCEL: '1' }, 'linux'],
    ]
    for (const [env, platform] of cases) {
      const root = writeRoot(staged(gatedOutput()), true, 'app', 'staging')
      const result = run(root, env, platform)
      expect(result.code, JSON.stringify([env, platform])).toBe(1)
      expect(result.out).toEqual([
        'reader launch: gated (committed); locale routes: 0',
        'content mode: staging; staging banner pages: 2 of 2',
        ...NO_PLAYER_LINES,
      ])
      expect(result.err).toEqual([lock])
    }
  })

  it('defaults the platform to process.platform', () => {
    const root = writeRoot(staged(gatedOutput()), true, 'app', 'staging')
    expect(run(root, LOCAL_STAGING).code).toBe(process.platform === 'win32' ? 0 : 1)
  })

  it('prints the summary line for each mode, invalid included, and never a value', () => {
    const production = run(writeRoot(gatedOutput(), true, 'app', 'production'), {
      CONTENT_SOURCE: 'storage',
      VERCEL_ENV: 'production',
    })
    expect(production).toEqual({
      code: 0,
      out: [
        'reader launch: gated (committed); locale routes: 0',
        'content mode: production; staging banner pages: 0 of 2',
        ...NO_PLAYER_LINES,
        'check-build: ok',
      ],
      err: [],
    })

    const secret = ['not', 'a', 'mode'].join('_')
    const invalid = writeRoot(openOutput(), true, 'app', 'fixtures')
    for (const path of [join('.content', 'build-info.json'), join('public', 'build-info.json')]) {
      writeFileSync(join(invalid, path), `{"mode":"${secret}"}`)
    }
    const result = run(invalid, { CONTENT_SOURCE: 'fixtures', READER_LAUNCH: 'review' })
    expect(result).toEqual({
      code: 1,
      out: [
        'reader launch: open (review); locale routes: 4',
        'content mode: invalid; staging banner pages: 0 of 6',
        ...NO_PLAYER_LINES,
      ],
      err: ['check-build failed [content-outputs] .content/build-info.json failed strict parse'],
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('fails a banner in a build of any other mode, in the page and in client JS', () => {
    const output = changed(gatedOutput(), (o) => {
      o.html.set('_not-found.html', withBanner(o.html.get('_not-found.html') ?? ''))
      o.staticJs.set('chunks/banner.js', `var b=${JSON.stringify(STAGING_BANNER_TEXT)};`)
    })
    const result = run(writeRoot(output), { VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' })
    expect(result).toEqual({
      code: 1,
      out: [
        'reader launch: gated (committed); locale routes: 0',
        'content mode: none; staging banner pages: 1 of 2',
        ...NO_PLAYER_LINES,
      ],
      err: [
        `check-build failed [staging-banner] _not-found.html: holds ${STAGING_BANNER_ATTRIBUTE} 2 time(s), but content mode is none (only a staging build has the banner)`,
        'check-build failed [staging-banner] _not-found.html: holds the banner text, but content mode is none',
        'check-build failed [staging-banner] .next/static/chunks/banner.js holds the banner text',
      ],
    })
  })

  // ---- [player-pages] and [package-text-leak] on files (P1-4b, design p1-step10 §9.1, §10.1) ----

  const REVIEW: Env = { CONTENT_SOURCE: 'fixtures', READER_LAUNCH: 'review' }
  const REVIEW_LINES = [
    'reader launch: open (review); locale routes: 16',
    'content mode: fixtures; staging banner pages: 0 of 18',
    'player pages: 6 (expected 6); package text values scanned: 110',
    'landing pages: 6 (expected 6)',
  ]

  it.each(['app', 'route-cache'] as const)(
    'passes a review build with its 6 player pages and 6 landings in the %s layout (a page only in route-cache counts)',
    (layout) => {
      const root = writeRoot(
        withStories(openOutput(), FIXTURES),
        true,
        layout,
        'fixtures',
        FIXTURES,
      )
      expect(run(root, REVIEW)).toEqual({
        code: 0,
        out: [...REVIEW_LINES, 'check-build: ok'],
        err: [],
      })
    },
  )

  it('passes the CI checks build (gated, fixtures loaded): no player page, every value scanned', () => {
    const root = writeRoot(withStories(gatedOutput(), FIXTURES), true, 'app', 'fixtures', FIXTURES)
    expect(run(root, { CONTENT_SOURCE: 'fixtures' })).toEqual({
      code: 0,
      out: [
        'reader launch: gated (committed); locale routes: 0',
        'content mode: fixtures; staging banner pages: 0 of 2',
        'player pages: 0 (expected 0); package text values scanned: 110',
        'landing pages: 0 (expected 0)',
        'check-build: ok',
      ],
      err: [],
    })
  })

  it('counts a byte-identical route-cache copy of a player page once', () => {
    const output = withStories(openOutput(), FIXTURES)
    const root = writeRoot(output, true, 'app', 'fixtures', FIXTURES)
    const path = playerPath('en', 'two-paths')
    writeRouteCache(root, 'player-copy', path, output.html.get(path) ?? '')
    expect(run(root, REVIEW)).toEqual({
      code: 0,
      out: [...REVIEW_LINES, 'check-build: ok'],
      err: [],
    })
  })

  it('a player page only in the route-cache layout counts, beside the app layout', () => {
    const output = withStories(openOutput(), FIXTURES)
    const path = playerPath('hi', 'river-stones')
    const html = new Map(output.html)
    html.delete(path)
    const root = writeRoot({ ...output, html }, true, 'app', 'fixtures', FIXTURES)
    writeRouteCache(root, 'player-only-here', path, output.html.get(path) ?? '')
    expect(run(root, REVIEW)).toEqual({
      code: 0,
      out: [...REVIEW_LINES, 'check-build: ok'],
      err: [],
    })
  })

  it('fails two different copies of one player page, and prints the player lines as unknown', () => {
    const output = withStories(openOutput(), FIXTURES)
    const root = writeRoot(output, true, 'app', 'fixtures', FIXTURES)
    const path = playerPath('en', 'two-paths')
    writeRouteCache(
      root,
      'player-other',
      path,
      playerPage('en').replace('<h1>x</h1>', '<h1>y</h1>'),
    )
    expect(run(root, REVIEW)).toEqual({
      code: 1,
      out: [
        'reader launch: open (review)',
        'content mode: fixtures; staging banner pages: unknown',
        'player pages: unknown (expected 6); package text values scanned: unknown',
        'landing pages: unknown (expected 6)',
      ],
      err: [
        `check-build failed [read] two different prerendered files for ${path} (server/route-cache)`,
      ],
    })
  })

  it('fails a listed package that is missing or not strict, naming the file and no value', () => {
    const output = withStories(openOutput(), [TWO_PATHS])
    const root = writeRoot(output, true, 'app', 'fixtures', [TWO_PATHS])
    const file = join(root, '.content', 'packages', 'two-paths.json')
    const secret = ['not', 'a', 'story', 'value'].join('_')
    writeFileSync(file, JSON.stringify({ ...TWO_PATHS, extra: secret }))
    const strict = run(root, REVIEW)
    expect(strict).toEqual({
      code: 1,
      out: [
        'reader launch: open (review); locale routes: 8',
        'content mode: fixtures; staging banner pages: 0 of 10',
        'player pages: 2 (expected unknown); package text values scanned: 0',
        'landing pages: 2 (expected unknown)',
      ],
      err: [
        'check-build failed [player-pages] .content/packages/two-paths.json failed strict parse',
        'check-build failed [package-text-leak] content is loaded but 0 values were scanned',
      ],
    })
    expect(JSON.stringify(strict)).not.toContain(secret)
    rmSync(file)
    expect(run(root, REVIEW).err).toEqual([
      'check-build failed [player-pages] .content/packages/two-paths.json is missing',
      'check-build failed [package-text-leak] content is loaded but 0 values were scanned',
    ])
  })

  it('fails a leak of package text into .next/static, naming the file and ids only', () => {
    const output = withStories(openOutput(), FIXTURES)
    const line = packageTextValues(TWO_PATHS).find(
      (v) => v.locale === 'hi' && v.field === 'nodes.start.text',
    )!
    const leaked = changed(output, (o) => {
      o.staticJs.set('chunks/player.js', `var t="${escapeNonAscii(line.line, true)}";`)
    })
    const result = run(writeRoot(leaked, true, 'app', 'fixtures', FIXTURES), REVIEW)
    expect(result).toEqual({
      code: 1,
      out: REVIEW_LINES,
      err: [
        `check-build failed [package-text-leak] .next/static/chunks/player.js: storyId two-paths locale hi node start field text (\\u-escaped)`,
      ],
    })
    expect(JSON.stringify(result)).not.toContain(line.line)
  })
})

describe('[landing-pages] on files (T12-25 g5, g8)', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const REVIEW: Env = { CONTENT_SOURCE: 'fixtures', READER_LAUNCH: 'review' }

  /** The review output with its packages, written in `layout` (as the runCheckBuild tests do). */
  function root(output: BuildOutput, layout: 'app' | 'route-cache'): string {
    const dir = mkdtempSync(join(tmpdir(), 'check-build-landing-'))
    dirs.push(dir)
    const write = (path: string, text: string | Uint8Array) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
    }
    const stories = FIXTURES.map((pkg) => {
      const bytes = jcsBytes(pkg)
      write(join(dir, '.content', 'packages', `${pkg.storyId}.json`), bytes)
      return {
        storyId: pkg.storyId,
        version: pkg.version,
        packageSha256: createHash('sha256').update(bytes).digest('hex'),
      }
    })
    const info = jcsBytes(buildInfo('fixtures', stories))
    write(join(dir, '.content', 'build-info.json'), info)
    write(join(dir, 'public', 'build-info.json'), info)
    write(join(dir, '.next', 'prerender-manifest.json'), output.manifest ?? '')
    for (const [path, html] of output.html) {
      const source = `source-${path.replace(/\.html$/, '').replace(/\//g, '-')}`
      write(
        layout === 'app'
          ? join(dir, '.next', 'server', 'app', path)
          : join(dir, '.next', 'server', 'route-cache', 'APP_PAGE', source, '$', path),
        html,
      )
    }
    for (const [path, js] of output.staticJs) write(join(dir, '.next', 'static', path), js)
    for (const locale of ['en', 'hi']) {
      const values = Object.fromEntries(
        CATALOGUE.filter((v) => v.locale === locale).map((v) => [v.key, v.value]),
      )
      write(join(dir, 'messages', `${locale}.json`), JSON.stringify(values))
    }
    return dir
  }

  function run(dir: string) {
    const out: string[] = []
    const err: string[] = []
    const code = runCheckBuild({
      root: dir,
      env: REVIEW,
      log: (l) => out.push(l),
      logError: (l) => err.push(l),
    })
    return { code, out, err }
  }

  it.each(['app', 'route-cache'] as const)(
    '(g5, g8) %s: each failure is found, and the landing line follows the player line on a failing run',
    (layout) => {
      const missing = landingPath('hi', 'two-paths')
      const wrongLang = landingPath('hi', 'river-stones')
      const twoMains = landingPath('en', 'lantern-walk')
      const extra = landingPath('en', 'other-story')
      const output = changed(withStories(openOutput(), FIXTURES), (o) => {
        o.html.delete(missing)
        o.html.set(wrongLang, landingPage('en'))
        o.html.set(
          twoMains,
          (o.html.get(twoMains) ?? '').replace('</main>', '</main><main id="main"></main>'),
        )
        o.html.set(extra, landingPage('en'))
      })
      const result = run(root(output, layout))
      expect.soft(result.code, `(g5) ${layout}: exit 1`).toBe(1)
      expect
        .soft(result.out.slice(2), `(g8) ${layout}: the player line, then the landing line`)
        .toEqual([
          'player pages: 6 (expected 6); package text values scanned: 110',
          'landing pages: 6 (expected 6)',
        ])
      expect
        .soft(result.err, `(g5) ${layout}: the failures, files and ids only`)
        .toEqual([
          `check-build failed [html-lang] ${wrongLang} has no <html lang="hi"`,
          `check-build failed [landing-pages] ${twoMains}: <main id="main" 2 time(s)`,
          `check-build failed [landing-pages] unexpected ${extra} (build-info lists no story other-story)`,
          `check-build failed [landing-pages] ${wrongLang}: <html lang> is not hi`,
          `check-build failed [landing-pages] missing ${missing}`,
        ])
    },
  )
})

describe('[staging-banner] (P1-2c): checkStagingBanner', () => {
  const PAGES = [
    '_not-found.html',
    'en.html',
    'en/grown-ups.html',
    'hi.html',
    'hi/grown-ups.html',
    'index.html',
  ]

  it('passes a staging build: gated (index, _not-found) and open (plus en, hi, both Grown-ups)', () => {
    const gated = staged(gatedOutput())
    expect(checkStagingBanner(gated, 'staging', LOCAL_STAGING, 'win32')).toEqual({
      failures: [],
      pages: 2,
      withBanner: 2,
    })
    expect(failuresOf(gated, GATED_STAGING)).toEqual([])
    const open = staged(openOutput())
    expect(checkStagingBanner(open, 'staging', PREVIEW, 'linux')).toEqual({
      failures: [],
      pages: 6,
      withBanner: 6,
    })
    expect(failuresOf(open, OPEN_STAGING)).toEqual([])
  })

  it('counts the flight copy of the attribute as no banner, and ignores _global-error.html', () => {
    const output = changed(staged(openOutput()), (o) => {
      // Next's own 500 page: a banner there is neither required nor counted.
      o.html.set('_global-error.html', GLOBAL_ERROR.replace('<body>', `<body>${BANNER}${BANNER}`))
    })
    expect(checkStagingBanner(output, 'staging', PREVIEW, 'linux')).toEqual({
      failures: [],
      pages: 6,
      withBanner: 6,
    })
    const page = output.html.get('en.html') ?? ''
    expect(page.split(STAGING_BANNER_ATTRIBUTE)).toHaveLength(3) // the element and its flight copy
    const other = changed(gatedOutput(), (o) => {
      o.html.set('_global-error.html', GLOBAL_ERROR.replace('<body>', `<body>${BANNER}`))
    })
    expect(checkStagingBanner(other, null, {}, 'linux')).toEqual({
      failures: [],
      pages: 2,
      withBanner: 0,
    })
  })

  const banner = (attributes: string, text = STAGING_BANNER_TEXT, tag = 'p') =>
    `<${tag} ${attributes}>${text}</${tag}>`

  it.each<[string, (html: string) => string, string]>([
    [
      'a missing banner',
      (html) => html.replace(BANNER, ''),
      `expected exactly one banner (found 0 ${STAGING_BANNER_MARKER})`,
    ],
    [
      'two banners',
      (html) => html.replace(BANNER, `${BANNER}${BANNER}`),
      `expected exactly one banner (found 2 ${STAGING_BANNER_MARKER})`,
    ],
    [
      'the wrong text (a hyphen for the en dash)',
      (html) => html.replace(BANNER, BANNER.replace('–', '-')),
      'the banner text is not STAGING_BANNER_TEXT (src/ui/root/staging.ts)',
    ],
    [
      'the text in lower case',
      (html) => html.replace(BANNER, BANNER.replace('UNAPPROVED', 'Unapproved')),
      'the banner text is not STAGING_BANNER_TEXT (src/ui/root/staging.ts)',
    ],
    [
      'no lang="en"',
      (html) => html.replace(BANNER, banner(`${STAGING_BANNER_MARKER} class="x_banner"`)),
      'the banner has no lang="en"',
    ],
    [
      'lang="hi"',
      (html) => html.replace(BANNER, banner(`${STAGING_BANNER_MARKER} lang="hi"`)),
      'the banner has no lang="en"',
    ],
    [
      'a <div> instead of a <p>',
      (html) =>
        html.replace(BANNER, banner(`${STAGING_BANNER_MARKER} lang="en"`, undefined, 'div')),
      'the banner is not a <p> element holding only text (found 0 such elements)',
    ],
    [
      'markup inside the <p>',
      (html) =>
        html.replace(
          BANNER,
          banner(`${STAGING_BANNER_MARKER} lang="en"`, `<span>${STAGING_BANNER_TEXT}</span>`),
        ),
      'the banner is not a <p> element holding only text (found 0 such elements)',
    ],
    [
      'the banner inside <main',
      (html) => html.replace(BANNER, '').replace(/<main[^>]*>/, (main) => `${main}${BANNER}`),
      'the banner comes after the first <main',
    ],
    [
      'the banner after a <header>',
      (html) => html.replace(BANNER, `<header><b>x</b></header>${BANNER}`),
      'the banner comes after the first <header',
    ],
    [
      'the banner after a skip link',
      (html) => html.replace(BANNER, `<a href="#main">Skip</a>${BANNER}`),
      'the banner comes after the first <a',
    ],
  ])('fails a staging page with %s, naming the file', (_name, edit, message) => {
    for (const path of PAGES) {
      const output = changed(staged(openOutput()), (o) => {
        o.html.set(path, edit(o.html.get(path) ?? ''))
      })
      expect(checkStagingBanner(output, 'staging', PREVIEW, 'linux').failures, path).toEqual([
        `[staging-banner] ${path}: ${message}`,
      ])
    }
  })

  it.each(['index.html', '_not-found.html'])(
    'fails a gated staging %s without its banner',
    (path) => {
      const output = changed(staged(gatedOutput()), (o) => {
        o.html.set(path, gatedOutput().html.get(path) ?? '')
      })
      expect(checkStagingBanner(output, 'staging', LOCAL_STAGING, 'win32')).toEqual({
        failures: [
          `[staging-banner] ${path}: expected exactly one banner (found 0 ${STAGING_BANNER_MARKER})`,
        ],
        pages: 2,
        withBanner: 1,
      })
    },
  )

  const OTHER_MODES: ContentMode[] = ['fixtures', 'production', null, 'invalid']

  describe.each(OTHER_MODES)('content mode %s', (mode) => {
    const name = mode ?? 'none'
    const attribute = (path: string, n: number) =>
      `[staging-banner] ${path}: holds ${STAGING_BANNER_ATTRIBUTE} ${n} time(s), but content mode is ${name} (only a staging build has the banner)`
    const text = (path: string, escaped = false) =>
      `[staging-banner] ${path}: holds the banner text${escaped ? ' (\\u-escaped)' : ''}, but content mode is ${name}`

    it('passes without a banner, gated and open', () => {
      for (const output of [gatedOutput(), openOutput()]) {
        expect(checkStagingBanner(output, mode, PREVIEW, 'linux').failures).toEqual([])
      }
    })

    it.each<[string, string, (path: string) => string[]]>([
      ['the marker', `<b ${STAGING_BANNER_MARKER}></b>`, (path) => [attribute(path, 1)]],
      [
        'the flight copy of the attribute',
        BANNER_FLIGHT.replace(STAGING_BANNER_TEXT, 'x'),
        (path) => [attribute(path, 1)],
      ],
      ['the raw text', `<b>${STAGING_BANNER_TEXT}</b>`, (path) => [text(path)]],
      [
        'the \\u2013-escaped text',
        `<script>var t="${escapeNonAscii(STAGING_BANNER_TEXT, false)}"</script>`,
        (path) => [text(path, true)],
      ],
      ['the whole banner', BANNER, (path) => [attribute(path, 1), text(path)]],
    ])('fails a page holding %s, naming the file', (_what, extra, expected) => {
      for (const path of ['index.html', '_not-found.html', 'en/grown-ups.html']) {
        const output = changed(openOutput(), (o) => {
          o.html.set(path, (o.html.get(path) ?? '').replace('</body>', `${extra}</body>`))
        })
        expect(checkStagingBanner(output, mode, PREVIEW, 'linux').failures, path).toEqual(
          expected(path),
        )
      }
    })
  })

  it.each<ContentMode>(['staging', ...OTHER_MODES])(
    'fails the banner text or attribute in .next/static JS in content mode %s',
    (mode) => {
      const base = mode === 'staging' ? staged(openOutput()) : openOutput()
      const cases: [string, string][] = [
        [`var b=${JSON.stringify(STAGING_BANNER_TEXT)};`, 'holds the banner text'],
        [
          `var b="${escapeNonAscii(STAGING_BANNER_TEXT, true)}";`,
          'holds the banner text (\\u-escaped)',
        ],
        [`var a="${STAGING_BANNER_ATTRIBUTE}";`, `holds ${STAGING_BANNER_ATTRIBUTE}`],
      ]
      for (const [js, message] of cases) {
        const output = changed(base, (o) => {
          o.staticJs.set('chunks/leak.js', js)
        })
        expect(checkStagingBanner(output, mode, PREVIEW, 'linux').failures).toEqual([
          `[staging-banner] .next/static/chunks/leak.js ${message}`,
        ])
      }
    },
  )

  it('applies the loader’s own predicate as the second lock, so the two never drift apart', () => {
    const lock = `[staging-banner] content mode is staging, but ${STAGING_REFUSED_HERE}`
    const output = staged(gatedOutput())
    const envs: Env[] = [
      {},
      { VERCEL_ENV: 'preview' },
      { VERCEL: '1', VERCEL_ENV: 'preview' },
      { VERCEL_ENV: 'production' },
      { VERCEL_ENV: 'production', GITHUB_ACTIONS: 'true' },
      { VERCEL_ENV: 'development' },
      { VERCEL_ENV: '' },
      { VERCEL: '1' },
      { VERCEL: '' },
      { GITHUB_ACTIONS: 'true' },
      { GITHUB_ACTIONS: '1' },
    ]
    let refused = 0
    for (const env of envs) {
      for (const platform of ['win32', 'linux', 'darwin']) {
        const failures = checkStagingBanner(output, 'staging', env, platform).failures
        const allowed = stagingPointerAllowed(env, platform)
        expect(failures, JSON.stringify([env, platform])).toEqual(allowed ? [] : [lock])
        if (!allowed) refused++
        // The lock is for staging only: no other mode fails on the environment.
        for (const mode of OTHER_MODES) {
          expect(checkStagingBanner(gatedOutput(), mode, env, platform).failures).toEqual([])
        }
      }
    }
    expect(refused).toBeGreaterThan(0)
    // The design's named cases.
    expect(
      checkStagingBanner(output, 'staging', { VERCEL_ENV: 'preview' }, 'linux').failures,
    ).toEqual([])
    expect(
      checkStagingBanner(output, 'staging', { GITHUB_ACTIONS: 'true' }, 'linux').failures,
    ).toEqual([])
    expect(
      checkStagingBanner(output, 'staging', { VERCEL_ENV: 'production' }, 'win32').failures,
    ).toEqual([lock])
    expect(checkStagingBanner(output, 'staging', {}, 'linux').failures).toEqual([lock])
  })

  it('never echoes an environment value', () => {
    const value = ['some', 'vercel', 'value'].join('_')
    const failures = checkStagingBanner(
      staged(gatedOutput()),
      'staging',
      { VERCEL: value, VERCEL_ENV: value },
      'linux',
    ).failures
    expect(failures).toHaveLength(1)
    expect(JSON.stringify(failures)).not.toContain(value)
  })
})

describe('readContentMode and the summary line (P1-2c)', () => {
  const text = (value: string) => new TextEncoder().encode(value)

  it('reads the mode the loader wrote, null without a file, invalid for anything else', () => {
    expect(readContentMode(null)).toBeNull()
    for (const mode of GATE_MODES) {
      expect(readContentMode(new Uint8Array(jcsBytes(buildInfo(mode))))).toBe(mode)
    }
    expect(readContentMode(text(''))).toBe('invalid')
    expect(readContentMode(text('{'))).toBe('invalid')
    expect(readContentMode(text('{"mode":"staging"}'))).toBe('invalid')
    expect(readContentMode(jcsBytes({ ...buildInfo('staging'), extra: 1 }))).toBe('invalid')
    expect(readContentMode(jcsBytes({ ...buildInfo('staging'), mode: 'preview' }))).toBe('invalid')
  })

  it('is enums and counts only', () => {
    expect(contentModeLine(null, { pages: 2, withBanner: 0 })).toBe(
      'content mode: none; staging banner pages: 0 of 2',
    )
    expect(contentModeLine('staging', { pages: 6, withBanner: 6 })).toBe(
      'content mode: staging; staging banner pages: 6 of 6',
    )
    expect(contentModeLine('invalid', null)).toBe(
      'content mode: invalid; staging banner pages: unknown',
    )
  })
})

/** A strict build-info record of this mode (a Storage mode needs at least one GET). */
function buildInfo(mode: GateMode, stories: BuildInfo['stories'] = []): BuildInfo {
  return {
    schemaVersion: '1.0',
    mode,
    seq: 1,
    pointerPath: mode === 'fixtures' ? 'catalogue/fixtures.json' : `catalogue/${mode}.json`,
    snapshotPath: 'catalogue/snapshots/1.json',
    snapshotSha256: 'a'.repeat(64),
    featuredStoryId: null,
    stories,
    excluded: [],
    appVersion: null,
    deploymentId: null,
    deploymentUrl: null,
    builtAt: '2026-11-15T00:00:00.000Z',
    fetches:
      mode === 'fixtures'
        ? []
        : [
            {
              path: `catalogue/${mode}.json`,
              status: 200,
              cfCacheStatus: null,
              age: null,
              pop: null,
              sha256: null,
              ms: 1,
            },
          ],
  }
}

describe('[content-outputs] (C-2): content outputs exist exactly when content was loaded', () => {
  const bytesOf = (mode: GateMode) => new Uint8Array(jcsBytes(buildInfo(mode)))
  const NONE: ContentOutputs = {
    contentDir: false,
    contentBuildInfo: null,
    publicBuildInfoExists: false,
    publicBuildInfo: null,
  }
  const loaded = (mode: GateMode): ContentOutputs => ({
    contentDir: true,
    contentBuildInfo: bytesOf(mode),
    publicBuildInfoExists: true,
    publicBuildInfo: bytesOf(mode),
  })

  describe.each([
    [undefined, 'unset'],
    ['', 'empty'],
    ['none', 'none'],
  ])('CONTENT_SOURCE %j (%s)', (source, name) => {
    it('passes with no outputs', () => {
      expect(checkContentOutputs(source, NONE)).toEqual([])
    })

    it('fails on a stray .content/', () => {
      expect(checkContentOutputs(source, { ...NONE, contentDir: true })).toEqual([
        `[content-outputs] .content/ exists, but CONTENT_SOURCE is ${name}`,
      ])
    })

    it('fails on a stray public/build-info.json, a file or not', () => {
      const expected = [
        `[content-outputs] public/build-info.json exists, but CONTENT_SOURCE is ${name}`,
      ]
      expect(
        checkContentOutputs(source, {
          ...NONE,
          publicBuildInfoExists: true,
          publicBuildInfo: bytesOf('fixtures'),
        }),
      ).toEqual(expected)
      expect(checkContentOutputs(source, { ...NONE, publicBuildInfoExists: true })).toEqual(
        expected,
      )
    })

    it('fails on both, naming each', () => {
      expect(checkContentOutputs(source, loaded('fixtures'))).toEqual([
        `[content-outputs] .content/ exists, but CONTENT_SOURCE is ${name}`,
        `[content-outputs] public/build-info.json exists, but CONTENT_SOURCE is ${name}`,
      ])
    })
  })

  it.each<[string, GateMode]>([
    ['fixtures', 'fixtures'],
    ['storage', 'production'],
    ['storage', 'staging'],
  ])('CONTENT_SOURCE=%s passes with equal %s build-info copies', (source, mode) => {
    expect(checkContentOutputs(source, loaded(mode))).toEqual([])
  })

  it.each<[string, GateMode, string]>([
    [
      'fixtures',
      'staging',
      'build-info mode is staging, but CONTENT_SOURCE=fixtures needs fixtures',
    ],
    [
      'fixtures',
      'production',
      'build-info mode is production, but CONTENT_SOURCE=fixtures needs fixtures',
    ],
    [
      'storage',
      'fixtures',
      'build-info mode is fixtures, but CONTENT_SOURCE=storage needs production or staging',
    ],
  ])('CONTENT_SOURCE=%s fails on a %s build-info', (source, mode, message) => {
    expect(checkContentOutputs(source, loaded(mode))).toEqual([`[content-outputs] ${message}`])
  })

  it.each(['fixtures', 'storage'])('CONTENT_SOURCE=%s fails on a missing copy', (source) => {
    const mode: GateMode = source === 'fixtures' ? 'fixtures' : 'staging'
    expect(checkContentOutputs(source, { ...loaded(mode), contentBuildInfo: null })).toEqual([
      `[content-outputs] missing .content/build-info.json (CONTENT_SOURCE=${source})`,
    ])
    expect(
      checkContentOutputs(source, {
        ...loaded(mode),
        publicBuildInfoExists: false,
        publicBuildInfo: null,
      }),
    ).toEqual([`[content-outputs] missing public/build-info.json (CONTENT_SOURCE=${source})`])
    expect(checkContentOutputs(source, NONE)).toEqual([
      `[content-outputs] missing .content/build-info.json (CONTENT_SOURCE=${source})`,
      `[content-outputs] missing public/build-info.json (CONTENT_SOURCE=${source})`,
    ])
  })

  it('fails on copies that differ by one byte', () => {
    const other = bytesOf('fixtures')
    other[other.length - 2] = other[other.length - 2] === 0x30 ? 0x31 : 0x30
    expect(
      checkContentOutputs('fixtures', { ...loaded('fixtures'), publicBuildInfo: other }),
    ).toEqual(['[content-outputs] .content/build-info.json and public/build-info.json differ'])
  })

  it('fails on equal copies that are not JSON or fail the strict parse', () => {
    const text = (value: string) => new TextEncoder().encode(value)
    const with_ = (bytes: Uint8Array): ContentOutputs => ({
      ...loaded('fixtures'),
      contentBuildInfo: bytes,
      publicBuildInfo: bytes,
    })
    expect(checkContentOutputs('fixtures', with_(text('{')))).toEqual([
      '[content-outputs] .content/build-info.json is not valid JSON',
    ])
    expect(
      checkContentOutputs('fixtures', with_(jcsBytes({ ...buildInfo('fixtures'), extra: 1 }))),
    ).toEqual(['[content-outputs] .content/build-info.json failed strict parse'])
  })

  it('fails on any other CONTENT_SOURCE without echoing it', () => {
    const value = ['some', 'other', 'value'].join('_')
    const failures = checkContentOutputs(value, loaded('fixtures'))
    expect(failures).toEqual(['[content-outputs] CONTENT_SOURCE is not storage, fixtures or none'])
    expect(JSON.stringify(failures)).not.toContain(value)
  })
})
