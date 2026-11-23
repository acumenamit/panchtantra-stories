// P1-9a (Step 17) webp-facts (design migration-input/p1-step17-design.md D17-8, CRIT-10, A12;
// test plan §14.5: T17-9). Synthetic bytes only (media-fixtures.ts). F2 (a VP8X chunk before the
// frame) is not applied: every VP8X form is refused.
import { describe, expect, it } from 'vitest'
import { vp8Of, vp8xData } from './media-fixtures'
import { readWebpFacts } from './webp-facts'

/** `<w>x<h>`, or `refused <reason>` (R1-TP-1 pins each reason). */
const facts = (bytes: Uint8Array): string => {
  const read = readWebpFacts(bytes)
  return read.ok ? `${read.width}x${read.height}` : `refused ${read.reason}`
}
const chunk = (fourcc: string, size = 6) => ({ fourcc, data: new Uint8Array(size).fill(0x41) })

describe('webp-facts', () => {
  it('T17-9 webp-facts: the RIFF fills the file; one VP8 key frame whose size and pad end at the RIFF end; start code, show_frame, scale bits and first partition checked; every other chunk or form refused (A12, CRIT-10)', () => {
    const even = vp8Of({ width: 768, height: 419, payloadBytes: 32 })
    const odd = vp8Of({ width: 1408, height: 768, payloadBytes: 33 })
    expect(even.length % 2, 'precondition: the even sample has no pad byte').toBe(0)
    expect(odd[16], 'precondition: the odd sample declares an odd VP8 size (43)').toBe(43)
    expect(odd[odd.length - 1], 'precondition: the odd sample ends with its zero pad byte').toBe(0)
    expect(facts(even), 'precondition: 768x419 (even chunk size) reads ok').toBe('768x419')
    expect(facts(odd), 'precondition: 1408x768 (odd, one pad byte) reads ok').toBe('1408x768')

    // g1 the RIFF.
    const base = { width: 768, height: 419 }
    const riffForms: [string, Uint8Array][] = [
      ['one byte after the RIFF end', vp8Of({ ...base, trailing: 1 })],
      ['a file shorter than the RIFF size', vp8Of({ ...base, riffSizeDelta: 2 })],
      ['RIFX', vp8Of({ ...base, riffTag: 'RIFX' })],
      ['WEBQ', vp8Of({ ...base, formTag: 'WEBQ' })],
      ['under 30 bytes', vp8Of({ ...base, payloadBytes: 0 }).slice(0, 29)],
    ]
    expect(
      facts(vp8Of({ ...base, payloadBytes: 0 })),
      'precondition: a 30-byte frame with no payload reads ok',
    ).toBe('768x419')
    for (const [name, bytes] of riffForms) {
      expect.soft(facts(bytes), `(g1) refused: ${name}`).toBe('refused webp-riff')
    }

    // g2 chunks: exactly one VP8 chunk, ending at the RIFF end with its pad.
    const others = [
      { fourcc: 'VP8X', data: vp8xData(0, 768, 419) },
      chunk('EXIF'),
      chunk('XMP '),
      chunk('ICCP'),
      chunk('ALPH'),
      chunk('ANIM'),
      chunk('ANMF'),
      chunk('VP8L'),
    ]
    for (const other of others) {
      expect
        .soft(facts(vp8Of({ ...base, before: [other] })), `(g2) refused: ${other.fourcc} before`)
        .toBe('refused webp-chunk')
      expect
        .soft(facts(vp8Of({ ...base, after: [other] })), `(g2) refused: ${other.fourcc} after`)
        .toBe('refused webp-chunk')
    }
    const chunkForms: [string, Uint8Array][] = [
      ['two VP8 chunks', vp8Of({ ...base, vp8Chunks: 2 })],
      ['a VP8 size past the RIFF end', vp8Of({ ...base, chunkSizeDelta: 2 })],
      ['an odd size with no pad', vp8Of({ ...base, payloadBytes: 33, pad: 'none' })],
      ['an even size with a pad byte', vp8Of({ ...base, payloadBytes: 32, pad: 'extra' })],
    ]
    for (const [name, bytes] of chunkForms) {
      expect.soft(facts(bytes), `(g2) refused: ${name}`).toBe('refused webp-chunk')
    }

    // g3 the frame header.
    const frameForms: [string, Uint8Array][] = [
      ['frame-tag bit 0 set (an inter frame)', vp8Of({ ...base, keyFrame: false })],
      ['show_frame 0', vp8Of({ ...base, showFrame: false })],
      ['start code 9d 01 2b', vp8Of({ ...base, startCode: [0x9d, 0x01, 0x2b] })],
      ['width scale bits 01', vp8Of({ ...base, widthScale: 1 })],
      ['height scale bits 10', vp8Of({ ...base, heightScale: 2 })],
      ['first_part_size past the chunk', vp8Of({ ...base, payloadBytes: 32, firstPartSize: 33 })],
      ['width 0', vp8Of({ ...base, width: 0 })],
      ['height 0', vp8Of({ ...base, height: 0 })],
    ]
    for (const [name, bytes] of frameForms) {
      expect.soft(facts(bytes), `(g3) refused: ${name}`).toBe('refused webp-frame')
    }
    expect
      .soft(
        facts(vp8Of({ width: 16383, height: 16383 })),
        '(g3) the reported size is the 14-bit value (16383 x 16383)',
      )
      .toBe('16383x16383')
    expect
      .soft(
        facts(vp8Of({ ...base, payloadBytes: 32, firstPartSize: 32 })),
        '(g3) a first partition that ends at the chunk end reads ok',
      )
      .toBe('768x419')
  })
})
