// Start again on the story landing (P1 Step 12; design p1-step12-design.md §3.9 N10, §4.5, §13.11
// item 5b; spec §6.1 landing, SPEC:434, :468). The returned function, called on the button's tap:
// 1. hold(): the navigation hold starts in the tap (src/ui/shell/nav-hold.ts), so a second tap of a
//    double tap lands on nothing while the reset and the navigation run;
// 2. await reset(): the stored run is cleared and the endings kept (progress.resetRun);
// 3. navigate(readUrl): a soft navigation to the player, which opens fresh. It runs after a
//    rejected reset too (the stores never reject; a memory store's reset still reaches the player,
//    because a soft navigation keeps the page's stores).
// A second call after the first is ignored (pending stays set: the landing leaves the page).
// Pure and framework-free; the island passes holdNavigation, the store and router.push.

export interface StartAgainOptions {
  readonly hold: () => void
  readonly reset: () => Promise<void>
  readonly navigate: (url: string) => void
  /** /{locale}/stories/{storyId}/read */
  readonly readUrl: string
}

export function createStartAgain({
  hold,
  reset,
  navigate,
  readUrl,
}: StartAgainOptions): () => Promise<void> {
  let pending = false
  return async () => {
    if (pending) return
    pending = true
    hold()
    try {
      await reset()
    } catch {
      // A failed reset still opens the player (it resumes whatever is stored).
    }
    navigate(readUrl)
  }
}
