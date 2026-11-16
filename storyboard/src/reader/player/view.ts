// Player view helpers (Step 10a; design D11-P7, P8, P9, P25, P30). Pure and framework-free: the
// island derives what one part shows from PlayerData and the engine state, and nothing here
// formats a message or touches the DOM.
// - paragraphsOf: package text splits on "\n\n" only; each paragraph keeps single newlines and
//   spaces exactly as stored (rendered with white-space: pre-wrap; spec §6.1 "as stored").
// - partViewOf: the current node in the run's language (the content locale, which may differ
//   from the URL locale after a stored-first resume or a switch). Choice labels as stored, leading
//   emoji included. An ending has no question and no choices.
// - tokenOf: `${runEpoch}:${seq}`, the part key and the Step 11 audio token (spec §6.4).
// - pageNumberOf: the path length, the n of "Page {n}" (live region, D11-P9).
// - SETTLE_MS: run-area controls stay inert this long after each accepted step (D11-P7).
// Imports are relative (C15): Vitest has no `@/` alias.
import { currentNodeId, type EngineState, type RunStatus } from '../../core/engine'
import { getLocaleDef, type LocaleCode } from '../../core/locales'
import type { PlayerData } from './player-data'

/** Run-area controls stay inert for this long after each accepted CHOOSE, BACK or RESTART. */
export const SETTLE_MS = 500

export interface ChoiceView {
  readonly id: string
  readonly label: string
}

export interface PartView {
  /** `${runEpoch}:${seq}`: the part key and the pending-focus token. */
  readonly token: string
  readonly seq: number
  readonly runEpoch: number
  readonly status: RunStatus
  readonly nodeId: string
  /** The path length: "Page {n}". */
  readonly page: number
  /** The content locale (the run's language) and its direction. */
  readonly locale: LocaleCode
  readonly dir: 'ltr' | 'rtl'
  readonly title: string
  readonly paragraphs: readonly string[]
  /** null at an ending and when the node has no question. */
  readonly question: string | null
  /** In package order; empty at an ending. */
  readonly choices: readonly ChoiceView[]
  readonly ending: boolean
  readonly isAlternate: boolean
  readonly scene: string
  /** Endings only. */
  readonly lessonIcon: string | null
  readonly lesson: string | null
}

/** Paragraphs of a passage: split on "\n\n" only, nothing trimmed, so join("\n\n") gives it back. */
export function paragraphsOf(text: string): string[] {
  return text.split('\n\n')
}

export function tokenOf(state: Pick<EngineState, 'runEpoch' | 'seq'>): string {
  return `${state.runEpoch}:${state.seq}`
}

export function pageNumberOf(state: Pick<EngineState, 'path'>): number {
  return state.path.length
}

/** What the current part shows. Throws (ids only) if the data lacks the node or its text. */
export function partViewOf(data: PlayerData, state: EngineState): PartView {
  const nodeId = currentNodeId(state)
  const locale = state.locale
  const node = data.nodes.find((n) => n.id === nodeId)
  const localeText = Object.hasOwn(data.text, locale) ? data.text[locale] : undefined
  const text =
    localeText !== undefined && Object.hasOwn(localeText.nodes, nodeId)
      ? localeText.nodes[nodeId]
      : undefined
  if (node === undefined || localeText === undefined || text === undefined) {
    throw new Error(`player: ${data.storyId} ${locale} ${nodeId || '-'} view missing`)
  }
  const ending = node.type === 'ending'
  const choices: ChoiceView[] = []
  if (!ending) {
    for (const choice of node.choices) {
      const label = Object.hasOwn(text.choices, choice.id) ? text.choices[choice.id] : undefined
      if (label === undefined) {
        throw new Error(`player: ${data.storyId} ${locale} ${nodeId} choices.${choice.id} missing`)
      }
      choices.push({ id: choice.id, label })
    }
  }
  return {
    token: tokenOf(state),
    seq: state.seq,
    runEpoch: state.runEpoch,
    status: state.status,
    nodeId,
    page: pageNumberOf(state),
    locale,
    dir: getLocaleDef(locale).dir,
    title: localeText.title,
    paragraphs: text.paragraphs,
    question: ending ? null : text.question,
    choices,
    ending,
    isAlternate: node.isAlternate,
    scene: node.scene,
    lessonIcon: ending ? node.lessonIcon : null,
    lesson: ending ? text.lesson : null,
  }
}
