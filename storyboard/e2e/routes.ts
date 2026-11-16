// The routes each e2e leg checks and what each one serves (P1 D4, D8; design p1-step7-design.md
// §1 "What each route renders", §8.3 "New specs"; P1-1c), plus the few helpers the P1-1c specs
// share. Not a spec: Playwright does not let one spec import another.
// - Gated leg: "/" is the Coming-soon page; every reader route is the bilingual 404.
// - Review leg: "/" is the language gate; /{code} and /{code}/grown-ups are 200 for every enabled
//   locale, with <html lang dir> from the registry.
// - Both legs: every unmatched URL is the bilingual 404 (lang en, Hindi parts in lang="hi").
// The UI strings are read from messages/*.json as text: only src/ui/i18n/messages.ts imports the
// catalogues (lint fence, design §8.2).
// P1-4b (design p1-step10-design.md §2.1 e2e/routes.ts, §9.3; Step 10a): the story player at
// /{code}/stories/{storyId}/read.
// - playerPaths(): every story of the fixtures catalogue (the one the review and staging builds
//   load) in every enabled locale its package has. The gated build serves none of them.
// - PLAYER_DOC_PATHS: two-paths in each enabled locale, kind 'player'. legRoutes adds them on the
//   open legs only, so the shared document, shell and staging-banner loops visit a player page.
// - PLAYER_NOT_FOUND_PATHS: player-shaped URLs no build serves (T-a21; 10e adds the picture id).
// - formatted(): a UI string that takes arguments, formatted by the app's own ICU subset.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { APP_NAME } from '../src/core/app-info'
import { formatMessage, parseMessage, type MessageValues } from '../src/core/i18n/message-format'
import { ENABLED_LOCALE_CODES, getLocaleDef, type LocaleCode } from '../src/core/locales'
import { legOpen, type LaunchLeg } from './launch-leg'

const ROOT = path.resolve(__dirname, '..')

// ---------------------------------------------------------------------------------------------
// UI strings

/** The locales with a UI catalogue (messages/{en,hi}.json). */
export type UiLang = 'en' | 'hi'

const catalogues = new Map<UiLang, Readonly<Record<string, string>>>()

/** One catalogue value as stored, arguments unformatted. */
function rawMessage(lang: UiLang, key: string): string {
  let catalogue = catalogues.get(lang)
  if (!catalogue) {
    catalogue = JSON.parse(
      readFileSync(path.join(ROOT, 'messages', `${lang}.json`), 'utf8'),
    ) as Record<string, string>
    catalogues.set(lang, catalogue)
  }
  const value = catalogue[key]
  if (value === undefined) throw new Error(`messages/${lang}.json has no key ${key}`)
  return value
}

/** One UI string as the page shows it. Step 7's strings take no arguments, so it is the raw value. */
export function message(lang: UiLang, key: string): string {
  const value = rawMessage(lang, key)
  if (/[{}]/.test(value)) throw new Error(`${lang} ${key} takes arguments; format it first`)
  return value
}

/**
 * One UI string that takes arguments, as the page shows it: the app's own ICU subset formats it
 * (src/core/i18n/message-format.ts, the parser and formatter the server's t() uses), so a missing
 * or extra argument throws here as it would in the build.
 */
export function formatted(lang: UiLang, key: string, values: MessageValues): string {
  return formatMessage(lang, parseMessage(rawMessage(lang, key)), values)
}

/** The UI language of an enabled reader locale. */
export function uiLang(code: LocaleCode): UiLang {
  if (code === 'en' || code === 'hi') return code
  throw new Error(`no UI catalogue for ${code}`)
}

// ---------------------------------------------------------------------------------------------
// Routes

export type RouteKind = 'coming-soon' | 'gate' | 'home' | 'grown-ups' | 'player' | 'not-found'

export interface LegRoute {
  readonly path: string
  readonly status: 200 | 404
  readonly kind: RouteKind
  /** <html lang> and dir: from the URL's locale and the registry, en for "/" and the 404. */
  readonly lang: LocaleCode
  readonly dir: 'ltr' | 'rtl'
  /** The exact document title (design §3.12 #17). */
  readonly title: string
}

export const NOT_FOUND_TITLE = `Page not found – ${APP_NAME}`

/** The unmatched URLs of design §1, the same 404 page on both legs. */
export const NOT_FOUND_PATHS = [
  '/no-such-page',
  '/ar',
  '/xx',
  '/EN',
  '/en/nope',
  '/hi/nope',
  '/write/x',
  '/studio/x',
] as const

/** The 404 page as a route of the list. */
export function notFoundRoute(routePath: string): LegRoute {
  return {
    path: routePath,
    status: 404,
    kind: 'not-found',
    lang: 'en',
    dir: 'ltr',
    title: NOT_FOUND_TITLE,
  }
}

/** Every reader route of an open build: home and Grown-ups for each enabled locale. */
export function readerPaths(): { path: string; code: LocaleCode; kind: 'home' | 'grown-ups' }[] {
  return ENABLED_LOCALE_CODES.flatMap((code) => [
    { path: `/${code}`, code, kind: 'home' as const },
    { path: `/${code}/grown-ups`, code, kind: 'grown-ups' as const },
  ])
}

/**
 * "/" and every reader route, as the leg's build serves them. The open legs add the two player
 * pages of PLAYER_DOC_PATHS (kind 'player'); the gated leg's player check is its own test.
 */
export function legRoutes(leg: LaunchLeg): LegRoute[] {
  const start: LegRoute = {
    path: '/',
    status: 200,
    kind: leg === 'gated' ? 'coming-soon' : 'gate',
    lang: 'en',
    dir: 'ltr',
    title: APP_NAME,
  }
  const reader = readerPaths().map(({ path: routePath, code, kind }): LegRoute => {
    if (leg === 'gated') return notFoundRoute(routePath)
    const title =
      kind === 'home' ? APP_NAME : `${message(uiLang(code), 'grownUps.title')} – ${APP_NAME}`
    return { path: routePath, status: 200, kind, lang: code, dir: getLocaleDef(code).dir, title }
  })
  const player = legOpen(leg)
    ? PLAYER_DOC_PATHS.map(({ path: routePath, code, storyId }): LegRoute => ({
        path: routePath,
        status: 200,
        kind: 'player',
        lang: code,
        dir: getLocaleDef(code).dir,
        // The story's title in the URL locale through the [locale] layout's template.
        title: `${playerFixture(storyId).text[code]?.title ?? ''} – ${APP_NAME}`,
      }))
    : []
  return [start, ...reader, ...player]
}

/** The leg's routes plus one unmatched URL: the document checks cover the 404 page too. */
export function documentRoutes(leg: LaunchLeg): LegRoute[] {
  return [...legRoutes(leg), notFoundRoute('/no-such-page')]
}

// ---------------------------------------------------------------------------------------------
// The story player (P1-4b)

/** One node of a fixture package: its type and its choices in package order. */
export interface PlayerFixtureNode {
  readonly id: string
  readonly type: string
  readonly choices?: readonly { readonly id: string; readonly next: string }[]
}

/** One node's text in one locale, as stored. */
export interface PlayerFixtureNodeText {
  readonly text: string
  readonly question?: string
  readonly choices?: Readonly<Record<string, string>>
  readonly lesson?: string
}

/** The fields of a fixture package the e2e specs read (fixtures/packages/*.json, read only). */
export interface PlayerFixture {
  readonly storyId: string
  readonly version: number
  readonly locales: readonly string[]
  readonly startNodeId: string
  readonly nodes: readonly PlayerFixtureNode[]
  readonly text: Readonly<
    Record<
      string,
      { readonly title: string; readonly nodes: Readonly<Record<string, PlayerFixtureNodeText>> }
    >
  >
}

const FIXTURES = path.join(ROOT, 'fixtures')

/** The fixtures catalogue's stories in its order: the stories a review or staging build lists. */
function fixtureCatalogue(): { storyId: string; packagePath: string }[] {
  const pointer = JSON.parse(
    readFileSync(path.join(FIXTURES, 'catalogue', 'fixtures.json'), 'utf8'),
  ) as { snapshotPath: string }
  const snapshot = JSON.parse(readFileSync(path.join(FIXTURES, pointer.snapshotPath), 'utf8')) as {
    stories: { storyId: string; packagePath: string }[]
  }
  return snapshot.stories.map(({ storyId, packagePath }) => ({ storyId, packagePath }))
}

const playerFixtures = new Map<string, PlayerFixture>()

/** One fixture package by story id (read once per worker). */
export function playerFixture(storyId: string): PlayerFixture {
  let fixture = playerFixtures.get(storyId)
  if (!fixture) {
    const entry = fixtureCatalogue().find((story) => story.storyId === storyId)
    if (!entry) throw new Error(`the fixtures catalogue has no story ${storyId}`)
    fixture = JSON.parse(
      readFileSync(path.join(FIXTURES, entry.packagePath), 'utf8'),
    ) as PlayerFixture
    if (fixture.storyId !== storyId) throw new Error(`${entry.packagePath} is not ${storyId}`)
    playerFixtures.set(storyId, fixture)
  }
  return fixture
}

/** The player URL of one story in one locale. */
export function playerPath(code: LocaleCode, storyId: string): string {
  return `/${code}/stories/${storyId}/read`
}

/** One player page of an open build. */
export interface PlayerPage {
  readonly path: string
  readonly code: LocaleCode
  readonly storyId: string
}

/**
 * Every player page a review or staging build serves: each catalogue story in each enabled locale
 * its package has, in registry order (3 fixtures × en, hi). The gated build serves none.
 */
export function playerPaths(): PlayerPage[] {
  return fixtureCatalogue().flatMap(({ storyId }) =>
    ENABLED_LOCALE_CODES.filter((code) => playerFixture(storyId).locales.includes(code)).map(
      (code) => ({ path: playerPath(code, storyId), code, storyId }),
    ),
  )
}

/** The player pages the shared document, shell and staging-banner loops visit: two-paths. */
export const PLAYER_DOC_PATHS: readonly PlayerPage[] = playerPaths().filter(
  (page) => page.storyId === 'two-paths',
)

/**
 * Player-shaped URLs that no build serves (T-a21; design C20): an unknown story, an unknown last
 * segment, the story URL without /read (until Step 12), /en/stories, a locale that is not enabled
 * and an upper-case story id. Each is the bilingual 404 on every leg. The trailing-slash form is
 * not here: Next answers it with a 308 to the real page.
 */
export const PLAYER_NOT_FOUND_PATHS = [
  '/en/stories/nope/read',
  '/hi/stories/two-paths/nope',
  '/en/stories/two-paths',
  '/en/stories',
  '/ar/stories/two-paths/read',
  '/en/stories/TWO-PATHS/read',
] as const

// ---------------------------------------------------------------------------------------------
// Page helpers

/**
 * Waits until React has hydrated <main> (its DOM node carries React's fiber key), then two frames
 * and a task, so the effects of that commit (ChoiceRecorder, StorageBanner) have run.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const main = document.querySelector('main')
    return main !== null && Object.keys(main).some((key) => key.startsWith('__reactFiber$'))
  })
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)))
      }),
  )
}

/** Before any page script: reading window.localStorage throws SecurityError (storage blocked). */
export async function blockStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('e2e: storage blocked', 'SecurityError')
      },
    })
  })
}

/**
 * Before any page script: every localStorage write throws QuotaExceededError; reads still work.
 * Add it after seedPrefs, which seeds with the real setItem.
 */
export async function failStorageWrites(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true,
      writable: true,
      value: function () {
        throw new DOMException('e2e: quota exceeded', 'QuotaExceededError')
      },
    })
  })
}

/**
 * Before any page script: records every layout shift with its hadRecentInput flag (Chromium
 * only). Under Playwright, Chromium flags shifts in the first 500 ms after page.goto as recent
 * input although no input was sent (probe 2026-11-15: the storage banner's shift on /en), so both
 * sums are kept: CLS by its definition leaves those out, the raw sum keeps them.
 */
export async function recordLayoutShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    const shifts: { value: number; input: boolean }[] = []
    w['__e2eShifts'] = shifts
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
        shifts.push({ value: shift.value, input: shift.hadRecentInput })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
}

/**
 * The layout shifts so far, summed (stricter than CLS's session window): `cls` without the shifts
 * flagged as recent input, `raw` with them, and how many shifts there were of each.
 */
export async function layoutShift(
  page: Page,
): Promise<{ cls: number; raw: number; shifts: number; inputShifts: number }> {
  const shifts = await page.evaluate(
    () =>
      ((window as unknown as Record<string, unknown>)['__e2eShifts'] as
        { value: number; input: boolean }[] | undefined) ?? [],
  )
  const sum = (list: { value: number }[]) => list.reduce((total, shift) => total + shift.value, 0)
  const counted = shifts.filter((shift) => !shift.input)
  return {
    cls: sum(counted),
    raw: sum(shifts),
    shifts: counted.length,
    inputShifts: shifts.length - counted.length,
  }
}

/** One [aria-live] element the page holds. */
export interface LiveRegionInfo {
  readonly role: string | null
  readonly live: string | null
  readonly atomic: string | null
  readonly text: string
}

/**
 * Every [aria-live] element, open shadow roots included, except inside Next's own route announcer
 * (next-route-announcer, an assertive region in an open shadow root: framework-owned, design §3.12
 * #13). Playwright locators pierce open shadow roots, so a locator count would include it.
 */
export async function liveRegions(page: Page): Promise<LiveRegionInfo[]> {
  return page.evaluate(() => {
    const found: LiveRegionInfo[] = []
    const visit = (root: Document | ShadowRoot) => {
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot && element.localName !== 'next-route-announcer') {
          visit(element.shadowRoot)
        }
        if (element.hasAttribute('aria-live')) {
          found.push({
            role: element.getAttribute('role'),
            live: element.getAttribute('aria-live'),
            atomic: element.getAttribute('aria-atomic'),
            text: element.textContent ?? '',
          })
        }
      }
    }
    visit(document)
    return found
  })
}

/**
 * Puts keyboard focus on `selector` for WebKit, where Tab cannot: Playwright's WebKit on Windows
 * never moves keyboard focus to a link (Tab and Alt+Tab both stay on body; probe 2026-11-15:
 * WebKit inverts tabs-to-links with Alt only on Cocoa). A Shift press first makes the last
 * interaction a keyboard one, so the focused link draws its :focus-visible ring. Returns whether
 * :focus-visible matched.
 */
export async function focusLinkForWebKit(page: Page, selector: string): Promise<boolean> {
  await page.keyboard.press('Shift')
  await page.locator(selector).focus()
  return page.locator(selector).evaluate((element) => element.matches(':focus-visible'))
}
