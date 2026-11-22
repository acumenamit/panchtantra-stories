// Step 14 (P1-8c) report.ts: the §5 code table, the §4.8 line formatters and the §4.9 report
// writer (design migration-input/p1-step14-design.md §4.8, §4.9, §5, D14-18; test plan §14.9:
// T14-68 to T14-70). vi.mock wraps each node:fs function the writer uses in a vi.fn around the real
// one. Every report is written under an OS temp folder. Titles start with their id; one
// expect.soft per claim, messages "(gN) <claim> <sample>"; preconditions are hard expects starting
// "precondition:".
//
// Step 15a (P1-8d part a, design migration-input/p1-step15a-design.md §4.7, §4.8, §5, D15-19,
// D15-22, D15-28, D15-29; test plan §14.3: T15A-6 to T15A-9): the approve and publish codes,
// formatters and report sections, the real-path half (isLocalRealPath, checkedReportDir and its
// brand) and the writer's write-time re-checks. realpathSync.native is wrapped too, so a sample can
// answer a chosen real path for one input path and call through for every other.
//
// Step 15b (P1-8d part b, design migration-input/p1-step15b-design.md §3.23, §4.8, §5, D15B-23,
// D15B-24; test plan §14.3: T15B-3 to T15B-5, and the PINNED_EXITS edit of §2.5 and 14.16): the 24
// new codes, verify-timeout at exits 1 and 4, the phase takedown, the command verify, the new
// formatters, the publish report's optional unpublish, takedown and checks sections and the verify
// report.
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import {
  EXIT_BY_CODE,
  REVIEW_LINE,
  VERIFY_TIMEOUT_HINT,
  buildReport,
  checkedReportDir,
  exitForPhase,
  formatAnswerRefused,
  formatApprovalRecord,
  formatApprovePlan,
  formatFeature,
  formatFeatureCounts,
  formatLive,
  formatPlan,
  formatPointerMoved,
  formatProductionMoved,
  formatPublishPlan,
  formatPublishSnapshot,
  formatPublishStory,
  formatRecovery,
  formatReportDirNotLocal,
  formatReportDirRefused,
  formatReportUnwritten,
  formatSiteNotLocal,
  formatSnapshot,
  formatStageCarried,
  formatStageStory,
  formatStopped,
  formatStoryMessage,
  formatSuperseded,
  formatValidateStory,
  formatValidateSummary,
  internalName,
  isLocalRealPath,
  writeReport,
  type ReportInput,
  type ReportSite,
} from './report'
import {
  RANGE_RECOVERY,
  TAKEDOWN_LAG_NOTE,
  formatDeepMismatch,
  formatDeepPlan,
  formatDeepSummary,
  formatExcluded,
  formatExcludedCount,
  formatLandingFailed,
  formatLandingSummary,
  formatMediaFailed,
  formatMediaSummary,
  formatMp3Kept,
  formatNoRollback,
  formatOlderLive,
  formatOlderThanBefore,
  formatRangeFailed,
  formatRangeOk,
  formatRangeSkipped,
  formatSnapshotMatch,
  formatStagingMoved,
  formatStagingNotMoved,
  formatTakedownDone,
  formatTakedownPlan,
  formatTakedownRemoved,
  formatUnpublishPlan,
  formatUnpublishRecovery,
  formatUnpublishUnknown,
  formatVerifyExpected,
  formatVerifyTimeoutHint,
} from './report'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    mkdirSync: vi.fn(real.mkdirSync),
    writeFileSync: vi.fn(real.writeFileSync),
    renameSync: vi.fn(real.renameSync),
    rmSync: vi.fn(real.rmSync),
    realpathSync: Object.assign(vi.fn(real.realpathSync), {
      native: vi.fn(real.realpathSync.native),
    }),
  }
})

const SHA = '0123456789abcdef'.repeat(4)
const SHA2 = 'fedcba9876543210'.repeat(4)
const COUNTS = { errors: 0, waived: 1, lapsed: 0, warnings: 12, info: 7, unusedKeys: 2 }

/** The §5 table, typed here: code → the exits it may carry. */
const PINNED_EXITS: Record<string, number[]> = {
  staged: [0],
  unchanged: [0],
  'dry-run': [0],
  ok: [0],
  ...Object.fromEntries(
    [
      'local-file-path',
      'local-file-missing',
      'local-file-not-regular',
      'local-file-too-large',
      'package-not-jcs',
      'package-strict-parse',
      'package-story-id',
      'package-collection',
      'phase-1-package',
      'waiver-file-missing',
      'waiver-file-invalid',
      'waiver-story-id',
      'waiver-rule-set',
      'waiver-story-level-key',
      'waiver-keys-invalid',
      'waiver-on-non-migration',
      'validator-unwaived',
      'package-gate',
      'media-plan',
      'media-size',
      'media-hash',
      'media-type',
      'blocked',
      'catalogue-unknown-object',
      'pointer-state-inconsistent',
      'pointer-gate',
      'snapshot-missing',
      'snapshot-gate',
      'waiver-not-in-masters',
      'waiver-hash-mismatch',
      'waiver-too-large',
      'version-not-increased',
      'waivers-changed-same-package',
      'existing-object-differs',
      'existing-object-unverifiable',
      'carried-package-missing',
      'seq-exhausted',
      'plan-gate',
    ].map((code) => [code, [1]]),
  ),
  'local-file-changed': [1, 3],
  'storage-unauthorized': [1, 3],
  'storage-failed': [1, 3],
  ...Object.fromEntries(
    [
      'usage',
      'configuration',
      'stage-here-only',
      'project-mismatch',
      'private-lists-invalid',
      'report-unwritten',
    ].map((code) => [code, [2]]),
  ),
  ...Object.fromEntries(
    [
      'upload-failed',
      'too-large',
      'mime-refused',
      'upload-verify-failed',
      'snapshot-unconfirmed',
      'seq-taken',
      'concurrent-writer',
      'deadline',
    ].map((code) => [code, [3]]),
  ),
  ...Object.fromEntries(
    ['pointer-not-moved', 'pointer-superseded', 'pointer-unconfirmed', 'pointer-raced'].map(
      (code) => [code, [4]],
    ),
  ),
  'client-refused': [1, 3, 4],
  internal: [1, 3, 4],
  // Step 15a §5: the 35 new codes, exactly as its table.
  ...Object.fromEntries(
    [
      'approved',
      'already-approved',
      'already-published',
      'published',
      'rebuilt',
      'verify-superseded',
    ].map((code) => [code, [0]]),
  ),
  ...Object.fromEntries(
    [
      'answers-invalid',
      'not-staged',
      'approval-package-changed',
      'staged-entry-superseded',
      'staged-entry-invalid',
      'approve-origin-not-migration',
      'approval-review-incomplete',
      'approval-missing',
      'approval-invalid',
      'approval-rule-set',
      'approval-waiver-mismatch',
      'approval-sha-mismatch',
      'waiver-keys-differ',
      'object-missing',
      'carried-package-gate',
      'production-missing',
      'production-entry-unapproved',
      'feature-not-in-production',
      'feature-media-incomplete',
      'rollback-seq-not-older',
      'rollback-snapshot-missing',
      'rollback-snapshot-invalid',
      'rollback-entry-unapproved',
    ].map((code) => [code, [1]]),
  ),
  'answers-missing': [1, 2],
  'run-context-refused': [2],
  'approval-raced': [3],
  'approval-unconfirmed': [3],
  'hook-failed': [4],
  'verify-timeout': [1, 4],
  // Step 15b §5: the 24 new codes, exactly as its table.
  ...Object.fromEntries(['unpublished', 'taken-down', 'verified'].map((code) => [code, [0]])),
  ...Object.fromEntries(
    [
      'unpublish-last-story',
      'unpublish-story-unknown',
      'hash-list-missing',
      'hash-list-invalid',
      'landing-page-failed',
      'site-gated',
      'media-check-failed',
      'live-snapshot-mismatch',
      'deep-over-cap',
      'deep-unknown-object',
      'deep-mismatch',
    ].map((code) => [code, [1]]),
  ),
  ...Object.fromEntries(
    [
      'takedown-not-on-this-pc',
      'takedown-unknown-object',
      'takedown-check-failed',
      'range-check-failed',
    ].map((code) => [code, [1, 4]]),
  ),
  'takedown-here-only': [2],
  ...Object.fromEntries(
    [
      'staging-not-moved',
      'takedown-still-named',
      'takedown-raced',
      'takedown-incomplete',
      'takedown-mp3-kept',
    ].map((code) => [code, [4]]),
  ),
}

const finding = (
  checkId: string,
  severity: 'error' | 'warn' | 'info',
  nodeId: string | null,
  locale: 'en' | 'hi' | null,
  waived?: boolean,
) => ({
  checkId,
  ruleId: 'PT-S14CANARYruleId',
  severity,
  nodeId,
  locale,
  message: 'S14CANARYmessage',
  measured: 'S14CANARYmeasured',
  limit: 'S14CANARYlimit',
  ...(waived === undefined ? {} : { waived }),
})

const STORY_OK = {
  storyId: 'two-paths',
  packageSha256: SHA,
  version: 1,
  origin: 'migration',
  verdict: 'ok',
  blocking: null,
  counts: COUNTS,
  findings: [finding('E004', 'error', 'start', 'en', true), finding('T006', 'warn', 'start', 'hi')],
  skipped: ['E016', 'E017', 'E018'],
  waiver: { waiverFileSha256: SHA2, keys: 2 },
  media: [
    {
      path: `media/two-paths/${SHA}-w768.webp`,
      mime: 'image/webp',
      bytes: 40,
      sha256: SHA,
      state: 'checked',
    },
  ],
} as const
const STORY_BLOCKED = {
  storyId: 'river-stones',
  packageSha256: SHA2,
  version: 2,
  origin: 'migration',
  verdict: 'blocked',
  blocking: 'media-hash',
  counts: { errors: 0, waived: 0, lapsed: 0, warnings: 3, info: 5, unusedKeys: 0 },
  findings: [],
  skipped: [],
  waiver: null,
  media: [
    {
      path: `media/river-stones/${SHA2}-w768.webp`,
      mime: 'image/webp',
      bytes: 41,
      sha256: SHA,
      state: 'refused',
    },
  ],
} as const
const VALIDATE_INPUT = {
  command: 'validate',
  mode: 'validate',
  startedAt: '2026-11-21T10:00:00.000Z',
  finishedAt: '2026-11-21T10:00:01.000Z',
  outcome: 'blocked',
  exitCode: 1,
  writes: 0,
  uploaded: [],
  skipped: [],
  orphans: [],
  superseded: [],
  ruleSetRef: PANCHATANTRA_RULESET.ref,
  privateWordLists: 'loaded',
  stories: [STORY_OK, STORY_BLOCKED],
} as const satisfies ReportInput
const STAGE_INPUT = {
  ...VALIDATE_INPUT,
  command: 'stage',
  mode: 'stage',
  outcome: 'staged',
  exitCode: 0,
  writes: 14,
  uploaded: [`media/two-paths/${SHA}-w768.webp`, `packages/two-paths/${SHA}.json`],
  skipped: [`media/two-paths/${SHA2}-en.mp3`],
  orphans: [5, 6],
  superseded: [{ storyId: 'lantern-walk', packageSha256: SHA2 }],
  privateWordLists: 'not loaded',
  stories: [STORY_OK],
  plan: {
    seq: 7,
    productionSeq: 3,
    stagingSeq: 4,
    gaps: 1,
    stories: [
      { storyId: 'lantern-walk', packageSha256: SHA2, source: 'production' },
      { storyId: 'two-paths', packageSha256: SHA, source: 'new' },
    ],
    snapshotSha256: SHA,
    pointerSha256: SHA2,
  },
} as const satisfies ReportInput
const DRY_INPUT = {
  ...STAGE_INPUT,
  mode: 'dry-run',
  outcome: 'dry-run',
  writes: 0,
} as const satisfies ReportInput

const throwsTypeError = (run: () => unknown): boolean => {
  try {
    run()
    return false
  } catch (error) {
    return error instanceof TypeError
  }
}

describe('report: formatters and the code table', () => {
  it('T14-68 line formatters: the §4.8 formats exactly; every field validated', () => {
    const vStory = {
      storyId: 'two-paths',
      packageSha256: SHA,
      version: 1,
      counts: COUNTS,
      media: 3,
      blocking: null,
    }
    expect(
      typeof formatValidateStory(vStory),
      'precondition: one sample per formatter formats',
    ).toBe('string')
    const pinned: [string, () => unknown, unknown][] = [
      [
        'validate story ok',
        () => formatValidateStory(vStory),
        'validate: two-paths package=0123456789ab version=1 errors=0 waived=1 lapsed=0 warnings=12 info=7 unused-keys=2 media=3 verdict=ok',
      ],
      [
        'validate story blocked',
        () =>
          formatValidateStory({
            ...vStory,
            counts: { ...COUNTS, errors: 2 },
            blocking: 'validator-unwaived',
          }),
        'validate: two-paths package=0123456789ab version=1 errors=2 waived=1 lapsed=0 warnings=12 info=7 unused-keys=2 media=3 verdict=blocked:validator-unwaived',
      ],
      [
        'validate story before the package was read',
        () =>
          formatValidateStory({
            ...vStory,
            packageSha256: null,
            version: null,
            counts: { errors: 0, waived: 0, lapsed: 0, warnings: 0, info: 0, unusedKeys: 0 },
            media: 0,
            blocking: 'local-file-missing',
          }),
        'validate: two-paths package=none version=none errors=0 waived=0 lapsed=0 warnings=0 info=0 unused-keys=0 media=0 verdict=blocked:local-file-missing',
      ],
      ['validate summary', () => formatValidateSummary(2, 3), 'validate: 2/3 stageable'],
      [
        'validate summary under --all',
        () => formatValidateSummary(1, 1, 4),
        'validate: 1/1 stageable ignored=4',
      ],
      [
        'stage story',
        () =>
          formatStageStory({
            storyId: 'two-paths',
            packageSha256: SHA,
            version: 2,
            state: 'new',
            mediaNew: 3,
            mediaSkipped: 0,
            bytes: 1234,
            waiverKeys: 0,
          }),
        'stage: two-paths package=0123456789ab version=2 state=new media-new=3 media-skipped=0 bytes=1234 waiver-keys=0',
      ],
      [
        'stage carried',
        () =>
          formatStageCarried({
            storyId: 'two-paths',
            packageSha256: SHA,
            version: 1,
            state: 'superseded',
          }),
        'stage: two-paths package=0123456789ab version=1 state=superseded',
      ],
      [
        'plan',
        () =>
          formatPlan({
            seq: 1,
            stories: 3,
            objectsNew: 12,
            objectsSkipped: 0,
            orphans: 0,
            production: null,
            staging: null,
          }),
        'stage: plan seq=1 stories=3 objects-new=12 objects-skipped=0 orphans=0 production=none staging=none',
      ],
      [
        'plan unchanged',
        () =>
          formatPlan({
            seq: null,
            stories: 3,
            objectsNew: 0,
            objectsSkipped: 12,
            orphans: 1,
            production: 2,
            staging: 1,
          }),
        'stage: plan seq=none stories=3 objects-new=0 objects-skipped=12 orphans=1 production=2 staging=1',
      ],
      [
        'snapshot',
        () => formatSnapshot({ seq: 1, sha256: SHA, result: 'identical' }),
        'stage: snapshot seq=1 sha256=0123456789ab identical',
      ],
      [
        'pointer',
        () => formatPointerMoved(1),
        'stage: staging pointer seq=1 moved (read back, post-check clean)',
      ],
      [
        'stopped with an id',
        () => formatStopped('stage', 'version-not-increased', { storyId: 'two-paths' }),
        'stage: stopped: version-not-increased two-paths',
      ],
      [
        'stopped raced',
        () => formatStopped('stage', 'pointer-raced'),
        'stage: stopped: pointer-raced re-run stage',
      ],
      [
        'stopped client-refused',
        () =>
          formatStopped('stage', 'client-refused', {
            refusal: 'refused: pointer url url-mismatch',
          }),
        'stage: stopped: client-refused refused: pointer url url-mismatch',
      ],
      [
        'stopped internal',
        () => formatStopped('stage', 'internal', { errorName: internalName(new RangeError('x')) }),
        'stage: stopped: internal RangeError',
      ],
      [
        'validate stopped',
        () => formatStopped('validate', 'private-lists-invalid'),
        'validate: stopped: private-lists-invalid',
      ],
      ['report-unwritten', () => formatReportUnwritten('validate'), 'validate: report-unwritten'],
      [
        'report dir refused',
        () => formatReportDirRefused('stage'),
        'stage: report-dir refused: its real path is at or under public/ or app/ of the storyboard folder',
      ],
      ['review line', () => REVIEW_LINE, 'review: corepack pnpm preview:staging'],
      [
        'story message',
        () =>
          formatStoryMessage(
            'validate',
            'waiver-story-level-key story=two-paths check=T003 locale=en',
          ),
        'validate: waiver-story-level-key story=two-paths check=T003 locale=en',
      ],
      [
        'internal names',
        () => [
          internalName(new TypeError('S14CANARY')),
          internalName(Object.assign(new Error('x'), { name: 's14canary-name' })),
          internalName(new Error('x')),
          internalName('thrown string'),
          internalName({ name: 'TypeError', message: 'refused: pointer url url-mismatch' }),
        ],
        ['TypeError', 'Error', 'Error', 'non-error', 'non-error'],
      ],
      [
        'exit by phase',
        () => [
          exitForPhase('storage-failed', 'plan'),
          exitForPhase('storage-failed', 'commit'),
          exitForPhase('internal', 'pointer'),
          exitForPhase('usage', 'configuration'),
          exitForPhase('staged', 'end'),
        ],
        [1, 3, 4, 2, 0],
      ],
      [
        'the §5 table',
        () => Object.fromEntries([...EXIT_BY_CODE].map(([code, exits]) => [code, [...exits]])),
        PINNED_EXITS,
      ],
    ]
    for (const [id, run, want] of pinned) {
      expect.soft(run(), `(g1) ${id}`).toEqual(want)
    }

    const refused: [string, () => unknown][] = [
      ['an id with /', () => formatValidateStory({ ...vStory, storyId: 'two/paths' })],
      [
        'a path as the sha',
        () => formatValidateStory({ ...vStory, packageSha256: 'media/x.webp' }),
      ],
      [
        'an upper-case sha',
        () => formatSnapshot({ seq: 1, sha256: SHA.toUpperCase(), result: 'created' }),
      ],
      [
        'NaN as the seq',
        () =>
          formatPlan({
            seq: Number.NaN,
            stories: 1,
            objectsNew: 0,
            objectsSkipped: 0,
            orphans: 0,
            production: null,
            staging: null,
          }),
      ],
      ['a negative count', () => formatValidateSummary(-1, 3)],
      ['a negative ignored count', () => formatValidateSummary(1, 1, -1)],
      ['an unknown command (report dir)', () => formatReportDirRefused('unpublish' as 'publish')],
      [
        'a code not in §5 (story)',
        () => formatValidateStory({ ...vStory, blocking: 'not-a-code' }),
      ],
      ['a code not in §5 (stopped)', () => formatStopped('stage', 'not-a-code')],
      ['a prototype name as a code', () => formatStopped('stage', 'constructor')],
      ['an exit-0 code as a stop', () => formatStopped('stage', 'staged')],
      [
        'a forged refusal text',
        () =>
          formatStopped('stage', 'client-refused', {
            refusal: 'refused: pointer field mode S14CANARY',
          }),
      ],
      [
        'an unfiltered error name',
        () => formatStopped('stage', 'internal', { errorName: 's14canary-name' }),
      ],
      ['an unknown command', () => formatStopped('unpublish' as 'publish', 'usage')],
      ['an exit outside the code (phase)', () => exitForPhase('version-not-increased', 'commit')],
      [
        'an exit outside the code (report)',
        () => buildReport({ ...STAGE_INPUT, outcome: 'pointer-raced', exitCode: 1 }),
      ],
      [
        'a code not in §5 (report)',
        () => buildReport({ ...VALIDATE_INPUT, outcome: 'not-a-code' }),
      ],
      [
        'a story message with a hash',
        () =>
          formatStoryMessage(
            'validate',
            `waiver-story-level-key story=two-paths check=${SHA} locale=en`,
          ),
      ],
    ]
    for (const [id, run] of refused) {
      expect.soft(throwsTypeError(run), `(g2) TypeError: ${id}`).toBe(true)
    }
  })

  it('T14-69 report data: the §4.9 fields and the CRIT-16 lists; nothing from the never list at any depth', () => {
    const validate = buildReport(VALIDATE_INPUT)
    const stage = buildReport(STAGE_INPUT)
    expect(
      typeof validate.json === 'string' && typeof stage.json === 'string',
      'precondition: both build',
    ).toBe(true)
    const v = JSON.parse(validate.json) as Record<string, unknown>
    const s = JSON.parse(stage.json) as Record<string, unknown>
    const common = [
      'command',
      'mode',
      'startedAt',
      'finishedAt',
      'outcome',
      'exitCode',
      'writes',
      'uploaded',
      'skipped',
      'orphans',
      'superseded',
      'ruleSetRef',
      'privateWordLists',
      'stories',
    ]
    expect.soft(Object.keys(v).sort(), '(g1) validate top-level keys').toEqual([...common].sort())
    expect
      .soft(Object.keys(s).sort(), '(g1) stage top-level keys')
      .toEqual([...common, 'plan'].sort())
    const storyKeys = [
      'storyId',
      'packageSha256',
      'version',
      'origin',
      'verdict',
      'blocking',
      'counts',
      'findings',
      'skipped',
      'waiver',
      'media',
    ]
    const stories = v.stories as Record<string, unknown>[]
    for (const story of stories) {
      expect
        .soft(Object.keys(story).sort(), `(g1) story keys ${String(story.storyId)}`)
        .toEqual([...storyKeys].sort())
    }
    const findings = (stories[0]?.findings ?? []) as Record<string, unknown>[]
    expect.soft(findings.length, '(g1) the findings are kept').toBe(2)
    for (const f of findings) {
      expect
        .soft(Object.keys(f).sort(), '(g1) a finding is exactly five fields')
        .toEqual(['checkId', 'locale', 'nodeId', 'severity', 'waived'].sort())
    }
    expect
      .soft(Object.keys((s.plan ?? {}) as object).sort(), '(g1) plan keys')
      .toEqual(
        [
          'gaps',
          'pointerSha256',
          'productionSeq',
          'seq',
          'snapshotSha256',
          'stagingSeq',
          'stories',
        ].sort(),
      )

    const never = [
      'basis',
      'notes',
      'ruleId',
      'measured',
      'limit',
      'measuredOnPackageSha256',
      'recordedOn',
      'recordedBy',
      'message',
    ]
    const keysOf = (value: unknown): string[] =>
      value === null || typeof value !== 'object'
        ? []
        : Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
    for (const [id, report] of [
      ['validate', validate],
      ['stage', stage],
    ] as const) {
      const found = keysOf(JSON.parse(report.json)).filter((key) => never.includes(key))
      expect.soft(found, `(g2) no never-list key at any depth: ${id}`).toEqual([])
      expect
        .soft(`${report.json}${report.md}`.includes('S14CANARY'), `(g2) no canary text: ${id}`)
        .toBe(false)
    }

    const md = validate.md
    expect
      .soft(md.includes('two-paths') && md.includes('river-stones'), '(g3) md names the story ids')
      .toBe(true)
    const row =
      md.split('\n').find((line) => line.includes('river-stones') && line.startsWith('|')) ?? ''
    expect.soft(row.includes('media-hash'), '(g3) md names the blocked code').toBe(true)
    expect
      .soft(/\|\s*12\s*\|/.test(md) && /\|\s*7\s*\|/.test(md), '(g3) md names the counts')
      .toBe(true)
    expect.soft(md.includes('blocked'), '(g3) md names the outcome').toBe(true)
  })
})

describe('report: the writer', () => {
  let root = ''
  const writes = [fs.mkdirSync, fs.writeFileSync, fs.renameSync, fs.rmSync].map((fn) =>
    vi.mocked(fn),
  )

  beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), 's14-rp-'))
    for (const fn of writes) fn.mockClear()
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('T14-70 writer: recursive mkdir, temp then rename, fixed names; failures are results (A23, PB4, L17, CRIT-16)', () => {
    expect(
      fs.existsSync(root) && vi.isMockFunction(fs.renameSync),
      'precondition: a temp root, node:fs wrapped',
    ).toBe(true)
    const site = { storyboardRoot: root, platform: process.platform }
    const checked = (path: string) => {
      const result = checkedReportDir(path, site)
      if (!result.ok) throw new Error('test setup: the report dir is checked')
      return result.realDir
    }
    const dir = checked(join(root, 'a', 'b', 'reports'))
    expect
      .soft(writeReport(dir, VALIDATE_INPUT, site), '(g1) a missing nested report dir')
      .toEqual({ ok: true })
    expect
      .soft(fs.existsSync(join(dir, 'publisher-validate.json')), '(g1) the report dir was created')
      .toBe(true)

    vi.mocked(fs.renameSync).mockClear()
    const later = { ...VALIDATE_INPUT, finishedAt: '2026-11-21T11:11:11.000Z' }
    expect(writeReport(dir, later, site), 'precondition: the second write succeeds').toEqual({
      ok: true,
    })
    expect
      .soft(
        fs.readFileSync(join(dir, 'publisher-validate.json'), 'utf8').includes('11:11:11'),
        '(g2) replaced',
      )
      .toBe(true)
    const renames = vi.mocked(fs.renameSync).mock.calls
    expect.soft(renames.length, '(g2) one rename per file').toBe(2)
    expect
      .soft(
        renames.every(
          ([from, to]) =>
            dirname(String(from)) === dir && dirname(String(to)) === dir && from !== to,
        ),
        '(g2) each from a name in the same folder',
      )
      .toBe(true)
    expect
      .soft(fs.readdirSync(dir).sort(), '(g2) no temp file remains')
      .toEqual(['publisher-validate.json', 'publisher-validate.md'])

    const file = join(root, 'not-a-dir')
    fs.writeFileSync(file, 'x')
    const asFile = (() => {
      try {
        return writeReport(checked(file), VALIDATE_INPUT, site)
      } catch {
        return 'threw'
      }
    })()
    expect
      .soft(asFile, '(g3) a report dir that is a file')
      .toEqual({ ok: false, code: 'report-unwritten', refused: null })
    const blockedDir = join(root, 'blocked')
    fs.mkdirSync(join(blockedDir, 'publisher-stage.json'), { recursive: true })
    const asFolder = (() => {
      try {
        return writeReport(checked(blockedDir), STAGE_INPUT, site)
      } catch {
        return 'threw'
      }
    })()
    expect
      .soft(asFolder, '(g3) publisher-stage.json is a folder')
      .toEqual({ ok: false, code: 'report-unwritten', refused: null })

    const named: [string, ReportInput, string[]][] = [
      ['validate', VALIDATE_INPUT, ['publisher-validate.json', 'publisher-validate.md']],
      ['stage', STAGE_INPUT, ['publisher-stage.json', 'publisher-stage.md']],
      ['dry run', DRY_INPUT, ['publisher-stage.json', 'publisher-stage.md']],
    ]
    for (const [id, input, names] of named) {
      const target = join(root, `names-${id.replace(' ', '-')}`)
      writeReport(checked(target), input, site)
      expect.soft(fs.readdirSync(target).sort(), `(g4) names: ${id}`).toEqual(names)
    }
  })
})

// ---- Step 15a ----

const SHA3 = 'abcdef0123456789'.repeat(4)
const APPROVAL_SECTION = {
  storyId: 'two-paths',
  packageSha256: SHA,
  version: 2,
  waiverFileSha256: SHA2,
  state: 'new',
  approvalSha256: SHA3,
} as const
const APPROVE_INPUT = {
  command: 'approve',
  mode: 'approve',
  startedAt: '2026-11-22T10:00:00.000Z',
  finishedAt: '2026-11-22T10:00:01.000Z',
  outcome: 'approved',
  exitCode: 0,
  writes: 1,
  uploaded: [],
  skipped: [],
  orphans: [3],
  superseded: [],
  ruleSetRef: PANCHATANTRA_RULESET.ref,
  privateWordLists: 'not loaded',
  stories: [],
  approval: APPROVAL_SECTION,
} as const satisfies ReportInput
const PUBLISH_SECTION = {
  kind: 'publish',
  from: null,
  seq: 6,
  productionSeq: 5,
  stagingSeq: 4,
  featuredBefore: null,
  featuredAfter: 'two-paths',
  named: [
    {
      storyId: 'two-paths',
      packageSha256: SHA,
      version: 2,
      approvalSha256: SHA3,
      state: 'replaced',
    },
  ],
  stories: [
    { storyId: 'river-stones', packageSha256: SHA2, approvalSha256: SHA, source: 'production' },
    { storyId: 'two-paths', packageSha256: SHA, approvalSha256: SHA3, source: 'published' },
  ],
  snapshotSha256: SHA,
  pointerSha256: SHA2,
  hook: 'triggered',
  verify: 'live',
  liveSeq: 6,
} as const
const PUBLISH_INPUT = {
  ...APPROVE_INPUT,
  command: 'publish',
  mode: 'publish',
  outcome: 'published',
  writes: 2,
  approval: undefined,
  publish: PUBLISH_SECTION,
} as const satisfies ReportInput
const APPROVE_DRY = {
  ...APPROVE_INPUT,
  mode: 'dry-run',
  outcome: 'dry-run',
  writes: 0,
} as const satisfies ReportInput
const PUBLISH_DRY = {
  ...PUBLISH_INPUT,
  mode: 'dry-run',
  outcome: 'dry-run',
  writes: 0,
  publish: { ...PUBLISH_SECTION, hook: 'not-run', verify: 'not-run', liveSeq: null },
} as const satisfies ReportInput

/** Type-only samples (checked by typecheck, never called, so nothing is written). */
function brandSamples(input: ReportInput, site: ReportSite): void {
  // @ts-expect-error a plain string is not a CheckedReportDir
  writeReport('plain', input, site)
}

describe('report: Step 15a codes, formatters and sections', () => {
  it('T15A-6 formatters for approve and publish: the §4.7 lines exactly; every field validated (A20, A25, D15-25)', () => {
    const plan = {
      storyId: 'two-paths',
      packageSha256: SHA,
      version: 2,
      waiverFileSha256: SHA2,
      state: 'new',
    } as const
    const story = {
      storyId: 'two-paths',
      packageSha256: SHA,
      version: 2,
      approvalSha256: SHA2,
      state: 'replaced',
    } as const
    const counts = { storyId: 'two-paths', A001: 0, A005: 1, A006: 0 }
    expect(typeof formatApprovePlan(plan), 'precondition: one sample per formatter formats').toBe(
      'string',
    )
    const pinned: [string, () => unknown, unknown][] = [
      [
        'approve plan',
        () => formatApprovePlan(plan),
        'approve: two-paths package=0123456789ab version=2 waivers=fedcba987654 state=new',
      ],
      ...(['created', 'identical', 'exists', 'planned'] as const).map(
        (result): [string, () => unknown, unknown] => [
          `approve record ${result}`,
          () => formatApprovalRecord({ sha256: SHA, result }),
          `approve: record sha256=0123456789ab ${result}`,
        ],
      ),
      [
        'answer refused',
        () => formatAnswerRefused('images-viewed'),
        'approve: answer images-viewed refused',
      ],
      [
        'publish story',
        () => formatPublishStory(story),
        'publish: two-paths package=0123456789ab version=2 approval=fedcba987654 state=replaced',
      ],
      [
        'publish story without an approval',
        () => formatPublishStory({ ...story, approvalSha256: null, state: 'in-production' }),
        'publish: two-paths package=0123456789ab version=2 approval=none state=in-production',
      ],
      [
        'feature checked',
        () => formatFeature({ storyId: 'two-paths', state: 'checked' }),
        'publish: feature two-paths state=checked',
      ],
      [
        'feature cleared',
        () => formatFeature({ storyId: null, state: 'cleared' }),
        'publish: feature none state=cleared',
      ],
      [
        'feature counts',
        () => formatFeatureCounts(counts),
        'publish: feature two-paths A001=0 A005=1 A006=0',
      ],
      [
        'plan rollback',
        () =>
          formatPublishPlan({
            kind: 'rollback',
            seq: 6,
            stories: 3,
            production: 5,
            staging: 4,
            featured: null,
            from: 3,
          }),
        'publish: plan kind=rollback seq=6 stories=3 production=5 staging=4 featured=none from=3',
      ],
      [
        'plan publish unchanged',
        () =>
          formatPublishPlan({
            kind: 'publish',
            seq: null,
            stories: 3,
            production: 5,
            staging: 4,
            featured: 'two-paths',
            from: null,
          }),
        'publish: plan kind=publish seq=none stories=3 production=5 staging=4 featured=two-paths from=none',
      ],
      [
        'snapshot',
        () => formatPublishSnapshot({ seq: 6, sha256: SHA, result: 'created' }),
        'publish: snapshot seq=6 sha256=0123456789ab created',
      ],
      [
        'production pointer',
        () => formatProductionMoved(6),
        'publish: production pointer seq=6 moved (read back, post-check clean)',
      ],
      ['live', () => formatLive(6), 'publish: live seq=6'],
      ['superseded', () => formatSuperseded(7), 'publish: superseded seq=7'],
      [
        'timeout hint',
        () => VERIFY_TIMEOUT_HINT,
        'publish: verify timed out; if a Vercel Instant Rollback is active, production stays on it until Undo Rollback (spec §8)',
      ],
      [
        'recovery',
        () => formatRecovery(6),
        'publish: recovery: publish --snapshot 6 redeploys production as it is',
      ],
      [
        'approve stopped',
        () => formatStopped('approve', 'approval-raced', { storyId: 'two-paths' }),
        'approve: stopped: approval-raced two-paths',
      ],
      [
        'not local, the flag',
        () => formatReportDirNotLocal('publish', true),
        'publish: report-dir refused: its real path is not on a local drive',
      ],
      [
        'not local, the default',
        () => formatReportDirNotLocal('approve', false),
        "approve: report-dir refused: the default report dir's real path is not on a local drive; pass a local --report-dir",
      ],
      [
        'site not local',
        () => formatSiteNotLocal('validate'),
        "validate: report-dir refused: the storyboard folder's real path is not on a local drive; run from a local checkout",
      ],
      [
        'approve report-unwritten',
        () => formatReportUnwritten('approve'),
        'approve: report-unwritten',
      ],
    ]
    for (const [id, run, want] of pinned) {
      expect.soft(run(), `(g1) ${id}`).toEqual(want)
    }

    const refused: [string, () => unknown][] = [
      ['an answer key outside the six: narration', () => formatAnswerRefused('narration')],
      ['an answer key with a trailing space', () => formatAnswerRefused('images-viewed ')],
      ['a canary answer key', () => formatAnswerRefused('S15ACANARY')],
      ['approve state rejected', () => formatApprovePlan({ ...plan, state: 'rejected' as 'new' })],
      [
        'publish story state published',
        () => formatPublishStory({ ...story, state: 'published' as 'new' }),
      ],
      [
        "approval 'none' as a string",
        () => formatPublishStory({ ...story, approvalSha256: 'none' }),
      ],
      ['a feature count of -1', () => formatFeatureCounts({ ...counts, A005: -1 })],
      ['a feature count of NaN', () => formatFeatureCounts({ ...counts, A001: Number.NaN })],
      ['formatRecovery(0)', () => formatRecovery(0)],
      ['an unknown command (stopped)', () => formatStopped('unpublish' as 'publish', 'usage')],
      [
        'an unknown command (not local)',
        () => formatReportDirNotLocal('unpublish' as 'publish', true),
      ],
    ]
    for (const [id, run] of refused) {
      expect.soft(throwsTypeError(run), `(g2) TypeError: ${id}`).toBe(true)
    }
    expect
      .soft(formatStopped('stage', 'pointer-raced'), '(g3) pointer-raced on stage')
      .toBe('stage: stopped: pointer-raced re-run stage')
    expect
      .soft(formatStopped('publish', 'pointer-raced'), '(g3) pointer-raced on publish')
      .toBe('publish: stopped: pointer-raced re-run publish')
  })

  it('T15A-7 report data for approve and publish: the §4.8 sections exactly; modes and sections per command; nothing private at any depth; phase tail is exit 4 (A20, D15-19)', () => {
    const approve = buildReport(APPROVE_INPUT)
    const publish = buildReport(PUBLISH_INPUT)
    expect(
      typeof approve.json === 'string' && typeof publish.json === 'string',
      'precondition: an approve and a publish input with every field set build',
    ).toBe(true)
    const a = JSON.parse(approve.json) as Record<string, unknown>
    const p = JSON.parse(publish.json) as Record<string, unknown>
    const common = [
      'command',
      'mode',
      'startedAt',
      'finishedAt',
      'outcome',
      'exitCode',
      'writes',
      'uploaded',
      'skipped',
      'orphans',
      'superseded',
      'ruleSetRef',
      'privateWordLists',
      'stories',
    ]
    expect
      .soft(Object.keys(a).sort(), '(g1) approve top-level keys')
      .toEqual([...common, 'approval'].sort())
    expect
      .soft(Object.keys(p).sort(), '(g1) publish top-level keys')
      .toEqual([...common, 'publish'].sort())
    expect
      .soft(Object.keys(a.approval as object).sort(), '(g1) approval keys')
      .toEqual(
        [
          'storyId',
          'packageSha256',
          'version',
          'waiverFileSha256',
          'state',
          'approvalSha256',
        ].sort(),
      )
    const section = p.publish as Record<string, unknown>
    expect
      .soft(Object.keys(section).sort(), '(g1) publish keys: the fourteen of §4.8')
      .toEqual(
        [
          'kind',
          'from',
          'seq',
          'productionSeq',
          'stagingSeq',
          'featuredBefore',
          'featuredAfter',
          'named',
          'stories',
          'snapshotSha256',
          'pointerSha256',
          'hook',
          'verify',
          'liveSeq',
        ].sort(),
      )
    for (const named of section.named as Record<string, unknown>[]) {
      expect
        .soft(Object.keys(named).sort(), '(g1) a named entry')
        .toEqual(['storyId', 'packageSha256', 'version', 'approvalSha256', 'state'].sort())
    }
    for (const entry of section.stories as Record<string, unknown>[]) {
      expect
        .soft(Object.keys(entry).sort(), '(g1) a stories entry')
        .toEqual(['storyId', 'packageSha256', 'approvalSha256', 'source'].sort())
    }
    for (const [id, report] of [
      ['approve', a],
      ['publish', p],
    ] as const) {
      expect
        .soft(
          [
            report.stories,
            report.uploaded,
            report.skipped,
            report.superseded,
            report.privateWordLists,
          ],
          `(g1) ${id}: the empty lists and privateWordLists`,
        )
        .toEqual([[], [], [], [], 'not loaded'])
    }
    expect
      .soft(
        (
          JSON.parse(buildReport({ ...APPROVE_INPUT, approval: null }).json) as Record<
            string,
            unknown
          >
        ).approval,
        '(g1) an approval section of null builds',
      )
      .toBeNull()

    const refused: [string, () => unknown][] = [
      ['approve with mode stage', () => buildReport({ ...APPROVE_INPUT, mode: 'stage' })],
      [
        'approve with a publish section',
        () => buildReport({ ...APPROVE_INPUT, publish: PUBLISH_SECTION }),
      ],
      ['approve without its section', () => buildReport({ ...APPROVE_INPUT, approval: undefined })],
      [
        'publish with an approval section',
        () => buildReport({ ...PUBLISH_INPUT, approval: APPROVAL_SECTION }),
      ],
      [
        'stage with a publish section',
        () => buildReport({ ...STAGE_INPUT, publish: PUBLISH_SECTION }),
      ],
      [
        'validate with an approval section',
        () => buildReport({ ...VALIDATE_INPUT, approval: APPROVAL_SECTION }),
      ],
      [
        "publish.hook 'called'",
        () =>
          buildReport({
            ...PUBLISH_INPUT,
            publish: { ...PUBLISH_SECTION, hook: 'called' as 'triggered' },
          }),
      ],
      [
        "approval.state 'bogus'",
        () =>
          buildReport({
            ...APPROVE_INPUT,
            approval: { ...APPROVAL_SECTION, state: 'bogus' as 'new' },
          }),
      ],
      [
        "approval.approvalSha256 'x'",
        () =>
          buildReport({ ...APPROVE_INPUT, approval: { ...APPROVAL_SECTION, approvalSha256: 'x' } }),
      ],
      [
        'an extra answers field in the approval section',
        () =>
          buildReport({
            ...APPROVE_INPUT,
            approval: { ...APPROVAL_SECTION, answers: 'S15ACANARY' } as typeof APPROVAL_SECTION,
          }),
      ],
      [
        'an extra answers field at the top level',
        () => buildReport({ ...APPROVE_INPUT, answers: 'S15ACANARY' } as ReportInput),
      ],
    ]
    for (const [id, run] of refused) {
      expect.soft(throwsTypeError(run), `(g2) TypeError: ${id}`).toBe(true)
    }

    const never = [
      'basis',
      'notes',
      'ruleId',
      'measured',
      'limit',
      'measuredOnPackageSha256',
      'recordedOn',
      'recordedBy',
      'message',
      'answers',
      'review',
      'narrationCheck',
      'devices',
    ]
    const keysOf = (value: unknown): string[] =>
      value === null || typeof value !== 'object'
        ? []
        : Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
    for (const [id, report] of [
      ['approve', approve],
      ['publish', publish],
      ['approve dry run', buildReport(APPROVE_DRY)],
      ['publish dry run', buildReport(PUBLISH_DRY)],
    ] as const) {
      const found = keysOf(JSON.parse(report.json)).filter((key) => never.includes(key))
      expect.soft(found, `(g3) no private key at any depth: ${id}`).toEqual([])
    }

    expect
      .soft(
        ['two-paths', 'approved', SHA3].every((word) => approve.md.includes(word)),
        '(g4) the approve md names the story, the outcome and the record sha',
      )
      .toBe(true)
    expect
      .soft(
        ['two-paths', 'river-stones', 'published', 'triggered', 'live', '| 6 |'].every((word) =>
          publish.md.includes(word),
        ),
        '(g4) the publish md names the stories, the outcome, the seq and the hook and verify words',
      )
      .toBe(true)

    const exitOf = (code: string, phase: Parameters<typeof exitForPhase>[1]) => {
      try {
        return exitForPhase(code, phase)
      } catch {
        return 'threw'
      }
    }
    const phases: [string, () => unknown, unknown][] = [
      ['hook-failed at tail', () => exitOf('hook-failed', 'tail'), 4],
      ['verify-timeout at tail', () => exitOf('verify-timeout', 'tail'), 4],
      ['internal at tail', () => exitOf('internal', 'tail'), 4],
      ['answers-missing at plan', () => exitOf('answers-missing', 'plan'), 1],
      ['answers-missing at configuration', () => exitOf('answers-missing', 'configuration'), 2],
    ]
    for (const [id, run, want] of phases) {
      expect.soft(run(), `(g5) ${id}`).toBe(want)
    }
    expect
      .soft(
        throwsTypeError(() => exitForPhase('hook-failed', 'plan')),
        '(g5) hook-failed at plan throws',
      )
      .toBe(true)
    expect
      .soft(
        throwsTypeError(() => exitForPhase('approved', 'tail')),
        '(g5) approved at tail throws',
      )
      .toBe(true)
  })
})

describe('report: Step 15a real-path half and writer', () => {
  let actual: typeof import('node:fs')
  let base = ''
  let sbRoot = ''
  const native = () => vi.mocked(fs.realpathSync.native)

  beforeAll(async () => {
    actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  })
  beforeEach(() => {
    base = fs.mkdtempSync(join(tmpdir(), 's15a-rp-'))
    sbRoot = join(base, 'sb')
    fs.mkdirSync(join(sbRoot, 'public'), { recursive: true })
    for (const fn of [fs.mkdirSync, fs.writeFileSync, fs.renameSync, fs.rmSync]) {
      vi.mocked(fn).mockClear()
    }
  })
  afterEach(() => {
    native().mockImplementation(actual.realpathSync.native)
    actual.rmSync(base, { recursive: true, force: true })
  })

  /** Answers a chosen real path for each listed input path; every other path is real. */
  const answerRealPaths = (answers: ReadonlyMap<string, string>) =>
    native().mockImplementation(
      ((path: fs.PathLike) =>
        answers.get(String(path)) ??
        actual.realpathSync.native(path)) as typeof fs.realpathSync.native,
    )
  const verdictOf = (result: ReturnType<typeof checkedReportDir>) =>
    result.ok ? 'ok' : result.reason

  it('T15A-8 the real-path half: drive-letter or single-slash real paths only, at or under public/ or app/ refused, and the checked dir is branded (A23, CRIT-3, CRIT-4, CRIT-13, L24)', () => {
    const site: ReportSite = { storyboardRoot: sbRoot, platform: process.platform }
    const pre = checkedReportDir(join(base, 'r'), site)
    expect(pre.ok && pre.realDir, 'precondition: <tmp>/r is checked to its real path').toBe(
      join(actual.realpathSync.native(base), 'r'),
    )
    for (const path of [
      '\\\\server\\share\\x',
      '\\\\?\\Volume{0}\\x',
      '\\\\?\\C:\\x',
      '\\\\.\\C:\\x',
      'Volume{0}\\x',
      'C:x',
      'x',
      '//x',
      '',
    ]) {
      expect.soft(isLocalRealPath(path), `(g1) not local: ${JSON.stringify(path)}`).toBe(false)
    }
    for (const path of ['C:\\x', 'c:\\x', '/x', '/']) {
      expect.soft(isLocalRealPath(path), `(g1) local: ${path}`).toBe(true)
    }
    // The predicate takes no platform: Linux CI checks a `/x` real path with platform win32
    // injected; a win32 host checks its `X:\` real path with platform linux injected.
    const otherPlatform = process.platform === 'win32' ? 'linux' : 'win32'
    expect
      .soft(
        verdictOf(checkedReportDir(join(base, 'r'), { ...site, platform: otherPlatform })),
        `(g1) the host's real path is local with platform ${otherPlatform} injected`,
      )
      .toBe('ok')

    const win32: ReportSite = { ...site, platform: 'win32' }
    const mapped = 'Z:\\sb\\migration-input\\reports'
    const subst = 'Z:\\public'
    const volume = join(base, 'vol', 'r')
    answerRealPaths(
      new Map([
        [resolve(mapped), '\\\\server\\share\\sb\\migration-input\\reports'],
        [resolve(subst), join(actual.realpathSync.native(sbRoot), 'public').toUpperCase()],
        [resolve(volume), '\\\\?\\Volume{0}\\r'],
      ]),
    )
    expect.soft(verdictOf(checkedReportDir(mapped, site)), '(g2) a mapped drive').toBe('not-local')
    expect.soft(verdictOf(checkedReportDir(subst, win32)), '(g2) a subst drive').toBe('in-site')
    expect.soft(verdictOf(checkedReportDir(volume, site)), '(g2) a volume GUID').toBe('not-local')
    answerRealPaths(
      new Map([
        [resolve(join(sbRoot, 'public')), '\\\\localhost\\d$\\sb\\public'],
        [resolve(join(sbRoot, 'app')), '\\\\localhost\\d$\\sb\\app'],
      ]),
    )
    expect
      .soft(
        verdictOf(checkedReportDir(join(base, 'r'), site)),
        '(g2) a checkout opened through a share',
      )
      .toBe('site-not-local')
    native().mockImplementation(actual.realpathSync.native)

    const junction = join(base, 'j')
    fs.symlinkSync(join(sbRoot, 'public'), junction, 'junction')
    const longTail = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(80)]
    const longInSite = join(sbRoot, 'public', ...longTail)
    const longOutside = join(base, ...longTail)
    fs.mkdirSync(longInSite, { recursive: true })
    fs.mkdirSync(longOutside, { recursive: true })
    expect(
      longOutside.length,
      'precondition: the long path is over 260 characters',
    ).toBeGreaterThan(260)
    const real: [string, string, string][] = [
      ['<root>/public (present)', join(sbRoot, 'public'), 'in-site'],
      ['<root>/app/new (absent)', join(sbRoot, 'app', 'new'), 'in-site'],
      ['<tmp>/j/x with <tmp>/j a junction to public', join(junction, 'x'), 'in-site'],
      ['a long path under public', longInSite, 'in-site'],
      ['a long path under <tmp>', longOutside, 'ok'],
    ]
    for (const [id, dir, want] of real) {
      expect.soft(verdictOf(checkedReportDir(dir, site)), `(g3) ${id}`).toBe(want)
    }
    const long = checkedReportDir(longOutside, site)
    expect
      .soft(
        long.ok && /^(?:[A-Za-z]:\\|\/(?!\/))/.test(long.realDir),
        '(g3) the long path has a drive-letter (or single-slash) real dir',
      )
      .toBe(true)

    const dotless = join(actual.realpathSync.native(sbRoot), 'publ\u0131c')
    answerRealPaths(new Map([[resolve(dotless), dotless]]))
    expect
      .soft(verdictOf(checkedReportDir(dotless, win32)), '(g4) <root>/publ\u0131c by the fold')
      .toBe('in-site')
    native().mockImplementation(actual.realpathSync.native)

    console.log(
      process.platform === 'win32'
        ? 'skipped: a symlink to an administrative share is not creatable here (S8)'
        : 'skipped: UNC paths need a win32 host',
    )
    expect
      .soft(typeof brandSamples, '(g6) the type-only brand sample is compiled, never called')
      .toBe('function')
  })

  it('T15A-9 writeReport re-checks after mkdir and before each rename; a stale temp entry is removed, then the temp is created exclusively; failures are results (A23, D15-22, CRIT-13, PB3)', () => {
    let n = 0
    /** A fresh storyboard root with public/ and a checked `<case>/out/reports`. */
    const writerCase = () => {
      const caseRoot = join(base, `case-${++n}`)
      const sb = join(caseRoot, 'sb')
      const out = join(caseRoot, 'out')
      fs.mkdirSync(join(sb, 'public'), { recursive: true })
      fs.mkdirSync(join(out, 'reports'), { recursive: true })
      const site: ReportSite = { storyboardRoot: sb, platform: process.platform }
      const checked = checkedReportDir(join(out, 'reports'), site)
      if (!checked.ok) throw new Error('test setup: the report dir is checked')
      return { caseRoot, out, site, dir: checked.realDir, publicDir: join(sb, 'public') }
    }
    const names = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [])
    const publisherFilesUnder = (dir: string): string[] =>
      (actual.readdirSync(dir, { recursive: true }) as string[]).filter((name) =>
        name.split(/[\\/]/).some((part) => part.startsWith('publisher-')),
      )
    const REPORT_FILES = ['publisher-publish.json', 'publisher-publish.md']
    const TEMP = 'publisher-publish.json.tmp'

    const pre = writerCase()
    expect(
      vi.isMockFunction(fs.writeFileSync) && fs.existsSync(pre.publicDir) && pre.dir.length > 0,
      'precondition: node:fs wrapped, a storyboard root with public/ and a checked dir',
    ).toBe(true)

    const g1 = writerCase()
    fs.writeFileSync(join(g1.dir, TEMP), 'stale')
    expect
      .soft(writeReport(g1.dir, PUBLISH_INPUT, g1.site), '(g1) a stale temp file')
      .toEqual({ ok: true })
    expect.soft(names(g1.dir), '(g1) removed, report written').toEqual(REPORT_FILES)

    const g2 = writerCase()
    const outside2 = join(g2.caseRoot, 'outside')
    fs.mkdirSync(outside2)
    fs.writeFileSync(join(outside2, 'keep.txt'), 'keep')
    fs.symlinkSync(outside2, join(g2.dir, TEMP), 'junction')
    expect
      .soft(writeReport(g2.dir, PUBLISH_INPUT, g2.site), '(g2) a junction at the temp name')
      .toEqual({
        ok: true,
      })
    expect.soft(names(outside2), '(g2) its target keeps keep.txt').toEqual(['keep.txt'])
    expect.soft(names(g2.dir), '(g2) the link removed, report written').toEqual(REPORT_FILES)

    const g3 = writerCase()
    fs.mkdirSync(join(g3.dir, TEMP))
    fs.writeFileSync(join(g3.dir, TEMP, 'keep.txt'), 'keep')
    expect
      .soft(writeReport(g3.dir, PUBLISH_INPUT, g3.site), '(g3) a directory at the temp name')
      .toEqual({ ok: false, code: 'report-unwritten', refused: null })
    expect
      .soft(names(join(g3.dir, TEMP)), '(g3) the directory and keep.txt remain')
      .toEqual(['keep.txt'])

    const g4 = writerCase()
    vi.mocked(fs.renameSync).mockClear()
    vi.mocked(fs.writeFileSync).mockImplementationOnce(((
      file: fs.PathOrFileDescriptor,
      data: string,
      options?: fs.WriteFileOptions,
    ) => {
      actual.writeFileSync(file, data, options)
      actual.renameSync(join(g4.out, 'reports'), join(g4.out, 'reports-away'))
      actual.symlinkSync(g4.publicDir, join(g4.out, 'reports'), 'junction')
    }) as typeof fs.writeFileSync)
    expect
      .soft(
        writeReport(g4.dir, PUBLISH_INPUT, g4.site),
        '(g4) the real dir retargeted inside the first temp write',
      )
      .toEqual({ ok: false, code: 'report-unwritten', refused: 'in-site' })
    expect
      .soft(publisherFilesUnder(g4.publicDir), '(g4) no publisher-* name under public')
      .toEqual([])
    expect.soft(vi.mocked(fs.renameSync).mock.calls.length, '(g4) no rename was made').toBe(0)

    const g5 = writerCase()
    fs.renameSync(g5.out, `${g5.out}-away`)
    fs.symlinkSync(g5.publicDir, g5.out, 'junction')
    vi.mocked(fs.writeFileSync).mockClear()
    expect
      .soft(
        writeReport(g5.dir, PUBLISH_INPUT, g5.site),
        '(g5) <tmp>/out replaced by a junction to public',
      )
      .toEqual({ ok: false, code: 'report-unwritten', refused: 'in-site' })
    expect
      .soft(
        vi.mocked(fs.writeFileSync).mock.calls.length,
        '(g5) refused after the mkdir: no temp written',
      )
      .toBe(0)
    expect
      .soft(publisherFilesUnder(g5.publicDir), '(g5) no publisher-* file under public')
      .toEqual([])

    const g6 = writerCase()
    vi.mocked(fs.rmSync).mockImplementationOnce(((path: fs.PathLike, options?: fs.RmOptions) => {
      actual.rmSync(path, options)
      actual.writeFileSync(path, 'planted')
    }) as typeof fs.rmSync)
    expect
      .soft(writeReport(g6.dir, PUBLISH_INPUT, g6.site), '(g6) an entry planted after the removal')
      .toEqual({ ok: false, code: 'report-unwritten', refused: null })
    expect
      .soft(
        fs.readFileSync(join(g6.dir, TEMP), 'utf8'),
        '(g6) the planted file still reads planted',
      )
      .toBe('planted')

    const g7 = writerCase()
    const outside7 = join(g7.caseRoot, 'outside')
    fs.mkdirSync(outside7)
    fs.writeFileSync(join(outside7, 'target.txt'), 'original')
    fs.linkSync(join(outside7, 'target.txt'), join(g7.dir, 'publisher-publish.json'))
    expect
      .soft(writeReport(g7.dir, PUBLISH_INPUT, g7.site), '(g7) a hard link at the final name')
      .toEqual({
        ok: true,
      })
    expect
      .soft(fs.readFileSync(join(outside7, 'target.txt'), 'utf8'), '(g7) the link target unchanged')
      .toBe('original')
    expect
      .soft(
        fs.readFileSync(join(g7.dir, 'publisher-publish.json'), 'utf8').startsWith('{'),
        '(g7) replaced',
      )
      .toBe(true)

    for (const [id, input, want] of [
      ['approve', APPROVE_INPUT, ['publisher-approve.json', 'publisher-approve.md']],
      ['approve dry run', APPROVE_DRY, ['publisher-approve.json', 'publisher-approve.md']],
      ['publish', PUBLISH_INPUT, REPORT_FILES],
      ['publish dry run', PUBLISH_DRY, REPORT_FILES],
    ] as const) {
      const g8 = writerCase()
      writeReport(g8.dir, input, g8.site)
      expect.soft(names(g8.dir), `(g8) names: ${id}`).toEqual([...want])
    }

    for (const [group, call] of [
      ['g9', 1],
      ['g10', 2],
    ] as const) {
      const c = writerCase()
      let seen = 0
      native().mockImplementation(((path: fs.PathLike) => {
        if (String(path) === resolve(c.dir) && ++seen === call) return '\\\\server\\share\\r'
        return actual.realpathSync.native(path)
      }) as typeof fs.realpathSync.native)
      const result = writeReport(c.dir, PUBLISH_INPUT, c.site)
      native().mockImplementation(actual.realpathSync.native)
      const label = call === 1 ? 'the post-mkdir call' : 'the pre-rename call'
      expect
        .soft(result, `(${group}) a UNC answer for the real dir on ${label}`)
        .toEqual({ ok: false, code: 'report-unwritten', refused: 'not-local' })
      expect
        .soft(
          names(c.dir).filter((name) => name.startsWith('publisher-')),
          `(${group}) no publisher-* name written or left`,
        )
        .toEqual([])
    }
  })
})

// ---- Step 15b ----

const UNPUBLISH_SECTION = {
  storyId: 'two-paths',
  inProduction: true,
  inStaging: true,
  productionMove: 'moved',
  stagingMove: 'moved',
} as const
const TAKEDOWN_SECTION = {
  storyId: 'two-paths',
  packages: 1,
  media: 3,
  mp3: 1,
  mp3Unproven: 0,
  images: 2,
  removed: 4,
  kept: 0,
  state: 'removed',
} as const
const CHECKS_SECTION = { range: 'ok', rollbackFlag: 'none' } as const
const UNPUBLISH_INPUT = {
  ...PUBLISH_INPUT,
  // Not taken-down: the precondition must hold under MU15B-366 (taken-down dropped), so that
  // mutant reaches g1.
  outcome: 'unpublished',
  publish: {
    ...PUBLISH_SECTION,
    kind: 'unpublish',
    featuredAfter: null,
    named: [],
    stories: [
      { storyId: 'river-stones', packageSha256: SHA2, approvalSha256: SHA, source: 'production' },
    ],
  },
  unpublish: UNPUBLISH_SECTION,
  takedown: TAKEDOWN_SECTION,
  checks: CHECKS_SECTION,
} as const satisfies ReportInput
const VERIFY_SECTION = {
  expectedSeq: 2,
  outcome: 'live',
  liveSeq: 2,
  rollbackFlag: 'none',
  snapshot: 'match',
  landing: { checked: 4, failed: 0, gated: false },
  media: { checked: 4, failed: 0, skipped: 0 },
  excluded: [{ storyId: 'lantern-walk', version: 1, reason: 'approval-missing' }],
  range: 'ok',
  deep: null,
} as const
const VERIFY_INPUT = {
  command: 'verify',
  mode: 'verify',
  startedAt: '2026-11-22T12:00:00.000Z',
  finishedAt: '2026-11-22T12:00:30.000Z',
  outcome: 'verified',
  exitCode: 0,
  writes: 0,
  uploaded: [],
  skipped: [],
  orphans: [],
  superseded: [],
  ruleSetRef: PANCHATANTRA_RULESET.ref,
  privateWordLists: 'not loaded',
  stories: [],
  verify: VERIFY_SECTION,
} as const satisfies ReportInput

describe('report: Step 15b codes, formatters and sections', () => {
  it('T15B-3 publish-side formatters: the unpublish, staging, takedown, range, recovery and rollback lines exactly; every field validated (A23, D15B-24, §4.8, TP-6, CRIT-16)', () => {
    expect(
      typeof formatUnpublishPlan({
        storyId: 'two-paths',
        production: 'remove',
        staging: 'absent',
      }),
      'precondition: one sample per formatter formats',
    ).toBe('string')
    const unpublishPlan = {
      kind: 'unpublish',
      seq: 3,
      stories: 1,
      production: 2,
      staging: 1,
      featured: null,
      from: null,
    } as const
    const takedownPlan = {
      storyId: 'two-paths',
      packages: 1,
      media: 3,
      mp3: 1,
      mp3Unproven: 0,
      images: 2,
    } as const
    const range = { seq: 3, start: 2048, end: 3071, size: 4096, sha256: SHA } as const
    const pinned: [string, () => unknown, string][] = [
      [
        'unpublish plan',
        () =>
          formatUnpublishPlan({ storyId: 'two-paths', production: 'remove', staging: 'absent' }),
        'publish: unpublish two-paths production=remove staging=absent',
      ],
      [
        'plan kind=unpublish',
        () => formatPublishPlan(unpublishPlan),
        'publish: plan kind=unpublish seq=3 stories=1 production=2 staging=1 featured=none from=none',
      ],
      [
        'plan kind=unpublish seq=none',
        () => formatPublishPlan({ ...unpublishPlan, seq: null }),
        'publish: plan kind=unpublish seq=none stories=1 production=2 staging=1 featured=none from=none',
      ],
      [
        'staging moved',
        () => formatStagingMoved(3),
        'publish: staging pointer seq=3 moved (read back, post-check clean)',
      ],
      [
        'staging not moved',
        () => formatStagingNotMoved('concurrent-writer'),
        'publish: staging pointer not moved: concurrent-writer',
      ],
      [
        'unpublish recovery',
        () => formatUnpublishRecovery('two-paths', false),
        'publish: recovery: publish --unpublish two-paths re-runs the remaining steps',
      ],
      [
        'unpublish recovery with --takedown',
        () => formatUnpublishRecovery('two-paths', true),
        'publish: recovery: publish --unpublish two-paths --takedown re-runs the remaining steps',
      ],
      [
        'RANGE_RECOVERY',
        () => RANGE_RECOVERY,
        'publish: recovery: verify re-checks the live site and one Range answer (no write)',
      ],
      [
        'takedown plan',
        () => formatTakedownPlan(takedownPlan),
        'publish: takedown two-paths plan packages=1 media=3 mp3=1 mp3-unproven=0 images=2 (hash list checked)',
      ],
      [
        'takedown removed',
        () => formatTakedownRemoved({ storyId: 'two-paths', removed: 100, total: 250 }),
        'publish: takedown two-paths removed 100/250',
      ],
      [
        'takedown done, kept 0',
        () => formatTakedownDone({ storyId: 'two-paths', removed: 4, kept: 0 }),
        'publish: takedown two-paths done removed=4 (re-list empty)',
      ],
      [
        'takedown done, kept 1',
        () => formatTakedownDone({ storyId: 'two-paths', removed: 4, kept: 1 }),
        'publish: takedown two-paths done removed=4 kept=1 (re-list shows only the kept MP3s)',
      ],
      [
        'TAKEDOWN_LAG_NOTE',
        () => TAKEDOWN_LAG_NOTE,
        'publish: takedown: deleted objects can stay readable for a while: the CDN stopped serving deleted probes 3-65 s after the delete (S-1), and a browser may keep a copy for up to 3600 s (spec §8)',
      ],
      [
        'mp3 kept',
        () => formatMp3Kept({ storyId: 'two-paths', kept: 1 }),
        'publish: takedown two-paths: 1 MP3 object(s) kept: restore each file under migration-input/audio/two-paths/ and its line in SHA256SUMS.txt, then re-run; or back the object up and remove it by hand',
      ],
      [
        'unpublish unknown',
        () => formatUnpublishUnknown('two-paths'),
        'publish: unpublish two-paths: no pointer, package or media object names it',
      ],
      [
        'no rollback',
        () => formatNoRollback(3, 'two-paths'),
        'publish: do not use Vercel Instant Rollback past the deployment of seq 3: the previous deployment still serves two-paths',
      ],
      [
        'range ok',
        () => formatRangeOk('publish', range),
        'publish: range check ok seq=3 bytes=2048-3071/4096 object=0123456789ab',
      ],
      [
        'range skipped',
        () => formatRangeSkipped('publish', 3),
        'publish: range check skipped: no MP3 in seq 3',
      ],
      [
        'range failed',
        () => formatRangeFailed('publish', 'content-range', SHA),
        'publish: range check failed reason=content-range object=0123456789ab',
      ],
      [
        'older than before',
        () => formatOlderThanBefore('publish', 1, 2),
        "publish: live seq=1 is below seq=2, production's seq before this run: a Vercel Instant Rollback is the likely cause; Undo Rollback in Vercel, then re-run",
      ],
      [
        'older live',
        () => formatOlderLive('publish', 2, 3),
        'publish: live seq=2 is below seq=3: production serves an older deployment (a Vercel Instant Rollback stays in force until Undo Rollback; or a build failed or is still running)',
      ],
    ]
    for (const [id, run, want] of pinned) {
      let got: unknown
      try {
        got = run()
      } catch (error) {
        got = `threw ${String(error)}`
      }
      expect.soft(got, `(g1) ${id}`).toBe(want)
    }

    const refused: [string, () => unknown][] = [
      [
        'storyId Lion (unpublish plan)',
        () => formatUnpublishPlan({ storyId: 'Lion', production: 'remove', staging: 'absent' }),
      ],
      [
        "production word 'kept' (unpublish plan)",
        () =>
          formatUnpublishPlan({
            storyId: 'two-paths',
            production: 'kept' as 'remove',
            staging: 'absent',
          }),
      ],
      ['storyId Lion (no rollback)', () => formatNoRollback(3, 'Lion')],
      ['storyId two-paths+U+D800 (no rollback)', () => formatNoRollback(3, 'two-paths\uD800')],
      [
        'storyId two-paths+U+D800 (takedown plan)',
        () => formatTakedownPlan({ ...takedownPlan, storyId: 'two-paths\uD800' }),
      ],
      ['storyId Lion (recovery)', () => formatUnpublishRecovery('Lion', false)],
      ['storyId Lion (unknown)', () => formatUnpublishUnknown('Lion')],
      ['seq 0 (staging moved)', () => formatStagingMoved(0)],
      ['seq 0 (no rollback)', () => formatNoRollback(0, 'two-paths')],
      ['seq 0 (range skipped)', () => formatRangeSkipped('publish', 0)],
      ['seq 0 (range ok)', () => formatRangeOk('publish', { ...range, seq: 0 })],
      ['count -1 (takedown plan)', () => formatTakedownPlan({ ...takedownPlan, packages: -1 })],
      ['count 1.5 (takedown plan)', () => formatTakedownPlan({ ...takedownPlan, mp3: 1.5 })],
      ['count NaN (takedown plan)', () => formatTakedownPlan({ ...takedownPlan, images: NaN })],
      [
        'count 1.5 (takedown removed)',
        () => formatTakedownRemoved({ storyId: 'two-paths', removed: 1.5, total: 2 }),
      ],
      [
        'count -1 (takedown done)',
        () => formatTakedownDone({ storyId: 'two-paths', removed: -1, kept: 0 }),
      ],
      ['kept 0 (mp3 kept needs k >= 1)', () => formatMp3Kept({ storyId: 'two-paths', kept: 0 })],
      [
        'removed > total',
        () => formatTakedownRemoved({ storyId: 'two-paths', removed: 251, total: 250 }),
      ],
      ['MoveCode bogus', () => formatStagingNotMoved('bogus')],
      ['range reason maybe', () => formatRangeFailed('publish', 'maybe', SHA)],
      ['sha x (range failed)', () => formatRangeFailed('publish', 'status', 'x')],
      ['sha x (range ok)', () => formatRangeOk('publish', { ...range, sha256: 'x' })],
      ['range start 1.5', () => formatRangeOk('publish', { ...range, start: 1.5 })],
      ['command stage (range ok)', () => formatRangeOk('stage' as 'publish', range)],
      ['command stage (range skipped)', () => formatRangeSkipped('stage' as 'publish', 3)],
      [
        'command verify (older than before: no before in verify)',
        () => formatOlderThanBefore('verify' as 'publish', 1, 2),
      ],
      ['seq 0 (older live)', () => formatOlderLive('publish', 0, 3)],
    ]
    for (const [id, run] of refused) {
      expect.soft(throwsTypeError(run), `(g2) TypeError: ${id}`).toBe(true)
    }

    for (const code of [
      'takedown-still-named',
      'takedown-raced',
      'takedown-incomplete',
      'takedown-check-failed',
      'takedown-not-on-this-pc',
      'takedown-unknown-object',
      'takedown-mp3-kept',
      'staging-not-moved',
      'unpublish-story-unknown',
    ]) {
      let line = ''
      try {
        line = formatStopped('publish', code, { storyId: 'two-paths' })
      } catch (error) {
        line = `threw ${String(error)}`
      }
      expect
        .soft(line, `(g3) the stop names the id: ${code}`)
        .toBe(`publish: stopped: ${code} two-paths`)
    }
    expect
      .soft(
        throwsTypeError(() => formatStopped('publish', 'unpublished')),
        '(g3) an exit-0 code is no stop: unpublished',
      )
      .toBe(true)
  })

  it('T15B-4 verify-side formatters: the §4.8 and TP-11 lines exactly; command verify accepted; every field validated (A23, D15B-19, TP-11)', () => {
    expect(typeof formatVerifyExpected(2), 'precondition: one sample per formatter formats').toBe(
      'string',
    )
    const pinned: [string, () => unknown, string][] = [
      ['expected', () => formatVerifyExpected(2), 'verify: expected seq=2 (production pointer)'],
      [
        'snapshot match',
        () => formatSnapshotMatch(2, SHA),
        'verify: live build seq=2 loaded snapshot sha256=0123456789ab (matches the production pointer)',
      ],
      [
        'landing failed',
        () =>
          formatLandingFailed({
            storyId: 'two-paths',
            locale: 'hi',
            reason: 'status',
            status: 404,
          }),
        'verify: landing two-paths hi failed reason=status status=404',
      ],
      [
        'landing failed, no status',
        () =>
          formatLandingFailed({
            storyId: 'two-paths',
            locale: 'en',
            reason: 'network',
            status: null,
          }),
        'verify: landing two-paths en failed reason=network status=-',
      ],
      [
        'landing summary',
        () => formatLandingSummary({ checked: 6, failed: 1 }),
        'verify: landing checked=6 failed=1',
      ],
      [
        'media failed',
        () =>
          formatMediaFailed({ storyId: 'two-paths', kind: 'mp3', reason: 'length', status: 200 }),
        'verify: media two-paths mp3 failed reason=length status=200',
      ],
      [
        'media summary',
        () => formatMediaSummary({ checked: 4, failed: 0, skipped: 1 }),
        'verify: media checked=4 failed=0 skipped=1',
      ],
      [
        'excluded',
        () => formatExcluded({ storyId: 'lantern-walk', version: 1, reason: 'approval-missing' }),
        'verify: excluded lantern-walk version=1 reason=approval-missing',
      ],
      ['excluded count', () => formatExcludedCount(1), 'verify: excluded=1'],
      [
        'deep plan',
        () => formatDeepPlan({ objects: 120, bytes: 230000000, approvals: 11, waivers: 3 }),
        'verify: deep plan objects=120 bytes=230000000 approvals=11 waivers=3 (Supabase egress; spec §8: at most monthly, and after a suspected key leak)',
      ],
      [
        'deep mismatch',
        () =>
          formatDeepMismatch({ kind: 'waiver', storyId: 'two-paths', sha256: SHA, reason: 'hash' }),
        'verify: deep mismatch waiver two-paths 0123456789ab reason=hash',
      ],
      [
        'deep summary',
        () => formatDeepSummary({ checked: 12, mismatches: 1 }),
        'verify: deep checked=12 mismatches=1',
      ],
    ]
    for (const [id, run, want] of pinned) {
      let got: unknown
      try {
        got = run()
      } catch (error) {
        got = `threw ${String(error)}`
      }
      expect.soft(got, `(g1) ${id}`).toBe(want)
    }

    const landing = { storyId: 'two-paths', locale: 'en', reason: 'status', status: 404 } as const
    const refused: [string, () => unknown][] = [
      [
        'deep kind snapshot',
        () =>
          formatDeepMismatch({
            kind: 'snapshot' as 'waiver',
            storyId: 'two-paths',
            sha256: SHA,
            reason: 'hash',
          }),
      ],
      ['landing locale fr', () => formatLandingFailed({ ...landing, locale: 'fr' as 'en' })],
      ['landing locale ar', () => formatLandingFailed({ ...landing, locale: 'ar' as 'en' })],
      ['status 1.5', () => formatLandingFailed({ ...landing, status: 1.5 })],
      [
        'reason whatever',
        () => formatLandingFailed({ ...landing, reason: 'whatever' as 'status' }),
      ],
      [
        'excluded reason other',
        () =>
          formatExcluded({
            storyId: 'lantern-walk',
            version: 1,
            reason: 'other' as 'approval-missing',
          }),
      ],
    ]
    for (const [id, run] of refused) {
      expect.soft(throwsTypeError(run), `(g2) TypeError: ${id}`).toBe(true)
    }

    const safe = (run: () => string): string => {
      try {
        return run()
      } catch (error) {
        return `threw ${String(error)}`
      }
    }
    expect
      .soft(
        safe(() => formatStopped('verify', 'site-gated')),
        '(g3) a verify stop',
      )
      .toBe('verify: stopped: site-gated')
    expect
      .soft(
        safe(() => formatVerifyTimeoutHint('verify')),
        '(g3) the verify hint is the publish hint with the verify: prefix',
      )
      .toBe(VERIFY_TIMEOUT_HINT.replace(/^publish:/, 'verify:'))
    expect
      .soft(
        safe(() => formatOlderLive('verify', 1, 2)).startsWith(
          'verify: live seq=1 is below seq=2:',
        ),
        '(g3) the older-live line for verify',
      )
      .toBe(true)
    expect
      .soft(
        safe(() =>
          formatRangeOk('verify', { seq: 2, start: 0, end: 0, size: 1, sha256: SHA }),
        ).startsWith('verify: range check ok'),
        '(g3) the range line for verify',
      )
      .toBe(true)
  })

  it("T15B-5 exits, phases and report sections: the new codes at their phases, publish's optional sections, the verify report, its file name, and absent sections staying absent (A22, D15B-23, TP-6)", () => {
    const built = (input: ReportInput) => {
      try {
        return buildReport(input)
      } catch {
        return null
      }
    }
    expect(
      built(UNPUBLISH_INPUT) !== null && built(VERIFY_INPUT) !== null,
      'precondition: a publish input with unpublish, takedown and checks builds, and a verify one',
    ).toBe(true)

    const exitOf = (code: string, phase: string) => {
      try {
        return exitForPhase(code, phase as Parameters<typeof exitForPhase>[1])
      } catch (error) {
        return error instanceof TypeError ? 'TypeError' : 'other'
      }
    }
    const phases: [string, string, unknown][] = [
      ['takedown-raced', 'takedown', 4],
      ['takedown-incomplete', 'takedown', 4],
      ['takedown-mp3-kept', 'takedown', 4],
      ['takedown-not-on-this-pc', 'plan', 1],
      ['takedown-not-on-this-pc', 'takedown', 4],
      ['takedown-check-failed', 'plan', 1],
      ['takedown-check-failed', 'takedown', 4],
      ['takedown-unknown-object', 'plan', 1],
      ['takedown-unknown-object', 'takedown', 4],
      ['range-check-failed', 'plan', 1],
      ['range-check-failed', 'tail', 4],
      ['verify-timeout', 'plan', 1],
      ['verify-timeout', 'tail', 4],
      ['takedown-here-only', 'configuration', 2],
      ['unpublish-story-unknown', 'plan', 1],
      ['staging-not-moved', 'pointer', 4],
      ['unpublished', 'end', 0],
      ['taken-down', 'end', 0],
      ['verified', 'end', 0],
      ['takedown-raced', 'plan', 'TypeError'],
      ['unpublished', 'takedown', 'TypeError'],
    ]
    for (const [code, phase, want] of phases) {
      expect.soft(exitOf(code, phase), `(g1) ${code} at ${phase}`).toBe(want)
    }

    const publish = JSON.parse(built(UNPUBLISH_INPUT)?.json ?? '{}') as Record<string, unknown>
    const keysOf = (value: unknown) => Object.keys((value ?? {}) as object).sort()
    expect
      .soft(keysOf(publish.unpublish), '(g2) unpublish keys exact')
      .toEqual(['inProduction', 'inStaging', 'productionMove', 'stagingMove', 'storyId'])
    expect
      .soft(keysOf(publish.takedown), '(g2) takedown keys exact')
      .toEqual(
        [
          'storyId',
          'packages',
          'media',
          'mp3',
          'mp3Unproven',
          'images',
          'removed',
          'kept',
          'state',
        ].sort(),
      )
    expect.soft(keysOf(publish.checks), '(g2) checks keys exact').toEqual(['range', 'rollbackFlag'])
    for (const state of [
      'planned',
      'removed',
      'mp3-kept',
      'incomplete',
      'raced',
      'still-named',
      'check-failed',
      'not-on-this-pc',
      'unknown-object',
      'not-run',
    ] as const) {
      expect
        .soft(
          built({ ...UNPUBLISH_INPUT, takedown: { ...TAKEDOWN_SECTION, state } }) !== null,
          `(g2) takedown state accepted: ${state}`,
        )
        .toBe(true)
    }
    const refusedPublish: [string, () => unknown][] = [
      [
        'a takedown section on stage',
        () => buildReport({ ...STAGE_INPUT, takedown: TAKEDOWN_SECTION }),
      ],
      [
        'a verify section on publish',
        () => buildReport({ ...PUBLISH_INPUT, verify: VERIFY_SECTION }),
      ],
      ...(
        [
          ['validate', VALIDATE_INPUT],
          ['approve', APPROVE_INPUT],
        ] as const
      ).flatMap(([name, input]): [string, () => unknown][] => [
        [
          `an unpublish section on ${name}`,
          () => buildReport({ ...input, unpublish: UNPUBLISH_SECTION }),
        ],
        [
          `a takedown section on ${name}`,
          () => buildReport({ ...input, takedown: TAKEDOWN_SECTION }),
        ],
        [`a checks section on ${name}`, () => buildReport({ ...input, checks: CHECKS_SECTION })],
      ]),
      [
        "checks.range 'maybe'",
        () =>
          buildReport({
            ...UNPUBLISH_INPUT,
            checks: { ...CHECKS_SECTION, range: 'maybe' as 'ok' },
          }),
      ],
      [
        "checks.rollbackFlag 'yes'",
        () =>
          buildReport({
            ...UNPUBLISH_INPUT,
            checks: { ...CHECKS_SECTION, rollbackFlag: 'yes' as 'none' },
          }),
      ],
      [
        "unpublish.storyId 'Lion'",
        () =>
          buildReport({ ...UNPUBLISH_INPUT, unpublish: { ...UNPUBLISH_SECTION, storyId: 'Lion' } }),
      ],
      [
        "unpublish.stagingMove 'skipped'",
        () =>
          buildReport({
            ...UNPUBLISH_INPUT,
            unpublish: { ...UNPUBLISH_SECTION, stagingMove: 'skipped' as 'moved' },
          }),
      ],
      [
        "takedown.state 'gone'",
        () =>
          buildReport({
            ...UNPUBLISH_INPUT,
            takedown: { ...TAKEDOWN_SECTION, state: 'gone' as 'removed' },
          }),
      ],
      [
        'takedown.kept -1',
        () => buildReport({ ...UNPUBLISH_INPUT, takedown: { ...TAKEDOWN_SECTION, kept: -1 } }),
      ],
      [
        'an extra takedown.paths',
        () =>
          buildReport({
            ...UNPUBLISH_INPUT,
            takedown: { ...TAKEDOWN_SECTION, paths: ['media/x'] } as typeof TAKEDOWN_SECTION,
          }),
      ],
    ]
    for (const [id, run] of refusedPublish) {
      expect.soft(throwsTypeError(run), `(g2) TypeError: ${id}`).toBe(true)
    }

    const verify = JSON.parse(built(VERIFY_INPUT)?.json ?? '{}') as Record<string, unknown>
    expect
      .soft(
        [
          verify.command,
          verify.mode,
          verify.writes,
          verify.stories,
          verify.uploaded,
          verify.skipped,
          verify.superseded,
          verify.privateWordLists,
        ],
        '(g3) the verify report: command, mode, writes, the empty lists and privateWordLists',
      )
      .toEqual(['verify', 'verify', 0, [], [], [], [], 'not loaded'])
    expect
      .soft(keysOf(verify.verify), '(g3) the verify section keys exact')
      .toEqual(
        [
          'expectedSeq',
          'outcome',
          'liveSeq',
          'rollbackFlag',
          'snapshot',
          'landing',
          'media',
          'excluded',
          'range',
          'deep',
        ].sort(),
      )
    const refusedVerify: [string, () => unknown][] = [
      ['writes 1', () => buildReport({ ...VERIFY_INPUT, writes: 1 })],
      ['mode publish', () => buildReport({ ...VERIFY_INPUT, mode: 'publish' })],
      [
        'verify.deep.objects -1',
        () =>
          buildReport({
            ...VERIFY_INPUT,
            verify: {
              ...VERIFY_SECTION,
              deep: { objects: -1, bytes: 0, approvals: 0, waivers: 0, checked: 0, mismatches: 0 },
            },
          }),
      ],
      [
        "verify.outcome 'unknown'",
        () =>
          buildReport({
            ...VERIFY_INPUT,
            verify: { ...VERIFY_SECTION, outcome: 'unknown' as 'live' },
          }),
      ],
      [
        "an excluded reason 'other'",
        () =>
          buildReport({
            ...VERIFY_INPUT,
            verify: {
              ...VERIFY_SECTION,
              excluded: [
                { storyId: 'lantern-walk', version: 1, reason: 'other' as 'approval-missing' },
              ],
            },
          }),
      ],
    ]
    for (const [id, run] of refusedVerify) {
      expect.soft(throwsTypeError(run), `(g3) TypeError: ${id}`).toBe(true)
    }

    const root = fs.mkdtempSync(join(tmpdir(), 's15b-rp-'))
    try {
      const site = { storyboardRoot: join(root, 'sb'), platform: process.platform }
      const checked = checkedReportDir(join(root, 'reports'), site)
      const written = checked.ok ? writeReport(checked.realDir, VERIFY_INPUT, site) : null
      const dir = checked.ok ? checked.realDir : join(root, 'reports')
      const names = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
      expect
        .soft([written, names], '(g4) a verify report is publisher-verify.json and .md')
        .toEqual([{ ok: true }, ['publisher-verify.json', 'publisher-verify.md']])
      const md = names.includes('publisher-verify.md')
        ? fs.readFileSync(join(dir, 'publisher-verify.md'), 'utf8')
        : ''
      expect
        .soft(
          md.includes('| expectedSeq | 2 |') && md.includes('| outcome | verified |'),
          '(g4) the verify md names the expected seq and the outcome',
        )
        .toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
    const plain = JSON.parse(built(PUBLISH_INPUT)?.json ?? '{}') as Record<string, unknown>
    expect
      .soft(
        ['unpublish', 'takedown', 'checks'].filter((key) => key in plain),
        '(g4) a publish input without the three sections writes none of their keys',
      )
      .toEqual([])
  })
})
