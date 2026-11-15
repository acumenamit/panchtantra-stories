// When the storage-blocked banner shows (spec §6.3, §6.6; design p1-step7-design.md §3.11 B1,
// §3.12 #14, §7 item 31; P1-1c). Pure. The banner shows while either record (prefs or progress)
// uses memory, for any reason, newer-schema included; resets alone never show it.
import type { RecordStatus } from '../../reader/progress'

export function bannerVisible(statuses: readonly RecordStatus[]): boolean {
  return statuses.some((status) => status.mode === 'memory')
}
