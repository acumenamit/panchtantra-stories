// pnpm migrate:bind (design migration-input/p1-step17-design.md D17-3, D17-22, D17-29, §3.3, A14,
// A21, A37; P1-9a, Step 17): the media binder on the owner's PC.
//   corepack pnpm migrate:bind --approved-map-sha256 <64 lower hex> --package-version <2-999> [--dry-run]
// - Flags: exactly those three (a Map; unknown, repeated or value-less flags and any positional are
//   `bind: stopped: usage`, exit 2; no message echoes a value). Here-only: win32 and none of
//   GITHUB_ACTIONS, VERCEL, VERCEL_ENV set (args.ts captureRunContext: names case-folded on win32,
//   an empty value counts as set), else `bind: stopped: bind-here-only`, exit 2. Both are judged
//   before any input is read or the codec is loaded.
// - realInputs: fixed, module-relative paths, each file read once through readLocalFile (segment
//   rule, exact case, no link or junction below the root, regular file, the binder's cap); the
//   legacy modules through loadFrozenLegacyStories with localLegacyIo, so a link named like a module
//   stops the load. No path argument exists; the roots themselves are not realpath-checked (limit
//   L3-3). The output is migration-input/phase2, guarded by bind-output.ts.
// - The entry block runs only as the process entry point (cli.ts's pattern), so tests import this
//   module without side effects.
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEntryPoint } from '../../scripts/load-content'
import { captureRunContext } from '../publisher/args'
import { listLocalFolder, readLocalFile } from '../publisher/local-files'
import { runBind } from './bind'
import type { BindDeps, BindInputs, BindOptions } from './bind'
import { nodeOutputFs } from './bind-output'
import { loadSharpCodec } from './image-codec'
import manifest from './legacy-manifest.json'
import { loadFrozenLegacyStories } from './load-legacy'
import type { LegacyIo } from './load-legacy'

/** storyboard/, from this module's place (tools/migrate/). */
const STORYBOARD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** The largest legacy story module read (each is tens of kilobytes). */
export const LEGACY_MODULE_MAX_BYTES = 1_048_576

const HEX64 = /^[0-9a-f]{64}$/
const PACKAGE_VERSION = /^[1-9][0-9]{0,2}$/
const VALUE_FLAGS: ReadonlySet<string> = new Set(['--approved-map-sha256', '--package-version'])

export type BindArgs = { readonly ok: true; readonly options: BindOptions } | { readonly ok: false }

/** The three flags, strictly (§3.3). */
export function parseBindArgs(argv: readonly string[]): BindArgs {
  const refused: BindArgs = { ok: false }
  const values = new Map<string, string>()
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--dry-run') {
      if (dryRun) return refused
      dryRun = true
      continue
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1]
      if (value === undefined || values.has(arg)) return refused
      values.set(arg, value)
      i++
      continue
    }
    return refused
  }
  const hex = values.get('--approved-map-sha256')
  const version = values.get('--package-version')
  if (hex === undefined || !HEX64.test(hex)) return refused
  if (version === undefined || !PACKAGE_VERSION.test(version) || Number(version) < 2) return refused
  return { ok: true, options: { approvedMapSha256: hex, packageVersion: Number(version), dryRun } }
}

export interface BindCliDeps extends BindDeps {
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Usage and here-only first, then the binder; the exit code (0, 1, or 2). */
export async function runBindCli(argv: readonly string[], deps: BindCliDeps): Promise<number> {
  const args = parseBindArgs(argv)
  if (!args.ok) {
    deps.error('bind: stopped: usage')
    return 2
  }
  const runContext = captureRunContext(deps.env, deps.platform)
  if (deps.platform !== 'win32' || Object.keys(runContext).length > 0) {
    deps.error('bind: stopped: bind-here-only')
    return 2
  }
  return runBind(args.options, deps)
}

/**
 * The frozen loader's reads over `dir` through listLocalFolder and readLocalFile (CRIT-5): a link,
 * a junction, a folder or an oversize file named like a module throws, by code only.
 */
export function localLegacyIo(dir: string): LegacyIo {
  return {
    list: (folder) => {
      if (folder !== dir) throw new Error('legacy stories: another folder')
      const listed = listLocalFolder(folder)
      if (!listed.ok) throw new Error('legacy stories: the folder cannot be listed')
      return listed.names
    },
    read: (path) => {
      const name = basename(path)
      if (join(dir, name) !== path) throw new Error('legacy stories: a path outside the folder')
      const read = readLocalFile(dir, [name], LEGACY_MODULE_MAX_BYTES)
      if (!read.ok) throw new Error(`legacy stories: ${read.code}`)
      return read.bytes
    },
  }
}

/** The binder's real inputs: fixed paths relative to this module (§3.3). */
export function realInputs(): BindInputs {
  const mi = join(STORYBOARD_ROOT, 'migration-input')
  const storiesDir = join(STORYBOARD_ROOT, '..', 'pt', 'src', 'stories')
  const publicDir = join(STORYBOARD_ROOT, '..', 'pt', 'public')
  const packagesDir = join(mi, 'packages')
  const narrationDir = join(mi, 'narration')
  const audioDir = join(mi, 'audio')
  return {
    legacyStories: () =>
      loadFrozenLegacyStories(storiesDir, manifest.sourceFiles, localLegacyIo(storiesDir)).map(
        (loaded) => loaded.story,
      ),
    map: (cap) => readLocalFile(mi, ['p1-step17-image-map.json'], cap),
    legacyFile: (segments, cap) => readLocalFile(publicDir, segments, cap),
    phase1List: () => listLocalFolder(packagesDir),
    phase1Read: (name, cap) => readLocalFile(packagesDir, [name], cap),
    corrections: (cap) =>
      readLocalFile(STORYBOARD_ROOT, ['tools', 'migrate', 'text-corrections.json'], cap),
    overrides: (cap) =>
      readLocalFile(STORYBOARD_ROOT, ['tools', 'migrate', 'image-map-overrides.json'], cap),
    seedOverrides: (cap) => readLocalFile(narrationDir, ['seed-overrides.json'], cap),
    mediaLog: (cap) => readLocalFile(narrationDir, ['media-log.json'], cap),
    history: (cap) => readLocalFile(narrationDir, ['media-log.history.jsonl'], cap),
    hashList: (cap) => readLocalFile(audioDir, ['SHA256SUMS.txt'], cap),
    audio: (segments, cap) => readLocalFile(audioDir, segments, cap),
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const deps: BindCliDeps = {
    inputs: realInputs(),
    loadCodec: loadSharpCodec,
    outputRoot: join(STORYBOARD_ROOT, 'migration-input', 'phase2'),
    now: () => new Date(),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    env: process.env,
    platform: process.platform,
    realPath: realpathSync.native,
    fs: nodeOutputFs,
    randomHex: () => randomBytes(4).toString('hex'),
  }
  runBindCli(process.argv.slice(2), deps).then(
    (code) => {
      process.exitCode = code
    },
    () => {
      process.exitCode = 1
    },
  )
}
