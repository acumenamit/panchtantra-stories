// Self-hosted fonts at work (spec §6.7 Fonts, owner D7; P1-1b, design §8 E2E 3). Fixture Hindi
// (lang="hi") and English text is injected into / (no new route): Hindi loads the Noto Sans
// Devanagari faces by unicode-range, bold Hindi loads the 700 faces, the faces keep the display
// and unicode-range the build was given, conjuncts are shaped, and (Chromium, through CDP) each
// script renders in its own face while emoji fall through to a system font.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  ALL_CODE_POINTS,
  codePointRanges,
  DEVANAGARI_RANGE,
  fixtureText,
  fontFamilies,
  LATIN_SUBSET_RANGE,
  reportedFaces,
  servedFontFaces,
  settleFonts,
} from './page-helpers'

const HINDI = fixtureText('hi')
const ENGLISH = fixtureText('en')
// Devanagari letters and matras, ASCII punctuation and spaces, the em dash and the danda.
const HINDI_SAMPLE = [HINDI.title, HINDI.book, HINDI.passage, HINDI.question, HINDI.ending].join(
  ' ',
)
const ENGLISH_SAMPLE = [ENGLISH.title, ENGLISH.passage, ENGLISH.question].join(' ')
// The story's own emoji (two-paths.json "emoji"), a single code point outside every subset.
const EMOJI = '🦊'

/** Appends an element with `text` to <body>, outside <main> (see INJECTION in ./page-helpers). */
async function inject(
  page: Page,
  { id, tag, lang, text }: { id: string; tag: string; lang: string; text: string },
): Promise<void> {
  await page.evaluate(
    ({ id, tag, lang, text }) => {
      const element = document.createElement(tag)
      element.id = id
      element.lang = lang
      element.textContent = text
      document.body.append(element)
    },
    { id, tag, lang, text },
  )
}

/** document.fonts.check(font, text) in the page. */
async function fontsCheck(page: Page, font: string, text: string): Promise<boolean> {
  return page.evaluate((args) => document.fonts.check(args.font, args.text), { font, text })
}

/** The status of each face of `family`, by weight. */
async function statuses(page: Page, family: string): Promise<Record<string, string>> {
  const faces = (await reportedFaces(page)).filter((face) => face.family === family)
  return Object.fromEntries(faces.map((face) => [face.weight, face.status]))
}

test('Hindi loads the Devanagari and Latin-subset 400 faces; bold Hindi loads the 700 faces', async ({
  page,
  request,
}) => {
  const requested: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'font') requested.push(new URL(request.url()).pathname)
  })
  await page.goto('/')
  await settleFonts(page)
  const families = await fontFamilies(page)
  // The file of each face, from the served CSS: family and weight to path.
  const faces = await servedFontFaces(page, request)
  const fileOf = new Map(
    faces.map((face) => [`${face.family} ${face.rule['font-weight']}`, face.urls[0]?.pathname]),
  )
  const loraFiles = faces
    .filter((face) => face.family === families.lora)
    .map((face) => face.urls[0]?.pathname)
  const files = (weight: string) =>
    [families.devanagari, families.devanagariLatin].map((family) => {
      const file = fileOf.get(`${family} ${weight}`)
      if (!file) throw new Error(`no @font-face for ${family} ${weight}`)
      return file
    })
  const notoRequests = () => requested.filter((path) => !loraFiles.includes(path)).sort()
  expect(notoRequests()).toEqual([])
  expect(await statuses(page, families.devanagari)).toEqual({ 400: 'unloaded', 700: 'unloaded' })
  expect(await statuses(page, families.devanagariLatin)).toEqual({
    400: 'unloaded',
    700: 'unloaded',
  })

  await inject(page, { id: 'e2e-hi', tag: 'p', lang: 'hi', text: HINDI_SAMPLE })
  await settleFonts(page)
  expect(await statuses(page, families.devanagari)).toEqual({ 400: 'loaded', 700: 'unloaded' })
  expect(await statuses(page, families.devanagariLatin)).toEqual({
    400: 'loaded',
    700: 'unloaded',
  })
  const regular = `400 20px ${families.devanagari}, ${families.devanagariLatin}`
  expect(await fontsCheck(page, regular, HINDI_SAMPLE)).toBe(true)
  expect(notoRequests()).toEqual(files('400').sort())

  await inject(page, { id: 'e2e-hi-bold', tag: 'h2', lang: 'hi', text: HINDI_SAMPLE })
  await settleFonts(page)
  expect(await statuses(page, families.devanagari)).toEqual({ 400: 'loaded', 700: 'loaded' })
  expect(await statuses(page, families.devanagariLatin)).toEqual({ 400: 'loaded', 700: 'loaded' })
  const bold = `700 20px ${families.devanagari}, ${families.devanagariLatin}`
  expect(await fontsCheck(page, bold, HINDI_SAMPLE)).toBe(true)

  expect(notoRequests()).toEqual([...files('400'), ...files('700')].sort())
})

test('the faces keep their font-display and unicode-range', async ({ page, request }) => {
  await page.goto('/')
  const families = await fontFamilies(page)

  // The served CSS (every engine): Lora swap with no range, both Noto families fallback with the
  // design's ranges, and a Lora fallback face only.
  const rules = (await servedFontFaces(page, request)).map((face) => face.rule)
  const byFamily = (family: string) => rules.filter((rule) => rule['font-family'] === family)
  const lora = byFamily(families.lora)
  expect(lora).toHaveLength(1)
  expect(lora[0]?.['font-display']).toBe('swap')
  expect(lora[0]?.['unicode-range']).toBeUndefined()
  for (const [family, range] of [
    [families.devanagari, DEVANAGARI_RANGE],
    [families.devanagariLatin, LATIN_SUBSET_RANGE],
  ] as const) {
    const faces = byFamily(family)
    expect(faces.map((face) => face['font-weight']).sort(), family).toEqual(['400', '700'])
    for (const face of faces) {
      expect(face['font-display'], family).toBe('fallback')
      expect(codePointRanges(face['unicode-range'] ?? ''), family).toEqual(codePointRanges(range))
    }
  }
  expect(byFamily(families.loraFallback)).toHaveLength(1)
  expect(rules.map((rule) => rule['font-family']).sort()).toEqual(
    [
      families.lora,
      families.loraFallback,
      families.devanagari,
      families.devanagari,
      families.devanagariLatin,
      families.devanagariLatin,
    ].sort(),
  )

  // What document.fonts reports. display only where FontFace has it.
  const reported = await reportedFaces(page)
  const expected = [
    { family: families.lora, display: 'swap', range: ALL_CODE_POINTS, count: 1 },
    { family: families.devanagari, display: 'fallback', range: DEVANAGARI_RANGE, count: 2 },
    { family: families.devanagariLatin, display: 'fallback', range: LATIN_SUBSET_RANGE, count: 2 },
  ]
  let displayChecked = false
  for (const { family, display, range, count } of expected) {
    const faces = reported.filter((face) => face.family === family)
    expect(faces, family).toHaveLength(count)
    for (const face of faces) {
      expect(codePointRanges(face.unicodeRange), family).toEqual(codePointRanges(range))
      if (face.display !== null) {
        expect(face.display, family).toBe(display)
        displayChecked = true
      }
    }
  }
  if (!displayChecked) {
    test.info().annotations.push({
      type: 'info',
      description: 'FontFace has no display here; font-display was checked in the served CSS only',
    })
  }
})

test('Devanagari conjuncts are shaped in the loaded face', async ({ page }) => {
  await page.goto('/')
  const { devanagari } = await fontFamilies(page)
  const result = await page.evaluate(async (family) => {
    const font = `400 48px ${family}`
    await document.fonts.load(font, 'क्ष')
    const context = document.createElement('canvas').getContext('2d')
    if (!context) throw new Error('no 2d canvas context')
    context.font = font
    return {
      loaded: document.fonts.check(font, 'क्ष'),
      conjunct: context.measureText('क्ष').width,
      split: context.measureText('क्‌ष').width,
    }
  }, devanagari)
  expect(result.loaded).toBe(true)
  expect(result.conjunct).toBeGreaterThan(0)
  expect(result.conjunct, `क्ष ${result.conjunct} against क्‌ष ${result.split}`).toBeLessThan(
    result.split,
  )
})

test('Chromium renders Hindi in Noto Sans Devanagari, English in Lora, emoji in a system font', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CSS.getPlatformFontsForNode is a Chromium CDP method')
  await page.goto('/')
  await inject(page, { id: 'e2e-hi', tag: 'p', lang: 'hi', text: HINDI_SAMPLE })
  await inject(page, { id: 'e2e-en', tag: 'p', lang: 'en', text: ENGLISH_SAMPLE })
  await inject(page, { id: 'e2e-emoji', tag: 'p', lang: 'en', text: EMOJI })
  await settleFonts(page)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
  const fontsOf = async (selector: string) => {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    return fonts
  }

  const hindi = await fontsOf('#e2e-hi')
  const english = await fontsOf('#e2e-en')
  const emoji = await fontsOf('#e2e-emoji')
  console.log(`[fonts] platform fonts: ${JSON.stringify({ hindi, english, emoji })}`)
  expect(hindi.length).toBeGreaterThan(0)
  for (const font of hindi) {
    expect(font, 'Hindi').toMatchObject({ familyName: 'Noto Sans Devanagari', isCustomFont: true })
  }
  expect(english.length).toBeGreaterThan(0)
  for (const font of english) {
    expect(font, 'English').toMatchObject({ familyName: 'Lora', isCustomFont: true })
  }
  expect(emoji.length).toBeGreaterThan(0)
  for (const font of emoji) {
    expect(font.isCustomFont, `emoji in ${font.familyName}`).toBe(false)
  }
})
