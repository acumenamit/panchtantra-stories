// The story id of the staging-only derived narrated story (design p1-step11-design.md §2.2, §3.23
// N23, §8.1; P1-5a). A leaf module: it imports nothing, so e2e/routes.ts, which every spec loads,
// can build the review-leg 404 path from it without loading the catalogue builders and the content
// loader into each worker. scripts/testing/staging-catalogue.ts derives the story under this id.
export const NARRATION_STORY_ID = 'river-stones-narrated'
