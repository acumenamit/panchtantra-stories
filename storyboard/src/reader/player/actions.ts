// Player actions (Step 10a; design §4.2 step 6, §5): the one synchronous event path from a tap to
// the engine, and the Step 11 seam (spec §6.4: the audio call runs inside the tap handler).
// - choose(seq, choiceId), back(seq), restart(seq): run-area events. While the run area is not
//   interactive (opening, or settling for SETTLE_MS after a step) they are refused here with no
//   dispatch. Otherwise they dispatch with the seq the control was rendered with (never the
//   controller's live seq), so a second tap of a double tap is a stale-seq no-op in the engine.
// - setLocale(locale): the story-language switch (10d) sits in the header, which is not settled,
//   so it is never refused here; the controller still refuses it before open().
// - Each returns the engine's result untouched. On an accepted result onAccepted(result) runs
//   synchronously before the action returns (Step 10: the island's focus, inert and ending
//   bookkeeping; Step 11: the narration call). The controller schedules the save after that.
// Framework-free. Imports are relative (C15): Vitest has no `@/` alias.
import type { EngineEvent, StepResult } from '../../core/engine'
import type { LocaleCode } from '../../core/locales'
import type { RunController } from '../progress/run-controller'

export interface PlayerActionsOptions {
  readonly controller: Pick<RunController, 'dispatch' | 'getSnapshot'>
  /** False while the run is opening or the run area is settling: run-area events are refused. */
  readonly isInteractive: () => boolean
  /** Called synchronously with every accepted result, before the action returns. */
  readonly onAccepted: (result: StepResult) => void
}

export interface PlayerActions {
  choose(seq: number, choiceId: string): StepResult
  back(seq: number): StepResult
  restart(seq: number): StepResult
  setLocale(locale: LocaleCode): StepResult
}

export function createPlayerActions(options: PlayerActionsOptions): PlayerActions {
  const { controller, isInteractive, onAccepted } = options
  if (typeof controller !== 'object' || controller === null) {
    throw new TypeError('controller is required')
  }
  if (typeof isInteractive !== 'function') throw new TypeError('isInteractive must be a function')
  if (typeof onAccepted !== 'function') throw new TypeError('onAccepted must be a function')

  function send(event: EngineEvent): StepResult {
    const result = controller.dispatch(event)
    if (result.accepted) onAccepted(result)
    return result
  }

  function runAreaEvent(event: EngineEvent): StepResult {
    if (!isInteractive()) {
      return { state: controller.getSnapshot().state, accepted: false, effects: [] }
    }
    return send(event)
  }

  return {
    choose: (seq, choiceId) => runAreaEvent({ type: 'CHOOSE', seq, choiceId }),
    back: (seq) => runAreaEvent({ type: 'BACK', seq }),
    restart: (seq) => runAreaEvent({ type: 'RESTART', seq }),
    setLocale: (locale) => send({ type: 'SET_LOCALE', locale }),
  }
}
