// Device storage (spec §6.3; P1-4a, owner answers 2026-11-14): the only code that touches
// localStorage. It moves raw text for the two record keys; src/core/progress says what it means.
// - Resolved lazily on first use: nothing runs at import, and on the server (no window) the
//   records simply use memory. Every access is inside try/catch; storage problems never throw.
// - Each record has its own memory fallback. Any storage failure switches that record: storage
//   missing or blocked, or getItem, setItem or removeItem throwing (quota and private mode
//   included). Memory keeps the last good value plus the new change. There is no retry and no
//   probe key for the rest of the page visit.
// - Status per record: mode (unknown before first use, device, memory), the reason, and the
//   resets found this visit, nothing more (owner, 2026-11-14). It is not sent anywhere; the
//   banner is rendered at Step 7.
// - Other tabs' 'storage' events for the two keys reach subscribers. The event's storage area
//   is checked too, so sessionStorage events and other origins' areas are ignored. A subscriber
//   that throws does not stop the others (listeners.ts).
import { RECORD_KEYS, type RecordKey } from '../../core/progress'
import {
  assertListener,
  callListeners,
  rethrowLater,
  type ListenerErrorReporter,
} from './listeners'

/** The part of the Web Storage API used here. window.localStorage satisfies it. */
export interface WebStorageArea {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Where other tabs' 'storage' events arrive. window satisfies it. */
export type StorageEventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

export type StorageMode = 'unknown' | 'device' | 'memory'

export type MemoryReason =
  /** No localStorage, or reading window.localStorage threw (storage blocked). */
  | 'unavailable'
  | 'read-failed'
  | 'write-failed'
  | 'remove-failed'
  /** The stored record has a newer schema: its bytes are left untouched (rollback protection). */
  | 'newer-schema'

export interface RecordStatus {
  readonly mode: StorageMode
  /** Why the record uses memory; null while it does not. */
  readonly reason: MemoryReason | null
  /**
   * Distinct invalid stored values found (and reset on read) this page visit. The same value
   * read again, at any time, is not counted again.
   */
  readonly resets: number
}

export interface DeviceStorageOptions {
  /**
   * Returns the page's localStorage. Called once, on first use; it may throw (storage blocked) or
   * return null. Defaults to window.localStorage, or null when there is no window (server).
   */
  readonly getStorage?: () => WebStorageArea | null | undefined
  /** Defaults to window, or null when there is no window. Called when the first listener joins. */
  readonly getEventSource?: () => StorageEventSource | null | undefined
  /** Receives an error a subscriber threw. Defaults to rethrowing it after the current call. */
  readonly onListenerError?: ListenerErrorReporter
}

export interface DeviceStorage {
  /** The record's raw text: from the device, or from memory after a failure. Never throws. */
  read(key: RecordKey): string | null
  /** Writes the raw text; a failure moves the record to memory, holding this value. */
  write(key: RecordKey, value: string): void
  /** Removes the key; a failure moves the record to memory, holding nothing. */
  remove(key: RecordKey): void
  /**
   * Rollback protection: the stored bytes are newer than this code. They are never read, written
   * or removed again this visit; memory starts from `fallback` (the last good value, or null).
   */
  protect(key: RecordKey, fallback: string | null): void
  /** Counts a reset of this raw value once, however often and whenever the same value is read. */
  noteReset(key: RecordKey, raw: string): void
  getStatus(key: RecordKey): RecordStatus
  /**
   * Another tab changed the key (or cleared the area). Not called for this tab's own writes.
   * A listener that is not a function is a TypeError.
   */
  subscribe(key: RecordKey, listener: () => void): () => void
}

const INITIAL_STATUS: RecordStatus = Object.freeze({
  mode: 'unknown',
  reason: null,
  resets: 0,
})

interface KeyState {
  status: RecordStatus
  /** The value memory holds while the record is in memory mode. */
  memory: string | null
  /** The last value read, written or removed successfully on the device. */
  lastRaw: string | null
  /** Fingerprints of the invalid values already counted as resets this visit. */
  readonly resetsSeen: Set<string>
  readonly listeners: Set<() => void>
}

function pageLocalStorage(): WebStorageArea | null {
  // Reading window.localStorage can itself throw (storage blocked); the caller catches it.
  return typeof window === 'undefined' ? null : window.localStorage
}

function pageEventSource(): StorageEventSource | null {
  return typeof window === 'undefined' ? null : window
}

/**
 * A short fingerprint of a stored value, so resets are counted per distinct value without keeping
 * the text (up to megabytes) in memory: the length plus two 32-bit multiplicative hashes. A
 * collision could only undercount a number that is never sent anywhere.
 */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${text.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`
}

export function createDeviceStorage(options: DeviceStorageOptions = {}): DeviceStorage {
  const getStorage = options.getStorage ?? pageLocalStorage
  const getEventSource = options.getEventSource ?? pageEventSource
  const onListenerError = options.onListenerError ?? rethrowLater
  const states = new Map<RecordKey, KeyState>(
    RECORD_KEYS.map((key) => [
      key,
      {
        status: INITIAL_STATUS,
        memory: null,
        lastRaw: null,
        resetsSeen: new Set(),
        listeners: new Set(),
      },
    ]),
  )
  /** undefined until first use; then the page's storage, or null when it is missing or blocked. */
  let resolution: WebStorageArea | null | undefined
  let eventSource: StorageEventSource | null = null

  function stateOf(key: RecordKey): KeyState {
    const state = states.get(key)
    if (state === undefined) throw new TypeError(`unknown record key ${String(key)}`)
    return state
  }

  function resolve(): WebStorageArea | null {
    if (resolution !== undefined) return resolution
    try {
      resolution = getStorage() ?? null
    } catch {
      resolution = null
    }
    return resolution
  }

  function setStatus(state: KeyState, patch: Partial<RecordStatus>): void {
    const next = { ...state.status, ...patch }
    const same =
      next.mode === state.status.mode &&
      next.reason === state.status.reason &&
      next.resets === state.status.resets
    if (!same) state.status = Object.freeze(next)
  }

  function toMemory(state: KeyState, reason: MemoryReason, memory: string | null): void {
    state.memory = memory
    setStatus(state, { mode: 'memory', reason })
  }

  /** The device storage for this key, or null when the key uses memory (switching it if needed). */
  function deviceFor(state: KeyState): WebStorageArea | null {
    if (state.status.mode === 'memory') return null
    const storage = resolve()
    if (storage === null) {
      toMemory(state, 'unavailable', state.lastRaw)
      return null
    }
    return storage
  }

  function onDevice(state: KeyState, raw: string | null): void {
    state.lastRaw = raw
    setStatus(state, { mode: 'device' })
  }

  function read(key: RecordKey): string | null {
    const state = stateOf(key)
    const storage = deviceFor(state)
    if (storage === null) return state.memory
    try {
      const raw = storage.getItem(key)
      const value = typeof raw === 'string' ? raw : null
      onDevice(state, value)
      return value
    } catch {
      toMemory(state, 'read-failed', state.lastRaw)
      return state.memory
    }
  }

  function write(key: RecordKey, value: string): void {
    const state = stateOf(key)
    const storage = deviceFor(state)
    if (storage === null) {
      state.memory = value
      return
    }
    try {
      storage.setItem(key, value)
      onDevice(state, value)
    } catch {
      toMemory(state, 'write-failed', value)
    }
  }

  function remove(key: RecordKey): void {
    const state = stateOf(key)
    const storage = deviceFor(state)
    if (storage === null) {
      state.memory = null
      return
    }
    try {
      storage.removeItem(key)
      onDevice(state, null)
    } catch {
      toMemory(state, 'remove-failed', null)
    }
  }

  function protect(key: RecordKey, fallback: string | null): void {
    const state = stateOf(key)
    if (state.status.mode === 'memory') return
    toMemory(state, 'newer-schema', fallback)
  }

  function noteReset(key: RecordKey, raw: string): void {
    const state = stateOf(key)
    const seen = fingerprint(raw)
    if (state.resetsSeen.has(seen)) return
    state.resetsSeen.add(seen)
    setStatus(state, { resets: state.status.resets + 1 })
  }

  function onStorageEvent(event: Event): void {
    const { key, storageArea } = event as Event & { key?: unknown; storageArea?: unknown }
    const storage = resolve()
    if (storage === null || storageArea !== storage) return
    for (const recordKey of RECORD_KEYS) {
      // A null key means the whole area was cleared, which removes both records.
      if (key !== recordKey && key !== null) continue
      const state = stateOf(recordKey)
      // A record in memory no longer follows the device; other tabs' changes do not reach it.
      if (state.status.mode === 'memory') continue
      callListeners(state.listeners, onListenerError)
    }
  }

  function listenerCount(): number {
    let count = 0
    for (const state of states.values()) count += state.listeners.size
    return count
  }

  function startListening(): void {
    if (eventSource !== null) return
    resolve()
    try {
      eventSource = getEventSource() ?? null
      eventSource?.addEventListener('storage', onStorageEvent)
    } catch {
      eventSource = null
    }
  }

  function stopListening(): void {
    if (eventSource === null) return
    const source = eventSource
    eventSource = null
    try {
      source.removeEventListener('storage', onStorageEvent)
    } catch {
      // Nothing to undo: the listener is gone with the page either way.
    }
  }

  function subscribe(key: RecordKey, listener: () => void): () => void {
    assertListener(listener)
    const state = stateOf(key)
    state.listeners.add(listener)
    startListening()
    return () => {
      state.listeners.delete(listener)
      if (listenerCount() === 0) stopListening()
    }
  }

  return {
    read,
    write,
    remove,
    protect,
    noteReset,
    getStatus: (key) => stateOf(key).status,
    subscribe,
  }
}
