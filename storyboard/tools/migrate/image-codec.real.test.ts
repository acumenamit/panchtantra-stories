// P1-9a (Step 17) the encoder (design migration-input/p1-step17-design.md D17-8, D17-9, §3.9, A13,
// A45; test plan §14.6: T17-10, T17-11). T17-10 loads the image package from next's dependency and
// runs on this PC only (win32 with the package loadable); elsewhere it is skipped with the line §8
// names, and the package is never loaded (WINDOWS IS NOT CI: no CI test encodes). T17-11 reads files
// only and runs on every OS: only tools/migrate/image-codec.ts names the package.
// Documented limits (L11-1): a name assembled at run time is not seen (catalogue lint class 13), and an
// alias in a config file (tsconfig.json paths, package.json imports) is not a script and not read.
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { EXPECTED_ENCODER, WEBP_SETTINGS, loadSharpCodec, type ImageCodec } from './image-codec'
import { pngOf } from './media-fixtures'
import { readWebpFacts } from './webp-facts'

const STORYBOARD = fileURLToPath(new URL('../../', import.meta.url))
const SKIP_LINE =
  "skipped: sharp from next's dependency is used on this PC only (p1-step17-design.md D17-9)"

/** True when the codec loads (called on win32 only, so CI never loads the package). */
function sharpLoadable(): boolean {
  try {
    loadSharpCodec()
    return true
  } catch {
    return false
  }
}

const runsHere = process.platform === 'win32' && sharpLoadable()
if (!runsHere) console.log(SKIP_LINE)

const dims = (bytes: Uint8Array): string => {
  const read = readWebpFacts(bytes)
  return read.ok ? `${read.width}x${read.height}` : `refused ${read.reason}`
}

describe.skipIf(!runsHere)('the encoder (this PC only)', () => {
  it(
    "T17-10 sharp from next's dependency: the pinned versions, the same bytes twice, one VP8 chunk with every input metadata dropped, no rotation, no upscale (A13, D17-8, D17-9)",
    { timeout: 60_000 },
    async () => {
      let codec: ImageCodec | null = null
      try {
        codec = loadSharpCodec()
      } catch {
        codec = null
      }
      expect(codec, "precondition: loadSharpCodec() resolves through next's package.json").not.toBe(
        null,
      )
      if (codec === null) return
      // P5's form: a bare TIFF block in zTXt "Raw profile type APP1", plus an eXIf chunk, both with
      // Orientation 6 (rotate 90 degrees), and a caBX chunk.
      const wide = pngOf({
        width: 1408,
        height: 768,
        chunks: ['zTXt', 'eXIf', 'caBX'],
        orientation: 6,
      })
      const square = pngOf({ width: 1024, height: 1024, seed: 'square' })

      // g1 the versions.
      expect
        .soft(EXPECTED_ENCODER, '(g1) EXPECTED_ENCODER is the pinned literal (P4)')
        .toEqual({ sharp: '0.35.5', vips: '8.18.7', webp: '1.6.0' })
      expect.soft(codec.versions, '(g1) the loaded versions equal EXPECTED_ENCODER').toEqual({
        ...EXPECTED_ENCODER,
      })

      // g2 the same (master, width) twice gives the same bytes.
      const first = await codec.encode(wide, 768)
      const second = await codec.encode(wide, 768)
      expect.soft(Buffer.compare(first, second), '(g2) the same bytes twice (768)').toBe(0)

      // g3 and g4: each output is one VP8 key frame of the expected size.
      const outputs: [string, Uint8Array, string][] = [
        ['1408x768 at 768', first, '768x419'],
        ['1408x768 at 1408', await codec.encode(wide, 1408), '1408x768'],
        ['1024x1024 at 768', await codec.encode(square, 768), '768x768'],
        ['1024x1024 at 1024', await codec.encode(square, 1024), '1024x1024'],
      ]
      for (const [name, bytes] of outputs) {
        expect
          .soft(
            readWebpFacts(bytes).ok,
            `(g3) ${name}: webp-facts passes (no EXIF, XMP, ICCP, VP8X)`,
          )
          .toBe(true)
      }
      for (const [name, bytes, want] of outputs) {
        expect.soft(dims(bytes), `(g4) ${name}: the frame is ${want}, never rotated`).toBe(want)
      }

      // g5 never an upscale.
      expect
        .soft(
          dims(await codec.encode(square, 2048)),
          '(g5) the 1024 master at 2048 stays 1024x1024',
        )
        .toBe('1024x1024')

      // g6 the settings literal.
      expect.soft(WEBP_SETTINGS, '(g6) WEBP_SETTINGS is the §3.9 literal').toEqual({
        concurrency: 1,
        cache: false,
        input: { failOn: 'error', limitInputPixels: 16_777_216, sequentialRead: true },
        resize: { kernel: 'lanczos3', withoutEnlargement: true },
        webp: { quality: 80, effort: 6, smartSubsample: false },
      })
    },
  )
})

// ---- T17-11: the package-name scan ----

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
])
const SCAN_FOLDERS = ['app', 'e2e', 'scripts', 'src', 'tools'] as const
/** The test files the runners run (storage-fence.test.ts's RUN_BY_VITEST and RUN_BY_PLAYWRIGHT). */
const RUN_BY_VITEST = /^(?:src|tools|scripts)(?:\/[^/.][^/]*)*\/[^/.][^/]*\.test\.ts$/
const RUN_BY_PLAYWRIGHT = /^e2e(?:\/[^/.][^/]*)*\/[^/.][^/]*\.(?:spec|test)\.[cm]?[jt]sx?$/
const CODEC = 'tools/migrate/image-codec.ts'

interface ScriptFile {
  readonly path: string
  readonly text: string
}

interface NameFinding {
  readonly path: string
  readonly line: number
  readonly text: string
  /** The literal initialises `const SHARP_ID`. */
  readonly asSharpId: boolean
}

const isRunnerTest = (path: string): boolean =>
  RUN_BY_VITEST.test(path) || RUN_BY_PLAYWRIGHT.test(path)

/** A script the scanner judges: a script extension, not a test file a runner runs. */
const isScannedScript = (path: string): boolean =>
  SCRIPT_EXTENSIONS.has(extname(path).toLowerCase()) && !isRunnerTest(path)

function scriptKind(path: string): ts.ScriptKind {
  const ext = extname(path).toLowerCase()
  if (ext === '.tsx') return ts.ScriptKind.TSX
  if (ext === '.jsx') return ts.ScriptKind.JSX
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/**
 * A path segment that names the package (S17-R1-SEC-3), in any case and with either separator:
 * `sharp` as a whole segment (`…/node_modules/sharp`, `sharp/lib/index.js`), a pnpm store name
 * `sharp@<version>…`, or an `@img/sharp…` or `@img+sharp…` (store) segment anywhere in the text.
 * `sharpness` and `unsharp` are not segments.
 */
const SHARP_SEGMENT = /(?:^|[\\/])(?:sharp(?:@|[\\/]|$)|@img[\\/+]sharp)/i

/**
 * The text with every `%XX` escape decoded as one byte (S17-R2-SEC-1): Node decodes the escapes of
 * a file URL, an ESM relative specifier and a createRequire URL base once before it resolves the
 * path, so `%73harp` and `%40img/sharp…` load the package. Each escape is decoded on its own, so a
 * malformed escape elsewhere in the literal (`?v=%zz`, `#%E0`) cannot hide one; one pass, as Node
 * decodes once (`%2573harp` is the folder `%73harp`). Only ASCII names the package: this PC's NTFS
 * folds neither U+017F nor U+0131 to an ASCII letter (probed), so a byte is enough.
 */
const percentDecoded = (text: string): string =>
  text.replace(/%([0-9a-f]{2})/gi, (_escape, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )

/** `sharp` in any case, a name starting `@img/sharp`, or a path that holds a SHARP_SEGMENT. */
const namesSharpAsWritten = (text: string): boolean => {
  const folded = text.toLowerCase()
  return folded === 'sharp' || folded.startsWith('@img/sharp') || SHARP_SEGMENT.test(text)
}

/** A literal that names the package as written or once its `%XX` escapes are decoded. */
const namesSharp = (text: string): boolean =>
  namesSharpAsWritten(text) || namesSharpAsWritten(percentDecoded(text))

/** Every string or no-substitution template literal that names the package, per scanned script. */
function sharpNames(files: readonly ScriptFile[]): NameFinding[] {
  const findings: NameFinding[] = []
  for (const file of files) {
    if (!isScannedScript(file.path)) continue
    const source = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file.path),
    )
    const visit = (node: ts.Node): void => {
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        namesSharp(node.text)
      ) {
        const parent = node.parent
        findings.push({
          path: file.path,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          text: node.text,
          asSharpId:
            ts.isVariableDeclaration(parent) &&
            ts.isIdentifier(parent.name) &&
            parent.name.text === 'SHARP_ID' &&
            parent.initializer === node,
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return findings
}

/** Every file under the scanned folders and the root's script files, as repository paths. */
function listRepositoryScripts(): ScriptFile[] {
  const files: ScriptFile[] = []
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(STORYBOARD, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(path)
      } else if (
        entry.isFile() &&
        SCRIPT_EXTENSIONS.has(extname(path).toLowerCase()) &&
        !isRunnerTest(path)
      ) {
        files.push({ path, text: readFileSync(join(STORYBOARD, path), 'utf8') })
      }
    }
  }
  for (const folder of SCAN_FOLDERS) walk(folder)
  for (const entry of readdirSync(STORYBOARD, { withFileTypes: true })) {
    if (entry.isFile() && SCRIPT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push({ path: entry.name, text: readFileSync(join(STORYBOARD, entry.name), 'utf8') })
    }
  }
  return files
}

/** `createRequire(import.meta.url).resolve('next/package.json')`. */
function isNextAnchor(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return false
  const [argument] = node.arguments
  if (!argument || !ts.isStringLiteral(argument) || argument.text !== 'next/package.json')
    return false
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'resolve') return false
  const inner = callee.expression
  return (
    ts.isCallExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    inner.expression.text === 'createRequire' &&
    inner.arguments.length === 1 &&
    inner.arguments[0]?.getText() === 'import.meta.url'
  )
}

/**
 * Every call that takes SHARP_ID, each as true when it is `createRequire(<anchor>)(SHARP_ID)` with
 * the anchor written inline or held by a const initialised to it.
 */
function sharpLoads(text: string): boolean[] {
  const source = ts.createSourceFile(CODEC, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const anchors = new Set<string>()
  const loads: boolean[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      isNextAnchor(node.initializer)
    ) {
      anchors.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const visitCalls = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.arguments.some((a) => ts.isIdentifier(a) && a.text === 'SHARP_ID')
    ) {
      const callee = node.expression
      const anchored =
        ts.isCallExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'createRequire' &&
        callee.arguments.length === 1 &&
        (isNextAnchor(callee.arguments[0]!) ||
          (ts.isIdentifier(callee.arguments[0]!) && anchors.has(callee.arguments[0].text)))
      loads.push(anchored)
    }
    ts.forEachChild(node, visitCalls)
  }
  visitCalls(source)
  return loads
}

const show = (findings: readonly NameFinding[]): string[] =>
  findings.map((f) => `${f.path}:${f.line} ${f.text}${f.asSharpId ? ' (SHARP_ID)' : ''}`)

describe('the package-name scan (every OS)', () => {
  it("T17-11 only tools/migrate/image-codec.ts names sharp, once, as SHARP_ID, loaded through createRequire anchored at next's package.json; no other script loads or names it in any form (A13, TP17-11, S17-TP-5)", () => {
    const files = listRepositoryScripts()
    expect(
      files.length,
      'precondition: at least 200 non-test script files under app, e2e, scripts, src, tools and the root',
    ).toBeGreaterThanOrEqual(200)
    expect(
      files.filter((f) => !f.path.includes('/')).map((f) => f.path),
      'precondition: the five root config files are read',
    ).toEqual(
      expect.arrayContaining([
        'eslint.config.mjs',
        'next-env.d.ts',
        'next.config.ts',
        'playwright.config.ts',
        'vitest.config.mts',
      ]),
    )
    const codec = files.find((f) => f.path === CODEC)
    expect(codec, 'precondition: the scan reads image-codec.ts').toBeDefined()

    // g1 the real tree.
    const findings = sharpNames(files)
    expect
      .soft(show(findings), '(g1) exactly one literal names the package: image-codec.ts SHARP_ID')
      .toEqual([expect.stringMatching(/^tools\/migrate\/image-codec\.ts:\d+ sharp \(SHARP_ID\)$/)])
    expect
      .soft(
        sharpLoads(codec?.text ?? ''),
        "(g1) the one load is createRequire(createRequire(import.meta.url).resolve('next/package.json'))(SHARP_ID)",
      )
      .toEqual([true])

    // g2 in-memory samples: each a finding outside image-codec.ts.
    const samples: [string, string][] = [
      ['tools/x/a.ts', "import s from 'sharp'"],
      ['tools/x/b.ts', "import type { Sharp } from 'sharp'"],
      ['tools/x/c.ts', "export * from 'sharp'"],
      ['tools/x/d.ts', "export async function f() { return await import('sharp') }"],
      ['tools/x/e.ts', "const s = require('sharp')"],
      ['tools/x/f.ts', 'const s = require(`sharp`)'],
      ['tools/x/g.ts', 'const id = "sharp"'],
      ['tools/x/h.ts', "const p = '@img/sharp-win32-x64'"],
      ['tools/x/i.ts', "const id = 'SHARP'"],
      ['tools/x/m.ts', "import s = require('sharp')"],
      ['scripts/x/j.mjs', "import s from 'sharp'"],
      ['scripts/x/k.cjs', "import s from 'sharp'"],
      ['app/x/l.tsx', "import s from 'sharp'"],
      ['tools/x/n.mts', "import s from 'sharp'"],
      ['tools/x/o.cts', "import s from 'sharp'"],
      ['scripts/x/p.js', "import s from 'sharp'"],
      ['app/x/q.jsx', "import s from 'sharp'"],
      // S17-R1-SEC-3: a path literal that loads the package from the pnpm store or by a subpath.
      [
        'tools/x/r.ts',
        "const s = require('../../node_modules/.pnpm/sharp@0.35.5_@types+node@24.19.2/node_modules/sharp')",
      ],
      [
        'tools/x/s.ts',
        "const b = '../../node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node'",
      ],
      ['tools/x/t.ts', "const s = require('sharp/lib/index.js')"],
      ['tools/x/u.ts', "const s = require('..\\\\..\\\\node_modules\\\\Sharp')"],
      ['tools/x/v.ts', "const d = 'node_modules/.pnpm/@img+sharp-win32-x64@0.35.5'"],
      ['tools/x/w.ts', 'const s = require(`./node_modules/sharp@0.35.5/index.js`)'],
      // S17-R2-SEC-1: percent escapes, which Node decodes in a file URL, an ESM relative specifier
      // and a createRequire URL base before it resolves the path.
      [
        'tools/x/p1.ts',
        "export async function f() { return await import('../../node_modules/%73harp/lib/index.js') }",
      ],
      [
        'tools/x/p2.ts',
        "export async function f() { return await import('../../node_modules/sh%61rp/lib/index.js') }",
      ],
      [
        'tools/x/p3.ts',
        "const b = '../../node_modules/@img/%73harp-win32-x64/lib/sharp-win32-x64.node'",
      ],
      ['tools/x/p4.ts', "const u = new URL('file:///D:/x/node_modules/%73harp/lib/index.js')"],
      [
        'tools/x/p5.ts',
        "const r = createRequire(new URL('./%40img/sharp-win32-x64/lib/', import.meta.url))",
      ],
      ['tools/x/p6.ts', "const n = 'node_modules/%40img/sharp-win32-x64/lib/sharp-win32-x64.node'"],
      ['tools/x/p7.ts', "const p = '@img%2Fsharp-win32-x64'"],
      ['tools/x/p8.ts', "const q = 'node_modules%5c%73harp'"],
      ['tools/x/p9.ts', "const id = '%53HARP'"],
      [
        'tools/x/pa.ts',
        "export async function f() { return await import('./node_modules/%73harp/x.mjs?v=%zz') }",
      ],
      [
        'tools/x/pb.ts',
        "export async function f() { return await import('./node_modules/%73harp/x.mjs#%E0%A4') }",
      ],
    ]
    for (const [path, text] of samples) {
      expect
        .soft(
          sharpNames([{ path, text }]).map((f) => f.path),
          `(g2) ${path}: ${text} is a finding`,
        )
        .toEqual([path])
    }
    for (const text of [
      "const a = 'sharpness'",
      "const b = 'unsharp'",
      "const c = 'tools/sharpen.ts'",
      "const d = 'docs/unsharp/x'",
      // S17-R2-SEC-1 near misses: decoded once, these are not the package.
      "const e = 'tools/%73harpen.ts'",
      "const f = 'docs/un%73harp/x'",
      "const g = '../../node_modules/%2573harp/lib/index.js'",
      "const h = '50% sharpness'",
    ]) {
      expect
        .soft(sharpNames([{ path: 'tools/x/clean.ts', text }]), `(g2) clean: ${text}`)
        .toEqual([])
    }
  })
})
