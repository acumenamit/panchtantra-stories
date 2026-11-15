// The bilingual 404 page for every unmatched URL (spec §6.1 not found, §6.6 3.1.1, §9; design
// p1-step7-design.md §3.12 #2, §4.3, §8.3 not-found.spec, §11 R1; P1-1c). Both legs: the same page
// from app/global-not-found.tsx whether the reader is gated or open. Each URL returns 404 with the
// four security headers, lang="en", the bilingual h1 (its Hindi part in lang="hi"), both
// paragraphs, exactly one link (to "/", at least 56 px tall), the title and noindex.
import { expect, test } from './fixtures'
import { message, NOT_FOUND_PATHS, NOT_FOUND_TITLE } from './routes'
import { expectSecurityHeaders } from './security-headers'

for (const notFoundPath of NOT_FOUND_PATHS) {
  test(`${notFoundPath} is the bilingual 404 page`, async ({ page }) => {
    const response = await page.goto(notFoundPath)
    if (!response) throw new Error(`no response for ${notFoundPath}`)
    expect(response.status(), 'status').toBe(404)
    expectSecurityHeaders(await response.allHeaders(), notFoundPath)

    expect(await page.locator('html').getAttribute('lang')).toBe('en')
    expect(await page.locator('html').getAttribute('dir')).toBe('ltr')
    await expect(page.locator('main')).toHaveCount(1)

    // h1 "Page not found" with "पेज नहीं मिला" in lang="hi" on its second line.
    const h1 = page.locator('h1')
    await expect(h1).toHaveCount(1)
    const enTitle = message('en', 'notFound.title')
    const hiTitle = message('hi', 'notFound.title')
    expect((await h1.textContent())?.replace(/\s+/g, ' ').trim()).toBe(`${enTitle} ${hiTitle}`)
    await expect(h1.locator('[lang="hi"]')).toHaveText(hiTitle)

    // The English paragraph, then the Hindi one in lang="hi".
    const paragraphs = page.locator('main > p')
    await expect(paragraphs).toHaveCount(2)
    await expect(paragraphs.nth(0)).toHaveText(message('en', 'notFound.body'))
    expect(await paragraphs.nth(0).getAttribute('lang')).toBeNull()
    await expect(paragraphs.nth(1)).toHaveText(message('hi', 'notFound.body'))
    expect(await paragraphs.nth(1).getAttribute('lang')).toBe('hi')

    // Exactly one link, to "/", in both languages.
    const links = page.locator('a[href]')
    await expect(links).toHaveCount(1)
    expect(await links.getAttribute('href')).toBe('/')
    await expect(links).toContainText(message('en', 'notFound.link'))
    await expect(links.locator('[lang="hi"]')).toHaveText(message('hi', 'notFound.link'))
    // Styled as a button at least --target-choice (56 px) tall (design §4.3).
    const linkBox = await links.boundingBox()
    expect(linkBox?.height ?? 0, 'link height').toBeGreaterThanOrEqual(56)

    expect(await page.title()).toBe(NOT_FOUND_TITLE)
    const robots = await page
      .locator('meta[name="robots"]')
      .evaluateAll((tags) => tags.map((tag) => tag.getAttribute('content') ?? ''))
    expect(robots.length, 'robots metas').toBeGreaterThan(0)
    for (const content of robots) expect(content, 'a robots meta').toContain('noindex')
  })
}

test('the 404 link opens the start page', async ({ page }) => {
  await page.goto('/no-such-page')
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => new URL(candidate.url()).pathname === '/'),
    page.locator('a[href="/"]').click(),
  ])
  expect(response.status()).toBe(200)
  await expect(page.locator('h1')).toHaveText('Storyboard')
  expect(new URL(page.url()).pathname).toBe('/')
})
