// Text size after first paint (Step 10b; design p1-step10-design.md D11-P20, §9.2 10b row, R23).
// textScaleAttributeOf must give exactly what TEXT_SCALE_BOOT_SCRIPT sets on <html> for the same
// stored textScale: the boot script runs in node:vm with a fake localStorage holding a schema 1
// prefs record, and its data-text-scale (or none) is compared for every TEXT_SCALES value, a list of
// junk values, and 2,000 fast-check JSON values (seed 20261114). Null means "no attribute", so the
// player's sync removes it where the boot script would have set none (100 included).
import { Script, createContext } from 'node:vm'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PREFS_KEY, TEXT_SCALES } from './records'
import { TEXT_SCALE_ATTRIBUTE, textScaleAttributeOf } from './text-scale'
import { TEXT_SCALE_ATTRIBUTE as BOOT_ATTRIBUTE, TEXT_SCALE_BOOT_SCRIPT } from './text-scale-boot'

const SEED = 20261114

/** A schema 1 prefs record with this raw textScale JSON, or with no textScale key (undefined). */
const recordWith = (textScaleJson: string | undefined): string =>
  textScaleJson === undefined
    ? '{"schema":1,"uiLocale":null,"readToMe":false}'
    : `{"schema":1,"uiLocale":null,"textScale":${textScaleJson},"readToMe":false}`

/** What the boot script sets on <html> for this stored prefs text: the attribute value or null. */
const bootAttribute = (() => {
  let raw: string | null = null
  let attributes = new Map<string, string>()
  const sandbox = {
    localStorage: {
      getItem: (key: string): string | null => (key === PREFS_KEY ? raw : null),
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string): void => {
          attributes.set(name, value)
        },
      },
    },
  }
  const context = createContext(sandbox)
  const script = new Script(TEXT_SCALE_BOOT_SCRIPT)
  return (stored: string): string | null => {
    raw = stored
    attributes = new Map()
    script.runInContext(context)
    expect([...attributes.keys()].every((name) => name === BOOT_ATTRIBUTE)).toBe(true)
    return attributes.get(BOOT_ATTRIBUTE) ?? null
  }
})()

/** The stored JSON of a value as the store would write it (undefined: the key is absent). */
const storedJson = (value: unknown): string | undefined =>
  value === undefined ? undefined : JSON.stringify(value)

describe('textScaleAttributeOf agrees with TEXT_SCALE_BOOT_SCRIPT', () => {
  it('names the same attribute as the boot script', () => {
    expect(TEXT_SCALE_ATTRIBUTE).toBe('data-text-scale')
    expect(TEXT_SCALE_ATTRIBUTE).toBe(BOOT_ATTRIBUTE)
  })

  it('every TEXT_SCALES value: null for the default 100, else the number as text', () => {
    expect(TEXT_SCALES).toEqual([100, 125, 150])
    expect(TEXT_SCALES.map((scale) => [scale, textScaleAttributeOf(scale)])).toEqual([
      [100, null],
      [125, '125'],
      [150, '150'],
    ])
    for (const scale of TEXT_SCALES) {
      expect(textScaleAttributeOf(scale), String(scale)).toBe(bootAttribute(recordWith(`${scale}`)))
    }
  })

  const JUNK: readonly [string, unknown][] = [
    ['0', 0],
    ['-0', -0],
    ['-150', -150],
    ['140', 140],
    ['200', 200],
    ['125.5', 125.5],
    ['150.0001', 150.0001],
    ['"150" (a string)', '150'],
    ['"125" (a string)', '125'],
    ['"100" (a string)', '100'],
    ['an empty string', ''],
    ['null', null],
    ['true', true],
    ['false', false],
    ['[]', []],
    ['[150]', [150]],
    ['{}', {}],
    ['{"value":150}', { value: 150 }],
    ['no textScale key', undefined],
    ['NaN (stored as null)', Number.NaN],
    ['Infinity (stored as null)', Number.POSITIVE_INFINITY],
  ]

  it.each(JUNK)('junk %s: no attribute, as the boot script', (_name, value) => {
    expect(textScaleAttributeOf(value)).toBeNull()
    expect(bootAttribute(recordWith(storedJson(value)))).toBeNull()
  })

  it('the same number written another way in storage (1.5e2, 125.0) still agrees', () => {
    for (const [json, value] of [
      ['1.5e2', 150],
      ['125.0', 125],
      ['1e2', 100],
    ] as const) {
      expect(textScaleAttributeOf(JSON.parse(json)), json).toBe(bootAttribute(recordWith(json)))
      expect(textScaleAttributeOf(JSON.parse(json)), json).toBe(textScaleAttributeOf(value))
    }
  })

  it('values the boot script never sees (undefined, a symbol, a bigint, a function) give null', () => {
    for (const value of [undefined, Symbol('150'), 150n, () => 150]) {
      expect(textScaleAttributeOf(value)).toBeNull()
    }
  })

  it('agrees on 2,000 generated JSON values', () => {
    const value = fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom<unknown>(...TEXT_SCALES) },
      { weight: 2, arbitrary: fc.integer({ min: -300, max: 300 }) },
      { weight: 1, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
      { weight: 2, arbitrary: fc.jsonValue() },
    )
    fc.assert(
      fc.property(value, (generated) => {
        // What the store would hold and read back: JSON, so -0 becomes 0 and so on.
        const json = JSON.stringify(generated)
        const read: unknown = json === undefined ? undefined : JSON.parse(json)
        expect(textScaleAttributeOf(read)).toBe(bootAttribute(recordWith(json)))
      }),
      { seed: SEED, numRuns: 2_000 },
    )
  })
})
