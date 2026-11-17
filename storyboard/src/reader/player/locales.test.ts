// The story-language switch's target (Step 10d; design p1-step10-design.md D11-P4, §9.2 10d row;
// spec §6.2 SET_LOCALE). The 3 fixtures (en and hi) offer the other language in both content
// locales, and the engine accepts that switch; a synthetic English-only package and a synthetic
// [ar, en] package (ar not enabled) offer nothing: only the package's locales that the page builds
// (PlayerData.locales) are ever offered, never the enabled locales alone.
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { start, step } from '../../core/engine'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { localeSwitchOf } from './locales'
import { graphOf, playerDataOf } from './player-data'

const dataOf = (raw: unknown) =>
  playerDataOf(StoryPackageV1.parse(raw), { locales: ENABLED_LOCALE_CODES })

const fixtures = [twoPaths, riverStones, lanternWalk].map(dataOf)

const englishOnly = dataOf({
  ...twoPaths,
  storyId: 'english-only',
  locales: ['en'],
  text: { en: twoPaths.text.en },
})

// An [ar, en] package: ar is in the package but not enabled, so the page builds en only.
const arabicAndEnglish = dataOf({
  ...twoPaths,
  storyId: 'arabic-and-english',
  locales: ['ar', 'en'],
  defaultLocale: 'en',
  text: { ar: twoPaths.text.en, en: twoPaths.text.en },
})

describe('localeSwitchOf', () => {
  it('covers the 3 fixtures in en and hi, and the enabled locales are en and hi (the scan is not empty)', () => {
    expect(ENABLED_LOCALE_CODES).toEqual(['en', 'hi'])
    expect(fixtures.map((data) => [data.storyId, data.locales])).toEqual([
      ['two-paths', ['en', 'hi']],
      ['river-stones', ['en', 'hi']],
      ['lantern-walk', ['en', 'hi']],
    ])
  })

  it.each(fixtures.map((data) => [data.storyId, data] as const))(
    '%s: en offers hi and hi offers en; the engine accepts that switch with persist only',
    (_, data) => {
      const other: Record<string, LocaleCode> = { en: 'hi', hi: 'en' }
      const graph = graphOf(data)
      for (const content of data.locales) {
        const target = localeSwitchOf(data, content)
        expect(target, content).toBe(other[content])
        if (target === null) continue
        // The SET_LOCALE guard (spec §6.2): the target is a locale of this page's graph, so the
        // switch is accepted, keeps the node and seq, and asks only for a save.
        const state = start(graph, { path: [data.startNodeId], locale: content })
        const result = step(graph, state, { type: 'SET_LOCALE', locale: target })
        expect(result.accepted, content).toBe(true)
        expect(result.state.locale, content).toBe(target)
        expect(result.state.seq, content).toBe(state.seq)
        expect(result.state.path, content).toEqual(state.path)
        expect(result.effects, content).toEqual([{ type: 'persist' }])
      }
    },
  )

  it('an English-only story offers no switch (the enabled hi is not in the package)', () => {
    expect(englishOnly.locales).toEqual(['en'])
    expect(localeSwitchOf(englishOnly, 'en')).toBeNull()
  })

  it('an [ar, en] story on a site that enables en and hi offers no switch (ar is not enabled, hi not in the package)', () => {
    expect(arabicAndEnglish.locales).toEqual(['en'])
    expect(localeSwitchOf(arabicAndEnglish, 'en')).toBeNull()
  })

  it('never offers the content locale, and only offers a locale of the page', () => {
    const cases: [readonly LocaleCode[], LocaleCode, LocaleCode | null][] = [
      [['en', 'hi'], 'en', 'hi'],
      [['en', 'hi'], 'hi', 'en'],
      [['en'], 'en', null],
      [['hi'], 'hi', null],
      [[], 'en', null],
    ]
    for (const [locales, content, expected] of cases) {
      const target = localeSwitchOf({ locales }, content)
      expect(target, `${locales.join(',')} ${content}`).toBe(expected)
      if (target !== null) {
        expect(target).not.toBe(content)
        expect(locales).toContain(target)
      }
    }
  })
})
