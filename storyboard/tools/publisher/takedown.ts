// The publisher's takedown: this PC's hash list, the takedown plan and its commit (design
// migration-input/p1-step15b-design.md §2.1, §3.9 to §3.12, §4.3, §4.4, D15B-9 to D15B-12, D15B-29,
// D15B-34, D15B-36; P1-8d part b, Step 15b).
// - parseHashList reads `migration-input/audio/SHA256SUMS.txt`'s bytes by a strict rule: no BOM on
//   the raw bytes; every byte LF or printable ASCII (so no CR, TAB, NUL, control, non-ASCII, bidi,
//   encoded surrogate or U+FEFF); exactly one final LF and no empty line; at most 10,000 lines; each
//   line `<64 hex>␠␠<StoryId>/<NodeId>.<locale>.mp3` with a locale of LOCALE_CODES, no reserved
//   device stem and no path twice. Any failure refuses the whole list (`hash-list-invalid`).
// - planTakedown lists the story's two folders (every listed path must be its package or media
//   class, none twice), checks the story's own entry in the P and S states (its package read and
//   gated, its package path and every media head listed), then the hash list (the audio folder's real
//   path local through the required `realPath`, the list read through readLocalFile) and proves each
//   MP3 object separately: a line of the same story, tried in list order, whose local file has the
//   object's sha256 and listed size. An MP3 that no line proves is kept, never deleted (D15B-29).
// - commitTakedown runs after verify confirmed the story gone: both snapshots read fresh, the story in
//   neither, every package either names read and planned, a fresh listing that adds nothing, the MP3
//   proof again over what is still listed; then the deleter (built here, once), chunks of at most 100
//   in code-unit order with both pointers re-read before each, and after the last a re-list that must
//   equal the kept set and a last pointer re-read. A chunk that is not removed stops after a re-list
//   (`takedown-incomplete`); nothing is retried.
// - Results are codes, counts and storage paths only; this module never prints, never builds a URL
//   and holds no local file API: local reads go through readLocalFile, the real path through the
//   caller's `realPath` (cli.ts passes realpathSync.native).
// - Step 16 (migration-input/p1-step16-design.md §3.17, D16-17; S15B-R2-SEC-1, R2-FID-1): every
//   refusal below is `takedown-check-failed`. At plan, before the own-entry check and the hash
//   list: T1 an empty listing of the two folders, in every state; T1c, when the caller passes
//   `seen` (publish.ts's D15B-30 listing, the neither state only), a seen path the plan listing
//   lost. At commit: T3 an empty plan, before any read; T4 a fresh state without a production
//   pointer (a blind read: every takedown starts with one and no publisher path deletes it), before
//   step 2; T2 a planned path the fresh listing no longer shows, after the raced check and before
//   the hash list and any DELETE. An object hidden at plan and at commit alike is believed, and a
//   blind staging read lets step 2 check production only (design §9 L-T1).
import { join } from 'node:path'
import { MEDIA_MAX_BYTES, planMediaHeads } from '../../src/core/content/media'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { sha256Hex } from '../../src/core/hashing'
import { LOCALE_CODES } from '../../src/core/locales'
import { NodeId, StoryId } from '../../src/core/package/v1'
import { hasUnstorableSegment } from './args'
import { readCatalogueState } from './catalogue-state'
import { readLocalFile } from './local-files'
import type { ContentRemover, StorageReader, StoredObject } from './port'
import { readCheckedPackage } from './remote-checks'
import { isLocalRealPath } from './report'
import { failureCode } from './run-kit'
import { classOfPath } from './storage-layout'

/** The fixed segments of this PC's hash list under the storyboard folder (D15B-9). */
export const HASH_LIST_SEGMENTS: readonly string[] = Object.freeze([
  'migration-input',
  'audio',
  'SHA256SUMS.txt',
])
export const HASH_LIST_MAX_BYTES = 1_048_576
export const HASH_LIST_MAX_LINES = 10_000
/** The most paths one DELETE names (content-deleter.ts's MAX_REMOVE_PATHS). */
const CHUNK_PATHS = 100
const LINE =
  /^([0-9a-f]{64}) {2}([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z][a-z0-9_]{0,47})\.([a-z]{2})\.mp3$/

export interface HashListLine {
  readonly sha256: string
  readonly storyId: string
  /** `<nodeId>.<locale>.mp3`, the file name under migration-input/audio/<storyId>/. */
  readonly file: string
}

export type HashListResult =
  | { readonly ok: true; readonly lines: readonly HashListLine[] }
  | { readonly ok: false; readonly code: 'hash-list-invalid' }

const INVALID: HashListResult = Object.freeze({ ok: false, code: 'hash-list-invalid' })

/** The hash list's text rule (D15B-9 rules 1-7); the lines in list order, or the one refusal. */
export function parseHashList(bytes: Uint8Array): HashListResult {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return INVALID
  for (const byte of bytes) {
    if (byte !== 0x0a && (byte < 0x20 || byte > 0x7e)) return INVALID
  }
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) return INVALID
  const rows = new TextDecoder('utf-8', { fatal: true }).decode(bytes).slice(0, -1).split('\n')
  if (rows.length > HASH_LIST_MAX_LINES) return INVALID
  const lines: HashListLine[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const match = LINE.exec(row)
    if (match === null) return INVALID
    const [, sha256 = '', storyId = '', node = '', locale = ''] = match
    if (!StoryId.safeParse(storyId).success || !NodeId.safeParse(node).success) return INVALID
    if (!(LOCALE_CODES as readonly string[]).includes(locale)) return INVALID
    const file = `${node}.${locale}.mp3`
    const path = `${storyId}/${file}`
    if (hasUnstorableSegment(path) || seen.has(path)) return INVALID
    seen.add(path)
    lines.push({ sha256, storyId, file })
  }
  return { ok: true, lines }
}

export interface TakedownCounts {
  readonly packages: number
  /** mp3 + images. */
  readonly media: number
  readonly mp3: number
  readonly mp3Unproven: number
  readonly images: number
}

export interface TakedownPlan {
  readonly storyId: string
  /** Every listed path of the story's two folders, sorted by UTF-16 code units. */
  readonly paths: readonly string[]
  /** The MP3 paths this PC could not prove (kept, never deleted), sorted. */
  readonly kept: readonly string[]
  readonly counts: TakedownCounts
}

export type PlanResult =
  { readonly ok: true; readonly plan: TakedownPlan } | { readonly ok: false; readonly code: string }

export type CommitResult =
  | { readonly ok: true; readonly removed: number; readonly kept: readonly string[] }
  | { readonly ok: false; readonly code: string; readonly removed: number }

export interface CommitHooks {
  /** After each removed chunk: the running count and the total of the delete set. */
  readonly onChunk: (removed: number, total: number) => void
}

type Listing =
  | { readonly ok: true; readonly objects: ReadonlyMap<string, StoredObject> }
  | { readonly ok: false; readonly code: string }

/**
 * The story's two folders (D15B-10): every listed path must be the package or media class of the
 * story, listed once. A listing failure is its storage code; an unknown name `unknown`; a repeat
 * `repeated`.
 */
async function listStory(
  reader: StorageReader,
  storyId: string,
  codes: { readonly unknown: string; readonly repeated: string; readonly failed?: string },
): Promise<Listing> {
  const objects = new Map<string, StoredObject>()
  let unknown = false
  for (const folder of [`packages/${storyId}/`, `media/${storyId}/`]) {
    const listing = await reader.listContent(folder)
    if (listing.kind !== 'listed') {
      return { ok: false, code: codes.failed ?? failureCode(listing.kind) }
    }
    for (const object of listing.objects) {
      if (objects.has(object.path)) return { ok: false, code: codes.repeated }
      const found = classOfPath('content', object.path)
      if (
        found === null ||
        (found.kind !== 'package' && found.kind !== 'media') ||
        found.fields.storyId !== storyId
      ) {
        unknown = true
      }
      objects.set(object.path, object)
    }
  }
  if (unknown) return { ok: false, code: codes.unknown }
  return { ok: true, objects }
}

const isMp3 = (path: string): boolean => classOfPath('content', path)?.fields.mime === 'audio/mpeg'
const byCodeUnits = (paths: Iterable<string>): string[] => [...paths].sort()

/** The hash list read under `root` after the audio folder's locality (D15B-9). */
async function readHashList(
  root: string,
  realPath: (path: string) => string,
): Promise<
  | { readonly ok: true; readonly lines: readonly HashListLine[] }
  | { readonly ok: false; readonly code: string }
> {
  let real: string
  try {
    real = realPath(join(root, 'migration-input', 'audio'))
  } catch {
    return { ok: false, code: 'takedown-not-on-this-pc' }
  }
  if (!isLocalRealPath(real)) return { ok: false, code: 'takedown-not-on-this-pc' }
  const read = readLocalFile(root, HASH_LIST_SEGMENTS, HASH_LIST_MAX_BYTES)
  if (!read.ok) {
    return {
      ok: false,
      code: read.code === 'local-file-missing' ? 'hash-list-missing' : 'hash-list-invalid',
    }
  }
  const parsed = parseHashList(read.bytes)
  if (!parsed.ok) return parsed
  return { ok: true, lines: parsed.lines }
}

/**
 * One MP3 object proved (D15B-9, D15B-29): the lines of the same story with its sha256, in list
 * order; the first whose local file reads with that sha256 and the listed size proves it. A null
 * size proves nothing.
 */
async function proves(
  object: StoredObject,
  storyId: string,
  lines: readonly HashListLine[],
  root: string,
): Promise<boolean> {
  const sha256 = classOfPath('content', object.path)?.fields.sha256
  if (object.size === null || typeof sha256 !== 'string') return false
  for (const candidate of lines) {
    if (candidate.sha256 !== sha256 || candidate.storyId !== storyId) continue
    const read = readLocalFile(
      root,
      ['migration-input', 'audio', storyId, candidate.file],
      MEDIA_MAX_BYTES,
    )
    if (!read.ok || read.bytes.byteLength !== object.size) continue
    if ((await sha256Hex(read.bytes)) === sha256) return true
  }
  return false
}

/** Every MP3 among `objects` that the list does not prove, each tried on its own. */
async function unproven(
  objects: Iterable<StoredObject>,
  storyId: string,
  lines: readonly HashListLine[],
  root: string,
): Promise<string[]> {
  const kept: string[] = []
  for (const object of objects) {
    if (!isMp3(object.path)) continue
    if (!(await proves(object, storyId, lines, root))) kept.push(object.path)
  }
  return kept
}

/**
 * The takedown plan (§4.3): the listings and the class rule, T1 (the listing is not empty) and T1c
 * (every `seen` path is listed again, when given), the own-entry check when `entry` is given
 * (production's entry in the P state, else staging's in the S state), then the hash list and the
 * per-object MP3 proof. Reads only through `reader`; local reads only under `root`. An empty `seen`
 * checks nothing (T1 still refuses an empty listing).
 */
export async function planTakedown(
  reader: StorageReader,
  storyId: string,
  entry: SnapshotEntry | null,
  root: string,
  realPath: (path: string) => string,
  seen?: ReadonlySet<string>,
): Promise<PlanResult> {
  const listing = await listStory(reader, storyId, {
    unknown: 'takedown-unknown-object',
    repeated: 'takedown-unknown-object',
  })
  if (!listing.ok) return { ok: false, code: listing.code }
  const objects = listing.objects
  const checkFailed: PlanResult = { ok: false, code: 'takedown-check-failed' }
  // T1: a listing blind to every object never plans (S15B-R2-SEC-1).
  if (objects.size === 0) return checkFailed
  // T1c: the plan listing lost a path the caller's first listing showed.
  if (seen !== undefined && [...seen].some((path) => !objects.has(path))) return checkFailed
  if (entry !== null) {
    const checked = await readCheckedPackage(reader, entry)
    if (!checked.ok) return checkFailed
    const heads = planMediaHeads([{ pkg: checked.pkg }], '')
    if (!heads.ok) return checkFailed
    const named = [entry.packagePath, ...heads.value.heads.map((head) => head.path)]
    if (!named.every((path) => objects.has(path))) return checkFailed
  }
  const list = await readHashList(root, realPath)
  if (!list.ok) return { ok: false, code: list.code }
  const kept = await unproven(objects.values(), storyId, list.lines, root)
  const paths = byCodeUnits(objects.keys())
  const packages = paths.filter((path) => path.startsWith('packages/')).length
  const mp3 = paths.filter(isMp3).length
  const media = paths.length - packages
  return {
    ok: true,
    plan: {
      storyId,
      paths,
      kept: byCodeUnits(kept),
      counts: { packages, media, mp3, mp3Unproven: kept.length, images: media - mp3 },
    },
  }
}

/** True when a pointer read shows `expected`: its sha256, or not-found where it was absent. */
async function pointerShows(
  reader: StorageReader,
  mode: 'production' | 'staging',
  expected: string | null,
): Promise<'same' | 'moved' | 'failed'> {
  const read = await reader.readContent({ kind: 'pointer', mode })
  if (read.kind === 'not-found') return expected === null ? 'same' : 'moved'
  if (read.kind !== 'found') return 'failed'
  return read.sha256 === expected ? 'same' : 'moved'
}

/**
 * The takedown commit (§4.4, D15B-11 steps 1-8), run after verify confirmed the story gone.
 * `makeRemover` is called at most once, only when something is left to delete. An empty plan (T3),
 * a fresh state without a production pointer (T4) and a fresh listing that lost a planned path (T2)
 * are `takedown-check-failed` before any DELETE; so an empty delete set (every listed MP3 kept) is
 * `{ok: true, removed: 0}` with every planned path still listed (S15B-R1-SEC-1, Step 16).
 */
export async function commitTakedown(
  reader: StorageReader,
  makeRemover: () => ContentRemover,
  plan: TakedownPlan,
  root: string,
  hooks: CommitHooks,
  realPath: (path: string) => string,
): Promise<CommitResult> {
  const storyId = plan.storyId
  let removed = 0
  const stop = (code: string): CommitResult => ({ ok: false, code, removed })
  // T3: an empty plan (only a hand-built one reaches here after T1) is refused before any read.
  if (plan.paths.length === 0) return stop('takedown-check-failed')

  // 1-3: both current snapshots, the story in neither, every package they name read and planned.
  const state = await readCatalogueState(reader)
  if (!state.ok) return stop('takedown-check-failed')
  // T4: a fresh state without a production pointer is a blind read; step 2 would check a set that
  // can be empty.
  if (state.state.production === null) return stop('takedown-check-failed')
  const snapshots = [state.state.production, state.state.staging].flatMap((p) =>
    p === null ? [] : [p.snapshot],
  )
  if (snapshots.some((s) => s.stories.some((e) => e.storyId === storyId))) {
    return stop('takedown-still-named')
  }
  const read = new Set<string>()
  for (const entry of snapshots.flatMap((s) => s.stories)) {
    if (read.has(entry.packagePath)) continue
    read.add(entry.packagePath)
    const checked = await readCheckedPackage(reader, entry)
    if (!checked.ok) return stop('takedown-check-failed')
    if (!planMediaHeads([{ pkg: checked.pkg }], '').ok) return stop('takedown-check-failed')
  }

  // 4: a fresh listing that adds nothing to the plan (raced) and still shows every planned path
  // (T2: a short or blind listing never reaches a DELETE; R2-FID-1).
  const fresh = await listStory(reader, storyId, {
    unknown: 'takedown-unknown-object',
    repeated: 'takedown-check-failed',
    failed: 'takedown-check-failed',
  })
  if (!fresh.ok) return stop(fresh.code)
  const planned = new Set(plan.paths)
  if ([...fresh.objects.keys()].some((path) => !planned.has(path))) return stop('takedown-raced')
  if (plan.paths.some((path) => !fresh.objects.has(path))) return stop('takedown-check-failed')

  // 5: the MP3 proof again over what is still listed (never the plan's verdict reused).
  const list = await readHashList(root, realPath)
  if (!list.ok) return stop('takedown-not-on-this-pc')
  const planKept = new Set(plan.kept)
  const again = await unproven(
    [...fresh.objects.values()].filter((object) => !planKept.has(object.path)),
    storyId,
    list.lines,
    root,
  )
  const kept = byCodeUnits([...[...fresh.objects.keys()].filter((p) => planKept.has(p)), ...again])
  const keptSet = new Set(kept)
  const doomed = byCodeUnits([...fresh.objects.keys()].filter((path) => !keptSet.has(path)))
  // Nothing to delete (every listed MP3 kept): T2 already proved the fresh listing shows every
  // planned path, so no vanished path is believed here (S15B-R1-SEC-1).
  if (doomed.length === 0) return { ok: true, removed: 0, kept }

  // 6-7: the deleter, then per chunk both pointers re-read and one remove.
  const remover = makeRemover()
  const expected = {
    production: state.state.production?.sha256 ?? null,
    staging: state.state.staging?.sha256 ?? null,
  }
  const pointersUnmoved = async (): Promise<CommitResult | null> => {
    for (const mode of ['production', 'staging'] as const) {
      const shown = await pointerShows(reader, mode, expected[mode])
      if (shown === 'failed') return stop('takedown-check-failed')
      if (shown === 'moved') return stop('takedown-raced')
    }
    return null
  }
  /** The delete-set paths no longer listed, or null when the re-list failed. */
  const goneNow = async (): Promise<{ gone: number; left: string[] } | null> => {
    const relisted = await listStory(reader, storyId, {
      unknown: 'unknown',
      repeated: 'repeated',
    })
    if (!relisted.ok) return null
    const left = byCodeUnits(relisted.objects.keys())
    return { gone: doomed.filter((path) => !relisted.objects.has(path)).length, left }
  }
  for (let start = 0; start < doomed.length; start += CHUNK_PATHS) {
    const chunk = doomed.slice(start, start + CHUNK_PATHS)
    const moved = await pointersUnmoved()
    if (moved !== null) return moved
    const result = await remover.remove('content', chunk)
    if (result.kind !== 'removed') {
      const after = await goneNow()
      if (after !== null) removed = after.gone
      return stop('takedown-incomplete')
    }
    removed += chunk.length
    hooks.onChunk(removed, doomed.length)
  }

  // 8: the re-list equals the kept set; the pointers did not move during the last chunk.
  const after = await goneNow()
  if (after === null || after.left.join('\n') !== kept.join('\n')) {
    if (after !== null) removed = after.gone
    return stop('takedown-incomplete')
  }
  const moved = await pointersUnmoved()
  if (moved !== null) return moved
  return { ok: true, removed, kept }
}
