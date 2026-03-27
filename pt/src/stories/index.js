import juhaAndDonkey from './juhaAndDonkey';

// ─────────────────────────────────────────────────────────────
//  HIKAYAT — ARABIC FOLK TALES
//  ADD NEW STORIES HERE
//  1. Create a new file in this folder
//  2. Import it above
//  3. Add it to the STORIES array below
//  4. Update FEATURED_STORY_ID to feature it
//  5. Commit → Vercel auto-deploys in 30s ✅
// ─────────────────────────────────────────────────────────────

const STORIES = [
  juhaAndDonkey,
];

// ─────────────────────────────────────────────────────────────
//  FEATURED STORY
//  Set this to the id of the story you want on the hero card.
// ─────────────────────────────────────────────────────────────
export const FEATURED_STORY_ID = 'juha-and-donkey';

export default STORIES;
