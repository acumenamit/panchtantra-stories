// The Home shelf, P1-3 Step 12a (spec §6.1 Home, SPEC:433; design p1-step12-design.md §3.1-§3.7,
// §3.13, §4.1-§4.4, §4.6, §4.11, §4.12, §5, §7, §8, §13.1, §13.4.1 E12-H1 to E12-H16). Review and
// staging legs (@review), all 5 projects.
// - Hooks (design §4.11): [data-home-list], [data-story-card="<id>"][data-added-on], [data-featured],
//   [data-badge-cell][data-shown][data-found], [data-badge], [data-continue], [data-continue-cell],
//   [data-continue-story="<id>"], [data-continue-empty], [data-home-progress][data-phase].
// - Every test collects console errors and page errors (an auto fixture) and fails on any: a
//   hydration mismatch is a page error (React #418). Only the wide variants declare the aborted
//   font files (Chromium logs each).
// - Story ids: the fixtures are named; the staging-only stories never are (the e2e id scan,
//   CRIT-4): their ids come from the page (data-story-card) and /build-info.json at run time. Cards
//   are found by data-story-card, never by title (four staging cards share one, CRIT-15). Only
//   E12-H12 taps the hero, after a hard check that it links to the featured story's landing.
// - Clock (8.3, S12-AUD-1): every test that reads a badge, or whose precondition names one, fixes
//   Date.now() at 2026-11-18T12:00:00Z (W12) before its first navigation and checks it after the
//   first load: lantern-walk and river-stones (2026-11-13) are then New, two-paths (2026-10-21) not.
// - Reserved cells (13.1 I): a variant is shown when its visibility is visible and it has no
//   aria-hidden; hidden when its visibility is hidden and aria-hidden="true". Boxes are compared by
//   W2 (0.01 px).
// - Hold rows (13.1 C, 13.9): the hold watch (W1) stamps every set and removal of data-nav-hold and
//   every pointerdown and click in the page; its self-check comes first. A second tap 450 ms or more
//   after the hold began retries on a fresh page, at most 3 times; it never passes late.
// - Run-time answers (13.8; PR-5): E12-H4 asks for the time zone emulation, E12-H6 for a viewport
//   prefetch, E12-H7a for the PageTransitionEvent constructor, E12-H7b for a storage event in the
//   other page (WebKit gives none: PR-5 g7) and E12-H13 for Tab reaching links; each skips with the
//   engine and the answer named.
// - Round 1b (design §16 F3): E12-H2 g4 also taps 1 px inside the top colour bar and 1 px inside
//   the inline-start border; the stretched link covers the card's border box.
// - Round 2 (design §18): E12-H2 g4 also checks the bar and border widths, 1 px inside the bottom
//   and inline-end borders (the link) and 1 px inside each border-box corner, outside the rounded
//   corner (not the link).
import type { Page } from '@playwright/test'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../src/core/locales'
import { PROGRESS_KEY, RECORD_SCHEMA, serializeProgress } from '../src/core/progress/records'
import { boxDifferences, orderByRule, type BoxSet } from '../scripts/testing/e2e-readers'
import { expect, test as base } from './fixtures'
import { launchLeg } from './launch-leg'
import {
  afterHold,
  armBox,
  attemptPage,
  boxesAt,
  boxesOf,
  buildInfo,
  centreInViewport,
  consoleErrors,
  expectFixedClock,
  expectHoldWatch,
  expectStep12Variant,
  fixedClock,
  frames,
  holdChunksUntil,
  holdRecord,
  holdSpans,
  LATE_TAP_MS,
  prepareStep12Variant,
  progressSpy,
  scrollToBottom,
  seedProgressOnce,
  seedRawProgressOnce,
  settleFonts,
  STEP12_VARIANTS,
  tabReachesLinks,
  variantSkip,
  variantTitle,
  watchNavHold,
  withHoldRetry,
  type ConsoleErrors,
  type HoldAttempt,
  type Step12Variant,
} from './page-helpers'
import {
  blockStorage,
  formatted,
  landingPath,
  layoutShift,
  message,
  playerFixture,
  playerPath,
  playerPaths,
  recordLayoutShifts,
  storyFields,
  uiLang,
  waitForHydration,
} from './routes'

const test = base.extend<{ errors: ConsoleErrors }>({
  errors: [
    async ({ page, browserName }, use) => {
      const errors = consoleErrors(page)
      await use(errors)
      errors.check(browserName)
    },
    { auto: true },
  ],
})

const LEG = launchLeg(process.env.E2E_LAUNCH)
/** The badge tests' clock (8.3). */
const CLOCK = '2026-11-18T12:00:00Z'
/** SPEC:433's 7 days, written out (never the product's NEW_FOR_MS). */
const NEW_FOR_MS = 7 * 86_400_000
/** The fixtures every open build lists, the only stories a test names. */
const FIXTURE_IDS = [...new Set(playerPaths().map((page) => page.storyId))]
const LIST = '[data-home-list]'
const LIST_CARDS = `${LIST} [data-story-card]`
const CONTINUE = 'section[data-continue]'
const CONTINUE_CELL = '[data-continue-cell]'
const FEATURED = '[data-featured]'
const BANNER = 'section[aria-labelledby="storage-banner-title"]'
const START_AGAIN = '[data-actions] [data-start-again]'

/** A saved run in `code` (activeRun non-null: a choice made, not finished). */
function runIn(code: LocaleCode, path: readonly string[]) {
  return { activeRun: { path, locale: code } }
}

/** SPEC:433, the legacy isNew: now minus UTC midnight of addedOn at most 7 days, negatives too. */
function isNewByRule(addedOn: string, now: number): boolean {
  const [year = 0, month = 1, day = 1] = addedOn.split('-').map(Number)
  return now - Date.UTC(year, month - 1, day) <= NEW_FOR_MS
}

async function openHome(page: Page, code: LocaleCode): Promise<void> {
  const response = await page.goto(`/${code}`)
  expect(response?.status(), `/${code}`).toBe(200)
}

/** Waits until the progress read has ended: no badge cell and no Continue cell is pending. */
async function waitForRead(page: Page): Promise<void> {
  await expect(
    page.locator('[data-badge-cell]').first(),
    'precondition: a badge cell',
  ).toBeAttached()
  await expect(
    page.locator(`[data-badge-cell][data-shown="pending"], ${CONTINUE_CELL}[data-shown="pending"]`),
    'precondition: the progress read ended (no cell pending)',
  ).toHaveCount(0)
}

interface VariantState {
  readonly badge: string
  readonly found: string | null
  readonly visibility: string
  readonly ariaHidden: string | null
  readonly text: string
}

interface CellState {
  readonly shown: string | null
  readonly found: string | null
  readonly variants: readonly VariantState[]
}

const isShown = (v: { visibility: string; ariaHidden: string | null }): boolean =>
  v.visibility === 'visible' && v.ariaHidden === null
const isHidden = (v: { visibility: string; ariaHidden: string | null }): boolean =>
  v.visibility === 'hidden' && v.ariaHidden === 'true'

/** One list card's badge cell: its data-shown, data-found and every variant's state. */
async function cellOf(page: Page, id: string): Promise<CellState> {
  return page.locator(`${LIST} [data-story-card="${id}"] [data-badge-cell]`).evaluate((cell) => ({
    shown: cell.getAttribute('data-shown'),
    found: cell.getAttribute('data-found'),
    variants: [...cell.querySelectorAll('[data-badge]')].map((variant) => ({
      badge: variant.getAttribute('data-badge') ?? '',
      found: variant.getAttribute('data-found'),
      visibility: getComputedStyle(variant).visibility,
      ariaHidden: variant.getAttribute('aria-hidden'),
      text: (variant.textContent ?? '').trim(),
    })),
  }))
}

/** The shown variants' texts, and the variants neither shown nor hidden as 13.1 I says. */
function readCell(cell: CellState): { texts: string[]; broken: string[] } {
  return {
    texts: cell.variants.filter(isShown).map((v) => v.text),
    broken: cell.variants
      .filter((v) => !isShown(v) && !isHidden(v))
      .map(
        (v) =>
          `${v.badge}${v.found === null ? '' : ` ${v.found}`}: ${v.visibility}, aria-hidden ${String(v.ariaHidden)}`,
      ),
  }
}

/** The list cards in DOM order: id and data-added-on. */
async function listCards(page: Page): Promise<{ id: string; addedOn: string }[]> {
  return page.locator(LIST_CARDS).evaluateAll((cards) =>
    cards.map((card) => ({
      id: card.getAttribute('data-story-card') ?? '',
      addedOn: card.getAttribute('data-added-on') ?? '',
    })),
  )
}

interface ContinueState {
  readonly shown: string | null
  readonly cards: readonly {
    id: string
    visibility: string
    ariaHidden: string | null
    href: string | null
  }[]
  readonly empty: { visibility: string; ariaHidden: string | null; text: string } | null
}

async function continueOf(page: Page): Promise<ContinueState> {
  return page.locator(CONTINUE_CELL).evaluate((cell) => {
    const empty = cell.querySelector('[data-continue-empty]')
    return {
      shown: cell.getAttribute('data-shown'),
      cards: [...cell.querySelectorAll('[data-continue-story]')].map((card) => ({
        id: card.getAttribute('data-continue-story') ?? '',
        visibility: getComputedStyle(card).visibility,
        ariaHidden: card.getAttribute('aria-hidden'),
        href: card.querySelector('a')?.getAttribute('href') ?? null,
      })),
      empty:
        empty === null
          ? null
          : {
              visibility: getComputedStyle(empty).visibility,
              ariaHidden: empty.getAttribute('aria-hidden'),
              text: (empty.textContent ?? '').trim(),
            },
    }
  })
}

/** The box selectors E12-H5 compares (13.4.1): the cells, the cards and what holds them. */
function homeBoxes(): string[] {
  return [
    'main',
    'main h1',
    CONTINUE,
    CONTINUE_CELL,
    LIST,
    LIST_CARDS,
    `${LIST_CARDS} [data-badge-cell]`,
    `${LIST_CARDS} :has(> [data-badge-cell])`,
    ...(LEG === 'staging' ? [FEATURED] : []),
  ]
}

test.describe('the Home shelf, Step 12', { tag: '@review' }, () => {
  for (const code of ENABLED_LOCALE_CODES) {
    test(`E12-H1 /${code}: h1, Continue reading, Featured on staging, All stories, in order`, async ({
      page,
      request,
    }) => {
      const lang = uiLang(code)
      const info = await buildInfo(request)
      expect(
        info.storyIds.length,
        'precondition: build-info lists 3 stories or more',
      ).toBeGreaterThanOrEqual(3)
      const staging = LEG === 'staging'
      if (staging) {
        expect(
          info.featuredStoryId,
          'precondition: the staging build names a featured story',
        ).not.toBeNull()
      } else {
        expect(
          info.featuredStoryId,
          'precondition: the review build names no featured story',
        ).toBeNull()
      }
      await openHome(page, code)
      const order = await page.locator('main').evaluate((main) =>
        [
          ...main.querySelectorAll(
            'h1, h2, section[data-continue], [data-featured], ul[data-home-list]',
          ),
        ].map((element) => {
          const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (element.matches('h1, h2')) return `${element.localName} ${text}`
          if (element.matches('[data-continue]')) return `continue ${element.localName}`
          if (element.matches('[data-featured]')) return 'featured'
          return `list role=${element.getAttribute('role') ?? 'none'}`
        }),
      )
      expect
        .soft(order, '(g1) main in order')
        .toEqual([
          `h1 ${message(lang, 'home.title')}`,
          'continue section',
          `h2 ${message(lang, 'home.continueReading')}`,
          ...(staging ? ['featured', `h2 ${message(lang, 'home.featured')}`] : []),
          `h2 ${message(lang, 'player.allStories')}`,
          'list role=list',
        ])
      const heroIds = await page
        .locator(`${FEATURED} [data-story-card]`)
        .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-story-card')))
      expect
        .soft(await page.locator(FEATURED).count(), '(g2) Featured sections')
        .toBe(staging ? 1 : 0)
      expect
        .soft(heroIds, '(g2) the hero is the featured story of build-info')
        .toEqual(staging ? [info.featuredStoryId] : [])
      if (staging) {
        expect
          .soft(
            (await listCards(page)).map((card) => card.id),
            '(g3) the featured story is listed too',
          )
          .toContain(info.featuredStoryId)
      }
      const levels = await page
        .locator('main')
        .evaluate((main) =>
          [...main.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.localName[1])),
        )
      const skipped = levels.filter(
        (level, index) => index > 0 && level > (levels[index - 1] ?? 0) + 1,
      )
      expect
        .soft(
          levels.filter((level) => level === 1),
          '(g4) one h1',
        )
        .toHaveLength(1)
      expect.soft(levels[0], '(g4) the h1 comes first').toBe(1)
      expect.soft(skipped, `(g4) no skipped heading level (${levels.join(' ')})`).toEqual([])
    })
  }

  for (const code of ENABLED_LOCALE_CODES) {
    test(`E12-H2 /${code}: one card per story in addedOn order, each with its stored fields`, async ({
      page,
      request,
    }) => {
      const lang = uiLang(code)
      const info = await buildInfo(request)
      await openHome(page, code)
      await waitForRead(page)
      expect(
        await page.evaluate(() => document.documentElement.hasAttribute('data-nav-hold')),
        'precondition: no hold on the page',
      ).toBe(false)
      const cards = await listCards(page)
      expect
        .soft(
          cards.map((card) => card.id),
          '(g1) the cards in the order of their rule',
        )
        .toEqual(orderByRule(cards))
      expect
        .soft(
          cards.map((card) => card.id).sort(),
          '(g1) one card per built story and no other (RC-5)',
        )
        .toEqual([...info.storyIds].sort())
      for (const card of cards) {
        expect
          .soft(card.addedOn, `(g2) ${card.id}: data-added-on is a date`)
          .toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
      for (const id of FIXTURE_IDS) {
        const fields = storyFields(id, code)
        expect
          .soft(
            cards.find((card) => card.id === id)?.addedOn,
            `(g2) ${id}: data-added-on is the package's addedOn`,
          )
          .toBe(fields.addedOn)
        const card = await page.locator(`${LIST} [data-story-card="${id}"]`).evaluate(
          (element, wanted) => {
            const has = (text: string) =>
              [...element.querySelectorAll('*')].some((e) => (e.textContent ?? '').trim() === text)
            const titleLink = element.querySelector('h3 > a, h3 a')
            return {
              links: element.querySelectorAll('a').length,
              buttons: element.querySelectorAll('button').length,
              href: titleLink?.getAttribute('href') ?? null,
              title: (titleLink?.textContent ?? '').trim(),
              book: has(wanted.book),
              description: has(wanted.description),
              age: has(wanted.age),
              duration: has(wanted.duration),
              color: getComputedStyle(element)
                .getPropertyValue('--story-color')
                .trim()
                .toLowerCase(),
              emojiHidden: [...element.querySelectorAll('*')].some(
                (e) =>
                  (e.textContent ?? '').trim() === wanted.emoji &&
                  e.closest('[aria-hidden="true"]') !== null,
              ),
            }
          },
          {
            book: fields.book,
            description: fields.description,
            age: formatted(lang, 'story.age', { age: fields.age }),
            duration: fields.duration,
            emoji: fields.emoji,
          },
        )
        expect.soft(card.book, `(g3) ${id}: the book label as stored`).toBe(true)
        expect
          .soft([card.href, card.title], `(g3) ${id}: the title in h3 > a, to the landing`)
          .toEqual([landingPath(code, id), fields.title])
        expect.soft(card.description, `(g3) ${id}: the description as stored`).toBe(true)
        expect.soft(card.age, `(g3) ${id}: the age line (story.age)`).toBe(true)
        expect.soft(card.duration, `(g3) ${id}: the duration as stored`).toBe(true)
        expect
          .soft(card.color, `(g3) ${id}: --story-color is the package colour`)
          .toBe(fields.color.toLowerCase())
        expect
          .soft(card.emojiHidden, `(g3) ${id}: the emoji inside an aria-hidden element`)
          .toBe(true)
        expect
          .soft([card.links, card.buttons], `(g3) ${id}: exactly one link and no button`)
          .toEqual([1, 0])

        // (g4) The whole card is the target: points inside its rounded corners and the meta line's
        // centre hit its one link (PR-5 g9: radius + 2 px holds on both engines; 6 px at least).
        const hits = await page.locator(`${LIST} [data-story-card="${id}"]`).evaluate((element) => {
          element.scrollIntoView({ block: 'center' })
          const style = getComputedStyle(element)
          const radius = Math.max(
            ...[
              style.borderTopLeftRadius,
              style.borderTopRightRadius,
              style.borderBottomLeftRadius,
              style.borderBottomRightRadius,
            ].map((value) => parseFloat(value) || 0),
          )
          const inset = Math.max(radius + 2, 6)
          const box = element.getBoundingClientRect()
          const meta = element
            .querySelector('[data-badge-cell]')
            ?.parentElement?.getBoundingClientRect()
          const link = element.querySelector('a')
          // Round 1b (design §16 F3): the stretched link covers the border box, so a point 1 px
          // inside the top colour bar and one 1 px inside the inline-start border hit it too.
          const edge = (x: number, y: number) => {
            const found = document.elementFromPoint(x, y)
            return {
              ok: link !== null && found?.closest('a') === link,
              found: found
                ? `${found.localName}${found.getAttribute('class') ? '.' + (found.getAttribute('class') ?? '') : ''}`
                : 'nothing',
            }
          }
          const bar = edge(box.left + box.width / 2, box.top + 1)
          const side = edge(box.left + 1, box.top + box.height / 2)
          // Round 2 (R2-TPP-5): the bottom and inline-end borders too (en and hi are both ltr).
          const bottom = edge(box.left + box.width / 2, box.bottom - 1)
          const end = edge(box.right - 1, box.top + box.height / 2)
          // Round 2 (LAYOUT-12a-R2-3): 1 px inside each corner of the border box lies outside the
          // rounded corner while the corner's radius r has (r - 1) * sqrt(2) > r, so the link's
          // ::after (the card's radius) must not take it; the corner's own radius is read.
          const corners = (
            [
              ['top-left', box.left + 1, box.top + 1, style.borderTopLeftRadius],
              ['top-right', box.right - 1, box.top + 1, style.borderTopRightRadius],
              ['bottom-left', box.left + 1, box.bottom - 1, style.borderBottomLeftRadius],
              ['bottom-right', box.right - 1, box.bottom - 1, style.borderBottomRightRadius],
            ] as const
          ).flatMap(([name, x, y, value]) => {
            const r = parseFloat(value) || 0
            if ((r - 1) * Math.SQRT2 <= r) return [`${name}: radius ${r} px puts the point inside`]
            const found = edge(x, y)
            return found.ok ? [`${name}: ${found.found}`] : []
          })
          const points = [
            ['top-left', box.left + inset, box.top + inset],
            ['top-right', box.right - inset, box.top + inset],
            ['bottom-left', box.left + inset, box.bottom - inset],
            ['bottom-right', box.right - inset, box.bottom - inset],
            [
              'meta line',
              meta ? meta.left + meta.width / 2 : -1,
              meta ? meta.top + meta.height / 2 : -1,
            ],
          ] as const
          const widths = [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ]
          const [top = 0, right = 0, under = 0, left = 0] = widths.map((w) => parseFloat(w) || 0)
          return {
            inset,
            bar,
            side,
            bottom,
            end,
            corners,
            radius: style.borderTopLeftRadius,
            widths: widths.join(' '),
            widthsHold: top >= 4 && right >= 2 && under >= 2 && left >= 2,
            barWidth: style.borderTopWidth,
            sideWidth: style.borderLeftWidth,
            bottomWidth: style.borderBottomWidth,
            endWidth: style.borderRightWidth,
            misses: points
              .map(([name, x, y]) => {
                const found = document.elementFromPoint(x, y)
                return {
                  name,
                  ok: link !== null && found?.closest('a') === link,
                  found: found
                    ? `${found.localName}${found.getAttribute('class') ? '.' + (found.getAttribute('class') ?? '') : ''}`
                    : 'nothing',
                }
              })
              .filter((hit) => !hit.ok)
              .map((hit) => `${hit.name}: ${hit.found}`),
          }
        })
        expect
          .soft(hits.misses, `(g4) ${id}: points inset ${hits.inset} px that miss the card's link`)
          .toEqual([])
        // Round 2 (R2-TPP-5): the edge points below lie inside the bar and the borders only while
        // they are at least 4 px and 2 px wide; with no border they would sit in the padding box,
        // which the link covers anyway.
        expect
          .soft(
            hits.widthsHold,
            `(g4) ${id}: the colour bar is at least 4 px and each border at least 2 px (top right bottom left: ${hits.widths})`,
          )
          .toBe(true)
        expect
          .soft(
            hits.bar.ok,
            `(g4) ${id}: 1 px inside the top colour bar (${hits.barWidth}) hits the card's link (found ${hits.bar.found})`,
          )
          .toBe(true)
        expect
          .soft(
            hits.side.ok,
            `(g4) ${id}: 1 px inside the inline-start border (${hits.sideWidth}) hits the card's link (found ${hits.side.found})`,
          )
          .toBe(true)
        expect
          .soft(
            hits.bottom.ok,
            `(g4) ${id}: 1 px inside the bottom border (${hits.bottomWidth}) hits the card's link (found ${hits.bottom.found})`,
          )
          .toBe(true)
        expect
          .soft(
            hits.end.ok,
            `(g4) ${id}: 1 px inside the inline-end border (${hits.endWidth}) hits the card's link (found ${hits.end.found})`,
          )
          .toBe(true)
        expect
          .soft(
            hits.corners,
            `(g4) ${id}: points 1 px inside the border box's corners, outside the ${hits.radius} rounded corner, that hit the card's link`,
          )
          .toEqual([])
      }
    })
  }

  for (const code of ENABLED_LOCALE_CODES) {
    test(`E12-H3a /${code} new reader: New on the recent stories, the empty Continue line`, async ({
      page,
    }) => {
      const lang = uiLang(code)
      await fixedClock(page, CLOCK)
      await openHome(page, code)
      await expectFixedClock(page, CLOCK)
      expect(
        await page.evaluate((key) => window.localStorage.getItem(key), PROGRESS_KEY),
        'precondition: no progress record',
      ).toBeNull()
      // (g4)'s second half runs before waitForRead's hard precondition, so a first render that
      // differs from the server HTML only in attributes (React keeps the server's pending ones, the
      // MU12-33 class) fails at this group, not only at the precondition (review fix R1-3).
      await expect
        .soft(
          page.locator(
            `[data-badge-cell][data-shown="pending"], ${CONTINUE_CELL}[data-shown="pending"]`,
          ),
          '(g4) every cell leaves pending after the read',
        )
        .toHaveCount(0)
      await waitForRead(page)
      const now = Date.parse(CLOCK)
      const cards = await listCards(page)
      const shown: Record<string, string | null> = {}
      for (const card of cards) {
        const cell = await cellOf(page, card.id)
        shown[card.id] = cell.shown
        const expected = isNewByRule(card.addedOn, now) ? 'new' : 'none'
        expect
          .soft(cell.shown, `(g1) ${card.id} (added ${card.addedOn}) by the rule`)
          .toBe(expected)
        const { texts, broken } = readCell(cell)
        expect
          .soft(texts, `(g2) ${card.id}: the shown variant`)
          .toEqual(expected === 'new' ? [message(lang, 'home.new')] : [])
        expect.soft(broken, `(g2) ${card.id}: every other variant hidden`).toEqual([])
      }
      if (LEG === 'review') {
        expect
          .soft(shown, '(g1) review: the two 2026-11-13 fixtures New, two-paths not')
          .toEqual({ 'lantern-walk': 'new', 'river-stones': 'new', 'two-paths': 'none' })
      }
      const state = await continueOf(page)
      expect.soft(state.shown, '(g3) the Continue cell').toBe('empty')
      expect.soft(state.empty && isShown(state.empty), '(g3) the empty line shown').toBe(true)
      expect
        .soft(state.empty?.text, '(g3) the empty line')
        .toBe(message(lang, 'home.continueEmpty'))
      expect
        .soft(
          state.cards.filter((card) => !isHidden(card)).map((card) => card.id),
          '(g3) every Continue card hidden',
        )
        .toEqual([])
      const focusable = await page
        .locator(`${CONTINUE_CELL} [data-continue-story] a`)
        .evaluateAll((links) =>
          links
            .map((link) => {
              const before = document.activeElement
              ;(link as HTMLElement).focus()
              const moved = document.activeElement === link
              ;(before as HTMLElement | null)?.focus?.()
              return moved ? (link.getAttribute('href') ?? '') : null
            })
            .filter((href) => href !== null),
        )
      expect.soft(focusable, '(g3) hidden Continue card links take no focus').toEqual([])
      await expect
        .soft(page.locator('[data-home-progress]'), '(g4) the provider is ready')
        .toHaveAttribute('data-phase', 'ready')
    })
  }

  for (const code of ENABLED_LOCALE_CODES) {
    test(`E12-H3b /${code} returning reader: Reading, Finished 1 of 2, New; Continue river-stones`, async ({
      page,
    }) => {
      const lang = uiLang(code)
      await fixedClock(page, CLOCK)
      await seedProgressOnce(page, {
        'river-stones': runIn(code, ['start', 'flat_stones']),
        'two-paths': { activeRun: null, endingsFound: ['ending_wise'] },
      })
      await openHome(page, code)
      await expectFixedClock(page, CLOCK)
      await waitForRead(page)
      const river = await cellOf(page, 'river-stones')
      const two = await cellOf(page, 'two-paths')
      const lantern = await cellOf(page, 'lantern-walk')
      expect.soft(river.shown, '(g1) river-stones data-shown').toBe('reading')
      expect
        .soft(readCell(river).texts, '(g1) river-stones shows Reading')
        .toEqual([message(lang, 'home.reading')])
      expect
        .soft([two.shown, two.found], '(g1) two-paths data-shown and data-found')
        .toEqual(['finished', '1'])
      expect
        .soft(readCell(two).texts, '(g1) two-paths shows Finished 1 of 2')
        .toEqual([formatted(lang, 'home.finished', { found: 1, total: 2 })])
      expect.soft(lantern.shown, '(g1) lantern-walk data-shown').toBe('new')
      const state = await continueOf(page)
      expect.soft(state.shown, '(g2) the Continue cell').toBe('river-stones')
      expect
        .soft(
          state.cards.filter(isShown).map((card) => [card.id, card.href]),
          '(g2) the one shown Continue card',
        )
        .toEqual([['river-stones', playerPath(code, 'river-stones')]])
      expect
        .soft(state.empty !== null && isHidden(state.empty), '(g2) the empty line hidden')
        .toBe(true)
      for (const [id, cell] of [
        ['river-stones', river],
        ['two-paths', two],
        ['lantern-walk', lantern],
      ] as const) {
        expect.soft(readCell(cell).broken, `(g3) ${id}: every other variant hidden`).toEqual([])
      }
      expect
        .soft(
          state.cards
            .filter((card) => card.id !== 'river-stones' && !isHidden(card))
            .map((card) => card.id),
          '(g3) every other Continue card hidden',
        )
        .toEqual([])
    })
  }

  test('E12-H3c /en priority: Reading beats Finished; a stale ending is not started; Finished 2 of 2', async ({
    page,
  }) => {
    await fixedClock(page, CLOCK)
    await seedProgressOnce(page, {
      'river-stones': { ...runIn('en', ['start', 'flat_stones']), endingsFound: ['ending_dry'] },
      'lantern-walk': { activeRun: null, endingsFound: ['ending_gone'] },
      'two-paths': { activeRun: null, endingsFound: ['ending_wise', 'ending_quick'] },
    })
    await openHome(page, 'en')
    await expectFixedClock(page, CLOCK)
    await waitForRead(page)
    expect
      .soft((await cellOf(page, 'river-stones')).shown, '(g1) river-stones: Reading beats Finished')
      .toBe('reading')
    expect
      .soft(
        (await cellOf(page, 'lantern-walk')).shown,
        '(g2) lantern-walk: a stale ending is not started',
      )
      .toBe('new')
    const two = await cellOf(page, 'two-paths')
    expect
      .soft([two.shown, two.found], '(g3) two-paths finished, found 2')
      .toEqual(['finished', '2'])
    expect
      .soft(readCell(two).texts, '(g3) two-paths shows Finished 2 of 2')
      .toEqual([formatted('en', 'home.finished', { found: 2, total: 2 })])
    expect.soft((await continueOf(page)).shown, '(g4) Continue: river-stones').toBe('river-stones')
  })

  test('E12-H3d /en two saved runs: Continue is the higher order', async ({ page }) => {
    await fixedClock(page, CLOCK)
    await seedProgressOnce(page, {
      'river-stones': runIn('en', ['start', 'flat_stones']),
      'two-paths': runIn('en', ['start', 'wise_path']),
    })
    await openHome(page, 'en')
    await expectFixedClock(page, CLOCK)
    await waitForRead(page)
    const state = await continueOf(page)
    expect.soft(state.shown, '(g1) the Continue cell').toBe('two-paths')
    expect
      .soft(
        state.cards.filter(isShown).map((card) => card.id),
        '(g1) Continue shows two-paths only',
      )
      .toEqual(['two-paths'])
    expect
      .soft(
        [(await cellOf(page, 'river-stones')).shown, (await cellOf(page, 'two-paths')).shown],
        '(g2) both cards Reading',
      )
      .toEqual(['reading', 'reading'])
  })

  test.describe('in Asia/Kolkata', () => {
    test.use({ timezoneId: 'Asia/Kolkata' })
    for (const [id, clock, expected] of [
      ['E12-H4a', '2026-11-20T00:00:00.000Z', 'new'],
      ['E12-H4b', '2026-11-20T00:00:00.001Z', 'none'],
    ] as const) {
      test(`${id} /en in Asia/Kolkata at ${clock}: lantern-walk and river-stones show ${expected}, New ends 7 days after UTC midnight`, async ({
        page,
        browserName,
      }) => {
        await fixedClock(page, clock)
        await openHome(page, 'en')
        const zone = await page.evaluate(() => ({
          name: Intl.DateTimeFormat().resolvedOptions().timeZone,
          local: new Date(2026, 10, 13).getTime(),
          utc: Date.UTC(2026, 10, 13),
        }))
        const emulated =
          (zone.name === 'Asia/Kolkata' || zone.name === 'Asia/Calcutta') && zone.local !== zone.utc
        test.skip(
          !emulated,
          `timezoneId not emulated on ${browserName}: zone ${zone.name}, local midnight offset ${(zone.utc - zone.local) / 60_000} min`,
        )
        await expectFixedClock(page, clock)
        await waitForRead(page)
        expect
          .soft(
            [
              (await cellOf(page, 'lantern-walk')).shown,
              (await cellOf(page, 'river-stones')).shown,
            ],
            `${id}: lantern-walk and river-stones (added 2026-11-13) at ${clock}`,
          )
          .toEqual([expected, expected])
      })
    }
  })

  for (const variant of [STEP12_VARIANTS.V1, STEP12_VARIANTS.V2, STEP12_VARIANTS.V3]) {
    test(`E12-H5 ${variantTitle(variant)}: no box moves when progress is read, and a new and a returning reader get the same boxes`, async ({
      page,
      browserName,
      errors,
    }) => {
      const skip = variantSkip(variant, test.info().project.name)
      test.skip(skip !== null, skip ?? '')
      test.setTimeout(90_000)
      const { code } = variant
      const a = await readerBoxes(page, variant, errors, browserName, null)
      const second = await page.context().newPage()
      errors.watch(second)
      const b = await readerBoxes(second, variant, errors, browserName, {
        'river-stones': runIn(code, ['start', 'flat_stones']),
        'two-paths': { activeRun: null, endingsFound: ['ending_wise'] },
      })
      const report = `${variantTitle(variant)} (${test.info().project.name}): A raw shift ${a.raw ?? 'n/a'}, B raw shift ${b.raw ?? 'n/a'}`
      console.log(`[home-shelf] E12-H5 ${report}`)
      for (const line of [...a.lines, ...b.lines]) console.log(`[home-shelf] E12-H5 ${line}`)
      test.info().annotations.push({ type: 'E12-H5', description: report })
      expect
        .soft(
          boxDifferences(a.before, a.after),
          '(g1) page A (no record): boxes before and after the read',
        )
        .toEqual([])
      expect
        .soft(
          boxDifferences(b.before, b.after),
          '(g2) page B (a returning reader): boxes before and after the read',
        )
        .toEqual([])
      expect
        .soft(
          boxDifferences(a.after, b.after),
          '(g3) the same boxes for a new and a returning reader',
        )
        .toEqual([])
      if (browserName === 'chromium') {
        expect.soft(a.raw, '(g4) page A: the layout-shift sum from the release').toBe(0)
        expect.soft(b.raw, '(g4) page B: the layout-shift sum from the release').toBe(0)
      }
    })
  }

  test('E12-H6 /en: hidden Continue cards do not prefetch the player', async ({
    page,
    browserName,
  }) => {
    await seedProgressOnce(page, { 'river-stones': runIn('en', ['start', 'flat_stones']) })
    const readPath = (url: URL): string | null => {
      const match = /^(.*\/read)(?:\.rsc|\.segments\/.*)?$/.exec(url.pathname)
      return match?.[1] ?? null
    }
    const prefetched: string[] = []
    const answered: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      const path = readPath(url)
      if (path !== null && (url.searchParams.has('_rsc') || request.headers()['rsc'] === '1'))
        prefetched.push(path)
    })
    page.on('response', (response) => {
      const url = new URL(response.url())
      const path = readPath(url)
      if (
        path !== null &&
        (url.searchParams.has('_rsc') || response.request().headers()['rsc'] === '1')
      )
        answered.push(path)
    })
    await openHome(page, 'en')
    await waitForRead(page)
    const shown = playerPath('en', 'river-stones')
    const state = await continueOf(page)
    expect(state.shown, 'precondition: Continue shows river-stones').toBe('river-stones')
    const hidden = state.cards
      .filter((card) => isHidden(card) && card.href !== null)
      .map((card) => card.href ?? '')
    expect(hidden.length, 'precondition: hidden Continue cards to watch').toBeGreaterThan(0)
    for (let waited = 0; waited < 5000 && !answered.includes(shown); waited += 100) {
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
    }
    test.skip(
      !answered.includes(shown),
      `no viewport prefetch observed on ${browserName} within 5 s`,
    )
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1000)))
    expect
      .soft(
        prefetched.filter((path) => hidden.includes(path)),
        '(g1) prefetches of hidden Continue cards',
      )
      .toEqual([])
  })

  test('E12-H7a /en: a back-forward restore reads progress again', async ({
    page,
    browserName,
  }) => {
    await fixedClock(page, CLOCK)
    await openHome(page, 'en')
    await expectFixedClock(page, CLOCK)
    await waitForRead(page)
    expect((await continueOf(page)).shown, 'precondition: Continue is empty at load').toBe('empty')
    const constructor = await page.evaluate(() => typeof PageTransitionEvent === 'function')
    test.skip(!constructor, `PageTransitionEvent is not a constructor on ${browserName}`)
    const raw = serializeProgress({
      schema: RECORD_SCHEMA,
      stories: {
        'river-stones': {
          version: playerFixture('river-stones').version,
          activeRun: { path: ['start', 'flat_stones'], locale: 'en' },
          endingsFound: [],
          order: 1,
        },
      },
    })
    expect(
      await page.evaluate(
        ([key, value]) => {
          window.localStorage.setItem(key, value)
          return window.localStorage.getItem(key)
        },
        [PROGRESS_KEY, raw] as const,
      ),
      'precondition: the written record reads back',
    ).toBe(raw)
    const pageshow = (persisted: boolean) =>
      page.evaluate(async (value) => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: value }))
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        await new Promise((resolve) => setTimeout(resolve, 100))
      }, persisted)
    await pageshow(false)
    expect
      .soft((await continueOf(page)).shown, '(g1) pageshow without persisted: Continue still empty')
      .toBe('empty')
    await pageshow(true)
    await expect
      .soft(page.locator(CONTINUE_CELL), '(g2) pageshow persisted: Continue shows river-stones')
      .toHaveAttribute('data-shown', 'river-stones')
    await expect
      .soft(
        page.locator(`${LIST} [data-story-card="river-stones"] [data-badge-cell]`),
        '(g2) its card shows Reading',
      )
      .toHaveAttribute('data-shown', 'reading')
  })

  test("E12-H7b /en: another tab's change does not swap a card", async ({
    page,
    browserName,
    errors,
  }) => {
    await fixedClock(page, CLOCK)
    await seedProgressOnce(page, { 'river-stones': runIn('en', ['start', 'flat_stones']) })
    await openHome(page, 'en')
    await expectFixedClock(page, CLOCK)
    await waitForRead(page)
    expect((await continueOf(page)).shown, 'precondition: Continue is river-stones').toBe(
      'river-stones',
    )
    await page.evaluate((key) => {
      const w = window as unknown as Record<string, unknown>
      const heard: unknown[] = []
      w['__e2eStorageEvents'] = heard
      window.addEventListener('storage', (event) => {
        if (event.key === key) heard.push(event.newValue)
      })
    }, PROGRESS_KEY)
    const shownOf = async () =>
      Object.fromEntries(
        await Promise.all(
          FIXTURE_IDS.map(async (id) => [id, (await cellOf(page, id)).shown] as const),
        ),
      )
    const before = await shownOf()
    // Another page of the same browser saves a two-paths run with a higher order.
    const other = await page.context().newPage()
    errors.watch(other)
    await seedProgressOnce(other, {
      'river-stones': runIn('en', ['start', 'flat_stones']),
      'two-paths': runIn('en', ['start', 'wise_path']),
    })
    await other.close()
    await page.bringToFront()
    const heard = await page.evaluate(async () => {
      const w = window as unknown as Record<string, unknown>
      const start = performance.now()
      while (
        (w['__e2eStorageEvents'] as unknown[]).length === 0 &&
        performance.now() - start < 3000
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return (w['__e2eStorageEvents'] as unknown[]).length
    })
    test.skip(heard === 0, `no storage event reached the other page on ${browserName} (PR-5 g7)`)
    await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    expect
      .soft((await continueOf(page)).shown, '(g1) Continue is still river-stones')
      .toBe('river-stones')
    expect.soft(await shownOf(), '(g2) the badge cells are unchanged').toEqual(before)
  })

  test('E12-H8 /en: a newer-schema progress record shows the storage banner and stays untouched', async ({
    page,
    browserName,
  }) => {
    const raw = JSON.stringify({
      schema: RECORD_SCHEMA + 1,
      stories: {
        'river-stones': {
          version: playerFixture('river-stones').version,
          activeRun: { path: ['start', 'flat_stones'], locale: 'en' },
          endingsFound: ['ending_dry'],
          order: 1,
        },
      },
    })
    await seedRawProgressOnce(page, raw)
    if (browserName === 'chromium') await recordLayoutShifts(page)
    await openHome(page, 'en')
    await waitForHydration(page)
    await expect.soft(page.locator(BANNER), '(g1) the storage banner').toBeVisible()
    expect
      .soft(
        await page
          .locator('main')
          .evaluate((main, banner) => main.firstElementChild?.matches(banner) ?? false, BANNER),
        '(g1) the banner is the first element of main',
      )
      .toBe(true)
    await expect
      .soft(page.locator(CONTINUE_CELL), '(g3) the Continue cell shows the empty line')
      .toHaveAttribute('data-shown', 'empty')
    const state = await continueOf(page)
    expect
      .soft(state.empty !== null && isShown(state.empty), '(g3) the empty line shown')
      .toBe(true)
    const shown = await page
      .locator(`${LIST_CARDS} [data-badge-cell]`)
      .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-shown')))
    expect
      .soft(
        shown.filter((value) => value === 'reading' || value === 'finished'),
        '(g3) no card shows Reading or Finished',
      )
      .toEqual([])
    expect
      .soft(
        await page.evaluate((key) => window.localStorage.getItem(key), PROGRESS_KEY),
        '(g2) the stored bytes are untouched',
      )
      .toBe(raw)
    // Reported only: read without waiting, so a missing banner (g1 red) does not add a 30 s wait.
    const banner = page.locator(BANNER)
    const height =
      (await banner.count()) > 0 ? ((await banner.boundingBox())?.height ?? null) : null
    const shift = browserName === 'chromium' ? (await layoutShift(page)).raw : null
    const reported = `banner ${String(height)} px; raw shift ${String(shift)} (accepted, DEC:22-23)`
    test.info().annotations.push({ type: 'E12-H8 (reported)', description: reported })
    console.log(`[home-shelf] E12-H8 (${test.info().project.name}): ${reported}`)
  })

  test('E12-H9 /en with storage blocked: the banner, the empty Continue line, New only', async ({
    page,
  }) => {
    await fixedClock(page, CLOCK)
    await blockStorage(page)
    await openHome(page, 'en')
    await expectFixedClock(page, CLOCK)
    expect(
      await page.evaluate(() => {
        try {
          void window.localStorage
          return false
        } catch {
          return true
        }
      }),
      'precondition: localStorage access throws',
    ).toBe(true)
    await expect.soft(page.locator(BANNER), '(g1) the storage banner').toBeVisible()
    await expect
      .soft(page.locator(CONTINUE_CELL), '(g2) the Continue cell shows the empty line')
      .toHaveAttribute('data-shown', 'empty')
    const now = Date.parse(CLOCK)
    for (const card of await listCards(page)) {
      await expect
        .soft(
          page.locator(`${LIST} [data-story-card="${card.id}"] [data-badge-cell]`),
          `(g3) ${card.id} by the rule`,
        )
        .toHaveAttribute('data-shown', isNewByRule(card.addedOn, now) ? 'new' : 'none')
    }
  })

  for (const variant of [STEP12_VARIANTS.V1, STEP12_VARIANTS.V3, STEP12_VARIANTS.V4]) {
    test(`E12-H10 ${variantTitle(variant)}: a double tap on the last card at the bottom of Home cannot reach Start again on the landing`, async ({
      page,
      errors,
    }) => {
      const skip = variantSkip(variant, test.info().project.name)
      test.skip(skip !== null, skip ?? '')
      test.setTimeout(120_000)
      const { code } = variant
      const landing = landingPath(code, 'two-paths')
      await withHoldRetry(test.info(), async (n): Promise<HoldAttempt> => {
        const p = await attemptPage(page, errors, n)
        const aborted = await prepareStep12Variant(p, variant, errors)
        const seed = await seedProgressOnce(p, { 'two-paths': runIn(code, ['start', 'wise_path']) })
        const writes = await progressSpy(p)
        await watchNavHold(p)
        await openHome(p, code)
        await waitForRead(p)
        await expectStep12Variant(p, variant, aborted)
        await expectHoldWatch(p)
        expect((await listCards(p)).at(-1)?.id, 'precondition: two-paths is the last card').toBe(
          'two-paths',
        )
        const bottom = await scrollToBottom(p)
        console.log(
          `[home-shelf] E12-H10 ${variantTitle(variant)} (${test.info().project.name}): Home is ${bottom.ratio.toFixed(2)} viewports`,
        )
        if (variant.name !== 'V1') {
          expect(
            bottom.ratio,
            'precondition: Home is long (1.5 viewports or more)',
          ).toBeGreaterThanOrEqual(1.5)
        }
        const first = await centreInViewport(p, `${LIST} [data-story-card="two-paths"]`)
        const writesBefore = (await writes()).length
        const from = (await holdRecord(p)).length
        await p.mouse.click(first.x, first.y)
        const target = await p.evaluate(
          async ({ path, selector }) => {
            const ready = (): boolean =>
              location.pathname === path &&
              document.querySelector('[data-actions][data-shown="continue"]') !== null
            const deadline = performance.now() + 5000
            while (!ready() && performance.now() < deadline) {
              await new Promise((resolve) => requestAnimationFrame(resolve))
            }
            const button = document.querySelector(selector)
            if (!ready() || button === null) return null
            const centre = () => {
              const box = button.getBoundingClientRect()
              return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
            }
            // A finger can only tap what is on screen: at 150% text on a short phone the landing
            // opens with Start again below the fold, so it is scrolled into view first (as
            // centreInViewport does).
            let point = centre()
            let scrolled = false
            if (point.y >= window.innerHeight || point.y < 0) {
              button.scrollIntoView({ block: 'center', inline: 'center' })
              point = centre()
              scrolled = true
            }
            return { ...point, scrolled }
          },
          { path: landing, selector: START_AGAIN },
        )
        expect(target, 'precondition: the landing shows Continue and Start again').not.toBeNull()
        if (target === null) return { gap: null }
        await armBox(p, START_AGAIN)
        await p.mouse.click(target.x, target.y)
        const events = (await holdRecord(p)).slice(from)
        const span = holdSpans(events)[0]
        const downs = events.filter((event) => event.type === 'pointerdown')
        const clicks = events.filter((event) => event.type === 'click')
        const gap = span !== undefined && downs[1] !== undefined ? downs[1].t - span.on : null
        // A late second tap retries (13.9); a null gap (no hold seen at all) runs the groups, so a
        // product that never holds fails at (g0), never as timing.
        if (gap !== null && gap >= LATE_TAP_MS) return { gap }
        const under = await boxesAt(p, first, [
          '[data-landing] h1',
          '[data-story-meta]',
          '[data-actions]',
          START_AGAIN,
          '[data-how-made]',
          '[data-share-row]',
        ])
        test.info().annotations.push({
          type: 'E12-H10 (reported)',
          description: `gap ${gap === null ? 'none (no hold seen)' : gap.toFixed(0)} ms; under the first tap's point on the landing: ${under.join(', ') || 'nothing hooked'}; Start again scrolled into view: ${target.scrolled}`,
        })
        expect
          .soft(
            span && clicks[0] ? span.on - clicks[0].t : null,
            "(g0) the hold began inside the first tap's click (set − click, ms)",
          )
          .toBeGreaterThanOrEqual(0)
        expect
          .soft(
            span && clicks[0] ? span.on - clicks[0].t : null,
            "(g0) the hold began inside the first tap's click (set − click, ms)",
          )
          .toBeLessThanOrEqual(50)
        expect.soft(downs[1]?.held, '(g0) the hold was on at the second pointerdown').toBe(true)
        expect.soft(downs[1]?.inArmed, "(g0) the second point lay in Start again's box").toBe(true)
        const after = await afterHold(p)
        expect
          .soft(new URL(p.url()).pathname, '(g1) after the hold the URL is still the landing')
          .toBe(landing)
        // Read without waiting: a page that already left the landing has no [data-actions], and a
        // waiting read would end the test there, before (g1)'s last half and (g2)-(g4).
        expect
          .soft(
            await p.evaluate(
              () => document.querySelector('[data-actions]')?.getAttribute('data-shown') ?? null,
            ),
            "(g1) the actions still show 'continue'",
          )
          .toBe('continue')
        expect
          .soft(
            clicks[1]?.inMain,
            `(g1) the second click's target (${clicks[1]?.target ?? 'none'}) lies outside main`,
          )
          .toBe(false)
        expect
          .soft((await writes()).slice(writesBefore), '(g2) no progress write since the first tap')
          .toEqual([])
        expect
          .soft(
            await p.evaluate((key) => window.localStorage.getItem(key), PROGRESS_KEY),
            '(g2) the stored bytes are the seed',
          )
          .toBe(seed)
        expect.soft(after.released, '(g3) the hold was released').toBe(true)
        // The span as recorded once the hold ended (`span` was read at the second tap, while it lasted).
        const ended = holdSpans((await holdRecord(p)).slice(from))[0]
        const lasted = ended !== undefined && ended.off !== null ? ended.off - ended.on : null
        expect
          .soft(lasted, '(g3) the hold lasted 500 ms (±1 ms of timer rounding)')
          .toBeGreaterThanOrEqual(499)
        expect
          .soft(lasted, '(g3) the hold ended within 1,000 ms of the tap')
          .toBeLessThanOrEqual(1000)
        await p.mouse.click(target.x, target.y)
        await p
          .waitForURL((url) => url.pathname === playerPath(code, 'two-paths'), { timeout: 5000 })
          .catch(() => undefined)
        expect
          .soft(new URL(p.url()).pathname, '(g4) after the hold a tap there opens the player')
          .toBe(playerPath(code, 'two-paths'))
        let run: unknown = 'unread'
        for (let waited = 0; waited <= 5000; waited += 100) {
          run = await p.evaluate(
            ([key, id]) => {
              const raw = window.localStorage.getItem(key)
              const record =
                raw === null
                  ? null
                  : (JSON.parse(raw) as { stories?: Record<string, { activeRun?: unknown }> })
              const entry = record?.stories?.[id]
              // activeRun null (the reset) must stay null: `??` would turn it into 'no entry'.
              return entry === undefined ? 'no entry' : entry.activeRun
            },
            [PROGRESS_KEY, 'two-paths'] as const,
          )
          if (run === null) break
          await p.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
        }
        expect.soft(run, '(g4) and resets the run (activeRun null)').toBeNull()
        return { gap }
      })
    })
  }

  test('E12-H11 /en: a double tap on the Continue card cannot take a choice in the player', async ({
    page,
    errors,
  }) => {
    test.setTimeout(90_000)
    await withHoldRetry(test.info(), async (n): Promise<HoldAttempt> => {
      const p = await attemptPage(page, errors, n)
      await seedProgressOnce(p, { 'river-stones': runIn('en', ['start', 'flat_stones']) })
      const writes = await progressSpy(p)
      await watchNavHold(p)
      await openHome(p, 'en')
      await waitForRead(p)
      await expectHoldWatch(p)
      const first = await centreInViewport(p, '[data-continue-story="river-stones"]')
      const writesBefore = (await writes()).length
      const from = (await holdRecord(p)).length
      await p.mouse.click(first.x, first.y)
      const choiceSelector = '[data-part] button[data-choice="c1"]'
      const target = await p.evaluate(
        async ({ path, selector }) => {
          const ready = (): boolean =>
            location.pathname === path &&
            document.querySelector('[data-player][data-run-phase="open"]') !== null &&
            document.querySelector(selector) !== null
          const deadline = performance.now() + 5000
          while (!ready() && performance.now() < deadline) {
            await new Promise((resolve) => requestAnimationFrame(resolve))
          }
          const button = document.querySelector(selector)
          const part = document.querySelector('[data-part]')
          if (!ready() || button === null || part === null) return null
          const box = button.getBoundingClientRect()
          return {
            x: box.left + box.width / 2,
            y: box.top + box.height / 2,
            node: part.getAttribute('data-node'),
            seq: part.getAttribute('data-seq'),
          }
        },
        { path: playerPath('en', 'river-stones'), selector: choiceSelector },
      )
      expect(target, 'precondition: the player opened with a choice').not.toBeNull()
      if (target === null) return { gap: null }
      await armBox(p, choiceSelector)
      await p.mouse.click(target.x, target.y)
      const events = (await holdRecord(p)).slice(from)
      const span = holdSpans(events)[0]
      const downs = events.filter((event) => event.type === 'pointerdown')
      const clicks = events.filter((event) => event.type === 'click')
      const gap = span !== undefined && downs[1] !== undefined ? downs[1].t - span.on : null
      // A late second tap retries (13.9); a null gap (no hold seen at all) runs the groups.
      if (gap !== null && gap >= LATE_TAP_MS) return { gap }
      expect
        .soft(
          span && clicks[0] ? span.on - clicks[0].t : null,
          "(g0) the hold began inside the first tap's click (set − click, ms)",
        )
        .toBeGreaterThanOrEqual(0)
      expect
        .soft(
          span && clicks[0] ? span.on - clicks[0].t : null,
          "(g0) the hold began inside the first tap's click (set − click, ms)",
        )
        .toBeLessThanOrEqual(50)
      expect.soft(downs[1]?.held, '(g0) the hold was on at the second pointerdown').toBe(true)
      expect.soft(downs[1]?.inArmed, "(g0) the second point lay in the choice's box").toBe(true)
      await afterHold(p)
      const part = p.locator('[data-part]')
      expect
        .soft(
          [await part.getAttribute('data-node'), await part.getAttribute('data-seq')],
          '(g1) after the hold: the node and seq at open',
        )
        .toEqual([target.node, target.seq])
      expect.soft(target.node, '(g1) the resumed node').toBe('flat_stones')
      expect
        .soft((await writes()).slice(writesBefore), '(g2) no progress write since the first tap')
        .toEqual([])
      await p.mouse.click(target.x, target.y)
      await expect
        .soft(part, '(g3) after the hold a tap on the choice steps once')
        .toHaveAttribute('data-seq', String(Number(target.seq) + 1))
      return { gap }
    })
  })

  test('E12-H12 staging: the hero card holds like a list card', async ({ page, request }) => {
    const info = await buildInfo(request)
    test.skip(
      info.featuredStoryId === null,
      'no featured story in this build (build-info featuredStoryId is null)',
    )
    const featured = info.featuredStoryId ?? ''
    await watchNavHold(page)
    await openHome(page, 'en')
    await waitForRead(page)
    await expectHoldWatch(page)
    const hero = `${FEATURED} [data-story-card]`
    // (g2a) Before any tap: the hero links to the featured story's landing, so a hero that points
    // anywhere else (its player included, whose media is on the real origin) stops here (13.1 H).
    expect(
      await page.locator(`${hero} a`).getAttribute('href'),
      "(g2a) the hero's link, before any tap: the featured story's landing",
    ).toBe(landingPath('en', featured))
    const point = await centreInViewport(page, hero)
    const from = (await holdRecord(page)).length
    await page.mouse.click(point.x, point.y)
    await page
      .waitForURL((url) => url.pathname === landingPath('en', featured), { timeout: 5000 })
      .catch(() => undefined)
    const events = (await holdRecord(page)).slice(from)
    const span = holdSpans(events)[0]
    const click = events.find((event) => event.type === 'click')
    // NaN, never null, when no hold or no click was recorded: a null is a matcher error that names
    // no group (mutant prover 2, MU12-174); NaN fails both bounds with the group's message.
    const delta = span && click ? span.on - click.t : Number.NaN
    expect
      .soft(delta, '(g1) the hold began inside the click (set − click, ms; NaN: no hold recorded)')
      .toBeGreaterThanOrEqual(0)
    expect
      .soft(delta, '(g1) the hold began inside the click (set − click, ms; NaN: no hold recorded)')
      .toBeLessThanOrEqual(50)
    expect
      .soft(new URL(page.url()).pathname, "(g2b) the URL is the featured story's landing")
      .toBe(landingPath('en', featured))
  })

  test('E12-H13 /en: each card is one Tab stop, hidden Continue cards are not, and the focused card shows a ring', async ({
    page,
    browserName,
  }) => {
    await fixedClock(page, CLOCK)
    await seedProgressOnce(page, { 'river-stones': runIn('en', ['start', 'flat_stones']) })
    await openHome(page, 'en')
    await expectFixedClock(page, CLOCK)
    await waitForRead(page)
    const reaches = await tabReachesLinks(page)
    test.skip(!reaches, `Tab does not reach links on ${browserName} (tabReachesLinks false)`)
    // Focus the last focusable element before main (the header's), so the next Tab enters main.
    await page.evaluate(() => {
      const main = document.querySelector('main')
      const before = [
        ...document.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]',
        ),
      ]
        .filter((element) => element.tabIndex >= 0)
        .filter(
          (element) =>
            main !== null &&
            (element.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        )
      before.at(-1)?.focus()
    })
    const cardCount = (await listCards(page)).length
    const stops: {
      where: string
      card: string | null
      titleLink: boolean
      continueId: string | null
      ring: boolean
      afterList: boolean
    }[] = []
    for (let press = 0; press < 4 * cardCount + 10; press++) {
      await page.keyboard.press('Tab')
      const stop = await page.evaluate(() => {
        const active = document.activeElement
        const list = document.querySelector('[data-home-list]')
        if (active === null || active === document.body) return null
        const card = active.closest('[data-home-list] [data-story-card]')
        const style = card === null ? null : getComputedStyle(card)
        return {
          where: `${active.localName}${active.getAttribute('href') ? ` ${active.getAttribute('href')}` : ''}`,
          inMain: active.closest('main') !== null,
          card: card?.getAttribute('data-story-card') ?? null,
          titleLink: card !== null && card.querySelector('a') === active,
          continueId:
            active.closest('[data-continue-story]')?.getAttribute('data-continue-story') ?? null,
          ring: style !== null && (style.outlineStyle !== 'none' || style.boxShadow !== 'none'),
          afterList:
            list !== null &&
            (list.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
            !list.contains(active),
        }
      })
      if (stop === null) continue
      if (!stop.inMain && stops.length > 0) break
      if (stop.inMain) stops.push(stop)
      if (stop.afterList) break
    }
    expect(stops.length, 'precondition: Tab stops recorded in main').toBeGreaterThan(0)
    const inList = stops.filter((stop) => stop.card !== null)
    expect
      .soft(
        inList.map((stop) => `${stop.card}${stop.titleLink ? '' : ` (${stop.where})`}`),
        '(g1) one stop per card, the title link, in DOM order',
      )
      .toEqual((await listCards(page)).map((card) => card.id))
    const state = await continueOf(page)
    const hiddenIds = state.cards.filter(isHidden).map((card) => card.id)
    expect
      .soft(
        stops
          .filter((stop) => stop.continueId !== null && hiddenIds.includes(stop.continueId))
          .map((stop) => stop.where),
        '(g2) no stop in a hidden Continue card',
      )
      .toEqual([])
    expect
      .soft(
        stops.filter((stop) => stop.continueId !== null).map((stop) => stop.continueId),
        '(g2) one stop on the shown Continue card',
      )
      .toEqual(['river-stones'])
    expect
      .soft(
        inList.filter((stop) => !stop.ring).map((stop) => `${stop.card}: focus on ${stop.where}`),
        '(g3) a focused card shows a ring',
      )
      .toEqual([])
  })

  test(`E12-H16a ${variantTitle(STEP12_VARIANTS.V4)}: no horizontal scroll; every target at least 44 px`, async ({
    page,
    errors,
  }) => {
    const variant = STEP12_VARIANTS.V4
    const skip = variantSkip(variant, test.info().project.name)
    test.skip(skip !== null, skip ?? '')
    const aborted = await prepareStep12Variant(page, variant, errors)
    await seedProgressOnce(page, { 'river-stones': runIn(variant.code, ['start', 'flat_stones']) })
    await openHome(page, variant.code)
    await waitForRead(page)
    await expectStep12Variant(page, variant, aborted)
    const layout = await page.evaluate(() => {
      const size = (element: Element) => {
        const box = element.getBoundingClientRect()
        return { width: box.width, height: box.height }
      }
      const visible = (element: Element) => {
        const box = element.getBoundingClientRect()
        return (
          box.width > 0 &&
          box.height > 0 &&
          getComputedStyle(element).visibility === 'visible' &&
          element.closest('[aria-hidden="true"]') === null
        )
      }
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        cards: [
          ...document.querySelectorAll('[data-home-list] [data-story-card], [data-continue-story]'),
        ]
          .filter(visible)
          .map((card) => ({
            name:
              card.getAttribute('data-story-card') ??
              `continue ${card.getAttribute('data-continue-story') ?? ''}`,
            ...size(card),
          })),
        others: [...document.querySelectorAll('main a, main button')]
          .filter(visible)
          .filter((element) => element.closest('[data-story-card]') === null)
          .map((element) => {
            const card = element.closest('[data-continue-story]')
            return {
              name: `${element.localName} ${(element.textContent ?? '').trim().slice(0, 24)}`,
              ...size(card ?? element),
            }
          }),
      }
    })
    console.log(`[home-shelf] E12-H16a (${test.info().project.name}): ${JSON.stringify(layout)}`)
    expect
      .soft(layout.scrollWidth, '(g1) no horizontal scroll')
      .toBeLessThanOrEqual(layout.clientWidth)
    expect.soft(layout.cards.length, 'the cards measured').toBeGreaterThan(0)
    expect
      .soft(
        layout.cards
          .filter((card) => card.width < 44 || card.height < 44)
          .map((card) => `${card.name} ${card.width}x${card.height}`),
        '(g2) every card and the Continue card at least 44 x 44 px',
      )
      .toEqual([])
    expect
      .soft(
        layout.others
          .filter((other) => other.width < 44 || other.height < 44)
          .map((other) => `${other.name} ${other.width}x${other.height}`),
        '(g3) every other link or button at least 44 x 44 px',
      )
      .toEqual([])
  })

  test('E12-H16b /en: the list has as many columns as the grid formula gives', async ({ page }) => {
    await openHome(page, 'en')
    await settleFonts(page)
    const grid = await page.locator(LIST).evaluate((list) => {
      const style = getComputedStyle(list)
      const cards = [...list.querySelectorAll('[data-story-card]')]
      return {
        width: list.getBoundingClientRect().width,
        gap: parseFloat(style.columnGap) || 0,
        root: parseFloat(getComputedStyle(document.documentElement).fontSize),
        columns: new Set(
          cards.map((card) => Math.round(card.getBoundingClientRect().left * 10) / 10),
        ).size,
        cards: cards.length,
      }
    })
    expect(grid.root, 'precondition: the root font size is 16 px').toBe(16)
    const expected = Math.max(1, Math.floor((grid.width + grid.gap) / (288 + grid.gap)))
    const report = `${test.info().project.name}: ${grid.columns} columns (formula ${expected}) at ${grid.width} px, gap ${grid.gap} px (V1:3911-3913: phones 1, portrait tablets 2, landscape 3)`
    test.info().annotations.push({ type: 'E12-H16b (reported)', description: report })
    console.log(`[home-shelf] E12-H16b ${report}`)
    expect
      .soft(grid.columns, '(g1) distinct card left positions')
      .toBe(Math.min(expected, grid.cards))
  })
})

/**
 * The page's real time for E12-H5's shift window. W12's fixed clock also fakes performance.now(),
 * context-wide: in page B (opened after page A's whole run) it runs about 2 s ahead of the
 * document's own time base, which layout-shift entries keep, so a performance.now() window held no
 * entry at all and page B's (g4) could never fail (mutant prover 1, P1 Step 12a). The document
 * timeline is not faked and shares the entries' time origin.
 */
async function realNow(page: Page): Promise<number> {
  const now = await page.evaluate(() => {
    const time = document.timeline.currentTime
    return typeof time === 'number' ? time : null
  })
  expect(now, 'precondition: the document timeline gives the time').not.toBeNull()
  return now ?? 0
}

/**
 * E12-H5's page run (13.4.1): its variant, the fixed clock, an optional seed, the scripts held so
 * the server HTML paints first; boxes measured before (P) and after (R) the read, and on Chromium
 * the raw layout-shift sum between the release and the end.
 */
async function readerBoxes(
  page: Page,
  variant: Step12Variant,
  errors: ConsoleErrors,
  browserName: string,
  seed: Parameters<typeof seedProgressOnce>[1] | null,
): Promise<{ before: BoxSet; after: BoxSet; raw: number | null; lines: string[] }> {
  const { code } = variant
  const aborted = await prepareStep12Variant(page, variant, errors)
  await fixedClock(page, CLOCK)
  if (seed !== null) await seedProgressOnce(page, seed)
  if (browserName === 'chromium') await recordLayoutShifts(page)
  const chunks = await holdChunksUntil(page)
  const response = await page.goto(`/${code}`, { waitUntil: 'domcontentloaded' })
  expect(response?.status(), `/${code}`).toBe(200)
  await expectStep12Variant(page, variant, aborted, { scriptsHeld: true })
  expect(chunks.held(), 'precondition: the JavaScript chunks were held').toBeGreaterThan(0)
  const selectors = homeBoxes()
  const before = await boxesOf(page, selectors)
  expect(
    await page
      .locator(`[data-badge-cell], ${CONTINUE_CELL}`)
      .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-shown'))),
    'precondition: every cell pending in the server HTML',
  ).toEqual(expect.arrayContaining(['pending']))
  expect(
    await page
      .locator(
        `[data-badge-cell]:not([data-shown="pending"]), ${CONTINUE_CELL}:not([data-shown="pending"])`,
      )
      .count(),
    'precondition: no cell shows a state before the read',
  ).toBe(0)
  const from = await realNow(page)
  chunks.release()
  await expectFixedClock(page, CLOCK)
  await waitForRead(page)
  await frames(page)
  const after = await boxesOf(page, selectors)
  const to = await realNow(page)
  // Hard after the read: what each reader sees.
  const now = Date.parse(CLOCK)
  const cards = await listCards(page)
  const state = await continueOf(page)
  if (seed === null) {
    expect(state.shown, 'precondition: page A shows the empty line').toBe('empty')
    for (const card of cards.filter((c) => isNewByRule(c.addedOn, now))) {
      expect((await cellOf(page, card.id)).shown, `precondition: page A shows ${card.id} New`).toBe(
        'new',
      )
    }
  } else {
    expect(state.shown, 'precondition: page B shows the river-stones Continue card').toBe(
      'river-stones',
    )
    expect(
      [
        (await cellOf(page, 'river-stones')).shown,
        (await cellOf(page, 'two-paths')).shown,
        (await cellOf(page, 'lantern-walk')).shown,
      ],
      'precondition: page B shows Reading, Finished and New',
    ).toEqual(['reading', 'finished', 'new'])
  }
  if (browserName !== 'chromium') return { before, after, raw: null, lines: [] }
  const shift = await layoutShift(page, { from, to })
  return { before, after, raw: shift.raw, lines: shift.lines }
}
