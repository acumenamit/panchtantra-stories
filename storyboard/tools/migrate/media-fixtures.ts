// Synthetic media for the Step 17 tests (design migration-input/p1-step17-design.md §8, 14.1,
// TP17-16; P1-9a, Step 17): PNG, VP8 WebP and MP3 bytes made in memory with node:zlib and
// node:crypto only, so no test needs an image package. A test helper: imported by test files only,
// never by product code.
// - pngOf: the PNG signature, IHDR, the given chunks, one IDAT (deflateSync of filtered rows), IEND,
//   every CRC from node:zlib crc32. The rows are never interlaced, whatever IHDR says: png-facts
//   reads chunks, never pixels.
// - vp8Of: RIFF/WEBP and one `VP8 ` key frame (show_frame 1, a bounded first partition, the start
//   code 9d 01 2a, 14-bit width and height, seed bytes, the pad byte on an odd size), plus the
//   planted forms webp-facts must refuse. The frame is a header and seed bytes, not a decodable
//   picture.
// - mp3Frames: MPEG-2 layer III frames at 48 kbps, 24 kHz, mono (parler-pipeline.test.ts's form),
//   144 bytes each, 24 ms each.
import { createHash } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0))

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** `n` deterministic bytes for a seed (sha256 of `<seed>:<counter>`, chained). */
export function seedBytes(seed: string | number, n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n)
  for (let counter = 0, offset = 0; offset < n; counter++) {
    const block = createHash('sha256').update(`${seed}:${counter}`).digest()
    out.set(block.subarray(0, Math.min(block.length, n - offset)), offset)
    offset += block.length
  }
  return out
}

const u32be = (value: number): Uint8Array => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0, false)
  return out
}
const u32le = (value: number): Uint8Array => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0, true)
  return out
}

// ---- PNG ----

/** The 8-byte PNG signature. */
export const PNG_SIGNATURE_BYTES: Uint8Array<ArrayBuffer> = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
)

/** One PNG chunk: the big-endian data length, the 4-letter type, the data, the CRC of type and data. */
export function pngChunk(
  type: string,
  data: Uint8Array = new Uint8Array(0),
): Uint8Array<ArrayBuffer> {
  const typeBytes = ascii(type)
  return concat([u32be(data.length), typeBytes, data, u32be(crc32(concat([typeBytes, data])))])
}

/** IHDR's 13 data bytes; compression and filter method 0. */
export function ihdrData(o: {
  readonly width: number
  readonly height: number
  readonly bitDepth?: number
  readonly colourType?: number
  readonly interlace?: number
}): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(13)
  const view = new DataView(out.buffer)
  view.setUint32(0, o.width >>> 0)
  view.setUint32(4, o.height >>> 0)
  out[8] = o.bitDepth ?? 8
  out[9] = o.colourType ?? 2
  out[12] = o.interlace ?? 0
  return out
}

/**
 * A bare big-endian TIFF block with one IFD entry: Orientation (0x0112, SHORT, count 1). The form
 * of the legacy masters' zTXt "Raw profile type APP1" (no `Exif\0\0` prefix, P5) and of an eXIf
 * chunk.
 */
export function tiffOrientation(orientation: number): Uint8Array<ArrayBuffer> {
  const header = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]
  const entry = [0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 0xff, 0, 0]
  return Uint8Array.from([...header, 0x00, 0x01, ...entry, 0x00, 0x00, 0x00, 0x00])
}

/** ImageMagick's raw profile text: `\nAPP1\n<length, width 8>\n<hex, 72 per line>\n`. */
function rawProfileText(block: Uint8Array): string {
  const hex = Buffer.from(block).toString('hex')
  const lines = hex.match(/.{1,72}/g) ?? []
  return `\nAPP1\n${String(block.length).padStart(8)}\n${lines.join('\n')}\n`
}

/** The named chunks pngOf can add, each with a default body. */
export type NamedPngChunk = 'sBIT' | 'zTXt' | 'caBX' | 'eXIf'

export interface PngChunkSpec {
  readonly type: string
  readonly data: Uint8Array
}

export interface PngOptions {
  readonly width: number
  readonly height: number
  /** 2 (RGB, the default) or 6 (RGBA). */
  readonly colourType?: 2 | 6
  /** Written into IHDR as given (the rows are never interlaced). */
  readonly interlace?: 0 | 1
  /** Chunks between IHDR and IDAT, in order: a named chunk with its default body, or any chunk. */
  readonly chunks?: readonly (NamedPngChunk | PngChunkSpec)[]
  /** Varies the pixels (the first row holds seed bytes), so two seeds give two sha256. */
  readonly seed?: string | number
  /** The Orientation value in the default zTXt and eXIf bodies (default 1). */
  readonly orientation?: number
}

function namedChunk(name: NamedPngChunk, o: PngOptions): Uint8Array<ArrayBuffer> {
  const channels = o.colourType === 6 ? 4 : 3
  const orientation = o.orientation ?? 1
  switch (name) {
    case 'sBIT':
      return pngChunk('sBIT', new Uint8Array(channels).fill(8))
    case 'zTXt':
      return pngChunk(
        'zTXt',
        concat([
          ascii('Raw profile type APP1'),
          Uint8Array.of(0, 0),
          deflateSync(ascii(rawProfileText(tiffOrientation(orientation)))),
        ]),
      )
    case 'caBX':
      // A JUMBF superbox header and a short label: a stand-in for the C2PA manifest store.
      return pngChunk('caBX', concat([u32be(24), ascii('jumb'), u32be(16), ascii('jumdc2pa-test')]))
    case 'eXIf':
      return pngChunk('eXIf', tiffOrientation(orientation))
  }
}

/** A gradient picture whose first row holds seed bytes, filter type 0 on every row. */
function rawRows(o: PngOptions): Uint8Array<ArrayBuffer> {
  const channels = o.colourType === 6 ? 4 : 3
  const stride = o.width * channels + 1
  const out = new Uint8Array(stride * o.height)
  const first = seedBytes(o.seed ?? 0, o.width * channels)
  for (let y = 0; y < o.height; y++) {
    const row = y * stride
    for (let x = 0; x < o.width; x++) {
      const at = row + 1 + x * channels
      if (y === 0) {
        out.set(first.subarray(x * channels, (x + 1) * channels), at)
      } else {
        out[at] = (x * 255) / Math.max(1, o.width - 1)
        out[at + 1] = (y * 255) / Math.max(1, o.height - 1)
        out[at + 2] = ((x + y) * 127) / Math.max(1, o.width + o.height - 2)
      }
      if (channels === 4) out[at + 3] = 255
    }
  }
  return out
}

/** A complete PNG: signature, IHDR, the given chunks, one IDAT, IEND. */
export function pngOf(o: PngOptions): Uint8Array<ArrayBuffer> {
  const chunks = (o.chunks ?? []).map((chunk) =>
    typeof chunk === 'string' ? namedChunk(chunk, o) : pngChunk(chunk.type, chunk.data),
  )
  return concat([
    PNG_SIGNATURE_BYTES,
    pngChunk(
      'IHDR',
      ihdrData({
        width: o.width,
        height: o.height,
        colourType: o.colourType ?? 2,
        interlace: o.interlace ?? 0,
      }),
    ),
    ...chunks,
    pngChunk('IDAT', deflateSync(rawRows(o))),
    pngChunk('IEND'),
  ])
}

// ---- VP8 WebP ----

/** One RIFF chunk: the fourcc, the little-endian data length, the data, a zero pad byte on an odd length. */
export function riffChunk(fourcc: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const pad = data.length % 2 === 1 ? Uint8Array.of(0) : new Uint8Array(0)
  return concat([ascii(fourcc), u32le(data.length), data, pad])
}

export interface Vp8Options {
  readonly width: number
  readonly height: number
  readonly seed?: string | number
  /** Seed bytes after the 10-byte frame header (default 32): an odd count gives an odd chunk size. */
  readonly payloadBytes?: number
  /** false sets frame-tag bit 0 (an inter frame). */
  readonly keyFrame?: boolean
  /** false clears show_frame. */
  readonly showFrame?: boolean
  readonly startCode?: readonly [number, number, number]
  /** The top two bits of the width and height fields (default 0). */
  readonly widthScale?: number
  readonly heightScale?: number
  /** first_part_size (default: the payload length, so the partition ends at the chunk end). */
  readonly firstPartSize?: number
  /** RIFF chunks before and after the VP8 chunk. */
  readonly before?: readonly { readonly fourcc: string; readonly data: Uint8Array }[]
  readonly after?: readonly { readonly fourcc: string; readonly data: Uint8Array }[]
  /** 2 writes the VP8 chunk twice. */
  readonly vp8Chunks?: 1 | 2
  /** 'none': an odd chunk without its pad byte; 'extra': an even chunk with a pad byte. */
  readonly pad?: 'auto' | 'none' | 'extra'
  /** Added to the VP8 chunk's size field (a size past the RIFF end). */
  readonly chunkSizeDelta?: number
  /** Added to the RIFF size field. */
  readonly riffSizeDelta?: number
  /** Zero bytes after the RIFF end. */
  readonly trailing?: number
  readonly riffTag?: string
  readonly formTag?: string
}

/** The VP8 chunk's data: frame tag, start code, width, height, seed bytes. */
function vp8Data(o: Vp8Options): Uint8Array<ArrayBuffer> {
  const payload = seedBytes(o.seed ?? 0, o.payloadBytes ?? 32)
  const firstPart = o.firstPartSize ?? payload.length
  const tag =
    (o.keyFrame === false ? 1 : 0) | ((o.showFrame === false ? 0 : 1) << 4) | (firstPart << 5)
  const header = new Uint8Array(10)
  const view = new DataView(header.buffer)
  header[0] = tag & 0xff
  header[1] = (tag >>> 8) & 0xff
  header[2] = (tag >>> 16) & 0xff
  header.set(o.startCode ?? [0x9d, 0x01, 0x2a], 3)
  view.setUint16(6, ((o.widthScale ?? 0) << 14) | o.width, true)
  view.setUint16(8, ((o.heightScale ?? 0) << 14) | o.height, true)
  return concat([header, payload])
}

/** A one-frame lossy WebP (or one of its planted forms). */
export function vp8Of(o: Vp8Options): Uint8Array<ArrayBuffer> {
  const data = vp8Data(o)
  const pad = o.pad ?? 'auto'
  const padByte =
    (pad === 'auto' && data.length % 2 === 1) || pad === 'extra'
      ? Uint8Array.of(0)
      : new Uint8Array(0)
  const vp8 = concat([ascii('VP8 '), u32le(data.length + (o.chunkSizeDelta ?? 0)), data, padByte])
  const chunks = [
    ...(o.before ?? []).map((c) => riffChunk(c.fourcc, c.data)),
    vp8,
    ...(o.vp8Chunks === 2 ? [vp8] : []),
    ...(o.after ?? []).map((c) => riffChunk(c.fourcc, c.data)),
  ]
  const body = concat([ascii(o.formTag ?? 'WEBP'), ...chunks])
  return concat([
    ascii(o.riffTag ?? 'RIFF'),
    u32le(body.length + (o.riffSizeDelta ?? 0)),
    body,
    new Uint8Array(o.trailing ?? 0),
  ])
}

/** A VP8X chunk's 10 data bytes: flags, 3 reserved bytes, canvas width - 1 and height - 1 (24-bit LE). */
export function vp8xData(flags: number, width: number, height: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(10)
  out[0] = flags
  out.set([(width - 1) & 0xff, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff], 4)
  out.set([(height - 1) & 0xff, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff], 7)
  return out
}

// ---- MP3 ----

/** One frame's length at 48 kbps and 24 kHz (MPEG-2 layer III: 72 * bitrate / rate). */
export const MP3_FRAME_BYTES = 144
/** One frame's duration: 576 samples at 24 kHz. */
export const MP3_FRAME_MS = 24

/**
 * `frames` MPEG-2 layer III frames (48 kbps, 24 kHz, mono, no CRC), each a 4-byte header and seed
 * bytes below 0x40 (never a frame sync and never a letter, so no "Xing" or "Info" tag).
 */
export function mp3Frames(frames: number, seed: string | number = 0): Uint8Array<ArrayBuffer> {
  const fill = seedBytes(`mp3:${seed}`, frames * MP3_FRAME_BYTES)
  const out = new Uint8Array(frames * MP3_FRAME_BYTES)
  for (let i = 0; i < frames; i++) {
    const at = i * MP3_FRAME_BYTES
    for (let j = 4; j < MP3_FRAME_BYTES; j++) out[at + j] = (fill[at + j] ?? 0) & 0x3f
    out.set([0xff, 0xf3, (6 << 4) | (1 << 2), 3 << 6], at)
  }
  return out
}
