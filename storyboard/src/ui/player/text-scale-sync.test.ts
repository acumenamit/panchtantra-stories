// TextScaleSync's work (Step 10b; design p1-step10-design.md D11-P20, R23, T-b7). syncTextScale runs
// against the real prefs store over the fake Web Storage (two fake tabs of one origin) and a fake
// <html>: at once it applies the stored text size (never the hydration snapshot, which is always
// 100 and would undo the boot script's 125 or 150); after that it follows this tab's updates and
// other tabs' changes; 100 removes the attribute (never writes "100"); it touches <html> only when
// the value differs; unsubscribing stops it.
import { describe, expect, it } from 'vitest'
import { PREFS_KEY } from '../../core/progress'
import { TEXT_SCALE_ATTRIBUTE } from '../../core/progress/text-scale'
import { createDeviceStorage } from '../../reader/progress/device-storage'
import { createPrefsStore } from '../../reader/progress/prefs-store'
import { FakeOrigin } from '../../reader/progress/testing/fake-web-storage'
import { syncTextScale } from './text-scale-sync'

const record = (textScale: number): string =>
  `{"schema":1,"uiLocale":null,"textScale":${textScale},"readToMe":false}`

/** A fake <html>: its attributes and a log of every set and remove. */
function fakeRoot() {
  const attributes = new Map<string, string>()
  const log: string[] = []
  return {
    attributes,
    log,
    getAttribute(name: string): string | null {
      return attributes.get(name) ?? null
    },
    setAttribute(name: string, value: string): void {
      log.push(`set ${name}=${value}`)
      attributes.set(name, value)
    },
    removeAttribute(name: string): void {
      log.push(`remove ${name}`)
      attributes.delete(name)
    },
  }
}

function setup(stored: number | null) {
  const origin = new FakeOrigin()
  const mine = origin.openTab()
  const other = origin.openTab()
  if (stored !== null) mine.localStorage.setItem(PREFS_KEY, record(stored))
  origin.flushEvents()
  const prefs = createPrefsStore({
    device: createDeviceStorage({
      getStorage: () => mine.localStorage,
      getEventSource: () => mine.window,
    }),
    isBrowser: () => true,
  })
  return { origin, other, prefs, root: fakeRoot() }
}

describe('syncTextScale (TextScaleSync)', () => {
  it.each([
    [150, '150'],
    [125, '125'],
  ] as const)(
    'stored %d: keeps "%s" from the boot script, not the hydration snapshot',
    (stored, value) => {
      const t = setup(stored)
      // What the boot script left on <html>, which hydration must not undo.
      t.root.attributes.set(TEXT_SCALE_ATTRIBUTE, value)
      expect(t.prefs.getServerSnapshot().textScale).toBe(100)
      const stop = syncTextScale(t.prefs, t.root)
      expect(t.root.attributes.get(TEXT_SCALE_ATTRIBUTE)).toBe(value)
      // The same value: no attribute change at all.
      expect(t.root.log).toEqual([])
      stop()
    },
  )

  it('stored 150 while <html> has none (changed after the boot script): sets it at once', () => {
    const t = setup(150)
    const stop = syncTextScale(t.prefs, t.root)
    expect(t.root.attributes.get(TEXT_SCALE_ATTRIBUTE)).toBe('150')
    expect(t.root.log).toEqual([`set ${TEXT_SCALE_ATTRIBUTE}=150`])
    stop()
  })

  it('nothing stored (100): no attribute, never "100"; one left on <html> is removed', () => {
    const t = setup(null)
    const stop = syncTextScale(t.prefs, t.root)
    expect(t.root.attributes.has(TEXT_SCALE_ATTRIBUTE)).toBe(false)
    expect(t.root.log).toEqual([])
    stop()
    const u = setup(null)
    u.root.attributes.set(TEXT_SCALE_ATTRIBUTE, '150')
    const stopU = syncTextScale(u.prefs, u.root)
    expect(u.root.attributes.has(TEXT_SCALE_ATTRIBUTE)).toBe(false)
    expect(u.root.log).toEqual([`remove ${TEXT_SCALE_ATTRIBUTE}`])
    stopU()
  })

  it("follows this tab's radios: 150 sets it, 100 removes it, 125 sets it", () => {
    const t = setup(null)
    const stop = syncTextScale(t.prefs, t.root)
    t.prefs.update({ textScale: 150 })
    expect(t.root.attributes.get(TEXT_SCALE_ATTRIBUTE)).toBe('150')
    t.prefs.update({ textScale: 100 })
    expect(t.root.attributes.has(TEXT_SCALE_ATTRIBUTE)).toBe(false)
    t.prefs.update({ textScale: 125 })
    expect(t.root.attributes.get(TEXT_SCALE_ATTRIBUTE)).toBe('125')
    expect(t.root.log).toEqual([
      `set ${TEXT_SCALE_ATTRIBUTE}=150`,
      `remove ${TEXT_SCALE_ATTRIBUTE}`,
      `set ${TEXT_SCALE_ATTRIBUTE}=125`,
    ])
    expect(t.root.log.some((line) => line.endsWith('=100'))).toBe(false)
    stop()
  })

  it("follows another tab's change, and stops after unsubscribing", () => {
    const t = setup(125)
    const stop = syncTextScale(t.prefs, t.root)
    expect(t.root.attributes.get(TEXT_SCALE_ATTRIBUTE)).toBe('125')
    t.other.localStorage.setItem(PREFS_KEY, record(150))
    t.origin.flushEvents()
    expect(t.root.attributes.get(TEXT_SCALE_ATTRIBUTE)).toBe('150')
    t.other.localStorage.setItem(PREFS_KEY, record(100))
    t.origin.flushEvents()
    expect(t.root.attributes.has(TEXT_SCALE_ATTRIBUTE)).toBe(false)
    stop()
    const before = [...t.root.log]
    t.other.localStorage.setItem(PREFS_KEY, record(150))
    t.origin.flushEvents()
    t.prefs.update({ textScale: 125 })
    expect(t.root.log).toEqual(before)
    expect(t.root.attributes.has(TEXT_SCALE_ATTRIBUTE)).toBe(false)
  })
})
