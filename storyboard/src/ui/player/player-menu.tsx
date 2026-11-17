'use client'
// The player's menu (Step 10b; design p1-step10-design.md §4.1 header row 2, D11-P19, P11, P20, C13,
// F6; spec §6.1 player menu, §6.6 2.1.1, 2.5.8, 4.1.2). A disclosure, not an ARIA menu: header row 2
// holds the leading content (the progress segments) and the "Menu" button (aria-expanded,
// aria-controls="player-menu"); under it, an in-flow panel, hidden until opened, with a fieldset of
// three native text-size radios (100%, 125%, 150%) and "Start again".
// - The island owns `open` and `confirmOpen` (the restart dialog, a sibling of main): the menu stays
//   open while the dialog is open and closes only after an accepted Start again.
// - Escape closes the panel and returns focus to the Menu button. The handler is the onKeyDown of
//   the Menu button and of the panel only, never of document, window or [data-player], and it
//   returns at once while the dialog is open (F6): the dialog's own Escape (cancel, focus back on
//   this Start again) must never close the panel. The dialog is not rendered inside the panel.
// - The radios show prefs.textScale (the server snapshot, 100, while hydrating; then the stored
//   one) and write it with prefs.update; TextScaleSync applies it to <html>.
// - Start again carries the seq it was rendered with (data-seq); the island decides between the
//   dialog and an immediate RESTART. A header control: never held by a step's settle (P7); the
//   island ignores it only during the hold after a restart-dialog cancel (startAgainHeld, T-b10).
// - The Menu button is inert while the run opens, like every run control (D11-P5).
// - Fixer (review FB-2, A11Y-1): a click on Menu also focuses it, because WebKit does not focus a
//   clicked button and Escape is handled only on the button and the panel; the radio labels carry
//   the action label class, so they get the Hindi 0.12em paint offset (D11-P26).
import { useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { TEXT_SCALES, type TextScale } from '../../core/progress'
import type { PrefsStore } from '../../reader/progress'
import styles from './player.module.css'
import type { PlayerStrings } from './types'

/** The panel's id: one player per page. */
export const PLAYER_MENU_ID = 'player-menu'
/** The text-size radios' group name. */
export const TEXT_SIZE_NAME = 'text-size'

export type PlayerMenuStrings = Pick<
  PlayerStrings,
  'menu' | 'textSize' | 'textSizeOption' | 'restart'
>

export interface PlayerMenuProps {
  readonly strings: PlayerMenuStrings
  readonly prefs: Pick<PrefsStore, 'getSnapshot' | 'getServerSnapshot' | 'subscribe' | 'update'>
  /** Is the panel shown. */
  readonly open: boolean
  /** Is the restart dialog open: Escape is then the dialog's, never the menu's (F6). */
  readonly confirmOpen: boolean
  /** True while the run opens: the Menu button is inert. */
  readonly opening: boolean
  /** The seq of the part on screen, sent with Start again. */
  readonly seq: number
  /** Header row 2's leading content: the progress segments. */
  readonly leading: ReactNode
  /** The Start again button, where the restart dialog returns focus. */
  readonly restartRef: Ref<HTMLButtonElement>
  readonly onToggle: () => void
  readonly onClose: () => void
  readonly onStartAgain: (seq: number) => void
}

export function PlayerMenu({
  strings,
  prefs,
  open,
  confirmOpen,
  opening,
  seq,
  leading,
  restartRef,
  onToggle,
  onClose,
  onStartAgain,
}: PlayerMenuProps) {
  const button = useRef<HTMLButtonElement>(null)
  const { textScale } = useSyncExternalStore(
    prefs.subscribe,
    prefs.getSnapshot,
    prefs.getServerSnapshot,
  )

  // On the Menu button and the panel only (F6); the dialog's Escape never reaches either.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (confirmOpen) return
    if (event.key !== 'Escape' || !open) return
    onClose()
    button.current?.focus()
  }

  const choose = (scale: TextScale): void => {
    prefs.update({ textScale: scale })
  }

  return (
    <>
      <div className={styles.headerRow}>
        {leading}
        <button
          ref={button}
          type="button"
          data-menu=""
          aria-expanded={open}
          aria-controls={PLAYER_MENU_ID}
          inert={opening}
          className={styles.action}
          onClick={() => {
            // A click does not focus a button in WebKit; focused, the button gets the Escape that
            // its own handler and the panel's take (F6), so a menu opened by a tap closes too.
            // preventScroll: a tap on a Menu partly above the viewport must not scroll the page
            // under the finger (second review R2-STRESS-2).
            button.current?.focus({ preventScroll: true })
            onToggle()
          }}
          onKeyDown={onKeyDown}
        >
          <span className={styles.actionLabel}>{strings.menu}</span>
        </button>
      </div>
      <div id={PLAYER_MENU_ID} hidden={!open} className={styles.menuPanel} onKeyDown={onKeyDown}>
        <fieldset className={styles.textSize}>
          <legend className={styles.legend}>{strings.textSize}</legend>
          <div className={styles.options}>
            {TEXT_SCALES.map((scale) => (
              <label key={scale} className={styles.option}>
                <input
                  type="radio"
                  name={TEXT_SIZE_NAME}
                  value={scale}
                  checked={textScale === scale}
                  className={styles.radio}
                  onChange={() => choose(scale)}
                />
                <span className={styles.actionLabel}>{strings.textSizeOption[scale]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          ref={restartRef}
          type="button"
          data-restart=""
          data-seq={seq}
          className={styles.action}
          onClick={() => onStartAgain(seq)}
        >
          <span className={styles.actionLabel}>{strings.restart}</span>
        </button>
      </div>
    </>
  )
}
