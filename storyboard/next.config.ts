import type { NextConfig } from 'next'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import {
  checkBuildNodeEnv,
  checkContentBaseUrl,
  securityHeaders,
} from './src/config/security-headers'

const nextConfig: NextConfig = {
  // Spec §10.2: Cache Components stays off; pages are rebuilt on publish.
  cacheComponents: false,
  poweredByHeader: false,
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
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    checkBuildNodeEnv(process.env)
    checkContentBaseUrl(process.env)
  }
  return nextConfig
}
