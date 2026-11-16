'use client'
// The story player island (Step 10a; design p1-step10-design.md §4.1, §4.2, §5, D11-P3, P5 to P9,
// P18; spec §6.2-§6.4, §6.6). The one client root of a player page: header, then main with the
// storage banner, the run area and the page's one polite live region.
// - The run controller is created once (useState initializer) with the stored-first language
//   policy and read through useSyncExternalStore; the server and the hydrating client both render
//   its opening snapshot (the start node in the URL locale), so hydration matches.
// - A layout effect creates the actions (createPlayerActions; refs are never read during render)
//   and calls open() (it reads once, never writes, never rejects). Until it resolves,
//   data-run-phase="opening" and every run control is inert, so a tap before hydration or before
//   open does nothing and nothing is queued. The resumed node replaces the start node in place
//   (same part key), with no reveal, no focus move and no announcement. After the open commit the
//   island removes the saved-run hint's attribute from <html> (also on unmount).
// - A tap runs the actions synchronously in the click handler. On an accepted step (a
//   result with a focus effect: CHOOSE, BACK, RESTART; never SET_LOCALE) the new part settles for
//   SETTLE_MS (its controls inert, whatever the motion setting; a timer, not a clock read), reveals,
//   and in its layout effect scrolls the header to the top, focuses its first paragraph and
//   announces "Page n" (D11-P7, P8, P9).
// Strings arrive finished from the server (src/ui/player/strings.ts); no catalogue here. Imports
// are relative (C15).
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { StepResult } from '../../core/engine'
import type { LocaleCode } from '../../core/locales'
import { SAVED_RUN_ATTRIBUTE } from '../../core/progress/saved-run-hint'
import { createPlayerActions, type PlayerActions } from '../../reader/player/actions'
import { graphOf, type PlayerData } from '../../reader/player/player-data'
import { partViewOf, SETTLE_MS, tokenOf } from '../../reader/player/view'
import { createRunController, readerStores } from '../../reader/progress'
import { announce } from '../a11y/announce'
import { LiveRegion } from '../a11y/live-region'
import shell from '../shell/shell.module.css'
import { StorageBanner } from '../shell/storage-banner'
import { PlayerHeader } from './player-header'
import styles from './player.module.css'
import { StoryPart } from './story-part'
import type { PlayerStrings } from './types'

export interface PlayerProps {
  readonly data: PlayerData
  readonly strings: PlayerStrings
  /** The route locale: the chrome's language and a fresh run's language. */
  readonly locale: LocaleCode
}

const isStep = (result: StepResult): boolean =>
  result.effects.some((effect) => effect.type === 'focus')

export function Player({ data, strings, locale }: PlayerProps) {
  // The token of the part that is settling (its run-area controls inert), else null.
  const [settling, setSettling] = useState<string | null>(null)
  // The token of the part a step rendered (it reveals), and of the part whose reveal was ended.
  const [animated, setAnimated] = useState<string | null>(null)
  const [revealDone, setRevealDone] = useState<string | null>(null)
  const settlingToken = useRef<string | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const header = useRef<HTMLElement>(null)
  const firstParagraph = useRef<HTMLParagraphElement>(null)

  const [controller] = useState(() =>
    createRunController({
      graph: graphOf(data),
      store: readerStores().progress,
      locale,
      localePolicy: 'stored-first',
    }),
  )
  // Created after hydration, with the controller; there are no taps to handle before that.
  const actions = useRef<PlayerActions | null>(null)

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const opening = snapshot.phase === 'opening'
  const view = partViewOf(data, snapshot.state)

  useLayoutEffect(() => {
    actions.current = createPlayerActions({
      controller,
      isInteractive: () => {
        const { phase, state } = controller.getSnapshot()
        return phase === 'open' && settlingToken.current !== tokenOf(state)
      },
      onAccepted: (result) => {
        if (!isStep(result)) return
        const token = tokenOf(result.state)
        settlingToken.current = token
        pendingFocus.current = token
        setSettling(token)
        setAnimated(token)
      },
    })
    void controller.open()
  }, [controller])

  useLayoutEffect(() => {
    if (!opening) document.documentElement.removeAttribute(SAVED_RUN_ATTRIBUTE)
  }, [opening])

  useLayoutEffect(() => () => document.documentElement.removeAttribute(SAVED_RUN_ATTRIBUTE), [])

  // A new part: focus, scroll and announce when a step rendered it, then settle.
  const { token, page } = view
  useLayoutEffect(() => {
    if (pendingFocus.current === token) {
      pendingFocus.current = null
      header.current?.scrollIntoView({ block: 'start' })
      firstParagraph.current?.focus({ preventScroll: true })
      const text = strings.page[page - 1]
      if (text !== undefined) announce(text)
    }
    if (settlingToken.current !== token) return
    const timer = window.setTimeout(() => {
      settlingToken.current = null
      setSettling(null)
    }, SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [token, page, strings.page])

  const choose = (seq: number, choiceId: string): StepResult =>
    actions.current?.choose(seq, choiceId) ?? {
      state: controller.getSnapshot().state,
      accepted: false,
      effects: [],
    }

  const endReveal = (): void => {
    if (animated === token && revealDone !== token) setRevealDone(token)
  }

  return (
    <div data-player="" data-run-phase={snapshot.phase} className={styles.player}>
      <PlayerHeader
        ref={header}
        locale={locale}
        allStories={strings.allStories}
        navLabel={strings.navLabel}
        grownUps={strings.grownUps}
      />
      <main id="main" tabIndex={-1} className={shell.main}>
        <StorageBanner title={strings.storageTitle} body={strings.storageBody} />
        <div
          key={view.runEpoch}
          data-run=""
          data-epoch={view.runEpoch}
          className={styles.runDependent}
          onPointerDown={endReveal}
          onKeyDown={endReveal}
        >
          <StoryPart
            key={token}
            view={view}
            interactive={!opening && settling !== token}
            animate={animated === token}
            revealDone={revealDone === token}
            firstParagraphRef={firstParagraph}
            onChoose={choose}
          />
        </div>
        <LiveRegion />
      </main>
    </div>
  )
}
