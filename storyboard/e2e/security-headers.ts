// The security header check shared by the e2e specs (spec §9, §10.2 E2E row; P1-1b). Moved
// unchanged from home.spec.ts: Playwright does not let one spec import another.
import { PERMISSIONS_POLICY } from '../src/config/security-headers'
import { expect } from './fixtures'

// The spec §9 CSP with <ref> filled in (owner decision D3), copied here byte for byte.
export const SPEC_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' https://wlunxatrekiqygwphkgy.supabase.co; " +
  "media-src 'self' https://wlunxatrekiqygwphkgy.supabase.co; connect-src 'self'; font-src 'self'; " +
  "manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

/** The four security headers, with the exact spec CSP. Header names arrive in lower case. */
export function expectSecurityHeaders(headers: Record<string, string>, what: string): void {
  expect(headers['content-security-policy'], `${what}: CSP`).toBe(SPEC_CSP)
  expect(headers['referrer-policy'], `${what}: Referrer-Policy`).toBe('no-referrer')
  expect(headers['x-content-type-options'], `${what}: X-Content-Type-Options`).toBe('nosniff')
  expect(headers['permissions-policy'], `${what}: Permissions-Policy`).toBe(PERMISSIONS_POLICY)
}
