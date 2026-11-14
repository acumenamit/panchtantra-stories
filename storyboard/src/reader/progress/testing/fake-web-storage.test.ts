import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUOTA_BYTES,
  FAKE_ORIGIN_URL,
  FakeOrigin,
  FakeStorageEvent,
  FakeWebStorage,
  quotaExceeded,
} from './fake-web-storage'
import { describeWebStorageContract } from './storage-contract'

// The same device-level tests a real Web Storage passes (the owner's parity run uses Node's
// sessionStorage with them).
describeWebStorageContract('FakeWebStorage', () => new FakeWebStorage())
describeWebStorageContract('a FakeOrigin tab', () => new FakeOrigin().openTab().localStorage)

function errorName(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return error instanceof DOMException ? error.name : 'not a DOMException'
  }
  return 'no error'
}

describe('FakeWebStorage quota', () => {
  it('counts each entry as (key length + value length) x 2 bytes, like UTF-16', () => {
    const storage = new FakeWebStorage()
    storage.setItem('ab', 'cde')
    expect(storage.bytesUsed()).toBe(10)
    expect(storage.quotaBytes).toBe(DEFAULT_QUOTA_BYTES)
  })

  it('throws QuotaExceededError past the quota and changes nothing', () => {
    const storage = new FakeWebStorage({ quotaBytes: 20 })
    storage.setItem('k', 'abcd') // 10 bytes
    expect(errorName(() => storage.setItem('k2', 'abcdef'))).toBe('QuotaExceededError')
    expect(storage.getItem('k2')).toBeNull()
    expect(storage.getItem('k')).toBe('abcd')
    expect(storage.bytesUsed()).toBe(10)
  })

  it('counts a replaced value once, so a value can grow up to the quota in place', () => {
    const storage = new FakeWebStorage({ quotaBytes: 20 })
    storage.setItem('k', 'abcd')
    storage.setItem('k', 'abcdefghi') // (1 + 9) x 2 = 20
    expect(storage.getItem('k')).toBe('abcdefghi')
    expect(errorName(() => storage.setItem('k', 'abcdefghij'))).toBe('QuotaExceededError')
    expect(storage.getItem('k')).toBe('abcdefghi')
  })
})

describe('FakeWebStorage failure injection and call log', () => {
  it('logs every call, including the ones that throw', () => {
    const storage = new FakeWebStorage()
    storage.setItem('a', '1')
    storage.getItem('a')
    storage.failNext('removeItem')
    expect(() => storage.removeItem('a')).toThrow()
    storage.key(0)
    storage.clear()
    expect(storage.calls).toEqual(['setItem a', 'getItem a', 'removeItem a', 'key 0', 'clear'])
    expect(storage.count('getItem')).toBe(1)
    expect(storage.count('setItem', 'a')).toBe(1)
    expect(storage.count('setItem', 'b')).toBe(0)
  })

  it('failNext throws once with the given error, then works again', () => {
    const storage = new FakeWebStorage()
    storage.failNext('setItem', quotaExceeded())
    expect(errorName(() => storage.setItem('a', '1'))).toBe('QuotaExceededError')
    expect(storage.getItem('a')).toBeNull()
    storage.setItem('a', '1')
    expect(storage.getItem('a')).toBe('1')
  })

  it('failAlways throws a SecurityError by default until heal()', () => {
    const storage = new FakeWebStorage()
    storage.failAlways('getItem')
    expect(errorName(() => storage.getItem('a'))).toBe('SecurityError')
    expect(errorName(() => storage.getItem('a'))).toBe('SecurityError')
    storage.heal()
    expect(storage.getItem('a')).toBeNull()
  })
})

describe('FakeOrigin tabs', () => {
  function events(tab: { window: EventTarget }): FakeStorageEvent[] {
    const seen: FakeStorageEvent[] = []
    tab.window.addEventListener('storage', (e) => seen.push(e as FakeStorageEvent))
    return seen
  }

  it('share one storage area', () => {
    const origin = new FakeOrigin()
    const a = origin.openTab()
    const b = origin.openTab()
    a.localStorage.setItem('k', 'v')
    expect(b.localStorage.getItem('k')).toBe('v')
    expect(origin.area.bytesUsed()).toBe(4)
  })

  it('queue a storage event for every other tab, never for the tab that wrote', () => {
    const origin = new FakeOrigin()
    const a = origin.openTab()
    const b = origin.openTab()
    const c = origin.openTab()
    const [seenA, seenB, seenC] = [events(a), events(b), events(c)]
    a.localStorage.setItem('k', 'v1')
    expect(seenB).toHaveLength(0)
    expect(origin.pendingEvents).toBe(2)
    expect(origin.flushEvents()).toBe(2)
    expect(seenA).toHaveLength(0)
    expect(seenB).toHaveLength(1)
    expect(seenC).toHaveLength(1)
    const event = seenB[0]
    expect(event?.type).toBe('storage')
    expect(event?.key).toBe('k')
    expect(event?.oldValue).toBeNull()
    expect(event?.newValue).toBe('v1')
    expect(event?.url).toBe(FAKE_ORIGIN_URL)
    // The storage area is the receiving tab's own Storage object, as in a browser.
    expect(event?.storageArea).toBe(b.localStorage)
    expect(seenC[0]?.storageArea).toBe(c.localStorage)
  })

  it('send nothing for a same-value set, a missing-key removal or clearing an empty area', () => {
    const origin = new FakeOrigin()
    const a = origin.openTab()
    origin.openTab()
    a.localStorage.setItem('k', 'v')
    origin.flushEvents()
    a.localStorage.setItem('k', 'v')
    a.localStorage.removeItem('missing')
    expect(origin.pendingEvents).toBe(0)
    a.localStorage.clear()
    expect(origin.pendingEvents).toBe(1)
    origin.flushEvents()
    a.localStorage.clear()
    expect(origin.pendingEvents).toBe(0)
  })

  it('send key null for clear() and the old value for removeItem()', () => {
    const origin = new FakeOrigin()
    const a = origin.openTab()
    const seen = events(origin.openTab())
    a.localStorage.setItem('k', 'v')
    a.localStorage.removeItem('k')
    a.localStorage.setItem('k', 'w')
    a.localStorage.clear()
    origin.flushEvents()
    expect(seen.map((e) => [e.key, e.oldValue, e.newValue])).toEqual([
      ['k', null, 'v'],
      ['k', 'v', null],
      ['k', null, 'w'],
      [null, null, null],
    ])
  })

  it('send nothing when a write fails', () => {
    const origin = new FakeOrigin({ quotaBytes: 8 })
    const a = origin.openTab()
    origin.openTab()
    expect(errorName(() => a.localStorage.setItem('key', 'value'))).toBe('QuotaExceededError')
    a.localStorage.failNext('removeItem')
    expect(() => a.localStorage.removeItem('key')).toThrow()
    expect(origin.pendingEvents).toBe(0)
  })
})
