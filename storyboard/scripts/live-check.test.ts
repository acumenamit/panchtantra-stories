// The production live check (design p1-step7-design.md §5.7 item 4, §8.1 item 12; P1-1c). The
// recorded responses are the Step 7 build's own pages (the gated "/" and the 404 from the gated
// build, the gate and /en, /hi from the review build), cut down to the parts the checker reads, with
// the headers next.config sends plus the ones Vercel adds. Nothing here touches the network.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOCALE_REDIRECT_SCRIPT } from '../src/core/progress/locale-redirect-boot'
import {
  checkResponse,
  checkRound,
  DEADLINE_MS,
  EXPECT_BUILD_INFO,
  EXPECTED_HEADERS,
  PRODUCTION_ORIGIN,
  probes,
  readNotFoundTitles,
  record,
  ROUND_INTERVAL_MS,
  ROUNDS_IN_A_ROW,
  runLiveCheck,
  type Probe,
  type Recorded,
} from './live-check'

const storyboard = join(dirname(fileURLToPath(import.meta.url)), '..')
const TITLES = readNotFoundTitles(storyboard)

// The spec §9 CSP, copied byte for byte (as e2e/security-headers.ts does).
const SPEC_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' https://wlunxatrekiqygwphkgy.supabase.co; " +
  "media-src 'self' https://wlunxatrekiqygwphkgy.supabase.co; connect-src 'self'; font-src 'self'; " +
  "manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
const PERMISSIONS =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), ' +
  'midi=(), display-capture=(), interest-cohort=(), browsing-topics=()'

const SECURITY: [string, string][] = [
  ['content-security-policy', SPEC_CSP],
  ['referrer-policy', 'no-referrer'],
  ['x-content-type-options', 'nosniff'],
  ['permissions-policy', PERMISSIONS],
]
const VERCEL: [string, string][] = [
  ['age', '0'],
  ['cache-control', 'public, max-age=0, must-revalidate'],
  ['content-type', 'text/html; charset=utf-8'],
  ['date', 'Sun, 15 Nov 2026 06:00:00 GMT'],
  ['server', 'Vercel'],
  ['strict-transport-security', 'max-age=63072000'],
  ['x-vercel-cache', 'HIT'],
  ['x-vercel-id', 'bom1::abcde-1763186400000-0123456789ab'],
]
const HEADERS = [...VERCEL, ...SECURITY]

const ROBOTS = '<meta name="robots" content="noindex, nofollow"/>'
const FONTS = 'class="_0BuglG_variable _2r7mIq_variable RIHMTq_variable"'
const BOOT =
  '<script>(function(){try{var r=localStorage.getItem("reader.v1.prefs");if(r===null)return})()</script>'

function html(lang: string, head: string, main: string): string {
  return (
    `<!DOCTYPE html><html lang="${lang}" dir="ltr" ${FONTS}><head><meta charSet="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>${BOOT}` +
    `<meta name="theme-color" content="#0d0a05"/><meta name="color-scheme" content="dark"/>${head}` +
    `</head><body><div hidden=""><!--$--><!--/$--></div>${main}` +
    '<script>(self.__next_f=self.__next_f||[]).push([0])</script></body></html>'
  )
}

const ROOT_HEAD =
  '<title>Storyboard</title>' +
  '<meta name="description" content="Interactive stories for children (work in progress)."/>' +
  `<link rel="manifest" href="/manifest.webmanifest"/>${ROBOTS}` +
  '<link rel="icon" href="/icon.png?icon.1qk6zzkuxxlgx.png" sizes="32x32" type="image/png"/>' +
  '<link rel="apple-touch-icon" href="/apple-icon.png?apple-icon.0_r8negmzbkv5.png" ' +
  'sizes="180x180" type="image/png"/>'
const COMING_SOON = '<main><h1>Storyboard</h1><p>Coming soon.</p></main>'
const GATED_HOME = html('en', ROOT_HEAD, COMING_SOON)
const NOT_FOUND = html(
  'en',
  '<title>Page not found – Storyboard</title><meta name="robots" content="noindex"/>',
  '<main><h1>Page not found<!-- --> <span lang="hi" class="hS2S9W_titleHi">पेज नहीं मिला</span></h1>' +
    '<p>This page isn’t here. The link may be wrong, or the page may have moved.</p>' +
    '<a href="/" class="hS2S9W_link"><span>Go to the start page</span> ' +
    '<span lang="hi" class="hS2S9W_linkHi">शुरुआती पेज पर जाएँ</span></a></main>',
)
// Next's own 404 before Step 7: noindex, but no bilingual h1.
const NEXT_DEFAULT_404 = html(
  'en',
  '<meta name="robots" content="noindex"/><title>404: This page could not be found.</title>',
  '<div><h1 class="next-error-h1">404</h1><div><h2>This page could not be found.</h2></div></div>',
)
const GATE_HOME = html(
  'en',
  `${ROOT_HEAD}<script>${LOCALE_REDIRECT_SCRIPT}</script>`,
  '<main><h1>Storyboard</h1><ul><li><a href="/en?remember=1" hrefLang="en" lang="en" dir="ltr">' +
    '<span aria-hidden="true">A</span><span>English</span></a></li><li><a href="/hi?remember=1" ' +
    'hrefLang="hi" lang="hi" dir="ltr"><span aria-hidden="true">अ</span><span>हिन्दी</span></a></li>' +
    '</ul></main>',
)
const localeHome = (code: string) =>
  html(
    code,
    `<title>Storyboard</title>${ROBOTS}`,
    '<main id="main" tabindex="-1"><h1>x</h1></main>',
  )

type HeaderList = readonly (readonly [string, string])[]

const ok = (body: string | null, status = 200, headers: HeaderList = HEADERS): Recorded => ({
  status,
  headers,
  body,
})
const notFound = (body: string | null = NOT_FOUND): Recorded => ok(body, 404)

/** Today's gated production, as the live check reads it. */
function gatedSite(): Map<string, Recorded> {
  return new Map([
    ['/', ok(GATED_HOME)],
    ...['/en', '/hi', '/en/grown-ups', '/hi/grown-ups', '/ar', '/no-such-page'].map(
      (path): [string, Recorded] => [path, notFound()],
    ),
    ['/build-info.json', notFound()],
  ])
}

/** Production after Steps 25a and 25b. */
function launchedSite(): Map<string, Recorded> {
  return new Map([
    ['/', ok(GATE_HOME)],
    ['/en', ok(localeHome('en'))],
    ['/hi', ok(localeHome('hi'))],
    ['/ar', notFound()],
    ['/no-such-page', notFound()],
    [
      '/build-info.json',
      ok('{"schemaVersion":"1.0"}', 200, [...SECURITY, ['content-type', 'application/json']]),
    ],
  ])
}

const GATED_PROBES = probes('gated', false, TITLES)
const LAUNCHED_PROBES = probes('launched', true, TITLES)

function probe(list: readonly Probe[], path: string): Probe {
  const found = list.find((p) => p.path === path)
  if (!found) throw new Error(`no probe for ${path}`)
  return found
}

describe('the committed expectation', () => {
  it('probes the production domain, with build-info expected 404 until Step 25a', () => {
    expect(PRODUCTION_ORIGIN).toBe('https://storyboard-one-eta.vercel.app')
    expect(EXPECT_BUILD_INFO, 'flipped at Step 25a').toBe(false)
    expect([ROUNDS_IN_A_ROW, ROUND_INTERVAL_MS]).toEqual([6, 5_000])
    expect(DEADLINE_MS).toBe(600_000)
  })

  it('expects exactly the spec CSP and the 3 other security headers', () => {
    expect(EXPECTED_HEADERS).toEqual(SECURITY)
  })

  it('names the gated probes and statuses', () => {
    expect(GATED_PROBES.map((p) => [p.path, p.status])).toEqual([
      ['/', 200],
      ['/en', 404],
      ['/hi', 404],
      ['/en/grown-ups', 404],
      ['/hi/grown-ups', 404],
      ['/ar', 404],
      ['/no-such-page', 404],
      ['/build-info.json', 404],
    ])
  })

  it('names the launched probes and statuses', () => {
    expect(LAUNCHED_PROBES.map((p) => [p.path, p.status])).toEqual([
      ['/', 200],
      ['/en', 200],
      ['/hi', 200],
      ['/ar', 404],
      ['/no-such-page', 404],
      ['/build-info.json', 200],
    ])
    expect(probes('gated', true, TITLES).at(-1)).toMatchObject({
      path: '/build-info.json',
      status: 200,
    })
  })

  it('reads the 404 h1 from the committed catalogues', () => {
    expect(TITLES).toEqual({ en: 'Page not found', hi: 'पेज नहीं मिला' })
  })
})

describe('the response checker on recorded responses', () => {
  it('passes the gated site', () => {
    expect(checkRound(GATED_PROBES, gatedSite())).toEqual([])
  })

  it('passes the launched site', () => {
    expect(checkRound(LAUNCHED_PROBES, launchedSite())).toEqual([])
  })

  it('fails a wrong status: the reader open while gated, or Next’s default 404', () => {
    const site = gatedSite()
    site.set('/en', ok(localeHome('en')))
    site.set('/build-info.json', ok('{}'))
    expect(checkRound(GATED_PROBES, site)).toEqual([
      '/en 200: status (expected 404)',
      '/build-info.json 200: status (expected 404)',
    ])
  })

  it('fails a 404 that is not the bilingual page, or carries no noindex', () => {
    const site = gatedSite()
    site.set('/no-such-page', notFound(NEXT_DEFAULT_404))
    site.set('/ar', notFound(NOT_FOUND.replace('<meta name="robots" content="noindex"/>', '')))
    site.set('/hi', notFound(NOT_FOUND.replace(' lang="hi" class="hS2S9W_titleHi"', '')))
    expect(checkRound(GATED_PROBES, site)).toEqual([
      '/hi 404: bilingual h1',
      '/ar 404: robots meta (noindex)',
      '/no-such-page 404: bilingual h1',
    ])
  })

  it('fails a Set-Cookie on any response', () => {
    const site = gatedSite()
    site.set('/', ok(GATED_HOME, 200, [...HEADERS, ['set-cookie', 'NEXT_LOCALE=hi; Path=/']]))
    site.set('/ar', ok(NOT_FOUND, 404, [...HEADERS, ['set-cookie', '__vercel_toolbar=1']]))
    expect(checkRound(GATED_PROBES, site)).toEqual([
      '/ 200: header set-cookie present',
      '/ar 404: header set-cookie present',
    ])
  })

  it('fails a missing, changed or doubled security header', () => {
    const site = gatedSite()
    site.set(
      '/',
      ok(
        GATED_HOME,
        200,
        HEADERS.filter(([n]) => n !== 'permissions-policy'),
      ),
    )
    const devCsp = SPEC_CSP.replace("'unsafe-inline';", "'unsafe-inline' 'unsafe-eval';")
    site.set(
      '/en',
      ok(
        NOT_FOUND,
        404,
        HEADERS.map(([n, v]): [string, string] => [
          n,
          n === 'content-security-policy' ? devCsp : v,
        ]),
      ),
    )
    site.set('/hi', ok(NOT_FOUND, 404, [...HEADERS, ['referrer-policy', 'no-referrer']]))
    expect(checkRound(GATED_PROBES, site)).toEqual([
      '/ 200: missing header permissions-policy',
      '/en 404: header content-security-policy differs',
      '/hi 404: header referrer-policy differs',
    ])
  })

  it('fails a second robots meta, or none, on a 200 page', () => {
    const doubled = GATED_HOME.replace(ROBOTS, `${ROBOTS}${ROBOTS}`)
    const indexed = GATED_HOME.replace(ROBOTS, `${ROBOTS}<meta name="robots" content="index"/>`)
    const none = GATED_HOME.replace(ROBOTS, '')
    for (const body of [doubled, indexed, none]) {
      expect(checkResponse(probe(GATED_PROBES, '/'), ok(body))).toEqual([
        'robots meta (exactly one, noindex, nofollow)',
      ])
    }
  })

  it('fails a gate link or the redirect script while gated', () => {
    const home = probe(GATED_PROBES, '/')
    expect(checkResponse(home, ok(GATE_HOME))).toEqual([
      'coming-soon body',
      'no locale link',
      'no redirect script',
    ])
    expect(
      checkResponse(home, ok(GATED_HOME.replace('</main>', '<a href="/hi">हिन्दी</a></main>'))),
    ).toEqual(['coming-soon body', 'no locale link'])
  })

  it('fails a changed title or description on the gated "/"', () => {
    const home = probe(GATED_PROBES, '/')
    expect(checkResponse(home, ok(GATED_HOME.replace('<title>Storyboard</title>', '')))).toEqual([
      'title',
    ])
    expect(checkResponse(home, ok(GATED_HOME.replace('(work in progress)', '')))).toEqual([
      'description',
    ])
  })

  it('fails a missing, changed or doubled head tag on the gated "/"', () => {
    const home = probe(GATED_PROBES, '/')
    const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1"/>'
    const themeColor = '<meta name="theme-color" content="#0d0a05"/>'
    const manifest = '<link rel="manifest" href="/manifest.webmanifest"/>'
    const cases: [body: string, problem: string][] = [
      [
        GATED_HOME.replace(viewport, viewport.replace('scale=1', 'scale=1, maximum-scale=1')),
        'viewport meta',
      ],
      [GATED_HOME.replace(themeColor, ''), 'theme-color meta'],
      [GATED_HOME.replace('content="dark"', 'content="light"'), 'color-scheme meta'],
      [GATED_HOME.replace(manifest, `${manifest}${manifest}`), 'manifest link'],
      [GATED_HOME.replace('</head>', '<link rel="icon" href="/favicon.ico"/></head>'), 'icon link'],
      [GATED_HOME.replace(/<link rel="apple-touch-icon"[^>]*>/, ''), 'apple-touch-icon link'],
    ]
    for (const [body, problem] of cases) {
      expect(checkResponse(home, ok(body)), problem).toEqual([problem])
    }
  })

  it('fails the launched site without its gate links or <html lang>', () => {
    const site = launchedSite()
    site.set('/', ok(GATED_HOME))
    site.set('/hi', ok(localeHome('en')))
    expect(checkRound(LAUNCHED_PROBES, site)).toEqual([
      '/ 200: gate links',
      '/hi 200: html lang hi',
    ])
  })

  it('fails no response, or a body it cannot read', () => {
    const site = gatedSite()
    site.set('/', { status: null, headers: [], body: null })
    site.set('/en', notFound(null))
    site.delete('/hi')
    expect(checkRound(GATED_PROBES, site)).toEqual([
      '/ none: no response',
      '/en 404: body unreadable or larger than 1 MiB',
      '/hi none: no response',
    ])
  })
})

describe('record', () => {
  it('keeps every header with a lower-case name, set-cookie included, and the body text', async () => {
    const response = new Response('<p>x</p>', {
      status: 404,
      headers: [
        ['Content-Security-Policy', SPEC_CSP],
        ['Set-Cookie', 'a=1'],
        ['Set-Cookie', 'b=2'],
      ],
    })
    const recorded = await record(response)
    expect(recorded.status).toBe(404)
    expect(recorded.body).toBe('<p>x</p>')
    expect(recorded.headers.filter(([n]) => n === 'set-cookie')).toHaveLength(2)
    expect(recorded.headers).toContainEqual(['content-security-policy', SPEC_CSP])
  })

  it('gives no body past 1 MiB', async () => {
    const recorded = await record(new Response('x'.repeat(1024 * 1024 + 1)))
    expect(recorded.body).toBeNull()
  })
})

describe('runLiveCheck', () => {
  interface Fake {
    readonly fetchImpl: typeof fetch
    readonly requests: { url: string; init: RequestInit | undefined }[]
    readonly sleeps: number[]
    readonly log: string[]
    readonly now: () => number
    readonly sleep: (ms: number) => Promise<void>
  }

  /** A site that answers round `n` (1-based) from `siteFor(n)`; each round takes 1 s. */
  function fake(siteFor: (round: number) => ReadonlyMap<string, Recorded>, paths: number): Fake {
    let clock = 1_763_186_400_000
    const requests: Fake['requests'] = []
    const sleeps: number[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      requests.push({ url: url.href, init })
      const round = Math.floor((requests.length - 1) / paths) + 1
      if (requests.length % paths === 0) clock += 1_000
      const recorded = siteFor(round).get(url.pathname)
      if (!recorded || recorded.status === null) throw new TypeError('fetch failed')
      return new Response(recorded.body, {
        status: recorded.status,
        headers: recorded.headers.map(([name, value]): [string, string] => [name, value]),
      })
    }) as typeof fetch
    return {
      fetchImpl,
      requests,
      sleeps,
      log: [],
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
    }
  }

  const paths = GATED_PROBES.length

  function run(f: Fake, extra: Partial<Parameters<typeof runLiveCheck>[0]> = {}) {
    return runLiveCheck({
      titles: TITLES,
      launch: 'gated',
      expectBuildInfo: false,
      fetchImpl: f.fetchImpl,
      now: f.now,
      sleep: f.sleep,
      log: (line) => f.log.push(line),
      ...extra,
    })
  }

  it('passes after exactly 6 matching rounds in a row, 5 s apart, with read-only GETs', async () => {
    const f = fake(() => gatedSite(), paths)
    expect(await run(f)).toBe(0)
    expect(f.requests).toHaveLength(6 * paths)
    expect(f.sleeps).toEqual([5_000, 5_000, 5_000, 5_000, 5_000])
    for (const { url, init } of f.requests) {
      expect(new URL(url).origin).toBe(PRODUCTION_ORIGIN)
      expect(init?.method ?? 'GET').toBe('GET')
      expect(init?.body).toBeUndefined()
      expect(init).toMatchObject({ redirect: 'manual', cache: 'no-store' })
    }
    expect(f.log[0]).toBe(
      `live-check: ${PRODUCTION_ORIGIN} expecting gated (PRODUCTION_LAUNCH), /build-info.json 404; 6 matching rounds in a row, 5 s apart`,
    )
    expect(f.log.slice(1)).toEqual([
      ...[1, 2, 3, 4, 5, 6].map((n) => `live-check: round ${n}: pass (${n}/6)`),
      'live-check: pass (6 matching rounds in a row)',
    ])
  })

  it('resets the count on a mismatching round (a brief read of the previous deployment)', async () => {
    const previous = gatedSite()
    previous.set('/en', notFound(NEXT_DEFAULT_404))
    const f = fake((round) => (round === 4 ? previous : gatedSite()), paths)
    expect(await run(f)).toBe(0)
    expect(f.requests).toHaveLength(10 * paths)
    expect(f.log).toContain('live-check: round 4: FAIL, count reset from 3')
    expect(f.log).toContain('live-check:   /en 404: bilingual h1')
    expect(f.log.at(-2)).toBe('live-check: round 10: pass (6/6)')
  })

  it('fails when the deadline comes first', async () => {
    const wrong = gatedSite()
    wrong.set('/', ok(GATED_HOME, 200, [...HEADERS, ['set-cookie', 'secret-cookie-value=1']]))
    const f = fake(() => wrong, paths)
    expect(await run(f, { deadlineMs: 60_000 })).toBe(1)
    // Each fake round takes 1 s, then 5 s of sleep: round 11 ends past the 60 s deadline.
    expect(f.log.at(-1)).toBe(
      'live-check: FAIL (deadline reached after 11 rounds without 6 matching rounds in a row)',
    )
  })

  it('fails when a request gets no response, and keeps polling', async () => {
    const down = new Map<string, Recorded>()
    const f = fake((round) => (round <= 2 ? down : gatedSite()), paths)
    expect(await run(f)).toBe(0)
    expect(f.log).toContain('live-check:   / none: no response')
  })

  it('prints only paths, status codes, header names and pass/fail: never a value or body text', async () => {
    const leaky = gatedSite()
    leaky.set(
      '/',
      ok(GATE_HOME, 200, [
        ...HEADERS.filter(([n]) => n !== 'referrer-policy'),
        ['set-cookie', 'secret-cookie-value=1'],
      ]),
    )
    leaky.set(
      '/en',
      ok(
        localeHome('en'),
        200,
        HEADERS.map(([n, v]): [string, string] => [
          n,
          n === 'content-security-policy' ? 'evil-csp-value' : v,
        ]),
      ),
    )
    const f = fake(() => leaky, paths)
    expect(await run(f, { deadlineMs: 10_000 })).toBe(1)
    const text = f.log.join('\n')
    const secrets = ['secret-cookie-value', 'evil-csp-value', 'default-src', 'Coming soon', 'bom1']
    for (const secret of [...secrets, 'Storyboard', 'remember=1', 'English', 'Vercel']) {
      expect(text).not.toContain(secret)
    }
    expect(f.log).toContain('live-check:   / 200: missing header referrer-policy')
    expect(f.log).toContain('live-check:   /en 200: header content-security-policy differs')
  })

  it('refuses an origin that is not https', async () => {
    const f = fake(() => gatedSite(), paths)
    await expect(run(f, { origin: 'http://storyboard-one-eta.vercel.app' })).rejects.toThrow(
      TypeError,
    )
    expect(f.requests).toEqual([])
  })
})
