// Helpers shared by the P1-1b e2e specs (spec §6.6, §6.7, §10.2 E2E row; P1-1b): the served CSS
// and its @font-face rules, the font lock file, prefs seeding with a storage-write spy, keyboard
// focus, fixture text and the owner specimen. Not a spec: Playwright does not let one spec import
// another, so look, assets, fonts, text-scale and specimen all take these from here.
// P1-4b (design p1-step10-design.md §2.1 e2e/page-helpers.ts, §9.3; Step 10a): the story player's
// helpers: seedProgressOnce, progressSpy, walk, fixtureGraph and the consoleErrors collector.
// Step 10b adds fixtureGraph's progressSteps, endingsOf and pathTo (T-b5, T-b6).
// Step 10c second review: the helpers player.spec.ts and player-share.spec.ts share (the last
// section), moved here from player.spec.ts with no change of behaviour.
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
import type { LocaleCode } from '../src/core/locales'
import { TEXT_SCALE_ATTRIBUTE } from '../src/core/progress/text-scale-boot'
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  PROGRESS_KEY,
  RECORD_SCHEMA,
  serializePrefs,
  serializeProgress,
  type ProgressRecord,
  type TextScale,
} from '../src/core/progress/records'
import { expect } from './fixtures'
import { playerFixture, type PlayerFixture } from './routes'

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

/** wideDevanagariFallback's default: Devanagari laid out 40% wider than Noto Sans Devanagari. */
export const WIDE_FALLBACK_SCALE = 140

/**
 * Step 10d CI fix (T-d6): before any page script, a Devanagari fallback much wider than the
 * self-hosted face, as on the CI image (run 44037149156: Linux, whose fallback is not the Windows
 * one, Nirmala UI, which is close to Noto). The committed Noto Sans Devanagari 400 and 700 files,
 * added from bytes under the family name 'Noto Sans Devanagari' (the first system fallback in
 * --font-hindi and --font-latin, tokens.css, so it shadows an installed copy) with size-adjust
 * `scale`% and only the Devanagari range. While a test holds the self-hosted files, Devanagari text
 * is laid out `scale`% wider than once they arrive, on every engine and OS. Test-only: the app
 * itself never adjusts font metrics (design L5). window.__e2eWideFallback is a promise that
 * resolves when both faces are loaded.
 */
export async function wideDevanagariFallback(
  page: Page,
  scale = WIDE_FALLBACK_SCALE,
): Promise<void> {
  const file = (weight: number): string =>
    readFileSync(
      path.join(ROOT, `src/ui/fonts/files/noto-sans-devanagari-devanagari-${weight}.woff2`),
    ).toString('base64')
  await page.addInitScript(
    ({ faces, range, sizeAdjust }) => {
      const loaded = faces.map(({ weight, data }) => {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
        const face = new FontFace('Noto Sans Devanagari', bytes, {
          weight,
          unicodeRange: range,
          sizeAdjust,
        } as FontFaceDescriptors)
        document.fonts.add(face)
        return face.loaded
      })
      ;(window as unknown as Record<string, unknown>)['__e2eWideFallback'] = Promise.all(loaded)
    },
    {
      faces: [400, 700].map((weight) => ({ weight: String(weight), data: file(weight) })),
      range: DEVANAGARI_RANGE,
      sizeAdjust: `${scale}%`,
    },
  )
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
 * controls on a plain Tab (Playwright's WebKit on Windows skips links; see tabReachesLinks), so the
 * WebKit projects press Alt+Tab (design §8 E2E 5); Alt changes the link setting only on Cocoa
 * (routes.ts), and the loop stops wherever focus arrives. Chromium ignores Alt+Tab, so it presses
 * Tab. Focus only ever arrives by key.
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

/**
 * Whether a plain Tab moves focus onto a link in this browser. Chromium: yes. Playwright's WebKit
 * on Windows leaves links out of the Tab order (focusLinkForWebKit in routes.ts). On the Linux CI
 * image, T8 in player-share.spec.ts expected Shift+Tab from the share field to skip All stories and
 * land on Share, and it did not (CI run 44463931008; where focus went was not recorded). So a test
 * that expects a Tab order around a link asks the browser first. Measured on a button and a link
 * added at the end of the body for the probe and removed after it, so the answer does not depend
 * on the page under test. Moves focus.
 */
export async function tabReachesLinks(page: Page): Promise<boolean> {
  await page.evaluate(() => {
    const box = document.createElement('div')
    box.setAttribute('data-e2e-tab-probe', '')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'probe'
    const link = document.createElement('a')
    link.href = '#e2e-tab-probe'
    link.textContent = 'probe'
    box.append(button, link)
    document.body.append(box)
  })
  await page.locator('[data-e2e-tab-probe] > button').focus()
  await page.keyboard.press('Tab')
  const reached = await page.evaluate(
    () => document.activeElement?.matches('[data-e2e-tab-probe] > a') ?? false,
  )
  await page.evaluate(() => document.querySelector('[data-e2e-tab-probe]')?.remove())
  return reached
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

// ---------------------------------------------------------------------------------------------
// The story player (P1-4b; design p1-step10-design.md §9.3)

/** One node of a fixture story: its type and its choices in package order. */
export interface FixtureGraphNode {
  readonly id: string
  readonly type: string
  readonly choices: readonly { readonly id: string; readonly next: string }[]
}

/** A fixture story as the player walks it (fixtures/packages/<id>.json, read only). */
export interface FixtureGraph {
  readonly storyId: string
  readonly version: number
  readonly startNodeId: string
  readonly nodes: ReadonlyMap<string, FixtureGraphNode>
  /** Per locale: the title, and per node the passage, question, choice labels and lesson. */
  readonly text: PlayerFixture['text']
  /** The path that takes the first choice at every node: choice ids, and node ids from the start. */
  readonly firstPath: { readonly choices: readonly string[]; readonly nodes: readonly string[] }
  /** Step 10b: the story's progress steps in package order, one segment each (D11-P12). */
  readonly progressSteps: readonly string[]
}

export function fixtureGraph(storyId: string): FixtureGraph {
  const fixture = playerFixture(storyId)
  const nodes = new Map<string, FixtureGraphNode>(
    fixture.nodes.map((node) => [
      node.id,
      { id: node.id, type: node.type, choices: node.choices ?? [] },
    ]),
  )
  const { progressSteps } = fixture as PlayerFixture & { readonly progressSteps?: unknown }
  if (
    !Array.isArray(progressSteps) ||
    !progressSteps.every((step) => typeof step === 'string' && nodes.has(step))
  ) {
    throw new Error(`${storyId}: progressSteps is not a list of the package's node ids`)
  }
  const choices: string[] = []
  const visited = [fixture.startNodeId]
  let node = nodes.get(fixture.startNodeId)
  while (node !== undefined && node.type !== 'ending' && visited.length <= nodes.size) {
    const first = node.choices[0]
    if (first === undefined) break
    choices.push(first.id)
    visited.push(first.next)
    node = nodes.get(first.next)
  }
  if (node?.type !== 'ending') throw new Error(`${storyId}: the first choices reach no ending`)
  return {
    storyId,
    version: fixture.version,
    startNodeId: fixture.startNodeId,
    nodes,
    text: fixture.text,
    firstPath: { choices, nodes: visited },
    progressSteps: progressSteps as string[],
  }
}

/** Step 10b: the ending nodes of a fixture story, in package order (T-b5). */
export function endingsOf(graph: FixtureGraph): string[] {
  return [...graph.nodes.values()].filter((node) => node.type === 'ending').map((node) => node.id)
}

/**
 * Step 10b: the shortest list of choice ids that takes a fresh run from the start node to
 * `nodeId` (breadth first, choices in package order), for walk(). Throws when none reaches it.
 */
export function pathTo(graph: FixtureGraph, nodeId: string): string[] {
  const routes = new Map<string, string[]>([[graph.startNodeId, []]])
  const queue = [graph.startNodeId]
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    const route = routes.get(at) ?? []
    if (at === nodeId) return route
    for (const choice of graph.nodes.get(at)?.choices ?? []) {
      if (routes.has(choice.next)) continue
      routes.set(choice.next, [...route, choice.id])
      queue.push(choice.next)
    }
  }
  throw new Error(`${graph.storyId}: no path from ${graph.startNodeId} to ${nodeId}`)
}

/** One story's saved progress for seedProgressOnce. */
export interface SeededStory {
  readonly activeRun: { readonly path: readonly string[]; readonly locale: LocaleCode } | null
  readonly endingsFound?: readonly string[]
}

/** The same-origin path seedProgressOnce serves itself (page.route): an empty page, no app code. */
const SEED_PATH = '/e2e-seed-progress'

/**
 * Stores a progress record once, as an earlier visit would have left it: opens an empty page on
 * the site's origin, writes reader.v1.progress there by evaluate and reads it back. Never an init
 * script, so a later reload or navigation is not seeded again (design fact-check B §C11). The page
 * is served by page.route, not by the app: on an app page the router prefetches its links, and
 * WebKit reports each prefetch that the next navigation aborts as a page error ("Fetch API cannot
 * load …?_rsc=… due to access control checks"; probe 2026-11-16), which the player tests'
 * error collector would count. Each story gets its fixture's version and the orders 1, 2, … in
 * the given order. Returns the stored bytes.
 */
export async function seedProgressOnce(
  page: Page,
  stories: Readonly<Record<string, SeededStory>>,
): Promise<string> {
  const record: ProgressRecord = {
    schema: RECORD_SCHEMA,
    stories: Object.fromEntries(
      Object.entries(stories).map(([storyId, story], index) => [
        storyId,
        {
          version: playerFixture(storyId).version,
          activeRun: story.activeRun,
          endingsFound: story.endingsFound ?? [],
          order: index + 1,
        },
      ]),
    ),
  }
  const raw = serializeProgress(record)
  const isSeedPage = (url: URL): boolean => url.pathname === SEED_PATH
  await page.route(isSeedPage, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="en"><head><title>e2e seed</title></head></html>',
    }),
  )
  const response = await page.goto(SEED_PATH)
  expect(response?.status(), 'the page that seeds the progress record').toBe(200)
  const stored = await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
      return window.localStorage.getItem(key)
    },
    [PROGRESS_KEY, raw] as const,
  )
  expect(stored, 'the seeded progress record').toBe(raw)
  await page.unroute(isSeedPage)
  return raw
}

/**
 * Before any page script: records, per document, every localStorage write to the progress key
 * (setItem, removeItem) and every clear(). Returns a reader of the current document's list.
 */
export async function progressSpy(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript((key) => {
    const w = window as unknown as Record<string, unknown>
    const writes: string[] = []
    w['__e2eProgressWrites'] = writes
    const proto = Storage.prototype
    for (const name of ['setItem', 'removeItem', 'clear'] as const) {
      const original = proto[name] as unknown as (...args: unknown[]) => unknown
      Object.defineProperty(proto, name, {
        configurable: true,
        writable: true,
        value: function (this: Storage, ...args: unknown[]) {
          if (name === 'clear') writes.push('clear')
          else if (args[0] === key) writes.push(`${name} ${key}`)
          return original.apply(this, args)
        },
      })
    }
  }, PROGRESS_KEY)
  return () =>
    page.evaluate(() => [
      ...(((window as unknown as Record<string, unknown>)['__e2eProgressWrites'] as
        string[] | undefined) ?? ['spy missing']),
    ])
}

/**
 * Takes `choices` in order on the open player of `storyId`: before each tap it waits until the run
 * is open and the choices are no longer inert (the settle has ended), then taps the choice of the
 * part on screen and waits for the next part (seq + 1) to show the node the fixture graph names.
 * Returns the node ids reached.
 */
export async function walk(
  page: Page,
  storyId: string,
  choices: readonly string[],
): Promise<string[]> {
  const graph = fixtureGraph(storyId)
  const part = page.locator('[data-part]')
  const reached: string[] = []
  for (const choiceId of choices) {
    await expect(page.locator('[data-player]')).toHaveAttribute('data-run-phase', 'open')
    await expect(page.locator('ul[data-choices]')).not.toHaveAttribute('inert')
    const node = (await part.getAttribute('data-node')) ?? ''
    const seq = Number(await part.getAttribute('data-seq'))
    const next = graph.nodes.get(node)?.choices.find((choice) => choice.id === choiceId)?.next
    if (next === undefined) throw new Error(`${storyId}: node ${node} has no choice ${choiceId}`)
    await page.locator(`[data-part] button[data-choice="${choiceId}"]`).click()
    await expect(part, `${storyId}: ${node} ${choiceId}`).toHaveAttribute(
      'data-seq',
      String(seq + 1),
    )
    await expect(part, `${storyId}: ${node} ${choiceId}`).toHaveAttribute('data-node', next)
    reached.push(next)
  }
  return reached
}

/** Console error lines a test causes on purpose, per engine (Playwright's browserName). */
export interface ExpectedErrors {
  readonly chromium?: readonly RegExp[]
  readonly webkit?: readonly RegExp[]
}

/** What consoleErrors collects and checks. */
export interface ConsoleErrors {
  /** Each console message of type error as the engine reports it; each page error as "pageerror: …". */
  readonly lines: readonly string[]
  /** Collects from another page of the same test too. */
  watch(page: Page): void
  /** Declares the errors this test causes on purpose (design §9.3 C4, F5). */
  allow(expected: ExpectedErrors): void
  /**
   * Fails on any line that no pattern of this engine matches, and on any pattern of this engine
   * that matched no line, so an allowance is never vacuous.
   */
  check(browserName: string): void
}

/**
 * Collects every console message of type error and every page error of `page` (design §9.3).
 * Errors only: a console warning (Chromium's unused-preload notice) never fails a test. Production
 * React reports a hydration mismatch as a page error ("Minified React error #418"), never as a
 * console error, which is why page errors are collected. A page error is recorded with a
 * "pageerror: " prefix, so a pattern written for a console line (anchored with ^) never allows one.
 */
export function consoleErrors(
  page: Page,
  options: { readonly expected?: ExpectedErrors } = {},
): ConsoleErrors {
  const lines: string[] = []
  let expected: ExpectedErrors = options.expected ?? {}
  const watch = (target: Page): void => {
    target.on('console', (msg) => {
      if (msg.type() === 'error') lines.push(msg.text())
    })
    target.on('pageerror', (error) => {
      lines.push(`pageerror: ${String(error)}`)
    })
  }
  watch(page)
  return {
    lines,
    watch,
    allow(next) {
      expected = next
    },
    check(browserName) {
      const patterns =
        browserName === 'chromium'
          ? (expected.chromium ?? [])
          : browserName === 'webkit'
            ? (expected.webkit ?? [])
            : []
      const unexpected = lines.filter((line) => !patterns.some((pattern) => pattern.test(line)))
      expect(unexpected, `console errors and page errors (${browserName})`).toEqual([])
      const unused = patterns
        .filter((pattern) => !lines.some((line) => pattern.test(line)))
        .map((pattern) => String(pattern))
      expect(unused, `expected error patterns that matched nothing (${browserName})`).toEqual([])
    },
  }
}

// ---------------------------------------------------------------------------------------------
// The story player specs' shared helpers (player.spec.ts and player-share.spec.ts; moved here from
// player.spec.ts at the 10c second review): selectors, opening the player, frames, page values, the
// stored story, the live-region recorder, the restart dialog watcher and coordinate-click geometry.

export const PLAYER = '[data-player]'
export const PART = '[data-part]'
export const RUN = '[data-run]'
export const DIALOG = 'dialog[data-restart-confirm]'
export const FIRST_PARAGRAPH = '[data-part] [data-passage] p'
/** A tap this long after the commit says nothing about the settle (F4). */
export const LATE_TAP_MS = 450

/** A choice button, in the part on screen or in the part of `node`. */
export function choice(id: string, node?: string): string {
  return `${node === undefined ? PART : `[data-part][data-node="${node}"]`} button[data-choice="${id}"]`
}

export async function waitOpen(page: Page): Promise<void> {
  await expect(page.locator(PLAYER)).toHaveAttribute('data-run-phase', 'open')
}

export async function openPlayer(page: Page, url: string): Promise<void> {
  const response = await page.goto(url)
  expect(response?.status(), url).toBe(200)
  await waitOpen(page)
}

/** Resolves after `count` animation frames of the page. */
export async function frames(page: Page, count = 2): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const next = (left: number): void => {
          if (left === 0) resolve()
          else requestAnimationFrame(() => next(left - 1))
        }
        next(n)
      }),
    count,
  )
}

/** A window property the page holds (set by an init script or an earlier evaluate). */
export async function pageValue<T>(page: Page, name: string): Promise<T> {
  return page.evaluate(
    (key) => (window as unknown as Record<string, unknown>)[key],
    name,
  ) as Promise<T>
}

export interface StoredStory {
  readonly activeRun: { readonly path: readonly string[]; readonly locale: string } | null
  readonly endingsFound: readonly string[]
}

/** The stored progress of one story, or null when there is none. */
export async function storedStory(page: Page, storyId: string): Promise<StoredStory | null> {
  return page.evaluate(
    ([key, id]) => {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return null
      const record = JSON.parse(raw) as { stories?: Record<string, StoredStory> }
      return record.stories?.[id] ?? null
    },
    [PROGRESS_KEY, storyId] as const,
  )
}

/** Before any page script: every value the live region holds, in order, without repeats. */
export async function recordAnnouncements(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    const seen: string[] = []
    w['__e2eLiveRegion'] = seen
    new MutationObserver(() => {
      const region = document.getElementById('live-region')
      if (region === null) return
      const text = region.textContent ?? ''
      if (seen[seen.length - 1] !== text) seen.push(text)
    }).observe(document, { subtree: true, childList: true, characterData: true })
  })
}

export async function announcements(page: Page): Promise<string[]> {
  return (await pageValue<string[]>(page, '__e2eLiveRegion')).filter((text) => text !== '')
}

/**
 * Before a click that must not open the restart dialog: records in the page whether the dialog's
 * open attribute is ever set from now on (a MutationObserver), read back as __e2eDialogOpened.
 */
export async function watchDialogOpen(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const w = window as unknown as Record<string, unknown>
    const dialog = document.querySelector<HTMLDialogElement>(selector)
    if (dialog === null) throw new Error(`no ${selector}`)
    w['__e2eDialogOpened'] = dialog.open
    new MutationObserver(() => {
      if (dialog.open) w['__e2eDialogOpened'] = true
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] })
  }, DIALOG)
}

export interface Point {
  readonly x: number
  readonly y: number
  readonly scrolled: boolean
}

/**
 * The centre of `selector` in viewport coordinates, for a coordinate click (F4): when it lies
 * outside the viewport, the element is scrolled into view by evaluate and measured again.
 */
export async function centreInViewport(page: Page, selector: string): Promise<Point> {
  return page.evaluate((wanted) => {
    const element = document.querySelector(wanted)
    if (element === null) throw new Error(`no ${wanted}`)
    const centre = () => {
      const box = element.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }
    const inside = (p: { x: number; y: number }) =>
      p.x >= 0 && p.y >= 0 && p.x < document.documentElement.clientWidth && p.y < window.innerHeight
    let point = centre()
    let scrolled = false
    if (!inside(point)) {
      element.scrollIntoView({ block: 'center', inline: 'center' })
      point = centre()
      scrolled = true
    }
    if (!inside(point)) throw new Error(`${wanted} stays outside the viewport`)
    return { ...point, scrolled }
  }, selector)
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export async function boxOf(page: Page, selector: string): Promise<Box> {
  return page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  })
}

/**
 * C7: the centre of the intersection of two boxes (viewport coordinates), and whether it can be
 * used: the intersection is not empty and its centre lies inside the viewport.
 */
export async function sharedPoint(
  page: Page,
  first: Box,
  second: Box,
): Promise<{ x: number; y: number; usable: boolean }> {
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
  }))
  const overlap = {
    left: Math.max(first.left, second.left),
    top: Math.max(first.top, second.top),
    right: Math.min(first.right, second.right),
    bottom: Math.min(first.bottom, second.bottom),
  }
  const x = (overlap.left + overlap.right) / 2
  const y = (overlap.top + overlap.bottom) / 2
  const usable =
    overlap.right > overlap.left &&
    overlap.bottom > overlap.top &&
    x >= 0 &&
    y >= 0 &&
    x < viewport.width &&
    y < viewport.height
  return { x, y, usable }
}

// ---------------------------------------------------------------------------------------------
// The owner's P1-4 screens (design p1-step10-design.md §10.3): screens.spec.ts shoots the player
// on the review build (screens 14-26), player-images.spec.ts the pictures on the staging build
// (screens 27-29). Local only, skipped unless SCREENS=1, as Step 7's screens.

/** Where the P1-4 screens go: storyboard/migration-input/step10-screens/ (git-ignored). */
const STEP10_SCREENS_DIR = path.join(ROOT, 'migration-input', 'step10-screens')

/** A P1-4 screen's file: <nn>-<screen>-<project>-<variant>.png, the variant its text size. */
export function step10ScreenPath(
  nn: string,
  name: string,
  project: string,
  scale: TextScale,
): string {
  return path.join(STEP10_SCREENS_DIR, `${nn}-${name}-${project}-${scale}.png`)
}

/** How long settleForScreenshot waits for the page's animations before it checks them. */
const ANIMATIONS_WAIT_MS = 10_000

/**
 * Before a screenshot: parks the pointer at the page's top-left corner, off every control, so no
 * shot shows the hover the last click left behind; waits for every font, for every animation of
 * the page to finish (a step's reveal, the ending card's fade; none of them is infinite) and for
 * two frames, then fails if any animation has not finished or a font is still loading, so no shot
 * catches a mid-animation frame.
 */
export async function settleForScreenshot(page: Page): Promise<void> {
  await page.mouse.move(0, 0)
  await page.evaluate(async (waitMs) => {
    await document.fonts.ready
    await Promise.race([
      Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      ),
      new Promise((resolve) => setTimeout(resolve, waitMs)),
    ])
  }, ANIMATIONS_WAIT_MS)
  await settleFonts(page)
  expect(
    await page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => animation.playState !== 'finished')
        .map(
          (animation) =>
            `${(animation as Partial<{ animationName: string }>).animationName ?? 'animation'} ` +
            animation.playState,
        ),
    ),
    'animations not finished before the screenshot',
  ).toEqual([])
  expect(await page.evaluate(() => document.fonts.status), 'fonts before the screenshot').toBe(
    'loaded',
  )
}
