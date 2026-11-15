// The storage-blocked banner rule (design p1-step7-design.md §3.12 #14, §7 item 31, §8.1 item 9;
// P1-1c): every mode × reason × resets combination, for one record and for both records.
import { describe, expect, it } from 'vitest'
import type { MemoryReason, RecordStatus, StorageMode } from '../../reader/progress'
import { bannerVisible } from './banner-state'

const MODES: readonly StorageMode[] = ['unknown', 'device', 'memory']
const REASONS: readonly (MemoryReason | null)[] = [
  null,
  'unavailable',
  'read-failed',
  'write-failed',
  'remove-failed',
  'newer-schema',
]
const RESETS: readonly number[] = [0, 1, 7]

const STATUSES: readonly RecordStatus[] = MODES.flatMap((mode) =>
  REASONS.flatMap((reason) => RESETS.map((resets) => ({ mode, reason, resets }))),
)

describe('bannerVisible', () => {
  it('covers every combination (3 modes × 6 reasons × 3 reset counts)', () => {
    expect(STATUSES).toHaveLength(54)
  })

  it('one record: visible exactly when it uses memory, whatever the reason or resets', () => {
    for (const status of STATUSES) {
      expect(bannerVisible([status]), JSON.stringify(status)).toBe(status.mode === 'memory')
    }
  })

  it('both records: visible when either uses memory', () => {
    for (const prefs of STATUSES) {
      for (const progress of STATUSES) {
        expect(bannerVisible([prefs, progress]), JSON.stringify([prefs, progress])).toBe(
          prefs.mode === 'memory' || progress.mode === 'memory',
        )
      }
    }
  })

  it('resets alone never show it', () => {
    expect(bannerVisible([{ mode: 'device', reason: null, resets: 3 }])).toBe(false)
    expect(bannerVisible([{ mode: 'unknown', reason: null, resets: 1 }])).toBe(false)
  })

  it('a newer schema shows it (rollback protection keeps the record in memory)', () => {
    expect(bannerVisible([{ mode: 'memory', reason: 'newer-schema', resets: 0 }])).toBe(true)
  })

  it('no statuses: hidden', () => {
    expect(bannerVisible([])).toBe(false)
  })
})
