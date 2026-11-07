// Fake HTMLMediaElement for unit tests. Built on EventTarget: no jsdom and no new dependency.
// It follows the parts of the HTML media algorithms the narration code relies on:
// - setting src or calling load() drops the old resource's queued events and rejects pending
//   play() promises with AbortError; removing src alone does not (that is why stop() calls load());
// - play() is refused with NotAllowedError while playPolicy is 'blocked', and with
//   NotSupportedError after a source failure;
// - pause() fires pause and rejects pending play() promises with AbortError in a queued task.
// Events and promise settlements are queued as tasks, like a browser; they run only when the test
// calls flush() or settle(), so tests choose the exact interleaving.
import type { NarrationMediaElement, TimeRangesLike } from '../narration-controller'

export const HAVE_NOTHING = 0
export const HAVE_METADATA = 1
export const HAVE_CURRENT_DATA = 2
export const HAVE_FUTURE_DATA = 3
export const HAVE_ENOUGH_DATA = 4

export const NETWORK_EMPTY = 0
export const NETWORK_IDLE = 1
export const NETWORK_LOADING = 2
export const NETWORK_NO_SOURCE = 3

export const MEDIA_ERR_ABORTED = 1
export const MEDIA_ERR_NETWORK = 2
export const MEDIA_ERR_DECODE = 3
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

export type PlayPolicy = 'allowed' | 'blocked'

type Range = readonly [start: number, end: number]

export class FakeTimeRanges implements TimeRangesLike {
  readonly #ranges: readonly Range[]

  constructor(ranges: readonly Range[] = []) {
    this.#ranges = ranges
  }

  get length(): number {
    return this.#ranges.length
  }

  start(index: number): number {
    return this.#at(index)[0]
  }

  end(index: number): number {
    return this.#at(index)[1]
  }

  #at(index: number): Range {
    const range = this.#ranges[index]
    if (range === undefined) throw new DOMException(`No range at ${index}`, 'IndexSizeError')
    return range
  }
}

interface PendingPlay {
  readonly resolve: () => void
  readonly reject: (error: DOMException) => void
}

interface Task {
  readonly run: () => void
  /** The promise part of the task, run at once if a load drops the task (HTML load algorithm). */
  readonly settlePromises?: () => void
}

function rejectAll(plays: readonly PendingPlay[], name: string, message: string): void {
  for (const play of plays) play.reject(new DOMException(message, name))
}

export class FakeMediaElement extends EventTarget implements NarrationMediaElement {
  preload: 'none' | 'metadata' | 'auto' | '' = 'auto'
  /** 'blocked' refuses play() with NotAllowedError, like a browser outside a user gesture. */
  playPolicy: PlayPolicy = 'allowed'
  /** Calls made by the code under test, in order: "play", "pause", "load", "set src=a.mp3", ... */
  readonly calls: string[] = []

  readonly #attributes = new Map<string, string>()
  #tasks: Task[] = []
  #pendingPlays: PendingPlay[] = []
  #paused = true
  #ended = false
  #seeking = false
  #readyState = HAVE_NOTHING
  #networkState = NETWORK_EMPTY
  #currentTime = 0
  #duration = Number.NaN
  #error: { readonly code: number; readonly message: string } | null = null
  #buffered: readonly Range[] = []
  #seekable: readonly Range[] = []

  get paused(): boolean {
    return this.#paused
  }
  get ended(): boolean {
    return this.#ended
  }
  get seeking(): boolean {
    return this.#seeking
  }
  get readyState(): number {
    return this.#readyState
  }
  get networkState(): number {
    return this.#networkState
  }
  get duration(): number {
    return this.#duration
  }
  get error(): { readonly code: number; readonly message: string } | null {
    return this.#error
  }
  get buffered(): FakeTimeRanges {
    return new FakeTimeRanges(this.#buffered)
  }
  get seekable(): FakeTimeRanges {
    return new FakeTimeRanges(this.#seekable)
  }

  get currentTime(): number {
    return this.#currentTime
  }

  set currentTime(value: number) {
    this.calls.push(`currentTime=${value}`)
    // Before metadata the value is kept as the start position, as in HTML.
    if (this.#readyState === HAVE_NOTHING) {
      this.#currentTime = value
      return
    }
    const end = Number.isFinite(this.#duration) ? this.#duration : value
    this.#currentTime = Math.min(Math.max(0, value), end)
    this.#ended = false
    this.#seeking = true
    this.#queueEvent('seeking')
    this.#queue(() => {
      this.#seeking = false
      this.#fire('timeupdate')
      this.#fire('seeked')
    })
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.#attributes.has(name)
  }

  setAttribute(name: string, value: string): void {
    this.calls.push(`set ${name}=${value}`)
    this.#attributes.set(name, value)
    if (name === 'src') this.#loadAlgorithm()
  }

  removeAttribute(name: string): void {
    this.calls.push(`remove ${name}`)
    this.#attributes.delete(name)
  }

  load(): void {
    this.calls.push('load')
    this.#loadAlgorithm()
  }

  play(): Promise<void> {
    this.calls.push('play')
    if (this.playPolicy === 'blocked') {
      return Promise.reject(new DOMException('play() needs a user gesture', 'NotAllowedError'))
    }
    if (this.#error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED) {
      return Promise.reject(new DOMException('The source is not supported', 'NotSupportedError'))
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    this.#pendingPlays.push({ resolve, reject })
    this.#playSteps()
    return promise
  }

  pause(): void {
    this.calls.push('pause')
    this.#pauseSteps()
  }

  // ---- Test controls: what the network, the decoder or the system would do. ----

  /** Metadata arrived: duration known, readyState HAVE_METADATA. */
  loadMetadata(duration: number): void {
    this.#requireSource('loadMetadata')
    this.#duration = duration
    this.#seekable = [[0, duration]]
    this.#networkState = NETWORK_LOADING
    if (this.#readyState < HAVE_METADATA) this.#readyState = HAVE_METADATA
    this.#queueEvent('durationchange')
    this.#queueEvent('loadedmetadata')
  }

  /** Data arrived up to bufferedEnd seconds; readyState rises and the matching events follow. */
  receiveData(bufferedEnd: number, readyState: number = HAVE_ENOUGH_DATA): void {
    this.#requireSource('receiveData')
    if (this.#readyState < HAVE_METADATA) {
      throw new Error('FakeMediaElement: call loadMetadata() before receiveData()')
    }
    this.#buffered = [[0, bufferedEnd]]
    const before = this.#readyState
    this.#readyState = readyState
    if (before < HAVE_CURRENT_DATA && readyState >= HAVE_CURRENT_DATA)
      this.#queueEvent('loadeddata')
    if (before < HAVE_FUTURE_DATA && readyState >= HAVE_FUTURE_DATA) {
      this.#queueEvent('canplay')
      if (!this.#paused) this.#notifyAboutPlaying()
    }
    if (before < HAVE_ENOUGH_DATA && readyState >= HAVE_ENOUGH_DATA) {
      this.#queueEvent('canplaythrough')
    }
  }

  /** The buffer ran dry while playing: readyState drops and waiting fires. */
  starve(): void {
    this.#readyState = Math.min(this.#readyState, HAVE_CURRENT_DATA)
    if (!this.#paused) this.#queueEvent('waiting')
  }

  /** The network stopped delivering for a while. */
  stall(): void {
    this.#queueEvent('stalled')
  }

  /** Playback moved forward by seconds (clamped to the duration). */
  advanceTime(seconds: number): void {
    const end = Number.isFinite(this.#duration) ? this.#duration : Number.POSITIVE_INFINITY
    this.#currentTime = Math.min(this.#currentTime + seconds, end)
    this.#queueEvent('timeupdate')
  }

  /** Playback reached the end: timeupdate, pause (if playing), ended. */
  finish(): void {
    this.#currentTime = Number.isFinite(this.#duration) ? this.#duration : this.#currentTime
    this.#ended = true
    this.#queue(() => {
      this.#fire('timeupdate')
      if (!this.#paused) {
        this.#paused = true
        this.#fire('pause')
      }
      this.#fire('ended')
    })
  }

  /** The source failed: error fires; a MEDIA_ERR_SRC_NOT_SUPPORTED failure rejects pending play(). */
  fail(code: number = MEDIA_ERR_SRC_NOT_SUPPORTED): void {
    this.#error = { code, message: `fake media error ${code}` }
    this.#networkState = code === MEDIA_ERR_SRC_NOT_SUPPORTED ? NETWORK_NO_SOURCE : NETWORK_IDLE
    const plays = code === MEDIA_ERR_SRC_NOT_SUPPORTED ? this.#takePendingPlays() : []
    const settle = (): void => rejectAll(plays, 'NotSupportedError', 'Source failed')
    this.#queue(() => {
      this.#fire('error')
      settle()
    }, settle)
  }

  /** The system paused playback (a call, a headset unplugged, the lock screen). */
  interrupt(): void {
    this.#pauseSteps()
  }

  /** The system resumed playback (lock screen or headset play button). */
  resumeFromSystem(): void {
    this.#playSteps()
  }

  /** Tasks waiting to run, for assertions. */
  get queuedTaskCount(): number {
    return this.#tasks.length
  }

  /** Runs queued tasks in order, including tasks they queue. */
  flush(): void {
    while (this.#tasks.length > 0) this.#tasks.shift()?.run()
  }

  /** Runs queued tasks and lets promise callbacks run, until nothing is left. */
  async settle(): Promise<void> {
    do {
      this.flush()
      for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    } while (this.#tasks.length > 0)
  }

  // ---- HTML algorithm subsets. ----

  #queue(run: () => void, settlePromises?: () => void): void {
    this.#tasks.push({ run, settlePromises })
  }

  #queueEvent(type: string): void {
    this.#queue(() => this.#fire(type))
  }

  #fire(type: string): void {
    this.dispatchEvent(new Event(type))
  }

  #takePendingPlays(): PendingPlay[] {
    const plays = this.#pendingPlays
    this.#pendingPlays = []
    return plays
  }

  #requireSource(control: string): void {
    if (!this.hasAttribute('src')) throw new Error(`FakeMediaElement: ${control}() needs a src`)
  }

  #loadAlgorithm(): void {
    // Queued tasks of the old resource are dropped, but the promises they would settle settle now;
    // pending play() promises then reject with AbortError.
    const dropped = this.#tasks
    this.#tasks = []
    for (const task of dropped) task.settlePromises?.()
    if (this.#networkState === NETWORK_LOADING || this.#networkState === NETWORK_IDLE) {
      this.#queueEvent('abort')
    }
    if (this.#networkState !== NETWORK_EMPTY) {
      this.#queueEvent('emptied')
      this.#readyState = HAVE_NOTHING
      this.#paused = true
      this.#seeking = false
      this.#currentTime = 0
      this.#duration = Number.NaN
      this.#buffered = []
      this.#seekable = []
    }
    rejectAll(this.#takePendingPlays(), 'AbortError', 'The load was interrupted')
    this.#error = null
    this.#ended = false
    if (!this.hasAttribute('src')) {
      this.#networkState = NETWORK_EMPTY
      return
    }
    // preload="none": loadstart, then suspend until play() asks for data.
    this.#networkState = this.preload === 'none' ? NETWORK_IDLE : NETWORK_LOADING
    this.#queueEvent('loadstart')
    if (this.preload === 'none') this.#queueEvent('suspend')
  }

  #playSteps(): void {
    if (this.#networkState === NETWORK_IDLE) this.#networkState = NETWORK_LOADING
    if (this.#ended) {
      this.#currentTime = 0
      this.#ended = false
    }
    if (this.#paused) {
      this.#paused = false
      this.#queueEvent('play')
      if (this.#readyState < HAVE_FUTURE_DATA) {
        this.#queueEvent('waiting')
        return
      }
      this.#notifyAboutPlaying()
      return
    }
    if (this.#readyState >= HAVE_FUTURE_DATA) this.#resolvePendingPlaysLater()
  }

  #pauseSteps(): void {
    if (this.#paused) return
    this.#paused = true
    const plays = this.#takePendingPlays()
    const settle = (): void => rejectAll(plays, 'AbortError', 'Paused')
    this.#queue(() => {
      this.#fire('timeupdate')
      this.#fire('pause')
      settle()
    }, settle)
  }

  #notifyAboutPlaying(): void {
    const plays = this.#takePendingPlays()
    const settle = (): void => plays.forEach((play) => play.resolve())
    this.#queue(() => {
      this.#fire('playing')
      settle()
    }, settle)
  }

  #resolvePendingPlaysLater(): void {
    const plays = this.#takePendingPlays()
    const settle = (): void => plays.forEach((play) => play.resolve())
    this.#queue(settle, settle)
  }
}
