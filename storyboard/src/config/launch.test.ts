// The launch flag (P1 D4; design p1-step7-design.md §5.2, §8.1 item 1; P1-1c): the truth table in
// both committed states over every combination of the four inputs, the named cases, a fast-check
// property (seed 20261114), reasons that never hold a raw value, the log line, the refusal and the
// pinned committed state.
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LAUNCH_REASONS,
  PRODUCTION_LAUNCH,
  assertLaunchAllowed,
  buildLaunch,
  launchLogLine,
  resolveLaunch,
  type Env,
  type LaunchDecision,
  type LaunchReason,
  type ProductionLaunch,
} from './launch'

const SEED = 20261114
const COMMITTED: readonly ProductionLaunch[] = ['gated', 'launched']

afterEach(() => {
  vi.unstubAllEnvs()
})

const gated = (reason: LaunchReason): LaunchDecision => ({
  readerRoutes: false,
  reason,
  refused: false,
})
const open = (reason: LaunchReason): LaunchDecision => ({
  readerRoutes: true,
  reason,
  refused: false,
})
const refused = (reason: LaunchReason): LaunchDecision => ({
  readerRoutes: false,
  reason,
  refused: true,
})

type Row = 1 | 2 | 3 | 4 | 5 | 6

/** Design §5.2, one entry per row and committed state, written out as the table reads. */
const TABLE: Readonly<Record<Row, Readonly<Record<ProductionLaunch, LaunchDecision>>>> = {
  1: { gated: gated('committed'), launched: open('committed') },
  2: { gated: gated('committed'), launched: refused('launched-without-storage') },
  3: { gated: gated('kill-switch'), launched: gated('kill-switch') },
  4: { gated: open('review'), launched: open('review') },
  5: { gated: refused('review-not-allowed'), launched: refused('review-not-allowed') },
  6: { gated: refused('malformed'), launched: refused('malformed') },
}

/** The row's condition, from the table's columns (an empty VERCEL or VERCEL_ENV counts as set). */
function rowOf(env: Env): Row {
  const value = env.READER_LAUNCH
  if (value === undefined || value === '') {
    const productionWithoutStorage =
      env.VERCEL_ENV === 'production' && env.CONTENT_SOURCE !== 'storage'
    return productionWithoutStorage ? 2 : 1
  }
  if (value === 'gated') return 3
  if (value === 'review') {
    const allowed =
      env.VERCEL_ENV === 'preview' ||
      (env.VERCEL === undefined &&
        env.VERCEL_ENV === undefined &&
        env.CONTENT_SOURCE === 'fixtures')
    return allowed ? 4 : 5
  }
  return 6
}

const ABSENT = Symbol('absent')
type Slot = string | typeof ABSENT

/** An env object that leaves absent inputs out entirely, as process.env does. */
function envOf(slots: Readonly<Record<string, Slot>>): Env {
  return Object.fromEntries(
    Object.entries(slots).filter((entry): entry is [string, string] => entry[1] !== ABSENT),
  )
}

const READER_LAUNCH_VALUES: readonly Slot[] = [
  ABSENT,
  '',
  'gated',
  'review',
  ' review',
  'Review',
  'open',
  'true',
  '1',
  'launched',
  'gated ',
]
const VERCEL_VALUES: readonly Slot[] = [ABSENT, '', '1']
const VERCEL_ENV_VALUES: readonly Slot[] = [ABSENT, '', 'production', 'preview', 'development']
const CONTENT_SOURCE_VALUES: readonly Slot[] = [ABSENT, '', 'none', 'fixtures', 'storage']

const GRID: Env[] = READER_LAUNCH_VALUES.flatMap((READER_LAUNCH) =>
  VERCEL_VALUES.flatMap((VERCEL) =>
    VERCEL_ENV_VALUES.flatMap((VERCEL_ENV) =>
      CONTENT_SOURCE_VALUES.map((CONTENT_SOURCE) =>
        envOf({ READER_LAUNCH, VERCEL, VERCEL_ENV, CONTENT_SOURCE }),
      ),
    ),
  ),
)

const LOG_LINES = new Set(
  LAUNCH_REASONS.flatMap((reason) => [
    `reader launch: gated (${reason})`,
    `reader launch: open (${reason})`,
  ]),
)

describe('resolveLaunch: the design §5.2 truth table', () => {
  it.each<[Row, string, Env]>([
    [1, 'unset, no Vercel', {}],
    [1, "'', a Vercel Preview", { READER_LAUNCH: '', VERCEL: '1', VERCEL_ENV: 'preview' }],
    [1, 'unset, Production with storage', { VERCEL_ENV: 'production', CONTENT_SOURCE: 'storage' }],
    [2, 'unset, Production with none', { VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' }],
    [
      2,
      "'', Production with fixtures",
      { READER_LAUNCH: '', VERCEL_ENV: 'production', CONTENT_SOURCE: 'fixtures' },
    ],
    [2, 'unset, Production with no CONTENT_SOURCE', { VERCEL: '1', VERCEL_ENV: 'production' }],
    [3, 'gated, local', { READER_LAUNCH: 'gated' }],
    [
      3,
      'gated, Production with storage',
      { READER_LAUNCH: 'gated', VERCEL_ENV: 'production', CONTENT_SOURCE: 'storage' },
    ],
    [
      4,
      'review, a Vercel Preview',
      { READER_LAUNCH: 'review', VERCEL: '1', VERCEL_ENV: 'preview' },
    ],
    [4, 'review, local fixtures', { READER_LAUNCH: 'review', CONTENT_SOURCE: 'fixtures' }],
    [
      5,
      'review, Production',
      { READER_LAUNCH: 'review', VERCEL_ENV: 'production', CONTENT_SOURCE: 'storage' },
    ],
    [5, 'review, local without fixtures', { READER_LAUNCH: 'review' }],
    [6, 'launched', { READER_LAUNCH: 'launched', VERCEL_ENV: 'preview' }],
    [6, 'open', { READER_LAUNCH: 'open', CONTENT_SOURCE: 'fixtures' }],
  ])('row %i (%s)', (row, _name, env) => {
    expect(rowOf(env)).toBe(row)
    for (const committed of COMMITTED) {
      expect(resolveLaunch(env, committed), committed).toEqual(TABLE[row][committed])
    }
  })

  it(`agrees with the table on all ${GRID.length} combinations of the four inputs, in both committed states`, () => {
    expect(GRID).toHaveLength(825)
    const rows = new Set<Row>()
    for (const env of GRID) {
      const row = rowOf(env)
      rows.add(row)
      for (const committed of COMMITTED) {
        expect(resolveLaunch(env, committed), `${JSON.stringify(env)} ${committed}`).toEqual(
          TABLE[row][committed],
        )
      }
    }
    expect([...rows].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('uses PRODUCTION_LAUNCH when no committed state is passed', () => {
    for (const env of GRID) {
      expect(resolveLaunch(env)).toEqual(resolveLaunch(env, PRODUCTION_LAUNCH))
    }
  })

  it('treats an unset READER_LAUNCH and an empty one alike', () => {
    for (const committed of COMMITTED) {
      for (const env of GRID.filter((e) => !('READER_LAUNCH' in e))) {
        expect(resolveLaunch({ ...env, READER_LAUNCH: '' }, committed)).toEqual(
          resolveLaunch(env, committed),
        )
      }
    }
  })
})

describe('resolveLaunch: named cases (design §8.1 item 1)', () => {
  it.each([' review', 'Review', 'open', 'true', '1', 'launched', 'gated ', 'REVIEW', 'gated\n'])(
    'READER_LAUNCH=%j is malformed: gated and refused, in both committed states',
    (value) => {
      for (const env of [
        { READER_LAUNCH: value },
        { READER_LAUNCH: value, VERCEL_ENV: 'preview' },
        { READER_LAUNCH: value, CONTENT_SOURCE: 'fixtures' },
        { READER_LAUNCH: value, VERCEL_ENV: 'production', CONTENT_SOURCE: 'storage' },
      ]) {
        for (const committed of COMMITTED) {
          expect(resolveLaunch(env, committed)).toEqual(refused('malformed'))
        }
      }
    },
  )

  it.each<[string, Env]>([
    ['VERCEL_ENV=production', { VERCEL_ENV: 'production', CONTENT_SOURCE: 'fixtures' }],
    ['VERCEL=1 and VERCEL_ENV missing', { VERCEL: '1', CONTENT_SOURCE: 'fixtures' }],
    ["VERCEL=''", { VERCEL: '', CONTENT_SOURCE: 'fixtures' }],
    ["VERCEL_ENV=''", { VERCEL_ENV: '', CONTENT_SOURCE: 'fixtures' }],
    [
      'VERCEL_ENV=development',
      { VERCEL: '1', VERCEL_ENV: 'development', CONTENT_SOURCE: 'fixtures' },
    ],
    ['both unset and CONTENT_SOURCE=none', { CONTENT_SOURCE: 'none' }],
    ['both unset and CONTENT_SOURCE=storage', { CONTENT_SOURCE: 'storage' }],
    ['both unset and CONTENT_SOURCE missing', {}],
    ["both unset and CONTENT_SOURCE=''", { CONTENT_SOURCE: '' }],
  ])('review with %s is refused (review-not-allowed)', (_name, env) => {
    for (const committed of COMMITTED) {
      expect(resolveLaunch({ ...env, READER_LAUNCH: 'review' }, committed)).toEqual(
        refused('review-not-allowed'),
      )
    }
  })

  it('review opens a Vercel Preview whatever VERCEL and CONTENT_SOURCE hold', () => {
    for (const env of [
      { VERCEL_ENV: 'preview' },
      { VERCEL: '1', VERCEL_ENV: 'preview', CONTENT_SOURCE: 'none' },
      { VERCEL: '', VERCEL_ENV: 'preview', CONTENT_SOURCE: 'storage' },
    ]) {
      for (const committed of COMMITTED) {
        expect(resolveLaunch({ ...env, READER_LAUNCH: 'review' }, committed)).toEqual(
          open('review'),
        )
      }
    }
  })

  it.each<[string, Env]>([
    ['CONTENT_SOURCE=none', { CONTENT_SOURCE: 'none' }],
    ['CONTENT_SOURCE=fixtures', { CONTENT_SOURCE: 'fixtures' }],
    ['CONTENT_SOURCE missing', {}],
    ["CONTENT_SOURCE=''", { CONTENT_SOURCE: '' }],
  ])('a committed launched with VERCEL_ENV=production and %s is refused', (_name, env) => {
    expect(resolveLaunch({ ...env, VERCEL: '1', VERCEL_ENV: 'production' }, 'launched')).toEqual(
      refused('launched-without-storage'),
    )
  })

  it('a committed launched opens Production with CONTENT_SOURCE=storage, and the kill switch closes it', () => {
    const production = { VERCEL: '1', VERCEL_ENV: 'production', CONTENT_SOURCE: 'storage' }
    expect(resolveLaunch(production, 'launched')).toEqual(open('committed'))
    expect(resolveLaunch({ ...production, READER_LAUNCH: 'gated' }, 'launched')).toEqual(
      gated('kill-switch'),
    )
  })

  it('today’s Production settings (no READER_LAUNCH, CONTENT_SOURCE=none) are gated, not refused', () => {
    expect(
      resolveLaunch({ VERCEL: '1', VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' }),
    ).toEqual(gated('committed'))
  })

  it('a Production build with system variables off and review by mistake is refused', () => {
    for (const CONTENT_SOURCE of ['none', 'storage']) {
      expect(resolveLaunch({ READER_LAUNCH: 'review', CONTENT_SOURCE })).toEqual(
        refused('review-not-allowed'),
      )
    }
  })

  it('the CI legs: gated on the Production code path, review with fixtures', () => {
    expect(resolveLaunch({ VERCEL_ENV: 'production', CONTENT_SOURCE: 'none' })).toEqual(
      gated('committed'),
    )
    expect(resolveLaunch({ CONTENT_SOURCE: 'fixtures' })).toEqual(gated('committed'))
    expect(resolveLaunch({ CONTENT_SOURCE: 'fixtures', READER_LAUNCH: 'review' })).toEqual(
      open('review'),
    )
  })

  it('never puts the raw value in the decision or the log line', () => {
    for (const value of [' review', 'Review', 'open', 'true', 'launched', 'gated ', 'secret-x1']) {
      for (const committed of COMMITTED) {
        const result = resolveLaunch({ READER_LAUNCH: value }, committed)
        expect(Object.values(result).filter((v) => typeof v === 'string')).toEqual(['malformed'])
        // Exactly the fixed texts, whatever the value was.
        expect(launchLogLine(result)).toBe('reader launch: gated (malformed)')
        expect(() => assertLaunchAllowed(result)).toThrow(
          new Error('reader launch refused: malformed'),
        )
      }
    }
  })
})

describe('resolveLaunch: properties (fast-check, seed 20261114)', () => {
  const slot = (values: readonly string[]): fc.Arbitrary<string | undefined> =>
    fc.oneof(fc.constant(undefined), fc.constantFrom(...values), fc.string({ maxLength: 12 }))
  const envArb = (readerLaunch: fc.Arbitrary<string | undefined>): fc.Arbitrary<Env> =>
    fc
      .record({
        READER_LAUNCH: readerLaunch,
        VERCEL: slot(['', '1']),
        VERCEL_ENV: slot(['', 'production', 'preview', 'development']),
        CONTENT_SOURCE: slot(['', 'none', 'fixtures', 'storage']),
      })
      .map((fields) =>
        Object.fromEntries(
          Object.entries(fields).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
      )

  it('any non-empty READER_LAUNCH other than gated and review is refused and gated', () => {
    const malformed = fc
      .string({ minLength: 1, maxLength: 24, unit: 'grapheme-composite' })
      .filter((s) => s !== 'gated' && s !== 'review')
    fc.assert(
      fc.property(envArb(malformed), fc.constantFrom(...COMMITTED), (env, committed) => {
        expect(resolveLaunch(env, committed)).toEqual(refused('malformed'))
      }),
      { seed: SEED, numRuns: 5_000 },
    )
  })

  it('opens only in row 1 with a committed launched, and in row 4; refuses only in rows 2, 5 and 6', () => {
    const anyValue = fc.oneof(
      fc.constant(undefined),
      fc.constantFrom('', 'gated', 'review', 'launched', 'Review'),
      fc.string({ maxLength: 12 }),
    )
    fc.assert(
      fc.property(envArb(anyValue), fc.constantFrom(...COMMITTED), (env, committed) => {
        const result = resolveLaunch(env, committed)
        const row = rowOf(env)
        expect(result).toEqual(TABLE[row][committed])
        expect(result.readerRoutes).toBe((row === 1 && committed === 'launched') || row === 4)
        expect(result.refused).toBe(
          (row === 2 && committed === 'launched') || row === 5 || row === 6,
        )
        if (result.refused) expect(result.readerRoutes).toBe(false)
        // Fixed names only: the reason and the log line come from a closed set.
        expect(LAUNCH_REASONS).toContain(result.reason)
        expect(Object.keys(result).sort()).toEqual(['readerRoutes', 'reason', 'refused'])
        expect(LOG_LINES.has(launchLogLine(result))).toBe(true)
      }),
      { seed: SEED, numRuns: 5_000 },
    )
  })
})

describe('launchLogLine and assertLaunchAllowed', () => {
  it('prints the state and the reason name', () => {
    expect(launchLogLine(gated('committed'))).toBe('reader launch: gated (committed)')
    expect(launchLogLine(open('committed'))).toBe('reader launch: open (committed)')
    expect(launchLogLine(open('review'))).toBe('reader launch: open (review)')
    expect(launchLogLine(gated('kill-switch'))).toBe('reader launch: gated (kill-switch)')
    expect(launchLogLine(refused('malformed'))).toBe('reader launch: gated (malformed)')
  })

  it('throws "reader launch refused: <reason>" on every refused decision and only then', () => {
    for (const reason of ['launched-without-storage', 'review-not-allowed', 'malformed'] as const) {
      expect(() => assertLaunchAllowed(refused(reason))).toThrow(
        new Error(`reader launch refused: ${reason}`),
      )
    }
    for (const allowed of [
      gated('committed'),
      gated('kill-switch'),
      open('review'),
      open('committed'),
    ]) {
      expect(() => assertLaunchAllowed(allowed)).not.toThrow()
    }
  })
})

describe('buildLaunch', () => {
  const clear = (): void => {
    for (const name of ['READER_LAUNCH', 'VERCEL', 'VERCEL_ENV', 'CONTENT_SOURCE']) {
      vi.stubEnv(name, undefined)
    }
  }

  it('reads the four inputs from process.env', () => {
    clear()
    expect(buildLaunch()).toEqual(gated('committed'))
    vi.stubEnv('CONTENT_SOURCE', 'fixtures')
    vi.stubEnv('READER_LAUNCH', 'review')
    expect(buildLaunch()).toEqual(open('review'))
    vi.stubEnv('VERCEL', '1')
    expect(buildLaunch()).toEqual(refused('review-not-allowed'))
    vi.stubEnv('READER_LAUNCH', 'gated')
    expect(buildLaunch()).toEqual(gated('kill-switch'))
    vi.stubEnv('READER_LAUNCH', 'nope')
    expect(buildLaunch()).toEqual(refused('malformed'))
  })
})

describe('PRODUCTION_LAUNCH', () => {
  it('is pinned to gated until the owner’s Step 25b commit', () => {
    expect(PRODUCTION_LAUNCH, 'lifting is Step 25b').toBe('gated')
  })
})
