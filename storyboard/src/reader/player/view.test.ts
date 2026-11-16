// Player view helpers (Step 10a; design D11-P7, P8, P9, P25, P30, §9.2): paragraphs round-trip
// (fixed-seed fast-check and every fixture text), every node of every fixture in en and hi through
// partViewOf, the part token and page number, and the settle constant.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import { start, step, toGraph, type EngineState, type Graph } from '../../core/engine'
import { ENABLED_LOCALE_CODES } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { graphOf, playerDataOf } from './player-data'
import { SETTLE_MS, pageNumberOf, paragraphsOf, partViewOf, tokenOf } from './view'

const SEED = 20261114
const fixtures = [twoPaths, riverStones, lanternWalk].map((p) => StoryPackageV1.parse(p))

/** The first path (breadth first) from the start node to every node of the graph. */
function pathsTo(g: Graph): Map<string, string[]> {
  const paths = new Map<string, string[]>([[g.startNodeId, [g.startNodeId]]])
  const queue = [g.startNodeId]
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const c of g.nodes.get(id)?.choices ?? []) {
      if (paths.has(c.next)) continue
      paths.set(c.next, [...(paths.get(id) ?? []), c.next])
      queue.push(c.next)
    }
  }
  return paths
}

describe('paragraphsOf (D11-P30): split on "\\n\\n" only, nothing trimmed', () => {
  it('round-trips any text (fixed seed)', () => {
    const text = fc.oneof(
      fc.string({ unit: fc.constantFrom('a', 'b', ' ', '\n', '\t', ' ', 'ब', '😀') }),
      fc.string(),
    )
    fc.assert(
      fc.property(text, (t) => {
        const paragraphs = paragraphsOf(t)
        expect(paragraphs.join('\n\n')).toBe(t)
        expect(paragraphs.every((p) => !p.includes('\n\n'))).toBe(true)
      }),
      { seed: SEED, numRuns: 5_000 },
    )
  })

  it('keeps single newlines and edge spaces exactly', () => {
    expect(paragraphsOf('One.\n\nTwo\nlines.')).toEqual(['One.', 'Two\nlines.'])
    expect(paragraphsOf(' a \n\n b ')).toEqual([' a ', ' b '])
    expect(paragraphsOf('a\n\n\nb')).toEqual(['a', '\nb'])
    expect(paragraphsOf('*Stars* stay.')).toEqual(['*Stars* stay.'])
  })

  it('round-trips every fixture text', () => {
    // The fixture texts are one paragraph each; multi-paragraph text is covered above.
    let texts = 0
    for (const pkg of fixtures) {
      for (const locale of pkg.locales) {
        for (const t of Object.values(pkg.text[locale]!.nodes)) {
          const paragraphs = paragraphsOf(t.text)
          expect(paragraphs.join('\n\n')).toBe(t.text)
          expect(paragraphs).toHaveLength(t.text.split('\n\n').length)
          texts++
        }
      }
    }
    expect(texts).toBe(34)
  })
})

describe('partViewOf: every node of every fixture in en and hi', () => {
  it('shows the node in the run language, choices and lesson as stored', () => {
    let views = 0
    for (const pkg of fixtures) {
      const data = playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })
      const g = graphOf(data)
      const paths = pathsTo(g)
      expect(paths.size).toBe(pkg.nodes.length)
      for (const locale of ['en', 'hi'] as const) {
        const source = pkg.text[locale]!
        for (const node of pkg.nodes) {
          const path = paths.get(node.id)!
          const state = start(g, { path, locale })
          expect(state.path).toEqual(path)
          const view = partViewOf(data, state)
          const stored = source.nodes[node.id]!
          const ending = node.type === 'ending'
          expect(view).toEqual({
            token: '0:0',
            seq: 0,
            runEpoch: 0,
            status: ending ? 'ended' : 'reading',
            nodeId: node.id,
            page: path.length,
            locale,
            dir: 'ltr',
            title: source.title,
            paragraphs: stored.text.split('\n\n'),
            question: ending ? null : (stored.question ?? null),
            choices: ending
              ? []
              : node.choices.map((c) => ({ id: c.id, label: stored.choices?.[c.id] })),
            ending,
            isAlternate: node.isAlternate,
            scene: node.scene,
            lessonIcon: ending ? node.lessonIcon : null,
            lesson: ending ? stored.lesson : null,
          })
          views++
        }
      }
    }
    expect(views).toBe(34)
  })

  it('keeps choice labels exactly as stored: a leading emoji, literal asterisks (D11-P25)', () => {
    const labels = {
      en: { c1: '🐒 Climb the *tall* tree', c2: '☀️ Wait for the sun' },
      hi: { c1: '🐢 धीरे-धीरे *चलो*', c2: '👨‍👩‍👧 सब साथ में रुको' },
    } as const
    const pkg = structuredClone(fixtures[0]!)
    for (const locale of ['en', 'hi'] as const) {
      pkg.text[locale]!.nodes[pkg.startNodeId]!.choices = { ...labels[locale] }
    }
    const data = playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })
    for (const locale of ['en', 'hi'] as const) {
      const view = partViewOf(data, start(graphOf(data), { path: [data.startNodeId], locale }))
      expect(view.choices).toEqual([
        { id: 'c1', label: labels[locale].c1 },
        { id: 'c2', label: labels[locale].c2 },
      ])
    }
  })

  it("reads only the data's own keys: a node named like an Object.prototype member (review PIF-7)", () => {
    // 'constructor' is a valid NodeId (package/v1.ts:15); a plain index would find a function.
    const pkg = StoryPackageV1.parse(
      JSON.parse(JSON.stringify(twoPaths).replaceAll('"wise_path"', '"constructor"')),
    )
    const data = playerDataOf(pkg, { locales: ENABLED_LOCALE_CODES })
    const state = start(graphOf(data), { path: ['start', 'constructor'], locale: 'hi' })
    expect(partViewOf(data, state).nodeId).toBe('constructor')
    const lacking = structuredClone(data)
    delete (lacking.text.hi!.nodes as Record<string, unknown>)['constructor']
    expect(() => partViewOf(lacking, state)).toThrow(
      new Error('player: two-paths hi constructor view missing'),
    )
  })

  it('throws with ids only when the data lacks the node', () => {
    const data = playerDataOf(fixtures[0]!, { locales: ENABLED_LOCALE_CODES })
    const forged: EngineState = { ...start(graphOf(data)), path: ['start', 'nowhere'] }
    expect(() => partViewOf(data, forged)).toThrow(
      new Error('player: two-paths en nowhere view missing'),
    )
    const english = playerDataOf(fixtures[0]!, { locales: ['en'] })
    const hindi: EngineState = { ...start(graphOf(english)), locale: 'hi' }
    expect(() => partViewOf(english, hindi)).toThrow(
      new Error('player: two-paths hi start view missing'),
    )
  })
})

describe('tokenOf and pageNumberOf (D11-P8, P9)', () => {
  it('follow seq, runEpoch and the path through choices, Back and Restart', () => {
    const g = toGraph(fixtures[1]!)
    const s0 = start(g)
    expect([tokenOf(s0), pageNumberOf(s0)]).toEqual(['0:0', 1])
    const s1 = step(g, s0, { type: 'CHOOSE', seq: 0, choiceId: 'c1' }).state
    expect([tokenOf(s1), pageNumberOf(s1)]).toEqual(['0:1', 2])
    const s2 = step(g, s1, { type: 'CHOOSE', seq: 1, choiceId: 'c1' }).state
    expect([tokenOf(s2), pageNumberOf(s2)]).toEqual(['0:2', 3])
    const s3 = step(g, s2, { type: 'BACK', seq: 2 }).state
    expect([tokenOf(s3), pageNumberOf(s3)]).toEqual(['0:3', 2])
    const s4 = step(g, s3, { type: 'RESTART', seq: 3 }).state
    expect([tokenOf(s4), pageNumberOf(s4)]).toEqual(['1:4', 1])
  })
})

describe('SETTLE_MS (D11-P7)', () => {
  it('is 500 ms', () => {
    expect(SETTLE_MS).toBe(500)
  })
})
