// The staging banner (design p1-step9-design.md §3.2 B1, §4.2, §4.4, §9 items 1-3, §10.1; P1-2c):
// the truth table, the text's code units, and source scans of the component and its stylesheet.
// The component imports a CSS Module and runs only inside Next, so it is read as text; only the
// pure staging.ts and contrast-pairs.ts are imported.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GATE_MODES } from '../../core/content/gates'
import { CONTRAST_PAIRS } from '../styles/contrast-pairs'
import {
  showStagingBanner,
  STAGING_BANNER_ATTRIBUTE,
  STAGING_BANNER_MARKER,
  STAGING_BANNER_TEXT,
} from './staging'

const here = dirname(fileURLToPath(import.meta.url))
/** A file's text without its whole-line // comments, so header prose never counts. */
const code = (name: string): string =>
  readFileSync(join(here, name), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')

describe('showStagingBanner (design §9 item 1)', () => {
  it('is true only for staging, over every gate mode and no content (null)', () => {
    expect([...GATE_MODES, null].map((mode) => [mode, showStagingBanner(mode)])).toEqual([
      ['production', false],
      ['staging', true],
      ['fixtures', false],
      [null, false],
    ])
  })
})

describe('the banner text and marker (design §3.2 B1, §3.6 row 3)', () => {
  it('is "UNAPPROVED – staging": 20 UTF-16 units, U+2013 at index 11, capitals typed', () => {
    expect(STAGING_BANNER_TEXT).toBe('UNAPPROVED – staging')
    expect(STAGING_BANNER_TEXT).toHaveLength(20)
    expect(STAGING_BANNER_TEXT.charCodeAt(11)).toBe(0x2013)
    expect([...Buffer.from(STAGING_BANNER_TEXT, 'utf8').subarray(11, 14)]).toEqual([
      0xe2, 0x80, 0x93,
    ])
    expect(STAGING_BANNER_TEXT).not.toMatch(/unapproved/)
  })

  it('marks the element with data-staging-banner, counted as data-staging-banner=""', () => {
    expect(STAGING_BANNER_ATTRIBUTE).toBe('data-staging-banner')
    expect(STAGING_BANNER_MARKER).toBe(`${STAGING_BANNER_ATTRIBUTE}=""`)
  })

  it('staging.ts is pure: its only import is the GateMode type', () => {
    const imports = code('staging.ts')
      .split('\n')
      .filter((line) => /^\s*(import|export\s.*\bfrom\b)/.test(line))
    expect(imports).toEqual(["import type { GateMode } from '../../core/content/gates'"])
  })
})

describe('the component (design §4.2, §9 item 2)', () => {
  const source = code('staging-banner.tsx')
  /** The JSX with the whitespace between tags and children removed. */
  const jsx = source.replace(/>\s+/g, '>').replace(/\s+</g, '<')

  it('is a Server Component', () => {
    expect(source).not.toMatch(/(['"])use client\1/)
  })

  it('renders exactly one <p> with the marker, lang="en", the class and the text', () => {
    expect(source).toContain('<p')
    expect(source).toContain(STAGING_BANNER_MARKER)
    expect(source).toContain('lang="en"')
    expect(source).toContain('{STAGING_BANNER_TEXT}')
    expect(jsx).toContain(
      `<p ${STAGING_BANNER_MARKER} lang="en" className={styles.banner}>{STAGING_BANNER_TEXT}</p>`,
    )
    expect(source.match(/<[A-Za-z]/g)).toEqual(['<p'])
  })

  it('renders nothing unless showStagingBanner(mode), and takes the mode as a prop', () => {
    expect(source).toContain(
      'export function StagingBanner({ mode }: { readonly mode: GateMode | null })',
    )
    expect(source).toContain('if (!showStagingBanner(mode)) return null')
    const specifiers = [...source.matchAll(/^import\s[^'"]*(['"])([^'"]+)\1/gm)].map((m) => m[2])
    expect(specifiers).toEqual([
      '../../core/content/gates',
      './staging',
      './staging-banner.module.css',
    ])
  })

  it('has no role, aria-*, tabIndex, link or event handler', () => {
    for (const banned of [/\brole=/, /\baria-/, /\btabIndex\b/, /\bhref\b/, /\bon[A-Z]/]) {
      expect(source).not.toMatch(banned)
    }
  })
})

describe('the stylesheet (design §4.4, §9 item 3)', () => {
  const css = readFileSync(join(here, 'staging-banner.module.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const declarations = (rules[0]?.[2] ?? '')
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== '')

  it('is one .banner rule with exactly the §4.4 declarations, tokens only', () => {
    expect(rules.map((rule) => rule[1]?.trim())).toEqual(['.banner'])
    expect(css.replace(/([^{}]+)\{([^{}]*)\}/g, '').trim()).toBe('')
    expect(declarations).toEqual([
      'margin-block: 0',
      'padding-block: var(--space-2)',
      'padding-inline: var(--gutter)',
      'background-color: var(--color-accent)',
      'color: var(--color-text-on-accent)',
      'font-size: var(--fs-label)',
      'line-height: var(--lh-label)',
      'font-weight: var(--fw-bold)',
      'text-align: center',
    ])
  })

  it('sets no position, motion, italics, letter-spacing or text-transform', () => {
    const properties = declarations.map((declaration) =>
      declaration.slice(0, declaration.indexOf(':')).trim(),
    )
    const banned = [
      'position',
      'animation',
      'transition',
      'font-style',
      'letter-spacing',
      'text-transform',
    ]
    expect(
      properties.filter((property) =>
        banned.some((name) => property === name || property.startsWith(`${name}-`)),
      ),
    ).toEqual([])
  })

  it('uses the declared text-on-fill pair: --color-text-on-accent on --color-accent', () => {
    const pair = CONTRAST_PAIRS.find((candidate) => candidate.role === 'text-on-fill')
    expect(pair?.foreground).toBe('--color-text-on-accent')
    expect(pair?.backgrounds).toContain('--color-accent')
  })
})
