// Engine view of a story: language-neutral graph only (spec §6.2).
import type { LocaleCode } from '../locales'
import type { NodeTypeName, StoryPackageV1 } from '../package/v1'

export interface GraphChoice {
  readonly id: string
  readonly next: string
}

export interface GraphNode {
  readonly id: string
  readonly type: NodeTypeName
  readonly choices: readonly GraphChoice[]
}

export interface Graph {
  readonly storyId: string
  readonly version: number
  readonly startNodeId: string
  readonly locales: readonly LocaleCode[]
  readonly defaultLocale: LocaleCode
  readonly nodes: ReadonlyMap<string, GraphNode>
}

export function toGraph(pkg: StoryPackageV1): Graph {
  const nodes = new Map<string, GraphNode>()
  for (const n of pkg.nodes) {
    nodes.set(n.id, { id: n.id, type: n.type, choices: n.type === 'ending' ? [] : n.choices })
  }
  return {
    storyId: pkg.storyId,
    version: pkg.version,
    startNodeId: pkg.startNodeId,
    locales: pkg.locales,
    defaultLocale: pkg.defaultLocale,
    nodes,
  }
}
