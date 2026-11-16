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

// P1-1c (design p1-step7-design.md §8.2): one seeded violation per new fence pattern and rule.
const STATIC_ONLY = 'Reader pages are static: no request-time APIs'
const NO_NEXT_INTL = 'No next-intl'
const ONLY_MESSAGES_TS = 'Only src/ui/i18n/messages.ts imports messages/*.json'
const NO_ENV = 'Reader code does not read process.env'
const NO_COOKIES = 'The site sets no cookies'
const STORAGE_ONLY = 'Web Storage is used only by src/reader/progress/device-storage.ts'

/** The messages (all errors) of one rule for a sample file. */
async function ruleErrors(file: string, code: string, ruleId: string): Promise<string[]> {
  const messages = (await lint(file, code)).filter((m) => m.ruleId === ruleId)
  expect(messages.every((m) => m.severity === 2)).toBe(true)
  return messages.map((m) => m.message)
}

const READER_SAMPLES = ['app/lint-sample.ts', 'src/ui/lint-sample.ts', 'src/reader/lint-sample.ts']

/** One import line per new reader-fence pattern, with the message it must raise. */
const NEW_FENCE_IMPORTS: readonly (readonly [string, string])[] = [
  ["import 'next/headers'", STATIC_ONLY],
  ["import 'next/server'", STATIC_ONLY],
  ["import 'next/root-params'", STATIC_ONLY],
  ["import 'next-intl'", NO_NEXT_INTL],
  ["import 'next-intl/navigation'", NO_NEXT_INTL],
  ["import en from '../../messages/en.json'\nvoid en", ONLY_MESSAGES_TS],
  ["import hi from '@/../messages/hi.json'\nvoid hi", ONLY_MESSAGES_TS],
]

/** Every older reader-fence pattern, which the two exception blocks must keep. */
const OLD_FENCE_IMPORTS: readonly (readonly [string, string])[] = [
  ["import '@supabase/supabase-js'", 'Reader code must not import Supabase clients.'],
  ["import '../../scripts/load-content'", 'Reader code must not import scripts/.'],
  ["import '../../tools/publisher/cli'", 'Reader code must not import tools/.'],
  ["import 'next/font/google'", NETWORK],
  ["import 'next/og'", NETWORK],
]

describe('reader fence: P1-1c imports (design §8.2)', () => {
  it.each(READER_SAMPLES.flatMap((file) => NEW_FENCE_IMPORTS.map(([line, m]) => [file, line, m])))(
    '%s: %s is an error',
    async (file, line, message) => {
      expect(await importErrors(file, line)).toEqual([expect.stringContaining(message)])
    },
  )

  it('fences the catalogues in tests too (they read the files with readFileSync)', async () => {
    expect(
      await importErrors(
        'src/ui/i18n/lint-sample.test.ts',
        "import en from '../../../messages/en.json'",
      ),
    ).toEqual([expect.stringContaining(ONLY_MESSAGES_TS)])
  })

  it('src/ui/i18n/messages.ts may import the catalogues', async () => {
    const code = [
      "import en from '../../../messages/en.json'",
      "import hi from '../../../messages/hi.json'",
      'void en',
      'void hi',
    ].join('\n')
    expect(await importErrors('src/ui/i18n/messages.ts', code)).toEqual([])
  })

  it.each([
    ...OLD_FENCE_IMPORTS,
    ...NEW_FENCE_IMPORTS.filter(([, message]) => message !== ONLY_MESSAGES_TS),
  ])('src/ui/i18n/messages.ts keeps every other pattern: %s', async (line, message) => {
    expect(await importErrors('src/ui/i18n/messages.ts', line)).toEqual([
      expect.stringContaining(message),
    ])
  })

  it.each(["import 'next/headers'", "import 'next/server'"])(
    'app/api/** may use request-time APIs (Step 20): %s',
    async (line) => {
      expect(await importErrors('app/api/report/route.ts', line)).toEqual([])
    },
  )

  it.each([
    ...OLD_FENCE_IMPORTS,
    ...NEW_FENCE_IMPORTS.filter(([line]) => !/next\/(headers|server)'/.test(line)),
  ])('app/api/** keeps every other pattern: %s', async (line, message) => {
    expect(await importErrors('app/api/report/route.ts', line)).toEqual([
      expect.stringContaining(message),
    ])
  })
})

describe('reader fence: env, cookies and Web Storage (design §8.2)', () => {
  const PROPERTIES = 'no-restricted-properties'
  const GLOBALS = 'no-restricted-globals'
  const PROPERTY_SAMPLES: readonly (readonly [string, string])[] = [
    ['export const flag = process.env.FLAG', NO_ENV],
    ['const { env } = process\nexport const flag = env.FLAG', NO_ENV],
    ["document.cookie = 'a=b'", NO_COOKIES],
    ["export const v = window.localStorage.getItem('k')", STORAGE_ONLY],
    ["export const v = window.sessionStorage.getItem('k')", STORAGE_ONLY],
  ]
  const GLOBAL_SAMPLES: readonly (readonly [string, string])[] = [
    ["export const v = localStorage.getItem('k')", STORAGE_ONLY],
    ["export const v = sessionStorage.getItem('k')", STORAGE_ONLY],
    ["export const v = cookieStore.get('k')", NO_COOKIES],
  ]

  it.each(
    READER_SAMPLES.flatMap((file) =>
      PROPERTY_SAMPLES.map(([code, message]) => [file, code, message] as const),
    ),
  )('%s: no-restricted-properties rejects %s', async (file, code, message) => {
    expect(await ruleErrors(file, code, PROPERTIES)).toEqual([expect.stringContaining(message)])
  })

  it.each(
    READER_SAMPLES.flatMap((file) =>
      GLOBAL_SAMPLES.map(([code, message]) => [file, code, message] as const),
    ),
  )('%s: no-restricted-globals rejects %s', async (file, code, message) => {
    expect(await ruleErrors(file, code, GLOBALS)).toEqual([expect.stringContaining(message)])
  })

  it('cover .tsx files too', async () => {
    const code = 'export function C() {\n  return <p>{process.env.X}</p>\n}\n'
    expect(await ruleErrors('src/ui/lint-sample.tsx', code, PROPERTIES)).toEqual([
      expect.stringContaining(NO_ENV),
    ])
  })

  it('src/reader/progress/device-storage.ts may use Web Storage, but not env or cookies', async () => {
    const file = 'src/reader/progress/device-storage.ts'
    const storage = [
      "export const a = window.localStorage.getItem('k')",
      "export const b = window.sessionStorage.getItem('k')",
      "export const c = localStorage.getItem('k')",
      "export const d = sessionStorage.getItem('k')",
    ].join('\n')
    expect(await ruleErrors(file, storage, PROPERTIES)).toEqual([])
    expect(await ruleErrors(file, storage, GLOBALS)).toEqual([])
    expect(await ruleErrors(file, 'export const f = process.env.F', PROPERTIES)).toEqual([
      expect.stringContaining(NO_ENV),
    ])
    expect(await ruleErrors(file, "document.cookie = 'a=b'", PROPERTIES)).toEqual([
      expect.stringContaining(NO_COOKIES),
    ])
    expect(await ruleErrors(file, "export const v = cookieStore.get('k')", GLOBALS)).toEqual([
      expect.stringContaining(NO_COOKIES),
    ])
  })

  it('app/api/** may read process.env (Step 20), but not cookies or Web Storage', async () => {
    const file = 'app/api/report/route.ts'
    expect(await ruleErrors(file, 'export const url = process.env.READER_DB', PROPERTIES)).toEqual(
      [],
    )
    expect(await ruleErrors(file, "document.cookie = 'a=b'", PROPERTIES)).toEqual([
      expect.stringContaining(NO_COOKIES),
    ])
    expect(
      await ruleErrors(file, "export const v = window.localStorage.getItem('k')", PROPERTIES),
    ).toEqual([expect.stringContaining(STORAGE_ONLY)])
    expect(await ruleErrors(file, "export const v = localStorage.getItem('k')", GLOBALS)).toEqual([
      expect.stringContaining(STORAGE_ONLY),
    ])
  })

  it('leave test files alone (they use fakes)', async () => {
    const code = [
      'export const a = process.env.A',
      "document.cookie = 'a=b'",
      "export const b = window.localStorage.getItem('k')",
      "export const c = localStorage.getItem('k')",
      "export const d = cookieStore.get('k')",
    ].join('\n')
    for (const file of ['src/ui/lint-sample.test.ts', 'src/reader/lint-sample.test.ts']) {
      expect(await ruleErrors(file, code, PROPERTIES)).toEqual([])
      expect(await ruleErrors(file, code, GLOBALS)).toEqual([])
    }
  })

  it('do not reach code outside the reader (src/config reads the launch flag)', async () => {
    const code = 'export const flag = process.env.FLAG'
    expect(await ruleErrors('src/config/lint-sample.ts', code, PROPERTIES)).toEqual([])
  })
})

// P1-2b (design p1-step8-design.md §2, §8): src/content joins READER_FILES, so the reader fence and
// NO_ENV reach the content reader; node:fs, node:crypto and process.cwd() stay allowed there.
describe('reader fence: src/content (P1-2b)', () => {
  const SAMPLE = 'src/content/lint-sample.ts'

  it.each([
    ['export const source = process.env.CONTENT_SOURCE', NO_ENV],
    ['const { env } = process\nexport const source = env.CONTENT_SOURCE', NO_ENV],
    ["document.cookie = 'a=b'", NO_COOKIES],
  ])('rejects %s', async (code, message) => {
    expect(await ruleErrors(SAMPLE, code, 'no-restricted-properties')).toEqual([
      expect.stringContaining(message),
    ])
  })

  it.each([
    ["import '../../scripts/load-content'", 'Reader code must not import scripts/.'],
    ["import { outputPaths } from '../../scripts/load-content'\nvoid outputPaths", 'scripts/'],
    ["import '../../tools/migrate/waiver-keys-cli'", 'Reader code must not import tools/.'],
    ["import '../../tools/publisher/cli'", 'Reader code must not import tools/.'],
    ["import '@supabase/supabase-js'", 'Reader code must not import Supabase clients.'],
    ["import 'next/headers'", STATIC_ONLY],
  ])('rejects %s', async (line, message) => {
    expect(await importErrors(SAMPLE, line)).toEqual([expect.stringContaining(message)])
  })

  it('keeps the import fence in its tests too', async () => {
    expect(
      await importErrors('src/content/lint-sample.test.ts', "import '../../scripts/load-content'"),
    ).toEqual([expect.stringContaining('Reader code must not import scripts/.')])
  })

  it("allows server-only, node:fs, node:crypto and process.cwd() (the reader's own needs)", async () => {
    const code = [
      "import 'server-only'",
      "import { createHash } from 'node:crypto'",
      "import { readFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "import { CONTENT_DIR } from '../core/content/output-layout'",
      "export const read = () => createHash('sha256').update(readFileSync(join(process.cwd(), CONTENT_DIR))).digest('hex')",
    ].join('\n')
    const errors = (await lint(SAMPLE, `${code}\n`)).filter((m) => m.severity === 2)
    expect(errors).toEqual([])
  })
})

// P1-4b (design p1-step10-design.md §9.1 G3; probe R16): the player fence. Every sample is linted
// with the real config at a path under src/ui/player or src/reader/player, so eslint-config-next's
// browser globals apply (checkGlobalObject reports self. and window. only for declared globals).
// Each negative names exactly the fence rules that must report it, so a dropped rule or selector
// fails a test even where another rule also reports the sample.
describe('player fence (P1-4b, design p1-step10 §9.1 G3)', () => {
  const G = 'no-restricted-globals'
  const P = 'no-restricted-properties'
  const S = 'no-restricted-syntax'
  const FENCE = [G, P, S]
  const PLAYER_TS = ['src/ui/player/lint-sample.ts', 'src/reader/player/lint-sample.ts']
  const PLAYER_TSX = 'src/ui/player/lint-sample.tsx'
  /** Every message a fence rule may give in a player file: the player's own and the inherited. */
  const MESSAGES = ['design p1-step10-design.md', STORAGE_ONLY, NO_COOKIES, NO_ENV, ONLY_CUSTOM]

  /** The fence rules (sorted, once each) that report `code` in `file`; every one is an error. */
  async function fenceRules(file: string, code: string): Promise<string[]> {
    const messages = (await lint(file, `${code}\n`)).filter((m) => FENCE.includes(m.ruleId ?? ''))
    expect(messages.every((m) => m.severity === 2)).toBe(true)
    for (const m of messages) {
      expect(
        MESSAGES.some((known) => m.message.includes(known)),
        m.message,
      ).toBe(true)
    }
    return [...new Set(messages.map((m) => m.ruleId ?? ''))].sort()
  }

  /** §9.1 G3's negatives (and C10's), plus alias forms only a member selector catches. */
  const NEGATIVES: readonly (readonly [string, readonly string[]])[] = [
    ["export const r = fetch('/x')", [G]],
    ["export const r = globalThis.fetch('/x')", [G, P, S]],
    ["export const r = self.fetch('/x')", [G, P, S]],
    ["export const r = window['fetch']('/x')", [G, P, S]],
    ["export const r = self['fetch']('/x')", [G, P, S]],
    ['export const v = navigator.userAgent', [P, S]],
    ["export const v = navigator['userAgent']", [P, S]],
    ['export const v = window.navigator.userAgent', [S]],
    ['const { userAgent } = navigator\nexport const v = userAgent', [P, S]],
    ['export const v = navigator?.userAgent', [P, S]],
    ['export const v = navigator.userAgentData', [P, S]],
    ['export const v = navigator.platform', [P, S]],
    ['export const t = performance.now()', [G, P]],
    ["export const t = performance['now']()", [G, P, S]],
    ['export const t = performance?.now()', [G, P]],
    ['export const t = performance.timeOrigin', [G, P]],
    ['const { now } = performance\nexport const t = now()', [G, P]],
    // Review F2, T4: the performance clock through a global object or an alias.
    ['export const t = window.performance.now()', [G, P, S]],
    ['export const t = globalThis.performance.now()', [G, P, S]],
    ['export const t = self.performance.timeOrigin', [G, P, S]],
    ["export const t = window['performance'].now()", [G, P, S]],
    ['const p = performance\nexport const t = p.now()', [G]],
    ['const { performance: p } = window\nexport const t = p.now()', [P, S]],
    ['const w = window\nexport const t = w.performance.now()', [S]],
    ["const w = window\nexport const t = w['performance'].timeOrigin", [S]],
    ["const { fetch: f } = window\nexport const r = f('/x')", [P, S]],
    // Review F2: the platform names and sendBeacon through a global object, computed or destructured.
    ['export const v = window.navigator.platform', [S]],
    ['export const v = globalThis.navigator.userAgentData', [S]],
    ["export const v = window.navigator['userAgentData']", [S]],
    ["export const v = navigator['platform']", [P, S]],
    ['const { platform } = window.navigator\nexport const v = platform', [S]],
    ["declare const u: string\nnavigator['sendBeacon'](u)", [S]],
    ['declare const u: string\nwindow.navigator.sendBeacon(u)', [S]],
    ['const { sendBeacon } = navigator\nexport const s = sendBeacon', [S]],
    [
      "declare const preload: (h: string, o: object) => void\npreload('x', { crossOrigin: '' })",
      [S],
    ],
    ["export const o = { 'crossOrigin': '' }", [S]],
    ["declare const img: HTMLImageElement\nimg.crossOrigin = ''", [S]],
    ["declare const img: HTMLImageElement\nimg['crossOrigin'] = ''", [S]],
    ["declare const el: HTMLElement\nel.setAttribute('crossorigin', '')", [S]],
    ['declare const u: string\nnavigator.sendBeacon(u)', [S]],
    ['export const x = new XMLHttpRequest()', [G]],
    ["export const x = new EventSource('/x')", [G]],
    ["export const x = new WebSocket('wss://x')", [G]],
    // The inherited reader fence (env, cookies, Web Storage) still applies in the player.
    ["export const v = localStorage.getItem('k')", [G]],
    ['export const v = globalThis.localStorage', [G]],
    ['export const v = self.sessionStorage', [G]],
    ["export const v = window.localStorage.getItem('k')", [G, P]],
    ["export const v = cookieStore.get('k')", [G]],
    ["document.cookie = 'a=b'", [P]],
    ['export const v = process.env.X', [P]],
    // Aliases: only the member selectors see these.
    ["const w = window\nexport const r = w.fetch('/x')", [S]],
    ["const w = window\nexport const r = w['fetch']('/x')", [S]],
    ['const n = navigator\nexport const v = n.userAgent', [S]],
    ["const n = navigator\nexport const v = n['userAgent']", [S]],
    // Second review R2-G3-1: fetch and the request constructors through an alias or destructured.
    ["const w = window\nconst { fetch: f } = w\nexport const r = f('/x')", [S]],
    ["const { fetch: f } = document.defaultView!\nexport const r = f('/x')", [S]],
    ["const w = globalThis\nconst { fetch } = w\nexport const r = fetch('/x')", [S]],
    ['const w = window\nexport const x = new w.XMLHttpRequest()', [S]],
    ["const w = globalThis\nexport const x = new w.WebSocket('wss://x')", [S]],
    ["export const x = new (document.defaultView!.EventSource)('/x')", [S]],
    ['const { XMLHttpRequest: X } = window\nexport const x = new X()', [S]],
    ["const { WebSocket: W } = globalThis\nexport const x = new W('wss://x')", [S]],
    // R2-G3-2: crossorigin through other DOM APIs, a computed callee, a template or a pattern.
    ["declare const el: HTMLElement\nel.toggleAttribute('crossorigin')", [S]],
    ["declare const el: HTMLElement\nel.setAttributeNS(null, 'crossorigin', '')", [S]],
    ["declare const el: HTMLElement\nel['setAttribute']('crossorigin', '')", [S]],
    ["declare const el: HTMLElement\nel.setAttribute(`crossorigin`, '')", [S]],
    ["declare const img: HTMLImageElement\nimg[`crossOrigin`] = ''", [S]],
    ["declare const img: HTMLImageElement\nReflect.set(img, 'crossOrigin', '')", [S]],
    [
      "declare const img: HTMLImageElement\nObject.defineProperty(img, 'crossOrigin', { value: '' })",
      [S],
    ],
    ["declare const img: HTMLImageElement\n;[img.crossOrigin] = ['']", [S]],
    // R2-G3-3: template keys and computed destructuring keys, on navigator itself too.
    ['declare const u: string\nnavigator[`sendBeacon`](u)', [S]],
    ["const { ['sendBeacon']: b } = navigator\nexport const s = b", [S]],
    ['const n = navigator\nexport const v = n[`userAgent`]', [S]],
    ["const n = navigator\nconst { ['userAgent']: ua } = n\nexport const v = ua", [S]],
    ['export const v = document.defaultView!.navigator[`platform`]', [S]],
    ['const w = window\nexport const t = w[`performance`].now()', [S]],
    ['export const t = document.defaultView![`performance`].now()', [S]],
    ["const w = window\nconst { ['performance']: p } = w\nexport const t = p.now()", [S]],
    ['const w = window\nconst { [`performance`]: p } = w\nexport const t = p.now()', [S]],
    ["const w = window\nexport const r = w[`fetch`]('/x')", [S]],
    ["export const r = document.defaultView![`fetch`]('/x')", [S]],
    // R2-G3-5: Reflect with a literal name (design §9.1 G3 listed the first as a limit).
    ["export const f = Reflect.get(globalThis, 'fetch')", [S]],
    ["export const v = Reflect.get(navigator, 'userAgent')", [S]],
    ["export const s = Reflect.get(navigator, 'sendBeacon')", [S]],
    ["export const t = Reflect.get(globalThis, 'performance')", [S]],
    // R2-G3-6: the other user-agent and platform names.
    ['export const v = navigator.appVersion', [P, S]],
    ['export const v = navigator.vendor', [P, S]],
    ['export const v = navigator.oscpu', [P, S]],
    ['export const v = navigator.appName', [P, S]],
    ['export const v = window.navigator.appVersion', [S]],
    ['const { vendor } = navigator\nexport const v = vendor', [P, S]],
  ]

  it.each(
    PLAYER_TS.flatMap((file) => NEGATIVES.map(([code, rules]) => [file, code, rules] as const)),
  )('%s: rejects %s', async (file, code, rules) => {
    expect(await fenceRules(file, code)).toEqual(rules)
  })

  it.each(NEGATIVES)('src/ui/player/*.tsx: rejects %s', async (code, rules) => {
    expect(await fenceRules(PLAYER_TSX, code)).toEqual(rules)
  })

  it.each([
    ['<img crossOrigin="" alt="" />', [S]],
    ['<img crossorigin="anonymous" alt="" />', [S]],
    ['<link crossorigin="" />', [S]],
    ["<div style={{ color: 'red' }} />", [S]], // the inherited JSX style rule
  ])('src/ui/player/*.tsx: rejects %s', async (jsx, rules) => {
    expect(await fenceRules(PLAYER_TSX, `export const a = ${jsx}`)).toEqual(rules)
  })

  it('keeps every inherited JSX style rule in the player, message for message', async () => {
    for (const [jsx, expected] of [
      ['<div style={{ marginLeft: 1 }} />', [ONLY_CUSTOM]],
      ['<div style={{ [key]: 1 }} />', [ONLY_CUSTOM]],
      ["<div style={{ '--x': '#fff' }} />", [NO_COLOR]],
      ['<div style={{ ...base }} />', [NO_SPREAD]],
      ['<div style={base} />', [ONLY_OBJECT]],
      ["<style>{'a { color: red }'}</style>", [NO_STYLE_ELEMENT]],
    ] as const) {
      expect(await styleErrors(jsx, PLAYER_TSX), jsx).toEqual(expected)
    }
  })

  it('leaves what the player needs alone (the 6 probe positives and the globals it uses)', async () => {
    const positives: readonly (readonly [string, string])[] = [
      [
        'src/ui/player/lint-sample.ts',
        "declare const controller: { dispatch(a: object): unknown }\nexport const r = controller.dispatch({ type: 'CHOOSE', seq: 1, choiceId: 'c1' })",
      ],
      [
        'src/ui/player/lint-sample.ts',
        "import { preload } from 'react-dom'\ndeclare const src: string, s: string, z: string\npreload(src, { as: 'image', imageSrcSet: s, imageSizes: z, fetchPriority: 'low' })",
      ],
      [
        PLAYER_TSX,
        'declare const s: string, z: string, u: string\nexport const a = <img srcSet={s} sizes={z} src={u} width={1} height={1} fetchPriority="high" alt="" />',
      ],
      [
        'src/ui/player/lint-sample.ts',
        'declare const title: string, url: string\nvoid navigator.share?.({ title, url })',
      ],
      [
        'src/ui/player/lint-sample.ts',
        'declare const url: string\nvoid navigator.clipboard?.writeText(url)',
      ],
      ['src/reader/player/lint-sample.ts', 'export const t = setTimeout(() => {}, 500)'],
      ['src/ui/player/lint-sample.ts', 'export const t = window.setTimeout(() => {}, 500)'],
      ['src/ui/player/lint-sample.ts', 'window.location.reload()'],
      [
        'src/ui/player/lint-sample.ts',
        "document.documentElement.removeAttribute('data-saved-run')",
      ],
      [
        'src/ui/player/lint-sample.ts',
        "declare const el: HTMLElement\nel.scrollIntoView({ block: 'start' })\nel.focus({ preventScroll: true })",
      ],
      ['src/ui/player/lint-sample.ts', 'export const d = Date.now()'],
    ]
    for (const [file, code] of positives) {
      const errors = (await lint(file, `${code}\n`)).filter((m) => m.severity === 2)
      expect(errors, code).toEqual([])
    }
  })

  it('covers nested player folders, and stops at the two player folders and their tests', async () => {
    const fetchCode = "export const r = fetch('/x')"
    for (const file of [
      'src/ui/player/deep/lint-sample.tsx',
      'src/reader/player/deep/lint-sample.ts',
      // Review T3: a .tsx file under src/reader/player is fenced too.
      'src/reader/player/lint-sample.tsx',
      'src/reader/player/deep/lint-sample.tsx',
    ]) {
      expect(await fenceRules(file, fetchCode), file).toEqual([G])
    }
    // narration-controller.ts uses performance.now as a duration clock (design §9.1 G3).
    expect(
      await fenceRules('src/reader/narration/lint-sample.ts', 'export const t = performance.now()'),
    ).toEqual([])
    expect(await fenceRules('src/ui/lint-sample.ts', fetchCode)).toEqual([])
    const all = [
      fetchCode,
      "export const v = localStorage.getItem('k')",
      'export const e = process.env.X',
      'export const t = performance.now()',
      'export const u = navigator.userAgent',
    ].join('\n')
    for (const file of [
      'src/ui/player/lint-sample.test.ts',
      'src/reader/player/lint-sample.test.ts',
    ]) {
      expect(await fenceRules(file, all), file).toEqual([])
    }
    // The sniffing and clock names stay allowed outside the player (src/ui, the narration code).
    expect(
      await fenceRules(
        'src/ui/lint-sample.ts',
        'export const v = window.navigator.platform\nexport const t = window.performance.now()',
      ),
    ).toEqual([])
  })

  it('covers a player file with any other script extension, imports included (R2-G3-4)', async () => {
    const supabase = "import '@supabase/supabase-js'"
    for (const base of ['src/ui/player/lint-sample', 'src/reader/player/deep/lint-sample']) {
      for (const extension of ['mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']) {
        const file = `${base}.${extension}`
        expect(await fenceRules(file, "fetch('/x')"), file).toEqual([G])
        if (extension === 'cjs') continue // CommonJS: an import statement does not parse
        expect(await importErrors(file, supabase), file).toEqual([
          expect.stringContaining('Reader code must not import Supabase clients.'),
        ])
      }
    }
  })

  it('documented limits (design §9.1 G3): a name assembled at run time', async () => {
    for (const code of [
      "const k = 'fe' + 'tch'\nexport const f = { ...globalThis }[k]",
      "export const f = Reflect.get(globalThis, ['fe', 'tch'].join(''))",
    ]) {
      expect(await fenceRules('src/ui/player/lint-sample.ts', code), code).toEqual([])
    }
  })
})

describe('eslint-config-next is still applied', () => {
  it('fires a typescript-eslint rule on a .ts sample', async () => {
    const messages = await lint('src/reader/lint-sample.ts', 'export const value: any = 1\n')
    expect(messages.map((m) => m.ruleId)).toContain('@typescript-eslint/no-explicit-any')
  })
})
