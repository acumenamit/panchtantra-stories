// Helpers shared by the P1-1b e2e specs (spec §6.6, §6.7, §10.2 E2E row; P1-1b): the served CSS
// and its @font-face rules, the font lock file, prefs seeding with a storage-write spy, keyboard
// focus, fixture text and the owner specimen. Not a spec: Playwright does not let one spec import
// another, so look, assets, fonts, text-scale and specimen all take these from here.
// P1-4b (design p1-step10-design.md §2.1 e2e/page-helpers.ts, §9.3; Step 10a): the story player's
// helpers: seedProgressOnce, progressSpy, walk, fixtureGraph and the consoleErrors collector.
// Step 10b adds fixtureGraph's progressSteps, endingsOf and pathTo (T-b5, T-b6).
// Step 10c second review: the helpers player.spec.ts and player-share.spec.ts share (the last
// section), moved here from player.spec.ts with no change of behaviour.
// P1-3 Step 12a (design p1-step12-design.md §13.2): the shared Step 12 helpers, the last sections:
// W1 the navigation hold watch (watchNavHold, expectHoldWatch, holdRecord, armBox, holdSpans), W2's
// page side (boxesOf, through scripts/testing/e2e-readers.ts), W5 quietRequests (player.spec.ts's
// trackRequests, moved), W6 seedRawProgressOnce (seedProgressOnce's body), W7 the share stubs
// (moved from player-share.spec.ts with no change of behaviour), W8 holdChunksUntil, W9
// step12ScreenPath, W10 buildInfo and W12 fixedClock. The 12a load stall (§21): clearSiteStorage,
// which attemptPage and T11-HL1, HL3 and HL4 call before each later attempt.
//
// INJECTION: the specs append test elements to <body>, never inside <main>. React may hydrate
// <main> after the load event that page.goto waits for, and an extra node inside it is a hydration
// mismatch: React then re-renders <main> and the injected node is gone (seen on webkit-iphone,
// first run 2026-11-14). React 19 skips extra nodes directly under <body> while hydrating.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { APIRequestContext, Page, Request } from '@playwright/test'
import { measureBoxes, type BoxSet } from '../scripts/testing/e2e-readers'
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

/**
 * The font settle of a page whose scripts are held (W8, E12-H5 and E12-L5): held async scripts
 * keep the document loading, and WebKit then keeps document.fonts.ready pending until the load
 * event (CSS Font Loading: a set is loading while its document is), so settleFonts would wait for
 * W8's 15 s safety release and the "before" boxes would be read after hydration. This waits on the
 * faces themselves: two frames, then each loading face until it settles, until no face is loading
 * after two frames (at most 10 s, then it throws).
 */
export async function settleFontFaces(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const twoFrames = (): Promise<void> =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const deadline = performance.now() + 10_000
    await twoFrames()
    while (performance.now() < deadline) {
      const loading = [...document.fonts].filter((face) => face.status === 'loading')
      if (loading.length === 0) return
      await Promise.all(loading.map((face) => face.loaded.catch(() => undefined)))
      await twoFrames()
    }
    throw new Error('settleFontFaces: a font face was still loading after 10 s')
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
  return seedRawProgressOnce(page, progressRecordBytes(stories))
}

/**
 * The bytes seedProgressOnce stores for `stories` (each its fixture's version, the orders 1, 2, …),
 * for a test that writes them into a page that is already open (E12-P6: a run saved in another tab
 * after the landing's one read, design p1-step12-design.md §19).
 */
export function progressRecordBytes(stories: Readonly<Record<string, SeededStory>>): string {
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
  return serializeProgress(record)
}

/**
 * Step 12 (design p1-step12-design.md §13.2 W6): seedProgressOnce's body with the bytes given, for a
 * record no serializer writes (a newer schema, E12-H8 and E12-L18). Same page, same read-back.
 * Returns the stored bytes.
 */
export async function seedRawProgressOnce(page: Page, raw: string): Promise<string> {
  await onSeedPage(page, 'the page that seeds the progress record', async () => {
    const stored = await page.evaluate(
      ([key, value]) => {
        window.localStorage.setItem(key, value)
        return window.localStorage.getItem(key)
      },
      [PROGRESS_KEY, raw] as const,
    )
    expect(stored, 'the seeded progress record').toBe(raw)
  })
  return raw
}

/**
 * Design p1-step12-design.md §13.9 and §21 (the load stall): empties the site's localStorage, so a
 * later attempt of an in-test retry starts from the storage the first attempt started from. A page
 * of the same browser context (attemptPage's fresh page, or the one page T11-HL1, HL3 and HL4
 * reopen) still holds what an earlier attempt stored: a run it saved, which the reopened player
 * resumes (E12-P3 then waits for the start node's choice that never comes), or Read to me left on
 * (T11-HL1's Enter then turns it off). A page with no origin yet (attemptPage's fresh page, on
 * about:blank) is cleared on the seed page (no app code, as seedProgressOnce). A page already on the
 * site is cleared where it is: WebKit answers a page that went from the player to the seed page and
 * back with a 304 (cache revalidation), which openPlayer's 200 precondition refuses (measured, §21).
 * Precondition: nothing is left in localStorage.
 */
export async function clearSiteStorage(page: Page, attempt: number): Promise<void> {
  const clear = async (): Promise<void> => {
    const left = await page.evaluate(() => {
      window.localStorage.clear()
      return window.localStorage.length
    })
    expect(left, `precondition: the context's storage is empty before attempt ${attempt}`).toBe(0)
  }
  if (page.url() === 'about:blank') {
    await onSeedPage(page, 'the page that clears the site storage', clear)
  } else {
    await clear()
  }
}

/** Opens the seed page (served by page.route: an empty same-origin page), runs `body`, unroutes. */
async function onSeedPage(page: Page, what: string, body: () => Promise<void>): Promise<void> {
  const isSeedPage = (url: URL): boolean => url.pathname === SEED_PATH
  await page.route(isSeedPage, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="en"><head><title>e2e seed</title></head></html>',
    }),
  )
  const response = await page.goto(SEED_PATH)
  expect(response?.status(), what).toBe(200)
  await body()
  await page.unroute(isSeedPage)
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

// ---------------------------------------------------------------------------------------------
// Text-size and font variants (moved unchanged from player-share.spec.ts at P1-5a Step 11, design
// p1-step11-design.md A38, so player-audio.spec.ts runs its layout checks under the same wide
// Devanagari fallback with the self-hosted font files aborted; rules LAYOUT STABILITY).

export interface RowVariant {
  readonly code: LocaleCode
  readonly scale: 100 | 150
  /** The wide Devanagari fallback, the self-hosted font files aborted. */
  readonly wide: boolean
}

export const ROW_PHONES: readonly string[] = ['chromium-phone', 'webkit-iphone']
export const LORA_FILE = /\/_next\/static\/media\/lora[^/]*\.woff2$/
export const NOTO_FILE = /\/_next\/static\/media\/noto[-_]sans[-_]devanagari[^/]*\.woff2$/
/** An aborted font file: Chromium logs each one; WebKit logs none. */
export const FONT_FAILED_LINE = /^Failed to load resource: net::ERR_FAILED$/
/** expectWideFallback's bound on the self-hosted faces' wait after the settle (round 2). */
export const WIDE_FACES_MS = 5_000

/**
 * Before the page opens: the variant's text size and, for a wide variant, the wide Devanagari
 * fallback with every self-hosted font file aborted (Chromium logs each abort). Returns the count
 * of aborted requests so far.
 */
export async function prepareVariant(
  page: Page,
  variant: RowVariant,
  errors: ConsoleErrors,
): Promise<() => number> {
  if (variant.scale !== 100) await seedPrefs(page, prefsText(variant.scale))
  let aborted = 0
  if (variant.wide) {
    errors.allow({ chromium: [FONT_FAILED_LINE] })
    await wideDevanagariFallback(page)
    await page.route(
      (url) => LORA_FILE.test(url.pathname) || NOTO_FILE.test(url.pathname),
      async (route) => {
        aborted++
        await route.abort().catch(() => undefined)
      },
    )
  }
  return () => aborted
}

/**
 * The wide variant's precondition (design §5): font files were aborted, every self-hosted
 * Devanagari face failed and both wide 'Noto Sans Devanagari' faces loaded, so the wide fallback
 * lays out the Devanagari text for the whole test. `settle` is settleFontFaces on a page whose
 * scripts are held (W8).
 * Step 12a review round 2 (R2-TPP-2): a face no text has asked for yet stays 'unloaded' after the
 * settle (under load on WebKit, all four at once: design §18), and document.fonts.ready does not
 * wait for it. So, after the settle, each self-hosted Devanagari face still 'unloaded' is
 * requested with load() (its file is aborted like every other) and the faces are polled every
 * 50 ms until none is 'unloaded' or 'loading', at most WIDE_FACES_MS; the assertion is unchanged
 * and still requires 'error' for every one of them.
 */
export async function expectWideFallback(
  page: Page,
  aborted: number,
  settle: (page: Page) => Promise<void> = settleFonts,
): Promise<void> {
  expect(aborted, 'precondition: font files aborted').toBeGreaterThan(0)
  await page.evaluate(async () => {
    await (window as unknown as Record<string, unknown>)['__e2eWideFallback']
  })
  await settle(page)
  const faces = await page.evaluate(async (limit) => {
    const own = (): FontFace[] =>
      [...document.fonts].filter((face) => {
        const family = face.family.replace(/["']/g, '')
        return family !== 'Noto Sans Devanagari' && /devanagari/i.test(family)
      })
    const deadline = performance.now() + limit
    for (const face of own()) {
      if (face.status === 'unloaded') face.load().catch(() => undefined)
    }
    while (
      performance.now() < deadline &&
      own().some((face) => face.status === 'unloaded' || face.status === 'loading')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return [...document.fonts].map((face) => ({
      family: face.family.replace(/["']/g, ''),
      status: face.status,
    }))
  }, WIDE_FACES_MS)
  const own = faces.filter(
    (face) => face.family !== 'Noto Sans Devanagari' && /devanagari/i.test(face.family),
  )
  expect(own.length, 'precondition: the self-hosted Devanagari faces').toBeGreaterThan(0)
  expect(
    own.map((face) => `${face.family}: ${face.status}`),
    'precondition: every self-hosted Devanagari face failed',
  ).toEqual(own.map((face) => `${face.family}: error`))
  expect(
    faces.filter((face) => face.family === 'Noto Sans Devanagari').map((face) => face.status),
    'precondition: both wide fallback faces loaded',
  ).toEqual(['loaded', 'loaded'])
}

// ---------------------------------------------------------------------------------------------
// Share stubs (design p1-step12-design.md §13.2 W7): moved unchanged from player-share.spec.ts so
// the landing's Share tests use the same stubs; only `export` is new.

/** How a share test sets the browser's share and clipboard (C5). */
export interface ShareSetup {
  /**
   * undefined: navigator.share and canShare are both undefined. Otherwise canShare says yes and
   * share resolves, rejects with an AbortError, never settles, or (deferred) rejects with a
   * NotAllowedError when the test calls settleLater().
   */
  readonly share: 'undefined' | 'resolve' | 'abort' | 'never' | 'deferred'
  /**
   * real: the browser's own clipboard (Chromium, permissions granted); else a writeText stub that
   * resolves, rejects, or (deferred) resolves when the test calls settleLater().
   */
  readonly clipboard: 'real' | 'resolve' | 'reject' | 'deferred'
}

export interface ShareCalls {
  readonly share: readonly { title: unknown; url: unknown; onNavigator: boolean }[]
  readonly canShare: number
  readonly writeText: readonly string[]
  /** Clicks whose target lies in a Share button. */
  readonly shareClicks: number
}

/** Before any page script: the share and clipboard of `setup`, recording every call. */
export async function stubShare(page: Page, setup: ShareSetup): Promise<void> {
  await page.addInitScript((wanted) => {
    const calls = {
      share: [] as { title: unknown; url: unknown; onNavigator: boolean }[],
      canShare: 0,
      writeText: [] as string[],
      shareClicks: 0,
    }
    const w = window as unknown as Record<string, unknown>
    w['__e2eShare'] = calls
    // A deferred share or copy hands its settle function to settleLater().
    const later = (settle: () => void): void => {
      w['__e2eSettleLater'] = settle
    }
    const define = (name: string, value: unknown): void => {
      Object.defineProperty(Navigator.prototype, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      })
    }
    if (wanted.share === 'undefined') {
      define('share', undefined)
      define('canShare', undefined)
    } else {
      define('canShare', function canShare() {
        calls.canShare++
        return true
      })
      define('share', function share(this: unknown, data?: { title?: unknown; url?: unknown }) {
        calls.share.push({ title: data?.title, url: data?.url, onNavigator: this === navigator })
        if (wanted.share === 'resolve') return Promise.resolve()
        if (wanted.share === 'abort') {
          return Promise.reject(new DOMException('e2e: share sheet closed', 'AbortError'))
        }
        if (wanted.share === 'deferred') {
          return new Promise<void>((_, reject) => {
            later(() => reject(new DOMException('e2e: share failed', 'NotAllowedError')))
          })
        }
        return new Promise<void>(() => undefined)
      })
    }
    if (wanted.clipboard !== 'real') {
      const clipboard = {
        writeText(text: unknown): Promise<void> {
          calls.writeText.push(String(text))
          if (wanted.clipboard === 'deferred') {
            return new Promise<void>((resolve) => {
              later(() => resolve())
            })
          }
          return wanted.clipboard === 'resolve'
            ? Promise.resolve()
            : Promise.reject(new DOMException('e2e: copy refused', 'NotAllowedError'))
        },
      }
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        enumerable: true,
        get: () => clipboard,
      })
    }
    document.addEventListener(
      'click',
      (event) => {
        if (event.target instanceof Element && event.target.closest('button[data-share]')) {
          calls.shareClicks++
        }
      },
      { capture: true },
    )
  }, setup)
}

export async function shareCalls(page: Page): Promise<ShareCalls> {
  return pageValue<ShareCalls>(page, '__e2eShare')
}

/** Settles the deferred share (rejects with a NotAllowedError) or copy (resolves). */
export async function settleLater(page: Page): Promise<void> {
  await page.evaluate(() => {
    const settle = (window as unknown as Record<string, unknown>)['__e2eSettleLater']
    if (typeof settle !== 'function') throw new Error('nothing deferred to settle')
    ;(settle as () => void)()
  })
}

/** C5: the page sees the share and canShare the setup asked for, whatever the browser exposes. */
export async function expectShareSetup(page: Page, setup: ShareSetup): Promise<void> {
  const kind = setup.share === 'undefined' ? 'undefined' : 'function'
  expect(
    await page.evaluate(() => [typeof navigator.share, typeof navigator.canShare]),
    'navigator.share and canShare as stubbed (C5)',
  ).toEqual([kind, kind])
}

// ---------------------------------------------------------------------------------------------
// Requests in flight (design p1-step12-design.md §13.2 W5): player.spec.ts's trackRequests,
// moved unchanged under the name quietRequests. Every Step 12 test that reloads, opens another
// page after a reader page or taps the language switch waits for it first (§13.1 E: WebKit
// reports a router prefetch that a cross-document navigation aborts as a page error).

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Starts counting the page's requests in flight. The returned function waits until none has been
 * in flight for `quietMs` (load states are sticky, so waitForLoadState('networkidle') can return
 * while a later router prefetch is in flight).
 * Precondition (review R2-FLK-4): start it after the test's last reload or cross-document
 * navigation, and use it only to guard the next one. Chromium can drop a request that a reload
 * cancels (an _rsc prefetch, a chunk) with neither requestfinished nor requestfailed, so it would
 * stay in flight here forever. Clearing the set on framenavigated is no fix: same-document
 * navigations fire it too.
 */
export function quietRequests(page: Page): (quietMs?: number) => Promise<void> {
  const inFlight = new Set<Request>()
  page.on('request', (request) => inFlight.add(request))
  page.on('requestfinished', (request) => inFlight.delete(request))
  page.on('requestfailed', (request) => inFlight.delete(request))
  return async (quietMs = 500) => {
    const deadline = Date.now() + 10_000
    let quietSince = Date.now()
    while (Date.now() < deadline) {
      if (inFlight.size > 0) quietSince = Date.now()
      else if (Date.now() - quietSince >= quietMs) return
      await sleep(50)
    }
    throw new Error(`requests still in flight: ${[...inFlight].map((r) => r.url()).join(', ')}`)
  }
}

// ---------------------------------------------------------------------------------------------
// The navigation hold watch (design p1-step12-design.md §13.1 C, §13.2 W1; rules TIMING TESTS):
// every set and removal of data-nav-hold on <html>, and every pointerdown, click and keydown, each
// stamped with performance.now() in the page. The records live on the document, so they survive
// soft navigations (the hold's whole point: it covers the old page and the new one).

/** The hold attribute on <html> (SPEC:462, design §4.6), written out here. */
export const HOLD_ATTRIBUTE = 'data-nav-hold'
/**
 * SPEC:462's 500 ms, written out: a test never reads the product's NAV_HOLD_MS, which a mutant
 * (MU12-3) changes.
 */
export const SPEC_HOLD_MS = 500

/** One record of the hold watch. */
export interface HoldEvent {
  readonly type: 'on' | 'off' | 'pointerdown' | 'click' | 'keydown'
  /** performance.now() in the page. */
  readonly t: number
  readonly trusted?: boolean
  readonly x?: number
  readonly y?: number
  readonly key?: string
  /** Whether <html> held the attribute when the event reached window (capture). */
  readonly held?: boolean
  /** The event target: its element name and data-* attributes. */
  readonly target?: string
  /** Whether the target lies inside main. */
  readonly inMain?: boolean
  /** Whether the armed element's box held the point at that moment; null when none is armed. */
  readonly inArmed?: boolean | null
  /** location.pathname at the event. */
  readonly path?: string
}

/**
 * Before any page script (W1): the hold watch. A set or removal of the attribute is stamped when
 * the setter is called (setAttribute, removeAttribute and toggleAttribute on <html> are wrapped:
 * a MutationObserver callback only runs after the click handler that set it returns), and recorded
 * by a MutationObserver on the document (subtree, attributeFilter [HOLD_ATTRIBUTE], records of
 * <html> only: <html> does not exist yet when an init script runs), which takes the setter's
 * stamp, or its own time for a change made another way. expectHoldWatch is its self-check.
 */
export async function watchNavHold(page: Page): Promise<void> {
  await page.addInitScript((attribute) => {
    const w = window as unknown as Record<string, unknown>
    const events: Record<string, unknown>[] = []
    w['__e2eHold'] = events
    w['__e2eHoldArmed'] = null
    // An init script runs before the parser has made <html> (documentElement is null on both
    // engines), so <html> is read when it is needed and the observer watches the document.
    const held = (): boolean => document.documentElement?.hasAttribute(attribute) ?? false
    const stamps: number[] = []
    const proto = Element.prototype
    for (const name of ['setAttribute', 'removeAttribute', 'toggleAttribute'] as const) {
      const original = proto[name] as unknown as (...args: unknown[]) => unknown
      Object.defineProperty(proto, name, {
        configurable: true,
        writable: true,
        value: function (this: Element, ...args: unknown[]) {
          if (this === document.documentElement && args[0] === attribute) {
            stamps.push(performance.now())
          }
          return original.apply(this, args)
        },
      })
    }
    new MutationObserver((all) => {
      const records = all.filter((record) => record.target === document.documentElement)
      records.forEach((record, index) => {
        const before = record.oldValue !== null
        const next = records[index + 1]
        const after = next === undefined ? held() : next.oldValue !== null
        const t = stamps.shift() ?? performance.now()
        if (after) events.push({ type: 'on', t })
        else if (before) events.push({ type: 'off', t })
      })
    }).observe(document, {
      attributes: true,
      attributeFilter: [attribute],
      attributeOldValue: true,
      subtree: true,
    })
    const describe = (target: EventTarget | null): string => {
      if (!(target instanceof Element)) return target === null ? 'null' : 'window or document'
      const marks = [...target.attributes]
        .filter((a) => a.name.startsWith('data-'))
        .map((a) => `[${a.name}${a.value === '' ? '' : `="${a.value}"`}]`)
        .join('')
      return `${target.localName}${marks}`
    }
    const inArmed = (x: number, y: number): boolean | null => {
      const selector = w['__e2eHoldArmed']
      if (typeof selector !== 'string') return null
      const element = document.querySelector(selector)
      if (element === null) return false
      const box = element.getBoundingClientRect()
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
    }
    for (const type of ['pointerdown', 'click'] as const) {
      window.addEventListener(
        type,
        (event) => {
          const e = event as MouseEvent
          events.push({
            type,
            t: performance.now(),
            trusted: e.isTrusted,
            x: e.clientX,
            y: e.clientY,
            held: held(),
            target: describe(e.target),
            inMain: e.target instanceof Element && e.target.closest('main') !== null,
            inArmed: inArmed(e.clientX, e.clientY),
            path: location.pathname,
          })
        },
        { capture: true },
      )
    }
    window.addEventListener(
      'keydown',
      (event) => {
        events.push({
          type: 'keydown',
          t: performance.now(),
          trusted: event.isTrusted,
          key: event.key,
          held: held(),
          target: describe(event.target),
          path: location.pathname,
        })
      },
      { capture: true },
    )
  }, HOLD_ATTRIBUTE)
}

/**
 * W1's self-check, the first precondition of every hold test: the test sets the attribute and
 * removes it, and the watch must record exactly [on, off] (MR12-1, an observer that filters
 * another attribute name, turns this red). Those two records are then dropped.
 */
export async function expectHoldWatch(page: Page): Promise<void> {
  const seen = await page.evaluate(async (attribute) => {
    const events = (window as unknown as Record<string, unknown>)['__e2eHold'] as
      { type: string }[] | undefined
    if (events === undefined) return ['the watch is not installed']
    const from = events.length
    document.documentElement.setAttribute(attribute, '')
    document.documentElement.removeAttribute(attribute)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return events.splice(from).map((event) => event.type)
  }, HOLD_ATTRIBUTE)
  expect(seen, 'precondition: the hold watch records a set and a removal (W1 self-check)').toEqual([
    'on',
    'off',
  ])
}

/** The hold watch's records so far (W1). */
export async function holdRecord(page: Page): Promise<HoldEvent[]> {
  return page.evaluate(() => [
    ...(((window as unknown as Record<string, unknown>)['__e2eHold'] as HoldEvent[] | undefined) ??
      []),
  ])
}

/**
 * Arms `selector` (W1): from now on each pointerdown and click records whether that element's box,
 * read at the event, held the point. Returns the box now (viewport coordinates).
 */
export async function armBox(page: Page, selector: string): Promise<Box> {
  return page.evaluate((wanted) => {
    ;(window as unknown as Record<string, unknown>)['__e2eHoldArmed'] = wanted
    const element = document.querySelector(wanted)
    if (element === null) throw new Error(`armBox: no ${wanted}`)
    const box = element.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  }, selector)
}

/** One hold: its first set, every set while it lasted, and its removal (null while it lasts). */
export interface HoldSpan {
  readonly on: number
  readonly sets: readonly number[]
  readonly off: number | null
}

/** The holds the watch saw, in order. */
export function holdSpans(events: readonly HoldEvent[]): HoldSpan[] {
  const spans: HoldSpan[] = []
  let open: { on: number; sets: number[] } | null = null
  for (const event of events) {
    if (event.type === 'on') {
      if (open === null) open = { on: event.t, sets: [event.t] }
      else open.sets.push(event.t)
    } else if (event.type === 'off' && open !== null) {
      spans.push({ ...open, off: event.t })
      open = null
    }
  }
  if (open !== null) spans.push({ ...open, off: null })
  return spans
}

/**
 * 13.1 C "after the hold": waits in the page until <html> has no hold attribute (at most 2 s, so a
 * hold that is never released fails as `released: false`, not as a timeout), then two frames and a
 * 100 ms page timer. `at` is performance.now() when it ends.
 */
export async function afterHold(page: Page): Promise<{ released: boolean; at: number }> {
  return page.evaluate(async (attribute) => {
    const html = document.documentElement
    let released = true
    if (html.hasAttribute(attribute)) {
      released = await new Promise<boolean>((resolve) => {
        const observer = new MutationObserver(() => {
          if (html.hasAttribute(attribute)) return
          observer.disconnect()
          resolve(true)
        })
        observer.observe(html, { attributes: true, attributeFilter: [attribute] })
        setTimeout(() => {
          observer.disconnect()
          resolve(!html.hasAttribute(attribute))
        }, 2000)
      })
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await new Promise((resolve) => setTimeout(resolve, 100))
    return { released, at: performance.now() }
  }, HOLD_ATTRIBUTE)
}

/** What lies at a point, read from the boxes of `selectors` (13.1 I: never elementFromPoint under a hold). */
export async function boxesAt(
  page: Page,
  point: { readonly x: number; readonly y: number },
  selectors: readonly string[],
): Promise<string[]> {
  return page.evaluate(
    ({ x, y, wanted }) =>
      wanted.filter((selector) =>
        [...document.querySelectorAll(selector)].some((element) => {
          const box = element.getBoundingClientRect()
          return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
        }),
      ),
    { x: point.x, y: point.y, wanted: [...selectors] },
  )
}

/** Scrolls to the end of the page; returns scrollY and the page's length in viewports (13.1 K). */
export async function scrollToBottom(
  page: Page,
): Promise<{ scrollY: number; ratio: number; scrollHeight: number; innerHeight: number }> {
  return page.evaluate(async () => {
    const scrolling = document.scrollingElement ?? document.documentElement
    window.scrollTo(0, scrolling.scrollHeight)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return {
      scrollY: window.scrollY,
      ratio: scrolling.scrollHeight / window.innerHeight,
      scrollHeight: scrolling.scrollHeight,
      innerHeight: window.innerHeight,
    }
  })
}

/**
 * 13.9: the page of an attempt, the test's own first, then a new page of its context. Before a
 * later attempt every open page of the context is closed ("the test closes the page"), so a late
 * attempt's page, still holding its player or Home, cannot slow the next one. The new page shares
 * the context's localStorage, so it is emptied first (§21): the attempt then starts from the storage
 * attempt 1 started from and seeds its own, never from a run a late attempt saved (E12-P3 resumed
 * it and waited 30 s for the start node's choice; E12-L11a tapped Continue under Start's name).
 */
export async function attemptPage(page: Page, errors: ConsoleErrors, n: number): Promise<Page> {
  if (n === 1) return page
  for (const open of page.context().pages()) await open.close()
  const fresh = await page.context().newPage()
  errors.watch(fresh)
  await clearSiteStorage(fresh, n)
  return fresh
}

// ---------------------------------------------------------------------------------------------
// Step 12's CI-parity variants (design p1-step12-design.md §13.1 F; rules LAYOUT STABILITY)

export interface Step12Variant extends RowVariant {
  readonly name: 'V1' | 'V2' | 'V3' | 'V4'
  /** A 320 px viewport (V4). */
  readonly narrow: boolean
}

/**
 * V1 /en 100% with the fonts as shipped; V2 /hi 100% under the wide Devanagari fallback with the
 * self-hosted font files aborted; V3 V2 at 150% (the phones); V4 V3 at a 320 px viewport.
 */
export const STEP12_VARIANTS: Readonly<Record<Step12Variant['name'], Step12Variant>> = {
  V1: { name: 'V1', code: 'en', scale: 100, wide: false, narrow: false },
  V2: { name: 'V2', code: 'hi', scale: 100, wide: true, narrow: false },
  V3: { name: 'V3', code: 'hi', scale: 150, wide: true, narrow: false },
  V4: { name: 'V4', code: 'hi', scale: 150, wide: true, narrow: true },
}

/** A variant's title part, e.g. "V3 /hi 150% wide". */
export function variantTitle(variant: Step12Variant): string {
  return `${variant.name} /${variant.code} ${variant.scale}%${variant.wide ? ' wide' : ''}${variant.narrow ? ' 320 px' : ''}`
}

/** 150% text runs on the phones only (V3, V4): the reason a tablet skips, else null. */
export function variantSkip(variant: Step12Variant, project: string): string | null {
  return variant.scale !== 100 && !ROW_PHONES.includes(project) ? '150% text: the phones' : null
}

/** Before the page opens: the variant's viewport, text size and fonts. Returns the abort count. */
export async function prepareStep12Variant(
  page: Page,
  variant: Step12Variant,
  errors: ConsoleErrors,
): Promise<() => number> {
  if (variant.narrow) {
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('the project sets no viewport')
    await page.setViewportSize({ width: 320, height: viewport.height })
  }
  return prepareVariant(page, variant, errors)
}

/**
 * After the page opened: the variant's precondition (wide fonts; the stored text size). With
 * scriptsHeld (W8 holds the chunks), the fonts are settled by settleFontFaces.
 */
export async function expectStep12Variant(
  page: Page,
  variant: Step12Variant,
  aborted: () => number,
  { scriptsHeld = false }: { readonly scriptsHeld?: boolean } = {},
): Promise<void> {
  const settle = scriptsHeld ? settleFontFaces : settleFonts
  if (variant.wide) await expectWideFallback(page, aborted(), settle)
  else await settle(page)
  expect(
    await page.locator('html').getAttribute('data-text-scale'),
    `precondition: the text size of ${variantTitle(variant)}`,
  ).toBe(variant.scale === 100 ? null : String(variant.scale))
}

// ---------------------------------------------------------------------------------------------
// A held tap into Home (design p1-step12-design.md §13.4.3 E12-P1 to P3, CRIT-3): the player's
// three links to Home render through HeldLink, so a second tap on Home within 500 ms is refused.

/** The fixture stories (the catalogue every open build lists); the only cards a test may tap. */
const TAPPABLE_IDS: readonly string[] = ['lantern-walk', 'river-stones', 'two-paths']

/** One run of the scenario: the gap, and the groups to check once the attempt counts. */
export interface HeldHomeTap extends HoldAttempt {
  readonly verify: () => Promise<void>
}

/**
 * Taps `source` (a link to /`code` on a player page, W1 installed and self-checked) at its
 * centre; as soon as Home has read progress, arms the first fixture card whose centre lies in the
 * viewport and taps that centre. verify() then checks (g0) the hold began inside the first click
 * and was on at the second pointerdown, whose point lay in the card; (g1) after the hold the URL
 * is still Home; (g2) after the hold a tap at the same point opens that card's landing.
 */
export async function heldTapIntoHome(
  page: Page,
  code: LocaleCode,
  source: string,
): Promise<HeldHomeTap> {
  const from = (await holdRecord(page)).length
  const start = await centreInViewport(page, source)
  await page.mouse.click(start.x, start.y)
  const target = await page.evaluate(
    async ({ home, ids }) => {
      const ready = (): boolean =>
        location.pathname === home &&
        document.querySelector('[data-home-progress][data-phase="ready"]') !== null
      const deadline = performance.now() + 5000
      while (!ready() && performance.now() < deadline) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      if (!ready()) return null
      const fixtures = [...document.querySelectorAll('[data-home-list] [data-story-card]')].filter(
        (card) => ids.includes(card.getAttribute('data-story-card') ?? ''),
      )
      const centre = (card: Element) => {
        const box = card.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      }
      const inView = ({ x, y }: { x: number; y: number }): boolean =>
        x > 0 && y > 0 && x < document.documentElement.clientWidth && y < window.innerHeight
      for (const card of fixtures) {
        const point = centre(card)
        if (inView(point)) {
          return { id: card.getAttribute('data-story-card') ?? '', ...point, scrolled: false }
        }
      }
      // At 150% text on a short phone Home opens with every card below the fold: a finger can only
      // tap what is on screen, so the first fixture card is scrolled into view (as
      // centreInViewport does, 13.1 K).
      const first = fixtures[0]
      if (first === undefined) return null
      first.scrollIntoView({ block: 'center', inline: 'center' })
      const point = centre(first)
      if (!inView(point)) return null
      return { id: first.getAttribute('data-story-card') ?? '', ...point, scrolled: true }
    },
    { home: `/${code}`, ids: [...TAPPABLE_IDS] },
  )
  if (target === null) {
    return {
      gap: null,
      verify: () => {
        throw new Error(`precondition: Home /${code} read progress and showed a fixture card`)
      },
    }
  }
  const selector = `[data-home-list] [data-story-card="${target.id}"]`
  if (target.scrolled) {
    console.log(`[held tap into Home] /${code}: ${target.id} scrolled into view for the second tap`)
  }
  await armBox(page, selector)
  await page.mouse.click(target.x, target.y)
  const events = (await holdRecord(page)).slice(from)
  const span = holdSpans(events)[0]
  const downs = events.filter((event) => event.type === 'pointerdown')
  const second = downs[1]
  const firstClick = events.find((event) => event.type === 'click')
  const gap = span !== undefined && second !== undefined ? second.t - span.on : null
  return {
    gap,
    verify: async () => {
      expect.soft(span, '(g0) a hold began at the tap on the link to Home').toBeDefined()
      expect
        .soft(
          span !== undefined && firstClick !== undefined ? span.on - firstClick.t : null,
          `(g0) the hold began inside the first click (set − click, ms; ${source})`,
        )
        .toBeGreaterThanOrEqual(0)
      expect
        .soft(
          span !== undefined && firstClick !== undefined ? span.on - firstClick.t : null,
          `(g0) the hold began inside the first click (set − click, ms; ${source})`,
        )
        .toBeLessThanOrEqual(50)
      expect.soft(second?.held, '(g0) the hold was on at the second pointerdown').toBe(true)
      expect.soft(second?.inArmed, `(g0) the second point lay in ${selector}'s box`).toBe(true)
      const after = await afterHold(page)
      expect.soft(after.released, '(g1) the hold was released').toBe(true)
      expect
        .soft(new URL(page.url()).pathname, '(g1) after the hold the URL is still Home')
        .toBe(`/${code}`)
      await page.mouse.click(target.x, target.y)
      await page
        .waitForURL((url) => url.pathname === `/${code}/stories/${target.id}`, { timeout: 5000 })
        .catch(() => undefined)
      expect
        .soft(
          new URL(page.url()).pathname,
          "(g2) after the hold a tap there opens the card's landing",
        )
        .toBe(`/${code}/stories/${target.id}`)
    },
  }
}

/** One attempt of a hold scenario: the gap from the hold's set to the second pointerdown. */
export interface HoldAttempt {
  /**
   * ms from the first hold's set to the second pointerdown; null when no hold was seen at the second
   * tap (the attempt's groups have run by then, or a precondition threw).
   */
  readonly gap: number | null
}

/**
 * The in-test retry of 13.9: runs `attempt` (each on a fresh page it opens itself) up to three
 * times while its second tap came LATE_TAP_MS or more after the hold began (the destination was
 * not ready in time). Each gap is annotated. Fails as "timing" when all three are late; never
 * passes on a late tap. A null gap is not a late tap: no hold was seen at all, so that attempt
 * counts and its own groups decide (a product that never holds fails at its (g0) group, not as
 * "timing"; mutant prover 1, P1 Step 12a). An attempt returns null only after its groups ran.
 * Returns the attempt number that counted.
 */
export async function withHoldRetry(
  info: { readonly annotations: { type: string; description?: string }[] },
  attempt: (n: number) => Promise<HoldAttempt>,
): Promise<number> {
  const gaps: string[] = []
  for (let n = 1; n <= 3; n++) {
    const { gap } = await attempt(n)
    info.annotations.push({ type: 'hold gap', description: `attempt ${n}: ${String(gap)} ms` })
    gaps.push(String(gap))
    if (gap === null || gap < LATE_TAP_MS) return n
  }
  throw new Error(
    `timing: the second tap came ${LATE_TAP_MS} ms or more after the hold began on all 3 attempts (gaps ${gaps.join(', ')} ms)`,
  )
}

/** W2, the page side: each selector's boxes in page coordinates, and the document's scroll size. */
export async function boxesOf(page: Page, selectors: readonly string[]): Promise<BoxSet> {
  return page.evaluate(measureBoxes, [...selectors])
}

/**
 * W8 (the form of player-audio.spec.ts's chunk hold): holds every JavaScript chunk, never the CSS,
 * until the returned release() is called (at most 15 s), so the server HTML paints and stays
 * unhydrated. held() counts the held requests; a test asserts it is above 0.
 */
export async function holdChunksUntil(
  page: Page,
): Promise<{ readonly release: () => void; readonly held: () => number }> {
  let release = (): void => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let held = 0
  await page.route(
    (url) => url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js'),
    async (route) => {
      held++
      await Promise.race([released, new Promise((resolve) => setTimeout(resolve, 15_000))])
      await route.continue().catch(() => undefined)
    },
  )
  return { release: () => release(), held: () => held }
}

/** Where the P1-3 exit screens go: storyboard/migration-input/step12-screens/ (git-ignored). */
const STEP12_SCREENS_DIR = path.join(ROOT, 'migration-input', 'step12-screens')

/** W9: a P1-3 screen's file, <nn>-<screen>-<project>-<scale>.png. */
export function step12ScreenPath(
  nn: string,
  name: string,
  project: string,
  scale: TextScale,
): string {
  return path.join(STEP12_SCREENS_DIR, `${nn}-${name}-${project}-${scale}.png`)
}

/** W10: what /build-info.json says about the build's stories (the ids are read at run time). */
export interface BuildInfoStories {
  readonly featuredStoryId: string | null
  readonly storyIds: readonly string[]
}

/** W10: GET /build-info.json (200 on the open legs), parsed for the featured id and the story ids. */
export async function buildInfo(request: APIRequestContext): Promise<BuildInfoStories> {
  const response = await request.get('/build-info.json')
  expect(response.status(), 'precondition: /build-info.json').toBe(200)
  const info = (await response.json()) as {
    featuredStoryId?: unknown
    stories?: { storyId?: unknown }[]
  }
  const storyIds = (info.stories ?? []).map((story) => story.storyId)
  if (!storyIds.every((id): id is string => typeof id === 'string')) {
    throw new Error('/build-info.json: a story without a storyId')
  }
  const featured = info.featuredStoryId
  if (featured !== null && typeof featured !== 'string') {
    throw new Error('/build-info.json: featuredStoryId is neither a string nor null')
  }
  return { featuredStoryId: featured, storyIds }
}

/**
 * W12: fixes the page's Date.now() at `iso` (page.clock.setFixedTime: Date only; timers and
 * performance.now() keep running, PR-2) before the first navigation. expectFixedClock is the hard
 * precondition after the first load (S12-AUD-1).
 */
export async function fixedClock(page: Page, iso: string): Promise<void> {
  await page.clock.setFixedTime(new Date(iso))
}

export async function expectFixedClock(page: Page, iso: string): Promise<void> {
  expect(
    await page.evaluate(() => Date.now()),
    `precondition: Date.now() in the page is ${iso}`,
  ).toBe(new Date(iso).getTime())
}
