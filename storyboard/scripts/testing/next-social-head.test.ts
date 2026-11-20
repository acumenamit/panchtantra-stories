// Open Graph through Next 16.4.5's own resolver and renderer (P1 Step 12, 12b; design
// p1-step12-design.md §3.21 N21, B4, B5, B8, R8; test plan T12-39, lead decision L9). Node only, no
// server. The pipeline (stop S11 taken: Next's resolveOpenGraph, resolveTwitter and
// createMetadataElements run for real, postProcessMetadata's Twitter fill and
// createSelectedMetadata are repeated by hand) and nextSocialHead live beside this file in
// next-social-head.ts, which check-build's [social] tests import too (T12-26 g6, g4). This file
// pins what that pipeline renders for homeOpenGraph and landingOpenGraph, with an origin and
// without, and that nextSocialHead returns the same markup. Moved here from src/ui/root (§21): the
// reader fence keeps src/ui from importing scripts/, and T12-39 now runs once.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  nextSocialHead,
  openGraphOf,
  pathOf,
  renderOpenGraph,
  type SocialPage,
} from './next-social-head'

/** Every meta element of `markup` as [property or name, content], in document order. */
function metaList(markup: string): [string, string][] {
  const decode = (text: string): string =>
    text
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  const metas = [...markup.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"\/>/g)]
  if (metas.length !== (markup.match(/<meta\b/g) ?? []).length) {
    throw new Error('a meta element of another shape was rendered')
  }
  return metas.map((m) => [m[1] ?? '', decode(m[2] ?? '')])
}

const ORIGIN = 'https://example.test'
const HOME: SocialPage = {
  kind: 'home',
  locale: 'en',
  description: 'Interactive stories for children (work in progress).',
}
const LANDING: SocialPage = {
  kind: 'landing',
  locale: 'hi',
  storyId: 'two-paths',
  title: 'दो रास्ते',
  description: 'A story with two paths & a "choice".',
}
const IMAGE = `${ORIGIN}/og/storyboard-1200x630.jpg`

/** With an origin (T12-39 g1): typed from design §3.21 and metadata-elements.js :483-580, :1122-1203. */
const WITH_ORIGIN = (title: string, description: string, url: string): [string, string][] => [
  ['og:title', title],
  ['og:description', description],
  ['og:url', url],
  ['og:site_name', 'Storyboard'],
  ['og:image', IMAGE],
  ['og:image:type', 'image/jpeg'],
  ['og:image:width', '1200'],
  ['og:image:height', '630'],
  ['og:image:alt', 'Storyboard'],
  ['og:type', 'website'],
  ['twitter:card', 'summary_large_image'],
  ['twitter:title', title],
  ['twitter:description', description],
  ['twitter:image', IMAGE],
  ['twitter:image:alt', 'Storyboard'],
  ['twitter:image:type', 'image/jpeg'],
  ['twitter:image:width', '1200'],
  ['twitter:image:height', '630'],
]

/** With no origin (T12-39 g2): exactly E12-S1 g1's tag set. */
const WITHOUT_ORIGIN = (title: string, description: string): [string, string][] => [
  ['og:title', title],
  ['og:description', description],
  ['og:site_name', 'Storyboard'],
  ['og:type', 'website'],
  ['twitter:card', 'summary'],
  ['twitter:title', title],
  ['twitter:description', description],
]

const CASES = [
  ['Home', HOME, 'Storyboard', HOME.description, `${ORIGIN}/en`],
  ['landing', LANDING, 'दो रास्ते', LANDING.description, `${ORIGIN}/hi/stories/two-paths`],
] as const

describe('Open Graph through Next 16.4.5 (T12-39; stop S11 taken, see the header)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it.each(CASES)(
    '(g1) %s with a site origin: the meta list Next renders',
    async (_name, page, title, description, url) => {
      const rendered = await renderOpenGraph(openGraphOf(ORIGIN, page), pathOf(page))
      const list = metaList(rendered.markup)
      expect(list.length, 'precondition: the pipeline rendered meta tags').toBeGreaterThan(0)
      expect.soft(list, '(g1) the meta list').toEqual(WITH_ORIGIN(title, description, url))
      expect.soft(rendered.openGraph, '(g1) the resolved openGraph').toEqual({
        title: { absolute: title, template: null },
        description,
        type: 'website',
        siteName: 'Storyboard',
        url,
        images: [{ url: IMAGE, width: 1200, height: 630, type: 'image/jpeg', alt: 'Storyboard' }],
      })
    },
  )

  it.each(CASES)(
    '(g2) %s with no site origin: exactly the no-origin tag set',
    async (_name, page, title, description) => {
      const rendered = await renderOpenGraph(openGraphOf(null, page), pathOf(page))
      const list = metaList(rendered.markup)
      expect(list.length, 'precondition: the pipeline rendered meta tags').toBeGreaterThan(0)
      expect.soft(list, '(g2) the meta list').toEqual(WITHOUT_ORIGIN(title, description))
      expect.soft(rendered.openGraph, '(g2) the resolved openGraph').toEqual({
        title: { absolute: title, template: null },
        description,
        type: 'website',
        siteName: 'Storyboard',
        url: null,
      })
    },
  )

  it('(g3) no URL in either list is relative, and Next printed nothing (no metadataBase warning)', async () => {
    // Next skips the metadataBase warning when VERCEL is set (resolve-opengraph.js:70-95, PR-1).
    vi.stubEnv('VERCEL', undefined)
    const printed: string[] = []
    const record = (...args: unknown[]): void => {
      printed.push(args.map(String).join(' '))
    }
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(record)
    }
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed.push(String(chunk))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      printed.push(String(chunk))
      return true
    })
    const lists: [string, string][][] = []
    for (const origin of [ORIGIN, null]) {
      for (const [, page] of CASES) {
        lists.push(
          metaList((await renderOpenGraph(openGraphOf(origin, page), pathOf(page))).markup),
        )
      }
    }
    vi.restoreAllMocks()
    expect(lists.flat().length, 'precondition: four lists rendered').toBeGreaterThan(20)
    const urls = lists
      .flat()
      .filter(([key]) => /^(?:og:url|og:image|twitter:image)$/.test(key))
      .map(([, content]) => content)
    expect(urls.length, 'precondition: the origin branch has URLs').toBe(6)
    for (const url of urls) expect.soft(url, '(g3) absolute https').toMatch(/^https:\/\//)
    expect.soft(printed, '(g3) nothing printed').toEqual([])
  })

  it('(g4) nextSocialHead returns this same rendered markup, for both pages and both branches', async () => {
    for (const origin of [ORIGIN, null]) {
      for (const [name, page, title, description, url] of CASES) {
        const head = await nextSocialHead({ origin, page })
        const expected =
          origin === null
            ? WITHOUT_ORIGIN(title, description)
            : WITH_ORIGIN(title, description, url)
        expect.soft(metaList(head), `(g4) ${name} ${String(origin)}`).toEqual(expected)
        expect
          .soft(head, `(g4) ${name} ${String(origin)}: the markup`)
          .toBe((await renderOpenGraph(openGraphOf(origin, page), pathOf(page))).markup)
      }
    }
  })
})
