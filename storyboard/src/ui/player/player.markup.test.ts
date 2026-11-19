// Player server markup (Step 10a; design p1-step10-design.md §4.1, §4.6, §9.2 markup row, D11-P2,
// P5, P9, P17, P30). react-dom/server renders the island with createElement (Vitest runs .ts files
// only), so these check exactly what the server HTML of a player page holds before hydration:
// - the opening snapshot: the start node in the URL locale, data-run-phase="opening", the choices
//   list inert (a tap before hydration does nothing), one main#main and one empty live region;
// - the story as stored: title, paragraphs that join back to the passage, the question, choice
//   labels in package order, each button with the seq it was rendered with; no Back yet (10b);
// - a node without a question, an ending (passage only in 10a), a part a step rendered;
// - the strings: built server-only, "Page n" pre-formatted for every reachable n;
// - the error fallback.
// Fixer pass (review F1, A11Y-2, A11Y-3/PIF-1, PIF-2): one main element in all, not only one
// main#main; choice labels as stored with a leading emoji and literal asterisks (D11-P25); the
// Hindi 0.12em paint offset on the choice and action labels (D11-P26); the saved-run hint rule and
// its 3 s failsafe (D11-P5, §4.4). CSS is read as text (Vitest does not apply it); CSS Module class
// names are Vitest's stable ones, imported here as the components import them.
// Step 10b (design §4.1, D11-P10 to P12, P19, P11): header row 2 with one named progressbar and
// the Menu button (inert while opening), the hidden menu panel (text-size radios with the server
// snapshot's 100 checked, Start again with its seq), the closed restart dialog after main, Back in
// the run footer from page 2 on (an ending included) and never at page 1, the new strings, and the
// CSS the segments, the radios and the panel rely on. Fixer pass (review A11Y-1, A11Y-2, A11Y-3,
// PIF-5): the radio and dialog labels carry the action label class (D11-P26), the segments'
// forced-colours rule, and Start again's seq at a part after the first.
// Step 10c (design §4.1, §4.6, D11-P13, P14, P7): the ending card at every ending of every fixture,
// rendered in the part as the island renders it (after the story container, before the run
// footer): the hidden icon, the alternate label on alternate endings only, h2 "The lesson" naming
// the section, the lesson as stored in the content lang, the count, then Try another path (with
// its seq), Share and All stories (route locale), the actions inert exactly while not interactive;
// the share feedback ("Link copied." or the read-only field), the new strings and the card CSS.
// Second review (A11Y-10c-2, D11-P6 amended at 10c): the card fades in with the reveal's second
// stage, checked as text with a negative test per way it could leave that stage.
// Step 10d (design §4.1, §4.3, §4.6, D11-P4, F3): the story-language switch in the header nav
// before Grown-ups (a button: a visually hidden "Story language:", then the other language's
// endonym in its own lang and dir; inert and run-dependent while opening), none for a story whose
// page has one language; a switched part keeps its key, node and seq while data-story takes the
// new lang; and the lang islands' own size and leading (CSS read as text). The T-b10 fix: the
// menu's Start again is ignored during the hold after a dialog cancel only (startAgainHeld).
// Step 10e (design §4.1, §4.6, D11-P21 to P23, T-e7): the run area's data-scene (sceneIdOf), no band
// and no img for a node without a picture (every fixture), the band between the title and the story
// card for one with a picture (a plain img: srcset of the WebP variants, the one sizes value, the
// smallest WebP as src, width and height, fetchpriority high, alt "", no cross-origin mode, no lazy
// loading), data-failed on a failed picture, the square shape, no preload of the next pictures in
// the server HTML, and the scene and band CSS (read as text).
// P1-4 owner screens (design p1-4-polish-design.md §5): T1 (the framed panel's rule, the player's
// main rule, and two source checks: only the scene forms of .runDependent set a box, only
// .player > main names main), T5 (the actions wrapper holds the row), T6 (ShareControl's render
// prop), T7 (the field's rule) and T10 (the restart dialog's backdrop).
// Step 11 (design p1-step11-design.md §4.4, §4.7, §4.8, §5, N1, N2, N13, N14, N16, N26; T11-14 to
// T11-17): a narrated story's opening markup (the run footer on page 1, inert, holding Read to me
// and the AI voice byline in the route locale), no narration hook on any fixture, the narration
// group for every row of the 4.4 table (order, hooks, the byline, the reserved playback labels),
// the narration CSS read as text (the finite pulse, the forced-colours cue, the byline, the
// reserved box) and the 9 strings.
// Step 11 N27 (design §20.2, §20.3.3; T11-25, T11-26): the run-area hold after a narration tap:
// partHoldOf over 7 literal rows, and the held markup (the choices, Back and the AI voice link
// inert; the footer, the group and both narration buttons not), byte-equal to today when not held.
// The HTML is read with small regular expressions (React writes attributes in JSX prop order).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement, createRef } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { start, step, type StepResult } from '../../core/engine'
import { ENABLED_LOCALE_CODES, getLocaleDef, type LocaleCode } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import {
  HOW_STORIES_ARE_MADE_ID,
  NARRATION_PLAYBACKS,
  narrationDisplayOf,
  type NarrationPart,
  type NarrationPlayback,
  type NarrationSessionSnapshot,
} from '../../reader/player/narration'
import { graphOf, playerDataOf, type PlayerData } from '../../reader/player/player-data'
import { sceneIdOf } from '../../reader/player/scene'
import { segmentsOf } from '../../reader/player/segments'
import { partViewOf, tokenOf } from '../../reader/player/view'
import { readerStores } from '../../reader/progress'
import a11y from '../a11y/a11y.module.css'
import { translator } from '../i18n/messages'
import shell from '../shell/shell.module.css'
import { SCENE_IDS } from '../styles/contrast-pairs'
import { EndingCard, LESSON_HEADING_ID } from './ending-card'
import { NarrationControls } from './narration-controls'
import { partHoldOf, Player, startAgainHeld } from './player'
import { PlayerFallback } from './player-boundary'
import { SceneImage } from './scene-image'
import { PLAYER_MENU_ID, PlayerMenu, TEXT_SIZE_NAME } from './player-menu'
import styles from './player.module.css'
import { ProgressSegments } from './progress-segments'
import { dialogClosed, RESTART_QUESTION_ID, RestartDialog } from './restart-dialog'
import { ShareControl, ShareFeedback, type ShareParts } from './share-control'
import { StoryLanguageSwitch } from './story-language-switch'
import { QUESTION_ID, StoryPart } from './story-part'
import { playerFallbackStringsOf, playerStringsOf } from './strings'

const here = dirname(fileURLToPath(import.meta.url))
const playerCss = (): string => readFileSync(join(here, 'player.module.css'), 'utf8')
const fixtures = [twoPaths, riverStones, lanternWalk].map((p) => StoryPackageV1.parse(p))
const cases = fixtures.flatMap((pkg) =>
  ENABLED_LOCALE_CODES.filter((locale) => pkg.locales.includes(locale)).map(
    (locale) => [pkg.storyId, locale, pkg] as const,
  ),
)

const dataOf = (pkg: StoryPackageV1): PlayerData =>
  playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })

function renderPlayer(data: PlayerData, locale: LocaleCode): string {
  return renderToString(
    createElement(Player, { data, strings: playerStringsOf(locale, data), locale }),
  )
}

/** The text React escaped, back as written. */
const unescapeHtml = (html: string): string =>
  html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

const all = (html: string, pattern: RegExp): RegExpMatchArray[] => [...html.matchAll(pattern)]

/** Every start tag of an element. */
const startTags = (html: string, element: string): string[] =>
  all(html, new RegExp(`<${element}\\b[^>]*>`, 'g')).map((m) => m[0])

/** One main element with id main, whatever the attribute order (design C8). */
const MAIN = /<main\b[^>]*\sid="main"[\s>]/g
/** Any main element: the page has one main landmark, and it is main#main (review F1). */
const ANY_MAIN = /<main[\s>]/g
const EMPTY_STATUS = /<div\b[^>]*\srole="status"[^>]*><\/div>/g

/** The passage's paragraphs, unescaped. */
function paragraphsIn(html: string): string[] {
  const passage = /<div\b[^>]*\sdata-passage=""[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  return all(passage, /<p\b[^>]*>([\s\S]*?)<\/p>/g).map((m) => unescapeHtml(m[1] ?? ''))
}

/** [choice id, seq, label] of every choice button, in DOM order. */
function choicesIn(html: string): [string, string, string][] {
  return all(
    html,
    /<button\b[^>]*\sdata-choice="([^"]*)"[^>]*\sdata-seq="([^"]*)"[^>]*><span\b[^>]*>([\s\S]*?)<\/span><\/button>/g,
  ).map((m) => [m[1] ?? '', m[2] ?? '', unescapeHtml(m[3] ?? '')])
}

/** A path from the start node to `target` (the fixtures are DAGs). */
function pathTo(data: PlayerData, target: string): string[] {
  const queue: string[][] = [[data.startNodeId]]
  while (queue.length > 0) {
    const path = queue.shift() ?? []
    const id = path[path.length - 1]
    if (id === target) return path
    const node = data.nodes.find((n) => n.id === id)
    for (const choice of node?.choices ?? []) queue.push([...path, choice.next])
  }
  throw new Error(`no path to ${target}`)
}

const refuse = (): StepResult => {
  throw new Error('no tap in a server render')
}

describe('the player island: server markup of the opening snapshot', () => {
  it('covers every fixture in every enabled package locale (the scan is not empty)', () => {
    expect(cases.map(([id, locale]) => `${id}/${locale}`)).toEqual([
      'two-paths/en',
      'two-paths/hi',
      'river-stones/en',
      'river-stones/hi',
      'lantern-walk/en',
      'lantern-walk/hi',
    ])
  })

  it.each(cases)(
    '%s/%s: opening, inert choices, one main and one empty live region',
    (_, locale, pkg) => {
      const data = dataOf(pkg)
      const html = renderPlayer(data, locale)
      const player = startTags(html, 'div').filter((tag) => /\sdata-player=""/.test(tag))
      expect(player).toHaveLength(1)
      expect(player[0]).toContain(' data-run-phase="opening"')
      expect(all(html, MAIN)).toHaveLength(1)
      expect(all(html, ANY_MAIN)).toHaveLength(1)
      expect(startTags(html, 'main')[0]).toContain(' tabindex="-1"')
      // The page's one polite live region, present and empty at load (spec §6.6 4.1.3).
      expect(all(html, /\srole="status"/g)).toHaveLength(1)
      expect(all(html, EMPTY_STATUS)).toHaveLength(1)
      // Every run control is inert until open(): a tap before hydration does nothing (D11-P5).
      const lists = startTags(html, 'ul')
      expect(lists).toHaveLength(1)
      expect(lists[0]).toContain(' data-choices=""')
      expect(lists[0]).toContain(' inert=""')
      expect(html).not.toContain('data-back')
      expect(html).not.toContain('data-animate')
      expect(html).not.toContain('data-reveal')
    },
  )

  it.each(cases)('%s/%s: the start node in the URL locale, as stored', (_, locale, pkg) => {
    const data = dataOf(pkg)
    const html = renderPlayer(data, locale)
    const stored = pkg.text[locale]
    const node = stored?.nodes[pkg.startNodeId]
    expect(node).toBeDefined()
    const story = startTags(html, 'div').filter((tag) => /\sdata-story=""/.test(tag))
    expect(story).toHaveLength(1)
    expect(story[0]).toContain(` lang="${locale}"`)
    expect(story[0]).toContain(' dir="ltr"')
    expect(startTags(html, 'div').filter((tag) => /\sdata-part=""/.test(tag))[0]).toMatch(
      new RegExp(`\\sdata-node="${pkg.startNodeId}"\\sdata-seq="0"`),
    )
    expect(startTags(html, 'div').filter((tag) => /\sdata-run=""/.test(tag))[0]).toContain(
      ' data-epoch="0"',
    )
    const h1 = all(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/g)
    expect(h1).toHaveLength(1)
    expect(unescapeHtml(h1[0]?.[1] ?? '')).toBe(stored?.title)
    expect(paragraphsIn(html).join('\n\n')).toBe(node?.text)
    // The first paragraph is the focus target after a step (D11-P8).
    expect(/<div\b[^>]*\sdata-passage=""[^>]*><p\b[^>]*\stabindex="-1"/.test(html)).toBe(true)
    const question = new RegExp(`<p id="${QUESTION_ID}" data-question=""[^>]*>([\\s\\S]*?)</p>`)
    expect(unescapeHtml(question.exec(html)?.[1] ?? '')).toBe(node?.question)
    expect(startTags(html, 'ul')[0]).toContain(` aria-labelledby="${QUESTION_ID}"`)
    const start = pkg.nodes.find((n) => n.id === pkg.startNodeId)
    const ids = start?.type === 'ending' ? [] : (start?.choices.map((c) => c.id) ?? [])
    expect(ids.length).toBeGreaterThan(0)
    expect(choicesIn(html)).toEqual(ids.map((id) => [id, '0', node?.choices?.[id]]))
  })

  it.each(cases)(
    '%s/%s: the header holds All stories and the nav with Grown-ups',
    (_, locale, pkg) => {
      const html = renderPlayer(dataOf(pkg), locale)
      const t = translator(locale)
      const header = /<header\b[^>]*>([\s\S]*?)<\/header>/.exec(html)?.[1] ?? ''
      const links = all(header, /<a\b([^>]*)>([\s\S]*?)<\/a>/g)
      expect(links).toHaveLength(2)
      expect(links[0]?.[1]).toContain(` href="/${locale}"`)
      expect(links[0]?.[1]).toContain(' data-exit=""')
      expect(unescapeHtml((links[0]?.[2] ?? '').replace(/<[^>]+>/g, ''))).toBe(
        t('player.allStories'),
      )
      expect(header).toMatch(new RegExp(`<nav aria-label="${t('header.navLabel')}"`))
      expect(links[1]?.[1]).toContain(` href="/${locale}/grown-ups"`)
      expect(unescapeHtml((links[1]?.[2] ?? '').replace(/<[^>]+>/g, ''))).toBe(t('header.grownUps'))
      // The header comes before main; the live region is the last thing in main.
      expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main'))
      expect(html).toMatch(/<div\b[^>]*\srole="status"[^>]*><\/div><\/main>/)
    },
  )

  it('keeps every paragraph, single newline and edge space as stored (D11-P30)', () => {
    const [pkg] = fixtures
    if (pkg === undefined) throw new Error('no fixture')
    const text = ' One line,\nthe next line. \n\nA second paragraph.\n\n  A third,  indented.'
    const changed = structuredClone(pkg)
    const node = changed.text.en?.nodes[changed.startNodeId]
    if (node === undefined) throw new Error('no start text')
    node.text = text
    const paragraphs = paragraphsIn(renderPlayer(dataOf(changed), 'en'))
    expect(paragraphs).toEqual([
      ' One line,\nthe next line. ',
      'A second paragraph.',
      '  A third,  indented.',
    ])
    expect(paragraphs.join('\n\n')).toBe(text)
    // Rendered with white-space: pre-wrap, so the newline and the spaces show as stored.
    const css = readFileSync(join(here, 'player.module.css'), 'utf8')
    expect(/\n\.paragraph \{[^}]*\swhite-space: pre-wrap;/.test(css)).toBe(true)
  })

  it('shows choice labels exactly as stored: a leading emoji, literal asterisks (D11-P25)', () => {
    const [pkg] = fixtures
    if (pkg === undefined) throw new Error('no fixture')
    const labels = {
      en: { c1: '🐒 Climb the *tall* tree', c2: '☀️ Wait for the sun' },
      hi: { c1: '🐢 धीरे-धीरे *चलो*', c2: '👨‍👩‍👧 सब साथ में रुको' },
    } as const
    const changed = structuredClone(pkg)
    for (const locale of ['en', 'hi'] as const) {
      const node = changed.text[locale]?.nodes[changed.startNodeId]
      if (node === undefined) throw new Error(`no ${locale} start text`)
      node.choices = { ...labels[locale] }
    }
    for (const locale of ['en', 'hi'] as const) {
      const html = renderPlayer(dataOf(changed), locale)
      expect(choicesIn(html)).toEqual([
        ['c1', '0', labels[locale].c1],
        ['c2', '0', labels[locale].c2],
      ])
    }
  })

  it('a node without a question has no question and no aria-labelledby', () => {
    const [pkg] = fixtures
    if (pkg === undefined) throw new Error('no fixture')
    const changed = structuredClone(pkg)
    const node = changed.text.en?.nodes[changed.startNodeId]
    if (node === undefined) throw new Error('no start text')
    delete node.question
    const html = renderPlayer(dataOf(changed), 'en')
    expect(html).not.toContain('data-question')
    expect(html).not.toContain(QUESTION_ID)
    expect(startTags(html, 'ul')[0]).not.toContain('aria-labelledby')
    expect(choicesIn(html).length).toBeGreaterThan(0)
  })
})

describe('one part: endings and steps', () => {
  const parts = fixtures.flatMap((pkg) => {
    const data = dataOf(pkg)
    return data.endingIds.flatMap((ending) =>
      data.locales.map((locale) => [pkg.storyId, ending, locale, pkg, data] as const),
    )
  })

  it('covers every ending of every fixture (the scan is not empty)', () => {
    expect(parts).toHaveLength(14)
  })

  it.each(parts)(
    '%s %s/%s: an ending shows its passage (no question, no choices) and Back (10b)',
    (_, ending, locale, pkg, data) => {
      const state = start(graphOf(data), { path: pathTo(data, ending), locale })
      expect(state.status).toBe('ended')
      const html = renderToString(
        createElement(StoryPart, {
          view: partViewOf(data, state),
          interactive: true,
          animate: false,
          revealDone: false,
          firstParagraphRef: createRef<HTMLParagraphElement>(),
          onChoose: refuse,
          backLabel: 'Back',
          onBack: refuse,
        }),
      )
      expect(html).toContain(` data-node="${ending}"`)
      expect(paragraphsIn(html).join('\n\n')).toBe(pkg.text[locale]?.nodes[ending]?.text)
      expect(html).not.toContain('<ul')
      expect(html).not.toContain('data-question')
      // BACK from an ending is allowed (the engine's BACK), so its footer shows Back (D11-P10).
      expect(startTags(html, 'button')).toHaveLength(1)
      expect(startTags(html, 'button')[0]).toContain(' data-back=""')
    },
  )

  it.each(cases)(
    '%s/%s: Back in the run footer from page 2 on, never at page 1 (D11-P10)',
    (_, locale, pkg) => {
      const data = dataOf(pkg)
      const graph = graphOf(data)
      const back = translator(locale)('player.back')
      const render = (path: string[], interactive: boolean): string =>
        renderToString(
          createElement(StoryPart, {
            view: partViewOf(data, start(graph, { path, locale })),
            interactive,
            animate: false,
            revealDone: false,
            firstParagraphRef: createRef<HTMLParagraphElement>(),
            onChoose: refuse,
            backLabel: back,
            onBack: refuse,
          }),
        )
      // Page 1: no footer, no Back (the engine refuses BACK there; Exit is in the header).
      const first = render([data.startNodeId], true)
      expect(first).not.toContain('data-back')
      expect(first).not.toContain('data-part-controls')
      expect(first).not.toContain('<footer')
      // Every other node of the story, by its first path: one footer, one Back with the part's seq.
      const others = data.nodes.filter((n) => n.id !== data.startNodeId)
      expect(others.length).toBeGreaterThan(2)
      for (const node of others) {
        const path = pathTo(data, node.id)
        // The seq the part was rendered with (a resumed state starts at 0).
        const seq = String(start(graph, { path, locale }).seq)
        for (const interactive of [true, false]) {
          const html = render(path, interactive)
          const footers = startTags(html, 'footer')
          expect(footers, node.id).toHaveLength(1)
          expect(footers[0]).toContain(' data-part-controls=""')
          // Inert exactly while the run opens or this part settles, like the choices.
          expect(footers[0]?.includes(' inert=""'), `${node.id} inert`).toBe(!interactive)
          const buttons = all(html, /<button\b([^>]*)>([\s\S]*?)<\/button>/g).filter((m) =>
            (m[1] ?? '').includes(' data-back=""'),
          )
          expect(buttons, node.id).toHaveLength(1)
          expect(buttons[0]?.[1]).toMatch(
            new RegExp(`^ type="button" data-back="" data-seq="${seq}"`),
          )
          expect(unescapeHtml((buttons[0]?.[2] ?? '').replace(/<[^>]+>/g, ''))).toBe(back)
          expect(buttons[0]?.[2]).toContain(`<span class="${styles.actionLabel}">`)
          // The footer is the part's last child, outside the story container: the page's language.
          expect(html).toMatch(/<\/div><\/div><footer\b[^>]*>[\s\S]*<\/footer><\/div>$/)
          expect(footers[0]).not.toContain(' lang=')
        }
      }
    },
  )

  it('a part a step rendered: data-animate, then data-reveal="done"; inert while settling', () => {
    const data = dataOf(StoryPackageV1.parse(riverStones))
    const state = start(graphOf(data), { path: ['start', 'flat_stones'], locale: 'en' })
    const render = (interactive: boolean, animate: boolean, revealDone: boolean): string =>
      renderToString(
        createElement(StoryPart, {
          view: { ...partViewOf(data, state), seq: 1, token: '0:1' },
          interactive,
          animate,
          revealDone,
          firstParagraphRef: createRef<HTMLParagraphElement>(),
          onChoose: refuse,
          backLabel: 'Back',
          onBack: refuse,
        }),
      )
    const settling = render(false, true, false)
    expect(startTags(settling, 'div')[0]).toMatch(/\sdata-seq="1"\sdata-animate=""/)
    expect(startTags(settling, 'ul')[0]).toContain(' inert=""')
    // Back settles with the choices (D11-P7: every control inside the run area) and carries the
    // seq this part was rendered with.
    expect(startTags(settling, 'footer')[0]).toContain(' inert=""')
    expect(startTags(settling, 'button').filter((tag) => tag.includes(' data-back=""'))).toEqual([
      `<button type="button" data-back="" data-seq="1" class="${styles.action}">`,
    ])
    expect(startTags(render(true, true, true), 'footer')[0]).not.toContain('inert')
    expect(choicesIn(settling).every(([, seq]) => seq === '1')).toBe(true)
    expect(startTags(render(true, true, true), 'div')[0]).toContain(' data-reveal="done"')
    expect(startTags(render(true, true, true), 'ul')[0]).not.toContain('inert')
  })
})

/** The text of an element's inner HTML, tags removed and unescaped. */
const textOf = (inner: string | undefined): string =>
  unescapeHtml((inner ?? '').replace(/<[^>]+>/g, ''))

/** One attribute's value from a start tag's attribute text, or null. */
const attrOf = (attributes: string | undefined, name: string): string | null =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(attributes ?? '')?.[1] ?? null

describe('Step 10b: header row 2, the menu and the restart dialog (server markup)', () => {
  const headerOf = (html: string): string =>
    /<header\b[^>]*>([\s\S]*?)<\/header>/.exec(html)?.[1] ?? ''

  it.each(cases)(
    '%s/%s: one named progressbar, then the Menu button (inert while opening), after row 1',
    (_, locale, pkg) => {
      const data = dataOf(pkg)
      const t = translator(locale)
      const html = renderPlayer(data, locale)
      const header = headerOf(html)
      const total = data.progressSteps.length
      // One progressbar on the page, in the header (D11-P12); start is the first step: 1 filled.
      expect(all(html, /\srole="progressbar"/g)).toHaveLength(1)
      const bars = startTags(header, 'div').filter((tag) => /\srole="progressbar"/.test(tag))
      expect(bars).toEqual([
        `<div role="progressbar" data-segments="" aria-label="${t('player.progress')}"` +
          ` aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="1"` +
          ` aria-valuetext="${t('player.progressValue', { filled: 1, total })}"` +
          ` class="${styles.segments} ${styles.runDependent}">`,
      ])
      const spans = all(header, /<span\b([^>]*)><\/span>/g)
        .map((m) => m[1] ?? '')
        .filter((attributes) => attributes.includes(` class="${styles.segment}"`))
      expect(spans).toHaveLength(total)
      expect(spans.every((attributes) => attributes.includes(' aria-hidden="true"'))).toBe(true)
      expect(spans.map((attributes) => attributes.includes(' data-filled=""'))).toEqual(
        Array.from({ length: total }, (_n, i) => i === 0),
      )
      // The Menu button: a disclosure for the panel, inert until open() (D11-P5, P19).
      const menus = all(header, /<button\b([^>]*)>([\s\S]*?)<\/button>/g).filter((m) =>
        (m[1] ?? '').includes(' data-menu=""'),
      )
      expect(menus).toHaveLength(1)
      expect(menus[0]?.[1]).toBe(
        ` type="button" data-menu="" aria-expanded="false" aria-controls="${PLAYER_MENU_ID}"` +
          ` inert="" class="${styles.action}"`,
      )
      expect(textOf(menus[0]?.[2])).toBe(t('player.menu'))
      expect(menus[0]?.[2]).toBe(`<span class="${styles.actionLabel}">${t('player.menu')}</span>`)
      // Row 2 (progressbar, then Menu, in one row) comes after row 1 (the nav).
      const row = new RegExp(
        `</nav><div class="${styles.headerRow}"><div role="progressbar"[\\s\\S]*?</div><button\\b[^>]*\\sdata-menu=""`,
      )
      expect(header).toMatch(row)
    },
  )

  it.each(cases)(
    '%s/%s: the menu panel is hidden: text-size radios (100 checked) and Start again with its seq',
    (_, locale, pkg) => {
      const data = dataOf(pkg)
      const t = translator(locale)
      const html = renderPlayer(data, locale)
      const header = headerOf(html)
      expect(all(html, new RegExp(`\\sid="${PLAYER_MENU_ID}"`, 'g'))).toHaveLength(1)
      const panel = new RegExp(
        `<div id="${PLAYER_MENU_ID}" hidden="" class="${styles.menuPanel}">([\\s\\S]*)</div>$`,
      ).exec(header)
      expect(panel, 'the panel, hidden, last in the header').not.toBeNull()
      const inside = panel?.[1] ?? ''
      expect(header.indexOf(`id="${PLAYER_MENU_ID}"`)).toBeGreaterThan(header.indexOf('data-menu'))
      // The fieldset: legend "Text size", then 3 native radios, 100 checked (the server snapshot).
      const legend = /<fieldset\b[^>]*><legend\b[^>]*>([\s\S]*?)<\/legend>/.exec(inside)
      expect(textOf(legend?.[1])).toBe(t('player.textSize'))
      // Each label's text carries the action label class: the Hindi 0.12em offset (A11Y-1, D11-P26).
      const radios = all(
        inside,
        new RegExp(
          `<label class="([^"]*)"><input\\b([^>]*)><span class="${styles.actionLabel}">([\\s\\S]*?)</span></label>`,
          'g',
        ),
      )
      expect(
        radios.map((m) => [
          m[1],
          attrOf(m[2], 'type'),
          attrOf(m[2], 'name'),
          attrOf(m[2], 'value'),
          (m[2] ?? '').includes(' checked=""'),
          textOf(m[3]),
        ]),
      ).toEqual(
        [100, 125, 150].map((percent) => [
          styles.option,
          'radio',
          TEXT_SIZE_NAME,
          String(percent),
          percent === 100,
          t('player.textSizeOption', { percent }),
        ]),
      )
      expect(all(inside, /<input\b/g)).toHaveLength(3)
      // Start again: the panel's one button, with the seq it was rendered with.
      const buttons = all(inside, /<button\b([^>]*)>([\s\S]*?)<\/button>/g)
      expect(buttons).toHaveLength(1)
      expect(buttons[0]?.[1]).toBe(
        ` type="button" data-restart="" data-seq="0" class="${styles.action}"`,
      )
      expect(buttons[0]?.[2]).toBe(
        `<span class="${styles.actionLabel}">${t('player.restart')}</span>`,
      )
      expect(inside).not.toContain('<a ')
    },
  )

  it.each(cases)(
    '%s/%s: the restart dialog is closed, a sibling after main: Keep reading first, then Start again',
    (_, locale, pkg) => {
      const data = dataOf(pkg)
      const t = translator(locale)
      const html = renderPlayer(data, locale)
      expect(startTags(html, 'dialog')).toEqual([
        `<dialog data-restart-confirm="" aria-labelledby="${RESTART_QUESTION_ID}" class="${styles.dialog}">`,
      ])
      // After main and last in the player root: never inside the header or the menu panel (F6).
      expect(html).toMatch(/<\/main><dialog\b[^>]*>[\s\S]*<\/dialog><\/div>$/)
      const inside = /<dialog\b[^>]*>([\s\S]*?)<\/dialog>/.exec(html)?.[1] ?? ''
      const question = new RegExp(`^<p id="${RESTART_QUESTION_ID}"[^>]*>([\\s\\S]*?)</p>`).exec(
        inside,
      )
      expect(textOf(question?.[1])).toBe(t('player.restartQuestion'))
      // Both labels carry the action label class: the Hindi 0.12em offset (A11Y-3, D11-P26).
      const buttons = all(inside, /<button\b([^>]*)>([\s\S]*?)<\/button>/g)
      expect(buttons.map((m) => [m[1], m[2]])).toEqual([
        [
          ` type="button" data-keep-reading="" class="${styles.action}"`,
          `<span class="${styles.actionLabel}">${t('player.keepReading')}</span>`,
        ],
        [
          ` type="button" data-restart-accept="" data-seq="0" class="${styles.action}"`,
          `<span class="${styles.actionLabel}">${t('player.restart')}</span>`,
        ],
      ])
    },
  )

  it('Start again, in the menu and in the dialog, carries the seq it was rendered with (D11-P7)', () => {
    // The opening snapshot renders seq 0 only; a later part's seq must reach both buttons (PIF-5).
    const [pkg] = fixtures
    if (pkg === undefined) throw new Error('no fixture')
    const strings = playerStringsOf('en', dataOf(pkg))
    const returnFocus = createRef<HTMLButtonElement>()
    const none = (): void => {}
    const menu = renderToString(
      createElement(PlayerMenu, {
        strings,
        prefs: readerStores().prefs,
        open: true,
        confirmOpen: false,
        opening: false,
        seq: 7,
        leading: null,
        restartRef: returnFocus,
        onToggle: none,
        onClose: none,
        onStartAgain: none,
      }),
    )
    expect(startTags(menu, 'button').filter((tag) => tag.includes(' data-restart=""'))).toEqual([
      `<button type="button" data-restart="" data-seq="7" class="${styles.action}">`,
    ])
    const dialog = renderToString(
      createElement(RestartDialog, {
        strings,
        open: false,
        seq: 7,
        returnFocus,
        onConfirm: () => false,
        onCancelled: none,
        onClosed: none,
      }),
    )
    expect(
      startTags(dialog, 'button').filter((tag) => tag.includes(' data-restart-accept=""')),
    ).toEqual([
      `<button type="button" data-restart-accept="" data-seq="7" class="${styles.action}">`,
    ])
  })

  const nodes = fixtures.flatMap((pkg) => {
    const data = dataOf(pkg)
    return data.nodes.map((node) => [pkg.storyId, node.id, data] as const)
  })

  it.each(nodes)(
    '%s %s: the filled segments start at the first, with no gap; all of them at an ending',
    (_, nodeId, data) => {
      const state = start(graphOf(data), { path: pathTo(data, nodeId), locale: 'en' })
      const { total, reached } = segmentsOf(data, state)
      const html = renderToString(
        createElement(ProgressSegments, { total, reached, label: 'L', valueText: 'V' }),
      )
      expect(startTags(html, 'div')[0]).toContain(
        ` aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${reached}" aria-valuetext="V"`,
      )
      const filled = all(html, /<span\b([^>]*)><\/span>/g).map((m) =>
        (m[1] ?? '').includes(' data-filled=""'),
      )
      expect(filled).toEqual(Array.from({ length: total }, (_n, i) => i < reached))
      if (state.status === 'ended') expect(filled.every(Boolean)).toBe(true)
    },
  )
})

// Second review R2-STRESS-1 (D11-P7 amended at 10b): a close without an accepted Start again holds
// the run area (the island's hold) and focuses the menu's Start again; an accepted one does
// neither. The wiring into the dialog's close event is proven by e2e T-b10.
describe("the restart dialog's close: a cancel holds the run area, an accepted restart does not", () => {
  const calls = (restarted: boolean): string[] => {
    const seen: string[] = []
    dialogClosed(restarted, {
      focusBack: () => seen.push('focusBack'),
      onCancelled: () => seen.push('onCancelled'),
      onClosed: () => seen.push('onClosed'),
    })
    return seen
  }

  it('a cancel (Keep reading, Escape, a refused restart): focus back, onCancelled, then onClosed', () => {
    expect(calls(false)).toEqual(['focusBack', 'onCancelled', 'onClosed'])
  })

  it('an accepted Start again: onClosed only (no hold, no focus back to the menu)', () => {
    expect(calls(true)).toEqual(['onClosed'])
  })
})

// Step 10d T-b10 fix (the lead's decision): during the hold after a restart-dialog cancel the
// menu's Start again is ignored too, so the second tap of a double tap on Keep reading cannot
// reopen the dialog when Start again lies under it; the settle timer that releases the run area
// releases it (settling back to null), and a step's settle never holds it (D11-P7, T-b4). The
// island's wiring is proven by e2e T-b10 over Start again.
describe("the menu's Start again during the hold after a restart-dialog cancel", () => {
  const big = tokenOf({ runEpoch: 0, seq: 2 })
  const next = tokenOf({ runEpoch: 0, seq: 3 })
  const restarted = tokenOf({ runEpoch: 1, seq: 0 })

  it('is ignored while the run area is held for the cancelled part', () => {
    expect(startAgainHeld(big, big)).toBe(true)
  })

  it('works again once the settle timer released the hold (settling null)', () => {
    expect(startAgainHeld(big, null)).toBe(false)
  })

  it("is never held by a step's settle: no cancel, or a cancel of an earlier part or run", () => {
    expect(startAgainHeld(null, next)).toBe(false)
    expect(startAgainHeld(big, next)).toBe(false)
    expect(startAgainHeld(big, restarted)).toBe(false)
  })

  it('is not held with no cancel and no settle', () => {
    expect(startAgainHeld(null, null)).toBe(false)
  })
})

describe('the player strings (server-only)', () => {
  it('strings.ts starts with the server-only marker', () => {
    const source = readFileSync(join(here, 'strings.ts'), 'utf8')
    expect(source.split('\n')[0]).toBe("import 'server-only'")
  })

  it.each(cases)(
    '%s/%s: finished strings, "Page n" for n = 1 to the node count',
    (_, locale, pkg) => {
      const data = dataOf(pkg)
      const t = translator(locale)
      const strings = playerStringsOf(locale, data)
      expect(strings.page).toHaveLength(data.nodes.length)
      expect(strings.page).toEqual(data.nodes.map((_n, i) => t('player.page', { n: i + 1 })))
      expect(strings.page[0]).toBe(locale === 'hi' ? 'पेज 1' : 'Page 1')
      expect(strings).toEqual({
        errorTitle: t('player.errorTitle'),
        startThisAgain: t('player.startThisAgain'),
        allStories: t('player.allStories'),
        storageTitle: t('storage.title'),
        storageBody: t('storage.body'),
        navLabel: t('header.navLabel'),
        grownUps: t('header.grownUps'),
        page: strings.page,
        back: t('player.back'),
        menu: t('player.menu'),
        textSize: t('player.textSize'),
        textSizeOption: {
          100: t('player.textSizeOption', { percent: 100 }),
          125: t('player.textSizeOption', { percent: 125 }),
          150: t('player.textSizeOption', { percent: 150 }),
        },
        restart: t('player.restart'),
        restartQuestion: t('player.restartQuestion'),
        keepReading: t('player.keepReading'),
        progress: t('player.progress'),
        progressValue: strings.progressValue,
        endingCount: strings.endingCount,
        lessonHeading: t('player.lessonHeading'),
        altEnding: t('player.altEnding'),
        tryAnother: t('player.tryAnother'),
        share: t('player.share'),
        linkCopied: t('player.linkCopied'),
        copyLink: t('player.copyLink'),
        storyLanguage: t('player.storyLanguage'),
        // Step 11 (p1-step11-design.md §0.2, T11-17 g1): the narration group's 9 strings.
        readToMe: t('player.readToMe'),
        aiVoice: t('player.aiVoice'),
        aiVoiceAbout: t('player.aiVoiceAbout'),
        pause: t('player.pause'),
        resume: t('player.resume'),
        playAgain: t('player.playAgain'),
        tapToListen: t('player.tapToListen'),
        narrationLoading: t('player.narrationLoading'),
        narrationUnavailable: t('player.narrationUnavailable'),
      })
      // Step 10c: "Ending {found} of {total} found" for every found from 0 to the ending count.
      const endings = data.endingIds.length
      expect(endings).toBeGreaterThan(1)
      expect(strings.endingCount).toEqual(
        Array.from({ length: endings + 1 }, (_n, found) =>
          t('player.endingCount', { found, total: endings }),
        ),
      )
      expect(strings.endingCount[1]).toBe(
        locale === 'hi' ? `${endings} में से 1 अंत मिला` : `Ending 1 of ${endings} found`,
      )
      expect(strings.endingCount[2]).toBe(
        locale === 'hi' ? `${endings} में से 2 अंत मिले` : `Ending 2 of ${endings} found`,
      )
      expect(strings.endingCount[0]).toBe(
        locale === 'hi' ? 'अभी कोई अंत नहीं मिला' : `Ending 0 of ${endings} found`,
      )
      // Step 10b: "{filled} of {total}" for every count from 0 to the step count (D11-P12).
      const total = data.progressSteps.length
      expect(strings.progressValue).toEqual(
        Array.from({ length: total + 1 }, (_n, filled) =>
          t('player.progressValue', { filled, total }),
        ),
      )
      expect(strings.progressValue[1]).toBe(locale === 'hi' ? `${total} में से 1` : `1 of ${total}`)
      expect(Object.values(strings.textSizeOption)).toEqual(['100%', '125%', '150%'])
    },
  )
})

describe('player CSS that the markup relies on (read as text)', () => {
  /** The declarations of the one rule whose selector list is exactly `selector`. */
  function ruleBody(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rules = all(css, new RegExp(`\\n${escaped} \\{\\n([^}]*)\\}`, 'g'))
    expect(rules, selector).toHaveLength(1)
    return rules[0]?.[1] ?? ''
  }

  it('Hindi control labels: the paint-only 0.12em offset, on the labels that carry its classes (D11-P26)', () => {
    const body = ruleBody(playerCss(), '.choiceLabel:lang(hi),\n.actionLabel:lang(hi)')
    expect(body).toBe('  position: relative;\n  inset-block-start: 0.12em;\n')
    // The labels the rule names: every choice label, and both fallback action labels.
    const [pkg] = fixtures
    if (pkg === undefined) throw new Error('no fixture')
    const html = renderPlayer(dataOf(pkg), 'hi')
    const labels = all(html, /<button\b[^>]*\sdata-choice="[^"]*"[^>]*><span\b([^>]*)>/g)
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) expect(label[1]).toBe(` class="${styles.choiceLabel}"`)
    const fallback = renderToString(
      createElement(PlayerFallback, {
        storyId: 'two-paths',
        locale: 'hi',
        strings: playerFallbackStringsOf('hi'),
      }),
    )
    const actions = all(fallback, /<(?:button|a)\b[^>]*><span\b([^>]*)>/g)
    expect(actions).toHaveLength(2)
    for (const action of actions) expect(action[1]).toBe(` class="${styles.actionLabel}"`)
    // Step 10b: the menu's three text-size radio labels, header controls too (review A11Y-1).
    const options = all(html, /<label\b[^>]*><input\b[^>]*><span\b([^>]*)>/g)
    expect(options).toHaveLength(3)
    for (const option of options) expect(option[1]).toBe(` class="${styles.actionLabel}"`)
  })

  it('progress segments: the same box filled or empty, a fill against an outline (D11-P12)', () => {
    const css = playerCss()
    expect(ruleBody(css, '.segment')).toBe(
      [
        '  flex: 1 1 0;',
        '  block-size: var(--space-3);',
        '  border: 2px solid var(--color-line-strong);',
        '  border-radius: var(--radius-pill);',
        '  background-color: transparent;',
        '',
      ].join('\n'),
    )
    // Filled changes only colours, never the box: the same border width, the same size.
    expect(ruleBody(css, '.segment[data-filled]')).toBe(
      '  border-color: var(--color-accent);\n  background-color: var(--color-accent);\n',
    )
    // Forced colours force every background to Canvas; a filled segment keeps a CanvasText fill,
    // so it never looks like an empty one (review A11Y-2; T-b6 checks it in Chromium).
    expect(css).toContain(
      [
        '\n@media (forced-colors: active) {',
        '  .segment[data-filled] {',
        '    forced-color-adjust: none;',
        '    border-color: CanvasText;',
        '    background-color: CanvasText;',
        '  }',
        '}\n',
      ].join('\n'),
    )
  })

  it('the menu: the panel sets no display (hidden keeps it out); radio labels are 44 px targets (D11-P19)', () => {
    const css = playerCss()
    const panel = ruleBody(css, '.menuPanel')
    expect(panel).not.toMatch(/(^|\n)\s*display:/)
    expect(css).not.toMatch(/\.menuPanel[^{,]*\{[^}]*\bdisplay:/)
    const option = ruleBody(css, '.option')
    expect(option).toContain('\n  min-block-size: var(--target-min);\n')
    expect(option).toContain('\n  touch-action: manipulation;\n')
    // Row 2 starts under row 1: a full-width item of the header.
    expect(ruleBody(css, '.headerRow')).toContain('\n  flex-basis: 100%;\n')
  })

  it('the saved-run hint hides the run area while opening, with a one-shot 3 s failsafe (D11-P5, §4.4)', () => {
    const css = playerCss()
    expect(
      ruleBody(
        css,
        ":global(:root[data-saved-run]) .player[data-run-phase='opening'] .runDependent",
      ),
    ).toBe(
      [
        '  visibility: hidden;',
        '  animation-name: savedRunFailsafe;',
        '  animation-duration: var(--duration-quick);',
        '  animation-delay: var(--saved-run-failsafe);',
        '  animation-fill-mode: forwards;',
        '',
      ].join('\n'),
    )
    expect(css).toContain(
      '\n@keyframes savedRunFailsafe {\n  to {\n    visibility: visible;\n  }\n}\n',
    )
    // The delay token: 3000 ms, in its own group, never a --duration-* token (those are 0 under
    // reduced motion; the failsafe must still fire).
    const tokens = readFileSync(join(here, '..', 'styles', 'tokens.css'), 'utf8')
    expect(all(tokens, /--saved-run-failsafe:\s*([^;]*);/g).map((m) => m[1])).toEqual(['3000ms'])
    // The rule's classes are on the player root and the run area.
    const [pkg] = fixtures
    if (pkg === undefined) throw new Error('no fixture')
    const html = renderPlayer(dataOf(pkg), 'en')
    expect(startTags(html, 'div').filter((tag) => /\sdata-player=""/.test(tag))[0]).toContain(
      ` class="${styles.player}"`,
    )
    expect(startTags(html, 'div').filter((tag) => /\sdata-run=""/.test(tag))[0]).toContain(
      ` class="${styles.runDependent}"`,
    )
  })

  // P1-4 owner screens (T10; D11-P11): the page behind the open restart dialog dims to the page's
  // canvas colour at 0.7, with no motion. Engines that give ::backdrop no custom properties take
  // the Canvas fallback, which color-scheme makes the dark Canvas (only this check sees those two).
  it("the restart dialog's backdrop: the canvas colour, see-through, no motion (D11-P11)", () => {
    expect(ruleBody(playerCss(), '.dialog::backdrop')).toBe(
      [
        '  color-scheme: dark;',
        '  background-color: var(--color-canvas, Canvas);',
        '  opacity: 0.7;',
        '',
      ].join('\n'),
    )
    const tokens = readFileSync(join(here, '..', 'styles', 'tokens.css'), 'utf8')
    expect(tokens).toContain('\n    --color-canvas: #')
  })
})

describe('the error fallback (D11-P17)', () => {
  it.each(ENABLED_LOCALE_CODES)(
    '%s: main#main, the heading, Start again, All stories, an empty live region',
    (locale) => {
      const strings = playerFallbackStringsOf(locale)
      const html = renderToString(
        createElement(PlayerFallback, { storyId: 'two-paths', locale, strings }),
      )
      expect(all(html, MAIN)).toHaveLength(1)
      expect(all(html, ANY_MAIN)).toHaveLength(1)
      expect(startTags(html, 'main')[0]).toContain(' tabindex="-1"')
      const h1 = /<h1\b([^>]*)>([\s\S]*?)<\/h1>/.exec(html)
      expect(h1?.[1]).toContain(' tabindex="-1"')
      expect(unescapeHtml(h1?.[2] ?? '')).toBe(strings.errorTitle)
      const button = /<button\b([^>]*)>([\s\S]*?)<\/button>/.exec(html)
      expect(button?.[1]).toContain(' data-start-again=""')
      expect(unescapeHtml((button?.[2] ?? '').replace(/<[^>]+>/g, ''))).toBe(strings.startThisAgain)
      const link = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(html)
      expect(link?.[1]).toContain(` href="/${locale}"`)
      expect(unescapeHtml((link?.[2] ?? '').replace(/<[^>]+>/g, ''))).toBe(strings.allStories)
      expect(all(html, /\srole="status"/g)).toHaveLength(1)
      expect(all(html, EMPTY_STATUS)).toHaveLength(1)
      expect(html.indexOf('<h1')).toBeLessThan(html.indexOf('role="status"'))
    },
  )
})

/** Text as React writes it into HTML. */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

describe('Step 10c: the ending card (server markup)', () => {
  // Every ending of every fixture, in every content locale, on a page in every route locale (a
  // stored-first resume can read in a language other than the page's).
  const endings = fixtures.flatMap((pkg) => {
    const data = dataOf(pkg)
    return data.endingIds.flatMap((ending) =>
      data.locales.flatMap((content) =>
        ENABLED_LOCALE_CODES.map(
          (route) => [pkg.storyId, ending, content, route, pkg, data] as const,
        ),
      ),
    )
  })

  /** The part at `ending` with the card in its slot, as the island renders it. */
  function renderEnding(
    data: PlayerData,
    ending: string,
    content: LocaleCode,
    route: LocaleCode,
    interactive: boolean,
  ): { html: string; seq: number; count: string } {
    const view = partViewOf(
      data,
      start(graphOf(data), { path: pathTo(data, ending), locale: content }),
    )
    const strings = playerStringsOf(route, data)
    const count = strings.endingCount[1] ?? ''
    const html = renderToString(
      createElement(StoryPart, {
        view,
        interactive,
        animate: false,
        revealDone: false,
        firstParagraphRef: createRef<HTMLParagraphElement>(),
        onChoose: refuse,
        backLabel: strings.back,
        onBack: refuse,
        ending: createElement(EndingCard, {
          view,
          storyId: data.storyId,
          locale: route,
          strings,
          count,
          interactive,
          onTryAnother: refuse,
        }),
      }),
    )
    return { html, seq: view.seq, count }
  }

  it('covers every ending of every fixture in both content and route locales (the scan is not empty)', () => {
    expect(endings).toHaveLength(28)
    const alternates = endings.filter(
      ([, ending, , , , data]) => data.nodes.find((n) => n.id === ending)?.isAlternate === true,
    )
    expect(alternates).toHaveLength(16)
    expect(endings.filter(([, , content, route]) => content !== route)).toHaveLength(14)
  })

  it.each(endings)(
    '%s %s, read in %s on /%s: passage first, then the card in D11-P13 order, then Back',
    (_, ending, content, route, pkg, data) => {
      const t = translator(route)
      const node = data.nodes.find((n) => n.id === ending)
      const lesson = pkg.text[content]?.nodes[ending]?.lesson
      if (node === undefined || lesson === undefined) throw new Error(`no ${ending}`)
      expect(node.lessonIcon).not.toBeNull()
      for (const interactive of [true, false]) {
        const { html, seq, count } = renderEnding(data, ending, content, route, interactive)
        const where = `${ending} interactive=${interactive}`
        // The part: the story (the ending passage, the focus target) first, then the section,
        // then the run footer, nothing else.
        expect(html, where).toMatch(
          /^<div\b[^>]*\sdata-part=""[^>]*><div\b[^>]*\sdata-story=""[\s\S]*?<\/div><\/div><section\b[^>]*>[\s\S]*<\/section><footer\b[^>]*>[\s\S]*<\/footer><\/div>$/,
        )
        expect(paragraphsIn(html).join('\n\n'), where).toBe(pkg.text[content]?.nodes[ending]?.text)
        expect(all(html, /<section\b/g), where).toHaveLength(1)
        const section = /<section\b([^>]*)>([\s\S]*)<\/section>/.exec(html)
        expect(section?.[1], where).toBe(
          ` data-ending="" aria-labelledby="${LESSON_HEADING_ID}" class="${styles.ending}"`,
        )
        const inner = section?.[2] ?? ''
        // Icon (hidden), the alternate label only on an alternate ending, h2 naming the section,
        // the lesson as stored in the content lang, the count, then the actions.
        const head =
          `<p data-lesson-icon="" aria-hidden="true" class="${styles.lessonIcon}">` +
          `${escapeHtml(node.lessonIcon ?? '')}</p>` +
          (node.isAlternate
            ? `<p data-alternate="" class="${styles.alternate}">${escapeHtml(t('player.altEnding'))}</p>`
            : '') +
          `<h2 id="${LESSON_HEADING_ID}" class="${styles.lessonHeading}">` +
          `${escapeHtml(t('player.lessonHeading'))}</h2>` +
          `<p data-lesson="" lang="${content}" dir="ltr" class="${styles.lesson}">` +
          `${escapeHtml(lesson)}</p>` +
          `<p data-ending-count="" class="${styles.endingCount}">${escapeHtml(count)}</p>` +
          // P1-4 owner screens (T5): the wrapper (no class; it settles) holds the action row,
          // then the manual field once a share ends there, and nothing else before a tap.
          `<div data-ending-actions=""${interactive ? '' : ' inert=""'}>` +
          `<div class="${styles.actions}">`
        expect(inner.slice(0, head.length), where).toBe(head)
        expect(inner.endsWith('</div></div>'), where).toBe(true)
        const actions = inner.slice(head.length, -'</div></div>'.length)
        // Try another path (with the seq it was rendered with), Share, All stories (route locale).
        const tryAnother =
          `<button type="button" data-try-another="" data-seq="${seq}" class="${styles.action}">` +
          `<span class="${styles.actionLabel}">${escapeHtml(t('player.tryAnother'))}</span></button>`
        const share =
          `<div class="${styles.share}"><button type="button" data-share="" class="${styles.action}">` +
          `<span class="${styles.actionLabel}">${escapeHtml(t('player.share'))}</span></button></div>`
        expect(actions.slice(0, tryAnother.length + share.length), where).toBe(tryAnother + share)
        const link = /^<a\b([^>]*)>([\s\S]*?)<\/a>$/.exec(
          actions.slice(tryAnother.length + share.length),
        )
        expect(link, `${where}: All stories last`).not.toBeNull()
        expect(attrOf(link?.[1], 'href'), where).toBe(`/${route}`)
        expect(attrOf(link?.[1], 'data-all-stories'), where).toBe('')
        expect(attrOf(link?.[1], 'class'), where).toBe(styles.action)
        expect(link?.[2], where).toBe(
          `<span class="${styles.actionLabel}">${escapeHtml(t('player.allStories'))}</span>`,
        )
        // Only the lesson carries a lang: the heading, label, count and actions are the page's.
        expect(all(inner, /\slang="/g), where).toHaveLength(1)
        // No second live region and no status before a share.
        expect(html, where).not.toContain('role="status"')
        expect(html, where).not.toContain('data-share-status')
        expect(html, where).not.toContain('data-share-url')
        // The run footer (Back) settles with the card.
        expect(startTags(html, 'footer')[0]?.includes(' inert=""'), where).toBe(!interactive)
      }
    },
  )

  it('the count is the finished string the island passes (the card formats nothing)', () => {
    const [pkg] = fixtures
    if (pkg === undefined) throw new Error('no fixture')
    const data = dataOf(pkg)
    const view = partViewOf(
      data,
      start(graphOf(data), { path: pathTo(data, 'ending_quick'), locale: 'hi' }),
    )
    const strings = playerStringsOf('hi', data)
    const html = renderToString(
      createElement(EndingCard, {
        view,
        storyId: data.storyId,
        locale: 'hi',
        strings,
        count: strings.endingCount[2] ?? '',
        interactive: true,
        onTryAnother: refuse,
      }),
    )
    expect(textOf(/<p data-ending-count=""[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1])).toBe(
      '2 में से 2 अंत मिले',
    )
    expect(textOf(/<p data-alternate=""[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1])).toBe('एक अलग अंत')
  })
})

describe('Step 10c: share feedback (D11-P14, §4.3)', () => {
  const url = 'http://127.0.0.1:3005/hi/stories/two-paths/read'

  it.each(ENABLED_LOCALE_CODES)(
    '%s: nothing while idle or pending; "Link copied."; the labelled read-only field',
    (locale) => {
      const [pkg] = fixtures
      if (pkg === undefined) throw new Error('no fixture')
      const strings = playerStringsOf(locale, dataOf(pkg))
      const render = (status: 'idle' | 'pending' | 'copied' | 'manual'): string =>
        renderToString(createElement(ShareFeedback, { status, url, strings }))
      expect(render('idle')).toBe('')
      expect(render('pending')).toBe('')
      // Shown next to the button, not a second live region (the page has one; D11-P9).
      expect(render('copied')).toBe(
        `<span data-share-status="" class="${styles.shareStatus}">${escapeHtml(strings.linkCopied)}</span>`,
      )
      const manual = render('manual')
      const field =
        /^<label class="([^"]*)"><span class="([^"]*)">([\s\S]*?)<\/span><input\b([^>]*)\/><\/label>$/.exec(
          manual,
        )
      expect(field, manual).not.toBeNull()
      expect(field?.[1]).toBe(styles.shareField)
      expect(field?.[2]).toBe(styles.shareFieldLabel)
      expect(textOf(field?.[3])).toBe(strings.copyLink)
      const input = field?.[4] ?? ''
      expect(attrOf(input, 'type')).toBe('text')
      // React writes the attribute as readOnly (HTML attribute names are case-insensitive).
      expect(attrOf(input, 'readOnly')).toBe('')
      expect(attrOf(input, 'data-share-url')).toBe('')
      expect(attrOf(input, 'value')).toBe(url)
      expect(attrOf(input, 'dir')).toBe('ltr')
      expect(attrOf(input, 'class')).toBe(styles.shareUrl)
      expect(manual).not.toContain('role=')
    },
  )

  // P1-4 owner screens (T6): the control hands the card its two parts through a render prop, Share
  // (with "Link copied." after it once a copy is done) for the action row and the manual field (or
  // null) for the line under it; the call count is checked, so a control that never calls it fails.
  it('the share control renders its button and no status before a tap, through its render prop', () => {
    const [pkg] = fixtures
    if (pkg === undefined) throw new Error('no fixture')
    const strings = playerStringsOf('en', dataOf(pkg))
    const calls: ShareParts[] = []
    const html = renderToString(
      // The render prop is a function, not a node: createElement takes it as a prop here (as a
      // child its type is not ReactNode); the ending card passes it as JSX children.
      // eslint-disable-next-line react/no-children-prop
      createElement(ShareControl, {
        title: 'Two Paths',
        storyId: 'two-paths',
        contentLocale: 'hi',
        strings,
        children: (parts: ShareParts) => {
          calls.push(parts)
          return parts.share
        },
      }),
    )
    expect(calls, 'the render prop, called once').toHaveLength(1)
    expect(calls[0]?.field, 'no field before a tap').toBeNull()
    expect(html).toBe(
      `<div class="${styles.share}"><button type="button" data-share="" class="${styles.action}">` +
        `<span class="${styles.actionLabel}">Share</span></button></div>`,
    )
  })
})

describe('Step 10c: the card CSS (read as text)', () => {
  /** The declarations of the one rule whose selector is exactly `selector`. */
  function ruleOf(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rules = all(playerCss(), new RegExp(`\\n${escaped} \\{\\n([^}]*)\\}`, 'g'))
    expect(rules, selector).toHaveLength(1)
    return rules[0]?.[1] ?? ''
  }

  it('the lesson as stored: no italics, its own size and leading (a lang island, F3)', () => {
    const lesson = ruleOf('.lesson')
    expect(lesson).toContain('  font-style: normal;\n')
    expect(lesson).toContain('  font-size: var(--fs-story);\n')
    expect(lesson).toContain('  line-height: var(--lh-story);\n')
    expect(lesson).toContain('  white-space: pre-wrap;\n')
    expect(lesson).not.toMatch(/quotes|content:|italic|oblique/)
    expect(playerCss()).not.toMatch(/\.lesson[^{]*::?(before|after)/)
    const icon = ruleOf('.lessonIcon')
    expect(icon).toMatch(/ {2}font-size: var\(--fs-[a-z]+\);\n/)
    expect(icon).toMatch(/ {2}line-height: var\(--lh-[a-z]+\);\n/)
  })

  // P1-4 owner screens (T7): the field follows the action row in the wrapper, so it is no flex item
  // of the row (no flex-basis) and sits the row's own gap under it; the input keeps its rule.
  it('the card sits on the story surface; the share field is a full-width line under the actions', () => {
    expect(ruleOf('.ending')).toContain('  background-color: var(--color-surface-story);\n')
    const field = ruleOf('.shareField')
    expect(field).toContain('  margin-block: var(--gap-target) 0;\n')
    expect(field).not.toMatch(/flex-basis/)
    expect(ruleOf('.shareUrl')).toBe(
      [
        '  inline-size: 100%;',
        '  min-block-size: var(--target-min);',
        '  padding-block: var(--space-1);',
        '  padding-inline: var(--space-3);',
        '  border: 2px solid var(--color-line-strong);',
        '  border-radius: var(--radius-control);',
        '  background-color: var(--color-surface-raised);',
        '  color: var(--color-text);',
        '',
      ].join('\n'),
    )
  })

  // D11-P6 amended at 10c (A11Y-10c-2): at an ending the card fades in with the reveal's second
  // stage, like the question and choices: opacity only, --duration-quick after a --duration-calm
  // delay, only on a part a step rendered (data-animate) and never after the skip
  // (data-reveal="done"); tokens only, so reduced motion makes it 0 ms, delay included.
  const STAGE = ".part[data-animate]:not([data-reveal='done'])"
  const FIRST_STAGE = `${STAGE} .passage`
  const SECOND_STAGE = ['.question', '.choices', '.ending'].map((name) => `${STAGE} ${name}`)
  const stageBody = (duration: string, delay: string | null): string =>
    [
      '  animation-name: reveal;',
      `  animation-duration: var(${duration});`,
      ...(delay === null ? [] : [`  animation-delay: var(${delay});`]),
      '  animation-timing-function: var(--ease-calm);',
      '  animation-fill-mode: both;',
      '',
    ].join('\n')
  /** The card's class or its data attribute in a selector (never .endingCount, data-ending-count). */
  const NAMES_CARD = /\.ending(?![\w-])|\[data-ending(?![\w-])/
  const MOTION = /(^|\n)\s*(animation|transition|opacity)[\w-]*:/

  /** What is wrong with the card's reveal in `css`; empty when nothing is. */
  function cardRevealProblems(css: string): string[] {
    const problems: string[] = []
    const rules = all(css.replace(/\/\*[\s\S]*?\*\//g, ''), /([^\n{}][^{}]*?) \{\n([^{}]*)\}/g).map(
      (m) => ({ selector: (m[1] ?? '').trim(), body: m[2] ?? '' }),
    )
    const exactly = (selector: string, body: string, name: string): void => {
      const found = rules.filter((rule) => rule.selector === selector)
      if (found.length !== 1 || found[0]?.body !== body) problems.push(`${name}: not as designed`)
    }
    exactly(FIRST_STAGE, stageBody('--duration-calm', null), 'the first stage (the passage)')
    exactly(
      SECOND_STAGE.join(',\n'),
      stageBody('--duration-quick', '--duration-calm'),
      'the second stage (question, choices, the card)',
    )
    // The second stage is the only rule that moves the card: nothing else animates, transitions
    // or sets the opacity of a selector naming it, nested in @media or not.
    for (const rule of rules) {
      if (rule.selector === SECOND_STAGE.join(',\n')) continue
      if (NAMES_CARD.test(rule.selector) && MOTION.test(rule.body)) {
        problems.push(`another rule moves the card: ${rule.selector}`)
      }
    }
    if (
      all(css, /\n@keyframes reveal \{\n {2}from \{\n {4}opacity: 0;\n {2}\}\n\}\n/g).length !== 1
    ) {
      problems.push('the reveal keyframes are not opacity only')
    }
    return problems
  }

  it('the card fades in with the second reveal stage, after the passage (D11-P6, A11Y-10c-2)', () => {
    // The hooks: the card's section carries styles.ending (the card markup test above) inside the
    // part, which carries data-animate and data-reveal (a part a step rendered, above).
    expect(cardRevealProblems(playerCss())).toEqual([])
  })

  it('the card reveal check rejects each way the card could move out of the second stage', () => {
    const css = playerCss()
    const second = SECOND_STAGE.join(',\n')
    const twoOnly = SECOND_STAGE.slice(0, 2).join(',\n')
    const seeded: Record<string, string> = {
      // Before 10c's amendment: the card has no reveal and paints with the passage's first frame.
      'no reveal on the card': css.replace(second, twoOnly),
      'the card fades in with the passage': css
        .replace(second, twoOnly)
        .replace(`\n${FIRST_STAGE} {`, `\n${FIRST_STAGE},\n${STAGE} .ending {`),
      'the skip does not end it': css.replace(
        `${STAGE} .ending {`,
        '.part[data-animate] .ending {',
      ),
      'it runs on a part no step rendered': css.replace(
        `${STAGE} .ending {`,
        ".part:not([data-reveal='done']) .ending {",
      ),
      'a literal delay (not 0 under reduced motion)': css.replace(
        `${second} {\n  animation-name: reveal;\n  animation-duration: var(--duration-quick);\n  animation-delay: var(--duration-calm);`,
        `${second} {\n  animation-name: reveal;\n  animation-duration: var(--duration-quick);\n  animation-delay: 300ms;`,
      ),
      'a second rule with a transition': `${css}\n.ending {\n  transition: opacity var(--duration-quick);\n}\n`,
      'the data attribute': `${css}\n.part[data-animate] [data-ending] {\n  animation-name: reveal;\n}\n`,
      'nested in @media': `${css}\n@media (min-width: 1px) {\n  .part .ending {\n    opacity: 0.5;\n  }\n}\n`,
      'motion, not opacity only': css.replace(
        '\n@keyframes reveal {\n  from {\n    opacity: 0;\n  }\n}\n',
        '\n@keyframes reveal {\n  from {\n    opacity: 0;\n    transform: translateY(8px);\n  }\n}\n',
      ),
    }
    for (const [name, broken] of Object.entries(seeded)) {
      expect(broken, `${name}: the seed changed the CSS`).not.toBe(css)
      expect(cardRevealProblems(broken), name).not.toEqual([])
    }
    // Near misses the check must not count as naming the card.
    expect(NAMES_CARD.test('.endingCount')).toBe(false)
    expect(NAMES_CARD.test('[data-ending-count]')).toBe(false)
  })
})

describe('Step 10d: the story-language switch and the lang islands (server markup)', () => {
  const shellCss = (): string => readFileSync(join(here, '../shell/shell.module.css'), 'utf8')

  /** The declarations of the one rule whose selector list is exactly `selector`. */
  function ruleIn(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rules = all(css, new RegExp(`\\n${escaped} \\{\\n([^}]*)\\}`, 'g'))
    expect(rules, selector).toHaveLength(1)
    return rules[0]?.[1] ?? ''
  }

  /** The header nav's inner HTML. */
  const navOf = (html: string): string => /<nav\b[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? ''

  /** The switch as React writes it (JSX prop order). */
  function switchHtml(target: LocaleCode, label: string, opening: boolean): string {
    const { endonym, dir } = getLocaleDef(target)
    return (
      `<button type="button" data-story-language=""${opening ? ' inert=""' : ''} ` +
      `class="${styles.action} ${shell.switch} ${styles.runDependent}">` +
      `<span class="${a11y.visuallyHidden}">${escapeHtml(`${label} `)}</span>` +
      `<span lang="${target}" dir="${dir}" class="${shell.switchName}">${escapeHtml(endonym)}</span>` +
      '</button>'
    )
  }

  const englishOnly = playerDataOf(
    StoryPackageV1.parse({
      ...twoPaths,
      storyId: 'english-only',
      locales: ['en'],
      text: { en: twoPaths.text.en },
    }),
    { locales: ENABLED_LOCALE_CODES },
  )

  it.each(cases)(
    '%s/%s: the nav holds the switch to the other language, then Grown-ups; inert and run-dependent while opening',
    (_, locale, pkg) => {
      const html = renderPlayer(dataOf(pkg), locale)
      const t = translator(locale)
      const other: LocaleCode = locale === 'en' ? 'hi' : 'en'
      const label = t('player.storyLanguage')
      expect(label).toBe(locale === 'hi' ? 'कहानी की भाषा:' : 'Story language:')
      const nav = navOf(html)
      const button = switchHtml(other, label, true)
      // First in the nav: a native button named "Story language: <endonym>"; the endonym alone
      // carries a lang (the other language's) and its own dir.
      expect(nav.slice(0, button.length)).toBe(button)
      // Grown-ups follows it and is the last thing in the nav (3.2.6).
      expect(nav.slice(button.length)).toMatch(
        new RegExp(`^<a\\b[^>]*\\shref="/${locale}/grown-ups"[^>]*>[\\s\\S]*?</a>$`),
      )
      // One switch on the page, inside the header.
      expect(all(html, /\sdata-story-language=""/g)).toHaveLength(1)
      const header = /<header\b[^>]*>([\s\S]*?)<\/header>/.exec(html)?.[1] ?? ''
      expect(header).toContain(button)
    },
  )

  it('a story whose page has one language renders no switch (localeSwitchOf gives null)', () => {
    expect(englishOnly.locales).toEqual(['en'])
    const html = renderPlayer(englishOnly, 'en')
    expect(html).not.toContain('data-story-language')
    const nav = navOf(html)
    expect(all(nav, /<button\b/g)).toHaveLength(0)
    expect(nav).toMatch(/^<a\b[^>]*\shref="\/en\/grown-ups"[^>]*>[\s\S]*?<\/a>$/)
  })

  it('the switch once open: not inert, the endonym of the language it offers now in its own lang and dir', () => {
    const offers: [LocaleCode, LocaleCode][] = [
      ['en', 'hi'],
      ['en', 'en'],
      ['hi', 'en'],
      ['hi', 'hi'],
      // A right-to-left target takes its own dir from the registry.
      ['en', 'ar'],
    ]
    for (const [route, target] of offers) {
      const label = translator(route)('player.storyLanguage')
      const html = renderToString(
        createElement(StoryLanguageSwitch, {
          target,
          label,
          opening: false,
          onSwitch: refuse,
        }),
      )
      expect(html, `${route} ${target}`).toBe(switchHtml(target, label, false))
    }
    expect(getLocaleDef('ar').dir).toBe('rtl')
  })

  it.each(cases)(
    '%s/%s: a switched part keeps its key, node and seq; data-story takes the new lang, Back the page language',
    (_, route, pkg) => {
      const data = dataOf(pkg)
      const graph = graphOf(data)
      const other: LocaleCode = route === 'en' ? 'hi' : 'en'
      const strings = playerStringsOf(route, data)
      const first = data.nodes.find((n) => n.id === data.startNodeId)?.choices[0]
      if (first === undefined) throw new Error('no first choice')
      const before = start(graph, { path: [data.startNodeId, first.next], locale: route })
      const result = step(graph, before, { type: 'SET_LOCALE', locale: other })
      expect(result.effects).toEqual([{ type: 'persist' }])
      const [was, now] = [partViewOf(data, before), partViewOf(data, result.state)]
      // The island keys the part by its token: the same key, so the part stays mounted.
      expect(now.token).toBe(was.token)
      const render = (view: typeof now): string =>
        renderToString(
          createElement(StoryPart, {
            view,
            interactive: true,
            animate: false,
            revealDone: false,
            firstParagraphRef: createRef<HTMLParagraphElement>(),
            onChoose: refuse,
            backLabel: strings.back,
            onBack: refuse,
          }),
        )
      const html = render(now)
      const part = startTags(html, 'div').filter((tag) => /\sdata-part=""/.test(tag))[0] ?? ''
      expect(part).toContain(` data-node="${first.next}" data-seq="${was.seq}"`)
      expect(part).not.toContain('data-animate')
      const story = startTags(html, 'div').filter((tag) => /\sdata-story=""/.test(tag))
      expect(story).toEqual([
        `<div data-story="" lang="${other}" dir="ltr" class="${styles.story}">`,
      ])
      // The only lang in the part is the story container's: its text inherits it.
      expect(all(html, /\slang="/g)).toHaveLength(1)
      expect(paragraphsIn(html).join('\n\n')).toBe(pkg.text[other]?.nodes[first.next]?.text)
      // The run footer is chrome: Back stays in the page's language.
      const back = /<button\b[^>]*\sdata-back=""[^>]*><span\b[^>]*>([\s\S]*?)<\/span><\/button>/
      expect(unescapeHtml(back.exec(html)?.[1] ?? '')).toBe(translator(route)('player.back'))
      expect(render(was)).toContain(`<div data-story="" lang="${route}" dir="ltr"`)
    },
  )

  it('the lang islands set their own size and leading from tokens (F3): the story container and the switch endonym', () => {
    // The story container: the body tokens, what it inherits on a page in its own language.
    expect(ruleIn(playerCss(), '.story')).toBe(
      [
        '  max-inline-size: var(--measure-story);',
        '  margin-inline: auto;',
        '  font-size: var(--fs-body);',
        '  line-height: var(--lh-body);',
        '',
      ].join('\n'),
    )
    // The switch's endonym takes the site switch's class: its own size and leading at regular
    // weight (no Devanagari 700), and the Hindi 0.12em paint offset (D11-P26).
    expect(ruleIn(shellCss(), '.switchName')).toBe(
      [
        '  font-size: var(--fs-label);',
        '  font-weight: var(--fw-regular);',
        '  line-height: var(--lh-label);',
        '',
      ].join('\n'),
    )
    expect(ruleIn(shellCss(), '.switchName:lang(hi),\n.label:lang(hi)')).toBe(
      '  position: relative;\n  inset-block-start: 0.12em;\n',
    )
    // A fixed width in em, so the endonym changing never moves Grown-ups.
    expect(ruleIn(shellCss(), '.switch')).toBe('  min-inline-size: 7em;\n')
  })

  it("header row 1: the header's width in em, never the label widths, puts a nav that holds the switch on a row of its own (CI fix)", () => {
    // Design D11-P16, amended at the 10d CI fix: only a nav whose child is the switch.
    const navWithSwitch = '.player > header > nav:has(> [data-story-language])'
    // The header is the query container, so the condition reads its width in its own em.
    expect(ruleIn(playerCss(), '.player > header')).toBe('  container-type: inline-size;\n')
    // Both @container blocks, and nothing else in any of them, take the :has() scope: a nav with
    // no switch (a one-language story) keeps the 10c rows.
    const blocks = all(playerCss(), /\n@container ([^{\n]*) \{\n([\s\S]*?)\n\}\n/g)
    expect(blocks.map((block) => block[1])).toEqual([
      '(inline-size < 25em)',
      '(inline-size < 14.5em)',
    ])
    for (const block of blocks) {
      const selectors = all(block[2] ?? '', /^ {2}(\S[^\n]*) \{$/gm).map((rule) => rule[1])
      expect(selectors, `the selectors in @container ${block[1]}`).toEqual([navWithSwitch])
    }
    // Under 25em that nav is a full-width item: always a row of its own, whatever the fonts; under
    // 14.5em the switch and Grown-ups always stack.
    expect(playerCss()).toContain(
      [
        '\n@container (inline-size < 25em) {',
        `  ${navWithSwitch} {`,
        '    flex-basis: 100%;',
        '  }',
        '}\n',
        '@container (inline-size < 14.5em) {',
        `  ${navWithSwitch} {`,
        '    flex-direction: column;',
        '    align-items: flex-start;',
        '  }',
        '}\n',
      ].join('\n'),
    )
    // The player header renders those elements: the nav right under the header, which is the
    // first element of the player's root (the TextScaleSync before it renders nothing), with the
    // switch as its first child, so the :has(> ...) matches it.
    const [pkg] = fixtures
    if (pkg === undefined) throw new Error('no fixture')
    const html = renderPlayer(dataOf(pkg), 'hi')
    expect(html).toMatch(
      new RegExp(`^<div data-player=""[^>]*class="${styles.player}"[^>]*><header\\b[^>]*><a\\b`),
    )
    expect(html).toMatch(/<\/a><nav\b[^>]*><button\b[^>]*\sdata-story-language=""/)
    // A one-language story's nav holds Grown-ups only: no child the :has() would match.
    const single = renderPlayer(englishOnly, 'en')
    expect(single).toMatch(/<\/a><nav\b[^>]*><a\b/)
    expect(navOf(single)).not.toContain('data-story-language')
  })
})

describe('Step 10e: scenes and the scene image (server markup)', () => {
  const BASE = 'https://media.example/storage/v1/object/public/content'
  const mediaUrl = (path: string): string => `${BASE}/${path}`
  const url = (id: string, w: number): string => `${BASE}/media/pictures/${id}-w${w}.webp`

  /**
   * river-stones with a picture on each node named in `images` (node id → one hex letter; 'f' is
   * the square 1024×1024 shape, every other letter 1408×768), as the staging picture story (§4.5).
   */
  function pictureData(images: Readonly<Record<string, string>>): PlayerData {
    const [, river] = fixtures
    if (river === undefined) throw new Error('no fixture')
    const letters = [...new Set(Object.values(images))]
    return playerDataOf(
      StoryPackageV1.parse({
        ...structuredClone(river),
        storyId: 'pictures',
        nodes: river.nodes.map((node) => ({
          ...node,
          image: Object.hasOwn(images, node.id) ? (images[node.id] ?? '').repeat(64) : null,
        })),
        assets: letters.map((c) => {
          const id = c.repeat(64)
          const size = c === 'f' ? 1024 : 1408
          return {
            kind: 'image',
            id,
            width: size,
            height: c === 'f' ? 1024 : 768,
            variants: [768, size].map((w) => ({
              path: `media/pictures/${id}-w${w}.webp`,
              mime: 'image/webp',
              bytes: 34,
              width: w,
            })),
            provenance: { origin: 'unknown' },
          }
        }),
      }),
      { locales: ENABLED_LOCALE_CODES, mediaUrl },
    )
  }

  const PICTURES = {
    start: 'a',
    flat_stones: 'b',
    round_stones: 'c',
    far_bank: 'f',
    ending_dry: 'd',
    ending_wet: 'e',
  }

  /** The img React writes for a scene picture (JSX prop order), and its band. */
  function bandHtml(id: string, w: number, h: number, failed: boolean): string {
    const small = url(id, 768)
    return (
      `<div data-scene-band="" class="${styles.sceneBand}" style="--img-w:${w};--img-h:${h}">` +
      `<img data-scene-image=""${failed ? ' data-failed=""' : ''} ` +
      `srcSet="${small} 768w, ${url(id, w)} ${w}w" ` +
      `sizes="(min-width: 60rem) 60rem, 100vw" src="${small}" width="${w}" height="${h}" ` +
      `fetchPriority="high" alt="" class="${styles.sceneImage}"/></div>`
    )
  }

  /**
   * The preload React's server renderer writes for a high-priority img (keyed by srcset plus
   * sizes, no href): the same srcset and sizes as the img, so the browser fetches one file.
   */
  function serverPreloadHtml(id: string, w: number): string {
    return (
      `<link rel="preload" as="image" imageSrcSet="${url(id, 768)} 768w, ${url(id, w)} ${w}w" ` +
      `imageSizes="(min-width: 60rem) 60rem, 100vw" fetchPriority="high"/>`
    )
  }

  const runTag = (html: string): string =>
    startTags(html, 'div').filter((tag) => /\sdata-run=""/.test(tag))[0] ?? ''

  it.each(cases)(
    '%s/%s: no picture, no band and no img (T-e7); the run area carries the scene id',
    (_, locale, pkg) => {
      const html = renderPlayer(dataOf(pkg), locale)
      expect(html).not.toContain('data-scene-band')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('<link')
      const start = pkg.nodes.find((n) => n.id === pkg.startNodeId)
      expect(start).toBeDefined()
      expect(runTag(html)).toContain(` data-scene="${sceneIdOf(start?.scene ?? '')}"`)
    },
  )

  it("the run area's data-scene: a legacy name gives its own scene, any other name forest-day", () => {
    const [pkg] = fixtures
    if (pkg === undefined) throw new Error('no fixture')
    const named = (scene: string): string => {
      const changed = structuredClone(pkg)
      const start = changed.nodes.find((n) => n.id === changed.startNodeId)
      if (start === undefined) throw new Error('no start node')
      start.scene = scene
      return runTag(renderPlayer(dataOf(changed), 'en'))
    }
    expect(named('river_bank')).toContain(' data-scene="river-bank"')
    expect(named('lions_den')).toContain(' data-scene="lions-den"')
    expect(named('meadow')).toContain(' data-scene="forest-day"')
    expect(named('river-bank')).toContain(' data-scene="forest-day"')
    // The scene attribute sits on the run area only, with its epoch and its class.
    expect(named('palace')).toMatch(
      new RegExp(
        `^<div data-run="" data-epoch="0" data-scene="palace" class="${styles.runDependent}"`,
      ),
    )
  })

  it.each(['en', 'hi'] as const)(
    '%s: a start node with a picture: the band after the title and before the story card',
    (locale) => {
      const html = renderPlayer(pictureData(PICTURES), locale)
      const title = riverStones.text[locale].title
      expect(html).toContain(
        `<h1 class="${styles.title}">${escapeHtml(title)}</h1>` +
          bandHtml('a'.repeat(64), 1408, 768, false) +
          '<div data-story-card=""',
      )
      expect(all(html, /<img\b/g)).toHaveLength(1)
      // React's own server preload of the current picture: its srcset and sizes, no href.
      expect(all(html, /<link\b[^>]*>/g).map((m) => m[0])).toEqual([
        serverPreloadHtml('a'.repeat(64), 1408),
      ])
      // A plain image load: no cross-origin mode, no lazy loading.
      expect(html).not.toMatch(/crossorigin/i)
      expect(html).not.toContain('loading=')
      // The next pictures are never preloaded on the server or while opening (D11-P22): only
      // after the open commit, in an effect. Their ids appear nowhere in the server HTML.
      for (const letter of ['b', 'c', 'd', 'e', 'f']) {
        expect(html).not.toContain(letter.repeat(64))
      }
    },
  )

  it('a start node without a picture in a picture story renders no band (T-e7)', () => {
    const rest = Object.fromEntries(Object.entries(PICTURES).filter(([id]) => id !== 'start'))
    const html = renderPlayer(pictureData(rest), 'en')
    expect(html).not.toContain('data-scene-band')
    expect(html).not.toContain('<img')
  })

  it('SceneImage: the square shape (C17), and data-failed once the picture failed', () => {
    const data = pictureData(PICTURES)
    const square = data.nodes.find((n) => n.id === 'far_bank')?.image ?? null
    const wide = data.nodes.find((n) => n.id === 'start')?.image ?? null
    if (square === null || wide === null) throw new Error('no picture')
    const render = (image: typeof wide, failed: boolean): string =>
      renderToString(createElement(SceneImage, { image, failed, onFailed: () => {} }))
    const [f, a] = ['f'.repeat(64), 'a'.repeat(64)]
    expect(render(square, false)).toBe(serverPreloadHtml(f, 1024) + bandHtml(f, 1024, 1024, false))
    expect(render(wide, false)).toBe(serverPreloadHtml(a, 1408) + bandHtml(a, 1408, 768, false))
    expect(render(wide, true)).toBe(serverPreloadHtml(a, 1408) + bandHtml(a, 1408, 768, true))
  })

  it('StoryPart places the band it is given after the title, and nothing when given none', () => {
    const data = pictureData(PICTURES)
    const state = start(graphOf(data), { path: ['start', 'flat_stones'], locale: 'en' })
    const view = partViewOf(data, state)
    const image = data.nodes.find((n) => n.id === 'flat_stones')?.image ?? null
    if (image === null) throw new Error('no picture')
    const part = (band: ReturnType<typeof createElement> | null): string =>
      renderToString(
        createElement(StoryPart, {
          view,
          interactive: true,
          animate: false,
          revealDone: false,
          firstParagraphRef: createRef<HTMLParagraphElement>(),
          onChoose: refuse,
          backLabel: 'Back',
          onBack: refuse,
          image: band,
        }),
      )
    const band = createElement(SceneImage, { image, failed: false, onFailed: () => {} })
    expect(part(band)).toContain(
      `</h1>${bandHtml('b'.repeat(64), 1408, 768, false)}<div data-story-card=""`,
    )
    expect(part(null)).not.toContain('data-scene-band')
    expect(part(null)).toContain(`</h1><div data-story-card=""`)
  })

  it('the scene CSS: one gradient rule at the legacy angle, and one rule per scene id (read as text)', () => {
    const css = playerCss()
    // P1-4 owner screens (T1 a, b): the run area is a framed panel. It reaches --space-3 past
    // main's content box on each side and pads by as much (the story keeps its width), pads
    // --space-5 above and below and takes the cards' radius; main's top padding drops to
    // --space-4 for the player's main only.
    expect(ruleBodyOf(css, '.runDependent[data-scene]')).toBe(
      [
        '  margin-inline: calc(var(--space-3) * -1);',
        '  padding-block: var(--space-5);',
        '  padding-inline: var(--space-3);',
        '  border-radius: var(--radius-card);',
        '  background-image: linear-gradient(160deg, var(--scene-from), var(--scene-to));',
        '',
      ].join('\n'),
    )
    expect(ruleBodyOf(css, '.player > main')).toBe('  padding-block-start: var(--space-4);\n')
    for (const id of SCENE_IDS) {
      expect(ruleBodyOf(css, `.runDependent[data-scene='${id}']`), id).toBe(
        `  --scene-from: var(--scene-${id}-from);\n  --scene-to: var(--scene-${id}-to);\n`,
      )
    }
    // No scene rule for anything but the 10 scene ids.
    expect(all(css, /\[data-scene='([^']*)'\]/g).map((m) => m[1])).toEqual([...SCENE_IDS])
    // Each names tokens that tokens.css declares.
    const tokens = readFileSync(join(here, '..', 'styles', 'tokens.css'), 'utf8')
    for (const id of SCENE_IDS) {
      expect(tokens).toContain(`\n    --scene-${id}-from: #`)
      expect(tokens).toContain(`\n    --scene-${id}-to: #`)
    }
  })

  it('the band CSS: the picture ratio before the file arrives, 40svb at most, a failed img hidden', () => {
    const css = playerCss()
    expect(ruleBodyOf(css, '.sceneBand')).toBe(
      [
        '  --img-w: 1408;',
        '  --img-h: 768;',
        '  --scene-band-max: 40svb;',
        '  overflow: hidden;',
        '  inline-size: 100%;',
        '  max-block-size: var(--scene-band-max);',
        '  margin-block: 0 var(--space-5);',
        '  border-radius: var(--radius-card);',
        '  aspect-ratio: var(--img-w) / var(--img-h);',
        '',
      ].join('\n'),
    )
    expect(ruleBodyOf(css, '.sceneImage')).toBe(
      [
        '  display: block;',
        '  inline-size: 100%;',
        '  block-size: 100%;',
        '  object-fit: cover;',
        '',
      ].join('\n'),
    )
    expect(ruleBodyOf(css, '.sceneImage[data-failed]')).toBe('  visibility: hidden;\n')
    // The band is transparent, so a failed picture shows the run area's gradient.
    expect(ruleBodyOf(css, '.sceneBand')).not.toMatch(/background/)
  })
})

// P1-4 owner screens (design p1-4-polish-design.md R1, T1 c and d): two source checks over
// player.module.css. Guard-bypass catalogue v1, "File, route and path guards" class 5 (a near miss
// must not match) applies, so each check has near-miss positives; classes 1-4 (route groups, file
// forms, case, separators) cannot apply to selectors inside one stylesheet. Documented limit: a
// rule in another stylesheet (base.css, shell.module.css) is outside these checks; the e2e T2 and
// T2b (computed values on the page) catch those.
describe('P1-4 owner screens: the framed panel, source checks over player.module.css', () => {
  /** The panel rule and the per-scene rules: the only rules naming .runDependent that set a box. */
  const SCENE_COMPOUND = /^\.runDependent\[data-scene(?:='[a-z-]+')?\]$/
  /** A padding or margin declaration, longhand or shorthand, at the start of a body line. */
  const SETS_BOX = /(?:^|\n)\s*(?:padding|margin)(?:-[a-z-]+)?\s*:/
  /** main as a type, an id or an attribute value; never .main, .mainly, [data-main], .main-menu. */
  const NAMES_MAIN = /(?<![\w.-])main(?![\w-])/

  /** (c) The shared marker: every rule naming .runDependent, but the scene forms, that sets a box. */
  const markerBoxRules = (css: string): string[] =>
    cssRules(css).flatMap((rule) =>
      SETS_BOX.test(rule.body)
        ? rule.selectors.filter((selector) => {
            const last = lastCompound(selector)
            return last.includes('runDependent') && !SCENE_COMPOUND.test(last)
          })
        : [],
    )
  /** (d) Every selector naming main (a type, an id or an attribute value). */
  const mainSelectors = (css: string): string[] =>
    cssRules(css)
      .flatMap((rule) => rule.selectors)
      .filter((selector) => NAMES_MAIN.test(selector))

  const MARKER_NEGATIVES = [
    '.runDependent {\n  padding-block: var(--space-5);\n}\n',
    '.player .runDependent {\n  padding-inline: var(--space-3);\n}\n',
    '.player > .runDependent {\n  margin-inline: 0;\n}\n',
    '.runDependent:not([data-scene]) {\n  padding: 0;\n}\n',
    '.runDependent:where(*) {\n  margin-block-start: 0;\n}\n',
    '.runDependent:is(div) {\n  padding-inline-start: 1px;\n}\n',
    '.other,\n.runDependent {\n  margin: 0;\n}\n',
    "[class*='runDependent'] {\n  padding-block: 1px;\n}\n",
    ':global(.x) .runDependent {\n  padding-block: 1px;\n}\n',
    '@media (min-width: 1px) {\n  .runDependent {\n    padding-block: 1px;\n  }\n}\n',
    '@container (min-width: 1px) {\n  .runDependent {\n    margin-inline: 0;\n  }\n}\n',
    '@layer x {\n  .runDependent {\n    margin-inline: 0;\n  }\n}\n',
    // Review A3: the bare form first in a list whose last part is the scene form, so a reader that
    // does not split the list at its commas reads only the scene form and lets it through.
    '.runDependent,\n.runDependent[data-scene] {\n  padding-block: 1px;\n}\n',
  ]
  const MARKER_POSITIVES = [
    '.runDependent[data-scene] {\n  margin-inline: calc(var(--space-3) * -1);\n  padding-block: var(--space-5);\n}\n',
    ":global(:root[data-saved-run]) .player[data-run-phase='opening'] .runDependent {\n  visibility: hidden;\n}\n",
    '.runDependent .x {\n  padding: 0;\n}\n',
    '.segments {\n  padding-block: 0;\n}\n',
    // Review A3: combinators without spaces, so a reader that cuts the compound at whitespace only
    // takes .runDependent for part of the last compound and flags these.
    '.runDependent>.x {\n  padding: 0;\n}\n',
    '.runDependent+.x {\n  margin: 0;\n}\n',
    '.runDependent~.x {\n  margin: 0;\n}\n',
  ]
  const MAIN_NEGATIVES = [
    ':global(main) {\n  padding-block-start: var(--space-4);\n}\n',
    '.player main {\n  padding-block-start: 0;\n}\n',
    'main:not(.runDependent) {\n  padding-block-start: 0;\n}\n',
    ':global(#main) {\n  padding-block-start: 0;\n}\n',
    ":global([id='main']) {\n  padding-block-start: 0;\n}\n",
    '.player > main,\nmain {\n  padding-block-start: 0;\n}\n',
    '@supports (display: grid) {\n  :global(main) {\n    padding-block-start: 0;\n  }\n}\n',
  ]
  const MAIN_POSITIVES = [
    '.player > main {\n  padding-block-start: var(--space-4);\n}\n',
    '.main {\n  outline: none;\n}\n',
    '.mainly {\n  outline: none;\n}\n',
    '[data-main] {\n  outline: none;\n}\n',
    '.main-menu {\n  outline: none;\n}\n',
    // Review A3: the allowed selector in a list, so a reader that does not split the list at its
    // commas reads one selector naming main that is not exactly .player > main, and flags it.
    '.player > main,\n.other {\n  outline: none;\n}\n',
  ]

  it('(c) only the run area (the scene forms) sets padding or margin among the rules naming .runDependent', () => {
    const css = playerCss()
    // Not blind: the reader sees the panel rule, the 10 scene rules and the saved-run hint.
    const named = cssRules(css)
      .flatMap((rule) => rule.selectors)
      .filter((selector) => lastCompound(selector).includes('runDependent'))
    expect(named).toContain('.runDependent[data-scene]')
    expect(named).toContain(
      ":global(:root[data-saved-run]) .player[data-run-phase='opening'] .runDependent",
    )
    expect(named).toHaveLength(12)
    expect(markerBoxRules(css), 'rules that would pad the segments or the switch').toEqual([])
  })

  it.each(MARKER_NEGATIVES)('(c) rejects %j', (sample) => {
    expect(markerBoxRules(`\n${sample}`)).not.toEqual([])
  })

  it.each(MARKER_POSITIVES)('(c) passes %j', (sample) => {
    expect(markerBoxRules(`\n${sample}`)).toEqual([])
  })

  it('(d) no rule but .player > main names main (the error fallback keeps its 48 px)', () => {
    expect(mainSelectors(playerCss())).toEqual(['.player > main'])
  })

  it.each(MAIN_NEGATIVES)('(d) rejects %j', (sample) => {
    expect(mainSelectors(`\n${sample}`).filter((s) => s !== '.player > main')).not.toEqual([])
  })

  it.each(MAIN_POSITIVES)('(d) passes %j', (sample) => {
    expect(mainSelectors(`\n${sample}`).filter((s) => s !== '.player > main')).toEqual([])
  })
})

/** The declarations of the one rule whose selector list is exactly `selector`. */
function ruleBodyOf(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rules = all(css, new RegExp(`\\n${escaped} \\{\\n([^}]*)\\}`, 'g'))
  expect(rules, selector).toHaveLength(1)
  return rules[0]?.[1] ?? ''
}

/**
 * Every rule of `css` (Prettier's layout: "<selector list> {\n<body>}"), indented ones inside
 * @media, @container, @supports and @layer included, as its selectors split at top-level commas
 * and its body. Comments are blanked first, so comment text is never read as a selector.
 */
function cssRules(css: string): { readonly selectors: string[]; readonly body: string }[] {
  const clean = css
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  return all(clean, /(?:^|\n)[ \t]*([^\s{}@][^{}]*?) \{\n([^{}]*)\}/g).map((match) => ({
    selectors: splitTopLevel(match[1] ?? ''),
    body: match[2] ?? '',
  }))
}

/** `text` split at commas outside parentheses and brackets, each part trimmed. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

/** The last compound selector: the text after the last top-level combinator (space, >, + or ~). */
function lastCompound(selector: string): string {
  let depth = 0
  let cut = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i] ?? ''
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && (/\s/.test(c) || c === '>' || c === '+' || c === '~')) cut = i + 1
  }
  return selector.slice(cut).trim()
}

// Step 11 (design p1-step11-design.md N1, N2, N13, N16, §4.7; T11-14): river-stones narrated as
// the staging story is (every node in en and hi but big_rock × hi), with a mediaUrl, so the
// PlayerData comes from playerDataOf; and an English-only narrated story for a page in Hindi,
// whose run reads in English while the chrome stays Hindi.
const MEDIA_BASE = 'https://media.example/storage/v1/object/public/content'
const narratedMediaUrl = (path: string): string => `${MEDIA_BASE}/${path}`
const narratedPackage = (storyId: string, locales: readonly ('en' | 'hi')[]): StoryPackageV1 =>
  StoryPackageV1.parse({
    ...riverStones,
    storyId,
    locales,
    text: Object.fromEntries(locales.map((locale) => [locale, riverStones.text[locale]])),
    assets: riverStones.nodes
      .flatMap((node) =>
        locales
          .filter((locale) => !(node.id === 'big_rock' && locale === 'hi'))
          .map((locale) => ({ nodeId: node.id, locale })),
      )
      .map(({ nodeId, locale }, i) => {
        const id = (i + 1).toString(16).padStart(64, '0')
        return {
          kind: 'audio',
          id,
          nodeId,
          locale,
          durationMs: 1008,
          variants: [{ path: `media/${storyId}/${id}-audio.mp3`, mime: 'audio/mpeg', bytes: 6048 }],
          provenance: { origin: 'unknown' },
          narratedTextSha256: '0'.repeat(64),
        }
      }),
  })
const riverParsed = StoryPackageV1.parse(riverStones)
const narratedData = playerDataOf(narratedPackage('narrated', ['en', 'hi']), {
  locales: ENABLED_LOCALE_CODES,
  mediaUrl: narratedMediaUrl,
})
const englishNarrated = playerDataOf(narratedPackage('narrated-en', ['en']), {
  locales: ENABLED_LOCALE_CODES,
  mediaUrl: narratedMediaUrl,
})

/** The narration hooks in document order (4.8), e.g. ['read-to-me', 'ai-voice']. */
const narrationHooks = (html: string): string[] =>
  all(html, /\sdata-(read-to-me|ai-voice|narration-control|narration-message)(?==)/g).map(
    (m) => m[1] ?? '',
  )

describe('Step 11: narration in the run footer, server markup (T11-14; N1, N13, N16)', () => {
  it.each(ENABLED_LOCALE_CODES)(
    '%s: page 1 holds one inert footer with Read to me (not pressed) then the AI voice link, in the route locale',
    (locale) => {
      const html = renderPlayer(narratedData, locale)
      const t = translator(locale)
      // Precondition: the narrated render is the start passage in the route locale.
      expect(paragraphsIn(html).join('\n\n')).toBe(riverParsed.text[locale]?.nodes['start']?.text)
      // (g1) One footer, inert while the run opens, holding the group and nothing else.
      const footers = startTags(html, 'footer')
      expect(footers, '(g1) one footer on page 1').toHaveLength(1)
      expect(footers[0], '(g1) the run footer').toContain(' data-part-controls=""')
      expect(footers[0], '(g1) inert while opening').toContain(' inert=""')
      const footer = /<footer\b[^>]*>([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? ''
      expect(footer, '(g1) the group first').toMatch(/^<div data-narration=""/)
      expect(
        narrationHooks(footer),
        '(g1) Read to me, then the link; no playback, no message',
      ).toEqual(['read-to-me', 'ai-voice'])
      expect(footer, '(g1) no Back at page 1').not.toContain('data-back')
      const toggle = startTags(footer, 'button').filter((tag) =>
        tag.includes(' data-read-to-me=""'),
      )
      expect(toggle, '(g1) Read to me, not pressed').toEqual([
        `<button type="button" data-read-to-me="" aria-pressed="false" class="${styles.action}">`,
      ])
      // (g2) The labels and the link are the route locale's.
      const button = /<button\b[^>]*\sdata-read-to-me=""[^>]*>([\s\S]*?)<\/button>/.exec(footer)
      expect(textOf(button?.[1]), '(g2) Read to me').toBe(t('player.readToMe'))
      const link = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(footer)
      expect(attrOf(link?.[1], 'href'), '(g2) href').toBe(
        `/${locale}/grown-ups#${HOW_STORIES_ARE_MADE_ID}`,
      )
      expect(textOf(link?.[2]), '(g2) the byline').toBe(
        `${t('player.aiVoice')} ${t('player.aiVoiceAbout')}`,
      )
    },
  )

  it('a Hindi page reading an English-only narrated story: the run is English, the group stays Hindi', () => {
    const html = renderPlayer(englishNarrated, 'hi')
    const t = translator('hi')
    expect(startTags(html, 'div').filter((tag) => /\sdata-story=""/.test(tag))[0]).toContain(
      ' lang="en"',
    )
    const footer = /<footer\b[^>]*>([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? ''
    expect(narrationHooks(footer), '(g2) the group is offered for the run language').toEqual([
      'read-to-me',
      'ai-voice',
    ])
    const button = /<button\b[^>]*\sdata-read-to-me=""[^>]*>([\s\S]*?)<\/button>/.exec(footer)
    expect(textOf(button?.[1]), '(g2) Read to me in the route locale').toBe(t('player.readToMe'))
    const link = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(footer)
    expect(attrOf(link?.[1], 'href'), '(g2) the route locale’s Grown-ups').toBe(
      `/hi/grown-ups#${HOW_STORIES_ARE_MADE_ID}`,
    )
    expect(textOf(link?.[2]), '(g2) the byline in the route locale').toBe(
      `${t('player.aiVoice')} ${t('player.aiVoiceAbout')}`,
    )
    expect(startTags(html, 'footer')[0], 'the footer carries the page language').not.toContain(
      ' lang=',
    )
  })

  it.each(cases)(
    '%s/%s (g3): a story without narration has no narration hook and no footer on page 1',
    (_, locale, pkg) => {
      const data = playerDataOf(pkg, {
        locales: ENABLED_LOCALE_CODES,
        mediaUrl: narratedMediaUrl,
      })
      const html = renderPlayer(data, locale)
      for (const hook of ['data-narration', 'data-read-to-me', 'data-ai-voice']) {
        expect(html, `(g3) ${hook}`).not.toContain(hook)
      }
      expect(html, '(g3) no footer on page 1').not.toContain('<footer')
    },
  )
})

// Step 11 (design §4.4, §4.7, §4.8, N2, N13, N15, N26; T11-15): the narration group for every row
// of the 4.4 table, as NarrationControls renders the display narrationDisplayOf gives.
const PART: NarrationPart = { url: `${MEDIA_BASE}/media/narrated/a-audio.mp3`, token: '0:3' }
const current = (status: NarrationSessionSnapshot['status']): NarrationSessionSnapshot => ({
  on: true,
  status,
  token: PART.token,
  url: PART.url,
})
interface GroupRow {
  readonly name: string
  readonly snapshot: NarrationSessionSnapshot
  readonly part: NarrationPart
  readonly status: string
  readonly on: boolean
  readonly kind: NarrationPlayback | null
  readonly pulse: boolean
  readonly message: 'loading' | 'unavailable' | null
}
const GROUP_ROWS: readonly GroupRow[] = [
  {
    name: 'off',
    snapshot: { on: false, status: 'idle', token: null, url: null },
    part: PART,
    status: 'idle',
    on: false,
    kind: null,
    pulse: false,
    message: null,
  },
  {
    name: 'no clip',
    snapshot: { on: true, status: 'idle', token: null, url: null },
    part: { url: null, token: PART.token },
    status: 'idle',
    on: true,
    kind: null,
    pulse: false,
    message: 'unavailable',
  },
  {
    name: 'ready',
    snapshot: { on: true, status: 'idle', token: null, url: null },
    part: PART,
    status: 'idle',
    on: true,
    kind: 'tap-to-listen',
    pulse: false,
    message: null,
  },
  ...(
    [
      ['loading', 'pause', false, 'loading'],
      ['buffering', 'pause', false, 'loading'],
      ['playing', 'pause', false, null],
      ['paused', 'resume', false, null],
      ['ended', 'play-again', false, null],
      ['blocked', 'tap-to-listen', true, null],
      ['unavailable', 'tap-to-listen', false, 'unavailable'],
    ] as const
  ).map(([status, kind, pulse, message]) => ({
    name: status,
    snapshot: current(status),
    part: PART,
    status,
    on: true,
    kind,
    pulse,
    message,
  })),
]
const groupCases = GROUP_ROWS.flatMap((row) =>
  ENABLED_LOCALE_CODES.map((locale) => [row.name, locale, row] as const),
)

function renderGroup(row: GroupRow, locale: LocaleCode): string {
  return renderToString(
    createElement(NarrationControls, {
      locale,
      display: narrationDisplayOf(row.snapshot, row.part),
      strings: playerStringsOf(locale, narratedData),
      onToggle: () => {},
      onPlayback: () => {},
    }),
  )
}

const PLAYBACK_KEYS = {
  pause: 'player.pause',
  resume: 'player.resume',
  'play-again': 'player.playAgain',
  'tap-to-listen': 'player.tapToListen',
} as const

describe('Step 11: the narration group for every row of the 4.4 table (T11-15)', () => {
  it('covers all four playback kinds and both messages (the scan is not empty)', () => {
    expect(new Set(GROUP_ROWS.map((row) => row.kind))).toEqual(
      new Set([null, ...NARRATION_PLAYBACKS]),
    )
    expect(new Set(GROUP_ROWS.map((row) => row.message))).toEqual(
      new Set([null, 'loading', 'unavailable']),
    )
    expect(groupCases).toHaveLength(20)
  })

  it.each(groupCases)('%s/%s', (_, locale, row) => {
    const html = renderGroup(row, locale)
    const t = translator(locale)
    // (g1) Read to me, the link, the playback button when a kind applies, the message when one does.
    expect
      .soft(narrationHooks(html), '(g1) order')
      .toEqual([
        'read-to-me',
        'ai-voice',
        ...(row.kind === null ? [] : ['narration-control']),
        ...(row.message === null ? [] : ['narration-message']),
      ])
    // (g2) The hooks of 4.8, exactly.
    const group = startTags(html, 'div')[0] ?? ''
    expect
      .soft(group, '(g2) the group')
      .toBe(
        `<div data-narration="" data-status="${row.status}"${row.on ? ' data-on=""' : ''} class="${styles.narration}">`,
      )
    expect
      .soft(startTags(html, 'button')[0], '(g2) aria-pressed')
      .toBe(
        `<button type="button" data-read-to-me="" aria-pressed="${row.on}" class="${styles.action}">`,
      )
    const playback = startTags(html, 'button').filter((tag) =>
      tag.includes(' data-narration-control=""'),
    )
    expect
      .soft(playback, '(g2) the playback button')
      .toEqual(
        row.kind === null
          ? []
          : [
              `<button type="button" data-narration-control="" data-kind="${row.kind}"${row.pulse ? ' data-pulse=""' : ''} class="${styles.action}">`,
            ],
      )
    const message = /<p\b([^>]*)>([\s\S]*?)<\/p>/.exec(html)
    expect.soft(attrOf(message?.[1], 'data-narration-message'), '(g2) message').toBe(row.message)
    if (row.message !== null) {
      expect
        .soft(textOf(message?.[2]), '(g2) message text')
        .toBe(
          t(row.message === 'loading' ? 'player.narrationLoading' : 'player.narrationUnavailable'),
        )
    }
    const hooks = new Set(all(html, /\s(data-[a-z-]+)=/g).map((m) => m[1]))
    expect
      .soft([...hooks].sort(), '(g2) no other data attribute')
      .toEqual(
        [
          'data-narration',
          'data-status',
          ...(row.on ? ['data-on'] : []),
          'data-read-to-me',
          'data-pip',
          'data-ai-voice',
          ...(row.kind === null ? [] : ['data-narration-control', 'data-kind']),
          ...(row.pulse ? ['data-pulse'] : []),
          ...(row.message === null ? [] : ['data-narration-message']),
        ].sort(),
      )
    // (g3) The byline: a text link to the Grown-ups section, same tab, visible text then a hidden
    // suffix; the byline class, never the button look.
    const link = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(html)
    expect
      .soft(attrOf(link?.[1], 'href'), '(g3) href')
      .toBe(`/${locale}/grown-ups#${HOW_STORIES_ARE_MADE_ID}`)
    expect.soft(attrOf(link?.[1], 'target'), '(g3) no target').toBeNull()
    expect.soft(attrOf(link?.[1], 'class'), '(g3) the byline class').toBe(styles.byline)
    expect.soft(link?.[1] ?? '', '(g3) never the button look').not.toContain(styles.action)
    expect
      .soft(link?.[2], '(g3) visible text, then the hidden suffix')
      .toBe(
        `<span class="${styles.actionLabel}">${escapeHtml(t('player.aiVoice'))}</span> <span class="${a11y.visuallyHidden}">${escapeHtml(t('player.aiVoiceAbout'))}</span>`,
      )
    // (g4) The message is no live region of its own (N15).
    expect.soft(message?.[1] ?? '', '(g4) no role').not.toContain('role=')
    expect.soft(message?.[1] ?? '', '(g4) no aria-live').not.toContain('aria-live')
    // (g5) Every control label carries the action label class (the Hindi paint offset).
    const toggle = /<button\b[^>]*\sdata-read-to-me=""[^>]*>([\s\S]*?)<\/button>/.exec(html)
    expect
      .soft(toggle?.[1], '(g5) Read to me: the pip, then the label')
      .toBe(
        `<span data-pip="" aria-hidden="true" class="${styles.pip}"></span><span class="${styles.actionLabel}">${escapeHtml(t('player.readToMe'))}</span>`,
      )
    // (g6) The playback button holds the four labels in one box, in fixed order; only the current
    // one is visible and named.
    if (row.kind !== null) {
      const inner =
        /<button\b[^>]*\sdata-narration-control=""[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? ''
      expect
        .soft(inner, '(g6) the label box')
        .toMatch(new RegExp(`^<span class="${styles.playbackLabels}">[\\s\\S]*</span>$`))
      // Leaf spans only: the label box itself holds tags, so [^<]* never matches it.
      const labels = all(inner, /<span class="([^"]*)"([^>]*)>([^<]*)<\/span>/g)
      expect
        .soft(
          labels.map((m) => textOf(m[3])),
          '(g6) four labels, fixed order (g5: each an action label)',
        )
        .toEqual(NARRATION_PLAYBACKS.map((kind) => t(PLAYBACK_KEYS[kind])))
      NARRATION_PLAYBACKS.forEach((kind, i) => {
        const [, className = '', rest = ''] = labels[i] ?? []
        const visible = kind === row.kind
        expect
          .soft(className, `(g6) ${kind} class`)
          .toBe(visible ? styles.actionLabel : `${styles.actionLabel} ${styles.reserve}`)
        expect.soft(rest, `(g6) ${kind} aria-hidden`).toBe(visible ? '' : ' aria-hidden="true"')
      })
    }
  })
})

// Step 11 (design N13, N14, N26, §5 items 6-8; T11-16): the narration CSS, read as text. Two small
// readers, each with its own samples below (reader code in a test is guard code, process-v2):
/** The status line's placeholder (review round 1, R1-L-2; T11-16 g5). */
const RESERVED_LINE = '.narration:has(> [data-narration-control]:last-child)::after'
/** A CSS escape at the start of a text: a backslash and 1-6 hex digits and one space, or one character. */
const CSS_ESCAPE = /^\\(?:[0-9a-f]{1,6}[ \t\n]?|[\s\S])/i
/**
 * A selector's last compound: what follows its last combinator outside parentheses, brackets and
 * escapes (a hex escape's space ends the escape; it is no combinator).
 */
function subjectOf(selector: string): string {
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i] ?? ''
    if (c === '\\') i += (CSS_ESCAPE.exec(selector.slice(i))?.[0].length ?? 1) - 1
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && /[\s>+~]/.test(c)) start = i + 1
  }
  return selector.slice(start)
}
/** Escapes resolved, then lower case: pseudo-element and attribute names fold case (review round 2). */
const cssFolded = (text: string): string =>
  text
    .replace(/\\([0-9a-f]{1,6})[ \t\n]?/gi, (_escape, hex: string) => {
      const code = parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�'
    })
    .replace(/\\([\s\S])/g, '$1')
    .toLowerCase()
/** A compound without the arguments of :not() and :has(): they name other elements. */
function withoutOtherElements(compound: string): string {
  let out = ''
  let i = 0
  while (i < compound.length) {
    const open = /^:(?:not|has)\(/.exec(compound.slice(i))
    if (open === null) {
      out += compound[i] ?? ''
      i++
      continue
    }
    let depth = 0
    let end = i + open[0].length - 1
    for (; end < compound.length; end++) {
      if (compound[end] === '(') depth++
      else if (compound[end] === ')') {
        depth--
        if (depth === 0) break
      }
    }
    i = end + 1
  }
  return out
}
/**
 * A selector with each :local(...) and :global(...) replaced by what it holds (any letter case,
 * nested, escapes skipped): Next's CSS Modules pipeline unwraps them (postcss-modules-local-by-
 * default), so `:local(.narration::after)` is the group's own ::after (review S11-R3-FS-3).
 */
function unwrapModuleScopes(selector: string): string {
  let out = ''
  let i = 0
  while (i < selector.length) {
    if (selector[i] === '\\') {
      const length = CSS_ESCAPE.exec(selector.slice(i))?.[0].length ?? 1
      out += selector.slice(i, i + length)
      i += length
      continue
    }
    const open = /^:(?:local|global)\(/i.exec(selector.slice(i))
    if (open === null) {
      out += selector[i] ?? ''
      i++
      continue
    }
    let depth = 1
    let end = i + open[0].length
    for (; end < selector.length && depth > 0; end++) {
      const c = selector[end] ?? ''
      if (c === '\\') end += (CSS_ESCAPE.exec(selector.slice(end))?.[0].length ?? 1) - 1
      else if (c === '(') depth++
      else if (c === ')') depth--
    }
    out += unwrapModuleScopes(selector.slice(i + open[0].length, depth === 0 ? end - 1 : end))
    i = end
  }
  return out
}
/**
 * A box the narration group itself generates (g5): a ::before or ::after (any letter case, escapes
 * resolved) whose subject is the group: its class (also after a type, or inside :is() or :where()),
 * one of its data hooks (data-narration, data-on, data-status), or no class, attribute or id and no
 * type but div (every div or every child, the group among them). Review round 2 (S11-R2-FS-3,
 * R2-TPP-1) widened it from "starts with .narration"; it errs towards flagging. :local() and
 * :global() are unwrapped first (S11-R3-FS-3).
 */
const isGroupPlaceholder = (selector: string): boolean => {
  const subject = cssFolded(subjectOf(unwrapModuleScopes(selector)))
  const pseudo = /::?(?:before|after)$/.exec(subject)
  if (pseudo === null) return false
  const own = withoutOtherElements(subject.slice(0, pseudo.index))
  return (
    /\.narration(?![\w-])/.test(own) ||
    /\[\s*data-(?:narration|on|status)\s*(?:[~|^$*]?=|\])/.test(own) ||
    (!/[.#[]/.test(own) && /^(?:\*|div)?(?![\w-])/.test(own))
  )
}
/** A declaration that sets a border width or style, a padding, a margin or a size (T11-16 g2). */
const SETS_BOX_CUE =
  /(?:^|\n)\s*(?:border(?:-(?:block|inline|top|right|bottom|left)(?:-(?:start|end))?)?(?:-(?:width|style))?|padding[a-z-]*|margin[a-z-]*|(?:min-|max-)?(?:inline-size|block-size|width|height))\s*:/
/** The physical properties a rule body declares (T11-16 g4; the lint's rc12 rules, in short). */
const physicalIn = (body: string): string[] =>
  all(body, /(?:^|\n)\s*([a-z-]+)\s*:/g)
    .map((m) => m[1] ?? '')
    .filter(
      (name) =>
        /^(?:left|right|top|bottom|width|height)$/.test(name) ||
        /^(?:min|max)-(?:width|height)$/.test(name) ||
        /(?:^|-)(?:left|right|top|bottom)(?:-|$)/.test(name) ||
        /-(?:x|y)$/.test(name),
    )

describe('Step 11: the CSS readers catch each form (samples)', () => {
  it.each([
    '  border: 4px solid var(--color-accent);\n',
    '  border-width: 4px;\n',
    '  border-style: dashed;\n',
    '  border-block-start-width: 1px;\n',
    '  border-inline-style: solid;\n',
    '  padding-inline: var(--space-1);\n',
    '  margin: 0;\n',
    '  inline-size: 1rem;\n',
    '  min-block-size: 1rem;\n',
    '  max-width: 1rem;\n',
    '    outline: none;\n    padding: 0;\n',
  ])('the box reader flags %j', (sample) => {
    expect(sample).toMatch(SETS_BOX_CUE)
  })

  it.each([
    '  border-color: Highlight;\n',
    '  border-block-color: Highlight;\n',
    '  box-shadow: 0 0 0 var(--space-1) var(--color-accent);\n',
    '  animation-name: none;\n',
    '  outline-offset: 2px;\n',
  ])('the box reader passes %j', (sample) => {
    expect(sample).not.toMatch(SETS_BOX_CUE)
  })

  it.each([
    RESERVED_LINE,
    '.narration::after',
    '.narration:after',
    '.narration::before',
    '.narration[data-on]::after',
    ".narration:not([data-status='idle'])::after",
    '.partControls > .narration::after',
    ":global(html[data-e2e-mutant='MW-66']) .narration::after",
    // Review round 2 (S11-R2-FS-3, R2-TPP-1): the group's box written another way. Pseudo-element
    // and attribute names in another letter case; the group's own data hooks; its class inside
    // :is() or :where() or after a type; every child or every div, the group among them; CSS
    // escapes (a hex escape's space ends the escape, it is no combinator).
    '.narration::AFTER',
    '.narration:AFTER',
    '[data-narration]::after',
    '.partControls > [DATA-ON]::after',
    "[data-status='playing']::before",
    ':is(.narration)::after',
    ':where(.narration)::before',
    'div.narration::after',
    '.partControls > *::after',
    '.partControls > ::before',
    '.partControls > div:last-child::after',
    '.narr\\61 tion::after',
    '.narration::\\61 fter',
    // Review S11-R3-FS-3: CSS Modules unwraps :local(...) and :global(...) into what they hold, so
    // a pseudo-element inside them is the group's own box.
    ':local(.narration::after)',
    '.partControls > :local(.narration::before)',
    ':global(.partControls) :LOCAL(.narration:not([data-on])::after)',
    ':global(div.narration::before)',
  ])('the placeholder reader flags %j', (selector) => {
    expect(isGroupPlaceholder(selector)).toBe(true)
  })

  it.each([
    '.narration',
    '.narrationMessage::after',
    '.narration > p::after',
    '.narration [data-narration-control]::before',
    '.pip::after',
    '.narration:has(> [data-narration-control]:last-child)',
    // Review round 2: :has() and :not() name other elements; the message's own hook is not the
    // group's.
    '.partControls:has(> .narration)::after',
    '.action:not(.narration)::before',
    '[data-narration-message]::after',
    // S11-R3-FS-3: unwrapped, these name other elements.
    ':local(.narrationMessage::after)',
    ':local(.narration) > :local(p::after)',
    ':global(.pip)::before',
  ])('the placeholder reader passes %j', (selector) => {
    expect(isGroupPlaceholder(selector)).toBe(false)
  })

  it('the physical reader flags physical names and passes logical ones and line-height', () => {
    expect(
      physicalIn(
        [
          '  margin-left: 0;',
          '  padding-top: 0;',
          '  border-right-width: 1px;',
          '  border-top-left-radius: 0;',
          '  width: 1rem;',
          '  max-height: 1rem;',
          '  left: 0;',
          '  overflow-x: auto;',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      'margin-left',
      'padding-top',
      'border-right-width',
      'border-top-left-radius',
      'width',
      'max-height',
      'left',
      'overflow-x',
    ])
    expect(
      physicalIn(
        [
          '  line-height: var(--lh-label);',
          '  margin-inline-end: 0;',
          '  inset-block-start: 0;',
          '  min-block-size: 1rem;',
          '  text-decoration-line: underline;',
          '  border-width: 2px;',
          '',
        ].join('\n'),
      ),
    ).toEqual([])
  })
})

describe('Step 11: the narration CSS (read as text; T11-16)', () => {
  const css = playerCss()
  const tokens = readFileSync(join(here, '..', 'styles', 'tokens.css'), 'utf8')
  const declared = new Set(all(tokens, /(--[a-z0-9-]+):/g).map((m) => m[1]))
  const noComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '')
  /** The bodies of every @media (forced-colors: active) block. */
  const forcedBlocks = all(
    noComments(css),
    /\n@media \(forced-colors: active\) \{\n([\s\S]*?)\n\}\n/g,
  ).map((m) => m[1] ?? '')
  const forcedNarration = forcedBlocks.filter((block) => block.includes('[data-pulse]'))
  const keyframes = /\n@keyframes narrationPulse \{\n([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? ''
  const NEW_SELECTORS = [
    '.narration',
    '.pip',
    ".action[aria-pressed='true']",
    ".action[aria-pressed='true'] .pip",
    '.byline',
    '.playbackLabels',
    '.playbackLabels > span',
    '.reserve',
    '.action[data-pulse]',
    '.action[data-pulse]:focus-visible',
    '.narrationMessage',
    RESERVED_LINE,
  ]

  it('precondition: every narration selector, the keyframes and one forced-colours block are found', () => {
    for (const selector of NEW_SELECTORS) ruleBodyOf(css, selector)
    expect(keyframes).not.toBe('')
    expect(forcedNarration).toHaveLength(1)
  })

  it('(g1) the cue: a static accent border and a 6-run alternate box-shadow pulse on --duration-calm, never infinite', () => {
    const body = ruleBodyOf(css, '.action[data-pulse]')
    for (const line of [
      'border-color: var(--color-accent);',
      'animation-name: narrationPulse;',
      'animation-duration: var(--duration-calm);',
      'animation-iteration-count: 6;',
      'animation-direction: alternate;',
    ]) {
      expect.soft(body, `(g1) ${line}`).toContain(`  ${line}\n`)
    }
    expect
      .soft(keyframes, '(g1) a box-shadow ring in the accent')
      .toMatch(/box-shadow: 0 0 0 var\(--space-1\) var\(--color-accent\);/)
    expect.soft(noComments(css), '(g1) no infinite animation').not.toMatch(/\binfinite\b/)
    // Review round 1 (R1-L-4): the pulse would paint over the focus ring's canvas halo (base.css).
    expect
      .soft(
        ruleBodyOf(css, '.action[data-pulse]:focus-visible'),
        '(g1) no pulse while the focus ring shows',
      )
      .toBe('  animation-name: none;\n')
  })

  it('(g2) no [data-pulse] rule and no pulse keyframe sets a border width or style, padding, margin or size', () => {
    const pulseRules = cssRules(css).filter((rule) =>
      rule.selectors.some((s) => s.includes('[data-pulse]')),
    )
    expect(pulseRules.length, 'precondition: the top rule, the focus rule and the forced one').toBe(
      3,
    )
    for (const rule of pulseRules) {
      expect.soft(rule.body, `(g2) ${rule.selectors.join(', ')}`).not.toMatch(SETS_BOX_CUE)
    }
    expect.soft(keyframes, '(g2) the keyframes').not.toMatch(SETS_BOX_CUE)
  })

  it('(g3) forced colours keep the cue (a Highlight border) and the filled pip (CanvasText)', () => {
    const rules = cssRules(forcedNarration[0] ?? '')
    const bodyOf = (selector: string): string =>
      (rules.find((rule) => rule.selectors.join(', ') === selector)?.body ?? '').trimEnd()
    expect
      .soft(bodyOf('.action[data-pulse]'), '(g3) the pulsing button')
      .toBe(
        [
          '    forced-color-adjust: none;',
          '    border-color: Highlight;',
          '    background-color: Canvas;',
          '    color: CanvasText;',
          '    animation-name: none;',
        ].join('\n'),
      )
    expect
      .soft(bodyOf(".action[aria-pressed='true'] .pip"), '(g3) the filled pip')
      .toBe(
        [
          '    forced-color-adjust: none;',
          '    border-color: CanvasText;',
          '    background-color: CanvasText;',
        ].join('\n'),
      )
  })

  it('(g4) tokens and logical properties only; the byline, the group, the message and the reserved box', () => {
    const bodies = [
      ...NEW_SELECTORS.map((selector) => [selector, ruleBodyOf(css, selector)] as const),
      ...cssRules(forcedNarration[0] ?? '').map(
        (rule) => [`forced ${rule.selectors.join(', ')}`, rule.body] as const,
      ),
      ['@keyframes narrationPulse', keyframes] as const,
    ]
    for (const [selector, body] of bodies) {
      // The one length literal allowed is every control's 2px border (as .action and .segment).
      const lengths = body.replace(/border: 2px solid var\(--[a-z0-9-]+\);/g, '')
      expect.soft(lengths, `(g4) ${selector}: no length literal`).not.toMatch(/\d(?:px|rem|em)\b/)
      expect.soft(body, `(g4) ${selector}: no colour literal`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect.soft(physicalIn(body), `(g4) ${selector}: logical properties`).toEqual([])
      for (const [, name] of all(body, /var\((--[a-z0-9-]+)\)/g)) {
        expect.soft(declared.has(name ?? ''), `(g4) ${selector}: ${name} is a token`).toBe(true)
      }
    }
    const byline = ruleBodyOf(css, '.byline')
    expect.soft(byline, '(g4) a 44 px target').toContain('  min-block-size: var(--target-min);\n')
    expect.soft(byline, '(g4) underlined').toContain('  text-decoration-line: underline;\n')
    expect
      .soft(byline, '(g4) the accent text colour')
      .toContain('  color: var(--color-text-accent);\n')
    expect.soft(byline, '(g4) no border').not.toMatch(/\n\s*border/)
    expect.soft(byline, '(g4) no fill').not.toMatch(/\n\s*background/)
    const group = ruleBodyOf(css, '.narration')
    expect.soft(group, '(g4) wraps').toContain('  flex-wrap: wrap;\n')
    expect.soft(group, '(g4) items at the start').toContain('  align-items: start;\n')
    expect
      .soft(ruleBodyOf(css, '.narrationMessage'), '(g4) the message on its own line')
      .toContain('  flex-basis: 100%;\n')
    expect
      .soft(ruleBodyOf(css, '.playbackLabels'), '(g4) the label box is a grid')
      .toContain('  display: grid;\n')
    expect
      .soft(ruleBodyOf(css, '.playbackLabels > span'), '(g4) one cell for every label')
      .toContain('  grid-area: 1 / 1;\n')
    // Review round 1: a one-line label sits in the middle of a cell that a wrapped reserved label
    // made two lines tall (R1-L-1); Back keeps its own height beside the group (R1-4, owner
    // screens 31 and 32).
    expect
      .soft(ruleBodyOf(css, '.playbackLabels'), '(g4) the shown label centred in the cell')
      .toContain('  align-items: center;\n')
    expect
      .soft(ruleBodyOf(css, '.partControls'), '(g4) Back keeps its own height beside the group')
      .toContain('  align-items: start;\n')
    expect
      .soft(ruleBodyOf(css, '.reserve'), '(g4) reserved labels keep their box')
      .toBe('  visibility: hidden;\n')
  })

  // Review round 1 (R1-L-2; design §17): the status line keeps its box while Read to me is on and
  // the part has a clip (the playback button shows) and no message shows (the button is last).
  it('(g5) the status line keeps its box: an empty line of the message’s size, only while the playback button is the last child', () => {
    const placeholders = cssRules(css)
      .flatMap((rule) => rule.selectors)
      .filter(isGroupPlaceholder)
    expect
      .soft(placeholders, '(g5) one placeholder, only while the playback button is the last child')
      .toEqual([RESERVED_LINE])
    expect
      .soft(ruleBodyOf(css, RESERVED_LINE), '(g5) an empty line of the label size and leading')
      .toBe(
        [
          "  content: '';",
          '  flex-basis: 100%;',
          '  block-size: calc(var(--fs-label) * var(--lh-label));',
          '',
        ].join('\n'),
      )
    const message = ruleBodyOf(css, '.narrationMessage')
    for (const line of [
      'flex-basis: 100%;',
      'margin-block: 0;',
      'font-size: var(--fs-label);',
      'line-height: var(--lh-label);',
    ]) {
      expect.soft(message, `(g5) the status line it stands for: ${line}`).toContain(`  ${line}\n`)
    }
    expect
      .soft(message, '(g5) the status line has no padding or border of its own')
      .not.toMatch(/\n\s*(?:padding|border)/)
  })
})

// Step 11 N27 (design §20.2.2, §20.3.3; T11-25): which run-area nodes refuse taps now. The rows are
// literals (never computed from the code): the part on screen is runEpoch 1 seq 3.
describe('the run-area hold after a narration tap: partHoldOf (T11-25; N27)', () => {
  const here = tokenOf({ runEpoch: 1, seq: 3 })
  const earlier = tokenOf({ runEpoch: 0, seq: 2 })
  const another = tokenOf({ runEpoch: 1, seq: 4 })
  const rows = [
    [
      '(r1) opening',
      { opening: true, token: here, settling: null, narrationHeld: null },
      { interactive: false, held: false },
    ],
    [
      '(r2) settling this part',
      { opening: false, token: here, settling: here, narrationHeld: null },
      { interactive: false, held: false },
    ],
    [
      '(r3) the narration hold of this part: the footer stays live',
      { opening: false, token: here, settling: null, narrationHeld: here },
      { interactive: true, held: true },
    ],
    [
      '(r4) the narration hold of an earlier part holds nothing now',
      { opening: false, token: here, settling: null, narrationHeld: earlier },
      { interactive: true, held: false },
    ],
    [
      '(r5) a restart-dialog cancel during the narration hold',
      { opening: false, token: here, settling: here, narrationHeld: here },
      { interactive: false, held: true },
    ],
    [
      '(r6) a settle of another part',
      { opening: false, token: here, settling: another, narrationHeld: null },
      { interactive: true, held: false },
    ],
    [
      '(r7) neither',
      { opening: false, token: here, settling: null, narrationHeld: null },
      { interactive: true, held: false },
    ],
  ] as const

  it('the 7 rows are distinct inputs (the table is not empty)', () => {
    expect(new Set(rows.map(([, input]) => JSON.stringify(input))).size).toBe(7)
  })

  it.each(rows)('%s', (name, input, expected) => {
    expect(partHoldOf(input), name).toEqual(expected)
  })
})

// Step 11 N27 (design §20.2.2, §20.2.6, §20.3.3; T11-26): the held markup. During the narration
// hold the choices and Back carry inert, the run footer does not (it holds the narration group);
// the AI voice link carries its own inert, the group and both narration buttons do not. Not held,
// the markup is byte-equal to the calls without the new props (the server and hydration render).
describe('the run-area hold after a narration tap: the held markup (T11-26; N27, §4.7)', () => {
  const graph = graphOf(narratedData)
  const page2 = partViewOf(
    narratedData,
    start(graph, { path: ['start', 'flat_stones'], locale: 'en' }),
  )
  const playing = narrationDisplayOf(current('playing'), PART)
  const groupProps = {
    locale: 'en' as const,
    display: playing,
    strings: playerStringsOf('en', narratedData),
    onToggle: () => {},
    onPlayback: () => {},
  }
  const partProps = {
    view: page2,
    interactive: true,
    animate: false,
    revealDone: false,
    firstParagraphRef: createRef<HTMLParagraphElement>(),
    onChoose: refuse,
    backLabel: 'Back',
    onBack: refuse,
  }
  const part = (held: boolean | undefined, linkHeld: boolean | undefined): string =>
    renderToString(
      createElement(StoryPart, {
        ...partProps,
        ...(held === undefined ? {} : { held }),
        narration: createElement(NarrationControls, {
          ...groupProps,
          ...(linkHeld === undefined ? {} : { linkHeld }),
        }),
      }),
    )
  const group = (linkHeld: boolean | undefined): string =>
    renderToString(
      createElement(NarrationControls, {
        ...groupProps,
        ...(linkHeld === undefined ? {} : { linkHeld }),
      }),
    )
  const tagsWith = (html: string, element: string, hook: string): string[] =>
    startTags(html, element).filter((tag) => tag.includes(` ${hook}=`))

  it('(g1) StoryPart held: the choices and Back inert, the footer live', () => {
    const html = part(true, true)
    // Precondition: page 2 of the narrated story, with its choices, Back and the narration group.
    expect(tagsWith(html, 'ul', 'data-choices'), 'precondition: the choices').toHaveLength(1)
    expect(tagsWith(html, 'button', 'data-back'), 'precondition: Back').toHaveLength(1)
    expect(narrationHooks(html), 'precondition: the narration group').toEqual([
      'read-to-me',
      'ai-voice',
      'narration-control',
    ])
    expect
      .soft(tagsWith(html, 'ul', 'data-choices')[0], '(g1) the choices inert')
      .toContain(' inert=""')
    expect
      .soft(tagsWith(html, 'button', 'data-back')[0], '(g1) Back inert (its own)')
      .toContain(' inert=""')
    expect
      .soft(tagsWith(html, 'footer', 'data-part-controls')[0], '(g1) the footer stays live')
      .not.toContain('inert')
  })

  it('(g2) NarrationControls with linkHeld: only the AI voice link inert', () => {
    const html = group(true)
    expect
      .soft(tagsWith(html, 'a', 'data-ai-voice')[0], '(g2) the AI voice link inert (its own)')
      .toContain(' inert=""')
    for (const [what, element, hook] of [
      ['the group', 'div', 'data-narration'],
      ['Read to me', 'button', 'data-read-to-me'],
      ['the playback button', 'button', 'data-narration-control'],
    ] as const) {
      const tags = tagsWith(html, element, hook)
      expect(tags, `precondition: ${what}`).toHaveLength(1)
      expect.soft(tags[0], `(g2) ${what} never inert by the hold`).not.toContain('inert')
    }
  })

  it('(g3) not held: byte-equal to the calls without the new props', () => {
    expect.soft(part(false, false), '(g3) StoryPart held false').toBe(part(undefined, undefined))
    expect.soft(group(false), '(g3) NarrationControls linkHeld false').toBe(group(undefined))
    expect
      .soft(part(undefined, undefined), '(g3) no inert anywhere when live and not held')
      .not.toContain('inert')
  })
})
