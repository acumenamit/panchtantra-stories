// Font files and licences (spec §6.7 Fonts, owner D7; P1-1b). The committed WOFF2 files and OFL
// texts match fonts.lock.json byte for byte, fonts/index.ts names exactly the locked files, and the
// faces cover the Hindi text the reader ships. Glyphs are read with next's bundled fontkit (an
// internal path, no new package: a Next upgrade that moves it fails here loudly, design R7).
// P1-2b (design p1-step8-design.md §2 fonts.test row, §5.6): the validator's RENDERED_SCRIPTS (T006)
// is pinned to the scripts these faces render.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RENDERED_SCRIPTS, scriptProblem } from '../../core/validator/text'

const here = dirname(fileURLToPath(import.meta.url))
const storyboard = resolve(here, '../../..')
const filesDir = join(here, 'files')

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const GitBlobSha1 = z.string().regex(/^[0-9a-f]{40}$/)
const Lock = z.strictObject({
  fonts: z.array(
    z.strictObject({
      file: z.string().regex(/^[a-z0-9-]+\.woff2$/),
      upstreamName: z.string().min(1),
      family: z.string().min(1),
      version: z.string().min(1),
      source: z.string().startsWith('https://'),
      bytes: z.number().int().positive(),
      sha256: Sha256,
      gitBlobSha1: GitBlobSha1.optional(),
      licence: z.string().startsWith('public/licenses/fonts/'),
    }),
  ),
  licences: z.array(
    z.strictObject({
      file: z.string().startsWith('public/licenses/fonts/'),
      upstreamName: z.string().min(1),
      source: z.string().startsWith('https://'),
      lineEndings: z.literal('LF'),
      bytes: z.number().int().positive(),
      sha256: Sha256,
      gitBlobSha1: GitBlobSha1.optional(),
    }),
  ),
})
const LOCK = Lock.parse(JSON.parse(readFileSync(join(filesDir, 'fonts.lock.json'), 'utf8')))

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
/** Git's blob id, computed without git: sha1("blob <size>\0" + bytes). */
const gitBlobSha1 = (bytes: Buffer): string =>
  createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex')

interface FontkitFont {
  readonly familyName: string
  readonly variationAxes: Readonly<Record<string, { readonly min: number; readonly max: number }>>
  hasGlyphForCodePoint(codePoint: number): boolean
}
// next has no "exports" map, so the deep path resolves; .default is fontkit's create(buffer).
const nodeRequire = createRequire(import.meta.url)
const fontkit = nodeRequire('next/dist/compiled/@next/font/dist/fontkit') as {
  readonly default: (buffer: Buffer) => FontkitFont
}
const openFont = (file: string): FontkitFont => fontkit.default(readFileSync(join(filesDir, file)))

/** The three localFont calls in fonts/index.ts, read as text (next/font only runs inside Next). */
interface FontCall {
  readonly files: readonly string[]
  readonly unicodeRange: string | null
}
function readFontCalls(): Record<string, FontCall> {
  const source = readFileSync(join(here, 'index.ts'), 'utf8')
  const calls: Record<string, FontCall> = {}
  for (const match of source.matchAll(/export const (\w+) = localFont\(\{([\s\S]*?)\n\}\)/g)) {
    const [, name = '', body = ''] = match
    calls[name] = {
      files: [...body.matchAll(/path: '\.\/files\/([^']+)'/g)].map((m) => m[1] ?? ''),
      unicodeRange: /prop: 'unicode-range',\s*value:\s*'([^']+)'/.exec(body)?.[1] ?? null,
    }
  }
  return calls
}
const CALLS = readFontCalls()

type Range = readonly [number, number]
function parseUnicodeRange(text: string): Range[] {
  return text.split(',').map((part) => {
    const match = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i.exec(part.trim())
    if (!match?.[1]) throw new Error(`Bad unicode-range part: ${part}`)
    const start = Number.parseInt(match[1], 16)
    return [start, match[2] ? Number.parseInt(match[2], 16) : start] as const
  })
}
const inRanges = (ranges: readonly Range[], cp: number): boolean =>
  ranges.some(([start, end]) => cp >= start && cp <= end)

function rangesOf(name: string): Range[] {
  const range = CALLS[name]?.unicodeRange
  if (!range) throw new Error(`${name} has no unicode-range`)
  return parseUnicodeRange(range)
}

function filesOf(name: string): readonly string[] {
  const files = CALLS[name]?.files
  if (!files || files.length === 0) throw new Error(`${name} names no files`)
  return files
}

/** Fontsource 5.3.0 400.css (Google's subset ranges), design §5.1. */
const DEVANAGARI_RANGE =
  'U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B09'
const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

// ---------------------------------------------------------------------------------------------
// The Hindi text to cover (read only): fixture `hi` strings, the 11 legacy stories, a UI sample.

function hiStrings(value: unknown, inHi = false): string[] {
  if (typeof value === 'string') return inHi ? [value] : []
  if (Array.isArray(value)) return value.flatMap((v) => hiStrings(v, inHi))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) => hiStrings(v, inHi || key === 'hi'))
  }
  return []
}

const fixturesDir = join(storyboard, 'fixtures/packages')
const FIXTURE_HI = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => hiStrings(JSON.parse(readFileSync(join(fixturesDir, f), 'utf8'))))

// As tools/migrate/validate-legacy.test.ts: the legacy app (read only) one level above storyboard.
const legacyDir = join(storyboard, '../pt/src/stories')
const LEGACY_SOURCES = readdirSync(legacyDir)
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((file) => ({ file, source: readFileSync(join(legacyDir, file), 'utf8') }))
const LEGACY_DEVANAGARI = new Set(
  LEGACY_SOURCES.flatMap(({ source }) => [...source.matchAll(/[ऀ-ॿ]/gu)]).map(
    (m) => m[0].codePointAt(0) ?? 0,
  ),
)

/** A `hi:` key and its string literal value (quoted or a template with no substitution). */
const LEGACY_HI_ENTRY =
  /\bhi\s*:\s*(`(?:[^`\\]|\\[\s\S])*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g

/** A JS string literal's value: the escapes the legacy stories use (\n, \', \uXXXX …) decoded. */
function literalValue(literal: string): string {
  return literal
    .slice(1, -1)
    .replace(
      /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
      (_, escape: string) => {
        if (escape.startsWith('u'))
          return String.fromCodePoint(Number.parseInt(escape.replace(/[u{}]/g, ''), 16))
        if (escape.startsWith('x')) return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
        const named: Record<string, string> = {
          n: '\n',
          t: '\t',
          r: '\r',
          b: '\b',
          f: '\f',
          v: '\v',
        }
        return named[escape] ?? escape
      },
    )
}

/**
 * Every `hi` string of the 11 legacy stories, read as text (the files are never executed here).
 * Each `hi:` key must have a literal value with no `${}`, so a change of shape fails loudly.
 */
const LEGACY_HI = LEGACY_SOURCES.flatMap(({ file, source }) => {
  const keys = source.match(/\bhi\s*:/g)?.length ?? 0
  const literals = [...source.matchAll(LEGACY_HI_ENTRY)].map((m) => m[1] ?? '')
  if (literals.length !== keys) {
    throw new Error(`${file}: ${keys} hi keys but ${literals.length} string literals`)
  }
  if (literals.some((l) => l.startsWith('`') && l.includes('${'))) {
    throw new Error(`${file}: a hi template literal has a substitution`)
  }
  return literals.map(literalValue)
})

/**
 * Code points in the legacy `hi` strings that no shipped face covers: 琥珀 (U+7425 U+73C0, CJK) in
 * the crow story's Hindi text (pt/src/stories/crowAndSerpent.js, node seek_advice, "उसकी琥珀रंगी
 * आँखें"). Neither Noto subset has them, so they fall to a system CJK font, or to tofu. Design
 * R18 says none occur; this is open for the owner or lead at the Step 8 import, and story text is
 * never edited here. Listed so the gap stays visible: a new uncovered code point fails the test.
 */
const KNOWN_UNCOVERED_LEGACY = [0x73c0, 0x7425]

/** Named by design §8 unit 4. U+00B7 is not in today's legacy hi strings; it stays checked. */
const DESIGN_NAMED = [0x00b7, 0x2013]

/** The Unicode blocks of the Devanagari script: Devanagari, Vedic Extensions, Extended, Extended-A. */
const DEVANAGARI_BLOCKS: readonly Range[] = [
  [0x0900, 0x097f],
  [0x1cd0, 0x1cff],
  [0xa8e0, 0xa8ff],
  [0x11b00, 0x11b5f],
]

const UI_SAMPLE = ['हिन्दी', 'पञ्चतन्त्र सिखाता है:', '०१२३४५६७८९', '०-९', '।']

/** The Hindi UI messages (P1-1c, design p1-step7-design.md §6.3, §8.1 item 4), read as text. */
const MESSAGES_HI = Object.values(
  JSON.parse(readFileSync(join(storyboard, 'messages/hi.json'), 'utf8')) as Record<string, unknown>,
).map(String)

const isEmojiPart = (cp: number): boolean =>
  /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp)) ||
  cp === 0xfe0e ||
  cp === 0xfe0f ||
  cp === 0x20e3 ||
  (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
  (cp >= 0x1f1e6 && cp <= 0x1f1ff) ||
  (cp >= 0xe0020 && cp <= 0xe007f)

const codePointsOf = (texts: readonly string[]): Set<number> =>
  new Set(texts.flatMap((t) => [...t].map((ch) => ch.codePointAt(0) ?? 0)))

const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`

describe('font files', () => {
  it('holds exactly the locked files and the lock file', () => {
    expect(readdirSync(filesDir).sort()).toEqual(
      [...LOCK.fonts.map((f) => f.file), 'fonts.lock.json'].sort(),
    )
    expect(LOCK.fonts).toHaveLength(5)
  })

  it.each(LOCK.fonts.map((f) => [f.file, f] as const))(
    '%s is a WOFF2 file with the locked bytes and SHA-256',
    (_file, entry) => {
      const bytes = readFileSync(join(filesDir, entry.file))
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2')
      expect(bytes.length).toBe(entry.bytes)
      expect(sha256(bytes)).toBe(entry.sha256)
      if (entry.gitBlobSha1 !== undefined) expect(gitBlobSha1(bytes)).toBe(entry.gitBlobSha1)
      expect(LOCK.licences.map((l) => l.file)).toContain(entry.licence)
    },
  )

  it('pins Lora by its upstream git blob id', () => {
    const lora = LOCK.fonts.find((f) => f.file === 'lora-wght.woff2')
    expect(lora?.gitBlobSha1).toBe('7e885a1676bad370739a4174664708059446b115')
    expect(LOCK.fonts.reduce((sum, f) => sum + f.bytes, 0)).toBe(209_788)
  })

  it('fonts/index.ts names exactly the locked files', () => {
    expect(Object.keys(CALLS).sort()).toEqual(['devanagari', 'devanagariLatin', 'lora'])
    expect(
      Object.values(CALLS)
        .flatMap((c) => c.files)
        .sort(),
    ).toEqual(LOCK.fonts.map((f) => f.file).sort())
  })

  it('declares the Fontsource 5.3.0 unicode-ranges on the two Noto faces and none on Lora', () => {
    expect(CALLS['lora']?.unicodeRange).toBeNull()
    expect(rangesOf('devanagari')).toEqual(parseUnicodeRange(DEVANAGARI_RANGE))
    expect(rangesOf('devanagariLatin')).toEqual(parseUnicodeRange(LATIN_RANGE))
  })
})

describe('font licences', () => {
  it.each(LOCK.licences.map((l) => [l.file, l] as const))(
    '%s has the locked bytes and SHA-256, stored LF',
    (_file, entry) => {
      const bytes = readFileSync(join(storyboard, entry.file))
      expect(bytes.length).toBe(entry.bytes)
      expect(sha256(bytes)).toBe(entry.sha256)
      if (entry.gitBlobSha1 !== undefined) expect(gitBlobSha1(bytes)).toBe(entry.gitBlobSha1)
      expect(bytes.includes(0x0d)).toBe(false)
      expect(bytes.toString('utf8')).toContain('SIL Open Font License, Version 1.1')
    },
  )

  it('keeps the copyright lines and Lora’s Reserved Font Name', () => {
    const lora = readFileSync(join(storyboard, 'public/licenses/fonts/Lora-OFL.txt'), 'utf8')
    expect(lora.split('\n')[0]).toBe(
      'Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic), with Reserved Font Name "Lora".',
    )
    const noto = readFileSync(
      join(storyboard, 'public/licenses/fonts/NotoSansDevanagari-OFL.txt'),
      'utf8',
    )
    expect(noto.split('\n')[0]).toBe(
      'Copyright 2022 The Noto Project Authors (https://github.com/notofonts/devanagari)',
    )
    expect(noto).not.toContain('with Reserved Font Name')
  })

  it('gives each font a licence that is served from public/', () => {
    expect(new Set(LOCK.fonts.map((f) => f.licence))).toEqual(
      new Set(LOCK.licences.map((l) => l.file)),
    )
  })
})

describe('glyph coverage', () => {
  it('Lora is the unmodified variable face with a 400-700 weight axis', () => {
    const lora = openFont('lora-wght.woff2')
    expect(lora.familyName).toBe('Lora')
    expect(lora.variationAxes['wght']).toMatchObject({ min: 400, max: 700 })
  })

  it('reads every hi string of the 11 legacy stories', () => {
    expect(LEGACY_SOURCES.filter(({ file }) => file !== 'index.js')).toHaveLength(11)
    expect(LEGACY_HI.length).toBeGreaterThan(300)
    expect(LEGACY_HI).toContain('कौआ और साँप')
  })

  it('the Devanagari faces cover every Devanagari code point in fixtures, legacy stories and UI', () => {
    const ranges = rangesOf('devanagari')
    // Every Devanagari-script code point in the Hindi strings, whether or not the face claims it.
    const fromStrings = [...codePointsOf([...FIXTURE_HI, ...LEGACY_HI, ...UI_SAMPLE])].filter(
      (cp) => inRanges(DEVANAGARI_BLOCKS, cp),
    )
    const needed = new Set([...fromStrings, ...LEGACY_DEVANAGARI])
    expect(fromStrings.length).toBeGreaterThan(40)
    expect(LEGACY_DEVANAGARI.size).toBeGreaterThan(40)
    // A code point outside the face's unicode-range never makes the browser download the face.
    expect([...needed].filter((cp) => !inRanges(ranges, cp)).map(hex)).toEqual([])
    for (const file of filesOf('devanagari')) {
      const font = openFont(file)
      expect(font.familyName).toBe('Noto Sans Devanagari')
      expect([...needed].filter((cp) => !font.hasGlyphForCodePoint(cp)).map(hex), file).toEqual([])
    }
  })

  it('the Latin-subset faces cover every other non-emoji code point in the Hindi strings', () => {
    const devanagariRanges = rangesOf('devanagari')
    const latinRanges = rangesOf('devanagariLatin')
    const others = (texts: readonly string[]): number[] =>
      [...codePointsOf(texts)].filter(
        (cp) => cp >= 0x20 && !inRanges(devanagariRanges, cp) && !isEmojiPart(cp),
      )
    const fixtureAndUi = others([...FIXTURE_HI, ...UI_SAMPLE])
    const legacy = others(LEGACY_HI)
    // Space, ASCII punctuation and digits, and the em dash (design §8 unit 4); the legacy stories
    // add the en dash.
    expect(fixtureAndUi).toEqual(expect.arrayContaining([0x20, 0x3a, 0x3f, 0x2c, 0x2014]))
    expect(legacy).toEqual(expect.arrayContaining([0x20, 0x2013, 0x2014]))

    const fonts = filesOf('devanagariLatin').map((file) => ({ file, font: openFont(file) }))
    for (const { font } of fonts) expect(font.familyName).toBe('Noto Sans Devanagari')
    const covered = (cp: number): boolean =>
      inRanges(latinRanges, cp) && fonts.every(({ font }) => font.hasGlyphForCodePoint(cp))

    // Fixture, UI and design-named text: no exception at all.
    expect([...fixtureAndUi, ...DESIGN_NAMED].filter((cp) => !covered(cp)).map(hex)).toEqual([])
    // Legacy text: exactly the known gap, so a new uncovered code point fails here.
    expect(
      legacy
        .filter((cp) => !covered(cp))
        .sort((a, b) => a - b)
        .map(hex),
    ).toEqual(KNOWN_UNCOVERED_LEGACY.map(hex))
    for (const { file, font } of fonts) {
      const missing = [...new Set([...fixtureAndUi, ...legacy, ...DESIGN_NAMED])].filter(
        (cp) => !KNOWN_UNCOVERED_LEGACY.includes(cp) && !font.hasGlyphForCodePoint(cp),
      )
      expect(missing.map(hex), file).toEqual([])
    }
  })

  it('covers every messages/hi.json value with the shipped Devanagari and Latin-subset faces', () => {
    const devanagariRanges = rangesOf('devanagari')
    const latinRanges = rangesOf('devanagariLatin')
    expect(MESSAGES_HI).toHaveLength(29)
    const codePoints = [...codePointsOf(MESSAGES_HI)]
    // Inside a unicode-range, so the browser downloads the face that has the glyph.
    expect(
      codePoints.filter((cp) => !inRanges(devanagariRanges, cp) && !inRanges(latinRanges, cp)),
    ).toEqual([])
    // --font-hindi lists the Devanagari face first; the Latin subset takes everything else.
    const devanagariFonts = filesOf('devanagari').map((file) => ({ file, font: openFont(file) }))
    const latinFonts = filesOf('devanagariLatin').map((file) => ({ file, font: openFont(file) }))
    const viaDevanagari = codePoints.filter((cp) => inRanges(devanagariRanges, cp))
    const viaLatin = codePoints.filter((cp) => !inRanges(devanagariRanges, cp))
    expect(viaDevanagari.length).toBeGreaterThan(40)
    expect(viaLatin).toEqual(expect.arrayContaining([0x20, 0x28, 0x29, 0x2c, 0x3a]))
    for (const { file, font } of devanagariFonts) {
      expect(viaDevanagari.filter((cp) => !font.hasGlyphForCodePoint(cp)).map(hex), file).toEqual(
        [],
      )
    }
    for (const { file, font } of latinFonts) {
      expect(viaLatin.filter((cp) => !font.hasGlyphForCodePoint(cp)).map(hex), file).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------------------------
// T006 (design p1-step8-design.md §2 fonts.test row, §5.6, R17; P1-2b). RENDERED_SCRIPTS names the
// scripts the shipped faces render, not every script they cover: Lora also has Cyrillic, which is
// deliberately not a rendered script, and Lora lacks many rarer Latin letters, so T006 stays
// script-level and this file stays the glyph guard. Adding a script means updating both.

const codeRange = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i)
const isMatch =
  (pattern: RegExp) =>
  (cp: number): boolean =>
    pattern.test(String.fromCodePoint(cp))
const t006Hits = (cps: readonly number[]): string[] =>
  cps.filter((cp) => scriptProblem(String.fromCodePoint(cp)) !== null).map(hex)

describe('rendered scripts (T006)', () => {
  it('pins RENDERED_SCRIPTS to exactly Latin and Devanagari', () => {
    expect(RENDERED_SCRIPTS).toEqual(['Latn', 'Deva'])
  })

  it('Latin: every letter of U+0041-005A, U+0061-007A and U+00C0-00FF is in Lora and inside the Noto Latin subset', () => {
    const letters = [
      ...codeRange(0x41, 0x5a),
      ...codeRange(0x61, 0x7a),
      ...codeRange(0xc0, 0xff),
    ].filter(isMatch(/^\p{L}$/u))
    // 26 + 26 + 62: U+00D7 and U+00F7 are not letters.
    expect(letters).toHaveLength(114)
    expect(letters.filter((cp) => !isMatch(/^\p{scx=Latn}$/u)(cp)).map(hex)).toEqual([])
    expect(t006Hits(letters)).toEqual([])
    const lora = openFont('lora-wght.woff2')
    expect(letters.filter((cp) => !lora.hasGlyphForCodePoint(cp)).map(hex)).toEqual([])
    const latinRanges = rangesOf('devanagariLatin')
    expect(letters.filter((cp) => !inRanges(latinRanges, cp)).map(hex)).toEqual([])
    for (const file of filesOf('devanagariLatin')) {
      const font = openFont(file)
      expect(letters.filter((cp) => !font.hasGlyphForCodePoint(cp)).map(hex), file).toEqual([])
    }
  })

  it('Devanagari: every letter, mark and digit Unicode assigns in U+0900-097F is in both Noto Sans Devanagari files', () => {
    const assigned = codeRange(0x900, 0x97f).filter(isMatch(/^[\p{L}\p{M}\p{N}]$/u))
    expect(assigned).toHaveLength(125)
    expect(t006Hits(assigned)).toEqual([])
    const ranges = rangesOf('devanagari')
    expect(assigned.filter((cp) => !inRanges(ranges, cp)).map(hex)).toEqual([])
    const files = filesOf('devanagari')
    expect(files).toHaveLength(2)
    for (const file of files) {
      const font = openFont(file)
      expect(font.familyName).toBe('Noto Sans Devanagari')
      expect(assigned.filter((cp) => !font.hasGlyphForCodePoint(cp)).map(hex), file).toEqual([])
    }
  })
})
