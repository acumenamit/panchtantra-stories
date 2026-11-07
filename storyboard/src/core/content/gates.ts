// Build gates for catalogue pointers and snapshots (spec §3.2, §4.4). Pure: bytes in, verdicts out.
// scripts/load-content.ts does the fetching; these functions decide and never throw.
import type { z } from 'zod'
import { jcsBytes, sha256Hex } from '../hashing'
import { CataloguePointer, CatalogueSnapshot } from '../package/catalogue'
import { hasOwnProtoKey } from '../package/v1'

export const GATE_MODES = ['production', 'staging'] as const
export type GateMode = (typeof GATE_MODES)[number]

export type GateResult<T> = { ok: true; value: T } | { ok: false; reason: string }

/** '' is the real layout. Other roots end in '/' (tests use 'spikes/run/'). */
export const DEFAULT_POINTER_ROOTS: readonly string[] = ['']

const MAX_PATH_LENGTH = 512
// Each segment starts with a letter, digit or underscore, so '.', '..' and hidden names never pass.
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

const ok = <T>(value: T): GateResult<T> => ({ ok: true, value })
const fail = <T>(reason: string): GateResult<T> => ({ ok: false, reason })

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

/** Accepts exactly `<root>catalogue/production.json` or `<root>catalogue/staging.json`. */
export function modeFromPointerPath(
  path: string,
  roots: readonly string[] = DEFAULT_POINTER_ROOTS,
): GateResult<PointerLocation> {
  for (const root of roots) {
    if (!isPointerRoot(root)) return fail('pointer root list contains an invalid root')
    for (const mode of GATE_MODES) {
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

/** Pointer gate: strict parse, canonical JCS bytes, and a safe snapshot path under the same root. */
export function checkPointer(
  bytes: Uint8Array,
  location: PointerLocation,
): GateResult<CataloguePointer> {
  const parsed = parseCanonical(bytes, CataloguePointer, 'pointer')
  if (!parsed.ok) return parsed
  const { snapshotPath } = parsed.value
  if (!isSafeStoragePath(snapshotPath)) return fail('pointer snapshotPath is unsafe')
  const prefix = snapshotPrefix(location.root)
  if (!snapshotPath.startsWith(prefix) || snapshotPath.length === prefix.length) {
    return fail(`pointer snapshotPath must sit under ${prefix}`)
  }
  return parsed
}

type SnapshotEntry = CatalogueSnapshot['stories'][number]

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

/** Production builds exclude unapproved entries; staging builds include every entry. */
export function splitByApproval(snapshot: CatalogueSnapshot, mode: GateMode): CheckedSnapshot {
  if (mode === 'staging') return { snapshot, included: snapshot.stories, excluded: [] }
  return {
    snapshot,
    included: snapshot.stories.filter((s) => s.approvalSha256 !== undefined),
    excluded: snapshot.stories.filter((s) => s.approvalSha256 === undefined),
  }
}

function parseCanonical<T>(bytes: Uint8Array, schema: z.ZodType<T>, label: string): GateResult<T> {
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return fail(`${label} is not valid UTF-8 JSON`)
  }
  // JSON.parse creates own "__proto__" keys, which schema parsing would not report.
  if (hasOwnProtoKey(raw)) return fail(`${label} contains a "__proto__" key`)
  const result = schema.safeParse(raw)
  if (!result.success) return fail(`${label} failed strict parse: ${firstIssue(result.error)}`)
  if (!bytesEqual(jcsBytes(raw), bytes)) return fail(`${label} is not canonical JCS`)
  return ok(result.data)
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
