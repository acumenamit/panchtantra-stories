// Step 14 (P1-8c) media-check.ts: sniffMime and the variant byte checks A002/A003 (design
// migration-input/p1-step14-design.md §3.14 D14-6, D14-22, §9 L1, L2; test plan §14.4: T14-13 to
// T14-15). Every byte sample is built in code. Titles start with their id; one expect.soft per
// claim, messages "(gN) <claim> <sample>"; preconditions are hard expects starting "precondition:".
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../src/core/hashing'
import { checkVariantBytes, sniffMime } from './media-check'

const bytes = (...parts: (number | string | readonly number[])[]): Uint8Array<ArrayBuffer> => {
  const out: number[] = []
  for (const part of parts) {
    if (typeof part === 'number') out.push(part)
    else if (typeof part === 'string') for (const ch of part) out.push(ch.charCodeAt(0))
    else out.push(...part)
  }
  return new Uint8Array(out)
}
const zeros = (n: number): number[] => new Array<number>(n).fill(0)
const le32 = (n: number): number[] => [
  n & 0xff,
  (n >>> 8) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 24) & 0xff,
]

/** A WebP of `length` bytes whose RIFF size is `length - 8 + sizeDelta`. */
const webp = (length = 34, sizeDelta = 0, tag = 'WEBP', head = 'RIFF') =>
  bytes(head, le32(length - 8 + sizeDelta), tag, zeros(length - 12))
const SYNC = [0xff, 0xfb, 0x90, 0x64]
/** An ID3v2 header: major version, flags and the four size bytes. */
const id3 = (major: number, flags: number, size: readonly number[]) =>
  ['ID3', major, 0, flags, size] as const
const asHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')

const POSITIVES: [string, string, Uint8Array<ArrayBuffer>][] = [
  ['g1', 'WebP 34 bytes', webp()],
  ['g2', 'JPEG FF D8 FF E0', bytes(0xff, 0xd8, 0xff, 0xe0, zeros(8))],
  ['g2', 'JPEG FF D8 FF DB', bytes(0xff, 0xd8, 0xff, 0xdb, zeros(8))],
  ['g3', 'MP3 sync at 0', bytes(SYNC, zeros(8))],
  ['g3', 'ID3v2.3 then a sync at 10 + size', bytes(...id3(3, 0, [0, 0, 0, 5]), zeros(5), SYNC)],
  [
    'g3',
    'ID3v2.4 with the footer flag, the footer at 10 + size, the sync at 20 + size',
    bytes(...id3(4, 0x10, [0, 0, 0, 4]), zeros(4), '3DI', 4, 0, 0x10, 0, 0, 0, 4, SYNC),
  ],
  ['g3', 'ID3v2.2 then a sync', bytes(...id3(2, 0, [0, 0, 0, 2]), zeros(2), SYNC)],
]
const MIME_OF: Record<string, string> = { g1: 'image/webp', g2: 'image/jpeg', g3: 'audio/mpeg' }

describe('media-check: sniffMime', () => {
  it('T14-13 sniffMime accepts the three formats by their headers', () => {
    const riff = POSITIVES[0]![2]
    expect(asHex(riff.subarray(0, 12)), 'precondition: the WebP header as built').toBe(
      '52 49 46 46 1a 00 00 00 57 45 42 50',
    )
    expect(
      asHex(POSITIVES[5]![2].subarray(0, 10)),
      'precondition: the ID3v2.4 header as built',
    ).toBe('49 44 33 04 00 10 00 00 00 04')
    for (const [group, id, sample] of POSITIVES) {
      expect.soft(sniffMime(sample), `(${group}) ${id}`).toBe(MIME_OF[group])
    }
  })

  it('T14-14 sniffMime is null for every near miss (L2)', () => {
    for (const [group, id, sample] of POSITIVES) {
      expect(sniffMime(sample), `precondition: positive ${group} ${id}`).toBe(MIME_OF[group])
    }
    const image: [string, Uint8Array][] = [
      ['PNG magic', bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, zeros(8))],
      ['GIF89a', bytes('GIF89a', zeros(8))],
      ['RIFF....WAVE', webp(34, 0, 'WAVE')],
      ['RIFF....WEBX', webp(34, 0, 'WEBX')],
      ['RIFF size + 1', webp(34, 1)],
      ['RIFF size - 1', webp(34, -1)],
      ['an 11-byte WebP', bytes('RIFF', le32(3), 'WEB')],
      ['FF D8 only', bytes(0xff, 0xd8)],
      ['FF D8 FE', bytes(0xff, 0xd8, 0xfe, 0x00, zeros(4))],
      ['3 bytes FF D8 FF', bytes(0xff, 0xd8, 0xff)],
      ['empty', bytes()],
    ]
    for (const [id, sample] of image) expect.soft(sniffMime(sample), `(g1) null: ${id}`).toBeNull()
    const audio: [string, Uint8Array][] = [
      ['ID3 major 5', bytes(...id3(5, 0, [0, 0, 0, 2]), zeros(2), SYNC)],
      ['ID3 major 1', bytes(...id3(1, 0, [0, 0, 0, 2]), zeros(2), SYNC)],
      // Each sample places a sync where a reader that ignored the 0x80 rule would look for it.
      ['size byte 9 >= 0x80', bytes(...id3(3, 0, [0, 0, 0, 0x80]), zeros(128), SYNC)],
      ['size byte 8 >= 0x80', bytes(...id3(3, 0, [0, 0, 0x80, 0]), zeros(16384), SYNC)],
      ['size byte 7 >= 0x80', bytes(...id3(3, 0, [0, 0x80, 0, 0]), zeros(4), SYNC)],
      ['size byte 6 >= 0x80', bytes(...id3(3, 0, [0x80, 0, 0, 0]), zeros(4), SYNC)],
      ['no sync after the tag', bytes(...id3(3, 0, [0, 0, 0, 2]), zeros(2), 0x00, 0x00, zeros(4))],
      ['a size past the end', bytes(...id3(3, 0, [0, 0, 0, 100]), zeros(4), SYNC)],
      ['FF DF after the tag', bytes(...id3(3, 0, [0, 0, 0, 2]), zeros(2), 0xff, 0xdf, 0, 0)],
      ['FF 00 at 0', bytes(0xff, 0x00, zeros(8))],
      ['a 10-byte ID3 alone', bytes(...id3(3, 0, [0, 0, 0, 0]))],
    ]
    for (const [id, sample] of audio) expect.soft(sniffMime(sample), `(g2) null: ${id}`).toBeNull()
  })
})

describe('media-check: checkVariantBytes', () => {
  it('T14-15 variant bytes: size, then the A002 hash, then the A003 type; the first failure wins', async () => {
    const webpData = webp(40)
    const jpegData = bytes(0xff, 0xd8, 0xff, 0xe0, 'jpeg-sample')
    const mp3Data = bytes(SYNC, 'mp3-sample')
    const pngData = bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 'png-sample')
    const sha = async (b: Uint8Array<ArrayBuffer>) => sha256Hex(b)
    // A single-variant asset may be its own master, so these positives carry assetId = own hash:
    // a check that compared the asset id instead of the path's hex would still pass them.
    const variant = async (
      data: Uint8Array<ArrayBuffer>,
      mime: string,
      ext: string,
      name = 'v1',
    ) => {
      const hex = await sha(data)
      return {
        assetId: hex,
        path: `media/two-paths/${hex}-${name}.${ext}`,
        mime,
        bytes: data.length,
      } as const
    }
    const good: [string, Awaited<ReturnType<typeof variant>>, Uint8Array<ArrayBuffer>][] = [
      ['webp', await variant(webpData, 'image/webp', 'webp'), webpData],
      ['jpeg', await variant(jpegData, 'image/jpeg', 'jpg'), jpegData],
      ['mpeg', await variant(mp3Data, 'audio/mpeg', 'mp3'), mp3Data],
    ]
    for (const [id, v, data] of good) {
      expect(
        await checkVariantBytes(v as Parameters<typeof checkVariantBytes>[0], data),
        `precondition: a correct ${id} variant passes`,
      ).toEqual({ ok: true, sha256: await sha(data) })
    }
    const check = async (v: object, data: Uint8Array<ArrayBuffer>) => {
      const result = await checkVariantBytes(v as Parameters<typeof checkVariantBytes>[0], data)
      return result.ok ? 'ok' : result.code
    }
    const w = good[0]![1]

    expect
      .soft(
        await check({ ...w, bytes: w.bytes + 1 }, webpData),
        '(g1) a length other than declared',
      )
      .toBe('media-size')
    const shorter = webp(36)
    expect
      .soft(await check(w, shorter), '(g1) a file wrong in size and hash is media-size')
      .toBe('media-size')

    const flipped = webpData.slice()
    flipped[20] = 0x01
    expect.soft(await check(w, flipped), '(g2) one flipped byte').toBe('media-hash')
    const other = webp(40, 0, 'WEBP', 'RIFF')
    other[30] = 0x07
    const otherHex = await sha(other)
    expect
      .soft(
        await check({ ...w, path: `media/two-paths/${otherHex}-v1.webp` }, webpData),
        '(g2) the path hex of another file',
      )
      .toBe('media-hash')
    const width2 = webp(40)
    width2[39] = 0x09
    const shared = { assetId: w.assetId, mime: 'image/webp', bytes: 40 }
    expect
      .soft(
        await check({ ...shared, path: `media/two-paths/${w.assetId}-w768.webp` }, webpData),
        '(g2) width 1 under the shared hex passes',
      )
      .toBe('ok')
    expect
      .soft(
        await check({ ...shared, path: `media/two-paths/${w.assetId}-w1408.webp` }, width2),
        '(g2) two widths sharing one hex: the second is media-hash',
      )
      .toBe('media-hash')

    const webpAsMpeg = await variant(webpData, 'audio/mpeg', 'mp3')
    expect
      .soft(await check(webpAsMpeg, webpData), '(g3) WebP bytes declared audio/mpeg')
      .toBe('media-type')
    const pngAsJpeg = await variant(pngData, 'image/jpeg', 'jpg')
    expect
      .soft(await check(pngAsJpeg, pngData), '(g3) PNG bytes declared image/jpeg')
      .toBe('media-type')
  })
})
