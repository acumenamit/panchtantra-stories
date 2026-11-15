// The root <html> attributes (design p1-step7-design.md §4.1, §4.2, §8.1 item 6; P1-1c). Imports
// only the pure document.ts, never font-classes.ts (next/font runs only inside Next).
import { describe, expect, it } from 'vitest'
import { LOCALES, getLocaleDef } from '../../core/locales'
import { htmlAttributes } from './document'

describe('htmlAttributes', () => {
  it('gives en and hi left-to-right, with the font classes and suppressHydrationWarning', () => {
    expect(htmlAttributes(getLocaleDef('en'), 'a b c')).toEqual({
      lang: 'en',
      dir: 'ltr',
      className: 'a b c',
      suppressHydrationWarning: true,
    })
    expect(htmlAttributes(getLocaleDef('hi'), 'x')).toEqual({
      lang: 'hi',
      dir: 'ltr',
      className: 'x',
      suppressHydrationWarning: true,
    })
  })

  it('gives ar right-to-left, so the RTL plumbing is tested without building /ar', () => {
    expect(htmlAttributes(getLocaleDef('ar'), 'x')).toEqual({
      lang: 'ar',
      dir: 'rtl',
      className: 'x',
      suppressHydrationWarning: true,
    })
  })

  it('takes lang and dir from the registry for every locale', () => {
    for (const def of LOCALES) {
      const attributes = htmlAttributes(def, '')
      expect([attributes.lang, attributes.dir]).toEqual([def.code, def.dir])
      expect(Object.keys(attributes).sort()).toEqual([
        'className',
        'dir',
        'lang',
        'suppressHydrationWarning',
      ])
    }
  })
})
