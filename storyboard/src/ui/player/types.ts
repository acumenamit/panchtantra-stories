// The player's finished strings (Step 10a; design p1-step10-design.md D11-P2 PlayerStrings, §0.2).
// Types only, so client components can import them; src/ui/player/strings.ts (server-only) builds
// the values with t() in the route locale. The client never formats a message and never holds a
// template: every count-dependent string arrives pre-formatted (design S7D:390 "finished strings").

/** What the error fallback shows (D11-P17); the page passes them as PlayerBoundary props. */
export interface PlayerFallbackStrings {
  readonly errorTitle: string
  readonly startThisAgain: string
  readonly allStories: string
  readonly storageTitle: string
  readonly storageBody: string
}

export interface PlayerStrings extends PlayerFallbackStrings {
  readonly navLabel: string
  readonly grownUps: string
  /**
   * "Page n" for n = 1 to the story's node count, at index n - 1 (a path in a DAG never holds
   * more nodes than the story has; D11-P2, D11-P9).
   */
  readonly page: readonly string[]
}
