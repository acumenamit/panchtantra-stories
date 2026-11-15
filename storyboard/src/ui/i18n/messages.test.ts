// The UI message catalogues (P1 D8; design p1-step7-design.md §3.4, §6.1, §6.3, §6.5, §6.6,
// §8.1 item 4; P1-1c). The JSON files are read as text with readFileSync (raw key order; only
// messages.ts imports them): the 16 keys, parity and order, the ICU subset, argument and plural
// parity, the house style, t(), and every key referenced in app/ or src/. Glyph coverage of the
// Hindi values is in src/ui/fonts/fonts.test.ts.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseMessage, strictestKinds, type ParsedMessage } from '../../core/i18n/message-format'
import { ROOT_METADATA } from '../root/metadata'
import { argumentKinds, hasMessages, translator, type MessageKey } from './messages'

const here = dirname(fileURLToPath(import.meta.url))
const messagesDir = join(here, '../../../messages')
const LOCALES = ['en', 'hi'] as const
type Locale = (typeof LOCALES)[number]

const RAW: Readonly<Record<Locale, string>> = {
  en: readFileSync(join(messagesDir, 'en.json'), 'utf8'),
  hi: readFileSync(join(messagesDir, 'hi.json'), 'utf8'),
}
const CATALOGUE: Readonly<Record<Locale, Readonly<Record<string, unknown>>>> = {
  en: JSON.parse(RAW.en) as Record<string, unknown>,
  hi: JSON.parse(RAW.hi) as Record<string, unknown>,
}
const KEYS = Object.keys(CATALOGUE.en)

/** Every value of one catalogue as [key, text]; a non-string value fails the shape test. */
const entries = (locale: Locale): [string, string][] =>
  Object.entries(CATALOGUE[locale]).map(([key, value]) => [key, String(value)])
const ALL = LOCALES.flatMap((locale) =>
  entries(locale).map(([key, text]) => [locale, key, text] as const),
)

/** Design §6.3: the 16 keys Step 7 renders, sorted. */
const DESIGN_KEYS = [
  'gate.prompt',
  'gate.remember',
  'grownUps.placeholder',
  'grownUps.title',
  'header.changeLanguage',
  'header.grownUps',
  'header.navLabel',
  'home.placeholder',
  'home.title',
  'meta.description',
  'notFound.body',
  'notFound.link',
  'notFound.title',
  'shell.skipToMain',
  'storage.body',
  'storage.title',
]

const SURFACES = ['meta', 'gate', 'shell', 'header', 'home', 'grownUps', 'storage', 'notFound']

/** Each plural in the message as [argument, selectors]. */
function plurals(message: ParsedMessage): [string, string[]][] {
  return message.parts.flatMap((part) =>
    part.type === 'plural' ? [[part.name, [...part.branches.keys()]] as [string, string[]]] : [],
  )
}

/** What a plural misses: a CLDR category of the locale, or (Hindi) an explicit =0 (design §6.5). */
function pluralProblems(locale: string, message: ParsedMessage): string[] {
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
  return plurals(message).flatMap(([name, selectors]) => [
    ...categories.filter((c) => !selectors.includes(c)).map((c) => `${name}: no ${c}`),
    ...(locale === 'hi' && !selectors.includes('=0') ? [`${name}: no =0`] : []),
  ])
}

describe('message catalogues: shape', () => {
  it('hold exactly the 16 keys of design §6.3, sorted, in the same order in both files', () => {
    expect(KEYS).toEqual(DESIGN_KEYS)
    expect(Object.keys(CATALOGUE.hi)).toEqual(KEYS)
    expect([...KEYS].sort()).toEqual(KEYS)
  })

  it('use flat dotted keys <surface>.<item> in camelCase', () => {
    for (const key of KEYS) {
      expect(key).toMatch(/^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/)
      expect(SURFACES).toContain(key.split('.')[0])
    }
  })

  it('hold one non-empty string per key', () => {
    for (const locale of LOCALES) {
      for (const value of Object.values(CATALOGUE[locale])) {
        expect(typeof value).toBe('string')
        expect(value).not.toBe('')
      }
    }
  })

  it('are written as Prettier writes them: two-space JSON with a final newline', () => {
    for (const locale of LOCALES) {
      expect(RAW[locale]).toBe(`${JSON.stringify(CATALOGUE[locale], null, 2)}\n`)
    }
  })
})

describe('message catalogues: the ICU subset', () => {
  it('parse within the subset, every value', () => {
    for (const [locale, key, text] of ALL) {
      expect(() => parseMessage(text), `${locale} ${key}`).not.toThrow()
    }
  })

  it('use the same argument names per key in both languages', () => {
    for (const key of KEYS) {
      const names = (locale: Locale): string[] =>
        [...parseMessage(String(CATALOGUE[locale][key])).args.keys()].sort()
      expect(names('hi'), key).toEqual(names('en'))
    }
  })

  it('state every plural category of each locale, and =0 in Hindi', () => {
    for (const [locale, key, text] of ALL) {
      expect(pluralProblems(locale, parseMessage(text)), `${locale} ${key}`).toEqual([])
    }
  })

  it('the plural check catches a missing category or =0 (the design §6.5 pattern)', () => {
    const good =
      '{found, plural, =0 {अभी कोई अंत नहीं मिला} one {{total} में से # अंत मिला} other {{total} में से # अंत मिले}}'
    expect(pluralProblems('hi', parseMessage(good))).toEqual([])
    expect(pluralProblems('hi', parseMessage('{n, plural, one {#} other {#}}'))).toEqual([
      'n: no =0',
    ])
    expect(pluralProblems('hi', parseMessage('{n, plural, =0 {-} other {#}}'))).toEqual([
      'n: no one',
    ])
    expect(pluralProblems('en', parseMessage('{n, plural, other {#}}'))).toEqual(['n: no one'])
  })
})

describe('message catalogues: house style (design §3.4)', () => {
  it('are NFC, with no leading or trailing space', () => {
    for (const [locale, key, text] of ALL) {
      expect(text.normalize('NFC'), `${locale} ${key}`).toBe(text)
      expect(text.trim(), `${locale} ${key}`).toBe(text)
    }
  })

  it('use no ASCII apostrophe (English uses ’ U+2019)', () => {
    for (const [locale, key, text] of ALL) expect(text, `${locale} ${key}`).not.toContain("'")
    expect(CATALOGUE.en['notFound.body']).toContain('isn’t')
    expect(CATALOGUE.en['storage.title']).toContain('isn’t')
  })

  it('hold no arrows, icons or emoji', () => {
    for (const [locale, key, text] of ALL) {
      expect(text, `${locale} ${key}`).not.toMatch(/[←-⇿]|\p{Extended_Pictographic}/u)
    }
  })

  it('hold no Latin letters in Hindi', () => {
    for (const [key, text] of entries('hi')) expect(text, key).not.toMatch(/[A-Za-z]/)
  })

  it('spell हिन्दी and कहानियाँ (never हिंदी or कहानियां)', () => {
    for (const [key, text] of entries('hi')) {
      expect(text, key).not.toContain('हिंदी')
      expect(text, key).not.toContain('कहानियां')
    }
    expect(CATALOGUE.hi['home.title']).toBe('कहानियाँ')
  })

  it('keep the "/" description of today in English', () => {
    expect(CATALOGUE.en['meta.description']).toBe(ROOT_METADATA.description)
  })
})

describe('message catalogues: every key is used', () => {
  /** The non-test .ts and .tsx sources under app/ and src/, as text. */
  function codeUnder(dir: string): string[] {
    const storyboard = join(here, '../../..')
    const texts: string[] = []
    const visit = (absolute: string): void => {
      if (!existsSync(absolute)) return
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        const path = join(absolute, entry.name)
        if (entry.isDirectory()) visit(path)
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          texts.push(readFileSync(path, 'utf8'))
        }
      }
    }
    visit(join(storyboard, dir))
    return texts
  }

  it('references every key as a string literal somewhere in app/ or src/', () => {
    const app = codeUnder('app')
    const src = codeUnder('src')
    // A scan that finds no source files would pass vacuously.
    expect(app.length).toBeGreaterThan(5)
    expect(src.length).toBeGreaterThan(50)
    const code = [...app, ...src].join('\n')
    const unused = KEYS.filter((key) => !code.includes(`'${key}'`) && !code.includes(`"${key}"`))
    expect(unused).toEqual([])
  })
})

describe('messages.ts', () => {
  it('starts with the server-only marker', () => {
    const source = readFileSync(join(here, 'messages.ts'), 'utf8')
    expect(source.split('\n')[0]).toBe("import 'server-only'")
  })

  it('t() returns every value of both catalogues unchanged (no message takes arguments yet)', () => {
    for (const locale of LOCALES) {
      const t = translator(locale)
      for (const [key, text] of entries(locale)) {
        expect(t(key as MessageKey)).toBe(text)
        expect(t(key as MessageKey)).toBe(text)
      }
    }
  })

  it('t() throws on an extra argument, an unknown key and a locale without messages', () => {
    const t = translator('en')
    expect(() => t('home.title', { n: 1 })).toThrow('unexpected argument "n"')
    expect(() => t('nope.key' as MessageKey)).toThrow('unknown message key "nope.key"')
    expect(() => t('__proto__' as MessageKey)).toThrow('unknown message key')
    expect(() => translator('ar')).toThrow('no UI messages for locale "ar"')
    expect(hasMessages('en') && hasMessages('hi')).toBe(true)
    expect(hasMessages('ar') || hasMessages('constructor')).toBe(false)
  })

  it('argumentKinds takes the stricter kind of the two languages', () => {
    for (const key of KEYS as MessageKey[]) {
      expect([...argumentKinds(key)]).toEqual([
        ...strictestKinds(
          parseMessage(String(CATALOGUE.en[key])).args,
          parseMessage(String(CATALOGUE.hi[key])).args,
        ),
      ])
    }
  })
})
