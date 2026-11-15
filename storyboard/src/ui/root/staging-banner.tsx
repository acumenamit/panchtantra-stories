// The staging banner (spec §3.2 staging row; design p1-step9-design.md §3.2 B1, §3.6 rows 2-8,
// §4.2-§4.4, §9 item 2; P1-2c). A Server Component: each of the three root files renders it once,
// as the first child of the body, with the mode it read from contentMode().
// - Renders nothing unless the mode is staging (showStagingBanner), so Production, fixtures and
//   builds without content are unchanged.
// - One English line (lang="en", also on /hi), in normal flow above the skip link and the header,
//   outside main; no landmark, live region, link or focus stop.
// - Never imported by a client component, so neither the text nor the marker reaches client JS
//   (check-build [staging-banner]).
import type { GateMode } from '../../core/content/gates'
import { showStagingBanner, STAGING_BANNER_TEXT } from './staging'
import styles from './staging-banner.module.css'

export function StagingBanner({ mode }: { readonly mode: GateMode | null }) {
  if (!showStagingBanner(mode)) return null
  return (
    <p data-staging-banner="" lang="en" className={styles.banner}>
      {STAGING_BANNER_TEXT}
    </p>
  )
}
