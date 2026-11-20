import 'server-only'
// The story landing's strings, built on the server (P1 Step 12; design p1-step12-design.md §0.2,
// §3.8 N9, §4.7). t() runs here; the island gets finished strings as props. The story's fields are
// the page locale's package text as stored (SPEC:441); "Age 6+" (story.age, the package value as
// stored) and "Theme: …" (story.theme, the page locale's theme) are formatted here. The action
// labels: Start and Continue (story.*), Start again (player.restart, the player's approved label),
// How this story was made; the share strings are the player's, as ShareControl uses them.
// - How this story was made links to /{locale}/grown-ups#how-stories-are-made: the anchor id is
//   narration.ts's HOW_STORIES_ARE_MADE_ID, imported here on the server (design §3.10), so the
//   client island never imports the player's narration module (it would ship the audio controller
//   to every landing, design §6 "four small islands").
// A story without the page locale throws with ids only (the page lists only stories that have it).
import type { LocaleCode } from '../../core/locales'
import type { StoryPackageV1 } from '../../core/package/v1'
import { HOW_STORIES_ARE_MADE_ID } from '../../reader/player/narration'
import { translator } from '../i18n/messages'
import type { StoryActionsStrings } from './story-actions'

export interface LandingStrings {
  readonly book: string
  readonly title: string
  readonly description: string
  readonly duration: string
  /** "Age 6+" */
  readonly age: string
  /** "Theme: …" */
  readonly theme: string
  /** /{locale}/grown-ups#how-stories-are-made */
  readonly howMadeHref: string
  readonly actions: StoryActionsStrings
}

export type LandingSource = Pick<StoryPackageV1, 'storyId' | 'age' | 'text'>

export function storyStrings(code: LocaleCode, pkg: LandingSource): LandingStrings {
  const text = pkg.text[code]
  if (text === undefined) throw new Error(`landing: story ${pkg.storyId} has no ${code} text`)
  const t = translator(code)
  return {
    book: text.book,
    title: text.title,
    description: text.description,
    duration: text.duration,
    age: t('story.age', { age: pkg.age }),
    theme: t('story.theme', { theme: text.theme }),
    howMadeHref: `/${code}/grown-ups#${HOW_STORIES_ARE_MADE_ID}`,
    actions: {
      start: t('story.start'),
      continue: t('story.continue'),
      startAgain: t('player.restart'),
      howMade: t('story.howMade'),
      share: t('player.share'),
      linkCopied: t('player.linkCopied'),
      copyLink: t('player.copyLink'),
    },
  }
}
