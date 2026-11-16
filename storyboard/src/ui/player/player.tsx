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
// - Step 10b (§4.3, D11-P10 to P12, P19, P20): Back in the run footer (a run-area control, settled
//   like the choices); header row 2 with the progress segments and the Menu disclosure (text size
//   and Start again); the restart dialog after main; TextScaleSync. Start again is a header control,
//   so the settle never holds it: it asks first only while reading with more than 2 pages, else it
//   restarts at once. An accepted restart remounts the run area (keyed by runEpoch, data-epoch + 1),
//   focuses and announces "Page 1" like any step, and closes the menu; the menu stays open while
//   the dialog is open.
// - The restart dialog's cancel (Keep reading, Escape) holds the run area for SETTLE_MS like a step
//   (hold(); D11-P7 amended at 10b, R2-STRESS-1): the dialog closes on the first tap of a double
//   tap, and the second would land on a choice or Back under it. The header stays unsettled.
// Strings arrive finished from the server (src/ui/player/strings.ts); no catalogue here. Imports
// are relative (C15).
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { StepResult } from '../../core/engine'
import type { LocaleCode } from '../../core/locales'
import { SAVED_RUN_ATTRIBUTE } from '../../core/progress/saved-run-hint'
import { createPlayerActions, type PlayerActions } from '../../reader/player/actions'
import { graphOf, type PlayerData } from '../../reader/player/player-data'
import { segmentsOf } from '../../reader/player/segments'
import { partViewOf, SETTLE_MS, tokenOf } from '../../reader/player/view'
import { createRunController, readerStores } from '../../reader/progress'
import { announce } from '../a11y/announce'
import { LiveRegion } from '../a11y/live-region'
import shell from '../shell/shell.module.css'
import { StorageBanner } from '../shell/storage-banner'
import { PlayerHeader } from './player-header'
import { PlayerMenu } from './player-menu'
import styles from './player.module.css'
import { ProgressSegments } from './progress-segments'
import { RestartDialog } from './restart-dialog'
import { StoryPart } from './story-part'
import { TextScaleSync } from './text-scale-sync'
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
  // The menu disclosure and the restart dialog (D11-P11, P19).
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Bumped by hold(): runs the settle effect again for the part on screen (R2-STRESS-1).
  const [holds, setHolds] = useState(0)
  const settlingToken = useRef<string | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const header = useRef<HTMLElement>(null)
  const firstParagraph = useRef<HTMLParagraphElement>(null)
  const menuRestart = useRef<HTMLButtonElement>(null)

  const [controller] = useState(() =>
    createRunController({
      graph: graphOf(data),
      store: readerStores().progress,
      locale,
      localePolicy: 'stored-first',
    }),
  )
  // The page's prefs (the text size): read by the menu's radios and by TextScaleSync.
  const [prefs] = useState(() => readerStores().prefs)
  // Created after hydration, with the controller; there are no taps to handle before that.
  const actions = useRef<PlayerActions | null>(null)

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const opening = snapshot.phase === 'opening'
  const view = partViewOf(data, snapshot.state)
  const segments = segmentsOf(data, snapshot.state)

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

  // A new part: focus, scroll and announce when a step rendered it, then settle. A hold runs it
  // again for the same part (holds): the running timer is cleared and a new SETTLE_MS one starts;
  // a new part or an unmount clears it.
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
  }, [token, page, strings.page, holds])

  // The restart dialog closed with no accepted restart (Keep reading, Escape): the run area is held
  // for SETTLE_MS like a step, through isInteractive and inert, so the second tap of a double tap
  // never lands on a choice or Back under the dialog (D11-P7 amended at 10b, R2-STRESS-1). The
  // header (Menu, Exit) is not held.
  const hold = (): void => {
    const held = tokenOf(controller.getSnapshot().state)
    settlingToken.current = held
    setSettling(held)
    setHolds((count) => count + 1)
  }

  const refused = (): StepResult => ({
    state: controller.getSnapshot().state,
    accepted: false,
    effects: [],
  })
  const choose = (seq: number, choiceId: string): StepResult =>
    actions.current?.choose(seq, choiceId) ?? refused()
  const back = (seq: number): StepResult => actions.current?.back(seq) ?? refused()

  // Start again from the menu or its dialog: RESTART, not held by the settle; an accepted one
  // closes the menu (D11-P11, P19, C13).
  const restart = (seq: number): boolean => {
    const result = actions.current?.menuRestart(seq) ?? refused()
    if (result.accepted) setMenuOpen(false)
    return result.accepted
  }

  // The menu's Start again: the dialog only while reading with more than 2 pages (V1 D-71).
  const startAgain = (seq: number): void => {
    const { status, path } = controller.getSnapshot().state
    if (status === 'reading' && path.length > 2) setConfirmOpen(true)
    else restart(seq)
  }

  const endReveal = (): void => {
    if (animated === token && revealDone !== token) setRevealDone(token)
  }

  return (
    <div data-player="" data-run-phase={snapshot.phase} className={styles.player}>
      <TextScaleSync prefs={prefs} />
      <PlayerHeader
        ref={header}
        locale={locale}
        allStories={strings.allStories}
        navLabel={strings.navLabel}
        grownUps={strings.grownUps}
      >
        <PlayerMenu
          strings={strings}
          prefs={prefs}
          open={menuOpen}
          confirmOpen={confirmOpen}
          opening={opening}
          seq={view.seq}
          leading={
            <ProgressSegments
              total={segments.total}
              reached={segments.reached}
              label={strings.progress}
              valueText={strings.progressValue[segments.reached] ?? ''}
            />
          }
          restartRef={menuRestart}
          onToggle={() => setMenuOpen((open) => !open)}
          onClose={() => setMenuOpen(false)}
          onStartAgain={startAgain}
        />
      </PlayerHeader>
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
            backLabel={strings.back}
            onBack={back}
          />
        </div>
        <LiveRegion />
      </main>
      <RestartDialog
        strings={strings}
        open={confirmOpen}
        seq={view.seq}
        returnFocus={menuRestart}
        onConfirm={restart}
        onCancelled={hold}
        onClosed={() => setConfirmOpen(false)}
      />
    </div>
  )
}
