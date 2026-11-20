// The player's saved-run hint, set in the tap (P1 Step 12 round 1b; design p1-step12-design.md §16
// F1, H-12c; spec SPEC:468, the lead's edit E11). The player page's inline first-paint script
// (src/core/progress/saved-run-hint.ts) sets html[data-saved-run] on a hard load only, so a soft
// navigation into a player that resumes a saved run would paint the start passage for one opening
// frame. Every held link into the player calls markSavedRun in HeldLink's onNavigate, before the soft
// navigation starts: the landing's Continue (a saved run is known), the landing's Start in every
// state (round 2b, §19: a run saved in another tab after the landing's one read still resumes, N8),
// and Home's Continue card (always a saved run).
// - It may over-report (saved-run-hint.ts:6-7: the hint only hides the run area until open()); on a
//   fresh Start the run area is hidden for the opening frames and shows from open().
// - Nothing here removes it, and no unmount of Home or the landing does (that cleanup would run in
//   the same commit, before the player's first paint): the player's layout effects remove it at
//   open and on unmount (player.tsx:359-363), and the CSS failsafe shows the parts if open() never
//   runs. No directive: only client files import it.
import { SAVED_RUN_ATTRIBUTE } from '../../core/progress/saved-run-hint'

/** Sets html[data-saved-run] (an onNavigate handler: the event is not read). */
export function markSavedRun(): void {
  document.documentElement.setAttribute(SAVED_RUN_ATTRIBUTE, '')
}
