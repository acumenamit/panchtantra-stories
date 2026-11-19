// The scene images, Step 10e (spec §6.5 SPEC:486-489; design p1-step10-design.md §2.5, §4.1, §4.5,
// §4.6, §7, D11-P21 to P24, §9.3 T-e1 to T-e7, §16 O1, O3, P-IMG; P1-4b). Staging leg only
// (@staging): the staging harness (scripts/testing/staging-build.ts) adds a test-only picture story,
// derived in memory from the river-stones fixture: six pictures (1408×768, and on far_bank the
// square 1024×1024 shape), big_rock and ending_back without one, and the Hindi flat_stones passage
// made long by repeating itself. This spec knows every picture URL on its own, from the design's
// numbers (§4.5: the asset id is the sha256 of "<story id>:<node id>", each variant sits at
// media/<story id>/<asset id>-w<width>.webp under CONTENT_PUBLIC_BASE), and serves them from the
// media stub (fixtures.ts, mediaStub): the 34-byte 1×1 WebP for those 12 URLs and an abort for any
// other media URL. Nothing is asked of the real media origin. It cannot import the harness's own
// derivation (scripts/testing/staging-catalogue.ts): that module reads import.meta, which a spec,
// compiled as CommonJS, cannot load. If the two ever differ, the stub aborts the URLs the pages ask
// for and T-e1 fails. Only this spec opens the picture story's pages (the scan in
// scripts/testing/staging-catalogue.test.ts keeps its id out of every other e2e file).
// - Every test collects console errors and page errors (consoleErrors) and fails on any it did not
//   declare. T-e3's aborted picture logs Chromium's failed-load line, and nothing at error level on
//   WebKit (O3). Chromium's unused-preload notice is a warning, which never counts.
// - A picture has loaded when the page's img.decode() resolves, and failed when it rejects (O1):
//   never `complete && naturalWidth === 0`, which a good 1×1 stub behind a `w` srcset reads too.
// - T-e3 aborts the start picture three times: before hydration (the JavaScript chunks held until
//   the picture's error event has fired, so only the decode() check at mount can see it), after
//   (its request held by the test's own route until the player is open, then passed on to the stub,
//   which aborts it), and after with a decode() that never settles (so only onError can see it). A
//   failed picture shows the run area's gradient: nothing between the band and the run area paints
//   a background. And a picture whose file the browser swaps while it loads (the phone turns:
//   Chromium picks another srcset file when a wider window needs it, WebKit when a media condition
//   of `sizes` changes, as on the iPad; the pending decode() rejects) is not marked failed, also on
//   a later visit (review S10E-STRESS-1). The turn picks the larger file there after the load too
//   (turnPicksLarger), and Chromium fires no error event when that file fails: aborted by the stub
//   after the load or while the smaller one is held, it marks the picture; a failed picture is not
//   checked again; and a step while the check waits on it leaves the old picture alone (review
//   R2-decode-retry-1, R3-PF-1). The iPhone's turn crosses no media condition, so WebKit keeps its
//   first pick there and those cases skip it (review R3-ADV-2). Resizes after the load never mark
//   a good picture: the URL bar showing and hiding (height only), quick narrower widths and the
//   turn to the good larger file (review R3-ADV-1). Those cases count the decode() calls of the
//   scene picture (recordSceneDecodes): each resize starts the island's check, which asks one, but
//   never of a failed img or of one no longer in the page. Each of their resizes waits for the
//   page's resize event (resizeTo), since WebKit can merge quick viewport changes.
// - T-e1 on a resumed run: nothing is prefetched while the run opens, so the low-priority preloads
//   are the resumed node's next picture only, never the server-rendered start node's (D11-P22).
// - T-e4 and every T-e3 case that holds a picture's request (after hydration, onError alone, the
//   turn while a file loads, and the larger-file cases) hold it with a route of the test's own that
//   ends in route.fallback(), so the media stub still answers it (the guard counts only its
//   answers).
// - T-e4b (review A11Y-10e-1, design R34): at 100% text the first story line is on screen under the
//   picture, at the start and after each step: the bottom of the first line box of the passage's
//   first paragraph (a Range over its first text node) is at most innerHeight. Measured once the
//   step has settled (the header scrolled to the top and the first paragraph focused, D11-P8), the
//   picture has decoded and the fonts have loaded. 125% and 150% are an accepted risk (R34).
// - T-e5 measures layout shift as T-a20 does (Chromium only): a resumed load of the long Hindi
//   passage, its font files held 1.5 s, also under the test-only wide Devanagari fallback and, on
//   the phones, at 150% text.
// - The owner's P1-4 picture screens (design §10.3, R34), screens 27-29, are the last describe:
//   local only and skipped unless SCREENS=1, as e2e/screens.spec.ts, which shoots the player's
//   screens 14-26 on the review build. They are here because only this spec may open the picture
//   story. Staging leg, the 3 Chromium projects at 100% text, and screen 29 at 150% on
//   chromium-phone only (R34). Each asserts its state with this spec's checks (expectLoaded,
//   expectFailed), then waits for every animation and font before the full-page shot. Screens 27
//   and 29 show a loaded picture, which the 1×1 stub would leave invisible, so their stub serves a
//   visible test picture instead (testPictureWebp: drawn by Chromium's canvas, labelled TEST
//   PICTURE, never story art), and each asserts the img shows it (expectTestPicture). Screen 28
//   keeps the 1×1 stub: its start picture is aborted, and no other picture is on screen.
import { createHash } from 'node:crypto'
import type { Browser, Page, Request } from '@playwright/test'
import { CONTENT_PUBLIC_BASE, MEDIA_ORIGIN } from '../src/config/security-headers'
import type { LocaleCode } from '../src/core/locales'
import {
  PROGRESS_KEY,
  RECORD_SCHEMA,
  serializeProgress,
  type ProgressRecord,
  type TextScale,
} from '../src/core/progress/records'
import { TEXT_SCALE_ATTRIBUTE } from '../src/core/progress/text-scale-boot'
import { SCENE_IMAGE_SIZES } from '../src/reader/player/images'
import { PICTURE_STORY_ID } from '../scripts/testing/picture-story-id'
import { expect, test as base } from './fixtures'
import {
  consoleErrors,
  FIRST_PARAGRAPH,
  fixtureGraph,
  frames,
  openPlayer,
  pageValue,
  PART,
  PLAYER,
  prefsText,
  RUN,
  seedPrefs,
  settleForScreenshot,
  step10ScreenPath,
  waitOpen,
  walk,
  wideDevanagariFallback,
  type ConsoleErrors,
} from './page-helpers'
import { layoutShift, playerFixture, playerPath, recordLayoutShifts } from './routes'

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

// ---------------------------------------------------------------------------------------------
// The picture story, as the staging harness derives it (design §4.5, O2)

/** The fixture the picture story is derived from: its graph, its texts and its version. */
const SOURCE_ID = 'river-stones'
const SOURCE = playerFixture(SOURCE_ID)
const GRAPH = fixtureGraph(SOURCE_ID)

/** A picture's size and its WebP widths, smallest first. */
interface Shape {
  readonly width: number
  readonly height: number
  readonly widths: readonly number[]
}
const WIDE: Shape = { width: 1408, height: 768, widths: [768, 1408] }
const SQUARE: Shape = { width: 1024, height: 1024, widths: [768, 1024] }
/** The nodes with a picture; big_rock and ending_back have none (T-e7). */
const SHAPES: Readonly<Record<string, Shape>> = {
  start: WIDE,
  flat_stones: WIDE,
  far_bank: SQUARE,
  round_stones: WIDE,
  ending_dry: WIDE,
  ending_wet: WIDE,
}

/** The one long passage: the Hindi flat_stones passage, repeated with a blank line to 3,600+. */
const LONG_PASSAGE = { locale: 'hi', nodeId: 'flat_stones' } as const
const LONG_PASSAGE_MIN = 3600
const LONG_TEXT = ((): string => {
  const text = SOURCE.text[LONG_PASSAGE.locale]?.nodes[LONG_PASSAGE.nodeId]?.text
  if (text === undefined || text === '') throw new Error('no hi flat_stones passage')
  let long = text
  while (long.length < LONG_PASSAGE_MIN)
    long += `

${text}`
  return long
})()

/** The staging harness's stub picture: a 34-byte 1×1 lossless WebP (design §4.5). */
const PICTURE_WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')

/** One node's picture as the page must show it. */
interface Picture {
  readonly nodeId: string
  readonly width: number
  readonly height: number
  /** The variant URLs, smallest first. */
  readonly urls: readonly string[]
  /** `<url> <width>w`, ascending, joined by ', ' (the img's srcset and its preload's imagesrcset). */
  readonly srcset: string
  /** The file the browser picks at these viewports (P-IMG: w1408, and w1024 for the square one). */
  readonly large: string
}

const PICTURES: ReadonlyMap<string, Picture> = new Map(
  Object.entries(SHAPES).map(([nodeId, shape]): [string, Picture] => {
    const assetId = createHash('sha256').update(`${PICTURE_STORY_ID}:${nodeId}`).digest('hex')
    const variants = shape.widths.map((width) => ({
      width,
      url: `${CONTENT_PUBLIC_BASE}/media/${PICTURE_STORY_ID}/${assetId}-w${width}.webp`,
    }))
    const large = variants[variants.length - 1]
    if (large === undefined) throw new Error(`${nodeId}: no variant`)
    return [
      nodeId,
      {
        nodeId,
        width: shape.width,
        height: shape.height,
        urls: variants.map((variant) => variant.url),
        srcset: variants.map((variant) => `${variant.url} ${variant.width}w`).join(', '),
        large: large.url,
      },
    ]
  }),
)

function picture(nodeId: string): Picture {
  const found = PICTURES.get(nodeId)
  if (found === undefined) throw new Error(`${nodeId} has no picture`)
  return found
}

/** Every variant URL of the story (12): what the media stub serves. */
const MEDIA_URLS = [...PICTURES.values()].flatMap((target) => target.urls)
const STUB = { urls: MEDIA_URLS, body: PICTURE_WEBP, contentType: 'image/webp' }

const urlOf = (code: LocaleCode): string => playerPath(code, PICTURE_STORY_ID)

const BAND = `${PART} [data-scene-band]`
const IMG = `${PART} img[data-scene-image]`
/** Chromium's line for an aborted load; WebKit logs none at error level (design O3). */
const ABORTED_LINE = /^Failed to load resource: net::ERR_FAILED$/
const LORA_FILE = /\/_next\/static\/media\/lora[^/]*\.woff2$/
const NOTO_FILE = /\/_next\/static\/media\/noto[-_]sans[-_]devanagari[^/]*\.woff2$/
const PHONES: readonly string[] = ['chromium-phone', 'webkit-iphone']
/**
 * A width at which every project picks the 768 file: Chromium picks it while the width is under
 * about sqrt(768 × 1408) / devicePixelRatio CSS px (the projects' ratios are 2 to 3).
 */
const NARROW_WIDTH = 250

/** The screen of a phone or tablet turned to landscape: its longer side across. */
function turned(viewport: { readonly width: number; readonly height: number }) {
  return {
    width: Math.max(viewport.width, viewport.height),
    height: Math.min(viewport.width, viewport.height),
  }
}

/** The width of SCENE_IMAGE_SIZES' one media condition, (min-width: 60rem), in CSS px. */
const SIZES_BREAKPOINT = ((): number => {
  const rem = /^\(min-width: (\d+)rem\) /.exec(SCENE_IMAGE_SIZES)?.[1]
  if (rem === undefined) throw new Error(`no (min-width: <n>rem) in ${SCENE_IMAGE_SIZES}`)
  // A media query's rem is the initial font size, 16 px.
  return Number(rem) * 16
})()

/**
 * Whether turning the narrow page (NARROW_WIDTH) picks the larger file (probe; review R3-ADV-2):
 * Chromium picks again whenever a wider window needs it; WebKit only when a media condition of
 * `sizes` changes, as when the iPad turns past 60rem, so never on the iPhone (659 px turned).
 */
function turnPicksLarger(
  browserName: string,
  viewport: { readonly width: number; readonly height: number },
): boolean {
  return browserName === 'chromium' || turned(viewport).width >= SIZES_BREAKPOINT
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The image preload links in <head>, each as its attributes, in imagesrcset order. */
async function imagePreloads(page: Page): Promise<Record<string, string>[]> {
  return page.evaluate(() =>
    [...document.head.querySelectorAll('link[rel="preload"][as="image"]')]
      .map((link) => Object.fromEntries([...link.attributes].map((a) => [a.name, a.value])))
      .sort((a, b) => String(a['imagesrcset']).localeCompare(String(b['imagesrcset']))),
  )
}

/** The image preload link of a picture: the same imagesrcset and imagesizes as its img, no href. */
function preloadLink(target: Picture, priority: 'high' | 'low'): Record<string, string> {
  return {
    rel: 'preload',
    as: 'image',
    imagesrcset: target.srcset,
    imagesizes: SCENE_IMAGE_SIZES,
    fetchpriority: priority,
  }
}

const byImageSrcSet = (a: Record<string, string>, b: Record<string, string>): number =>
  String(a['imagesrcset']).localeCompare(String(b['imagesrcset']))

/** The pictures the next step can show from `nodeId` (its targets' pictures, not its own). */
function candidatesOf(nodeId: string): Picture[] {
  const own = PICTURES.get(nodeId)?.nodeId
  return (GRAPH.nodes.get(nodeId)?.choices ?? []).flatMap((choice) => {
    const next = PICTURES.get(choice.next)
    return next === undefined || next.nodeId === own ? [] : [next]
  })
}

/** Every media request of the page, from now on. */
function mediaRequests(page: Page): Request[] {
  const requests: Request[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin === MEDIA_ORIGIN) requests.push(request)
  })
  return requests
}

/**
 * The media URLs asked for so far, sorted, once each has its answer and two more frames of the page
 * have passed. A poll stops at the first moment the list matches; read again this way, a request
 * the page made just before (whose event had not arrived yet) is counted too (review PF2).
 */
async function settledMedia(page: Page, media: readonly Request[]): Promise<string[]> {
  await Promise.all(media.map((request) => request.response()))
  await frames(page)
  return media.map((request) => request.url()).sort()
}

/** What the page shows for the picture on screen, once its decode() has settled (10 s at most). */
interface PictureOnScreen {
  readonly decoded: string
  readonly failed: boolean
  readonly visibility: string
  readonly currentSrc: string
  readonly attributes: Readonly<Record<string, string>>
}

async function pictureOnScreen(page: Page): Promise<PictureOnScreen> {
  return page.locator(IMG).evaluate(async (img: HTMLImageElement) => {
    const decoded = await Promise.race([
      img.decode().then(
        () => 'ok',
        () => 'error',
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 10_000)),
    ])
    // Two frames, so a failure the island marks after the decode has been committed.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return {
      decoded,
      failed: img.hasAttribute('data-failed'),
      visibility: getComputedStyle(img).visibility,
      currentSrc: img.currentSrc,
      attributes: Object.fromEntries([...img.attributes].map((a) => [a.name, a.value])),
    }
  })
}

/** T-e1: the picture of `nodeId` is on screen, loaded, shown, with its exact attributes. */
async function expectLoaded(page: Page, nodeId: string): Promise<string> {
  const expected = picture(nodeId)
  await expect(page.locator(PART)).toHaveAttribute('data-node', nodeId)
  await expect(page.locator(IMG)).toHaveCount(1)
  const shown = await pictureOnScreen(page)
  expect(shown, `${nodeId}: the picture loaded and is shown`).toEqual({
    decoded: 'ok',
    failed: false,
    visibility: 'visible',
    currentSrc: expected.large,
    attributes: {
      'data-scene-image': '',
      srcset: expected.srcset,
      sizes: SCENE_IMAGE_SIZES,
      src: expected.urls[0],
      width: String(expected.width),
      height: String(expected.height),
      fetchpriority: 'high',
      alt: '',
      class: expect.any(String) as unknown as string,
    },
  })
  return shown.currentSrc
}

/** A box in page coordinates (CSS px). */
interface PageBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The band, its img and the story card below them, in page coordinates. */
async function bandBoxes(page: Page): Promise<{ band: PageBox; img: PageBox; card: PageBox }> {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector)
      if (element === null) throw new Error(`no ${selector}`)
      const rect = element.getBoundingClientRect()
      return {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      }
    }
    return {
      band: box('[data-part] [data-scene-band]'),
      img: box('[data-part] img[data-scene-image]'),
      card: box('[data-part] [data-story-card]'),
    }
  })
}

/** The size of a box, without its place. */
const sizeOf = ({ width, height }: PageBox) => ({ width, height })

/** The first line of the passage and what sits above it, in viewport px (T-e4b). */
interface FirstLine {
  readonly innerHeight: number
  readonly top: number
  readonly bottom: number
  readonly headerTop: number
  readonly scrollY: number
  readonly band: { readonly width: number; readonly height: number } | null
}

/**
 * The first line box of the first text node of the passage's first paragraph (a Range's first
 * client rect, so a paragraph that wraps counts its first line only). Throws when the paragraph,
 * its text or that line box is missing, so it never measures nothing.
 */
async function firstLine(page: Page): Promise<FirstLine> {
  return page.evaluate((selector) => {
    const paragraph = document.querySelector(selector)
    if (paragraph === null) throw new Error(`no ${selector}`)
    const text = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode()
    if (text === null || (text.textContent ?? '').trim() === '') {
      throw new Error('the first passage paragraph has no text')
    }
    const range = document.createRange()
    range.selectNodeContents(text)
    const line = range.getClientRects()[0]
    if (line === undefined) throw new Error('the first passage line has no box')
    const header = document.querySelector('[data-player] > header')
    if (header === null) throw new Error('no player header')
    const band = document.querySelector('[data-part] [data-scene-band]')?.getBoundingClientRect()
    return {
      innerHeight: window.innerHeight,
      top: line.top,
      bottom: line.bottom,
      headerTop: header.getBoundingClientRect().top,
      scrollY: window.scrollY,
      band: band === undefined ? null : { width: band.width, height: band.height },
    }
  }, FIRST_PARAGRAPH)
}

/**
 * A step has settled (D11-P8): the first paragraph has the focus, and the header is at the top of
 * the viewport, or the page is scrolled as far as it goes.
 */
async function stepSettled(page: Page, label: string): Promise<void> {
  await expect(page.locator(FIRST_PARAGRAPH).first(), `${label}: focus`).toBeFocused()
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const header = document.querySelector('[data-player] > header')
          if (header === null) return 'no player header'
          const top = header.getBoundingClientRect().top
          const end = document.documentElement.scrollHeight - window.innerHeight
          return Math.abs(top) <= 1 || window.scrollY >= end - 1 ? 'settled' : `header top ${top}`
        }),
      { timeout: 5000, message: `${label}: the header scrolled to the top` },
    )
    .toBe('settled')
}

/**
 * T-e4b: on `nodeId`, its picture decoded (or no band where it has none) and the fonts loaded, the
 * first story line is on screen: its top at 0 or below, its bottom at most innerHeight.
 */
async function expectFirstLineOnScreen(
  page: Page,
  code: LocaleCode,
  nodeId: string,
): Promise<void> {
  const label = `/${code} ${nodeId}`
  const hasPicture = PICTURES.has(nodeId)
  if (hasPicture) await expectLoaded(page, nodeId)
  else await expect(page.locator(BAND), `${label}: no picture`).toHaveCount(0)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await frames(page)
  const line = await firstLine(page)
  const band = line.band === null ? 'none' : `${line.band.width}x${line.band.height}`
  console.log(
    `[player-images] T-e4b ${label} (${test.info().project.name}): first line ` +
      `${line.top.toFixed(1)} to ${line.bottom.toFixed(1)} of innerHeight ${line.innerHeight}, ` +
      `margin ${(line.innerHeight - line.bottom).toFixed(1)} px; band ${band}; ` +
      `header top ${line.headerTop.toFixed(1)}, scrollY ${line.scrollY.toFixed(1)}`,
  )
  expect(line.band !== null && line.band.height > 0, `${label}: the picture band`).toBe(hasPicture)
  expect(line.bottom - line.top, `${label}: the first line box has a height`).toBeGreaterThan(0)
  expect(line.top, `${label}: the first line starts on screen`).toBeGreaterThanOrEqual(0)
  expect(
    line.bottom,
    `${label}: the first line ends above the fold (innerHeight ${line.innerHeight})`,
  ).toBeLessThanOrEqual(line.innerHeight)
}

/**
 * Holds every request for one picture's variants until the returned release is called (15 s at
 * most), then passes it on to the media stub. Returns how many it holds or held.
 */
async function holdPicture(
  page: Page,
  target: Picture,
): Promise<{ held: () => number; release: () => void }> {
  let held = 0
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(
    (url) => target.urls.includes(url.href),
    async (route) => {
      held++
      await Promise.race([released, sleep(15_000)])
      await route.fallback().catch(() => undefined)
    },
  )
  return { held: () => held, release }
}

/**
 * Opens the player without waiting for the load event, which a held picture would delay: the
 * document, then the open run.
 */
async function openHeld(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
  expect(response?.status(), url).toBe(200)
  await waitOpen(page)
}

/** Before any page script: records each error event of a scene picture, and whether React had hydrated. */
async function recordPictureErrors(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: { hydrated: boolean; phase: string | null }[] = []
    ;(window as unknown as Record<string, unknown>)['__e2ePictureErrors'] = seen
    document.addEventListener(
      'error',
      (event) => {
        const target = event.target
        if (!(target instanceof HTMLImageElement) || !target.hasAttribute('data-scene-image'))
          return
        const main = document.querySelector('main')
        seen.push({
          hydrated:
            main !== null && Object.keys(main).some((key) => key.startsWith('__reactFiber$')),
          phase: document.querySelector('[data-player]')?.getAttribute('data-run-phase') ?? null,
        })
      },
      { capture: true },
    )
  })
}

/** One decode() call of a scene picture: whether its img was in the page, and marked failed. */
interface SceneDecode {
  readonly connected: boolean
  readonly failed: boolean
}

/**
 * Before any page script: records each decode() call of a scene picture (the island's checks, and
 * this spec's own pictureOnScreen), so a test counts the island's calls between two of its steps.
 */
async function recordSceneDecodes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: { connected: boolean; failed: boolean }[] = []
    ;(window as unknown as Record<string, unknown>)['__e2eSceneDecodes'] = calls
    const decode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = function (this: HTMLImageElement): Promise<void> {
      if (this.hasAttribute('data-scene-image')) {
        calls.push({ connected: this.isConnected, failed: this.hasAttribute('data-failed') })
      }
      return decode.call(this)
    }
  })
}

const sceneDecodes = (page: Page): Promise<SceneDecode[]> =>
  pageValue<SceneDecode[]>(page, '__e2eSceneDecodes')

/**
 * Resizes the page and waits for its resize event: WebKit can merge quick viewport changes into
 * one event, or into none when they end at the size they started from. The island's check after a
 * resize asks its decode() in a frame callback of the same rendering update as the event.
 */
async function resizeTo(
  page: Page,
  size: { readonly width: number; readonly height: number },
): Promise<void> {
  const before = await page.evaluate(() => {
    const record = window as unknown as Record<string, unknown>
    if (typeof record['__e2eResizes'] !== 'number') {
      record['__e2eResizes'] = 0
      window.addEventListener('resize', () => {
        record['__e2eResizes'] = Number(record['__e2eResizes']) + 1
      })
    }
    return Number(record['__e2eResizes'])
  })
  await page.setViewportSize(size)
  await expect
    .poll(() => pageValue<number>(page, '__e2eResizes'), {
      timeout: 5000,
      message: `the resize event for ${size.width}x${size.height}`,
    })
    .toBeGreaterThan(before)
}

/** Waits until the island asked at least one decode() of its scene picture since `asked` calls. */
async function islandChecked(page: Page, asked: number, message: string): Promise<void> {
  await expect
    .poll(async () => (await sceneDecodes(page)).length - asked, { timeout: 5000, message })
    .toBeGreaterThan(0)
}

/** T-e3: the picture on screen failed: marked, hidden, its box the same size, the gradient shows. */
async function expectFailed(page: Page, before: { band: PageBox; img: PageBox }): Promise<void> {
  await expect(page.locator(IMG)).toHaveAttribute('data-failed', '')
  await expect(page.locator(BAND)).toHaveCount(1)
  const after = await bandBoxes(page)
  expect(
    { band: sizeOf(after.band), img: sizeOf(after.img) },
    'the box keeps its size (band and img)',
  ).toEqual({ band: sizeOf(before.band), img: sizeOf(before.img) })
  expect(await page.locator(IMG).evaluate((img) => getComputedStyle(img).visibility)).toBe('hidden')
  expect(
    await page.locator(RUN).evaluate((run) => getComputedStyle(run).backgroundImage),
    'the run area paints its scene gradient',
  ).toContain('linear-gradient')
  // ...and it shows where the picture was: the band and every element between it and the run
  // area paint no background (SPEC:489; review A11Y-10e-2).
  expect(
    await page.locator(BAND).evaluate((band) => {
      const painted: string[] = []
      for (
        let element: Element | null = band;
        element !== null && !element.hasAttribute('data-run');
        element = element.parentElement
      ) {
        const style = getComputedStyle(element)
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none') {
          painted.push(`${element.localName}: ${style.backgroundColor} ${style.backgroundImage}`)
        }
      }
      return painted
    }),
    'the band and the elements around it up to the run area paint no background',
  ).toEqual([])
}

/**
 * Stores a progress record with one active run of the picture story, as an earlier visit would
 * have left it (the seedProgressOnce way: an empty page on the site's origin, served by page.route,
 * written by evaluate; never an init script).
 */
async function seedPictureRun(page: Page, path: readonly string[], locale: LocaleCode) {
  const record: ProgressRecord = {
    schema: RECORD_SCHEMA,
    stories: {
      [PICTURE_STORY_ID]: {
        version: SOURCE.version,
        activeRun: { path: [...path], locale },
        endingsFound: [],
        order: 1,
      },
    },
  }
  const raw = serializeProgress(record)
  const isSeedPage = (url: URL): boolean => url.pathname === '/e2e-seed-progress'
  await page.route(isSeedPage, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="en"><head><title>e2e seed</title></head></html>',
    }),
  )
  const response = await page.goto('/e2e-seed-progress')
  expect(response?.status(), 'the page that seeds the progress record').toBe(200)
  const stored = await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
      return window.localStorage.getItem(key)
    },
    [PROGRESS_KEY, raw] as const,
  )
  expect(stored, 'the seeded progress record').toBe(raw)
  await page.unroute(isSeedPage)
}

test.describe('the scene images, Step 10e', { tag: '@staging' }, () => {
  test.use({ mediaStub: STUB })

  for (const code of ['en', 'hi'] as const) {
    test(`T-e1 /${code}: the start picture's img and the preload links`, async ({ page }) => {
      const media = mediaRequests(page)
      await openPlayer(page, urlOf(code))
      const start = picture('start')
      expect(start.srcset.split(', '), 'two widths').toHaveLength(2)
      await expectLoaded(page, 'start')
      // The band sits after the title and before the story card (design §4.1).
      expect(
        await page
          .locator('[data-part] [data-story] > *')
          .evaluateAll((children) =>
            children.map((child) =>
              child.hasAttribute('data-scene-band')
                ? 'band'
                : child.hasAttribute('data-story-card')
                  ? 'card'
                  : child.localName,
            ),
          ),
      ).toEqual(['h1', 'band', 'card'])
      // React's own high-priority preload of the current picture (server HTML), then the
      // low-priority preloads of the two pictures the fork can show (after the open commit).
      const expected = [
        preloadLink(start, 'high'),
        preloadLink(picture('flat_stones'), 'low'),
        preloadLink(picture('round_stones'), 'low'),
      ].sort(byImageSrcSet)
      await expect.poll(() => imagePreloads(page), { timeout: 5000 }).toEqual(expected)
      // No crossorigin and no href on any of them: the toEqual above holds every attribute.
      const files = [
        start.large,
        picture('flat_stones').large,
        picture('round_stones').large,
      ].sort()
      await expect
        .poll(() => media.map((request) => request.url()).sort(), { timeout: 5000 })
        .toEqual(files)
      expect(await settledMedia(page, media), 'the media requests, settled').toEqual(files)
    })
  }

  const WALKS: readonly {
    readonly code: LocaleCode
    readonly name: string
    readonly choices: readonly string[]
  }[] = [
    { code: 'en', name: 'the first path (far_bank square)', choices: ['c1', 'c1', 'c1', 'c1'] },
    { code: 'hi', name: 'the round stones', choices: ['c2', 'c1'] },
  ]
  for (const { code, name, choices } of WALKS) {
    test(`T-e1 T-e2 /${code} ${name}: every picture loads; one request per file at most, one per file shown`, async ({
      page,
    }) => {
      const media = mediaRequests(page)
      await openPlayer(page, urlOf(code))
      const visited = [GRAPH.startNodeId]
      const shown = [await expectLoaded(page, GRAPH.startNodeId)]
      for (const choiceId of choices) {
        const [node = ''] = await walk(page, SOURCE_ID, [choiceId])
        visited.push(node)
        if (PICTURES.has(node)) shown.push(await expectLoaded(page, node))
        else await expect(page.locator(BAND), `${node}: no picture`).toHaveCount(0)
      }
      // The pictures the page may ask for: each one shown, and each prefetch candidate of a node
      // it showed (D11-P22), each by the file the browser picks; never the 768 one (P-IMG).
      const expected = new Set([
        ...shown,
        ...visited.flatMap((node) => candidatesOf(node).map((candidate) => candidate.large)),
      ])
      await expect
        .poll(() => new Set(media.map((request) => request.url())), { timeout: 5000 })
        .toEqual(expected)
      expect(new Set(await settledMedia(page, media)), 'the media files, settled').toEqual(expected)
      const counts = new Map<string, number>()
      for (const request of media) counts.set(request.url(), (counts.get(request.url()) ?? 0) + 1)
      const repeated = [...counts].filter(([, count]) => count > 1)
      expect(repeated, 'media URLs requested more than once').toEqual([])
      expect(
        shown.map((url) => counts.get(url)),
        'each shown file requested exactly once',
      ).toEqual(shown.map(() => 1))
      console.log(
        `[player-images] T-e2 /${code} ${name} (${test.info().project.name}): ` +
          `${media.length} media requests for ${shown.length} pictures shown, nodes ${visited.join(' > ')}`,
      )
    })
  }

  // D11-P22: nothing is prefetched while the run opens. A resumed run shows another node than the
  // server-rendered start node, so a prefetch then would fetch the start node's next pictures for
  // nothing (review PF1). round_stones' next pictures: ending_wet; ending_back has none.
  test('T-e1 /en resumed at round_stones: the low-priority preload is its own next picture only', async ({
    page,
  }) => {
    await seedPictureRun(page, [GRAPH.startNodeId, 'round_stones'], 'en')
    const media = mediaRequests(page)
    await openPlayer(page, urlOf('en'))
    await expectLoaded(page, 'round_stones')
    // The server-rendered start picture, the resumed one and its one candidate; never the start
    // node's candidates (flat_stones).
    const files = [
      picture('start').large,
      picture('round_stones').large,
      picture('ending_wet').large,
    ].sort()
    await expect
      .poll(() => media.map((request) => request.url()).sort(), { timeout: 5000 })
      .toEqual(files)
    expect(await settledMedia(page, media), 'the media requests, settled').toEqual(files)
    await expect
      .poll(() => imagePreloads(page), { timeout: 5000 })
      .toEqual(
        [preloadLink(picture('start'), 'high'), preloadLink(picture('ending_wet'), 'low')].sort(
          byImageSrcSet,
        ),
      )
  })

  // S10E-STRESS-1: the width changes while a picture loads (a phone turns). Where the turn picks the
  // larger file (turnPicksLarger: Chromium, and WebKit on the iPad, whose turn crosses 60rem), the
  // browser swaps the img's request, which rejects the decode() the island waits on; the island
  // asks again, and the picture shows. On the iPhone WebKit keeps its first pick (probe), so there
  // the held file simply arrives. Either way the picture is never marked failed, also after Back.
  test('T-e3 /en: a picture whose file the browser swaps while it loads (the phone turns) is shown, also after Back', async ({
    page,
    browserName,
  }) => {
    const viewport = page.viewportSize()
    if (viewport === null) throw new Error('no viewport')
    const start = picture('start')
    const [small = '', large = ''] = start.urls
    const media = mediaRequests(page)
    await page.setViewportSize({ width: NARROW_WIDTH, height: viewport.height })
    const hold = await holdPicture(page, { ...start, urls: [small] })
    await openHeld(page, urlOf('en'))
    // The narrow page asked for the 768 file, which is held.
    await expect.poll(hold.held, { timeout: 5000 }).toBe(1)
    await frames(page)
    expect(await page.locator(IMG).getAttribute('data-failed'), 'not failed while held').toBeNull()
    // The phone turns: the landscape screen.
    await page.setViewportSize({
      width: Math.max(viewport.width, viewport.height),
      height: Math.min(viewport.width, viewport.height),
    })
    if (turnPicksLarger(browserName, viewport)) {
      // The browser swapped the request: the large file is asked for while the 768 one is held.
      await expect
        .poll(() => media.map((request) => request.url()), { timeout: 5000 })
        .toContain(large)
    }
    await frames(page)
    hold.release()
    const visible = { decoded: 'ok', failed: false, visibility: 'visible' }
    const atStart = await pictureOnScreen(page)
    expect(
      { decoded: atStart.decoded, failed: atStart.failed, visibility: atStart.visibility },
      'start, after the swap',
    ).toEqual(visible)
    await walk(page, SOURCE_ID, ['c1'])
    const back = page.locator(`${PART} button[data-back]`)
    await expect
      .poll(() => back.evaluate((button) => button.closest('[inert]') === null), { timeout: 5000 })
      .toBe(true)
    await back.click()
    await expect(page.locator(PART)).toHaveAttribute('data-node', GRAPH.startNodeId)
    const again = await pictureOnScreen(page)
    expect(
      { decoded: again.decoded, failed: again.failed, visibility: again.visibility },
      'start again, after Back (a new img)',
    ).toEqual(visible)
  })

  // R2-decode-retry-1 (b) and (d), review R3-ADV-1: resizes after the load never mark a good
  // picture. Each one starts the island's check (a decode() call), which resolves: the URL bar
  // showing and hiding (height only) and quick narrower widths keep the 768 file; the turn picks the
  // good larger file where it picks one (turnPicksLarger), and that file shows.
  test('T-e3 /en: resizes after the load never mark a good picture: the URL bar, quick narrower widths, and the larger file the turn picks', async ({
    page,
    browserName,
  }) => {
    const viewport = page.viewportSize()
    if (viewport === null) throw new Error('no viewport')
    const [small = '', large = ''] = picture('start').urls
    const picksLarger = turnPicksLarger(browserName, viewport)
    await recordSceneDecodes(page)
    const media = mediaRequests(page)
    await page.setViewportSize({ width: NARROW_WIDTH, height: viewport.height })
    await openPlayer(page, urlOf('en'))
    const loaded = await pictureOnScreen(page)
    expect(
      { decoded: loaded.decoded, failed: loaded.failed, currentSrc: loaded.currentSrc },
      'the narrow page loaded the 768 file',
    ).toEqual({ decoded: 'ok', failed: false, currentSrc: small })
    // The URL bar shows and hides, and the window narrows a little, a frame apart: the 768 file
    // stays.
    const asked = (await sceneDecodes(page)).length
    for (const size of [
      { width: NARROW_WIDTH, height: viewport.height - 56 },
      { width: NARROW_WIDTH, height: viewport.height },
      { width: NARROW_WIDTH, height: viewport.height - 56 },
      { width: NARROW_WIDTH, height: viewport.height },
      { width: NARROW_WIDTH - 10, height: viewport.height },
      { width: NARROW_WIDTH - 20, height: viewport.height },
      { width: NARROW_WIDTH, height: viewport.height },
    ]) {
      await resizeTo(page, size)
    }
    // The island's calls only: before pictureOnScreen asks its own.
    await islandChecked(page, asked, "the resizes started the island's check")
    const kept = await pictureOnScreen(page)
    expect(
      {
        decoded: kept.decoded,
        failed: kept.failed,
        visibility: kept.visibility,
        currentSrc: kept.currentSrc,
      },
      'after the URL bar and the narrower widths',
    ).toEqual({ decoded: 'ok', failed: false, visibility: 'visible', currentSrc: small })
    // The phone turns. A decode() asked before the browser swaps the request is rejected by the
    // swap, so this one waits for the larger file's request.
    await resizeTo(page, turned(viewport))
    if (picksLarger) {
      await expect
        .poll(() => media.map((request) => request.url()), { timeout: 5000 })
        .toContain(large)
      await Promise.all(
        media.filter((request) => request.url() === large).map((request) => request.response()),
      )
    }
    await frames(page)
    const shown = await pictureOnScreen(page)
    expect(
      {
        decoded: shown.decoded,
        failed: shown.failed,
        visibility: shown.visibility,
        currentSrc: shown.currentSrc,
      },
      'after the turn',
    ).toEqual({
      decoded: 'ok',
      failed: false,
      visibility: 'visible',
      currentSrc: picksLarger ? large : small,
    })
    // And the URL bar once more, turned.
    const turnedSize = turned(viewport)
    const askedTurned = (await sceneDecodes(page)).length
    await resizeTo(page, { ...turnedSize, height: turnedSize.height - 56 })
    await resizeTo(page, turnedSize)
    await islandChecked(page, askedTurned, "the URL bar, turned, started the island's check")
    const last = await pictureOnScreen(page)
    expect(
      { decoded: last.decoded, failed: last.failed, currentSrc: last.currentSrc },
      'after the URL bar, turned',
    ).toEqual({ decoded: 'ok', failed: false, currentSrc: picksLarger ? large : small })
    if (!picksLarger) {
      expect(
        media.map((request) => request.url()),
        'the larger file is never asked',
      ).not.toContain(large)
    }
  })

  // R2-decode-retry-1: the larger file the browser picks when the phone turns fails. Chromium
  // fires no error event for it, so only the island's check after a resize can see it; WebKit
  // fires one where it picks that file (the iPad). The stub aborts the start picture's larger file;
  // the smaller one loads. Skipped where the turn picks no other file: on the iPhone WebKit keeps
  // its first pick (probe; review R3-ADV-2), so the larger file is never asked for.
  test.describe('a larger file that fails when the phone turns', () => {
    const start = picture('start')
    const [small = '', large = ''] = start.urls
    test.use({ mediaStub: { ...STUB, urls: MEDIA_URLS.filter((url) => url !== large) } })
    const KEEPS_FIRST_PICK =
      'the turn crosses no media condition of sizes, so WebKit keeps its first srcset pick ' +
      '(probe): the larger file is never asked'

    test('T-e3 /en: after the picture has loaded, the larger file the browser picks when the phone turns fails: the picture is marked, and not checked again', async ({
      page,
      browserName,
      errors,
    }) => {
      const viewport = page.viewportSize()
      if (viewport === null) throw new Error('no viewport')
      test.skip(!turnPicksLarger(browserName, viewport), KEEPS_FIRST_PICK)
      errors.allow({ chromium: [ABORTED_LINE] })
      await recordSceneDecodes(page)
      await page.setViewportSize({ width: NARROW_WIDTH, height: viewport.height })
      const hold = await holdPicture(page, { ...start, urls: [large] })
      await openPlayer(page, urlOf('en'))
      const loaded = await pictureOnScreen(page)
      expect(
        { decoded: loaded.decoded, failed: loaded.failed, currentSrc: loaded.currentSrc },
        'the narrow page loaded the 768 file',
      ).toEqual({ decoded: 'ok', failed: false, currentSrc: small })
      expect(hold.held(), 'the larger file is not asked for yet').toBe(0)
      // The phone turns: Chromium asks for the larger file, held until the box is measured.
      await page.setViewportSize(turned(viewport))
      await expect.poll(hold.held, { timeout: 5000 }).toBeGreaterThan(0)
      await frames(page)
      const before = await bandBoxes(page)
      expect(
        await page.locator(IMG).getAttribute('data-failed'),
        'not failed while the larger file is held',
      ).toBeNull()
      hold.release()
      await expectFailed(page, before)
      expect(
        await page.locator(IMG).evaluate((img: HTMLImageElement) => img.currentSrc),
        'the img picked the larger file',
      ).toBe(large)
      // A failed picture is not checked again (review R3-PF-1): resizes after the mark (the URL
      // bar, a little narrower; no other file picked) ask no decode() of it.
      const asked = (await sceneDecodes(page)).length
      const turnedSize = turned(viewport)
      for (const size of [
        { ...turnedSize, height: turnedSize.height - 56 },
        turnedSize,
        { ...turnedSize, width: turnedSize.width - 40 },
        turnedSize,
      ]) {
        await resizeTo(page, size)
      }
      await frames(page)
      expect((await sceneDecodes(page)).slice(asked), 'decode() calls after the mark').toEqual([])
      await expect(page.locator(IMG)).toHaveAttribute('data-failed', '')
    })

    test('T-e3 /en: the larger file picked while the smaller one is held fails: the picture is marked', async ({
      page,
      browserName,
      errors,
    }) => {
      const viewport = page.viewportSize()
      if (viewport === null) throw new Error('no viewport')
      test.skip(!turnPicksLarger(browserName, viewport), KEEPS_FIRST_PICK)
      errors.allow({ chromium: [ABORTED_LINE] })
      await page.setViewportSize({ width: NARROW_WIDTH, height: viewport.height })
      const holdSmall = await holdPicture(page, { ...start, urls: [small] })
      const holdLarge = await holdPicture(page, { ...start, urls: [large] })
      await openHeld(page, urlOf('en'))
      // The narrow page asked for the 768 file, which is held.
      await expect.poll(holdSmall.held, { timeout: 5000 }).toBe(1)
      await frames(page)
      // The phone turns while it is held: Chromium swaps the request for the larger file.
      await page.setViewportSize(turned(viewport))
      await expect.poll(holdLarge.held, { timeout: 5000 }).toBeGreaterThan(0)
      await frames(page)
      const before = await bandBoxes(page)
      expect(
        await page.locator(IMG).getAttribute('data-failed'),
        'not failed while both files are held',
      ).toBeNull()
      // The stub aborts the larger file; the swapped 768 request is passed on after it.
      holdLarge.release()
      holdSmall.release()
      await expectFailed(page, before)
      expect(
        await page.locator(IMG).evaluate((img: HTMLImageElement) => img.currentSrc),
        'the img picked the larger file',
      ).toBe(large)
    })

    // R2-decode-retry-1 (e), review R3-PF-1: a step while the check after the turn waits on the
    // held larger file. Each step is a new part, so the step unmounts the picture; its check then
    // asks nothing of the old img, also when the held file fails and the window resizes again.
    test('T-e3 /en: a step while the check after the turn waits on the larger file leaves the old picture alone', async ({
      page,
      browserName,
      errors,
    }) => {
      const viewport = page.viewportSize()
      if (viewport === null) throw new Error('no viewport')
      test.skip(!turnPicksLarger(browserName, viewport), KEEPS_FIRST_PICK)
      errors.allow({ chromium: [ABORTED_LINE] })
      await recordSceneDecodes(page)
      const media = mediaRequests(page)
      await page.setViewportSize({ width: NARROW_WIDTH, height: viewport.height })
      const hold = await holdPicture(page, { ...start, urls: [large] })
      await openPlayer(page, urlOf('en'))
      const loaded = await pictureOnScreen(page)
      expect(
        { decoded: loaded.decoded, failed: loaded.failed, currentSrc: loaded.currentSrc },
        'the narrow page loaded the 768 file',
      ).toEqual({ decoded: 'ok', failed: false, currentSrc: small })
      const asked = (await sceneDecodes(page)).length
      // The phone turns: the island's check waits on the larger file, held.
      await resizeTo(page, turned(viewport))
      await expect.poll(hold.held, { timeout: 5000 }).toBeGreaterThan(0)
      await islandChecked(page, asked, 'the check after the turn asked decode()')
      expect(
        await page.locator(IMG).getAttribute('data-failed'),
        'not failed while the larger file is held',
      ).toBeNull()
      // The step: flat_stones, a new part with its own picture.
      const [node = ''] = await walk(page, SOURCE_ID, ['c1'])
      expect(node).toBe('flat_stones')
      // The larger file fails now (the stub aborts it), and the window resizes again.
      hold.release()
      await Promise.all(
        media.filter((request) => request.url() === large).map((request) => request.response()),
      )
      const turnedSize = turned(viewport)
      await resizeTo(page, { ...turnedSize, height: turnedSize.height - 56 })
      await resizeTo(page, turnedSize)
      await frames(page)
      expect(
        (await sceneDecodes(page)).filter((call) => !call.connected),
        'decode() calls of an img no longer in the page',
      ).toEqual([])
      const next = await pictureOnScreen(page)
      expect({ decoded: next.decoded, failed: next.failed }, 'the flat_stones picture').toEqual({
        decoded: 'ok',
        failed: false,
      })
    })
  })

  // T-e4: the box has the picture's size before its file arrives, so the load moves nothing.
  const BOXES: readonly {
    readonly name: string
    readonly nodeId: string
    readonly choices: readonly string[]
  }[] = [
    { name: 'the wide start picture', nodeId: 'start', choices: [] },
    { name: 'the square far_bank picture', nodeId: 'far_bank', choices: ['c1', 'c1', 'c1'] },
  ]
  for (const { name, nodeId, choices } of BOXES) {
    test(`T-e4 /en ${name}: box geometry identical before and after the file arrives`, async ({
      page,
    }) => {
      const target = picture(nodeId)
      const hold = await holdPicture(page, target)
      await openHeld(page, urlOf('en'))
      if (choices.length > 0) await walk(page, SOURCE_ID, choices)
      await expect(page.locator(PART)).toHaveAttribute('data-node', nodeId)
      await expect.poll(hold.held, { timeout: 5000 }).toBeGreaterThan(0)
      // The fonts being fetched have arrived, so nothing else moves between the two measures. Not
      // document.fonts.ready: WebKit holds it until the page's load event, which the held
      // picture delays.
      await page.evaluate(async () => {
        const loading = [...document.fonts].filter((face) => face.status === 'loading')
        await Promise.all(loading.map((face) => face.loaded.catch(() => undefined)))
      })
      await frames(page)
      // Not loaded yet: its decode() is still waiting (WebKit reports `complete` true for the
      // server-rendered img while its file is held, so that flag says nothing here).
      const held = await page.locator(IMG).evaluate(async (img: HTMLImageElement) => {
        const state = await Promise.race([
          img.decode().then(
            () => 'loaded',
            () => 'failed',
          ),
          new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 300)),
        ])
        return { state, complete: img.complete }
      })
      expect(held.state, `the file is still held (complete ${String(held.complete)})`).toBe(
        'pending',
      )
      const before = await bandBoxes(page)
      // The box already has the picture's own ratio, capped at --scene-band-max.
      const cap = await page
        .locator(BAND)
        .evaluate((band) => parseFloat(getComputedStyle(band).maxBlockSize))
      expect(before.band.height).toBeCloseTo(
        Math.min((before.band.width * target.height) / target.width, cap),
        0,
      )
      hold.release()
      const shown = await pictureOnScreen(page)
      expect({ decoded: shown.decoded, failed: shown.failed }).toEqual({
        decoded: 'ok',
        failed: false,
      })
      await frames(page)
      const after = await bandBoxes(page)
      console.log(
        `[player-images] T-e4 ${name} (${test.info().project.name}): ` +
          `before ${JSON.stringify(before)}; after ${JSON.stringify(after)}; cap ${cap}`,
      )
      expect(after, 'band, img and story card (page px)').toEqual(before)
    })
  }

  // T-e4b (review A11Y-10e-1, design R34): at 100% text the first story line is above the fold on
  // a picture node, with the picture above it. The path: start, flat_stones (wide), big_rock (no
  // picture), far_bank (square, the tallest band).
  const FOLD_PATH: readonly { readonly choiceId: string; readonly nodeId: string }[] = [
    { choiceId: 'c1', nodeId: 'flat_stones' },
    { choiceId: 'c1', nodeId: 'big_rock' },
    { choiceId: 'c1', nodeId: 'far_bank' },
  ]
  for (const code of ['en', 'hi'] as const) {
    test(`T-e4b /${code}: at 100% text the first story line is above the fold on a picture node, at the start and after each step`, async ({
      page,
    }) => {
      expect([SHAPES['flat_stones'], SHAPES['far_bank']], 'a wide and a square picture').toEqual([
        WIDE,
        SQUARE,
      ])
      await openPlayer(page, urlOf(code))
      expect(
        await page
          .locator('html')
          .evaluate((html, attribute) => html.getAttribute(attribute), TEXT_SCALE_ATTRIBUTE),
        'data-text-scale (none: 100%)',
      ).toBeNull()
      await expectFirstLineOnScreen(page, code, GRAPH.startNodeId)
      for (const { choiceId, nodeId } of FOLD_PATH) {
        const [node = ''] = await walk(page, SOURCE_ID, [choiceId])
        expect(node, `/${code} ${choiceId}`).toBe(nodeId)
        await stepSettled(page, `/${code} ${nodeId}`)
        await expectFirstLineOnScreen(page, code, nodeId)
      }
    })
  }

  // T-e5: the long Hindi passage (3,648 characters, design §4.5, O2) on a resumed load.
  const T_E5: readonly {
    readonly wide: boolean
    readonly scale: TextScale
    readonly name: string
  }[] = [
    { wide: false, scale: 100, name: '' },
    { wide: true, scale: 100, name: ' with a wide Devanagari fallback' },
    { wide: false, scale: 150, name: ' at 150%' },
    { wide: true, scale: 150, name: ' at 150% with a wide Devanagari fallback' },
  ]
  for (const { wide, scale, name } of T_E5) {
    test(`T-e5 /hi${name}: fonts held 1.5 s shift the long passage by less than 0.1 (Chromium)`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'the Layout Instability API is Chromium only')
      test.skip(
        scale !== 100 && !PHONES.includes(test.info().project.name),
        '150% is checked on the phones (the LAYOUT STABILITY rule)',
      )
      const longText = LONG_TEXT
      await seedPictureRun(page, [GRAPH.startNodeId, LONG_PASSAGE.nodeId], LONG_PASSAGE.locale)
      if (wide) await wideDevanagariFallback(page)
      if (scale !== 100) await seedPrefs(page, prefsText(scale))
      await recordLayoutShifts(page)
      let delayed = 0
      let released = 0
      await page.route(
        (url) => LORA_FILE.test(url.pathname) || NOTO_FILE.test(url.pathname),
        async (route) => {
          delayed++
          await sleep(1500)
          await route.continue().catch(() => undefined)
          released++
        },
      )
      const response = await page.goto(urlOf(LONG_PASSAGE.locale), {
        waitUntil: 'domcontentloaded',
      })
      expect(response?.status(), 'status').toBe(200)
      await expect.poll(() => delayed, { timeout: 15_000 }).toBeGreaterThan(0)
      await expect.poll(() => released === delayed, { timeout: 15_000 }).toBe(true)
      await waitOpen(page)
      await expect(page.locator(PART)).toHaveAttribute('data-node', LONG_PASSAGE.nodeId)
      const paragraphs = await page
        .locator('[data-part] [data-passage] p')
        .evaluateAll((list) => list.map((p) => p.textContent ?? ''))
      expect(paragraphs.join('\n\n'), 'the long passage as stored').toBe(longText)
      expect(longText.length).toBeGreaterThanOrEqual(3600)
      const shown = await pictureOnScreen(page)
      expect({ decoded: shown.decoded, failed: shown.failed }, 'its picture').toEqual({
        decoded: 'ok',
        failed: false,
      })
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 500)))
          }),
      )
      const timing = await page.evaluate(
        (patterns) => ({
          firstPaint:
            performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? Number.NaN,
          fontEnd: Math.max(
            ...performance
              .getEntriesByType('resource')
              .filter((entry) => patterns.some((pattern) => new RegExp(pattern).test(entry.name)))
              .map((entry) => (entry as PerformanceResourceTiming).responseEnd),
          ),
        }),
        [LORA_FILE.source, NOTO_FILE.source],
      )
      const scaleAttribute = await page
        .locator('html')
        .evaluate((html, attribute) => html.getAttribute(attribute), TEXT_SCALE_ATTRIBUTE)
      expect(scaleAttribute, 'data-text-scale').toBe(scale === 100 ? null : String(scale))
      if (wide) {
        // Missing when the fallback was never installed (review PF4).
        const faces = await page.evaluate(async () => {
          const loaded = (window as unknown as Record<string, unknown>)['__e2eWideFallback']
          if (loaded === undefined) return 'missing'
          await loaded
          return 'loaded'
        })
        expect(faces, 'the wide fallback faces').toBe('loaded')
      }
      const { cls, raw, shifts, inputShifts, lines } = await layoutShift(page)
      const description =
        `CLS ${cls.toFixed(6)}, raw ${raw.toFixed(6)} (${shifts} shifts, ${inputShifts} flagged ` +
        `as recent input; ${delayed} font files held; first paint ${timing.firstPaint.toFixed(0)} ` +
        `ms, fonts arrived ${timing.fontEnd.toFixed(0)} ms; passage ${longText.length} characters)`
      console.log(`[player-images] T-e5 /hi${name} (${test.info().project.name}): ${description}`)
      for (const line of lines) {
        console.log(`[player-images] T-e5 /hi${name} (${test.info().project.name}): ${line}`)
      }
      test.info().annotations.push({ type: 'CLS', description })
      // The page painted before the fonts arrived, so the swap was measured.
      expect(timing.firstPaint).toBeLessThan(timing.fontEnd)
      expect(cls).toBeLessThan(0.1)
    })
  }

  // T-e7: a node without a picture has no band and no img, and keeps its scene gradient.
  const NO_PICTURE: readonly { readonly nodeId: string; readonly choices: readonly string[] }[] = [
    { nodeId: 'big_rock', choices: ['c1', 'c1'] },
    { nodeId: 'ending_back', choices: ['c2', 'c2'] },
  ]
  for (const { nodeId, choices } of NO_PICTURE) {
    test(`T-e7 /en ${nodeId}: no picture, no box`, async ({ page }) => {
      expect(PICTURES.has(nodeId), `${nodeId} has no picture in the story`).toBe(false)
      await openPlayer(page, urlOf('en'))
      await walk(page, SOURCE_ID, choices)
      await expect(page.locator(PART)).toHaveAttribute('data-node', nodeId)
      await frames(page)
      await expect(page.locator(BAND)).toHaveCount(0)
      await expect(page.locator(`${PART} img`)).toHaveCount(0)
      await expect(page.locator(RUN)).toHaveAttribute('data-scene', 'forest-day')
      expect(
        await page.locator(RUN).evaluate((run) => getComputedStyle(run).backgroundImage),
      ).toContain('linear-gradient')
    })
  }

  // T-e3: an aborted picture. The stub leaves the start picture out, so it aborts its requests.
  test.describe('a picture that fails', () => {
    const start = picture('start')
    test.use({
      mediaStub: { ...STUB, urls: MEDIA_URLS.filter((url) => !start.urls.includes(url)) },
    })

    test('T-e3 /en: aborted before hydration, only the decode() check can see it', async ({
      page,
      errors,
    }) => {
      errors.allow({ chromium: [ABORTED_LINE] })
      await recordPictureErrors(page)
      let release: () => void = () => undefined
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route(
        (url) => url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js'),
        async (route) => {
          await Promise.race([released, sleep(15_000)])
          await route.continue().catch(() => undefined)
        },
      )
      const response = await page.goto(urlOf('en'), { waitUntil: 'domcontentloaded' })
      expect(response?.status(), 'status').toBe(200)
      await expect
        .poll(async () => (await pageValue<unknown[]>(page, '__e2ePictureErrors')).length, {
          timeout: 10_000,
        })
        .toBeGreaterThan(0)
      const before = await bandBoxes(page)
      const state = await page.evaluate(() => ({
        errors: (window as unknown as Record<string, unknown>)['__e2ePictureErrors'],
        failed: document
          .querySelector('[data-part] img[data-scene-image]')
          ?.hasAttribute('data-failed'),
      }))
      expect(state.failed, 'not marked before hydration').toBe(false)
      expect(state.errors, 'the picture failed while the page was not hydrated').toEqual(
        expect.arrayContaining([{ hydrated: false, phase: 'opening' }]),
      )
      expect(
        (state.errors as { hydrated: boolean }[]).every((error) => !error.hydrated),
        'every error event so far came before hydration',
      ).toBe(true)
      release()
      await waitOpen(page)
      await expectFailed(page, before)
    })

    test('T-e3 /en: aborted after hydration, the img reports it', async ({ page, errors }) => {
      errors.allow({ chromium: [ABORTED_LINE] })
      await recordPictureErrors(page)
      const hold = await holdPicture(page, start)
      await openHeld(page, urlOf('en'))
      await expect.poll(hold.held, { timeout: 5000 }).toBeGreaterThan(0)
      await frames(page)
      const before = await bandBoxes(page)
      expect(await page.locator(IMG).getAttribute('data-failed')).toBeNull()
      expect(await pageValue<unknown[]>(page, '__e2ePictureErrors')).toEqual([])
      hold.release()
      await expectFailed(page, before)
      const seen = await pageValue<{ hydrated: boolean; phase: string | null }[]>(
        page,
        '__e2ePictureErrors',
      )
      expect(seen.length, 'error events').toBeGreaterThan(0)
      expect(seen.every((error) => error.hydrated && error.phase === 'open')).toBe(true)
      await expect(page.locator(PLAYER)).toHaveAttribute('data-run-phase', 'open')
    })

    // The case above cannot tell onError from the decode() check: that decode() is pending when the
    // file is aborted, so it rejects too. Here every decode() of the page never settles, so only
    // the img's error event can tell the island (review R-FS-4).
    test('T-e3 /en: aborted after hydration while decode() never settles, onError alone reports it', async ({
      page,
      errors,
    }) => {
      errors.allow({ chromium: [ABORTED_LINE] })
      await page.addInitScript(() => {
        HTMLImageElement.prototype.decode = () => new Promise<void>(() => undefined)
      })
      const hold = await holdPicture(page, start)
      await openHeld(page, urlOf('en'))
      await expect.poll(hold.held, { timeout: 5000 }).toBeGreaterThan(0)
      await frames(page)
      const before = await bandBoxes(page)
      expect(await page.locator(IMG).getAttribute('data-failed')).toBeNull()
      hold.release()
      await expectFailed(page, before)
    })
  })
})

// ---------------------------------------------------------------------------------------------
// The owner's P1-4 picture screens, 27-29 (design §10.3, R34; header above)

/** The visible test picture of screens 27 and 29: the wide shape, so it fills the start box. */
const TEST_PICTURE = WIDE

/**
 * The visible test picture (review I1: the 1×1 stub shows nothing, so a loaded picture looked like a
 * failed one): a simple scene with a centred TEST PICTURE label, drawn by Chromium's canvas and
 * encoded as WebP. It is drawn in a browser context of its own on about:blank (no request, nothing
 * the test's context or its guard sees), then closed. Throws when the canvas gives no WebP.
 */
async function testPictureWebp(browser: Browser): Promise<Buffer> {
  const context = await browser.newContext()
  try {
    const blank = await context.newPage()
    const dataUrl = await blank.evaluate(
      ({ width, height }) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const g = canvas.getContext('2d')
        if (g === null) throw new Error('no 2d canvas context')
        const sky = g.createLinearGradient(0, 0, 0, height)
        sky.addColorStop(0, '#8ec5e8')
        sky.addColorStop(1, '#eaf4dc')
        g.fillStyle = sky
        g.fillRect(0, 0, width, height)
        g.fillStyle = '#f4c542'
        g.beginPath()
        g.arc(width * 0.84, height * 0.2, height * 0.09, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#7cb85f'
        g.beginPath()
        g.moveTo(0, height)
        g.quadraticCurveTo(width * 0.3, height * 0.4, width * 0.64, height)
        g.fill()
        g.fillStyle = '#3f7d36'
        g.beginPath()
        g.moveTo(width * 0.36, height)
        g.quadraticCurveTo(width * 0.76, height * 0.46, width, height * 0.78)
        g.lineTo(width, height)
        g.fill()
        // The label stays in the middle, so a band that crops the picture (object-fit: cover)
        // keeps it.
        const panel = { x: width * 0.17, y: height * 0.35, w: width * 0.66, h: height * 0.3 }
        g.fillStyle = 'rgba(255, 255, 255, 0.88)'
        g.fillRect(panel.x, panel.y, panel.w, panel.h)
        g.strokeStyle = '#1f2a37'
        g.lineWidth = 6
        g.strokeRect(panel.x, panel.y, panel.w, panel.h)
        g.fillStyle = '#1f2a37'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.font = `bold ${Math.round(height * 0.12)}px sans-serif`
        g.fillText('TEST PICTURE', width / 2, height * 0.46)
        g.font = `${Math.round(height * 0.045)}px sans-serif`
        g.fillText(
          `e2e placeholder, not story art (${width} × ${height})`,
          width / 2,
          height * 0.575,
        )
        return canvas.toDataURL('image/webp', 0.9)
      },
      { width: TEST_PICTURE.width, height: TEST_PICTURE.height },
    )
    const prefix = 'data:image/webp;base64,'
    if (!dataUrl.startsWith(prefix)) {
      throw new Error(`the canvas gave no WebP: ${dataUrl.slice(0, 32)}`)
    }
    return Buffer.from(dataUrl.slice(prefix.length), 'base64')
  } finally {
    await context.close()
  }
}

/**
 * Screens 27 and 29: the img shows the visible test picture, not the 1×1 stub. A srcset `w`
 * descriptor scales the natural size by the source size (`sizes`, in CSS px) over the descriptor
 * width, so the test picture's natural width is its source size (hundreds of px) and its natural
 * height keeps the picture's ratio, while the 1×1 stub's natural width is 1 or less.
 */
async function expectTestPicture(page: Page): Promise<void> {
  const natural = await page.locator(IMG).evaluate((img: HTMLImageElement) => ({
    width: img.naturalWidth,
    height: img.naturalHeight,
  }))
  const label = `the img shows the visible test picture, not the 1×1 stub (natural ${natural.width}x${natural.height})`
  expect(natural.width, label).toBeGreaterThanOrEqual(100)
  expect(
    Math.abs(natural.height - (natural.width * TEST_PICTURE.height) / TEST_PICTURE.width),
    `${label}: the ${TEST_PICTURE.width}x${TEST_PICTURE.height} ratio`,
  ).toBeLessThanOrEqual(1)
}

/** Asserts the text size, waits for every animation and font, then takes the full-page shot. */
async function shootScreen(page: Page, nn: string, name: string, scale: TextScale): Promise<void> {
  expect(await page.locator('html').getAttribute(TEXT_SCALE_ATTRIBUTE), 'the text size').toBe(
    scale === 100 ? null : String(scale),
  )
  await settleForScreenshot(page)
  await page.screenshot({
    path: step10ScreenPath(nn, name, test.info().project.name, scale),
    fullPage: true,
  })
}

test.describe('the P1-4 owner screens: pictures', { tag: '@staging' }, () => {
  test.skip(process.env['SCREENS'] !== '1', 'owner screenshots: run with SCREENS=1')
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'the P1-4 owner set is the 3 Chromium viewports (design §10.3)',
  )
  // Screens 27 and 29: the stub serves the visible test picture for every picture URL (review I1).
  test.use({
    mediaStub: async ({ browser }, provide) => {
      await provide({ ...STUB, body: await testPictureWebp(browser) })
    },
  })

  test('screen 27: a picture node (the start picture loaded), en', async ({ page }) => {
    await openPlayer(page, urlOf('en'))
    await expectLoaded(page, 'start')
    await expectTestPicture(page)
    await shootScreen(page, '27', 'player-picture-en', 100)
  })

  test('screen 29 (R34): a picture node at 150% text on the phone, en', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium-phone', 'R34 names the phone only')
    await seedPrefs(page, prefsText(150))
    await openPlayer(page, urlOf('en'))
    await expectLoaded(page, 'start')
    await expectTestPicture(page)
    const line = await firstLine(page)
    console.log(
      `[player-images] screen 29 (${test.info().project.name}): first line ` +
        `${line.top.toFixed(1)} to ${line.bottom.toFixed(1)} of innerHeight ${line.innerHeight} ` +
        `at 150% (R34, an accepted risk)`,
    )
    await shootScreen(page, '29', 'player-picture-150-en', 150)
  })

  // The T-e3 "aborted after hydration" case: the stub leaves the start picture out, so it aborts.
  // Its own stub replaces the one above: the 1×1 picture (no other picture is on screen).
  test.describe('a picture that fails', () => {
    const start = picture('start')
    test.use({
      mediaStub: { ...STUB, urls: MEDIA_URLS.filter((url) => !start.urls.includes(url)) },
    })

    test('screen 28: a failed picture keeps its box, en', async ({ page, errors }) => {
      errors.allow({ chromium: [ABORTED_LINE] })
      const hold = await holdPicture(page, start)
      await openHeld(page, urlOf('en'))
      await expect.poll(hold.held, { timeout: 5000 }).toBeGreaterThan(0)
      await frames(page)
      const before = await bandBoxes(page)
      expect(await page.locator(IMG).getAttribute('data-failed')).toBeNull()
      hold.release()
      await expectFailed(page, before)
      await shootScreen(page, '28', 'player-picture-failed-en', 100)
    })
  })
})
