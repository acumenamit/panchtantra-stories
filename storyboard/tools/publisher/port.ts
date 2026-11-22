// The publisher's structural port (design p1-step14-design.md §2.1, D14-11, D14-15, D14-21, TP-12).
// The library modules (stage and the catalogue state) take the Storage client through these types,
// so only the CLI imports the client itself (fence F1, one row). The result types are structural
// copies of the client's own: the CLI holds `const port: StagePort = client`, so a result kind the
// client adds and this port lacks is a compile error there.
// - StageWriter.create takes package, media and snapshot refs only: an approval create in stage
//   code is a compile error (D14-21).
// - Step 15a (p1-step15a-design.md §3.18, D15-18): ApproveWriter.create takes an approval ref only,
//   with no pointer write; PublishWriter.create takes a snapshot ref only and its writePointer the
//   production mode only. The CLI holds `const port: ApprovePort = client` and `PublishPort`, so a
//   wrong create or a staging write in approve or publish code is a compile error.
// - readOnlyPort gives a plan phase the three read methods and nothing else, so a write call in the
//   plan path is a TypeError (D23-2, TP-12).
// - isStorageRefusal recognises the client's refusal by its own name and its fixed text, never by
//   instanceof, so no library module needs a value import of the client (D14-15).
// - Step 15b (p1-step15b-design.md §2.3, D15B-6, D15B-14, D15B-21) adds types only: UnpublishWriter
//   and UnpublishPort (snapshot N+1 and either pointer, for the unpublish factory alone),
//   RemoveResult and ContentRemover (the deleter as takedown holds it), and the public-read answers
//   (RangeTarget, RangeAnswer, ObjectAnswer, LandingAnswer, LiveBuild, VerifySite), so no library
//   module imports verify.ts or the deleter (F4, F6).
// Types come from ./storage-layout only; this module never imports the client, not even as types.
import type {
  ApprovalRef,
  ContentReadRef,
  CreateRef,
  MasterReadRef,
  MediaRef,
  PackageRef,
  PointerMode,
  SnapshotRef,
} from './storage-layout'

/** Storage answered with an authentication or permission error, or the request failed. */
export type StorageFailure =
  | { readonly kind: 'unauthorized'; readonly status: number }
  | { readonly kind: 'failed'; readonly status: number | null; readonly code: string }

export type StoredVerdict = 'identical' | 'different' | 'unchecked'

export type CreateResult =
  | { readonly kind: 'created' }
  | { readonly kind: 'duplicate'; readonly stored: StoredVerdict }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'mime-refused' }
  | StorageFailure

export type PointerResult =
  | { readonly kind: 'written' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'mime-refused' }
  | StorageFailure

/** `not-found` means absent, or not visible to this key. */
export type ReadResult =
  | {
      readonly kind: 'found'
      readonly bytes: Uint8Array<ArrayBuffer>
      readonly size: number
      readonly sha256: string
    }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'too-large'; readonly limit: number }
  | { readonly kind: 'hash-mismatch'; readonly sha256: string }
  | StorageFailure

/** A pointer or snapshot read: a read result without the hash check. */
export type ContentReadResult = Exclude<ReadResult, { readonly kind: 'hash-mismatch' }>

export interface StoredObject {
  readonly path: string
  readonly size: number | null
  readonly mimetype: string | null
  readonly cacheControl: string | null
  readonly updatedAt: string | null
}

export type ListResult =
  { readonly kind: 'listed'; readonly objects: readonly StoredObject[] } | StorageFailure

/** The three reads. Every plan phase, dry or not, takes this and nothing more. */
export interface StorageReader {
  readonly listContent: (folder: string) => Promise<ListResult>
  readonly readContent: (ref: ContentReadRef) => Promise<ContentReadResult>
  readonly readMaster: (ref: MasterReadRef) => Promise<ReadResult>
}

/** The two writes, approvals included (Step 15 approve). */
export interface StorageWriter {
  readonly create: (ref: CreateRef, body: Uint8Array) => Promise<CreateResult>
  readonly writePointer: (mode: PointerMode, body: Uint8Array) => Promise<PointerResult>
}

/** The writes stage may make: packages, media and snapshots, and the pointer (D14-21). */
export interface StageWriter {
  readonly create: (
    ref: PackageRef | MediaRef | SnapshotRef,
    body: Uint8Array,
  ) => Promise<CreateResult>
  readonly writePointer: (mode: PointerMode, body: Uint8Array) => Promise<PointerResult>
}

/** What stage's commit phase holds. */
export type StagePort = StorageReader & StageWriter

/** The one write approve may make: its approval record in masters (D15-18). */
export interface ApproveWriter {
  readonly create: (ref: ApprovalRef, body: Uint8Array) => Promise<CreateResult>
}

/** What approve's commit phase holds. */
export type ApprovePort = StorageReader & ApproveWriter

/** The writes publish may make: snapshot N and the production pointer (D15-18). */
export interface PublishWriter {
  readonly create: (ref: SnapshotRef, body: Uint8Array) => Promise<CreateResult>
  readonly writePointer: (mode: 'production', body: Uint8Array) => Promise<PointerResult>
}

/** What publish's commit phase holds (rollback included). */
export type PublishPort = StorageReader & PublishWriter

// ---- Step 15b (p1-step15b-design.md §2.3, D15B-6, D15B-14, D15B-21): types only ----

/**
 * The writes an unpublish may make: snapshot N+1 and either pointer (D15B-6). Only the unpublish
 * factory holds it (`const port: UnpublishPort = client`); PublishPort stays production-only.
 */
export interface UnpublishWriter {
  readonly create: (ref: SnapshotRef, body: Uint8Array) => Promise<CreateResult>
  readonly writePointer: (mode: PointerMode, body: Uint8Array) => Promise<PointerResult>
}

/** What an unpublish's commit phase holds. */
export type UnpublishPort = StorageReader & UnpublishWriter

/**
 * A structural copy of content-deleter.ts's remove result, so a result kind the deleter adds is a
 * compile error at the CLI's `const remover: ContentRemover = deleter` (D15B-14).
 */
export type RemoveResult =
  | { readonly kind: 'removed'; readonly paths: readonly string[] }
  | {
      readonly kind: 'count-mismatch'
      readonly removed: readonly string[]
      readonly notRemoved: readonly string[]
      readonly unexpected: readonly string[]
    }
  | StorageFailure

/** What takedown holds of the deleter: one remove of content paths (D15B-14). */
export interface ContentRemover {
  readonly remove: (bucket: 'content', paths: readonly string[]) => Promise<RemoveResult>
}

/** The one MP3 a Range check reads (D15B-16): its content path, its size and its name's sha256. */
export interface RangeTarget {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

/** Why a Range check failed (D15B-16): the full GET's reasons, then the range GET's. */
export type RangeReason =
  | 'full-status'
  | 'full-length'
  | 'full-type'
  | 'full-encoding'
  | 'full-hash'
  | 'too-large'
  | 'status'
  | 'content-range'
  | 'length'
  | 'bytes'
  | 'type'
  | 'encoding'
  | 'redirect'
  | 'network'

export type RangeAnswer =
  | {
      readonly kind: 'ok'
      readonly start: number
      readonly end: number
      readonly size: number
    }
  | { readonly kind: 'failed'; readonly reason: RangeReason; readonly status: number | null }

/** Why a public object read failed (D15B-21). */
export type ObjectReason =
  'status' | 'length' | 'type' | 'encoding' | 'hash' | 'redirect' | 'network' | 'too-large'

export type ObjectAnswer =
  | { readonly kind: 'ok' }
  | { readonly kind: 'failed'; readonly reason: ObjectReason; readonly status: number | null }

/** Why a landing page check failed (D15B-21). */
export type LandingReason = 'status' | 'type' | 'redirect' | 'network' | 'too-large'

export type LandingAnswer =
  | { readonly kind: 'ok' }
  | { readonly kind: 'failed'; readonly reason: LandingReason; readonly status: number | null }

/** A structural copy of verify.ts's LiveBuildDetail: what the confirmed live build loaded. */
export interface LiveBuild {
  readonly snapshotSha256: string
  readonly featuredStoryId: string | null
  readonly stories: readonly {
    readonly storyId: string
    readonly version: number
    readonly packageSha256: string
  }[]
  readonly excluded: readonly {
    readonly storyId: string
    readonly version: number
    readonly reason: 'approval-missing'
  }[]
}

/**
 * The public reads the verify command takes (D15B-21): the CLI binds the site URL and the public
 * content base, so a library module never builds a URL.
 */
export interface VerifySite {
  readonly landing: (storyId: string, locale: string) => Promise<LandingAnswer>
  readonly object: (head: {
    readonly path: string
    readonly bytes: number
    readonly mime: string
  }) => Promise<ObjectAnswer>
  readonly range: (target: RangeTarget) => Promise<RangeAnswer>
}

/** A new plain object of exactly the three read methods, each bound to `port` (TP-12). */
export function readOnlyPort(port: StorageReader): StorageReader {
  return {
    listContent: port.listContent.bind(port),
    readContent: port.readContent.bind(port),
    readMaster: port.readMaster.bind(port),
  }
}

/** The client's refusal text: `refused: <class> <stage> <rule>`, which carries no value. */
const REFUSAL_TEXT = /^refused: [a-z]+ (field|body-gate|class-pattern|url) [a-z0-9-]+$/

/** An own data property's value, or undefined; a getter is never run. */
function ownValue(value: object, key: string): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
}

/**
 * True for the client's refusal: an Error whose own name is exactly StorageRefusedError and whose
 * own message is the fixed refusal text (D14-15). Anything else (a TypeError with that text, an Error
 * named so with other text, a plain object) is false and is printed as `internal`.
 */
export function isStorageRefusal(e: unknown): e is Error {
  if (!(e instanceof Error)) return false
  const message = ownValue(e, 'message')
  return (
    ownValue(e, 'name') === 'StorageRefusedError' &&
    typeof message === 'string' &&
    REFUSAL_TEXT.test(message)
  )
}
