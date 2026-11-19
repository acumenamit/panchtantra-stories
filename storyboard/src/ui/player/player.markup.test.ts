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
import { Player, startAgainHeld } from './player'
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
