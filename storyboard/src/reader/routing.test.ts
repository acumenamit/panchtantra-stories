// Reader routing helpers (design p1-step7-design.md §8.1 item 8; P1-1c): the static params per
// launch state, the gate options, the language switch target and the remember query.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ENABLED_LOCALE_CODES, LOCALES, getLocaleDef } from '../core/locales'
import {
  REMEMBER_PARAM,
  SCRIPT_MARKS,
  gateOption,
  gateOptions,
  readerLocaleParams,
  rememberTarget,
  switchHref,
  withoutRemember,
} from './routing'

const SEED = 20261114

describe('readerLocaleParams', () => {
  it('gives no params while gated, so every locale path is a 404', () => {
    expect(readerLocaleParams({ readerRoutes: false })).toEqual([])
  })

  it('gives en and hi when open, never ar', () => {
    const params = readerLocaleParams({ readerRoutes: true })
    expect(params).toEqual([{ locale: 'en' }, { locale: 'hi' }])
    expect(params.map((p) => p.locale)).toEqual([...ENABLED_LOCALE_CODES])
    expect(params.map((p) => p.locale)).not.toContain('ar')
  })
})

describe('gateOptions', () => {
  it('lists the enabled locales in registry order with registry attributes', () => {
    expect(gateOptions()).toEqual([
      {
        code: 'en',
        href: '/en?remember=1',
        lang: 'en',
        hrefLang: 'en',
        dir: 'ltr',
        endonym: 'English',
        mark: 'A',
      },
      {
        code: 'hi',
        href: '/hi?remember=1',
        lang: 'hi',
        hrefLang: 'hi',
        dir: 'ltr',
        endonym: 'हिन्दी',
        mark: 'अ',
      },
    ])
  })

  it('follows the registry: enabled only, in its order', () => {
    expect(gateOptions().map((o) => o.code)).toEqual(
      LOCALES.filter((l) => l.status === 'enabled').map((l) => l.code),
    )
  })

  it('would give ar right-to-left attributes and its own script mark', () => {
    expect(gateOption(getLocaleDef('ar'))).toEqual({
      code: 'ar',
      href: '/ar?remember=1',
      lang: 'ar',
      hrefLang: 'ar',
      dir: 'rtl',
      endonym: 'العربية',
      mark: 'ا',
    })
  })

  it('has one mark per registry script', () => {
    expect(SCRIPT_MARKS).toEqual({ Latn: 'A', Deva: 'अ', Arab: 'ا' })
    for (const def of LOCALES) expect(SCRIPT_MARKS[def.script]).toBeTruthy()
  })
})

describe('switchHref', () => {
  it.each([
    ['/en/grown-ups', 'hi', '/hi/grown-ups'],
    ['/hi/grown-ups', 'en', '/en/grown-ups'],
    ['/en', 'hi', '/hi'],
    ['/hi', 'en', '/en'],
    ['/en/', 'hi', '/hi/'],
    ['/en/a/b', 'hi', '/hi/a/b'],
    ['/', 'hi', '/hi'],
    ['', 'en', '/en'],
    ['/ar/grown-ups', 'en', '/en'],
    ['/xx/grown-ups', 'hi', '/hi'],
    ['/english', 'hi', '/hi'],
  ] as const)('%j to %s is %j', (pathname, target, expected) => {
    expect(switchHref(pathname, target)).toBe(expected)
  })
})

describe('rememberTarget', () => {
  it.each([
    ['?remember=1', true],
    ['remember=1', true],
    ['?a=b&remember=1&c=d', true],
    ['?remember=%31', true],
    ['?remember=0', false],
    ['?remember=', false],
    ['?remember', false],
    ['?remember=true', false],
    ['?remember=01', false],
    ['?Remember=1', false],
    ['?remember=1&remember=1', false],
    ['', false],
    ['?', false],
  ])('%j gives %s', (search, expected) => {
    expect(rememberTarget(search)).toBe(expected)
  })
})

describe('withoutRemember', () => {
  it.each([
    ['/hi', '?remember=1', '', '/hi'],
    ['/hi', '?remember=1', '#main', '/hi#main'],
    ['/en/grown-ups', '?a=1&remember=1&b=2', '#x', '/en/grown-ups?a=1&b=2#x'],
    ['/en', '?remember=1&q=a%20b+c', '', '/en?q=a%20b+c'],
    ['/en', '?x=%E0%A4%85&remember=1', '', '/en?x=%E0%A4%85'],
    ['/en', '?remember=1&remember=2', '', '/en'],
    ['/en', '?rem%65mber=1&z', '', '/en?z'],
    ['/en', '?remembered=1', '', '/en?remembered=1'],
    ['/en', '', '', '/en'],
    ['/en', '?', '#', '/en#'],
    ['/en', '?a=1&&remember=1', '', '/en?a=1'],
  ])('%s %j %j gives %j', (pathname, search, hash, expected) => {
    expect(withoutRemember(pathname, search, hash)).toBe(expected)
  })

  it('keeps every other parameter, in order, and drops every remember', () => {
    const name = fc.constantFrom('a', 'b', 'q', REMEMBER_PARAM, 'remembered')
    const value = fc.constantFrom('', '1', 'x', 'a%20b', '%E0%A4%85')
    const part = fc.tuple(name, value).map(([n, v]) => `${n}=${v}`)
    fc.assert(
      fc.property(fc.array(part, { maxLength: 6 }), (parts) => {
        const search = parts.length === 0 ? '' : `?${parts.join('&')}`
        const result = withoutRemember('/hi', search, '#h')
        const url = new URL(result, 'https://example.test')
        expect(url.searchParams.has(REMEMBER_PARAM)).toBe(false)
        expect([...url.searchParams]).toEqual(
          [...new URLSearchParams(search)].filter(([n]) => n !== REMEMBER_PARAM),
        )
        expect(url.pathname).toBe('/hi')
        expect(url.hash).toBe('#h')
        expect(rememberTarget(url.search)).toBe(false)
      }),
      { seed: SEED },
    )
  })
})
