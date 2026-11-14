import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { currentNodeId, start, step, toGraph } from '../../core/engine'
import type { EngineEvent, EngineState, Graph, GraphNode } from '../../core/engine'
import type { LocaleCode } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import {
  PROGRESS_KEY,
  ProgressRecordSchema,
  endingIdsOf,
  readProgress,
  serializeProgress,
  type ProgressRecord,
  type StoryProgress,
} from '../../core/progress'
import { createDeviceStorage } from './device-storage'
import { createProgressStore, type ProgressStore } from './progress-store'
import { createRunController, type RunControllerOptions } from './run-controller'
import { FakeOrigin, FakeWebStorage } from './testing/fake-web-storage'

const SEED = 20261114
const graph = toGraph(StoryPackageV1.parse(twoPaths))
const STORY = graph.storyId

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const entry = (overrides: Partial<StoryProgress> = {}): StoryProgress => ({
  version: 1,
  activeRun: null,
  endingsFound: [],
  order: 1,
  ...overrides,
})

interface SetupOptions {
  readonly stored?: Record<string, StoryProgress> | string
  readonly locale?: LocaleCode
  readonly manual?: boolean
  readonly g?: Graph
  readonly storage?: FakeWebStorage
}

function setup(options: SetupOptions = {}) {
  const storage = options.storage ?? new FakeWebStorage()
  if (options.stored !== undefined) {
    const raw =
      typeof options.stored === 'string'
        ? options.stored
        : serializeProgress({ schema: 1, stories: options.stored })
    storage.setItem(PROGRESS_KEY, raw)
  }
  storage.calls.length = 0
  const device = createDeviceStorage({ getStorage: () => storage, getEventSource: () => null })
  const store = createProgressStore({ device })
  const tasks: (() => void)[] = []
  const controllerOptions: RunControllerOptions = {
    graph: options.g ?? graph,
    store,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.manual === true ? { schedule: (task: () => void) => tasks.push(task) } : {}),
  }
  const controller = createRunController(controllerOptions)
  const runTasks = () => {
    for (let task = tasks.shift(); task !== undefined; task = tasks.shift()) task()
  }
  const writes = () => storage.count('setItem') + storage.count('removeItem')
  const storedRecord = (): ProgressRecord => {
    const read = readProgress(storage.getItem(PROGRESS_KEY))
    if (read.kind !== 'record') throw new Error('expected a record')
    expect(read.issues).toEqual([])
    return read.record
  }
  const storedStory = () => storedRecord().stories[STORY] ?? null
  return { storage, store, controller, tasks, runTasks, writes, storedRecord, storedStory }
}

const choose = (s: EngineState, choiceId: string, seq = s.seq): EngineEvent => ({
  type: 'CHOOSE',
  seq,
  choiceId,
})

describe('open(): reads once, resumes, never writes', () => {
  it('opens fresh when nothing is saved', async () => {
    const t = setup()
    const r = await t.controller.open()
    expect(r.outcome).toBe('fresh')
    expect(r.state).toEqual(start(graph))
    expect(t.controller.getSnapshot()).toEqual({ phase: 'open', state: r.state, outcome: 'fresh' })
    expect(t.writes()).toBe(0)
  })

  it('resumes the exact stored path and language', async () => {
    const t = setup({
      stored: { [STORY]: entry({ activeRun: { path: ['start', 'quick_path'], locale: 'hi' } }) },
    })
    const r = await t.controller.open()
    expect(r.outcome).toBe('resumed')
    expect(r.state.path).toEqual(['start', 'quick_path'])
    expect(r.state.locale).toBe('hi')
    expect(t.writes()).toBe(0)
  })

  it('adjusts ["wise_path"] to ["start"] and still writes nothing', async () => {
    const t = setup({
      stored: { [STORY]: entry({ activeRun: { path: ['wise_path'], locale: 'en' } }) },
    })
    const r = await t.controller.open()
    expect(r.outcome).toBe('adjusted')
    expect(r.state.path).toEqual(['start'])
    expect(t.writes()).toBe(0)
    expect(t.storedStory()?.activeRun).toEqual({ path: ['wise_path'], locale: 'en' })
  })

  it('adjusts a trimmed path and a language-only change, writing nothing', async () => {
    const trimmed = setup({
      stored: {
        [STORY]: entry({ activeRun: { path: ['start', 'wise_path', 'gone'], locale: 'en' } }),
      },
    })
    expect((await trimmed.controller.open()).outcome).toBe('adjusted')
    const language = setup({
      stored: { [STORY]: entry({ activeRun: { path: ['start', 'wise_path'], locale: 'en' } }) },
      locale: 'hi',
    })
    const r = await language.controller.open()
    expect(r.outcome).toBe('adjusted')
    expect(r.state.path).toEqual(['start', 'wise_path'])
    expect(r.state.locale).toBe('hi')
    expect(trimmed.writes() + language.writes()).toBe(0)
  })

  it('counts a stored run that ends at an ending as no run', async () => {
    const t = setup({
      stored: {
        [STORY]: entry({
          activeRun: { path: ['start', 'wise_path', 'ending_wise'], locale: 'hi' },
        }),
      },
    })
    const r = await t.controller.open()
    expect(r.outcome).toBe('fresh')
    expect(r.state).toEqual(start(graph))
    expect(t.writes()).toBe(0)
  })

  it('never writes when the stored record needed a reset', async () => {
    const t = setup({
      stored:
        '{"schema":1,"stories":{"two-paths":{"version":1,"activeRun":7,"endingsFound":[1],"order":2}}}',
    })
    expect((await t.controller.open()).outcome).toBe('fresh')
    expect(t.writes()).toBe(0)
  })

  it('returns the same promise on every call and reads storage once', async () => {
    const t = setup()
    const first = t.controller.open()
    expect(t.controller.open()).toBe(first)
    await first
    expect(t.controller.open()).toBe(first)
    expect(t.storage.count('getItem')).toBe(1)
  })

  it('never rejects: a rejecting or malformed store opens the story fresh', async () => {
    const stores: Pick<ProgressStore, 'get' | 'saveStep'>[] = [
      { get: () => Promise.reject(new Error('broken store')), saveStep: () => Promise.resolve() },
      {
        get: () => Promise.resolve({ activeRun: { path: null } } as unknown as StoryProgress),
        saveStep: () => Promise.resolve(),
      },
      {
        get: () => Promise.resolve(undefined as unknown as null),
        saveStep: () => Promise.resolve(),
      },
    ]
    for (const store of stores) {
      const r = await createRunController({ graph, store }).open()
      expect(r.outcome).toBe('fresh')
      expect(r.state).toEqual(start(graph))
      // The caller's language still wins when the stored entry cannot be used.
      const hindi = await createRunController({ graph, store, locale: 'hi' }).open()
      expect(hindi.outcome).toBe('fresh')
      expect(hindi.state).toEqual(start(graph, { path: ['start'], locale: 'hi' }))
    }
  })

  it('takes the caller language over the stored one, then the stored one, then the default', async () => {
    const stored = { [STORY]: entry({ activeRun: { path: ['start', 'wise_path'], locale: 'hi' } }) }
    expect((await setup({ stored, locale: 'en' }).controller.open()).state.locale).toBe('en')
    expect((await setup({ stored }).controller.open()).state.locale).toBe('hi')
    const arabic = { [STORY]: entry({ activeRun: { path: ['start', 'wise_path'], locale: 'ar' } }) }
    expect((await setup({ stored: arabic }).controller.open()).state.locale).toBe('en')
    expect((await setup({ locale: 'hi' }).controller.open()).state.locale).toBe('hi')
  })

  it('refuses a language code that is not registered, and a missing graph or store', () => {
    const t = setup()
    expect(() =>
      createRunController({ graph, store: t.store, locale: 'fr' as LocaleCode }),
    ).toThrow(TypeError)
    expect(() => createRunController({ graph: null as unknown as Graph, store: t.store })).toThrow(
      TypeError,
    )
    expect(() => createRunController({ graph, store: null as unknown as ProgressStore })).toThrow(
      TypeError,
    )
    expect(() =>
      createRunController({ graph, store: t.store, schedule: 'soon' as unknown as () => void }),
    ).toThrow(TypeError)
    expect(() =>
      createRunController({
        graph,
        store: t.store,
        onListenerError: 42 as unknown as () => void,
      }),
    ).toThrow(TypeError)
    for (const bad of [undefined, null, 42, 'listener', {}]) {
      expect(() => t.controller.subscribe(bad as unknown as () => void)).toThrow(TypeError)
    }
  })

  it('notifies subscribers once when open resolves', async () => {
    const t = setup()
    let heard = 0
    t.controller.subscribe(() => heard++)
    const before = t.controller.getSnapshot()
    await t.controller.open()
    await settle()
    expect(heard).toBe(1)
    expect(t.controller.getSnapshot()).not.toBe(before)
    expect(before.phase).toBe('opening')
  })
})

describe('a subscriber that throws', () => {
  it("never makes dispatch() throw: the caller still gets the engine's audio effect", async () => {
    const storage = new FakeWebStorage()
    const store = createProgressStore({
      device: createDeviceStorage({ getStorage: () => storage, getEventSource: () => null }),
    })
    const errors: unknown[] = []
    const controller = createRunController({
      graph,
      store,
      onListenerError: (error) => errors.push(error),
    })
    const boom = new Error('listener bug')
    controller.subscribe(() => {
      throw boom
    })
    let heard = 0
    controller.subscribe(() => heard++)
    // open() resolves, and its notification reaches the second listener too.
    await controller.open()
    await settle()
    expect(heard).toBe(1)
    expect(errors).toEqual([boom])
    const before = controller.getSnapshot().state
    const e = choose(before, 'c1')
    const log: string[] = []
    const r = controller.dispatch(e)
    for (const effect of r.effects) if (effect.type === 'audio') log.push(`audio ${effect.nodeId}`)
    expect(r).toEqual(step(graph, before, e))
    expect(log).toEqual(['audio wise_path'])
    expect(heard).toBe(2)
    expect(errors).toEqual([boom, boom])
    await settle()
    expect(storage.count('setItem')).toBe(1)
  })
})

describe('events before open() resolves are refused', () => {
  it('before open() is called: accepted false, no effects, nothing scheduled', () => {
    const t = setup({ manual: true, locale: 'hi' })
    const snapshot = t.controller.getSnapshot()
    expect(snapshot).toEqual({
      phase: 'opening',
      state: start(graph, { path: ['start'], locale: 'hi' }),
      outcome: null,
    })
    const r = t.controller.dispatch(choose(snapshot.state, 'c1'))
    expect(r).toEqual({ state: snapshot.state, accepted: false, effects: [] })
    expect(t.tasks).toHaveLength(0)
    expect(t.controller.getSnapshot()).toBe(snapshot)
  })

  it('while open() is still reading', async () => {
    const t = setup({ manual: true })
    const opening = t.controller.open()
    const s = t.controller.getSnapshot().state
    for (const e of [
      choose(s, 'c1'),
      { type: 'RESTART', seq: 0 } as const,
      { type: 'SET_LOCALE', locale: 'hi' } as const,
    ]) {
      expect(t.controller.dispatch(e).accepted).toBe(false)
    }
    expect(t.tasks).toHaveLength(0)
    await opening
    expect(t.controller.dispatch(choose(s, 'c1')).accepted).toBe(true)
  })
})

describe('dispatch(): engine output untouched, one save per accepted step', () => {
  it("returns exactly the engine's result, focus and audio effects included", async () => {
    const t = setup({ manual: true })
    await t.controller.open()
    const before = t.controller.getSnapshot().state
    const e = choose(before, 'c1')
    const r = t.controller.dispatch(e)
    expect(r).toEqual(step(graph, before, e))
    expect(r.state.seq).toBe(1)
    expect(r.effects).toEqual([
      { type: 'persist' },
      { type: 'focus' },
      { type: 'audio', nodeId: 'wise_path', locale: 'en' },
    ])
    expect(t.controller.getSnapshot().state).toBe(r.state)
  })

  it('schedules the save and never writes inside dispatch', async () => {
    const t = setup({ manual: true })
    await t.controller.open()
    t.storage.calls.length = 0
    t.controller.dispatch(choose(t.controller.getSnapshot().state, 'c1'))
    expect(t.storage.calls).toEqual([])
    expect(t.tasks).toHaveLength(1)
    t.runTasks()
    expect(t.storage.calls).toEqual([`getItem ${PROGRESS_KEY}`, `setItem ${PROGRESS_KEY}`])
    expect(t.storedStory()).toEqual(
      entry({ activeRun: { path: ['start', 'wise_path'], locale: 'en' } }),
    )
  })

  it("saves in a microtask by default, after the caller's synchronous code (the audio call)", async () => {
    const storage = new FakeWebStorage()
    const store = createProgressStore({
      device: createDeviceStorage({ getStorage: () => storage, getEventSource: () => null }),
    })
    const log: string[] = []
    const controller = createRunController({
      graph,
      store: {
        get: (id) => store.get(id),
        saveStep: (id, w) => {
          log.push('save')
          return store.saveStep(id, w)
        },
      },
    })
    await controller.open()
    // The tap handler: dispatch, then the engine's audio effect runs synchronously.
    const r = controller.dispatch(choose(controller.getSnapshot().state, 'c2'))
    for (const effect of r.effects) if (effect.type === 'audio') log.push(`audio ${effect.nodeId}`)
    expect(log).toEqual(['audio quick_path'])
    expect(storage.count('setItem')).toBe(0)
    await Promise.resolve()
    expect(log).toEqual(['audio quick_path', 'save'])
    expect(storage.count('setItem')).toBe(1)
  })

  it('saves nothing for refused events or SET_LOCALE to the language already shown', async () => {
    const t = setup({ manual: true })
    await t.controller.open()
    const s = t.controller.getSnapshot().state
    const refused: EngineEvent[] = [
      choose(s, 'c1', 5),
      choose(s, 'c4'),
      { type: 'BACK', seq: 0 },
      { type: 'RESTART', seq: 3 },
      { type: 'SET_LOCALE', locale: 'ar' },
    ]
    for (const e of refused) expect(t.controller.dispatch(e).accepted).toBe(false)
    const same = t.controller.dispatch({ type: 'SET_LOCALE', locale: 'en' })
    expect(same.accepted).toBe(true)
    expect(same.effects).toEqual([])
    expect(t.tasks).toHaveLength(0)
    expect(t.controller.getSnapshot().state).toBe(s)
  })

  it('saves the null run and the ending together in one write', async () => {
    const t = setup({ manual: true })
    await t.controller.open()
    t.controller.dispatch(choose(t.controller.getSnapshot().state, 'c1'))
    t.controller.dispatch(choose(t.controller.getSnapshot().state, 'c1'))
    t.runTasks()
    expect(t.storage.count('setItem')).toBe(2)
    expect(t.storedStory()).toEqual(entry({ endingsFound: ['ending_wise'] }))
  })

  it('SET_LOCALE at the start node saves a null run (a saved run needs a choice)', async () => {
    const t = setup({ manual: true })
    await t.controller.open()
    const r = t.controller.dispatch({ type: 'SET_LOCALE', locale: 'hi' })
    expect(r.accepted).toBe(true)
    t.runTasks()
    expect(t.storedStory()).toEqual(entry())
    expect(t.controller.getSnapshot().state.locale).toBe('hi')
  })

  it('SET_LOCALE mid-story saves the run in the new language', async () => {
    const t = setup({ manual: true })
    await t.controller.open()
    t.controller.dispatch(choose(t.controller.getSnapshot().state, 'c2'))
    t.controller.dispatch({ type: 'SET_LOCALE', locale: 'hi' })
    t.runTasks()
    expect(t.storedStory()?.activeRun).toEqual({ path: ['start', 'quick_path'], locale: 'hi' })
  })

  it('keeps the snapshot on refused events and notifies only on accepted changes', async () => {
    const t = setup({ manual: true })
    await t.controller.open()
    await settle()
    let heard = 0
    t.controller.subscribe(() => heard++)
    const s = t.controller.getSnapshot()
    t.controller.dispatch({ type: 'BACK', seq: 0 })
    t.controller.dispatch({ type: 'SET_LOCALE', locale: 'en' })
    expect(t.controller.getSnapshot()).toBe(s)
    expect(heard).toBe(0)
    t.controller.dispatch(choose(s.state, 'c1'))
    expect(heard).toBe(1)
    expect(t.controller.getSnapshot()).not.toBe(s)
    expect(t.controller.getSnapshot().outcome).toBe('fresh')
  })
})

describe('another tab', () => {
  function twoTabs() {
    const origin = new FakeOrigin()
    const tabStore = () => {
      const tab = origin.openTab()
      return createProgressStore({
        device: createDeviceStorage({
          getStorage: () => tab.localStorage,
          getEventSource: () => tab.window,
        }),
      })
    }
    return { origin, mine: tabStore(), other: tabStore() }
  }

  it("never alters the open run; this tab's next save wins and endings are joined", async () => {
    const { mine, other } = twoTabs()
    const controller = createRunController({ graph, store: mine })
    await controller.open()
    controller.dispatch(choose(controller.getSnapshot().state, 'c1'))
    await settle()
    await other.saveStep(STORY, {
      version: 1,
      activeRun: null,
      ending: 'ending_quick',
      currentEndings: endingIdsOf(graph),
    })
    await other.saveStep(STORY, {
      version: 1,
      activeRun: { path: ['start', 'quick_path'], locale: 'hi' },
      ending: null,
      currentEndings: endingIdsOf(graph),
    })
    expect(controller.getSnapshot().state.path).toEqual(['start', 'wise_path'])
    controller.dispatch({ type: 'SET_LOCALE', locale: 'hi' })
    await settle()
    expect(await other.get(STORY)).toEqual(
      entry({
        activeRun: { path: ['start', 'wise_path'], locale: 'hi' },
        endingsFound: ['ending_quick'],
      }),
    )
  })

  it('a clear while a run is open: the next save recreates the entry', async () => {
    const { mine, other } = twoTabs()
    const controller = createRunController({ graph, store: mine })
    await controller.open()
    controller.dispatch(choose(controller.getSnapshot().state, 'c2'))
    await settle()
    await other.clearAll()
    expect(await mine.get(STORY)).toBeNull()
    controller.dispatch({ type: 'SET_LOCALE', locale: 'hi' })
    await settle()
    expect(await other.get(STORY)).toEqual(
      entry({ activeRun: { path: ['start', 'quick_path'], locale: 'hi' } }),
    )
  })
})

describe('every row of the spec §6.2 table, through the controller', () => {
  interface Row {
    readonly name: string
    /** Choice ids to take first, through the controller. */
    readonly before: readonly string[]
    readonly event: (s: EngineState) => EngineEvent
    readonly accepted: boolean
    readonly saves: 0 | 1
    readonly story?: StoryProgress | null
  }
  const run = (path: string[], locale: LocaleCode = 'en') => ({ path, locale })
  const rows: Row[] = [
    {
      name: 'CHOOSE: appends the target, seq + 1',
      before: [],
      event: (s) => choose(s, 'c1'),
      accepted: true,
      saves: 1,
      story: entry({ activeRun: run(['start', 'wise_path']) }),
    },
    {
      name: 'CHOOSE into an ending: status ended, recordEnding',
      before: ['c2'],
      event: (s) => choose(s, 'c1'),
      accepted: true,
      saves: 1,
      story: entry({ endingsFound: ['ending_quick'] }),
    },
    {
      name: 'CHOOSE with a stale seq',
      before: ['c1'],
      event: (s) => choose(s, 'c1', s.seq - 1),
      accepted: false,
      saves: 0,
    },
    {
      name: 'CHOOSE with an unknown choice',
      before: [],
      event: (s) => choose(s, 'c3'),
      accepted: false,
      saves: 0,
    },
    {
      name: 'CHOOSE after the run ended',
      before: ['c1', 'c1'],
      event: (s) => choose(s, 'c1'),
      accepted: false,
      saves: 0,
    },
    {
      name: 'BACK: pops, seq + 1, reading',
      before: ['c1', 'c1'],
      event: (s) => ({ type: 'BACK', seq: s.seq }),
      accepted: true,
      saves: 1,
      story: entry({ activeRun: run(['start', 'wise_path']), endingsFound: ['ending_wise'] }),
    },
    {
      name: 'BACK to the start node saves a null run',
      before: ['c2'],
      event: (s) => ({ type: 'BACK', seq: s.seq }),
      accepted: true,
      saves: 1,
      story: entry(),
    },
    {
      name: 'BACK at the start node',
      before: [],
      event: (s) => ({ type: 'BACK', seq: s.seq }),
      accepted: false,
      saves: 0,
    },
    {
      name: 'BACK with a stale seq',
      before: ['c1'],
      event: () => ({ type: 'BACK', seq: 0 }),
      accepted: false,
      saves: 0,
    },
    {
      name: 'RESTART: path [start], seq + 1, runEpoch + 1',
      before: ['c1', 'c1'],
      event: (s) => ({ type: 'RESTART', seq: s.seq }),
      accepted: true,
      saves: 1,
      story: entry({ endingsFound: ['ending_wise'] }),
    },
    {
      name: 'RESTART with a stale seq',
      before: ['c1'],
      event: () => ({ type: 'RESTART', seq: 0 }),
      accepted: false,
      saves: 0,
    },
    {
      name: 'SET_LOCALE to a package locale: same node and seq',
      before: ['c1'],
      event: () => ({ type: 'SET_LOCALE', locale: 'hi' }),
      accepted: true,
      saves: 1,
      story: entry({ activeRun: run(['start', 'wise_path'], 'hi') }),
    },
    {
      name: 'SET_LOCALE to a locale the package lacks',
      before: ['c1'],
      event: () => ({ type: 'SET_LOCALE', locale: 'ar' }),
      accepted: false,
      saves: 0,
    },
  ]

  it.each(rows)('$name', async (row) => {
    const t = setup({ manual: true })
    await t.controller.open()
    for (const choiceId of row.before) {
      expect(
        t.controller.dispatch(choose(t.controller.getSnapshot().state, choiceId)).accepted,
      ).toBe(true)
    }
    t.runTasks()
    const savesBefore = t.storage.count('setItem')
    const s = t.controller.getSnapshot().state
    const e = row.event(s)
    const r = t.controller.dispatch(e)
    expect(r).toEqual(step(graph, s, e))
    expect(r.accepted).toBe(row.accepted)
    expect(t.tasks).toHaveLength(row.saves)
    t.runTasks()
    expect(t.storage.count('setItem') - savesBefore).toBe(row.saves)
    if (row.story !== undefined) {
      const saved = t.storedStory()
      expect(saved === null ? null : { ...saved, order: 1 }).toEqual(row.story)
    }
  })
})

describe('controller properties (fixed seed)', () => {
  const fixtureGraphs = [twoPaths, riverStones, lanternWalk].map((p) =>
    toGraph(StoryPackageV1.parse(p)),
  )

  // Random acyclic graphs as in the engine tests: node i links only to higher indices.
  const arbRandomGraph = fc.integer({ min: 4, max: 14 }).chain((size) =>
    fc
      .array(
        fc.record({
          endRoll: fc.integer({ min: 0, max: 5 }),
          targets: fc.array(fc.nat(), { minLength: 1, maxLength: 2 }),
        }),
        { minLength: size, maxLength: size },
      )
      .map((specs): Graph => {
        const nodes = new Map<string, GraphNode>()
        specs.forEach((spec, i) => {
          const ending = i === specs.length - 1 || (i > 0 && spec.endRoll === 0)
          const choices = ending
            ? []
            : spec.targets.map((t, k) => ({
                id: `c${k + 1}`,
                next: `n${i + 1 + (t % (specs.length - 1 - i))}`,
              }))
          const type = ending ? 'ending' : choices.length === 2 ? 'fork' : 'single'
          nodes.set(`n${i}`, { id: `n${i}`, type, choices })
        })
        return {
          storyId: 'random-story',
          version: 1 + (specs.length % 3),
          startNodeId: 'n0',
          locales: ['en', 'hi'] as LocaleCode[],
          defaultLocale: 'en',
          nodes,
        }
      }),
  )
  const arbGraph = fc.oneof(fc.constantFrom(...fixtureGraphs), arbRandomGraph)

  const arbOps = fc.array(
    fc.record({
      kind: fc.constantFrom(
        'CHOOSE',
        'CHOOSE',
        'CHOOSE',
        'CHOOSE',
        'BACK',
        'RESTART',
        'SET_LOCALE',
      ),
      seqDelta: fc.constantFrom(-1, 0, 0, 0, 1),
      choiceIdx: fc.nat({ max: 2 }),
      locale: fc.constantFrom('en', 'hi', 'ar'),
    }),
    { minLength: 1, maxLength: 40, size: 'max' },
  )
  type Op = { kind: string; seqDelta: number; choiceIdx: number; locale: string }

  function toEvent(op: Op, s: EngineState): EngineEvent {
    const seq = s.seq + op.seqDelta
    if (op.kind === 'CHOOSE') return { type: 'CHOOSE', seq, choiceId: `c${op.choiceIdx + 1}` }
    if (op.kind === 'BACK') return { type: 'BACK', seq }
    if (op.kind === 'RESTART') return { type: 'RESTART', seq }
    return { type: 'SET_LOCALE', locale: op.locale }
  }

  const arbOther = fc.option(
    fc.record({ order: fc.integer({ min: 1, max: 50 }), withRun: fc.boolean() }),
    { nil: null },
  )
  const arbCallerLocale = fc.option(fc.constantFrom<LocaleCode>('en', 'hi', 'ar'), {
    nil: undefined,
  })

  it('random event sequences leave a stored record that reads back valid and keeps the rules', async () => {
    const cover = { saves: 0, endings: 0, back: 0, restart: 0, locale: 0, untouched: 0 }
    await fc.assert(
      fc.asyncProperty(
        arbGraph,
        arbOps,
        arbOther,
        arbCallerLocale,
        async (g, ops, other, locale) => {
          const stored: Record<string, StoryProgress> = {}
          if (other !== null) {
            stored['other-story'] = entry({
              order: other.order,
              activeRun: other.withRun ? { path: ['start', 'x'], locale: 'en' } : null,
            })
          }
          const storage = new FakeWebStorage()
          const initialRaw =
            other === null ? null : serializeProgress({ schema: 1, stories: stored })
          if (initialRaw !== null) storage.setItem(PROGRESS_KEY, initialRaw)
          const store = createProgressStore({
            device: createDeviceStorage({ getStorage: () => storage, getEventSource: () => null }),
          })
          const controller = createRunController({ graph: g, store, ...(locale ? { locale } : {}) })
          await controller.open()
          const endingsReached = new Set<string>()
          let accepted = 0
          for (const op of ops) {
            const s = controller.getSnapshot().state
            const e = toEvent(op, s)
            const r = controller.dispatch(e)
            expect(r).toEqual(step(g, s, e))
            if (!r.accepted || !r.effects.some((x) => x.type === 'persist')) continue
            accepted++
            if (e.type === 'BACK') cover.back++
            if (e.type === 'RESTART') cover.restart++
            if (e.type === 'SET_LOCALE') cover.locale++
            for (const x of r.effects) if (x.type === 'recordEnding') endingsReached.add(x.nodeId)
          }
          // The saves were queued as microtasks during dispatch; this continuation runs after them.
          await Promise.resolve()

          expect(storage.count('setItem', PROGRESS_KEY)).toBe(
            accepted + (initialRaw === null ? 0 : 1),
          )
          if (accepted === 0) {
            // Opening and refused events never write.
            cover.untouched++
            expect(storage.getItem(PROGRESS_KEY)).toBe(initialRaw)
            return
          }
          cover.saves += accepted
          cover.endings += endingsReached.size
          const read = readProgress(storage.getItem(PROGRESS_KEY))
          if (read.kind !== 'record') throw new Error('expected a record')
          expect(read.issues).toEqual([])
          expect(ProgressRecordSchema.safeParse(read.record).success).toBe(true)
          const saved = read.record.stories[g.storyId]
          if (saved === undefined) throw new Error('the story was not saved')

          const final = controller.getSnapshot().state
          const atRest = final.status === 'ended' || final.path.length === 1
          expect(saved.activeRun).toEqual(
            atRest ? null : { path: final.path, locale: final.locale },
          )
          if (saved.activeRun !== null) {
            expect(g.nodes.get(currentNodeId(final))?.type).not.toBe('ending')
            expect(saved.activeRun.path[0]).toBe(g.startNodeId)
          }
          expect(saved.version).toBe(g.version)
          expect(new Set(saved.endingsFound)).toEqual(endingsReached)
          expect(saved.endingsFound.length).toBeLessThanOrEqual(64)
          const others = Object.entries(read.record.stories).filter(([id]) => id !== g.storyId)
          for (const [, s] of others) expect(saved.order).toBeGreaterThan(s.order)
          if (other !== null)
            expect(read.record.stories['other-story']).toEqual(stored['other-story'])
        },
      ),
      { seed: SEED, numRuns: 300 },
    )
    // Guard against a vacuous property.
    expect(cover.saves).toBeGreaterThan(1000)
    expect(cover.endings).toBeGreaterThan(50)
    expect(cover.back).toBeGreaterThan(50)
    expect(cover.restart).toBeGreaterThan(50)
    expect(cover.locale).toBeGreaterThan(50)
    expect(cover.untouched).toBeGreaterThan(0)
  })
})
