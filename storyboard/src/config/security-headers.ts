// Security response headers for every route (spec §9, P1-1a). Pure: the caller passes the
// environment in, so next.config.ts, the unit tests and the e2e checks share one source.
// Static pages cannot carry nonces and Next.js emits inline bootstrap scripts, so script-src keeps
// 'unsafe-inline' (spec §9). `next dev` also needs 'unsafe-eval' for its development tooling, so it is
// added there only (owner, 2026-11-14); production sends exactly the spec CSP.

export type Env = Readonly<Record<string, string | undefined>>

/** One response header in the shape next.config.ts headers() takes. */
export interface SecurityHeader {
  readonly key: string
  readonly value: string
}

/**
 * The one origin that serves media and images: the project's Supabase Storage (owner decision D3,
 * 2026-11-14). It is a committed constant because the CSP is fixed at build time.
 */
export const MEDIA_ORIGIN = 'https://wlunxatrekiqygwphkgy.supabase.co'

// The spec §9 CSP, directive by directive and in the spec's order.
const CSP_DIRECTIVES: readonly (readonly [name: string, sources: readonly string[]])[] = [
  ['default-src', ["'self'"]],
  ['script-src', ["'self'", "'unsafe-inline'"]],
  ['style-src', ["'self'", "'unsafe-inline'"]],
  ['img-src', ["'self'", MEDIA_ORIGIN]],
  ['media-src', ["'self'", MEDIA_ORIGIN]],
  ['connect-src', ["'self'"]],
  ['font-src', ["'self'"]],
  ['manifest-src', ["'self'"]],
  ['object-src', ["'none'"]],
  ['base-uri', ["'self'"]],
  ['form-action', ["'self'"]],
  ['frame-ancestors', ["'none'"]],
]

/**
 * Powerful features the reader never uses, switched off for every origin (owner, 2026-11-14).
 * autoplay, web-share, fullscreen and clipboard-write are left out on purpose and keep the browser
 * default: the reader may play audio after a tap and offers a share fallback.
 */
export const DISABLED_FEATURES = [
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
] as const

/** "feature=()" gives the feature an empty allowlist: no origin, not even this site, may use it. */
export const PERMISSIONS_POLICY = DISABLED_FEATURES.map((feature) => `${feature}=()`).join(', ')

/** True only under `next dev`, which sets NODE_ENV=development. */
function isDevelopment(env: Env): boolean {
  return env.NODE_ENV === 'development'
}

/** The spec §9 CSP; under `next dev` script-src also gets 'unsafe-eval', and nothing else changes. */
export function contentSecurityPolicy(env: Env): string {
  return CSP_DIRECTIVES.map(([name, sources]) => {
    const all =
      name === 'script-src' && isDevelopment(env) ? [...sources, "'unsafe-eval'"] : sources
    return `${name} ${all.join(' ')}`
  }).join('; ')
}

/** The headers sent on every route: CSP, Referrer-Policy, X-Content-Type-Options, Permissions-Policy. */
export function securityHeaders(env: Env): SecurityHeader[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(env) },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
  ]
}

/**
 * Whenever CONTENT_BASE_URL is set (non-empty), its origin must be MEDIA_ORIGIN, or the CSP would block
 * the media it points to. next.config.ts calls this during `next build`, so the build stops instead
 * (owner decision D3, 2026-11-14). Unset or empty passes, as the content loader treats empty as
 * unset. Messages name at most the origin, never the full value.
 */
export function checkContentBaseUrl(env: Env): void {
  const raw = env.CONTENT_BASE_URL
  if (raw === undefined || raw === '') return
  let origin: string
  try {
    origin = new URL(raw).origin
  } catch {
    throw new Error(`CONTENT_BASE_URL is not a valid URL; its origin must be ${MEDIA_ORIGIN}`)
  }
  if (origin !== MEDIA_ORIGIN) {
    throw new Error(
      `CONTENT_BASE_URL origin ${origin} is not the CSP media origin ${MEDIA_ORIGIN}` +
        ' (spec §9, owner decision D3); media from it would be blocked',
    )
  }
}

/**
 * A build must never run with NODE_ENV=development: the CSP would then carry the dev-only
 * 'unsafe-eval' into production. next.config.ts calls this during `next build`, so the build stops
 * instead (owner, 2026-11-14). `next dev` never calls it.
 */
export function checkBuildNodeEnv(env: Env): void {
  if (isDevelopment(env)) {
    throw new Error(
      "NODE_ENV=development is refused for `next build`: it would add 'unsafe-eval' to the production CSP (spec §9)",
    )
  }
}
