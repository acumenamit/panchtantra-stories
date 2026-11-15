// The snapshot entry's optional waiver block (design p1-step8-design.md §5.2, §10.1, D9; P1-2b):
// optional and strict, keys sorted and unique, at most 256, a short ruleSetRef pattern; snapshots
// without the block (older ones, the committed fixtures) still parse.
import { describe, expect, it } from 'vitest'
import fixturesSnapshot from '../../../fixtures/catalogue/snapshots/1.json'
import {
  CatalogueSnapshot,
  compareWaiverKeys,
  WAIVER_KEYS_MAX,
  WaiverKey,
  WaiverKeys,
} from './catalogue'
import { makeSnapshot } from './catalogue-build'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)

const key = (over: Partial<WaiverKey> = {}): WaiverKey => ({
  checkId: 'E014',
  nodeId: 'ending_counsel',
  locale: 'en',
  nodeTextSha256: SHA_A,
  ...over,
})

const block = (keys: readonly WaiverKey[] = [key()]): Json => ({
  ruleSetRef: 'panchatantra@3.0.0',
  waiverFileSha256: SHA_C,
  keys,
})

const snapshot = (waivers?: Json): Json => ({
  schemaVersion: '1.0',
  seq: 4,
  createdAt: '2026-11-15T10:00:00.000Z',
  note: 'waiver block test',
  featuredStoryId: null,
  stories: [
    {
      storyId: 'crow-and-serpent',
      collectionId: 'panchatantra',
      version: 1,
      packagePath: `packages/crow-and-serpent/${SHA_B}.json`,
      packageSha256: SHA_B,
      ...(waivers === undefined ? {} : { waivers }),
    },
  ],
})

/** The first issue as "path: message", the way the build's strict-parse failure names it. */
function firstIssue(input: unknown): string {
  const result = CatalogueSnapshot.safeParse(input)
  if (result.success) return 'parsed'
  const issue = result.error.issues[0]
  return `${issue?.path.join('.')}: ${issue?.message}`
}

describe('snapshot entries without a waiver block', () => {
  it('parse as before (older snapshots)', () => {
    const parsed = CatalogueSnapshot.parse(snapshot())
    expect(parsed.stories[0]).not.toHaveProperty('waivers')
  })

  it('include the committed fixtures snapshot', () => {
    const parsed = CatalogueSnapshot.parse(fixturesSnapshot)
    expect(parsed.stories.map((s) => s.storyId)).toEqual([
      'lantern-walk',
      'river-stones',
      'two-paths',
    ])
    expect(parsed.stories.every((s) => s.waivers === undefined)).toBe(true)
  })
})

describe('snapshot entries with a waiver block', () => {
  it('parse with sorted, unique keys, an empty list included', () => {
    expect(firstIssue(snapshot(block()))).toBe('parsed')
    expect(firstIssue(snapshot(block([])))).toBe('parsed')
    const keys = [
      key({ checkId: 'E005', nodeId: 'start', locale: 'hi' }),
      key({ checkId: 'E014', nodeId: 'ending_counsel', locale: 'en' }),
      key({ checkId: 'E014', nodeId: 'ending_counsel', locale: 'hi' }),
    ]
    expect(CatalogueSnapshot.parse(snapshot(block(keys))).stories[0]?.waivers?.keys).toEqual(keys)
  })

  it('accept null nodeId and locale', () => {
    expect(WaiverKey.safeParse(key({ nodeId: null, locale: null })).success).toBe(true)
  })

  it('pass through makeSnapshot unchanged, so stage can write them', async () => {
    const built = await makeSnapshot(snapshot(block()) as CatalogueSnapshot)
    expect(built.value.stories[0]?.waivers).toEqual(block())
    expect(new TextDecoder().decode(built.bytes)).toContain('"waiverFileSha256"')
  })

  it.each([
    ['unsorted', [key({ checkId: 'E014' }), key({ checkId: 'E005' })]],
    ['duplicate', [key(), key()]],
    ['unsorted by nodeId', [key({ nodeId: 'start' }), key({ nodeId: 'ending_counsel' })]],
    ['unsorted by locale', [key({ locale: 'hi' }), key({ locale: 'en' })]],
    [
      'unsorted by nodeTextSha256',
      [key({ nodeTextSha256: SHA_B }), key({ nodeTextSha256: SHA_A })],
    ],
    ['a null nodeId after a named one', [key({ nodeId: 'start' }), key({ nodeId: null })]],
  ])('refuse %s keys with the build message', (_why, keys) => {
    expect(firstIssue(snapshot(block(keys)))).toBe(
      'stories.0.waivers.keys: keys must be sorted and unique',
    )
  })

  it.each([
    ['', false],
    ['panchatantra@3.0.0', true],
    ['panchatantra@3.1.0', true],
    ['a@1.2.3', true],
    ['Panchatantra@3.0.0', false],
    ['panchatantra@3.0', false],
    ['panchatantra@3.0.0-beta', false],
    ['panchatantra@12345.0.0', false],
    [`${'x'.repeat(33)}@1.0.0`, false],
    ['panchatantra 3.0.0', false],
  ])('ruleSetRef %j parses: %s', (ruleSetRef, ok) => {
    expect(WaiverKeys.safeParse({ ...block(), ruleSetRef }).success).toBe(ok)
  })

  it(`accept ${WAIVER_KEYS_MAX} keys and refuse ${WAIVER_KEYS_MAX + 1}`, () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => key({ nodeTextSha256: i.toString(16).padStart(64, '0') }))
    expect(WAIVER_KEYS_MAX).toBe(256)
    expect(WaiverKeys.safeParse(block(many(256))).success).toBe(true)
    expect(firstIssue(snapshot(block(many(257))))).toMatch(/^stories\.0\.waivers\.keys: /)
  })

  it.each([
    ['basis'],
    ['notes'],
    ['ruleId'],
    ['measured'],
    ['limit'],
    ['measuredOnPackageSha256'],
    ['recordedOn'],
    ['recordedBy'],
  ])('refuse the private waiver field %s in the block or in a key (strict)', (field) => {
    expect(CatalogueSnapshot.safeParse(snapshot({ ...block(), [field]: 'x' })).success).toBe(false)
    const keyed = block([{ ...key(), [field]: 'x' } as WaiverKey])
    expect(CatalogueSnapshot.safeParse(snapshot(keyed)).success).toBe(false)
  })

  it.each([
    ['a missing waiverFileSha256', { ruleSetRef: 'panchatantra@3.0.0', keys: [] }],
    ['a short waiverFileSha256', { ...block(), waiverFileSha256: 'abc' }],
    ['a missing keys list', { ruleSetRef: 'panchatantra@3.0.0', waiverFileSha256: SHA_C }],
    ['a lower-case checkId', block([key({ checkId: 'e014' })])],
    ['a long checkId', block([key({ checkId: 'E0144' })])],
    ['an unknown locale', block([key({ locale: 'fr' as WaiverKey['locale'] })])],
    ['a bad nodeId', block([key({ nodeId: 'Ending' })])],
    ['a bad nodeTextSha256', block([key({ nodeTextSha256: SHA_A.toUpperCase() })])],
    ['null in place of the block', null],
  ])('refuse %s', (_why, waivers) => {
    expect(CatalogueSnapshot.safeParse(snapshot(waivers as Json)).success).toBe(false)
  })
})

describe('compareWaiverKeys (code-unit order of the tuple)', () => {
  it('compares field by field, so a nodeId prefix sorts first and null counts as empty', () => {
    // Joined with "|" the two would sort the other way ("_" is U+005F, "|" is U+007C).
    expect(compareWaiverKeys(key({ nodeId: 'a' }), key({ nodeId: 'a_b' }))).toBeLessThan(0)
    expect(compareWaiverKeys(key({ nodeId: null }), key({ nodeId: 'a' }))).toBeLessThan(0)
    expect(compareWaiverKeys(key({ locale: null }), key({ locale: 'en' }))).toBeLessThan(0)
    expect(compareWaiverKeys(key({ checkId: 'E005' }), key({ checkId: 'E014' }))).toBeLessThan(0)
    expect(compareWaiverKeys(key(), key())).toBe(0)
  })

  it('accepts exactly the order it defines', () => {
    const keys = [key({ nodeId: 'a_b' }), key({ nodeId: 'a' }), key({ nodeId: null })]
    expect(WaiverKeys.safeParse(block(keys)).success).toBe(false)
    expect(WaiverKeys.safeParse(block([...keys].sort(compareWaiverKeys))).success).toBe(true)
  })
})
