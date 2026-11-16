import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/packages/two-paths.json'
import { start, step, toGraph } from '../engine'
import type { EngineState, Graph, GraphNode } from '../engine'
import type { LocaleCode } from '../locales'
import { StoryPackageV1 } from '../package/v1'
import {
  MAX_RUN_PATH,
  StepWriteSchema,
  endingIdsOf,
  openRun,
  resumeRun,
  stepWriteOf,
} from './index'

const graph = toGraph(StoryPackageV1.parse(fixture))

function choose(s: EngineState, choiceId: string) {
  return step(graph, s, { type: 'CHOOSE', seq: s.seq, choiceId })
}

describe('resumeRun (spec §6.2: resume = longest valid prefix)', () => {
  it('opens fresh at the start node when nothing is saved', () => {
    const r = resumeRun(graph, null)
    expect(r.outcome).toBe('fresh')
    expect(r.state).toEqual(start(graph))
  })

  it('a fresh run takes the caller language, or the default when the package lacks it', () => {
    expect(resumeRun(graph, null, 'hi').state.locale).toBe('hi')
    expect(resumeRun(graph, null, 'ar').state.locale).toBe('en')
    expect(resumeRun(graph, null, 'hi').state.path).toEqual(['start'])
  })

  it('resumes the exact path and language', () => {
    const r = resumeRun(graph, { path: ['start', 'wise_path'], locale: 'hi' })
    expect(r.outcome).toBe('resumed')
    expect(r.state.path).toEqual(['start', 'wise_path'])
    expect(r.state.locale).toBe('hi')
    expect(r.state.status).toBe('reading')
    expect(r.state.seq).toBe(0)
  })

  it('adjusts a path that does not begin at the start node: ["wise_path"] to ["start"]', () => {
    const r = resumeRun(graph, { path: ['wise_path'], locale: 'en' })
    expect(r.outcome).toBe('adjusted')
    expect(r.state.path).toEqual(['start'])
  })

  it('adjusts a path cut at its first invalid step, comparing element by element', () => {
    const r = resumeRun(graph, { path: ['start', 'quick_path', 'renamed'], locale: 'en' })
    expect(r.outcome).toBe('adjusted')
    expect(r.state.path).toEqual(['start', 'quick_path'])
    // Same length, one element different.
    const swapped = resumeRun(graph, { path: ['start', 'renamed'], locale: 'en' })
    expect(swapped.outcome).toBe('adjusted')
    expect(swapped.state.path).toEqual(['start'])
  })

  it('adjusts on a language change only: the caller language wins over the stored one', () => {
    const r = resumeRun(graph, { path: ['start', 'wise_path'], locale: 'en' }, 'hi')
    expect(r.outcome).toBe('adjusted')
    expect(r.state.path).toEqual(['start', 'wise_path'])
    expect(r.state.locale).toBe('hi')
  })

  it('adjusts a stored language the package lacks to the story default', () => {
    const r = resumeRun(graph, { path: ['start', 'wise_path'], locale: 'ar' })
    expect(r.outcome).toBe('adjusted')
    expect(r.state.locale).toBe('en')
  })

  it('resumes when the caller language equals the stored one', () => {
    expect(resumeRun(graph, { path: ['start', 'quick_path'], locale: 'hi' }, 'hi').outcome).toBe(
      'resumed',
    )
  })

  it('counts a stored run that ends at an ending as no run', () => {
    const r = resumeRun(graph, { path: ['start', 'wise_path', 'ending_wise'], locale: 'hi' })
    expect(r.outcome).toBe('fresh')
    expect(r.state).toEqual(start(graph))
    expect(
      resumeRun(graph, { path: ['start', 'quick_path', 'ending_quick'], locale: 'en' }, 'hi').state,
    ).toEqual(start(graph, { path: ['start'], locale: 'hi' }))
  })

  it('reads a stored one-node run at the start node literally (resumed at the start)', () => {
    const r = resumeRun(graph, { path: ['start'], locale: 'hi' })
    expect(r.outcome).toBe('resumed')
    expect(r.state.path).toEqual(['start'])
    expect(r.state.locale).toBe('hi')
  })

  it('ignores the package version: the state carries the current one', () => {
    const v9: Graph = { ...graph, version: 9 }
    const r = resumeRun(v9, { path: ['start', 'wise_path'], locale: 'en' })
    expect(r.outcome).toBe('resumed')
    expect(r.state.version).toBe(9)
  })
})

describe('stepWriteOf: one save per accepted step (spec §6.3)', () => {
  it('saves nothing for a refused event', () => {
    const s0 = start(graph)
    expect(stepWriteOf(graph, step(graph, s0, { type: 'BACK', seq: 0 }))).toBeNull()
    expect(stepWriteOf(graph, choose(s0, 'c4'))).toBeNull()
    expect(stepWriteOf(graph, step(graph, s0, { type: 'SET_LOCALE', locale: 'ar' }))).toBeNull()
  })

  it('saves nothing for SET_LOCALE to the language already shown', () => {
    const r = step(graph, start(graph), { type: 'SET_LOCALE', locale: 'en' })
    expect(r.accepted).toBe(true)
    expect(stepWriteOf(graph, r)).toBeNull()
  })

  it('saves the run after a choice, stamped with the package version', () => {
    const w = stepWriteOf(graph, choose(start(graph), 'c1'))
    expect(w).toEqual({
      version: 1,
      activeRun: { path: ['start', 'wise_path'], locale: 'en' },
      ending: null,
      currentEndings: ['ending_wise', 'ending_quick'],
    })
    expect(StepWriteSchema.safeParse(w).success).toBe(true)
  })

  it('saves a null run and the ending together when the step reaches an ending', () => {
    const w = stepWriteOf(graph, choose(choose(start(graph), 'c2').state, 'c1'))
    expect(w).toEqual({
      version: 1,
      activeRun: null,
      ending: 'ending_quick',
      currentEndings: ['ending_wise', 'ending_quick'],
    })
  })

  it('saves a null run at the start node (Back to start, Restart, SET_LOCALE at start)', () => {
    const s1 = choose(start(graph), 'c1').state
    expect(stepWriteOf(graph, step(graph, s1, { type: 'BACK', seq: s1.seq }))?.activeRun).toBeNull()
    expect(
      stepWriteOf(graph, step(graph, s1, { type: 'RESTART', seq: s1.seq }))?.activeRun,
    ).toBeNull()
    const atStart = stepWriteOf(
      graph,
      step(graph, start(graph), { type: 'SET_LOCALE', locale: 'hi' }),
    )
    expect(atStart).toEqual({
      version: 1,
      activeRun: null,
      ending: null,
      currentEndings: ['ending_wise', 'ending_quick'],
    })
  })

  it('saves the new language with the run after SET_LOCALE mid-story', () => {
    const s1 = choose(start(graph), 'c1').state
    const w = stepWriteOf(graph, step(graph, s1, { type: 'SET_LOCALE', locale: 'hi' }))
    expect(w?.activeRun).toEqual({ path: ['start', 'wise_path'], locale: 'hi' })
  })

  it('copies the path, so the saved run never shares the engine state array', () => {
    const r = choose(start(graph), 'c1')
    expect(stepWriteOf(graph, r)?.activeRun?.path).not.toBe(r.state.path)
  })

  it('saves a path over 64 ids (only a cyclic graph could make one) as a null run', () => {
    const nodes = new Map<string, GraphNode>([
      ['a_node', { id: 'a_node', type: 'single', choices: [{ id: 'c1', next: 'b_node' }] }],
      ['b_node', { id: 'b_node', type: 'single', choices: [{ id: 'c1', next: 'a_node' }] }],
    ])
    const loop: Graph = {
      storyId: 'loop-story',
      version: 1,
      startNodeId: 'a_node',
      locales: ['en'] as LocaleCode[],
      defaultLocale: 'en',
      nodes,
    }
    const next = (s: EngineState) => step(loop, s, { type: 'CHOOSE', seq: s.seq, choiceId: 'c1' })
    let r = next(start(loop))
    while (r.state.path.length < MAX_RUN_PATH) r = next(r.state)
    expect(stepWriteOf(loop, r)?.activeRun?.path).toHaveLength(MAX_RUN_PATH)
    r = next(r.state)
    expect(r.state.path).toHaveLength(MAX_RUN_PATH + 1)
    expect(stepWriteOf(loop, r)?.activeRun).toBeNull()
  })

  it('lists the ending ids in package order', () => {
    expect(endingIdsOf(graph)).toEqual(['ending_wise', 'ending_quick'])
  })
})

describe('openRun: the player opens stored-first (Step 10, D11-P3)', () => {
  it('resumes in the stored language when the graph has it, whatever the page language', () => {
    const r = openRun(graph, { path: ['start', 'wise_path'], locale: 'hi' }, 'en')
    expect(r.outcome).toBe('resumed')
    expect(r.state.locale).toBe('hi')
    expect(r.state.path).toEqual(['start', 'wise_path'])
    expect(openRun(graph, { path: ['start', 'quick_path'], locale: 'en' }, 'hi').state.locale).toBe(
      'en',
    )
  })

  it('takes the page language, never the story default, for a stored language the graph lacks', () => {
    // 'ar' is registered but not in this graph; the page is 'hi' and the default is 'en'.
    expect(graph.defaultLocale).toBe('en')
    const r = openRun(graph, { path: ['start', 'wise_path'], locale: 'ar' }, 'hi')
    expect(r.outcome).toBe('adjusted')
    expect(r.state.locale).toBe('hi')
    expect(r.state.path).toEqual(['start', 'wise_path'])
    // A page that offers English only (graphOf restricts the locales): a stored Hindi run reads in English.
    const englishOnly: Graph = { ...graph, locales: ['en'], defaultLocale: 'en' }
    const e = openRun(englishOnly, { path: ['start', 'quick_path'], locale: 'hi' }, 'en')
    expect(e.outcome).toBe('adjusted')
    expect(e.state.locale).toBe('en')
    expect(e.state.path).toEqual(['start', 'quick_path'])
  })

  it('opens fresh in the page language when nothing is stored', () => {
    const r = openRun(graph, null, 'hi')
    expect(r.outcome).toBe('fresh')
    expect(r.state).toEqual(start(graph, { path: ['start'], locale: 'hi' }))
  })

  it('opens a stored run that ends at an ending fresh in the page language, not the stored one', () => {
    const r = openRun(graph, { path: ['start', 'wise_path', 'ending_wise'], locale: 'hi' }, 'en')
    expect(r.outcome).toBe('fresh')
    expect(r.state).toEqual(start(graph, { path: ['start'], locale: 'en' }))
  })

  it('keeps the longest valid prefix in the stored language, and a start-only run literally', () => {
    const trimmed = openRun(graph, { path: ['start', 'quick_path', 'gone'], locale: 'hi' }, 'en')
    expect(trimmed.outcome).toBe('adjusted')
    expect(trimmed.state.path).toEqual(['start', 'quick_path'])
    expect(trimmed.state.locale).toBe('hi')
    const atStart = openRun(graph, { path: ['start'], locale: 'hi' }, 'en')
    expect(atStart.outcome).toBe('resumed')
    expect(atStart.state.locale).toBe('hi')
  })

  it('every stored path and language: the stored language if the graph has it, else the page one', () => {
    const paths = [
      ['start'],
      ['start', 'wise_path'],
      ['start', 'quick_path'],
      ['start', 'wise_path', 'ending_wise'],
      ['start', 'quick_path', 'ending_quick'],
      ['wise_path'],
      ['start', 'nope'],
    ]
    let cases = 0
    for (const path of paths) {
      for (const storedLocale of ['en', 'hi', 'ar'] as const) {
        for (const page of ['en', 'hi'] as const) {
          const stored = { path, locale: storedLocale }
          const r = openRun(graph, stored, page)
          const base = resumeRun(graph, stored, 'en')
          const usable = storedLocale !== 'ar' && base.outcome !== 'fresh'
          expect(r.state.locale).toBe(usable ? storedLocale : page)
          expect(r.state.path).toEqual(base.state.path)
          expect(r.outcome === 'fresh').toBe(base.outcome === 'fresh')
          cases++
        }
      }
    }
    expect(cases).toBe(42)
  })
})
