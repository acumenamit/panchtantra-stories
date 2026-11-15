// Root layout for every reader route, /{locale}/… (spec §4.5, §6.6 3.1.1, §10.3 noindex; P1 D4,
// D8; design p1-step7-design.md §4, §4.1, §4.2, §5.3 item 2, §7 items 7, 10-11, 22; P1-1c).
// - Static only (spec §3.2): dynamic = 'force-static' and dynamicParams = false. The params come
//   from the launch flag: every enabled locale in open builds, none while gated, so every
//   /{locale}/… path is a 404 in a gated build (the global not-found page).
// - params are typed by hand and parsed with parseEnabledLocale; notFound() when the flag is gated
//   or the locale is not enabled (defence in depth behind dynamicParams = false).
// - The Step 6 root shape: <html> and <body> here, the two stylesheets in order, the shared
//   viewport, lang and dir from the URL's locale and the registry (never from storage), and the
//   text-size boot script once in <head>.
// - ChoiceRecorder saves uiLocale only when the URL carries ?remember=1 (gate and header links).
// - P1-2c (design p1-step9-design.md §3.6 rows 1-6, §4.3, §9 item 4): the staging banner is the
//   first child of <body>, before ChoiceRecorder, from contentMode() (the mode the loader wrote;
//   null without .content/, so it renders nothing then). Step 10's player sits under this layout.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { buildLaunch } from '@/config/launch'
import { contentMode } from '@/content'
import { getLocaleDef, parseEnabledLocale, type LocaleCode } from '@/core/locales'
import { TEXT_SCALE_BOOT_SCRIPT } from '@/core/progress/text-scale-boot'
import { readerLocaleParams } from '@/reader/routing'
import { translator } from '@/ui/i18n/messages'
import { htmlAttributes } from '@/ui/root/document'
import { FONT_CLASSES } from '@/ui/root/font-classes'
import { readerRootMetadata } from '@/ui/root/metadata'
import { StagingBanner } from '@/ui/root/staging-banner'
import { ChoiceRecorder } from '@/ui/shell/choice-recorder'
import { ROOT_VIEWPORT } from '@/ui/viewport'
import '@/ui/styles/tokens.css'
import '@/ui/styles/base.css'

export const dynamic = 'force-static'
export const dynamicParams = false

// Theme colour and colour scheme (spec §6.1, §6.6; P1-1b). Next keeps its default viewport meta.
export const viewport = ROOT_VIEWPORT

export function generateStaticParams() {
  return readerLocaleParams(buildLaunch())
}

interface LocaleParams {
  readonly params: Promise<{ locale: string }>
}

/** The page's locale: an enabled one in an open build, else a 404. */
async function readerLocale(params: LocaleParams['params']): Promise<LocaleCode> {
  const code = parseEnabledLocale((await params).locale)
  if (!buildLaunch().readerRoutes || code === undefined) notFound()
  return code
}

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = translator(await readerLocale(params))
  return readerRootMetadata(t('meta.description'))
}

export default async function ReaderRootLayout({
  children,
  params,
}: LocaleParams & { children: ReactNode }) {
  const code = await readerLocale(params)
  // The inline script runs before <body> is parsed and sets data-text-scale on <html>, so React
  // must not warn about an attribute the server did not render.
  return (
    <html {...htmlAttributes(getLocaleDef(code), FONT_CLASSES)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SCALE_BOOT_SCRIPT }} />
      </head>
      <body>
        <StagingBanner mode={contentMode()} />
        <ChoiceRecorder locale={code} />
        {children}
      </body>
    </html>
  )
}
