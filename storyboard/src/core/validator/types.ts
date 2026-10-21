import type { LocaleCode } from '../locales'
import type { Severity } from '../rules/types'

export interface Finding {
  readonly checkId: string
  readonly ruleId: string | null
  readonly severity: Severity
  readonly nodeId: string | null
  readonly locale: LocaleCode | null
  readonly message: string
  readonly measured?: string
  readonly limit?: string
  readonly waived?: boolean
}

export type ValidationMode = 'authoring' | 'stage' | 'publish'

export interface ValidationReport {
  readonly storyId: string | null
  readonly ruleSetRef: string
  readonly mode: ValidationMode
  /** True when no unwaived error remains. */
  readonly ok: boolean
  readonly findings: readonly Finding[]
  /** Checks that did not run, with the reason (e.g. private word lists not loaded). */
  readonly skipped: readonly { readonly checkId: string; readonly reason: string }[]
}
