import { PERMISSIONS_POLICY } from '../src/config/security-headers'
import { expect, test } from './fixtures'

// The spec §9 CSP with <ref> filled in (owner decision D3), copied here byte for byte.
const SPEC_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' https://wlunxatrekiqygwphkgy.supabase.co; " +
  "media-src 'self' https://wlunxatrekiqygwphkgy.supabase.co; connect-src 'self'; font-src 'self'; " +
  "manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

/** The four security headers, with the exact spec CSP. Header names arrive in lower case. */
function expectSecurityHeaders(headers: Record<string, string>, what: string): void {
  expect(headers['content-security-policy'], `${what}: CSP`).toBe(SPEC_CSP)
  expect(headers['referrer-policy'], `${what}: Referrer-Policy`).toBe('no-referrer')
  expect(headers['x-content-type-options'], `${what}: X-Content-Type-Options`).toBe('nosniff')
  expect(headers['permissions-policy'], `${what}: Permissions-Policy`).toBe(PERMISSIONS_POLICY)
}

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
