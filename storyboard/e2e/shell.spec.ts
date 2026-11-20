// The reader shell on /{code} and /{code}/grown-ups (spec §6.1 header, §6.3, §6.6 2.4.1, 3.2.6,
// 4.1.3, 1.4.10; design p1-step7-design.md §3.9 F3, §3.12 #5-#6, #12-#13, §7 items 25-35, §8.3
// shell.spec, §11 R8; P1-1c). Review leg only (@review).
// - The language switch keeps the path, changes <html lang> and saves uiLocale; a direct visit
//   never writes.
// - The skip link is the first Tab stop and Enter focuses #main. Chromium proves it with the
//   keyboard; Playwright's WebKit on Windows never Tabs to a link, so there the order is checked in
//   the DOM and the link is focused by script (annotated "narrowed").
// - One polite live region (Next's own route announcer aside), empty at load; aria-current on the
//   brand and on Grown-ups.
// - At 320 px and 150%: no horizontal scroll and no overlapping header controls, on every route.
// - F3: every visible element whose lang differs from <html> has the leading of its own language
//   (line-height / font-size from tokens.css: hi 2, 1.75, 1.5, 1.45; en 1.9, 1.6, 1.3, 1.25;
//   English islands on Hindi pages get theirs from the :lang(en) block).
// P1-4b (design p1-step10-design.md §9.3 loops, C12, F1; Step 10a): the 320 px and F3 loops also
// visit the two-paths player pages (kind 'player'). A player header holds 2 links (All stories,
// Grown-ups); the viewport and overlap checks also cover header buttons (Menu from 10b, the story
// language switch from 10d). A player page has no lang island until 10d: the story container
// carries the page's lang and there is no switch, so kind 'player' took 0 islands or more.
// Step 10d (C12, F1): the story-language switch is a header button, exactly one in a player
// header's nav and none on another route; and every route, the player pages included, has at
// least one lang island (on a player page, the switch's endonym in the other language).
// P1-3 Step 12a (design p1-step12-design.md §13.4.5 E12-R3, §3.14 N15, A17): the story landing
// (kind 'landing', two-paths in en and hi) keeps the site header: (a) the switch keeps the landing
// path both ways, from each locale, waiting for no request in flight before each switch tap (W5);
// (b) one polite live region, empty at load, and aria-current on neither the brand nor Grown-ups;
// (c) at 320 px and 150% its header holds the 3 links; (d) the F3 loop visits it (legRoutes).
import type { Page } from '@playwright/test'
import { ENABLED_LOCALE_CODES, getLocaleDef, type LocaleCode } from '../src/core/locales'
import { DEFAULT_PREFS, serializePrefs } from '../src/core/progress/records'
import { expect, test } from './fixtures'
import {
  focusByKeyboard,
  prefsText,
  quietRequests,
  seedPrefs,
  settleFonts,
  storageAfter,
} from './page-helpers'
import {
  focusLinkForWebKit,
  LANDING_DOC_PATHS,
  landingPath,
  legRoutes,
  liveRegions,
  message,
  notFoundRoute,
  readerPaths,
  uiLang,
  waitForHydration,
} from './routes'

/** line-height / font-size of each language's tokens (tokens.css :root and :lang(hi)). */
const LEADING: Readonly<Record<string, readonly number[]>> = {
  en: [1.9, 1.6, 1.3, 1.25],
  hi: [2, 1.75, 1.5, 1.45],
}

/** The other enabled locale (Step 7 has exactly two). */
function otherOf(code: LocaleCode): LocaleCode {
  const other = ENABLED_LOCALE_CODES.find((candidate) => candidate !== code)
  if (!other) throw new Error('only one enabled locale')
  return other
}

/** The stored uiLocale, or null when nothing (or something unreadable) is stored. */
async function storedUiLocale(page: Page): Promise<unknown> {
  const { stored } = await storageAfter(page)
  if (typeof stored !== 'string') return null
  return (JSON.parse(stored) as { uiLocale?: unknown }).uiLocale ?? null
}

test.describe('the reader shell', { tag: '@review' }, () => {
  for (const kind of ['home', 'grown-ups'] as const) {
    const pathOf = (code: LocaleCode) =>
      readerPaths().find((r) => r.code === code && r.kind === kind)?.path ?? ''
    test(`the language switch keeps the ${kind} path both ways and saves uiLocale`, async ({
      page,
    }) => {
      await seedPrefs(page, null)
      let code: LocaleCode = 'en'
      await page.goto(pathOf(code))
      for (let hop = 0; hop < 2; hop++) {
        const other = otherOf(code)
        await waitForHydration(page)
        const switchLink = page.locator(`header nav a[hreflang="${other}"]`)
        await expect(switchLink).toHaveAttribute('href', `${pathOf(other)}?remember=1`)
        await Promise.all([
          page.waitForURL((url) => url.pathname === pathOf(other)),
          switchLink.click(),
        ])
        await expect.poll(() => new URL(page.url()).search, 'the query is removed').toBe('')
        expect(await page.locator('html').getAttribute('lang')).toBe(other)
        await expect.poll(() => storedUiLocale(page), 'the saved uiLocale').toBe(other)
        code = other
      }
    })
  }

  // Step 12 (E12-R3 a): a landing keeps its path both ways too, from each locale. The switch is a
  // full load, so it waits until no router prefetch is in flight first (W5; §13.1 E).
  for (const first of ENABLED_LOCALE_CODES) {
    const pathOf = (code: LocaleCode) => landingPath(code, 'two-paths')
    test(`the language switch keeps the landing path both ways from /${first} and saves uiLocale`, async ({
      page,
    }) => {
      await seedPrefs(page, null)
      let code: LocaleCode = first
      await page.goto(pathOf(code))
      for (let hop = 0; hop < 2; hop++) {
        const other = otherOf(code)
        await waitForHydration(page)
        const quiet = quietRequests(page)
        const switchLink = page.locator(`header nav a[hreflang="${other}"]`)
        await expect(switchLink).toHaveAttribute('href', `${pathOf(other)}?remember=1`)
        await quiet()
        await Promise.all([
          page.waitForURL((url) => url.pathname === pathOf(other)),
          switchLink.click(),
        ])
        await expect.poll(() => new URL(page.url()).search, 'the query is removed').toBe('')
        expect(await page.locator('html').getAttribute('lang')).toBe(other)
        await expect.poll(() => storedUiLocale(page), 'the saved uiLocale').toBe(other)
        code = other
      }
    })
  }

  // The cleanup of ?remember=1 must leave the entry to Next's router (design §3.6 G1: replaceState
  // "integrates with the Next router"): with a null history state, Back from an in-app link would
  // change the URL but leave the old page on screen.
  for (const code of ENABLED_LOCALE_CODES) {
    test(`/${code}?remember=1: once the query is removed, Back from Grown-ups shows home again`, async ({
      page,
    }) => {
      const lang = uiLang(code)
      await seedPrefs(page, null)
      await page.goto(`/${code}?remember=1`)
      await waitForHydration(page)
      await expect.poll(() => new URL(page.url()).search, 'the query is removed').toBe('')
      // A marker on the document: it survives only same-document (client) navigations.
      await page.evaluate(() => {
        ;(window as unknown as Record<string, unknown>)['__e2eSameDocument'] = true
      })
      const sameDocument = () =>
        page.evaluate(() => (window as unknown as Record<string, unknown>)['__e2eSameDocument'])
      const grownUps = page.locator('header nav a', { hasText: message(lang, 'header.grownUps') })
      await Promise.all([
        page.waitForURL((url) => url.pathname === `/${code}/grown-ups`),
        grownUps.click(),
      ])
      await expect(page.locator('h1')).toHaveText(message(lang, 'grownUps.title'))
      expect(await sameDocument(), 'Grown-ups opened as a client navigation').toBe(true)

      await page.goBack()
      await expect.poll(() => new URL(page.url()).pathname).toBe(`/${code}`)
      await expect(page.locator('h1')).toHaveText(message(lang, 'home.title'))
      await expect(page.locator('header > a').first()).toHaveAttribute('aria-current', 'page')
      expect(await sameDocument(), 'Back stayed in the same document').toBe(true)
      expect(new URL(page.url()).search, 'the query stays removed').toBe('')
    })
  }

  // The switch's accessible name is the visually hidden "Change language:" plus the endonym, which
  // carries its own lang and dir (design §3.12 #6, §7 items 27, 29).
  for (const { path: routePath, code } of readerPaths()) {
    test(`${routePath}: the switch is named "${message(uiLang(code), 'header.changeLanguage')}" plus the other endonym`, async ({
      page,
    }) => {
      const other = getLocaleDef(otherOf(code))
      const prefixText = message(uiLang(code), 'header.changeLanguage')
      await page.goto(routePath)
      const switchLink = page.locator(`header nav a[hreflang="${other.code}"]`)
      await expect(switchLink).toHaveCount(1)
      await expect(
        page.getByRole('link', { name: `${prefixText} ${other.endonym}`, exact: true }),
      ).toHaveCount(1)
      const endonym = switchLink.locator(`> span[lang="${other.code}"]`)
      await expect(endonym).toHaveText(other.endonym)
      await expect(endonym).toHaveAttribute('dir', other.dir)
      // The prefix is read out but takes no space on screen.
      const prefix = switchLink.locator('> span:not([lang])')
      await expect(prefix).toHaveText(prefixText)
      const box = await prefix.boundingBox()
      expect(box?.width ?? 0, 'prefix width').toBeLessThanOrEqual(1)
      expect(box?.height ?? 0, 'prefix height').toBeLessThanOrEqual(1)
    })
  }

  test('a direct /hi with en stored leaves en', async ({ page }) => {
    const stored = serializePrefs({ ...DEFAULT_PREFS, uiLocale: 'en' })
    await seedPrefs(page, stored)
    await page.goto('/hi')
    await waitForHydration(page)
    await page.waitForTimeout(300)
    expect(await page.locator('html').getAttribute('lang')).toBe('hi')
    expect(await storageAfter(page)).toEqual({ writes: [], stored })
  })

  for (const code of ENABLED_LOCALE_CODES) {
    test(`/${code}: the skip link is the first Tab stop and Enter focuses main`, async ({
      page,
      browserName,
    }) => {
      await page.goto(`/${code}`)
      await waitForHydration(page)
      const skip = page.locator('a[href="#main"]')
      await expect(skip).toHaveText(message(uiLang(code), 'shell.skipToMain'))
      const hiddenBox = await skip.boundingBox()
      expect(hiddenBox?.width ?? 0, 'hidden until focused').toBeLessThanOrEqual(1)

      // The sequential focus order in the DOM: the skip link is the first focusable element and
      // no positive tabindex reorders anything (checked on both engines).
      const order = await page.evaluate(() => {
        const focusable = [
          ...document.querySelectorAll<HTMLElement>(
            'a[href], button, input, select, textarea, [tabindex]',
          ),
        ].filter((element) => element.tabIndex >= 0)
        return {
          first: focusable[0]?.getAttribute('href') ?? null,
          positive: focusable.filter((element) => element.tabIndex > 0).length,
        }
      })
      expect(order, 'the first focusable element').toEqual({ first: '#main', positive: 0 })

      if (browserName === 'webkit') {
        // Playwright's WebKit on Windows never moves keyboard focus to a link (Tab and Alt+Tab
        // both stay on body), so focusByKeyboard cannot reach it; see focusLinkForWebKit.
        const visible = await focusLinkForWebKit(page, 'a[href="#main"]')
        test.info().annotations.push({
          type: 'narrowed',
          description: `WebKit: Tab order checked in the DOM, link focused by script (:focus-visible ${visible})`,
        })
      } else {
        // Record every element that takes focus, so "first Tab stop" is proven, not assumed.
        await page.evaluate(() => {
          const w = window as unknown as Record<string, unknown>
          const focused: string[] = []
          w['__e2eFocused'] = focused
          document.addEventListener('focusin', (event) => {
            const target = event.target as Element
            focused.push(`${target.localName}${target.getAttribute('href') ?? ''}`)
          })
        })
        await focusByKeyboard(page, browserName, 'a[href="#main"]')
        const focused = await page.evaluate(
          () => (window as unknown as Record<string, unknown>)['__e2eFocused'] as string[],
        )
        expect(focused, 'focus stops before the skip link').toEqual(['a#main'])
      }
      await expect(skip).toBeFocused()
      const shownBox = await skip.boundingBox()
      expect(shownBox?.height ?? 0, 'visible when focused').toBeGreaterThanOrEqual(44)

      await page.keyboard.press('Enter')
      await expect(page.locator('#main')).toBeFocused()
      // main is not a control: no ring and no halo after the jump (design §7 item 26).
      const ring = await page.locator('#main').evaluate((main) => {
        const style = getComputedStyle(main)
        return { outline: style.outlineStyle, shadow: style.boxShadow }
      })
      expect(ring).toEqual({ outline: 'none', shadow: 'none' })
    })
  }

  // Step 12 (E12-R3 b): the two landings too, where neither link carries aria-current.
  for (const { path: routePath, code, kind } of [
    ...readerPaths(),
    ...LANDING_DOC_PATHS.map((landing) => ({ ...landing, kind: 'landing' as const })),
  ]) {
    const current =
      kind === 'home' ? 'the brand' : kind === 'grown-ups' ? 'the Grown-ups link' : 'neither link'
    test(`${routePath}: one polite live region, empty at load; aria-current on ${current}`, async ({
      page,
      request,
    }) => {
      const html = await (await request.get(routePath)).text()
      expect(html.split('aria-live=').length - 1, 'live regions in the server HTML').toBe(1)

      await page.goto(routePath)
      await waitForHydration(page)
      expect(await liveRegions(page), 'live regions (Next route announcer aside)').toEqual([
        { role: 'status', live: 'polite', atomic: 'true', text: '' },
      ])

      // aria-current="page" on the brand at home, on Grown-ups on that page; never on both.
      const brand = page.locator('header > a').first()
      await expect(brand).toHaveText('Storyboard')
      expect(
        await brand.evaluate((a) => [
          a.getAttribute('href'),
          a.getAttribute('lang'),
          a.getAttribute('translate'),
        ]),
      ).toEqual([`/${code}`, 'en', 'no'])
      const grownUps = page.locator('header nav a', {
        hasText: message(uiLang(code), 'header.grownUps'),
      })
      await expect(grownUps).toHaveCount(1)
      await expect(grownUps).toHaveAttribute('href', `/${code}/grown-ups`)
      const current = async (link: typeof brand) => link.getAttribute('aria-current')
      expect(await current(brand), 'brand').toBe(kind === 'home' ? 'page' : null)
      expect(await current(grownUps), 'Grown-ups').toBe(kind === 'grown-ups' ? 'page' : null)
      await expect(page.locator('nav')).toHaveAttribute(
        'aria-label',
        message(uiLang(code), 'header.navLabel'),
      )
    })
  }

  for (const route of [...legRoutes('review'), notFoundRoute('/no-such-page')]) {
    test(`${route.path} at 320 px and 150%: no horizontal scroll, no overlapping header controls`, async ({
      page,
    }) => {
      const viewport = page.viewportSize()
      if (!viewport) throw new Error('the project sets no viewport')
      await page.setViewportSize({ width: 320, height: viewport.height })
      await seedPrefs(page, prefsText(150))
      await page.goto(route.path)
      await waitForHydration(page)
      await settleFonts(page)
      const layout = await page.evaluate(() => ({
        attribute: document.documentElement.getAttribute('data-text-scale'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        links: document.querySelectorAll('header a').length,
        switches: document.querySelectorAll('header nav button[data-story-language]').length,
        controls: [...document.querySelectorAll('header a, header button')].map((a) => ({
          name: a.textContent ?? '',
          ...a.getBoundingClientRect().toJSON(),
        })) as { name: string; left: number; right: number; top: number; bottom: number }[],
      }))
      console.log(
        `[shell] ${route.path} at 320 px, 150%: scroll ${layout.scrollWidth}/${layout.clientWidth}; ` +
          `header ${JSON.stringify(layout.controls.map((c) => [c.name, Math.round(c.left), Math.round(c.top)]))}`,
      )
      expect(layout.attribute).toBe('150')
      expect(layout.scrollWidth, 'horizontal scroll').toBeLessThanOrEqual(layout.clientWidth)
      expect(layout.links, 'header links').toBe(
        route.kind === 'home' || route.kind === 'grown-ups' || route.kind === 'landing'
          ? 3
          : route.kind === 'player'
            ? 2
            : 0,
      )
      // Step 10d: the story-language switch, a header button (checked with the links below).
      expect(layout.switches, 'story-language switches in the header nav').toBe(
        route.kind === 'player' ? 1 : 0,
      )
      for (const control of layout.controls) {
        expect(control.right, `${control.name} inside the viewport`).toBeLessThanOrEqual(320)
        expect(control.left, `${control.name} inside the viewport`).toBeGreaterThanOrEqual(0)
      }
      for (let i = 0; i < layout.controls.length; i++) {
        for (let j = i + 1; j < layout.controls.length; j++) {
          const [a, b] = [layout.controls[i], layout.controls[j]]
          if (!a || !b) continue
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          expect(
            overlapX > 0.5 && overlapY > 0.5,
            `${a.name} and ${b.name} overlap (${overlapX.toFixed(1)} x ${overlapY.toFixed(1)} px)`,
          ).toBe(false)
        }
      }
    })
  }

  for (const route of [...legRoutes('review'), notFoundRoute('/no-such-page')]) {
    test(`${route.path}: F3, every lang island has its own language's leading`, async ({
      page,
    }) => {
      await page.goto(route.path)
      await waitForHydration(page)
      await settleFonts(page)
      const islands = await page.evaluate(() => {
        const pageLang = document.documentElement.lang
        return [...document.querySelectorAll('body [lang]')]
          .filter((element) => element.getAttribute('lang') !== pageLang)
          .filter((element) => {
            const box = element.getBoundingClientRect()
            return (
              box.width > 1 && box.height > 1 && getComputedStyle(element).visibility !== 'hidden'
            )
          })
          .map((element) => {
            const style = getComputedStyle(element)
            return {
              element: `${element.localName}[lang=${element.getAttribute('lang')}] ${(element.textContent ?? '').slice(0, 24)}`,
              lang: element.getAttribute('lang') ?? '',
              fontSize: parseFloat(style.fontSize),
              lineHeight: parseFloat(style.lineHeight),
            }
          })
      })
      const measured = islands.map((island) => ({
        ...island,
        ratio: Math.round((island.lineHeight / island.fontSize) * 1000) / 1000,
      }))
      const description = JSON.stringify(
        measured.map((m) => [m.element, m.fontSize, m.lineHeight, m.ratio]),
      )
      test.info().annotations.push({ type: 'F3', description })
      console.log(`[shell] F3 ${route.path} (${test.info().project.name}): ${description}`)
      // Every route has at least one island: the language switch's endonym on the site pages, the
      // story-language switch's endonym on the player pages (from 10d), the 404's Hindi parts.
      expect(measured.length, 'lang islands on the page').toBeGreaterThan(0)
      for (const island of measured) {
        const allowed = LEADING[island.lang] ?? []
        expect(
          allowed.some((value) => Math.abs(value - island.ratio) < 0.01),
          `${island.element}: ${island.fontSize}px / ${island.lineHeight}px = ${island.ratio}, not in ${island.lang} ${JSON.stringify(allowed)}`,
        ).toBe(true)
      }
    })
  }
})
