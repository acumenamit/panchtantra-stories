// The narration e2e harness (design p1-step11-design.md §8.2, §13.1 C, H, J, §13.2 H1 to H6; P1-5a
// Step 11). Not a spec: only player-audio.spec.ts loads it (T11-24); security-guard.spec.ts takes
// the media answer from e2e/media-answer.ts.
// - H1 FAKE (installFakeAudio): before any page script, Document.prototype.createElement returns a
//   scripted fake for 'audio' (any letter case) and the real element for every other tag. The fake
//   has exactly the surface the narration controller uses (NarrationMediaElement, type-checked) and
//   follows the HTML media algorithms the controller relies on: setting src or calling load()
//   rejects pending play() promises with AbortError in a queued task and resets the element;
//   removing src alone does not; pause() sets paused, then fires pause and rejects pending plays
//   with AbortError in a queued task; play() at the end seeks to 0 and returns a promise the test
//   settles (resolvePlay, rejectPlay). emit() patches readyState, paused, ended, currentTime,
//   networkState and the error code, then dispatches the event. Every call is logged with the
//   click bracket (H5), and window.__e2eNarration.made counts the fakes page code made.
// - H4 tripwire (FAKE only, the same init script): on a REAL media element (audio or video), each
//   way to load it records an entry and does nothing: the src setters of HTMLMediaElement and
//   HTMLSourceElement, Element.prototype.setAttribute and setAttributeNS for src, play (a promise
//   rejected with a DOMException named E2eTripwire) and load, window.Audio (it returns a real
//   element with no src), and (review round 1, S11-R1-FS-1) the attribute-node routes native code
//   takes without calling setAttribute: setAttributeNode, setAttributeNodeNS, the attributes map's
//   setNamedItem and setNamedItemNS, and the value, nodeValue and textContent of a src Attr once it
//   is attached. For each patch the init script records whether the original descriptor could be
//   replaced and whether it was (installed). A FAKE test fails if the tripwire log is not empty (the
//   spec's fake fixture), so no real media request can slip past where Playwright's network layer
//   does not see it (Windows WebKit, PR-3). Bypass classes (guard-bypass-catalogue.md, M2's forms):
//   a computed or template key, optional chaining, an alias or destructuring reach the same patched
//   method or setter at run time (M2 samples the computed key, the alias, Reflect and the
//   descriptor's setter); array-pattern assignment goes through the src setter (M2);
//   toggleAttribute can only add an empty src, which fetches nothing (HTML resource selection
//   fails at once), so it is no form of its own (M2 uses it to attach the Attr whose value it then
//   sets); srcObject takes no URL. Review round 2 (S11-R2-FS-4): Object.defineProperty(el, 'src',
//   ...) defines an own property on the element and calls no setter, so it sets no attribute and
//   loads nothing; document.defaultView is this window, so document.defaultView.Audio is the
//   replaced Audio (M2 samples window, globalThis and self); a page route running before a context
//   route (network-layer class 2) cannot hide a form from the tripwire, which is no route but
//   these patches, in place before any page script. Only the content attribute src is recorded:
//   no namespace and the local name exactly 'src' (S11-R2-FS-2; M2's near misses are applied and
//   not recorded). Documented limits: an element the HTML parser makes with a src (innerHTML,
//   outerHTML, insertAdjacentHTML, setHTMLUnsafe, DOMParser, createContextualFragment,
//   document.write, a template), or a clone or import of one, starts its load before any setter;
//   a method taken from a child frame's own prototypes (Playwright runs this script in child frames
//   too; whether before the parent's script can reach a new frame is unprobed); and a node or Attr
//   made in another frame and passed to this frame's patched methods, which pass it through,
//   since they decide with this frame's instanceof (realm-bound; the product renders no frame).
//   A name or namespace whose string form changes between two reads is the documented limit of a
//   name assembled at run time. Only the media guard sees those, where media requests are
//   routable.
// - H3 SPY (installAudioSpy): the real element, every call passed through: createElement('audio'),
//   play (and its outcome), pause, load, setAttribute and removeAttribute on media elements, and
//   the controller's 20 media events, each with isConnected, preload, the crossorigin attribute
//   and src.
// - H1/H3 storage log (both modes): every Storage.prototype.setItem key (never the value) goes into
//   the same ordered log, so "play() before the write" is read from one list (AUD-1).
// - H5 clock and click bracket (both modes): a window capture click listener opens a bracket
//   {clickId, isTrusted}; a window bubble click listener, or a setTimeout(0) the capture listener
//   queued (a handler that stops propagation), closes it. React's root listener runs in between, and
//   so do the microtasks the handler queues (the progress save): tests assert play() inside the
//   bracket and before the write, never "the write is outside the click" (CRIT-8). Stamps are the
//   page's performance.now(): every click, pointerdown and keydown, every log entry, and (one
//   MutationObserver) each change of the narration group's data-status, the message's value, the
//   playback button's data-kind and the live region's text.
// - H2 media answer: in e2e/media-answer.ts (review round 1, S11-R1-FS-2), so the guard spec can
//   ask it without loading this file.
// - H6 helpers: prefs text, clip URLs, waits from a page stamp, the console-line allowance, the
//   layout-shift source filter, and the E2E_MUTANT flag (13.6; nothing at all when it is unset).
// - H7 the run-area hold watch (design §20.3.2, N27; installHoldWatch): an init script that stamps
//   each change of the own inert of the choices, Back, the ending card's actions, the AI voice link
//   and the run footer (one MutationObserver from document start), and every pointerdown, keydown
//   and click (window capture) with its target, document.activeElement, those five states, whether
//   a narration button or the group has an inert self or ancestor, and, for a pointerdown, every
//   interactive element whose box holds the point, inert or not ("(inert)" marked). What lies under
//   a point is read from element boxes, never elementFromPoint or elementsFromPoint, which skip
//   inert nodes (T-b10's rule; M5 proves it with a weakened reader). Samples come from in-page
//   timers: armed before a key press or tap (taken at +ms from the next trusted click) or at a
//   stamp (sampleAt). It names no story id and no clip URL.
// This file exports the built clip URLs (real media-origin URLs), so the Vitest scan of e2e/ lets
// only player-audio.spec.ts load it (T11-24, review round 1).
// Every function passed to the page avoids syntax Playwright's transform rewrites with module-level
// helpers (private class members, array destructuring): it is serialized on its own.
import type { BrowserContext, Page } from '@playwright/test'
import { CONTENT_PUBLIC_BASE } from '../src/config/security-headers'
import { DEFAULT_PREFS, serializePrefs, type TextScale } from '../src/core/progress/records'
import {
  MEDIA_EVENTS,
  type NarrationMediaElement,
  type TimeRangesLike,
} from '../src/reader/audio/narration-controller'
import { NARRATION_CLIPS, narrationClipPath } from '../scripts/testing/narration-story'
import { expect } from './fixtures'
import type { ConsoleErrors } from './page-helpers'

// ---------------------------------------------------------------------------------------------
// What the page records

/** One logged call of the fake or the spy, or one storage write. */
export interface NarrationLogEntry {
  /** create, preload, setAttribute, removeAttribute, play, pause, load, play-resolved,
   * play-rejected, event, currentTime, or setItem. */
  readonly call: string
  /** The element's index in creation order (0 for the first); null for a storage write. */
  readonly el: number | null
  /** setAttribute/removeAttribute: the attribute; event: its type. */
  readonly name: string | null
  /** setAttribute: the value; preload: the value; play-rejected: the error name. */
  readonly value: string | null
  /** setItem: the key (never the value). */
  readonly key: string | null
  /** The element's src attribute after the call. */
  readonly src: string | null
  readonly preload: string | null
  /** SPY only: the element's isConnected and crossorigin attribute at the call. */
  readonly isConnected: boolean | null
  readonly crossorigin: boolean | null
  /** SPY events: the element's readyState, error code and currentTime. */
  readonly readyState: number | null
  readonly errorCode: number | null
  readonly currentTime: number | null
  /** The open click bracket, if any. */
  readonly clickId: number | null
  readonly inClick: boolean
  readonly isTrusted: boolean | null
  readonly t: number
}

/** One window click: when its bracket opened and closed, and what closed it. */
export interface ClickStamp {
  readonly id: number
  readonly isTrusted: boolean
  readonly open: number
  readonly close: number | null
  readonly closedBy: 'bubble' | 'timer' | null
}

/** One value a watched hook took, from the time it took it. */
export interface Stamp {
  readonly value: string | null
  readonly t: number
}

/** One tripwire entry: a way to load a real media element, blocked. */
export interface TripwireEntry {
  readonly form: string
  readonly tag: string | null
  readonly url: string | null
  readonly t: number
}

/** A tripwire patch: whether the original could be replaced, and whether it was. */
export interface PatchState {
  readonly configurable: boolean
  readonly replaced: boolean
}

/** What window.__e2eNarration holds for the current document. */
export interface NarrationRecord {
  readonly mode: 'fake' | 'spy'
  readonly made: number
  readonly log: readonly NarrationLogEntry[]
  readonly clicks: readonly ClickStamp[]
  readonly inputs: readonly { readonly type: string; readonly t: number }[]
  readonly status: readonly Stamp[]
  readonly messages: readonly Stamp[]
  readonly kinds: readonly Stamp[]
  readonly live: readonly Stamp[]
  readonly tripwire: readonly TripwireEntry[]
  readonly installed: Readonly<Record<string, PatchState>>
  /** Whether an audio element was ever in the document (SPY: never). */
  readonly audioInDocument: boolean
  /** The keys of the storage events this document heard (another tab's writes). */
  readonly storageEvents: readonly (string | null)[]
}

/** Test-side patch of the fake's element state before emit() dispatches the event. */
export interface FakePatch {
  readonly readyState?: number
  readonly paused?: boolean
  readonly ended?: boolean
  readonly currentTime?: number
  readonly networkState?: number
  /** The MediaError code; null clears the error. */
  readonly errorCode?: number | null
}

/** Node's copy of what the page sent through the binding: survives navigations. */
export interface NarrationHandle {
  /** Every log entry and tripwire entry of every document of the page, in arrival order. */
  readonly sent: readonly { readonly kind: 'log' | 'tripwire'; readonly entry: unknown }[]
  bound(): NarrationLogEntry[]
  tripwire(): TripwireEntry[]
}

const BINDING = '__e2eNarrationLog'

// ---------------------------------------------------------------------------------------------
// The init script (H1, H3, H4, H5). One function: Playwright serializes it on its own.

interface InitOptions {
  readonly mode: 'fake' | 'spy'
  readonly binding: string
  readonly events: readonly string[]
}

function narrationInit(options: InitOptions): void {
  const w = window as unknown as Record<string, unknown>
  if (w['__e2eNarration'] !== undefined) return
  const now = (): number => performance.now()

  interface MutableRecord {
    mode: 'fake' | 'spy'
    made: number
    log: NarrationLogEntry[]
    clicks: {
      id: number
      isTrusted: boolean
      open: number
      close: number | null
      closedBy: 'bubble' | 'timer' | null
    }[]
    inputs: { type: string; t: number }[]
    status: Stamp[]
    messages: Stamp[]
    kinds: Stamp[]
    live: Stamp[]
    tripwire: TripwireEntry[]
    installed: Record<string, PatchState>
    audioInDocument: boolean
    storageEvents: (string | null)[]
    current: { id: number; isTrusted: boolean } | null
    clickCount: number
    probing: boolean
    elements: unknown[]
  }
  const state: MutableRecord = {
    mode: options.mode,
    made: 0,
    log: [],
    clicks: [],
    inputs: [],
    status: [],
    messages: [],
    kinds: [],
    live: [],
    tripwire: [],
    installed: {},
    audioInDocument: false,
    storageEvents: [],
    current: null,
    clickCount: 0,
    probing: false,
    elements: [],
  }
  w['__e2eNarration'] = state

  const send = (kind: 'log' | 'tripwire', entry: unknown): void => {
    const report = w[options.binding]
    if (typeof report === 'function') {
      void (report as (message: unknown) => Promise<void>)({ kind, entry }).catch(() => undefined)
    }
  }

  interface EntryFields {
    el?: number | null
    name?: string | null
    value?: string | null
    key?: string | null
    src?: string | null
    preload?: string | null
    isConnected?: boolean | null
    crossorigin?: boolean | null
    readyState?: number | null
    errorCode?: number | null
    currentTime?: number | null
  }
  const record = (call: string, fields: EntryFields): void => {
    const open = state.current
    const entry: NarrationLogEntry = {
      call,
      el: fields.el === undefined ? null : fields.el,
      name: fields.name === undefined ? null : fields.name,
      value: fields.value === undefined ? null : fields.value,
      key: fields.key === undefined ? null : fields.key,
      src: fields.src === undefined ? null : fields.src,
      preload: fields.preload === undefined ? null : fields.preload,
      isConnected: fields.isConnected === undefined ? null : fields.isConnected,
      crossorigin: fields.crossorigin === undefined ? null : fields.crossorigin,
      readyState: fields.readyState === undefined ? null : fields.readyState,
      errorCode: fields.errorCode === undefined ? null : fields.errorCode,
      currentTime: fields.currentTime === undefined ? null : fields.currentTime,
      clickId: open === null ? null : open.id,
      inClick: open !== null,
      isTrusted: open === null ? null : open.isTrusted,
      t: now(),
    }
    state.log.push(entry)
    send('log', entry)
  }

  // H5: the click bracket and the input stamps.
  const closeBracket = (id: number, by: 'bubble' | 'timer'): void => {
    if (state.current === null || state.current.id !== id) return
    state.current = null
    const click = state.clicks.find((stamp) => stamp.id === id)
    if (click !== undefined && click.close === null) {
      click.close = now()
      click.closedBy = by
    }
  }
  window.addEventListener(
    'click',
    (event) => {
      state.clickCount += 1
      const id = state.clickCount
      state.current = { id, isTrusted: event.isTrusted }
      state.clicks.push({
        id,
        isTrusted: event.isTrusted,
        open: now(),
        close: null,
        closedBy: null,
      })
      setTimeout(() => closeBracket(id, 'timer'), 0)
    },
    true,
  )
  window.addEventListener(
    'click',
    () => {
      if (state.current !== null) closeBracket(state.current.id, 'bubble')
    },
    false,
  )
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => state.inputs.push({ type, t: now() }), true)
  }
  window.addEventListener('storage', (event) => state.storageEvents.push(event.key))

  // H5: the watched hooks, stamped when they change (one observer from document start).
  const pushChange = (list: Stamp[], value: string | null): void => {
    const last = list[list.length - 1]
    if (last === undefined ? value !== null : last.value !== value) list.push({ value, t: now() })
  }
  const track = (): void => {
    const group = document.querySelector('[data-part] [data-narration]')
    pushChange(state.status, group === null ? null : group.getAttribute('data-status'))
    const message = document.querySelector('[data-part] [data-narration-message]')
    pushChange(
      state.messages,
      message === null ? null : message.getAttribute('data-narration-message'),
    )
    const control = document.querySelector('[data-part] [data-narration-control]')
    pushChange(state.kinds, control === null ? null : control.getAttribute('data-kind'))
    const region = document.getElementById('live-region')
    pushChange(state.live, region === null ? null : (region.textContent ?? ''))
    if (document.querySelector('audio') !== null) state.audioInDocument = true
  }
  new MutationObserver(track).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-status', 'data-narration-message', 'data-kind'],
  })

  // H1/H3: the shared storage-write log (the key only).
  const storageProto = Storage.prototype
  const setItem = storageProto.setItem
  Object.defineProperty(storageProto, 'setItem', {
    configurable: true,
    writable: true,
    value: function (this: Storage, key: string, value: string) {
      record('setItem', { key: String(key) })
      return setItem.call(this, key, value)
    },
  })

  const create = Document.prototype.createElement
  const isMedia = (el: unknown): el is HTMLMediaElement => el instanceof HTMLMediaElement

  if (options.mode === 'spy') {
    // H3: the real element, every call passed through.
    const readMedia = (el: HTMLMediaElement): EntryFields => ({
      el: state.elements.indexOf(el),
      src: el.getAttribute('src'),
      preload: el.preload,
      isConnected: el.isConnected,
      crossorigin: el.hasAttribute('crossorigin'),
      readyState: el.readyState,
      errorCode: el.error === null ? null : el.error.code,
      currentTime: el.currentTime,
    })
    Object.defineProperty(Document.prototype, 'createElement', {
      configurable: true,
      writable: true,
      value: function (this: Document, tagName: string, elementOptions?: ElementCreationOptions) {
        const el = create.call(this, tagName, elementOptions)
        if (String(tagName).toLowerCase() === 'audio' && isMedia(el)) {
          state.made += 1
          state.elements.push(el)
          for (const type of options.events) {
            el.addEventListener(type, () => record('event', { ...readMedia(el), name: type }))
          }
          record('create', readMedia(el))
        }
        return el
      },
    })
    const mediaProto = HTMLMediaElement.prototype
    const play = mediaProto.play
    const pause = mediaProto.pause
    const load = mediaProto.load
    Object.defineProperty(mediaProto, 'play', {
      configurable: true,
      writable: true,
      value: function (this: HTMLMediaElement) {
        record('play', readMedia(this))
        const result = play.call(this)
        result.then(
          () => record('play-resolved', readMedia(this)),
          (error: unknown) =>
            record('play-rejected', {
              ...readMedia(this),
              value: error instanceof DOMException ? error.name : String(error),
            }),
        )
        return result
      },
    })
    Object.defineProperty(mediaProto, 'pause', {
      configurable: true,
      writable: true,
      value: function (this: HTMLMediaElement) {
        record('pause', readMedia(this))
        return pause.call(this)
      },
    })
    Object.defineProperty(mediaProto, 'load', {
      configurable: true,
      writable: true,
      value: function (this: HTMLMediaElement) {
        record('load', readMedia(this))
        return load.call(this)
      },
    })
    const elementProto = Element.prototype
    const setAttribute = elementProto.setAttribute
    const removeAttribute = elementProto.removeAttribute
    Object.defineProperty(elementProto, 'setAttribute', {
      configurable: true,
      writable: true,
      value: function (this: Element, name: string, value: string) {
        const result = setAttribute.call(this, name, value)
        if (isMedia(this)) {
          record('setAttribute', { ...readMedia(this), name: String(name), value: String(value) })
        }
        return result
      },
    })
    Object.defineProperty(elementProto, 'removeAttribute', {
      configurable: true,
      writable: true,
      value: function (this: Element, name: string) {
        const result = removeAttribute.call(this, name)
        if (isMedia(this)) record('removeAttribute', { ...readMedia(this), name: String(name) })
        return result
      },
    })
    return
  }

  // H1: the fake. Public fields only (Playwright turns them into constructor assignments).
  const emptyRanges: TimeRangesLike = {
    length: 0,
    start: () => {
      throw new DOMException('e2e fake: no range', 'IndexSizeError')
    },
    end: () => {
      throw new DOMException('e2e fake: no range', 'IndexSizeError')
    },
  }
  interface PendingPlay {
    resolve: () => void
    reject: (error: DOMException) => void
  }
  class FakeAudio extends EventTarget implements NarrationMediaElement {
    readonly __e2eFake = true
    index: number
    attrs: Map<string, string> = new Map()
    plays: PendingPlay[] = []
    s = {
      preload: 'auto' as NarrationMediaElement['preload'],
      paused: true,
      ended: false,
      seeking: false,
      readyState: 0,
      networkState: 0,
      currentTime: 0,
      error: null as { readonly code: number } | null,
    }

    constructor(index: number) {
      super()
      this.index = index
    }

    get preload(): NarrationMediaElement['preload'] {
      return this.s.preload
    }
    set preload(value: NarrationMediaElement['preload']) {
      this.s.preload = value
      this.note('preload', { value: String(value) })
    }
    get currentTime(): number {
      return this.s.currentTime
    }
    set currentTime(value: number) {
      this.s.currentTime = value
      this.note('currentTime', { value: String(value) })
    }
    get duration(): number {
      return this.attrs.has('src') && this.s.readyState > 0 ? 1.008 : Number.NaN
    }
    get paused(): boolean {
      return this.s.paused
    }
    get ended(): boolean {
      return this.s.ended
    }
    get seeking(): boolean {
      return this.s.seeking
    }
    get readyState(): number {
      return this.s.readyState
    }
    get networkState(): number {
      return this.s.networkState
    }
    get error(): { readonly code: number } | null {
      return this.s.error
    }
    get buffered(): TimeRangesLike {
      return emptyRanges
    }
    get seekable(): TimeRangesLike {
      return emptyRanges
    }

    note(call: string, fields: EntryFields): void {
      if (this.index < 0) return
      record(call, {
        el: this.index,
        src: this.getAttribute('src'),
        preload: this.s.preload,
        ...fields,
      })
    }

    getAttribute(name: string): string | null {
      const value = this.attrs.get(String(name).toLowerCase())
      return value === undefined ? null : value
    }
    hasAttribute(name: string): boolean {
      return this.attrs.has(String(name).toLowerCase())
    }
    setAttribute(name: string, value: string): void {
      const key = String(name).toLowerCase()
      this.attrs.set(key, String(value))
      if (key === 'src') this.reset('src')
      this.note('setAttribute', { name: key, value: String(value) })
    }
    removeAttribute(name: string): void {
      const key = String(name).toLowerCase()
      this.attrs.delete(key)
      this.note('removeAttribute', { name: key })
    }
    load(): void {
      this.reset('load')
      this.note('load', {})
    }
    /** The media element load algorithm, as far as the controller reads it. */
    reset(why: string): void {
      const plays = this.plays.splice(0)
      this.settleLater(plays, 'AbortError', why)
      this.s.paused = true
      this.s.ended = false
      this.s.seeking = false
      this.s.readyState = 0
      this.s.currentTime = 0
      this.s.error = null
      this.s.networkState = this.attrs.has('src') ? 1 : 0
    }
    settleLater(plays: PendingPlay[], name: string, why: string): void {
      if (plays.length === 0) return
      setTimeout(() => {
        for (const pending of plays) {
          this.note('play-rejected', { value: name })
          pending.reject(new DOMException(`e2e fake: ${why}`, name))
        }
      }, 0)
    }
    play(): Promise<void> {
      if (this.s.ended) {
        this.s.ended = false
        this.s.currentTime = 0
      }
      const wasPaused = this.s.paused
      this.s.paused = false
      this.note('play', {})
      if (wasPaused) setTimeout(() => this.dispatchEvent(new Event('play')), 0)
      return new Promise<void>((resolve, reject) => {
        this.plays.push({ resolve, reject })
      })
    }
    pause(): void {
      const plays = this.plays.splice(0)
      const wasPaused = this.s.paused
      this.s.paused = true
      this.note('pause', {})
      if (!wasPaused) setTimeout(() => this.dispatchEvent(new Event('pause')), 0)
      this.settleLater(plays, 'AbortError', 'pause')
    }

    // The test's controls.
    resolvePlay(): void {
      const pending = this.plays.shift()
      if (pending === undefined) throw new Error('e2e fake: no pending play to resolve')
      this.note('play-resolved', {})
      pending.resolve()
    }
    rejectPlay(name: string): void {
      const pending = this.plays.shift()
      if (pending === undefined) throw new Error('e2e fake: no pending play to reject')
      if (name === 'NotAllowedError' || name === 'NotSupportedError') this.s.paused = true
      if (name === 'NotSupportedError') {
        this.s.error = { code: 4 }
        this.s.networkState = 3
      }
      this.note('play-rejected', { value: name })
      pending.reject(new DOMException(`e2e fake: ${name}`, name))
    }
    emit(type: string, patch: FakePatch): void {
      if (patch.readyState !== undefined) this.s.readyState = patch.readyState
      if (patch.paused !== undefined) this.s.paused = patch.paused
      if (patch.ended !== undefined) this.s.ended = patch.ended
      if (patch.currentTime !== undefined) this.s.currentTime = patch.currentTime
      if (patch.networkState !== undefined) this.s.networkState = patch.networkState
      if (patch.errorCode !== undefined) {
        this.s.error = patch.errorCode === null ? null : { code: patch.errorCode }
      }
      this.note('event', { name: type, readyState: this.s.readyState })
      this.dispatchEvent(new Event(type))
    }
  }

  Object.defineProperty(Document.prototype, 'createElement', {
    configurable: true,
    writable: true,
    value: function (this: Document, tagName: string, elementOptions?: ElementCreationOptions) {
      if (String(tagName).toLowerCase() !== 'audio') {
        return create.call(this, tagName, elementOptions)
      }
      if (state.probing) return new FakeAudio(-1)
      const fake = new FakeAudio(state.made)
      state.made += 1
      state.elements.push(fake)
      fake.note('create', {})
      return fake
    },
  })

  // H4: the tripwire on real media elements.
  const trip = (form: string, el: Element | null, url: string | null): void => {
    const entry: TripwireEntry = { form, tag: el === null ? null : el.localName, url, t: now() }
    state.tripwire.push(entry)
    send('tripwire', entry)
  }
  const isSource = (el: unknown): el is HTMLSourceElement => el instanceof HTMLSourceElement
  const patchSrcSetter = (proto: object, key: string): void => {
    const original = Object.getOwnPropertyDescriptor(proto, 'src')
    const configurable = original !== undefined && original.configurable === true
    if (original === undefined || !configurable) {
      state.installed[key] = { configurable: false, replaced: false }
      return
    }
    const replacement = function (this: Element, value: string): void {
      trip(key, this, String(value))
    }
    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: original.enumerable === true,
      get: original.get,
      set: replacement,
    })
    const after = Object.getOwnPropertyDescriptor(proto, 'src')
    state.installed[key] = {
      configurable,
      replaced: after !== undefined && after.set === replacement,
    }
  }
  const patchMethod = (
    proto: object,
    name: string,
    key: string,
    make: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
  ): void => {
    const original = Object.getOwnPropertyDescriptor(proto, name)
    const configurable = original !== undefined && original.configurable === true
    if (original === undefined || !configurable || typeof original.value !== 'function') {
      state.installed[key] = { configurable: false, replaced: false }
      return
    }
    const replacement = make(original.value as (...args: unknown[]) => unknown)
    Object.defineProperty(proto, name, { configurable: true, writable: true, value: replacement })
    const after = Object.getOwnPropertyDescriptor(proto, name)
    state.installed[key] = {
      configurable,
      replaced: after !== undefined && after.value === replacement,
    }
  }
  patchSrcSetter(HTMLMediaElement.prototype, 'media src setter')
  patchSrcSetter(HTMLSourceElement.prototype, 'source src setter')
  patchMethod(
    Element.prototype,
    'setAttribute',
    'setAttribute',
    (original) =>
      function (this: Element, ...args: unknown[]) {
        const name = String(args[0]).toLowerCase()
        if ((isMedia(this) || isSource(this)) && name === 'src') {
          trip('setAttribute', this, String(args[1]))
          return undefined
        }
        return original.apply(this, args)
      },
  )
  patchMethod(
    Element.prototype,
    'setAttributeNS',
    'setAttributeNS',
    (original) =>
      function (this: Element, ...args: unknown[]) {
        // Only the content attribute src loads: no namespace (null, undefined or '' are none) and
        // the name exactly 'src', since setAttributeNS keeps its case (review round 2,
        // S11-R2-FS-2); a prefix with no namespace throws in the original.
        const space = args[0] === null || args[0] === undefined ? '' : String(args[0])
        if ((isMedia(this) || isSource(this)) && space === '' && String(args[1]) === 'src') {
          trip('setAttributeNS', this, String(args[2]))
          return undefined
        }
        return original.apply(this, args)
      },
  )
  patchMethod(
    HTMLMediaElement.prototype,
    'play',
    'play',
    () =>
      function (this: Element) {
        trip('play', this, this.getAttribute('src'))
        return Promise.reject(
          new DOMException('e2e tripwire: play on a real media element', 'E2eTripwire'),
        )
      },
  )
  patchMethod(
    HTMLMediaElement.prototype,
    'load',
    'load',
    () =>
      function (this: Element) {
        trip('load', this, this.getAttribute('src'))
        return undefined
      },
  )
  const audioDescriptor = Object.getOwnPropertyDescriptor(window, 'Audio')
  const audioConfigurable = audioDescriptor !== undefined && audioDescriptor.configurable === true
  if (audioConfigurable) {
    const replacement = function (src?: string): HTMLAudioElement {
      trip('Audio', null, src === undefined ? null : String(src))
      return create.call(document, 'audio') as HTMLAudioElement
    }
    Object.defineProperty(window, 'Audio', {
      configurable: true,
      writable: true,
      value: replacement,
    })
    state.installed['Audio'] = {
      configurable: true,
      replaced: (window as unknown as Record<string, unknown>)['Audio'] === replacement,
    }
  } else {
    state.installed['Audio'] = { configurable: false, replaced: false }
  }

  // H4, review round 1 (S11-R1-FS-1): the attribute-node routes. Native code sets the attribute
  // without calling setAttribute, so each route has its own patch: attaching a src Attr to a real
  // media or source element (setAttributeNode, setAttributeNodeNS, and the setNamedItem and
  // setNamedItemNS of its attributes map, whose element the attributes getter remembers), and
  // changing an attached one (Attr's value, and Node's nodeValue and textContent on an Attr).
  const loads = (el: Element | null): el is Element => el !== null && (isMedia(el) || isSource(el))
  // The content attribute src only: no namespace and the local name exactly 'src' (createAttribute
  // lower-cases in an HTML document, createAttributeNS keeps the case; review round 2,
  // S11-R2-FS-2). Any other Attr passes through to the original.
  const isSrcAttr = (node: unknown): node is Attr =>
    node instanceof Attr && node.namespaceURI === null && node.localName === 'src'
  const patchAccessor = (
    proto: object,
    name: string,
    key: string,
    make: {
      get?: (original: () => unknown) => () => unknown
      set?: (original: (value: unknown) => void) => (value: unknown) => void
    },
  ): void => {
    const original = Object.getOwnPropertyDescriptor(proto, name)
    const configurable = original !== undefined && original.configurable === true
    const getter = original === undefined ? undefined : original.get
    const setter = original === undefined ? undefined : original.set
    if (
      original === undefined ||
      !configurable ||
      (make.get !== undefined && getter === undefined) ||
      (make.set !== undefined && setter === undefined)
    ) {
      state.installed[key] = { configurable: false, replaced: false }
      return
    }
    const get = make.get !== undefined && getter !== undefined ? make.get(getter) : getter
    const set = make.set !== undefined && setter !== undefined ? make.set(setter) : setter
    Object.defineProperty(proto, name, {
      configurable: true,
      enumerable: original.enumerable === true,
      get,
      set,
    })
    const after = Object.getOwnPropertyDescriptor(proto, name)
    state.installed[key] = {
      configurable,
      replaced:
        after !== undefined &&
        (make.get === undefined || after.get === get) &&
        (make.set === undefined || after.set === set),
    }
  }
  for (const method of ['setAttributeNode', 'setAttributeNodeNS']) {
    patchMethod(
      Element.prototype,
      method,
      method,
      (original) =>
        function (this: Element, ...args: unknown[]) {
          const attr = args[0]
          if (loads(this) && isSrcAttr(attr)) {
            trip(method, this, attr.value)
            return null
          }
          return original.apply(this, args)
        },
    )
  }
  const owners = new WeakMap<object, Element>()
  patchAccessor(Element.prototype, 'attributes', 'attributes getter', {
    get: (original) =>
      function (this: Element) {
        const map = original.call(this) as object
        if (loads(this)) owners.set(map, this)
        return map
      },
  })
  for (const method of ['setNamedItem', 'setNamedItemNS']) {
    patchMethod(
      NamedNodeMap.prototype,
      method,
      method,
      (original) =>
        function (this: NamedNodeMap, ...args: unknown[]) {
          const owner = owners.get(this) ?? null
          const attr = args[0]
          if (loads(owner) && isSrcAttr(attr)) {
            trip(method, owner, attr.value)
            return null
          }
          return original.apply(this, args)
        },
    )
  }
  // Objects, not tuples: array destructuring may be rewritten with a module-level helper.
  for (const target of [
    { proto: Attr.prototype, name: 'value', key: 'Attr value setter' },
    { proto: Node.prototype, name: 'nodeValue', key: 'nodeValue setter' },
    { proto: Node.prototype, name: 'textContent', key: 'textContent setter' },
  ]) {
    patchAccessor(target.proto, target.name, target.key, {
      set: (original) =>
        function (this: Node, value: unknown) {
          if (isSrcAttr(this) && loads(this.ownerElement)) {
            trip(target.key, this.ownerElement, String(value))
            return
          }
          original.call(this, value)
        },
    })
  }
}

/** Installs the binding (once per page or context) and returns Node's copy of what it receives. */
async function bindLog(target: Page | BrowserContext): Promise<NarrationHandle> {
  const sent: { kind: 'log' | 'tripwire'; entry: unknown }[] = []
  await target.exposeBinding(
    BINDING,
    (_source, message: { kind: 'log' | 'tripwire'; entry: unknown }) => {
      sent.push(message)
    },
  )
  return {
    sent,
    bound: () => sent.filter((m) => m.kind === 'log').map((m) => m.entry as NarrationLogEntry),
    tripwire: () => sent.filter((m) => m.kind === 'tripwire').map((m) => m.entry as TripwireEntry),
  }
}

/** H1 + H4 + H5 + the storage log: before any page script of `target`. */
export async function installFakeAudio(target: Page | BrowserContext): Promise<NarrationHandle> {
  const handle = await bindLog(target)
  const options: InitOptions = { mode: 'fake', binding: BINDING, events: [...MEDIA_EVENTS] }
  await target.addInitScript(narrationInit, options)
  return handle
}

/** H3 + H5 + the storage log: before any page script of `page`. */
export async function installAudioSpy(page: Page): Promise<NarrationHandle> {
  const handle = await bindLog(page)
  const options: InitOptions = { mode: 'spy', binding: BINDING, events: [...MEDIA_EVENTS] }
  await page.addInitScript(narrationInit, options)
  return handle
}

/** What the current document recorded (FAKE or SPY). */
export async function narrationRecord(page: Page): Promise<NarrationRecord> {
  const record = await page.evaluate(() => {
    const state = (window as unknown as Record<string, unknown>)['__e2eNarration'] as
      | (NarrationRecord & {
          current: unknown
          clickCount: number
          probing: boolean
          elements: unknown[]
        })
      | undefined
    if (state === undefined) return null
    return {
      mode: state.mode,
      made: state.made,
      log: [...state.log],
      clicks: state.clicks.map((click) => ({ ...click })),
      inputs: [...state.inputs],
      status: [...state.status],
      messages: [...state.messages],
      kinds: [...state.kinds],
      live: [...state.live],
      tripwire: [...state.tripwire],
      installed: { ...state.installed },
      audioInDocument: state.audioInDocument,
      storageEvents: [...state.storageEvents],
    }
  })
  if (record === null) throw new Error('the narration harness is not installed in this document')
  return record
}

/** The page's clock now (performance.now()). */
export async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now())
}

/** Resolves when `ms` have passed on the page's clock since `stamp` (an in-page timer, 13.1 C). */
export async function waitAfter(page: Page, stamp: number, ms: number): Promise<void> {
  await page.evaluate(
    ({ from, delay }) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(0, from + delay - performance.now()))
      }),
    { from: stamp, delay: ms },
  )
}

/** Calls one control of the fake page code made last (or of the fake at `index`). */
export async function fakeControl(
  page: Page,
  control: 'resolvePlay' | 'rejectPlay' | 'emit',
  args: {
    readonly name?: string
    readonly type?: string
    readonly patch?: FakePatch
    readonly index?: number
  } = {},
): Promise<void> {
  await page.evaluate(
    ({ control, args }) => {
      const state = (window as unknown as Record<string, unknown>)['__e2eNarration'] as {
        elements: {
          resolvePlay(): void
          rejectPlay(name: string): void
          emit(type: string, patch: FakePatch): void
        }[]
      }
      const fake = state.elements[args.index === undefined ? state.elements.length - 1 : args.index]
      if (fake === undefined) throw new Error('e2e fake: page code made no audio element yet')
      if (control === 'resolvePlay') fake.resolvePlay()
      else if (control === 'rejectPlay') fake.rejectPlay(args.name ?? 'NotAllowedError')
      else fake.emit(args.type ?? 'playing', args.patch ?? {})
    },
    { control, args },
  )
}

/** The fake's live state (FAKE only): what the controller would read from it. */
export async function fakeState(
  page: Page,
  index = 0,
): Promise<{
  paused: boolean
  ended: boolean
  readyState: number
  currentTime: number
  src: string | null
}> {
  return page.evaluate((at) => {
    const state = (window as unknown as Record<string, unknown>)['__e2eNarration'] as {
      elements: NarrationMediaElement[]
    }
    const fake = state.elements[at]
    if (fake === undefined) throw new Error(`e2e fake: no element ${at}`)
    return {
      paused: fake.paused,
      ended: fake.ended,
      readyState: fake.readyState,
      currentTime: fake.currentTime,
      src: fake.getAttribute('src'),
    }
  }, index)
}

/**
 * The precondition of every FAKE test (C7, asked at run time; CRIT-2): after hydration, with no
 * page error so far (hydration survived the override), document.createElement('audio') gives the
 * fake (not counted in made) and not a real media element.
 */
export async function expectFakeInstalled(page: Page, errors: ConsoleErrors): Promise<void> {
  expect(
    errors.lines.filter((line) => line.startsWith('pageerror: ')),
    'precondition (C7): no page error, so hydration survived the createElement override',
  ).toEqual([])
  const probe = await page.evaluate(() => {
    const state = (window as unknown as Record<string, unknown>)['__e2eNarration'] as
      { probing: boolean; mode: string } | undefined
    if (state === undefined) return { installed: false, fake: false, media: false }
    state.probing = true
    try {
      const el = document.createElement('audio') as unknown as Record<string, unknown>
      return {
        installed: state.mode === 'fake',
        fake: el['__e2eFake'] === true,
        media: (el as unknown) instanceof HTMLMediaElement,
      }
    } finally {
      state.probing = false
    }
  })
  expect(probe, 'precondition (C7): the fake is installed').toEqual({
    installed: true,
    fake: true,
    media: false,
  })
}

// ---------------------------------------------------------------------------------------------
// H6: helpers

/** A prefs record with a text size and Read to me, written as the reader writes it. */
export function narrationPrefsText(prefs: {
  readonly textScale: TextScale
  readonly readToMe: boolean
}): string {
  return serializePrefs({ ...DEFAULT_PREFS, textScale: prefs.textScale, readToMe: prefs.readToMe })
}

/** A clip's URL as the player builds it (CONTENT_PUBLIC_BASE + '/' + path, content/index.ts). */
export function clipUrl(nodeId: string, locale: string): string {
  return `${CONTENT_PUBLIC_BASE}/${narrationClipPath(nodeId, locale)}`
}

/** The 15 clip URLs, which the SPY and NETWORK tests' media stub serves. */
export const CLIP_URLS: readonly string[] = NARRATION_CLIPS.map((clip) =>
  clipUrl(clip.nodeId, clip.locale),
)

/** The narration group's data-status values so far in this document, in order. */
export async function statusHistory(page: Page): Promise<(string | null)[]> {
  return (await narrationRecord(page)).status.map((stamp) => stamp.value)
}

/** Chromium's line for a media load the stub answered with an error status (unprobed on Linux). */
export const MEDIA_STATUS_LINE =
  /^Failed to load resource: the server responded with a status of (402|540)\b/
/** Chromium's line for an aborted load (WebKit logs none at error level). */
export const ABORTED_LINE = /^Failed to load resource: net::ERR_FAILED$/

/**
 * Allows only those of `patterns` that matched a console line of this test (13.1 E): which lines an
 * engine logs for a failed media load is unprobed on Linux, so none is required, every matched line
 * is returned (for the test's annotation), and every other line still fails the test.
 */
export function allowObserved(
  errors: ConsoleErrors,
  browserName: string,
  patterns: readonly RegExp[],
): string[] {
  const used = patterns.filter((pattern) => errors.lines.some((line) => pattern.test(line)))
  errors.allow(browserName === 'chromium' ? { chromium: used } : { webkit: used })
  return errors.lines.filter((line) => used.some((pattern) => pattern.test(line)))
}

/**
 * The layout-shift lines (routes.ts layoutShift) with at least one source outside `allowed`: a
 * source counts as inside only when the nearest element with a data-* attribute in its selector
 * (its first part) carries one of the allowed hooks exactly, as a whole [data-…] token. A line with
 * no sources, or a source of a removed node, counts as outside.
 */
export function shiftsOutside(lines: readonly string[], allowed: readonly string[]): string[] {
  const inside = (source: string): boolean => {
    const selector = source.replace(/^text in /, '').replace(/ \([-\d,]+\) -> \([-\d,]+\)$/, '')
    const anchor = selector.split(' > ')[0] ?? ''
    const tokens = anchor.match(/\[[^\]]+\]/g) ?? []
    return tokens.some((token) => allowed.includes(token))
  }
  return lines.filter((line) => {
    const at = line.indexOf(': ')
    const sources = at < 0 ? 'no sources' : line.slice(at + 2)
    if (sources === 'no sources') return true
    return sources.split('; ').some((source) => !inside(source))
  })
}

/**
 * E2E_MUTANT support for the mutant-schema build (design §13.6 MB-S): when the variable is set, an
 * init script sets window.__e2eMutant and <html data-e2e-mutant>; when it is unset, nothing.
 */
export async function installMutantFlag(page: Page): Promise<void> {
  const mutant = process.env['E2E_MUTANT']
  if (mutant === undefined || mutant === '') return
  await page.addInitScript((name) => {
    ;(window as unknown as Record<string, unknown>)['__e2eMutant'] = name
    const mark = (): boolean => {
      const root = document.documentElement
      if (root === null) return false
      root.setAttribute('data-e2e-mutant', name)
      return true
    }
    if (!mark()) {
      const observer = new MutationObserver(() => {
        if (mark()) observer.disconnect()
      })
      observer.observe(document, { childList: true })
    }
  }, mutant)
}

// ---------------------------------------------------------------------------------------------
// H7: the run-area hold watch (design §20.3.2, N27)

/** The run-area nodes the narration hold holds (the footer: never by it), each by its own inert. */
export const HOLD_NODES = {
  choices: '[data-part] ul[data-choices]',
  back: '[data-part] button[data-back]',
  actions: '[data-part] [data-ending-actions]',
  aiVoice: '[data-part] a[data-ai-voice]',
  footer: '[data-part] footer[data-part-controls]',
} as const
export type HoldNode = keyof typeof HOLD_NODES

/** T-b10's list (player.spec.ts INTERACTIVE): what counts as interactive under a tap. */
export const HOLD_INTERACTIVE =
  'a[href], button, input, select, textarea, label, summary, [tabindex]:not([tabindex="-1"])'

/** The narration nodes that the hold never makes inert (N27). */
const HOLD_NARRATION = [
  '[data-part] [data-narration]',
  '[data-part] [data-read-to-me]',
  '[data-part] [data-narration-control]',
] as const

/** Each node's own inert, or null when the node is not in the document. */
export type HeldStates = Readonly<Record<HoldNode, boolean | null>>

/** What the watch reads at one moment. */
export interface HoldSnapshot {
  readonly t: number
  /** document.activeElement: its tag and data attributes ('body', 'none'). */
  readonly active: string
  /** Whether document.activeElement is the element markHoldFocus marked. */
  readonly activeMarked: boolean
  /** Whether document.activeElement lies in a held node (the choices, Back, actions, AI voice). */
  readonly activeInHeld: boolean
  readonly held: HeldStates
  /** Whether Read to me, the playback button or the group has an inert self or ancestor. */
  readonly narrationInert: boolean
  readonly scrollY: number
}

/** One pointerdown, keydown or click (window, capture phase). */
export interface HoldInput extends HoldSnapshot {
  readonly type: string
  readonly isTrusted: boolean
  readonly target: string
  readonly x: number | null
  readonly y: number | null
  /** pointerdown only: every interactive element whose box holds the point, inert or not. */
  readonly under: readonly string[]
}

/** A change of one node's own inert (null: the node went away). */
export interface HoldNodeStamp {
  readonly node: HoldNode
  readonly inert: boolean | null
  readonly t: number
}

/** A sample from an in-page timer: `due` is when it was asked for, `t` when it was taken. */
export interface HoldSample extends HoldSnapshot {
  readonly label: string
  readonly due: number
}

export interface HoldWatchRecord {
  readonly nodes: readonly HoldNodeStamp[]
  readonly inputs: readonly HoldInput[]
  readonly samples: readonly HoldSample[]
}

interface HoldWatchConfig {
  readonly nodes: Readonly<Record<string, string>>
  readonly interactive: string
  readonly narration: readonly string[]
  readonly run: string
  readonly dialog: string
}

function holdWatchInit(config: HoldWatchConfig): void {
  const w = window as unknown as Record<string, unknown>
  if (w['__e2eHoldWatch'] !== undefined) return
  const now = (): number => performance.now()
  const names = Object.keys(config.nodes)
  const nodes: { node: string; inert: boolean | null; t: number }[] = []
  const inputs: Record<string, unknown>[] = []
  const samples: Record<string, unknown>[] = []
  const last: Record<string, boolean | null> = {}
  let armed: number[] = []
  const ownInert = (name: string): boolean | null => {
    const selector = config.nodes[name]
    const element = selector === undefined ? null : document.querySelector(selector)
    return element === null ? null : element.hasAttribute('inert')
  }
  const heldNow = (): Record<string, boolean | null> => {
    const held: Record<string, boolean | null> = {}
    for (const name of names) held[name] = ownInert(name)
    return held
  }
  const narrationInert = (): boolean =>
    config.narration.some((selector) => {
      const element = document.querySelector(selector)
      return element !== null && element.closest('[inert]') !== null
    })
  const dataNames = (element: Element): string =>
    [...element.attributes]
      .filter((attribute) => attribute.name.startsWith('data-'))
      .map((attribute) => `[${attribute.name}]`)
      .join('')
  const describe = (element: Element | null): string => {
    if (element === null) return 'none'
    return `${element.tagName.toLowerCase()}${dataNames(element)}`
  }
  const heldSelectors = names
    .filter((name) => name !== 'footer')
    .map((name) => config.nodes[name] ?? '')
    .filter((selector) => selector !== '')
  const inHeld = (element: Element | null): boolean =>
    element !== null && heldSelectors.some((selector) => element.closest(selector) !== null)
  const holds = (element: Element, x: number, y: number): boolean => {
    const box = element.getBoundingClientRect()
    return (
      box.width > 0 &&
      box.height > 0 &&
      x >= box.left &&
      x <= box.right &&
      y >= box.top &&
      y <= box.bottom
    )
  }
  // As T-b10 names it: where, tag, data attributes, text, and (inert) when hit testing skips it.
  const nameOf = (element: Element): string => {
    const where =
      element.closest(config.dialog) !== null
        ? 'dialog'
        : element.closest('header') !== null
          ? 'header'
          : element.closest(config.run) !== null
            ? 'run area'
            : 'page'
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    const inert = element.closest('[inert]') !== null ? ' (inert)' : ''
    return `${where} ${describe(element)} "${text}"${inert}`
  }
  const snapshot = (): Record<string, unknown> => {
    const active = document.activeElement
    return {
      t: now(),
      active: describe(active),
      activeMarked: active !== null && active === w['__e2eHoldMark'],
      activeInHeld: inHeld(active),
      held: heldNow(),
      narrationInert: narrationInert(),
      scrollY: window.scrollY,
    }
  }
  const track = (): void => {
    for (const name of names) {
      const inert = ownInert(name)
      if (name in last && last[name] === inert) continue
      last[name] = inert
      nodes.push({ node: name, inert, t: now() })
    }
  }
  new MutationObserver(track).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['inert'],
  })
  const onInput = (event: Event): void => {
    const pointer = event.type === 'pointerdown' && event instanceof MouseEvent
    const x = pointer ? event.clientX : null
    const y = pointer ? event.clientY : null
    const under =
      x === null || y === null
        ? []
        : [...document.querySelectorAll(config.interactive)]
            .filter((element) => holds(element, x, y))
            .map(nameOf)
    const target = event.target instanceof Element ? event.target : null
    inputs.push({
      ...snapshot(),
      type: event.type,
      isTrusted: event.isTrusted,
      target: describe(target),
      x,
      y,
      under,
    })
    if (event.type === 'click' && event.isTrusted && armed.length > 0) {
      const from = now()
      for (const ms of armed) {
        setTimeout(() => samples.push({ ...snapshot(), label: `+${ms}`, due: from + ms }), ms)
      }
      armed = []
    }
  }
  for (const type of ['pointerdown', 'keydown', 'click']) {
    window.addEventListener(type, onInput, true)
  }
  w['__e2eHoldWatch'] = {
    nodes,
    inputs,
    samples,
    snapshot,
    arm: (offsets: number[]): void => {
      armed = [...offsets]
    },
  }
}

/** H7: before any page script of `page` (a full navigation reinstalls it). */
export async function installHoldWatch(page: Page): Promise<void> {
  const config: HoldWatchConfig = {
    nodes: HOLD_NODES,
    interactive: HOLD_INTERACTIVE,
    narration: [...HOLD_NARRATION],
    run: '[data-run]',
    dialog: 'dialog[data-restart-confirm]',
  }
  await page.addInitScript(holdWatchInit, config)
}

/** What the watch recorded in the current document. */
export async function holdWatch(page: Page): Promise<HoldWatchRecord> {
  const record = await page.evaluate(() => {
    const watch = (window as unknown as Record<string, unknown>)['__e2eHoldWatch'] as
      { nodes: unknown[]; inputs: unknown[]; samples: unknown[] } | undefined
    if (watch === undefined) return null
    return { nodes: [...watch.nodes], inputs: [...watch.inputs], samples: [...watch.samples] }
  })
  if (record === null) throw new Error('the hold watch is not installed in this document')
  return record as unknown as HoldWatchRecord
}

/** Marks the element `selector` names, so a snapshot says whether it still holds focus. */
export async function markHoldFocus(page: Page, selector: string): Promise<void> {
  await page.evaluate((wanted) => {
    const element = document.querySelector(wanted)
    if (element === null) throw new Error(`no ${wanted}`)
    ;(window as unknown as Record<string, unknown>)['__e2eHoldMark'] = element
  }, selector)
}

/** The next trusted click takes a sample at each offset (ms) after it, from in-page timers. */
export async function armHoldSamples(page: Page, offsets: readonly number[]): Promise<void> {
  await page.evaluate((list) => {
    const watch = (window as unknown as Record<string, unknown>)['__e2eHoldWatch'] as
      { arm(offsets: number[]): void } | undefined
    if (watch === undefined) throw new Error('the hold watch is not installed in this document')
    watch.arm([...list])
  }, offsets)
}

/** A snapshot taken by an in-page timer `ms` after `stamp` (page time; at once if already past). */
export async function sampleAt(page: Page, stamp: number, ms: number): Promise<HoldSnapshot> {
  return page.evaluate(
    ({ from, delay }) =>
      new Promise<HoldSnapshot>((resolve, reject) => {
        const watch = (window as unknown as Record<string, unknown>)['__e2eHoldWatch'] as
          { snapshot(): HoldSnapshot } | undefined
        if (watch === undefined) {
          reject(new Error('the hold watch is not installed in this document'))
          return
        }
        setTimeout(() => resolve(watch.snapshot()), Math.max(0, from + delay - performance.now()))
      }),
    { from: stamp, delay: ms },
  )
}

/** When `node` first took its own inert at or after `after` (page time), or null. */
export function holdOnset(record: HoldWatchRecord, node: HoldNode, after: number): number | null {
  const stamp = record.nodes.find(
    (entry) => entry.node === node && entry.inert === true && entry.t >= after,
  )
  return stamp === undefined ? null : stamp.t
}

/** When `node` next lost its own inert after `onset`, or null (still held, or gone). */
export function holdRelease(record: HoldWatchRecord, node: HoldNode, onset: number): number | null {
  const stamp = record.nodes.find(
    (entry) => entry.node === node && entry.inert === false && entry.t > onset,
  )
  return stamp === undefined ? null : stamp.t
}

/** The first input of `type` at or after `after` (page time), or undefined. */
export function inputAfter(
  record: HoldWatchRecord,
  type: string,
  after: number,
): HoldInput | undefined {
  return record.inputs.find((input) => input.type === type && input.t >= after)
}
