'use client'
// Text size after first paint (Step 10b; design p1-step10-design.md D11-P20, R23; spec §6.3 prefs,
// §6.6 resize). The boot script sets data-text-scale on <html> before the first paint; this keeps
// it in step with the prefs from then on: a radio in the player's menu, or another tab's change.
// - syncTextScale applies prefs.getSnapshot().textScale at once and on every prefs change, through
//   textScaleAttributeOf: '125' or '150' set the attribute, 100 removes it (the boot script never
//   needs to remove it; a sync back to 100 does). It never applies the hydration snapshot
//   (getServerSnapshot, always 100), which would undo the boot script's 125 or 150 at hydration.
//   It touches <html> only when the value differs, so the hydration of a page the boot script
//   already scaled makes no attribute change.
// - TextScaleSync runs it in a layout effect, so a change is applied before the next paint, and
//   unsubscribes on unmount. It renders nothing. Step 21 moves it to the root (H-21).
import { useLayoutEffect } from 'react'
import { TEXT_SCALE_ATTRIBUTE, textScaleAttributeOf } from '../../core/progress/text-scale'
import type { PrefsStore } from '../../reader/progress'

export type TextScalePrefs = Pick<PrefsStore, 'getSnapshot' | 'subscribe'>

/** Applies the stored text size to `root` now and on every prefs change; returns the unsubscribe. */
export function syncTextScale(
  prefs: TextScalePrefs,
  root: Pick<Element, 'getAttribute' | 'setAttribute' | 'removeAttribute'>,
): () => void {
  const apply = (): void => {
    const value = textScaleAttributeOf(prefs.getSnapshot().textScale)
    if (root.getAttribute(TEXT_SCALE_ATTRIBUTE) === value) return
    if (value === null) root.removeAttribute(TEXT_SCALE_ATTRIBUTE)
    else root.setAttribute(TEXT_SCALE_ATTRIBUTE, value)
  }
  apply()
  return prefs.subscribe(apply)
}

export interface TextScaleSyncProps {
  readonly prefs: TextScalePrefs
}

export function TextScaleSync({ prefs }: TextScaleSyncProps): null {
  useLayoutEffect(() => syncTextScale(prefs, document.documentElement), [prefs])
  return null
}
