// scripts/publisher-dispatch.ts (design migration-input/p1-step16-design.md §3.9, §14.2; D16-9,
// D16-28 to D16-31; P1-8e, Step 16): the checks in order with their fixed lines, the input rules and
// defaults, argv and stdin, the spawn with its failure paths, and the injected-env scan. Every test
// injects env, platform, readFile and spawn: no test spawns tsx, pnpm or the CLI, reads a real event
// file, or reaches a network. Canaries are plain words joined at run time; no key-shaped literal.
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  ANSWER_KEYS,
  ANSWERS_MAX_BYTES,
  readAnswersStream,
  reviewFromAnswers,
} from '../tools/publisher/answers'
import {
  cliPathOf,
  DISPATCH_ENV_NAMES,
  DISPATCH_INPUTS,
  main,
  planDispatch,
  resolveTsxCli,
  type DispatchPlan,
  type DispatchSpawnOptions,
  type MainDeps,
  type SpawnLike,
} from './publisher-dispatch'

type Workflow = 'approve' | 'publish' | 'unpublish' | 'verify'
type Job = 'fixtures' | 'storage'
type Env = Record<string, string | undefined>
type Inputs = Record<string, unknown>

const WORKFLOWS: readonly Workflow[] = ['approve', 'publish', 'unpublish', 'verify']
const JOBS: readonly Job[] = ['fixtures', 'storage']
const EVENT_PATH = '/run/event.json'
const EVENT_MAX = 1_048_576
const BASE_ENV: Readonly<Env> = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_EVENT_PATH: EVENT_PATH,
  GITHUB_REF: 'refs/heads/main',
  GITHUB_RUN_ATTEMPT: '1',
}
const SIX_NAMES = [
  'GITHUB_ACTIONS',
  'GITHUB_EVENT_NAME',
  'GITHUB_EVENT_PATH',
  'GITHUB_REF',
  'GITHUB_RUN_ATTEMPT',
  'RUNNER_DEBUG',
]
const PREFIX = 'a1b2c3d4e5f6'
/** answersOf-shaped strings (approve.test.ts): public facts of a two-language, pictureless story. */
const ANSWERS: Readonly<Record<string, string>> = {
  'languages-read': 'en,hi',
  'all-nodes-read': 'yes',
  'images-viewed': '0',
  'narration-check': 'Listened to every clip',
  devices: 'iPad, phone',
  'checklist-complete': 'yes',
}

/** The closed set of helper lines (TP16-2, §3.9.3), written out here, not read from the helper. */
const RULE_TEXT: Readonly<Record<string, string>> = {
  mode: "is not one of the workflow's modes",
  'story-id': 'is not a story id',
  'package-prefix': 'is not 12 to 64 lowercase hex characters',
  'languages-read': 'is not a string',
  'images-viewed': 'is not a string',
  'narration-check': 'is not a string',
  devices: 'is not a string',
  'all-nodes-read': 'is not yes or no',
  'checklist-complete': 'is not yes or no',
  'story-ids': 'is not up to 64 story ids one space apart',
  feature: 'is not empty, none or a story id',
  snapshot: 'is not empty or a whole number from 1',
  deep: 'is not true or false',
}
const LINE = {
  usage: 'dispatch: usage',
  platform: 'dispatch: runs in GitHub Actions on linux only',
  event: 'dispatch: the event is not a workflow_dispatch',
  ref: 'dispatch: storage modes run from main only',
  attempt: 'dispatch: a re-run is refused; dispatch a new run from main',
  debug: 'dispatch: debug logging is on; dispatch without it',
  file: 'dispatch: the event file is not a readable JSON object',
  inputs: "dispatch: the inputs differ from the workflow's",
  modeJob: 'dispatch: input mode does not match the job',
  tooLong: 'dispatch: the answers are too long',
  stopped: 'dispatch: the publisher did not start or was stopped',
  internal: 'dispatch: internal error',
} as const
const ruleLine = (name: string) => `dispatch: input ${name} ${RULE_TEXT[name]}`
const CLOSED_LINES = new Set<string>([
  ...Object.values(LINE),
  ...Object.keys(RULE_TEXT).map(ruleLine),
])

const encode = (text: string) => new TextEncoder().encode(text)
const eventOf = (inputs: unknown) => encode(JSON.stringify({ inputs, ref: 'refs/heads/main' }))
const modeFor = (workflow: Workflow, job: Job) =>
  job === 'fixtures' ? 'fixtures' : workflow === 'verify' ? 'run' : 'dry-run'

/** A valid inputs object for each workflow, in the workflow file's order. */
function inputsOf(workflow: Workflow, mode: string): Inputs {
  switch (workflow) {
    case 'approve':
      return { mode, 'story-id': 'lantern-walk', 'package-prefix': PREFIX, ...ANSWERS }
    case 'publish':
      return { mode, 'story-ids': 'lantern-walk river-stones', feature: '', snapshot: '' }
    case 'unpublish':
      return { mode, 'story-id': 'river-stones' }
    case 'verify':
      return { mode, deep: false }
  }
}

const without = (record: Readonly<Record<string, unknown>>, ...names: string[]) =>
  Object.fromEntries(Object.entries(record).filter(([name]) => !names.includes(name)))

/** Every refusal line planOf saw, for T16-3 g4's closed-set check. */
const seenLines: string[] = []

interface PlanRun {
  readonly plan: DispatchPlan
  readonly reads: [string, number][]
}

/** planDispatch with a recording readFile; the event is `bytes`, or `inputs` as an event file. */
function planOf(options: {
  readonly argv: readonly string[]
  readonly env?: Readonly<Env>
  readonly platform?: string
  readonly bytes?: Uint8Array
  readonly inputs?: unknown
  readonly read?: () => Uint8Array
}): PlanRun {
  const reads: [string, number][] = []
  const plan = planDispatch(options.argv, {
    env: options.env ?? BASE_ENV,
    platform: options.platform ?? 'linux',
    readFile: (path, maxBytes) => {
      reads.push([path, maxBytes])
      if (options.read !== undefined) return options.read()
      return options.bytes ?? eventOf(options.inputs)
    },
  })
  if (!plan.ok) seenLines.push(plan.line)
  return { plan, reads }
}

/** The base sample of a workflow and job, with `inputs` changed by `change`. */
function sample(
  workflow: Workflow,
  job: Job,
  extra: { readonly env?: Readonly<Env>; readonly platform?: string } = {},
  change: (inputs: Inputs) => unknown = (inputs) => inputs,
): PlanRun {
  return planOf({
    argv: [workflow, job],
    inputs: change(inputsOf(workflow, modeFor(workflow, job))),
    ...extra,
  })
}

const lineOf = (plan: DispatchPlan) => (plan.ok ? 'planned ok' : plan.line)
const argvOf = (plan: DispatchPlan) => (plan.ok ? plan.argv : plan.line)
const envWith = (name: string, value: string | undefined): Env => {
  const env: Env = { ...BASE_ENV }
  if (value === undefined) delete env[name]
  else env[name] = value
  return env
}

describe('publisher-dispatch planDispatch', () => {
  it('T16-1 checks 1 to 4c in order: argv, platform and GITHUB_ACTIONS, the event name, the ref, the run attempt and debug logging; each refusal one fixed line, exit 2, the event file unread (A6, CRIT-4, CRIT-8, CRIT-9, TP16-4)', () => {
    for (const workflow of WORKFLOWS) {
      for (const job of JOBS) {
        expect(
          lineOf(sample(workflow, job).plan),
          `precondition: the base sample plans ok: ${workflow} ${job}`,
        ).toBe('planned ok')
      }
    }
    const refusalReads: number[] = []
    const refused = (run: PlanRun) => {
      refusalReads.push(run.reads.length)
      return lineOf(run.plan)
    }

    // g1: argv is exactly [workflow, job] from the two sets.
    const usage: string[][] = [
      [],
      ['approve'],
      ['approve', 'fixtures', 'x'],
      ['APPROVE', 'fixtures'],
      ['approve', 'Storage'],
      [' approve', 'fixtures'],
      ['stage', 'fixtures'],
      ['takedown', 'storage'],
      ['__proto__', 'fixtures'],
      ['approve', 'constructor'],
      ['approve', 'fixtures\u0000'],
    ]
    for (const argv of usage) {
      const run = planOf({ argv, inputs: inputsOf('approve', 'fixtures') })
      expect.soft(refused(run), `(g1) the usage line: ${JSON.stringify(argv)}`).toBe(LINE.usage)
    }

    // g2: linux and GITHUB_ACTIONS exactly 'true'.
    for (const platform of ['win32', 'darwin']) {
      const run = sample('approve', 'fixtures', { platform })
      expect.soft(refused(run), `(g2) the platform line: ${platform}`).toBe(LINE.platform)
    }
    for (const value of ['TRUE', 'true ', '1', '', undefined]) {
      const run = sample('approve', 'fixtures', { env: envWith('GITHUB_ACTIONS', value) })
      expect
        .soft(refused(run), `(g2) the platform line: GITHUB_ACTIONS ${value}`)
        .toBe(LINE.platform)
    }

    // g3: GITHUB_EVENT_NAME exactly workflow_dispatch.
    for (const value of [
      'push',
      'pull_request',
      'pull_request_target',
      'schedule',
      'workflow_dispatch ',
      'WORKFLOW_DISPATCH',
      '',
      undefined,
    ]) {
      const run = sample('publish', 'fixtures', { env: envWith('GITHUB_EVENT_NAME', value) })
      expect.soft(refused(run), `(g3) the event line: ${JSON.stringify(value)}`).toBe(LINE.event)
    }

    // g4: the storage job runs from refs/heads/main only (case-sensitive); fixtures from any ref.
    for (const value of [
      'refs/heads/Main',
      'refs/heads/MAIN',
      'refs/heads/main/x',
      'refs/heads/main ',
      'refs/heads/mainx',
      'refs/tags/main',
      'refs/pull/1/merge',
      'refs%2Fheads%2Fmain',
      'refs\\heads\\main',
      `${String.fromCodePoint(0xfeff)}refs/heads/main`,
      'refs/heads/feature',
      '',
      undefined,
    ]) {
      for (const workflow of WORKFLOWS) {
        const run = sample(workflow, 'storage', { env: envWith('GITHUB_REF', value) })
        expect
          .soft(refused(run), `(g4) the ref line: ${workflow} ${JSON.stringify(value)}`)
          .toBe(LINE.ref)
      }
    }
    for (const value of ['refs/heads/feature', 'refs/tags/main']) {
      const run = sample('verify', 'fixtures', { env: envWith('GITHUB_REF', value) })
      expect.soft(lineOf(run.plan), `(g4) the fixtures job plans from ${value}`).toBe('planned ok')
    }

    // g5: the storage job needs GITHUB_RUN_ATTEMPT exactly '1'; fixtures may be re-run.
    for (const value of ['2', '', '01', ' 1', '1.0', undefined]) {
      const run = sample('publish', 'storage', { env: envWith('GITHUB_RUN_ATTEMPT', value) })
      expect.soft(refused(run), `(g5) the re-run line: ${JSON.stringify(value)}`).toBe(LINE.attempt)
    }
    const rerun = sample('publish', 'fixtures', { env: envWith('GITHUB_RUN_ATTEMPT', '2') })
    expect.soft(lineOf(rerun.plan), '(g5) the fixtures job plans on attempt 2').toBe('planned ok')

    // g6: the storage job refuses RUNNER_DEBUG set to any value, the empty string included.
    for (const value of ['1', '0', '']) {
      const run = sample('unpublish', 'storage', { env: envWith('RUNNER_DEBUG', value) })
      expect.soft(refused(run), `(g6) the debug line: ${JSON.stringify(value)}`).toBe(LINE.debug)
    }
    const debugFixtures = sample('unpublish', 'fixtures', { env: envWith('RUNNER_DEBUG', '1') })
    expect
      .soft(lineOf(debugFixtures.plan), '(g6) the fixtures job plans with RUNNER_DEBUG')
      .toBe('planned ok')

    // g7: the earlier check wins, and no refusal of checks 1 to 4c read the event file.
    const both = (env: Env, name: string, value: string | undefined) => {
      if (value === undefined) delete env[name]
      else env[name] = value
      return env
    }
    const order: [string, PlanRun, string][] = [
      ['1 and 2', planOf({ argv: [], platform: 'win32', inputs: {} }), LINE.usage],
      [
        '2 and 3',
        sample('approve', 'storage', {
          platform: 'win32',
          env: envWith('GITHUB_EVENT_NAME', 'push'),
        }),
        LINE.platform,
      ],
      [
        '3 and 4',
        sample('approve', 'storage', {
          env: both(envWith('GITHUB_EVENT_NAME', 'push'), 'GITHUB_REF', 'refs/heads/feature'),
        }),
        LINE.event,
      ],
      [
        '4 and 4b',
        sample('approve', 'storage', {
          env: both(envWith('GITHUB_REF', 'refs/heads/feature'), 'GITHUB_RUN_ATTEMPT', '2'),
        }),
        LINE.ref,
      ],
      [
        '4b and 4c',
        sample('approve', 'storage', {
          env: both(envWith('GITHUB_RUN_ATTEMPT', '2'), 'RUNNER_DEBUG', '1'),
        }),
        LINE.attempt,
      ],
      [
        '4c and 5',
        sample('approve', 'storage', {
          env: both(envWith('RUNNER_DEBUG', '1'), 'GITHUB_EVENT_PATH', ''),
        }),
        LINE.debug,
      ],
    ]
    for (const [label, run, line] of order) {
      expect
        .soft(refused(run), `(g7) a sample failing checks ${label} gets the earlier line`)
        .toBe(line)
    }
    expect(refusalReads.length, 'precondition: the g1-g7 refusals ran').toBeGreaterThan(50)
    expect
      .soft(
        refusalReads.filter((count) => count !== 0).length,
        '(g7) the event file was read 0 times in every refusal of checks 1 to 4c',
      )
      .toBe(0)
  })

  it('T16-2 check 5 reads the event file under a 1 MiB cap as strict UTF-8 JSON with an inputs object; check 6 refuses any undeclared or missing required key and gives a missing optional key its YAML default (A6, CRIT-5, CRIT-7)', () => {
    const json = JSON.stringify({ inputs: inputsOf('approve', 'fixtures') })
    const padded = json + ' '.repeat(EVENT_MAX - encode(json).byteLength)
    const exact = planOf({ argv: ['approve', 'fixtures'], bytes: encode(padded) })
    expect(encode(padded).byteLength, 'precondition: the padded event is exactly 1 MiB').toBe(
      EVENT_MAX,
    )
    expect(lineOf(exact.plan), 'precondition: a 1,048,576-byte event plans ok').toBe('planned ok')
    expect(exact.reads, 'precondition: readFile was called once with the path and cap').toEqual([
      [EVENT_PATH, EVENT_MAX],
    ])

    // g1: the event file refusals.
    const approveFixtures = ['approve', 'fixtures']
    const narrationWith = (bad: number[]) => {
      const text = JSON.stringify({
        inputs: { ...inputsOf('approve', 'fixtures'), 'narration-check': '@@' },
      })
      const [head, tail] = text.split('@@') as [string, string]
      return Uint8Array.from([...encode(head), ...bad, ...encode(tail)])
    }
    const fileSamples: [string, PlanRun][] = [
      [
        'GITHUB_EVENT_PATH empty',
        planOf({ argv: approveFixtures, env: envWith('GITHUB_EVENT_PATH', ''), inputs: {} }),
      ],
      [
        'GITHUB_EVENT_PATH missing',
        planOf({ argv: approveFixtures, env: envWith('GITHUB_EVENT_PATH', undefined) }),
      ],
      [
        'readFile throws ENOENT',
        planOf({
          argv: approveFixtures,
          read: () => {
            throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
          },
        }),
      ],
      ['1,048,577 bytes', planOf({ argv: approveFixtures, bytes: encode(`${padded} `) })],
      [
        'a UTF-8 BOM before valid JSON',
        planOf({
          argv: approveFixtures,
          bytes: Uint8Array.from([0xef, 0xbb, 0xbf, ...encode(json)]),
        }),
      ],
      [
        'C3 28 inside an answer',
        planOf({ argv: approveFixtures, bytes: narrationWith([0xc3, 0x28]) }),
      ],
      [
        'ED A0 80 inside an answer',
        planOf({ argv: approveFixtures, bytes: narrationWith([0xed, 0xa0, 0x80]) }),
      ],
      ['[]', planOf({ argv: approveFixtures, bytes: encode('[]') })],
      ['null', planOf({ argv: approveFixtures, bytes: encode('null') })],
      ['"x"', planOf({ argv: approveFixtures, bytes: encode('"x"') })],
      ['{"inputs":[]}', planOf({ argv: approveFixtures, bytes: encode('{"inputs":[]}') })],
      ['{"inputs":"x"}', planOf({ argv: approveFixtures, bytes: encode('{"inputs":"x"}') })],
      ['{"inputs":1}', planOf({ argv: approveFixtures, bytes: encode('{"inputs":1}') })],
      ['truncated JSON', planOf({ argv: approveFixtures, bytes: encode(json.slice(0, -1)) })],
      ['0 bytes', planOf({ argv: approveFixtures, bytes: new Uint8Array() })],
    ]
    for (const [label, run] of fileSamples) {
      expect.soft(lineOf(run.plan), `(g1) the event file line: ${label}`).toBe(LINE.file)
    }
    expect
      .soft(
        fileSamples.slice(0, 2).map(([, run]) => run.reads.length),
        '(g1) an empty or missing GITHUB_EVENT_PATH reads nothing',
      )
      .toEqual([0, 0])

    // g2: undeclared or missing required keys; the line never names a key.
    const canaryKey = ['S16', 'KEY', 'CANARY'].join('')
    const keyed = (workflow: Workflow, change: (inputs: Inputs) => unknown) =>
      sample(workflow, 'fixtures', {}, change)
    const rawProto = encode(
      JSON.stringify({ inputs: inputsOf('approve', 'fixtures') }).replace(
        '{"inputs":{',
        '{"inputs":{"__proto__":{"mode":"run"},',
      ),
    )
    const keySamples: [string, PlanRun][] = [
      ['an extra key x', keyed('approve', (inputs) => ({ ...inputs, x: 'y' }))],
      ['an own __proto__ key', planOf({ argv: approveFixtures, bytes: rawProto })],
      [
        'Mode for mode',
        keyed('publish', (inputs) => ({ ...without(inputs, 'mode'), Mode: 'fixtures' })),
      ],
      [
        'story_id for story-id',
        keyed('unpublish', (inputs) => ({
          ...without(inputs, 'story-id'),
          story_id: 'river-stones',
        })),
      ],
      ...[
        'story-id',
        'package-prefix',
        'languages-read',
        'images-viewed',
        'narration-check',
        'devices',
      ].map((name): [string, PlanRun] => [
        `approve without ${name}`,
        keyed('approve', (inputs) => without(inputs, name)),
      ]),
      ['unpublish without story-id', keyed('unpublish', (inputs) => without(inputs, 'story-id'))],
      ['{} for approve', keyed('approve', () => ({}))],
      ['{} for unpublish', keyed('unpublish', () => ({}))],
      ['the canary key', keyed('verify', (inputs) => ({ ...inputs, [canaryKey]: 'v' }))],
    ]
    for (const [label, run] of keySamples) {
      expect.soft(lineOf(run.plan), `(g2) the inputs line: ${label}`).toBe(LINE.inputs)
      expect
        .soft(lineOf(run.plan).includes(canaryKey), `(g2) no key in the line: ${label}`)
        .toBe(false)
    }

    // g3: a missing optional key takes its YAML default; inputs missing or null read as {}.
    const stdinOf = (plan: DispatchPlan) =>
      plan.ok && plan.stdin !== null
        ? (JSON.parse(new TextDecoder().decode(plan.stdin)) as Record<string, string>)
        : null
    const approveOk = (name: string) =>
      sample('approve', 'fixtures', {}, (inputs) => without(inputs, name)).plan
    expect
      .soft(argvOf(approveOk('mode')), '(g3) approve without mode plans as mode fixtures')
      .toEqual([
        'approve',
        'lantern-walk',
        '--package',
        PREFIX,
        '--answers-stdin',
        '--dry-run',
        '--fixtures',
      ])
    expect
      .soft(
        lineOf(sample('approve', 'storage', {}, (inputs) => without(inputs, 'mode')).plan),
        '(g3) approve storage without mode refuses at check 8 (the default is fixtures)',
      )
      .toBe(LINE.modeJob)
    expect
      .soft(
        stdinOf(approveOk('all-nodes-read'))?.['all-nodes-read'],
        '(g3) all-nodes-read defaults to no',
      )
      .toBe('no')
    expect
      .soft(
        stdinOf(approveOk('checklist-complete'))?.['checklist-complete'],
        '(g3) checklist-complete defaults to no',
      )
      .toBe('no')
    const publishFull: Inputs = {
      mode: 'fixtures',
      'story-ids': 'lantern-walk',
      feature: 'two-paths',
      snapshot: '3',
    }
    const publishWithout = (name: string) =>
      argvOf(planOf({ argv: ['publish', 'fixtures'], inputs: without(publishFull, name) }).plan)
    const tail = ['--dry-run', '--fixtures']
    expect
      .soft(publishWithout('mode'), '(g3) publish without mode')
      .toEqual(['publish', 'lantern-walk', '--feature', 'two-paths', '--snapshot', '3', ...tail])
    expect
      .soft(publishWithout('story-ids'), '(g3) publish without story-ids')
      .toEqual(['publish', '--feature', 'two-paths', '--snapshot', '3', ...tail])
    expect
      .soft(publishWithout('feature'), '(g3) publish without feature')
      .toEqual(['publish', 'lantern-walk', '--snapshot', '3', ...tail])
    expect
      .soft(publishWithout('snapshot'), '(g3) publish without snapshot')
      .toEqual(['publish', 'lantern-walk', '--feature', 'two-paths', ...tail])
    const emptyLike: [string, Uint8Array][] = [
      ['inputs {}', eventOf({})],
      ['no inputs property', encode(JSON.stringify({ ref: 'refs/heads/main' }))],
      ['inputs null', encode(JSON.stringify({ inputs: null, ref: 'refs/heads/main' }))],
    ]
    for (const [label, bytes] of emptyLike) {
      expect
        .soft(
          argvOf(planOf({ argv: ['publish', 'fixtures'], bytes }).plan),
          `(g3) publish, ${label}`,
        )
        .toEqual(['publish', ...tail])
      expect
        .soft(argvOf(planOf({ argv: ['verify', 'fixtures'], bytes }).plan), `(g3) verify, ${label}`)
        .toEqual(['verify', '--fixtures'])
      for (const workflow of ['approve', 'unpublish'] as const) {
        expect
          .soft(
            lineOf(planOf({ argv: [workflow, 'fixtures'], bytes }).plan),
            `(g3) ${workflow}, ${label}: required inputs missing`,
          )
          .toBe(LINE.inputs)
      }
    }
    expect
      .soft(
        argvOf(sample('unpublish', 'fixtures', {}, (inputs) => without(inputs, 'mode')).plan),
        '(g3) unpublish without mode',
      )
      .toEqual(['publish', '--unpublish', 'river-stones', ...tail])
    expect
      .soft(
        argvOf(sample('verify', 'fixtures', {}, (inputs) => without(inputs, 'mode')).plan),
        '(g3) verify without mode',
      )
      .toEqual(['verify', '--fixtures'])
    expect
      .soft(
        argvOf(
          sample('verify', 'storage', {}, (inputs) => without({ ...inputs, deep: true }, 'deep'))
            .plan,
        ),
        '(g3) verify without deep has no --deep',
      )
      .toEqual(['verify'])
  })

  it('T16-3 check 7 applies each input rule in table order with its fixed line, check 8 matches mode to the job, and no refusal line holds an input value (A6, TP16-2)', () => {
    const fixtures = (workflow: Workflow, change: (inputs: Inputs) => unknown) =>
      sample(workflow, 'fixtures', {}, change).plan
    const set = (name: string, value: unknown) => (inputs: Inputs) => ({ ...inputs, [name]: value })
    const ids64 = Array.from({ length: 64 }, (_, i) => `id-${i}`)
    const positives: [string, DispatchPlan][] = [
      ['story-id of 3', fixtures('approve', set('story-id', 'abc'))],
      ['story-id of 64', fixtures('unpublish', set('story-id', 'a'.repeat(64)))],
      ['prefix of 12', fixtures('approve', set('package-prefix', '0123456789ab'))],
      ['prefix of 64', fixtures('approve', set('package-prefix', 'f'.repeat(64)))],
      ['snapshot of 16 digits', fixtures('publish', set('snapshot', '9999999999999999'))],
      ['64 ids one space apart', fixtures('publish', set('story-ids', ids64.join(' ')))],
      [
        "'' for each optional string",
        fixtures('publish', (inputs) => ({
          ...inputs,
          'story-ids': '',
          feature: '',
          snapshot: '',
        })),
      ],
      ['feature none', fixtures('publish', set('feature', 'none'))],
      ...['languages-read', 'images-viewed', 'narration-check', 'devices'].flatMap(
        (name): [string, DispatchPlan][] => [
          [`${name} ''`, fixtures('approve', set(name, ''))],
          [`${name} a lone surrogate`, fixtures('approve', set(name, '\ud800'))],
        ],
      ),
      ...[true, false, 'true', 'false'].map((deep): [string, DispatchPlan] => [
        `deep ${JSON.stringify(deep)}`,
        fixtures('verify', set('deep', deep)),
      ]),
    ]
    for (const [label, plan] of positives) {
      expect(lineOf(plan), `precondition: a positive near miss plans ok: ${label}`).toBe(
        'planned ok',
      )
    }

    // g1: each rule with its fixed line.
    const badIds: unknown[] = [
      '',
      'A-b',
      'ab',
      'a--b',
      '-ab',
      'ab-',
      'a b',
      'ab;rm',
      'ab$(x)',
      'ab`x`',
      'ab\n',
      'ab\u0000',
      `ab${String.fromCodePoint(0x2028)}`,
      `ab${String.fromCodePoint(0x202e)}`,
      `${String.fromCodePoint(0x430)}b`,
      'a%62c',
      'a\\bc',
      `${String.fromCodePoint(0xfeff)}abc`,
      '\ud800ab',
      'a'.repeat(65),
      123,
      null,
      true,
      [],
      {},
      '--takedown',
      '-x',
    ]
    const ruleSamples: [Workflow, string, unknown][] = [
      ...badIds.flatMap((value): [Workflow, string, unknown][] => [
        ['approve', 'story-id', value],
        ['unpublish', 'story-id', value],
      ]),
      ...[
        '0123456789a',
        'f'.repeat(65),
        'A1B2C3D4E5F6',
        `${PREFIX}\n`,
        ` ${PREFIX}`,
        123456789012,
      ].map((value): [Workflow, string, unknown] => ['approve', 'package-prefix', value]),
      ...['Yes', 'YES', 'true', true, '', 'y'].flatMap((value): [Workflow, string, unknown][] => [
        ['approve', 'all-nodes-read', value],
        ['approve', 'checklist-complete', value],
      ]),
      ...[
        ' ',
        'a-b  c-d',
        ' a-b',
        'a-b ',
        'a-b\tc-d',
        'a-b\nc-d',
        'A-B',
        '-ab',
        [...ids64, 'id-64'].join(' '),
        'a'.repeat(65),
      ].map((value): [Workflow, string, unknown] => ['publish', 'story-ids', value]),
      ...['None', 'NONE', 'none ', '--takedown', '-ab'].map(
        (value): [Workflow, string, unknown] => ['publish', 'feature', value],
      ),
      ...['0', '01', '1.0', '-1', '1e3', ' 1', '1 ', '1'.repeat(17), 1].map(
        (value): [Workflow, string, unknown] => ['publish', 'snapshot', value],
      ),
      ...['True', '1', 1, null, 'yes'].map((value): [Workflow, string, unknown] => [
        'verify',
        'deep',
        value,
      ]),
      ...['Fixtures', 'run ', 'RUN', ''].flatMap((value): [Workflow, string, unknown][] =>
        WORKFLOWS.map((workflow): [Workflow, string, unknown] => [workflow, 'mode', value]),
      ),
      ['verify', 'mode', 'dry-run'],
      ...['languages-read', 'images-viewed', 'narration-check', 'devices'].flatMap(
        (name): [Workflow, string, unknown][] =>
          [123, null, true, [], {}].map((value): [Workflow, string, unknown] => [
            'approve',
            name,
            value,
          ]),
      ),
    ]
    for (const [workflow, name, value] of ruleSamples) {
      expect
        .soft(
          lineOf(fixtures(workflow, set(name, value))),
          `(g1) ${workflow} ${name} ${JSON.stringify(value)}`,
        )
        .toBe(ruleLine(name))
    }

    // g2: table order, not the event's key order.
    const reordered = planOf({
      argv: ['approve', 'fixtures'],
      inputs: {
        mode: 'fixtures',
        'package-prefix': 'NOT-HEX',
        'story-id': 'NOT AN ID',
        ...ANSWERS,
      },
    }).plan
    expect
      .soft(lineOf(reordered), '(g2) package-prefix listed first, both bad: the story-id line')
      .toBe(ruleLine('story-id'))

    // g3: check 8, the mode against the job.
    for (const workflow of WORKFLOWS) {
      const wrong: [Job, string][] = [
        ['storage', 'fixtures'],
        ['fixtures', 'run'],
        ...(workflow === 'verify' ? [] : ([['fixtures', 'dry-run']] as [Job, string][])),
      ]
      for (const [job, mode] of wrong) {
        const plan = planOf({ argv: [workflow, job], inputs: inputsOf(workflow, mode) }).plan
        expect
          .soft(lineOf(plan), `(g3) ${workflow} job ${job} with mode ${mode}`)
          .toBe(LINE.modeJob)
      }
    }

    // g4: every refusal line is in the closed set, and none holds an input value in any form.
    const canary = ['S16', 'INPUT', 'CANARY'].join('')
    const canaryValues = [canary, `${canary} é "q" / \\ \n`]
    const canarySamples: [Workflow, string, unknown][] = WORKFLOWS.flatMap((workflow) =>
      DISPATCH_INPUTS[workflow].flatMap((input): [Workflow, string, unknown][] =>
        ['languages-read', 'images-viewed', 'narration-check', 'devices'].includes(input.name)
          ? [
              [workflow, input.name, [canary]],
              [workflow, input.name, { [canary]: canaryValues[1] }],
            ]
          : canaryValues.map((value): [Workflow, string, unknown] => [workflow, input.name, value]),
      ),
    )
    const refusedNames = new Set<string>()
    for (const [workflow, name, value] of canarySamples) {
      const line = lineOf(fixtures(workflow, set(name, value)))
      if (line.startsWith(`dispatch: input ${name} `)) refusedNames.add(`${workflow} ${name}`)
      const forms = [value, ...(Array.isArray(value) ? value : []), ...canaryValues]
        .filter((form): form is string => typeof form === 'string')
        .flatMap((form) => [form, JSON.stringify(form).slice(1, -1), encodeURIComponent(form)])
      expect
        .soft(
          forms.filter((form) => line.includes(form)).length +
            (line.toLowerCase().includes(canary.toLowerCase()) ? 1 : 0),
          `(g4) no canary in the line: ${workflow} ${name}`,
        )
        .toBe(0)
    }
    const declaredNames = WORKFLOWS.flatMap((workflow) =>
      DISPATCH_INPUTS[workflow].map((input) => `${workflow} ${input.name}`),
    )
    expect(declaredNames.length, 'precondition: the input table is not empty').toBeGreaterThan(12)
    expect(
      declaredNames.filter((name) => !refusedNames.has(name)),
      'precondition: at least one canary refusal per input name',
    ).toEqual([])
    expect(seenLines.length, 'precondition: refusal lines were seen').toBeGreaterThan(100)
    expect
      .soft(
        [...new Set(seenLines)].filter((line) => !CLOSED_LINES.has(line)),
        '(g4) every refusal line is in the closed set',
      )
      .toEqual([])
  })

  it('T16-4 argv and stdin as §3.9.4 builds them; over 200 or more accepted generated inputs per workflow argv never holds --takedown, --report-dir or --timeout-ms; approve stdin is exactly the six answers in ANSWER_KEYS order as JSON plus LF, which answers.ts accepts (A6, A24, CRIT-7)', async () => {
    // g1: exact argv.
    const approveHead = ['approve', 'lantern-walk', '--package', PREFIX, '--answers-stdin']
    const exactSamples: [string, DispatchPlan, readonly string[]][] = [
      [
        'approve fixtures',
        sample('approve', 'fixtures').plan,
        [...approveHead, '--dry-run', '--fixtures'],
      ],
      ['approve dry-run', sample('approve', 'storage').plan, [...approveHead, '--dry-run']],
      [
        'approve run',
        planOf({ argv: ['approve', 'storage'], inputs: inputsOf('approve', 'run') }).plan,
        approveHead,
      ],
    ]
    const publish = (inputs: Inputs, job: Job = 'fixtures') =>
      planOf({ argv: ['publish', job], inputs: { mode: modeFor('publish', job), ...inputs } }).plan
    const fx = ['--dry-run', '--fixtures']
    exactSamples.push(
      [
        'publish ids only',
        publish({ 'story-ids': 'lantern-walk' }),
        ['publish', 'lantern-walk', ...fx],
      ],
      ['publish two ids', publish({ 'story-ids': 'a-b c-d' }), ['publish', 'a-b', 'c-d', ...fx]],
      [
        'publish feature only',
        publish({ feature: 'two-paths' }),
        ['publish', '--feature', 'two-paths', ...fx],
      ],
      [
        'publish feature none',
        publish({ feature: 'none' }),
        ['publish', '--feature', 'none', ...fx],
      ],
      ['publish snapshot only', publish({ snapshot: '3' }), ['publish', '--snapshot', '3', ...fx]],
      [
        'publish ids and feature',
        publish({ 'story-ids': 'lantern-walk', feature: 'two-paths' }),
        ['publish', 'lantern-walk', '--feature', 'two-paths', ...fx],
      ],
      [
        'publish snapshot and feature',
        publish({ snapshot: '3', feature: 'two-paths' }),
        ['publish', '--feature', 'two-paths', '--snapshot', '3', ...fx],
      ],
      [
        'publish dry-run',
        publish({ 'story-ids': 'lantern-walk' }, 'storage'),
        ['publish', 'lantern-walk', '--dry-run'],
      ],
    )
    for (const [mode, job, flags] of [
      ['fixtures', 'fixtures', fx],
      ['dry-run', 'storage', ['--dry-run']],
      ['run', 'storage', []],
    ] as const) {
      exactSamples.push([
        `unpublish ${mode}`,
        planOf({ argv: ['unpublish', job], inputs: inputsOf('unpublish', mode) }).plan,
        ['publish', '--unpublish', 'river-stones', ...flags],
      ])
    }
    for (const deep of [true, false]) {
      exactSamples.push(
        [
          `verify fixtures deep ${deep}`,
          planOf({ argv: ['verify', 'fixtures'], inputs: { mode: 'fixtures', deep } }).plan,
          ['verify', ...(deep ? ['--deep'] : []), '--fixtures'],
        ],
        [
          `verify run deep ${deep}`,
          planOf({ argv: ['verify', 'storage'], inputs: { mode: 'run', deep } }).plan,
          ['verify', ...(deep ? ['--deep'] : [])],
        ],
      )
    }
    for (const [label, plan, argv] of exactSamples) {
      expect.soft(argvOf(plan), `(g1) exact argv: ${label}`).toEqual(argv)
    }

    // g2: stdin bytes.
    const ordered = Object.fromEntries(ANSWER_KEYS.map((key) => [key, ANSWERS[key]]))
    const expectedBytes = encode(`${JSON.stringify(ordered)}\n`)
    const stdinBytes = (plan: DispatchPlan) =>
      plan.ok && plan.stdin !== null ? [...plan.stdin] : null
    const approvePlan = sample('approve', 'fixtures').plan
    expect(approvePlan.ok, 'precondition: the approve sample plans ok').toBe(true)
    expect
      .soft(stdinBytes(approvePlan), '(g2) the six answers in ANSWER_KEYS order plus LF')
      .toEqual([...expectedBytes])
    const reversedInputs: Inputs = {
      mode: 'fixtures',
      'story-id': 'lantern-walk',
      'package-prefix': PREFIX,
    }
    for (const key of [...ANSWER_KEYS].reverse()) reversedInputs[key] = ANSWERS[key]
    expect
      .soft(
        stdinBytes(planOf({ argv: ['approve', 'fixtures'], inputs: reversedInputs }).plan),
        '(g2) the event key order does not change the bytes',
      )
      .toEqual([...expectedBytes])
    for (const workflow of ['publish', 'unpublish', 'verify'] as const) {
      const plan = sample(workflow, 'fixtures').plan
      expect.soft(plan.ok && plan.stdin, `(g2) ${workflow} has no stdin`).toBeNull()
    }
    const withAnswer = (name: string, value: string) =>
      sample('approve', 'fixtures', {}, (inputs) => ({ ...inputs, [name]: value })).plan
    const quoted = withAnswer('narration-check', 'say "hi" \\ there')
    const decoded = (plan: DispatchPlan): Record<string, string> | null => {
      if (!plan.ok || plan.stdin === null) return null
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(plan.stdin)
        return JSON.parse(text) as Record<string, string>
      } catch {
        return { 'narration-check': 'not strict UTF-8 JSON' }
      }
    }
    expect
      .soft(decoded(quoted)?.['narration-check'], '(g2) a quote and a backslash round-trip')
      .toBe('say "hi" \\ there')
    const accented = withAnswer('narration-check', 'é ✓')
    const accentedBytes = stdinBytes(accented) ?? []
    const needle = [...encode('é ✓')]
    expect
      .soft(
        accentedBytes.some((_, i) => needle.every((byte, j) => accentedBytes[i + j] === byte)),
        '(g2) é ✓ crosses byte-exact',
      )
      .toBe(true)
    const surrogate = withAnswer('narration-check', '\ud800')
    const surrogateText =
      surrogate.ok && surrogate.stdin !== null ? new TextDecoder().decode(surrogate.stdin) : ''
    expect
      .soft(surrogateText.includes('\\ud800'), '(g2) a lone surrogate is the escape \\ud800')
      .toBe(true)
    const surrogateBytes = stdinBytes(surrogate) ?? []
    expect
      .soft(
        surrogateBytes.some(
          (byte, i) =>
            byte === 0xef && surrogateBytes[i + 1] === 0xbf && surrogateBytes[i + 2] === 0xbd,
        ),
        '(g2) and no EF BF BD',
      )
      .toBe(false)

    // g3: the bytes through the real answers channel.
    const never = new Promise<void>(() => {})
    const through = (plan: DispatchPlan) =>
      readAnswersStream(
        Readable.from([
          Buffer.from(plan.ok && plan.stdin !== null ? plan.stdin : new Uint8Array()),
        ]),
        never,
      )
    const good = await through(approvePlan)
    expect
      .soft(
        good.ok ? Object.fromEntries(good.answers) : good.code,
        '(g3) answers.ts reads the six answers',
      )
      .toEqual(ordered)
    const bad = await through(surrogate)
    const facts = {
      storyId: 'lantern-walk',
      packageSha256: '0'.repeat(64),
      version: 1,
      locales: ['en', 'hi'] as const,
      nodeCount: 5,
      imageCount: 0,
    }
    expect
      .soft(
        bad.ok
          ? reviewFromAnswers(bad.answers, { ...facts, locales: [...facts.locales] })
          : bad.code,
        '(g3) a lone surrogate answer is answers-invalid',
      )
      .toEqual({ ok: false, code: 'answers-invalid', key: 'narration-check' })

    // g4: the property over generated inputs.
    const hostile = fc.oneof(
      fc.constantFrom(
        '--takedown',
        '--report-dir',
        '--timeout-ms',
        '-x',
        '--deep',
        'a b',
        'a\nb',
        'a\u0000b',
        '',
        ' ',
        'none',
        'None',
        'run',
        'fixtures',
        'dry-run',
        '0',
        '01',
        'true',
        'yes',
      ),
      fc.string(),
      fc.integer(),
      fc.constant(null),
      fc.array(fc.string(), { maxLength: 2 }),
      fc.boolean(),
    )
    const either = <T>(valid: fc.Arbitrary<T>) =>
      fc.oneof({ arbitrary: valid, weight: 20 }, { arbitrary: hostile, weight: 1 })
    const id = fc
      .stringMatching(/^[a-z0-9]{1,6}(?:-[a-z0-9]{1,6}){0,2}$/)
      .filter((value) => value.length >= 3)
    const ids = fc.array(id, { minLength: 1, maxLength: 4 }).map((parts) => parts.join(' '))
    const modes = fc.constantFrom('fixtures', 'dry-run', 'run')
    const free = either(fc.string())
    const yesNo = either(fc.constantFrom('yes', 'no'))
    const arbitraries: Record<Workflow, fc.Arbitrary<Inputs>> = {
      approve: fc.record(
        {
          mode: either(modes),
          'story-id': either(id),
          'package-prefix': either(fc.stringMatching(/^[0-9a-f]{12,64}$/)),
          'languages-read': free,
          'all-nodes-read': yesNo,
          'images-viewed': free,
          'narration-check': free,
          devices: free,
          'checklist-complete': yesNo,
        },
        {
          requiredKeys: [
            'story-id',
            'package-prefix',
            'languages-read',
            'images-viewed',
            'narration-check',
            'devices',
          ],
        },
      ),
      publish: fc.record(
        {
          mode: either(modes),
          'story-ids': either(fc.oneof(fc.constant(''), ids)),
          feature: either(fc.oneof(fc.constant(''), fc.constant('none'), id)),
          snapshot: either(fc.oneof(fc.constant(''), fc.stringMatching(/^[1-9][0-9]{0,15}$/))),
        },
        { requiredKeys: [] },
      ),
      unpublish: fc.record(
        { mode: either(modes), 'story-id': either(id) },
        { requiredKeys: ['story-id'] },
      ),
      verify: fc.record(
        {
          mode: either(fc.constantFrom('fixtures', 'run')),
          deep: either(fc.oneof(fc.boolean(), fc.constantFrom('true', 'false'))),
        },
        { requiredKeys: [] },
      ),
    }
    const commandOf: Record<Workflow, string> = {
      approve: 'approve',
      publish: 'publish',
      unpublish: 'publish',
      verify: 'verify',
    }
    const allowedFlags = new Set([
      '--package',
      '--answers-stdin',
      '--dry-run',
      '--fixtures',
      '--feature',
      '--snapshot',
      '--unpublish',
      '--deep',
    ])
    for (const workflow of WORKFLOWS) {
      const generated = fc.sample(arbitraries[workflow], { seed: 1616, numRuns: 500 })
      let accepted = 0
      const violations: string[] = []
      for (const inputs of generated) {
        const job: Job = (inputs.mode ?? 'fixtures') === 'fixtures' ? 'fixtures' : 'storage'
        const plan = planOf({ argv: [workflow, job], inputs }).plan
        if (!plan.ok) continue
        accepted++
        const values = new Set(
          Object.values(inputs).filter((value): value is string => typeof value === 'string'),
        )
        const storyIds = inputs['story-ids']
        if (typeof storyIds === 'string') for (const part of storyIds.split(' ')) values.add(part)
        plan.argv.forEach((element, index) => {
          const fail = (why: string) => violations.push(`${why}: ${JSON.stringify(plan.argv)}`)
          if (['--takedown', '--report-dir', '--timeout-ms'].includes(element))
            fail('forbidden flag')
          if (element.startsWith('--') && !allowedFlags.has(element)) fail('unknown flag')
          if (
            !element.startsWith('--') &&
            !(index === 0 ? element === commandOf[workflow] : values.has(element))
          )
            fail('an element that is no input value')
          if (index === 0 && element !== commandOf[workflow]) fail('the command')
          if (element === '' || /[\u0000\n ]/.test(element))
            fail('an empty, NUL, LF or space element')
        })
      }
      expect(
        accepted,
        `precondition: at least 200 accepted plans for ${workflow}`,
      ).toBeGreaterThanOrEqual(200)
      expect
        .soft(violations.slice(0, 3), `(g4) every accepted ${workflow} plan keeps the argv rules`)
        .toEqual([])
    }
  })
})

/** A child stdin that records writes, ends and listeners. */
class FakeStdin extends EventEmitter {
  readonly writes: Uint8Array[] = []
  ends = 0
  write(chunk: Uint8Array): boolean {
    this.writes.push(chunk)
    return true
  }
  end(): this {
    this.ends++
    return this
  }
}

class FakeChild extends EventEmitter {
  constructor(readonly stdin: FakeStdin | null) {
    super()
  }
}

interface SpawnCall {
  readonly command: string
  readonly args: readonly string[]
  readonly options: DispatchSpawnOptions
  readonly child: FakeChild
}

const PATHS = {
  execPath: '/opt/node/bin/node',
  tsxCli: '/opt/repo/storyboard/node_modules/tsx/dist/cli.mjs',
  cliPath: '/opt/repo/storyboard/tools/publisher/cli.ts',
  storyboardRoot: '/opt/repo/storyboard',
}

/** main's deps with a fake spawn whose child runs `after` on the next turn. */
function harness(options: {
  readonly argv: readonly string[]
  readonly inputs?: unknown
  readonly env?: Env
  readonly after?: (child: FakeChild) => void
  readonly spawn?: SpawnLike
}) {
  const errors: string[] = []
  const calls: SpawnCall[] = []
  const after = options.after ?? ((child: FakeChild) => child.emit('close', 0, null))
  const spawn: SpawnLike = (command, args, spawnOptions) => {
    const stdio = spawnOptions.stdio
    const child = new FakeChild(
      Array.isArray(stdio) && stdio[0] === 'pipe' ? new FakeStdin() : null,
    )
    calls.push({ command, args, options: spawnOptions, child })
    setImmediate(() => after(child))
    return child
  }
  const deps: MainDeps = {
    env: options.env ?? { ...BASE_ENV },
    platform: 'linux',
    readFile: () => eventOf(options.inputs),
    spawn: options.spawn ?? spawn,
    error: (line) => errors.push(line),
    ...PATHS,
  }
  const run = () =>
    main(options.argv, deps).then(
      (code) => code,
      () => 'rejected' as const,
    )
  return { deps, errors, calls, run }
}

describe('publisher-dispatch main', () => {
  it('T16-5 main spawns process.execPath with tsx/cli and cli.ts, no shell, the same env object and fixed stdio; writes approve stdin once; passes the exit code; signals, spawn errors, stdin errors and internal throws end with fixed lines; refusals never spawn (A6, CRIT-10, TP16-3)', async () => {
    // g1, g2: one spawn per valid sample with the fixed command, options and stdin.
    for (const workflow of WORKFLOWS) {
      for (const job of JOBS) {
        const inputs = inputsOf(workflow, modeFor(workflow, job))
        const h = harness({ argv: [workflow, job], inputs })
        const code = await h.run()
        const plan = planOf({ argv: [workflow, job], inputs }).plan
        expect(plan.ok && h.calls.length, `precondition: one spawn for ${workflow} ${job}`).toBe(1)
        const call = h.calls[0]!
        const label = `${workflow} ${job}`
        expect.soft(code, `(g1) the child's code passes: ${label}`).toBe(0)
        expect.soft(call.command, `(g1) the command is execPath: ${label}`).toBe(PATHS.execPath)
        expect
          .soft(call.args, `(g1) args are tsx/cli, cli.ts and the plan's argv: ${label}`)
          .toEqual([PATHS.tsxCli, PATHS.cliPath, ...(plan.ok ? plan.argv : [])])
        expect.soft(call.options.shell, `(g1) no shell: ${label}`).toBe(false)
        expect
          .soft(call.options.cwd, `(g1) cwd is the storyboard root: ${label}`)
          .toBe(PATHS.storyboardRoot)
        expect.soft(call.options.env, `(g1) the same env object: ${label}`).toBe(h.deps.env)
        expect
          .soft(call.options.stdio, `(g1) fixed stdio: ${label}`)
          .toEqual([workflow === 'approve' ? 'pipe' : 'ignore', 'inherit', 'inherit'])
        if (workflow === 'approve') {
          const stdin = call.child.stdin
          expect
            .soft(
              stdin === null ? null : stdin.writes.map((chunk) => [...chunk]),
              `(g2) approve writes the plan's stdin once: ${label}`,
            )
            .toEqual([[...(plan.ok && plan.stdin !== null ? plan.stdin : [])]])
          expect.soft(stdin?.ends, `(g2) and ends stdin once: ${label}`).toBe(1)
        } else {
          expect.soft(call.child.stdin, `(g2) ${label} writes nothing`).toBeNull()
        }
        expect.soft(h.errors, `(g1) no line on success: ${label}`).toEqual([])
      }
    }

    // g3: the child's close code passes through, with no line.
    for (const closeCode of [0, 1, 2, 3, 4]) {
      const h = harness({
        argv: ['verify', 'fixtures'],
        inputs: inputsOf('verify', 'fixtures'),
        after: (child) => child.emit('close', closeCode, null),
      })
      expect.soft(await h.run(), `(g3) close ${closeCode} resolves to ${closeCode}`).toBe(closeCode)
      expect.soft(h.errors, `(g3) close ${closeCode} prints no line`).toEqual([])
    }

    // g4: signals, spawn errors, stdin errors and internal throws.
    const signalled = harness({
      argv: ['publish', 'fixtures'],
      inputs: inputsOf('publish', 'fixtures'),
      after: (child) => child.emit('close', null, 'SIGTERM'),
    })
    expect.soft(await signalled.run(), '(g4) a signal ends 1').toBe(1)
    expect.soft(signalled.errors, '(g4) a signal prints the stopped line').toEqual([LINE.stopped])
    const notStarted = harness({
      argv: ['publish', 'fixtures'],
      inputs: inputsOf('publish', 'fixtures'),
      after: (child) =>
        child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })),
    })
    expect.soft(await notStarted.run(), '(g4) a spawn error ends 1').toBe(1)
    expect
      .soft(notStarted.errors, '(g4) a spawn error prints the stopped line')
      .toEqual([LINE.stopped])
    let stdinThrew: unknown = null
    const epipe = harness({
      argv: ['approve', 'storage'],
      inputs: inputsOf('approve', 'run'),
      after: (child) => {
        try {
          child.stdin?.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
        } catch (error) {
          stdinThrew = error
        }
        child.emit('close', 2, null)
      },
    })
    expect.soft(await epipe.run(), '(g4) a stdin error keeps the child code').toBe(2)
    expect.soft(epipe.errors, '(g4) a stdin error prints no line').toEqual([])
    expect.soft(stdinThrew, '(g4) a stdin error does not throw').toBeNull()
    const throwCanary = ['S16', 'THROW', 'CANARY'].join('')
    const throwing = harness({
      argv: ['verify', 'fixtures'],
      inputs: inputsOf('verify', 'fixtures'),
      spawn: () => {
        throw new TypeError(throwCanary)
      },
    })
    expect.soft(await throwing.run(), '(g4) a synchronous spawn throw ends 1').toBe(1)
    expect.soft(throwing.errors, '(g4) it prints the internal line only').toEqual([LINE.internal])
    expect
      .soft(throwing.errors.join('\n').includes(throwCanary), '(g4) never the message')
      .toBe(false)

    // g5: one refusal per check through main: exit 2, no spawn, the plan's one line.
    const refusals: [string, Parameters<typeof harness>[0]][] = [
      ['check 1', { argv: ['approve'], inputs: inputsOf('approve', 'fixtures') }],
      [
        'check 2',
        {
          argv: ['approve', 'fixtures'],
          inputs: inputsOf('approve', 'fixtures'),
          env: envWith('GITHUB_ACTIONS', '1'),
        },
      ],
      [
        'check 3',
        {
          argv: ['approve', 'fixtures'],
          inputs: inputsOf('approve', 'fixtures'),
          env: envWith('GITHUB_EVENT_NAME', 'push'),
        },
      ],
      [
        'check 4',
        {
          argv: ['publish', 'storage'],
          inputs: inputsOf('publish', 'run'),
          env: envWith('GITHUB_REF', 'refs/heads/x'),
        },
      ],
      [
        'check 4b',
        {
          argv: ['publish', 'storage'],
          inputs: inputsOf('publish', 'run'),
          env: envWith('GITHUB_RUN_ATTEMPT', '2'),
        },
      ],
      [
        'check 4c',
        {
          argv: ['publish', 'storage'],
          inputs: inputsOf('publish', 'run'),
          env: envWith('RUNNER_DEBUG', ''),
        },
      ],
      [
        'check 5',
        {
          argv: ['verify', 'fixtures'],
          inputs: inputsOf('verify', 'fixtures'),
          env: envWith('GITHUB_EVENT_PATH', ''),
        },
      ],
      ['check 6', { argv: ['verify', 'fixtures'], inputs: { mode: 'fixtures', x: '1' } }],
      [
        'check 7',
        { argv: ['unpublish', 'fixtures'], inputs: { mode: 'fixtures', 'story-id': '--takedown' } },
      ],
      ['check 8', { argv: ['unpublish', 'fixtures'], inputs: inputsOf('unpublish', 'run') }],
    ]
    for (const [label, options] of refusals) {
      const h = harness(options)
      const plan = planDispatch(options.argv, h.deps)
      expect(plan.ok, `precondition: the ${label} sample is refused`).toBe(false)
      expect.soft(await h.run(), `(g5) ${label} exits 2`).toBe(2)
      expect.soft(h.calls.length, `(g5) ${label} never spawns`).toBe(0)
      expect.soft(h.errors, `(g5) ${label} prints the plan's one line`).toEqual([lineOf(plan)])
    }

    // g6: approve stdin over ANSWERS_MAX_BYTES is refused before the spawn.
    const sized = (total: number): Inputs => {
      const inputs: Inputs = { ...inputsOf('approve', 'fixtures'), 'narration-check': '' }
      const base = encode(
        `${JSON.stringify(Object.fromEntries(ANSWER_KEYS.map((key) => [key, inputs[key]])))}\n`,
      ).byteLength
      return { ...inputs, 'narration-check': 'a'.repeat(total - base) }
    }
    const atCapInputs = sized(ANSWERS_MAX_BYTES)
    const atCap = harness({ argv: ['approve', 'fixtures'], inputs: atCapInputs })
    expect(
      encode(
        `${JSON.stringify(Object.fromEntries(ANSWER_KEYS.map((key) => [key, atCapInputs[key]])))}\n`,
      ).byteLength,
      'precondition: the at-cap answers are exactly ANSWERS_MAX_BYTES as stdin',
    ).toBe(ANSWERS_MAX_BYTES)
    expect.soft(await atCap.run(), '(g6) 16,384 bytes spawn').toBe(0)
    expect.soft(atCap.calls.length, '(g6) 16,384 bytes spawn once').toBe(1)
    const overCap = harness({ argv: ['approve', 'fixtures'], inputs: sized(ANSWERS_MAX_BYTES + 1) })
    expect.soft(await overCap.run(), '(g6) 16,385 bytes exit 2').toBe(2)
    expect.soft(overCap.errors, '(g6) 16,385 bytes print the too-long line').toEqual([LINE.tooLong])
    expect.soft(overCap.calls.length, '(g6) 16,385 bytes never spawn').toBe(0)

    // g7: the real tsx/cli and cli.ts paths, resolved without running them.
    const tsxCli = resolveTsxCli()
    expect
      .soft(tsxCli.replaceAll('\\', '/').endsWith('/tsx/dist/cli.mjs'), '(g7) tsx/cli resolves')
      .toBe(true)
    expect.soft(existsSync(tsxCli), '(g7) the tsx/cli file exists').toBe(true)
    const storyboardRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    const cliPath = cliPathOf(import.meta.url)
    expect
      .soft(cliPath, '(g7) cliPathOf names tools/publisher/cli.ts')
      .toBe(join(storyboardRoot, 'tools', 'publisher', 'cli.ts'))
    expect.soft(existsSync(cliPath), '(g7) cli.ts exists').toBe(true)

    // g8: the entry block's adapter forwards the options to node's spawn unchanged (S16-R1-SEC-4;
    // MU16-200 to MU16-208): no test runs it, so its source is pinned.
    const adapter = spawnAdapterOf(
      readFileSync(new URL('./publisher-dispatch.ts', import.meta.url), 'utf8'),
    )
    expect(
      adapter.params.length,
      "precondition: the entry block's spawn dependency is an arrow of three parameters calling node's spawn",
    ).toBe(3)
    const [commandParam, argsParam, optionsParam] = adapter.params
    expect
      .soft(
        [adapter.imports, adapter.sites],
        "(g8) node:child_process gives spawn only, called once, as the entry block's spawn dependency",
      )
      .toEqual([['spawn'], ['the entry spawn dependency']])
    expect.soft(adapter.command, "(g8) the command is the adapter's own").toBe(commandParam)
    expect
      .soft(adapter.args, "(g8) the args are the adapter's, spread into a new array")
      .toBe(`[...${argsParam}]`)
    expect
      .soft(adapter.keys, '(g8) the options are cwd, env, shell and stdio only')
      .toEqual(['cwd', 'env', 'shell', 'stdio'])
    expect.soft(adapter.cwd, '(g8) cwd is forwarded').toBe(`${optionsParam}.cwd`)
    expect
      .soft(adapter.env, '(g8) env is the same object, neither spread nor copied')
      .toBe(`${optionsParam}.env`)
    expect
      .soft([`${optionsParam}.shell`, 'false'], '(g8) shell is forwarded or false')
      .toContain(adapter.shell)
    expect
      .soft([`[...${optionsParam}.stdio]`, `${optionsParam}.stdio`], '(g8) stdio is forwarded')
      .toContain(adapter.stdio)
  })
})

interface SpawnAdapter {
  /** The names node:child_process gives the helper. */
  readonly imports: readonly string[]
  /** Where each call of node's spawn sits. */
  readonly sites: readonly string[]
  /** The adapter arrow's parameter names (empty when the entry block has no adapter). */
  readonly params: readonly string[]
  readonly command: string | null
  readonly args: string | null
  readonly keys: readonly string[]
  readonly cwd: string | null
  /** The env option with any `as`, `satisfies` or parentheses taken off (types only). */
  readonly env: string | null
  readonly shell: string | null
  readonly stdio: string | null
}

/**
 * The entry block's adapter from SpawnLike to node's spawn, read from the helper's source (T16-5 g8,
 * S16-R1-SEC-4): `spawn: (command, args, options) => spawn(command, [...args], {...})`.
 */
function spawnAdapterOf(source: string): SpawnAdapter {
  const tree = ts.createSourceFile(
    'adapter.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const text = (node: ts.Node | undefined) =>
    node === undefined ? null : node.getText(tree).replace(/\s+/g, ' ')
  const imports: string[] = []
  const locals = new Set<string>()
  for (const statement of tree.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'node:child_process'
    ) {
      continue
    }
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) {
      imports.push(text(statement) ?? '')
      continue
    }
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text
      imports.push(imported)
      if (imported === 'spawn') locals.add(element.name.text)
    }
  }
  const calls: ts.CallExpression[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      locals.has(node.expression.text)
    ) {
      calls.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const isAdapter = (call: ts.CallExpression) => {
    const arrow = call.parent
    return (
      ts.isArrowFunction(arrow) &&
      arrow.body === call &&
      ts.isPropertyAssignment(arrow.parent) &&
      ts.isIdentifier(arrow.parent.name) &&
      arrow.parent.name.text === 'spawn' &&
      inEntryBlock(call)
    )
  }
  const sites = calls.map((call) =>
    isAdapter(call) ? 'the entry spawn dependency' : `another call at ${call.getStart(tree)}`,
  )
  const call = calls.find(isAdapter)
  const arrow = call?.parent
  const params =
    arrow !== undefined && ts.isArrowFunction(arrow)
      ? arrow.parameters.map((parameter) => parameter.name.getText(tree))
      : []
  const options = call?.arguments[2]
  const keys: string[] = []
  const values = new Map<string, ts.Expression>()
  if (options !== undefined && ts.isObjectLiteralExpression(options)) {
    for (const property of options.properties) {
      // A shorthand, spread or method option is named by its text, so the key list shows it.
      const key = ts.isPropertyAssignment(property)
        ? property.name.getText(tree)
        : (text(property) ?? '')
      keys.push(key)
      if (ts.isPropertyAssignment(property)) values.set(key, property.initializer)
    }
  }
  let env = values.get('env')
  while (
    env !== undefined &&
    (ts.isAsExpression(env) || ts.isSatisfiesExpression(env) || ts.isParenthesizedExpression(env))
  ) {
    env = env.expression
  }
  return {
    imports,
    sites,
    params,
    command: text(call?.arguments[0]),
    args: text(call?.arguments[1]),
    keys,
    cwd: text(values.get('cwd')),
    env: text(env),
    shell: text(values.get('shell')),
    stdio: text(values.get('stdio')),
  }
}

interface EnvScan {
  readonly diagnostics: number | null
  readonly names: string[]
  readonly sites: number
  readonly processEnv: number
  readonly findings: string[]
}

const isLiteralKey = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

/** An identifier in a position that names a declaration or a property, not a value read. */
function isNameOnly(node: ts.Identifier): boolean {
  const parent = node.parent
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && (parent.propertyName === node || parent.name === node)) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    ((ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)) &&
      parent.name === node) ||
    ts.isTypeReferenceNode(parent) ||
    ts.isQualifiedName(parent)
  )
}

/** `process`, `globalThis.process` or `global.process`. */
const isProcess = (node: ts.Node): boolean =>
  (ts.isIdentifier(node) && node.text === 'process') ||
  (ts.isPropertyAccessExpression(node) &&
    node.name.text === 'process' &&
    ts.isIdentifier(node.expression) &&
    ['globalThis', 'global'].includes(node.expression.text))

/** Inside the top-level `if (isEntryPoint(...)) { ... }` block. */
function inEntryBlock(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) {
    if (
      ts.isIfStatement(at) &&
      ts.isSourceFile(at.parent) &&
      ts.isCallExpression(at.expression) &&
      ts.isIdentifier(at.expression.expression) &&
      at.expression.expression.text === 'isEntryPoint'
    ) {
      return true
    }
  }
  return false
}

/** A literal key: an identifier, a string or template literal, or a computed literal; else null. */
function literalKeyOf(key: ts.Node | undefined): string | null {
  if (key === undefined) return null
  if (ts.isIdentifier(key) || isLiteralKey(key)) return key.text
  if (ts.isComputedPropertyName(key) && isLiteralKey(key.expression)) return key.expression.text
  return null
}

/** A type that names the injected container of `env` (S16-R1-SEC-1). */
const CONTAINER_TYPE = /\b(?:PlanDeps|MainDeps)\b/

/**
 * The injected-env scan (T16-6; catalogue "Env and launch reads" class 1): every read of the
 * injected env by name, and every other use as a finding; every `process.env` form, the entry
 * block's `env: process.env` value the only one that is not a finding. The env is reached as `env`,
 * as the member `env` of any object (`.env`, `?.env`, `['env']`, `` [`env`] ``, `Reflect.get(o,
 * 'env')`), or as a binding of the key `env`; its container (`deps`, or any parameter or variable
 * typed PlanDeps or MainDeps, whatever its name) may only be read by a literal member, destructured
 * by literal keys or passed to a local function's container parameter (S16-R1-SEC-1).
 */
function scanEnvReads(source: string): EnvScan {
  const tree = ts.createSourceFile(
    'scan.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const diagnostics: unknown = Reflect.get(tree, 'parseDiagnostics')
  const names: string[] = []
  const findings: string[] = []
  let processEnv = 0
  const where = (node: ts.Node) => `${node.getText(tree).slice(0, 40)} at ${node.getStart(tree)}`
  const isReflectGet = (node: ts.Node): node is ts.CallExpression =>
    ts.isCallExpression(node) &&
    node.expression.getText(tree).replace(/[\s?]/g, '') === 'Reflect.get'
  const literalArg = (call: ts.CallExpression, index: number): string | null => {
    const arg = call.arguments[index]
    return arg !== undefined && isLiteralKey(arg) ? arg.text : null
  }
  // The containers: `deps`, every parameter or variable typed PlanDeps or MainDeps, and, per local
  // function, which of its parameters is such a container.
  const containers = new Set(['deps'])
  const containerParams = new Map<string, boolean[]>()
  const isContainerTyped = (node: ts.ParameterDeclaration | ts.VariableDeclaration) =>
    node.type !== undefined && CONTAINER_TYPE.test(node.type.getText(tree))
  const collect = (node: ts.Node) => {
    if (
      (ts.isParameter(node) || ts.isVariableDeclaration(node)) &&
      isContainerTyped(node) &&
      ts.isIdentifier(node.name)
    ) {
      containers.add(node.name.text)
    }
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      containerParams.set(node.name.text, node.parameters.map(isContainerTyped))
    }
    ts.forEachChild(node, collect)
  }
  collect(tree)
  /** A pattern over the env: each literal key recorded, any other element a finding. */
  const envPattern = (pattern: ts.ObjectBindingPattern) => {
    for (const element of pattern.elements) {
      const key = literalKeyOf(element.propertyName ?? element.name)
      if (element.dotDotDotToken !== undefined) findings.push(`rest: ${where(element)}`)
      else if (key !== null) names.push(key)
      else findings.push(`destructured key: ${where(element)}`)
    }
  }
  /** `env: <ref>`, through `as`, `satisfies`, `!` or parentheses only, in a spawn call's options. */
  const isSpawnEnvOption = (ref: ts.Node): boolean => {
    let value = ref
    while (
      ts.isAsExpression(value.parent) ||
      ts.isSatisfiesExpression(value.parent) ||
      ts.isNonNullExpression(value.parent) ||
      ts.isParenthesizedExpression(value.parent)
    ) {
      value = value.parent
    }
    const option = value.parent
    return (
      ts.isPropertyAssignment(option) &&
      option.initializer === value &&
      ts.isIdentifier(option.name) &&
      option.name.text === 'env' &&
      ts.isObjectLiteralExpression(option.parent) &&
      ts.isCallExpression(option.parent.parent) &&
      /(?:^|\.)spawn$/.test(option.parent.parent.expression.getText(tree))
    )
  }
  const envUse = (ref: ts.Node) => {
    const parent = ref.parent
    if (ts.isPropertyAccessExpression(parent) && parent.expression === ref) {
      names.push(parent.name.text)
    } else if (ts.isElementAccessExpression(parent) && parent.expression === ref) {
      if (isLiteralKey(parent.argumentExpression)) names.push(parent.argumentExpression.text)
      else findings.push(`computed key: ${where(parent)}`)
    } else if (ts.isVariableDeclaration(parent) && parent.initializer === ref) {
      if (ts.isObjectBindingPattern(parent.name)) envPattern(parent.name)
      else findings.push(`alias: ${where(parent)}`)
    } else if (isReflectGet(parent) && parent.arguments[0] === ref) {
      const key = literalArg(parent, 1)
      if (key !== null) names.push(key)
      else findings.push(`Reflect.get: ${where(parent)}`)
    } else if (isSpawnEnvOption(ref)) {
      // the spawn option `env: deps.env`: the same object passed on, unread
    } else {
      findings.push(`other use: ${where(parent)}`)
    }
  }
  /** A binding of the key `env` from any object: a nested pattern is read, a rename is a finding. */
  const envBinding = (element: ts.BindingElement) => {
    const holder = element.parent.parent
    if (
      ts.isVariableDeclaration(holder) &&
      holder.initializer !== undefined &&
      isProcess(holder.initializer)
    ) {
      return // a process.env site, counted below
    }
    if (ts.isObjectBindingPattern(element.name)) envPattern(element.name)
    else if (!(ts.isIdentifier(element.name) && element.name.text === 'env')) {
      findings.push(`env bound to another name: ${where(element)}`)
    }
  }
  /** A pattern over a container: literal keys only (an `env` key is read by envBinding). */
  const containerPattern = (pattern: ts.ObjectBindingPattern) => {
    for (const element of pattern.elements) {
      if (element.dotDotDotToken !== undefined) findings.push(`container rest: ${where(element)}`)
      else if (literalKeyOf(element.propertyName ?? element.name) === null) {
        findings.push(`container key: ${where(element)}`)
      }
    }
  }
  /** A container read by a literal member, or passed to a local function's container parameter. */
  const containerUse = (ref: ts.Identifier) => {
    const parent = ref.parent
    if (ts.isPropertyAccessExpression(parent) && parent.expression === ref) return
    if (ts.isElementAccessExpression(parent) && parent.expression === ref) {
      if (!isLiteralKey(parent.argumentExpression)) {
        findings.push(`container computed key: ${where(parent)}`)
      }
      return
    }
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === ref &&
      ts.isObjectBindingPattern(parent.name)
    ) {
      containerPattern(parent.name)
      return
    }
    if (ts.isCallExpression(parent) && parent.expression !== ref) {
      const index = parent.arguments.indexOf(ref)
      if (isReflectGet(parent) && index === 0 && literalArg(parent, 1) !== null) return
      const callee = parent.expression
      if (ts.isIdentifier(callee) && containerParams.get(callee.text)?.[index] === true) return
    }
    findings.push(`container use: ${where(parent)}`)
  }
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === 'env' && !isNameOnly(node)) envUse(node)
    if (ts.isIdentifier(node) && containers.has(node.text) && !isNameOnly(node)) {
      containerUse(node)
    }
    // The member `env` of any object but process: the injected env through its container.
    const envMember =
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === 'env' &&
        !isProcess(node.expression)) ||
      (ts.isElementAccessExpression(node) &&
        isLiteralKey(node.argumentExpression) &&
        node.argumentExpression.text === 'env' &&
        !isProcess(node.expression)) ||
      (isReflectGet(node) &&
        literalArg(node, 1) === 'env' &&
        node.arguments[0] !== undefined &&
        !isProcess(node.arguments[0]))
    if (envMember) envUse(node)
    if (
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      node.dotDotDotToken === undefined &&
      literalKeyOf(node.propertyName ?? node.name) === 'env'
    ) {
      envBinding(node)
    }
    if (ts.isParameter(node) && isContainerTyped(node) && ts.isObjectBindingPattern(node.name)) {
      containerPattern(node.name)
    }
    const processSite =
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === 'env' &&
        isProcess(node.expression)) ||
      (ts.isElementAccessExpression(node) &&
        isProcess(node.expression) &&
        isLiteralKey(node.argumentExpression) &&
        node.argumentExpression.text === 'env') ||
      (isReflectGet(node) &&
        literalArg(node, 1) === 'env' &&
        node.arguments[0] !== undefined &&
        isProcess(node.arguments[0])) ||
      (ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        isProcess(node.initializer) &&
        ts.isObjectBindingPattern(node.name) &&
        node.name.elements.some(
          (element) => (element.propertyName ?? element.name).getText(tree) === 'env',
        ))
    if (processSite) {
      processEnv++
      const passed =
        ts.isPropertyAccessExpression(node) &&
        ts.isPropertyAssignment(node.parent) &&
        node.parent.initializer === node &&
        ts.isIdentifier(node.parent.name) &&
        node.parent.name.text === 'env' &&
        inEntryBlock(node)
      if (!passed) findings.push(`process.env: ${where(node)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return {
    diagnostics: Array.isArray(diagnostics) ? diagnostics.length : null,
    names,
    sites: names.length,
    processEnv,
    findings,
  }
}

describe('publisher-dispatch env reads', () => {
  it('T16-6 the helper reads exactly six environment names from its injected env, and process.env only in its entry block (A6, CRIT-7 item 3; catalogue "Env and launch reads" class 1)', () => {
    const source = readFileSync(new URL('./publisher-dispatch.ts', import.meta.url), 'utf8')
    const real = scanEnvReads(source)
    expect(real.diagnostics, 'precondition: the helper parses with 0 syntax diagnostics').toBe(0)
    expect(real.sites, 'precondition: at least 6 env read sites').toBeGreaterThanOrEqual(6)
    expect
      .soft([...new Set(real.names)].sort(), '(g1) the recorded names are the six')
      .toEqual([...SIX_NAMES].sort())
    expect
      .soft([...DISPATCH_ENV_NAMES].sort(), '(g1) DISPATCH_ENV_NAMES is the six')
      .toEqual([...SIX_NAMES].sort())
    expect.soft(real.processEnv, '(g1) process.env occurs once').toBe(1)
    expect.soft(real.findings, '(g1) no finding').toEqual([])

    // g2: every read form, each a finding or a recorded wrong name; the clean forms stay clean.
    const secretName = ['SUPABASE', 'SECRET', 'KEY'].join('_')
    const flagged = [
      `env.${secretName}`,
      "env['X']",
      'env[`X`]',
      'env?.X',
      'const { X } = env',
      "const { ['X']: y } = env",
      'const { X: y } = deps.env',
      "Reflect.get(env, 'X')",
      'const e = env; e.X',
      'Object.keys(env)',
      'Object.entries(env)',
      'const o = { ...env }',
      'JSON.stringify(env)',
      'for (const k in env) {}',
      'env[name]',
      'process.env.X',
      "process['env'].X",
      'globalThis.process.env.X',
      'const { env: e } = process',
      "Reflect.get(process, 'env').X",
      // S16-R1-SEC-1: the env reached through its container, and the container used unnamed.
      `deps['env'].${secretName}`,
      `deps[\`env\`].${secretName}`,
      `const { env: e } = deps; e.${secretName}`,
      `const { env: { ${secretName}: k } } = deps`,
      `const d = deps; d.env.${secretName}`,
      `Reflect.get(deps, 'env').${secretName}`,
      `function f(o: { env: Record<string, string> }) { return o.env.${secretName} }`,
      `function g({ env: v }: { env: Record<string, string> }) { return v.${secretName} }`,
      `deps?.['env']?.${secretName}`,
      'JSON.stringify(deps)',
      'Object.values(deps)',
      'const o = { ...deps }',
      'deps[k]',
      'Reflect.get(deps, k)',
      'const { ...r } = deps',
      'function f(o: object) { return o }\nf(deps)',
      'function h(p: PlanDeps) { return Object.keys(p) }',
    ]
    for (const text of flagged) {
      const scan = scanEnvReads(text)
      const wrong = scan.names.filter((name) => !SIX_NAMES.includes(name))
      expect
        .soft(scan.findings.length + wrong.length, `(g2) a finding or a wrong name: ${text}`)
        .toBeGreaterThan(0)
    }
    for (const text of [
      'env.GITHUB_REF',
      "env['GITHUB_REF']",
      'deps.spawn(a, b, { env: deps.env })',
      'spawn(c, [...a], { env: options.env as NodeJS.ProcessEnv })',
      'function r(d: PlanDeps) { return d.env.GITHUB_REF }\nr(deps)',
      'const { env } = deps; env.GITHUB_REF',
    ]) {
      const scan = scanEnvReads(text)
      expect
        .soft(
          [scan.findings, scan.names.filter((name) => !SIX_NAMES.includes(name))],
          `(g2) clean: ${text}`,
        )
        .toEqual([[], []])
    }
  })
})
