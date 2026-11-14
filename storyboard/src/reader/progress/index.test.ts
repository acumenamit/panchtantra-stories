import { describe, expect, it, vi } from 'vitest'
import { PREFS_KEY, PROGRESS_KEY } from '../../core/progress'
import {
  createReaderStores,
  createReaderStoresGetter,
  readerStores,
  type ReaderStores,
} from './index'
import { FakeWebStorage, quotaExceeded } from './testing/fake-web-storage'

describe('importing the barrels', () => {
  it('in Node with no window: no throw and no side effects', async () => {
    expect(typeof window).toBe('undefined')
    const globalsBefore = Object.getOwnPropertyNames(globalThis).sort()
    vi.resetModules()
    const reader = await import('./index')
    const core = await import('../../core/progress/index')
    expect(typeof reader.readerStores).toBe('function')
    expect(typeof core.readProgress).toBe('function')
    expect(Object.getOwnPropertyNames(globalThis).sort()).toEqual(globalsBefore)
  })
})

describe('createReaderStores', () => {
  it('resolves storage on first use only, once, for both stores', async () => {
    const storage = new FakeWebStorage()
    let resolutions = 0
    const stores = createReaderStores({
      getStorage: () => {
        resolutions++
        return storage
      },
      getEventSource: () => null,
      isBrowser: () => true,
    })
    expect(resolutions).toBe(0)
    expect(stores.prefs.getServerSnapshot().textScale).toBe(100)
    expect(resolutions).toBe(0)
    await stores.progress.list()
    stores.prefs.getSnapshot()
    expect(resolutions).toBe(1)
    expect(storage.calls).toEqual([`getItem ${PROGRESS_KEY}`, `getItem ${PREFS_KEY}`])
  })

  it('keeps each record on its own fallback', async () => {
    const storage = new FakeWebStorage()
    const stores = createReaderStores({
      getStorage: () => storage,
      getEventSource: () => null,
      isBrowser: () => true,
    })
    storage.failNext('setItem', quotaExceeded())
    await stores.progress.saveStep('two-paths', {
      version: 1,
      activeRun: { path: ['start', 'wise_path'], locale: 'en' },
      ending: null,
      currentEndings: ['ending_wise'],
    })
    stores.prefs.update({ readToMe: true })
    expect(stores.progress.getStatus().mode).toBe('memory')
    expect(stores.prefs.getStatus().mode).toBe('device')
    expect(storage.getItem(PREFS_KEY)).not.toBeNull()
  })

  it('passes the listener error reporter to both stores', async () => {
    const errors: unknown[] = []
    const stores = createReaderStores({
      getStorage: () => new FakeWebStorage(),
      getEventSource: () => null,
      isBrowser: () => true,
      onListenerError: (error) => errors.push(error),
    })
    const progressBug = new Error('progress listener bug')
    const prefsBug = new Error('prefs listener bug')
    stores.progress.subscribe(() => {
      throw progressBug
    })
    stores.prefs.subscribe(() => {
      throw prefsBug
    })
    await stores.progress.clearAll()
    stores.prefs.update({ textScale: 125 })
    expect(errors).toEqual([progressBug, prefsBug])
  })
})

describe('readerStores()', () => {
  it('in the browser: created on the first call, then the same stores for the page', () => {
    let created = 0
    const make = (): ReaderStores => {
      created++
      return createReaderStores({ getStorage: () => new FakeWebStorage(), isBrowser: () => true })
    }
    const get = createReaderStoresGetter(() => true, make)
    expect(created).toBe(0)
    const first = get()
    expect(get()).toBe(first)
    expect(created).toBe(1)
  })

  it('on the server: new stores per call, nothing shared, storage never touched', async () => {
    let created = 0
    const get = createReaderStoresGetter(
      () => false,
      () => {
        created++
        return createReaderStores()
      },
    )
    expect(get()).not.toBe(get())
    expect(created).toBe(2)
    // The real readerStores() in Node (no window) behaves the same and never throws.
    const stores = readerStores()
    expect(readerStores()).not.toBe(stores)
    expect(stores.prefs.getSnapshot()).toBe(stores.prefs.getServerSnapshot())
    await expect(stores.progress.list()).resolves.toEqual([])
    expect(stores.prefs.getStatus().mode).toBe('unknown')
    expect(stores.progress.getStatus()).toMatchObject({ mode: 'memory', reason: 'unavailable' })
  })
})
