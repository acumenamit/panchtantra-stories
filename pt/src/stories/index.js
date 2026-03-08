import lionAndHare from './lionAndHare';
import monkeyAndCrocodile from './monkeyAndCrocodile';
import crowAndSerpent from './crowAndSerpent';
import brahminAndCobra from './brahminAndCobra';
import fourFriendsAndHunter from './fourFriendsAndHunter';
import brahminsGoat from './brahminsGoat';
import blueJackal from './blueJackal';
import jackalAndWarDrum from './jackalAndWarDrum';

// ─────────────────────────────────────────────────────────────
//  ADD NEW STORIES HERE
//  1. Create a new file in this folder  (copy lionAndHare.js)
//  2. Import it above
//  3. Add it to the STORIES array below
//  4. Update FEATURED_STORY_ID to feature it
//  5. Commit the file in GitHub → Vercel auto-deploys in 30s ✅
// ─────────────────────────────────────────────────────────────

const STORIES = [
  lionAndHare,
  monkeyAndCrocodile,
  crowAndSerpent,
  brahminAndCobra,
  fourFriendsAndHunter,
  brahminsGoat,
  blueJackal,
  jackalAndWarDrum,
];

// ─────────────────────────────────────────────────────────────
//  FEATURED STORY
//  Set this to the id of the story you want on the hero card.
//  If the id doesn't match any story, falls back to newest.
// ─────────────────────────────────────────────────────────────
export const FEATURED_STORY_ID = 'blue-jackal';

export default STORIES;