// build-info.json (spec §3.2): what one build loaded and how it fetched it. scripts/load-content.ts
// writes it to .content/ (read by pages) and public/ (read by the publisher's verify step).
import { z } from 'zod'
import { Sha256, StoryId } from '../package/v1'
import { GATE_MODES } from './gates'

const HeaderValue = z.string().min(1).max(64)
// Vercel system values; null outside Vercel. Free text with a ceiling, so an unusual value never fails a build.
const VercelValue = z.string().min(1).max(256).nullable()

/** One GET, including each retry attempt. */
export const ContentFetch = z.strictObject({
  path: z.string().min(1), // Storage object path; the query (cacheNonce) is never recorded
  status: z.number().int().min(100).max(599).nullable(), // null: network error or timeout
  cfCacheStatus: HeaderValue.nullable(),
  age: z.number().int().nonnegative().nullable(),
  pop: HeaderValue.nullable(), // CDN location from cf-ray ("<id>-BOM" gives "BOM")
  sha256: z
    .string()
    .regex(/^[a-f0-9]{12}$/)
    .nullable(), // first 12 hex digits of sha256(body); null when no body was read
  ms: z.number().int().nonnegative(),
})

export const BuildInfoStory = z.strictObject({
  storyId: StoryId,
  version: z.number().int(),
  packageSha256: Sha256,
})

export const BuildInfoExcluded = z.strictObject({
  storyId: StoryId,
  version: z.number().int(),
  reason: z.enum(['approval-missing']),
})

export const BuildInfo = z
  .strictObject({
    schemaVersion: z.literal('1.0'),
    mode: z.enum(GATE_MODES),
    seq: z.number().int().min(1),
    pointerPath: z.string().min(1), // fixtures mode: relative to storyboard/fixtures/
    snapshotPath: z.string().min(1),
    snapshotSha256: Sha256,
    featuredStoryId: StoryId.nullable(),
    stories: z.array(BuildInfoStory),
    excluded: z.array(BuildInfoExcluded),
    appVersion: VercelValue, // VERCEL_GIT_COMMIT_SHA
    deploymentId: VercelValue, // VERCEL_DEPLOYMENT_ID
    deploymentUrl: VercelValue, // VERCEL_URL: host only, no scheme
    builtAt: z.iso.datetime(),
    fetches: z.array(ContentFetch),
  })
  .superRefine((info, ctx) => {
    // A Storage build always GETs at least the pointer. Only fixtures mode reads local files and
    // makes no request, so only there may the list be empty.
    if (info.mode !== 'fixtures' && info.fetches.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['fetches'],
        message: 'fetches may be empty only in fixtures mode',
      })
    }
  })

export type ContentFetch = z.infer<typeof ContentFetch>
export type BuildInfoStory = z.infer<typeof BuildInfoStory>
export type BuildInfoExcluded = z.infer<typeof BuildInfoExcluded>
export type BuildInfo = z.infer<typeof BuildInfo>
