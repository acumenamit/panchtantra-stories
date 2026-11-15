// The 3 committed synthetic fixtures as a staging catalogue on the local Storage stub, for tests and
// the staging harness only (design p1-step9-design.md §2, §3.6 row 29, §6.8; P1-2c). Built with the
// catalogue builders of src/core/package/catalogue-build, at the spec's Storage layout:
//   packages/<storyId>/<sha256>.json   each fixture package as canonical JCS bytes
//   catalogue/snapshots/1.json         the snapshot (seq 1, fixed timestamps, no approvals)
//   catalogue/staging.json             the staging pointer
// The packages declare no media, so a load makes no HEAD request. load-content.test.ts keeps its own
// publish and servePackage helpers, which carry test-only knobs (design §3.6 row 29).
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import {
  makePointer,
  makeSnapshot,
  pointerPath,
  snapshotPath,
} from '../../src/core/package/catalogue-build'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { FIXTURES_SEQ, FIXTURES_TIMESTAMP } from '../build-fixtures-catalogue'
import type { StubStorage } from './stub-storage'

/** The committed fixtures folder (storyboard/fixtures). */
export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures')

/** The staging pointer the harness loads: catalogue/staging.json (pointer root ''). */
export const STAGING_POINTER_PATH = pointerPath('staging')

export const STAGING_NOTE =
  'Synthetic fixtures as a staging catalogue for the stub harness; scripts/testing/staging-catalogue.ts'

const JSON_TYPE = 'application/json'

/** One published package: its snapshot entry and the exact bytes the stub serves. */
export interface StagingPackage {
  readonly entry: SnapshotEntry
  readonly bytes: Uint8Array<ArrayBuffer>
}

export interface StagingCatalogue {
  readonly pointerPath: string
  readonly snapshotPath: string
  readonly pointerBytes: Uint8Array<ArrayBuffer>
  readonly snapshotBytes: Uint8Array<ArrayBuffer>
  /** In snapshot order (file name order). */
  readonly packages: readonly StagingPackage[]
}

/**
 * Each fixtures/packages/*.json, sorted by file name, strict-parsed and re-serialized as canonical
 * JCS (the committed files are not canonical), named by sha256 of those bytes.
 */
export async function stagingPackages(fixturesDir = FIXTURES_DIR): Promise<StagingPackage[]> {
  const dir = join(fixturesDir, 'packages')
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const packages: StagingPackage[] = []
  for (const name of names) {
    const raw: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    const pkg = StoryPackageV1.parse(raw)
    const bytes = jcsBytes(raw)
    const packageSha256 = await sha256Hex(bytes)
    packages.push({
      entry: {
        storyId: pkg.storyId,
        collectionId: pkg.collectionId,
        version: pkg.version,
        packagePath: `packages/${pkg.storyId}/${packageSha256}.json`,
        packageSha256,
      },
      bytes,
    })
  }
  return packages
}

/**
 * Publishes the committed fixtures to `stub` as a staging catalogue: every package, the snapshot
 * (seq 1, featuredStoryId null, no approvalSha256: staging skips the approval gate) and the
 * pointer catalogue/staging.json. Same packages, same bytes.
 */
export async function publishFixturesAsStaging(
  stub: Pick<StubStorage, 'put'>,
  fixturesDir = FIXTURES_DIR,
): Promise<StagingCatalogue> {
  const packages = await stagingPackages(fixturesDir)
  const snapshot = await makeSnapshot({
    schemaVersion: '1.0',
    seq: FIXTURES_SEQ,
    createdAt: FIXTURES_TIMESTAMP,
    note: STAGING_NOTE,
    featuredStoryId: null,
    stories: packages.map((p) => p.entry),
  })
  const sPath = snapshotPath(FIXTURES_SEQ)
  const pointer = await makePointer({
    schemaVersion: '1.0',
    seq: FIXTURES_SEQ,
    snapshotPath: sPath,
    snapshotSha256: snapshot.sha256,
    updatedAt: FIXTURES_TIMESTAMP,
  })
  for (const { entry, bytes } of packages) stub.put(entry.packagePath, bytes, JSON_TYPE)
  stub.put(sPath, snapshot.bytes, JSON_TYPE)
  stub.put(STAGING_POINTER_PATH, pointer.bytes, JSON_TYPE)
  return {
    pointerPath: STAGING_POINTER_PATH,
    snapshotPath: sPath,
    pointerBytes: pointer.bytes,
    snapshotBytes: snapshot.bytes,
    packages,
  }
}
