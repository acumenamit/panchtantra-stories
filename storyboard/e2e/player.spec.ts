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
import type { Page, Request } from '@playwright/test'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../src/core/locales'
import { PROGRESS_KEY } from '../src/core/progress/records'
import { TEXT_SCALE_ATTRIBUTE } from '../src/core/progress/text-scale-boot'
import { SETTLE_MS } from '../src/reader/player/view'
import { expect, test as base } from './fixtures'
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
  progressSpy,
  recordAnnouncements,
  RUN,
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
  PLAYER_NOT_FOUND_PATHS,
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
 * Starts counting the page's requests in flight. The returned function waits until none has been
 * in flight for `quietMs` (load states are sticky, so waitForLoadState('networkidle') can return
 * while a later router prefetch is in flight).
 * Precondition (review R2-FLK-4): start it after the test's last reload or cross-document
 * navigation, and use it only to guard the next one. Chromium can drop a request that a reload
 * cancels (an _rsc prefetch, a chunk) with neither requestfinished nor requestfailed, so it would
 * stay in flight here forever. Clearing the set on framenavigated is no fix: same-document
 * navigations fire it too.
 */
function trackRequests(page: Page): (quietMs?: number) => Promise<void> {
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
    const quiet = trackRequests(page)
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

  for (const code of ENABLED_LOCALE_CODES) {
    test(`T-a20 /${code}: fonts held 1.5 s shift a fresh player by less than 0.1 (Chromium)`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'the Layout Instability API is Chromium only')
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
      const { cls, raw, shifts, inputShifts } = await layoutShift(page)
      const description =
        `CLS ${cls.toFixed(6)}, raw ${raw.toFixed(6)} (${shifts} shifts, ${inputShifts} flagged ` +
        `as recent input; ${delayed} font files held; first paint ${timing.firstPaint.toFixed(0)} ` +
        `ms, fonts arrived ${timing.fontEnd.toFixed(0)} ms)`
      console.log(`[player] T-a20 /${code} (${test.info().project.name}): ${description}`)
      test.info().annotations.push({ type: 'CLS', description })
      // The page painted before the fonts arrived, so the swap was measured.
      expect(timing.firstPaint).toBeLessThan(timing.fontEnd)
      expect(cls).toBeLessThan(0.1)
    })
  }

  for (const notFoundPath of PLAYER_NOT_FOUND_PATHS) {
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
    const quiet = trackRequests(page)
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
  readonly choicesInert: boolean | null
  readonly backInert: boolean | null
}

interface HoldRecord {
  readonly closeAt: number | null
  readonly heldAt: number | null
  readonly releasedAt: number | null
  readonly downs: readonly HoldTap[]
}

/**
 * In the page, for T-b10 (R2-STRESS-1): the time the restart dialog's close event is dispatched
 * (a capturing listener on document, so it runs before the dialog's own close handler and the
 * hold it starts); after that close, the times the run area's choices became inert (the hold) and
 * then lost inert again (the release), from a MutationObserver on the run area; and for every
 * pointerdown (capture phase on document) its time, the run-area control whose box holds the
 * pointer (inert or not, as T-b2 measures), its target, and whether the choices and Back are inert.
 */
async function watchHold(page: Page): Promise<void> {
  await page.evaluate(
    ([dialog, run, choices, footer, controls]) => {
      const record: {
        closeAt: number | null
        heldAt: number | null
        releasedAt: number | null
        downs: HoldTap[]
      } = { closeAt: null, heldAt: null, releasedAt: null, downs: [] }
      ;(window as unknown as Record<string, unknown>)['__e2eHold'] = record
      const inertOf = (selector: string): boolean | null =>
        document.querySelector(selector)?.hasAttribute('inert') ?? null
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
          const control = [...document.querySelectorAll(controls)].find((candidate) => {
            const box = candidate.getBoundingClientRect()
            return (
              event.clientX >= box.left &&
              event.clientX <= box.right &&
              event.clientY >= box.top &&
              event.clientY <= box.bottom
            )
          })
          const target = event.target instanceof Element ? event.target : null
          record.downs.push({
            t: performance.now(),
            control: control === undefined ? null : (control.getAttribute('data-choice') ?? 'back'),
            target:
              target === null
                ? 'none'
                : `${target.tagName.toLowerCase()}${[...target.attributes]
                    .filter((attribute) => attribute.name.startsWith('data-'))
                    .map((attribute) => `[${attribute.name}]`)
                    .join('')}`,
            choicesInert: inertOf(choices),
            backInert: inertOf(footer),
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
    ] as const,
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
    const quiet = trackRequests(page)
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
  // Escape) holds the run area for SETTLE_MS like a step. The page records what lies under the
  // tap (a choice or Back, by its box) and whether the run area was inert at the tap, so the test
  // proves the hold on a project where nothing interactive lies there too; the release is timed
  // from the close event in the page.
  for (const cancel of ['Keep reading', 'Escape'] as const) {
    const name =
      cancel === 'Keep reading'
        ? 'T-b10 a double tap on Keep reading never moves the story'
        : 'T-b10 Escape on the restart dialog holds the run area too: a tap under Keep reading never moves the story'
    test(name, async ({ page }) => {
      const path = ['start', 'flat_stones', 'big_rock']
      // A tap that lands after the hold proves nothing (and may then move the story, as it should),
      // so a late tap is retried from a fresh seed and open, at most 3 attempts in all (as T-b4's
      // settle case). The double tap is one dblclick (two taps 120 ms apart, down to down: the
      // first closes the dialog), so no round trip of the runner sits between the close and the
      // second tap; the tap after Escape follows the close event as soon as the page has seen it.
      const notes: string[] = []
      let seq = ''
      let epoch = ''
      let keep: Point = { x: 0, y: 0, scrolled: false }
      let taps: HoldRecord = { closeAt: null, heldAt: null, releasedAt: null, downs: [] }
      let late: number | null = null
      for (let attempt = 1; ; attempt++) {
        await seedProgressOnce(page, { 'river-stones': { activeRun: { path, locale: 'en' } } })
        await openPlayer(page, playerPath('en', 'river-stones'))
        await settleFonts(page)
        await expect(page.locator(PART)).toHaveAttribute('data-node', 'big_rock')
        await waitSettled(page)
        seq = (await page.locator(PART).getAttribute('data-seq')) ?? ''
        epoch = (await page.locator(RUN).getAttribute('data-epoch')) ?? ''
        await page.locator(MENU).click()
        await expect(page.locator(PANEL)).toBeVisible()
        await page.locator(MENU_RESTART).click()
        await expect(page.locator(DIALOG), 'the dialog after Start again').toHaveJSProperty(
          'open',
          true,
        )
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
      notes.push(
        `Keep reading centre ${Math.round(keep.x)},${Math.round(keep.y)}`,
        tap === undefined || tap.control === null
          ? 'nothing interactive under the tap: the hold is asserted through the inert run area'
          : `under the tap: ${tap.control === 'back' ? 'Back' : `choice ${tap.control}`}`,
        `target ${tap?.target ?? 'none'}`,
      )
      test.info().annotations.push({ type: 'T-b10', description: notes.join('; ') })
      console.log(`[player] T-b10 ${cancel} (${test.info().project.name}): ${notes.join('; ')}`)

      expect(taps.downs.length, 'the taps').toBe(cancel === 'Keep reading' ? 2 : 1)
      expect(late, 'the close and tap times').not.toBeNull()
      expect(
        late !== null && late > 0 && late < LATE_TAP_MS,
        `timing: the tap came ${late} ms after the close (450 ms or more proves nothing)`,
      ).toBe(true)
      // The story never moved.
      await expect(page.locator(PART), 'the node after the taps').toHaveAttribute(
        'data-node',
        'big_rock',
      )
      await expect(page.locator(PART), 'the seq after the taps').toHaveAttribute('data-seq', seq)
      await expect(page.locator(RUN), 'the run after the taps').toHaveAttribute('data-epoch', epoch)
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
        `[player] T-b10 ${cancel} (${test.info().project.name}): held ${onset.toFixed(0)} ms ` +
          `after the close, released ${heldFor.toFixed(0)} ms after it`,
      )
      expect(heldFor, 'the hold, from the close to the release').toBeGreaterThanOrEqual(
        SETTLE_MS - 20,
      )
      expect(heldFor, 'the hold, from the close to the release').toBeLessThan(4 * SETTLE_MS)
      await expect(page.locator(CHOICES), 'the choices after the hold').not.toHaveAttribute('inert')
      await expect(page.locator(FOOTER), 'Back after the hold').not.toHaveAttribute('inert')
      expect(await storedPath(page, 'river-stones'), 'the stored run after the taps').toEqual(path)
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
