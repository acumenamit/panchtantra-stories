// Resume and step saves (spec §6.2, §6.3; P1-4a, owner answers 2026-11-14). Pure: the engine is
// used as it is (src/core/engine is not changed) and nothing here touches storage.
import { start } from '../engine'
import type { Effect, EngineState, Graph, StepResult } from '../engine'
import type { LocaleCode } from '../locales'
import { MAX_RUN_PATH, type ActiveRun, type StepWrite } from './records'

/**
 * fresh: no saved run (or one that ends at an ending, which counts as none).
 * resumed: the stored path and language exactly.
 * adjusted: the path changed (compared element by element) or the language changed.
 */
export type ResumeOutcome = 'fresh' | 'resumed' | 'adjusted'

export interface ResumeResult {
  readonly state: EngineState
  readonly outcome: ResumeOutcome
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * The engine state to open a story with. The language is the caller's when given, otherwise the
 * stored run's, then the story default (the engine falls back to the default for any locale the
 * package lacks); the language policy itself is set at D11. The version is ignored: the engine
 * keeps the longest valid prefix of the stored path (spec §6.2).
 */
export function resumeRun(
  graph: Graph,
  stored: ActiveRun | null,
  locale?: LocaleCode,
): ResumeResult {
  const fresh = (): ResumeResult => ({
    state: start(graph, locale === undefined ? undefined : { path: [graph.startNodeId], locale }),
    outcome: 'fresh',
  })
  if (stored === null) return fresh()
  const state = start(graph, { path: stored.path, locale: locale ?? stored.locale })
  // A stored run that ends at an ending counts as no run (owner, 2026-11-14).
  if (state.status === 'ended') return fresh()
  const exact = samePath(state.path, stored.path) && state.locale === stored.locale
  return { state, outcome: exact ? 'resumed' : 'adjusted' }
}

/** The ids of the story's ending nodes, in package order. */
export function endingIdsOf(graph: Graph): string[] {
  const ids: string[] = []
  for (const node of graph.nodes.values()) if (node.type === 'ending') ids.push(node.id)
  return ids
}

type RecordEndingEffect = Extract<Effect, { type: 'recordEnding' }>

/**
 * Turns one engine step into its save, or null when there is nothing to save (a refused event,
 * or a SET_LOCALE to the language already shown, which has no effects). The run is null at an
 * ending and at the start node: a saved run means a choice made and not finished. A path longer
 * than 64 ids (only a cyclic graph, which the validator refuses, could make one) is not storable,
 * so it saves as null too.
 */
export function stepWriteOf(graph: Graph, result: StepResult): StepWrite | null {
  if (!result.accepted) return null
  const persist = result.effects.some((e) => e.type === 'persist')
  const found = result.effects.find((e): e is RecordEndingEffect => e.type === 'recordEnding')
  if (!persist && found === undefined) return null
  const { state } = result
  const atRest =
    state.status === 'ended' || state.path.length <= 1 || state.path.length > MAX_RUN_PATH
  return {
    version: state.version,
    activeRun: atRest ? null : { path: [...state.path], locale: state.locale },
    ending: found?.nodeId ?? null,
    currentEndings: endingIdsOf(graph),
  }
}
