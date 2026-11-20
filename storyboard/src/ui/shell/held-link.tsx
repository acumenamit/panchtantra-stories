'use client'
// HeldLink (P1 Step 12; design p1-step12-design.md §3.13 N14, §4.6; S12-CRIT-1, -12): next/link
// with every prop passed through unchanged, plus an onNavigate that starts the navigation hold
// (./nav-hold) and then calls the caller's onNavigate. Link calls onNavigate inside its click
// handler after its modifier-key and target checks and after preventDefault (next/dist/client/
// app-dir/link.js:51-81), so the hold starts in the same click task as the soft navigation and
// never for a click the browser handles itself (ctrl, meta, shift or alt, a middle click, another
// target). It adds no onClick. A client component, so a server component (the story card) can
// render it with plain props only: no function crosses the server-client boundary.
// Used by every Step 12 link that navigates between the shelf, a landing and the player, and by
// the player's three links to Home (header Exit, ending card All stories, error fallback).
import Link from 'next/link'
import type { ComponentProps } from 'react'
import { holdNavigation } from './nav-hold'

export function HeldLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        holdNavigation()
        onNavigate?.(event)
      }}
    />
  )
}
