// Media byte checks the validator cannot see (design migration-input/p1-step14-design.md §3.14
// D14-6, D14-22, §9 L1, L2; SPEC:363 A002/A003; P1-8c, Step 14). Pure: bytes in, verdicts out.
// A002: the sha256 of a variant's own bytes equals the 64 hex of its path (never the asset id,
// which names the master, SPEC:263). A003: the bytes' magic equals the declared mime.
import type { MediaMime } from '../../src/core/content/media'
import { sha256Hex } from '../../src/core/hashing'

/** One declared variant with its asset's id (carried, never compared: D14-22). */
export interface DeclaredVariant {
  readonly assetId: string
  readonly path: string
  readonly mime: MediaMime
  readonly bytes: number
}

export type MediaCode = 'media-size' | 'media-hash' | 'media-type'

export type VariantVerdict =
  | { readonly ok: true; readonly sha256: string }
  | { readonly ok: false; readonly code: MediaCode; readonly sha256: string }

const at = (bytes: Uint8Array, offset: number, ...want: number[]): boolean =>
  want.every((value, i) => bytes[offset + i] === value)

/** RIFF, the little-endian size equal to length - 8, then WEBP (§3.14). */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  if (!at(bytes, 0, 0x52, 0x49, 0x46, 0x46) || !at(bytes, 8, 0x57, 0x45, 0x42, 0x50)) return false
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
  return size === bytes.length - 8
}

/** FF D8 FF, in a file of at least 4 bytes. */
const isJpeg = (bytes: Uint8Array): boolean => bytes.length >= 4 && at(bytes, 0, 0xff, 0xd8, 0xff)

/** An MPEG frame sync: FF, then a byte whose top three bits are set. */
const isSync = (bytes: Uint8Array, offset: number): boolean =>
  offset + 1 < bytes.length && bytes[offset] === 0xff && ((bytes[offset + 1] ?? 0) & 0xe0) === 0xe0

/**
 * An ID3v2 header (ID3, major 2, 3 or 4, four size bytes each under 0x80) followed by a frame sync
 * at 10 + size (+ 10 with the footer flag 0x10), or a frame sync at offset 0.
 */
function isMpeg(bytes: Uint8Array): boolean {
  if (bytes.length >= 10 && at(bytes, 0, 0x49, 0x44, 0x33)) {
    const major = bytes[3] ?? 0
    const size = [bytes[6] ?? 0, bytes[7] ?? 0, bytes[8] ?? 0, bytes[9] ?? 0]
    if (major < 2 || major > 4 || size.some((b) => b >= 0x80)) return false
    const length = ((size[0]! << 21) | (size[1]! << 14) | (size[2]! << 7) | size[3]!) >>> 0
    const footer = ((bytes[5] ?? 0) & 0x10) !== 0 ? 10 : 0
    return isSync(bytes, 10 + length + footer)
  }
  return isSync(bytes, 0)
}

/** The mime the bytes' header names, or null (PNG, GIF, WAV and anything else). */
export function sniffMime(bytes: Uint8Array): MediaMime | null {
  if (isWebp(bytes)) return 'image/webp'
  if (isJpeg(bytes)) return 'image/jpeg'
  if (isMpeg(bytes)) return 'audio/mpeg'
  return null
}

/** The 64 hex that starts the path's last segment, or null. */
function hexOfPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return /^([0-9a-f]{64})-/.exec(name)?.[1] ?? null
}

/**
 * The variant byte checks in order, the first failure winning (§3.14): the length equals the
 * declared bytes (`media-size`), the sha256 equals the path's 64 hex (`media-hash`, A002), the
 * sniffed mime equals the declared one (`media-type`, A003). The sha256 is always given.
 */
export async function checkVariantBytes(
  variant: DeclaredVariant,
  data: Uint8Array<ArrayBuffer>,
): Promise<VariantVerdict> {
  const sha256 = await sha256Hex(data)
  if (data.length !== variant.bytes) return { ok: false, code: 'media-size', sha256 }
  if (sha256 !== hexOfPath(variant.path)) return { ok: false, code: 'media-hash', sha256 }
  if (sniffMime(data) !== variant.mime) return { ok: false, code: 'media-type', sha256 }
  return { ok: true, sha256 }
}
