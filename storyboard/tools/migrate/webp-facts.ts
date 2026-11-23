// WebP facts for the media binder's variants (design migration-input/p1-step17-design.md D17-8,
// §3.8, CRIT-10, A12; P1-9a, Step 17). Pure: bytes in, the frame size out; no I/O and no decoding.
// A variant is accepted only in the one form the encoder makes (P6, P7): a RIFF whose size + 8 is
// the file length, the form WEBP, and exactly one `VP8 ` chunk whose size plus its pad byte (on an
// odd size) ends at the RIFF end, holding a key frame (frame-tag bit 0 clear) with show_frame 1, a
// first partition inside the chunk, the start code 9d 01 2a, and 14-bit width and height with scale
// bits 0, neither 0. Every other chunk (VP8X, VP8L, ALPH, ANIM, ANMF, EXIF, XMP, ICCP, ...) or form
// is refused, so no metadata reaches content (F2, VP8X before the frame, is not applied).

/** RIFF header (12) + chunk header (8) + frame tag (3) + start code (3) + width and height (4). */
const MIN_BYTES = 30
const START_CODE = [0x9d, 0x01, 0x2a] as const
/** The frame tag (3) + start code (3) + width and height (4): the key-frame header. */
const FRAME_HEADER_BYTES = 10

export type WebpRefusal = 'webp-riff' | 'webp-chunk' | 'webp-frame'

export type WebpFactsResult =
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: WebpRefusal }

const refuse = (reason: WebpRefusal): WebpFactsResult => ({ ok: false, reason })

const fourcc = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + 4))

/** The frame's width and height, or the first rule the bytes break. */
export function readWebpFacts(bytes: Uint8Array): WebpFactsResult {
  if (bytes.length < MIN_BYTES) return refuse('webp-riff')
  if (fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') return refuse('webp-riff')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riffEnd = view.getUint32(4, true) + 8
  if (riffEnd !== bytes.length) return refuse('webp-riff')
  if (fourcc(bytes, 12) !== 'VP8 ') return refuse('webp-chunk')
  const size = view.getUint32(16, true)
  const chunkEnd = 20 + size + (size % 2)
  if (chunkEnd !== riffEnd) return refuse('webp-chunk')
  if (size < FRAME_HEADER_BYTES) return refuse('webp-frame')
  const tag = (bytes[20] ?? 0) | ((bytes[21] ?? 0) << 8) | ((bytes[22] ?? 0) << 16)
  if ((tag & 1) !== 0) return refuse('webp-frame')
  if (((tag >>> 4) & 1) !== 1) return refuse('webp-frame')
  const firstPartition = tag >>> 5
  if (FRAME_HEADER_BYTES + firstPartition > size) return refuse('webp-frame')
  if (!START_CODE.every((b, i) => bytes[23 + i] === b)) return refuse('webp-frame')
  const widthField = view.getUint16(26, true)
  const heightField = view.getUint16(28, true)
  const width = widthField & 0x3fff
  const height = heightField & 0x3fff
  if (width !== widthField || height !== heightField) return refuse('webp-frame')
  if (width === 0 || height === 0) return refuse('webp-frame')
  return { ok: true, width, height }
}
