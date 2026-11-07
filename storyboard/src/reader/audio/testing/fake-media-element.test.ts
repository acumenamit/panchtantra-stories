import { describe, expect, it } from 'vitest'
import {
  FakeMediaElement,
  FakeTimeRanges,
  HAVE_ENOUGH_DATA,
  HAVE_NOTHING,
  MEDIA_ERR_SRC_NOT_SUPPORTED,
  NETWORK_EMPTY,
  NETWORK_IDLE,
} from './fake-media-element'

function recordEvents(el: FakeMediaElement, types: readonly string[]): string[] {
  const seen: string[] = []
  for (const type of types) el.addEventListener(type, () => seen.push(type))
  return seen
}

/** Captures a play() outcome so no rejection is left unhandled. */
function outcome(promise: Promise<void>): { value: string } {
  const result = { value: 'pending' }
  promise.then(
    () => (result.value = 'resolved'),
    (error: DOMException) => (result.value = error.name),
  )
  return result
}

describe('FakeMediaElement', () => {
  it('with preload none, setting src fires loadstart and suspend and fetches nothing', async () => {
    const el = new FakeMediaElement()
    el.preload = 'none'
    const seen = recordEvents(el, ['loadstart', 'suspend'])
    el.setAttribute('src', 'a.mp3')
    expect(el.networkState).toBe(NETWORK_IDLE)
    await el.settle()
    expect(seen).toEqual(['loadstart', 'suspend'])
  })

  it('queues events until flush: nothing is dispatched synchronously', () => {
    const el = new FakeMediaElement()
    const seen = recordEvents(el, ['play', 'waiting'])
    el.setAttribute('src', 'a.mp3')
    void outcome(el.play())
    expect(el.paused).toBe(false)
    expect(seen).toEqual([])
    el.flush()
    expect(seen).toEqual(['play', 'waiting'])
  })

  it('resolves play() with playing once enough data arrives', async () => {
    const el = new FakeMediaElement()
    el.setAttribute('src', 'a.mp3')
    const played = outcome(el.play())
    el.loadMetadata(10)
    el.receiveData(10)
    await el.settle()
    expect(played.value).toBe('resolved')
    expect(el.readyState).toBe(HAVE_ENOUGH_DATA)
  })

  it('changing src rejects the pending play() with AbortError and drops queued events', async () => {
    const el = new FakeMediaElement()
    const seen = recordEvents(el, ['play', 'waiting', 'emptied'])
    el.setAttribute('src', 'a.mp3')
    const first = outcome(el.play())
    el.setAttribute('src', 'b.mp3')
    await el.settle()
    expect(first.value).toBe('AbortError')
    expect(seen).toEqual(['emptied'])
    expect(el.paused).toBe(true)
    expect(el.readyState).toBe(HAVE_NOTHING)
  })

  it('pause() rejects the pending play() with AbortError and fires pause', async () => {
    const el = new FakeMediaElement()
    const seen = recordEvents(el, ['pause'])
    el.setAttribute('src', 'a.mp3')
    const played = outcome(el.play())
    el.pause()
    await el.settle()
    expect(played.value).toBe('AbortError')
    expect(seen).toEqual(['pause'])
  })

  it('pause, remove src, load: the dropped pause task still rejects play(); no src is left', async () => {
    const el = new FakeMediaElement()
    el.setAttribute('src', 'a.mp3')
    const played = outcome(el.play())
    el.pause()
    el.removeAttribute('src')
    expect(el.networkState).not.toBe(NETWORK_EMPTY) // removing src alone does not reset
    el.load()
    await el.settle()
    expect(played.value).toBe('AbortError')
    expect(el.networkState).toBe(NETWORK_EMPTY)
    expect(el.getAttribute('src')).toBeNull()
    expect(el.calls).toEqual(['set src=a.mp3', 'play', 'pause', 'remove src', 'load'])
  })

  it('refuses play() with NotAllowedError while blocked, staying paused', async () => {
    const el = new FakeMediaElement()
    el.playPolicy = 'blocked'
    el.setAttribute('src', 'a.mp3')
    const played = outcome(el.play())
    await el.settle()
    expect(played.value).toBe('NotAllowedError')
    expect(el.paused).toBe(true)
  })

  it('a source failure fires error, rejects play() with NotSupportedError, and refuses later plays', async () => {
    const el = new FakeMediaElement()
    const seen = recordEvents(el, ['error'])
    el.setAttribute('src', 'missing.mp3')
    const first = outcome(el.play())
    el.fail(MEDIA_ERR_SRC_NOT_SUPPORTED)
    await el.settle()
    expect(seen).toEqual(['error'])
    expect(first.value).toBe('NotSupportedError')
    const second = outcome(el.play())
    await el.settle()
    expect(second.value).toBe('NotSupportedError')
  })

  it('finish fires timeupdate, pause and ended, with ended and paused set', async () => {
    const el = new FakeMediaElement()
    const seen = recordEvents(el, ['timeupdate', 'pause', 'ended'])
    el.setAttribute('src', 'a.mp3')
    void outcome(el.play())
    el.loadMetadata(65)
    el.receiveData(65)
    await el.settle()
    seen.length = 0
    el.finish()
    await el.settle()
    expect(seen).toEqual(['timeupdate', 'pause', 'ended'])
    expect(el.ended).toBe(true)
    expect(el.paused).toBe(true)
    expect(el.currentTime).toBe(65)
  })

  it('seeking clamps to the duration and fires seeking, timeupdate, seeked', async () => {
    const el = new FakeMediaElement()
    const seen = recordEvents(el, ['seeking', 'timeupdate', 'seeked'])
    el.setAttribute('src', 'a.mp3')
    el.loadMetadata(100)
    await el.settle()
    el.currentTime = 250
    expect(el.seeking).toBe(true)
    await el.settle()
    expect(el.currentTime).toBe(100)
    expect(el.seeking).toBe(false)
    expect(seen).toEqual(['seeking', 'timeupdate', 'seeked'])
  })

  it('test controls refuse to run without a source or out of order', () => {
    const el = new FakeMediaElement()
    expect(() => el.loadMetadata(10)).toThrow(/needs a src/)
    el.setAttribute('src', 'a.mp3')
    expect(() => el.receiveData(10)).toThrow(/loadMetadata/)
  })

  it('FakeTimeRanges throws IndexSizeError out of range, like TimeRanges', () => {
    const ranges = new FakeTimeRanges([[0, 5]])
    expect(ranges.length).toBe(1)
    expect(ranges.end(0)).toBe(5)
    expect(() => ranges.start(1)).toThrow(DOMException)
  })
})
