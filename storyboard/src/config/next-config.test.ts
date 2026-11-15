import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from 'next/constants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import config from '../../next.config'
import { resolveLaunch } from './launch'
import { MEDIA_ORIGIN, securityHeaders } from './security-headers'

// How next.config.ts wires in the security headers and the D3 check (P1-1a), the experimental
// global not-found page and the launch-flag refusal (P1-1c, design p1-step7-design.md §8.1 item
// 7). The values themselves are tested in security-headers.test.ts and launch.test.ts.

const OTHER_BASE = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/content'

/** The four launch-decision inputs (design §5.1). */
const LAUNCH_INPUTS = ['READER_LAUNCH', 'VERCEL', 'VERCEL_ENV', 'CONTENT_SOURCE'] as const

// The config reads the launch inputs from the real environment: a shell that still holds, say,
// READER_LAUNCH=review from a local review build must not change what these tests see.
beforeEach(() => {
  for (const name of LAUNCH_INPUTS) vi.stubEnv(name, undefined)
})

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

describe('next.config: global not-found and the launch flag (P1-1c)', () => {
  const PHASES = [PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER]

  it('turns on exactly one experimental flag, globalNotFound, in every phase', () => {
    for (const phase of PHASES) {
      expect(config(phase).experimental).toEqual({ globalNotFound: true })
    }
  })

  it.each<[string, Readonly<Record<string, string>>, string]>([
    ['a malformed READER_LAUNCH (row 6)', { READER_LAUNCH: 'Review' }, 'malformed'],
    ['READER_LAUNCH=launched (row 6)', { READER_LAUNCH: 'launched' }, 'malformed'],
    [
      'review in Production (row 5)',
      { READER_LAUNCH: 'review', VERCEL: '1', VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' },
      'review-not-allowed',
    ],
    [
      'review locally without fixtures (row 5)',
      { READER_LAUNCH: 'review', CONTENT_SOURCE: 'none' },
      'review-not-allowed',
    ],
    [
      'review with an empty VERCEL (row 5)',
      { READER_LAUNCH: 'review', VERCEL: '', CONTENT_SOURCE: 'fixtures' },
      'review-not-allowed',
    ],
  ])('stops `next build` and `next dev` on %s', (_name, env, reason) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER]) {
      expect(() => config(phase), phase).toThrow(new Error(`reader launch refused: ${reason}`))
    }
  })

  it('does not check under `next start`: the pages are already built', () => {
    vi.stubEnv('READER_LAUNCH', 'Review')
    expect(() => config(PHASE_PRODUCTION_SERVER)).not.toThrow()
    vi.stubEnv('READER_LAUNCH', 'review')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(() => config(PHASE_PRODUCTION_SERVER)).not.toThrow()
  })

  it.each<[string, Readonly<Record<string, string>>]>([
    ['the local default (nothing set)', {}],
    ['the CI checks job', { CONTENT_SOURCE: 'fixtures' }],
    ['the CI gated leg', { VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' }],
    ['the CI review leg', { CONTENT_SOURCE: 'fixtures', READER_LAUNCH: 'review' }],
    ['a review Preview', { VERCEL: '1', VERCEL_ENV: 'preview', READER_LAUNCH: 'review' }],
    ['the kill switch', { VERCEL: '1', VERCEL_ENV: 'production', READER_LAUNCH: 'gated' }],
  ])('lets `next build` and `next dev` run for %s', (_name, env) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER]) {
      expect(() => config(phase), phase).not.toThrow()
    }
  })

  describe('with a committed launched (row 2, as after the Step 25b commit)', () => {
    afterEach(() => {
      vi.doUnmock('./launch')
      vi.resetModules()
    })

    async function launchedConfig(): Promise<typeof config> {
      vi.resetModules()
      vi.doMock('./launch', async (importOriginal) => ({
        ...(await importOriginal<Record<string, unknown>>()),
        buildLaunch: () => resolveLaunch(process.env, 'launched'),
      }))
      return (await import('../../next.config')).default
    }

    it('stops `next build` and `next dev` in Production without storage content', async () => {
      const launched = await launchedConfig()
      vi.stubEnv('VERCEL', '1')
      vi.stubEnv('VERCEL_ENV', 'production')
      for (const source of ['none', 'fixtures', undefined]) {
        vi.stubEnv('CONTENT_SOURCE', source)
        for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER]) {
          expect(() => launched(phase), `${phase} ${source}`).toThrow(
            new Error('reader launch refused: launched-without-storage'),
          )
        }
      }
      expect(() => launched(PHASE_PRODUCTION_SERVER)).not.toThrow()
    })

    it('lets the build run in Production with CONTENT_SOURCE=storage', async () => {
      const launched = await launchedConfig()
      vi.stubEnv('VERCEL', '1')
      vi.stubEnv('VERCEL_ENV', 'production')
      vi.stubEnv('CONTENT_SOURCE', 'storage')
      expect(() => launched(PHASE_PRODUCTION_BUILD)).not.toThrow()
      expect(() => launched(PHASE_DEVELOPMENT_SERVER)).not.toThrow()
    })
  })
})
