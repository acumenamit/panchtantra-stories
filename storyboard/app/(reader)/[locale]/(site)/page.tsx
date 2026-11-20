// /{locale}: Home, the story shelf (P1 Step 12; design p1-step12-design.md §3.1 N2, §3.2 N3, §3.4
// N5, §4.1; spec §6.1 Home, SPEC:433). Static only (spec §3.2): this page sets dynamic and
// dynamicParams itself. Its title is the layout's default, Storyboard.
// - The server reads this locale's stories (listStoriesForLocale) and the featured story
//   (featuredStory, the gated verdict build-info names), sorts them (sortShelf: addedOn
//   descending, then storyId) and builds each card's props and finished strings, the ending ids
//   included (the badge's "x of y"), so no catalogue and no content reader reaches the client.
// - HomeShelf renders from those props: h1, then Continue reading, the Featured story (when it has
//   this locale) and All stories; an empty catalogue shows the h1 and home.placeholder only.
//   Progress and today's date are read in the browser after mount (reserved cells; N6).
// - A listed story that was not built stops the build with ids only.
import { notFound } from 'next/navigation'
import { featuredStory, getStory, listStoriesForLocale } from '@/content'
import { toGraph } from '@/core/engine'
import { parseEnabledLocale } from '@/core/locales'
import { endingIdsOf } from '@/core/progress'
import { sortShelf } from '@/reader/shelf/shelf'
import { HomeShelf } from '@/ui/home/home-shelf'
import { cardOf, shelfStrings } from '@/ui/home/strings'

export const dynamic = 'force-static'
export const dynamicParams = false

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const code = parseEnabledLocale((await params).locale)
  if (code === undefined) notFound()
  const stories = sortShelf(listStoriesForLocale(code)).map((summary) => {
    const built = getStory(summary.storyId)
    if (built === null) throw new Error(`home: story ${summary.storyId} was listed but not built`)
    return cardOf(code, summary, endingIdsOf(toGraph(built.pkg)))
  })
  const featured = featuredStory()
  return (
    <HomeShelf
      locale={code}
      strings={shelfStrings(code)}
      stories={stories}
      featured={featured === null ? null : { storyId: featured.storyId, locales: featured.locales }}
    />
  )
}
