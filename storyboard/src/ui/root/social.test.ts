// Open Graph for Home and the story landing (P1 Step 12, 12b; design p1-step12-design.md §3.21 N21,
// §4.9, B4; test plan T12-32). Both functions, both branches, compared with toStrictEqual: with no
// site origin the result has no url and no images key at all (an empty images array would still
// be a value, reader research A6); with one, both are absolute. T12-39
// (scripts/testing/next-social-head.test.ts) renders the same objects through Next's own resolver
// and renderer.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OG_IMAGE, homeOpenGraph, landingOpenGraph } from './social'

const ORIGIN = 'https://example.test'

const IMAGE = {
  url: 'https://example.test/og/storyboard-1200x630.jpg',
  width: 1200,
  height: 630,
  type: 'image/jpeg',
  alt: 'Storyboard',
}

const home = (origin: string | null) =>
  homeOpenGraph({ origin, locale: 'en', description: 'Interactive stories for children.' })
const landing = (origin: string | null) =>
  landingOpenGraph({
    origin,
    locale: 'hi',
    storyId: 'two-paths',
    title: 'दो रास्ते',
    description: 'A story with two paths.',
  })

describe('homeOpenGraph and landingOpenGraph (T12-32)', () => {
  it('(g1) with no site origin: exactly title, description, type and site name; no url or images key', () => {
    expect.soft(home(null), '(g1) Home').toStrictEqual({
      title: 'Storyboard',
      description: 'Interactive stories for children.',
      type: 'website',
      siteName: 'Storyboard',
    })
    expect.soft(landing(null), '(g1) landing').toStrictEqual({
      title: 'दो रास्ते',
      description: 'A story with two paths.',
      type: 'website',
      siteName: 'Storyboard',
    })
    for (const [name, og] of [
      ['Home', home(null)],
      ['landing', landing(null)],
    ] as const) {
      expect.soft(Object.hasOwn(og, 'url'), `(g1) ${name} has no url key`).toBe(false)
      expect.soft(Object.hasOwn(og, 'images'), `(g1) ${name} has no images key`).toBe(false)
    }
  })

  it('(g2) with a site origin: plus the absolute page url and the one image', () => {
    expect.soft(home(ORIGIN), '(g2) Home').toStrictEqual({
      title: 'Storyboard',
      description: 'Interactive stories for children.',
      type: 'website',
      siteName: 'Storyboard',
      url: 'https://example.test/en',
      images: [IMAGE],
    })
    expect.soft(landing(ORIGIN), '(g2) landing').toStrictEqual({
      title: 'दो रास्ते',
      description: 'A story with two paths.',
      type: 'website',
      siteName: 'Storyboard',
      url: 'https://example.test/hi/stories/two-paths',
      images: [IMAGE],
    })
  })

  it('(g3) the landing og:title is the bare story title, never the page title template', () => {
    for (const origin of [null, ORIGIN]) {
      const og = landingOpenGraph({
        origin,
        locale: 'en',
        storyId: 'two-paths',
        title: 'Two Paths',
        description: 'd',
      })
      expect.soft(og.title, `(g3) ${String(origin)}`).toBe('Two Paths')
    }
  })

  it('(g4) OG_IMAGE: the committed fallback JPEG, 1200 by 630', () => {
    expect(OG_IMAGE).toStrictEqual({
      path: '/og/storyboard-1200x630.jpg',
      width: 1200,
      height: 630,
      type: 'image/jpeg',
    })
  })

  it('(g5) social.ts sets no robots, alternates or metadataBase (source, comments aside)', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'social.ts'), 'utf8')
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
    expect(code, 'precondition: the code is read').toContain('export function landingOpenGraph')
    for (const name of ['robots', 'alternates', 'metadataBase', 'canonical']) {
      expect.soft(code, `(g5) ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`))
    }
  })
})
