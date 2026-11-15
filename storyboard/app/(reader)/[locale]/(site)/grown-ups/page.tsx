// /{locale}/grown-ups: the Grown-ups placeholder (spec §6.1 header; design p1-step7-design.md
// §3.12 #4, #17, §7 items 10, 12, 34; P1-1c). Step 21 replaces it with the real content. Static
// only (spec §3.2): this page sets dynamic and dynamicParams itself. Its metadata sets the title
// only ("For grown-ups – Storyboard" through the layout's template); pages never set robots.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { parseEnabledLocale } from '@/core/locales'
import { translator, type Translate } from '@/ui/i18n/messages'

export const dynamic = 'force-static'
export const dynamicParams = false

interface GrownUpsProps {
  readonly params: Promise<{ locale: string }>
}

async function pageTranslator(params: GrownUpsProps['params']): Promise<Translate> {
  const code = parseEnabledLocale((await params).locale)
  if (code === undefined) notFound()
  return translator(code)
}

export async function generateMetadata({ params }: GrownUpsProps): Promise<Metadata> {
  const t = await pageTranslator(params)
  return { title: t('grownUps.title') }
}

export default async function GrownUpsPage({ params }: GrownUpsProps) {
  const t = await pageTranslator(params)
  return (
    <>
      <h1>{t('grownUps.title')}</h1>
      <p>{t('grownUps.placeholder')}</p>
    </>
  )
}
