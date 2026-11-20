// The landing's server strings (P1 Step 12; design p1-step12-design.md §0.2, §3.8 N9; test plan
// T12-17). storyStrings(code, pkg): the story's fields from the page locale's text as stored, the
// age and theme formatted with story.age and story.theme from that text, the action labels, and
// the share strings from the player keys ShareControl already uses. How this story was made's href
// is built here on the server (review fix R1-FS-3: the island no longer imports narration.ts).
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { ENABLED_LOCALE_CODES } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { translator } from '../i18n/messages'
import { storyStrings } from './strings'

const fixtures = [twoPaths, riverStones, lanternWalk].map((p) => StoryPackageV1.parse(p))

describe('storyStrings (T12-17)', () => {
  it.each(ENABLED_LOCALE_CODES)('%s: the fields, age and theme from the page locale', (code) => {
    const t = translator(code)
    for (const pkg of fixtures) {
      const text = pkg.text[code]
      if (text === undefined) throw new Error('precondition: the fixture has the locale')
      const strings = storyStrings(code, pkg)
      expect
        .soft(
          [strings.book, strings.title, strings.description, strings.duration],
          `${code} ${pkg.storyId}: fields as stored`,
        )
        .toEqual([text.book, text.title, text.description, text.duration])
      expect.soft(strings.age, `${code} ${pkg.storyId}: age`).toBe(t('story.age', { age: pkg.age }))
      expect
        .soft(strings.theme, `${code} ${pkg.storyId}: theme`)
        .toBe(t('story.theme', { theme: text.theme }))
    }
  })

  it('takes the theme from the Hindi text on a Hindi page (never the English one)', () => {
    for (const pkg of fixtures) {
      expect(pkg.text.hi?.theme, 'precondition: the themes differ').not.toBe(pkg.text.en?.theme)
      expect(storyStrings('hi', pkg).theme).toBe(
        translator('hi')('story.theme', { theme: pkg.text.hi?.theme ?? '' }),
      )
    }
  })

  it.each(ENABLED_LOCALE_CODES)('%s: the action and share labels', (code) => {
    const t = translator(code)
    expect(storyStrings(code, fixtures[0]!).actions).toEqual({
      start: t('story.start'),
      continue: t('story.continue'),
      startAgain: t('player.restart'),
      howMade: t('story.howMade'),
      share: t('player.share'),
      linkCopied: t('player.linkCopied'),
      copyLink: t('player.copyLink'),
    })
  })

  it.each(ENABLED_LOCALE_CODES)(
    '%s: How this story was made links to the Grown-ups section, built on the server',
    (code) => {
      for (const pkg of fixtures) {
        expect
          .soft(storyStrings(code, pkg).howMadeHref, `${code} ${pkg.storyId}: howMadeHref`)
          .toBe(`/${code}/grown-ups#how-stories-are-made`)
      }
    },
  )

  it('throws, with ids only, for a story without the page locale', () => {
    const pkg = fixtures[0]!
    expect(() => storyStrings('hi', { ...pkg, text: { en: pkg.text.en } })).toThrow(
      `landing: story ${pkg.storyId} has no hi text`,
    )
  })
})
