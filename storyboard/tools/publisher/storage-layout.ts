// The Storage layout the publisher may touch (spec §3.3, §8; design p1-step13-design.md §3.3, D12-3).
// Pure, no I/O. A caller names an object by a typed ref; this module builds the bucket, path,
// content type, cache seconds and body cap from a fixed class table. Two separate re-checks prove a
// target before any request is built: re-check 1 on the target (a safe path, the class's own
// anchored pattern and bucket, the captured fields) and re-check 2 on the request URL (origin,
// pathname, no search, no hash). Every refusal is a fixed triple {cls, stage, rule} that never
// carries a caller value (D12-14). Step 14 (p1-step14-design.md §3.4) adds contentReadTarget, the
// target of a pointer or snapshot read; Step 15a (p1-step15a-design.md §3.17, D15-17) adds the
// content-addressed package read.
import {
  expectedPackagePath,
  expectedSnapshotPath,
  isSafeStoragePath,
  STORAGE_GATE_MODES,
} from '../../src/core/content/gates'
import { MEDIA_EXTENSIONS, MEDIA_MAX_BYTES, type MediaMime } from '../../src/core/content/media'
import { Sha256, StoryId } from '../../src/core/package/v1'

/** The largest pointer, snapshot, package or approval body; equals the loader's MAX_BODY_BYTES. */
export const MAX_JSON_BYTES = 1024 * 1024
/** Cache seconds for a masters object the client writes (D12-8). */
export const MASTERS_CACHE_SECONDS = 0
/** Packages, media and snapshots (SPEC:280). */
const CONTENT_CACHE_SECONDS = 3600
/** The two pointers (SPEC:280). */
const POINTER_CACHE_SECONDS = 0

export type StorageBucket = 'content' | 'masters'
export type RefKind = 'package' | 'media' | 'snapshot' | 'approval' | 'waiver'
export type TargetKind = RefKind | 'pointer'
export type PointerMode = (typeof STORAGE_GATE_MODES)[number]

export interface PackageRef {
  readonly kind: 'package'
  readonly storyId: string
  readonly packageSha256: string
}
export interface MediaRef {
  readonly kind: 'media'
  readonly storyId: string
  readonly sha256: string
  readonly variant: string
  readonly mime: MediaMime
}
export interface SnapshotRef {
  readonly kind: 'snapshot'
  readonly seq: number
}
export interface ApprovalRef {
  readonly kind: 'approval'
  readonly storyId: string
  readonly packageSha256: string
}
export interface WaiverRef {
  readonly kind: 'waiver'
  readonly storyId: string
  readonly waiverSha256: string
}
/** A pointer read names the mode only; the client adds a fresh cache nonce on every read. */
export interface PointerReadRef {
  readonly kind: 'pointer'
  readonly mode: PointerMode
}
/** What create may write. */
export type CreateRef = PackageRef | MediaRef | SnapshotRef | ApprovalRef
/** What readMaster may read. */
export type MasterReadRef = ApprovalRef | WaiverRef
/**
 * A package read names its content address (Step 15a, D15-17); no nonce. The caller compares the
 * found sha256 with the name, as the client checks no hash for content.
 */
export type PackageReadRef = PackageRef
/**
 * What readContent may read: a pointer by mode or a snapshot by seq (Step 14, D13-4), or a package by
 * its content address (Step 15a, D15-17).
 */
export type ContentReadRef = PointerReadRef | SnapshotRef | PackageReadRef

export type TargetFields = Readonly<Record<string, string | number>>

/** One object the client may touch, built only by this module. */
export interface Target {
  readonly kind: TargetKind
  readonly bucket: StorageBucket
  readonly path: string
  readonly contentType: string | null
  readonly cacheSeconds: number | null
  readonly maxBytes: number
  /** The validated ref fields (kind left out), a frozen copy. */
  readonly fields: TargetFields
}

export type Stage = 'field' | 'body-gate' | 'class-pattern' | 'url'
export interface Refusal {
  readonly cls: string
  readonly stage: Stage
  readonly rule: string
}
export type LayoutResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal }
export type RefUse = 'create' | 'read'

type FieldRule = 'story-id' | 'sha256' | 'variant' | 'mime' | 'seq'

interface ClassSpec {
  readonly fields: readonly (readonly [name: string, rule: FieldRule])[]
  readonly create: boolean
  readonly read: boolean
}

const CLASSES: Readonly<Record<RefKind, ClassSpec>> = {
  package: {
    fields: [
      ['storyId', 'story-id'],
      ['packageSha256', 'sha256'],
    ],
    create: true,
    read: false,
  },
  media: {
    fields: [
      ['storyId', 'story-id'],
      ['sha256', 'sha256'],
      ['variant', 'variant'],
      ['mime', 'mime'],
    ],
    create: true,
    read: false,
  },
  snapshot: { fields: [['seq', 'seq']], create: true, read: false },
  approval: {
    fields: [
      ['storyId', 'story-id'],
      ['packageSha256', 'sha256'],
    ],
    create: true,
    read: true,
  },
  waiver: {
    fields: [
      ['storyId', 'story-id'],
      ['waiverSha256', 'sha256'],
    ],
    create: false,
    read: true,
  },
}

/** The variant part of a media name (media.ts:21). */
const VARIANT = /^[a-z0-9]{1,16}$/

const refused = (cls: string, stage: Stage, rule: string): LayoutResult<never> => ({
  ok: false,
  refusal: { cls, stage, rule },
})

function fieldOk(rule: FieldRule, value: unknown): boolean {
  switch (rule) {
    case 'story-id':
      return typeof value === 'string' && StoryId.safeParse(value).success
    case 'sha256':
      return typeof value === 'string' && Sha256.safeParse(value).success
    case 'variant':
      return typeof value === 'string' && VARIANT.test(value)
    case 'mime':
      return typeof value === 'string' && Object.hasOwn(MEDIA_EXTENSIONS, value)
    case 'seq':
      return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 1 &&
        !Object.is(value, -0)
      )
  }
}

interface OwnData {
  readonly values: ReadonlyMap<string, unknown>
  readonly accessor: boolean
  readonly badKeys: boolean
}

/**
 * Reads an object once: Reflect.ownKeys once, then one descriptor per key. Values come only from
 * data descriptors, so a getter or a Proxy get trap is never asked for a value (CRIT-6).
 */
function readOwnData(ref: object): OwnData {
  const values = new Map<string, unknown>()
  let accessor = false
  let badKeys = false
  for (const key of Reflect.ownKeys(ref)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(ref, key)
    if (typeof key !== 'string' || descriptor === undefined || !descriptor.enumerable) {
      badKeys = true
    } else if (!('value' in descriptor)) {
      accessor = true
    } else {
      values.set(key, descriptor.value)
    }
  }
  return { values, accessor, badKeys }
}

function makeTarget(
  kind: TargetKind,
  bucket: StorageBucket,
  path: string,
  contentType: string | null,
  cacheSeconds: number | null,
  maxBytes: number,
  fields: Record<string, string | number>,
): Target {
  return { kind, bucket, path, contentType, cacheSeconds, maxBytes, fields: Object.freeze(fields) }
}

function buildTarget(kind: RefKind, values: ReadonlyMap<string, unknown>): Target {
  const text = (name: string) => values.get(name) as string
  switch (kind) {
    case 'package': {
      const storyId = text('storyId')
      const packageSha256 = text('packageSha256')
      const path = expectedPackagePath({ storyId, packageSha256 }, 'production', '')
      return makeTarget(
        'package',
        'content',
        path,
        'application/json',
        CONTENT_CACHE_SECONDS,
        MAX_JSON_BYTES,
        { storyId, packageSha256 },
      )
    }
    case 'media': {
      const storyId = text('storyId')
      const sha256 = text('sha256')
      const variant = text('variant')
      const mime = text('mime') as MediaMime
      const path = `media/${storyId}/${sha256}-${variant}.${MEDIA_EXTENSIONS[mime]}`
      return makeTarget('media', 'content', path, mime, CONTENT_CACHE_SECONDS, MEDIA_MAX_BYTES, {
        storyId,
        sha256,
        variant,
        mime,
      })
    }
    case 'snapshot': {
      const seq = values.get('seq') as number
      const path = expectedSnapshotPath('', seq)
      return makeTarget(
        'snapshot',
        'content',
        path,
        'application/json',
        CONTENT_CACHE_SECONDS,
        MAX_JSON_BYTES,
        { seq },
      )
    }
    case 'approval': {
      const storyId = text('storyId')
      const packageSha256 = text('packageSha256')
      const path = `approvals/${storyId}/${packageSha256}.json`
      return makeTarget(
        'approval',
        'masters',
        path,
        'application/json',
        MASTERS_CACHE_SECONDS,
        MAX_JSON_BYTES,
        { storyId, packageSha256 },
      )
    }
    case 'waiver': {
      const storyId = text('storyId')
      const waiverSha256 = text('waiverSha256')
      const path = `waivers/${storyId}/${waiverSha256}.json`
      return makeTarget('waiver', 'masters', path, null, null, MAX_JSON_BYTES, {
        storyId,
        waiverSha256,
      })
    }
  }
}

/**
 * The target a ref names, or a refusal at stage `field`. The ref must be a plain object whose own
 * enumerable string data keys are exactly its class's (kind included); `use` limits the kinds to
 * what create or readMaster may take.
 */
export function targetOf(ref: unknown, use?: RefUse): LayoutResult<Target> {
  if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) {
    return refused('ref', 'field', 'ref-not-object')
  }
  const proto: unknown = Object.getPrototypeOf(ref)
  if (proto !== Object.prototype && proto !== null) return refused('ref', 'field', 'ref-prototype')
  const { values, accessor, badKeys } = readOwnData(ref)
  const kindValue = values.get('kind')
  const kind =
    typeof kindValue === 'string' && Object.hasOwn(CLASSES, kindValue)
      ? (kindValue as RefKind)
      : null
  if (accessor) return refused(kind ?? 'ref', 'field', 'ref-accessor')
  if (kind === null) return refused('ref', 'field', 'kind-unknown')
  const spec = CLASSES[kind]
  if (use === 'create' && !spec.create) return refused(kind, 'field', 'kind-not-creatable')
  if (use === 'read' && !spec.read) return refused(kind, 'field', 'kind-not-readable')
  if (
    badKeys ||
    values.size !== spec.fields.length + 1 ||
    spec.fields.some(([name]) => !values.has(name))
  ) {
    return refused(kind, 'field', 'ref-keys')
  }
  for (const [name, rule] of spec.fields) {
    if (!fieldOk(rule, values.get(name))) return refused(kind, 'field', rule)
  }
  return { ok: true, value: buildTarget(kind, values) }
}

/** The pointer target of a mode: exactly production or staging, compared as a primitive string. */
export function pointerTarget(mode: unknown): LayoutResult<Target> {
  if (typeof mode !== 'string' || !(STORAGE_GATE_MODES as readonly string[]).includes(mode)) {
    return refused('pointer', 'field', 'mode')
  }
  const path = `catalogue/${mode}.json`
  return {
    ok: true,
    value: makeTarget(
      'pointer',
      'content',
      path,
      'application/json',
      POINTER_CACHE_SECONDS,
      MAX_JSON_BYTES,
      { mode },
    ),
  }
}

/** The fields each content-readable kind holds besides `kind`. */
const CONTENT_READ_FIELDS: Readonly<Record<'pointer' | 'snapshot' | 'package', readonly string[]>> =
  {
    pointer: ['mode'],
    snapshot: ['seq'],
    package: ['storyId', 'packageSha256'],
  }

/**
 * The target a content read names (Step 14, D13-4), or a refusal at stage `field`: exactly
 * `{kind: 'pointer', mode}`, `{kind: 'snapshot', seq}` or `{kind: 'package', storyId, packageSha256}`
 * (Step 15a, D15-17; no nonce: content-addressed), under targetOf's shape rules. The ref is
 * read once (one ownKeys, one descriptor per key) and the Target is built only from the values
 * captured on that read, never through targetOf or a get on the ref (S14-CRIT-10). The Target equals
 * pointerTarget's or targetOf's, so re-check 1 applies unchanged.
 */
export function contentReadTarget(ref: unknown): LayoutResult<Target> {
  if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) {
    return refused('ref', 'field', 'ref-not-object')
  }
  const proto: unknown = Object.getPrototypeOf(ref)
  if (proto !== Object.prototype && proto !== null) return refused('ref', 'field', 'ref-prototype')
  const { values, accessor, badKeys } = readOwnData(ref)
  const kindValue = values.get('kind')
  const kind: TargetKind | null =
    kindValue === 'pointer'
      ? 'pointer'
      : typeof kindValue === 'string' && Object.hasOwn(CLASSES, kindValue)
        ? (kindValue as RefKind)
        : null
  if (accessor) return refused(kind ?? 'ref', 'field', 'ref-accessor')
  if (kind === null) return refused('ref', 'field', 'kind-unknown')
  if (kind !== 'pointer' && kind !== 'snapshot' && kind !== 'package') {
    return refused(kind, 'field', 'kind-not-content-readable')
  }
  const fields = CONTENT_READ_FIELDS[kind]
  if (badKeys || values.size !== fields.length + 1 || fields.some((name) => !values.has(name))) {
    return refused(kind, 'field', 'ref-keys')
  }
  if (kind === 'pointer') return pointerTarget(values.get('mode'))
  if (kind === 'package') {
    for (const [name, rule] of CLASSES.package.fields) {
      if (!fieldOk(rule, values.get(name))) return refused('package', 'field', rule)
    }
    return { ok: true, value: buildTarget('package', values) }
  }
  if (!fieldOk('seq', values.get('seq'))) return refused('snapshot', 'field', 'seq')
  return { ok: true, value: buildTarget('snapshot', values) }
}

interface ClassPattern {
  readonly bucket: StorageBucket
  readonly pattern: RegExp
  /** The captured fields, or null when a capture does not decode. */
  readonly decode: (match: RegExpExecArray) => Record<string, string | number> | null
}

const MIME_OF_EXTENSION: ReadonlyMap<string, MediaMime> = new Map(
  Object.entries(MEDIA_EXTENSIONS).map(([mime, ext]) => [ext, mime as MediaMime]),
)

/**
 * The six anchored class patterns, each its own literal, never built from the field rules, so one
 * edit cannot loosen a field rule and its pattern together (CRIT-1 b). The storyId segment carries
 * the 3-64 length lookahead; the snapshot seq decodes to a safe integer (INT-5).
 */
const PATTERNS: Readonly<Record<TargetKind, ClassPattern>> = {
  package: {
    bucket: 'content',
    pattern: /^packages\/(?=[a-z0-9-]{3,64}\/)([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-f0-9]{64})\.json$/,
    decode: (m) => ({ storyId: m[1]!, packageSha256: m[2]! }),
  },
  media: {
    bucket: 'content',
    pattern:
      /^media\/(?=[a-z0-9-]{3,64}\/)([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-f0-9]{64})-([a-z0-9]{1,16})\.(webp|jpg|mp3)$/,
    decode: (m) => {
      const mime = MIME_OF_EXTENSION.get(m[4]!)
      return mime === undefined ? null : { storyId: m[1]!, sha256: m[2]!, variant: m[3]!, mime }
    },
  },
  snapshot: {
    bucket: 'content',
    pattern: /^catalogue\/snapshots\/([1-9][0-9]{0,15})\.json$/,
    decode: (m) => {
      const seq = Number(m[1])
      return Number.isSafeInteger(seq) && seq >= 1 ? { seq } : null
    },
  },
  pointer: {
    bucket: 'content',
    pattern: /^catalogue\/(production|staging)\.json$/,
    decode: (m) => ({ mode: m[1]! }),
  },
  approval: {
    bucket: 'masters',
    pattern: /^approvals\/(?=[a-z0-9-]{3,64}\/)([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-f0-9]{64})\.json$/,
    decode: (m) => ({ storyId: m[1]!, packageSha256: m[2]! }),
  },
  waiver: {
    bucket: 'masters',
    pattern: /^waivers\/(?=[a-z0-9-]{3,64}\/)([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-f0-9]{64})\.json$/,
    decode: (m) => ({ storyId: m[1]!, waiverSha256: m[2]! }),
  },
}

function sameFields(decoded: Record<string, string | number>, fields: TargetFields): boolean {
  const names = Object.keys(decoded)
  return (
    names.length === Object.keys(fields).length &&
    names.every((name) => Object.hasOwn(fields, name) && fields[name] === decoded[name])
  )
}

/**
 * Re-check 1, in this order: a safe Storage path (unsafe-path); the class's anchored pattern and
 * bucket (class-pattern); the captures decode and equal the target's fields (class-fields).
 */
export function recheckTarget(target: Target): LayoutResult<Target> {
  const known = Object.hasOwn(PATTERNS, target.kind)
  const cls = known ? target.kind : 'ref'
  if (!isSafeStoragePath(target.path)) return refused(cls, 'class-pattern', 'unsafe-path')
  const spec = known ? PATTERNS[target.kind] : undefined
  const match =
    spec !== undefined && target.bucket === spec.bucket ? spec.pattern.exec(target.path) : null
  if (spec === undefined || match === null) return refused(cls, 'class-pattern', 'class-pattern')
  const decoded = spec.decode(match)
  if (decoded === null || !sameFields(decoded, target.fields)) {
    return refused(cls, 'class-pattern', 'class-fields')
  }
  return { ok: true, value: target }
}

/**
 * Re-check 2: the request URL's origin and pathname equal the expected ones exactly, with no search
 * and no hash. It catches every form the URL parser rewrites; the forms it leaves unchanged
 * (`a//b`, `%2f`, `%252e`) are re-check 1's (PR-1).
 */
export function recheckUrl(
  url: URL,
  expectedOrigin: string,
  expectedPathname: string,
): LayoutResult<URL> {
  if (
    url.origin !== expectedOrigin ||
    url.pathname !== expectedPathname ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return refused('ref', 'url', 'url-mismatch')
  }
  return { ok: true, value: url }
}

/** The class and fields of a path in a bucket, or null when no class matches. */
export function classOfPath(
  bucket: string,
  path: string,
): { readonly kind: TargetKind; readonly fields: TargetFields } | null {
  for (const kind of Object.keys(PATTERNS) as TargetKind[]) {
    const spec = PATTERNS[kind]
    if (spec.bucket !== bucket) continue
    const match = spec.pattern.exec(path)
    const fields = match === null ? null : spec.decode(match)
    if (fields !== null) return { kind, fields: Object.freeze(fields) }
  }
  return null
}
