// The legacy image map's rules (design migration-input/p1-step17-design.md D17-4, D17-5, D17-28,
// §3.4, §3.5, §3.5.1, A9, A10, A36, A40, A41; P1-9a, Step 17). The binder and the CI test derive
// the rows with the same function.
// - deriveLegacyImageRows (§3.4 rules 1-7): a node maps to a file only through its legacy module's
//   `image` path, which must start `/images/`; the file is read once by the injected reader with
//   the segments `path.slice(1).split('/')` and the 20 MiB master cap (readLocalFile: segment rule,
//   exact-case listing, no link or junction, regular file). `local-file-missing` is missing-step22;
//   every other refusal, and a path outside `/images/`, is the stop `master-read`. The bytes decide
//   the action, never the name: the 8-byte PNG signature and a whole png-facts walk is keep, FF D8
//   FF is recreate-step22 (read for its sha256 and magic only; never bound), anything else is the
//   stop `legacy-format-unknown`; a node with no field is new-step22. Nothing is rotated or parsed
//   beyond the PNG chunk walk. Keep files' bytes are held by their sha256 for the binder, so each
//   file is read once.
// - checkImageMap (§3.5): the approved map's rows against the RAW derivation (before any
//   override): the same node set, each once, never empty (`map-rows`); every key field equal, the
//   size on keep rows only (`map-row-stale`). The map's own counts are never read.
// - parseImageMapOverrides and applyImageMapOverrides (rule 8, D17-28): the owner's demotions,
//   strict, applied after the map check to a new array; the raw rows are never changed.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { DATE, isCalendarDate } from '../../src/core/package/approval'
import { NodeId, Sha256, StoryId, hasOwnProtoKey } from '../../src/core/package/v1'
import type { LocalRead } from '../publisher/local-files'
import { MASTER_IMAGE_MAX_BYTES } from '../publisher/storage-layout'
import type { LegacyNode } from './load-legacy'
import { hasChunk, hasPngSignature, readPngFacts } from './png-facts'

export type LegacyImageAction = 'keep' | 'recreate-step22' | 'missing-step22' | 'new-step22'

/** One node's row: the map's key fields, plus the master facts on keep rows. */
export interface LegacyImageRow {
  readonly storyId: string
  readonly nodeId: string
  readonly action: LegacyImageAction
  /** The legacy module's `image` path; null when the node has no field. */
  readonly legacyPath: string | null
  readonly fileSha256: string | null
  readonly realFormat: 'PNG' | 'JPEG' | null
  /** `<width>x<height>` from IHDR, keep rows only. */
  readonly size: string | null
  /** The file's length. */
  readonly bytes: number | null
  /** The master facts, keep rows only. */
  readonly width: number | null
  readonly height: number | null
  readonly caBX: boolean | null
}

export type LegacyImageProblemCode = 'master-read' | 'legacy-format-unknown'

export interface LegacyImageProblem {
  readonly code: LegacyImageProblemCode
  readonly storyId: string
  readonly nodeId: string
}

/** The rows of every node, or every problem found (in story and node order). */
export type LegacyDerivation =
  | {
      readonly ok: true
      readonly rows: readonly LegacyImageRow[]
      /** Each keep file's bytes by its sha256. */
      readonly masters: ReadonlyMap<string, Uint8Array>
    }
  | { readonly ok: false; readonly problems: readonly LegacyImageProblem[] }

/** Reads `<pt/public>/<segments...>` (the binder and the CI test pass readLocalFile). */
export type LegacyImageReader = (segments: readonly string[], cap: number) => LocalRead

/** What the derivation reads from a legacy story (a LegacyStory fits). */
export interface LegacyImageStory {
  readonly id: string
  readonly nodes: Readonly<Record<string, Pick<LegacyNode, 'image'>>>
}

const IMAGES_PREFIX = /^\/images\//
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const isJpegMagic = (bytes: Uint8Array): boolean => JPEG_MAGIC.every((b, i) => bytes[i] === b)

const row = (
  storyId: string,
  nodeId: string,
  action: LegacyImageAction,
  legacyPath: string | null,
  facts: Partial<Omit<LegacyImageRow, 'storyId' | 'nodeId' | 'action' | 'legacyPath'>> = {},
): LegacyImageRow => ({
  storyId,
  nodeId,
  action,
  legacyPath,
  fileSha256: null,
  realFormat: null,
  size: null,
  bytes: null,
  width: null,
  height: null,
  caBX: null,
  ...facts,
})

/** The raw rows of every node of the given stories, in story and node order (§3.4 rules 1-7). */
export function deriveLegacyImageRows(
  stories: readonly LegacyImageStory[],
  read: LegacyImageReader,
): LegacyDerivation {
  const rows: LegacyImageRow[] = []
  const problems: LegacyImageProblem[] = []
  const masters = new Map<string, Uint8Array>()
  for (const story of stories) {
    for (const [nodeId, node] of Object.entries(story.nodes)) {
      const problem = (code: LegacyImageProblemCode) =>
        problems.push({ code, storyId: story.id, nodeId })
      const path: unknown = node.image
      if (path === undefined) {
        rows.push(row(story.id, nodeId, 'new-step22', null))
        continue
      }
      if (typeof path !== 'string' || !IMAGES_PREFIX.test(path)) {
        problem('master-read')
        continue
      }
      const file = read(path.slice(1).split('/'), MASTER_IMAGE_MAX_BYTES)
      if (!file.ok) {
        if (file.code === 'local-file-missing') {
          rows.push(row(story.id, nodeId, 'missing-step22', path))
        } else problem('master-read')
        continue
      }
      const bytes = file.bytes
      const fileSha256 = sha256Hex(bytes)
      if (hasPngSignature(bytes)) {
        const png = readPngFacts(bytes)
        if (!png.ok) {
          problem('legacy-format-unknown')
          continue
        }
        const { width, height } = png.facts
        masters.set(fileSha256, bytes)
        rows.push(
          row(story.id, nodeId, 'keep', path, {
            fileSha256,
            realFormat: 'PNG',
            size: `${width}x${height}`,
            bytes: bytes.length,
            width,
            height,
            caBX: hasChunk(bytes, 'caBX'),
          }),
        )
      } else if (isJpegMagic(bytes)) {
        rows.push(
          row(story.id, nodeId, 'recreate-step22', path, {
            fileSha256,
            realFormat: 'JPEG',
            bytes: bytes.length,
          }),
        )
      } else problem('legacy-format-unknown')
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, rows, masters }
}

export interface ImageRowCounts {
  readonly rows: number
  readonly keep: number
  readonly recreate: number
  readonly missing: number
  readonly new: number
}

/** The rows by action (the binder's map line prints the counts of the bound rows). */
export function countImageRows(rows: readonly LegacyImageRow[]): ImageRowCounts {
  const count = (action: LegacyImageAction) => rows.filter((r) => r.action === action).length
  return {
    rows: rows.length,
    keep: count('keep'),
    recreate: count('recreate-step22'),
    missing: count('missing-step22'),
    new: count('new-step22'),
  }
}

// ---- the approved map (§3.5) ----

/** One row's key fields; the map's other keys (master, plannedVariants, excerptEn, notes) are ignored. */
const ImageMapRow = z.object({
  storyId: StoryId,
  nodeId: NodeId,
  action: z.enum(['keep', 'recreate-step22', 'missing-step22', 'new-step22']),
  legacyPath: z.string().nullable(),
  fileSha256: Sha256.nullable(),
  realFormat: z.enum(['PNG', 'JPEG']).nullable(),
  size: z.string().nullable(),
  bytes: z.number().int().min(0).nullable(),
})

/** The approved map file's key fields (zod `object`: totals, perStory and the rest are ignored). */
export const ImageMapFile = z.object({ rows: z.array(ImageMapRow) })
export type ImageMapFile = z.infer<typeof ImageMapFile>

export type ImageMapProblem =
  | { readonly code: 'map-rows' }
  | { readonly code: 'map-row-stale'; readonly storyId: string; readonly nodeId: string }

export type ImageMapCheck =
  | { readonly ok: true; readonly counts: ImageRowCounts }
  | { readonly ok: false; readonly problems: readonly ImageMapProblem[] }

const keyOf = (r: { readonly storyId: string; readonly nodeId: string }): string =>
  `${r.storyId}/${r.nodeId}`

/**
 * The map against the raw derivation: `map-rows` when its row set is not the derived node set
 * (each once; an empty map is refused even when nothing was derived), else one `map-row-stale` per
 * row whose action, legacyPath (exact), fileSha256, realFormat or bytes differ, or whose size
 * differs on a keep row. On success the counts are the derived ones.
 */
export function checkImageMap(map: ImageMapFile, raw: readonly LegacyImageRow[]): ImageMapCheck {
  const refuseRows: ImageMapCheck = { ok: false, problems: [{ code: 'map-rows' }] }
  if (map.rows.length === 0) return refuseRows
  const derived = new Map(raw.map((r) => [keyOf(r), r]))
  const seen = new Set<string>()
  for (const mapRow of map.rows) {
    const key = keyOf(mapRow)
    if (!derived.has(key) || seen.has(key)) return refuseRows
    seen.add(key)
  }
  if (seen.size !== derived.size) return refuseRows
  const problems: ImageMapProblem[] = []
  for (const mapRow of map.rows) {
    const r = derived.get(keyOf(mapRow))!
    const stale =
      mapRow.action !== r.action ||
      mapRow.legacyPath !== r.legacyPath ||
      mapRow.fileSha256 !== r.fileSha256 ||
      mapRow.realFormat !== r.realFormat ||
      mapRow.bytes !== r.bytes ||
      (r.action === 'keep' && mapRow.size !== r.size)
    if (stale) problems.push({ code: 'map-row-stale', storyId: r.storyId, nodeId: r.nodeId })
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, counts: countImageRows(raw) }
}

// ---- the owner's demotions (§3.4 rule 8, §3.5.1) ----

const OVERRIDES_MAX_BYTES = 65_536
const OVERRIDES_MAX_RECORDS = 54

/** A real calendar date in the DATE form (CRIT-9: isCalendarDate alone trims and splits). */
const ApprovedOn = z.string().refine((value) => DATE.test(value) && isCalendarDate(value))

/** One demotion: a derived keep row becomes recreate-step22. */
export const ImageMapOverride = z.strictObject({
  storyId: StoryId,
  nodeId: NodeId,
  action: z.literal('recreate-step22'),
  approvedOn: ApprovedOn,
  approvedBy: z.literal('owner'),
})
export type ImageMapOverride = z.infer<typeof ImageMapOverride>

const ImageMapOverridesFile = z.strictObject({
  overrides: z.array(ImageMapOverride).max(OVERRIDES_MAX_RECORDS),
})

export type ImageMapOverridesResult =
  | { readonly ok: true; readonly records: readonly ImageMapOverride[] }
  | { readonly ok: false; readonly code: 'image-map-overrides-invalid' }

export type ImageMapOverridesApplied =
  | { readonly ok: true; readonly rows: readonly LegacyImageRow[] }
  | { readonly ok: false; readonly code: 'image-map-overrides-invalid' }

const INVALID = { ok: false, code: 'image-map-overrides-invalid' } as const

/**
 * The overrides file's bytes to its records: at most 65,536 bytes, no BOM, fatal UTF-8, JSON with
 * no own `__proto__` key, the strict schema (at most 54 records). Any break is
 * `image-map-overrides-invalid`, with no detail.
 */
export function parseImageMapOverrides(bytes: Uint8Array): ImageMapOverridesResult {
  if (bytes.length > OVERRIDES_MAX_BYTES) return INVALID
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return INVALID
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    return INVALID
  }
  if (hasOwnProtoKey(value)) return INVALID
  const parsed = ImageMapOverridesFile.safeParse(value)
  return parsed.success ? { ok: true, records: parsed.data.overrides } : INVALID
}

/**
 * The bound rows: a new array in which each record's row is recreate-step22 (its facts kept, so it
 * binds nothing); the raw rows are never changed. Each record must name a raw keep row, and no node
 * twice; `[]` gives the raw rows' copy.
 */
export function applyImageMapOverrides(
  raw: readonly LegacyImageRow[],
  records: readonly ImageMapOverride[],
): ImageMapOverridesApplied {
  const byKey = new Map(raw.map((r) => [keyOf(r), r]))
  const demoted = new Set<string>()
  for (const record of records) {
    const key = keyOf(record)
    if (demoted.has(key)) return INVALID
    if (byKey.get(key)?.action !== 'keep') return INVALID
    demoted.add(key)
  }
  return {
    ok: true,
    rows: raw.map((r) => (demoted.has(keyOf(r)) ? { ...r, action: 'recreate-step22' } : r)),
  }
}
