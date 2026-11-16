// The UI message catalogues (P1 D8; design p1-step7-design.md §3.4, §6.1, §6.3, §6.5, §6.6,
// §8.1 item 4; P1-1c). The JSON files are read as text with readFileSync (raw key order; only
// messages.ts imports them): the design keys, parity and order, the ICU subset, argument and plural
// parity, the house style, t(), and every key referenced in app/ or src/. Glyph coverage of the
// Hindi values is in src/ui/fonts/fonts.test.ts.
// P1-4b (design p1-step10-design.md §0.2, §9.1 G5): Step 10a adds the 4 player keys (owner drafts),
// the 'player' surface, an explicit table of the arguments each key takes, and a Latin check that
// reads only the parsed literal text, plural branches included (argument names are not text).
// Step 10b adds its 9 player keys (owner-approved as §0.2 drafts them) and two table entries:
// player.textSizeOption {percent, number} and player.progressValue {filled} {total}.
// Step 10c adds its 7 player keys (owner-approved as §0.2 drafts them) and one table entry:
// player.endingCount {found} {total}, a plural on found in Hindi (=0, one, other), so found is
// numeric and total any.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parseMessage,
  strictestKinds,
  type ArgKind,
  type ParsedMessage,
} from '../../core/i18n/message-format'
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

/**
 * Design §6.3: the 16 keys Step 7 renders, plus Step 10a's 4, Step 10b's 9 and Step 10c's 7 player
 * keys (p1-step10 §0.2), sorted.
 */
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
  'player.allStories',
  'player.altEnding',
  'player.back',
  'player.copyLink',
  'player.endingCount',
  'player.errorTitle',
  'player.keepReading',
  'player.lessonHeading',
  'player.linkCopied',
  'player.menu',
  'player.page',
  'player.progress',
  'player.progressValue',
  'player.restart',
  'player.restartQuestion',
  'player.share',
  'player.startThisAgain',
  'player.textSize',
  'player.textSizeOption',
  'player.tryAnother',
  'shell.skipToMain',
  'storage.body',
  'storage.title',
]

const SURFACES = [
  'meta',
  'gate',
  'shell',
  'header',
  'home',
  'grownUps',
  'storage',
  'notFound',
  'player',
]

/**
 * Design p1-step10 §9.1 G5: the arguments each key takes, with their kind; every other key takes
 * none. Each entry also gives sample values and what t() makes of them in each language.
 */
const ARGUMENTS: Readonly<
  Record<
    string,
    {
      readonly kinds: Readonly<Record<string, ArgKind>>
      readonly sample: Readonly<Record<string, number>>
      readonly formatted: Readonly<Record<Locale, string>>
    }
  >
> = {
  'player.endingCount': {
    kinds: { found: 'numeric', total: 'any' },
    sample: { found: 2, total: 3 },
    formatted: { en: 'Ending 2 of 3 found', hi: '3 में से 2 अंत मिले' },
  },
  'player.page': {
    kinds: { n: 'any' },
    sample: { n: 7 },
    formatted: { en: 'Page 7', hi: 'पेज 7' },
  },
  'player.progressValue': {
    kinds: { filled: 'any', total: 'any' },
    sample: { filled: 2, total: 5 },
    formatted: { en: '2 of 5', hi: '5 में से 2' },
  },
  'player.textSizeOption': {
    kinds: { percent: 'numeric' },
    sample: { percent: 125 },
    formatted: { en: '125%', hi: '125%' },
  },
}

/** Latin letters, ASCII and fullwidth (U+FF21-FF3A, U+FF41-FF5A). */
const LATIN = /[A-Za-zＡ-Ｚａ-ｚ]/

/** The literal text of a message, plural branches included; arguments and # are not text. */
function literalText(message: ParsedMessage): string {
  return message.parts
    .flatMap((part) => (part.type === 'plural' ? [...part.branches.values()].flat() : [part]))
    .map((part) => (part.type === 'text' ? part.value : ' '))
    .join('')
}

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
  it('hold exactly the design keys (Step 7 and Steps 10a to 10c), sorted, in the same order in both files', () => {
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

  it('hold no Latin letters in Hindi literal text (argument names are not text; G5)', () => {
    for (const [key, text] of entries('hi')) {
      expect(literalText(parseMessage(text)), key).not.toMatch(LATIN)
    }
  })

  it('the Latin check reads literal text only and catches every form (G5)', () => {
    const latinIn = (source: string): boolean => LATIN.test(literalText(parseMessage(source)))
    // Clean: argument names, # and plural syntax are not text.
    for (const source of [
      'पेज {n}',
      '{percent, number}%',
      '{found, plural, =0 {अभी कोई अंत नहीं मिला} one {{total} में से # अंत मिला} other {{total} में से # अंत मिले}}',
    ]) {
      expect(latinIn(source), source).toBe(false)
    }
    // Latin in plain text, inside a plural branch, inside =0, and fullwidth (upper and lower).
    for (const source of [
      'पेज a {n}',
      '{n, plural, =0 {कुछ नहीं} one {# page} other {# पेज}}',
      '{n, plural, =0 {none} one {#} other {#}}',
      'पेज Ａ',
      'पेज ｚ',
    ]) {
      expect(latinIn(source), source).toBe(true)
    }
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

  it('every key takes exactly the arguments of the table (G5), every other key none', () => {
    for (const key of Object.keys(ARGUMENTS)) expect(KEYS, key).toContain(key)
    for (const key of KEYS as MessageKey[]) {
      expect(Object.fromEntries(argumentKinds(key)), key).toEqual(ARGUMENTS[key]?.kinds ?? {})
    }
  })

  it('t() returns every value without arguments unchanged and formats the table keys', () => {
    for (const locale of LOCALES) {
      const t = translator(locale)
      for (const [key, text] of entries(locale)) {
        const args = ARGUMENTS[key]
        if (args === undefined) {
          expect(t(key as MessageKey)).toBe(text)
          expect(t(key as MessageKey)).toBe(text)
        } else {
          expect(t(key as MessageKey, args.sample), `${locale} ${key}`).toBe(args.formatted[locale])
          expect(() => t(key as MessageKey), `${locale} ${key}`).toThrow('missing argument')
        }
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
