// The page's one polite live region (spec §6.6 4.1.3; design p1-step7-design.md §3.12 #13, §7
// item 30; P1-1c). announce(text) empties the region, then sets the text on the next animation
// frame, so the same text can be announced twice. Browser only; a page without the region (the
// gate, Coming soon, the 404) announces nothing.

/** The id of the region that src/ui/a11y/live-region.tsx renders at the end of main. */
export const LIVE_REGION_ID = 'live-region'

export function announce(text: string): void {
  const region = document.getElementById(LIVE_REGION_ID)
  if (region === null) return
  region.textContent = ''
  requestAnimationFrame(() => {
    region.textContent = text
  })
}
