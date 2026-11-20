// The story shelf's rules (P1 Step 12; design p1-step12-design.md §3.2 N3, §3.4 N5, §3.6 N7,
// §4.3, §4.4; spec §6.1 Home, SPEC:433, :481). Pure and framework-free: the Home page (server) sorts
// with it, and the client islands (the badge cells, Continue reading) compute their state with it
// after the browser reads progress.
// - Structural types only ({ storyId, addedOn }), never the content reader's StorySummary: client
//   islands import this file, and a type-only import into src/content counts as a client-boundary
//   violation (client-boundary.test.ts; S12-CRIT-5). Imports are relative (C15).
// - sortShelf: addedOn descending (the legacy order, pt/src/pages/Home.js:44-50), ties by storyId
//   ascending in code units (locale-free, so the order never follows the snapshot or a collation).
// - badgeOf: one badge per card, Reading > Finished · x of y > New (V1:3941; the legacy "status
//   takes priority over NEW"). Reading: a saved run. Finished: no saved run and at least one of the
//   story's current endings found (stale ids never count, endings.ts). New: neither, and Date.now()
//   minus the UTC midnight of addedOn is at most NEW_FOR_MS, a negative difference included (the
//   legacy isNew, Home.js:37-43). A null run with no current ending (DEC:19 A7) is not started.
// - continueOf: the saved run of a listed story that byRecency puts first (highest order, then
//   storyId; records.ts), or null.
import { byRecency, type ProgressEntry, type StoryProgress } from '../../core/progress'
import { endingCountOf } from '../player/endings'

/** How long a story is New after the UTC midnight of its addedOn: 7 days. */
export const NEW_FOR_MS = 7 * 86_400_000

/** What the shelf needs of a story to place it. */
export interface ShelfStory {
  readonly storyId: string
  /** YYYY-MM-DD, as stored in the package. */
  readonly addedOn: string
}

/** addedOn descending, then storyId ascending in code units; a new array, the input unchanged. */
export function sortShelf<T extends ShelfStory>(stories: readonly T[]): T[] {
  return [...stories].sort((a, b) => {
    if (a.addedOn !== b.addedOn) return a.addedOn < b.addedOn ? 1 : -1
    if (a.storyId === b.storyId) return 0
    return a.storyId < b.storyId ? -1 : 1
  })
}

/** The UTC midnight of a YYYY-MM-DD date, in ms (NaN for any other shape). */
function utcMidnightOf(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (match === null) return Number.NaN
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** New: `now` is at most NEW_FOR_MS after the UTC midnight of addedOn (or before it). */
export function isNewStory(addedOn: string, now: number): boolean {
  return now - utcMidnightOf(addedOn) <= NEW_FOR_MS
}

/** A card's one badge, or null for none. */
export type Badge =
  | { readonly kind: 'reading' }
  | { readonly kind: 'finished'; readonly found: number }
  | { readonly kind: 'new' }
  | null

export interface BadgeInput {
  /** The story's stored progress, or null when nothing is stored for it. */
  readonly entry: Pick<StoryProgress, 'activeRun' | 'endingsFound'> | null
  /** The story's ending node ids (endingIdsOf of its graph). */
  readonly endingIds: readonly string[]
  readonly addedOn: string
  /** Date.now() when the progress read resolved. */
  readonly now: number
}

/** The badge a card shows (design §3.4). */
export function badgeOf({ entry, endingIds, addedOn, now }: BadgeInput): Badge {
  if (entry !== null && entry.activeRun !== null) return { kind: 'reading' }
  const found = entry === null ? 0 : endingCountOf(endingIds, entry.endingsFound, [])
  if (found >= 1) return { kind: 'finished', found }
  return isNewStory(addedOn, now) ? { kind: 'new' } : null
}

/** The story Continue reading shows: the most recent saved run among the listed stories, or null. */
export function continueOf(
  entries: readonly ProgressEntry[],
  listedIds: readonly string[],
): string | null {
  const listed = new Set(listedIds)
  const candidates = entries
    .filter((entry) => entry.activeRun !== null && listed.has(entry.storyId))
    .sort(byRecency)
  return candidates[0]?.storyId ?? null
}
