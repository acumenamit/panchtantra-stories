// Home server markup (P1 Step 12; design p1-step12-design.md §3.1 N2, §3.3 N4, §3.5 N6, §3.6 N7,
// §4.3, §4.4, §4.11, §3.24; test plan T12-9 to T12-13). react-dom/server renders the components
// with createElement (Vitest runs .ts files only), so these check what the server HTML of Home
// holds before hydration, and each ready state through the exported HomeProgressContext:
// - the story card (list and hero): li[data-story-card][data-added-on] with the colour as a custom
//   property only, the emoji hidden in its fixed box, the book, the h3 title holding the card's one
//   link (to the landing), the description, then the meta line (age, duration, badge cell);
// - the badge cell: every variant stacked and hidden while pending; exactly the selected one shown
//   in each ready state;
// - Continue reading: one hidden card per listed story plus the empty line; hidden cards never
//   prefetch; the shown card links to the player;
// - the shelf from props only: h1, Continue, Featured (only with a featured story in this locale,
//   between Continue and All stories, and listed too), All stories; an empty catalogue: h1 and the
//   placeholder only;
// - home.module.css read as text: the reserved cells, the stretched link, the focus ring, the grid;
//   review fixes 12a round 1: the badge pill's block padding (R1-7), its Hindi offset moved into the
//   padding (I18N-12a-2) and touch-action on the cards (A11Y-12a-4); round 1b (design §16): the
//   Continue card's saved-run hint (F1), the stretched link over the border box (F3) and the
//   heading scale; round 2b (§19): the card title at --fs-body (the type ladder), every size read
//   with a reader that sees later duplicates, at-rule blocks and other selectors (R2-TPP-1), and
//   that reader's own bypass samples; the round 2b audit (§21): the card-title target sees element
//   selectors (PA-1), and g2 (the stretched link) is read with the same reader, shorthands and
//   physical twins included, with its own samples.
// next/link is a recording mock that renders a plain <a>, so the props each link got are visible.
// The HTML is read with small regular expressions (React writes attributes in JSX prop order).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recorded } = vi.hoisted(() => ({ recorded: [] as Record<string, unknown>[] }))

vi.mock('next/link', async () => {
  const { createElement: h } = await import('react')
  function RecordingLink(props: Record<string, unknown>) {
    recorded.push(props)
    const { href, children, ...rest } = props
    // next/link reads these two itself; they never reach the <a>.
    delete rest.prefetch
    delete rest.onNavigate
    return h('a', { href, ...rest }, children as never)
  }
  return { default: RecordingLink }
})

import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { toGraph } from '../../core/engine'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { endingIdsOf, type ProgressEntry } from '../../core/progress'
import { translator } from '../i18n/messages'
import { BadgeCell } from './badge-cell'
import { ContinueReading } from './continue-reading'
import styles from './home.module.css'
import { HomeProgressContext, type HomeProgressState } from './home-progress'
import { HomeShelf } from './home-shelf'
import { StoryCard, type CardStory } from './story-card'
import { cardOf, shelfStrings } from './strings'

const here = dirname(fileURLToPath(import.meta.url))
const homeCss = (): string => readFileSync(join(here, 'home.module.css'), 'utf8')

const fixtures = [twoPaths, riverStones, lanternWalk].map((p) => StoryPackageV1.parse(p))
const cases = fixtures.flatMap((pkg) =>
  ENABLED_LOCALE_CODES.filter((locale) => pkg.locales.includes(locale)).map(
    (locale) => [pkg.storyId, locale, pkg] as const,
  ),
)

const cardFor = (pkg: StoryPackageV1, code: LocaleCode): CardStory =>
  cardOf(code, pkg, endingIdsOf(toGraph(pkg)))

/** The text React escaped, back as written. */
const unescapeHtml = (html: string): string =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

const all = (html: string, pattern: RegExp): RegExpMatchArray[] => [...html.matchAll(pattern)]
const startTags = (html: string, element: string): string[] =>
  all(html, new RegExp(`<${element}\\b[^>]*>`, 'g')).map((m) => m[0])
const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
const classesOf = (tag: string): string[] => (attr(tag, 'class') ?? '').split(' ').filter(Boolean)

const render = (element: ReactElement): string => renderToString(element)
const ready = (entries: readonly ProgressEntry[], now: number, child: ReactElement): ReactElement =>
  createElement(
    HomeProgressContext.Provider,
    { value: { phase: 'ready', entries, now } satisfies HomeProgressState },
    child,
  )

const DAY = 86_400_000
const RUN = { path: ['start', 'c1'], locale: 'en' } as const
const entryOf = (
  storyId: string,
  run: boolean,
  endingsFound: readonly string[] = [],
  order = 1,
): ProgressEntry => ({ storyId, version: 1, activeRun: run ? RUN : null, endingsFound, order })

beforeEach(() => {
  recorded.length = 0
})

describe('the story card (T12-9, A10, N4)', () => {
  it('covers every fixture in every enabled locale (the scan is not empty)', () => {
    expect(cases).toHaveLength(6)
  })

  it.each(cases)('%s in %s: list and hero variants', (storyId, code, pkg) => {
    const story = cardFor(pkg, code)
    const text = pkg.text[code]
    if (text === undefined) throw new Error('precondition: the fixture has the locale')
    for (const variant of ['list', 'hero'] as const) {
      const html = render(createElement(StoryCard, { story, variant }))
      const li = startTags(html, 'li')
      // g1: one li with the id, the addedOn and the colour as a custom property only.
      expect.soft(li, `(g1) ${variant}: one li`).toHaveLength(1)
      const tag = li[0] ?? ''
      expect.soft(attr(tag, 'data-story-card'), `(g1) ${variant}: data-story-card`).toBe(storyId)
      expect.soft(attr(tag, 'data-added-on'), `(g1) ${variant}: data-added-on`).toBe(pkg.addedOn)
      expect.soft(attr(tag, 'style'), `(g1) ${variant}: style`).toBe(`--story-color:${pkg.color}`)
      // g2: the emoji in an aria-hidden element of the fixed-box class.
      const emoji = startTags(html, 'span').find((t) => classesOf(t).includes(styles.emoji ?? '?'))
      expect.soft(emoji, `(g2) ${variant}: the emoji box`).toBeDefined()
      expect
        .soft(attr(emoji ?? '', 'aria-hidden'), `(g2) ${variant}: emoji aria-hidden`)
        .toBe('true')
      const emojiText = new RegExp(`${escapeRe(emoji ?? '')}([^<]*)</span>`).exec(html)?.[1]
      expect.soft(emojiText, `(g2) ${variant}: the emoji as stored`).toBe(pkg.emoji)
      // g3: the book, then an h3 holding exactly one link to the landing, the title its text.
      const plain = unescapeHtml(html)
      const book = plain.indexOf(`>${text.book}<`)
      const h3 = /<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(html)
      expect.soft(book, `(g3) ${variant}: the book as stored`).toBeGreaterThan(0)
      expect.soft(h3, `(g3) ${variant}: an h3`).not.toBeNull()
      expect
        .soft(plain.indexOf('<h3'), `(g3) ${variant}: the book before the h3`)
        .toBeGreaterThan(book)
      const links = startTags(html, 'a')
      expect.soft(links, `(g3) ${variant}: exactly one link in the card`).toHaveLength(1)
      expect.soft(startTags(html, 'button'), `(g3) ${variant}: no button`).toEqual([])
      expect
        .soft(startTags(h3?.[1] ?? '', 'a'), `(g3) ${variant}: the link is in the h3`)
        .toHaveLength(1)
      expect
        .soft(attr(links[0] ?? '', 'href'), `(g3) ${variant}: the landing href`)
        .toBe(`/${code}/stories/${storyId}`)
      expect
        .soft(unescapeHtml((h3?.[1] ?? '').replace(/<[^>]+>/g, '')), `(g3) ${variant}: the title`)
        .toBe(text.title)
      // g4: the description, then the meta line: the age, the duration, the badge cell.
      const description = plain.indexOf(`>${text.description}<`)
      const meta = plain.indexOf('data-story-meta=""')
      const age = plain.indexOf(`>${translator(code)('story.age', { age: pkg.age })}<`)
      const duration = plain.indexOf(`>${text.duration}<`)
      const cell = plain.indexOf('data-badge-cell=""')
      expect
        .soft(description, `(g4) ${variant}: the description after the h3`)
        .toBeGreaterThan(plain.indexOf('</h3>'))
      expect
        .soft(meta, `(g4) ${variant}: the meta line after the description`)
        .toBeGreaterThan(description)
      expect.soft(age, `(g4) ${variant}: the age in the meta line`).toBeGreaterThan(meta)
      expect.soft(duration, `(g4) ${variant}: the duration after the age`).toBeGreaterThan(age)
      expect
        .soft(cell, `(g4) ${variant}: the badge cell after the duration`)
        .toBeGreaterThan(duration)
      // g5: the hero variant carries the hero class; the list variant does not.
      expect
        .soft(classesOf(tag).includes(styles.hero ?? '?'), `(g5) ${variant}: the hero class`)
        .toBe(variant === 'hero')
      expect.soft(classesOf(tag), `(g5) ${variant}: the card class`).toContain(styles.card)
    }
  })
})

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('the badge cell (T12-10, A12, N6)', () => {
  const pkg = fixtures.find((p) => p.storyId === 'two-paths')
  if (pkg === undefined) throw new Error('no two-paths fixture')
  const story = cardFor(pkg, 'en')
  const props = {
    storyId: story.storyId,
    addedOn: story.addedOn,
    endingIds: story.endingIds,
    strings: story.badges,
  }
  const total = story.endingIds.length
  const added = Date.UTC(2026, 9, 21)

  /** The cell's start tag and its variants as [kind, found, tag, text]. */
  function cellOf(html: string) {
    const cell = startTags(html, 'span').find((t) => /\sdata-badge-cell=""/.test(t)) ?? ''
    const variants = all(html, /(<span\b[^>]*\sdata-badge="([^"]+)"[^>]*>)([^<]*)<\/span>/g).map(
      (m) => ({
        tag: m[1] ?? '',
        kind: m[2] ?? '',
        found: attr(m[1] ?? '', 'data-found'),
        text: m[3] ?? '',
      }),
    )
    return { cell, variants }
  }
  const isHidden = (tag: string): boolean =>
    attr(tag, 'aria-hidden') === 'true' && classesOf(tag).includes(styles.hidden ?? '?')
  const isShown = (tag: string): boolean =>
    attr(tag, 'aria-hidden') === undefined && !classesOf(tag).includes(styles.hidden ?? '?')

  it('(g1, g3) pending: reading, finished 1..y and new, in that order, every one hidden', () => {
    expect(total, 'precondition: two-paths has at least 2 endings').toBeGreaterThanOrEqual(2)
    const { cell, variants } = cellOf(render(createElement(BadgeCell, props)))
    expect.soft(attr(cell, 'data-story'), '(g1) data-story').toBe('two-paths')
    expect.soft(attr(cell, 'data-shown'), '(g1) data-shown pending').toBe('pending')
    expect
      .soft(
        variants.map((v) => `${v.kind}${v.found ?? ''}`),
        '(g1) the order',
      )
      .toEqual(['reading', ...Array.from({ length: total }, (_, i) => `finished${i + 1}`), 'new'])
    expect.soft(variants.length, '(g3) y + 2 variants').toBe(total + 2)
    for (const v of variants)
      expect.soft(isHidden(v.tag), `(g1) ${v.kind}${v.found ?? ''} hidden`).toBe(true)
    expect
      .soft(
        variants.map((v) => v.text),
        '(g1) the finished strings',
      )
      .toEqual([story.badges.reading, ...story.badges.finished, story.badges.new])
  })

  it.each([
    ['reading', [entryOf('two-paths', true)], added + 3 * DAY, 'reading', undefined],
    [
      'finished 1',
      [entryOf('two-paths', false, ['ending_wise'])],
      added + 30 * DAY,
      'finished',
      '1',
    ],
    [
      'finished 2',
      [entryOf('two-paths', false, ['ending_wise', 'ending_quick'])],
      added + 3 * DAY,
      'finished',
      '2',
    ],
    ['new', [], added + 3 * DAY, 'new', undefined],
    ['none', [], added + 30 * DAY, 'none', undefined],
  ] as const)(
    '(g2) %s: exactly the selected variant is shown',
    (_name, entries, now, shown, found) => {
      const { cell, variants } = cellOf(
        render(ready(entries, now, createElement(BadgeCell, props))),
      )
      expect.soft(attr(cell, 'data-shown'), '(g2) data-shown').toBe(shown)
      expect.soft(attr(cell, 'data-found'), '(g2) data-found').toBe(found)
      const visible = variants.filter((v) => isShown(v.tag))
      const selected = shown === 'none' ? [] : [`${shown}${found ?? ''}`]
      expect
        .soft(
          visible.map((v) => `${v.kind}${v.found ?? ''}`),
          '(g2) the shown variant',
        )
        .toEqual(selected)
      for (const v of variants.filter((v) => !isShown(v.tag))) {
        expect.soft(isHidden(v.tag), `(g2) ${v.kind}${v.found ?? ''} hidden`).toBe(true)
      }
      expect.soft(variants.length, '(g3) y + 2 variants in every state').toBe(total + 2)
    },
  )

  it('(g4) home.module.css: a grid cell, stacked variants, hidden by visibility only', () => {
    const css = homeCss()
    expect
      .soft(ruleBody(css, '.badgeCell'), '(g4) the cell is a grid')
      .toMatch(/(^|\n) {2}display: grid;\n/)
    expect
      .soft(ruleBody(css, '.badge'), '(g4) variants in one grid area')
      .toMatch(/(^|\n) {2}grid-area: 1 \/ 1;\n/)
    const hidden = ruleBody(css, '.hidden')
    expect.soft(hidden, '(g4) the hidden class').toBe('  visibility: hidden;\n')
    expect
      .soft(hidden, '(g4) no display, size or position')
      .not.toMatch(/display|size|position|inset|opacity|width|height/)
  })

  it('(g5) the pill keeps Devanagari marks off its border, and the Hindi offset lives in its padding', () => {
    const css = homeCss()
    expect
      .soft(ruleBody(css, '.badge'), '(g5, R1-7) the pill has block padding')
      .toMatch(/(^|\n) {2}padding-block: var\(--space-1\);\n/)
    expect
      .soft(ruleBody(css, '.badge:lang(hi)'), '(g5, I18N-12a-2) the Hindi ink offset, 0.12em down')
      .toBe(
        '  padding-block-start: calc(var(--space-1) + 0.12em);\n' +
          '  padding-block-end: calc(var(--space-1) - 0.12em);\n',
      )
    expect
      .soft(
        [...css.matchAll(/\n(\.badge[^{\n]*) \{\n([^}]*)\}/g)]
          .filter((m) => /position|inset|transform|translate|top:|bottom:/.test(m[2] ?? ''))
          .map((m) => m[1]),
        '(g5) no badge rule moves its box (it would paint over the card link and take its taps)',
      )
      .toEqual([])
  })
})

/** The body of the rule whose selector list is exactly `selector` (Prettier's form). */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {\n`)
  if (start === -1) return ''
  const open = start + selector.length + 4
  return css.slice(open, css.indexOf('\n}\n', open) + 1)
}

/** One declaration of a style rule as written: one selector of its list, the property, the value. */
interface CssDeclaration {
  readonly selector: string
  readonly property: string
  readonly value: string
  /** The preludes of the at-rule blocks around the rule ('@media (…)'), outermost first. */
  readonly within: readonly string[]
}

/** A selector list split at its top-level commas (not inside :is() or :not()), spaces collapsed. */
function splitSelectors(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let part = ''
  for (const c of list) {
    if (c === '(' || c === '[') depth++
    if (c === ')' || c === ']') depth--
    if (c === ',' && depth === 0) {
      parts.push(part)
      part = ''
    } else part += c
  }
  parts.push(part)
  return parts.map((p) => p.trim().replace(/\s+/g, ' '))
}

/**
 * Every declaration of every style rule in `css`, in source order (review 12a round 2, R2-TPP-1:
 * a first-match read is fooled by a later duplicate rule or an @media block). Comments are dropped,
 * quoted strings kept whole, selector lists split, and rules inside at-rule blocks read too, with
 * the preludes in `within`. It fails closed: a style rule nested in a style rule (CSS nesting, which
 * this repository does not write), an unbalanced brace, or an unterminated string or comment throws.
 */
function cssDeclarations(css: string): CssDeclaration[] {
  type Frame = { readonly at: string } | { readonly selectors: readonly string[] }
  const found: CssDeclaration[] = []
  const stack: Frame[] = []
  let buffer = ''
  const declare = (): void => {
    const text = buffer.trim()
    buffer = ''
    const top = stack.at(-1)
    if (text === '' || top === undefined || !('selectors' in top)) return
    const colon = text.indexOf(':')
    if (colon <= 0) throw new Error(`css reader: not a declaration: ${text}`)
    const within = stack.flatMap((frame) => ('at' in frame ? [frame.at] : []))
    for (const selector of top.selectors) {
      found.push({
        selector,
        property: text.slice(0, colon).trim().toLowerCase(),
        value: text.slice(colon + 1).trim(),
        within,
      })
    }
  }
  for (let i = 0; i < css.length; i++) {
    const c = css[i] ?? ''
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end === -1) throw new Error('css reader: an unterminated comment')
      i = end + 1
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1
      if (j >= css.length) throw new Error('css reader: an unterminated string')
      buffer += css.slice(i, j + 1)
      i = j
    } else if (c === '{') {
      const prelude = buffer.trim().replace(/\s+/g, ' ')
      buffer = ''
      if (prelude.startsWith('@')) stack.push({ at: prelude })
      else if (stack.some((frame) => 'selectors' in frame)) {
        throw new Error(`css reader: a style rule nested in a style rule: ${prelude}`)
      } else stack.push({ selectors: splitSelectors(prelude) })
    } else if (c === ';') declare()
    else if (c === '}') {
      declare()
      if (stack.pop() === undefined) throw new Error('css reader: an unbalanced }')
    } else buffer += c
  }
  if (stack.length > 0 || buffer.trim() !== '') throw new Error('css reader: an unclosed block')
  return found
}

/** The properties that set a font size: font-size and the font shorthand (which resets it). */
const SIZE_PROPERTIES: ReadonlySet<string> = new Set(['font-size', 'font'])

const shownDeclaration = (d: CssDeclaration): string =>
  `${[...d.within, d.selector].join(' ')} { ${d.property}: ${d.value} }`

/**
 * The other properties that set a pinned one: its shorthands and, in the horizontal-tb,
 * left-to-right layout of these pages (en and hi), its physical twins (round 2b audit, design §21).
 */
const ALSO_SETS: Readonly<Record<string, readonly string[]>> = {
  'font-size': ['font'],
  'inset-block-start': ['inset', 'inset-block', 'top'],
  'inset-block-end': ['inset', 'inset-block', 'bottom'],
  'inset-inline': ['inset', 'inset-inline-start', 'inset-inline-end', 'left', 'right'],
  'border-radius': [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
    'border-start-start-radius',
    'border-start-end-radius',
    'border-end-start-radius',
    'border-end-end-radius',
  ],
}

/** A property and every other property that sets it (ALSO_SETS). */
const familyOf = (property: string): ReadonlySet<string> =>
  new Set([property, ...(ALSO_SETS[property] ?? [])])

/**
 * What could give `selector` a `property` other than `want`, or [] when every rule agrees: the last
 * rule outside an at-rule wins, each rule inside an at-rule may win where it applies, and any
 * !important wins over a later rule. A shorthand or a physical twin (ALSO_SETS) counts as setting it.
 */
function pinProblems(
  declarations: readonly CssDeclaration[],
  selector: string,
  property: string,
  want: string,
): string[] {
  const family = familyOf(property)
  const mine = declarations.filter((d) => d.selector === selector && family.has(d.property))
  const problems: string[] = []
  const last = mine.filter((d) => d.within.length === 0).at(-1)
  if (last === undefined) {
    problems.push(`no rule outside an at-rule sets ${property} on ${selector}`)
  } else if (last.property !== property || last.value !== want) {
    problems.push(`the last rule wins: ${shownDeclaration(last)}`)
  }
  for (const d of mine) {
    if (d.within.length > 0 && (d.property !== property || d.value !== want)) {
      problems.push(`an at-rule block sets it: ${shownDeclaration(d)}`)
    }
    if (/!\s*important/i.test(d.value)) problems.push(`!important: ${shownDeclaration(d)}`)
  }
  return problems
}

/** What could give `selector` a font size other than `want` (the font shorthand included). */
const sizeProblems = (
  declarations: readonly CssDeclaration[],
  selector: string,
  want: string,
): string[] => pinProblems(declarations, selector, 'font-size', want)

/** Every selector (once, in source order) that sets a font size on what `target` matches. */
const sizingSelectors = (declarations: readonly CssDeclaration[], target: RegExp): string[] => [
  ...new Set(
    declarations
      .filter((d) => SIZE_PROPERTIES.has(d.property) && target.test(d.selector))
      .map((d) => d.selector),
  ),
]

/**
 * What sizes a card title: the class .title (not .titleRow or .title-x); the h3 it is, by an element
 * selector (h3, .card h3, .card > h3; round 2b audit PA-1); and the link that holds its text (the
 * class .link, or an a element). Then a description, an h2.
 */
const CARD_TITLE =
  /\.title(?![\w-])|(^|[\s>+~(,])h3(?![\w-])|\.link(?![\w-])|(^|[\s>+~(,])a(?![\w-])/
const CARD_DESCRIPTION = /\.description(?![\w-])/
const H2 = /(^|[\s>+~(])h2(?![\w-])/

/** A selector's subject: its last compound, after the last combinator outside () and []. */
function subjectOf(selector: string): string {
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) start = i + 1
  }
  return selector.slice(start).trim()
}

/**
 * T12-13 g2 (design §16 F3; the round 2b audit, §21): the selectors whose subject is a card's own
 * box (its class, its element, its hook, or *), the properties that would move or clip that box, and
 * those that shape a link's ::after, its hit area.
 */
const CARD_BOXES = {
  '.card': /\.card(?![\w-])|\.hero(?![\w-])|(^|[(,\s])li(?![\w-])|\[data-story-card|^\*/,
  '.continueCard': /\.continueCard(?![\w-])|(^|[(,\s])div(?![\w-])|\[data-continue-story|^\*/,
} as const
const CARD_BOX_PROPERTY = /^(position|border(-.*)?|overflow(-.*)?|contain|clip(-path)?|--card-.*)$/
const CLIP_PROPERTY = /^(overflow(-.*)?|contain|clip(-path)?)$/
const AFTER_BOX_PROPERTY =
  /^(content|display|position|inset(-.*)?|top|right|bottom|left|(min-|max-)?(width|height|inline-size|block-size)|margin(-.*)?|transform|translate|scale|rotate|border-radius|border(-[a-z]+)+-radius|clip(-path)?|contain|pointer-events|visibility)$/
const PSEUDO_AFTER = /::?after$/
const STRETCHED_AFTERS: readonly string[] = ['.card a::after', '.continueCard a::after']
const CARD_PINS = [
  ['position', 'relative', 'position'],
  ['--card-border', '2px', 'the border width'],
  ['--card-bar', '4px', 'the bar width'],
  ['border-radius', 'var(--radius-control)', 'the radius'],
] as const
const CARD_BORDERS = [
  'border: var(--card-border) solid var(--color-line-strong)',
  'border-block-start: var(--card-bar) solid var(--story-color)',
]
const AFTER_PINS = [
  ['content', "''", 'content'],
  ['position', 'absolute', 'position'],
  ['inset-block-start', 'calc(-1 * var(--card-bar))', 'inset-block-start, minus the bar'],
  ['inset-block-end', 'calc(-1 * var(--card-border))', 'inset-block-end, minus the border'],
  ['inset-inline', 'calc(-1 * var(--card-border))', 'inset-inline, minus the border'],
  ['border-radius', 'var(--radius-control)', "the card's radius"],
] as const

/**
 * Every way `card`'s stretched link could lose its border box, per group label ([] when none): the
 * card relative, its border and bar widths, its radius and no clip, read with every rule that sets
 * them (pinProblems); no other selector moving or clipping the card's box; its link's ::after pinned
 * the same way, with no other box property; and no other selector shaping a link's ::after.
 */
function stretchedLinkProblems(
  declarations: readonly CssDeclaration[],
  card: keyof typeof CARD_BOXES,
  pseudo: string,
): Record<string, string[]> {
  const problems: Record<string, string[]> = {}
  for (const [property, want, label] of CARD_PINS) {
    problems[`${card}: ${label}`] = pinProblems(declarations, card, property, want)
  }
  const own = declarations.filter((d) => d.selector === card)
  const borders = own.filter((d) => /^border(-|$)/.test(d.property) && !/radius/.test(d.property))
  const outside = borders
    .filter((d) => d.within.length === 0)
    .map((d) => `${d.property}: ${d.value}`)
  problems[`${card}: the border, then the bar, and nothing after them`] = [
    ...(JSON.stringify(outside) === JSON.stringify(CARD_BORDERS)
      ? []
      : [`the border declarations: ${outside.join('; ')}`]),
    ...borders
      .filter((d) => d.within.length > 0)
      .map((d) => `an at-rule block: ${shownDeclaration(d)}`),
  ]
  problems[`${card}: no overflow clip`] = own
    .filter((d) => CLIP_PROPERTY.test(d.property))
    .map(shownDeclaration)
  problems[`${card}: no other selector moves or clips its box`] = declarations
    .filter(
      (d) =>
        d.selector !== card &&
        CARD_BOXES[card].test(subjectOf(d.selector)) &&
        CARD_BOX_PROPERTY.test(d.property),
    )
    .map(shownDeclaration)
  for (const [property, want, label] of AFTER_PINS) {
    problems[`${pseudo}: ${label}`] = pinProblems(declarations, pseudo, property, want)
  }
  const pinned = new Set(AFTER_PINS.flatMap(([property]) => [...familyOf(property)]))
  problems[`${pseudo}: no other box property`] = declarations
    .filter(
      (d) =>
        d.selector === pseudo && AFTER_BOX_PROPERTY.test(d.property) && !pinned.has(d.property),
    )
    .map(shownDeclaration)
  problems["no other selector shapes a link's ::after"] = declarations
    .filter(
      (d) =>
        PSEUDO_AFTER.test(subjectOf(d.selector)) &&
        !STRETCHED_AFTERS.includes(d.selector) &&
        AFTER_BOX_PROPERTY.test(d.property),
    )
    .map(shownDeclaration)
  return problems
}

describe('Continue reading (T12-11, A13, N7)', () => {
  const stories = fixtures.map((pkg) => cardFor(pkg, 'en'))
  const props = {
    heading: translator('en')('home.continueReading'),
    empty: translator('en')('home.continueEmpty'),
    stories: stories.map(({ storyId, readHref, title, color }) => ({
      storyId,
      readHref,
      title,
      color,
    })),
  }
  const cards = (html: string) =>
    all(html, /<div\b[^>]*\sdata-continue-story="([^"]+)"[^>]*>/g).map((m) => ({
      id: m[1] ?? '',
      tag: m[0],
    }))
  const emptyTag = (html: string) =>
    startTags(html, 'p').find((t) => /\sdata-continue-empty=""/.test(t)) ?? ''
  const hidden = (tag: string): boolean =>
    attr(tag, 'aria-hidden') === 'true' && classesOf(tag).includes(styles.hidden ?? '?')

  it('(g1) pending: the heading, one hidden card per listed story and the hidden empty line', () => {
    const html = render(createElement(ContinueReading, props))
    expect.soft(/<h2\b[^>]*>Continue reading<\/h2>/.test(html), '(g1) the h2').toBe(true)
    const cell = startTags(html, 'div').find((t) => /\sdata-continue-cell=""/.test(t)) ?? ''
    expect.soft(attr(cell, 'data-shown'), '(g1) pending').toBe('pending')
    expect
      .soft(
        cards(html).map((c) => c.id),
        '(g1) one card per story',
      )
      .toEqual(['two-paths', 'river-stones', 'lantern-walk'])
    for (const card of cards(html))
      expect.soft(hidden(card.tag), `(g1) ${card.id} hidden`).toBe(true)
    expect.soft(hidden(emptyTag(html)), '(g1) the empty line hidden').toBe(true)
    expect
      .soft(startTags(html, 'section')[0] ?? '', '(g1) the section hook')
      .toMatch(/\sdata-continue=""/)
  })

  it('(g2, g3) hidden cards never prefetch; the shown card keeps the default and links to the player', () => {
    render(createElement(ContinueReading, props))
    expect(recorded, 'precondition: three links rendered').toHaveLength(3)
    for (const link of recorded) {
      expect.soft(link.prefetch, `(g2) ${String(link.href)} pending: prefetch false`).toBe(false)
    }
    recorded.length = 0
    const html = render(
      ready(
        [entryOf('river-stones', true)],
        Date.UTC(2026, 10, 18),
        createElement(ContinueReading, props),
      ),
    )
    const shown = cards(html).filter((c) => !hidden(c.tag))
    expect
      .soft(
        shown.map((c) => c.id),
        '(g2) river-stones shown',
      )
      .toEqual(['river-stones'])
    const byHref = new Map(recorded.map((p) => [String(p.href), p]))
    const river = byHref.get('/en/stories/river-stones/read')
    expect.soft(river, '(g3) the shown card links to the player').toBeDefined()
    expect
      .soft(Object.hasOwn(river ?? {}, 'prefetch'), '(g2) the shown card: no prefetch prop')
      .toBe(false)
    for (const id of ['two-paths', 'lantern-walk']) {
      expect
        .soft(byHref.get(`/en/stories/${id}/read`)?.prefetch, `(g2) ${id} hidden: false`)
        .toBe(false)
    }
    for (const { id } of cards(html)) {
      expect.soft(byHref.has(`/en/stories/${id}/read`), `(g3) ${id}: the /read href`).toBe(true)
    }
    expect.soft(hidden(emptyTag(html)), '(g2) the empty line hidden').toBe(true)
  })

  // Round 1b (design §16 F1, H-12c; SPEC:468, E11): the card's onNavigate sets the player's
  // saved-run hint before the soft navigation. HeldLink is real here, so the recorded onNavigate
  // is HeldLink's own (the hold, then the card's); the global document is a recorder and the hold's
  // timer is a fake one.
  it('(g5) the shown card sets html[data-saved-run] before the soft navigation (F1)', () => {
    const set: string[][] = []
    vi.useFakeTimers()
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (name: string, value: string) => void set.push([name, value]),
        removeAttribute: () => undefined,
      },
    })
    try {
      render(
        ready(
          [entryOf('river-stones', true)],
          Date.UTC(2026, 10, 18),
          createElement(ContinueReading, props),
        ),
      )
      const river = recorded.find((p) => p.href === '/en/stories/river-stones/read')
      const onNavigate = river?.onNavigate as
        ((event: { preventDefault: () => void }) => void) | undefined
      expect(typeof onNavigate, 'precondition: the shown card link has an onNavigate').toBe(
        'function',
      )
      onNavigate?.({ preventDefault: () => undefined })
      expect(
        set.filter(([name]) => name === 'data-nav-hold'),
        'precondition: HeldLink onNavigate ran (the hold set its attribute)',
      ).toEqual([['data-nav-hold', '']])
      expect
        .soft(
          set.filter(([name]) => name === 'data-saved-run'),
          '(g5) the Continue card sets the saved-run hint',
        )
        .toEqual([['data-saved-run', '']])
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('(g4) ready and empty: only the empty line is shown, holding home.continueEmpty', () => {
    const html = render(
      ready(
        [entryOf('river-stones', false, ['ending_dry'])],
        0,
        createElement(ContinueReading, props),
      ),
    )
    const cell = startTags(html, 'div').find((t) => /\sdata-continue-cell=""/.test(t)) ?? ''
    expect.soft(attr(cell, 'data-shown'), '(g4) data-shown empty').toBe('empty')
    expect
      .soft(
        cards(html).filter((c) => !hidden(c.tag)),
        '(g4) no card shown',
      )
      .toEqual([])
    const empty = emptyTag(html)
    expect.soft(attr(empty, 'aria-hidden'), '(g4) the empty line not hidden').toBeUndefined()
    expect.soft(classesOf(empty), '(g4) no hidden class').not.toContain(styles.hidden)
    expect.soft(html, '(g4) the text').toContain(`>${translator('en')('home.continueEmpty')}</p>`)
  })
})

describe('the shelf from props (T12-12, A8, N2)', () => {
  const sorted = (code: LocaleCode) =>
    [twoPaths, riverStones, lanternWalk]
      .map((p) => StoryPackageV1.parse(p))
      .map((pkg) => cardFor(pkg, code))
  const shelf = (
    code: LocaleCode,
    featured: { storyId: string; locales: readonly string[] } | null,
    stories = sorted(code),
  ) =>
    render(
      createElement(HomeShelf, { locale: code, strings: shelfStrings(code), stories, featured }),
    )
  const t = translator('en')

  it('(g1) with stories: h1, Continue, no Featured, All stories and the list in the given order', () => {
    const html = shelf('en', null)
    const h1 = html.indexOf(`<h1>${t('home.title')}</h1>`)
    const continueAt = html.indexOf('data-continue=""')
    const allAt = html.indexOf(`>${t('player.allStories')}</h2>`)
    const list = startTags(html, 'ul').find((u) => /\sdata-home-list=""/.test(u)) ?? ''
    expect.soft(h1, '(g1) the h1 first').toBeGreaterThanOrEqual(0)
    expect.soft(continueAt, '(g1) Continue after the h1').toBeGreaterThan(h1)
    expect
      .soft(html, '(g1) Continue reading heading')
      .toContain(`>${t('home.continueReading')}</h2>`)
    expect.soft(html.includes('data-featured'), '(g1) no Featured').toBe(false)
    expect.soft(allAt, '(g1) All stories after Continue').toBeGreaterThan(continueAt)
    expect.soft(attr(list, 'role'), '(g1) the list role').toBe('list')
    const ids = all(html, /<li\b[^>]*\sdata-story-card="([^"]+)"/g).map((m) => m[1])
    expect
      .soft(ids, '(g1) the cards in the given order')
      .toEqual(['two-paths', 'river-stones', 'lantern-walk'])
    expect.soft(html.indexOf(list), '(g1) the list after All stories').toBeGreaterThan(allAt)
  })

  it('(g2) a featured story in this locale: Featured between Continue and All stories, and listed too', () => {
    const html = shelf('en', { storyId: 'river-stones', locales: ['en', 'hi'] })
    const continueAt = html.indexOf('data-continue=""')
    const featuredAt = html.indexOf('data-featured=""')
    const allAt = html.indexOf(`>${t('player.allStories')}</h2>`)
    expect.soft(featuredAt, '(g2) Featured after Continue').toBeGreaterThan(continueAt)
    expect.soft(allAt, '(g2) Featured before All stories').toBeGreaterThan(featuredAt)
    const featured = html.slice(featuredAt, allAt)
    expect.soft(featured, '(g2) the Featured heading').toContain(`>${t('home.featured')}</h2>`)
    expect
      .soft(
        all(featured, /data-story-card="([^"]+)"/g).map((m) => m[1]),
        '(g2) the hero',
      )
      .toEqual(['river-stones'])
    const list = html.slice(allAt)
    expect
      .soft(
        all(list, /data-story-card="([^"]+)"/g).map((m) => m[1]),
        '(g2) also listed',
      )
      .toEqual(['two-paths', 'river-stones', 'lantern-walk'])
    // A featured story without this locale: no Featured section.
    const other = shelf('hi', { storyId: 'river-stones', locales: ['en'] })
    expect.soft(other.includes('data-featured'), '(g2) no section without the locale').toBe(false)
    expect.soft(other, '(g2) still listed').toContain('data-story-card="river-stones"')
  })

  it('(g3) an empty catalogue: exactly the h1 and the placeholder', () => {
    for (const code of ENABLED_LOCALE_CODES) {
      const tc = translator(code)
      const html = shelf(code, { storyId: 'river-stones', locales: ['en', 'hi'] }, [])
      expect
        .soft(html, `(g3) ${code}`)
        .toBe(`<h1>${tc('home.title')}</h1><p>${tc('home.placeholder')}</p>`)
    }
  })

  it('(g4) each section is named by its own h2', () => {
    const html = shelf('en', { storyId: 'two-paths', locales: ['en', 'hi'] })
    const sections = startTags(html, 'section')
    expect(sections, 'precondition: Continue, Featured and All stories').toHaveLength(3)
    for (const section of sections) {
      const id = attr(section, 'aria-labelledby') ?? ''
      expect.soft(id, '(g4) aria-labelledby').not.toBe('')
      const heading = new RegExp(`<h2\\b[^>]*\\sid="${escapeRe(id)}"[^>]*>`).exec(html)
      expect.soft(heading, `(g4) the h2 #${id}`).not.toBeNull()
      expect
        .soft(html.indexOf(heading?.[0] ?? '#'), `(g4) #${id} inside its section`)
        .toBeGreaterThan(html.indexOf(section))
    }
    expect
      .soft(new Set(sections.map((s) => attr(s, 'aria-labelledby'))).size, '(g4) distinct')
      .toBe(3)
  })
})

describe('home.module.css (T12-13, A10, A23)', () => {
  const css = homeCss()

  it('(g1) the list is a grid of columns at least 18rem wide (or the full width)', () => {
    expect
      .soft(ruleBody(css, '.list'), '(g1) the columns')
      .toContain('  grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));\n')
  })

  // Round 1b (design §16 F3, 3.24 item 3): the ::after's containing block is the card's padding
  // box (CSS 2.1 §10.1), so it reaches out by the bar and the border widths to the border box, with
  // the card's radius; the card has no overflow clip that would cut it. The round 2b audit (design
  // §21): every pin is read with cssDeclarations, so a later duplicate rule, an @media block, a
  // shorthand or a physical twin cannot change it unseen, and no other selector moves or clips the
  // card's box or shapes a link's ::after.
  it.each([
    ['.card', '.card a::after'],
    ['.continueCard', '.continueCard a::after'],
  ] as const)(
    '(g2) the stretched link: %s is relative and its link ::after covers its border box',
    (card, pseudo) => {
      const problems = stretchedLinkProblems(cssDeclarations(css), card, pseudo)
      for (const [label, found] of Object.entries(problems)) {
        expect.soft(found, `(g2) ${label}`).toEqual([])
      }
    },
  )

  // Round 1b (design §16 heading scale) and round 2b (§19, A11Y-12a-R2-1; 3.24 item 2): the type
  // ladder h1 (--fs-title) > the section h2s and the hero's title (--fs-story) > the card titles and
  // descriptions (--fs-body), so the sizes never run backwards and nothing inside a card reads larger
  // than its title. Every size is read with cssDeclarations (R2-TPP-1): every rule that sets it,
  // at-rule blocks included, the last one outside an at-rule winning; and no other selector sizes a
  // card title, a description or an h2.
  it('(g5) the type ladder: h1 > the section h2s = the hero title > the card title = its description', () => {
    const declarations = cssDeclarations(css)
    const pins = [
      ['.section > h2', 'var(--fs-story)', '(g5) the section h2s: --fs-story'],
      ['.hero .title', 'var(--fs-story)', '(g5) the hero title: --fs-story'],
      ['.title', 'var(--fs-body)', '(g5) the card titles: --fs-body'],
      ['.description', 'var(--fs-body)', '(g5) the card descriptions: --fs-body'],
    ] as const
    for (const [selector, want, label] of pins) {
      expect.soft(sizeProblems(declarations, selector, want), label).toEqual([])
    }
    const targets = [
      [CARD_TITLE, ['.title', '.hero .title'], 'a card title'],
      [CARD_DESCRIPTION, ['.description'], 'a card description'],
      [H2, ['.section > h2'], 'an h2'],
    ] as const
    for (const [target, selectors, what] of targets) {
      expect
        .soft(sizingSelectors(declarations, target), `(g5) the only rules that size ${what}`)
        .toEqual(selectors)
    }
    const base = readFileSync(join(here, '../styles/base.css'), 'utf8')
    expect
      .soft(
        /\n {2}h1 \{\n {4}font-size: var\(--fs-title\);\n {2}\}\n/.test(base),
        '(g5) h1: --fs-title',
      )
      .toBe(true)
    const tokens = readFileSync(join(here, '../styles/tokens.css'), 'utf8')
    const rem = (name: string): number =>
      Number(new RegExp(`\\n {4}${name}: calc\\(([0-9.]+)rem `).exec(tokens)?.[1] ?? Number.NaN)
    const sizes = ['--fs-title', '--fs-story', '--fs-body'].map(rem)
    expect
      .soft(
        sizes.every((size, i) => Number.isFinite(size) && (i === 0 || (sizes[i - 1] ?? 0) > size)),
        `(g5) the token sizes run down (${sizes.join(' > ')} rem)`,
      )
      .toBe(true)
    // Every h2 of Home is a direct child of a .section, so the rule reaches each one.
    const html = render(
      createElement(HomeShelf, {
        locale: 'en',
        strings: shelfStrings('en'),
        stories: fixtures.map((pkg) => cardFor(pkg, 'en')),
        featured: { storyId: 'two-paths', locales: ['en', 'hi'] },
      }),
    )
    const sectioned = all(html, /<section\b([^>]*)><h2\b/g).map((m) => m[1] ?? '')
    expect(startTags(html, 'h2'), 'precondition: Continue, Featured and All stories').toHaveLength(
      3,
    )
    expect
      .soft(
        sectioned.map((attrs) => classesOf(`<section${attrs}>`).includes(styles.section ?? '?')),
        '(g5) every h2 is the first child of a .section',
      )
      .toEqual([true, true, true])
  })

  it('(g4, A11Y-12a-4) taps on a card or the Continue card never wait for a double-tap zoom', () => {
    expect
      .soft(ruleBody(css, '.card'), '(g4) the card')
      .toMatch(/(^|\n) {2}touch-action: manipulation;\n/)
    expect
      .soft(ruleBody(css, '.continueCard'), '(g4) the Continue card')
      .toMatch(/(^|\n) {2}touch-action: manipulation;\n/)
  })

  it('(g3) the card shows the focus ring while its link has keyboard focus', () => {
    const ring = ruleBody(css, '.card:has(a:focus-visible)')
    expect
      .soft(ring, '(g3) the ring rule')
      .toContain('  outline: var(--focus-width) solid var(--color-focus);\n')
  })
})

// The g5 size reader is guard code (process-v2 test-writing patterns; guard-bypass catalogue,
// built-output class 5: fail closed on input it cannot read). Each bypass form R2-TPP-1 named, and
// the near misses that must not count, against a base that pins .title at --fs-body.
describe('the T12-13 g5 size reader: bypass forms and near misses (R2-TPP-1)', () => {
  const BASE = '.title {\n  font-size: var(--fs-body);\n}\n'
  const problemsOf = (css: string): string[] => {
    const declarations = cssDeclarations(css)
    return [
      ...sizeProblems(declarations, '.title', 'var(--fs-body)'),
      ...sizingSelectors(declarations, CARD_TITLE)
        .filter((selector) => selector !== '.title')
        .map((selector) => `another selector sizes it: ${selector}`),
    ]
  }

  it.each([
    ['a later duplicate rule', `${BASE}.title {\n  font-size: var(--fs-label);\n}\n`],
    [
      'an @media block',
      `${BASE}@media (min-width: 1px) {\n  .title {\n    font-size: var(--fs-label);\n  }\n}\n`,
    ],
    [
      'an @supports block inside @media',
      `${BASE}@media screen { @supports (display: grid) { .title { font-size: var(--fs-label) } } }`,
    ],
    ['a selector list', `${BASE}.x, .title { font-size: var(--fs-label) }`],
    ['a selector list inside :is()', `${BASE}:is(.x, .title) { font-size: var(--fs-label) }`],
    ['the font shorthand', `${BASE}.title { font: 700 1rem/1.2 serif }`],
    ['a minified rule', `${BASE}.title{font-size:var(--fs-label)}`],
    ['a more specific selector', `${BASE}.card .title { font-size: var(--fs-label) }`],
    ['an element-qualified class', `${BASE}h3.title { font-size: var(--fs-label) }`],
    ['an earlier !important', `.title { font-size: var(--fs-label) !important }\n${BASE}`],
    ['no rule at all', '.x {\n  font-size: var(--fs-body);\n}\n'],
    // The round 2b audit (PA-1): the title is an h3 holding its link, so an element selector or the
    // link's own class or element sizes it too.
    ['a bare h3', `${BASE}h3 { font-size: var(--fs-label) }`],
    ['an h3 in the card', `${BASE}.card h3 { font-size: var(--fs-label) }`],
    ['an h3 child of the card', `${BASE}.card > h3 { font-size: var(--fs-label) }`],
    ['an h3 inside :is()', `${BASE}:is(.x, h3) { font-size: var(--fs-label) }`],
    [
      'an h3 in an @media block',
      `${BASE}@media (min-width: 1px) { .card h3 { font: 1rem serif } }`,
    ],
    ["the title link's class", `${BASE}.link { font-size: var(--fs-label) }`],
    ["the title link's element", `${BASE}.card a { font-size: var(--fs-label) }`],
  ])('(g5) %s is reported', (_name, sample) => {
    expect(problemsOf(sample), sample).not.toEqual([])
  })

  it.each([
    ['the base alone', BASE],
    [
      'an earlier rule that the later one overrides',
      `.title { font-size: var(--fs-label) }\n${BASE}`,
    ],
    ['a commented-out override', `${BASE}/* .title { font-size: var(--fs-label) } */\n`],
    [
      'near-miss class names',
      `${BASE}.titleRow { font-size: var(--fs-label) }\n.subtitle { font-size: var(--fs-label) }\n.title-x { font-size: var(--fs-label) }\n`,
    ],
    ['braces and a semicolon inside a string', `.x::after { content: '}{;'; }\n${BASE}`],
    [
      'an @media block that agrees',
      `${BASE}@media (min-width: 1px) { .title { font-size: var(--fs-body) } }`,
    ],
    ['another property of .title', `${BASE}.title { line-height: 1.2 }`],
    [
      'a selector list that sets the right size',
      '.x,\n.title {\n  font-size: var(--fs-body);\n}\n',
    ],
    [
      'near-miss h3, a and link names',
      `${BASE}.h3, [data-h3], .th3, .h3x, h2, h4 { font-size: var(--fs-label) }\n.area, abbr, .linkRow, .link-x, .continueLink { font-size: var(--fs-label) }\n`,
    ],
    ['an h3 rule that sets no size', `${BASE}.card h3 { margin-block: 0 }`],
  ])('(g5) %s is not reported', (_name, sample) => {
    expect(problemsOf(sample), sample).toEqual([])
  })

  it.each([
    [
      'a style rule nested in a style rule (CSS nesting)',
      `.card {\n  .title {\n    font-size: var(--fs-label);\n  }\n}\n`,
    ],
    ['an unbalanced closing brace', `${BASE}}\n`],
    ['an unclosed block', '.title {\n  font-size: var(--fs-body);\n'],
    ['an unterminated comment', `${BASE}/* `],
    ['an unterminated string', `.x::after { content: '; }\n${BASE}`],
  ])('(g5) %s fails closed (the reader throws)', (_name, sample) => {
    expect(() => cssDeclarations(sample), sample).toThrow(/css reader/)
  })
})

// The g2 reader (stretchedLinkProblems, on cssDeclarations) is guard code as well (the round 2b
// audit, design §21; built-output class 5 is the shared reader's, whose fail-closed samples are
// above): each form that could move or clip the card's box or change its link's ::after unseen, and
// the near misses that must not count, against a base holding today's .card and .card a::after.
describe('the T12-13 g2 stretched-link reader: bypass forms and near misses (round 2b audit)', () => {
  const BASE = [
    '.card {',
    '  --card-border: 2px;',
    '  --card-bar: 4px;',
    '  position: relative;',
    '  border: var(--card-border) solid var(--color-line-strong);',
    '  border-block-start: var(--card-bar) solid var(--story-color);',
    '  border-radius: var(--radius-control);',
    '}',
    '.card a::after {',
    "  content: '';",
    '  position: absolute;',
    '  inset-block-start: calc(-1 * var(--card-bar));',
    '  inset-block-end: calc(-1 * var(--card-border));',
    '  inset-inline: calc(-1 * var(--card-border));',
    '  border-radius: var(--radius-control);',
    '}',
    '',
  ].join('\n')
  const problemsOf = (css: string): string[] =>
    Object.values(stretchedLinkProblems(cssDeclarations(css), '.card', '.card a::after')).flat()

  it.each([
    ['a later duplicate rule', `${BASE}.card a::after {\n  inset-block-start: 0;\n}\n`],
    [
      'an @media block',
      `${BASE}@media (min-width: 1px) {\n  .card a::after {\n    inset-inline: 0;\n  }\n}\n`,
    ],
    ['the inset shorthand', `${BASE}.card a::after { inset: 0 }`],
    ['a physical twin (top)', `${BASE}.card a::after { top: 0 }`],
    ['an inline longhand', `${BASE}.card a::after { inset-inline-start: 0 }`],
    ['a radius longhand', `${BASE}.card a::after { border-start-start-radius: 0 }`],
    ['an earlier !important', `.card a::after { inset-block-end: 0 !important }\n${BASE}`],
    ['a selector list', `${BASE}.x, .card a::after { inset-block-start: 0 }`],
    ['a minified rule', `${BASE}.card a::after{inset-inline:0}`],
    ['another box property (transform)', `${BASE}.card a::after { transform: scale(0.5) }`],
    ['the ::after lets taps through', `${BASE}.card a::after { pointer-events: none }`],
    ["another selector on the link's ::after", `${BASE}.link::after { inset: 0 }`],
    ['a single-colon :after', `${BASE}.card a:after { inset: 0 }`],
    ['a later position on the card', `${BASE}.card { position: static }`],
    ['an overflow clip on the card', `${BASE}.card { overflow: hidden }`],
    [
      'an overflow clip in an @media block',
      `${BASE}@media (hover: hover) { .card { overflow-y: clip } }`,
    ],
    ["an overflow clip on the card's element", `${BASE}.list > li { overflow: hidden }`],
    ['the universal selector', `${BASE}.list > * { overflow: hidden }`],
    ['a state selector that moves the card', `${BASE}.card:hover { position: static }`],
    ['a later border width', `${BASE}.card { border-width: 0 }`],
    ['a later bar width', `${BASE}.card { --card-bar: 0 }`],
    ['a later card radius longhand', `${BASE}.card { border-top-left-radius: 0 }`],
    ['no ::after rule', BASE.slice(0, BASE.indexOf('.card a::after'))],
  ])('(g2) %s is reported', (_name, sample) => {
    expect(problemsOf(sample), sample).not.toEqual([])
  })

  it.each([
    ['the base alone', BASE],
    ['an earlier shorthand that the base overrides', `.card a::after { inset: 0 }\n${BASE}`],
    ['a commented-out override', `${BASE}/* .card a::after { inset: 0 } */\n`],
    ['another pseudo-element', `${BASE}.card a::before { inset: 0 }`],
    ['a paint-only property on the ::after', `${BASE}.card a::after { background-color: red }`],
    [
      'paint-only states of the card',
      `${BASE}.card:hover { background-color: red }\n.card:has(a:focus-visible) { outline: 2px solid }\n`,
    ],
    [
      'near-miss class and element names',
      `${BASE}.cardRow { overflow: hidden }\n.card-x { position: static }\n.cards { overflow: clip }\n.lid { overflow: hidden }\n`,
    ],
    [
      'an @media block that agrees',
      `${BASE}@media (min-width: 1px) { .card a::after { inset-inline: calc(-1 * var(--card-border)) } }`,
    ],
    ['braces and a semicolon inside a string', `.x::before { content: '}{;' }\n${BASE}`],
  ])('(g2) %s is not reported', (_name, sample) => {
    expect(problemsOf(sample), sample).toEqual([])
  })
})
