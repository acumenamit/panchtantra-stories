// The pure readers the Step 12 e2e specs share (design p1-step12-design.md §13.2 W2, W3, W11,
// §13.3 T12-38; P1-3 Step 12a). Reader code inside a test is guard code (process-v2.md "Test-writing
// patterns"), so each reader has samples that a weakened copy fails:
// - equalBoxes / boxDifferences (W2): two box sets are equal when every selector matched the same
//   number of elements and every left, top, width and height differs by at most 0.01 px; a change
//   of 0.02 in any one field, a missing selector or another element count is a difference
//   (weakened reader MR12-3: top only).
// - orderByRule (W3): addedOn descending, then the story id in code units (weakened reader MR12-4:
//   localeCompare, which puts 'a' before 'B'); the input is not changed.
// - pixelStats (W11): per named region, the mean absolute error and the largest absolute error of
//   each RGB channel (weakened reader MR12-18: one channel read).
// - measureBoxes is the page side of W2 (it runs in the browser through page.evaluate); its source
//   may use no name from this module's scope, which serialising it would lose.
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BOX_TOLERANCE_PX,
  boxDifferences,
  equalBoxes,
  measureBoxes,
  orderByRule,
  pixelStats,
  SCROLL_SIZE_KEY,
  type BoxSet,
  type PixelImage,
} from './e2e-readers'

const HERE = dirname(fileURLToPath(import.meta.url))

const SET: BoxSet = {
  h1: [{ left: 16, top: 120.5, width: 288, height: 42.25 }],
  '[data-story-card]': [
    { left: 16, top: 300, width: 288, height: 180.75 },
    { left: 16, top: 496, width: 288, height: 180.75 },
  ],
  [SCROLL_SIZE_KEY]: [{ left: 0, top: 0, width: 320, height: 1400 }],
}

/** SET with one field of one box of one selector moved by `delta`. */
function moved(
  selector: string,
  index: number,
  field: 'left' | 'top' | 'width' | 'height',
  delta: number,
): BoxSet {
  const copy = structuredClone(SET) as unknown as Record<string, { [k: string]: number }[]>
  const box = copy[selector]?.[index]
  if (box === undefined) throw new Error(`no box ${selector} ${index}`)
  box[field] = (box[field] ?? 0) + delta
  return copy as unknown as BoxSet
}

describe('equalBoxes and boxDifferences (W2, T12-38 g1)', () => {
  it('(g1) identical sets are equal, and so are sets within 0.01 px', () => {
    expect(BOX_TOLERANCE_PX).toBe(0.01)
    expect(equalBoxes(SET, structuredClone(SET))).toBe(true)
    expect(boxDifferences(SET, structuredClone(SET))).toEqual([])
    expect(equalBoxes(SET, moved('h1', 0, 'top', 0.005)), 'half the tolerance').toBe(true)
  })

  it.each([
    ['left', 'h1', 0],
    ['top', 'h1', 0],
    ['width', '[data-story-card]', 1],
    ['height', '[data-story-card]', 1],
    ['height', SCROLL_SIZE_KEY, 0],
  ] as const)(
    '(g1) a change of 0.02 px in %s (%s #%d) is a difference',
    (field, selector, index) => {
      const other = moved(selector, index, field, 0.02)
      expect(equalBoxes(SET, other), `${field} of ${selector}`).toBe(false)
      expect(boxDifferences(SET, other), `${field} of ${selector}`).toEqual([
        expect.stringContaining(`${selector} #${index} ${field}`),
      ])
    },
  )

  it('(g1) a missing selector, an extra one and another element count are differences', () => {
    const missing: Record<string, unknown> = structuredClone(SET)
    delete missing['h1']
    expect(equalBoxes(SET, missing as BoxSet), 'missing in the second').toBe(false)
    expect(equalBoxes(missing as BoxSet, SET), 'missing in the first').toBe(false)
    const fewer = { ...SET, '[data-story-card]': SET['[data-story-card]']?.slice(0, 1) ?? [] }
    expect(equalBoxes(SET, fewer), 'one card fewer').toBe(false)
    expect(boxDifferences(SET, fewer)).toEqual([
      expect.stringContaining('[data-story-card]: 2 boxes, then 1'),
    ])
  })
})

describe('orderByRule (W3, T12-38 g2)', () => {
  it('(g2) addedOn descending', () => {
    expect(
      orderByRule([
        { id: 'old', addedOn: '2026-03-07' },
        { id: 'new', addedOn: '2026-11-13' },
        { id: 'mid', addedOn: '2026-10-21' },
      ]),
    ).toEqual(['new', 'mid', 'old'])
  })

  it('(g2) ties by the id in code units: an upper-case id before a lower-case one', () => {
    expect(
      orderByRule([
        { id: 'a', addedOn: '2026-11-13' },
        { id: 'B', addedOn: '2026-11-13' },
        { id: 'river-stones', addedOn: '2026-11-13' },
        { id: 'lantern-walk', addedOn: '2026-11-13' },
      ]),
    ).toEqual(['B', 'a', 'lantern-walk', 'river-stones'])
  })

  it('(g2) the input is not changed', () => {
    const cards = [
      { id: 'b', addedOn: '2026-01-01' },
      { id: 'a', addedOn: '2026-02-01' },
    ]
    const before = structuredClone(cards)
    orderByRule(cards)
    expect(cards).toEqual(before)
  })
})

/** A width × height RGB image filled with `rgb` (its data writable for the samples). */
function filled(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): PixelImage & { readonly data: Uint8Array } {
  const data = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) data.set(rgb, i * 3)
  return { width, height, channels: 3, data }
}

describe('pixelStats (W11, T12-38 g3)', () => {
  const corners = {
    corners: [
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 6, y: 6, width: 2, height: 2 },
    ],
    whole: [{ x: 0, y: 0, width: 8, height: 8 }],
  }

  it('(g3) a uniform +3 shift gives MAE 3 and corner max 3 on every channel', () => {
    const stats = pixelStats(filled(8, 8, [13, 23, 33]), filled(8, 8, [10, 20, 30]), corners)
    expect(stats.whole?.mae).toEqual([3, 3, 3])
    expect(stats.whole?.maxAbs).toEqual([3, 3, 3])
    expect(stats.corners?.maxAbs).toEqual([3, 3, 3])
    expect(stats.corners?.pixels).toBe(8)
  })

  it('(g3) a change in one channel only is seen, in that channel only', () => {
    const decoded = filled(8, 8, [10, 20, 30])
    decoded.data[(7 * 8 + 7) * 3 + 2] = 46 // the last pixel's blue, +16
    const stats = pixelStats(decoded, filled(8, 8, [10, 20, 30]), corners)
    expect(stats.whole?.maxAbs).toEqual([0, 0, 16])
    expect(stats.whole?.mae).toEqual([0, 0, 0.25])
    expect(stats.corners?.maxAbs).toEqual([0, 0, 16])
  })

  it('(g3) reads RGBA data by its stride and refuses images of different sizes', () => {
    const rgba: PixelImage = {
      width: 2,
      height: 1,
      channels: 4,
      data: Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]),
    }
    const rgb: PixelImage = {
      width: 2,
      height: 1,
      channels: 3,
      data: Uint8Array.from([1, 2, 5, 4, 5, 6]),
    }
    expect(
      pixelStats(rgba, rgb, { all: [{ x: 0, y: 0, width: 2, height: 1 }] }).all?.maxAbs,
    ).toEqual([0, 0, 2])
    expect(() => pixelStats(filled(2, 2, [0, 0, 0]), filled(2, 1, [0, 0, 0]), { all: [] })).toThrow(
      'pixelStats: 2×2 against 2×1',
    )
  })
})

describe('measureBoxes, the page side of W2', () => {
  it('names nothing from its module, so page.evaluate can send it as source', () => {
    const path = join(HERE, 'e2e-readers.ts')
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const exported = new Set<string>()
    for (const statement of file.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) exported.add(statement.name.text)
      if (ts.isVariableStatement(statement)) {
        for (const d of statement.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) exported.add(d.name.text)
        }
      }
    }
    exported.delete('measureBoxes')
    const source = measureBoxes.toString()
    expect(
      [...exported].filter((name) => new RegExp(`\\b${name}\\b`).test(source)),
      'module names used inside measureBoxes',
    ).toEqual([])
    expect(source, 'it records the scroll size under the shared key').toContain(SCROLL_SIZE_KEY)
  })
})
