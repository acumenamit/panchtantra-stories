// The 404 document for every unmatched URL (spec §6.1 not found, §6.6 3.1.1; design
// p1-step7-design.md §3.12 #2, #20, §4.1, §4.3, §7 item 13; P1-1c). The reader has two root
// layouts, so Next's experimental global-not-found (next.config.ts) renders this file directly and
// bypasses every layout: it keeps the Step 6 root shape itself (<html> and <body> here, the two
// stylesheets in order, the shared viewport, lang and dir from the registry, the text-size boot
// script once in <head>). The page is English with the Hindi parts in lang="hi". Its metadata is
// the title only: Next adds noindex to every 404 itself.
// P1-2c (design p1-step9-design.md §3.6 rows 1-6, §4.3, §9 item 4): it bypasses every layout, so
// it renders the staging banner itself, as the first child of <body>, from contentMode() (the mode
// the loader wrote; null without .content/, so it renders nothing then).
import type { Metadata } from 'next'
import { contentMode } from '@/content'
import { getLocaleDef } from '@/core/locales'
import { TEXT_SCALE_BOOT_SCRIPT } from '@/core/progress/text-scale-boot'
import { NotFoundContent } from '@/ui/not-found/not-found-content'
import { htmlAttributes } from '@/ui/root/document'
import { FONT_CLASSES } from '@/ui/root/font-classes'
import { StagingBanner } from '@/ui/root/staging-banner'
import { ROOT_VIEWPORT } from '@/ui/viewport'
import '@/ui/styles/tokens.css'
import '@/ui/styles/base.css'

export const metadata: Metadata = { title: 'Page not found – Storyboard' }

// Theme colour and colour scheme (spec §6.1, §6.6; P1-1b); whether Next reads it here is reported
// by the e2e (design R2).
export const viewport = ROOT_VIEWPORT

export default function GlobalNotFound() {
  // The inline script runs before <body> is parsed and sets data-text-scale on <html>, so React
  // must not warn about an attribute the server did not render.
  return (
    <html {...htmlAttributes(getLocaleDef('en'), FONT_CLASSES)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SCALE_BOOT_SCRIPT }} />
      </head>
      <body>
        <StagingBanner mode={contentMode()} />
        <NotFoundContent />
      </body>
    </html>
  )
}
