// The baseline JPEG encoder of the og image generator (design p1-step12-design.md §4.10; P1-3
// Step 12b). Build-time tooling under scripts/og/: no app code imports it, and it needs no image
// package (design §12). It follows the IJG reference code (libjpeg 6b) step by step, in integer
// arithmetic only, so the same input gives the same bytes on Windows and Linux (jpeg.test.ts g9
// scans this file for the forms that would not):
// - SOI; APP0 JFIF 1.01, density 1:1, units 0, no thumbnail;
// - DQT: ITU-T T.81 Annex K tables K.1 (luminance) and K.2 (chrominance) scaled by the IJG quality
//   formula (jcparam.c: scale 5000 / q below 50, else 200 − 2q; (base × scale + 50) / 100, clamped
//   1..255), written in zigzag order, one segment each;
// - SOF0: baseline, 8-bit, 3 components (Y, Cb, Cr), each sampled 1×1 (4:4:4), tables 0, 1, 1;
// - DHT: the four typical tables of Annex K (K.3 to K.6), one segment each: DC and AC luminance,
//   then DC and AC chrominance;
// - SOS, then per 8×8 block of each component: RGB to YCbCr in 16-bit fixed point (jccolor.c),
//   the level shift by 128, the islow integer forward DCT (jfdctint.c, CONST_BITS 13, PASS1_BITS
//   2), quantisation with rounding (jcdctmgr.c, divisor × 8), DC difference and AC run-length
//   coding with ZRL and EOB (jchuff.c), 0xFF byte stuffing, the last byte padded with 1 bits; the
//   picture's right and bottom edges padded to whole blocks by repeating the last column and row;
// - EOI.

/** An RGB picture: width × height × 3 bytes, row by row. */
export interface RgbImage {
  readonly width: number
  readonly height: number
  readonly rgb: Uint8Array
}

/** The natural (row-major) index of the k-th coefficient in zigzag order (T.81 Figure A.6). */
const NATURAL_ORDER = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
] as const

/** T.81 Table K.1, luminance quantisation, natural order. */
const LUMINANCE_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
] as const

/** T.81 Table K.2, chrominance quantisation, natural order. */
const CHROMINANCE_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
] as const

/** A Huffman table as DHT carries it: the count of codes of each length 1..16, then the values. */
interface HuffmanSpec {
  readonly bits: readonly number[]
  readonly values: readonly number[]
}

/** T.81 Table K.3: DC luminance. */
const DC_LUMINANCE: HuffmanSpec = {
  bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

/** T.81 Table K.4: DC chrominance. */
const DC_CHROMINANCE: HuffmanSpec = {
  bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

/** T.81 Table K.5: AC luminance. */
const AC_LUMINANCE: HuffmanSpec = {
  bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  values: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
}

/** T.81 Table K.6: AC chrominance. */
const AC_CHROMINANCE: HuffmanSpec = {
  bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  values: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
}

/** The IJG quality scaling (jcparam.c jpeg_quality_scaling and jpeg_add_quant_table, baseline). */
function scaledTable(base: readonly number[], quality: number): number[] {
  const scale = quality < 50 ? Math.floor(5000 / quality) : 200 - quality * 2
  return base.map((value) => Math.min(255, Math.max(1, Math.floor((value * scale + 50) / 100))))
}

/** Code and length per symbol, built from a table's bits and values (T.81 Annex C). */
interface HuffmanCodes {
  readonly code: readonly number[]
  readonly size: readonly number[]
}

function huffmanCodes(spec: HuffmanSpec): HuffmanCodes {
  const code: number[] = []
  const size: number[] = []
  let next = 0
  let k = 0
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < (spec.bits[length - 1] ?? 0); i++) {
      const symbol = spec.values[k++] ?? 0
      code[symbol] = next++
      size[symbol] = length
    }
    next <<= 1
  }
  return { code, size }
}

/** The entropy-coded segment: bits written most significant first, 0xFF followed by 0x00. */
class BitWriter {
  readonly bytes: number[] = []
  private current = 0
  private filled = 0

  write(value: number, length: number): void {
    for (let bit = length - 1; bit >= 0; bit--) {
      this.current = (this.current << 1) | ((value >> bit) & 1)
      this.filled++
      if (this.filled === 8) {
        this.bytes.push(this.current)
        if (this.current === 0xff) this.bytes.push(0x00)
        this.current = 0
        this.filled = 0
      }
    }
  }

  /** Pads the last byte with 1 bits (jchuff.c flush_bits). */
  flush(): void {
    if (this.filled > 0) this.write(0x7f, 8 - this.filled)
  }
}

/** Writes one Huffman symbol, or throws when the table has no code for it. */
function writeSymbol(writer: BitWriter, codes: HuffmanCodes, symbol: number): void {
  const size = codes.size[symbol]
  if (size === undefined)
    throw new RangeError(`jpeg: no Huffman code for symbol 0x${symbol.toString(16)}`)
  writer.write(codes.code[symbol] ?? 0, size)
}

/** The number of bits of |value| (T.81 F.1.2.1: the magnitude category). */
function category(value: number): number {
  let magnitude = value < 0 ? -value : value
  let bits = 0
  while (magnitude > 0) {
    bits++
    magnitude >>= 1
  }
  return bits
}

// jfdctint.c constants: FIX(x) = x × 2^13, rounded.
const CONST_BITS = 13
const PASS1_BITS = 2
const FIX_0_298631336 = 2446
const FIX_0_390180644 = 3196
const FIX_0_541196100 = 4433
const FIX_0_765366865 = 6270
const FIX_0_899976223 = 7373
const FIX_1_175875602 = 9633
const FIX_1_501321110 = 12299
const FIX_1_847759065 = 15137
const FIX_1_961570560 = 16069
const FIX_2_053119869 = 16819
const FIX_2_562915447 = 20995
const FIX_3_072711026 = 25172

/**
 * x / 2^n rounded (jfdctint.c DESCALE: add 2^(n − 1), then an arithmetic right shift). Written as a
 * floor division, which is exact for these integers and cannot wrap at 32 bits as `>>` would.
 */
function descale(x: number, n: number): number {
  return Math.floor((x + 2 ** (n - 1)) / 2 ** n)
}

/**
 * The islow forward DCT of one 8×8 block in place (jfdctint.c jpeg_fdct_islow): the outputs are
 * 8 times the true DCT coefficients.
 */
function forwardDct(data: Int32Array): void {
  // Pass 1: rows; the results are scaled up by sqrt(8) and by 2^PASS1_BITS.
  for (let row = 0; row < 64; row += 8) {
    const d0 = data[row] ?? 0
    const d1 = data[row + 1] ?? 0
    const d2 = data[row + 2] ?? 0
    const d3 = data[row + 3] ?? 0
    const d4 = data[row + 4] ?? 0
    const d5 = data[row + 5] ?? 0
    const d6 = data[row + 6] ?? 0
    const d7 = data[row + 7] ?? 0
    const tmp0 = d0 + d7
    const tmp7 = d0 - d7
    const tmp1 = d1 + d6
    const tmp6 = d1 - d6
    const tmp2 = d2 + d5
    const tmp5 = d2 - d5
    const tmp3 = d3 + d4
    const tmp4 = d3 - d4
    const tmp10 = tmp0 + tmp3
    const tmp13 = tmp0 - tmp3
    const tmp11 = tmp1 + tmp2
    const tmp12 = tmp1 - tmp2
    data[row] = (tmp10 + tmp11) << PASS1_BITS
    data[row + 4] = (tmp10 - tmp11) << PASS1_BITS
    const z1 = (tmp12 + tmp13) * FIX_0_541196100
    data[row + 2] = descale(z1 + tmp13 * FIX_0_765366865, CONST_BITS - PASS1_BITS)
    data[row + 6] = descale(z1 + tmp12 * -FIX_1_847759065, CONST_BITS - PASS1_BITS)
    oddPart(data, row, 1, tmp4, tmp5, tmp6, tmp7, CONST_BITS - PASS1_BITS)
  }
  // Pass 2: columns; removes the PASS1_BITS scaling, leaves the overall factor of 8.
  for (let column = 0; column < 8; column++) {
    const d0 = data[column] ?? 0
    const d1 = data[column + 8] ?? 0
    const d2 = data[column + 16] ?? 0
    const d3 = data[column + 24] ?? 0
    const d4 = data[column + 32] ?? 0
    const d5 = data[column + 40] ?? 0
    const d6 = data[column + 48] ?? 0
    const d7 = data[column + 56] ?? 0
    const tmp0 = d0 + d7
    const tmp7 = d0 - d7
    const tmp1 = d1 + d6
    const tmp6 = d1 - d6
    const tmp2 = d2 + d5
    const tmp5 = d2 - d5
    const tmp3 = d3 + d4
    const tmp4 = d3 - d4
    const tmp10 = tmp0 + tmp3
    const tmp13 = tmp0 - tmp3
    const tmp11 = tmp1 + tmp2
    const tmp12 = tmp1 - tmp2
    data[column] = descale(tmp10 + tmp11, PASS1_BITS)
    data[column + 32] = descale(tmp10 - tmp11, PASS1_BITS)
    const z1 = (tmp12 + tmp13) * FIX_0_541196100
    data[column + 16] = descale(z1 + tmp13 * FIX_0_765366865, CONST_BITS + PASS1_BITS)
    data[column + 48] = descale(z1 + tmp12 * -FIX_1_847759065, CONST_BITS + PASS1_BITS)
    oddPart(data, column, 8, tmp4, tmp5, tmp6, tmp7, CONST_BITS + PASS1_BITS)
  }
}

/** The odd part of one jfdctint.c pass (outputs 1, 3, 5, 7 at `start` + k × `step`). */
function oddPart(
  data: Int32Array,
  start: number,
  step: number,
  tmp4: number,
  tmp5: number,
  tmp6: number,
  tmp7: number,
  shift: number,
): void {
  const z5 = (tmp4 + tmp6 + tmp5 + tmp7) * FIX_1_175875602
  const z1 = (tmp4 + tmp7) * -FIX_0_899976223
  const z2 = (tmp5 + tmp6) * -FIX_2_562915447
  const z3 = (tmp4 + tmp6) * -FIX_1_961570560 + z5
  const z4 = (tmp5 + tmp7) * -FIX_0_390180644 + z5
  data[start + 7 * step] = descale(tmp4 * FIX_0_298631336 + z1 + z3, shift)
  data[start + 5 * step] = descale(tmp5 * FIX_2_053119869 + z2 + z4, shift)
  data[start + 3 * step] = descale(tmp6 * FIX_3_072711026 + z2 + z3, shift)
  data[start + step] = descale(tmp7 * FIX_1_501321110 + z1 + z4, shift)
}

/** Quantises a DCT block with rounding (jcdctmgr.c: the islow divisor is the table entry × 8). */
function quantise(block: Int32Array, table: readonly number[], out: Int32Array): void {
  for (let i = 0; i < 64; i++) {
    const divisor = (table[i] ?? 1) << 3
    const value = block[i] ?? 0
    const magnitude = Math.floor(((value < 0 ? -value : value) + (divisor >> 1)) / divisor)
    out[i] = value < 0 ? -magnitude : magnitude
  }
}

/** Codes one quantised block (jchuff.c encode_one_block); returns the block's DC value. */
function encodeBlock(
  writer: BitWriter,
  coefficients: Int32Array,
  previousDc: number,
  dc: HuffmanCodes,
  ac: HuffmanCodes,
): number {
  const dcValue = coefficients[0] ?? 0
  const difference = dcValue - previousDc
  const dcBits = category(difference)
  writeSymbol(writer, dc, dcBits)
  if (dcBits > 0) writer.write(difference < 0 ? difference - 1 : difference, dcBits)
  let run = 0
  for (let k = 1; k < 64; k++) {
    const value = coefficients[NATURAL_ORDER[k] ?? 0] ?? 0
    if (value === 0) {
      run++
      continue
    }
    while (run > 15) {
      writeSymbol(writer, ac, 0xf0)
      run -= 16
    }
    const bits = category(value)
    writeSymbol(writer, ac, (run << 4) + bits)
    writer.write(value < 0 ? value - 1 : value, bits)
    run = 0
  }
  if (run > 0) writeSymbol(writer, ac, 0x00)
  return dcValue
}

// jccolor.c: FIX(x) = x × 2^16, rounded; Cb and Cr gain 128 × 2^16 and ONE_HALF − 1.
const SCALE_BITS = 16
const ONE_HALF = 1 << (SCALE_BITS - 1)
const CBCR_OFFSET = 128 << SCALE_BITS
const FIX_0_29900 = 19595
const FIX_0_58700 = 38470
const FIX_0_11400 = 7471
const FIX_0_16874 = 11059
const FIX_0_33126 = 21709
const FIX_0_50000 = 32768
const FIX_0_41869 = 27439
const FIX_0_08131 = 5329

/** The three YCbCr planes of the picture (jccolor.c rgb_ycc_convert). */
function toYCbCr(image: RgbImage): [Uint8Array, Uint8Array, Uint8Array] {
  const pixels = image.width * image.height
  const y = new Uint8Array(pixels)
  const cb = new Uint8Array(pixels)
  const cr = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) {
    const r = image.rgb[i * 3] ?? 0
    const g = image.rgb[i * 3 + 1] ?? 0
    const b = image.rgb[i * 3 + 2] ?? 0
    y[i] = (FIX_0_29900 * r + FIX_0_58700 * g + FIX_0_11400 * b + ONE_HALF) >> SCALE_BITS
    cb[i] =
      (-FIX_0_16874 * r - FIX_0_33126 * g + FIX_0_50000 * b + CBCR_OFFSET + ONE_HALF - 1) >>
      SCALE_BITS
    cr[i] =
      (FIX_0_50000 * r - FIX_0_41869 * g - FIX_0_08131 * b + CBCR_OFFSET + ONE_HALF - 1) >>
      SCALE_BITS
  }
  return [y, cb, cr]
}

/** A marker segment: 0xFF, the marker, the length (payload + 2), the payload. */
function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2
  return [0xff, marker, length >> 8, length & 0xff, ...payload]
}

/** Encodes `image` as a baseline JFIF JPEG at the IJG `quality` (1..100). */
export function encodeJpeg(image: RgbImage, quality: number): Uint8Array {
  const { width, height } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('jpeg: width and height must be whole numbers of at least 1')
  }
  if (width > 0xffff || height > 0xffff) throw new RangeError('jpeg: width or height over 65535')
  if (image.rgb.length !== width * height * 3) {
    throw new RangeError('jpeg: the RGB buffer is not width × height × 3 bytes')
  }
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new RangeError('jpeg: quality must be a whole number from 1 to 100')
  }
  const luminance = scaledTable(LUMINANCE_QUANT, quality)
  const chrominance = scaledTable(CHROMINANCE_QUANT, quality)
  const zigzag = (table: readonly number[]): number[] =>
    NATURAL_ORDER.map((natural) => table[natural] ?? 0)
  const dht = (classAndId: number, spec: HuffmanSpec): number[] =>
    segment(0xc4, [classAndId, ...spec.bits, ...spec.values])

  const head = [
    0xff,
    0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xdb, [0x00, ...zigzag(luminance)]),
    ...segment(0xdb, [0x01, ...zigzag(chrominance)]),
    ...segment(0xc0, [
      8,
      height >> 8,
      height & 0xff,
      width >> 8,
      width & 0xff,
      3,
      1,
      0x11,
      0,
      2,
      0x11,
      1,
      3,
      0x11,
      1,
    ]),
    ...dht(0x00, DC_LUMINANCE),
    ...dht(0x10, AC_LUMINANCE),
    ...dht(0x01, DC_CHROMINANCE),
    ...dht(0x11, AC_CHROMINANCE),
    ...segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]),
  ]

  const planes = toYCbCr(image)
  const tables = [luminance, chrominance, chrominance] as const
  const dcCodes = [
    huffmanCodes(DC_LUMINANCE),
    huffmanCodes(DC_CHROMINANCE),
    huffmanCodes(DC_CHROMINANCE),
  ] as const
  const acCodes = [
    huffmanCodes(AC_LUMINANCE),
    huffmanCodes(AC_CHROMINANCE),
    huffmanCodes(AC_CHROMINANCE),
  ] as const
  const previousDc = [0, 0, 0]
  const writer = new BitWriter()
  const block = new Int32Array(64)
  const quantised = new Int32Array(64)
  for (let top = 0; top < height; top += 8) {
    for (let left = 0; left < width; left += 8) {
      for (let component = 0; component < 3; component++) {
        const plane = planes[component] ?? planes[0]
        for (let y = 0; y < 8; y++) {
          // The bottom and right edges repeat the last row and column (jcprepct.c, jcsample.c).
          const row = Math.min(top + y, height - 1) * width
          for (let x = 0; x < 8; x++) {
            block[y * 8 + x] = (plane[row + Math.min(left + x, width - 1)] ?? 0) - 128
          }
        }
        forwardDct(block)
        quantise(block, tables[component] ?? luminance, quantised)
        previousDc[component] = encodeBlock(
          writer,
          quantised,
          previousDc[component] ?? 0,
          dcCodes[component] ?? dcCodes[0],
          acCodes[component] ?? acCodes[0],
        )
      }
    }
  }
  writer.flush()
  return Uint8Array.from([...head, ...writer.bytes, 0xff, 0xd9])
}
