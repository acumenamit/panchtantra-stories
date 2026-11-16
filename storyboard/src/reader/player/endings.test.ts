// The ending count (Step 10c; design p1-step10-design.md D11-P13, §9.2 10c row; spec §6.1 "Ending
// x of y found", §6.2). Current ids only: a stored id that is no longer an ending (the record keeps
// such ids) or any other id is never counted; the ending just found counts from the session alone,
// before the save lands; stored and session ids are one set. Every ending of the 3 fixtures.
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { ENABLED_LOCALE_CODES } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { endingCountOf } from './endings'
import { playerDataOf } from './player-data'

const stories = [twoPaths, riverStones, lanternWalk].map((raw) =>
  playerDataOf(StoryPackageV1.parse(raw), { locales: ENABLED_LOCALE_CODES }),
)

describe('endingCountOf', () => {
  it('covers the endings of the 3 fixtures (the scan is not empty)', () => {
    expect(stories.map((data) => [data.storyId, data.endingIds])).toEqual([
      ['two-paths', ['ending_wise', 'ending_quick']],
      ['river-stones', ['ending_dry', 'ending_wet', 'ending_back']],
      ['lantern-walk', ['ending_light', 'ending_shadow']],
    ])
  })

  it.each(stories.map((data) => [data.storyId, data] as const))(
    '%s: the session ending counts before anything is stored; stored and session are one set',
    (_, data) => {
      const { endingIds } = data
      expect(endingCountOf(endingIds, [], [])).toBe(0)
      for (const [index, ending] of endingIds.entries()) {
        // Found just now: nothing stored yet (the save lands in a microtask, or storage is blocked).
        expect(endingCountOf(endingIds, [], [ending]), ending).toBe(1)
        // The save landed: the same id in both counts once.
        expect(endingCountOf(endingIds, [ending], [ending]), ending).toBe(1)
        // Earlier endings stored, this one from the session: every one so far.
        const earlier = endingIds.slice(0, index)
        expect(endingCountOf(endingIds, earlier, [ending]), ending).toBe(index + 1)
      }
      expect(endingCountOf(endingIds, endingIds, [])).toBe(endingIds.length)
      expect(endingCountOf(endingIds, [], endingIds)).toBe(endingIds.length)
    },
  )

  it('ignores stale and other ids: only the current ending ids count (SPEC:469)', () => {
    const lantern = stories[2]
    expect(lantern?.storyId).toBe('lantern-walk')
    const endingIds = lantern?.endingIds ?? []
    // An id that was an ending in an older version, a non-ending node, an id of another story.
    const stale = ['ending_old', 'start', 'crossroads', 'ending_wise']
    expect(endingCountOf(endingIds, stale, [])).toBe(0)
    expect(endingCountOf(endingIds, [...stale, 'ending_light'], [])).toBe(1)
    expect(endingCountOf(endingIds, [...stale, 'ending_light'], ['ending_shadow'])).toBe(2)
    expect(endingCountOf(endingIds, ['ending_shadow', ...stale], ['ending_old'])).toBe(1)
    // Never more than the story has, whatever is stored.
    expect(endingCountOf(endingIds, [...stale, ...endingIds], [...stale, ...endingIds])).toBe(2)
  })
})
