import { expect, test } from './fixtures'
import { expectSecurityHeaders } from './security-headers'

test('home page renders the placeholder', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Storyboard' })).toBeVisible()
})

test('home page sets no cookies', async ({ page, context }) => {
  await page.goto('/')
  expect(await context.cookies()).toEqual([])
})

test('home page sends the security headers', async ({ page }) => {
  const response = await page.goto('/')
  if (!response) throw new Error('no response for /')
  expectSecurityHeaders(await response.allHeaders(), '/')
})

test('a missing page and a static script send the security headers too', async ({
  page,
  request,
}) => {
  const missing = await page.goto('/no-such-page')
  if (!missing) throw new Error('no response for /no-such-page')
  expect(missing.status()).toBe(404)
  expectSecurityHeaders(await missing.allHeaders(), '/no-such-page')

  await page.goto('/')
  const scriptSrc = await page.locator('script[src*="/_next/static/"]').first().getAttribute('src')
  if (!scriptSrc) throw new Error('the home page loads no /_next/static script')
  const script = await request.get(scriptSrc)
  expect(script.status()).toBe(200)
  expectSecurityHeaders(script.headers(), scriptSrc)
})
