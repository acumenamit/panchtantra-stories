// Catalogue snapshot and pointer (spec §4.4). Snapshots are immutable; pointers move.
// P1-2b (design p1-step8-design.md §3.1 D9, §5.2): a migration entry may carry the public match
// keys of its waivers, so the build can apply them without the private waiver file.
import '../zod-jitless'
import { z } from 'zod'
import { Locale, NodeId, Sha256, StoryId } from './v1'

/** One waiver's public match key: only fields that are already public or recomputable (D9). */
export const WaiverKey = z.strictObject({
  checkId: z.string().regex(/^[A-Z]\d{3}$/),
  nodeId: NodeId.nullable(),
  locale: Locale.nullable(),
  nodeTextSha256: Sha256,
})
export type WaiverKey = z.infer<typeof WaiverKey>

/** At most this many keys per snapshot entry (design §5.2). */
export const WAIVER_KEYS_MAX = 256

/**
 * The key order (design §5.2): by checkId, then nodeId (null as ''), then locale (null as ''),
 * then nodeTextSha256, each compared by UTF-16 code units. 0 means the same key.
 */
export function compareWaiverKeys(a: WaiverKey, b: WaiverKey): number {
  const left = [a.checkId, a.nodeId ?? '', a.locale ?? '', a.nodeTextSha256]
  const right = [b.checkId, b.nodeId ?? '', b.locale ?? '', b.nodeTextSha256]
  for (let i = 0; i < left.length; i++) {
    const x = left[i] ?? ''
    const y = right[i] ?? ''
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * A snapshot entry's waiver block: the rule set the waivers were recorded for, the sha256 of the
 * private waiver file (its masters object name) and the keys, sorted and unique. Never basis,
 * notes, ruleId, measured, limit, measuredOnPackageSha256, recordedOn or recordedBy.
 */
export const WaiverKeys = z
  .strictObject({
    ruleSetRef: z.string().regex(/^[a-z0-9-]{1,32}@\d{1,4}\.\d{1,4}\.\d{1,4}$/),
    waiverFileSha256: Sha256,
    keys: z.array(WaiverKey).max(WAIVER_KEYS_MAX),
  })
  .superRefine((block, ctx) => {
    for (let i = 1; i < block.keys.length; i++) {
      const previous = block.keys[i - 1]
      const current = block.keys[i]
      if (previous && current && compareWaiverKeys(previous, current) >= 0) {
        ctx.addIssue({ code: 'custom', path: ['keys'], message: 'keys must be sorted and unique' })
        return
      }
    }
  })
export type WaiverKeys = z.infer<typeof WaiverKeys>

export const CatalogueSnapshot = z.strictObject({
  schemaVersion: z.literal('1.0'),
  seq: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  note: z.string(),
  featuredStoryId: StoryId.nullable(), // one at a time; owner picks it (REQ:67)
  stories: z.array(
    z.strictObject({
      storyId: StoryId,
      collectionId: z.string(),
      version: z.number().int(),
      packagePath: z.string(),
      packageSha256: Sha256,
      approvalSha256: Sha256.optional(), // required in production mode (OD-12), enforced by the build gate
      waivers: WaiverKeys.optional(), // origin "migration" only: public derived match keys (P1 D9)
    }),
  ),
})

export const CataloguePointer = z.strictObject({
  schemaVersion: z.literal('1.0'),
  seq: z.number().int(),
  snapshotPath: z.string(),
  snapshotSha256: Sha256,
  updatedAt: z.iso.datetime(),
})

export type CatalogueSnapshot = z.infer<typeof CatalogueSnapshot>
export type CataloguePointer = z.infer<typeof CataloguePointer>
