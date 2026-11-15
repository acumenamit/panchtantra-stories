// Runs the public rule set over the 11 converted legacy stories (re-converted from pt/) and checks
// the result against spec §5.4: 41 error records on 27 nodes, per story and per check.
// P1-2b (design p1-step8-design.md §3.2, §5.6): exactly one T006 warning, crow-and-serpent
// seek_advice hi (U+7425 U+73C0).
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { validatePackage } from '../../src/core/validator'
import { convertLegacyStory } from './convert'
import { loadLegacyStories } from './load-legacy'

const here = dirname(fileURLToPath(import.meta.url))
const loaded = loadLegacyStories(join(resolve(here, '../../..'), 'pt/src/stories'))
const reports = loaded.map(({ story }) =>
  validatePackage(convertLegacyStory(story), { ruleSet: PANCHATANTRA_RULESET }),
)

// Spec §5.4 table (error records per story, by check).
const EXPECTED: Record<string, Record<string, number>> = {
  'blue-jackal': { E010: 3 },
  'brahmin-and-cobra': { E014: 2, E005: 1 },
  'one-pot-of-seeds': {},
  'brahmins-goat': { E010: 3, E005: 2 },
  'crow-and-serpent': { E014: 2 },
  'four-friends-and-hunter': { E014: 2 },
  'jackal-and-war-drum': {},
  'lion-and-hare': { E014: 10, E005: 2 },
  'monkey-and-crocodile': { E014: 6 },
  'tortoise-and-geese': { E004: 2 },
  'weaver-and-princess': { E004: 6 },
}

describe('legacy stories against panchatantra@3.0.0 (spec §5.4)', () => {
  it('produce exactly the expected error records per story and check', () => {
    const actual: Record<string, Record<string, number>> = {}
    for (const r of reports) {
      const by: Record<string, number> = {}
      for (const f of r.findings)
        if (f.severity === 'error') by[f.checkId] = (by[f.checkId] ?? 0) + 1
      actual[r.storyId!] = by
    }
    expect(actual).toEqual(EXPECTED)
  })

  it('total 41 error records on 27 nodes', () => {
    const errors = reports.flatMap((r) =>
      r.findings.filter((f) => f.severity === 'error').map((f) => `${r.storyId}/${f.nodeId}`),
    )
    expect(errors).toHaveLength(41)
    expect(new Set(errors).size).toBe(27)
  })

  it('show exactly one T006 warning: crow-and-serpent seek_advice hi (P1-2b)', () => {
    const t006 = reports.flatMap((r) =>
      r.findings
        .filter((f) => f.checkId === 'T006')
        .map((f) => ({
          storyId: r.storyId,
          nodeId: f.nodeId,
          locale: f.locale,
          severity: f.severity,
          message: f.message,
        })),
    )
    expect(t006).toEqual([
      {
        storyId: 'crow-and-serpent',
        nodeId: 'seek_advice',
        locale: 'hi',
        severity: 'warn',
        message: 'Letters outside the rendered scripts: U+7425 U+73C0',
      },
    ])
  })

  it('show the 4 progressSteps warnings through alternate nodes (E007)', () => {
    const warns = reports.flatMap((r) =>
      r.findings
        .filter((f) => f.checkId === 'E007' && f.severity === 'warn')
        .map((f) => `${r.storyId}/${f.nodeId}`),
    )
    expect(warns.sort()).toEqual([
      'blue-jackal/ending_unmasked',
      'blue-jackal/moonlit_night',
      'jackal-and-war-drum/ending_proud',
      'jackal-and-war-drum/sees_the_drum',
    ])
  })
})
