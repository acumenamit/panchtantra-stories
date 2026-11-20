// The navigation hold (P1 Step 12, design p1-step12-design.md §3.13 N14, §4.6; test plan T12-6).
// holdNavigation(doc) sets data-nav-hold on the document element and (re)starts one module timer
// that removes it NAV_HOLD_MS = 500 ms after the last call; base.css then turns pointer events off
// on body. An injected fake document and Vitest's fake timers stand in for the browser.
// g5 is a guard (guard-bypass catalogue, process-v2 "reader code inside a test is guard code"):
// base.css holds exactly one pointer-events declaration, `none`, in the rule `:root[data-nav-hold]
// body`, and no other stylesheet under src/ or app/ and no script under src/ui or src/reader sets
// it. The CSS reader strips comments, resolves escapes, case-folds the property and reads at-rule
// blocks, nested rules and :global(…) bodies; the script reader strips comments and looks for both
// spellings in every script extension. Each negative sample below is one bypass class; the pass
// samples are comments that name the property. Documented limit: a name assembled at run time.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdNavigation, NAV_HOLD_ATTRIBUTE, NAV_HOLD_MS, type HoldDocument } from './nav-hold'

const storyboard = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const toPosix = (path: string): string => path.split(sep).join('/')

/**
 * A fake document whose html and body elements record every attribute call, and whose focused
 * element (and html and body) record every blur and focus call (design §5 item 4).
 */
function fakeDocument() {
  const calls: string[] = []
  const focusCalls: string[] = []
  const attributes = new Map<string, string>()
  const focusable = (name: string) => ({
    blur() {
      focusCalls.push(`${name} blur`)
    },
    focus() {
      focusCalls.push(`${name} focus`)
    },
  })
  const recorder = (name: 'html' | 'body') => ({
    ...focusable(name),
    setAttribute(attribute: string, value: string) {
      calls.push(`${name === 'html' ? '' : 'body '}set ${attribute}`)
      if (name === 'html') attributes.set(attribute, value)
    },
    removeAttribute(attribute: string) {
      calls.push(`${name === 'html' ? '' : 'body '}remove ${attribute}`)
      if (name === 'html') attributes.delete(attribute)
    },
  })
  const doc: HoldDocument & { readonly body: unknown; readonly activeElement: unknown } = {
    documentElement: recorder('html'),
    body: recorder('body'),
    activeElement: focusable('activeElement'),
  }
  return { doc, calls, focusCalls, held: () => attributes.has('data-nav-hold') }
}

describe('holdNavigation (T12-6 g1 to g4)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('(g1) sets the attribute on the document element at the call', () => {
    const fake = fakeDocument()
    holdNavigation(fake.doc)
    expect.soft(fake.calls, '(g1) one set on documentElement').toEqual(['set data-nav-hold'])
    expect.soft(fake.held(), '(g1) held').toBe(true)
  })

  it('(g2) holds for 500 ms: present at 499, absent at 500', () => {
    const fake = fakeDocument()
    holdNavigation(fake.doc)
    vi.advanceTimersByTime(499)
    expect.soft(fake.held(), '(g2) present at 499 ms').toBe(true)
    vi.advanceTimersByTime(1)
    expect.soft(fake.held(), '(g2) absent at 500 ms').toBe(false)
  })

  it('(g3) a second call at 300 ms moves the end: present at 799, absent at 800', () => {
    const fake = fakeDocument()
    holdNavigation(fake.doc)
    vi.advanceTimersByTime(300)
    holdNavigation(fake.doc)
    vi.advanceTimersByTime(499)
    expect.soft(fake.held(), '(g3) present at 799 ms').toBe(true)
    vi.advanceTimersByTime(1)
    expect.soft(fake.held(), '(g3) absent at 800 ms').toBe(false)
    expect
      .soft(fake.calls, '(g3) one removal')
      .toEqual(['set data-nav-hold', 'set data-nav-hold', 'remove data-nav-hold'])
  })

  it('(g6) never touches focus, during the hold or at its end (design §5 item 4; review TEST-12a-6)', () => {
    const fake = fakeDocument()
    holdNavigation(fake.doc)
    expect.soft(fake.focusCalls, '(g6) no blur or focus at the call').toEqual([])
    vi.advanceTimersByTime(NAV_HOLD_MS)
    expect.soft(fake.focusCalls, '(g6) no blur or focus at the release').toEqual([])
    expect
      .soft(fake.calls, '(g6) only the attribute, set then removed')
      .toEqual(['set data-nav-hold', 'remove data-nav-hold'])
  })

  it('(g4) the attribute name and the duration', () => {
    expect.soft(NAV_HOLD_ATTRIBUTE, '(g4) NAV_HOLD_ATTRIBUTE').toBe('data-nav-hold')
    expect.soft(NAV_HOLD_MS, '(g4) NAV_HOLD_MS').toBe(500)
  })
})

// ---- g5: the pointer-events guard ----

const BASE_CSS = 'src/ui/styles/base.css'
const HOLD_SELECTOR = ':root[data-nav-hold] body'
const SCRIPT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

/** One declaration and the block preludes around it, outermost first. */
interface Declaration {
  readonly selectors: readonly string[]
  readonly property: string
  readonly value: string
}

/** Comments blanked, then CSS escapes resolved (`pointer\-events`, `\70 ointer-events`). */
function cssCode(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?|\\([^\n0-9a-fA-F])/g, (_m, hex?: string, ch?: string) =>
      hex === undefined ? (ch ?? '') : String.fromCodePoint(Number.parseInt(hex, 16)),
    )
}

/**
 * Every declaration of a stylesheet, in every block: style rules, at-rule blocks (@layer, @media,
 * @supports), nested rules and :global(…) bodies. The property is case-folded.
 */
function cssDeclarations(text: string): Declaration[] {
  const found: Declaration[] = []
  const stack: string[] = []
  let buffer = ''
  for (const ch of cssCode(text)) {
    if (ch === '{') {
      stack.push(buffer.trim().replace(/\s+/g, ' '))
      buffer = ''
    } else if (ch === ';' || ch === '}') {
      const text = buffer.trim()
      const colon = text.indexOf(':')
      if (colon > 0 && stack.length > 0) {
        found.push({
          selectors: [...stack],
          property: text.slice(0, colon).trim().toLowerCase(),
          value: text.slice(colon + 1).trim(),
        })
      }
      buffer = ''
      if (ch === '}') stack.pop()
    } else {
      buffer += ch
    }
  }
  return found
}

/** A script's code with its comments removed (a URL's // ends the line early: a false pass only). */
const scriptCode = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

interface PointerEventsReport {
  /** The allowed declarations: base.css, `:root[data-nav-hold] body`, `none`. */
  readonly allowed: number
  /** Every other place that sets or names pointer events. */
  readonly offenders: readonly string[]
}

/** The guard over a map of repo path → text (stylesheets and scripts). */
function pointerEventsReport(files: ReadonlyMap<string, string>): PointerEventsReport {
  let allowed = 0
  const offenders: string[] = []
  for (const [path, text] of files) {
    if (path.endsWith('.css')) {
      for (const d of cssDeclarations(text)) {
        if (d.property !== 'pointer-events') continue
        const inner = d.selectors.at(-1)
        if (path === BASE_CSS && inner === HOLD_SELECTOR && d.value === 'none') allowed++
        else offenders.push(`${path}: ${d.selectors.join(' > ')} sets pointer-events: ${d.value}`)
      }
    } else if (SCRIPT.test(path) && !path.endsWith('.test.ts')) {
      if (/pointer-?events/i.test(scriptCode(text))) offenders.push(`${path}: names pointer events`)
    }
  }
  return { allowed, offenders }
}

/** Every file under `dir` (relative to the storyboard root) whose name passes `keep`. */
function walk(dir: string, keep: (name: string) => boolean): string[] {
  const found: string[] = []
  const visit = (absolute: string): void => {
    if (!existsSync(absolute)) return
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && keep(entry.name)) found.push(toPosix(relative(storyboard, path)))
    }
  }
  visit(join(storyboard, dir))
  return found.sort()
}

const readAll = (paths: readonly string[]): Map<string, string> =>
  new Map(paths.map((path) => [path, readFileSync(join(storyboard, path), 'utf8')]))

const BASE_RULE = `@layer base {\n  ${HOLD_SELECTOR} {\n    pointer-events: none;\n  }\n}\n`

describe('the pointer-events guard (T12-6 g5)', () => {
  it('reads the real tree: base.css holds the one hold rule, nothing else sets pointer events', () => {
    const css = [
      ...walk('src', (n) => n.endsWith('.css')),
      ...walk('app', (n) => n.endsWith('.css')),
    ]
    const scripts = [
      ...walk('src/ui', (n) => SCRIPT.test(n) && !n.endsWith('.test.ts')),
      ...walk('src/reader', (n) => SCRIPT.test(n) && !n.endsWith('.test.ts')),
    ]
    console.info(`[T12-6 g5] stylesheets read: ${css.length}; scripts read: ${scripts.length}`)
    expect(css.length, 'precondition: at least 10 stylesheets').toBeGreaterThanOrEqual(10)
    expect(scripts.length, 'precondition: at least 50 scripts').toBeGreaterThanOrEqual(50)
    expect(css, 'precondition: base.css is read').toContain(BASE_CSS)
    const report = pointerEventsReport(readAll([...css, ...scripts]))
    expect
      .soft(report.allowed, '(g5) base.css: exactly one `:root[data-nav-hold] body` rule')
      .toBe(1)
    expect.soft(report.offenders, '(g5) no other pointer-events').toEqual([])
    const base = cssDeclarations(readFileSync(join(storyboard, BASE_CSS), 'utf8')).filter(
      (d) => d.property === 'pointer-events',
    )
    expect.soft(base, '(g5) base.css: one pointer-events declaration').toHaveLength(1)
  })

  it('passes the hold rule and comments that name the property', () => {
    const files = new Map([
      [BASE_CSS, BASE_RULE],
      ['src/ui/x/note.module.css', '.x {\n  /* old; pointer-events: none; */\n  color: red;\n}\n'],
      ['src/ui/x/note.ts', '// pointer-events stay on outside the hold\nexport const n = 1\n'],
      ['src/ui/x/block.tsx', '/* pointerEvents is never set */\nexport const b = 2\n'],
    ])
    expect(pointerEventsReport(files)).toEqual({ allowed: 1, offenders: [] })
  })

  it.each([
    ['upper case', 'src/ui/x/upper.module.css', '.x {\n  POINTER-EVENTS: none;\n}\n'],
    ['an escaped name', 'src/ui/x/escaped.module.css', '.x {\n  pointer\\-events: none;\n}\n'],
    [
      'a :global(…) body',
      'src/ui/x/global.module.css',
      ':global(.x) {\n  pointer-events: none;\n}\n',
    ],
    [
      'a nested rule',
      'src/ui/x/nested.module.css',
      '.x {\n  color: red;\n  & .y {\n    pointer-events: none;\n  }\n}\n',
    ],
    [
      'an @supports block',
      'src/ui/x/supports.module.css',
      '@supports (display: grid) {\n  .x {\n    pointer-events: none;\n  }\n}\n',
    ],
    ['a .tsx string', 'src/ui/x/widget.tsx', "export const s = { 'pointerEvents': 'none' }\n"],
    ['a .mts file', 'src/reader/x/late.mts', "export const p = 'pointer-events'\n"],
    ['a .cjs file', 'src/reader/x/old.cjs', "module.exports = { p: 'pointer-events' }\n"],
    ['under app/', 'app/x.module.css', '.x {\n  pointer-events: auto;\n}\n'],
  ])('fails %s', (name, path, text) => {
    const report = pointerEventsReport(
      new Map([
        [BASE_CSS, BASE_RULE],
        [path, text],
      ]),
    )
    expect.soft(report.offenders, `(g5) ${name}`).toHaveLength(1)
    expect.soft(report.offenders[0] ?? '', `(g5) ${name} names its file`).toContain(path)
    expect.soft(report.allowed, `(g5) ${name}: the hold rule still counts`).toBe(1)
  })

  it.each([
    ['another selector in base.css', `${HOLD_SELECTOR.replace('body', 'main')}`, 'none'],
    ['another value', HOLD_SELECTOR, 'auto'],
  ])('does not count the hold rule with %s', (_name, selector, value) => {
    const css = `@layer base {\n  ${selector} {\n    pointer-events: ${value};\n  }\n}\n`
    const report = pointerEventsReport(new Map([[BASE_CSS, css]]))
    expect(report.allowed).toBe(0)
    expect(report.offenders).toHaveLength(1)
  })
})
