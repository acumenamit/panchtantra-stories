// The site's public origin for absolute Open Graph URLs (P1 Step 12, 12b; design
// p1-step12-design.md §3.20 N20, §4.8, B1; spec §3.5 SPEC:154, "Secret? No").
// - This file is the only reader of NEXT_PUBLIC_SITE_URL (client-boundary.test.ts holds it to
//   that). It is used only when VERCEL_ENV is exactly 'production' (no trimming, no case folding,
//   as launch.ts reads it): every other build (CI, local, the staging simulation, a Vercel Preview)
//   ignores the variable, whatever it holds, so a value in a .env* file can never make this PC's
//   builds differ from CI's.
// - In Production: unset or empty means no absolute URL tags (the build continues); a value that
//   is not an https origin stops `next build` (assertSiteUrlAllowed in next.config.ts); a good
//   value gives its origin. The verdict on the value is the publisher's
//   (tools/publisher/env.ts readSiteUrl, S12-CRIT-7): the WHATWG URL parser normalises it, so
//   surrounding spaces, a trailing "/", an explicit ":443", an empty "#" and upper case are
//   accepted; site-url.test.ts runs both readers on one table.
// - Value-free: no decision field but origin, no line and no message holds the value.
// - Pure but for buildSiteOrigin. No 'server-only' marker: next.config.ts imports this file
//   outside Next's bundler. No client file may reach it (client-boundary.test.ts SERVER_ONLY).
import type { Env } from './launch'

/** The production origin the build compares with, and the origin live-check probes. */
export const COMMITTED_PRODUCTION_ORIGIN = 'https://storyboard-one-eta.vercel.app'

export type SiteUrlStatus = 'ignored' | 'unset' | 'set' | 'refused'

export interface SiteUrlDecision {
  readonly status: SiteUrlStatus
  /** The https origin when set (no trailing slash); null otherwise. */
  readonly origin: string | null
}

/** The refusal: the variable's name and the rule, never its value. */
export const SITE_URL_REFUSED =
  'site url refused: NEXT_PUBLIC_SITE_URL must be an https origin with no path, query or port'

const decision = (status: SiteUrlStatus, origin: string | null = null): SiteUrlDecision => ({
  status,
  origin,
})

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** The publisher's shape: https, and nothing beyond scheme and host. */
function isHttpsOrigin(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  )
}

/** The design §4.8 table. */
export function resolveSiteUrl(env: Env): SiteUrlDecision {
  if (env.VERCEL_ENV !== 'production') return decision('ignored')
  const raw = env.NEXT_PUBLIC_SITE_URL ?? ''
  if (raw === '') return decision('unset')
  const url = parseUrl(raw)
  if (url === null || !isHttpsOrigin(url)) return decision('refused')
  return decision('set', url.origin)
}

/** This build's site origin, or null: the only read of this process's environment. */
export function buildSiteOrigin(): string | null {
  return resolveSiteUrl(process.env).origin
}

/** The value-free line check-build prints on every run (design §4.8, §4.13). */
export function siteUrlLine(siteUrl: SiteUrlDecision): string {
  switch (siteUrl.status) {
    case 'ignored':
      return 'site url: ignored (not a Vercel Production build)'
    case 'unset':
      return 'site url: unset'
    case 'refused':
      return 'site url: refused'
    case 'set':
      return siteUrl.origin === COMMITTED_PRODUCTION_ORIGIN
        ? 'site url: set (the committed production origin)'
        : 'site url: set (not the committed production origin)'
  }
}

/** Stops `next build` on a refused decision (next.config.ts, after the CONTENT_BASE_URL check). */
export function assertSiteUrlAllowed(siteUrl: SiteUrlDecision): void {
  if (siteUrl.status === 'refused') throw new Error(SITE_URL_REFUSED)
}
