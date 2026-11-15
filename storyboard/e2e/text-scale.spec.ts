// The text size at first paint (spec §6.3 prefs, §6.6 resize and reflow; P1-1b, design §8 E2E 4).
// An init script stores reader.v1.prefs before the page loads; the inline boot script must set
// data-text-scale on <html> before <body> exists, scale every text size token, ignore anything
// readPrefs would reject, never write to storage, cause no layout shift (Chromium) and keep a
// 320 px phone free of horizontal scroll at 150% (chromium-phone).
// P1-1c (design p1-step7-design.md §8.3): every test measures the Coming-soon placeholder's h1 and
// main p, so every test is tagged @gated (document.spec.ts checks the text size on every route).
import type { Page } from '@playwright/test'
import { TEXT_SCALE_ATTRIBUTE } from '../src/core/progress/text-scale-boot'
import { DEFAULT_PREFS, PREFS_KEY } from '../src/core/progress/records'
import { expect, test } from './fixtures'
import {
  fontFamilies,
  injectSpecimen,
  prefsText,
  scaleSeen,
  seedPrefs,
  settleFonts,
  storageAfter,
  watchScaleAttribute,
} from './page-helpers'

/** h1 and p font sizes in px at each text size (design §8 E2E 4). */
const SIZES = [
  { scale: 100, h1: 28, p: 18 },
  { scale: 125, h1: 35, p: 22.5 },
  { scale: 150, h1: 42, p: 27 },
] as const

/** Collects page errors from the moment it is called. */
function pageErrors(page: Page): Error[] {
  const errors: Error[] = []
  page.on('pageerror', (error) => errors.push(error))
  return errors
}

async function fontSizes(page: Page): Promise<{ h1: number; p: number }> {
  return page.evaluate(() => ({
    h1: parseFloat(getComputedStyle(document.querySelector('h1') as Element).fontSize),
    p: parseFloat(getComputedStyle(document.querySelector('main p') as Element).fontSize),
  }))
}

/**
 * main's padding in px, and what it is at every text size: spacing never scales (design §3.5 b).
 * --space-7 is 3rem; --gutter is 1rem, or 2rem from 48rem wide (root font size 16 px).
 */
async function mainPadding(page: Page): Promise<{
  actual: { block: number; inline: number }
  unscaled: { block: number; inline: number }
}> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('main') as Element)
    const wide = matchMedia('(min-width: 48rem)').matches
    return {
      actual: {
        block: parseFloat(style.paddingBlockStart),
        inline: parseFloat(style.paddingInlineStart),
      },
      unscaled: { block: 48, inline: wide ? 32 : 16 },
    }
  })
}

test(
  'with no stored prefs the page is at 100% and nothing is written',
  { tag: '@gated' },
  async ({ page }) => {
    const errors = pageErrors(page)
    await seedPrefs(page, null)
    await watchScaleAttribute(page)
    await page.goto('/')
    expect(await page.locator('html').getAttribute(TEXT_SCALE_ATTRIBUTE)).toBeNull()
    expect(await scaleSeen(page)).toBeNull()
    expect(await fontSizes(page)).toEqual({ h1: 28, p: 18 })
    expect(await storageAfter(page)).toEqual({ writes: [], stored: null })
    expect(errors).toEqual([])
  },
)

for (const { scale, h1, p } of SIZES) {
  test(
    `a stored ${scale}% is applied before first paint and scales the text`,
    { tag: '@gated' },
    async ({ page, browserName }) => {
      const errors = pageErrors(page)
      const stored = prefsText(scale)
      await seedPrefs(page, stored)
      await watchScaleAttribute(page)
      await page.goto('/')

      const attribute = await page.locator('html').getAttribute(TEXT_SCALE_ATTRIBUTE)
      const seen = await scaleSeen(page)
      if (scale === DEFAULT_PREFS.textScale) {
        expect(attribute).toBeNull()
        expect(seen).toBeNull()
      } else {
        expect(attribute).toBe(String(scale))
        expect(seen, 'the attribute appeared').not.toBeNull()
        expect(seen?.value).toBe(String(scale))
        expect(seen?.bodyWasNull, 'document.body when data-text-scale appeared').toBe(true)
        if (browserName === 'chromium') {
          expect(seen?.paintEntries, 'paint entries when data-text-scale appeared').toBe(0)
        }
      }
      expect(await fontSizes(page)).toEqual({ h1, p })
      const padding = await mainPadding(page)
      expect(padding.actual, 'main padding does not scale').toEqual(padding.unscaled)
      expect(await storageAfter(page)).toEqual({ writes: [], stored })
      expect(errors).toEqual([])
    },
  )
}

// Each input below would read as 150% if the script skipped its check, so a pass means the check
// ran. None may set the attribute, throw, or write.
const VALID_150 = JSON.parse(prefsText(150)) as Record<string, unknown>
const INVALID: readonly { name: string; raw: string; breakStorage?: 'getItem' | 'getter' }[] = [
  { name: 'schema 2 (a newer build)', raw: JSON.stringify({ ...VALID_150, schema: 2 }) },
  { name: 'textScale 140', raw: JSON.stringify({ ...VALID_150, textScale: 140 }) },
  { name: 'textScale "150" (a string)', raw: JSON.stringify({ ...VALID_150, textScale: '150' }) },
  { name: 'unreadable JSON', raw: '{bad' },
  {
    name: 'a nested __proto__ key',
    raw: `{"schema":1,"uiLocale":null,"textScale":150,"readToMe":false,"extra":{"__proto__":{"textScale":150}}}`,
  },
  { name: 'a throwing getItem', raw: prefsText(150), breakStorage: 'getItem' },
  { name: 'a throwing localStorage getter', raw: prefsText(150), breakStorage: 'getter' },
]

for (const { name, raw, breakStorage } of INVALID) {
  test(
    `${name} gives 100% with no page error and no write`,
    { tag: '@gated' },
    async ({ page }) => {
      const errors = pageErrors(page)
      await seedPrefs(page, raw)
      if (breakStorage === 'getItem') {
        await page.addInitScript(() => {
          Storage.prototype.getItem = () => {
            throw new Error('e2e: getItem blocked')
          }
        })
      } else if (breakStorage === 'getter') {
        await page.addInitScript(() => {
          Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() {
              throw new DOMException('e2e: storage blocked', 'SecurityError')
            },
          })
        })
      }
      await watchScaleAttribute(page)
      await page.goto('/')

      // The breakage really was in place when the page ran.
      if (breakStorage) {
        const broken = await page.evaluate((key) => {
          try {
            window.localStorage.getItem(key)
            return false
          } catch {
            return true
          }
        }, PREFS_KEY)
        expect(broken, `${breakStorage} throws in the page`).toBe(true)
      }
      expect(await page.locator('html').getAttribute(TEXT_SCALE_ATTRIBUTE)).toBeNull()
      expect(await scaleSeen(page)).toBeNull()
      expect(await fontSizes(page)).toEqual({ h1: 28, p: 18 })
      expect(await storageAfter(page)).toEqual({ writes: [], stored: raw })
      expect(errors).toEqual([])
    },
  )
}

test(
  'loading at 150% shifts nothing while the Lora file is held (Chromium)',
  { tag: '@gated' },
  async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the Layout Instability API is Chromium only')
    await seedPrefs(page, prefsText(150))
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>
      const shifts: number[] = []
      w['__e2eShifts'] = shifts
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          shifts.push((entry as PerformanceEntry & { value: number }).value)
      }).observe({ type: 'layout-shift', buffered: true })
    })
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let heldRequests = 0
    await page.route(/\/_next\/static\/media\/lora[^/]*\.woff2$/, async (route) => {
      heldRequests++
      await held
      await route.continue().catch(() => undefined)
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const { lora } = await fontFamilies(page)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 1000)))
        }),
    )
    const measured = await page.evaluate((family) => {
      const w = window as unknown as Record<string, unknown>
      return {
        shifts: [...(w['__e2eShifts'] as number[])],
        paints: performance.getEntriesByType('paint').map((entry) => entry.name),
        lora: [...document.fonts]
          .filter((face) => face.family.replace(/^["']|["']$/g, '') === family)
          .map((face) => face.status),
        attribute: document.documentElement.getAttribute('data-text-scale'),
      }
    }, lora)
    release()

    expect(heldRequests, 'the Lora request was held').toBeGreaterThan(0)
    expect(measured.lora, 'Lora had not loaded during the measurement').not.toContain('loaded')
    expect(measured.paints, 'the page had painted').toContain('first-contentful-paint')
    expect(measured.attribute).toBe('150')
    expect(measured.shifts, 'layout shifts during load').toEqual([])
    await settleFonts(page)
  },
)

test(
  'a 320 px phone at 150% has no horizontal scroll (chromium-phone)',
  { tag: '@gated' },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-phone', 'the reflow check runs on chromium-phone')
    await page.setViewportSize({ width: 320, height: 640 })
    await seedPrefs(page, prefsText(150))
    await page.goto('/')
    await injectSpecimen(page)
    await settleFonts(page)
    const size = await page.evaluate(() => ({
      attribute: document.documentElement.getAttribute('data-text-scale'),
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    console.log(`[text-scale] reflow at 320 px, 150%: ${JSON.stringify(size)}`)
    expect(size.attribute).toBe('150')
    expect(size.viewport).toBe(320)
    expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth)
  },
)
