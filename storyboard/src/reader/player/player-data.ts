// Player view model (Step 10a; design D11-P2, §5). The page builds PlayerData on the server from the
// strict package and the enabled locales and passes it to the player island as props, so it holds
// only what the player shows and what the engine needs. Not sent: provenance, the assets themselves
// (only finished picture and clip URLs are), description, theme, book, duration, alt and
// packageSha256 (Step 20 adds report data).
// - Step 11 (design p1-step11-design.md N18, §4.1): each node carries its narration, page locale →
//   the finished clip URL (options.mediaUrl of the audio asset's one variant), {} when it has none,
//   so every node has the same keys. Audio URLs are sent now; the asset id field, path, mime, bytes,
//   durationMs, provenance and narratedTextSha256 still are not. A clip in a locale the page does
//   not build is skipped. The second lock, ids only: an audio asset for a node the package lacks
//   (`narration node missing`), a second one for a node and locale (`narration duplicate`), a
//   variant that is not audio/mpeg (`narration.mime missing`), or a clip while no mediaUrl was
//   passed (`mediaUrl missing`), each as `player: <storyId> <locale> <nodeId> ...`.
// - Step 10e (D11-P2 C14, P21): each node carries its picture as an ImageView (images.ts), or null
//   when it has none (every phase-1 package, SPEC:189: no box). imageViewOf runs here, on the
//   server, with options.mediaUrl, the reader's checked builder (mediaUrl from @/content, passed in
//   by the page), so the view holds finished URLs, srcset and sizes and never a path, mime, byte
//   count or provenance. An image that names no image asset, or a node with an image while no
//   mediaUrl was passed, throws `player: <storyId> - <nodeId> image|mediaUrl missing` (ids only).
// - locales = the package's locales that are also in options.locales, in registry order;
//   defaultLocale = the package default when it is one of them, else the first.
// - The second lock behind strict parse and the validator: a missing node text, choice label or
//   ending lesson in an included locale throws `player: <storyId> <locale> <nodeId> <field>
//   missing` (ids only, never text), which stops the build.
// - graphOf(data) is the engine graph of exactly these locales: toGraph(pkg) with the locales
//   restricted and the default remapped, so the engine never falls back to a locale the page lacks.
// Plain objects and arrays only (React passes them to a client component). Imports are relative
// (C15): Vitest has no `@/` alias.
import type { Graph, GraphNode } from '../../core/engine'
import { LOCALE_CODES, type LocaleCode } from '../../core/locales'
import type { NodeTypeName, StoryNode, StoryPackageV1 } from '../../core/package/v1'
import { imageViewOf, type ImageView, type MediaUrlOf } from './images'
import { paragraphsOf } from './view'

export interface PlayerChoice {
  readonly id: string
  readonly next: string
}

export interface PlayerNode {
  readonly id: string
  readonly type: NodeTypeName
  readonly isAlternate: boolean
  readonly scene: string
  /** Endings only. */
  readonly lessonIcon: string | null
  /** In package order; empty at an ending. */
  readonly choices: readonly PlayerChoice[]
  /** The node's picture (Step 10e), or null: no picture, so no box. */
  readonly image: ImageView | null
  /** Step 11: page locale → the finished clip URL; {} when the node has no clip (N18). */
  readonly narration: Readonly<Partial<Record<LocaleCode, string>>>
}

export interface PlayerNodeText {
  /** The passage split on "\n\n" (paragraphsOf). */
  readonly paragraphs: readonly string[]
  /** null at an ending and when the node has none. */
  readonly question: string | null
  /** Choice id → label as stored; empty at an ending. */
  readonly choices: Readonly<Record<string, string>>
  /** Endings only. */
  readonly lesson: string | null
}

export interface PlayerLocaleText {
  readonly title: string
  readonly nodes: Readonly<Record<string, PlayerNodeText>>
}

export interface PlayerData {
  readonly storyId: string
  readonly version: number
  readonly startNodeId: string
  /** Package locales ∩ the page's enabled locales, in registry order. */
  readonly locales: readonly LocaleCode[]
  readonly defaultLocale: LocaleCode
  readonly progressSteps: readonly string[]
  /** Ending node ids in package order. */
  readonly endingIds: readonly string[]
  readonly nodes: readonly PlayerNode[]
  /** One entry per locale in `locales`, no other. */
  readonly text: Readonly<Partial<Record<LocaleCode, PlayerLocaleText>>>
}

export interface PlayerDataOptions {
  /** The locales the site builds pages for (the enabled locales). */
  readonly locales: readonly LocaleCode[]
  /**
   * The reader's media URL builder (mediaUrl from @/content; server only, C14). Needed only by a
   * package with a picture or a clip in a page locale; one of those and no builder throws.
   */
  readonly mediaUrl?: MediaUrlOf
}

function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

export function playerDataOf(pkg: StoryPackageV1, options: PlayerDataOptions): PlayerData {
  const missing = (locale: string, nodeId: string, field: string) =>
    new Error(`player: ${pkg.storyId} ${locale} ${nodeId} ${field} missing`)
  const locales = LOCALE_CODES.filter(
    (code) => pkg.locales.includes(code) && options.locales.includes(code),
  )
  const first = locales[0]
  if (first === undefined) throw missing('-', '-', 'locales')
  const defaultLocale = locales.includes(pkg.defaultLocale) ? pkg.defaultLocale : first

  const imageOf = (node: StoryNode): ImageView | null => {
    if (node.image === null) return null
    const asset = pkg.assets.find((a) => a.kind === 'image' && a.id === node.image)
    if (asset === undefined || asset.kind !== 'image') throw missing('-', node.id, 'image')
    if (options.mediaUrl === undefined) throw missing('-', node.id, 'mediaUrl')
    return imageViewOf(asset, options.mediaUrl, { storyId: pkg.storyId, nodeId: node.id })
  }

  // Step 11 (§4.1): node id → page locale → clip URL, from the audio assets in the page's locales.
  const clips = new Map<string, Partial<Record<LocaleCode, string>>>()
  for (const asset of pkg.assets) {
    if (asset.kind !== 'audio' || !locales.includes(asset.locale)) continue
    const { locale, nodeId } = asset
    if (!pkg.nodes.some((node) => node.id === nodeId)) {
      throw missing(locale, nodeId, 'narration node')
    }
    const variant = asset.variants[0]
    if (variant === undefined || variant.mime !== 'audio/mpeg') {
      throw missing(locale, nodeId, 'narration.mime')
    }
    const byLocale = clips.get(nodeId) ?? {}
    if (byLocale[locale] !== undefined) {
      throw new Error(`player: ${pkg.storyId} ${locale} ${nodeId} narration duplicate`)
    }
    if (options.mediaUrl === undefined) throw missing(locale, nodeId, 'mediaUrl')
    byLocale[locale] = options.mediaUrl(variant.path)
    clips.set(nodeId, byLocale)
  }
  /** In the page's locale order, so the payload does not depend on the order of the assets. */
  const narrationOf = (nodeId: string): Partial<Record<LocaleCode, string>> => {
    const byLocale = clips.get(nodeId) ?? {}
    const narration: Partial<Record<LocaleCode, string>> = {}
    for (const locale of locales) {
      const url = byLocale[locale]
      if (url !== undefined) narration[locale] = url
    }
    return narration
  }

  const nodes: PlayerNode[] = pkg.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    isAlternate: node.isAlternate,
    scene: node.scene,
    lessonIcon: node.type === 'ending' ? node.lessonIcon : null,
    choices: node.type === 'ending' ? [] : node.choices.map((c) => ({ id: c.id, next: c.next })),
    image: imageOf(node),
    narration: narrationOf(node.id),
  }))

  const text: Partial<Record<LocaleCode, PlayerLocaleText>> = {}
  for (const locale of locales) {
    const source = pkg.text[locale]
    if (source === undefined) throw missing(locale, '-', 'text')
    const nodeTexts: Record<string, PlayerNodeText> = {}
    for (const node of pkg.nodes) {
      const stored = own(source.nodes, node.id)
      if (stored === undefined) throw missing(locale, node.id, 'text')
      const choices: Record<string, string> = {}
      let lesson: string | null = null
      if (node.type === 'ending') {
        if (stored.lesson === undefined) throw missing(locale, node.id, 'lesson')
        lesson = stored.lesson
      } else {
        for (const choice of node.choices) {
          const label = stored.choices === undefined ? undefined : own(stored.choices, choice.id)
          if (label === undefined) throw missing(locale, node.id, `choices.${choice.id}`)
          choices[choice.id] = label
        }
      }
      nodeTexts[node.id] = {
        paragraphs: paragraphsOf(stored.text),
        question: node.type === 'ending' ? null : (stored.question ?? null),
        choices,
        lesson,
      }
    }
    text[locale] = { title: source.title, nodes: nodeTexts }
  }

  return {
    storyId: pkg.storyId,
    version: pkg.version,
    startNodeId: pkg.startNodeId,
    locales,
    defaultLocale,
    progressSteps: [...pkg.progressSteps],
    endingIds: pkg.nodes.filter((n) => n.type === 'ending').map((n) => n.id),
    nodes,
    text,
  }
}

/** The engine graph of this page: toGraph(pkg) with the page's locales and default. */
export function graphOf(data: PlayerData): Graph {
  const nodes = new Map<string, GraphNode>()
  for (const node of data.nodes) {
    nodes.set(node.id, {
      id: node.id,
      type: node.type,
      choices: node.choices.map((c) => ({ id: c.id, next: c.next })),
    })
  }
  return {
    storyId: data.storyId,
    version: data.version,
    startNodeId: data.startNodeId,
    locales: [...data.locales],
    defaultLocale: data.defaultLocale,
    nodes,
  }
}
