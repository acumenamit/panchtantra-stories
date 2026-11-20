// The story landing, P1-3 Step 12a (spec §6.1 story landing, SPEC:434; design
// p1-step12-design.md §3.8-§3.11, §3.13, §4.5-§4.7, §4.11, §4.12, §5, §7, §8, §13.1, §13.4.2
// E12-L1 to E12-L18). Review and staging legs (@review), all 5 projects; the fixtures only (8.1).
// - Hooks (design §4.11): [data-landing] (the content wrapper), [data-story-meta], [data-actions]
//   [data-shown="pending|start|continue"], [data-story-action="start|continue"], [data-actions]
//   [data-start-again] (scoped: the player's error fallback has its own data-start-again),
//   [data-how-made], [data-share-row]; ShareControl's [data-share], [data-share-status],
//   [data-share-url].
// - Every test collects console errors and page errors (an auto fixture) and fails on any; the
//   wide variants declare the aborted font files (Chromium logs each).
// - Share: the stubs of page-helpers.ts (W7, moved from player-share.spec.ts) set navigator.share,
//   canShare and, but for Chromium's real clipboard (permissions granted), the clipboard, and
//   record every call. The shared URL is the landing URL from location.origin (N12).
// - Hold rows (13.1 C, 13.9): the hold watch (W1), its self-check first; a second tap 450 ms or
//   more after the hold began retries on a fresh page, at most 3 times, and never passes late.
//   Every tap on Share and on How this story was made holds too (S12-CRIT-2, S12-AUD-12), so a
//   test that taps Share again on purpose waits for the in-page removal first.
// - A test that reloads or opens another page after a landing waits for no request in flight
//   first (W5; WebKit reports an aborted router prefetch as a page error, 13.1 E).
// - Round 1b (design §16 F2): E12-L10 manual g1 bounds the focus scroll by the field's margin box
//   (border box plus computed margin-block-start) plus 1 px, and prints the three numbers.
import type { Page } from '@playwright/test'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../src/core/locales'
import { PROGRESS_KEY, RECORD_SCHEMA } from '../src/core/progress/records'
import { boxDifferences, type BoxSet } from '../scripts/testing/e2e-readers'
import { expect, test as base } from './fixtures'
import {
  afterHold,
  announcements,
  armBox,
  attemptPage,
  boxesAt,
  boxesOf,
  boxOf,
  centreInViewport,
  consoleErrors,
  expectHoldWatch,
  expectShareSetup,
  expectStep12Variant,
  frames,
  holdChunksUntil,
  holdRecord,
  holdSpans,
  LATE_TAP_MS,
  PLAYER,
  prepareStep12Variant,
  progressSpy,
  quietRequests,
  recordAnnouncements,
  scrollToBottom,
  seedProgressOnce,
  seedRawProgressOnce,
  shareCalls,
  STEP12_VARIANTS,
  storedStory,
  stubShare,
  variantSkip,
  variantTitle,
  watchNavHold,
  withHoldRetry,
  type ConsoleErrors,
  type HoldAttempt,
  type ShareSetup,
  type Step12Variant,
} from './page-helpers'
import {
  blockStorage,
  formatted,
  landingPath,
  landingPaths,
  layoutShift,
  message,
  playerFixture,
  playerPath,
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

const STORY = 'two-paths'
const LANDING = '[data-landing]'
const ACTIONS = '[data-actions]'
const START = `${ACTIONS} [data-story-action="start"]`
const CONTINUE = `${ACTIONS} [data-story-action="continue"]`
const START_AGAIN = `${ACTIONS} [data-start-again]`
const HOW_MADE = '[data-how-made]'
const SHARE_ROW = '[data-share-row]'
const SHARE = `${SHARE_ROW} button[data-share]`
const SHARE_STATUS = `${SHARE_ROW} [data-share-status]`
const SHARE_URL = 'input[data-share-url]'
const FIELD = 'label:has(input[data-share-url])'
const BANNER = 'section[aria-labelledby="storage-banner-title"]'
const HOW_MADE_HASH = '#how-stories-are-made'

/** A saved run in `code` (activeRun non-null). */
function runIn(code: LocaleCode, path: readonly string[]) {
  return { activeRun: { path, locale: code } }
}

/**
 * Opens the landing: 200. A revisit of the same URL in the same page may be answered 304 (WebKit
 * revalidates the cached HTML; the precedent of player-audio.spec.ts's re-navigation check).
 */
async function openLanding(
  page: Page,
  code: LocaleCode,
  storyId = STORY,
  { revisit = false }: { readonly revisit?: boolean } = {},
): Promise<void> {
  const response = await page.goto(landingPath(code, storyId))
  const status = response?.status()
  expect(
    revisit ? [200, 304] : [200],
    `${landingPath(code, storyId)} (status ${status})`,
  ).toContain(status)
}

/** Waits until the landing's progress read has ended: [data-actions] is no longer pending. */
async function waitForActions(page: Page): Promise<void> {
  await expect(page.locator(ACTIONS), 'precondition: the action row').toBeAttached()
  await expect(page.locator(ACTIONS), 'precondition: the progress read ended').not.toHaveAttribute(
    'data-shown',
    'pending',
  )
}

interface ControlState {
  readonly present: boolean
  readonly visibility: string
  readonly ariaHidden: string | null
  readonly href: string | null
  readonly text: string
}

const isShown = (c: ControlState): boolean =>
  c.present && c.visibility === 'visible' && c.ariaHidden === null
const isHidden = (c: ControlState): boolean =>
  c.present && c.visibility === 'hidden' && c.ariaHidden === 'true'

/** The action row: its data-shown and each control's state (13.1 I). */
async function actionsOf(
  page: Page,
): Promise<{ shown: string | null; start: ControlState; cont: ControlState; again: ControlState }> {
  return page.locator(ACTIONS).evaluate((row) => {
    const state = (selector: string) => {
      const element = row.querySelector(selector)
      if (element === null) {
        return { present: false, visibility: 'none', ariaHidden: null, href: null, text: '' }
      }
      const hidden = element.closest('[aria-hidden]')
      return {
        present: true,
        visibility: getComputedStyle(element).visibility,
        ariaHidden: hidden === null ? null : hidden.getAttribute('aria-hidden'),
        href: element.getAttribute('href'),
        text: (element.textContent ?? '').trim(),
      }
    }
    return {
      shown: row.getAttribute('data-shown'),
      start: state('[data-story-action="start"]'),
      cont: state('[data-story-action="continue"]'),
      again: state('[data-start-again]'),
    }
  })
}

/** The landing's URL on this origin: what Share gives (N12). */
function landingUrl(page: Page, code: LocaleCode, storyId = STORY): string {
  return `${new URL(page.url()).origin}${landingPath(code, storyId)}`
}

/** The hold events after `from`: the first hold, the pointerdowns and the clicks. */
async function holdsSince(page: Page, from: number) {
  const events = (await holdRecord(page)).slice(from)
  return {
    spans: holdSpans(events),
    downs: events.filter((event) => event.type === 'pointerdown'),
    clicks: events.filter((event) => event.type === 'click'),
    keys: events.filter((event) => event.type === 'keydown'),
  }
}

/** (g0)-style checks: the hold began inside the click (set − click in [0, 50] ms). */
function expectHoldInClick(label: string, on: number | undefined, click: number | undefined): void {
  const delta = on !== undefined && click !== undefined ? on - click : null
  expect
    .soft(delta, `${label} the hold began inside the click (set − click, ms)`)
    .toBeGreaterThanOrEqual(0)
  expect
    .soft(delta, `${label} the hold began inside the click (set − click, ms)`)
    .toBeLessThanOrEqual(50)
}

test.describe('the story landing, Step 12', { tag: '@review' }, () => {
  for (const { path, code, storyId } of landingPaths()) {
    test(`E12-L1 ${path}: the fields in order, as stored`, async ({ page }) => {
      const lang = uiLang(code)
      const fields = storyFields(storyId, code)
      const response = await page.goto(path)
      expect.soft(response?.status(), '(g5) the response status').toBe(200)
      expect.soft(await page.locator('html').getAttribute('lang'), '(g5) <html lang>').toBe(code)
      const children = await page.locator(LANDING).evaluate((landing) =>
        [...landing.children].map((child) => {
          const kind = (selector: string) =>
            child.matches(selector) || child.querySelector(selector) !== null
          if (child.localName === 'h1') return 'h1'
          if (kind('[data-story-meta]')) return 'meta'
          if (kind('[data-actions]')) return 'actions'
          if (kind('[data-how-made]')) return 'how-made'
          if (kind('[data-share-row]')) return 'share-row'
          return `${child.localName} ${(child.textContent ?? '').replace(/\s+/g, ' ').trim()}`
        }),
      )
      const theme = formatted(lang, 'story.theme', { theme: fields.theme })
      expect
        .soft(children, '(g1) the landing in order, nothing after the Share row')
        .toEqual([
          `p ${fields.book}`,
          'h1',
          `p ${fields.description}`,
          'meta',
          `p ${theme}`,
          'actions',
          'how-made',
          'share-row',
        ])
      expect
        .soft(await page.locator('h1').allTextContents(), '(g2) one h1, the title as stored')
        .toEqual([fields.title])
      const meta = await page.locator('[data-story-meta]').evaluate(
        (element, wanted) => {
          const texts = [...element.querySelectorAll('*'), element].map((e) =>
            (e.textContent ?? '').trim(),
          )
          return wanted.map((text) => texts.includes(text))
        },
        [formatted(lang, 'story.age', { age: fields.age }), fields.duration],
      )
      expect
        .soft(meta, '(g2) the meta line: story.age and the duration as stored')
        .toEqual([true, true])
      expect
        .soft(await page.title(), '(g2) the document title')
        .toBe(`${fields.title} – Storyboard`)
      expect
        .soft(
          await page.locator('meta[name="description"]').getAttribute('content'),
          '(g2) the meta description',
        )
        .toBe(fields.description)
      const how = page.locator(HOW_MADE)
      expect
        .soft(await how.getAttribute('href'), '(g3) How this story was made: its href')
        .toBe(`/${code}/grown-ups${HOW_MADE_HASH}`)
      expect
        .soft(await how.getAttribute('target'), '(g3) How this story was made: same tab')
        .toBeNull()
      expect
        .soft((await how.textContent())?.trim(), '(g3) How this story was made: its text')
        .toBe(message(lang, 'story.howMade'))
      const header = await page.evaluate(() => ({
        links: document.querySelectorAll('header a').length,
        current: [...document.querySelectorAll('header a')]
          .filter((a) => a.hasAttribute('aria-current'))
          .map((a) => a.getAttribute('href')),
      }))
      expect
        .soft(header, '(g4) the header: 3 links, aria-current on none')
        .toEqual({ links: 3, current: [] })
    })
  }

  for (const code of ENABLED_LOCALE_CODES) {
    test(`E12-L2 /${code}/stories/two-paths: Start, Continue and Start again by the stored entry`, async ({
      page,
    }) => {
      const lang = uiLang(code)
      const shown: (string | null)[] = []
      await openLanding(page, code)
      let quiet = quietRequests(page)
      await waitForActions(page)
      const fresh = await actionsOf(page)
      shown.push(fresh.shown)
      expect.soft(isShown(fresh.start), '(g1) no record: Start shown').toBe(true)
      expect
        .soft([fresh.start.href, fresh.start.text], '(g1) Start: the read URL, story.start')
        .toEqual([playerPath(code, STORY), message(lang, 'story.start')])
      expect
        .soft(
          [isHidden(fresh.cont), isHidden(fresh.again)],
          '(g1) no record: Continue and Start again hidden',
        )
        .toEqual([true, true])

      await quiet()
      await seedProgressOnce(page, { [STORY]: { activeRun: null, endingsFound: ['ending_wise'] } })
      await openLanding(page, code, STORY, { revisit: true })
      quiet = quietRequests(page)
      await waitForActions(page)
      const finished = await actionsOf(page)
      shown.push(finished.shown)
      expect.soft(isShown(finished.start), '(g2) a finished story: Start shown').toBe(true)
      expect.soft(isHidden(finished.again), '(g2) a finished story: Start again hidden').toBe(true)

      await quiet()
      await seedProgressOnce(page, { [STORY]: runIn(code, ['start', 'wise_path']) })
      await openLanding(page, code, STORY, { revisit: true })
      await waitForActions(page)
      const saved = await actionsOf(page)
      shown.push(saved.shown)
      expect
        .soft(
          [isShown(saved.cont), saved.cont.text],
          '(g3) a saved run: Continue shown, story.continue',
        )
        .toEqual([true, message(lang, 'story.continue')])
      expect
        .soft(
          [isShown(saved.again), saved.again.text],
          '(g3) a saved run: Start again shown, player.restart',
        )
        .toEqual([true, message(lang, 'player.restart')])
      expect.soft(isHidden(saved.start), '(g3) a saved run: Start hidden').toBe(true)
      expect
        .soft(shown, '(g4) data-shown by the stored entry')
        .toEqual(['start', 'start', 'continue'])
    })
  }

  test('E12-L3 /en/stories/river-stones: Start again resets the run, keeps the endings and opens the player at the start', async ({
    page,
  }) => {
    await seedProgressOnce(page, {
      'river-stones': { ...runIn('en', ['start', 'flat_stones']), endingsFound: ['ending_dry'] },
    })
    await progressSpy(page)
    await page.addInitScript((key) => {
      const w = window as unknown as Record<string, unknown>
      const stamps = { writes: [] as number[], push: null as number | null }
      w['__e2eL3'] = stamps
      for (const name of ['setItem', 'removeItem'] as const) {
        const original = Storage.prototype[name] as unknown as (...args: unknown[]) => unknown
        Object.defineProperty(Storage.prototype, name, {
          configurable: true,
          writable: true,
          value: function (this: Storage, ...args: unknown[]) {
            if (args[0] === key) stamps.writes.push(performance.now())
            return original.apply(this, args)
          },
        })
      }
      const push = history.pushState.bind(history)
      history.pushState = (...args: Parameters<History['pushState']>) => {
        if (stamps.push === null) stamps.push = performance.now()
        return push(...args)
      }
    }, PROGRESS_KEY)
    await openLanding(page, 'en', 'river-stones')
    await waitForActions(page)
    expect((await actionsOf(page)).shown, 'precondition: a saved run').toBe('continue')
    await page.locator(START_AGAIN).click()
    await page
      .waitForURL((url) => url.pathname === playerPath('en', 'river-stones'), { timeout: 5000 })
      .catch(() => undefined)
    expect
      .soft(new URL(page.url()).pathname, '(g1) the player URL')
      .toBe(playerPath('en', 'river-stones'))
    await expect
      .soft(page.locator(PLAYER), '(g1) the player opens')
      .toHaveAttribute('data-run-phase', 'open')
    await expect
      .soft(page.locator('[data-part]'), '(g1) at the start node')
      .toHaveAttribute('data-node', 'start')
    await expect.soft(page.locator('[data-part]'), '(g1) seq 0').toHaveAttribute('data-seq', '0')
    // A missing entry is a soft failure of this group, never a matcher error: toMatchObject throws
    // on null and would end the test before g3 (mutant prover 2, MU12-44).
    expect
      .soft(
        (await storedStory(page, 'river-stones')) ?? { entry: 'none stored for river-stones' },
        '(g2) the run cleared, the endings kept',
      )
      .toMatchObject({ activeRun: null, endingsFound: ['ending_dry'] })
    const stamps = await page.evaluate(
      () =>
        (window as unknown as Record<string, unknown>)['__e2eL3'] as {
          writes: number[]
          push: number | null
        },
    )
    const push = stamps.push
    expect
      .soft(
        push === null ? stamps.writes : stamps.writes.filter((t) => t < push),
        '(g3) exactly one progress write before the navigation (the reset)',
      )
      .toHaveLength(1)
    expect.soft(push, '(g3) the navigation pushed a history entry').not.toBeNull()
  })

  test('E12-L4 /en/stories/river-stones: Continue opens the saved run where it was', async ({
    page,
  }) => {
    await seedProgressOnce(page, { 'river-stones': runIn('en', ['start', 'flat_stones']) })
    await openLanding(page, 'en', 'river-stones')
    await waitForActions(page)
    expect((await actionsOf(page)).shown, 'precondition: a saved run').toBe('continue')
    expect
      .soft(
        await page.locator(CONTINUE).getAttribute('href'),
        '(g1) Continue: the read URL, no query',
      )
      .toBe(playerPath('en', 'river-stones'))
    await page.locator(CONTINUE).click()
    await expect
      .soft(page.locator(PLAYER), '(g1) the player opens')
      .toHaveAttribute('data-run-phase', 'open')
    await expect
      .soft(page.locator('[data-part]'), '(g1) at the saved node')
      .toHaveAttribute('data-node', 'flat_stones')
  })

  for (const variant of [STEP12_VARIANTS.V1, STEP12_VARIANTS.V2, STEP12_VARIANTS.V3]) {
    test(`E12-L5 ${variantTitle(variant)}: no box moves when progress is read, and Start and Continue get the same boxes`, async ({
      page,
      browserName,
      errors,
    }) => {
      const skip = variantSkip(variant, test.info().project.name)
      test.skip(skip !== null, skip ?? '')
      test.setTimeout(90_000)
      const a = await landingBoxes(page, variant, errors, browserName, false)
      const second = await page.context().newPage()
      errors.watch(second)
      const b = await landingBoxes(second, variant, errors, browserName, true)
      const report = `${variantTitle(variant)} (${test.info().project.name}): A raw shift ${a.raw ?? 'n/a'}, B raw shift ${b.raw ?? 'n/a'}`
      console.log(`[landing] E12-L5 ${report}`)
      for (const line of [...a.lines, ...b.lines]) console.log(`[landing] E12-L5 ${line}`)
      test.info().annotations.push({ type: 'E12-L5', description: report })
      expect
        .soft(
          boxDifferences(a.before, a.after),
          '(g1) page A (Start): boxes before and after the read',
        )
        .toEqual([])
      expect
        .soft(
          boxDifferences(b.before, b.after),
          '(g2) page B (Continue): boxes before and after the read',
        )
        .toEqual([])
      expect
        .soft(boxDifferences(a.after, b.after), '(g3) the same boxes for Start and for Continue')
        .toEqual([])
      if (browserName === 'chromium') {
        expect.soft(a.raw, '(g4) page A: the layout-shift sum from the release').toBe(0)
        expect.soft(b.raw, '(g4) page B: the layout-shift sum from the release').toBe(0)
      }
    })
  }

  for (const variant of [STEP12_VARIANTS.V1, STEP12_VARIANTS.V2, STEP12_VARIANTS.V3]) {
    test(`E12-L7 ${variantTitle(variant)}: Share copies the landing URL; "Link copied." in the Share row, announced once`, async ({
      page,
      context,
      browserName,
      errors,
    }) => {
      const skip = variantSkip(variant, test.info().project.name)
      test.skip(skip !== null, skip ?? '')
      const { code } = variant
      const lang = uiLang(code)
      const setup: ShareSetup = {
        share: 'undefined',
        clipboard: browserName === 'chromium' ? 'real' : 'resolve',
      }
      if (setup.clipboard === 'real')
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      const aborted = await prepareStep12Variant(page, variant, errors)
      await stubShare(page, setup)
      await recordAnnouncements(page)
      await openLanding(page, code)
      await waitForActions(page)
      await expectStep12Variant(page, variant, aborted)
      await expectShareSetup(page, setup)
      const url = landingUrl(page, code)
      await page.locator(SHARE).click()
      await expect(
        page.locator(`${SHARE_STATUS}, ${SHARE_URL}`).first(),
        'the share settled',
      ).toBeVisible()
      if (setup.clipboard === 'real') {
        expect
          .soft(
            await page.evaluate(() => navigator.clipboard.readText()),
            '(g1) the clipboard holds the landing URL',
          )
          .toBe(url)
      } else {
        expect
          .soft((await shareCalls(page)).writeText, '(g1) writeText got the landing URL')
          .toEqual([url])
      }
      const placed = await page.locator(SHARE_ROW).evaluate((row) => {
        const button = row.querySelector('button[data-share]')
        const status = document.querySelector('[data-share-status]')
        return {
          inRow: status !== null && row.contains(status),
          afterButton:
            button !== null &&
            status !== null &&
            (button.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          text: (status?.textContent ?? '').trim(),
        }
      })
      expect.soft(placed, '(g2) "Link copied." inside the Share row, after the button').toEqual({
        inRow: true,
        afterButton: true,
        text: message(lang, 'player.linkCopied'),
      })
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)))
      expect
        .soft(await announcements(page), '(g3) announced once')
        .toEqual([message(lang, 'player.linkCopied')])
    })
  }

  for (const variant of [STEP12_VARIANTS.V1, STEP12_VARIANTS.V2, STEP12_VARIANTS.V3]) {
    test(`E12-L8 ${variantTitle(variant)}: Share falls back to a read-only field holding the landing URL, on its own line`, async ({
      page,
      errors,
    }) => {
      const skip = variantSkip(variant, test.info().project.name)
      test.skip(skip !== null, skip ?? '')
      const { code } = variant
      const setup: ShareSetup = { share: 'undefined', clipboard: 'reject' }
      const aborted = await prepareStep12Variant(page, variant, errors)
      await stubShare(page, setup)
      await openLanding(page, code)
      await waitForActions(page)
      await expectStep12Variant(page, variant, aborted)
      await expectShareSetup(page, setup)
      const url = landingUrl(page, code)
      await page.locator(SHARE).click()
      const field = page.locator(SHARE_URL)
      await expect(field, 'the field appeared').toBeVisible()
      await expect.soft(field, '(g1) the field has focus').toBeFocused()
      expect
        .soft(
          await field.evaluate((input: HTMLInputElement) => [
            input.value,
            input.readOnly,
            input.selectionStart,
            input.selectionEnd,
          ]),
          '(g1) the field holds the landing URL, read-only, selected',
        )
        .toEqual([url, true, 0, url.length])
      const line = await page.locator(SHARE_ROW).evaluate((row) => {
        const label = document.querySelector('input[data-share-url]')?.closest('label') ?? null
        const rowBox = row.getBoundingClientRect()
        const box = label?.getBoundingClientRect()
        return {
          nextSibling: label !== null && row.nextElementSibling === label,
          below: box !== undefined && box.top >= rowBox.bottom - 0.5,
          left: box !== undefined && Math.abs(box.left - rowBox.left) <= 1,
          wide: box !== undefined && box.width >= rowBox.width - 1,
          last:
            label !== null &&
            label.parentElement?.matches('[data-landing]') === true &&
            label.parentElement.lastElementChild === label,
          boxes: {
            row: [rowBox.left, rowBox.top, rowBox.width, rowBox.bottom],
            label: box ? [box.left, box.top, box.width] : null,
          },
        }
      })
      console.log(
        `[landing] E12-L8 ${variantTitle(variant)} (${test.info().project.name}): ${JSON.stringify(line.boxes)}`,
      )
      expect
        .soft(
          [line.nextSibling, line.below, line.left, line.wide],
          '(g2) the field: the next sibling of the Share row, below it, at its left, as wide',
        )
        .toEqual([true, true, true, true])
      expect.soft(line.last, '(g3) the field is the last element of the landing').toBe(true)
    })
  }

  test('E12-L9 /en: Share opens the share sheet with the story title and the landing URL', async ({
    page,
  }) => {
    const setup: ShareSetup = { share: 'resolve', clipboard: 'reject' }
    await stubShare(page, setup)
    await openLanding(page, 'en')
    await waitForActions(page)
    await expectShareSetup(page, setup)
    await page.locator(SHARE).click()
    await expect.poll(async () => (await shareCalls(page)).share.length, 'the share sheet').toBe(1)
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
    const calls = await shareCalls(page)
    expect
      .soft(calls.share, '(g1) navigator.share: the en title and the landing URL')
      .toEqual([
        { title: storyFields(STORY, 'en').title, url: landingUrl(page, 'en'), onNavigator: true },
      ])
    expect.soft(calls.writeText, '(g2) the clipboard was not tried').toEqual([])
  })

  for (const outcome of ['copied', 'manual'] as const) {
    for (const variant of Object.values(STEP12_VARIANTS)) {
      test(`E12-L10 ${outcome} ${variantTitle(variant)}: a tap on Share at the bottom moves nothing under the finger, and a second tap within 500 ms is refused`, async ({
        page,
        errors,
      }) => {
        const skip = variantSkip(variant, test.info().project.name)
        test.skip(skip !== null, skip ?? '')
        test.setTimeout(120_000)
        await withHoldRetry(test.info(), (n) => shareAtTheBottom(page, errors, n, variant, outcome))
      })
    }
  }

  for (const [id, action, seeded] of [
    ['E12-L11a', 'Start', false],
    ['E12-L11b', 'Continue', true],
    ['E12-L11c', 'Start again', true],
  ] as const) {
    test(`${id} /en: ${action} holds, so a second tap cannot take a choice in the player`, async ({
      page,
      errors,
    }) => {
      test.setTimeout(90_000)
      const selector = action === 'Start' ? START : action === 'Continue' ? CONTINUE : START_AGAIN
      await withHoldRetry(test.info(), async (n): Promise<HoldAttempt> => {
        const p = await attemptPage(page, errors, n)
        if (seeded) await seedProgressOnce(p, { [STORY]: runIn('en', ['start', 'wise_path']) })
        const writes = await progressSpy(p)
        await watchNavHold(p)
        await openLanding(p, 'en')
        await waitForActions(p)
        // The tapped link is shown (design §21): Start's reserved box is where Continue shows, so a
        // landing that resumes a stored run would test Continue under Start's name.
        await expect(
          p.locator(ACTIONS),
          `precondition: the actions show ${seeded ? 'Continue' : 'Start'}`,
        ).toHaveAttribute('data-shown', seeded ? 'continue' : 'start')
        await expectHoldWatch(p)
        const first = await centreInViewport(p, selector)
        const from = (await holdRecord(p)).length
        await p.mouse.click(first.x, first.y)
        const target = await p.evaluate(
          async (path) => {
            const choiceOf = () => document.querySelector('[data-part] button[data-choice]')
            const ready = (): boolean =>
              location.pathname === path &&
              document.querySelector('[data-player][data-run-phase="open"]') !== null &&
              choiceOf() !== null
            const deadline = performance.now() + 5000
            while (!ready() && performance.now() < deadline) {
              await new Promise((resolve) => requestAnimationFrame(resolve))
            }
            const button = choiceOf()
            const part = document.querySelector('[data-part]')
            if (!ready() || button === null || part === null) return null
            const box = button.getBoundingClientRect()
            return {
              x: box.left + box.width / 2,
              y: box.top + box.height / 2,
              choice: button.getAttribute('data-choice') ?? '',
              node: part.getAttribute('data-node'),
              seq: part.getAttribute('data-seq'),
              writes: (
                ((window as unknown as Record<string, unknown>)['__e2eProgressWrites'] as
                  string[] | undefined) ?? []
              ).length,
            }
          },
          playerPath('en', STORY),
        )
        expect(target, 'precondition: the player opened with a choice').not.toBeNull()
        if (target === null) return { gap: null }
        const choiceSelector = `[data-part] button[data-choice="${target.choice}"]`
        await armBox(p, choiceSelector)
        await p.mouse.click(target.x, target.y)
        const { spans, downs, clicks } = await holdsSince(p, from)
        const gap =
          spans[0] !== undefined && downs[1] !== undefined ? downs[1].t - spans[0].on : null
        // A late second tap retries (13.9); a null gap (no hold seen at all) runs the groups.
        if (gap !== null && gap >= LATE_TAP_MS) return { gap }
        expectHoldInClick('(g0)', spans[0]?.on, clicks[0]?.t)
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
        const all = await writes()
        expect.soft(all.length, '(g2) no progress write since the open').toBe(target.writes)
        expect
          .soft(
            all.length,
            action === 'Start again'
              ? '(g2) exactly the reset write'
              : '(g2) no progress write at all',
          )
          .toBe(action === 'Start again' ? 1 : 0)
        await p.mouse.click(target.x, target.y)
        await expect
          .soft(part, '(g3) after the hold a tap on the choice steps once')
          .toHaveAttribute('data-seq', String(Number(target.seq) + 1))
        return { gap }
      })
    })
  }

  test('E12-L11d /en/stories/two-paths: "How this story was made" holds', async ({ page }) => {
    await watchNavHold(page)
    await openLanding(page, 'en')
    await waitForActions(page)
    await expectHoldWatch(page)
    const point = await centreInViewport(page, HOW_MADE)
    const from = (await holdRecord(page)).length
    await page.mouse.click(point.x, point.y)
    await page
      .waitForURL((url) => url.pathname === '/en/grown-ups', { timeout: 5000 })
      .catch(() => undefined)
    const after = await afterHold(page)
    const { spans, clicks } = await holdsSince(page, from)
    expectHoldInClick('(g1)', spans[0]?.on, clicks[0]?.t)
    const lasted =
      spans[0] !== undefined && spans[0].off !== null ? spans[0].off - spans[0].on : null
    expect
      .soft(
        [after.released, lasted !== null && lasted >= 499],
        '(g1) the hold was released after 500 ms (±1 ms)',
      )
      .toEqual([true, true])
    const url = new URL(page.url())
    expect
      .soft(`${url.pathname}${url.hash}`, '(g2) Grown-ups at the anchor')
      .toBe(`/en/grown-ups${HOW_MADE_HASH}`)
  })

  test('E12-L12 /en: the keyboard is never held', async ({ page, errors }) => {
    await withHoldRetry(test.info(), async (n): Promise<HoldAttempt> => {
      const p = await attemptPage(page, errors, n)
      await stubShare(p, { share: 'undefined', clipboard: 'resolve' })
      await watchNavHold(p)
      await openLanding(p, 'en')
      await waitForActions(p)
      await expectHoldWatch(p)
      const how = await centreInViewport(p, HOW_MADE)
      const from = (await holdRecord(p)).length
      // A Share tap starts the hold (a setup tap: nothing is held before it).
      await p.locator(SHARE).click()
      await p.mouse.click(how.x, how.y)
      await frames(p)
      const pathAfterClick = new URL(p.url()).pathname
      // A click the hold failed to refuse has left the landing: there is no How made to focus, so
      // the Enter is skipped rather than waited for, and the groups below decide ((g1) fails).
      const left = pathAfterClick !== landingPath('en', STORY)
      if (!left) {
        await p.locator(HOW_MADE).focus()
        await p.keyboard.press('Enter')
      }
      const { spans, downs, clicks, keys } = await holdsSince(p, from)
      const enter = keys.find((key) => key.key === 'Enter')
      const gap = spans[0] !== undefined && downs[1] !== undefined ? downs[1].t - spans[0].on : null
      // Both the click and the Enter must fall inside the hold (13.9): a late click or a late Enter
      // is a late attempt. A null gap (no hold seen at all), or a timely click that left the landing
      // (no Enter to time), is not late: the groups run, and (g1) fails.
      if (gap !== null && (gap >= LATE_TAP_MS || (!left && enter?.held !== true))) {
        return { gap: enter?.held === true || left ? gap : Math.max(gap, LATE_TAP_MS) }
      }
      expect.soft(downs[1]?.held, '(g1) the hold was on at the click on How made').toBe(true)
      expect
        .soft(pathAfterClick, '(g1) no navigation after two frames')
        .toBe(landingPath('en', STORY))
      expect
        .soft(
          clicks[1]?.inMain,
          `(g1) the click's target (${clicks[1]?.target ?? 'none'}) lies outside main`,
        )
        .toBe(false)
      await p
        .waitForURL((url) => url.pathname === '/en/grown-ups', { timeout: 5000 })
        .catch(() => undefined)
      const url = new URL(p.url())
      expect
        .soft(`${url.pathname}${url.hash}`, '(g2) Enter within the hold still navigates')
        .toBe(`/en/grown-ups${HOW_MADE_HASH}`)
      return { gap }
    })
  })

  test('E12-L16 /en/stories/two-paths with storage blocked: the banner, Start, no Start again', async ({
    page,
  }) => {
    await blockStorage(page)
    await openLanding(page, 'en')
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
      .soft(page.locator(ACTIONS), '(g2) the action row shows Start')
      .toHaveAttribute('data-shown', 'start')
    const state = await actionsOf(page)
    expect
      .soft([isShown(state.start), isHidden(state.again)], '(g2) Start shown, Start again hidden')
      .toEqual([true, true])
  })

  test(`E12-L17 ${variantTitle(STEP12_VARIANTS.V4)}: no horizontal scroll; targets at least 44 px`, async ({
    page,
    errors,
  }) => {
    const variant = STEP12_VARIANTS.V4
    const skip = variantSkip(variant, test.info().project.name)
    test.skip(skip !== null, skip ?? '')
    const aborted = await prepareStep12Variant(page, variant, errors)
    await seedProgressOnce(page, { [STORY]: runIn(variant.code, ['start', 'wise_path']) })
    await openLanding(page, variant.code)
    await waitForActions(page)
    await expectStep12Variant(page, variant, aborted)
    const layout = await page.evaluate(
      (selectors) => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        targets: selectors.map((selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect()
          return { selector, width: box?.width ?? 0, height: box?.height ?? 0 }
        }),
      }),
      [CONTINUE, START_AGAIN, HOW_MADE, SHARE],
    )
    console.log(`[landing] E12-L17 (${test.info().project.name}): ${JSON.stringify(layout)}`)
    expect
      .soft(layout.scrollWidth, '(g1) no horizontal scroll')
      .toBeLessThanOrEqual(layout.clientWidth)
    expect
      .soft(
        layout.targets
          .filter((t) => t.width < 44 || t.height < 44)
          .map((t) => `${t.selector} ${t.width}x${t.height}`),
        '(g2) Continue, Start again, How made and Share at least 44 x 44 px',
      )
      .toEqual([])
  })

  test('E12-L18 /en/stories/two-paths: a newer-schema progress record shows the storage banner, leaves the bytes untouched and offers Start', async ({
    page,
    browserName,
  }) => {
    const raw = JSON.stringify({
      schema: RECORD_SCHEMA + 1,
      stories: {
        [STORY]: {
          version: playerFixture(STORY).version,
          activeRun: { path: ['start', 'wise_path'], locale: 'en' },
          endingsFound: [],
          order: 1,
        },
      },
    })
    await seedRawProgressOnce(page, raw)
    if (browserName === 'chromium') await recordLayoutShifts(page)
    await openLanding(page, 'en')
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
      .soft(page.locator(ACTIONS), '(g3) the action row shows Start')
      .toHaveAttribute('data-shown', 'start')
    const state = await actionsOf(page)
    expect
      .soft(
        [isShown(state.start), isHidden(state.cont), isHidden(state.again)],
        '(g3) Start shown; Continue and Start again hidden',
      )
      .toEqual([true, true, true])
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
    test.info().annotations.push({ type: 'E12-L18 (reported)', description: reported })
    console.log(`[landing] E12-L18 (${test.info().project.name}): ${reported}`)
  })
})

/**
 * E12-L5's page run: the variant, an optional saved run, the scripts held so the server HTML paints
 * first; boxes measured before and after the read, and on Chromium the raw shift sum after the
 * release.
 */
async function landingBoxes(
  page: Page,
  variant: Step12Variant,
  errors: ConsoleErrors,
  browserName: string,
  saved: boolean,
): Promise<{ before: BoxSet; after: BoxSet; raw: number | null; lines: string[] }> {
  const { code } = variant
  const aborted = await prepareStep12Variant(page, variant, errors)
  if (saved) await seedProgressOnce(page, { [STORY]: runIn(code, ['start', 'wise_path']) })
  if (browserName === 'chromium') await recordLayoutShifts(page)
  const chunks = await holdChunksUntil(page)
  const response = await page.goto(landingPath(code, STORY), { waitUntil: 'domcontentloaded' })
  expect(response?.status(), landingPath(code, STORY)).toBe(200)
  await expectStep12Variant(page, variant, aborted, { scriptsHeld: true })
  expect(chunks.held(), 'precondition: the JavaScript chunks were held').toBeGreaterThan(0)
  const selectors = [
    `${LANDING} > *`,
    ACTIONS,
    `${ACTIONS} [data-story-action]`,
    START_AGAIN,
    HOW_MADE,
    SHARE_ROW,
  ]
  const before = await boxesOf(page, selectors)
  expect(
    await page.locator(ACTIONS).getAttribute('data-shown'),
    'precondition: pending in the server HTML',
  ).toBe('pending')
  const from = await page.evaluate(() => performance.now())
  chunks.release()
  await waitForActions(page)
  await frames(page)
  const after = await boxesOf(page, selectors)
  const to = await page.evaluate(() => performance.now())
  const state = await actionsOf(page)
  if (saved) {
    expect(
      [state.shown, isShown(state.cont), isShown(state.again)],
      'precondition: page B shows Continue and Start again',
    ).toEqual(['continue', true, true])
  } else {
    expect([state.shown, isShown(state.start)], 'precondition: page A shows Start').toEqual([
      'start',
      true,
    ])
  }
  if (browserName !== 'chromium') return { before, after, raw: null, lines: [] }
  const shift = await layoutShift(page, { from, to })
  return { before, after, raw: shift.raw, lines: shift.lines }
}

/**
 * One attempt of E12-L10 (13.4.2, CRIT-2): Share tapped at the bottom of the landing; a second tap
 * at the same point within the hold; after the hold, a third tap at Share's centre and a fourth at
 * that point within the new hold.
 */
async function shareAtTheBottom(
  page: Page,
  errors: ConsoleErrors,
  n: number,
  variant: Step12Variant,
  outcome: 'copied' | 'manual',
): Promise<HoldAttempt> {
  const { code } = variant
  const lang = uiLang(code)
  const p = await attemptPage(page, errors, n)
  // A stub on both engines: the counts of writeText are what this test reads.
  const setup: ShareSetup = {
    share: 'undefined',
    clipboard: outcome === 'copied' ? 'resolve' : 'reject',
  }
  const aborted = await prepareStep12Variant(p, variant, errors)
  await stubShare(p, setup)
  await recordAnnouncements(p)
  await watchNavHold(p)
  await openLanding(p, code)
  await waitForActions(p)
  await expectStep12Variant(p, variant, aborted)
  await expectShareSetup(p, setup)
  await expectHoldWatch(p)
  const bottom = await scrollToBottom(p)
  const project = test.info().project.name
  console.log(
    `[landing] E12-L10 ${outcome} ${variantTitle(variant)} (${project}): the landing is ${bottom.ratio.toFixed(2)} viewports`,
  )
  if (variant.name === 'V3' || variant.name === 'V4') {
    expect(
      bottom.scrollHeight,
      `precondition: the landing scrolls (${bottom.ratio.toFixed(2)} viewports)`,
    ).toBeGreaterThan(bottom.innerHeight)
  }
  const box1 = await boxOf(p, SHARE)
  const point = { x: (box1.left + box1.right) / 2, y: (box1.top + box1.bottom) / 2 }
  expect(
    point.y > 0 && point.y < bottom.innerHeight,
    'precondition: Share is on screen at the bottom',
  ).toBe(true)
  const from = (await holdRecord(p)).length
  await p.mouse.click(point.x, point.y)
  const settled = await p.evaluate(
    async (selector) => {
      const start = performance.now()
      while (document.querySelector(selector) === null && performance.now() - start < 2000) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      return { found: document.querySelector(selector) !== null, scrollY: window.scrollY }
    },
    outcome === 'copied' ? SHARE_STATUS : SHARE_URL,
  )
  const box2 = await boxOf(p, SHARE)
  // The field's margin box (design §16 F2, 4.12 row 7): its border box plus its computed
  // margin-block-start, which is the page's growth at the bottom. Read without waiting: `settled`
  // already waited for the field, and its precondition below names a missing one.
  const field =
    outcome === 'manual'
      ? await p.evaluate((selector) => {
          const label = document.querySelector(selector)
          if (label === null) return null
          return {
            height: label.getBoundingClientRect().height,
            marginBlockStart: parseFloat(getComputedStyle(label).marginBlockStart) || 0,
          }
        }, FIELD)
      : null
  const under = await boxesAt(p, point, [
    SHARE,
    FIELD,
    HOW_MADE,
    START,
    CONTINUE,
    START_AGAIN,
    `${LANDING} h1`,
    '[data-story-meta]',
  ])
  const valueAfter1 =
    outcome === 'copied'
      ? ((await p.locator(SHARE_STATUS).textContent()) ?? '').trim()
      : await p.locator(SHARE_URL).inputValue()
  await p.mouse.click(point.x, point.y)
  const { spans, downs, clicks } = await holdsSince(p, from)
  const gap = spans[0] !== undefined && downs[1] !== undefined ? downs[1].t - spans[0].on : null
  // A late second tap retries (13.9); a null gap (no hold seen at all) runs the groups.
  if (gap !== null && gap >= LATE_TAP_MS) return { gap }
  // Taps 3 and 4 run before any assertion, so a fourth tap that came LATE_TAP_MS or more after the
  // new hold began retries the attempt (13.9) with nothing asserted yet; it never fails g3 or g4.
  const calls2 = await shareCalls(p)
  const valueAfter2 =
    outcome === 'copied'
      ? ((await p.locator(SHARE_STATUS).textContent()) ?? '').trim()
      : await p.locator(SHARE_URL).inputValue()
  const released = await afterHold(p)
  const third = await centreInViewport(p, SHARE)
  const beforeThird = await boxOf(p, SHARE)
  const from3 = (await holdRecord(p)).length
  await p.mouse.click(third.x, third.y)
  await p.mouse.click(third.x, third.y)
  await p.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  const later = await holdsSince(p, from3)
  const gap4 =
    later.spans[0] !== undefined && later.downs[1] !== undefined
      ? later.downs[1].t - later.spans[0].on
      : null
  if (gap4 !== null && gap4 >= LATE_TAP_MS) return { gap: gap4 }

  expect(settled.found, `precondition: the share ended ${outcome}`).toBe(true)
  if (outcome === 'copied') {
    expect
      .soft(
        [
          box2.left - box1.left,
          box2.top - box1.top,
          box2.right - box1.right,
          box2.bottom - box1.bottom,
        ].map((d) => Math.abs(d) <= 0.01),
        `(g1) copied: Share's box is unchanged (${JSON.stringify(box1)} then ${JSON.stringify(box2)})`,
      )
      .toEqual([true, true, true, true])
  } else {
    const moved = settled.scrollY - bottom.scrollY
    // The bound is the field's margin box plus 1 px for sub-pixel rounding (design §16 F2): on
    // chromium-phone at 150% the move equals the margin box exactly (96 = 88 + 8, round 1).
    const bound = field === null ? 0 : field.height + field.marginBlockStart + 1
    console.log(
      `[landing] E12-L10 manual ${variantTitle(variant)} (${project}): moved ${moved} px; field border box ${field?.height ?? 'none'} px, margin-block-start ${field?.marginBlockStart ?? 'none'} px; bound ${bound} px`,
    )
    expect
      .soft(
        Math.abs(moved),
        `(g1) manual: the focus scroll moved the page by at most the field's margin box + 1 px (moved ${moved} px; border box ${field?.height ?? 'none'} px, margin-block-start ${field?.marginBlockStart ?? 'none'} px; bound ${bound} px)`,
      )
      .toBeLessThanOrEqual(bound)
    expect
      .soft(
        under.filter((s) => s !== SHARE && s !== FIELD),
        `(g1) manual: the point lies in Share or the field only (${under.join(', ')})`,
      )
      .toEqual([])
    expect
      .soft(under.length, `(g1) manual: the point lies in Share or the field (${under.join(', ')})`)
      .toBeGreaterThan(0)
  }
  expectHoldInClick('(g2)', spans[0]?.on, clicks[0]?.t)
  expect.soft(downs[1]?.held, '(g2) the hold was on at the second pointerdown').toBe(true)
  expect
    .soft(
      [calls2.writeText.length, calls2.shareClicks],
      '(g2) no second chain: one writeText, one Share click',
    )
    .toEqual([1, 1])
  expect.soft(valueAfter2, '(g2) the status or the field is unchanged').toBe(valueAfter1)

  expect.soft(released.released, '(g3) the first hold was released').toBe(true)
  const box3 = await boxOf(p, SHARE)
  const under3 = await boxesAt(p, third, [
    SHARE,
    FIELD,
    HOW_MADE,
    START,
    CONTINUE,
    START_AGAIN,
    `${LANDING} h1`,
    '[data-story-meta]',
  ])
  const reported = `${outcome} ${variantTitle(variant)}: gap ${gap === null ? 'none (no hold seen)' : gap.toFixed(0)} ms; Share moved by ${(box3.top - beforeThird.top).toFixed(1)} px after tap 3 (the pending shrink and scroll clamp); under tap 3's point now: ${under3.join(', ') || 'nothing hooked'}`
  test.info().annotations.push({ type: 'E12-L10 (reported)', description: reported })
  console.log(`[landing] E12-L10 (${project}): ${reported}`)
  const calls3 = await shareCalls(p)
  expect
    .soft(calls3.writeText.length, '(g3) after the hold a tap runs the chain again')
    .toBeGreaterThanOrEqual(2)
  expectHoldInClick('(g3) a new hold:', later.spans[0]?.on, later.clicks[0]?.t)
  if (outcome === 'copied') {
    await expect
      .poll(async () => announcements(p), {
        message: '(g3) copied: announced again',
        timeout: 2000,
      })
      .toEqual([message(lang, 'player.linkCopied'), message(lang, 'player.linkCopied')])
      .catch(() => undefined)
    expect
      .soft(await announcements(p), '(g3) copied: announced again')
      .toEqual([message(lang, 'player.linkCopied'), message(lang, 'player.linkCopied')])
  }
  expect.soft(later.downs[1]?.held, '(g4) the fourth tap fell inside the new hold').toBe(true)
  expect.soft(calls3.writeText.length, '(g4) the fourth tap ran no chain').toBe(2)
  return { gap }
}
