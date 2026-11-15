// The storage-blocked banner (spec §6.3, §6.6 4.1.3; design p1-step7-design.md §3.11 B1, §3.12
// #14-#15, §7 items 30-32, §8.3 storage-banner.spec, §11 R15; P1-1c). Review leg only (@review).
// Blocked storage, a quota error on the first write and a newer-schema prefs record each show the
// banner (no dismiss control, no icon), in English and in Hindi, inside the first viewport, and
// announce its title once in the live region. The quota case loads /{code}?remember=1, because
// only a write meets setItem (a plain load only reads). Healthy storage shows no banner and announces nothing. The layout shift of the
// blocked state is measured and printed, never asserted (design §3.11: accepted and recorded).
import type { Page } from '@playwright/test'
import { ENABLED_LOCALE_CODES } from '../src/core/locales'
import { DEFAULT_PREFS, RECORD_SCHEMA, serializePrefs } from '../src/core/progress/records'
import { expect, test } from './fixtures'
import { seedPrefs, settleFonts, storageAfter } from './page-helpers'
import {
  blockStorage,
  failStorageWrites,
  layoutShift,
  message,
  recordLayoutShifts,
  uiLang,
  waitForHydration,
} from './routes'

const BANNER = 'section[aria-labelledby="storage-banner-title"]'

/**
 * Before any page script: records each value the live region holds, in order (no repeats), and
 * the time the banner first appears (performance.now()).
 */
async function recordAnnouncements(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    const seen: string[] = []
    w['__e2eLiveRegion'] = seen
    w['__e2eBannerAt'] = null
    new MutationObserver(() => {
      if (w['__e2eBannerAt'] === null && document.getElementById('storage-banner-title')) {
        w['__e2eBannerAt'] = performance.now()
      }
      const region = document.getElementById('live-region')
      if (region === null) return
      const text = region.textContent ?? ''
      if (seen[seen.length - 1] !== text) seen.push(text)
    }).observe(document, { subtree: true, childList: true, characterData: true })
  })
}

async function announcements(page: Page): Promise<string[]> {
  const seen = await page.evaluate(
    () => ((window as unknown as Record<string, unknown>)['__e2eLiveRegion'] as string[]) ?? [],
  )
  return seen.filter((text) => text !== '')
}

/** The banner is visible with the page's strings, inside the first viewport, announced once. */
async function expectBanner(page: Page, lang: 'en' | 'hi'): Promise<void> {
  const banner = page.locator(BANNER)
  await expect(banner).toBeVisible()
  await expect(banner.locator('p')).toHaveText([
    message(lang, 'storage.title'),
    message(lang, 'storage.body'),
  ])
  await expect(page.locator('#live-region')).toHaveText(message(lang, 'storage.title'))
  // No dismiss control and no icon (design §7 item 32).
  await expect(banner.locator('button, [role="button"], a, input, svg, img')).toHaveCount(0)
  // First thing in main (design §3.11 B1).
  expect(await page.locator('main').evaluate((main) => main.firstElementChild?.localName)).toBe(
    'section',
  )
  await settleFonts(page)
  const box = await banner.boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) throw new Error('no banner box or viewport')
  expect(box.y, 'banner top').toBeGreaterThanOrEqual(0)
  expect(box.y + box.height, 'banner bottom inside the first viewport').toBeLessThanOrEqual(
    viewport.height,
  )
  await page.waitForTimeout(300)
  expect(await announcements(page), 'announced once').toEqual([message(lang, 'storage.title')])
}

test.describe('the storage banner', { tag: '@review' }, () => {
  for (const code of ENABLED_LOCALE_CODES) {
    const lang = uiLang(code)

    test(`/${code}: blocked storage shows the banner (layout shift measured)`, async ({
      page,
      browserName,
    }) => {
      if (browserName === 'chromium') await recordLayoutShifts(page)
      await recordAnnouncements(page)
      await blockStorage(page)
      await page.goto(`/${code}`)
      await expectBanner(page, lang)
      if (browserName !== 'chromium') return
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 300)))
          }),
      )
      // Chromium flags the banner's shift as recent input under Playwright (it lands within 500 ms
      // of page.goto; see recordLayoutShifts), so CLS by its definition reads 0 here. The raw sum
      // is what a visitor who has not touched the page would get, so both are printed.
      const { cls, raw, shifts, inputShifts } = await layoutShift(page)
      const timing = await page.evaluate(() => ({
        firstPaint:
          performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? Number.NaN,
        bannerAt: (window as unknown as Record<string, unknown>)['__e2eBannerAt'] as number | null,
      }))
      const project = test.info().project.name
      const measured =
        `CLS ${cls.toFixed(6)}, raw ${raw.toFixed(6)} (${shifts} shifts, ${inputShifts} flagged ` +
        `as recent input; first paint ${timing.firstPaint.toFixed(0)} ms, banner at ` +
        `${timing.bannerAt?.toFixed(0) ?? 'never'} ms)`
      console.log(
        `[storage-banner] /${code} with storage blocked (${project}): ${measured}; measured, ` +
          'not gated: design §3.11',
      )
      test.info().annotations.push({ type: 'CLS (not gated)', description: measured })
    })

    test(`/${code}?remember=1: a quota error on the write shows the banner`, async ({ page }) => {
      await recordAnnouncements(page)
      await failStorageWrites(page)
      await page.goto(`/${code}?remember=1`)
      await expectBanner(page, lang)
      await expect.poll(() => new URL(page.url()).search, 'the query is removed').toBe('')
    })

    test(`/${code}: a newer-schema prefs record shows the banner and stays untouched`, async ({
      page,
    }) => {
      const stored = JSON.stringify({
        ...JSON.parse(serializePrefs(DEFAULT_PREFS)),
        schema: RECORD_SCHEMA + 1,
      })
      await recordAnnouncements(page)
      await seedPrefs(page, stored)
      await page.goto(`/${code}`)
      await expectBanner(page, lang)
      expect(await storageAfter(page)).toEqual({ writes: [], stored })
    })

    test(`/${code}: healthy storage shows no banner and announces nothing`, async ({ page }) => {
      await recordAnnouncements(page)
      await seedPrefs(page, null)
      await page.goto(`/${code}`)
      await waitForHydration(page)
      await page.waitForTimeout(300)
      await expect(page.locator(BANNER)).toHaveCount(0)
      await expect(page.locator('#live-region')).toHaveText('')
      expect(await announcements(page)).toEqual([])
    })
  }
})
