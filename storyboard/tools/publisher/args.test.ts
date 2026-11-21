// Step 14 (P1-8c) args.ts: argument parsing into a Map, the --report-dir rule and captureRunContext
// (design migration-input/p1-step14-design.md §3.11, D14-17, D14-25; test plan §14.2: T14-1 to
// T14-6 and T14-88). Titles start with their id. One expect.soft per claim, messages
// "(gN) <claim> <sample>"; preconditions are hard expects starting "precondition:". args.ts is pure:
// nothing in this file reads or writes a file.
import { isAbsolute, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { USAGE_TEXT, captureRunContext, parseArgs, type ParsedArgs } from './args'

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
  '  help',
].join('\n')

const FLAGS = ['packages', 'media', 'waivers', 'report-dir', 'dry-run', 'all', 'timeout-ms']
/** Every usage message args.ts may give, typed here so a changed text turns T14-6 red. */
const PINNED_MESSAGES: ReadonlySet<string> = new Set([
  'usage: an argument is empty or holds a NUL character',
  'usage: no command (validate, stage or help)',
  'usage: unknown command (validate, stage or help)',
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
  ...FLAGS.map((flag) => `usage: --${flag} is given more than once`),
  ...FLAGS.map((flag) => `usage: --${flag} takes no value`),
  ...FLAGS.map(
    (flag) => `usage: --${flag} needs a value that is not empty and does not start with --`,
  ),
  ...FLAGS.map((flag) => `usage: --${flag} is for stage only`),
  ...FLAGS.map((flag) => `usage: --${flag} is required`),
])

describe('args: commands and flags', () => {
  it('T14-1 commands: help, validate and stage; anything else is usage', () => {
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
      ['publish', ['publish', 'a-b', ...IO]],
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
