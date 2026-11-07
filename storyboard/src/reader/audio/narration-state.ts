// Narration status reducer (spec §6.4). Pure: no DOM, React, storage or timers.
// The controller feeds it its own commands, play() outcomes and media events. Every element-driven
// action carries a reading of the element taken when it is handled, so a late or stale event is
// judged against what the element is doing now, not against what it was doing when it was queued.

export const NARRATION_STATUSES = [
  'idle',
  'loading',
  'playing',
  'buffering',
  'paused',
  'ended',
  'blocked',
  'unavailable',
] as const

export type NarrationStatus = (typeof NARRATION_STATUSES)[number]

/** HTMLMediaElement.HAVE_FUTURE_DATA: enough data to play forward from the current position. */
export const HAVE_FUTURE_DATA = 3

/** MediaError.MEDIA_ERR_ABORTED: the fetch was aborted. Like AbortError, it never means unavailable. */
export const MEDIA_ERR_ABORTED = 1

/** The element's live state at the moment an event or outcome is handled. */
export interface MediaReading {
  /** The src attribute exactly as the controller set it; null after stop. */
  readonly src: string | null
  readonly paused: boolean
  readonly ended: boolean
  readonly seeking: boolean
  readonly readyState: number
  readonly networkState: number
  readonly currentTime: number
  /** element.error?.code, or null when the element has no error. */
  readonly errorCode: number | null
}

export interface NarrationState {
  readonly status: NarrationStatus
  /** Goes up on every play, cue, resume, pause and stop. play() outcomes of older generations are dropped. */
  readonly generation: number
  readonly url: string | null
  /** The caller's request token, `${runEpoch}:${seq}` in the player (spec §6.4). */
  readonly token: string | null
  /** currentTime at the last accepted media event; "time moving" is measured against it. */
  readonly lastTime: number
  /** Goes up each time buffering starts, so a timeout armed for an earlier stall is dropped. */
  readonly bufferingEpisode: number
}

export type NarrationAction =
  | { readonly type: 'play'; readonly url: string; readonly token: string }
  | { readonly type: 'cue'; readonly url: string; readonly token: string }
  | { readonly type: 'resume' }
  | { readonly type: 'pause' }
  | { readonly type: 'stop' }
  | { readonly type: 'playResolved'; readonly generation: number; readonly reading: MediaReading }
  | {
      readonly type: 'playRejected'
      readonly generation: number
      readonly errorName: string
      readonly reading: MediaReading
    }
  | { readonly type: 'media'; readonly event: string; readonly reading: MediaReading }
  | { readonly type: 'resync'; readonly reading: MediaReading }
  | { readonly type: 'bufferingTimeout'; readonly generation: number; readonly episode: number }

export interface NarrationTransition {
  readonly state: NarrationState
  /** False when the action was stale or not about the current request; state is then unchanged. */
  readonly accepted: boolean
}

export const INITIAL_NARRATION_STATE: NarrationState = {
  status: 'idle',
  generation: 0,
  url: null,
  token: null,
  lastTime: 0,
  bufferingEpisode: 0,
}

/** loading, playing and buffering: the element has been asked to play and was not paused since. */
export function isActiveStatus(status: NarrationStatus): boolean {
  return status === 'loading' || status === 'playing' || status === 'buffering'
}

function isStarting(status: NarrationStatus): boolean {
  return status === 'loading' || status === 'buffering'
}

function isWaitingForTap(status: NarrationStatus): boolean {
  return status === 'paused' || status === 'ended' || status === 'blocked'
}

const applied = (state: NarrationState): NarrationTransition => ({ state, accepted: true })
const ignored = (state: NarrationState): NarrationTransition => ({ state, accepted: false })

function nextGeneration(state: NarrationState, patch: Partial<NarrationState>): NarrationState {
  return { ...state, ...patch, generation: state.generation + 1 }
}

/** Moves to a status; entering buffering starts a new episode. Returns the same object when unchanged. */
function enter(state: NarrationState, status: NarrationStatus): NarrationState {
  if (state.status === status) return state
  const bufferingEpisode =
    status === 'buffering' ? state.bufferingEpisode + 1 : state.bufferingEpisode
  return { ...state, status, bufferingEpisode }
}

function withTime(state: NarrationState, currentTime: number): NarrationState {
  return state.lastTime === currentTime ? state : { ...state, lastTime: currentTime }
}

/** An element reading is about the current request only while one is loaded and src still matches. */
function isCurrentSource(state: NarrationState, reading: MediaReading): boolean {
  return state.status !== 'idle' && state.url !== null && reading.src === state.url
}

function statusAfterEvent(
  state: NarrationState,
  event: string,
  reading: MediaReading,
): NarrationStatus {
  const { status } = state
  switch (event) {
    case 'waiting':
      return isActiveStatus(status) && !reading.paused ? 'buffering' : status
    case 'stalled':
      // A stall with data in hand is the network idling, not the listener waiting.
      return isActiveStatus(status) && !reading.paused && reading.readyState < HAVE_FUTURE_DATA
        ? 'buffering'
        : status
    case 'playing':
      return reading.paused ? status : 'playing'
    case 'canplay':
      return isStarting(status) && !reading.paused ? 'playing' : status
    case 'timeupdate': {
      const moving = !reading.seeking && reading.currentTime > state.lastTime
      return isStarting(status) && !reading.paused && moving ? 'playing' : status
    }
    case 'play':
      // Started by the system (lock screen, headset) rather than by a command.
      return isWaitingForTap(status) && !reading.paused ? 'loading' : status
    case 'pause':
      if (!reading.paused || !isActiveStatus(status)) return status
      return reading.ended ? 'ended' : 'paused'
    case 'ended':
      return reading.ended ? 'ended' : status
    case 'error':
      return reading.errorCode !== null && reading.errorCode !== MEDIA_ERR_ABORTED
        ? 'unavailable'
        : status
    default:
      return status
  }
}

function onMediaEvent(
  state: NarrationState,
  event: string,
  reading: MediaReading,
): NarrationTransition {
  if (!isCurrentSource(state, reading)) return ignored(state)
  const moved = enter(state, statusAfterEvent(state, event, reading))
  return applied(withTime(moved, reading.currentTime))
}

function onPlayResolved(
  state: NarrationState,
  generation: number,
  reading: MediaReading,
): NarrationTransition {
  if (generation !== state.generation) return ignored(state)
  return applied(isStarting(state.status) && !reading.paused ? enter(state, 'playing') : state)
}

function onPlayRejected(
  state: NarrationState,
  generation: number,
  errorName: string,
  reading: MediaReading,
): NarrationTransition {
  // A superseded, paused or stopped request rejects with AbortError on an older generation.
  if (generation !== state.generation) return ignored(state)
  if (errorName === 'NotAllowedError') return applied(enter(state, 'blocked'))
  if (errorName === 'NotSupportedError') return applied(enter(state, 'unavailable'))
  // AbortError or anything else on the current generation is never "unavailable": the element decides.
  return applied(reading.paused && isActiveStatus(state.status) ? enter(state, 'paused') : state)
}

/** After the page was hidden, frozen or restored, the element is the truth. */
function onResync(state: NarrationState, reading: MediaReading): NarrationTransition {
  if (!isCurrentSource(state, reading)) return ignored(state)
  const { status } = state
  let next = status
  if (reading.paused && reading.ended && (isActiveStatus(status) || status === 'paused')) {
    next = 'ended'
  } else if (reading.paused && isActiveStatus(status)) {
    next = 'paused'
  } else if (!reading.paused && isWaitingForTap(status)) {
    next = reading.readyState >= HAVE_FUTURE_DATA ? 'playing' : 'buffering'
  }
  return applied(withTime(enter(state, next), reading.currentTime))
}

function onBufferingTimeout(
  state: NarrationState,
  generation: number,
  episode: number,
): NarrationTransition {
  const current =
    generation === state.generation &&
    episode === state.bufferingEpisode &&
    state.status === 'buffering'
  return current ? applied(enter(state, 'unavailable')) : ignored(state)
}

export function reduceNarration(
  state: NarrationState,
  action: NarrationAction,
): NarrationTransition {
  switch (action.type) {
    case 'play':
      return applied(
        nextGeneration(state, {
          status: 'loading',
          url: action.url,
          token: action.token,
          lastTime: 0,
        }),
      )
    case 'cue':
      // "Tap to listen": the clip waits for a tap, shown the same way as a refused play().
      return applied(
        nextGeneration(state, {
          status: 'blocked',
          url: action.url,
          token: action.token,
          lastTime: 0,
        }),
      )
    case 'resume':
      if (state.url === null) return ignored(state)
      return applied(nextGeneration(state, { status: 'loading' }))
    case 'pause':
      return applied(
        nextGeneration(state, { status: isActiveStatus(state.status) ? 'paused' : state.status }),
      )
    case 'stop':
      return applied(nextGeneration(state, { status: 'idle', url: null, token: null, lastTime: 0 }))
    case 'playResolved':
      return onPlayResolved(state, action.generation, action.reading)
    case 'playRejected':
      return onPlayRejected(state, action.generation, action.errorName, action.reading)
    case 'media':
      return onMediaEvent(state, action.event, action.reading)
    case 'resync':
      return onResync(state, action.reading)
    case 'bufferingTimeout':
      return onBufferingTimeout(state, action.generation, action.episode)
  }
}

/** Seek target in seconds: never below 0, never past a known duration; null for a non-finite request. */
export function clampSeekTarget(seconds: number, duration: number): number | null {
  if (!Number.isFinite(seconds)) return null
  const atLeastZero = Math.max(0, seconds)
  return Number.isFinite(duration) && duration >= 0 ? Math.min(atLeastZero, duration) : atLeastZero
}
