// PrefsStore (spec §6.3; P1-4a, owner answers 2026-11-14): synchronous, shaped for React's
// useSyncExternalStore (getSnapshot, getServerSnapshot, subscribe).
// - The server and hydration use the defaults (getServerSnapshot). The first browser getSnapshot
//   reads storage once; the same object comes back until the prefs change (an update here, or
//   another tab's 'storage' event). Nothing reads storage at import or on the server.
// - Other tabs' changes are heard only while someone is subscribed. When a first subscriber joins
//   (the first ever, or again after everyone left) and a snapshot was already read, it is read
//   again, so a change made meanwhile is not missed (the object stays the same when the values
//   did not change).
// - Values: uiLocale 'en' | 'hi' | null (not chosen), textScale 100 | 125 | 150 (default 100),
//   readToMe (default false). An invalid value in update() is a TypeError; storage problems
//   never throw (the device storage falls back to memory).
// - update() re-reads the stored record and changes only the fields it is given.
// - Subscribers hear changes of the prefs and of getStatus(). getSnapshot runs during a React
//   render, where subscribers must not be called, so a status change its read finds (first use,
//   storage blocked, a newer schema, a reset) is announced in a microtask. A subscriber that
//   throws never reaches the caller or stops the others (listeners.ts).
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  PrefsPatchSchema,
  RECORD_SCHEMA,
  prefsOf,
  readPrefs,
  serializePrefs,
  type Prefs,
  type PrefsPatch,
  type PrefsRecord,
} from '../../core/progress'
import type { DeviceStorage, RecordStatus } from './device-storage'
import {
  assertListener,
  callListeners,
  rethrowLater,
  type ListenerErrorReporter,
} from './listeners'

export interface PrefsStore {
  /** In the browser: the stored prefs (read once, on the first call). On the server: defaults. */
  getSnapshot(): Prefs
  /** Always the defaults, so server HTML and hydration agree. */
  getServerSnapshot(): Prefs
  /** Changes the given fields. Throws a TypeError for an unknown field or an invalid value. */
  update(patch: PrefsPatch): void
  getStatus(): RecordStatus
  /**
   * This tab's updates, other tabs' changes to reader.v1.prefs, and changes of getStatus().
   * A listener that is not a function is a TypeError.
   */
  subscribe(listener: () => void): () => void
}

export interface PrefsStoreOptions {
  readonly device: DeviceStorage
  /** Defaults to "a window exists". On the server nothing touches storage. */
  readonly isBrowser?: () => boolean
  /** Receives an error a subscriber threw. Defaults to rethrowing it after the current call. */
  readonly onListenerError?: ListenerErrorReporter
}

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function samePrefs(a: Prefs, b: Prefs): boolean {
  return a.uiLocale === b.uiLocale && a.textScale === b.textScale && a.readToMe === b.readToMe
}

function parsePatch(patch: unknown): PrefsPatch {
  const result = PrefsPatchSchema.safeParse(patch)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue === undefined || issue.path.length === 0 ? 'patch' : issue.path.join('.')
  throw new TypeError(`invalid prefs update: ${where}: ${issue?.message ?? 'unknown issue'}`)
}

export function createPrefsStore({
  device,
  isBrowser = hasWindow,
  onListenerError = rethrowLater,
}: PrefsStoreOptions): PrefsStore {
  const listeners = new Set<() => void>()
  let unsubscribeDevice: (() => void) | null = null
  /** null until the first browser read. */
  let snapshot: Prefs | null = null
  /** The last raw value read (not newer than this code) or written: memory's start if needed. */
  let lastGood: string | null = null
  let notifyQueued = false

  function notify(): void {
    callListeners(listeners, onListenerError)
  }

  /** One notification after the current call (and the render it may be part of). */
  function notifyLater(): void {
    if (notifyQueued) return
    notifyQueued = true
    queueMicrotask(() => {
      notifyQueued = false
      notify()
    })
  }

  function statusChangedSince(before: RecordStatus): boolean {
    // A status object stays the same until the status changes, so identity is enough.
    return device.getStatus(PREFS_KEY) !== before
  }

  function readRecord(): { readonly raw: string | null; readonly record: PrefsRecord } {
    // At most two reads: after protect() the record comes from memory, never a newer schema.
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = device.read(PREFS_KEY)
      const result = readPrefs(raw)
      if (result.kind === 'newer-schema') {
        device.protect(PREFS_KEY, lastGood)
        continue
      }
      if (raw !== null && result.issues.length > 0) device.noteReset(PREFS_KEY, raw)
      lastGood = raw
      return { raw, record: result.record }
    }
    return { raw: null, record: { schema: RECORD_SCHEMA, ...DEFAULT_PREFS } }
  }

  /** Takes the record as the snapshot; true when the visible prefs changed. */
  function adopt(record: PrefsRecord): boolean {
    const next = prefsOf(record)
    if (snapshot !== null && samePrefs(snapshot, next)) return false
    snapshot = Object.freeze(next)
    return true
  }

  function getSnapshot(): Prefs {
    if (!isBrowser()) return DEFAULT_PREFS
    if (snapshot === null) {
      const statusBefore = device.getStatus(PREFS_KEY)
      adopt(readRecord().record)
      if (statusChangedSince(statusBefore)) notifyLater()
    }
    return snapshot ?? DEFAULT_PREFS
  }

  function update(patch: PrefsPatch): void {
    const valid = parsePatch(patch)
    if (!isBrowser()) return
    const statusBefore = device.getStatus(PREFS_KEY)
    const { raw, record } = readRecord()
    // undefined means "not given"; null is a real uiLocale value (not chosen).
    const next: PrefsRecord = {
      schema: RECORD_SCHEMA,
      uiLocale: valid.uiLocale === undefined ? record.uiLocale : valid.uiLocale,
      textScale: valid.textScale ?? record.textScale,
      readToMe: valid.readToMe ?? record.readToMe,
    }
    const text = serializePrefs(next)
    if (text !== raw) {
      device.write(PREFS_KEY, text)
      lastGood = text
    }
    const changed = adopt(next)
    if (changed || statusChangedSince(statusBefore)) notify()
  }

  function onOtherTab(): void {
    // Before the first read there is no snapshot to refresh; subscribers read on their next call.
    if (snapshot === null) {
      notify()
      return
    }
    const statusBefore = device.getStatus(PREFS_KEY)
    const changed = adopt(readRecord().record)
    if (changed || statusChangedSince(statusBefore)) notify()
  }

  /**
   * A first subscriber joins: other tabs were not heard while nobody was subscribed, so a snapshot
   * already read is read again. React checks getSnapshot right after subscribing; other callers
   * hear a change after this call returns.
   */
  function catchUp(): void {
    if (snapshot === null || !isBrowser()) return
    const statusBefore = device.getStatus(PREFS_KEY)
    const changed = adopt(readRecord().record)
    if (changed || statusChangedSince(statusBefore)) notifyLater()
  }

  function subscribe(listener: () => void): () => void {
    assertListener(listener)
    listeners.add(listener)
    if (unsubscribeDevice === null) {
      unsubscribeDevice = device.subscribe(PREFS_KEY, onOtherTab)
      catchUp()
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && unsubscribeDevice !== null) {
        unsubscribeDevice()
        unsubscribeDevice = null
      }
    }
  }

  return {
    getSnapshot,
    getServerSnapshot: () => DEFAULT_PREFS,
    update,
    getStatus: () => device.getStatus(PREFS_KEY),
    subscribe,
  }
}
