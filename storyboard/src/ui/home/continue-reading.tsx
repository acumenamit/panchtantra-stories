'use client'
// Continue reading on Home (P1 Step 12; design p1-step12-design.md §3.5 N6, §3.6 N7, §4.4; spec
// SPEC:433, :469; owner Q1 (a)). Always present when the locale has stories: the h2, then one
// reserved cell holding one card per listed story (its colour bar and title, a held link to the
// player, which opens stored-first) and the empty line, all in one grid area. While pending every
// variant is hidden; after the read, the card continueOf selects (the most recent saved run among
// this page's stories) or the empty line is shown. The cell's box is the tallest variant's in
// every state, so nothing on Home moves when progress is read.
// - Hidden cards' links use prefetch={false}: an IntersectionObserver sees hidden boxes, so each
//   would prefetch a player route; the shown card keeps next/link's default (design §3.6).
// - Hidden variants are visibility: hidden and aria-hidden: not focusable, not read, not hit.
// - Every card's onNavigate sets the player's saved-run hint before the soft navigation (round 1b,
//   design §16 F1, H-12c; ../shell/saved-run-mark.ts): a shown card is always a saved run, so the
//   resumed player never paints the start passage first.
// Hooks: data-continue (section), data-continue-cell with data-shown (pending|empty|<storyId>),
// data-continue-story="<id>", data-continue-empty.
import { useContext } from 'react'
import { continueOf } from '../../reader/shelf/shelf'
import { HeldLink } from '../shell/held-link'
import { markSavedRun } from '../shell/saved-run-mark'
import { HomeProgressContext } from './home-progress'
import styles from './home.module.css'

export const CONTINUE_HEADING_ID = 'home-continue-heading'

export interface ContinueStory {
  readonly storyId: string
  /** /{locale}/stories/{storyId}/read */
  readonly readHref: string
  readonly title: string
  readonly color: string
}

export interface ContinueReadingProps {
  readonly heading: string
  readonly empty: string
  /** Every story listed on this page, in shelf order. */
  readonly stories: readonly ContinueStory[]
}

const variantClass = (base: string | undefined, visible: boolean): string =>
  visible ? (base ?? '') : `${base} ${styles.hidden}`

export function ContinueReading({ heading, empty, stories }: ContinueReadingProps) {
  const progress = useContext(HomeProgressContext)
  const shown =
    progress.phase === 'pending'
      ? 'pending'
      : (continueOf(
          progress.entries,
          stories.map((story) => story.storyId),
        ) ?? 'empty')
  return (
    <section data-continue="" aria-labelledby={CONTINUE_HEADING_ID} className={styles.section}>
      <h2 id={CONTINUE_HEADING_ID}>{heading}</h2>
      <div data-continue-cell="" data-shown={shown} className={styles.continueCell}>
        {stories.map((story) => {
          const visible = shown === story.storyId
          return (
            <div
              key={story.storyId}
              data-continue-story={story.storyId}
              aria-hidden={visible ? undefined : true}
              style={{ '--story-color': story.color }}
              className={variantClass(styles.continueCard, visible)}
            >
              <HeldLink
                href={story.readHref}
                {...(visible ? {} : { prefetch: false })}
                onNavigate={markSavedRun}
                className={styles.continueLink}
              >
                {story.title}
              </HeldLink>
            </div>
          )
        })}
        <p
          data-continue-empty=""
          aria-hidden={shown === 'empty' ? undefined : true}
          className={variantClass(styles.continueEmpty, shown === 'empty')}
        >
          {empty}
        </p>
      </div>
    </section>
  )
}
