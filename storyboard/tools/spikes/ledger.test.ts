// P0-13 THROWAWAY: removed at cleanup
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertNoForbidden,
  createRecorder,
  isRunIdUsed,
  lastSnapshotSeq,
  livePaths,
  newRunId,
  parseLedger,
  planSeq,
  reuploadCheck,
  uploadRecords,
  type DeleteRecord,
  type LedgerEntry,
  type UploadAttempt,
  type UploadResultKind,
} from './ledger'
import { cdnProbePath, S1_POINTER, s1SnapshotPath } from './objects'

const AT = '2026-11-07T10:00:00.000Z'
const SHA = 'a'.repeat(64)
const RUN = 'r20261107-101500'

function attempt(path: string, extra: Partial<UploadAttempt> = {}): UploadAttempt {
  return {
    kind: 'upload-attempt',
    at: AT,
    bucket: 'content',
    path,
    bytes: 10,
    sha256: SHA,
    contentType: 'application/json',
    cacheControl: 3600,
    upsert: false,
    purpose: 's1-snapshot',
    seq: null,
    runId: null,
    wrongHash: false,
    ...extra,
  }
}

function outcome(path: string, result: UploadResultKind = 'created'): LedgerEntry {
  return { kind: 'upload-result', at: AT, path, result, status: null, code: null }
}

function removed(path: string): DeleteRecord {
  return { kind: 'delete', at: AT, bucket: 'content', path, result: 'removed', detail: null }
}

/** A created snapshot (plus the duplicate check) and a pointer for one seq. */
function published(seq: number, wrongHash = false): LedgerEntry[] {
  const snapshot = s1SnapshotPath(seq)
  return [
    attempt(snapshot, { seq, sha256: `${seq}`.padStart(64, '0') }),
    outcome(snapshot),
    attempt(snapshot, { seq }),
    outcome(snapshot, 'duplicate'),
    attempt(S1_POINTER, { purpose: 's1-pointer', seq, upsert: true, cacheControl: 0, wrongHash }),
    outcome(S1_POINTER),
  ]
}

describe('parseLedger', () => {
  it('reads every line strictly and skips blank lines', () => {
    const entries = [attempt('spikes/a.json'), outcome('spikes/a.json')]
    const text = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n\n`
    expect(parseLedger(text)).toEqual(entries)
  })

  it('stops at a damaged line, naming its number', () => {
    expect(() => parseLedger(`${JSON.stringify(attempt('spikes/a.json'))}\nnot json`)).toThrow(
      'ledger line 2 is not JSON',
    )
    expect(() => parseLedger(JSON.stringify({ kind: 'upload-attempt' }))).toThrow(
      'ledger line 1 does not match',
    )
    expect(() =>
      parseLedger(JSON.stringify({ ...attempt('spikes/a.json'), bucket: 'masters' })),
    ).toThrow('does not match')
  })
})

describe('upload records and live paths', () => {
  it('pairs each attempt with its result; an attempt without one stays open', () => {
    const records = uploadRecords([
      attempt('spikes/a.json'),
      outcome('spikes/a.json'),
      attempt('spikes/b.json'),
    ])
    expect(records.map((r) => [r.attempt.path, r.outcome?.result ?? null])).toEqual([
      ['spikes/a.json', 'created'],
      ['spikes/b.json', null],
    ])
  })

  it('a path is live from its first attempt (even a failed one) until a removed delete', () => {
    const entries: LedgerEntry[] = [
      attempt('spikes/b.json'),
      outcome('spikes/b.json', 'failed'),
      attempt('spikes/a.json'),
      outcome('spikes/a.json'),
      removed('spikes/a.json'),
      attempt('spikes/c.json'),
      { ...removed('spikes/c.json'), result: 'not-removed' },
    ]
    expect(livePaths(entries)).toEqual(['spikes/b.json', 'spikes/c.json'])
  })
})

describe('planSeq: a seq is never reused', () => {
  it('the first seq is 1, then always the next one', () => {
    expect(planSeq([], 1, false)).toEqual({ kind: 'new', seq: 1 })
    expect(planSeq([], 2, false).kind).toBe('refused')
    expect(planSeq(published(1), 2, false)).toEqual({ kind: 'new', seq: 2 })
    expect(lastSnapshotSeq([...published(1), ...published(2)])).toBe(2)
  })

  it('refuses a used seq, a gap and a non-integer', () => {
    const entries = [...published(1), ...published(2)]
    expect(planSeq(entries, 1, false)).toEqual({
      kind: 'refused',
      reason: 'seq 1 is not allowed: the last seq used is 2, so the next new seq is 3',
    })
    expect(planSeq(entries, 2, false)).toEqual({
      kind: 'refused',
      reason:
        'seq 2 is not allowed: the last seq used is 2, so the next new seq is 3 (a seq can be sent again only to restore a --wrong-hash pointer)',
    })
    expect(planSeq(entries, 5, false).kind).toBe('refused')
    expect(planSeq(entries, 2.5, false).kind).toBe('refused')
    expect(planSeq(entries, 0, false).kind).toBe('refused')
  })

  it('a failed snapshot upload still uses its seq', () => {
    const entries = [attempt(s1SnapshotPath(1), { seq: 1 }), outcome(s1SnapshotPath(1), 'failed')]
    expect(planSeq(entries, 1, false).kind).toBe('refused')
    expect(planSeq(entries, 2, false)).toEqual({ kind: 'new', seq: 2 })
  })

  it('restores the last seq only after a created --wrong-hash pointer', () => {
    const entries = [...published(3), ...published(4, true)]
    expect(planSeq(entries, 4, false)).toEqual({
      kind: 'restore',
      seq: 4,
      snapshotPath: s1SnapshotPath(4),
      snapshotSha256: '4'.padStart(64, '0'),
    })
    expect(planSeq(entries, 4, true).kind).toBe('refused')
    // Once restored, the seq is spent.
    const restored = [
      ...entries,
      attempt(S1_POINTER, { purpose: 's1-pointer', seq: 4, upsert: true }),
      outcome(S1_POINTER),
    ]
    expect(planSeq(restored, 4, false).kind).toBe('refused')
    expect(planSeq(restored, 5, false)).toEqual({ kind: 'new', seq: 5 })
  })
})

describe('run ids', () => {
  it('formats the UTC time and adds a suffix when the id is already on the ledger', () => {
    const now = new Date('2026-11-07T10:15:00.000Z')
    expect(newRunId(now, [])).toBe(RUN)
    const used = [attempt(cdnProbePath(RUN, 'probe.json'), { runId: RUN, purpose: 'cdn-probe' })]
    expect(isRunIdUsed(used, RUN)).toBe(true)
    expect(newRunId(now, used)).toBe(`${RUN}-2`)
  })
})

describe('reuploadCheck', () => {
  const path = cdnProbePath(RUN, 'probe-300.mp3')
  const uploaded = [attempt(path, { purpose: 'cdn-probe', runId: RUN }), outcome(path)]

  it('allows one re-upload of probe-300.mp3 after its delete', () => {
    expect(reuploadCheck([], RUN).ok).toBe(false)
    expect(reuploadCheck(uploaded, RUN)).toEqual({
      ok: false,
      reason: `${path} has not been deleted yet (run cdn delete first)`,
    })
    const deleted = [...uploaded, removed(path)]
    expect(reuploadCheck(deleted, RUN)).toEqual({ ok: true, path })
    const again = [...deleted, attempt(path, { purpose: 'cdn-reupload', runId: RUN })]
    expect(reuploadCheck(again, RUN)).toEqual({
      ok: false,
      reason: `${path} was already re-uploaded once`,
    })
  })
})

describe('recorder', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spike-ledger-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('appends ledger and evidence lines and reads them back', () => {
    const recorder = createRecorder(join(dir, 'p0-13'))
    expect(recorder.readLedger()).toEqual([])
    expect(recorder.readEvidence('watch')).toEqual([])
    recorder.appendLedger(attempt('spikes/a.json'))
    recorder.appendLedger(outcome('spikes/a.json'))
    recorder.appendEvidence('watch', { seq: 1 })
    expect(recorder.readLedger()).toHaveLength(2)
    expect(recorder.readEvidence('watch')).toEqual([{ seq: 1 }])
    expect(readFileSync(join(dir, 'p0-13', 'uploads.ndjson'), 'utf8').split('\n')).toHaveLength(3)
  })

  it('refuses an invalid ledger entry and odd stream names', () => {
    const recorder = createRecorder(dir)
    expect(() => recorder.appendLedger({ ...attempt('spikes/a.json'), sha256: 'x' })).toThrow()
    expect(() => recorder.appendEvidence('uploads', {})).toThrow('invalid evidence stream')
    expect(() => recorder.appendEvidence('../x', {})).toThrow('invalid evidence stream')
    expect(existsSync(join(dir, 'uploads.ndjson'))).toBe(false)
  })

  it('never writes a line that contains a forbidden value', () => {
    const secret = ['sb', 'secret', 'recorder-test-value'].join('_')
    const recorder = createRecorder(dir, [secret])
    expect(() => recorder.appendEvidence('watch', { note: `x${secret}y` })).toThrow(
      'refused to write a line that contains a credential',
    )
    expect(existsSync(join(dir, 'watch.ndjson'))).toBe(false)
    expect(() => assertNoForbidden('fine', [secret, ''])).not.toThrow()
  })

  it('a damaged ledger file stops reading', () => {
    writeFileSync(join(dir, 'uploads.ndjson'), '{"kind":"nope"}\n')
    expect(() => createRecorder(dir).readLedger()).toThrow('ledger line 1')
  })
})
