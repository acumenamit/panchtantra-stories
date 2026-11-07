import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_BUFFERING_TIMEOUT_MS,
  MEDIA_EVENTS,
  createNarrationController,
  errorNameOf,
  mustReloadSource,
  readMedia,
  toRanges,
  type NarrationControllerOptions,
  type NarrationDiagnostic,
} from './narration-controller'
import type { NarrationStatus } from './narration-state'
import {
  FakeMediaElement,
  FakeTimeRanges,
  HAVE_CURRENT_DATA,
  MEDIA_ERR_ABORTED,
  MEDIA_ERR_NETWORK,
} from './testing/fake-media-element'

const CLIP_A = 'https://cdn.test/content/spikes/audio/a.mp3'
const CLIP_B = 'https://cdn.test/content/spikes/audio/b.mp3'
const CLIP_C = 'https://cdn.test/content/spikes/audio/c.mp3'

class FakeDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible'
}

function setup(options: NarrationControllerOptions = {}) {
  const elements: FakeMediaElement[] = []
  const diagnostics: NarrationDiagnostic[] = []
  const doc = new FakeDocument()
  const win = new EventTarget()
  const controller = createNarrationController({
    createElement: () => {
      const element = new FakeMediaElement()
      elements.push(element)
      return element
    },
    lifecycle: { document: doc, window: win },
    onDiagnostic: (entry) => diagnostics.push(entry),
    now: () => 0,
    ...options,
  })
  const el = (): FakeMediaElement => {
    const element = elements[0]
    if (element === undefined) throw new Error('no element was created')
    return element
  }
  const status = (): NarrationStatus => controller.getSnapshot().status
  const statuses = (): NarrationStatus[] => diagnostics.map((d) => d.status)
  return { controller, elements, el, diagnostics, doc, win, status, statuses }
}

/** The clip's data arrives: metadata, then enough data to play through. */
async function deliver(el: FakeMediaElement, duration = 182.7, bufferedEnd = 30): Promise<void> {
  el.loadMetadata(duration)
  el.receiveData(bufferedEnd)
  await el.settle()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the audio element', () => {
  it('is not created and no listener is attached before the first tap', () => {
    const t = setup()
    t.doc.dispatchEvent(new Event('visibilitychange'))
    expect(t.elements).toHaveLength(0)
    expect(t.controller.getPlayback()).toBeNull()
    expect(t.controller.getSnapshot()).toEqual({
      status: 'idle',
      token: null,
      url: null,
      mode: 'play-on-choice',
    })
    expect(t.diagnostics).toHaveLength(0)
  })

  it('is created in the first tap with preload none and no crossorigin attribute', () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    expect(t.elements).toHaveLength(1)
    expect(t.el().preload).toBe('none')
    expect(t.el().hasAttribute('crossorigin')).toBe(false)
  })

  it('removes a crossorigin attribute a custom factory may have set', () => {
    const element = new FakeMediaElement()
    element.setAttribute('crossorigin', 'anonymous')
    const controller = createNarrationController({ createElement: () => element, lifecycle: null })
    controller.playInGesture(CLIP_A, '0:0')
    expect(element.hasAttribute('crossorigin')).toBe(false)
    controller.dispose()
  })

  it('sets src and calls play() synchronously inside the tap, with no load()', () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    // Checked before any await: both calls happened inside the handler.
    expect(t.el().calls).toEqual([`set src=${CLIP_A}`, 'play'])
    expect(t.status()).toBe('loading')
  })

  it('is reused for every clip (one element, never two clips at once)', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    t.controller.playInGesture(CLIP_B, '0:1')
    t.controller.playInGesture(CLIP_C, '0:2')
    await t.el().settle()
    expect(t.elements).toHaveLength(1)
    expect(t.el().getAttribute('src')).toBe(CLIP_C)
  })

  it('works without document or window (no lifecycle) when created outside a browser', async () => {
    const elements: FakeMediaElement[] = []
    const controller = createNarrationController({
      createElement: () => {
        const element = new FakeMediaElement()
        elements.push(element)
        return element
      },
    })
    controller.playInGesture(CLIP_A, '0:0')
    const el = elements[0]
    if (el === undefined) throw new Error('no element')
    await deliver(el)
    expect(controller.getSnapshot().status).toBe('playing')
    controller.dispose()
  })
})

describe('playback', () => {
  it('goes loading, buffering, playing on a cold clip, and play() resolves', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    await t.el().settle()
    expect(t.status()).toBe('buffering')
    await deliver(t.el())
    expect(t.status()).toBe('playing')
    const result = t.diagnostics.find((d) => d.kind === 'play-result')
    expect(result).toMatchObject({ outcome: 'resolved', accepted: true, forGeneration: 1 })
  })

  it('a choice while a clip plays stops it at once and starts the next one (T2a)', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    t.controller.playInGesture(CLIP_C, '0:1')
    expect(t.el().getAttribute('src')).toBe(CLIP_C)
    expect(t.controller.getSnapshot()).toMatchObject({ status: 'loading', token: '0:1' })
    await deliver(t.el())
    expect(t.status()).toBe('playing')
    expect(t.statuses()).not.toContain('unavailable')
  })

  it('three fast taps: only the last clip plays and nothing says unavailable (T2c)', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    t.controller.playInGesture(CLIP_B, '0:1')
    t.controller.playInGesture(CLIP_C, '0:2')
    await deliver(t.el())
    expect(t.controller.getSnapshot()).toMatchObject({ status: 'playing', url: CLIP_C })
    const rejected = t.diagnostics.filter((d) => d.kind === 'play-result' && !d.accepted)
    expect(rejected).toHaveLength(2)
    expect(rejected.every((d) => d.kind === 'play-result' && d.errorName === 'AbortError')).toBe(
      true,
    )
    expect(t.statuses()).not.toContain('unavailable')
  })

  it('pause right after Read to me on a cold clip ends paused, never unavailable (T9)', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_C, '0:0')
    t.controller.pause()
    await t.el().settle()
    await deliver(t.el())
    expect(t.status()).toBe('paused')
    expect(t.statuses()).not.toContain('unavailable')
  })

  it('stop during loading ends idle and stops the download (T9)', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_C, '0:0')
    t.controller.stop()
    expect(t.el().calls.slice(-3)).toEqual(['pause', 'remove src', 'load'])
    await t.el().settle()
    expect(t.controller.getSnapshot()).toMatchObject({ status: 'idle', url: null, token: null })
    expect(t.statuses()).not.toContain('unavailable')
  })

  it('a double tap on Read to me does not restart the clip (T9)', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    t.controller.playInGesture(CLIP_A, '0:0')
    expect(t.el().calls.filter((c) => c === 'play')).toHaveLength(1)
    expect(t.status()).toBe('playing')
    const noOps = t.diagnostics.filter((d) => d.kind === 'command' && !d.applied)
    expect(noOps).toHaveLength(2)
  })

  it('the same clip with a new token (Restart) starts again from the beginning', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    t.el().advanceTime(20)
    await t.el().settle()
    t.controller.playInGesture(CLIP_A, '1:3')
    expect(t.el().currentTime).toBe(0)
    expect(t.controller.getSnapshot()).toMatchObject({ status: 'loading', token: '1:3' })
  })

  it('a clip that plays to the end ends; resume plays it again without a reload', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    t.el().finish()
    await t.el().settle()
    expect(t.status()).toBe('ended')
    expect(t.controller.resumeInGesture()).toBe(true)
    expect(t.el().calls.slice(-1)).toEqual(['play'])
    await t.el().settle()
    expect(t.status()).toBe('playing')
  })
})

describe('refused and failed playback', () => {
  it('NotAllowedError means blocked; one tap on "Tap to listen" plays (T6a)', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    t.el().playPolicy = 'blocked'
    t.controller.playInGesture(CLIP_A, '0:1')
    await t.el().settle()
    expect(t.status()).toBe('blocked')
    t.el().playPolicy = 'allowed'
    expect(t.controller.resumeInGesture()).toBe(true)
    await deliver(t.el())
    expect(t.status()).toBe('playing')
  })

  it('a missing clip says unavailable and the next clip still plays (T7)', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    t.el().fail()
    await t.el().settle()
    expect(t.status()).toBe('unavailable')
    t.controller.playInGesture(CLIP_B, '0:1')
    await deliver(t.el())
    expect(t.controller.getSnapshot()).toMatchObject({ status: 'playing', url: CLIP_B })
  })

  it('resume after a failure loads the source again', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    t.el().fail(MEDIA_ERR_NETWORK)
    await t.el().settle()
    expect(t.status()).toBe('unavailable')
    t.controller.resumeInGesture()
    expect(t.el().calls.slice(-2)).toEqual([`set src=${CLIP_A}`, 'play'])
    await deliver(t.el())
    expect(t.status()).toBe('playing')
  })

  it('resume after a NotSupportedError loads the source again, even with no element error', async () => {
    /** Refuses its next play() the way a browser refuses an unsupported source. */
    class RefusingElement extends FakeMediaElement {
      refuseNext = true
      override play(): Promise<void> {
        if (!this.refuseNext) return super.play()
        this.refuseNext = false
        this.calls.push('play')
        return Promise.reject(new DOMException('unsupported', 'NotSupportedError'))
      }
    }
    const element = new RefusingElement()
    const t = setup({ createElement: () => element })
    t.controller.playInGesture(CLIP_A, '0:0')
    await element.settle()
    expect(t.status()).toBe('unavailable')
    expect(element.error).toBeNull()
    t.controller.resumeInGesture()
    expect(element.calls.slice(-2)).toEqual([`set src=${CLIP_A}`, 'play'])
    await deliver(element)
    expect(t.status()).toBe('playing')
  })

  it('an error after stop is not unavailable', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    t.controller.stop()
    t.el().fail()
    await t.el().settle()
    expect(t.status()).toBe('idle')
  })
})

describe('buffering', () => {
  async function playingClip() {
    vi.useFakeTimers()
    const t = setup()
    t.controller.playInGesture(CLIP_C, '0:0')
    await deliver(t.el())
    return t
  }

  it('a stall while playing with data in hand is not buffering', async () => {
    const t = await playingClip()
    t.el().stall()
    await t.el().settle()
    expect(t.status()).toBe('playing')
  })

  it('waiting shows buffering; the timeout then says unavailable', async () => {
    const t = await playingClip()
    t.el().starve()
    await t.el().settle()
    expect(t.status()).toBe('buffering')
    vi.advanceTimersByTime(DEFAULT_BUFFERING_TIMEOUT_MS - 1)
    expect(t.status()).toBe('buffering')
    vi.advanceTimersByTime(1)
    expect(t.status()).toBe('unavailable')
    expect(t.diagnostics.at(-1)).toMatchObject({ kind: 'buffering-timeout', accepted: true })
  })

  it('data arriving in time ends buffering and cancels the timeout', async () => {
    const t = await playingClip()
    t.el().starve()
    await t.el().settle()
    t.el().receiveData(60)
    await t.el().settle()
    expect(t.status()).toBe('playing')
    vi.advanceTimersByTime(DEFAULT_BUFFERING_TIMEOUT_MS * 3)
    expect(t.status()).toBe('playing')
  })

  it('a stall with too little data is buffering', async () => {
    const t = await playingClip()
    t.el().receiveData(31, HAVE_CURRENT_DATA)
    t.el().stall()
    await t.el().settle()
    expect(t.status()).toBe('buffering')
  })

  it('time spent with the page hidden does not count; the clock restarts on return', async () => {
    const t = await playingClip()
    t.el().starve()
    await t.el().settle()
    t.doc.visibilityState = 'hidden'
    t.doc.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(DEFAULT_BUFFERING_TIMEOUT_MS * 2)
    expect(t.status()).toBe('buffering')
    t.doc.visibilityState = 'visible'
    t.doc.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(DEFAULT_BUFFERING_TIMEOUT_MS - 1)
    expect(t.status()).toBe('buffering')
    vi.advanceTimersByTime(1)
    expect(t.status()).toBe('unavailable')
  })

  it('resume after a buffering timeout keeps the source and the position (S-2: within ±3 s)', async () => {
    const t = await playingClip()
    t.el().advanceTime(150)
    await t.el().settle()
    t.el().starve()
    await t.el().settle()
    vi.advanceTimersByTime(DEFAULT_BUFFERING_TIMEOUT_MS)
    expect(t.status()).toBe('unavailable')
    expect(t.el().error).toBeNull()
    const callsBefore = t.el().calls.length

    expect(t.controller.resumeInGesture()).toBe(true)
    expect(t.el().calls.slice(callsBefore)).toEqual(['pause', 'play'])
    expect(t.el().currentTime).toBe(150)
    await t.el().settle()
    expect(t.status()).toBe('buffering') // the play steps ran again: a fresh "waiting"

    t.el().receiveData(170)
    await t.el().settle()
    expect(t.status()).toBe('playing')
    expect(t.el().currentTime).toBe(150)
  })

  it('a second stall after that resume times out again', async () => {
    const t = await playingClip()
    t.el().starve()
    await t.el().settle()
    vi.advanceTimersByTime(DEFAULT_BUFFERING_TIMEOUT_MS)
    t.controller.resumeInGesture()
    await t.el().settle()
    expect(t.status()).toBe('buffering')
    vi.advanceTimersByTime(DEFAULT_BUFFERING_TIMEOUT_MS)
    expect(t.status()).toBe('unavailable')
  })

  it('uses a custom timeout', async () => {
    vi.useFakeTimers()
    const t = setup({ bufferingTimeoutMs: 5000 })
    t.controller.playInGesture(CLIP_C, '0:0')
    await t.el().settle()
    expect(t.status()).toBe('buffering')
    vi.advanceTimersByTime(5000)
    expect(t.status()).toBe('unavailable')
  })
})

describe('interruptions and lifecycle', () => {
  it('a call pauses audio while hidden; on return the page shows paused at once (T4)', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_C, '0:0')
    await deliver(t.el())
    t.el().advanceTime(60)
    await t.el().settle()
    t.el().interrupt() // the pause event is still queued: only the resync can see it
    t.doc.dispatchEvent(new Event('visibilitychange'))
    expect(t.status()).toBe('paused')
    expect(t.diagnostics.at(-1)).toMatchObject({
      kind: 'lifecycle',
      event: 'visibilitychange',
      accepted: true,
      from: 'playing',
      status: 'paused',
    })
    expect(t.controller.resumeInGesture()).toBe(true)
    expect(t.el().calls.slice(-1)).toEqual(['play']) // same source, same position
    await t.el().settle()
    expect(t.status()).toBe('playing')
    expect(t.el().currentTime).toBe(60)
  })

  it('pageshow resyncs and records whether the page came from the back-forward cache', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    t.el().interrupt()
    t.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(t.status()).toBe('paused')
    expect(t.diagnostics.at(-1)).toMatchObject({
      kind: 'lifecycle',
      event: 'pageshow',
      persisted: true,
    })
  })

  it('a system resume (lock screen play) shows playing', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    t.el().interrupt()
    await t.el().settle()
    expect(t.status()).toBe('paused')
    t.el().resumeFromSystem()
    await t.el().settle()
    expect(t.status()).toBe('playing')
  })

  it('resync() can be called directly', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    t.el().interrupt()
    t.controller.resync()
    expect(t.status()).toBe('paused')
    expect(t.diagnostics.at(-1)).toMatchObject({ kind: 'command', command: 'resync' })
  })
})

describe('seeking', () => {
  it('seekTo clamps to 0 and the duration; seekBy moves from the current position', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_C, '0:0')
    await deliver(t.el())
    expect(t.controller.seekTo(500)).toBe(true)
    expect(t.el().currentTime).toBe(182.7)
    t.controller.seekTo(-5)
    expect(t.el().currentTime).toBe(0)
    t.controller.seekTo(150)
    t.controller.seekBy(-10)
    expect(t.el().currentTime).toBe(140)
  })

  it('records buffered and seekable before the jump', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_C, '0:0')
    await deliver(t.el(), 182.7, 30)
    t.controller.seekTo(164.5)
    expect(t.diagnostics.at(-1)).toMatchObject({
      kind: 'seek',
      requested: 164.5,
      target: 164.5,
      duration: 182.7,
      buffered: [[0, 30]],
      seekable: [[0, 182.7]],
    })
  })

  it('a jump right after the play tap, before metadata, keeps the target (play + jump now)', () => {
    const t = setup()
    t.controller.playInGesture(CLIP_C, '0:0')
    expect(t.controller.seekTo(164.5)).toBe(true)
    expect(t.el().currentTime).toBe(164.5)
  })

  it('refuses before the first tap, after stop, and for a non-finite target', async () => {
    const t = setup()
    expect(t.controller.seekTo(10)).toBe(false)
    expect(t.controller.seekBy(10)).toBe(false)
    t.controller.playInGesture(CLIP_C, '0:0')
    await deliver(t.el())
    expect(t.controller.seekTo(Number.NaN)).toBe(false)
    t.controller.stop()
    expect(t.controller.seekTo(10)).toBe(false)
  })

  it('pause, jump, resume plays from the new position (T3c)', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_C, '0:0')
    await deliver(t.el())
    t.controller.pause()
    t.controller.seekTo(60)
    await t.el().settle()
    expect(t.status()).toBe('paused')
    t.controller.resumeInGesture()
    await t.el().settle()
    expect(t.status()).toBe('playing')
    expect(t.el().currentTime).toBe(60)
  })
})

describe('mode switch', () => {
  it('play-on-choice: a choice plays the next clip', async () => {
    const t = setup()
    t.controller.advanceInGesture(CLIP_B, '0:1')
    expect(t.el().calls).toEqual([`set src=${CLIP_B}`, 'play'])
    await deliver(t.el())
    expect(t.status()).toBe('playing')
  })

  it('tap-to-listen: a choice starts no audio and shows "Tap to listen"; one tap plays (T6b)', async () => {
    const t = setup({ mode: 'tap-to-listen' })
    t.controller.advanceInGesture(CLIP_B, '0:1')
    expect(t.elements).toHaveLength(0)
    expect(t.controller.getSnapshot()).toEqual({
      status: 'blocked',
      token: '0:1',
      url: CLIP_B,
      mode: 'tap-to-listen',
    })
    expect(t.controller.resumeInGesture()).toBe(true)
    expect(t.el().calls).toEqual([`set src=${CLIP_B}`, 'play'])
    await deliver(t.el())
    expect(t.status()).toBe('playing')
  })

  it('tap-to-listen: a choice while a clip plays stops it and cues the next one', async () => {
    const t = setup({ mode: 'tap-to-listen' })
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    t.controller.advanceInGesture(CLIP_B, '0:1')
    expect(t.el().calls.slice(-3)).toEqual(['pause', 'remove src', 'load'])
    await t.el().settle()
    expect(t.controller.getSnapshot()).toMatchObject({ status: 'blocked', url: CLIP_B })
  })

  it('setMode switches the mode and notifies subscribers', () => {
    const t = setup()
    const listener = vi.fn()
    t.controller.subscribe(listener)
    t.controller.setMode('tap-to-listen')
    expect(t.controller.getSnapshot().mode).toBe('tap-to-listen')
    expect(listener).toHaveBeenCalledTimes(1)
    t.controller.setMode('tap-to-listen')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('snapshot and subscribe (useSyncExternalStore)', () => {
  it('keeps the same snapshot object while nothing visible changes', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    const before = t.controller.getSnapshot()
    t.el().advanceTime(1)
    t.el().advanceTime(1)
    await t.el().settle()
    expect(t.controller.getSnapshot()).toBe(before)
  })

  it('notifies on every status change until unsubscribed', async () => {
    const t = setup()
    const seen: NarrationStatus[] = []
    const unsubscribe = t.controller.subscribe(() => seen.push(t.controller.getSnapshot().status))
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    expect(seen).toEqual(['loading', 'buffering', 'playing'])
    unsubscribe()
    t.controller.pause()
    expect(seen).toHaveLength(3)
  })

  it('getPlayback reads the element live', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_C, '0:0')
    await deliver(t.el(), 182.7, 30)
    expect(t.controller.getPlayback()).toMatchObject({
      currentTime: 0,
      duration: 182.7,
      paused: false,
      readyState: 4,
      errorCode: null,
      buffered: [[0, 30]],
      seekable: [[0, 182.7]],
    })
  })
})

describe('diagnostics', () => {
  it('does nothing by default', async () => {
    const t = setup({ onDiagnostic: undefined })
    t.controller.playInGesture(CLIP_A, '0:0')
    await deliver(t.el())
    expect(t.status()).toBe('playing')
  })

  it('logs each media event with the element state and whether it was accepted', async () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    t.controller.stop()
    t.el().fail()
    await t.el().settle()
    const error = t.diagnostics.find((d) => d.kind === 'media' && d.event === 'error')
    expect(error).toMatchObject({
      kind: 'media',
      accepted: false,
      reading: { src: null, errorCode: 4, readyState: 0, networkState: 3 },
    })
  })

  it('logs commands in order with the generation they produced', () => {
    const t = setup()
    t.controller.playInGesture(CLIP_A, '0:0')
    t.controller.pause()
    t.controller.stop()
    const commands = t.diagnostics.filter((d) => d.kind === 'command')
    expect(commands.map((d) => [d.kind === 'command' && d.command, d.generation])).toEqual([
      ['play', 1],
      ['pause', 2],
      ['stop', 3],
    ])
  })

  it('stamps entries with the injected clock', () => {
    let clock = 1000
    const t = setup({ now: () => clock })
    t.controller.playInGesture(CLIP_A, '0:0')
    clock = 1250
    t.controller.pause()
    expect(t.diagnostics.map((d) => d.at)).toEqual([1000, 1250])
  })
})

describe('dispose', () => {
  it('stops, detaches every listener and ignores later calls', async () => {
    vi.useFakeTimers()
    const t = setup()
    const listener = vi.fn()
    t.controller.subscribe(listener)
    t.controller.playInGesture(CLIP_A, '0:0')
    await t.el().settle()
    expect(t.status()).toBe('buffering')
    t.controller.dispose()
    expect(t.status()).toBe('idle')
    expect(t.el().calls.slice(-3)).toEqual(['pause', 'remove src', 'load'])
    const calls = listener.mock.calls.length
    const logged = t.diagnostics.length

    vi.advanceTimersByTime(DEFAULT_BUFFERING_TIMEOUT_MS * 2)
    t.el().dispatchEvent(new Event('playing'))
    t.doc.dispatchEvent(new Event('visibilitychange'))
    t.controller.playInGesture(CLIP_B, '0:1')
    t.controller.advanceInGesture(CLIP_B, '0:1')
    t.controller.pause()
    t.controller.stop()
    t.controller.resync()
    t.controller.setMode('tap-to-listen')
    t.controller.dispose()
    expect(t.controller.resumeInGesture()).toBe(false)
    expect(t.controller.seekTo(1)).toBe(false)
    expect(t.controller.getPlayback()).toBeNull()

    expect(t.elements).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(calls)
    expect(t.diagnostics).toHaveLength(logged)
    expect(t.status()).toBe('idle')
  })
})

describe('helpers', () => {
  it('readMedia reads src as set, the flags, and the error code', () => {
    const el = new FakeMediaElement()
    el.setAttribute('src', CLIP_A)
    el.fail()
    expect(readMedia(el)).toEqual({
      src: CLIP_A,
      paused: true,
      ended: false,
      seeking: false,
      readyState: 0,
      networkState: 3,
      currentTime: 0,
      errorCode: 4,
    })
  })

  it('mustReloadSource reloads only a released, replaced or failed source', () => {
    const element = (src: string | null, errorCode: number | null) => ({
      getAttribute: (name: string) => (name === 'src' ? src : null),
      error: errorCode === null ? null : { code: errorCode },
    })
    expect(mustReloadSource(element(null, null), CLIP_A, false)).toBe(true)
    expect(mustReloadSource(element(CLIP_B, null), CLIP_A, false)).toBe(true)
    expect(mustReloadSource(element(CLIP_A, MEDIA_ERR_NETWORK), CLIP_A, false)).toBe(true)
    expect(mustReloadSource(element(CLIP_A, null), CLIP_A, true)).toBe(true)
    // Slow (buffering timeout) or aborted is not failed: keep the data and the position.
    expect(mustReloadSource(element(CLIP_A, null), CLIP_A, false)).toBe(false)
    expect(mustReloadSource(element(CLIP_A, MEDIA_ERR_ABORTED), CLIP_A, false)).toBe(false)
  })

  it('toRanges turns TimeRanges into pairs', () => {
    expect(
      toRanges(
        new FakeTimeRanges([
          [0, 30],
          [90, 120],
        ]),
      ),
    ).toEqual([
      [0, 30],
      [90, 120],
    ])
    expect(toRanges(new FakeTimeRanges())).toEqual([])
  })

  it('errorNameOf reads a DOMException or Error name, with a fallback', () => {
    expect(errorNameOf(new DOMException('x', 'NotAllowedError'))).toBe('NotAllowedError')
    expect(errorNameOf(new TypeError('x'))).toBe('TypeError')
    expect(errorNameOf('nope')).toBe('UnknownError')
    expect(errorNameOf(null)).toBe('UnknownError')
    expect(errorNameOf({ name: '' })).toBe('UnknownError')
  })

  it('listens to every media event the state machine reads', () => {
    for (const event of ['waiting', 'stalled', 'playing', 'canplay', 'timeupdate', 'pause']) {
      expect(MEDIA_EVENTS).toContain(event)
    }
    for (const event of ['play', 'ended', 'error']) expect(MEDIA_EVENTS).toContain(event)
  })
})
