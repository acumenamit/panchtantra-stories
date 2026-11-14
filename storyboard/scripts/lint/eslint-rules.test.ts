// ESLint rules (spec §6.7 RC-12, §10.2 import fences; P1-1b, owner D5): the JSX style rules and
// the reader-fence additions, run through ESLint's Node API (lintText on in-memory samples), so the
// real eslint.config.mjs is what is tested. The type-level line below makes `pnpm typecheck` prove
// that src/ui/react-css.d.ts lets the one allowed style form compile without a cast.
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import type { CSSProperties } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'

const storyboard = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// Type-level proof: without the augmentation in src/ui/react-css.d.ts this fails tsc (TS2353).
const allowedStyle: CSSProperties = { '--x': 'var(--y)' }

const ONLY_OBJECT = 'JSX style must be an object literal (no variable, call or cast).'
const ONLY_CUSTOM = 'JSX style may set only custom properties (--name); put other styles in CSS.'
const NO_SPREAD = 'JSX style may not spread another object.'
const NO_COLOR = 'JSX style may not hold a colour literal; use a colour token.'
const NO_STYLE_ELEMENT = 'No <style> elements; put styles in a CSS file.'
const NETWORK = 'fetches from the network at build'

let eslint: ESLint

beforeAll(async () => {
  eslint = new ESLint({ cwd: storyboard })
  await eslint.lintText('export const warm = 1\n', { filePath: join(storyboard, 'app/warm.ts') })
}, 120_000)

async function lint(file: string, code: string): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintText(code, { filePath: join(storyboard, file) })
  const messages = result?.messages ?? []
  // A parse error or an ignored file would make every assertion below meaningless.
  expect(messages.filter((m) => m.fatal === true)).toEqual([])
  return messages
}

/** The no-restricted-syntax messages (all errors) for a component that renders `jsx`. */
async function styleErrors(jsx: string, file = 'app/lint-sample.tsx'): Promise<string[]> {
  const code = [
    "import type { CSSProperties } from 'react'",
    "const base: CSSProperties = { '--x': 'var(--y)' }",
    "const keys = { left: 'marginLeft' }",
    "const key = 'marginLeft'",
    'export function Sample() {',
    `  return ${jsx}`,
    '}',
    '',
  ].join('\n')
  const messages = (await lint(file, code)).filter((m) => m.ruleId === 'no-restricted-syntax')
  expect(messages.every((m) => m.severity === 2)).toBe(true)
  return messages.map((m) => m.message)
}

/** The no-restricted-imports messages (all errors) for one import line. */
async function importErrors(file: string, line: string): Promise<string[]> {
  const messages = (await lint(file, `${line}\n`)).filter(
    (m) => m.ruleId === 'no-restricted-imports',
  )
  expect(messages.every((m) => m.severity === 2)).toBe(true)
  return messages.map((m) => m.message)
}

describe('JSX style rules (app/**/*.tsx and src/**/*.tsx)', () => {
  it.each([
    ['a physical property', '<div style={{ marginLeft: 1 }} />', [ONLY_CUSTOM]],
    ['a quoted non-custom property', "<div style={{ 'margin-left': 1 }} />", [ONLY_CUSTOM]],
    ['a computed template key', '<div style={{ [`marginLeft`]: 1 }} />', [ONLY_CUSTOM]],
    ['a computed member key', '<div style={{ [keys.left]: 1 }} />', [ONLY_CUSTOM]],
    ['a computed call key', "<div style={{ [String('marginLeft')]: 1 }} />", [ONLY_CUSTOM]],
    ['a computed identifier key', '<div style={{ [key]: 1 }} />', [ONLY_CUSTOM]],
    ['a hex colour in a custom property', "<div style={{ '--x': '#fff' }} />", [NO_COLOR]],
    ['a colour function in a template', '<div style={{ "--x": `rgb(1 2 3)` }} />', [NO_COLOR]],
    ['an oklch colour', "<div style={{ '--x': 'oklch(0.5 0.1 20)' }} />", [NO_COLOR]],
    ['a spread', '<div style={{ ...base }} />', [NO_SPREAD]],
    ['a non-object style', '<div style={base} />', [ONLY_OBJECT]],
    ['a cast', "<div style={{ '--x': 'var(--y)' } as CSSProperties} />", [ONLY_OBJECT]],
    ['a <style> element', "<style>{'a { color: red }'}</style>", [NO_STYLE_ELEMENT]],
  ])('reject %s', async (_name, jsx, expected) => {
    expect(await styleErrors(jsx)).toEqual(expected)
  })

  it('allow a style that sets only custom properties to token values', async () => {
    const jsx = "<div style={{ '--x': 'var(--y)', '--n': 2 }} />"
    expect(await styleErrors(jsx)).toEqual([])
    const errors = (
      await lint('app/lint-sample.tsx', `export function Sample() {\n  return ${jsx}\n}\n`)
    ).filter((m) => m.severity === 2)
    expect(errors).toEqual([])
  })

  it('cover src/**/*.tsx too (src/ui and src/reader)', async () => {
    expect(
      await styleErrors('<div style={{ marginLeft: 1 }} />', 'src/ui/lint-sample.tsx'),
    ).toEqual([ONLY_CUSTOM])
    expect(
      await styleErrors('<div style={{ marginLeft: 1 }} />', 'src/reader/lint-sample.tsx'),
    ).toEqual([ONLY_CUSTOM])
  })

  it('type the allowed form through the CSSProperties augmentation, not a cast', () => {
    expect(allowedStyle).toEqual({ '--x': 'var(--y)' })
  })
})

describe('reader fence additions', () => {
  it('bans next/font/google in app/', async () => {
    expect(await importErrors('app/lint-sample.ts', "import 'next/font/google'")).toEqual([
      expect.stringContaining(NETWORK),
    ])
  })

  it.each([
    ["import 'next/font/google'", NETWORK],
    ["import 'next/og'", NETWORK],
    ["import '@supabase/supabase-js'", 'Reader code must not import Supabase clients.'],
    ["import '../../scripts/load-content'", 'Reader code must not import scripts/.'],
  ])('src/ui is inside the reader fence: %s', async (line, message) => {
    expect(await importErrors('src/ui/lint-sample.ts', line)).toEqual([
      expect.stringContaining(message),
    ])
  })

  it('still allows next/font/local in src/ui (the self-hosted fonts)', async () => {
    expect(
      await importErrors(
        'src/ui/lint-sample.ts',
        "import localFont from 'next/font/local'\nvoid localFont",
      ),
    ).toEqual([])
  })

  it('keeps the src/core fence (no framework imports)', async () => {
    expect(await importErrors('src/core/lint-sample.ts', "import 'next/font/local'")).toEqual([
      expect.stringContaining('src/core must stay framework-free.'),
    ])
  })
})

describe('eslint-config-next is still applied', () => {
  it('fires a typescript-eslint rule on a .ts sample', async () => {
    const messages = await lint('src/reader/lint-sample.ts', 'export const value: any = 1\n')
    expect(messages.map((m) => m.ruleId)).toContain('@typescript-eslint/no-explicit-any')
  })
})
