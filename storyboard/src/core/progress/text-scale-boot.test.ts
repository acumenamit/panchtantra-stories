// Text-size boot script (spec §6.3, §6.6; P1-1b). The exact string runs in node:vm with a fake
// localStorage and document and must agree with readPrefs (a newer schema means the memory
// defaults, so 100) on fixed cases and 20,000 fast-check runs (seed 20261114). It never writes,
// never throws, stays under 1 KB with no "</script", "<!--" or backtick, and its SHA-256 is pinned.
import { createHash } from 'node:crypto'
import { Script, createContext } from 'node:vm'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, PREFS_KEY, TEXT_SCALES, readPrefs } from './records'
import { TEXT_SCALE_ATTRIBUTE, TEXT_SCALE_BOOT_SCRIPT } from './text-scale-boot'

const SEED = 20261114

/** design §7 item 7: 588 bytes, this SHA-256 (base64). A change to the key or the scales moves it. */
const PINNED_SHA256 = 'voXJlJvmC+O7rbtFwHFMWKwtBHqaKvV/ukgK9Lmz6eA='

type Stored =
  | { readonly kind: 'value'; readonly raw: string | null }
  | { readonly kind: 'getItem-throws' }
  | { readonly kind: 'getter-throws' }

interface Outcome {
  /** The text size the page paints with: the attribute's value, or 100 with no attribute. */
  readonly scale: number
  readonly attribute: string | null
  readonly setAttributeCalls: number
  readonly writes: number
}

/** The store's answer: readPrefs, where a newer schema keeps memory defaults for the visit. */
function storeScale(raw: string | null): number {
  const read = readPrefs(raw)
  return read.kind === 'record' ? read.record.textScale : DEFAULT_PREFS.textScale
}

/** One vm context and one compiled script; each run swaps what storage holds. */
function makeHarness(): (stored: Stored) => Outcome {
  let stored: Stored = { kind: 'value', raw: null }
  let attributes = new Map<string, string>()
  let setAttributeCalls = 0
  let writes = 0
  const storage = {
    getItem(key: string): string | null {
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
  const sandbox = {
    document: {
      documentElement: {
        setAttribute(name: string, value: string): void {
          setAttributeCalls++
          attributes.set(name, value)
        },
      },
    },
  }
  Object.defineProperty(sandbox, 'localStorage', {
    enumerable: true,
    get() {
      if (stored.kind === 'getter-throws') throw new Error('SecurityError: localStorage')
      return storage
    },
  })
  const context = createContext(sandbox)
  const script = new Script(TEXT_SCALE_BOOT_SCRIPT)
  return (next) => {
    stored = next
    attributes = new Map()
    setAttributeCalls = 0
    writes = 0
    script.runInContext(context)
    const attribute = attributes.get(TEXT_SCALE_ATTRIBUTE) ?? null
    return {
      scale: attribute === null ? DEFAULT_PREFS.textScale : Number(attribute),
      attribute,
      setAttributeCalls,
      writes,
    }
  }
}

const run = makeHarness()
const stored = (raw: string | null): Stored => ({ kind: 'value', raw })

/** A prefs record with a "__proto__" key in an object at this depth (the record is depth 0). */
function protoAtDepth(depth: number): string {
  let inner = '{"__proto__":0}'
  for (let d = depth; d > 1; d--) inner = `{"a":${inner}}`
  return `{"schema":1,"uiLocale":null,"textScale":150,"readToMe":false,"x":${inner}}`
}

const full = (textScale: string, schema = '1'): string =>
  `{"schema":${schema},"uiLocale":"hi","textScale":${textScale},"readToMe":true}`

describe('TEXT_SCALE_BOOT_SCRIPT', () => {
  it.each<[string, string | null, number]>([
    ['no stored key', null, 100],
    ['textScale 150', full('150'), 150],
    ['textScale 125', full('125'), 125],
    ['textScale 100', full('100'), 100],
    ['textScale "150" (a string)', full('"150"'), 100],
    ['textScale 140', full('140'), 100],
    ['textScale 200', full('200'), 100],
    ['textScale null', full('null'), 100],
    ['textScale 1.5e2 (the number 150)', full('1.5e2'), 150],
    ['schema 2 (newer: memory defaults)', full('150', '2'), 100],
    ['schema 1.5', full('150', '1.5'), 100],
    ['schema 1e999', full('150', '1e999'), 100],
    ['schema 2^60', full('150', '1152921504606846976'), 100],
    ['schema "1" (a string)', full('150', '"1"'), 100],
    ['schema 1.0 (the number 1)', full('125', '1.0'), 125],
    ['no schema', '{"uiLocale":null,"textScale":150,"readToMe":false}', 100],
    ['top-level __proto__', '{"schema":1,"textScale":150,"__proto__":{}}', 100],
    ['nested __proto__', '{"schema":1,"textScale":150,"x":[{"y":{"__proto__":null}}]}', 100],
    ['__proto__ at depth 64', protoAtDepth(64), 100],
    ['__proto__ at depth 65 (past the reader limit)', protoAtDepth(65), 150],
    ['unknown keys, other fields valid', '{"schema":1,"textScale":125,"extra":[1,2],"z":{}}', 125],
    ['only schema and textScale', '{"schema":1,"textScale":150}', 150],
    [
      'duplicate textScale (the last one wins)',
      '{"schema":1,"textScale":150,"textScale":"x"}',
      100,
    ],
    ['a top-level array', '[{"schema":1,"textScale":150}]', 100],
    ['a top-level number', '150', 100],
    ['JSON null', 'null', 100],
    ['a JSON string', '"150"', 100],
    ['bad JSON', '{bad', 100],
    ['an empty string', '', 100],
  ])('%s: %j gives %d', (_name, raw, expected) => {
    expect(storeScale(raw)).toBe(expected)
    const outcome = run(stored(raw))
    expect(outcome.scale).toBe(expected)
    expect(outcome.attribute).toBe(expected === 100 ? null : String(expected))
    expect(outcome.writes).toBe(0)
  })

  it('a throwing getItem gives 100 and no error', () => {
    const outcome = run({ kind: 'getItem-throws' })
    expect(outcome).toEqual({ scale: 100, attribute: null, setAttributeCalls: 0, writes: 0 })
  })

  it('a throwing localStorage getter gives 100 and no error', () => {
    const outcome = run({ kind: 'getter-throws' })
    expect(outcome).toEqual({ scale: 100, attribute: null, setAttributeCalls: 0, writes: 0 })
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
    // Weighted towards schema 1 and the real scales, so most runs reach the textScale decision.
    const schema = fc.oneof(
      { weight: 8, arbitrary: fc.constantFrom('1', '1.0', '1e0') },
      {
        weight: 3,
        arbitrary: fc.constantFrom(
          '2',
          '3',
          '1.5',
          '1e999',
          '1152921504606846976',
          '0',
          '-1',
          '"1"',
        ),
      },
      { weight: 1, arbitrary: tree },
    )
    const textScale = fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom(...TEXT_SCALES.map(String), '1.25e2', '150.0') },
      { weight: 3, arbitrary: fc.constantFrom('140', '200', '"150"', '-150', '125.5', 'null') },
      { weight: 1, arbitrary: tree },
    )
    const uiLocale = fc.constantFrom('null', '"en"', '"hi"', '"ar"', '1')
    const readToMe = fc.constantFrom('true', 'false', '0', '"true"')
    const prefsLike = fc
      .record({
        schema: fc.option(schema, { nil: undefined, freq: 8 }),
        textScale: fc.option(textScale, { nil: undefined, freq: 8 }),
        uiLocale: fc.option(uiLocale, { nil: undefined }),
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
    fc.assert(
      fc.property(raw, (text) => {
        const outcome = run(stored(text))
        expect(outcome.writes).toBe(0)
        expect(outcome.setAttributeCalls).toBeLessThanOrEqual(1)
        expect([null, '125', '150']).toContain(outcome.attribute)
        expect(outcome.scale).toBe(storeScale(text))
      }),
      { seed: SEED, numRuns: 20_000 },
    )
  }, 120_000)

  it('is 588 bytes with the pinned SHA-256', () => {
    expect(Buffer.byteLength(TEXT_SCALE_BOOT_SCRIPT, 'utf8')).toBe(588)
    expect(createHash('sha256').update(TEXT_SCALE_BOOT_SCRIPT, 'utf8').digest('base64')).toBe(
      PINNED_SHA256,
    )
  })

  it('is safe inside an inline <script> and stays ES5', () => {
    expect(Buffer.byteLength(TEXT_SCALE_BOOT_SCRIPT, 'utf8')).toBeLessThan(1024)
    expect(TEXT_SCALE_BOOT_SCRIPT.toLowerCase()).not.toContain('</script')
    expect(TEXT_SCALE_BOOT_SCRIPT).not.toContain('<!--')
    expect(TEXT_SCALE_BOOT_SCRIPT).not.toContain('`')
    expect(TEXT_SCALE_BOOT_SCRIPT).not.toMatch(/=>|\b(?:let|const|class)\b|\.\.\./)
    expect(TEXT_SCALE_BOOT_SCRIPT).toMatch(/^\(function\(\)\{try\{.*\}\)\(\)$/)
  })

  it('reads only reader.v1.prefs and sets only data-text-scale', () => {
    expect(TEXT_SCALE_ATTRIBUTE).toBe('data-text-scale')
    expect(TEXT_SCALE_BOOT_SCRIPT).toContain(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`)
    expect(TEXT_SCALE_BOOT_SCRIPT).toContain(
      `setAttribute(${JSON.stringify(TEXT_SCALE_ATTRIBUTE)},""+s)`,
    )
    expect(TEXT_SCALE_BOOT_SCRIPT).not.toMatch(/setItem|removeItem|clear\(|cookie/)
  })

  it('is built from PREFS_KEY, RECORD_SCHEMA and TEXT_SCALES', async () => {
    vi.resetModules()
    vi.doMock('./records', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      PREFS_KEY: 'test.v9.prefs',
      RECORD_SCHEMA: 9,
      TEXT_SCALES: [100, 110, 175],
    }))
    try {
      const rebuilt = (await import('./text-scale-boot')).TEXT_SCALE_BOOT_SCRIPT
      expect(rebuilt).toContain('localStorage.getItem("test.v9.prefs")')
      expect(rebuilt).toContain('v.schema!==9||')
      expect(rebuilt).toContain('if(s===110||s===175)document')
      expect(rebuilt).not.toBe(TEXT_SCALE_BOOT_SCRIPT)
    } finally {
      vi.doUnmock('./records')
      vi.resetModules()
    }
  })
})
