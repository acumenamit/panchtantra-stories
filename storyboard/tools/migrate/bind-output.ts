// The media binder's local writer for migration-input/phase2 (P2) (design
// migration-input/p1-step17-design.md D17-22, D17-26, §3.22, A20, A34, A39; P1-9a, Step 17).
// - Before any fs call the output root (P2, given and resolved) is refused when it is a device or
//   network form, or, on win32, holds a segment Windows cannot store as written (output-not-real).
// - Real paths (CRIT-7): realPath(MI), MI being P2's parent, must equal the resolved MI under
//   report.ts's foldFor(platform) (D15-28) and pass isLocalRealPath, checked BEFORE P2 is created;
//   P2's own real path is checked the same way after mkdir (or when it exists). A difference or a
//   failure is output-not-real. The path functions follow the injected platform.
// - Folders: P2, P2/.tmp and every folder on a target's path must be a directory by lstat, never a
//   symbolic link or junction (output-not-directory); a folder that fails to list is
//   output-not-directory, never read as empty. Every segment passes isLocalSegment (output-path).
// - Writes (D17-26): each file goes first to a new temp P2/.tmp/<name>.<pid>-<8 hex>.part (flag wx;
//   a new hex on EEXIST, at most 3 draws) and is re-read. A create-only file (media, masters) is
//   hard-linked into place after the pre-check of the whole batch (absent: write; equal: skip;
//   other bytes: output-file-differs, before any write); a name that appears after the pre-check is
//   compared (equal: skipped; other: output-file-differs, those bytes kept); a link failure is
//   output-write with the temp kept; the temp is unlinked only after a successful link and re-read.
//   A replaced file (packages, the ledger, the report) is renamed over the old one; a failed rename
//   keeps the old bytes. A final name never holds partial bytes, no temp ever sits beside one, and
//   nothing is deleted except the writer's own temp after a successful link: stale temps stay in
//   P2/.tmp and are counted when the output is opened.
// Every refusal is an OutputError whose message is its code: no path ever leaves this module.
import * as nodeFs from 'node:fs'
import { posix, win32 } from 'node:path'
import { hasUnstorableSegment, isDeviceOrNetworkPath } from '../publisher/args'
import { isLocalSegment } from '../publisher/local-files'
import { foldFor, isLocalRealPath } from '../publisher/report'

export type OutputCode =
  | 'output-not-directory'
  | 'output-not-real'
  | 'output-path'
  | 'output-file-differs'
  | 'output-write'

/** A refusal of the writer; the message is the bare code. */
export class OutputError extends Error {
  readonly code: OutputCode
  constructor(code: OutputCode) {
    super(code)
    this.name = 'OutputError'
    this.code = code
  }
}

export interface OutputStat {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** The fs calls the writer makes (node:fs in the CLI; a recording or faulty wrapper in tests). */
export interface OutputFs {
  lstat(path: string): OutputStat
  readdir(path: string): string[]
  mkdir(path: string): void
  readFile(path: string): Uint8Array
  writeFile(path: string, bytes: Uint8Array, options: { readonly flag: 'wx' }): void
  link(existingPath: string, newPath: string): void
  unlink(path: string): void
  rename(oldPath: string, newPath: string): void
}

/** node:fs through the adapter. */
export const nodeOutputFs: OutputFs = {
  lstat: (path) => nodeFs.lstatSync(path),
  readdir: (path) => nodeFs.readdirSync(path),
  mkdir: (path) => nodeFs.mkdirSync(path),
  readFile: (path) => new Uint8Array(nodeFs.readFileSync(path)),
  writeFile: (path, bytes, options) => nodeFs.writeFileSync(path, bytes, { flag: options.flag }),
  link: (existingPath, newPath) => nodeFs.linkSync(existingPath, newPath),
  unlink: (path) => nodeFs.unlinkSync(path),
  rename: (oldPath, newPath) => nodeFs.renameSync(oldPath, newPath),
}

export interface OutputDeps {
  readonly fs: OutputFs
  /** realpathSync.native in the CLI. */
  readonly realPath: (path: string) => string
  readonly platform: string
  /** 8 lower-case hex characters per call (node:crypto in the CLI). */
  readonly randomHex: () => string
}

export interface OutputTarget {
  /** Segments under P2, each passing isLocalSegment. */
  readonly segments: readonly string[]
  readonly bytes: Uint8Array
}

export interface PlannedTarget extends OutputTarget {
  readonly state: 'write' | 'skip'
}

export interface CreateResult {
  readonly written: number
  readonly skipped: number
}

export type OutputKind = 'absent' | 'dir' | 'file' | 'link' | 'other'

export interface Output {
  /** The entries in P2/.tmp when the output was opened (stale temps of a cut-off run). */
  readonly staleParts: number
  /** What lstat says of a name under P2 (absent when P2 or a folder on the path is absent). */
  kind(segments: readonly string[]): OutputKind
  /** A regular file's bytes under P2, or null when it (or P2) is absent. */
  read(segments: readonly string[]): Uint8Array | null
  /** A folder's entry names under P2 ([] is P2 itself), or null when it is absent. */
  list(segments: readonly string[]): readonly string[] | null
  /** The create-only pre-check of a whole batch, before any write; throws on the first refusal. */
  precheck(targets: readonly OutputTarget[]): PlannedTarget[]
  /** The pre-check of the whole batch, then each write in order (create-only, by hard link). */
  createAll(targets: readonly OutputTarget[]): CreateResult
  /** Writes one file through a temp and a rename over the old one. */
  replace(target: OutputTarget): void
}

/** The temp folder under P2. */
export const TEMP_FOLDER = '.tmp'
const HEX8 = /^[0-9a-f]{8}$/
const TEMP_DRAWS = 3

const errnoOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Opens P2 (`outputRoot`) for reading or writing. Read mode never creates anything; write mode
 * creates P2 when absent and checks its real path after the mkdir.
 */
export function openOutput(outputRoot: string, deps: OutputDeps, mode: 'read' | 'write'): Output {
  const paths = deps.platform === 'win32' ? win32 : posix
  const root = paths.resolve(outputRoot)
  for (const form of [outputRoot, root]) {
    if (isDeviceOrNetworkPath(form)) throw new OutputError('output-not-real')
    if (deps.platform === 'win32' && hasUnstorableSegment(form))
      throw new OutputError('output-not-real')
  }
  const fold = foldFor(deps.platform)
  const checkReal = (path: string): void => {
    let real: string
    try {
      real = deps.realPath(path)
    } catch {
      throw new OutputError('output-not-real')
    }
    if (fold(real) !== fold(path) || !isLocalRealPath(real))
      throw new OutputError('output-not-real')
  }
  const { fs } = deps
  const kindOf = (path: string): OutputKind => {
    let stat: OutputStat
    try {
      stat = fs.lstat(path)
    } catch (error) {
      if (errnoOf(error) === 'ENOENT') return 'absent'
      throw new OutputError('output-not-directory')
    }
    if (stat.isSymbolicLink()) return 'link'
    if (stat.isDirectory()) return 'dir'
    if (stat.isFile()) return 'file'
    return 'other'
  }
  const makeFolder = (path: string): void => {
    try {
      fs.mkdir(path)
    } catch {
      throw new OutputError('output-write')
    }
    if (kindOf(path) !== 'dir') throw new OutputError('output-not-directory')
  }

  // MI before P2 exists; P2 after its mkdir (or as found).
  checkReal(paths.dirname(root))
  let rootKind = kindOf(root)
  if (rootKind === 'absent' && mode === 'write') {
    makeFolder(root)
    rootKind = 'dir'
  }
  if (rootKind !== 'absent') {
    if (rootKind !== 'dir') throw new OutputError('output-not-directory')
    checkReal(root)
  }

  const checkSegments = (segments: readonly string[]): void => {
    if (segments.length === 0 || !segments.every(isLocalSegment))
      throw new OutputError('output-path')
  }
  /** The folder at `segments` under P2 (each a real directory), created when asked; null if absent. */
  const folder = (segments: readonly string[], create: boolean): string | null => {
    if (rootKind === 'absent') return null
    let path = root
    for (const segment of segments) {
      path = paths.join(path, segment)
      const kind = kindOf(path)
      if (kind === 'absent') {
        if (!create) return null
        makeFolder(path)
      } else if (kind !== 'dir') throw new OutputError('output-not-directory')
    }
    return path
  }
  /** A folder that must exist after `folder(..., true)` (absent only when P2 is not open for writing). */
  const writable = (segments: readonly string[]): string => {
    const dir = folder(segments, true)
    if (dir === null) throw new OutputError('output-write')
    return dir
  }
  const readDir = (path: string): string[] => {
    try {
      return fs.readdir(path)
    } catch {
      throw new OutputError('output-not-directory')
    }
  }
  const staleParts = (() => {
    const tmp = folder([TEMP_FOLDER], false)
    return tmp === null ? 0 : readDir(tmp).length
  })()

  const kind = (segments: readonly string[]): OutputKind => {
    checkSegments(segments)
    const dir = folder(segments.slice(0, -1), false)
    return dir === null ? 'absent' : kindOf(paths.join(dir, segments[segments.length - 1]!))
  }
  const read = (segments: readonly string[]): Uint8Array | null => {
    checkSegments(segments)
    const dir = folder(segments.slice(0, -1), false)
    if (dir === null) return null
    const path = paths.join(dir, segments[segments.length - 1]!)
    const leaf = kindOf(path)
    if (leaf === 'absent') return null
    if (leaf === 'link') throw new OutputError('output-not-directory')
    if (leaf !== 'file') throw new OutputError('output-file-differs')
    try {
      return fs.readFile(path)
    } catch {
      throw new OutputError('output-file-differs')
    }
  }
  const list = (segments: readonly string[]): readonly string[] | null => {
    if (segments.length > 0) checkSegments(segments)
    const dir = folder(segments, false)
    return dir === null ? null : readDir(dir)
  }

  /** The file re-read and compared with what was written (output-write on any difference). */
  const verify = (path: string, bytes: Uint8Array): void => {
    let back: Uint8Array
    try {
      back = fs.readFile(path)
    } catch {
      throw new OutputError('output-write')
    }
    if (!sameBytes(back, bytes)) throw new OutputError('output-write')
  }
  /** A new temp under P2/.tmp holding exactly `bytes`; its path. */
  const writeTemp = (name: string, bytes: Uint8Array): string => {
    const tmp = writable([TEMP_FOLDER])
    for (let draw = 0; draw < TEMP_DRAWS; draw++) {
      const hex = deps.randomHex()
      if (!HEX8.test(hex)) throw new OutputError('output-write')
      const temp = paths.join(tmp, `${name}.${process.pid}-${hex}.part`)
      try {
        fs.writeFile(temp, bytes, { flag: 'wx' })
      } catch (error) {
        if (errnoOf(error) === 'EEXIST') continue
        throw new OutputError('output-write')
      }
      verify(temp, bytes)
      return temp
    }
    throw new OutputError('output-write')
  }

  const precheck = (targets: readonly OutputTarget[]): PlannedTarget[] => {
    for (const target of targets) checkSegments(target.segments)
    const seen = new Map<string, Uint8Array>()
    return targets.map((target) => {
      const key = target.segments.join('/')
      const earlier = seen.get(key)
      if (earlier !== undefined) {
        if (!sameBytes(earlier, target.bytes)) throw new OutputError('output-file-differs')
        return { ...target, state: 'skip' as const }
      }
      seen.set(key, target.bytes)
      const present = read(target.segments)
      if (present === null) return { ...target, state: 'write' as const }
      if (!sameBytes(present, target.bytes)) throw new OutputError('output-file-differs')
      return { ...target, state: 'skip' as const }
    })
  }
  const createOne = (target: OutputTarget): 'written' | 'skipped' => {
    const dir = writable(target.segments.slice(0, -1))
    const name = target.segments[target.segments.length - 1]!
    const final = paths.join(dir, name)
    const temp = writeTemp(name, target.bytes)
    try {
      fs.link(temp, final)
    } catch (error) {
      if (errnoOf(error) !== 'EEXIST') throw new OutputError('output-write')
      let present: Uint8Array
      try {
        present = fs.readFile(final)
      } catch {
        throw new OutputError('output-write')
      }
      if (sameBytes(present, target.bytes)) return 'skipped'
      throw new OutputError('output-file-differs')
    }
    verify(final, target.bytes)
    try {
      fs.unlink(temp)
    } catch {
      // The temp stays in P2/.tmp and is counted by the next run; the final file is complete.
    }
    return 'written'
  }
  const createAll = (targets: readonly OutputTarget[]): CreateResult => {
    const planned = precheck(targets)
    let written = 0
    let skipped = 0
    for (const target of planned) {
      if (target.state === 'skip' || createOne(target) === 'skipped') skipped++
      else written++
    }
    return { written, skipped }
  }
  const replace = (target: OutputTarget): void => {
    checkSegments(target.segments)
    const dir = writable(target.segments.slice(0, -1))
    const name = target.segments[target.segments.length - 1]!
    const final = paths.join(dir, name)
    const temp = writeTemp(name, target.bytes)
    try {
      fs.rename(temp, final)
    } catch {
      throw new OutputError('output-write')
    }
    verify(final, target.bytes)
  }

  return { staleParts, kind, read, list, precheck, createAll, replace }
}
