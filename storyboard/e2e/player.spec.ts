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
import type { Page, Request } from '@playwright/test'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../src/core/locales'
import { PROGRESS_KEY } from '../src/core/progress/records'
import { expect, test as base } from './fixtures'
import {
  consoleErrors,
  fixtureGraph,
  focusByKeyboard,
  prefsText,
  progressSpy,
  seedPrefs,
  seedProgressOnce,
  settleFonts,
  walk,
  type ConsoleErrors,
  type FixtureGraph,
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

const PLAYER = '[data-player]'
const PART = '[data-part]'
const CHOICES = 'ul[data-choices]'
/** The 404 document's one console line, on both engines (probe P-CON, design §16). */
const NOT_FOUND_LINE =
  /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/
/** An aborted script load (T-a9 failsafe): Chromium only, the line of an aborted image (design O3). */
const CHUNK_FAILED_LINE = /^Failed to load resource: net::ERR_FAILED$/
const PLANTED_MESSAGE = 'e2e planted scrollIntoView failure'
/** Next logs each error a boundary catches: WebKit the line alone, Chromium with the stack after. */
const PLANTED_LINE = new RegExp(`^Error: ${PLANTED_MESSAGE}(?:\\n|$)`)
/** A second tap this long after the commit says nothing about the settle (F4). */
const LATE_TAP_MS = 450
const LORA_FILE = /\/_next\/static\/media\/lora[^/]*\.woff2$/
const NOTO_FILE = /\/_next\/static\/media\/noto[-_]sans[-_]devanagari[^/]*\.woff2$/

/** A choice button, in the part on screen or in the part of `node`. */
function choice(id: string, node?: string): string {
  return `${node === undefined ? PART : `[data-part][data-node="${node}"]`} button[data-choice="${id}"]`
}

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

async function waitOpen(page: Page): Promise<void> {
  await expect(page.locator(PLAYER)).toHaveAttribute('data-run-phase', 'open')
}

/** Waits until the choices on screen are no longer inert (the settle after a step has ended). */
async function waitSettled(page: Page): Promise<void> {
  await expect(page.locator(CHOICES)).not.toHaveAttribute('inert')
}

async function openPlayer(page: Page, url: string): Promise<void> {
  const response = await page.goto(url)
  expect(response?.status(), url).toBe(200)
  await waitOpen(page)
}

/** Resolves after `count` animation frames of the page. */
async function frames(page: Page, count = 2): Promise<void> {
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
async function pageValue<T>(page: Page, name: string): Promise<T> {
  return page.evaluate(
    (key) => (window as unknown as Record<string, unknown>)[key],
    name,
  ) as Promise<T>
}

interface StoredStory {
  readonly activeRun: { readonly path: readonly string[]; readonly locale: string } | null
  readonly endingsFound: readonly string[]
}

/** The stored progress of one story, or null when there is none. */
async function storedStory(page: Page, storyId: string): Promise<StoredStory | null> {
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

interface Point {
  readonly x: number
  readonly y: number
  readonly scrolled: boolean
}

/**
 * The centre of `selector` in viewport coordinates, for a coordinate click (F4): when it lies
 * outside the viewport, the element is scrolled into view by evaluate and measured again.
 */
async function centreInViewport(page: Page, selector: string): Promise<Point> {
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

interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  return page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  })
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

/** Before any page script: every value the live region holds, in order, without repeats. */
async function recordAnnouncements(page: Page): Promise<void> {
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

async function announcements(page: Page): Promise<string[]> {
  return (await pageValue<string[]>(page, '__e2eLiveRegion')).filter((text) => text !== '')
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
        await expect(page.locator('#live-region')).toHaveText(
          formatted(uiLang(code), 'player.page', { n: index + 2 }),
        )
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
      const pages = graph.firstPath.choices.map((_choice, index) =>
        formatted(lang, 'player.page', { n: index + 2 }),
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
