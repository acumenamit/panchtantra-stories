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
import type { Page } from '@playwright/test'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../src/core/locales'
import { expect, test as base } from './fixtures'
import {
  announcements,
  boxOf,
  centreInViewport,
  choice,
  consoleErrors,
  endingsOf,
  FIRST_PARAGRAPH,
  fixtureGraph,
  frames,
  LATE_TAP_MS,
  openPlayer,
  pageValue,
  PART,
  PLAYER,
  recordAnnouncements,
  RUN,
  seedProgressOnce,
  settleFonts,
  sharedPoint,
  storedStory,
  walk,
  watchDialogOpen,
  type ConsoleErrors,
} from './page-helpers'
import { formatted, message, playerFixture, playerPath, uiLang } from './routes'

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

/** How a share test sets the browser's share and clipboard (C5). */
interface ShareSetup {
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

interface ShareCalls {
  readonly share: readonly { title: unknown; url: unknown; onNavigator: boolean }[]
  readonly canShare: number
  readonly writeText: readonly string[]
  /** Clicks whose target lies in a Share button. */
  readonly shareClicks: number
}

/** Before any page script: the share and clipboard of `setup`, recording every call. */
async function stubShare(page: Page, setup: ShareSetup): Promise<void> {
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

async function shareCalls(page: Page): Promise<ShareCalls> {
  return pageValue<ShareCalls>(page, '__e2eShare')
}

/** Settles the deferred share (rejects with a NotAllowedError) or copy (resolves). */
async function settleLater(page: Page): Promise<void> {
  await page.evaluate(() => {
    const settle = (window as unknown as Record<string, unknown>)['__e2eSettleLater']
    if (typeof settle !== 'function') throw new Error('nothing deferred to settle')
    ;(settle as () => void)()
  })
}

/** C5: the page sees the share and canShare the setup asked for, whatever the browser exposes. */
async function expectShareSetup(page: Page, setup: ShareSetup): Promise<void> {
  const kind = setup.share === 'undefined' ? 'undefined' : 'function'
  expect(
    await page.evaluate(() => [typeof navigator.share, typeof navigator.canShare]),
    'navigator.share and canShare as stubbed (C5)',
  ).toEqual([kind, kind])
}

/** The shared URL: the player URL in the content locale on this origin (D11-P14). */
function shareUrl(page: Page, contentLocale: LocaleCode): string {
  return `${new URL(page.url()).origin}${playerPath(contentLocale, STORY)}`
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
  test('T-c2 no share sheet: the clipboard copies the URL; "Link copied." is shown and announced', async ({
    page,
    context,
    browserName,
  }) => {
    // Chromium: the real clipboard with permissions granted; WebKit: a resolving writeText stub
    // (the real WebKit clipboard and share sheets are device checks at P1-11, H-24).
    const setup: ShareSetup = {
      share: 'undefined',
      clipboard: browserName === 'chromium' ? 'real' : 'resolve',
    }
    if (setup.clipboard === 'real') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    }
    await stubShare(page, setup)
    await recordAnnouncements(page)
    await reachEnding(page, 'en')
    await expectShareSetup(page, setup)
    const url = shareUrl(page, 'en')
    await page.locator(SHARE).click()
    await expect(page.locator(SHARE_STATUS)).toHaveText(message('en', 'player.linkCopied'))
    await expect(page.locator(SHARE_STATUS)).toBeVisible()
    await expect(page.locator(SHARE_URL), 'no field after a copy').toHaveCount(0)
    await expect(page.locator('#live-region')).toHaveText(message('en', 'player.linkCopied'))
    expect(await announcements(page), 'announced').toEqual([
      formatted('en', 'player.page', { n: 2 }),
      formatted('en', 'player.endingCount', { found: 1, total: 2 }),
      message('en', 'player.linkCopied'),
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
  })

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
