// Root metadata shared by the root layouts (spec §10.3 noindex; design p1-step7-design.md §3.12
// #17, #20, §4.1; P1-1c). The only file that sets robots: noindex, nofollow on every 200 page in
// every build, never tied to the launch flag. Pages never set robots (metadata merges shallowly),
// and the 404 sets none (Next adds noindex there itself).
import type { Metadata } from 'next'
import { APP_NAME } from '../../core/app-info'

export const ROOT_ROBOTS = { index: false, follow: false } as const satisfies Metadata['robots']

/** Today's "/" metadata, unchanged (it was app/layout.tsx's until Step 7). */
export const ROOT_METADATA = {
  title: APP_NAME,
  description: 'Interactive stories for children (work in progress).',
  robots: ROOT_ROBOTS,
} as const satisfies Metadata

/** Sub-page titles: "For grown-ups – Storyboard" (U+2013 en dash). */
export const TITLE_TEMPLATE = `%s – ${APP_NAME}`

/**
 * The [locale] root layout's metadata (design §7 item 11): title "Storyboard" with the sub-page
 * template, the localized description and ROOT_ROBOTS. No alternates and no metadataBase. Built
 * here so robots is still set in this file only.
 */
export function readerRootMetadata(description: string): Metadata {
  return {
    title: { default: APP_NAME, template: TITLE_TEMPLATE },
    description,
    robots: ROOT_ROBOTS,
  }
}
