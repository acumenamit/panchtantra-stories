// PlayerData (Step 10a; design D11-P2, §9.2): the three fixtures and two synthetic packages (one
// English-only, one [ar, en] with default ar, a large Arabic text and a large assets array). The
// view carries only the player's fields, in the package locales that are also enabled; a missing
// text, choice label or lesson stops the build with ids only; graphOf(data) is toGraph(pkg) with the
// page's locales; and each view stays within the 96 KB raw budget (SC16).
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { toGraph } from '../../core/engine'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { endingIdsOf } from '../../core/progress'
import { graphOf, playerDataOf } from './player-data'

/** SC16: a page's PlayerData, as JSON, stays at or under 96 KB raw. */
const BUDGET_BYTES = 96 * 1024

const fixtures = [twoPaths, riverStones, lanternWalk].map((p) => StoryPackageV1.parse(p))

const englishOnly = StoryPackageV1.parse({
  ...twoPaths,
  storyId: 'english-only',
  locales: ['en'],
  text: { en: twoPaths.text.en },
})

// An [ar, en] package whose default ('ar') is not enabled. Its Arabic text and its assets are each
// far larger than the budget, so a view that leaked either would fail the budget test too.
const arabicLine = 'كانت الحكاية طويلة جدا في الغابة '
const arabicText = (n: number) => arabicLine.repeat(n).trim()
const arabicNodes = Object.fromEntries(
  Object.entries(twoPaths.text.en.nodes).map(([id, t]) => [
    id,
    {
      text: arabicText(1200),
      ...('question' in t ? { question: `${arabicText(2)}؟` } : {}),
      ...('choices' in t
        ? { choices: Object.fromEntries(Object.keys(t.choices).map((c) => [c, arabicText(1)])) }
        : {}),
      ...('lesson' in t ? { lesson: arabicText(3) } : {}),
    },
  ]),
)
const fakeAssets = Array.from({ length: 300 }, (_, i) => ({
  kind: 'image',
  id: i.toString(16).padStart(64, '0'),
  width: 1408,
  height: 768,
  variants: [
    { path: `media/arabic-first/${i}-w768.webp`, mime: 'image/webp', bytes: 1000, width: 768 },
    { path: `media/arabic-first/${i}-w1408.webp`, mime: 'image/webp', bytes: 2000, width: 1408 },
  ],
  provenance: { origin: 'human' },
}))
const arabicFirst = StoryPackageV1.parse({
  ...twoPaths,
  storyId: 'arabic-first',
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  text: {
    ar: {
      ...twoPaths.text.en,
      title: arabicText(1),
      description: arabicText(20),
      nodes: arabicNodes,
    },
    en: twoPaths.text.en,
  },
  assets: fakeAssets,
})

const PLAYER_DATA_KEYS = [
  'storyId',
  'version',
  'startNodeId',
  'locales',
  'defaultLocale',
  'progressSteps',
  'endingIds',
  'nodes',
  'text',
]
const NODE_KEYS = ['id', 'type', 'isAlternate', 'scene', 'lessonIcon', 'choices']
const NOT_SENT = [
  'provenance',
  'assets',
  'variants',
  'audio',
  'image',
  'description',
  'theme',
  'book',
  'duration',
  'alt',
  'packageSha256',
  'aiUse',
  'source',
  'origin',
  'emoji',
  'color',
  'age',
  'addedOn',
  'access',
  'collectionId',
  'schemaVersion',
]

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysDeep(v, out)
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      keysDeep(v, out)
    }
  }
  return out
}

describe('playerDataOf: the fixtures', () => {
  it("carries each fixture's graph and its text in the enabled locales, as stored", () => {
    for (const pkg of fixtures) {
      const data = playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })
      expect(data.storyId).toBe(pkg.storyId)
      expect(data.version).toBe(pkg.version)
      expect(data.startNodeId).toBe(pkg.startNodeId)
      expect(data.locales).toEqual(['en', 'hi'])
      expect(data.defaultLocale).toBe(pkg.defaultLocale)
      expect(data.progressSteps).toEqual(pkg.progressSteps)
      expect(data.endingIds).toEqual(endingIdsOf(toGraph(pkg)))
      expect(data.nodes.map((n) => n.id)).toEqual(pkg.nodes.map((n) => n.id))
      for (const [i, node] of pkg.nodes.entries()) {
        expect(data.nodes[i]).toEqual({
          id: node.id,
          type: node.type,
          isAlternate: node.isAlternate,
          scene: node.scene,
          lessonIcon: node.type === 'ending' ? node.lessonIcon : null,
          choices: node.type === 'ending' ? [] : node.choices,
        })
      }
      expect(Object.keys(data.text)).toEqual(['en', 'hi'])
      for (const locale of ['en', 'hi'] as const) {
        const source = pkg.text[locale]!
        const view = data.text[locale]!
        expect(view.title).toBe(source.title)
        expect(Object.keys(view.nodes)).toEqual(pkg.nodes.map((n) => n.id))
        for (const node of pkg.nodes) {
          const stored = source.nodes[node.id]!
          const t = view.nodes[node.id]!
          expect(t.paragraphs.join('\n\n')).toBe(stored.text)
          if (node.type === 'ending') {
            expect(t).toEqual({
              paragraphs: t.paragraphs,
              question: null,
              choices: {},
              lesson: stored.lesson,
            })
          } else {
            expect(t.question).toBe(stored.question ?? null)
            expect(t.lesson).toBeNull()
            expect(t.choices).toEqual(
              Object.fromEntries(node.choices.map((c) => [c.id, stored.choices?.[c.id]])),
            )
          }
        }
      }
    }
  })

  it('sends only what the player needs: no provenance, assets, description or other package fields', () => {
    for (const pkg of [...fixtures, englishOnly, arabicFirst]) {
      const data = playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })
      expect(Object.keys(data)).toEqual(PLAYER_DATA_KEYS)
      for (const node of data.nodes) expect(Object.keys(node)).toEqual(NODE_KEYS)
      const keys = keysDeep(data)
      for (const name of NOT_SENT) expect(keys.has(name), name).toBe(false)
      const json = JSON.stringify(data)
      for (const locale of pkg.locales) {
        expect(json).not.toContain(JSON.stringify(pkg.text[locale]!.description).slice(1, -1))
      }
    }
  })
})

describe('playerDataOf: locales are the package locales that are enabled, in registry order', () => {
  it('an English-only package', () => {
    const data = playerDataOf(englishOnly, { locales: ENABLED_LOCALE_CODES })
    expect(data.locales).toEqual(['en'])
    expect(data.defaultLocale).toBe('en')
    expect(Object.keys(data.text)).toEqual(['en'])
  })

  it('an [ar, en] package with default ar: locales [en], default en, no Arabic text', () => {
    const data = playerDataOf(arabicFirst, { locales: ENABLED_LOCALE_CODES })
    expect(data.locales).toEqual(['en'])
    expect(data.defaultLocale).toBe('en')
    expect(Object.keys(data.text)).toEqual(['en'])
    expect(JSON.stringify(data)).not.toContain(arabicLine.trim())
  })

  it('follows the registry order, not the order given, and remaps a default that is left out', () => {
    const pkg = fixtures[0]!
    expect(playerDataOf(pkg, { locales: ['hi', 'en'] }).locales).toEqual(['en', 'hi'])
    const hindiOnly = playerDataOf(pkg, { locales: ['hi'] })
    expect(hindiOnly.locales).toEqual(['hi'])
    expect(hindiOnly.defaultLocale).toBe('hi')
    expect(Object.keys(hindiOnly.text)).toEqual(['hi'])
  })

  it('throws when no locale is left', () => {
    expect(() => playerDataOf(fixtures[0]!, { locales: [] })).toThrow(
      new Error('player: two-paths - - locales missing'),
    )
    expect(() => playerDataOf(arabicFirst, { locales: ['ar' as LocaleCode, 'hi'] })).not.toThrow()
    expect(() => playerDataOf(englishOnly, { locales: ['hi'] })).toThrow(
      new Error('player: english-only - - locales missing'),
    )
  })
})

describe('playerDataOf: the second lock (ids only, never text)', () => {
  const broken = () => structuredClone(StoryPackageV1.parse(twoPaths))

  it('a missing node text in an included locale', () => {
    const pkg = broken()
    delete pkg.text.hi!.nodes['wise_path']
    expect(() => playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })).toThrow(
      new Error('player: two-paths hi wise_path text missing'),
    )
    // Not checked for a locale the page does not build.
    expect(() => playerDataOf(pkg, { locales: ['en'] })).not.toThrow()
  })

  it('a missing choice label', () => {
    const pkg = broken()
    delete pkg.text.hi!.nodes['start']!.choices!['c2']
    expect(() => playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })).toThrow(
      new Error('player: two-paths hi start choices.c2 missing'),
    )
    const none = broken()
    delete none.text.en!.nodes['wise_path']!.choices
    expect(() => playerDataOf(none, { locales: ENABLED_LOCALE_CODES })).toThrow(
      new Error('player: two-paths en wise_path choices.c1 missing'),
    )
  })

  it("reads only the package's own keys: a node named like an Object.prototype member (review PIF-7)", () => {
    // 'constructor' is a valid NodeId (package/v1.ts:15); a plain index would find a function and
    // let a missing text through.
    const named = StoryPackageV1.parse(
      JSON.parse(JSON.stringify(twoPaths).replaceAll('"wise_path"', '"constructor"')),
    )
    const data = playerDataOf(named, { locales: ENABLED_LOCALE_CODES })
    expect(data.nodes.map((n) => n.id)).toContain('constructor')
    expect(data.text.hi!.nodes['constructor']!.choices).toEqual(
      named.text.hi!.nodes['constructor']!.choices,
    )
    const pkg = structuredClone(named)
    delete pkg.text.hi!.nodes['constructor']
    expect(() => playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })).toThrow(
      new Error('player: two-paths hi constructor text missing'),
    )
  })

  it('a missing ending lesson', () => {
    const pkg = broken()
    delete pkg.text.hi!.nodes['ending_quick']!.lesson
    expect(() => playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })).toThrow(
      new Error('player: two-paths hi ending_quick lesson missing'),
    )
  })
})

describe('graphOf: toGraph(pkg) with the page locales', () => {
  const cases = [
    ...fixtures.map((pkg) => ({ pkg, locales: ['en', 'hi'], defaultLocale: pkg.defaultLocale })),
    { pkg: englishOnly, locales: ['en'], defaultLocale: 'en' },
    { pkg: arabicFirst, locales: ['en'], defaultLocale: 'en' },
  ]

  it('deep-equals toGraph with the locales restricted and the default remapped', () => {
    for (const { pkg, locales, defaultLocale } of cases) {
      const g = graphOf(playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES }))
      expect(g).toEqual({ ...toGraph(pkg), locales, defaultLocale })
      // Node and choice order as in the package (the engine and the choice list depend on it).
      expect([...g.nodes.keys()]).toEqual(pkg.nodes.map((n) => n.id))
      for (const node of pkg.nodes) {
        const choices = node.type === 'ending' ? [] : node.choices
        expect(g.nodes.get(node.id)?.choices).toEqual(choices)
      }
    }
  })
})

describe('budget (SC16): JSON of PlayerData stays at or under 96 KB raw', () => {
  it('for each fixture and both synthetics', () => {
    // The synthetic's Arabic text and assets alone are over the budget, so a leak would fail here.
    expect(Buffer.byteLength(JSON.stringify(arabicFirst.text.ar), 'utf8')).toBeGreaterThan(
      BUDGET_BYTES,
    )
    expect(Buffer.byteLength(JSON.stringify(arabicFirst.assets), 'utf8')).toBeGreaterThan(
      BUDGET_BYTES / 2,
    )
    for (const pkg of [...fixtures, englishOnly, arabicFirst]) {
      const bytes = Buffer.byteLength(
        JSON.stringify(playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })),
        'utf8',
      )
      expect(bytes, pkg.storyId).toBeLessThanOrEqual(BUDGET_BYTES)
    }
  })
})
