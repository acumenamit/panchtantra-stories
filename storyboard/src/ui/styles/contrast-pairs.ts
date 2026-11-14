// Declared contrast pairs for tokens.css (spec §6.6 "CI checks token pairs", RC-7; P1-1b).
// tokens.test.ts computes the unrounded WCAG 2.2 ratio of every pair here, scene pairs included,
// and fails when a colour token is in no pair and not on the decorative list.
// Forbidden by design (never add these as pairs): light text on accent, accent-hover or brand;
// brand as text; a focus ring touching an amber fill without the canvas halo; UI-text tokens,
// scene accents or story colours as story text; line-subtle as a control boundary; progress told
// apart by colour alone (text-accent against line-strong is 2.51).

export const MIN_STORY_TEXT = 7
export const MIN_UI_TEXT = 4.5
export const MIN_NON_TEXT = 3

export type PairRole = 'story-text' | 'ui-text' | 'text-on-fill' | 'non-text'

export interface ContrastPair {
  readonly role: PairRole
  readonly foreground: string
  readonly backgrounds: readonly string[]
  readonly minimum: number
}

export const SURFACES = [
  '--color-canvas',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-hover',
  '--color-surface-selected',
  '--color-surface-story',
] as const

export const STORY_TEXT = [
  '--color-text',
  '--color-text-strong',
  '--color-text-ending',
  '--color-text-lesson',
] as const

export const UI_TEXT = [
  '--color-text-secondary',
  '--color-text-accent',
  '--color-text-success',
  '--color-text-danger',
] as const

export const NON_TEXT = [
  '--color-line-strong',
  '--color-focus',
  '--color-brand',
  '--color-accent',
] as const

/** Amber fills: only dark text goes on them. */
export const FILLS = ['--color-accent', '--color-accent-hover', '--color-brand'] as const

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...STORY_TEXT.map((foreground) => ({
    role: 'story-text' as const,
    foreground,
    backgrounds: SURFACES,
    minimum: MIN_STORY_TEXT,
  })),
  ...UI_TEXT.map((foreground) => ({
    role: 'ui-text' as const,
    foreground,
    backgrounds: SURFACES,
    minimum: MIN_UI_TEXT,
  })),
  {
    role: 'text-on-fill',
    foreground: '--color-text-on-accent',
    backgrounds: FILLS,
    minimum: MIN_UI_TEXT,
  },
  ...NON_TEXT.map((foreground) => ({
    role: 'non-text' as const,
    foreground,
    backgrounds: SURFACES,
    minimum: MIN_NON_TEXT,
  })),
  // The focus halo: the canvas-coloured box-shadow between the ring and an amber control fill.
  {
    role: 'non-text',
    foreground: '--color-canvas',
    backgrounds: ['--color-accent', '--color-accent-hover'],
    minimum: MIN_NON_TEXT,
  },
]

/** Scene ids in tokens.css (pt/src/scenes.js, in kebab-case). Each has -from, -to and -accent. */
export const SCENE_IDS = [
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

export type SceneId = (typeof SCENE_IDS)[number]

/** 'from', 'to' and 'accent' stand for the scene's own tokens; anything else is a token name. */
type SceneSlot = 'from' | 'to' | 'accent'

interface SceneRule {
  readonly role: PairRole
  readonly foregrounds: readonly (SceneSlot | string)[]
  readonly backgrounds: readonly (SceneSlot | string)[]
  readonly minimum: number
}

/**
 * Every text and non-text token on both ends of every scene, so Step 10 can place any of them over
 * a scene without a new pair. The ends bound the whole gradient: tokens.test.ts checks that each
 * scene falls or rises in every channel, and that every foreground here is lighter (or darker)
 * than both ends, so the smallest ratio over the gradient is at an end.
 */
export const SCENE_RULES: readonly SceneRule[] = [
  {
    role: 'ui-text',
    foregrounds: ['accent'],
    backgrounds: ['from', 'to', '--color-surface-story'],
    minimum: MIN_UI_TEXT,
  },
  {
    role: 'story-text',
    foregrounds: STORY_TEXT,
    backgrounds: ['from', 'to'],
    minimum: MIN_STORY_TEXT,
  },
  { role: 'ui-text', foregrounds: UI_TEXT, backgrounds: ['from', 'to'], minimum: MIN_UI_TEXT },
  {
    role: 'non-text',
    foregrounds: ['--color-brand', '--color-accent', '--color-line-strong', '--color-focus'],
    backgrounds: ['from', 'to'],
    minimum: MIN_NON_TEXT,
  },
  {
    role: 'text-on-fill',
    foregrounds: ['--color-text-on-accent'],
    backgrounds: ['accent'],
    minimum: MIN_UI_TEXT,
  },
]

export function sceneToken(scene: SceneId, slot: SceneSlot): string {
  return `--scene-${scene}-${slot}`
}

function resolveSlot(scene: SceneId, name: string): string {
  return name === 'from' || name === 'to' || name === 'accent' ? sceneToken(scene, name) : name
}

/** The scene rules as concrete pairs, one per scene, rule and foreground. */
export function scenePairs(scenes: readonly SceneId[] = SCENE_IDS): ContrastPair[] {
  return scenes.flatMap((scene) =>
    SCENE_RULES.flatMap((rule) =>
      rule.foregrounds.map((foreground) => ({
        role: rule.role,
        foreground: resolveSlot(scene, foreground),
        backgrounds: rule.backgrounds.map((background) => resolveSlot(scene, background)),
        minimum: rule.minimum,
      })),
    ),
  )
}

/** Every declared pair: the surface table and the scene rules. */
export function allContrastPairs(): ContrastPair[] {
  return [...CONTRAST_PAIRS, ...scenePairs()]
}

/** Colour tokens with no contrast duty, each with the reason. */
export const DECORATIVE_TOKENS: readonly { readonly token: string; readonly reason: string }[] = [
  {
    token: '--color-line-subtle',
    reason:
      'Decorative dividers only (1.07 to 1.35 on the surfaces); never the only boundary of a control.',
  },
]
