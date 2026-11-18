// Prefetch of the next pictures (Step 10e; design p1-step10-design.md D11-P22, §7; spec §6.5
// SPEC:488). After each committed part, while the run is open (never while it opens), the island
// preloads the pictures the next step can show: candidatesOf gives the distinct images of the
// current node's choice targets that are not the current image (1, or 2 at a fork, 0 at an
// ending). Each goes to ReactDOM.preload with the same srcset and sizes as its <img> (preloadOf,
// from the same ImageView), low priority, as an image, and no cross-origin mode, so the browser
// fetches the file the <img> will pick, once. React keys an image preload by srcset plus sizes,
// writes no href and appends one link per key (RR F4.5), so a repeat call (a story-language switch,
// a Back) adds nothing. A branch not taken leaves an unused preload, which Chromium reports as a
// console warning (never an error; P-IMG). Imports are relative (C15).
import { useEffect } from 'react'
import { preload } from 'react-dom'
import type { EngineState } from '../../core/engine'
import { candidatesOf, preloadOf } from '../../reader/player/images'
import type { PlayerData } from '../../reader/player/player-data'

/** Preload the candidates of the committed state while `open` (an effect, after the commit). */
export function useImagePrefetch(data: PlayerData, state: EngineState, open: boolean): void {
  useEffect(() => {
    if (!open) return
    for (const image of candidatesOf(data, state)) {
      const { href, options } = preloadOf(image)
      preload(href, options)
    }
  }, [data, state, open])
}
