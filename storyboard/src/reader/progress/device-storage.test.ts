import { describe, expect, it } from 'vitest'
import { PREFS_KEY, PROGRESS_KEY, RECORD_KEYS } from '../../core/progress'
import {
  createDeviceStorage,
  type DeviceStorageOptions,
  type StorageEventSource,
} from './device-storage'
import {
  FakeOrigin,
  FakeStorageEvent,
  FakeWebStorage,
  quotaExceeded,
  securityError,
} from './testing/fake-web-storage'

function setup(storage = new FakeWebStorage(), options: DeviceStorageOptions = {}) {
  let resolved = 0
  const device = createDeviceStorage({
    getStorage: () => {
      resolved++
      return storage
    },
    getEventSource: () => null,
    ...options,
  })
  return { device, storage, resolutions: () => resolved }
}

/** Every key the code under test touched, from the fake's call log. */
function keysTouched(storage: FakeWebStorage): Set<string> {
  return new Set(storage.calls.map((c) => c.split(' ')[1] ?? ''))
}

describe('lazy resolution', () => {
  it('resolves nothing when created, and storage once on first use', () => {
    const t = setup()
    expect(t.resolutions()).toBe(0)
    expect(t.device.getStatus(PROGRESS_KEY)).toEqual({
      mode: 'unknown',
      reason: null,
      resets: 0,
    })
    t.device.read(PROGRESS_KEY)
    t.device.write(PREFS_KEY, 'x')
    t.device.remove(PROGRESS_KEY)
    t.device.read(PREFS_KEY)
    expect(t.resolutions()).toBe(1)
  })

  it('reports device mode per record only after that record is used', () => {
    const t = setup()
    t.device.read(PROGRESS_KEY)
    expect(t.device.getStatus(PROGRESS_KEY).mode).toBe('device')
    expect(t.device.getStatus(PREFS_KEY).mode).toBe('unknown')
  })

  it('uses memory with no window (the server), touching nothing and never throwing', () => {
    const device = createDeviceStorage()
    expect(typeof window).toBe('undefined')
    expect(device.read(PROGRESS_KEY)).toBeNull()
    device.write(PROGRESS_KEY, 'kept in memory')
    expect(device.read(PROGRESS_KEY)).toBe('kept in memory')
    expect(device.getStatus(PROGRESS_KEY)).toEqual({
      mode: 'memory',
      reason: 'unavailable',
      resets: 0,
    })
    expect(() => device.subscribe(PROGRESS_KEY, () => {})()).not.toThrow()
  })

  it('uses memory when localStorage is missing', () => {
    const device = createDeviceStorage({ getStorage: () => undefined })
    device.write(PREFS_KEY, 'p')
    expect(device.read(PREFS_KEY)).toBe('p')
    expect(device.getStatus(PREFS_KEY).reason).toBe('unavailable')
  })

  it('uses memory when reading window.localStorage throws (storage blocked)', () => {
    let calls = 0
    const device = createDeviceStorage({
      getStorage: () => {
        calls++
        throw securityError()
      },
    })
    expect(device.read(PROGRESS_KEY)).toBeNull()
    expect(device.read(PREFS_KEY)).toBeNull()
    expect(device.getStatus(PROGRESS_KEY)).toEqual({
      mode: 'memory',
      reason: 'unavailable',
      resets: 0,
    })
    expect(device.getStatus(PREFS_KEY).reason).toBe('unavailable')
    expect(calls).toBe(1)
  })
})

describe('device mode', () => {
  it('reads, writes and removes the record keys, and nothing else (no probe key)', () => {
    const t = setup()
    expect(t.device.read(PROGRESS_KEY)).toBeNull()
    t.device.write(PROGRESS_KEY, '{"a":1}')
    expect(t.storage.getItem(PROGRESS_KEY)).toBe('{"a":1}')
    expect(t.device.read(PROGRESS_KEY)).toBe('{"a":1}')
    t.device.write(PREFS_KEY, 'p')
    t.device.remove(PROGRESS_KEY)
    expect(t.storage.getItem(PROGRESS_KEY)).toBeNull()
    expect(
      [...keysTouched(t.storage)].every((k) => (RECORD_KEYS as readonly string[]).includes(k)),
    ).toBe(true)
  })

  it('keeps the same status object until the status changes', () => {
    const t = setup()
    t.device.read(PROGRESS_KEY)
    const first = t.device.getStatus(PROGRESS_KEY)
    t.device.read(PROGRESS_KEY)
    t.device.write(PROGRESS_KEY, 'x')
    expect(t.device.getStatus(PROGRESS_KEY)).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
  })
})

describe('memory fallback, per record, with no retry', () => {
  it('a failed getItem keeps the last good value in memory and stops touching the device', () => {
    const t = setup()
    t.device.write(PROGRESS_KEY, 'good')
    t.storage.failNext('getItem')
    expect(t.device.read(PROGRESS_KEY)).toBe('good')
    expect(t.device.getStatus(PROGRESS_KEY)).toEqual({
      mode: 'memory',
      reason: 'read-failed',
      resets: 0,
    })
    const before = t.storage.calls.length
    t.device.write(PROGRESS_KEY, 'newer')
    expect(t.device.read(PROGRESS_KEY)).toBe('newer')
    t.device.remove(PROGRESS_KEY)
    expect(t.device.read(PROGRESS_KEY)).toBeNull()
    expect(t.storage.calls.length).toBe(before)
    expect(t.storage.getItem(PROGRESS_KEY)).toBe('good')
  })

  it('a failed first getItem starts memory empty', () => {
    const t = setup()
    t.storage.failNext('getItem')
    expect(t.device.read(PROGRESS_KEY)).toBeNull()
    expect(t.device.getStatus(PROGRESS_KEY).reason).toBe('read-failed')
  })

  it('a failed setItem (quota) keeps the new value in memory; the device keeps the old one', () => {
    const t = setup()
    t.device.write(PROGRESS_KEY, 'old')
    t.storage.failNext('setItem', quotaExceeded())
    t.device.write(PROGRESS_KEY, 'new')
    expect(t.device.read(PROGRESS_KEY)).toBe('new')
    expect(t.storage.getItem(PROGRESS_KEY)).toBe('old')
    expect(t.device.getStatus(PROGRESS_KEY)).toEqual({
      mode: 'memory',
      reason: 'write-failed',
      resets: 0,
    })
  })

  it('a real quota overflow switches to memory too', () => {
    const t = setup(new FakeWebStorage({ quotaBytes: 64 }))
    t.device.write(PROGRESS_KEY, 'x'.repeat(100))
    expect(t.device.getStatus(PROGRESS_KEY)).toEqual({
      mode: 'memory',
      reason: 'write-failed',
      resets: 0,
    })
    expect(t.device.read(PROGRESS_KEY)).toBe('x'.repeat(100))
    expect(t.storage.getItem(PROGRESS_KEY)).toBeNull()
  })

  it('a failed removeItem leaves memory empty', () => {
    const t = setup()
    t.device.write(PREFS_KEY, 'p')
    t.storage.failNext('removeItem')
    t.device.remove(PREFS_KEY)
    expect(t.device.read(PREFS_KEY)).toBeNull()
    expect(t.device.getStatus(PREFS_KEY).reason).toBe('remove-failed')
    expect(t.storage.getItem(PREFS_KEY)).toBe('p')
  })

  it('never retries: a healed storage stays unused for the rest of the visit', () => {
    const t = setup()
    t.storage.failNext('setItem', quotaExceeded())
    t.device.write(PROGRESS_KEY, 'a')
    const before = t.storage.count('getItem') + t.storage.count('setItem')
    for (let i = 0; i < 5; i++) {
      t.device.write(PROGRESS_KEY, `v${i}`)
      t.device.read(PROGRESS_KEY)
    }
    expect(t.storage.count('getItem') + t.storage.count('setItem')).toBe(before)
  })

  it('keeps each record separate: progress in memory, prefs still on the device', () => {
    const t = setup()
    t.storage.failNext('setItem', quotaExceeded())
    t.device.write(PROGRESS_KEY, 'progress')
    t.device.write(PREFS_KEY, 'prefs')
    expect(t.device.getStatus(PROGRESS_KEY).mode).toBe('memory')
    expect(t.device.getStatus(PREFS_KEY).mode).toBe('device')
    expect(t.storage.getItem(PREFS_KEY)).toBe('prefs')
  })

  it('the status carries mode, reason and resets only (owner, 2026-11-14)', () => {
    const t = setup()
    t.storage.failNext('setItem', quotaExceeded())
    t.device.write(PROGRESS_KEY, 'x')
    expect(Object.keys(t.device.getStatus(PROGRESS_KEY)).sort()).toEqual([
      'mode',
      'reason',
      'resets',
    ])
  })
})

describe('rollback protection and resets', () => {
  it('protect() leaves the stored bytes untouched and uses memory from the fallback', () => {
    const t = setup()
    t.storage.setItem(PROGRESS_KEY, '{"schema":2}')
    t.device.read(PROGRESS_KEY)
    t.device.protect(PROGRESS_KEY, 'last good')
    const before = t.storage.calls.length
    expect(t.device.read(PROGRESS_KEY)).toBe('last good')
    t.device.write(PROGRESS_KEY, 'mine')
    t.device.remove(PROGRESS_KEY)
    expect(t.storage.calls.length).toBe(before)
    expect(t.storage.getItem(PROGRESS_KEY)).toBe('{"schema":2}')
    expect(t.device.getStatus(PROGRESS_KEY)).toEqual({
      mode: 'memory',
      reason: 'newer-schema',
      resets: 0,
    })
    expect(t.device.getStatus(PREFS_KEY).mode).toBe('unknown')
  })

  it('counts each distinct invalid value once', () => {
    const t = setup()
    t.device.noteReset(PREFS_KEY, 'bad-1')
    t.device.noteReset(PREFS_KEY, 'bad-1')
    expect(t.device.getStatus(PREFS_KEY).resets).toBe(1)
    t.device.noteReset(PREFS_KEY, 'bad-2')
    expect(t.device.getStatus(PREFS_KEY).resets).toBe(2)
    expect(t.device.getStatus(PROGRESS_KEY).resets).toBe(0)
  })

  it('counts a value read again later only once, even after another value (A, B, A, B, A)', () => {
    const t = setup()
    const first = t.device.getStatus(PROGRESS_KEY)
    for (const raw of ['{"a"', '{"b"', '{"a"', '{"b"', '{"a"'])
      t.device.noteReset(PROGRESS_KEY, raw)
    expect(t.device.getStatus(PROGRESS_KEY).resets).toBe(2)
    expect(t.device.getStatus(PROGRESS_KEY)).not.toBe(first)
    // Values that differ only late in a long text, or only in length, are still distinct.
    const long = 'x'.repeat(200_000)
    t.device.noteReset(PROGRESS_KEY, `${long}1`)
    t.device.noteReset(PROGRESS_KEY, `${long}2`)
    t.device.noteReset(PROGRESS_KEY, long)
    t.device.noteReset(PROGRESS_KEY, `${long}1`)
    expect(t.device.getStatus(PROGRESS_KEY).resets).toBe(5)
  })
})

describe("other tabs' storage events", () => {
  function twoTabs() {
    const origin = new FakeOrigin()
    const mine = origin.openTab()
    const other = origin.openTab()
    let sourceCalls = 0
    const device = createDeviceStorage({
      getStorage: () => mine.localStorage,
      getEventSource: () => {
        sourceCalls++
        return mine.window
      },
    })
    const heard: string[] = []
    return { origin, mine, other, device, heard, sourceCalls: () => sourceCalls }
  }

  it('attaches no listener until the first subscriber', () => {
    const t = twoTabs()
    t.device.read(PROGRESS_KEY)
    expect(t.sourceCalls()).toBe(0)
    t.device.subscribe(PROGRESS_KEY, () => {})
    expect(t.sourceCalls()).toBe(1)
  })

  it('notifies only the subscribers of the changed key', () => {
    const t = twoTabs()
    t.device.subscribe(PROGRESS_KEY, () => t.heard.push('progress'))
    t.device.subscribe(PREFS_KEY, () => t.heard.push('prefs'))
    t.other.localStorage.setItem(PROGRESS_KEY, 'x')
    t.other.localStorage.setItem('unrelated', 'y')
    t.other.localStorage.setItem(PREFS_KEY, 'z')
    t.origin.flushEvents()
    expect(t.heard).toEqual(['progress', 'prefs'])
  })

  it("ignores events from another storage area (sessionStorage, another origin's area)", () => {
    const t = twoTabs()
    t.device.subscribe(PROGRESS_KEY, () => t.heard.push('progress'))
    const sessionArea = new FakeWebStorage()
    for (const storageArea of [sessionArea, null, t.other.localStorage]) {
      t.mine.window.dispatchEvent(
        new FakeStorageEvent('storage', {
          key: PROGRESS_KEY,
          oldValue: null,
          newValue: 'x',
          storageArea,
          url: 'https://storyboard.test/',
        }),
      )
    }
    expect(t.heard).toEqual([])
  })

  it('treats a clear() in another tab (key null) as a change to both records', () => {
    const t = twoTabs()
    t.device.subscribe(PROGRESS_KEY, () => t.heard.push('progress'))
    t.device.subscribe(PREFS_KEY, () => t.heard.push('prefs'))
    t.other.localStorage.setItem('k', 'v')
    t.other.localStorage.clear()
    t.origin.flushEvents()
    expect(t.heard).toEqual(['progress', 'prefs'])
  })

  it('does not hear its own writes (browsers send storage events to other tabs only)', () => {
    const t = twoTabs()
    t.device.subscribe(PROGRESS_KEY, () => t.heard.push('progress'))
    t.device.write(PROGRESS_KEY, 'mine')
    t.origin.flushEvents()
    expect(t.heard).toEqual([])
  })

  it('stops notifying a record that moved to memory', () => {
    const t = twoTabs()
    t.device.subscribe(PROGRESS_KEY, () => t.heard.push('progress'))
    t.mine.localStorage.failNext('setItem', quotaExceeded())
    t.device.write(PROGRESS_KEY, 'mine')
    t.other.localStorage.setItem(PROGRESS_KEY, 'theirs')
    t.origin.flushEvents()
    expect(t.heard).toEqual([])
    expect(t.device.read(PROGRESS_KEY)).toBe('mine')
  })

  it('attaches the window listener once and removes it when the last subscriber leaves', () => {
    let added = 0
    let removed = 0
    const target = new EventTarget()
    const source: StorageEventSource = {
      addEventListener: (...args: Parameters<EventTarget['addEventListener']>) => {
        added++
        target.addEventListener(...args)
      },
      removeEventListener: (...args: Parameters<EventTarget['removeEventListener']>) => {
        removed++
        target.removeEventListener(...args)
      },
    }
    const device = createDeviceStorage({
      getStorage: () => new FakeWebStorage(),
      getEventSource: () => source,
    })
    const offProgress = device.subscribe(PROGRESS_KEY, () => {})
    const offPrefs = device.subscribe(PREFS_KEY, () => {})
    offProgress()
    expect([added, removed]).toEqual([1, 0])
    offPrefs()
    expect([added, removed]).toEqual([1, 1])
    device.subscribe(PREFS_KEY, () => {})()
    expect([added, removed]).toEqual([2, 2])
  })

  it('stops hearing events when the last subscriber leaves, and hears them again after', () => {
    const t = twoTabs()
    const offA = t.device.subscribe(PROGRESS_KEY, () => t.heard.push('a'))
    const offB = t.device.subscribe(PREFS_KEY, () => t.heard.push('b'))
    offA()
    t.other.localStorage.setItem(PREFS_KEY, '1')
    t.origin.flushEvents()
    expect(t.heard).toEqual(['b'])
    offB()
    t.other.localStorage.setItem(PREFS_KEY, '2')
    t.other.localStorage.setItem(PROGRESS_KEY, '2')
    t.origin.flushEvents()
    expect(t.heard).toEqual(['b'])
    t.device.subscribe(PROGRESS_KEY, () => t.heard.push('again'))
    t.other.localStorage.setItem(PROGRESS_KEY, '3')
    t.origin.flushEvents()
    expect(t.heard).toEqual(['b', 'again'])
  })

  it('a listener that throws does not stop the others; its error goes to the reporter', () => {
    const origin = new FakeOrigin()
    const mine = origin.openTab()
    const other = origin.openTab()
    const errors: unknown[] = []
    const device = createDeviceStorage({
      getStorage: () => mine.localStorage,
      getEventSource: () => mine.window,
      onListenerError: (error) => errors.push(error),
    })
    const heard: string[] = []
    const boom = new Error('listener bug')
    device.subscribe(PROGRESS_KEY, () => {
      throw boom
    })
    device.subscribe(PROGRESS_KEY, () => heard.push('progress'))
    device.subscribe(PREFS_KEY, () => heard.push('prefs'))
    other.localStorage.setItem('k', 'v')
    // clear() in another tab (key null) reaches both records' listeners.
    other.localStorage.clear()
    origin.flushEvents()
    expect(heard).toEqual(['progress', 'prefs'])
    expect(errors).toEqual([boom])
  })

  it('a listener that is not a function is a TypeError, before anything is attached', () => {
    const t = twoTabs()
    for (const bad of [undefined, null, 42, 'listener', {}]) {
      expect(() => t.device.subscribe(PROGRESS_KEY, bad as unknown as () => void)).toThrow(
        TypeError,
      )
    }
    expect(t.sourceCalls()).toBe(0)
  })

  it('survives an event source that throws', () => {
    const throwing: StorageEventSource = {
      addEventListener: () => {
        throw new Error('no events here')
      },
      removeEventListener: () => {
        throw new Error('no events here')
      },
    }
    const device = createDeviceStorage({
      getStorage: () => new FakeWebStorage(),
      getEventSource: () => throwing,
    })
    expect(() => device.subscribe(PROGRESS_KEY, () => {})()).not.toThrow()
  })
})
