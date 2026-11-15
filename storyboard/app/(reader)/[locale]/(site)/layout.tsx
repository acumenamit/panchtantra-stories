// The reader shell for the site pages (spec §6.1 header, §6.6 2.4.1, 4.1.3; design
// p1-step7-design.md §3.11 B1, §3.12 #3, #12-#13, §4, §7 item 25; P1-1c). Body order: the skip
// link, the header, then <main id="main" tabIndex={-1}> holding the storage banner first, the page,
// and the one polite live region last. In a group, so the Step 10 player can have its own chrome.
// Strings are resolved here on the server; client components get finished strings as props.
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { parseEnabledLocale } from '@/core/locales'
import { LiveRegion } from '@/ui/a11y/live-region'
import { translator } from '@/ui/i18n/messages'
import { SiteHeader } from '@/ui/shell/site-header'
import { SkipLink } from '@/ui/shell/skip-link'
import { StorageBanner } from '@/ui/shell/storage-banner'
import styles from '@/ui/shell/shell.module.css'

export default async function SiteLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const code = parseEnabledLocale((await params).locale)
  if (code === undefined) notFound()
  const t = translator(code)
  return (
    <>
      <SkipLink label={t('shell.skipToMain')} />
      <SiteHeader locale={code} />
      <main id="main" tabIndex={-1} className={styles.main}>
        <StorageBanner title={t('storage.title')} body={t('storage.body')} />
        {children}
        <LiveRegion />
      </main>
    </>
  )
}
