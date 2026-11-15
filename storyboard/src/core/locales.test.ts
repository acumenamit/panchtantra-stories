import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  ENABLED_LOCALE_CODES,
  LOCALE_CODES,
  LOCALES,
  getLocaleDef,
  isEnabledLocale,
  isLocaleCode,
  parseEnabledLocale,
  type LocaleCode,
} from './locales'

describe('locale registry', () => {
  it('matches the spec §4.5 table exactly', () => {
    expect(LOCALES).toEqual([
      {
        code: 'en',
        endonym: 'English',
        dir: 'ltr',
        script: 'Latn',
        status: 'enabled',
        questionMarks: ['?'],
      },
      {
        code: 'hi',
        endonym: 'हिन्दी',
        dir: 'ltr',
        script: 'Deva',
        status: 'enabled',
        questionMarks: ['?'],
      },
      {
        code: 'ar',
        endonym: 'العربية',
        dir: 'rtl',
        script: 'Arab',
        status: 'disabled',
        questionMarks: ['؟', '?'],
      },
    ])
  })

  it('has exactly one entry per locale code, in the same order', () => {
    expect(LOCALES.map((l) => l.code)).toEqual([...LOCALE_CODES])
  })

  it('recognises every registry code, enabled or not', () => {
    for (const code of ['en', 'hi', 'ar']) expect(isLocaleCode(code)).toBe(true)
  })

  it('enables English and Hindi only at launch', () => {
    expect(ENABLED_LOCALE_CODES).toEqual(['en', 'hi'])
    expect(isEnabledLocale('en')).toBe(true)
    expect(isEnabledLocale('hi')).toBe(true)
    expect(isEnabledLocale('ar')).toBe(false)
  })

  it('marks Arabic right-to-left with the Arabic question mark', () => {
    const ar = getLocaleDef('ar')
    expect(ar.dir).toBe('rtl')
    expect(ar.questionMarks).toContain('؟')
  })

  it('rejects any string that is not a registry code', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(LOCALE_CODES as readonly string[]).includes(s)),
        (s) => !isLocaleCode(s) && !isEnabledLocale(s),
      ),
      { seed: 20261021 },
    )
  })
})

describe('parseEnabledLocale (P1-1c)', () => {
  it.each([
    ['en', 'en'],
    ['hi', 'hi'],
    ['ar', undefined],
    ['EN', undefined],
    ['Hi', undefined],
    ['', undefined],
    ['xx', undefined],
    [' en', undefined],
    ['en-IN', undefined],
    ['__proto__', undefined],
  ])('parses %j as %j', (value, expected) => {
    const parsed: LocaleCode | undefined = parseEnabledLocale(value)
    expect(parsed).toBe(expected)
  })

  it('returns a value only for the enabled registry codes', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom(...LOCALE_CODES, 'EN', 'Ar'), fc.string({ maxLength: 6 })),
        (value) => {
          const parsed = parseEnabledLocale(value)
          expect(parsed).toBe(ENABLED_LOCALE_CODES.find((code) => code === value))
          expect(parsed === undefined || isEnabledLocale(parsed)).toBe(true)
        },
      ),
      { seed: 20261114 },
    )
  })
})
