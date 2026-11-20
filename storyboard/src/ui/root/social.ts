// Open Graph for Home and the story landing (P1 Step 12, 12b; design p1-step12-design.md §3.19 N19,
// §3.21 N21, §4.9; spec §6.1 SPEC:434). The pages' generateMetadata set openGraph from these; Next
// fills Twitter's card, title, description and image from openGraph.
// - Always: og:title (Home: Storyboard; a landing: the bare story title, never the page title
//   template), og:description, og:type website, og:site_name Storyboard.
// - Only with a site origin (src/config/site-url.ts: a Production build with the site URL set): the
//   absolute og:url and the one og:image, the committed fallback JPEG (D25, design §3.19). With no
//   origin the url and images keys are left out altogether, so no relative URL ever reaches Next.
// - No robots (src/ui/root/metadata.ts is their one place), no alternates or canonical, no base
//   URL setting and no og:locale (design §3.21; D10: every page is noindex).
// - H-17: Step 17 adds a per-story JPEG (D14) with this file as the fallback; a new fallback
//   picture needs a new file name, because crawlers cache images by URL.
import type { Metadata } from 'next'
import { APP_NAME } from '../../core/app-info'
import type { LocaleCode } from '../../core/locales'

/** The site fallback og:image: public/og/storyboard-1200x630.jpg (scripts/og/write-og-image.ts). */
export const OG_IMAGE = {
  path: '/og/storyboard-1200x630.jpg',
  width: 1200,
  height: 630,
  type: 'image/jpeg',
} as const

type OpenGraph = NonNullable<Metadata['openGraph']>

/** The tags every Home and landing page carries, and the absolute ones when there is an origin. */
function openGraph(
  origin: string | null,
  path: string,
  title: string,
  description: string,
): OpenGraph {
  const always = { title, description, type: 'website', siteName: APP_NAME } as const
  if (origin === null) return always
  return {
    ...always,
    url: `${origin}${path}`,
    images: [
      {
        url: `${origin}${OG_IMAGE.path}`,
        width: OG_IMAGE.width,
        height: OG_IMAGE.height,
        type: OG_IMAGE.type,
        alt: APP_NAME,
      },
    ],
  }
}

/** Home, /{locale}: the site's own title and the layout's description (meta.description). */
export function homeOpenGraph({
  origin,
  locale,
  description,
}: {
  readonly origin: string | null
  readonly locale: LocaleCode
  readonly description: string
}): OpenGraph {
  return openGraph(origin, `/${locale}`, APP_NAME, description)
}

/** A story landing, /{locale}/stories/{storyId}: the story's title and description as stored. */
export function landingOpenGraph({
  origin,
  locale,
  storyId,
  title,
  description,
}: {
  readonly origin: string | null
  readonly locale: LocaleCode
  readonly storyId: string
  readonly title: string
  readonly description: string
}): OpenGraph {
  return openGraph(origin, `/${locale}/stories/${storyId}`, title, description)
}
