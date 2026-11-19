'use client'
// Share on the ending card (Step 10c; design p1-step10-design.md D11-P14, §4.3, §4.6, §8; spec §6.1
// player "Share", §6.5, §6.6 4.1.3). A native button that runs the share chain of
// src/reader/player/share.ts with the browser's navigator: the system share sheet when there is
// one, else the clipboard, else a read-only field holding the URL.
// - The URL is the player URL in the content locale (the language the reader is reading), built
//   on tap from location.origin; the title is the story title in that locale (package text).
// - The status is held in a ref as well as in state, so a second tap in the same tick sees
//   'pending' and is ignored (a second share() would reject). The guard holds per control
//   instance: the card keys this control by the content locale (Step 10d), so after a story-language
//   switch a new instance starts idle (review R10d-STRESS-3).
// - copied: "Link copied." shown after the button in [data-share-status] (persistent, no timer)
//   and announced in the page's one live region. manual: a labelled read-only
//   input[data-share-url] holding the URL, focused and selected. idle and pending show nothing.
// - The button sits in the card's actions, which settle with the run area (D11-P7): inert while the
//   run opens or the part settles, so it needs no guard of its own.
// - P1-4 owner screens (design p1-4-polish-design.md R2): the control renders nothing of its own
//   box; it hands the card its two parts through a render prop. share: the button, with "Link
//   copied." after it once a copy is done, for the action row; field: the manual field, or null,
//   for a line of its own under the row. The field follows the row in the DOM, so the visual, DOM
//   and Tab orders agree (WCAG 1.3.2, 2.4.3); the card keeps it inside its settling wrapper.
// - alive: true from this control's mount to its unmount (a layout effect, so it drops in the commit
//   that removes the part). A copy or share that ends after the part changed shows and announces
//   nothing, and never reaches the clipboard (review R10c-STRESS-3, A11Y-10c-3).
import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import type { LocaleCode } from '../../core/locales'
import { runShare, shareUrlOf, type ShareStatus } from '../../reader/player/share'
import { announce } from '../a11y/announce'
import styles from './player.module.css'
import type { PlayerStrings } from './types'

export type ShareStrings = Pick<PlayerStrings, 'share' | 'linkCopied' | 'copyLink'>

export interface ShareFeedbackProps {
  readonly status: ShareStatus
  /** The URL the field holds (manual). */
  readonly url: string
  readonly strings: Pick<ShareStrings, 'linkCopied' | 'copyLink'>
  readonly fieldRef?: Ref<HTMLInputElement>
}

/** What a share left on screen: "Link copied.", the read-only field, or nothing. */
export function ShareFeedback({ status, url, strings, fieldRef }: ShareFeedbackProps) {
  if (status === 'copied') {
    return (
      <span data-share-status="" className={styles.shareStatus}>
        {strings.linkCopied}
      </span>
    )
  }
  if (status === 'manual') {
    return (
      <label className={styles.shareField}>
        <span className={styles.shareFieldLabel}>{strings.copyLink}</span>
        <input
          ref={fieldRef}
          type="text"
          readOnly
          data-share-url=""
          dir="ltr"
          value={url}
          className={styles.shareUrl}
        />
      </label>
    )
  }
  return null
}

/** What the control shows, for the card to place (P1-4 owner screens). */
export interface ShareParts {
  /** The Share button, with "Link copied." after it once a copy is done. */
  readonly share: ReactNode
  /** The manual field ("Copy this link:" and the URL), or null. */
  readonly field: ReactNode
}

export interface ShareControlProps {
  /** The story title in the content locale (package text). */
  readonly title: string
  readonly storyId: string
  /** The run's language: the shared URL opens the story in it. */
  readonly contentLocale: LocaleCode
  readonly strings: ShareStrings
  /** Places the parts: the card puts Share in its action row and the field on a line under it. */
  readonly children: (parts: ShareParts) => ReactNode
}

interface Shown {
  readonly status: ShareStatus
  readonly url: string
}

export function ShareControl({
  title,
  storyId,
  contentLocale,
  strings,
  children,
}: ShareControlProps) {
  const status = useRef<ShareStatus>('idle')
  const [shown, setShown] = useState<Shown>({ status: 'idle', url: '' })
  const field = useRef<HTMLInputElement>(null)
  const alive = useRef(false)

  useLayoutEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // The manual field takes focus with its URL selected, each time a share ends there.
  useLayoutEffect(() => {
    if (shown.status !== 'manual') return
    field.current?.focus()
    field.current?.select()
  }, [shown])

  const share = (): void => {
    const target = { title, url: shareUrlOf(window.location, storyId, contentLocale) }
    void runShare(
      {
        navigator,
        alive: () => alive.current,
        status: () => status.current,
        setStatus: (next) => {
          status.current = next
          setShown({ status: next, url: target.url })
          if (next === 'copied') announce(strings.linkCopied)
        },
      },
      target,
    )
  }

  const feedback = (
    <ShareFeedback status={shown.status} url={shown.url} strings={strings} fieldRef={field} />
  )
  const manual = shown.status === 'manual'
  return children({
    share: (
      <div className={styles.share}>
        <button type="button" data-share="" className={styles.action} onClick={share}>
          <span className={styles.actionLabel}>{strings.share}</span>
        </button>
        {manual ? null : feedback}
      </div>
    ),
    field: manual ? feedback : null,
  })
}
