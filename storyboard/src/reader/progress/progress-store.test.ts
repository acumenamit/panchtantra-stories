import { describe, expect, it } from 'vitest'
import {
  PREFS_KEY,
  PROGRESS_KEY,
  readProgress,
  serializeProgress,
  type ProgressRecord,
  type StepWrite,
  type StoryProgress,
} from '../../core/progress'
import { createDeviceStorage } from './device-storage'
import { createProgressStore } from './progress-store'
import {
  FakeOrigin,
  FakeWebStorage,
  quotaExceeded,
  securityError,
} from './testing/fake-web-storage'

const ENDINGS = ['ending_wise', 'ending_quick']

const step = (overrides: Partial<StepWrite> = {}): StepWrite => ({
  version: 1,
  activeRun: { path: ['start', 'wise_path'], locale: 'en' },
  ending: null,
  currentEndings: ENDINGS,
  ...overrides,
})

const atEnding = (ending: string, version = 1): StepWrite =>
  step({ version, activeRun: null, ending })

function setup(storage = new FakeWebStorage()) {
  const device = createDeviceStorage({ getStorage: () => storage, getEventSource: () => null })
  return { storage, device, store: createProgressStore({ device }) }
}

function storedRecord(storage: FakeWebStorage): ProgressRecord {
  const read = readProgress(storage.getItem(PROGRESS_KEY))
  if (read.kind !== 'record') throw new Error('expected a record')
  expect(read.issues).toEqual([])
  return read.record
}

const entry = (overrides: Partial<StoryProgress> = {}): StoryProgress => ({
  version: 1,
  activeRun: null,
  endingsFound: [],
  order: 1,
  ...overrides,
})

function seed(storage: FakeWebStorage, stories: Record<string, StoryProgress>): void {
  storage.setItem(PROGRESS_KEY, serializeProgress({ schema: 1, stories }))
  storage.calls.length = 0
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('get and list', () => {
  it('get is null for a story with nothing saved, and reading never writes', async () => {
    const t = setup()
    expect(await t.store.get('two-paths')).toBeNull()
    expect(await t.store.list()).toEqual([])
    expect(t.storage.count('setItem') + t.storage.count('removeItem')).toBe(0)
  })

  it('list is most recent first: highest order, then storyId', async () => {
    const t = setup()
    seed(t.storage, {
      zed: entry({ order: 2 }),
      abc: entry({ order: 2 }),
      top: entry({ order: 9 }),
      low: entry({ order: 1 }),
    })
    const listed = await t.store.list()
    expect(listed.map((e) => e.storyId)).toEqual(['top', 'abc', 'zed', 'low'])
    expect(listed[0]).toEqual({ storyId: 'top', ...entry({ order: 9 }) })
  })

  it('handles a story id that is also an Object.prototype name', async () => {
    const t = setup()
    expect(await t.store.get('constructor')).toBeNull()
    await t.store.saveStep('constructor', step())
    expect((await t.store.get('constructor'))?.order).toBe(1)
  })
})

describe('saveStep: one save per accepted step', () => {
  it('reads once and writes once', async () => {
    const t = setup()
    await t.store.saveStep('two-paths', step())
    expect(t.storage.calls).toEqual([`getItem ${PROGRESS_KEY}`, `setItem ${PROGRESS_KEY}`])
  })

  it('stores the run, stamps the version and gives the story the highest order', async () => {
    const t = setup()
    await t.store.saveStep('lion-and-hare', step({ version: 4 }))
    await t.store.saveStep('two-paths', step({ version: 2 }))
    await t.store.saveStep('two-paths', step({ version: 3 }))
    expect(storedRecord(t.storage).stories).toEqual({
      'lion-and-hare': entry({ version: 4, activeRun: step().activeRun, order: 1 }),
      'two-paths': entry({ version: 3, activeRun: step().activeRun, order: 2 }),
    })
    await t.store.saveStep('lion-and-hare', step({ version: 4 }))
    expect((await t.store.list()).map((e) => [e.storyId, e.order])).toEqual([
      ['lion-and-hare', 3],
      ['two-paths', 2],
    ])
  })

  it('saves the run and a found ending together; endings stay unique', async () => {
    const t = setup()
    await t.store.saveStep('two-paths', atEnding('ending_wise'))
    await t.store.saveStep('two-paths', step())
    await t.store.saveStep('two-paths', atEnding('ending_wise'))
    await t.store.saveStep('two-paths', atEnding('ending_quick'))
    expect(await t.store.get('two-paths')).toEqual(
      entry({ endingsFound: ['ending_wise', 'ending_quick'], order: 1 }),
    )
    expect(t.storage.count('setItem')).toBe(4)
  })
})

describe('resetRun, clearStory, clearAll', () => {
  it('resetRun nulls the run and keeps endings, version and order', async () => {
    const t = setup()
    seed(t.storage, {
      'two-paths': entry({
        activeRun: step().activeRun,
        endingsFound: ['ending_wise'],
        order: 5,
        version: 2,
      }),
    })
    await t.store.resetRun('two-paths')
    expect(await t.store.get('two-paths')).toEqual(
      entry({ endingsFound: ['ending_wise'], order: 5, version: 2 }),
    )
  })

  it('resetRun and clearStory write nothing when there is nothing to change', async () => {
    const t = setup()
    seed(t.storage, { 'two-paths': entry() })
    await t.store.resetRun('two-paths')
    await t.store.resetRun('missing-story')
    await t.store.clearStory('missing-story')
    expect(t.storage.count('setItem') + t.storage.count('removeItem')).toBe(0)
  })

  it('clearStory removes one story only', async () => {
    const t = setup()
    seed(t.storage, { 'two-paths': entry(), 'lion-and-hare': entry({ order: 2 }) })
    await t.store.clearStory('two-paths')
    expect(storedRecord(t.storage).stories).toEqual({ 'lion-and-hare': entry({ order: 2 }) })
  })

  it('clearAll removes reader.v1.progress only; prefs stay', async () => {
    const t = setup()
    t.storage.setItem(PREFS_KEY, '{"schema":1,"uiLocale":"hi","textScale":125,"readToMe":true}')
    await t.store.saveStep('two-paths', step())
    await t.store.clearAll()
    expect(t.storage.getItem(PROGRESS_KEY)).toBeNull()
    expect(t.storage.getItem(PREFS_KEY)).not.toBeNull()
    expect(t.storage.count('removeItem')).toBe(1)
    expect(t.storage.count('removeItem', PROGRESS_KEY)).toBe(1)
  })
})

describe('bad arguments reject with TypeError before storage is touched', () => {
  const badIds: unknown[] = [
    '',
    'ab',
    'Bad Id',
    'two_paths',
    '-x-',
    42,
    null,
    undefined,
    'a'.repeat(65),
  ]
  const badWrites: unknown[] = [
    null,
    'x',
    step({ version: 0 }),
    step({ version: 1.5 }),
    step({ activeRun: { path: [], locale: 'en' } }),
    step({ activeRun: { path: ['start'], locale: 'fr' as 'en' } }),
    step({ ending: 'start' }),
    step({ ending: 'Not_valid' }),
    { ...step(), extra: true },
    { version: 1, activeRun: null, ending: null },
  ]

  it('for every method that takes a story id', async () => {
    const t = setup()
    for (const id of badIds) {
      const storyId = id as string
      for (const call of [
        () => t.store.get(storyId),
        () => t.store.saveStep(storyId, step()),
        () => t.store.resetRun(storyId),
        () => t.store.clearStory(storyId),
      ]) {
        expect(await rejection(call())).toBeInstanceOf(TypeError)
      }
    }
    expect(t.storage.calls).toEqual([])
  })

  it('for an invalid step write', async () => {
    const t = setup()
    for (const write of badWrites) {
      const error = await rejection(t.store.saveStep('two-paths', write as StepWrite))
      expect(error).toBeInstanceOf(TypeError)
      expect(String(error)).toContain('invalid step write')
    }
    expect(t.storage.calls).toEqual([])
  })
})

describe('reading resets the smallest part and never writes', () => {
  it('cleans an invalid record on read, counts the reset once, and saves it cleaned next time', async () => {
    const t = setup()
    const raw = JSON.stringify({
      schema: 1,
      stories: {
        'two-paths': { ...entry({ order: 3 }), activeRun: { path: [], locale: 'en' } },
        'bad-entry': { ...entry(), order: 0 },
      },
    })
    t.storage.setItem(PROGRESS_KEY, raw)
    t.storage.calls.length = 0
    expect(await t.store.get('two-paths')).toEqual(entry({ order: 3 }))
    expect(await t.store.list()).toHaveLength(1)
    expect(t.storage.count('setItem')).toBe(0)
    expect(t.storage.getItem(PROGRESS_KEY)).toBe(raw)
    expect(t.store.getStatus().resets).toBe(1)
    await t.store.saveStep('lion-and-hare', step())
    expect(Object.keys(storedRecord(t.storage).stories).sort()).toEqual([
      'lion-and-hare',
      'two-paths',
    ])
  })

  it('reads unreadable text as empty and replaces it on the next save', async () => {
    const t = setup()
    t.storage.setItem(PROGRESS_KEY, '{not json')
    expect(await t.store.list()).toEqual([])
    expect(t.storage.getItem(PROGRESS_KEY)).toBe('{not json')
    await t.store.saveStep('two-paths', step())
    expect(storedRecord(t.storage).stories['two-paths']?.order).toBe(1)
  })
})

describe('schema above 1: the stored bytes stay untouched and the record uses memory', () => {
  const NEWER = '{"schema":2,"stories":{"two-paths":{"whatever":"a newer app wrote"}}}'

  it('reads as empty, saves to memory, and never writes or removes the key', async () => {
    const t = setup()
    t.storage.setItem(PROGRESS_KEY, NEWER)
    expect(await t.store.get('two-paths')).toBeNull()
    expect(t.store.getStatus()).toEqual({
      mode: 'memory',
      reason: 'newer-schema',
      resets: 0,
    })
    await t.store.saveStep('two-paths', step())
    expect((await t.store.get('two-paths'))?.activeRun).toEqual(step().activeRun)
    await t.store.resetRun('two-paths')
    await t.store.clearAll()
    expect(await t.store.list()).toEqual([])
    expect(t.storage.getItem(PROGRESS_KEY)).toBe(NEWER)
    expect(t.storage.count('setItem', PROGRESS_KEY)).toBe(1) // the test's own seed
    expect(t.storage.count('removeItem')).toBe(0)
  })

  it('a newer schema written mid-visit (another tab) keeps the last good record in memory', async () => {
    const t = setup()
    await t.store.saveStep('two-paths', step())
    t.storage.setItem(PROGRESS_KEY, NEWER)
    expect((await t.store.get('two-paths'))?.activeRun).toEqual(step().activeRun)
    await t.store.saveStep('lion-and-hare', step())
    expect((await t.store.list()).map((e) => e.storyId)).toEqual(['lion-and-hare', 'two-paths'])
    expect(t.storage.getItem(PROGRESS_KEY)).toBe(NEWER)
  })

  it('the last good record kept in memory can come from a read alone (no save this visit)', async () => {
    const t = setup()
    seed(t.storage, { 'two-paths': entry({ activeRun: step().activeRun, order: 4 }) })
    expect(await t.store.get('two-paths')).not.toBeNull()
    t.storage.setItem(PROGRESS_KEY, NEWER) // another tab, a newer build
    expect(await t.store.get('two-paths')).toEqual(entry({ activeRun: step().activeRun, order: 4 }))
    expect(t.store.getStatus()).toMatchObject({ mode: 'memory', reason: 'newer-schema' })
    expect(t.storage.getItem(PROGRESS_KEY)).toBe(NEWER)
  })

  it('clearAll as the first call of the visit leaves the newer bytes untouched', async () => {
    const t = setup()
    t.storage.setItem(PROGRESS_KEY, NEWER)
    t.storage.calls.length = 0
    let heard = 0
    t.store.subscribe(() => heard++)
    await t.store.clearAll()
    expect(t.storage.calls).toEqual([`getItem ${PROGRESS_KEY}`])
    expect(t.storage.getItem(PROGRESS_KEY)).toBe(NEWER)
    expect(t.store.getStatus()).toEqual({ mode: 'memory', reason: 'newer-schema', resets: 0 })
    expect(heard).toBe(1)
    expect(await t.store.list()).toEqual([])
  })

  it('clearAll after another tab wrote a newer schema mid-visit leaves those bytes untouched', async () => {
    const t = setup()
    await t.store.saveStep('two-paths', step())
    t.storage.setItem(PROGRESS_KEY, NEWER)
    await t.store.clearAll()
    expect(t.storage.getItem(PROGRESS_KEY)).toBe(NEWER)
    expect(t.storage.count('removeItem')).toBe(0)
    expect(await t.store.list()).toEqual([])
    expect(t.store.getStatus().reason).toBe('newer-schema')
  })
})

describe('storage problems never reject', () => {
  it('a full storage keeps the save in memory', async () => {
    const t = setup()
    await t.store.saveStep('two-paths', step())
    t.storage.failAlways('setItem', quotaExceeded())
    await expect(t.store.saveStep('two-paths', atEnding('ending_wise'))).resolves.toBeUndefined()
    expect(await t.store.get('two-paths')).toEqual(entry({ endingsFound: ['ending_wise'] }))
    expect(t.store.getStatus()).toMatchObject({ mode: 'memory', reason: 'write-failed' })
    expect(storedRecord(t.storage).stories['two-paths']?.endingsFound).toEqual([])
  })

  it('a failing getItem, removeItem or blocked storage still resolves every method', async () => {
    for (const fail of ['getItem', 'removeItem', 'blocked'] as const) {
      const storage = new FakeWebStorage()
      const device = createDeviceStorage({
        getStorage: () => {
          if (fail === 'blocked') throw securityError()
          return storage
        },
        getEventSource: () => null,
      })
      if (fail !== 'blocked') storage.failAlways(fail)
      const store = createProgressStore({ device })
      await expect(store.saveStep('two-paths', step())).resolves.toBeUndefined()
      await expect(store.get('two-paths')).resolves.not.toBeNull()
      await expect(store.list()).resolves.toHaveLength(1)
      await expect(store.resetRun('two-paths')).resolves.toBeUndefined()
      await expect(store.clearStory('two-paths')).resolves.toBeUndefined()
      await expect(store.clearAll()).resolves.toBeUndefined()
      expect(store.getStatus().mode).toBe('memory')
    }
  })
})

describe('subscribe', () => {
  it("hears this tab's changes", async () => {
    const t = setup()
    let heard = 0
    const off = t.store.subscribe(() => heard++)
    await t.store.saveStep('two-paths', step())
    await t.store.resetRun('two-paths')
    await t.store.clearStory('two-paths')
    await t.store.clearAll()
    expect(heard).toBe(4)
    off()
    await t.store.saveStep('two-paths', step())
    expect(heard).toBe(4)
  })

  it('hears a status change found by a read: first use, blocked storage, a failed read, a reset', async () => {
    const healthy = setup()
    let heard = 0
    healthy.store.subscribe(() => heard++)
    await healthy.store.get('two-paths')
    expect(healthy.store.getStatus().mode).toBe('device')
    expect(heard).toBe(1)
    await healthy.store.list()
    await healthy.store.get('two-paths')
    expect(heard).toBe(1)

    const blocked = createProgressStore({
      device: createDeviceStorage({
        getStorage: () => {
          throw securityError()
        },
        getEventSource: () => null,
      }),
    })
    let blockedHeard = 0
    blocked.subscribe(() => blockedHeard++)
    expect(await blocked.list()).toEqual([])
    expect(blocked.getStatus()).toEqual({ mode: 'memory', reason: 'unavailable', resets: 0 })
    expect(blockedHeard).toBe(1)
    await blocked.get('two-paths')
    expect(blockedHeard).toBe(1)

    const failing = setup()
    failing.storage.failAlways('getItem')
    let failingHeard = 0
    failing.store.subscribe(() => failingHeard++)
    expect(await failing.store.get('two-paths')).toBeNull()
    expect(failing.store.getStatus()).toMatchObject({ mode: 'memory', reason: 'read-failed' })
    expect(failingHeard).toBe(1)

    const reset = setup()
    reset.storage.setItem(PROGRESS_KEY, '{not json')
    await reset.store.list()
    let resetHeard = 0
    reset.store.subscribe(() => resetHeard++)
    // The same invalid value again: already counted, so the status is unchanged.
    await reset.store.list()
    expect(resetHeard).toBe(0)
    reset.storage.setItem(PROGRESS_KEY, '{"schema":1}')
    await reset.store.list()
    expect(reset.store.getStatus().resets).toBe(2)
    expect(resetHeard).toBe(1)
  })

  it('a listener that throws never rejects the call or stops the others', async () => {
    const storage = new FakeWebStorage()
    const errors: unknown[] = []
    const store = createProgressStore({
      device: createDeviceStorage({ getStorage: () => storage, getEventSource: () => null }),
      onListenerError: (error) => errors.push(error),
    })
    const boom = new Error('listener bug')
    store.subscribe(() => {
      throw boom
    })
    let heard = 0
    store.subscribe(() => heard++)
    await expect(store.saveStep('two-paths', step())).resolves.toBeUndefined()
    await expect(store.resetRun('two-paths')).resolves.toBeUndefined()
    await expect(store.saveStep('lion-and-hare', step())).resolves.toBeUndefined()
    await expect(store.clearStory('lion-and-hare')).resolves.toBeUndefined()
    await expect(store.clearAll()).resolves.toBeUndefined()
    expect(heard).toBe(5)
    expect(errors).toEqual([boom, boom, boom, boom, boom])
    expect(storage.count('setItem')).toBe(4)
    expect(storage.getItem(PROGRESS_KEY)).toBeNull()
  })

  it('a listener that is not a function is a TypeError', () => {
    const t = setup()
    for (const bad of [undefined, null, 42, 'listener', {}]) {
      expect(() => t.store.subscribe(bad as unknown as () => void)).toThrow(TypeError)
    }
    expect(t.storage.calls).toEqual([])
  })

  it("hears another tab's changes through the storage event", async () => {
    const origin = new FakeOrigin()
    const mine = origin.openTab()
    const other = origin.openTab()
    const device = createDeviceStorage({
      getStorage: () => mine.localStorage,
      getEventSource: () => mine.window,
    })
    const store = createProgressStore({ device })
    // First use moves the status from 'unknown' to 'device', which subscribers hear on its own.
    await store.list()
    let heard = 0
    const off = store.subscribe(() => heard++)
    const otherStore = createProgressStore({
      device: createDeviceStorage({
        getStorage: () => other.localStorage,
        getEventSource: () => null,
      }),
    })
    await otherStore.saveStep('two-paths', step())
    other.localStorage.setItem(PREFS_KEY, 'not progress')
    origin.flushEvents()
    expect(heard).toBe(1)
    expect((await store.get('two-paths'))?.activeRun).toEqual(step().activeRun)
    off()
    await otherStore.saveStep('two-paths', step())
    origin.flushEvents()
    expect(heard).toBe(1)
  })
})

describe('two tabs: each save re-reads and merges per story', () => {
  function tabs() {
    const origin = new FakeOrigin()
    const make = () => {
      const tab = origin.openTab()
      const device = createDeviceStorage({
        getStorage: () => tab.localStorage,
        getEventSource: () => null,
      })
      return { tab, store: createProgressStore({ device }) }
    }
    return { origin, a: make(), b: make() }
  }

  it('joins endings found in both tabs, and the latest run wins', async () => {
    const { a, b } = tabs()
    await a.store.saveStep(
      'two-paths',
      step({ activeRun: { path: ['start', 'wise_path'], locale: 'en' } }),
    )
    await b.store.saveStep('two-paths', atEnding('ending_quick'))
    await a.store.saveStep('two-paths', atEnding('ending_wise'))
    await b.store.saveStep(
      'two-paths',
      step({ activeRun: { path: ['start', 'quick_path'], locale: 'hi' } }),
    )
    expect(await a.store.get('two-paths')).toEqual({
      version: 1,
      activeRun: { path: ['start', 'quick_path'], locale: 'hi' },
      endingsFound: ['ending_quick', 'ending_wise'],
      order: 1,
    })
  })

  it("never drops another tab's other stories", async () => {
    const { a, b } = tabs()
    await a.store.saveStep('two-paths', step())
    await b.store.saveStep('lion-and-hare', step())
    await a.store.saveStep('river-stones', step())
    expect((await b.store.list()).map((e) => [e.storyId, e.order])).toEqual([
      ['river-stones', 3],
      ['lion-and-hare', 2],
      ['two-paths', 1],
    ])
  })

  it("a clear in another tab is overwritten for this story by this tab's next save", async () => {
    const { a, b } = tabs()
    await a.store.saveStep('two-paths', atEnding('ending_wise'))
    await a.store.saveStep('lion-and-hare', step())
    await b.store.clearAll()
    await a.store.saveStep('two-paths', step())
    expect(await b.store.list()).toEqual([
      { storyId: 'two-paths', ...entry({ activeRun: step().activeRun, order: 1 }) },
    ])
  })
})

describe('speed (Node; spec §6.3 records stay small)', () => {
  function bigRecord(stories: number, pathLength: number, endings: number, idLength: number) {
    const id = (prefix: string, i: number) =>
      `${prefix}${String(i).padStart(2, '0')}_`.padEnd(idLength, 'x')
    const map: Record<string, StoryProgress> = {}
    for (let s = 0; s < stories; s++) {
      map[`story-${String(s).padStart(4, '0')}`] = {
        version: 1 + (s % 5),
        activeRun: {
          path: Array.from({ length: pathLength }, (_, i) => id('n', i)),
          locale: s % 2 === 0 ? 'en' : 'hi',
        },
        endingsFound: Array.from({ length: endings }, (_, i) => id('e', i)),
        order: s + 1,
      }
    }
    return serializeProgress({ schema: 1, stories: map })
  }

  it('saves a 200-story record in under 50 ms (median of 20 saves)', async () => {
    const t = setup()
    t.storage.setItem(PROGRESS_KEY, bigRecord(200, 12, 4, 16))
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const started = performance.now()
      await t.store.saveStep(`story-${String((i * 7) % 200).padStart(4, '0')}`, step())
      times.push(performance.now() - started)
    }
    times.sort((x, y) => x - y)
    const median = ((times[9] ?? 0) + (times[10] ?? 0)) / 2
    console.info(
      `[P1-4a speed] 200-story record: median save ${median.toFixed(2)} ms over 20 saves`,
    )
    expect(t.store.getStatus().mode).toBe('device')
    expect(Object.keys(storedRecord(t.storage).stories)).toHaveLength(200)
    expect(median).toBeLessThan(50)
  })

  it('still saves a near-quota (~4.5 MB) record (time printed, not gated)', async () => {
    const t = setup()
    const raw = bigRecord(680, 64, 64, 48)
    expect(raw.length).toBeGreaterThan(4_400_000)
    expect(raw.length).toBeLessThan(t.storage.quotaBytes / 2)
    t.storage.setItem(PROGRESS_KEY, raw)
    const started = performance.now()
    await t.store.saveStep('two-paths', step())
    const took = performance.now() - started
    console.info(
      `[P1-4a speed] near-quota record (${(raw.length / 1_000_000).toFixed(2)} MB): save ${took.toFixed(1)} ms`,
    )
    expect(t.store.getStatus()).toMatchObject({ mode: 'device', reason: null })
    const saved = storedRecord(t.storage)
    expect(Object.keys(saved.stories)).toHaveLength(681)
    expect(saved.stories['two-paths']?.order).toBe(681)
  })
})
