'use client'
// The run footer's narration group (Step 11, P1-5a; design p1-step11-design.md §4.4, §4.7, §4.8,
// §5, N1, N2, N8 to N15, N26; spec §6.4, §6.6). The island renders it in the run footer after Back,
// on every part, when the run's language has narration (narrationOfferedIn), and passes the display
// narrationDisplayOf gives; strings arrive finished, in the route locale (the footer sits outside
// the story container, so it carries the page's language).
// - Order (CRIT-3): Read to me, the AI voice byline, the playback button (when a kind applies), then
//   the status line on its own last line (when a message applies). The group wraps and aligns its
//   items at the start, so a control appearing never re-centres the others.
// - Read to me: a toggle with a fixed label and aria-pressed; a pip, an outline when off and filled
//   when on (the pressed state is not told by colour alone).
// - The byline (N13, CRIT-5): a text link, never the button look, right after Read to me, to the
//   Grown-ups page's "How these stories are made" section in the route locale, same tab. Its name
//   is the visible "AI voice" then a visually hidden "(how these stories are made)" (2.4.4, 2.5.3).
// - The playback button (N26): one <button> across Pause, Resume, Play again and Tap to listen, so
//   focus stays on it; it holds the four labels in one grid cell, in that fixed order, the current
//   one shown and the others visibility: hidden and aria-hidden, so its box is the widest label's in
//   every state and a state change without input moves nothing. data-pulse marks the refused or
//   cued Tap to listen. Tests read its label by accessible name or data-kind, never its text.
// - The status line: "Loading" or the unavailable message, with no role and no aria-live (N15): the
//   island announces the unavailable message in the page's one live region, at most once per run.
// - Narration never moves focus. The hooks are data attributes (§4.8); nothing is on window.
// - N27 (design §20.2): linkHeld is the hold after an applied narration tap: the byline gets its
//   own inert, so the second tap of a double tap that a move puts on it opens nothing; the group,
//   Read to me and the playback button are never made inert by it (N17 holds them), so focus stays.
// Imports are relative (C15).
import Link from 'next/link'
import type { LocaleCode } from '../../core/locales'
import {
  HOW_STORIES_ARE_MADE_ID,
  NARRATION_PLAYBACKS,
  type NarrationDisplay,
  type NarrationPlayback,
} from '../../reader/player/narration'
import { VisuallyHidden } from '../a11y/visually-hidden'
import styles from './player.module.css'
import type { NarrationStrings } from './types'

export interface NarrationControlsProps {
  /** The route locale: the byline's Grown-ups page. */
  readonly locale: LocaleCode
  readonly display: NarrationDisplay
  readonly strings: NarrationStrings
  /** Read to me. */
  readonly onToggle: () => void
  /** The playback button, with the kind it showed when tapped. */
  readonly onPlayback: (kind: NarrationPlayback) => void
  /** N27: the run-area hold after a narration tap: the byline is inert (nothing else here). */
  readonly linkHeld?: boolean
}

function playbackLabel(strings: NarrationStrings, kind: NarrationPlayback): string {
  switch (kind) {
    case 'pause':
      return strings.pause
    case 'resume':
      return strings.resume
    case 'play-again':
      return strings.playAgain
    case 'tap-to-listen':
      return strings.tapToListen
  }
}

export function NarrationControls({
  locale,
  display,
  strings,
  onToggle,
  onPlayback,
  linkHeld,
}: NarrationControlsProps) {
  const { playback, message } = display
  return (
    <div
      data-narration=""
      data-status={display.status}
      data-on={display.on ? '' : undefined}
      className={styles.narration}
    >
      <button
        type="button"
        data-read-to-me=""
        aria-pressed={display.on}
        className={styles.action}
        onClick={onToggle}
      >
        <span data-pip="" aria-hidden="true" className={styles.pip} />
        <span className={styles.actionLabel}>{strings.readToMe}</span>
      </button>
      <Link
        href={`/${locale}/grown-ups#${HOW_STORIES_ARE_MADE_ID}`}
        data-ai-voice=""
        inert={linkHeld}
        className={styles.byline}
      >
        <span className={styles.actionLabel}>{strings.aiVoice}</span>{' '}
        <VisuallyHidden>{strings.aiVoiceAbout}</VisuallyHidden>
      </Link>
      {playback === null ? null : (
        <button
          type="button"
          data-narration-control=""
          data-kind={playback}
          data-pulse={display.pulse ? '' : undefined}
          className={styles.action}
          onClick={() => onPlayback(playback)}
        >
          <span className={styles.playbackLabels}>
            {NARRATION_PLAYBACKS.map((kind) =>
              kind === playback ? (
                <span key={kind} className={styles.actionLabel}>
                  {playbackLabel(strings, kind)}
                </span>
              ) : (
                <span
                  key={kind}
                  className={`${styles.actionLabel} ${styles.reserve}`}
                  aria-hidden="true"
                >
                  {playbackLabel(strings, kind)}
                </span>
              ),
            )}
          </span>
        </button>
      )}
      {message === null ? null : (
        <p data-narration-message={message} className={styles.narrationMessage}>
          {message === 'loading' ? strings.narrationLoading : strings.narrationUnavailable}
        </p>
      )}
    </div>
  )
}
