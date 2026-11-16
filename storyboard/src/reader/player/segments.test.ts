// Progress segments (Step 10b; design p1-step10-design.md D11-P12, §9.2 10b row; P1-4 exit
// "segments fill at any ending"). Every node of every fixture, reached by every path from the
// start, in every page locale, against a table written out by hand from the fixture graphs (design
// §9: lantern-walk, river-stones, two-paths); all filled at every ending, alternates included;
// down by one step on Back; paused off the primary path.
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { start, step, type EngineState, type Graph } from '../../core/engine'
import { ENABLED_LOCALE_CODES } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { graphOf, playerDataOf, type PlayerData } from './player-data'
import { segmentsOf } from './segments'

const fixtures = [twoPaths, riverStones, lanternWalk].map((raw) => {
  const data = playerDataOf(StoryPackageV1.parse(raw), { locales: ENABLED_LOCALE_CODES })
  return { data, graph: graphOf(data) }
})

/** Filled segments per node, by hand from the fixture graphs (an ending fills every segment). */
const EXPECTED: Readonly<Record<string, { total: number; reached: Record<string, number> }>> = {
  'two-paths': {
    total: 3,
    reached: { start: 1, wise_path: 2, quick_path: 1, ending_wise: 3, ending_quick: 3 },
  },
  'river-stones': {
    total: 5,
    reached: {
      start: 1,
      flat_stones: 2,
      big_rock: 3,
      far_bank: 4,
      ending_dry: 5,
      round_stones: 1,
      ending_wet: 5,
      ending_back: 5,
    },
  },
  'lantern-walk': {
    total: 3,
    reached: { start: 1, crossroads: 2, ending_light: 3, ending_shadow: 3 },
  },
}

/** Every path from the start node to `target` (the fixtures are DAGs). */
function pathsTo(data: PlayerData, target: string): string[][] {
  const found: string[][] = []
  const queue: string[][] = [[data.startNodeId]]
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    const id = path[path.length - 1]
    if (id === target) found.push(path)
    const node = data.nodes.find((n) => n.id === id)
    for (const choice of node?.choices ?? []) queue.push([...path, choice.next])
  }
  return found
}

const stateAt = (graph: Graph, path: readonly string[], locale = 'en'): EngineState => {
  const state = start(graph, { path, locale })
  expect(state.path).toEqual(path)
  return state
}

describe('segmentsOf: every node of every fixture', () => {
  it('the table covers every node of the 3 fixtures (the scan is not empty)', () => {
    for (const { data } of fixtures) {
      expect(Object.keys(EXPECTED[data.storyId]?.reached ?? {}).sort(), data.storyId).toEqual(
        data.nodes.map((n) => n.id).sort(),
      )
      expect(EXPECTED[data.storyId]?.total, data.storyId).toBe(data.progressSteps.length)
    }
    expect(fixtures.flatMap(({ data }) => data.nodes)).toHaveLength(17)
  })

  const cases = fixtures.flatMap(({ data, graph }) =>
    data.nodes.flatMap((node) =>
      data.locales.map((locale) => [data.storyId, node.id, locale, data, graph] as const),
    ),
  )

  it.each(cases)(
    '%s %s/%s: by every path from the start',
    (storyId, nodeId, locale, data, graph) => {
      const expected = EXPECTED[storyId]
      const paths = pathsTo(data, nodeId)
      expect(paths.length).toBeGreaterThan(0)
      for (const path of paths) {
        const view = segmentsOf(data, stateAt(graph, path, locale))
        expect(view, path.join(' > ')).toEqual({
          total: expected?.total,
          reached: expected?.reached[nodeId],
        })
        expect(view.reached).toBeGreaterThanOrEqual(0)
        expect(view.reached).toBeLessThanOrEqual(view.total)
      }
    },
  )
})

describe('segmentsOf: endings, Back and side paths', () => {
  const endings = fixtures.flatMap(({ data, graph }) =>
    data.endingIds.map((id) => [data.storyId, id, data, graph] as const),
  )

  it('covers the 7 endings, 4 of them alternates', () => {
    expect(endings.map(([storyId, id]) => `${storyId}/${id}`)).toEqual([
      'two-paths/ending_wise',
      'two-paths/ending_quick',
      'river-stones/ending_dry',
      'river-stones/ending_wet',
      'river-stones/ending_back',
      'lantern-walk/ending_light',
      'lantern-walk/ending_shadow',
    ])
    const alternates = endings.filter(
      ([, id, data]) => data.nodes.find((n) => n.id === id)?.isAlternate === true,
    )
    expect(alternates.map(([, id]) => id)).toEqual([
      'ending_quick',
      'ending_wet',
      'ending_back',
      'ending_shadow',
    ])
  })

  it.each(endings)(
    '%s %s: every segment filled, by every path',
    (_storyId, ending, data, graph) => {
      for (const path of pathsTo(data, ending)) {
        const state = stateAt(graph, path)
        expect(state.status).toBe('ended')
        const view = segmentsOf(data, state)
        expect(view.reached, path.join(' > ')).toBe(data.progressSteps.length)
        expect(view.total).toBe(data.progressSteps.length)
      }
    },
  )

  it('goes down by one on Back, and back from an ending', () => {
    const river = fixtures.find(({ data }) => data.storyId === 'river-stones')
    if (river === undefined) throw new Error('no river-stones')
    const { data, graph } = river
    let state = stateAt(graph, ['start'])
    const seen: number[] = [segmentsOf(data, state).reached]
    for (const event of [
      { type: 'CHOOSE', choiceId: 'c1' },
      { type: 'CHOOSE', choiceId: 'c1' },
      { type: 'BACK' },
      { type: 'CHOOSE', choiceId: 'c1' },
      { type: 'CHOOSE', choiceId: 'c1' },
      { type: 'CHOOSE', choiceId: 'c1' },
      { type: 'BACK' },
    ] as const) {
      const result = step(graph, state, { ...event, seq: state.seq })
      expect(result.accepted, JSON.stringify(event)).toBe(true)
      state = result.state
      seen.push(segmentsOf(data, state).reached)
    }
    // start 1, flat_stones 2, big_rock 3, Back 2, big_rock 3, far_bank 4, ending_dry 5, Back 4.
    expect(seen).toEqual([1, 2, 3, 2, 3, 4, 5, 4])
  })

  it('pauses off the primary path, then fills at the alternate ending', () => {
    const river = fixtures.find(({ data }) => data.storyId === 'river-stones')
    if (river === undefined) throw new Error('no river-stones')
    const { data, graph } = river
    const reached = (path: string[]) => segmentsOf(data, stateAt(graph, path)).reached
    expect(reached(['start'])).toBe(1)
    expect(reached(['start', 'round_stones'])).toBe(1)
    expect(reached(['start', 'round_stones', 'ending_wet'])).toBe(5)
  })

  it('counts only steps on the path while reading, and every step once the run has ended', () => {
    const data = { progressSteps: ['a', 'b', 'c', 'd'] }
    expect(segmentsOf(data, { path: ['x', 'y'], status: 'reading' })).toEqual({
      total: 4,
      reached: 0,
    })
    expect(segmentsOf(data, { path: ['a', 'x', 'c'], status: 'reading' })).toEqual({
      total: 4,
      reached: 2,
    })
    expect(segmentsOf(data, { path: ['a', 'x'], status: 'ended' })).toEqual({
      total: 4,
      reached: 4,
    })
  })
})
