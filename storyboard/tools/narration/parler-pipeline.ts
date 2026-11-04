// Recipe @2 workflow on the owner's PC (generation itself runs on a Colab GPU). parler-cli.ts is the entry point.
//
// One plan of record: migration-input/narration/parler-plan.json always lists every file with the seed it must be
// made with. Remade files keep their seed in seed-overrides.json, which every export applies, so uploading the
// main plan to Colab again never brings back a rejected take. Ingest rebuilds the plan from the packages and the
// saved seeds, refuses to run when parler-plan.json is out of date, and accepts a file only when it matches the
// current plan exactly (text, recipe and seed) and its bytes match the hash in its manifest line.
// A newly accepted remake stays on the listening list until the owner runs `pnpm narration:listened`.
// All JSON state is written via a temporary file and a rename, so an interrupted command never leaves half a file.
//
// Reads and writes only under <root>/migration-input/ (gitignored) and the Colab folder given to ingest. No network.
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { mp3Info } from './mp3'
import { RECIPE_V2, buildParlerEntry, isParlerLocale, qaFlags } from './parler'
import type { MadeWith, ParlerPlanEntry, QaInput } from './parler'

export type Log = (line: string) => void

export interface NarrationPaths {
  readonly pkgDir: string
  readonly narrDir: string
  readonly audioDir: string
  readonly planPath: string
  readonly overridesPath: string
}

export function narrationPaths(root: string): NarrationPaths {
  const narrDir = join(root, 'migration-input/narration')
  return {
    pkgDir: join(root, 'migration-input/packages'),
    narrDir,
    audioDir: join(root, 'migration-input/audio'),
    planPath: join(narrDir, 'parler-plan.json'),
    overridesPath: join(narrDir, 'seed-overrides.json'),
  }
}

export const keyOf = (e: { storyId: string; nodeId: string; locale: string }) =>
  `${e.storyId}/${e.nodeId}.${e.locale}`

const recKey = (r: Record<string, unknown>) =>
  keyOf(r as { storyId: string; nodeId: string; locale: string })

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Reads a JSON state file; a broken file is named, with what to do. */
export function readJsonFile<T>(path: string, whatToDo: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON (${err instanceof Error ? err.message : String(err)}): ${whatToDo}`,
    )
  }
}

/** Writes JSON via <path>.part and a rename: readers see the old file or the new one, never half of one. */
export function writeJsonAtomically(path: string, value: unknown): void {
  const part = `${path}.part`
  try {
    writeFileSync(part, JSON.stringify(value, null, 2) + '\n')
    renameSync(part, path)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  }
}

const OVERRIDES_HINT = 'restore it from a backup or fix it by hand ({"story/node.locale": seed})'
const PLAN_HINT =
  'restore it from a backup, or rename it (for example to parler-plan.broken.json) and run pnpm narration:export ' +
  'again; check seed-overrides.json first, because without the old plan remake seeds cannot be cross-checked'
const LOG_HINT = 'restore it from a backup; media-log.history.jsonl has every record ever written'

/** Largest seed transformers.set_seed accepts (numpy's limit). */
export const MAX_SEED = 4294967295

function isSeed(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= MAX_SEED
}

/** One line of the Colab notebook's manifest.jsonl (later lines for the same file win). */
export interface ManifestLine extends MadeWith {
  storyId: string
  nodeId: string
  locale: string
  narratedTextSha256: string
  seed: number
  mp3Sha256?: string
  bytes?: number
  rawPeak?: number
  gainDb?: number
  mp3Peak?: number
  longestSilenceS?: number
  nearCapParts?: number[]
  quietParts?: number[]
  capS?: number | null
  gpu?: string
  generatedAt?: string
}

interface PlanFile {
  recipe: typeof RECIPE_V2
  createdAt: string
  entries: ParlerPlanEntry[]
}

/**
 * Strict: only `--only <list>` and `--seed <n>`, or `--keep-plan-seeds` alone, each at most once;
 * anything else is refused.
 */
function parseExportArgs(args: readonly string[]): {
  only?: string[]
  seed?: number
  keepPlanSeeds?: true
} {
  let onlyRaw: string | undefined
  let seedRaw: string | undefined
  let keepPlanSeeds = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--keep-plan-seeds') {
      if (keepPlanSeeds) throw new Error('--keep-plan-seeds given twice')
      keepPlanSeeds = true
      continue
    }
    if (a === '--only' || a === '--seed') {
      const v = args[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`)
      if (a === '--only') {
        if (onlyRaw !== undefined) throw new Error('--only given twice')
        onlyRaw = v
      } else {
        if (seedRaw !== undefined) throw new Error('--seed given twice')
        seedRaw = v
      }
      i++
      continue
    }
    throw new Error(
      `unexpected argument "${a}": use --only story/node.locale,story/node.locale --seed N (commas, no spaces)`,
    )
  }
  let only: string[] | undefined
  if (onlyRaw !== undefined) {
    const parts = onlyRaw.split(',').map((s) => s.trim())
    if (parts.some((s) => s.length === 0))
      throw new Error(
        '--only has an empty entry (a space after a comma?): write k1,k2 without spaces',
      )
    only = [...new Set(parts)]
  }
  if (seedRaw !== undefined && !only)
    throw new Error(
      '--seed works only with --only (a full export uses seed 0 plus the saved remake seeds)',
    )
  if (only && seedRaw === undefined)
    throw new Error('--only needs --seed N: a seed these files have not used yet')
  let seed: number | undefined
  if (seedRaw !== undefined) {
    seed = /^\d{1,10}$/.test(seedRaw) ? Number(seedRaw) : NaN
    if (!isSeed(seed)) throw new Error(`--seed must be an integer from 0 to ${MAX_SEED}`)
  }
  if (keepPlanSeeds && only)
    throw new Error('--keep-plan-seeds cannot be combined with --only/--seed: run them separately')
  return {
    ...(only ? { only } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(keepPlanSeeds ? { keepPlanSeeds: true as const } : {}),
  }
}

export function readSeedOverrides(path: string): Record<string, number> {
  if (!existsSync(path)) return {}
  const raw = readJsonFile<unknown>(path, OVERRIDES_HINT)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new Error(`${path}: expected an object of "story/node.locale": seed`)
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!isSeed(v))
      throw new Error(`${path}: seed for ${k} must be an integer from 0 to ${MAX_SEED}`)
    out[k] = v
  }
  return out
}

function sortedObject(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

function readPackages(pkgDir: string): StoryPackageV1[] {
  return readdirSync(pkgDir)
    .filter((x) => x.endsWith('.phase1.json'))
    .sort()
    .map((f) => StoryPackageV1.parse(JSON.parse(readFileSync(join(pkgDir, f), 'utf8'))))
}

/** Every file the packages need now (story/node.locale), without building entries. */
function packageKeys(pkgDir: string): Set<string> {
  const keys = new Set<string>()
  for (const pkg of readPackages(pkgDir))
    for (const n of pkg.nodes)
      for (const l of pkg.locales) if (isParlerLocale(l)) keys.add(`${pkg.storyId}/${n.id}.${l}`)
  return keys
}

/** The plan as it must be now: every package node x supported locale, with saved remake seeds applied. */
export async function buildAllEntries(
  pkgDir: string,
  overrides: Record<string, number>,
): Promise<ParlerPlanEntry[]> {
  const entries: ParlerPlanEntry[] = []
  for (const pkg of readPackages(pkgDir)) {
    for (const n of pkg.nodes)
      for (const l of pkg.locales) {
        if (!isParlerLocale(l)) continue
        const seed = overrides[`${pkg.storyId}/${n.id}.${l}`] ?? RECIPE_V2.seed
        entries.push(await buildParlerEntry(pkg, n.id, l, seed))
      }
  }
  const known = new Set(entries.map(keyOf))
  const unknown = Object.keys(overrides).filter((k) => !known.has(k))
  if (unknown.length)
    throw new Error(
      `seed-overrides.json lists files that are no longer in the packages: ${unknown.join(', ')}. ` +
        'Delete those keys from seed-overrides.json',
    )
  return entries
}

function readPlan(path: string): PlanFile {
  const plan = readJsonFile<PlanFile>(path, PLAN_HINT)
  if (typeof plan !== 'object' || plan === null || !Array.isArray(plan.entries))
    throw new Error(`${path} is not a narration plan (no "entries" list): ${PLAN_HINT}`)
  return plan
}

function writePlan(path: string, entries: readonly ParlerPlanEntry[], createdAt: string): void {
  const plan: PlanFile = { recipe: RECIPE_V2, createdAt, entries: [...entries] }
  writeJsonAtomically(path, plan)
}

/** Compact UTC stamp with milliseconds for file names, e.g. 20261104T163800123Z. */
export function fileStamp(d: Date): string {
  return d.toISOString().replace(/[-:.]/g, '')
}

/**
 *   export                         -> parler-plan.json (every file, seed 0 or its saved remake seed)
 *   export --only k1,k2 --seed N   -> saves N for those files in seed-overrides.json, rewrites parler-plan.json
 *                                     and writes parler-plan.redo-<stamp>.json (only those files) to upload
 *   export --keep-plan-seeds       -> where seed-overrides.json and the last parler-plan.json disagree, keeps the
 *                                     plan's seeds (saves them in seed-overrides.json), then writes the plan
 */
export async function exportPlan(
  root: string,
  args: readonly string[],
  opts: { now: Date; log: Log },
): Promise<number> {
  const p = narrationPaths(root)
  const { only, seed, keepPlanSeeds } = parseExportArgs(args)
  const overrides = readSeedOverrides(p.overridesPath)

  // seed-overrides.json and the last parler-plan.json must agree for every file the packages still have:
  // a lost, edited or restored-from-backup overrides file must never silently change a remade file's seed.
  const keysNow = packageKeys(p.pkgDir)
  const lastPlan = existsSync(p.planPath) ? readPlan(p.planPath).entries : []
  const lastSeed = new Map(
    lastPlan.filter((e) => keysNow.has(keyOf(e))).map((e) => [keyOf(e), e.seed]),
  )
  const savedSeed = (k: string) => overrides[k] ?? RECIPE_V2.seed
  const disagree = (k: string) => lastSeed.has(k) && lastSeed.get(k) !== savedSeed(k)
  const disagreeing = [...lastSeed.keys()].filter(disagree)
  const conflicts = disagreeing
    .filter((k) => !only?.includes(k))
    .map(
      (k) =>
        `${k} (parler-plan.json seed ${lastSeed.get(k)}, seed-overrides.json ${overrides[k] ?? 'none'})`,
    )
  if (conflicts.length && !keepPlanSeeds)
    throw new Error(
      `seed-overrides.json and parler-plan.json disagree: ${conflicts.join(', ')}. ` +
        'To keep the seeds parler-plan.json uses: pnpm narration:export --keep-plan-seeds. ' +
        'To choose a seed: --only story/node.locale --seed N. Or restore seed-overrides.json',
    )
  if (keepPlanSeeds && !existsSync(p.planPath))
    throw new Error('--keep-plan-seeds needs an existing parler-plan.json')

  let next = keepPlanSeeds
    ? sortedObject({
        ...overrides,
        ...Object.fromEntries(disagreeing.map((k) => [k, lastSeed.get(k)!])),
      })
    : overrides
  if (only && seed !== undefined) {
    const missing = only.filter((k) => !keysNow.has(k))
    if (missing.length) throw new Error(`Unknown --only entries: ${missing.join(', ')}`)
    // A seed already in use is refused, except where the two files disagree (then --only settles it).
    const same = only.filter((k) => !disagree(k) && (lastSeed.get(k) ?? savedSeed(k)) === seed)
    if (same.length)
      throw new Error(
        `${same.join(', ')} already use${same.length === 1 ? 's' : ''} seed ${seed}: pick another seed`,
      )
    next = sortedObject({ ...overrides, ...Object.fromEntries(only.map((k) => [k, seed])) })
  }

  const entries = await buildAllEntries(p.pkgDir, next)
  const createdAt = opts.now.toISOString()
  const redoPath = only
    ? join(p.narrDir, `parler-plan.redo-${fileStamp(opts.now)}.json`)
    : undefined
  if (redoPath && existsSync(redoPath)) throw new Error(`${redoPath} already exists: try again`)
  mkdirSync(p.narrDir, { recursive: true })
  // Order matters: the overrides first, so an interrupted run still rebuilds the same plan next time.
  if (only || (keepPlanSeeds && disagreeing.length)) writeJsonAtomically(p.overridesPath, next)
  writePlan(p.planPath, entries, createdAt)
  if (keepPlanSeeds)
    opts.log(
      disagreeing.length
        ? `kept the parler-plan.json seeds for: ${disagreeing.map((k) => `${k} (seed ${lastSeed.get(k)})`).join(', ')}`
        : 'nothing to keep: seed-overrides.json and parler-plan.json already agree',
    )
  const chars = entries.reduce((s, e) => s + e.characters, 0)
  const remade = Object.keys(next).length
  opts.log(
    `plan: ${entries.length} files, ${chars.toLocaleString('en-IN')} spoken characters; ${remade} file${remade === 1 ? '' : 's'} with a remake seed`,
  )
  opts.log(`wrote ${p.planPath}`)
  if (redoPath && only) {
    const redo = entries.filter((e) => only.includes(keyOf(e)))
    writePlan(redoPath, redo, createdAt)
    opts.log(`wrote ${redoPath} (${redo.length} file${redo.length === 1 ? '' : 's'}, seed ${seed})`)
    opts.log(
      'next: upload this redo file in the Colab generator notebook (step 5). If an earlier redo file has not ' +
        'been run in Colab yet, upload parler-plan.json instead: Colab skips files that are already made.',
    )
  } else {
    opts.log('next: upload parler-plan.json in the Colab generator notebook (step 5)')
  }
  return 0
}

function readManifest(path: string): Map<string, ManifestLine> {
  const m = new Map<string, ManifestLine>()
  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!line.trim()) return
    let x: ManifestLine
    try {
      x = JSON.parse(line) as ManifestLine
    } catch {
      throw new Error(
        `manifest.jsonl line ${i + 1} is not valid JSON (a run was cut off while writing it): run step 7 of ` +
          'the Colab notebook once more (it repairs manifest.jsonl), then download again',
      )
    }
    m.set(keyOf(x), x) // later lines (remakes) win
  })
  return m
}

/** Cleans what a Windows shell may pass (a trailing quote or backslash) and explains common mistakes. */
function resolveFolder(folderArg: string | undefined): string {
  const cleaned = (folderArg ?? '')
    .trim()
    .replace(/"+$/, '')
    .replace(/[\\/]+$/, '')
  if (!cleaned)
    throw new Error(
      'Usage: pnpm narration:ingest <folder with manifest.jsonl and the story folders>',
    )
  const folder = resolve(cleaned)
  if (/\.zip$/i.test(folder))
    throw new Error(
      `${folder} is a zip file: extract it first, then point ingest at the extracted folder`,
    )
  if (!existsSync(folder)) throw new Error(`folder not found: ${folder}`)
  if (!statSync(folder).isDirectory()) throw new Error(`not a folder: ${folder}`)
  return folder
}

/** Finds manifest.jsonl in the folder; if it is one level deeper (Drive download), says where. */
function locateManifest(folder: string): string {
  const direct = join(folder, 'manifest.jsonl')
  if (existsSync(direct)) return direct
  const nested = readdirSync(folder)
    .map((d) => join(folder, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'manifest.jsonl')))
  if (nested.length === 1)
    throw new Error(
      `No manifest.jsonl in ${folder}, but there is one in ${nested[0]}: run pnpm narration:ingest "${nested[0]}"`,
    )
  throw new Error(
    `No manifest.jsonl in ${folder}: point ingest at the extracted Colab output folder`,
  )
}

/** Copies via a temporary name, so a locked or failing destination is never left half-written. */
function copyAtomically(src: string, dst: string): void {
  mkdirSync(dirname(dst), { recursive: true })
  const part = `${dst}.part`
  try {
    copyFileSync(src, part)
    renameSync(part, dst)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  }
}

export async function ingest(
  root: string,
  folderArg: string | undefined,
  opts: { now: Date; log: Log },
): Promise<number> {
  const p = narrationPaths(root)
  const folder = resolveFolder(folderArg)
  const manifestPath = locateManifest(folder)
  if (!existsSync(p.planPath)) throw new Error('No plan found: run pnpm narration:export first')

  // The plan of record must match the packages and the saved remake seeds right now.
  const overrides = readSeedOverrides(p.overridesPath)
  const plan = await buildAllEntries(p.pkgDir, overrides)
  const onDisk = new Map(readPlan(p.planPath).entries.map((e) => [keyOf(e), e.narratedTextSha256]))
  const stale = plan.filter((e) => onDisk.get(keyOf(e)) !== e.narratedTextSha256).map(keyOf)
  const extra = [...onDisk.keys()].filter((k) => !plan.some((e) => keyOf(e) === k))
  if (stale.length || extra.length) {
    const list = [...stale, ...extra]
    throw new Error(
      `parler-plan.json is out of date (${list.length} ${list.length === 1 ? 'file differs' : 'files differ'}, e.g. ${list
        .slice(0, 3)
        .join(', ')}): the packages or seed-overrides.json changed since the last export. ` +
        'Run pnpm narration:export, make those files in Colab, then ingest',
    )
  }
  const manifest = readManifest(manifestPath)

  const problems: string[] = []
  const qaItems: QaInput[] = []
  const accepted: {
    entry: ParlerPlanEntry
    src: string
    bytes: Uint8Array
    durationMs: number
    m: ManifestLine
  }[] = []
  for (const entry of plan) {
    const key = keyOf(entry)
    const src = join(folder, entry.storyId, `${entry.nodeId}.${entry.locale}.mp3`)
    if (!existsSync(src)) {
      problems.push(`${key}: missing file`)
      continue
    }
    const m = manifest.get(key)
    if (!m) {
      problems.push(`${key}: not in manifest.jsonl`)
      continue
    }
    if (m.narratedTextSha256 !== entry.narratedTextSha256) {
      problems.push(
        `${key}: made from an older plan (text, recipe or seed changed since): run the current plan in Colab`,
      )
      continue
    }
    const bytes = new Uint8Array(readFileSync(src))
    if (!m.mp3Sha256) {
      problems.push(`${key}: manifest line has no mp3Sha256 (made by an older notebook)`)
      continue
    }
    if (sha256(bytes) !== m.mp3Sha256) {
      problems.push(
        `${key}: file does not match its manifest line (stale or incomplete copy): download again`,
      )
      continue
    }
    const info = mp3Info(bytes)
    if (
      info.kbps.join() !== String(RECIPE_V2.output.bitrateKbps) ||
      info.sampleRate !== RECIPE_V2.output.sampleRateHz ||
      !info.mono ||
      info.durationMs <= 0
    ) {
      problems.push(`${key}: wrong audio format ${JSON.stringify(info)}`)
      continue
    }
    accepted.push({ entry, src, bytes, durationMs: info.durationMs, m })
    qaItems.push({
      key,
      locale: entry.locale,
      characters: entry.characters,
      durationMs: info.durationMs,
      ...(m.mp3Peak !== undefined ? { mp3Peak: m.mp3Peak } : {}),
      ...(m.longestSilenceS !== undefined ? { longestSilenceS: m.longestSilenceS } : {}),
      ...(m.nearCapParts !== undefined ? { nearCapParts: m.nearCapParts } : {}),
      ...(m.quietParts !== undefined ? { quietParts: m.quietParts } : {}),
      ...(m.modelRevision !== undefined ? { modelRevision: m.modelRevision } : {}),
      ...(m.parlerCommit !== undefined ? { parlerCommit: m.parlerCommit } : {}),
      ...(m.tokenizerRevision !== undefined ? { tokenizerRevision: m.tokenizerRevision } : {}),
    })
  }

  mkdirSync(p.narrDir, { recursive: true })
  const logPath = join(p.narrDir, 'media-log.json')
  const log: Record<string, unknown>[] = existsSync(logPath)
    ? readJsonFile<Record<string, unknown>[]>(logPath, LOG_HINT)
    : []
  const acceptedKeys = new Set(accepted.map((a) => keyOf(a.entry)))
  const alreadyLogged: MadeWith[] = log
    .filter((r) => !acceptedKeys.has(recKey(r)))
    .map((r) => ({
      ...(typeof r.modelRevision === 'string' && r.modelRevision !== 'unknown'
        ? { modelRevision: r.modelRevision }
        : {}),
      ...(typeof r.parlerCommit === 'string' ? { parlerCommit: r.parlerCommit } : {}),
      ...(typeof r.tokenizerRevision === 'string'
        ? { tokenizerRevision: r.tokenizerRevision }
        : {}),
    }))
  const flags = qaFlags(qaItems, undefined, alreadyLogged)
  const now = opts.now.toISOString()
  let stoppedAt: { key: string; err: unknown } | undefined
  for (const a of accepted) {
    const key = keyOf(a.entry)
    try {
      copyAtomically(a.src, join(p.audioDir, a.entry.file))
      const i = log.findIndex((r) => recKey(r) === key)
      const sha = sha256(a.bytes)
      const sameTake = i >= 0 && log[i]!.sha256 === sha
      // A remade file's new take stays on the listening list until `pnpm narration:listened`.
      const listenPending = sameTake ? log[i]!.listenPending === true : overrides[key] !== undefined
      const rec = {
        storyId: a.entry.storyId,
        nodeId: a.entry.nodeId,
        locale: a.entry.locale,
        file: `audio/${a.entry.file}`,
        bytes: a.bytes.length,
        sha256: sha,
        durationMs: a.durationMs,
        narratedTextSha256: a.entry.narratedTextSha256,
        recipe: RECIPE_V2.version,
        engine: RECIPE_V2.engine,
        model: RECIPE_V2.model,
        modelRevision: a.m.modelRevision ?? 'unknown',
        ...(a.m.parlerCommit !== undefined ? { parlerCommit: a.m.parlerCommit } : {}),
        ...(a.m.tokenizerRevision !== undefined
          ? { tokenizerRevision: a.m.tokenizerRevision }
          : {}),
        voice: a.entry.voice,
        seed: a.entry.seed,
        levelPeakDbfs: a.entry.levelPeakDbfs,
        ...(a.m.gainDb !== undefined ? { gainDb: a.m.gainDb } : {}),
        environment: a.m.gpu ? `Google Colab (${a.m.gpu})` : 'Google Colab',
        generatedAt: a.m.generatedAt ?? 'unknown',
        ingestedAt: now,
        ...(listenPending ? { listenPending: true } : {}),
        provenance: {
          origin: 'ai_generated',
          vendor: 'AI4Bharat',
          product: 'Indic Parler-TTS (Apache-2.0)',
          voice: a.entry.voice,
        },
      }
      if (i >= 0) log[i] = rec
      else log.push(rec)
      // After every file, so media-log.json matches the audio folder even if the run is cut off.
      writeJsonAtomically(logPath, log)
      appendFileSync(join(p.narrDir, 'media-log.history.jsonl'), JSON.stringify(rec) + '\n')
    } catch (err) {
      stoppedAt = { key, err }
      break
    }
  }

  const planKeys = new Set(plan.map(keyOf))
  const remakesToHear = log
    .filter((r) => r.listenPending === true && planKeys.has(recKey(r)))
    .map(recKey)
    .sort()
  const listen = [
    ...plan.filter((e) => e.nodeId === 'start').map(keyOf),
    ...flags.map((f) => f.key),
    ...remakesToHear,
  ]
  const report = {
    generatedAt: now,
    recipe: RECIPE_V2.version,
    expected: plan.length,
    accepted: accepted.length,
    ...(stoppedAt
      ? {
          stoppedEarly: `ingesting ${stoppedAt.key} failed: ${stoppedAt.err instanceof Error ? stoppedAt.err.message : String(stoppedAt.err)}`,
        }
      : {}),
    problems,
    flags,
    remakesToHear,
    listen: [...new Set(listen)],
  }
  writeJsonAtomically(join(p.narrDir, 'qa-report.json'), report)
  if (stoppedAt)
    throw new Error(
      `${report.stoppedEarly}. Files before it were copied and logged. Close any program using that file ` +
        '(for example a media player) and run ingest again',
    )

  opts.log(
    `accepted ${accepted.length}/${plan.length}; problems ${problems.length}; flagged ${flags.length}`,
  )
  for (const x of problems) opts.log(`  PROBLEM ${x}`)
  for (const f of flags) opts.log(`  FLAG ${f.key}: ${f.reasons.join('; ')}`)
  opts.log(
    `listen to ${report.listen.length} files (start nodes + flagged + remakes not yet heard): see migration-input/narration/qa-report.json`,
  )
  if (remakesToHear.length)
    opts.log('after hearing the remakes: pnpm narration:listened story/node.locale,... (or --all)')
  return problems.length === 0 ? 0 : 1
}

/**
 *   listened k1,k2   -> marks those remade files as heard (they leave the listening list)
 *   listened --all   -> marks every remade file waiting to be heard
 */
export function markListened(root: string, args: readonly string[], opts: { log: Log }): number {
  const p = narrationPaths(root)
  const logPath = join(p.narrDir, 'media-log.json')
  if (args.length !== 1 || !args[0])
    throw new Error(
      'Usage: pnpm narration:listened story/node.locale,story/node.locale (commas, no spaces) | --all',
    )
  if (!existsSync(logPath)) throw new Error('No media log yet: run pnpm narration:ingest first')
  const log = readJsonFile<Record<string, unknown>[]>(logPath, LOG_HINT)
  const pending = log.filter((r) => r.listenPending === true).map(recKey)
  let keys: string[]
  if (args[0] === '--all') keys = pending
  else {
    keys = [...new Set(args[0].split(',').map((x) => x.trim()))]
    if (keys.some((k) => !k)) throw new Error('empty entry (a space after a comma?): write k1,k2')
    const notPending = keys.filter((k) => !pending.includes(k))
    if (notPending.length)
      throw new Error(
        `not waiting to be heard: ${notPending.join(', ')} (waiting: ${pending.join(', ') || 'none'})`,
      )
  }
  for (const r of log) if (keys.includes(recKey(r))) delete r.listenPending
  writeJsonAtomically(logPath, log)
  opts.log(
    `marked ${keys.length} remade file${keys.length === 1 ? '' : 's'} as heard; still waiting: ${pending.length - keys.length}`,
  )
  return 0
}
