// T12-34 (design p1-step12-design.md §4.10, §13.3 T12-34; must-implement row B6; P1-3 Step 12b):
// the og image generator's baseline JPEG encoder, scripts/og/jpeg.ts.
// The oracles of g2, g5 and g6 were derived by hand from ITU-T T.81 Annex K and the IJG formulas
// (design §13.11 item 18, lead decision L15); an implementer who disagrees re-derives them and
// reports both derivations, and never edits a literal to fit the output. The Step 12b implementer
// re-derived each one and agreed (report). The Huffman tables of g4 are Annex K's K.3 to K.6.
// - (g1) The markers in order: SOI, APP0 (JFIF\0, 1.01, units 0, density 1:1), DQT ×2, SOF0,
//   DHT ×4, SOS, EOI.
// - (g2) DQT at quality 90 in zigzag order: luminance starts [3, 2, 2, 3, 2, 2, 3, 3], its largest
//   entry is 24; chrominance starts [3, 4, 4, 5, 4, 5, 9, 5] and ends 20 (IJG: scale 200 − 2q;
//   (base × scale + 50) / 100 in integers, clamped 1..255).
// - (g3) SOF0 of the og image: precision 8, height 630 then width 1200, components 1, 2, 3 with
//   sampling 0x11 and quantisation tables 0, 1, 1.
// - (g4) The four DHT segments: Annex K's tables, bits and values written out here.
// - (g5) An 8×8 RGB(128, 128, 128) image's scan is exactly 0x28 0x03 (DC category 0 '00', EOB
//   '1010'; chroma '00' '00' twice; padded with 1s); 16×8 of it is 0x28 0x00 0xA0 0x0F.
// - (g6) An 8×8 white image's scan is exactly 0xFD 0x53 0xA0 0x0F: Y DC 64·127/(3·8) → 339,
//   category 9 '1111110', then '101010011', EOB '1010', chroma '00 00 00 00', padded with 1s.
// - (g7) In the og image's entropy-coded segment every 0xFF is followed by 0x00, and one occurs.
// - (g8) A 9×9 image encodes exactly as the same image padded to 16×16 by repeating its last row
//   and column (the scans compared; the frame headers differ by the size).
// - (g9) A source scan: jpeg.ts, og-image.ts and every module they load (relative imports,
//   re-exports, import(), require(), the tsconfig alias; fail closed on one it cannot find) hold
//   no Math member but floor, trunc, min, max, abs, imul, clz32 and sign (12b review round 1,
//   R1-ENC-1; the design named only cos, sin, sqrt, PI, round and fround) in any form (member,
//   computed or template key, optional chaining, alias, destructuring, Reflect.get), no ** but a
//   power of the literal 2, and no floating literal (a '.' or an exponent in a decimal literal), so
//   the bytes are the same on Windows and Linux. Comments are not read. Documented limits
//   (guard-bypass catalogue lint class 13): a name assembled at run time; the exponent of 2 ** x is
//   not proven an integer (descale's exponents are integer constants).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { encodeJpeg } from './jpeg'
import { ogFallbackJpeg } from './og-image'

const STORYBOARD = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const MARKER_NAMES: Readonly<Record<number, string>> = {
  0xd8: 'SOI',
  0xe0: 'APP0',
  0xdb: 'DQT',
  0xc0: 'SOF0',
  0xc4: 'DHT',
  0xda: 'SOS',
  0xd9: 'EOI',
}

interface Segment {
  readonly name: string
  /** The segment's payload after its two length bytes (empty for SOI and EOI). */
  readonly data: Uint8Array
}

/** The file's segments in order and its entropy-coded segment (SOS header end to EOI). */
function parseJpeg(bytes: Uint8Array): { segments: Segment[]; scan: Uint8Array } {
  const segments: Segment[] = []
  const name = (marker: number): string =>
    MARKER_NAMES[marker] ?? `0x${marker.toString(16).padStart(2, '0')}`
  expect([bytes[0], bytes[1]], 'precondition: SOI first').toEqual([0xff, 0xd8])
  expect([bytes.at(-2), bytes.at(-1)], 'precondition: EOI last').toEqual([0xff, 0xd9])
  segments.push({ name: 'SOI', data: new Uint8Array(0) })
  let at = 2
  for (;;) {
    expect(bytes[at], `precondition: a marker at byte ${at}`).toBe(0xff)
    const marker = bytes[at + 1] ?? 0
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
    segments.push({ name: name(marker), data: bytes.subarray(at + 4, at + 2 + length) })
    at += 2 + length
    if (marker === 0xda) break
  }
  segments.push({ name: 'EOI', data: new Uint8Array(0) })
  return { segments, scan: bytes.subarray(at, bytes.length - 2) }
}

/** width × height RGB, every pixel `rgb`. */
function filled(width: number, height: number, rgb: readonly [number, number, number]) {
  const out = new Uint8Array(width * height * 3)
  for (let i = 0; i < out.length; i += 3) out.set(rgb, i)
  return { width, height, rgb: out }
}

/** The scan bytes of `image` at quality 90. */
function scanOf(image: { width: number; height: number; rgb: Uint8Array }): number[] {
  return [...parseJpeg(encodeJpeg(image, 90)).scan]
}

let ogCache: Uint8Array | undefined
/** The og image's bytes (encoded once per file). */
function ogJpeg(): Uint8Array {
  ogCache ??= ogFallbackJpeg()
  return ogCache
}

describe('encodeJpeg: the frame (T12-34 g1-g4)', () => {
  it('(g1) markers in order SOI, APP0, DQT ×2, SOF0, DHT ×4, SOS, EOI; APP0 is JFIF 1.01, 1:1', () => {
    const { segments } = parseJpeg(encodeJpeg(filled(8, 8, [128, 128, 128]), 90))
    expect
      .soft(
        segments.map((segment) => segment.name),
        '(g1) marker order',
      )
      .toEqual(['SOI', 'APP0', 'DQT', 'DQT', 'SOF0', 'DHT', 'DHT', 'DHT', 'DHT', 'SOS', 'EOI'])
    const app0 = [...(segments[1]?.data ?? [])]
    expect
      .soft(app0.slice(0, 5), "(g1) APP0 identifier 'JFIF\\0'")
      .toEqual([0x4a, 0x46, 0x49, 0x46, 0])
    expect.soft(app0.slice(5, 7), '(g1) APP0 version 1.01').toEqual([1, 1])
    expect.soft(app0[7], '(g1) APP0 units 0').toBe(0)
    expect.soft(app0.slice(8, 12), '(g1) APP0 density 1:1').toEqual([0, 1, 0, 1])
    expect.soft(app0.slice(12), '(g1) APP0 no thumbnail').toEqual([0, 0])
  })

  it('(g2) DQT at quality 90, zigzag order: the Annex K tables scaled by 200 − 2q', () => {
    const { segments } = parseJpeg(encodeJpeg(filled(8, 8, [128, 128, 128]), 90))
    const dqt = segments.filter((segment) => segment.name === 'DQT').map((s) => [...s.data])
    expect(
      dqt.map((table) => table.length),
      'precondition: two 8-bit tables',
    ).toEqual([65, 65])
    const [luma = [], chroma = []] = dqt
    expect.soft(luma[0], '(g2) luminance Pq/Tq').toBe(0x00)
    expect.soft(chroma[0], '(g2) chrominance Pq/Tq').toBe(0x01)
    expect.soft(luma.slice(1, 9), '(g2) luminance starts').toEqual([3, 2, 2, 3, 2, 2, 3, 3])
    expect.soft(Math.max(...luma.slice(1)), '(g2) luminance largest entry').toBe(24)
    expect.soft(chroma.slice(1, 9), '(g2) chrominance starts').toEqual([3, 4, 4, 5, 4, 5, 9, 5])
    expect.soft(chroma.at(-1), '(g2) chrominance ends').toBe(20)
  })

  it('(g3) SOF0 of the og image: 8 bits, 630 then 1200, components 1-3, sampling 0x11, tables 0 1 1', () => {
    const sof = parseJpeg(ogJpeg()).segments.find((segment) => segment.name === 'SOF0')
    expect(sof, 'precondition: an SOF0 segment').toBeDefined()
    const data = [...(sof?.data ?? [])]
    expect.soft(data[0], '(g3) precision').toBe(8)
    expect.soft((data[1] ?? 0) * 256 + (data[2] ?? 0), '(g3) height first').toBe(630)
    expect.soft((data[3] ?? 0) * 256 + (data[4] ?? 0), '(g3) width second').toBe(1200)
    expect.soft(data.slice(5), '(g3) components').toEqual([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])
  })

  it('(g4) DHT: the four Annex K tables, DC and AC luminance, then DC and AC chrominance', () => {
    const { segments } = parseJpeg(encodeJpeg(filled(8, 8, [128, 128, 128]), 90))
    const dht = segments.filter((segment) => segment.name === 'DHT').map((s) => [...s.data])
    expect.soft(dht, '(g4) four tables, each its own segment').toEqual([
      [0x00, ...K3_BITS, ...K3_VALUES],
      [0x10, ...K5_BITS, ...K5_VALUES],
      [0x01, ...K4_BITS, ...K4_VALUES],
      [0x11, ...K6_BITS, ...K6_VALUES],
    ])
    const sos = [...(segments.find((segment) => segment.name === 'SOS')?.data ?? [])]
    expect
      .soft(sos, '(g4) SOS: Y on tables 0/0, Cb and Cr on 1/1, spectral 0..63')
      .toEqual([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])
  })

  it('refuses an RGB buffer whose length is not width × height × 3', () => {
    expect(
      () => encodeJpeg({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3 - 1) }, 90),
      'a buffer one byte short is refused',
    ).toThrow(RangeError)
  })
})

describe('encodeJpeg: the scan (T12-34 g5-g8)', () => {
  it('(g5) 8×8 RGB(128,128,128) scans to 0x28 0x03; 16×8 of it to 0x28 0x00 0xA0 0x0F', () => {
    expect.soft(scanOf(filled(8, 8, [128, 128, 128])), '(g5) 8×8 grey').toEqual([0x28, 0x03])
    expect
      .soft(scanOf(filled(16, 8, [128, 128, 128])), '(g5) 16×8 grey')
      .toEqual([0x28, 0x00, 0xa0, 0x0f])
  })

  it('(g6) 8×8 white scans to 0xFD 0x53 0xA0 0x0F (Y DC 339, category 9)', () => {
    expect
      .soft(scanOf(filled(8, 8, [255, 255, 255])), '(g6) 8×8 white')
      .toEqual([0xfd, 0x53, 0xa0, 0x0f])
  })

  it('(g7) the og image: every 0xFF in the entropy-coded segment is followed by 0x00', () => {
    const { scan } = parseJpeg(ogJpeg())
    let ffs = 0
    const unstuffed: number[] = []
    scan.forEach((byte, index) => {
      if (byte !== 0xff) return
      ffs++
      if (scan[index + 1] !== 0x00) unstuffed.push(index)
    })
    console.log(`[jpeg.test] og scan: ${scan.length} bytes, ${ffs} 0xFF bytes`)
    expect(ffs, 'precondition: the scan holds at least one 0xFF').toBeGreaterThan(0)
    expect
      .soft(unstuffed.slice(0, 5), '(g7) 0xFF bytes not followed by 0x00 (first five)')
      .toEqual([])
  })

  it('(g8) a 9×9 image encodes as the same image padded to 16×16 by repeating its edges', () => {
    const small = new Uint8Array(9 * 9 * 3)
    let state = 4242
    for (let i = 0; i < small.length; i++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0
      small[i] = 16 + ((state >>> 16) % 224)
    }
    const padded = new Uint8Array(16 * 16 * 3)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const from = (Math.min(y, 8) * 9 + Math.min(x, 8)) * 3
        padded.set(small.subarray(from, from + 3), (y * 16 + x) * 3)
      }
    }
    const edge = small.subarray((8 * 9 + 8) * 3, (8 * 9 + 8) * 3 + 3)
    expect([...edge], 'precondition: the corner pixel is not black').not.toEqual([0, 0, 0])
    expect
      .soft(scanOf({ width: 9, height: 9, rgb: small }), '(g8) 9×9 against 16×16 padded')
      .toEqual(scanOf({ width: 16, height: 16, rgb: padded }))
  })
})

// ---------------------------------------------------------------------------------------------
// g9: the integer-only source scan

/**
 * The Math members integer code may use: each is exact on every engine. Every other Math member is
 * banned by name (12b review round 1, R1-ENC-1): ECMA-262 lets each engine approximate the
 * trigonometric, hyperbolic, exponential and logarithmic functions, pow, hypot and cbrt; random
 * differs per run; and the constants, sqrt, round, fround and ceil have no use in integer code.
 * The list is read from this runtime's Math, so a member a later Node adds is banned too.
 */
const ALLOWED_MATH = new Set(['floor', 'trunc', 'min', 'max', 'abs', 'imul', 'clz32', 'sign'])
const BANNED_NAMES = new Set(
  Object.getOwnPropertyNames(Math).filter((name) => !ALLOWED_MATH.has(name)),
)
const LOADABLE = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const
const TS_FOR_JS: Readonly<Record<string, string>> = {
  '.js': '.ts',
  '.jsx': '.tsx',
  '.mjs': '.mts',
  '.cjs': '.cts',
}

/** Source files by '/'-separated path from storyboard/: the stored path (any case) and the text. */
interface Sources {
  readonly find: (path: string) => string | undefined
  readonly text: (path: string) => string
}

const realSources: Sources = {
  find: (path) => (existsSync(join(STORYBOARD, path)) ? path : undefined),
  text: (path) => readFileSync(join(STORYBOARD, path), 'utf8'),
}

function sampleSources(files: Readonly<Record<string, string>>): Sources {
  const byLower = new Map(Object.keys(files).map((path) => [path.toLowerCase(), path]))
  return { find: (path) => byLower.get(path.toLowerCase()), text: (path) => files[path] ?? '' }
}

/**
 * Each banned name, floating literal or ** in one file's code (comments are trivia, never read).
 * `**` is as approximate as Math.pow; only a power of the literal 2 passes (descale's 2 ** n).
 */
function codeFindings(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind
      const powerOfTwo = ts.isNumericLiteral(node.left) && node.left.text === '2'
      if (operator === ts.SyntaxKind.AsteriskAsteriskEqualsToken) found.push(`${path}: **=`)
      else if (operator === ts.SyntaxKind.AsteriskAsteriskToken && !powerOfTwo) {
        found.push(`${path}: **`)
      }
    }
    if (ts.isNumericLiteral(node)) {
      const raw = node.getText(source)
      if (!/^0[xbo]/i.test(raw) && /[.eE]/.test(raw)) found.push(`${path}: floating literal ${raw}`)
    } else if (ts.isIdentifier(node) && BANNED_NAMES.has(node.text)) {
      found.push(`${path}: ${node.text}`)
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      BANNED_NAMES.has(node.text)
    ) {
      found.push(`${path}: '${node.text}'`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** The module specifiers a file loads: imports, re-exports, import(), require(). */
function specifiersOf(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const take = (node: ts.Node | undefined): void => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      found.push(node.text)
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) take(node.moduleSpecifier)
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      take(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** The file a specifier loads, undefined for a package, or a problem line. */
function resolveSpecifier(
  from: string,
  specifier: string,
  sources: Sources,
): { file: string } | { problem: string } | undefined {
  const spec = specifier.replace(/\\/g, '/')
  let base: string
  if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`
  else if (spec.startsWith('./') || spec.startsWith('../'))
    base = posix.join(posix.dirname(from), spec)
  else if (spec.startsWith('/') || /^[a-z]:\//i.test(spec) || /^file:/i.test(spec)) {
    return { problem: `${from}: loads '${specifier}' by an absolute path or URL` }
  } else return undefined
  const stem = posix.normalize(base)
  const extension = posix.extname(stem).toLowerCase()
  const swapped = TS_FOR_JS[extension]
    ? stem.slice(0, -extension.length) + TS_FOR_JS[extension]
    : stem
  for (const candidate of [
    stem,
    swapped,
    ...LOADABLE.map((ext) => stem + ext),
    ...LOADABLE.map((ext) => `${stem}/index${ext}`),
  ]) {
    const file = sources.find(candidate)
    if (file !== undefined) return { file }
  }
  return { problem: `${from}: cannot follow '${specifier}'` }
}

/** The g9 findings of `entries` and everything they load, and the files read. */
function integerScan(
  entries: readonly string[],
  sources: Sources,
): { findings: string[]; files: string[] } {
  const findings: string[] = []
  const seen = new Set<string>()
  const queue = [...entries]
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file.toLowerCase())) continue
    seen.add(file.toLowerCase())
    const text = sources.text(file)
    findings.push(...codeFindings(file, text))
    for (const specifier of specifiersOf(file, text)) {
      const resolved = resolveSpecifier(file, specifier, sources)
      if (resolved === undefined) continue
      if ('problem' in resolved) findings.push(resolved.problem)
      else queue.push(resolved.file)
    }
  }
  return { findings, files: [...seen] }
}

const ENTRIES = ['scripts/og/jpeg.ts', 'scripts/og/og-image.ts'] as const

describe('jpeg.ts and og-image.ts compute in integers only (T12-34 g9)', () => {
  it('(g9) the real modules and what they load hold no banned name, no ** but 2 ** n, no floating literal', () => {
    const { findings, files } = integerScan(ENTRIES, realSources)
    console.log(`[jpeg.test] integer scan read: ${files.sort().join(', ')}`)
    expect(files, 'precondition: the scan read both entries').toEqual(
      expect.arrayContaining(['scripts/og/jpeg.ts', 'scripts/og/og-image.ts']),
    )
    expect(findings, '(g9) findings in the real tree').toEqual([])
  })

  it.each([
    ['Math.cos', 'const x = Math.cos(1)', 'cos'],
    ['Math.sin', 'const x = Math.sin(1)', 'sin'],
    ['a computed literal key', "const x = Math['sqrt'](4)", "'sqrt'"],
    ['a computed template key', 'const x = Math[`PI`]', "'PI'"],
    ['optional chaining', 'const x = Math?.round(1)', 'round'],
    ['an alias', 'const M = Math\nconst y = M.fround(1)', 'fround'],
    ['destructuring', 'const { round } = Math', 'round'],
    ['destructuring with a rename', 'const { cos: c } = Math', 'cos'],
    ['Reflect.get', "const r = Reflect.get(Math, 'round')", "'round'"],
    ['globalThis.Math', 'const t = globalThis.Math.PI', 'PI'],
    ['0.5', 'const h = 0.5', 'floating literal 0.5'],
    ['.5', 'const h = .5', 'floating literal .5'],
    ['5.', 'const h = 5.', 'floating literal 5.'],
    ['1e3', 'const h = 1e3', 'floating literal 1e3'],
    ['2E-1', 'const h = 2E-1', 'floating literal 2E-1'],
    ['a separator', 'const h = 1_0.5', 'floating literal 1_0.5'],
    // 12b review round 1 (R1-ENC-1): every Math member outside the allow-list, and **.
    ['Math.atan', 'const x = Math.atan(1)', 'atan'],
    ['pi without PI', 'const pi = Math.atan(1) * 4', 'atan'],
    ['Math.exp', 'const x = Math.exp(2) / 3', 'exp'],
    ['Math.pow', 'const x = Math.pow(2, 3)', 'pow'],
    ['Math.tan', 'const x = Math.tan(1)', 'tan'],
    ['Math.random', 'const x = Math.random()', 'random'],
    ['Math.E', 'const x = Math.E', 'E'],
    ['Reflect.get of hypot', "const h = Reflect.get(Math, 'hypot')", "'hypot'"],
    ['the ** operator', 'const x = y ** z', '**'],
    ['a power of 3', 'const x = 3 ** n', '**'],
    ['**=', 'let x = 2\nx **= n', '**='],
  ] as const)('(g9) finds %s', (_form, code, finding) => {
    const { findings } = integerScan(
      ['scripts/og/jpeg.ts'],
      sampleSources({ 'scripts/og/jpeg.ts': code }),
    )
    expect(findings, `(g9) ${_form}`).toEqual([`scripts/og/jpeg.ts: ${finding}`])
  })

  it.each([
    ['a named import', "import { dct } from './dct'"],
    ['a .js name for the .ts file', "import { dct } from './dct.js'"],
    ['an export * wrapper', "export * from './dct'"],
    ['a dynamic import', "const m = import('./dct')"],
    ['require', "const m = require('./dct')"],
    ['the tsconfig alias', "import { dct } from '@/../scripts/og/dct'"],
    ['a different letter case', "import { dct } from './DCT'"],
  ] as const)('(g9) follows %s into a helper that uses Math.cos', (_form, code) => {
    const { findings } = integerScan(
      ['scripts/og/jpeg.ts'],
      sampleSources({
        'scripts/og/jpeg.ts': code,
        'scripts/og/dct.ts': 'export const dct = (x: number) => Math.cos(x)',
      }),
    )
    expect(findings, `(g9) ${_form}`).toEqual(['scripts/og/dct.ts: cos'])
  })

  it('(g9) follows a two-hop chain outside scripts/og', () => {
    const { findings } = integerScan(
      ['scripts/og/og-image.ts'],
      sampleSources({
        'scripts/og/og-image.ts': "import { mix } from '../lib/mix'",
        'scripts/lib/mix.ts': "export { mix } from '../../src/maths/blend'",
        'src/maths/blend.ts': 'export const mix = (a: number) => a * 0.5',
      }),
    )
    expect(findings, '(g9) two hops').toEqual(['src/maths/blend.ts: floating literal 0.5'])
  })

  it.each([
    [
      'a missing module',
      "import { x } from './gone'",
      "scripts/og/jpeg.ts: cannot follow './gone'",
    ],
    [
      'an absolute path',
      "import { x } from 'D:/repo/scripts/og/x'",
      "scripts/og/jpeg.ts: loads 'D:/repo/scripts/og/x' by an absolute path or URL",
    ],
  ] as const)('(g9) fails closed on %s', (_form, code, finding) => {
    const { findings } = integerScan(
      ['scripts/og/jpeg.ts'],
      sampleSources({ 'scripts/og/jpeg.ts': code }),
    )
    expect(findings, `(g9) ${_form}`).toEqual([finding])
  })

  it('(g9) passes comments, hex, the allowed Math members, 2 ** n, strings, separators and packages', () => {
    const code = [
      '// Math.cos, Math.round and JFIF 1.01 in a line comment',
      '/* T.81 Annex K: Math.PI, 0.5, sqrt(2) in a block comment */',
      '/** fround and 1e3 in a doc comment */',
      "import { deflateSync } from 'node:zlib'",
      'const marker = 0xE0',
      'const big = 0XFFE0',
      'const half = Math.floor(7 / 2)',
      'const cut = Math.trunc(-3)',
      'const lo = Math.min(1, 2)',
      'const hi = Math.max(1, 2)',
      'const size = Math.abs(-1)',
      'const product = Math.imul(3, 5)',
      'const zeros = Math.clz32(1)',
      'const sign = Math.sign(-2)',
      'const step = 2 ** n',
      "const name = 'JFIF'",
      "const text = 'rounding to the cosine'",
      'const million = 1_000_000',
    ].join('\n')
    const { findings } = integerScan(
      ['scripts/og/jpeg.ts'],
      sampleSources({ 'scripts/og/jpeg.ts': code }),
    )
    expect(findings, '(g9) the pass sample').toEqual([])
  })
})

// ITU-T T.81 Annex K, Tables K.3 to K.6 (the typical Huffman tables): the number of codes of each
// length 1..16, then the values in code order. Checked against the IJG tables (jcparam.c
// std_huff_tables).
const K3_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const K3_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const K4_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
const K4_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const K5_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]
const K5_VALUES = [
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
]
const K6_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]
const K6_VALUES = [
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
]
