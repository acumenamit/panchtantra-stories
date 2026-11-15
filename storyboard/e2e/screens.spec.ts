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
import path from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import type { TextScale } from '../src/core/progress/records'
import { expect, test } from './fixtures'
import { focusByKeyboard, injectSpecimen, prefsText, seedPrefs, settleFonts } from './page-helpers'
import { failStorageWrites, focusLinkForWebKit, waitForHydration } from './routes'

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
