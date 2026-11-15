// The staging banner's text, marker and rule (spec §3.2 staging row; design p1-step9-design.md §2,
// §3.2 B1, §3.6 rows 1-4, §4.2, §9 item 1; P1-2c). Pure, no React: the component, check-build,
// live-check and the e2e import these values, so no check ever retypes them. The banner shows only
// when the build's content mode (what the loader wrote to .content/build-info.json) is staging.
import type { GateMode } from '../../core/content/gates'

/** The banner's one English line, exactly spec §3.2: U+2013 EN DASH, 20 UTF-16 units. */
export const STAGING_BANNER_TEXT = 'UNAPPROVED – staging'

/** The data attribute that marks the banner element. */
export const STAGING_BANNER_ATTRIBUTE = 'data-staging-banner'

/**
 * The attribute as it appears in server HTML. The flight copy of the same attribute is
 * JSON-escaped and never matches, so a page's count of this string is its count of banners.
 */
export const STAGING_BANNER_MARKER = 'data-staging-banner=""'

/** True only for a staging build; production, fixtures and no content (null) show no banner. */
export function showStagingBanner(mode: GateMode | null): boolean {
  return mode === 'staging'
}
