// The shared document on every route of the leg, the 404 included (spec §6.6, §6.7, §9, §10.3;
// design p1-step7-design.md §4.1, §8.3 document.spec, §11 R2; P1-1c). Every leg, over that leg's
// routes (e2e/routes.ts): the status, the four security headers, <html lang dir>, the canvas colour,
// the three font variables, the font preload, the boot script once in <head>, the redirect script
// only on the open "/", the stored text size before first paint, the head metas, robots, the title
// and the icon and manifest links.
// R2: on the 404 (app/global-not-found.tsx bypasses every layout) the font preload count,
// theme-color, color-scheme and the icon and manifest links are reported as annotations, not
// asserted; its viewport meta and noindex are asserted.
// P1-2c (design p1-step9-design.md §2, §10.3, critic C6): the staging banner on every route, beside
// robots: exactly one (a p with the exact text and lang="en") on the staging leg, none on the gated
// and review legs, counted in the server HTML and in the DOM. The selector, marker and text come
// from src/ui/root/staging.ts, so a typo cannot pass the 0 here without failing the staging leg.
// P1-4b (design p1-step10-design.md §9.3 loops; Step 10a): on the open legs the routes include the
// two-paths player pages (kind 'player'), which carry the same shared document, the story's title
// and, as their first focusable element, the skip link to #main in the page's language.
// P1-3 Step 12a (design p1-step12-design.md §13.4.5 E12-R4, A1, A2): on the open legs the routes
// also include the two two-paths landings (kind 'landing', documentRoutes through legRoutes), titled
// with the story's title through the [locale] layout's template (W4); they carry the same shared
// document. The gated leg lists none (its landings are 404s, gated.spec.ts).
import type { APIRequestContext, Page } from '@playwright/test'
import { LOCALE_REDIRECT_SCRIPT } from '../src/core/progress/locale-redirect-boot'
import { TEXT_SCALE_BOOT_SCRIPT } from '../src/core/progress/text-scale-boot'
import {
  STAGING_BANNER_ATTRIBUTE,
  STAGING_BANNER_MARKER,
  STAGING_BANNER_TEXT,
} from '../src/ui/root/staging'
import { expect, test } from './fixtures'
import { launchLeg, legHasBanner, legOpen } from './launch-leg'
import {
  fontFamilies,
  prefsText,
  scaleSeen,
  seedPrefs,
  servedFontFaces,
  storageAfter,
  watchScaleAttribute,
} from './page-helpers'
import { documentRoutes, message, uiLang, waitForHydration, type LegRoute } from './routes'
import { expectSecurityHeaders } from './security-headers'

const LEG = launchLeg(process.env.E2E_LAUNCH)
const CANVAS = 'rgb(13, 10, 5)'
const DEFAULT_VIEWPORT = 'width=device-width, initial-scale=1'

/** How often `needle` occurs in `text`. */
function count(text: string, needle: string): number {
  return text.split(needle).length - 1
}

/** The server HTML of `route`, with the status the route must have. */
async function serverHtml(request: APIRequestContext, route: LegRoute): Promise<string> {
  const response = await request.get(route.path)
  expect(response.status(), `${route.path}: status of the server HTML`).toBe(route.status)
  return response.text()
}

/** Every content of the metas named `name`, in document order. */
async function metaContents(page: Page, name: string): Promise<(string | null)[]> {
  return page
    .locator(`meta[name="${name}"]`)
    .evaluateAll((tags) => tags.map((tag) => tag.getAttribute('content')))
}

/** The href of every link with `rel`, in document order. */
async function linkHrefs(page: Page, rel: string): Promise<(string | null)[]> {
  return page
    .locator(`link[rel="${rel}"]`)
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
}

/** Reported, not asserted (design §11 R2): a test annotation and one log line. */
function report(what: string, value: unknown): void {
  const description = `${what}: ${JSON.stringify(value)}`
  test.info().annotations.push({ type: 'R2 reported', description })
  console.log(`[document] ${test.info().project.name} ${description}`)
}

for (const route of documentRoutes(LEG)) {
  const label = `${route.path} (${route.status}, ${route.kind})`

  test(`${label} serves the shared document`, async ({ page, request }) => {
    const response = await page.goto(route.path)
    if (!response) throw new Error(`no response for ${route.path}`)
    expect(response.status(), 'status').toBe(route.status)
    expectSecurityHeaders(await response.allHeaders(), route.path)

    // <html lang dir>, the canvas colour (base.css sets it on <html>; body stays transparent, so
    // the canvas is what shows behind it) and the three font variables next/font sets.
    const root = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement)
      return {
        lang: document.documentElement.getAttribute('lang'),
        dir: document.documentElement.getAttribute('dir'),
        canvas: html.backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        fonts: ['--font-lora', '--font-devanagari', '--font-devanagari-latin'].map((name) =>
          html.getPropertyValue(name).trim(),
        ),
      }
    })
    expect(root.lang, 'html lang').toBe(route.lang)
    expect(root.dir, 'html dir').toBe(route.dir)
    expect(root.canvas, 'the canvas colour on <html>').toBe(CANVAS)
    expect(['rgba(0, 0, 0, 0)', 'transparent', CANVAS], 'body background').toContain(root.body)
    for (const value of root.fonts) expect(value, 'a font variable').not.toBe('')

    // The font preload: exactly one, Lora, on 200 pages; zero or one (Lora if any) on the 404.
    const { lora } = await fontFamilies(page)
    const loraPaths = (await servedFontFaces(page, request))
      .filter((face) => face.family === lora)
      .flatMap((face) => face.urls.map((url) => url.pathname))
    expect(loraPaths, 'the Lora file').toHaveLength(1)
    const preloads = (await linkHrefs(page, 'preload'))
      .filter((href): href is string => href !== null)
      .map((href) => new URL(href, page.url()).pathname)
    const fontPreloads = await page.locator('link[rel="preload"][as="font"]').count()
    if (route.status === 200) {
      expect(fontPreloads, 'font preloads').toBe(1)
      expect(
        preloads.filter((href) => href.endsWith('.woff2')),
        'the preloaded font',
      ).toEqual(loraPaths)
    } else {
      report('font preloads on the 404', fontPreloads)
      expect(fontPreloads, 'font preloads on the 404').toBeLessThanOrEqual(1)
      const fontHrefs = preloads.filter((href) => href.endsWith('.woff2'))
      for (const href of fontHrefs) expect(loraPaths, 'a 404 font preload is Lora').toContain(href)
    }

    // The boot script once, in <head>; the redirect script once in the open "/" only, after it.
    const html = await serverHtml(request, route)
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
    expect(head.length, '<head> in the server HTML').toBeGreaterThan(0)
    const boot = `<script>${TEXT_SCALE_BOOT_SCRIPT}</script>`
    const redirect = `<script>${LOCALE_REDIRECT_SCRIPT}</script>`
    expect(count(html, boot), 'boot script elements').toBe(1)
    expect(count(head, boot), 'boot script elements in <head>').toBe(1)
    const redirects = legOpen(LEG) && route.path === '/' ? 1 : 0
    expect(count(html, redirect), 'redirect script elements').toBe(redirects)
    expect(count(head, redirect), 'redirect script elements in <head>').toBe(redirects)
    if (redirects === 1) expect(head.indexOf(redirect)).toBeGreaterThan(head.indexOf(boot))
    const domScripts = await page.evaluate(
      ({ bootText, redirectText }) => {
        const scripts = [...document.scripts]
        const where = (text: string) =>
          scripts.filter((s) => s.textContent === text).map((s) => s.parentElement?.localName)
        return { boot: where(bootText), redirect: where(redirectText) }
      },
      { bootText: TEXT_SCALE_BOOT_SCRIPT, redirectText: LOCALE_REDIRECT_SCRIPT },
    )
    expect(domScripts.boot, 'boot script in the DOM').toEqual(['head'])
    expect(domScripts.redirect, 'redirect script in the DOM').toEqual(
      redirects === 1 ? ['head'] : [],
    )

    // Head metas. The viewport is asserted everywhere; theme-color and color-scheme on 200 pages
    // and reported on the 404 (R2).
    const viewport = await metaContents(page, 'viewport')
    expect(viewport, 'viewport meta').toEqual([DEFAULT_VIEWPORT])
    expect(viewport[0] ?? '', 'no maximum-scale').not.toContain('maximum-scale')
    const themeColor = await metaContents(page, 'theme-color')
    const colorScheme = await metaContents(page, 'color-scheme')
    if (route.status === 200) {
      expect(themeColor, 'theme-color meta').toEqual(['#0d0a05'])
      expect(colorScheme, 'color-scheme meta').toEqual(['dark'])
    } else {
      report('theme-color on the 404', themeColor)
      report('color-scheme on the 404', colorScheme)
    }

    // Robots: every robots meta says noindex; a 200 page has exactly one, noindex, nofollow.
    const robots = await metaContents(page, 'robots')
    expect(robots.length, 'robots metas').toBeGreaterThan(0)
    for (const content of robots) expect(content ?? '', 'a robots meta').toContain('noindex')
    if (route.status === 200) expect(robots, 'robots on a 200 page').toEqual(['noindex, nofollow'])

    // The staging banner (P1-2c): one on the staging leg, none elsewhere, in the server HTML and in
    // the DOM. The flight copy of the attribute is JSON-escaped, so the marker counts banners; any
    // form of the attribute name and the raw text are also absent from the other legs' HTML.
    const banners = legHasBanner(LEG) ? 1 : 0
    expect(count(html, STAGING_BANNER_MARKER), 'staging banners in the server HTML').toBe(banners)
    if (banners === 0) {
      expect(count(html, STAGING_BANNER_ATTRIBUTE), 'the banner attribute in any form').toBe(0)
      expect(count(html, STAGING_BANNER_TEXT), 'the banner text in the server HTML').toBe(0)
    }
    const banner = page.locator(`[${STAGING_BANNER_ATTRIBUTE}]`)
    await expect(banner, 'staging banners in the DOM').toHaveCount(banners)
    if (banners === 1) {
      expect(
        await banner.evaluate((element) => ({
          element: element.localName,
          lang: element.getAttribute('lang'),
          text: element.textContent,
        })),
        'the staging banner in the DOM',
      ).toEqual({ element: 'p', lang: 'en', text: STAGING_BANNER_TEXT })
    }

    // The title.
    expect(await page.title(), 'title').not.toBe('')
    expect(await page.title(), 'title').toBe(route.title)

    // A player page renders its own skip link (the (player) group has no layout): exactly one, the
    // first focusable element, to the page's main, in the page's language.
    if (route.kind === 'player') {
      const skip = await page.evaluate(() => {
        const focusable = [
          ...document.querySelectorAll<HTMLElement>(
            'a[href], button, input, select, textarea, [tabindex]',
          ),
        ].filter((element) => element.tabIndex >= 0)
        return {
          links: document.querySelectorAll('a[href="#main"]').length,
          first: focusable[0]?.getAttribute('href') ?? null,
          text: document.querySelector('a[href="#main"]')?.textContent ?? null,
          target: document.getElementById('main')?.localName ?? null,
        }
      })
      expect(skip, 'the skip link').toEqual({
        links: 1,
        first: '#main',
        text: message(uiLang(route.lang), 'shell.skipToMain'),
        target: 'main',
      })
    }

    // Icon, apple-touch-icon and manifest links on 200 pages; reported on the 404 (R2).
    const links = {
      icon: await linkHrefs(page, 'icon'),
      appleTouchIcon: await linkHrefs(page, 'apple-touch-icon'),
      manifest: await linkHrefs(page, 'manifest'),
    }
    if (route.status === 200) {
      expect(links.icon, 'icon link').toHaveLength(1)
      expect(links.appleTouchIcon, 'apple-touch-icon link').toHaveLength(1)
      expect(links.manifest, 'manifest link').toEqual(['/manifest.webmanifest'])
    } else {
      report('icon, apple-touch-icon and manifest links on the 404', links)
    }
  })

  test(`${label} applies a stored 150% before first paint`, async ({ page, browserName }) => {
    const stored = prefsText(150)
    await seedPrefs(page, stored)
    await watchScaleAttribute(page)
    const response = await page.goto(route.path)
    expect(response?.status(), 'status').toBe(route.status)
    expect(new URL(page.url()).pathname, 'no redirect').toBe(route.path)

    expect(await page.locator('html').getAttribute('data-text-scale')).toBe('150')
    const seen = await scaleSeen(page)
    expect(seen, 'the attribute appeared').not.toBeNull()
    expect(seen?.value).toBe('150')
    expect(seen?.bodyWasNull, 'document.body when data-text-scale appeared').toBe(true)
    if (browserName === 'chromium') {
      expect(seen?.paintEntries, 'paint entries when data-text-scale appeared').toBe(0)
    }
    // Opening a page never writes (spec §6.3), also after hydration.
    await waitForHydration(page)
    expect(await storageAfter(page)).toEqual({ writes: [], stored })
  })
}
