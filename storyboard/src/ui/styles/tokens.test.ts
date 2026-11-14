// Token pair test (spec §6.6 "CI checks token pairs", RC-7; P1-1b). Parses tokens.css with node:fs
// and checks every declared pair (contrast-pairs.ts) with the unrounded WCAG 2.2 ratio, scene
// rules included; that every colour token has a duty or a decorative reason; the text-scale rules;
// and the brand colours. The inline snapshot shows every ratio, so a token change shows in review.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseHex, relativeLuminance } from '../../core/a11y/contrast'
import { DEFAULT_PREFS, TEXT_SCALES } from '../../core/progress/records'
import { BACKGROUND_COLOR, THEME_COLOR } from '../brand'
import {
  CONTRAST_PAIRS,
  DECORATIVE_TOKENS,
  SCENE_IDS,
  allContrastPairs,
  sceneToken,
  scenePairs,
  type ContrastPair,
} from './contrast-pairs'

const here = dirname(fileURLToPath(import.meta.url))
const TOKENS_CSS = readFileSync(join(here, 'tokens.css'), 'utf8')

interface Declaration {
  /** The enclosing preludes, outermost first, with whitespace collapsed. */
  readonly context: string
  readonly name: string
  readonly value: string
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Enough of CSS for a Prettier-formatted tokens file: blocks, declarations, no strings with { } ;. */
function parseDeclarations(css: string): Declaration[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const stack: string[] = []
  const out: Declaration[] = []
  let buffer = ''
  const flush = (): void => {
    const statement = squash(buffer)
    buffer = ''
    if (statement === '' || statement.startsWith('@')) return
    const colon = statement.indexOf(':')
    if (colon < 1) throw new Error(`Not a declaration: ${statement}`)
    out.push({
      context: stack.join(' > '),
      name: statement.slice(0, colon).trim(),
      value: statement.slice(colon + 1).trim(),
    })
  }
  for (const ch of text) {
    if (ch === '{') {
      stack.push(squash(buffer))
      buffer = ''
    } else if (ch === '}') {
      flush()
      if (stack.pop() === undefined) throw new Error('Unbalanced }')
    } else if (ch === ';') {
      flush()
    } else {
      buffer += ch
    }
  }
  if (stack.length > 0) throw new Error('Unbalanced {')
  return out
}

const DECLARATIONS = parseDeclarations(TOKENS_CSS)
const ROOT = '@layer tokens > :root'

function declarationsIn(context: string): Map<string, string> {
  return new Map(
    DECLARATIONS.filter((d) => d.context === context).map((d) => [d.name, d.value] as const),
  )
}

const isColourToken = (name: string): boolean => /^--(?:color|scene)-/.test(name)
const COLOUR_TOKENS = new Map(
  DECLARATIONS.filter((d) => isColourToken(d.name)).map((d) => [d.name, d.value] as const),
)

function colourOf(token: string): string {
  const value = COLOUR_TOKENS.get(token)
  if (value === undefined) throw new Error(`${token} is not declared in tokens.css`)
  return value
}

const short = (token: string): string => token.replace(/^--color-/, '').replace(/^--scene-/, '')

function ratioLine(pair: ContrastPair): string {
  const ratios = pair.backgrounds.map(
    (bg) => `${short(bg)} ${contrastRatio(colourOf(pair.foreground), colourOf(bg)).toFixed(2)}`,
  )
  return `${short(pair.foreground)} on ${ratios.join(', ')} [min ${pair.minimum}]`
}

describe('tokens.css colours', () => {
  it('declares every colour token once, in :root of @layer tokens, as lowercase #rrggbb', () => {
    const colourDeclarations = DECLARATIONS.filter((d) => isColourToken(d.name))
    expect(colourDeclarations.length).toBeGreaterThan(0)
    expect(colourDeclarations.filter((d) => d.context !== ROOT)).toEqual([])
    expect(new Set(colourDeclarations.map((d) => d.name)).size).toBe(colourDeclarations.length)
    expect(colourDeclarations.filter((d) => !/^#[0-9a-f]{6}$/.test(d.value))).toEqual([])
  })

  it('declares the 21 colour roles and the 10 legacy scenes, each with from, to and accent', () => {
    const colours = [...COLOUR_TOKENS.keys()].filter((name) => name.startsWith('--color-'))
    expect(colours).toHaveLength(21)
    const scenes = [...COLOUR_TOKENS.keys()].filter((name) => name.startsWith('--scene-'))
    expect(scenes.sort()).toEqual(
      SCENE_IDS.flatMap((id) => [
        sceneToken(id, 'accent'),
        sceneToken(id, 'from'),
        sceneToken(id, 'to'),
      ]).sort(),
    )
  })

  it('gives every colour token a contrast duty or a decorative reason', () => {
    const inPairs = new Set(allContrastPairs().flatMap((p) => [p.foreground, ...p.backgrounds]))
    const decorative = new Set(DECORATIVE_TOKENS.map((d) => d.token))
    expect([...COLOUR_TOKENS.keys()].filter((t) => !inPairs.has(t) && !decorative.has(t))).toEqual(
      [],
    )
    for (const d of DECORATIVE_TOKENS) {
      expect(COLOUR_TOKENS.has(d.token), d.token).toBe(true)
      expect(inPairs.has(d.token), `${d.token} is decorative but in a pair`).toBe(false)
      expect(d.reason.length).toBeGreaterThan(20)
    }
  })

  it('names only declared tokens in the pairs', () => {
    const named = allContrastPairs().flatMap((p) => [p.foreground, ...p.backgrounds])
    expect(named.filter((t) => !COLOUR_TOKENS.has(t))).toEqual([])
  })

  it('meets every pair minimum, unrounded', () => {
    const failures = allContrastPairs().flatMap((pair) =>
      pair.backgrounds
        .map((bg) => ({ bg, ratio: contrastRatio(colourOf(pair.foreground), colourOf(bg)) }))
        .filter(({ ratio }) => !(ratio >= pair.minimum))
        .map(({ bg, ratio }) => `${pair.foreground} on ${bg}: ${ratio} < ${pair.minimum}`),
    )
    expect(failures).toEqual([])
  })

  it('has scene gradients that fall (or rise) in every channel, so the ends bound the gradient', () => {
    for (const id of SCENE_IDS) {
      const from = parseHex(colourOf(sceneToken(id, 'from')))
      const to = parseHex(colourOf(sceneToken(id, 'to')))
      const deltas = [to.r - from.r, to.g - from.g, to.b - from.b]
      const monotonic = deltas.every((d) => d <= 0) || deltas.every((d) => d >= 0)
      expect(monotonic, `${id}: ${deltas.join(', ')}`).toBe(true)
    }
  })

  it('keeps every scene foreground outside its gradient’s luminance range, so the ends bound each ratio', () => {
    // A monotonic gradient bounds the background luminance by its ends; the ratio is then smallest
    // at an end only if the foreground is lighter (or darker) than the whole gradient.
    const overGradient = scenePairs().filter((pair) =>
      pair.backgrounds.some((bg) => /^--scene-.+-(?:from|to)$/.test(bg)),
    )
    expect(overGradient).toHaveLength(SCENE_IDS.length * 13)
    for (const pair of overGradient) {
      const ends = pair.backgrounds.filter((bg) => /^--scene-.+-(?:from|to)$/.test(bg))
      expect(ends, pair.foreground).toHaveLength(2)
      const endLuminances = ends.map((bg) => relativeLuminance(colourOf(bg)))
      const fg = relativeLuminance(colourOf(pair.foreground))
      const outside = fg >= Math.max(...endLuminances) || fg <= Math.min(...endLuminances)
      expect(outside, `${pair.foreground} (L ${fg}) over ${ends.join(' to ')}`).toBe(true)
    }
  })

  it('shows every surface ratio (2 decimals; the test above compares unrounded)', () => {
    expect(CONTRAST_PAIRS.map(ratioLine).join('\n')).toMatchInlineSnapshot(`
      "text on canvas 15.94, surface 15.31, surface-raised 14.76, surface-hover 13.58, surface-selected 11.24, surface-story 16.27 [min 7]
      text-strong on canvas 17.75, surface 17.05, surface-raised 16.44, surface-hover 15.12, surface-selected 12.52, surface-story 18.12 [min 7]
      text-ending on canvas 11.57, surface 11.11, surface-raised 10.71, surface-hover 9.85, surface-selected 8.16, surface-story 11.81 [min 7]
      text-lesson on canvas 15.87, surface 15.24, surface-raised 14.69, surface-hover 13.52, surface-selected 11.19, surface-story 16.20 [min 7]
      text-secondary on canvas 9.37, surface 9.00, surface-raised 8.68, surface-hover 7.98, surface-selected 6.61, surface-story 9.57 [min 4.5]
      text-accent on canvas 11.84, surface 11.37, surface-raised 10.96, surface-hover 10.08, surface-selected 8.35, surface-story 12.09 [min 4.5]
      text-success on canvas 11.34, surface 10.89, surface-raised 10.50, surface-hover 9.66, surface-selected 8.00, surface-story 11.58 [min 4.5]
      text-danger on canvas 10.41, surface 10.00, surface-raised 9.64, surface-hover 8.87, surface-selected 7.34, surface-story 10.63 [min 4.5]
      text-on-accent on accent 9.20, accent-hover 11.84, brand 6.20 [min 4.5]
      line-strong on canvas 4.72, surface 4.53, surface-raised 4.37, surface-hover 4.02, surface-selected 3.33, surface-story 4.82 [min 3]
      focus on canvas 11.84, surface 11.37, surface-raised 10.96, surface-hover 10.08, surface-selected 8.35, surface-story 12.09 [min 3]
      brand on canvas 6.20, surface 5.96, surface-raised 5.74, surface-hover 5.28, surface-selected 4.38, surface-story 6.33 [min 3]
      accent on canvas 9.20, surface 8.84, surface-raised 8.52, surface-hover 7.84, surface-selected 6.49, surface-story 9.40 [min 3]
      canvas on accent 9.20, accent-hover 11.84 [min 3]"
    `)
  })

  it('shows every scene ratio (2 decimals; the test above compares unrounded)', () => {
    expect(scenePairs().map(ratioLine).join('\n')).toMatchInlineSnapshot(`
      "forest-day-accent on forest-day-from 8.81, forest-day-to 10.78, surface-story 11.58 [min 4.5]
      text on forest-day-from 12.37, forest-day-to 15.15 [min 7]
      text-strong on forest-day-from 13.78, forest-day-to 16.87 [min 7]
      text-ending on forest-day-from 8.98, forest-day-to 10.99 [min 7]
      text-lesson on forest-day-from 12.32, forest-day-to 15.08 [min 7]
      text-secondary on forest-day-from 7.28, forest-day-to 8.91 [min 4.5]
      text-accent on forest-day-from 9.19, forest-day-to 11.25 [min 4.5]
      text-success on forest-day-from 8.81, forest-day-to 10.78 [min 4.5]
      text-danger on forest-day-from 8.09, forest-day-to 9.90 [min 4.5]
      brand on forest-day-from 4.82, forest-day-to 5.90 [min 3]
      accent on forest-day-from 7.15, forest-day-to 8.75 [min 3]
      line-strong on forest-day-from 3.66, forest-day-to 4.48 [min 3]
      focus on forest-day-from 9.19, forest-day-to 11.25 [min 3]
      text-on-accent on forest-day-accent 11.34 [min 4.5]
      forest-evening-accent on forest-evening-from 6.96, forest-evening-to 8.55, surface-story 8.92 [min 4.5]
      text on forest-evening-from 12.70, forest-evening-to 15.61 [min 7]
      text-strong on forest-evening-from 14.14, forest-evening-to 17.38 [min 7]
      text-ending on forest-evening-from 9.22, forest-evening-to 11.33 [min 7]
      text-lesson on forest-evening-from 12.65, forest-evening-to 15.54 [min 7]
      text-secondary on forest-evening-from 7.47, forest-evening-to 9.18 [min 4.5]
      text-accent on forest-evening-from 9.43, forest-evening-to 11.59 [min 4.5]
      text-success on forest-evening-from 9.04, forest-evening-to 11.11 [min 4.5]
      text-danger on forest-evening-from 8.30, forest-evening-to 10.20 [min 4.5]
      brand on forest-evening-from 4.94, forest-evening-to 6.07 [min 3]
      accent on forest-evening-from 7.33, forest-evening-to 9.01 [min 3]
      line-strong on forest-evening-from 3.76, forest-evening-to 4.62 [min 3]
      focus on forest-evening-from 9.43, forest-evening-to 11.59 [min 3]
      text-on-accent on forest-evening-accent 8.73 [min 4.5]
      forest-dark-accent on forest-dark-from 6.43, forest-dark-to 6.76, surface-story 6.76 [min 4.5]
      text on forest-dark-from 15.47, forest-dark-to 16.27 [min 7]
      text-strong on forest-dark-from 17.23, forest-dark-to 18.12 [min 7]
      text-ending on forest-dark-from 11.23, forest-dark-to 11.81 [min 7]
      text-lesson on forest-dark-from 15.41, forest-dark-to 16.20 [min 7]
      text-secondary on forest-dark-from 9.10, forest-dark-to 9.57 [min 4.5]
      text-accent on forest-dark-from 11.49, forest-dark-to 12.09 [min 4.5]
      text-success on forest-dark-from 11.01, forest-dark-to 11.58 [min 4.5]
      text-danger on forest-dark-from 10.11, forest-dark-to 10.63 [min 4.5]
      brand on forest-dark-from 6.02, forest-dark-to 6.33 [min 3]
      accent on forest-dark-from 8.93, forest-dark-to 9.40 [min 3]
      line-strong on forest-dark-from 4.58, forest-dark-to 4.82 [min 3]
      focus on forest-dark-from 11.49, forest-dark-to 12.09 [min 3]
      text-on-accent on forest-dark-accent 6.62 [min 4.5]
      forest-path-accent on forest-path-from 7.93, forest-path-to 9.76, surface-story 10.50 [min 4.5]
      text on forest-path-from 12.29, forest-path-to 15.13 [min 7]
      text-strong on forest-path-from 13.69, forest-path-to 16.85 [min 7]
      text-ending on forest-path-from 8.92, forest-path-to 10.98 [min 7]
      text-lesson on forest-path-from 12.24, forest-path-to 15.06 [min 7]
      text-secondary on forest-path-from 7.23, forest-path-to 8.90 [min 4.5]
      text-accent on forest-path-from 9.13, forest-path-to 11.24 [min 4.5]
      text-success on forest-path-from 8.75, forest-path-to 10.76 [min 4.5]
      text-danger on forest-path-from 8.03, forest-path-to 9.88 [min 4.5]
      brand on forest-path-from 4.78, forest-path-to 5.89 [min 3]
      accent on forest-path-from 7.10, forest-path-to 8.73 [min 3]
      line-strong on forest-path-from 3.64, forest-path-to 4.48 [min 3]
      focus on forest-path-from 9.13, forest-path-to 11.24 [min 3]
      text-on-accent on forest-path-accent 10.28 [min 4.5]
      lions-den-accent on lions-den-from 6.51, lions-den-to 7.19, surface-story 7.29 [min 4.5]
      text on lions-den-from 14.52, lions-den-to 16.04 [min 7]
      text-strong on lions-den-from 16.17, lions-den-to 17.86 [min 7]
      text-ending on lions-den-from 10.54, lions-den-to 11.64 [min 7]
      text-lesson on lions-den-from 14.46, lions-den-to 15.97 [min 7]
      text-secondary on lions-den-from 8.54, lions-den-to 9.43 [min 4.5]
      text-accent on lions-den-from 10.79, lions-den-to 11.91 [min 4.5]
      text-success on lions-den-from 10.33, lions-den-to 11.41 [min 4.5]
      text-danger on lions-den-from 9.49, lions-den-to 10.48 [min 4.5]
      brand on lions-den-from 5.65, lions-den-to 6.24 [min 3]
      accent on lions-den-from 8.39, lions-den-to 9.26 [min 3]
      line-strong on lions-den-from 4.30, lions-den-to 4.75 [min 3]
      focus on lions-den-from 10.79, lions-den-to 11.91 [min 3]
      text-on-accent on lions-den-accent 7.14 [min 4.5]
      well-accent on well-from 6.88, well-to 7.67, surface-story 7.94 [min 4.5]
      text on well-from 14.12, well-to 15.72 [min 7]
      text-strong on well-from 15.72, well-to 17.51 [min 7]
      text-ending on well-from 10.25, well-to 11.41 [min 7]
      text-lesson on well-from 14.05, well-to 15.65 [min 7]
      text-secondary on well-from 8.30, well-to 9.25 [min 4.5]
      text-accent on well-from 10.49, well-to 11.68 [min 4.5]
      text-success on well-from 10.04, well-to 11.19 [min 4.5]
      text-danger on well-from 9.22, well-to 10.27 [min 4.5]
      brand on well-from 5.49, well-to 6.12 [min 3]
      accent on well-from 8.15, well-to 9.08 [min 3]
      line-strong on well-from 4.18, well-to 4.65 [min 3]
      focus on well-from 10.49, well-to 11.68 [min 3]
      text-on-accent on well-accent 7.77 [min 4.5]
      forest-dawn-accent on forest-dawn-from 10.01, forest-dawn-to 11.52, surface-story 12.09 [min 4.5]
      text on forest-dawn-from 13.48, forest-dawn-to 15.51 [min 7]
      text-strong on forest-dawn-from 15.01, forest-dawn-to 17.28 [min 7]
      text-ending on forest-dawn-from 9.79, forest-dawn-to 11.26 [min 7]
      text-lesson on forest-dawn-from 13.42, forest-dawn-to 15.45 [min 7]
      text-secondary on forest-dawn-from 7.93, forest-dawn-to 9.12 [min 4.5]
      text-accent on forest-dawn-from 10.01, forest-dawn-to 11.52 [min 4.5]
      text-success on forest-dawn-from 9.59, forest-dawn-to 11.04 [min 4.5]
      text-danger on forest-dawn-from 8.81, forest-dawn-to 10.14 [min 4.5]
      brand on forest-dawn-from 5.25, forest-dawn-to 6.04 [min 3]
      accent on forest-dawn-from 7.78, forest-dawn-to 8.96 [min 3]
      line-strong on forest-dawn-from 3.99, forest-dawn-to 4.59 [min 3]
      focus on forest-dawn-from 10.01, forest-dawn-to 11.52 [min 3]
      text-on-accent on forest-dawn-accent 11.84 [min 4.5]
      river-bank-accent on river-bank-from 7.85, river-bank-to 9.03, surface-story 9.42 [min 4.5]
      text on river-bank-from 13.57, river-bank-to 15.60 [min 7]
      text-strong on river-bank-from 15.11, river-bank-to 17.37 [min 7]
      text-ending on river-bank-from 9.85, river-bank-to 11.32 [min 7]
      text-lesson on river-bank-from 13.51, river-bank-to 15.53 [min 7]
      text-secondary on river-bank-from 7.98, river-bank-to 9.17 [min 4.5]
      text-accent on river-bank-from 10.08, river-bank-to 11.59 [min 4.5]
      text-success on river-bank-from 9.66, river-bank-to 11.10 [min 4.5]
      text-danger on river-bank-from 8.87, river-bank-to 10.19 [min 4.5]
      brand on river-bank-from 5.28, river-bank-to 6.07 [min 3]
      accent on river-bank-from 7.84, river-bank-to 9.01 [min 3]
      line-strong on river-bank-from 4.02, river-bank-to 4.62 [min 3]
      focus on river-bank-from 10.08, river-bank-to 11.59 [min 3]
      text-on-accent on river-bank-accent 9.22 [min 4.5]
      village-accent on village-from 12.02, village-to 13.48, surface-story 13.99 [min 4.5]
      text on village-from 13.97, village-to 15.68 [min 7]
      text-strong on village-from 15.56, village-to 17.46 [min 7]
      text-ending on village-from 10.14, village-to 11.38 [min 7]
      text-lesson on village-from 13.91, village-to 15.61 [min 7]
      text-secondary on village-from 8.22, village-to 9.22 [min 4.5]
      text-accent on village-from 10.38, village-to 11.65 [min 4.5]
      text-success on village-from 9.94, village-to 11.16 [min 4.5]
      text-danger on village-from 9.13, village-to 10.24 [min 4.5]
      brand on village-from 5.44, village-to 6.10 [min 3]
      accent on village-from 8.07, village-to 9.05 [min 3]
      line-strong on village-from 4.14, village-to 4.64 [min 3]
      focus on village-from 10.38, village-to 11.65 [min 3]
      text-on-accent on village-accent 13.70 [min 4.5]
      palace-accent on palace-from 6.91, palace-to 7.55, surface-story 7.64 [min 4.5]
      text on palace-from 14.72, palace-to 16.08 [min 7]
      text-strong on palace-from 16.39, palace-to 17.91 [min 7]
      text-ending on palace-from 10.68, palace-to 11.68 [min 7]
      text-lesson on palace-from 14.65, palace-to 16.02 [min 7]
      text-secondary on palace-from 8.66, palace-to 9.46 [min 4.5]
      text-accent on palace-from 10.93, palace-to 11.95 [min 4.5]
      text-success on palace-from 10.47, palace-to 11.45 [min 4.5]
      text-danger on palace-from 9.62, palace-to 10.51 [min 4.5]
      brand on palace-from 5.73, palace-to 6.26 [min 3]
      accent on palace-from 8.50, palace-to 9.29 [min 3]
      line-strong on palace-from 4.36, palace-to 4.76 [min 3]
      focus on palace-from 10.93, palace-to 11.95 [min 3]
      text-on-accent on palace-accent 7.48 [min 4.5]"
    `)
  })
})

describe('tokens.css text size', () => {
  it('has one data-text-scale rule per non-default text scale', () => {
    const rules = DECLARATIONS.map((d) => ({
      match: /^@layer tokens > :root\[data-text-scale='(\d+)'\]$/.exec(d.context),
      ...d,
    })).filter((d) => d.match !== null)
    const nonDefault = TEXT_SCALES.filter((s) => s !== DEFAULT_PREFS.textScale)
    expect(rules.map((r) => [Number(r.match?.[1]), r.name, Number(r.value)])).toEqual(
      nonDefault.map((s) => [s, '--text-scale', s / 100]),
    )
    expect(declarationsIn(ROOT).get('--text-scale')).toBe('1')
    expect(declarationsIn(ROOT).get('--script-scale')).toBe('1')
  })

  it('scales every text size token, none below 0.875rem at 100%', () => {
    const sizes = declarationsIn('@layer tokens > :root, [lang]')
    const rems = Object.fromEntries(
      [...sizes].map(([name, value]) => {
        const match = /^calc\(([\d.]+)rem \* var\(--text-scale\) \* var\(--script-scale\)\)$/.exec(
          value,
        )
        return [name, match ? Number(match[1]) : value]
      }),
    )
    expect(rems).toEqual({
      '--fs-story': 1.25,
      '--fs-choice': 1.125,
      '--fs-body': 1.125,
      '--fs-label': 1,
      '--fs-small': 0.875,
      '--fs-title': 1.75,
      '--fs-display': 2,
    })
    expect(Object.values(rems).every((rem) => typeof rem === 'number' && rem >= 0.875)).toBe(true)
    expect(DECLARATIONS.filter((d) => d.name.startsWith('--fs-')).length).toBe(7)
  })

  it('scales only the text size tokens: spacing, widths and targets never do (design §3.5 b)', () => {
    const SCALE = /var\(\s*--(?:text|script)-scale\s*[,)]/
    const scaled = DECLARATIONS.filter((d) => SCALE.test(d.value))
    expect(scaled.map((d) => `${d.context} { ${d.name} }`).sort()).toEqual(
      [
        '--fs-body',
        '--fs-choice',
        '--fs-display',
        '--fs-label',
        '--fs-small',
        '--fs-story',
        '--fs-title',
      ].map((name) => `@layer tokens > :root, [lang] { ${name} }`),
    )
    // base.css applies tokens and never reads the scales itself (the root font size stays 100%).
    const base = readFileSync(join(here, 'base.css'), 'utf8')
    expect(base).not.toMatch(/--(?:text|script)-scale/)
  })

  it('gives Hindi more leading and its own script scale', () => {
    expect(Object.fromEntries(declarationsIn('@layer tokens > :lang(hi)'))).toEqual({
      '--script-scale': '1',
      '--lh-story': '2',
      '--lh-body': '1.75',
      '--lh-label': '1.5',
      '--lh-heading': '1.45',
    })
  })

  it('drops every duration token to 0ms under reduced motion', () => {
    const durations = [...declarationsIn(ROOT).keys()].filter(
      (name) => name.startsWith('--duration-') || name === '--reveal-max',
    )
    expect(durations).toHaveLength(4)
    const reduced = declarationsIn(
      '@layer tokens > @media (prefers-reduced-motion: reduce) > :root',
    )
    expect(Object.fromEntries(reduced)).toEqual(
      Object.fromEntries(durations.map((d) => [d, '0ms'])),
    )
  })
})

describe('brand colours', () => {
  it('equal --color-canvas', () => {
    expect(THEME_COLOR).toBe(colourOf('--color-canvas'))
    expect(BACKGROUND_COLOR).toBe(colourOf('--color-canvas'))
  })
})
