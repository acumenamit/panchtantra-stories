// Narration controller (spec §6.4): owns the one audio element of a player.
// - The element is created inside the first tap, never attached to the page, with preload="none"
//   and no crossorigin attribute.
// - playInGesture sets src and calls play() synchronously inside the tap: no await and no load().
// - Status comes from narration-state.ts; getSnapshot/subscribe fit React's useSyncExternalStore.
// - Nothing touches document or window before the first tap, so it can be created during render.
import {
  INITIAL_NARRATION_STATE,
  MEDIA_ERR_ABORTED,
  clampSeekTarget,
  isActiveStatus,
  reduceNarration,
  type MediaReading,
  type NarrationAction,
  type NarrationState,
  type NarrationStatus,
} from './narration-state'

/** play-on-choice: a choice tap plays the next clip. tap-to-listen: it waits for a "Tap to listen" tap. */
export type NarrationMode = 'play-on-choice' | 'tap-to-listen'

export const DEFAULT_BUFFERING_TIMEOUT_MS = 20_000

export interface TimeRangesLike {
  readonly length: number
  start(index: number): number
  end(index: number): number
}

/** The part of HTMLMediaElement the controller uses. HTMLAudioElement satisfies it. */
export interface NarrationMediaElement extends EventTarget {
  preload: 'none' | 'metadata' | 'auto' | ''
  currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly ended: boolean
  readonly seeking: boolean
  readonly readyState: number
  readonly networkState: number
  readonly error: { readonly code: number } | null
  readonly buffered: TimeRangesLike
  readonly seekable: TimeRangesLike
  play(): Promise<void>
  pause(): void
  load(): void
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  hasAttribute(name: string): boolean
}

/** Where visibilitychange and pageshow come from (document and window in a browser). */
export interface LifecycleTargets {
  readonly document: EventTarget & { readonly visibilityState: string }
  readonly window: EventTarget
}

export type TimeRange = readonly [start: number, end: number]

export interface PlaybackReadout {
  readonly currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly readyState: number
  readonly networkState: number
  readonly errorCode: number | null
  readonly buffered: readonly TimeRange[]
  readonly seekable: readonly TimeRange[]
}

export interface NarrationSnapshot {
  readonly status: NarrationStatus
  readonly token: string | null
  readonly url: string | null
  readonly mode: NarrationMode
}

export type NarrationCommand =
  'play' | 'cue' | 'resume' | 'pause' | 'stop' | 'resync' | 'set-mode' | 'dispose'

interface DiagnosticBase {
  /** Milliseconds from the controller's clock (performance.now() by default). */
  readonly at: number
  readonly generation: number
  readonly from: NarrationStatus
  readonly status: NarrationStatus
}

type DiagnosticDetail =
  | {
      readonly kind: 'command'
      readonly command: NarrationCommand
      readonly url: string | null
      readonly token: string | null
      /** False when the command changed nothing (already playing that token, nothing to resume). */
      readonly applied: boolean
    }
  | {
      readonly kind: 'play-result'
      readonly outcome: 'resolved' | 'rejected'
      readonly errorName: string | null
      readonly forGeneration: number
      readonly accepted: boolean
    }
  | {
      readonly kind: 'media'
      readonly event: string
      readonly accepted: boolean
      readonly reading: MediaReading
    }
  | {
      readonly kind: 'lifecycle'
      readonly event: 'visibilitychange' | 'pageshow'
      readonly visibilityState: string
      readonly persisted: boolean | null
      readonly accepted: boolean
    }
  | {
      readonly kind: 'seek'
      readonly requested: number
      readonly target: number
      readonly duration: number
      readonly buffered: readonly TimeRange[]
      readonly seekable: readonly TimeRange[]
    }
  | { readonly kind: 'buffering-timeout'; readonly accepted: boolean }

export type NarrationDiagnostic = DiagnosticBase & DiagnosticDetail

export interface NarrationControllerOptions {
  readonly mode?: NarrationMode
  /** How long buffering may last before the clip counts as unavailable. */
  readonly bufferingTimeoutMs?: number
  /** Feeds the spike log; does nothing by default. */
  readonly onDiagnostic?: (entry: NarrationDiagnostic) => void
  /** Defaults to a detached document.createElement('audio'). */
  readonly createElement?: () => NarrationMediaElement
  /** Defaults to the page's document and window; null turns lifecycle resync off. */
  readonly lifecycle?: LifecycleTargets | null
  readonly now?: () => number
}

export interface NarrationController {
  /** Call inside a tap handler. Sets src and calls play() synchronously. */
  playInGesture(url: string, token: string): void
  /** Call inside a choice, Back or Restart tap with Read to me on; follows the mode. */
  advanceInGesture(url: string, token: string): void
  /** Call inside a tap ("Resume", "Tap to listen"). False when there is nothing to resume. */
  resumeInGesture(): boolean
  pause(): void
  /** Pause, then removeAttribute('src'), then load(): the download stops too. */
  stop(): void
  /** Clamped to 0 and the known duration. False when no clip is loaded. */
  seekTo(seconds: number): boolean
  seekBy(deltaSeconds: number): boolean
  /** Re-reads the element; also runs on visibilitychange and pageshow. */
  resync(): void
  setMode(mode: NarrationMode): void
  getSnapshot(): NarrationSnapshot
  subscribe(listener: () => void): () => void
  /** Live element values for readouts; null before the first tap. */
  getPlayback(): PlaybackReadout | null
  /** Stops and releases everything. Final: later calls do nothing. */
  dispose(): void
}

/** Every event the controller listens to; the reducer acts on some, all reach the diagnostics. */
export const MEDIA_EVENTS = [
  'loadstart',
  'suspend',
  'abort',
  'error',
  'emptied',
  'stalled',
  'loadedmetadata',
  'loadeddata',
  'canplay',
  'canplaythrough',
  'playing',
  'waiting',
  'seeking',
  'seeked',
  'ended',
  'durationchange',
  'timeupdate',
  'progress',
  'play',
  'pause',
] as const

export function readMedia(media: NarrationMediaElement): MediaReading {
  return {
    src: media.getAttribute('src'),
    paused: media.paused,
    ended: media.ended,
    seeking: media.seeking,
    readyState: media.readyState,
    networkState: media.networkState,
    currentTime: media.currentTime,
    errorCode: media.error?.code ?? null,
  }
}

export function toRanges(ranges: TimeRangesLike): TimeRange[] {
  const out: TimeRange[] = []
  for (let i = 0; i < ranges.length; i++) out.push([ranges.start(i), ranges.end(i)])
  return out
}

/** The DOMException name of a play() rejection ("NotAllowedError", "AbortError", ...). */
export function errorNameOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error
    if (typeof name === 'string' && name !== '') return name
  }
  return 'UnknownError'
}

function persistedOf(event: Event): boolean | null {
  return 'persisted' in event && typeof event.persisted === 'boolean' ? event.persisted : null
}

function createDetachedAudio(): NarrationMediaElement {
  return document.createElement('audio')
}

function pageLifecycle(): LifecycleTargets | null {
  return typeof document === 'undefined' || typeof window === 'undefined'
    ? null
    : { document, window }
}

function noop(): void {}

function toSnapshot(state: NarrationState, mode: NarrationMode): NarrationSnapshot {
  return { status: state.status, token: state.token, url: state.url, mode }
}

function sameSnapshot(a: NarrationSnapshot, b: NarrationSnapshot): boolean {
  return a.status === b.status && a.token === b.token && a.url === b.url && a.mode === b.mode
}

/** Stops audio and any download: the plan's stop sequence. */
function releaseSource(media: NarrationMediaElement): void {
  media.pause()
  media.removeAttribute('src')
  media.load()
}

/**
 * Whether resume must set src again: only when the source was released or replaced, or failed.
 * Setting src runs the media load algorithm, which drops the downloaded data and goes back to 0, so
 * a source that is only slow (a buffering timeout, with no element error) keeps its data and position.
 */
export function mustReloadSource(
  media: Pick<NarrationMediaElement, 'getAttribute' | 'error'>,
  url: string,
  playRefusedAsUnsupported: boolean,
): boolean {
  if (media.getAttribute('src') !== url) return true
  const failed = media.error !== null && media.error.code !== MEDIA_ERR_ABORTED
  return failed || playRefusedAsUnsupported
}

export function createNarrationController(
  options: NarrationControllerOptions = {},
): NarrationController {
  const bufferingTimeoutMs = options.bufferingTimeoutMs ?? DEFAULT_BUFFERING_TIMEOUT_MS
  const report = options.onDiagnostic ?? noop
  const now = options.now ?? (() => performance.now())
  const createElement = options.createElement ?? createDetachedAudio

  let mode: NarrationMode = options.mode ?? 'play-on-choice'
  let state: NarrationState = INITIAL_NARRATION_STATE
  let snapshot = toSnapshot(state, mode)
  let element: NarrationMediaElement | null = null
  let lifecycle: LifecycleTargets | null = null
  let bufferingTimer: ReturnType<typeof setTimeout> | null = null
  /** play() on the current src was refused with NotSupportedError; cleared whenever src changes. */
  let playRefusedAsUnsupported = false
  let disposed = false
  const listeners = new Set<() => void>()
  // Diagnostics wait until state, timers and subscribers are consistent, then go out in order.
  const pending: NarrationDiagnostic[] = []

  function transition(action: NarrationAction): { accepted: boolean; from: NarrationStatus } {
    const previous = state
    const result = reduceNarration(previous, action)
    state = result.state
    syncBufferingTimer(previous)
    return { accepted: result.accepted, from: previous.status }
  }

  function note(from: NarrationStatus, detail: DiagnosticDetail): void {
    pending.push({ at: now(), generation: state.generation, from, status: state.status, ...detail })
  }

  function flush(): void {
    const next = toSnapshot(state, mode)
    if (!sameSnapshot(snapshot, next)) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    }
    for (const entry of pending.splice(0)) report(entry)
  }

  function clearBufferingTimer(): void {
    if (bufferingTimer !== null) clearTimeout(bufferingTimer)
    bufferingTimer = null
  }

  function armBufferingTimer(): void {
    clearBufferingTimer()
    const { generation, bufferingEpisode } = state
    bufferingTimer = setTimeout(
      () => onBufferingTimeout(generation, bufferingEpisode),
      bufferingTimeoutMs,
    )
  }

  function syncBufferingTimer(previous: NarrationState): void {
    if (state.status !== 'buffering') {
      clearBufferingTimer()
      return
    }
    const newEpisode =
      previous.status !== 'buffering' || previous.bufferingEpisode !== state.bufferingEpisode
    if (newEpisode) armBufferingTimer()
  }

  function pageHidden(): boolean {
    return lifecycle?.document.visibilityState === 'hidden'
  }

  function onBufferingTimeout(generation: number, episode: number): void {
    bufferingTimer = null
    if (disposed) return
    // Time spent hidden or locked does not count against the clip; the clock restarts.
    if (pageHidden()) {
      armBufferingTimer()
      return
    }
    const { accepted, from } = transition({ type: 'bufferingTimeout', generation, episode })
    note(from, { kind: 'buffering-timeout', accepted })
    flush()
  }

  function onMediaEvent(event: Event): void {
    if (disposed || element === null) return
    const reading = readMedia(element)
    const { accepted, from } = transition({ type: 'media', event: event.type, reading })
    note(from, { kind: 'media', event: event.type, accepted, reading })
    flush()
  }

  function resyncWithElement(): { accepted: boolean; from: NarrationStatus } {
    if (element === null) return { accepted: false, from: state.status }
    const result = transition({ type: 'resync', reading: readMedia(element) })
    if (state.status === 'buffering') armBufferingTimer()
    return result
  }

  function onLifecycle(event: 'visibilitychange' | 'pageshow', persisted: boolean | null): void {
    if (disposed) return
    const { accepted, from } = resyncWithElement()
    const visibilityState = lifecycle?.document.visibilityState ?? 'unknown'
    note(from, { kind: 'lifecycle', event, visibilityState, persisted, accepted })
    flush()
  }

  function onVisibilityChange(): void {
    onLifecycle('visibilitychange', null)
  }

  function onPageShow(event: Event): void {
    onLifecycle('pageshow', persistedOf(event))
  }

  function attachLifecycle(): void {
    lifecycle = options.lifecycle === undefined ? pageLifecycle() : options.lifecycle
    lifecycle?.document.addEventListener('visibilitychange', onVisibilityChange)
    lifecycle?.window.addEventListener('pageshow', onPageShow)
  }

  function detachLifecycle(): void {
    lifecycle?.document.removeEventListener('visibilitychange', onVisibilityChange)
    lifecycle?.window.removeEventListener('pageshow', onPageShow)
    lifecycle = null
  }

  function setSource(media: NarrationMediaElement, url: string): void {
    playRefusedAsUnsupported = false
    media.setAttribute('src', url)
  }

  function clearSource(media: NarrationMediaElement): void {
    playRefusedAsUnsupported = false
    releaseSource(media)
  }

  function ensureElement(): NarrationMediaElement {
    if (element !== null) return element
    const media = createElement()
    media.preload = 'none'
    if (media.hasAttribute('crossorigin')) media.removeAttribute('crossorigin')
    for (const name of MEDIA_EVENTS) media.addEventListener(name, onMediaEvent)
    element = media
    attachLifecycle()
    return media
  }

  /** play() is called right here, in the caller's tap; its outcome is judged by generation. */
  function startPlayback(media: NarrationMediaElement): void {
    const generation = state.generation
    let attempt: Promise<void>
    try {
      attempt = media.play()
    } catch (error) {
      attempt = Promise.reject(error)
    }
    void attempt.then(
      () => onPlaySettled(generation, null),
      (error: unknown) => onPlaySettled(generation, errorNameOf(error)),
    )
  }

  function onPlaySettled(generation: number, errorName: string | null): void {
    if (disposed || element === null) return
    const reading = readMedia(element)
    const action: NarrationAction =
      errorName === null
        ? { type: 'playResolved', generation, reading }
        : { type: 'playRejected', generation, errorName, reading }
    const { accepted, from } = transition(action)
    if (accepted && errorName === 'NotSupportedError') playRefusedAsUnsupported = true
    const outcome = errorName === null ? 'resolved' : 'rejected'
    note(from, { kind: 'play-result', outcome, errorName, forGeneration: generation, accepted })
    flush()
  }

  function noteCommand(
    from: NarrationStatus,
    command: NarrationCommand,
    applied: boolean,
    url = state.url,
    token = state.token,
  ): void {
    note(from, { kind: 'command', command, url, token, applied })
  }

  function isAlreadyPlaying(url: string, token: string): boolean {
    return (
      element !== null &&
      !element.paused &&
      state.url === url &&
      state.token === token &&
      isActiveStatus(state.status)
    )
  }

  function playInGesture(url: string, token: string): void {
    if (disposed) return
    const from = state.status
    if (isAlreadyPlaying(url, token)) {
      noteCommand(from, 'play', false, url, token)
      flush()
      return
    }
    const media = ensureElement()
    transition({ type: 'play', url, token })
    setSource(media, url)
    startPlayback(media)
    noteCommand(from, 'play', true)
    flush()
  }

  function advanceInGesture(url: string, token: string): void {
    if (mode === 'play-on-choice') {
      playInGesture(url, token)
      return
    }
    if (disposed) return
    const from = state.status
    if (element !== null) clearSource(element)
    transition({ type: 'cue', url, token })
    noteCommand(from, 'cue', true)
    flush()
  }

  function resumeInGesture(): boolean {
    if (disposed || state.url === null) return false
    const from = state.status
    const url = state.url
    if (element !== null && !element.paused && isActiveStatus(from)) {
      noteCommand(from, 'resume', false)
      flush()
      return true
    }
    const media = ensureElement()
    // A failed or released source is loaded again; a paused, ended, refused or slow one just plays.
    const reload = mustReloadSource(media, url, playRefusedAsUnsupported)
    transition({ type: 'resume' })
    if (reload) {
      setSource(media, url)
    } else if (!media.paused) {
      // After a buffering timeout the element is still trying. Pausing first makes play() run the
      // element's play steps again, so a fresh "waiting" re-arms the timeout; position is kept.
      media.pause()
    }
    startPlayback(media)
    noteCommand(from, 'resume', true)
    flush()
    return true
  }

  function pause(): void {
    if (disposed) return
    const from = state.status
    element?.pause()
    transition({ type: 'pause' })
    noteCommand(from, 'pause', true)
    flush()
  }

  function stop(): void {
    if (disposed) return
    const from = state.status
    if (element !== null) clearSource(element)
    transition({ type: 'stop' })
    noteCommand(from, 'stop', true)
    flush()
  }

  function seekTo(seconds: number): boolean {
    if (disposed || element === null || element.getAttribute('src') === null) return false
    const target = clampSeekTarget(seconds, element.duration)
    if (target === null) return false
    // Buffered and seekable are read before the jump: "is the target past what was downloaded?"
    note(state.status, {
      kind: 'seek',
      requested: seconds,
      target,
      duration: element.duration,
      buffered: toRanges(element.buffered),
      seekable: toRanges(element.seekable),
    })
    element.currentTime = target
    flush()
    return true
  }

  function seekBy(deltaSeconds: number): boolean {
    if (disposed || element === null) return false
    return seekTo(element.currentTime + deltaSeconds)
  }

  function resync(): void {
    if (disposed) return
    const { accepted, from } = resyncWithElement()
    noteCommand(from, 'resync', accepted)
    flush()
  }

  function setMode(next: NarrationMode): void {
    if (disposed || next === mode) return
    mode = next
    noteCommand(state.status, 'set-mode', true)
    flush()
  }

  function getPlayback(): PlaybackReadout | null {
    if (element === null) return null
    return {
      currentTime: element.currentTime,
      duration: element.duration,
      paused: element.paused,
      readyState: element.readyState,
      networkState: element.networkState,
      errorCode: element.error?.code ?? null,
      buffered: toRanges(element.buffered),
      seekable: toRanges(element.seekable),
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function dispose(): void {
    if (disposed) return
    const from = state.status
    if (element !== null) {
      clearSource(element)
      for (const name of MEDIA_EVENTS) element.removeEventListener(name, onMediaEvent)
    }
    detachLifecycle()
    transition({ type: 'stop' })
    clearBufferingTimer()
    noteCommand(from, 'dispose', true)
    flush()
    disposed = true
    element = null
    listeners.clear()
  }

  return {
    playInGesture,
    advanceInGesture,
    resumeInGesture,
    pause,
    stop,
    seekTo,
    seekBy,
    resync,
    setMode,
    getSnapshot: () => snapshot,
    subscribe,
    getPlayback,
    dispose,
  }
}
