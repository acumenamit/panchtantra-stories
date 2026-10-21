// Catalogue snapshot and pointer (spec §4.4). Snapshots are immutable; pointers move.
import { z } from 'zod'
import { Sha256, StoryId } from './v1'

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
