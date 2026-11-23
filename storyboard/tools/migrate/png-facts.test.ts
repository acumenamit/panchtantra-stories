// P1-9a (Step 17) png-facts (design migration-input/p1-step17-design.md D17-4 rule 3, §3.4, A11;
// test plan §14.4: T17-8). Synthetic bytes only (media-fixtures.ts).
import { describe, expect, it } from 'vitest'
import { PNG_SIGNATURE_BYTES, ihdrData, pngChunk, pngOf } from './media-fixtures'
import { hasChunk, readPngFacts } from './png-facts'

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const IDAT = pngChunk('IDAT', Uint8Array.of(0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01))
const IEND = pngChunk('IEND')
const ihdr = (width: number, height: number) => pngChunk('IHDR', ihdrData({ width, height }))
/** 'ok', the refusal reason, or 'threw' (readPngFacts never throws; R1-TP-1 pins each reason). */
const verdict = (bytes: Uint8Array): string => {
  try {
    const read = readPngFacts(bytes)
    return read.ok ? 'ok' : read.reason
  } catch {
    return 'threw'
  }
}

describe('png-facts', () => {
  it('T17-8 png-facts: the signature, a bounded chunk walk that ends at IEND, IHDR first with its fields, chunk types compared exactly (A11)', () => {
    const wide = pngOf({ width: 1408, height: 768, chunks: ['sBIT', 'zTXt', 'caBX'] })
    const read = readPngFacts(wide)
    expect(read.ok, 'precondition: pngOf 1408x768 with sBIT, zTXt, caBX parses').toBe(true)
    if (!read.ok) return

    // g1 the facts.
    expect
      .soft(
        {
          width: read.facts.width,
          height: read.facts.height,
          bitDepth: read.facts.bitDepth,
          colourType: read.facts.colourType,
          interlace: read.facts.interlace,
          chunkTypes: read.facts.chunkTypes,
        },
        '(g1) the facts of the 1408x768 sample',
      )
      .toEqual({
        width: 1408,
        height: 768,
        bitDepth: 8,
        colourType: 2,
        interlace: 0,
        chunkTypes: ['IHDR', 'sBIT', 'zTXt', 'caBX', 'IDAT', 'IEND'],
      })
    const square = readPngFacts(pngOf({ width: 1024, height: 1024, colourType: 6, interlace: 1 }))
    expect
      .soft(
        square.ok
          ? [
              square.facts.width,
              square.facts.height,
              square.facts.colourType,
              square.facts.interlace,
            ]
          : 'refused',
        '(g1) a 1024x1024 colour type 6 interlace 1 sample is read as given',
      )
      .toEqual([1024, 1024, 6, 1])

    // g2 refused forms.
    const sig = PNG_SIGNATURE_BYTES
    const pastEnd = concat(sig, ihdr(16, 16), IDAT, IEND)
    // IDAT's length field (after the signature and IHDR's 25 bytes) claims 4 bytes past the end.
    new DataView(pastEnd.buffer).setUint32(8 + 25, 8 + 12 + 4 + 4)
    const shortIhdr = concat(
      sig,
      pngChunk('IHDR', ihdrData({ width: 16, height: 16 }).slice(0, 12)),
    )
    // IEND whose length field claims 4 data bytes the file does not hold.
    const iendPastEnd = concat(sig, ihdr(16, 16), IDAT, IEND)
    new DataView(iendPastEnd.buffer).setUint32(iendPastEnd.length - 12, 4)
    const refused: [string, Uint8Array, string][] = [
      [
        'no signature',
        concat(Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7), ihdr(16, 16), IDAT, IEND),
        'png-signature',
      ],
      ['the signature alone', sig, 'png-iend'],
      ['a chunk length past the end', pastEnd, 'png-chunk-bounds'],
      [
        '3 bytes of a length field left',
        concat(sig, ihdr(16, 16), IDAT, Uint8Array.of(0, 0, 0)),
        'png-chunk-bounds',
      ],
      // R1-TP-1: the chunk-end bound on its own: the file ends inside IHDR's data, and an IEND whose
      // length runs past the end (neither the next header-fit check nor IEND's own rule sees them).
      [
        "the file ends inside IHDR's data",
        concat(sig, ihdr(16, 16).slice(0, 14)),
        'png-chunk-bounds',
      ],
      ['an IEND whose length runs past the end', iendPastEnd, 'png-chunk-bounds'],
      [
        'IHDR not first',
        concat(sig, pngChunk('sBIT', Uint8Array.of(8, 8, 8)), ihdr(16, 16), IDAT, IEND),
        'png-ihdr',
      ],
      ['IHDR length 12', concat(shortIhdr, IDAT, IEND), 'png-ihdr'],
      ['no IEND', concat(sig, ihdr(16, 16), IDAT), 'png-iend'],
      [
        'a byte after IEND',
        concat(sig, ihdr(16, 16), IDAT, IEND, Uint8Array.of(0)),
        'png-after-iend',
      ],
      ['width 0', concat(sig, ihdr(0, 16), IDAT, IEND), 'png-ihdr'],
      ['height 0', concat(sig, ihdr(16, 0), IDAT, IEND), 'png-ihdr'],
      ['width 2^31', concat(sig, ihdr(2 ** 31, 16), IDAT, IEND), 'png-ihdr'],
      ['a second IHDR', concat(sig, ihdr(16, 16), ihdr(16, 16), IDAT, IEND), 'png-ihdr'],
      [
        'IEND with data',
        concat(sig, ihdr(16, 16), IDAT, pngChunk('IEND', Uint8Array.of(0))),
        'png-iend',
      ],
      [
        'a chunk type with a digit',
        concat(sig, ihdr(16, 16), pngChunk('sB1T'), IDAT, IEND),
        'png-chunk-type',
      ],
      [
        'bit depth 4 with colour type 2',
        concat(sig, pngChunk('IHDR', ihdrData({ width: 16, height: 16, bitDepth: 4 })), IDAT, IEND),
        'png-ihdr',
      ],
      [
        'interlace 2',
        concat(
          sig,
          pngChunk('IHDR', ihdrData({ width: 16, height: 16, interlace: 2 })),
          IDAT,
          IEND,
        ),
        'png-ihdr',
      ],
      [
        'compression method 1',
        concat(
          sig,
          pngChunk('IHDR', Uint8Array.from([...ihdrData({ width: 16, height: 16 })].with(10, 1))),
          IDAT,
          IEND,
        ),
        'png-ihdr',
      ],
    ]
    expect(
      verdict(concat(sig, ihdr(16, 16), IDAT, IEND)),
      'precondition: the hand-built 16x16 base parses',
    ).toBe('ok')
    for (const [name, bytes, reason] of refused) {
      expect.soft(verdict(bytes), `(g2) refused: ${name}`).toBe(reason)
    }

    // g3 hasChunk compares chunk types exactly.
    expect.soft(hasChunk(wide, 'caBX'), '(g3) caBX present').toBe(true)
    for (const type of ['CABX', 'cabx', 'caBx']) {
      expect.soft(hasChunk(wide, type), `(g3) ${type} is another type`).toBe(false)
    }
    const lettersInData = pngOf({
      width: 8,
      height: 8,
      chunks: [{ type: 'zTXt', data: Uint8Array.from('caBX\0\0caBX', (c) => c.charCodeAt(0)) }],
    })
    expect(
      Buffer.from(lettersInData).includes('caBX'),
      'precondition: the letters caBX occur in the zTXt payload',
    ).toBe(true)
    expect
      .soft(hasChunk(lettersInData, 'caBX'), '(g3) the letters caBX inside a zTXt payload only')
      .toBe(false)
  })
})
