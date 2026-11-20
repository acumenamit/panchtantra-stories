// Open Graph and the og fallback image, P1-3 Step 12b (spec SPEC:434, :486; design
// p1-step12-design.md §3.19 N19, §3.21 N21, §4.9, §4.10, §8.4, §13.4.4 E12-S1 to E12-S3; rows
// B4, B5, B6, B11). Review and staging legs (@review), all 5 projects.
// - No e2e leg has a site origin: the origin is used only in a Vercel Production build (design
//   §3.20 N20), so every leg shows the no-origin tag set. E12-S1: on Home and on each fixture
//   landing, exactly og:title, og:description, og:type website, og:site_name Storyboard and the
//   twitter card, title and description Next fills in from them (card 'summary', no image); no
//   og:url, og:image* or twitter:image* in the DOM or anywhere in the server HTML (raw,
//   JSON-escaped or with a \u-escaped colon); no canonical and no hreflang link; the one robots
//   meta; the page title. E12-S2: no og: or twitter: meta on "/", Grown-ups, the player or the
//   404. The expected strings are the stored ones (meta.description, the fixture's title and
//   description): no new copy.
// - E12-S3: GET /og/storyboard-1200x630.jpg through the page (so a page.route can stand in the
//   way, MT12-6): 200, content-type exactly image/jpeg, the four security headers, and its sha256
//   twice: equal to the file in public/, and equal to the committed fallback as scripts/og/og-image.ts
//   regenerates it (ogFallbackJpeg(); T12-35 g3 holds the two equal), which does not depend on
//   public/, so a replaced public/ file (MU12-191, design §13.6 JP) is caught. Then on /en this
//   engine decodes it (img.decode(), 1200×630: hard on both
//   engines), draws it to a canvas and reads it back; the pixels are compared with ogFallbackRgb()
//   (scripts/og/og-image.ts, on the Node side) through pixelStats (W11): the four 32×32 corners'
//   largest |Δ|, the whole image's MAE and the icon box's (344, 59, 512×512) MAE per channel,
//   printed on every engine as `[og-image] <project> mae=… iconMae=… cornerMax=…`. Chromium
//   asserts them against the gross bounds of §8.4 (lead decision L8); WebKit annotates them and
//   asserts nothing more, since Linux WebKit's decoder is unmeasured (rules-block.md:32, 13.8 P8).
//   The bounds catch a wrong picture (the icon misplaced or missing), not a quality change; the
//   sha256 catches the bytes.
// - Every test collects console errors and page errors (an auto fixture) and fails on any, except
//   E12-S2's one failed-load line of the 404 document it opens on purpose (/no-such-page; the line
//   T-a21 allows, player.spec.ts:128-130), which it requires exactly once. A test that opens
//   another page after a reader page waits for no request in flight first (W5; WebKit reports an
//   aborted router prefetch as a page error, 13.1 E).
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../src/core/locales'
import { APP_NAME } from '../src/core/app-info'
import { OG_FILE, OG_HEIGHT, OG_WIDTH, ogFallbackJpeg, ogFallbackRgb } from '../scripts/og/og-image'
import { pixelStats, type Region } from '../scripts/testing/e2e-readers'
import { expect, test as base } from './fixtures'
import { launchLeg } from './launch-leg'
import { consoleErrors, quietRequests, sha256, type ConsoleErrors } from './page-helpers'
import {
  documentRoutes,
  landingPaths,
  message,
  storyFields,
  uiLang,
  waitForHydration,
} from './routes'
import { expectSecurityHeaders } from './security-headers'

const test = base.extend<{ errors: ConsoleErrors }>({
  errors: [
    async ({ page, browserName }, use) => {
      const errors = consoleErrors(page)
      await use(errors)
      errors.check(browserName)
    },
    { auto: true },
  ],
})

const LEG = launchLeg(process.env.E2E_LAUNCH)
const OG_PATH = '/og/storyboard-1200x630.jpg'
const ROBOTS = 'noindex, nofollow'
/** The 404 document's one console line, on both engines (T-a21's line, player.spec.ts:128-130). */
const NOT_FOUND_LINE =
  /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/

// The gross bounds of design §8.4 (lead decision L8), asserted on Chromium only. Probe PR-4 (the
// build run's integrator, both engines on Windows, before these bounds are relied on) must show
// every measured value at no more than half of its bound; otherwise stop S10.
const CORNER_MAX_BOUND = 6
const WHOLE_MAE_BOUND = 4
const ICON_MAE_BOUND = 8

const CORNER = 32
const REGIONS: Readonly<Record<'corners' | 'whole' | 'icon', readonly Region[]>> = {
  corners: [
    { x: 0, y: 0, width: CORNER, height: CORNER },
    { x: OG_WIDTH - CORNER, y: 0, width: CORNER, height: CORNER },
    { x: 0, y: OG_HEIGHT - CORNER, width: CORNER, height: CORNER },
    { x: OG_WIDTH - CORNER, y: OG_HEIGHT - CORNER, width: CORNER, height: CORNER },
  ],
  whole: [{ x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT }],
  icon: [{ x: 344, y: 59, width: 512, height: 512 }],
}
const CHANNELS = ['red', 'green', 'blue'] as const

/** A page with Open Graph tags and what they must say. */
interface SocialPage {
  readonly path: string
  readonly code: LocaleCode
  /** og:title and twitter:title. */
  readonly ogTitle: string
  /** og:description and twitter:description. */
  readonly description: string
  /** The document title. */
  readonly title: string
}

/** Home in each enabled locale, then the six fixture landings (design §13.4.4: 8 pages). */
function socialPages(): SocialPage[] {
  const homes = ENABLED_LOCALE_CODES.map((code): SocialPage => ({
    path: `/${code}`,
    code,
    ogTitle: APP_NAME,
    description: message(uiLang(code), 'meta.description'),
    title: APP_NAME,
  }))
  const landings = landingPaths().map(({ path, code, storyId }): SocialPage => {
    const fields = storyFields(storyId, code)
    return {
      path,
      code,
      ogTitle: fields.title,
      description: fields.description,
      title: `${fields.title} – ${APP_NAME}`,
    }
  })
  return [...homes, ...landings]
}

/** Every og: and twitter: meta as [key, content], sorted. */
async function socialMetas(page: Page): Promise<[string, string][]> {
  const pairs = await page
    .locator('meta[property^="og:"], meta[name^="twitter:"]')
    .evaluateAll((metas) =>
      metas.map((meta): [string, string] => [
        meta.getAttribute('property') ?? meta.getAttribute('name') ?? '',
        meta.getAttribute('content') ?? '',
      ]),
    )
  return pairs.sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
}

/** The URL-carrying tags that need a site origin, in any form the server HTML could hold them. */
const ORIGIN_TAG = /og(?::|\\u003a)(?:url|image)|twitter(?::|\\u003a)image/i

test.describe('Open Graph tags and the og fallback image, Step 12b', { tag: '@review' }, () => {
  for (const target of socialPages()) {
    test(`E12-S1 ${target.path}: Open Graph tags without a site origin`, async ({
      page,
      request,
    }) => {
      const response = await page.goto(target.path)
      expect(response?.status(), `precondition: ${target.path} answers 200`).toBe(200)
      await waitForHydration(page)

      const expected: [string, string][] = [
        ['og:description', target.description],
        ['og:site_name', APP_NAME],
        ['og:title', target.ogTitle],
        ['og:type', 'website'],
        ['twitter:card', 'summary'],
        ['twitter:description', target.description],
        ['twitter:title', target.ogTitle],
      ]
      expect
        .soft(await socialMetas(page), '(g1) the og: and twitter: metas, sorted')
        .toEqual(expected)

      const originTags = await page
        .locator('meta[property="og:url"], meta[property^="og:image"], meta[name^="twitter:image"]')
        .count()
      expect.soft(originTags, '(g2) og:url, og:image* and twitter:image* metas in the DOM').toBe(0)
      const server = await request.get(target.path)
      expect(server.status(), `precondition: the server HTML of ${target.path} answers 200`).toBe(
        200,
      )
      const html = await server.text()
      expect
        .soft(
          html.match(ORIGIN_TAG)?.[0] ?? null,
          '(g2) an origin tag in the server HTML, any form',
        )
        .toBeNull()

      const links = await page.locator('link[rel="canonical"], link[hreflang]').count()
      expect.soft(links, '(g3) canonical and hreflang links').toBe(0)

      const robots = await page
        .locator('meta[name="robots"]')
        .evaluateAll((metas) => metas.map((meta) => meta.getAttribute('content')))
      expect.soft(robots, '(g4) exactly one robots meta').toEqual([ROBOTS])

      expect.soft(await page.title(), '(g5) the document title').toBe(target.title)
    })
  }

  test('E12-S2 no Open Graph tags on "/", Grown-ups, the player and the 404', async ({
    page,
    errors,
  }) => {
    // '/no-such-page' is the 404 document: each engine logs its one failed load (as in T-a21).
    errors.allow({ chromium: [NOT_FOUND_LINE], webkit: [NOT_FOUND_LINE] })
    const paths = [
      '/',
      '/en/grown-ups',
      '/hi/grown-ups',
      '/en/stories/two-paths/read',
      '/no-such-page',
    ]
    const routes = documentRoutes(LEG)
    const quiet = quietRequests(page)
    for (const [index, path] of paths.entries()) {
      const route = routes.find((candidate) => candidate.path === path)
      expect(route, `precondition: ${path} is one of the leg's routes`).toBeDefined()
      if (index > 0) await quiet()
      const response = await page.goto(path)
      expect(response?.status(), `precondition: ${path} answers as legRoutes says`).toBe(
        route?.status,
      )
      expect(new URL(page.url()).pathname, `precondition: the page stayed on ${path}`).toBe(path)
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )
      expect.soft(await socialMetas(page), `(g1) og: and twitter: metas on ${path}`).toEqual([])
    }
    const failedLoads = (): number =>
      errors.lines.filter((line) => NOT_FOUND_LINE.test(line)).length
    await expect
      .poll(failedLoads, 'one failed-load line, for the one 404 document (/no-such-page)')
      .toBe(1)
  })

  test('E12-S3 the og fallback image: served as committed, and decoded at 1200×630 by this engine', async ({
    page,
    browserName,
  }) => {
    // Two oracles for the bytes (design §13.6 JP): the file in public/ as the server reads it, and
    // the committed fallback as the generator makes it (ogFallbackJpeg(); T12-35 g3 holds the two
    // equal). Only the second is independent of public/, so a replaced public/ file (MU12-191)
    // turns it red while the first stays green.
    const onDisk = readFileSync(OG_FILE)
    const committed = Buffer.from(ogFallbackJpeg())

    const response = await page.goto(OG_PATH)
    expect(response, `precondition: a response for ${OG_PATH}`).not.toBeNull()
    expect.soft(response?.status(), '(g1) status').toBe(200)
    const headers = (await response?.allHeaders()) ?? {}
    expect.soft(headers['content-type'], '(g1) content-type, exactly').toBe('image/jpeg')
    const body = (await response?.body()) ?? Buffer.alloc(0)
    expect
      .soft(
        sha256(body),
        `(g1) body sha256 equals the file in public/ (${body.length} of ${onDisk.length} bytes)`,
      )
      .toBe(sha256(onDisk))
    expect
      .soft(
        sha256(body),
        `(g1) body sha256 equals the committed fallback, regenerated (${body.length} of ${committed.length} bytes)`,
      )
      .toBe(sha256(committed))
    expectSecurityHeaders(headers, `(g1) ${OG_PATH}`)

    const home = await page.goto('/en')
    expect(home?.status(), 'precondition: /en answers 200').toBe(200)
    const decoded = await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      try {
        await img.decode()
      } catch (error) {
        return { error: String(error), width: 0, height: 0, rgba: '' }
      }
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) return { error: 'no 2d context', width: 0, height: 0, rgba: '' }
      context.drawImage(img, 0, 0)
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      let binary = ''
      for (let at = 0; at < data.length; at += 0x8000) {
        binary += String.fromCharCode(...data.subarray(at, at + 0x8000))
      }
      return {
        error: undefined,
        width: img.naturalWidth,
        height: img.naturalHeight,
        rgba: btoa(binary),
      }
    }, OG_PATH)
    expect(decoded.error, '(g2) img.decode() resolves on this engine').toBeUndefined()
    expect(decoded.width, '(g2) naturalWidth').toBe(OG_WIDTH)
    expect(decoded.height, '(g2) naturalHeight').toBe(OG_HEIGHT)

    const stats = pixelStats(
      {
        width: decoded.width,
        height: decoded.height,
        channels: 4,
        data: Buffer.from(decoded.rgba, 'base64'),
      },
      { width: OG_WIDTH, height: OG_HEIGHT, channels: 3, data: ogFallbackRgb() },
      REGIONS,
    )
    const { corners, whole, icon } = stats
    if (corners === undefined || whole === undefined || icon === undefined) {
      throw new Error('pixelStats left out a region')
    }
    const cornerMax = Math.max(...corners.maxAbs)
    const format = (values: readonly number[]): string => values.map((v) => v.toFixed(3)).join('/')
    const line =
      `[og-image] ${test.info().project.name} mae=${format(whole.mae)} ` +
      `iconMae=${format(icon.mae)} cornerMax=${cornerMax}`
    console.log(line)
    test.info().annotations.push({ type: 'og-image pixels', description: line })
    if (browserName !== 'chromium') return
    expect
      .soft(cornerMax, `(g3) corners max |Δ| ≤ ${CORNER_MAX_BOUND}`)
      .toBeLessThanOrEqual(CORNER_MAX_BOUND)
    CHANNELS.forEach((channel, index) => {
      expect
        .soft(whole.mae[index], `(g3) whole-image MAE, ${channel} ≤ ${WHOLE_MAE_BOUND}`)
        .toBeLessThanOrEqual(WHOLE_MAE_BOUND)
      expect
        .soft(icon.mae[index], `(g3) icon-box MAE, ${channel} ≤ ${ICON_MAE_BOUND}`)
        .toBeLessThanOrEqual(ICON_MAE_BOUND)
    })
  })
})
