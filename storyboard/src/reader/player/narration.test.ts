// The narration session (Step 11; design p1-step11-design.md §4.2 to §4.5, N3 to N12, N17, N19,
// N20; test plan §13.3 T11-4 to T11-13). The session drives the real controller
// (src/reader/audio/narration-controller.ts, unchanged) over FakeMediaElement, with lifecycle
// resync off, through a call spy, and its hold timer is injected, so no test waits on real time.
// - T11-4: one controller per attach, disposed by its detach; nothing while detached; a stable
//   snapshot for useSyncExternalStore.
// - T11-5, T11-6: a step's audio effect and a story-language switch, on and off, in both modes.
// - T11-7, T11-8: Read to me, the playback actions and the 500 ms hold (a timer, never a clock).
// - T11-9: off means the controller is idle, after any sequence (a seeded table of 300 runs).
// - T11-10: narrationDisplayOf against the 4.4 table typed here, never computed from the code.
// - T11-11: the one mode switch (NARRATION_MODE), and tap-to-listen end to end.
// - T11-12, T11-13: the lookups and the once-per-run announcement decision.
// The PlayerData here is river-stones with narration URLs set by hand (big_rock has no Hindi
// clip), so these tests never depend on how playerDataOf builds them (T11-1 covers that).
import { afterEach, describe, expect, it, vi } from 'vitest'
import riverStones from '../../../fixtures/packages/river-stones.json'
import { start, step, type EngineEvent, type EngineState, type StepResult } from '../../core/engine'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import {
  createNarrationController,
  type NarrationController,
  type NarrationMode,
} from '../audio/narration-controller'
import { NARRATION_STATUSES, type NarrationStatus } from '../audio/narration-state'
import { FakeMediaElement, MEDIA_ERR_SRC_NOT_SUPPORTED } from '../audio/testing/fake-media-element'
import {
  HOW_STORIES_ARE_MADE_ID,
  NARRATION_MODE,
  NARRATION_PLAYBACKS,
  createNarrationSession,
  narrationAnnouncementOf,
  narrationDisplayOf,
  narrationOfferedIn,
  narrationPartOf,
  narrationUrlOf,
  type NarrationDisplay,
  type NarrationPart,
  type NarrationPlayback,
  type NarrationSession,
  type NarrationSessionSnapshot,
} from './narration'
import { graphOf, playerDataOf, type PlayerData } from './player-data'
import { tokenOf } from './view'

// T11-11 g1: the default controller's options are captured; every call still reaches the real one.
vi.mock('../audio/narration-controller', async (importOriginal) => {
  const real = await importOriginal<typeof import('../audio/narration-controller')>()
  return {
    ...real,
    createNarrationController: vi.fn(
      (options?: Parameters<typeof real.createNarrationController>[0]) =>
        real.createNarrationController(options),
    ),
  }
})

afterEach(() => {
  vi.useRealTimers()
})

const clipUrl = (nodeId: string, locale: string): string =>
  `https://media.test/content/media/narrated/${nodeId}-${locale}-audio.mp3`

/** river-stones' PlayerData with narration: every node in en and hi, but big_rock has no hi clip. */
function narratedData(skip: (nodeId: string, locale: LocaleCode) => boolean): PlayerData {
  const base = playerDataOf(StoryPackageV1.parse(riverStones), { locales: ENABLED_LOCALE_CODES })
  return {
    ...base,
    nodes: base.nodes.map((node) => ({
      ...node,
      narration: Object.fromEntries(
        base.locales
          .filter((locale) => !skip(node.id, locale))
          .map((locale) => [locale, clipUrl(node.id, locale)]),
      ),
    })),
  }
}

const DATA = narratedData((nodeId, locale) => nodeId === 'big_rock' && locale === 'hi')
const GRAPH = graphOf(DATA)

const at = (path: string[], locale: LocaleCode = 'en'): EngineState =>
  start(GRAPH, { path, locale })
const send = (state: EngineState, event: EngineEvent): StepResult => step(GRAPH, state, event)
const choose = (state: EngineState, choiceId: string): StepResult =>
  send(state, { type: 'CHOOSE', seq: state.seq, choiceId })
const back = (state: EngineState): StepResult => send(state, { type: 'BACK', seq: state.seq })
const restart = (state: EngineState): StepResult => send(state, { type: 'RESTART', seq: state.seq })
const switchTo = (state: EngineState, locale: LocaleCode): StepResult =>
  send(state, { type: 'SET_LOCALE', locale })

/** The audio effect of a result, checked first (each test's non-vacuous precondition). */
function audioOf(result: StepResult): { nodeId: string; locale: string } {
  expect(result.accepted, 'the step was accepted').toBe(true)
  const audio = result.effects.find((effect) => effect.type === 'audio')
  if (audio === undefined || audio.type !== 'audio') throw new Error('no audio effect')
  return { nodeId: audio.nodeId, locale: audio.locale }
}

/** Every controller call the session makes, as "name arg arg". */
function spyController(real: NarrationController, calls: string[]): NarrationController {
  return {
    ...real,
    playInGesture: (url, token) => {
      calls.push(`playInGesture ${url} ${token}`)
      real.playInGesture(url, token)
    },
    advanceInGesture: (url, token) => {
      calls.push(`advanceInGesture ${url} ${token}`)
      real.advanceInGesture(url, token)
    },
    resumeInGesture: () => {
      calls.push('resumeInGesture')
      return real.resumeInGesture()
    },
    pause: () => {
      calls.push('pause')
      real.pause()
    },
    stop: () => {
      calls.push('stop')
      real.stop()
    },
    seekTo: (seconds) => {
      calls.push(`seekTo ${seconds}`)
      return real.seekTo(seconds)
    },
    seekBy: (delta) => {
      calls.push(`seekBy ${delta}`)
      return real.seekBy(delta)
    },
    resync: () => {
      calls.push('resync')
      real.resync()
    },
    setMode: (mode) => {
      calls.push(`setMode ${mode}`)
      real.setMode(mode)
    },
    dispose: () => {
      calls.push('dispose')
      real.dispose()
    },
  }
}

interface FakeTimer {
  readonly task: () => void
  readonly ms: number
  cleared: boolean
  fired: boolean
}

interface Rig {
  readonly session: NarrationSession
  /** Controller calls, in order (cleared by tests between phases). */
  readonly calls: string[]
  readonly controllers: NarrationController[]
  readonly elements: FakeMediaElement[]
  readonly timers: FakeTimer[]
  /** Fires every hold timer that is armed and not cleared. */
  fire(): void
  /** Runs the fake elements' queued tasks and promise callbacks. */
  settle(): Promise<void>
  status(): NarrationStatus
}

function rig(mode: NarrationMode = 'play-on-choice', data: PlayerData = DATA): Rig {
  const calls: string[] = []
  const controllers: NarrationController[] = []
  const elements: FakeMediaElement[] = []
  const timers: FakeTimer[] = []
  const session = createNarrationSession({
    data,
    createController: () => {
      const real = createNarrationController({
        mode,
        lifecycle: null,
        createElement: () => {
          const element = new FakeMediaElement()
          elements.push(element)
          return element
        },
      })
      const spied = spyController(real, calls)
      controllers.push(spied)
      return spied
    },
    setTimer: (task, ms) => {
      const timer: FakeTimer = { task, ms, cleared: false, fired: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (id) => {
      ;(id as FakeTimer).cleared = true
    },
  })
  return {
    session,
    calls,
    controllers,
    elements,
    timers,
    fire: () => {
      for (const timer of [...timers]) {
        if (timer.cleared || timer.fired) continue
        timer.fired = true
        timer.task()
      }
    },
    settle: async () => {
      for (const element of elements) await element.settle()
    },
    status: () => session.getSnapshot().status,
  }
}

const partAt = (state: EngineState): NarrationPart => narrationPartOf(DATA, state)

describe('T11-4 the session: one controller per attach, disposed by its detach (A4, N19)', () => {
  it('(g1) makes no controller before attach and exactly one on attach', () => {
    const r = rig()
    expect(r.controllers, '(g1) before attach').toHaveLength(0)
    r.session.attach()
    expect(r.controllers, '(g1) after attach').toHaveLength(1)
  })

  it('(g2) detach disposes that controller once; the snapshot is idle with no token', async () => {
    const r = rig()
    const detach = r.session.attach()
    r.session.toggle(partAt(at(['start'])))
    await r.settle()
    expect(r.status(), 'precondition: playing or loading').not.toBe('idle')
    r.calls.length = 0
    detach()
    detach()
    expect(r.calls, '(g2) dispose once').toEqual(['dispose'])
    expect(r.session.getSnapshot(), '(g2) idle while detached').toMatchObject({
      status: 'idle',
      token: null,
      url: null,
    })
  })

  it('(g3) attach after detach makes a second controller, and a toggle plays through it', () => {
    const r = rig()
    r.session.attach()()
    r.session.attach()
    expect(r.controllers, '(g3) a fresh controller').toHaveLength(2)
    r.calls.length = 0
    const part = partAt(at(['start']))
    expect(r.session.toggle(part), '(g3) on').toBe(true)
    expect(r.calls, '(g3) the call').toEqual([`playInGesture ${part.url} ${part.token}`])
    expect(r.elements, '(g3) one element, from the new controller').toHaveLength(1)
    expect(r.status(), '(g3) loading through the new controller').toBe('loading')
  })

  it('(g4) while detached (before attach and after detach) no command reaches a controller and the snapshot stays the same object', () => {
    const r = rig()
    const state = at(['start'])
    const commands = (session: NarrationSession): void => {
      expect(session.toggle(partAt(state)), 'toggle while detached').toBeNull()
      for (const kind of NARRATION_PLAYBACKS) {
        expect(session.playback(kind, partAt(state)), `${kind} while detached`).toBe(false)
      }
      session.onStep(choose(state, 'c1'))
      session.onSwitch(partAt(switchTo(state, 'hi').state))
    }
    const before = r.session.getSnapshot()
    commands(r.session)
    expect(r.session.getSnapshot(), '(g4) before attach: the same object').toBe(before)
    expect(r.controllers, '(g4) still no controller').toHaveLength(0)
    const detach = r.session.attach()
    r.session.setOn(true)
    detach()
    r.calls.length = 0
    const detached = r.session.getSnapshot()
    commands(r.session)
    expect(r.calls, '(g4) after detach: no call').toEqual([])
    expect(r.session.getSnapshot(), '(g4) after detach: the same object').toBe(detached)
  })

  it('(g5) getSnapshot keeps one object until on, status, token or url changes; listeners run once per change, never after unsubscribe', async () => {
    const r = rig()
    let heard = 0
    const unsubscribe = r.session.subscribe(() => heard++)
    const first = r.session.getSnapshot()
    expect(r.session.getSnapshot(), '(g5) same object').toBe(first)
    r.session.attach()
    expect(r.session.getSnapshot(), '(g5) attach changed no field').toBe(first)
    expect(heard, '(g5) no change, no call').toBe(0)
    r.session.setOn(true)
    const on = r.session.getSnapshot()
    expect(on, '(g5) on changed').not.toBe(first)
    expect(on).toEqual({ on: true, status: 'idle', token: null, url: null })
    expect(heard, '(g5) one call for on').toBe(1)
    r.session.setOn(true)
    expect(r.session.getSnapshot(), '(g5) the same value keeps the object').toBe(on)
    expect(heard).toBe(1)
    r.session.playback('tap-to-listen', partAt(at(['start'])))
    const loading = r.session.getSnapshot()
    expect(loading).toEqual({
      on: true,
      status: 'loading',
      token: '0:0',
      url: clipUrl('start', 'en'),
    })
    expect(heard, '(g5) one call for status, token and url together').toBe(2)
    expect(r.session.getSnapshot(), '(g5) stable again').toBe(loading)
    unsubscribe()
    r.elements[0]?.loadMetadata(1)
    r.elements[0]?.receiveData(1)
    await r.settle()
    expect(r.status(), 'precondition: the status moved on').toBe('playing')
    expect(heard, '(g5) never after unsubscribe').toBe(2)
  })
})

describe('T11-5 a step with Read to me on plays the destination inside the tap (A5, N5, N7)', () => {
  it('(g1) CHOOSE, BACK and RESTART: advanceInGesture with the audio effect’s clip and the new token, once', () => {
    const cases: [string, StepResult][] = [
      ['choose', choose(at(['start']), 'c1')],
      ['back', back(at(['start', 'flat_stones']))],
      ['restart', restart(at(['start', 'flat_stones']))],
    ]
    for (const [name, result] of cases) {
      const r = rig()
      r.session.attach()
      r.session.setOn(true)
      const audio = audioOf(result)
      r.session.onStep(result)
      expect(r.calls, `(g1) ${name}`).toEqual([
        `advanceInGesture ${clipUrl(audio.nodeId, audio.locale)} ${tokenOf(result.state)}`,
      ])
    }
  })

  it('(g2) a destination without a clip (big_rock in hi): stop() only', () => {
    const r = rig()
    r.session.attach()
    r.session.setOn(true)
    const result = choose(at(['start', 'flat_stones'], 'hi'), 'c1')
    expect(audioOf(result), 'precondition').toEqual({ nodeId: 'big_rock', locale: 'hi' })
    r.session.onStep(result)
    expect(r.calls, '(g2)').toEqual(['stop'])
  })

  it('(g3) with Read to me off no step calls the controller', () => {
    const r = rig()
    r.session.attach()
    for (const result of [
      choose(at(['start']), 'c1'),
      back(at(['start', 'flat_stones'])),
      restart(at(['start'])),
      choose(at(['start', 'flat_stones'], 'hi'), 'c1'),
    ]) {
      audioOf(result)
      r.session.onStep(result)
    }
    expect(r.calls, '(g3)').toEqual([])
  })

  it('(g4) a result without an audio effect (SET_LOCALE) makes no call, on or off', () => {
    const result = switchTo(at(['start']), 'hi')
    expect(result.accepted && result.effects, 'precondition: persist only').toEqual([
      { type: 'persist' },
    ])
    for (const on of [true, false]) {
      const r = rig()
      r.session.attach()
      r.session.setOn(on)
      r.session.onStep(result)
      expect(r.calls, `(g4) on=${on}`).toEqual([])
    }
  })

  it('(g5) in tap-to-listen mode a step cues the clip (blocked, no element)', () => {
    const r = rig('tap-to-listen')
    r.session.attach()
    r.session.setOn(true)
    const result = choose(at(['start']), 'c1')
    audioOf(result)
    r.session.onStep(result)
    expect(r.session.getSnapshot(), '(g5) cued').toEqual({
      on: true,
      status: 'blocked',
      token: tokenOf(result.state),
      url: clipUrl('flat_stones', 'en'),
    })
    expect(r.elements, '(g5) nothing created or played').toHaveLength(0)
  })

  it('(g6) a choice into an ending (round_stones c1 → ending_wet) plays the ending’s clip', () => {
    const r = rig()
    r.session.attach()
    r.session.setOn(true)
    const result = choose(at(['start', 'round_stones']), 'c1')
    expect(audioOf(result), 'precondition: an ending').toEqual({
      nodeId: 'ending_wet',
      locale: 'en',
    })
    expect(result.state.status).toBe('ended')
    r.session.onStep(result)
    expect(r.calls, '(g6)').toEqual([
      `advanceInGesture ${clipUrl('ending_wet', 'en')} ${tokenOf(result.state)}`,
    ])
  })
})

describe('T11-6 the story-language switch (A6, N6)', () => {
  const switched = switchTo(at(['start', 'flat_stones']), 'hi')
  const part = partAt(switched.state)

  it('precondition: the part comes from narrationPartOf on a SET_LOCALE result', () => {
    expect(switched.accepted).toBe(true)
    expect(part).toEqual({ url: clipUrl('flat_stones', 'hi'), token: tokenOf(switched.state) })
  })

  it('(g1) with Read to me on: advanceInGesture with the new url and the same token', () => {
    const r = rig()
    r.session.attach()
    r.session.setOn(true)
    r.session.onSwitch(part)
    expect(r.calls, '(g1)').toEqual([`advanceInGesture ${part.url} ${part.token}`])
  })

  it('(g2) play-on-choice plays the new src; tap-to-listen cues it', () => {
    const playing = rig('play-on-choice')
    playing.session.attach()
    playing.session.toggle(partAt(at(['start', 'flat_stones'])))
    playing.fire()
    playing.session.onSwitch(part)
    expect(playing.status(), '(g2) plays').toBe('loading')
    expect(playing.elements[0]?.getAttribute('src'), '(g2) the new src').toBe(part.url)
    const cued = rig('tap-to-listen')
    cued.session.attach()
    cued.session.setOn(true)
    cued.session.onSwitch(part)
    expect(cued.session.getSnapshot(), '(g2) cues').toMatchObject({
      status: 'blocked',
      url: part.url,
    })
    expect(cued.elements, '(g2) nothing played').toHaveLength(0)
  })

  it('(g3) no clip in the new language: stop()', () => {
    const r = rig()
    r.session.attach()
    r.session.setOn(true)
    const noClip = partAt(switchTo(at(['start', 'flat_stones', 'big_rock']), 'hi').state)
    expect(noClip.url, 'precondition').toBeNull()
    r.session.onSwitch(noClip)
    expect(r.calls, '(g3)').toEqual(['stop'])
  })

  it('(g4) with Read to me off: no call', () => {
    const r = rig()
    r.session.attach()
    r.session.onSwitch(part)
    expect(r.calls, '(g4)').toEqual([])
  })

  it('(g5) a narration-button hold does not hold the switch', () => {
    const r = rig()
    r.session.attach()
    r.session.toggle(partAt(at(['start', 'flat_stones'])))
    expect(r.timers, 'precondition: the hold is armed').toHaveLength(1)
    r.calls.length = 0
    r.session.onSwitch(part)
    expect(r.calls, '(g5)').toEqual([`advanceInGesture ${part.url} ${part.token}`])
  })
})

describe('T11-7 Read to me and the playback actions (A8, A9, N9)', () => {
  it('(g1) off → on: true and playInGesture(url, token) once; with no clip: true and no call', () => {
    const r = rig()
    r.session.attach()
    const part = partAt(at(['start']))
    expect(r.session.toggle(part), '(g1) on').toBe(true)
    expect(r.calls, '(g1) play').toEqual([`playInGesture ${part.url} ${part.token}`])
    const none = rig()
    none.session.attach()
    const noClip = partAt(at(['start', 'flat_stones', 'big_rock'], 'hi'))
    expect(noClip.url, 'precondition').toBeNull()
    expect(none.session.toggle(noClip), '(g1) on with no clip').toBe(true)
    expect(none.calls, '(g1) no call').toEqual([])
  })

  it('(g2) on → off: false and stop() once, also at ended', async () => {
    const r = rig()
    r.session.attach()
    const part = partAt(at(['start']))
    r.session.toggle(part)
    r.fire()
    r.calls.length = 0
    expect(r.session.toggle(part), '(g2) off while loading').toBe(false)
    expect(r.calls, '(g2) stop').toEqual(['stop'])
    r.fire()
    r.session.toggle(part)
    r.fire()
    const element = r.elements[0]
    if (element === undefined) throw new Error('no element')
    element.loadMetadata(1)
    element.receiveData(1)
    await r.settle()
    element.finish()
    await r.settle()
    expect(r.status(), 'precondition: ended').toBe('ended')
    r.calls.length = 0
    expect(r.session.toggle(part), '(g2) off at ended').toBe(false)
    expect(r.calls, '(g2) stop at ended').toEqual(['stop'])
    expect(r.status()).toBe('idle')
  })

  it('(g3) Pause → pause(); Resume and Play again → resumeInGesture(); Tap to listen → playInGesture(part)', () => {
    const r = rig()
    r.session.attach()
    r.session.setOn(true)
    const part = partAt(at(['start', 'flat_stones']))
    const expected: Record<NarrationPlayback, string> = {
      pause: 'pause',
      resume: 'resumeInGesture',
      'play-again': 'resumeInGesture',
      'tap-to-listen': `playInGesture ${part.url} ${part.token}`,
    }
    for (const kind of NARRATION_PLAYBACKS) {
      r.calls.length = 0
      expect(r.session.playback(kind, part), `(g3) ${kind} applied`).toBe(true)
      expect(r.calls, `(g3) ${kind}`).toEqual([expected[kind]])
      r.fire()
    }
  })

  it('(g4) a playback tap while off: no call, false', () => {
    const r = rig()
    r.session.attach()
    for (const kind of NARRATION_PLAYBACKS) {
      expect(r.session.playback(kind, partAt(at(['start']))), `(g4) ${kind}`).toBe(false)
    }
    expect(r.calls, '(g4)').toEqual([])
    expect(r.timers, '(g4) no hold').toHaveLength(0)
  })
})

describe('T11-8 a second narration tap within 500 ms does nothing (A10, N17)', () => {
  const part = partAt(at(['start']))

  it('precondition: one 500 ms timer per applied tap', () => {
    const r = rig()
    r.session.attach()
    r.session.toggle(part)
    expect(r.timers.map((t) => t.ms)).toEqual([500])
    r.fire()
    r.session.playback('pause', part)
    expect(r.timers.map((t) => t.ms)).toEqual([500, 500])
  })

  it('(g1) inside the hold a toggle or playback is ignored: null or false, no call, no new timer', () => {
    const r = rig()
    r.session.attach()
    r.session.toggle(part)
    r.calls.length = 0
    expect(r.session.toggle(part), '(g1) toggle held').toBeNull()
    expect(r.session.playback('pause', part), '(g1) playback held').toBe(false)
    expect(r.calls, '(g1) no call').toEqual([])
    expect(r.timers, '(g1) no new timer').toHaveLength(1)
    expect(r.session.getSnapshot().on, '(g1) still on').toBe(true)
  })

  it('(g2) once the timer fires the next tap applies', () => {
    const r = rig()
    r.session.attach()
    r.session.toggle(part)
    r.fire()
    r.calls.length = 0
    expect(r.session.playback('pause', part), '(g2) applies').toBe(true)
    expect(r.calls, '(g2)').toEqual(['pause'])
  })

  it('(g3) the hold is shared: toggle then playback, playback then toggle', () => {
    const a = rig()
    a.session.attach()
    a.session.toggle(part)
    a.calls.length = 0
    expect(a.session.playback('pause', part), '(g3) playback after toggle').toBe(false)
    expect(a.calls).toEqual([])
    const b = rig()
    b.session.attach()
    b.session.setOn(true)
    b.session.playback('tap-to-listen', part)
    b.calls.length = 0
    expect(b.session.toggle(part), '(g3) toggle after playback').toBeNull()
    expect(b.calls).toEqual([])
  })

  it('(g4) the hold is a timer, not a clock: 10 s of system time later it still holds', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const r = rig()
    r.session.attach()
    r.session.toggle(part)
    vi.setSystemTime(Date.now() + 10_000)
    r.calls.length = 0
    expect(r.session.toggle(part), '(g4) still held').toBeNull()
    expect(r.calls, '(g4)').toEqual([])
  })

  it('(g5) a step and a switch are never held', () => {
    const r = rig()
    r.session.attach()
    r.session.toggle(part)
    r.calls.length = 0
    const result = choose(at(['start']), 'c1')
    r.session.onStep(result)
    const switched = partAt(switchTo(result.state, 'hi').state)
    r.session.onSwitch(switched)
    expect(r.calls, '(g5)').toEqual([
      `advanceInGesture ${clipUrl('flat_stones', 'en')} ${tokenOf(result.state)}`,
      `advanceInGesture ${switched.url} ${switched.token}`,
    ])
  })
})

/** A small seeded PRNG (mulberry32), so a failing sequence can be replayed from its seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const OPS = [
  'toggle',
  'pause',
  'resume',
  'play-again',
  'tap-to-listen',
  'step',
  'switch',
  'deliver',
  'fail',
  'finish',
  'starve',
  'stall',
  'refuse',
  'flush',
  'settle',
  'timer',
] as const

describe('T11-9 off means the controller is idle, after any sequence of taps (A11)', () => {
  it('300 seeded sequences of 40 operations, in both modes', async () => {
    const reached = new Set<NarrationStatus>()
    let ops = 0
    let onOps = 0
    for (let seed = 1; seed <= 300; seed++) {
      const random = prng(seed)
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
      const mode: NarrationMode = seed % 2 === 0 ? 'play-on-choice' : 'tap-to-listen'
      const r = rig(mode)
      const detach = r.session.attach()
      let state = at(['start'])
      const trail: string[] = []
      for (let i = 0; i < 40; i++) {
        const op = pick(OPS)
        trail.push(op)
        const element = r.elements[0]
        switch (op) {
          case 'toggle':
            r.session.toggle(partAt(state))
            break
          case 'pause':
          case 'resume':
          case 'play-again':
          case 'tap-to-listen':
            r.session.playback(op, partAt(state))
            break
          case 'step': {
            const node = DATA.nodes.find((n) => n.id === state.path[state.path.length - 1])
            const choices = node?.choices.map((c) => c.id) ?? []
            const events: EngineEvent[] = [
              ...choices.map((choiceId) => ({ type: 'CHOOSE' as const, seq: state.seq, choiceId })),
              { type: 'BACK', seq: state.seq },
              { type: 'RESTART', seq: state.seq },
            ]
            const result = send(state, pick(events))
            if (result.accepted) {
              state = result.state
              r.session.onStep(result)
            }
            break
          }
          case 'switch': {
            const result = switchTo(state, state.locale === 'en' ? 'hi' : 'en')
            state = result.state
            r.session.onStep(result)
            r.session.onSwitch(partAt(state))
            break
          }
          case 'deliver':
            if (element?.hasAttribute('src') === true) {
              element.loadMetadata(1)
              element.receiveData(1)
            }
            break
          case 'fail':
            element?.fail(pick([2, 3, MEDIA_ERR_SRC_NOT_SUPPORTED]))
            break
          case 'finish':
            element?.finish()
            break
          case 'starve':
            element?.starve()
            break
          case 'stall':
            element?.stall()
            break
          case 'refuse':
            if (element !== undefined) {
              element.playPolicy = element.playPolicy === 'blocked' ? 'allowed' : 'blocked'
            }
            break
          case 'flush':
            element?.flush()
            break
          case 'settle':
            await r.settle()
            break
          case 'timer':
            r.fire()
            break
        }
        // Checked right after the operation (loading is seen here: a settle moves it on) and again
        // after the fake element's queued tasks and promise callbacks have run.
        for (const moment of ['after the op', 'after a settle']) {
          if (moment === 'after a settle') await r.settle()
          const snapshot = r.session.getSnapshot()
          const controller = r.controllers[0]?.getSnapshot()
          reached.add(snapshot.status)
          ops++
          if (snapshot.on) onOps++
          if (!snapshot.on) {
            const where = `seed ${seed} (${mode}) ${moment}: ${trail.join(', ')}`
            expect(snapshot.status, where).toBe('idle')
            expect(controller?.status ?? 'idle', where).toBe('idle')
          }
        }
      }
      // Dispose clears the controller's buffering timer, so no real timer outlives the sequence.
      detach()
    }
    // Non-vacuous: Read to me was on for a fair share of the operations, every status was reached.
    expect(onOps / ops, 'share of operations with Read to me on').toBeGreaterThanOrEqual(0.3)
    expect([...reached].sort(), 'every status reached').toEqual([...NARRATION_STATUSES].sort())
  })
})

/**
 * Design §4.4, typed row by row ('any' is a wildcard). The idle-and-current row is the table's own
 * note: stop clears the token, so it maps to the "not current" row.
 */
type Any = 'any'
interface TableRow {
  readonly on: boolean | Any
  readonly clip: boolean | Any
  readonly current: boolean | Any
  readonly status: NarrationStatus | Any | readonly NarrationStatus[]
  readonly expected: Omit<NarrationDisplay, 'on'>
}
const TABLE_4_4: readonly TableRow[] = [
  {
    on: false,
    clip: 'any',
    current: 'any',
    status: 'any',
    expected: { status: 'idle', playback: null, pulse: false, message: null },
  },
  {
    on: true,
    clip: false,
    current: 'any',
    status: 'any',
    expected: { status: 'idle', playback: null, pulse: false, message: 'unavailable' },
  },
  {
    on: true,
    clip: true,
    current: false,
    status: 'any',
    expected: { status: 'idle', playback: 'tap-to-listen', pulse: false, message: null },
  },
  {
    on: true,
    clip: true,
    current: true,
    status: 'idle',
    expected: { status: 'idle', playback: 'tap-to-listen', pulse: false, message: null },
  },
  {
    on: true,
    clip: true,
    current: true,
    status: 'loading',
    expected: { status: 'loading', playback: 'pause', pulse: false, message: 'loading' },
  },
  {
    on: true,
    clip: true,
    current: true,
    status: 'buffering',
    expected: { status: 'buffering', playback: 'pause', pulse: false, message: 'loading' },
  },
  {
    on: true,
    clip: true,
    current: true,
    status: 'playing',
    expected: { status: 'playing', playback: 'pause', pulse: false, message: null },
  },
  {
    on: true,
    clip: true,
    current: true,
    status: 'paused',
    expected: { status: 'paused', playback: 'resume', pulse: false, message: null },
  },
  {
    on: true,
    clip: true,
    current: true,
    status: 'ended',
    expected: { status: 'ended', playback: 'play-again', pulse: false, message: null },
  },
  {
    on: true,
    clip: true,
    current: true,
    status: 'blocked',
    expected: { status: 'blocked', playback: 'tap-to-listen', pulse: true, message: null },
  },
  {
    on: true,
    clip: true,
    current: true,
    status: 'unavailable',
    expected: {
      status: 'unavailable',
      playback: 'tap-to-listen',
      pulse: false,
      message: 'unavailable',
    },
  },
]

const matches = <T>(cell: T | Any | readonly T[], value: T): boolean =>
  cell === 'any' || cell === value || (Array.isArray(cell) && cell.includes(value))

describe('T11-10 narrationDisplayOf is the 4.4 table (A12, N8, N10 to N12)', () => {
  const PART_TOKEN = '2:5'
  const PART_URL = clipUrl('far_bank', 'hi')
  const rows = (['play-on-choice', 'tap-to-listen'] as const).flatMap((mode) =>
    [true, false].flatMap((on) =>
      [true, false].flatMap((clip) =>
        [true, false].flatMap((current) =>
          NARRATION_STATUSES.map((status) => ({ mode, on, clip, current, status })),
        ),
      ),
    ),
  )

  it('precondition: 128 distinct rows, each matched by exactly one row of the table', () => {
    expect(new Set(rows.map((row) => JSON.stringify(row))).size).toBe(128)
    for (const row of rows) {
      const hits = TABLE_4_4.filter(
        (t) =>
          matches(t.on, row.on) &&
          matches(t.clip, row.clip) &&
          matches(t.current, row.current) &&
          matches(t.status, row.status),
      )
      expect(hits, JSON.stringify(row)).toHaveLength(1)
    }
  })

  it.each(rows)('%j', ({ on, clip, current, status }) => {
    const part: NarrationPart = { url: clip ? PART_URL : null, token: PART_TOKEN }
    // Not current: the token matches but the url does not (a switch), so a check of the token
    // alone would call it current.
    const snapshot: NarrationSessionSnapshot = {
      on,
      status,
      token: PART_TOKEN,
      url: current ? part.url : clipUrl('far_bank', 'en'),
    }
    const row = TABLE_4_4.find(
      (t) =>
        matches(t.on, on) &&
        matches(t.clip, clip) &&
        matches(t.current, current) &&
        matches(t.status, status),
    )
    expect(narrationDisplayOf(snapshot, part)).toEqual({ on, ...row?.expected })
  })

  it('a snapshot of another part (the token differs, the url matches) is not current', () => {
    for (const status of NARRATION_STATUSES) {
      const part: NarrationPart = { url: PART_URL, token: PART_TOKEN }
      const snapshot = { on: true, status, token: '2:4', url: PART_URL }
      expect(narrationDisplayOf(snapshot, part), status).toEqual({
        on: true,
        status: 'idle',
        playback: 'tap-to-listen',
        pulse: false,
        message: null,
      })
    }
  })
})

describe('T11-11 one mode switch: NARRATION_MODE (A21, N20)', () => {
  it('(g1) the default controller is made with NARRATION_MODE', () => {
    const made = vi.mocked(createNarrationController)
    made.mockClear()
    const session = createNarrationSession({ data: DATA })
    expect(made, 'nothing before attach').toHaveBeenCalledTimes(0)
    session.attach()()
    expect(made, 'precondition: the default path ran').toHaveBeenCalledTimes(1)
    expect(made.mock.calls[0]?.[0]?.mode, '(g1)').toBe(NARRATION_MODE)
  })

  it('(g2) NARRATION_MODE is play-on-choice', () => {
    expect(NARRATION_MODE).toBe('play-on-choice')
  })

  it('(g3) tap-to-listen: a step cues, the display pulses, a switch cues, Tap to listen plays', () => {
    const r = rig('tap-to-listen')
    r.session.attach()
    r.session.setOn(true)
    const result = choose(at(['start']), 'c1')
    r.session.onStep(result)
    const part = partAt(result.state)
    expect(r.status(), '(g3) a step cues').toBe('blocked')
    expect(narrationDisplayOf(r.session.getSnapshot(), part), '(g3) the cue pulses').toMatchObject({
      playback: 'tap-to-listen',
      pulse: true,
    })
    const switched = partAt(switchTo(result.state, 'hi').state)
    r.session.onSwitch(switched)
    expect(r.session.getSnapshot(), '(g3) a switch cues').toMatchObject({
      status: 'blocked',
      url: switched.url,
    })
    expect(r.elements, '(g3) nothing played yet').toHaveLength(0)
    expect(r.session.playback('tap-to-listen', switched), '(g3) Tap to listen').toBe(true)
    expect(r.status(), '(g3) plays').toBe('loading')
    expect(r.elements[0]?.getAttribute('src')).toBe(switched.url)
  })
})

describe('T11-12 the narration lookups (A1, A13, N12)', () => {
  it('(g1) narrationUrlOf: the url, or null (never another language’s)', () => {
    expect(narrationUrlOf(DATA, 'start', 'en')).toBe(clipUrl('start', 'en'))
    expect(narrationUrlOf(DATA, 'start', 'hi')).toBe(clipUrl('start', 'hi'))
    expect(narrationUrlOf(DATA, 'big_rock', 'en')).toBe(clipUrl('big_rock', 'en'))
    expect(narrationUrlOf(DATA, 'big_rock', 'hi'), '(g1) no hi clip').toBeNull()
    expect(narrationUrlOf(DATA, 'nowhere', 'en'), '(g1) no node').toBeNull()
  })

  it('(g2) narrationOfferedIn: true iff the language has a clip', () => {
    const englishClipsOnly = narratedData((_, locale) => locale === 'hi')
    expect(englishClipsOnly.nodes.every((n) => Object.keys(n.narration).join() === 'en')).toBe(true)
    expect(narrationOfferedIn(DATA, 'en'), '(g2) en').toBe(true)
    expect(narrationOfferedIn(DATA, 'hi'), '(g2) hi, 7 of 8').toBe(true)
    expect(narrationOfferedIn(englishClipsOnly, 'en'), '(g2) en only: en').toBe(true)
    expect(narrationOfferedIn(englishClipsOnly, 'hi'), '(g2) en only: hi').toBe(false)
    const none = narratedData(() => true)
    expect(narrationOfferedIn(none, 'en') || narrationOfferedIn(none, 'hi'), '(g2) none').toBe(
      false,
    )
  })

  it('(g3) narrationPartOf: the current node, the run’s language and tokenOf(state), for a resumed state too', () => {
    const resumed = at(['start', 'flat_stones'], 'hi')
    expect(narrationPartOf(DATA, resumed), '(g3) resumed').toEqual({
      url: clipUrl('flat_stones', 'hi'),
      token: '0:0',
    })
    const later = restart(choose(at(['start']), 'c1').state).state
    expect(narrationPartOf(DATA, later), '(g3) after a restart').toEqual({
      url: clipUrl('start', 'en'),
      token: '1:2',
    })
    expect(narrationPartOf(DATA, at(['start', 'flat_stones', 'big_rock'], 'hi')).url).toBeNull()
  })

  it('the Grown-ups section id the byline lands on (H-21)', () => {
    expect(HOW_STORIES_ARE_MADE_ID).toBe('how-stories-are-made')
  })
})

describe('T11-13 the unavailable message is announced once per run, 500 ms after it appeared, if still true (A17, N10)', () => {
  const base = { runEpoch: 0, announcedEpoch: null, shownFor: '0:1 en', shownNow: '0:1 en' }

  it('(g1) only for a message that appeared for this part and still shows', () => {
    expect(narrationAnnouncementOf(base), '(g1) still true').toBe(true)
    expect(
      narrationAnnouncementOf({ ...base, shownFor: null }),
      '(g1) nothing appeared 500 ms ago',
    ).toBe(false)
  })

  it('(g2) at most once per runEpoch', () => {
    expect(narrationAnnouncementOf({ ...base, announcedEpoch: 0 }), '(g2)').toBe(false)
  })

  it('(g3) again after a new runEpoch', () => {
    expect(
      narrationAnnouncementOf({
        ...base,
        runEpoch: 1,
        announcedEpoch: 0,
        shownFor: '1:3 en',
        shownNow: '1:3 en',
      }),
      '(g3)',
    ).toBe(true)
  })

  it('(g4) never when the part changed or the message went away', () => {
    expect(narrationAnnouncementOf({ ...base, shownNow: null }), '(g4) gone').toBe(false)
    expect(narrationAnnouncementOf({ ...base, shownNow: '0:2 en' }), '(g4) next part').toBe(false)
    expect(narrationAnnouncementOf({ ...base, shownNow: '0:1 hi' }), '(g4) switched').toBe(false)
  })
})
