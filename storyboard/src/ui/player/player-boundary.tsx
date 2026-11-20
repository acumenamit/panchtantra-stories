'use client'
// The player's error boundary (Step 10a; design p1-step10-design.md D11-P17, §8; spec §6.1 system
// states "error boundary with 'Start this story again'"). catchError from next/error wraps the
// whole island in the page; there is no app/global-error.tsx (L2). A render or effect error
// anywhere in the island unmounts it and shows this fallback; event handlers only dispatch, and the
// engine never throws (R18).
// - The fallback gets server strings as props: main#main (the skip link's target) with the storage
//   banner first, an h1 focused on mount, "Start this story again" (clears the saved run, keeps the
//   endings, then reloads the page), "All stories" to /{locale}, and an empty live region.
// - The error itself is never shown (no message, no stack, no digest).
// - P1 Step 12 (design p1-step12-design.md §3.12 N13, §3.13 N14; S12-CRIT-3): "All stories" renders
//   through HeldLink (same href and markup), so its tap starts the navigation hold.
import { catchError } from 'next/error'
import { useLayoutEffect, useRef, useState } from 'react'
import type { LocaleCode } from '../../core/locales'
import { readerStores } from '../../reader/progress'
import { LiveRegion } from '../a11y/live-region'
import { HeldLink } from '../shell/held-link'
import shell from '../shell/shell.module.css'
import { StorageBanner } from '../shell/storage-banner'
import styles from './player.module.css'
import type { PlayerFallbackStrings } from './types'

export interface PlayerFallbackProps {
  readonly storyId: string
  /** The route locale. */
  readonly locale: LocaleCode
  readonly strings: PlayerFallbackStrings
}

export function PlayerFallback({ storyId, locale, strings }: PlayerFallbackProps) {
  const title = useRef<HTMLHeadingElement>(null)
  const [restarting, setRestarting] = useState(false)

  useLayoutEffect(() => {
    title.current?.focus()
  }, [])

  const startAgain = async (): Promise<void> => {
    if (restarting) return
    setRestarting(true)
    // resetRun clears the run and keeps the endings; a storage failure still reloads.
    await readerStores()
      .progress.resetRun(storyId)
      .catch(() => {})
    window.location.reload()
  }

  return (
    <main id="main" tabIndex={-1} data-player-error="" className={shell.main}>
      <StorageBanner title={strings.storageTitle} body={strings.storageBody} />
      <h1 ref={title} tabIndex={-1} className={styles.fallbackTitle}>
        {strings.errorTitle}
      </h1>
      <div className={styles.actions}>
        <button
          type="button"
          data-start-again=""
          className={styles.action}
          onClick={() => void startAgain()}
        >
          <span className={styles.actionLabel}>{strings.startThisAgain}</span>
        </button>
        <HeldLink href={`/${locale}`} className={styles.action}>
          <span className={styles.actionLabel}>{strings.allStories}</span>
        </HeldLink>
      </div>
      <LiveRegion />
    </main>
  )
}

// catchError calls the fallback with (props, errorInfo); rendering it as an element keeps its
// hooks in a component of their own, and errorInfo (the error) is never passed on.
function renderFallback(props: PlayerFallbackProps) {
  return <PlayerFallback {...props} />
}

export const PlayerBoundary = catchError(renderFallback)
