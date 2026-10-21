// Story engine (spec §6.2): pure TypeScript, no React, DOM, storage or timers.
// step() never throws; a rejected event returns the same state with accepted = false.
import type { LocaleCode } from '../locales'
import type { Graph, GraphNode } from './graph'

export type RunStatus = 'reading' | 'ended'

export interface EngineState {
  readonly storyId: string
  readonly version: number
  readonly locale: LocaleCode
  readonly path: readonly string[]
  readonly seq: number
  readonly runEpoch: number
  readonly status: RunStatus
}

export interface SavedRun {
  readonly path: readonly string[]
  readonly locale: string
}

export type EngineEvent =
  | { readonly type: 'CHOOSE'; readonly seq: number; readonly choiceId: string }
  | { readonly type: 'BACK'; readonly seq: number }
  | { readonly type: 'RESTART'; readonly seq: number }
  | { readonly type: 'SET_LOCALE'; readonly locale: string }

export type Effect =
  | { readonly type: 'persist' }
  | { readonly type: 'recordEnding'; readonly nodeId: string }
  | { readonly type: 'focus' }
  | { readonly type: 'audio'; readonly nodeId: string; readonly locale: LocaleCode }

export interface StepResult {
  readonly state: EngineState
  readonly accepted: boolean
  readonly effects: readonly Effect[]
}

export function currentNodeId(state: EngineState): string {
  return state.path[state.path.length - 1] ?? ''
}

function statusOf(g: Graph, nodeId: string): RunStatus {
  return g.nodes.get(nodeId)?.type === 'ending' ? 'ended' : 'reading'
}

function pickLocale(g: Graph, wanted: string | undefined): LocaleCode {
  const found = g.locales.find((l) => l === wanted)
  return found ?? g.defaultLocale
}

/** Resume = the longest valid prefix of the saved path; otherwise a fresh run at the start node. */
export function validPrefix(g: Graph, path: readonly string[]): string[] {
  const out: string[] = []
  if (path[0] !== g.startNodeId || !g.nodes.has(g.startNodeId)) return [g.startNodeId]
  out.push(g.startNodeId)
  for (let i = 1; i < path.length; i++) {
    const prev = g.nodes.get(out[out.length - 1] ?? '')
    const next = path[i]
    if (!prev || next === undefined) break
    if (!prev.choices.some((c) => c.next === next) || !g.nodes.has(next)) break
    out.push(next)
  }
  return out
}

export function start(g: Graph, saved?: SavedRun): EngineState {
  const path = saved ? validPrefix(g, saved.path) : [g.startNodeId]
  const last = path[path.length - 1] ?? g.startNodeId
  return {
    storyId: g.storyId,
    version: g.version,
    locale: pickLocale(g, saved?.locale),
    path,
    seq: 0,
    runEpoch: 0,
    status: statusOf(g, last),
  }
}

const rejected = (state: EngineState): StepResult => ({ state, accepted: false, effects: [] })

function arrive(state: EngineState, node: GraphNode): Effect[] {
  const effects: Effect[] = [{ type: 'persist' }]
  if (node.type === 'ending') effects.push({ type: 'recordEnding', nodeId: node.id })
  effects.push({ type: 'focus' }, { type: 'audio', nodeId: node.id, locale: state.locale })
  return effects
}

export function step(g: Graph, s: EngineState, e: EngineEvent): StepResult {
  switch (e.type) {
    case 'CHOOSE': {
      if (e.seq !== s.seq || s.status !== 'reading') return rejected(s)
      const node = g.nodes.get(currentNodeId(s))
      const choice = node?.choices.find((c) => c.id === e.choiceId)
      const target = choice ? g.nodes.get(choice.next) : undefined
      if (!target) return rejected(s)
      const state: EngineState = {
        ...s,
        path: [...s.path, target.id],
        seq: s.seq + 1,
        status: statusOf(g, target.id),
      }
      return { state, accepted: true, effects: arrive(state, target) }
    }
    case 'BACK': {
      if (e.seq !== s.seq || s.path.length <= 1) return rejected(s)
      const path = s.path.slice(0, -1)
      const node = g.nodes.get(path[path.length - 1] ?? '')
      if (!node) return rejected(s)
      const state: EngineState = { ...s, path, seq: s.seq + 1, status: 'reading' }
      return {
        state,
        accepted: true,
        effects: [
          { type: 'persist' },
          { type: 'focus' },
          { type: 'audio', nodeId: node.id, locale: s.locale },
        ],
      }
    }
    case 'RESTART': {
      if (e.seq !== s.seq || !g.nodes.has(g.startNodeId)) return rejected(s)
      const state: EngineState = {
        ...s,
        path: [g.startNodeId],
        seq: s.seq + 1,
        runEpoch: s.runEpoch + 1,
        status: statusOf(g, g.startNodeId),
      }
      return {
        state,
        accepted: true,
        effects: [
          { type: 'persist' },
          { type: 'focus' },
          { type: 'audio', nodeId: g.startNodeId, locale: s.locale },
        ],
      }
    }
    case 'SET_LOCALE': {
      const locale = g.locales.find((l) => l === e.locale)
      if (!locale) return rejected(s)
      if (locale === s.locale) return { state: s, accepted: true, effects: [] }
      // Same node and seq: the text swaps without a re-reveal.
      return { state: { ...s, locale }, accepted: true, effects: [{ type: 'persist' }] }
    }
    default:
      return rejected(s)
  }
}
