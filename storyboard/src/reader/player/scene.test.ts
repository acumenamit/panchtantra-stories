// Scenes (Step 10e; design p1-step10-design.md D11-P23, §9.2 10e rows): the 10 legacy names map
// to their kebab-case scene ids, any other name is forest-day, and the module's own scene list is
// SCENE_IDS (contrast-pairs.ts), in order. The 11 converted phase-1 packages (0 unknown names) are
// checked in tools/migrate/scenes.test.ts: the reader import fence (eslint.config.mjs, READER_FENCE)
// bans tools/ imports in src/reader, tests included.
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { SCENE_IDS } from '../../ui/styles/contrast-pairs'
import { DEFAULT_SCENE, SCENES, sceneIdOf } from './scene'

/** The legacy scene names (pt/src/scenes.js) and the scene id each one maps to. */
const LEGACY = {
  forest_day: 'forest-day',
  forest_evening: 'forest-evening',
  forest_dark: 'forest-dark',
  forest_path: 'forest-path',
  lions_den: 'lions-den',
  well: 'well',
  forest_dawn: 'forest-dawn',
  river_bank: 'river-bank',
  village: 'village',
  palace: 'palace',
} as const

describe('sceneIdOf (D11-P23)', () => {
  it('maps 10 of 10 legacy names to their scene ids', () => {
    expect(Object.keys(LEGACY)).toHaveLength(10)
    for (const [name, id] of Object.entries(LEGACY)) expect(sceneIdOf(name), name).toBe(id)
    expect(new Set(Object.values(LEGACY))).toEqual(new Set(SCENES))
  })

  it('gives forest-day, the legacy default, for every other name', () => {
    expect(DEFAULT_SCENE).toBe('forest-day')
    for (const name of [
      '',
      'stream',
      'meadow',
      'river',
      'village_dusk',
      'village_well',
      'forest-day',
      'river-bank',
      'Forest_Day',
      'VILLAGE',
      ' village',
      'village ',
      'lions__den',
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ]) {
      expect(sceneIdOf(name), JSON.stringify(name)).toBe('forest-day')
    }
  })

  it('every fixture node gets a scene id; 5 of the 6 fixture names are unknown (RC scan)', () => {
    const names = new Set(
      [twoPaths, riverStones, lanternWalk].flatMap((pkg) => pkg.nodes.map((node) => node.scene)),
    )
    expect([...names].sort()).toEqual([
      'forest_day',
      'meadow',
      'river',
      'stream',
      'village_dusk',
      'village_well',
    ])
    const known = [...names].filter((name) => Object.hasOwn(LEGACY, name))
    expect(known).toEqual(['forest_day'])
    for (const name of names) expect(SCENES).toContain(sceneIdOf(name))
  })

  it("the module's own scene list is SCENE_IDS, in order (the tokens and the contrast pairs)", () => {
    expect(SCENES).toEqual(SCENE_IDS)
  })
})
