// T12-35 (design p1-step12-design.md §3.19 N19, §4.10, §13.3 T12-35; must-implement row B6, risk
// R4; P1-3 Step 12b): the og fallback picture, scripts/og/og-image.ts, and the committed file
// public/og/storyboard-1200x630.jpg.
// - (g1) ogFallbackRgb(): 1200 × 630 × 3 bytes; pixel (0, 0) is the canvas colour #0d0a05
//   (THEME_COLOR, src/ui/brand.ts), (13, 10, 5).
// - (g2) At an opaque icon pixel whose colour is not the canvas colour (found by scanning the
//   decoded icon), the output at (344 + x, 59 + y) is (src·a + bg·(255 − a) + 127) / 255 per
//   channel, in integers. The committed icon is opaque everywhere (alpha 255 on all 262,144
//   pixels; the canvas colour is painted into it), so it holds no transparent or half-alpha pixel.
//   Those two cases run on a synthetic 512×512 icon passed to ogFallbackRgb(icon) (lead decision,
//   design §21): an opaque pixel, a transparent pixel whose colour is not the canvas colour, and a
//   half-alpha pixel where the + 127 rounding term changes every channel. The expected values are
//   typed literals, worked by hand below.
// - (g3) ogFallbackJpeg() twice gives identical bytes, and their sha256 equals the committed
//   file's. On CI (Linux) this is the determinism probe of R4: the integer encoder must give the
//   same bytes there as on the Windows PC that wrote the file.
// - (g4) The committed file is under 100 × 1024 bytes and is a baseline JPEG: one SOF0 frame,
//   1200×630, 3 components each sampled 1×1.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ogFallbackJpeg, ogFallbackRgb } from './og-image'
import { decodePng } from './png'

const STORYBOARD = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const COMMITTED = join(STORYBOARD, 'public', 'og', 'storyboard-1200x630.jpg')
const WIDTH = 1200
const HEIGHT = 630
const LEFT = 344
const TOP = 59
const CANVAS = [13, 10, 5] as const
const SIZE_LIMIT = 100 * 1024

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

let rgbCache: Uint8Array | undefined
const rgb = (): Uint8Array => (rgbCache ??= ogFallbackRgb())

/** The output pixel at (x, y). */
function pixelAt(x: number, y: number): number[] {
  const at = (y * WIDTH + x) * 3
  return [...rgb().subarray(at, at + 3)]
}

/** The composite of one icon pixel over the canvas colour, by the design's integer formula. */
function composite(src: readonly number[], alpha: number): number[] {
  return CANVAS.map((bg, channel) =>
    Math.floor(((src[channel] ?? 0) * alpha + bg * (255 - alpha) + 127) / 255),
  )
}

describe('ogFallbackRgb (T12-35 g1, g2)', () => {
  it('(g1) is 1200 × 630 × 3 bytes with the canvas colour at (0, 0)', () => {
    expect(rgb().length, '(g1) length').toBe(WIDTH * HEIGHT * 3)
    expect(pixelAt(0, 0), '(g1) pixel (0, 0)').toEqual([13, 10, 5])
  })

  it('(g2) composites the icon at (344, 59) with (src·a + bg·(255 − a) + 127) / 255', () => {
    const icon = decodePng(readFileSync(join(STORYBOARD, 'public', 'icons', 'icon-512.png')))
    expect([icon.width, icon.height], 'precondition: the icon is 512×512').toEqual([512, 512])
    let opaque: number | undefined
    const alphas = new Set<number>()
    for (let i = 0; i < icon.width * icon.height; i++) {
      const alpha = icon.rgba[i * 4 + 3] ?? 0
      alphas.add(alpha)
      const src = [...icon.rgba.subarray(i * 4, i * 4 + 3)]
      if (alpha === 255 && opaque === undefined && src.some((v, c) => v !== CANVAS[c])) opaque = i
    }
    console.log(
      `[og-image.test] icon: opaque pixel ${opaque}; alpha values present: ${[...alphas].join(', ')}`,
    )
    expect(opaque, 'precondition: an opaque icon pixel not of the canvas colour').toBeDefined()
    const i = opaque ?? 0
    const x = i % icon.width
    const y = Math.floor(i / icon.width)
    const src = [...icon.rgba.subarray(i * 4, i * 4 + 3)]
    expect(
      pixelAt(LEFT + x, TOP + y),
      `(g2) opaque icon pixel (${x}, ${y}) at (344 + x, 59 + y)`,
    ).toEqual(composite(src, 255))
  })

  it('(g2) a synthetic icon: opaque, transparent and half-alpha pixels composite by the formula', () => {
    // 512×512 like the committed icon, so it lands at (344, 59) too. Every pixel is transparent
    // (200, 40, 160, a 0) except an opaque one at (10, 20) and a half-alpha one at (300, 400).
    const size = 512
    const rgba = new Uint8Array(size * size * 4)
    for (let i = 0; i < rgba.length; i += 4) rgba.set([200, 40, 160, 0], i)
    const put = (x: number, y: number, pixel: readonly number[]): void => {
      rgba.set(pixel, (y * size + x) * 4)
    }
    put(10, 20, [40, 200, 90, 255])
    put(300, 400, [230, 171, 200, 128])
    const out = ogFallbackRgb({ width: size, height: size, rgba })
    const at = (x: number, y: number): number[] => {
      const from = ((TOP + y) * WIDTH + LEFT + x) * 3
      return [...out.subarray(from, from + 3)]
    }
    // Half alpha, a = 128 over (13, 10, 5), per channel (src·128 + bg·127 + 127) / 255:
    //   R (230·128 + 13·127 + 127) / 255 = 31218 / 255 = 122.4 → 122 (without + 127: 121.9 → 121)
    //   G (171·128 + 10·127 + 127) / 255 = 23285 / 255 =  91.3 →  91 (without + 127:  90.8 →  90)
    //   B (200·128 +  5·127 + 127) / 255 = 26362 / 255 = 103.4 → 103 (without + 127: 102.9 → 102)
    const half = [122, 91, 103]
    expect(out.length, 'precondition: the synthetic icon gave a full picture').toBe(
      WIDTH * HEIGHT * 3,
    )
    expect(composite([230, 171, 200], 128), 'precondition: the literal is the formula').toEqual(
      half,
    )
    expect(
      [230, 171, 200].map((s, c) => Math.floor((s * 128 + (CANVAS[c] ?? 0) * 127) / 255)),
      'precondition: the half-alpha pixel is one where + 127 changes every channel',
    ).toEqual([121, 90, 102])
    expect.soft(at(10, 20), '(g2) synthetic opaque pixel (10, 20)').toEqual([40, 200, 90])
    expect
      .soft(at(0, 0), '(g2) synthetic transparent pixel (0, 0): the canvas colour, not its own')
      .toEqual([13, 10, 5])
    expect.soft(at(300, 400), '(g2) synthetic half-alpha pixel (300, 400)').toEqual(half)
  })
})

describe('ogFallbackJpeg and the committed file (T12-35 g3, g4)', () => {
  it('(g3) two runs give identical bytes, equal to the committed public/og file', () => {
    const first = ogFallbackJpeg()
    const second = ogFallbackJpeg()
    console.log(`[og-image.test] generated: ${first.length} bytes, sha256 ${sha256(first)}`)
    expect
      .soft(Buffer.from(first).equals(Buffer.from(second)), '(g3) two runs, identical bytes')
      .toBe(true)
    expect
      .soft(sha256(first), '(g3) sha256 equals the committed file')
      .toBe(sha256(readFileSync(COMMITTED)))
  })

  it('(g4) the committed file is under 100 KB and one baseline SOF0 frame, 1200×630, 3 × 1×1', () => {
    const bytes = readFileSync(COMMITTED)
    console.log(`[og-image.test] committed: ${bytes.length} bytes (limit ${SIZE_LIMIT})`)
    expect.soft(bytes.length, '(g4) size under 100 × 1024 bytes').toBeLessThan(SIZE_LIMIT)
    const frames: number[] = []
    let sof: Uint8Array | undefined
    let at = 2
    while (at + 4 <= bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1] ?? 0
      const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        frames.push(marker)
        sof ??= bytes.subarray(at + 4, at + 2 + length)
      }
      if (marker === 0xda) break
      at += 2 + length
    }
    expect.soft(frames, '(g4) exactly one frame header, SOF0 (baseline)').toEqual([0xc0])
    const data = [...(sof ?? [])]
    expect
      .soft(
        [(data[1] ?? 0) * 256 + (data[2] ?? 0), (data[3] ?? 0) * 256 + (data[4] ?? 0)],
        '(g4) height and width',
      )
      .toEqual([630, 1200])
    expect
      .soft(data.slice(5), '(g4) 3 components, each 1×1')
      .toEqual([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])
  })
})
