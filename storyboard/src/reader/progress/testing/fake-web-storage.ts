// Fake Web Storage for unit tests (P1-4a). Map-backed: no jsdom and no new dependency.
// It follows the parts of the Web Storage standard the progress code relies on:
// - keys and values are strings (String() of what is passed); a missing key reads as null;
// - a byte quota like a browser's: each entry costs (key length + value length) x 2 bytes, as
//   UTF-16; a setItem that would pass the quota throws QuotaExceededError and changes nothing;
// - several fake tabs of one origin share one storage area. A change in one tab queues a
//   'storage' event for every other tab, whose storageArea is that tab's own Storage object;
//   setting the same value, removing a missing key or clearing an empty area queues nothing.
//   Events are delivered only when the test calls flushEvents(), so tests choose the interleaving.
// Tests can also make any method throw (once or always) and read a log of every call.
import type { WebStorageArea } from '../device-storage'

/** Chromium's per-origin quota: 10 MiB counted as UTF-16, so 5 Mi characters. */
export const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024

export const FAKE_ORIGIN_URL = 'https://storyboard.test/'

export type StorageMethod = 'getItem' | 'setItem' | 'removeItem' | 'key' | 'clear'

export interface StorageChange {
  readonly key: string | null
  readonly oldValue: string | null
  readonly newValue: string | null
}

export interface FakeStorageEventInit extends StorageChange {
  readonly storageArea: FakeWebStorage | null
  readonly url: string
}

/** Node has no StorageEvent; this carries the same fields. */
export class FakeStorageEvent extends Event {
  readonly key: string | null
  readonly oldValue: string | null
  readonly newValue: string | null
  readonly storageArea: FakeWebStorage | null
  readonly url: string

  constructor(type: string, init: FakeStorageEventInit) {
    super(type)
    this.key = init.key
    this.oldValue = init.oldValue
    this.newValue = init.newValue
    this.storageArea = init.storageArea
    this.url = init.url
  }
}

/** One origin's storage: the data every tab's localStorage object reads and writes. */
export class FakeStorageArea {
  readonly data = new Map<string, string>()

  constructor(readonly quotaBytes: number = DEFAULT_QUOTA_BYTES) {}

  bytesUsed(): number {
    let bytes = 0
    for (const [key, value] of this.data) bytes += entryBytes(key, value)
    return bytes
  }
}

function entryBytes(key: string, value: string): number {
  return (key.length + value.length) * 2
}

export function quotaExceeded(): DOMException {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError')
}

export function securityError(): DOMException {
  return new DOMException('The operation is insecure.', 'SecurityError')
}

export interface FakeWebStorageOptions {
  readonly quotaBytes?: number
  /** Shares an area with other tabs; a standalone storage gets its own. */
  readonly area?: FakeStorageArea
  /** Called after every real change (used by FakeOrigin to queue 'storage' events). */
  readonly onChange?: (change: StorageChange) => void
}

interface Failure {
  readonly error: unknown
  remaining: number
}

export class FakeWebStorage implements WebStorageArea {
  /** Every call, in order, including the ones that threw: "getItem reader.v1.progress", ... */
  readonly calls: string[] = []
  readonly #area: FakeStorageArea
  readonly #onChange: ((change: StorageChange) => void) | undefined
  readonly #failures = new Map<StorageMethod, Failure>()

  constructor(options: FakeWebStorageOptions = {}) {
    this.#area = options.area ?? new FakeStorageArea(options.quotaBytes)
    this.#onChange = options.onChange
  }

  get length(): number {
    return this.#area.data.size
  }

  get quotaBytes(): number {
    return this.#area.quotaBytes
  }

  bytesUsed(): number {
    return this.#area.bytesUsed()
  }

  /** The next call of `method` throws `error`. */
  failNext(method: StorageMethod, error: unknown = securityError()): void {
    this.#failures.set(method, { error, remaining: 1 })
  }

  /** Every call of `method` throws `error` until heal(). */
  failAlways(method: StorageMethod, error: unknown = securityError()): void {
    this.#failures.set(method, { error, remaining: Number.POSITIVE_INFINITY })
  }

  heal(): void {
    this.#failures.clear()
  }

  /** Counts the logged calls of one method, optionally for one key. */
  count(method: StorageMethod, key?: string): number {
    const prefix = key === undefined ? method : `${method} ${key}`
    return this.calls.filter((c) => c === prefix || c.startsWith(`${prefix} `)).length
  }

  key(index: number): string | null {
    this.#log('key', String(index))
    if (!Number.isInteger(index) || index < 0) return null
    return [...this.#area.data.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    const name = String(key)
    this.#log('getItem', name)
    return this.#area.data.get(name) ?? null
  }

  setItem(key: string, value: string): void {
    const name = String(key)
    this.#log('setItem', name)
    const text = String(value)
    const old = this.#area.data.get(name) ?? null
    if (old === text) return
    const used = this.#area.bytesUsed() - (old === null ? 0 : entryBytes(name, old))
    if (used + entryBytes(name, text) > this.#area.quotaBytes) throw quotaExceeded()
    this.#area.data.set(name, text)
    this.#onChange?.({ key: name, oldValue: old, newValue: text })
  }

  removeItem(key: string): void {
    const name = String(key)
    this.#log('removeItem', name)
    const old = this.#area.data.get(name) ?? null
    if (old === null) return
    this.#area.data.delete(name)
    this.#onChange?.({ key: name, oldValue: old, newValue: null })
  }

  clear(): void {
    this.#log('clear', null)
    if (this.#area.data.size === 0) return
    this.#area.data.clear()
    this.#onChange?.({ key: null, oldValue: null, newValue: null })
  }

  #log(method: StorageMethod, key: string | null): void {
    this.calls.push(key === null ? method : `${method} ${key}`)
    const failure = this.#failures.get(method)
    if (failure === undefined) return
    failure.remaining -= 1
    if (failure.remaining <= 0) this.#failures.delete(method)
    throw failure.error
  }
}

export interface FakeTab {
  /** Receives this tab's 'storage' events. */
  readonly window: EventTarget
  readonly localStorage: FakeWebStorage
}

/** Several tabs of one origin sharing one localStorage area. */
export class FakeOrigin {
  readonly area: FakeStorageArea
  readonly #tabs: FakeTab[] = []
  readonly #queue: { readonly tab: FakeTab; readonly event: FakeStorageEvent }[] = []

  constructor(options: { readonly quotaBytes?: number } = {}) {
    this.area = new FakeStorageArea(options.quotaBytes)
  }

  openTab(): FakeTab {
    const tab: FakeTab = {
      window: new EventTarget(),
      localStorage: new FakeWebStorage({
        area: this.area,
        onChange: (change) => this.#broadcast(tab, change),
      }),
    }
    this.#tabs.push(tab)
    return tab
  }

  get pendingEvents(): number {
    return this.#queue.length
  }

  /** Delivers every queued 'storage' event, in order. Returns how many were delivered. */
  flushEvents(): number {
    let delivered = 0
    while (this.#queue.length > 0) {
      const next = this.#queue.shift()
      if (next === undefined) break
      next.tab.window.dispatchEvent(next.event)
      delivered++
    }
    return delivered
  }

  #broadcast(from: FakeTab, change: StorageChange): void {
    for (const tab of this.#tabs) {
      if (tab === from) continue
      const event = new FakeStorageEvent('storage', {
        ...change,
        storageArea: tab.localStorage,
        url: FAKE_ORIGIN_URL,
      })
      this.#queue.push({ tab, event })
    }
  }
}
