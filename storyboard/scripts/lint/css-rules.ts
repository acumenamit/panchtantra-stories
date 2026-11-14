// CSS lint rules (spec §6.7 RC-12 logical properties, §6.6 contrast and motion, §10.2 lint; P1-1b,
// owner D5). Pure: lintCss(text, { file, tokens }) returns the findings for one stylesheet, and
// scripts/lint/css-lint.ts is the CLI that `pnpm lint` runs after ESLint. The parser is deliberately
// small (Prettier-formatted CSS; nesting and @import are findings): it blanks comments and strings
// while keeping every offset, reads rule blocks and declarations, splits values at top level so a
// function counts as one value, accepts LF and CRLF, and reports 1-based line and column.
//
// Escape hatch: `/* css-lint-allow <rule-id>: <reason> */` on the line directly above a
// declaration. A missing reason, or an allow that matches nothing, is itself a finding.

export const RULE_IDS = [
  'rc12/physical-property',
  'rc12/physical-keyword',
  'rc12/physical-shorthand',
  'rc12/translate-x',
  'tokens/color-literal',
  'tokens/motion-literal',
  'motion/no-infinite',
  'text/as-stored',
  'tokens/font-family',
  'tokens/unknown-var',
  'css/no-nesting',
  'css/no-import',
] as const

export type RuleId = (typeof RULE_IDS)[number]
export const ALLOW_REASON = 'css-lint/allow-reason'
export const ALLOW_UNUSED = 'css-lint/allow-unused'
export type FindingRule = RuleId | typeof ALLOW_REASON | typeof ALLOW_UNUSED

export interface Finding {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly rule: FindingRule
  readonly message: string
}

export interface LintOptions {
  /** Repo-relative path with forward slashes (absolute for a file outside the repo). */
  readonly file: string
  /** The custom properties declared in src/ui/styles/tokens.css. */
  readonly tokens: ReadonlySet<string>
}

/** The only file that may hold colour and time literals. */
export const TOKENS_FILE = 'src/ui/styles/tokens.css'
/** With tokens.css, the only file that may set font-family (one stack per script). */
export const BASE_FILE = 'src/ui/styles/base.css'
/** Set on <html> by next/font (src/ui/fonts/index.ts), so no stylesheet declares them. */
export const FONT_VARIABLES: ReadonlySet<string> = new Set([
  '--font-lora',
  '--font-devanagari',
  '--font-devanagari-latin',
])

/** CSS named colours (CSS Color 4), without transparent and currentcolor, which are allowed. */
export const NAMED_COLORS: ReadonlySet<string> = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
)

const FOUR_VALUE_SHORTHANDS: ReadonlySet<string> = new Set([
  'margin',
  'padding',
  'inset',
  'scroll-margin',
  'scroll-padding',
  'border-width',
  'border-style',
  'border-color',
])
const GROUP_AT_RULES: ReadonlySet<string> = new Set([
  'media',
  'supports',
  'layer',
  'container',
  'scope',
  'document',
  '-moz-document',
  'starting-style',
])
const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
])

const HEX_COLOR = /#[0-9a-f]{3,8}(?![\w-])/gi
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/gi
const TIME_LITERAL = /(?<![\w.-])[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:ms|s)(?![\w-])/gi
const TRANSLATE_X = /(?<![\w-])translatex\(/gi
const TRANSLATE = /(?<![\w-])translate(?:3d)?\(/gi
const VAR_REFERENCE = /(?<![\w-])var\(\s*(--[^\s,)]+)/gi
const VAR_OPEN = /(?<![\w-])var\(/gi
const WORD = /(?:[\w-]|[^\x00-\x7f])+/g
const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]+|%)?$/i
const ALLOW_PREFIX = /^\s*css-lint-allow(?![\w-])/
const ALLOW_FULL = /^\s*css-lint-allow\s+([^\s:]+)\s*:([\s\S]*)$/

interface Comment {
  readonly start: number
  readonly end: number
  readonly body: string
}

interface Declaration {
  /** Lower case, except a custom property, which is case-sensitive. */
  readonly property: string
  readonly start: number
  /** Comments and strings blanked; the !important flag removed. */
  readonly value: string
  readonly valueStart: number
}

interface Located {
  readonly rule: FindingRule
  readonly offset: number
  readonly message: string
  readonly declaration?: Declaration
}

type Context = 'sheet' | 'style' | 'keyframes'
type Role = 'tokens' | 'base' | 'other'

/** CR LF, CR and FF become LF (CSS Syntax §3.3), and a BOM is dropped, so CRLF keeps every column. */
function normalise(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?|\f/g, '\n')
}

function isIdentChar(c: string): boolean {
  return c !== '' && (/[\w-]/.test(c) || c.charCodeAt(0) > 0x7f)
}

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n'
}

/** Comments and string contents (and unquoted url() contents) become spaces; newlines stay. */
function blank(text: string): { clean: string; comments: Comment[] } {
  const chars = text.split('')
  const comments: Comment[] = []
  const wipe = (from: number, to: number): void => {
    for (let k = from; k < to && k < chars.length; k++) if (chars[k] !== '\n') chars[k] = ' '
  }
  let i = 0
  while (i < text.length) {
    const c = text.charAt(i)
    if (c === '/' && text.charAt(i + 1) === '*') {
      const close = text.indexOf('*/', i + 2)
      const end = close === -1 ? text.length : close + 2
      comments.push({ start: i, end, body: text.slice(i + 2, close === -1 ? text.length : close) })
      wipe(i, end)
      i = end
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < text.length) {
        const d = text.charAt(j)
        if (d === '\\') j += 2
        else if (d === c || d === '\n') break
        else j++
      }
      wipe(i + 1, j)
      i = text.charAt(j) === c ? j + 1 : j
    } else if (c === '\\') {
      i += 2
    } else if (text.slice(i, i + 4).toLowerCase() === 'url(' && !isIdentChar(text.charAt(i - 1))) {
      let j = i + 4
      while (j < text.length && isSpace(text.charAt(j))) j++
      if (text.charAt(j) === '"' || text.charAt(j) === "'") {
        i = j
      } else {
        const close = text.indexOf(')', j)
        const end = close === -1 ? text.length : close
        wipe(j, end)
        i = end
      }
    } else {
      i++
    }
  }
  return { clean: chars.join(''), comments }
}

/** Rule blocks and declarations, plus the nesting and @import findings. */
function parse(clean: string): { declarations: Declaration[]; structural: Located[] } {
  const declarations: Declaration[] = []
  const structural: Located[] = []
  const n = clean.length

  const atRuleName = (prelude: string): string | undefined =>
    /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase()

  const reportImport = (prelude: string, offset: number): void => {
    if (atRuleName(prelude) === 'import') {
      structural.push({
        rule: 'css/no-import',
        offset,
        message: '@import is not allowed; import the stylesheet from TSX',
      })
    }
  }

  const readDeclaration = (start: number, end: number): void => {
    const segment = clean.slice(start, end)
    const colon = segment.indexOf(':')
    if (colon === -1) return
    const name = segment.slice(0, colon).trim()
    if (!/^(?:--[^\s:]+|-?[a-zA-Z_][\w-]*)$/.test(name)) return
    let value = segment.slice(colon + 1)
    const important = /!\s*important\s*$/i.exec(value)
    if (important) value = value.slice(0, important.index)
    declarations.push({
      property: name.startsWith('--') ? name : name.toLowerCase(),
      start,
      value,
      valueStart: start + colon + 1,
    })
  }

  const list = (from: number, context: Context, nested: boolean): number => {
    let i = from
    while (i < n) {
      while (i < n && isSpace(clean.charAt(i))) i++
      if (i >= n) return n
      const segmentStart = i
      let depth = 0
      let j = i
      for (; j < n; j++) {
        const c = clean.charAt(j)
        if (c === '(' || c === '[') depth++
        else if ((c === ')' || c === ']') && depth > 0) depth--
        else if (depth === 0 && (c === ';' || c === '{' || c === '}')) break
      }
      const stop = clean.charAt(j)
      const prelude = clean.slice(segmentStart, j).trim()
      if (stop === '{') {
        reportImport(prelude, segmentStart)
        let inner: Context = 'style'
        if (context === 'style') {
          structural.push({
            rule: 'css/no-nesting',
            offset: segmentStart,
            message: 'CSS nesting is not allowed; write a flat rule',
          })
        } else if (context === 'sheet' && prelude.startsWith('@')) {
          const name = atRuleName(prelude) ?? ''
          if (GROUP_AT_RULES.has(name)) inner = 'sheet'
          else if (name.endsWith('keyframes')) inner = 'keyframes'
        }
        i = list(j + 1, inner, true)
        continue
      }
      if (prelude !== '') {
        if (prelude.startsWith('@')) reportImport(prelude, segmentStart)
        else if (context === 'style') readDeclaration(segmentStart, j)
      }
      if (stop === ';') {
        i = j + 1
      } else if (stop === '}') {
        if (nested) return j + 1
        i = j + 1
      } else {
        return n
      }
    }
    return n
  }

  list(0, 'sheet', false)
  return { declarations, structural }
}

/** The index of the parenthesis that closes the one at `open`, or the end of the text. */
function closingParen(text: string, open: number): number {
  let depth = 0
  for (let k = open; k < text.length; k++) {
    const c = text.charAt(k)
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return k
    }
  }
  return text.length
}

interface Part {
  readonly text: string
  readonly offset: number
}

/** Splits at top level (outside parentheses), so `calc(1px + 2px)` is one part. */
function splitTop(text: string, isSeparator: (c: string) => boolean): Part[] {
  const parts: Part[] = []
  let depth = 0
  let start = -1
  const flush = (end: number): void => {
    if (start !== -1) {
      const raw = text.slice(start, end)
      const trimmed = raw.trim()
      if (trimmed !== '') parts.push({ text: trimmed, offset: start + raw.indexOf(trimmed) })
    }
    start = -1
  }
  for (let k = 0; k < text.length; k++) {
    const c = text.charAt(k)
    if (depth === 0 && isSeparator(c)) {
      flush(k)
      continue
    }
    if (start === -1) start = k
    if (c === '(') depth++
    else if (c === ')' && depth > 0) depth--
  }
  flush(text.length)
  return parts
}

interface Word {
  readonly lower: string
  readonly offset: number
  readonly insideVar: boolean
}

/** Keyword-like words: not numbers, hex digits or function names. */
function keywords(value: string): Word[] {
  const varRanges: [number, number][] = []
  for (const m of value.matchAll(VAR_OPEN)) {
    const open = m.index + m[0].length - 1
    varRanges.push([open, closingParen(value, open)])
  }
  const words: Word[] = []
  for (const m of value.matchAll(WORD)) {
    const text = m[0]
    const offset = m.index
    if (/^[+-]?\.?\d/.test(text)) continue
    if (value.charAt(offset - 1) === '#' || value.charAt(offset + text.length) === '(') continue
    const insideVar = varRanges.some(([open, close]) => offset > open && offset < close)
    words.push({ lower: text.toLowerCase(), offset, insideVar })
  }
  return words
}

function isZero(text: string): boolean {
  const m = NUMBER.exec(text.trim())
  return m !== null && Number(m[1]) === 0
}

function roleOf(file: string): Role {
  const posix = file.replace(/\\/g, '/')
  if (posix === TOKENS_FILE) return 'tokens'
  if (posix === BASE_FILE) return 'base'
  return 'other'
}

function shorthandAdvice(property: string): string {
  if (property.startsWith('border-')) {
    const what = property.slice('border-'.length)
    return `border-block-${what} and border-inline-${what}`
  }
  return `${property}-block and ${property}-inline`
}

function checkDeclaration(
  d: Declaration,
  role: Role,
  declared: (name: string) => boolean,
  report: (rule: RuleId, offset: number, message: string) => void,
): void {
  const custom = d.property.startsWith('--')
  const bare = custom ? d.property : d.property.replace(/^-(?:webkit|moz|ms|o)-/, '')
  const value = d.value
  const at = (offset: number): number => d.valueStart + offset
  const words = keywords(value)
  const trimmed = value.trim().toLowerCase()
  const firstOffset = value.length - value.trimStart().length

  // rc12/physical-property
  if (!custom && d.property.split('-').some((part) => part === 'left' || part === 'right')) {
    report(
      'rc12/physical-property',
      d.start,
      `"${d.property}" is a physical property; use its logical form (inline-start / inline-end)`,
    )
  }

  // rc12/physical-keyword
  for (const w of words) {
    if ((w.lower === 'left' || w.lower === 'right') && !w.insideVar) {
      report(
        'rc12/physical-keyword',
        at(w.offset),
        `"${w.lower}" is a physical keyword; use start / end or a logical property`,
      )
    }
  }

  // rc12/physical-shorthand
  if (!custom && FOUR_VALUE_SHORTHANDS.has(bare)) {
    if (splitTop(value, isSpace).length >= 4) {
      report(
        'rc12/physical-shorthand',
        d.start,
        `4-value "${d.property}" sets left and right apart; use ${shorthandAdvice(bare)}`,
      )
    }
  }
  if (!custom && bare === 'border-radius') {
    const sides = splitTop(value, (c) => c === '/')
    if (sides.some((side) => splitTop(side.text, isSpace).length > 1)) {
      report(
        'rc12/physical-shorthand',
        d.start,
        'multi-value "border-radius" names physical corners; use border-start-start-radius and the other logical corners',
      )
    }
  }

  // rc12/translate-x
  for (const m of value.matchAll(TRANSLATE_X)) {
    report('rc12/translate-x', at(m.index), 'translateX() moves along the physical x axis')
  }
  for (const m of value.matchAll(TRANSLATE)) {
    const open = m.index + m[0].length - 1
    const args = value.slice(open + 1, closingParen(value, open))
    const first = splitTop(args, (c) => c === ',' || isSpace(c))[0]
    if (first !== undefined && !isZero(first.text)) {
      report(
        'rc12/translate-x',
        at(m.index),
        `${m[0]}) with a non-zero x offset moves along the physical x axis`,
      )
    }
  }
  if (!custom && bare === 'translate') {
    const first = splitTop(value, isSpace)[0]
    if (
      first !== undefined &&
      first.text.toLowerCase() !== 'none' &&
      !CSS_WIDE_KEYWORDS.has(first.text.toLowerCase()) &&
      !isZero(first.text)
    ) {
      report(
        'rc12/translate-x',
        at(first.offset),
        '"translate" with a non-zero x offset moves along the physical x axis',
      )
    }
  }

  if (role !== 'tokens') {
    // tokens/color-literal
    for (const m of value.matchAll(HEX_COLOR)) {
      report(
        'tokens/color-literal',
        at(m.index),
        `colour literal "${m[0]}" outside tokens.css; use a --color-* token`,
      )
    }
    for (const m of value.matchAll(COLOR_FUNCTION)) {
      report(
        'tokens/color-literal',
        at(m.index),
        `colour function "${m[0]})" outside tokens.css; use a --color-* token`,
      )
    }
    for (const w of words) {
      if (NAMED_COLORS.has(w.lower)) {
        report(
          'tokens/color-literal',
          at(w.offset),
          `named colour "${w.lower}" outside tokens.css; use a --color-* token`,
        )
      }
    }

    // tokens/motion-literal. A custom property counts too: `--d: 2s` would otherwise carry a
    // duration into `transition: … var(--d)` past the --duration-* tokens (and reduced motion).
    if (custom || bare.startsWith('transition') || bare.startsWith('animation')) {
      for (const m of value.matchAll(TIME_LITERAL)) {
        report(
          'tokens/motion-literal',
          at(m.index),
          `time literal "${m[0]}" outside tokens.css; use a --duration-* token`,
        )
      }
    }
  }

  // motion/no-infinite
  for (const w of words) {
    if (w.lower === 'infinite') {
      report('motion/no-infinite', at(w.offset), 'no infinite animations (spec §6.6 motion)')
    }
  }

  // text/as-stored
  if (!custom) {
    const asStored = (offset: number, what: string): void =>
      report(
        'text/as-stored',
        offset,
        `${what} changes the text as stored; no italics, text-transform, letter-spacing, justify or auto hyphens`,
      )
    if (bare === 'font-style' || bare === 'font') {
      for (const w of words) {
        if (w.lower === 'italic' || w.lower === 'oblique') asStored(at(w.offset), `"${w.lower}"`)
      }
    }
    if (bare === 'text-transform' && trimmed !== 'none') {
      asStored(at(firstOffset), 'text-transform')
    }
    if (bare === 'letter-spacing' && trimmed !== 'normal' && !isZero(trimmed)) {
      asStored(at(firstOffset), 'letter-spacing')
    }
    if (bare === 'text-align' || bare === 'text-align-last') {
      for (const w of words) {
        if (w.lower === 'justify' || w.lower === 'justify-all') asStored(at(w.offset), '"justify"')
      }
    }
    if (bare === 'hyphens') {
      for (const w of words) if (w.lower === 'auto') asStored(at(w.offset), '"hyphens: auto"')
    }
  }

  // tokens/font-family
  if (role === 'other' && (bare === 'font-family' || bare === 'font') && trimmed !== 'inherit') {
    report(
      'tokens/font-family',
      d.start,
      `"${d.property}" may name a font only in tokens.css and base.css (one stack per script); use inherit`,
    )
  }

  // tokens/unknown-var
  for (const m of value.matchAll(VAR_REFERENCE)) {
    const name = m[1] ?? ''
    if (!declared(name)) {
      report(
        'tokens/unknown-var',
        at(m.index + m[0].length - name.length),
        `"${name}" is not declared in tokens.css or in this file`,
      )
    }
  }
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let k = 0; k < text.length; k++) if (text.charAt(k) === '\n') starts.push(k + 1)
  return starts
}

function positionOf(starts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if ((starts[mid] ?? 0) <= offset) low = mid
    else high = mid - 1
  }
  return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 }
}

/** The custom properties a stylesheet declares (used to read the token names from tokens.css). */
export function declaredCustomProperties(text: string): Set<string> {
  const { clean } = blank(normalise(text))
  return new Set(
    parse(clean)
      .declarations.map((d) => d.property)
      .filter((name) => name.startsWith('--')),
  )
}

export function lintCss(text: string, options: LintOptions): Finding[] {
  const source = normalise(text)
  const starts = lineStarts(source)
  const { clean, comments } = blank(source)
  const { declarations, structural } = parse(clean)
  const role = roleOf(options.file)
  const local = new Set(declarations.map((d) => d.property).filter((name) => name.startsWith('--')))
  const declared = (name: string): boolean =>
    options.tokens.has(name) || local.has(name) || FONT_VARIABLES.has(name)

  const located: Located[] = [...structural]
  for (const d of declarations) {
    checkDeclaration(d, role, declared, (rule, offset, message) =>
      located.push({ rule, offset, message, declaration: d }),
    )
  }

  // The escape hatch: a valid allow on the line directly above a declaration suppresses that
  // rule's findings on the declaration; anything else about an allow is itself a finding.
  const allows: { rule: string; line: number; offset: number; used: boolean }[] = []
  for (const comment of comments) {
    if (!ALLOW_PREFIX.test(comment.body)) continue
    const m = ALLOW_FULL.exec(comment.body)
    const rule = m?.[1] ?? ''
    const reason = m?.[2]?.trim() ?? ''
    if (rule === '' || reason === '') {
      located.push({
        rule: ALLOW_REASON,
        offset: comment.start,
        message:
          'css-lint-allow needs a rule id and a reason: /* css-lint-allow <rule-id>: <reason> */',
      })
      continue
    }
    allows.push({
      rule,
      line: positionOf(starts, comment.end - 1).line,
      offset: comment.start,
      used: false,
    })
  }
  const kept = located.filter((finding) => {
    if (finding.declaration === undefined) return true
    const line = positionOf(starts, finding.declaration.start).line
    const allow = allows.find((a) => a.rule === finding.rule && a.line === line - 1)
    if (allow === undefined) return true
    allow.used = true
    return false
  })
  for (const allow of allows) {
    if (!allow.used) {
      kept.push({
        rule: ALLOW_UNUSED,
        offset: allow.offset,
        message: `css-lint-allow ${allow.rule} matches no finding on the declaration directly below`,
      })
    }
  }

  return kept
    .map((finding) => ({
      file: options.file,
      ...positionOf(starts, finding.offset),
      rule: finding.rule,
      message: finding.message,
    }))
    .sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule))
}
