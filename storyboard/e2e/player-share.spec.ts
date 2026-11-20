// The story player's ending card, Step 10c (spec §6.1 player ending view and "Share", §6.5, §6.6;
// design p1-step10-design.md §4.1, §4.3, §4.6, D11-P7, P9, P11, P13, P14, §9.3 T-c1 to T-c4, §15
// C5, C6, §16 F4, O5; P1-4b). Review and staging legs (@review), on lantern-walk, the shortest
// fixture (start, crossroads, then ending_light or the alternate ending_shadow).
// - Every test collects console errors and page errors (consoleErrors, an auto fixture as in
//   player.spec.ts) and fails on any: none of these tests causes an error on purpose, so no
//   pattern is declared on either engine.
// - Share (C5, O5): every share test first sets navigator.share and navigator.canShare on
//   Navigator.prototype by an init script, to a stub or to undefined, so the branch under test never
//   depends on what the browser build exposes (the test Chromium and WebKit have neither). The
//   clipboard is the real one only in Chromium with clipboard permissions granted; elsewhere
//   navigator.clipboard is a stub whose writeText resolves or rejects. The stubs record every call
//   in the page.
// - Coordinate clicks (F4): the point is checked to lie inside the viewport first, and the target
//   is scrolled into view by evaluate when it does not. Commit and tap times are read in the page; a
//   tap 450 ms or more after the commit fails as "timing", never as a pass or a settle bug.
// - T-c5 (the lead's addition): a double tap on Try another path acts once, in the T-b2 form (a
//   measured point, a within-settle fallback, in-page times).
// - Review fixes (10c fixer): T-c1 checks the focus at both endings (the passage, outside the card,
//   no ring; A11Y-10c-1). T-c6 and T-c7 hold the stored half of the count (F1, R10c-STRESS-1): the
//   endings read at open on a resumed run, and an ending another tab saves while the card is shown.
//   T-c8: a copy or share sheet that ends after Try another path shows and announces nothing
//   (R10c-STRESS-3, A11Y-10c-3).
// - Second review: the helpers both player specs use (selectors, openPlayer, frames, pageValue, the
//   stored story, the live-region recorder, the dialog watcher, coordinate-click geometry) live in
//   page-helpers.ts. T-c7 brings the page to the front after the other tab closes and reads the
//   live region only after two frames, so an announcement the storage event caused cannot hide
//   behind announce()'s one-frame delay (R2-SE-1, R2-CI-TC7-1).
// - Step 10d (the 10c hand-off; design D11-P4): a story-language switch at an ending keeps the
//   card and resets Share: "Link copied." or the field holding the old language's URL goes, the next
//   tap shares the new language's URL, and a copy pending across the switch ends unseen.
// - P1-4 owner screens (design p1-4-polish-design.md §5): T8 (the manual field on its own
//   full-width line under the action row), T9 (the T-c2 copied case parametrised: "Link copied."
//   next to Share) and T8c (the 10d hand-off manual case: after a switch the row keeps its order and
//   Try another path restarts). T8 and T9 also run under the wide Devanagari fallback with the
//   self-hosted font files aborted (Chromium logs each abort; WebKit logs none).
// P1-3 Step 12a (design p1-step12-design.md §3.11 N12, §13.4.3 E12-P1, §13.5 item 2, CRIT-3):
// - The shared URL is the story's landing URL in the content locale (shareUrl; SPEC:436 amended,
//   E2), so every T-c2, T-c4, T-c8 and 10d hand-off check that compares a URL follows it.
// - The share stubs (ShareSetup, stubShare, shareCalls, settleLater, expectShareSetup) moved to
//   page-helpers.ts unchanged (W7), so the landing's Share tests use the same ones.
// - All stories renders through HeldLink, so a tap holds pointer taps for 500 ms on the ending
//   and on Home (E12-P1, V1, V3 and V4: a second tap on a Home card within the hold is refused).
//   T-c3 and T-c4 tap All stories with locator.click(), which waits out a hold (builder hazard).
import type { Page } from '@playwright/test'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../src/core/locales'
import { expect, test as base } from './fixtures'
import {
  announcements,
  attemptPage,
  boxOf,
  centreInViewport,
  choice,
  consoleErrors,
  endingsOf,
  expectHoldWatch,
  expectShareSetup,
  expectStep12Variant,
  expectWideFallback,
  FIRST_PARAGRAPH,
  fixtureGraph,
  frames,
  heldTapIntoHome,
  LATE_TAP_MS,
  openPlayer,
  pageValue,
  PART,
  PLAYER,
  prepareStep12Variant,
  prepareVariant,
  recordAnnouncements,
  ROW_PHONES,
  RUN,
  scrollToBottom,
  seedProgressOnce,
  settleFonts,
  settleLater,
  shareCalls,
  sharedPoint,
  STEP12_VARIANTS,
  storedStory,
  stubShare,
  tabReachesLinks,
  variantSkip,
  variantTitle,
  walk,
  watchDialogOpen,
  watchNavHold,
  withHoldRetry,
  type ConsoleErrors,
  type RowVariant,
  type ShareSetup,
} from './page-helpers'
import { formatted, landingPath, message, playerFixture, playerPath, uiLang } from './routes'

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

const STORY = 'lantern-walk'
const CARD = '[data-part] section[data-ending]'
const ACTIONS = `${CARD} [data-ending-actions]`
const TRY_ANOTHER = `${ACTIONS} button[data-try-another]`
const SHARE = `${ACTIONS} button[data-share]`
const ALL_STORIES = `${ACTIONS} a[data-all-stories]`
const SHARE_STATUS = `${ACTIONS} [data-share-status]`
const SHARE_URL = `${ACTIONS} input[data-share-url]`
/** T-c4: the Share tap that must work comes this long after the ending commit (C6). */
const AFTER_SETTLE_MS = 600
/** T-c6: a stored id that is no ending of lantern-walk (the record keeps such ids, records.ts). */
const STALE_ENDING = 'ending_old'

/** Waits until the card's actions on screen are no longer inert (the settle has ended). */
async function waitCardSettled(page: Page): Promise<void> {
  await expect(page.locator(ACTIONS)).not.toHaveAttribute('inert')
}

/** Where the focus is at an ending (D11-P8, P13): the passage's first paragraph, with no ring. */
async function endingFocus(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement
    const style = active === null ? null : getComputedStyle(active)
    return {
      onFirstParagraph:
        active !== null && active === document.querySelector('[data-part] [data-passage] p'),
      inCard: active?.closest('section[data-ending]') != null,
      outline: style?.outlineStyle ?? null,
      shadow: style?.boxShadow ?? null,
    }
  })
}

const ENDING_FOCUS = { onFirstParagraph: true, inCard: false, outline: 'none', shadow: 'none' }

interface Centres {
  /** The centres of the armed selectors, in their order (viewport coordinates). */
  readonly points: readonly { readonly x: number; readonly y: number }[]
  /** Whether the page was scrolled first, because a centre lay outside the viewport. */
  readonly scrolled: boolean
  /** Whether every centre lies inside the viewport after that. */
  readonly inside: boolean
}

/**
 * Arms the page (F4): when the part of `seq` commits and every one of `selectors` is in the page,
 * a MutationObserver measures their centres at once (viewport coordinates), so no round trip lies
 * between the commit and the measurement. When any centre lies outside the viewport, `scrollTo` is
 * scrolled into view by evaluate and every centre is measured again. Read with measuredCentres().
 */
async function armCentres(
  page: Page,
  seq: number,
  selectors: readonly string[],
  scrollTo: string,
): Promise<void> {
  await page.evaluate(
    ([wantedSeq, wanted, target]) => {
      const w = window as unknown as Record<string, unknown>
      w['__e2eCentres'] = new Promise((resolve) => {
        const centre = (selector: string) => {
          const element = document.querySelector(selector)
          if (element === null) throw new Error(`no ${selector}`)
          const box = element.getBoundingClientRect()
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
        }
        const inside = (p: { x: number; y: number }) =>
          p.x >= 0 &&
          p.y >= 0 &&
          p.x < document.documentElement.clientWidth &&
          p.y < window.innerHeight
        const observer = new MutationObserver(() => {
          if (document.querySelector(`[data-part][data-seq="${wantedSeq}"]`) === null) return
          if (wanted.some((selector) => document.querySelector(selector) === null)) return
          observer.disconnect()
          let points = wanted.map(centre)
          let scrolled = false
          if (!points.every(inside)) {
            document.querySelector(target)?.scrollIntoView({ block: 'center' })
            points = wanted.map(centre)
            scrolled = true
          }
          resolve({ points, scrolled, inside: points.every(inside) })
        })
        observer.observe(document.body, { childList: true, subtree: true })
      })
    },
    [seq, [...selectors], scrollTo] as const,
  )
}

/** The centres armCentres() measured; resolves once the armed part has committed. */
async function measuredCentres(page: Page): Promise<Centres> {
  return pageValue<Centres>(page, '__e2eCentres')
}

interface ControlTap {
  readonly t: number
  /** The part of the control whose box holds the pointer. */
  readonly node: string | null
  /** That control, inert or not: a choice id, 'try-another', 'share' or 'all-stories'. */
  readonly control: string | null
  /** Whether that control sat inside an inert element at the time. */
  readonly inert: boolean | null
}

interface ControlTaps {
  readonly commitAt: number | null
  readonly downs: readonly ControlTap[]
}

/**
 * In the page (F4): the time the part of `seq` commits (a MutationObserver), and for every
 * pointerdown (capture phase on document) its time and the run-area control whose box holds the
 * pointer, inert or not (hit testing skips inert elements, so the event target cannot say), with
 * that control's part. Read back as __e2eControlTaps.
 */
async function watchControlTaps(page: Page, seq: number): Promise<void> {
  await page.evaluate((wantedSeq) => {
    const record: { commitAt: number | null; downs: ControlTap[] } = { commitAt: null, downs: [] }
    ;(window as unknown as Record<string, unknown>)['__e2eControlTaps'] = record
    const observer = new MutationObserver(() => {
      if (record.commitAt !== null) return
      if (document.querySelector(`[data-part][data-seq="${wantedSeq}"]`) === null) return
      record.commitAt = performance.now()
      observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const nameOf = (control: Element): string => {
      const id = control.getAttribute('data-choice')
      if (id !== null) return id
      if (control.hasAttribute('data-try-another')) return 'try-another'
      if (control.hasAttribute('data-share')) return 'share'
      return 'all-stories'
    }
    document.addEventListener(
      'pointerdown',
      (event) => {
        const control = [
          ...document.querySelectorAll(
            '[data-part] button[data-choice], [data-part] button[data-try-another], [data-part] button[data-share], [data-part] a[data-all-stories]',
          ),
        ].find((candidate) => {
          const box = candidate.getBoundingClientRect()
          return (
            event.clientX >= box.left &&
            event.clientX <= box.right &&
            event.clientY >= box.top &&
            event.clientY <= box.bottom
          )
        })
        record.downs.push({
          t: performance.now(),
          node: control?.closest('[data-part]')?.getAttribute('data-node') ?? null,
          control: control === undefined ? null : nameOf(control),
          inert: control === undefined ? null : control.closest('[inert]') !== null,
        })
      },
      { capture: true },
    )
  }, seq)
}

/**
 * The shared URL: the story's landing URL in the content locale on this origin (D11-P14; Step 12
 * N12, E2: the landing carries the Open Graph tags).
 */
function shareUrl(page: Page, contentLocale: LocaleCode): string {
  return `${new URL(page.url()).origin}${landingPath(contentLocale, STORY)}`
}

/** A fixture ending node's card data (fixtures/packages/lantern-walk.json, read only). */
function endingNode(nodeId: string): {
  readonly isAlternate: boolean
  readonly lessonIcon: string
} {
  const node = playerFixture(STORY).nodes.find((candidate) => candidate.id === nodeId) as
    { readonly isAlternate?: unknown; readonly lessonIcon?: unknown } | undefined
  if (typeof node?.isAlternate !== 'boolean' || typeof node.lessonIcon !== 'string') {
    throw new Error(`${STORY}: ${nodeId} is not an ending with an icon`)
  }
  return { isAlternate: node.isAlternate, lessonIcon: node.lessonIcon }
}

/** The card on screen, child by child (D11-P13 order, §4.1, §4.6). */
async function cardOf(page: Page) {
  return page.locator(CARD).evaluate((section) => {
    const text = (selector: string): string | null =>
      section.querySelector(selector)?.textContent ?? null
    const kindOf = (element: Element): string => {
      if (element.matches('[data-lesson-icon]')) return 'icon'
      if (element.matches('[data-alternate]')) return 'alternate'
      if (element.matches('h2')) return 'heading'
      if (element.matches('[data-lesson]')) return 'lesson'
      if (element.matches('[data-ending-count]')) return 'count'
      if (element.matches('[data-ending-actions]')) return 'actions'
      return element.localName
    }
    const lesson = section.querySelector('[data-lesson]')
    const icon = section.querySelector('[data-lesson-icon]')
    const actions = section.querySelector('[data-ending-actions]')
    const part = section.closest('[data-part]')
    return {
      afterStory: section.previousElementSibling?.hasAttribute('data-story') ?? false,
      inPart: part !== null && section.parentElement === part,
      next: section.nextElementSibling?.localName ?? null,
      labelledBy: section.getAttribute('aria-labelledby'),
      headingId: section.querySelector('h2')?.id ?? null,
      children: [...section.children].map(kindOf),
      icon: icon === null ? null : [icon.textContent, icon.getAttribute('aria-hidden')],
      alternate: text('[data-alternate]'),
      heading: text('h2'),
      lesson:
        lesson === null
          ? null
          : {
              text: lesson.textContent,
              lang: lesson.getAttribute('lang'),
              fontStyle: getComputedStyle(lesson).fontStyle,
            },
      count: text('[data-ending-count]'),
      pageLang: section.closest('[lang]')?.getAttribute('lang') ?? null,
      actions: [...(actions?.querySelectorAll('button, a') ?? [])].map((control) => [
        control.matches('[data-try-another]')
          ? 'try-another'
          : control.matches('[data-share]')
            ? 'share'
            : control.matches('[data-all-stories]')
              ? 'all-stories'
              : control.localName,
        (control.textContent ?? '').trim(),
      ]),
      tryAnotherSeq: section.querySelector('[data-try-another]')?.getAttribute('data-seq') ?? null,
      partSeq: part?.getAttribute('data-seq') ?? null,
      allStoriesHref: section.querySelector('a[data-all-stories]')?.getAttribute('href') ?? null,
    }
  })
}

/** The card D11-P13 asks for at `ending`, with the count "Ending `found` of y found". */
function expectedCard(code: LocaleCode, contentLocale: LocaleCode, ending: string, found: number) {
  const lang = uiLang(code)
  const graph = fixtureGraph(STORY)
  const { isAlternate, lessonIcon } = endingNode(ending)
  const lesson = graph.text[contentLocale]?.nodes[ending]?.lesson
  if (lesson === undefined) throw new Error(`${STORY} ${contentLocale} ${ending} has no lesson`)
  return {
    afterStory: true,
    inPart: true,
    next: 'footer',
    labelledBy: 'player-lesson-heading',
    headingId: 'player-lesson-heading',
    children: [
      'icon',
      ...(isAlternate ? ['alternate'] : []),
      'heading',
      'lesson',
      'count',
      'actions',
    ],
    icon: [lessonIcon, 'true'],
    alternate: isAlternate ? message(lang, 'player.altEnding') : null,
    heading: message(lang, 'player.lessonHeading'),
    lesson: { text: lesson, lang: contentLocale, fontStyle: 'normal' },
    count: formatted(lang, 'player.endingCount', { found, total: endingsOf(graph).length }),
    pageLang: code,
    actions: [
      ['try-another', message(lang, 'player.tryAnother')],
      ['share', message(lang, 'player.share')],
      ['all-stories', message(lang, 'player.allStories')],
    ],
    allStoriesHref: `/${code}`,
  }
}

/**
 * Opens lantern-walk at /`code` and walks to ending_light, then waits until the card's actions
 * have settled. With `hiRun`, a Hindi run at the crossroads is stored first, so the page resumes in
 * Hindi (stored-first) and the content locale differs from the route's.
 */
async function reachEnding(
  page: Page,
  code: LocaleCode,
  options: { readonly hiRun?: boolean } = {},
): Promise<void> {
  if (options.hiRun === true) {
    await seedProgressOnce(page, {
      [STORY]: { activeRun: { path: ['start', 'crossroads'], locale: 'hi' } },
    })
  }
  await openPlayer(page, playerPath(code, STORY))
  if (options.hiRun === true) {
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'crossroads')
    await expect(page.locator('[data-part] [data-story]')).toHaveAttribute('lang', 'hi')
    await walk(page, STORY, ['c1'])
  } else {
    await walk(page, STORY, ['c1', 'c1'])
  }
  await expect(page.locator(PART)).toHaveAttribute('data-node', 'ending_light')
  await waitCardSettled(page)
}

// P1-4 owner screens (design p1-4-polish-design.md T8, T9): the share states under each text size
// and font the layout rule asks for (rules LAYOUT STABILITY): /en and /hi with the fonts loaded,
// 150% on the phones; and /hi under a Devanagari fallback much wider than Noto (the CI image's),
// kept for the whole test by aborting the self-hosted font files (holding them makes WebKit never
// let a choice be tapped; design §1.4, RP4).

const ROW_VARIANTS: readonly RowVariant[] = [
  { code: 'en', scale: 100, wide: false },
  { code: 'hi', scale: 100, wide: false },
  { code: 'en', scale: 150, wide: false },
  { code: 'hi', scale: 150, wide: false },
  { code: 'hi', scale: 100, wide: true },
  { code: 'hi', scale: 150, wide: true },
]
const ROW_TABLETS: readonly string[] = [
  'chromium-tablet',
  'chromium-tablet-landscape',
  'webkit-ipad',
]

/** The test title's suffix; none for /en at 100% with the fonts loaded (the original case). */
function variantName(variant: RowVariant): string {
  if (variant.code === 'en' && variant.scale === 100 && !variant.wide) return ''
  return ` (/${variant.code}, ${variant.scale}%${variant.wide ? ', wide Devanagari fallback, font files aborted' : ''})`
}

/** 150% text runs on the phones only. */
function skipVariant(variant: RowVariant): void {
  test.skip(
    variant.scale !== 100 && !ROW_PHONES.includes(test.info().project.name),
    '150% text: the phones',
  )
}

test.describe('the story player, Step 10c: the ending card', { tag: '@review' }, () => {
  for (const code of ENABLED_LOCALE_CODES) {
    test(`T-c1 /${code}: the card at ending_light, the count announced; Try another path to the alternate ending_shadow`, async ({
      page,
    }) => {
      const lang = uiLang(code)
      const graph = fixtureGraph(STORY)
      const total = endingsOf(graph).length
      const count = (found: number) => formatted(lang, 'player.endingCount', { found, total })
      const pageN = (n: number) => formatted(lang, 'player.page', { n })
      await recordAnnouncements(page)
      await openPlayer(page, playerPath(code, STORY))
      await walk(page, STORY, ['c1', 'c1'])
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'ending_light')
      await expect(page.locator(`${CARD} [data-ending-count]`)).toHaveText(count(1))
      await expect(page.locator('#live-region')).toHaveText(count(1))
      expect(
        await announcements(page),
        'the step to the ending announces the count, never "Page 3" (D11-P9)',
      ).toEqual([pageN(2), count(1)])
      expect(
        await endingFocus(page),
        'focus at ending_light: the passage, not the card, no ring (D11-P8, P13)',
      ).toEqual(ENDING_FOCUS)
      const light = await cardOf(page)
      expect(light, 'the card at ending_light').toMatchObject(
        expectedCard(code, code, 'ending_light', 1),
      )
      expect(light.tryAnotherSeq, 'Try another path carries the seq of its part').toBe(
        light.partSeq,
      )
      await expect
        .poll(() => storedStory(page, STORY), 'the stored story at ending_light')
        .toMatchObject({ activeRun: null, endingsFound: ['ending_light'] })

      // Try another path: RESTART with no dialog, endings kept (D11-P11).
      await waitCardSettled(page)
      const epoch = Number(await page.locator(RUN).getAttribute('data-epoch'))
      await watchDialogOpen(page)
      await page.locator(TRY_ANOTHER).click()
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
      await expect(page.locator(RUN)).toHaveAttribute('data-epoch', String(epoch + 1))
      await expect(page.locator(CARD), 'no card at the start').toHaveCount(0)
      expect(await pageValue(page, '__e2eDialogOpened'), 'the dialog ever opened').toBe(false)
      await expect(page.locator(FIRST_PARAGRAPH).first(), 'focus after the restart').toBeFocused()
      await expect(page.locator('#live-region')).toHaveText(pageN(1))
      await expect
        .poll(() => storedStory(page, STORY), 'the stored story after Try another path')
        .toMatchObject({ activeRun: null, endingsFound: ['ending_light'] })

      await walk(page, STORY, ['c1', 'c2'])
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'ending_shadow')
      await expect(page.locator(`${CARD} [data-ending-count]`)).toHaveText(count(2))
      await expect(page.locator('#live-region')).toHaveText(count(2))
      expect(await announcements(page), 'announced, in order').toEqual([
        pageN(2),
        count(1),
        pageN(1),
        pageN(2),
        count(2),
      ])
      expect(
        await endingFocus(page),
        'focus at ending_shadow: the passage, not the card, no ring (D11-P8, P13)',
      ).toEqual(ENDING_FOCUS)
      expect(await cardOf(page), 'the card at the alternate ending_shadow').toMatchObject(
        expectedCard(code, code, 'ending_shadow', 2),
      )
      await expect
        .poll(
          async () => [...((await storedStory(page, STORY))?.endingsFound ?? [])].sort(),
          'the stored endings',
        )
        .toEqual(['ending_light', 'ending_shadow'])
    })
  }

  for (const code of ENABLED_LOCALE_CODES) {
    test(`T-c6 /${code} resumed with endings stored on an earlier visit: the count includes them (a stored id that is no ending does not), and the step announces it`, async ({
      page,
    }) => {
      const lang = uiLang(code)
      const graph = fixtureGraph(STORY)
      const total = endingsOf(graph).length
      const count = (found: number) => formatted(lang, 'player.endingCount', { found, total })
      expect(graph.nodes.has(STALE_ENDING), `${STALE_ENDING} is no node of ${STORY}`).toBe(false)
      // Resumed at the crossroads: the one step to ending_shadow commits before any save of this
      // page, so the stored ending can only come from the read at open (§4.2 step 4).
      await seedProgressOnce(page, {
        [STORY]: {
          activeRun: { path: ['start', 'crossroads'], locale: code },
          endingsFound: ['ending_light', STALE_ENDING],
        },
      })
      await recordAnnouncements(page)
      await openPlayer(page, playerPath(code, STORY))
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'crossroads')
      await walk(page, STORY, ['c2'])
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'ending_shadow')
      await expect(page.locator(`${CARD} [data-ending-count]`)).toHaveText(count(2))
      await expect(page.locator('#live-region')).toHaveText(count(2))
      expect(
        await announcements(page),
        'the step to the ending announces the stored and the new ending (a resume announces nothing)',
      ).toEqual([count(2)])
      expect(await cardOf(page), 'the card at ending_shadow').toMatchObject(
        expectedCard(code, code, 'ending_shadow', 2),
      )
      await expect
        .poll(
          async () => [...((await storedStory(page, STORY))?.endingsFound ?? [])].sort(),
          'the stored endings',
        )
        .toEqual(['ending_light', STALE_ENDING, 'ending_shadow'].sort())
    })
  }

  test('T-c7 an ending another tab saves while the card is shown: the count follows, with no new announcement', async ({
    page,
    context,
    errors,
  }) => {
    const count = (found: number) => formatted('en', 'player.endingCount', { found, total: 2 })
    await recordAnnouncements(page)
    await reachEnding(page, 'en')
    await expect(page.locator(`${CARD} [data-ending-count]`)).toHaveText(count(1))
    await expect
      .poll(() => storedStory(page, STORY), 'the stored story at ending_light')
      .toMatchObject({ activeRun: null, endingsFound: ['ending_light'] })

    // Another tab of the same browser saves the record its reader left at ending_shadow (the
    // storage event this tab hears). The other tab writes the record itself: a second player
    // page in the same Windows WebKit stalls under Playwright (10c fixer run R0), and what is under
    // test is only this tab's progress.subscribe.
    const other = await context.newPage()
    errors.watch(other)
    await seedProgressOnce(other, {
      [STORY]: { activeRun: null, endingsFound: ['ending_light', 'ending_shadow'] },
    })
    await other.close()
    // WebKit may run no animation frame in this page after another page was in front (second
    // review R2-CI-TC7-1), and the checks below wait for frames.
    await page.bringToFront()

    // This tab hears the change (progress.subscribe) and its card counts both endings.
    await expect(page.locator(`${CARD} [data-ending-count]`), "this tab's card").toHaveText(
      count(2),
    )
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'ending_light')
    // announce() empties the region at once and writes the text on the next frame (R2-SE-1,
    // R2-CI-TC7-1). Nothing emptied the region after the count (this needs no frame), and two frames
    // and 200 ms later nothing was announced.
    expect(
      (await pageValue<string[]>(page, '__e2eLiveRegion')).at(-1),
      'nothing emptied the live region after the count',
    ).toBe(count(1))
    await frames(page)
    await page.waitForTimeout(200)
    expect(
      await announcements(page),
      "no announcement for another tab's ending (D11-P9: one message per step)",
    ).toEqual([formatted('en', 'player.page', { n: 2 }), count(1)])
  })

  for (const hiRun of [false, true]) {
    test(`T-c3 /en${hiRun ? ' with a Hindi run' : ''}: All stories goes to /en`, async ({
      page,
    }) => {
      await reachEnding(page, 'en', { hiRun })
      const card = await cardOf(page)
      expect(card.lesson?.lang, 'the content locale').toBe(hiRun ? 'hi' : 'en')
      expect(card.allStoriesHref, 'All stories goes to the route locale').toBe('/en')
      await page.evaluate(() => {
        ;(window as unknown as Record<string, unknown>)['__e2eSameDocument'] = true
      })
      await page.locator(ALL_STORIES).click()
      await page.waitForURL((url) => url.pathname === '/en')
      await expect(page.locator(PLAYER), 'the player after All stories').toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.lang)).toBe('en')
      expect(await pageValue(page, '__e2eSameDocument'), 'a client navigation (next/link)').toBe(
        true,
      )
    })
  }

  test('T-c4 the settle covers the card: Share and All stories tapped within it do nothing; Share works after it', async ({
    page,
  }) => {
    const setup: ShareSetup = { share: 'resolve', clipboard: 'reject' }
    await stubShare(page, setup)
    const url = playerPath('en', STORY)
    await openPlayer(page, url)
    await expectShareSetup(page, setup)
    await settleFonts(page)
    await walk(page, STORY, ['c1'])
    await expect(page.locator('ul[data-choices]')).not.toHaveAttribute('inert')
    const seq = Number(await page.locator(PART).getAttribute('data-seq'))

    // In the page: when the ending's part commits, measure the centres of Share and All stories;
    // if either lies outside the viewport (the phones: the commit scrolls the header to the top),
    // scroll the card's actions into view by evaluate and measure both again (F4). The read starts
    // before the tap, so the centres arrive as soon as the part commits.
    await watchControlTaps(page, seq + 1)
    await armCentres(page, seq + 1, [SHARE, ALL_STORIES], ACTIONS)
    const measuring = measuredCentres(page)
    measuring.catch(() => undefined)
    await page.locator(choice('c1')).click()
    const measured = await measuring
    const [shareAt, allStoriesAt] = measured.points
    if (shareAt === undefined || allStoriesAt === undefined) throw new Error('no centres measured')
    expect(measured.inside, 'both centres inside the viewport (F4)').toBe(true)
    await page.mouse.click(shareAt.x, shareAt.y)
    await page.mouse.click(allStoriesAt.x, allStoriesAt.y)
    const settled = await page.evaluate(
      ([wait, after]) =>
        new Promise<{ inertAt: boolean | null }>((resolve) => {
          const record = (window as unknown as Record<string, unknown>)['__e2eControlTaps'] as {
            commitAt: number | null
          }
          const at = (record.commitAt ?? performance.now()) + wait
          setTimeout(
            () =>
              resolve({
                inertAt: document.querySelector(after)?.hasAttribute('inert') ?? null,
              }),
            Math.max(0, at - performance.now()),
          )
        }),
      [AFTER_SETTLE_MS, ACTIONS] as const,
    )
    const within = await pageValue<ControlTaps>(page, '__e2eControlTaps')
    // The first tap is the last choice (crossroads c1); the two after it must fall within the settle.
    const lateness = within.downs
      .slice(1)
      .map((down) => (within.commitAt === null ? null : Math.round(down.t - within.commitAt)))
    const notes = [
      measured.scrolled ? 'scrolled' : 'in view',
      `taps ${lateness.map((ms) => (ms === null ? 'never' : `${ms} ms`)).join(', ')} after the commit`,
      `actions inert at the taps: ${within.downs
        .slice(1)
        .map((down) => down.inert)
        .join(', ')}; at +${AFTER_SETTLE_MS} ms: ${settled.inertAt}`,
    ]
    test.info().annotations.push({ type: 'T-c4', description: notes.join('; ') })
    console.log(`[player] T-c4 (${test.info().project.name}): ${notes.join('; ')}`)

    // F4: a late tap fails here as "timing", before anything about the settle is checked.
    expect(within.commitAt, 'the ending commit time').not.toBeNull()
    expect(lateness, 'the two taps after the last choice').toHaveLength(2)
    for (const [index, ms] of lateness.entries()) {
      expect(
        (ms ?? Number.POSITIVE_INFINITY) < LATE_TAP_MS,
        `timing: tap ${index + 1} came ${ms} ms after the commit (450 ms or more proves nothing)`,
      ).toBe(true)
    }
    expect(
      within.downs.map((down) => [down.node, down.control]),
      'the taps: the last choice, then on Share and All stories within the settle',
    ).toEqual([
      ['crossroads', 'c1'],
      ['ending_light', 'share'],
      ['ending_light', 'all-stories'],
    ])
    expect(await shareCalls(page), 'taps within the settle').toMatchObject({
      share: [],
      canShare: 0,
      writeText: [],
    })
    expect(new URL(page.url()).pathname, 'the URL after the taps within the settle').toBe(url)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'ending_light')
    await expect(page.locator(PLAYER)).toHaveCount(1)

    // After the settle the same Share point shares (the card's actions are interactive again).
    await waitCardSettled(page)
    await page.mouse.click(shareAt.x, shareAt.y)
    await expect
      .poll(async () => (await shareCalls(page)).share, 'the Share tap after the settle')
      .toEqual([
        {
          title: fixtureGraph(STORY).text['en']?.title,
          url: shareUrl(page, 'en'),
          onNavigator: true,
        },
      ])
    const after = await pageValue<ControlTaps>(page, '__e2eControlTaps')
    expect(
      after.downs.slice(3).map((down) => [down.node, down.control, down.inert]),
      'the tap after the settle: Share, not inert',
    ).toEqual([['ending_light', 'share', false]])
  })

  test('T-c5 a double tap on Try another path restarts once: the second tap does not take the new start choice', async ({
    page,
  }) => {
    const tryAnother = '[data-part] button[data-try-another]'
    const startC1 = choice('c1', 'start')
    await openPlayer(page, playerPath('en', STORY))
    await settleFonts(page)
    await walk(page, STORY, ['c1', 'c1'])
    await waitCardSettled(page)
    // One real Try another path first: where the start's c1 sits after the commit and its header
    // scroll.
    await page.locator(tryAnother).click()
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await frames(page)
    const second = await boxOf(page, startC1)
    // Then to ending_light again: that step scrolls the header to the top, as the first did.
    await walk(page, STORY, ['c1', 'c1'])
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'ending_light')
    await waitCardSettled(page)
    await frames(page)
    const seq = Number(await page.locator(PART).getAttribute('data-seq'))
    const epoch = Number(await page.locator(RUN).getAttribute('data-epoch'))
    const point = await sharedPoint(page, await boxOf(page, tryAnother), second)

    await watchControlTaps(page, seq + 1)
    const notes: string[] = []
    if (point.usable) {
      notes.push(`double tap at ${Math.round(point.x)},${Math.round(point.y)}`)
      await page.mouse.dblclick(point.x, point.y, { delay: 100 })
    } else {
      notes.push('geometry fallback')
      const tap = await centreInViewport(page, tryAnother)
      if (tap.scrolled) notes.push('scrolled to Try another path')
      // The new start part's c1 is measured in the page as the part commits (F4), and the read
      // starts before the tap, so no round trip lies between the commit and the second tap.
      await armCentres(page, seq + 1, [startC1], startC1)
      const measuring = measuredCentres(page)
      measuring.catch(() => undefined)
      await page.mouse.click(tap.x, tap.y)
      const measured = await measuring
      const [again] = measured.points
      if (again === undefined || !measured.inside) {
        throw new Error(`${startC1} stays outside the viewport`)
      }
      if (measured.scrolled) notes.push('scrolled')
      await page.mouse.click(again.x, again.y)
    }
    await page.waitForTimeout(800)
    const taps = await pageValue<ControlTaps>(page, '__e2eControlTaps')
    const secondDown = taps.downs[1]
    const late =
      taps.commitAt === null || secondDown === undefined ? null : secondDown.t - taps.commitAt
    notes.push(`second tap ${late === null ? 'never' : `${late.toFixed(0)} ms`} after the commit`)
    test.info().annotations.push({ type: 'T-c5', description: notes.join('; ') })
    console.log(`[player] T-c5 (${test.info().project.name}): ${notes.join('; ')}`)

    expect(
      taps.downs.map((down) => [down.node, down.control]),
      "the taps: Try another path, then the new start part's c1",
    ).toEqual([
      ['ending_light', 'try-another'],
      ['start', 'c1'],
    ])
    expect(late, 'the commit and second-tap times').not.toBeNull()
    expect(
      (late ?? Number.POSITIVE_INFINITY) < LATE_TAP_MS,
      `timing: the second tap came ${late} ms after the commit (450 ms or more proves nothing)`,
    ).toBe(true)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await expect(page.locator(PART)).toHaveAttribute('data-seq', String(seq + 1))
    await expect(page.locator(RUN)).toHaveAttribute('data-epoch', String(epoch + 1))
    await expect
      .poll(() => storedStory(page, STORY), 'the stored story after the double tap')
      .toMatchObject({ activeRun: null, endingsFound: ['ending_light'] })
  })
})

test.describe('the story player, Step 10c: Share', { tag: '@review' }, () => {
  // P1-4 owner screens (T9): "Link copied." stays next to Share, in Share's own element and before
  // All stories; with the fonts loaded it sits on Share's line, after it, one line high. Under the
  // wide Devanagari fallback (the font files aborted) the line may wrap, as it did before the
  // change (design §3.8.6, RP6), so only the structure is checked there.
  for (const variant of ROW_VARIANTS) {
    test(`T-c2 no share sheet: the clipboard copies the URL; "Link copied." is shown and announced${variantName(variant)}`, async ({
      page,
      context,
      browserName,
      errors,
    }) => {
      skipVariant(variant)
      const { code } = variant
      const lang = uiLang(code)
      // Chromium: the real clipboard with permissions granted; WebKit: a resolving writeText stub
      // (the real WebKit clipboard and share sheets are device checks at P1-11, H-24).
      const setup: ShareSetup = {
        share: 'undefined',
        clipboard: browserName === 'chromium' ? 'real' : 'resolve',
      }
      if (setup.clipboard === 'real') {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      }
      const aborted = await prepareVariant(page, variant, errors)
      await stubShare(page, setup)
      await recordAnnouncements(page)
      await reachEnding(page, code)
      await expectShareSetup(page, setup)
      const url = shareUrl(page, code)
      await page.locator(SHARE).click()
      await expect(page.locator(SHARE_STATUS)).toHaveText(message(lang, 'player.linkCopied'))
      await expect(page.locator(SHARE_STATUS)).toBeVisible()
      await expect(page.locator(SHARE_URL), 'no field after a copy').toHaveCount(0)
      await expect(page.locator('#live-region')).toHaveText(message(lang, 'player.linkCopied'))
      expect(await announcements(page), 'announced').toEqual([
        formatted(lang, 'player.page', { n: 2 }),
        formatted(lang, 'player.endingCount', { found: 1, total: 2 }),
        message(lang, 'player.linkCopied'),
      ])
      const calls = await shareCalls(page)
      expect(calls.share, 'share').toEqual([])
      if (setup.clipboard === 'real') {
        expect(calls.writeText, 'no stub').toEqual([])
        expect(
          await page.evaluate(() => navigator.clipboard.readText()),
          'the clipboard holds the URL',
        ).toBe(url)
      } else {
        expect(calls.writeText, 'writeText').toEqual([url])
      }

      if (variant.wide) await expectWideFallback(page, aborted())
      else await settleFonts(page)
      const status = await page.locator(CARD).evaluate((section) => {
        const get = (selector: string): Element => {
          const found = section.querySelector(selector)
          if (found === null) throw new Error(`no ${selector}`)
          return found
        }
        const share = get('button[data-share]')
        const shown = get('[data-share-status]')
        const all = get('a[data-all-stories]')
        const box = shown.getBoundingClientRect()
        const button = share.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(shown)
        const lines = [...range.getClientRects()].filter((rect) => rect.width > 0)
        const [first] = lines
        return {
          sameParent: shown.parentElement !== null && shown.parentElement === share.parentElement,
          beforeAllStories:
            (shown.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          afterShare: box.left >= button.right,
          besideShare: box.top < button.bottom && box.bottom > button.top,
          oneLine:
            first !== undefined &&
            lines.every((rect) => rect.top < first.bottom && rect.bottom > first.top),
          status: [box.left, box.top, box.right, box.bottom],
          share: [button.left, button.top, button.right, button.bottom],
        }
      })
      console.log(
        `[player-share] T9 /${code} ${variant.scale}%${variant.wide ? ' wide' : ''} ` +
          `(${test.info().project.name}): ${JSON.stringify(status)}`,
      )
      expect(status.sameParent, '"Link copied." in the element that holds Share').toBe(true)
      expect(status.beforeAllStories, '"Link copied." before All stories').toBe(true)
      if (!variant.wide) {
        expect(status.afterShare, '"Link copied." after Share on the line').toBe(true)
        expect(status.besideShare, '"Link copied." on Share\'s line').toBe(true)
        expect(status.oneLine, '"Link copied." one line high').toBe(true)
      }
    })
  }

  test('T-c2 the clipboard refuses: a read-only field labelled "Copy this link:" holds the URL, focused and selected', async ({
    page,
  }) => {
    const setup: ShareSetup = { share: 'undefined', clipboard: 'reject' }
    await stubShare(page, setup)
    await recordAnnouncements(page)
    await reachEnding(page, 'en')
    await expectShareSetup(page, setup)
    const url = shareUrl(page, 'en')
    await page.locator(SHARE).click()
    const field = page.locator(SHARE_URL)
    await expect(field).toBeVisible()
    await expect(field).toBeFocused()
    expect(
      await field.evaluate((input: HTMLInputElement) => ({
        value: input.value,
        readOnly: input.readOnly,
        type: input.type,
        selected: [input.selectionStart, input.selectionEnd],
        label: [...(input.labels ?? [])].map((label) => (label.textContent ?? '').trim()),
      })),
      'the field',
    ).toEqual({
      value: url,
      readOnly: true,
      type: 'text',
      selected: [0, url.length],
      label: [message('en', 'player.copyLink')],
    })
    await expect(page.locator(SHARE_STATUS), 'no "Link copied."').toHaveCount(0)
    expect(await shareCalls(page)).toMatchObject({ share: [], writeText: [url] })
    expect(await announcements(page), 'nothing announced for the field').toEqual([
      formatted('en', 'player.page', { n: 2 }),
      formatted('en', 'player.endingCount', { found: 1, total: 2 }),
    ])
  })

  // P1-4 owner screens (T8; design p1-4-polish-design.md R2): the label and the field go on their
  // own full-width line under the action row, still inside the settling wrapper; the row keeps Try
  // another path, Share and All stories (one row on the tablets). The field moved in the DOM, so
  // the visual, DOM and Tab orders agree (WCAG 1.3.2, 2.4.3): Tab from the field goes to Back, and
  // Shift+Tab to All stories where Tab reaches links, else to Share. Playwright's WebKit on Windows
  // leaves links out of the Tab order; on the Linux CI image Shift+Tab from the field did not land
  // on Share (CI run 44463931008), so tabReachesLinks asks the browser and the message names where
  // focus landed. Under the wide Devanagari fallback (the font files aborted) the layout must hold
  // too; the keyboard order does not depend on the font, so it runs with the fonts loaded only.
  for (const variant of ROW_VARIANTS) {
    test(`T-c2 the clipboard refuses: the field is on its own full-width line under the actions${variantName(variant)}`, async ({
      page,
      browserName,
      errors,
    }) => {
      skipVariant(variant)
      const { code } = variant
      const project = test.info().project.name
      const setup: ShareSetup = { share: 'undefined', clipboard: 'reject' }
      const aborted = await prepareVariant(page, variant, errors)
      await stubShare(page, setup)
      await reachEnding(page, code)
      await expectShareSetup(page, setup)
      const url = shareUrl(page, code)
      await page.locator(SHARE).click()
      // Anywhere in the card: (a) checks that it is inside the wrapper.
      const field = page.locator(`${CARD} input[data-share-url]`)
      await expect(field, 'precondition: the field').toBeVisible()
      await expect(field, 'precondition: the field has focus').toBeFocused()
      expect(
        await field.evaluate((input: HTMLInputElement) => [
          input.value,
          input.selectionStart,
          input.selectionEnd,
        ]),
        'precondition: the field holds the URL, selected',
      ).toEqual([url, 0, url.length])
      await expect(page.locator(TRY_ANOTHER), 'precondition: Try another path').toBeVisible()
      await expect(page.locator(SHARE), 'precondition: Share').toBeVisible()
      await expect(page.locator(ALL_STORIES), 'precondition: All stories').toBeVisible()
      if (variant.wide) await expectWideFallback(page, aborted())
      else await settleFonts(page)

      const row = await page.locator(CARD).evaluate((section) => {
        const get = (selector: string): Element => {
          const found = section.querySelector(selector)
          if (found === null) throw new Error(`no ${selector}`)
          return found
        }
        const wrapper = get('[data-ending-actions]')
        const actions = [
          'button[data-try-another]',
          'button[data-share]',
          'a[data-all-stories]',
        ].map(get)
        const [tryAnother, share, all] = actions
        const input = get('input[data-share-url]')
        const label = input.closest('label')
        if (!tryAnother || !share || !all || label === null) throw new Error('no row or no label')
        const actionRow = tryAnother.parentElement
        const follows = (a: Node, b: Node): boolean =>
          (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        const style = getComputedStyle(section)
        return {
          inWrapper: wrapper.contains(input) && wrapper.contains(label),
          inActionRow:
            actionRow !== null && (actionRow.contains(input) || actionRow.contains(label)),
          order: follows(tryAnother, share) && follows(share, all) && follows(all, input),
          tops: actions.map((action) => action.getBoundingClientRect().top),
          rowBottom: Math.max(...actions.map((action) => action.getBoundingClientRect().bottom)),
          labelTop: label.getBoundingClientRect().top,
          inputWidth: input.getBoundingClientRect().width,
          content:
            section.getBoundingClientRect().width -
            parseFloat(style.getPropertyValue('padding-inline-start')) -
            parseFloat(style.getPropertyValue('padding-inline-end')),
        }
      })
      console.log(
        `[player-share] T8 /${code} ${variant.scale}%${variant.wide ? ' wide' : ''} ` +
          `(${project}): ${JSON.stringify(row)}`,
      )
      // Soft (review A4): a fault that breaks one group still runs and reports every other group,
      // so each group's own catch shows (the test still fails on any of them).
      // (a) In the settling wrapper, outside the action row; (b) after the three actions.
      expect.soft(row.inWrapper, '(a) the label and field inside [data-ending-actions]').toBe(true)
      expect.soft(row.inActionRow, '(a) the label and field outside the action row').toBe(false)
      expect.soft(row.order, '(b) Try another path, Share, All stories, then the field').toBe(true)
      // (c) Under the row, as wide as the card's content box.
      expect
        .soft(row.labelTop, '(c) the label under the action row')
        .toBeGreaterThanOrEqual(row.rowBottom)
      expect
        .soft(
          Math.abs(row.inputWidth - row.content),
          `(c) the field as wide as the card's content (${row.inputWidth} of ${row.content})`,
        )
        .toBeLessThanOrEqual(1)
      // (d) The tablets keep the three actions on one row.
      if (ROW_TABLETS.includes(project)) {
        expect
          .soft(
            Math.max(...row.tops) - Math.min(...row.tops),
            `(d) the three actions on one row (tops ${row.tops.join(', ')})`,
          )
          .toBeLessThanOrEqual(1)
      }
      if (variant.wide) return

      // (e) Tab from the field goes on to Back; (f) Shift+Tab goes back to the row.
      await page.keyboard.press('Tab')
      expect
        .soft(
          await page.evaluate(() => document.activeElement?.matches('button[data-back]') ?? false),
          '(e) Tab from the field: Back',
        )
        .toBe(true)
      const links = await tabReachesLinks(page)
      if (browserName === 'chromium') {
        expect(links, 'precondition: Chromium tabs to links').toBe(true)
      }
      await field.focus()
      await expect(field).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      const previous = links ? 'a[data-all-stories]' : 'button[data-share]'
      const landed = await page.evaluate((selector) => {
        const active = document.activeElement
        const data =
          active === null
            ? []
            : [...active.attributes]
                .filter((attribute) => attribute.name.startsWith('data-'))
                .map((attribute) => `[${attribute.name}]`)
        return {
          ok: active?.closest('section[data-ending]') != null && active.matches(selector),
          on: active === null ? 'nothing' : `${active.tagName.toLowerCase()}${data.join('')}`,
        }
      }, previous)
      expect
        .soft(
          landed.ok,
          `(f) Shift+Tab from the field: ${previous} (Tab reaches links: ${links}; focus on ${landed.on})`,
        )
        .toBe(true)
    })
  }

  for (const hiRun of [false, true]) {
    test(`T-c2 /en${hiRun ? ' with a Hindi run' : ''}: the share sheet is called once with the title and the player URL in the content locale`, async ({
      page,
    }) => {
      const content: LocaleCode = hiRun ? 'hi' : 'en'
      const setup: ShareSetup = { share: 'resolve', clipboard: 'reject' }
      await stubShare(page, setup)
      await recordAnnouncements(page)
      await reachEnding(page, 'en', { hiRun })
      await expectShareSetup(page, setup)
      await page.locator(SHARE).click()
      await expect
        .poll(async () => (await shareCalls(page)).share, 'share')
        .toEqual([
          {
            title: fixtureGraph(STORY).text[content]?.title,
            url: shareUrl(page, content),
            onNavigator: true,
          },
        ])
      await frames(page)
      await page.waitForTimeout(200)
      const calls = await shareCalls(page)
      expect(calls.canShare, 'canShare asked first').toBeGreaterThanOrEqual(1)
      expect(calls.writeText, 'no clipboard after a share').toEqual([])
      await expect(page.locator(SHARE_STATUS), 'no status after a share').toHaveCount(0)
      await expect(page.locator(SHARE_URL), 'no field after a share').toHaveCount(0)
      expect((await announcements(page)).slice(-1), 'nothing announced after a share').toEqual([
        formatted('en', 'player.endingCount', { found: 1, total: 2 }),
      ])
    })
  }

  test('T-c2 the share sheet is closed (AbortError): nothing shown, the clipboard never tried', async ({
    page,
  }) => {
    const setup: ShareSetup = { share: 'abort', clipboard: 'reject' }
    await stubShare(page, setup)
    await reachEnding(page, 'en')
    await expectShareSetup(page, setup)
    await page.locator(SHARE).click()
    await expect.poll(async () => (await shareCalls(page)).share.length, 'share').toBe(1)
    await frames(page)
    await page.waitForTimeout(200)
    expect((await shareCalls(page)).writeText, 'the clipboard after an AbortError').toEqual([])
    await expect(page.locator(SHARE_STATUS), 'no status after an AbortError').toHaveCount(0)
    await expect(page.locator(SHARE_URL), 'no field after an AbortError').toHaveCount(0)
  })

  test('T-c2 a second tap while the share sheet is open is ignored: one share call', async ({
    page,
  }) => {
    const setup: ShareSetup = { share: 'never', clipboard: 'reject' }
    await stubShare(page, setup)
    await reachEnding(page, 'en')
    await expectShareSetup(page, setup)
    await page.locator(SHARE).click()
    await expect.poll(async () => (await shareCalls(page)).share.length, 'share').toBe(1)
    await page.locator(SHARE).click()
    await expect.poll(async () => (await shareCalls(page)).shareClicks, 'Share taps').toBe(2)
    await frames(page)
    await page.waitForTimeout(200)
    const calls = await shareCalls(page)
    expect(calls.share, 'share calls after two taps').toHaveLength(1)
    expect(calls.writeText, 'the clipboard while pending').toEqual([])
    await expect(page.locator(SHARE_STATUS)).toHaveCount(0)
    await expect(page.locator(SHARE_URL)).toHaveCount(0)
  })

  for (const late of ['copy', 'share'] as const) {
    test(`T-c8 ${late === 'copy' ? 'a copy' : 'a share sheet'} still pending when Try another path restarts: nothing is shown or announced when it ends${late === 'share' ? ', and the clipboard is never tried' : ''}`, async ({
      page,
    }) => {
      const setup: ShareSetup =
        late === 'copy'
          ? { share: 'undefined', clipboard: 'deferred' }
          : { share: 'deferred', clipboard: 'resolve' }
      const pageN = (n: number) => formatted('en', 'player.page', { n })
      await stubShare(page, setup)
      await recordAnnouncements(page)
      await reachEnding(page, 'en')
      await expectShareSetup(page, setup)
      const url = shareUrl(page, 'en')
      await page.locator(SHARE).click()
      await expect
        .poll(async () => {
          const calls = await shareCalls(page)
          return late === 'copy' ? calls.writeText : calls.share.map((call) => call.url)
        }, 'the copy or share sheet, pending')
        .toEqual([url])
      await page.locator(TRY_ANOTHER).click()
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
      await expect(page.locator('#live-region')).toHaveText(pageN(1))

      // The copy resolves, or the share sheet fails, after the card has gone.
      await settleLater(page)
      await frames(page)
      await page.waitForTimeout(200)
      await expect(page.locator('#live-region'), 'the live region after the late end').toHaveText(
        pageN(1),
      )
      expect(await announcements(page), 'nothing announced after "Page 1"').toEqual([
        pageN(2),
        formatted('en', 'player.endingCount', { found: 1, total: 2 }),
        pageN(1),
      ])
      await expect(
        page.locator('[data-share-status], input[data-share-url]'),
        'no share feedback on the page',
      ).toHaveCount(0)
      expect((await shareCalls(page)).writeText, 'the clipboard').toEqual(
        late === 'copy' ? [url] : [],
      )
    })
  }
})

test.describe(
  'the story player, Step 10d: a switch at an ending resets Share',
  { tag: '@review' },
  () => {
    // The 10c hand-off: SET_LOCALE keeps the part, and so the card, mounted, while Share's URL
    // follows the content locale. Share is keyed by the content locale, so a switch takes away what
    // it left ("Link copied." or the field with the old language's URL), the next tap shares the new
    // language's URL, and a copy still pending from before the switch ends unseen.
    const SWITCH = 'button[data-story-language]'

    for (const left of ['copied', 'manual'] as const) {
      test(`10d hand-off: ${left === 'copied' ? '"Link copied."' : 'the manual field'} goes on a switch; the card stays and Share then gives the new language's URL`, async ({
        page,
      }) => {
        const setup: ShareSetup = {
          share: 'undefined',
          clipboard: left === 'copied' ? 'resolve' : 'reject',
        }
        await stubShare(page, setup)
        await recordAnnouncements(page)
        await reachEnding(page, 'en')
        await expectShareSetup(page, setup)
        const [enUrl, hiUrl] = [shareUrl(page, 'en'), shareUrl(page, 'hi')]
        await page.locator(SHARE).click()
        if (left === 'copied') {
          await expect(page.locator(SHARE_STATUS)).toHaveText(message('en', 'player.linkCopied'))
        } else {
          await expect(page.locator(SHARE_URL)).toHaveValue(enUrl)
        }
        const card = await page.locator(CARD).elementHandle()
        if (card === null) throw new Error('no card')
        const epoch = Number(await page.locator(RUN).getAttribute('data-epoch'))

        await page.locator(SWITCH).click()
        await expect(page.locator('[data-part] [data-story]')).toHaveAttribute('lang', 'hi')
        await expect(page.locator(`${CARD} [data-lesson]`)).toHaveAttribute('lang', 'hi')
        await expect(
          page.locator('[data-share-status], input[data-share-url]'),
          'no share feedback left from the English URL',
        ).toHaveCount(0)
        expect(await card.evaluate((element) => element.isConnected), 'the card stays').toBe(true)
        await expect(page.locator(PART)).toHaveAttribute('data-node', 'ending_light')
        if (left === 'manual') {
          // P1-4 owner screens (T8c): the action row is rendered inside the keyed share control,
          // so the switch remounts Try another path and All stories with it. They come back in
          // their order, the field gone, and nothing in the wrapper is inert.
          expect(
            await page.locator(ACTIONS).evaluate((wrapper) => {
              const controls = [...wrapper.querySelectorAll('button, a, input')]
              return {
                order: controls.map((control) =>
                  control.matches('button[data-try-another]')
                    ? 'try-another'
                    : control.matches('button[data-share]')
                      ? 'share'
                      : control.matches('a[data-all-stories]')
                        ? 'all-stories'
                        : control.localName,
                ),
                inert: [wrapper, ...controls].map((element) => element.closest('[inert]') !== null),
              }
            }),
            'the actions after the switch',
          ).toEqual({
            order: ['try-another', 'share', 'all-stories'],
            inert: [false, false, false, false],
          })
        }

        await page.locator(SHARE).click()
        if (left === 'copied') {
          await expect(page.locator(SHARE_STATUS)).toHaveText(message('en', 'player.linkCopied'))
        } else {
          await expect(page.locator(SHARE_URL)).toHaveValue(hiUrl)
          await expect(page.locator(SHARE_URL)).toBeFocused()
        }
        expect((await shareCalls(page)).writeText, 'the copies: English, then Hindi').toEqual([
          enUrl,
          hiUrl,
        ])
        if (left === 'manual') {
          // T8c: the remounted Try another path still restarts.
          await page.locator(TRY_ANOTHER).click()
          await expect(page.locator(PART), 'Try another path after the switch').toHaveAttribute(
            'data-node',
            'start',
          )
          await expect(page.locator(RUN)).toHaveAttribute('data-epoch', String(epoch + 1))
        }
      })
    }

    // A copy, or a share sheet (review TL-1), still pending across the switch: its old control left
    // the page, so it ends unseen, and a share sheet that fails then never reaches the clipboard.
    for (const late of ['copy', 'share'] as const) {
      test(`10d hand-off: ${late === 'copy' ? 'a copy' : 'a share sheet'} still pending when the story language switches shows and announces nothing when it ends${late === 'share' ? ', and the clipboard is never tried' : ''}`, async ({
        page,
      }) => {
        const setup: ShareSetup =
          late === 'copy'
            ? { share: 'undefined', clipboard: 'deferred' }
            : { share: 'deferred', clipboard: 'resolve' }
        await stubShare(page, setup)
        await recordAnnouncements(page)
        await reachEnding(page, 'en')
        await expectShareSetup(page, setup)
        const url = shareUrl(page, 'en')
        await page.locator(SHARE).click()
        await expect
          .poll(async () => {
            const calls = await shareCalls(page)
            return late === 'copy' ? calls.writeText : calls.share.map((call) => call.url)
          }, 'the copy or share sheet, pending')
          .toEqual([url])
        await page.locator(SWITCH).click()
        await expect(page.locator('[data-part] [data-story]')).toHaveAttribute('lang', 'hi')

        // The copy resolves, or the share sheet fails, after the switch.
        await settleLater(page)
        await frames(page)
        await page.waitForTimeout(200)
        await expect(
          page.locator('[data-share-status], input[data-share-url]'),
          `no share feedback after the late ${late}`,
        ).toHaveCount(0)
        expect(await announcements(page), 'nothing announced after the ending count').toEqual([
          formatted('en', 'player.page', { n: 2 }),
          formatted('en', 'player.endingCount', { found: 1, total: 2 }),
        ])
        expect((await shareCalls(page)).writeText, 'the clipboard').toEqual(
          late === 'copy' ? [url] : [],
        )
      })
    }
  },
)

// P1-3 Step 12a (design p1-step12-design.md §13.4.3 E12-P1, CRIT-3, 4.12): All stories at the
// bottom of a long ending holds. The second tap of a double tap would land on Home, whose first
// screen now holds full-card links and the Continue card; the hold refuses it there. V1 (/en,
// fonts as shipped), V3 (/hi 150%, the wide fallback, the font files aborted) and V4 (V3 at 320 px);
// V3 and V4 run on the phones, where the ending page scrolls (hard). Each attempt is a fresh page
// (13.9): a second tap 450 ms or more after the hold began retries, up to 3 times.
test.describe('the story player, Step 12: All stories holds', { tag: '@review' }, () => {
  for (const variant of [STEP12_VARIANTS.V1, STEP12_VARIANTS.V3, STEP12_VARIANTS.V4]) {
    test(`E12-P1 ${variantTitle(variant)}: All stories at the bottom of an ending holds, so a tap on Home within it does nothing`, async ({
      page,
      errors,
    }) => {
      const skip = variantSkip(variant, test.info().project.name)
      test.skip(skip !== null, skip ?? '')
      const { code } = variant
      await withHoldRetry(test.info(), async (n) => {
        const p = await attemptPage(page, errors, n)
        const aborted = await prepareStep12Variant(p, variant, errors)
        await watchNavHold(p)
        await reachEnding(p, code)
        await expectStep12Variant(p, variant, aborted)
        await expectHoldWatch(p)
        const bottom = await scrollToBottom(p)
        console.log(
          `[player-share] E12-P1 ${variantTitle(variant)} (${test.info().project.name}): page ${bottom.ratio.toFixed(2)} viewports, scrollY ${bottom.scrollY}`,
        )
        if (variant.name !== 'V1') {
          expect(
            bottom.scrollHeight,
            `precondition: the ending page scrolls (${bottom.ratio.toFixed(2)} viewports)`,
          ).toBeGreaterThan(bottom.innerHeight)
        }
        const tap = await heldTapIntoHome(p, code, ALL_STORIES)
        if (tap.gap === null || tap.gap < LATE_TAP_MS) await tap.verify()
        return tap
      })
    })
  }
})
