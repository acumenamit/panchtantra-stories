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
import { StoryPackageV1 } from '../../src/core/package/v1'
import { convertLegacyStory } from '../migrate/convert'
import { loadLegacyStories } from '../migrate/load-legacy'
import { applyTextCorrections, type TextCorrection } from '../migrate/text-corrections'
import { parseHashList } from '../publisher/takedown'
import { buildParlerEntry, type ParlerPlanEntry } from './parler'
import {
  buildAllEntries,
  buildEntriesFor,
  exportPlan,
  fileStamp,
  ingest,
  keyOf,
  markListened,
  narrationPaths,
  parseSeedOverrides,
  readSeedOverrides,
} from './parler-pipeline'
import type { ManifestLine } from './parler-pipeline'

const NOW = new Date('2026-11-04T16:38:00.123Z')
const K = 'two-paths/start.hi'
let root: string
let lines: string[]
const log = (l: string) => void lines.push(l)
// P1 Step 17 (p1-step17-design.md D17-17): every export and ingest names its text corrections.
const opts = (now = NOW) => ({ now, log, corrections: [] })

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

// ---- P1 Step 17 (p1-step17-design.md §3.17, D17-17, D17-29; §14.12): T17-48 to T17-50 ----

const shaText = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const HI_START = fixture.text.hi.nodes.start.text
/** "नन्ही", from code points: the synthetic correction's new word. */
const NEW_WORD = String.fromCodePoint(0x0928, 0x0928, 0x094d, 0x0939, 0x0940)
const REPLACED = HI_START.split(' ')[1] ?? ''
const HI_AFTER = HI_START.split(' ')
  .map((word, i) => (i === 1 ? NEW_WORD : word))
  .join(' ')
/** The synthetic record: two-paths hi start text with its second word replaced. */
const correction = (over: Partial<TextCorrection> = {}): TextCorrection => ({
  storyId: 'two-paths',
  locale: 'hi',
  nodeId: 'start',
  field: 'text',
  beforeSha256: shaText(HI_START),
  after: HI_AFTER,
  approvedOn: '2026-11-15',
  approvedBy: 'owner',
  ...over,
})
const withCorrections = (corrections: readonly TextCorrection[], now = NOW) => ({
  now,
  log,
  corrections,
})
const fixturePackage = () => StoryPackageV1.parse(structuredClone(fixture))
const errorOf = async (run: () => Promise<unknown>): Promise<string> =>
  run().then(
    () => 'no error',
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  )
const sumsPath = () => join(P().audioDir, 'SHA256SUMS.txt')
/** Runs `body` on a fresh temporary root holding the two-paths package, then restores the root. */
async function onFreshRoot(body: () => Promise<void>): Promise<void> {
  const previous = root
  root = mkdtempSync(join(tmpdir(), 'narration-'))
  mkdirSync(join(root, 'migration-input/packages'), { recursive: true })
  writeFileSync(pkgPath(), JSON.stringify(fixture))
  try {
    await body()
  } finally {
    rmSync(root, { recursive: true, force: true })
    root = previous
  }
}

describe('P1 Step 17: corrections, the hash list and the pure readers', () => {
  it('T17-48 the narration reader applies corrections: one entry changes, export --only writes the corrected redo entry, ingest’s stale check uses it, a refusing record throws by code with no text and writes nothing (A7, D17-17)', async () => {
    const R = correction()
    expect(
      HI_START.split(REPLACED).length === 2 && !HI_AFTER.includes(REPLACED),
      'precondition: the record replaces the one occurrence of a word',
    ).toBe(true)
    expect(HI_AFTER.includes(NEW_WORD), 'precondition: the after holds the new word').toBe(true)

    // g1
    await exportPlan(root, [], withCorrections([]))
    const plain = plan()
    await exportPlan(root, [], withCorrections([R]))
    const corrected = plan()
    expect(corrected.map(keyOf), 'precondition: the same 10 keys').toEqual(plain.map(keyOf))
    expect
      .soft(
        corrected.filter((e, i) => JSON.stringify(e) !== JSON.stringify(plain[i])).map(keyOf),
        '(g1) exactly one entry differs: two-paths/start.hi',
      )
      .toEqual([K])
    const applied = applyTextCorrections([fixturePackage()], [R])
    const want = applied.ok ? await buildParlerEntry(applied.packages[0]!, 'start', 'hi', 0) : null
    expect
      .soft(
        corrected.find((e) => keyOf(e) === K)?.narratedTextSha256,
        '(g1) its narratedTextSha256 is buildParlerEntry over the corrected package',
      )
      .toBe(want?.narratedTextSha256)

    // g2
    await exportPlan(root, ['--only', K, '--seed', '1'], withCorrections([R]))
    const redo: ParlerPlanEntry[] = readJson(
      join(P().narrDir, `parler-plan.redo-${fileStamp(NOW)}.json`),
    ).entries
    expect.soft(redo.map(keyOf), '(g2) the redo file holds 1 entry').toEqual([K])
    const spoken = redo[0]?.sentences.join(' ') ?? ''
    expect
      .soft(
        spoken.includes(NEW_WORD) && !spoken.includes(REPLACED),
        '(g2) its sentences hold the new word and not the replaced one',
      )
      .toBe(true)

    // g3
    await exportPlan(root, [], withCorrections([]))
    const dir = colabFolder(plan())
    expect
      .soft(
        await errorOf(() => ingest(root, dir, withCorrections([R]))),
        '(g3) ingest with the record refuses the plan exported without it',
      )
      .toMatch(/^parler-plan\.json is out of date \(1 file differs, e\.g\. two-paths\/start\.hi\)/)

    // g4
    await onFreshRoot(async () => {
      const bad = correction({ beforeSha256: shaText('another string') })
      const message = await errorOf(() =>
        exportPlan(root, ['--only', K, '--seed', '1'], withCorrections([bad])),
      )
      expect
        .soft(message, '(g4) a before-mismatch record throws by code')
        .toBe('text-corrections.json: correction-before-mismatch two-paths/start.hi text')
      // The record's field and its after are Hindi (the English text shares "two" and "path" with
      // the story id two-paths, so it is not a useful sample).
      const words = [...HI_START.split(/\s+/u), ...HI_AFTER.split(/\s+/u)]
        .map((w) => w.replace(/[।]+$/u, ''))
        .filter((w) => w.length > 0)
      expect
        .soft(
          words.filter((w) => message.includes(w)),
          '(g4) no word of the record’s text or its after in the message',
        )
        .toEqual([])
      expect.soft(/[ऀ-ॿ]/u.test(message), '(g4) no Devanagari in the message').toBe(false)
      expect
        .soft(
          [existsSync(P().overridesPath), existsSync(P().planPath)],
          '(g4) seed-overrides.json and the plan not written',
        )
        .toEqual([false, false])
    })
  })

  it('T17-49 ingest writes SHA256SUMS.txt from the log after a run that copied files: sorted hash-list lines that parseHashList accepts; a differing file throws and writes nothing; no write after a stopped run or with no copy (A8, D17-17)', async () => {
    await exportPlan(root, [], opts())
    const dir = colabFolder(plan())
    expect(await ingest(root, dir, opts()), 'precondition: a full ingest').toBe(0)
    const media: Record<string, unknown>[] = readJson(join(P().narrDir, 'media-log.json'))
    expect(media.length, 'precondition: 10 files copied and logged').toBe(10)
    const pathOf = (r: Record<string, unknown>) =>
      `${String(r.storyId)}/${String(r.nodeId)}.${String(r.locale)}.mp3`
    const shaOf = (path: string) => String(media.find((r) => pathOf(r) === path)?.sha256)
    const logOrder = media.map(pathOf)
    const sorted = [...logOrder].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    expect(logOrder, 'precondition: the plan order differs from the sorted path order').not.toEqual(
      sorted,
    )

    // g1
    const text = readFileSync(sumsPath(), 'utf8')
    const want = sorted.map((path) => `${shaOf(path)}  ${path}\n`).join('')
    expect.soft(text, '(g1) 10 lines <sha>  two-paths/<node>.<locale>.mp3, sorted, LF').toBe(want)
    expect.soft(text.includes('\r'), '(g1) no CR').toBe(false)
    expect
      .soft(
        sorted.map((path) => sha(new Uint8Array(readFileSync(join(P().audioDir, path))))),
        "(g1) each line's sha256 is its file's",
      )
      .toEqual(sorted.map(shaOf))
    const parsed = parseHashList(new Uint8Array(readFileSync(sumsPath())))
    expect.soft(parsed.ok && parsed.lines.length, '(g1) parseHashList accepts 10 lines').toBe(10)
    expect.soft(lines.at(-1), '(g1) the last log line').toBe('wrote SHA256SUMS.txt (10 files)')

    // g2
    const first = readFileSync(sumsPath())
    expect(await ingest(root, dir, opts(new Date('2026-11-05T09:00:00.000Z')))).toBe(0)
    expect
      .soft(readFileSync(sumsPath()).equals(first), '(g2) a second ingest writes the same bytes')
      .toBe(true)

    // g5 (before g3, which leaves a changed file behind)
    const [gone1, gone2] = plan().slice(-2)
    if (!gone1 || !gone2) throw new Error('the plan has fewer than 2 entries')
    rmSync(join(dir, gone1.file))
    rmSync(join(dir, gone2.file))
    lines = []
    expect(await ingest(root, dir, opts()), 'precondition: two files missing').toBe(1)
    expect
      .soft(lines[0], '(g5) accepted 8 of 10, 2 problems')
      .toBe('accepted 8/10; problems 2; flagged 0')
    expect
      .soft(
        readFileSync(sumsPath(), 'utf8').split('\n').filter(Boolean).length,
        '(g5) the list still holds 10 lines',
      )
      .toBe(10)
    expect.soft(lines.at(-1), '(g5) and says so').toBe('wrote SHA256SUMS.txt (10 files)')

    // g3: a file that no longer matches its record (not re-copied: absent from the folder)
    const before = readFileSync(sumsPath())
    writeFileSync(join(P().audioDir, gone1.file), mp3(3, { fill: 7 }))
    expect
      .soft(
        await errorOf(() => ingest(root, dir, opts())),
        '(g3) a file that differs from its record throws',
      )
      .toBe(`SHA256SUMS.txt not written: ${keyOf(gone1)} differs from media-log.json`)
    expect
      .soft(readFileSync(sumsPath()).equals(before), '(g3) the old list is byte-identical')
      .toBe(true)

    // g4: a run stopped mid-copy, and a run whose every file is a problem
    await onFreshRoot(async () => {
      await exportPlan(root, [], opts())
      const folder = colabFolder(plan())
      const fourth = plan()[3]
      if (!fourth) throw new Error('the plan has fewer than 4 entries')
      mkdirSync(join(P().audioDir, fourth.file), { recursive: true })
      expect(
        await errorOf(() => ingest(root, folder, opts())),
        'precondition: the run stops at the 4th file',
      ).toContain(`ingesting ${keyOf(fourth)} failed`)
      expect.soft(existsSync(sumsPath()), '(g4) no list after a stopped run').toBe(false)
    })
    await onFreshRoot(async () => {
      await exportPlan(root, [], opts())
      const folder = colabFolder(plan(), (_e, line) => {
        line.narratedTextSha256 = '0'.repeat(64)
      })
      lines = []
      expect(await ingest(root, folder, opts()), 'precondition: every file is a problem').toBe(1)
      expect(lines[0], 'precondition: nothing accepted').toBe(
        'accepted 0/10; problems 10; flagged 0',
      )
      expect.soft(existsSync(sumsPath()), '(g4) no list when nothing was copied').toBe(false)
    })
  })

  it('T17-50 buildEntriesFor over packages equals buildAllEntries over the same folder; parseSeedOverrides equals readSeedOverrides on the same bytes; absent is {} (CRIT-5)', async () => {
    const R = correction()
    const corrected = applyTextCorrections([fixturePackage()], [R])
    expect(corrected.ok, 'precondition: the record applies to the fixture').toBe(true)
    const correctedPackages = corrected.ok ? corrected.packages : []

    // g1
    const plainFolder = await buildAllEntries(P().pkgDir, {}, { corrections: [] })
    const plainPure = await buildEntriesFor([fixturePackage()], {})
    expect.soft(plainPure, '(g1) no correction, no override: equal').toEqual(plainFolder)
    const overrides = { [K]: 3 }
    const folder = await buildAllEntries(P().pkgDir, overrides, { corrections: [R] })
    const pure = await buildEntriesFor(correctedPackages, overrides)
    expect.soft(pure, '(g1) a correction and an override: equal').toEqual(folder)
    const want = await buildParlerEntry(correctedPackages[0]!, 'start', 'hi', 3)
    expect
      .soft(
        pure.find((e) => keyOf(e) === K),
        '(g1) the override and the correction both reach the entry',
      )
      .toEqual(want)

    // g2
    const unknown = { 'two-paths/nowhere.hi': 2 }
    const fromPure = await errorOf(() => buildEntriesFor([fixturePackage()], unknown))
    const fromFolder = await errorOf(() =>
      buildAllEntries(P().pkgDir, unknown, { corrections: [] }),
    )
    expect
      .soft(fromPure, '(g2) an unknown key: buildEntriesFor throws')
      .toContain('no longer in the packages: two-paths/nowhere.hi')
    expect.soft(fromPure, '(g2) the same message as buildAllEntries').toBe(fromFolder)

    // g3
    mkdirSync(P().narrDir, { recursive: true })
    const bytesOf = (value: string) => new TextEncoder().encode(value)
    const valid = `{"${K}": 1}`
    writeFileSync(P().overridesPath, valid)
    expect
      .soft(parseSeedOverrides(bytesOf(valid)), '(g3) a valid file parses to that object')
      .toEqual({ [K]: 1 })
    expect
      .soft(readSeedOverrides(P().overridesPath), '(g3) and readSeedOverrides reads the same')
      .toEqual({ [K]: 1 })
    for (const sample of ['[]', '{"k": -1}', '{"k": 4294967296}', '{"k": 1.5}']) {
      writeFileSync(P().overridesPath, sample)
      expect
        .soft(
          [
            await errorOf(async () => parseSeedOverrides(bytesOf(sample))),
            await errorOf(async () => readSeedOverrides(P().overridesPath)),
          ].map((message) => message !== 'no error'),
          `(g3) both throw on ${sample}`,
        )
        .toEqual([true, true])
    }
    rmSync(P().overridesPath)
    expect.soft(readSeedOverrides(P().overridesPath), '(g3) a missing file is {}').toEqual({})
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
    // P1 Step 17 (B17-implA-1): the CLI applies the committed tools/migrate/text-corrections.json,
    // whose record names crow-and-serpent, so the scratch root holds that package too (re-converted
    // from pt/), and the plan's corrected entry proves the CLI passed the committed record.
    const crow = loadLegacyStories(join(storyboard, '..', 'pt', 'src', 'stories'))
      .map((l) => convertLegacyStory(l.story))
      .find((p) => p.storyId === 'crow-and-serpent')
    if (!crow) throw new Error('crow-and-serpent is missing from pt/')
    writeFileSync(
      join(root, 'migration-input/packages/crow-and-serpent.phase1.json'),
      JSON.stringify(crow),
    )
    const files = 10 + crow.nodes.length * crow.locales.length
    const exp = cli('export')
    expect(exp.status).toBe(0)
    expect(exp.stdout).toContain(`plan: ${files} files`)
    const seek = plan().find((e) => keyOf(e) === 'crow-and-serpent/seek_advice.hi')
    expect(seek?.sentences.length, 'precondition: the corrected entry is planned').toBeGreaterThan(
      0,
    )
    expect(
      seek?.sentences.some((s) => /[琥珀]/u.test(s)),
      'the committed correction reached the plan',
    ).toBe(false)
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
