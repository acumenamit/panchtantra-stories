// Helpers shared by the P1-1b e2e specs (spec §6.6, §6.7, §10.2 E2E row; P1-1b): the served CSS
// and its @font-face rules, the font lock file, prefs seeding with a storage-write spy, keyboard
// focus, fixture text and the owner specimen. Not a spec: Playwright does not let one spec import
// another, so look, assets, fonts, text-scale and specimen all take these from here.
//
// INJECTION: the specs append test elements to <body>, never inside <main>. React may hydrate
// <main> after the load event that page.goto waits for, and an extra node inside it is a hydration
// mismatch: React then re-renders <main> and the injected node is gone (seen on webkit-iphone,
// first run 2026-11-14). React 19 skips extra nodes directly under <body> while hydrating.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { APIRequestContext, Page } from '@playwright/test'
import { declaredCustomProperties, lintCss } from '../scripts/lint/css-rules'
import { TEXT_SCALE_ATTRIBUTE } from '../src/core/progress/text-scale-boot'
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  serializePrefs,
  type TextScale,
} from '../src/core/progress/records'
import { expect } from './fixtures'

const ROOT = path.resolve(__dirname, '..')

// ---------------------------------------------------------------------------------------------
// Served CSS and its @font-face rules

/** One stylesheet the page links: its absolute URL and its text as served. */
export interface ServedSheet {
  readonly href: string
  readonly text: string
}

/** Every stylesheet the page links, fetched from the server (status 200 each). */
export async function servedSheets(page: Page, request: APIRequestContext): Promise<ServedSheet[]> {
  const hrefs = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href))
  expect(hrefs.length, 'stylesheet links on the page').toBeGreaterThan(0)
  const sheets: ServedSheet[] = []
  for (const href of hrefs) {
    const response = await request.get(href)
    expect(response.status(), href).toBe(200)
    sheets.push({ href, text: await response.text() })
  }
  return sheets
}

/** The text of every stylesheet the page links, joined. */
export async function servedCss(page: Page, request: APIRequestContext): Promise<string> {
  return (await servedSheets(page, request)).map((sheet) => sheet.text).join('\n')
}

/** One @font-face rule as served: descriptor name (lower case) to value. */
export type FontFaceRule = Readonly<Record<string, string>>

/** A served @font-face rule with its url() targets resolved against its own stylesheet. */
export interface ServedFace {
  readonly rule: FontFaceRule
  readonly family: string
  readonly urls: readonly URL[]
}

export async function servedFontFaces(
  page: Page,
  request: APIRequestContext,
): Promise<ServedFace[]> {
  return (await servedSheets(page, request)).flatMap((sheet) =>
    fontFaceRules(sheet.text).map((rule) => ({
      rule,
      family: rule['font-family'] ?? '',
      urls: srcUrls(rule['src'] ?? '').map((url) => new URL(url, sheet.href)),
    })),
  )
}

/** Every @font-face rule in `css`, with font-family unquoted. */
export function fontFaceRules(css: string): FontFaceRule[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => {
    const rule: Record<string, string> = {}
    for (const part of (match[1] ?? '').split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      const name = part.slice(0, colon).trim().toLowerCase()
      const value = part.slice(colon + 1).trim()
      rule[name] = name === 'font-family' ? unquote(value) : value
    }
    return rule
  })
}

/** The url() targets in an @font-face src value. */
export function srcUrls(src: string): string[] {
  return [...src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((match) => match[2] ?? '')
}

/** A family name without its quotes ("lora" and lora give lora). */
export function unquote(name: string): string {
  return name.trim().replace(/^(['"])(.*)\1$/, '$2')
}

/** The first family of a font-family list, unquoted. */
export function firstFamily(list: string): string {
  return unquote(list.split(',')[0] ?? '')
}

// ---------------------------------------------------------------------------------------------
// unicode-range, compared as code points: browsers and the CSS minifier serialise ranges
// differently (U+900-97F for U+0900-097F, U+?? for U+0000-00FF).

/** The design's Devanagari-subset range (design §5.1, Fontsource 5.3.0 400.css). */
export const DEVANAGARI_RANGE =
  'U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B09'
/** The design's Latin-subset range (design §5.1). */
export const LATIN_SUBSET_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
/** What a face without a unicode-range covers. */
export const ALL_CODE_POINTS = 'U+0-10FFFF'

/** A unicode-range value as sorted, merged [first, last] code-point pairs. */
export function codePointRanges(text: string): [number, number][] {
  const pairs = text.split(',').map((part): [number, number] => {
    const token = part.trim().toUpperCase()
    const match = /^U\+([0-9A-F?]{1,6})(?:-([0-9A-F]{1,6}))?$/.exec(token)
    if (!match || (match[1]?.includes('?') && match[2] !== undefined)) {
      throw new Error(`not a unicode-range part: ${JSON.stringify(part)}`)
    }
    const first = match[1] ?? ''
    if (first.includes('?')) {
      return [parseInt(first.replace(/\?/g, '0'), 16), parseInt(first.replace(/\?/g, 'F'), 16)]
    }
    return [parseInt(first, 16), parseInt(match[2] ?? first, 16)]
  })
  pairs.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [first, last] of pairs) {
    const previous = merged[merged.length - 1]
    if (previous && first <= previous[1] + 1) previous[1] = Math.max(previous[1], last)
    else merged.push([first, last])
  }
  return merged
}

// ---------------------------------------------------------------------------------------------
// Font files

/** One committed font file from src/ui/fonts/files/fonts.lock.json. */
export interface LockedFont {
  readonly file: string
  readonly bytes: number
  readonly sha256: string
}

export function lockedFonts(): LockedFont[] {
  const lock = JSON.parse(
    readFileSync(path.join(ROOT, 'src/ui/fonts/files/fonts.lock.json'), 'utf8'),
  ) as { fonts: LockedFont[] }
  return lock.fonts
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The served CSS's @font-face families, by the custom property next/font sets for each. */
export async function fontFamilies(
  page: Page,
): Promise<{ lora: string; loraFallback: string; devanagari: string; devanagariLatin: string }> {
  const values = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return ['--font-lora', '--font-devanagari', '--font-devanagari-latin'].map((name) =>
      style.getPropertyValue(name),
    )
  })
  const [lora = '', devanagari = '', devanagariLatin = ''] = values
  const loraList = lora.split(',').map(unquote)
  return {
    lora: loraList[0] ?? '',
    loraFallback: loraList[1] ?? '',
    devanagari: firstFamily(devanagari),
    devanagariLatin: firstFamily(devanagariLatin),
  }
}

/** What document.fonts reports for one face. display is null where FontFace has no display. */
export interface ReportedFace {
  readonly family: string
  readonly weight: string
  readonly status: string
  readonly unicodeRange: string
  readonly display: string | null
}

export async function reportedFaces(page: Page): Promise<ReportedFace[]> {
  const faces = await page.evaluate(() =>
    [...document.fonts].map((face) => ({
      family: face.family,
      weight: face.weight,
      status: face.status,
      unicodeRange: face.unicodeRange,
      display: 'display' in FontFace.prototype ? face.display : null,
    })),
  )
  return faces.map((face) => ({ ...face, family: unquote(face.family) }))
}

/** Waits for the next two frames and for every pending font load. */
export async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

// ---------------------------------------------------------------------------------------------
// Prefs and the text size

/** A valid prefs record, written as the reader writes it. */
export function prefsText(textScale: TextScale): string {
  return serializePrefs({ ...DEFAULT_PREFS, textScale })
}

/**
 * Before any page script: stores `raw` under the prefs key (null stores nothing), then counts
 * every later localStorage write, so a test can prove the page never writes (spec §6.3).
 * window.__e2eReadStored() reads the stored bytes even if a test breaks getItem afterwards.
 */
export async function seedPrefs(page: Page, raw: string | null): Promise<void> {
  await page.addInitScript(
    ({ key, raw }) => {
      const w = window as unknown as Record<string, unknown>
      let storage: Storage
      try {
        storage = window.localStorage
      } catch {
        return // an opaque origin (about:blank) has no storage
      }
      const proto = Storage.prototype
      const getItem = proto.getItem
      if (raw !== null) proto.setItem.call(storage, key, raw)
      const writes: string[] = []
      w['__e2eStorageWrites'] = writes
      w['__e2eReadStored'] = () => getItem.call(storage, key)
      for (const name of ['setItem', 'removeItem', 'clear'] as const) {
        const original = proto[name] as unknown as (...args: unknown[]) => unknown
        Object.defineProperty(proto, name, {
          configurable: true,
          writable: true,
          value: function (this: Storage, ...args: unknown[]) {
            writes.push(name)
            return original.apply(this, args)
          },
        })
      }
    },
    { key: PREFS_KEY, raw },
  )
}

/** The storage writes the page made, and the stored prefs bytes now. */
export async function storageAfter(page: Page): Promise<{ writes: string[]; stored: unknown }> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    const read = w['__e2eReadStored']
    return {
      writes: [...((w['__e2eStorageWrites'] as string[] | undefined) ?? ['spy missing'])],
      stored: typeof read === 'function' ? (read as () => string | null)() : 'reader missing',
    }
  })
}

/** What the page looked like when data-text-scale first appeared on <html>. */
export interface ScaleSeen {
  readonly value: string | null
  readonly bodyWasNull: boolean
  readonly paintEntries: number
}

/** Records the moment data-text-scale first appears (a MutationObserver from document start). */
export async function watchScaleAttribute(page: Page): Promise<void> {
  await page.addInitScript((attribute) => {
    const w = window as unknown as Record<string, unknown>
    w['__e2eScaleSeen'] = null
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName !== attribute || w['__e2eScaleSeen'] !== null) continue
        w['__e2eScaleSeen'] = {
          value: document.documentElement.getAttribute(attribute),
          bodyWasNull: document.body === null,
          paintEntries: performance.getEntriesByType('paint').length,
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: [attribute] })
  }, TEXT_SCALE_ATTRIBUTE)
}

export async function scaleSeen(page: Page): Promise<ScaleSeen | null> {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__e2eScaleSeen'] as ScaleSeen | null,
  )
}

// ---------------------------------------------------------------------------------------------
// Keyboard focus

/**
 * Presses Tab until `selector` has focus. WebKit, like Safari's default setting, may skip some
 * controls on a plain Tab (Playwright's WebKit skips links), so the WebKit projects press Alt+Tab
 * (design §8 E2E 5). Chromium ignores Alt+Tab, so it presses Tab. Focus only ever arrives by key.
 */
export async function focusByKeyboard(
  page: Page,
  browserName: string,
  selector: string,
): Promise<void> {
  const key = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  for (let press = 0; press < 20; press++) {
    await page.keyboard.press(key)
    const focused = await page.evaluate(
      (wanted) => document.activeElement?.matches(wanted) ?? false,
      selector,
    )
    if (focused) return
  }
  throw new Error(`${key} never focused ${selector}`)
}

// ---------------------------------------------------------------------------------------------
// Fixture text (fixtures/packages/two-paths.json, read only)

interface FixtureNode {
  readonly text: string
  readonly question?: string
  readonly choices?: Readonly<Record<string, string>>
}

/** One locale's fixture text for the specimen and the font checks. */
export interface FixtureText {
  readonly title: string
  readonly book: string
  readonly passage: string
  readonly question: string
  readonly choices: readonly [string, string]
  readonly action: string
  readonly ending: string
}

export function fixtureText(locale: 'en' | 'hi'): FixtureText {
  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, 'fixtures/packages/two-paths.json'), 'utf8'),
  ) as {
    text: Record<string, { title: string; book: string; nodes: Record<string, FixtureNode> }>
  }
  const text = pkg.text[locale]
  const start = text?.nodes['start']
  const next = text?.nodes['wise_path']
  const ending = text?.nodes['ending_wise']
  const [first, second] = Object.values(start?.choices ?? {})
  const action = Object.values(next?.choices ?? {})[0]
  if (!text || !start?.question || !first || !second || !action || !ending) {
    throw new Error(`two-paths.json has no ${locale} start node with two choices`)
  }
  return {
    title: text.title,
    book: text.book,
    passage: start.text,
    question: start.question,
    choices: [first, second],
    action,
    ending: ending.text,
  }
}

// ---------------------------------------------------------------------------------------------
// The owner specimen (design §8 E2E 6): swatches, an English and a Hindi fixture passage with a
// question and two choices, and a primary button. Its stylesheet uses token names only.

const TOKENS = declaredCustomProperties(
  readFileSync(path.join(ROOT, 'src/ui/styles/tokens.css'), 'utf8'),
)
const COLOUR_TOKENS = [...TOKENS].filter((name) => name.startsWith('--color-'))
const SCENES = [...TOKENS]
  .filter((name) => /^--scene-[a-z-]+-from$/.test(name))
  .map((name) => name.slice('--scene-'.length, -'-from'.length))

export const SPECIMEN_CSS = [
  // The same box as base.css gives <main>: the specimen sits under <body> (INJECTION above).
  `.specimen { display: grid; gap: var(--space-6); max-inline-size: var(--page-max);` +
    ` margin-inline: auto; padding-inline: var(--gutter); padding-block-end: var(--space-7); }`,
  `.specimen-heading { color: var(--color-text-secondary); font-size: var(--fs-label); }`,
  `.specimen-swatches, .specimen-scenes { display: flex; flex-wrap: wrap; gap: var(--space-3); }`,
  `.specimen-swatch { display: flex; flex: auto; align-items: center; gap: var(--space-2); }`,
  `.specimen-chip { flex: none; inline-size: var(--target-min); block-size: var(--target-min);` +
    ` border: thin solid var(--color-line-strong); border-radius: var(--radius-control); }`,
  `.specimen-label { color: var(--color-text-secondary); font-size: var(--fs-small);` +
    ` line-height: var(--lh-label); overflow-wrap: anywhere; }`,
  `.specimen-scene { flex: auto; padding-block: var(--space-4); padding-inline: var(--space-4);` +
    ` border-radius: var(--radius-control); font-size: var(--fs-label);` +
    ` font-weight: var(--fw-bold); overflow-wrap: anywhere; }`,
  `.specimen-card { display: grid; gap: var(--space-4); max-inline-size: var(--measure-story);` +
    ` padding-block: var(--space-5); padding-inline: var(--space-5);` +
    ` border: thin solid var(--color-line-subtle); border-radius: var(--radius-card);` +
    ` background-color: var(--color-surface-story); }`,
  `.specimen-passage { color: var(--color-text); font-size: var(--fs-story);` +
    ` line-height: var(--lh-story); margin-block: var(--space-1); }`,
  `.specimen-question { color: var(--color-text-strong); font-size: var(--fs-story);` +
    ` font-weight: var(--fw-bold); line-height: var(--lh-story); margin-block: var(--space-1); }`,
  `.specimen-choices { display: grid; gap: var(--gap-choice); }`,
  `.specimen-choice { min-block-size: var(--target-choice); padding-block: var(--space-2);` +
    ` padding-inline: var(--space-4); border: thin solid var(--color-line-strong);` +
    ` border-radius: var(--radius-control); background-color: var(--color-surface-raised);` +
    ` color: var(--color-text); font-size: var(--fs-choice); line-height: var(--lh-label);` +
    ` text-align: start; }`,
  `.specimen-action { justify-self: start; min-block-size: var(--target-min);` +
    ` padding-block: var(--space-2); padding-inline: var(--space-5);` +
    ` border: thin solid var(--color-accent); border-radius: var(--radius-pill);` +
    ` background-color: var(--color-accent); color: var(--color-text-on-accent);` +
    ` font-size: var(--fs-label); font-weight: var(--fw-bold); line-height: var(--lh-label); }`,
  ...COLOUR_TOKENS.map(
    (token) => `.specimen-chip[data-token='${token}'] { background-color: var(${token}); }`,
  ),
  ...SCENES.map(
    (scene) =>
      `.specimen-scene[data-scene='${scene}'] { color: var(--scene-${scene}-accent);` +
      ` background-image: linear-gradient(var(--scene-${scene}-from), var(--scene-${scene}-to)); }`,
  ),
].join('\n')

/**
 * The specimen stylesheet's own check: the repo CSS lint finds nothing in it, and once every
 * var(--token) is removed no number or # is left, so every value is a token name or a keyword.
 */
export function expectSpecimenCssUsesTokensOnly(): void {
  const findings = lintCss(SPECIMEN_CSS, { file: 'e2e/specimen.css', tokens: TOKENS })
  expect(findings, 'CSS lint findings in the specimen stylesheet').toEqual([])
  const values = [...SPECIMEN_CSS.matchAll(/\{([^}]*)\}/g)].map((m) => m[1] ?? '').join(';')
  const literals = values.replace(/var\(--[a-z0-9-]+\)/g, '').match(/[0-9#]/g) ?? []
  expect(literals, 'literals outside var(--token) in the specimen stylesheet').toEqual([])
  const used = [...values.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1] ?? '')
  expect(
    used.filter((name) => !TOKENS.has(name)),
    'specimen vars not in tokens.css',
  ).toEqual([])
}

/** Injects the specimen stylesheet, then the markup after <main> (INJECTION above). */
export async function injectSpecimen(page: Page): Promise<void> {
  expectSpecimenCssUsesTokensOnly()
  await page.addStyleTag({ content: SPECIMEN_CSS })
  await page.evaluate(
    ({ colours, scenes, en, hi }) => {
      const make = (tag: string, className: string, text = ''): HTMLElement => {
        const element = document.createElement(tag)
        if (className) element.className = className
        if (text) element.textContent = text
        return element
      }
      const section = make('section', 'specimen')
      section.setAttribute('aria-label', 'Specimen')

      section.append(make('h2', 'specimen-heading', 'Colour tokens'))
      const swatches = make('div', 'specimen-swatches')
      for (const token of colours) {
        const swatch = make('div', 'specimen-swatch')
        const chip = make('span', 'specimen-chip')
        chip.dataset['token'] = token
        swatch.append(chip, make('span', 'specimen-label', token))
        swatches.append(swatch)
      }
      section.append(swatches)

      section.append(make('h2', 'specimen-heading', 'Scenes (accent on the gradient)'))
      const sceneList = make('div', 'specimen-scenes')
      for (const scene of scenes) {
        const tile = make('div', 'specimen-scene', scene)
        tile.dataset['scene'] = scene
        sceneList.append(tile)
      }
      section.append(sceneList)

      for (const [lang, text] of [
        ['en', en],
        ['hi', hi],
      ] as const) {
        const card = make('article', 'specimen-card')
        card.lang = lang
        card.append(make('h2', '', text.title))
        card.append(make('p', 'specimen-passage', text.passage))
        card.append(make('p', 'specimen-question', text.question))
        const choices = make('div', 'specimen-choices')
        for (const choice of text.choices) {
          const button = make('button', 'specimen-choice', choice)
          button.setAttribute('type', 'button')
          choices.append(button)
        }
        card.append(choices)
        const action = make('button', 'specimen-action', text.action)
        action.setAttribute('type', 'button')
        action.id = `specimen-action-${lang}`
        card.append(action)
        section.append(card)
      }
      document.body.append(section)
    },
    { colours: COLOUR_TOKENS, scenes: SCENES, en: fixtureText('en'), hi: fixtureText('hi') },
  )
}
