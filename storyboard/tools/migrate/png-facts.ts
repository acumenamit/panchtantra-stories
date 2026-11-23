// PNG facts for the media binder (design migration-input/p1-step17-design.md D17-4 rule 3, §3.4,
// A11; P1-9a, Step 17). Pure: bytes in, facts out; no I/O and no decoding. A file is a PNG only
// when:
// - it starts with the 8-byte signature;
// - a bounded chunk walk (each chunk's 4-byte length, at most 2^31 - 1, and its 4-letter type, data
//   and CRC inside the file) reaches IEND (no data) with nothing after it;
// - IHDR is the first chunk, exactly 13 bytes, and the only one: width and height 1 to 2^31 - 1, a
//   bit depth the colour type allows, compression and filter method 0, interlace 0 or 1.
// CRCs and pixels are not read. hasChunk compares the walked chunk types exactly (never a byte
// search, never case-folded), so `caBX` letters inside another chunk's data are not a caBX chunk.

/** The 8-byte PNG signature. */
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const MAX_UINT31 = 0x7fffffff
const CHUNK_TYPE = /^[A-Za-z]{4}$/
/** The bit depths each colour type allows (PNG §11.2.2). */
const BIT_DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

export interface PngFacts {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colourType: number
  readonly interlace: number
  /** Every chunk type in file order: IHDR first, IEND last. */
  readonly chunkTypes: readonly string[]
}

export type PngRefusal =
  | 'png-signature'
  | 'png-chunk-bounds'
  | 'png-chunk-type'
  | 'png-ihdr'
  | 'png-iend'
  | 'png-after-iend'

export type PngFactsResult =
  | { readonly ok: true; readonly facts: PngFacts }
  | { readonly ok: false; readonly reason: PngRefusal }

const refuse = (reason: PngRefusal): PngFactsResult => ({ ok: false, reason })

/** True when the bytes start with all 8 bytes of the PNG signature. */
export function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)
}

interface Ihdr {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colourType: number
  readonly interlace: number
}

/** IHDR's 13 data bytes at `at`, or null when a field is out of range. */
function readIhdr(view: DataView, at: number): Ihdr | null {
  const width = view.getUint32(at)
  const height = view.getUint32(at + 4)
  const bitDepth = view.getUint8(at + 8)
  const colourType = view.getUint8(at + 9)
  const compression = view.getUint8(at + 10)
  const filter = view.getUint8(at + 11)
  const interlace = view.getUint8(at + 12)
  if (width < 1 || width > MAX_UINT31 || height < 1 || height > MAX_UINT31) return null
  if (!(BIT_DEPTHS[colourType] ?? []).includes(bitDepth)) return null
  if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) return null
  return { width, height, bitDepth, colourType, interlace }
}

/** The PNG's facts, or the first rule it breaks. */
export function readPngFacts(bytes: Uint8Array): PngFactsResult {
  if (!hasPngSignature(bytes)) return refuse('png-signature')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunkTypes: string[] = []
  let ihdr: Ihdr | null = null
  let offset = PNG_SIGNATURE.length
  for (;;) {
    if (offset === bytes.length) return refuse('png-iend')
    if (offset + 8 > bytes.length) return refuse('png-chunk-bounds')
    const length = view.getUint32(offset)
    if (length > MAX_UINT31) return refuse('png-chunk-bounds')
    const end = offset + 12 + length
    if (end > bytes.length) return refuse('png-chunk-bounds')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (!CHUNK_TYPE.test(type)) return refuse('png-chunk-type')
    if (chunkTypes.length === 0 && type !== 'IHDR') return refuse('png-ihdr')
    if (type === 'IHDR') {
      if (ihdr !== null || length !== 13) return refuse('png-ihdr')
      ihdr = readIhdr(view, offset + 8)
      if (ihdr === null) return refuse('png-ihdr')
    }
    chunkTypes.push(type)
    offset = end
    if (type === 'IEND') {
      if (length !== 0) return refuse('png-iend')
      if (offset !== bytes.length) return refuse('png-after-iend')
      if (ihdr === null) return refuse('png-ihdr')
      return { ok: true, facts: { ...ihdr, chunkTypes } }
    }
  }
}

/** True when the bytes are a PNG (readPngFacts) holding a chunk of exactly this type. */
export function hasChunk(bytes: Uint8Array, type: string): boolean {
  const read = readPngFacts(bytes)
  return read.ok && read.facts.chunkTypes.includes(type)
}
