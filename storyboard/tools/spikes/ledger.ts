// P0-13 THROWAWAY: removed at cleanup
// The upload ledger and the evidence files of the P0-13 spikes (plan §1), all NDJSON in
// migration-input/spikes/p0-13/ (gitignored).
// - Every upload writes an attempt line before the request and a result line after it, so a path is
//   on the ledger even when the process dies mid-request. Deletes take exact ledger paths only.
// - A snapshot seq is used once its first upload attempt is on the ledger, whatever the result; it is
//   never used again. The one exception is restoring a seq whose pointer was sent with a wrong hash.
// - Every line is checked against the forbidden strings (the secret key, the deploy hook URL) before
//   it is written, so a credential can never reach a file here.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { Sha256 } from '../../src/core/package/v1'
import { cdnProbePath, s1SnapshotPath, type UploadPurpose } from './objects'

export const LEDGER_FILE_NAME = 'uploads.ndjson'

const UPLOAD_PURPOSES = [
  's1-snapshot',
  's1-pointer',
  'freshness-pointer',
  'cdn-probe',
  'cdn-reupload',
  'audio-clip',
  'audio-probe',
] as const satisfies readonly UploadPurpose[]

export const UPLOAD_RESULTS = [
  'created',
  'duplicate',
  'too-large',
  'mime-refused',
  'unauthorized',
  'failed',
] as const
export type UploadResultKind = (typeof UPLOAD_RESULTS)[number]

const Timestamp = z.iso.datetime()
const ObjectPath = z.string().min(1).max(512)

export const UploadAttempt = z.strictObject({
  kind: z.literal('upload-attempt'),
  at: Timestamp,
  bucket: z.literal('content'),
  path: ObjectPath,
  bytes: z.number().int().nonnegative(),
  sha256: Sha256,
  contentType: z.string().min(1),
  cacheControl: z.number().int().nonnegative(),
  upsert: z.boolean(),
  purpose: z.enum(UPLOAD_PURPOSES),
  seq: z.number().int().min(1).nullable(),
  runId: z.string().min(1).nullable(),
  wrongHash: z.boolean(),
})

export const UploadOutcome = z.strictObject({
  kind: z.literal('upload-result'),
  at: Timestamp,
  path: ObjectPath,
  result: z.enum(UPLOAD_RESULTS),
  status: z.number().int().nullable(),
  code: z.string().nullable(),
})

export const DeleteRecord = z.strictObject({
  kind: z.literal('delete'),
  at: Timestamp,
  bucket: z.literal('content'),
  path: ObjectPath,
  result: z.enum(['removed', 'not-removed', 'failed']),
  detail: z.string().nullable(),
})

export const LedgerEntry = z.discriminatedUnion('kind', [
  UploadAttempt,
  UploadOutcome,
  DeleteRecord,
])

export type UploadAttempt = z.infer<typeof UploadAttempt>
export type UploadOutcome = z.infer<typeof UploadOutcome>
export type DeleteRecord = z.infer<typeof DeleteRecord>
export type LedgerEntry = z.infer<typeof LedgerEntry>

/** One upload attempt and the result line that followed it (null when the process stopped first). */
export interface UploadRecord {
  readonly attempt: UploadAttempt
  readonly outcome: UploadOutcome | null
}

// ---- reading ----

/** Strict: a line that does not parse stops everything, so a damaged ledger is never half-trusted. */
export function parseLedger(text: string): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (line === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      throw new Error(`ledger line ${index + 1} is not JSON`)
    }
    const parsed = LedgerEntry.safeParse(raw)
    if (!parsed.success)
      throw new Error(`ledger line ${index + 1} does not match the ledger schema`)
    entries.push(parsed.data)
  }
  return entries
}

/** Pairs each attempt with the next result line for the same path. */
export function uploadRecords(entries: readonly LedgerEntry[]): UploadRecord[] {
  const records: { attempt: UploadAttempt; outcome: UploadOutcome | null }[] = []
  for (const entry of entries) {
    if (entry.kind === 'upload-attempt') records.push({ attempt: entry, outcome: null })
    if (entry.kind === 'upload-result') {
      const open = records.findLast((r) => r.outcome === null && r.attempt.path === entry.path)
      if (open) open.outcome = entry
    }
  }
  return records
}

/** Paths that may exist in Storage because of us: attempted and not removed since. Sorted. */
export function livePaths(entries: readonly LedgerEntry[]): string[] {
  const live = new Set<string>()
  for (const entry of entries) {
    if (entry.kind === 'upload-attempt') live.add(entry.path)
    if (entry.kind === 'delete' && entry.result === 'removed') live.delete(entry.path)
  }
  return [...live].sort()
}

export function lastDelete(entries: readonly LedgerEntry[], path: string): DeleteRecord | null {
  return entries.findLast((e): e is DeleteRecord => e.kind === 'delete' && e.path === path) ?? null
}

/** The highest snapshot seq ever attempted, or 0. */
export function lastSnapshotSeq(entries: readonly LedgerEntry[]): number {
  let last = 0
  for (const entry of entries) {
    if (entry.kind === 'upload-attempt' && entry.purpose === 's1-snapshot' && entry.seq !== null) {
      last = Math.max(last, entry.seq)
    }
  }
  return last
}

export type SeqPlan =
  | { readonly kind: 'new'; readonly seq: number }
  | {
      readonly kind: 'restore'
      readonly seq: number
      readonly snapshotPath: string
      readonly snapshotSha256: string
    }
  | { readonly kind: 'refused'; readonly reason: string }

/**
 * `s1 publish --seq N`: N must be the next unused seq. Restoring the last seq is allowed only when
 * its snapshot was created and its newest pointer was a created --wrong-hash pointer.
 */
export function planSeq(
  entries: readonly LedgerEntry[],
  requested: number,
  wrongHash: boolean,
): SeqPlan {
  if (!Number.isSafeInteger(requested) || requested < 1) {
    return { kind: 'refused', reason: 'seq must be an integer >= 1' }
  }
  const last = lastSnapshotSeq(entries)
  if (requested === last + 1) return { kind: 'new', seq: requested }
  const refused = (extra = ''): SeqPlan => ({
    kind: 'refused',
    reason: `seq ${requested} is not allowed: the last seq used is ${last}, so the next new seq is ${last + 1}${extra}`,
  })
  if (requested !== last || wrongHash) return refused()

  const records = uploadRecords(entries)
  const path = s1SnapshotPath(last)
  const snapshot = records.find(
    (r) => r.attempt.purpose === 's1-snapshot' && r.attempt.path === path,
  )
  const pointer = records.findLast(
    (r) => r.attempt.purpose === 's1-pointer' && r.attempt.seq === last,
  )
  const restorable =
    snapshot?.outcome?.result === 'created' &&
    pointer?.attempt.wrongHash === true &&
    pointer.outcome?.result === 'created'
  if (!restorable || !snapshot) {
    return refused(' (a seq can be sent again only to restore a --wrong-hash pointer)')
  }
  return {
    kind: 'restore',
    seq: last,
    snapshotPath: path,
    snapshotSha256: snapshot.attempt.sha256,
  }
}

/** True when any ledger path or run id already contains this run id. */
export function isRunIdUsed(entries: readonly LedgerEntry[], runId: string): boolean {
  return entries.some(
    (e) => (e.kind === 'upload-attempt' && e.runId === runId) || e.path.split('/').includes(runId),
  )
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** r<yyyymmdd>-<hhmmss> in UTC, with a -2, -3 ... suffix if that id is already on the ledger. */
export function newRunId(now: Date, entries: readonly LedgerEntry[]): string {
  const base =
    `r${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  if (!isRunIdUsed(entries, base)) return base
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}-${suffix}`
    if (!isRunIdUsed(entries, candidate)) return candidate
  }
  throw new Error('no free run id for this second')
}

/** The plan allows exactly one re-upload of probe-300.mp3 per run, after its measured delete. */
export function reuploadCheck(
  entries: readonly LedgerEntry[],
  runId: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  const path = cdnProbePath(runId, 'probe-300.mp3')
  const uploaded = entries.some(
    (e) => e.kind === 'upload-attempt' && e.path === path && e.purpose === 'cdn-probe',
  )
  if (!uploaded) return { ok: false, reason: `${path} was never uploaded` }
  if (lastDelete(entries, path)?.result !== 'removed') {
    return { ok: false, reason: `${path} has not been deleted yet (run cdn delete first)` }
  }
  const reuploaded = entries.some(
    (e) => e.kind === 'upload-attempt' && e.path === path && e.purpose === 'cdn-reupload',
  )
  if (reuploaded) return { ok: false, reason: `${path} was already re-uploaded once` }
  return { ok: true, path }
}

// ---- writing ----

export interface Recorder {
  readonly dir: string
  readLedger(): LedgerEntry[]
  appendLedger(entry: LedgerEntry): void
  /** One evidence line in <dir>/<stream>.ndjson. */
  appendEvidence(stream: string, record: Readonly<Record<string, unknown>>): void
  /** Every parsed line of an evidence stream; [] when the file does not exist. */
  readEvidence(stream: string): unknown[]
}

const STREAM_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/

/** Throws when the text contains any forbidden string. The message never repeats the string. */
export function assertNoForbidden(text: string, forbidden: readonly string[]): void {
  if (forbidden.some((value) => value !== '' && text.includes(value))) {
    throw new Error('refused to write a line that contains a credential')
  }
}

export function createRecorder(dir: string, forbidden: readonly string[] = []): Recorder {
  const ledgerFile = join(dir, LEDGER_FILE_NAME)
  const append = (file: string, value: unknown) => {
    const line = JSON.stringify(value)
    assertNoForbidden(line, forbidden)
    mkdirSync(dir, { recursive: true })
    appendFileSync(file, `${line}\n`)
  }
  const streamFile = (stream: string) => {
    if (!STREAM_NAME.test(stream) || stream === 'uploads') {
      throw new TypeError(`invalid evidence stream name ${JSON.stringify(stream)}`)
    }
    return join(dir, `${stream}.ndjson`)
  }
  return {
    dir,
    readLedger: () => (existsSync(ledgerFile) ? parseLedger(readFileSync(ledgerFile, 'utf8')) : []),
    appendLedger: (entry) => append(ledgerFile, LedgerEntry.parse(entry)),
    appendEvidence: (stream, record) => append(streamFile(stream), record),
    readEvidence: (stream) => {
      const file = streamFile(stream)
      if (!existsSync(file)) return []
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line): unknown => JSON.parse(line))
    },
  }
}
