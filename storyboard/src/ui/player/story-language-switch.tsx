'use client'
// The story-language switch (Step 10d; design p1-step10-design.md D11-P4, §4.1 row 1, §4.3, §4.6,
// §6; spec §6.2 SET_LOCALE, §6.6 3.1.2). A native button in the player header's nav, before
// Grown-ups (Tab order: All stories, this switch, Grown-ups, Menu). Its name is a visually hidden
// "Story language:" in the page's language, then the other language's endonym in its own lang and
// dir: a lang island, so it takes the site switch's endonym class (shell.module.css .switchName
// sets its size and leading from tokens, F3, and the Hindi 0.12em paint offset, D11-P26) and the
// site switch's fixed 7em width, so the endonym changing never moves Grown-ups.
// - A tap sends SET_LOCALE through the player actions: the story's language only. The engine keeps
//   the node and seq, so the part stays mounted: no reveal, no settle, no focus move and no
//   announcement; its one effect is persist (the controller saves the run in its new language;
//   activeRun is null at the start node and at an ending, SPEC:469). The chrome, <title>, URL and
//   <html lang> stay on the route locale, and uiLocale is never written. With storage blocked the
//   switch works the same (the stores fall to memory).
// - One button, never keyed by its target: the same element stays mounted when the offered
//   language changes, so the focus stays on it (D11-P4 "keyed by index"). A click also focuses it
//   (preventScroll), as Menu does (review FB-2): WebKit does not focus a clicked button, and the
//   focus must not stay on a share field the switch clears (the 10c hand-off).
// - Run-dependent (D11-P5, §4.1): hidden with the run area while a saved run opens (its endonym
//   follows the resumed run's language), and inert while the run opens, like Menu.
// Imports are relative (C15).
import { useRef } from 'react'
import type { StepResult } from '../../core/engine'
import { getLocaleDef, type LocaleCode } from '../../core/locales'
import { VisuallyHidden } from '../a11y/visually-hidden'
import shell from '../shell/shell.module.css'
import styles from './player.module.css'

export interface StoryLanguageSwitchProps {
  /** The language the switch offers (localeSwitchOf). */
  readonly target: LocaleCode
  /** "Story language:", in the page's language (player.storyLanguage). */
  readonly label: string
  /** True while the run opens: the switch is inert. */
  readonly opening: boolean
  /** SET_LOCALE: the story's language only. */
  readonly onSwitch: (locale: LocaleCode) => StepResult
}

export function StoryLanguageSwitch({
  target,
  label,
  opening,
  onSwitch,
}: StoryLanguageSwitchProps) {
  const button = useRef<HTMLButtonElement>(null)
  const { endonym, dir } = getLocaleDef(target)
  return (
    <button
      ref={button}
      type="button"
      data-story-language=""
      inert={opening}
      className={`${styles.action} ${shell.switch} ${styles.runDependent}`}
      onClick={() => {
        button.current?.focus({ preventScroll: true })
        onSwitch(target)
      }}
    >
      <VisuallyHidden>{`${label} `}</VisuallyHidden>
      <span lang={target} dir={dir} className={shell.switchName}>
        {endonym}
      </span>
    </button>
  )
}
