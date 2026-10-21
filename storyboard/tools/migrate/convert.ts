// Phase-1 conversion (spec §4.3, M4): text and graph only, image = null, assets = [].
// Text is copied verbatim; only structure is derived (type, choice ids, source.book, startNodeId).
import { StoryPackageV1 } from '../../src/core/package/v1'
import type { LegacyNode, LegacyStory, LegacyText } from './load-legacy'

const STORY_KEYS = new Set([
  'id',
  'title',
  'description',
  'theme',
  'age',
  'duration',
  'addedOn',
  'featured',
  'emoji',
  'color',
  'book',
  'progressSteps',
  'nodes',
])
const NODE_KEYS = new Set([
  'scene',
  'image',
  'text',
  'question',
  'choices',
  'isAlternate',
  'isEnding',
  'lesson',
  'lessonIcon',
])
const CHOICE_KEYS = new Set(['text', 'next'])
const LOCALES = ['en', 'hi'] as const
const ROMAN = ['I', 'II', 'III', 'IV', 'V'] as const

function assertKnownKeys(obj: object, known: Set<string>, where: string): void {
  const unknown = Object.keys(obj).filter((k) => !known.has(k))
  if (unknown.length) throw new Error(`${where}: unmapped legacy field(s) ${unknown.join(', ')}`)
}

/** "Panchatantra — Book III" -> "III" (from the English label). */
export function parseBook(label: string): (typeof ROMAN)[number] {
  const m = /Book\s+(I{1,3}|IV|V)\s*$/.exec(label)
  const roman = m?.[1] as (typeof ROMAN)[number] | undefined
  if (!roman || !ROMAN.includes(roman)) throw new Error(`Cannot parse book number from "${label}"`)
  return roman
}

export function deriveType(node: LegacyNode): 'single' | 'fork' | 'alternate' | 'ending' {
  if (node.isEnding) return 'ending'
  if (node.isAlternate) return 'alternate'
  return (node.choices?.length ?? 0) === 2 ? 'fork' : 'single'
}

const pick = (t: LegacyText | undefined, l: (typeof LOCALES)[number]) => (t ? t[l] : undefined)

export function convertLegacyStory(story: LegacyStory): StoryPackageV1 {
  assertKnownKeys(story, STORY_KEYS, story.id)
  const nodeIds = Object.keys(story.nodes)

  const nodes = nodeIds.map((id) => {
    const n = story.nodes[id]!
    assertKnownKeys(n, NODE_KEYS, `${story.id}.${id}`)
    n.choices?.forEach((c, i) => assertKnownKeys(c, CHOICE_KEYS, `${story.id}.${id}.choices[${i}]`))
    const base = { id, scene: n.scene, isAlternate: n.isAlternate === true, image: null }
    const type = deriveType(n)
    if (type === 'ending') return { ...base, type, lessonIcon: n.lessonIcon }
    const choices = (n.choices ?? []).map((c, i) => ({ id: `c${i + 1}`, next: c.next }))
    return { ...base, type, choices }
  })

  const text = Object.fromEntries(
    LOCALES.map((l) => [
      l,
      {
        title: story.title[l],
        description: story.description[l],
        theme: story.theme[l],
        duration: story.duration[l],
        book: story.book[l],
        nodes: Object.fromEntries(
          nodeIds.map((id) => {
            const n = story.nodes[id]!
            const entry: Record<string, unknown> = { text: n.text[l] }
            const question = pick(n.question, l)
            if (question !== undefined) entry.question = question
            if (n.choices?.length) {
              entry.choices = Object.fromEntries(n.choices.map((c, i) => [`c${i + 1}`, c.text[l]]))
            }
            const lesson = pick(n.lesson, l)
            if (lesson !== undefined) entry.lesson = lesson
            return [id, entry]
          }),
        ),
      },
    ]),
  )

  // Parsing validates the result; any shape problem throws here, before anything is written.
  return StoryPackageV1.parse({
    schemaVersion: '1.0',
    storyId: story.id,
    version: 1,
    origin: 'migration',
    collectionId: 'panchatantra',
    source: { work: 'panchatantra', book: parseBook(story.book.en) },
    age: story.age,
    addedOn: story.addedOn,
    emoji: story.emoji,
    color: story.color,
    access: { tier: 'free' },
    aiUse: { text: 'assisted', illustration: 'generated', narration: 'generated' },
    locales: [...LOCALES],
    defaultLocale: 'en',
    startNodeId: 'start',
    progressSteps: [...story.progressSteps],
    nodes,
    text,
    assets: [],
  })
}
