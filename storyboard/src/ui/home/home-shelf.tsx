// The story shelf on Home (P1 Step 12; design p1-step12-design.md §3.1 N2, §3.2 N3, §4.1; spec
// SPEC:433, "No coming soon cards", RC-5). A server component that renders from props alone (no
// catalogue read; 13.11 item 5c), so the empty catalogue and the featured-locale cases are unit
// tested. In order: h1 (home.title); then, inside HomeProgress (the one progress island),
// Continue reading, the Featured story (only when build-info names one and its package has this
// locale; a highlight, so it is listed too) and All stories with one card per built story in the
// given order (sortShelf: addedOn descending, then storyId). Each section is named by its h2.
// An empty catalogue for the locale: the h1 and home.placeholder only.
import type { LocaleCode } from '../../core/locales'
import { ContinueReading } from './continue-reading'
import { HomeProgress } from './home-progress'
import styles from './home.module.css'
import { StoryCard, type CardStory } from './story-card'

export const FEATURED_HEADING_ID = 'home-featured-heading'
export const ALL_STORIES_HEADING_ID = 'home-all-stories-heading'

export interface ShelfStrings {
  readonly title: string
  readonly placeholder: string
  readonly continueReading: string
  readonly continueEmpty: string
  readonly featured: string
  readonly allStories: string
}

/** The story build-info names as featured: its id and its package locales. */
export interface FeaturedRef {
  readonly storyId: string
  readonly locales: readonly string[]
}

export interface HomeShelfProps {
  readonly locale: LocaleCode
  readonly strings: ShelfStrings
  /** This locale's stories, already in shelf order. */
  readonly stories: readonly CardStory[]
  readonly featured: FeaturedRef | null
}

export function HomeShelf({ locale, strings, stories, featured }: HomeShelfProps) {
  if (stories.length === 0) {
    return (
      <>
        <h1>{strings.title}</h1>
        <p>{strings.placeholder}</p>
      </>
    )
  }
  const hero =
    featured !== null && featured.locales.includes(locale)
      ? (stories.find((story) => story.storyId === featured.storyId) ?? null)
      : null
  return (
    <>
      <h1>{strings.title}</h1>
      <HomeProgress>
        <ContinueReading
          heading={strings.continueReading}
          empty={strings.continueEmpty}
          stories={stories.map(({ storyId, readHref, title, color }) => ({
            storyId,
            readHref,
            title,
            color,
          }))}
        />
        {hero === null ? null : (
          <section
            data-featured=""
            aria-labelledby={FEATURED_HEADING_ID}
            className={styles.section}
          >
            <h2 id={FEATURED_HEADING_ID}>{strings.featured}</h2>
            <ul role="list" className={styles.heroList}>
              <StoryCard story={hero} variant="hero" />
            </ul>
          </section>
        )}
        <section aria-labelledby={ALL_STORIES_HEADING_ID} className={styles.section}>
          <h2 id={ALL_STORIES_HEADING_ID}>{strings.allStories}</h2>
          <ul data-home-list="" role="list" className={styles.list}>
            {stories.map((story) => (
              <StoryCard key={story.storyId} story={story} variant="list" />
            ))}
          </ul>
        </section>
      </HomeProgress>
    </>
  )
}
