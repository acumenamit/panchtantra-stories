import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fixture from '../../fixtures/packages/two-paths.json'
import type { ParlerPlanEntry } from './parler'
import {
  exportPlan,
  fileStamp,
  ingest,
  keyOf,
  markListened,
  narrationPaths,
} from './parler-pipeline'
import type { ManifestLine } from './parler-pipeline'

const NOW = new Date('2026-11-04T16:38:00.123Z')
const K = 'two-paths/start.hi'
let root: string
let lines: string[]
const log = (l: string) => void lines.push(l)
const opts = (now = NOW) => ({ now, log })

/**
 * One MPEG Layer III frame header: version 2 = MPEG-2 (24 kHz family), 25 = MPEG-2.5; kbpsIndex 6 = 48 kbps.
 * srIndex 1 = 24000 Hz (MPEG-2) or 22050 Hz index 0; mode 3 = mono, 0 = stereo.
 */
function mp3(
  frames: number,
  o: { kbpsIndex?: number; srIndex?: number; mode?: number; fill?: number } = {},
) {
  const { kbpsIndex = 6, srIndex = 1, mode = 3, fill = 0 } = o
  const kbps = [0, 8, 16, 24, 32, 40, 48, 56, 64][kbpsIndex]!
  const rate = [22050, 24000, 16000][srIndex]!
  const len = Math.floor((72 * kbps * 1000) / rate)
  const frame = new Uint8Array(len).fill(fill)
  frame.set([0xff, 0xf3, (kbpsIndex << 4) | (srIndex << 2), (mode << 6) | 0])
  const buf = new Uint8Array(len * frames)
  for (let i = 0; i < frames; i++) buf.set(frame, i * len)
  return buf
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const P = () => narrationPaths(root)
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const plan = (): ParlerPlanEntry[] => readJson(P().planPath).entries
const pkgPath = () => join(root, 'migration-input/packages/two-paths.phase1.json')

/** Writes a Colab-like output folder for the given plan entries (frames ~ characters, so rates look alike). */
function colabFolder(
  entries: readonly ParlerPlanEntry[],
  tweak: (e: ParlerPlanEntry, line: ManifestLine) => void = () => {},
  dir = join(root, 'colab-out'),
  fill = 0,
): string {
  mkdirSync(dir, { recursive: true })
  const manifest: string[] = []
  for (const e of entries) {
    const bytes = mp3(Math.max(1, Math.round(e.characters / 3)), { fill })
    mkdirSync(join(dir, e.storyId), { recursive: true })
    writeFileSync(join(dir, e.file), bytes)
    const line: ManifestLine = {
      storyId: e.storyId,
      nodeId: e.nodeId,
      locale: e.locale,
      narratedTextSha256: e.narratedTextSha256,
      seed: e.seed,
      mp3Sha256: sha(bytes),
      bytes: bytes.length,
      rawPeak: 0.9,
      gainDb: 0.1,
      mp3Peak: 0.9,
      longestSilenceS: 0.4,
      nearCapParts: [],
      quietParts: [],
      capS: 29.9,
      modelRevision: 'rev1',
      parlerCommit: 'c1',
      tokenizerRevision: 't1',
      gpu: 'Tesla T4',
      generatedAt: NOW.toISOString(),
    }
    tweak(e, line)
    manifest.push(JSON.stringify(line))
  }
  const mpath = join(dir, 'manifest.jsonl')
  writeFileSync(
    mpath,
    (existsSync(mpath) ? readFileSync(mpath, 'utf8') : '') + manifest.join('\n') + '\n',
  )
  return dir
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'narration-'))
  lines = []
  mkdirSync(join(root, 'migration-input/packages'), { recursive: true })
  writeFileSync(pkgPath(), JSON.stringify(fixture))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('narration:export (one plan of record)', () => {
  it('writes every node x locale with seed 0 and no overrides file', async () => {
    expect(await exportPlan(root, [], opts())).toBe(0)
    const entries = plan()
    expect(entries).toHaveLength(10)
    expect(new Set(entries.map((e) => e.seed))).toEqual(new Set([0]))
    expect(existsSync(P().overridesPath)).toBe(false)
  })

  it.each([
    [['--only', K], '--only needs --seed'],
    [['--seed', '2'], '--seed works only with --only'],
    [['--only', K, '--seed'], '--seed needs a value'],
    [['--only'], '--only needs a value'],
    [['--only', K, '--seed', '-1'], 'integer from 0 to 4294967295'],
    [['--only', K, '--seed', '1.5'], 'integer from 0 to 4294967295'],
    [['--only', K, '--seed', '4294967296'], 'integer from 0 to 4294967295'],
    [['--only', K, '--seed', '99999999999'], 'integer from 0 to 4294967295'],
    [['--only', 'two-paths/nope.hi', '--seed', '1'], 'Unknown --only entries'],
    [['--only', K, '--seed', '0'], 'already uses seed 0'],
    [['--only=' + K, '--seed=3'], 'unexpected argument "--only=two-paths/start.hi"'],
    // PowerShell turns `--only a, b` into two arguments "a" and "b" (checked on this PC)
    [
      ['--only', K, 'two-paths/start.en', '--seed', '7'],
      'unexpected argument "two-paths/start.en"',
    ],
    // a shell that keeps the comma: "a," and "b"
    [
      ['--only', `${K},`, 'two-paths/start.en', '--seed', '7'],
      'unexpected argument "two-paths/start.en"',
    ],
    [['--only', `${K},`, '--seed', '7'], 'empty entry'],
    [['--only', '', '--seed', '7'], 'empty entry'],
    [['--only', K, '--seed', '1', '--seed', '2'], '--seed given twice'],
    [['extra'], 'unexpected argument "extra"'],
  ])('refuses %j', async (args, message) => {
    await expect(exportPlan(root, args, opts())).rejects.toThrow(message)
    expect(existsSync(P().planPath)).toBe(false) // nothing written on errors
    expect(existsSync(P().overridesPath)).toBe(false)
  })

  it('accepts the largest seed numpy allows', async () => {
    await exportPlan(root, [], opts())
    await exportPlan(root, ['--only', K, '--seed', '4294967295'], opts())
    expect(readJson(P().overridesPath)).toEqual({ [K]: 4294967295 })
  })

  it('a remake saves its seed, keeps the main plan in step and writes a small upload file', async () => {
    await exportPlan(root, [], opts())
    const before = plan().find((e) => keyOf(e) === K)!
    expect(await exportPlan(root, ['--only', K, '--seed', '3'], opts())).toBe(0)
    expect(readJson(P().overridesPath)).toEqual({ [K]: 3 })
    const after = plan().find((e) => keyOf(e) === K)!
    expect(after.seed).toBe(3)
    expect(after.narratedTextSha256).not.toBe(before.narratedTextSha256)
    expect(
      plan()
        .filter((e) => e.seed !== 0)
        .map(keyOf),
    ).toEqual([K])
    const redoName = `parler-plan.redo-${fileStamp(NOW)}.json`
    expect(redoName).toBe('parler-plan.redo-20261104T163800123Z.json')
    expect(readJson(join(P().narrDir, redoName)).entries).toEqual([after])
    // Regression: a later full export (e.g. after a text fix elsewhere) keeps the remake seed.
    await exportPlan(root, [], opts())
    expect(plan().find((e) => keyOf(e) === K)).toEqual(after)
    // The same seed again is refused; a new one is fine and gets its own redo file.
    await expect(exportPlan(root, ['--only', K, '--seed', '3'], opts())).rejects.toThrow(
      'already uses seed 3',
    )
    await exportPlan(root, ['--only', K, '--seed', '4'], opts(new Date('2026-11-04T16:39:00.000Z')))
    expect(readJson(P().overridesPath)).toEqual({ [K]: 4 })
    expect(readdirSync(P().narrDir).filter((f) => f.startsWith('parler-plan.redo-'))).toHaveLength(
      2,
    )
  })

  it('never overwrites an existing redo file', async () => {
    await exportPlan(root, [], opts())
    await exportPlan(root, ['--only', K, '--seed', '1'], opts())
    await expect(
      exportPlan(root, ['--only', 'two-paths/start.en', '--seed', '1'], opts()),
    ).rejects.toThrow('already exists')
    expect(readJson(P().overridesPath)).toEqual({ [K]: 1 }) // nothing changed
  })

  it('refuses to drop remake seeds when seed-overrides.json is lost', async () => {
    await exportPlan(root, [], opts())
    await exportPlan(root, ['--only', K, '--seed', '5'], opts())
    rmSync(P().overridesPath)
    await expect(exportPlan(root, [], opts())).rejects.toThrow(
      `disagree: ${K} (parler-plan.json seed 5, seed-overrides.json none)`,
    )
    // An explicit remake of that file (back to seed 0 here) settles it.
    await exportPlan(root, ['--only', K, '--seed', '0'], opts(new Date('2026-11-04T17:00:00.000Z')))
    expect(plan().find((e) => keyOf(e) === K)!.seed).toBe(0)
    expect(readJson(P().overridesPath)).toEqual({ [K]: 0 })
  })

  it('refuses an older seed-overrides.json backup that would bring back an older seed', async () => {
    await exportPlan(root, [], opts())
    await exportPlan(root, ['--only', K, '--seed', '5'], opts())
    const backup = readFileSync(P().overridesPath, 'utf8')
    await exportPlan(root, ['--only', K, '--seed', '7'], opts(new Date('2026-11-04T17:00:00.000Z')))
    writeFileSync(P().overridesPath, backup) // says 5, the plan says 7
    await expect(exportPlan(root, [], opts())).rejects.toThrow(
      `disagree: ${K} (parler-plan.json seed 7, seed-overrides.json 5)`,
    )
    expect(plan().find((e) => keyOf(e) === K)!.seed).toBe(7) // unchanged
    // Confirming the plan's seed is allowed although the plan already uses it.
    await exportPlan(root, ['--only', K, '--seed', '7'], opts(new Date('2026-11-04T17:01:00.000Z')))
    expect(readJson(P().overridesPath)).toEqual({ [K]: 7 })
    await exportPlan(root, [], opts())
  })

  it('--keep-plan-seeds settles several disagreeing files at their different plan seeds', async () => {
    const E = 'two-paths/start.en'
    await exportPlan(root, [], opts())
    await exportPlan(root, ['--only', `${K},${E}`, '--seed', '1'], opts())
    await exportPlan(root, ['--only', K, '--seed', '2'], opts(new Date('2026-11-04T17:00:00.000Z')))
    rmSync(P().overridesPath) // lost: the plan has start.en=1, start.hi=2
    await expect(exportPlan(root, [], opts())).rejects.toThrow(
      'pnpm narration:export --keep-plan-seeds',
    )
    await expect(
      exportPlan(root, ['--keep-plan-seeds', '--only', K, '--seed', '3'], opts()),
    ).rejects.toThrow('cannot be combined')
    const before = plan()
    expect(await exportPlan(root, ['--keep-plan-seeds'], opts())).toBe(0)
    expect(readJson(P().overridesPath)).toEqual({ [E]: 1, [K]: 2 })
    expect(plan()).toEqual(before) // same seeds and fingerprints: no Colab work needed
    expect(lines).toContain(`kept the parler-plan.json seeds for: ${E} (seed 1), ${K} (seed 2)`)
    expect(await exportPlan(root, [], opts())).toBe(0)
  })

  it('a broken or wrong-shaped parler-plan.json is named, with advice that does not loop', async () => {
    mkdirSync(P().narrDir, { recursive: true })
    writeFileSync(P().planPath, '{"entries": [')
    await expect(exportPlan(root, [], opts())).rejects.toThrow(
      'rename it (for example to parler-plan.broken.json) and run pnpm narration:export again',
    )
    writeFileSync(P().planPath, '{}')
    await expect(exportPlan(root, [], opts())).rejects.toThrow('is not a narration plan')
  })

  it('a remade file that leaves the packages does not block export', async () => {
    await exportPlan(root, [], opts())
    await exportPlan(root, ['--only', K, '--seed', '5'], opts())
    const renamed = { ...structuredClone(fixture), storyId: 'two-paths-renamed' }
    writeFileSync(pkgPath(), JSON.stringify(renamed))
    await expect(exportPlan(root, [], opts())).rejects.toThrow(
      `no longer in the packages: ${K}. Delete those keys from seed-overrides.json`,
    )
    writeFileSync(P().overridesPath, '{}')
    expect(await exportPlan(root, [], opts())).toBe(0)
    expect(plan().every((e) => e.storyId === 'two-paths-renamed' && e.seed === 0)).toBe(true)
  })

  it('refuses an overrides file that names files not in the packages, a bad seed or broken JSON', async () => {
    mkdirSync(P().narrDir, { recursive: true })
    writeFileSync(P().overridesPath, JSON.stringify({ 'gone/start.en': 1 }))
    await expect(exportPlan(root, [], opts())).rejects.toThrow(
      'no longer in the packages: gone/start.en',
    )
    writeFileSync(P().overridesPath, JSON.stringify({ [K]: 4294967296 }))
    await expect(exportPlan(root, [], opts())).rejects.toThrow('integer from 0 to 4294967295')
    writeFileSync(P().overridesPath, '{"two-paths/start.hi": 3')
    await expect(exportPlan(root, [], opts())).rejects.toThrow(
      `${P().overridesPath} is not valid JSON`,
    )
  })

  it('names a broken parler-plan.json and says how to fix it', async () => {
    mkdirSync(P().narrDir, { recursive: true })
    writeFileSync(P().planPath, '{"entries": [')
    await expect(exportPlan(root, [], opts())).rejects.toThrow(`${P().planPath} is not valid JSON`)
  })

  it('leaves no temporary files behind', async () => {
    await exportPlan(root, [], opts())
    await exportPlan(root, ['--only', K, '--seed', '1'], opts())
    expect(readdirSync(P().narrDir).filter((f) => f.endsWith('.part'))).toEqual([])
  })
})

describe('narration:ingest', () => {
  it('accepts a complete, matching folder and logs provenance; re-ingest does not duplicate', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    expect(await ingest(root, dir, opts())).toBe(0)
    const media = readJson(join(P().narrDir, 'media-log.json'))
    expect(media).toHaveLength(10)
    expect(media[0]).toMatchObject({
      recipe: 'narration-recipe@2',
      seed: 0,
      levelPeakDbfs: -1,
      modelRevision: 'rev1',
      parlerCommit: 'c1',
      tokenizerRevision: 't1',
      provenance: { vendor: 'AI4Bharat' },
    })
    expect(readdirSync(join(P().audioDir, 'two-paths')).sort()).toEqual(
      plan()
        .map((e) => `${e.nodeId}.${e.locale}.mp3`)
        .sort(),
    )
    const report = readJson(join(P().narrDir, 'qa-report.json'))
    expect(report.listen).toEqual(['two-paths/start.en', 'two-paths/start.hi'])
    expect(await ingest(root, dir, opts())).toBe(0)
    expect(readJson(join(P().narrDir, 'media-log.json'))).toHaveLength(10)
    const history = readFileSync(join(P().narrDir, 'media-log.history.jsonl'), 'utf8')
    expect(history.trim().split('\n')).toHaveLength(20)
  })

  it('refuses to run when the plan is out of date (story text edited after export)', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    const p = structuredClone(fixture) as typeof fixture
    p.text.en.nodes.start.text += ' New words.'
    writeFileSync(pkgPath(), JSON.stringify(p))
    await expect(ingest(root, dir, opts())).rejects.toThrow(
      'parler-plan.json is out of date (1 file differs, e.g. two-paths/start.en)',
    )
    expect(existsSync(P().audioDir)).toBe(false)
    // After a new export the old take is reported, not accepted.
    await exportPlan(root, [], opts())
    expect(await ingest(root, dir, opts())).toBe(1)
    expect(lines.join('\n')).toContain('PROBLEM two-paths/start.en: made from an older plan')
  })

  it('rejects a file made from an older plan (the rejected take after a remake)', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan()) // everything made with seed 0
    await exportPlan(root, ['--only', K, '--seed', '1'], opts())
    expect(await ingest(root, dir, opts())).toBe(1)
    expect(lines.join('\n')).toContain(`PROBLEM ${K}: made from an older plan`)
    expect(existsSync(join(P().audioDir, 'two-paths/start.hi.mp3'))).toBe(false)
  })

  it('rejects a file whose bytes do not match its manifest line, or a line without a hash', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan(), (e, line) => {
      if (keyOf(e) === K) line.mp3Sha256 = '0'.repeat(64)
      if (keyOf(e) === 'two-paths/start.en') delete line.mp3Sha256
    })
    expect(await ingest(root, dir, opts())).toBe(1)
    const out = lines.join('\n')
    expect(out).toContain(`PROBLEM ${K}: file does not match its manifest line`)
    expect(out).toContain('PROBLEM two-paths/start.en: manifest line has no mp3Sha256')
  })

  it.each([
    ['64 kbps', { kbpsIndex: 8 }],
    ['22.05 kHz', { srIndex: 0 }],
    ['stereo', { mode: 0 }],
  ])('rejects the wrong audio format (%s)', async (_label, o) => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    const e = plan().find((x) => keyOf(x) === K)!
    const bad = mp3(50, o)
    writeFileSync(join(dir, e.file), bad)
    const manifest = readFileSync(join(dir, 'manifest.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as ManifestLine)
      .map((l) => (keyOf(l) === K ? { ...l, mp3Sha256: sha(bad) } : l))
    writeFileSync(join(dir, 'manifest.jsonl'), manifest.map((l) => JSON.stringify(l)).join('\n'))
    expect(await ingest(root, dir, opts())).toBe(1)
    expect(lines.join('\n')).toContain(`PROBLEM ${K}: wrong audio format`)
  })

  it('later manifest lines win; a remake stays on the listening list until marked as heard', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    expect(await ingest(root, dir, opts())).toBe(0)
    const W = 'two-paths/wise_path.en'
    await exportPlan(root, ['--only', W, '--seed', '2'], opts())
    colabFolder(
      plan().filter((e) => keyOf(e) === W),
      () => {},
      dir,
      1,
    ) // appended line + new bytes
    expect(await ingest(root, dir, opts())).toBe(0)
    const media = readJson(join(P().narrDir, 'media-log.json'))
    expect(media.find((r: ManifestLine) => keyOf(r) === W)).toMatchObject({
      seed: 2,
      listenPending: true,
    })
    const report = () => readJson(join(P().narrDir, 'qa-report.json'))
    expect(report().remakesToHear).toEqual([W])
    expect(report().listen).toContain(W)
    // Ingesting the same take again keeps it on the list (it has not been heard yet).
    await ingest(root, dir, opts())
    expect(report().remakesToHear).toEqual([W])
    // Marking it as heard removes it.
    expect(() => markListened(root, ['two-paths/start.en'], { log })).toThrow(
      'not waiting to be heard: two-paths/start.en',
    )
    expect(markListened(root, [W], { log })).toBe(0)
    await ingest(root, dir, opts())
    expect(report().remakesToHear).toEqual([])
    expect(report().listen).not.toContain(W)
  })

  it('a remake accepted in a run that stopped early is still listed after the re-run', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    await ingest(root, dir, opts())
    const W = 'two-paths/wise_path.en'
    await exportPlan(root, ['--only', W, '--seed', '3'], opts())
    colabFolder(
      plan().filter((e) => keyOf(e) === W),
      () => {},
      dir,
      1,
    )
    const last = plan().at(-1)!
    rmSync(join(P().audioDir, last.file))
    mkdirSync(join(P().audioDir, last.file)) // blocks the last copy
    await expect(ingest(root, dir, opts())).rejects.toThrow(`ingesting ${keyOf(last)} failed`)
    rmSync(join(P().audioDir, last.file), { recursive: true })
    expect(await ingest(root, dir, opts())).toBe(0)
    expect(readJson(join(P().narrDir, 'qa-report.json')).remakesToHear).toEqual([W])
  })

  it('markListened --all clears every remake waiting to be heard', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    await ingest(root, dir, opts())
    await exportPlan(root, ['--only', `${K},two-paths/start.en`, '--seed', '4'], opts())
    colabFolder(
      plan().filter((e) => [K, 'two-paths/start.en'].includes(keyOf(e))),
      () => {},
      dir,
      1,
    )
    await ingest(root, dir, opts())
    expect(readJson(join(P().narrDir, 'qa-report.json')).remakesToHear).toEqual([
      'two-paths/start.en',
      K,
    ])
    expect(markListened(root, ['--all'], { log })).toBe(0)
    expect(lines.at(-1)).toBe('marked 2 remade files as heard; still waiting: 0')
    expect(() => markListened(root, [], { log })).toThrow('Usage: pnpm narration:listened')
  })

  it('flags QA findings from the manifest and versions that differ from the media log', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan(), (e, line) => {
      if (keyOf(e) === K) line.nearCapParts = [2]
      if (keyOf(e) === 'two-paths/wise_path.en') line.mp3Peak = 1
      if (keyOf(e) === 'two-paths/quick_path.en') line.quietParts = [1]
    })
    expect(await ingest(root, dir, opts())).toBe(0)
    const report = readJson(join(P().narrDir, 'qa-report.json'))
    expect(report.flags.map((f: { key: string }) => f.key).sort()).toEqual(
      ['two-paths/quick_path.en', K, 'two-paths/wise_path.en'].sort(),
    )
    // A remake session that installed different code: the folder holds ONLY the 2 remade files, so the
    // other 8 are missing (exit 1) and the version check can only work through the media log.
    await exportPlan(root, ['--only', `${K},two-paths/start.en`, '--seed', '9'], opts())
    const dir2 = colabFolder(
      plan().filter((e) => [K, 'two-paths/start.en'].includes(keyOf(e))),
      (_e, line) => void Object.assign(line, { parlerCommit: 'c2' }),
      join(root, 'colab-out-2'),
    )
    expect(await ingest(root, dir2, opts())).toBe(1)
    const flags2 = readJson(join(P().narrDir, 'qa-report.json')).flags as {
      key: string
      reasons: string[]
    }[]
    expect(flags2).toEqual([
      {
        key: 'two-paths/start.en',
        reasons: ['made with Parler-TTS code commit c2, the others with c1'],
      },
      { key: K, reasons: ['made with Parler-TTS code commit c2, the others with c1'] },
    ])
  })

  it('stops cleanly when a destination file cannot be replaced, and the media log matches what was copied', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    const last = plan().at(-1)!
    mkdirSync(join(P().audioDir, last.file), { recursive: true }) // a folder where the MP3 should go
    await expect(ingest(root, dir, opts())).rejects.toThrow(`ingesting ${keyOf(last)} failed`)
    const media = readJson(join(P().narrDir, 'media-log.json'))
    expect(media).toHaveLength(9)
    expect(media.map(keyOf)).not.toContain(keyOf(last))
    expect(existsSync(join(P().audioDir, `${last.file}.part`))).toBe(false)
    expect(readJson(join(P().narrDir, 'qa-report.json')).stoppedEarly).toContain(keyOf(last))
  })

  it('points to the right folder when the download is one level deeper', async () => {
    await exportPlan(root, [], opts())
    const outer = join(root, 'download')
    colabFolder(plan(), () => {}, join(outer, 'storyboard-narration'))
    await expect(ingest(root, outer, opts())).rejects.toThrow(
      `there is one in ${join(outer, 'storyboard-narration')}`,
    )
  })

  it('explains path mistakes: missing folder, zip file, trailing quote or backslash', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    await expect(ingest(root, join(root, 'nope'), opts())).rejects.toThrow(
      `folder not found: ${join(root, 'nope')}`,
    )
    await expect(ingest(root, join(root, 'out.zip'), opts())).rejects.toThrow('is a zip file')
    expect(await ingest(root, `${dir}\\"`, opts())).toBe(0)
  })

  it('names a broken media log instead of failing with a bare JSON error', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    writeFileSync(join(P().narrDir, 'media-log.json'), '[{"storyId":')
    await expect(ingest(root, dir, opts())).rejects.toThrow('media-log.json is not valid JSON')
  })

  it('stops on a broken manifest line instead of guessing', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    writeFileSync(
      join(dir, 'manifest.jsonl'),
      readFileSync(join(dir, 'manifest.jsonl'), 'utf8') + '{"storyId":',
    )
    await expect(ingest(root, dir, opts())).rejects.toThrow('line 11 is not valid JSON')
  })
})

describe('parler-cli (real process, exit codes)', () => {
  const storyboard = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const cli = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        join(storyboard, 'node_modules/tsx/dist/cli.mjs'),
        join(storyboard, 'tools/narration/parler-cli.ts'),
        ...args,
      ],
      { env: { ...process.env, NARRATION_ROOT: root }, encoding: 'utf8' },
    )

  it('exits 0 on success, 1 on problems, 2 on usage errors; accepts a leading "--"', () => {
    const exp = cli('export')
    expect(exp.status).toBe(0)
    expect(exp.stdout).toContain('plan: 10 files')
    expect(cli('export', '--only', K).status).toBe(2)
    const dir = colabFolder(plan(), (e, line) => {
      if (keyOf(e) === K) line.mp3Sha256 = '0'.repeat(64)
    })
    const bad = cli('ingest', '--', dir)
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain(`PROBLEM ${K}`)
    const usage = cli('ingest')
    expect(usage.status).toBe(2)
    expect(usage.stderr).toContain('Usage: pnpm narration:ingest')
    // An unquoted path with a space arrives as two arguments in PowerShell.
    const split = cli('ingest', join(root, 'storyboard-narration'), '1')
    expect(split.status).toBe(2)
    expect(split.stderr).toContain(
      'ingest takes one folder, got 2 arguments: put the path in quotes',
    )
    const heard = cli('listened', '--all')
    expect(heard.status).toBe(0)
    expect(heard.stdout).toContain('marked 0 remade files as heard')
  }, 30_000)
})

describe('Colab notebook contract', () => {
  const nbPath = join(
    dirname(fileURLToPath(import.meta.url)),
    'colab/indic_parler_tts_generate.ipynb',
  )
  const cells: string[] = (
    JSON.parse(readFileSync(nbPath, 'utf8')).cells as { cell_type: string; source: string[] }[]
  )
    .filter((c) => c.cell_type === 'code')
    .map((c) => c.source.join(''))
  const generate = cells.find((c) => c.startsWith('# 7.'))!

  it('writes exactly the manifest fields ingest reads', () => {
    const block = /line = \{([\s\S]*?)\}\n/.exec(generate)![1]!
    const written = [...block.matchAll(/'(\w+)':/g)].map((m) => m[1]).sort()
    expect(written).toEqual(
      [
        'storyId',
        'nodeId',
        'locale',
        'narratedTextSha256',
        'seed',
        'mp3Sha256',
        'bytes',
        'rawPeak',
        'gainDb',
        'mp3Peak',
        'longestSilenceS',
        'nearCapParts',
        'quietParts',
        'capS',
        'modelRevision',
        'parlerCommit',
        'tokenizerRevision',
        'gpu',
        'generatedAt',
      ].sort(),
    )
  })

  it('reads only plan fields that export writes', async () => {
    await exportPlan(root, [], opts())
    const entryKeys = new Set(Object.keys(plan()[0]!))
    const read = new Set([...cells.join('\n').matchAll(/\be\['(\w+)'\]/g)].map((m) => m[1]!))
    expect([...read].filter((k) => !entryKeys.has(k))).toEqual([])
    expect(readJson(P().planPath).recipe.levelPeakDbfs).toBe(-1)
  })

  it('refuses to run without a GPU, before anything is made', () => {
    // Files made on a CPU runtime came out with much shorter Hindi pauses (measured 2026-11-06).
    const step1 = cells.find((c) => c.startsWith('# 1.'))!
    expect(step1).toMatch(
      /\nif not torch\.cuda\.is_available\(\):\n(?:[ \t]*#[^\n]*\n)?[ \t]+raise RuntimeError\(/,
    )
    const guard = generate.indexOf("if device == 'cpu':\n    raise RuntimeError(")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(generate.indexOf('MANIFEST = '))
  })
})
