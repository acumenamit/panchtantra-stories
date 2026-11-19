'use client'
// One part of the run: the node the reader is on (Step 10a; design p1-step10-design.md §4.1, §4.6,
// D11-P6, P8, P30; spec §6.1 "as stored", §6.6 3.1.2). The island keys it by `${runEpoch}:${seq}`,
// so each accepted step mounts a new part and the old choices unmount on commit.
// - data-story carries the content lang and dir (the run's language, which may differ from the
//   page's after a stored-first resume); every text element inside sets its own size and leading.
// - The passage is one <p> per "\n\n" paragraph, as stored (white-space: pre-wrap). The first one
//   is the focus target after a step (tabIndex -1, no ring).
// - An ending shows its passage with no question and no choices; the card follows it (10c).
// - data-animate marks a part that a step rendered (the reveal runs); data-reveal="done" ends it.
// - Step 10b (D11-P10, P7): the run footer (data-part-controls) holds Back, which is not rendered at
//   path length 1 (the engine refuses BACK there; Exit is in the header) and is shown on every
//   other part, an ending included. In-app only: no history entry. The footer sits outside the
//   story container, so it carries the page's language. It is inert while the run opens or this
//   part settles, like the choices; Back carries the seq it was rendered with, and an accepted Back
//   makes the footer inert at once on its DOM node (C28).
// - Step 10c (D11-P13, §4.1): at an ending the island passes the ending card, which renders after
//   the story container and before the run footer, so the passage stays first and the focus target.
// - Step 10e (D11-P21, §4.1): a node with a picture gets the scene image band from the island,
//   between the title and the story card; a node without one gets nothing (no box).
// - Step 11 (design p1-step11-design.md N1, N16, §4.7): when the run's language has narration the
//   island passes the narration group (NarrationControls), which the run footer holds after Back.
//   The footer then renders on every part, page 1 included (Back still only from page 2), and is
//   inert while the run opens or this part settles, like the choices, so a tap on Read to me or
//   the byline before open does nothing. With no narration the footer is exactly Step 10's.
// - Step 11 N27 (design §20.2): `held` is the hold after an applied narration tap: the choices and
//   Back (its own inert) refuse taps, while the footer, which holds the narration group, stays live
//   so a focused narration button keeps focus. Not held, the markup is exactly as before.
import { useRef, type ReactNode, type Ref } from 'react'
import type { StepResult } from '../../core/engine'
import type { PartView } from '../../reader/player/view'
import { ChoiceList } from './choice-list'
import styles from './player.module.css'

/** The question's id: one part is mounted at a time, so a fixed id is unique on the page. */
export const QUESTION_ID = 'player-question'

export interface StoryPartProps {
  readonly view: PartView
  /** False while the run is opening or this part is settling: the choices and Back are inert. */
  readonly interactive: boolean
  /** Step 11 N27: the hold after an applied narration tap: the choices and Back are inert, the
   * run footer (with the narration group) is not. */
  readonly held?: boolean
  /** True when an accepted step rendered this part (the reveal runs). */
  readonly animate: boolean
  /** True after a pointerdown or keydown ended the reveal. */
  readonly revealDone: boolean
  readonly firstParagraphRef: Ref<HTMLParagraphElement>
  readonly onChoose: (seq: number, choiceId: string) => StepResult
  /** Back's label in the page's language (player.back). */
  readonly backLabel: string
  readonly onBack: (seq: number) => StepResult
  /** Step 10c: the ending card at an ending (after the story, before the run footer). */
  readonly ending?: ReactNode
  /** Step 10e: the scene image band of a node with a picture (after the title). */
  readonly image?: ReactNode
  /** Step 11: the narration group, in the run footer after Back (none: no narration). */
  readonly narration?: ReactNode
}

export function StoryPart({
  view,
  interactive,
  held,
  animate,
  revealDone,
  firstParagraphRef,
  onChoose,
  backLabel,
  onBack,
  ending,
  image,
  narration,
}: StoryPartProps) {
  const controls = useRef<HTMLElement>(null)
  const hasQuestion = view.question !== null
  const hasBack = view.page > 1
  const hasNarration = narration !== undefined && narration !== null
  return (
    <div
      data-part=""
      data-node={view.nodeId}
      data-seq={view.seq}
      data-animate={animate ? '' : undefined}
      data-reveal={revealDone ? 'done' : undefined}
      className={styles.part}
    >
      <div data-story="" lang={view.locale} dir={view.dir} className={styles.story}>
        <h1 className={styles.title}>{view.title}</h1>
        {image}
        <div data-story-card="" className={styles.card}>
          <div data-passage="" className={styles.passage}>
            {view.paragraphs.map((paragraph, index) => (
              <p
                // Paragraphs never reorder within a part, and two may hold the same text.
                key={index}
                ref={index === 0 ? firstParagraphRef : undefined}
                tabIndex={index === 0 ? -1 : undefined}
                className={styles.paragraph}
              >
                {paragraph}
              </p>
            ))}
          </div>
          {hasQuestion ? (
            <p id={QUESTION_ID} data-question="" className={styles.question}>
              {view.question}
            </p>
          ) : null}
          {view.ending ? null : (
            <ChoiceList
              seq={view.seq}
              choices={view.choices}
              labelledBy={hasQuestion ? QUESTION_ID : undefined}
              inert={!interactive || held === true}
              onChoose={onChoose}
            />
          )}
        </div>
      </div>
      {ending}
      {hasBack || hasNarration ? (
        <footer
          ref={controls}
          data-part-controls=""
          inert={!interactive}
          className={styles.partControls}
        >
          {hasBack ? (
            <button
              type="button"
              data-back=""
              data-seq={view.seq}
              inert={held}
              className={styles.action}
              onClick={() => {
                const result = onBack(view.seq)
                if (result.accepted && controls.current !== null) controls.current.inert = true
              }}
            >
              <span className={styles.actionLabel}>{backLabel}</span>
            </button>
          ) : null}
          {narration}
        </footer>
      ) : null}
    </div>
  )
}
