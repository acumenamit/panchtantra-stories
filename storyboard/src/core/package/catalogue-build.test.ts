import { describe, expect, it } from 'vitest'
import { checkPointer, checkSnapshot, modeFromPointerPath } from '../content/gates'
import { sha256Hex, toJcs } from '../hashing'
import { CataloguePointer, CatalogueSnapshot } from './catalogue'
import { makePointer, makeSnapshot, pointerPath, snapshotPath } from './catalogue-build'

const SHA = 'd'.repeat(64)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const snapshotInput = (over: Partial<CatalogueSnapshot> = {}): CatalogueSnapshot => ({
  schemaVersion: '1.0',
  seq: 7,
  createdAt: '2026-11-07T10:00:00.000Z',
  note: 'पञ्चतन्त्र build test',
  featuredStoryId: 'blue-jackal',
  stories: [
    {
      storyId: 'blue-jackal',
      collectionId: 'panchatantra',
      version: 1,
      packagePath: `packages/blue-jackal/${SHA}.json`,
      packageSha256: SHA,
      approvalSha256: SHA,
    },
  ],
  ...over,
})

describe('snapshotPath and pointerPath', () => {
  it('builds the spec §4.4 paths, with an optional root', () => {
    expect(snapshotPath(1)).toBe('catalogue/snapshots/1.json')
    expect(snapshotPath(42, 'spikes/run/')).toBe('spikes/run/catalogue/snapshots/42.json')
    expect(pointerPath('production')).toBe('catalogue/production.json')
    expect(pointerPath('staging', 'spikes/run/')).toBe('spikes/run/catalogue/staging.json')
  })

  it('builds pointer paths that the pointer gate maps back to the same mode and root', () => {
    for (const mode of ['production', 'staging'] as const) {
      expect(modeFromPointerPath(pointerPath(mode, 'spikes/run/'), ['', 'spikes/run/'])).toEqual({
        ok: true,
        value: { mode, root: 'spikes/run/' },
      })
    }
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('refuses seq %s', (seq) => {
    expect(() => snapshotPath(seq)).toThrow(RangeError)
  })

  it.each(['spikes', '/spikes/', '../', 'a//'])('refuses root %j', (root) => {
    expect(() => snapshotPath(1, root)).toThrow(TypeError)
    expect(() => pointerPath('production', root)).toThrow(TypeError)
  })
})

describe('makeSnapshot', () => {
  it('returns JCS bytes, their sha256, and a value that round-trips through the strict schema', async () => {
    const built = await makeSnapshot(snapshotInput())
    expect(decode(built.bytes)).toBe(toJcs(snapshotInput()))
    expect(built.sha256).toBe(await sha256Hex(built.bytes))
    expect(CatalogueSnapshot.parse(JSON.parse(decode(built.bytes)))).toEqual(built.value)
    expect(built.value).toEqual(snapshotInput())
  })

  it('omits an absent approvalSha256 instead of writing null', async () => {
    const unapproved = { ...snapshotInput().stories[0]! }
    delete unapproved.approvalSha256
    const built = await makeSnapshot(snapshotInput({ stories: [unapproved] }))
    expect(decode(built.bytes)).not.toContain('approvalSha256')
  })

  it('produces the same bytes whatever the key order of the input', async () => {
    const reversed = Object.fromEntries(Object.entries(snapshotInput()).reverse())
    const a = await makeSnapshot(snapshotInput())
    const b = await makeSnapshot(reversed as CatalogueSnapshot)
    expect(b.sha256).toBe(a.sha256)
  })

  it.each([
    ['seq 0', { seq: 0 }],
    ['a createdAt without time', { createdAt: '2026-11-07' }],
    ['a malformed featuredStoryId', { featuredStoryId: 'Blue Jackal' }],
  ])('refuses %s', async (_why, over) => {
    await expect(makeSnapshot(snapshotInput(over))).rejects.toThrow(/^invalid snapshot: /)
  })

  it('refuses an unknown key', async () => {
    const input = { ...snapshotInput(), extra: 1 } as CatalogueSnapshot
    await expect(makeSnapshot(input)).rejects.toThrow(/^invalid snapshot: /)
  })
})

describe('makePointer', () => {
  it('returns JCS bytes that round-trip through the strict schema', async () => {
    const input: CataloguePointer = {
      schemaVersion: '1.0',
      seq: 7,
      snapshotPath: snapshotPath(7),
      snapshotSha256: SHA,
      updatedAt: '2026-11-07T10:00:01.000Z',
    }
    const built = await makePointer(input)
    expect(decode(built.bytes)).toBe(toJcs(input))
    expect(built.sha256).toBe(await sha256Hex(built.bytes))
    expect(CataloguePointer.parse(JSON.parse(decode(built.bytes)))).toEqual(input)
  })

  it.each(['catalogue/snapshots/../x.json', '/catalogue/snapshots/7.json', 'a?b'])(
    'refuses the unsafe snapshotPath %j',
    async (path) => {
      const input: CataloguePointer = {
        schemaVersion: '1.0',
        seq: 7,
        snapshotPath: path,
        snapshotSha256: SHA,
        updatedAt: '2026-11-07T10:00:01.000Z',
      }
      await expect(makePointer(input)).rejects.toThrow('invalid pointer: snapshotPath is unsafe')
    },
  )

  it('refuses a malformed snapshotSha256', async () => {
    const input: CataloguePointer = {
      schemaVersion: '1.0',
      seq: 7,
      snapshotPath: snapshotPath(7),
      snapshotSha256: 'not-a-hash',
      updatedAt: '2026-11-07T10:00:01.000Z',
    }
    await expect(makePointer(input)).rejects.toThrow(/^invalid pointer: snapshotSha256: /)
  })
})

describe('builders and gates together', () => {
  it('a built pointer and snapshot pass both build gates', async () => {
    const root = 'spikes/run/'
    const snapshot = await makeSnapshot(snapshotInput())
    const pointer = await makePointer({
      schemaVersion: '1.0',
      seq: snapshot.value.seq,
      snapshotPath: snapshotPath(snapshot.value.seq, root),
      snapshotSha256: snapshot.sha256,
      updatedAt: '2026-11-07T10:00:01.000Z',
    })
    const location = modeFromPointerPath(pointerPath('production', root), ['', root])
    if (!location.ok) throw new Error(location.reason)
    const checkedPointer = checkPointer(pointer.bytes, location.value)
    expect(checkedPointer).toEqual({ ok: true, value: pointer.value })
    const checked = await checkSnapshot(snapshot.bytes, pointer.value, location.value.mode)
    expect(checked.ok && checked.value.included).toEqual(snapshot.value.stories)
  })
})
