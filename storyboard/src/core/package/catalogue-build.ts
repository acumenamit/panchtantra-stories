// Builders for catalogue snapshots and pointers (spec §4.4), for the publisher (P1-8).
// Each output is strict-parsed and serialized as JCS bytes, so it passes the build gates byte for byte.
import type { z } from 'zod'
import { isPointerRoot, isSafeStoragePath, type GateMode } from '../content/gates'
import { jcsBytes, sha256Hex } from '../hashing'
import { CataloguePointer, CatalogueSnapshot } from './catalogue'

export interface BuiltDocument<T> {
  readonly value: T
  /** The exact bytes to upload (RFC 8785 JCS). */
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly sha256: string
}

export function snapshotPath(seq: number, root = ''): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new RangeError('seq must be an integer >= 1')
  assertRoot(root)
  return `${root}catalogue/snapshots/${seq}.json`
}

export function pointerPath(mode: GateMode, root = ''): string {
  assertRoot(root)
  return `${root}catalogue/${mode}.json`
}

export async function makeSnapshot(
  input: CatalogueSnapshot,
): Promise<BuiltDocument<CatalogueSnapshot>> {
  return build(strictParse(CatalogueSnapshot, input, 'snapshot'))
}

export async function makePointer(
  input: CataloguePointer,
): Promise<BuiltDocument<CataloguePointer>> {
  const value = strictParse(CataloguePointer, input, 'pointer')
  if (!isSafeStoragePath(value.snapshotPath)) {
    throw new TypeError('invalid pointer: snapshotPath is unsafe')
  }
  return build(value)
}

async function build<T>(value: T): Promise<BuiltDocument<T>> {
  const bytes = jcsBytes(value)
  return { value, bytes, sha256: await sha256Hex(bytes) }
}

function strictParse<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)'
  throw new TypeError(`invalid ${label}: ${where}: ${issue?.message ?? 'unknown issue'}`)
}

function assertRoot(root: string): void {
  if (!isPointerRoot(root)) throw new TypeError(`invalid root: must be '' or end with '/'`)
}
