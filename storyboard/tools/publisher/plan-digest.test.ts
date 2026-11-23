// Step 17 (P1-9a) plan-digest.ts: the plan and set digests of `masters` and `stage` (design
// migration-input/p1-step17-design.md §3.20, D17-20, TP17-10; test plan 14.11: T17-35). Pure: no
// file, no request. Titles start with their id; one expect.soft per claim, messages
// "(gN) <claim> <sample>"; preconditions are hard expects starting "precondition:".
import { describe, expect, it } from 'vitest'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { planDigests, type PlanObject } from './plan-digest'

const HEX64 = /^[0-9a-f]{64}$/
const sha = (c: string) => c.repeat(64)

const OBJECTS: readonly PlanObject[] = [
  { path: 'media/b-b/x.webp', sha256: sha('b'), bytes: 2, contentType: 'image/webp', state: 'new' },
  {
    path: 'media/a-a/x.webp',
    sha256: sha('a'),
    bytes: 1,
    contentType: 'image/webp',
    state: 'existing',
  },
  {
    path: 'packages/c-c/y.json',
    sha256: sha('c'),
    bytes: 3,
    contentType: 'application/json',
    state: 'new',
  },
]
const FIXED = [{ storyId: 'a-a', packageSha256: sha('d'), version: 1 }]
const VARIABLE = { seq: 4, productionSeq: null, stagingSeq: 3 }

const byPath = (a: PlanObject, b: PlanObject) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
const withoutState = (o: PlanObject) => ({
  path: o.path,
  sha256: o.sha256,
  bytes: o.bytes,
  contentType: o.contentType,
})

/** The documented digests, built here (§3.20): set over {command, objects, fixed}, plan adds states and variable. */
async function documented(
  command: string,
  ordered: readonly PlanObject[],
  fixed: unknown,
  variable: unknown,
) {
  const set = await sha256Hex(jcsBytes({ command, objects: ordered.map(withoutState), fixed }))
  const plan = await sha256Hex(
    jcsBytes({
      command,
      objects: ordered.map((o) => ({ ...withoutState(o), state: o.state })),
      fixed,
      variable,
    }),
  )
  return { plan, set }
}

async function throwsTypeError(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    return false
  } catch (error) {
    return error instanceof TypeError
  }
}

describe('plan-digest', () => {
  it('T17-35 planDigests: set = sha256 of JCS {command, objects sorted by path, fixed}; plan adds states and variable; input order free; duplicates and ill-formed text refused; zero objects defined (A27, D17-20, TP17-10)', async () => {
    const base = await planDigests('stage', OBJECTS, { fixed: FIXED, variable: VARIABLE })
    const want = await documented('stage', [...OBJECTS].sort(byPath), FIXED, VARIABLE)
    expect(HEX64.test(base.plan) && HEX64.test(base.set), 'precondition: two 64-hex digests').toBe(
      true,
    )
    // (g0) the documented definitions
    expect.soft(base, '(g0) the digests equal the documented JCS sha256 values').toEqual(want)
    expect.soft(base.plan === base.set, '(g0) plan and set differ').toBe(false)

    // (g1) input order is free; the sort is by UTF-16 code units
    const shuffled = await planDigests('stage', [OBJECTS[2]!, OBJECTS[0]!, OBJECTS[1]!], {
      fixed: FIXED,
      variable: VARIABLE,
    })
    expect.soft(shuffled, '(g1) shuffled input gives equal digests').toEqual(base)
    const upper: PlanObject = { ...OBJECTS[0]!, path: 'media/Z/x' }
    const lower: PlanObject = { ...OBJECTS[1]!, path: 'media/a/x' }
    expect('media/Z/x' < 'media/a/x', 'precondition: Z sorts before a in code units').toBe(true)
    expect(
      'media/Z/x'.localeCompare('media/a/x') > 0,
      'precondition: localeCompare puts a first',
    ).toBe(true)
    const caseOrder = await planDigests('masters', [lower, upper], { fixed: {}, variable: {} })
    expect
      .soft(caseOrder, '(g1) media/Z/x is digested before media/a/x')
      .toEqual(await documented('masters', [upper, lower], {}, {}))

    // (g2) what each digest covers
    const digestOf = (
      objects: readonly PlanObject[],
      fixed: unknown = FIXED,
      variable: unknown = VARIABLE,
      command = 'stage',
    ) => planDigests(command, objects, { fixed, variable })
    const changed = (field: keyof PlanObject, value: string | number) =>
      OBJECTS.map((o, i) => (i === 0 ? { ...o, [field]: value } : o))
    for (const [field, value] of [
      ['path', 'media/b-b/z.webp'],
      ['sha256', sha('e')],
      ['bytes', 9],
      ['contentType', 'image/jpeg'],
    ] as const) {
      const other = await digestOf(changed(field, value))
      expect.soft(other.set !== base.set, `(g2) ${field} changes the set`).toBe(true)
      expect.soft(other.plan !== base.plan, `(g2) ${field} changes the plan`).toBe(true)
    }
    const state = await digestOf(changed('state', 'existing'))
    expect.soft(state.set, '(g2) a state leaves the set').toBe(base.set)
    expect.soft(state.plan !== base.plan, '(g2) a state changes the plan').toBe(true)
    const fixed = await digestOf(OBJECTS, [{ ...FIXED[0]!, version: 2 }])
    expect.soft(fixed.set !== base.set, '(g2) extra.fixed changes the set').toBe(true)
    expect.soft(fixed.plan !== base.plan, '(g2) extra.fixed changes the plan').toBe(true)
    const variable = await digestOf(OBJECTS, FIXED, { ...VARIABLE, seq: 5 })
    expect.soft(variable.set, '(g2) extra.variable leaves the set').toBe(base.set)
    expect.soft(variable.plan !== base.plan, '(g2) extra.variable changes the plan').toBe(true)
    const masters = await digestOf(OBJECTS, FIXED, VARIABLE, 'masters')
    expect.soft(masters.set !== base.set, '(g2) the command changes the set').toBe(true)
    expect.soft(masters.plan !== base.plan, '(g2) the command changes the plan').toBe(true)

    // (g3) refusals
    expect(
      await throwsTypeError(() => digestOf(OBJECTS)),
      'precondition: the base sample is accepted',
    ).toBe(false)
    const refused: [string, () => Promise<unknown>][] = [
      [
        'two objects with one path',
        () => digestOf([OBJECTS[0]!, { ...OBJECTS[1]!, path: OBJECTS[0]!.path }]),
      ],
      ['\\ud800 in a path', () => digestOf(changed('path', 'media/a\ud800/x'))],
      [
        '\\ud800 in a fixed string',
        () => digestOf(OBJECTS, [{ ...FIXED[0]!, storyId: 'a\ud800' }]),
      ],
      ['\\udc00 in a variable key', () => digestOf(OBJECTS, FIXED, { '\udc00': 1 })],
      ['\\ud800 in the command', () => digestOf(OBJECTS, FIXED, VARIABLE, 'stage\ud800')],
    ]
    for (const [label, run] of refused) {
      expect.soft(await throwsTypeError(run), `(g3) TypeError: ${label}`).toBe(true)
    }

    // (g4) zero objects
    const empty = await planDigests('masters', [], { fixed: {}, variable: {} })
    const again = await planDigests('masters', [], { fixed: {}, variable: {} })
    expect
      .soft(HEX64.test(empty.plan) && HEX64.test(empty.set), '(g4) two 64-hex digests')
      .toBe(true)
    expect.soft(again, '(g4) the same on every call').toEqual(empty)
    expect
      .soft(empty, '(g4) the documented values')
      .toEqual(await documented('masters', [], {}, {}))
  })
})
