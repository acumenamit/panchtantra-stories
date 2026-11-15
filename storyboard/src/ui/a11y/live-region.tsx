// The page's one polite live region (spec §6.6 4.1.3; design p1-step7-design.md §3.12 #13, §7
// item 30; P1-1c). Server-rendered and empty at load: the role must exist before the first message
// (WCAG ARIA22). One per (site) page, at the end of main; announce() in ./announce fills it.
// Next's own route announcer is framework-owned and not counted.
import { LIVE_REGION_ID } from './announce'
import styles from './a11y.module.css'

export function LiveRegion() {
  return (
    <div
      id={LIVE_REGION_ID}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={styles.visuallyHidden}
    />
  )
}
