// The staging banner on every route of a staging build (spec §3.2 staging row, §6.6; design
// p1-step9-design.md §3.6 rows 3-8, §4.2-§4.4, §10.3, critic C6; P1-2c). Staging leg only
// (@staging): the build scripts/testing/staging-build.ts makes from the 3 synthetic fixtures served
// as a staging catalogue, with the reader open.
// - One test per documentRoutes('staging') route ("/", /en, /hi, both Grown-ups pages, the two
//   two-paths player pages and one unmatched URL): exactly one banner, a p with the exact text
//   and lang="en", and the marker once in the server HTML; the first element child of <body>
//   that is not [hidden] (Next renders its own <div hidden=""> first, so body.firstElementChild is
//   never used); outside main and header, before the skip link where the page has one; no role,
//   aria-live or tabindex and nothing focusable inside; in normal flow at the top, full width,
//   amber fill, dark text, bold.
// - One reflow test: /hi at 320 px wide and 150% text has no horizontal scroll and the banner fits.
// The selector, marker and text come from src/ui/root/staging.ts; colours are the tokens'
// --color-accent (#f59e0b) and --color-text-on-accent (#0d0a05). The shared guard in fixtures.ts
// still fails any cookie, CSP violation or foreign request.
import {
  STAGING_BANNER_ATTRIBUTE,
  STAGING_BANNER_MARKER,
  STAGING_BANNER_TEXT,
} from '../src/ui/root/staging'
import { expect, test } from './fixtures'
import { prefsText, seedPrefs, settleFonts } from './page-helpers'
import { documentRoutes, waitForHydration } from './routes'

const BANNER = `[${STAGING_BANNER_ATTRIBUTE}]`
const AMBER = 'rgb(245, 158, 11)'
const TEXT_ON_AMBER = 'rgb(13, 10, 5)'
const SKIP_LINK = 'a[href="#main"]'

/** How often `needle` occurs in `text`. */
function count(text: string, needle: string): number {
  return text.split(needle).length - 1
}

test.describe('the staging banner', { tag: '@staging' }, () => {
  for (const route of documentRoutes('staging')) {
    const label = `${route.path} (${route.status}, ${route.kind})`
    // The site pages and the player pages (P1-4b, design p1-step10-design.md §9.3 loops) render a
    // skip link after the banner; "/" and the 404 have none.
    const hasSkipLink =
      route.kind === 'home' || route.kind === 'grown-ups' || route.kind === 'player'

    test(`${label} shows one staging banner, first in the body and in flow`, async ({
      page,
      request,
    }) => {
      const served = await request.get(route.path)
      expect(served.status(), 'status of the server HTML').toBe(route.status)
      const markers = count(await served.text(), STAGING_BANNER_MARKER)
      expect(markers, 'markers in the server HTML').toBe(1)

      const response = await page.goto(route.path)
      expect(response?.status(), 'status').toBe(route.status)
      await waitForHydration(page)
      await settleFonts(page)

      const banner = page.locator(BANNER)
      await expect(banner, 'banners in the DOM').toHaveCount(1)
      const found = await page.evaluate(
        ({ selector, skipSelector }) => {
          const element = document.querySelector(selector)
          if (!(element instanceof HTMLElement)) throw new Error('no staging banner')
          const firstShown = [...document.body.children].find(
            (child) => !child.hasAttribute('hidden'),
          )
          const skip = document.querySelector(skipSelector)
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return {
            element: element.localName,
            lang: element.getAttribute('lang'),
            text: element.textContent,
            parent: element.parentElement?.localName ?? null,
            firstShown: firstShown === element,
            inside: element.closest('main, header')?.localName ?? null,
            skipLink:
              skip === null
                ? null
                : element.compareDocumentPosition(skip) & Node.DOCUMENT_POSITION_FOLLOWING
                  ? 'after the banner'
                  : 'before the banner',
            role: element.getAttribute('role'),
            ariaLive: element.getAttribute('aria-live'),
            tabindex: element.getAttribute('tabindex'),
            focusable: element.querySelectorAll(
              'a[href], button, input, select, textarea, [tabindex], [contenteditable]',
            ).length,
            position: style.position,
            background: style.backgroundColor,
            color: style.color,
            weight: style.fontWeight,
            scrollY: window.scrollY,
            top: rect.top,
            left: rect.left,
            width: rect.width,
            viewportWidth: document.documentElement.clientWidth,
          }
        },
        { selector: BANNER, skipSelector: SKIP_LINK },
      )
      test.info().annotations.push({
        type: 'banner box',
        description: `top ${found.top}, left ${found.left}, width ${found.width} of ${found.viewportWidth}`,
      })

      // One p, the exact English line.
      expect(found.element, 'the banner element').toBe('p')
      expect(found.lang, 'the banner lang').toBe('en')
      expect(found.text, 'the banner text').toBe(STAGING_BANNER_TEXT)
      // First in <body> after Next's hidden div; outside main and header; before the skip link.
      expect(found.parent, 'the banner parent').toBe('body')
      expect(found.firstShown, 'the first element child of body that is not [hidden]').toBe(true)
      expect(found.inside, 'inside main or header').toBeNull()
      expect(found.skipLink, 'the skip link').toBe(hasSkipLink ? 'after the banner' : null)
      // Not a landmark, live region or focus stop.
      expect(found.role, 'role').toBeNull()
      expect(found.ariaLive, 'aria-live').toBeNull()
      expect(found.tabindex, 'tabindex').toBeNull()
      expect(found.focusable, 'focusable descendants').toBe(0)
      // In normal flow, at the top of the page and full width; amber fill, dark text, bold.
      expect(found.position, 'position').toBe('static')
      expect(found.scrollY, 'scroll').toBe(0)
      expect(found.top, 'top').toBe(0)
      expect(found.left, 'left').toBe(0)
      expect(Math.abs(found.width - found.viewportWidth), 'full width').toBeLessThan(0.5)
      expect(found.background, 'background').toBe(AMBER)
      expect(found.color, 'colour').toBe(TEXT_ON_AMBER)
      expect(found.weight, 'font weight').toBe('700')
    })
  }

  test('/hi at 320 px and 150%: no horizontal scroll, and the banner fits the viewport', async ({
    page,
  }) => {
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('the project sets no viewport')
    await page.setViewportSize({ width: 320, height: viewport.height })
    await seedPrefs(page, prefsText(150))
    await page.goto('/hi')
    await waitForHydration(page)
    await settleFonts(page)
    const layout = await page.evaluate((selector) => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error('no staging banner')
      const rect = element.getBoundingClientRect()
      return {
        attribute: document.documentElement.getAttribute('data-text-scale'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        left: rect.left,
        right: rect.right,
        height: rect.height,
        textWidth: element.scrollWidth,
        boxWidth: element.clientWidth,
      }
    }, BANNER)
    console.log(
      `[staging-banner] /hi at 320 px, 150% (${test.info().project.name}): scroll ` +
        `${layout.scrollWidth}/${layout.clientWidth}; banner ${layout.left}-${layout.right}, ` +
        `${layout.height} px tall`,
    )
    expect(layout.attribute, 'the stored text size').toBe('150')
    expect(layout.clientWidth, 'the viewport width').toBe(320)
    expect(layout.scrollWidth, 'horizontal scroll').toBeLessThanOrEqual(layout.clientWidth)
    expect(layout.left, 'banner left').toBeGreaterThanOrEqual(0)
    expect(layout.right, 'banner right').toBeLessThanOrEqual(layout.clientWidth)
    expect(layout.textWidth, 'the banner text overflows its box').toBeLessThanOrEqual(
      layout.boxWidth,
    )
  })
})
