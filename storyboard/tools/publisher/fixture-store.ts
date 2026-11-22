// The publisher's --fixtures world (design migration-input/p1-step16-design.md §3.15, D16-15,
// D16-32; P1-8e, Step 16): an in-memory store whose reads answer like the Storage client and whose
// writes throw, verify's live answer and the public reads, for `approve`, `publish` and `verify`
// with `--fixtures` (the P1-8 exit dry runs, SPEC:735).
// - Built at run time, on every call, from the committed fixture packages through stage-testkit's
//   builders (buildTestStories, fullyBoundStory, withPackage, approvalRecordOf) and the real
//   composition and document builders (composeProduction, composeStaging, buildProductionDocuments,
//   buildStagingDocuments), so the snapshots are exactly what the publisher would write. Paths come
//   from storage-layout only. The clock is fixed, so two calls give equal bytes.
// - The table (§3.15): lantern-walk L, river-stones R (and R2, its version 2 with R's media and
//   waiver file) and two-paths T* (every node pictured and narrated). Snapshot 1 production [T*p],
//   2 staging [T*p, R], 3 production [T*p, Rp] (the production pointer), 4 staging [T*p, R2, L] (the
//   staging pointer); featured null; approval records for T*, R and R2, none for L; each story's
//   waiver file in masters.
// - Reads: listContent of '' or a safe folder ending '/' (anything else is a TypeError), every object
//   under it, sorted by path in UTF-16 code-unit order, with the stub's listing fields for an object
//   stage created; readContent and readMaster answer found with a fresh copy, its size and sha256, or
//   not-found, and throw a TypeError for a ref the layout refuses. create and writePointer reject
//   with TypeError('fixtures: read-only store'). live answers seq 3 with snapshot 3's build; the site
//   answers each landing ok and each object and Range read from the world's own bytes (ok for every
//   object it holds as named; B16-implB-1).
// - It holds no key, URL or route text, never prints, and has no file, process or network API; it
//   never calls stage-testkit's two node:fs writers. cli.ts loads it only through the `--fixtures`
//   dynamic import (D16-32), so a real run never evaluates it or the test kit.
import { expectedPackagePath, isSafeStoragePath } from '../../src/core/content/gates'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { sha256Hex } from '../../src/core/hashing'
import { WaiverKeys, type CatalogueSnapshot } from '../../src/core/package/catalogue'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { WaiverFile, deriveWaiverKeys } from '../../src/core/validator/waivers'
import {
  buildProductionDocuments,
  buildStagingDocuments,
  composeProduction,
  composeStaging,
  type DocumentsResult,
  type StagingDocuments,
} from './catalogue-state'
import type {
  ContentReadResult,
  FixtureSet,
  LiveBuild,
  ObjectAnswer,
  RangeAnswer,
  ReadResult,
  StorageReader,
  StorageWriter,
  StoredObject,
} from './port'
import {
  answersOf,
  approvalRecordOf,
  buildTestStories,
  fullyBoundStory,
  withPackage,
  type TestStory,
} from './stage-testkit'
import {
  classOfPath,
  contentReadTarget,
  pointerTarget,
  targetOf,
  type LayoutResult,
  type Target,
} from './storage-layout'

/** The world's clock (§3.15): every snapshot, pointer and approval date. */
const FIXTURE_NOW = new Date('2026-11-22T00:00:00.000Z')
/** The roles of the fixture stories (§3.16): one id per row of the P1-8 exit matrix. */
const ROLES = {
  approve: 'lantern-walk',
  publish: 'river-stones',
  feature: 'two-paths',
  unpublish: 'river-stones',
  rollback: 1,
} as const

/** What the runbook, the owner steps and the tests type for the fixtures dispatches (TP16-9). */
interface FixtureFacts {
  readonly approve: {
    readonly storyId: string
    readonly packagePrefix: string
    readonly answers: Readonly<Record<string, string>>
  }
  readonly publish: { readonly storyIds: string }
  readonly feature: { readonly storyId: string }
  readonly rollback: { readonly snapshot: string }
  readonly unpublish: { readonly storyId: string }
}

interface ContentObject {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly mimetype: string | null
  readonly cacheControl: string
}

const failed = (what: string): never => {
  throw new TypeError(`fixtures: ${what}`)
}

const readOnly = async (): Promise<never> => {
  throw new TypeError('fixtures: read-only store')
}

/** A layout result's target, or a TypeError: the world builds every path through the layout. */
const targetFrom = (result: LayoutResult<Target>): Target =>
  result.ok ? result.value : failed('the layout refuses a ref')

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** The stories of §3.15, by role, from the committed fixture packages. */
async function cast(): Promise<{ L: TestStory; R: TestStory; T: TestStory; R2: TestStory }> {
  const all = await buildTestStories()
  const pick = (id: string): TestStory =>
    all.find((story) => story.storyId === id) ?? failed(`no fixture story ${id}`)
  const R = pick(ROLES.publish)
  return {
    L: pick(ROLES.approve),
    R,
    T: await fullyBoundStory(pick(ROLES.feature)),
    R2: await withPackage(R, StoryPackageV1.parse({ ...R.pkg, version: 2 })),
  }
}

/** The staging entry stage writes for a story (stage.ts, story-checks.ts): its waiver block included. */
function entryOf(story: TestStory): SnapshotEntry {
  const file = WaiverFile.parse(JSON.parse(new TextDecoder().decode(story.waiverBytes)))
  const waivers = WaiverKeys.parse(deriveWaiverKeys(file, story.waiverSha256))
  const { storyId, packageSha256 } = story
  return {
    storyId,
    collectionId: story.pkg.collectionId,
    version: story.pkg.version,
    packagePath: expectedPackagePath({ storyId, packageSha256 }, 'staging', ''),
    packageSha256,
    waivers,
  }
}

const documentsOf = (result: DocumentsResult): StagingDocuments =>
  result.ok ? result.documents : failed('a document builder refused the table')

/** The four snapshots of §3.15's table, through the real compose and document builders, in order. */
async function snapshotsOf(
  stories: { L: TestStory; R: TestStory; T: TestStory; R2: TestStory },
  approvalSha: { T: string; R: string },
): Promise<StagingDocuments[]> {
  const { L, R, T, R2 } = stories
  const value = (docs: StagingDocuments): CatalogueSnapshot => docs.snapshot.value
  const production = (
    current: CatalogueSnapshot | null,
    story: TestStory,
    approvalSha256: string,
  ) => {
    const composed = composeProduction({
      production: current,
      named: [{ entry: entryOf(story), approvalSha256 }],
      feature: undefined,
    })
    return composed.ok ? composed.composition : failed('a production composition refused the table')
  }
  const staging = (
    current: CatalogueSnapshot | null,
    staged: CatalogueSnapshot | null,
    named: readonly TestStory[],
  ) => {
    const composed = composeStaging({
      production: current,
      staging: staged,
      named: named.map(entryOf),
    })
    return composed.ok ? composed.composition : failed('a staging composition refused the table')
  }
  const s1 = documentsOf(
    await buildProductionDocuments(production(null, T, approvalSha.T), 1, FIXTURE_NOW),
  )
  const s2 = documentsOf(
    await buildStagingDocuments(staging(value(s1), null, [T, R]), 2, FIXTURE_NOW),
  )
  const s3 = documentsOf(
    await buildProductionDocuments(production(value(s1), R, approvalSha.R), 3, FIXTURE_NOW),
  )
  const s4 = documentsOf(
    await buildStagingDocuments(staging(value(s3), value(s2), [R2, L]), 4, FIXTURE_NOW),
  )
  return [s1, s2, s3, s4]
}

/** A found read: a fresh copy of the bytes, their size and sha256. */
async function foundOf(bytes: Uint8Array<ArrayBuffer>): Promise<{
  readonly kind: 'found'
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly size: number
  readonly sha256: string
}> {
  const copy = new Uint8Array(bytes)
  return { kind: 'found', bytes: copy, size: copy.byteLength, sha256: await sha256Hex(copy) }
}

/**
 * The --fixtures world (§3.15): a new store on every call, built from the committed fixture
 * packages; deterministic (two calls give equal bytes).
 */
export async function openFixtureSet(): Promise<FixtureSet> {
  const stories = await cast()
  const { L, R, T, R2 } = stories
  const on = FIXTURE_NOW.toISOString().slice(0, 10)
  const approvals = [
    await approvalRecordOf(T, { on }),
    await approvalRecordOf(R, { on }),
    await approvalRecordOf(R2, { on }),
  ]
  const [aT, aR] = approvals
  if (aT === undefined || aR === undefined) return failed('no approval record')
  const snapshots = await snapshotsOf(stories, { T: aT.sha256, R: aR.sha256 })
  const [, , production, staging] = snapshots
  if (production === undefined || staging === undefined) return failed('no pointer snapshot')

  const content = new Map<string, ContentObject>()
  const masters = new Map<string, Uint8Array<ArrayBuffer>>()
  const putContent = (target: Target, bytes: Uint8Array<ArrayBuffer>) => {
    if (content.has(target.path)) return failed('a content path is built twice')
    content.set(target.path, {
      bytes: new Uint8Array(bytes),
      mimetype: target.contentType,
      cacheControl: `max-age=${target.cacheSeconds ?? 0}`,
    })
  }
  putContent(targetFrom(pointerTarget('production')), production.pointer.bytes)
  putContent(targetFrom(pointerTarget('staging')), staging.pointer.bytes)
  for (const docs of snapshots) {
    putContent(
      targetFrom(targetOf({ kind: 'snapshot', seq: docs.seq }, 'create')),
      docs.snapshot.bytes,
    )
  }
  for (const story of [T, R, R2, L]) {
    const ref = { kind: 'package', storyId: story.storyId, packageSha256: story.packageSha256 }
    putContent(targetFrom(targetOf(ref, 'create')), story.packageBytes)
  }
  for (const story of [T, R, L]) {
    for (const media of story.media) {
      const named = classOfPath('content', media.path)
      if (named?.kind !== 'media') return failed('a medium is not named by the media class')
      const target = targetFrom(targetOf({ kind: 'media', ...named.fields }, 'create'))
      if (target.path !== media.path) return failed('a medium path differs from the layout')
      putContent(target, media.bytes)
    }
  }
  for (const [story, approval] of [
    [T, aT],
    [R, aR],
    [R2, approvals[2]],
  ] as const) {
    if (approval === undefined) return failed('no approval record')
    const ref = { kind: 'approval', storyId: story.storyId, packageSha256: story.packageSha256 }
    masters.set(targetFrom(targetOf(ref, 'create')).path, new Uint8Array(approval.bytes))
  }
  for (const story of [T, R, R2, L]) {
    const ref = { kind: 'waiver', storyId: story.storyId, waiverSha256: story.waiverSha256 }
    masters.set(targetFrom(targetOf(ref, 'read')).path, new Uint8Array(story.waiverBytes))
  }
  const updatedAt = FIXTURE_NOW.toISOString()

  const reader: StorageReader = {
    listContent: async (folder) => {
      if (
        typeof folder !== 'string' ||
        !(folder === '' || (folder.endsWith('/') && isSafeStoragePath(folder.slice(0, -1))))
      ) {
        return failed('the folder is not a listing prefix')
      }
      const objects: StoredObject[] = [...content.entries()]
        .filter(([path]) => path.startsWith(folder))
        .map(([path, object]) => ({
          path,
          size: object.bytes.byteLength,
          mimetype: object.mimetype,
          cacheControl: object.cacheControl,
          updatedAt,
        }))
        .sort((a, b) => byCodeUnits(a.path, b.path))
      return { kind: 'listed', objects }
    },
    readContent: async (ref): Promise<ContentReadResult> => {
      const object = content.get(targetFrom(contentReadTarget(ref)).path)
      return object === undefined ? { kind: 'not-found' } : foundOf(object.bytes)
    },
    readMaster: async (ref): Promise<ReadResult> => {
      const target = targetFrom(targetOf(ref, 'read'))
      const bytes = masters.get(target.path)
      if (bytes === undefined) return { kind: 'not-found' }
      const found = await foundOf(bytes)
      if (target.kind === 'waiver' && found.sha256 !== target.fields.waiverSha256) {
        return { kind: 'hash-mismatch', sha256: found.sha256 }
      }
      return found
    },
  }
  const writer: StorageWriter = { create: readOnly, writePointer: readOnly }

  /**
   * A public read of a media object from the world's own bytes, with readPublicObject's checks in
   * its order: null when it is held as named, else the first failing check.
   */
  const publicObject = async (
    path: string,
    bytes: number,
    mime: string,
  ): Promise<'status' | 'length' | 'type' | 'hash' | null> => {
    const named = classOfPath('content', path)
    const object = content.get(path)
    if (named?.kind !== 'media' || object === undefined) return 'status'
    if (object.bytes.byteLength !== bytes) return 'length'
    if (object.mimetype !== mime) return 'type'
    if ((await sha256Hex(object.bytes)) !== named.fields.sha256) return 'hash'
    return null
  }
  const RANGE_REASON = {
    status: 'full-status',
    length: 'full-length',
    type: 'full-type',
    hash: 'full-hash',
  } as const
  const productionValue = production.snapshot.value
  const buildOf = (): LiveBuild => ({
    snapshotSha256: production.snapshot.sha256,
    featuredStoryId: productionValue.featuredStoryId,
    stories: productionValue.stories.map((entry) => ({
      storyId: entry.storyId,
      version: entry.version,
      packageSha256: entry.packageSha256,
    })),
    excluded: [],
  })

  return {
    client: { ...reader, ...writer },
    live: async () => ({ kind: 'live', seq: production.seq, build: buildOf() }),
    site: {
      landing: async () => ({ kind: 'ok' }),
      object: async (head): Promise<ObjectAnswer> => {
        const refused = await publicObject(head.path, head.bytes, head.mime)
        if (refused === null) return { kind: 'ok' }
        return { kind: 'failed', reason: refused, status: refused === 'status' ? 404 : 200 }
      },
      range: async (target): Promise<RangeAnswer> => {
        const named = classOfPath('content', target.path)?.fields.sha256
        const refused =
          (await publicObject(target.path, target.bytes, 'audio/mpeg')) ??
          (target.sha256 === named ? null : 'hash')
        if (refused !== null) {
          const reason = RANGE_REASON[refused]
          return { kind: 'failed', reason, status: refused === 'status' ? 404 : 200 }
        }
        const size = target.bytes
        const start = Math.floor(size / 2)
        return { kind: 'ok', start, end: Math.min(size - 1, start + 1023), size }
      },
    },
  }
}

/** The values the runbook's fixture table and the owner's fixtures dispatches type (TP16-9). */
export async function fixtureFacts(): Promise<FixtureFacts> {
  const { L } = await cast()
  return {
    approve: {
      storyId: L.storyId,
      packagePrefix: L.packageSha256.slice(0, 12),
      answers: answersOf(L),
    },
    publish: { storyIds: ROLES.publish },
    feature: { storyId: ROLES.feature },
    rollback: { snapshot: String(ROLES.rollback) },
    unpublish: { storyId: ROLES.unpublish },
  }
}
