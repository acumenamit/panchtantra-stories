// /{locale}/stories/{storyId}/read: the story player (spec §6.1 Player, §6.2-§6.4; design
// p1-step10-design.md §1 10a, §4.1, §4.2, D11-P1, P2, P5, P17, P29; P1-4b). A (player) route group
// with no layout, so the player has its own chrome; the [locale] root layout above it renders
// <html>, the text-size boot script, the staging banner and ChoiceRecorder.
// - Static only (spec §3.2): dynamic = 'force-static' and dynamicParams = false. generateStaticParams
//   is the top-down child form (C1): it runs once per [locale] param and lists the stories whose
//   package has that locale; [] while the launch flag is gated (the [locale] layout already lists
//   no locale then). Every other storyId is a 404 from the global bilingual page (D11-P29): this
//   page never calls notFound(), so there is no [locale]/not-found.tsx.
// - A listed story that was not built, or whose package lacks the locale, stops the build with ids
//   only. playerDataOf is the second lock behind strict parse and the validator.
// - The title is the story's title in the URL locale (the layout's template adds " – Storyboard").
// - Body: the skip link, the saved-run hint script (D11-P5, before the island so it runs before
//   the first paint), then PlayerBoundary (catchError, D11-P17) around the Player island. Strings
//   are resolved here; the island gets PlayerData and finished strings as props.
import type { Metadata } from 'next'
import { buildLaunch } from '@/config/launch'
import { getStory, listStoriesForLocale, type BuiltStory } from '@/content'
import { ENABLED_LOCALE_CODES, parseEnabledLocale, type LocaleCode } from '@/core/locales'
import { savedRunHintScript } from '@/core/progress/saved-run-hint'
import { playerDataOf } from '@/reader/player/player-data'
import { translator } from '@/ui/i18n/messages'
import { Player } from '@/ui/player/player'
import { PlayerBoundary } from '@/ui/player/player-boundary'
import { playerFallbackStringsOf, playerStringsOf } from '@/ui/player/strings'
import { SkipLink } from '@/ui/shell/skip-link'

export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams({ params }: { params: { locale: string } }) {
  const code = parseEnabledLocale(params.locale)
  if (!buildLaunch().readerRoutes || code === undefined) return []
  return listStoriesForLocale(code).map((s) => ({ storyId: s.storyId }))
}

interface PlayerPageProps {
  readonly params: Promise<{ locale: string; storyId: string }>
}

interface PlayerPageInfo {
  readonly code: LocaleCode
  readonly story: BuiltStory
  readonly title: string
}

/** The page's locale, story and title; a param this build should never list throws (ids only). */
async function playerPage(params: PlayerPageProps['params']): Promise<PlayerPageInfo> {
  const { locale, storyId } = await params
  const code = parseEnabledLocale(locale)
  if (code === undefined) throw new Error('player: a locale that is not enabled was listed')
  const story = getStory(storyId)
  if (story === null) throw new Error(`player: story ${storyId} was listed but not built`)
  const text = story.pkg.text[code]
  if (!story.pkg.locales.includes(code) || text === undefined) {
    throw new Error(`player: story ${storyId} was listed for ${code} but has no ${code} text`)
  }
  return { code, story, title: text.title }
}

export async function generateMetadata({ params }: PlayerPageProps): Promise<Metadata> {
  const { title } = await playerPage(params)
  return { title }
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { code, story } = await playerPage(params)
  const data = playerDataOf(story.pkg, { locales: ENABLED_LOCALE_CODES })
  const t = translator(code)
  return (
    <>
      <SkipLink label={t('shell.skipToMain')} />
      <script dangerouslySetInnerHTML={{ __html: savedRunHintScript(data.storyId) }} />
      <PlayerBoundary storyId={data.storyId} locale={code} strings={playerFallbackStringsOf(code)}>
        <Player data={data} strings={playerStringsOf(code, data)} locale={code} />
      </PlayerBoundary>
    </>
  )
}
