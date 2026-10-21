// Re-runs the phase-1 conversion on pt/ (same repo) and checks it against the committed manifest:
// frozen source hashes, zero text diffs, strict parse, totals, and all golden paths through the engine.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { currentNodeId, start, step, toGraph } from '../../src/core/engine'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { convertLegacyStory, deriveType, parseBook } from './convert'
import { compareStrings } from './equality'
import manifest from './legacy-manifest.json'
import { loadLegacyStories } from './load-legacy'
import { allEndingPaths } from './paths'

const here = dirname(fileURLToPath(import.meta.url))
const storiesDir = join(resolve(here, '../../..'), 'pt/src/stories')
const loaded = loadLegacyStories(storiesDir)
const converted = loaded.map((l) => ({ ...l, pkg: convertLegacyStory(l.story) }))

describe('legacy source (M1 freeze)', () => {
  it('matches the committed source hashes exactly', () => {
    const actual = Object.fromEntries(
      loaded.map((l) => [`pt/src/stories/${l.file}`, l.sourceSha256]),
    )
    expect(actual).toEqual(manifest.sourceFiles)
  })
})

describe('phase-1 conversion (M4)', () => {
  it('strict-parses every converted package', () => {
    for (const { pkg } of converted) expect(StoryPackageV1.safeParse(pkg).success).toBe(true)
  })

  it('copies every string byte for byte (0 diffs)', () => {
    const counts = { en: 0, hi: 0 }
    for (const { story, pkg } of converted) {
      const r = compareStrings(story, pkg)
      expect(r.diffs).toEqual([])
      counts.en += r.stringsCompared.en
      counts.hi += r.stringsCompared.hi
    }
    expect(counts).toEqual(manifest.stringsComparedPerLocale)
  })

  it('matches the committed totals (stories, nodes, choices, endings, paths)', () => {
    const totals = { stories: 0, nodes: 0, choices: 0, endings: 0, goldenPaths: 0 }
    for (const { pkg } of converted) {
      totals.stories++
      totals.nodes += pkg.nodes.length
      totals.choices += pkg.nodes.reduce(
        (n, x) => n + (x.type === 'ending' ? 0 : x.choices.length),
        0,
      )
      totals.endings += pkg.nodes.filter((x) => x.type === 'ending').length
      totals.goldenPaths += allEndingPaths(toGraph(pkg)).length
    }
    expect(totals).toEqual(manifest.totals)
  })

  it('keeps graph structure: same node order, ids, next targets and legacy flags', () => {
    for (const { story, pkg } of converted) {
      expect(pkg.nodes.map((n) => n.id)).toEqual(Object.keys(story.nodes))
      for (const n of pkg.nodes) {
        const legacy = story.nodes[n.id]!
        expect(n.type).toBe(deriveType(legacy))
        expect(n.isAlternate).toBe(legacy.isAlternate === true)
        expect(n.scene).toBe(legacy.scene)
        expect(n.image).toBeNull()
        if (n.type === 'ending') expect(n.lessonIcon).toBe(legacy.lessonIcon)
        else expect(n.choices.map((c) => c.next)).toEqual((legacy.choices ?? []).map((c) => c.next))
      }
      expect(pkg.progressSteps).toEqual(story.progressSteps)
      expect(pkg.source.book).toBe(parseBook(story.book.en))
    }
  })
})

describe('golden paths through the engine (spec §6.2)', () => {
  it(`plays all ${manifest.totals.goldenPaths} start-to-ending paths, with BACK and RESTART at every step`, () => {
    let played = 0
    for (const { pkg } of converted) {
      const g = toGraph(pkg)
      for (const path of allEndingPaths(g)) {
        let s = start(g)
        for (const nodeId of path.slice(1)) {
          const choice = g.nodes.get(currentNodeId(s))!.choices.find((c) => c.next === nodeId)!
          const r = step(g, s, { type: 'CHOOSE', seq: s.seq, choiceId: choice.id })
          expect(r.accepted).toBe(true)
          // A RESTART from here must always land on the start node.
          expect(step(g, r.state, { type: 'RESTART', seq: r.state.seq }).state.path).toEqual([
            g.startNodeId,
          ])
          s = r.state
        }
        expect(s.path).toEqual(path)
        expect(s.status).toBe('ended')
        for (let i = path.length - 1; i > 0; i--) {
          const back = step(g, s, { type: 'BACK', seq: s.seq })
          expect(back.accepted).toBe(true)
          s = back.state
        }
        expect(s.path).toEqual([g.startNodeId])
        played++
      }
    }
    expect(played).toBe(manifest.totals.goldenPaths)
  })
})

describe('parseBook', () => {
  it('reads the roman numeral from the English label', () => {
    expect(parseBook('Panchatantra — Book III')).toBe('III')
    expect(parseBook('Panchatantra — Book IV')).toBe('IV')
    expect(() => parseBook('Panchatantra')).toThrow()
  })
})
