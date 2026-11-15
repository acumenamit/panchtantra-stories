// /{locale}: the home placeholder (design p1-step7-design.md §1, §7 items 10, 34; P1-1c). Review
// builds only until Step 25b; Step 12 replaces it with the story shelf. Static only (spec §3.2):
// this page sets dynamic and dynamicParams itself. Its title is the layout's default, Storyboard.
import { notFound } from 'next/navigation'
import { parseEnabledLocale } from '@/core/locales'
import { translator } from '@/ui/i18n/messages'

export const dynamic = 'force-static'
export const dynamicParams = false

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const code = parseEnabledLocale((await params).locale)
  if (code === undefined) notFound()
  const t = translator(code)
  return (
    <>
      <h1>{t('home.title')}</h1>
      <p>{t('home.placeholder')}</p>
    </>
  )
}
