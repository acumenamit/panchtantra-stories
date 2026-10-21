// panchatantra@3.0.0 public rule set (spec §5.2). Approved by the owner on 2026-10-21 (P0-6, M6).
// Derived from Rules v3.0 and owner decisions; only ids, limits, markers and the Sanskrit list are
// public (NI-4). Decisions: OD-15/OQ-8 (fork targets), OQ-9 (choice counts), OD-16 (unclassified),
// OD-17/OD-18 (markers, line-start rule), OD-19 (words: English only), REQ:65 (question), REQ:66 (terms).
import type { PublicRuleSet } from './types'

export const PANCHATANTRA_RULESET: PublicRuleSet = {
  ref: 'panchatantra@3.0.0',
  collectionId: 'panchatantra',
  status: 'approved',
  requiredLocales: ['en', 'hi'],
  limits: {
    nodes: { default: { min: 6, max: 10 }, max: 20 },
    progressSteps: { default: 5, max: 10 },
    wordsPerNode: { default: { min: 100, max: 200 }, max: 300, locales: ['en'] },
    singleChoiceWords: { default: { min: 2, max: 8 } },
    forkChoiceWordsBelow: 12,
    forksMin: 1,
    endingsMin: 2,
  },
  teachingMarkers: { en: 'The Panchatantra teaches:', hi: 'पञ्चतन्त्र सिखाता है:' },
  sanskritTerms: ['Dharma', 'Niti', 'Karma', 'Ahimsa', 'Brahmin'],
  checks: {
    E001: { ruleId: 'PT-STR-02', kind: 'FLEXIBLE' },
    E002: { ruleId: 'PT-STR-04', kind: 'FIXED' },
    E003: { ruleId: 'PT-STR-06', kind: 'FIXED' },
    E004: { ruleId: 'PT-VOI-01', kind: 'FLEXIBLE' },
    E005: { ruleId: 'PT-CHO-01', kind: 'FIXED' },
    E006: { ruleId: 'PT-CHO-02/03', kind: 'FLEXIBLE' },
    E007: { ruleId: 'PT-STR-03', kind: 'FLEXIBLE' },
    E009: { ruleId: 'PT-STR-08', kind: 'FIXED' },
    E010: { ruleId: 'PT-STR-01', kind: 'FIXED' },
    E013: { ruleId: 'PT-END-01/02', kind: 'FIXED' },
    E014: { ruleId: 'PT-END-03', kind: 'FIXED' },
    E015: { ruleId: 'PT-END-04', kind: 'FIXED' },
    E016: { ruleId: 'PT-VOI-05', kind: 'FIXED' },
    E017: { ruleId: 'PT-WLD-02', kind: 'FIXED' },
    E018: { ruleId: 'PT-WLD-01', kind: 'FIXED' },
    E021: { ruleId: 'PT-BIL-01', kind: 'FIXED' },
  },
}
