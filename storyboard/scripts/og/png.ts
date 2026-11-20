// The PNG decoder of the og image generator (design p1-step12-design.md §4.10; P1-3 Step 12b).
// Build-time tooling under scripts/og/: no app code imports it, and it uses node:zlib only (no
// image package, design §12). It reads exactly what the committed icon needs and refuses the rest
// with a TypeError that names the field:
// - the 8-byte signature; IHDR first: 8-bit samples, colour type 6 (RGBA) or 2 (RGB), compression
//   and filter method 0, no interlace;
// - every IDAT chunk's data, concatenated and inflated (zlib.inflateSync), which must hold exactly
//   one filter byte plus width × channels bytes per row;
// - the five scanline filters of the PNG specification (§9.2): None, Sub, Up, Average, Paeth;
// - the other chunks before IEND: a suggested palette (PLTE) and ancillary chunks are skipped, but
//   tRNS, which would make pixels transparent, is refused, and so is any other critical chunk (the
//   first letter of its type upper case, PNG §5.4), a second IHDR among them (12b review round 1,
//   R1-ENC-2).
// Chunk CRCs are not read. RGB input gets alpha 255.
import { inflateSync } from 'node:zlib'

/** A decoded picture: RGBA bytes, row by row. */
export interface DecodedPng {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** The Paeth predictor (PNG specification §9.4): ties go to a, then b, then c. */
function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/** Decodes an 8-bit, non-interlaced RGBA or RGB PNG. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (file.length < 8 || SIGNATURE.some((value, index) => file[index] !== value)) {
    throw new TypeError('png: the signature is not a PNG signature')
  }
  let at = 8
  let width = 0
  let height = 0
  let channels = 0
  let sawHeader = false
  const data: Buffer[] = []
  while (at + 8 <= file.length) {
    const length = file.readUInt32BE(at)
    const type = file.toString('latin1', at + 4, at + 8)
    const body = file.subarray(at + 8, at + 8 + length)
    if (body.length !== length)
      throw new TypeError(`png: chunk ${type} runs past the end of the file`)
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw new TypeError('png: the first chunk is not IHDR')
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [bitDepth, colourType, compression, filter, interlace] = body.subarray(8, 13)
      if (bitDepth !== 8) throw new TypeError(`png: bit depth ${bitDepth} (only 8 is read)`)
      if (colourType !== 6 && colourType !== 2) {
        throw new TypeError(`png: colour type ${colourType} (only 6 and 2 are read)`)
      }
      if (compression !== 0) throw new TypeError(`png: compression method ${compression}`)
      if (filter !== 0) throw new TypeError(`png: filter method ${filter}`)
      if (interlace !== 0)
        throw new TypeError(`png: interlace method ${interlace} (only 0 is read)`)
      if (width === 0 || height === 0) throw new TypeError('png: a width or height of 0')
      channels = colourType === 6 ? 4 : 3
      sawHeader = true
    } else if (type === 'IDAT') {
      data.push(body)
    } else if (type === 'IEND') {
      break
    } else if (type === 'tRNS') {
      throw new TypeError('png: a tRNS chunk (transparency by colour key is not read)')
    } else if (type !== 'PLTE' && ((file[at + 4] ?? 0) & 0x20) === 0) {
      throw new TypeError(`png: critical chunk ${type} (not read)`)
    }
    at += 12 + length
  }
  if (!sawHeader) throw new TypeError('png: no IHDR chunk')
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(data))
  if (raw.length !== height * (stride + 1)) {
    throw new TypeError(
      `png: image data of ${raw.length} bytes, expected ${height * (stride + 1)} for the header`,
    )
  }
  const rgba = new Uint8Array(width * height * 4)
  let prior = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1)
    const filterType = raw[start] ?? 0
    const line = raw.subarray(start + 1, start + 1 + stride)
    const row = new Uint8Array(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (row[x - channels] ?? 0) : 0
      const b = prior[x] ?? 0
      const c = x >= channels ? (prior[x - channels] ?? 0) : 0
      let predictor: number
      if (filterType === 0) predictor = 0
      else if (filterType === 1) predictor = a
      else if (filterType === 2) predictor = b
      else if (filterType === 3) predictor = (a + b) >> 1
      else if (filterType === 4) predictor = paethPredictor(a, b, c)
      else throw new TypeError(`png: filter type ${filterType} on row ${y}`)
      row[x] = ((line[x] ?? 0) + predictor) & 0xff
    }
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4
      const from = x * channels
      rgba[to] = row[from] ?? 0
      rgba[to + 1] = row[from + 1] ?? 0
      rgba[to + 2] = row[from + 2] ?? 0
      rgba[to + 3] = channels === 4 ? (row[from + 3] ?? 0) : 255
    }
    prior = row
  }
  return { width, height, rgba }
}
