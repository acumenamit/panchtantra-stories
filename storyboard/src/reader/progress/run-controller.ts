// Run controller (spec §6.2-§6.4; P1-4a, owner answers 2026-11-14): the engine adapter for one
// story in the player. Framework-free; getSnapshot/subscribe fit React's useSyncExternalStore.
// - open() reads the stored entry once and resumes through the engine's start(). It never writes,
//   even when the resume trimmed the path or changed the language, and it never rejects.
// - Events before open() resolves are refused (accepted false, no effects); the UI keeps choices
//   inert until then (Step 10).
// - dispatch() returns the engine's result untouched (seq, focus and audio effects included). The
//   controller acts only on persist and recordEnding: one save per accepted step, run and ending
//   together, scheduled after dispatch returns (a microtask by default), so the tap's synchronous
//   audio call always runs first (spec §6.4). The save is never awaited inside dispatch.
// - The run is held here: another tab's change never alters an open run; this tab's next save
//   overwrites it (the latest run wins).
// - The store is injected, so a preview can pass a memory-only store.
// - The language on open follows localePolicy (Step 10, D11-P3): 'caller' (the default, the Step 5
//   behaviour) or 'stored-first' for the player (openRun in src/core/progress/resume.ts), which
//   needs the URL locale. The snapshot before open() is the start node in that locale either way.
// - A subscriber that throws never makes dispatch() throw (the caller still gets the engine's
//   audio effect, spec §6.4), never rejects open() and never stops the others (listeners.ts).
import { start, step } from '../../core/engine'
import type { EngineEvent, EngineState, Graph, StepResult } from '../../core/engine'
import { isLocaleCode, type LocaleCode } from '../../core/locales'
import {
  openRun,
  resumeRun,
  stepWriteOf,
  type ActiveRun,
  type ResumeOutcome,
  type ResumeResult,
  type StepWrite,
} from '../../core/progress'
import {
  assertListener,
  callListeners,
  rethrowLater,
  type ListenerErrorReporter,
} from './listeners'
import type { ProgressStore } from './progress-store'

export type RunPhase = 'opening' | 'open'

/** How open() picks the run's language (Step 10, D11-P3). */
export type LocalePolicy = 'caller' | 'stored-first'

export interface RunSnapshot {
  /** 'opening' until open() resolves; events are refused until then. */
  readonly phase: RunPhase
  /** Before open() resolves: the fresh start state (caller's language, else the story default). */
  readonly state: EngineState
  /** null until open() resolves. */
  readonly outcome: ResumeOutcome | null
}

export interface RunControllerOptions {
  readonly graph: Graph
  readonly store: Pick<ProgressStore, 'get' | 'saveStep'>
  /**
   * The caller's language. With localePolicy 'caller' it wins over the stored run's, which wins
   * over the story default. With 'stored-first' it is required.
   */
  readonly locale?: LocaleCode
  /**
   * 'caller' (default): as above. 'stored-first' (the player): the stored run's language when the
   * graph has it, else `locale`; a fresh run always takes `locale` (openRun, resume.ts).
   */
  readonly localePolicy?: LocalePolicy
  /** Runs a save after dispatch returns. Defaults to queueMicrotask. */
  readonly schedule?: (task: () => void) => void
  /** Receives an error a subscriber threw. Defaults to rethrowing it after the current call. */
  readonly onListenerError?: ListenerErrorReporter
}

export interface RunController {
  /** Reads the stored entry once and resumes. The same promise on every call; never rejects. */
  open(): Promise<ResumeResult>
  /** The engine's step, or a refusal before open() resolves. Never awaits the save. */
  dispatch(event: EngineEvent): StepResult
  getSnapshot(): RunSnapshot
  /** Called when the snapshot changes. A listener that is not a function is a TypeError. */
  subscribe(listener: () => void): () => void
}

function defaultSchedule(task: () => void): void {
  queueMicrotask(task)
}

export function createRunController(options: RunControllerOptions): RunController {
  const { graph, store, locale } = options
  if (typeof graph !== 'object' || graph === null) throw new TypeError('graph is required')
  if (typeof store !== 'object' || store === null) throw new TypeError('store is required')
  if (locale !== undefined && !isLocaleCode(locale)) {
    throw new TypeError('locale must be a registered locale code')
  }
  const schedule = options.schedule ?? defaultSchedule
  if (typeof schedule !== 'function') throw new TypeError('schedule must be a function')
  const onListenerError = options.onListenerError ?? rethrowLater
  if (typeof onListenerError !== 'function') {
    throw new TypeError('onListenerError must be a function')
  }
  const localePolicy = options.localePolicy ?? 'caller'
  if (localePolicy !== 'caller' && localePolicy !== 'stored-first') {
    throw new TypeError('localePolicy must be "caller" or "stored-first"')
  }
  if (localePolicy === 'stored-first' && locale === undefined) {
    throw new TypeError('localePolicy "stored-first" needs a locale')
  }
  const resume = (stored: ActiveRun | null): ResumeResult =>
    localePolicy === 'stored-first' && locale !== undefined
      ? openRun(graph, stored, locale)
      : resumeRun(graph, stored, locale)

  const listeners = new Set<() => void>()
  const initial = start(
    graph,
    locale === undefined ? undefined : { path: [graph.startNodeId], locale },
  )
  let snapshot: RunSnapshot = Object.freeze({ phase: 'opening', state: initial, outcome: null })
  let opening: Promise<ResumeResult> | null = null

  function notify(): void {
    callListeners(listeners, onListenerError)
  }

  async function load(): Promise<ResumeResult> {
    let stored: ActiveRun | null = null
    try {
      stored = (await store.get(graph.storyId))?.activeRun ?? null
    } catch {
      // A store that rejects (it should not) opens the story fresh rather than failing the page.
      stored = null
    }
    let result: ResumeResult
    try {
      result = resume(stored)
    } catch {
      // Only a malformed entry from an injected store could get here.
      result = resume(null)
    }
    snapshot = Object.freeze({ phase: 'open', state: result.state, outcome: result.outcome })
    return result
  }

  function open(): Promise<ResumeResult> {
    if (opening === null) {
      opening = load()
      // Subscribers hear about it separately; notify() never throws (listeners.ts).
      void opening.then(notify)
    }
    return opening
  }

  function save(write: StepWrite): void {
    schedule(() => {
      void store.saveStep(graph.storyId, write)
    })
  }

  function dispatch(event: EngineEvent): StepResult {
    if (snapshot.phase !== 'open') return { state: snapshot.state, accepted: false, effects: [] }
    const result = step(graph, snapshot.state, event)
    const changed = result.state !== snapshot.state
    if (changed) snapshot = Object.freeze({ ...snapshot, state: result.state })
    const write = stepWriteOf(graph, result)
    if (write !== null) save(write)
    if (changed) notify()
    return result
  }

  function subscribe(listener: () => void): () => void {
    assertListener(listener)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return { open, dispatch, getSnapshot: () => snapshot, subscribe }
}
