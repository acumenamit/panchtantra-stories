import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import fixture from '../../../fixtures/packages/two-paths.json'
import { StoryPackageV1 } from '../package/v1'
import type { LocaleCode } from '../locales'
import { currentNodeId, start, step, toGraph, validPrefix } from './index'
import type { EngineEvent, EngineState, Graph, GraphNode } from './index'

const graph = toGraph(StoryPackageV1.parse(fixture))

function choose(s: EngineState, choiceId: string, seq = s.seq) {
  return step(graph, s, { type: 'CHOOSE', seq, choiceId })
}

describe('engine transition table (spec §6.2)', () => {
  it('starts at the start node, reading, seq 0, default locale', () => {
    const s = start(graph)
    expect(s.path).toEqual(['start'])
    expect(s.status).toBe('reading')
    expect(s.seq).toBe(0)
    expect(s.locale).toBe('en')
  })

  it('CHOOSE with matching seq appends the target, bumps seq, emits arrival effects', () => {
    const r = choose(start(graph), 'c1')
    expect(r.accepted).toBe(true)
    expect(r.state.path).toEqual(['start', 'wise_path'])
    expect(r.state.seq).toBe(1)
    expect(r.effects.map((e) => e.type)).toEqual(['persist', 'focus', 'audio'])
  })

  it('CHOOSE into an ending ends the run and records the ending', () => {
    const s1 = choose(start(graph), 'c1').state
    const r = choose(s1, 'c1')
    expect(r.state.status).toBe('ended')
    expect(r.effects).toContainEqual({ type: 'recordEnding', nodeId: 'ending_wise' })
  })

  it('CHOOSE with a stale seq is a no-op (double tap)', () => {
    const s0 = start(graph)
    const first = choose(s0, 'c1')
    const duplicate = choose(first.state, 'c1', s0.seq)
    expect(duplicate.accepted).toBe(false)
    expect(duplicate.state).toBe(first.state)
    expect(duplicate.effects).toEqual([])
  })

  it('CHOOSE with an unknown choice, or after the run ended, is a no-op', () => {
    const s0 = start(graph)
    expect(choose(s0, 'c4').accepted).toBe(false)
    const ended = choose(choose(s0, 'c1').state, 'c1').state
    expect(choose(ended, 'c1').accepted).toBe(false)
  })

  it('BACK pops the path, bumps seq and returns to reading', () => {
    const ended = choose(choose(start(graph), 'c1').state, 'c1').state
    const r = step(graph, ended, { type: 'BACK', seq: ended.seq })
    expect(r.accepted).toBe(true)
    expect(r.state.path).toEqual(['start', 'wise_path'])
    expect(r.state.seq).toBe(ended.seq + 1)
    expect(r.state.status).toBe('reading')
  })

  it('BACK at the start node or with a stale seq is a no-op', () => {
    const s0 = start(graph)
    expect(step(graph, s0, { type: 'BACK', seq: 0 }).accepted).toBe(false)
    const s1 = choose(s0, 'c1').state
    expect(step(graph, s1, { type: 'BACK', seq: 0 }).accepted).toBe(false)
  })

  it('RESTART resets the path, bumps seq and runEpoch', () => {
    const s1 = choose(start(graph), 'c2').state
    const r = step(graph, s1, { type: 'RESTART', seq: s1.seq })
    expect(r.accepted).toBe(true)
    expect(r.state.path).toEqual(['start'])
    expect(r.state.seq).toBe(s1.seq + 1)
    expect(r.state.runEpoch).toBe(s1.runEpoch + 1)
  })

  it('RESTART with a stale seq is a no-op', () => {
    const s1 = choose(start(graph), 'c1').state
    expect(step(graph, s1, { type: 'RESTART', seq: 0 }).accepted).toBe(false)
  })

  it('SET_LOCALE swaps the language, keeping node and seq', () => {
    const s1 = choose(start(graph), 'c1').state
    const r = step(graph, s1, { type: 'SET_LOCALE', locale: 'hi' })
    expect(r.accepted).toBe(true)
    expect(r.state.locale).toBe('hi')
    expect(r.state.path).toEqual(s1.path)
    expect(r.state.seq).toBe(s1.seq)
  })

  it('SET_LOCALE to a locale the package lacks is a no-op', () => {
    const s0 = start(graph)
    expect(step(graph, s0, { type: 'SET_LOCALE', locale: 'ar' }).accepted).toBe(false)
  })
})

describe('resume (longest valid prefix)', () => {
  it('resumes a valid saved run, including an ended one', () => {
    const s = start(graph, { path: ['start', 'quick_path', 'ending_quick'], locale: 'hi' })
    expect(s.path).toEqual(['start', 'quick_path', 'ending_quick'])
    expect(s.status).toBe('ended')
    expect(s.locale).toBe('hi')
  })

  it('cuts the path at the first invalid step', () => {
    expect(validPrefix(graph, ['start', 'wise_path', 'ending_quick'])).toEqual([
      'start',
      'wise_path',
    ])
    expect(validPrefix(graph, ['start', 'renamed_node'])).toEqual(['start'])
  })

  it('starts fresh when the saved path does not begin at the start node', () => {
    expect(validPrefix(graph, ['wise_path'])).toEqual(['start'])
    expect(validPrefix(graph, [])).toEqual(['start'])
  })

  it('falls back to the default locale for an unknown saved locale', () => {
    expect(start(graph, { path: ['start'], locale: 'xx' }).locale).toBe('en')
  })
})

describe('golden walks of the fixture', () => {
  function allEndingPaths(g: Graph): string[][] {
    const out: string[][] = []
    const walk = (path: string[]) => {
      const node = g.nodes.get(path[path.length - 1] ?? '')
      if (!node) return
      if (node.type === 'ending') out.push(path)
      for (const c of node.choices) walk([...path, c.next])
    }
    walk([g.startNodeId])
    return out
  }

  it('reaches every ending, then BACK to start and RESTART work at every step', () => {
    const paths = allEndingPaths(graph)
    expect(paths).toHaveLength(2)
    for (const p of paths) {
      let s = start(graph)
      for (const nodeId of p.slice(1)) {
        const node = graph.nodes.get(currentNodeId(s))!
        const choice = node.choices.find((c) => c.next === nodeId)!
        const r = choose(s, choice.id)
        expect(r.accepted).toBe(true)
        s = r.state
        const restarted = step(graph, s, { type: 'RESTART', seq: s.seq })
        expect(restarted.state.path).toEqual(['start'])
      }
      expect(s.path).toEqual(p)
      expect(s.status).toBe('ended')
      for (let i = p.length - 1; i > 0; i--) {
        s = step(graph, s, { type: 'BACK', seq: s.seq }).state
      }
      expect(s.path).toEqual(['start'])
    }
  })
})

describe('deep stories (beyond the 3-node fixture)', () => {
  // n0 -> n1 -> n2 -> n3 (fork) -> n4..n11 (chain) -> n12 ending; n3's second choice -> n13 ending.
  const deep: Graph = (() => {
    const nodes = new Map<string, GraphNode>()
    for (let i = 0; i <= 11; i++) {
      const choices =
        i === 3
          ? [
              { id: 'c1', next: 'n4' },
              { id: 'c2', next: 'n13' },
            ]
          : [{ id: 'c1', next: `n${i + 1}` }]
      nodes.set(`n${i}`, { id: `n${i}`, type: i === 3 ? 'fork' : 'single', choices })
    }
    nodes.set('n12', { id: 'n12', type: 'ending', choices: [] })
    nodes.set('n13', { id: 'n13', type: 'ending', choices: [] })
    return {
      storyId: 'deep',
      version: 1,
      startNodeId: 'n0',
      locales: ['en', 'hi'] as LocaleCode[],
      defaultLocale: 'en',
      nodes,
    }
  })()

  it('plays a 13-node path to its ending', () => {
    let s = start(deep)
    // Bounded: a refused CHOOSE must fail the test, never hang it.
    for (let i = 0; i < 20 && s.status === 'reading'; i++) {
      const r = step(deep, s, { type: 'CHOOSE', seq: s.seq, choiceId: 'c1' })
      expect(r.accepted).toBe(true)
      s = r.state
    }
    expect(s.path).toHaveLength(13)
    expect(currentNodeId(s)).toBe('n12')
  })

  it('resumes a 9-node saved run and cuts a long run at its first broken step', () => {
    const nine = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']
    expect(start(deep, { path: nine, locale: 'hi' }).path).toEqual(nine)
    const broken = [...nine.slice(0, 7), 'n13', 'n8']
    expect(validPrefix(deep, broken)).toEqual(nine.slice(0, 7))
  })
})

describe('engine properties (fixed seed)', () => {
  // Random acyclic graphs: node i links only to higher indices. The start node is never an ending,
  // endings are rare elsewhere (1 in 8) and the last node is always one, so runs get deep.
  const arbGraph = fc.integer({ min: 6, max: 16 }).chain((size) =>
    fc
      .array(
        fc.record({
          endRoll: fc.integer({ min: 0, max: 7 }),
          targets: fc.array(fc.nat(), { minLength: 1, maxLength: 2 }),
        }),
        { minLength: size, maxLength: size },
      )
      .map((specs): Graph => {
        const nodes = new Map<string, GraphNode>()
        specs.forEach((spec, i) => {
          const last = i === specs.length - 1
          const ending = last || (i > 0 && spec.endRoll === 0)
          const choices = ending
            ? []
            : spec.targets.map((t, k) => ({
                id: `c${k + 1}`,
                next: `n${i + 1 + (t % (specs.length - 1 - i))}`,
              }))
          const type = ending ? 'ending' : choices.length === 2 ? 'fork' : 'single'
          nodes.set(`n${i}`, { id: `n${i}`, type, choices })
        })
        return {
          storyId: 'prop',
          version: 1,
          startNodeId: 'n0',
          locales: ['en', 'hi'] as LocaleCode[],
          defaultLocale: 'en',
          nodes,
        }
      }),
  )

  // Events are generated by fast-check (so they shrink); seq is applied relative to the live state.
  const arbOps = fc.array(
    fc.record({
      kind: fc.constantFrom(
        'CHOOSE',
        'CHOOSE',
        'CHOOSE',
        'CHOOSE',
        'BACK',
        'RESTART',
        'SET_LOCALE',
      ),
      seqDelta: fc.constantFrom(-1, 0, 0, 0, 1),
      choiceIdx: fc.nat({ max: 3 }),
      locale: fc.constantFrom('en', 'hi', 'ar', 'xx'),
    }),
    { minLength: 1, maxLength: 80, size: 'max' },
  )
  type Op = { kind: string; seqDelta: number; choiceIdx: number; locale: string }

  function toEvent(op: Op, s: EngineState): EngineEvent {
    const seq = s.seq + op.seqDelta
    if (op.kind === 'CHOOSE') return { type: 'CHOOSE', seq, choiceId: `c${op.choiceIdx + 1}` }
    if (op.kind === 'BACK') return { type: 'BACK', seq }
    if (op.kind === 'RESTART') return { type: 'RESTART', seq }
    return { type: 'SET_LOCALE', locale: op.locale }
  }

  it('never throws, keeps a valid path and never lowers seq (with a coverage floor)', () => {
    const cover = { maxDepth: 0, choose: 0, back: 0, restart: 0, locale: 0 }
    fc.assert(
      fc.property(arbGraph, arbOps, (g, ops) => {
        let s = start(g)
        for (const op of ops) {
          const e = toEvent(op, s)
          const before = s.seq
          const r = step(g, s, e)
          s = r.state
          if (r.accepted) {
            if (e.type === 'CHOOSE') cover.choose++
            if (e.type === 'BACK') cover.back++
            if (e.type === 'RESTART') cover.restart++
            if (e.type === 'SET_LOCALE') cover.locale++
          }
          cover.maxDepth = Math.max(cover.maxDepth, s.path.length)
          expect(s.seq).toBeGreaterThanOrEqual(before)
          expect(validPrefix(g, s.path)).toEqual(s.path)
          expect(s.status).toBe(
            g.nodes.get(currentNodeId(s))!.type === 'ending' ? 'ended' : 'reading',
          )
        }
      }),
      { seed: 20261021, numRuns: 300 },
    )
    // Guard against a vacuous property: the generators must actually reach deep, varied states.
    expect(cover.maxDepth).toBeGreaterThanOrEqual(6)
    expect(cover.choose).toBeGreaterThan(500)
    expect(cover.back).toBeGreaterThan(50)
    expect(cover.restart).toBeGreaterThan(50)
    expect(cover.locale).toBeGreaterThan(50)
  })

  it('makes every accepted seq-bearing event a no-op when delivered twice', () => {
    let checked = 0
    fc.assert(
      fc.property(arbGraph, arbOps, (g, ops) => {
        let s = start(g)
        for (const op of ops) {
          const e = toEvent(op, s)
          const r = step(g, s, e)
          if (r.accepted && e.type !== 'SET_LOCALE') {
            const again = step(g, r.state, e)
            expect(again.accepted).toBe(false)
            expect(again.state).toBe(r.state)
            checked++
          }
          s = r.state
        }
      }),
      { seed: 20261021, numRuns: 300 },
    )
    expect(checked).toBeGreaterThan(500)
  })
})
