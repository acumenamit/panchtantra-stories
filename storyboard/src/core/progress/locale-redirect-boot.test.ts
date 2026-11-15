// The gate's redirect script (P1 D8 G1; design p1-step7-design.md §7 item 21, §8.1 item 3; P1-1c).
// The exact string runs in node:vm with a fake performance, localStorage and location. On a normal
// navigation it must send the visitor to readPrefs(raw).record.uiLocale whenever the read gives a
// record and that locale is enabled, and nowhere otherwise: on fixed cases and 20,000 fast-check
// runs (seed 20261114). Any other navigation type never redirects. It never writes, never throws,
// stays ES5 and under 1 KB with no "</script", "<!--" or backtick, and its SHA-256 is pinned here.
import { createHash } from 'node:crypto'
import { Script, createContext } from 'node:vm'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { ENABLED_LOCALE_CODES } from '../locales'
import { LOCALE_REDIRECT_SCRIPT, REDIRECT_LOCALES } from './locale-redirect-boot'
import { PREFS_KEY, UI_LOCALES, readPrefs } from './records'

const SEED = 20261114

/** P1-1c: 637 bytes, this SHA-256 (base64). A change to the key, schema or locales moves it. */
const PINNED_BYTES = 637
const PINNED_SHA256 = 'm9Jb3eY0VZq9VX6TcgRpgEW0Yql0kRwNG+QJEarmCFc='

type Navigation =
  | { readonly kind: 'entry'; readonly type: string }
  | { readonly kind: 'no-entry' }
  | { readonly kind: 'no-performance' }
  | { readonly kind: 'throws' }

type Stored =
  | { readonly kind: 'value'; readonly raw: string | null }
  | { readonly kind: 'getItem-throws' }
  | { readonly kind: 'getter-throws' }

interface Outcome {
  /** The URL passed to location.replace, or null. */
  readonly redirect: string | null
  readonly replaceCalls: number
  readonly reads: number
  readonly writes: number
}

/** One vm context and one compiled script; each run swaps the navigation and what storage holds. */
function makeHarness(): (stored: Stored, navigation?: Navigation) => Outcome {
  let stored: Stored = { kind: 'value', raw: null }
  let navigation: Navigation = { kind: 'entry', type: 'navigate' }
  let replaced: string[] = []
  let reads = 0
  let writes = 0
  const storage = {
    getItem(key: string): string | null {
      reads++
      if (stored.kind === 'getItem-throws') throw new Error('SecurityError: getItem')
      return stored.kind === 'value' && key === PREFS_KEY ? stored.raw : null
    },
    setItem(): void {
      writes++
    },
    removeItem(): void {
      writes++
    },
    clear(): void {
      writes++
    },
  }
  const performance = {
    getEntriesByType(type: string): { type: string }[] {
      if (navigation.kind === 'throws') throw new Error('getEntriesByType')
      if (type !== 'navigation' || navigation.kind !== 'entry') return []
      return [{ type: navigation.type }]
    },
  }
  const location = {
    replace(url: string): void {
      replaced.push(String(url))
    },
    assign(): void {
      writes++
    },
    reload(): void {
      writes++
    },
  }
  Object.defineProperty(location, 'href', {
    get: () => 'https://example.test/',
    set: () => {
      writes++
    },
  })
  const sandbox = { location }
  Object.defineProperty(sandbox, 'performance', {
    enumerable: true,
    get() {
      if (navigation.kind === 'no-performance') throw new ReferenceError('performance')
      return performance
    },
  })
  Object.defineProperty(sandbox, 'localStorage', {
    enumerable: true,
    get() {
      if (stored.kind === 'getter-throws') throw new Error('SecurityError: localStorage')
      return storage
    },
  })
  const context = createContext(sandbox)
  const script = new Script(LOCALE_REDIRECT_SCRIPT)
  return (next, nav = { kind: 'entry', type: 'navigate' }) => {
    stored = next
    navigation = nav
    replaced = []
    reads = 0
    writes = 0
    script.runInContext(context)
    return { redirect: replaced[0] ?? null, replaceCalls: replaced.length, reads, writes }
  }
}

const run = makeHarness()
const stored = (raw: string | null): Stored => ({ kind: 'value', raw })

/** Where the prefs reader says a returning visitor belongs: '/{uiLocale}', or null for the gate. */
function expectedTarget(raw: string | null): string | null {
  const read = readPrefs(raw)
  if (read.kind !== 'record') return null
  const locale = read.record.uiLocale
  return locale !== null && REDIRECT_LOCALES.includes(locale) ? `/${locale}` : null
}

/** A prefs record with a "__proto__" key in an object at this depth (the record is depth 0). */
function protoAtDepth(depth: number): string {
  let inner = '{"__proto__":0}'
  for (let d = depth; d > 1; d--) inner = `{"a":${inner}}`
  return `{"schema":1,"uiLocale":"hi","textScale":100,"readToMe":false,"x":${inner}}`
}

const prefs = (uiLocale: string, schema = '1'): string =>
  `{"schema":${schema},"uiLocale":${uiLocale},"textScale":100,"readToMe":false}`

describe('LOCALE_REDIRECT_SCRIPT', () => {
  it('follows exactly the enabled UI locales, en and hi today', () => {
    expect(REDIRECT_LOCALES).toEqual(['en', 'hi'])
    expect(REDIRECT_LOCALES.every((c) => (UI_LOCALES as readonly string[]).includes(c))).toBe(true)
    expect(REDIRECT_LOCALES.every((c) => ENABLED_LOCALE_CODES.some((e) => e === c))).toBe(true)
  })

  it.each<[string, string | null, string | null]>([
    ['uiLocale hi', prefs('"hi"'), '/hi'],
    ['uiLocale en', prefs('"en"'), '/en'],
    ['uiLocale ar (not a UI locale)', prefs('"ar"'), null],
    ['uiLocale EN (case matters)', prefs('"EN"'), null],
    ['uiLocale "hi " (no trimming)', prefs('"hi "'), null],
    ['uiLocale null (not chosen)', prefs('null'), null],
    ['uiLocale 1', prefs('1'), null],
    ['uiLocale ["hi"]', prefs('["hi"]'), null],
    ['no uiLocale', '{"schema":1,"textScale":100,"readToMe":false}', null],
    ['only schema and uiLocale', '{"schema":1,"uiLocale":"hi"}', '/hi'],
    ['other fields invalid, uiLocale valid', '{"schema":1,"uiLocale":"hi","textScale":7}', '/hi'],
    ['unknown keys, uiLocale valid', '{"schema":1,"uiLocale":"en","extra":[1,{"b":2}]}', '/en'],
    ['duplicate uiLocale (the last one wins)', '{"schema":1,"uiLocale":"hi","uiLocale":"x"}', null],
    ['duplicate uiLocale ending valid', '{"schema":1,"uiLocale":"x","uiLocale":"en"}', '/en'],
    ['schema 2 (newer: memory defaults)', prefs('"hi"', '2'), null],
    ['schema 0', prefs('"hi"', '0'), null],
    ['schema 1.5', prefs('"hi"', '1.5'), null],
    ['schema "1" (a string)', prefs('"hi"', '"1"'), null],
    ['schema 1.0 (the number 1)', prefs('"hi"', '1.0'), '/hi'],
    ['no schema', '{"uiLocale":"hi","textScale":100,"readToMe":false}', null],
    ['top-level __proto__', '{"schema":1,"uiLocale":"hi","__proto__":{}}', null],
    ['nested __proto__', '{"schema":1,"uiLocale":"hi","x":[{"y":{"__proto__":null}}]}', null],
    ['__proto__ at depth 63', protoAtDepth(63), null],
    ['__proto__ at depth 64', protoAtDepth(64), null],
    ['__proto__ at depth 65 (past the reader limit)', protoAtDepth(65), '/hi'],
    ['__proto__ at depth 71', protoAtDepth(71), '/hi'],
    ['a top-level array', '[{"schema":1,"uiLocale":"hi"}]', null],
    ['a JSON string', '"hi"', null],
    ['JSON null', 'null', null],
    ['JSON 0', '0', null],
    ['garbage JSON', '{"schema":1,"uiLocale":"hi"', null],
    ['an empty string', '', null],
    ['no stored key', null, null],
  ])('%s: %j goes to %j', (_name, raw, expected) => {
    expect(expectedTarget(raw)).toBe(expected)
    const outcome = run(stored(raw))
    expect(outcome.redirect).toBe(expected)
    expect(outcome.replaceCalls).toBe(expected === null ? 0 : 1)
    expect(outcome.reads).toBe(1)
    expect(outcome.writes).toBe(0)
  })

  it.each<[string, Stored]>([
    ['a throwing getItem', { kind: 'getItem-throws' }],
    ['a throwing localStorage getter', { kind: 'getter-throws' }],
  ])('%s leaves the gate shown, with no error and no write', (_name, broken) => {
    const outcome = run(broken)
    expect(outcome).toMatchObject({ redirect: null, replaceCalls: 0, writes: 0 })
  })

  it.each<[string, Navigation]>([
    ['reload', { kind: 'entry', type: 'reload' }],
    ['back_forward', { kind: 'entry', type: 'back_forward' }],
    ['prerender', { kind: 'entry', type: 'prerender' }],
    ['an unknown type', { kind: 'entry', type: 'Navigate' }],
    ['no navigation entry', { kind: 'no-entry' }],
    ['no performance object', { kind: 'no-performance' }],
    ['a throwing getEntriesByType', { kind: 'throws' }],
  ])('%s never redirects and never reads storage', (_name, navigation) => {
    for (const raw of [prefs('"hi"'), prefs('"en"')]) {
      expect(run(stored(raw), navigation)).toEqual({
        redirect: null,
        replaceCalls: 0,
        reads: 0,
        writes: 0,
      })
    }
  })

  it('agrees with readPrefs on 20,000 generated inputs, never writes and never throws', () => {
    const leaf = fc.oneof(
      fc.constant('null'),
      fc.boolean().map(String),
      fc.integer().map(String),
      fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => JSON.stringify(n)),
      fc.string({ maxLength: 6 }).map((s) => JSON.stringify(s)),
    )
    const key = fc.oneof(
      { weight: 1, arbitrary: fc.constant('__proto__') },
      {
        weight: 5,
        arbitrary: fc.constantFrom('schema', 'textScale', 'uiLocale', 'readToMe', 'constructor'),
      },
      { weight: 6, arbitrary: fc.string({ maxLength: 4 }) },
    )
    const objectText = (entries: readonly (readonly [string, string])[]): string =>
      `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',')}}`
    const { tree } = fc.letrec<{ tree: string }>((tie) => ({
      tree: fc.oneof(
        { maxDepth: 4, depthSize: 'small' },
        leaf,
        fc.array(tie('tree'), { maxLength: 3 }).map((items) => `[${items.join(',')}]`),
        fc.array(fc.tuple(key, tie('tree')), { maxLength: 3 }).map(objectText),
      ),
    }))
    // Weighted towards schema 1 and the real locales, so most runs reach the uiLocale decision.
    const schema = fc.oneof(
      { weight: 8, arbitrary: fc.constantFrom('1', '1.0', '1e0') },
      {
        weight: 3,
        arbitrary: fc.constantFrom('2', '3', '1.5', '1e999', '1152921504606846976', '0', '"1"'),
      },
      { weight: 1, arbitrary: tree },
    )
    const uiLocale = fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom('"en"', '"hi"') },
      {
        weight: 3,
        arbitrary: fc.constantFrom('null', '"ar"', '"EN"', '"Hi"', '" hi"', '"en-IN"', '1', '""'),
      },
      { weight: 1, arbitrary: tree },
    )
    const textScale = fc.constantFrom('100', '125', '150', '140', '"150"', 'null')
    const readToMe = fc.constantFrom('true', 'false', '0', '"true"')
    const prefsLike = fc
      .record({
        schema: fc.option(schema, { nil: undefined, freq: 8 }),
        uiLocale: fc.option(uiLocale, { nil: undefined, freq: 8 }),
        textScale: fc.option(textScale, { nil: undefined }),
        readToMe: fc.option(readToMe, { nil: undefined }),
        extra: fc.array(fc.tuple(key, tree), { maxLength: 2 }),
        extraFirst: fc.boolean(),
      })
      .map(({ extra, extraFirst, ...fields }) => {
        const known = Object.entries(fields).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        )
        return objectText(extraFirst ? [...extra, ...known] : [...known, ...extra])
      })
    const raw = fc.oneof(
      { weight: 6, arbitrary: prefsLike },
      { weight: 2, arbitrary: tree },
      { weight: 1, arbitrary: fc.jsonValue().map((v) => JSON.stringify(v)) },
      { weight: 1, arbitrary: fc.string() },
      { weight: 1, arbitrary: fc.constant(null) },
    )
    let redirects = 0
    fc.assert(
      fc.property(raw, (text) => {
        const outcome = run(stored(text))
        expect(outcome.writes).toBe(0)
        expect(outcome.replaceCalls).toBeLessThanOrEqual(1)
        expect(outcome.redirect).toBe(expectedTarget(text))
        if (outcome.redirect !== null) redirects++
      }),
      { seed: SEED, numRuns: 20_000 },
    )
    // The generator reaches both outcomes often.
    expect(redirects).toBeGreaterThan(2_000)
    expect(redirects).toBeLessThan(18_000)
  }, 120_000)

  it(`is ${PINNED_BYTES} bytes with the pinned SHA-256`, () => {
    expect(Buffer.byteLength(LOCALE_REDIRECT_SCRIPT, 'utf8')).toBe(PINNED_BYTES)
    expect(createHash('sha256').update(LOCALE_REDIRECT_SCRIPT, 'utf8').digest('base64')).toBe(
      PINNED_SHA256,
    )
  })

  it('is safe inside an inline <script> and stays ES5', () => {
    expect(Buffer.byteLength(LOCALE_REDIRECT_SCRIPT, 'utf8')).toBeLessThan(1024)
    expect(LOCALE_REDIRECT_SCRIPT.toLowerCase()).not.toContain('</script')
    expect(LOCALE_REDIRECT_SCRIPT).not.toContain('<!--')
    expect(LOCALE_REDIRECT_SCRIPT).not.toContain('`')
    expect(LOCALE_REDIRECT_SCRIPT).not.toMatch(/=>|\b(?:let|const|class)\b|\.\.\./)
    expect(LOCALE_REDIRECT_SCRIPT).toMatch(/^\(function\(\)\{try\{.*\}\)\(\)$/)
    // ASCII only, so its bytes and its characters agree.
    expect(LOCALE_REDIRECT_SCRIPT).toMatch(/^[\x20-\x7e]+$/)
  })

  it('reads only reader.v1.prefs, writes nothing and navigates only with location.replace', () => {
    expect(LOCALE_REDIRECT_SCRIPT).toContain(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`)
    expect(LOCALE_REDIRECT_SCRIPT).toContain('location.replace("/"+u)')
    expect(LOCALE_REDIRECT_SCRIPT).toContain('n.type!=="navigate"')
    expect(LOCALE_REDIRECT_SCRIPT).not.toMatch(
      /setItem|removeItem|clear\(|cookie|document|sessionStorage|href|assign\(|history/,
    )
  })

  it('is built from PREFS_KEY, RECORD_SCHEMA, UI_LOCALES and the enabled registry locales', async () => {
    vi.resetModules()
    vi.doMock('./records', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      PREFS_KEY: 'test.v9.prefs',
      RECORD_SCHEMA: 9,
      UI_LOCALES: ['en', 'hi', 'ar'],
    }))
    vi.doMock('../locales', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      ENABLED_LOCALE_CODES: ['hi', 'ar'],
    }))
    try {
      const rebuilt = await import('./locale-redirect-boot')
      expect(rebuilt.REDIRECT_LOCALES).toEqual(['hi', 'ar'])
      expect(rebuilt.LOCALE_REDIRECT_SCRIPT).toContain('localStorage.getItem("test.v9.prefs")')
      expect(rebuilt.LOCALE_REDIRECT_SCRIPT).toContain('v.schema!==9||')
      expect(rebuilt.LOCALE_REDIRECT_SCRIPT).toContain(
        'if(u==="hi"||u==="ar")location.replace("/"+u)',
      )
      expect(rebuilt.LOCALE_REDIRECT_SCRIPT).not.toBe(LOCALE_REDIRECT_SCRIPT)
    } finally {
      vi.doUnmock('./records')
      vi.doUnmock('../locales')
      vi.resetModules()
    }
  })

  it('follows nothing when no UI locale is enabled', async () => {
    vi.resetModules()
    vi.doMock('../locales', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      ENABLED_LOCALE_CODES: ['ar'],
    }))
    try {
      const rebuilt = await import('./locale-redirect-boot')
      expect(rebuilt.REDIRECT_LOCALES).toEqual([])
      expect(rebuilt.LOCALE_REDIRECT_SCRIPT).toContain('if(false)location.replace')
    } finally {
      vi.doUnmock('../locales')
      vi.resetModules()
    }
  })
})
