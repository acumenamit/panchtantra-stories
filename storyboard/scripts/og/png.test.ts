// T12-33 (design p1-step12-design.md §4.10, §13.3 T12-33; must-implement row B6; P1-3 Step 12b):
// the og image generator's PNG decoder, scripts/og/png.ts.
// - (g1) Tiny PNGs built here with zlib.deflateSync from known RGBA rows: one image per filter type
//   0-4 (every row of it filtered with that type, the first row against a zero prior row), filtered
//   by the PNG specification's formulas written out in this file; colour types 6 and 2; the
//   compressed data split across two IDAT chunks. decodePng returns the source pixels. The Paeth
//   image holds tie cases (b and c equally near, a farther), counted as a precondition, so a
//   predictor that breaks ties in another order is seen (MU12-133).
// - (g2) A TypeError naming the field for bit depth 16, colour type 3, interlace 1 and a bad
//   signature; and for image data shorter than the header says. A TypeError naming the chunk for
//   tRNS, an unknown critical chunk and a second IHDR, while an ancillary chunk (known or not) and
//   a suggested palette (PLTE) are skipped with the pixels unchanged (12b review round 1,
//   R1-ENC-2).
// - (g3) The committed public/icons/icon-512.png (filters 1, 2 and 4): 512×512, 1,048,576 RGBA
//   bytes, and their sha256 pinned. The pin was checked once against an independent decoder (the
//   Step 12b implementer's report), so it is not only this decoder's own answer.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodePng } from './png'

const STORYBOARD = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

/** One PNG chunk: length, type, data, CRC over type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

interface PngSpec {
  readonly width: number
  readonly height: number
  readonly colourType: 2 | 6
  /** Raw scanlines, one per row, each width × channels bytes. */
  readonly rows: readonly Uint8Array[]
  /** The filter type of each row. */
  readonly filters: readonly number[]
  readonly bitDepth?: number
  readonly interlace?: number
  /** Split the compressed data into this many IDAT chunks. */
  readonly idats?: number
}

/** The Paeth predictor of the PNG specification (§9.4), written out here. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/** One row filtered with `type` against `prior` (the specification's formulas, §9.2). */
function filterRow(type: number, raw: Uint8Array, prior: Uint8Array, bpp: number): Uint8Array {
  const out = new Uint8Array(raw.length + 1)
  out[0] = type
  for (let x = 0; x < raw.length; x++) {
    const a = x >= bpp ? (raw[x - bpp] ?? 0) : 0
    const b = prior[x] ?? 0
    const c = x >= bpp ? (prior[x - bpp] ?? 0) : 0
    const value = raw[x] ?? 0
    const predictor =
      type === 0
        ? 0
        : type === 1
          ? a
          : type === 2
            ? b
            : type === 3
              ? Math.floor((a + b) / 2)
              : paeth(a, b, c)
    out[x + 1] = (value - predictor) & 0xff
  }
  return out
}

/** A PNG file for `spec`. */
function buildPng(spec: PngSpec): Uint8Array {
  const channels = spec.colourType === 6 ? 4 : 3
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(spec.width, 0)
  ihdr.writeUInt32BE(spec.height, 4)
  ihdr[8] = spec.bitDepth ?? 8
  ihdr[9] = spec.colourType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = spec.interlace ?? 0
  const filtered: Uint8Array[] = []
  let prior = new Uint8Array(spec.width * channels)
  spec.rows.forEach((row, y) => {
    filtered.push(filterRow(spec.filters[y] ?? 0, row, prior, channels))
    prior = Uint8Array.from(row)
  })
  const compressed = deflateSync(Buffer.concat(filtered))
  const parts = spec.idats ?? 1
  const size = Math.ceil(compressed.length / parts)
  const idats: Uint8Array[] = []
  for (let start = 0; start < compressed.length; start += size) {
    idats.push(chunk('IDAT', compressed.subarray(start, start + size)))
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), ...idats, chunk('IEND', new Uint8Array(0))])
}

/** Deterministic bytes: a linear congruential sequence mapped onto `values`. */
function sampleRows(
  width: number,
  height: number,
  channels: number,
  values: readonly number[],
  seed: number,
): Uint8Array[] {
  let state = seed
  const rows: Uint8Array[] = []
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width * channels)
    for (let i = 0; i < row.length; i++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0
      row[i] = values[(state >>> 16) % values.length] ?? 0
    }
    rows.push(row)
  }
  return rows
}

/** The RGBA the decoder must return: the rows as they are (type 6), or with alpha 255 (type 2). */
function expectedRgba(rows: readonly Uint8Array[], colourType: 2 | 6): Uint8Array {
  if (colourType === 6) return Buffer.concat(rows)
  const out: number[] = []
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 3)
      out.push(row[i] ?? 0, row[i + 1] ?? 0, row[i + 2] ?? 0, 255)
  }
  return Uint8Array.from(out)
}

/** Paeth positions where b and c are equally near the estimate and a is farther, with b ≠ c. */
function paethTies(rows: readonly Uint8Array[], bpp: number): number {
  let ties = 0
  let prior: Uint8Array = new Uint8Array(rows[0]?.length ?? 0)
  for (const row of rows) {
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? (row[x - bpp] ?? 0) : 0
      const b = prior[x] ?? 0
      const c = x >= bpp ? (prior[x - bpp] ?? 0) : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      if (pb === pc && pa > pb && b !== c) ties++
    }
    prior = row
  }
  return ties
}

// Byte values from a small set, so the Paeth predictor meets ties often; every filter type sees the
// same kind of rows.
const VALUES = [0, 10, 20, 30, 40, 250] as const

describe('decodePng: the five filter types, colour types 6 and 2, two IDAT chunks (T12-33 g1)', () => {
  it.each([0, 1, 2, 3, 4])('(g1) filter type %i on every row returns the source RGBA', (type) => {
    const rows = sampleRows(9, 7, 4, VALUES, 17 + type)
    const png = buildPng({
      width: 9,
      height: 7,
      colourType: 6,
      rows,
      filters: rows.map(() => type),
    })
    const decoded = decodePng(png)
    expect(decoded.width, '(g1) width').toBe(9)
    expect(decoded.height, '(g1) height').toBe(7)
    expect(
      Buffer.from(decoded.rgba).equals(expectedRgba(rows, 6)),
      `(g1) filter ${type} pixels`,
    ).toBe(true)
  })

  it('(g1) the Paeth image holds ties that only the specification order resolves', () => {
    const rows = sampleRows(9, 7, 4, VALUES, 17 + 4)
    const ties = paethTies(rows, 4)
    console.log(`[png.test] Paeth tie cases (pb = pc < pa, b ≠ c): ${ties}`)
    expect(ties, 'precondition: Paeth ties in the sample').toBeGreaterThan(0)
  })

  it('(g1) mixed filters, colour type 6, data split across two IDAT chunks', () => {
    const rows = sampleRows(11, 10, 4, VALUES, 99)
    const filters = [4, 3, 2, 1, 0, 4, 2, 3, 1, 4]
    const png = buildPng({ width: 11, height: 10, colourType: 6, rows, filters, idats: 2 })
    expect(
      Buffer.from(png).toString('latin1').split('IDAT').length - 1,
      'precondition: two IDAT chunks',
    ).toBe(2)
    expect(
      Buffer.from(decodePng(png).rgba).equals(expectedRgba(rows, 6)),
      '(g1) two IDAT chunks',
    ).toBe(true)
  })

  it('(g1) colour type 2 (RGB) decodes with alpha 255', () => {
    const rows = sampleRows(6, 5, 3, VALUES, 7)
    const png = buildPng({ width: 6, height: 5, colourType: 2, rows, filters: [1, 2, 3, 4, 0] })
    const decoded = decodePng(png)
    expect(decoded.rgba.length, '(g1) RGBA length for RGB input').toBe(6 * 5 * 4)
    expect(
      Buffer.from(decoded.rgba).equals(expectedRgba(rows, 2)),
      '(g1) RGB pixels, alpha 255',
    ).toBe(true)
  })
})

describe('decodePng refuses what it does not read, naming the field (T12-33 g2)', () => {
  const good = (): Uint8Array => {
    const rows = sampleRows(4, 3, 4, VALUES, 5)
    return buildPng({ width: 4, height: 3, colourType: 6, rows, filters: [0, 1, 2] })
  }

  it('(g2) the sample decodes before any field is changed', () => {
    expect(decodePng(good()).width, 'precondition: the unchanged sample decodes').toBe(4)
  })

  /** `png` with `extra` chunks inserted right after IHDR (the 25 bytes after the signature). */
  const withChunks = (png: Uint8Array, ...extra: Uint8Array[]): Uint8Array =>
    Buffer.concat([png.subarray(0, 33), ...extra, png.subarray(33)])
  const goodRgb = (): Uint8Array => {
    const rows = sampleRows(4, 3, 3, [0, 255], 5)
    return buildPng({ width: 4, height: 3, colourType: 2, rows, filters: [0, 1, 2] })
  }
  const ihdrOf = (png: Uint8Array): Uint8Array => png.subarray(16, 29)

  it('(g2) the RGB sample decodes, and the chunk samples go in right after IHDR', () => {
    expect(decodePng(goodRgb()).width, 'precondition: the RGB sample decodes').toBe(4)
    const marked = withChunks(good(), chunk('zZZZ', Uint8Array.of(1)))
    expect(
      Buffer.from(marked.subarray(37, 41)).toString('latin1'),
      'precondition: the inserted chunk follows IHDR',
    ).toBe('zZZZ')
  })

  it.each([
    ['bit depth 16', 24, 16, /bit depth/],
    ['colour type 3', 25, 3, /colour type/],
    ['interlace 1', 28, 1, /interlace/],
    ['a bad signature', 1, 0x51, /signature/],
  ] as const)('(g2) %s throws a TypeError naming the field', (_name, offset, value, field) => {
    const png = Uint8Array.from(good())
    png[offset] = value
    expect(() => decodePng(png), `(g2) ${_name}`).toThrow(TypeError)
    expect(() => decodePng(png), `(g2) ${_name}: the message names the field`).toThrow(field)
  })

  // 12b review round 1 (R1-ENC-2): a chunk that would change the pixels is refused, never skipped.
  it.each([
    // An RGB colour key (PNG §11.3.2.1): pixels of exactly this colour would be transparent.
    [
      'a tRNS chunk',
      'tRNS',
      () => withChunks(goodRgb(), chunk('tRNS', Uint8Array.of(0, 255, 0, 0, 0, 255))),
    ],
    [
      'an unknown critical chunk',
      'ZZZZ',
      () => withChunks(good(), chunk('ZZZZ', Uint8Array.of(1))),
    ],
    ['a second IHDR', 'IHDR', () => withChunks(good(), chunk('IHDR', ihdrOf(good())))],
  ] as const)('(g2) %s throws a TypeError naming the chunk', (_name, type, build) => {
    const png = build()
    expect(() => decodePng(png), `(g2) ${_name}`).toThrow(TypeError)
    expect(() => decodePng(png), `(g2) ${_name}: the message names the chunk`).toThrow(type)
  })

  it.each([
    ['an ancillary text chunk', chunk('tEXt', Buffer.from('Title\0icon', 'latin1'))],
    ['an unknown ancillary chunk', chunk('zZZZ', Uint8Array.of(1))],
    ['a suggested palette (PLTE)', chunk('PLTE', Uint8Array.of(0, 0, 0, 255, 255, 255))],
  ] as const)('(g2) %s is skipped: the pixels are the same', (_name, extra) => {
    const plain = decodePng(good())
    const decoded = decodePng(withChunks(good(), extra))
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(plain.rgba)), `(g2) ${_name}`).toBe(true)
  })

  it('(g2) image data shorter than IHDR says throws a TypeError naming the image data', () => {
    const rows = sampleRows(4, 3, 4, VALUES, 5)
    const short = buildPng({
      width: 4,
      height: 2,
      colourType: 6,
      rows: rows.slice(0, 2),
      filters: [0, 1],
    })
    const png = Uint8Array.from(short)
    Buffer.from(png.buffer).writeUInt32BE(3, 20) // IHDR height 2 -> 3; the CRC is not read
    expect(() => decodePng(png), '(g2) short image data').toThrow(TypeError)
    expect(() => decodePng(png), '(g2) short image data: the message').toThrow(/image data/)
  })
})

describe('decodePng on the committed icon (T12-33 g3)', () => {
  it('(g3) icon-512.png: 512×512, 1,048,576 RGBA bytes, sha256 pinned', () => {
    const icon = decodePng(readFileSync(join(STORYBOARD, 'public', 'icons', 'icon-512.png')))
    expect(icon.width, '(g3) width').toBe(512)
    expect(icon.height, '(g3) height').toBe(512)
    expect(icon.rgba.length, '(g3) RGBA length').toBe(1_048_576)
    expect(createHash('sha256').update(icon.rgba).digest('hex'), '(g3) RGBA sha256').toBe(
      ICON_RGBA_SHA256,
    )
  })
})

// The RGBA bytes of public/icons/icon-512.png as decoded. When it was pinned, an independent
// decoder (libvips through sharp 0.35.5, Next's optional dependency, in a scratch one-off; never
// imported here) gave the same sha256 (Step 12b implementer report).
const ICON_RGBA_SHA256 = '48a1391598d6dcd8fd1d04e16eba063fdd01c5a6c58ddf92b48d4fc7d311ef4c'
