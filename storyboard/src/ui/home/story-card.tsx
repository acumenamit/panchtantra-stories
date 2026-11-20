// One story card on Home, in the list or as the Featured hero (P1 Step 12; design
// p1-step12-design.md §3.3 N4, §3.24, §4.11; spec SPEC:433). A server component: it renders the
// held link (a client component) with plain props only, so no function crosses the boundary
// (S12-CRIT-1), and the badge cell, which reads Home's progress context.
// - li[data-story-card="<id>"][data-added-on="<YYYY-MM-DD>"] (tests order the cards by their rule
//   without naming staging ids, S12-CRIT-4), its colour as a custom property only (--story-color,
//   the bar; decorative); the emoji in a fixed, hidden box; the book label; the title as h3 holding
//   the card's only link, to the landing, stretched over the whole card (home.module.css); the
//   description; the meta line [data-story-meta]: "Age 6+", the duration as stored, the badge cell.
// - Package text renders as stored (SPEC:441). The hero variant adds the hero class only.
import { HeldLink } from '../shell/held-link'
import { BadgeCell, type BadgeStrings } from './badge-cell'
import styles from './home.module.css'

/** Everything a card shows, built on the server (strings.ts cardOf). */
export interface CardStory {
  readonly storyId: string
  readonly addedOn: string
  readonly color: string
  readonly emoji: string
  readonly book: string
  readonly title: string
  readonly description: string
  readonly duration: string
  /** "Age 6+", formatted. */
  readonly age: string
  /** /{locale}/stories/{storyId} */
  readonly landingHref: string
  /** /{locale}/stories/{storyId}/read (Continue reading) */
  readonly readHref: string
  readonly endingIds: readonly string[]
  readonly badges: BadgeStrings
}

export interface StoryCardProps {
  readonly story: CardStory
  readonly variant: 'list' | 'hero'
}

export function StoryCard({ story, variant }: StoryCardProps) {
  return (
    <li
      data-story-card={story.storyId}
      data-added-on={story.addedOn}
      style={{ '--story-color': story.color }}
      className={variant === 'hero' ? `${styles.card} ${styles.hero}` : styles.card}
    >
      <span aria-hidden="true" className={styles.emoji}>
        {story.emoji}
      </span>
      <p className={styles.book}>{story.book}</p>
      <h3 className={styles.title}>
        <HeldLink href={story.landingHref} className={styles.link}>
          {story.title}
        </HeldLink>
      </h3>
      <p className={styles.description}>{story.description}</p>
      <p data-story-meta="" className={styles.meta}>
        <span>{story.age}</span>
        <span>{story.duration}</span>
        <BadgeCell
          storyId={story.storyId}
          addedOn={story.addedOn}
          endingIds={story.endingIds}
          strings={story.badges}
        />
      </p>
    </li>
  )
}
