// Scenes (Step 10e; design p1-step10-design.md D11-P23, §4.1, §4.6; spec §6.5 SPEC:489). Pure and
// framework-free. A package node names its scene as stored: the 10 legacy scenes in snake_case
// (pt/src/scenes.js; the 11 converted phase-1 packages use only these) or anything else (5 of the
// 6 fixture names). sceneIdOf maps a legacy name to its kebab-case scene id, the one the run area
// carries as data-scene and player.module.css paints from the --scene-<id>-from/-to tokens; any
// other name is forest-day, the legacy default (pt/src/pages/StoryEngine.js:50), so every node has
// a gradient and a failed picture always shows one.
// SCENES is this module's own copy of SCENE_IDS (src/ui/styles/contrast-pairs.ts), so reader code
// does not import the contrast table into the client bundle; scene.test.ts proves the two agree,
// in order. Names are looked up in a Map, so an Object.prototype name ('constructor') is unknown.
// Imports are relative (C15): none needed.

/** The scene ids, as SCENE_IDS in contrast-pairs.ts (tokens.css --scene-<id>-from/-to/-accent). */
export const SCENES = [
  'forest-day',
  'forest-evening',
  'forest-dark',
  'forest-path',
  'lions-den',
  'well',
  'forest-dawn',
  'river-bank',
  'village',
  'palace',
] as const

export type SceneName = (typeof SCENES)[number]

/** The scene of any name that is not a legacy scene (the legacy default). */
export const DEFAULT_SCENE: SceneName = 'forest-day'

/** Legacy snake_case name → scene id. */
const BY_LEGACY_NAME: ReadonlyMap<string, SceneName> = new Map(
  SCENES.map((id) => [id.replaceAll('-', '_'), id] as const),
)

/** The scene id of a node's stored scene name; any name that is not a legacy scene is forest-day. */
export function sceneIdOf(scene: string): SceneName {
  return BY_LEGACY_NAME.get(scene) ?? DEFAULT_SCENE
}
