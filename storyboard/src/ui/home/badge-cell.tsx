'use client'
// One story card's badge cell (P1 Step 12; design p1-step12-design.md §3.4 N5, §3.5 N6, §4.3; spec
// SPEC:433). A reserved cell: every variant (Reading, Finished · x of y for x = 1..y, New) is
// rendered in one grid area; all are hidden (visibility: hidden, aria-hidden) while pending, and
// after the read exactly the one badgeOf selects is shown, or none. The cell's box is the widest
// variant's in every state, so the read moves nothing (no digit-width guess: one variant per x).
// Hooks: data-badge-cell, data-story, data-shown (pending|none|reading|finished|new) and
// data-found when finished; each variant data-badge (and data-found). Badges are plain text, never
// announced (part of the page as loaded). Strings arrive finished from the server.
import { useContext } from 'react'
import { badgeOf } from '../../reader/shelf/shelf'
import { HomeProgressContext } from './home-progress'
import styles from './home.module.css'

export interface BadgeStrings {
  readonly reading: string
  /** "Finished · x of y endings" for x = 1..y, in that order. */
  readonly finished: readonly string[]
  readonly new: string
}

export interface BadgeCellProps {
  readonly storyId: string
  readonly addedOn: string
  readonly endingIds: readonly string[]
  readonly strings: BadgeStrings
}

type Shown = 'pending' | 'none' | 'reading' | 'finished' | 'new'

const variantClass = (visible: boolean): string =>
  visible ? (styles.badge ?? '') : `${styles.badge} ${styles.hidden}`

export function BadgeCell({ storyId, addedOn, endingIds, strings }: BadgeCellProps) {
  const progress = useContext(HomeProgressContext)
  let shown: Shown = 'pending'
  let found: number | undefined
  if (progress.phase === 'ready') {
    const entry = progress.entries.find((e) => e.storyId === storyId) ?? null
    const badge = badgeOf({ entry, endingIds, addedOn, now: progress.now })
    shown = badge === null ? 'none' : badge.kind
    if (badge?.kind === 'finished') found = badge.found
  }
  return (
    <span
      data-badge-cell=""
      data-story={storyId}
      data-shown={shown}
      data-found={found}
      className={styles.badgeCell}
    >
      <span
        data-badge="reading"
        aria-hidden={shown === 'reading' ? undefined : true}
        className={variantClass(shown === 'reading')}
      >
        {strings.reading}
      </span>
      {strings.finished.map((text, index) => {
        const visible = shown === 'finished' && found === index + 1
        return (
          <span
            key={index}
            data-badge="finished"
            data-found={index + 1}
            aria-hidden={visible ? undefined : true}
            className={variantClass(visible)}
          >
            {text}
          </span>
        )
      })}
      <span
        data-badge="new"
        aria-hidden={shown === 'new' ? undefined : true}
        className={variantClass(shown === 'new')}
      >
        {strings.new}
      </span>
    </span>
  )
}
