// P1-9a (Step 17) the legacy image map's rules (design migration-input/p1-step17-design.md D17-4,
// D17-5, D17-28, §3.4, §3.5, §3.5.1, A9, A10, A36, A40, A41, A47; test plan §14.3: T17-4 to T17-7).
// T17-4 and T17-7 share one derivation of the committed pt/ (11 story modules, 84 tracked image
// files), made once in a beforeAll with a 60 s timeout (D17-34). Counts, ids, paths and hashes
// only: no story text is read into an assertion.
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readLocalFile, type LocalFileCode, type LocalRead } from '../publisher/local-files'
import {
  applyImageMapOverrides,
  checkImageMap,
  countImageRows,
  deriveLegacyImageRows,
  ImageMapFile,
  parseImageMapOverrides,
  type LegacyDerivation,
  type LegacyImageRow,
  type LegacyImageStory,
} from './legacy-images'
import { loadLegacyStories } from './load-legacy'
import { pngOf, vp8Of } from './media-fixtures'

const STORYBOARD = fileURLToPath(new URL('../../', import.meta.url))
const PT = resolve(STORYBOARD, '..', 'pt')
const OVERRIDES = join(STORYBOARD, 'tools', 'migrate', 'image-map-overrides.json')
const CAP = 20_971_520
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** The rows of a derivation, or none (so a failed derivation fails the count groups, not a precondition). */
const rowsOf = (d: LegacyDerivation): readonly LegacyImageRow[] => (d.ok ? d.rows : [])
const problemsOf = (d: LegacyDerivation): string[] =>
  d.ok ? [] : d.problems.map((p) => `${p.code} ${p.storyId} ${p.nodeId}`)

// ---- the shared derivation of the committed pt/ (T17-4, T17-7) ----

interface ListedFile {
  /** `/images/...`, as a legacy module names it. */
  readonly path: string
  readonly sha256: string
  /** The first three bytes, hex. */
  readonly head: string
}

let stories: LegacyImageStory[] = []
let derivation: LegacyDerivation = { ok: false, problems: [] }
let listing: ListedFile[] = []
let overridesBytes = new Uint8Array(0)

/** Every file under pt/public/images, read once: its path, sha256 and first three bytes. */
function listImages(): ListedFile[] {
  const out: ListedFile[] = []
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(PT, 'public', relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const bytes = readFileSync(join(PT, 'public', path))
        out.push({
          path: `/${path}`,
          sha256: sha256(bytes),
          head: bytes.subarray(0, 3).toString('hex'),
        })
      }
    }
  }
  walk('images')
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

beforeAll(() => {
  stories = loadLegacyStories(join(PT, 'src', 'stories')).map((loaded) => loaded.story)
  derivation = deriveLegacyImageRows(stories, (segments, cap) =>
    readLocalFile(join(PT, 'public'), segments, cap),
  )
  listing = listImages()
  overridesBytes = new Uint8Array(readFileSync(OVERRIDES))
}, 60_000)

// ---- synthetic stories (T17-5, T17-6) ----

const STORY = 'syn-story'
const KEEP_PNG = pngOf({ width: 1024, height: 1024, chunks: ['sBIT', 'caBX'], seed: 'keep' })
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])
const SYNTHETIC: LegacyImageStory = {
  id: STORY,
  nodes: {
    start: { image: '/images/syn/start.jpg' },
    jpeg_node: { image: '/images/syn/photo.jpg' },
    gone_node: { image: '/images/syn/gone.jpg' },
    plain_node: {},
  },
}

interface Call {
  readonly segments: readonly string[]
  readonly cap: number
}

/**
 * An in-memory reader over `images/...` keys. It looks a file up by its non-empty segments, so a
 * wrong segment form still reads and the call log (T17-5 g1) is what proves the form.
 */
function memoryReader(files: Readonly<Record<string, Uint8Array>>) {
  const calls: Call[] = []
  const read = (segments: readonly string[], cap: number): LocalRead => {
    calls.push({ segments: [...segments], cap })
    const bytes = files[segments.filter((s) => s !== '').join('/')]
    return bytes === undefined
      ? { ok: false, code: 'local-file-missing' }
      : { ok: true, bytes: new Uint8Array(bytes) }
  }
  return { read, calls }
}

const SYNTHETIC_FILES = { 'images/syn/start.jpg': KEEP_PNG, 'images/syn/photo.jpg': JPEG }
const actionsOf = (d: LegacyDerivation): string[] =>
  d.ok ? d.rows.map((r) => `${r.nodeId} ${r.action}`) : problemsOf(d)

/** One node naming `image`, read through `read`. */
const oneNode = (image: string): LegacyImageStory => ({ id: STORY, nodes: { start: { image } } })

let temp: string | null = null
afterEach(() => {
  if (temp !== null) rmSync(temp, { recursive: true, force: true })
  temp = null
})

/** Creates a link, or answers 'skip' on win32 when this PC may not (PB3: EPERM or EACCES only). */
function tryLink(target: string, path: string, type: 'dir' | 'junction'): 'ok' | 'skip' {
  try {
    symlinkSync(target, path, type)
    return 'ok'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) return 'skip'
    throw error
  }
}

/** A map file's rows as the 17a table writes them, with the keys the binder ignores. */
function mapRowsOf(rows: readonly LegacyImageRow[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    storyId: r.storyId,
    nodeId: r.nodeId,
    action: r.action,
    legacyPath: r.legacyPath,
    fileExists: r.fileSha256 !== null,
    fileSha256: r.fileSha256,
    realFormat: r.realFormat,
    size: r.size,
    bytes: r.bytes,
    master: null,
    plannedVariants: [],
    excerptEn: 'excerpt',
    notes: 'note',
  }))
}
const asMap = (rows: readonly Record<string, unknown>[], extra: object = {}): ImageMapFile =>
  ({ ...extra, rows }) as unknown as ImageMapFile
const verdictOf = (result: ReturnType<typeof checkImageMap>): string[] =>
  result.ok
    ? ['ok']
    : result.problems.map((p) =>
        p.code === 'map-rows' ? p.code : `${p.code} ${p.storyId} ${p.nodeId}`,
      )

describe('legacy images: the derivation of the committed pt/', () => {
  it(
    'T17-4 the committed pt/ derives 95 rows: 54 keep, 8 recreate, 32 missing, 1 new; 24 square and 30 wide, 54 with caBX; 84 files = 62 named + 22 unused twins; 30 unbound (A9, CRIT-3, CRIT-8)',
    { timeout: 60_000 },
    () => {
      expect(stories.length, 'precondition: 11 legacy stories').toBe(11)
      expect(listing.length, 'precondition: the walk of pt/public/images finds 84 files').toBe(84)
      const committed = parseImageMapOverrides(overridesBytes)
      expect(committed.ok, 'precondition: the committed overrides parse').toBe(true)
      const records = committed.ok ? committed.records : []
      const k = records.length
      const raw = rowsOf(derivation)
      const applied = applyImageMapOverrides(raw, records)
      const bound = applied.ok ? applied.rows : []

      // g1 counts.
      expect.soft(problemsOf(derivation), '(g1) the derivation has no problem').toEqual([])
      expect
        .soft(countImageRows(bound), '(g1) 95 rows: keep 54 - k, recreate 8 + k, missing 32, new 1')
        .toEqual({ rows: 95, keep: 54 - k, recreate: 8 + k, missing: 32, new: 1 })
      const paths = raw.flatMap((r) => (r.legacyPath === null ? [] : [r.legacyPath]))
      expect
        .soft(
          [paths.length, paths.filter((p) => p.startsWith('/images/')).length],
          '(g1) 94 legacy paths, all under /images/',
        )
        .toEqual([94, 94])
      if (k === 0) {
        const ids = [...new Set(bound.map((r) => r.storyId))].sort()
        expect
          .soft(
            ids.map((id) => bound.filter((r) => r.storyId === id && r.action !== 'keep').length),
            '(g1) nodes without a picture per story, in id order',
          )
          .toEqual([1, 0, 0, 0, 9, 0, 13, 10, 0, 0, 8])
      }

      // g2 keep facts (the raw rows: k does not change a file's facts).
      const keep = raw.filter((r) => r.action === 'keep')
      const sizes = keep.map((r) => r.size)
      expect
        .soft(
          {
            square: sizes.filter((s) => s === '1024x1024').length,
            wide: sizes.filter((s) => s === '1408x768').length,
            other: sizes.filter((s) => s !== '1024x1024' && s !== '1408x768').length,
            caBX: keep.filter((r) => r.caBX === true).length,
          },
          '(g2) 24 at 1024x1024, 30 at 1408x768, no other size, caBX in 54',
        )
        .toEqual({ square: 24, wide: 30, other: 0, caBX: 54 })
      const existing = raw.filter((r) => r.fileSha256 !== null)
      expect
        .soft(
          {
            files: existing.length,
            paths: new Set(existing.map((r) => r.legacyPath)).size,
            hashes: new Set(existing.map((r) => r.fileSha256)).size,
          },
          '(g2) 62 existing files: 0 shared paths, 0 shared sha256',
        )
        .toEqual({ files: 62, paths: 62, hashes: 62 })

      // g3 files: named, unused twins, unbound.
      const named = new Set(existing.map((r) => r.legacyPath))
      const namedHashes = new Set(existing.map((r) => r.fileSha256))
      const unused = listing.filter((f) => !named.has(f.path))
      expect
        .soft(
          [listing.filter((f) => named.has(f.path)).length, unused.length],
          '(g3) 84 files = 62 named by a row + 22 named by none',
        )
        .toEqual([62, 22])
      expect
        .soft(
          unused.filter((f) => !namedHashes.has(f.sha256)).map((f) => f.path),
          '(g3) each of the 22 has the sha256 of a named file',
        )
        .toEqual([])
      const keptPaths = new Set(keep.map((r) => r.legacyPath))
      const unbound = listing.filter((f) => !keptPaths.has(f.path))
      const recreatePaths = new Set(
        raw.filter((r) => r.action === 'recreate-step22').map((r) => r.legacyPath),
      )
      const recreateFiles = listing.filter((f) => recreatePaths.has(f.path))
      expect
        .soft(
          {
            unbound: unbound.length,
            unused: unbound.filter((f) => !named.has(f.path)).length,
            recreate: recreateFiles.length,
            recreateJpeg: recreateFiles.filter((f) => f.head === 'ffd8ff').length,
          },
          '(g3) 30 unbound = 22 unused + the 8 recreate files, each starting FF D8 FF',
        )
        .toEqual({ unbound: 30, unused: 22, recreate: 8, recreateJpeg: 8 })
    },
  )
})

describe('legacy images: the rules on synthetic stories', () => {
  it('T17-5 deriveLegacyImageRows on synthetic stories: the action rule by magic bytes; the /images/ rule; readLocalFile with path.slice(1) segments and the 20 MiB cap; missing is missing-step22 and every other refusal master-read (A9, CRIT-8)', () => {
    const memory = memoryReader(SYNTHETIC_FILES)
    const derived = deriveLegacyImageRows([SYNTHETIC], memory.read)
    expect(
      actionsOf(derived),
      'precondition: a PNG, a JPEG, a path naming no file and no field derive the four actions',
    ).toEqual([
      'start keep',
      'jpeg_node recreate-step22',
      'gone_node missing-step22',
      'plain_node new-step22',
    ])

    // g1 the read.
    expect
      .soft(memory.calls, '(g1) one call per path, path.slice(1) segments, the 20 MiB cap')
      .toEqual([
        { segments: ['images', 'syn', 'start.jpg'], cap: CAP },
        { segments: ['images', 'syn', 'photo.jpg'], cap: CAP },
        { segments: ['images', 'syn', 'gone.jpg'], cap: CAP },
      ])

    // g2 refusal codes.
    const refusals: LocalFileCode[] = [
      'local-file-path',
      'local-file-not-regular',
      'local-file-too-large',
      'local-file-changed',
    ]
    for (const code of refusals) {
      const refused = deriveLegacyImageRows([oneNode('/images/syn/x.png')], () => ({
        ok: false,
        code,
      }))
      expect
        .soft(actionsOf(refused), `(g2) ${code} is master-read`)
        .toEqual([`master-read ${STORY} start`])
    }
    const missing = deriveLegacyImageRows([oneNode('/images/syn/x.png')], () => ({
      ok: false,
      code: 'local-file-missing',
    }))
    expect
      .soft(actionsOf(missing), '(g2) local-file-missing is missing-step22')
      .toEqual(['start missing-step22'])

    // g3 path forms through the real readLocalFile over a temp copy.
    temp = mkdtempSync(join(tmpdir(), 's17-legacy-'))
    mkdirSync(join(temp, 'images', 'the-x'), { recursive: true })
    writeFileSync(join(temp, 'images', 'the-x', 'a.png'), KEEP_PNG)
    const root = temp
    const real = (image: string): string[] =>
      actionsOf(
        deriveLegacyImageRows([oneNode(image)], (segments, cap) =>
          readLocalFile(root, segments, cap),
        ),
      )
    expect(real('/images/the-x/a.png'), 'precondition: the real file reads as keep').toEqual([
      'start keep',
    ])
    const linked = tryLink(
      join(root, 'images', 'the-x'),
      join(root, 'images', 'jn'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    if (linked === 'skip') console.log('skipped: junction not creatable here (PB3)')
    const masterRead = [
      'images/the-x/a.png',
      '/Images/the-x/a.png',
      '/img/a.png',
      '/images\\the-x\\a.png',
      '/images/../images/the-x/a.png',
      '/images/./the-x/a.png',
      '/images/the-x//a.png',
      '/images/%2e%2e/a.png',
      '/images/the-x%2fa.png',
      '/images/the-x/a.png:x',
      '//host/images/a.png',
      '\\\\?\\C:\\images\\the-x\\a.png',
      '/images/the-x/a.png/',
      '/images/THE-X~1/a.png',
      '/images/the-x/a.png ',
      ...(linked === 'ok' ? ['/images/jn/a.png'] : []),
    ]
    for (const image of masterRead) {
      expect
        .soft(real(image), `(g3) ${JSON.stringify(image)} is master-read`)
        .toEqual([`master-read ${STORY} start`])
    }
    for (const image of ['/images/the-x/A.png', '/images/the-x/a.png.']) {
      expect
        .soft(real(image), `(g3) ${JSON.stringify(image)} is missing-step22, never the other file`)
        .toEqual(['start missing-step22'])
    }

    // g4 magic.
    const sevenOfEight = new Uint8Array(KEEP_PNG)
    sevenOfEight[7] = 0x00
    const truncated = new Uint8Array(KEEP_PNG.subarray(0, 8 + 25 + 8))
    const magic: [string, Uint8Array, string][] = [
      ['the 8-byte signature and IHDR (a whole PNG)', KEEP_PNG, 'start keep'],
      ['7 of the 8 signature bytes', sevenOfEight, `legacy-format-unknown ${STORY} start`],
      ['FF D8 FF', JPEG, 'start recreate-step22'],
      ['FF D8 00', Uint8Array.of(0xff, 0xd8, 0x00, 0xe0), `legacy-format-unknown ${STORY} start`],
      ['GIF89a', utf8('GIF89a\u0001\u0000\u0001\u0000'), `legacy-format-unknown ${STORY} start`],
      ['RIFF....WEBP', vp8Of({ width: 8, height: 8 }), `legacy-format-unknown ${STORY} start`],
      ['0 bytes', new Uint8Array(0), `legacy-format-unknown ${STORY} start`],
      ['2 bytes', Uint8Array.of(0xff, 0xd8), `legacy-format-unknown ${STORY} start`],
      [
        'the signature and IHDR, then a chunk length past the end',
        truncated,
        `legacy-format-unknown ${STORY} start`,
      ],
    ]
    expect(
      new DataView(truncated.buffer).getUint32(33) + 12 > truncated.length - 33,
      'precondition: the truncated sample keeps a chunk header whose length runs past the end',
    ).toBe(true)
    for (const [name, bytes, want] of magic) {
      const one = memoryReader({ 'images/syn/x.png': bytes })
      expect
        .soft(
          actionsOf(deriveLegacyImageRows([oneNode('/images/syn/x.png')], one.read)),
          `(g4) ${name}`,
        )
        .toEqual([want])
    }

    // g5 facts.
    const rows = rowsOf(derived)
    const pick = (r: LegacyImageRow | undefined) =>
      r && {
        fileSha256: r.fileSha256,
        realFormat: r.realFormat,
        size: r.size,
        bytes: r.bytes,
        width: r.width,
        height: r.height,
        caBX: r.caBX,
      }
    expect.soft(pick(rows.find((r) => r.action === 'keep')), '(g5) the keep row facts').toEqual({
      fileSha256: sha256(KEEP_PNG),
      realFormat: 'PNG',
      size: '1024x1024',
      bytes: KEEP_PNG.length,
      width: 1024,
      height: 1024,
      caBX: true,
    })
    expect
      .soft(
        pick(rows.find((r) => r.action === 'recreate-step22')),
        '(g5) the recreate row: sha256, JPEG, bytes; no size and no master facts',
      )
      .toEqual({
        fileSha256: sha256(JPEG),
        realFormat: 'JPEG',
        size: null,
        bytes: JPEG.length,
        width: null,
        height: null,
        caBX: null,
      })
    const noCabx = pngOf({ width: 1408, height: 768, chunks: ['sBIT', 'zTXt'] })
    const plain = deriveLegacyImageRows(
      [oneNode('/images/syn/x.png')],
      memoryReader({ 'images/syn/x.png': noCabx }).read,
    )
    expect
      .soft(
        rowsOf(plain).map((r) => [r.size, r.caBX]),
        '(g5) a 1408x768 keep without caBX reads caBX false',
      )
      .toEqual([['1408x768', false]])
    expect
      .soft(
        derived.ok ? derived.masters.get(sha256(KEEP_PNG)) : undefined,
        '(g5) the keep file bytes are held by their sha256 for the binder',
      )
      .toEqual(KEEP_PNG)
    expect
      .soft(derived.ok ? [...derived.masters.keys()] : [], '(g5) only keep files are held')
      .toEqual([sha256(KEEP_PNG)])
  })

  it("T17-6 checkImageMap: the row set is the phase-1 nodes once each; every key field equals the raw derivation, before overrides (size on keep rows only); other keys and the map's counts are ignored; an empty map is refused (A10, TP17-15)", () => {
    const raw = rowsOf(deriveLegacyImageRows([SYNTHETIC], memoryReader(SYNTHETIC_FILES).read))
    const rows = mapRowsOf(raw)
    const totals = { nodes: 4, keep: 1, 'recreate-step22': 1, 'missing-step22': 1, 'new-step22': 1 }
    expect(raw.length, 'precondition: 4 derived rows').toBe(4)
    expect(
      ImageMapFile.safeParse({ totals, rows }).success,
      'precondition: the map file schema parses the rows (other keys ignored)',
    ).toBe(true)
    expect(
      verdictOf(checkImageMap(asMap(rows, { totals }), raw)),
      'precondition: a map built from the derivation passes',
    ).toEqual(['ok'])

    // g1 the row set.
    const other = rows.map((r) => ({ ...r, storyId: 'other-story' }))
    const sets: [string, Record<string, unknown>[], readonly LegacyImageRow[]][] = [
      ['a row removed', rows.slice(1), raw],
      ['a row for an unknown node', [...rows, { ...rows[0], nodeId: 'unknown_node' }], raw],
      ['a row twice', [...rows, rows[0]!], raw],
      ['rows []', [], raw],
      ['rows of another story only', other, raw],
      ['rows [] with an empty derivation', [], []],
    ]
    for (const [name, mapRows, derivedRows] of sets) {
      expect
        .soft(verdictOf(checkImageMap(asMap(mapRows), derivedRows)), `(g1) map-rows: ${name}`)
        .toEqual(['map-rows'])
    }

    // g2 each key field changed alone.
    const keepAt = raw.findIndex((r) => r.action === 'keep')
    const recreateAt = raw.findIndex((r) => r.action === 'recreate-step22')
    const changed = (at: number, field: string, value: unknown) =>
      rows.map((r, i) => (i === at ? { ...r, [field]: value } : r))
    const keepPath = raw[keepAt]?.legacyPath ?? ''
    const fields: [string, Record<string, unknown>[], string][] = [
      ['action', changed(keepAt, 'action', 'recreate-step22'), 'start'],
      ['legacyPath', changed(keepAt, 'legacyPath', '/images/syn/other.jpg'), 'start'],
      [
        'legacyPath in another case',
        changed(keepAt, 'legacyPath', keepPath.toUpperCase()),
        'start',
      ],
      ['fileSha256', changed(keepAt, 'fileSha256', 'a'.repeat(64)), 'start'],
      ['realFormat', changed(keepAt, 'realFormat', 'JPEG'), 'start'],
      ["a keep row's size", changed(keepAt, 'size', '1408x768'), 'start'],
      ['bytes', changed(recreateAt, 'bytes', JPEG.length + 1), 'jpeg_node'],
    ]
    for (const [name, mapRows, nodeId] of fields) {
      expect
        .soft(verdictOf(checkImageMap(asMap(mapRows), raw)), `(g2) ${name} changed alone`)
        .toEqual([`map-row-stale ${STORY} ${nodeId}`])
    }
    // The 17a table holds 1024x1024 on the recreate rows, which nothing derives (TP17-15).
    expect
      .soft(
        verdictOf(checkImageMap(asMap(changed(recreateAt, 'size', '1024x1024')), raw)),
        "(g2) the recreate row's size 1024x1024 in the map passes",
      )
      .toEqual(['ok'])

    // g3 other keys and the map's counts are ignored; the counts are the derived ones.
    const decorated = rows.map((r) => ({
      ...r,
      excerptEn: 'changed',
      notes: 'changed',
      plannedVariants: [{ name: 'changed' }],
      master: { bytes: 1 },
    }))
    const result = checkImageMap(
      asMap(decorated, {
        totals: { ...totals, keep: 99 },
        perStory: [{ storyId: STORY, keep: 99 }],
        anomalies: [{ id: 'AN-99' }],
      }),
      raw,
    )
    expect
      .soft(result, '(g3) other keys and the totals changed: passes with the derived counts')
      .toEqual({ ok: true, counts: { rows: 4, keep: 1, recreate: 1, missing: 1, new: 1 } })
  })
})

describe('legacy images: the owner demotions', () => {
  it(
    'T17-7 image-map-overrides.json: strict; each record demotes one derived keep row to recreate-step22; [] changes nothing; the committed list parses (A9, CRIT-3, CRIT-9)',
    { timeout: 60_000 },
    () => {
      const committed = parseImageMapOverrides(overridesBytes)
      expect(committed.ok, 'precondition: the committed file parses').toBe(true)
      const count = committed.ok ? committed.records.length : -1
      expect(count >= 0 && count <= 54, 'precondition: 0 to 54 records').toBe(true)
      const raw = rowsOf(derivation)
      expect(raw.length, 'precondition: the shared derivation of T17-4 (95 rows)').toBe(95)
      const keepRows = raw.filter((r) => r.action === 'keep')
      const target = keepRows[0]!
      const record = (over: Record<string, unknown> = {}) => ({
        storyId: target.storyId,
        nodeId: target.nodeId,
        action: 'recreate-step22',
        approvedOn: '2026-11-23',
        approvedBy: 'owner',
        ...over,
      })
      const fileOf = (overrides: unknown[]) => utf8(JSON.stringify({ overrides }))

      // g1 the demotion.
      const snapshot = structuredClone(raw)
      const parsed = parseImageMapOverrides(fileOf([record()]))
      expect(parsed.ok, 'precondition: a one-record file parses').toBe(true)
      const applied = applyImageMapOverrides(raw, parsed.ok ? parsed.records : [])
      const rows = applied.ok ? applied.rows : []
      const at = raw.indexOf(target)
      expect
        .soft(
          rows.map((r, i) => (i === at ? r : r === raw[i])),
          '(g1) a new array: the other rows unchanged',
        )
        .toEqual(raw.map((r, i) => (i === at ? { ...target, action: 'recreate-step22' } : true)))
      expect.soft(rows === raw, '(g1) a new array').toBe(false)
      expect.soft(raw, '(g1) the raw rows are unchanged').toEqual(snapshot)
      const none = applyImageMapOverrides(raw, [])
      expect
        .soft(none.ok ? none.rows : null, '(g1) [] gives rows deep-equal to the raw rows')
        .toEqual(snapshot)

      // g2 refused.
      const firstOf = (action: string) => raw.find((r) => r.action === action)!
      const naming = (row: LegacyImageRow) => record({ storyId: row.storyId, nodeId: row.nodeId })
      const applyLevel: [string, unknown[]][] = [
        ['naming a recreate row', [naming(firstOf('recreate-step22'))]],
        ['naming a missing row', [naming(firstOf('missing-step22'))]],
        ['naming a new row', [naming(firstOf('new-step22'))]],
        ['an unknown story', [record({ storyId: 'no-such-story' })]],
        ['an unknown node', [record({ nodeId: 'no_such_node' })]],
        ['one node twice', [record(), record({ approvedOn: '2026-11-24' })]],
      ]
      for (const [name, overrides] of applyLevel) {
        const parse = parseImageMapOverrides(fileOf(overrides))
        expect.soft(parse.ok, `(g2) ${name}: the file itself parses`).toBe(true)
        const result = applyImageMapOverrides(raw, parse.ok ? parse.records : [])
        expect
          .soft(result.ok ? 'applied' : result.code, `(g2) ${name}`)
          .toBe('image-map-overrides-invalid')
      }
      const records55 = keepRows.slice(0, 55).map((r) => naming(r))
      while (records55.length < 55) records55.push(record())
      const fileLevel: [string, Uint8Array][] = [
        ['55 records', fileOf(records55)],
        ['action keep', fileOf([record({ action: 'keep' })])],
        ['action missing-step22', fileOf([record({ action: 'missing-step22' })])],
        ['approvedOn 2026-11-15-', fileOf([record({ approvedOn: '2026-11-15-' })])],
        ['approvedOn " 2026-11-15"', fileOf([record({ approvedOn: ' 2026-11-15' })])],
        ['approvedOn 2026-02-30', fileOf([record({ approvedOn: '2026-02-30' })])],
        ['approvedOn 2026-11-15T00:00', fileOf([record({ approvedOn: '2026-11-15T00:00' })])],
        ['approvedBy Owner', fileOf([record({ approvedBy: 'Owner' })])],
        ['an unknown key', fileOf([record({ reason: 'x' })])],
        ['an own __proto__', utf8(`{"overrides": [], "__proto__": {"overrides": []}}`)],
        ['a BOM', Uint8Array.from([0xef, 0xbb, 0xbf, ...fileOf([])])],
        ['C3 28', Uint8Array.from([...utf8('{"overrides": ["'), 0xc3, 0x28, ...utf8('"]}')])],
      ]
      for (const [name, bytes] of fileLevel) {
        const parse = parseImageMapOverrides(bytes)
        expect
          .soft(parse.ok ? 'parsed' : parse.code, `(g2) ${name}`)
          .toBe('image-map-overrides-invalid')
      }
    },
  )
})
