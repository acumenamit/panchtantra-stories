// The player's finished strings (Step 10a; design p1-step10-design.md D11-P2 PlayerStrings, §0.2).
// Types only, so client components can import them; src/ui/player/strings.ts (server-only) builds
// the values with t() in the route locale. The client never formats a message and never holds a
// template: every count-dependent string arrives pre-formatted (design S7D:390 "finished strings").
// Step 10b adds Back, the menu (text size, Start again), the restart dialog and the progress bar.
// Step 10c adds the ending card: the lesson heading, the alternate label, the ending count (one
// finished string per count), Try another path, Share and its two statuses.
// Step 10d adds the story-language switch's visually hidden prefix.
// Step 11 (design p1-step11-design.md §0.2) adds the run footer's narration group: Read to me, the
// AI voice byline and its hidden suffix, the playback button's four labels and the status line's
// two messages (NarrationStrings).
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
  /**
   * Step 10d (D11-P4): the story-language switch's visually hidden prefix, "Story language:"
   * (the endonym follows it in its own lang).
   */
  readonly storyLanguage: string
  /** Step 11 (N2, N13): the toggle's fixed label, the byline and its visually hidden suffix. */
  readonly readToMe: string
  readonly aiVoice: string
  readonly aiVoiceAbout: string
  /** Step 11 (N2, N8, N9, N26): the playback button's four labels. */
  readonly pause: string
  readonly resume: string
  readonly playAgain: string
  readonly tapToListen: string
  /** Step 11 (N10 to N12): the status line, "Loading" and the unavailable message. */
  readonly narrationLoading: string
  readonly narrationUnavailable: string
}

/** What the narration group shows (Step 11; narration-controls.tsx). */
export type NarrationStrings = Pick<
  PlayerStrings,
  | 'readToMe'
  | 'aiVoice'
  | 'aiVoiceAbout'
  | 'pause'
  | 'resume'
  | 'playAgain'
  | 'tapToListen'
  | 'narrationLoading'
  | 'narrationUnavailable'
>
