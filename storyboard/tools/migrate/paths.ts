// Enumerates every start-to-ending choice path of a story graph (used by the golden-path tests).
import type { Graph } from '../../src/core/engine'

export function allEndingPaths(g: Graph, limit = 10_000): string[][] {
  const out: string[][] = []
  const walk = (path: string[]) => {
    if (out.length >= limit) return
    const node = g.nodes.get(path[path.length - 1] ?? '')
    if (!node) return
    if (node.type === 'ending') {
      out.push(path)
      return
    }
    for (const c of node.choices) if (!path.includes(c.next)) walk([...path, c.next])
  }
  walk([g.startNodeId])
  return out
}
