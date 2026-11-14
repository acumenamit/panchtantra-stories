// WCAG 2.2 contrast function (spec §6.6, RC-7; P1-1b): anchors, exact thresholds, bad input, and
// fast-check properties (seed 20261114).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseHex, relativeLuminance } from './contrast'

const SEED = 20261114

const byte = fc.integer({ min: 0, max: 255 })
const hexColour = fc.tuple(byte, byte, byte, fc.boolean()).map(([r, g, b, upper]) => {
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
  return upper ? hex.toUpperCase() : hex
})

describe('contrastRatio', () => {
  it.each([
    ['#000000', '#ffffff', '21.0000'],
    ['#767676', '#ffffff', '4.5422'],
    ['#777777', '#ffffff', '4.4781'],
    ['#595959', '#ffffff', '7.0047'],
    ['#5a5a5a', '#ffffff', '6.8969'],
  ])('%s on %s is %s:1', (fg, bg, expected) => {
    expect(contrastRatio(fg, bg).toFixed(4)).toBe(expected)
  })

  it('compares unrounded at exactly 4.5 and 7', () => {
    expect(contrastRatio('#767676', '#ffffff') >= 4.5).toBe(true)
    expect(contrastRatio('#777777', '#ffffff') >= 4.5).toBe(false)
    expect(contrastRatio('#595959', '#ffffff') >= 7).toBe(true)
    expect(contrastRatio('#5a5a5a', '#ffffff') >= 7).toBe(false)
  })

  it('uses the 0.04045 threshold and the WCAG 2.2 weights', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 12)
    // 10/255 = 0.0392 is below the threshold: the linear branch.
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 12)
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 12)
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 12)
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 12)
  })

  it('accepts either case', () => {
    expect(contrastRatio('#FBBF24', '#0D0A05')).toBe(contrastRatio('#fbbf24', '#0d0a05'))
    expect(parseHex('#C8892B')).toEqual({ r: 200, g: 137, b: 43 })
  })

  it.each([
    '#fff',
    'fff',
    'ffffff',
    '#ffff',
    '#fffffff',
    '#ffffff00',
    '#gggggg',
    ' #ffffff',
    '#ffffff ',
    'red',
    'rgb(0, 0, 0)',
    '',
  ])('throws a TypeError for %j', (bad) => {
    expect(() => parseHex(bad)).toThrow(TypeError)
    expect(() => contrastRatio(bad, '#ffffff')).toThrow(TypeError)
    expect(() => contrastRatio('#ffffff', bad)).toThrow(TypeError)
  })

  it('throws a TypeError for a value that is not a string', () => {
    expect(() => parseHex(0xffffff as unknown as string)).toThrow(TypeError)
    expect(() => parseHex(null as unknown as string)).toThrow(TypeError)
  })

  it('is symmetric', () => {
    fc.assert(
      fc.property(hexColour, hexColour, (a, b) => {
        expect(contrastRatio(a, b)).toBe(contrastRatio(b, a))
      }),
      { seed: SEED, numRuns: 1000 },
    )
  })

  it('stays within 1 to 21', () => {
    fc.assert(
      fc.property(hexColour, hexColour, (a, b) => {
        const ratio = contrastRatio(a, b)
        expect(ratio).toBeGreaterThanOrEqual(1)
        expect(ratio).toBeLessThanOrEqual(21 + 1e-9)
      }),
      { seed: SEED, numRuns: 1000 },
    )
  })

  it('is exactly 1 for a colour on itself', () => {
    fc.assert(
      fc.property(hexColour, (a) => {
        expect(contrastRatio(a, a)).toBe(1)
        expect(contrastRatio(a, a.toLowerCase())).toBe(1)
      }),
      { seed: SEED, numRuns: 1000 },
    )
  })
})
