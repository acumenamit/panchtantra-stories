// The story id of the staging-only derived picture story (design p1-step10-design.md §2.5, §4.5,
// S4, F2; Step 10e). A leaf module: it imports nothing, so e2e/routes.ts, which every spec loads,
// can build the review-leg 404 path from it without loading the catalogue builders and the content
// loader into each worker. scripts/testing/staging-catalogue.ts derives the story under this id.
export const PICTURE_STORY_ID = 'river-stones-pictures'
