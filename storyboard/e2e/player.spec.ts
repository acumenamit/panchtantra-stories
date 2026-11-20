// The story player, Step 10a (spec §6.1 Player, §6.2-§6.4, §6.6; design p1-step10-design.md §4,
// §9.3 T-a1 to T-a22, §16 F4, F5, F7; P1-4b). Review and staging legs (@review): the fixture
// stories at /{code}/stories/{storyId}/read.
// - Every test collects console errors and page errors (consoleErrors, an auto fixture here) and
//   fails on any it did not declare. Production React reports a hydration mismatch only as a page
//   error ("Minified React error #418"), so page errors count. A test that causes errors on purpose
//   declares anchored patterns per engine, and each must match at least once (C4, F5); the
//   collector's own self-test is the last describe.
// - Coordinate clicks (F4): the point is checked to lie inside the viewport first, and the target
//   is scrolled into view by evaluate when it does not. Commit and tap times are read in the page;
//   a second tap 450 ms or more after the commit fails as "timing", never as a pass or a settle bug.
// - Scroll (F7, C27): after a step the page's scrollY is the header's offset from the page top,
//   clamped to what the page can scroll (the staging banner sits above the header).
// - Opening frames: an init-script sampler records, every animation frame, whether the opening
//   player's passage is painted (computed visibility not hidden); T-a9, T-a10 and T-a14 read it.
// - JavaScript chunks are held by page.route where a test needs an unhydrated page; CSS never is.
// Step 10b (design §4.1, §4.3, D11-P10 to P12, P19, P20, C13, F6; §9.3 T-b1 to T-b8): Back in the
// run footer, the menu (text size, Start again), the restart dialog, the progress segments and the
// text-size sync. T-b2 measures its click point and reads its commit and tap times in the page, as
// T-a4 does (C7, F4). T-b10 (second review R2-STRESS-1) times the restart dialog's hold from its
// close event in the page.
// Step 10c (design D11-P9): at an ending the live region says "Ending x of y found" instead of
// "Page n", so T-a3 and T-a15 expect the count at their last step (stepAnnouncement). The ending
// card, Share and Try another path are in player-share.spec.ts.
// Step 10d (design D11-P4, §4.3, §6 F3, §9.3 T-d1 to T-d5, R20): the story-language switch in the
// header nav. A switch changes the story's language only: the same part stays mounted (no reveal,
// no focus move, no announcement), the page, its chrome, <title> and URL stay on the route locale,
// and the run is saved in the new language (reload resumes in it). T-d5 times its window from the
// switch's commit, read in the page (a MutationObserver), never from the click.
// Step 10d CI fix (CI run 44037149156): T-a20 logs each layout shift's sources; T-d6 holds the font
// files under a test-only wide Devanagari fallback and checks the header keeps its rows.
// Step 10e (design §2.5, T-a21, F2): T-a21 loops playerNotFoundPaths(leg), which adds the staging-only
// picture story's read URL on the review leg (on the staging leg it is a real page).
// P1-4 owner screens (design p1-4-polish-design.md §5): T2 and T2c (the run area is a framed panel,
// the last describe but one), T2b (in T-a22: the fallback's main keeps its 48 px) and T11 (next to
// T-b8: the restart dialog dims the page behind it, read from screenshot pixels too).
// P1-3 Step 12a (design p1-step12-design.md §13.4.3, §13.4.5 E12-R2, §13.5 item 16, CRIT-3,
// H-12c): trackRequests moved to page-helpers.ts as quietRequests (W5), unchanged. T-a21 loops
// playerNotFoundPaths(leg): the story URL without /read is the landing now and leaves; three
// landing-shaped 404s and the staging-only featured story's read URL join (review 11, staging 8).
// The last describe: the header's Exit and the error fallback's All stories render through
// HeldLink, so a tap on Home within 500 ms of them is refused (E12-P2, E12-P3); H-12c, Continue on
// the landing and Home's Continue card open a resumed player that never paints the start node
// (E12-P4, E12-P5, T-a14's method); since round 1b (design §16 F1) both Continue links set the
// saved-run hint in the tap, so g3's mutant is MU12-211 (the hint removed), not M-a14b. Round 2b
// (§19): the landing's Start sets it in every state, so a run another tab saved after the landing's
// read also opens without painting the start node (E12-P6; g3's mutant MU12-211s).
import type { ElementHandle, Page } from '@playwright/test'
import { ENABLED_LOCALE_CODES, getLocaleDef, type LocaleCode } from '../src/core/locales'
import { PROGRESS_KEY, type TextScale } from '../src/core/progress/records'
import { TEXT_SCALE_ATTRIBUTE } from '../src/core/progress/text-scale-boot'
import { SETTLE_MS } from '../src/reader/player/view'
import { expect, test as base } from './fixtures'
import { launchLeg } from './launch-leg'
import {
  announcements,
  boxOf,
  centreInViewport,
  choice,
  consoleErrors,
  DIALOG,
  endingsOf,
  FIRST_PARAGRAPH,
  fixtureGraph,
  focusByKeyboard,
  frames,
  LATE_TAP_MS,
  openPlayer,
  pageValue,
  PART,
  pathTo,
  PLAYER,
  prefsText,
  progressRecordBytes,
  progressSpy,
  quietRequests,
  recordAnnouncements,
  RUN,
  attemptPage,
  expectHoldWatch,
  heldTapIntoHome,
  watchNavHold,
  withHoldRetry,
  scaleSeen,
  seedPrefs,
  seedProgressOnce,
  settleFonts,
  sharedPoint,
  storageAfter,
  storedStory,
  waitOpen,
  walk,
  watchDialogOpen,
  watchScaleAttribute,
  WIDE_FALLBACK_SCALE,
  wideDevanagariFallback,
  type ConsoleErrors,
  type FixtureGraph,
  type Point,
} from './page-helpers'
import {
  blockStorage,
  formatted,
  layoutShift,
  liveRegions,
  message,
  NOT_FOUND_TITLE,
  playerNotFoundPaths,
  playerPath,
  playerPaths,
  recordLayoutShifts,
  uiLang,
} from './routes'
import { expectSecurityHeaders } from './security-headers'

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

const CHOICES = 'ul[data-choices]'
/** The 404 document's one console line, on both engines (probe P-CON, design §16). */
const NOT_FOUND_LINE =
  /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/
/** An aborted script load (T-a9 failsafe): Chromium only, the line of an aborted image (design O3). */
const CHUNK_FAILED_LINE = /^Failed to load resource: net::ERR_FAILED$/
const PLANTED_MESSAGE = 'e2e planted scrollIntoView failure'
/** Next logs each error a boundary catches: WebKit the line alone, Chromium with the stack after. */
const PLANTED_LINE = new RegExp(`^Error: ${PLANTED_MESSAGE}(?:\\n|$)`)
const LORA_FILE = /\/_next\/static\/media\/lora[^/]*\.woff2$/
const NOTO_FILE = /\/_next\/static\/media\/noto[-_]sans[-_]devanagari[^/]*\.woff2$/

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Waits until the choices on screen are no longer inert (the settle after a step has ended). */
async function waitSettled(page: Page): Promise<void> {
  await expect(page.locator(CHOICES)).not.toHaveAttribute('inert')
}

/** The stored run's path of one story, or null. */
async function storedPath(page: Page, storyId: string): Promise<readonly string[] | null> {
  return (await storedStory(page, storyId))?.activeRun?.path ?? null
}

/**
 * Holds every JavaScript chunk (never the CSS) for `ms`, and also until `until` settles (at most
 * 15 s), so the page paints and stays unhydrated. Returns how many requests were held.
 */
async function holdChunks(
  page: Page,
  ms: number,
  until: Promise<void> = Promise.resolve(),
): Promise<() => number> {
  let held = 0
  await page.route(
    (url) => url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js'),
    async (route) => {
      held++
      await Promise.all([sleep(ms), Promise.race([until, sleep(15_000)])])
      await route.continue().catch(() => undefined)
    },
  )
  return () => held
}

/** Checks the part on screen against the fixture: node, content lang, title, passage, choices. */
async function expectPart(
  page: Page,
  graph: FixtureGraph,
  code: LocaleCode,
  nodeId: string,
): Promise<void> {
  const text = graph.text[code]
  const nodeText = text?.nodes[nodeId]
  const node = graph.nodes.get(nodeId)
  if (!text || !nodeText || !node) throw new Error(`${graph.storyId} has no ${code} ${nodeId}`)
  await expect(page.locator(PART)).toHaveAttribute('data-node', nodeId)
  const shown = await page.locator(PART).evaluate((part) => ({
    lang: part.querySelector('[data-story]')?.getAttribute('lang') ?? null,
    title: part.querySelector('h1')?.textContent ?? null,
    paragraphs: [...part.querySelectorAll('[data-passage] p')].map((p) => p.textContent ?? ''),
    question: part.querySelector('[data-question]')?.textContent ?? null,
    choices: [...part.querySelectorAll('button[data-choice]')].map((button) => [
      button.getAttribute('data-choice') ?? '',
      button.textContent ?? '',
    ]),
    lists: part.querySelectorAll('ul[data-choices]').length,
  }))
  const ending = node.type === 'ending'
  expect(shown, `${graph.storyId} ${code} ${nodeId}`).toEqual({
    lang: code,
    title: text.title,
    paragraphs: nodeText.text.split('\n\n'),
    question: ending ? null : (nodeText.question ?? null),
    choices: ending ? [] : node.choices.map((c) => [c.id, nodeText.choices?.[c.id] ?? '']),
    lists: ending ? 0 : 1,
  })
}

interface OpeningFrame {
  readonly t: number
  readonly phase: string
  readonly passage: boolean
  readonly painted: boolean
  readonly saved: boolean
}

/** Before any page script: the opening-frame sampler (header comment) and a DOMContentLoaded look. */
async function sampleOpeningFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    const sampled: unknown[] = []
    w['__e2eFrames'] = sampled
    document.addEventListener('DOMContentLoaded', () => {
      const run = document.querySelector('[data-run]')
      w['__e2eAtDcl'] = {
        saved: document.documentElement.hasAttribute('data-saved-run'),
        runVisibility: run ? getComputedStyle(run).visibility : 'no run area',
        phase: document.querySelector('[data-player]')?.getAttribute('data-run-phase') ?? 'none',
      }
    })
    const tick = (): void => {
      const passage = document.querySelector('[data-run-phase="opening"] [data-passage]')
      sampled.push({
        t: Math.round(performance.now()),
        phase: document.querySelector('[data-player]')?.getAttribute('data-run-phase') ?? 'none',
        passage: passage !== null,
        painted: passage !== null && getComputedStyle(passage).visibility !== 'hidden',
        saved: document.documentElement.hasAttribute('data-saved-run'),
      })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function openingFrames(page: Page) {
  const sampled = await pageValue<OpeningFrame[]>(page, '__e2eFrames')
  const opening = sampled.filter((frame) => frame.phase === 'opening' && frame.passage)
  return {
    frames: sampled.length,
    opening: opening.length,
    painted: opening.filter((frame) => frame.painted).length,
    saved: sampled.filter((frame) => frame.saved).length,
    firstOpenAt: sampled.find((frame) => frame.phase === 'open')?.t ?? null,
  }
}

/**
 * What a fresh run announces after step `index` of the first-choice path (index 0 is the first
 * choice): "Page n" (n = the path length), or at an ending "Ending 1 of y found" instead (Step 10c,
 * D11-P9; the first ending a fresh run finds).
 */
function stepAnnouncement(code: LocaleCode, graph: FixtureGraph, index: number): string {
  const reached = graph.firstPath.nodes[index + 1] ?? ''
  if (graph.nodes.get(reached)?.type === 'ending') {
    return formatted(uiLang(code), 'player.endingCount', {
      found: 1,
      total: endingsOf(graph).length,
    })
  }
  return formatted(uiLang(code), 'player.page', { n: index + 2 })
}

/**
 * D11-P9 (review A11Y-4): an open says nothing, resumed or adjusted included. Two frames after the
 * open commit the one live region is still empty and has never held a value (recordAnnouncements
 * must have run before the navigation).
 */
async function expectSilentOpen(page: Page): Promise<void> {
  await waitOpen(page)
  await frames(page)
  await page.waitForTimeout(100)
  expect(await liveRegions(page), 'the live region two frames after open').toEqual([
    { role: 'status', live: 'polite', atomic: 'true', text: '' },
  ])
  expect(await announcements(page), 'announced on open').toEqual([])
}

/** A duration token of the page in ms ("300ms" or "0.3s"). */
async function durationToken(page: Page, name: string): Promise<number> {
  const value = await page.evaluate(
    (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    name,
  )
  if (value.endsWith('ms')) return Number(value.slice(0, -2))
  if (value.endsWith('s')) return Number(value.slice(0, -1)) * 1000
  throw new Error(`${name} is not a duration: "${value}"`)
}

interface StepTimes {
  readonly commitAt: number | null
  readonly downs: readonly { t: number; node: string | null; choice: string | null }[]
}

/**
 * In the page: the time the part of seq 1 commits (a MutationObserver), and for every pointerdown
 * (capture phase on document) its time and the choice button whose box holds the pointer, inert or
 * not, with that button's part.
 */
async function watchStepTimes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record: {
      commitAt: number | null
      downs: { t: number; node: string | null; choice: string | null }[]
    } = { commitAt: null, downs: [] }
    ;(window as unknown as Record<string, unknown>)['__e2eSteps'] = record
    const observer = new MutationObserver(() => {
      if (record.commitAt !== null) return
      if (document.querySelector('[data-part][data-seq="1"]') === null) return
      record.commitAt = performance.now()
      observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener(
      'pointerdown',
      (event) => {
        const button = [...document.querySelectorAll('[data-part] button[data-choice]')].find(
          (candidate) => {
            const box = candidate.getBoundingClientRect()
            return (
              event.clientX >= box.left &&
              event.clientX <= box.right &&
              event.clientY >= box.top &&
              event.clientY <= box.bottom
            )
          },
        )
        record.downs.push({
          t: performance.now(),
          node: button?.closest('[data-part]')?.getAttribute('data-node') ?? null,
          choice: button?.getAttribute('data-choice') ?? null,
        })
      },
      { capture: true },
    )
  })
}

test.describe('the story player, Step 10a', { tag: '@review' }, () => {
  for (const { path: url, code, storyId } of playerPaths()) {
    test(`T-a1 ${url}: the server HTML opens on the start node with inert choices and no Back`, async ({
      request,
    }) => {
      const graph = fixtureGraph(storyId)
      const response = await request.get(url)
      expect(response.status(), 'status').toBe(200)
      const html = await response.text()
      expect(html, '<html lang>').toMatch(new RegExp(`<html\\b[^>]*\\slang="${code}"`))
      const players = html.match(/<div\b[^>]*\sdata-player=""[^>]*>/g) ?? []
      expect(players, 'the player root').toHaveLength(1)
      expect(players[0], 'the player root').toContain(' data-run-phase="opening"')
      const parts = html.match(/<div\b[^>]*\sdata-part=""[^>]*>/g) ?? []
      expect(parts, 'parts').toHaveLength(1)
      expect(parts[0], 'the part').toContain(` data-node="${graph.startNodeId}"`)
      expect(parts[0], 'the part').toContain(' data-seq="0"')
      expect(parts[0], 'no reveal on the first render').not.toContain('data-animate')
      const lists = html.match(/<ul\b[^>]*\sdata-choices=[^>]*>/g) ?? []
      expect(lists, 'choice lists').toHaveLength(1)
      expect(lists[0], 'the choices while opening').toMatch(/\sinert=""/)
      const headings = [...html.matchAll(/<h1\b[^>]*>([^<]*)<\/h1>/g)].map((match) => match[1])
      expect(headings, 'h1').toEqual([escapeHtml(graph.text[code]?.title ?? '')])
      expect(html, 'Back').not.toContain('data-back')
    })
  }

  test('T-a2 a tap before hydration changes nothing: still the start node, nothing written', async ({
    page,
    browserName,
  }) => {
    const writes = await progressSpy(page)
    // Held 1 s and until the tap is done, so the tap lands before hydration on every engine.
    let tapped = (): void => undefined
    const afterTap = new Promise<void>((resolve) => {
      tapped = resolve
    })
    const held = await holdChunks(page, 1000, afterTap)
    const url = playerPath('en', 'river-stones')
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(response?.status(), url).toBe(200)
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].every(
        (link) => link.sheet !== null,
      ),
    )
    // No frame wait here: Playwright's WebKit runs no requestAnimationFrame callback while the
    // scripts are held (probe), so a frame wait would last until they are released.
    const state = () =>
      page.evaluate(() => ({
        phase: document.querySelector('[data-player]')?.getAttribute('data-run-phase') ?? null,
        hydrated: Object.keys(document.querySelector('main') ?? {}).some((key) =>
          key.startsWith('__reactFiber$'),
        ),
      }))
    expect(await state(), 'before the tap').toEqual({ phase: 'opening', hydrated: false })
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>)['__e2eSameDocument'] = true
    })
    const point = await centreInViewport(page, choice('c1', 'start'))
    // Playwright's WebKit holds mouse input until the held scripts have run (probe: mouse.move
    // waited out the test timeout), so WebKit taps with the touchscreen, which every WebKit
    // project emulates; Chromium clicks with the mouse.
    if (browserName === 'webkit') await page.touchscreen.tap(point.x, point.y)
    else await page.mouse.click(point.x, point.y)
    expect(await state(), 'just after the tap').toEqual({ phase: 'opening', hydrated: false })
    tapped()

    await waitOpen(page)
    expect(held(), 'chunks held').toBeGreaterThan(0)
    await frames(page)
    expect(await pageValue(page, '__e2eSameDocument'), 'the same document').toBe(true)
    const now = new URL(page.url())
    expect(now.pathname + now.search, 'the URL').toBe(url)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await expect(page.locator(PART)).toHaveAttribute('data-seq', '0')
    await page.waitForTimeout(300)
    expect(await writes(), 'progress writes').toEqual([])
  })

  for (const { path: url, code, storyId } of playerPaths()) {
    test(`T-a3 ${url}: the first choices reach an ending, every part as stored`, async ({
      page,
    }) => {
      const graph = fixtureGraph(storyId)
      await openPlayer(page, url)
      await expectPart(page, graph, code, graph.startNodeId)
      for (const [index, choiceId] of graph.firstPath.choices.entries()) {
        const [reached = ''] = await walk(page, storyId, [choiceId])
        expect(reached, `step ${index + 1}`).toBe(graph.firstPath.nodes[index + 1])
        await expectPart(page, graph, code, reached)
        await expect(page.locator('#live-region')).toHaveText(stepAnnouncement(code, graph, index))
      }
      const ending = graph.firstPath.nodes[graph.firstPath.nodes.length - 1] ?? ''
      await expect
        .poll(() => storedStory(page, storyId), 'the stored story at the ending')
        .toMatchObject({ activeRun: null, endingsFound: [ending] })
    })
  }

  test('T-a4 a double tap on river-stones start advances once: flat_stones, stored path 2', async ({
    page,
  }) => {
    const url = playerPath('en', 'river-stones')
    const startC1 = choice('c1', 'start')
    const nextC1 = choice('c1', 'flat_stones')
    const quiet = quietRequests(page)
    await openPlayer(page, url)
    await settleFonts(page)
    await waitSettled(page)
    // One real step first: where flat_stones' c1 sits after the commit and its header scroll.
    await page.locator(startC1).click()
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await frames(page)
    const second = await boxOf(page, nextC1)
    await expect.poll(() => storedPath(page, 'river-stones')).toEqual(['start', 'flat_stones'])
    // Then again from the top with empty storage. The reload waits until no request is in flight:
    // WebKit reports each router prefetch a reload aborts as a page error (see T-a22).
    await page.evaluate((key) => window.localStorage.removeItem(key), PROGRESS_KEY)
    await quiet()
    await page.reload()
    await waitOpen(page)
    await settleFonts(page)
    await waitSettled(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await frames(page)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    const first = await boxOf(page, startC1)
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
    const point = { x: (overlap.left + overlap.right) / 2, y: (overlap.top + overlap.bottom) / 2 }
    const usable =
      overlap.right > overlap.left &&
      overlap.bottom > overlap.top &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < viewport.width &&
      point.y < viewport.height

    await watchStepTimes(page)
    const notes: string[] = []
    if (usable) {
      notes.push(`double tap at ${Math.round(point.x)},${Math.round(point.y)}`)
      await page.mouse.dblclick(point.x, point.y, { delay: 100 })
    } else {
      notes.push('geometry fallback')
      const tap = await centreInViewport(page, startC1)
      await page.mouse.click(tap.x, tap.y)
      await page.locator(nextC1).waitFor({ state: 'attached' })
      const again = await centreInViewport(page, nextC1)
      if (again.scrolled) notes.push('scrolled')
      await page.mouse.click(again.x, again.y)
    }
    await page.waitForTimeout(800)
    const steps = await pageValue<StepTimes>(page, '__e2eSteps')
    const secondDown = steps.downs[1]
    const late =
      steps.commitAt === null || secondDown === undefined ? null : secondDown.t - steps.commitAt
    notes.push(`second tap ${late === null ? 'never' : `${late.toFixed(0)} ms`} after the commit`)
    test.info().annotations.push({ type: 'T-a4', description: notes.join('; ') })
    console.log(`[player] T-a4 (${test.info().project.name}): ${notes.join('; ')}`)

    expect(
      steps.downs.map((down) => [down.node, down.choice]),
      'the taps: start c1, then c1 of the new part',
    ).toEqual([
      ['start', 'c1'],
      ['flat_stones', 'c1'],
    ])
    expect(late, 'the commit and second-tap times').not.toBeNull()
    expect(
      (late ?? Number.POSITIVE_INFINITY) < LATE_TAP_MS,
      `timing: the second tap came ${late} ms after the commit (450 ms or more proves nothing)`,
    ).toBe(true)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await expect(page.locator(PART)).toHaveAttribute('data-seq', '1')
    await expect.poll(() => storedPath(page, 'river-stones')).toEqual(['start', 'flat_stones'])
  })

  test('T-a5 after a step the choices are inert at +100 ms and not at +1000 ms', async ({
    page,
  }) => {
    await openPlayer(page, playerPath('en', 'river-stones'))
    await waitSettled(page)
    await page.evaluate(() => {
      const result: Record<string, boolean | null> = {}
      ;(window as unknown as Record<string, unknown>)['__e2eSettle'] = result
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-part][data-seq="1"]') === null) return
        observer.disconnect()
        const inert = () =>
          document.querySelector<HTMLUListElement>('ul[data-choices]')?.inert ?? null
        setTimeout(() => {
          result['at100'] = inert()
        }, 100)
        setTimeout(() => {
          result['at1000'] = inert()
        }, 1000)
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
    await page.locator(choice('c1', 'start')).click()
    await expect
      .poll(() => pageValue(page, '__e2eSettle'), { timeout: 5_000 })
      .toEqual({ at100: true, at1000: false })
  })

  test('T-a6 after a step the first paragraph has focus and the header is at the top', async ({
    page,
  }) => {
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('the project sets no viewport')
    // A short viewport, so the page scrolls on every project.
    await page.setViewportSize({ width: viewport.width, height: 320 })
    await openPlayer(page, playerPath('en', 'river-stones'))
    await settleFonts(page)
    await waitSettled(page)
    const before = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
      return window.scrollY
    })
    expect(before, 'scrolled down before the step').toBeGreaterThan(0)
    await page.locator(choice('c1', 'start')).click()
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await frames(page)
    const after = await page.evaluate(() => {
      const header = document.querySelector('[data-player] header')
      const first = document.querySelector('[data-part] [data-passage] p')
      if (header === null || first === null) throw new Error('no header or first paragraph')
      const headerTop = header.getBoundingClientRect().top + window.scrollY
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight
      return {
        scrollY: window.scrollY,
        headerTop,
        maxScroll,
        expected: Math.max(0, Math.min(headerTop, maxScroll)),
        focused: document.activeElement === first,
        active: document.activeElement?.localName ?? null,
      }
    })
    const description =
      `scrollY ${before} before; after: scrollY ${after.scrollY}, header at ${after.headerTop}, ` +
      `max scroll ${after.maxScroll}, focus on ${after.active}`
    test.info().annotations.push({ type: 'T-a6', description })
    expect(after.focused, `focus: ${description}`).toBe(true)
    expect(Math.abs(after.scrollY - after.expected), `scroll: ${description}`).toBeLessThanOrEqual(
      1,
    )
  })

  for (const code of ENABLED_LOCALE_CODES) {
    test(`T-a7 /${code}: one live region, empty at load and after open, then "Page 2"`, async ({
      page,
      request,
    }) => {
      const url = playerPath(code, 'two-paths')
      const html = await (await request.get(url)).text()
      expect(html.split('role="status"').length - 1, 'role=status in the server HTML').toBe(1)
      expect(html, 'the empty live region').toMatch(/<div\b[^>]*\srole="status"[^>]*><\/div>/)
      await openPlayer(page, url)
      await frames(page)
      expect(await liveRegions(page), 'two frames after open').toEqual([
        { role: 'status', live: 'polite', atomic: 'true', text: '' },
      ])
      expect(await page.evaluate(() => document.querySelectorAll('[role="status"]').length)).toBe(1)
      await walk(page, 'two-paths', ['c1'])
      await expect(page.locator('#live-region')).toHaveText(
        formatted(uiLang(code), 'player.page', { n: 2 }),
      )
      expect(await page.evaluate(() => document.querySelectorAll('[role="status"]').length)).toBe(1)
    })
  }

  test('T-a8 a saved run resumes at its node and opening writes nothing', async ({ page }) => {
    const writes = await progressSpy(page)
    await seedProgressOnce(page, {
      'river-stones': { activeRun: { path: ['start', 'flat_stones', 'big_rock'], locale: 'en' } },
    })
    await recordAnnouncements(page)
    await openPlayer(page, playerPath('en', 'river-stones'))
    await expectPart(page, fixtureGraph('river-stones'), 'en', 'big_rock')
    expect(
      await page.evaluate(() => document.documentElement.hasAttribute('data-saved-run')),
      'the hint attribute after open',
    ).toBe(false)
    await expectSilentOpen(page)
    await page.waitForTimeout(500)
    expect(await writes(), 'progress writes on load').toEqual([])
  })

  test('T-a9 a resumed load never paints the start node and opens in time', async ({ page }) => {
    await seedProgressOnce(page, {
      'river-stones': { activeRun: { path: ['start', 'flat_stones'], locale: 'en' } },
    })
    await sampleOpeningFrames(page)
    const held = await holdChunks(page, 500)
    await openPlayer(page, playerPath('en', 'river-stones'))
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await frames(page)
    const seen = await openingFrames(page)
    const atDcl = await pageValue<unknown>(page, '__e2eAtDcl')
    const description =
      `open commit at ${seen.firstOpenAt} ms; ${seen.opening} opening frames, ${seen.painted} ` +
      `painted; at DOMContentLoaded ${JSON.stringify(atDcl)}`
    test.info().annotations.push({ type: 'T-a9', description })
    console.log(`[player] T-a9 (${test.info().project.name}): ${description}`)
    expect(held(), 'chunks held').toBeGreaterThan(0)
    expect(atDcl, 'at DOMContentLoaded').toEqual({
      saved: true,
      runVisibility: 'hidden',
      phase: 'opening',
    })
    // C16 (review R2-FLK-3): the open-commit bound first, so a hydration slower than the 3 s
    // failsafe fails as itself, not as the painted frames the failsafe then shows.
    expect(seen.firstOpenAt, 'the open commit').not.toBeNull()
    expect(
      seen.firstOpenAt ?? Number.POSITIVE_INFINITY,
      'ms to the open commit',
    ).toBeLessThanOrEqual(2900)
    expect(seen.opening, 'frames sampled while opening').toBeGreaterThan(0)
    expect(seen.painted, 'opening frames that painted the start passage').toBe(0)
  })

  test('T-a9 failsafe: when the scripts never load, a resumed load shows its run area after --saved-run-failsafe', async ({
    page,
    errors,
  }) => {
    // D11-P5, §4.4 (review PIF-2): if JavaScript never runs, the one-shot failsafe makes the hidden
    // run area visible after --saved-run-failsafe. Every JavaScript chunk fails to load (aborted),
    // so the inline hint runs and nothing else does; the page still finishes loading, so both
    // engines keep rendering (a held chunk would stop WebKit's frames, see T-a2).
    // WebKit logs no error-level line for an aborted script (measured here, as O3 for an image).
    errors.allow({ chromium: [CHUNK_FAILED_LINE] })
    await seedProgressOnce(page, {
      'river-stones': { activeRun: { path: ['start', 'flat_stones'], locale: 'en' } },
    })
    let aborted = 0
    await page.route(
      (url) => url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js'),
      async (route) => {
        aborted++
        await route.abort()
      },
    )
    const url = playerPath('en', 'river-stones')
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(response?.status(), url).toBe(200)
    const look = () =>
      page.evaluate(() => {
        const run = document.querySelector('[data-run]')
        return {
          t: Math.round(performance.now()),
          saved: document.documentElement.hasAttribute('data-saved-run'),
          phase: document.querySelector('[data-player]')?.getAttribute('data-run-phase') ?? null,
          visibility: run ? getComputedStyle(run).visibility : 'no run area',
          hydrated: Object.keys(document.querySelector('main') ?? {}).some((key) =>
            key.startsWith('__reactFiber$'),
          ),
        }
      })
    const failsafe = await durationToken(page, '--saved-run-failsafe')
    expect(failsafe, '--saved-run-failsafe').toBe(3000)
    const before = await look()
    expect(before, 'before the failsafe').toMatchObject({
      saved: true,
      phase: 'opening',
      visibility: 'hidden',
      hydrated: false,
    })
    await expect
      .poll(async () => (await look()).visibility, { timeout: failsafe + 4000, intervals: [100] })
      .toBe('visible')
    const shown = await look()
    const description = `hidden at ${before.t} ms, visible by ${shown.t} ms; ${aborted} chunks aborted`
    test.info().annotations.push({ type: 'T-a9 failsafe', description })
    console.log(`[player] T-a9 failsafe (${test.info().project.name}): ${description}`)
    expect(aborted, 'chunks aborted').toBeGreaterThan(0)
    expect(shown, 'when the failsafe has fired').toMatchObject({
      saved: true,
      phase: 'opening',
      hydrated: false,
    })
    expect(shown.t, 'not before --saved-run-failsafe').toBeGreaterThanOrEqual(failsafe)
    // The start node, as the server rendered it, is what shows.
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await expect(page.locator(PART).locator('[data-passage] p').first()).toBeVisible()
  })

  test('T-a10 a fresh load sets no hint and paints the start node from the first frame', async ({
    page,
  }) => {
    await sampleOpeningFrames(page)
    const held = await holdChunks(page, 500)
    await openPlayer(page, playerPath('en', 'river-stones'))
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await frames(page)
    const seen = await openingFrames(page)
    const atDcl = await pageValue<unknown>(page, '__e2eAtDcl')
    test.info().annotations.push({
      type: 'T-a10',
      description: `${seen.opening} opening frames, ${seen.painted} painted; ${JSON.stringify(atDcl)}`,
    })
    expect(held(), 'chunks held').toBeGreaterThan(0)
    expect(atDcl, 'at DOMContentLoaded').toEqual({
      saved: false,
      runVisibility: 'visible',
      phase: 'opening',
    })
    expect(seen.opening, 'frames sampled while opening').toBeGreaterThan(0)
    expect(seen.painted, 'opening frames that painted the start passage').toBe(seen.opening)
    expect(seen.saved, 'frames with data-saved-run').toBe(0)
  })

  test('T-a11 a saved run with an invalid tail resumes at its longest valid prefix', async ({
    page,
  }) => {
    await seedProgressOnce(page, {
      'river-stones': { activeRun: { path: ['start', 'flat_stones', 'nope'], locale: 'en' } },
    })
    await recordAnnouncements(page)
    await openPlayer(page, playerPath('en', 'river-stones'))
    await expectPart(page, fixtureGraph('river-stones'), 'en', 'flat_stones')
    await expectSilentOpen(page)
  })

  test('T-a12 a run saved in Hindi opens in Hindi on /en; the page and its chrome stay English', async ({
    page,
  }) => {
    await seedProgressOnce(page, {
      'river-stones': { activeRun: { path: ['start', 'flat_stones'], locale: 'hi' } },
    })
    await openPlayer(page, playerPath('en', 'river-stones'))
    await expectPart(page, fixtureGraph('river-stones'), 'hi', 'flat_stones')
    expect(await page.locator('html').getAttribute('lang'), '<html lang>').toBe('en')
    await expect(page.locator('a[data-exit]')).toHaveText(message('en', 'player.allStories'))
    await expect(page.locator('header nav a')).toHaveText(message('en', 'header.grownUps'))
    await expect(page.locator('header nav')).toHaveAttribute(
      'aria-label',
      message('en', 'header.navLabel'),
    )
  })

  test('T-a13 another tab advancing the same story leaves this tab on its node and seq', async ({
    page,
    context,
    errors,
  }) => {
    const url = playerPath('en', 'river-stones')
    await openPlayer(page, url)
    await walk(page, 'river-stones', ['c1'])
    await expect.poll(() => storedPath(page, 'river-stones')).toEqual(['start', 'flat_stones'])
    const other = await context.newPage()
    errors.watch(other)
    await openPlayer(other, url)
    await expect(other.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await walk(other, 'river-stones', ['c1'])
    await expect
      .poll(() => storedPath(page, 'river-stones'))
      .toEqual(['start', 'flat_stones', 'big_rock'])
    await page.waitForTimeout(500)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await expect(page.locator(PART)).toHaveAttribute('data-seq', '1')
    await other.close()
  })

  test('T-a14 back to a resumed player after a client navigation never paints the start node', async ({
    page,
  }) => {
    await seedProgressOnce(page, {
      'river-stones': { activeRun: { path: ['start', 'flat_stones'], locale: 'en' } },
    })
    await sampleOpeningFrames(page)
    await openPlayer(page, playerPath('en', 'river-stones'))
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>)['__e2eSameDocument'] = true
    })
    await Promise.all([
      page.waitForURL((now) => now.pathname === '/en/grown-ups'),
      page.locator('header nav a[href="/en/grown-ups"]').click(),
    ])
    await expect(page.locator('h1')).toHaveText(message('en', 'grownUps.title'))
    await page.evaluate(() => {
      ;((window as unknown as Record<string, unknown>)['__e2eFrames'] as unknown[]).length = 0
    })
    await page.goBack()
    await waitOpen(page)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await frames(page)
    expect(await pageValue(page, '__e2eSameDocument'), 'client navigations only').toBe(true)
    const seen = await openingFrames(page)
    const description = `${seen.frames} frames after Back, ${seen.opening} opening, ${seen.painted} painted`
    test.info().annotations.push({ type: 'T-a14', description })
    console.log(`[player] T-a14 (${test.info().project.name}): ${description}`)
    expect(seen.frames, 'frames sampled after Back').toBeGreaterThan(0)
    expect(seen.painted, 'opening frames that painted the start passage').toBe(0)
  })

  for (const code of ENABLED_LOCALE_CODES) {
    test(`T-a15 /${code} with storage blocked: the banner first in main, announced once; an ending is reached`, async ({
      page,
    }) => {
      const lang = uiLang(code)
      const graph = fixtureGraph('two-paths')
      await recordAnnouncements(page)
      await blockStorage(page)
      await openPlayer(page, playerPath(code, 'two-paths'))
      const banner = page.locator('section[aria-labelledby="storage-banner-title"]')
      await expect(banner).toBeVisible()
      await expect(banner.locator('p')).toHaveText([
        message(lang, 'storage.title'),
        message(lang, 'storage.body'),
      ])
      expect(
        await page
          .locator('main')
          .evaluate((main) => [
            main.id,
            main.firstElementChild?.localName ?? null,
            main.firstElementChild?.getAttribute('aria-labelledby') ?? null,
          ]),
        'the banner is the first thing in main',
      ).toEqual(['main', 'section', 'storage-banner-title'])
      await expect(page.locator('#live-region')).toHaveText(message(lang, 'storage.title'))
      await walk(page, 'two-paths', graph.firstPath.choices)
      const ending = graph.firstPath.nodes[graph.firstPath.nodes.length - 1] ?? ''
      await expectPart(page, graph, code, ending)
      // With storage blocked the ending just reached still counts (the session's endings, §8).
      const pages = graph.firstPath.choices.map((_choice, index) =>
        stepAnnouncement(code, graph, index),
      )
      await expect(page.locator('#live-region')).toHaveText(pages[pages.length - 1] ?? '')
      expect(await announcements(page), 'announced once, then the pages').toEqual([
        message(lang, 'storage.title'),
        ...pages,
      ])
    })
  }

  test('T-a16 Tab reaches the first choice and Enter takes it; the focused paragraph shows no ring', async ({
    page,
    browserName,
  }) => {
    await openPlayer(page, playerPath('en', 'two-paths'))
    await waitSettled(page)
    await focusByKeyboard(page, browserName, choice('c1', 'start'))
    const ring = () =>
      page.evaluate(() => {
        const element = document.activeElement
        if (element === null) throw new Error('nothing focused')
        const style = getComputedStyle(element)
        return {
          element: element.localName,
          focusVisible: element.matches(':focus-visible'),
          outline: style.outlineStyle,
          shadow: style.boxShadow,
        }
      })
    // The base ring (base.css :focus-visible) is on the keyboard-focused choice: the check below
    // would see it on the paragraph if the player's no-ring rule were missing (D11-P8).
    const onChoice = await ring()
    expect(onChoice, 'the focused choice').toMatchObject({ element: 'button', focusVisible: true })
    expect(onChoice.outline, 'the ring on the focused choice').not.toBe('none')
    await page.keyboard.press('Enter')
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'wise_path')
    await expect(page.locator(PART)).toHaveAttribute('data-seq', '1')
    await frames(page)
    const onParagraph = await ring()
    test.info().annotations.push({ type: 'T-a16 ring', description: JSON.stringify(onParagraph) })
    expect(
      await page.evaluate(
        () => document.activeElement === document.querySelector('[data-part] [data-passage] p'),
      ),
      'focus on the first paragraph',
    ).toBe(true)
    expect(onParagraph, 'no ring on the focused paragraph (D11-P8)').toMatchObject({
      element: 'p',
      outline: 'none',
      shadow: 'none',
    })
  })

  for (const code of ENABLED_LOCALE_CODES) {
    test(`T-a17 /${code} at 320 px and 150%: no horizontal scroll; choices 56 px tall, 8 px apart`, async ({
      page,
    }) => {
      const viewport = page.viewportSize()
      if (!viewport) throw new Error('the project sets no viewport')
      await page.setViewportSize({ width: 320, height: viewport.height })
      await seedPrefs(page, prefsText(150))
      await openPlayer(page, playerPath(code, 'river-stones'))
      await settleFonts(page)
      const layout = await page.evaluate(() => ({
        attribute: document.documentElement.getAttribute('data-text-scale'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        buttons: [...document.querySelectorAll('[data-part] button[data-choice]')].map((b) => {
          const box = b.getBoundingClientRect()
          return { top: box.top, bottom: box.bottom, left: box.left, right: box.right }
        }),
      }))
      console.log(
        `[player] T-a17 /${code} at 320 px, 150% (${test.info().project.name}): scroll ` +
          `${layout.scrollWidth}/${layout.clientWidth}; choices ` +
          JSON.stringify(layout.buttons.map((b) => [Math.round(b.top), Math.round(b.bottom)])),
      )
      expect(layout.attribute, 'the stored text size').toBe('150')
      expect(layout.scrollWidth, 'horizontal scroll').toBeLessThanOrEqual(layout.clientWidth)
      expect(layout.buttons, 'choices').toHaveLength(2)
      for (const box of layout.buttons) {
        expect(box.bottom - box.top, 'choice height').toBeGreaterThanOrEqual(56)
        expect(box.left, 'choice left').toBeGreaterThanOrEqual(0)
        expect(box.right, 'choice right').toBeLessThanOrEqual(layout.clientWidth)
      }
      for (let i = 1; i < layout.buttons.length; i++) {
        const [above, below] = [layout.buttons[i - 1], layout.buttons[i]]
        if (!above || !below) continue
        expect(below.top - above.bottom, 'space between choices').toBeGreaterThanOrEqual(8)
      }
    })
  }

  test('T-a18 a step reveals the passage, then the question and choices, within --reveal-max', async ({
    page,
  }) => {
    await openPlayer(page, playerPath('en', 'river-stones'))
    await walk(page, 'river-stones', ['c1'])
    const reveal = await page.evaluate(() => {
      const part = document.querySelector('[data-part]')
      if (part === null) throw new Error('no part')
      return document
        .getAnimations()
        .map((animation) => ({
          animation,
          target: (animation.effect as KeyframeEffect | null)?.target,
        }))
        .filter(({ target }) => target instanceof Element && part.contains(target))
        .map(({ animation, target }) => {
          const timing = animation.effect?.getTiming() ?? {}
          const element = target as Element
          return {
            target: element.hasAttribute('data-passage')
              ? 'passage'
              : element.hasAttribute('data-question')
                ? 'question'
                : element.hasAttribute('data-choices')
                  ? 'choices'
                  : element.localName,
            delay: Number(timing.delay ?? 0),
            duration: Number(timing.duration ?? 0),
          }
        })
        .sort((a, b) => a.target.localeCompare(b.target))
    })
    console.log(`[player] T-a18 (${test.info().project.name}): ${JSON.stringify(reveal)}`)
    expect(
      reveal.map((r) => r.target),
      'the animated parts',
    ).toEqual(['choices', 'passage', 'question'])
    for (const r of reveal) {
      expect(r.duration, `${r.target} duration`).toBeGreaterThan(0)
      expect(r.delay + r.duration, `${r.target} delay + duration (ms)`).toBeLessThanOrEqual(2500)
    }
    // D11-P6 (review A11Y-1): the passage over --duration-calm from the step, then the question and
    // choices over --duration-quick after a --duration-calm delay, so they start when it ends.
    const calm = await durationToken(page, '--duration-calm')
    const quick = await durationToken(page, '--duration-quick')
    expect({ calm, quick }, 'the reveal tokens (tokens.css)').toEqual({ calm: 300, quick: 150 })
    const [choices, passage, question] = reveal
    expect(passage, 'the passage').toEqual({ target: 'passage', delay: 0, duration: calm })
    expect(question, 'the question').toEqual({ target: 'question', delay: calm, duration: quick })
    expect(choices, 'the choices').toEqual({ target: 'choices', delay: calm, duration: quick })
    for (const later of [question, choices]) {
      expect(later?.delay, `${later?.target} starts after the passage ends`).toBeGreaterThanOrEqual(
        (passage?.delay ?? 0) + (passage?.duration ?? 0),
      )
    }
  })

  test('T-a18 at an ending the card fades in with the second stage, when the passage has ended', async ({
    page,
  }) => {
    // D11-P6 amended at 10c (A11Y-10c-2): the ending card fades in like the question and choices,
    // so it never paints before the passage. Read once every animation in the part has started
    // (its ready promise), from each one's start time on the document timeline and its timing,
    // never from frames or the click time.
    await openPlayer(page, playerPath('en', 'lantern-walk'))
    await walk(page, 'lantern-walk', ['c1', 'c1'])
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'ending_light')
    const reveal = await page.evaluate(async () => {
      const part = document.querySelector('[data-part]')
      if (part === null) throw new Error('no part')
      const animations = document.getAnimations().filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target
        return target instanceof Element && part.contains(target)
      })
      await Promise.all(animations.map((animation) => animation.ready))
      return animations
        .map((animation) => {
          const element = (animation.effect as KeyframeEffect).target as Element
          const timing = animation.effect?.getTiming() ?? {}
          return {
            target: element.hasAttribute('data-passage')
              ? 'passage'
              : element.hasAttribute('data-ending')
                ? 'card'
                : element.localName,
            startTime: animation.startTime === null ? null : Number(animation.startTime),
            delay: Number(timing.delay ?? 0),
            duration: Number(timing.duration ?? 0),
          }
        })
        .sort((a, b) => a.target.localeCompare(b.target))
    })
    console.log(`[player] T-a18 ending (${test.info().project.name}): ${JSON.stringify(reveal)}`)
    expect(
      reveal.map((r) => r.target),
      'the animated parts at an ending',
    ).toEqual(['card', 'passage'])
    const [card, passage] = reveal
    if (card?.startTime == null || passage?.startTime == null) {
      throw new Error('a reveal animation has no start time after its ready promise')
    }
    expect(
      card.startTime + card.delay,
      'the card starts when the passage has ended (ms on the document timeline)',
    ).toBeGreaterThanOrEqual(passage.startTime + passage.delay + passage.duration)
    expect(card.delay + card.duration, 'card delay + duration (ms)').toBeLessThanOrEqual(2500)
    const calm = await durationToken(page, '--duration-calm')
    const quick = await durationToken(page, '--duration-quick')
    expect({ calm, quick }, 'the reveal tokens (tokens.css)').toEqual({ calm: 300, quick: 150 })
    expect(passage, 'the passage').toMatchObject({ delay: 0, duration: calm })
    expect(card, 'the card, with the question and choices').toMatchObject({
      delay: calm,
      duration: quick,
    })
  })

  test('T-a18 under reduced motion the choices show fully within a frame of the step', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openPlayer(page, playerPath('en', 'river-stones'))
    await waitSettled(page)
    await page.evaluate(() => {
      const seen: { frame: number; passage: string; choices: string }[] = []
      ;(window as unknown as Record<string, unknown>)['__e2eReduced'] = seen
      const observer = new MutationObserver(() => {
        const part = document.querySelector('[data-part][data-seq="1"]')
        if (part === null) return
        observer.disconnect()
        // Review R2-FLK-1: Chromium starts a CSS animation asynchronously (pending, no start time,
        // until the compositor confirms it), and on a loaded runner two animation frame callbacks
        // can run before that, both still at opacity 0. So the frames are counted from the frame
        // after every reveal animation on the new part is ready; none at all resolves at once.
        const reveal = document.getAnimations().filter((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target
          return target instanceof Element && part.contains(target)
        })
        ;(window as unknown as Record<string, unknown>)['__e2eReducedAnimations'] = reveal.length
        let frame = 0
        const sample = (): void => {
          const passage = part.querySelector('[data-passage]')
          const list = part.querySelector('ul[data-choices]')
          seen.push({
            frame,
            passage: passage ? getComputedStyle(passage).opacity : 'none',
            choices: list ? getComputedStyle(list).opacity : 'none',
          })
          frame++
          if (frame < 4) requestAnimationFrame(sample)
        }
        void Promise.all(reveal.map((animation) => animation.ready)).then(() =>
          requestAnimationFrame(sample),
        )
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
    await page.locator(choice('c1', 'start')).click()
    await expect.poll(async () => (await pageValue<unknown[]>(page, '__e2eReduced')).length).toBe(4)
    const seen = await pageValue<{ frame: number; passage: string; choices: string }[]>(
      page,
      '__e2eReduced',
    )
    const animations = await pageValue<number>(page, '__e2eReducedAnimations')
    console.log(
      `[player] T-a18 reduced motion (${test.info().project.name}): ${animations} reveal ` +
        `animations; ${JSON.stringify(seen)}`,
    )
    // Frame 0 is the first frame after the reveal animations started; both are at full opacity.
    expect(seen[0], 'the frame after the reveal animations are ready').toEqual({
      frame: 0,
      passage: '1',
      choices: '1',
    })
  })

  test('T-a18 a pointerdown in the run area ends the reveal at once', async ({ page }) => {
    await openPlayer(page, playerPath('en', 'river-stones'))
    await waitSettled(page)
    await page.evaluate(() => {
      const record: {
        commitAt: number | null
        downAt: number | null
        after: { reveal: string | null; running: number; choices: string } | null
      } = { commitAt: null, downAt: null, after: null }
      ;(window as unknown as Record<string, unknown>)['__e2eSkip'] = record
      const observer = new MutationObserver(() => {
        if (record.commitAt !== null) return
        if (document.querySelector('[data-part][data-seq="1"]') === null) return
        record.commitAt = performance.now()
        observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      window.addEventListener(
        'pointerdown',
        () => {
          if (record.commitAt === null || record.downAt !== null) return
          record.downAt = performance.now()
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const part = document.querySelector('[data-part]')
              const list = part?.querySelector('ul[data-choices]')
              record.after = {
                reveal: part?.getAttribute('data-reveal') ?? null,
                running: document.getAnimations().filter((animation) => {
                  const target = (animation.effect as KeyframeEffect | null)?.target
                  return (
                    animation.playState === 'running' &&
                    part !== null &&
                    target instanceof Element &&
                    part.contains(target)
                  )
                }).length,
                choices: list ? getComputedStyle(list).opacity : 'none',
              }
            }),
          )
        },
        { capture: true },
      )
    })
    // The step commits inside the click handler, so no wait for the new part here (one round trip
    // fewer inside the 450 ms reveal; a pointerdown before the commit is not recorded and fails).
    await page.locator(choice('c1', 'start')).click()
    const point = await centreInViewport(page, '[data-part][data-seq="1"] [data-passage]')
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.up()
    await expect
      .poll(async () => (await pageValue<{ after: unknown }>(page, '__e2eSkip')).after)
      .not.toBeNull()
    const record = await pageValue<{
      commitAt: number
      downAt: number
      after: { reveal: string | null; running: number; choices: string }
    }>(page, '__e2eSkip')
    const late = record.downAt - record.commitAt
    test.info().annotations.push({
      type: 'T-a18 skip',
      description: `pointerdown ${late.toFixed(0)} ms after the commit`,
    })
    expect(late < LATE_TAP_MS, `timing: the pointerdown came ${late} ms after the commit`).toBe(
      true,
    )
    expect(record.after, 'two frames after the pointerdown').toEqual({
      reveal: 'done',
      running: 0,
      choices: '1',
    })
  })

  test('T-a18 a key press in the run area ends the reveal at once (keyboard step)', async ({
    page,
    browserName,
  }) => {
    // D11-P6 (review A11Y-5): "a pointerdown or keydown inside the run area". After a keyboard
    // step the focus is on the new part's first paragraph, inside the run area.
    await openPlayer(page, playerPath('en', 'river-stones'))
    await waitSettled(page)
    await page.evaluate(() => {
      const record: {
        commitAt: number | null
        keyAt: number | null
        key: string | null
        after: { reveal: string | null; running: number; choices: string } | null
      } = { commitAt: null, keyAt: null, key: null, after: null }
      ;(window as unknown as Record<string, unknown>)['__e2eKeySkip'] = record
      const observer = new MutationObserver(() => {
        if (record.commitAt !== null) return
        if (document.querySelector('[data-part][data-seq="1"]') === null) return
        record.commitAt = performance.now()
        observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      window.addEventListener(
        'keydown',
        (event) => {
          if (record.commitAt === null || record.keyAt !== null) return
          record.keyAt = performance.now()
          record.key = event.key
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const part = document.querySelector('[data-part]')
              const list = part?.querySelector('ul[data-choices]')
              record.after = {
                reveal: part?.getAttribute('data-reveal') ?? null,
                running: document.getAnimations().filter((animation) => {
                  const target = (animation.effect as KeyframeEffect | null)?.target
                  return (
                    animation.playState === 'running' &&
                    part !== null &&
                    target instanceof Element &&
                    part.contains(target)
                  )
                }).length,
                choices: list ? getComputedStyle(list).opacity : 'none',
              }
            }),
          )
        },
        { capture: true },
      )
    })
    await focusByKeyboard(page, browserName, choice('c1', 'start'))
    // The step commits inside the Enter key's click handler, so the next key follows at once (one
    // round trip, well inside the 450 ms reveal); a key before the commit is not recorded, and the
    // poll below then fails.
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift')
    await expect
      .poll(async () => (await pageValue<{ after: unknown }>(page, '__e2eKeySkip')).after)
      .not.toBeNull()
    const record = await pageValue<{
      commitAt: number
      keyAt: number
      key: string
      after: { reveal: string | null; running: number; choices: string }
    }>(page, '__e2eKeySkip')
    const late = record.keyAt - record.commitAt
    test.info().annotations.push({
      type: 'T-a18 key skip',
      description: `${record.key} keydown ${late.toFixed(0)} ms after the commit`,
    })
    expect(record.key, 'the key after the step').toBe('Shift')
    expect(
      await page.evaluate(() => document.activeElement?.closest('[data-run]') !== null),
      'the focus is inside the run area',
    ).toBe(true)
    expect(late < LATE_TAP_MS, `timing: the keydown came ${late} ms after the commit`).toBe(true)
    expect(record.after, 'two frames after the keydown').toEqual({
      reveal: 'done',
      running: 0,
      choices: '1',
    })
  })

  for (const resumed of [false, true]) {
    test(`T-a19 no reveal on ${resumed ? 'a resumed' : 'a fresh'} open`, async ({ page }) => {
      if (resumed) {
        await seedProgressOnce(page, {
          'river-stones': { activeRun: { path: ['start', 'flat_stones'], locale: 'en' } },
        })
      }
      await openPlayer(page, playerPath('en', 'river-stones'))
      await expect(page.locator(PART)).toHaveAttribute(
        'data-node',
        resumed ? 'flat_stones' : 'start',
      )
      await frames(page)
      const state = await page.evaluate(() => {
        const player = document.querySelector('[data-player]')
        return {
          animate: document.querySelectorAll('[data-animate]').length,
          animations: document
            .getAnimations()
            .filter((animation) => {
              const target = (animation.effect as KeyframeEffect | null)?.target
              return player !== null && target instanceof Element && player.contains(target)
            })
            .map((animation) =>
              'animationName' in animation ? String(animation.animationName) : animation.id,
            ),
        }
      })
      expect(state, 'after open').toEqual({ animate: 0, animations: [] })
    })
  }

  // Step 10d CI fix: each locale also under the test-only wide Devanagari fallback (T-d6 has why),
  // which reproduces on any OS the CI image's CLS 0.146 on chromium-phone /hi before the fix.
  const fallbacks = ENABLED_LOCALE_CODES.flatMap((code) => [
    { code, wide: false, name: `/${code}` },
    { code, wide: true, name: `/${code} with a wide Devanagari fallback` },
  ])
  for (const { code, wide, name } of fallbacks) {
    test(`T-a20 ${name}: fonts held 1.5 s shift a fresh player by less than 0.1 (Chromium)`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'the Layout Instability API is Chromium only')
      if (wide) await wideDevanagariFallback(page)
      await recordLayoutShifts(page)
      let delayed = 0
      let released = 0
      await page.route(
        (url) => LORA_FILE.test(url.pathname) || NOTO_FILE.test(url.pathname),
        async (route) => {
          delayed++
          await sleep(1500)
          await route.continue().catch(() => undefined)
          released++
        },
      )
      const response = await page.goto(playerPath(code, 'two-paths'), {
        waitUntil: 'domcontentloaded',
      })
      expect(response?.status(), 'status').toBe(200)
      await expect.poll(() => delayed, { timeout: 15_000 }).toBeGreaterThan(0)
      await expect.poll(() => released === delayed, { timeout: 15_000 }).toBe(true)
      await waitOpen(page)
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 500)))
          }),
      )
      const timing = await page.evaluate(
        (patterns) => ({
          firstPaint:
            performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? Number.NaN,
          fontEnd: Math.max(
            ...performance
              .getEntriesByType('resource')
              .filter((entry) => patterns.some((pattern) => new RegExp(pattern).test(entry.name)))
              .map((entry) => (entry as PerformanceResourceTiming).responseEnd),
          ),
        }),
        [LORA_FILE.source, NOTO_FILE.source],
      )
      const { cls, raw, shifts, inputShifts, lines } = await layoutShift(page)
      const description =
        `CLS ${cls.toFixed(6)}, raw ${raw.toFixed(6)} (${shifts} shifts, ${inputShifts} flagged ` +
        `as recent input; ${delayed} font files held; first paint ${timing.firstPaint.toFixed(0)} ` +
        `ms, fonts arrived ${timing.fontEnd.toFixed(0)} ms)`
      console.log(`[player] T-a20 ${name} (${test.info().project.name}): ${description}`)
      // Each shift with what moved (selector, previous rect -> current rect, CSS px), so a CI log
      // names the shifted nodes (Step 10d CI fix: the header's nav changing rows).
      for (const line of lines) {
        console.log(`[player] T-a20 ${name} (${test.info().project.name}): ${line}`)
      }
      test.info().annotations.push({ type: 'CLS', description })
      if (lines.length > 0) {
        test.info().annotations.push({ type: 'CLS shifts', description: lines.join('\n') })
      }
      // The page painted before the fonts arrived, so the swap was measured.
      expect(timing.firstPaint).toBeLessThan(timing.fontEnd)
      expect(cls).toBeLessThan(0.1)
    })
  }

  for (const notFoundPath of playerNotFoundPaths(launchLeg(process.env.E2E_LAUNCH))) {
    test(`T-a21 ${notFoundPath} is the bilingual 404`, async ({ page, errors }) => {
      errors.allow({ chromium: [NOT_FOUND_LINE], webkit: [NOT_FOUND_LINE] })
      const response = await page.goto(notFoundPath)
      if (!response) throw new Error(`no response for ${notFoundPath}`)
      expect(response.status(), 'status').toBe(404)
      expectSecurityHeaders(await response.allHeaders(), notFoundPath)
      expect(await page.locator('html').getAttribute('lang')).toBe('en')
      expect(await page.title()).toBe(NOT_FOUND_TITLE)
      const h1 = page.locator('h1')
      await expect(h1).toHaveCount(1)
      await expect(h1).toContainText(message('en', 'notFound.title'))
      await expect(h1.locator('[lang="hi"]')).toHaveText(message('hi', 'notFound.title'))
      const failedLoads = () => errors.lines.filter((line) => NOT_FOUND_LINE.test(line)).length
      await expect.poll(failedLoads, 'the failed-load line').toBe(1)
      await page.waitForTimeout(200)
      expect(failedLoads(), 'one failed-load line for the one page load').toBe(1)
    })
  }

  test('T-a22 a render error shows the fallback; Start this story again opens fresh, endings kept', async ({
    page,
    errors,
  }) => {
    errors.allow({ chromium: [PLANTED_LINE], webkit: [PLANTED_LINE] })
    const quiet = quietRequests(page)
    await seedProgressOnce(page, {
      'two-paths': { activeRun: null, endingsFound: ['ending_wise'] },
    })
    // scrollIntoView throws once: the first step's layout effect calls it on the header.
    await page.addInitScript((planted) => {
      const original = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = function (
        this: Element,
        ...args: Parameters<Element['scrollIntoView']>
      ) {
        if (window.sessionStorage.getItem('e2e-planted-throw') === null) {
          window.sessionStorage.setItem('e2e-planted-throw', '1')
          throw new Error(planted)
        }
        return original.apply(this, args)
      }
    }, PLANTED_MESSAGE)
    await openPlayer(page, playerPath('en', 'two-paths'))
    await waitSettled(page)
    await page.locator(choice('c1', 'start')).click()

    const fallback = page.locator('main[data-player-error]')
    await expect(fallback).toBeVisible()
    await expect(page.locator(PLAYER), 'the player is unmounted').toHaveCount(0)
    // P1-4 owner screens (T2b): only the player's main lost its top padding to the framed panel;
    // the fallback's main has no .player parent and keeps base.css's --space-7 (48 px).
    expect(
      await fallback.evaluate((main) => ({
        paddingBlockStart: getComputedStyle(main).getPropertyValue('padding-block-start'),
        runAreas: main.querySelectorAll('[data-run]').length,
      })),
      "the fallback's main: its top padding, and no run area in it",
    ).toEqual({ paddingBlockStart: '48px', runAreas: 0 })
    const heading = fallback.locator('h1')
    await expect(heading).toHaveText(message('en', 'player.errorTitle'))
    await expect(heading).toBeFocused()
    await expect(fallback.locator('a[href="/en"]')).toHaveText(message('en', 'player.allStories'))
    const startAgain = fallback.locator('button[data-start-again]')
    await expect(startAgain).toHaveText(message('en', 'player.startThisAgain'))
    expect(
      errors.lines.filter((line) => PLANTED_LINE.test(line)),
      'the planted error, logged once',
    ).toHaveLength(1)

    // The button reloads the page. WebKit reports each router prefetch a reload aborts as a page
    // error ("Fetch API cannot load …?_rsc=… due to access control checks"), on /en and
    // /en/grown-ups as well (probe 2026-11-16), so the reload waits until none is in flight.
    await quiet()
    await startAgain.click()
    await waitOpen(page)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await expect(page.locator(PART)).toHaveAttribute('data-seq', '0')
    await expect
      .poll(() => storedStory(page, 'two-paths'), 'the stored story after Start this story again')
      .toMatchObject({ activeRun: null, endingsFound: ['ending_wise'] })
  })
})

// ---------------------------------------------------------------------------------------------
// Step 10b (design §4.1, §4.3, §4.6 hooks)

const FOOTER = 'footer[data-part-controls]'
const MENU = 'header button[data-menu]'
const PANEL = '#player-menu'
const MENU_RESTART = '#player-menu button[data-restart]'
const KEEP_READING = `${DIALOG} button[data-keep-reading]`
const RESTART_ACCEPT = `${DIALOG} button[data-restart-accept]`
const PROGRESS = 'header [role="progressbar"][data-segments]'
/** A computed background-color with no fill, on both engines. */
const NO_FILL = 'rgba(0, 0, 0, 0)'
/** Chromium's layout unit (1/64 px): the largest difference between equal flex items' boxes. */
const LAYOUT_UNIT = 1 / 64

/** Back, in the part on screen or in the part of `node`. */
function back(node?: string): string {
  return `${node === undefined ? PART : `[data-part][data-node="${node}"]`} button[data-back]`
}

/** One of the menu panel's text-size radios. */
function textSize(scale: 100 | 125 | 150): string {
  return `${PANEL} input[name="text-size"][value="${scale}"]`
}

/** Waits until the run footer on screen is no longer inert (the settle after a step has ended). */
async function waitBackSettled(page: Page): Promise<void> {
  await expect(page.locator(FOOTER)).not.toHaveAttribute('inert')
}

/** The textScale of the stored prefs record (seedPrefs's reader), or what that reader returned. */
async function storedTextScale(page: Page): Promise<unknown> {
  const { stored } = await storageAfter(page)
  if (typeof stored !== 'string') return stored
  return (JSON.parse(stored) as { textScale?: unknown }).textScale
}

interface TapTimes {
  readonly commitAt: number | null
  readonly downs: readonly { t: number; node: string | null; hit: boolean }[]
}

/**
 * In the page (F4), for T-b2: the time the part of `seq` commits (a MutationObserver), and for
 * every pointerdown (capture phase on document) its time and whether the box of a `target`
 * element holds the pointer, inert or not, with that element's part.
 */
async function watchTaps(page: Page, seq: number, target: string): Promise<void> {
  await page.evaluate(
    ([wantedSeq, wanted]) => {
      const record: {
        commitAt: number | null
        downs: { t: number; node: string | null; hit: boolean }[]
      } = { commitAt: null, downs: [] }
      ;(window as unknown as Record<string, unknown>)['__e2eTaps'] = record
      const observer = new MutationObserver(() => {
        if (record.commitAt !== null) return
        if (document.querySelector(`[data-part][data-seq="${wantedSeq}"]`) === null) return
        record.commitAt = performance.now()
        observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      document.addEventListener(
        'pointerdown',
        (event) => {
          const element = [...document.querySelectorAll(wanted)].find((candidate) => {
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
            node: element?.closest('[data-part]')?.getAttribute('data-node') ?? null,
            hit: element !== undefined,
          })
        },
        { capture: true },
      )
    },
    [seq, target] as const,
  )
}

interface SettleTap {
  readonly commitAt: number | null
  readonly downs: readonly {
    t: number
    onRestart: boolean
    node: string | null
    runInert: boolean | null
  }[]
}

/**
 * In the page, for the T-b4 settle case (review FB-1): the time the part of `seq` commits, and
 * for every click (capture phase on document; the action runs on the click) its time, whether it
 * is on the menu's Start again, the part on screen and whether that part's choices are inert (the
 * settle) at that moment.
 */
async function watchSettleTap(page: Page, seq: number): Promise<void> {
  await page.evaluate(
    ([wantedSeq, restart, choices]) => {
      const record: SettleTap & {
        commitAt: number | null
        downs: SettleTap['downs'][number][]
      } = { commitAt: null, downs: [] }
      ;(window as unknown as Record<string, unknown>)['__e2eSettleTap'] = record
      const observer = new MutationObserver(() => {
        if (record.commitAt !== null) return
        if (document.querySelector(`[data-part][data-seq="${wantedSeq}"]`) === null) return
        record.commitAt = performance.now()
        observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      document.addEventListener(
        'click',
        (event) => {
          const target = event.target instanceof Element ? event.target : null
          record.downs.push({
            t: performance.now(),
            onRestart: target?.closest(restart) !== null && target !== null,
            node: document.querySelector('[data-part]')?.getAttribute('data-node') ?? null,
            runInert: document.querySelector(choices)?.hasAttribute('inert') ?? null,
          })
        },
        { capture: true },
      )
    },
    [seq, MENU_RESTART, `[data-part] ${CHOICES}`] as const,
  )
}

interface HoldTap {
  readonly t: number
  /** The run-area control whose box holds the pointer, inert or not: a choice id or 'back'. */
  readonly control: string | null
  /** The pointerdown's target (hit testing skips inert elements). */
  readonly target: string
  /** The pointerdown's target is the menu's Start again or inside it. */
  readonly onStartAgain: boolean
  /**
   * Every interactive element whose box holds the pointer, inert or not, header and dialog
   * included (the 10d fix: a run-area-only list missed the menu's Start again on webkit-iphone).
   */
  readonly under: readonly string[]
  /**
   * The elements of `under` that are none of a run-area control (a choice, Back), an element of
   * the dialog or the menu's Start again: T-b10 expects none (a layout drift that puts a text-size
   * radio, the story-language switch, Menu or a nav link under the tap fails).
   */
  readonly stray: readonly string[]
  readonly choicesInert: boolean | null
  readonly backInert: boolean | null
}

/** A keydown during T-b10's watch: Enter on the menu's Start again during the hold. */
interface HoldKey {
  readonly t: number
  readonly key: string
  /** The keydown's target (the focused element) is the menu's Start again or inside it. */
  readonly onStartAgain: boolean
  readonly choicesInert: boolean | null
}

interface HoldRecord {
  readonly closeAt: number | null
  readonly heldAt: number | null
  readonly releasedAt: number | null
  /** The first time the dialog was open again after the close, else null. */
  readonly reopenedAt: number | null
  readonly downs: readonly HoldTap[]
  readonly keys: readonly HoldKey[]
}

/** What T-b10's in-page watch reads before any tap. */
const NO_HOLD: HoldRecord = {
  closeAt: null,
  heldAt: null,
  releasedAt: null,
  reopenedAt: null,
  downs: [],
  keys: [],
}

/** T-b10: what counts as interactive under a tap, anywhere on the page. */
const INTERACTIVE =
  'a[href], button, input, select, textarea, label, summary, [tabindex]:not([tabindex="-1"])'

/**
 * In the page, for T-b10 (R2-STRESS-1): the time the restart dialog's close event is dispatched
 * (a capturing listener on document, so it runs before the dialog's own close handler and the
 * hold it starts); after that close, the times the run area's choices became inert (the hold) and
 * then lost inert again (the release), from a MutationObserver on the run area, and the first time
 * the dialog was open again (its open attribute); and for every pointerdown (capture phase on
 * document) its time, the run-area control whose box holds the pointer (inert or not, as T-b2
 * measures), every interactive element whose box holds it (header and dialog included) and those of
 * them that are none of a run-area control, the dialog's or the menu's Start again (stray), its
 * target and whether that is the menu's Start again, and whether the choices and Back are inert;
 * and for every keydown (capture phase on document) its time, its key, whether its target is the
 * menu's Start again and whether the choices are inert.
 */
async function watchHold(page: Page): Promise<void> {
  await page.evaluate(
    ([dialog, run, choices, footer, controls, interactive, restart]) => {
      const record: {
        closeAt: number | null
        heldAt: number | null
        releasedAt: number | null
        reopenedAt: number | null
        downs: HoldTap[]
        keys: HoldKey[]
      } = {
        closeAt: null,
        heldAt: null,
        releasedAt: null,
        reopenedAt: null,
        downs: [],
        keys: [],
      }
      ;(window as unknown as Record<string, unknown>)['__e2eHold'] = record
      const inertOf = (selector: string): boolean | null =>
        document.querySelector(selector)?.hasAttribute('inert') ?? null
      const holds = (element: Element, x: number, y: number): boolean => {
        const box = element.getBoundingClientRect()
        return (
          box.width > 0 &&
          box.height > 0 &&
          x >= box.left &&
          x <= box.right &&
          y >= box.top &&
          y <= box.bottom
        )
      }
      const dataNames = (element: Element): string =>
        [...element.attributes]
          .filter((attribute) => attribute.name.startsWith('data-'))
          .map((attribute) => `[${attribute.name}]`)
          .join('')
      // An input, or the input a label is for, by its type, group and value (a text-size radio).
      const inputOf = (element: Element): string => {
        const input = element instanceof HTMLLabelElement ? element.control : element
        if (!(input instanceof HTMLInputElement)) return ''
        const named = `[type="${input.type}"][name="${input.name}"][value="${input.value}"]`
        return input === element ? named : `>input${named}`
      }
      // Where it is, its tag, data attributes and input, its text, and (inert) when hit testing
      // skips it.
      const nameOf = (element: Element): string => {
        const where =
          element.closest(dialog) !== null
            ? 'dialog'
            : element.closest('header') !== null
              ? 'header'
              : element.closest(run) !== null
                ? 'run area'
                : 'page'
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
        const inert = element.closest('[inert]') !== null ? ' (inert)' : ''
        const tag = element.tagName.toLowerCase()
        return `${where} ${tag}${dataNames(element)}${inputOf(element)} "${text}"${inert}`
      }
      // What may lie under a tap during the hold: a run-area control (held: inert), an element of
      // the dialog, or the menu's Start again (ignored until the release).
      const allowed = (element: Element): boolean =>
        element.matches(controls) || element.closest(dialog) !== null || element.matches(restart)
      const dialogElement = document.querySelector(dialog)
      if (dialogElement === null) throw new Error(`no ${dialog}`)
      new MutationObserver(() => {
        if (record.closeAt === null || record.reopenedAt !== null) return
        if (dialogElement.hasAttribute('open')) record.reopenedAt = performance.now()
      }).observe(dialogElement, { attributes: true, attributeFilter: ['open'] })
      document.addEventListener(
        'close',
        (event) => {
          if (record.closeAt !== null) return
          if (event.target instanceof Element && event.target.matches(dialog)) {
            record.closeAt = performance.now()
          }
        },
        { capture: true },
      )
      const area = document.querySelector(run)
      if (area === null) throw new Error(`no ${run}`)
      new MutationObserver(() => {
        if (record.closeAt === null) return
        const inert = inertOf(choices)
        if (inert === true && record.heldAt === null) record.heldAt = performance.now()
        else if (inert === false && record.heldAt !== null && record.releasedAt === null) {
          record.releasedAt = performance.now()
        }
      }).observe(area, { attributes: true, attributeFilter: ['inert'], subtree: true })
      document.addEventListener(
        'pointerdown',
        (event) => {
          const x = event.clientX
          const y = event.clientY
          const control = [...document.querySelectorAll(controls)].find((candidate) => {
            const box = candidate.getBoundingClientRect()
            return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
          })
          const target = event.target instanceof Element ? event.target : null
          const under = [...document.querySelectorAll(interactive)].filter((element) =>
            holds(element, x, y),
          )
          record.downs.push({
            t: performance.now(),
            control: control === undefined ? null : (control.getAttribute('data-choice') ?? 'back'),
            target:
              target === null ? 'none' : `${target.tagName.toLowerCase()}${dataNames(target)}`,
            onStartAgain: (target?.closest(restart) ?? null) !== null,
            under: under.map(nameOf),
            stray: under.filter((element) => !allowed(element)).map(nameOf),
            choicesInert: inertOf(choices),
            backInert: inertOf(footer),
          })
        },
        { capture: true },
      )
      document.addEventListener(
        'keydown',
        (event) => {
          const target = event.target instanceof Element ? event.target : null
          record.keys.push({
            t: performance.now(),
            key: event.key,
            onStartAgain: (target?.closest(restart) ?? null) !== null,
            choicesInert: inertOf(choices),
          })
        },
        { capture: true },
      )
    },
    [
      DIALOG,
      RUN,
      `[data-part] ${CHOICES}`,
      FOOTER,
      `[data-part] button[data-choice], [data-part] button[data-back]`,
      INTERACTIVE,
      MENU_RESTART,
    ] as const,
  )
}

interface StartAgainUnder {
  readonly viewport: { readonly width: number; readonly height: number }
  readonly scrollY: number
  /** Keep reading's centre, where T-b10 taps (viewport coordinates). */
  readonly keep: { readonly x: number; readonly y: number }
  readonly restart: { left: number; right: number; top: number; bottom: number }
  /** The menu's Start again box holds Keep reading's centre. */
  readonly under: boolean
}

/**
 * For T-b10 over Start again, with the menu and the restart dialog open: scrolls the page (the
 * modal dialog stays where the browser centred it) so that the centre of the menu's Start again
 * lies at the height of Keep reading's centre, then measures whether Start again's box holds that
 * centre, where both taps land. Measured in the page, so it is the same on every project.
 */
async function putStartAgainUnderKeepReading(page: Page): Promise<StartAgainUnder> {
  return page.evaluate(
    ([keepSelector, restartSelector]) => {
      const keepElement = document.querySelector(keepSelector)
      const restartElement = document.querySelector(restartSelector)
      if (keepElement === null || restartElement === null) throw new Error('no Keep reading')
      const centreY = (box: DOMRect): number => box.top + box.height / 2
      const before = restartElement.getBoundingClientRect()
      const wanted = centreY(keepElement.getBoundingClientRect())
      window.scrollTo(0, window.scrollY + centreY(before) - wanted)
      const keepBox = keepElement.getBoundingClientRect()
      const box = restartElement.getBoundingClientRect()
      const keep = { x: keepBox.left + keepBox.width / 2, y: centreY(keepBox) }
      return {
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        scrollY: window.scrollY,
        keep,
        restart: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        under:
          keep.x >= box.left && keep.x <= box.right && keep.y >= box.top && keep.y <= box.bottom,
      }
    },
    [KEEP_READING, MENU_RESTART] as const,
  )
}

interface ControlBox {
  readonly name: string
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/** The border boxes of the elements `selector` matches (viewport coordinates), named by text. */
async function controlBoxes(page: Page, selector: string): Promise<ControlBox[]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect()
      return {
        name: (element.textContent ?? '').trim() || element.tagName.toLowerCase(),
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      }
    }),
  )
}

/**
 * Every box is laid out (not 0 x 0, so a hidden control never passes), lies inside `within`, and
 * overlaps no other box by more than half a pixel each way (the shell's 320 px rule).
 */
function expectLaidOutApart(
  boxes: readonly ControlBox[],
  within: { readonly left: number; readonly right: number },
  what: string,
): void {
  expect(boxes.length, `${what}: the controls`).toBeGreaterThan(0)
  for (const box of boxes) {
    expect(box.right - box.left > 0 && box.bottom - box.top > 0, `${box.name} laid out`).toBe(true)
    expect(box.left, `${what}: ${box.name} inside`).toBeGreaterThanOrEqual(within.left)
    expect(box.right, `${what}: ${box.name} inside`).toBeLessThanOrEqual(within.right)
  }
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      expect(
        overlapX > 0.5 && overlapY > 0.5,
        `${what}: ${a.name} and ${b.name} overlap (${overlapX.toFixed(1)} x ${overlapY.toFixed(1)} px)`,
      ).toBe(false)
    }
  }
}

/**
 * P1-4 T11: the RGB of the viewport at `point` (CSS pixels): a screenshot at CSS scale, decoded in
 * a blank page of the same context (no CSP there) through an Image and a canvas.
 */
async function pixelAt(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<number[]> {
  const png = await page.screenshot({ scale: 'css' })
  const blank = await page.context().newPage()
  try {
    return await blank.evaluate(
      async ({ data, x, y }) => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('no 2d context')
        context.drawImage(image, 0, 0)
        return [...context.getImageData(x, y, 1, 1).data].slice(0, 3)
      },
      { data: png.toString('base64'), x: point.x, y: point.y },
    )
  } finally {
    await blank.close()
  }
}

/** A computed 'rgb(r, g, b)' or 'rgba(r, g, b, a)' colour as [r, g, b]. */
function rgbOf(color: string): number[] {
  const match = /^rgba?\((\d+), (\d+), (\d+)/.exec(color)
  if (match === null) throw new Error(`not an rgb colour: ${color}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

test.describe('the story player, Step 10b', { tag: '@review' }, () => {
  for (const code of ENABLED_LOCALE_CODES) {
    test(`T-b1 /${code}: Back is absent at the start, shown after a choice, and goes back one node`, async ({
      page,
    }) => {
      const lang = uiLang(code)
      await recordAnnouncements(page)
      await openPlayer(page, playerPath(code, 'river-stones'))
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
      await expect(page.locator(FOOTER), 'the run footer at the start').toHaveCount(0)
      await expect(page.locator('button[data-back]'), 'Back at the start').toHaveCount(0)

      await walk(page, 'river-stones', ['c1'])
      const backButton = page.locator(back('flat_stones'))
      await expect(backButton, 'Back after a choice').toHaveCount(1)
      await expect(backButton).toHaveText(message(lang, 'player.back'))
      await expect(backButton).toHaveAttribute('data-seq', '1')
      expect(
        await page.locator(FOOTER).evaluate((footer) => ({
          inStory: footer.closest('[data-story]') !== null,
          lang: footer.closest('[lang]')?.getAttribute('lang') ?? null,
        })),
        'the run footer, outside the story container, in the page language (§4.1)',
      ).toEqual({ inStory: false, lang: code })
      await waitBackSettled(page)
      await backButton.click()

      await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
      await expect(page.locator(PART)).toHaveAttribute('data-seq', '2')
      await expectPart(page, fixtureGraph('river-stones'), code, 'start')
      await expect(page.locator('button[data-back]'), 'Back at the start again').toHaveCount(0)
      await expect(page.locator(FIRST_PARAGRAPH).first(), 'focus after Back').toBeFocused()
      await expect(page.locator('#live-region')).toHaveText(
        formatted(lang, 'player.page', { n: 1 }),
      )
      expect(await announcements(page), 'announced').toEqual([
        formatted(lang, 'player.page', { n: 2 }),
        formatted(lang, 'player.page', { n: 1 }),
      ])
      await expect
        .poll(() => storedStory(page, 'river-stones'), 'the stored story back at the start')
        .toMatchObject({ activeRun: null })
    })
  }

  test('T-b2 a double tap on Back goes back one node only: big_rock to flat_stones, stored path 2', async ({
    page,
  }) => {
    const firstBack = back('big_rock')
    const nextBack = back('flat_stones')
    await openPlayer(page, playerPath('en', 'river-stones'))
    await settleFonts(page)
    await walk(page, 'river-stones', ['c1', 'c1'])
    await waitBackSettled(page)
    // One real Back first: where flat_stones' Back sits after the commit and its header scroll.
    await page.locator(firstBack).click()
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await frames(page)
    const second = await boxOf(page, nextBack)
    // Then forward to big_rock again: that step scrolls the header to the top, as the first did.
    await walk(page, 'river-stones', ['c1'])
    await waitBackSettled(page)
    await frames(page)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'big_rock')
    const seq = Number(await page.locator(PART).getAttribute('data-seq'))
    const point = await sharedPoint(page, await boxOf(page, firstBack), second)

    await watchTaps(page, seq + 1, '[data-part] button[data-back]')
    const notes: string[] = []
    if (point.usable) {
      notes.push(`double tap at ${Math.round(point.x)},${Math.round(point.y)}`)
      await page.mouse.dblclick(point.x, point.y, { delay: 100 })
    } else {
      notes.push('geometry fallback')
      const tap = await centreInViewport(page, firstBack)
      await page.mouse.click(tap.x, tap.y)
      await page.locator(nextBack).waitFor({ state: 'attached' })
      const again = await centreInViewport(page, nextBack)
      if (again.scrolled) notes.push('scrolled')
      await page.mouse.click(again.x, again.y)
    }
    await page.waitForTimeout(800)
    const taps = await pageValue<TapTimes>(page, '__e2eTaps')
    const secondDown = taps.downs[1]
    const late =
      taps.commitAt === null || secondDown === undefined ? null : secondDown.t - taps.commitAt
    notes.push(`second tap ${late === null ? 'never' : `${late.toFixed(0)} ms`} after the commit`)
    test.info().annotations.push({ type: 'T-b2', description: notes.join('; ') })
    console.log(`[player] T-b2 (${test.info().project.name}): ${notes.join('; ')}`)

    expect(
      taps.downs.map((down) => [down.node, down.hit]),
      "the taps: big_rock's Back, then the new part's Back",
    ).toEqual([
      ['big_rock', true],
      ['flat_stones', true],
    ])
    expect(late, 'the commit and second-tap times').not.toBeNull()
    expect(
      (late ?? Number.POSITIVE_INFINITY) < LATE_TAP_MS,
      `timing: the second tap came ${late} ms after the commit (450 ms or more proves nothing)`,
    ).toBe(true)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await expect(page.locator(PART)).toHaveAttribute('data-seq', String(seq + 1))
    await expect.poll(() => storedPath(page, 'river-stones')).toEqual(['start', 'flat_stones'])
  })

  test('T-b3 Start again at big_rock (path 3) asks first: Escape keeps the node; confirming starts a new run, endings kept', async ({
    page,
  }) => {
    await seedProgressOnce(page, {
      'river-stones': {
        activeRun: { path: ['start', 'flat_stones', 'big_rock'], locale: 'en' },
        endingsFound: ['ending_wet'],
      },
    })
    await recordAnnouncements(page)
    await openPlayer(page, playerPath('en', 'river-stones'))
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'big_rock')
    await expect(page.locator(RUN)).toHaveAttribute('data-epoch', '0')
    const seq = (await page.locator(PART).getAttribute('data-seq')) ?? ''
    await page.evaluate((selector) => {
      const w = window as unknown as Record<string, unknown>
      w['__e2eRunArea'] = document.querySelector(selector)
    }, RUN)
    const dialog = page.locator(DIALOG)
    await expect(dialog, 'the dialog at load').toHaveJSProperty('open', false)

    await page.locator(MENU).click()
    await page.locator(MENU_RESTART).click()
    await expect(dialog, 'the dialog after Start again').toHaveJSProperty('open', true)
    await expect(dialog).toHaveAccessibleName(message('en', 'player.restartQuestion'))
    await expect(dialog.locator('button')).toHaveText([
      message('en', 'player.keepReading'),
      message('en', 'player.restart'),
    ])
    await expect(page.locator(KEEP_READING), 'the safe default has focus').toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog, 'the dialog after Escape').toHaveJSProperty('open', false)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'big_rock')
    await expect(page.locator(PART)).toHaveAttribute('data-seq', seq)
    await expect(page.locator(RUN)).toHaveAttribute('data-epoch', '0')
    expect(await storedPath(page, 'river-stones'), 'the stored run after Escape').toEqual([
      'start',
      'flat_stones',
      'big_rock',
    ])
    expect(await announcements(page), 'announced after Escape').toEqual([])

    // The cancel held the run area, and the menu's Start again with it, for SETTLE_MS (T-b10).
    await waitSettled(page)
    await page.locator(MENU_RESTART).click()
    await expect(dialog, 'the dialog after Start again').toHaveJSProperty('open', true)
    await page.locator(RESTART_ACCEPT).click()
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await expect(page.locator(RUN)).toHaveAttribute('data-epoch', '1')
    await expect(dialog, 'the dialog after confirming').toHaveJSProperty('open', false)
    expect(
      await page.evaluate(
        () =>
          ((window as unknown as Record<string, unknown>)['__e2eRunArea'] as Element).isConnected,
      ),
      'the old run area is connected (the run area is keyed by runEpoch)',
    ).toBe(false)
    await expectPart(page, fixtureGraph('river-stones'), 'en', 'start')
    await expect(page.locator(FIRST_PARAGRAPH).first(), 'focus after the restart').toBeFocused()
    await expect(page.locator('#live-region')).toHaveText(formatted('en', 'player.page', { n: 1 }))
    expect(await announcements(page), 'announced').toEqual([
      formatted('en', 'player.page', { n: 1 }),
    ])
    await expect
      .poll(() => storedStory(page, 'river-stones'), 'the stored story after the restart')
      .toMatchObject({ activeRun: null, endingsFound: ['ending_wet'] })
  })

  const AT_ONCE = [
    {
      name: 'at path 2 (river-stones, a resumed flat_stones)',
      storyId: 'river-stones',
      seed: ['start', 'flat_stones'],
      walk: [],
      node: 'flat_stones',
    },
    {
      name: 'at an ending with path 3 (lantern-walk ending_light)',
      storyId: 'lantern-walk',
      seed: null,
      walk: ['c1', 'c1'],
      node: 'ending_light',
    },
  ] as const
  for (const at of AT_ONCE) {
    test(`T-b4 ${at.name}: Start again restarts at once, with no dialog`, async ({ page }) => {
      if (at.seed !== null) {
        await seedProgressOnce(page, {
          [at.storyId]: { activeRun: { path: at.seed, locale: 'en' } },
        })
      }
      await recordAnnouncements(page)
      await openPlayer(page, playerPath('en', at.storyId))
      if (at.walk.length > 0) await walk(page, at.storyId, at.walk)
      await expect(page.locator(PART)).toHaveAttribute('data-node', at.node)
      const epoch = Number(await page.locator(RUN).getAttribute('data-epoch'))
      await watchDialogOpen(page)

      await page.locator(MENU).click()
      await page.locator(MENU_RESTART).click()
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
      await expect(page.locator(RUN)).toHaveAttribute('data-epoch', String(epoch + 1))
      await expect(page.locator(DIALOG)).toHaveJSProperty('open', false)
      expect(await pageValue(page, '__e2eDialogOpened'), 'the dialog ever opened').toBe(false)
      await expect(page.locator(MENU), 'the menu after the restart').toHaveAttribute(
        'aria-expanded',
        'false',
      )
      await expect(page.locator(PANEL)).toBeHidden()
      await expect(page.locator(FIRST_PARAGRAPH).first(), 'focus after the restart').toBeFocused()
      await expect(page.locator('#live-region')).toHaveText(
        formatted('en', 'player.page', { n: 1 }),
      )
    })
  }

  // Review FB-1: the menu's Start again is a header control, never held by the run area's settle
  // (D11-P7; the lead's decision). The page records that the run area was still settling (its
  // choices inert) when Start again was tapped, so a pass never depends on how fast the runner is.
  test('T-b4 inside the settle: a step to path 2, then Start again at once restarts, with no dialog', async ({
    page,
  }) => {
    await recordAnnouncements(page)
    // A Start again tap that lands after the settle proves nothing (the restart is then allowed
    // anyway), so a late tap is retried from a fresh open, at most 3 attempts in all; the run area's
    // inert state is read at the click, when the action runs.
    let tap: SettleTap['downs'][number] | undefined
    let commitAt: number | null = null
    const notes: string[] = []
    for (let attempt = 1; ; attempt++) {
      await openPlayer(page, playerPath('en', 'river-stones'))
      await waitSettled(page)
      await page.locator(MENU).click()
      await expect(page.locator(PANEL)).toBeVisible()
      await watchDialogOpen(page)
      await watchSettleTap(page, 1)
      // The step commits inside its click; Start again is tapped straight after, while flat_stones
      // settles for SETTLE_MS. Both are mouse clicks at a centre measured in the page (F4: scrolled
      // into view by evaluate when outside the viewport), Start again's after the step's header
      // scroll, with no actionability wait (a locator click took 270-300 ms of the 500 in WebKit).
      const c1 = await centreInViewport(page, choice('c1'))
      await page.mouse.click(c1.x, c1.y)
      const restart = await centreInViewport(page, MENU_RESTART)
      await page.mouse.click(restart.x, restart.y)
      const taps = await pageValue<SettleTap>(page, '__e2eSettleTap')
      tap = taps.downs.find((down) => down.onRestart)
      commitAt = taps.commitAt
      notes.push(
        `attempt ${attempt}: Start again ${taps.commitAt === null || tap === undefined ? 'never' : `${(tap.t - taps.commitAt).toFixed(0)} ms`} after the commit${c1.scrolled || restart.scrolled ? '; scrolled' : ''}`,
      )
      if (tap?.runInert !== false || attempt === 3) break
    }
    test.info().annotations.push({ type: 'T-b4 settle', description: notes.join('; ') })
    console.log(`[player] T-b4 settle (${test.info().project.name}): ${notes.join('; ')}`)
    expect(commitAt, 'the step to flat_stones committed').not.toBeNull()
    expect(tap, 'a tap on Start again').toBeDefined()
    expect(tap?.node, 'the part on screen when Start again was tapped').toBe('flat_stones')
    expect(
      tap?.runInert,
      'timing: the run area had settled before Start again was tapped, 3 times, which proves nothing',
    ).toBe(true)

    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await expect(page.locator(RUN)).toHaveAttribute('data-epoch', '1')
    expect(await pageValue(page, '__e2eDialogOpened'), 'the dialog ever opened').toBe(false)
    await expect(page.locator(MENU), 'the menu after the restart').toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(page.locator(PANEL)).toBeHidden()
    await expect(page.locator(FIRST_PARAGRAPH).first(), 'focus after the restart').toBeFocused()
    await expect(page.locator('#live-region')).toHaveText(formatted('en', 'player.page', { n: 1 }))
    expect(await announcements(page), 'announced').toEqual([
      formatted('en', 'player.page', { n: 2 }),
      formatted('en', 'player.page', { n: 1 }),
    ])
  })

  // Review PIF-7: the T-b5 cases come from endingsOf(); this pins the list by hand, so a helper
  // that drops an ending fails here instead of silently running fewer cases.
  test('T-b5 the scan: every ending of the 3 fixtures (7, 4 of them alternates) in en and hi', () => {
    expect(
      playerPaths().flatMap(({ path, storyId }) =>
        endingsOf(fixtureGraph(storyId)).map((ending) => `${path} ${ending}`),
      ),
    ).toEqual([
      '/en/stories/lantern-walk/read ending_light',
      '/en/stories/lantern-walk/read ending_shadow',
      '/hi/stories/lantern-walk/read ending_light',
      '/hi/stories/lantern-walk/read ending_shadow',
      '/en/stories/river-stones/read ending_dry',
      '/en/stories/river-stones/read ending_wet',
      '/en/stories/river-stones/read ending_back',
      '/hi/stories/river-stones/read ending_dry',
      '/hi/stories/river-stones/read ending_wet',
      '/hi/stories/river-stones/read ending_back',
      '/en/stories/two-paths/read ending_wise',
      '/en/stories/two-paths/read ending_quick',
      '/hi/stories/two-paths/read ending_wise',
      '/hi/stories/two-paths/read ending_quick',
    ])
  })

  for (const { path: url, code, storyId } of playerPaths()) {
    const graph = fixtureGraph(storyId)
    for (const ending of endingsOf(graph)) {
      test(`T-b5 ${url} ${ending}: every segment is filled and aria-valuenow is the total`, async ({
        page,
      }) => {
        const lang = uiLang(code)
        const total = graph.progressSteps.length
        const bar = page.locator(PROGRESS)
        const segments = () =>
          bar
            .locator('span')
            .evaluateAll((spans) =>
              spans.map((span) => [
                span.hasAttribute('data-filled'),
                span.getAttribute('aria-hidden'),
              ]),
            )
        await openPlayer(page, url)
        await expect(bar).toHaveAttribute('aria-label', message(lang, 'player.progress'))
        await expect(bar).toHaveAttribute('aria-valuemin', '0')
        await expect(bar).toHaveAttribute('aria-valuemax', String(total))
        await expect(bar, 'at the start').toHaveAttribute(
          'aria-valuenow',
          String(graph.progressSteps.includes(graph.startNodeId) ? 1 : 0),
        )

        await walk(page, storyId, pathTo(graph, ending))
        await expectPart(page, graph, code, ending)
        await expect(bar, `at ${ending}`).toHaveAttribute('aria-valuenow', String(total))
        await expect(bar).toHaveAttribute('aria-valuemax', String(total))
        await expect(bar).toHaveAttribute(
          'aria-valuetext',
          formatted(lang, 'player.progressValue', { filled: total, total }),
        )
        expect(await segments(), `the segments at ${ending}`).toEqual(
          Array.from({ length: total }, () => [true, 'true']),
        )
      })
    }
  }

  test('T-b6 an empty segment is an outline with no fill, a filled one is filled, and both keep one box', async ({
    page,
    browserName,
  }) => {
    const total = fixtureGraph('river-stones').progressSteps.length
    const look = () =>
      page.locator(PROGRESS).evaluate((bar) =>
        [...bar.querySelectorAll('span')].map((span) => {
          const style = getComputedStyle(span)
          const box = span.getBoundingClientRect()
          return {
            filled: span.hasAttribute('data-filled'),
            background: style.backgroundColor,
            border: `${style.borderTopWidth} ${style.borderTopStyle}`,
            borderColor: style.borderTopColor,
            width: box.width,
            height: box.height,
          }
        }),
      )
    await openPlayer(page, playerPath('en', 'river-stones'))
    await settleFonts(page)
    const before = await look()
    console.log(`[player] T-b6 (${test.info().project.name}): ${JSON.stringify(before)}`)
    expect(
      before.map((segment) => segment.filled),
      'filled at the start',
    ).toEqual(Array.from({ length: total }, (_, index) => index === 0))
    const [filled, ...empty] = before
    const [firstEmpty] = empty
    if (filled === undefined || firstEmpty === undefined) throw new Error('too few segments')
    for (const [index, segment] of empty.entries()) {
      const name = `empty segment ${index + 2}`
      expect(segment.background, `${name}: no fill`).toBe(NO_FILL)
      expect(segment.border, `${name}: an outline`).toBe('2px solid')
      expect(segment.borderColor, `${name}: the outline colour`).toBe(firstEmpty.borderColor)
    }
    expect(filled.background, 'the filled segment has a fill').not.toBe(NO_FILL)
    expect(filled.background, 'filled and empty backgrounds').not.toBe(firstEmpty.background)
    expect(filled.background, 'the fill and its border are one colour').toBe(filled.borderColor)
    expect(filled.borderColor, 'filled and empty borders').not.toBe(firstEmpty.borderColor)
    expect(filled.border, 'the same border box when filled').toBe(firstEmpty.border)
    // Equal flex items may differ by one layout unit: Chromium lays out in 1/64 px and hands the
    // remainder to some of them (measured: 54.6875 and 54.703125 on chromium-phone).
    for (const [index, segment] of before.entries()) {
      expect(
        Math.abs(segment.width - filled.width),
        `segment ${index + 1} width`,
      ).toBeLessThanOrEqual(LAYOUT_UNIT)
      expect(
        Math.abs(segment.height - filled.height),
        `segment ${index + 1} height`,
      ).toBeLessThanOrEqual(LAYOUT_UNIT)
    }

    // A step fills the second segment: the same box, now filled.
    await walk(page, 'river-stones', ['c1'])
    await frames(page)
    const after = await look()
    expect(
      after.map((segment) => segment.filled),
      'filled at flat_stones',
    ).toEqual(Array.from({ length: total }, (_, index) => index < 2))
    const [, nowFilled] = after
    const [, wasEmpty] = before
    if (nowFilled === undefined || wasEmpty === undefined) throw new Error('too few segments')
    expect(nowFilled.background, 'the second segment, filled').toBe(filled.background)
    expect(
      Math.abs(nowFilled.width - wasEmpty.width),
      'its width, empty then filled',
    ).toBeLessThanOrEqual(LAYOUT_UNIT)
    expect(
      Math.abs(nowFilled.height - wasEmpty.height),
      'its height, empty then filled',
    ).toBeLessThanOrEqual(LAYOUT_UNIT)

    // Forced colours (Windows High Contrast; review A11Y-2): the browser forces backgrounds to
    // Canvas, so only the forced-colors rule keeps a filled segment filled. Chromium emulates the
    // mode; Playwright's WebKit does not.
    if (browserName === 'chromium') {
      await page.emulateMedia({ forcedColors: 'active' })
      expect(
        await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
        'forced colours emulated',
      ).toBe(true)
      const forced = await look()
      // The page background is on <html> (base.css); forced colours make it the Canvas colour.
      const canvas = await page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      )
      console.log(
        `[player] T-b6 forced colours (${test.info().project.name}): canvas ${canvas}; ` +
          JSON.stringify(
            forced.map(({ filled, background, borderColor }) => [filled, background, borderColor]),
          ),
      )
      const [forcedFilled, , forcedEmpty] = forced
      if (forcedFilled === undefined || forcedEmpty === undefined) {
        throw new Error('too few segments')
      }
      expect([forcedFilled.filled, forcedEmpty.filled], 'forced colours: filled, empty').toEqual([
        true,
        false,
      ])
      expect(forcedFilled.background, 'forced colours: the fill is its border colour').toBe(
        forcedFilled.borderColor,
      )
      expect(forcedFilled.background, 'forced colours: the fill is not the canvas').not.toBe(canvas)
      expect(forcedEmpty.background, 'forced colours: an empty segment has no fill').toMatch(
        /^rgba\(.*,\s*0\)$/,
      )
      expect(forcedEmpty.border, 'forced colours: an empty segment is an outline').toBe('2px solid')
      expect(forcedEmpty.borderColor, 'forced colours: the outline colour').toBe(
        forcedFilled.borderColor,
      )
    }
  })

  test('T-b7 text size: 150 is applied and saved, kept before paint on reload; another tab syncs; 100 removes it', async ({
    page,
    context,
    browserName,
    errors,
  }) => {
    const url = playerPath('en', 'two-paths')
    const html = page.locator('html')
    await seedPrefs(page, null)
    await openPlayer(page, url)
    const quiet = quietRequests(page)
    await expect(html, 'nothing stored').not.toHaveAttribute(TEXT_SCALE_ATTRIBUTE)
    await page.locator(MENU).click()
    await expect(page.locator(`${PANEL} label`)).toHaveText(
      [100, 125, 150].map((percent) => formatted('en', 'player.textSizeOption', { percent })),
    )
    await expect(page.locator(textSize(100)), 'nothing stored').toBeChecked()
    const writesBefore = (await storageAfter(page)).writes.length
    await page.locator(textSize(150)).check()
    await expect(html).toHaveAttribute(TEXT_SCALE_ATTRIBUTE, '150')
    expect((await storageAfter(page)).writes.slice(writesBefore), 'writes for 150').toEqual([
      'setItem',
    ])
    expect(await storedTextScale(page), 'the stored text size').toBe(150)

    // A reload: the boot script sets 150 before the body exists, and hydration keeps it. The
    // reload waits until no request is in flight (WebKit, see T-a4).
    await watchScaleAttribute(page)
    // Every change of the attribute from document start (review PIF-2): the boot script's set is
    // the only one, so hydration never applies the hydration snapshot, not even for a moment
    // (D11-P20). Each entry is the value before the change.
    await page.addInitScript((attribute) => {
      const before: (string | null)[] = []
      ;(window as unknown as Record<string, unknown>)['__e2eScaleChanges'] = before
      new MutationObserver((records) => {
        for (const record of records) before.push(record.oldValue)
      }).observe(document, {
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: [attribute],
      })
    }, TEXT_SCALE_ATTRIBUTE)
    await quiet()
    await page.reload()
    await waitOpen(page)
    await frames(page)
    const seen = await scaleSeen(page)
    expect(seen?.value, 'the attribute when it first appeared').toBe('150')
    expect(seen?.bodyWasNull, 'document.body when it first appeared').toBe(true)
    if (browserName === 'chromium') {
      expect(seen?.paintEntries, 'paint entries when it first appeared').toBe(0)
    }
    await expect(html, 'after hydration').toHaveAttribute(TEXT_SCALE_ATTRIBUTE, '150')
    expect(
      await pageValue(page, '__e2eScaleChanges'),
      'changes of the attribute on the reload: only the boot script set it',
    ).toEqual([null])
    expect((await storageAfter(page)).writes, 'writes on the reload').toEqual([])
    await page.locator(MENU).click()
    await expect(page.locator(textSize(150)), 'after the reload').toBeChecked()

    // Another tab chooses 125: this tab follows.
    const other = await context.newPage()
    errors.watch(other)
    await openPlayer(other, url)
    await expect(other.locator('html')).toHaveAttribute(TEXT_SCALE_ATTRIBUTE, '150')
    await other.locator(MENU).click()
    await other.locator(textSize(125)).check()
    await expect(other.locator('html')).toHaveAttribute(TEXT_SCALE_ATTRIBUTE, '125')
    await expect(html, 'after the other tab chose 125').toHaveAttribute(TEXT_SCALE_ATTRIBUTE, '125')
    await expect(page.locator(textSize(125)), 'after the other tab chose 125').toBeChecked()

    // 100 removes the attribute.
    await page.locator(textSize(100)).check()
    await expect(html, 'after 100').not.toHaveAttribute(TEXT_SCALE_ATTRIBUTE)
    expect(await storedTextScale(page), 'the stored text size').toBe(100)
  })

  test("T-b8 the menu: aria-expanded toggles; Escape returns focus to Menu; the dialog's Escape leaves it open on Start again; an accepted Start again closes it", async ({
    page,
  }) => {
    await seedProgressOnce(page, {
      'river-stones': { activeRun: { path: ['start', 'flat_stones', 'big_rock'], locale: 'en' } },
    })
    await openPlayer(page, playerPath('en', 'river-stones'))
    const menu = page.locator(MENU)
    const panel = page.locator(PANEL)
    const dialog = page.locator(DIALOG)
    await expect(menu).toHaveText(message('en', 'player.menu'))
    await expect(menu).toHaveAttribute('aria-controls', 'player-menu')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toBeHidden()

    // A click toggles it.
    await menu.click()
    await expect(menu).toHaveAttribute('aria-expanded', 'true')
    await expect(panel).toBeVisible()
    await menu.click()
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toBeHidden()

    // Opened by a click, Escape closes it too (review FB-2): a click does not focus a button in
    // WebKit, so the Menu button focuses itself and gets the Escape its handler takes (F6).
    await menu.click()
    await expect(menu).toHaveAttribute('aria-expanded', 'true')
    await expect(menu, 'focus after a click on Menu').toBeFocused()
    console.log(
      `[player] T-b8 (${test.info().project.name}): Menu :focus-visible after a click: ` +
        `${await menu.evaluate((element) => element.matches(':focus-visible'))}`,
    )
    await page.keyboard.press('Escape')
    await expect(menu, 'after Escape, opened by a click').toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toBeHidden()
    await expect(menu, 'focus after Escape, opened by a click').toBeFocused()

    // Escape in the panel closes it and returns focus to Menu; so does Escape on Menu itself.
    await menu.focus()
    await page.keyboard.press('Enter')
    await expect(menu, 'opened by Enter').toHaveAttribute('aria-expanded', 'true')
    await page.locator(textSize(100)).focus()
    await page.keyboard.press('Escape')
    await expect(menu, 'after Escape in the panel').toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toBeHidden()
    await expect(menu, 'focus after Escape in the panel').toBeFocused()
    await page.keyboard.press('Enter')
    await expect(menu, 'opened by Enter').toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(menu, 'after Escape on Menu').toHaveAttribute('aria-expanded', 'false')
    await expect(menu, 'focus after Escape on Menu').toBeFocused()

    // C13, F6: the dialog's Escape (and Keep reading) close the dialog only. The menu stays open
    // with focus on its Start again, and the run stays where it was.
    await menu.click()
    await expect(panel).toBeVisible()
    for (const close of ['Escape', 'Keep reading'] as const) {
      await page.locator(MENU_RESTART).click()
      await expect(dialog, 'the dialog after Start again').toHaveJSProperty('open', true)
      await expect(page.locator(KEEP_READING)).toBeFocused()
      if (close === 'Escape') await page.keyboard.press('Escape')
      else await page.locator(KEEP_READING).click()
      await expect(dialog, `the dialog after ${close}`).toHaveJSProperty('open', false)
      await expect(menu, `the menu after ${close} in the dialog`).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      await expect(panel, `the panel after ${close} in the dialog`).toBeVisible()
      await expect(page.locator(MENU_RESTART), `focus after ${close} in the dialog`).toBeFocused()
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'big_rock')
      // The cancel holds the run area, and the menu's Start again with it, for SETTLE_MS (T-b10).
      await waitSettled(page)
    }

    // An accepted Start again closes the menu.
    await page.locator(MENU_RESTART).click()
    await expect(dialog).toHaveJSProperty('open', true)
    await page.locator(RESTART_ACCEPT).click()
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await expect(page.locator(RUN)).toHaveAttribute('data-epoch', '1')
    await expect(menu, 'the menu after an accepted Start again').toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(panel).toBeHidden()
    await expect(page.locator(FIRST_PARAGRAPH).first(), 'focus after the restart').toBeFocused()
  })

  // Second review R2-STRESS-2: the Menu button focuses itself on a click (FB-2), and that focus
  // must not scroll the page under the finger when Menu is partly above the viewport. As on iOS
  // Safari, a tap never focuses the button here (a capturing mousedown preventDefault, a no-op in
  // WebKit, which never focuses a clicked button), so the onClick's focus() is the only one.
  test('T-b8 a tap on Menu partly scrolled above the viewport opens it without scrolling the page', async ({
    page,
  }) => {
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('the project sets no viewport')
    // A short viewport and 150%, so the page scrolls past the top of Menu on every project.
    await page.setViewportSize({ width: viewport.width, height: 420 })
    await seedPrefs(page, prefsText(150))
    await openPlayer(page, playerPath('en', 'river-stones'))
    await settleFonts(page)
    const menu = page.locator(MENU)
    const tap = await menu.evaluate((element) => {
      element.addEventListener('mousedown', (event) => event.preventDefault(), { capture: true })
      const start = element.getBoundingClientRect()
      window.scrollTo(0, start.top + window.scrollY + start.height * 0.6)
      const box = element.getBoundingClientRect()
      const x = box.left + box.width / 2
      const y = box.bottom / 2
      return {
        x,
        y,
        top: box.top,
        bottom: box.bottom,
        scrollY: window.scrollY,
        hit: element.contains(document.elementFromPoint(x, y)),
      }
    })
    console.log(`[player] T-b8 scroll (${test.info().project.name}): ${JSON.stringify(tap)}`)
    expect(tap.top, 'precondition: Menu starts above the viewport').toBeLessThan(0)
    expect(tap.bottom, 'precondition: a strip of Menu is still visible').toBeGreaterThan(8)
    expect(tap.hit, 'precondition: the tap point is on Menu').toBe(true)

    await page.mouse.click(tap.x, tap.y)
    await expect(menu).toHaveAttribute('aria-expanded', 'true')
    await expect(menu, 'focus after a tap on Menu').toBeFocused()
    await frames(page)
    expect(
      await page.evaluate(() => window.scrollY),
      'the page scrolled when Menu was tapped',
    ).toBe(tap.scrollY)
  })

  // P1-4 owner screens (design p1-4-polish-design.md R3, T11; D11-P11): the page behind the open
  // restart dialog dims to the page's canvas colour at 0.7, with no motion, and the menu stays open
  // behind it (C13; only an accepted Start again closes it, T-b8). The dim is read from screenshot
  // pixels as well, so a backdrop that computes right but paints nothing fails. Forced colours
  // (Chromium only: Playwright's WebKit ignores the emulation) force the backdrop to Canvas, the
  // colour of html's forced background (as T-b6 reads it). Each emulation is set before the page
  // opens, so before the menu and the dialog.
  for (const mode of ['plain', 'forced colours', 'reduced motion'] as const) {
    test(`T11 the restart dialog dims the page behind it; the menu stays open behind (${mode})`, async ({
      page,
      browserName,
    }) => {
      test.skip(
        mode === 'forced colours' && browserName !== 'chromium',
        "Playwright's WebKit ignores the forced-colours emulation",
      )
      if (mode === 'forced colours') await page.emulateMedia({ forcedColors: 'active' })
      if (mode === 'reduced motion') await page.emulateMedia({ reducedMotion: 'reduce' })
      await seedProgressOnce(page, {
        'river-stones': {
          activeRun: { path: ['start', 'flat_stones', 'big_rock'], locale: 'en' },
        },
      })
      await openPlayer(page, playerPath('en', 'river-stones'))
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'big_rock')
      expect(
        await page.evaluate(() => ({
          forced: matchMedia('(forced-colors: active)').matches,
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        })),
        'the emulated media',
      ).toEqual({ forced: mode === 'forced colours', reduced: mode === 'reduced motion' })
      const menu = page.locator(MENU)
      const dialog = page.locator(DIALOG)
      await menu.click()
      await expect(menu).toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator(PANEL)).toBeVisible()
      await settleFonts(page)
      // P: inside the run area's top padding, just inside its inline padding (the scene gradient).
      const point = await page.locator(RUN).evaluate((run) => {
        const box = run.getBoundingClientRect()
        return { x: Math.round(box.left + 14), y: Math.round(box.top + 10) }
      })
      const before = mode === 'plain' ? await pixelAt(page, point) : null

      await page.locator(MENU_RESTART).click()
      await expect(dialog, 'the dialog after Start again').toHaveJSProperty('open', true)
      await frames(page)
      const shown = await dialog.evaluate((element) => {
        const backdrop = getComputedStyle(element, '::backdrop')
        const box = element.getBoundingClientRect()
        return {
          backgroundColor: backdrop.backgroundColor,
          opacity: backdrop.opacity,
          colorScheme: backdrop.colorScheme,
          animationName: backdrop.animationName,
          transitionDuration: backdrop.transitionDuration,
          page: getComputedStyle(document.documentElement).backgroundColor,
          dialog: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }
      })
      console.log(
        `[player] T11 ${mode} (${test.info().project.name}): ${JSON.stringify(shown)}; ` +
          `P ${JSON.stringify(point)} before ${JSON.stringify(before)}`,
      )
      expect(shown.backgroundColor, "the backdrop is the page's canvas colour").toBe(shown.page)
      expect(shown.opacity, 'the backdrop is see-through').toBe('0.7')
      expect(shown.animationName, 'no animation').toBe('none')
      expect(shown.transitionDuration, 'no transition').toBe('0s')
      if (mode === 'forced colours') {
        expect(shown.backgroundColor, "forced colours: Canvas, Playwright's light theme").toBe(
          'rgb(255, 255, 255)',
        )
      } else {
        expect(shown.backgroundColor, 'the canvas token').toBe('rgb(13, 10, 5)')
        expect(shown.colorScheme, 'the dark scheme').toBe('dark')
      }
      await expect(menu, 'the menu behind the dialog').toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator(PANEL), 'the menu panel behind the dialog').toBeVisible()

      if (before !== null) {
        const backdrop = rgbOf(shown.backgroundColor)
        expect(
          point.x >= 0 &&
            point.y >= 0 &&
            point.x < shown.viewport.width &&
            point.y < shown.viewport.height,
          'precondition: P lies in the viewport',
        ).toBe(true)
        expect(
          point.x < shown.dialog.left ||
            point.x > shown.dialog.right ||
            point.y < shown.dialog.top ||
            point.y > shown.dialog.bottom,
          'precondition: P lies outside the dialog',
        ).toBe(true)
        expect(
          Math.max(...before.map((value, index) => Math.abs(value - (backdrop[index] ?? 0)))),
          'precondition: the page at P differs from the backdrop colour by 20 or more',
        ).toBeGreaterThanOrEqual(20)
        const after = await pixelAt(page, point)
        const expected = before.map((value, index) => 0.3 * value + 0.7 * (backdrop[index] ?? 0))
        console.log(
          `[player] T11 pixels (${test.info().project.name}): before ${JSON.stringify(before)} ` +
            `after ${JSON.stringify(after)} expected ${JSON.stringify(expected.map((v) => Math.round(v * 10) / 10))}`,
        )
        for (const [index, value] of after.entries()) {
          expect(
            Math.abs(value - (expected[index] ?? 0)),
            `channel ${index} at P: ${value}, expected 0.3 x before + 0.7 x the backdrop`,
          ).toBeLessThanOrEqual(3)
        }
      }

      // T-b8 unchanged: the dialog's Escape closes the dialog only; the menu stays open.
      await page.keyboard.press('Escape')
      await expect(dialog, 'the dialog after Escape').toHaveJSProperty('open', false)
      await expect(menu, 'the menu after Escape in the dialog').toHaveAttribute(
        'aria-expanded',
        'true',
      )
      await expect(page.locator(PANEL)).toBeVisible()
    })
  }

  // Review FB-4 (design §6 Reflow, "tested at 320 px and 150%"): the shell's 320 px test measures
  // the header with the menu closed, where Start again is a 0 x 0 box. Here the panel and the
  // dialog are open, in both languages.
  for (const code of ENABLED_LOCALE_CODES) {
    test(`T-b9 /${code}: at 320 px and 150%, the open menu and the restart dialog fit, with no overlap`, async ({
      page,
    }) => {
      const viewport = page.viewportSize()
      if (!viewport) throw new Error('the project sets no viewport')
      await seedProgressOnce(page, {
        'river-stones': {
          activeRun: { path: ['start', 'flat_stones', 'big_rock'], locale: code },
        },
      })
      await page.setViewportSize({ width: 320, height: viewport.height })
      await seedPrefs(page, prefsText(150))
      await openPlayer(page, playerPath(code, 'river-stones'))
      await settleFonts(page)
      await expect(page.locator('html')).toHaveAttribute(TEXT_SCALE_ATTRIBUTE, '150')
      const scroll = () =>
        page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))
      const project = test.info().project.name
      const lang = uiLang(code)

      await page.locator(MENU).click()
      await expect(page.locator(PANEL)).toBeVisible()
      const page1 = await scroll()
      const menuControls = await controlBoxes(page, `header a, header button, ${PANEL} label`)
      console.log(
        `[player] T-b9 /${code} menu (${project}): scroll ${page1.scrollWidth}/${page1.clientWidth}; ` +
          JSON.stringify(
            menuControls.map((c) => [
              c.name,
              Math.round(c.left),
              Math.round(c.right),
              Math.round(c.top),
            ]),
          ),
      )
      expect(page1.scrollWidth, 'horizontal scroll, the menu open').toBeLessThanOrEqual(
        page1.clientWidth,
      )
      // In DOM order: the 3 radio labels, then Start again (the panel's last control).
      expect(menuControls.map((c) => c.name).slice(-4), 'the panel controls').toEqual([
        ...[100, 125, 150].map((percent) => formatted(lang, 'player.textSizeOption', { percent })),
        message(lang, 'player.restart'),
      ])
      expectLaidOutApart(menuControls, { left: 0, right: page1.clientWidth }, 'the menu open')

      await page.locator(MENU_RESTART).click()
      const dialog = page.locator(DIALOG)
      await expect(dialog).toHaveJSProperty('open', true)
      const page2 = await scroll()
      const [dialogBox] = await controlBoxes(page, DIALOG)
      const dialogButtons = await controlBoxes(page, `${DIALOG} button`)
      const inner = await dialog.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }))
      console.log(
        `[player] T-b9 /${code} dialog (${project}): scroll ${page2.scrollWidth}/${page2.clientWidth}; ` +
          `dialog ${dialogBox ? `${Math.round(dialogBox.left)}-${Math.round(dialogBox.right)}` : 'none'}, ` +
          `inner ${inner.scrollWidth}/${inner.clientWidth}; ` +
          JSON.stringify(
            dialogButtons.map((c) => [
              c.name,
              Math.round(c.left),
              Math.round(c.right),
              Math.round(c.top),
            ]),
          ),
      )
      if (dialogBox === undefined) throw new Error('no dialog box')
      expect(page2.scrollWidth, 'horizontal scroll, the dialog open').toBeLessThanOrEqual(
        page2.clientWidth,
      )
      expectLaidOutApart([dialogBox], { left: 0, right: page2.clientWidth }, 'the dialog')
      expect(inner.scrollWidth, 'horizontal scroll inside the dialog').toBeLessThanOrEqual(
        inner.clientWidth,
      )
      expect(dialogButtons.map((c) => c.name)).toEqual([
        message(lang, 'player.keepReading'),
        message(lang, 'player.restart'),
      ])
      expectLaidOutApart(dialogButtons, dialogBox, 'the dialog buttons')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveJSProperty('open', false)
    })
  }

  // Second review R2-STRESS-1 (D11-P7 amended at 10b): the dialog closes on the first tap of a
  // double tap on Keep reading, and the second tap lands on whatever lies under it (big_rock's
  // choice c1 on webkit-ipad at en 100%). A close without an accepted Start again (Keep reading or
  // Escape) holds the run area for SETTLE_MS like a step. The page records every interactive
  // element under each tap (by its box, inert or not, header and dialog included) and whether the
  // run area was inert at the tap, so the test proves the hold on a project where nothing
  // interactive lies there too; the release is timed from the close event in the page.
  // Step 10d fix (the lead's decision): with the story-language switch in the header, the menu's
  // Start again lay under Keep reading on webkit-iphone with the staging banner (and at hi 150%
  // in 10b), so the second tap reopened the dialog. Start again is now ignored during that hold:
  // the dialog stays closed until the release, and Start again opens it again after. The "over
  // Start again" cases put Start again under Keep reading's centre on every project (320 x 480 px,
  // 150%, the page scrolled in the page until Start again's box holds that centre), so the bounce
  // is proven on both engines, whatever each project's own layout does.
  // Step 10d review: everything interactive under each tap must be a run-area control (held), an
  // element of the dialog or the menu's Start again (ignored), and the taps leave the text size
  // (html[data-text-scale]) and the story's language ([data-story] lang) as they were, so a layout
  // drift that puts a text-size radio, the story-language switch, Menu or a nav link under Keep
  // reading fails instead of passing. After the hold, Start again is proven by keyboard too: Enter
  // on it asks again, and Enter on it during the hold after that dialog's Escape is ignored.
  const HOLD_CASES = [
    {
      cancel: 'Keep reading',
      over: false,
      name: 'T-b10 a double tap on Keep reading never moves the story',
    },
    {
      cancel: 'Escape',
      over: false,
      name: 'T-b10 Escape on the restart dialog holds the run area too: a tap under Keep reading never moves the story',
    },
    {
      cancel: 'Keep reading',
      over: true,
      name: 'T-b10 over Start again: a double tap on Keep reading never reopens the dialog',
    },
    {
      cancel: 'Escape',
      over: true,
      name: 'T-b10 over Start again: Escape, then a tap under Keep reading never reopens the dialog',
    },
  ] as const
  for (const { cancel, over, name } of HOLD_CASES) {
    test(name, async ({ page }) => {
      const path = ['start', 'flat_stones', 'big_rock']
      if (over) {
        await page.setViewportSize({ width: 320, height: 480 })
        await seedPrefs(page, prefsText(150))
      }
      // A tap that lands after the hold proves nothing (and may then move the story, as it should),
      // so a late tap is retried from a fresh seed and open, at most 3 attempts in all (as T-b4's
      // settle case). The double tap is one dblclick (two taps 120 ms apart, down to down: the
      // first closes the dialog), so no round trip of the runner sits between the close and the
      // second tap; the tap after Escape follows the close event as soon as the page has seen it.
      const notes: string[] = []
      let seq = ''
      let epoch = ''
      let scale: string | null = null
      let lang: string | null = null
      let keep: Point = { x: 0, y: 0, scrolled: false }
      let taps: HoldRecord = NO_HOLD
      let late: number | null = null
      let placed: StartAgainUnder | null = null
      for (let attempt = 1; ; attempt++) {
        await seedProgressOnce(page, { 'river-stones': { activeRun: { path, locale: 'en' } } })
        await openPlayer(page, playerPath('en', 'river-stones'))
        await settleFonts(page)
        if (over) await expect(page.locator('html')).toHaveAttribute(TEXT_SCALE_ATTRIBUTE, '150')
        await expect(page.locator(PART)).toHaveAttribute('data-node', 'big_rock')
        await waitSettled(page)
        seq = (await page.locator(PART).getAttribute('data-seq')) ?? ''
        epoch = (await page.locator(RUN).getAttribute('data-epoch')) ?? ''
        scale = await page.locator('html').getAttribute(TEXT_SCALE_ATTRIBUTE)
        lang = await page.locator(STORY).getAttribute('lang')
        await page.locator(MENU).click()
        await expect(page.locator(PANEL)).toBeVisible()
        await page.locator(MENU_RESTART).click()
        await expect(page.locator(DIALOG), 'the dialog after Start again').toHaveJSProperty(
          'open',
          true,
        )
        if (over) placed = await putStartAgainUnderKeepReading(page)
        keep = await centreInViewport(page, KEEP_READING)
        await watchHold(page)
        if (cancel === 'Keep reading') {
          await page.mouse.dblclick(keep.x, keep.y, { delay: 60 })
        } else {
          await page.keyboard.press('Escape')
          // The close event is a queued task, and Chromium may dispatch a tap's input before it
          // (seen: a pointerdown 1-2 ms before the close), so the tap waits for it in the page.
          await page.waitForFunction(() => {
            const hold = (window as unknown as { __e2eHold?: HoldRecord }).__e2eHold
            return hold !== undefined && hold.closeAt !== null
          })
          await page.mouse.click(keep.x, keep.y)
        }
        taps = await pageValue<HoldRecord>(page, '__e2eHold')
        const last = taps.downs[taps.downs.length - 1]
        late = taps.closeAt === null || last === undefined ? null : last.t - taps.closeAt
        notes.push(
          `attempt ${attempt}: tap ${late === null ? 'never' : `${late.toFixed(0)} ms`} after the close`,
        )
        if ((late !== null && late < LATE_TAP_MS) || attempt === 3) break
      }
      const tap = taps.downs[taps.downs.length - 1]
      const where = over ? 'over Start again' : 'as laid out'
      notes.push(`Keep reading centre ${Math.round(keep.x)},${Math.round(keep.y)}`)
      if (placed !== null) {
        const r = placed.restart
        notes.push(
          `viewport ${placed.viewport.width}x${placed.viewport.height} at 150%, scrolled to ` +
            `${Math.round(placed.scrollY)}; Start again ${Math.round(r.left)}-${Math.round(r.right)} x ` +
            `${Math.round(r.top)}-${Math.round(r.bottom)}; holds the centre ${placed.under}`,
        )
      }
      // Every tap: every interactive element under it, anywhere on the page (the 10d fix).
      for (const [index, down] of taps.downs.entries()) {
        notes.push(
          `tap ${index + 1} under: ${down.under.length === 0 ? 'nothing interactive' : down.under.join(' + ')}; ` +
            `target ${down.target}${down.onStartAgain ? ' (the menu Start again)' : ''}`,
        )
      }
      if (tap !== undefined && tap.under.length === 0) {
        notes.push(
          'nothing interactive under the tap: the hold is asserted through the inert run area',
        )
      }
      test.info().annotations.push({ type: 'T-b10', description: notes.join('; ') })
      console.log(
        `[player] T-b10 ${cancel} ${where} (${test.info().project.name}): ${notes.join('; ')}`,
      )

      expect(taps.downs.length, 'the taps').toBe(cancel === 'Keep reading' ? 2 : 1)
      // What lies under each tap: only a run-area control (a choice or Back, inert below), an
      // element of the dialog, or the menu's Start again (ignored during the hold).
      for (const [index, down] of taps.downs.entries()) {
        expect(
          down.stray,
          `tap ${index + 1}: under it only a run-area control (a choice, Back), the dialog or the ` +
            `menu's Start again; under it: ${down.under.join(' + ')}`,
        ).toEqual([])
      }
      if (over) {
        expect(
          placed?.under,
          "precondition: the menu's Start again box holds Keep reading's centre",
        ).toBe(true)
        expect(
          tap?.onStartAgain,
          "precondition: the tap after the close lands on the menu's Start again",
        ).toBe(true)
      }
      expect(late, 'the close and tap times').not.toBeNull()
      expect(
        late !== null && late > 0 && late < LATE_TAP_MS,
        `timing: the tap came ${late} ms after the close (450 ms or more proves nothing)`,
      ).toBe(true)
      // The taps left the text size and the story's language as they were.
      const html = page.locator('html')
      if (scale === null) {
        await expect(html, 'the text size after the taps').not.toHaveAttribute(TEXT_SCALE_ATTRIBUTE)
      } else {
        await expect(html, 'the text size after the taps').toHaveAttribute(
          TEXT_SCALE_ATTRIBUTE,
          scale,
        )
      }
      await expect(page.locator(STORY), "the story's language after the taps").toHaveAttribute(
        'lang',
        lang ?? '',
      )
      // The story never moved.
      await expect(page.locator(PART), 'the node after the taps').toHaveAttribute(
        'data-node',
        'big_rock',
      )
      await expect(page.locator(PART), 'the seq after the taps').toHaveAttribute('data-seq', seq)
      await expect(page.locator(RUN), 'the run after the taps').toHaveAttribute('data-epoch', epoch)
      // The dialog stays closed: a tap on the menu's Start again under Keep reading is ignored.
      await expect(page.locator(DIALOG), 'the dialog after the taps').toHaveJSProperty(
        'open',
        false,
      )
      // The hold, on every project, whatever lies under the tap: the choices and Back were inert.
      expect(
        [tap?.choicesInert, tap?.backInert],
        'the run area held (choices and Back inert) at the tap',
      ).toEqual([true, true])

      // The release, timed from the close event in the page: interactive again SETTLE_MS after it.
      await expect
        .poll(async () => (await pageValue<HoldRecord>(page, '__e2eHold')).releasedAt, {
          message: 'the run area interactive again after the hold',
          timeout: 5_000,
        })
        .not.toBeNull()
      const done = await pageValue<HoldRecord>(page, '__e2eHold')
      const heldFor = (done.releasedAt ?? 0) - (done.closeAt ?? 0)
      const onset = (done.heldAt ?? 0) - (done.closeAt ?? 0)
      console.log(
        `[player] T-b10 ${cancel} ${where} (${test.info().project.name}): held ${onset.toFixed(0)} ms ` +
          `after the close, released ${heldFor.toFixed(0)} ms after it; dialog reopened ` +
          `${done.reopenedAt === null ? 'never' : `${(done.reopenedAt - (done.closeAt ?? 0)).toFixed(0)} ms after the close`}`,
      )
      expect(
        done.reopenedAt,
        'the dialog stayed closed from the close to the release (no tap reopened it)',
      ).toBeNull()
      expect(heldFor, 'the hold, from the close to the release').toBeGreaterThanOrEqual(
        SETTLE_MS - 20,
      )
      expect(heldFor, 'the hold, from the close to the release').toBeLessThan(4 * SETTLE_MS)
      await expect(page.locator(CHOICES), 'the choices after the hold').not.toHaveAttribute('inert')
      await expect(page.locator(FOOTER), 'Back after the hold').not.toHaveAttribute('inert')
      expect(await storedPath(page, 'river-stones'), 'the stored run after the taps').toEqual(path)
      // The menu's Start again works again after the hold (the same timer released it), by
      // keyboard first: Enter on the focused Start again asks first at big_rock.
      await expect(page.locator(DIALOG), 'the dialog after the hold').toHaveJSProperty(
        'open',
        false,
      )
      await page.locator(MENU_RESTART).focus()
      await page.keyboard.press('Enter')
      await expect(page.locator(DIALOG), 'Enter on Start again after the hold').toHaveJSProperty(
        'open',
        true,
      )
      // Escape cancels that dialog (a new hold, focus back on Start again); Enter on Start again
      // as soon as the page has seen the close, during that hold, is ignored. A late Enter (the
      // run area no longer held, or 450 ms or more after the close) proves nothing, so it is
      // retried with the dialog open again, at most 3 attempts in all, as the taps are.
      const keyNotes: string[] = []
      let enter: HoldKey | undefined
      let keyLate: number | null = null
      for (let attempt = 1; ; attempt++) {
        await watchHold(page)
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => {
          const hold = (window as unknown as { __e2eHold?: HoldRecord }).__e2eHold
          return hold !== undefined && hold.closeAt !== null
        })
        await page.keyboard.press('Enter')
        const keyed = await pageValue<HoldRecord>(page, '__e2eHold')
        enter = keyed.keys.find((key) => key.key === 'Enter')
        keyLate = enter === undefined || keyed.closeAt === null ? null : enter.t - keyed.closeAt
        keyNotes.push(
          `attempt ${attempt}: Enter ${keyLate === null ? 'never' : `${keyLate.toFixed(0)} ms`} ` +
            `after the close, on Start again ${enter?.onStartAgain}, run area inert ` +
            `${enter?.choicesInert}`,
        )
        const inTime = keyLate !== null && keyLate < LATE_TAP_MS && enter?.choicesInert === true
        if (inTime || attempt === 3) break
        // Late: once the hold is over, the dialog open again (a late Enter may have opened it).
        await expect
          .poll(async () => (await pageValue<HoldRecord>(page, '__e2eHold')).releasedAt, {
            timeout: 5_000,
          })
          .not.toBeNull()
        if (
          !(await page.locator(DIALOG).evaluate((dialog) => (dialog as HTMLDialogElement).open))
        ) {
          await page.locator(MENU_RESTART).focus()
          await page.keyboard.press('Enter')
        }
        await expect(page.locator(DIALOG), 'the dialog open for the next attempt').toHaveJSProperty(
          'open',
          true,
        )
      }
      console.log(
        `[player] T-b10 ${cancel} ${where} (${test.info().project.name}): Enter on Start again ` +
          `during the hold of that Escape: ${keyNotes.join('; ')}`,
      )
      expect(
        enter?.onStartAgain,
        'precondition: the Enter during the hold went to the focused Start again',
      ).toBe(true)
      expect(
        keyLate !== null && keyLate > 0 && keyLate < LATE_TAP_MS && enter?.choicesInert === true,
        `timing: the Enter came ${keyLate} ms after the close, run area inert ` +
          `${enter?.choicesInert} (450 ms or more, or not held, proves nothing)`,
      ).toBe(true)
      await expect
        .poll(async () => (await pageValue<HoldRecord>(page, '__e2eHold')).releasedAt, {
          message: 'the run area interactive again after the hold of that Escape',
          timeout: 5_000,
        })
        .not.toBeNull()
      expect(
        (await pageValue<HoldRecord>(page, '__e2eHold')).reopenedAt,
        'Enter on Start again during the hold never reopened the dialog',
      ).toBeNull()
      // And a tap: Start again asks again; Escape closes the dialog with focus back on Start
      // again, as before.
      await page.locator(MENU_RESTART).click()
      await expect(page.locator(DIALOG), 'Start again after the hold').toHaveJSProperty(
        'open',
        true,
      )
      await page.keyboard.press('Escape')
      await expect(page.locator(DIALOG), 'the dialog after Escape').toHaveJSProperty('open', false)
      await expect(page.locator(MENU_RESTART), 'focus after Escape').toBeFocused()
      await waitSettled(page)
      // And the island takes a tap again (its settle ref was released with the state).
      await page.locator(choice('c1')).click()
      await expect(page.locator(PART), 'a choice after the hold').toHaveAttribute(
        'data-node',
        'far_bank',
      )
      await expect(page.locator(PART)).toHaveAttribute('data-seq', String(Number(seq) + 1))
    })
  }
})

// ---------------------------------------------------------------------------------------------
// Step 10d: the story-language switch (design D11-P4, §4.1, §4.3, §6 F3, §9.3 T-d1 to T-d5, R20)

const SWITCH = 'header nav button[data-story-language]'
const STORY = '[data-part] [data-story]'
/** F3: the leading token each text element of the story sets on itself (player.module.css). */
const STORY_LEADING = [
  ['[data-story]', '--lh-body'],
  ['h1', '--lh-heading'],
  ['[data-passage] p', '--lh-story'],
  ['[data-question]', '--lh-story'],
  ['button[data-choice]', '--lh-label'],
] as const
const LEADING_TOKENS = ['--lh-body', '--lh-heading', '--lh-story', '--lh-label'] as const
/** T-d5 (R20): the raw layout shift allowed in the second after a switch. */
const SWITCH_SHIFT_MAX = 0.05
/** T-d5 (R20): the Devanagari 700 face, the question's bold, which /en has not loaded before. */
const DEVANAGARI_700 = /noto[-_]sans[-_]devanagari[-_]devanagari[-_]700/
/** T-d5: the face arrives in the first half of the window, so its swap is inside it. */
const SWITCH_FONT_BY_MS = 500

/**
 * T-d6: the header's rows (its height, the nav's top and height, and main's top, in px from the
 * header's top), and the width of a Devanagari sample: on /hi the All stories label, elsewhere the
 * switch's Hindi endonym. Also the header's content width in its own em (what the @container
 * conditions read) and <html data-text-scale>. Waits for the wide fallback's faces first
 * (wideDevanagariFallback).
 */
async function headerRows(
  page: Page,
  code: LocaleCode,
): Promise<{
  rows: { header: number; nav: number; navHeight: number; main: number }
  sample: number
  em: number
  scale: string | null
}> {
  return page.evaluate(
    async ({ sample, attribute }) => {
      await (window as unknown as Record<string, unknown>)['__e2eWideFallback']
      const header = document.querySelector('[data-player] > header')
      const nav = header?.querySelector(':scope > nav')
      const main = document.querySelector('[data-player] > main')
      const text = document.querySelector(sample)
      if (!header || !nav || !main || !text) throw new Error('no header, nav, main or sample')
      const top = header.getBoundingClientRect().top
      const style = getComputedStyle(header)
      const content =
        header.clientWidth -
        parseFloat(style.paddingInlineStart) -
        parseFloat(style.paddingInlineEnd)
      return {
        rows: {
          header: Math.round(header.getBoundingClientRect().height),
          nav: Math.round(nav.getBoundingClientRect().top - top),
          navHeight: Math.round(nav.getBoundingClientRect().height),
          main: Math.round(main.getBoundingClientRect().top - top),
        },
        sample: Math.round(text.getBoundingClientRect().width * 10) / 10,
        em: Math.round((content / parseFloat(style.fontSize)) * 100) / 100,
        scale: document.documentElement.getAttribute(attribute),
      }
    },
    {
      sample: code === 'hi' ? 'header [data-exit] span' : `${SWITCH} span[lang="hi"]`,
      attribute: TEXT_SCALE_ATTRIBUTE,
    },
  )
}

/**
 * T-d6 at a larger text size: the projects whose header is under 14.5em at 150% (Pixel 7 380 px
 * of 27 px, 14.1em; iPhone 15 361 px, 13.4em), where the 14.5em rule stacks the switch and
 * Grown-ups.
 */
const T_D6_PHONES: readonly string[] = ['chromium-phone', 'webkit-iphone']

/**
 * T-d6's layouts: the project's own at 100% (every project), then, on the phones, 150% and 320 px
 * at 125% (288 px of 22.5 px, 12.8em): both under 14.5em, so the 14.5em rule is in force (lead
 * review R3/F1). `fallback` is the wide fallback's size-adjust: one wide enough that, without the
 * 14.5em rule, it parts the switch and Grown-ups on /hi while the files are held (measured on a
 * build without that rule: at 320 px and 125% from about 121%; at 150% from about 146% on the
 * iPhone 15 and 165% on the Pixel 7, so 140% parts neither there and 150% uses 180%).
 */
const T_D6_LAYOUTS: readonly {
  readonly scale: TextScale
  readonly width?: number
  readonly fallback: number
  readonly name: string
}[] = [
  { scale: 100, fallback: WIDE_FALLBACK_SCALE, name: '' },
  { scale: 150, fallback: 180, name: ' at 150%' },
  { scale: 125, width: 320, fallback: WIDE_FALLBACK_SCALE, name: ' at 320 px and 125%' },
]

/** The language the switch offers on a page whose story is in `code`: the other enabled one. */
function otherLocale(code: LocaleCode): LocaleCode {
  const other = ENABLED_LOCALE_CODES.find((candidate) => candidate !== code)
  if (other === undefined) throw new Error(`no enabled locale other than ${code}`)
  return other
}

/**
 * The switch's text on the page of `pageCode` while it offers `target`: the visually hidden "Story
 * language:" in the page's language, then the offered language's endonym.
 */
function switchText(pageCode: LocaleCode, target: LocaleCode): string {
  return `${message(uiLang(pageCode), 'player.storyLanguage')} ${getLocaleDef(target).endonym}`
}

/**
 * The switch as assistive technology reads it (D11-P4; as the site switch, shell.spec.ts): one
 * button named "Story language: <endonym>"; the endonym carries the offered language's lang and
 * dir, and the prefix is read out but takes no space on screen (review A11Y-10d-1).
 */
async function expectSwitchNamed(
  page: Page,
  pageCode: LocaleCode,
  target: LocaleCode,
): Promise<void> {
  const { endonym, dir } = getLocaleDef(target)
  await expect(
    page.getByRole('button', { name: switchText(pageCode, target), exact: true }),
    'the switch by its accessible name',
  ).toHaveCount(1)
  const name = page.locator(`${SWITCH} > span[lang="${target}"]`)
  await expect(name, 'the endonym').toHaveText(endonym)
  await expect(name, "the endonym's dir").toHaveAttribute('dir', dir)
  const prefix = page.locator(`${SWITCH} > span:not([lang])`)
  await expect(prefix, 'the prefix').toHaveText(message(uiLang(pageCode), 'player.storyLanguage'))
  const box = await prefix.boundingBox()
  expect(box?.width ?? 0, 'prefix width').toBeLessThanOrEqual(1)
  expect(box?.height ?? 0, 'prefix height').toBeLessThanOrEqual(1)
}

/** Whether an element is still in the page (false too when its document has gone). */
async function stillConnected(handle: ElementHandle): Promise<boolean> {
  return handle.evaluate((element) => element.isConnected).catch(() => false)
}

/**
 * After a step: waits in the page until every animation of the player's elements (the reveal) has
 * ended, keeps those Animation objects in the page (__e2eReveal) and returns their names.
 */
async function recordEndedReveal(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const player = document.querySelector('[data-player]')
    const animations = document.getAnimations().filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target
      return player !== null && target instanceof Element && player.contains(target)
    })
    await Promise.all(animations.map((animation) => animation.finished))
    ;(window as unknown as Record<string, unknown>)['__e2eReveal'] = animations
    return animations.map((animation) =>
      'animationName' in animation ? String(animation.animationName) : animation.id,
    )
  })
}

/** Since recordEndedReveal: the player's animations that are new, and those running. */
async function revealSince(page: Page): Promise<{ fresh: string[]; running: string[] }> {
  return page.evaluate(() => {
    const before =
      ((window as unknown as Record<string, unknown>)['__e2eReveal'] as Animation[] | undefined) ??
      []
    const player = document.querySelector('[data-player]')
    const now = document.getAnimations().filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target
      return player !== null && target instanceof Element && player.contains(target)
    })
    const name = (animation: Animation): string =>
      'animationName' in animation ? String(animation.animationName) : animation.id
    return {
      fresh: now.filter((animation) => !before.includes(animation)).map(name),
      running: now.filter((animation) => animation.playState === 'running').map(name),
    }
  })
}

/**
 * F3: one lang island's size and leading, and `token` as each of `codes` resolves it (read from a
 * hidden probe element with that lang, as storyLeading does).
 */
async function islandLeading(
  page: Page,
  selector: string,
  token: string,
  codes: readonly LocaleCode[],
) {
  return page.evaluate(
    ([css, name, langs]) => {
      const tokens: Record<string, number> = {}
      for (const lang of langs) {
        const probe = document.createElement('div')
        probe.lang = lang
        probe.hidden = true
        document.body.append(probe)
        tokens[lang] = Number(getComputedStyle(probe).getPropertyValue(name).trim())
        probe.remove()
      }
      const element = document.querySelector(css)
      if (element === null) throw new Error(`no ${css}`)
      const style = getComputedStyle(element)
      const fontSize = parseFloat(style.fontSize)
      const lineHeight = parseFloat(style.lineHeight)
      return {
        lang: element.closest('[lang]')?.getAttribute('lang') ?? null,
        tokens,
        fontSize,
        lineHeight,
        ratio: lineHeight / fontSize,
      }
    },
    [selector, token, codes] as const,
  )
}

/** The reveal on screen: parts with data-animate, and the animations of the player's elements. */
async function revealState(page: Page): Promise<{ animate: number; animations: string[] }> {
  return page.evaluate(() => {
    const player = document.querySelector('[data-player]')
    return {
      animate: document.querySelectorAll('[data-animate]').length,
      animations: document
        .getAnimations()
        .filter((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target
          return player !== null && target instanceof Element && player.contains(target)
        })
        .map((animation) =>
          'animationName' in animation ? String(animation.animationName) : animation.id,
        ),
    }
  })
}

/**
 * Before a switch: records in the page (__e2eSwitchAt, performance.now()) when the story first
 * carries `lang`, from a MutationObserver on [data-story]: the switch's commit.
 */
async function markStoryLanguage(page: Page, lang: LocaleCode): Promise<void> {
  await page.evaluate(
    ([selector, wanted]) => {
      const w = window as unknown as Record<string, unknown>
      const story = document.querySelector(selector)
      if (story === null) throw new Error(`no ${selector}`)
      w['__e2eSwitchAt'] = null
      const observer = new MutationObserver(() => {
        if (story.getAttribute('lang') !== wanted) return
        w['__e2eSwitchAt'] = performance.now()
        observer.disconnect()
      })
      observer.observe(story, { attributes: true, attributeFilter: ['lang'] })
    },
    [STORY, lang] as const,
  )
}

/**
 * F3 (T-d4): each text element of the story on screen with its language, size, leading and the
 * token it must take, and the leading tokens as each enabled language resolves them (read from a
 * hidden probe element with that lang).
 */
async function storyLeading(page: Page, codes: readonly LocaleCode[]) {
  return page.evaluate(
    ([rules, names, langs]) => {
      const tokens: Record<string, Record<string, number>> = {}
      for (const lang of langs) {
        const probe = document.createElement('div')
        probe.lang = lang
        probe.hidden = true
        document.body.append(probe)
        const style = getComputedStyle(probe)
        tokens[lang] = Object.fromEntries(
          names.map((name) => [name, Number(style.getPropertyValue(name).trim())]),
        )
        probe.remove()
      }
      const story = document.querySelector('[data-part] [data-story]')
      const rows = rules.flatMap(([selector, token]) => {
        const elements =
          story === null
            ? []
            : selector === '[data-story]'
              ? [story]
              : [...story.querySelectorAll(selector)]
        return elements.map((element) => {
          const style = getComputedStyle(element)
          const fontSize = parseFloat(style.fontSize)
          const lineHeight = parseFloat(style.lineHeight)
          return {
            element: `${element.localName} (${selector})`,
            lang: element.closest('[lang]')?.getAttribute('lang') ?? null,
            token,
            fontSize,
            lineHeight,
            ratio: lineHeight / fontSize,
          }
        })
      })
      return { pageLang: document.documentElement.lang, tokens, rows }
    },
    [STORY_LEADING, LEADING_TOKENS, codes] as const,
  )
}

test.describe('the story player, Step 10d', { tag: '@review' }, () => {
  test('T-d1 a switch at river-stones flat_stones on /en: the same part in Hindi, the page English, focus kept, no reveal, silent, prefs untouched', async ({
    page,
  }) => {
    // Resumed at flat_stones, so no step's reveal is on screen before the switch (T-a19).
    const graph = fixtureGraph('river-stones')
    const prefs = prefsText(100)
    await seedPrefs(page, prefs)
    const progressWrites = await progressSpy(page)
    await seedProgressOnce(page, {
      'river-stones': { activeRun: { path: ['start', 'flat_stones'], locale: 'en' } },
    })
    await recordAnnouncements(page)
    const url = playerPath('en', 'river-stones')
    await openPlayer(page, url)
    await expectPart(page, graph, 'en', 'flat_stones')
    await expectSilentOpen(page)
    await expect(page.locator(SWITCH)).toHaveText(switchText('en', 'hi'))
    await expectSwitchNamed(page, 'en', 'hi')
    const before = {
      url: page.url(),
      title: await page.title(),
      seq: (await page.locator(PART).getAttribute('data-seq')) ?? '',
      epoch: (await page.locator(RUN).getAttribute('data-epoch')) ?? '',
    }
    const part = await page.locator(PART).elementHandle()
    const run = await page.locator(RUN).elementHandle()
    const button = await page.locator(SWITCH).elementHandle()
    if (part === null || run === null || button === null) throw new Error('no part, run or switch')

    await page.locator(SWITCH).click()

    // The story, in Hindi: SET_LOCALE changes the story's language (D11-P4).
    await expect(page.locator(STORY), 'the story after the switch').toHaveAttribute('lang', 'hi')
    await expect(page.locator(STORY)).toHaveAttribute('dir', 'ltr')
    await expectPart(page, graph, 'hi', 'flat_stones')

    // The same part: same node, seq and run, never remounted (§4.3 "no remount").
    expect(await stillConnected(part), 'the part element stays mounted').toBe(true)
    expect(await stillConnected(run), 'the run area stays mounted').toBe(true)
    await expect(page.locator(PART)).toHaveAttribute('data-seq', before.seq)
    await expect(page.locator(RUN)).toHaveAttribute('data-epoch', before.epoch)

    // The page stays on the route locale: URL, <html lang dir>, <title> and the chrome, Back too.
    expect(page.url(), 'the URL').toBe(before.url)
    expect(
      await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]),
      '<html lang dir>',
    ).toEqual(['en', 'ltr'])
    expect(await page.title(), '<title>').toBe(before.title)
    await expect(page.locator('a[data-exit]')).toHaveText(message('en', 'player.allStories'))
    await expect(page.locator('header nav a')).toHaveText(message('en', 'header.grownUps'))
    await expect(page.locator(back())).toHaveText(message('en', 'player.back'))
    await expect(page.locator(SWITCH), 'the switch now offers English').toHaveText(
      switchText('en', 'en'),
    )
    await expect(page.locator(`${SWITCH} span[lang]`)).toHaveAttribute('lang', 'en')
    await expectSwitchNamed(page, 'en', 'en')

    // The focus stays on the switch: the same element (D11-P4 "keyed by index").
    expect(
      await button.evaluate((element) => element === document.activeElement),
      'the focus is still on the switch it was clicked on',
    ).toBe(true)

    // No reveal: no data-animate and no animation in the player (§4.3).
    await frames(page)
    expect(await revealState(page), 'the reveal after the switch').toEqual({
      animate: 0,
      animations: [],
    })

    // Silent: the live region holds nothing and has held nothing (announce() waits a frame).
    await frames(page)
    await page.waitForTimeout(100)
    expect(await liveRegions(page), 'the live region after the switch').toEqual([
      { role: 'status', live: 'polite', atomic: 'true', text: '' },
    ])
    expect(await announcements(page), 'announced after the switch').toEqual([])

    // Storage: the run is saved in Hindi (effects [persist]); prefs are never written.
    await expect
      .poll(() => storedStory(page, 'river-stones'), { message: 'the run saved in Hindi' })
      .toMatchObject({ activeRun: { path: ['start', 'flat_stones'], locale: 'hi' } })
    expect(await progressWrites(), 'progress writes: the one save').toEqual([
      `setItem ${PROGRESS_KEY}`,
    ])
    expect(await storageAfter(page), 'every storage write, and the prefs record').toEqual({
      writes: ['setItem'],
      stored: prefs,
    })
  })

  test('T-d1 after a step to river-stones flat_stones on /en: the switch keeps every element of the story and replays no reveal', async ({
    page,
  }) => {
    // A step, not a resume: the part keeps data-animate (only a pointerdown or key press in the run
    // area ends the reveal, and the switch is in the header), so a remount of anything in it would
    // run the reveal again (§4.3 "no remount, no data-animate"; review R10d-STRESS-1, FID-10d-1).
    const graph = fixtureGraph('river-stones')
    await openPlayer(page, playerPath('en', 'river-stones'))
    await walk(page, 'river-stones', ['c1'])
    const part = page.locator(PART)
    await expect(part).toHaveAttribute('data-animate', '')
    const reveal = await recordEndedReveal(page)
    // The reveal ran (the passage, then the question and the choices), so a replay would show.
    expect(reveal.length, `the reveal after the step: ${JSON.stringify(reveal)}`).toBeGreaterThan(2)
    const elements: [string, ElementHandle | null][] = [
      ['story', await part.locator('[data-story]').elementHandle()],
      ['title', await part.locator('h1').elementHandle()],
      ['passage', await part.locator('[data-passage]').elementHandle()],
      ['first paragraph', await part.locator('[data-passage] p').first().elementHandle()],
      ['question', await part.locator('[data-question]').elementHandle()],
      ['choice list', await part.locator('ul[data-choices]').elementHandle()],
    ]
    const buttons = await part.locator('button[data-choice]').elementHandles()
    expect(buttons.length, 'the choices').toBeGreaterThan(0)

    await page.locator(SWITCH).click()

    await expect(page.locator(STORY), 'the story after the switch').toHaveAttribute('lang', 'hi')
    await expectPart(page, graph, 'hi', 'flat_stones')
    // Every element of the story stays mounted; only its text and lang change.
    for (const [name, handle] of elements) {
      if (handle === null) throw new Error(`no ${name}`)
      expect(await stillConnected(handle), `the ${name} stays mounted`).toBe(true)
    }
    for (const [index, handle] of buttons.entries()) {
      expect(await stillConnected(handle), `choice ${index + 1} stays mounted`).toBe(true)
    }
    // No reveal: the part's reveal state is as the step left it, and no animation in the player
    // is new or running after the switch's commit (two frames: a restyle has run).
    await expect(part).toHaveAttribute('data-animate', '')
    await expect(part).not.toHaveAttribute('data-reveal')
    await frames(page)
    expect(await revealSince(page), 'the reveal after the switch').toEqual({
      fresh: [],
      running: [],
    })
  })

  test('T-d2 at an ending the switch keeps the card: the same card, the lesson in Hindi, the rest English', async ({
    page,
  }) => {
    const graph = fixtureGraph('lantern-walk')
    const url = playerPath('en', 'lantern-walk')
    await openPlayer(page, url)
    await walk(page, 'lantern-walk', graph.firstPath.choices)
    const ending = graph.firstPath.nodes[graph.firstPath.nodes.length - 1] ?? ''
    const card = '[data-part] section[data-ending]'
    await expect(page.locator(card)).toBeVisible()
    const count = formatted('en', 'player.endingCount', {
      found: 1,
      total: endingsOf(graph).length,
    })
    await expect(page.locator(`${card} [data-ending-count]`)).toHaveText(count)
    const part = await page.locator(PART).elementHandle()
    const section = await page.locator(card).elementHandle()
    if (part === null || section === null) throw new Error('no part or card')

    await page.locator(SWITCH).click()

    await expect(page.locator(STORY), 'the story after the switch').toHaveAttribute('lang', 'hi')
    // The card stays: the switch is no navigation (with one, an ending's run is not kept).
    expect(await stillConnected(section), 'the card stays mounted').toBe(true)
    expect(await stillConnected(part), 'the part stays mounted').toBe(true)
    expect(page.url(), 'the URL').toBe(new URL(url, page.url()).href)
    await expectPart(page, graph, 'hi', ending)
    const lesson = page.locator(`${card} [data-lesson]`)
    await expect(lesson).toHaveAttribute('lang', 'hi')
    await expect(lesson).toHaveText(graph.text['hi']?.nodes[ending]?.lesson ?? 'no hi lesson')
    // F3 (§6): the lesson, a Hindi island on the English page, takes the :lang(hi) leading
    // (review A11Y-10d-2).
    const leading = await islandLeading(page, `${card} [data-lesson]`, '--lh-story', ['en', 'hi'])
    const hiStory = leading.tokens['hi'] ?? Number.NaN
    expect(leading.lang, 'the lesson: lang').toBe('hi')
    expect(hiStory, 'the hi --lh-story differs from the en one').not.toBe(leading.tokens['en'])
    expect(
      Math.abs(leading.ratio - hiStory) < 0.01,
      `the lesson: ${leading.fontSize}px / ${leading.lineHeight}px = ${leading.ratio.toFixed(3)}, not the :lang(hi) --lh-story ${hiStory}`,
    ).toBe(true)
    // The card's heading, count and actions are in the page's language (§4.1 lang islands).
    await expect(page.locator(`${card} h2`)).toHaveText(message('en', 'player.lessonHeading'))
    await expect(page.locator(`${card} [data-ending-count]`)).toHaveText(count)
    await expect(page.locator(`${card} button[data-try-another]`)).toHaveText(
      message('en', 'player.tryAnother'),
    )
    await expect(page.locator(`${card} a[data-all-stories]`)).toHaveAttribute('href', '/en')
    expect(await page.evaluate(() => document.documentElement.lang), '<html lang>').toBe('en')
  })

  test('T-d2 with storage blocked the switch keeps the node: flat_stones, the same part, in Hindi', async ({
    page,
  }) => {
    const graph = fixtureGraph('river-stones')
    await blockStorage(page)
    const url = playerPath('en', 'river-stones')
    await openPlayer(page, url)
    await expect(page.locator('section[aria-labelledby="storage-banner-title"]')).toBeVisible()
    await walk(page, 'river-stones', ['c1'])
    const part = await page.locator(PART).elementHandle()
    if (part === null) throw new Error('no part')

    await page.locator(SWITCH).click()

    await expect(page.locator(STORY), 'the story after the switch').toHaveAttribute('lang', 'hi')
    // The node is kept although nothing can be stored: the switch is no navigation.
    expect(await stillConnected(part), 'the part stays mounted').toBe(true)
    expect(page.url(), 'the URL').toBe(new URL(url, page.url()).href)
    await expectPart(page, graph, 'hi', 'flat_stones')
    await expect(page.locator(PART)).toHaveAttribute('data-seq', '1')
  })

  test('T-d3 a switch mid-story, then a reload: the same node, in Hindi, on the English page', async ({
    page,
  }) => {
    const graph = fixtureGraph('river-stones')
    await openPlayer(page, playerPath('en', 'river-stones'))
    const quiet = quietRequests(page)
    await walk(page, 'river-stones', ['c1'])
    await expect
      .poll(() => storedStory(page, 'river-stones'), { message: 'the run saved in English' })
      .toMatchObject({ activeRun: { path: ['start', 'flat_stones'], locale: 'en' } })

    await page.locator(SWITCH).click()

    await expect(page.locator(STORY), 'the story after the switch').toHaveAttribute('lang', 'hi')
    await expect
      .poll(() => storedStory(page, 'river-stones'), { message: 'the run saved in Hindi' })
      .toMatchObject({ activeRun: { path: ['start', 'flat_stones'], locale: 'hi' } })
    await quiet()
    await page.reload()
    await waitOpen(page)
    // Stored-first (D11-P3): the run reopens in the language it was saved in.
    await expectPart(page, graph, 'hi', 'flat_stones')
    expect(await page.evaluate(() => document.documentElement.lang), '<html lang>').toBe('en')
    await expect(page.locator(SWITCH), 'the switch offers English').toHaveText(
      switchText('en', 'en'),
    )
  })

  for (const code of ENABLED_LOCALE_CODES) {
    const other = otherLocale(code)
    test(`T-d4 /${code}: after a switch, the ${other} story's leading is the :lang(${other}) token (F3)`, async ({
      page,
    }) => {
      await openPlayer(page, playerPath(code, 'river-stones'))
      await page.locator(SWITCH).click()
      await expect(page.locator(STORY), 'the story after the switch').toHaveAttribute('lang', other)
      const measured = await storyLeading(page, [code, other])
      const description = JSON.stringify(
        measured.rows.map((row) => [row.element, row.lang, row.fontSize, row.lineHeight]),
      )
      test.info().annotations.push({ type: 'T-d4', description })
      console.log(`[player] T-d4 /${code} (${test.info().project.name}): ${description}`)
      expect(measured.pageLang, '<html lang>').toBe(code)
      // The two languages' tokens differ, so a story on the page's leading cannot pass.
      for (const name of LEADING_TOKENS) {
        expect(measured.tokens[other]?.[name], `${other} ${name}`).not.toBe(
          measured.tokens[code]?.[name],
        )
      }
      expect(
        measured.rows.map((row) => row.element.split(' ')[0]),
        'the measured elements',
      ).toEqual(expect.arrayContaining(['div', 'h1', 'p', 'button']))
      for (const row of measured.rows) {
        const token = measured.tokens[other]?.[row.token] ?? Number.NaN
        expect(row.lang, `${row.element}: lang`).toBe(other)
        expect(
          Math.abs(row.ratio - token) < 0.01,
          `${row.element}: ${row.fontSize}px / ${row.lineHeight}px = ${row.ratio.toFixed(3)}, not the :lang(${other}) ${row.token} ${token}`,
        ).toBe(true)
      }
    })
  }

  test('T-d5 a switch on /en shifts the layout by 0.05 or less (raw) in the second after it (Chromium)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'the Layout Instability API is Chromium only')
    await recordLayoutShifts(page)
    await openPlayer(page, playerPath('en', 'river-stones'))
    await settleFonts(page)
    await frames(page)
    await markStoryLanguage(page, 'hi')

    await page.locator(SWITCH).click()

    await expect(page.locator(STORY), 'the story after the switch').toHaveAttribute('lang', 'hi')
    const switchAt = await pageValue<number | null>(page, '__e2eSwitchAt')
    if (switchAt === null) throw new Error('the switch commit was not seen')
    // The window ends 1 s after the commit, by the page's clock; two frames deliver its entries.
    await page.waitForFunction((at) => performance.now() >= at + 1000, switchAt)
    await frames(page)
    // The font files fetched after the switch, each with when it arrived (ms after the commit).
    const fonts = await page.evaluate(
      ([from, patterns]) =>
        performance
          .getEntriesByType('resource')
          .filter(
            (entry) =>
              entry.startTime >= from &&
              patterns.some((pattern) => new RegExp(pattern).test(entry.name)),
          )
          .map((entry) => ({
            file: new URL(entry.name).pathname.split('/').pop() ?? '',
            in: Math.round((entry as PerformanceResourceTiming).responseEnd - from),
          })),
      [switchAt, [LORA_FILE.source, NOTO_FILE.source]] as const,
    )
    const { cls, raw, shifts, inputShifts } = await layoutShift(page, {
      from: switchAt,
      to: switchAt + 1000,
    })
    const description =
      `raw ${raw.toFixed(6)}, CLS ${cls.toFixed(6)} (${shifts} shifts, ${inputShifts} flagged as ` +
      `recent input) in the 1 s after the switch; font files fetched after it: ${JSON.stringify(fonts)}`
    console.log(`[player] T-d5 (${test.info().project.name}): ${description}`)
    test.info().annotations.push({ type: 'T-d5', description })
    // R20 is exercised: the Devanagari 700 face is fetched after the switch and arrives in the
    // first half of the window, so its swap is measured (review FID-10d-2).
    const late = fonts.filter((font) => DEVANAGARI_700.test(font.file))
    expect(
      late.length > 0 && late.every((font) => font.in <= SWITCH_FONT_BY_MS),
      `R20 not exercised: the Devanagari 700 face after the switch ${JSON.stringify(late)}`,
    ).toBe(true)
    expect(raw, 'raw layout shift in the 1 s after the switch').toBeLessThanOrEqual(
      SWITCH_SHIFT_MAX,
    )
  })

  // T-d6 (Step 10d CI fix, CI run 44037149156): T-a20 failed on chromium-phone /hi with CLS 0.146
  // on the CI image only. Its Devanagari fallback is much wider than Noto Sans Devanagari, so with
  // the font files held, All stories plus the nav (the switch, Grown-ups) no longer fit on header
  // row 1: the nav wrapped to a row of its own, and when the files arrived it moved back up, and
  // main with it. Here a test-only fallback 40% wider (wideDevanagariFallback) stands in for the CI
  // one on every engine, and the header's rows, the nav's row and height and main must be where
  // they were while the files were held. All 5 projects: the phones are where the rows could
  // change. On the phones also at 150% and at 320 px and 125%, where the header is under 14.5em,
  // so the switch and Grown-ups, which a wide fallback would part, stay stacked (T_D6_LAYOUTS).
  for (const code of ENABLED_LOCALE_CODES) {
    for (const { scale, width, fallback, name } of T_D6_LAYOUTS) {
      test(`T-d6 /${code}${name}: with a wide Devanagari fallback, the fonts arriving keep the header rows and main in place`, async ({
        page,
      }) => {
        if (scale !== 100) {
          test.skip(
            !T_D6_PHONES.includes(test.info().project.name),
            'the phones: where this text size puts the header under 14.5em',
          )
          await seedPrefs(page, prefsText(scale))
        }
        if (width !== undefined) {
          const viewport = page.viewportSize()
          if (!viewport) throw new Error('the project sets no viewport')
          await page.setViewportSize({ width, height: viewport.height })
        }
        await td6(page, code, scale, fallback)
      })
    }
  }

  // T-d6, the scope (design D11-P16, amended at the 10d CI fix): the forced rows are for a nav
  // that holds the story-language switch only. At 320 px and 150% the header is 10.7em, under both
  // conditions: with the switch the nav is a full-width item and its items stack; with the
  // switch's data attribute taken off (a one-language story's nav has no switch; the fixtures have
  // no such story), the same nav computes the 10c flow; with it back, the rules apply again.
  for (const code of ENABLED_LOCALE_CODES) {
    test(`T-d6 /${code}: a header nav without the story-language switch keeps the 10c flow`, async ({
      page,
    }) => {
      const viewport = page.viewportSize()
      if (!viewport) throw new Error('the project sets no viewport')
      await page.setViewportSize({ width: 320, height: viewport.height })
      await seedPrefs(page, prefsText(150))
      await openPlayer(page, playerPath(code, 'two-paths'))
      await expect(page.locator('html')).toHaveAttribute(TEXT_SCALE_ATTRIBUTE, '150')
      const flow = () =>
        page.evaluate(() => {
          const header = document.querySelector('[data-player] > header')
          const nav = header?.querySelector(':scope > nav')
          if (!header || !nav) throw new Error('no header or nav')
          const style = getComputedStyle(nav)
          const box = getComputedStyle(header)
          const content =
            header.clientWidth -
            parseFloat(box.paddingInlineStart) -
            parseFloat(box.paddingInlineEnd)
          return {
            em: Math.round((content / parseFloat(box.fontSize)) * 100) / 100,
            flow: {
              basis: style.flexBasis,
              direction: style.flexDirection,
              align: style.alignItems,
            },
          }
        })
      const forced = { basis: '100%', direction: 'column', align: 'flex-start' }
      const withSwitch = await flow()
      expect(withSwitch.em, 'the header in its own em: under 14.5em').toBeLessThan(14.5)
      expect(withSwitch.flow, 'the nav with the switch').toEqual(forced)
      await page.locator(SWITCH).evaluate((button) => button.removeAttribute('data-story-language'))
      await expect(page.locator(SWITCH)).toHaveCount(0)
      const without = await flow()
      console.log(
        `[player] T-d6 /${code} scope (${test.info().project.name}): with ` +
          `${JSON.stringify(withSwitch)}; without ${JSON.stringify(without)}`,
      )
      expect(without.flow, 'the nav without the switch (10c)').toEqual({
        basis: 'auto',
        direction: 'row',
        align: 'center',
      })
      await page
        .locator('[data-player] > header > nav > button')
        .evaluate((button) => button.setAttribute('data-story-language', ''))
      expect((await flow()).flow, 'the nav with the switch again').toEqual(forced)
    })
  }

  /**
   * One T-d6 run: the font files held under the wide fallback (size-adjust `fallback`%), the header
   * measured while held, then again once the files arrived and the player opened.
   */
  async function td6(
    page: Page,
    code: LocaleCode,
    scale: TextScale,
    fallback: number,
  ): Promise<void> {
    await wideDevanagariFallback(page, fallback)
    let delayed = 0
    let released = 0
    // As T-a20: every Lora and Noto file is held 1.5 s.
    await page.route(
      (url) => LORA_FILE.test(url.pathname) || NOTO_FILE.test(url.pathname),
      async (route) => {
        delayed++
        await sleep(1500)
        await route.continue().catch(() => undefined)
        released++
      },
    )
    const response = await page.goto(playerPath(code, 'two-paths'), {
      waitUntil: 'domcontentloaded',
    })
    expect(response?.status(), 'status').toBe(200)
    await expect.poll(() => delayed, { timeout: 15_000 }).toBeGreaterThan(0)
    const held = await headerRows(page, code)
    expect(released, 'the held layout was measured before any font file arrived').toBe(0)
    await expect.poll(() => released === delayed, { timeout: 15_000 }).toBe(true)
    await waitOpen(page)
    await settleFonts(page)
    await frames(page)
    const after = await headerRows(page, code)
    const description = `held ${JSON.stringify(held)}; after ${JSON.stringify(after)}`
    const at =
      scale === 100
        ? ''
        : ` ${scale}% at ${page.viewportSize()?.width ?? '?'} px, fallback ${fallback}%`
    console.log(`[player] T-d6 /${code}${at} (${test.info().project.name}): ${description}`)
    test.info().annotations.push({ type: 'T-d6', description })
    // The text size was in force while the files were held, and stayed.
    const attribute = scale === 100 ? null : String(scale)
    expect(held.scale, 'data-text-scale while held').toBe(attribute)
    expect(after.scale, 'data-text-scale after').toBe(attribute)
    // At a larger text size the header is under 14.5em, so the 14.5em rule is what holds the nav
    // (not vacuous).
    if (scale !== 100) expect(held.em, 'the header in its own em').toBeLessThan(14.5)
    // The wide fallback was in force while the files were held (not vacuous).
    expect(
      held.sample / after.sample,
      `Devanagari sample width held ${held.sample} px over after ${after.sample} px`,
    ).toBeGreaterThan(1.2)
    expect(
      held.rows,
      'header height, nav top, nav height and main top (px from the header top)',
    ).toEqual(after.rows)
  }
})

// ---------------------------------------------------------------------------------------------
// P1-4 owner screens (design p1-4-polish-design.md R1, T2, T2c): the run area is a framed panel.
// It reaches --space-3 (12 px) past main's content box on each side and pads by as much, so the
// title, the story card, the ending card and Back keep their width and place across; it pads
// --space-5 (24 px) above and below, with the cards' radius; main's top padding is --space-4
// (16 px) for the player's main only, so the title sits 40 px under the header (was 48). The
// segments and the story-language switch share the run area's .runDependent marker and must not
// take its box: their values are the ones measured before the panel (design §1.1, §3.8.3). Every
// offset is a fixed px padding, independent of the font, so there is no wide-fallback variant;
// the panel's share of a font-arrival shift is T-e5's (player-images.spec.ts).

/** The phones, where 150% text and the 320 px case run. */
const PANEL_PHONES: readonly string[] = ['chromium-phone', 'webkit-iphone']

const PANEL_CASES = [
  { story: 'river-stones', node: 'flat_stones', seeded: true },
  { story: 'lantern-walk', node: 'ending_light', seeded: false },
] as const

/** Opens `story` at `node` on /`code` at `scale` text: flat_stones seeded, ending_light walked. */
async function openPanelCase(
  page: Page,
  at: (typeof PANEL_CASES)[number],
  code: LocaleCode,
  scale: TextScale,
): Promise<void> {
  if (scale !== 100) await seedPrefs(page, prefsText(scale))
  if (at.seeded) {
    await seedProgressOnce(page, {
      [at.story]: { activeRun: { path: ['start', at.node], locale: code } },
    })
  }
  await openPlayer(page, playerPath(code, at.story))
  if (!at.seeded) await walk(page, at.story, ['c1', 'c1'])
  await expect(page.locator(PART)).toHaveAttribute('data-node', at.node)
  await settleFonts(page)
  expect(
    await page.locator('html').getAttribute(TEXT_SCALE_ATTRIBUTE),
    'precondition: the text size',
  ).toBe(scale === 100 ? null : String(scale))
}

/** The panel, what sits in it, the header, main and the two other .runDependent elements. */
async function panelLayout(page: Page) {
  return page.evaluate(() => {
    const element = (selector: string): Element => {
      const found = document.querySelector(selector)
      if (found === null) throw new Error(`no ${selector}`)
      return found
    }
    const box = (selector: string) => {
      const found = document.querySelector(selector)
      if (found === null) return null
      const rect = found.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    }
    const values = (selector: string, names: readonly string[]): string[] => {
      const style = getComputedStyle(element(selector))
      return names.map((name) => style.getPropertyValue(name))
    }
    const BOX = [
      'padding-block-start',
      'padding-block-end',
      'padding-inline-start',
      'padding-inline-end',
      'margin-inline-start',
      'margin-inline-end',
    ] as const
    const run = getComputedStyle(element('[data-run]'))
    const main = element('[data-player] > main')
    const mainStyle = getComputedStyle(main)
    return {
      scene: element('[data-run]').getAttribute('data-scene'),
      backgroundImage: run.backgroundImage,
      radius: [
        run.borderTopLeftRadius,
        run.borderTopRightRadius,
        run.borderBottomRightRadius,
        run.borderBottomLeftRadius,
      ],
      padding: values('[data-run]', BOX.slice(0, 4)),
      margin: values('[data-run]', BOX.slice(4)),
      overflow: [run.overflowX, run.overflowY],
      panel: box('[data-run]'),
      header: box('[data-player] > header'),
      title: box('[data-part] [data-story] h1'),
      storyCard: box('[data-part] [data-story-card]'),
      storyMax: parseFloat(getComputedStyle(element('[data-part] [data-story]')).maxInlineSize),
      endingCard: box('[data-part] section[data-ending]'),
      back: box('[data-part] button[data-back]'),
      mainContent:
        main.clientWidth -
        parseFloat(mainStyle.getPropertyValue('padding-inline-start')) -
        parseFloat(mainStyle.getPropertyValue('padding-inline-end')),
      segments: values('header [role="progressbar"][data-segments]', BOX),
      storyLanguage: values('header nav button[data-story-language]', BOX),
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }
  })
}

test.describe('the story player, P1-4 owner screens: the framed panel', { tag: '@review' }, () => {
  for (const at of PANEL_CASES) {
    for (const code of ENABLED_LOCALE_CODES) {
      for (const scale of [100, 150] as const) {
        test(`T2 /${code} ${at.story} ${at.node} at ${scale}%: the run area is a framed panel; the story keeps its width`, async ({
          page,
        }) => {
          test.skip(
            scale !== 100 && !PANEL_PHONES.includes(test.info().project.name),
            '150% text: the phones',
          )
          await openPanelCase(page, at, code, scale)
          const layout = await panelLayout(page)
          console.log(
            `[player] T2 /${code} ${at.node} ${scale}% (${test.info().project.name}): ` +
              JSON.stringify(layout),
          )
          const { panel, header, title, storyCard, endingCard, back } = layout
          // Preconditions: the scene gradient is painted, and everything measured is there.
          expect(layout.scene, 'precondition: the run area carries data-scene').not.toBeNull()
          expect(layout.backgroundImage, 'precondition: the scene gradient').toMatch(
            /^linear-gradient\(/,
          )
          if (!panel || !header || !title || !storyCard || !back) {
            throw new Error(`precondition: a measured element is missing ${JSON.stringify(layout)}`)
          }
          if (at.node === 'ending_light' && !endingCard) {
            throw new Error('precondition: no ending card')
          }

          // The panel's own box: the cards' radius, 24 px above and below, 12 px across, reaching
          // 12 px past main's content box; nothing clipped (focus rings near its edge show).
          expect(layout.radius, 'the panel radius').toEqual(['24px', '24px', '24px', '24px'])
          expect(layout.padding, 'the panel padding (block start, end; inline start, end)').toEqual(
            ['24px', '24px', '12px', '12px'],
          )
          expect(layout.margin, 'the panel margin-inline').toEqual(['-12px', '-12px'])
          expect(layout.overflow, 'the panel overflow').toEqual(['visible', 'visible'])

          // The gaps: 16 px outside the panel plus 24 px inside it.
          expect(
            Math.abs(title.top - header.bottom - 40),
            'header bottom to title top: 40 px',
          ).toBeLessThanOrEqual(0.5)
          expect(
            Math.abs(title.top - panel.top - 24),
            'panel top to title top: 24 px',
          ).toBeLessThanOrEqual(0.5)
          if (at.node === 'flat_stones') {
            expect(
              Math.abs(panel.bottom - back.bottom - 24),
              'Back bottom to panel bottom: 24 px',
            ).toBeLessThanOrEqual(0.5)
          }

          // Inside the panel across, at least its 12 px padding from each edge.
          const inside = [
            ['title', title],
            ['story card', storyCard],
            ...(endingCard ? [['ending card', endingCard] as const] : []),
          ] as const
          for (const [name, inner] of inside) {
            expect(
              inner.left - panel.left,
              `${name}: from the panel's start edge`,
            ).toBeGreaterThanOrEqual(11.5)
            expect(
              panel.right - inner.right,
              `${name}: from the panel's end edge`,
            ).toBeGreaterThanOrEqual(11.5)
          }
          // The story keeps today's width: the measure, or main's content width when narrower.
          expect(
            Math.abs(
              storyCard.right - storyCard.left - Math.min(layout.storyMax, layout.mainContent),
            ),
            `the story card width (measure ${layout.storyMax}, main content ${layout.mainContent})`,
          ).toBeLessThanOrEqual(0.5)

          // The segments and the switch share the marker class, not the panel's box.
          expect(layout.segments, 'the segments: padding block, inline; margin inline').toEqual([
            '0px',
            '0px',
            '0px',
            '0px',
            '0px',
            '0px',
          ])
          expect(layout.storyLanguage, 'the switch: padding block, inline; margin inline').toEqual([
            '4px',
            '4px',
            '16px',
            '16px',
            '0px',
            '0px',
          ])

          // On screen, with no horizontal scroll.
          expect(panel.left, 'the panel start edge on screen').toBeGreaterThanOrEqual(0)
          expect(panel.right, 'the panel end edge on screen').toBeLessThanOrEqual(layout.innerWidth)
          expect(layout.scrollWidth, 'horizontal scroll').toBeLessThanOrEqual(layout.clientWidth)
        })
      }
    }
  }

  // T2c: at 320 px (the narrowest width the spec names) the panel's edge, 4 px from the screen's,
  // stays on screen. A start edge past the screen's is not scrollable, so the scroll check alone
  // (T-a17) would not see it.
  for (const code of ENABLED_LOCALE_CODES) {
    for (const scale of [100, 150] as const) {
      test(`T2c /${code} at 320 px and ${scale}%: the panel stays on screen`, async ({ page }) => {
        test.skip(!PANEL_PHONES.includes(test.info().project.name), '320 px: the phones')
        const viewport = page.viewportSize()
        if (!viewport) throw new Error('the project sets no viewport')
        await page.setViewportSize({ width: 320, height: viewport.height })
        const at = PANEL_CASES[0]
        await openPanelCase(page, at, code, scale)
        const layout = await panelLayout(page)
        console.log(
          `[player] T2c /${code} ${scale}% (${test.info().project.name}): panel ` +
            `${JSON.stringify(layout.panel)}; scroll ${layout.scrollWidth}/${layout.clientWidth}`,
        )
        expect(layout.innerWidth, 'precondition: a 320 px viewport').toBe(320)
        if (!layout.panel) throw new Error('precondition: no panel')
        expect(layout.panel.left, 'the panel start edge on screen').toBeGreaterThanOrEqual(0)
        expect(layout.panel.right, 'the panel end edge on screen').toBeLessThanOrEqual(
          layout.innerWidth,
        )
        expect(layout.scrollWidth, 'horizontal scroll').toBeLessThanOrEqual(layout.clientWidth)
      })
    }
  }
})

// ---------------------------------------------------------------------------------------------
// P1-3 Step 12a (design p1-step12-design.md §13.4.3 E12-P2 to P5, CRIT-3, H-12c)

test.describe(
  'the story player, Step 12: the links to Home hold; H-12c',
  { tag: '@review' },
  () => {
    test('E12-P2 /en: the header Exit holds, so a tap on Home within it does nothing', async ({
      page,
      errors,
    }) => {
      await withHoldRetry(test.info(), async (n) => {
        const p = await attemptPage(page, errors, n)
        await watchNavHold(p)
        await openPlayer(p, playerPath('en', 'two-paths'))
        await expectHoldWatch(p)
        const tap = await heldTapIntoHome(p, 'en', 'header a[data-exit]')
        if (tap.gap === null || tap.gap < LATE_TAP_MS) await tap.verify()
        return tap
      })
    })

    test("E12-P3 /en: the error fallback's All stories holds, so a tap on Home within it does nothing", async ({
      page,
      errors,
    }) => {
      errors.allow({ chromium: [PLANTED_LINE], webkit: [PLANTED_LINE] })
      await withHoldRetry(test.info(), async (n) => {
        const p = await attemptPage(page, errors, n)
        await watchNavHold(p)
        // T-a22's plant: scrollIntoView throws once, so the first step's layout effect fails.
        await p.addInitScript((planted) => {
          const original = Element.prototype.scrollIntoView
          Element.prototype.scrollIntoView = function (
            this: Element,
            ...args: Parameters<Element['scrollIntoView']>
          ) {
            if (window.sessionStorage.getItem('e2e-planted-throw') === null) {
              window.sessionStorage.setItem('e2e-planted-throw', '1')
              throw new Error(planted)
            }
            return original.apply(this, args)
          }
        }, PLANTED_MESSAGE)
        await openPlayer(p, playerPath('en', 'two-paths'))
        await expect(p.locator(CHOICES)).not.toHaveAttribute('inert')
        await p.locator(choice('c1', 'start')).click()
        const fallbackLink = 'main[data-player-error] a[href="/en"]'
        await expect(p.locator(fallbackLink), 'precondition: the fallback is visible').toBeVisible()
        await expectHoldWatch(p)
        const tap = await heldTapIntoHome(p, 'en', fallbackLink)
        if (tap.gap === null || tap.gap < LATE_TAP_MS) await tap.verify()
        return tap
      })
    })

    // H-12c (T-a14's method): a client navigation into a resumed player never paints the start node
    // first. The sampler records every frame of this document; it is emptied just before the tap.
    for (const from of ['landing', 'home'] as const) {
      const id = from === 'landing' ? 'E12-P4' : 'E12-P5'
      test(`${id} /en: H-12c, ${from === 'landing' ? 'Continue on the landing' : "Home's Continue card"} into a resumed player never paints the start node`, async ({
        page,
      }) => {
        await seedProgressOnce(page, {
          'river-stones': { activeRun: { path: ['start', 'flat_stones'], locale: 'en' } },
        })
        await sampleOpeningFrames(page)
        const link =
          from === 'landing'
            ? '[data-actions] a[data-story-action="continue"]'
            : '[data-continue-story="river-stones"] a'
        const response = await page.goto(from === 'landing' ? '/en/stories/river-stones' : '/en')
        expect(response?.status(), `precondition: the ${from} page`).toBe(200)
        await expect(page.locator(link), `precondition: ${link} is shown`).toBeVisible()
        await page.evaluate(() => {
          const w = window as unknown as Record<string, unknown>
          w['__e2eSameDocument'] = true
          ;(w['__e2eFrames'] as unknown[]).length = 0
        })
        await page.locator(link).click()
        await expect
          .soft(page.locator(PLAYER), '(g1) the player opens')
          .toHaveAttribute('data-run-phase', 'open')
        await expect
          .soft(page.locator(PART), '(g1) the resumed node')
          .toHaveAttribute('data-node', 'flat_stones')
        await frames(page)
        expect
          .soft(await pageValue(page, '__e2eSameDocument'), '(g2) a client navigation only')
          .toBe(true)
        const seen = await openingFrames(page)
        const description = `${seen.frames} frames after the tap, ${seen.opening} opening, ${seen.painted} painted`
        test.info().annotations.push({ type: id, description })
        console.log(`[player] ${id} (${test.info().project.name}): ${description}`)
        expect(seen.frames, 'precondition: frames sampled after the tap').toBeGreaterThan(0)
        expect.soft(seen.painted, '(g3) opening frames that painted the start passage').toBe(0)
      })
    }

    // E12-P6 (round 2b, design §19; R2-FS-1, R2-TPP-6): the landing read nothing, so it shows
    // Start; then a run for the story is saved behind its back (the test writes the bytes another
    // tab's save leaves, which the landing does not follow, N8). Start sets the hint in every state,
    // so the resumed player never paints the start passage first. The sampler records every frame of
    // this document; it is emptied just before the tap.
    test('E12-P6 /en: H-12c, Start after another tab saved a run opens the resumed player without painting the start node', async ({
      page,
    }) => {
      await sampleOpeningFrames(page)
      const response = await page.goto('/en/stories/river-stones')
      expect(response?.status(), 'precondition: the landing').toBe(200)
      await expect(
        page.locator('[data-actions]'),
        'precondition: nothing stored, so the actions show Start',
      ).toHaveAttribute('data-shown', 'start')
      const raw = progressRecordBytes({
        'river-stones': { activeRun: { path: ['start', 'flat_stones'], locale: 'en' } },
      })
      const before = await page.evaluate(
        ([key, value]) => {
          window.localStorage.setItem(key, value)
          const w = window as unknown as Record<string, unknown>
          w['__e2eSameDocument'] = true
          ;(w['__e2eFrames'] as unknown[]).length = 0
          return {
            stored: window.localStorage.getItem(key) === value,
            shown: document.querySelector('[data-actions]')?.getAttribute('data-shown') ?? null,
            hint: document.documentElement.hasAttribute('data-saved-run'),
          }
        },
        [PROGRESS_KEY, raw] as const,
      )
      expect(
        before,
        'precondition: the run is stored, the landing still shows Start, no hint before the tap',
      ).toEqual({ stored: true, shown: 'start', hint: false })
      await page.locator('[data-actions] a[data-story-action="start"]').click()
      await expect
        .soft(page.locator(PLAYER), '(g1) the player opens')
        .toHaveAttribute('data-run-phase', 'open')
      await expect
        .soft(page.locator(PART), '(g1) the player resumes the saved run')
        .toHaveAttribute('data-node', 'flat_stones')
      await frames(page)
      expect
        .soft(await pageValue(page, '__e2eSameDocument'), '(g2) a client navigation only')
        .toBe(true)
      const seen = await openingFrames(page)
      const description = `${seen.frames} frames after the tap, ${seen.opening} opening, ${seen.painted} painted, ${seen.saved} with the hint`
      test.info().annotations.push({ type: 'E12-P6', description })
      console.log(`[player] E12-P6 (${test.info().project.name}): ${description}`)
      expect(seen.opening, 'precondition: opening frames sampled after the tap').toBeGreaterThan(0)
      expect.soft(seen.painted, '(g3) opening frames that painted the start passage').toBe(0)
    })
  },
)

// The collector's own negative tests (design §9.3 C4, F5): each must fail in the auto fixture's
// check, so each is marked test.fail(); one passing here means the collector lets that form by.
test.describe('the console collector (self-test)', { tag: '@review' }, () => {
  test('fails a console error the test did not declare', async ({ page }) => {
    test.fail()
    await page.evaluate(() => console.error('e2e collector self-test'))
    await page.waitForTimeout(100)
  })

  test('fails a page error', async ({ page }) => {
    test.fail()
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('e2e collector self-test')
      }, 0)
    })
    await page.waitForTimeout(200)
  })

  test('fails a declared pattern that matched nothing', async ({ errors }) => {
    test.fail()
    errors.allow({ chromium: [/^e2e never logged$/], webkit: [/^e2e never logged$/] })
  })

  test('fails an error declared for the other engine only', async ({
    page,
    errors,
    browserName,
  }) => {
    test.fail()
    const line = /^e2e collector self-test$/
    errors.allow(browserName === 'chromium' ? { webkit: [line] } : { chromium: [line] })
    await page.evaluate(() => console.error('e2e collector self-test'))
    await page.waitForTimeout(100)
  })
})
