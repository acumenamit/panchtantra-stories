// The gated build: Production now and until the owner's Step 25b commit (P1 D4; spec §4.5, §9;
// design p1-step7-design.md §1, §5.4, §8.3 gated.spec; P1-1c). Gated leg only (@gated).
// - "/" is exactly the Coming-soon page: no redirect script, no Hindi, no link, no Devanagari font
//   request, and a stored uiLocale never sends anyone on.
// - Every reader route, /ar included, is the bilingual 404 with the four security headers, also
//   for an RSC request; /build-info.json is 404 while CONTENT_SOURCE=none (the gated leg's build).
import { DEFAULT_PREFS, serializePrefs } from '../src/core/progress/records'
import { LOCALE_REDIRECT_SCRIPT } from '../src/core/progress/locale-redirect-boot'
import { expect, test } from './fixtures'
import { fontFamilies, seedPrefs, servedFontFaces, settleFonts, storageAfter } from './page-helpers'
import { message, readerPaths, waitForHydration } from './routes'
import { expectSecurityHeaders } from './security-headers'

const COMING_SOON = '<main><h1>Storyboard</h1><p>Coming soon.</p></main>'

test.describe('the gated build', { tag: '@gated' }, () => {
  test('/ is exactly the Coming-soon page, with no redirect script, Hindi or link', async ({
    page,
    request,
  }) => {
    const response = await request.get('/')
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(html.split(COMING_SOON).length - 1, 'the Coming-soon markup').toBe(1)
    expect(html, 'the redirect script').not.toContain(`<script>${LOCALE_REDIRECT_SCRIPT}</script>`)
    expect(html, 'the redirect script, in any form').not.toContain('getEntriesByType')
    for (const banned of ['href="/en', 'href="/hi', 'lang="hi"']) {
      expect(html, banned).not.toContain(banned)
    }

    await page.goto('/')
    await waitForHydration(page)
    const dom = await page.evaluate(() => ({
      mains: [...document.querySelectorAll('main')].map((main) => main.outerHTML),
      text: document.body.innerText.replace(/\s+/g, ' ').trim(),
      hindi: document.querySelectorAll('[lang="hi"]').length,
      links: document.querySelectorAll('a[href]').length,
      scripts: [...document.scripts].filter((script) =>
        (script.textContent ?? '').includes('getEntriesByType'),
      ).length,
    }))
    expect(dom).toEqual({
      mains: [COMING_SOON],
      text: 'Storyboard Coming soon.',
      hindi: 0,
      links: 0,
      scripts: 0,
    })
  })

  test('/ requests no Devanagari file', async ({ page, request }) => {
    const fontRequests: string[] = []
    page.on('request', (fontRequest) => {
      const url = new URL(fontRequest.url())
      if (fontRequest.resourceType() === 'font' || url.pathname.endsWith('.woff2')) {
        fontRequests.push(url.pathname)
      }
    })
    await page.goto('/')
    await settleFonts(page)
    await page.waitForTimeout(500)
    const { devanagari, devanagariLatin } = await fontFamilies(page)
    const notoPaths = (await servedFontFaces(page, request))
      .filter((face) => face.family === devanagari || face.family === devanagariLatin)
      .flatMap((face) => face.urls.map((url) => url.pathname))
    expect(notoPaths, 'the four Noto files in the served CSS').toHaveLength(4)
    expect(fontRequests.filter((requested) => notoPaths.includes(requested))).toEqual([])
    expect(fontRequests.filter((requested) => /devanagari/i.test(requested))).toEqual([])
  })

  test('a stored uiLocale hi stays on / and nothing is written', async ({ page }) => {
    const stored = serializePrefs({ ...DEFAULT_PREFS, uiLocale: 'hi' })
    await seedPrefs(page, stored)
    await page.goto('/')
    await waitForHydration(page)
    await page.waitForTimeout(500)
    expect(new URL(page.url()).pathname).toBe('/')
    await expect(page.locator('main p')).toHaveText('Coming soon.')
    expect(await storageAfter(page)).toEqual({ writes: [], stored })
  })

  for (const routePath of [...readerPaths().map((route) => route.path), '/ar']) {
    test(`${routePath} is the bilingual 404 with the security headers`, async ({ page }) => {
      const response = await page.goto(routePath)
      if (!response) throw new Error(`no response for ${routePath}`)
      expect(response.status()).toBe(404)
      expectSecurityHeaders(await response.allHeaders(), routePath)
      expect(await page.locator('html').getAttribute('lang')).toBe('en')
      const h1 = page.locator('h1')
      await expect(h1).toHaveCount(1)
      await expect(h1).toContainText(message('en', 'notFound.title'))
      await expect(h1.locator('[lang="hi"]')).toHaveText(message('hi', 'notFound.title'))
    })
  }

  test('/en requested as an RSC payload is 404', async ({ request }) => {
    const response = await request.get('/en', { headers: { RSC: '1' } })
    expect(response.status()).toBe(404)
    expectSecurityHeaders(response.headers(), '/en (RSC: 1)')
  })

  test('/build-info.json is 404', async ({ request }) => {
    const response = await request.get('/build-info.json')
    expect(response.status()).toBe(404)
  })
})
