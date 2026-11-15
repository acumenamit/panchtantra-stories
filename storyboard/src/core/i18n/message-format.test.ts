// The ICU subset (P1 D8; design p1-step7-design.md §6.2, §6.5, §6.6, §8.1 item 2; P1-1c):
// arguments, number, plural with =N, CLDR categories and #, Hindi and English plural rules,
// Latin digits under hi, every rejected construct, argument checks, and a fast-check property
// (seed 20261114) that a valid message with finite numbers never throws.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MessageFormatError,
  PLURAL_CATEGORIES,
  checkArguments,
  formatMessage,
  formatNumber,
  parseMessage,
  selectPlural,
  strictestKinds,
  type ArgKind,
  type MessageValues,
} from './message-format'

const SEED = 20261114

const format = (locale: string, source: string, values?: MessageValues): string =>
  formatMessage(locale, parseMessage(source), values)

/** The design §6.5 "x of y" patterns (not shipped in Step 7). */
const ENDINGS_EN = 'Ending {found} of {total} found'
const ENDINGS_HI =
  '{found, plural, =0 {अभी कोई अंत नहीं मिला} one {{total} में से # अंत मिला} other {{total} में से # अंत मिले}}'

describe('parseMessage and formatMessage', () => {
  it('passes plain text through, # included outside a plural', () => {
    expect(format('en', 'Skip to main content')).toBe('Skip to main content')
    expect(format('en', 'Story #3 isn’t here.')).toBe('Story #3 isn’t here.')
    expect(format('hi', 'मुख्य सामग्री पर जाएँ')).toBe('मुख्य सामग्री पर जाएँ')
    expect(parseMessage('').parts).toEqual([])
  })

  it('formats {name} with a string or a number, and {name, number}', () => {
    expect(format('en', 'Hello {name}.', { name: 'Asha' })).toBe('Hello Asha.')
    expect(format('en', 'Hello { name }.', { name: 'Asha' })).toBe('Hello Asha.')
    expect(format('en', '{n} stories', { n: 1234567 })).toBe('1,234,567 stories')
    expect(format('hi', '{n} कहानियाँ', { n: 1234567 })).toBe('12,34,567 कहानियाँ')
    expect(format('en', '{n, number}', { n: 1234.5 })).toBe('1,234.5')
    expect(format('hi', '{n, number}', { n: 1234567 })).toBe('12,34,567')
    expect(format('en', '{a}{b}{a}', { a: 'x', b: 2 })).toBe('x2x')
  })

  it('formats the x-of-y pattern in both languages with arguments inside the branches', () => {
    expect(format('en', ENDINGS_EN, { found: 2, total: 5 })).toBe('Ending 2 of 5 found')
    expect(format('hi', ENDINGS_HI, { found: 0, total: 5 })).toBe('अभी कोई अंत नहीं मिला')
    expect(format('hi', ENDINGS_HI, { found: 1, total: 5 })).toBe('5 में से 1 अंत मिला')
    expect(format('hi', ENDINGS_HI, { found: 2, total: 5 })).toBe('5 में से 2 अंत मिले')
    expect(format('hi', ENDINGS_HI, { found: 1200, total: 1500 })).toBe(
      '1,500 में से 1,200 अंत मिले',
    )
  })

  it('selects =N first, then the CLDR category: hi 0 and 1 are one, 2 is other; en 0 is other', () => {
    const plural = '{n, plural, one {one #} other {other #}}'
    expect(format('hi', plural, { n: 0 })).toBe('one 0')
    expect(format('hi', plural, { n: 1 })).toBe('one 1')
    expect(format('hi', plural, { n: 2 })).toBe('other 2')
    expect(format('en', plural, { n: 0 })).toBe('other 0')
    expect(format('en', plural, { n: 1 })).toBe('one 1')
    expect(format('en', plural, { n: 2 })).toBe('other 2')
    const exact = '{n, plural, =0 {none} =1 {just one} one {one #} other {# {n, number} more}}'
    expect(format('en', exact, { n: 0 })).toBe('none')
    expect(format('hi', exact, { n: 0 })).toBe('none')
    expect(format('en', exact, { n: 1 })).toBe('just one')
    expect(format('en', exact, { n: 1500 })).toBe('1,500 1,500 more')
    // A category the message does not list falls back to other.
    expect(format('en', '{n, plural, =5 {five} other {#}}', { n: 1 })).toBe('1')
    expect(format('en', '{n, plural, few {few} other {#}}', { n: 3 })).toBe('3')
  })

  it('selectPlural matches =N numerically, then the category, then other', () => {
    expect(selectPlural('en', 0, ['=0', 'one', 'other'])).toBe('=0')
    expect(selectPlural('en', 0, ['one', 'other'])).toBe('other')
    expect(selectPlural('hi', 0, ['one', 'other'])).toBe('one')
    expect(selectPlural('hi', 2, ['one', 'other'])).toBe('other')
    expect(selectPlural('en', 1e21, ['=1000000000000000000000', 'other'])).toBe(
      '=1000000000000000000000',
    )
    expect(() => selectPlural('en', 1, ['one'])).toThrow(MessageFormatError)
  })

  it('formats numbers with Latin digits under hi, even with a -u-nu-deva tag', () => {
    expect(formatNumber('hi', 1234567)).toBe('12,34,567')
    expect(formatNumber('en', 1234567)).toBe('1,234,567')
    expect(formatNumber('hi', 12)).toBe('12')
    expect(formatNumber('hi-u-nu-deva', 12)).toBe('12')
    expect(formatNumber('hi', 1234567)).not.toMatch(/[०-९]/)
  })

  it('reports each argument with its kind: numeric wins over a bare use', () => {
    const kinds = (source: string): [string, ArgKind][] => [...parseMessage(source).args]
    expect(kinds(ENDINGS_EN)).toEqual([
      ['found', 'any'],
      ['total', 'any'],
    ])
    expect(kinds(ENDINGS_HI)).toEqual([
      ['found', 'numeric'],
      ['total', 'any'],
    ])
    expect(kinds('{a} {a, number}')).toEqual([['a', 'numeric']])
    expect(kinds('{a, number} {a}')).toEqual([['a', 'numeric']])
    expect(kinds('plain')).toEqual([])
  })

  it('strictestKinds takes numeric when either message uses the name numerically', () => {
    const merged = strictestKinds(parseMessage(ENDINGS_EN).args, parseMessage(ENDINGS_HI).args)
    expect([...merged]).toEqual([
      ['found', 'numeric'],
      ['total', 'any'],
    ])
    expect([...strictestKinds(new Map([['x', 'any']]), new Map())]).toEqual([['x', 'any']])
  })
})

describe('rejected at parse time', () => {
  it.each([
    ['an ASCII apostrophe', "This page isn't here."],
    ['an ASCII apostrophe used as ICU quoting', "'{'"],
    ['select', '{g, select, a {x} other {y}}'],
    ['selectordinal', '{n, selectordinal, one {#st} other {#th}}'],
    ['date', '{d, date}'],
    ['time', '{t, time, short}'],
    ['an unknown type', '{n, money}'],
    ['a number style', '{n, number, integer}'],
    ['a number skeleton', '{n, number, ::percent}'],
    ['a tag', 'Read <b>this</b>.'],
    ['a closing tag', 'Read this</b>.'],
    ['a numbered tag', '<0>link</0>'],
    ['a nested plural', '{a, plural, other {{b, plural, other {x}}}}'],
    ['offset:', '{n, plural, offset:1 one {x} other {y}}'],
    ['an unclosed brace', 'Hello {name'],
    ['an unclosed plural', '{n, plural, other {x}'],
    ['an unclosed branch', '{n, plural, other {x'],
    ['a stray closing brace', 'Hello }'],
    ['an empty argument', 'Hello {}'],
    ['a name starting with a digit', '{1n}'],
    ['a name with a hyphen', '{a-b}'],
    ['a name with an underscore', '{a_b}'],
    ['a missing type', '{n, }'],
    ['an empty branch', '{n, plural, one {} other {x}}'],
    ['no other branch', '{n, plural, one {x}}'],
    ['an unknown category', '{n, plural, some {x} other {y}}'],
    ['a negative exact selector', '{n, plural, =-1 {x} other {y}}'],
    ['a leading-zero exact selector', '{n, plural, =01 {x} other {y}}'],
    ['a fractional exact selector', '{n, plural, =1.5 {x} other {y}}'],
    ['a duplicate selector', '{n, plural, one {x} one {y} other {z}}'],
    ['a plural with no comma', '{n, plural one {x} other {y}}'],
    ['text after a branch outside braces', '{n, plural, other {x} y}'],
  ])('%s: %j', (_name, source) => {
    expect(() => parseMessage(source)).toThrow(MessageFormatError)
  })

  it('names the problem and its offset', () => {
    expect(() => parseMessage('{n, select, other {x}}')).toThrow('"select" is not supported')
    expect(() => parseMessage('Hi }')).toThrow('unbalanced "}" at offset 3')
  })

  it('accepts every CLDR category and exact selectors', () => {
    const all = PLURAL_CATEGORIES.map((c) => `${c} {${c} #}`).join(' ')
    expect(() => parseMessage(`{n, plural, =0 {zero!} =12 {dozen} ${all}}`)).not.toThrow()
  })
})

describe('argument checks', () => {
  it.each<[string, string, MessageValues, string]>([
    ['a missing argument', 'Hello {name}', {}, 'missing argument "name"'],
    ['a missing plural argument', ENDINGS_HI, { total: 3 }, 'missing argument "found"'],
    ['an extra argument', 'Hello', { name: 'x' }, 'unexpected argument "name"'],
    ['an extra beside a used one', 'Hello {a}', { a: 'x', b: 'y' }, 'unexpected argument "b"'],
    ['NaN', '{n}', { n: Number.NaN }, 'argument "n" must be a finite number'],
    ['Infinity', '{n, number}', { n: Number.POSITIVE_INFINITY }, 'must be a finite number'],
    ['-Infinity in a plural', ENDINGS_HI, { found: -Infinity, total: 1 }, 'finite number'],
    ['a string for number', '{n, number}', { n: '5' }, 'argument "n" must be a number'],
    ['a string for plural', ENDINGS_HI, { found: '1', total: 3 }, 'must be a number'],
  ])('%s throws', (_name, source, values, message) => {
    expect(() => format('en', source, values)).toThrow(message)
  })

  it('rejects a value that is neither a string nor a number', () => {
    const args = new Map<string, ArgKind>([['x', 'any']])
    for (const bad of [null, undefined, true, {}, 1n]) {
      expect(() => checkArguments(args, { x: bad as unknown as string })).toThrow(
        'argument "x" must be a string or a number',
      )
    }
  })

  it('reads own values only: a name such as constructor is not found on the prototype', () => {
    expect(() => format('en', '{constructor}', {})).toThrow('missing argument "constructor"')
    expect(format('en', '{constructor}', { constructor: 'ok' })).toBe('ok')
  })
})

describe('properties (fast-check, seed 20261114)', () => {
  const textUnit = fc.constantFrom(
    ...'abcXYZ019 .,:;!?-()’“”—–…'.split(''),
    ...'कहानीअंतमिलाँ़्।'.split(''),
  )
  const text = (minLength: number): fc.Arbitrary<string> =>
    fc.string({ unit: textUnit, minLength, maxLength: 6 })
  const name = fc.constantFrom('a', 'n', 'found', 'total', 'x1', 'Z')
  const pad = fc.constantFrom('', ' ', '  ')

  const branchPart = fc.oneof(
    text(1),
    name.map((n) => `{${n}}`),
    name.map((n) => `{${n}, number}`),
    fc.constant('#'),
  )
  const branch = fc.array(branchPart, { minLength: 1, maxLength: 4 }).map((p) => p.join(''))
  const selector = fc.oneof(
    fc.constantFrom(...PLURAL_CATEGORIES),
    fc.nat({ max: 20 }).map((n) => `=${n}`),
  )
  const plural = fc
    .record({
      name,
      branches: fc.uniqueArray(fc.tuple(selector, branch), {
        selector: ([s]) => s,
        maxLength: 4,
      }),
      other: branch,
      pad,
    })
    .map(
      ({ name: n, branches, other, pad: p }) =>
        `{${p}${n}${p},${p}plural,${branches
          .filter(([s]) => s !== 'other')
          .map(([s, b]) => `${p}${s}${p}{${b}}`)
          .join('')} other {${other}}${p}}`,
    )
  const topPart = fc.oneof(
    text(1),
    fc.tuple(name, pad).map(([n, p]) => `{${p}${n}${p}}`),
    fc.tuple(name, pad).map(([n, p]) => `{${p}${n},${p}number${p}}`),
    plural,
  )
  const message = fc.array(topPart, { maxLength: 5 }).map((p) => p.join(''))

  const finite = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 })

  it('a valid message with finite numbers never throws, in en and hi', () => {
    fc.assert(
      fc.property(
        message,
        fc.constantFrom('en', 'hi'),
        fc.array(fc.oneof(finite, fc.nat({ max: 3 })), { minLength: 6, maxLength: 6 }),
        fc.array(fc.string({ maxLength: 5 }), { minLength: 6, maxLength: 6 }),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        (source, locale, numbers, strings, useString) => {
          const parsed = parseMessage(source)
          const values: Record<string, string | number> = {}
          let i = 0
          for (const [arg, kind] of parsed.args) {
            values[arg] =
              kind === 'any' && useString[i] === true ? (strings[i] ?? '') : (numbers[i] ?? 0)
            i++
          }
          expect(typeof formatMessage(locale, parsed, values)).toBe('string')
        },
      ),
      { seed: SEED, numRuns: 3_000 },
    )
  })

  it('never throws anything but MessageFormatError on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (source) => {
        try {
          parseMessage(source)
        } catch (error) {
          expect(error).toBeInstanceOf(MessageFormatError)
        }
      }),
      { seed: SEED, numRuns: 3_000 },
    )
  })
})
