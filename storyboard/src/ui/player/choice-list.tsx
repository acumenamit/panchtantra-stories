'use client'
// The choices of one part (Step 10a; design p1-step10-design.md §4.1, D11-P7, P25; spec §6.2
// double-tap lock, §6.6 targets). Native buttons in a list, labels as stored (leading emoji and
// asterisks included).
// - Each button carries the seq it was rendered with (data-seq) and sends it with the tap, so a
//   second tap of a double tap is a stale-seq no-op in the engine.
// - `inert` while the run is opening or settling, or held after a narration tap (Step 11 N27; the
//   island decides). On an accepted tap the list
//   is made inert at once on its DOM node through a ref (C28): React state would apply only at the
//   commit that already unmounts this list. A refused tap changes nothing.
// - aria-labelledby names the question only when the node has one (the schema makes it optional).
import { useRef } from 'react'
import type { StepResult } from '../../core/engine'
import type { ChoiceView } from '../../reader/player/view'
import styles from './player.module.css'

export interface ChoiceListProps {
  /** The seq this part was rendered with. */
  readonly seq: number
  readonly choices: readonly ChoiceView[]
  /** The question's id, or undefined when the node has no question. */
  readonly labelledBy: string | undefined
  readonly inert: boolean
  readonly onChoose: (seq: number, choiceId: string) => StepResult
}

export function ChoiceList({ seq, choices, labelledBy, inert, onChoose }: ChoiceListProps) {
  const list = useRef<HTMLUListElement>(null)
  return (
    <ul
      ref={list}
      role="list"
      data-choices=""
      aria-labelledby={labelledBy}
      inert={inert}
      className={styles.choices}
    >
      {choices.map((choice) => (
        <li key={choice.id}>
          <button
            type="button"
            data-choice={choice.id}
            data-seq={seq}
            className={styles.choice}
            onClick={() => {
              const result = onChoose(seq, choice.id)
              if (result.accepted && list.current !== null) list.current.inert = true
            }}
          >
            <span className={styles.choiceLabel}>{choice.label}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
