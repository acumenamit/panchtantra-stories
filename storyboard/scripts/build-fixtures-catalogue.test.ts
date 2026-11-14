import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { checkPointer, checkSnapshot } from '../src/core/content/gates'
import { checkPackage } from '../src/core/content/packages'
import { sha256Hex } from '../src/core/hashing'
import { CatalogueSnapshot } from '../src/core/package/catalogue'
import { PANCHATANTRA_RULESET } from '../src/core/rules/panchatantra'
import { buildFixturesCatalogue, FIXTURES_TIMESTAMP } from './build-fixtures-catalogue'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const STALE =
  'the committed fixtures catalogue no longer matches fixtures/packages: run "pnpm fixtures:catalogue" (scripts/build-fixtures-catalogue.ts) and commit fixtures/catalogue/'

/** Every file under fixtures/<folder>, as '/'-separated paths relative to fixtures/. */
function filesUnder(folder: string): string[] {
  return readdirSync(join(fixturesDir, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(fixturesDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

const readFixture = (path: string) =>
  new Uint8Array(readFileSync(join(fixturesDir, ...path.split('/'))))

describe('fixtures catalogue (drift check)', () => {
  it('matches the packages byte for byte', async () => {
    const built = await buildFixturesCatalogue(fixturesDir)
    expect(filesUnder('catalogue'), STALE).toEqual(built.map((f) => f.path).sort())
    for (const file of built) {
      const same = Buffer.from(readFixture(file.path)).equals(Buffer.from(file.bytes))
      expect(same, `${file.path}: ${STALE}`).toBe(true)
    }
  })

  // The drift test above is the main proof of determinism: it compares fresh bytes with bytes
  // committed earlier. This one moves the clock between two runs, so any use of it shows up.
  it('never reads the clock: two runs years apart give the same bytes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
      const a = await buildFixturesCatalogue(fixturesDir)
      vi.setSystemTime(new Date('2041-06-15T12:34:56.789Z'))
      const b = await buildFixturesCatalogue(fixturesDir)
      expect(a.map((f) => Buffer.from(f.bytes).toString('hex'))).toEqual(
        b.map((f) => Buffer.from(f.bytes).toString('hex')),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fixtures catalogue (contents)', () => {
  it('lists the 3 synthetic packages, seq 1, fixed time, no featured story, no approvals', async () => {
    const snapshot = CatalogueSnapshot.parse(
      JSON.parse(new TextDecoder().decode(readFixture('catalogue/snapshots/1.json'))),
    )
    expect(snapshot.seq).toBe(1)
    expect(snapshot.createdAt).toBe(FIXTURES_TIMESTAMP)
    expect(snapshot.featuredStoryId).toBeNull()
    expect(snapshot.stories.map((s) => [s.storyId, s.packagePath])).toEqual([
      ['lantern-walk', 'packages/lantern-walk.json'],
      ['river-stones', 'packages/river-stones.json'],
      ['two-paths', 'packages/two-paths.json'],
    ])
    expect(snapshot.stories.every((s) => s.approvalSha256 === undefined)).toBe(true)
    expect(filesUnder('packages')).toEqual(snapshot.stories.map((s) => s.packagePath))
  })

  it('passes the pointer, snapshot and package gates in fixtures mode', async () => {
    const pointer = checkPointer(readFixture('catalogue/fixtures.json'), {
      mode: 'fixtures',
      root: '',
    })
    if (!pointer.ok) throw new Error(pointer.reason)
    const checked = await checkSnapshot(
      readFixture(pointer.value.snapshotPath),
      pointer.value,
      'fixtures',
    )
    if (!checked.ok) throw new Error(checked.reason)
    expect(checked.value.excluded).toEqual([])
    for (const entry of checked.value.included) {
      const r = await checkPackage(readFixture(entry.packagePath), entry, PANCHATANTRA_RULESET)
      expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    }
  })

  it('names each package in the committed snapshot by the sha256 of its file bytes', async () => {
    const snapshot = CatalogueSnapshot.parse(
      JSON.parse(new TextDecoder().decode(readFixture('catalogue/snapshots/1.json'))),
    )
    expect(snapshot.stories).toHaveLength(3)
    for (const entry of snapshot.stories) {
      expect(entry.packageSha256).toBe(await sha256Hex(readFixture(entry.packagePath)))
    }
  })

  it('keeps every package synthetic: en and hi, no media, marked as a test fixture', () => {
    for (const path of filesUnder('packages')) {
      const pkg = JSON.parse(new TextDecoder().decode(readFixture(path)))
      expect(pkg.locales).toEqual(['en', 'hi'])
      expect(pkg.assets).toEqual([])
      expect(pkg.text.en.title).toMatch(/\(test fixture\)$/)
      expect(pkg.text.en.description).toBe('A synthetic story used only by tests.')
    }
  })
})
