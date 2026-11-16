// The player's finished strings (Step 10a; design p1-step10-design.md D11-P2 PlayerStrings, §0.2).
// Types only, so client components can import them; src/ui/player/strings.ts (server-only) builds
// the values with t() in the route locale. The client never formats a message and never holds a
// template: every count-dependent string arrives pre-formatted (design S7D:390 "finished strings").
// Step 10b adds Back, the menu (text size, Start again), the restart dialog and the progress bar.
// Step 10c adds the ending card: the lesson heading, the alternate label, the ending count (one
// finished string per count), Try another path, Share and its two statuses.
import type { TextScale } from '../../core/progress'

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
  /** Step 10b (D11-P10): the run footer's Back. */
  readonly back: string
  /** Step 10b (D11-P19): the menu button, its text-size legend and its Start again. */
  readonly menu: string
  readonly textSize: string
  /** The radio label of each text size: "100%", "125%", "150%". */
  readonly textSizeOption: Readonly<Record<TextScale, string>>
  readonly restart: string
  /** Step 10b (D11-P11): the restart dialog's question and its safe default. */
  readonly restartQuestion: string
  readonly keepReading: string
  /** Step 10b (D11-P12): the progress bar's name. */
  readonly progress: string
  /**
   * The progress bar's aria-valuetext, "{filled} of {total}" for filled = 0 to the story's step
   * count, at index filled.
   */
  readonly progressValue: readonly string[]
  /**
   * Step 10c (D11-P13, P9): the ending count, "Ending {found} of {total} found" for found = 0 to
   * the story's ending count, at index found (the card and the live region).
   */
  readonly endingCount: readonly string[]
  /** Step 10c (D11-P13): the card's h2, the alternate endings' label, Try another path. */
  readonly lessonHeading: string
  readonly altEnding: string
  readonly tryAnother: string
  /** Step 10c (D11-P14): Share, its copied status (shown and announced) and the field's label. */
  readonly share: string
  readonly linkCopied: string
  readonly copyLink: string
}
