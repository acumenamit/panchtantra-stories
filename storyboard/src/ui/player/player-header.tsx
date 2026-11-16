'use client'
// The player's header (Step 10a; design p1-step10-design.md §4.1 row 1, D11-P15, P16, P18; spec
// §6.6 3.2.6). In flow, never fixed or sticky. Row 1: "All stories" (the exit, next/link to
// /{locale}) at the brand's place, then the nav with Grown-ups last, as on the site pages. 10b adds
// row 2 (segments, Menu) and 10d the story-language switch before Grown-ups. Strings arrive
// finished from the server; the island scrolls this header to the top after each step (D11-P8).
import Link from 'next/link'
import type { Ref } from 'react'
import type { LocaleCode } from '../../core/locales'
import shell from '../shell/shell.module.css'

export interface PlayerHeaderProps {
  readonly locale: LocaleCode
  readonly allStories: string
  readonly navLabel: string
  readonly grownUps: string
  readonly ref?: Ref<HTMLElement>
}

export function PlayerHeader({ locale, allStories, navLabel, grownUps, ref }: PlayerHeaderProps) {
  return (
    <header ref={ref} className={shell.header}>
      <Link href={`/${locale}`} data-exit="" className={shell.link}>
        <span className={shell.label}>{allStories}</span>
      </Link>
      <nav aria-label={navLabel} className={shell.nav}>
        <Link href={`/${locale}/grown-ups`} className={shell.link}>
          <span className={shell.label}>{grownUps}</span>
        </Link>
      </nav>
    </header>
  )
}
