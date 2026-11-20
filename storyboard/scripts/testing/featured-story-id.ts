// The story id of the staging-only derived featured story (design p1-step12-design.md §3.17 N18,
// A19, CRIT-4; Step 12). A leaf module: it imports nothing, so e2e/routes.ts, which every spec loads,
// can build the review-leg 404 path from it without loading the catalogue builders and the content
// loader into each worker. scripts/testing/staging-catalogue.ts derives the story under this id.
export const FEATURED_STORY_ID = 'river-stones-featured'
