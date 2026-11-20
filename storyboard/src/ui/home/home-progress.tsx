'use client'
// Home's progress provider (P1 Step 12; design p1-step12-design.md §3.5 N6, §3.7 N8, §4.2; spec
// §6.1 Home, SPEC:433 "computed in the browser so static pages never go stale", :468-471). One
// island around everything on Home that depends on stored progress or on today's date: Continue
// reading, the Featured hero and the list's badge cells (useContext). Its wrapper carries
// data-home-progress and data-phase (pending|ready), a test hook.
// - The server HTML and the first client render are pending (useState, never the store), so
//   hydration matches; every dependent piece shows nothing in a reserved box until the read.
// - After mount it reads progress.list() once through createLatestRead and becomes ready with the
//   entries and Date.now() taken when the read resolved; again on pageshow with persisted (a
//   back-forward-cache restore after a full load). No subscription: another tab's change never
//   swaps a card under a finger (N8). A rejected read counts as an empty list; reads never write.
// - A newer-schema record moves the store to memory on this read, so the storage banner can
//   appear after it (progress-store.ts:101-107; accepted, design E10).
// HomeProgressContext is exported so markup tests render the ready states (13.11 item 5d).
import { createContext, useEffect, useState, type ReactNode } from 'react'
import type { ProgressEntry } from '../../core/progress'
import { readerStores } from '../../reader/progress'
import { createLatestRead } from '../../reader/shelf/latest-read'

export type HomeProgressState =
  | { readonly phase: 'pending' }
  | {
      readonly phase: 'ready'
      readonly entries: readonly ProgressEntry[]
      /** Date.now() when the read resolved. */
      readonly now: number
    }

const PENDING: HomeProgressState = { phase: 'pending' }

export const HomeProgressContext = createContext<HomeProgressState>(PENDING)

export function HomeProgress({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<HomeProgressState>(PENDING)

  useEffect(() => {
    const latest = createLatestRead<readonly ProgressEntry[]>({
      read: () => readerStores().progress.list(),
      apply: (entries, now) => setState({ phase: 'ready', entries, now }),
      empty: [],
      now: () => Date.now(),
    })
    latest.run()
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) latest.run()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => {
      latest.dispose()
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  return (
    <div data-home-progress="" data-phase={state.phase}>
      <HomeProgressContext.Provider value={state}>{children}</HomeProgressContext.Provider>
    </div>
  )
}
