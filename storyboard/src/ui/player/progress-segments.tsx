'use client'
// The progress segments (Step 10b; design p1-step10-design.md §4.1 header row 2, D11-P12; spec §6.1
// player, §6.6 1.4.1 and 1.4.11). One role="progressbar" named "Story progress", its numbers from
// segmentsOf (src/reader/player/segments.ts): aria-valuenow is the filled count, aria-valuemax the
// step count, aria-valuetext the server's finished "{filled} of {total}". The segment spans are
// aria-hidden; the first `reached` are filled, so there is never a gap.
// - Not colour alone: an empty segment is an outline with no fill, a filled one is filled, and both
//   keep the same box (the same border width), so the fill never moves anything.
// - Run-dependent: hidden with the run area while a saved run opens (D11-P5, §4.4).
import styles from './player.module.css'

export interface ProgressSegmentsProps {
  readonly total: number
  readonly reached: number
  /** The progress bar's name (player.progress). */
  readonly label: string
  /** "{reached} of {total}", finished on the server. */
  readonly valueText: string
}

export function ProgressSegments({ total, reached, label, valueText }: ProgressSegmentsProps) {
  return (
    <div
      role="progressbar"
      data-segments=""
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={reached}
      aria-valuetext={valueText}
      className={`${styles.segments} ${styles.runDependent}`}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          // Segments are positions, never reordered.
          key={index}
          aria-hidden="true"
          data-filled={index < reached ? '' : undefined}
          className={styles.segment}
        />
      ))}
    </div>
  )
}
