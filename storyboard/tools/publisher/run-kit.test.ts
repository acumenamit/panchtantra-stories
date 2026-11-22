// Step 15a (P1-8d part a) run-kit.ts: the stop signal and lines moved from stage.ts, the waiver read
// codes, and the report dir's start check and end write (design migration-input/p1-step15a-design.md
// §2.1, §3.21, §3.22, D15-21, D15-22, D15-29; test plan §14.4: T15A-10, T15A-11 and T15A-70).
// vi.mock wraps node:fs as report.test.ts does (realpathSync.native included), so a sample can
// answer a chosen real path for one input path and call through for every other. Every report is
// written under an OS temp folder. Titles start with their id; one expect.soft per claim, messages
// "(gN) <claim> <sample>"; preconditions are hard expects starting "precondition:".
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import {
  checkedReportDir,
  formatReportDirNotLocal,
  formatReportDirRefused,
  formatSiteNotLocal,
  type CheckedReportDir,
  type ReportInput,
} from './report'
import {
  Stop,
  WAIVER_READ_CODE,
  failureCode,
  internalLine,
  openReportDir,
  stopLine,
  writeRunReport,
} from './run-kit'

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

const VALIDATE_INPUT = {
  command: 'validate',
  mode: 'validate',
  startedAt: '2026-11-22T10:00:00.000Z',
  finishedAt: '2026-11-22T10:00:01.000Z',
  outcome: 'ok',
  exitCode: 0,
  writes: 0,
  uploaded: [],
  skipped: [],
  orphans: [],
  superseded: [],
  ruleSetRef: PANCHATANTRA_RULESET.ref,
  privateWordLists: 'not loaded',
  stories: [],
} as const satisfies ReportInput
const STAGE_INPUT = {
  ...VALIDATE_INPUT,
  command: 'stage',
  mode: 'stage',
  outcome: 'unchanged',
  plan: null,
} as const satisfies ReportInput
const APPROVE_INPUT = {
  ...VALIDATE_INPUT,
  command: 'approve',
  mode: 'approve',
  outcome: 'approved',
  approval: null,
} as const satisfies ReportInput
const PUBLISH_INPUT = {
  ...VALIDATE_INPUT,
  command: 'publish',
  mode: 'publish',
  outcome: 'published',
  publish: null,
} as const satisfies ReportInput
const UNC = '\\\\server\\share\\r'

let actual: typeof import('node:fs')
let base = ''
let sbRoot = ''
const native = () => vi.mocked(fs.realpathSync.native)

beforeAll(async () => {
  actual = await vi.importActual<typeof import('node:fs')>('node:fs')
})
beforeEach(() => {
  base = fs.mkdtempSync(join(tmpdir(), 's15a-rk-'))
  sbRoot = join(base, 'sb')
  fs.mkdirSync(join(sbRoot, 'public'), { recursive: true })
})
afterEach(() => {
  native().mockImplementation(actual.realpathSync.native)
  actual.rmSync(base, { recursive: true, force: true })
})

/** A deps object that records log and error lines. */
function recorder() {
  const log: string[] = []
  const error: string[] = []
  return {
    log,
    error,
    deps: {
      storyboardRoot: sbRoot,
      platform: process.platform,
      log: (line: string) => void log.push(line),
      error: (line: string) => void error.push(line),
    },
  }
}
/** Answers a chosen real path for each listed input path; every other path is real. */
const answerRealPaths = (answers: ReadonlyMap<string, string>) =>
  native().mockImplementation(
    ((path: fs.PathLike) =>
      answers.get(String(path)) ??
      actual.realpathSync.native(path)) as typeof fs.realpathSync.native,
  )
/** Answers `answer` for `dir`'s real path on its `call`-th read only (the write-time re-checks). */
const answerOnCall = (dir: string, call: number, answer: string) => {
  let seen = 0
  native().mockImplementation(((path: fs.PathLike) => {
    if (String(path) === resolve(dir) && ++seen === call) return answer
    return actual.realpathSync.native(path)
  }) as typeof fs.realpathSync.native)
}
const checked = (dir: string): CheckedReportDir => {
  const result = checkedReportDir(dir, { storyboardRoot: sbRoot, platform: process.platform })
  if (!result.ok) throw new Error('test setup: the report dir is checked')
  return result.realDir
}
const publisherNames = (dir: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.startsWith('publisher-')) : []

describe('run-kit', () => {
  it('T15A-10 run-kit: stopLine and internalLine for the four commands; Stop, failureCode and WAIVER_READ_CODE as stage had them (A22, D15-21)', () => {
    expect(stopLine('stage', 'usage'), "precondition: stopLine('stage', 'usage')").toBe(
      'stage: stopped: usage',
    )
    const lines: [string, () => string, string][] = [
      [
        'approve answers-missing',
        () => stopLine('approve', 'answers-missing'),
        'approve: stopped: answers-missing',
      ],
      [
        'publish run-context-refused',
        () => stopLine('publish', 'run-context-refused'),
        'publish: stopped: run-context-refused',
      ],
      ['validate usage', () => stopLine('validate', 'usage'), 'validate: stopped: usage'],
    ]
    for (const [id, run, want] of lines) {
      let got: string
      try {
        got = run()
      } catch (thrown) {
        got = `threw ${String(thrown)}`
      }
      expect.soft(got, `(g1) ${id}`).toBe(want)
    }
    expect
      .soft(internalLine('publish', new RangeError('S15ACANARY')), '(g2) the class name only')
      .toBe('publish: stopped: internal RangeError')
    expect
      .soft(internalLine('approve', 'thrown string'), '(g2) a non-error')
      .toBe('approve: stopped: internal non-error')
    expect.soft({ ...WAIVER_READ_CODE }, '(g3) WAIVER_READ_CODE as stage.ts had it').toEqual({
      'not-found': 'waiver-not-in-masters',
      'hash-mismatch': 'waiver-hash-mismatch',
      'too-large': 'waiver-too-large',
      unauthorized: 'storage-unauthorized',
      failed: 'storage-failed',
    })
    expect
      .soft(
        ['unauthorized', 'failed', 'not-found', 'too-large'].map(failureCode),
        '(g3) failureCode as stage.ts had it',
      )
      .toEqual(['storage-unauthorized', 'storage-failed', 'storage-failed', 'storage-failed'])
    const stop = new Stop('package-gate', { storyId: 'two-paths' }, 'plan')
    expect
      .soft([stop.code, stop.detail, stop.phase], '(g3) Stop keeps its three fields')
      .toEqual(['package-gate', { storyId: 'two-paths' }, 'plan'])
  })

  it('T15A-11 openReportDir prints the usage stop and the reason for each refusal, and returns the checked real dir (A23, D15-22, CRIT-3)', () => {
    expect(fs.existsSync(join(sbRoot, 'public')), 'precondition: a temp root with public/').toBe(
      true,
    )
    for (const command of ['approve', 'publish'] as const) {
      const r = recorder()
      const got = openReportDir(command, join(sbRoot, 'public'), true, r.deps)
      expect
        .soft([got, r.log, r.error], `(g1) ${command}: in public/`)
        .toEqual([null, [`${command}: stopped: usage`], [formatReportDirRefused(command)]])
    }
    const remote = join(base, 'remote', 'r')
    answerRealPaths(new Map([[resolve(remote), UNC]]))
    for (const given of [true, false]) {
      const r = recorder()
      const got = openReportDir('publish', remote, given, r.deps)
      expect
        .soft([got, r.log, r.error], `(g2) a not-local real path, given ${String(given)}`)
        .toEqual([null, ['publish: stopped: usage'], [formatReportDirNotLocal('publish', given)]])
    }
    answerRealPaths(
      new Map([
        [resolve(join(sbRoot, 'public')), '\\\\localhost\\d$\\sb\\public'],
        [resolve(join(sbRoot, 'app')), '\\\\localhost\\d$\\sb\\app'],
      ]),
    )
    const site = recorder()
    expect
      .soft(
        [openReportDir('approve', join(base, 'r'), true, site.deps), site.log, site.error],
        '(g2) a storyboard folder opened through a share',
      )
      .toEqual([null, ['approve: stopped: usage'], [formatSiteNotLocal('approve')]])
    native().mockImplementation(actual.realpathSync.native)

    const target = join(base, 'target')
    const link = join(base, 'link')
    fs.mkdirSync(target)
    fs.symlinkSync(target, link, 'junction')
    const r = recorder()
    const got = openReportDir('publish', join(link, 'r'), true, r.deps)
    expect
      .soft([got, r.log, r.error], '(g3) through a junction: the real dir, nothing printed')
      .toEqual([join(actual.realpathSync.native(target), 'r'), [], []])
  })

  it('T15A-70 writeRunReport prints the reason for each write-time refusal, then report-unwritten, and returns false; a written report prints nothing (A23, A31, D15-22, AUD-1)', () => {
    const pre = recorder()
    const preDir = checked(join(base, 'pre', 'reports'))
    expect(
      [writeRunReport('validate', preDir, VALIDATE_INPUT, true, pre.deps), pre.log, pre.error],
      'precondition: a written report returns true and prints nothing',
    ).toEqual([true, [], []])

    const g1 = recorder()
    const dir1 = checked(join(base, 'g1', 'reports'))
    answerOnCall(dir1, 1, UNC)
    const ok1 = writeRunReport('validate', dir1, VALIDATE_INPUT, true, g1.deps)
    native().mockImplementation(actual.realpathSync.native)
    expect
      .soft([ok1, g1.log, g1.error], '(g1) validate: not local at the post-mkdir re-check')
      .toEqual([
        false,
        [],
        [formatReportDirNotLocal('validate', true), 'validate: report-unwritten'],
      ])

    const g2 = recorder()
    const dir2 = checked(join(base, 'g2', 'reports'))
    answerOnCall(dir2, 2, UNC)
    const ok2 = writeRunReport('approve', dir2, APPROVE_INPUT, false, g2.deps)
    native().mockImplementation(actual.realpathSync.native)
    expect
      .soft([ok2, g2.log, g2.error], '(g2) approve: not local at the pre-rename re-check')
      .toEqual([
        false,
        [],
        [formatReportDirNotLocal('approve', false), 'approve: report-unwritten'],
      ])
    expect.soft(publisherNames(dir2), '(g2) no publisher-approve.* file').toEqual([])

    const g3 = recorder()
    const out3 = join(base, 'g3')
    const dir3 = checked(join(out3, 'reports'))
    vi.mocked(fs.writeFileSync).mockImplementationOnce(((
      file: fs.PathOrFileDescriptor,
      data: string,
      options?: fs.WriteFileOptions,
    ) => {
      actual.writeFileSync(file, data, options)
      actual.renameSync(join(out3, 'reports'), join(out3, 'reports-away'))
      actual.symlinkSync(join(sbRoot, 'public'), join(out3, 'reports'), 'junction')
    }) as typeof fs.writeFileSync)
    fs.mkdirSync(join(out3, 'reports'), { recursive: true })
    expect
      .soft(
        [writeRunReport('publish', dir3, PUBLISH_INPUT, true, g3.deps), g3.log, g3.error],
        '(g3) publish: the real dir replaced by a junction to public/ inside the first temp write',
      )
      .toEqual([false, [], [formatReportDirRefused('publish'), 'publish: report-unwritten']])

    const g4 = recorder()
    const dir4 = checked(join(base, 'g4', 'reports'))
    fs.mkdirSync(join(dir4, 'publisher-stage.json.tmp'), { recursive: true })
    expect
      .soft(
        [writeRunReport('stage', dir4, STAGE_INPUT, true, g4.deps), g4.log, g4.error],
        '(g4) stage: a directory planted at the temp name',
      )
      .toEqual([false, [], ['stage: report-unwritten']])
  })
})
