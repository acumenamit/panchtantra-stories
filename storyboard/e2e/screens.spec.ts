// The owner's P1-1 exit screenshots (P1 D22; spec §10.4 P1-1 exit; design p1-step7-design.md §3.7,
// §3.10, §8.5; P1-1c). Local only: skipped unless SCREENS=1. No baselines are compared. Written to
// storyboard/migration-input/step7-screens/ (git-ignored) as <nn>-<screen>-<project>-<variant>.png.
// - Run once per leg: screen 1 ("/" Coming soon) is @gated, screens 2-13 are @review.
// - Approval set: chromium-tablet, chromium-tablet-landscape and chromium-phone at 100% (13
//   screens each). Stress set: the same screens at 150% at each Chromium width, at 150% at 320 px
//   (chromium-phone), and WebKit iPad and iPhone at 100%.
// - Each variant gets a fresh page; its text size is seeded as a valid prefs record with no
//   uiLocale, so the gate never redirects. The banner screens use a quota error on the first
//   write (/{code}?remember=1), the one storage failure that still lets the stored text size apply.
// The owner's P1-4 player screens (design p1-step10-design.md §10.3; P1-4b), screens 14-26: the
// last describe. Also skipped unless SCREENS=1, and written to storyboard/migration-input/
// step10-screens/ (git-ignored) as <nn>-<screen>-<project>-<variant>.png, numbered from 14 so
// they sort after Step 7's 13; Step 7's screens stay in step7-screens.
// - Approval set: chromium-phone, chromium-tablet and chromium-tablet-landscape at 100% text, and
//   screen 19 at 150% on all three. WebKit is not in it (§10.3 names the 3 Chromium viewports).
// - The review build only: on the staging leg they are skipped, so a staging run never overwrites
//   them with the staging banner on top. The picture screens (27-29) need the staging build and
//   the picture story, which only player-images.spec.ts may open, so they are there.
// - One test per screen, on the test's own page: it reaches its state with the player specs' own
//   steps (walk, seedProgressOnce, blockStorage, T-a22's planted render error), asserts that
//   state, then waits for every animation and font (settleForScreenshot) before the full-page shot.
//   Screen 18 is shot at the screen's size instead (review P14-RV-STRESS-1): the dialog's backdrop
//   is fixed to the viewport, so a full-page shot of a page taller than the screen shows the part
//   below the screen undimmed, which the reader never sees.
// The owner's P1-3 exit screens (design p1-step12-design.md §0.5, §13.4.6 SC-36 to SC-42; Step
// 12a), the last two describes, skipped unless SCREENS=1 and written to storyboard/migration-input/
// step12-screens/ (git-ignored, W9) as <nn>-<screen>-<code>-<project>-<scale>.png:
// - The 3 Chromium viewports at 100% text, and chromium-phone at 150% where the screen lists it; en
//   and hi. One test per screen, locale and text size. The review describe skips WebKit and the
//   staging leg, as the player screens do; screen 38 (the Featured hero) needs the staging build.
// - Each shot fixes the clock at 2026-11-18T12:00:00Z (W12), so New is reproducible, asserts its
//   state with the matching E12 test's checks, then settles (settleForScreenshot) and shoots the
//   full page. Screen 38's caption lists the card ids in DOM order, read at run time (four staging
//   cards share one title, CRIT-15); screen 40's caption carries owner question Q3 (CRIT-11).
import path from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import type { LocaleCode } from '../src/core/locales'
import type { TextScale } from '../src/core/progress/records'
import { expect, test } from './fixtures'
import { launchLeg } from './launch-leg'
import {
  DIALOG,
  endingsOf,
  expectFixedClock,
  expectShareSetup,
  FIRST_PARAGRAPH,
  fixedClock,
  fixtureGraph,
  focusByKeyboard,
  injectSpecimen,
  openPlayer,
  PART,
  PLAYER,
  prefsText,
  seedPrefs,
  seedProgressOnce,
  settleFonts,
  settleForScreenshot,
  step10ScreenPath,
  step12ScreenPath,
  stubShare,
  walk,
} from './page-helpers'
import {
  blockStorage,
  failStorageWrites,
  focusLinkForWebKit,
  formatted,
  landingPath,
  message,
  playerPath,
  uiLang,
  waitForHydration,
} from './routes'

const OUTPUT_DIR = path.resolve(__dirname, '../migration-input/step7-screens')

test.skip(process.env['SCREENS'] !== '1', 'owner screenshots: run with SCREENS=1')

interface Variant {
  readonly name: string
  /** null keeps the project's viewport width. */
  readonly width: number | null
  readonly scale: TextScale
}

/** The variants each project shoots (design §8.5). */
function variantsFor(project: string): Variant[] {
  if (project.startsWith('webkit')) return [{ name: '100', width: null, scale: 100 }]
  const variants: Variant[] = [
    { name: '100', width: null, scale: 100 },
    { name: '150', width: null, scale: 150 },
  ]
  if (project === 'chromium-phone') variants.push({ name: '320px-150', width: 320, scale: 150 })
  return variants
}

interface Screen {
  readonly nn: string
  readonly name: string
  /** Loads the page and brings it to the state the screenshot shows. */
  readonly show: (page: Page, browserName: string) => Promise<void>
}

/** Loads `url`, waits for hydration and every font. */
async function open(page: Page, url: string, status = 200): Promise<void> {
  const response = await page.goto(url)
  expect(response?.status(), url).toBe(status)
  await waitForHydration(page)
  await settleFonts(page)
}

async function withBanner(page: Page, code: string): Promise<void> {
  await failStorageWrites(page)
  await open(page, `/${code}?remember=1`)
  await expect(page.locator('section[aria-labelledby="storage-banner-title"]')).toBeVisible()
  await settleFonts(page)
}

/**
 * Keyboard focus on a link: Tab on Chromium; on WebKit, which never Tabs to a link on Windows, a
 * Shift press and a script focus (focusLinkForWebKit). The ring must show either way.
 */
async function focusLink(page: Page, browserName: string, selector: string): Promise<void> {
  if (browserName === 'webkit') await focusLinkForWebKit(page, selector)
  else await focusByKeyboard(page, browserName, selector)
  await expect(page.locator(selector)).toBeFocused()
  expect(
    await page.locator(selector).evaluate((element) => element.matches(':focus-visible')),
    `${selector} shows its focus ring`,
  ).toBe(true)
}

async function withSpecimen(page: Page, code: string): Promise<void> {
  await open(page, `/${code}`)
  await injectSpecimen(page)
  await settleFonts(page)
}

const GATED_SCREENS: readonly Screen[] = [
  { nn: '01', name: 'coming-soon', show: (page) => open(page, '/') },
]

const REVIEW_SCREENS: readonly Screen[] = [
  { nn: '02', name: 'gate', show: (page) => open(page, '/') },
  {
    nn: '03',
    name: 'gate-focus-hi',
    show: async (page, browserName) => {
      await open(page, '/')
      await focusLink(page, browserName, 'main a[hreflang="hi"]')
    },
  },
  { nn: '04', name: 'en-home', show: (page) => open(page, '/en') },
  { nn: '05', name: 'hi-home', show: (page) => open(page, '/hi') },
  { nn: '06', name: 'en-grown-ups', show: (page) => open(page, '/en/grown-ups') },
  { nn: '07', name: 'hi-grown-ups', show: (page) => open(page, '/hi/grown-ups') },
  { nn: '08', name: 'not-found', show: (page) => open(page, '/no-such-page', 404) },
  { nn: '09', name: 'en-banner', show: (page) => withBanner(page, 'en') },
  { nn: '10', name: 'hi-banner', show: (page) => withBanner(page, 'hi') },
  { nn: '11', name: 'en-specimen', show: (page) => withSpecimen(page, 'en') },
  { nn: '12', name: 'hi-specimen', show: (page) => withSpecimen(page, 'hi') },
  {
    nn: '13',
    name: 'skip-link-focus',
    show: async (page, browserName) => {
      await open(page, '/en')
      await focusLink(page, browserName, 'a[href="#main"]')
    },
  },
]

/** Shoots every screen in every variant of the project, each on a fresh page of the context. */
async function shoot(
  context: BrowserContext,
  screens: readonly Screen[],
  browserName: string,
  project: string,
  baseViewport: { width: number; height: number },
): Promise<void> {
  for (const screen of screens) {
    for (const variant of variantsFor(project)) {
      const file = `${screen.nn}-${screen.name}-${project}-${variant.name}.png`
      await test.step(file, async () => {
        const page = await context.newPage()
        try {
          await page.setViewportSize({
            width: variant.width ?? baseViewport.width,
            height: baseViewport.height,
          })
          await seedPrefs(page, prefsText(variant.scale))
          await screen.show(page, browserName)
          const scale = await page.locator('html').getAttribute('data-text-scale')
          expect(scale, 'the text size').toBe(variant.scale === 100 ? null : String(variant.scale))
          await page.screenshot({ path: path.join(OUTPUT_DIR, file), fullPage: true })
        } finally {
          await page.close()
        }
      })
    }
  }
}

test('screen 1: / Coming soon', { tag: '@gated' }, async ({ page, context, browserName }, info) => {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('the project sets no viewport')
  await shoot(context, GATED_SCREENS, browserName, info.project.name, viewport)
})

test(
  'screens 2-13: gate, homes, Grown-ups, 404, banner, specimen, skip link',
  { tag: '@review' },
  async ({ page, context, browserName }, info) => {
    test.setTimeout(10 * 60_000)
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('the project sets no viewport')
    await shoot(context, REVIEW_SCREENS, browserName, info.project.name, viewport)
  },
)

// ---------------------------------------------------------------------------------------------
// The owner's P1-4 player screens, 14-26 (design p1-step10-design.md §10.3; header above)

const RIVER = 'river-stones'
const LANTERN = 'lantern-walk'
const TWO_PATHS = 'two-paths'
const CHOICES = `${PART} ul[data-choices]`
const FOOTER = `${PART} footer[data-part-controls]`
const BACK = `${PART} button[data-back]`
const MENU = 'header button[data-menu]'
const PANEL = '#player-menu'
const MENU_RESTART = `${PANEL} button[data-restart]`
const KEEP_READING = `${DIALOG} button[data-keep-reading]`
const CARD = `${PART} section[data-ending]`
const ACTIONS = `${CARD} [data-ending-actions]`
const SHARE = `${ACTIONS} button[data-share]`
const SHARE_STATUS = `${ACTIONS} [data-share-status]`
const SHARE_URL = `${ACTIONS} input[data-share-url]`
const BANNER = 'section[aria-labelledby="storage-banner-title"]'
/** Screen 26 plants T-a22's render error: scrollIntoView throws once, at the first step. */
const PLANTED_MESSAGE = 'e2e planted scrollIntoView failure'

interface PlayerScreen {
  readonly nn: string
  readonly name: string
  /** The state the shot shows, in plain English: the test title and the contact sheet's. */
  readonly state: string
  readonly scale: TextScale
  /** Brings the test's page to the state and asserts it. */
  readonly show: (page: Page) => Promise<void>
  /** True: the shot is the screen as the reader sees it, not the full page (screen 18). */
  readonly viewportOnly?: true
}

/** The run is open and settled: no choice list, run footer or ending action on screen is inert. */
async function runSettled(page: Page): Promise<void> {
  await expect(page.locator(PLAYER)).toHaveAttribute('data-run-phase', 'open')
  for (const selector of [CHOICES, FOOTER, ACTIONS]) {
    if ((await page.locator(selector).count()) > 0) {
      await expect(page.locator(selector), `${selector} after the settle`).not.toHaveAttribute(
        'inert',
      )
    }
  }
}

/** A fresh river-stones run at its start node (T-a1, T-b1). */
async function showStart(page: Page, code: LocaleCode): Promise<void> {
  const graph = fixtureGraph(RIVER)
  await openPlayer(page, playerPath(code, RIVER))
  await expect(page.locator('html')).toHaveAttribute('lang', code)
  await expect(page.locator(PART)).toHaveAttribute('data-node', graph.startNodeId)
  await expect(page.locator(PART)).toHaveAttribute('data-seq', '0')
  await expect(page.locator(`${PART} [data-story]`)).toHaveAttribute('lang', code)
  await expect(page.locator(`${PART} h1`)).toHaveText(graph.text[code]?.title ?? '')
  await expect(page.locator(BACK), 'no Back at the start').toHaveCount(0)
  await runSettled(page)
}

/** One step into river-stones (c1 to flat_stones), with Back in the run footer (T-b1). */
async function showMidStory(page: Page): Promise<void> {
  await openPlayer(page, playerPath('en', RIVER))
  await walk(page, RIVER, ['c1'])
  await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
  await expect(page.locator(PART), 'a step rendered it (the reveal ran)').toHaveAttribute(
    'data-animate',
    '',
  )
  await expect(page.locator(BACK)).toHaveText(message('en', 'player.back'))
  await runSettled(page)
  await expect(page.locator(FIRST_PARAGRAPH).first(), 'focus after the step').toBeFocused()
}

/** A saved river-stones run resumed at big_rock (path 3), where Start again asks first (T-b3). */
async function openAtBigRock(page: Page): Promise<void> {
  await seedProgressOnce(page, {
    [RIVER]: { activeRun: { path: ['start', 'flat_stones', 'big_rock'], locale: 'en' } },
  })
  await openPlayer(page, playerPath('en', RIVER))
  await expect(page.locator(PART)).toHaveAttribute('data-node', 'big_rock')
  await runSettled(page)
}

/** The menu open by a click: text size (100% checked) and Start again (T-b7, T-b8). */
async function showMenu(page: Page): Promise<void> {
  await openAtBigRock(page)
  await page.locator(MENU).click()
  await expect(page.locator(MENU)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator(PANEL)).toBeVisible()
  await expect(page.locator(`${PANEL} input[name="text-size"][value="100"]`)).toBeChecked()
  await expect(page.locator(MENU_RESTART)).toBeVisible()
}

/** The menu's Start again at big_rock: the modal dialog, Keep reading focused (T-b3). */
async function showRestartDialog(page: Page): Promise<void> {
  await openAtBigRock(page)
  const dialog = page.locator(DIALOG)
  await expect(dialog, 'the dialog at load').toHaveJSProperty('open', false)
  await page.locator(MENU).click()
  await page.locator(MENU_RESTART).click()
  await expect(dialog, 'the dialog after Start again').toHaveJSProperty('open', true)
  expect(await dialog.evaluate((element) => element.matches(':modal')), 'a modal dialog').toBe(true)
  await expect(dialog).toHaveAccessibleName(message('en', 'player.restartQuestion'))
  await expect(page.locator(KEEP_READING), 'the safe default has focus').toBeFocused()
}

/** A fresh lantern-walk run walked to an ending: the card, its count and its actions (T-c1). */
async function showEnding(page: Page, alternate: boolean): Promise<void> {
  const node = alternate ? 'ending_shadow' : 'ending_light'
  await openPlayer(page, playerPath('en', LANTERN))
  await walk(page, LANTERN, alternate ? ['c1', 'c2'] : ['c1', 'c1'])
  await expect(page.locator(PART)).toHaveAttribute('data-node', node)
  await expect(page.locator(CARD)).toBeVisible()
  await expect(page.locator(`${CARD} h2`)).toHaveText(message('en', 'player.lessonHeading'))
  await expect(page.locator(`${CARD} [data-ending-count]`)).toHaveText(
    formatted('en', 'player.endingCount', {
      found: 1,
      total: endingsOf(fixtureGraph(LANTERN)).length,
    }),
  )
  const label = page.locator(`${CARD} [data-alternate]`)
  if (alternate) await expect(label).toHaveText(message('en', 'player.altEnding'))
  else await expect(label, 'no alternate label').toHaveCount(0)
  await runSettled(page)
}

/**
 * Before any page script: no share sheet (navigator.share and canShare undefined) and a clipboard
 * whose writeText resolves or rejects, recording each text (player-share.spec.ts's stubShare, cut
 * down to the two cases the screens show).
 */
async function stubClipboard(page: Page, outcome: 'resolve' | 'reject'): Promise<void> {
  await page.addInitScript((wanted) => {
    const written: string[] = []
    ;(window as unknown as Record<string, unknown>)['__e2eWritten'] = written
    for (const name of ['share', 'canShare']) {
      Object.defineProperty(Navigator.prototype, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: undefined,
      })
    }
    const clipboard = {
      writeText(text: unknown): Promise<void> {
        written.push(String(text))
        return wanted === 'resolve'
          ? Promise.resolve()
          : Promise.reject(new DOMException('e2e: copy refused', 'NotAllowedError'))
      },
    }
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      enumerable: true,
      get: () => clipboard,
    })
  }, outcome)
}

/** Share at ending_light: "Link copied." after a copy, or the manual field after a refusal (T-c2). */
async function showShare(page: Page, outcome: 'resolve' | 'reject'): Promise<void> {
  await stubClipboard(page, outcome)
  await showEnding(page, false)
  const url = `${new URL(page.url()).origin}${playerPath('en', LANTERN)}`
  await page.locator(SHARE).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>)['__e2eWritten']))
    .toEqual([url])
  const field = page.locator(SHARE_URL)
  const status = page.locator(SHARE_STATUS)
  if (outcome === 'resolve') {
    await expect(status).toHaveText(message('en', 'player.linkCopied'))
    await expect(status).toBeVisible()
    await expect(field, 'no field after a copy').toHaveCount(0)
  } else {
    await expect(field).toBeVisible()
    await expect(field).toBeFocused()
    await expect(field).toHaveValue(url)
    await expect(status, 'no "Link copied."').toHaveCount(0)
  }
}

/** A run saved in Hindi, opened on /en: the story in Hindi, the page and its chrome English (T-a12). */
async function showHindiOnEnglish(page: Page): Promise<void> {
  await seedProgressOnce(page, {
    [RIVER]: { activeRun: { path: ['start', 'flat_stones'], locale: 'hi' } },
  })
  await openPlayer(page, playerPath('en', RIVER))
  await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
  await expect(page.locator(`${PART} [data-story]`)).toHaveAttribute('lang', 'hi')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('a[data-exit]')).toHaveText(message('en', 'player.allStories'))
  await runSettled(page)
}

/** Storage blocked: the banner first in main, and the run still open (T-a15). */
async function showStorageBlocked(page: Page): Promise<void> {
  await blockStorage(page)
  await openPlayer(page, playerPath('en', TWO_PATHS))
  const banner = page.locator(BANNER)
  await expect(banner).toBeVisible()
  await expect(banner.locator('p')).toHaveText([
    message('en', 'storage.title'),
    message('en', 'storage.body'),
  ])
  expect(
    await page
      .locator('main')
      .evaluate((main) => main.firstElementChild?.getAttribute('aria-labelledby') ?? null),
    'the banner is the first thing in main',
  ).toBe('storage-banner-title')
  await runSettled(page)
}

/** T-a22's planted render error at the first step: the fallback, its heading focused. */
async function showErrorFallback(page: Page): Promise<void> {
  await page.addInitScript((planted) => {
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (
      this: Element,
      ...args: Parameters<Element['scrollIntoView']>
    ) {
      if (window.sessionStorage.getItem('e2e-planted-throw') === null) {
        window.sessionStorage.setItem('e2e-planted-throw', '1')
        throw new Error(planted)
      }
      return original.apply(this, args)
    }
  }, PLANTED_MESSAGE)
  await openPlayer(page, playerPath('en', TWO_PATHS))
  await runSettled(page)
  await page.locator(`${PART} button[data-choice="c1"]`).click()
  const fallback = page.locator('main[data-player-error]')
  await expect(fallback).toBeVisible()
  await expect(page.locator(PLAYER), 'the player is unmounted').toHaveCount(0)
  const heading = fallback.locator('h1')
  await expect(heading).toHaveText(message('en', 'player.errorTitle'))
  await expect(heading).toBeFocused()
  await expect(fallback.locator('a[href="/en"]')).toHaveText(message('en', 'player.allStories'))
  await expect(fallback.locator('button[data-start-again]')).toHaveText(
    message('en', 'player.startThisAgain'),
  )
}

const PLAYER_SCREENS: readonly PlayerScreen[] = [
  {
    nn: '14',
    name: 'player-start-en',
    state: 'the player at the start of a story, en',
    scale: 100,
    show: (page) => showStart(page, 'en'),
  },
  {
    nn: '15',
    name: 'player-start-hi',
    state: 'the player at the start of a story, hi',
    scale: 100,
    show: (page) => showStart(page, 'hi'),
  },
  {
    nn: '16',
    name: 'player-mid-story-back-en',
    state: 'mid-story after one choice, with Back, en',
    scale: 100,
    show: showMidStory,
  },
  {
    nn: '17',
    name: 'player-menu-open-en',
    state: 'the menu open (text size and Start again), en',
    scale: 100,
    show: showMenu,
  },
  {
    nn: '18',
    name: 'player-restart-dialog-en',
    state: 'the Start again dialog open, Keep reading focused, en',
    scale: 100,
    show: showRestartDialog,
    viewportOnly: true,
  },
  {
    nn: '19',
    name: 'player-text-150-en',
    state: 'mid-story with Back at 150% text, en',
    scale: 150,
    show: showMidStory,
  },
  {
    nn: '20',
    name: 'player-ending-en',
    state: 'an ending: the ending card, en',
    scale: 100,
    show: (page) => showEnding(page, false),
  },
  {
    nn: '21',
    name: 'player-alternate-ending-en',
    state: 'the alternate ending: the card with its label, en',
    scale: 100,
    show: (page) => showEnding(page, true),
  },
  {
    nn: '22',
    name: 'player-share-copied-en',
    state: 'Share at an ending: "Link copied.", en',
    scale: 100,
    show: (page) => showShare(page, 'resolve'),
  },
  {
    nn: '23',
    name: 'player-share-manual-en',
    state: 'Share at an ending: the manual copy field, en',
    scale: 100,
    show: (page) => showShare(page, 'reject'),
  },
  {
    nn: '24',
    name: 'player-hi-story-on-en',
    state: 'a story saved in Hindi, opened on the English page /en',
    scale: 100,
    show: showHindiOnEnglish,
  },
  {
    nn: '25',
    name: 'player-storage-blocked-en',
    state: 'storage blocked: the storage banner, en',
    scale: 100,
    show: showStorageBlocked,
  },
  {
    nn: '26',
    name: 'player-error-fallback-en',
    state: 'the error fallback after a render error, en',
    scale: 100,
    show: showErrorFallback,
  },
]

test.describe('the P1-4 owner screens: the story player', { tag: '@review' }, () => {
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'the P1-4 owner set is the 3 Chromium viewports (design §10.3)',
  )
  test.skip(
    launchLeg(process.env['E2E_LAUNCH']) === 'staging',
    'shot on the review build: on the staging build every page carries the staging banner',
  )

  for (const screen of PLAYER_SCREENS) {
    test(`screen ${screen.nn}: ${screen.state}`, async ({ page }, info) => {
      test.setTimeout(90_000)
      // At 100% nothing is stored, as for a first visit; 150% is a valid prefs record (Step 7).
      if (screen.scale !== 100) await seedPrefs(page, prefsText(screen.scale))
      await screen.show(page)
      expect(await page.locator('html').getAttribute('data-text-scale'), 'the text size').toBe(
        screen.scale === 100 ? null : String(screen.scale),
      )
      await settleForScreenshot(page)
      await page.screenshot({
        path: step10ScreenPath(screen.nn, screen.name, info.project.name, screen.scale),
        fullPage: screen.viewportOnly !== true,
      })
    })
  }
})

// ---------------------------------------------------------------------------------------------
// The owner's P1-3 exit screens (design p1-step12-design.md §0.5, §13.4.6 SC-36 to SC-42)

/** Every P1-3 screen is shot at this clock (W12): the two 2026-11-13 fixtures are New. */
const STEP12_CLOCK = '2026-11-18T12:00:00Z'

interface Step12Screen {
  readonly nn: string
  readonly name: string
  readonly state: string
  readonly codes: readonly LocaleCode[]
  readonly scales: readonly TextScale[]
  /** Opens the page and asserts the state the screenshot shows (the matching E12 test's checks). */
  readonly show: (page: Page, code: LocaleCode) => Promise<void>
}

const shownVisibility = async (page: Page, selector: string): Promise<string[]> =>
  page
    .locator(selector)
    .evaluateAll((elements) =>
      elements.map((element) =>
        getComputedStyle(element).visibility === 'visible' && !element.hasAttribute('aria-hidden')
          ? 'shown'
          : 'hidden',
      ),
    )

async function openShelf(page: Page, code: LocaleCode): Promise<void> {
  const response = await page.goto(`/${code}`)
  expect(response?.status(), `/${code}`).toBe(200)
  await expectFixedClock(page, STEP12_CLOCK)
  await expect(page.locator('[data-home-progress]')).toHaveAttribute('data-phase', 'ready')
  await expect(page.locator('[data-badge-cell][data-shown="pending"]')).toHaveCount(0)
}

async function openStoryLanding(page: Page, code: LocaleCode): Promise<void> {
  const response = await page.goto(landingPath(code, 'two-paths'))
  expect(response?.status(), landingPath(code, 'two-paths')).toBe(200)
  await expect(page.locator('[data-actions]')).not.toHaveAttribute('data-shown', 'pending')
}

/** The badge a list card shows: its data-shown and the texts of its shown variants. */
async function badgeOf(page: Page, id: string): Promise<{ shown: string | null; texts: string[] }> {
  return page
    .locator(`[data-home-list] [data-story-card="${id}"] [data-badge-cell]`)
    .evaluate((cell) => ({
      shown: cell.getAttribute('data-shown'),
      texts: [...cell.querySelectorAll('[data-badge]')]
        .filter(
          (v) => getComputedStyle(v).visibility === 'visible' && !v.hasAttribute('aria-hidden'),
        )
        .map((v) => (v.textContent ?? '').trim()),
    }))
}

const STEP12_REVIEW_SCREENS: readonly Step12Screen[] = [
  {
    nn: '36',
    name: 'home-new',
    state: 'Home for a new reader: the empty Continue line, New on the 2026-11-13 fixtures',
    codes: ['en', 'hi'],
    scales: [100, 150],
    show: async (page, code) => {
      await openShelf(page, code)
      const lang = uiLang(code)
      await expect(page.locator('[data-continue-cell]')).toHaveAttribute('data-shown', 'empty')
      await expect(page.locator('[data-continue-empty]')).toHaveText(
        message(lang, 'home.continueEmpty'),
      )
      for (const id of ['lantern-walk', 'river-stones']) {
        expect(await badgeOf(page, id), `${id}: New`).toEqual({
          shown: 'new',
          texts: [message(lang, 'home.new')],
        })
      }
      expect(await badgeOf(page, 'two-paths'), 'two-paths: no badge').toEqual({
        shown: 'none',
        texts: [],
      })
    },
  },
  {
    nn: '37',
    name: 'home-returning',
    state: 'Home for a returning reader: Continue river-stones; Reading, Finished 1 of 2, New',
    codes: ['en', 'hi'],
    scales: [100, 150],
    show: async (page, code) => {
      await seedProgressOnce(page, {
        'river-stones': { activeRun: { path: ['start', 'flat_stones'], locale: code } },
        'two-paths': { activeRun: null, endingsFound: ['ending_wise'] },
      })
      await openShelf(page, code)
      const lang = uiLang(code)
      await expect(page.locator('[data-continue-cell]')).toHaveAttribute(
        'data-shown',
        'river-stones',
      )
      expect(await badgeOf(page, 'river-stones'), 'river-stones: Reading').toEqual({
        shown: 'reading',
        texts: [message(lang, 'home.reading')],
      })
      expect(await badgeOf(page, 'two-paths'), 'two-paths: Finished 1 of 2').toEqual({
        shown: 'finished',
        texts: [formatted(lang, 'home.finished', { found: 1, total: 2 })],
      })
      expect(await badgeOf(page, 'lantern-walk'), 'lantern-walk: New').toEqual({
        shown: 'new',
        texts: [message(lang, 'home.new')],
      })
    },
  },
  {
    nn: '39',
    name: 'landing-start',
    state: 'the landing of two-paths with nothing saved: Start',
    codes: ['en', 'hi'],
    scales: [100, 150],
    show: async (page, code) => {
      await openStoryLanding(page, code)
      await expect(page.locator('[data-actions]')).toHaveAttribute('data-shown', 'start')
      expect(
        [
          ...(await shownVisibility(page, '[data-actions] [data-story-action="start"]')),
          ...(await shownVisibility(page, '[data-actions] [data-story-action="continue"]')),
          ...(await shownVisibility(page, '[data-actions] [data-start-again]')),
        ],
        'Start shown; Continue and Start again hidden',
      ).toEqual(['shown', 'hidden', 'hidden'])
    },
  },
  {
    nn: '40',
    name: 'landing-continue',
    state: 'the landing of two-paths with a saved run: Continue and Start again',
    codes: ['en', 'hi'],
    scales: [100],
    show: async (page, code) => {
      await seedProgressOnce(page, {
        'two-paths': { activeRun: { path: ['start', 'wise_path'], locale: code } },
      })
      await openStoryLanding(page, code)
      await expect(page.locator('[data-actions]')).toHaveAttribute('data-shown', 'continue')
      expect(
        [
          ...(await shownVisibility(page, '[data-actions] [data-story-action="start"]')),
          ...(await shownVisibility(page, '[data-actions] [data-story-action="continue"]')),
          ...(await shownVisibility(page, '[data-actions] [data-start-again]')),
        ],
        'Continue and Start again shown; Start hidden',
      ).toEqual(['hidden', 'shown', 'shown'])
      const question =
        'Owner question Q3 (design §0.3, S12-CRIT-11): on the landing one tap on Start again clears the unfinished run (endings kept) with no question; the player asks "Start again from the beginning?" first. (a) Recommended: keep the one-tap reset. (b) Reuse the restart dialog here.'
      test.info().annotations.push({ type: 'screen 40 (Q3)', description: question })
      console.log(`[screens] 40 ${test.info().project.name} ${code}: ${question}`)
    },
  },
  {
    nn: '41',
    name: 'landing-copied',
    state: 'the landing after a copy: "Link copied."',
    codes: ['en'],
    scales: [100],
    show: async (page, code) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      const setup = { share: 'undefined', clipboard: 'real' } as const
      await stubShare(page, setup)
      await openStoryLanding(page, code)
      await expectShareSetup(page, setup)
      await page.locator('[data-share-row] button[data-share]').click()
      await expect(page.locator('[data-share-row] [data-share-status]')).toHaveText(
        message(uiLang(code), 'player.linkCopied'),
      )
    },
  },
  {
    nn: '42',
    name: 'landing-manual',
    state: 'the landing with the manual share field',
    codes: ['en', 'hi'],
    scales: [100, 150],
    show: async (page, code) => {
      const setup = { share: 'undefined', clipboard: 'reject' } as const
      await stubShare(page, setup)
      await openStoryLanding(page, code)
      await expectShareSetup(page, setup)
      await page.locator('[data-share-row] button[data-share]').click()
      const field = page.locator('input[data-share-url]')
      await expect(field).toBeVisible()
      await expect(field).toHaveValue(
        `${new URL(page.url()).origin}${landingPath(code, 'two-paths')}`,
      )
    },
  },
]

/** One P1-3 shot: the clock, the text size, the state, then a settled full-page screenshot. */
async function shootStep12(
  page: Page,
  screen: Step12Screen,
  code: LocaleCode,
  scale: TextScale,
): Promise<void> {
  await fixedClock(page, STEP12_CLOCK)
  if (scale !== 100) await seedPrefs(page, prefsText(scale))
  await screen.show(page, code)
  expect(await page.locator('html').getAttribute('data-text-scale'), 'the text size').toBe(
    scale === 100 ? null : String(scale),
  )
  await settleForScreenshot(page)
  await page.screenshot({
    path: step12ScreenPath(screen.nn, `${screen.name}-${code}`, test.info().project.name, scale),
    fullPage: true,
  })
}

test.describe('the P1-3 owner screens: Home and the landing', { tag: '@review' }, () => {
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'the P1-3 owner set is the 3 Chromium viewports (design §0.5)',
  )
  test.skip(
    launchLeg(process.env['E2E_LAUNCH']) === 'staging',
    'shot on the review build: on the staging build every page carries the staging banner',
  )

  for (const screen of STEP12_REVIEW_SCREENS) {
    for (const code of screen.codes) {
      for (const scale of screen.scales) {
        test(`screen ${screen.nn} /${code} ${scale}%: ${screen.state}`, async ({ page }, info) => {
          test.skip(
            scale !== 100 && info.project.name !== 'chromium-phone',
            '150% text: chromium-phone',
          )
          test.setTimeout(90_000)
          await shootStep12(page, screen, code, scale)
        })
      }
    }
  }
})

test.describe('the P1-3 owner screens: the Featured hero', { tag: '@staging' }, () => {
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'the P1-3 owner set is the 3 Chromium viewports (design §0.5)',
  )

  for (const code of ['en', 'hi'] as const) {
    test(`screen 38 /${code} 100%: Home with the Featured hero`, async ({ page }, info) => {
      test.setTimeout(90_000)
      const hero: Step12Screen = {
        nn: '38',
        name: 'home-featured',
        state: 'Home with the Featured hero',
        codes: [code],
        scales: [100],
        show: async (shown) => {
          await openShelf(shown, code)
          await expect(shown.locator('[data-featured] [data-story-card]')).toHaveCount(1)
          const ids = await shown
            .locator('[data-story-card]')
            .evaluateAll((cards) =>
              cards.map(
                (card) =>
                  `${card.closest('[data-featured]') === null ? '' : 'hero '}${card.getAttribute('data-story-card') ?? ''}`,
              ),
            )
          const caption = ids.join(', ')
          info.annotations.push({ type: 'screen 38 cards in DOM order', description: caption })
          console.log(`[screens] 38 ${info.project.name} ${code}: ${caption}`)
        },
      }
      await shootStep12(page, hero, code, 100)
    })
  }
})
