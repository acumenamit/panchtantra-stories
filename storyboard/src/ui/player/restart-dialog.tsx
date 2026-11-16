'use client'
// The restart confirmation (Step 10b; design p1-step10-design.md §4.1, D11-P11, C13, F6; V1 D-71;
// spec §6.1 player, §6.6 2.1.2, 2.4.3). A native modal <dialog>, a sibling of main inside
// [data-player] (never inside the menu panel, so its Escape never reaches the menu's handler). The
// island opens it from the menu's Start again only while reading with more than 2 pages.
// - "Keep reading" comes first and takes focus when the dialog opens (the safe default); "Start
//   again" sends RESTART with the seq it was rendered with.
// - Escape (the native cancel) and Keep reading close it with no step; focus goes back to the
//   menu's Start again, which is still shown (the menu stays open, C13). The browser restores
//   focus to the element focused before showModal(); the close handler also focuses Start again,
//   because a mouse click does not focus a button in WebKit.
// - A close without an accepted Start again (Keep reading, Escape, a refused restart) also calls
//   onCancelled: the island holds the run area for SETTLE_MS like a step, because the dialog closes
//   on the first tap of a double tap and the second would land on a choice or Back under it
//   (D11-P7 amended at 10b, R2-STRESS-1).
// - An accepted Start again closes the dialog before the island commits the new run, so the run's
//   focus effect (the first paragraph) is not blocked by a modal dialog, and focus is not moved
//   back to the menu (which the accepted restart closes).
import { useLayoutEffect, useRef, type RefObject } from 'react'
import styles from './player.module.css'
import type { PlayerStrings } from './types'

/** The question's id, the dialog's name. */
export const RESTART_QUESTION_ID = 'player-restart-question'

export type RestartDialogStrings = Pick<
  PlayerStrings,
  'restartQuestion' | 'keepReading' | 'restart'
>

export interface RestartDialogProps {
  readonly strings: RestartDialogStrings
  /** Is the dialog shown (the island's confirmOpen). */
  readonly open: boolean
  /** The seq of the part on screen, sent with Start again. */
  readonly seq: number
  /** The menu's Start again: focus goes back there after a cancel. */
  readonly returnFocus: RefObject<HTMLButtonElement | null>
  /** Sends RESTART; true when the engine accepted it. */
  readonly onConfirm: (seq: number) => boolean
  /**
   * The dialog has closed without an accepted Start again (Keep reading, Escape, a refused
   * restart): the island holds the run area for SETTLE_MS (D11-P7, R2-STRESS-1). Before onClosed.
   */
  readonly onCancelled: () => void
  /** The dialog has closed, by any route. */
  readonly onClosed: () => void
}

export interface DialogCloseHandlers {
  /** Focus back to the menu's Start again. */
  readonly focusBack: () => void
  readonly onCancelled: () => void
  readonly onClosed: () => void
}

/**
 * What a close does (exported for its unit test): after a cancel (no accepted Start again), focus
 * goes back to the menu's Start again and the run area is held; after an accepted Start again,
 * neither. onClosed runs last on every route.
 */
export function dialogClosed(restarted: boolean, handlers: DialogCloseHandlers): void {
  if (!restarted) {
    handlers.focusBack()
    handlers.onCancelled()
  }
  handlers.onClosed()
}

export function RestartDialog({
  strings,
  open,
  seq,
  returnFocus,
  onConfirm,
  onCancelled,
  onClosed,
}: RestartDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const keepReading = useRef<HTMLButtonElement>(null)
  // True from an accepted Start again until the close event: no focus back to the menu then.
  const restarted = useRef(false)

  useLayoutEffect(() => {
    const element = dialog.current
    if (element === null) return
    if (open && !element.open) {
      restarted.current = false
      element.showModal()
      keepReading.current?.focus()
    } else if (!open && element.open) {
      element.close()
    }
  }, [open])

  const confirm = (): void => {
    dialog.current?.close()
    restarted.current = onConfirm(seq)
  }

  const closed = (): void => {
    const accepted = restarted.current
    restarted.current = false
    dialogClosed(accepted, {
      focusBack: () => returnFocus.current?.focus(),
      onCancelled,
      onClosed,
    })
  }

  return (
    <dialog
      ref={dialog}
      data-restart-confirm=""
      aria-labelledby={RESTART_QUESTION_ID}
      className={styles.dialog}
      onClose={closed}
    >
      <p id={RESTART_QUESTION_ID} className={styles.dialogQuestion}>
        {strings.restartQuestion}
      </p>
      <div className={styles.actions}>
        <button
          ref={keepReading}
          type="button"
          data-keep-reading=""
          className={styles.action}
          onClick={() => dialog.current?.close()}
        >
          <span className={styles.actionLabel}>{strings.keepReading}</span>
        </button>
        <button
          type="button"
          data-restart-accept=""
          data-seq={seq}
          className={styles.action}
          onClick={confirm}
        >
          <span className={styles.actionLabel}>{strings.restart}</span>
        </button>
      </div>
    </dialog>
  )
}
