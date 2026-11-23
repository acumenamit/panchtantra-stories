// The plan and set digests of `masters` and `stage` (design migration-input/p1-step17-design.md
// §3.20, D17-20, TP17-10; P1-9a, Step 17). Pure: src/core only (fence FS4d).
// - The objects are sorted by path in UTF-16 code units (never localeCompare), each digested as
//   {path, sha256, bytes, contentType}.
// - set = sha256 of the JCS of {command, objects, fixed}: what the run would put in Storage.
// - plan = sha256 of the JCS of {command, objects with their state, fixed, variable}: the set plus
//   what the run found (states, seqs), so a cut-off commit keeps its set and changes its plan.
// - Two objects with one path, a malformed object, or an unpaired surrogate in any string (command,
//   object, fixed or variable, keys included) is a TypeError (the runner prints internal); zero
//   objects give two defined digests.
import { jcsBytes, sha256Hex } from '../../src/core/hashing'

/** One planned object, as both commands list it. */
export interface PlanObject {
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly contentType: string
  /** The plan state: new or existing (stage: new or existing as its listing found). */
  readonly state: string
}

export interface PlanExtra {
  /** What the commit puts in place whatever it finds (stage: the named stories). */
  readonly fixed: unknown
  /** What the plan found (stage: the seqs and states); in the plan digest only. */
  readonly variable: unknown
}

export interface PlanDigests {
  readonly plan: string
  readonly set: string
}

function refuse(what: string): never {
  throw new TypeError(`plan digest: ${what}`)
}

/** Throws unless every string in `value` (object keys included) is well-formed UTF-16. */
function checkText(value: unknown, depth = 0): void {
  if (depth > 64) refuse('nesting')
  if (typeof value === 'string') {
    if (!value.isWellFormed()) refuse('ill-formed text')
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (!key.isWellFormed()) refuse('ill-formed text')
    checkText(child, depth + 1)
  }
}

const codeUnitOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** The plan and set digests of `objects` (any order) under `command` (§3.20). */
export async function planDigests(
  command: string,
  objects: readonly PlanObject[],
  extra: PlanExtra,
): Promise<PlanDigests> {
  if (typeof command !== 'string' || command === '') refuse('command')
  const copies = objects.map((object) => {
    const { path, sha256, bytes, contentType, state } = object
    if (
      typeof path !== 'string' ||
      typeof sha256 !== 'string' ||
      typeof contentType !== 'string' ||
      typeof state !== 'string' ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0
    ) {
      refuse('object')
    }
    return { path, sha256, bytes, contentType, state }
  })
  copies.sort((a, b) => codeUnitOrder(a.path, b.path))
  for (let i = 1; i < copies.length; i++) {
    if (copies[i]!.path === copies[i - 1]!.path) refuse('two objects with one path')
  }
  checkText([command, copies, extra.fixed, extra.variable])
  const set = await sha256Hex(
    jcsBytes({
      command,
      objects: copies.map(({ path, sha256, bytes, contentType }) => ({
        path,
        sha256,
        bytes,
        contentType,
      })),
      fixed: extra.fixed,
    }),
  )
  const plan = await sha256Hex(
    jcsBytes({ command, objects: copies, fixed: extra.fixed, variable: extra.variable }),
  )
  return { plan, set }
}
