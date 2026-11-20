// The site's fallback og:image (design p1-step12-design.md §3.19 N19 (D25), §4.10; P1-3 Step 12b):
// the committed 512×512 "S" icon (public/icons/icon-512.png) centred at (344, 59) on a 1200×630
// canvas of the brand colour #0d0a05 (THEME_COLOR, src/ui/brand.ts), alpha-composited in integers
// as (src·a + bg·(255 − a) + 127) / 255, and encoded as a baseline JPEG at quality 90 by
// scripts/og/jpeg.ts. Build-time tooling: write-og-image.ts writes the result to
// public/og/storyboard-1200x630.jpg, which is committed; og-image.test.ts regenerates it and
// compares the sha256 (on CI, Linux, too), and e2e/social.spec.ts compares what each browser
// decodes with ogFallbackRgb(). No app code imports this module.
// Paths come from __dirname, not import.meta: Playwright loads the e2e specs as CommonJS, and a
// module that reads import.meta cannot be loaded there (e2e/player-images.spec.ts header).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEME_COLOR } from '../../src/ui/brand'
import { encodeJpeg } from './jpeg'
import { decodePng, type DecodedPng } from './png'

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
export const OG_QUALITY = 90

/** The source picture: the committed icon. */
export const ICON_FILE = join(__dirname, '..', '..', 'public', 'icons', 'icon-512.png')

/** Where write-og-image.ts writes the result (served as /og/storyboard-1200x630.jpg). */
export const OG_FILE = join(__dirname, '..', '..', 'public', 'og', 'storyboard-1200x630.jpg')

/** THEME_COLOR as [r, g, b]. */
function canvasColour(): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(THEME_COLOR)
  if (!match) throw new TypeError('og-image: THEME_COLOR is not #rrggbb')
  return [parseInt(match[1] ?? '', 16), parseInt(match[2] ?? '', 16), parseInt(match[3] ?? '', 16)]
}

/**
 * The 1200×630 RGB picture: `icon` centred on the canvas colour. The default is the committed icon,
 * the only one the og file uses. It is opaque on every pixel (design §4.10), so og-image.test.ts
 * passes a synthetic icon to reach the transparent and half-alpha cases of the composite (T12-35
 * g2; lead decision in design §21).
 */
export function ogFallbackRgb(icon: DecodedPng = decodePng(readFileSync(ICON_FILE))): Uint8Array {
  if (icon.width > OG_WIDTH || icon.height > OG_HEIGHT) {
    throw new RangeError('og-image: the icon is larger than the og picture')
  }
  const left = (OG_WIDTH - icon.width) >> 1
  const top = (OG_HEIGHT - icon.height) >> 1
  const background = canvasColour()
  const out = new Uint8Array(OG_WIDTH * OG_HEIGHT * 3)
  for (let i = 0; i < out.length; i += 3) out.set(background, i)
  for (let y = 0; y < icon.height; y++) {
    for (let x = 0; x < icon.width; x++) {
      const from = (y * icon.width + x) * 4
      const to = ((top + y) * OG_WIDTH + left + x) * 3
      const alpha = icon.rgba[from + 3] ?? 0
      for (let channel = 0; channel < 3; channel++) {
        const source = icon.rgba[from + channel] ?? 0
        const bg = background[channel] ?? 0
        out[to + channel] = Math.floor((source * alpha + bg * (255 - alpha) + 127) / 255)
      }
    }
  }
  return out
}

/** The committed fallback's bytes: ogFallbackRgb() as a baseline JPEG at quality 90. */
export function ogFallbackJpeg(): Uint8Array {
  return encodeJpeg({ width: OG_WIDTH, height: OG_HEIGHT, rgb: ogFallbackRgb() }, OG_QUALITY)
}
