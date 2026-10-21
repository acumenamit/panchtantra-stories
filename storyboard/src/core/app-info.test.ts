import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { APP_NAME, isSupportedLocale } from './app-info'

describe('app-info', () => {
  it('names the app', () => {
    expect(APP_NAME).toBe('Storyboard')
  })

  it('accepts only en and hi at launch', () => {
    expect(isSupportedLocale('en')).toBe(true)
    expect(isSupportedLocale('hi')).toBe(true)
    expect(isSupportedLocale('ar')).toBe(false)
  })

  it('rejects any string outside the launch locales', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== 'en' && s !== 'hi'),
        (s) => !isSupportedLocale(s),
      ),
    )
  })
})
