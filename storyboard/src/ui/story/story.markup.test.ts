// The story landing's action row (P1 Step 12; design p1-step12-design.md §3.8 N9, §3.9 N10, §3.10
// N11, §3.11 N12, §3.5 N6, §4.5, §4.6, §4.11; test plan T12-15, T12-16). The exported view renders
// each state from props (13.11 item 5d):
// - pending and start: Start shown, Continue and Start again hidden in their reserved cells;
//   continue: Continue and Start again shown, Start hidden;
// - Start, Continue and How this story was made go through HeldLink (the navigation hold); Start
//   again is a plain button (its handler holds); How made links to the Grown-ups section, same tab;
//   the Share row follows it and holds ShareControl's button;
// - holdOnShare holds for a click inside the Share button only (S12-CRIT-2);
// - actionsStateOf maps the stored entry to start or continue;
// - round 1b (§16 F1, H-12c) and round 2b (§19): Continue, and Start in every state, set the
//   player's saved-run hint in their onNavigate (Start after the read too: another tab's run, N8);
// - story.module.css read as text: the stacked primary cell and the reserved Start again slot,
//   hidden by visibility, never display: none.
// HeldLink is a recording mock (a plain <a data-held>), and the hold module a spy.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { held } = vi.hoisted(() => ({ held: [] as Record<string, unknown>[] }))

vi.mock('../shell/held-link', async () => {
  const { createElement: h } = await import('react')
  function RecordingHeldLink(props: Record<string, unknown>) {
    held.push(props)
    const { href, children, ...rest } = props
    // next/link reads these two itself; they never reach the <a>.
    delete rest.prefetch
    delete rest.onNavigate
    return h('a', { 'data-held': '', href, ...rest }, children as never)
  }
  return { HeldLink: RecordingHeldLink }
})

vi.mock('../shell/nav-hold', () => ({ holdNavigation: vi.fn() }))

import twoPaths from '../../../fixtures/packages/two-paths.json'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { holdNavigation } from '../shell/nav-hold'
import styles from './story.module.css'
import { actionsStateOf, holdOnShare, StoryActionsView, type ActionsState } from './story-actions'
import { storyStrings } from './strings'

const here = dirname(fileURLToPath(import.meta.url))
const storyCss = (): string => readFileSync(join(here, 'story.module.css'), 'utf8')
const pkg = StoryPackageV1.parse(twoPaths)

const all = (html: string, pattern: RegExp): RegExpMatchArray[] => [...html.matchAll(pattern)]
const startTags = (html: string, element: string): string[] =>
  all(html, new RegExp(`<${element}\\b[^>]*>`, 'g')).map((m) => m[0])
const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
const classesOf = (tag: string): string[] => (attr(tag, 'class') ?? '').split(' ').filter(Boolean)
const hidden = (tag: string): boolean =>
  attr(tag, 'aria-hidden') === 'true' && classesOf(tag).includes(styles.hidden ?? '?')
const shown = (tag: string): boolean =>
  attr(tag, 'aria-hidden') === undefined && !classesOf(tag).includes(styles.hidden ?? '?')

function view(state: ActionsState, code: LocaleCode = 'en'): string {
  const strings = storyStrings(code, pkg)
  return renderToString(
    createElement(StoryActionsView, {
      state,
      storyId: pkg.storyId,
      locale: code,
      title: strings.title,
      howMadeHref: strings.howMadeHref,
      strings: strings.actions,
      onStartAgain: () => {},
    }),
  )
}

const tagWith = (html: string, element: string, hook: string): string =>
  startTags(html, element).find((t) => new RegExp(`\\s${hook}`).test(t)) ?? ''

beforeEach(() => {
  held.length = 0
  vi.mocked(holdNavigation).mockClear()
})

describe('the action row by state (T12-15 g1, A3)', () => {
  it.each(ENABLED_LOCALE_CODES)(
    '%s: pending and start show Start only; Start again stays reserved',
    (code) => {
      for (const state of ['pending', 'start'] as const) {
        const html = view(state, code)
        expect
          .soft(attr(tagWith(html, 'div', 'data-actions=""'), 'data-shown'), `(g1) ${state}`)
          .toBe(state)
        const start = tagWith(html, 'a', 'data-story-action="start"')
        const cont = tagWith(html, 'a', 'data-story-action="continue"')
        const again = tagWith(html, 'button', 'data-start-again=""')
        expect.soft(shown(start), `(g1) ${state}: Start shown`).toBe(true)
        expect
          .soft(attr(start, 'href'), `(g1) ${state}: Start to the player`)
          .toBe(`/${code}/stories/two-paths/read`)
        expect.soft(hidden(cont), `(g1) ${state}: Continue hidden`).toBe(true)
        expect.soft(again, `(g1) ${state}: the Start again slot rendered`).not.toBe('')
        expect.soft(hidden(again), `(g1) ${state}: Start again hidden`).toBe(true)
      }
    },
  )

  it.each(ENABLED_LOCALE_CODES)(
    '%s: continue shows Continue and Start again, hides Start',
    (code) => {
      const html = view('continue', code)
      const strings = storyStrings(code, pkg).actions
      expect
        .soft(attr(tagWith(html, 'div', 'data-actions=""'), 'data-shown'), '(g1) continue')
        .toBe('continue')
      const start = tagWith(html, 'a', 'data-story-action="start"')
      const cont = tagWith(html, 'a', 'data-story-action="continue"')
      const again = tagWith(html, 'button', 'data-start-again=""')
      expect.soft(hidden(start), '(g1) continue: Start hidden').toBe(true)
      expect.soft(shown(cont), '(g1) continue: Continue shown').toBe(true)
      expect
        .soft(attr(cont, 'href'), '(g1) Continue to the player')
        .toBe(`/${code}/stories/two-paths/read`)
      expect.soft(shown(again), '(g1) continue: Start again shown').toBe(true)
      expect.soft(html, '(g1) the labels').toContain(`>${strings.continue}</span>`)
      expect.soft(html, '(g1) the Start again label').toContain(`>${strings.startAgain}</span>`)
    },
  )
})

describe('the links and the Share row (T12-15 g2, g3; A5, A6)', () => {
  it('(g2) Start, Continue and How made go through HeldLink; Start again is a button', () => {
    const html = view('continue')
    const hrefs = held.map((p) => [p['data-story-action'] ?? p['data-how-made'], p.href])
    expect.soft(hrefs, '(g2) the held links').toEqual([
      ['start', '/en/stories/two-paths/read'],
      ['continue', '/en/stories/two-paths/read'],
      ['', '/en/grown-ups#how-stories-are-made'],
    ])
    const again = tagWith(html, 'button', 'data-start-again=""')
    expect.soft(attr(again, 'type'), '(g2) Start again is a button').toBe('button')
    for (const a of startTags(html, 'a'))
      expect.soft(a, '(g2) every link is held').toMatch(/\sdata-held=""/)
  })

  it.each(ENABLED_LOCALE_CODES)(
    '(g3) %s: How made after the actions, then the Share row with its button',
    (code) => {
      const html = view('start', code)
      const actionsEnd = html.indexOf('</div>', html.lastIndexOf('data-start-again'))
      const how = tagWith(html, 'a', 'data-how-made=""')
      expect
        .soft(attr(how, 'href'), '(g3) How made href')
        .toBe(`/${code}/grown-ups#how-stories-are-made`)
      expect.soft(attr(how, 'target'), '(g3) same tab').toBeUndefined()
      expect.soft(html.indexOf(how), '(g3) How made after the actions').toBeGreaterThan(actionsEnd)
      const row = tagWith(html, 'div', 'data-share-row=""')
      expect
        .soft(html.indexOf(row), '(g3) the Share row after How made')
        .toBeGreaterThan(html.indexOf(how))
      const inRow = html.slice(html.indexOf(row))
      expect
        .soft(tagWith(inRow, 'button', 'data-share=""'), '(g3) the Share button in the row')
        .not.toBe('')
      expect
        .soft(html, '(g3) How made text')
        .toContain(`>${storyStrings(code, pkg).actions.howMade}<`)
    },
  )
})

// Round 1b (design §16 F1, H-12c; SPEC:468, E11) and round 2b (§19): every held link into the player
// sets the player's saved-run hint in its onNavigate, before the soft navigation; Start does so
// after the read too, since a run another tab saved after it (N8) still resumes. The global
// document is a recorder (Vitest's node environment has none); the recorded HeldLink props give
// each link's onNavigate, called here as Link would call it.
describe('the saved-run hint before a soft navigation into the player (T12-15 g6, F1)', () => {
  const set: string[][] = []
  beforeEach(() => {
    set.length = 0
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (name: string, value: string) => void set.push([name, value]),
        removeAttribute: () => undefined,
      },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Renders the view in `state`, then calls the `hook` link's onNavigate; the attributes set. */
  const navigate = (state: ActionsState, hook: 'start' | 'continue'): string[][] => {
    held.length = 0
    view(state)
    const link = held.find((p) => p['data-story-action'] === hook)
    expect(link, `precondition: the ${hook} link went through HeldLink (${state})`).toBeDefined()
    set.length = 0
    const onNavigate = link?.onNavigate as
      ((event: { preventDefault: () => void }) => void) | undefined
    onNavigate?.({ preventDefault: () => undefined })
    return [...set]
  }

  it('(g6) Continue (a saved run is known) sets html[data-saved-run]', () => {
    expect
      .soft(navigate('continue', 'continue'), '(g6) Continue sets the saved-run hint')
      .toEqual([['data-saved-run', '']])
  })

  it('(g6) Start while the actions are pending (a saved run may resume) sets it', () => {
    expect
      .soft(navigate('pending', 'start'), '(g6) Start while pending sets the saved-run hint')
      .toEqual([['data-saved-run', '']])
  })

  it('(g6) Start after the read with no saved run sets it too (another tab may have saved one)', () => {
    expect
      .soft(navigate('start', 'start'), '(g6) Start in the ready state (no saved run) sets it')
      .toEqual([['data-saved-run', '']])
  })
})

/** A small DOM stand-in: tag, attributes, parent, matches and closest for `tag[attr]` selectors. */
class FakeElement {
  constructor(
    readonly tag: string,
    readonly attrs: readonly string[],
    readonly parent: FakeElement | null,
  ) {}
  matches(selector: string): boolean {
    return selector.split(',').some((one) => {
      const m = /^\s*([a-z]*)((?:\[[a-z-]+\])*)\s*$/.exec(one)
      if (m === null) throw new Error(`fake DOM: unsupported selector ${one}`)
      const [, tag = '', attrs = ''] = m
      const wanted = [...attrs.matchAll(/\[([a-z-]+)\]/g)].map((a) => a[1])
      return (tag === '' || tag === this.tag) && wanted.every((a) => this.attrs.includes(a ?? ''))
    })
  }
  closest(selector: string): FakeElement | null {
    return this.matches(selector) ? this : (this.parent?.closest(selector) ?? null)
  }
}

describe('holdOnShare (T12-15 g4, A26, S12-CRIT-2)', () => {
  const row = new FakeElement('div', ['data-share-row'], null)
  const wrapper = new FakeElement('div', [], row)
  const button = new FakeElement('button', ['data-share'], wrapper)
  const label = new FakeElement('span', [], button)
  const status = new FakeElement('span', ['data-share-status'], wrapper)

  it.each([
    ['the Share button', button, 1],
    ['its label', label, 1],
    ['"Link copied."', status, 0],
    ['the row itself', row, 0],
    ['a text node (no closest)', { nodeType: 3 }, 0],
    ['no target', null, 0],
  ] as const)('(g4) a click on %s holds %i time(s)', (_name, target, holds) => {
    holdOnShare({ target })
    expect.soft(vi.mocked(holdNavigation), '(g4) holds').toHaveBeenCalledTimes(holds)
  })
})

describe('actionsStateOf (T12-15 g5)', () => {
  const RUN = { path: ['start', 'c1'], locale: 'en' } as const
  it.each([
    ['no entry', null, 'start'],
    ['a null run, no endings', { activeRun: null, endingsFound: [] }, 'start'],
    ['a null run with endings', { activeRun: null, endingsFound: ['ending_wise'] }, 'start'],
    ['a saved run', { activeRun: RUN, endingsFound: [] }, 'continue'],
    ['a saved run with endings', { activeRun: RUN, endingsFound: ['ending_wise'] }, 'continue'],
  ] as const)('(g5) %s → %s', (_name, entry, state) => {
    expect(actionsStateOf(entry)).toBe(state)
  })
})

/** The body of the rule whose selector list is exactly `selector` (Prettier's form). */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {\n`)
  if (start === -1) return ''
  const open = start + selector.length + 4
  return css.slice(open, css.indexOf('\n}\n', open) + 1)
}

/** Every rule as [selector, body]. */
const rules = (css: string): [string, string][] =>
  all(css.replace(/\/\*[\s\S]*?\*\//g, ''), /(^|\n)([^{}\n][^{}]*?)\s*\{([^{}]*)\}/g).map((m) => [
    (m[2] ?? '').trim(),
    m[3] ?? '',
  ])

describe('story.module.css: reserved cells (T12-16, A3, N6)', () => {
  const css = storyCss()

  it('stacks Start and Continue in one grid cell', () => {
    expect
      .soft(ruleBody(css, '.primary'), 'the primary cell is a grid')
      .toContain('  display: grid;\n')
    expect
      .soft(ruleBody(css, '.primaryVariant'), 'both variants in one area')
      .toContain('  grid-area: 1 / 1;\n')
    const html = view('start')
    for (const hook of ['data-story-action="start"', 'data-story-action="continue"']) {
      expect
        .soft(classesOf(tagWith(html, 'a', hook)), `${hook} stacked`)
        .toContain(styles.primaryVariant)
    }
  })

  it('hides by visibility only: the primary variants and the Start again slot keep their boxes', () => {
    expect.soft(ruleBody(css, '.hidden'), 'the hidden class').toBe('  visibility: hidden;\n')
    const primary = rules(css).filter(([selector]) => /primary|action/i.test(selector))
    const again = rules(css).filter(([selector]) => /again|secondary/i.test(selector))
    expect(primary.length, 'precondition: primary rules read').toBeGreaterThan(0)
    expect(again.length, 'precondition: Start again rules read').toBeGreaterThan(0)
    for (const [selector, body] of primary) {
      expect
        .soft(body, `the primary cell (${selector}): never display: none`)
        .not.toMatch(/display:\s*none/)
    }
    for (const [selector, body] of again) {
      expect
        .soft(body, `the Start again slot (${selector}): never display: none`)
        .not.toMatch(/display:\s*none/)
    }
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect.soft(code, 'no display: none anywhere (comments aside)').not.toMatch(/display:\s*none/)
    expect
      .soft(ruleBody(css, '.againSlot'), 'the slot is a grid cell')
      .toContain('  display: grid;\n')
  })
})
