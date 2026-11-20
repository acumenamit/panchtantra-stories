'use client'
// The player's header (Step 10a; design p1-step10-design.md §4.1 row 1, D11-P15, P16, P18; spec
// §6.6 3.2.6). In flow, never fixed or sticky. Row 1: "All stories" (the exit, next/link to
// /{locale}) at the brand's place, then the nav with Grown-ups last, as on the site pages. 10b adds
// row 2 (segments, Menu) and the menu panel as children, after the nav; 10d adds the
// story-language switch before Grown-ups (languageSwitch, absent for a one-language story).
// Strings arrive finished from the server; the island scrolls this header to the top after each
// step (D11-P8).
// P1 Step 12 (design p1-step12-design.md §3.12 N13, §3.13 N14; S12-CRIT-3): the exit renders through
// HeldLink (same href and markup), so a tap on it starts the navigation hold and the second tap of
// a double tap lands on nothing on Home. Grown-ups stays plain next/link (the same header place).
import Link from 'next/link'
import type { ReactNode, Ref } from 'react'
import type { LocaleCode } from '../../core/locales'
import { HeldLink } from '../shell/held-link'
import shell from '../shell/shell.module.css'

export interface PlayerHeaderProps {
  readonly locale: LocaleCode
  readonly allStories: string
  readonly navLabel: string
  readonly grownUps: string
  readonly ref?: Ref<HTMLElement>
  /** Step 10d: the story-language switch, in the nav before Grown-ups (none for one language). */
  readonly languageSwitch?: ReactNode
  /** Step 10b: header row 2 and the menu panel (PlayerMenu), after row 1. */
  readonly children?: ReactNode
}

export function PlayerHeader({
  locale,
  allStories,
  navLabel,
  grownUps,
  ref,
  languageSwitch,
  children,
}: PlayerHeaderProps) {
  return (
    <header ref={ref} className={shell.header}>
      <HeldLink href={`/${locale}`} data-exit="" className={shell.link}>
        <span className={shell.label}>{allStories}</span>
      </HeldLink>
      <nav aria-label={navLabel} className={shell.nav}>
        {languageSwitch}
        <Link href={`/${locale}/grown-ups`} className={shell.link}>
          <span className={shell.label}>{grownUps}</span>
        </Link>
      </nav>
      {children}
    </header>
  )
}
