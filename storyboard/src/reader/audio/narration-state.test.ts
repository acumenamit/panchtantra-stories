import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  INITIAL_NARRATION_STATE,
  MEDIA_ERR_ABORTED,
  NARRATION_STATUSES,
  clampSeekTarget,
  isActiveStatus,
  reduceNarration,
  type MediaReading,
  type NarrationAction,
  type NarrationState,
  type NarrationStatus,
} from './narration-state'

const URL_A = 'https://cdn.test/a.mp3'
const URL_B = 'https://cdn.test/b.mp3'

function reading(patch: Partial<MediaReading> = {}): MediaReading {
  return {
    src: URL_A,
    paused: false,
    ended: false,
    seeking: false,
    readyState: 4,
    networkState: 2,
    currentTime: 0,
    errorCode: null,
    ...patch,
  }
}

function run(actions: readonly NarrationAction[], from = INITIAL_NARRATION_STATE): NarrationState {
  return actions.reduce((state, action) => reduceNarration(state, action).state, from)
}

const playA: NarrationAction = { type: 'play', url: URL_A, token: '0:0' }

/** A request for clip A in a given status, with the generation the play command gave it. */
function stateIn(status: NarrationStatus, patch: Partial<NarrationState> = {}): NarrationState {
  return { ...run([playA]), status, ...patch }
}

function media(event: string, patch: Partial<MediaReading> = {}): NarrationAction {
  return { type: 'media', event, reading: reading(patch) }
}

describe('narration commands', () => {
  it('starts idle with generation 0', () => {
    expect(INITIAL_NARRATION_STATE).toMatchObject({ status: 'idle', generation: 0, url: null })
  })

  it('play loads the clip, records url and token, and bumps the generation', () => {
    const s = run([playA])
    expect(s).toMatchObject({ status: 'loading', url: URL_A, token: '0:0', generation: 1 })
  })

  it('pause, stop, resume and cue each bump the generation', () => {
    const s1 = run([playA, { type: 'pause' }])
    expect(s1).toMatchObject({ status: 'paused', generation: 2 })
    const s2 = run([{ type: 'resume' }], s1)
    expect(s2).toMatchObject({ status: 'loading', generation: 3 })
    const s3 = run([{ type: 'cue', url: URL_B, token: '0:1' }], s2)
    expect(s3).toMatchObject({ status: 'blocked', url: URL_B, token: '0:1', generation: 4 })
    const s4 = run([{ type: 'stop' }], s3)
    expect(s4).toMatchObject({ status: 'idle', url: null, token: null, generation: 5 })
  })

  it('pause outside playback keeps the status but still bumps the generation', () => {
    const s = run([{ type: 'pause' }])
    expect(s).toMatchObject({ status: 'idle', generation: 1 })
    expect(run([{ type: 'pause' }], stateIn('ended')).status).toBe('ended')
  })

  it('resume with nothing loaded is ignored', () => {
    const r = reduceNarration(INITIAL_NARRATION_STATE, { type: 'resume' })
    expect(r.accepted).toBe(false)
    expect(r.state).toBe(INITIAL_NARRATION_STATE)
  })
})

describe('play() outcomes and the generation counter', () => {
  it('AbortError from a superseded request is dropped', () => {
    const s = run([playA, { type: 'play', url: URL_B, token: '0:1' }])
    const r = reduceNarration(s, {
      type: 'playRejected',
      generation: 1,
      errorName: 'AbortError',
      reading: reading({ src: URL_B }),
    })
    expect(r.accepted).toBe(false)
    expect(r.state).toBe(s)
  })

  it('AbortError after pause or stop is dropped (never unavailable)', () => {
    for (const command of [{ type: 'pause' }, { type: 'stop' }] as const) {
      const s = run([playA, command])
      const r = reduceNarration(s, {
        type: 'playRejected',
        generation: 1,
        errorName: 'AbortError',
        reading: reading({ paused: true, src: command.type === 'stop' ? null : URL_A }),
      })
      expect(r.accepted).toBe(false)
      expect(r.state.status).toBe(command.type === 'stop' ? 'idle' : 'paused')
    }
  })

  it('AbortError on the current generation follows element.paused, never unavailable', () => {
    const s = run([playA])
    const paused = reduceNarration(s, {
      type: 'playRejected',
      generation: 1,
      errorName: 'AbortError',
      reading: reading({ paused: true }),
    })
    expect(paused.state.status).toBe('paused')
    const stillPlaying = reduceNarration(s, {
      type: 'playRejected',
      generation: 1,
      errorName: 'AbortError',
      reading: reading({ paused: false }),
    })
    expect(stillPlaying.state.status).toBe('loading')
  })

  it('an unknown rejection is not unavailable either', () => {
    const r = reduceNarration(run([playA]), {
      type: 'playRejected',
      generation: 1,
      errorName: 'UnknownError',
      reading: reading({ paused: true }),
    })
    expect(r.state.status).toBe('paused')
  })

  it('NotAllowedError on the current generation means blocked ("Tap to listen")', () => {
    const r = reduceNarration(run([playA]), {
      type: 'playRejected',
      generation: 1,
      errorName: 'NotAllowedError',
      reading: reading({ paused: true }),
    })
    expect(r.state.status).toBe('blocked')
  })

  it('NotSupportedError means unavailable only on the current generation', () => {
    const current = reduceNarration(run([playA]), {
      type: 'playRejected',
      generation: 1,
      errorName: 'NotSupportedError',
      reading: reading({ paused: true }),
    })
    expect(current.state.status).toBe('unavailable')
    const stale = reduceNarration(run([playA, { type: 'pause' }]), {
      type: 'playRejected',
      generation: 1,
      errorName: 'NotSupportedError',
      reading: reading({ paused: true }),
    })
    expect(stale.accepted).toBe(false)
    expect(stale.state.status).toBe('paused')
  })

  it('a resolved play() on the current generation means playing; a stale one is dropped', () => {
    const resolved = reduceNarration(run([playA]), {
      type: 'playResolved',
      generation: 1,
      reading: reading(),
    })
    expect(resolved.state.status).toBe('playing')
    const stale = reduceNarration(run([playA, { type: 'pause' }]), {
      type: 'playResolved',
      generation: 1,
      reading: reading({ paused: true }),
    })
    expect(stale.accepted).toBe(false)
  })
})

describe('media events', () => {
  it('error on the current source means unavailable', () => {
    expect(run([media('error', { errorCode: 4 })], stateIn('loading')).status).toBe('unavailable')
    expect(run([media('error', { errorCode: 2 })], stateIn('paused')).status).toBe('unavailable')
  })

  it('error from another source, an aborted fetch or a cleared error is not unavailable', () => {
    const other = reduceNarration(stateIn('playing'), media('error', { src: URL_B, errorCode: 4 }))
    expect(other.accepted).toBe(false)
    expect(other.state.status).toBe('playing')
    const aborted = run([media('error', { errorCode: MEDIA_ERR_ABORTED })], stateIn('loading'))
    expect(aborted.status).toBe('loading')
    expect(run([media('error', { errorCode: null })], stateIn('loading')).status).toBe('loading')
  })

  it('every event is ignored while idle (after stop)', () => {
    const s = run([playA, { type: 'stop' }])
    for (const event of ['error', 'playing', 'pause', 'ended', 'waiting']) {
      const r = reduceNarration(s, media(event, { src: null, errorCode: 4 }))
      expect(r.accepted).toBe(false)
      expect(r.state).toBe(s)
    }
  })

  it('events are ignored while a cued clip has no src yet', () => {
    const s = run([playA, { type: 'cue', url: URL_B, token: '0:1' }])
    const r = reduceNarration(s, media('playing', { src: null }))
    expect(r.accepted).toBe(false)
    expect(r.state.status).toBe('blocked')
  })

  it('waiting starts buffering while playing or loading, not while paused', () => {
    expect(run([media('waiting')], stateIn('playing')).status).toBe('buffering')
    expect(run([media('waiting', { readyState: 0 })], stateIn('loading')).status).toBe('buffering')
    expect(run([media('waiting', { paused: true })], stateIn('paused')).status).toBe('paused')
  })

  it('stalled means buffering only while readyState is below 3', () => {
    expect(run([media('stalled', { readyState: 2 })], stateIn('playing')).status).toBe('buffering')
    expect(run([media('stalled', { readyState: 3 })], stateIn('playing')).status).toBe('playing')
    expect(run([media('stalled', { readyState: 4 })], stateIn('loading')).status).toBe('loading')
  })

  it('entering buffering starts a new episode; staying in it does not', () => {
    const first = run([media('waiting')], stateIn('playing'))
    expect(first.bufferingEpisode).toBe(1)
    expect(run([media('waiting')], first).bufferingEpisode).toBe(1)
    const second = run([media('playing'), media('waiting')], first)
    expect(second.bufferingEpisode).toBe(2)
  })

  it('buffering ends on playing', () => {
    expect(run([media('playing')], stateIn('buffering')).status).toBe('playing')
  })

  it('buffering ends on timeupdate only when the time moves forward without a seek', () => {
    const s = stateIn('buffering', { lastTime: 10 })
    expect(run([media('timeupdate', { currentTime: 10.3 })], s).status).toBe('playing')
    expect(run([media('timeupdate', { currentTime: 10 })], s).status).toBe('buffering')
    expect(run([media('timeupdate', { currentTime: 40, seeking: true })], s).status).toBe(
      'buffering',
    )
    expect(run([media('timeupdate', { currentTime: 4 })], s).status).toBe('buffering')
  })

  it('buffering ends on canplay when not paused', () => {
    expect(run([media('canplay')], stateIn('buffering')).status).toBe('playing')
    expect(run([media('canplay', { paused: true })], stateIn('buffering')).status).toBe('buffering')
  })

  it('records currentTime of every accepted event', () => {
    expect(run([media('seeked', { currentTime: 150 })], stateIn('paused')).lastTime).toBe(150)
  })

  it('pause is read from element.paused: a late pause after a resume is ignored', () => {
    expect(run([media('pause', { paused: false })], stateIn('loading')).status).toBe('loading')
    expect(run([media('pause', { paused: true })], stateIn('playing')).status).toBe('paused')
  })

  it('a system pause at the very end means ended', () => {
    const s = run([media('pause', { paused: true, ended: true })], stateIn('playing'))
    expect(s.status).toBe('ended')
  })

  it('playing is read from element.paused: a late playing after a pause is ignored', () => {
    expect(run([media('playing', { paused: true })], stateIn('paused')).status).toBe('paused')
  })

  it('a system resume (play event while paused) shows loading, then playing', () => {
    const s = run([media('play'), media('playing')], stateIn('paused'))
    expect(s.status).toBe('playing')
    expect(run([media('play', { paused: true })], stateIn('paused')).status).toBe('paused')
  })

  it('ended needs element.ended', () => {
    expect(run([media('ended', { ended: true, paused: true })], stateIn('playing')).status).toBe(
      'ended',
    )
    expect(run([media('ended', { ended: false })], stateIn('playing')).status).toBe('playing')
  })

  it('events that do not affect status leave it alone', () => {
    for (const event of ['loadstart', 'progress', 'durationchange', 'emptied', 'abort']) {
      expect(run([media(event)], stateIn('playing')).status).toBe('playing')
    }
  })
})

describe('buffering timeout', () => {
  const buffering = run([media('waiting')], stateIn('playing'))

  it('leads to unavailable for the current generation and episode', () => {
    const r = reduceNarration(buffering, {
      type: 'bufferingTimeout',
      generation: buffering.generation,
      episode: buffering.bufferingEpisode,
    })
    expect(r.state.status).toBe('unavailable')
  })

  it('is dropped for an earlier episode, an earlier generation, or when no longer buffering', () => {
    const earlierEpisode = { generation: buffering.generation, episode: 0 }
    const earlierGeneration = { generation: 0, episode: buffering.bufferingEpisode }
    for (const t of [earlierEpisode, earlierGeneration]) {
      const r = reduceNarration(buffering, { type: 'bufferingTimeout', ...t })
      expect(r.accepted).toBe(false)
      expect(r.state).toBe(buffering)
    }
    const playing = run([media('playing')], buffering)
    const late = reduceNarration(playing, {
      type: 'bufferingTimeout',
      generation: playing.generation,
      episode: playing.bufferingEpisode,
    })
    expect(late.state.status).toBe('playing')
  })
})

describe('resync (visibilitychange, pageshow)', () => {
  function resync(state: NarrationState, patch: Partial<MediaReading>): NarrationState {
    return run([{ type: 'resync', reading: reading(patch) }], state)
  }

  it('shows paused when the system paused playback while the page was hidden', () => {
    expect(resync(stateIn('playing'), { paused: true, currentTime: 61 }).status).toBe('paused')
  })

  it('shows playing (or buffering) when the system resumed playback', () => {
    expect(resync(stateIn('paused'), { paused: false, readyState: 4 }).status).toBe('playing')
    expect(resync(stateIn('paused'), { paused: false, readyState: 2 }).status).toBe('buffering')
  })

  it('shows ended when the clip finished while hidden', () => {
    expect(resync(stateIn('playing'), { paused: true, ended: true }).status).toBe('ended')
  })

  it('keeps blocked and unavailable when the element is paused', () => {
    expect(resync(stateIn('blocked'), { paused: true }).status).toBe('blocked')
    expect(resync(stateIn('unavailable'), { paused: true, errorCode: 4 }).status).toBe(
      'unavailable',
    )
  })

  it('is ignored while idle or for another source', () => {
    const idle = reduceNarration(INITIAL_NARRATION_STATE, { type: 'resync', reading: reading() })
    expect(idle.accepted).toBe(false)
    const other = reduceNarration(stateIn('playing'), {
      type: 'resync',
      reading: reading({ src: URL_B, paused: true }),
    })
    expect(other.accepted).toBe(false)
  })
})

describe('narration properties (fixed seed)', () => {
  const arbReading = fc.record({
    src: fc.constantFrom(URL_A, URL_B, null),
    paused: fc.boolean(),
    ended: fc.boolean(),
    seeking: fc.boolean(),
    readyState: fc.integer({ min: 0, max: 4 }),
    networkState: fc.integer({ min: 0, max: 3 }),
    currentTime: fc.integer({ min: 0, max: 200 }),
    errorCode: fc.constantFrom(null, MEDIA_ERR_ABORTED),
  })
  const safeEvent = fc.constantFrom(
    'waiting',
    'stalled',
    'playing',
    'canplay',
    'timeupdate',
    'play',
    'pause',
    'ended',
    'emptied',
    'abort',
    'seeking',
    'seeked',
    'error',
  )
  const safeAction: fc.Arbitrary<NarrationAction> = fc.oneof(
    fc.record({
      type: fc.constant('play' as const),
      url: fc.constantFrom(URL_A, URL_B),
      token: fc.constantFrom('0:0', '0:1'),
    }),
    fc.record({
      type: fc.constant('cue' as const),
      url: fc.constantFrom(URL_A, URL_B),
      token: fc.constant('1:0'),
    }),
    fc.constantFrom<NarrationAction>({ type: 'resume' }, { type: 'pause' }, { type: 'stop' }),
    fc.record({
      type: fc.constant('playRejected' as const),
      generation: fc.integer({ min: 0, max: 30 }),
      errorName: fc.constantFrom('AbortError', 'NotAllowedError', 'UnknownError'),
      reading: arbReading,
    }),
    fc.record({
      type: fc.constant('playResolved' as const),
      generation: fc.integer({ min: 0, max: 30 }),
      reading: arbReading,
    }),
    fc.record({ type: fc.constant('media' as const), event: safeEvent, reading: arbReading }),
    fc.record({ type: fc.constant('resync' as const), reading: arbReading }),
  )

  it('without a media error, NotSupportedError or timeout, the status is never unavailable', () => {
    fc.assert(
      fc.property(fc.array(safeAction, { maxLength: 40 }), (actions) => {
        let state = INITIAL_NARRATION_STATE
        for (const action of actions) {
          state = reduceNarration(state, action).state
          expect(state.status).not.toBe('unavailable')
        }
      }),
      { seed: 20261107, numRuns: 400 },
    )
  })

  it('never throws, always returns a known status, and ignored actions keep the same state', () => {
    fc.assert(
      fc.property(fc.array(safeAction, { maxLength: 40 }), (actions) => {
        let state = INITIAL_NARRATION_STATE
        for (const action of actions) {
          const r = reduceNarration(state, action)
          expect(NARRATION_STATUSES).toContain(r.state.status)
          if (!r.accepted) expect(r.state).toBe(state)
          state = r.state
        }
      }),
      { seed: 20261107, numRuns: 400 },
    )
  })

  it('stop always ends in idle with nothing loaded', () => {
    fc.assert(
      fc.property(fc.array(safeAction, { maxLength: 20 }), (actions) => {
        const s = run([...actions, { type: 'stop' }])
        expect(s).toMatchObject({ status: 'idle', url: null, token: null })
      }),
      { seed: 20261107, numRuns: 200 },
    )
  })
})

describe('helpers', () => {
  it('isActiveStatus is true only for loading, playing and buffering', () => {
    const active = NARRATION_STATUSES.filter(isActiveStatus)
    expect(active).toEqual(['loading', 'playing', 'buffering'])
  })

  it('clampSeekTarget clamps to 0 and the known duration', () => {
    expect(clampSeekTarget(-10, 182.7)).toBe(0)
    expect(clampSeekTarget(90, 182.7)).toBe(90)
    expect(clampSeekTarget(500, 182.7)).toBe(182.7)
  })

  it('clampSeekTarget keeps the request when the duration is not known yet', () => {
    expect(clampSeekTarget(164.5, Number.NaN)).toBe(164.5)
    expect(clampSeekTarget(-1, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('clampSeekTarget refuses a non-finite request', () => {
    expect(clampSeekTarget(Number.NaN, 100)).toBeNull()
    expect(clampSeekTarget(Number.POSITIVE_INFINITY, 100)).toBeNull()
  })
})
