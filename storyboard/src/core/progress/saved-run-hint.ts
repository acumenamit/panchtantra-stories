// Saved-run hint at first paint (Step 10, D11-P5; spec §6.3 first paint; design §4.4). The player
// page renders this script inline in <body> before the player island. It sets data-saved-run on
// <html> when reader.v1.progress (schema 1) holds a non-null, non-array activeRun object for this
// story, so the player's CSS can hide the run area until the run controller's open() replaces the
// start node with the saved one. Pure: the script is only a string here.
// - It may over-report (that only hides the run area until open()); it never under-reports: wherever
//   readProgress gives this story a non-null activeRun, it sets the attribute (property test).
// - try/catch around every access; it never writes (spec §6.3).
// - ES5, under 1 KB, no "</script", "<!--" or backtick. The story id goes in as a JSON string and is
//   checked first with this module's own copy of StoryId's rule (package/v1.ts: 3 to 64 characters
//   of [a-z0-9] in hyphen-separated runs), so it can never break out of that string. This module
//   does not import package/v1.ts; a test proves the copy agrees with StoryId (design C2).
// - Not exported from ./index: the page imports this file directly, as the root layout imports
//   text-scale-boot.ts, and the island imports SAVED_RUN_ATTRIBUTE from here.
import { PROGRESS_KEY, RECORD_SCHEMA } from './records'

export const SAVED_RUN_ATTRIBUTE = 'data-saved-run'

// Own copy of StoryId (package/v1.ts): .min(3).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).
const STORY_ID_MIN = 3
const STORY_ID_MAX = 64
const STORY_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

function isStoryId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= STORY_ID_MIN &&
    value.length <= STORY_ID_MAX &&
    STORY_ID_PATTERN.test(value)
  )
}

/** The inline script for one story's player page. A value that is not a story id is a TypeError. */
export function savedRunHintScript(storyId: string): string {
  if (!isStoryId(storyId)) throw new TypeError('savedRunHintScript needs a valid story id')
  const id = JSON.stringify(storyId)
  return (
    '(function(){try{' +
    `var r=localStorage.getItem(${JSON.stringify(PROGRESS_KEY)});if(r===null)return;` +
    'var v=JSON.parse(r);' +
    `if(!v||typeof v!=="object"||Array.isArray(v)||v.schema!==${RECORD_SCHEMA})return;` +
    'var s=v.stories;' +
    `if(!s||typeof s!=="object"||!Object.prototype.hasOwnProperty.call(s,${id}))return;` +
    `var e=s[${id}];var a=e&&typeof e==="object"?e.activeRun:null;` +
    'if(a&&typeof a==="object"&&!Array.isArray(a))' +
    `document.documentElement.setAttribute(${JSON.stringify(SAVED_RUN_ATTRIBUTE)},"")` +
    '}catch(x){}})()'
  )
}
