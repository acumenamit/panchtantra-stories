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
import { start, type StepResult } from '../../core/engine'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { graphOf, playerDataOf, type PlayerData } from '../../reader/player/player-data'
import { partViewOf } from '../../reader/player/view'
import { translator } from '../i18n/messages'
import { Player } from './player'
import { PlayerFallback } from './player-boundary'
import styles from './player.module.css'
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
    '%s %s/%s: an ending shows its passage only (no question, no choices)',
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
        }),
      )
      expect(html).toContain(` data-node="${ending}"`)
      expect(paragraphsIn(html).join('\n\n')).toBe(pkg.text[locale]?.nodes[ending]?.text)
      expect(html).not.toContain('<ul')
      expect(html).not.toContain('<button')
      expect(html).not.toContain('data-question')
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
        }),
      )
    const settling = render(false, true, false)
    expect(startTags(settling, 'div')[0]).toMatch(/\sdata-seq="1"\sdata-animate=""/)
    expect(startTags(settling, 'ul')[0]).toContain(' inert=""')
    expect(choicesIn(settling).every(([, seq]) => seq === '1')).toBe(true)
    expect(startTags(render(true, true, true), 'div')[0]).toContain(' data-reveal="done"')
    expect(startTags(render(true, true, true), 'ul')[0]).not.toContain('inert')
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
      })
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
