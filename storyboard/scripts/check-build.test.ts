// The post-build check (design p1-step7-design.md §5.7 item 2, §8.1 item 11; P1-1c). The sample
// outputs are shaped on real Step 7 builds (Next 16.4.5, Turbopack): the prerender-manifest keys and
// entries, and the head, <main> and script markup of index.html, the locale pages and the 404.
// P1-2b (design p1-step8-design.md §3.3 C-2, §10.1): the [content-outputs] truth table.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveLaunch, type LaunchDecision } from '../src/config/launch'
import type { BuildInfo } from '../src/core/content/build-info'
import type { GateMode } from '../src/core/content/gates'
import { jcsBytes } from '../src/core/hashing'
import { LOCALE_REDIRECT_SCRIPT } from '../src/core/progress/locale-redirect-boot'
import {
  checkBuild,
  checkContentOutputs,
  COMING_SOON_MAIN,
  DISAGREEMENT_HINT,
  escapeNonAscii,
  leakForms,
  readCatalogues,
  readContentOutputs,
  ROBOTS_META,
  runCheckBuild,
  type BuildOutput,
  type CatalogueValue,
  type ContentOutputs,
} from './check-build'

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
   */
  function writeRoot(
    output: BuildOutput,
    catalogues = true,
    layout: 'app' | 'route-cache' = 'app',
    content: GateMode | null = null,
  ): string {
    const root = mkdtempSync(join(tmpdir(), 'check-build-'))
    dirs.push(root)
    const write = (path: string, text: string | Uint8Array) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
    }
    if (content !== null) {
      const bytes = jcsBytes(buildInfo(content))
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

  function run(root: string, env: Record<string, string | undefined>) {
    const out: string[] = []
    const err: string[] = []
    const code = runCheckBuild({ root, env, log: (l) => out.push(l), logError: (l) => err.push(l) })
    return { code, out, err }
  }

  it('passes a gated build and prints the launch line once', () => {
    const result = run(writeRoot(gatedOutput()), {
      VERCEL_ENV: 'production',
      CONTENT_SOURCE: 'none',
    })
    expect(result).toEqual({
      code: 0,
      out: ['reader launch: gated (committed); locale routes: 0', 'check-build: ok'],
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
      out: ['reader launch: gated (committed); locale routes: 0', 'check-build: ok'],
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
    mkdirSync(dir, { recursive: true })
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
      out: ['reader launch: gated (committed); locale routes: 0', 'check-build: ok'],
      err: [],
    })
  })

  it('fails when one page has two different files, across layouts or route-cache folders', () => {
    const across = writeRoot(gatedOutput())
    writeRouteCache(across, 'other', 'index.html', '<main></main>')
    const acrossResult = run(across, { VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' })
    expect(acrossResult.code).toBe(1)
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
    expect(result.out).toEqual(['reader launch: open (review); locale routes: 0'])
    expect(result.err).toEqual([
      expect.stringContaining(`check-build failed [state-agreement] ${DISAGREEMENT_HINT}`),
    ])
  })

  it('exits 1 when the build output is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-build-'))
    dirs.push(root)
    const result = run(root, {})
    expect(result.code).toBe(1)
    expect(result.out).toEqual(['reader launch: gated (committed); locale routes: unknown'])
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
      out: ['reader launch: gated (committed); locale routes: 0'],
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
    const root = writeRoot(gatedOutput(), true, 'app', 'staging')
    mkdirSync(join(root, '.next', 'server', 'route-cache', 'APP_PAGE', 'x', '$'), {
      recursive: true,
    })
    writeFileSync(
      join(root, '.next', 'server', 'route-cache', 'APP_PAGE', 'x', '$', 'index.html'),
      '<main></main>',
    )
    const result = run(root, { CONTENT_SOURCE: 'none' })
    expect(result.err).toEqual([
      'check-build failed [read] two different prerendered files for index.html (server/route-cache)',
      'check-build failed [content-outputs] .content/ exists, but CONTENT_SOURCE is none',
      'check-build failed [content-outputs] public/build-info.json exists, but CONTENT_SOURCE is none',
    ])
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
})

/** A strict build-info record of this mode (a Storage mode needs at least one GET). */
function buildInfo(mode: GateMode): BuildInfo {
  return {
    schemaVersion: '1.0',
    mode,
    seq: 1,
    pointerPath: mode === 'fixtures' ? 'catalogue/fixtures.json' : `catalogue/${mode}.json`,
    snapshotPath: 'catalogue/snapshots/1.json',
    snapshotSha256: 'a'.repeat(64),
    featuredStoryId: null,
    stories: [],
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
