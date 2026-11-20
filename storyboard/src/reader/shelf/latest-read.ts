// One progress read at a time (P1 Step 12; design p1-step12-design.md §4.2, §4.5, §13.11 item 5a).
// Home's provider (list) and the landing's actions (get) read progress once after mount and again
// on a back-forward restore; this seam keeps only the latest read's result, as the player's ending
// count does (player.tsx:290-301): a live flag (dispose) and a counter (a newer run supersedes).
// - run(): starts read(); when it resolves, apply(value, now()) if it is still the latest run and
//   the seam was not disposed. now() is read at that moment, so New is judged at the read's end.
// - A read that rejects, or throws before returning a promise, applies `empty` the same way (the
//   stores never reject, progress-store.ts; a rejection counts as nothing stored).
// - dispose(): later results apply nothing (the component unmounted).
// Pure and framework-free; imports nothing.

export interface LatestReadOptions<T> {
  readonly read: () => Promise<T>
  readonly apply: (value: T, now: number) => void
  /** What a rejected read applies. */
  readonly empty: T
  /** The clock, read when a read resolves (Date.now in the browser). */
  readonly now: () => number
}

export interface LatestRead {
  /** Starts a read; only the latest one started applies. */
  run(): void
  /** No result applies after this. */
  dispose(): void
}

export function createLatestRead<T>({ read, apply, empty, now }: LatestReadOptions<T>): LatestRead {
  let live = true
  let latest = 0
  return {
    run() {
      latest += 1
      const id = latest
      const settle = (value: T): void => {
        if (live && id === latest) apply(value, now())
      }
      new Promise<T>((resolve) => resolve(read())).then(settle, () => settle(empty))
    },
    dispose() {
      live = false
    },
  }
}
