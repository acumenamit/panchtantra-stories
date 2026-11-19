// Narration in the player (Step 11, P1-5a; design p1-step11-design.md §4.2 to §4.6, N3 to N12,
// N15, N17, N19, N20; spec §6.4). Framework-free and inside the player fence: no request, no clock,
// no user agent. It wraps the controller (src/reader/audio/narration-controller.ts, unchanged), which
// owns the one audio element and creates it inside the first tap that plays.
// - createNarrationSession({ data }): the Player keeps one session for the page, above the run
//   area's key, so a restart remount keeps it. It is a stable store for useSyncExternalStore
//   (getSnapshot, subscribe): { on, status, token, url }, one object until a field changes, with
//   the controller's status, token and url ('idle' and nulls while detached). Nothing touches the
//   document or the window until a tap, so it can be created during a server render.
// - attach() creates one controller (in the Player's layout effect) and returns a detach that
//   disposes it. dispose is final, so a detach followed by a new attach (StrictMode, Fast Refresh)
//   gets a fresh controller. While detached every command does nothing.
// - Every command runs synchronously inside the caller's tap, so play() is inside the gesture and
//   before any storage write of that tap (4.6):
//   - onStep(result): only for a result with an audio effect (CHOOSE, BACK, RESTART; an ending
//     too); with Read to me on, advanceInGesture with the destination's clip and tokenOf(state)
//     (plays in play-on-choice, cues in tap-to-listen), or stop() when it has no clip. A result
//     without one (SET_LOCALE) makes no call.
//   - onSwitch(part): after an accepted story-language switch, with Read to me on, the same part's
//     clip in the new language (advanceInGesture: same token, new url) or stop() when missing.
//   - toggle(part): Read to me. On: playInGesture of the part's clip (none when it has no clip);
//     off: stop(), at any status, Ended included. Returns the new value; the Player writes the
//     pref after it.
//   - playback(kind, part): Pause → pause(); Resume and Play again → resumeInGesture() (play() on an
//     ended element starts it from 0); Tap to listen → playInGesture of the part's clip.
//   - setOn(on): the open-time value from prefs.readToMe; no controller call.
// - The hold (N17): a toggle or playback tap within holdMs (SETTLE_MS) of the last applied one is
//   ignored: no controller call, no new timer. A timer releases it (never a clock read). Steps and
//   switches are never held.
// - narrationDisplayOf(snapshot, part): what the run footer shows (the 4.4 table). The snapshot is
//   about this part only when its token AND its url match (a switch keeps the token).
// - narrationAnnouncementOf: the once-per-run decision for the unavailable message (N10); the
//   Player calls it SETTLE_MS after the message appeared.
// - NARRATION_MODE is the one mode switch (N20): the spec's fallback "Tap to listen on every node"
//   is this constant set to 'tap-to-listen', for every device (no user-agent detection).
// Imports are relative (C15): Vitest has no `@/` alias.
import { currentNodeId, type EngineState, type StepResult } from '../../core/engine'
import type { LocaleCode } from '../../core/locales'
import {
  createNarrationController,
  type NarrationController,
  type NarrationMode,
} from '../audio/narration-controller'
import type { NarrationStatus } from '../audio/narration-state'
import type { PlayerData } from './player-data'
import { SETTLE_MS, tokenOf } from './view'

/** play-on-choice: a step with Read to me on plays the next clip in its tap (SPEC:716 T1, T2). */
export const NARRATION_MODE: NarrationMode = 'play-on-choice'

/** The Grown-ups section the AI voice byline links to (Step 21 gives the section this id, H-21). */
export const HOW_STORIES_ARE_MADE_ID = 'how-stories-are-made'

/** The playback button's kinds. */
export type NarrationPlayback = 'pause' | 'resume' | 'play-again' | 'tap-to-listen'

/** The playback button's labels, in this fixed order in its reserved box (N26). */
export const NARRATION_PLAYBACKS: readonly NarrationPlayback[] = [
  'pause',
  'resume',
  'play-again',
  'tap-to-listen',
]

/** The part on screen: its clip in the run's language (null: none) and its token. */
export interface NarrationPart {
  readonly url: string | null
  readonly token: string
}

export interface NarrationSessionSnapshot {
  readonly on: boolean
  /** The controller's status; 'idle' while detached. */
  readonly status: NarrationStatus
  readonly token: string | null
  readonly url: string | null
}

export type NarrationMessage = 'loading' | 'unavailable'

/** What the run footer's narration group shows (design §4.4). */
export interface NarrationDisplay {
  readonly on: boolean
  /** data-status: the status when the snapshot is about this part, else 'idle'. */
  readonly status: NarrationStatus
  /** The playback button's kind, or null: no button. */
  readonly playback: NarrationPlayback | null
  /** Tap to listen pulses (a refused play, or tap-to-listen mode's cue). */
  readonly pulse: boolean
  readonly message: NarrationMessage | null
}

export interface NarrationSession {
  /** The same object until on, status, token or url changes. */
  getSnapshot(): NarrationSessionSnapshot
  subscribe(listener: () => void): () => void
  /** Creates one controller; the returned detach disposes it. */
  attach(): () => void
  /** The open-time value of Read to me (prefs.readToMe); no controller call. */
  setOn(on: boolean): void
  /** Read to me: the new value, or null when held or detached (no call). */
  toggle(part: NarrationPart): boolean | null
  /** Every accepted result: acts only on an audio effect, and only with Read to me on. */
  onStep(result: StepResult): void
  /** After an accepted story-language switch: the part in its new language. */
  onSwitch(part: NarrationPart): void
  /** The playback button: false when held, off or detached (no call). */
  playback(kind: NarrationPlayback, part: NarrationPart): boolean
}

export interface NarrationSessionOptions {
  readonly data: PlayerData
  /** Tests; defaults to createNarrationController({ mode: NARRATION_MODE }). */
  readonly createController?: () => NarrationController
  /** Defaults to SETTLE_MS. */
  readonly holdMs?: number
  readonly setTimer?: (task: () => void, ms: number) => unknown
  readonly clearTimer?: (id: unknown) => void
}

/** The node's clip in `locale`, or null (no node, or no clip in that language). */
export function narrationUrlOf(
  data: Pick<PlayerData, 'nodes'>,
  nodeId: string,
  locale: LocaleCode,
): string | null {
  const node = data.nodes.find((n) => n.id === nodeId)
  if (node === undefined || !Object.hasOwn(node.narration, locale)) return null
  return node.narration[locale] ?? null
}

/** Whether the story has at least one clip in `locale` (the narration group is shown). */
export function narrationOfferedIn(data: Pick<PlayerData, 'nodes'>, locale: LocaleCode): boolean {
  return data.nodes.some((node) => Object.hasOwn(node.narration, locale))
}

/** The current part: the current node's clip in the run's language, and tokenOf(state). */
export function narrationPartOf(
  data: Pick<PlayerData, 'nodes'>,
  state: EngineState,
): NarrationPart {
  return { url: narrationUrlOf(data, currentNodeId(state), state.locale), token: tokenOf(state) }
}

/** Design §4.4. */
export function narrationDisplayOf(
  snapshot: NarrationSessionSnapshot,
  part: NarrationPart,
): NarrationDisplay {
  const { on } = snapshot
  const none: NarrationDisplay = { on, status: 'idle', playback: null, pulse: false, message: null }
  if (!on) return none
  if (part.url === null) return { ...none, message: 'unavailable' }
  const current = snapshot.token === part.token && snapshot.url === part.url
  const { status } = snapshot
  if (!current || status === 'idle') return { ...none, playback: 'tap-to-listen' }
  switch (status) {
    case 'loading':
    case 'buffering':
      return { ...none, status, playback: 'pause', message: 'loading' }
    case 'playing':
      return { ...none, status, playback: 'pause' }
    case 'paused':
      return { ...none, status, playback: 'resume' }
    case 'ended':
      return { ...none, status, playback: 'play-again' }
    case 'blocked':
      return { ...none, status, playback: 'tap-to-listen', pulse: true }
    case 'unavailable':
      return { ...none, status, playback: 'tap-to-listen', message: 'unavailable' }
  }
}

export interface NarrationAnnouncementInput {
  /** The run the message belongs to. */
  readonly runEpoch: number
  /** The run whose unavailable message was announced already, or null. */
  readonly announcedEpoch: number | null
  /** The part key the message appeared for SETTLE_MS ago, or null. */
  readonly shownFor: string | null
  /** The part key the message shows for now, or null when it shows for none. */
  readonly shownNow: string | null
}

/** Announce now? Only if the message still shows for the same part, once per runEpoch (N10). */
export function narrationAnnouncementOf(input: NarrationAnnouncementInput): boolean {
  const { runEpoch, announcedEpoch, shownFor, shownNow } = input
  return shownFor !== null && shownNow === shownFor && announcedEpoch !== runEpoch
}

const DETACHED = { status: 'idle', token: null, url: null } as const

function sameSnapshot(a: NarrationSessionSnapshot, b: NarrationSessionSnapshot): boolean {
  return a.on === b.on && a.status === b.status && a.token === b.token && a.url === b.url
}

function defaultController(): NarrationController {
  return createNarrationController({ mode: NARRATION_MODE })
}

export function createNarrationSession(options: NarrationSessionOptions): NarrationSession {
  const { data } = options
  const holdMs = options.holdMs ?? SETTLE_MS
  const makeController = options.createController ?? defaultController
  const setTimer =
    options.setTimer ?? ((task: () => void, ms: number): unknown => setTimeout(task, ms))
  const clearTimer =
    options.clearTimer ?? ((id: unknown): void => clearTimeout(id as ReturnType<typeof setTimeout>))

  let controller: NarrationController | null = null
  let on = false
  let holdTimer: unknown = null
  let snapshot: NarrationSessionSnapshot = { on, ...DETACHED }
  const listeners = new Set<() => void>()

  function refresh(): void {
    const reading = controller?.getSnapshot() ?? DETACHED
    const next: NarrationSessionSnapshot = {
      on,
      status: reading.status,
      token: reading.token,
      url: reading.url,
    }
    if (sameSnapshot(snapshot, next)) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  function releaseHold(): void {
    if (holdTimer !== null) clearTimer(holdTimer)
    holdTimer = null
  }

  /** An applied narration tap: the next one within holdMs is ignored. */
  function hold(): void {
    holdTimer = setTimer(() => {
      holdTimer = null
    }, holdMs)
  }

  const held = (): boolean => holdTimer !== null

  function attach(): () => void {
    const own = makeController()
    controller = own
    const unsubscribe = own.subscribe(refresh)
    refresh()
    let attached = true
    return () => {
      if (!attached) return
      attached = false
      unsubscribe()
      if (controller === own) controller = null
      own.dispose()
      releaseHold()
      refresh()
    }
  }

  function setOn(next: boolean): void {
    on = next
    refresh()
  }

  function toggle(part: NarrationPart): boolean | null {
    if (controller === null || held()) return null
    on = !on
    if (!on) controller.stop()
    else if (part.url !== null) controller.playInGesture(part.url, part.token)
    hold()
    refresh()
    return on
  }

  /** Plays or cues `url` in the tap, or stops when the part has no clip. */
  function advance(url: string | null, token: string): void {
    if (controller === null || !on) return
    if (url === null) controller.stop()
    else controller.advanceInGesture(url, token)
  }

  function onStep(result: StepResult): void {
    for (const effect of result.effects) {
      if (effect.type !== 'audio') continue
      advance(narrationUrlOf(data, effect.nodeId, effect.locale), tokenOf(result.state))
      return
    }
  }

  function onSwitch(part: NarrationPart): void {
    advance(part.url, part.token)
  }

  function playback(kind: NarrationPlayback, part: NarrationPart): boolean {
    if (controller === null || !on || held()) return false
    switch (kind) {
      case 'pause':
        controller.pause()
        break
      case 'resume':
      case 'play-again':
        controller.resumeInGesture()
        break
      case 'tap-to-listen':
        if (part.url === null) return false
        controller.playInGesture(part.url, part.token)
        break
    }
    hold()
    refresh()
    return true
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    attach,
    setOn,
    toggle,
    onStep,
    onSwitch,
    playback,
  }
}
