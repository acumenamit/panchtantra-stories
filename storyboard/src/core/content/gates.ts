// Build gates for catalogue pointers and snapshots (spec §3.2, §4.4). Pure: bytes in, verdicts out.
// scripts/load-content.ts does the fetching; these functions decide and never throw.
// P1-2b (design p1-step8-design.md §3.4 rows 21-22, §4.1 rows 3 and 8, §9 items 7, 9 and 20): the
// exact snapshotPath and packagePath rules, and failure details printed before the failure line.
import type { z } from 'zod'
import { jcsBytes, sha256Hex } from '../hashing'
import { CataloguePointer, CatalogueSnapshot } from '../package/catalogue'
import { hasOwnProtoKey } from '../package/v1'

/** Every mode a build can run in, and so every mode a build-info record can name. */
export const GATE_MODES = ['production', 'staging', 'fixtures'] as const
export type GateMode = (typeof GATE_MODES)[number]

/**
 * The only modes a Storage pointer path can select. Fixtures mode is left out on purpose: it skips
 * the approval gate, so it may only come from CONTENT_SOURCE=fixtures reading the committed files,
 * never from a Storage pointer such as "<root>catalogue/fixtures.json".
 */
export const STORAGE_GATE_MODES = ['production', 'staging'] as const satisfies readonly GateMode[]
export type StorageGateMode = (typeof STORAGE_GATE_MODES)[number]

/**
 * A gate verdict. A failure may carry `details`: complete log lines (for example the unwaived
 * findings of a package) that the loader prints, in order, before `content gate failed: <reason>`.
 */
export type GateResult<T> =
  { ok: true; value: T } | { ok: false; reason: string; details?: readonly string[] }

/** '' is the real layout. Other roots end in '/' (tests use 'spikes/run/'). */
export const DEFAULT_POINTER_ROOTS: readonly string[] = ['']

const MAX_PATH_LENGTH = 512
// Each segment starts with a letter, digit or underscore, so '.', '..' and hidden names never pass.
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/
const MAX_LOG_TEXT = 64

const ok = <T>(value: T): GateResult<T> => ({ ok: true, value })
const fail = <T>(reason: string): GateResult<T> => ({ ok: false, reason })

/**
 * A value from outside (a header, a package field) made safe for a log line or a gate message:
 * printable ASCII without spaces, at most 64 characters, as the loader's header sanitiser does
 * (design §4.5); '-' when nothing is left.
 */
export function safeLogText(value: string): string {
  return value.replace(/[^\x21-\x7e]/g, '').slice(0, MAX_LOG_TEXT) || '-'
}

/**
 * A relative Storage object path made only of plain segments: no leading '/', no '..', no empty
 * segment, and none of '?', '#', '\', '%', spaces or control characters.
 */
export function isSafeStoragePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH || path.includes('..')) return false
  return path.split('/').every((segment) => SAFE_SEGMENT.test(segment))
}

/** A pointer root is '' or a safe path followed by exactly one '/'. */
export function isPointerRoot(root: string): boolean {
  return root === '' || (root.endsWith('/') && isSafeStoragePath(root.slice(0, -1)))
}

export interface PointerLocation {
  readonly mode: GateMode
  readonly root: string
}

/** A location taken from a Storage pointer path: production or staging, never fixtures. */
export interface StoragePointerLocation extends PointerLocation {
  readonly mode: StorageGateMode
}

/** Accepts exactly `<root>catalogue/production.json` or `<root>catalogue/staging.json`. */
export function modeFromPointerPath(
  path: string,
  roots: readonly string[] = DEFAULT_POINTER_ROOTS,
): GateResult<StoragePointerLocation> {
  for (const root of roots) {
    if (!isPointerRoot(root)) return fail('pointer root list contains an invalid root')
    for (const mode of STORAGE_GATE_MODES) {
      if (path === `${root}catalogue/${mode}.json`) return ok({ mode, root })
    }
  }
  return fail(
    'pointer path must be <root>catalogue/production.json or <root>catalogue/staging.json',
  )
}

export function snapshotPrefix(root: string): string {
  return `${root}catalogue/snapshots/`
}

/** The one snapshot path a pointer may name: `<root>catalogue/snapshots/<seq>.json` (spec:272). */
export function expectedSnapshotPath(root: string, seq: number): string {
  return `${snapshotPrefix(root)}${seq}.json`
}

/**
 * Pointer gate: strict parse, canonical JCS bytes, a safe snapshot path under the same root, and
 * exactly `<root>catalogue/snapshots/<pointer.seq>.json`, as the publisher builds it (P1-2b).
 */
export function checkPointer(
  bytes: Uint8Array,
  location: PointerLocation,
): GateResult<CataloguePointer> {
  const parsed = parseCanonical(bytes, CataloguePointer, 'pointer')
  if (!parsed.ok) return parsed
  const { snapshotPath, seq } = parsed.value
  if (!isSafeStoragePath(snapshotPath)) return fail('pointer snapshotPath is unsafe')
  const prefix = snapshotPrefix(location.root)
  if (!snapshotPath.startsWith(prefix) || snapshotPath.length === prefix.length) {
    return fail(`pointer snapshotPath must sit under ${prefix}`)
  }
  const expected = expectedSnapshotPath(location.root, seq)
  if (snapshotPath !== expected) return fail(`pointer snapshotPath must be ${expected}`)
  return parsed
}

type SnapshotEntry = CatalogueSnapshot['stories'][number]

/**
 * The one packagePath a snapshot entry may name (design §3.4 row 21; spec:270). Storage modes:
 * `<root>packages/<storyId>/<packageSha256>.json`. Fixtures mode keeps the committed layout
 * `packages/<storyId>.json`; it has no root.
 */
export function expectedPackagePath(
  entry: Pick<SnapshotEntry, 'storyId' | 'packageSha256'>,
  mode: GateMode,
  root: string,
): string {
  if (mode === 'fixtures') return `packages/${entry.storyId}.json`
  return `${root}packages/${entry.storyId}/${entry.packageSha256}.json`
}

/**
 * packagePath gate (P1-2b), run on every snapshot entry, excluded ones included, before any
 * package is read: each entry must name exactly its expected path. The first entry that does not,
 * in snapshot order, is named.
 */
export function checkPackagePaths(
  stories: readonly SnapshotEntry[],
  mode: GateMode,
  root: string,
): GateResult<null> {
  for (const entry of stories) {
    const expected = expectedPackagePath(entry, mode, root)
    if (entry.packagePath !== expected) {
      return fail(`snapshot entry ${entry.storyId}: packagePath must be ${expected}`)
    }
  }
  return ok(null)
}

export interface CheckedSnapshot {
  readonly snapshot: CatalogueSnapshot
  readonly included: readonly SnapshotEntry[]
  /** Production mode only: entries without approvalSha256 (OD-12). */
  readonly excluded: readonly SnapshotEntry[]
}

/** Snapshot gate: sha256 of the bytes, strict parse, canonical JCS, and the pointer's seq. */
export async function checkSnapshot(
  bytes: Uint8Array<ArrayBuffer>,
  pointer: CataloguePointer,
  mode: GateMode,
): Promise<GateResult<CheckedSnapshot>> {
  if ((await sha256Hex(bytes)) !== pointer.snapshotSha256) return fail('snapshot sha256 mismatch')
  const parsed = parseCanonical(bytes, CatalogueSnapshot, 'snapshot')
  if (!parsed.ok) return parsed
  const snapshot = parsed.value
  if (snapshot.seq !== pointer.seq) {
    return fail(`snapshot seq ${snapshot.seq} does not match pointer seq ${pointer.seq}`)
  }
  return ok(splitByApproval(snapshot, mode))
}

/**
 * Production builds exclude unapproved entries. Staging and fixtures builds skip the approval gate
 * and include every entry. Any other mode falls through to the production rule.
 */
export function splitByApproval(snapshot: CatalogueSnapshot, mode: GateMode): CheckedSnapshot {
  if (mode === 'staging' || mode === 'fixtures') {
    return { snapshot, included: snapshot.stories, excluded: [] }
  }
  return {
    snapshot,
    included: snapshot.stories.filter((s) => s.approvalSha256 !== undefined),
    excluded: snapshot.stories.filter((s) => s.approvalSha256 === undefined),
  }
}

export interface ParsedJson<T> {
  /** The JSON value as parsed, before the schema ran. */
  readonly raw: unknown
  /** The schema's output. */
  readonly data: T
}

/**
 * Strict parse of UTF-8 JSON bytes against a schema. Refuses invalid UTF-8, invalid JSON and own
 * "__proto__" keys. The bytes need not be canonical JCS (packages are checked by sha256 only).
 */
export function parseStrictJson<T>(
  bytes: Uint8Array,
  schema: z.ZodType<T>,
  label: string,
): GateResult<ParsedJson<T>> {
  const decoded = decodeJson(bytes, label)
  if (!decoded.ok) return decoded
  const raw = decoded.value
  // JSON.parse creates own "__proto__" keys, which schema parsing would not report.
  if (hasOwnProtoKey(raw)) return fail(`${label} contains a "__proto__" key`)
  const result = schema.safeParse(raw)
  if (!result.success) return fail(`${label} failed strict parse: ${firstIssue(result.error)}`)
  return ok({ raw, data: result.data })
}

/** UTF-8 JSON bytes to a value, before any schema; refuses invalid UTF-8 and invalid JSON. */
export function decodeJson(bytes: Uint8Array, label: string): GateResult<unknown> {
  try {
    return ok(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch {
    return fail(`${label} is not valid UTF-8 JSON`)
  }
}

/** True when `bytes` are exactly the RFC 8785 (JCS) form of the JSON value they decoded to. */
export function isCanonicalJcs(raw: unknown, bytes: Uint8Array): boolean {
  try {
    return bytesEqual(jcsBytes(raw), bytes)
  } catch {
    return false // a value JCS cannot represent is never canonical
  }
}

function parseCanonical<T>(bytes: Uint8Array, schema: z.ZodType<T>, label: string): GateResult<T> {
  const parsed = parseStrictJson(bytes, schema, label)
  if (!parsed.ok) return parsed
  if (!isCanonicalJcs(parsed.value.raw, bytes)) return fail(`${label} is not canonical JCS`)
  return ok(parsed.value.data)
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'unknown issue'
  const where = issue.path.length > 0 ? issue.path.join('.') : '(root)'
  return `${where}: ${issue.message}`
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
