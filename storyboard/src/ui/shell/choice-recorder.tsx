'use client'
// Saves the language chosen on the gate or in the header switch (P1 D8 G1; spec §6.3; design
// p1-step7-design.md §3.6, §7 items 22-24; P1-1c). Rendered by the [locale] root layout; renders
// nothing.
// - After hydration it reads window.location.search (never useSearchParams, which a prerendered
//   route would have to wrap in Suspense). Only when the query holds exactly one remember=1 does it
//   save uiLocale, then history.replaceState removes every remember parameter and keeps any other
//   query part and the hash.
// - The replaceState waits one task. React runs a parent's effects after its children's, so in the
//   hydration commit this effect runs before the App Router's own effect patches replaceState; the
//   native call would then drop Next's history state, and Back from an in-app link would change
//   the URL but leave the page on screen. One task later the patched call keeps that state and
//   updates the router's URL (design §3.6 G1: it "integrates with the Next router").
// - Opening /{code} without remember=1 never writes (spec §6.3: reads never write).
// - Storage problems never throw: the prefs store falls back to memory and the banner shows.
import { useEffect } from 'react'
import type { LocaleCode } from '../../core/locales'
import { UI_LOCALES } from '../../core/progress'
import { readerStores } from '../../reader/progress'
import { rememberTarget, withoutRemember } from '../../reader/routing'

export function ChoiceRecorder({ locale }: { readonly locale: LocaleCode }) {
  useEffect(() => {
    const uiLocale = UI_LOCALES.find((code) => code === locale)
    if (uiLocale === undefined) return
    const { pathname, search, hash } = window.location
    if (!rememberTarget(search)) return
    readerStores().prefs.update({ uiLocale })
    const cleanup = window.setTimeout(() => {
      window.history.replaceState(null, '', withoutRemember(pathname, search, hash))
    }, 0)
    return () => window.clearTimeout(cleanup)
  }, [locale])
  return null
}
