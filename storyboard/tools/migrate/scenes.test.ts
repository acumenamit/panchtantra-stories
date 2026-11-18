// The player's scene map over the 11 converted phase-1 packages (Step 10e; design
// p1-step10-design.md D11-P23, §9.2 C17 row): loadLegacyStories plus convertLegacyStory, as
// migrate.test.ts loads them, and every node's scene name is one of the 10 legacy scenes, so
// sceneIdOf maps none of the 95 scene fields to the forest-day fallback by mistake (0 unknown
// names). It lives here, not in src/reader/player/scene.test.ts, because the reader import fence
// (eslint.config.mjs, READER_FENCE) bans tools/ imports in src/reader, tests included.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sceneIdOf } from '../../src/reader/player/scene'
import { convertLegacyStory } from './convert'
import { loadLegacyStories } from './load-legacy'

const here = dirname(fileURLToPath(import.meta.url))
const storiesDir = join(resolve(here, '../../..'), 'pt/src/stories')
const converted = loadLegacyStories(storiesDir).map((l) => convertLegacyStory(l.story))

describe('sceneIdOf over the 11 converted phase-1 packages (C17)', () => {
  it('maps every scene field to its own scene: 95 fields, 0 unknown names', () => {
    expect(converted).toHaveLength(11)
    const fields = converted.flatMap((pkg) => pkg.nodes.map((node) => node.scene))
    expect(fields).toHaveLength(95)
    // A known name maps to its own kebab-case id; an unknown one would map to forest-day.
    const unknown = fields.filter((name) => sceneIdOf(name) !== name.replaceAll('_', '-'))
    expect(unknown).toEqual([])
    // All 10 legacy scenes occur (pt/src/stories/*.js).
    expect(new Set(fields.map(sceneIdOf)).size).toBe(10)
  })
})
