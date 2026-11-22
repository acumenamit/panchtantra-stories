// Step 14 (P1-8c) args.ts: argument parsing into a Map, the --report-dir rule and captureRunContext
// (design migration-input/p1-step14-design.md §3.11, D14-17, D14-25; test plan §14.2: T14-1 to
// T14-6 and T14-88). Titles start with their id. One expect.soft per claim, messages
// "(gN) <claim> <sample>"; preconditions are hard expects starting "precondition:". args.ts is pure:
// nothing in this file reads or writes a file.
//
// Step 15a (P1-8d part a, design migration-input/p1-step15a-design.md §3.1, §3.7, §3.23, §3.29,
// D15-1, D15-7, D15-23, D15-28; test plan §14.2: T15A-1 to T15A-5 and T15A-68): approve and
// publish, the new flags and their scope texts, the report-dir refusal order and the win32 segment
// rule and fold. Nothing is written: every path below is a string only.
//
// Step 15b (P1-8d part b, design migration-input/p1-step15b-design.md §3.26, D15B-1, D15B-8,
// D15B-19, D15B-26; test plan §14.2: T15B-1 and T15B-2, and the reviewed edits of §2.5 and 14.16):
// `publish --unpublish <id> [--takedown]`, the `verify [--deep]` command, the ten-line usage and
// the new message texts.
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  USAGE_TEXT,
  captureRunContext,
  isDeviceOrNetworkPath,
  parseArgs,
  reportDirFormRefusal,
  type ParsedArgs,
} from './args'

const ROOT = resolve('s14-args-never-read', 'storyboard')
const CWD = resolve('s14-args-never-read', 'elsewhere')
const LINUX = { cwd: CWD, storyboardRoot: ROOT, platform: 'linux' }
const WIN32 = { cwd: CWD, storyboardRoot: ROOT, platform: 'win32' }
const IO = ['--packages', 'p', '--media', 'm']

const parse = (argv: readonly string[], ctx = LINUX): ParsedArgs => parseArgs(argv, ctx)
const isUsage = (result: ParsedArgs): boolean => !result.ok && result.code === 'usage'
const messageOf = (result: ParsedArgs): string => (result.ok ? '' : result.message)

const PINNED_USAGE = [
  'usage: corepack pnpm publisher <command>',
  '  validate (<id>... | --all) --packages <dir> --media <dir> [--waivers <dir>] [--report-dir <dir>]',
  '  stage <id>... --packages <dir> --media <dir> [--waivers <dir>] [--report-dir <dir>] [--dry-run] [--timeout-ms <n>]',
  '  approve <id> --package <sha256 prefix> [--answers-stdin] [--report-dir <dir>] [--dry-run] [--timeout-ms <n>]',
  '  publish <id>... [--feature <id|none>] [--report-dir <dir>] [--dry-run] [--timeout-ms <n>]',
  '  publish --feature <id|none> [--report-dir <dir>] [--dry-run] [--timeout-ms <n>]',
  '  publish --snapshot <seq> [--feature <id|none>] [--report-dir <dir>] [--dry-run] [--timeout-ms <n>]',
  '  publish --unpublish <id> [--takedown] [--report-dir <dir>] [--dry-run] [--timeout-ms <n>]',
  '  verify [--deep] [--report-dir <dir>] [--timeout-ms <n>]',
  '  help',
].join('\n')

const FLAGS = [
  'packages',
  'media',
  'waivers',
  'report-dir',
  'dry-run',
  'all',
  'timeout-ms',
  'answers-stdin',
  'feature',
  'snapshot',
  'package',
  'unpublish',
  'takedown',
  'deep',
]
/** Step 15a (TP-1): each flag outside its commands names the commands it is for. */
const SCOPE_TEXTS: readonly string[] = [
  ...['packages', 'media', 'waivers'].map(
    (flag) => `usage: --${flag} is for validate and stage only`,
  ),
  'usage: --dry-run is for stage, approve and publish only',
  'usage: --timeout-ms is for stage, approve, publish and verify only',
  ...['answers-stdin', 'package'].map((flag) => `usage: --${flag} is for approve only`),
  ...['feature', 'snapshot', 'unpublish', 'takedown'].map(
    (flag) => `usage: --${flag} is for publish only`,
  ),
  'usage: --deep is for verify only',
]
/** Every usage message args.ts may give, typed here so a changed text turns T14-6 red. */
const PINNED_MESSAGES: ReadonlySet<string> = new Set([
  'usage: an argument is empty or holds a NUL character',
  'usage: no command (validate, stage, approve, publish, verify or help)',
  'usage: unknown command (validate, stage, approve, publish, verify or help)',
  'usage: help takes no arguments',
  'usage: a bare -- is not allowed',
  'usage: single-dash flags are not supported',
  'usage: unknown flag',
  'usage: --all is for validate only',
  'usage: --all cannot be combined with story ids',
  'usage: validate needs story ids or --all',
  'usage: give 1 to 64 story ids',
  'usage: a story id must be 3 to 64 characters of a-z, 0-9 and single hyphens',
  'usage: a story id is given more than once',
  'usage: --timeout-ms must be a whole number from 1 to 600000',
  'usage: --report-dir may not be at or under public/ or app/ of the storyboard folder',
  'usage: --report-dir may not be a device or network path',
  'usage: approve takes exactly one story id',
  'usage: --package must be 12 to 64 lowercase hex characters',
  'usage: publish needs story ids, --feature, --snapshot or --unpublish',
  'usage: --snapshot cannot be combined with story ids',
  'usage: --snapshot must be a whole number from 1',
  'usage: --feature takes a story id or none',
  'usage: --unpublish cannot be combined with story ids, --feature or --snapshot',
  'usage: --unpublish takes a story id',
  'usage: --takedown needs --unpublish <id>',
  'usage: verify takes no story ids',
  'usage: the default report dir is on a device or network path; run from a local checkout or pass a local --report-dir',
  'usage: --report-dir has a segment Windows cannot store as written',
  'usage: the default report dir has a segment Windows cannot store as written; pass a local --report-dir',
  ...FLAGS.map((flag) => `usage: --${flag} is given more than once`),
  ...FLAGS.map((flag) => `usage: --${flag} takes no value`),
  ...FLAGS.map(
    (flag) => `usage: --${flag} needs a value that is not empty and does not start with --`,
  ),
  ...SCOPE_TEXTS,
  ...['packages', 'media', 'package'].map((flag) => `usage: --${flag} is required`),
])

describe('args: commands and flags', () => {
  it('T14-1 commands: help, validate, stage, approve and publish; anything else is usage', () => {
    const help = parse(['help'])
    expect(
      typeof help === 'object' && help !== null && USAGE_TEXT === PINNED_USAGE,
      'precondition: help returns a result and the usage text is the pinned one',
    ).toBe(true)
    expect(parse(['validate', 'a-b', ...IO]).ok, 'precondition: positive control validate').toBe(
      true,
    )
    expect.soft(help, '(g1) help gives the usage result with the pinned usage text').toEqual({
      ok: true,
      command: 'help',
      usage: PINNED_USAGE,
    })
    const samples: [string, string[]][] = [
      ['no command', []],
      ['Validate', ['Validate', 'a-b', ...IO]],
      ['unpublish', ['unpublish', 'a-b', ...IO]],
      ['stage2', ['stage2', 'a-b', ...IO]],
      ['--all alone', ['--all']],
    ]
    for (const [id, argv] of samples) {
      expect.soft(isUsage(parse(argv)), `(g2) refused as usage: ${id}`).toBe(true)
    }
  })

  it('T14-2 flag forms: --name value and --name=value, each once; every malformed or unknown form is usage (L15)', () => {
    const spaced = parse(['validate', 'a-b', '--packages', 'p', '--media', 'm'])
    expect(spaced.ok, 'precondition: validate a-b --packages p --media m parses').toBe(true)
    expect
      .soft(parse(['validate', 'a-b', '--packages=p', '--media=m']), '(g1) the = form equals')
      .toEqual(spaced)
    expect
      .soft(parse(['validate', 'a-b', '--packages=p', '--media', 'm']), '(g1) mixed forms equal')
      .toEqual(spaced)

    const groups: [string, string, string[]][] = [
      [
        'g2',
        '--x a --x b',
        ['validate', 'a-b', '--packages', 'a', '--packages', 'b', '--media', 'm'],
      ],
      ['g2', '--x=a --x b', ['validate', 'a-b', '--packages=a', '--packages', 'b', '--media', 'm']],
      ['g2', '--x a --x=a', ['validate', 'a-b', '--packages', 'a', '--packages=a', '--media', 'm']],
      ['g2', '--dry-run twice', ['stage', 'a-b', ...IO, '--dry-run', '--dry-run']],
      ['g3', 'a flag last in argv', ['validate', 'a-b', '--media', 'm', '--packages']],
      ['g3', '--packages=', ['validate', 'a-b', '--packages=', '--media', 'm']],
      ['g3', '--packages --media m', ['validate', 'a-b', '--packages', '--media', 'm']],
      ['g3', '--packages=--x', ['validate', 'a-b', '--packages=--x', '--media', 'm']],
      ['g4', '--dry-run=1', ['stage', 'a-b', ...IO, '--dry-run=1']],
      ['g4', '--dry-run=false', ['stage', 'a-b', ...IO, '--dry-run=false']],
      ['g4', '--all=true', ['validate', '--all=true', ...IO]],
      ['g5', '--DRY-RUN', ['stage', 'a-b', ...IO, '--DRY-RUN']],
      ['g5', '--Packages', ['validate', 'a-b', '--Packages', 'p', '--media', 'm']],
      ['g5', '-p', ['validate', 'a-b', '-p', 'p', '--media', 'm']],
      ['g5', '—dry-run (U+2014)', ['stage', 'a-b', ...IO, '—dry-run']],
      ['g5', '––all (two U+2013)', ['validate', '––all', ...IO]],
      ['g5', '--__proto__=x', ['validate', 'a-b', ...IO, '--__proto__=x']],
      ['g5', '--constructor', ['validate', 'a-b', ...IO, '--constructor']],
      ['g5', '--toString', ['validate', 'a-b', ...IO, '--toString']],
      ['g5', '--hasOwnProperty x', ['validate', 'a-b', ...IO, '--hasOwnProperty', 'x']],
      ['g5', 'a bare --', ['validate', 'a-b', ...IO, '--']],
      ['g5', 'a bare -- before ids', ['validate', '--', 'a-b', ...IO]],
      ['g6', "an argv element ''", ['validate', 'a-b', ...IO, '']],
      ['g6', 'U+0000 in a value', ['validate', 'a-b', '--packages', 'p\u0000x', '--media', 'm']],
    ]
    for (const [group, id, argv] of groups) {
      expect.soft(isUsage(parse(argv)), `(${group}) refused as usage: ${id}`).toBe(true)
    }
  })

  it('T14-3 --timeout-ms: decimal 1 to 600,000, stage only, default 180,000', () => {
    const plain = parse(['stage', 'a-b', ...IO])
    expect(
      plain.ok && plain.command === 'stage' && plain.timeoutMs,
      'precondition: a stage parse without the flag gives 180000',
    ).toBe(180000)
    for (const value of ['1', '5000', '600000']) {
      const result = parse(['stage', 'a-b', ...IO, '--timeout-ms', value])
      expect
        .soft(result.ok && result.command === 'stage' && result.timeoutMs, `(g1) accepted ${value}`)
        .toBe(Number(value))
    }
    const refusedValues = [
      '0',
      '600001',
      '1e3',
      '0x10',
      '+5',
      '05',
      '5.0',
      '-1',
      '9007199254740993',
      ' 5',
      '5 ',
      '５',
      'Infinity',
    ]
    for (const value of refusedValues) {
      expect
        .soft(
          isUsage(parse(['stage', 'a-b', ...IO, '--timeout-ms', value])),
          `(g2) refused ${JSON.stringify(value)}`,
        )
        .toBe(true)
    }
    expect
      .soft(
        isUsage(parse(['validate', 'a-b', ...IO, '--timeout-ms', '5000'])),
        '(g3) --timeout-ms on validate is usage',
      )
      .toBe(true)
  })

  it('T14-4 ids: StoryId, unique, 1 to 64; --all for validate only and never with ids', () => {
    const ids = Array.from({ length: 64 }, (_, i) => `story-${i}`)
    expect(parse(['stage', ...ids, ...IO]).ok, 'precondition: 64 distinct valid ids parse').toBe(
      true,
    )
    const g1: [string, string[]][] = [
      ['Blue-Jackal', ['Blue-Jackal']],
      ['ab', ['ab']],
      ['65 characters', ['a'.repeat(65)]],
      ['../x', ['../x']],
      ['a.json', ['a.json']],
      ['a/b', ['a/b']],
      ['a\\b', ['a\\b']],
      ['a-b a-b', ['a-b', 'a-b']],
      ['65 ids', [...ids, 'story-64']],
    ]
    for (const [id, given] of g1) {
      expect.soft(isUsage(parse(['stage', ...given, ...IO])), `(g1) refused ${id}`).toBe(true)
    }
    const g2: [string, string[]][] = [
      ['validate --all a-b', ['validate', '--all', 'a-b', ...IO]],
      ['stage --all', ['stage', '--all', ...IO]],
      ['stage with no id', ['stage', ...IO]],
      ['validate with neither', ['validate', ...IO]],
    ]
    for (const [id, argv] of g2) {
      expect.soft(isUsage(parse(argv)), `(g2) refused ${id}`).toBe(true)
    }
  })

  it('T14-5 paths: required flags, defaults under storyboardRoot, relative values against cwd, no report dir under public/ or app/ (TP-8)', () => {
    const full = parse([
      'stage',
      'a-b',
      '--packages',
      'p',
      '--media',
      'm',
      '--waivers',
      'w',
      '--report-dir',
      'r',
      '--dry-run',
      '--timeout-ms',
      '5000',
    ])
    expect(
      full.ok &&
        full.command === 'stage' &&
        [full.packages, full.media, full.waivers, full.reportDir].every((p) => isAbsolute(p)),
      'precondition: a parse with every flag returns each path resolved',
    ).toBe(true)

    for (const command of ['validate', 'stage']) {
      expect
        .soft(
          isUsage(parse([command, 'a-b', '--media', 'm'])),
          `(g1) --packages required: ${command}`,
        )
        .toBe(true)
      expect
        .soft(
          isUsage(parse([command, 'a-b', '--packages', 'p'])),
          `(g1) --media required: ${command}`,
        )
        .toBe(true)
    }

    const defaults = parse(['validate', 'a-b', ...IO])
    expect
      .soft(
        defaults.ok && defaults.command === 'validate' && defaults.waivers,
        '(g2) --waivers default',
      )
      .toBe(resolve(ROOT, 'migration-input', 'waivers'))
    expect
      .soft(
        defaults.ok && defaults.command === 'validate' && defaults.reportDir,
        '(g2) --report-dir default',
      )
      .toBe(resolve(ROOT, 'migration-input', 'reports'))

    const relative = parse([
      'validate',
      'a-b',
      '--packages',
      'in/p',
      '--media',
      '../m',
      '--report-dir',
      'out',
    ])
    expect
      .soft(
        relative.ok && relative.command === 'validate'
          ? [relative.packages, relative.media, relative.reportDir]
          : null,
        '(g3) relative values resolve against cwd',
      )
      .toEqual([resolve(CWD, 'in/p'), resolve(CWD, '../m'), resolve(CWD, 'out')])

    const reportDir = (value: string, ctx = LINUX) =>
      parse(['validate', 'a-b', ...IO, '--report-dir', value], ctx)
    expect(
      reportDir(resolve(ROOT, 'reports')).ok,
      'precondition: positive control report dir',
    ).toBe(true)
    const refusedDirs: [string, () => ParsedArgs][] = [
      ['<root>/public', () => reportDir(`${ROOT}/public`)],
      ['<root>/public/x', () => reportDir(`${ROOT}/public/x`)],
      ['<root>/app/y', () => reportDir(`${ROOT}/app/y`)],
      ['<root>/x/../public', () => reportDir(`${ROOT}/x/../public`)],
      ['<root>/public/', () => reportDir(`${ROOT}/public/`)],
      ['<root>/./app', () => reportDir(`${ROOT}/./app`)],
      [
        '../public from cwd <root>/x',
        () => reportDir('../public', { ...LINUX, cwd: resolve(ROOT, 'x') }),
      ],
      ['<root>/PUBLIC on platform win32', () => reportDir(`${ROOT}/PUBLIC`, WIN32)],
    ]
    if (process.platform === 'win32') {
      refusedDirs.push(['<root>\\public (win32 host)', () => reportDir(`${ROOT}\\public`)])
      // Device-namespace and network forms keep their prefix through path.resolve, and node:fs
      // opens them (SEC1-1): refused as a form, whatever folder they name.
      refusedDirs.push(
        ['\\\\?\\<root>\\public (win32 host)', () => reportDir(`\\\\?\\${ROOT}\\public`)],
        ['\\\\.\\<root>\\public (win32 host)', () => reportDir(`\\\\.\\${ROOT}\\public`)],
        [
          '//?/<root>/public (win32 host)',
          () => reportDir(`//?/${ROOT.replaceAll('\\', '/')}/public`),
        ],
        ['\\\\localhost\\share\\x (win32 host)', () => reportDir('\\\\localhost\\share\\x')],
      )
    } else {
      console.log('skipped: backslash form needs a win32 host')
    }
    for (const [id, run] of refusedDirs) {
      expect.soft(isUsage(run()), `(g4) refused ${id}`).toBe(true)
    }
    for (const near of ['publicx', 'apps']) {
      expect
        .soft(reportDir(`${ROOT}/${near}`).ok, `(g4) near miss accepted <root>/${near}`)
        .toBe(true)
    }
  })

  it('T14-6 usage messages name the flag or rule, never an input value', () => {
    const C = 'S14CANARYARG'
    const samples: string[][] = [
      ['validate', 'a-b', ...IO, `--${C}`],
      ['validate', 'a-b', ...IO, `--${C}=x`],
      ['validate', 'a-b', ...IO, `--x=${C}`],
      ['validate', C, ...IO],
      ['stage', 'a-b', C.toLowerCase(), 'a-b', ...IO, `--report-dir=${C}`],
      ['validate', 'a-b', '--packages', C, '--packages', C, '--media', 'm'],
      ['stage', 'a-b', ...IO, '--timeout-ms', C],
      ['stage', 'a-b', ...IO, `--dry-run=${C}`],
      ['validate', 'a-b', ...IO, '--report-dir', `${ROOT}/public/${C}`],
      [C, 'a-b', ...IO],
      ['validate', 'a-b', ...IO, `-${C}`],
      ['validate', 'a-b', ...IO, `${C}\u0000`],
      ['help', C],
      ['validate', 'a-b', '--packages', `--${C}`, '--media', 'm'],
      ['validate', '--all', C, ...IO],
      ['stage', 'a-b', ...IO, '--all', C],
      ['validate', 'a-b', `—${C}`, ...IO],
    ]
    if (process.platform === 'win32') {
      samples.push(['validate', 'a-b', ...IO, '--report-dir', `\\\\?\\${ROOT}\\${C}`])
    }
    const results = samples.map((argv) => parse(argv))
    expect(
      samples.every((argv) => argv.some((arg) => arg.includes(C))) && results.every((r) => !r.ok),
      'precondition: every sample holds the canary and was refused',
    ).toBe(true)
    for (const [i, result] of results.entries()) {
      expect
        .soft(messageOf(result).toUpperCase().includes(C), `(g1) no canary in message ${i}`)
        .toBe(false)
      expect
        .soft(PINNED_MESSAGES.has(messageOf(result)), `(g2) message ${i} is a pinned text`)
        .toBe(true)
    }
  })
})

// ---- Step 15a ----

const P12 = '0123456789ab'
const P64 = '0123456789abcdef'.repeat(4)
/** A temp-shaped base that is never created: args.ts is pure. */
const TMP = join(tmpdir(), 's15a-args-never-written')
const DEFAULT_REPORTS = resolve(ROOT, 'migration-input', 'reports')
const MSG = {
  oneId: 'usage: approve takes exactly one story id',
  packageRequired: 'usage: --package is required',
  packageForm: 'usage: --package must be 12 to 64 lowercase hex characters',
  publishNeeds: 'usage: publish needs story ids, --feature, --snapshot or --unpublish',
  snapshotWithIds: 'usage: --snapshot cannot be combined with story ids',
  snapshotForm: 'usage: --snapshot must be a whole number from 1',
  featureForm: 'usage: --feature takes a story id or none',
  idCount: 'usage: give 1 to 64 story ids',
  idTwice: 'usage: a story id is given more than once',
  unknownFlag: 'usage: unknown flag',
  allForValidate: 'usage: --all is for validate only',
  inSite: 'usage: --report-dir may not be at or under public/ or app/ of the storyboard folder',
  device: 'usage: --report-dir may not be a device or network path',
  deviceDefault:
    'usage: the default report dir is on a device or network path; run from a local checkout or pass a local --report-dir',
  segment: 'usage: --report-dir has a segment Windows cannot store as written',
  segmentDefault:
    'usage: the default report dir has a segment Windows cannot store as written; pass a local --report-dir',
} as const
const scopeText = (flag: string, commands: string) => `usage: --${flag} is for ${commands} only`

if (process.platform !== 'win32') {
  console.log('skipped: T15A-5 device and network forms need a win32 host')
}

describe('args: Step 15a approve, publish and the report-dir forms', () => {
  it('T15A-1 approve: exactly one id and --package as 12 to 64 lowercase hex; --answers-stdin, --dry-run, --timeout-ms and --report-dir; defaults (A1, D15-1, CRIT-5)', () => {
    const base = parse(['approve', 'a-b', '--package', P12])
    expect(base.ok, 'precondition: approve a-b --package 0123456789ab is ok').toBe(true)
    expect.soft(base, '(g1) the defaults').toEqual({
      ok: true,
      command: 'approve',
      storyId: 'a-b',
      packagePrefix: P12,
      answersStdin: false,
      dryRun: false,
      timeoutMs: 180000,
      reportDir: DEFAULT_REPORTS,
      reportDirGiven: false,
    })
    expect
      .soft(
        parse([
          'approve',
          'a-b',
          '--package',
          P64,
          '--answers-stdin',
          '--dry-run',
          '--timeout-ms',
          '5000',
          '--report-dir',
          'r',
        ]),
        '(g1) every flag set, a 64-hex prefix',
      )
      .toEqual({
        ok: true,
        command: 'approve',
        storyId: 'a-b',
        packagePrefix: P64,
        answersStdin: true,
        dryRun: true,
        timeoutMs: 5000,
        reportDir: resolve(CWD, 'r'),
        reportDirGiven: true,
      })
    const dryOnly = parse(['approve', 'a-b', '--package', P12, '--dry-run'])
    expect
      .soft(
        dryOnly.ok && dryOnly.command === 'approve' && [dryOnly.dryRun, dryOnly.answersStdin],
        '(g1) --dry-run alone sets dryRun only',
      )
      .toEqual([true, false])

    const refused: [string, string[], string][] = [
      ['no id', ['approve', '--package', P12], MSG.oneId],
      ['two ids', ['approve', 'a-b', 'c-d', '--package', P12], MSG.oneId],
      ['no --package', ['approve', 'a-b'], MSG.packageRequired],
      ['11 hex', ['approve', 'a-b', '--package', P12.slice(0, 11)], MSG.packageForm],
      ['65 hex', ['approve', 'a-b', '--package', `${P64}0`], MSG.packageForm],
      ['upper-case 12 hex', ['approve', 'a-b', '--package', 'ABCDEF012345'], MSG.packageForm],
      ['0x0123456789', ['approve', 'a-b', '--package', '0x0123456789'], MSG.packageForm],
      ['0123456789ag', ['approve', 'a-b', '--package', '0123456789ag'], MSG.packageForm],
      ["' 0123456789ab'", ['approve', 'a-b', '--package', ` ${P12}`], MSG.packageForm],
      [
        '--package=',
        ['approve', 'a-b', '--package='],
        'usage: --package needs a value that is not empty and does not start with --',
      ],
      [
        '--answers-stdin=yes',
        ['approve', 'a-b', '--package', P12, '--answers-stdin=yes'],
        'usage: --answers-stdin takes no value',
      ],
    ]
    for (const [id, argv, text] of refused) {
      expect.soft(messageOf(parse(argv)), `(g2) refused with its text: ${id}`).toBe(text)
    }
  })

  it('T15A-2 publish: ids, --feature and --snapshot in their combinations; every other form is usage with its message (A1, D15-7)', () => {
    const one = parse(['publish', 'a-b'])
    expect(one.ok, 'precondition: publish a-b is ok').toBe(true)
    expect.soft(one, '(g1) publish a-b in full').toEqual({
      ok: true,
      command: 'publish',
      ids: ['a-b'],
      featureGiven: false,
      feature: null,
      snapshot: null,
      unpublish: null,
      takedown: false,
      dryRun: false,
      timeoutMs: 180000,
      reportDir: DEFAULT_REPORTS,
      reportDirGiven: false,
    })
    const pick = (result: ParsedArgs) =>
      result.ok && result.command === 'publish'
        ? {
            ids: result.ids,
            featureGiven: result.featureGiven,
            feature: result.feature,
            snapshot: result.snapshot,
          }
        : messageOf(result)
    const ids64 = Array.from({ length: 64 }, (_, i) => `story-${i}`)
    const accepted: [string, string[], unknown][] = [
      [
        'publish a-b c-d',
        ['publish', 'a-b', 'c-d'],
        { ids: ['a-b', 'c-d'], featureGiven: false, feature: null, snapshot: null },
      ],
      [
        'publish --feature a-b',
        ['publish', '--feature', 'a-b'],
        { ids: [], featureGiven: true, feature: 'a-b', snapshot: null },
      ],
      [
        'publish --feature none',
        ['publish', '--feature', 'none'],
        { ids: [], featureGiven: true, feature: null, snapshot: null },
      ],
      [
        'publish a-b --feature none',
        ['publish', 'a-b', '--feature', 'none'],
        { ids: ['a-b'], featureGiven: true, feature: null, snapshot: null },
      ],
      [
        'publish --snapshot 3',
        ['publish', '--snapshot', '3'],
        { ids: [], featureGiven: false, feature: null, snapshot: 3 },
      ],
      [
        'publish --snapshot 3 --feature a-b',
        ['publish', '--snapshot', '3', '--feature', 'a-b'],
        { ids: [], featureGiven: true, feature: 'a-b', snapshot: 3 },
      ],
      [
        '--snapshot 9007199254740991',
        ['publish', '--snapshot', '9007199254740991'],
        { ids: [], featureGiven: false, feature: null, snapshot: 9007199254740991 },
      ],
      [
        '64 ids',
        ['publish', ...ids64],
        { ids: ids64, featureGiven: false, feature: null, snapshot: null },
      ],
    ]
    for (const [id, argv, want] of accepted) {
      expect.soft(pick(parse(argv)), `(g1) accepted: ${id}`).toEqual(want)
    }

    const refused: [string, string[], string][] = [
      ['publish', ['publish'], MSG.publishNeeds],
      ['publish --dry-run', ['publish', '--dry-run'], MSG.publishNeeds],
      ['publish a-b --snapshot 3', ['publish', 'a-b', '--snapshot', '3'], MSG.snapshotWithIds],
      ...['0', '03', '1e3', '-1', '+1', '0x3', ' 3', '３', '9007199254740992'].map(
        (value): [string, string[], string] => [
          `--snapshot ${JSON.stringify(value)}`,
          ['publish', '--snapshot', value],
          MSG.snapshotForm,
        ],
      ),
      ...['None', 'NONE', 'Blue-Jackal', 'a/b', 'ab'].map((value): [string, string[], string] => [
        `--feature ${value}`,
        ['publish', '--feature', value],
        MSG.featureForm,
      ]),
      ['65 ids', ['publish', ...ids64, 'story-64'], MSG.idCount],
      ['a-b a-b', ['publish', 'a-b', 'a-b'], MSG.idTwice],
    ]
    for (const [id, argv, text] of refused) {
      expect.soft(messageOf(parse(argv)), `(g2) refused with its text: ${id}`).toBe(text)
    }
  })

  it('T15A-3 flag scope: each flag outside its commands is usage naming its commands; --unpublished, --takedowns and --takedown2 are unknown flags (A1, CRIT-2)', () => {
    const approveBase = ['approve', 'a-b', '--package', P12]
    const inScope: [string, string[]][] = [
      ['validate', ['validate', '--all', ...IO, '--waivers', 'w', '--report-dir', 'r']],
      ['stage', ['stage', 'a-b', ...IO, '--waivers', 'w', '--report-dir', 'r', '--dry-run']],
      ['stage --timeout-ms', ['stage', 'a-b', ...IO, '--timeout-ms', '5']],
      [
        'approve',
        [...approveBase, '--answers-stdin', '--dry-run', '--timeout-ms', '5', '--report-dir', 'r'],
      ],
      [
        'publish',
        ['publish', '--snapshot', '3', '--feature', 'a-b', '--dry-run', '--timeout-ms', '5'],
      ],
      ['publish --report-dir', ['publish', 'a-b', '--report-dir', 'r']],
    ]
    for (const [id, argv] of inScope) {
      expect(parse(argv).ok, `precondition: ${id} parses with the flags of its scope`).toBe(true)
    }
    const g1: [string, string[], string][] = []
    for (const flag of ['packages', 'media', 'waivers']) {
      const text = scopeText(flag, 'validate and stage')
      g1.push([`--${flag} on approve`, [...approveBase, `--${flag}`, 'x'], text])
      g1.push([`--${flag} on publish`, ['publish', 'a-b', `--${flag}`, 'x'], text])
    }
    g1.push([
      '--dry-run on validate',
      ['validate', 'a-b', ...IO, '--dry-run'],
      scopeText('dry-run', 'stage, approve and publish'),
    ])
    g1.push([
      '--timeout-ms on validate',
      ['validate', 'a-b', ...IO, '--timeout-ms', '5'],
      scopeText('timeout-ms', 'stage, approve, publish and verify'),
    ])
    g1.push(['--all on stage', ['stage', 'a-b', ...IO, '--all'], MSG.allForValidate])
    g1.push(['--all on approve', [...approveBase, '--all'], MSG.allForValidate])
    g1.push(['--all on publish', ['publish', 'a-b', '--all'], MSG.allForValidate])
    const others: Record<string, string[]> = {
      validate: ['validate', 'a-b', ...IO],
      stage: ['stage', 'a-b', ...IO],
      approve: approveBase,
      publish: ['publish', 'a-b'],
    }
    for (const [flag, value, commands, scope] of [
      ['answers-stdin', null, ['validate', 'stage', 'publish'], 'approve'],
      ['package', P12, ['validate', 'stage', 'publish'], 'approve'],
      ['feature', 'a-b', ['validate', 'stage', 'approve'], 'publish'],
      ['snapshot', '3', ['validate', 'stage', 'approve'], 'publish'],
    ] as const) {
      for (const command of commands) {
        const argv = [...(others[command] ?? []), `--${flag}`, ...(value === null ? [] : [value])]
        g1.push([`--${flag} on ${command}`, argv, scopeText(flag, scope)])
      }
    }
    for (const [id, argv, text] of g1) {
      expect.soft(messageOf(parse(argv)), `(g1) ${id}`).toBe(text)
    }

    const g2: [string, string[], string][] = [
      [
        '--package on stage',
        ['stage', 'a-b', ...IO, '--package', P12],
        scopeText('package', 'approve'),
      ],
      [
        '--packages on approve',
        [...approveBase, '--packages', 'p'],
        scopeText('packages', 'validate and stage'),
      ],
      ['--Package on approve', ['approve', 'a-b', '--Package', P12], MSG.unknownFlag],
      ['--features on publish', ['publish', 'a-b', '--features', 'a-b'], MSG.unknownFlag],
    ]
    for (const [id, argv, text] of g2) {
      expect.soft(messageOf(parse(argv)), `(g2) near miss: ${id}`).toBe(text)
    }
    for (const argv of [
      ['publish', 'a-b', '--unpublished'],
      ['publish', 'a-b', '--takedowns'],
      ['publish', 'a-b', '--takedown2'],
    ]) {
      expect
        .soft(messageOf(parse(argv)), `(g3) unknown flag: ${argv.join(' ')}`)
        .toBe(MSG.unknownFlag)
    }
  })

  it('T15A-4 report-dir segments Windows cannot store as written are usage at parse time, for the flag and for the default (A1, CRIT-4)', () => {
    const flagDir = (dir: string, platform = 'win32', root = ROOT) =>
      parse(['validate', 'a-b', ...IO, '--report-dir', dir], {
        cwd: CWD,
        storyboardRoot: root,
        platform,
      })
    expect(
      flagDir(`${TMP}/ok`).ok,
      'precondition: --report-dir <tmp>/ok parses on platform win32',
    ).toBe(true)
    const g1 = [
      `${TMP}/CON`,
      `${TMP}/con.txt`,
      `${TMP}/Nul`,
      `${TMP}/COM0`,
      `${TMP}/LPT9`,
      `${TMP}/COM¹`,
      `${TMP}/lpt³.txt`,
      `${TMP}/conin$`,
      `${TMP}/CONOUT$.log`,
      `${TMP}/x.`,
      `${TMP}/x `,
      `${ROOT}/public.`,
      `${ROOT}/public `,
      `${ROOT}/app./x`,
      `${TMP}/d:s`,
      `${ROOT}/public::$INDEX_ALLOCATION`,
      `${TMP}/f.txt:ads`,
      `${TMP}/a?b`,
      `${TMP}/a*b`,
      `${TMP}/a<b`,
      `${TMP}/a|b`,
      `${TMP}/a"b`,
      `${TMP}/a\u0001b`,
      // Every other reserved name D15-28 lists, so the list's content is pinned (S15A-R1-SEC-3).
      `${TMP}/PRN`,
      `${TMP}/aux.log`,
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '²', '³'].map((d) => `${TMP}/COM${d}`),
      ...['0', '1', '2', '3', '4', '5', '6', '7', '8', '¹', '²'].map((d) => `${TMP}/lpt${d}`),
    ]
    if (process.platform === 'win32') {
      g1.push(`${TMP}\\CON\\y`, `${ROOT}\\public.`, '\\??\\C:\\x')
    } else {
      console.log('skipped: backslash form needs a win32 host')
    }
    for (const dir of g1) {
      expect
        .soft(messageOf(flagDir(dir)), `(g1) refused on platform win32: ${JSON.stringify(dir)}`)
        .toBe(MSG.segment)
    }
    const near = [
      `${TMP}/CONSOLE`,
      `${TMP}/con-x`,
      `${TMP}/COM10`,
      `${TMP}/LPT`,
      `${TMP}/x.y`,
      `${TMP}/.hidden`,
      `${TMP}/a..b`,
    ]
    if (process.platform === 'win32') near.push('C:\\s15a-drive-prefix')
    for (const dir of near) {
      expect.soft(flagDir(dir).ok, `(g2) near miss accepted on platform win32: ${dir}`).toBe(true)
    }
    for (const dir of [`${TMP}/CON`, `${TMP}/x.`]) {
      expect.soft(flagDir(dir, 'linux').ok, `(g2) accepted on platform linux: ${dir}`).toBe(true)
    }
    for (const root of [`${TMP}/CON/sb`, `${TMP}/sb.`]) {
      const ctx = { cwd: CWD, storyboardRoot: resolve(root), platform: 'win32' }
      expect
        .soft(messageOf(parse(['validate', 'a-b', ...IO], ctx)), `(g3) default dir under ${root}`)
        .toBe(MSG.segmentDefault)
      expect
        .soft(
          parse(['validate', 'a-b', ...IO, '--report-dir', `${TMP}/ok`], ctx).ok,
          `(g3) a local --report-dir with the root ${root}`,
        )
        .toBe(true)
    }
    const canary = flagDir(`${TMP}/S15ACANARY./x`)
    expect(isUsage(canary), 'precondition: the canary sample is refused').toBe(true)
    expect
      .soft(messageOf(canary).includes('S15ACANARY'), '(g4) no canary in the message')
      .toBe(false)
  })

  it.skipIf(process.platform !== 'win32')(
    'T15A-5 device and network report dirs: each flag form is the flag message, a default dir on such a root the default-dir message, and a local --report-dir with that root passes (A24, D15-23, R2-SEC-3)',
    () => {
      const local = `${TMP}\\r`
      const at = (root: string, extra: string[] = []) =>
        parse(['validate', 'a-b', ...IO, ...extra], {
          cwd: CWD,
          storyboardRoot: root,
          platform: 'win32',
        })
      expect(
        at(ROOT, ['--report-dir', local]).ok,
        'precondition: --report-dir <tmp>\\r parses',
      ).toBe(true)
      for (const dir of [
        '\\\\?\\UNC\\localhost\\share\\x',
        '//localhost/share/x',
        '\\\\.\\pipe\\x',
        '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\x',
      ]) {
        expect
          .soft(messageOf(at(ROOT, ['--report-dir', dir])), `(g1) flag form ${dir}`)
          .toBe(MSG.device)
      }
      const roots = ['\\\\localhost\\share\\sb', '\\\\?\\C:\\sb', '//localhost/share/sb']
      for (const root of roots) {
        expect.soft(messageOf(at(root)), `(g2) default dir under ${root}`).toBe(MSG.deviceDefault)
        const given = at(root, ['--report-dir', local])
        expect
          .soft(
            given.ok && given.command === 'validate' && given.reportDirGiven,
            `(g3) a local --report-dir with ${root}`,
          )
          .toBe(true)
      }
      const relative = at(ROOT, ['--report-dir', 'C:x'])
      expect
        .soft(
          relative.ok && relative.command === 'validate' && /^C:\\/i.test(relative.reportDir),
          '(g3) C:x (drive-relative) parses to an absolute C:\\ path',
        )
        .toBe(true)
    },
  )

  it('T15A-68 report-dir refusal order and the win32 fold on both hosts: device or network first, then the segment rule, then the in-site compare folded with toUpperCase().toLowerCase() (A24, A30, D15-23, D15-28, AUD-2, AUD-4)', () => {
    expect(
      reportDirFormRefusal('C:\\ok\\r', true, 'win32'),
      "precondition: reportDirFormRefusal('C:\\\\ok\\\\r', true, 'win32') is null",
    ).toBeNull()
    for (const path of [
      '\\\\?\\C:\\sb',
      '//localhost/share/sb',
      '\\\\.\\pipe\\x',
      '\\\\?\\Volume{0}\\x',
      '\\\\server\\share',
    ]) {
      expect.soft(isDeviceOrNetworkPath(path), `(g1) device or network: ${path}`).toBe(true)
    }
    for (const path of ['C:\\sb', '/sb', 'C:sb', 'sb']) {
      expect.soft(isDeviceOrNetworkPath(path), `(g1) not device or network: ${path}`).toBe(false)
    }
    const devicePath = '\\\\?\\C:\\sb\\migration-input\\reports'
    const g2: [string, string | null, string | null][] = [
      ['device path, no flag', reportDirFormRefusal(devicePath, false, 'win32'), MSG.deviceDefault],
      ['device path, the flag', reportDirFormRefusal(devicePath, true, 'win32'), MSG.device],
      [
        'C:\\sb.\\migration-input\\reports, no flag',
        reportDirFormRefusal('C:\\sb.\\migration-input\\reports', false, 'win32'),
        MSG.segmentDefault,
      ],
      ['C:\\x\\CON, the flag', reportDirFormRefusal('C:\\x\\CON', true, 'win32'), MSG.segment],
      ['/tmp/CON on platform linux', reportDirFormRefusal('/tmp/CON', true, 'linux'), null],
    ]
    for (const [id, got, want] of g2) {
      expect.soft(got, `(g2) ${id}`).toBe(want)
    }
    const canary = reportDirFormRefusal('C:\\S15ACANARY.\\r', true, 'win32')
    expect(canary !== null, 'precondition: the canary segment is refused').toBe(true)
    expect
      .soft(String(canary).includes('S15ACANARY'), '(g3) no canary segment in the text')
      .toBe(false)
    const dotless = `${ROOT}/publ\u0131c`
    for (const dir of [dotless, `${ROOT}/APP/x`]) {
      expect
        .soft(
          messageOf(parse(['validate', 'a-b', ...IO, '--report-dir', dir], WIN32)),
          `(g4) platform win32: ${dir}`,
        )
        .toBe(MSG.inSite)
    }
    expect
      .soft(
        parse(['validate', 'a-b', ...IO, '--report-dir', dotless], LINUX).ok,
        '(g4) platform linux accepts <root>/publıc',
      )
      .toBe(true)
  })
})

// ---- Step 15b ----

const MSG15B = {
  needsValue: 'usage: --unpublish needs a value that is not empty and does not start with --',
  unpublishForm: 'usage: --unpublish takes a story id',
  unpublishTwice: 'usage: --unpublish is given more than once',
  takedownValue: 'usage: --takedown takes no value',
  takedownNeeds: 'usage: --takedown needs --unpublish <id>',
  unpublishWith: 'usage: --unpublish cannot be combined with story ids, --feature or --snapshot',
  publishNeeds: 'usage: publish needs story ids, --feature, --snapshot or --unpublish',
  unpublishScope: 'usage: --unpublish is for publish only',
  takedownScope: 'usage: --takedown is for publish only',
  verifyIds: 'usage: verify takes no story ids',
  dryRunScope: 'usage: --dry-run is for stage, approve and publish only',
  deepValue: 'usage: --deep takes no value',
  deepScope: 'usage: --deep is for verify only',
  allScope: 'usage: --all is for validate only',
  featureScope: 'usage: --feature is for publish only',
  timeoutScope: 'usage: --timeout-ms is for stage, approve, publish and verify only',
  unknownCommand: 'usage: unknown command (validate, stage, approve, publish, verify or help)',
  noCommand: 'usage: no command (validate, stage, approve, publish, verify or help)',
} as const

describe('args: Step 15b unpublish, takedown and verify', () => {
  it('T15B-1 publish --unpublish <id> [--takedown]: the value is a story id; exclusive with ids, --feature and --snapshot; --takedown needs it; each refusal gives its exact text (A1, D15B-1, D15B-8, D15B-26, L1)', () => {
    const base = parse(['publish', '--unpublish', 'a-b'])
    expect(base.ok, 'precondition: publish --unpublish a-b parses ok').toBe(true)
    expect.soft(base, '(g1) accepted: publish --unpublish a-b, each field exact').toEqual({
      ok: true,
      command: 'publish',
      ids: [],
      unpublish: 'a-b',
      takedown: false,
      featureGiven: false,
      feature: null,
      snapshot: null,
      dryRun: false,
      timeoutMs: 180000,
      reportDir: DEFAULT_REPORTS,
      reportDirGiven: false,
    })
    const pick = (result: ParsedArgs) =>
      result.ok && result.command === 'publish'
        ? {
            ids: result.ids,
            unpublish: result.unpublish,
            takedown: result.takedown,
            dryRun: result.dryRun,
            timeoutMs: result.timeoutMs,
            reportDirGiven: result.reportDirGiven,
          }
        : messageOf(result)
    const id64 = 'a'.repeat(64)
    const plain = { ids: [], takedown: false, dryRun: false, timeoutMs: 180000 }
    const accepted: [string, string[], unknown][] = [
      [
        '--unpublish=lion-and-hare',
        ['publish', '--unpublish=lion-and-hare'],
        { ...plain, unpublish: 'lion-and-hare', reportDirGiven: false },
      ],
      [
        '--unpublish a-b --takedown --dry-run --timeout-ms 5000 --report-dir r',
        [
          'publish',
          '--unpublish',
          'a-b',
          '--takedown',
          '--dry-run',
          '--timeout-ms',
          '5000',
          '--report-dir',
          'r',
        ],
        {
          ids: [],
          unpublish: 'a-b',
          takedown: true,
          dryRun: true,
          timeoutMs: 5000,
          reportDirGiven: true,
        },
      ],
      [
        'a 64-character id',
        ['publish', '--unpublish', id64],
        { ...plain, unpublish: id64, reportDirGiven: false },
      ],
      [
        'publish a-b',
        ['publish', 'a-b'],
        { ...plain, ids: ['a-b'], unpublish: null, reportDirGiven: false },
      ],
    ]
    for (const [id, argv, want] of accepted) {
      expect.soft(pick(parse(argv)), `(g1) accepted: ${id}`).toEqual(want)
    }

    const refused: [string, string[], string][] = [
      ['--unpublish (no value)', ['publish', '--unpublish'], MSG15B.needsValue],
      ['--unpublish=', ['publish', '--unpublish='], MSG15B.needsValue],
      ['--unpublish --dry-run', ['publish', '--unpublish', '--dry-run'], MSG15B.needsValue],
      ...['Lion', 'a--b', 'ab', 'a'.repeat(65), 'a/b', 'a-b\uD800'].map(
        (value): [string, string[], string] => [
          `--unpublish ${JSON.stringify(value)}`,
          ['publish', '--unpublish', value],
          MSG15B.unpublishForm,
        ],
      ),
      [
        'a second --unpublish',
        ['publish', '--unpublish', 'a-b', '--unpublish', 'c-d'],
        MSG15B.unpublishTwice,
      ],
      ['--takedown=x', ['publish', '--unpublish', 'a-b', '--takedown=x'], MSG15B.takedownValue],
      ['publish --takedown', ['publish', '--takedown'], MSG15B.takedownNeeds],
      [
        'publish --takedown --dry-run',
        ['publish', '--takedown', '--dry-run'],
        MSG15B.takedownNeeds,
      ],
      ['publish a-b --takedown', ['publish', 'a-b', '--takedown'], MSG15B.takedownNeeds],
      ['--unpublish a-b c-d', ['publish', '--unpublish', 'a-b', 'c-d'], MSG15B.unpublishWith],
      [
        '--unpublish a-b --feature none',
        ['publish', '--unpublish', 'a-b', '--feature', 'none'],
        MSG15B.unpublishWith,
      ],
      [
        '--unpublish a-b --snapshot 3',
        ['publish', '--unpublish', 'a-b', '--snapshot', '3'],
        MSG15B.unpublishWith,
      ],
      ['publish', ['publish'], MSG15B.publishNeeds],
    ]
    for (const [id, argv, text] of refused) {
      expect.soft(messageOf(parse(argv)), `(g2) refused with its text: ${id}`).toBe(text)
    }

    const scoped: [string, string[], string][] = [
      [
        '--unpublish on validate',
        ['validate', 'a-b', ...IO, '--unpublish', 'a-b'],
        MSG15B.unpublishScope,
      ],
      [
        '--unpublish on stage',
        ['stage', 'a-b', ...IO, '--unpublish', 'a-b'],
        MSG15B.unpublishScope,
      ],
      [
        '--unpublish on approve',
        ['approve', 'a-b', '--package', P12, '--unpublish', 'a-b'],
        MSG15B.unpublishScope,
      ],
      ['--takedown on verify', ['verify', '--takedown'], MSG15B.takedownScope],
    ]
    for (const [id, argv, text] of scoped) {
      expect.soft(messageOf(parse(argv)), `(g3) scope: ${id}`).toBe(text)
    }
  })

  it('T15B-2 verify [--deep] [--timeout-ms <n>] [--report-dir <dir>]: no ids, no --dry-run, --deep for verify only; the command list in the messages (A1, D15B-19, D15B-26, L1)', () => {
    const plain = parse(['verify'])
    expect(plain.ok, 'precondition: verify parses ok').toBe(true)
    expect.soft(plain, '(g1) accepted: verify, each field exact').toEqual({
      ok: true,
      command: 'verify',
      deep: false,
      timeoutMs: 180000,
      reportDir: DEFAULT_REPORTS,
      reportDirGiven: false,
    })
    expect
      .soft(
        parse(['verify', '--deep', '--timeout-ms', '5000', '--report-dir', 'r']),
        '(g1) accepted: verify --deep --timeout-ms 5000 --report-dir r',
      )
      .toEqual({
        ok: true,
        command: 'verify',
        deep: true,
        timeoutMs: 5000,
        reportDir: resolve(CWD, 'r'),
        reportDirGiven: true,
      })

    const refused: [string, string[], string][] = [
      ['verify a-b', ['verify', 'a-b'], MSG15B.verifyIds],
      ['verify --dry-run', ['verify', '--dry-run'], MSG15B.dryRunScope],
      ['verify --deep=1', ['verify', '--deep=1'], MSG15B.deepValue],
      ['publish a-b --deep', ['publish', 'a-b', '--deep'], MSG15B.deepScope],
      ['verify --all', ['verify', '--all'], MSG15B.allScope],
      ['verify --feature a-b', ['verify', '--feature', 'a-b'], MSG15B.featureScope],
      [
        'validate a-b --packages p --media m --timeout-ms 5',
        ['validate', 'a-b', ...IO, '--timeout-ms', '5'],
        MSG15B.timeoutScope,
      ],
    ]
    for (const [id, argv, text] of refused) {
      expect.soft(messageOf(parse(argv)), `(g2) refused with its text: ${id}`).toBe(text)
    }

    for (const name of ['Verify', 'verifY', 'verify2']) {
      expect
        .soft(messageOf(parse([name])), `(g3) unknown command: ${name}`)
        .toBe(MSG15B.unknownCommand)
    }
    expect.soft(messageOf(parse([])), '(g3) no command').toBe(MSG15B.noCommand)
  })
})

describe('args: captureRunContext', () => {
  it('T14-88 captureRunContext copies the three names, without regard to case on win32, and never returns its argument (D14-17, S14-AUD-14)', () => {
    const source: Record<string, string | undefined> = {
      GITHUB_ACTIONS: 'true',
      OTHER: 'x',
      PATH: '/bin',
    }
    const captured = captureRunContext(source, 'linux')
    expect(captured.GITHUB_ACTIONS, 'precondition: GITHUB_ACTIONS was captured').toBe('true')

    expect.soft(Object.getPrototypeOf(captured), '(g1) the result has a null prototype').toBeNull()
    expect.soft(captured === source, '(g1) the result is a new object').toBe(false)
    expect
      .soft(Object.entries(captured), '(g1) exactly GITHUB_ACTIONS; OTHER and PATH never copied')
      .toEqual([['GITHUB_ACTIONS', 'true']])
    source.VERCEL = '1'
    delete source.GITHUB_ACTIONS
    expect
      .soft(Object.entries(captured), '(g1) changing the source afterwards changes nothing')
      .toEqual([['GITHUB_ACTIONS', 'true']])

    const mixed = { Github_Actions: 'true', vercel: '1', VERCEL_env: 'preview', Path: 'x' }
    expect
      .soft(Object.entries(captureRunContext(mixed, 'win32')), '(g2) win32 copies every case')
      .toEqual([
        ['Github_Actions', 'true'],
        ['vercel', '1'],
        ['VERCEL_env', 'preview'],
      ])
    expect
      .soft(Object.entries(captureRunContext(mixed, 'linux')), '(g2) linux copies exact names only')
      .toEqual([])

    expect
      .soft(
        Object.entries(captureRunContext({ VERCEL: '' }, 'linux')),
        '(g3) an empty value is copied',
      )
      .toEqual([['VERCEL', '']])
  })
})
