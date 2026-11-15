// The featured rule (spec §3.2 "Featured rule", REQ:67, spec:571 `--feature`; design
// p1-step8-design.md §7, §3.4 row 16, §9 item 28; P1-2b). Pure, every mode, never fails the build:
// the snapshot's featuredStoryId is kept only for a story built in this build (in production, an
// approved one) whose media is complete under `--feature` severities, waivers never counting.
import type { CatalogueSnapshot } from '../package/catalogue'
import type { StoryPackageV1 } from '../package/v1'
import type { PublicRuleSet } from '../rules/types'
import { validatePackage } from '../validator/validate'

type SnapshotEntry = CatalogueSnapshot['stories'][number]

/** The media checks a featured story must pass, in the order the reason line counts them. */
export const FEATURE_MEDIA_CHECKS = ['A001', 'A005', 'A006'] as const

export interface FeaturedVerdict {
  /** The id to write to build-info, or null. */
  readonly featuredStoryId: string | null
  /** The one `content: featured …` line the loader logs. */
  readonly line: string
}

/**
 * Decides build-info's featuredStoryId (design §7):
 * - none named: null, `content: featured none`;
 * - not among the snapshot's entries: reason `not-in-snapshot`;
 * - excluded (production, no approvalSha256): reason `approval-missing`;
 * - built, but `validatePackage(pkg, {ruleSet, mode: 'publish', forFeature: true})` has any A001,
 *   A005 or A006 error (a fresh report, so a waiver never counts): reason
 *   `media-incomplete A001=<n> A005=<n> A006=<n>`;
 * - otherwise the id, `content: featured story=<id>`.
 * A listed, unexcluded story that is not among `built` cannot occur in the loader (every included
 * package is built or the build fails); it is dropped too, with reason `not-built`.
 * No fallback to another story.
 */
export function featuredVerdict(
  featuredStoryId: string | null,
  stories: readonly SnapshotEntry[],
  excluded: readonly SnapshotEntry[],
  built: readonly { readonly pkg: StoryPackageV1 }[],
  ruleSet: PublicRuleSet,
): FeaturedVerdict {
  if (featuredStoryId === null) return { featuredStoryId: null, line: 'content: featured none' }
  const dropped = (reason: string): FeaturedVerdict => ({
    featuredStoryId: null,
    line: `content: featured story=${featuredStoryId} dropped (reason=${reason}); featuredStoryId=null`,
  })
  if (!stories.some((s) => s.storyId === featuredStoryId)) return dropped('not-in-snapshot')
  if (excluded.some((s) => s.storyId === featuredStoryId)) return dropped('approval-missing')
  const story = built.find((b) => b.pkg.storyId === featuredStoryId)
  if (!story) return dropped('not-built')
  const report = validatePackage(story.pkg, { ruleSet, mode: 'publish', forFeature: true })
  const counts = FEATURE_MEDIA_CHECKS.map((checkId) => ({
    checkId,
    n: report.findings.filter((f) => f.checkId === checkId && f.severity === 'error').length,
  }))
  if (counts.some(({ n }) => n > 0)) {
    return dropped(
      `media-incomplete ${counts.map(({ checkId, n }) => `${checkId}=${n}`).join(' ')}`,
    )
  }
  return { featuredStoryId, line: `content: featured story=${featuredStoryId}` }
}
