// Root layout for "/" (spec §4.5, §6.6 3.1.1, §10.3 noindex; P1 D4, D8; design
// p1-step7-design.md §3.12 #1, §4, §4.1, §5.3 item 4, §7 items 7-8; P1-1c). One of two root
// layouts under (reader), which has no layout of its own; it keeps the Step 6 root shape:
// <html> and <body> written here, the two stylesheets in order, the shared viewport, lang and dir
// from the registry (en, ltr), and the text-size boot script once in <head>. "/" keeps exactly the
// metadata it had before Step 7 (title, description, noindex). In open builds only, the gate's
// redirect script follows the boot script, so a stored uiLocale can never redirect to a 404 in a
// gated build.
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { buildLaunch } from '@/config/launch'
import { getLocaleDef } from '@/core/locales'
import { LOCALE_REDIRECT_SCRIPT } from '@/core/progress/locale-redirect-boot'
import { TEXT_SCALE_BOOT_SCRIPT } from '@/core/progress/text-scale-boot'
import { htmlAttributes } from '@/ui/root/document'
import { FONT_CLASSES } from '@/ui/root/font-classes'
import { ROOT_METADATA } from '@/ui/root/metadata'
import { ROOT_VIEWPORT } from '@/ui/viewport'
import '@/ui/styles/tokens.css'
import '@/ui/styles/base.css'

export const metadata: Metadata = ROOT_METADATA

// Theme colour and colour scheme (spec §6.1, §6.6; P1-1b). Next keeps its default viewport meta.
export const viewport = ROOT_VIEWPORT

export default function GateRootLayout({ children }: { children: ReactNode }) {
  const open = buildLaunch().readerRoutes
  // The inline scripts run before <body> is parsed; the text-size one sets data-text-scale on
  // <html>, so React must not warn about an attribute the server did not render.
  return (
    <html {...htmlAttributes(getLocaleDef('en'), FONT_CLASSES)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SCALE_BOOT_SCRIPT }} />
        {open ? <script dangerouslySetInnerHTML={{ __html: LOCALE_REDIRECT_SCRIPT }} /> : null}
      </head>
      <body>{children}</body>
    </html>
  )
}
