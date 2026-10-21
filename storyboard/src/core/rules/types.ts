// Rule-set model (spec §5.1). The public part holds only ids, kinds, limits, marker strings and the
// Sanskrit list (NI-4). Rule wording, word lists and Rules v3 line references stay private.
import type { LocaleCode } from '../locales'

export type RuleKind = 'FIXED' | 'FLEXIBLE' | 'UNCLASSIFIED'
export type Severity = 'error' | 'warn' | 'info'

export interface Range {
  readonly min: number
  readonly max: number
}

export interface PublicRuleSet {
  readonly ref: string // e.g. "panchatantra@3.0.0"
  readonly collectionId: string
  readonly status: 'draft' | 'approved'
  readonly requiredLocales: readonly LocaleCode[]
  readonly limits: {
    readonly nodes: { readonly default: Range; readonly max: number }
    readonly progressSteps: { readonly default: number; readonly max: number }
    readonly wordsPerNode: {
      readonly default: Range
      readonly max: number
      readonly locales: readonly LocaleCode[]
    }
    readonly singleChoiceWords: { readonly default: Range }
    readonly forkChoiceWordsBelow: number
    readonly forksMin: number
    readonly endingsMin: number
  }
  readonly teachingMarkers: Readonly<Partial<Record<LocaleCode, string>>>
  readonly sanskritTerms: readonly string[]
  readonly checks: Readonly<Record<string, { readonly ruleId: string; readonly kind: RuleKind }>>
}

/** Loaded only on the owner's PC (storyboard/.rules-private/), never committed or shipped. */
export interface PrivateRuleData {
  readonly ref: string
  readonly idioms: readonly string[]
  readonly anachronismKeywords: readonly string[]
  readonly sanskritNeverCall: Readonly<Record<string, readonly string[]>>
}
