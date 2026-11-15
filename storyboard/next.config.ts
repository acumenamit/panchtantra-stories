import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants'
import { assertLaunchAllowed, buildLaunch } from './src/config/launch'
import {
  checkBuildNodeEnv,
  checkContentBaseUrl,
  securityHeaders,
} from './src/config/security-headers'

const nextConfig: NextConfig = {
  // Spec §10.2: Cache Components stays off; pages are rebuilt on publish.
  cacheComponents: false,
  poweredByHeader: false,
  // P1-1c (design p1-step7-design.md §4.3): one bilingual app/global-not-found.tsx for every
  // unmatched URL, because the reader has two root layouts. Experimental in the pinned Next.
  experimental: { globalNotFound: true },
  // Spec §9: the CSP and the other security headers on every route.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders(process.env) }]
  },
}

/**
 * Next calls this with the phase it is in. During `next build` two checks can stop the build:
 * - Owner decision D3: a CONTENT_BASE_URL on any origin other than the CSP media origin, with a
 *   message that names only its origin. `next dev` and `next start` skip it: CONTENT_BASE_URL only
 *   feeds the content loader, which runs with the build.
 * - NODE_ENV=development, which would put the dev-only 'unsafe-eval' into the production CSP
 *   (owner, 2026-11-14).
 * `next build` and `next dev` also stop on a refused launch decision (P1 D4, design §3.2 M1,
 * §5.3): a malformed READER_LAUNCH, 'review' outside a Preview or local fixtures build, or a
 * committed 'launched' in Production without storage content. `next start` serves pages already
 * built, so it does not check.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    checkBuildNodeEnv(process.env)
    checkContentBaseUrl(process.env)
  }
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER) {
    assertLaunchAllowed(buildLaunch())
  }
  return nextConfig
}
