import 'server-only'
// Home's strings and card props, built on the server (P1 Step 12; design p1-step12-design.md §0.2,
// §4.1). t() runs here; the islands get finished strings as props, so no catalogue reaches the
// client (client-boundary.test.ts). Package text (book, title, description, duration) is taken
// from the page locale's text as stored (SPEC:441).
// - shelfStrings(code): the h1, the placeholder and the three section headings (All stories is the
//   player's approved label, the same words as the player's Exit to Home).
// - homeStrings(code, story): "Age 6+" and the badge variants: Reading, New, and one finished
//   string per found value 1..y ("Finished · x of y endings"), so each has its own reserved width.
// - cardOf(code, story, endingIds): one card's props; a story without the page locale throws with
//   ids only (the page lists only stories that have it).
import type { StorySummary } from '../../content'
import type { LocaleCode } from '../../core/locales'
import { translator } from '../i18n/messages'
import type { BadgeStrings } from './badge-cell'
import type { ShelfStrings } from './home-shelf'
import type { CardStory } from './story-card'

export function shelfStrings(code: LocaleCode): ShelfStrings {
  const t = translator(code)
  return {
    title: t('home.title'),
    placeholder: t('home.placeholder'),
    continueReading: t('home.continueReading'),
    continueEmpty: t('home.continueEmpty'),
    featured: t('home.featured'),
    allStories: t('player.allStories'),
  }
}

export interface CardStrings {
  readonly age: string
  readonly badges: BadgeStrings
}

export function homeStrings(
  code: LocaleCode,
  story: { readonly age: string; readonly endingIds: readonly string[] },
): CardStrings {
  const t = translator(code)
  const total = story.endingIds.length
  return {
    age: t('story.age', { age: story.age }),
    badges: {
      reading: t('home.reading'),
      finished: story.endingIds.map((_, index) => t('home.finished', { found: index + 1, total })),
      new: t('home.new'),
    },
  }
}

/** What a card needs of a story (a StorySummary, or a package in tests). */
export type CardSource = Pick<
  StorySummary,
  'storyId' | 'addedOn' | 'age' | 'emoji' | 'color' | 'text'
>

export function cardOf(
  code: LocaleCode,
  story: CardSource,
  endingIds: readonly string[],
): CardStory {
  const text = story.text[code]
  if (text === undefined) throw new Error(`home: story ${story.storyId} has no ${code} text`)
  const { age, badges } = homeStrings(code, { age: story.age, endingIds })
  return {
    storyId: story.storyId,
    addedOn: story.addedOn,
    color: story.color,
    emoji: story.emoji,
    book: text.book,
    title: text.title,
    description: text.description,
    duration: text.duration,
    age,
    landingHref: `/${code}/stories/${story.storyId}`,
    readHref: `/${code}/stories/${story.storyId}/read`,
    endingIds,
    badges,
  }
}
