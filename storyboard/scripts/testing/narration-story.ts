// The staging-only narrated story's clips (design p1-step11-design.md §2.2, §3.23 N23, §8.1, §8.2;
// P1-5a): the clip table, each clip's asset id and Storage path, and the bytes the stub serves for
// every clip. scripts/testing/staging-catalogue.ts derives the story from the river-stones fixture
// with these clips; e2e/narration-media.ts builds the clip URLs from the same functions, so the two
// never differ. It imports only node:crypto, ./silent-mp3 and the leaf id module and reads no
// import.meta, so a spec (compiled as CommonJS) may load it (narration-story.test.ts checks that).
// - 15 clips: every node of river-stones in en and hi, except big_rock in hi, which exercises a
//   part with no clip (N12: the player shows the unavailable message there and asks for nothing).
// - Asset id: the sha256 hex of `<story id>:<node id>:<locale>:audio`; path
//   media/<story id>/<asset id>-audio.mp3 (the media path rule, src/core/content/media.ts).
// - narratedTextSha256: the sha256 hex of `<story id>:<node id>:<locale>` (design §3.23).
// - Every clip is the same 42-frame silent MP3: 6,048 bytes, audio/mpeg, 1,008 ms.
import { createHash } from 'node:crypto'
import { NARRATION_STORY_ID } from './narration-story-id'
import { silentMp3 } from './silent-mp3'

/** The river-stones nodes, in package order (staging-catalogue.ts checks the fixture has them). */
export const NARRATION_NODES = [
  'start',
  'flat_stones',
  'big_rock',
  'far_bank',
  'round_stones',
  'ending_dry',
  'ending_wet',
  'ending_back',
] as const

export const NARRATION_LOCALES = ['en', 'hi'] as const

export type NarrationLocale = (typeof NARRATION_LOCALES)[number]

/** The one node and language with no clip (N12). */
export const NARRATION_GAP = { nodeId: 'big_rock', locale: 'hi' } as const

/** One clip of the story: a node in a language. */
export interface NarrationClip {
  readonly nodeId: string
  readonly locale: NarrationLocale
}

/** The 15 clips, in node order, then locale order. */
export const NARRATION_CLIPS: readonly NarrationClip[] = NARRATION_NODES.flatMap((nodeId) =>
  NARRATION_LOCALES.filter(
    (locale) => !(nodeId === NARRATION_GAP.nodeId && locale === NARRATION_GAP.locale),
  ).map((locale) => ({ nodeId, locale })),
)

/** Whether the story has a clip for `nodeId` in `locale`. */
export function hasNarrationClip(nodeId: string, locale: string): boolean {
  return NARRATION_CLIPS.some((clip) => clip.nodeId === nodeId && clip.locale === locale)
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** A clip's asset id: sha256 hex of `<story id>:<node id>:<locale>:audio`. */
export function narrationAssetId(nodeId: string, locale: string): string {
  return sha256(`${NARRATION_STORY_ID}:${nodeId}:${locale}:audio`)
}

/** A clip's Storage path, for any node and locale (a spec checks a missing clip is never asked). */
export function narrationClipPath(nodeId: string, locale: string): string {
  return `media/${NARRATION_STORY_ID}/${narrationAssetId(nodeId, locale)}-audio.mp3`
}

/** A clip's narratedTextSha256: sha256 hex of `<story id>:<node id>:<locale>` (design §3.23). */
export function narratedTextSha256Of(nodeId: string, locale: string): string {
  return sha256(`${NARRATION_STORY_ID}:${nodeId}:${locale}`)
}

/** The bytes every clip path serves: the 42-frame silent MP3 (6,048 bytes). */
export const NARRATION_CLIP: Uint8Array<ArrayBuffer> = silentMp3(42)

export const NARRATION_CLIP_TYPE = 'audio/mpeg' as const

/** The clip's length: 42 frames × 576 samples at 24 kHz. */
export const NARRATION_DURATION_MS = 1008
