// The file source (design p1-step8-design.md §2, §10.3; P1-2b): reads catalogue and package files
// from a local folder by gate-checked Storage-style paths. Fixtures mode reads the committed files
// under fixtures/ through it (owner decision D1); the checks and messages are those of the loader's
// former readFixture (spec §3.2): a safe path, the real file (links resolved) inside the folder, a
// regular file, at most 1 MiB.
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { isSafeStoragePath, type GateResult } from '../../src/core/content/gates'
import { MAX_BODY_BYTES } from './request'

/** Reads one file by a path relative to the folder; `label` names it in a failure. */
export type FileSource = (path: string, label: string) => GateResult<Uint8Array<ArrayBuffer>>

const fail = <T>(reason: string): GateResult<T> => ({ ok: false, reason })

/**
 * A reader for the folder `dir`, named `name` in messages ("fixtures folder not found", "… path
 * leaves the fixtures folder"). Nothing outside the folder can be read, even through a link.
 */
export function createFileSource(dir: string, name: string): FileSource {
  return (path, label) => {
    if (!isSafeStoragePath(path)) return fail(`${label} path is unsafe`)
    let base: string
    try {
      base = realpathSync.native(dir)
    } catch {
      return fail(`${name} folder not found`)
    }
    let file: string
    try {
      file = realpathSync.native(join(base, ...path.split('/')))
    } catch {
      return fail(`${label} file not found: ${path}`)
    }
    const inside = relative(base, file)
    if (inside === '' || isAbsolute(inside) || inside.split(sep)[0] === '..') {
      return fail(`${label} path leaves the ${name} folder`)
    }
    const stat = statSync(file)
    if (!stat.isFile()) return fail(`${label} is not a file: ${path}`)
    if (stat.size > MAX_BODY_BYTES) return fail(`${label} is larger than ${MAX_BODY_BYTES} bytes`)
    return { ok: true, value: new Uint8Array(readFileSync(file)) }
  }
}
