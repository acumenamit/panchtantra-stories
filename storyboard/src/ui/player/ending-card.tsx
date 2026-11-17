'use client'
// The ending card (Step 10c; design p1-step10-design.md D11-P13, P11, P7, §4.1, §4.6, §6; spec §6.1
// player ending view, §6.6). The ending passage comes first in the part (the focus target like
// every part); this section follows it, inside the part and the run area, before the run footer:
// - the lesson icon (package text, aria-hidden), the alternate label only on an alternate ending
//   (neutral wording, V1 D-57), h2 "The lesson" (the section's name), the lesson as stored (no
//   quotes, no italics; it carries the content lang and dir, like the story), the count "Ending x of
//   y found" (finished on the server; x counts the stored and this session's endings);
// - the actions: Try another path (RESTART with no dialog, P11; endings kept; it carries the seq it
//   was rendered with), Share (D11-P14) and All stories (next/link to /{locale}, the route locale,
//   like the header's exit).
// - The actions settle with the run area (D11-P7): inert while the run opens or this part settles,
//   so a tap that lands here within SETTLE_MS of the ending does nothing. An accepted Try another
//   path makes them inert at once on their DOM node (C28).
// - The heading, alternate label, count and actions carry the page's language (the route locale).
// - Step 10d (the 10c hand-off; D11-P4): a story-language switch keeps the part, and so this card,
//   mounted, and only the lesson changes language. Share is keyed by the content locale, so a
//   switch resets it: "Link copied." or the manual field of the old language's URL goes, and a
//   copy or share sheet still pending from before the switch ends unseen, as when the part
//   changes (its control left the page; review R10c-STRESS-3). The pending guard is per control,
//   so a Share tap after a switch starts a fresh chain even while the old sheet is still open: the
//   second share() then rejects (InvalidStateError) and the chain falls to the clipboard, which
//   copies the new language's URL and says so (review R10d-STRESS-3; accepted).
import Link from 'next/link'
import { useRef } from 'react'
import type { StepResult } from '../../core/engine'
import type { LocaleCode } from '../../core/locales'
import type { PartView } from '../../reader/player/view'
import styles from './player.module.css'
import { ShareControl } from './share-control'
import type { PlayerStrings } from './types'

/** The heading's id, the section's name: one part is mounted at a time. */
export const LESSON_HEADING_ID = 'player-lesson-heading'

export type EndingCardStrings = Pick<
  PlayerStrings,
  'lessonHeading' | 'altEnding' | 'tryAnother' | 'share' | 'linkCopied' | 'copyLink' | 'allStories'
>

export interface EndingCardProps {
  /** The ending part: its seq, content locale, title, alternate flag, icon and lesson. */
  readonly view: Pick<
    PartView,
    'seq' | 'locale' | 'dir' | 'title' | 'isAlternate' | 'lessonIcon' | 'lesson'
  >
  readonly storyId: string
  /** The route locale: All stories goes to /{locale}. */
  readonly locale: LocaleCode
  readonly strings: EndingCardStrings
  /** "Ending x of y found", finished. */
  readonly count: string
  /** False while the run is opening or this part is settling: the actions are inert. */
  readonly interactive: boolean
  /** RESTART from the card, held by the settle like every run-area control. */
  readonly onTryAnother: (seq: number) => StepResult
}

export function EndingCard({
  view,
  storyId,
  locale,
  strings,
  count,
  interactive,
  onTryAnother,
}: EndingCardProps) {
  const actions = useRef<HTMLDivElement>(null)
  return (
    <section data-ending="" aria-labelledby={LESSON_HEADING_ID} className={styles.ending}>
      {view.lessonIcon === null ? null : (
        <p data-lesson-icon="" aria-hidden="true" className={styles.lessonIcon}>
          {view.lessonIcon}
        </p>
      )}
      {view.isAlternate ? (
        <p data-alternate="" className={styles.alternate}>
          {strings.altEnding}
        </p>
      ) : null}
      <h2 id={LESSON_HEADING_ID} className={styles.lessonHeading}>
        {strings.lessonHeading}
      </h2>
      <p data-lesson="" lang={view.locale} dir={view.dir} className={styles.lesson}>
        {view.lesson}
      </p>
      <p data-ending-count="" className={styles.endingCount}>
        {count}
      </p>
      <div ref={actions} data-ending-actions="" inert={!interactive} className={styles.actions}>
        <button
          type="button"
          data-try-another=""
          data-seq={view.seq}
          className={styles.action}
          onClick={() => {
            const result = onTryAnother(view.seq)
            if (result.accepted && actions.current !== null) actions.current.inert = true
          }}
        >
          <span className={styles.actionLabel}>{strings.tryAnother}</span>
        </button>
        <ShareControl
          key={view.locale}
          title={view.title}
          storyId={storyId}
          contentLocale={view.locale}
          strings={strings}
        />
        <Link href={`/${locale}`} data-all-stories="" className={styles.action}>
          <span className={styles.actionLabel}>{strings.allStories}</span>
        </Link>
      </div>
    </section>
  )
}
