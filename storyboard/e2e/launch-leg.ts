// The e2e leg (P1 D4; design p1-step7-design.md §3.12 #27, §7 item 39, §8.3 "Leg selection";
// P1-1c). E2E_LAUNCH names the build under test: 'gated' (the default) or 'review'; anything else
// stops the run. Tests tagged @gated run only on the gated leg, @review only on the review leg, and
// untagged tests on both. Read by playwright.config.ts (grepInvert) and by the build-identity
// fixture in fixtures.ts, which proves the server on the port really is that build.

export const LAUNCH_LEGS = ['gated', 'review'] as const

export type LaunchLeg = (typeof LAUNCH_LEGS)[number]

/** The leg for an E2E_LAUNCH value: unset is 'gated'; anything but 'gated' or 'review' throws. */
export function launchLeg(value: string | undefined): LaunchLeg {
  if (value === undefined) return 'gated'
  if (value === 'gated' || value === 'review') return value
  throw new Error("E2E_LAUNCH must be 'gated' or 'review' (unset means 'gated')")
}

/** The tag a leg leaves out: the gated leg skips @review tests, the review leg skips @gated tests. */
export function skippedTag(leg: LaunchLeg): RegExp {
  return leg === 'gated' ? /@review/ : /@gated/
}

/** What GET /en must return on each leg's build: 404 while gated, 200 when the reader is open. */
export const EN_STATUS: Readonly<Record<LaunchLeg, number>> = { gated: 404, review: 200 }
