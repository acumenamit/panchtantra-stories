import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import fixture from '../../../fixtures/packages/two-paths.json'
import { PANCHATANTRA_RULESET } from '../rules/panchatantra'
import type { PrivateRuleData } from '../rules/types'
import { validatePackage } from './index'
import type { ValidateOptions } from './index'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): Json => structuredClone(fixture) as Json
const opts: ValidateOptions = { ruleSet: PANCHATANTRA_RULESET }
const errorsOf = (p: unknown, o: ValidateOptions = opts) =>
  validatePackage(p, o)
    .findings.filter((f) => f.severity === 'error')
    .map((f) => f.checkId)
const hasCheck = (p: unknown, checkId: string, severity?: string, o: ValidateOptions = opts) =>
  validatePackage(p, o).findings.some(
    (f) => f.checkId === checkId && (!severity || f.severity === severity),
  )

// The fixture has 5 nodes and 3 progressSteps, so E001/E007 report info, never errors.
describe('validator: the clean fixture', () => {
  it('has no errors; only info and missing-media warnings', () => {
    const r = validatePackage(fixture, opts)
    expect(errorsOf(fixture)).toEqual([])
    expect(r.ok).toBe(true)
    expect(new Set(r.findings.filter((f) => f.severity === 'warn').map((f) => f.checkId))).toEqual(
      new Set(['A005', 'A006']),
    )
  })

  it('reports the word-list checks as skipped without private data', () => {
    const r = validatePackage(fixture, opts)
    expect(r.skipped.map((s) => s.checkId).sort()).toEqual(['E016', 'E017', 'E018'])
  })

  it('never throws, whatever the input', () => {
    fc.assert(
      fc.property(fc.anything(), (x) => {
        const r = validatePackage(x, opts)
        return Array.isArray(r.findings)
      }),
      { seed: 20261021, numRuns: 200 },
    )
  })
})

describe('validator: one failing case per check', () => {
  const node = (p: Json, id: string): Json => p.nodes.find((n: Json) => n.id === id)
  const en = (p: Json, id: string): Json => p.text.en.nodes[id]
  const cases: [string, string, (p: Json) => void, string?][] = [
    [
      'S001',
      'error',
      (p) => {
        p.storyId = 'Bad Id'
      },
    ],
    [
      'G001',
      'error',
      (p) => {
        p.startNodeId = 'nowhere'
      },
    ],
    [
      'G004',
      'error',
      (p) => {
        node(p, 'wise_path').choices[0].next = 'missing_node'
      },
    ],
    [
      'G005',
      'error',
      (p) => {
        p.nodes.push({
          id: 'orphan',
          type: 'ending',
          scene: 's',
          isAlternate: false,
          image: null,
          lessonIcon: 'x',
        })
        p.text.en.nodes.orphan = { text: 'x', lesson: 'y' }
        p.text.hi.nodes.orphan = { text: 'x', lesson: 'y' }
      },
    ],
    [
      'G007',
      'error',
      (p) => {
        node(p, 'wise_path').choices[0].next = 'start'
      },
    ],
    [
      'G008',
      'error',
      (p) => {
        p.progressSteps = ['start', 'ending_quick', 'wise_path']
      },
    ],
    [
      'G009',
      'error',
      (p) => {
        node(p, 'wise_path').isAlternate = true
      },
    ],
    [
      'G010',
      'error',
      (p) => {
        delete en(p, 'start').question
      },
    ],
    [
      'G011',
      'error',
      (p) => {
        p.locales = ['en', 'hi', 'ar']
        p.text.ar = structuredClone(p.text.en)
      },
      'publish',
    ],
    [
      'T001',
      'error',
      (p) => {
        en(p, 'start').text = 'Café by the path.'
      },
    ],
    [
      'T002',
      'error',
      (p) => {
        en(p, 'start').text = 'A fox‮ stands.'
      },
    ],
    [
      'T003',
      'error',
      (p) => {
        en(p, 'start').text = ' A fox stands.'
      },
    ],
    [
      'T004',
      'error',
      (p) => {
        en(p, 'start').text = 'A *bold fox stands.'
      },
    ],
    [
      'T005',
      'error',
      (p) => {
        en(p, 'start').text = 'See https://example.com now.'
      },
    ],
    [
      'A009',
      'error',
      (p) => {
        p.aiUse.illustration = 'none'
        p.assets.push({
          kind: 'image',
          id: 'a'.repeat(64),
          width: 1,
          height: 1,
          variants: [{ path: 'x.webp', mime: 'image/webp', bytes: 1 }],
          provenance: { origin: 'ai_generated' },
        })
      },
    ],
    [
      'E002',
      'error',
      (p) => {
        node(p, 'start').type = 'single'
        node(p, 'start').choices = [{ id: 'c1', next: 'wise_path' }]
        delete en(p, 'start').choices.c2
        delete p.text.hi.nodes.start.choices.c2
        p.nodes = p.nodes.filter((n: Json) => !['quick_path', 'ending_quick'].includes(n.id))
        for (const l of ['en', 'hi']) {
          delete p.text[l].nodes.quick_path
          delete p.text[l].nodes.ending_quick
        }
      },
    ],
    [
      'E004',
      'error',
      (p) => {
        en(p, 'start').text = Array(301).fill('word').join(' ')
      },
    ],
    [
      'E005',
      'error',
      (p) => {
        en(p, 'start').question = 'Which way? Left or right?'
      },
    ],
    [
      'E007',
      'error',
      (p) => {
        p.progressSteps = Array(11).fill('start')
      },
    ],
    [
      'E010',
      'error',
      (p) => {
        node(p, 'start').choices[1].next = 'wise_path'
      },
    ],
    [
      'E014',
      'error',
      (p) => {
        en(p, 'ending_wise').text = 'Home.\nAs the Panchatantra teaches: "Be patient."'
      },
    ],
    [
      'E015',
      'error',
      (p) => {
        en(p, 'ending_quick').lesson = en(p, 'ending_wise').lesson
      },
    ],
    [
      'E021',
      'error',
      (p) => {
        p.locales = ['en']
        delete p.text.hi
      },
    ],
  ]

  it.each(cases)('%s (%s)', (checkId, severity, mutate, mode) => {
    const p = base()
    mutate(p)
    const o: ValidateOptions = { ...opts, ...(mode ? { mode: mode as 'publish' } : {}) }
    expect(hasCheck(p, checkId, severity, o)).toBe(true)
    expect(validatePackage(p, o).ok).toBe(false)
  })

  it('E006/E001/E007 report info, never errors, outside FLEXIBLE defaults', () => {
    const p = base()
    p.text.en.nodes.start.choices.c1 =
      'Take the long and winding path past the old well and the tall tree'
    const r = validatePackage(p, opts)
    expect(r.findings.some((f) => f.checkId === 'E006' && f.severity === 'info')).toBe(true)
    expect(r.findings.some((f) => f.checkId === 'E001' && f.severity === 'info')).toBe(true)
    expect(r.findings.some((f) => f.checkId === 'E007' && f.severity === 'info')).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('E010 on a same-target alternate is info, not an error (OQ-8)', () => {
    const p = base()
    const alt = node(p, 'quick_path')
    alt.choices = [
      { id: 'c1', next: 'ending_quick' },
      { id: 'c2', next: 'ending_quick' },
    ]
    for (const l of ['en', 'hi']) p.text[l].nodes.quick_path.choices.c2 = 'Wait'
    expect(hasCheck(p, 'E010', 'info')).toBe(true)
    expect(hasCheck(p, 'E010', 'error')).toBe(false)
  })

  it('E004 counts English only; Hindi over 300 words is info (OD-19)', () => {
    const p = base()
    p.text.hi.nodes.start.text = Array(320).fill('शब्द').join(' ')
    const r = validatePackage(p, opts)
    expect(
      r.findings.some((f) => f.checkId === 'E004' && f.locale === 'hi' && f.severity === 'info'),
    ).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('E014 uses the line-start rule in Hindi too (OD-17)', () => {
    const p = base()
    p.text.hi.nodes.ending_wise.text = 'घर।\nजैसा पञ्चतन्त्र सिखाता है: "धैर्य रखो।"'
    expect(hasCheck(p, 'E014', 'error')).toBe(true)
  })

  it('A005/A006 become errors for a story about to be featured', () => {
    expect(hasCheck(fixture, 'A006', 'error', { ...opts, forFeature: true })).toBe(true)
  })
})

describe('validator: private word lists (owner PC only)', () => {
  const privateData: PrivateRuleData = {
    ref: 'panchatantra@3.0.0',
    idioms: ['castles in the air'],
    anachronismKeywords: ['sultan'],
    sanskritNeverCall: { Karma: ['destiny'] },
  }
  it('warns on idioms, anachronisms and translated Sanskrit terms', () => {
    const p = base()
    p.text.en.nodes.start.text =
      'The fox built castles in the air, thought of destiny and the sultan.'
    const r = validatePackage(p, { ...opts, privateData })
    expect(r.skipped).toEqual([])
    for (const id of ['E016', 'E017', 'E018'])
      expect(r.findings.some((f) => f.checkId === id && f.severity === 'warn')).toBe(true)
    expect(r.ok).toBe(true)
  })
  it('matches whole words only', () => {
    const p = base()
    p.text.en.nodes.start.text = 'The sultanas were sweet.'
    expect(
      validatePackage(p, { ...opts, privateData }).findings.some((f) => f.checkId === 'E018'),
    ).toBe(false)
  })
})
