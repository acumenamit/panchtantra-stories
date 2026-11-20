// Home's server strings (P1 Step 12; design p1-step12-design.md §0.2, §4.1; test plan T12-14). The
// card strings come from the real translator: the finished variant for every found value 1..y
// ("Finished · x of y endings"), Reading, New and "Age 6+"; the card's text comes from the page
// locale's package text as stored.
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { toGraph } from '../../core/engine'
import { ENABLED_LOCALE_CODES } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { endingIdsOf } from '../../core/progress'
import { translator } from '../i18n/messages'
import { cardOf, homeStrings, shelfStrings } from './strings'

const fixtures = [twoPaths, riverStones, lanternWalk].map((p) => StoryPackageV1.parse(p))

describe('homeStrings (T12-14)', () => {
  it.each(ENABLED_LOCALE_CODES)('%s: every finished variant, Reading, New and the age', (code) => {
    const t = translator(code)
    for (const pkg of fixtures) {
      const endingIds = endingIdsOf(toGraph(pkg))
      expect(endingIds.length, 'precondition: endings').toBeGreaterThanOrEqual(2)
      const strings = homeStrings(code, { age: pkg.age, endingIds })
      expect
        .soft(strings.badges.finished, `${code} ${pkg.storyId}: finished 1..y`)
        .toEqual(
          endingIds.map((_, i) => t('home.finished', { found: i + 1, total: endingIds.length })),
        )
      expect.soft(strings.badges.reading, `${code}: Reading`).toBe(t('home.reading'))
      expect.soft(strings.badges.new, `${code}: New`).toBe(t('home.new'))
      expect.soft(strings.age, `${code}: the age`).toBe(t('story.age', { age: pkg.age }))
    }
  })

  it('formats the English finished line as the spec words it', () => {
    const strings = homeStrings('en', { age: '6+', endingIds: ['a', 'b'] })
    expect(strings.badges.finished).toEqual([
      'Finished · 1 of 2 endings',
      'Finished · 2 of 2 endings',
    ])
  })
})

describe('cardOf and shelfStrings', () => {
  it.each(ENABLED_LOCALE_CODES)('%s: the card text is the page locale’s, as stored', (code) => {
    for (const pkg of fixtures) {
      const text = pkg.text[code]
      if (text === undefined) throw new Error('precondition: the fixture has the locale')
      const card = cardOf(code, pkg, endingIdsOf(toGraph(pkg)))
      expect.soft(card.book, `${code} ${pkg.storyId}: book`).toBe(text.book)
      expect.soft(card.title, `${code} ${pkg.storyId}: title`).toBe(text.title)
      expect.soft(card.description, `${code} ${pkg.storyId}: description`).toBe(text.description)
      expect.soft(card.duration, `${code} ${pkg.storyId}: duration`).toBe(text.duration)
      expect
        .soft(card.landingHref, `${code} ${pkg.storyId}: landing`)
        .toBe(`/${code}/stories/${pkg.storyId}`)
      expect
        .soft(card.readHref, `${code} ${pkg.storyId}: read`)
        .toBe(`/${code}/stories/${pkg.storyId}/read`)
      expect
        .soft([card.addedOn, card.color, card.emoji], `${code} ${pkg.storyId}: package fields`)
        .toEqual([pkg.addedOn, pkg.color, pkg.emoji])
    }
  })

  it('throws, with ids only, for a story without the page locale', () => {
    const pkg = fixtures[0]
    if (pkg === undefined) throw new Error('no fixture')
    const enOnly = { ...pkg, text: { en: pkg.text.en } }
    expect(() => cardOf('hi', enOnly, [])).toThrow(`home: story ${pkg.storyId} has no hi text`)
  })

  it.each(ENABLED_LOCALE_CODES)('%s: the shelf labels', (code) => {
    const t = translator(code)
    expect(shelfStrings(code)).toEqual({
      title: t('home.title'),
      placeholder: t('home.placeholder'),
      continueReading: t('home.continueReading'),
      continueEmpty: t('home.continueEmpty'),
      featured: t('home.featured'),
      allStories: t('player.allStories'),
    })
  })
})
