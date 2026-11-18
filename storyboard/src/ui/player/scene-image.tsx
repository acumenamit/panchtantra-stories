'use client'
// The scene image band (Step 10e; design p1-step10-design.md §4.1, §4.6, D11-P21; spec §6.5
// SPEC:486-489). Inside the story container, after the title: a box sized from the picture's own
// width and height before the file arrives (so the load never moves anything), capped at
// --scene-band-max (40svb), holding one plain <img>:
// - keyed by the image id, so each picture is a new element, React sets srcSet before src
//   (RR F4.3), and src never changes for the element's life;
// - srcSet of the WebP variants (`w` descriptors), sizes = SCENE_IMAGE_SIZES (the one constant the
//   preload uses too), src = the smallest WebP, width and height, fetchPriority high, alt "" (the
//   passage tells the scene), and no cross-origin mode: a plain image load, which the CSP's img-src
//   allows from the media origin;
// - failure: onError (the img's error event after hydration) or a rejected img.decode() in the
//   img's layout effect (an error before hydration fires no React handler; a good load resolves it
//   in both engines, probe P-IMG-B, O1). Not `complete && naturalWidth === 0`: a srcset image's
//   naturalWidth is scaled by the chosen density, so a good 1×1 stub reads 0, like an abort. A
//   rejected decode() is asked again, up to DECODE_RETRIES times, before it counts: a broken
//   picture rejects again at once, but Chromium also rejects it when it swaps the img's request
//   for another srcset file (the width or density changed while the file loaded, as when a phone
//   turns), and the asked-again decode() then resolves when the new file arrives (review
//   S10E-STRESS-1). Chromium also picks another srcset file after the load when a wider window
//   needs a larger one (a phone turns; a browser zoom is untested), and fires no error event when
//   that file fails (review R2-decode-retry-1). So the resizes of a frame start one more check in
//   that frame, with a fresh budget; it replaces the older check, which stops at its next
//   rejection. WebKit picks again after the load only when a media condition of `sizes` changes
//   (the width crosses 60rem, as when an iPad turns), and fires an error event when that file
//   fails; elsewhere the check resolves at once (review R3-ADV-2). A check that fails tells the
//   island (onFailed) once and stops every check (onError may tell it too: the island keeps each
//   id once); the island marks the image failed: data-failed hides the img (visibility hidden),
//   the box keeps its size, and the run area's scene gradient shows through the transparent box.
//   A failed picture stays failed for the visit and is not checked again. The cleanup removes the
//   resize listener and cancels a pending frame, and a rejection after it is ignored.
// The island renders no band for a node without a picture (every phase-1 package): no box.
// next/image is not used: it deletes a hand-written srcSet and `unoptimized` emits none
// (node_modules/next/dist/shared/lib/get-img-props.js:95-157); hence the one lint suppression.
// Imports are relative (C15).
import { useLayoutEffect, useRef } from 'react'
import type { ImageView } from '../../reader/player/images'
import styles from './player.module.css'

export interface SceneImageProps {
  readonly image: ImageView
  /** True once this image failed: data-failed hides it and the box stays. */
  readonly failed: boolean
  /** Called with the image id when the picture fails to load or decode; stable across renders. */
  readonly onFailed: (id: string) => void
}

/** How many times a rejected decode() is asked again before the picture counts as failed. */
const DECODE_RETRIES = 3

export function SceneImage({ image, failed, onFailed }: SceneImageProps) {
  const img = useRef<HTMLImageElement>(null)
  const { id } = image
  useLayoutEffect(() => {
    const element = img.current
    if (failed || element === null || typeof element.decode !== 'function') return
    let watching = true
    // The newest check: an older one stops at its next rejection.
    let latest = 0
    let frame = 0
    const check = (round: number, retries: number): void => {
      element.decode().catch(() => {
        if (!watching || round !== latest) return
        if (retries > 0) {
          check(round, retries - 1)
          return
        }
        stop()
        onFailed(id)
      })
    }
    // The resizes of one frame start one check in that frame, with a fresh budget.
    const recheck = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        latest += 1
        check(latest, DECODE_RETRIES)
      })
    }
    const stop = (): void => {
      watching = false
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', recheck)
    }
    check(latest, DECODE_RETRIES)
    window.addEventListener('resize', recheck)
    return stop
  }, [id, failed, onFailed])
  return (
    <div
      data-scene-band=""
      className={styles.sceneBand}
      style={{ '--img-w': image.width, '--img-h': image.height }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- spec §6.5: two pre-made WebP widths */}
      <img
        key={id}
        ref={img}
        data-scene-image=""
        data-failed={failed ? '' : undefined}
        srcSet={image.srcSet}
        sizes={image.sizes}
        src={image.src}
        width={image.width}
        height={image.height}
        fetchPriority="high"
        alt=""
        className={styles.sceneImage}
        onError={() => onFailed(id)}
      />
    </div>
  )
}
