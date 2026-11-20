// /{locale}/stories/{storyId}: the story landing (P1 Step 12; design p1-step12-design.md §3.8 N9,
// §3.9 N10, §3.10 N11, §3.11 N12, §3.15 N16, §4.5; spec §6.1 Landing, SPEC:434). Under (site), so
// the site layout gives it the skip link, the header and main with the storage banner first and
// the live region last.
// - Static only (spec §3.2): dynamic = 'force-static' and dynamicParams = false. generateStaticParams
//   is the player's top-down child form: one call per [locale] param, the stories whose package has
//   that locale; [] while the launch flag is gated. Every other storyId is a 404 from the global
//   bilingual page (D11-P29): this page never calls notFound(), so there is no [locale]/not-found.
// - A listed story that was not built, or whose package lacks the locale, stops the build with ids
//   only.
// - The title is the story's title in the URL locale (the layout's template adds " – Storyboard");
//   the description is the story's description. 12b (design §3.21 N21, B5): openGraph from
//   landingOpenGraph (og:title the bare story title, the same description, type and site name; the
//   absolute url and image only with the build's site origin, src/config/site-url.ts). No robots,
//   alternates or base URL here (src/ui/root/metadata.ts keeps robots).
// - Body, in DOM and visual order, inside [data-landing]: the book label, h1 (the title), the
//   description, the meta list ("Age 6+", the duration), "Theme: …", then StoryActions (the action
//   row, How this story was made, the Share row and its manual field). Package text renders as
//   stored (SPEC:441). Strings are resolved here; the island gets finished strings as props.
import type { Metadata } from 'next'
import { buildLaunch } from '@/config/launch'
import { buildSiteOrigin } from '@/config/site-url'
import { getStory, listStoriesForLocale, type BuiltStory } from '@/content'
import { parseEnabledLocale, type LocaleCode } from '@/core/locales'
import { landingOpenGraph } from '@/ui/root/social'
import { StoryActions } from '@/ui/story/story-actions'
import styles from '@/ui/story/story.module.css'
import { storyStrings } from '@/ui/story/strings'

export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams({ params }: { params: { locale: string } }) {
  const code = parseEnabledLocale(params.locale)
  if (!buildLaunch().readerRoutes || code === undefined) return []
  return listStoriesForLocale(code).map((s) => ({ storyId: s.storyId }))
}

interface LandingPageProps {
  readonly params: Promise<{ locale: string; storyId: string }>
}

interface LandingPageInfo {
  readonly code: LocaleCode
  readonly story: BuiltStory
}

/** The page's locale and story; a param this build should never list throws (ids only). */
async function landingPage(params: LandingPageProps['params']): Promise<LandingPageInfo> {
  const { locale, storyId } = await params
  const code = parseEnabledLocale(locale)
  if (code === undefined) throw new Error('landing: a locale that is not enabled was listed')
  const story = getStory(storyId)
  if (story === null) throw new Error(`landing: story ${storyId} was listed but not built`)
  if (!story.pkg.locales.includes(code) || story.pkg.text[code] === undefined) {
    throw new Error(`landing: story ${storyId} was listed for ${code} but has no ${code} text`)
  }
  return { code, story }
}

export async function generateMetadata({ params }: LandingPageProps): Promise<Metadata> {
  const { code, story } = await landingPage(params)
  const { title, description } = storyStrings(code, story.pkg)
  return {
    title,
    description,
    openGraph: landingOpenGraph({
      origin: buildSiteOrigin(),
      locale: code,
      storyId: story.pkg.storyId,
      title,
      description,
    }),
  }
}

export default async function LandingPage({ params }: LandingPageProps) {
  const { code, story } = await landingPage(params)
  const strings = storyStrings(code, story.pkg)
  return (
    <div data-landing="" className={styles.landing}>
      <p className={styles.book}>{strings.book}</p>
      <h1 className={styles.title}>{strings.title}</h1>
      <p className={styles.description}>{strings.description}</p>
      <ul data-story-meta="" role="list" className={styles.meta}>
        <li>{strings.age}</li>
        <li>{strings.duration}</li>
      </ul>
      <p className={styles.theme}>{strings.theme}</p>
      <StoryActions
        storyId={story.pkg.storyId}
        locale={code}
        title={strings.title}
        howMadeHref={strings.howMadeHref}
        strings={strings.actions}
      />
    </div>
  )
}
