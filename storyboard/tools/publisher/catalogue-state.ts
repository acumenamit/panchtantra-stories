// The publisher's catalogue state, seq allocation, staging composition, documents, the snapshot
// create with read-back and the pointer move (design migration-input/p1-step14-design.md §3.1 to
// §3.6, D13-1 to D13-6, D14-8, D14-13, D14-14, D14-16, D14-19, D14-24, D14-27, TP-2, TP-9, TP-13;
// P1-8c, Step 14). Exported for Step 15 (publish, rollback, unpublish), which composes and moves the
// production pointer with the same functions.
// - Reads go through a StorageReader and writes through a writer port (./port: StageWriter, and
//   from Step 15a ApproveWriter and PublishWriter), never the client module itself, so the reach
//   walk keeps one F1 row (the CLI).
// - The state is read from the listing of catalogue/ and both pointers (each with a fresh nonce,
//   added by the client): a pointer is absent only when the listing and the read agree; every
//   pointer and snapshot passes the build's own gates.
// - N is 1 + the highest listed seq (orphans included); the create-only snapshot write arbitrates
//   and is always read back.
// - movePointer: a pre-check (no snapshot above N, both pointers as expected) at most 10 s before
//   one write that is never retried, a fresh read-back, then a post-check (re-list, re-read the
//   other pointer). Detection, not prevention (L6).
// Step 15a (migration-input/p1-step15a-design.md §3.9, §3.10, §3.13; D15-9, D15-10, D15-12, D15-13)
// adds the production side: composeProduction (production ⊕ the named stories, each with its
// approvalSha256), composeRollback (snapshot N+1 copying an older one), buildProductionDocuments
// (the staging builder in production mode plus two gates), and sameEntry exported. createWithRetry,
// createSnapshot and movePointer take type-only generic signatures, so approve's and publish's
// narrower ports fit; their behaviour is unchanged.
// Results are codes only: no URL, path, body or message leaves this module.
import {
  checkPackagePaths,
  checkPointer,
  checkSnapshot,
  expectedSnapshotPath,
  splitByApproval,
} from '../../src/core/content/gates'
import { checkUniqueStoryIds, type SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes } from '../../src/core/hashing'
import type { CataloguePointer, CatalogueSnapshot } from '../../src/core/package/catalogue'
import {
  makePointer,
  makeSnapshot,
  type BuiltDocument,
} from '../../src/core/package/catalogue-build'
import type {
  ContentReadResult,
  CreateResult,
  ListResult,
  PointerResult,
  StorageReader,
} from './port'
import { classOfPath, type CreateRef, type PointerMode, type SnapshotRef } from './storage-layout'

/** The longest a pointer pre-check may run before the write (D13-3). */
export const POINTER_WINDOW_MS = 10_000
/** The wait before the one retry of a create (D14-8). */
export const RETRY_DELAY_MS = 1000
const CATALOGUE_FOLDER = 'catalogue/'
const MODES: readonly PointerMode[] = ['production', 'staging']

// ---- the catalogue state (D13-1, A13, A14) ----

export type StateCode =
  | 'storage-unauthorized'
  | 'storage-failed'
  | 'catalogue-unknown-object'
  | 'pointer-state-inconsistent'
  | 'pointer-gate'
  | 'snapshot-missing'
  | 'snapshot-gate'

export interface PointerState {
  readonly mode: PointerMode
  /** The pointer's bytes as read, and their sha256 (the `expected` value of a later move). */
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly sha256: string
  readonly pointer: CataloguePointer
  readonly snapshot: CatalogueSnapshot
  readonly snapshotSha256: string
}

export interface CatalogueState {
  /** Every listed snapshot seq, ascending (orphans included). */
  readonly seqs: readonly number[]
  readonly production: PointerState | null
  readonly staging: PointerState | null
  /** Listed seqs above the higher pointer seq; every listed seq when no pointer exists (D13-2). */
  readonly orphans: readonly number[]
  /** Seqs missing between 1 and the highest listed. */
  readonly gaps: number
}

export type StateResult =
  | { readonly ok: true; readonly state: CatalogueState }
  | { readonly ok: false; readonly code: StateCode }

/** A failed listing or read (`too-large` counts as failed, never as absent: D14-24). */
const failureCode = (kind: string): 'storage-unauthorized' | 'storage-failed' =>
  kind === 'unauthorized' ? 'storage-unauthorized' : 'storage-failed'

interface Listed {
  readonly seqs: number[]
  readonly pointers: Set<string>
  readonly unknown: boolean
}

/** The catalogue listing decoded with the client's class table. */
function decodeListing(listing: Extract<ListResult, { kind: 'listed' }>): Listed {
  const seqs: number[] = []
  const pointers = new Set<string>()
  let unknown = false
  for (const object of listing.objects) {
    const found = classOfPath('content', object.path)
    if (found?.kind === 'snapshot' && typeof found.fields.seq === 'number') {
      seqs.push(found.fields.seq)
    } else if (found?.kind === 'pointer' && typeof found.fields.mode === 'string') {
      pointers.add(found.fields.mode)
    } else {
      unknown = true
    }
  }
  seqs.sort((a, b) => a - b)
  return { seqs, pointers, unknown }
}

type Fail = { readonly ok: false; readonly code: StateCode }
const fail = (code: StateCode): Fail => ({ ok: false, code })

/** One pointer and its snapshot, by §4.3 step 5; null when absent. */
async function readPointer(
  reader: StorageReader,
  mode: PointerMode,
  listed: Listed,
): Promise<{ readonly ok: true; readonly value: PointerState | null } | Fail> {
  const read = await reader.readContent({ kind: 'pointer', mode })
  const isListed = listed.pointers.has(mode)
  if (read.kind === 'not-found') {
    return isListed ? fail('pointer-state-inconsistent') : { ok: true, value: null }
  }
  if (read.kind !== 'found') return fail(failureCode(read.kind))
  if (!isListed) return fail('pointer-state-inconsistent')
  const checked = checkPointer(read.bytes, { mode, root: '' })
  if (!checked.ok) return fail('pointer-gate')
  const pointer = checked.value
  if (!listed.seqs.includes(pointer.seq)) return fail('snapshot-missing')
  const snap = await reader.readContent({ kind: 'snapshot', seq: pointer.seq })
  if (snap.kind === 'not-found') return fail('pointer-state-inconsistent')
  if (snap.kind !== 'found') return fail(failureCode(snap.kind))
  const gated = await checkSnapshot(snap.bytes, pointer, mode)
  if (!gated.ok) return fail('snapshot-gate')
  const snapshot = gated.value.snapshot
  // Hostile remote state never reaches the plan gate (TP-2).
  if (!checkPackagePaths(snapshot.stories, mode, '').ok) return fail('snapshot-gate')
  if (!checkUniqueStoryIds(snapshot.stories).ok) return fail('snapshot-gate')
  return {
    ok: true,
    value: {
      mode,
      bytes: read.bytes,
      sha256: read.sha256,
      pointer,
      snapshot,
      snapshotSha256: snap.sha256,
    },
  }
}

/** The orphans and the gap count of a listing (D13-2). */
function orphansAndGaps(
  seqs: readonly number[],
  pointerSeqs: readonly number[],
): { orphans: number[]; gaps: number } {
  const top = pointerSeqs.length === 0 ? 0 : Math.max(...pointerSeqs)
  const orphans = seqs.filter((seq) => seq > top)
  const highest = seqs.length === 0 ? 0 : (seqs[seqs.length - 1] ?? 0)
  return { orphans, gaps: highest - new Set(seqs).size }
}

/**
 * The catalogue state (§4.3 steps 4 and 5): one listing of catalogue/, then each pointer with a
 * fresh nonce and, when present, its snapshot; every combination but "listed and found" and "not
 * listed and not found" is pointer-state-inconsistent. An unknown object under catalogue/ stops
 * before any read.
 */
export async function readCatalogueState(reader: StorageReader): Promise<StateResult> {
  const listing = await reader.listContent(CATALOGUE_FOLDER)
  if (listing.kind !== 'listed') return fail(failureCode(listing.kind))
  const listed = decodeListing(listing)
  if (listed.unknown) return fail('catalogue-unknown-object')
  const states: (PointerState | null)[] = []
  for (const mode of MODES) {
    const read = await readPointer(reader, mode, listed)
    if (!read.ok) return read
    states.push(read.value)
  }
  const [production = null, staging = null] = states
  const pointerSeqs = [production, staging].flatMap((p) => (p === null ? [] : [p.pointer.seq]))
  const { orphans, gaps } = orphansAndGaps(listed.seqs, pointerSeqs)
  return { ok: true, state: { seqs: listed.seqs, production, staging, orphans, gaps } }
}

/** N = 1 + the highest listed seq, or 1 (D13-1); past MAX_SAFE_INTEGER is seq-exhausted. */
export function allocateSeq(
  state: CatalogueState,
):
  | { readonly ok: true; readonly seq: number }
  | { readonly ok: false; readonly code: 'seq-exhausted' } {
  const seq = Math.max(0, ...state.seqs) + 1
  return Number.isSafeInteger(seq) ? { ok: true, seq } : { ok: false, code: 'seq-exhausted' }
}

// ---- composition (D13-5, D13-6, D14-13, D14-14, D14-27; A15) ----

export interface ComposeInput {
  /** The current production snapshot, or null without a production pointer. */
  readonly production: CatalogueSnapshot | null
  readonly staging: CatalogueSnapshot | null
  /** The named stories' new entries (from the local checks), in the order given. */
  readonly named: readonly SnapshotEntry[]
}

export type NamedState = 'new' | 'in-production' | 'unchanged'
export type CarriedState = 'candidate' | 'superseded'
export type Source = 'production' | 'candidate' | 'new'

export interface StoryOutcome<S extends string> {
  readonly storyId: string
  readonly packageSha256: string
  readonly version: number
  readonly state: S
}

export interface Composition {
  readonly featuredStoryId: string | null
  readonly stories: readonly SnapshotEntry[]
  /** `publisher stage: ` and the named ids, sorted, one space apart. */
  readonly note: string
  /** The composed {featuredStoryId, stories} equal the current staging snapshot's (D13-6). */
  readonly unchanged: boolean
  readonly named: readonly StoryOutcome<NamedState>[]
  /** Staging entries carried as candidates (not named) and those dropped as superseded. */
  readonly carried: readonly StoryOutcome<CarriedState>[]
  readonly sources: readonly {
    readonly storyId: string
    readonly packageSha256: string
    readonly source: Source
  }[]
}

export type ComposeResult =
  | { readonly ok: true; readonly composition: Composition }
  | {
      readonly ok: false
      readonly code: 'version-not-increased' | 'waivers-changed-same-package'
      readonly storyId: string
    }

/** The entry's matching fields: the whole entry minus approvalSha256 (D14-13). */
function matchBytes(entry: SnapshotEntry): string {
  const { storyId, collectionId, version, packagePath, packageSha256, waivers } = entry
  const fields = { storyId, collectionId, version, packagePath, packageSha256 }
  return new TextDecoder().decode(jcsBytes(waivers === undefined ? fields : { ...fields, waivers }))
}

/** The D14-13 match: the two entries are equal apart from approvalSha256 (Step 15a exports it). */
export const sameEntry = (a: SnapshotEntry, b: SnapshotEntry): boolean =>
  matchBytes(a) === matchBytes(b)

/** A new staging entry: exactly these fields, never approvalSha256 (D13-6). */
function newEntry(entry: SnapshotEntry): SnapshotEntry {
  const { storyId, collectionId, version, packagePath, packageSha256, waivers } = entry
  return {
    storyId,
    collectionId,
    version,
    packagePath,
    packageSha256,
    ...(waivers === undefined ? {} : { waivers }),
  }
}

const outcome = <S extends string>(entry: SnapshotEntry, state: S): StoryOutcome<S> => ({
  storyId: entry.storyId,
  packageSha256: entry.packageSha256,
  version: entry.version,
  state,
})

/**
 * production ⊕ candidates ⊕ named (§3.5): production's snapshot.stories in order; each staging
 * entry that is not already production's is a candidate, unless it carries approvalSha256 or is
 * not above production's version (superseded, dropped); each named entry is in-production,
 * unchanged, refused (same package with another block; not above production's version) or new.
 * Candidates and new entries replace their story in place or are appended in UTF-16 code-unit order.
 */
export function composeStaging(input: ComposeInput): ComposeResult {
  const base = input.production?.stories ?? []
  const production = new Map(base.map((entry) => [entry.storyId, entry]))
  const chosen = new Map<string, { entry: SnapshotEntry; source: Source }>()
  const carried: StoryOutcome<CarriedState>[] = []
  for (const staged of input.staging?.stories ?? []) {
    const current = production.get(staged.storyId)
    if (current !== undefined && sameEntry(staged, current)) continue
    if (
      staged.approvalSha256 !== undefined ||
      (current !== undefined && current.version >= staged.version)
    ) {
      carried.push(outcome(staged, 'superseded'))
      continue
    }
    chosen.set(staged.storyId, { entry: staged, source: 'candidate' })
  }

  const named: StoryOutcome<NamedState>[] = []
  for (const entry of input.named) {
    const current = production.get(entry.storyId)
    const candidate = chosen.get(entry.storyId)?.entry
    if (current !== undefined && sameEntry(entry, current)) {
      chosen.delete(entry.storyId)
      named.push(outcome(entry, 'in-production'))
      continue
    }
    const samePackage = (other: SnapshotEntry | undefined) =>
      other !== undefined && other.packageSha256 === entry.packageSha256 && !sameEntry(entry, other)
    if (samePackage(current) || samePackage(candidate)) {
      return { ok: false, code: 'waivers-changed-same-package', storyId: entry.storyId }
    }
    if (current !== undefined && entry.version <= current.version) {
      return { ok: false, code: 'version-not-increased', storyId: entry.storyId }
    }
    if (candidate !== undefined && sameEntry(entry, candidate)) {
      named.push(outcome(entry, 'unchanged'))
      continue
    }
    chosen.set(entry.storyId, { entry: newEntry(entry), source: 'new' })
    named.push(outcome(entry, 'new'))
  }

  const composed: { entry: SnapshotEntry; source: Source }[] = base.map(
    (entry) => chosen.get(entry.storyId) ?? { entry, source: 'production' as Source },
  )
  const appended = [...chosen.keys()].filter((id) => !production.has(id)).sort()
  for (const id of appended) composed.push(chosen.get(id)!)
  const namedIds = new Set(input.named.map((entry) => entry.storyId))
  for (const { entry, source } of composed) {
    if (source === 'candidate' && !namedIds.has(entry.storyId)) {
      carried.push(outcome(entry, 'candidate'))
    }
  }
  const stories = composed.map((c) => c.entry)
  const featuredStoryId = input.production?.featuredStoryId ?? null
  const view = (featured: string | null, list: readonly SnapshotEntry[]) =>
    new TextDecoder().decode(jcsBytes({ featuredStoryId: featured, stories: list }))
  const unchanged =
    input.staging !== null &&
    view(featuredStoryId, stories) === view(input.staging.featuredStoryId, input.staging.stories)
  return {
    ok: true,
    composition: {
      featuredStoryId,
      stories,
      note: `publisher stage: ${[...namedIds].sort().join(' ')}`,
      unchanged,
      named,
      carried,
      sources: composed.map(({ entry, source }) => ({
        storyId: entry.storyId,
        packageSha256: entry.packageSha256,
        source,
      })),
    },
  }
}

// ---- production composition (Step 15a: D15-9, D15-12, D15-13; A9, A15) ----

/** A named story's state in N+1: appended, replacing production's entry in place, or unchanged. */
export type PublishState = 'new' | 'replaced' | 'in-production'
/** Where an N+1 entry came from: kept from production, published now, or copied by a rollback. */
export type ProductionSource = 'production' | 'published' | 'rollback'

export interface NamedProductionEntry {
  /** The story's staged entry. */
  readonly entry: SnapshotEntry
  /**
   * The sha256 readMaster returned for the story's approval record, or null when no record was read
   * (a story already in production). A new or replacing entry without one is written without
   * approvalSha256, which buildProductionDocuments refuses (plan-gate).
   */
  readonly approvalSha256: string | null
}

export interface ProductionComposeInput {
  /** The current production snapshot, or null without a production pointer. */
  readonly production: CatalogueSnapshot | null
  /** The named stories, in the order given. */
  readonly named: readonly NamedProductionEntry[]
  /** `--feature`: undefined when the flag was not given, null for `none`, else the story id. */
  readonly feature: string | null | undefined
}

export interface PublishOutcome extends StoryOutcome<PublishState> {
  readonly approvalSha256: string | null
}

export interface ProductionComposition {
  readonly featuredStoryId: string | null
  readonly stories: readonly SnapshotEntry[]
  readonly note: string
  /** A production snapshot exists and the composed {featuredStoryId, stories} equal its JCS. */
  readonly unchanged: boolean
  readonly named: readonly PublishOutcome[]
  readonly sources: readonly {
    readonly storyId: string
    readonly packageSha256: string
    readonly approvalSha256: string | null
    readonly source: ProductionSource
  }[]
}

export type ProductionComposeResult =
  | { readonly ok: true; readonly composition: ProductionComposition }
  | {
      readonly ok: false
      readonly code:
        'production-entry-unapproved' | 'version-not-increased' | 'waivers-changed-same-package'
      readonly storyId: string
    }

/** The JCS text of a snapshot's {featuredStoryId, stories}: the content an unchanged plan compares. */
const contentView = (featuredStoryId: string | null, stories: readonly SnapshotEntry[]): string =>
  new TextDecoder().decode(jcsBytes({ featuredStoryId, stories }))

/** ` feature=<id|none>` when the flag was given, else ''. */
const featureSuffix = (feature: string | null | undefined): string =>
  feature === undefined ? '' : ` feature=${feature ?? 'none'}`

/**
 * production ⊕ named (D15-9): production's snapshot.stories in order, every one approved
 * (production-entry-unapproved); each named entry is in-production (sameEntry with production's, which
 * is kept byte for byte), refused (same package with another block; not above production's version,
 * the defensive check: publish refuses those as staged-entry-superseded first), or a new entry
 * `{...newEntry(E), approvalSha256: A}` replacing production's in place or appended in UTF-16
 * code-unit order. Staged candidates are never read: only the named entries are published. featured
 * is the flag's (none → null) or production's; note `publisher publish:` + the named ids sorted +
 * ` feature=<id|none>` with the flag.
 */
export function composeProduction(input: ProductionComposeInput): ProductionComposeResult {
  const base = input.production?.stories ?? []
  for (const entry of base) {
    if (entry.approvalSha256 === undefined) {
      return { ok: false, code: 'production-entry-unapproved', storyId: entry.storyId }
    }
  }
  const production = new Map(base.map((entry) => [entry.storyId, entry]))
  const published = new Map<string, SnapshotEntry>()
  const named: PublishOutcome[] = []
  for (const { entry, approvalSha256 } of input.named) {
    const current = production.get(entry.storyId)
    if (current !== undefined && sameEntry(entry, current)) {
      named.push({
        ...outcome(current, 'in-production'),
        approvalSha256: current.approvalSha256 ?? null,
      })
      continue
    }
    if (current !== undefined && current.packageSha256 === entry.packageSha256) {
      return { ok: false, code: 'waivers-changed-same-package', storyId: entry.storyId }
    }
    if (current !== undefined && current.version >= entry.version) {
      return { ok: false, code: 'version-not-increased', storyId: entry.storyId }
    }
    const made: SnapshotEntry =
      approvalSha256 === null ? newEntry(entry) : { ...newEntry(entry), approvalSha256 }
    published.set(entry.storyId, made)
    named.push({
      ...outcome(made, current === undefined ? 'new' : 'replaced'),
      approvalSha256: made.approvalSha256 ?? null,
    })
  }
  const stories = base.map((entry) => published.get(entry.storyId) ?? entry)
  const appended = [...published.keys()].filter((id) => !production.has(id)).sort()
  for (const id of appended) stories.push(published.get(id)!)
  const featuredStoryId =
    input.feature === undefined ? (input.production?.featuredStoryId ?? null) : input.feature
  const namedIds = [...new Set(input.named.map(({ entry }) => entry.storyId))].sort()
  const unchanged =
    input.production !== null &&
    contentView(featuredStoryId, stories) ===
      contentView(input.production.featuredStoryId, input.production.stories)
  return {
    ok: true,
    composition: {
      featuredStoryId,
      stories,
      note: `publisher publish:${namedIds.map((id) => ` ${id}`).join('')}${featureSuffix(input.feature)}`,
      unchanged,
      named,
      sources: stories.map((entry) => ({
        storyId: entry.storyId,
        packageSha256: entry.packageSha256,
        approvalSha256: entry.approvalSha256 ?? null,
        source: published.has(entry.storyId) ? 'published' : 'production',
      })),
    },
  }
}

export interface RollbackComposeInput {
  /** The current production snapshot, or null without a production pointer. */
  readonly production: CatalogueSnapshot | null
  /** The snapshot `--snapshot <seq>` names, already read and checked by the caller. */
  readonly from: CatalogueSnapshot
  /** `--feature`: undefined when the flag was not given, null for `none`, else the story id. */
  readonly feature: string | null | undefined
}

/**
 * Snapshot N+1 of a rollback (D15-13): `from`'s stories copied byte for byte and in order, its
 * featured id or the flag's, note `publisher rollback: <seq>` (+ ` feature=<id|none>` with the flag);
 * unchanged exactly as composeProduction's, by content and never by seq (CRIT-6).
 */
export function composeRollback(input: RollbackComposeInput): ProductionComposition {
  const stories = [...input.from.stories]
  const featuredStoryId = input.feature === undefined ? input.from.featuredStoryId : input.feature
  const unchanged =
    input.production !== null &&
    contentView(featuredStoryId, stories) ===
      contentView(input.production.featuredStoryId, input.production.stories)
  return {
    featuredStoryId,
    stories,
    note: `publisher rollback: ${input.from.seq}${featureSuffix(input.feature)}`,
    unchanged,
    named: [],
    sources: stories.map((entry) => ({
      storyId: entry.storyId,
      packageSha256: entry.packageSha256,
      approvalSha256: entry.approvalSha256 ?? null,
      source: 'rollback',
    })),
  }
}

// ---- documents (TP-13, §4.3 step 9) ----

export interface StagingDocuments {
  readonly seq: number
  readonly snapshot: BuiltDocument<CatalogueSnapshot>
  readonly pointer: BuiltDocument<CataloguePointer>
}

export type DocumentsResult =
  | { readonly ok: true; readonly documents: StagingDocuments }
  | { readonly ok: false; readonly code: 'plan-gate' }

/** The production snapshot N+1 and its pointer: the same shape as staging's (Step 15a). */
export type ProductionDocuments = StagingDocuments

type DocumentsInput = Pick<Composition, 'featuredStoryId' | 'stories' | 'note'>

/**
 * Snapshot N (makeSnapshot) and its pointer (makePointer), then the build's own checks in `mode`:
 * checkPackagePaths, checkUniqueStoryIds, checkPointer, checkSnapshot. Any failure (a design fault)
 * is plan-gate, before any write.
 */
async function buildDocuments(
  composition: DocumentsInput,
  seq: number,
  now: Date,
  mode: PointerMode,
): Promise<DocumentsResult> {
  const gate: DocumentsResult = { ok: false, code: 'plan-gate' }
  try {
    const at = now.toISOString()
    const snapshot = await makeSnapshot({
      schemaVersion: '1.0',
      seq,
      createdAt: at,
      note: composition.note,
      featuredStoryId: composition.featuredStoryId,
      stories: [...composition.stories],
    })
    const pointer = await makePointer({
      schemaVersion: '1.0',
      seq,
      snapshotPath: expectedSnapshotPath('', seq),
      snapshotSha256: snapshot.sha256,
      updatedAt: at,
    })
    const stories = snapshot.value.stories
    if (!checkPackagePaths(stories, mode, '').ok) return gate
    if (!checkUniqueStoryIds(stories).ok) return gate
    if (!checkPointer(pointer.bytes, { mode, root: '' }).ok) return gate
    if (!(await checkSnapshot(snapshot.bytes, pointer.value, mode)).ok) return gate
    return { ok: true, documents: { seq, snapshot, pointer } }
  } catch {
    return gate
  }
}

/** The staging snapshot N and its pointer, through the shared builder in staging mode. */
export async function buildStagingDocuments(
  composition: DocumentsInput,
  seq: number,
  now: Date,
): Promise<DocumentsResult> {
  return buildDocuments(composition, seq, now, 'staging')
}

/**
 * The production snapshot N+1 and its pointer (D15-9): the shared builder in production mode, then
 * every entry approved (splitByApproval excludes none) and featuredStoryId null or one of the entries.
 * Any failure is plan-gate.
 */
export async function buildProductionDocuments(
  composition: DocumentsInput,
  seq: number,
  now: Date,
): Promise<DocumentsResult> {
  const built = await buildDocuments(composition, seq, now, 'production')
  if (!built.ok) return built
  const snapshot = built.documents.snapshot.value
  if (splitByApproval(snapshot, 'production').excluded.length > 0) {
    return { ok: false, code: 'plan-gate' }
  }
  const featured = snapshot.featuredStoryId
  if (featured !== null && !snapshot.stories.some((entry) => entry.storyId === featured)) {
    return { ok: false, code: 'plan-gate' }
  }
  return built
}

// ---- creates with one retry (D14-8) ----

export interface CommitOptions {
  readonly sleep: (ms: number) => Promise<void>
  /** True once the commit deadline has passed; checked before each request (D14-8, A17). */
  readonly deadlinePassed?: () => boolean
}

export type CreateCode =
  'upload-failed' | 'storage-unauthorized' | 'too-large' | 'mime-refused' | 'deadline'

export type CreateOutcome =
  | { readonly ok: true; readonly result: 'created' | 'duplicate' }
  | { readonly ok: false; readonly code: CreateCode }

const retryable = (result: CreateResult): boolean =>
  result.kind === 'failed' && (result.status === null || result.status >= 500)

/**
 * One create, retried once after RETRY_DELAY_MS when it failed with no status (network, timeout)
 * or a 5xx; a 4xx failure, unauthorized, too-large and mime-refused stop at once. Generic over the
 * ref (Step 15a, D15-10, type-only): stage passes its content refs, approve its approval ref.
 */
export async function createWithRetry<R extends CreateRef>(
  writer: { readonly create: (ref: R, body: Uint8Array) => Promise<CreateResult> },
  ref: R,
  body: Uint8Array,
  options: CommitOptions,
): Promise<CreateOutcome> {
  for (let attempt = 0; ; attempt++) {
    if (options.deadlinePassed?.() === true) return { ok: false, code: 'deadline' }
    const result = await writer.create(ref, body)
    if (result.kind === 'created' || result.kind === 'duplicate') {
      return { ok: true, result: result.kind }
    }
    if (result.kind === 'unauthorized') return { ok: false, code: 'storage-unauthorized' }
    if (result.kind === 'too-large' || result.kind === 'mime-refused') {
      return { ok: false, code: result.kind }
    }
    if (attempt >= 1 || !retryable(result)) return { ok: false, code: 'upload-failed' }
    await options.sleep(RETRY_DELAY_MS)
  }
}

export type SnapshotOutcome =
  | { readonly ok: true; readonly result: 'created' | 'identical' }
  | { readonly ok: false; readonly code: CreateCode | 'snapshot-unconfirmed' | 'seq-taken' }

/**
 * The create-only write of snapshot N, then always one read-back (D14-16): our sha256 after
 * `created` is created, after `duplicate` identical (an earlier attempt of ours landed); a
 * duplicate holding other bytes is seq-taken; any other read is snapshot-unconfirmed.
 */
export async function createSnapshot(
  port: { readonly create: (ref: SnapshotRef, body: Uint8Array) => Promise<CreateResult> } & Pick<
    StorageReader,
    'readContent'
  >,
  seq: number,
  built: { readonly bytes: Uint8Array; readonly sha256: string },
  options: CommitOptions,
): Promise<SnapshotOutcome> {
  const created = await createWithRetry(port, { kind: 'snapshot', seq }, built.bytes, options)
  if (!created.ok) return created
  if (options.deadlinePassed?.() === true) return { ok: false, code: 'deadline' }
  const back = await port.readContent({ kind: 'snapshot', seq })
  if (back.kind === 'found' && back.sha256 === built.sha256) {
    return { ok: true, result: created.result === 'created' ? 'created' : 'identical' }
  }
  if (created.result === 'duplicate' && back.kind === 'found') {
    return { ok: false, code: 'seq-taken' }
  }
  return { ok: false, code: 'snapshot-unconfirmed' }
}

// ---- the pointer move (D13-3, D14-19; A20) ----

/** For each mode, the sha256 of the pointer bytes the caller last read, or null when absent. */
export interface ExpectedPointers {
  readonly production: string | null
  readonly staging: string | null
}

export type MoveCode =
  | 'storage-unauthorized'
  | 'storage-failed'
  | 'concurrent-writer'
  | 'deadline'
  | 'pointer-not-moved'
  | 'pointer-superseded'
  | 'pointer-unconfirmed'
  | 'pointer-raced'

/** `afterWrite` is true once a pointer write was sent and not refused as unauthorized (exit 4). */
export type MoveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: MoveCode; readonly afterWrite: boolean }

/** The reads a pointer move makes (the pre-check, the read-back, the post-check). */
type MoveReader = Pick<StorageReader, 'listContent' | 'readContent'>

/** A port that can write the pointer of mode M (Step 15a, D15-10: publish writes production only). */
type MovePort<M extends PointerMode> = MoveReader & {
  readonly writePointer: (mode: M, body: Uint8Array) => Promise<PointerResult>
}

/** True when a read shows exactly the expected bytes: our sha256, or not-found where null. */
const showsExpected = (read: ContentReadResult, expected: string | null): boolean =>
  expected === null ? read.kind === 'not-found' : read.kind === 'found' && read.sha256 === expected

/** The highest snapshot seq a listing shows, or null when the listing failed. */
async function highestListed(port: MoveReader): Promise<number | 'unauthorized' | 'failed'> {
  const listing = await port.listContent(CATALOGUE_FOLDER)
  if (listing.kind !== 'listed') return listing.kind === 'unauthorized' ? 'unauthorized' : 'failed'
  return Math.max(0, ...decodeListing(listing).seqs)
}

const otherMode = (mode: PointerMode): PointerMode =>
  mode === 'production' ? 'staging' : 'production'

/**
 * The pre-check (§3.3): null when it passed, else the stop code; the commit deadline is checked
 * before the listing and before each pointer read (D14-8, A17).
 */
async function preCheck(
  port: MoveReader,
  seq: number,
  expected: ExpectedPointers,
  deadlinePassed: () => boolean,
): Promise<MoveCode | null> {
  if (deadlinePassed()) return 'deadline'
  const highest = await highestListed(port)
  if (typeof highest !== 'number') return failureCode(highest)
  if (highest !== seq) return 'concurrent-writer'
  for (const mode of MODES) {
    if (deadlinePassed()) return 'deadline'
    const read = await port.readContent({ kind: 'pointer', mode })
    if (read.kind !== 'found' && read.kind !== 'not-found') return failureCode(read.kind)
    if (!showsExpected(read, expected[mode])) return 'concurrent-writer'
  }
  return null
}

/**
 * Moves the `mode` pointer to `built` (seq N): the pre-check from t0, repeated once when more than
 * POINTER_WINDOW_MS passed before the write (then concurrent-writer); one write, never retried;
 * every answer but written and unauthorized is read back (D14-19); the read-back decides, except that
 * a write with no answer at all is never pointer-not-moved (SEC1-2); after our bytes, the post-check
 * re-lists catalogue/ and re-reads the other pointer (pointer-raced). `deadlinePassed` is checked
 * before every pre-check request and before the write, never after the write (D14-8).
 */
export async function movePointer<M extends PointerMode>(
  port: MovePort<M>,
  mode: M,
  built: { readonly seq: number; readonly bytes: Uint8Array; readonly sha256: string },
  expected: ExpectedPointers,
  clock: () => Date,
  options: Pick<CommitOptions, 'deadlinePassed'> = {},
): Promise<MoveResult> {
  const before = (code: MoveCode): MoveResult => ({ ok: false, code, afterWrite: false })
  const after = (code: MoveCode): MoveResult => ({ ok: false, code, afterWrite: true })
  const deadlinePassed = () => options.deadlinePassed?.() === true
  let passes = 0
  for (;;) {
    const t0 = clock().getTime()
    const stop = await preCheck(port, built.seq, expected, deadlinePassed)
    if (stop !== null) return before(stop)
    passes += 1
    if (clock().getTime() - t0 <= POINTER_WINDOW_MS) break
    if (passes >= 2) return before('concurrent-writer')
  }
  if (deadlinePassed()) return before('deadline')
  const written = await port.writePointer(mode, built.bytes)
  if (written.kind === 'unauthorized') return before('storage-unauthorized')
  // No answer at all (a timeout or a dropped connection): the write may still land after the
  // read-back, so the old bytes there cannot prove it did not move (SEC1-2, L6).
  const noAnswer = written.kind === 'failed' && written.status === null

  const back = await port.readContent({ kind: 'pointer', mode })
  if (back.kind !== 'found' || back.sha256 !== built.sha256) {
    if (back.kind === 'found') {
      const read = checkPointer(back.bytes, { mode, root: '' })
      if (read.ok && read.value.seq > built.seq) return after('pointer-superseded')
    }
    return showsExpected(back, expected[mode]) && !noAnswer
      ? after('pointer-not-moved')
      : after('pointer-unconfirmed')
  }

  const highest = await highestListed(port)
  if (typeof highest !== 'number') return after('pointer-unconfirmed')
  if (highest > built.seq) return after('pointer-raced')
  const other = otherMode(mode)
  const otherRead = await port.readContent({ kind: 'pointer', mode: other })
  if (otherRead.kind !== 'found' && otherRead.kind !== 'not-found') {
    return after('pointer-unconfirmed')
  }
  if (!showsExpected(otherRead, expected[other])) return after('pointer-raced')
  return { ok: true }
}
