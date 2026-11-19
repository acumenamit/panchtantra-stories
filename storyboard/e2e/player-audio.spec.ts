// Narration in the story player, Step 11 (spec §6.4, SPEC:475-482, :500-502, :518; REQ:210;
// design p1-step11-design.md §4.3-§4.8, §8, §13.1-§13.4, §13.8, §13.9; P1-5a). Staging leg only
// (@staging), 5 projects: the staging harness (scripts/testing/staging-build.ts) adds a test-only
// narrated story derived in memory from the river-stones fixture: the fixture's graph and texts and
// 15 clips (every node in en and hi but big_rock in hi), each the 42-frame silent MP3. Only this
// spec opens its pages (the Vitest scan of e2e/ holds the id to this file and routes.ts, T11-24):
// on Windows WebKit a detached audio element's request escapes
// Playwright's network layer (PR-3), so a narration tap anywhere else could reach the real media
// origin unseen. Its clip URLs come from scripts/testing/narration-story.ts through
// e2e/narration-media.ts, the harness (13.2 H1, H3 to H6); the media answer (H2) is in
// e2e/media-answer.ts.
// - FAKE (13.4.1, 13.4.2; every engine; no media stub): before any page script the audio element
//   page code makes is a scripted fake, and a tripwire blocks and records every way to load a real
//   media element (the fake fixture fails the test if its log is not empty). Every FAKE test first
//   asks the page that the fake is installed after hydration with no page error (C7, unprobed on a
//   hydrated page before the build), and after its first narration tap that exactly one fake was
//   made. Play outcomes and media events are the test's: resolvePlay, rejectPlay(name), emit().
// - SPY and NETWORK (13.4.3, 13.4.4): the real element, its calls logged. They run on Chromium only,
//   where the engine's media answer (H2, asked once per worker before any media URL is set) shows
//   its audio requests routed with no escape, NETWORK and S5 also decoded; on every WebKit they skip
//   before the first navigation, with the answer as the reason (S10: Windows WebKit, PR-3; Linux
//   WebKit answered routed, yet the guard saw clip requests the stub never answered, CI run
//   44604741639, design §23). The media stub
//   serves the silent clip for the 15 clip URLs; a route of the test's own records each clip
//   request and passes it on with route.fallback(), so the stub still answers it.
// - The click bracket (H5): play() inside the trusted click and before the first write of the key
//   the tap saves; never "the write is outside the click" (the save is a microtask the handler
//   queues, CRIT-8). Every wait is an in-page timer from a page stamp; bounds are lower bounds
//   (450 ms for the 500 ms announcement, 600 ms "after the hold"), upper bounds only as expect
//   timeouts (TIMING TESTS).
// - Labels come from messages/*.json; the playback button's label is read by its accessible name
//   or data-kind, never its text (it holds all four labels, N26).
// - Assertion groups are soft, each message starting with its group; preconditions are hard.
// - Every test collects console errors and page errors and fails on any it did not declare. SPY and
//   NETWORK allow only the failed-load lines they actually saw (allowObserved, 13.1 E; unprobed on
//   Linux, 13.8 P13); the wide-fallback variants allow Chromium's aborted-font line.
// - The run-area hold (design §20.3.4, N27; REQ:273): after an applied narration tap the choices,
//   Back, the ending card's actions and the AI voice link refuse taps for 500 ms; the footer and the
//   narration buttons are never held and keep focus; the header is not held. In-hold taps are
//   page.mouse.click at a centre read in the hold (one frame after the narration key, so Chromium's
//   scroll anchoring has run) or a dispatched element.click(), never locator.click() (it waits
//   for the release, P22, proven by T11-M5 g5) or force; each is less than LATE_TAP_MS after the
//   narration tap's click, else the test repeats from a fresh open (3 attempts). The hold watch
//   (H7) reads what lies under a point from element boxes. HL2c (design §21) puts focus on a node
//   the hold makes inert first (focus(), or the manual Share field after a refused copy), then taps
//   Read to me with the mouse and with the touchscreen: focus is never left there or dropped.
// - The owner screens 30-35 (13.4.8) are the last describe: local only, skipped unless SCREENS=1.
import type { Page } from '@playwright/test'
import { MEDIA_ORIGIN } from '../src/config/security-headers'
import type { LocaleCode } from '../src/core/locales'
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  PROGRESS_KEY,
  RECORD_SCHEMA,
  serializePrefs,
  serializeProgress,
  type ProgressRecord,
} from '../src/core/progress/records'
import { NARRATION_CLIP } from '../scripts/testing/narration-story'
import { NARRATION_STORY_ID } from '../scripts/testing/narration-story-id'
import { SETTLE_MS } from '../src/reader/player/view'
import { expect, test as base } from './fixtures'
import {
  ABORTED_LINE,
  allowObserved,
  armHoldSamples,
  CLIP_URLS,
  clipUrl,
  expectFakeInstalled,
  fakeControl,
  fakeState,
  HOLD_NODES,
  holdOnset,
  holdRelease,
  holdWatch,
  inputAfter,
  installAudioSpy,
  installFakeAudio,
  installHoldWatch,
  installMutantFlag,
  markHoldFocus,
  MEDIA_STATUS_LINE,
  narrationPrefsText,
  narrationRecord,
  pageNow,
  sampleAt,
  shiftsOutside,
  waitAfter,
  type FakePatch,
  type HoldNode,
  type HoldSnapshot,
  type NarrationHandle,
  type NarrationLogEntry,
} from './narration-media'
import { mediaAllows, mediaAnswerFor, mediaAnswerText } from './media-answer'
import {
  centreInViewport,
  choice,
  consoleErrors,
  expectWideFallback,
  FIRST_PARAGRAPH,
  fixtureGraph,
  frames,
  LATE_TAP_MS,
  openPlayer,
  pageValue,
  PART,
  prepareVariant,
  ROW_PHONES,
  RUN,
  seedPrefs,
  settleForScreenshot,
  step10ScreenPath,
  tabReachesLinks,
  waitOpen,
  type ConsoleErrors,
  type RowVariant,
} from './page-helpers'
import {
  blockStorage,
  formatted,
  layoutShift,
  liveRegions,
  message,
  playerFixture,
  playerPath,
  recordLayoutShifts,
  uiLang,
} from './routes'

const test = base.extend<{ errors: ConsoleErrors; mutant: void; fake: NarrationHandle }>({
  errors: [
    async ({ page, browserName }, use) => {
      const errors = consoleErrors(page)
      await use(errors)
      errors.check(browserName)
    },
    { auto: true },
  ],
  // The mutant schema's flag (13.6 MB-S): nothing at all unless E2E_MUTANT is set.
  mutant: [
    async ({ page }, use) => {
      await installMutantFlag(page)
      await use()
    },
    { auto: true },
  ],
  // FAKE mode (H1, H4): installed before the test's first navigation; at teardown the tripwire log
  // must be empty, in Node's copy (every document) and in the page's own (A34). A plain fixture
  // function; its second parameter is not named use (react-hooks lint).
  fake: async ({ page }, provide) => {
    const handle = await installFakeAudio(page)
    await provide(handle)
    const inPage = await narrationRecord(page)
      .then((record) => record.tripwire)
      .catch(() => [])
    expect(
      [...handle.tripwire(), ...inPage],
      'H4: the tripwire log (a real media element was asked to load)',
    ).toEqual([])
  },
})

// ---------------------------------------------------------------------------------------------
// The narrated story, as the staging harness derives it (design §3.23, §8.1)

const STORY = NARRATION_STORY_ID
/** The fixture it is derived from: the same graph, texts and version. */
const SOURCE_ID = 'river-stones'
const GRAPH = fixtureGraph(SOURCE_ID)
const CODES: readonly LocaleCode[] = ['en', 'hi']
const urlOf = (code: LocaleCode): string => playerPath(code, STORY)

const GROUP = '[data-part] [data-narration]'
const READ = `${GROUP} [data-read-to-me]`
const PLAYBACK = `${GROUP} [data-narration-control]`
const AI_VOICE = `${GROUP} [data-ai-voice]`
const MESSAGE = `${GROUP} [data-narration-message]`
const FOOTER = '[data-part] footer[data-part-controls]'
const BACK = `${FOOTER} [data-back]`
const CHOICES = '[data-part] ul[data-choices]'
const TITLE = '[data-part] [data-story] h1'
const CARD_ACTIONS = '[data-part] section[data-ending] [data-ending-actions]'
const TRY_ANOTHER = `${CARD_ACTIONS} button[data-try-another]`
const MENU = 'button[data-menu]'
const MENU_RESTART = 'button[data-restart]'
const DIALOG_ACCEPT = 'dialog[data-restart-confirm] button[data-restart-accept]'
const SWITCH = 'button[data-story-language]'
const ALL_STORIES = 'header a[data-exit]'
const STORAGE_BANNER = 'section[aria-labelledby="storage-banner-title"]'
/** The hooks whose own box may change on a narration change (L1, L3; N26). */
const NARRATION_BOXES = ['[data-narration-control]', '[data-narration-message]'] as const
/** "After the hold": a narration tap this long after the last applied one applies (N17). */
const AFTER_HOLD_MS = 600
/** The wait for the announcement's lower bound (500 ms, measured from page stamps). */
const ANNOUNCE_MIN_MS = 450

const label = (code: LocaleCode, key: string): string => message(uiLang(code), key)
const pageN = (code: LocaleCode, n: number): string => formatted(uiLang(code), 'player.page', { n })
const MEDIA_CALLS: ReadonlySet<string> = new Set([
  'create',
  'preload',
  'setAttribute',
  'removeAttribute',
  'play',
  'pause',
  'load',
  'currentTime',
])
const mediaCalls = (log: readonly NarrationLogEntry[]): NarrationLogEntry[] =>
  log.filter((entry) => MEDIA_CALLS.has(entry.call))
const callNames = (log: readonly NarrationLogEntry[]): string[] =>
  log.map((entry) => (entry.call === 'setAttribute' ? `setAttribute ${entry.name}` : entry.call))

/** One trusted click the test made: its bracket id and the page time it opened. */
interface Tap {
  readonly id: number
  readonly t: number
}

/** The first trusted click after the `before`-th one (a click or the keyboard's click). */
async function trustedClickAfter(page: Page, before: number, what: string): Promise<Tap> {
  const clicks = (await narrationRecord(page)).clicks.filter((click) => click.id > before)
  const click = clicks.find((stamp) => stamp.isTrusted)
  if (click === undefined) throw new Error(`no trusted click was seen for ${what}`)
  return { id: click.id, t: click.open }
}

/** A trusted click on `selector`; returns its bracket. */
async function tap(page: Page, selector: string): Promise<Tap> {
  const before = (await narrationRecord(page)).clicks.length
  await page.locator(selector).click()
  return trustedClickAfter(page, before, selector)
}

/** Enter on the focused `selector`: the keyboard-made click (13.8 P14). */
async function enterOn(page: Page, selector: string): Promise<Tap> {
  const before = (await narrationRecord(page)).clicks.length
  await page.locator(selector).focus()
  await page.keyboard.press('Enter')
  return trustedClickAfter(page, before, `Enter on ${selector}`)
}

/**
 * Where a tap's play() landed: the first src set and play() at or after the tap's bracket opened,
 * whether both are inside that bracket (a trusted click), and whether play() comes before the first
 * write of `key` after the tap (null: no key to compare).
 */
function playOf(log: readonly NarrationLogEntry[], at: Tap, key: string | null) {
  const after = log.filter((entry) => entry.t >= at.t)
  const set = after.find((entry) => entry.call === 'setAttribute' && entry.name === 'src')
  const play = after.find((entry) => entry.call === 'play')
  const playAt = play === undefined ? -1 : log.indexOf(play)
  const writeAt =
    key === null
      ? -1
      : log.findIndex((entry) => entry.t >= at.t && entry.call === 'setItem' && entry.key === key)
  return {
    src: set === undefined ? null : set.value,
    srcInTap: set !== undefined && set.clickId === at.id,
    playInTap: play !== undefined && play.clickId === at.id,
    trusted: play !== undefined && play.isTrusted === true,
    playBeforeWrite: key === null ? null : playAt >= 0 && (writeAt < 0 || playAt < writeAt),
  }
}

const PLAYED = (src: string, key: string | null) => ({
  src,
  srcInTap: true,
  playInTap: true,
  trusted: true,
  playBeforeWrite: key === null ? null : true,
})

/** The hard precondition of every "play before the write" group (13.1 J). */
function expectWriteIn(log: readonly NarrationLogEntry[], at: Tap, key: string): void {
  expect(
    log.some((entry) => entry.call === 'setItem' && entry.key === key && entry.clickId === at.id),
    `precondition (13.1 J): the storage log holds a write of ${key} inside the tap`,
  ).toBe(true)
}

/** Opens the narrated story's page; seeds the prefs first when asked. */
async function openNarrated(
  page: Page,
  code: LocaleCode,
  prefs: { readonly readToMe?: boolean; readonly textScale?: 100 | 125 | 150 } = {},
): Promise<void> {
  if (prefs.readToMe !== undefined || prefs.textScale !== undefined) {
    await seedPrefs(
      page,
      narrationPrefsText({ textScale: prefs.textScale ?? 100, readToMe: prefs.readToMe ?? false }),
    )
  }
  await openPlayer(page, urlOf(code))
}

/** FAKE: the precondition after the first narration tap: page code made exactly one fake. */
async function expectMadeOne(page: Page): Promise<void> {
  expect((await narrationRecord(page)).made, 'precondition: exactly one audio element made').toBe(1)
}

/** FAKE: Read to me on, the start part's clip playing (resolvePlay). Returns the Read to me tap. */
async function onAndPlaying(page: Page): Promise<Tap> {
  const on = await tap(page, READ)
  await expectMadeOne(page)
  await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'loading')
  await fakeControl(page, 'resolvePlay')
  await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
  return on
}

/**
 * Takes `choices` from the part on screen, as walk() does for a fixture story: before each tap the
 * run is open and the choices are no longer inert; after it, the next part (seq + 1) shows the node
 * the river-stones graph names. FAKE with Read to me on: `resolve` resolves each step's play.
 */
async function walkNarrated(
  page: Page,
  choices: readonly string[],
  options: { readonly resolve?: boolean } = {},
): Promise<Tap[]> {
  const part = page.locator(PART)
  const taps: Tap[] = []
  for (const choiceId of choices) {
    await waitOpen(page)
    await expect(page.locator('[data-part] ul[data-choices]')).not.toHaveAttribute('inert')
    const node = (await part.getAttribute('data-node')) ?? ''
    const seq = Number(await part.getAttribute('data-seq'))
    const next = GRAPH.nodes.get(node)?.choices.find((option) => option.id === choiceId)?.next
    if (next === undefined) throw new Error(`${SOURCE_ID}: node ${node} has no choice ${choiceId}`)
    taps.push(await tap(page, choice(choiceId, node)))
    await expect(part).toHaveAttribute('data-seq', String(seq + 1))
    await expect(part).toHaveAttribute('data-node', next)
    if (options.resolve === true) {
      await fakeControl(page, 'resolvePlay')
      await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
    }
  }
  return taps
}

/** The run footer is no longer inert (the settle after a step has ended). */
async function waitFooterSettled(page: Page): Promise<void> {
  await expect(page.locator(FOOTER)).not.toHaveAttribute('inert')
}

/** The seed page this spec serves itself (page.route): an empty same-origin page, no app code. */
const SEED_PATH = '/e2e-seed-narrated'

/**
 * Stores a progress record for the narrated story once, as an earlier visit would have left it
 * (seedProgressOnce's way; it reads the fixtures catalogue, which does not hold this story). The
 * derived story keeps the fixture's version.
 */
async function seedNarratedProgress(
  page: Page,
  activeRun: { readonly path: readonly string[]; readonly locale: LocaleCode },
): Promise<void> {
  const record: ProgressRecord = {
    schema: RECORD_SCHEMA,
    stories: {
      [STORY]: {
        version: playerFixture(SOURCE_ID).version,
        activeRun,
        endingsFound: [],
        order: 1,
      },
    },
  }
  const raw = serializeProgress(record)
  await seedOnSamePage(page, [[PROGRESS_KEY, raw]])
}

/** Writes `items` to localStorage from an empty same-origin page served by the test. */
async function seedOnSamePage(
  page: Page,
  items: readonly (readonly [string, string])[],
): Promise<void> {
  const isSeedPage = (url: URL): boolean => url.pathname === SEED_PATH
  await page.route(isSeedPage, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="en"><head><title>e2e seed</title></head></html>',
    }),
  )
  const response = await page.goto(SEED_PATH)
  expect(response?.status(), 'the page that seeds the record').toBe(200)
  for (const [key, value] of items) {
    const stored = await page.evaluate(
      ([k, v]) => {
        window.localStorage.setItem(k, v)
        return window.localStorage.getItem(k)
      },
      [key, value] as const,
    )
    expect(stored, `the seeded ${key}`).toBe(value)
  }
  await page.unroute(isSeedPage)
}

/** The stored prefs' readToMe, or null when nothing is stored. */
async function storedReadToMe(page: Page): Promise<boolean | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    return (JSON.parse(raw) as { readToMe?: boolean }).readToMe ?? null
  }, PREFS_KEY)
}

/** Each [data-read-to-me] button tag in server HTML: its aria-pressed value. */
function serverPressed(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*\bdata-read-to-me\b[^>]*>/g)].map(
    (match) => /\baria-pressed="(true|false)"/.exec(match[0])?.[1] ?? 'missing',
  )
}

/** The live region's non-empty texts recorded from `from` on (page time). */
async function liveTextsSince(page: Page, from: number): Promise<{ text: string; t: number }[]> {
  return (await narrationRecord(page)).live
    .filter((stamp) => stamp.t >= from && stamp.value !== null && stamp.value !== '')
    .map((stamp) => ({ text: stamp.value ?? '', t: stamp.t }))
}

/** When the message first took `value` at or after `from` (page time), or null. */
async function messageAppeared(page: Page, value: string, from: number): Promise<number | null> {
  const stamp = (await narrationRecord(page)).messages.find(
    (entry) => entry.value === value && entry.t >= from,
  )
  return stamp === undefined ? null : stamp.t
}

// ---------------------------------------------------------------------------------------------
// FAKE mode (13.4.1)

test.describe('narration in the player, Step 11: the fake element', { tag: '@staging' }, () => {
  for (const code of CODES) {
    test(`T11-F1 /${code}: opening and resuming never create, load or play audio, whatever Read to me says`, async ({
      page,
      fake,
      errors,
    }) => {
      void fake
      const loads: { name: string; readToMe: boolean; resumed: boolean }[] = [
        { name: '(a) Read to me off', readToMe: false, resumed: false },
        { name: '(b) Read to me remembered', readToMe: true, resumed: false },
        {
          name: '(c) resumed at round_stones, Read to me remembered',
          readToMe: true,
          resumed: true,
        },
      ]
      for (const load of loads) {
        await seedPrefs(page, narrationPrefsText({ textScale: 100, readToMe: load.readToMe }))
        if (load.resumed) {
          await seedNarratedProgress(page, { path: ['start', 'round_stones'], locale: code })
        }
        const response = await page.goto(urlOf(code))
        // WebKit revalidates a document this page loaded before ((c) comes back to it after the
        // seed page): a 304 has no body, so the server's HTML is then read with a plain GET.
        const status = response?.status()
        expect([200, 304], `${load.name}: the page (status ${status})`).toContain(status)
        const html =
          status === 200
            ? ((await response?.text()) ?? '')
            : await (await page.request.get(urlOf(code))).text()
        await waitOpen(page)
        await expectFakeInstalled(page, errors)
        const opened = await pageNow(page)
        await waitAfter(page, opened, 1000)
        if (load.resumed) {
          await expect(page.locator(PART), `precondition ${load.name}`).toHaveAttribute(
            'data-node',
            'round_stones',
          )
        }
        const record = await narrationRecord(page)
        expect
          .soft(
            { made: record.made, calls: callNames(mediaCalls(record.log)) },
            `(g1) ${load.name}: no audio element, no call`,
          )
          .toEqual({ made: 0, calls: [] })
        expect
          .soft(serverPressed(html), `(g2) ${load.name}: the server says off`)
          .toEqual(['false'])
        await expect
          .soft(page.locator(READ), `(g2) ${load.name}: aria-pressed after hydration`)
          .toHaveAttribute('aria-pressed', String(load.readToMe))
        if (load.readToMe) {
          await expect
            .soft(page.locator(GROUP), `(g2) ${load.name}: data-on`)
            .toHaveAttribute('data-on')
          await expect
            .soft(page.locator(PLAYBACK), `(g3) ${load.name}: Tap to listen offered`)
            .toHaveAttribute('data-kind', 'tap-to-listen')
          await expect
            .soft(page.locator(PLAYBACK), `(g3) ${load.name}: no pulse`)
            .not.toHaveAttribute('data-pulse')
          await expect.soft(page.locator(MESSAGE), `(g3) ${load.name}: no message`).toHaveCount(0)
        } else {
          await expect
            .soft(page.locator(GROUP), `(g2) ${load.name}: no data-on`)
            .not.toHaveAttribute('data-on')
          await expect.soft(page.locator(FOOTER), '(g5) page 1 has the run footer').toHaveCount(1)
          await expect.soft(page.locator(GROUP), '(g5) with the narration group').toHaveCount(1)
          await expect.soft(page.locator(BACK), '(g5) and no Back').toHaveCount(0)
        }
        if (load.resumed) {
          await waitAfter(page, opened, AFTER_HOLD_MS)
          const listen = await tap(page, PLAYBACK)
          await expectMadeOne(page)
          expect
            .soft(
              playOf((await narrationRecord(page)).log, listen, null),
              '(g4) Tap to listen plays the resumed part inside the trusted click',
            )
            .toEqual(PLAYED(clipUrl('round_stones', code), null))
        }
      }
    })
  }

  test('T11-F2 /en: Read to me plays the current part inside the tap, then writes the pref; off stops, then writes', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    const on = await tap(page, READ)
    await expectMadeOne(page)
    const first = (await narrationRecord(page)).log
    expectWriteIn(first, on, PREFS_KEY)
    const inTap = mediaCalls(first).filter((entry) => entry.clickId === on.id)
    expect
      .soft(
        inTap.map((entry) => [entry.call, entry.call === 'preload' ? entry.value : entry.name]),
        '(g1) create, preload none, set src, play, all inside the trusted click',
      )
      .toEqual([
        ['create', null],
        ['preload', 'none'],
        ['setAttribute', 'src'],
        ['play', null],
      ])
    expect
      .soft(playOf(first, on, PREFS_KEY), '(g1) the start clip, played before the prefs write')
      .toEqual(PLAYED(clipUrl('start', 'en'), PREFS_KEY))
    await expect.soft(page.locator(READ), '(g1) pressed').toHaveAttribute('aria-pressed', 'true')
    await expect.soft(page.locator(GROUP), '(g1) data-on').toHaveAttribute('data-on')
    // (g2) loading, then playing.
    await expect.soft(page.locator(GROUP), '(g2) loading').toHaveAttribute('data-status', 'loading')
    await expect
      .soft(page.locator(MESSAGE), '(g2) the loading message')
      .toHaveAttribute('data-narration-message', 'loading')
    await expect.soft(page.locator(PLAYBACK), '(g2) Pause').toHaveAttribute('data-kind', 'pause')
    await fakeControl(page, 'resolvePlay')
    await expect.soft(page.locator(GROUP), '(g2) playing').toHaveAttribute('data-status', 'playing')
    await expect.soft(page.locator(MESSAGE), '(g2) no message while playing').toHaveCount(0)
    expect.soft(await storedReadToMe(page), '(g3) the stored prefs: Read to me on').toBe(true)

    // (g4) Off, after the hold: stop, then the write.
    await waitAfter(page, on.t, AFTER_HOLD_MS)
    const off = await tap(page, READ)
    const log = (await narrationRecord(page)).log
    expectWriteIn(log, off, PREFS_KEY)
    const offCalls = log.filter((entry) => entry.clickId === off.id)
    expect
      .soft(
        callNames(
          offCalls.filter((entry) => MEDIA_CALLS.has(entry.call) || entry.key === PREFS_KEY),
        ),
        '(g4) pause, remove src, load inside the click, then the prefs write',
      )
      .toEqual(['pause', 'removeAttribute', 'load', 'setItem'])
    await expect
      .soft(page.locator(READ), '(g4) not pressed')
      .toHaveAttribute('aria-pressed', 'false')
    await expect.soft(page.locator(PLAYBACK), '(g4) no playback button').toHaveCount(0)
    await expect.soft(page.locator(MESSAGE), '(g4) no message').toHaveCount(0)
    expect.soft(await storedReadToMe(page), '(g4) the stored prefs: Read to me off').toBe(false)
  })

  test('T11-F3 /hi: Pause and Resume keep focus on one button; narration never moves focus; Pause needs no menu', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'hi')
    await expectFakeInstalled(page, errors)
    const on = await onAndPlaying(page)
    // (g5) checked first: outside the menu and any closed disclosure, after the passage.
    expect
      .soft(
        await page.locator(PLAYBACK).evaluate((button) => {
          const passage = document.querySelector('[data-part] [data-passage]')
          return {
            hidden: button.closest('details:not([open]), dialog:not([open]), [hidden]') !== null,
            inMenu: button.closest('#player-menu, [data-menu]') !== null,
            afterPassage:
              passage !== null &&
              (passage.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          }
        }),
        '(g5) Pause is on the page, outside any menu, after the passage',
      )
      .toEqual({ hidden: false, inMenu: false, afterPassage: true })
    await waitAfter(page, on.t, AFTER_HOLD_MS)
    await page.locator(PLAYBACK).focus()
    await page.evaluate((selector) => {
      ;(window as unknown as Record<string, unknown>)['__e2eBtn'] = document.querySelector(selector)
    }, PLAYBACK)
    const sameButton = () =>
      page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>
        return document.activeElement !== null && document.activeElement === w['__e2eBtn']
      })
    await expect(page.locator(PLAYBACK), 'precondition: Pause is focused').toBeFocused()
    await expect(page.locator(PLAYBACK)).toHaveAttribute('data-kind', 'pause')

    // (g1) Enter on Pause.
    const pause = await enterOn(page, PLAYBACK)
    const afterPause = (await narrationRecord(page)).log.filter((entry) => entry.t >= pause.t)
    expect.soft(callNames(mediaCalls(afterPause)), '(g1) pause()').toEqual(['pause'])
    await expect.soft(page.locator(PLAYBACK), '(g1) Resume').toHaveAttribute('data-kind', 'resume')
    await expect
      .soft(page.locator(PLAYBACK), '(g1) its name')
      .toHaveAccessibleName(label('hi', 'player.resume'))
    expect.soft(await sameButton(), '(g1) focus stays on the one button').toBe(true)

    // (g2) Enter on Resume, after the hold.
    await waitAfter(page, pause.t, AFTER_HOLD_MS)
    await expect(page.locator(PLAYBACK), 'precondition: Resume is focused').toBeFocused()
    const resume = await enterOn(page, PLAYBACK)
    const afterResume = (await narrationRecord(page)).log.filter((entry) => entry.t >= resume.t)
    expect
      .soft(callNames(mediaCalls(afterResume)), '(g2) play() with no src set since')
      .toEqual(['play'])
    await expect.soft(page.locator(PLAYBACK), '(g2) Pause').toHaveAttribute('data-kind', 'pause')
    await expect
      .soft(page.locator(PLAYBACK), '(g2) its name')
      .toHaveAccessibleName(label('hi', 'player.pause'))
    expect.soft(await sameButton(), '(g2) focus stays on the one button').toBe(true)

    // (g3) Changes without input never move focus.
    await page.locator(FIRST_PARAGRAPH).first().focus()
    await fakeControl(page, 'emit', { type: 'waiting', patch: { paused: false, readyState: 2 } })
    await fakeControl(page, 'emit', { type: 'playing', patch: { readyState: 4 } })
    await fakeControl(page, 'emit', { type: 'error', patch: { errorCode: 4 } })
    await expect(page.locator(GROUP), 'precondition: unavailable').toHaveAttribute(
      'data-status',
      'unavailable',
    )
    await frames(page)
    await expect
      .soft(page.locator(FIRST_PARAGRAPH).first(), '(g3) focus stays on the paragraph')
      .toBeFocused()

    // (g4) The message is not a live region; the page has one.
    expect
      .soft(
        await page.locator(MESSAGE).evaluate((element) => ({
          role: element.getAttribute('role'),
          live: element.getAttribute('aria-live'),
        })),
        '(g4) the message has no role and no aria-live',
      )
      .toEqual({ role: null, live: null })
    expect.soft((await liveRegions(page)).length, '(g4) one live region on the page').toBe(1)
  })

  // F4 (13.4.1): each step entry, with Read to me on, plays the destination inside its tap.
  const ENTRIES = [
    { name: 'a choice', path: [] as string[], destination: 'flat_stones' },
    { name: 'Back', path: ['c1'], destination: 'start' },
    { name: 'Try another path', path: ['c2', 'c1'], destination: 'start' },
    { name: "the menu's Start again", path: ['c1'], destination: 'start' },
    { name: "the restart dialog's confirm", path: ['c1', 'c1'], destination: 'start' },
  ] as const

  /** Performs one entry from the part on screen; returns the tap that steps. */
  async function stepBy(page: Page, name: (typeof ENTRIES)[number]['name']): Promise<Tap> {
    if (name === 'a choice') return tap(page, choice('c1', 'start'))
    if (name === 'Back') {
      await waitFooterSettled(page)
      return tap(page, BACK)
    }
    if (name === 'Try another path') {
      await expect(page.locator(CARD_ACTIONS)).not.toHaveAttribute('inert')
      return tap(page, TRY_ANOTHER)
    }
    await page.locator(MENU).click()
    if (name === "the menu's Start again") return tap(page, MENU_RESTART)
    await page.locator(MENU_RESTART).click()
    await expect(page.locator('dialog[data-restart-confirm]')).toHaveAttribute('open')
    return tap(page, DIALOG_ACCEPT)
  }

  for (const entry of ENTRIES) {
    test(`T11-F4 /en: ${entry.name} with Read to me on plays the next part inside the tap`, async ({
      page,
      fake,
      errors,
    }) => {
      void fake
      await openNarrated(page, 'en')
      await expectFakeInstalled(page, errors)
      await onAndPlaying(page)
      await walkNarrated(page, entry.path, { resolve: true })
      await expect(page.locator(GROUP), 'precondition: the previous clip plays').toHaveAttribute(
        'data-status',
        'playing',
      )
      const step = await stepBy(page, entry.name)
      await expect(page.locator(PART), 'precondition: the destination').toHaveAttribute(
        'data-node',
        entry.destination,
      )
      const log = (await narrationRecord(page)).log
      expectWriteIn(log, step, PROGRESS_KEY)
      expect
        .soft(
          playOf(log, step, PROGRESS_KEY),
          '(g1) the destination clip inside the tap, before the save',
        )
        .toEqual(PLAYED(clipUrl(entry.destination, 'en'), PROGRESS_KEY))
      await expect
        .soft(page.locator(GROUP), '(g2) loading')
        .toHaveAttribute('data-status', 'loading')
      await expect.soft(page.locator(PLAYBACK), '(g2) Pause').toHaveAttribute('data-kind', 'pause')
      expect((await narrationRecord(page)).made, 'one audio element for the page').toBe(1)
    })
  }

  test('T11-F4 /en: Enter on a choice plays inside the keyboard tap', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await onAndPlaying(page)
    // N27 (design §20.3.6): the Read to me tap holds the choices for 500 ms, and a held choice
    // cannot take focus (enterOn's focus() does not wait), so wait until they are live.
    await expect(page.locator(CHOICES)).not.toHaveAttribute('inert')
    const step = await enterOn(page, choice('c1', 'start'))
    await expect(page.locator(PART), 'precondition: the destination').toHaveAttribute(
      'data-node',
      'flat_stones',
    )
    const log = (await narrationRecord(page)).log
    expectWriteIn(log, step, PROGRESS_KEY)
    expect
      .soft(playOf(log, step, PROGRESS_KEY), '(g1) inside the keyboard-made click, before the save')
      .toEqual(PLAYED(clipUrl('flat_stones', 'en'), PROGRESS_KEY))
    await expect.soft(page.locator(GROUP), '(g2) loading').toHaveAttribute('data-status', 'loading')
    await expect.soft(page.locator(PLAYBACK), '(g2) Pause').toHaveAttribute('data-kind', 'pause')
  })

  test('T11-F4 /en: with Read to me off no entry calls the audio element', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    const on = await onAndPlaying(page)
    await waitAfter(page, on.t, AFTER_HOLD_MS)
    const off = await tap(page, READ)
    await expect(page.locator(READ)).toHaveAttribute('aria-pressed', 'false')
    const stopped = (await narrationRecord(page)).log.filter((entry) => entry.clickId === off.id)
    expect(callNames(mediaCalls(stopped)), 'precondition: off stopped the clip').toEqual([
      'pause',
      'removeAttribute',
      'load',
    ])
    const since = (await narrationRecord(page)).log.length
    // a choice, Back, the menu's Start again (path 2), the dialog's confirm (path 3), Try another path
    await stepBy(page, 'a choice')
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await stepBy(page, 'Back')
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await walkNarrated(page, ['c1'])
    await stepBy(page, "the menu's Start again")
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await walkNarrated(page, ['c1', 'c1'])
    await stepBy(page, "the restart dialog's confirm")
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await walkNarrated(page, ['c2', 'c1'])
    await stepBy(page, 'Try another path')
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    const later = (await narrationRecord(page)).log.slice(since)
    expect.soft(callNames(mediaCalls(later)), '(g1) no call after Read to me went off').toEqual([])
  })

  test('T11-F5 /en: the story-language switch plays the same part in the new language, or stops when it has no clip', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await expect(page.locator(SWITCH), 'precondition: the switch is offered').toHaveCount(1)
    await onAndPlaying(page)
    const seq = await page.locator(PART).getAttribute('data-seq')
    // (g1) on: the same part in hi, inside the switch tap, before the save.
    const toHi = await tap(page, SWITCH)
    await expect(page.locator('[data-part] [data-story]')).toHaveAttribute('lang', 'hi')
    let log = (await narrationRecord(page)).log
    expectWriteIn(log, toHi, PROGRESS_KEY)
    expect
      .soft(
        playOf(log, toHi, PROGRESS_KEY),
        '(g1) the start clip in hi, inside the tap, before the save',
      )
      .toEqual(PLAYED(clipUrl('start', 'hi'), PROGRESS_KEY))
    await expect.soft(page.locator(GROUP), '(g1) loading').toHaveAttribute('data-status', 'loading')
    await expect
      .soft(page.locator(PART), '(g1) the same part')
      .toHaveAttribute('data-seq', seq ?? '')
    await fakeControl(page, 'resolvePlay')

    // (g2) off: a switch makes no call.
    await waitAfter(page, toHi.t, AFTER_HOLD_MS)
    await tap(page, READ)
    await expect(page.locator(READ)).toHaveAttribute('aria-pressed', 'false')
    const since = (await narrationRecord(page)).log.length
    await tap(page, SWITCH)
    await expect(page.locator('[data-part] [data-story]')).toHaveAttribute('lang', 'en')
    log = (await narrationRecord(page)).log
    expect.soft(callNames(mediaCalls(log.slice(since))), '(g2) off: no call').toEqual([])

    // (g3) at big_rock in en, on: the switch to hi stops (no hi clip, N12).
    await walkNarrated(page, ['c1', 'c1'])
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'big_rock')
    await waitFooterSettled(page)
    const onAgain = await tap(page, READ)
    await fakeControl(page, 'resolvePlay')
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
    await waitAfter(page, onAgain.t, AFTER_HOLD_MS)
    const toNoClip = await tap(page, SWITCH)
    log = (await narrationRecord(page)).log
    expect
      .soft(
        callNames(mediaCalls(log.filter((entry) => entry.clickId === toNoClip.id))),
        '(g3) pause, remove src, load',
      )
      .toEqual(['pause', 'removeAttribute', 'load'])
    await expect
      .soft(page.locator(MESSAGE), '(g3) unavailable')
      .toHaveAttribute('data-narration-message', 'unavailable')
    await expect.soft(page.locator(PLAYBACK), '(g3) no playback button').toHaveCount(0)
  })

  test('T11-F6 /en: a refused play pulses Tap to listen, is not announced, and the next tap plays', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await onAndPlaying(page)
    const step = await tap(page, choice('c1', 'start'))
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    await fakeControl(page, 'rejectPlay', { name: 'NotAllowedError' })
    const refused = await pageNow(page)
    await expect(page.locator(GROUP), 'precondition: the refusal was current').toHaveAttribute(
      'data-status',
      'blocked',
    )
    await expect.soft(page.locator(PLAYBACK), '(g1) pulse').toHaveAttribute('data-pulse')
    await expect
      .soft(page.locator(PLAYBACK), '(g1) Tap to listen')
      .toHaveAttribute('data-kind', 'tap-to-listen')
    await expect.soft(page.locator(MESSAGE), '(g1) no message').toHaveCount(0)

    await waitAfter(page, step.t, AFTER_HOLD_MS)
    const listen = await tap(page, PLAYBACK)
    expect
      .soft(
        playOf((await narrationRecord(page)).log, listen, null),
        '(g2) the same clip, in the tap',
      )
      .toEqual(PLAYED(clipUrl('flat_stones', 'en'), null))
    await fakeControl(page, 'resolvePlay')
    await expect.soft(page.locator(GROUP), '(g2) playing').toHaveAttribute('data-status', 'playing')
    await expect.soft(page.locator(PLAYBACK), '(g2) no pulse').not.toHaveAttribute('data-pulse')

    await waitAfter(page, refused, 1000)
    expect
      .soft(
        (await liveTextsSince(page, step.t)).map((entry) => entry.text),
        '(g3) only "Page 2" was announced',
      )
      .toEqual([pageN('en', 2)])
  })

  test('T11-F7a /en: unavailable shows at once, is announced once per run 500 ms later, retries the same clip, and leaves choices working', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    const text = label('en', 'player.narrationUnavailable')
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    const on = await tap(page, READ)
    await expectMadeOne(page)
    await fakeControl(page, 'rejectPlay', { name: 'NotSupportedError' })
    // (g1) at once.
    await expect
      .soft(page.locator(GROUP), '(g1) unavailable')
      .toHaveAttribute('data-status', 'unavailable')
    await expect
      .soft(page.locator(MESSAGE), '(g1) the message')
      .toHaveAttribute('data-narration-message', 'unavailable')
    await expect
      .soft(page.locator(PLAYBACK), '(g1) Tap to listen')
      .toHaveAttribute('data-kind', 'tap-to-listen')
    await expect.soft(page.locator(PLAYBACK), '(g1) no pulse').not.toHaveAttribute('data-pulse')
    // (g2) announced, 500 ms after the message appeared.
    const shown = await messageAppeared(page, 'unavailable', on.t)
    expect(shown, 'precondition: the message-appeared stamp').not.toBeNull()
    await expect
      .poll(async () => (await liveTextsSince(page, on.t)).map((entry) => entry.text), {
        message: '(g2) the live region gets the message',
      })
      .toContain(text)
    const announced = (await liveTextsSince(page, on.t)).find((entry) => entry.text === text)
    expect
      .soft((announced?.t ?? 0) - (shown ?? 0), '(g2) at least 450 ms after the message appeared')
      .toBeGreaterThanOrEqual(ANNOUNCE_MIN_MS)

    // (g3) Tap to listen loads the same clip again; a second failure is not announced again.
    await waitAfter(page, on.t, AFTER_HOLD_MS)
    const retry = await tap(page, PLAYBACK)
    expect
      .soft(
        playOf((await narrationRecord(page)).log, retry, null),
        '(g3) the same clip again, in the tap',
      )
      .toEqual(PLAYED(clipUrl('start', 'en'), null))
    await fakeControl(page, 'rejectPlay', { name: 'NotSupportedError' })
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'unavailable')
    const failedAgain = await pageNow(page)
    await waitAfter(page, failedAgain, 1000)
    expect
      .soft(
        (await liveTextsSince(page, retry.t)).filter((entry) => entry.text === text),
        '(g3) not announced again in this run',
      )
      .toEqual([])

    // (g4) a choice still steps, and its clip plays.
    const step = await tap(page, choice('c1', 'start'))
    await expect
      .soft(page.locator(PART), '(g4) the choice stepped')
      .toHaveAttribute('data-node', 'flat_stones')
    expect
      .soft(
        playOf((await narrationRecord(page)).log, step, PROGRESS_KEY),
        '(g4) the next part plays',
      )
      .toEqual(PLAYED(clipUrl('flat_stones', 'en'), PROGRESS_KEY))
    await fakeControl(page, 'resolvePlay')
    await expect
      .poll(async () => (await liveTextsSince(page, step.t)).map((entry) => entry.text), {
        message: 'precondition: "Page 2" in between',
      })
      .toContain(pageN('en', 2))

    // (g5) a new run (the menu's Start again, path 2): announced again.
    await page.locator(MENU).click()
    const restart = await tap(page, MENU_RESTART)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await fakeControl(page, 'rejectPlay', { name: 'NotSupportedError' })
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'unavailable')
    const shownAgain = await messageAppeared(page, 'unavailable', restart.t)
    await expect
      .poll(async () => (await liveTextsSince(page, restart.t)).map((entry) => entry.text), {
        message: '(g5) announced again in the new run',
      })
      .toContain(text)
    const again = (await liveTextsSince(page, restart.t)).find((entry) => entry.text === text)
    expect
      .soft((again?.t ?? 0) - (shownAgain ?? 0), '(g5) at least 450 ms after it appeared')
      .toBeGreaterThanOrEqual(ANNOUNCE_MIN_MS)
  })

  test('T11-F7b /en: unavailable is not announced when the part changes within 500 ms', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    const text = label('en', 'player.narrationUnavailable')
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await onAndPlaying(page)
    const step = await tap(page, choice('c1', 'start'))
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    const stamps = await page.evaluate(
      ({ group, message, button }) =>
        new Promise<{ shown: number; switched: number }>((resolve, reject) => {
          const state = (window as unknown as Record<string, unknown>)['__e2eNarration'] as {
            elements: { rejectPlay(name: string): void; resolvePlay(): void }[]
          }
          const fake = state.elements[state.elements.length - 1]
          if (fake === undefined) {
            reject(new Error('no fake'))
            return
          }
          const observer = new MutationObserver(() => {
            const shown = document.querySelector(message)
            if (shown === null || shown.getAttribute('data-narration-message') !== 'unavailable')
              return
            observer.disconnect()
            const at = performance.now()
            const target = document.querySelector<HTMLButtonElement>(button)
            if (target === null) {
              reject(new Error('no switch'))
              return
            }
            target.click()
            const switched = performance.now()
            fake.resolvePlay()
            resolve({ shown: at, switched })
          })
          const root = document.querySelector(group)
          if (root === null) {
            reject(new Error('no narration group'))
            return
          }
          observer.observe(root, { subtree: true, childList: true, attributes: true })
          fake.rejectPlay('NotSupportedError')
        }),
      { group: GROUP, message: MESSAGE, button: SWITCH },
    )
    expect(
      stamps.switched - stamps.shown,
      'precondition: the switch came within 500 ms',
    ).toBeLessThan(500)
    await waitAfter(page, stamps.switched, 1000)
    const texts = (await liveTextsSince(page, step.t)).map((entry) => entry.text)
    expect.soft(texts, '(g1) the message was never announced').not.toContain(text)
    expect.soft(texts, '(g1) only "Page 2"').toEqual([pageN('en', 2)])
  })

  test('T11-F7c /hi: a part with no clip shows unavailable with no retry and no request, announced once', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    const text = label('hi', 'player.narrationUnavailable')
    await openNarrated(page, 'hi')
    await expectFakeInstalled(page, errors)
    await onAndPlaying(page)
    await walkNarrated(page, ['c1'], { resolve: true })
    await expect(page.locator(GROUP), 'precondition: the flat_stones clip plays').toHaveAttribute(
      'data-status',
      'playing',
    )
    const step = (await walkNarrated(page, ['c1']))[0]
    if (step === undefined) throw new Error('no step')
    const log = (await narrationRecord(page)).log.filter((entry) => entry.t >= step.t)
    const bigRock = [clipUrl('big_rock', 'hi'), clipUrl('big_rock', 'en')]
    expect
      .soft(
        {
          calls: callNames(mediaCalls(log)),
          bigRockSrc: log.filter(
            (entry) => entry.call === 'setAttribute' && bigRock.includes(entry.value ?? ''),
          ),
        },
        '(g1) the step stops: pause, remove src, load; no big_rock URL is set',
      )
      .toEqual({ calls: ['pause', 'removeAttribute', 'load'], bigRockSrc: [] })
    await expect
      .soft(page.locator(MESSAGE), '(g2) unavailable')
      .toHaveAttribute('data-narration-message', 'unavailable')
    await expect.soft(page.locator(PLAYBACK), '(g2) no retry button').toHaveCount(0)
    // (g5) Review round 1 (R1-L-2; design §17): the status line's box is kept only while the
    // playback button shows, so a part with no clip has its message and nothing under it.
    const under = await page.locator(GROUP).evaluate((group) => {
      const line = group.querySelector('[data-narration-message]')
      if (line === null) return Number.NaN
      const below = group.getBoundingClientRect().bottom - line.getBoundingClientRect().bottom
      return Math.round(below * 100) / 100
    })
    expect
      .soft(under, `(g5) no reserved line under the message (${under} px)`)
      .toBeLessThanOrEqual(0.5)
    const shown = await messageAppeared(page, 'unavailable', step.t)
    expect(shown, 'precondition: the message-appeared stamp').not.toBeNull()
    await expect
      .poll(async () => (await liveTextsSince(page, step.t)).map((entry) => entry.text), {
        message: '(g3) announced',
      })
      .toContain(text)
    await waitAfter(page, shown ?? 0, 1500)
    const announced = (await liveTextsSince(page, step.t)).filter((entry) => entry.text === text)
    expect.soft(announced.length, '(g3) once').toBe(1)
    expect
      .soft((announced[0]?.t ?? 0) - (shown ?? 0), '(g3) at least 450 ms after it appeared')
      .toBeGreaterThanOrEqual(ANNOUNCE_MIN_MS)
    // (g4) Back plays flat_stones in hi.
    await waitFooterSettled(page)
    const back = await tap(page, BACK)
    expect
      .soft(
        playOf((await narrationRecord(page)).log, back, PROGRESS_KEY),
        '(g4) Back plays flat_stones',
      )
      .toEqual(PLAYED(clipUrl('flat_stones', 'hi'), PROGRESS_KEY))
  })

  test('T11-F8 /en: a second narration tap within 500 ms does nothing and keeps focus', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    const twice = (selector: string) =>
      page.evaluate((target) => {
        const button = document.querySelector<HTMLButtonElement>(target)
        if (button === null) throw new Error(`no ${target}`)
        button.click()
        button.click()
      }, selector)
    const before = (await narrationRecord(page)).clicks.length
    await twice(READ)
    let record = await narrationRecord(page)
    const pair = record.clicks.slice(before)
    expect(pair.length, 'precondition: two clicks').toBe(2)
    expect((pair[1]?.open ?? 0) - (pair[0]?.open ?? 0), 'precondition: within 50 ms').toBeLessThan(
      50,
    )
    const firstPair = record.log.filter((entry) => entry.t >= (pair[0]?.open ?? 0))
    expect
      .soft(
        {
          pressed: await page.locator(READ).getAttribute('aria-pressed'),
          plays: firstPair.filter((entry) => entry.call === 'play').length,
          writes: firstPair.filter((entry) => entry.call === 'setItem' && entry.key === PREFS_KEY)
            .length,
        },
        '(g1) on, one play, one prefs write',
      )
      .toEqual({ pressed: 'true', plays: 1, writes: 1 })
    const lastApplied = pair[0]?.open ?? 0

    // (g2) on and playing, Pause focused: two clicks.
    await fakeControl(page, 'resolvePlay')
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
    await waitAfter(page, lastApplied, AFTER_HOLD_MS)
    await page.locator(PLAYBACK).focus()
    await expect(page.locator(PLAYBACK)).toBeFocused()
    const beforePause = (await narrationRecord(page)).clicks.length
    await twice(PLAYBACK)
    record = await narrationRecord(page)
    const pausePair = record.clicks.slice(beforePause)
    expect(pausePair.length, 'precondition: two clicks').toBe(2)
    expect(
      (pausePair[1]?.open ?? 0) - (pausePair[0]?.open ?? 0),
      'precondition: within 50 ms',
    ).toBeLessThan(50)
    const secondPair = record.log.filter((entry) => entry.t >= (pausePair[0]?.open ?? 0))
    await expect.soft(page.locator(GROUP), '(g2) paused').toHaveAttribute('data-status', 'paused')
    expect.soft(callNames(mediaCalls(secondPair)), '(g2) one pause()').toEqual(['pause'])
    expect
      .soft(
        await page.locator(PLAYBACK).evaluate((button) => ({
          focused: document.activeElement === button,
          inert: button.closest('[inert]') !== null,
        })),
        '(g2) the button keeps focus and no ancestor is inert',
      )
      .toEqual({ focused: true, inert: false })

    // (g3) after the hold, Resume applies.
    await waitAfter(page, pausePair[0]?.open ?? 0, AFTER_HOLD_MS)
    const resume = await tap(page, PLAYBACK)
    expect
      .soft(
        callNames(
          mediaCalls((await narrationRecord(page)).log.filter((entry) => entry.t >= resume.t)),
        ),
        '(g3) Resume plays',
      )
      .toEqual(['play'])
  })

  const LEAVES = [
    { name: 'All stories', how: 'all-stories' },
    { name: 'Grown-ups', how: 'grown-ups' },
    { name: 'the AI voice link', how: 'ai-voice' },
    { name: 'an error', how: 'error' },
  ] as const
  const PLANTED_MESSAGE = 'e2e planted scrollIntoView failure'
  /** Next logs each error a boundary catches: WebKit the line alone, Chromium with the stack. */
  const PLANTED_LINE = new RegExp(`^Error: ${PLANTED_MESSAGE}(?:\\n|$)`)

  for (const leave of LEAVES) {
    test(`T11-F9 /en: leaving by ${leave.name} stops the clip`, async ({ page, fake, errors }) => {
      if (leave.how === 'error') {
        errors.allow({ chromium: [PLANTED_LINE], webkit: [PLANTED_LINE] })
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
      }
      await openNarrated(page, 'en')
      await expectFakeInstalled(page, errors)
      await onAndPlaying(page)
      await expect
        .poll(() => fake.bound().filter((entry) => entry.call === 'play').length, {
          message: 'precondition: the log binding delivered the play',
        })
        .toBeGreaterThan(0)
      let left: Tap
      if (leave.how === 'all-stories') {
        left = await tap(page, ALL_STORIES)
        await page.waitForURL((url) => url.pathname === '/en')
      } else if (leave.how === 'grown-ups') {
        left = await tap(page, 'header nav a[href="/en/grown-ups"]')
        await page.waitForURL((url) => url.pathname === '/en/grown-ups')
      } else if (leave.how === 'ai-voice') {
        left = await tap(page, AI_VOICE)
        await page.waitForURL((url) => url.pathname === '/en/grown-ups')
        expect
          .soft(
            new URL(page.url()).hash,
            '(g2) the AI voice link opens the Grown-ups page at its section',
          )
          .toBe('#how-stories-are-made')
      } else {
        left = await tap(page, choice('c1', 'start'))
        await expect(page.locator('main[data-player-error]'), 'the fallback').toBeVisible()
      }
      await expect
        .poll(
          async () =>
            callNames(
              mediaCalls((await narrationRecord(page)).log.filter((entry) => entry.t >= left.t)),
            ).filter((name) => name !== 'setAttribute src' && name !== 'play'),
          { message: '(g1) pause, remove src and load after the leave' },
        )
        .toEqual(['pause', 'removeAttribute', 'load'])
    })
  }

  test('T11-F10 /en: a choice into an ending plays the ending clip; Try another path keeps the one audio element and plays the start clip', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await onAndPlaying(page)
    await walkNarrated(page, ['c2'], { resolve: true })
    const toEnding = (await walkNarrated(page, ['c1']))[0]
    if (toEnding === undefined) throw new Error('no step')
    expect
      .soft(
        playOf((await narrationRecord(page)).log, toEnding, PROGRESS_KEY),
        "(g0) the ending's clip, inside the tap",
      )
      .toEqual(PLAYED(clipUrl('ending_wet', 'en'), PROGRESS_KEY))
    // ending_wet's play is left pending on purpose.
    expect(
      (await narrationRecord(page)).log.filter(
        (entry) => entry.t >= toEnding.t && entry.call === 'play-resolved',
      ),
      "precondition: ending_wet's play is pending",
    ).toEqual([])
    const epoch = Number(await page.locator(RUN).getAttribute('data-epoch'))
    await expect(page.locator(CARD_ACTIONS)).not.toHaveAttribute('inert')
    const again = await tap(page, TRY_ANOTHER)
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'start')
    await expect
      .soft(page.locator(RUN), '(g1) a new run')
      .toHaveAttribute('data-epoch', String(epoch + 1))
    const log = (await narrationRecord(page)).log
    expect.soft((await narrationRecord(page)).made, '(g1) the one audio element').toBe(1)
    expect
      .soft(playOf(log, again, PROGRESS_KEY), '(g1) the start clip, inside the tap')
      .toEqual(PLAYED(clipUrl('start', 'en'), PROGRESS_KEY))
    expect
      .soft(
        log
          .filter((entry) => entry.t >= again.t && MEDIA_CALLS.has(entry.call))
          .map((entry) => entry.el),
        '(g1) on the same element',
      )
      .not.toContain(1)
    await expect
      .poll(
        async () =>
          (await narrationRecord(page)).log
            .filter((entry) => entry.t >= again.t && entry.call === 'play-rejected')
            .map((entry) => entry.value),
        { message: "(g2) the old clip's pending play rejects with AbortError" },
      )
      .toEqual(['AbortError'])
    await frames(page)
    expect
      .soft(
        (await narrationRecord(page)).status
          .filter((stamp) => stamp.t >= again.t)
          .map((stamp) => stamp.value),
        '(g2) never unavailable',
      )
      .not.toContain('unavailable')
  })

  test('T11-F11 /en: a tap on Read to me or the AI voice link before hydration does nothing', async ({
    page,
    fake,
    browserName,
  }) => {
    void fake
    // T-a2's pattern: the JavaScript chunks held 1 s and until the taps are done.
    let tapped = (): void => undefined
    const afterTaps = new Promise<void>((resolve) => {
      tapped = resolve
    })
    let held = 0
    await page.route(
      (url) => url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js'),
      async (route) => {
        held++
        await Promise.all([
          new Promise((resolve) => setTimeout(resolve, 1000)),
          Promise.race([afterTaps, new Promise((resolve) => setTimeout(resolve, 15_000))]),
        ])
        await route.continue().catch(() => undefined)
      },
    )
    const url = urlOf('en')
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(response?.status(), url).toBe(200)
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].every(
        (link) => link.sheet !== null,
      ),
    )
    const state = () =>
      page.evaluate(() => ({
        phase: document.querySelector('[data-player]')?.getAttribute('data-run-phase') ?? null,
        hydrated: Object.keys(document.querySelector('main') ?? {}).some((key) =>
          key.startsWith('__reactFiber$'),
        ),
      }))
    expect(await state(), 'precondition: before the taps').toEqual({
      phase: 'opening',
      hydrated: false,
    })
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>)['__e2eSameDocument'] = true
    })
    // Playwright's WebKit holds mouse input until the held scripts have run, so WebKit taps with
    // the touchscreen (every WebKit project emulates one); Chromium clicks with the mouse.
    for (const selector of [READ, AI_VOICE]) {
      const point = await centreInViewport(page, selector)
      if (browserName === 'webkit') await page.touchscreen.tap(point.x, point.y)
      else await page.mouse.click(point.x, point.y)
    }
    expect(await state(), 'precondition: just after the taps').toEqual({
      phase: 'opening',
      hydrated: false,
    })
    tapped()
    await waitOpen(page)
    expect(held, 'precondition: chunks held').toBeGreaterThan(0)
    await frames(page)
    // Hard check, no mutant claimed (AUD-9, R22): before hydration a button has no handler.
    await expect(page.locator(READ), 'Read to me stays off').toHaveAttribute(
      'aria-pressed',
      'false',
    )
    const record = await narrationRecord(page)
    expect(
      {
        made: record.made,
        prefsWrites: record.log.filter((entry) => entry.key === PREFS_KEY).length,
      },
      'no audio element and no prefs write',
    ).toEqual({ made: 0, prefsWrites: 0 })
    // (g2) the AI voice link did not navigate.
    expect.soft(await pageValue(page, '__e2eSameDocument'), '(g2) the same document').toBe(true)
    expect.soft(new URL(page.url()).pathname, '(g2) the URL').toBe(url)
  })

  test('T11-F12a /en: another tab’s Read to me does not change this page', async ({
    page,
    context,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    const on = await onAndPlaying(page)
    // After the narration hold, so a page that followed the record through its own toggle would
    // not be stopped by the hold instead (N17).
    await waitAfter(page, on.t, AFTER_HOLD_MS)
    const since = (await narrationRecord(page)).log.length
    // Another tab of the same browser turns Read to me off in the prefs record (not a player page: a
    // second player page in one Windows WebKit context stalls, P20; T-c7's pattern). It ends on
    // off, the opposite of this page: a page that followed the record would stop (MW-11), and one
    // that reads the record when the events arrive sees only the last write.
    const other = await context.newPage()
    errors.watch(other)
    await seedOnSamePage(other, [
      [PREFS_KEY, serializePrefs({ ...DEFAULT_PREFS, readToMe: false })],
    ])
    await other.close()
    await page.bringToFront()
    await frames(page)
    await expect
      .poll(async () => (await narrationRecord(page)).storageEvents, {
        message: "precondition: this page heard the other tab's prefs writes",
      })
      .toContain(PREFS_KEY)
    await page.waitForTimeout(300)
    await expect.soft(page.locator(READ), '(g1) still on').toHaveAttribute('aria-pressed', 'true')
    await expect
      .soft(page.locator(GROUP), '(g1) still playing')
      .toHaveAttribute('data-status', 'playing')
    expect
      .soft(
        callNames(mediaCalls((await narrationRecord(page)).log.slice(since))),
        '(g1) no new call',
      )
      .toEqual([])
  })

  test('T11-F12b /en: with storage blocked Read to me plays and is not remembered', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await blockStorage(page)
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await expect(
      page.locator(STORAGE_BANNER),
      'precondition: the storage banner (memory prefs)',
    ).toBeVisible()
    const on = await tap(page, READ)
    await expectMadeOne(page)
    expect
      .soft(playOf((await narrationRecord(page)).log, on, null), '(g1) plays inside the click')
      .toEqual(PLAYED(clipUrl('start', 'en'), null))
    await expect.soft(page.locator(READ), '(g1) pressed').toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    await waitOpen(page)
    await expectFakeInstalled(page, errors)
    await page.waitForTimeout(300)
    await expect
      .soft(page.locator(READ), '(g2) off after a reload')
      .toHaveAttribute('aria-pressed', 'false')
    expect.soft((await narrationRecord(page)).made, '(g2) no audio element').toBe(0)
  })

  test('T11-F13 /en: after Ended, Play again plays the kept clip and Read to me stops it', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await onAndPlaying(page)
    const end = async (): Promise<void> => {
      await fakeControl(page, 'emit', {
        type: 'pause',
        patch: { paused: true, ended: true, currentTime: 1.008 },
      })
      await fakeControl(page, 'emit', { type: 'ended', patch: { ended: true } })
    }
    await end()
    await expect.soft(page.locator(GROUP), '(g1) ended').toHaveAttribute('data-status', 'ended')
    await expect
      .soft(page.locator(PLAYBACK), '(g1) Play again')
      .toHaveAttribute('data-kind', 'play-again')
    await expect(page.locator(GROUP), 'precondition: ended was accepted').toHaveAttribute(
      'data-status',
      'ended',
    )
    const ended = await pageNow(page)
    await waitAfter(page, ended, AFTER_HOLD_MS)
    const again = await tap(page, PLAYBACK)
    expect
      .soft(
        callNames(
          mediaCalls((await narrationRecord(page)).log.filter((entry) => entry.t >= again.t)),
        ),
        '(g2) play() with no src set since',
      )
      .toEqual(['play'])
    expect.soft((await fakeState(page)).currentTime, '(g2) from the start').toBe(0)
    await fakeControl(page, 'resolvePlay')
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
    await end()
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'ended')
    await waitAfter(page, again.t, AFTER_HOLD_MS)
    const off = await tap(page, READ)
    expect
      .soft(
        callNames(
          mediaCalls((await narrationRecord(page)).log.filter((entry) => entry.clickId === off.id)),
        ),
        '(g3) Read to me at Ended stops: pause, remove src, load',
      )
      .toEqual(['pause', 'removeAttribute', 'load'])
    await expect.soft(page.locator(READ), '(g3) off').toHaveAttribute('aria-pressed', 'false')
    expect.soft(await storedReadToMe(page), '(g3) stored off').toBe(false)
  })

  test('T11-F14 /en: loading, buffering and our own AbortError never show unavailable', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    const on = await tap(page, READ)
    await expectMadeOne(page)
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'loading')
    // (g1) Pause while loading: our own AbortError.
    await waitAfter(page, on.t, AFTER_HOLD_MS)
    const pause = await tap(page, PLAYBACK)
    await expect
      .poll(
        async () =>
          (await narrationRecord(page)).log
            .filter((entry) => entry.t >= pause.t && entry.call === 'play-rejected')
            .map((entry) => entry.value),
        { message: '(g1) the pending play rejects with AbortError' },
      )
      .toEqual(['AbortError'])
    await expect.soft(page.locator(GROUP), '(g1) paused').toHaveAttribute('data-status', 'paused')

    // (g2) buffering shows Loading; a stall with data in hand does not.
    await waitAfter(page, pause.t, AFTER_HOLD_MS)
    const resume = await tap(page, PLAYBACK)
    await fakeControl(page, 'resolvePlay')
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
    const emitted = async (type: string, patch: FakePatch, readyState: number): Promise<void> => {
      await fakeControl(page, 'emit', { type, patch })
      expect((await fakeState(page)).readyState, `precondition: ${type} patch applied`).toBe(
        readyState,
      )
    }
    await emitted('waiting', { paused: false, readyState: 2 }, 2)
    await expect
      .soft(page.locator(MESSAGE), '(g2) waiting: Loading')
      .toHaveAttribute('data-narration-message', 'loading')
    await emitted('playing', { readyState: 4 }, 4)
    await expect.soft(page.locator(MESSAGE), '(g2) playing: no message').toHaveCount(0)
    await emitted('stalled', { readyState: 4 }, 4)
    await frames(page)
    await expect
      .soft(page.locator(GROUP), '(g2) stalled with data: playing')
      .toHaveAttribute('data-status', 'playing')
    await emitted('stalled', { readyState: 2 }, 2)
    await expect
      .soft(page.locator(MESSAGE), '(g2) stalled without data: Loading')
      .toHaveAttribute('data-narration-message', 'loading')

    // (g3) a choice while a play is pending: a new src, the old play's AbortError.
    await emitted('playing', { readyState: 4 }, 4)
    await waitAfter(page, resume.t, AFTER_HOLD_MS)
    const pauseAgain = await tap(page, PLAYBACK)
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'paused')
    await waitAfter(page, pauseAgain.t, AFTER_HOLD_MS)
    await tap(page, PLAYBACK)
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'loading')
    const step = await tap(page, choice('c1', 'start'))
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    expect
      .soft(playOf((await narrationRecord(page)).log, step, PROGRESS_KEY).src, '(g3) a new src')
      .toBe(clipUrl('flat_stones', 'en'))
    await expect
      .poll(
        async () =>
          (await narrationRecord(page)).log
            .filter((entry) => entry.t >= step.t && entry.call === 'play-rejected')
            .map((entry) => entry.value),
        { message: "(g3) the old play's AbortError" },
      )
      .toEqual(['AbortError'])
    await frames(page)
    expect
      .soft(
        (await narrationRecord(page)).status.map((stamp) => stamp.value),
        '(g1, g3) never unavailable',
      )
      .not.toContain('unavailable')
  })

  for (const code of CODES) {
    test(`T11-F16 /${code}: the AI voice byline sits next to Read to me and names the page it opens`, async ({
      page,
      fake,
      errors,
      browserName,
    }) => {
      void fake
      const name = `${label(code, 'player.aiVoice')} ${label(code, 'player.aiVoiceAbout')}`
      await openNarrated(page, code)
      await expectFakeInstalled(page, errors)
      // (g1) name, href, same tab.
      await expect
        .soft(page.getByRole('link', { name, exact: true }), '(g1) the link by its whole name')
        .toHaveCount(1)
      await expect.soft(page.locator(AI_VOICE), '(g1) its name').toHaveAccessibleName(name)
      expect
        .soft(
          await page.locator(AI_VOICE).evaluate((link) => ({
            href: link.getAttribute('href'),
            target: link.getAttribute('target'),
          })),
          '(g1) href per route locale with the fragment, same tab',
        )
        .toEqual({ href: `/${code}/grown-ups#how-stories-are-made`, target: null })
      await onAndPlaying(page)
      await expect(page.locator(GROUP), 'precondition: on').toHaveAttribute('data-on')
      // (g2) next to Read to me.
      const placement = await page.locator(READ).evaluate((read) => {
        const link = read.nextElementSibling
        const a = read.getBoundingClientRect()
        const b = link?.getBoundingClientRect()
        return {
          next: link?.hasAttribute('data-ai-voice') ?? false,
          topGap: b === undefined ? Number.NaN : Math.abs(b.top - a.top),
        }
      })
      expect.soft(placement.next, '(g2) the link is the next element after Read to me').toBe(true)
      const project = test.info().project.name
      if (code === 'en' && !ROW_PHONES.includes(project)) {
        expect
          .soft(placement.topGap, '(g2) on the line of Read to me (tablet widths, /en)')
          .toBeLessThanOrEqual(1)
      } else {
        test.info().annotations.push({
          type: 'T11-F16 line',
          description: `${project} /${code}: top gap ${placement.topGap.toFixed(1)} px (recorded)`,
        })
      }
      // (g3) 44 px targets.
      for (const [what, selector] of [
        ['Read to me', READ],
        ['the AI voice link', AI_VOICE],
        ['the playback button', PLAYBACK],
      ] as const) {
        const height = await page
          .locator(selector)
          .evaluate((element) => element.getBoundingClientRect().height)
        expect.soft(height, `(g3) ${what}: block size at least 44 px`).toBeGreaterThanOrEqual(44)
      }
      // (g5) a text link, not a button look.
      expect
        .soft(
          await page.locator(AI_VOICE).evaluate((link) => {
            const style = getComputedStyle(link)
            return {
              background: style.backgroundColor,
              border: style.borderTopWidth,
              underline: style.textDecorationLine.includes('underline'),
            }
          }),
          '(g5) no fill, no border, underlined',
        )
        .toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', underline: true })
      expect
        .soft(
          await page.locator(READ).evaluate((read) => getComputedStyle(read).borderTopWidth),
          "(g5) Read to me's border, for contrast",
        )
        .toBe('2px')
      // (g4) Tab order, only where Tab reaches links (WINDOWS IS NOT CI).
      const reaches = await tabReachesLinks(page)
      // N27 (design §20.3.6): the Read to me tap holds the link for 500 ms, and Tab skips it then.
      await expect(page.locator(AI_VOICE)).not.toHaveAttribute('inert')
      await page.locator(READ).focus()
      await page.keyboard.press('Tab')
      const landed = await page.evaluate(() => {
        const active = document.activeElement
        if (active === null) return 'nothing'
        const hooks = [...active.attributes]
          .filter((a) => a.name.startsWith('data-'))
          .map((a) => `[${a.name}]`)
        return `${active.localName}${hooks.join('')}`
      })
      if (reaches) {
        expect
          .soft(landed, `(g4) Tab from Read to me lands on the link (${browserName})`)
          .toBe('a[data-ai-voice]')
      } else {
        test.info().annotations.push({
          type: 'T11-F16 g4 skipped',
          description: `Tab does not reach links in this browser (${browserName}); focus landed on ${landed}`,
        })
      }
    })
  }

  test('T11-F17 /en: the Tap to listen pulse is finite, still under reduced motion, and keeps its cue in forced colours', async ({
    page,
    fake,
    errors,
    browserName,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await tap(page, READ)
    await expectMadeOne(page)
    await fakeControl(page, 'rejectPlay', { name: 'NotAllowedError' })
    await expect(page.locator(PLAYBACK), 'precondition: blocked, pulsing').toHaveAttribute(
      'data-pulse',
    )
    const ms = (value: string): number =>
      value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000
    const read = () =>
      page.evaluate(
        ({ pulse, readToMe }) => {
          const button = document.querySelector(pulse)
          const other = document.querySelector(readToMe)
          if (button === null || other === null) throw new Error('no narration buttons')
          const style = getComputedStyle(button)
          const probe = document.createElement('span')
          probe.style.color = style.getPropertyValue('--color-accent').trim()
          document.body.append(probe)
          const accent = getComputedStyle(probe).color
          probe.remove()
          return {
            name: style.animationName,
            count: style.animationIterationCount,
            direction: style.animationDirection,
            duration: style.animationDuration,
            calm: getComputedStyle(document.documentElement)
              .getPropertyValue('--duration-calm')
              .trim(),
            border: style.borderTopColor,
            accent,
            otherBorder: getComputedStyle(other).borderTopColor,
          }
        },
        { pulse: PLAYBACK, readToMe: READ },
      )
    const calm = await read()
    expect
      .soft(
        {
          animated: calm.name !== 'none',
          count: calm.count,
          direction: calm.direction,
          duration: ms(calm.duration),
          accentBorder: calm.border === calm.accent,
          differs: calm.border !== calm.otherBorder,
        },
        `(g1) a finite pulse on --duration-calm (${calm.calm}) and an accent border`,
      )
      .toEqual({
        animated: true,
        count: '6',
        direction: 'alternate',
        duration: ms(calm.calm),
        accentBorder: true,
        differs: true,
      })
    // (g4, review round 1, R1-L-4) keyboard focus on the pulsing button: the pulse would paint over
    // the focus ring's canvas halo (base.css), so it stops while the ring shows; the accent border,
    // the cue, stays. Tab from Read to me (where WebKit's Tab skips the link, one press is enough).
    await page.locator(READ).focus()
    for (let press = 0; press < 3; press++) {
      if (await page.locator(PLAYBACK).evaluate((button) => button === document.activeElement))
        break
      await page.keyboard.press('Tab')
    }
    const ring = await page.locator(PLAYBACK).evaluate((button) => ({
      focused: button === document.activeElement,
      visible: button.matches(':focus-visible'),
      name: getComputedStyle(button).animationName,
      border: getComputedStyle(button).borderTopColor,
    }))
    expect(ring.focused, 'precondition: Tab reached the pulsing button').toBe(true)
    if (ring.visible) {
      expect
        .soft(
          { name: ring.name, accentBorder: ring.border === calm.accent },
          `(g4) keyboard focus: no pulse over the focus ring, the accent border stays (${JSON.stringify(ring)})`,
        )
        .toEqual({ name: 'none', accentBorder: true })
    } else {
      test.info().annotations.push({
        type: 'T11-F17 g4 skipped',
        description: `${browserName}: the playback button focused by Tab does not match :focus-visible`,
      })
    }
    await page.locator(READ).focus()
    // (g2) reduced motion.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      'precondition: reduced motion',
    ).toBe(true)
    const still = await read()
    expect
      .soft(
        {
          short: ms(still.duration) <= 1,
          count: still.count,
          differs: still.border !== still.otherBorder,
        },
        '(g2) reduced motion: no movement, the accent border stays',
      )
      .toEqual({ short: true, count: '1', differs: true })
    // (g3) forced colours (Chromium emulates them).
    await page.emulateMedia({ forcedColors: 'active' })
    const forced = await page.evaluate(() => matchMedia('(forced-colors: active)').matches)
    if (!forced) {
      test.info().annotations.push({
        type: 'T11-F17 g3 skipped',
        description: `forced colours not emulated in ${browserName}: matchMedia('(forced-colors: active)') is false`,
      })
      return
    }
    // The reference is the header's Menu button, a plain forced button border. Not Read to me: it is
    // pressed and focused after its tap, and Chromium (Android profiles, Windows, mutant pass)
    // forces that button's border to Highlight too, so with it as the reference g3 always skipped.
    const coloursNow = () =>
      page.evaluate(
        ({ pulse, plain }) => {
          // The probe keeps its own Highlight (it opts out of forced colours).
          const probe = document.createElement('span')
          probe.style.setProperty('forced-color-adjust', 'none')
          probe.style.color = 'Highlight'
          document.body.append(probe)
          const highlight = getComputedStyle(probe).color
          probe.remove()
          const button = document.querySelector(pulse)
          const other = document.querySelector(plain)
          return {
            highlight,
            border: button === null ? '' : getComputedStyle(button).borderTopColor,
            plainBorder: other === null ? '' : getComputedStyle(other).borderTopColor,
          }
        },
        { pulse: PLAYBACK, plain: MENU },
      )
    // Windows Chromium applies the forced palette to an element's border some time after
    // emulateMedia: read at once, the pulsing button still had its accent border. Wait until it
    // has left the accent (forced to anything, Highlight or not), then read.
    await expect
      .poll(async () => (await coloursNow()).border, {
        message: "precondition: the forced palette reached the pulsing button's border",
      })
      .not.toBe(calm.border)
    await frames(page)
    const colours = await coloursNow()
    if (colours.highlight === colours.plainBorder) {
      test.info().annotations.push({
        type: 'T11-F17 g3 skipped',
        description: `Highlight (${colours.highlight}) equals the forced border of the Menu button (${colours.plainBorder}); the pulsing button: ${colours.border}`,
      })
      return
    }
    expect
      .soft(
        {
          highlight: colours.border === colours.highlight,
          differs: colours.border !== colours.plainBorder,
        },
        `(g3) forced colours: a Highlight border (${colours.border} vs ${colours.highlight}; a plain button: ${colours.plainBorder})`,
      )
      .toEqual({ highlight: true, differs: true })
  })

  test('T11-F18 /en: the narration group keeps its order, with Back first and the message on its own line', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await walkNarrated(page, ['c1'])
    await waitFooterSettled(page)
    const footerLayout = () =>
      page.locator(FOOTER).evaluate((footer) => {
        const HOOKS = [
          'data-back',
          'data-narration',
          'data-read-to-me',
          'data-ai-voice',
          'data-narration-control',
          'data-narration-message',
        ]
        const hook = (element: Element): string =>
          HOOKS.find((name) => element.hasAttribute(name)) ?? element.localName
        const group = footer.querySelector('[data-narration]')
        const playback = group?.querySelector('[data-narration-control]')?.getBoundingClientRect()
        const messageBox = group?.querySelector('[data-narration-message]')?.getBoundingClientRect()
        const height = (selector: string): number =>
          footer.querySelector(selector)?.getBoundingClientRect().height ?? Number.NaN
        return {
          footer: [...footer.children].map(hook),
          group: group === null ? [] : [...group.children].map(hook),
          ownLine:
            playback !== undefined &&
            messageBox !== undefined &&
            messageBox.top >= playback.bottom - 0.5,
          back: height('[data-back]'),
          readToMe: height('[data-read-to-me]'),
          groupHeight: height('[data-narration]'),
        }
      })
    await tap(page, READ)
    await expectMadeOne(page)
    // "Loading" is short: on the tablets it would fit beside Pause if the message were inline
    // (MW-51), so its own line is checked here as well as for the long unavailable message.
    await expect(page.locator(MESSAGE)).toHaveAttribute('data-narration-message', 'loading')
    const loading = await footerLayout()
    await fakeControl(page, 'rejectPlay', { name: 'NotSupportedError' })
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'unavailable')
    const layout = await footerLayout()
    expect
      .soft(
        { group: layout.group, ownLine: layout.ownLine, loadingOwnLine: loading.ownLine },
        '(g1) Read to me, the link, the playback button, then the message on its own line',
      )
      .toEqual({
        group: [
          'data-read-to-me',
          'data-ai-voice',
          'data-narration-control',
          'data-narration-message',
        ],
        ownLine: true,
        loadingOwnLine: true,
      })
    expect
      .soft(layout.footer, '(g2) Back first, then the group')
      .toEqual(['data-back', 'data-narration'])
    // (g2) Back keeps its own height beside a group of more than one line (the status line's),
    // as Read to me does, instead of stretching to the group's height (owner screens 31, 32).
    expect(
      layout.groupHeight,
      `precondition: the group spans more than one line (${layout.groupHeight} px, Read to me ${layout.readToMe} px)`,
    ).toBeGreaterThan(layout.readToMe + 1)
    expect
      .soft(
        Math.abs(layout.back - layout.readToMe),
        `(g2) Back ${layout.back} px high, as Read to me (${layout.readToMe} px), not the group (${layout.groupHeight} px)`,
      )
      .toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Layout and CI parity (13.4.2; FAKE)

/** The boxes L1 watches, in document coordinates (a scroll clamp moves nothing here). */
async function docBoxes(page: Page): Promise<Record<string, number[] | null>> {
  return page.evaluate(
    (selectors) => {
      const out: Record<string, number[] | null> = {}
      for (const [name, selector] of Object.entries(selectors)) {
        const element = document.querySelector(selector)
        if (element === null) {
          out[name] = null
          continue
        }
        const box = element.getBoundingClientRect()
        out[name] = [
          box.left + scrollX,
          box.top + scrollY,
          box.right + scrollX,
          box.bottom + scrollY,
        ]
      }
      return out
    },
    { read: READ, link: AI_VOICE, title: TITLE, paragraph: FIRST_PARAGRAPH, playback: PLAYBACK },
  )
}

const sameBox = (a: number[] | null | undefined, b: number[] | null | undefined): boolean =>
  a !== null &&
  a !== undefined &&
  b !== null &&
  b !== undefined &&
  a.every((value, index) => Math.abs(value - (b[index] ?? Number.NaN)) <= 0.5)

const L1_VARIANTS: readonly RowVariant[] = [
  { code: 'en', scale: 100, wide: false },
  { code: 'hi', scale: 100, wide: false },
  { code: 'hi', scale: 100, wide: true },
  { code: 'hi', scale: 150, wide: true },
  { code: 'en', scale: 150, wide: false },
]

const variantText = (variant: RowVariant): string =>
  `/${variant.code} ${variant.scale}%${variant.wide ? ' wide fallback, fonts aborted' : ''}`

/**
 * T11-L4 (review round 1, R1-L-2; design §17): /en, and /hi with the shipped fonts and with the wide
 * fallback, at 100% on every project and at 150% on the phones (LAYOUT STABILITY: the fallback as
 * well as the shipped fonts; review round 2, S11-R2-L-3).
 */
const L4_VARIANTS: readonly RowVariant[] = [
  { code: 'en', scale: 100, wide: false },
  { code: 'hi', scale: 100, wide: false },
  { code: 'hi', scale: 100, wide: true },
  { code: 'en', scale: 150, wide: false },
  { code: 'hi', scale: 150, wide: true },
]
/**
 * L4's long page: at least this much room to scroll, over twice the tallest status line with its
 * gap (44 px at 150% /hi), so a page one line shorter would pull the scroll position back by the
 * whole line.
 */
const LONG_PAGE_PX = 100

/** What the reader sees (L4): viewport boxes, never document ones, and the page's height. */
async function screenBoxes(page: Page) {
  return page.evaluate(
    ({ read, playback, back, group }) => {
      const box = (selector: string): number[] | null => {
        const element = document.querySelector(selector)
        if (element === null) return null
        const rect = element.getBoundingClientRect()
        return [rect.left, rect.top, rect.right, rect.bottom].map(
          (value) => Math.round(value * 100) / 100,
        )
      }
      const root = document.documentElement
      return {
        read: box(read),
        playback: box(playback),
        back: box(back),
        group: box(group),
        scrollY,
        room: root.scrollHeight - innerHeight,
        height: root.scrollHeight,
      }
    },
    { read: READ, playback: PLAYBACK, back: BACK, group: GROUP },
  )
}

/** How far the group's box reaches below its lowest child (a reserved line shows here). */
async function groupBelowChildren(page: Page): Promise<number> {
  return page.locator(GROUP).evaluate((group) => {
    const lowest = Math.max(
      ...[...group.children].map((child) => child.getBoundingClientRect().bottom),
    )
    return Math.round((group.getBoundingClientRect().bottom - lowest) * 100) / 100
  })
}

test.describe('narration in the player, Step 11: layout', { tag: '@staging' }, () => {
  for (const variant of L1_VARIANTS) {
    test(`T11-L1 ${variantText(variant)}: narration changes without input move nothing, and the playback button keeps its box`, async ({
      page,
      fake,
      errors,
      browserName,
    }) => {
      void fake
      test.skip(
        variant.scale !== 100 && !ROW_PHONES.includes(test.info().project.name),
        '150% text: the phones',
      )
      const aborted = await prepareVariant(page, variant, errors)
      await recordLayoutShifts(page)
      await openNarrated(page, variant.code)
      await expectFakeInstalled(page, errors)
      if (variant.wide) await expectWideFallback(page, aborted())
      await tap(page, READ)
      await expectMadeOne(page)
      await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'loading')
      await page.locator(FOOTER).evaluate((footer) => footer.scrollIntoView({ block: 'center' }))
      expect(
        await page.locator(FOOTER).evaluate((footer) => {
          const box = footer.getBoundingClientRect()
          return box.bottom > 0 && box.top < innerHeight
        }),
        'precondition: the footer is on screen',
      ).toBe(true)
      const code = variant.code
      const transition = async (
        name: string,
        act: () => Promise<void>,
        status: string,
        kindLabel: string | null,
      ): Promise<void> => {
        const lastInput = (await narrationRecord(page)).inputs.at(-1)?.t ?? 0
        await waitAfter(page, lastInput, AFTER_HOLD_MS)
        await frames(page)
        const before = await docBoxes(page)
        const from = await pageNow(page)
        await act()
        await expect(page.locator(GROUP), `${name}: precondition`).toHaveAttribute(
          'data-status',
          status,
        )
        if (kindLabel !== null) {
          await expect(
            page.locator(PLAYBACK),
            `${name}: precondition: the label changed`,
          ).toHaveAccessibleName(kindLabel)
        }
        await frames(page)
        const to = await pageNow(page)
        const after = await docBoxes(page)
        if (browserName === 'chromium') {
          const shift = await layoutShift(page, { from, to })
          expect.soft(shift.cls, `(gA) ${name}: cls\n${shift.lines.join('\n')}`).toBe(0)
          expect
            .soft(
              shiftsOutside(shift.lines, NARRATION_BOXES),
              `(gA) ${name}: shift sources outside the button and the message`,
            )
            .toEqual([])
        }
        for (const box of ['read', 'link', 'title', 'paragraph'] as const) {
          expect
            .soft(
              sameBox(before[box], after[box]),
              `(gB) ${name}: ${box} ${String(before[box])} -> ${String(after[box])}`,
            )
            .toBe(true)
        }
        expect
          .soft(
            sameBox(before.playback, after.playback),
            `(gC) ${name}: the playback button ${String(before.playback)} -> ${String(after.playback)}`,
          )
          .toBe(true)
      }
      await transition(
        'T1 loading to playing',
        () => fakeControl(page, 'resolvePlay'),
        'playing',
        null,
      )
      await transition(
        'T2 playing to ended',
        async () => {
          await fakeControl(page, 'emit', { type: 'pause', patch: { paused: true, ended: true } })
          await fakeControl(page, 'emit', { type: 'ended', patch: { ended: true } })
        },
        'ended',
        label(code, 'player.playAgain'),
      )
      await tap(page, PLAYBACK)
      await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'loading')
      await transition(
        'T4 loading to blocked',
        () => fakeControl(page, 'rejectPlay', { name: 'NotAllowedError' }),
        'blocked',
        label(code, 'player.tapToListen'),
      )
      await tap(page, PLAYBACK)
      await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'loading')
      await transition(
        'T3 loading to unavailable (after a Tap to listen)',
        () => fakeControl(page, 'rejectPlay', { name: 'NotSupportedError' }),
        'unavailable',
        label(code, 'player.tapToListen'),
      )
    })
  }

  test('T11-L2 /hi at 320 px and 150% with a wide fallback: the narration group wraps without horizontal scroll and keeps 44 px targets', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await page.setViewportSize({ width: 320, height: 640 })
    const aborted = await prepareVariant(page, { code: 'hi', scale: 150, wide: true }, errors)
    await openNarrated(page, 'hi')
    await expectFakeInstalled(page, errors)
    await expectWideFallback(page, aborted())
    const check = async (state: string): Promise<void> => {
      await expect(page.locator(GROUP), `precondition: ${state}`).toHaveAttribute(
        'data-status',
        state,
      )
      const fit = await page.evaluate((group) => {
        const root = document.documentElement
        const children = [...(document.querySelector(group)?.children ?? [])].map((child) => {
          const box = child.getBoundingClientRect()
          return { left: box.left, right: box.right }
        })
        return {
          scroll: root.scrollWidth <= root.clientWidth,
          inside: children.every((box) => box.left >= -0.5 && box.right <= innerWidth + 0.5),
          count: children.length,
        }
      }, GROUP)
      expect
        .soft(
          { scroll: fit.scroll, inside: fit.inside },
          `(g1) ${state}: no horizontal scroll, every child on screen`,
        )
        .toEqual({
          scroll: true,
          inside: true,
        })
      for (const [what, selector] of [
        ['Read to me', READ],
        ['the link', AI_VOICE],
        ['the playback button', PLAYBACK],
      ] as const) {
        const height = await page
          .locator(selector)
          .evaluate((element) => element.getBoundingClientRect().height)
        expect.soft(height, `(g2) ${state}: ${what} at least 44 px`).toBeGreaterThanOrEqual(44)
      }
      const offsets = await page.evaluate(
        ({ read, link, playback }) =>
          [
            ...document.querySelectorAll(
              `${read} > span:not([data-pip]), ${link} > span:first-child, ${playback} > span > span`,
            ),
          ].map((span) => {
            const style = getComputedStyle(span)
            const expected = 0.12 * Number.parseFloat(style.fontSize)
            return {
              position: style.position,
              offset: Math.abs(Number.parseFloat(style.top) - expected) <= 0.5,
            }
          }),
        { read: READ, link: AI_VOICE, playback: PLAYBACK },
      )
      expect(offsets.length, 'precondition: the label spans').toBeGreaterThanOrEqual(6)
      expect
        .soft(
          offsets.every((span) => span.position === 'relative' && span.offset),
          `(g3) ${state}: every label has the Hindi paint offset ${JSON.stringify(offsets)}`,
        )
        .toBe(true)
    }
    const on = await tap(page, READ)
    await expectMadeOne(page)
    await fakeControl(page, 'resolvePlay')
    await check('playing')
    await fakeControl(page, 'emit', { type: 'error', patch: { errorCode: 4 } })
    await check('unavailable')
    await waitAfter(page, on.t, AFTER_HOLD_MS)
    await tap(page, PLAYBACK)
    await fakeControl(page, 'rejectPlay', { name: 'NotAllowedError' })
    await check('blocked')
  })

  // Review round 1 (R1-L-1): beside Back the group gets less than the widest label needs, so the
  // reserved "Tap to listen" wraps inside the playback button and the label cell grows to two
  // lines; a one-line label must sit in its middle, not on its top line.
  test('T11-L2b /hi at 320 px and 150% with a wide fallback, beside Back: a reserved label that wraps leaves the shown label centred in the playback button', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await page.setViewportSize({ width: 320, height: 640 })
    const aborted = await prepareVariant(page, { code: 'hi', scale: 150, wide: true }, errors)
    await openNarrated(page, 'hi')
    await expectFakeInstalled(page, errors)
    await expectWideFallback(page, aborted())
    await walkNarrated(page, ['c1'])
    await waitFooterSettled(page)
    const check = async (state: string, key: string): Promise<void> => {
      await expect(page.locator(GROUP), `precondition: ${state}`).toHaveAttribute(
        'data-status',
        state,
      )
      await expect(
        page.locator(PLAYBACK),
        `precondition: ${state}: its label`,
      ).toHaveAccessibleName(label('hi', key))
      await frames(page)
      const fit = await page.evaluate(
        ({ group, playback, back }) => {
          const root = document.documentElement
          const groupElement = document.querySelector(group)
          const button = document.querySelector(playback)
          const backButton = document.querySelector(back)
          if (groupElement === null || button === null || backButton === null) {
            throw new Error('no group, playback button or Back')
          }
          const children = [...groupElement.children].map((child) => {
            const box = child.getBoundingClientRect()
            return { left: box.left, right: box.right }
          })
          const spans = [...(button.firstElementChild?.children ?? [])]
          const textBox = (span: Element): DOMRect => {
            const range = document.createRange()
            range.selectNodeContents(span)
            return range.getBoundingClientRect()
          }
          const linesOf = (span: Element): number => {
            const range = document.createRange()
            range.selectNodeContents(span)
            return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
          }
          const shown = spans.find((span) => span.getAttribute('aria-hidden') !== 'true')
          if (shown === undefined) throw new Error('no shown label')
          const text = textBox(shown)
          const box = button.getBoundingClientRect()
          const groupBox = groupElement.getBoundingClientRect()
          const backBox = backButton.getBoundingClientRect()
          // The Hindi paint offset (0.12em, relative) moves the text, not the cell: take it off.
          const paint = Number.parseFloat(getComputedStyle(shown).top) || 0
          return {
            scroll: root.scrollWidth <= root.clientWidth,
            inside: children.every(
              (child) => child.left >= -0.5 && child.right <= innerWidth + 0.5,
            ),
            besideBack: groupBox.left >= backBox.right - 0.5 && groupBox.top < backBox.bottom,
            shownLines: linesOf(shown),
            widestLines: Math.max(...spans.map(linesOf)),
            offset: (text.top + text.bottom) / 2 - paint - (box.top + box.bottom) / 2,
            heights: {
              read: document.querySelector(`${group} [data-read-to-me]`)?.getBoundingClientRect()
                .height,
              link: document.querySelector(`${group} [data-ai-voice]`)?.getBoundingClientRect()
                .height,
              playback: box.height,
            },
          }
        },
        { group: GROUP, playback: PLAYBACK, back: BACK },
      )
      expect(
        { besideBack: fit.besideBack, wraps: fit.widestLines >= 2 },
        `precondition: ${state}: the group sits beside Back and a reserved label wraps (${JSON.stringify(fit)})`,
      ).toEqual({ besideBack: true, wraps: true })
      expect
        .soft(
          { scroll: fit.scroll, inside: fit.inside },
          `(g1) ${state}: no horizontal scroll, every child on screen`,
        )
        .toEqual({ scroll: true, inside: true })
      for (const [what, height] of Object.entries(fit.heights)) {
        expect.soft(height ?? 0, `(g2) ${state}: ${what} at least 44 px`).toBeGreaterThanOrEqual(44)
      }
      expect
        .soft(
          Math.abs(fit.offset),
          `(g3) ${state}: the shown label (${fit.shownLines} line(s)) is centred in the playback button whose labels take ${fit.widestLines} lines: ${fit.offset.toFixed(2)} px off`,
        )
        .toBeLessThanOrEqual(1)
    }
    const on = await tap(page, READ)
    await expectMadeOne(page)
    await fakeControl(page, 'resolvePlay')
    await check('playing', 'player.pause')
    await waitAfter(page, on.t, AFTER_HOLD_MS)
    await tap(page, PLAYBACK)
    await check('paused', 'player.resume')
    await fakeControl(page, 'emit', { type: 'ended', patch: { paused: true, ended: true } })
    await check('ended', 'player.playAgain')
  })

  for (const code of CODES) {
    test(`T11-L3 /${code} with Read to me remembered: the playback button that appears after hydration moves nothing`, async ({
      page,
      fake,
      errors,
      browserName,
    }) => {
      void fake
      test.skip(browserName !== 'chromium', 'the Layout Instability API: Chromium only (13.8 P8)')
      // /hi with the wide fallback and its self-hosted font files aborted; /en as shipped (13.4.2:
      // "en, and hi with the wide fallback"; an /en page never requests the bold Devanagari faces,
      // so the wide precondition cannot hold there). The scripts are held until the fonts settle,
      // so every shift after the release is the client's. A shift before hydration cannot be
      // narration's: the server markup has no playback button, and Read to me is read only after
      // hydration (4.6).
      const wide = code === 'hi'
      const aborted = await prepareVariant(page, { code, scale: 100, wide }, errors)
      await seedPrefs(page, narrationPrefsText({ textScale: 100, readToMe: true }))
      await recordLayoutShifts(page)
      let release = (): void => undefined
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route(
        (url) => url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js'),
        async (route) => {
          await Promise.race([released, new Promise((resolve) => setTimeout(resolve, 15_000))])
          await route.continue().catch(() => undefined)
        },
      )
      const response = await page.goto(urlOf(code), { waitUntil: 'domcontentloaded' })
      expect(response?.status()).toBe(200)
      await page.evaluate(async () => {
        await document.fonts.ready
        await (window as unknown as Record<string, unknown>)['__e2eWideFallback']
      })
      const from = await pageNow(page)
      release()
      await waitOpen(page)
      await expectFakeInstalled(page, errors)
      if (wide) await expectWideFallback(page, aborted())
      await expect(page.locator(PLAYBACK), 'the playback button after hydration').toHaveAttribute(
        'data-kind',
        'tap-to-listen',
      )
      await waitAfter(page, from, 1500)
      const record = await narrationRecord(page)
      const inserted = record.kinds.find((stamp) => stamp.value !== null)?.t ?? Number.NaN
      const firstPaint = await page.evaluate(
        () => performance.getEntriesByName('first-paint')[0]?.startTime ?? Number.NaN,
      )
      expect(
        inserted,
        'precondition: the playback button was inserted after first paint',
      ).toBeGreaterThan(firstPaint)
      const onScreen = await page.locator(FOOTER).evaluate((footer) => {
        const box = footer.getBoundingClientRect()
        return box.bottom > 0 && box.top < innerHeight
      })
      const project = test.info().project.name
      if (ROW_PHONES.includes(project)) {
        test.info().annotations.push({
          type: 'T11-L3 footer on screen',
          description: `${project}: ${onScreen}`,
        })
      } else {
        expect(onScreen, 'precondition: the footer is on screen').toBe(true)
      }
      const shift = await layoutShift(page, { from, to: await pageNow(page) })
      expect
        .soft(
          shiftsOutside(shift.lines, ['[data-narration-control]']),
          `(g1) shifts with a source outside the playback button\n${shift.lines.join('\n')}`,
        )
        .toEqual([])
    })
  }

  // Review round 1 (R1-L-2; design §17). L1 compares document boxes and the Layout Instability API
  // leaves out what a scroll causes, so neither sees this: at the bottom of a long page a page that
  // gets one line shorter pulls the scroll position back, and every box on screen moves down by
  // that line, Pause included. While Read to me is on and the part has a clip, the status line's
  // box is kept, so loading, buffering and playing never change the page height.
  for (const variant of L4_VARIANTS) {
    test(`T11-L4 ${variantText(variant)}: at the bottom of a long page, loading, buffering and playing move no box on screen`, async ({
      page,
      fake,
      errors,
    }) => {
      void fake
      const project = test.info().project.name
      test.skip(variant.scale !== 100 && !ROW_PHONES.includes(project), '150% text: the phones')
      const aborted = await prepareVariant(page, variant, errors)
      await openNarrated(page, variant.code)
      await expectFakeInstalled(page, errors)
      if (variant.wide) await expectWideFallback(page, aborted())
      // ending_wet (start c2, round_stones c1): page 3, so Back shows; Read to me still off.
      await walkNarrated(page, ['c2', 'c1'])
      await expect(page.locator(PART), 'precondition: the ending').toHaveAttribute(
        'data-node',
        'ending_wet',
      )
      await waitFooterSettled(page)
      // (gD) No reserved line while Read to me is off: the group ends with its lowest child.
      const offBelow = await groupBelowChildren(page)
      expect
        .soft(offBelow, `(gD) off: no reserved line under the group (${offBelow} px)`)
        .toBeLessThanOrEqual(0.5)
      // A long page. Where the ending fits the screen (the tablets at 100%), the viewport is made
      // shorter, never narrower, so the layout is the project's and the page scrolls. The body is
      // at least the viewport tall (base.css), so the content's own end is main's bottom.
      const room = (await screenBoxes(page)).room
      const size = page.viewportSize()
      if (room < LONG_PAGE_PX && size !== null) {
        const content = await page.evaluate(() => {
          const main = document.querySelector('main')
          return main === null ? 0 : main.getBoundingClientRect().bottom + scrollY
        })
        const height = Math.floor(content) - LONG_PAGE_PX - 40
        await page.setViewportSize({ width: size.width, height })
        test.info().annotations.push({
          type: 'T11-L4 long page',
          description: `${project}: ${room} px to scroll at ${size.width}x${size.height}, content ${Math.round(content)} px; viewport ${size.width}x${height}`,
        })
        await frames(page)
      }
      const longPage = await screenBoxes(page)
      expect(
        longPage.room,
        `precondition: a long page (${JSON.stringify(longPage)})`,
      ).toBeGreaterThanOrEqual(LONG_PAGE_PX)
      await tap(page, READ)
      await expectMadeOne(page)
      await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'loading')
      const transition = async (
        name: string,
        act: () => Promise<void>,
        status: string,
        message: 'loading' | null,
      ): Promise<void> => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await frames(page)
        const before = await screenBoxes(page)
        expect(
          before.scrollY >= before.room - 1 && before.room >= LONG_PAGE_PX,
          `${name}: precondition: scrolled to the bottom of a long page (${JSON.stringify(before)})`,
        ).toBe(true)
        expect(
          [before.read, before.playback, before.back].every((box) => box !== null),
          `${name}: precondition: Read to me, the playback button and Back (${JSON.stringify(before)})`,
        ).toBe(true)
        await act()
        await expect(page.locator(GROUP), `${name}: precondition`).toHaveAttribute(
          'data-status',
          status,
        )
        if (message === null) {
          await expect(page.locator(MESSAGE), `${name}: precondition: no message`).toHaveCount(0)
        } else {
          await expect(page.locator(MESSAGE), `${name}: precondition: the message`).toHaveAttribute(
            'data-narration-message',
            message,
          )
        }
        await expect(page.locator(PLAYBACK), `${name}: precondition: Pause`).toHaveAccessibleName(
          label(variant.code, 'player.pause'),
        )
        await frames(page)
        const after = await screenBoxes(page)
        for (const box of ['read', 'playback', 'back'] as const) {
          expect
            .soft(
              sameBox(before[box], after[box]),
              `(gA) ${name}: ${box} on screen ${String(before[box])} -> ${String(after[box])} (scrollY ${before.scrollY} -> ${after.scrollY})`,
            )
            .toBe(true)
        }
        expect
          .soft(
            {
              height: Math.abs(after.height - before.height) <= 0.5,
              group: sameBox(before.group, after.group),
            },
            `(gB) ${name}: the page height ${before.height} -> ${after.height} and the group ${String(before.group)} -> ${String(after.group)}`,
          )
          .toEqual({ height: true, group: true })
      }
      await transition(
        'T1 loading to playing',
        () => fakeControl(page, 'resolvePlay'),
        'playing',
        null,
      )
      await transition(
        'T2 playing to buffering',
        async () => {
          await fakeControl(page, 'emit', {
            type: 'waiting',
            patch: { paused: false, readyState: 2 },
          })
          expect((await fakeState(page)).readyState, 'T2: precondition: the patch applied').toBe(2)
        },
        'buffering',
        'loading',
      )
      await transition(
        'T3 buffering to playing',
        async () => {
          await fakeControl(page, 'emit', { type: 'playing', patch: { readyState: 4 } })
          expect((await fakeState(page)).readyState, 'T3: precondition: the patch applied').toBe(4)
        },
        'playing',
        null,
      )
    })
  }
})

// ---------------------------------------------------------------------------------------------
// SPY and NETWORK (13.4.3, 13.4.4): the real element, only where the media answer allows

const SPY_STUB = { urls: CLIP_URLS, body: NARRATION_CLIP, contentType: 'audio/mpeg' }

/** A route of the test's own on the clip URLs: records each request, then the stub answers it. */
async function routeClips(
  page: Page,
  hold: { url: string; until: () => Promise<void> } | null = null,
): Promise<{ method: string; url: string }[]> {
  const seen: { method: string; url: string }[] = []
  await page.route(
    (url) => CLIP_URLS.includes(url.href),
    async (route) => {
      const request = route.request()
      seen.push({ method: request.method(), url: request.url() })
      if (hold !== null && request.url() === hold.url) await hold.until()
      await route.fallback().catch(() => undefined)
    },
  )
  return seen
}

/** Before the first navigation: skips unless the engine's media answer allows `need` (S10; Chromium only, design §23). */
async function askMediaFirst(
  browser: Parameters<typeof mediaAnswerFor>[0],
  need: 'routed' | 'decoded',
): Promise<void> {
  const answer = await mediaAnswerFor(browser)
  test.info().annotations.push({ type: 'media answer', description: JSON.stringify(answer) })
  test.skip(!mediaAllows(answer, need), mediaAnswerText(answer))
}

/** SPY: the precondition that the test's route saw a GET of the exact clip URL. */
async function expectClipGet(
  seen: readonly { method: string; url: string }[],
  url: string,
  count = 1,
): Promise<void> {
  await expect
    .poll(() => seen.filter((request) => request.method === 'GET' && request.url === url).length, {
      message: `precondition: the test's route saw a GET of ${url}`,
    })
    .toBeGreaterThanOrEqual(count)
}

/**
 * SPY: the held clip is still loading. The real element fires `waiting` while play() has no data
 * yet, so the status may be loading or already buffering (Chromium on Windows: buffering, seen at
 * integration); both are the one 4.4 row "loading, buffering" (kind pause, message Loading).
 */
async function expectClipPending(page: Page): Promise<void> {
  await expect(page.locator(GROUP)).toHaveAttribute('data-status', /^(?:loading|buffering)$/)
  await expect(page.locator(MESSAGE)).toHaveAttribute('data-narration-message', 'loading')
  await expect(page.locator(PLAYBACK)).toHaveAttribute('data-kind', 'pause')
}

/** The click bracket of `at` around its play() (S2 g1): open, play, close for one click id. */
function bracketOf(record: Awaited<ReturnType<typeof narrationRecord>>, at: Tap) {
  const click = record.clicks.find((stamp) => stamp.id === at.id)
  const play = record.log.find((entry) => entry.call === 'play' && entry.t >= at.t)
  return {
    trusted: click?.isTrusted === true,
    playInBracket: play !== undefined && play.clickId === at.id,
    order:
      click !== undefined &&
      play !== undefined &&
      click.close !== null &&
      click.open <= play.t &&
      play.t <= click.close,
  }
}

test.describe('narration in the player, Step 11: the real element', { tag: '@staging' }, () => {
  test.use({ mediaStub: SPY_STUB })

  test('T11-S1 /en: the real element is made in the tap, never attached, preload none, no crossorigin, and only GETs a clip', async ({
    page,
    browser,
    browserName,
    errors,
  }) => {
    await askMediaFirst(browser, 'routed')
    await installAudioSpy(page)
    const seen = await routeClips(page)
    const media: { method: string; url: string; t: number }[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).origin === MEDIA_ORIGIN) {
        media.push({ method: request.method(), url: request.url(), t: Date.now() })
      }
    })
    await openNarrated(page, 'en')
    await waitAfter(page, await pageNow(page), 1000)
    expect
      .soft(
        { requests: media.length, made: (await narrationRecord(page)).made },
        '(g1) before the tap: no media request, no audio element',
      )
      .toEqual({ requests: 0, made: 0 })
    const on = await tap(page, READ)
    await expectClipGet(seen, clipUrl('start', 'en'))
    const record = await narrationRecord(page)
    const create = record.log.find((entry) => entry.call === 'create')
    const play = record.log.find((entry) => entry.call === 'play')
    expect
      .soft(
        {
          createdInTap: create?.clickId === on.id && create.isTrusted === true,
          isConnected: play?.isConnected,
          preload: play?.preload,
          crossorigin: play?.crossorigin,
          src: play?.src,
          inDocument: record.audioInDocument,
        },
        '(g2) made in the tap, detached, preload none, no crossorigin, the start clip',
      )
      .toEqual({
        createdInTap: true,
        isConnected: false,
        preload: 'none',
        crossorigin: false,
        src: clipUrl('start', 'en'),
        inDocument: false,
      })
    expect
      .soft(
        media.filter((request) => request.method !== 'GET' || !CLIP_URLS.includes(request.url)),
        '(g3) every media request is a GET of a clip URL (never HEAD)',
      )
      .toEqual([])
    expectWriteIn(record.log, on, PREFS_KEY)
    expect
      .soft(playOf(record.log, on, PREFS_KEY).playBeforeWrite, '(g4) play() before the prefs write')
      .toBe(true)
    const lines = allowObserved(errors, browserName, [MEDIA_STATUS_LINE, ABORTED_LINE])
    if (lines.length > 0)
      test.info().annotations.push({ type: 'console lines', description: lines.join('\n') })
  })

  const SPY_ENTRIES = [
    { name: 'a choice', path: [] as string[], destination: 'flat_stones' },
    { name: 'Back', path: ['c1'], destination: 'start' },
    { name: 'Try another path', path: ['c2', 'c1'], destination: 'start' },
    { name: "the menu's Start again", path: ['c1'], destination: 'start' },
    { name: "the restart dialog's confirm", path: ['c1', 'c1'], destination: 'start' },
    { name: 'Enter on a choice', path: [] as string[], destination: 'flat_stones' },
  ] as const

  for (const entry of SPY_ENTRIES) {
    test(`T11-S2 /en: ${entry.name} calls play() inside the trusted click, before the progress write`, async ({
      page,
      browser,
      browserName,
      errors,
    }) => {
      await askMediaFirst(browser, 'routed')
      await installAudioSpy(page)
      const seen = await routeClips(page)
      await openNarrated(page, 'en')
      await tap(page, READ)
      await expectClipGet(seen, clipUrl('start', 'en'))
      await walkNarrated(page, entry.path)
      let step: Tap
      if (entry.name === 'Enter on a choice') {
        // N27 (design §20.3.6): the choices are held for 500 ms after the Read to me tap.
        await expect(page.locator(CHOICES)).not.toHaveAttribute('inert')
        step = await enterOn(page, choice('c1', 'start'))
      } else if (entry.name === 'a choice') step = await tap(page, choice('c1', 'start'))
      else if (entry.name === 'Back') {
        await waitFooterSettled(page)
        step = await tap(page, BACK)
      } else if (entry.name === 'Try another path') {
        await expect(page.locator(CARD_ACTIONS)).not.toHaveAttribute('inert')
        step = await tap(page, TRY_ANOTHER)
      } else {
        await page.locator(MENU).click()
        if (entry.name === "the menu's Start again") step = await tap(page, MENU_RESTART)
        else {
          await page.locator(MENU_RESTART).click()
          await expect(page.locator('dialog[data-restart-confirm]')).toHaveAttribute('open')
          step = await tap(page, DIALOG_ACCEPT)
        }
      }
      await expect(page.locator(PART)).toHaveAttribute('data-node', entry.destination)
      await expectClipGet(seen, clipUrl(entry.destination, 'en'))
      const record = await narrationRecord(page)
      expectWriteIn(record.log, step, PROGRESS_KEY)
      expect
        .soft(bracketOf(record, step), '(g1) click start, play(), click end for one trusted click')
        .toEqual({ trusted: true, playInBracket: true, order: true })
      const placed = playOf(record.log, step, PROGRESS_KEY)
      expect.soft(placed.playBeforeWrite, '(g2) play() before the progress write').toBe(true)
      expect
        .soft(
          record.log.find((e) => e.call === 'play' && e.t >= step.t)?.src,
          '(g3) the destination clip',
        )
        .toBe(clipUrl(entry.destination, 'en'))
      const lines = allowObserved(errors, browserName, [MEDIA_STATUS_LINE, ABORTED_LINE])
      if (lines.length > 0)
        test.info().annotations.push({ type: 'console lines', description: lines.join('\n') })
    })
  }

  test('T11-S3 /en: the real element stops with pause, src removed and load', async ({
    page,
    browser,
    browserName,
    errors,
  }) => {
    await askMediaFirst(browser, 'routed')
    await installAudioSpy(page)
    const seen = await routeClips(page)
    await openNarrated(page, 'en')
    const on = await tap(page, READ)
    await expectClipGet(seen, clipUrl('start', 'en'))
    await waitAfter(page, on.t, AFTER_HOLD_MS)
    test.info().annotations.push({
      type: 'status before the stop',
      description: String(await page.locator(GROUP).getAttribute('data-status')),
    })
    const off = await tap(page, READ)
    expect
      .soft(
        callNames(
          mediaCalls((await narrationRecord(page)).log.filter((entry) => entry.clickId === off.id)),
        ),
        '(g1) Read to me off: pause, remove src, load inside the click, in this order',
      )
      .toEqual(['pause', 'removeAttribute', 'load'])
    await waitAfter(page, off.t, AFTER_HOLD_MS)
    await tap(page, READ)
    await expectClipGet(seen, clipUrl('start', 'en'), 2)
    const leave = await tap(page, ALL_STORIES)
    await page.waitForURL((url) => url.pathname === '/en')
    await expect
      .poll(
        async () =>
          callNames(
            mediaCalls((await narrationRecord(page)).log.filter((entry) => entry.t >= leave.t)),
          ),
        { message: '(g2) All stories: pause, remove src, load after the tap' },
      )
      .toEqual(['pause', 'removeAttribute', 'load'])
    const lines = allowObserved(errors, browserName, [MEDIA_STATUS_LINE, ABORTED_LINE])
    if (lines.length > 0)
      test.info().annotations.push({ type: 'console lines', description: lines.join('\n') })
  })

  test('T11-S4 /en: our own Pause or a choice while the clip loads never shows unavailable', async ({
    page,
    browser,
    browserName,
    errors,
  }) => {
    await askMediaFirst(browser, 'routed')
    await installAudioSpy(page)
    let open = false
    let releaseHold = (): void => undefined
    let gate = Promise.resolve()
    const arm = (): void => {
      open = false
      gate = new Promise<void>((resolve) => {
        releaseHold = () => {
          open = true
          resolve()
        }
      })
    }
    arm()
    const start = clipUrl('start', 'en')
    const seen = await routeClips(page, {
      url: start,
      until: () => (open ? Promise.resolve() : gate),
    })
    await openNarrated(page, 'en')
    // (g1) loading; our own Pause: AbortError, paused, never unavailable.
    const on = await tap(page, READ)
    await expectClipGet(seen, start)
    await expectClipPending(page)
    await waitAfter(page, on.t, AFTER_HOLD_MS)
    const pause = await tap(page, PLAYBACK)
    await expect
      .poll(
        async () =>
          (await narrationRecord(page)).log
            .filter((entry) => entry.t >= on.t && entry.call === 'play-rejected')
            .map((entry) => entry.value),
        { message: '(g1) the pending play rejects with AbortError' },
      )
      .toContain('AbortError')
    await expect.soft(page.locator(GROUP), '(g1) paused').toHaveAttribute('data-status', 'paused')
    // (g2) the held clip released: still not unavailable.
    releaseHold()
    const released = await pageNow(page)
    await waitAfter(page, released, 1000)
    expect
      .soft(
        (await narrationRecord(page)).status.map((s) => s.value),
        '(g2) never unavailable',
      )
      .not.toContain('unavailable')
    // (g3) a choice while a load is pending. A fully buffered 6 KB clip resumes with no new request
    // (Chromium), so the route could not hold a Resume: Read to me off and on loads the start clip
    // again under a new hold instead (a deviation from 13.4.3's "Resume", reported to the lead).
    arm()
    await waitAfter(page, pause.t, AFTER_HOLD_MS)
    const off = await tap(page, READ)
    await waitAfter(page, off.t, AFTER_HOLD_MS)
    await tap(page, READ)
    await expectClipGet(seen, start, 2)
    await expectClipPending(page)
    const step = await tap(page, choice('c1', 'start'))
    await expect(page.locator(PART)).toHaveAttribute('data-node', 'flat_stones')
    const record = await narrationRecord(page)
    expect
      .soft(playOf(record.log, step, PROGRESS_KEY).src, '(g3) a new src')
      .toBe(clipUrl('flat_stones', 'en'))
    await expect
      .poll(
        async () =>
          (await narrationRecord(page)).log
            .filter((entry) => entry.t >= off.t && entry.call === 'play-rejected')
            .map((entry) => entry.value),
        { message: "(g3) the old play's AbortError" },
      )
      .toContain('AbortError')
    releaseHold()
    await waitAfter(page, await pageNow(page), 1000)
    expect
      .soft(
        (await narrationRecord(page)).status.map((s) => s.value),
        '(g3) never unavailable',
      )
      .not.toContain('unavailable')
    const lines = allowObserved(errors, browserName, [MEDIA_STATUS_LINE, ABORTED_LINE])
    if (lines.length > 0)
      test.info().annotations.push({ type: 'console lines', description: lines.join('\n') })
  })

  test('T11-S5 /en: Play again restarts the ended clip from 0', async ({
    page,
    browser,
    browserName,
    errors,
  }) => {
    await askMediaFirst(browser, 'decoded')
    await installAudioSpy(page)
    const seen = await routeClips(page)
    await openNarrated(page, 'en')
    await tap(page, READ)
    await expectClipGet(seen, clipUrl('start', 'en'))
    await expect(page.locator(GROUP), '(g1) the clip plays to its end').toHaveAttribute(
      'data-status',
      'ended',
      {
        timeout: 10_000,
      },
    )
    const ended = (await narrationRecord(page)).log.find(
      (entry) => entry.call === 'event' && entry.name === 'ended',
    )
    await expect
      .soft(page.locator(PLAYBACK), '(g1) Play again')
      .toHaveAttribute('data-kind', 'play-again')
    expect.soft(ended?.currentTime ?? 0, '(g1) at least 1.0 s played').toBeGreaterThanOrEqual(1)
    const again = await tap(page, PLAYBACK)
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing', { timeout: 10_000 })
    const record = await narrationRecord(page)
    const after = record.log.filter((entry) => entry.t >= again.t)
    expect
      .soft(
        after
          .filter((entry) => entry.call === 'setAttribute' || entry.call === 'play')
          .map((entry) => entry.call),
        '(g2) play() with no src set after it',
      )
      .toEqual(['play'])
    const playing = after.find((entry) => entry.call === 'event' && entry.name === 'playing')
    expect
      .soft(playing?.currentTime ?? Number.NaN, '(g2) from 0 at the next playing')
      .toBeLessThanOrEqual(0.1)
    await expect
      .soft(page.locator(GROUP), '(g2) ended again')
      .toHaveAttribute('data-status', 'ended', {
        timeout: 10_000,
      })
    const lines = allowObserved(errors, browserName, [MEDIA_STATUS_LINE, ABORTED_LINE])
    if (lines.length > 0)
      test.info().annotations.push({ type: 'console lines', description: lines.join('\n') })
  })

  for (const status of [402, 540] as const) {
    test.describe(`a clip answered with ${status}`, () => {
      test.use({ mediaStub: { ...SPY_STUB, status } })

      test(`T11-N${status === 402 ? 1 : 2} /en: a ${status} clip shows unavailable, Tap to listen loads it again, and choices still step`, async ({
        page,
        browser,
        browserName,
        errors,
      }) => {
        await askMediaFirst(browser, 'decoded')
        await installAudioSpy(page)
        const seen = await routeClips(page)
        const statuses: { url: string; status: number }[] = []
        page.on('response', (response) => {
          if (CLIP_URLS.includes(response.url()))
            statuses.push({ url: response.url(), status: response.status() })
        })
        await openNarrated(page, 'en')
        const start = clipUrl('start', 'en')
        const on = await tap(page, READ)
        await expectClipGet(seen, start)
        await expect
          .poll(
            () => statuses.filter((answer) => answer.url === start).map((answer) => answer.status),
            {
              message: `precondition: the response for the clip was ${status}`,
            },
          )
          .toContain(status)
        await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'unavailable', {
          timeout: 10_000,
        })
        const record = await narrationRecord(page)
        const failure = record.log
          .filter((entry) => entry.t >= on.t)
          .filter(
            (entry) =>
              (entry.call === 'event' && entry.name === 'error') || entry.call === 'play-rejected',
          )
          .map((entry) =>
            entry.call === 'event'
              ? `error code ${String(entry.errorCode)}`
              : `play() ${entry.value ?? ''}`,
          )
        expect
          .soft(
            failure.some((text) => /error code [2-4]|NotSupportedError/.test(text)),
            `(g1) a media error (not code 1) or NotSupportedError: ${failure.join(', ')}`,
          )
          .toBe(true)
        await expect
          .soft(page.locator(MESSAGE), '(g1) the message')
          .toHaveAttribute('data-narration-message', 'unavailable')
        await expect
          .soft(page.locator(PLAYBACK), '(g1) Tap to listen')
          .toHaveAttribute('data-kind', 'tap-to-listen')
        await expect.soft(page.locator(PLAYBACK), '(g1) no pulse').not.toHaveAttribute('data-pulse')
        // (g2) Tap to listen asks for the same clip again.
        await waitAfter(page, on.t, AFTER_HOLD_MS)
        await tap(page, PLAYBACK)
        await expect
          .poll(
            () =>
              seen.filter((request) => request.method === 'GET' && request.url === start).length,
            {
              message: '(g2) a second GET of the same clip',
            },
          )
          .toBeGreaterThanOrEqual(2)
        await expect
          .soft(page.locator(GROUP), '(g2) unavailable again')
          .toHaveAttribute('data-status', 'unavailable', {
            timeout: 10_000,
          })
        // (g3) a choice still steps; its clip is asked for and fails too.
        await tap(page, choice('c1', 'start'))
        await expect
          .soft(page.locator(PART), '(g3) Page 2')
          .toHaveAttribute('data-node', 'flat_stones')
        await expect
          .poll(
            () =>
              seen.filter(
                (request) =>
                  request.method === 'GET' && request.url === clipUrl('flat_stones', 'en'),
              ).length,
            { message: '(g3) the flat_stones clip was asked for' },
          )
          .toBeGreaterThanOrEqual(1)
        await expect
          .soft(page.locator(GROUP), '(g3) unavailable')
          .toHaveAttribute('data-status', 'unavailable', {
            timeout: 10_000,
          })
        const lines = allowObserved(errors, browserName, [MEDIA_STATUS_LINE, ABORTED_LINE])
        if (lines.length > 0)
          test.info().annotations.push({ type: 'console lines', description: lines.join('\n') })
      })
    })
  }
})

// ---------------------------------------------------------------------------------------------
// Harness self-tests (13.4.6)

/** A same-origin page the harness tests serve themselves (page.route): no app code, no CSP. */
const PROBE_PATH = '/e2e-narration-probe'
/** A same-origin media URL: a tripwire miss stays on this machine (the app answers 404). */
const TRIP_URL = '/e2e-tripwire.mp3'

async function serveProbe(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === PROBE_PATH,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html lang="en"><head><title>narration probe</title></head><body></body></html>',
      }),
  )
}

test.describe('narration in the player, Step 11: the harness', { tag: '@staging' }, () => {
  test('T11-M1 the media answer is non-vacuous', async ({ browser, browserName }) => {
    const answer = await mediaAnswerFor(browser)
    test.info().annotations.push({ type: 'media answer', description: JSON.stringify(answer) })
    // The CI list reporter prints no annotations, so the answer goes to stdout too (design §23, S9).
    console.log(`[media-answer] ${test.info().project.name} ${JSON.stringify(answer)}`)
    if (browserName === 'chromium') {
      // PR-2 and PR-3 on Windows; unprobed on Linux (a red here on CI is routed under S9).
      expect
        .soft(
          { routed: answer.routed, escapes: answer.escapes, decoded: answer.decoded },
          `(g1) Chromium: routed, no escape, decoded (${JSON.stringify(answer)})`,
        )
        .toEqual({ routed: true, escapes: 0, decoded: true })
    }
    const chromium = 'chromium 0.0'
    expect
      .soft(
        [
          mediaAllows({ engine: chromium, routed: true, escapes: 1, decoded: true }, 'routed'),
          mediaAllows({ engine: chromium, routed: false, escapes: 0, decoded: true }, 'routed'),
          mediaAllows({ engine: chromium, routed: true, escapes: 0, decoded: false }, 'decoded'),
          mediaAllows({ engine: chromium, routed: true, escapes: 0, decoded: true }, 'routed'),
          mediaAllows({ engine: chromium, routed: true, escapes: 0, decoded: true }, 'decoded'),
          mediaAllows({ engine: chromium, routed: true, escapes: 0, decoded: false }, 'routed'),
        ],
        '(g2) mediaAllows on literal answers',
      )
      .toEqual([false, false, false, true, true, true])
    // CI run 44604741639 (Linux WebKit): the probe answered routed with no escape, yet for each clip
    // load on the site page the guard saw a request the media stub never answered. WebKit never runs
    // a real element, whatever its answer says (design §23).
    expect
      .soft(
        [
          mediaAllows({ engine: 'webkit 0.0', routed: true, escapes: 0, decoded: true }, 'routed'),
          mediaAllows({ engine: 'webkit 0.0', routed: true, escapes: 0, decoded: true }, 'decoded'),
          mediaAllows({ engine: 'WebKit 0.0', routed: true, escapes: 0, decoded: true }, 'routed'),
          mediaAllows({ engine: 'firefox 0.0', routed: true, escapes: 0, decoded: true }, 'routed'),
        ],
        '(g3) WebKit (and any engine other than Chromium) never allows a real element',
      )
      .toEqual([false, false, false, false])
    // This engine's own name with the best possible answer: WebKit is refused even so (g4), and
    // Chromium's own answer lets the real element run (g5), so a changed engine string cannot
    // silently skip every real-element test.
    const best = { ...answer, routed: true, escapes: 0, decoded: true }
    if (browserName === 'webkit') {
      expect
        .soft(
          [mediaAllows(best, 'routed'), mediaAllows(best, 'decoded')],
          `(g4) this WebKit (${answer.engine}) allows no real element, even routed and decoded`,
        )
        .toEqual([false, false])
    }
    if (browserName === 'chromium') {
      expect
        .soft(
          [mediaAllows(answer, 'routed'), mediaAllows(answer, 'decoded')],
          `(g5) this Chromium's own answer allows the real element (${JSON.stringify(answer)})`,
        )
        .toEqual([true, true])
    }
  })

  test('T11-M2 the FAKE tripwire blocks and records each way to load a real media element', async ({
    page,
    browserName,
    errors,
  }) => {
    await installFakeAudio(page)
    await serveProbe(page)
    let tripRequests = 0
    await page.route(
      (url) => url.pathname === TRIP_URL,
      async (route) => {
        tripRequests++
        await route.abort().catch(() => undefined)
      },
    )
    await page.goto(PROBE_PATH)
    const installed = (await narrationRecord(page)).installed
    test
      .info()
      .annotations.push({ type: 'tripwire patches', description: JSON.stringify(installed) })
    const fakeFor = await page.evaluate(() => ({
      lower:
        (document.createElement('audio') as unknown as Record<string, unknown>)['__e2eFake'] ===
        true,
      upper:
        (document.createElement('AUDIO') as unknown as Record<string, unknown>)['__e2eFake'] ===
        true,
    }))
    expect
      .soft(fakeFor, "createElement('audio' and 'AUDIO') give the fake")
      .toEqual({ lower: true, upper: true })
    expect.soft((await narrationRecord(page)).tripwire, 'the fake is not recorded').toEqual([])

    // [form, the patches it needs]; the page runs the form of the same name (catalogue classes:
    // the setter, the method, computed, alias, Reflect, the descriptor, every Audio global, video,
    // <source>, play and load; review round 1, S11-R1-FS-1: array-pattern assignment, and the
    // attribute-node routes that native code takes without calling setAttribute).
    const FORMS: readonly (readonly [string, readonly string[]])[] = [
      ['array-pattern assignment [el.src] = [u]', ['media src setter']],
      ['setAttributeNode(a src Attr)', ['setAttributeNode']],
      ['setAttributeNodeNS(a src Attr)', ['setAttributeNodeNS']],
      ['attributes.setNamedItem(a src Attr)', ['attributes getter', 'setNamedItem']],
      ['attributes.setNamedItemNS(a src Attr)', ['attributes getter', 'setNamedItemNS']],
      ["an attached src Attr's value, after toggleAttribute('src')", ['Attr value setter']],
      ["an attached src Attr's nodeValue", ['nodeValue setter']],
      ["an attached src Attr's textContent", ['textContent setter']],
      ["createElementNS(XHTML, 'audio') then .src", ['media src setter']],
      ["setAttribute('src')", ['setAttribute']],
      ["setAttributeNS(null, 'src')", ['setAttributeNS']],
      // Review round 2 (S11-R2-FS-2): an empty or undefined namespace is no namespace.
      ["setAttributeNS('', 'src')", ['setAttributeNS']],
      ["setAttributeNS(undefined, 'src')", ['setAttributeNS']],
      ["computed el['setAttribute']", ['setAttribute']],
      ['an alias of setAttribute', ['setAttribute']],
      ['Reflect.apply(setAttribute)', ['setAttribute']],
      ["Reflect.set(el, 'src')", ['media src setter']],
      ["the src descriptor's setter called directly", ['media src setter']],
      ['new Audio(u)', ['Audio']],
      ['new window.Audio(u)', ['Audio']],
      ['new globalThis.Audio(u)', ['Audio']],
      ['new self.Audio(u)', ['Audio']],
      ["createElement('video') with src", ['media src setter']],
      ['a <source> src setter in a real audio', ['source src setter']],
      ["a <source> setAttribute('src') in a real audio", ['setAttribute']],
      ['play() and load() on a real element', ['play', 'load']],
    ]
    for (const [form, patches] of FORMS) {
      const refused = patches.filter((patch) => installed[patch]?.configurable === false)
      if (refused.length > 0) {
        test.info().annotations.push({
          type: 'T11-M2 form skipped',
          description: `${form}: the engine refused to replace ${refused.join(', ')} (R24) ${JSON.stringify(installed)}`,
        })
        continue
      }
      const before = (await narrationRecord(page)).tripwire.length
      await page.evaluate(
        ({ name, u }) => {
          const w = window as unknown as Record<string, unknown>
          const kept = (w['__e2eKept'] ??= []) as unknown[]
          const keep = <T>(value: T): T => {
            kept.push(value)
            return value
          }
          const XHTML = 'http://www.w3.org/1999/xhtml'
          const real = (): HTMLMediaElement =>
            keep(document.createElementNS(XHTML, 'audio') as HTMLMediaElement)
          const withSource = (): HTMLSourceElement => {
            const source = document.createElement('source')
            real().append(source)
            return source
          }
          const srcAttr = (): Attr => {
            const attr = document.createAttribute('src')
            attr.value = u
            return attr
          }
          // toggleAttribute can only add an empty src, which fetches nothing (HTML resource
          // selection fails at once), so it is not a form of its own; it gives the attached Attr.
          const attachedSrc = (): Attr => {
            const el = real()
            el.toggleAttribute('src', true)
            const attr = el.getAttributeNode('src')
            if (attr === null) throw new Error('toggleAttribute added no src Attr')
            return attr
          }
          const forms: Record<string, () => void> = {
            // Run from source text: the transform may rewrite array destructuring with a helper
            // the serialized function cannot reach (see narration-media.ts).
            'array-pattern assignment [el.src] = [u]': () => {
              new Function('el', 'u', '[el.src] = [u]')(real(), u)
            },
            'setAttributeNode(a src Attr)': () => {
              real().setAttributeNode(srcAttr())
            },
            'setAttributeNodeNS(a src Attr)': () => {
              const attr = document.createAttributeNS(null, 'src')
              attr.value = u
              real().setAttributeNodeNS(attr)
            },
            'attributes.setNamedItem(a src Attr)': () => {
              real().attributes.setNamedItem(srcAttr())
            },
            'attributes.setNamedItemNS(a src Attr)': () => {
              real().attributes.setNamedItemNS(srcAttr())
            },
            "an attached src Attr's value, after toggleAttribute('src')": () => {
              attachedSrc().value = u
            },
            "an attached src Attr's nodeValue": () => {
              attachedSrc().nodeValue = u
            },
            "an attached src Attr's textContent": () => {
              attachedSrc().textContent = u
            },
            "createElementNS(XHTML, 'audio') then .src": () => {
              real().src = u
            },
            "setAttribute('src')": () => real().setAttribute('src', u),
            "setAttributeNS(null, 'src')": () => real().setAttributeNS(null, 'src', u),
            "setAttributeNS('', 'src')": () => real().setAttributeNS('', 'src', u),
            "setAttributeNS(undefined, 'src')": () =>
              Reflect.apply(Element.prototype.setAttributeNS, real(), [undefined, 'src', u]),
            "computed el['setAttribute']": () => real()['setAttribute']('src', u),
            'an alias of setAttribute': () => {
              const set = Element.prototype.setAttribute
              set.call(real(), 'src', u)
            },
            'Reflect.apply(setAttribute)': () =>
              Reflect.apply(Element.prototype.setAttribute, real(), ['src', u]),
            "Reflect.set(el, 'src')": () => {
              Reflect.set(real(), 'src', u)
            },
            "the src descriptor's setter called directly": () =>
              Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')?.set?.call(
                real(),
                u,
              ),
            'new Audio(u)': () => keep(new Audio(u)),
            'new window.Audio(u)': () => keep(new window.Audio(u)),
            'new globalThis.Audio(u)': () => keep(new globalThis.Audio(u)),
            'new self.Audio(u)': () => keep(new self.Audio(u)),
            "createElement('video') with src": () => {
              keep(document.createElement('video')).src = u
            },
            'a <source> src setter in a real audio': () => {
              withSource().src = u
            },
            "a <source> setAttribute('src') in a real audio": () =>
              withSource().setAttribute('src', u),
            'play() and load() on a real element': () => {
              const audio = real()
              audio.play().catch(() => undefined)
              audio.load()
            },
          }
          const run = forms[name]
          if (run === undefined) throw new Error(`no form ${name}`)
          run()
        },
        { name: form, u: TRIP_URL },
      )
      const recorded = (await narrationRecord(page)).tripwire.slice(before)
      expect
        .soft(
          {
            replaced: patches.every((patch) => installed[patch]?.replaced === true),
            recorded: recorded.length > 0,
          },
          `${form}: its patch is in place and the form was recorded (${JSON.stringify(recorded)})`,
        )
        .toEqual({ replaced: true, recorded: true })
    }

    // Review round 2 (S11-R2-FS-2): near misses on a real element through the same routes. Only
    // the content attribute src loads media: no namespace and the local name exactly 'src'
    // (setAttributeNS and createAttributeNS keep the case). Every other attribute is applied and
    // not recorded, so the tripwire never blocks what cannot load.
    const NEAR_MISSES: readonly (readonly [string, readonly string[]])[] = [
      ["setAttributeNS('urn:x', 'x:src')", ['setAttributeNS']],
      ["setAttributeNS('urn:x', 'src')", ['setAttributeNS']],
      ["setAttributeNS(null, 'SRC')", ['setAttributeNS']],
      ["setAttributeNode(an Attr 'SRC' in no namespace)", ['setAttributeNode']],
      ["setAttributeNodeNS(an Attr 'x:src' in urn:x)", ['setAttributeNodeNS']],
      ["setAttributeNode(a 'preload' Attr)", ['setAttributeNode']],
      ["attributes.setNamedItem(a 'preload' Attr)", ['attributes getter', 'setNamedItem']],
      [
        "attributes.setNamedItemNS(an Attr 'x:src' in urn:x)",
        ['attributes getter', 'setNamedItemNS'],
      ],
      ["an attached 'data-x' Attr's value", ['Attr value setter']],
      ["an attached 'data-x' Attr's nodeValue", ['nodeValue setter']],
      ["an attached 'data-x' Attr's textContent", ['textContent setter']],
      ["an attached 'x:src' Attr's value (urn:x)", ['setAttributeNS', 'Attr value setter']],
    ]
    for (const [form, patches] of NEAR_MISSES) {
      const refused = patches.filter((patch) => installed[patch]?.configurable === false)
      if (refused.length > 0) {
        test.info().annotations.push({
          type: 'T11-M2 near miss skipped',
          description: `${form}: the engine refused to replace ${refused.join(', ')} (R24) ${JSON.stringify(installed)}`,
        })
        continue
      }
      const before = (await narrationRecord(page)).tripwire.length
      const applied = await page.evaluate(
        ({ name, u }) => {
          const w = window as unknown as Record<string, unknown>
          const kept = (w['__e2eKept'] ??= []) as unknown[]
          const real = (): HTMLMediaElement => {
            const el = document.createElementNS('http://www.w3.org/1999/xhtml', 'audio')
            kept.push(el)
            return el as HTMLMediaElement
          }
          const attrOf = (space: string | null, qualified: string, value: string): Attr => {
            const attr = document.createAttributeNS(space, qualified)
            attr.value = value
            return attr
          }
          const attached = (el: Element, name: string): Attr | null => {
            el.setAttribute(name, 'a')
            return el.getAttributeNode(name)
          }
          const forms: Record<string, () => boolean> = {
            "setAttributeNS('urn:x', 'x:src')": () => {
              const el = real()
              el.setAttributeNS('urn:x', 'x:src', u)
              return el.getAttributeNS('urn:x', 'src') === u
            },
            "setAttributeNS('urn:x', 'src')": () => {
              const el = real()
              el.setAttributeNS('urn:x', 'src', u)
              return el.getAttributeNS('urn:x', 'src') === u
            },
            "setAttributeNS(null, 'SRC')": () => {
              const el = real()
              el.setAttributeNS(null, 'SRC', u)
              return el.getAttributeNS(null, 'SRC') === u
            },
            "setAttributeNode(an Attr 'SRC' in no namespace)": () => {
              const el = real()
              el.setAttributeNode(attrOf(null, 'SRC', u))
              return el.getAttributeNS(null, 'SRC') === u
            },
            "setAttributeNodeNS(an Attr 'x:src' in urn:x)": () => {
              const el = real()
              el.setAttributeNodeNS(attrOf('urn:x', 'x:src', u))
              return el.getAttributeNS('urn:x', 'src') === u
            },
            "setAttributeNode(a 'preload' Attr)": () => {
              const el = real()
              el.setAttributeNode(attrOf(null, 'preload', 'none'))
              return el.getAttribute('preload') === 'none'
            },
            "attributes.setNamedItem(a 'preload' Attr)": () => {
              const el = real()
              el.attributes.setNamedItem(attrOf(null, 'preload', 'none'))
              return el.getAttribute('preload') === 'none'
            },
            "attributes.setNamedItemNS(an Attr 'x:src' in urn:x)": () => {
              const el = real()
              el.attributes.setNamedItemNS(attrOf('urn:x', 'x:src', u))
              return el.getAttributeNS('urn:x', 'src') === u
            },
            "an attached 'data-x' Attr's value": () => {
              const el = real()
              const attr = attached(el, 'data-x')
              if (attr !== null) attr.value = u
              return el.getAttribute('data-x') === u
            },
            "an attached 'data-x' Attr's nodeValue": () => {
              const el = real()
              const attr = attached(el, 'data-x')
              if (attr !== null) attr.nodeValue = u
              return el.getAttribute('data-x') === u
            },
            "an attached 'data-x' Attr's textContent": () => {
              const el = real()
              const attr = attached(el, 'data-x')
              if (attr !== null) attr.textContent = u
              return el.getAttribute('data-x') === u
            },
            "an attached 'x:src' Attr's value (urn:x)": () => {
              const el = real()
              el.setAttributeNS('urn:x', 'x:src', 'a')
              const attr = el.getAttributeNodeNS('urn:x', 'src')
              if (attr !== null) attr.value = u
              return el.getAttributeNS('urn:x', 'src') === u
            },
          }
          const run = forms[name]
          if (run === undefined) throw new Error(`no near miss ${name}`)
          return run()
        },
        { name: form, u: TRIP_URL },
      )
      const recorded = (await narrationRecord(page)).tripwire.slice(before)
      expect
        .soft(
          {
            replaced: patches.every((patch) => installed[patch]?.replaced === true),
            recorded: recorded.length > 0,
            applied,
          },
          `${form}: a near miss, applied and not recorded (${JSON.stringify(recorded)})`,
        )
        .toEqual({ replaced: true, recorded: false, applied: true })
    }
    await page.waitForTimeout(300)
    if (browserName === 'chromium') {
      expect
        .soft(tripRequests, 'Chromium: the test route saw no request for the tripwire URL')
        .toBe(0)
    }
    // Documented limit: an element the parser makes with a src is not recorded.
    const beforeLimit = (await narrationRecord(page)).tripwire.length
    await page.evaluate((url) => {
      const box = document.createElement('div')
      box.innerHTML = `<audio preload="none" src="${url}"></audio>`
      ;(window as unknown as Record<string, unknown>)['__e2eLimit'] = box
    }, TRIP_URL)
    await page.waitForTimeout(300)
    expect
      .soft(
        (await narrationRecord(page)).tripwire.slice(beforeLimit),
        "documented limit: innerHTML's audio is not recorded",
      )
      .toEqual([])
    const lines = allowObserved(errors, browserName, [ABORTED_LINE])
    if (lines.length > 0)
      test.info().annotations.push({ type: 'console lines', description: lines.join('\n') })
  })

  test('T11-M3 the click bracket', async ({ page, fake }) => {
    void fake
    await serveProbe(page)
    await page.goto(PROBE_PATH)
    await page.evaluate(() => {
      const audio = document.createElement('audio') as unknown as { play(): Promise<void> }
      const play = (): void => {
        void audio.play().catch(() => undefined)
      }
      const make = (id: string, handler: (event: MouseEvent) => void): void => {
        const button = document.createElement('button')
        button.type = 'button'
        button.id = id
        button.textContent = id
        button.addEventListener('click', handler)
        document.body.append(button)
      }
      make('sync', () => play())
      make('microtask', () => queueMicrotask(play))
      make('timeout', () => setTimeout(play, 0))
      make('frame', () => requestAnimationFrame(play))
      make('stopped', (event) => {
        event.stopPropagation()
        play()
      })
    })
    const results: Record<string, { inClick: boolean; closedBy: string | null }> = {}
    for (const id of ['sync', 'microtask', 'timeout', 'frame', 'stopped']) {
      const before = (await narrationRecord(page)).log.filter(
        (entry) => entry.call === 'play',
      ).length
      const click = await tap(page, `#${id}`)
      await expect
        .poll(
          async () =>
            (await narrationRecord(page)).log.filter((entry) => entry.call === 'play').length,
        )
        .toBe(before + 1)
      await frames(page)
      const record = await narrationRecord(page)
      const play = record.log.filter((entry) => entry.call === 'play')[before]
      results[id] = {
        inClick: play !== undefined && play.clickId === click.id,
        closedBy: record.clicks.find((stamp) => stamp.id === click.id)?.closedBy ?? null,
      }
    }
    expect
      .soft(
        { sync: results['sync']?.inClick, microtask: results['microtask']?.inClick },
        'inside: play() in the handler and in its microtask (CRIT-8)',
      )
      .toEqual({ sync: true, microtask: true })
    expect
      .soft(
        { timeout: results['timeout']?.inClick, frame: results['frame']?.inClick },
        'outside: play() in a timer and in a frame',
      )
      .toEqual({ timeout: false, frame: false })
    expect
      .soft(results['stopped'], 'a handler that stops propagation: inside, closed by the timer')
      .toEqual({ inClick: true, closedBy: 'timer' })
    expect
      .soft(results['sync']?.closedBy, 'a plain click closes at the window bubble listener')
      .toBe('bubble')
  })

  test('T11-M4 the shift-source filter', () => {
    const at = (sources: string): string => `shift 0.010000 at 1200 ms: ${sources}`
    const box = ' (10,20,30,40) -> (10,24,30,40)'
    expect
      .soft(
        shiftsOutside(
          [
            at(`a[data-ai-voice]${box}`),
            at(`button[data-narration-control][data-kind]${box}`),
            at(`text in button[data-narration-control][data-kind] > span:nth-child(1)${box}`),
            at(`p[data-narration-message]${box}`),
            at(`div[data-narration][data-status][data-on]${box}`),
            at(`button[data-narration-control][data-kind]${box}; h1:nth-child(1)${box}`),
            'shift 0.010000 at 1200 ms: no sources',
            at(`(a removed node)${box}`),
          ],
          NARRATION_BOXES,
        ),
        'outside: the link, the group itself, one outside source among several, no sources, a removed node',
      )
      .toEqual([
        at(`a[data-ai-voice]${box}`),
        at(`div[data-narration][data-status][data-on]${box}`),
        at(`button[data-narration-control][data-kind]${box}; h1:nth-child(1)${box}`),
        'shift 0.010000 at 1200 ms: no sources',
        at(`(a removed node)${box}`),
      ])
    expect
      .soft(
        shiftsOutside([at(`span[data-narration-controls]${box}`)], NARRATION_BOXES),
        'a near-miss hook is outside',
      )
      .toHaveLength(1)
  })

  // H7 self-test (design §20.3.4 M5; pre-build findings TP-2, TP-5): the test drives the inert
  // window itself (set, read the box, click, remove), so no wall clock decides whether the click
  // fell inside it. The probe markup uses the selectors the watch reads.
  test('T11-M5 the hold watch', async ({ page }) => {
    await installHoldWatch(page)
    await serveProbe(page)
    await page.goto(PROBE_PATH)
    await page.evaluate(() => {
      document.body.innerHTML = [
        '<div data-run=""><div data-part="">',
        '<ul data-choices="" style="list-style: none; margin: 0; padding: 0">',
        '<li><button type="button" data-choice="p1" style="inline-size: 240px; block-size: 64px">Probe</button></li>',
        '</ul>',
        '<div data-ending-actions=""><button type="button" data-try-another="">Try</button></div>',
        '<div data-wrap=""><footer data-part-controls="">',
        '<button type="button" data-back="">Back</button>',
        '<div data-narration=""><button type="button" data-read-to-me="">Read</button>',
        '<a data-ai-voice="" href="#ai">AI</a>',
        '<button type="button" data-narration-control="" data-kind="pause">Pause</button></div>',
        '</footer></div></div></div>',
      ].join('')
      const clicks: number[] = []
      ;(window as unknown as Record<string, unknown>)['__e2eProbeClicks'] = clicks
      document
        .querySelector('button[data-choice]')
        ?.addEventListener('click', () => clicks.push(performance.now()))
    })
    const setInert = (selector: string, on: boolean): Promise<number> =>
      page.evaluate(
        ({ selector, on }) => {
          const t = performance.now()
          const element = document.querySelector(selector)
          if (element === null) throw new Error(`no ${selector}`)
          if (on) element.setAttribute('inert', '')
          else element.removeAttribute('inert')
          return t
        },
        { selector, on },
      )
    const probeClicks = (): Promise<number[]> =>
      page.evaluate(() => [
        ...((window as unknown as Record<string, unknown>)['__e2eProbeClicks'] as number[]),
      ])
    const button = 'button[data-choice]'
    const list = HOLD_NODES.choices

    // (g1)-(g3): the list held, a mouse click at the button's centre, the list live, the same click.
    const centre = await centreInViewport(page, button)
    const set = await setInert(list, true)
    await page.mouse.click(centre.x, centre.y)
    const removed = await setInert(list, false)
    await page.mouse.click(centre.x, centre.y)
    let watch = await holdWatch(page)
    const onset = holdOnset(watch, 'choices', set)
    const release = onset === null ? null : holdRelease(watch, 'choices', onset)
    const downs = watch.inputs.filter((input) => input.type === 'pointerdown' && input.t >= set)
    const inside = downs[0]
    const after = downs.find((input) => input.t >= removed)
    expect(
      inside !== undefined && inside.t < removed,
      'precondition: the first pointerdown fell between setting and removing inert',
    ).toBe(true)
    expect
      .soft(
        {
          onset: onset !== null && onset >= set && onset <= removed,
          release: release !== null && release >= removed,
        },
        '(g1) the watch recorded the list held after it was set and live after it was removed',
      )
      .toEqual({ onset: true, release: true })
    expect
      .soft(
        {
          held: inside?.held.choices ?? null,
          under: (inside?.under ?? []).filter((name) => name.includes('button[data-choice]')),
          target: inside?.target.startsWith('button') ?? null,
        },
        '(g2) a click on the held list: the list held, the button under the point marked (inert), the target not the button',
      )
      .toEqual({
        held: true,
        under: ['run area button[data-choice] "Probe" (inert)'],
        target: false,
      })
    expect
      .soft(
        {
          held: after?.held.choices ?? null,
          target: after?.target ?? null,
          clicks: (await probeClicks()).length,
        },
        '(g3) the same click after the release: the list live, the target the button, one click on it',
      )
      .toEqual({ held: false, target: 'button[data-choice]', clicks: 1 })

    // (g4) each field reads its own node: the five own inert states, and the narration buttons'
    // inert self or ancestor (TP-5).
    const all = Object.values(HOLD_NODES)
    for (const selector of all) await setInert(selector, true)
    const allHeld = await sampleAt(page, await pageNow(page), 0)
    for (const selector of all) await setInert(selector, false)
    await setInert('[data-part] [data-wrap]', true)
    const wrapHeld = await sampleAt(page, await pageNow(page), 0)
    await setInert('[data-part] [data-wrap]', false)
    await page.locator('[data-part] [data-read-to-me]').focus()
    await markHoldFocus(page, '[data-part] [data-read-to-me]')
    const live = await sampleAt(page, await pageNow(page), 0)
    expect
      .soft(
        { held: allHeld.held, narration: allHeld.narrationInert },
        '(g4) all five held: each own inert true, and the narration buttons inside an inert footer',
      )
      .toEqual({
        held: { choices: true, back: true, actions: true, aiVoice: true, footer: true },
        narration: true,
      })
    expect
      .soft(
        { held: wrapHeld.held, narration: wrapHeld.narrationInert },
        '(g4) an inert ancestor only: no own inert, the narration buttons inert by the ancestor',
      )
      .toEqual({
        held: { choices: false, back: false, actions: false, aiVoice: false, footer: false },
        narration: true,
      })
    expect
      .soft(
        {
          narration: live.narrationInert,
          active: live.active,
          marked: live.activeMarked,
          inHeld: live.activeInHeld,
        },
        '(g4) nothing held: the narration buttons live, focus on the marked Read to me',
      )
      .toEqual({ narration: false, active: 'button[data-read-to-me]', marked: true, inHeld: false })

    // (g5) P22, asked on every engine: locator.click() on a held button waits for the release and
    // then clicks the button (Playwright's hit-target check), so an existing tap() right after a
    // narration tap acts late, never on what lies behind.
    const clicksBefore = (await probeClicks()).length
    const heldAgain = await setInert(list, true)
    const waiting = page.locator(button).click()
    await waitAfter(page, heldAgain, 300)
    const freed = await setInert(list, false)
    await waiting
    watch = await holdWatch(page)
    const trusted = watch.inputs.filter(
      (input) => input.type === 'click' && input.isTrusted && input.t >= heldAgain,
    )
    expect
      .soft(
        {
          firstAfterRelease: trusted[0] === undefined ? null : trusted[0].t >= freed,
          target: trusted[0]?.target ?? null,
          clicks: (await probeClicks()).length - clicksBefore,
        },
        '(g5) locator.click() on a held button waits and clicks it after the release (P22)',
      )
      .toEqual({ firstAfterRelease: true, target: 'button[data-choice]', clicks: 1 })
  })
})

// ---------------------------------------------------------------------------------------------
// The run-area hold after a narration tap (design §20.2, §20.3.1, §20.3.4; N27, REQ:273)

const SHARE = `${CARD_ACTIONS} button[data-share]`
const CARD_ALL_STORIES = `${CARD_ACTIONS} a[data-all-stories]`
const SHARE_STATUS = '[data-part] [data-share-status]'
const SHARE_URL = '[data-part] input[data-share-url]'
/** The release comes at least this long after the onset (timers never fire early; T-b10). */
const RELEASE_MIN_MS = SETTLE_MS - 20
/** An in-hold tap is late once it is this long after the narration tap's click; a tap is not made
 * at all when the in-hold read already sees this much of it gone (the attempt is repeated). */
const NO_TAP_AFTER_MS = 300
/** Attempts per test when a tap came late (the T-b10 rule: each from a fresh open). */
const ATTEMPTS = 3
/** The computed look a held node must keep (gL; no stylesheet names inert). */
const LOOK = [
  'opacity',
  'visibility',
  'filter',
  'color',
  'background-color',
  'border-top-color',
  'outline-style',
  'text-decoration-line',
] as const

/** Where the part is and whether the page is still the player (g1, gR). */
interface RunState {
  readonly node: string | null
  readonly seq: string | null
  readonly epoch: string | null
  readonly dialog: boolean
  readonly path: string
  readonly hash: string
  readonly player: boolean
  readonly lang: string | null
}

async function runState(page: Page): Promise<RunState> {
  return page.evaluate(() => {
    const part = document.querySelector('[data-part]')
    const run = document.querySelector('[data-run]')
    return {
      node: part?.getAttribute('data-node') ?? null,
      seq: part?.getAttribute('data-seq') ?? null,
      epoch: run?.getAttribute('data-epoch') ?? null,
      dialog: document.querySelector('dialog[data-restart-confirm]')?.hasAttribute('open') ?? false,
      path: location.pathname,
      hash: location.hash,
      player: document.querySelector('[data-player]') !== null,
      lang: document.querySelector('[data-part] [data-story]')?.getAttribute('lang') ?? null,
    }
  })
}

/** The run state without the language (a switch changes only that). */
const placeOf = (state: RunState) => ({
  node: state.node,
  seq: state.seq,
  epoch: state.epoch,
  dialog: state.dialog,
  path: state.path,
  hash: state.hash,
  player: state.player,
})

/** Before a narration tap: the held nodes on screen and the footer live, no input for 600 ms. */
async function holdQuiet(page: Page): Promise<void> {
  await waitOpen(page)
  for (const node of Object.keys(HOLD_NODES) as HoldNode[]) {
    const locator = page.locator(HOLD_NODES[node])
    if ((await locator.count()) > 0) {
      await expect(
        locator,
        `precondition: ${node} live before the narration tap`,
      ).not.toHaveAttribute('inert')
    }
  }
  const inputs = (await narrationRecord(page)).inputs
  const last = inputs[inputs.length - 1]
  if (last !== undefined) await waitAfter(page, last.t, AFTER_HOLD_MS)
}

/** One trusted click's stamps, read in the page with no other round trip. */
interface ClickAt {
  readonly id: number
  readonly t: number
}

/**
 * The in-hold read (S11-HOLD-C1): one animation frame after the narration key press (so Chromium's
 * scroll anchoring has run), the target's centre from its box (getBoundingClientRect works on an
 * inert node), the narration tap's trusted click, the time, the look of the target and of its held
 * node, and scrollY.
 */
async function readInHold(
  page: Page,
  selector: string,
  held: string,
  clicksBefore: number,
): Promise<{
  click: ClickAt | null
  t: number
  x: number
  y: number
  look: string[]
  scrollY: number
  /** What the narration tap set, read in the hold before any other tap. */
  applied: { pressed: string | null; kind: string | null; status: string | null }
}> {
  return page.evaluate(
    async ({ selector, held, clicksBefore, props, group }) => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
      const state = (window as unknown as Record<string, unknown>)['__e2eNarration'] as {
        clicks: { id: number; isTrusted: boolean; open: number }[]
      }
      const click = state.clicks.find((stamp) => stamp.id > clicksBefore && stamp.isTrusted)
      const element = document.querySelector(selector)
      const holder = document.querySelector(held)
      if (element === null || holder === null) throw new Error(`no ${selector} or ${held}`)
      const box = element.getBoundingClientRect()
      const look = (node: Element, who: string): string[] => {
        const style = getComputedStyle(node)
        return props.map((name) => `${who} ${name}: ${style.getPropertyValue(name)}`)
      }
      return {
        click: click === undefined ? null : { id: click.id, t: click.open },
        t: performance.now(),
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        look: [...look(element, 'target'), ...look(holder, 'held node')],
        scrollY: window.scrollY,
        applied: {
          pressed:
            document.querySelector(`${group} [data-read-to-me]`)?.getAttribute('aria-pressed') ??
            null,
          kind:
            document
              .querySelector(`${group} [data-narration-control]`)
              ?.getAttribute('data-kind') ?? null,
          status: document.querySelector(group)?.getAttribute('data-status') ?? null,
        },
      }
    },
    { selector, held, clicksBefore, props: [...LOOK], group: GROUP },
  )
}

/** The look of the target and its held node now (gL, before the narration tap). */
async function lookOf(page: Page, selector: string, held: string): Promise<string[]> {
  return page.evaluate(
    ({ selector, held, props }) => {
      const element = document.querySelector(selector)
      const holder = document.querySelector(held)
      if (element === null || holder === null) throw new Error(`no ${selector} or ${held}`)
      const look = (node: Element, who: string): string[] => {
        const style = getComputedStyle(node)
        return props.map((name) => `${who} ${name}: ${style.getPropertyValue(name)}`)
      }
      return [...look(element, 'target'), ...look(holder, 'held node')]
    },
    { selector, held, props: [...LOOK] },
  )
}

/** Focuses `selector` without scrolling (so measured centres stay put), then presses `key`. */
async function keyOnUnscrolled(page: Page, selector: string, key: string): Promise<number> {
  const before = (await narrationRecord(page)).clicks.length
  await page.evaluate((wanted) => {
    const element = document.querySelector<HTMLElement>(wanted)
    if (element === null) throw new Error(`no ${wanted}`)
    element.focus({ preventScroll: true })
  }, selector)
  await page.keyboard.press(key)
  return before
}

/** The watch's release of `node` after `onset`, polled on the page clock up to 5 s (or null). */
async function releaseOf(page: Page, node: HoldNode, onset: number): Promise<number | null> {
  const from = await pageNow(page)
  for (;;) {
    const release = holdRelease(await holdWatch(page), node, onset)
    if (release !== null) return release
    if ((await pageNow(page)) - from > 5_000) return null
    await waitAfter(page, await pageNow(page), 50)
  }
}

/** Polls `read` until it equals `wanted` (up to 5 s), then asserts it softly (gR). */
async function softPoll(
  read: () => Promise<unknown>,
  wanted: unknown,
  message: string,
): Promise<void> {
  try {
    await expect.poll(read, { timeout: 5_000 }).toEqual(wanted)
  } catch {
    // The soft assertion below records the failure with its message.
  }
  expect.soft(await read(), message).toEqual(wanted)
}

/**
 * Share with no share sheet and a clipboard that copies (HL1 row 4) or refuses, so the manual field
 * shows, focused (HL2c); every call recorded.
 */
async function stubClipboard(page: Page, answer: 'copy' | 'refuse' = 'copy'): Promise<void> {
  await page.addInitScript((refuse) => {
    const calls = { writeText: [] as string[] }
    ;(window as unknown as Record<string, unknown>)['__e2eClipboard'] = calls
    for (const name of ['share', 'canShare']) {
      Object.defineProperty(Navigator.prototype, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: undefined,
      })
    }
    const clipboard = {
      writeText(text: unknown): Promise<void> {
        calls.writeText.push(String(text))
        return refuse
          ? Promise.reject(new DOMException('e2e', 'NotAllowedError'))
          : Promise.resolve()
      },
    }
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      enumerable: true,
      get: () => clipboard,
    })
  }, answer === 'refuse')
}

async function clipboardWrites(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        (window as unknown as Record<string, unknown>)['__e2eClipboard'] as
          { writeText: string[] } | undefined
      )?.writeText.length ?? -1,
  )
}

interface HoldRow {
  readonly n: number
  readonly target: string
  readonly tap: 'Read to me' | 'Pause' | 'the Tap to listen retry'
  readonly path: readonly string[]
  readonly selector: string
  readonly node: HoldNode
  readonly dispatched: boolean
  readonly after: 'step' | 'back' | 'restart' | 'share' | 'home' | 'grown-ups'
}

const HOLD_ROWS: readonly HoldRow[] = [
  {
    n: 1,
    target: 'a choice',
    tap: 'Read to me',
    path: [],
    selector: choice('c1', 'start'),
    node: 'choices',
    dispatched: true,
    after: 'step',
  },
  {
    n: 2,
    target: 'Back',
    tap: 'Read to me',
    path: ['c1'],
    selector: BACK,
    node: 'back',
    dispatched: true,
    after: 'back',
  },
  {
    n: 3,
    target: 'Try another path',
    tap: 'Read to me',
    path: ['c2', 'c1'],
    selector: TRY_ANOTHER,
    node: 'actions',
    dispatched: true,
    after: 'restart',
  },
  {
    n: 4,
    target: 'Share',
    tap: 'Read to me',
    path: ['c2', 'c1'],
    selector: SHARE,
    node: 'actions',
    dispatched: false,
    after: 'share',
  },
  {
    n: 5,
    target: 'All stories on the ending card',
    tap: 'Read to me',
    path: ['c2', 'c1'],
    selector: CARD_ALL_STORIES,
    node: 'actions',
    dispatched: false,
    after: 'home',
  },
  {
    n: 6,
    target: 'the AI voice link',
    tap: 'Read to me',
    path: [],
    selector: AI_VOICE,
    node: 'aiVoice',
    dispatched: false,
    after: 'grown-ups',
  },
  {
    n: 7,
    target: 'a choice',
    tap: 'Pause',
    path: [],
    selector: choice('c1', 'start'),
    node: 'choices',
    dispatched: true,
    after: 'step',
  },
  {
    n: 8,
    target: 'the AI voice link',
    tap: 'the Tap to listen retry',
    path: [],
    selector: AI_VOICE,
    node: 'aiVoice',
    dispatched: false,
    after: 'grown-ups',
  },
]

/** HL3 (the 19.1 variants): the phones, /en, /hi and /hi wide, at 100, 125 and 150%. */
const HL3_VARIANTS = (['en', 'hi', 'hi wide'] as const).flatMap((name) =>
  ([100, 125, 150] as const).map((scale) => ({
    code: (name === 'en' ? 'en' : 'hi') as LocaleCode,
    wide: name === 'hi wide',
    scale,
    name: name === 'hi wide' ? '/hi wide fallback' : `/${name}`,
  })),
)

/**
 * HL2c (review S11-R3-FS-2, S11-HOLD-A11Y-1; R26, 13.8 P21): focus on a node the hold makes inert,
 * then a pointer tap on Read to me. The field row is the app's own focus: after a refused copy the
 * Share control focuses its manual field (share-control.tsx), inside the held actions.
 */
interface FocusRow {
  readonly target: string
  readonly path: readonly string[]
  readonly selector: string
  readonly node: HoldNode
  readonly how: 'focus()' | 'a refused copy'
}

const FOCUS_ROWS: readonly FocusRow[] = [
  {
    target: 'the last choice',
    path: [],
    selector: choice('c2', 'start'),
    node: 'choices',
    how: 'focus()',
  },
  { target: 'Back', path: ['c1'], selector: BACK, node: 'back', how: 'focus()' },
  { target: 'the AI voice link', path: [], selector: AI_VOICE, node: 'aiVoice', how: 'focus()' },
  {
    target: 'Try another path',
    path: ['c2', 'c1'],
    selector: TRY_ANOTHER,
    node: 'actions',
    how: 'focus()',
  },
  {
    target: 'the manual Share field',
    path: ['c2', 'c1'],
    selector: SHARE_URL,
    node: 'actions',
    how: 'a refused copy',
  },
]

/** A run-area control a second tap may land on: a held one (N27) or a narration button (N17). */
const HELD_UNDER =
  /^run area (?:button\[data-choice\]|button\[data-back\]|button\[data-try-another\]|button\[data-share\]|a\[data-all-stories\]|input\[data-share-url\]|a\[data-ai-voice\])/
const NARRATION_UNDER = /^run area button\[data-(?:read-to-me|narration-control)\]/

test.describe('narration in the player, Step 11: the run-area hold', { tag: '@staging' }, () => {
  for (const row of HOLD_ROWS) {
    test(`T11-HL1 /en: ${row.target} refuses a tap during the hold after ${row.tap}, and takes it after`, async ({
      page,
      fake,
      errors,
    }) => {
      void fake
      await installHoldWatch(page)
      test.setTimeout(60_000)
      if (row.after === 'share') await stubClipboard(page)
      const heldSelector = HOLD_NODES[row.node]
      const tries: string[] = []
      let done: {
        base: RunState
        before: string[]
        inHold: Awaited<ReturnType<typeof readInHold>>
        click: ClickAt
        mouseState: RunState
        dispatched: { t: number; inert: boolean | null; found: boolean } | null
        dispatchedState: RunState | null
        writesAfterMouse: number
      } | null = null
      for (let attempt = 1; attempt <= ATTEMPTS && done === null; attempt++) {
        await openNarrated(page, 'en')
        await expectFakeInstalled(page, errors)
        await walkNarrated(page, row.path)
        let narrationSelector = READ
        if (row.tap === 'Pause') {
          await onAndPlaying(page)
          narrationSelector = PLAYBACK
        } else if (row.tap === 'the Tap to listen retry') {
          const on = await tap(page, READ)
          await expectMadeOne(page)
          await fakeControl(page, 'rejectPlay', { name: 'NotSupportedError' })
          await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'unavailable')
          const unavailable = label('en', 'player.narrationUnavailable')
          await expect
            .poll(async () => (await liveTextsSince(page, on.t)).map((stamp) => stamp.text), {
              message: 'precondition: the unavailable message announced before the retry',
            })
            .toContain(unavailable)
          narrationSelector = PLAYBACK
        }
        await holdQuiet(page)
        await centreInViewport(page, row.selector)
        await page.mouse.move(0, 0)
        const base = await runState(page)
        const before = await lookOf(page, row.selector, heldSelector)
        const clicksBefore = await keyOnUnscrolled(page, narrationSelector, 'Enter')
        const inHold = await readInHold(page, row.selector, heldSelector, clicksBefore)
        const click = inHold.click
        if (click === null) throw new Error(`no trusted click for Enter on ${narrationSelector}`)
        if (inHold.t - click.t > NO_TAP_AFTER_MS) {
          tries.push(
            `attempt ${attempt}: the in-hold read came ${(inHold.t - click.t).toFixed(0)} ms after the narration tap; no tap made`,
          )
          continue
        }
        await page.mouse.click(inHold.x, inHold.y)
        const mouseState = await runState(page)
        const writesAfterMouse = row.after === 'share' ? await clipboardWrites(page) : 0
        let dispatched: { t: number; inert: boolean | null; found: boolean } | null = null
        let dispatchedState: RunState | null = null
        if (row.dispatched) {
          dispatched = await page.evaluate(
            ({ selector, held }) => {
              const t = performance.now()
              const inert = document.querySelector(held)?.hasAttribute('inert') ?? null
              const element = document.querySelector<HTMLElement>(selector)
              element?.click()
              return { t, inert, found: element !== null }
            },
            { selector: row.selector, held: heldSelector },
          )
          dispatchedState = await runState(page)
        }
        const watch = await holdWatch(page)
        const down = inputAfter(watch, 'pointerdown', click.t)
        const gaps = [
          down === undefined ? Number.POSITIVE_INFINITY : down.t - click.t,
          dispatched === null ? 0 : dispatched.t - click.t,
        ]
        tries.push(
          `attempt ${attempt}: in-hold pointerdown +${gaps[0]?.toFixed(0)} ms, dispatched click +${gaps[1]?.toFixed(0)} ms after the narration tap's click`,
        )
        // A tap that left the page took its pointerdown stamp with the document: that is no late
        // tap but g1's failure (and a WebKit page that opens the player again in one context
        // stalls, 13.8 P20), so it is never repeated.
        const left = down === undefined && (await runState(page)).path !== base.path
        if (!left && gaps.some((gap) => gap >= LATE_TAP_MS)) continue
        done = {
          base,
          before,
          inHold,
          click,
          mouseState,
          dispatched,
          dispatchedState,
          writesAfterMouse,
        }
      }
      test.info().annotations.push({ type: 'T11-HL1 attempts', description: tries.join('\n') })
      if (done === null) {
        throw new Error(
          `precondition: an in-hold tap less than ${LATE_TAP_MS} ms after the narration tap in ${ATTEMPTS} attempts (a loaded runner): ${tries.join('; ')}`,
        )
      }
      const { base, before, inHold, click, mouseState, dispatched, dispatchedState } = done
      // Precondition: the narration tap applied (read in the hold, before any other tap).
      const applied = inHold.applied
      if (row.tap === 'Read to me') {
        expect(applied.pressed, 'precondition: Enter on Read to me turned it on').toBe('true')
      } else if (row.tap === 'Pause') {
        expect(applied.kind, 'precondition: Enter on Pause paused (Resume)').toBe('resume')
      } else {
        expect(applied.status, 'precondition: the Tap to listen retry loads').toBe('loading')
      }

      let watch = await holdWatch(page)
      const onset = holdOnset(watch, row.node, click.t)
      const release = onset === null ? null : await releaseOf(page, row.node, onset)
      watch = await holdWatch(page)
      const down = inputAfter(watch, 'pointerdown', click.t)
      const at = `scrollY ${inHold.scrollY.toFixed(0)} in the hold; tap at (${inHold.x.toFixed(1)}, ${inHold.y.toFixed(1)}); under it: ${(down?.under ?? []).join(' | ') || 'nothing'}; target ${down?.target ?? 'none'}`

      // (g0) the hold was on at the in-hold tap.
      expect
        .soft(
          {
            held: down?.held[row.node] ?? null,
            footer: down?.held.footer ?? null,
            narration: down?.narrationInert ?? null,
          },
          `(g0) the hold was on at the in-hold tap: ${row.node} inert, the footer and the narration buttons not (${at})`,
        )
        .toEqual({ held: true, footer: false, narration: false })

      // (g1) the in-hold mouse tap did nothing.
      expect
        .soft(
          placeOf(mouseState),
          `(g1) the in-hold mouse tap changed no part and opened nothing (${at})`,
        )
        .toEqual(placeOf(base))
      const record = await narrationRecord(page)
      const until = dispatched === null ? (release ?? Number.POSITIVE_INFINITY) : dispatched.t
      expect
        .soft(
          callNames(
            mediaCalls(
              record.log.filter(
                (entry) => entry.t > click.t && entry.clickId !== click.id && entry.t < until,
              ),
            ),
          ),
          '(g1) no audio call after the narration tap’s own',
        )
        .toEqual([])
      const live = (await liveTextsSince(page, click.t)).filter((stamp) => stamp.t < until)
      expect
        .soft(
          live.map((stamp) => stamp.text),
          '(g1) the live region said nothing from the narration tap to the release',
        )
        .toEqual([])
      const after = await runState(page)
      expect
        .soft(
          { path: after.path, hash: after.hash, player: after.player },
          '(g1) no link opened by the release',
        )
        .toEqual({ path: base.path, hash: base.hash, player: true })
      if (row.after === 'share') {
        expect
          .soft(
            {
              writes: done.writesAfterMouse,
              status: await page.locator(SHARE_STATUS).count(),
              field: await page.locator(SHARE_URL).count(),
            },
            '(g1) Share: no copy, no status, no field',
          )
          .toEqual({ writes: 0, status: 0, field: 0 })
      }

      // (g2) the dispatched click inside the hold did nothing: the actions.ts layer.
      if (dispatched !== null && dispatchedState !== null && !dispatched.found) {
        // Only when the mouse tap already acted (g1 is red then) may the target be gone.
        expect(
          placeOf(mouseState),
          'precondition: the dispatched click found its target (it may be gone only after a step)',
        ).not.toEqual(placeOf(base))
        test.info().annotations.push({
          type: 'T11-HL1 g2',
          description: 'the in-hold mouse tap already changed the part: g2 could not run',
        })
      } else if (dispatched !== null && dispatchedState !== null) {
        expect
          .soft(
            placeOf(dispatchedState),
            `(g2) a script click inside the hold is refused (inert ${String(dispatched.inert)})`,
          )
          .toEqual(placeOf(mouseState))
      }

      // (gL) the look during the hold is the look before it.
      expect
        .soft(inHold.look, '(gL) the target and its held node look the same during the hold')
        .toEqual(before)

      // (gR) the release, and the same tap after it acts.
      expect.soft(onset, `(gR) the hold began after the narration tap (${row.node})`).not.toBeNull()
      expect
        .soft(
          release === null || onset === null ? null : release - onset >= RELEASE_MIN_MS,
          `(gR) ${row.node} released at least ${RELEASE_MIN_MS} ms after it was held (onset ${onset?.toFixed(0)}, release ${release?.toFixed(0) ?? 'never'})`,
        )
        .toBe(true)
      if (release === null) return
      if (JSON.stringify(placeOf(await runState(page))) !== JSON.stringify(placeOf(base))) {
        // A tap in the hold already acted (g1 or g2 is red): the target is gone or moved.
        test.info().annotations.push({
          type: 'T11-HL1 gR',
          description: 'not run: a tap in the hold already changed the part or the page',
        })
        return
      }
      await waitAfter(page, release, 100)
      const now = await page.evaluate((selector) => {
        const element = document.querySelector(selector)
        if (element === null) return null
        const box = element.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      }, row.selector)
      expect(now, 'precondition: the target is still on the page after the release').not.toBeNull()
      expect(
        Math.max(Math.abs((now?.x ?? 0) - inHold.x), Math.abs((now?.y ?? 0) - inHold.y)),
        `precondition: the target's centre unchanged from the in-hold read to the release tap (${JSON.stringify(now)} vs ${inHold.x.toFixed(1)}, ${inHold.y.toFixed(1)})`,
      ).toBeLessThanOrEqual(0.5)
      const seq = Number(base.seq)
      await page.mouse.click(now?.x ?? 0, now?.y ?? 0)
      if (row.after === 'step') {
        await expect
          .soft(page.locator(PART), '(gR) after the release the choice steps')
          .toHaveAttribute('data-seq', String(seq + 1))
        await expect
          .soft(page.locator(PART), '(gR) to flat_stones')
          .toHaveAttribute('data-node', 'flat_stones')
      } else if (row.after === 'back') {
        await expect
          .soft(page.locator(PART), '(gR) after the release Back goes back')
          .toHaveAttribute('data-node', 'start')
      } else if (row.after === 'restart') {
        await expect
          .soft(page.locator(RUN), '(gR) after the release Try another path restarts')
          .toHaveAttribute('data-epoch', String(Number(base.epoch) + 1))
        await expect
          .soft(page.locator(PART), '(gR) at the start')
          .toHaveAttribute('data-node', 'start')
      } else if (row.after === 'share') {
        await softPoll(() => clipboardWrites(page), 1, '(gR) after the release Share copies once')
        await expect.soft(page.locator(SHARE_STATUS), '(gR) and says so').toBeVisible()
      } else {
        const wanted =
          row.after === 'home'
            ? { path: '/en', hash: '' }
            : { path: '/en/grown-ups', hash: '#how-stories-are-made' }
        await softPoll(
          () => page.evaluate(() => ({ path: location.pathname, hash: location.hash })),
          wanted,
          `(gR) after the release the link opens ${wanted.path}${wanted.hash}`,
        )
      }
    })
  }

  test('T11-HL2 /hi: Enter and Space on Read to me and Enter on Pause keep focus through the hold; the narration buttons are never inert', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    await installHoldWatch(page)
    await openNarrated(page, 'hi')
    await expectFakeInstalled(page, errors)
    const held = (snapshot: HoldSnapshot) => ({
      choices: snapshot.held.choices,
      aiVoice: snapshot.held.aiVoice,
    })
    const live = (snapshot: HoldSnapshot) => ({
      narration: snapshot.narrationInert,
      footer: snapshot.held.footer,
    })

    /** A key on the focused `selector`; returns the samples at +100, +300 and after the release. */
    const keyThroughHold = async (selector: string, key: string, what: string) => {
      await holdQuiet(page)
      await page.locator(selector).focus()
      await expect(page.locator(selector), `precondition: ${what} focused`).toBeFocused()
      await markHoldFocus(page, selector)
      const clicksBefore = (await narrationRecord(page)).clicks.length
      await armHoldSamples(page, [100, 300])
      await page.keyboard.press(key)
      const click = await trustedClickAfter(page, clicksBefore, `${key} on ${what}`)
      await expect
        .poll(
          async () =>
            (await holdWatch(page)).samples.filter((sample) => sample.due > click.t).length,
          {
            message: `precondition: the samples of ${what} were taken`,
          },
        )
        .toBe(2)
      let watch = await holdWatch(page)
      const samples = watch.samples.filter((sample) => sample.due > click.t)
      for (const sample of samples) {
        expect(
          sample.t,
          `precondition: the ${sample.label} sample of ${what} at its stamp`,
        ).toBeGreaterThanOrEqual(sample.due)
      }
      const onset = holdOnset(watch, 'choices', click.t)
      const release = onset === null ? null : await releaseOf(page, 'choices', onset)
      const settled = await sampleAt(page, release ?? (await pageNow(page)), 50)
      watch = await holdWatch(page)
      return { click, at100: samples[0], at300: samples[1], settled, release }
    }

    // (g0, g1, g2) Enter on Read to me (on).
    const on = await keyThroughHold(READ, 'Enter', 'Read to me')
    await expect(page.locator(READ), 'precondition: Enter applied (on)').toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect
      .soft(
        on.at100 === undefined ? null : held(on.at100),
        '(g0) the choices and the AI voice link held 100 ms into the hold',
      )
      .toEqual({ choices: true, aiVoice: true })
    for (const [name, sample] of [
      ['100 ms into the hold', on.at100],
      ['300 ms into the hold', on.at300],
      ['after the release', on.settled],
    ] as const) {
      expect
        .soft(sample?.active, `(g1) Enter on Read to me: focus stays on it ${name}`)
        .toBe('button[data-read-to-me]')
      expect
        .soft(sample?.activeMarked, `(g1) Enter on Read to me: the same node ${name}`)
        .toBe(true)
    }
    for (const [name, sample] of [
      ['100 ms', on.at100],
      ['300 ms', on.at300],
    ] as const) {
      expect
        .soft(
          sample === undefined ? null : live(sample),
          `(g2) ${name} into the hold: no narration button or the group inert, the footer live`,
        )
        .toEqual({ narration: false, footer: false })
    }

    // (g3) Enter on Pause.
    await fakeControl(page, 'resolvePlay')
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
    await waitAfter(page, on.click.t, AFTER_HOLD_MS)
    const pause = await keyThroughHold(PLAYBACK, 'Enter', 'Pause')
    await expect
      .soft(page.locator(PLAYBACK), '(g3) Pause applied: Resume')
      .toHaveAttribute('data-kind', 'resume')
    for (const [name, sample] of [
      ['100 ms into the hold', pause.at100],
      ['300 ms into the hold', pause.at300],
      ['after the release', pause.settled],
    ] as const) {
      expect
        .soft(
          sample === undefined
            ? null
            : {
                active: sample.active,
                marked: sample.activeMarked,
                narration: sample.narrationInert,
              },
          `(g3) Enter on Pause: focus stays on the playback button ${name}, never inert`,
        )
        .toEqual({
          active: 'button[data-narration-control][data-kind]',
          marked: true,
          narration: false,
        })
    }

    // (g4) Space on Read to me (off).
    await waitAfter(page, pause.click.t, AFTER_HOLD_MS)
    const off = await keyThroughHold(READ, 'Space', 'Read to me (off)')
    await expect
      .soft(page.locator(READ), '(g4) Space applied: off')
      .toHaveAttribute('aria-pressed', 'false')
    for (const [name, sample] of [
      ['100 ms into the hold', off.at100],
      ['300 ms into the hold', off.at300],
      ['after the release', off.settled],
    ] as const) {
      expect
        .soft(
          sample === undefined ? null : { active: sample.active, marked: sample.activeMarked },
          `(g4) Space on Read to me: focus stays on it ${name}`,
        )
        .toEqual({ active: 'button[data-read-to-me]', marked: true })
    }
  })

  test('T11-HL2 /en: a mouse tap on Read to me: the hold leaves focus where the tap put it', async ({
    page,
    fake,
    errors,
    browserName,
  }) => {
    void fake
    await installHoldWatch(page)
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await holdQuiet(page)
    await page.locator(READ).scrollIntoViewIfNeeded()
    const centre = await centreInViewport(page, READ)
    await page.mouse.move(0, 0)
    const clicksBefore = (await narrationRecord(page)).clicks.length
    await armHoldSamples(page, [100, 300])
    await page.mouse.click(centre.x, centre.y)
    const click = await trustedClickAfter(page, clicksBefore, 'the mouse tap on Read to me')
    await expect(page.locator(READ), 'precondition: the tap applied (on)').toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect
      .poll(
        async () => (await holdWatch(page)).samples.filter((sample) => sample.due > click.t).length,
        {
          message: 'precondition: the samples were taken',
        },
      )
      .toBe(2)
    let watch = await holdWatch(page)
    const onset = holdOnset(watch, 'choices', click.t)
    const release = onset === null ? null : await releaseOf(page, 'choices', onset)
    const settled = await sampleAt(page, release ?? (await pageNow(page)), 50)
    watch = await holdWatch(page)
    const samples = watch.samples.filter((sample) => sample.due > click.t)
    const atClick = watch.inputs.find(
      (input) => input.type === 'click' && input.isTrusted && input.t >= click.t,
    )
    expect(atClick, 'precondition: the watch saw the trusted click').toBeDefined()
    const s100 = samples[0]
    const s300 = samples[1]
    expect
      .soft(
        s100 === undefined ? null : { choices: s100.held.choices, aiVoice: s100.held.aiVoice },
        '(g0) the choices and the AI voice link held 100 ms into the hold',
      )
      .toEqual({ choices: true, aiVoice: true })
    const where = atClick?.active ?? 'none'
    const named = `the tap put focus on ${where} (${browserName}; P21: Chromium the button, WebKit main on Windows)`
    expect
      .soft(
        [s100, s300, settled].map((sample) =>
          sample === undefined ? null : { active: sample.active, inHeld: sample.activeInHeld },
        ),
        `(g1) focus stays where the tap put it, at +100, +300 ms and after the release, never in a held node: ${named}`,
      )
      .toEqual([0, 1, 2].map(() => ({ active: where, inHeld: false })))
    if (where !== 'button[data-read-to-me]') {
      test.info().annotations.push({
        type: 'T11-HL2 g1',
        description: `${named}: g1 cannot see a footer made inert (MW-69) here; g2 does`,
      })
    }
    expect
      .soft(
        [s100, s300].map((sample) =>
          sample === undefined
            ? null
            : { narration: sample.narrationInert, footer: sample.held.footer },
        ),
        '(g2) +100 and +300 ms into the hold: no narration button or the group inert, the footer live (TP-8)',
      )
      .toEqual([0, 1].map(() => ({ narration: false, footer: false })))
  })

  // HL2c (review S11-R3-FS-2, S11-HOLD-A11Y-1): R26's claim that a pointer tap never leaves focus in
  // a held node, asked with focus already on one. A mouse tap, then a touch tap (every project
  // emulates a touchscreen), each on Read to me; where the tap put focus is named, not expected per
  // engine (WINDOWS IS NOT CI; 13.8 P21).
  for (const row of FOCUS_ROWS) {
    test(`T11-HL2c /en: focus on ${row.target}, then a mouse tap and a touch tap on Read to me: focus is never left in a held node`, async ({
      page,
      fake,
      errors,
      browserName,
    }) => {
      void fake
      test.setTimeout(60_000)
      await installHoldWatch(page)
      if (row.how === 'a refused copy') await stubClipboard(page, 'refuse')
      await openNarrated(page, 'en')
      await expectFakeInstalled(page, errors)
      await walkNarrated(page, row.path)
      const passes: {
        pointer: 'mouse' | 'touch'
        atClick: HoldSnapshot | undefined
        at100: HoldSnapshot | undefined
        at300: HoldSnapshot | undefined
        settled: HoldSnapshot
      }[] = []
      for (const pointer of ['mouse', 'touch'] as const) {
        await holdQuiet(page)
        if (row.how === 'a refused copy' && pointer === 'mouse') {
          await tap(page, SHARE)
          await expect(
            page.locator(row.selector),
            'precondition: the copy was refused',
          ).toBeVisible()
          await holdQuiet(page)
        } else {
          await page.locator(row.selector).focus()
        }
        await expect(
          page.locator(row.selector),
          `precondition: ${row.target} focused by ${row.how} before the ${pointer} tap`,
        ).toBeFocused()
        await markHoldFocus(page, row.selector)
        const centre = await centreInViewport(page, READ)
        await expect(page.locator(row.selector), 'precondition: measuring kept focus').toBeFocused()
        const pressed = await page.locator(READ).getAttribute('aria-pressed')
        const clicksBefore = (await narrationRecord(page)).clicks.length
        await armHoldSamples(page, [100, 300])
        if (pointer === 'mouse') await page.mouse.click(centre.x, centre.y)
        else await page.touchscreen.tap(centre.x, centre.y)
        const click = await trustedClickAfter(
          page,
          clicksBefore,
          `the ${pointer} tap on Read to me`,
        )
        await expect(
          page.locator(READ),
          `precondition: the ${pointer} tap applied (aria-pressed was ${String(pressed)})`,
        ).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true')
        await expect
          .poll(
            async () =>
              (await holdWatch(page)).samples.filter((sample) => sample.due > click.t).length,
            { message: `precondition: the samples of the ${pointer} tap were taken` },
          )
          .toBe(2)
        let watch = await holdWatch(page)
        const onset = holdOnset(watch, row.node, click.t)
        const release = onset === null ? null : await releaseOf(page, row.node, onset)
        const settled = await sampleAt(page, release ?? (await pageNow(page)), 50)
        watch = await holdWatch(page)
        const samples = watch.samples.filter((sample) => sample.due > click.t)
        passes.push({
          pointer,
          atClick: watch.inputs.find(
            (input) => input.type === 'click' && input.isTrusted && input.t >= click.t,
          ),
          at100: samples[0],
          at300: samples[1],
          settled,
        })
        // Read to me on: the clip's play() resolves, so the touch pass turns off a playing clip.
        if (
          pointer === 'mouse' &&
          (await page.locator(GROUP).getAttribute('data-status')) === 'loading'
        ) {
          await fakeControl(page, 'resolvePlay')
          await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
        }
      }
      for (const pass of passes) {
        const named = `${pass.pointer} tap (${browserName}): focus at the click ${pass.atClick?.active ?? 'none'}, +100 ms ${pass.at100?.active ?? 'none'}, +300 ms ${pass.at300?.active ?? 'none'}, after the release ${pass.settled.active}`
        expect
          .soft(
            pass.at100?.held[row.node] ?? null,
            `(g0) ${pass.pointer} tap: ${row.node} held 100 ms into the hold`,
          )
          .toBe(true)
        expect
          .soft(
            [pass.atClick, pass.at100, pass.at300, pass.settled].map((sample) =>
              sample === undefined
                ? null
                : { body: sample.active === 'body', inHeld: sample.activeInHeld },
            ),
            `(g1) focus left ${row.target} before the hold and was never dropped to the body: ${named}`,
          )
          .toEqual([0, 1, 2, 3].map(() => ({ body: false, inHeld: false })))
      }
      test.info().annotations.push({
        type: 'T11-HL2c focus (13.8 P21)',
        description: passes
          .map(
            (pass) =>
              `${pass.pointer} (${browserName}): at the click ${pass.atClick?.active ?? 'none'}; after the release ${pass.settled.active}`,
          )
          .join('\n'),
      })
    })
  }

  for (const variant of HL3_VARIANTS) {
    test(`T11-HL3 ${variant.name} ${variant.scale}%: a double tap on Read to me at the bottom of a long page changes no part and opens no link`, async ({
      page,
      fake,
      errors,
    }) => {
      void fake
      const project = test.info().project.name
      test.skip(
        !ROW_PHONES.includes(project),
        'the phone layouts of 19.1 (P6): HL3 runs on the phones',
      )
      test.setTimeout(120_000)
      await installHoldWatch(page)
      const aborted = await prepareVariant(
        page,
        { code: variant.code, scale: 100, wide: variant.wide },
        errors,
      )
      await seedPrefs(page, narrationPrefsText({ textScale: variant.scale, readToMe: false }))
      interface Case {
        readonly where: string
        readonly dir: 'off' | 'on'
        readonly before: RunState
        readonly now: RunState
        readonly settled: RunState
        readonly gap: number
        readonly move: number
        readonly scroll: string
        readonly under: readonly string[]
        readonly held: { run: boolean | null; aiVoice: boolean | null }
        readonly pressed: string | null
        readonly calls: string[]
        readonly onset: number | null
        readonly release: number | null
      }
      const tries: string[] = []
      let cases: Case[] | null = null
      for (let attempt = 1; attempt <= ATTEMPTS && cases === null; attempt++) {
        await openPlayer(page, urlOf(variant.code))
        if (variant.wide) await expectWideFallback(page, aborted())
        await expectFakeInstalled(page, errors)
        await walkNarrated(page, ['c2'])
        await tap(page, READ)
        await fakeControl(page, 'resolvePlay')
        await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
        const found: Case[] = []
        let late = false
        // A second tap that stepped the story or opened a link ends the cases (the groups show it).
        let stopped = false
        for (const where of ['round_stones', 'ending_wet'] as const) {
          if (stopped) break
          if (where === 'ending_wet') {
            await walkNarrated(page, ['c1'], { resolve: true })
          }
          await expect(page.locator(PART), 'precondition: the node').toHaveAttribute(
            'data-node',
            where,
          )
          for (const dir of ['off', 'on'] as const) {
            await holdQuiet(page)
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
            await frames(page)
            const before = await runState(page)
            const read = await page.evaluate((selector) => {
              const element = document.querySelector(selector)
              if (element === null) throw new Error(`no ${selector}`)
              const box = element.getBoundingClientRect()
              return {
                x: box.left + box.width / 2,
                y: box.top + box.height / 2,
                scrollY: window.scrollY,
              }
            }, READ)
            const from = await pageNow(page)
            await page.mouse.click(read.x, read.y)
            await page.evaluate(
              (since) =>
                new Promise<void>((resolve) => {
                  const watch = (window as unknown as Record<string, unknown>)[
                    '__e2eHoldWatch'
                  ] as {
                    inputs: { type: string; t: number }[]
                  }
                  const first = watch.inputs.find(
                    (input) => input.type === 'pointerdown' && input.t >= since,
                  )
                  const at = first === undefined ? performance.now() : first.t
                  setTimeout(resolve, Math.max(0, at + 100 - performance.now()))
                }),
              from,
            )
            await page.mouse.click(read.x, read.y)
            const now = await runState(page)
            const moved = await page.evaluate((selector) => {
              const element = document.querySelector(selector)
              const box = element?.getBoundingClientRect()
              return {
                y: box === undefined ? Number.NaN : box.top + box.height / 2,
                scrollY: window.scrollY,
              }
            }, READ)
            let watch = await holdWatch(page)
            const downs = watch.inputs.filter(
              (input) => input.type === 'pointerdown' && input.t >= from,
            )
            const first = downs[0]
            const second = downs[1]
            const gap =
              first === undefined || second === undefined
                ? Number.POSITIVE_INFINITY
                : second.t - first.t
            if (!(gap > 0 && gap < LATE_TAP_MS)) {
              tries.push(
                `attempt ${attempt}: ${where} ${dir}: the second pointerdown ${gap.toFixed(0)} ms after the first`,
              )
              late = true
              break
            }
            const runNode: HoldNode = where === 'round_stones' ? 'choices' : 'actions'
            const onset = first === undefined ? null : holdOnset(watch, runNode, first.t)
            const release = onset === null ? null : await releaseOf(page, runNode, onset)
            watch = await holdWatch(page)
            const settled = await runState(page)
            const record = await narrationRecord(page)
            found.push({
              where,
              dir,
              before,
              now,
              settled,
              gap,
              move: moved.y - read.y,
              scroll: `${read.scrollY.toFixed(0)}>${moved.scrollY.toFixed(0)}`,
              under: second?.under ?? [],
              held: { run: second?.held[runNode] ?? null, aiVoice: second?.held.aiVoice ?? null },
              pressed: await page.evaluate(
                (selector) =>
                  document.querySelector(selector)?.getAttribute('aria-pressed') ?? null,
                READ,
              ),
              calls: callNames(
                mediaCalls(record.log.filter((entry) => first !== undefined && entry.t >= first.t)),
              ),
              onset,
              release,
            })
            const last = found[found.length - 1]
            // Read to me as the first tap set it, and an on tap's play still pending (a second
            // tap that toggled it back or paused it, MW-41, ends the cases like a step does).
            const narrationAsSet =
              last === undefined ||
              (last.pressed === (dir === 'off' ? 'false' : 'true') &&
                (dir === 'off' ||
                  (await page.evaluate(
                    (group) => document.querySelector(group)?.getAttribute('data-status') ?? null,
                    GROUP,
                  )) === 'loading'))
            if (
              last !== undefined &&
              (!narrationAsSet ||
                JSON.stringify(placeOf(last.settled)) !== JSON.stringify(placeOf(last.before)))
            ) {
              stopped = true
              tries.push(
                `attempt ${attempt}: ${where} ${dir}: the double tap moved the run or page, or changed what the first tap set; later cases not run`,
              )
              break
            }
            if (dir === 'on' && where === 'round_stones') await fakeControl(page, 'resolvePlay')
          }
          if (late) break
        }
        if (!late) cases = found
      }
      if (tries.length > 0)
        test.info().annotations.push({ type: 'T11-HL3 attempts', description: tries.join('\n') })
      if (cases === null) {
        throw new Error(
          `precondition: each second tap less than ${LATE_TAP_MS} ms after the first in ${ATTEMPTS} attempts (a loaded runner): ${tries.join('; ')}`,
        )
      }
      const describeCase = (c: Case): string =>
        `${c.where}, ${c.dir} double tap (under the old centre: ${c.under.join(' | ') || 'nothing'}; gap ${c.gap.toFixed(0)} ms; Read to me moved ${c.move.toFixed(0)} px; scrollY ${c.scroll}; onset ${c.onset?.toFixed(0) ?? 'none'}, release ${c.release?.toFixed(0) ?? 'none'})`
      test.info().annotations.push({
        type: 'T11-HL3 landings',
        description: cases.map(describeCase).join('\n'),
      })
      // Non-vacuous (TP-3): at least one second tap lands on a run-area control, held (N27) or a
      // narration button (N17); else the layout of this runner proves nothing here.
      const landed = cases.filter((c) =>
        c.under.some((name) => HELD_UNDER.test(name) || NARRATION_UNDER.test(name)),
      )
      test.skip(
        landed.length === 0,
        `no second tap of the 4 landed on a run-area control on this runner: ${cases.map(describeCase).join('; ')}`,
      )
      for (const c of cases) {
        const name = describeCase(c)
        expect
          .soft(c.held, `(g0) ${name}: the hold was on at the second tap`)
          .toEqual({ run: true, aiVoice: true })
        expect
          .soft(
            { node: c.now.node, seq: c.now.seq, epoch: c.now.epoch },
            `(g1) ${name}: no part change`,
          )
          .toEqual({ node: c.before.node, seq: c.before.seq, epoch: c.before.epoch })
        expect
          .soft(
            { node: c.settled.node, seq: c.settled.seq, epoch: c.settled.epoch },
            `(g1) ${name}: no part change after the release`,
          )
          .toEqual({ node: c.before.node, seq: c.before.seq, epoch: c.before.epoch })
        expect
          .soft(
            { path: c.settled.path, hash: c.settled.hash, player: c.settled.player },
            `(g2) ${name}: no link opened`,
          )
          .toEqual({ path: c.before.path, hash: c.before.hash, player: true })
        if (c.dir === 'off') {
          expect
            .soft(
              { pressed: c.pressed, calls: c.calls },
              `(g3) ${name}: off, stopped once, never played`,
            )
            .toEqual({ pressed: 'false', calls: ['pause', 'removeAttribute', 'load'] })
        } else {
          expect
            .soft(
              {
                pressed: c.pressed,
                src: c.calls.filter((call) => call === 'setAttribute src').length,
                play: c.calls.filter((call) => call === 'play').length,
                pause: c.calls.filter((call) => call === 'pause').length,
              },
              `(g4) ${name}: on, played once, never paused`,
            )
            .toEqual({ pressed: 'true', src: 1, play: 1, pause: 0 })
        }
      }
      const heldLandings = cases.filter((c) => c.under.some((name) => HELD_UNDER.test(name)))
      test.info().annotations.push({
        type: 'T11-HL3 held landings (TP-3)',
        description: `${heldLandings.length} of 4 second taps landed on a held control (Windows P6 figure: 25 of 36 phone cases)`,
      })
    })
  }

  test('T11-HL4 /en: the header is not held: Menu, the story-language switch and Start again work during the hold', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    test.setTimeout(90_000)
    await installHoldWatch(page)
    const tries: string[] = []
    /** A narration key, then at once a mouse tap on `header` read in the hold; null when late. */
    const headerTapInHold = async (
      narration: string,
      key: string,
      header: string,
      attempt: number,
      what: string,
    ) => {
      await holdQuiet(page)
      const clicksBefore = await keyOnUnscrolled(page, narration, key)
      const inHold = await readInHold(page, header, header, clicksBefore)
      const click = inHold.click
      if (click === null) throw new Error(`no trusted click for ${key} on ${narration}`)
      if (inHold.t - click.t > NO_TAP_AFTER_MS) {
        tries.push(
          `attempt ${attempt}: ${what}: the in-hold read came ${(inHold.t - click.t).toFixed(0)} ms after the narration tap`,
        )
        return null
      }
      const before = (await narrationRecord(page)).clicks.length
      await page.mouse.click(inHold.x, inHold.y)
      const headerClick = await trustedClickAfter(page, before, what)
      const watch = await holdWatch(page)
      const down = inputAfter(watch, 'pointerdown', click.t)
      const gap = down === undefined ? Number.POSITIVE_INFINITY : down.t - click.t
      tries.push(
        `attempt ${attempt}: ${what}: pointerdown +${gap.toFixed(0)} ms, choices inert ${String(down?.held.choices)}`,
      )
      if (gap >= LATE_TAP_MS || down?.held.choices !== true) return null
      return { click, headerClick, down }
    }
    let result: {
      menu: boolean
      lang: string | null
      switchPlay: { src: string | null; play: boolean }
      switchHold: { onset: number | null; release: number | null; onsets: number }
      restart: RunState
      before: RunState
    } | null = null
    for (let attempt = 1; attempt <= ATTEMPTS && result === null; attempt++) {
      await openNarrated(page, 'en')
      await expectFakeInstalled(page, errors)
      const before = await runState(page)
      // (g1) Menu during the hold after Enter on Read to me (on).
      const g1 = await headerTapInHold(READ, 'Enter', MENU, attempt, 'Menu')
      if (g1 === null) continue
      const menu = (await page.locator(MENU).getAttribute('aria-expanded')) === 'true'
      // (g2) the switch during the hold after Enter on Pause.
      let watch = await holdWatch(page)
      const firstOnset = holdOnset(watch, 'choices', g1.click.t)
      if (firstOnset !== null) await releaseOf(page, 'choices', firstOnset)
      await fakeControl(page, 'resolvePlay')
      await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
      await waitAfter(page, g1.click.t, AFTER_HOLD_MS)
      const g2 = await headerTapInHold(
        PLAYBACK,
        'Enter',
        SWITCH,
        attempt,
        'the story-language switch',
      )
      if (g2 === null) continue
      await expect(page.locator('[data-part] [data-story]'))
        .toHaveAttribute('lang', 'hi')
        .catch(() => undefined)
      const lang = (await runState(page)).lang
      const log = (await narrationRecord(page)).log.filter(
        (entry) => entry.clickId === g2.headerClick.id,
      )
      const set = log.find((entry) => entry.call === 'setAttribute' && entry.name === 'src')
      watch = await holdWatch(page)
      const onset = holdOnset(watch, 'choices', g2.click.t)
      const release = onset === null ? null : await releaseOf(page, 'choices', onset)
      watch = await holdWatch(page)
      const onsets = watch.nodes.filter(
        (stamp) =>
          stamp.node === 'choices' &&
          stamp.inert === true &&
          stamp.t >= g2.click.t &&
          (release === null || stamp.t <= release),
      ).length
      // (g3) the menu's Start again during the hold after Enter on Read to me (off).
      if ((await page.locator(MENU).getAttribute('aria-expanded')) !== 'true')
        await page.locator(MENU).click()
      await expect(
        page.locator(MENU),
        'precondition: the menu open at the narration tap',
      ).toHaveAttribute('aria-expanded', 'true')
      await waitAfter(page, g2.click.t, AFTER_HOLD_MS)
      const g3 = await headerTapInHold(
        READ,
        'Enter',
        MENU_RESTART,
        attempt,
        "the menu's Start again",
      )
      if (g3 === null) continue
      result = {
        menu,
        lang,
        switchPlay: { src: set?.value ?? null, play: log.some((entry) => entry.call === 'play') },
        switchHold: { onset, release, onsets },
        restart: await runState(page),
        before,
      }
    }
    test.info().annotations.push({ type: 'T11-HL4 attempts', description: tries.join('\n') })
    if (result === null) {
      throw new Error(
        `precondition: each header tap less than ${LATE_TAP_MS} ms after its narration tap, with the choices held, in ${ATTEMPTS} attempts: ${tries.join('; ')}`,
      )
    }
    expect.soft(result.menu, '(g1) the menu opened during the hold').toBe(true)
    expect.soft(result.lang, '(g2) the switch worked during the hold').toBe('hi')
    expect
      .soft(
        result.switchPlay,
        '(g2) inside the switch tap the start clip in hi plays (onSwitch; Read to me on)',
      )
      .toEqual({ src: clipUrl('start', 'hi'), play: true })
    expect
      .soft(
        {
          onsets: result.switchHold.onsets,
          long:
            result.switchHold.onset === null || result.switchHold.release === null
              ? null
              : result.switchHold.release - result.switchHold.onset >= RELEASE_MIN_MS,
        },
        `(g2) the switch did not end the hold: one onset, released at least ${RELEASE_MIN_MS} ms after it (TP-4; ${JSON.stringify(result.switchHold)})`,
      )
      .toEqual({ onsets: 1, long: true })
    expect
      .soft(
        { epoch: result.restart.epoch, node: result.restart.node },
        '(g3) Start again restarted at once during the hold',
      )
      .toEqual({ epoch: String(Number(result.before.epoch) + 1), node: 'start' })
    let live = true
    try {
      await expect(page.locator(CHOICES)).not.toHaveAttribute('inert', { timeout: 5_000 })
    } catch {
      live = false
    }
    expect
      .soft(
        live,
        '(g3) after the restart’s settle the new part takes a choice: its choices live within 5 s',
      )
      .toBe(true)
    if (!live) return
    const c1 = await centreInViewport(page, choice('c1', 'start'))
    await page.mouse.click(c1.x, c1.y)
    await expect
      .soft(page.locator(PART), '(g3) a mouse tap on c1 steps to flat_stones')
      .toHaveAttribute('data-node', 'flat_stones')
  })
})

// ---------------------------------------------------------------------------------------------
// The owner screens 30-35 (13.4.8; CRIT-4, E10): FAKE mode, Chromium, full page, SCREENS=1 only

test.describe('the Step 11 owner screens: narration', { tag: '@staging' }, () => {
  test.skip(process.env['SCREENS'] !== '1', 'owner screenshots: run with SCREENS=1')
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'the owner set is the 3 Chromium viewports',
  )

  const shoot = async (page: Page, nn: string, name: string, scale: 100 | 150): Promise<void> => {
    await settleForScreenshot(page)
    await page.screenshot({
      path: step10ScreenPath(nn, name, test.info().project.name, scale),
      fullPage: true,
    })
  }
  const only = (project: string): void => {
    test.skip(test.info().project.name !== project, `screen for ${project}`)
  }

  test('screen 30: /en at the start, Read to me on, playing (phone)', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    only('chromium-phone')
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await onAndPlaying(page)
    await expect(page.locator(PLAYBACK)).toHaveAttribute('data-kind', 'pause')
    await shoot(page, '30', 'narration-playing-en', 100)
  })

  for (const [nn, code] of [
    ['31', 'hi'],
    ['32', 'en'],
  ] as const) {
    test(`screen ${nn}: /${code} at 150% at ending_wet after a choice with Read to me on, playing (phone)`, async ({
      page,
      fake,
      errors,
    }) => {
      void fake
      only('chromium-phone')
      await openNarrated(page, code, { textScale: 150 })
      await expectFakeInstalled(page, errors)
      await onAndPlaying(page)
      await walkNarrated(page, ['c2', 'c1'], { resolve: true })
      await expect(page.locator(PART)).toHaveAttribute('data-node', 'ending_wet')
      await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'playing')
      const first = await page.locator(PLAYBACK).evaluate((button) => {
        const box = button.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, innerHeight }
      })
      const description = `Pause ${first.top.toFixed(0)} to ${first.bottom.toFixed(0)} of the first screen's ${first.innerHeight} px: ${first.top < first.innerHeight ? 'on' : 'below'} the first screen`
      test.info().annotations.push({ type: `screen ${nn}`, description })
      console.log(`[player-audio] screen ${nn} (${test.info().project.name}): ${description}`)
      await shoot(page, nn, `narration-ending-150-${code}`, 150)
    })
  }

  test('screen 33: /hi unavailable (tablet)', async ({ page, fake, errors }) => {
    void fake
    only('chromium-tablet')
    await openNarrated(page, 'hi')
    await expectFakeInstalled(page, errors)
    await tap(page, READ)
    await fakeControl(page, 'rejectPlay', { name: 'NotSupportedError' })
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'unavailable')
    await expect(page.locator(PLAYBACK)).toHaveAttribute('data-kind', 'tap-to-listen')
    await shoot(page, '33', 'narration-unavailable-hi', 100)
  })

  test('screen 34: /en blocked with the pulse, reduced motion (tablet landscape)', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    only('chromium-tablet-landscape')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openNarrated(page, 'en')
    await expectFakeInstalled(page, errors)
    await tap(page, READ)
    await fakeControl(page, 'rejectPlay', { name: 'NotAllowedError' })
    await expect(page.locator(GROUP)).toHaveAttribute('data-status', 'blocked')
    await expect(page.locator(PLAYBACK)).toHaveAttribute('data-pulse')
    await shoot(page, '34', 'narration-blocked-en', 100)
  })

  test('screen 35: /hi page 1, Read to me off, the byline before any tap (phone)', async ({
    page,
    fake,
    errors,
  }) => {
    void fake
    only('chromium-phone')
    await openNarrated(page, 'hi')
    await expectFakeInstalled(page, errors)
    await expect(page.locator(READ)).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator(AI_VOICE)).toBeVisible()
    await expect(page.locator(PLAYBACK)).toHaveCount(0)
    await shoot(page, '35', 'narration-off-hi', 100)
  })
})
