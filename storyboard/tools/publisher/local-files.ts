// Safe local reads for the publisher (design migration-input/p1-step14-design.md §6, §9 L3, L17,
// TP-4, TP-7; P1-8c, Step 14). A file is named by a root folder (the owner's choice) and segments
// under it. Each segment must pass the segment rule before any fs call; then, segment by segment,
// the exact name must be listed in its parent folder (win32 opens another case, PB2), no segment
// may be a symbolic link or junction (lstat; PB3), each folder must be a folder and the leaf a
// regular file within the cap, and the bytes read must have the length lstat gave. A result is
// `{ok: false, code}` only: no path, segment or message ever leaves this module.
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SEGMENT = /^[A-Za-z0-9._@-]+$/

export type LocalFileCode =
  | 'local-file-path'
  | 'local-file-missing'
  | 'local-file-not-regular'
  | 'local-file-too-large'
  | 'local-file-changed'

export type LocalRead =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly code: LocalFileCode }

export type LocalList =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly code: 'local-file-missing' }

const refuse = (code: LocalFileCode): LocalRead => ({ ok: false, code })

/** The segment rule (TP-4): letters, digits, `.`, `_`, `@`, `-`; never `.` or `..`. */
export function isLocalSegment(segment: string): boolean {
  return SEGMENT.test(segment) && segment !== '.' && segment !== '..'
}

/**
 * Reads `<root>/<segments...>` as exact bytes over their own ArrayBuffer, at most `cap` bytes
 * (inclusive). Refusals: `local-file-path` (a segment fails the rule; no fs call made),
 * `local-file-missing` (absent, or present only in another case), `local-file-not-regular` (a link
 * or junction on any segment, a folder segment that is not a folder, a leaf that is not a regular
 * file), `local-file-too-large`, `local-file-changed` (the read length differs from lstat's).
 */
export function readLocalFile(root: string, segments: readonly string[], cap: number): LocalRead {
  if (!Number.isSafeInteger(cap) || cap < 0) throw new TypeError('cap must be a safe integer >= 0')
  if (segments.length === 0 || !segments.every(isLocalSegment)) return refuse('local-file-path')
  let folder = root
  for (const [index, segment] of segments.entries()) {
    let names: string[]
    try {
      names = readdirSync(folder)
    } catch {
      return refuse('local-file-missing')
    }
    if (!names.includes(segment)) return refuse('local-file-missing')
    const path = join(folder, segment)
    let stat: ReturnType<typeof lstatSync>
    try {
      stat = lstatSync(path)
    } catch {
      return refuse('local-file-missing')
    }
    if (stat.isSymbolicLink()) return refuse('local-file-not-regular')
    if (index < segments.length - 1) {
      if (!stat.isDirectory()) return refuse('local-file-not-regular')
      folder = path
      continue
    }
    if (!stat.isFile()) return refuse('local-file-not-regular')
    if (stat.size > cap) return refuse('local-file-too-large')
    let raw: Buffer
    try {
      raw = readFileSync(path)
    } catch {
      return refuse('local-file-changed')
    }
    if (raw.length !== stat.size) return refuse('local-file-changed')
    return { ok: true, bytes: new Uint8Array(raw) }
  }
  return refuse('local-file-path')
}

/**
 * The entry names of a folder, sorted by UTF-16 code units (for `--all`, TP-7). Names only: the
 * caller selects exact `<StoryId>.json` names and reads each through readLocalFile, so a folder or
 * link with such a name is refused there, never skipped here.
 */
export function listLocalFolder(root: string): LocalList {
  try {
    return { ok: true, names: readdirSync(root).sort() }
  } catch {
    return { ok: false, code: 'local-file-missing' }
  }
}
