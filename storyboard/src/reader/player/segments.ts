// Progress segments (Step 10b; design p1-step10-design.md D11-P12; spec §6.1 player "progress
// segments", REQ:104; V1:4058 count-based fill). Pure and framework-free.
// - total: the story's progressSteps (one segment each).
// - reached: how many of those steps the current path holds, or total once the run has ended, so
//   every segment is filled at any ending, alternate endings included. The fill is a count, never
//   "which step": segments 0 to reached - 1 are filled, so there is never a gap. It can go down
//   on Back, and it pauses while the path is off the primary path.
// The island renders one role="progressbar" with these numbers (aria-valuenow = reached,
// aria-valuemax = total). Imports are relative (C15): Vitest has no `@/` alias.
import type { EngineState } from '../../core/engine'
import type { PlayerData } from './player-data'

export interface SegmentsView {
  /** The number of segments: the story's progressSteps. */
  readonly total: number
  /** The filled segments, 0 to total: segments 0 to reached - 1 are filled. */
  readonly reached: number
}

export function segmentsOf(
  data: Pick<PlayerData, 'progressSteps'>,
  state: Pick<EngineState, 'path' | 'status'>,
): SegmentsView {
  const total = data.progressSteps.length
  if (state.status === 'ended') return { total, reached: total }
  const onPath = new Set(state.path)
  const reached = data.progressSteps.filter((step) => onPath.has(step)).length
  return { total, reached }
}
