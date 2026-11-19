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
//   tap, and the second would land on a choice or Back under it. The header stays unsettled, except
//   that the menu's Start again is ignored during that hold (startAgainHeld; 10d, T-b10): when it
//   lies under Keep reading, the second tap would reopen the dialog. A step's settle never holds it.
// - Step 10c (§4.2 steps 4 and 6, §4.3, §5, D11-P9, P11, P13, P14): at an ending the part shows
//   the ending card after its passage. The count x = |(stored ∪ session endings) ∩ endingIds|:
//   the open effect reads the stored endings once (progress.get; reads never write, SPEC:470) and
//   again on every later change (progress.subscribe: this tab's saves, other tabs); an accepted
//   step's recordEnding adds its node to the session endings at once, so the ending just found
//   counts before the save lands and with storage blocked. The step's announcement at an ending is
//   that count instead of "Page n". Try another path is a run-area RESTART with no dialog, refused
//   while the run area settles; the card's actions (Try another path, Share, All stories) settle
//   with the run area.
// - Step 10d (§4.3, D11-P4, F3): the story-language switch in the header nav, before Grown-ups,
//   shown only when localeSwitchOf offers a language. A tap sends SET_LOCALE (a header control,
//   never held by the settle): the engine keeps the node and seq, so the part keeps its key and
//   stays mounted, and SET_LOCALE has no focus effect, so nothing settles, reveals, moves focus or
//   is announced; data-story and the lesson take the new lang and dir (lang islands that set their
//   own size and leading), while the chrome stays on the route locale. It works at an ending and
//   with storage blocked; reload resumes in the stored language (stored-first, mid-story only).
// - Step 10e (§4.1, §5, D11-P21 to P23): the run area carries data-scene (sceneIdOf: a legacy
//   scene, any other name forest-day) and paints that scene's gradient; a node with a picture shows
//   the scene image band after its title (SceneImage), and a picture that fails is kept in
//   failedImages (by image id), so its box stays, the img is hidden and the gradient shows, also on
//   a later visit to that node. After each committed part while open, the next pictures are
//   preloaded at low priority (useImagePrefetch: the 1-2 real candidates, never the current one).
// - Step 11 (design p1-step11-design.md §4.2 to §4.6, N1 to N19; spec §6.4): narration. One
//   narration session (useState, above the run area's key, so a restart remount keeps it) read
//   through useSyncExternalStore; a layout effect attaches it (one controller) and its cleanup
//   disposes the controller, so leaving the player (All stories, Grown-ups, the byline, the error
//   boundary) stops the clip. The server and hydration render Read to me off; the actions' layout
//   effect then takes prefs.readToMe (setOn: no controller call), so opening never plays.
//   - Every narration call runs synchronously inside its tap, before that tap's storage write:
//     narration.onStep(result) is the first statement of onAccepted (choices, Back, Try another
//     path, Start again, the dialog's confirm); the story-language switch calls onSwitch after its
//     accepted result; Read to me calls the session, then writes prefs.readToMe; the playback
//     button calls the session. The session ignores a narration tap within SETTLE_MS of the last
//     applied one (a timer; no inert, so focus stays). Another tab's pref change is not followed.
//   - The run footer holds the narration group (NarrationControls) on every part when the run's
//     language has narration. The unavailable message is announced in the live region at most once
//     per runEpoch, SETTLE_MS after it appeared, and only if it still shows for the same part
//     (narrationAnnouncementOf); "Loading" and the refused-play cue are not announced.
//   - N27 (design §20.2; REQ:273): an applied narration tap (Read to me either way, the playback
//     button in any kind) holds the rest of the run area for SETTLE_MS, so the second tap of a
//     double tap that a layout move puts on a choice, Back, the ending card's actions or the AI
//     voice link does nothing: those nodes are inert (partHoldOf) and choose, back and restart are
//     refused through isInteractive (refs set in the tap, so before the commit too). Not hold():
//     its settle makes the run footer inert, and the footer holds the narration group, so a focused
//     Read to me would lose focus. The footer, the group and the narration buttons are never held
//     this way (N17's session hold covers them) and keep focus; the header is not held. One timer
//     per hold, released only by its own id; a new part clears it (tokens never repeat on a page).
//     A held or false tap starts no hold. Nothing is announced and nothing looks different.
// Strings arrive finished from the server (src/ui/player/strings.ts); no catalogue here. Imports
// are relative (C15).
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { StepResult } from '../../core/engine'
import type { LocaleCode } from '../../core/locales'
import { SAVED_RUN_ATTRIBUTE } from '../../core/progress/saved-run-hint'
import { createPlayerActions, type PlayerActions } from '../../reader/player/actions'
import { endingCountOf } from '../../reader/player/endings'
import { nodeImageOf } from '../../reader/player/images'
import { localeSwitchOf } from '../../reader/player/locales'
import {
  createNarrationSession,
  narrationAnnouncementOf,
  narrationDisplayOf,
  narrationOfferedIn,
  narrationPartOf,
  type NarrationPlayback,
} from '../../reader/player/narration'
import { graphOf, type PlayerData } from '../../reader/player/player-data'
import { sceneIdOf } from '../../reader/player/scene'
import { segmentsOf } from '../../reader/player/segments'
import { partViewOf, SETTLE_MS, tokenOf } from '../../reader/player/view'
import { createRunController, readerStores } from '../../reader/progress'
import { announce } from '../a11y/announce'
import { LiveRegion } from '../a11y/live-region'
import shell from '../shell/shell.module.css'
import { StorageBanner } from '../shell/storage-banner'
import { EndingCard } from './ending-card'
import { NarrationControls } from './narration-controls'
import { PlayerHeader } from './player-header'
import { PlayerMenu } from './player-menu'
import styles from './player.module.css'
import { ProgressSegments } from './progress-segments'
import { RestartDialog } from './restart-dialog'
import { SceneImage } from './scene-image'
import { StoryLanguageSwitch } from './story-language-switch'
import { StoryPart } from './story-part'
import { TextScaleSync } from './text-scale-sync'
import type { PlayerStrings } from './types'
import { useImagePrefetch } from './use-image-prefetch'

export interface PlayerProps {
  readonly data: PlayerData
  readonly strings: PlayerStrings
  /** The route locale: the chrome's language and a fresh run's language. */
  readonly locale: LocaleCode
}

const isStep = (result: StepResult): boolean =>
  result.effects.some((effect) => effect.type === 'focus')

/**
 * Is the menu's Start again ignored now (exported for its unit test)? Only during the hold after a
 * restart-dialog cancel: `cancelled` is the token hold() held, `settling` the token the run area
 * settles for (null once the settle timer released it), so one timer releases both. A step's
 * settle (no cancel, or a cancel of another part) never holds Start again (D11-P7, T-b4).
 */
export function startAgainHeld(cancelled: string | null, settling: string | null): boolean {
  return cancelled !== null && cancelled === settling
}

/** Which run-area nodes refuse taps now (N27); exported for its unit test. */
export interface PartHold {
  /** Not opening and not settling: the run footer, with Back and the narration group, is live. */
  readonly interactive: boolean
  /** The hold after an applied narration tap: the choices, Back, the ending card's actions and the
   * AI voice link are inert and refused; the footer and the narration buttons are not. */
  readonly held: boolean
}

export function partHoldOf(input: {
  /** The run is opening (before open() resolved). */
  readonly opening: boolean
  /** The part on screen. */
  readonly token: string
  /** The part a step's settle or a restart-dialog cancel holds, or null. */
  readonly settling: string | null
  /** The part the narration hold holds, or null. */
  readonly narrationHeld: string | null
}): PartHold {
  const interactive = !input.opening && input.settling !== input.token
  return { interactive, held: input.narrationHeld === input.token }
}

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
  // Step 10c (§5): the stored endings (read, never written) and the endings this page reached.
  const [storedEndings, setStoredEndings] = useState<readonly string[]>([])
  const [sessionEndings, setSessionEndings] = useState<readonly string[]>([])
  // Step 10e (§5): the ids of the pictures that failed to load or decode on this page.
  const [failedImages, setFailedImages] = useState<readonly string[]>([])
  // Step 11 N27: the part the narration hold holds (null at first, so the server and hydration
  // render as before), and the id of the latest hold, which runs the release effect again.
  const [narrationHeld, setNarrationHeld] = useState<string | null>(null)
  const [narrationHolds, setNarrationHolds] = useState(0)
  // Set in the tap, so isInteractive refuses before the commit (C28's reason); the id guards the
  // release, so an old timer never releases a newer hold.
  const narrationHeldToken = useRef<string | null>(null)
  const narrationHoldId = useRef(0)
  const settlingToken = useRef<string | null>(null)
  // The token the last restart-dialog cancel held (hold()); see startAgainHeld.
  const cancelledToken = useRef<string | null>(null)
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
  // Step 11 (N19): the page's narration session, above the run area's key. Nothing in it touches
  // the document before a tap, so the server render creates one too.
  const [narration] = useState(() => createNarrationSession({ data }))
  // Created after hydration, with the controller; there are no taps to handle before that.
  const actions = useRef<PlayerActions | null>(null)

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  // Read to me off and idle on the server and while hydrating (the session's first snapshot).
  const narrationSnapshot = useSyncExternalStore(
    narration.subscribe,
    narration.getSnapshot,
    narration.getSnapshot,
  )
  const opening = snapshot.phase === 'opening'
  const view = partViewOf(data, snapshot.state)
  // Step 11: the group shows when the run's language has narration (N1, N12); what it shows is the
  // 4.4 table for the part on screen.
  const narrationOffered = narrationOfferedIn(data, view.locale)
  const narrationDisplay = narrationDisplayOf(
    narrationSnapshot,
    narrationPartOf(data, snapshot.state),
  )
  const segments = segmentsOf(data, snapshot.state)
  // "Ending x of y found": stored or found on this page, current ending ids only (D11-P13).
  const endingsFound = endingCountOf(data.endingIds, storedEndings, sessionEndings)
  // The language the story-language switch offers, or null: no switch (D11-P4).
  const languageTarget = localeSwitchOf(data, view.locale)
  // The node's picture, or null: no band (D11-P21).
  const image = nodeImageOf(data, view.nodeId)
  // Stable, so the image's decode check runs once per picture (D11-P21).
  const markFailed = useCallback((id: string): void => {
    setFailedImages((ids) => (ids.includes(id) ? ids : [...ids, id]))
  }, [])
  // The next pictures, after each committed part while open (D11-P22).
  useImagePrefetch(data, snapshot.state, !opening)

  useLayoutEffect(() => {
    actions.current = createPlayerActions({
      controller,
      isInteractive: () => {
        const { phase, state } = controller.getSnapshot()
        const now = partHoldOf({
          opening: phase !== 'open',
          token: tokenOf(state),
          settling: settlingToken.current,
          narrationHeld: narrationHeldToken.current,
        })
        return now.interactive && !now.held
      },
      onAccepted: (result) => {
        // Step 11 (N5, 4.6): first, synchronously, so play() runs inside the tap and before the
        // controller's save (a microtask queued by dispatch).
        narration.onStep(result)
        // A found ending counts at once, before the controller's save lands (§4.2 step 6).
        for (const effect of result.effects) {
          if (effect.type !== 'recordEnding') continue
          const found = effect.nodeId
          setSessionEndings((ids) => (ids.includes(found) ? ids : [...ids, found]))
        }
        if (!isStep(result)) return
        const token = tokenOf(result.state)
        settlingToken.current = token
        pendingFocus.current = token
        setSettling(token)
        setAnimated(token)
      },
    })
    // Step 11 (N3, N4): Read to me as remembered, after hydration; no controller call, so opening
    // or resuming never plays.
    narration.setOn(prefs.getSnapshot().readToMe)
    void controller.open()

    // The stored endings (§4.2 step 4): read once now and again on every later change of the
    // record; get() never writes (SPEC:470). Only the latest read is applied, never after unmount.
    const progress = readerStores().progress
    let live = true
    let latest = 0
    const readEndings = (): void => {
      const read = ++latest
      progress.get(data.storyId).then(
        (story) => {
          if (live && read === latest) setStoredEndings(story?.endingsFound ?? [])
        },
        () => {
          // A store that rejects (it should not) leaves the count to this session's endings.
        },
      )
    }
    readEndings()
    const unsubscribe = progress.subscribe(readEndings)
    return () => {
      live = false
      unsubscribe()
    }
  }, [controller, data.storyId, narration, prefs])

  // Step 11 (N19): one narration controller while the player is mounted; the cleanup disposes it
  // (pause, src removed, load), so leaving the player stops the clip, and a StrictMode or Fast
  // Refresh re-run attaches a fresh one.
  useLayoutEffect(() => narration.attach(), [narration])

  // Step 11 (N10, A17): the unavailable message, while the group shows it, is announced in the live
  // region at most once per runEpoch, SETTLE_MS after it appeared and only if it still shows for the
  // same part (narrationAnnouncementOf decides), so it never lands in the frame of "Page n". A
  // part's key is its token and the run's language (a switch keeps the token). The timers outlive a
  // change of the key on purpose (the decision reads where the message is now); unmount clears them.
  const unavailableFor =
    narrationOffered && narrationDisplay.message === 'unavailable'
      ? `${view.token} ${view.locale}`
      : null
  const unavailableNow = useRef<string | null>(null)
  const announcedEpoch = useRef<number | null>(null)
  const announceTimers = useRef(new Set<number>())
  const unavailableText = strings.narrationUnavailable
  const { runEpoch } = view
  useLayoutEffect(() => {
    unavailableNow.current = unavailableFor
  }, [unavailableFor])
  useEffect(() => {
    if (unavailableFor === null) return
    const timers = announceTimers.current
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      const decision = {
        runEpoch,
        announcedEpoch: announcedEpoch.current,
        shownFor: unavailableFor,
        shownNow: unavailableNow.current,
      }
      if (!narrationAnnouncementOf(decision)) return
      announcedEpoch.current = runEpoch
      announce(unavailableText)
    }, SETTLE_MS)
    timers.add(timer)
  }, [unavailableFor, runEpoch, unavailableText])
  useEffect(() => {
    const timers = announceTimers.current
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  useLayoutEffect(() => {
    if (!opening) document.documentElement.removeAttribute(SAVED_RUN_ATTRIBUTE)
  }, [opening])

  useLayoutEffect(() => () => document.documentElement.removeAttribute(SAVED_RUN_ATTRIBUTE), [])

  // A new part: focus, scroll and announce when a step rendered it ("Page n", or at an ending the
  // ending count, D11-P9), then settle. The settle is its own effect (declared after, so it runs
  // after), so a later change of the announcement (stored endings landing) never restarts the
  // timer. A hold runs the settle again for the same part (holds): the running timer is cleared and
  // a new SETTLE_MS one starts; a new part or an unmount clears it.
  const { token, page } = view
  const announcement = view.ending ? strings.endingCount[endingsFound] : strings.page[page - 1]
  useLayoutEffect(() => {
    if (pendingFocus.current !== token) return
    pendingFocus.current = null
    header.current?.scrollIntoView({ block: 'start' })
    firstParagraph.current?.focus({ preventScroll: true })
    if (announcement !== undefined) announce(announcement)
  }, [token, announcement])

  useLayoutEffect(() => {
    if (settlingToken.current !== token) return
    const timer = window.setTimeout(() => {
      settlingToken.current = null
      setSettling(null)
    }, SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [token, holds])

  // Step 11 N27: the release of the narration hold (declared after the settle, so it runs after
  // it). A new hold (narrationHolds) clears the running timer and starts a new SETTLE_MS one; a new
  // part or an unmount clears it. The callback releases only its own hold (the id), so an old timer
  // never releases a newer hold, even if a commit came after the old timer's task.
  useLayoutEffect(() => {
    if (narrationHeldToken.current !== token) return
    const id = narrationHolds
    const timer = window.setTimeout(() => {
      if (narrationHoldId.current !== id) return
      narrationHeldToken.current = null
      setNarrationHeld(null)
    }, SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [token, narrationHolds])

  // Step 11 N27: an applied narration tap holds the rest of the run area for SETTLE_MS (the
  // choices, Back, the ending card's actions and the AI voice link), never the footer, the group or
  // the narration buttons, so focus stays; it writes no storage and announces nothing.
  const holdRunArea = (): void => {
    narrationHoldId.current += 1
    const held = tokenOf(controller.getSnapshot().state)
    narrationHeldToken.current = held
    setNarrationHeld(held)
    setNarrationHolds(narrationHoldId.current)
  }

  // The restart dialog closed with no accepted restart (Keep reading, Escape): the run area is held
  // for SETTLE_MS like a step, through isInteractive and inert, so the second tap of a double tap
  // never lands on a choice or Back under the dialog (D11-P7 amended at 10b, R2-STRESS-1). The
  // header (Menu, Exit) is not held; the menu's Start again is ignored until the same timer
  // releases the run area, so that tap never reopens the dialog either (startAgainHeld, T-b10).
  const hold = (): void => {
    const held = tokenOf(controller.getSnapshot().state)
    settlingToken.current = held
    cancelledToken.current = held
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
  // Try another path: RESTART from the run area, no dialog, held by the settle (D11-P11, P7).
  const tryAnother = (seq: number): StepResult => actions.current?.restart(seq) ?? refused()
  // The story-language switch: SET_LOCALE from the header, never held by the settle (D11-P4).
  // Step 11 (N6): with Read to me on, the same part's clip in the new language plays (or cues, or
  // stops when missing) inside the switch tap, before the switch's save (a microtask).
  const setLocale = (target: LocaleCode): StepResult => {
    const result = actions.current?.setLocale(target) ?? refused()
    if (result.accepted) narration.onSwitch(narrationPartOf(data, result.state))
    return result
  }

  // Step 11 (N3, N9, N17, N27): Read to me. The session calls the controller first (play, or stop
  // at any status), then the pref is written, so the choice carries to other stories, then the run
  // area is held; a held tap writes nothing and holds nothing. With storage blocked the prefs use
  // memory: it plays and is not remembered.
  const toggleNarration = (): void => {
    const on = narration.toggle(narrationPartOf(data, controller.getSnapshot().state))
    if (on === null) return
    prefs.update({ readToMe: on })
    holdRunArea()
  }
  // Step 11 (N2, N8 to N10, N27): Pause, Resume, Play again or Tap to listen, for the part on
  // screen; an applied one holds the run area, a held or false one does not.
  const playNarration = (kind: NarrationPlayback): void => {
    if (narration.playback(kind, narrationPartOf(data, controller.getSnapshot().state))) {
      holdRunArea()
    }
  }

  // Start again from the menu or its dialog: RESTART, not held by the settle; an accepted one
  // closes the menu (D11-P11, P19, C13).
  const restart = (seq: number): boolean => {
    const result = actions.current?.menuRestart(seq) ?? refused()
    if (result.accepted) setMenuOpen(false)
    return result.accepted
  }

  // The menu's Start again: the dialog only while reading with more than 2 pages (V1 D-71). Ignored
  // during the hold after a dialog cancel (startAgainHeld); focus stays where the cancel put it.
  const startAgain = (seq: number): void => {
    if (startAgainHeld(cancelledToken.current, settlingToken.current)) return
    const { status, path } = controller.getSnapshot().state
    if (status === 'reading' && path.length > 2) setConfirmOpen(true)
    else restart(seq)
  }

  const endReveal = (): void => {
    if (animated === token && revealDone !== token) setRevealDone(token)
  }

  // N27: the run footer is live unless opening or settling; the narration hold holds the choices,
  // Back, the ending card's actions and the AI voice link only.
  const { interactive, held } = partHoldOf({ opening, token, settling, narrationHeld })

  return (
    <div data-player="" data-run-phase={snapshot.phase} className={styles.player}>
      <TextScaleSync prefs={prefs} />
      <PlayerHeader
        ref={header}
        locale={locale}
        allStories={strings.allStories}
        navLabel={strings.navLabel}
        grownUps={strings.grownUps}
        languageSwitch={
          languageTarget === null ? null : (
            <StoryLanguageSwitch
              target={languageTarget}
              label={strings.storyLanguage}
              opening={opening}
              onSwitch={setLocale}
            />
          )
        }
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
          data-scene={sceneIdOf(view.scene)}
          className={styles.runDependent}
          onPointerDown={endReveal}
          onKeyDown={endReveal}
        >
          <StoryPart
            key={token}
            view={view}
            interactive={interactive}
            held={held}
            animate={animated === token}
            revealDone={revealDone === token}
            firstParagraphRef={firstParagraph}
            onChoose={choose}
            backLabel={strings.back}
            onBack={back}
            narration={
              narrationOffered ? (
                <NarrationControls
                  locale={locale}
                  display={narrationDisplay}
                  strings={strings}
                  onToggle={toggleNarration}
                  onPlayback={playNarration}
                  linkHeld={held}
                />
              ) : null
            }
            image={
              image === null ? null : (
                <SceneImage
                  image={image}
                  failed={failedImages.includes(image.id)}
                  onFailed={markFailed}
                />
              )
            }
            ending={
              view.ending ? (
                <EndingCard
                  view={view}
                  storyId={data.storyId}
                  locale={locale}
                  strings={strings}
                  count={strings.endingCount[endingsFound] ?? ''}
                  interactive={interactive && !held}
                  onTryAnother={tryAnother}
                />
              ) : null
            }
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
