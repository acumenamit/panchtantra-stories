// The code-generated silent MP3 of the staging narrated story (design p1-step11-design.md §3.23
// N23, §9 A26, §13.3 T11-19; P1-5a). The oracle is probe PR-1 (§10.1): 42 frames of the header
// FF F3 64 C4 and 140 zero bytes make a 6,048-byte MPEG-2 Layer III file that the repo's own frame
// scanner (tools/narration/mp3.ts) reads as 24 kHz, 48 kbps, mono and 1,008 ms. The values below are
// written out here, never read from the module under test.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mp3Info } from '../../tools/narration/mp3'
import { SILENT_MP3_FRAME_BYTES, silentMp3 } from './silent-mp3'

/** sha256 of PR-1's silent.mp3 (6,048 bytes), measured by the prober and again by the builder. */
const PR1_SHA256 = '461189ac94081b726ccf5ea67fb1ffccb56db3037d5e42834179d8869d2d7fd9'
const HEADER = [0xff, 0xf3, 0x64, 0xc4]

describe('silentMp3 (design §3.23 N23, A26, T11-19)', () => {
  const bytes = silentMp3(42)

  it('(g1) 42 frames, 6,048 bytes: the header FF F3 64 C4 every 144 bytes, zeros between', () => {
    expect(SILENT_MP3_FRAME_BYTES).toBe(144)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(6048)
    for (let frame = 0; frame < 42; frame++) {
      const at = frame * 144
      expect([...bytes.subarray(at, at + 4)], `frame ${frame} header`).toEqual(HEADER)
      expect(
        bytes.subarray(at + 4, at + 144).every((byte) => byte === 0),
        `frame ${frame}: side info and body all zero`,
      ).toBe(true)
    }
    expect(silentMp3(1).length).toBe(144)
    expect(silentMp3(0).length).toBe(0)
  })

  it('(g2) the frame scanner reads 42 frames, 48 kbps, 24,000 Hz, mono, 1,008 ms', () => {
    expect(mp3Info(bytes)).toEqual({
      frames: 42,
      kbps: [48],
      sampleRate: 24000,
      mono: true,
      durationMs: 1008,
    })
  })

  it('(g3) the bytes are pinned by sha256 (PR-1)', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PR1_SHA256)
  })

  it('refuses a frame count that is not a whole number from 0', () => {
    for (const frames of [-1, 1.5, Number.NaN]) {
      expect(() => silentMp3(frames), String(frames)).toThrow(
        'silentMp3: frames must be a whole number from 0',
      )
    }
  })
})
