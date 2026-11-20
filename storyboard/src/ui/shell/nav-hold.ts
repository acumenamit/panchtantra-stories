// The navigation hold (P1 Step 12; design p1-step12-design.md §3.13 N14, §4.6, §4.12; spec §6.6,
// SPEC:462; rules-block TAP-MOVED LAYOUT). A tap that navigates between the shelf, a landing and
// the player (a held link's onNavigate in src/ui/shell/held-link.tsx, Start again, the landing's
// Share) calls holdNavigation(): it sets data-nav-hold on <html> and (re)starts one module timer
// that removes it NAV_HOLD_MS after the last call. base.css then refuses pointer taps on body:
// the second tap of a double tap lands on nothing, on this page and on the next one (the <html>
// element survives soft navigations under the [locale] root layout). Nothing is announced, focus
// is not moved, and the keyboard is never held.
// The timer outlives the component that started it. The document is injectable for Vitest (the
// node environment has none); the browser passes nothing. No directive: only client files import it.

export const NAV_HOLD_ATTRIBUTE = 'data-nav-hold'
/** SPEC:462's 500 ms. */
export const NAV_HOLD_MS = 500

/** What the hold touches: the document element's attributes. */
export interface HoldDocument {
  readonly documentElement: {
    setAttribute(name: string, value: string): void
    removeAttribute(name: string): void
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

/** Holds pointer taps for NAV_HOLD_MS from now (a later call moves the end). */
export function holdNavigation(doc: HoldDocument = document): void {
  const root = doc.documentElement
  root.setAttribute(NAV_HOLD_ATTRIBUTE, '')
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    root.removeAttribute(NAV_HOLD_ATTRIBUTE)
  }, NAV_HOLD_MS)
}
