// A silent MP3 built by code, for tests and the staging harness only (design
// p1-step11-design.md §3.23 N23, §9 A26; P1-5a): no download, no real clip. Each frame is
// MPEG-2 Layer III, 24 kHz, 48 kbps, mono, no CRC, no padding: the header FF F3 64 C4, then 140
// zero bytes (zero side info and an empty body, which decodes as silence). One frame is 576
// samples, so 42 frames are 6,048 bytes and 1,008 ms (probe PR-1, read back by
// tools/narration/mp3.ts). Imports nothing, so a spec may load it.

/** The 4 header bytes of every frame: sync, MPEG-2, Layer III, no CRC; 48 kbps, 24 kHz; mono. */
const FRAME_HEADER = [0xff, 0xf3, 0x64, 0xc4] as const

/** One frame's length: floor(576 / 8 × 48,000 / 24,000) = 144 bytes, no padding. */
export const SILENT_MP3_FRAME_BYTES = 144

/** `frames` silent frames (a whole number from 0). */
export function silentMp3(frames: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(frames) || frames < 0) {
    throw new Error('silentMp3: frames must be a whole number from 0')
  }
  const bytes = new Uint8Array(frames * SILENT_MP3_FRAME_BYTES)
  for (let frame = 0; frame < frames; frame++) {
    bytes.set(FRAME_HEADER, frame * SILENT_MP3_FRAME_BYTES)
  }
  return bytes
}
