// The reader launch flag (P1 D4; design p1-step7-design.md §3.1, §3.2 M1, §5.1-§5.3; P1-1c).
// - PRODUCTION_LAUNCH, committed, decides Production. It is 'gated' until the owner's Step 25b
//   commit; a unit test pins it.
// - READER_LAUNCH, read at build only, can close any build ('gated', the kill switch after launch)
//   or open a review build that is provably not Production ('review'). Unset or '' means "use the
//   committed state". Anything else, 'review' anywhere else, or a committed 'launched' in a
//   VERCEL_ENV=production build without CONTENT_SOURCE=storage means gated and refused: next build
//   and next dev stop (assertLaunchAllowed in next.config.ts).
// - resolveLaunch is pure. buildLaunch is the only code that reads process.env for the flag.
// - A decision holds fixed reason names only, never a raw env value (as vercelEnvName in
//   scripts/load-content.ts), so logs and errors cannot echo what was set.

export type Env = Readonly<Record<string, string | undefined>>

/**
 * The four build inputs the decision reads. None may be set in a .env* file: next build loads those
 * files and the tsx scripts do not, so scripts/check-build.ts names these in its hint (design §5.1).
 */
export const DECISION_INPUTS = ['READER_LAUNCH', 'VERCEL', 'VERCEL_ENV', 'CONTENT_SOURCE'] as const

export type ProductionLaunch = 'gated' | 'launched'

/** Gated until the owner's Step 25b commit (design §5.6). The type keeps 'launched' reachable. */
export const PRODUCTION_LAUNCH: ProductionLaunch = 'gated'

export const LAUNCH_REASONS = [
  'committed',
  'kill-switch',
  'review',
  'launched-without-storage',
  'review-not-allowed',
  'malformed',
] as const

export type LaunchReason = (typeof LAUNCH_REASONS)[number]

export interface LaunchDecision {
  /** True only when the reader routes (/en, /hi, …) and the language gate are built. */
  readonly readerRoutes: boolean
  readonly reason: LaunchReason
  /** True when next build and next dev must stop; readerRoutes is then always false. */
  readonly refused: boolean
}

const decision = (
  readerRoutes: boolean,
  reason: LaunchReason,
  refused = false,
): LaunchDecision => ({
  readerRoutes,
  reason,
  refused,
})

/**
 * 'review' opens a build only when it is provably not Production: a Vercel Preview, or a build with
 * no Vercel system variables at all that uses fixtures (CI and local). An empty VERCEL or
 * VERCEL_ENV counts as set, as in scripts/load-content.ts.
 */
function reviewAllowed(env: Env): boolean {
  if (env.VERCEL_ENV === 'preview') return true
  return (
    env.VERCEL === undefined && env.VERCEL_ENV === undefined && env.CONTENT_SOURCE === 'fixtures'
  )
}

/** The truth table of design §5.2. Exact values only: no trimming, no case folding. */
export function resolveLaunch(
  env: Env,
  committed: ProductionLaunch = PRODUCTION_LAUNCH,
): LaunchDecision {
  const value = env.READER_LAUNCH
  if (value === undefined || value === '') {
    if (committed === 'gated') return decision(false, 'committed')
    if (env.VERCEL_ENV === 'production' && env.CONTENT_SOURCE !== 'storage') {
      return decision(false, 'launched-without-storage', true)
    }
    return decision(true, 'committed')
  }
  if (value === 'gated') return decision(false, 'kill-switch')
  if (value === 'review') {
    return reviewAllowed(env)
      ? decision(true, 'review')
      : decision(false, 'review-not-allowed', true)
  }
  return decision(false, 'malformed', true)
}

/** The decision for this build: the only reader of READER_LAUNCH. */
export function buildLaunch(): LaunchDecision {
  return resolveLaunch(process.env)
}

/** "reader launch: gated (committed)": the state and the reason name, never a value. */
export function launchLogLine(launch: LaunchDecision): string {
  return `reader launch: ${launch.readerRoutes ? 'open' : 'gated'} (${launch.reason})`
}

/** Stops next build and next dev on a refused decision (design §3.2 M1). */
export function assertLaunchAllowed(launch: LaunchDecision): void {
  if (launch.refused) throw new Error(`reader launch refused: ${launch.reason}`)
}
