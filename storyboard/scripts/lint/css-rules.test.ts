// CSS lint tests (spec §6.7 RC-12, §6.6, §10.2; P1-1b, owner D5): every rule fires on a bad sample
// and stays quiet on its logical or token form; comments and strings are ignored; line and column
// are right, for LF and CRLF alike; the escape hatch; the CLI; the `pnpm lint` pin; and zero
// findings on the real repo CSS.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { collectCssFiles, formatFinding, runCssLint } from './css-lint'
import {
  ALLOW_REASON,
  ALLOW_UNUSED,
  BASE_FILE,
  declaredCustomProperties,
  lintCss,
  NAMED_COLORS,
  RULE_IDS,
  TOKENS_FILE,
  type Finding,
} from './css-rules'

const storyboard = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MODULE_FILE = 'src/ui/components/sample.module.css'
const TOKENS = new Set([
  '--color-text',
  '--color-line-strong',
  '--space-4',
  '--duration-calm',
  '--ease-calm',
  '--radius-card',
  '--font-latin',
])

const lint = (css: string, file = MODULE_FILE): Finding[] => lintCss(css, { file, tokens: TOKENS })
const rulesOf = (css: string, file = MODULE_FILE): string[] => lint(css, file).map((f) => f.rule)
const inRule = (declarations: string): string => `a {\n  ${declarations};\n}\n`

describe('lintCss rules', () => {
  it('knows exactly the rule ids of design §3.1', () => {
    expect([...RULE_IDS].sort()).toEqual(
      [
        'css/no-import',
        'css/no-nesting',
        'motion/no-infinite',
        'rc12/physical-keyword',
        'rc12/physical-property',
        'rc12/physical-shorthand',
        'rc12/translate-x',
        'text/as-stored',
        'tokens/color-literal',
        'tokens/font-family',
        'tokens/motion-literal',
        'tokens/unknown-var',
      ].sort(),
    )
    expect(NAMED_COLORS.size).toBe(148)
    expect(NAMED_COLORS.has('rebeccapurple')).toBe(true)
    expect(NAMED_COLORS.has('transparent')).toBe(false)
    expect(NAMED_COLORS.has('currentcolor')).toBe(false)
  })

  const bad: [string, string[]][] = [
    [
      'rc12/physical-property',
      [
        'left: 0',
        'right: 0',
        'margin-left: 0',
        'padding-right: 0',
        'border-left: 1px solid var(--color-line-strong)',
        'border-right-width: 1px',
        'scroll-margin-left: 0',
        'scroll-padding-right: 0',
        'border-top-left-radius: 4px',
        'border-top-right-radius: 4px',
        'border-bottom-left-radius: 4px',
        'border-bottom-right-radius: 4px',
        'MARGIN-LEFT: 0',
      ],
    ],
    [
      'rc12/physical-keyword',
      [
        'text-align: left',
        'float: right',
        'clear: left',
        'background-position: left top',
        'object-position: right 10%',
        'transform-origin: left center',
        'text-align: RIGHT',
        '--align: right',
      ],
    ],
    [
      'rc12/physical-shorthand',
      [
        'margin: 0 1px 0 2px',
        'padding: 1px 2px 3px 4px',
        'inset: 0 auto auto 0',
        'scroll-margin: 0 1px 0 0',
        'scroll-padding: 0 1px 0 0',
        'border-width: 1px 0 1px 2px',
        'border-style: solid none solid none',
        'border-color: var(--color-text) var(--color-line-strong) var(--color-text) var(--color-text)',
        'margin: calc(1px + 2px) 0 0 var(--space-4)',
        'border-radius: 4px 8px',
        'border-radius: 4px / 4px 8px',
        'border-radius: 1px 2px 3px 4px / 4px',
      ],
    ],
    [
      'rc12/translate-x',
      [
        'transform: translateX(4px)',
        'transform: translatex(0)',
        'transform: translate(4px, 0)',
        'transform: translate(-50%)',
        'transform: translate3d(1px, 0, 0)',
        'transform: scale(2) translate(var(--space-4), 0)',
        'translate: 4px 0',
        'translate: var(--space-4)',
      ],
    ],
    [
      'tokens/color-literal',
      [
        'color: #fff',
        'color: #FFFFFF',
        'color: #ffff',
        'color: #ffffff80',
        'color: rgb(0 0 0)',
        'color: rgba(0, 0, 0, 0.5)',
        'color: hsl(0 0% 0%)',
        'color: hsla(0, 0%, 0%, 1)',
        'color: hwb(0 0% 0%)',
        'color: lab(0 0 0)',
        'color: lch(0 0 0)',
        'color: oklab(0 0 0)',
        'color: oklch(0 0 0)',
        'color: color(srgb 1 0 0)',
        'color: color-mix(in srgb, var(--color-text), var(--color-text))',
        'color: red',
        'color: RebeccaPurple',
        'border: 1px solid black',
        'color: var(--color-text, white)',
        '--local: #fff',
        'box-shadow: 0 0 1px #000',
      ],
    ],
    [
      'tokens/motion-literal',
      [
        'transition: opacity 2s',
        'transition-duration: 300ms',
        'animation: fade 1.5s',
        'animation-delay: .5s',
        'transition: opacity var(--duration-calm, 300ms)',
        '-webkit-transition: opacity 1s',
        '--delay: 2s',
        '--fade: opacity 300ms var(--ease-calm)',
      ],
    ],
    [
      'motion/no-infinite',
      ['animation-iteration-count: infinite', 'animation: spin var(--duration-calm) INFINITE'],
    ],
    [
      'text/as-stored',
      [
        'font-style: italic',
        'font-style: oblique 10deg',
        'text-transform: uppercase',
        'text-transform: capitalize',
        'letter-spacing: 0.1em',
        'letter-spacing: -1px',
        'text-align: justify',
        'text-align-last: justify',
        'hyphens: auto',
        '-webkit-hyphens: auto',
      ],
    ],
    [
      'tokens/font-family',
      ['font-family: var(--font-latin)', 'font-family: serif', 'font: 1rem serif'],
    ],
    [
      'tokens/unknown-var',
      ['color: var(--colour-text)', 'margin: var( --nope )', 'margin: var(--space-4, var(--nope))'],
    ],
  ]

  for (const [rule, samples] of bad) {
    it.each(samples)(`${rule} fires on "%s"`, (sample) => {
      expect(rulesOf(inRule(sample))).toEqual([rule])
    })
  }

  it.each([
    'margin-inline-start: 0',
    'inset-inline-end: 0',
    'text-align: start',
    'text-align: end',
    'float: inline-start',
    'border-start-start-radius: 4px',
    'border-end-end-radius: 4px',
    'padding-inline: 1px 2px',
    'margin: 0 auto',
    'margin: 1px 2px 3px',
    'padding: calc(1px + 2px) 0',
    'border-radius: var(--radius-card)',
    'border-radius: 4px / 8px',
    'padding-inline-start: env(safe-area-inset-left)',
    'margin: var(--space-4, left)',
    '--gap-left: 0',
    'transform: translateY(4px)',
    'transform: translate(0, -50%)',
    'transform: translate3d(0, 4px, 0)',
    'translate: 0 4px',
    'translate: none',
    'color: transparent',
    'color: currentcolor',
    'color: currentColor',
    'outline-color: Highlight',
    'color: CanvasText',
    'background-color: Canvas',
    'color: ButtonText',
    'color: var(--color-text)',
    'transition: opacity var(--duration-calm) var(--ease-calm)',
    'transition-property: color, background-color',
    'animation-iteration-count: 1',
    'font-style: normal',
    'text-transform: none',
    'letter-spacing: normal',
    'letter-spacing: 0',
    'text-align: center',
    'hyphens: manual',
    'font-family: inherit',
    'font: inherit',
    'font-synthesis: none',
    '-webkit-text-size-adjust: 100%',
    'margin: var(--space-4)',
    '--local: 1px; margin: var(--local)',
    'margin: var(--later); --later: 1px',
    '--x: var(--font-lora), var(--font-devanagari), var(--font-devanagari-latin)',
  ])('stays quiet on "%s"', (sample) => {
    expect(lint(inRule(sample))).toEqual([])
  })

  it('allows colour and time literals and font stacks only in tokens.css', () => {
    const css = inRule(
      '--color-x: #fff; --duration-x: 300ms; transition: opacity 2s; font-family: serif; color: red',
    )
    expect(rulesOf(css, TOKENS_FILE)).toEqual([])
    expect(rulesOf(css, BASE_FILE)).toEqual([
      'tokens/color-literal',
      'tokens/motion-literal',
      'tokens/motion-literal',
      'tokens/color-literal',
    ])
    expect(rulesOf(css)).toEqual([
      'tokens/color-literal',
      'tokens/motion-literal',
      'tokens/motion-literal',
      'tokens/font-family',
      'tokens/color-literal',
    ])
    // A file outside the repo is never tokens.css, whatever its name.
    expect(rulesOf(css, 'C:/elsewhere/src/ui/styles/tokens.css')).toHaveLength(5)
  })

  it('catches a time literal carried into a transition through a local custom property', () => {
    expect(lint('a {\n  --d: 2s;\n  transition-duration: var(--d);\n}\n')).toEqual([
      expect.objectContaining({ rule: 'tokens/motion-literal', line: 2, column: 8 }),
    ])
    expect(rulesOf('a {\n  --d: 2s;\n}\n', TOKENS_FILE)).toEqual([])
  })

  it('still applies the RC-12, motion and text rules inside tokens.css', () => {
    expect(
      rulesOf(
        inRule('margin-left: 0; animation-iteration-count: infinite; font-style: italic'),
        TOKENS_FILE,
      ),
    ).toEqual(['rc12/physical-property', 'motion/no-infinite', 'text/as-stored'])
  })

  it('flags italic in the font shorthand as well as in font-style', () => {
    expect(rulesOf(inRule('font: italic 1rem var(--font-latin)'), BASE_FILE)).toEqual([
      'text/as-stored',
    ])
  })

  it('flags every occurrence, each at its own column', () => {
    expect(lint('a { color: #fff; background-color: #000 }').map((f) => f.column)).toEqual([12, 36])
  })
})

describe('lintCss structure', () => {
  it.each([
    'a {\n  color: var(--color-text);\n  &:hover {\n    color: var(--color-text);\n  }\n}\n',
    'a {\n  margin: 0;\n  b {\n    margin: 0;\n  }\n}\n',
    'a {\n  margin: 0;\n  @media (min-width: 1px) {\n    margin: 0;\n  }\n}\n',
  ])('css/no-nesting fires on a rule inside a rule: %j', (css) => {
    expect(lint(css)).toEqual([
      expect.objectContaining({ rule: 'css/no-nesting', line: 3, column: 3 }),
    ])
  })

  it.each(["@import 'x.css';", '@import url(x.css) layer(base);', '@IMPORT "x.css";'])(
    'css/no-import fires on %j',
    (css) => {
      expect(rulesOf(css)).toEqual(['css/no-import'])
    },
  )

  it('reads layers, media, supports and keyframes as flat CSS', () => {
    const css = [
      '@layer tokens, base;',
      '@layer base {',
      '  @media (min-width: 48rem) {',
      '    a {',
      '      margin: 0;',
      '    }',
      '  }',
      '  @supports (display: grid) {',
      '    @media (prefers-reduced-motion: reduce) {',
      '      a {',
      '        margin-left: 0;',
      '      }',
      '    }',
      '  }',
      '}',
      '@keyframes fade {',
      '  from {',
      '    opacity: 0;',
      '  }',
      '  to {',
      '    opacity: 1;',
      '  }',
      '}',
      '',
    ].join('\n')
    expect(lint(css)).toEqual([
      {
        file: MODULE_FILE,
        line: 11,
        column: 9,
        rule: 'rc12/physical-property',
        message:
          '"margin-left" is a physical property; use its logical form (inline-start / inline-end)',
      },
    ])
  })

  it('ignores comments and strings, including braces and semicolons inside them', () => {
    const css = [
      '/* margin-left: 0; color: #fff; transform: translateX(1px); animation: x 1s infinite */',
      'a[title="{;}"] {',
      "  content: 'left #fff translateX(1px) infinite italic var(--nope) { ; }';",
      '  background-image: url(left-red.png), url("right.png");',
      '  /* text-align: left; } */',
      '  margin-inline: 0; /* margin-left: 0 */',
      '}',
      '',
    ].join('\n')
    expect(lint(css)).toEqual([])
    expect(lint(`${css}b {\n  margin-right: 0;\n}\n`)).toEqual([
      expect.objectContaining({ rule: 'rc12/physical-property', line: 9, column: 3 }),
    ])
  })

  it('reports 1-based line and column, and the same for CRLF input', () => {
    const lines = [
      '/* header */',
      'a {',
      "  content: 'left';",
      '  margin-left: 0;',
      '  color: #fff; padding: 1px 2px 3px 4px;',
      '}',
      '',
    ]
    const lf = lint(lines.join('\n'))
    expect(lf.map(({ line, column, rule }) => ({ line, column, rule }))).toEqual([
      { line: 4, column: 3, rule: 'rc12/physical-property' },
      { line: 5, column: 10, rule: 'tokens/color-literal' },
      { line: 5, column: 16, rule: 'rc12/physical-shorthand' },
    ])
    expect(lint(lines.join('\r\n'))).toEqual(lf)
    expect(lint(`\uFEFF${lines.join('\r\n')}`)).toEqual(lf)
  })

  it('reads the custom properties a stylesheet declares', () => {
    expect([
      ...declaredCustomProperties(
        ':root {\r\n  --a: 1px;\r\n  /* --b: 2px; */\r\n  --c: var(--a);\r\n}',
      ),
    ]).toEqual(['--a', '--c'])
  })
})

describe('lintCss escape hatch', () => {
  const allowed = (comment: string, declaration = 'transition-duration: 0.01ms'): string =>
    `a {\n  ${comment}\n  ${declaration};\n}\n`

  it('suppresses the named rule on the declaration directly below, with a reason', () => {
    expect(lint(allowed('/* css-lint-allow tokens/motion-literal: safety net */'))).toEqual([])
    expect(
      lint(allowed('/* css-lint-allow tokens/motion-literal: safety net */'), TOKENS_FILE),
    ).toEqual([expect.objectContaining({ rule: ALLOW_UNUSED, line: 2, column: 3 })])
  })

  it('suppresses only the named rule', () => {
    expect(
      rulesOf(
        allowed('/* css-lint-allow tokens/motion-literal: safety net */', 'transition: left 1s'),
      ),
    ).toEqual(['rc12/physical-keyword'])
  })

  it.each([
    '/* css-lint-allow tokens/motion-literal */',
    '/* css-lint-allow tokens/motion-literal: */',
    '/* css-lint-allow tokens/motion-literal:    */',
    '/* css-lint-allow */',
    '/* css-lint-allow: a reason with no rule */',
  ])('without a rule id and a reason it is a finding and suppresses nothing: %j', (comment) => {
    expect(
      lint(allowed(comment)).map(({ line, column, rule }) => ({ line, column, rule })),
    ).toEqual([
      { line: 2, column: 3, rule: ALLOW_REASON },
      { line: 3, column: 24, rule: 'tokens/motion-literal' },
    ])
  })

  it.each([
    ['another rule', '/* css-lint-allow rc12/physical-property: wrong rule */'],
    ['an unknown rule', '/* css-lint-allow tokens/motion: typo */'],
  ])('an allow for %s matches nothing and is a finding', (_name, comment) => {
    expect(rulesOf(allowed(comment))).toEqual([ALLOW_UNUSED, 'tokens/motion-literal'])
  })

  it('must sit on the line directly above the declaration', () => {
    const css =
      'a {\n  /* css-lint-allow tokens/motion-literal: x */\n\n  transition-duration: 1s;\n}\n'
    expect(rulesOf(css)).toEqual([ALLOW_UNUSED, 'tokens/motion-literal'])
    expect(rulesOf(allowed('/* css-lint-allow tokens/motion-literal: x */', 'opacity: 1'))).toEqual(
      [ALLOW_UNUSED],
    )
  })

  it('works the same with CRLF line endings', () => {
    const css = allowed('/* css-lint-allow tokens/motion-literal: safety net */')
    expect(lint(css.replaceAll('\n', '\r\n'))).toEqual([])
  })
})

describe('css-lint CLI', () => {
  let temp: string | undefined
  afterEach(() => {
    if (temp !== undefined) rmSync(temp, { recursive: true, force: true })
    temp = undefined
  })

  const tempRoot = (): string => {
    temp = mkdtempSync(join(tmpdir(), 'css-lint-'))
    mkdirSync(join(temp, 'src/ui/styles'), { recursive: true })
    mkdirSync(join(temp, 'app/nested'), { recursive: true })
    writeFileSync(join(temp, TOKENS_FILE), ':root {\n  --color-text: #f0e6d0;\n}\n')
    writeFileSync(
      join(temp, 'app/nested/page.module.css'),
      '.a {\n  color: var(--color-text);\n}\n',
    )
    writeFileSync(join(temp, 'app/nested/notes.txt'), 'margin-left: 0')
    return temp
  }

  it('formats a finding as file:line:col rule message', () => {
    expect(
      formatFinding({
        file: 'app/a.css',
        line: 2,
        column: 3,
        rule: 'rc12/physical-property',
        message: 'm',
      }),
    ).toBe('app/a.css:2:3 rc12/physical-property m')
  })

  it('lints every app/ and src/ stylesheet when no file is named', () => {
    const root = tempRoot()
    expect(collectCssFiles(root)).toEqual(['app/nested/page.module.css', TOKENS_FILE])
    const out: string[] = []
    expect(runCssLint(root, [], root, (line) => out.push(line))).toBe(0)
    expect(out).toEqual(['css-lint: 2 files, no findings'])

    writeFileSync(
      join(root, 'src/ui/bad.css'),
      '.b {\r\n  margin-left: 0;\r\n  color: red;\r\n}\r\n',
    )
    out.length = 0
    expect(runCssLint(root, [], root, (line) => out.push(line))).toBe(1)
    expect(out).toEqual([
      'src/ui/bad.css:2:3 rc12/physical-property "margin-left" is a physical property; use its logical form (inline-start / inline-end)',
      'src/ui/bad.css:3:10 tokens/color-literal named colour "red" outside tokens.css; use a --color-* token',
      'css-lint: 2 findings in 1 of 3 files',
    ])
  })

  it('lints only the files named, resolved against the working directory', () => {
    const root = tempRoot()
    const outside = join(root, '..', `${root.split(/[\\/]/).pop() ?? 'x'}-outside.css`)
    writeFileSync(
      outside,
      '.c {\n  margin-left: 0;\n  color: #fff;\n  transform: translateX(4px);\n}\n',
    )
    try {
      const out: string[] = []
      expect(runCssLint(root, [outside], root, (line) => out.push(line))).toBe(1)
      expect(out).toHaveLength(4)
      expect(out[3]).toBe('css-lint: 3 findings in 1 of 1 file')
      expect(out.slice(0, 3).map((line) => line.split(' ')[1])).toEqual([
        'rc12/physical-property',
        'tokens/color-literal',
        'rc12/translate-x',
      ])

      out.length = 0
      expect(
        runCssLint(root, ['nested/page.module.css'], join(root, 'app'), (l) => out.push(l)),
      ).toBe(0)
      expect(out).toEqual(['css-lint: 1 file, no findings'])
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('exits 1 on a file it cannot read', () => {
    const root = tempRoot()
    const out: string[] = []
    expect(runCssLint(root, ['missing.css'], root, (line) => out.push(line))).toBe(1)
    expect(out).toEqual(['missing.css: cannot read (ENOENT)'])
  })
})

describe('css-lint CLI (real process, exit code)', () => {
  // Runs the CLI as `pnpm lint` does (tsx scripts/lint/css-lint.ts), so a broken entry-point guard
  // cannot turn the CSS half of `pnpm lint` into a silent exit 0.
  const runCli = (args: readonly string[]) =>
    spawnSync(
      process.execPath,
      [join(storyboard, 'node_modules/tsx/dist/cli.mjs'), 'scripts/lint/css-lint.ts', ...args],
      { cwd: storyboard, encoding: 'utf8' },
    )

  it('exits 1 with 3 findings on the seeded violations', () => {
    const temp = mkdtempSync(join(tmpdir(), 'css-lint-cli-'))
    try {
      const seed = join(temp, 'seed.css')
      writeFileSync(
        seed,
        '.seed {\n  margin-left: 1rem;\n  color: #fff;\n  transform: translateX(4px);\n}\n',
      )
      const result = runCli([seed])
      expect(result.status, result.stderr).toBe(1)
      // A file outside the repo is shown by its absolute path, with forward slashes.
      const shown = seed.split('\\').join('/')
      const lines = result.stdout.trimEnd().split('\n')
      expect(lines).toHaveLength(4)
      expect(
        lines
          .slice(0, 3)
          .map((line) =>
            line.startsWith(`${shown}:`)
              ? line.slice(shown.length).split(' ').slice(0, 2).join(' ')
              : line,
          ),
      ).toEqual([
        ':2:3 rc12/physical-property',
        ':3:10 tokens/color-literal',
        ':4:14 rc12/translate-x',
      ])
      expect(lines[3]).toBe('css-lint: 3 findings in 1 of 1 file')
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }, 30_000)

  it('exits 0 on the repo CSS and prints the summary line', () => {
    const result = runCli([])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/^css-lint: \d+ files?, no findings\n$/)
  }, 30_000)
})

describe('the repo', () => {
  it('runs the CSS lint in `pnpm lint`, after ESLint', () => {
    const { scripts } = z
      .object({ scripts: z.record(z.string(), z.string()) })
      .parse(JSON.parse(readFileSync(join(storyboard, 'package.json'), 'utf8')))
    expect(scripts.lint).toBe('eslint . && tsx scripts/lint/css-lint.ts')
  })

  it('has zero findings in its real CSS', () => {
    const files = collectCssFiles(storyboard)
    expect(files).toEqual(expect.arrayContaining([TOKENS_FILE, BASE_FILE]))
    const tokens = declaredCustomProperties(readFileSync(join(storyboard, TOKENS_FILE), 'utf8'))
    const findings = files.flatMap((file) =>
      lintCss(readFileSync(join(storyboard, file), 'utf8'), { file, tokens }).map(formatFinding),
    )
    expect(findings).toEqual([])
    const out: string[] = []
    expect(runCssLint(storyboard, [], storyboard, (line) => out.push(line))).toBe(0)
  })

  it('uses the escape hatch in base.css only for the two reduced-motion time literals', () => {
    const base = readFileSync(join(storyboard, BASE_FILE), 'utf8')
    const allows = [...base.matchAll(/css-lint-allow ([^\s:]+):/g)].map((m) => m[1])
    expect(allows).toEqual(['tokens/motion-literal', 'tokens/motion-literal'])
    const tokens = declaredCustomProperties(readFileSync(join(storyboard, TOKENS_FILE), 'utf8'))
    const stripped = base.replace(/\/\* css-lint-allow[^*]*\*\//g, '')
    expect(lintCss(stripped, { file: BASE_FILE, tokens }).map((f) => f.rule)).toEqual([
      'tokens/motion-literal',
      'tokens/motion-literal',
    ])
  })
})
