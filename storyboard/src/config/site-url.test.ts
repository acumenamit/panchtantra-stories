// The site URL decision (P1 Step 12, 12b; design p1-step12-design.md §3.20 N20, §4.8, B1; test plan
// T12-30). Every row is a literal, never computed. The verdict on the value is the publisher's
// (tools/publisher/env.ts readSiteUrl, S12-CRIT-7): g3 runs both readers on the same rows and needs
// the same answers. The set branch is tested here only through resolveSiteUrl with an explicit env
// object; buildSiteOrigin is read with process.env only on the branches that leave it null.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSiteUrl } from '../../tools/publisher/env'
import {
  COMMITTED_PRODUCTION_ORIGIN,
  SITE_URL_REFUSED,
  assertSiteUrlAllowed,
  buildSiteOrigin,
  resolveSiteUrl,
  siteUrlLine,
  type SiteUrlDecision,
} from './site-url'

const storyboard = join(dirname(fileURLToPath(import.meta.url)), '../..')

afterEach(() => {
  vi.unstubAllEnvs()
})

/** An explicit env object: the two inputs the decision reads. */
const env = (vercelEnv: string | undefined, value: string | undefined) => ({
  VERCEL_ENV: vercelEnv,
  NEXT_PUBLIC_SITE_URL: value,
})

const COMMITTED = 'https://storyboard-one-eta.vercel.app'

const ignored: SiteUrlDecision = { status: 'ignored', origin: null }
const unset: SiteUrlDecision = { status: 'unset', origin: null }
const refused: SiteUrlDecision = { status: 'refused', origin: null }
const set = (origin: string): SiteUrlDecision => ({ status: 'set', origin })

/** Values with a bad shape, one per refused class of design §4.8 (and the S12-AUD-14 mutants). */
const REFUSED_VALUES: readonly (readonly [why: string, value: string])[] = [
  ['http', 'http://x.vercel.app'],
  ['a path', 'https://x.vercel.app/path'],
  ['a query', 'https://x.vercel.app?q=1'],
  ['a fragment', 'https://x.vercel.app#frag'],
  ['a port', 'https://x.vercel.app:8443'],
  ['user info', 'https://u:p@x.vercel.app'],
  ['a bare host', 'x.vercel.app'],
  ['a space', ' '],
  ['no host', 'https://'],
]

/** Values the URL parser normalises to an https origin (S12-CRIT-7): accepted, as the publisher does. */
const NORMALISED_VALUES: readonly (readonly [why: string, value: string])[] = [
  ['surrounding space and a newline', ' https://x.vercel.app/\n'],
  ['a trailing slash', 'https://x.vercel.app/'],
  ['an explicit :443', 'https://x.vercel.app:443'],
  ['an empty fragment', 'https://x.vercel.app#'],
  ['upper case', 'HTTPS://X.VERCEL.APP'],
]

describe('resolveSiteUrl: the design §4.8 table (T12-30 g1)', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['preview', 'preview'],
    ['development', 'development'],
    ['Production (case)', 'Production'],
    [' production (space)', ' production'],
  ])('(g1) VERCEL_ENV %s: ignored, whatever the value', (_name, vercelEnv) => {
    for (const value of [undefined, '', COMMITTED, 'https://example.vercel.app', 'http://x']) {
      expect
        .soft(resolveSiteUrl(env(vercelEnv, value)), `(g1) ignored with ${String(value)}`)
        .toStrictEqual(ignored)
    }
  })

  it('(g1) Production with the variable unset or empty: unset', () => {
    expect.soft(resolveSiteUrl(env('production', undefined)), '(g1) unset').toStrictEqual(unset)
    expect.soft(resolveSiteUrl(env('production', '')), '(g1) empty').toStrictEqual(unset)
    expect.soft(resolveSiteUrl({ VERCEL_ENV: 'production' }), '(g1) no key').toStrictEqual(unset)
  })

  it('(g1) Production with an https origin: set, with that origin', () => {
    expect
      .soft(resolveSiteUrl(env('production', COMMITTED)), '(g1) the committed origin')
      .toStrictEqual(set(COMMITTED))
    expect
      .soft(resolveSiteUrl(env('production', 'https://example.vercel.app')), '(g1) another origin')
      .toStrictEqual(set('https://example.vercel.app'))
  })

  it.each(REFUSED_VALUES)('(g1) Production with %s: refused', (_why, value) => {
    expect(resolveSiteUrl(env('production', value)), `(g1) ${JSON.stringify(value)}`).toStrictEqual(
      refused,
    )
  })
})

describe('resolveSiteUrl: the publisher’s normalised forms (T12-30 g2, S12-CRIT-7)', () => {
  it.each(NORMALISED_VALUES)('(g2) %s is set, origin https://x.vercel.app', (_why, value) => {
    expect(resolveSiteUrl(env('production', value)), `(g2) ${JSON.stringify(value)}`).toStrictEqual(
      set('https://x.vercel.app'),
    )
  })
})

describe('resolveSiteUrl agrees with the publisher’s readSiteUrl (T12-30 g3)', () => {
  const ROWS: readonly string[] = [
    '',
    COMMITTED,
    'https://example.vercel.app',
    ...REFUSED_VALUES.map(([, value]) => value),
    ...NORMALISED_VALUES.map(([, value]) => value),
  ]

  it.each(ROWS.map((value) => [JSON.stringify(value), value] as const))(
    '(g3) %s: the same verdict as tools/publisher/env.ts',
    (_name, value) => {
      const ours = resolveSiteUrl(env('production', value))
      const theirs = readSiteUrl({ NEXT_PUBLIC_SITE_URL: value })
      const verdict = theirs.ok
        ? set(theirs.value.origin)
        : theirs.reason === 'NEXT_PUBLIC_SITE_URL is not set'
          ? unset
          : refused
      expect(ours, `(g3) ${JSON.stringify(value)}`).toStrictEqual(verdict)
    },
  )

  it('(g3) the undefined row agrees too, and the table is not vacuous', () => {
    expect(resolveSiteUrl(env('production', undefined))).toStrictEqual(unset)
    expect(readSiteUrl({}).ok).toBe(false)
    const statuses = new Set(ROWS.map((v) => resolveSiteUrl(env('production', v)).status))
    expect([...statuses].sort(), 'precondition: every verdict occurs').toEqual([
      'refused',
      'set',
      'unset',
    ])
  })
})

describe('siteUrlLine and assertSiteUrlAllowed (T12-30 g4, g5)', () => {
  it('(g4) prints exactly the design §4.8 lines', () => {
    expect
      .soft(siteUrlLine(ignored), '(g4) ignored')
      .toBe('site url: ignored (not a Vercel Production build)')
    expect.soft(siteUrlLine(unset), '(g4) unset').toBe('site url: unset')
    expect
      .soft(siteUrlLine(set(COMMITTED)), '(g4) set, committed')
      .toBe('site url: set (the committed production origin)')
    expect
      .soft(siteUrlLine(set('https://example.vercel.app')), '(g4) set, another origin')
      .toBe('site url: set (not the committed production origin)')
    expect.soft(siteUrlLine(refused), '(g4) refused').toBe('site url: refused')
  })

  it('(g5) stops only a refused decision, with exactly the design message', () => {
    expect(SITE_URL_REFUSED).toBe(
      'site url refused: NEXT_PUBLIC_SITE_URL must be an https origin with no path, query or port',
    )
    expect(() => assertSiteUrlAllowed(refused), '(g5) refused').toThrow(new Error(SITE_URL_REFUSED))
    for (const decision of [ignored, unset, set(COMMITTED), set('https://example.vercel.app')]) {
      expect(() => assertSiteUrlAllowed(decision), `(g5) ${decision.status}`).not.toThrow()
    }
  })
})

describe('value-free (T12-30 g6)', () => {
  const SENTINEL = 'sentinel-q7z.example'
  const ROWS: readonly (readonly [value: string, status: SiteUrlDecision['status']])[] = [
    [`https://${SENTINEL}`, 'set'],
    [`https://${SENTINEL}/`, 'set'],
    [`http://${SENTINEL}`, 'refused'],
    [`https://${SENTINEL}/path`, 'refused'],
    [`https://${SENTINEL}?q=1`, 'refused'],
    [`https://${SENTINEL}#frag`, 'refused'],
    [`https://${SENTINEL}:8443`, 'refused'],
    [`https://u:p@${SENTINEL}`, 'refused'],
    [SENTINEL, 'refused'],
  ]

  it.each(ROWS)(
    '(g6) %s: the value is in no line, message or field but origin',
    (value, status) => {
      const decision = resolveSiteUrl(env('production', value))
      expect(decision.status, 'precondition: the row’s verdict').toBe(status)
      const { origin, ...rest } = decision
      expect.soft(JSON.stringify(rest), '(g6) the decision fields').not.toContain(SENTINEL)
      if (status === 'set') expect.soft(origin, '(g6) origin').toBe(`https://${SENTINEL}`)
      else expect.soft(origin, '(g6) origin').toBeNull()
      expect.soft(siteUrlLine(decision), '(g6) the line').not.toContain(SENTINEL)
      let message = ''
      try {
        assertSiteUrlAllowed(decision)
      } catch (error) {
        message = error instanceof Error ? `${error.message} ${String(error.stack)}` : String(error)
      }
      expect.soft(message, '(g6) the refusal').not.toContain(SENTINEL)
    },
  )
})

describe('the committed origin and the build reader (T12-30 g7)', () => {
  it('(g7) COMMITTED_PRODUCTION_ORIGIN is the production domain, and live-check names it once', () => {
    expect.soft(COMMITTED_PRODUCTION_ORIGIN, '(g7) the constant').toBe(COMMITTED)
    const liveCheck = readFileSync(join(storyboard, 'scripts/live-check.ts'), 'utf8')
    expect
      .soft(liveCheck, '(g7) live-check takes PRODUCTION_ORIGIN from the constant')
      .toContain('export const PRODUCTION_ORIGIN = COMMITTED_PRODUCTION_ORIGIN')
    expect
      .soft(liveCheck, '(g7) live-check types no origin literal of its own')
      .not.toContain('storyboard-one-eta.vercel.app')
  })

  it('buildSiteOrigin reads this process: null outside a Vercel Production build or when unset', () => {
    vi.stubEnv('VERCEL_ENV', undefined)
    expect(buildSiteOrigin()).toBeNull()
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined)
    expect(buildSiteOrigin()).toBeNull()
  })
})
