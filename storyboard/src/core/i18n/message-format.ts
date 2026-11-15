// The in-repo ICU MessageFormat subset (P1 D8 L1; design p1-step7-design.md §6.2, §6.6; P1-1c).
// Pure: no framework, no I/O. Every message valid here is also valid ICU, so a later move to an
// ICU library needs no message rewrite.
// - Literal text: anything except { and }. Inside a plural branch, # is the number. The ASCII
//   apostrophe is rejected everywhere (English uses ’ U+2019), so ICU quoting never applies.
// - {name} takes a string or a finite number; {name, number} a finite number;
//   {name, plural, =N {…} zero|one|two|few|many {…} other {…}} a finite number, with `other`
//   required. Branches hold text, {arg}, {arg, number} and #.
// - Rejected when parsed: select, selectordinal, date, time, any other type, number styles, tags
//   (<b>), nested plurals, offset:, unbalanced braces, bad names, empty branches, duplicate
//   selectors.
// - Numbers use Latin digits in every locale (numberingSystem 'latn', design §3.5 D1), so the
//   server's ICU and the browser's agree at hydration.
// - A missing, extra, non-finite or wrong-kind argument throws.

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number]

/** numeric: used in {x, number}, {x, plural, …} or as #. any: only bare {x} (string or number). */
export type ArgKind = 'numeric' | 'any'

export type MessageValues = Readonly<Record<string, string | number>>

export type BranchPart =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'argument'; readonly name: string }
  | { readonly type: 'number'; readonly name: string }
  | { readonly type: 'pound' }

export type MessagePart =
  | Exclude<BranchPart, { readonly type: 'pound' }>
  | {
      readonly type: 'plural'
      readonly name: string
      /** Selectors in source order: "=0", "one", "other" … */
      readonly branches: ReadonlyMap<string, readonly BranchPart[]>
    }

export interface ParsedMessage {
  readonly parts: readonly MessagePart[]
  /** Every argument name with its kind, in order of first use. */
  readonly args: ReadonlyMap<string, ArgKind>
}

export class MessageFormatError extends Error {
  override name = 'MessageFormatError'
}

const NAME = /[A-Za-z][A-Za-z0-9]*/y
const KEYWORD = /[A-Za-z]+/y
const EXACT = /=(0|[1-9][0-9]*)/y
const WHITE_SPACE = new Set([' ', '\t', '\n', '\r'])
/** A rich-text tag such as <b>, </b> or <0>: not in the subset. */
const TAG = /<\/?[A-Za-z0-9]/
const UNSUPPORTED_TYPES = new Set([
  'select',
  'selectordinal',
  'date',
  'time',
  'spellout',
  'ordinal',
])

class Parser {
  private index = 0

  constructor(private readonly source: string) {}

  parse(): MessagePart[] {
    if (this.source.includes("'")) {
      throw new MessageFormatError('the ASCII apostrophe is not allowed; use ’ (U+2019)')
    }
    if (TAG.test(this.source)) throw new MessageFormatError('tags are not supported')
    const parts = this.sequence(false) as MessagePart[]
    if (this.index !== this.source.length) this.fail('unexpected "}"')
    return parts
  }

  private fail(problem: string): never {
    throw new MessageFormatError(`${problem} at offset ${this.index}`)
  }

  private peek(): string | undefined {
    return this.source[this.index]
  }

  private skipWhiteSpace(): void {
    while (WHITE_SPACE.has(this.peek() ?? '')) this.index++
  }

  private match(pattern: RegExp): string | null {
    pattern.lastIndex = this.index
    const found = pattern.exec(this.source)
    if (found === null) return null
    this.index += found[0].length
    return found[0]
  }

  private expect(char: string): void {
    if (this.peek() === undefined) this.fail(`unclosed "{", expected "${char}"`)
    if (this.peek() !== char) this.fail(`expected "${char}"`)
    this.index++
  }

  /** Text and arguments up to the end, or (inside a plural branch) up to its closing "}". */
  private sequence(inBranch: boolean): (MessagePart | BranchPart)[] {
    const parts: (MessagePart | BranchPart)[] = []
    let text = ''
    const flush = (): void => {
      if (text !== '') parts.push({ type: 'text', value: text })
      text = ''
    }
    for (let char = this.peek(); char !== undefined; char = this.peek()) {
      if (char === '}') {
        if (inBranch) break
        this.fail('unbalanced "}"')
      }
      if (char === '{') {
        flush()
        parts.push(this.argument(inBranch))
      } else if (char === '#' && inBranch) {
        flush()
        parts.push({ type: 'pound' })
        this.index++
      } else {
        text += char
        this.index++
      }
    }
    flush()
    return parts
  }

  private argument(inBranch: boolean): MessagePart | BranchPart {
    this.index++ // "{"
    this.skipWhiteSpace()
    const name = this.match(NAME)
    if (name === null) this.fail('bad argument name')
    this.skipWhiteSpace()
    if (this.peek() === '}') {
      this.index++
      return { type: 'argument', name }
    }
    this.expect(',')
    this.skipWhiteSpace()
    const type = this.match(KEYWORD)
    if (type === null) this.fail('missing argument type')
    this.skipWhiteSpace()
    if (type === 'number') {
      if (this.peek() !== '}') this.fail('number styles are not supported')
      this.index++
      return { type: 'number', name }
    }
    if (type === 'plural') {
      if (inBranch) this.fail('nested plurals are not supported')
      this.expect(',')
      return { type: 'plural', name, branches: this.pluralBranches() }
    }
    if (UNSUPPORTED_TYPES.has(type)) this.fail(`"${type}" is not supported`)
    this.fail(`unknown argument type "${type}"`)
  }

  private pluralBranches(): Map<string, BranchPart[]> {
    const branches = new Map<string, BranchPart[]>()
    for (;;) {
      this.skipWhiteSpace()
      const char = this.peek()
      if (char === undefined) this.fail('unclosed plural')
      if (char === '}') {
        this.index++
        break
      }
      if (this.source.startsWith('offset:', this.index)) this.fail('offset: is not supported')
      const selector = char === '=' ? this.match(EXACT) : this.match(KEYWORD)
      if (selector === null) this.fail('bad plural selector')
      if (
        !selector.startsWith('=') &&
        !(PLURAL_CATEGORIES as readonly string[]).includes(selector)
      ) {
        this.fail(`unknown plural category "${selector}"`)
      }
      if (branches.has(selector)) this.fail(`duplicate plural selector "${selector}"`)
      this.skipWhiteSpace()
      this.expect('{')
      const content = this.sequence(true) as BranchPart[]
      this.expect('}')
      if (content.length === 0) this.fail(`empty plural branch "${selector}"`)
      branches.set(selector, content)
    }
    if (!branches.has('other')) this.fail('a plural needs an "other" branch')
    return branches
  }
}

function collectArgs(
  parts: readonly (MessagePart | BranchPart)[],
  args: Map<string, ArgKind>,
): void {
  const note = (name: string, kind: ArgKind): void => {
    if (kind === 'numeric' || !args.has(name)) args.set(name, kind)
  }
  for (const part of parts) {
    if (part.type === 'argument') note(part.name, 'any')
    else if (part.type === 'number') note(part.name, 'numeric')
    else if (part.type === 'plural') {
      note(part.name, 'numeric')
      for (const branch of part.branches.values()) collectArgs(branch, args)
    }
  }
}

/** Parses one message; throws MessageFormatError on anything outside the subset. */
export function parseMessage(source: string): ParsedMessage {
  const parts = new Parser(source).parse()
  const args = new Map<string, ArgKind>()
  collectArgs(parts, args)
  return { parts, args }
}

/** The stricter kind per name over several messages (design §6.6: t() takes the stricter one). */
export function strictestKinds(
  ...messages: readonly ReadonlyMap<string, ArgKind>[]
): Map<string, ArgKind> {
  const merged = new Map<string, ArgKind>()
  for (const args of messages) {
    for (const [name, kind] of args) {
      if (kind === 'numeric' || !merged.has(name)) merged.set(name, kind)
    }
  }
  return merged
}

/** Throws unless values holds exactly the named arguments, each of the right kind. */
export function checkArguments(args: ReadonlyMap<string, ArgKind>, values: MessageValues): void {
  for (const name of Object.keys(values)) {
    if (!args.has(name)) throw new MessageFormatError(`unexpected argument "${name}"`)
  }
  for (const [name, kind] of args) {
    if (!Object.hasOwn(values, name)) throw new MessageFormatError(`missing argument "${name}"`)
    const value = values[name]
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new MessageFormatError(`argument "${name}" must be a finite number`)
      }
    } else if (kind === 'numeric' || typeof value !== 'string') {
      throw new MessageFormatError(
        `argument "${name}" must be ${kind === 'numeric' ? 'a number' : 'a string or a number'}`,
      )
    }
  }
}

const numberFormats = new Map<string, Intl.NumberFormat>()
const pluralRules = new Map<string, Intl.PluralRules>()

/** Latin digits in every locale ("12,34,567" in hi), one formatter per locale. */
export function formatNumber(locale: string, n: number): string {
  let format = numberFormats.get(locale)
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { numberingSystem: 'latn' })
    numberFormats.set(locale, format)
  }
  return format.format(n)
}

/**
 * The branch for n: an exact "=N" first, then the locale's CLDR category, else "other".
 * Throws when the selectors have no "other".
 */
export function selectPlural(locale: string, n: number, selectors: Iterable<string>): string {
  const available = [...selectors]
  if (!available.includes('other')) throw new MessageFormatError('a plural needs an "other" branch')
  const exact = available.find((s) => s.startsWith('=') && Number(s.slice(1)) === n)
  if (exact !== undefined) return exact
  let rules = pluralRules.get(locale)
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  const category = rules.select(n)
  return available.includes(category) ? category : 'other'
}

function render(
  locale: string,
  parts: readonly (MessagePart | BranchPart)[],
  values: MessageValues,
  pound: number | null,
): string {
  let out = ''
  for (const part of parts) {
    switch (part.type) {
      case 'text':
        out += part.value
        break
      case 'argument': {
        const value = values[part.name]
        out += typeof value === 'number' ? formatNumber(locale, value) : String(value)
        break
      }
      case 'number':
        out += formatNumber(locale, Number(values[part.name]))
        break
      case 'pound':
        out += formatNumber(locale, Number(pound))
        break
      case 'plural': {
        const n = Number(values[part.name])
        const branch = part.branches.get(selectPlural(locale, n, part.branches.keys())) ?? []
        out += render(locale, branch, values, n)
        break
      }
    }
  }
  return out
}

/** Formats a parsed message; throws on a missing, extra, non-finite or wrong-kind argument. */
export function formatMessage(
  locale: string,
  message: ParsedMessage,
  values: MessageValues = {},
): string {
  checkArguments(message.args, values)
  return render(locale, message.parts, values, null)
}
