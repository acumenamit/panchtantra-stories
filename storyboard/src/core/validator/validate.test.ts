import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import fixture from '../../../fixtures/packages/two-paths.json'
import { PANCHATANTRA_RULESET } from '../rules/panchatantra'
import type { PrivateRuleData } from '../rules/types'
import { validatePackage } from './index'
import type { ValidateOptions } from './index'
import { RENDERED_SCRIPTS, scriptProblem } from './text'

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

// P1-2b (design p1-step8-design.md §5.5, §10.1): A001, asset references resolve; error in every
// mode. The existing A009 case above declares an image asset that no node names, which A001 allows
// (it checks references, not use), so it needed no change.
describe('validator: A001 asset references', () => {
  const SHA_IMAGE = '1'.repeat(64)
  const SHA_AUDIO = '2'.repeat(64)
  const image = (id = SHA_IMAGE): Json => ({
    kind: 'image',
    id,
    width: 800,
    height: 600,
    variants: [{ path: `media/two-paths/${id}-w800.webp`, mime: 'image/webp', bytes: 1000 }],
    provenance: { origin: 'human' },
  })
  const audio = (nodeId: string, locale: string, id = SHA_AUDIO): Json => ({
    kind: 'audio',
    id,
    nodeId,
    locale,
    durationMs: 1000,
    variants: [{ path: `media/two-paths/${id}-a.mp3`, mime: 'audio/mpeg', bytes: 1000 }],
    provenance: { origin: 'human' },
    narratedTextSha256: '3'.repeat(64),
  })
  const consistent = (): Json => {
    const p = base()
    p.nodes[0].image = SHA_IMAGE
    p.assets = [image(), audio('start', 'en'), audio('start', 'hi', '4'.repeat(64))]
    return p
  }
  const a001 = (p: unknown, o: ValidateOptions = opts) =>
    validatePackage(p, o).findings.filter((f) => f.checkId === 'A001')
  const modes: ValidateOptions[] = [
    opts,
    { ...opts, mode: 'stage' },
    { ...opts, mode: 'publish' },
    { ...opts, forFeature: true },
  ]

  it('passes the fixture (no assets, no pictures) and a package whose references resolve', () => {
    for (const o of modes) {
      expect(a001(base(), o)).toEqual([])
      expect(a001(consistent(), o)).toEqual([])
    }
    expect(validatePackage(consistent(), opts).ok).toBe(true)
  })

  const cases: [string, (p: Json) => void, { nodeId: string | null; locale: string | null }][] = [
    [
      'two assets share an id',
      (p) => {
        p.assets.push(image('4'.repeat(64)))
      },
      { nodeId: null, locale: null },
    ],
    [
      'a node picture names no asset',
      (p) => {
        p.nodes[1].image = '9'.repeat(64)
      },
      { nodeId: 'wise_path', locale: null },
    ],
    [
      'a node picture names an audio asset',
      (p) => {
        p.nodes[1].image = SHA_AUDIO
      },
      { nodeId: 'wise_path', locale: null },
    ],
    [
      'a narration names a missing node',
      (p) => {
        p.assets.push(audio('nowhere', 'en', '5'.repeat(64)))
      },
      { nodeId: 'nowhere', locale: 'en' },
    ],
    [
      'a narration is in a language the package lacks',
      (p) => {
        p.assets.push(audio('start', 'ar', '5'.repeat(64)))
      },
      { nodeId: 'start', locale: 'ar' },
    ],
    [
      'two narrations for one node and language',
      (p) => {
        p.assets.push(audio('start', 'en', '5'.repeat(64)))
      },
      { nodeId: 'start', locale: 'en' },
    ],
  ]

  it.each(cases)('fails when %s, as one error in every mode', (_why, mutate, where) => {
    const p = consistent()
    mutate(p)
    for (const o of modes) {
      const found = a001(p, o)
      expect(
        found.map((f) => ({ severity: f.severity, nodeId: f.nodeId, locale: f.locale })),
      ).toEqual([{ severity: 'error', ...where }])
      expect(found[0]?.ruleId).toBeNull()
      expect(validatePackage(p, o).ok).toBe(false)
    }
  })

  it('names short ids in its messages', () => {
    const p = consistent()
    p.nodes[1].image = '9'.repeat(64)
    expect(a001(p)[0]?.message).toBe('Picture 999999999999 names no image asset')
  })
})

// P1-2b (design §5.6, §10.1): T006, letters outside the rendered scripts. P1 Step 17
// (p1-step17-design.md D17-16): a warning in authoring (and with no mode), an error in stage and
// publish.
describe('validator: T006 rendered scripts', () => {
  const t006 = (p: unknown, o: ValidateOptions = opts) =>
    validatePackage(p, o).findings.filter((f) => f.checkId === 'T006')

  it('RENDERED_SCRIPTS is Latin and Devanagari', () => {
    expect(RENDERED_SCRIPTS).toEqual(['Latn', 'Deva'])
  })

  it('the fixture passes', () => {
    expect(t006(base())).toEqual([])
  })

  it('warns once on Han letters in Hindi text in authoring, listing the code points; ok stays true', () => {
    const p = base()
    p.text.hi.nodes.start.text = 'उसकी琥珀रंगी आँखें चमकीं। 琥珀'
    for (const o of [opts, { ...opts, forFeature: true }]) {
      expect(t006(p, o)).toEqual([
        {
          checkId: 'T006',
          ruleId: null,
          severity: 'warn',
          nodeId: 'start',
          locale: 'hi',
          message: 'Letters outside the rendered scripts: U+7425 U+73C0',
        },
      ])
      // forFeature turns the fixture's missing media into errors; in authoring T006 never fails.
      if (!o.forFeature) expect(validatePackage(p, o).ok).toBe(true)
    }
  })

  it('T17-47 T006 by mode: warn in authoring and with no mode, error in stage and publish, one finding per string in every mode; forFeature changes nothing (A1, D17-16, S17-TP-6)', () => {
    const modes: [string, ValidateOptions][] = [
      ['no mode', opts],
      ['authoring', { ...opts, mode: 'authoring' }],
      ['stage', { ...opts, mode: 'stage' }],
      ['publish', { ...opts, mode: 'publish' }],
    ]
    for (const [name, o] of modes) {
      expect(t006(base(), o), `precondition: the fixture has no T006 (${name})`).toEqual([])
      expect(validatePackage(base(), o).ok, `precondition: the fixture is ok (${name})`).toBe(true)
    }

    // g1 the Han sample, by mode
    const han = base()
    han.text.hi.nodes.start.text = 'उसकी琥珀रंगी आँखें चमकीं। 琥珀'
    const expected: [string, ValidateOptions, 'warn' | 'error', boolean][] = [
      ['no mode', opts, 'warn', true],
      ['authoring', { ...opts, mode: 'authoring' }, 'warn', true],
      ['stage', { ...opts, mode: 'stage' }, 'error', false],
      ['publish', { ...opts, mode: 'publish' }, 'error', false],
    ]
    for (const [name, o, severity, ok] of expected) {
      expect
        .soft(
          t006(han, o).map((f) => [f.severity, f.nodeId, f.locale]),
          `(g1) the Han sample in ${name}: one T006 ${severity}`,
        )
        .toEqual([[severity, 'start', 'hi']])
      expect.soft(validatePackage(han, o).ok, `(g1) the Han sample in ${name}: ok ${ok}`).toBe(ok)
    }
    const featured: [string, ValidateOptions, 'warn' | 'error'][] = [
      ['authoring with forFeature', { ...opts, mode: 'authoring', forFeature: true }, 'warn'],
      ['stage with forFeature', { ...opts, mode: 'stage', forFeature: true }, 'error'],
      ['publish with forFeature', { ...opts, mode: 'publish', forFeature: true }, 'error'],
    ]
    for (const [name, o, severity] of featured)
      expect
        .soft(
          t006(han, o).map((f) => f.severity),
          `(g1) the Han sample in ${name}: forFeature changes nothing`,
        )
        .toEqual([severity])

    // g2 one finding per string: question, lesson and choice
    const strings = base()
    strings.text.en.nodes.start.question = 'Which way, Ωmega?'
    strings.text.en.nodes.start.choices.c1 = 'Go Ωmega'
    strings.text.en.nodes.ending_wise.lesson = 'Patience Ω'
    for (const [name, o, severity] of expected)
      expect
        .soft(
          t006(strings, o).map((f) => [f.severity, f.nodeId, f.locale]),
          `(g2) question, lesson and choice: 3 T006 ${severity} findings in ${name}`,
        )
        .toEqual([
          [severity, 'start', 'en'],
          [severity, 'start', 'en'],
          [severity, 'ending_wise', 'en'],
        ])
  })

  it('warns on Cyrillic in English, story-level fields included (nodeId null)', () => {
    const p = base()
    p.text.en.title = 'The Fox and the Мост'
    expect(t006(p).map((f) => [f.nodeId, f.locale, f.message])).toEqual([
      [null, 'en', 'Letters outside the rendered scripts: U+041C U+043E U+0441 U+0442'],
    ])
  })

  it('gives one finding per string: question, lesson and choices each count', () => {
    const p = base()
    p.text.en.nodes.start.question = 'Which way, Ωmega?'
    p.text.en.nodes.start.choices.c1 = 'Go Ωmega'
    p.text.en.nodes.ending_wise.lesson = 'Patience Ω'
    expect(t006(p).map((f) => [f.nodeId, f.locale])).toEqual([
      ['start', 'en'],
      ['start', 'en'],
      ['ending_wise', 'en'],
    ])
  })

  it.each([
    ['Devanagari in English', 'en', 'The word is धैर्य.'],
    ['a Roman numeral in a Hindi book label', 'hi', 'पञ्चतन्त्र — पुस्तक III'],
    [
      'emoji with ZWJ and VS16',
      'en',
      'Family \u{1F468}‍\u{1F469}‍\u{1F467}, a heart ❤️, a keycap 1️⃣',
    ],
    ['Devanagari digits', 'hi', 'दिन ०१२३४५६७८९'],
    ['Latin-1 letters and Common punctuation', 'en', 'Café — naïve “quotes” … ½'],
  ])('passes %s', (_why, locale, text) => {
    const p = base()
    p.text[locale].book = text
    expect(t006(p)).toEqual([])
  })
})

describe('scriptProblem', () => {
  it('lists distinct code points in order of appearance, at most 5', () => {
    expect(scriptProblem('abc')).toBeNull()
    expect(scriptProblem('')).toBeNull()
    expect(scriptProblem('琥珀琥')).toBe('Letters outside the rendered scripts: U+7425 U+73C0')
    expect(scriptProblem('αβγδεζη')).toBe(
      'Letters outside the rendered scripts: U+03B1 U+03B2 U+03B3 U+03B4 U+03B5',
    )
    expect(scriptProblem('𠀀')).toBe('Letters outside the rendered scripts: U+20000')
  })

  it('checks letters, marks and digits only', () => {
    expect(scriptProblem('→ ★ ♥ ‍ ️ ¶ ₹ ।')).toBeNull() // symbols, joiners, danda
    expect(scriptProblem('́')).toBeNull() // combining acute: Inherited
    expect(scriptProblem('١٢٣')).toBe('Letters outside the rendered scripts: U+0661 U+0662 U+0663')
    expect(scriptProblem('\ud800')).toBeNull() // a lone surrogate is no letter
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
