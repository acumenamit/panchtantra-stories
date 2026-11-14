import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  PROGRESS_KEY,
  readPrefs,
  type PrefsPatch,
} from '../../core/progress'
import { createDeviceStorage } from './device-storage'
import { createPrefsStore } from './prefs-store'
import {
  FakeOrigin,
  FakeWebStorage,
  quotaExceeded,
  securityError,
} from './testing/fake-web-storage'

function setup(options: { browser?: boolean; storage?: FakeWebStorage } = {}) {
  const storage = options.storage ?? new FakeWebStorage()
  let resolutions = 0
  const device = createDeviceStorage({
    getStorage: () => {
      resolutions++
      return storage
    },
    getEventSource: () => null,
  })
  const prefs = createPrefsStore({ device, isBrowser: () => options.browser ?? true })
  return { storage, device, prefs, resolutions: () => resolutions }
}

const stored = (storage: FakeWebStorage) => {
  const read = readPrefs(storage.getItem(PREFS_KEY))
  if (read.kind !== 'record') throw new Error('expected a record')
  expect(read.issues).toEqual([])
  return read.record
}

describe('server and hydration', () => {
  it('getServerSnapshot is the defaults, always the same object, with no storage read', () => {
    const t = setup()
    expect(t.prefs.getServerSnapshot()).toEqual({ uiLocale: null, textScale: 100, readToMe: false })
    expect(t.prefs.getServerSnapshot()).toBe(t.prefs.getServerSnapshot())
    expect(t.prefs.getServerSnapshot()).toBe(DEFAULT_PREFS)
    expect(t.resolutions()).toBe(0)
  })

  it('on the server getSnapshot is the defaults and update changes nothing; storage is never touched', () => {
    const t = setup({ browser: false })
    expect(t.prefs.getSnapshot()).toBe(DEFAULT_PREFS)
    t.prefs.update({ textScale: 150 })
    expect(t.prefs.getSnapshot()).toBe(DEFAULT_PREFS)
    expect(t.resolutions()).toBe(0)
    expect(t.prefs.getStatus().mode).toBe('unknown')
  })

  it('on the server an invalid update is still a TypeError', () => {
    const t = setup({ browser: false })
    for (const patch of [{ textScale: 120 }, { theme: 'dark' }, null]) {
      expect(() => t.prefs.update(patch as PrefsPatch)).toThrow(TypeError)
    }
    expect(t.resolutions()).toBe(0)
  })

  it('with no window at all, the default browser check keeps getSnapshot off storage', () => {
    let resolved = 0
    const device = createDeviceStorage({
      getStorage: () => {
        resolved++
        return new FakeWebStorage()
      },
    })
    const prefs = createPrefsStore({ device })
    expect(prefs.getSnapshot()).toBe(DEFAULT_PREFS)
    expect(resolved).toBe(0)
  })
})

describe('getSnapshot in the browser', () => {
  it('reads storage once, on the first call, and returns the same object after', () => {
    const t = setup()
    t.storage.setItem(PREFS_KEY, '{"schema":1,"uiLocale":"hi","textScale":125,"readToMe":true}')
    t.storage.calls.length = 0
    const first = t.prefs.getSnapshot()
    expect(first).toEqual({ uiLocale: 'hi', textScale: 125, readToMe: true })
    expect(t.prefs.getSnapshot()).toBe(first)
    expect(t.prefs.getSnapshot()).toBe(first)
    expect(t.storage.calls).toEqual([`getItem ${PREFS_KEY}`])
    expect(Object.isFrozen(first)).toBe(true)
  })

  it('reads the defaults when nothing is stored, without writing', () => {
    const t = setup()
    expect(t.prefs.getSnapshot()).toEqual(DEFAULT_PREFS)
    expect(t.storage.count('setItem')).toBe(0)
    expect(t.prefs.getStatus().mode).toBe('device')
  })

  it('resets invalid fields one by one, never writes on read, and counts the reset', () => {
    const t = setup()
    const raw = '{"schema":1,"uiLocale":"ar","textScale":150,"readToMe":"yes"}'
    t.storage.setItem(PREFS_KEY, raw)
    expect(t.prefs.getSnapshot()).toEqual({ uiLocale: null, textScale: 150, readToMe: false })
    expect(t.storage.getItem(PREFS_KEY)).toBe(raw)
    expect(t.storage.count('setItem')).toBe(1) // the test's own seed
    expect(t.prefs.getStatus().resets).toBe(1)
  })

  it('leaves a newer schema untouched and uses memory', () => {
    const t = setup()
    const newer = '{"schema":2,"fontFamily":"serif"}'
    t.storage.setItem(PREFS_KEY, newer)
    expect(t.prefs.getSnapshot()).toEqual(DEFAULT_PREFS)
    t.prefs.update({ readToMe: true })
    expect(t.prefs.getSnapshot().readToMe).toBe(true)
    expect(t.storage.getItem(PREFS_KEY)).toBe(newer)
    expect(t.prefs.getStatus()).toMatchObject({ mode: 'memory', reason: 'newer-schema' })
  })

  it('a newer schema found after a read-only visit keeps the prefs read before', () => {
    const t = setup()
    t.storage.setItem(PREFS_KEY, '{"schema":1,"uiLocale":"hi","textScale":125,"readToMe":true}')
    expect(t.prefs.getSnapshot().textScale).toBe(125)
    t.storage.setItem(PREFS_KEY, '{"schema":2}') // another tab, a newer build
    t.prefs.update({ readToMe: false })
    expect(t.prefs.getSnapshot()).toEqual({ uiLocale: 'hi', textScale: 125, readToMe: false })
    expect(t.storage.getItem(PREFS_KEY)).toBe('{"schema":2}')
    expect(t.prefs.getStatus()).toMatchObject({ mode: 'memory', reason: 'newer-schema' })
  })

  it('a status change found by the first read is announced after the call, not during it', async () => {
    const healthy = setup()
    let heard = 0
    healthy.prefs.subscribe(() => heard++)
    healthy.prefs.getSnapshot()
    expect(healthy.prefs.getStatus().mode).toBe('device')
    // getSnapshot runs during a React render: no subscriber is called inside it.
    expect(heard).toBe(0)
    await Promise.resolve()
    expect(heard).toBe(1)
    healthy.prefs.getSnapshot()
    await Promise.resolve()
    expect(heard).toBe(1)

    let blockedHeard = 0
    const blocked = createPrefsStore({
      device: createDeviceStorage({
        getStorage: () => {
          throw securityError()
        },
        getEventSource: () => null,
      }),
      isBrowser: () => true,
    })
    blocked.subscribe(() => blockedHeard++)
    expect(blocked.getSnapshot()).toEqual(DEFAULT_PREFS)
    expect(blockedHeard).toBe(0)
    await Promise.resolve()
    expect(blocked.getStatus()).toEqual({ mode: 'memory', reason: 'unavailable', resets: 0 })
    expect(blockedHeard).toBe(1)
  })
})

describe('update', () => {
  it('writes the record, gives a new snapshot and notifies', () => {
    const t = setup()
    const before = t.prefs.getSnapshot()
    let heard = 0
    t.prefs.subscribe(() => heard++)
    t.prefs.update({ textScale: 150, uiLocale: 'hi' })
    const after = t.prefs.getSnapshot()
    expect(after).not.toBe(before)
    expect(after).toEqual({ uiLocale: 'hi', textScale: 150, readToMe: false })
    expect(stored(t.storage)).toEqual({
      schema: 1,
      uiLocale: 'hi',
      textScale: 150,
      readToMe: false,
    })
    expect(heard).toBe(1)
  })

  it('re-reads storage and changes only the fields given', () => {
    const t = setup()
    t.prefs.getSnapshot()
    // Another tab turned Read to me on after this tab's first read.
    t.storage.setItem(PREFS_KEY, '{"schema":1,"uiLocale":"en","textScale":100,"readToMe":true}')
    t.prefs.update({ textScale: 125 })
    expect(stored(t.storage)).toEqual({ schema: 1, uiLocale: 'en', textScale: 125, readToMe: true })
    expect(t.prefs.getSnapshot()).toEqual({ uiLocale: 'en', textScale: 125, readToMe: true })
  })

  it('sets uiLocale back to null (not chosen) and ignores fields given as undefined', () => {
    const t = setup()
    t.prefs.update({ uiLocale: 'hi', readToMe: true })
    t.prefs.update({ uiLocale: null, readToMe: undefined })
    expect(stored(t.storage)).toEqual({ schema: 1, uiLocale: null, textScale: 100, readToMe: true })
  })

  it('writes nothing and keeps the snapshot when nothing changes', () => {
    const t = setup()
    t.prefs.update({ textScale: 125 })
    const snapshot = t.prefs.getSnapshot()
    let heard = 0
    t.prefs.subscribe(() => heard++)
    t.prefs.update({ textScale: 125 })
    t.prefs.update({})
    expect(t.storage.count('setItem')).toBe(1)
    expect(t.prefs.getSnapshot()).toBe(snapshot)
    expect(heard).toBe(0)
  })

  it('saves the cleaned record on a real update', () => {
    const t = setup()
    t.storage.setItem(
      PREFS_KEY,
      '{"schema":1,"uiLocale":"xx","textScale":125,"readToMe":true,"theme":1}',
    )
    t.prefs.update({ readToMe: true })
    expect(stored(t.storage)).toEqual({ schema: 1, uiLocale: null, textScale: 125, readToMe: true })
  })

  it('throws a TypeError for an invalid value or field, before storage is touched', () => {
    const t = setup()
    const bad: unknown[] = [
      null,
      'hi',
      { textScale: 120 },
      { textScale: '125' },
      { uiLocale: 'ar' },
      { uiLocale: 'EN' },
      { readToMe: 'yes' },
      { theme: 'dark' },
      { schema: 1 },
    ]
    for (const patch of bad) {
      expect(() => t.prefs.update(patch as PrefsPatch)).toThrow(TypeError)
    }
    expect(t.resolutions()).toBe(0)
    expect(t.storage.calls).toEqual([])
  })

  it('a storage failure never throws: the change lives in memory and subscribers hear it', () => {
    const t = setup()
    t.storage.failAlways('setItem', quotaExceeded())
    let heard = 0
    t.prefs.subscribe(() => heard++)
    expect(() => t.prefs.update({ textScale: 150 })).not.toThrow()
    expect(t.prefs.getSnapshot().textScale).toBe(150)
    expect(t.prefs.getStatus()).toMatchObject({ mode: 'memory', reason: 'write-failed' })
    expect(heard).toBe(1)
    expect(t.storage.getItem(PREFS_KEY)).toBeNull()
  })

  it('a status-only change (the write fails, the values stay) notifies subscribers', () => {
    const t = setup()
    t.storage.failAlways('setItem', quotaExceeded())
    const snapshot = t.prefs.getSnapshot()
    let heard = 0
    t.prefs.subscribe(() => heard++)
    // The defaults again, but nothing is stored yet, so update() writes, and the write fails.
    t.prefs.update({ textScale: 100 })
    expect(t.prefs.getSnapshot()).toBe(snapshot)
    expect(t.prefs.getStatus()).toMatchObject({ mode: 'memory', reason: 'write-failed' })
    expect(heard).toBe(1)
  })

  it('a listener that throws never reaches the caller or stops the others', () => {
    const errors: unknown[] = []
    const prefs = createPrefsStore({
      device: createDeviceStorage({
        getStorage: () => new FakeWebStorage(),
        getEventSource: () => null,
      }),
      isBrowser: () => true,
      onListenerError: (error) => errors.push(error),
    })
    const boom = new Error('listener bug')
    prefs.subscribe(() => {
      throw boom
    })
    let heard = 0
    prefs.subscribe(() => heard++)
    expect(() => prefs.update({ readToMe: true })).not.toThrow()
    expect(prefs.getSnapshot().readToMe).toBe(true)
    expect(heard).toBe(1)
    expect(errors).toEqual([boom])
  })

  it('a listener that is not a function is a TypeError', () => {
    const t = setup()
    for (const bad of [undefined, null, 42, 'listener', {}]) {
      expect(() => t.prefs.subscribe(bad as unknown as () => void)).toThrow(TypeError)
    }
    expect(t.resolutions()).toBe(0)
  })

  it('touches the prefs key only', () => {
    const t = setup()
    t.prefs.getSnapshot()
    t.prefs.update({ readToMe: true })
    expect(t.storage.calls.every((c) => c.endsWith(PREFS_KEY))).toBe(true)
    expect(t.storage.getItem(PROGRESS_KEY)).toBeNull()
  })
})

describe("other tabs' changes", () => {
  function twoTabs() {
    const origin = new FakeOrigin()
    const mine = origin.openTab()
    const other = origin.openTab()
    const prefs = createPrefsStore({
      device: createDeviceStorage({
        getStorage: () => mine.localStorage,
        getEventSource: () => mine.window,
      }),
      isBrowser: () => true,
    })
    return { origin, mine, other, prefs }
  }

  it('refresh the snapshot and notify', () => {
    const t = twoTabs()
    const before = t.prefs.getSnapshot()
    let heard = 0
    t.prefs.subscribe(() => heard++)
    t.other.localStorage.setItem(
      PREFS_KEY,
      '{"schema":1,"uiLocale":"hi","textScale":100,"readToMe":false}',
    )
    t.origin.flushEvents()
    expect(heard).toBe(1)
    expect(t.prefs.getSnapshot()).not.toBe(before)
    expect(t.prefs.getSnapshot().uiLocale).toBe('hi')
  })

  it('keep the same snapshot and stay quiet when the values did not change', () => {
    const t = twoTabs()
    const before = t.prefs.getSnapshot()
    let heard = 0
    t.prefs.subscribe(() => heard++)
    t.other.localStorage.setItem(
      PREFS_KEY,
      '{"schema":1,"uiLocale":null,"textScale":100,"readToMe":false}',
    )
    t.origin.flushEvents()
    expect(heard).toBe(0)
    expect(t.prefs.getSnapshot()).toBe(before)
  })

  it('notify before the first read, so subscribers read then', () => {
    const t = twoTabs()
    let heard = 0
    t.prefs.subscribe(() => heard++)
    t.other.localStorage.setItem(
      PREFS_KEY,
      '{"schema":1,"uiLocale":"hi","textScale":100,"readToMe":false}',
    )
    t.origin.flushEvents()
    expect(heard).toBe(1)
    expect(t.prefs.getSnapshot().uiLocale).toBe('hi')
  })

  it('stop after unsubscribe', () => {
    const t = twoTabs()
    let heard = 0
    const off = t.prefs.subscribe(() => heard++)
    off()
    t.other.localStorage.setItem(
      PREFS_KEY,
      '{"schema":1,"uiLocale":"hi","textScale":100,"readToMe":false}',
    )
    t.origin.flushEvents()
    expect(heard).toBe(0)
  })

  it('a change made while nobody was subscribed is picked up when the first subscriber joins', () => {
    const t = twoTabs()
    const first = t.prefs.getSnapshot()
    const off = t.prefs.subscribe(() => {})
    off()
    t.other.localStorage.setItem(
      PREFS_KEY,
      '{"schema":1,"uiLocale":null,"textScale":150,"readToMe":false}',
    )
    t.origin.flushEvents()
    // Unsubscribed, so the event was not heard: the old snapshot stays until someone subscribes.
    expect(t.prefs.getSnapshot()).toBe(first)
    t.prefs.subscribe(() => {})
    // React checks getSnapshot right after subscribing.
    expect(t.prefs.getSnapshot().textScale).toBe(150)
  })

  it('the first subscriber keeps the same snapshot object when nothing changed meanwhile', () => {
    const t = twoTabs()
    const first = t.prefs.getSnapshot()
    t.prefs.subscribe(() => {})()
    t.prefs.subscribe(() => {})
    expect(t.prefs.getSnapshot()).toBe(first)
  })

  it("another tab's newer schema moves the record to memory, and subscribers hear it", () => {
    const t = twoTabs()
    t.prefs.update({ textScale: 125 })
    let heard = 0
    t.prefs.subscribe(() => heard++)
    t.other.localStorage.setItem(PREFS_KEY, '{"schema":2,"uiLocale":"en"}')
    t.origin.flushEvents()
    expect(heard).toBe(1)
    expect(t.prefs.getStatus()).toMatchObject({ mode: 'memory', reason: 'newer-schema' })
    expect(t.prefs.getSnapshot()).toEqual({ uiLocale: null, textScale: 125, readToMe: false })
    expect(t.mine.localStorage.getItem(PREFS_KEY)).toBe('{"schema":2,"uiLocale":"en"}')
  })
})
