import { describe, expect, it } from 'vitest'
import {
  checkBuildNodeEnv,
  checkContentBaseUrl,
  contentSecurityPolicy,
  DISABLED_FEATURES,
  MEDIA_ORIGIN,
  PERMISSIONS_POLICY,
  securityHeaders,
} from './security-headers'

// The spec §9 CSP with <ref> filled in (owner decision D3), copied here byte for byte.
const SPEC_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' https://wlunxatrekiqygwphkgy.supabase.co; " +
  "media-src 'self' https://wlunxatrekiqygwphkgy.supabase.co; connect-src 'self'; font-src 'self'; " +
  "manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

// Features the reader may need; the policy must never switch them off (owner, 2026-11-14).
const KEPT_FEATURES = ['autoplay', 'web-share', 'fullscreen', 'clipboard-write']

/** The message checkContentBaseUrl throws for this value, or null when it passes. */
function baseUrlError(value: string): string | null {
  try {
    checkContentBaseUrl({ CONTENT_BASE_URL: value })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('contentSecurityPolicy', () => {
  it('is the spec CSP byte for byte outside `next dev`', () => {
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, {}]) {
      expect(contentSecurityPolicy(env)).toBe(SPEC_CSP)
    }
  })

  it("adds only 'unsafe-eval' to script-src under `next dev`", () => {
    const dev = contentSecurityPolicy({ NODE_ENV: 'development' })
    expect(dev).toBe(
      SPEC_CSP.replace(
        "script-src 'self' 'unsafe-inline';",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval';",
      ),
    )
    expect(dev.match(/'unsafe-eval'/g)).toHaveLength(1)
    expect(dev.replace(" 'unsafe-eval'", '')).toBe(SPEC_CSP)
  })

  it('uses the committed media origin for images and media', () => {
    expect(MEDIA_ORIGIN).toBe('https://wlunxatrekiqygwphkgy.supabase.co')
    expect(SPEC_CSP).toContain(`img-src 'self' ${MEDIA_ORIGIN};`)
    expect(SPEC_CSP).toContain(`media-src 'self' ${MEDIA_ORIGIN};`)
  })
})

describe('PERMISSIONS_POLICY', () => {
  const entries = PERMISSIONS_POLICY.split(', ')

  it('switches off every listed feature with an empty allowlist', () => {
    expect(entries).toEqual(DISABLED_FEATURES.map((feature) => `${feature}=()`))
    for (const entry of entries) expect(entry).toMatch(/^[a-z-]+=\(\)$/)
    expect(new Set(entries).size).toBe(entries.length)
  })

  it('covers the unused powerful features the owner named', () => {
    for (const feature of [
      'camera',
      'microphone',
      'geolocation',
      'payment',
      'usb',
      'serial',
      'bluetooth',
      'hid',
      'midi',
      'display-capture',
      'interest-cohort',
      'browsing-topics',
    ]) {
      expect(entries).toContain(`${feature}=()`)
    }
  })

  it('never switches off autoplay, web-share, fullscreen or clipboard-write', () => {
    const names = entries.map((entry) => entry.split('=')[0])
    for (const feature of KEPT_FEATURES) {
      expect(names).not.toContain(feature)
      expect(PERMISSIONS_POLICY).not.toContain(feature)
    }
  })
})

describe('securityHeaders', () => {
  it('sends the four headers in production, with the exact spec CSP', () => {
    expect(securityHeaders({ NODE_ENV: 'production' })).toEqual([
      { key: 'Content-Security-Policy', value: SPEC_CSP },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
    ])
  })

  it('differs under `next dev` only in the CSP', () => {
    const prod = securityHeaders({ NODE_ENV: 'production' })
    const dev = securityHeaders({ NODE_ENV: 'development' })
    expect(dev.map((header) => header.key)).toEqual(prod.map((header) => header.key))
    expect(dev.slice(1)).toEqual(prod.slice(1))
    expect(dev[0]?.value).toBe(contentSecurityPolicy({ NODE_ENV: 'development' }))
  })

  it('returns a fresh list on every call', () => {
    const env = { NODE_ENV: 'production' }
    expect(securityHeaders(env)).not.toBe(securityHeaders(env))
  })
})

describe('checkContentBaseUrl', () => {
  it('passes when CONTENT_BASE_URL is unset or empty', () => {
    expect(() => checkContentBaseUrl({})).not.toThrow()
    expect(() => checkContentBaseUrl({ CONTENT_BASE_URL: undefined })).not.toThrow()
    expect(() => checkContentBaseUrl({ CONTENT_BASE_URL: '' })).not.toThrow()
  })

  it('passes when the origin is the media origin', () => {
    for (const base of [
      `${MEDIA_ORIGIN}/storage/v1/object/public/content`,
      `${MEDIA_ORIGIN}/storage/v1/object/public/content/`,
      `${MEDIA_ORIGIN}`,
      'https://wlunxatrekiqygwphkgy.supabase.co:443/storage/v1/object/public/content',
    ]) {
      expect(() => checkContentBaseUrl({ CONTENT_BASE_URL: base })).not.toThrow()
    }
  })

  it('throws, naming only the origin, when the origin is another one', () => {
    const path = '/storage/v1/object/public/content?token=private-value'
    for (const [base, origin] of [
      ['https://abcdefghijklmnopqrst.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co'],
      ['http://wlunxatrekiqygwphkgy.supabase.co', 'http://wlunxatrekiqygwphkgy.supabase.co'],
      [
        'https://wlunxatrekiqygwphkgy.supabase.co:8443',
        'https://wlunxatrekiqygwphkgy.supabase.co:8443',
      ],
      [
        'https://wlunxatrekiqygwphkgy.supabase.co.evil.example',
        'https://wlunxatrekiqygwphkgy.supabase.co.evil.example',
      ],
      ['http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
    ] as const) {
      const message = baseUrlError(`${base}${path}`)
      expect(message).toBe(
        `CONTENT_BASE_URL origin ${origin} is not the CSP media origin ${MEDIA_ORIGIN}` +
          ' (spec §9, owner decision D3); media from it would be blocked',
      )
      expect(message).not.toContain('storage/v1')
      expect(message).not.toContain('private-value')
    }
  })

  it('never prints credentials, which are not part of the origin', () => {
    const message = baseUrlError('https://user:secret@other.supabase.co/x')
    expect(message).toMatch(/^CONTENT_BASE_URL origin https:\/\/other\.supabase\.co is not /)
    expect(message).not.toContain('user')
    expect(message).not.toContain('secret')
  })

  it('throws without echoing the value when CONTENT_BASE_URL is not a URL', () => {
    const message = baseUrlError('not a url private-value')
    expect(message).toBe(`CONTENT_BASE_URL is not a valid URL; its origin must be ${MEDIA_ORIGIN}`)
    expect(message).not.toContain('private-value')
  })
})

describe('checkBuildNodeEnv', () => {
  it("refuses NODE_ENV=development, which would put 'unsafe-eval' into the production CSP", () => {
    expect(() => checkBuildNodeEnv({ NODE_ENV: 'development' })).toThrow(
      "NODE_ENV=development is refused for `next build`: it would add 'unsafe-eval' to the production CSP (spec §9)",
    )
  })

  it('passes every NODE_ENV that gives the spec CSP', () => {
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { NODE_ENV: '' }, {}]) {
      expect(() => checkBuildNodeEnv(env)).not.toThrow()
      expect(contentSecurityPolicy(env)).toBe(SPEC_CSP)
    }
  })
})
