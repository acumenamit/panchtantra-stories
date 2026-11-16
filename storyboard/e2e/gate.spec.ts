// The language gate on "/" in an open build (P1 D8 G1; spec §6.1 language gate, §6.3, §6.6
// targets; design p1-step7-design.md §3.6, §3.8 Q3, §3.12 #7-#11, §7 items 18-24, §8.3 gate.spec,
// §11 R5; P1-1c). Review leg only (@review).
// - Content, attributes and order; options at least 120 px tall and 24 px apart; no flags, no ar.
// - The choice is saved on the destination (/{code}?remember=1, then the query is removed); Back
//   from there shows the gate again with no bounce, on both engines.
// - A returning visitor is sent on with location.replace, so Back never lands on "/"; invalid prefs,
//   a reload, no JavaScript and blocked storage all leave the gate shown, and nothing is written.
// - Font requests: Devanagari 400 is fetched, nothing outside Lora and the two Noto 400 files.
// - A Devanagari file delayed 1.5 s keeps the layout shift under 0.1 on "/", /en and /hi
//   (Chromium; design §3.8, U8).
import type { Page } from '@playwright/test'
import { ENABLED_LOCALE_CODES, getLocaleDef } from '../src/core/locales'
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  serializePrefs,
  type UiLocale,
} from '../src/core/progress/records'
import { expect, test } from './fixtures'
import { fontFamilies, seedPrefs, servedFontFaces, settleFonts, storageAfter } from './page-helpers'
import {
  blockStorage,
  layoutShift,
  liveRegions,
  message,
  recordLayoutShifts,
  uiLang,
  waitForHydration,
} from './routes'

const SCRIPT_MARKS: Readonly<Record<string, string>> = { Latn: 'A', Deva: 'अ' }
// Regional-indicator letters (flags) and the Arabic block.
const FLAGS = /[\u{1F1E6}-\u{1F1FF}]/u
const ARABIC = /\p{Script=Arabic}/u
// The four Noto Sans Devanagari files, as next/font names them (noto_sans_devanagari_…).
const NOTO_FILE = /\/_next\/static\/media\/noto[-_]sans[-_]devanagari[^/]*\.woff2$/

/** The stored prefs a gate choice writes. */
function chosen(uiLocale: UiLocale): string {
  return serializePrefs({ ...DEFAULT_PREFS, uiLocale })
}

/** The gate option for `code`. */
function option(page: Page, code: string) {
  return page.locator(`main ul a[hreflang="${code}"]`)
}

/** Waits for a normal navigation's chance to redirect, then checks the gate is still shown. */
async function expectGateStays(page: Page): Promise<void> {
  await waitForHydration(page)
  await page.waitForTimeout(500)
  expect(new URL(page.url()).pathname, 'still on the gate').toBe('/')
  await expect(page.locator('main ul a')).toHaveCount(ENABLED_LOCALE_CODES.length)
}

test.describe('the language gate', { tag: '@review' }, () => {
  test('content, attributes and order', async ({ page }) => {
    await page.goto('/')
    expect(await page.title()).toBe('Storyboard')
    await expect(page.locator('main')).toHaveCount(1)
    const children = await page
      .locator('main > *')
      .evaluateAll((elements) =>
        elements.map((element) => `${element.localName}${element.getAttribute('lang') ?? ''}`),
      )
    expect(children).toEqual(['h1', 'p', 'phi', 'ul', 'p', 'phi'])
    await expect(page.locator('main > h1')).toHaveText('Storyboard')
    const paragraphs = page.locator('main > p')
    await expect(paragraphs).toHaveText([
      message('en', 'gate.prompt'),
      message('hi', 'gate.prompt'),
      message('en', 'gate.remember'),
      message('hi', 'gate.remember'),
    ])

    // One option per enabled locale, in registry order. role="list" keeps the list for VoiceOver:
    // WebKit drops the role of a list styled without markers.
    await expect(page.locator('main > ul')).toHaveAttribute('role', 'list')
    await expect(page.getByRole('list')).toHaveCount(1)
    const items = page.locator('main > ul > li')
    await expect(items).toHaveCount(ENABLED_LOCALE_CODES.length)
    await expect(page.getByRole('listitem')).toHaveCount(ENABLED_LOCALE_CODES.length)
    for (const [index, code] of ENABLED_LOCALE_CODES.entries()) {
      const def = getLocaleDef(code)
      const link = items.nth(index).locator('> a')
      await expect(link).toHaveCount(1)
      expect(
        await link.evaluate((a) => ({
          href: a.getAttribute('href'),
          hreflang: a.getAttribute('hreflang'),
          lang: a.getAttribute('lang'),
          dir: a.getAttribute('dir'),
        })),
        code,
      ).toEqual({ href: `/${code}?remember=1`, hreflang: code, lang: code, dir: def.dir })
      const mark = link.locator('span[aria-hidden="true"]')
      await expect(mark).toHaveCount(1)
      await expect(mark).toHaveText(SCRIPT_MARKS[def.script] ?? '?')
      await expect(link).toHaveText(`${SCRIPT_MARKS[def.script]}${def.endonym}`)
      // The mark is decorative: the accessible name is the endonym alone.
      await expect(page.getByRole('link', { name: def.endonym, exact: true })).toHaveCount(1)
    }

    // No skip link, no live region, no banner, no header (design §7 item 20).
    await expect(page.locator('a[href="#main"]')).toHaveCount(0)
    expect(await liveRegions(page), 'live regions (Next route announcer aside)').toEqual([])
    await expect(page.locator('section[aria-labelledby]')).toHaveCount(0)
    await expect(page.locator('header')).toHaveCount(0)
  })

  test('each option is at least 120 px tall and at least 24 px from the next', async ({ page }) => {
    await page.goto('/')
    await settleFonts(page)
    const boxes = await page
      .locator('main > ul > li > a')
      .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().toJSON()))
    expect(boxes).toHaveLength(ENABLED_LOCALE_CODES.length)
    for (const box of boxes) expect(box.height, 'option height').toBeGreaterThanOrEqual(120)
    for (let i = 1; i < boxes.length; i++) {
      const [a, b] = [boxes[i - 1], boxes[i]]
      if (!a || !b) throw new Error('missing box')
      // Stacked (below 30rem) the gap is vertical; side by side it is horizontal.
      const gap = Math.max(b.top - a.bottom, b.left - a.right)
      expect(gap, `gap between options ${i} and ${i + 1}`).toBeGreaterThanOrEqual(24 - 0.01)
    }
    test.info().annotations.push({
      type: 'layout',
      description: JSON.stringify(boxes.map((box) => [box.x, box.y, box.width, box.height])),
    })
  })

  test('no flags and no ar', async ({ page }) => {
    await page.goto('/')
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(FLAGS)
    expect(text).not.toMatch(ARABIC)
    await expect(page.locator('main img, main svg')).toHaveCount(0)
    await expect(page.locator('[lang="ar"], [hreflang="ar"], a[href^="/ar"]')).toHaveCount(0)
  })

  test('first visit: tapping हिन्दी opens /hi, saves the choice, and Back shows the gate', async ({
    page,
  }) => {
    await seedPrefs(page, null)
    await page.goto('/')
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/hi'),
      option(page, 'hi').click(),
    ])
    await expect.poll(() => new URL(page.url()).search, 'the query is removed').toBe('')
    expect(await page.locator('html').getAttribute('lang')).toBe('hi')
    await expect.poll(async () => (await storageAfter(page)).stored).toBe(chosen('hi'))
    expect(JSON.parse((await storageAfter(page)).stored as string)).toEqual({
      schema: 1,
      uiLocale: 'hi',
      textScale: 100,
      readToMe: false,
    })
    expect((await storageAfter(page)).writes, 'one write').toEqual(['setItem'])

    // Back: the gate again, and no redirect (navigation type back_forward). Only the documents that
    // load count: Next applies the query removal with a second, same-document replaceState('/hi')
    // that can land after this point (review R2-FLK-2). It loads no document; a redirect does.
    const documents: string[] = []
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documents.push(new URL(request.url()).pathname)
    })
    await page.goBack()
    await expectGateStays(page)
    expect(
      documents.filter((pathname) => pathname !== '/'),
      'documents loaded after Back',
    ).toEqual([])
  })

  for (const code of ENABLED_LOCALE_CODES) {
    test(`a returning visitor with ${code} is sent to /${code}, and Back does not land on /`, async ({
      page,
    }) => {
      const stored = chosen(uiLang(code))
      await seedPrefs(page, stored)
      await page.goto('/no-such-page')
      await page.goto('/', { waitUntil: 'commit' })
      await page.waitForURL((url) => url.pathname === `/${code}`)
      await waitForHydration(page)
      expect(await page.locator('html').getAttribute('lang')).toBe(code)
      // Opening /{code} without ?remember=1 writes nothing.
      expect(await storageAfter(page)).toEqual({ writes: [], stored })

      await page.goBack()
      await page.waitForLoadState()
      await page.waitForTimeout(500)
      expect(new URL(page.url()).pathname, 'Back skips the replaced gate').toBe('/no-such-page')
    })
  }

  const VALID = JSON.parse(chosen('hi')) as Record<string, unknown>
  const INVALID: readonly { name: string; raw: string }[] = [
    { name: 'schema 2', raw: JSON.stringify({ ...VALID, schema: 2 }) },
    { name: 'an own __proto__ key', raw: `{"__proto__":{},${JSON.stringify(VALID).slice(1)}` },
    {
      name: 'a nested __proto__ key',
      raw: JSON.stringify(VALID).replace(/}$/, ',"x":{"__proto__":{}}}'),
    },
    { name: 'uiLocale ar', raw: JSON.stringify({ ...VALID, uiLocale: 'ar' }) },
    { name: 'garbage', raw: '{bad' },
  ]
  for (const { name, raw } of INVALID) {
    test(`stored prefs with ${name}: the gate stays and nothing is written`, async ({ page }) => {
      await seedPrefs(page, raw)
      await page.goto('/')
      await expectGateStays(page)
      expect(await storageAfter(page)).toEqual({ writes: [], stored: raw })
    })
  }

  test('reloading the gate with a valid stored choice does not redirect', async ({ page }) => {
    await page.goto('/')
    await waitForHydration(page)
    await page.evaluate(
      ({ key, value }) => {
        window.localStorage.setItem(key, value)
      },
      { key: PREFS_KEY, value: chosen('hi') },
    )
    await page.reload()
    await expectGateStays(page)
    // The choice is really stored: a normal navigation to "/" now sends the visitor on.
    await page.goto('/', { waitUntil: 'commit' })
    await page.waitForURL((url) => url.pathname === '/hi')
  })

  test.describe('without JavaScript', () => {
    // A control item in the site's storage, so reading the storage back proves it can be read.
    const CONTROL = { name: 'e2e-control', value: '1' }
    test.use({
      javaScriptEnabled: false,
      // A fixture function; its second parameter is not named use (react-hooks lint).
      storageState: async ({ baseURL }, provide) => {
        await provide({
          cookies: [],
          origins: [{ origin: new URL(baseURL ?? '').origin, localStorage: [CONTROL] }],
        })
      },
    })

    for (const code of ENABLED_LOCALE_CODES) {
      test(`the ${code} option still opens /${code} and nothing is written`, async ({
        page,
        context,
        baseURL,
      }) => {
        await page.goto('/')
        await expect(option(page, code)).toBeVisible()
        await Promise.all([
          page.waitForURL((url) => url.pathname === `/${code}`),
          option(page, code).click(),
        ])
        // No script ran: the query stays and nothing but the control item is stored.
        expect(new URL(page.url()).search).toBe('?remember=1')
        expect(await page.locator('html').getAttribute('lang')).toBe(code)
        await expect(page.locator('h1')).toHaveText(message(uiLang(code), 'home.title'))
        const origin = new URL(baseURL ?? '').origin
        const state = await context.storageState()
        const stored = state.origins.find((entry) => entry.origin === origin)?.localStorage ?? []
        expect(stored, 'localStorage after the tap').toEqual([CONTROL])
      })
    }
  })

  test('with storage blocked the gate shows, the tap navigates and /hi shows the banner', async ({
    page,
  }) => {
    await blockStorage(page)
    await page.goto('/')
    await expectGateStays(page)
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/hi'),
      option(page, 'hi').click(),
    ])
    const banner = page.locator('section[aria-labelledby="storage-banner-title"]')
    await expect(banner).toBeVisible()
    await expect(banner.locator('#storage-banner-title')).toHaveText(message('hi', 'storage.title'))
  })

  test('the gate fetches Devanagari 400 and never a file outside Lora and the Noto 400 files', async ({
    page,
    request,
  }) => {
    const requested: string[] = []
    page.on('request', (fontRequest) => {
      const url = new URL(fontRequest.url())
      if (fontRequest.resourceType() === 'font' || url.pathname.endsWith('.woff2')) {
        requested.push(url.pathname)
      }
    })
    await page.goto('/')
    await settleFonts(page)
    await page.waitForTimeout(500)
    const families = await fontFamilies(page)
    const faces = await servedFontFaces(page, request)
    const fileOf = (family: string, weight: string | null) => {
      const face = faces.find(
        (candidate) =>
          candidate.family === family &&
          (weight === null || candidate.rule['font-weight'] === weight),
      )
      const file = face?.urls[0]?.pathname
      if (!file) throw new Error(`no @font-face for ${family} ${weight ?? ''}`)
      return file
    }
    const allowed = [
      fileOf(families.lora, null),
      fileOf(families.devanagari, '400'),
      fileOf(families.devanagariLatin, '400'),
    ]
    console.log(`[gate] font requests on /: ${JSON.stringify(requested)}`)
    expect(requested, 'Devanagari 400').toContain(fileOf(families.devanagari, '400'))
    expect(
      requested.filter((file) => !allowed.includes(file)),
      'other font files',
    ).toEqual([])
  })

  for (const routePath of ['/', '/en', '/hi']) {
    test(`a Devanagari file delayed 1.5 s keeps the layout shift on ${routePath} under 0.1 (Chromium)`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'the Layout Instability API is Chromium only')
      await recordLayoutShifts(page)
      let delayed = 0
      let released = 0
      await page.route(NOTO_FILE, async (route) => {
        delayed++
        await new Promise((resolve) => setTimeout(resolve, 1500))
        await route.continue().catch(() => undefined)
        released++
      })
      await page.goto(routePath, { waitUntil: 'domcontentloaded' })
      await expect.poll(() => delayed, { timeout: 15_000 }).toBeGreaterThan(0)
      await expect.poll(() => released === delayed, { timeout: 15_000 }).toBe(true)
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
        (pattern) => ({
          firstPaint:
            performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? Number.NaN,
          notoEnd: Math.max(
            ...performance
              .getEntriesByType('resource')
              .filter((entry) => new RegExp(pattern).test(entry.name))
              .map((entry) => (entry as PerformanceResourceTiming).responseEnd),
          ),
        }),
        NOTO_FILE.source,
      )
      const { cls, raw, shifts, inputShifts } = await layoutShift(page)
      console.log(
        `[gate] CLS on ${routePath} with Devanagari delayed 1.5 s: ${cls.toFixed(6)}, raw ` +
          `${raw.toFixed(6)} (${shifts} shifts, ${inputShifts} flagged as recent input; ` +
          `${delayed} files delayed; first paint ${timing.firstPaint.toFixed(0)} ms, ` +
          `Devanagari arrived ${timing.notoEnd.toFixed(0)} ms)`,
      )
      test.info().annotations.push({
        type: 'CLS',
        description: `${cls.toFixed(6)} (raw, recent-input shifts included: ${raw.toFixed(6)})`,
      })
      // The page painted before the Devanagari file arrived, so the swap was measured.
      expect(timing.firstPaint).toBeLessThan(timing.notoEnd)
      // No input happens in this test, so the stricter raw sum is the one held under 0.1.
      expect(raw).toBeLessThan(0.1)
    })
  }
})
