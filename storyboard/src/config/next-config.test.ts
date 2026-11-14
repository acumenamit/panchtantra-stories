import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from 'next/constants'
import { afterEach, describe, expect, it, vi } from 'vitest'
import config from '../../next.config'
import { MEDIA_ORIGIN, securityHeaders } from './security-headers'

// How next.config.ts wires in the security headers and the D3 check (P1-1a). The values themselves
// are tested in security-headers.test.ts.

const OTHER_BASE = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/content'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('next.config', () => {
  it('sends the production security headers on every route and keeps the fixed settings', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CONTENT_BASE_URL', '')
    const nextConfig = config(PHASE_PRODUCTION_BUILD)
    expect(nextConfig.cacheComponents).toBe(false)
    expect(nextConfig.poweredByHeader).toBe(false)
    expect(await nextConfig.headers?.()).toEqual([
      { source: '/:path*', headers: securityHeaders({ NODE_ENV: 'production' }) },
    ])
  })

  it('stops `next build` when CONTENT_BASE_URL is on another origin, naming only that origin', () => {
    vi.stubEnv('CONTENT_BASE_URL', OTHER_BASE)
    expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(
      `CONTENT_BASE_URL origin https://abcdefghijklmnopqrst.supabase.co is not the CSP media origin ${MEDIA_ORIGIN}`,
    )
  })

  it('lets `next build` run when CONTENT_BASE_URL is on the media origin', () => {
    vi.stubEnv('CONTENT_BASE_URL', `${MEDIA_ORIGIN}/storage/v1/object/public/content`)
    expect(() => config(PHASE_PRODUCTION_BUILD)).not.toThrow()
  })

  it('does not run the check under `next dev` or `next start` (D3 covers the build)', () => {
    vi.stubEnv('CONTENT_BASE_URL', OTHER_BASE)
    for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER]) {
      expect(() => config(phase)).not.toThrow()
    }
  })

  it("stops `next build` under NODE_ENV=development, so 'unsafe-eval' never reaches production", () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CONTENT_BASE_URL', '')
    expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(
      "NODE_ENV=development is refused for `next build`: it would add 'unsafe-eval' to the production CSP (spec §9)",
    )
  })

  it('lets `next dev` run under NODE_ENV=development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CONTENT_BASE_URL', '')
    expect(() => config(PHASE_DEVELOPMENT_SERVER)).not.toThrow()
  })
})
