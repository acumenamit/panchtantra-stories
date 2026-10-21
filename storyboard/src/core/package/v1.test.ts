import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/packages/two-paths.json'
import { jcsSha256 } from '../hashing'
import { CataloguePointer, CatalogueSnapshot } from './catalogue'
import { ChoiceId, NodeId, StoryId, StoryPackageV1, StoryPackageV1Read } from './v1'

const clone = <T>(v: T): T => structuredClone(v)
type Mutable = Record<string, unknown> & { nodes: Record<string, unknown>[] }
const pkg = () => clone(fixture) as unknown as Mutable

describe('Story Package v1 schema', () => {
  it('strict-parses the en+hi fixture', () => {
    const r = StoryPackageV1.safeParse(fixture)
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
  })

  it('accepts a package that omits the disabled "ar" locale (partialRecord)', () => {
    const p = pkg()
    p.locales = ['en']
    p.text = { en: (fixture.text as Record<string, unknown>).en }
    expect(StoryPackageV1.safeParse(p).success).toBe(true)
  })

  it('rejects unknown keys in strict mode and strips them in read mode', () => {
    const p = pkg()
    p.futureField = 1
    ;(p.nodes[0] as Record<string, unknown>).futureNodeField = true
    expect(StoryPackageV1.safeParse(p).success).toBe(false)
    const read = StoryPackageV1Read.safeParse(p)
    expect(read.success).toBe(true)
    expect(read.data).not.toHaveProperty('futureField')
    expect(read.data?.nodes[0]).not.toHaveProperty('futureNodeField')
  })

  it.each([
    ['text', (j: string) => j.replace('"text":{', '"text":{"__proto__":{},')],
    ['text.en.nodes', (j: string) => j.replace('"nodes":{', '"nodes":{"__proto__":{"text":"x"},')],
    ['a choices record', (j: string) => j.replace('"choices":{', '"choices":{"__proto__":"zz",')],
  ])('rejects a "__proto__" key inside %s in strict mode', (_where, inject) => {
    const raw = inject(JSON.stringify(fixture))
    expect(raw).toContain('"__proto__"')
    expect(StoryPackageV1.safeParse(JSON.parse(raw)).success).toBe(false)
  })

  it.each([
    ['fork with 1 choice', 'start', [{ id: 'c1', next: 'wise_path' }]],
    [
      'single with 2 choices',
      'wise_path',
      [
        { id: 'c1', next: 'ending_wise' },
        { id: 'c2', next: 'ending_quick' },
      ],
    ],
    [
      'alternate with 3 choices',
      'quick_path',
      [
        { id: 'c1', next: 'ending_quick' },
        { id: 'c2', next: 'ending_wise' },
        { id: 'c3', next: 'start' },
      ],
    ],
  ])('enforces FIXED per-type choice counts: rejects %s', (_label, nodeId, choices) => {
    const p = pkg()
    const node = p.nodes.find((n) => n.id === nodeId)!
    node.choices = choices
    expect(StoryPackageV1.safeParse(p).success).toBe(false)
  })

  it('rejects an ending that has choices', () => {
    const p = pkg()
    const ending = p.nodes.find((n) => n.id === 'ending_wise')!
    ending.choices = [{ id: 'c1', next: 'start' }]
    expect(StoryPackageV1.safeParse(p).success).toBe(false)
  })

  it('requires text for exactly the declared locales', () => {
    const missing = pkg()
    missing.text = { en: (fixture.text as Record<string, unknown>).en }
    expect(StoryPackageV1.safeParse(missing).success).toBe(false)

    const extra = pkg()
    extra.locales = ['en']
    expect(StoryPackageV1.safeParse(extra).success).toBe(false)
  })

  it('requires defaultLocale to be one of locales, and locales to be unique', () => {
    const p1 = pkg()
    p1.defaultLocale = 'ar'
    expect(StoryPackageV1.safeParse(p1).success).toBe(false)

    const p2 = pkg()
    p2.locales = ['en', 'hi', 'en']
    expect(StoryPackageV1.safeParse(p2).success).toBe(false)
  })

  it('checks id formats', () => {
    expect(StoryId.safeParse('blue-jackal').success).toBe(true)
    expect(StoryId.safeParse('Blue-Jackal').success).toBe(false)
    expect(StoryId.safeParse('ab').success).toBe(false)
    expect(NodeId.safeParse('ending_wise').success).toBe(true)
    expect(NodeId.safeParse('1start').success).toBe(false)
    expect(ChoiceId.safeParse('c4').success).toBe(true)
    expect(ChoiceId.safeParse('c5').success).toBe(false)
  })

  it('hashes the fixture the same way after a key-order shuffle', async () => {
    const shuffled = Object.fromEntries(Object.entries(fixture).reverse())
    expect(await jcsSha256(shuffled)).toBe(await jcsSha256(fixture))
  })
})

describe('catalogue schemas', () => {
  const sha = 'a'.repeat(64)

  it('parses a snapshot and a pointer', () => {
    expect(
      CatalogueSnapshot.safeParse({
        schemaVersion: '1.0',
        seq: 1,
        createdAt: '2026-10-21T10:00:00Z',
        note: 'first',
        featuredStoryId: null,
        stories: [
          {
            storyId: 'two-paths',
            collectionId: 'panchatantra',
            version: 1,
            packagePath: `packages/two-paths/${sha}.json`,
            packageSha256: sha,
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      CataloguePointer.safeParse({
        schemaVersion: '1.0',
        seq: 1,
        snapshotPath: 'catalogue/snapshots/1.json',
        snapshotSha256: sha,
        updatedAt: '2026-10-21T10:00:00Z',
      }).success,
    ).toBe(true)
  })

  it('rejects a snapshot with seq 0', () => {
    expect(
      CatalogueSnapshot.safeParse({
        schemaVersion: '1.0',
        seq: 0,
        createdAt: '2026-10-21T10:00:00Z',
        note: '',
        featuredStoryId: null,
        stories: [],
      }).success,
    ).toBe(false)
  })
})
