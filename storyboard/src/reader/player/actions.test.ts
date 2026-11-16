// Player actions (Step 10a; design §4.2 step 6, §5, §9.2): the one synchronous event path. Rendered
// seq, never the live one; refused with no dispatch while not interactive; the engine's result
// untouched; onAccepted synchronously before the action returns, only for accepted results.
import { describe, expect, it } from 'vitest'
import riverStones from '../../../fixtures/packages/river-stones.json'
import { currentNodeId, step, type EngineEvent, type StepResult } from '../../core/engine'
import { ENABLED_LOCALE_CODES } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { createRunController, type RunController } from '../progress/run-controller'
import { createPlayerActions, type PlayerActionsOptions } from './actions'
import { graphOf, playerDataOf } from './player-data'

const graph = graphOf(
  playerDataOf(StoryPackageV1.parse(riverStones), { locales: ENABLED_LOCALE_CODES }),
)

async function setup(interactive: { value: boolean } = { value: true }) {
  const saves: unknown[] = []
  const tasks: (() => void)[] = []
  const controller = createRunController({
    graph,
    store: {
      get: () => Promise.resolve(null),
      saveStep: (_id, write) => {
        saves.push(write)
        return Promise.resolve()
      },
    },
    locale: 'en',
    localePolicy: 'stored-first',
    schedule: (task) => tasks.push(task),
  })
  await controller.open()
  const dispatched: { event: EngineEvent; result: StepResult }[] = []
  const spy: Pick<RunController, 'dispatch' | 'getSnapshot'> = {
    dispatch(event) {
      const result = controller.dispatch(event)
      dispatched.push({ event, result })
      return result
    },
    getSnapshot: () => controller.getSnapshot(),
  }
  const log: string[] = []
  const accepted: StepResult[] = []
  const actions = createPlayerActions({
    controller: spy,
    isInteractive: () => interactive.value,
    onAccepted: (result) => {
      log.push(`accepted ${currentNodeId(result.state)}`)
      accepted.push(result)
    },
  })
  const runTasks = () => {
    for (let task = tasks.shift(); task !== undefined; task = tasks.shift()) task()
  }
  return { controller, actions, dispatched, log, accepted, tasks, runTasks, saves, interactive }
}

const node = (t: { controller: RunController }) => currentNodeId(t.controller.getSnapshot().state)

describe('choose: the rendered seq, so a double tap advances once', () => {
  it("two choose(0, 'c1') go start → flat_stones once (flat_stones' c1 is not an ending)", async () => {
    const t = await setup()
    const first = t.actions.choose(0, 'c1')
    const second = t.actions.choose(0, 'c1')
    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(false)
    expect(second.effects).toEqual([])
    expect(node(t)).toBe('flat_stones')
    expect(t.controller.getSnapshot().state.seq).toBe(1)
    expect(t.dispatched.map((d) => d.event)).toEqual([
      { type: 'CHOOSE', seq: 0, choiceId: 'c1' },
      { type: 'CHOOSE', seq: 0, choiceId: 'c1' },
    ])
    expect(t.accepted).toHaveLength(1)
    t.runTasks()
    expect(t.saves).toHaveLength(1)
    // The next rendered seq advances as usual.
    expect(t.actions.choose(1, 'c1').accepted).toBe(true)
    expect(node(t)).toBe('big_rock')
  })
})

describe('isInteractive: refused with no dispatch while opening or settling', () => {
  it('false refuses choose, back and restart with the current state; nothing dispatched or saved', async () => {
    const t = await setup({ value: false })
    const before = t.controller.getSnapshot().state
    for (const r of [t.actions.choose(0, 'c1'), t.actions.back(0), t.actions.restart(0)]) {
      expect(r).toEqual({ state: before, accepted: false, effects: [] })
      expect(r.state).toBe(before)
    }
    expect(t.dispatched).toHaveLength(0)
    expect(t.accepted).toHaveLength(0)
    expect(t.tasks).toHaveLength(0)
    expect(node(t)).toBe('start')
    t.interactive.value = true
    expect(t.actions.choose(0, 'c1').accepted).toBe(true)
    expect(node(t)).toBe('flat_stones')
  })

  it('setLocale (a header control, never settled) is not refused by isInteractive', async () => {
    const t = await setup({ value: false })
    const r = t.actions.setLocale('hi')
    expect(r.accepted).toBe(true)
    expect(t.controller.getSnapshot().state.locale).toBe('hi')
    expect(t.dispatched.map((d) => d.event)).toEqual([{ type: 'SET_LOCALE', locale: 'hi' }])
  })
})

describe("the engine's result untouched; onAccepted synchronously before the action returns", () => {
  it('choose, back and restart return exactly what the controller returned', async () => {
    const t = await setup()
    const events: [() => StepResult, EngineEvent][] = [
      [() => t.actions.choose(0, 'c1'), { type: 'CHOOSE', seq: 0, choiceId: 'c1' }],
      [() => t.actions.back(1), { type: 'BACK', seq: 1 }],
      [() => t.actions.choose(2, 'c2'), { type: 'CHOOSE', seq: 2, choiceId: 'c2' }],
      [() => t.actions.restart(3), { type: 'RESTART', seq: 3 }],
      [() => t.actions.setLocale('hi'), { type: 'SET_LOCALE', locale: 'hi' }],
    ]
    for (const [i, [act, event]] of events.entries()) {
      const before = t.controller.getSnapshot().state
      t.log.push('call')
      const r = act()
      t.log.push('returned')
      expect(t.dispatched[i]?.event).toEqual(event)
      expect(r).toBe(t.dispatched[i]?.result)
      expect(r).toEqual(step(graph, before, event))
      expect(t.accepted[i]).toBe(r)
    }
    expect(t.log).toEqual([
      'call',
      'accepted flat_stones',
      'returned',
      'call',
      'accepted start',
      'returned',
      'call',
      'accepted round_stones',
      'returned',
      'call',
      'accepted start',
      'returned',
      'call',
      'accepted start',
      'returned',
    ])
    // The focus and audio effects reach onAccepted as the engine made them.
    expect(t.accepted[0]?.effects).toEqual([
      { type: 'persist' },
      { type: 'focus' },
      { type: 'audio', nodeId: 'flat_stones', locale: 'en' },
    ])
    // The saves are scheduled by the controller, after onAccepted ran.
    expect(t.saves).toHaveLength(0)
    t.runTasks()
    expect(t.saves.length).toBeGreaterThan(0)
  })

  it('onAccepted is not called for an engine refusal', async () => {
    const t = await setup()
    expect(t.actions.back(0).accepted).toBe(false)
    expect(t.actions.choose(0, 'c4').accepted).toBe(false)
    expect(t.actions.choose(5, 'c1').accepted).toBe(false)
    expect(t.actions.setLocale('ar').accepted).toBe(false)
    expect(t.dispatched).toHaveLength(4)
    expect(t.accepted).toHaveLength(0)
  })

  it('needs a controller, an isInteractive function and an onAccepted function', () => {
    const controller = createRunController({
      graph,
      store: { get: () => Promise.resolve(null), saveStep: () => Promise.resolve() },
    })
    const ok: PlayerActionsOptions = {
      controller,
      isInteractive: () => true,
      onAccepted: () => {},
    }
    expect(() => createPlayerActions(ok)).not.toThrow()
    const bad: unknown[] = [
      { ...ok, controller: null },
      { ...ok, isInteractive: true },
      { ...ok, onAccepted: undefined },
    ]
    for (const options of bad) {
      expect(() => createPlayerActions(options as PlayerActionsOptions)).toThrow(TypeError)
    }
  })
})
