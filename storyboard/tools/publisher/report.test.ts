// Step 14 (P1-8c) report.ts: the §5 code table, the §4.8 line formatters and the §4.9 report
// writer (design migration-input/p1-step14-design.md §4.8, §4.9, §5, D14-18; test plan §14.9:
// T14-68 to T14-70). vi.mock wraps each node:fs function the writer uses in a vi.fn around the real
// one. Every report is written under an OS temp folder. Titles start with their id; one
// expect.soft per claim, messages "(gN) <claim> <sample>"; preconditions are hard expects starting
// "precondition:".
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import {
  EXIT_BY_CODE,
  REVIEW_LINE,
  buildReport,
  exitForPhase,
  formatPlan,
  formatPointerMoved,
  formatReportDirRefused,
  formatReportUnwritten,
  formatSnapshot,
  formatStageCarried,
  formatStageStory,
  formatStopped,
  formatStoryMessage,
  formatValidateStory,
  formatValidateSummary,
  internalName,
  writeReport,
  type ReportInput,
} from './report'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    mkdirSync: vi.fn(real.mkdirSync),
    writeFileSync: vi.fn(real.writeFileSync),
    renameSync: vi.fn(real.renameSync),
    rmSync: vi.fn(real.rmSync),
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
      ['an unknown command (report dir)', () => formatReportDirRefused('publish' as 'stage')],
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
      ['an unknown command', () => formatStopped('publish' as 'stage', 'usage')],
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
    const dir = join(root, 'a', 'b', 'reports')
    expect
      .soft(writeReport(dir, VALIDATE_INPUT), '(g1) a missing nested report dir')
      .toEqual({ ok: true })
    expect
      .soft(fs.existsSync(join(dir, 'publisher-validate.json')), '(g1) the report dir was created')
      .toBe(true)

    vi.mocked(fs.renameSync).mockClear()
    const later = { ...VALIDATE_INPUT, finishedAt: '2026-11-21T11:11:11.000Z' }
    expect(writeReport(dir, later), 'precondition: the second write succeeds').toEqual({ ok: true })
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
        return writeReport(file, VALIDATE_INPUT)
      } catch {
        return 'threw'
      }
    })()
    expect
      .soft(asFile, '(g3) a report dir that is a file')
      .toEqual({ ok: false, code: 'report-unwritten' })
    const blockedDir = join(root, 'blocked')
    fs.mkdirSync(join(blockedDir, 'publisher-stage.json'), { recursive: true })
    const asFolder = (() => {
      try {
        return writeReport(blockedDir, STAGE_INPUT)
      } catch {
        return 'threw'
      }
    })()
    expect
      .soft(asFolder, '(g3) publisher-stage.json is a folder')
      .toEqual({ ok: false, code: 'report-unwritten' })

    const named: [string, ReportInput, string[]][] = [
      ['validate', VALIDATE_INPUT, ['publisher-validate.json', 'publisher-validate.md']],
      ['stage', STAGE_INPUT, ['publisher-stage.json', 'publisher-stage.md']],
      ['dry run', DRY_INPUT, ['publisher-stage.json', 'publisher-stage.md']],
    ]
    for (const [id, input, names] of named) {
      const target = join(root, `names-${id.replace(' ', '-')}`)
      writeReport(target, input)
      expect.soft(fs.readdirSync(target).sort(), `(g4) names: ${id}`).toEqual(names)
    }
  })
})
