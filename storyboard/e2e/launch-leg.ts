// The e2e leg (P1 D4; design p1-step7-design.md §3.12 #27, §7 item 39, §8.3 "Leg selection";
// P1-1c). E2E_LAUNCH names the build under test: 'gated' (the default), 'review' or 'staging';
// anything else stops the run. Tests tagged @gated run only on the gated leg, @review on the review
// and staging legs, @staging only on the staging leg, and untagged tests on every leg. Read by
// playwright.config.ts (grepInvert) and by the build-identity fixture in fixtures.ts, which proves
// the server on the port really is that build.
// P1-2c (design p1-step9-design.md §2, §3.5, §3.6 row 30, §10.3): the staging leg is the review
// build with content from a staging catalogue (scripts/testing/staging-build.ts), so the reader is
// open and every page shows the staging banner; it runs the review suite plus the @staging spec.

export const LAUNCH_LEGS = ['gated', 'review', 'staging'] as const

export type LaunchLeg = (typeof LAUNCH_LEGS)[number]

/** The leg for an E2E_LAUNCH value: unset is 'gated'; anything but a leg name throws. */
export function launchLeg(value: string | undefined): LaunchLeg {
  if (value === undefined) return 'gated'
  if (value === 'gated' || value === 'review' || value === 'staging') return value
  throw new Error("E2E_LAUNCH must be 'gated', 'review' or 'staging' (unset means 'gated')")
}

/**
 * The tags a leg leaves out: the gated leg skips @review and @staging tests, the review leg skips
 * @gated and @staging tests, and the staging leg skips @gated tests (it runs the review suite).
 */
export function skippedTag(leg: LaunchLeg): RegExp {
  if (leg === 'gated') return /@review|@staging/
  if (leg === 'review') return /@gated|@staging/
  return /@gated/
}

/** What GET /en must return on each leg's build: 404 while gated, 200 when the reader is open. */
export const EN_STATUS: Readonly<Record<LaunchLeg, number>> = {
  gated: 404,
  review: 200,
  staging: 200,
}

/** True when the leg's build has the reader open: the review and staging builds. */
export function legOpen(leg: LaunchLeg): boolean {
  return leg !== 'gated'
}

/** True when every page of the leg's build carries the staging banner: the staging build only. */
export function legHasBanner(leg: LaunchLeg): boolean {
  return leg === 'staging'
}
