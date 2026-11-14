// The Web Storage behaviour the progress code relies on, written as tests that any real Storage
// must pass (P1-4a). fake-web-storage.test.ts runs them against the fake. The owner's one-off
// parity run runs them against Node's real in-memory sessionStorage
// (node --experimental-webstorage), which shows the fake behaves like the real thing where the
// progress code depends on it, and runs the device storage and both stores over it. Quota,
// failure-injection and cross-tab 'storage' event tests are fake-only and are not here: Node's
// sessionStorage sends no 'storage' events, so the event model is proven against the fake only.
// Each test starts with clear(): never point this at storage that holds data you need.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  PREFS_KEY,
  PROGRESS_KEY,
  readPrefs,
  readProgress,
  serializeProgress,
  type StepWrite,
} from '../../../core/progress'
import { createDeviceStorage, type WebStorageArea } from '../device-storage'
import { createPrefsStore } from '../prefs-store'
import { createProgressStore } from '../progress-store'

/** What the contract uses: the device storage's three methods plus length, key() and clear(). */
export interface ContractStorage extends WebStorageArea {
  readonly length: number
  key(index: number): string | null
  clear(): void
}

const STEP: StepWrite = {
  version: 3,
  activeRun: { path: ['start', 'wise_path'], locale: 'hi' },
  ending: null,
  currentEndings: ['ending_wise', 'ending_quick'],
}

/** Registers the contract as a describe block for the storage `makeStorage` returns. */
export function describeWebStorageContract(name: string, makeStorage: () => ContractStorage): void {
  describe(`Web Storage contract: ${name}`, () => {
    let storage: ContractStorage

    beforeEach(() => {
      storage = makeStorage()
      storage.clear()
    })

    it('reads a missing key as null, never undefined or an empty string', () => {
      expect(storage.getItem(PROGRESS_KEY)).toBeNull()
      expect(storage.getItem('never-set')).toBeNull()
    })

    it('returns exactly the string stored, including Hindi, emoji, quotes and newlines', () => {
      const text = 'हिन्दी 🦊 "quoted" \\ back\nslash'
      storage.setItem(PROGRESS_KEY, text)
      expect(storage.getItem(PROGRESS_KEY)).toBe(text)
    })

    it('keeps an empty string apart from a missing key', () => {
      storage.setItem(PREFS_KEY, '')
      expect(storage.getItem(PREFS_KEY)).toBe('')
      expect(storage.length).toBe(1)
    })

    it('stores non-string values and keys as their string form', () => {
      storage.setItem('n', 42 as unknown as string)
      storage.setItem('b', true as unknown as string)
      storage.setItem('z', null as unknown as string)
      storage.setItem(7 as unknown as string, 'seven')
      expect(storage.getItem('n')).toBe('42')
      expect(storage.getItem('b')).toBe('true')
      expect(storage.getItem('z')).toBe('null')
      expect(storage.getItem('7')).toBe('seven')
      expect(typeof storage.getItem('n')).toBe('string')
    })

    it('overwrites a key in place and counts it once', () => {
      storage.setItem(PROGRESS_KEY, 'one')
      storage.setItem(PROGRESS_KEY, 'two')
      expect(storage.getItem(PROGRESS_KEY)).toBe('two')
      expect(storage.length).toBe(1)
    })

    it('removes a key, and removing a missing key does nothing', () => {
      storage.setItem(PROGRESS_KEY, 'x')
      storage.setItem(PREFS_KEY, 'y')
      storage.removeItem(PROGRESS_KEY)
      expect(storage.getItem(PROGRESS_KEY)).toBeNull()
      expect(storage.getItem(PREFS_KEY)).toBe('y')
      expect(() => storage.removeItem('never-set')).not.toThrow()
      expect(storage.length).toBe(1)
    })

    it('lists keys with key(i), null past the end, and empties with clear()', () => {
      storage.setItem(PROGRESS_KEY, 'x')
      storage.setItem(PREFS_KEY, 'y')
      const keys = [storage.key(0), storage.key(1)].sort()
      expect(keys).toEqual([PREFS_KEY, PROGRESS_KEY].sort())
      expect(storage.key(2)).toBeNull()
      storage.clear()
      expect(storage.length).toBe(0)
      expect(storage.getItem(PREFS_KEY)).toBeNull()
    })

    it('keeps a large value intact (about 1 MB of record text)', () => {
      const text = JSON.stringify({ filler: 'ab'.repeat(500_000) })
      storage.setItem(PROGRESS_KEY, text)
      expect(storage.getItem(PROGRESS_KEY)).toBe(text)
    })

    describe('the progress code over it', () => {
      it('reads and writes both records on the device', () => {
        const device = createDeviceStorage({ getStorage: () => storage })
        expect(device.read(PROGRESS_KEY)).toBeNull()
        device.write(PROGRESS_KEY, '{"schema":1,"stories":{}}')
        device.write(PREFS_KEY, '{"schema":1}')
        expect(storage.getItem(PROGRESS_KEY)).toBe('{"schema":1,"stories":{}}')
        expect(device.read(PREFS_KEY)).toBe('{"schema":1}')
        device.remove(PREFS_KEY)
        expect(storage.getItem(PREFS_KEY)).toBeNull()
        expect(device.getStatus(PROGRESS_KEY).mode).toBe('device')
        expect(device.getStatus(PREFS_KEY).mode).toBe('device')
      })

      it('saves a step through the progress store and reads it back', async () => {
        const store = createProgressStore({
          device: createDeviceStorage({ getStorage: () => storage }),
        })
        await store.saveStep('two-paths', STEP)
        const raw = storage.getItem(PROGRESS_KEY)
        const read = readProgress(raw)
        expect(read.kind === 'record' && read.issues).toEqual([])
        expect(await store.get('two-paths')).toEqual({
          version: 3,
          activeRun: { path: ['start', 'wise_path'], locale: 'hi' },
          endingsFound: [],
          order: 1,
        })
        if (read.kind === 'record') expect(raw).toBe(serializeProgress(read.record))
      })

      it('clearAll removes the progress key only; prefs stay', async () => {
        const device = createDeviceStorage({ getStorage: () => storage })
        const store = createProgressStore({ device })
        const prefs = createPrefsStore({ device, isBrowser: () => true })
        prefs.update({ textScale: 150 })
        await store.saveStep('two-paths', STEP)
        await store.clearAll()
        expect(storage.getItem(PROGRESS_KEY)).toBeNull()
        const stored = readPrefs(storage.getItem(PREFS_KEY))
        expect(stored.kind === 'record' && stored.record.textScale).toBe(150)
      })

      it('the first browser prefs snapshot reads what is stored', () => {
        storage.setItem(PREFS_KEY, '{"schema":1,"uiLocale":"hi","textScale":125,"readToMe":true}')
        const prefs = createPrefsStore({
          device: createDeviceStorage({ getStorage: () => storage }),
          isBrowser: () => true,
        })
        expect(prefs.getSnapshot()).toEqual({ uiLocale: 'hi', textScale: 125, readToMe: true })
        expect(prefs.getStatus()).toEqual({ mode: 'device', reason: null, resets: 0 })
      })

      it('leaves newer-schema bytes untouched, even when clearAll is the first call', async () => {
        const newerProgress = '{"schema":2,"stories":{"two-paths":{"from":"a newer build"}}}'
        const newerPrefs = '{"schema":2,"fontFamily":"serif"}'
        storage.setItem(PROGRESS_KEY, newerProgress)
        storage.setItem(PREFS_KEY, newerPrefs)
        const device = createDeviceStorage({ getStorage: () => storage })
        const store = createProgressStore({ device })
        const prefs = createPrefsStore({ device, isBrowser: () => true })
        await store.clearAll()
        await store.saveStep('two-paths', STEP)
        await store.resetRun('two-paths')
        expect(await store.list()).toHaveLength(1)
        prefs.update({ readToMe: true })
        expect(prefs.getSnapshot().readToMe).toBe(true)
        expect(storage.getItem(PROGRESS_KEY)).toBe(newerProgress)
        expect(storage.getItem(PREFS_KEY)).toBe(newerPrefs)
        expect(store.getStatus()).toEqual({ mode: 'memory', reason: 'newer-schema', resets: 0 })
        expect(prefs.getStatus()).toEqual({ mode: 'memory', reason: 'newer-schema', resets: 0 })
      })

      it('reading an invalid record never writes; the next save stores it cleaned', async () => {
        const invalid = '{"schema":1,"stories":{"two-paths":{"version":0}}}'
        storage.setItem(PROGRESS_KEY, invalid)
        const store = createProgressStore({
          device: createDeviceStorage({ getStorage: () => storage }),
        })
        expect(await store.list()).toEqual([])
        expect(await store.get('two-paths')).toBeNull()
        expect(storage.getItem(PROGRESS_KEY)).toBe(invalid)
        expect(store.getStatus().resets).toBe(1)
        await store.saveStep('lion-and-hare', STEP)
        const read = readProgress(storage.getItem(PROGRESS_KEY))
        expect(read.kind === 'record' && read.issues).toEqual([])
        expect(read.kind === 'record' && Object.keys(read.record.stories)).toEqual([
          'lion-and-hare',
        ])
      })

      it('touches the two record keys only (no probe key)', async () => {
        const device = createDeviceStorage({ getStorage: () => storage })
        const store = createProgressStore({ device })
        const prefs = createPrefsStore({ device, isBrowser: () => true })
        prefs.getSnapshot()
        await store.list()
        await store.saveStep('two-paths', STEP)
        prefs.update({ uiLocale: 'hi' })
        await store.clearStory('two-paths')
        const keys: string[] = []
        for (let i = 0; i < storage.length; i++) keys.push(storage.key(i) ?? '')
        expect(keys.sort()).toEqual([PREFS_KEY, PROGRESS_KEY].sort())
      })
    })
  })
}
