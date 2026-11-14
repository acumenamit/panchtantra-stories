// WCAG 2.2 contrast ratio for the token pair test (spec §6.6 "CI checks token pairs", RC-7; P1-1b).
// Pure: no I/O. Never rounds: callers compare the exact ratio with >= against the minimum, so
// 4.499:1 never meets 4.5:1.

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** Reads a `#rrggbb` colour (either case). Anything else, including `#rgb` and alpha, is a TypeError. */
export function parseHex(hex: string): Rgb {
  if (typeof hex !== 'string' || !HEX_COLOUR.test(hex)) {
    throw new TypeError(`Expected a #rrggbb colour, got ${JSON.stringify(hex)}`)
  }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

/** One sRGB channel (0-255) in linear light. */
function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.2 relative luminance of a `#rrggbb` colour: 0 for black, 1 for white. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG 2.2 contrast ratio of two `#rrggbb` colours, from 1 to 21, in either order. Unrounded. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}
