import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getLocaleDef } from '@/core/locales'
import { TEXT_SCALE_BOOT_SCRIPT } from '@/core/progress/text-scale-boot'
import { devanagari, devanagariLatin, lora } from '@/ui/fonts'
import { ROOT_VIEWPORT } from '@/ui/viewport'
import '@/ui/styles/tokens.css'
import '@/ui/styles/base.css'

export const metadata: Metadata = {
  title: 'Storyboard',
  description: 'Interactive stories for children (work in progress).',
  robots: { index: false, follow: false },
}

// Theme colour and colour scheme (spec §6.1, §6.6; P1-1b). Next keeps its default viewport meta.
export const viewport = ROOT_VIEWPORT

// lang and dir come from the registry; Step 7 sets them per route (spec §6.6 3.1.1).
const locale = getLocaleDef('en')
const fontClasses = [lora.variable, devanagari.variable, devanagariLatin.variable].join(' ')

export default function RootLayout({ children }: { children: ReactNode }) {
  // The inline script sets data-text-scale on <html> before <body> is parsed (P1-1b), so React
  // must not warn about an attribute the server did not render.
  return (
    <html lang={locale.code} dir={locale.dir} className={fontClasses} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SCALE_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
