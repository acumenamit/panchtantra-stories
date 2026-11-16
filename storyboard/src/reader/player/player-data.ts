// Player view model (Step 10a; design D11-P2, §5). The page builds PlayerData on the server from the
// strict package and the enabled locales and passes it to the player island as props, so it holds
// only what the player shows and what the engine needs. Not sent: provenance, assets (audio
// included), description, theme, book, duration, alt and packageSha256 (Step 20 adds report data;
// 10e adds each node's image view).
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
import type { NodeTypeName, StoryPackageV1 } from '../../core/package/v1'
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

  const nodes: PlayerNode[] = pkg.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    isAlternate: node.isAlternate,
    scene: node.scene,
    lessonIcon: node.type === 'ending' ? node.lessonIcon : null,
    choices: node.type === 'ending' ? [] : node.choices.map((c) => ({ id: c.id, next: c.next })),
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
