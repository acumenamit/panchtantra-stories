// Saved-run hint (Step 10, D11-P5; design §4.4, §9.2). The exact script runs in node:vm with a fake
// localStorage and document. It must never under-report what readProgress gives as this story's
// activeRun (fixed cases and fast-check runs over records, damaged JSON, other schemas and
// "__proto__" keys, seed 20261114); it never writes and never throws; it is ES5, under 1 KB, with no
// "</script", "<!--" or backtick (the checks of text-scale-boot.test.ts); and its own story id rule
// agrees with StoryId in package/v1.ts (C2).
import { Script, createContext } from 'node:vm'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { StoryId } from '../package/v1'
import { PROGRESS_KEY, readProgress, serializeProgress } from './records'
import { SAVED_RUN_ATTRIBUTE, savedRunHintScript } from './saved-run-hint'

const SEED = 20261114
const ID = 'river-stones'

type Stored =
  | { readonly kind: 'value'; readonly raw: string | null }
  | { readonly kind: 'getItem-throws' }
  | { readonly kind: 'getter-throws' }

interface Outcome {
  readonly attributes: ReadonlyMap<string, string>
  readonly setAttributeCalls: number
  readonly writes: number
  readonly keysRead: readonly string[]
}

/** The store's answer: readProgress gives this story a non-null activeRun. */
function storeHasRun(raw: string | null, storyId = ID): boolean {
  const read = readProgress(raw)
  if (read.kind !== 'record') return false
  const story = Object.hasOwn(read.record.stories, storyId)
    ? read.record.stories[storyId]
    : undefined
  return (story?.activeRun ?? null) !== null
}

/** One vm context and one compiled script; each run swaps what storage holds. */
function makeHarness(script: string): (stored: Stored) => Outcome {
  let stored: Stored = { kind: 'value', raw: null }
  let attributes = new Map<string, string>()
  let setAttributeCalls = 0
  let writes = 0
  let keysRead: string[] = []
  const storage = {
    getItem(key: string): string | null {
      keysRead.push(key)
      if (stored.kind === 'getItem-throws') throw new Error('SecurityError: getItem')
      return stored.kind === 'value' && key === PROGRESS_KEY ? stored.raw : null
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
  const compiled = new Script(script)
  return (next) => {
    stored = next
    attributes = new Map()
    setAttributeCalls = 0
    writes = 0
    keysRead = []
    compiled.runInContext(context)
    return { attributes, setAttributeCalls, writes, keysRead }
  }
}

const run = makeHarness(savedRunHintScript(ID))
const value = (raw: string | null): Stored => ({ kind: 'value', raw })
const marked = (o: Outcome) => o.attributes.get(SAVED_RUN_ATTRIBUTE) === ''

const record = (stories: Record<string, unknown>, schema: unknown = 1) =>
  JSON.stringify({ schema, stories })
const story = (activeRun: unknown) => ({ version: 1, activeRun, endingsFound: [], order: 1 })

describe('savedRunHintScript: fixed cases', () => {
  it('marks a saved run, a one-node run included, and agrees with readProgress', () => {
    const cases: [string, boolean][] = [
      [record({ [ID]: story({ path: ['start', 'flat_stones'], locale: 'hi' }) }), true],
      [record({ [ID]: story({ path: ['start'], locale: 'en' }) }), true],
      [
        serializeProgress({
          schema: 1,
          stories: {
            [ID]: {
              version: 2,
              activeRun: { path: ['start', 'flat_stones', 'big_rock'], locale: 'en' },
              endingsFound: ['ending_dry'],
              order: 3,
            },
          },
        }),
        true,
      ],
      [record({ [ID]: story(null) }), false],
      [record({ 'two-paths': story({ path: ['start', 'wise_path'], locale: 'en' }) }), false],
      [record({ [ID]: story({ path: ['start', 'flat_stones'], locale: 'hi' }) }, 2), false],
      [record({}), false],
    ]
    for (const [raw, expected] of cases) {
      expect(storeHasRun(raw)).toBe(expected)
      const o = run(value(raw))
      expect(marked(o)).toBe(expected)
      expect(o.writes).toBe(0)
    }
  })

  it('sets nothing with no key, unreadable JSON, a wrong top level or blocked storage', () => {
    const outcomes = [
      run(value(null)),
      run(value('{')),
      run(value('[]')),
      run(value('null')),
      run(value('"text"')),
      run(value(JSON.stringify({ schema: 1, stories: [] }))),
      run(value(JSON.stringify({ schema: 1, stories: { [ID]: [] } }))),
      run(value(JSON.stringify({ schema: 1, stories: { [ID]: story([]) } }))),
      run({ kind: 'getItem-throws' }),
      run({ kind: 'getter-throws' }),
    ]
    for (const o of outcomes) {
      expect(o.setAttributeCalls).toBe(0)
      expect(o.writes).toBe(0)
    }
  })

  it('may over-report (that only hides until open), for example a run readProgress drops', () => {
    // An invalid path: readProgress resets the run, the hint still marks it.
    const raw = record({ [ID]: story({ path: [], locale: 'en' }) })
    expect(storeHasRun(raw)).toBe(false)
    expect(marked(run(value(raw)))).toBe(true)
  })

  it('reads only reader.v1.progress', () => {
    const o = run(value(record({ [ID]: story({ path: ['start'], locale: 'en' }) })))
    expect(o.keysRead).toEqual([PROGRESS_KEY])
  })
})

describe('savedRunHintScript: never under-reports (fixed seed)', () => {
  const nodeId = fc.oneof(
    { weight: 8, arbitrary: fc.constantFrom('start', 'flat_stones', 'big_rock') },
    { weight: 1, arbitrary: fc.constantFrom('Bad-Id', '', 'n'.repeat(49)) },
  )
  const locale = fc.oneof(
    { weight: 8, arbitrary: fc.constantFrom('en', 'hi', 'ar') },
    { weight: 1, arbitrary: fc.constant('fr') },
  )
  const ABSENT = Symbol('absent')
  const maybe = <T>(arbitrary: fc.Arbitrary<T>) =>
    fc.oneof({ weight: 6, arbitrary }, { weight: 1, arbitrary: fc.constant(ABSENT) })
  const activeRun = fc.oneof(
    {
      weight: 6,
      arbitrary: fc.record({ path: fc.array(nodeId, { minLength: 1, maxLength: 3 }), locale }),
    },
    {
      weight: 2,
      arbitrary: fc.record(
        { path: fc.array(nodeId, { maxLength: 66 }), locale, extra: fc.integer() },
        { requiredKeys: [] },
      ),
    },
    { weight: 2, arbitrary: fc.constantFrom(null, 7, 'run', [], [1], {}, true, false, 0) },
  )
  const entry = fc.oneof(
    {
      weight: 6,
      arbitrary: fc.record({
        version: fc.integer({ min: 1, max: 3 }),
        activeRun,
        endingsFound: fc.array(nodeId, { maxLength: 2 }),
        order: fc.integer({ min: 0, max: 9 }),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record(
        {
          version: fc.oneof(fc.integer({ min: -1, max: 3 }), fc.constant('1')),
          activeRun,
          endingsFound: fc.oneof(fc.array(nodeId, { maxLength: 2 }), fc.constant('x')),
          order: fc.oneof(fc.integer({ min: -1, max: 9 }), fc.constant(1.5)),
          extra: fc.string({ maxLength: 3 }),
        },
        { requiredKeys: [] },
      ),
    },
    { weight: 1, arbitrary: fc.constantFrom(null, 3, 'story', [], [{}]) },
  )
  const schema = fc.oneof(
    { weight: 8, arbitrary: fc.constant<unknown>(1) },
    { weight: 2, arbitrary: fc.constantFrom<unknown>(2, 1.5, '1', 0, null, 9007199254740993) },
  )
  const progress = fc
    .record(
      {
        schema,
        stories: fc.record({ target: maybe(entry), other: maybe(entry) }),
        extra: fc.integer(),
      },
      { requiredKeys: ['schema', 'stories'] },
    )
    .map(({ stories, ...top }) => {
      const out: Record<string, unknown> = {}
      if (stories.target !== ABSENT) out[ID] = stories.target
      if (stories.other !== ABSENT) out['two-paths'] = stories.other
      return JSON.stringify({ ...top, stories: out })
    })
  const damage = fc.oneof(
    { weight: 10, arbitrary: fc.constant('none') },
    {
      weight: 5,
      arbitrary: fc.constantFrom(
        'truncate',
        'proto-top',
        'proto-stories',
        'proto-story',
        'proto-run',
      ),
    },
  )
  const raw = fc.oneof(
    {
      weight: 8,
      arbitrary: fc.tuple(progress, damage, fc.nat()).map(([text, how, cut]) => {
        switch (how) {
          case 'truncate':
            return text.slice(0, cut % (text.length + 1))
          case 'proto-top':
            return text.replace('{', '{"__proto__":{},')
          case 'proto-stories':
            return text.replace('"stories":{', '"stories":{"__proto__":1,')
          case 'proto-story':
            return text.replace(`"${ID}":{`, `"${ID}":{"__proto__":{"x":1},`)
          case 'proto-run':
            return text.replace('"activeRun":{', '"activeRun":{"__proto__":null,')
          default:
            return text
        }
      }),
    },
    { weight: 1, arbitrary: fc.string({ maxLength: 40 }) },
    { weight: 1, arbitrary: fc.json() },
  )

  it('marks the page wherever readProgress gives this story a non-null activeRun', () => {
    const cover = { run: 0, over: 0, none: 0 }
    fc.assert(
      fc.property(raw, (text) => {
        const expected = storeHasRun(text)
        const o = run(value(text))
        expect(o.writes).toBe(0)
        expect(o.setAttributeCalls).toBeLessThanOrEqual(1)
        for (const [name, v] of o.attributes) {
          expect(name).toBe(SAVED_RUN_ATTRIBUTE)
          expect(v).toBe('')
        }
        if (o.keysRead.length !== 1) throw new Error('read more than one key')
        if (expected) {
          expect(marked(o)).toBe(true)
          cover.run++
        } else if (marked(o)) cover.over++
        else cover.none++
      }),
      { seed: SEED, numRuns: 10_000 },
    )
    // Guard against a vacuous property: many saved runs, many records without one.
    expect(cover.run).toBeGreaterThan(800)
    expect(cover.none).toBeGreaterThan(1000)
    expect(cover.over).toBeGreaterThan(0)
  }, 120_000)
})

describe('savedRunHintScript: the script text', () => {
  const longest = 'a'.repeat(64)

  it('is safe inside an inline <script> and stays ES5, for the longest story id too', () => {
    for (const script of [savedRunHintScript(ID), savedRunHintScript(longest)]) {
      expect(Buffer.byteLength(script, 'utf8')).toBeLessThan(1024)
      expect(script.toLowerCase()).not.toContain('</script')
      expect(script).not.toContain('<!--')
      expect(script).not.toContain('`')
      expect(script).not.toMatch(/=>|\b(?:let|const|class)\b|\.\.\./)
      expect(script).toMatch(/^\(function\(\)\{try\{.*\}\)\(\)$/)
    }
  })

  it('reads only reader.v1.progress, sets only data-saved-run and never writes', () => {
    const script = savedRunHintScript(ID)
    expect(SAVED_RUN_ATTRIBUTE).toBe('data-saved-run')
    expect(script).toContain(`localStorage.getItem(${JSON.stringify(PROGRESS_KEY)})`)
    expect(script).toContain(`setAttribute(${JSON.stringify(SAVED_RUN_ATTRIBUTE)},"")`)
    expect(script).toContain(`hasOwnProperty.call(s,${JSON.stringify(ID)})`)
    expect(script).not.toMatch(/setItem|removeItem|clear\(|cookie/)
  })

  it('is built from PROGRESS_KEY and RECORD_SCHEMA', async () => {
    vi.resetModules()
    vi.doMock('./records', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      PROGRESS_KEY: 'test.v9.progress',
      RECORD_SCHEMA: 9,
    }))
    try {
      const rebuilt = (await import('./saved-run-hint')).savedRunHintScript(ID)
      expect(rebuilt).toContain('localStorage.getItem("test.v9.progress")')
      expect(rebuilt).toContain('v.schema!==9)')
      expect(rebuilt).not.toBe(savedRunHintScript(ID))
    } finally {
      vi.doUnmock('./records')
      vi.resetModules()
    }
  })

  it('throws a TypeError for anything that is not a story id', () => {
    const bad: unknown[] = [
      '',
      'ab',
      'a'.repeat(65),
      '-abc',
      'abc-',
      'ab--c',
      'Abc',
      'ab_c',
      'ab c',
      'abc\n',
      'ab"c',
      '</script>',
      'abc"+alert(1)+"',
      null,
      42,
      undefined,
    ]
    for (const id of bad) expect(() => savedRunHintScript(id as string)).toThrow(TypeError)
    expect(() => savedRunHintScript(longest)).not.toThrow()
  })
})

describe("savedRunHintScript's story id rule agrees with StoryId (C2)", () => {
  const accepts = (id: string): boolean => {
    try {
      savedRunHintScript(id)
      return true
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError)
      return false
    }
  }

  it('on the boundary ids', () => {
    const ids = [
      'ab',
      'abc',
      'a'.repeat(64),
      'a'.repeat(65),
      `${'a'.repeat(31)}-${'b'.repeat(32)}`,
      `${'a'.repeat(32)}-${'b'.repeat(32)}`,
      '-abc',
      'abc-',
      'ab--cd',
      'aBc',
      'ab_cd',
      'a-b',
      '0-9',
      'two-paths',
      'river-stones',
      'abc ',
      ' abc',
      'abé',
    ]
    for (const id of ids) expect(accepts(id), id).toBe(StoryId.safeParse(id).success)
  })

  it('on fixed-seed strings', () => {
    const cover = { valid: 0, invalid: 0 }
    const arbitraryId = fc.oneof(
      fc.string({ unit: fc.constantFrom(...'abz09-_A '.split('')), maxLength: 70 }),
      fc.stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      fc.string({ maxLength: 8 }),
    )
    fc.assert(
      fc.property(arbitraryId, (id) => {
        const expected = StoryId.safeParse(id).success
        expect(accepts(id)).toBe(expected)
        if (expected) cover.valid++
        else cover.invalid++
      }),
      { seed: SEED, numRuns: 5_000 },
    )
    expect(cover.valid).toBeGreaterThan(500)
    expect(cover.invalid).toBeGreaterThan(500)
  })
})
